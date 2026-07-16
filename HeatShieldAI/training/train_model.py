"""
train_model.py
===============
Trains a small, ESP32-friendly neural network to classify heat-stress level
from [Temperature, Humidity, HeartRate, SpO2, HeatIndex].

Pipeline:
  1. Load dataset/heat_stress_dataset.csv, stratified 70/15/15 split.
  2. Compute normalization (mean/std) from the TRAINING split only, save to
     training/model_output/normalization_params.json.
  3. Build a small Dense network (5 -> 16 -> 12 -> 4, ReLU + Softmax).
     This is intentionally tiny: ~450 parameters, <10KB even before
     quantization, because it must run in a few KB of tensor arena on an
     ESP32 with real-time inference.
  4. Train with early stopping, checkpointing on best validation accuracy,
     and ReduceLROnPlateau learning-rate scheduling.
  5. Evaluate on the held-out test split: accuracy/precision/recall/F1,
     classification report, confusion matrix, and sample predictions.
  6. Save docs/05_training_curves.png, docs/06_confusion_matrix.png,
     docs/evaluation_report.md
  7. Save training/model_output/heatshield_model.keras and .h5

Run: python train_model.py
"""

import os
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import tensorflow as tf
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support,
    classification_report, confusion_matrix,
)

from common import (
    FEATURE_NAMES, CLASS_NAMES, NUM_CLASSES, NUM_FEATURES, RANDOM_SEED,
    ROOT_DIR, MODEL_OUTPUT_DIR,
    load_and_split_dataset, compute_normalization_params,
    save_normalization_params, normalize,
)

DOCS_DIR = os.path.join(ROOT_DIR, "docs")
KERAS_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.keras")
H5_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.h5")
CHECKPOINT_PATH = os.path.join(MODEL_OUTPUT_DIR, "checkpoint_best.keras")
EVAL_REPORT_PATH = os.path.join(DOCS_DIR, "evaluation_report.md")

tf.random.set_seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


def build_model():
    """
    Small feed-forward classifier sized for ESP32 deployment.

    5 inputs -> Dense(16, relu) -> Dense(12, relu) -> Dense(4, softmax)
    Total params ~ (5*16+16) + (16*12+12) + (12*4+4) = 96 + 204 + 52 = 352

    Kept deliberately shallow/narrow: this is a 5-feature tabular problem,
    not an image/signal problem, so a large network would only overfit and
    waste flash/RAM/inference-time on the ESP32 for no accuracy benefit.
    """
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(NUM_FEATURES,), name="features"),
        tf.keras.layers.Dense(16, activation="relu", name="dense_1"),
        tf.keras.layers.Dense(12, activation="relu", name="dense_2"),
        tf.keras.layers.Dense(NUM_CLASSES, activation="softmax", name="output"),
    ], name="heatshield_classifier")

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def plot_training_curves(history, save_path):
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    axes[0].plot(history.history["loss"], label="train loss")
    axes[0].plot(history.history["val_loss"], label="val loss")
    axes[0].set_title("Loss")
    axes[0].set_xlabel("Epoch")
    axes[0].legend()

    axes[1].plot(history.history["accuracy"], label="train accuracy")
    axes[1].plot(history.history["val_accuracy"], label="val accuracy")
    axes[1].set_title("Accuracy")
    axes[1].set_xlabel("Epoch")
    axes[1].legend()

    fig.suptitle("HeatShieldAI Training Curves")
    fig.tight_layout()
    fig.savefig(save_path, dpi=150)
    plt.close(fig)


def plot_confusion_matrix(cm, save_path):
    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES, ax=ax)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title("Confusion Matrix (Test Set)")
    fig.tight_layout()
    fig.savefig(save_path, dpi=150)
    plt.close(fig)


