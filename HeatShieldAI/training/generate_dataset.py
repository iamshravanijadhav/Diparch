"""
generate_dataset.py
====================
Generates a realistic, physiologically-consistent synthetic dataset for
HeatShieldAI heat-stress classification.

HOW LABELS ARE GENERATED (read this before changing anything):
----------------------------------------------------------------
Rather than sampling all five features independently at random and then
thresholding them into classes (which tends to produce unrealistic
combinations, e.g. a 45C/95%-humidity environment paired with a resting
60 BPM heart rate), this script samples features CLASS-CONDITIONALLY:

  1. For each of the four classes (SAFE, WARNING, DANGER, CRITICAL) we
     define a joint distribution over Temperature, Humidity, HeartRate and
     SpO2 that reflects what a worker's vitals and environment plausibly
     look like at that heat-stress level. The distributions for adjacent
     classes deliberately OVERLAP at their edges (e.g. the top of SAFE's
     heart-rate range overlaps the bottom of WARNING's), so the classes are
     not trivially/linearly separable -- this forces the model to learn a
     genuinely useful decision boundary instead of memorizing a threshold.
  2. HeatIndex is NEVER sampled directly -- it is always DERIVED from the
     sampled Temperature and Humidity using the real NOAA/Rothfusz Heat
     Index regression (see common.py). This keeps HeatIndex internally
     consistent with Temperature/Humidity, exactly as it would be
     on-device.
  3. Each class is generated in equal quantity (SAMPLES_PER_CLASS rows),
     giving a naturally balanced dataset.
  4. Finally, LABEL_NOISE_FRACTION (3%) of rows have their label randomly
     shifted by one adjacent class (SAFE<->WARNING<->DANGER<->CRITICAL).
     This simulates real-world label ambiguity/measurement noise (e.g. a
     borderline case a human labeler could reasonably classify either way)
     and improves the trained model's robustness and calibration. Without
     this, the synthetic dataset would be unrealistically "clean" and the
     model would be overconfident.
  5. Rows are shuffled and written to dataset/heat_stress_dataset.csv.

All physiological ranges below are chosen to stay within medically sensible
bounds (e.g. heart rate 50-190 BPM, SpO2 88-100%) and environmentally
sensible bounds for outdoor construction sites (Temperature 18-48C,
Humidity 10-98%).
"""

import os
import numpy as np
import pandas as pd

from common import (
    FEATURE_NAMES,
    CLASS_NAMES,
    RANDOM_SEED,
    heat_index_celsius,
)

SAMPLES_PER_CLASS = 4000  # 4 classes x 4000 = 16,000 total rows
LABEL_NOISE_FRACTION = 0.03

OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "dataset",
    "heat_stress_dataset.csv",
)

# Global medically/environmentally sensible clip bounds (applied after
# class-conditional sampling so no class can ever produce an impossible
# value, even in its distribution tails).
GLOBAL_BOUNDS = {
    "Temperature": (18.0, 48.0),
    "Humidity": (10.0, 98.0),
    "HeartRate": (50.0, 190.0),
    "SpO2": (88.0, 100.0),
}

# Class-conditional joint distributions: (mean, std) per feature.
# Ranges deliberately overlap between neighboring classes.
#
# Temperature/Humidity were validated against the NWS/OSHA-NIOSH Heat Index
# chart (Caution 80-90F, Extreme Caution 91-103F, Danger 103-124F, Extreme
# Danger 125F+) by running each class's (mean T, mean RH) through this
# project's own heat_index_celsius() -- SAFE lands right at the ~80F Caution
# boundary, WARNING in Extreme Caution, DANGER in Danger, CRITICAL above
# Extreme Danger. These already matched real-world guidance, so they are
# unchanged.
#
# HeartRate previously assumed SAFE tops out ~mid-90s BPM (basically resting
# heart rate only), which pushed a perfectly normal ACTIVE-WORK heart rate
# like 100 BPM into WARNING territory. That contradicts real physiology:
#   - Normal resting HR is 60-100 BPM (AHA).
#   - Construction/manual-labor studies show sustained HR routinely 100-140
#     BPM during ordinary physical work with no heat distress involved
#     (mean HR increase of ~50 BPM over resting baseline during simulated
#     construction tasks -- Alabdulwahab & Kachanathu, PMC4847018).
#   - ACGIH's actual heat-strain criteria are much higher: sustained HR
#     above (180 - age) BPM (~140-145 BPM for a worker in their late 30s)
#     indicates excessive heat strain, and a 1-minute recovery HR above
#     120 BPM after peak effort is a separate excessive-strain indicator.
# HeartRate distributions below are rebased on those figures so a normal
# working heart rate no longer reads as a warning, and WARNING/DANGER/
# CRITICAL instead track actual physiological heat-strain escalation.
CLASS_DISTRIBUTIONS = {
    "SAFE": {
        "Temperature": (26.0, 3.5),
        "Humidity": (45.0, 16.0),
        "HeartRate": (90.0, 15.0),
        "SpO2": (98.0, 1.0),
    },
    "WARNING": {
        "Temperature": (32.0, 3.0),
        "Humidity": (55.0, 16.0),
        "HeartRate": (125.0, 12.0),
        "SpO2": (96.5, 1.3),
    },
    "DANGER": {
        "Temperature": (37.0, 2.8),
        "Humidity": (65.0, 15.0),
        "HeartRate": (148.0, 10.0),
        "SpO2": (94.5, 1.5),
    },
    "CRITICAL": {
        "Temperature": (41.5, 2.8),
        "Humidity": (75.0, 14.0),
        "HeartRate": (170.0, 12.0),
        "SpO2": (92.0, 2.0),
    },
}


