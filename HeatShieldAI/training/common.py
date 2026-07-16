"""
common.py
=========
Shared constants and helper functions used across the HeatShieldAI training
pipeline (dataset generation, training, evaluation, quantization, header
generation). Keeping these in one place guarantees that the Heat Index
formula and feature ordering are IDENTICAL everywhere they are used, which
is required so the ESP32 firmware's preprocessing matches Python exactly.

NOTE: The Heat Index formula implemented here is re-implemented identically
in C++ in firmware/HeatShieldAI/src/preprocessing.cpp. If you ever change
this function, update the C++ version too.
"""

import os
import json
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Feature ordering. This exact order is used by the trained model's input
# tensor, the normalization parameters, and the ESP32 firmware. Additional
# future features (GPS, WBGT, accelerometer, hydration, age, exposure time)
# should be appended to the END of this list so existing deployed models /
# firmware remain compatible until they are retrained/reflashed together.
# ---------------------------------------------------------------------------
FEATURE_NAMES = [
    "Temperature",   # degrees Celsius
    "Humidity",      # relative humidity, percent
    "HeartRate",     # beats per minute
    "SpO2",          # blood oxygen saturation, percent
    "HeatIndex",     # degrees Celsius, derived from Temperature + Humidity
]

CLASS_NAMES = ["SAFE", "WARNING", "DANGER", "CRITICAL"]
NUM_CLASSES = len(CLASS_NAMES)
NUM_FEATURES = len(FEATURE_NAMES)

RANDOM_SEED = 42


def celsius_to_fahrenheit(temp_c):
    """Convert Celsius to Fahrenheit (works on scalars or numpy arrays)."""
    return temp_c * 9.0 / 5.0 + 32.0


def fahrenheit_to_celsius(temp_f):
    """Convert Fahrenheit to Celsius (works on scalars or numpy arrays)."""
    return (temp_f - 32.0) * 5.0 / 9.0


def heat_index_celsius(temp_c, rh):
    """
    Heat Index ("feels like" temperature) in degrees Celsius, computed from
    ambient Temperature (C) and Relative Humidity (%).

    We deliberately use the Australian Bureau of Meteorology "Apparent
    Temperature" (AT) formula here instead of the more commonly-cited NOAA/
    Rothfusz regression:

        e  = (RH / 100) * 6.105 * exp(17.27 * T / (237.7 + T))   [vapor
                                                                    pressure, hPa]
        AT = T + 0.33 * e - 0.70 * ws - 4.00

    Reasons for this choice:
      1. The Rothfusz regression is a polynomial curve FIT only validated
         over roughly 70-115F / 40-100% RH. HeatShieldAI needs to cover
         construction-site extremes up to 48C (118F), and outside its
         fitted domain the Rothfusz polynomial diverges to physically
         absurd values (300F+) -- we hit this in practice while building
         the dataset. Clamping it destroys real signal right where it
         matters most (the CRITICAL class).
      2. The AT formula is a single continuous closed-form expression
         (no piecewise branches/boundary corrections), monotonic and
         numerically well-behaved across our entire sensor range, and
         stays physically plausible even at extreme corners (48C/98%RH
         -> ~80C "feels like", not 350C).
      3. It is trivial to reproduce bit-for-bit identically on the ESP32
         using a single call to expf() from math.h -- important for the
         "preprocessing must be exactly identical" requirement.

    `ws` is wind speed in m/s. HeatShieldAI has no anemometer, so we assume
    calm conditions (ws=0), which is the conservative (worst-case, no
    evaporative cooling from wind) assumption. If a wind speed sensor is
    added in the future, wire its reading into the `ws` parameter here AND
    in the matching C++ function.
    """
    temp_c = np.asarray(temp_c, dtype=np.float64)
    rh = np.asarray(rh, dtype=np.float64)
    ws = 0.0

    vapor_pressure = (rh / 100.0) * 6.105 * np.exp(17.27 * temp_c / (237.7 + temp_c))
    apparent_temp = temp_c + 0.33 * vapor_pressure - 0.70 * ws - 4.00
    return apparent_temp


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_PATH = os.path.join(ROOT_DIR, "dataset", "heat_stress_dataset.csv")
MODEL_OUTPUT_DIR = os.path.join(ROOT_DIR, "training", "model_output")
NORM_PARAMS_PATH = os.path.join(MODEL_OUTPUT_DIR, "normalization_params.json")


