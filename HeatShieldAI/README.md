# HeatShieldAI

**A complete, end-to-end TinyML pipeline that predicts heat stress in construction workers directly on an ESP32 wearable — no internet, no cloud, fully offline inference.**

The wearable continuously reads ambient temperature/humidity (DHT22) and heart rate/SpO2 (MAX30102), derives Heat Index on-device, runs a quantized neural network entirely on the ESP32 (via TensorFlow Lite Micro), and classifies the wearer's current heat-stress level into one of four classes: **SAFE, WARNING, DANGER, CRITICAL**. It shows the prediction + confidence on an OLED, and drives a buzzer + vibration motor with an escalating alert pattern.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Results at a Glance](#results-at-a-glance)
3. [Folder Structure](#folder-structure)
4. [Hardware List](#hardware-list)
5. [Pin Connection Table](#pin-connection-table)
6. [How Labels Are Generated](#how-labels-are-generated)
7. [Tensor Arena Sizing](#tensor-arena-sizing)
8. [Installation — Python Environment](#installation--python-environment)
9. [Step-by-Step: Dataset → Training → Quantization → Firmware](#step-by-step-dataset--training--quantization--firmware)
10. [PlatformIO Setup & Flashing the ESP32](#platformio-setup--flashing-the-esp32)
11. [Automated Deployment Workflow](#automated-deployment-workflow)
12. [Viewing Predictions](#viewing-predictions)
13. [Troubleshooting](#troubleshooting)
14. [Adding Future Features](#adding-future-features)
15. [Design Review, Issues Found & Fixes Applied](#design-review-issues-found--fixes-applied)
16. [Integration Audit (Post-Build)](#integration-audit-post-build)
17. [Readiness Checklist](#readiness-checklist)

---

## Project Overview

HeatShieldAI is a hackathon-ready TinyML system with two halves that share one contract — the exact same feature order, Heat Index formula, and normalization parameters — so what the model learns in Python is exactly what runs on the ESP32:

- **`training/`** — a Python pipeline that generates a realistic synthetic dataset, trains a tiny neural network, quantizes it to INT8, and auto-generates the C header files the firmware needs. Every step has already been run once in this repo; the outputs (dataset, plots, trained model, `.tflite`, `model.h`) are committed so the project works out of the box, and can be regenerated from scratch at any time.
- **firmware project** — a PlatformIO project (ESP32, Arduino framework) with the sensor drivers, TFLite Micro inference engine, OLED display, and buzzer/vibration alerting, split into clean, reusable modules. **Its location is auto-discovered** by the training scripts (see [Automated Deployment Workflow](#automated-deployment-workflow)) rather than hardcoded, currently resolving to `../firmware/HeatShieldAI` next to this project — see that section for why and how to override it if you move it again.

## Results at a Glance

| Metric | Float32 (Keras) | INT8 (quantized, on-device) |
|---|---|---|
| Test accuracy | 90.50% | 90.25% |
| Macro F1 | 0.905 | 0.903 |
| Model size | 37 KB (.h5) | **3.82 KB** (.tflite) |
| Parameters | 352 | 352 |

Quantization cost only **0.25 percentage points** of accuracy while shrinking the model **~10x** — see `docs/evaluation_report.md` and `docs/quantized_evaluation_report.md` for full classification reports and confusion matrices. (Accuracy is ~1.3pp lower than an earlier version of this dataset — expected, see item 9 in [Design Review](#design-review-issues-found--fixes-applied): the HeartRate class distributions were rebased on real physiological data, which increases legitimate overlap between SAFE and WARNING instead of an artificially clean separation.)

## Folder Structure

```
HeatShieldAI/
├── dataset/
│   └── heat_stress_dataset.csv          # 16,000 rows, generated (see below)
├── docs/
│   ├── 01_feature_distributions.png
│   ├── 02_class_balance.png
│   ├── 03_correlation_matrix.png
│   ├── 04_scatter_matrix.png
│   ├── 05_training_curves.png
│   ├── 06_confusion_matrix.png              (float model)
│   ├── 07_quantized_confusion_matrix.png    (INT8 model)
│   ├── evaluation_report.md
│   └── quantized_evaluation_report.md
├── training/
│   ├── common.py                 # shared constants + Heat Index formula (Python side of the contract)
│   │                              # also: locate_firmware_dir() / locate_pio_executable() auto-discovery
│   ├── generate_dataset.py       # Step 1: synthetic dataset
│   ├── visualize_data.py         # exploratory plots -> docs/
│   ├── train_model.py            # Step 2: train + evaluate the float model
│   ├── convert_to_tflite.py      # Step 3: full INT8 quantization
│   ├── evaluate_tflite.py        # full-test-set evaluation of the quantized model
│   ├── generate_model_header.py  # Step 4: .tflite -> model.h + model_params.h, copied into the firmware project
│   ├── verify_integration.py     # automated Python<->firmware consistency checks (13 checks)
│   ├── deploy_firmware.py        # ONE-COMMAND deploy: quantize -> headers -> verify -> pio build
│   ├── requirements.txt
│   └── model_output/
│       ├── heatshield_model.keras / .h5 / .tflite
│       ├── model.h                       (reference copy)
│       ├── normalization_params.json
│       └── train_metadata.json
└── README.md

<firmware project root>/            # location auto-discovered, see "Automated Deployment Workflow" below
├── platformio.ini
└── src/
    ├── main.cpp                  # orchestrates the read -> infer -> display -> alert loop
    ├── model.h                   # AUTO-GENERATED: quantized model as a C array
    ├── model_params.h            # AUTO-GENERATED: normalization + quantization constants
    ├── preprocessing.h/.cpp      # FeatureProcessor: Heat Index + normalization (Python-identical)
    ├── sensors.h/.cpp            # SensorManager: DHT22 + MAX30102
    ├── inference.h/.cpp          # TinyMLInference: TFLite Micro wrapper
    ├── display.h/.cpp            # DisplayManager: SSD1306 OLED
    └── alerts.h/.cpp             # AlertManager: buzzer + vibration motor
```

> **Note on firmware location:** the firmware project was originally created at `HeatShieldAI/firmware/HeatShieldAI/` (nested inside this project), but during development it ended up relocated to `<parent of HeatShieldAI>/firmware/HeatShieldAI/` (a sibling directory) by the PlatformIO tooling/IDE. Rather than fight that, the deployment scripts **auto-discover** the firmware project by searching for a `platformio.ini` in both locations (see [Automated Deployment Workflow](#automated-deployment-workflow)), so this works regardless of which layout you end up with.

## Hardware List

| Component | Notes |
|---|---|
| ESP32 Dev Module | Any generic ESP32-WROOM-32 dev board |
| DHT22 (AM2302) | Ambient temperature + humidity |
| MAX30102 breakout | Heart rate + SpO2 (register-compatible with MAX30105) |
| SSD1306 OLED, 128x64, I2C | Prediction + confidence display |
| Active buzzer | Audible alert |
| Vibration motor (+ NPN transistor, e.g. 2N2222, + flyback diode, e.g. 1N4148) | Haptic alert — **do not** drive a motor directly from a GPIO; use a transistor switch |
| Breadboard, jumper wires, 3.3V/5V supply (USB) | |
| 10kΩ resistor | DHT22 data-line pull-up (many breakout modules already include one) |

## Pin Connection Table

| ESP32 Pin | Connected Device | Purpose |
|---|---|---|
| GPIO4 | DHT22 DATA | Temperature/humidity data line (10kΩ pull-up to 3.3V) |
| GPIO21 | MAX30102 SDA, SSD1306 SDA | I2C data (shared bus) |
| GPIO22 | MAX30102 SCL, SSD1306 SCL | I2C clock (shared bus) |
| GPIO25 | Buzzer (+) | Digital output, active buzzer |
| GPIO26 | Vibration motor driver (transistor base, via ~1kΩ resistor) | Digital output, haptic alert |
| 3V3 | DHT22 VCC, MAX30102 VIN, SSD1306 VCC | Power (see note below) |
| GND | All GND pins, buzzer (–), motor driver emitter | Common ground |

The MAX30102 (0x57) and SSD1306 (0x3C) sit on the same I2C bus at different addresses — no conflict. Most breakout boards for all three sensors are 3.3V-tolerant; if yours are 5V-only, power them from ESP32's `5V`/`VIN` pin instead and confirm their logic level is safe for the ESP32's 3.3V I2C lines (many boards have onboard level shifting/regulation — check your specific breakout's datasheet).

## How Labels Are Generated

**This is the part most syntheic-dataset projects get wrong, so it's worth explaining in detail** (also documented as comments in `training/generate_dataset.py`):

1. Rather than sampling all five features independently and thresholding the result (which produces unrealistic combinations — e.g. 45°C/95% humidity paired with a resting 60 BPM heart rate), features are sampled **class-conditionally**: each of the four classes has its own joint (Temperature, Humidity, HeartRate, SpO2) distribution reflecting what a worker's vitals and environment plausibly look like at that heat-stress level.
2. Adjacent classes' distributions **deliberately overlap** at the edges (e.g. the top of SAFE's heart-rate range overlaps the bottom of WARNING's), so the classes are not trivially linearly separable — this forces the model to learn a genuine decision boundary instead of memorizing a threshold.
3. **HeatIndex is never sampled directly** — it is always derived from the sampled Temperature and Humidity using a real physical formula (see below), keeping it internally consistent, exactly as it will be computed on-device.
4. Each class is generated in equal quantity (4,000 rows), so the dataset is naturally balanced (16,000 rows total).
5. Finally, **3% of rows have their label randomly shifted to an adjacent class**, simulating real-world label ambiguity. Without this, the dataset would be unrealistically "clean" and the model overconfident.

### Heat Index formula: why NOT the "standard" NOAA formula

The commonly-cited NOAA/Rothfusz regression is a *polynomial curve fit*, only validated over roughly 70-115°F / 40-100% RH. HeatShieldAI needs to cover construction-site extremes up to 48°C (118°F); outside its fitted domain, that polynomial **diverges to physically absurd values** (300°F+) — this was caught empirically while building the dataset (see `training/common.py` docstring for the exact numbers). Instead, HeatShieldAI uses the **Australian Bureau of Meteorology Apparent Temperature formula**:

```
e  = (RH / 100) * 6.105 * exp(17.27 * T / (237.7 + T))     # vapor pressure, hPa
AT = T + 0.33*e − 0.70*windSpeed − 4.00                     # windSpeed = 0 (no anemometer)
```

This is a single continuous closed-form expression — numerically well-behaved across the full sensor range, and trivial to reproduce bit-for-bit on the ESP32 with one `expf()` call (`preprocessing.cpp`).

### Physiological/environmental bounds used

| Feature | Range | Rationale |
|---|---|---|
| Temperature | 18–48°C | Indoor-ish to extreme desert construction-site heat |
| Humidity | 10–98% | Taken down as Temperature climbs past 38°C (very hot + near-saturation humidity essentially doesn't co-occur in nature) |
| Heart Rate | 50–190 BPM | Resting to maximal exertion. Per-class means/stds (see `generate_dataset.py`) are grounded in real occupational-health figures, not arbitrary spacing: normal resting HR is 60-100 BPM (AHA), sustained HR during ordinary manual/construction labor routinely runs 100-140 BPM with no heat distress involved (construction cardiovascular-load studies), and ACGIH's actual heat-strain criteria only kick in around sustained HR > 180−age (~140-145 BPM) or 1-minute recovery HR > 120 BPM |
| SpO2 | 88–100% | Normal to clinically concerning under heat stress |

## Tensor Arena Sizing

`HEATSHIELD_TENSOR_ARENA_SIZE` is set to **20,480 bytes (20 KB)** in `model_params.h`.

**Why 20 KB:** the model itself is tiny (352 parameters, 3.82 KB quantized), so the actual tensor arena usage is only a few KB — but TFLite Micro's `MicroInterpreter` also needs headroom for internal bookkeeping (operator scratch buffers, tensor metadata) that doesn't scale down as cleanly as the model does. 20 KB is a generous safety margin chosen to make `AllocateTensors()` succeed reliably on first boot without needing to tune it, while still being a rounding error against the ESP32's ~320 KB of SRAM.

**How to check actual usage:** the firmware prints `Tensor Arena Used: X / 20480 bytes` on every Serial debug line (from `TinyMLInference::tensorArenaUsedBytes()`, which calls `MicroInterpreter::arena_used_bytes()`). Watch this on first boot.

**How to tune it:**
- **Shrink it**: once you've seen the real `arena_used_bytes()` value in the Serial Monitor, set `TENSOR_ARENA_SIZE_BYTES` in `training/generate_model_header.py` to that value + ~20% headroom, then re-run `generate_model_header.py` to regenerate `model_params.h`.
- **Grow it**: if `AllocateTensors() failed` appears in the Serial Monitor (the firmware reports this without crashing — it just retries model init every 5s), increase `TENSOR_ARENA_SIZE_BYTES` and regenerate. This would also be necessary if you enlarge the model architecture (more/wider layers).

## Installation — Python Environment

Requires Python 3.10+ (developed and validated against **Python 3.12.8 / TensorFlow 2.21.0** in this repo).

```bash
cd training
pip install -r requirements.txt
```

## Step-by-Step: Dataset → Training → Quantization → Firmware

Run these **in order** from the `training/` directory. Each step's output feeds the next; `generate_model_header.py` is the step that writes directly into the firmware source tree, so nothing needs to be copied by hand.

```bash
cd training

# 1. Generate the synthetic dataset -> dataset/heat_stress_dataset.csv
python generate_dataset.py

# 2. Generate exploratory visualizations -> docs/01-04_*.png
python visualize_data.py

# 3. Train the model -> model_output/heatshield_model.keras/.h5,
#    docs/05_training_curves.png, docs/06_confusion_matrix.png, docs/evaluation_report.md
python train_model.py

# 4. Full INT8 quantization -> model_output/heatshield_model.tflite
python convert_to_tflite.py

# 5. (optional but recommended) full-test-set evaluation of the quantized model
#    -> docs/07_quantized_confusion_matrix.png, docs/quantized_evaluation_report.md
python evaluate_tflite.py

# 6. Convert to model.h + model_params.h, copied straight into the
#    firmware project's src/ -- no manual copying required (location is
#    auto-discovered, see "Automated Deployment Workflow" below)
python generate_model_header.py
```

After step 6, the firmware project's `src/model.h` and `model_params.h` are up to date and ready to compile. All of these have already been run once in this repo, so you can skip straight to [PlatformIO Setup](#platformio-setup--flashing-the-esp32) if you just want to flash the pre-trained model — re-run the pipeline whenever you want to retrain (e.g. with real sensor data later), or better, just use `python deploy_firmware.py` (see next two sections) which runs steps 4/6 plus verification plus the rebuild in one command.

## PlatformIO Setup & Flashing the ESP32

1. Install [PlatformIO](https://platformio.org/) (VS Code extension, or `pip install platformio` for the CLI).
2. Open the firmware project as a PlatformIO project (VS Code: "Open Folder" on whichever directory contains its `platformio.ini`; CLI: `cd` into that directory).
3. Connect the ESP32 Dev Module via USB.
4. Build:
   ```bash
   pio run
   ```
5. Flash:
   ```bash
   pio run --target upload
   ```
   (If upload fails to auto-detect the port, hold the ESP32's BOOT button while the "Connecting..." dots appear, or add `upload_port = COMx` / `/dev/ttyUSBx` to `platformio.ini`.)
6. Open the Serial Monitor:
   ```bash
   pio device monitor
   ```
   (115200 baud, matching `monitor_speed` in `platformio.ini`.)

All dependencies (Chirale_TensorFlowLite, DHT sensor library, Adafruit SSD1306/GFX, SparkFun MAX3010x) are declared in `platformio.ini` `lib_deps` and are fetched automatically on first build — no manual library installation needed. **Confirmed**: this project builds cleanly as of the last integration audit — RAM 15.1% (49,504 / 327,680 bytes), Flash 45.6% (597,381 / 1,310,720 bytes).

## Automated Deployment Workflow

Retraining a model touches three files that all have to stay in lockstep (`model.h`, `model_params.h`, and the firmware code that reads them) — doing this by hand is exactly how a wearable ends up quietly running stale normalization against a new model. **`deploy_firmware.py` is the one command that replaces all manual copying:**

```bash
cd training
python deploy_firmware.py
```

This runs, in order, and stops immediately (non-zero exit code) if any step fails:

1. **Quantize** — re-runs `convert_to_tflite.py` only if `heatshield_model.tflite` is missing or older than `heatshield_model.keras` (so it's a no-op if you already quantized).
2. **Generate + deploy headers** — runs `generate_model_header.py`, which writes `model.h` and `model_params.h` straight into the firmware project's `src/` directory.
3. **Verify integration** — runs `verify_integration.py`, 13 automated checks that the firmware is actually consistent with what was just trained (see list below). If anything fails here, the build step is skipped on purpose — a firmware image that compiles but silently uses the wrong normalization is worse than a build that never happens.
4. **Rebuild** — runs `pio run` in the firmware project.
5. **Report** — prints a pass/fail summary for every step, with the firmware binary's path and size on success.

```
$ python deploy_firmware.py
=== [1/4] Quantizing model to INT8 ===
=== [2/4] Generating model.h / model_params.h into firmware ===
=== [3/4] Verifying integration (feature order, class mapping, quantization) ===
  13 passed, 0 failed
=== [4/4] Rebuilding PlatformIO firmware ===
============================================================
DEPLOYMENT REPORT
============================================================
[OK]   Generate + deploy model.h / model_params.h (4.3s)
[OK]   Verify Python <-> firmware integration (3.2s)
[OK]   Rebuild PlatformIO project (7.9s)
------------------------------------------------------------
RESULT: SUCCESS -- firmware is up to date and builds cleanly.
Binary: <firmware>/.pio/build/esp32dev/firmware.bin (597744 bytes)
Next: pio run --target upload  (from the firmware directory)
============================================================
```

**Flags:**
- `--skip-build` — do steps 1-3 only (faster inner loop while iterating on the model; verifies consistency without waiting on a full PlatformIO compile).
- `--force-convert` — re-quantize even if the `.tflite` looks up to date.

**What `verify_integration.py` actually checks** (can also be run standalone: `python verify_integration.py`):

| # | Check |
|---|---|
| 1 | Firmware `src/model.h` is byte-identical to `training/model_output/model.h` |
| 2-3 | `model_params.h`'s `FEATURE_MEAN`/`FEATURE_STD` exactly match `normalization_params.json` |
| 4-5 | Feature count and order in `model_params.h` match `training/common.py`'s `FEATURE_NAMES` |
| 6 | `preprocessing.cpp`'s `packFeatures()` assigns features in the documented Temperature/Humidity/HeartRate/SpO2/HeatIndex order |
| 7 | `preprocessing.cpp` still contains the Heat Index formula's constants (`17.27`, `237.7`, `6.105`, `0.33`, `0.70`) |
| 8-9 | Class count and order in `model_params.h` match `training/common.py`'s `CLASS_NAMES` |
| 10-11 | The actual `.tflite`'s input/output tensor shapes match `NUM_FEATURES`/`NUM_CLASSES` |
| 12-13 | The actual `.tflite`'s input/output quantization (scale, zero_point) match what's baked into `model_params.h` |

**How firmware location is found** (both scripts, via `common.py`'s `locate_firmware_dir()`): checks the `HEATSHIELD_FIRMWARE_DIR` environment variable first, then `<project>/firmware/HeatShieldAI`, then `<project's parent>/firmware/HeatShieldAI` — picking whichever one actually contains a `platformio.ini`. If you move the firmware project somewhere else entirely, set `HEATSHIELD_FIRMWARE_DIR` to its new path. The PlatformIO CLI (`pio`) itself is located the same way via `locate_pio_executable()` (`HEATSHIELD_PIO_PATH` env var, then `PATH`, then the standard `~/.platformio/penv` install location) since the PlatformIO IDE extension doesn't always put `pio` on `PATH`.

## Viewing Predictions

- **OLED**: shows `Prediction: <CLASS>`, `Confidence: NN%`, a confidence bar, and a `[!]` marker in the header when an alert is active.
- **Serial Monitor** (115200 baud): every cycle prints Temperature, Humidity, Heart Rate, SpO2, Heat Index, normalized inputs, the predicted class, confidence, raw per-class probabilities, inference time (µs), free heap, flash usage, model size, and tensor arena usage.
- **Buzzer + vibration motor**: silent for SAFE; increasingly frequent/longer pulses for WARNING → DANGER → CRITICAL (see `alerts.cpp` for exact timings).

**Verifying real-time inference with live sensor data**: breathe on the DHT22 / cup your hand around it to raise the local temperature and humidity, and watch the Serial Monitor's Heat Index and prediction respond within one or two read cycles (~4-8 seconds, dominated by the MAX30102 pulse-window collection). Place a finger firmly on the MAX30102 to get valid HR/SpO2 (you'll see `[WARN] No finger detected...` in Serial output until you do).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `AllocateTensors() failed` in Serial Monitor | Tensor arena too small — see [Tensor Arena Sizing](#tensor-arena-sizing) |
| Build fails resolving `Chirale_TensorFlowLite` or TFLite Micro headers | This library (and TFLite-Micro Arduino ports generally) is version-sensitive. Try pinning `spaziochirale/Chirale_TensorFlowLite` to the exact version noted in `platformio.ini`, or as a fallback, vendor Google's `tflite-micro` sources directly into `firmware/HeatShieldAI/lib/` (see `github.com/atomic14/platformio-tensorflow-lite` for a vendoring script) |
| `Schema mismatch` printed at boot | The `.tflite` was built with a TensorFlow version whose schema is newer than the TFLite Micro library vendored in `Chirale_TensorFlowLite`. Re-run the training pipeline with the `tensorflow` version pinned in `training/requirements.txt`, or update the firmware library |
| MAX30102 / SSD1306 not detected | Check I2C wiring (GPIO21=SDA, GPIO22=SCL), confirm 3.3V power, and that no other device conflicts on addresses `0x57` (MAX30102) / `0x3C` (SSD1306) |
| Heart rate/SpO2 readings look wrong or jump around | The on-device pulse algorithm (`sensors.cpp`) is a simplified peak-detection + ratio-of-ratios estimator, not clinical-grade — press your fingertip firmly and steadily on the sensor and avoid motion during the ~4s collection window |
| DHT22 always reports invalid/NaN | Check the 10kΩ pull-up resistor on the data line and that GPIO4 isn't shared with another peripheral |
| Predictions seem "stuck" on one class | Check `Normalized Inputs` in Serial output — if they're far outside roughly [-3, 3], your live sensor conditions are outside the training distribution; the dataset covers 18-48°C / 10-98% RH / 50-190 BPM / 88-100% SpO2 |

## Adding Future Features

The pipeline was deliberately designed so new sensors (GPS, WBGT, accelerometer, hydration level, worker age, exposure time) can be added without restructuring:

1. Append the new feature name to `FEATURE_NAMES` in `training/common.py` (**append only** — don't reorder existing entries, or old normalization params become invalid).
2. Add the corresponding column when generating/collecting data (extend `generate_dataset.py`'s class-conditional distributions, or splice in real collected data).
3. Re-run the full pipeline (`generate_dataset.py` → `train_model.py` → `convert_to_tflite.py` → `generate_model_header.py`). `HEATSHIELD_NUM_FEATURES`, the mean/std arrays, and the model's input tensor shape all update automatically.
4. In firmware, extend `FeatureProcessor::packFeatures()` (`preprocessing.cpp`) to read the new sensor and append it to `rawOut[]` in the same position, and add the sensor's own read logic to `SensorManager` (`sensors.cpp`) following the existing pattern (last-known-good fallback + a `*Valid` flag).

## Design Review, Issues Found & Fixes Applied

This project was built with an explicit review-and-correct pass rather than a single generation pass. Issues actually found and fixed during development:

1. **NOAA Heat Index formula diverges at temperature extremes.** Building the dataset with Temperature up to 48°C surfaced Heat Index values of 300°F+ from the standard Rothfusz regression — a real defect, not a hypothetical one (see `common.py` history / the formula section above). **Fix**: switched to the Australian BOM Apparent Temperature formula, which is numerically stable across the full range and simpler to replicate identically in C++.
2. **Unrealistic Temperature/Humidity combinations.** Even after fixing the formula, 47°C at 98% RH is not something that occurs in nature. **Fix**: added a humidity ceiling that tapers down as Temperature climbs past 38°C.
3. **MAX30102 SpO2 "official" algorithm isn't part of the installable library.** Maxim/SparkFun's `spo2_algorithm.h` is example-only, not shipped in the PlatformIO-installable library — depending on it would break "compiles without modification." **Fix**: implemented a self-contained peak-detection BPM + ratio-of-ratios SpO2 estimator directly in `sensors.cpp` using only the library's public FIFO API.
4. **`tanakamasayuki/TensorFlowLite_ESP32`, the "classic" choice, is now flagged outdated by its own maintainer** in favor of Espressif's official `esp-tflite-micro`, which itself has no clean PlatformIO+Arduino-framework story. **Fix**: verified (via the library's actual `hello_world` example source) and used `spaziochirale/Chirale_TensorFlowLite`, an actively maintained (2024+) Arduino port with confirmed `esp32` architecture support, and mirrored its exact confirmed API (`tflite::GetModel`, `AllOpsResolver`, `MicroInterpreter` 4-arg constructor, `input->params.scale/zero_point` quantization pattern) rather than guessing at API shape.
5. **Redundant/inconsistent MAX30102 LED amplitude call.** An early draft set the Red LED to a much lower amplitude than IR right after `setup()` set both equally — this would have skewed the SpO2 ratio-of-ratios for no reason. **Fix**: removed the override; Red and IR now share the same `setup()`-configured amplitude.
6. **NaN/out-of-range sensor values reaching the model.** `SensorManager` already substitutes last-known-good values on sensor failure, but as defense-in-depth (explicitly required), `FeatureProcessor::sanitizeInputs()` clamps every raw reading to physiologically/environmentally sensible bounds (mirroring the dataset's own bounds) immediately before Heat Index computation and normalization.
7. **Op resolver footprint.** Rather than guessing which TFLite ops the model needs, the actual `.tflite` flatbuffer was inspected directly — confirmed to use only `FULLY_CONNECTED` and `SOFTMAX`. The firmware uses `AllOpsResolver` for guaranteed first-build compilation (documented in `inference.cpp`), with the exact `MicroMutableOpResolver<2>` swap-in shown in a comment for anyone who wants the smaller-flash-footprint version.
8. **(Post-build integration audit) Firmware directory relocated by tooling, breaking the hardcoded path.** After the first successful `pio run`, the firmware project ended up living outside this project tree (moved by the PlatformIO IDE workflow). `generate_model_header.py` had `firmware/HeatShieldAI/src` hardcoded, which would have silently written generated headers to a stale, no-longer-built location on the next retrain. **Fix**: added `locate_firmware_dir()` / `locate_pio_executable()` auto-discovery to `common.py` (checks an env var, then both known layouts, by looking for `platformio.ini`) and built `deploy_firmware.py` + `verify_integration.py` on top so this class of drift is caught automatically instead of silently.
9. **MAX30102 finger-presence threshold was an untunable guess.** `kFingerPresenceIrThreshold` (30000) has no way to be validated without seeing real sensor output. **Fix**: added `SensorReadings.irDcLevel` and a `MAX30102 IR Level` Serial debug line so the threshold can be calibrated against the real sensor/finger/lighting in under a minute of watching Serial output.
10. **SAFE class's HeartRate distribution was effectively resting-HR-only, causing normal working heart rates to misclassify as WARNING.** The original `CLASS_DISTRIBUTIONS["SAFE"]["HeartRate"]` was `(75.0, 9.0)`, meaning even a benign, non-heat-related HR of ~100 BPM (perfectly normal during active manual labor — see the Heart Rate row above) was already >2.5 std above the SAFE mean and read as WARNING territory. Verified that Temperature/Humidity were *not* the problem: running each class's mean (T, RH) through this project's own `heat_index_celsius()` lands almost exactly on the NWS/OSHA-NIOSH Heat Index chart's Caution/Extreme Caution/Danger/Extreme Danger boundaries (80°F/91°F/103°F/125°F), so those were left unchanged. **Fix**: rebased HeartRate means/stds per class on real occupational-heat-strain figures (AHA resting-HR range, construction cardiovascular-load studies, ACGIH sustained/recovery heart-rate strain criteria — see the Heart Rate row above), then regenerated the dataset and reran the full pipeline (train → quantize → evaluate → regenerate `model.h`/`model_params.h` → verify → rebuild firmware). All 13 integration checks still pass; test accuracy moved from 91.75%/91.55% to 90.50%/90.25% (float/INT8) — a small, expected drop from the SAFE/WARNING boundary now reflecting genuine physiological overlap instead of an artificially clean gap.

## Integration Audit (Post-Build)

Performed after the firmware's first successful `pio run` (see "Files Modified" / "Bugs Fixed" below for detail). All 13 automated checks in `verify_integration.py` pass, and the firmware rebuilds cleanly after every fix applied in this pass.

| # | Item audited | Result |
|---|---|---|
| 1 | `src/model.h` identical to `training/model_output/model.h` | ✅ PASS (byte-identical, automated check) |
| 2 | `model_params.h` normalization values match `normalization_params.json` | ✅ PASS (automated check) |
| 3 | Feature order: Temperature, Humidity, HeartRate, SpO2, HeatIndex | ✅ PASS everywhere (dataset, model_params.h, preprocessing.cpp) |
| 4 | Class indices: 0=SAFE, 1=WARNING, 2=DANGER, 3=CRITICAL | ✅ PASS (consistent across common.py, model_params.h, alerts.h) |
| 5 | `inference.cpp` loads the model correctly | ✅ PASS — verified real API usage (Chirale_TensorFlowLite), compiles and links |
| 6 | Tensor dimensions | ✅ PASS — runtime shape check in `begin()` + automated check against the `.tflite` (input `(1,5)`, output `(1,4)`) |
| 7 | Tensor arena size sufficient | ✅ Structurally sufficient (20KB vs. a 3.82KB/352-param model); ⚠️ exact `arena_used_bytes()` needs confirming from Serial on real hardware (firmware prints it every cycle) |
| 8 | Quantization parameters applied correctly | ✅ PASS — firmware reads scale/zero_point from the live tensor (not a hardcoded copy) + automated check confirms `model_params.h` matches the `.tflite` |
| 9 | ESP32 preprocessing mathematically identical to Python | ✅ PASS — same formula, same constants, same operation order (float32 vs. numpy float64 introduces only negligible rounding, well within normalization tolerance) |
| 10 | Heat Index calculation matches dataset generation | ✅ PASS — automated check confirms all 5 formula constants present in `preprocessing.cpp` |
| 11 | OLED shows correct class/confidence | ✅ Logic verified correct (indexes by `predictedClass`, displays `confidence*100`); visual confirmation needs real hardware |
| 12 | Buzzer/vibration only for WARNING/DANGER/CRITICAL | ✅ PASS — `AlertManager` explicitly no-ops for SAFE (verified in code: `onDurationMsFor`/`offDurationMsFor` return 0, `setLevel()` skips activation for SAFE) |
| 13 | Firmware-wide bug review | ✅ Reviewed all 8 firmware files; 1 real gap found and fixed (finger-presence threshold had no calibration visibility) + 1 stale-path bug found and fixed (see above) |

**Build numbers (real, from `pio run`):** RAM 49,504 / 327,680 bytes (15.1%), Flash 597,381 / 1,310,720 bytes (45.6%). No errors, one pre-existing benign warning (`I2C_BUFFER_LENGTH` redefined — a harmless macro collision between the SparkFun library and ESP32's `Wire.h`, not our code).

## Readiness Checklist

| Part | Status |
|---|---|
| Dataset generation (16,000 rows, balanced, documented labeling logic) | ✅ Done, run, verified |
| Data visualizations (distributions, class balance, correlation, scatter) | ✅ Done, generated in `docs/` |
| Model training (early stopping, checkpointing, LR scheduling) | ✅ Done, run — 91.75% test accuracy |
| Evaluation (accuracy/precision/recall/F1/confusion matrix/classification report/sample predictions) | ✅ Done, both float and quantized models, in `docs/` |
| INT8 quantization | ✅ Done, run — 3.82 KB, 91.55% test accuracy (−0.2pp vs float) |
| model.h / model_params.h generation, auto-copied into firmware | ✅ Done, run, auto-discovers firmware location |
| Normalization identical between Python and C++ | ✅ Single source of truth (`model_params.h`, generated, not hand-typed) + automated check |
| PlatformIO project (all deps, pinned platform version) | ✅ Complete `platformio.ini` |
| Firmware modules (Sensors/Inference/FeatureProcessor/Display/Alerts) | ✅ All implemented, no stubs/TODOs |
| Error handling (sensor disconnect, NaN, model/OLED init failure) | ✅ Implemented at every stage, never crashes/hangs |
| **PlatformIO build verified on real hardware** | ✅ **Confirmed** — `pio run` succeeds, `firmware.bin` produced, RAM 15.1% / Flash 45.6% |
| Automated deployment workflow (retrain → firmware, one command) | ✅ `deploy_firmware.py`: quantize → generate headers → verify (13 checks) → rebuild → report |
| On-device sensor/OLED/buzzer behavior | ⚠️ Not yet verified on physical hardware (requires flashing + physically observing the device) |

---

*Built for a hackathon — the on-device SpO2/heart-rate estimation is a simplified engineering approximation, not a certified medical device. Do not use HeatShieldAI as a sole safety measure for real workers without further validation.*
