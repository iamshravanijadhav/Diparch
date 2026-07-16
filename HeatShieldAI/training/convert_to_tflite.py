"""
convert_to_tflite.py
=====================
Converts the trained Keras model into a fully INT8-quantized TensorFlow
Lite model optimized for ESP32 deployment.

Why full INT8 quantization:
  - Flash: INT8 weights are 4x smaller than float32.
  - RAM: INT8 activations use 4x less tensor-arena memory than float32.
  - Speed: ESP32's Xtensa core has no FPU-friendly vector float unit
    comparable to its integer throughput; TFLite Micro's INT8 kernels are
    significantly faster than float32 kernels on this class of MCU.
  - TFLite Micro's most broadly-supported/tested kernel path on
    microcontrollers is INT8, so this maximizes compatibility.

We use full-integer quantization (inference_input_type = inference_output
_type = tf.int8), NOT just weight quantization, so the ESP32 never needs to
run any float32 math at inference time. A representative dataset (real,
normalized training samples) is required for the converter to calibrate
activation ranges.

Run: python convert_to_tflite.py
"""

import os
import numpy as np
import tensorflow as tf

from common import (
    ROOT_DIR, MODEL_OUTPUT_DIR, RANDOM_SEED,
    load_and_split_dataset, load_normalization_params, normalize,
)

KERAS_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.keras")
TFLITE_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.tflite")

REPRESENTATIVE_SAMPLE_COUNT = 500


def representative_dataset_generator(X_train_normalized):
    rng = np.random.RandomState(RANDOM_SEED)
    n = min(REPRESENTATIVE_SAMPLE_COUNT, len(X_train_normalized))
    indices = rng.choice(len(X_train_normalized), size=n, replace=False)
    for i in indices:
        sample = X_train_normalized[i:i + 1].astype(np.float32)
        yield [sample]


def main():
    print(f"Loading Keras model from {KERAS_PATH}")
    model = tf.keras.models.load_model(KERAS_PATH)

    mean, std = load_normalization_params()
    X_train, _, _, _, _, _ = load_and_split_dataset()
    X_train_n = normalize(X_train, mean, std)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = lambda: representative_dataset_generator(X_train_n)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8

    print("Running full-integer INT8 quantization...")
    tflite_model = converter.convert()

    os.makedirs(MODEL_OUTPUT_DIR, exist_ok=True)
    with open(TFLITE_PATH, "wb") as f:
        f.write(tflite_model)

    size_bytes = len(tflite_model)
    print(f"Saved quantized model to {TFLITE_PATH} ({size_bytes} bytes, {size_bytes/1024:.2f} KB)")

    # ---- Sanity-check the quantized model with the TFLite interpreter ----
    interpreter = tf.lite.Interpreter(model_content=tflite_model)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]

    print("\nInput tensor details:")
    print(f"  shape={input_details['shape']}  dtype={input_details['dtype']}")
    print(f"  quantization (scale, zero_point) = {input_details['quantization']}")
    print("Output tensor details:")
    print(f"  shape={output_details['shape']}  dtype={output_details['dtype']}")
    print(f"  quantization (scale, zero_point) = {output_details['quantization']}")

    # Quick accuracy check on a handful of test samples run through the
    # actual quantized interpreter, to confirm the .tflite file behaves
    # sanely (not a rigorous evaluation -- see evaluate_tflite.py for that).
    _, _, X_test, _, _, y_test = load_and_split_dataset()
    X_test_n = normalize(X_test, mean, std)

    in_scale, in_zero_point = input_details["quantization"]
    out_scale, out_zero_point = output_details["quantization"]

    correct = 0
    n_check = min(200, len(X_test_n))
    for i in range(n_check):
        x = X_test_n[i]
        x_int8 = np.round(x / in_scale + in_zero_point).astype(np.int8)
        interpreter.set_tensor(input_details["index"], x_int8.reshape(1, -1))
        interpreter.invoke()
        y_int8 = interpreter.get_tensor(output_details["index"])[0]
        y_float = (y_int8.astype(np.float32) - out_zero_point) * out_scale
        pred = int(np.argmax(y_float))
        if pred == y_test[i]:
            correct += 1

    print(f"\nQuantized model spot-check accuracy on {n_check} test samples: {correct/n_check:.4f}")


if __name__ == "__main__":
    main()
