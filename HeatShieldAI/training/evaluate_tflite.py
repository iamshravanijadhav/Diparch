"""
evaluate_tflite.py
===================
Runs the FULL test set through the actual quantized .tflite model (via the
TFLite interpreter, doing the same int8 quantize/dequantize math the ESP32
firmware does) and produces a complete evaluation report, so we know the
real accuracy impact of INT8 quantization -- not just a spot check.

Saves:
  - docs/07_quantized_confusion_matrix.png
  - docs/quantized_evaluation_report.md

Run: python evaluate_tflite.py
"""

import os
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
    ROOT_DIR, MODEL_OUTPUT_DIR, CLASS_NAMES,
    load_and_split_dataset, load_normalization_params, normalize,
)

TFLITE_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.tflite")
DOCS_DIR = os.path.join(ROOT_DIR, "docs")


def main():
    mean, std = load_normalization_params()
    _, _, X_test, _, _, y_test = load_and_split_dataset()
    X_test_n = normalize(X_test, mean, std)

    interpreter = tf.lite.Interpreter(model_path=TFLITE_PATH)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]
    in_scale, in_zero_point = input_details["quantization"]
    out_scale, out_zero_point = output_details["quantization"]

    y_pred = np.zeros(len(X_test_n), dtype=np.int64)
    for i in range(len(X_test_n)):
        x_int8 = np.round(X_test_n[i] / in_scale + in_zero_point).astype(np.int8)
        interpreter.set_tensor(input_details["index"], x_int8.reshape(1, -1))
        interpreter.invoke()
        y_int8 = interpreter.get_tensor(output_details["index"])[0]
        y_float = (y_int8.astype(np.float32) - out_zero_point) * out_scale
        y_pred[i] = int(np.argmax(y_float))

    acc = accuracy_score(y_test, y_pred)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, y_pred, average="macro", zero_division=0
    )
    report = classification_report(y_test, y_pred, target_names=CLASS_NAMES, zero_division=0)
    cm = confusion_matrix(y_test, y_pred)

    print(f"Quantized model test accuracy: {acc:.4f}")
    print(f"Macro precision: {precision:.4f}  recall: {recall:.4f}  f1: {f1:.4f}")
    print(report)

    fig, ax = plt.subplots(figsize=(6.5, 5.5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Purples",
                xticklabels=CLASS_NAMES, yticklabels=CLASS_NAMES, ax=ax)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title("Confusion Matrix - Quantized INT8 Model (Full Test Set)")
    fig.tight_layout()
    fig.savefig(os.path.join(DOCS_DIR, "07_quantized_confusion_matrix.png"), dpi=150)
    plt.close(fig)

    model_size = os.path.getsize(TFLITE_PATH)
    with open(os.path.join(DOCS_DIR, "quantized_evaluation_report.md"), "w") as f:
        f.write("# HeatShieldAI Quantized (INT8) Model Evaluation Report\n\n")
        f.write(f"- Model file: `heatshield_model.tflite` ({model_size} bytes, {model_size/1024:.2f} KB)\n")
        f.write(f"- Test samples: {len(X_test_n)}\n")
        f.write(f"- Input quantization: scale={in_scale:.8f}, zero_point={in_zero_point}\n")
        f.write(f"- Output quantization: scale={out_scale:.8f}, zero_point={out_zero_point}\n")
        f.write(f"- Test accuracy: {acc:.4f}\n")
        f.write(f"- Macro precision: {precision:.4f}\n")
        f.write(f"- Macro recall: {recall:.4f}\n")
        f.write(f"- Macro F1: {f1:.4f}\n\n")
        f.write("## Classification Report\n\n```\n")
        f.write(report)
        f.write("\n```\n\nSee `07_quantized_confusion_matrix.png` for the confusion matrix.\n")

    print(f"Saved quantized evaluation report to {os.path.join(DOCS_DIR, 'quantized_evaluation_report.md')}")


if __name__ == "__main__":
    main()
