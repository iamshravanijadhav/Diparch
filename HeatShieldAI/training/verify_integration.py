"""
verify_integration.py
======================
Automated integration checks between the Python training pipeline and the
ESP32 firmware source tree. This is what lets deploy_firmware.py assert
"the firmware is actually in sync with what was just trained" instead of
just hoping the file-copy step worked.

Checks performed:
  1. firmware/src/model.h is byte-identical to training/model_output/model.h
  2. model_params.h FEATURE_MEAN/STD exactly match normalization_params.json
  3. Feature count/order in model_params.h matches training/common.py
  4. preprocessing.cpp packs features in the documented order
  5. Class count/order in model_params.h matches training/common.py
  6. The actual .tflite's input/output tensor shapes match NUM_FEATURES/NUM_CLASSES
  7. The actual .tflite's quantization params match what's baked into model_params.h
  8. preprocessing.cpp's Heat Index formula constants match common.py's formula

Exit code 0 = all checks passed. Exit code 1 = at least one check failed
(each failure is printed with what was expected vs. found).

Run standalone:  python verify_integration.py
Run as part of:  python deploy_firmware.py
"""

import os
import re
import sys
import numpy as np
import tensorflow as tf

from common import (
    MODEL_OUTPUT_DIR, FEATURE_NAMES, CLASS_NAMES,
    load_normalization_params, locate_firmware_dir,
)

TFLITE_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.tflite")
TRAINING_MODEL_H = os.path.join(MODEL_OUTPUT_DIR, "model.h")


class CheckResults:
    def __init__(self):
        self.failures = []
        self.passed = 0

    def ok(self, desc):
        self.passed += 1
        print(f"  [PASS] {desc}")

    def fail(self, desc):
        self.failures.append(desc)
        print(f"  [FAIL] {desc}")


def _array_pattern(var_name):
    return re.compile(re.escape(var_name) + r"\[[^\]]*\]\s*=\s*\{([^}]*)\}")


def parse_float_array(text, var_name):
    m = _array_pattern(var_name).search(text)
    if not m:
        return None
    return [float(x.strip().rstrip("f")) for x in m.group(1).split(",") if x.strip()]


def parse_string_array(text, var_name):
    m = _array_pattern(var_name).search(text)
    if not m:
        return None
    return [s.strip().strip('"') for s in m.group(1).split(",") if s.strip()]


def parse_scalar_float(text, var_name):
    m = re.search(re.escape(var_name) + r"\s*=\s*([-0-9.eE]+)f?\s*;", text)
    return float(m.group(1)) if m else None


def parse_scalar_int(text, var_name):
    m = re.search(re.escape(var_name) + r"\s*=\s*(-?\d+)\s*;", text)
    return int(m.group(1)) if m else None


def parse_define_int(text, macro_name):
    m = re.search(r"#define\s+" + re.escape(macro_name) + r"\s+(-?\d+)", text)
    return int(m.group(1)) if m else None


def firmware_paths():
    src = os.path.join(locate_firmware_dir(), "src")
    return {
        "model_h": os.path.join(src, "model.h"),
        "model_params_h": os.path.join(src, "model_params.h"),
        "preprocessing_cpp": os.path.join(src, "preprocessing.cpp"),
    }