def sample_class(rng: np.random.Generator, class_name: str, n: int) -> pd.DataFrame:
    dist = CLASS_DISTRIBUTIONS[class_name]

    temperature = rng.normal(dist["Temperature"][0], dist["Temperature"][1], n)
    humidity = rng.normal(dist["Humidity"][0], dist["Humidity"][1], n)
    heart_rate = rng.normal(dist["HeartRate"][0], dist["HeartRate"][1], n)
    spo2 = rng.normal(dist["SpO2"][0], dist["SpO2"][1], n)

    temperature = np.clip(temperature, *GLOBAL_BOUNDS["Temperature"])
    humidity = np.clip(humidity, *GLOBAL_BOUNDS["Humidity"])
    heart_rate = np.clip(heart_rate, *GLOBAL_BOUNDS["HeartRate"])
    spo2 = np.clip(spo2, *GLOBAL_BOUNDS["SpO2"])

    # Climatological realism constraint: extreme heat (>38C) rarely
    # co-occurs with near-saturation humidity in nature (very hot air masses
    # are typically dry; very humid air masses are rarely also extremely
    # hot). Taper the humidity ceiling down as temperature climbs past 38C
    # so we don't generate "unrealistic combinations" like 47C at 98% RH.
    humidity_ceiling = 98.0 - np.clip(temperature - 38.0, 0.0, None) * 2.2
    humidity_ceiling = np.clip(humidity_ceiling, 45.0, 98.0)
    humidity = np.minimum(humidity, humidity_ceiling)

    heat_index = heat_index_celsius(temperature, humidity)

    df = pd.DataFrame(
        {
            "Temperature": temperature,
            "Humidity": humidity,
            "HeartRate": heart_rate,
            "SpO2": spo2,
            "HeatIndex": heat_index,
            "Label": class_name,
        }
    )
    return df


def apply_label_noise(df: pd.DataFrame, rng: np.random.Generator, fraction: float) -> pd.DataFrame:
    class_to_idx = {c: i for i, c in enumerate(CLASS_NAMES)}
    idx_to_class = {i: c for c, i in class_to_idx.items()}

    n_noisy = int(len(df) * fraction)
    noisy_indices = rng.choice(df.index, size=n_noisy, replace=False)

    labels_idx = df["Label"].map(class_to_idx).to_numpy()
    for i in noisy_indices:
        current = labels_idx[df.index.get_loc(i)]
        direction = rng.choice([-1, 1])
        new_idx = int(np.clip(current + direction, 0, len(CLASS_NAMES) - 1))
        labels_idx[df.index.get_loc(i)] = new_idx

    df = df.copy()
    df["Label"] = [idx_to_class[i] for i in labels_idx]
    return df


def main():
    rng = np.random.default_rng(RANDOM_SEED)

    frames = [
        sample_class(rng, class_name, SAMPLES_PER_CLASS) for class_name in CLASS_NAMES
    ]
    df = pd.concat(frames, ignore_index=True)

    df = apply_label_noise(df, rng, LABEL_NOISE_FRACTION)

    # Shuffle rows
    df = df.sample(frac=1.0, random_state=RANDOM_SEED).reset_index(drop=True)

    # Round to realistic sensor precision
    df["Temperature"] = df["Temperature"].round(2)
    df["Humidity"] = df["Humidity"].round(2)
    df["HeartRate"] = df["HeartRate"].round(1)
    df["SpO2"] = df["SpO2"].round(1)
    df["HeatIndex"] = df["HeatIndex"].round(2)

    df = df[FEATURE_NAMES + ["Label"]]

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"Wrote {len(df)} rows to {OUTPUT_PATH}")
    print("\nClass balance:")
    print(df["Label"].value_counts())
    print("\nFeature summary:")
    print(df[FEATURE_NAMES].describe())


if __name__ == "__main__":
    main()
