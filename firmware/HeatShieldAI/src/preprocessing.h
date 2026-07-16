// preprocessing.h
// ----------------
// FeatureProcessor: turns raw sensor readings into the exact normalized
// feature vector the model expects. This is the ESP32-side mirror of
// training/common.py -- the Heat Index formula and standardization here
// MUST match the Python implementation exactly, or the model will see
// out-of-distribution inputs and its predictions will be meaningless.
//
// If you ever change the Heat Index formula or normalization strategy,
// update BOTH training/common.py AND preprocessing.cpp.

#ifndef HEATSHIELD_PREPROCESSING_H
#define HEATSHIELD_PREPROCESSING_H

#include "model_params.h"  // HEATSHIELD_NUM_FEATURES, MEAN/STD arrays

namespace FeatureProcessor {

// Computes Heat Index ("feels like" temperature) in degrees Celsius from
// ambient Temperature (C) and Relative Humidity (%), using the Australian
// Bureau of Meteorology Apparent Temperature formula (see common.py for
// the full rationale). Assumes calm wind (no anemometer on this wearable).
float computeHeatIndex(float temperatureC, float humidityPct);

// Packs the five raw features into `rawOut` in the exact order the model
// was trained on: [Temperature, Humidity, HeartRate, SpO2, HeatIndex].
// HeatIndex is computed internally from temperatureC/humidityPct, matching
// how it is derived (never sensor-read directly) in the training pipeline.
void packFeatures(float temperatureC, float humidityPct, float heartRateBpm,
                   float spo2Pct, float rawOut[HEATSHIELD_NUM_FEATURES]);

// Standardizes raw features in-place: normalized = (raw - mean) / std,
// using the exact mean/std the model was trained with (model_params.h).
void normalize(const float raw[HEATSHIELD_NUM_FEATURES],
               float normalizedOut[HEATSHIELD_NUM_FEATURES]);

// Defense-in-depth guard against NaN/Inf/out-of-range sensor glitches
// reaching the model, even though SensorManager already substitutes
// last-known-good values on detected failures. Clamps each raw sensor
// reading to the same physiologically/environmentally sensible bounds used
// when generating the training dataset (see GLOBAL_BOUNDS in
// training/generate_dataset.py). Returns true if any value needed
// correcting (callers should log this).
bool sanitizeInputs(float& temperatureC, float& humidityPct,
                     float& heartRateBpm, float& spo2Pct);

}  // namespace FeatureProcessor

#endif  // HEATSHIELD_PREPROCESSING_H