def locate_firmware_dir():
    """
    Finds the PlatformIO firmware project directory (the one containing
    platformio.ini), so the deployment scripts keep working even if the
    firmware project gets moved/relocated on disk (as it has been at least
    once in this project's history -- see README "Deployment Workflow").

    Resolution order:
      1. HEATSHIELD_FIRMWARE_DIR environment variable, if set and valid.
      2. <project_root>/firmware/HeatShieldAI  (the originally documented
         in-tree layout).
      3. <project_root's parent>/firmware/HeatShieldAI  (where the firmware
         project actually ended up after being moved out of the project
         tree during development).

    Raises FileNotFoundError with an actionable message if none of these
    contain a platformio.ini, rather than silently writing generated files
    into a stale/nonexistent directory.
    """
    candidates = []

    env_override = os.environ.get("HEATSHIELD_FIRMWARE_DIR")
    if env_override:
        candidates.append(env_override)

    candidates.append(os.path.join(ROOT_DIR, "firmware", "HeatShieldAI"))
    candidates.append(os.path.normpath(os.path.join(ROOT_DIR, "..", "firmware", "HeatShieldAI")))

    for candidate in candidates:
        if os.path.isfile(os.path.join(candidate, "platformio.ini")):
            return os.path.normpath(candidate)

    raise FileNotFoundError(
        "Could not locate the firmware PlatformIO project (no platformio.ini "
        "found). Tried:\n  " + "\n  ".join(candidates) +
        "\nSet the HEATSHIELD_FIRMWARE_DIR environment variable to the "
        "firmware project's root (the folder containing platformio.ini)."
    )


FIRMWARE_DIR = None  # resolved lazily via locate_firmware_dir() where needed


def locate_pio_executable():
    """
    Finds the PlatformIO CLI executable so deploy_firmware.py can invoke
    `pio run` without requiring the user to have `pio` on PATH (the
    PlatformIO VSCode extension installs its own isolated Python env and
    does not always add it to PATH).

    Resolution order:
      1. HEATSHIELD_PIO_PATH environment variable, if set.
      2. `pio` on PATH (shutil.which).
      3. The standard per-user PlatformIO Core install location
         (~/.platformio/penv/{Scripts,bin}/pio{.exe,}).
    """
    import shutil

    env_override = os.environ.get("HEATSHIELD_PIO_PATH")
    if env_override and os.path.isfile(env_override):
        return env_override

    found = shutil.which("pio")
    if found:
        return found

    home = os.path.expanduser("~")
    candidates = [
        os.path.join(home, ".platformio", "penv", "Scripts", "pio.exe"),  # Windows
        os.path.join(home, ".platformio", "penv", "bin", "pio"),          # macOS/Linux
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate

    raise FileNotFoundError(
        "Could not locate the PlatformIO CLI ('pio'). Tried PATH and:\n  " +
        "\n  ".join(candidates) +
        "\nInstall PlatformIO Core, or set HEATSHIELD_PIO_PATH to the pio executable."
    )

# Fractions used for the train/validation/test split. Kept here (not just in
# train_model.py) so convert_to_tflite.py can reconstruct the IDENTICAL
# training split for its representative dataset without any risk of drift.
TRAIN_FRACTION = 0.70
VAL_FRACTION = 0.15
TEST_FRACTION = 0.15


def load_and_split_dataset(csv_path=DATASET_PATH):
    """
    Loads the dataset CSV and performs a stratified 70/15/15 train/val/test
    split using RANDOM_SEED. Returns raw (un-normalized) feature arrays and
    integer-encoded labels:

        X_train, X_val, X_test, y_train, y_val, y_test
    """
    from sklearn.model_selection import train_test_split

    df = pd.read_csv(csv_path)
    class_to_idx = {c: i for i, c in enumerate(CLASS_NAMES)}
    X = df[FEATURE_NAMES].to_numpy(dtype=np.float32)
    y = df["Label"].map(class_to_idx).to_numpy(dtype=np.int64)

    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=(1.0 - TRAIN_FRACTION), random_state=RANDOM_SEED, stratify=y
    )
    relative_test_fraction = TEST_FRACTION / (VAL_FRACTION + TEST_FRACTION)
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=relative_test_fraction,
        random_state=RANDOM_SEED, stratify=y_temp,
    )
    return X_train, X_val, X_test, y_train, y_val, y_test


def compute_normalization_params(X_train):
    """Computes per-feature mean/std from TRAINING data only (no leakage)."""
    mean = X_train.mean(axis=0)
    std = X_train.std(axis=0)
    # Guard against a future constant feature causing division by zero.
    std = np.where(std < 1e-6, 1.0, std)
    return mean.astype(np.float32), std.astype(np.float32)


def save_normalization_params(mean, std, path=NORM_PARAMS_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "feature_names": FEATURE_NAMES,
        "mean": [float(v) for v in mean],
        "std": [float(v) for v in std],
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def load_normalization_params(path=NORM_PARAMS_PATH):
    with open(path, "r") as f:
        payload = json.load(f)
    return np.array(payload["mean"], dtype=np.float32), np.array(payload["std"], dtype=np.float32)


def normalize(X, mean, std):
    return (X - mean) / std