def main():
    os.makedirs(MODEL_OUTPUT_DIR, exist_ok=True)
    os.makedirs(DOCS_DIR, exist_ok=True)

    print("Loading and splitting dataset...")
    X_train, X_val, X_test, y_train, y_val, y_test = load_and_split_dataset()
    print(f"  train={len(X_train)}  val={len(X_val)}  test={len(X_test)}")

    mean, std = compute_normalization_params(X_train)
    save_normalization_params(mean, std)
    print(f"Saved normalization params (mean/std) for features: {FEATURE_NAMES}")

    X_train_n = normalize(X_train, mean, std)
    X_val_n = normalize(X_val, mean, std)
    X_test_n = normalize(X_test, mean, std)

    model = build_model()
    model.summary()

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=20, restore_best_weights=True
        ),
        tf.keras.callbacks.ModelCheckpoint(
            CHECKPOINT_PATH, monitor="val_accuracy", save_best_only=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=8, min_lr=1e-5
        ),
    ]

    print("Training...")
    history = model.fit(
        X_train_n, y_train,
        validation_data=(X_val_n, y_val),
        epochs=200,
        batch_size=32,
        callbacks=callbacks,
        verbose=2,
    )

    plot_training_curves(history, os.path.join(DOCS_DIR, "05_training_curves.png"))

    # ---- Evaluation on held-out test set ----
    print("Evaluating on test set...")
    y_prob = model.predict(X_test_n, verbose=0)
    y_pred = np.argmax(y_prob, axis=1)

    acc = accuracy_score(y_test, y_pred)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, y_pred, average="macro", zero_division=0
    )
    report = classification_report(
        y_test, y_pred, target_names=CLASS_NAMES, zero_division=0
    )
    cm = confusion_matrix(y_test, y_pred)

    print(f"Test accuracy: {acc:.4f}")
    print(f"Macro precision: {precision:.4f}  recall: {recall:.4f}  f1: {f1:.4f}")
    print(report)

    plot_confusion_matrix(cm, os.path.join(DOCS_DIR, "06_confusion_matrix.png"))

    # Sample predictions for the report
    sample_idx = np.random.RandomState(RANDOM_SEED).choice(len(X_test), size=10, replace=False)
    sample_lines = []
    for i in sample_idx:
        true_c = CLASS_NAMES[y_test[i]]
        pred_c = CLASS_NAMES[y_pred[i]]
        conf = float(np.max(y_prob[i])) * 100
        feats = ", ".join(f"{name}={X_test[i][j]:.2f}" for j, name in enumerate(FEATURE_NAMES))
        sample_lines.append(f"| {feats} | {true_c} | {pred_c} | {conf:.1f}% |")

    with open(EVAL_REPORT_PATH, "w") as f:
        f.write("# HeatShieldAI Model Evaluation Report\n\n")
        f.write(f"- Test samples: {len(X_test)}\n")
        f.write(f"- Test accuracy: {acc:.4f}\n")
        f.write(f"- Macro precision: {precision:.4f}\n")
        f.write(f"- Macro recall: {recall:.4f}\n")
        f.write(f"- Macro F1: {f1:.4f}\n\n")
        f.write("## Classification Report\n\n```\n")
        f.write(report)
        f.write("\n```\n\n")
        f.write("## Confusion Matrix\n\nSee `06_confusion_matrix.png`.\n\n")
        f.write("## Sample Predictions\n\n")
        f.write("| Features | True | Predicted | Confidence |\n")
        f.write("|---|---|---|---|\n")
        f.write("\n".join(sample_lines))
        f.write("\n")

    print(f"Saved evaluation report to {EVAL_REPORT_PATH}")

    # ---- Save trained model ----
    model.save(KERAS_PATH)
    model.save(H5_PATH)
    print(f"Saved model to {KERAS_PATH} and {H5_PATH}")

    # Save a small metadata file useful for downstream scripts / sanity checks
    metadata = {
        "feature_names": FEATURE_NAMES,
        "class_names": CLASS_NAMES,
        "test_accuracy": acc,
        "macro_f1": f1,
        "num_params": int(model.count_params()),
    }
    with open(os.path.join(MODEL_OUTPUT_DIR, "train_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)


if __name__ == "__main__":
    main()