def run_checks():
    check = CheckResults()
    firmware_dir = locate_firmware_dir()
    paths = firmware_paths()
    print(f"Firmware project: {firmware_dir}")
    print()

    # ---- 1. model.h byte-identical ----
    if os.path.isfile(TRAINING_MODEL_H) and os.path.isfile(paths["model_h"]):
        with open(TRAINING_MODEL_H, "rb") as f:
            training_bytes = f.read()
        with open(paths["model_h"], "rb") as f:
            firmware_bytes = f.read()
        if training_bytes == firmware_bytes:
            check.ok("firmware src/model.h is byte-identical to training/model_output/model.h")
        else:
            check.fail("firmware src/model.h DIFFERS from training/model_output/model.h "
                       "-- run generate_model_header.py to redeploy")
    else:
        check.fail("model.h missing from training/model_output/ or firmware/src/ "
                   "-- run the training pipeline through generate_model_header.py")

    if not os.path.isfile(paths["model_params_h"]):
        check.fail("model_params.h missing from firmware/src/ -- run generate_model_header.py")
        _report(check)
        return check

    with open(paths["model_params_h"]) as f:
        params_text = f.read()

    # ---- 2. normalization values ----
    mean_json, std_json = load_normalization_params()
    mean_h = parse_float_array(params_text, "HEATSHIELD_FEATURE_MEAN")
    std_h = parse_float_array(params_text, "HEATSHIELD_FEATURE_STD")
    if mean_h is not None and np.allclose(mean_h, mean_json, atol=1e-5):
        check.ok("model_params.h FEATURE_MEAN matches normalization_params.json")
    else:
        check.fail(f"model_params.h FEATURE_MEAN {mean_h} != normalization_params.json {list(mean_json)}")
    if std_h is not None and np.allclose(std_h, std_json, atol=1e-5):
        check.ok("model_params.h FEATURE_STD matches normalization_params.json")
    else:
        check.fail(f"model_params.h FEATURE_STD {std_h} != normalization_params.json {list(std_json)}")

    # ---- 3. feature count/order ----
    num_features_h = parse_define_int(params_text, "HEATSHIELD_NUM_FEATURES")
    if num_features_h == len(FEATURE_NAMES):
        check.ok(f"HEATSHIELD_NUM_FEATURES ({num_features_h}) matches training FEATURE_NAMES count")
    else:
        check.fail(f"HEATSHIELD_NUM_FEATURES ({num_features_h}) != len(FEATURE_NAMES) ({len(FEATURE_NAMES)})")

    feature_comment_order = re.findall(r"//\s+\[\d+\]\s+(\w+)", params_text)
    if feature_comment_order == FEATURE_NAMES:
        check.ok(f"model_params.h feature order matches training: {FEATURE_NAMES}")
    else:
        check.fail(f"model_params.h feature order {feature_comment_order} != FEATURE_NAMES {FEATURE_NAMES}")

    # ---- 4. preprocessing.cpp packs features in the expected order ----
    if os.path.isfile(paths["preprocessing_cpp"]):
        with open(paths["preprocessing_cpp"]) as f:
            preprocessing_text = f.read()
        assignments = re.findall(r"rawOut\[(\d+)\]\s*=\s*([^;]+);", preprocessing_text)
        pack_order = [expr.strip() for _, expr in sorted(assignments, key=lambda p: int(p[0]))]
        expected_prefix = ["temperatureC", "humidityPct", "heartRateBpm", "spo2Pct"]
        order_ok = (len(pack_order) == 5 and pack_order[:4] == expected_prefix
                    and pack_order[4].startswith("computeHeatIndex"))
        if order_ok:
            check.ok("preprocessing.cpp packFeatures() order: Temperature, Humidity, HeartRate, SpO2, HeatIndex")
        else:
            check.fail(f"preprocessing.cpp packFeatures() order looks wrong: {pack_order}")

        # ---- 8. Heat Index formula constants present ----
        required_constants = ["17.27", "237.7", "6.105", "0.33", "0.70"]
        missing = [c for c in required_constants if c not in preprocessing_text]
        if not missing:
            check.ok("preprocessing.cpp Heat Index formula constants match training/common.py")
        else:
            check.fail(f"preprocessing.cpp missing expected Heat Index constants: {missing}")
    else:
        check.fail("preprocessing.cpp missing from firmware/src/")

    # ---- 5. class count/order ----
    num_classes_h = parse_define_int(params_text, "HEATSHIELD_NUM_CLASSES")
    if num_classes_h == len(CLASS_NAMES):
        check.ok(f"HEATSHIELD_NUM_CLASSES ({num_classes_h}) matches training CLASS_NAMES count")
    else:
        check.fail(f"HEATSHIELD_NUM_CLASSES ({num_classes_h}) != len(CLASS_NAMES) ({len(CLASS_NAMES)})")

    class_names_h = parse_string_array(params_text, "HEATSHIELD_CLASS_NAMES")
    if class_names_h == CLASS_NAMES:
        check.ok(f"HEATSHIELD_CLASS_NAMES order matches training: {CLASS_NAMES}")
    else:
        check.fail(f"HEATSHIELD_CLASS_NAMES {class_names_h} != CLASS_NAMES {CLASS_NAMES}")

    # ---- 6/7. .tflite tensor shapes + quantization vs model_params.h ----
    if os.path.isfile(TFLITE_PATH):
        interpreter = tf.lite.Interpreter(model_path=TFLITE_PATH)
        interpreter.allocate_tensors()
        in_details = interpreter.get_input_details()[0]
        out_details = interpreter.get_output_details()[0]

        expected_in_shape = (1, len(FEATURE_NAMES))
        expected_out_shape = (1, len(CLASS_NAMES))
        if tuple(int(d) for d in in_details["shape"]) == expected_in_shape:
            check.ok(f".tflite input tensor shape {expected_in_shape} matches NUM_FEATURES")
        else:
            check.fail(f".tflite input shape {tuple(in_details['shape'])} != expected {expected_in_shape}")
        if tuple(int(d) for d in out_details["shape"]) == expected_out_shape:
            check.ok(f".tflite output tensor shape {expected_out_shape} matches NUM_CLASSES")
        else:
            check.fail(f".tflite output shape {tuple(out_details['shape'])} != expected {expected_out_shape}")

        in_scale, in_zp = in_details["quantization"]
        out_scale, out_zp = out_details["quantization"]
        in_scale_h = parse_scalar_float(params_text, "HEATSHIELD_INPUT_SCALE")
        in_zp_h = parse_scalar_int(params_text, "HEATSHIELD_INPUT_ZERO_POINT")
        out_scale_h = parse_scalar_float(params_text, "HEATSHIELD_OUTPUT_SCALE")
        out_zp_h = parse_scalar_int(params_text, "HEATSHIELD_OUTPUT_ZERO_POINT")

        if in_scale_h is not None and abs(in_scale_h - in_scale) < 1e-6 and in_zp_h == in_zp:
            check.ok(f"Input quantization matches .tflite: scale={in_scale:.8f} zero_point={in_zp}")
        else:
            check.fail(f"Input quantization mismatch: .tflite=({in_scale},{in_zp}) "
                       f"model_params.h=({in_scale_h},{in_zp_h})")

        if out_scale_h is not None and abs(out_scale_h - out_scale) < 1e-6 and out_zp_h == out_zp:
            check.ok(f"Output quantization matches .tflite: scale={out_scale:.8f} zero_point={out_zp}")
        else:
            check.fail(f"Output quantization mismatch: .tflite=({out_scale},{out_zp}) "
                       f"model_params.h=({out_scale_h},{out_zp_h})")
    else:
        check.fail(f".tflite not found at {TFLITE_PATH}")

    _report(check)
    return check


def _report(check):
    print()
    print(f"{check.passed} passed, {len(check.failures)} failed")
    if check.failures:
        print("\nFAILURES:")
        for f in check.failures:
            print(f"  - {f}")
    else:
        print("All integration checks passed.")


def main():
    check = run_checks()
    return 1 if check.failures else 0


if __name__ == "__main__":
    sys.exit(main())
