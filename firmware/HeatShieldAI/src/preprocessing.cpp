// preprocessing.cpp
// See preprocessing.h for the contract this file implements.

#include "preprocessing.h"
#include <math.h>

namespace FeatureProcessor {

float computeHeatIndex(float temperatureC, float humidityPct) {
    // Australian Bureau of Meteorology Apparent Temperature formula.
    // MUST stay bit-for-bit equivalent (same operation order/constants) to
    // heat_index_celsius() in training/common.py.
    const float ws = 0.0f;  // no wind sensor on this wearable; calm-air assumption
    float vaporPressure = (humidityPct / 100.0f) * 6.105f *
                           expf(17.27f * temperatureC / (237.7f + temperatureC));
    float apparentTemp = temperatureC + 0.33f * vaporPressure - 0.70f * ws - 4.00f;
    return apparentTemp;
}

void packFeatures(float temperatureC, float humidityPct, float heartRateBpm,
                   float spo2Pct, float rawOut[HEATSHIELD_NUM_FEATURES]) {
    // Order must match FEATURE_NAMES in training/common.py exactly:
    //   [0] Temperature  [1] Humidity  [2] HeartRate  [3] SpO2  [4] HeatIndex
    rawOut[0] = temperatureC;
    rawOut[1] = humidityPct;
    rawOut[2] = heartRateBpm;
    rawOut[3] = spo2Pct;
    rawOut[4] = computeHeatIndex(temperatureC, humidityPct);
}

void normalize(const float raw[HEATSHIELD_NUM_FEATURES],
               float normalizedOut[HEATSHIELD_NUM_FEATURES]) {
    for (int i = 0; i < HEATSHIELD_NUM_FEATURES; i++) {
        normalizedOut[i] = (raw[i] - HEATSHIELD_FEATURE_MEAN[i]) / HEATSHIELD_FEATURE_STD[i];
    }
}

namespace {
// Mirrors GLOBAL_BOUNDS in training/generate_dataset.py.
bool sanitizeOne(float& value, float minBound, float maxBound, float fallback) {
    if (isnan(value) || isinf(value)) {
        value = fallback;
        return true;
    }
    if (value < minBound) {
        value = minBound;
        return true;
    }
    if (value > maxBound) {
        value = maxBound;
        return true;
    }
    return false;
}
}  // namespace

bool sanitizeInputs(float& temperatureC, float& humidityPct,
                     float& heartRateBpm, float& spo2Pct) {
    bool corrected = false;
    corrected |= sanitizeOne(temperatureC, 18.0f, 48.0f, 28.0f);
    corrected |= sanitizeOne(humidityPct, 10.0f, 98.0f, 50.0f);
    corrected |= sanitizeOne(heartRateBpm, 50.0f, 190.0f, 75.0f);
    corrected |= sanitizeOne(spo2Pct, 88.0f, 100.0f, 97.0f);
    return corrected;
}

}  // namespace FeatureProcessor
