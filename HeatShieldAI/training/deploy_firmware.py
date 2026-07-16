"""
deploy_firmware.py
===================
ONE-COMMAND deployment: run this after (re)training a model and it takes
care of everything needed to get the new model onto the firmware and
confirm it actually builds.

    python deploy_firmware.py

What it does, in order (matching the required workflow exactly):
  1. Quantize to INT8 if the .tflite is missing or stale relative to the
     trained .keras model (convert_to_tflite.py).
  2. Copy model.h into the firmware project + regenerate model_params.h
     from normalization_params.json (generate_model_header.py).
  3. Verify feature order / class mapping / quantization params are
     consistent between Python and firmware (verify_integration.py).
  4. Rebuild the PlatformIO project (`pio run`).
  5. Print a clear pass/fail report; non-zero exit code if anything failed,
     so this is safe to drop into a CI pipeline or pre-flash checklist.

Steps 1-3 are skipped with a clear message (not silently) if their inputs
are missing -- e.g. if you haven't trained a model yet, this tells you to
run train_model.py first instead of failing with a confusing traceback.

Flags:
  --skip-build      Do everything except the PlatformIO rebuild (faster
                     inner loop while iterating on the model).
  --force-convert   Re-run INT8 quantization even if the .tflite looks
                     up to date.
"""

import argparse
import os
import subprocess
import sys
import time

from common import MODEL_OUTPUT_DIR, locate_firmware_dir, locate_pio_executable

TRAINING_DIR = os.path.dirname(os.path.abspath(__file__))
KERAS_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.keras")
TFLITE_PATH = os.path.join(MODEL_OUTPUT_DIR, "heatshield_model.tflite")


class Step:
    def __init__(self, name):
        self.name = name
        self.status = "SKIPPED"
        self.detail = ""
        self.duration_s = 0.0


def run_python_script(script_name):
    """Runs a sibling training/ script in a subprocess with live output,
    using the same interpreter (so it has tensorflow etc. available)."""
    script_path = os.path.join(TRAINING_DIR, script_name)
    result = subprocess.run(
        [sys.executable, script_path],
        cwd=TRAINING_DIR,
    )
    return result.returncode == 0


def step_quantize(steps, force):
    step = Step("Quantize (.keras -> .tflite)")
    steps.append(step)
    start = time.time()

    if not os.path.isfile(KERAS_PATH):
        step.status = "FAILED"
        step.detail = f"No trained model found at {KERAS_PATH}. Run train_model.py first."
        step.duration_s = time.time() - start
        return False

    needs_convert = (
        force
        or not os.path.isfile(TFLITE_PATH)
        or os.path.getmtime(KERAS_PATH) > os.path.getmtime(TFLITE_PATH)
    )
    if not needs_convert:
        step.status = "SKIPPED"
        step.detail = ".tflite is already up to date relative to .keras"
        step.duration_s = time.time() - start
        return True

    print("\n=== [1/4] Quantizing model to INT8 ===")
    ok = run_python_script("convert_to_tflite.py")
    step.status = "PASSED" if ok else "FAILED"
    step.detail = "" if ok else "convert_to_tflite.py exited with an error (see output above)"
    step.duration_s = time.time() - start
    return ok


def step_generate_headers(steps):
    step = Step("Generate + deploy model.h / model_params.h")
    steps.append(step)
    start = time.time()

    if not os.path.isfile(TFLITE_PATH):
        step.status = "FAILED"
        step.detail = f"No quantized model found at {TFLITE_PATH}"
        step.duration_s = time.time() - start
        return False

    print("\n=== [2/4] Generating model.h / model_params.h into firmware ===")
    ok = run_python_script("generate_model_header.py")
    step.status = "PASSED" if ok else "FAILED"
    step.detail = "" if ok else "generate_model_header.py exited with an error (see output above)"
    step.duration_s = time.time() - start
    return ok


def step_verify(steps):
    step = Step("Verify Python <-> firmware integration")
    steps.append(step)
    start = time.time()

    print("\n=== [3/4] Verifying integration (feature order, class mapping, quantization) ===")
    import verify_integration
    check = verify_integration.run_checks()
    ok = not check.failures
    step.status = "PASSED" if ok else "FAILED"
    step.detail = "" if ok else f"{len(check.failures)} integration check(s) failed (see above)"
    step.duration_s = time.time() - start
    return ok


def step_build(steps):
    step = Step("Rebuild PlatformIO project")
    steps.append(step)
    start = time.time()

    print("\n=== [4/4] Rebuilding PlatformIO firmware ===")
    try:
        firmware_dir = locate_firmware_dir()
        pio = locate_pio_executable()
    except FileNotFoundError as e:
        step.status = "FAILED"
        step.detail = str(e)
        step.duration_s = time.time() - start
        return False

    result = subprocess.run([pio, "run"], cwd=firmware_dir)
    ok = result.returncode == 0
    step.status = "PASSED" if ok else "FAILED"
    step.detail = "" if ok else f"`pio run` exited with code {result.returncode} (see output above)"
    step.duration_s = time.time() - start
    return ok


def print_report(steps, overall_ok):
    print("\n" + "=" * 60)
    print("DEPLOYMENT REPORT")
    print("=" * 60)
    for step in steps:
        marker = {"PASSED": "[OK]  ", "FAILED": "[FAIL]", "SKIPPED": "[SKIP]"}[step.status]
        print(f"{marker} {step.name} ({step.duration_s:.1f}s)")
        if step.detail:
            print(f"        {step.detail}")
    print("-" * 60)
    build_step = next((s for s in steps if s.name == "Rebuild PlatformIO project"), None)
    build_verified = build_step is not None and build_step.status == "PASSED"

    if overall_ok and build_verified:
        print("RESULT: SUCCESS -- firmware is up to date and builds cleanly.")
    elif overall_ok:
        print("RESULT: SUCCESS -- firmware files are up to date and internally consistent "
              "(build was skipped with --skip-build, not verified this run).")
    if overall_ok:
        try:
            firmware_dir = locate_firmware_dir()
            bin_path = os.path.join(firmware_dir, ".pio", "build", "esp32dev", "firmware.bin")
            if os.path.isfile(bin_path):
                label = "Binary" if build_verified else "Binary (from a previous build)"
                print(f"{label}: {bin_path} ({os.path.getsize(bin_path)} bytes)")
                print("Next: pio run --target upload  (from the firmware directory)")
        except FileNotFoundError:
            pass
    else:
        print("RESULT: FAILED -- see the [FAIL] step(s) above for what to fix.")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="One-command model -> firmware deployment.")
    parser.add_argument("--skip-build", action="store_true",
                         help="Do everything except the PlatformIO rebuild.")
    parser.add_argument("--force-convert", action="store_true",
                         help="Re-run INT8 quantization even if the .tflite looks up to date.")
    args = parser.parse_args()

    steps = []
    ok = step_quantize(steps, args.force_convert)
    if ok:
        ok = step_generate_headers(steps)
    if ok:
        ok = step_verify(steps)
    if ok and not args.skip_build:
        ok = step_build(steps)
    elif ok and args.skip_build:
        steps.append(Step("Rebuild PlatformIO project"))  # left as SKIPPED

    print_report(steps, ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
