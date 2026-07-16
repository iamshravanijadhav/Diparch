// sensors.cpp
// See sensors.h for the contract this file implements.
//
// Heart rate and SpO2 estimation are implemented from scratch here using
// only the raw IR/RED FIFO samples the SparkFun MAX3010x library exposes
// (particleSensor.getIR()/getRed()/check()/available()/nextSample()).
// Maxim's official SpO2 algorithm (spo2_algorithm.h) is an EXAMPLE-ONLY
// file that is not part of the installable library, so depending on it
// would break "compiles without modification" -- see platformio.ini's
// comment on this. The algorithm below is a standard, well-documented
// simplified approach (peak-interval BPM + ratio-of-ratios SpO2) suitable
// for a hackathon-grade wearable; it is not clinical-grade.

#include "sensors.h"
#include <Wire.h>
#include <math.h>

namespace {

constexpr int kPulseSampleTarget = 80;   // samples collected per pulse window
constexpr unsigned long kPulseWindowTimeoutMs = 6000;  // safety timeout
// Below this raw IR DC level: treated as "no finger on sensor". This is a
// hardware-dependent guess (LED current, skin tone, ambient light all shift
// the real value) -- main.cpp prints the live "IR DC Level" every cycle so
// this can be tuned to your actual sensor/finger instead of staying a guess.
constexpr long kFingerPresenceIrThreshold = 30000;
constexpr int kMinValidSamples = 20;      // fewer than this -> reading invalid
constexpr int kMaxPeaks = 24;

// FIX (finger presence): a raw DC-level threshold alone is not reliable --
// ambient IR light, sensor auto-gain settling, or just resting the fingertip
// near (not on) the sensor can push the DC level above
// kFingerPresenceIrThreshold with NO real pulsatile blood-flow signal
// underneath it. A real finger on the sensor always produces a periodic AC
// (pulsatile) component riding on top of the DC level; ambient light does
// not. So we additionally require the AC/DC ratio ("perfusion index") to
// clear a minimum before we trust the window at all. This is the fix for
// "HR is shown even with no finger on the sensor".
constexpr float kMinPerfusionIndexDetect = 0.0020f;  // to declare finger present initially
constexpr float kMinPerfusionIndexHold   = 0.0010f;  // to keep believing finger is still present

// FIX (bogus high HR): the raw PPG waveform has a main systolic peak
// followed by a smaller secondary bump (the "dicrotic notch"). With a low
// amplitude threshold (the old 0.3 * maxAc) and a short minimum peak
// distance, that notch gets counted as its own beat, roughly doubling the
// reported heart rate. Raising the threshold and the minimum distance (capped
// to a realistic maximum HR instead of an unrealistic 200 BPM) plus a light
// smoothing pass before peak-picking removes almost all notch/noise
// double-counts.
constexpr float kPeakAmplitudeFraction = 0.5f;   // was 0.3f
constexpr float kMaxDetectableBpm = 180.0f;      // was ~200 BPM (0.30f factor)
constexpr int kSmoothingWindow = 3;              // simple moving-average width

// FIX (stale contaminated reading persisting forever): if the sensor hasn't
// produced a genuinely valid reading in this many consecutive cycles, treat
// the wearer as "not wearing it" and fall back to "no data" instead of an
// old value that might have come from a noise-triggered false detection.
// Lowered from 8 -> 4 so "no finger" is reflected on Serial/OLED within
// roughly one extra cycle instead of ~8, once the finger is actually removed.
constexpr int kMaxConsecutiveInvalidBeforeReset = 4;

// FIX (wildly swinging BPM between consecutive ~4s windows, e.g. 150 -> 117
// -> 88 -> 130 for a resting person): a real human heart rate cannot jump by
// more than roughly this many BPM between back-to-back windows. A candidate
// reading that jumps further than this is far more likely a motion artifact
// or a miscounted/missed peak than a genuine physiological change, so it is
// rejected (treated as a noisy window, falling back to the last known-good
// value) rather than accepted and blended in.
constexpr float kMaxHeartRateJumpBpm = 25.0f;

// FIX ("SpO2 always shows exactly 88.0%"): the old linear ratio-of-ratios
// formula (110 - 25*ratio) plus preprocessing.cpp's model-input floor of
// 88% combined to silently flatten any noisy/poorly-calibrated reading to a
// constant 88.0%, which looked like (and was reported as) a sensor bug
// rather than a real reading. Two changes fix this:
//   1. A more standard empirical calibration curve (commonly used across
//      MAX3010x-based pulse oximeter projects) that tracks a healthy
//      resting adult's ~96-100% SpO2 far more accurately at low ratios than
//      the old straight line did.
//   2. A plausibility gate (kMinPlausibleSpo2Estimate) that rejects a
//      window outright when the computed estimate is implausibly low for a
//      finger genuinely at rest on the sensor, instead of accepting it and
//      letting preprocessing.cpp's floor silently flatten it to 88%.
constexpr float kMinPlausibleSpo2Estimate = 80.0f;

float pulseIrBuffer[kPulseSampleTarget];
float pulseRedBuffer[kPulseSampleTarget];
float smoothedIrBuffer[kPulseSampleTarget];

// Simple centered moving-average smoothing to suppress the dicrotic notch
// and high-frequency noise before peak detection, without meaningfully
// delaying/attenuating the much-slower heartbeat waveform itself.
void smoothSignal(const float* in, float* out, int count, int window) {
    int half = window / 2;
    for (int i = 0; i < count; i++) {
        int lo = max(0, i - half);
        int hi = min(count - 1, i + half);
        float sum = 0.0f;
        for (int j = lo; j <= hi; j++) sum += in[j];
        out[i] = sum / (hi - lo + 1);
    }
}

}  // namespace

void SensorManager::begin() {
    dht_.begin();
    dhtOk_ = true;  // DHT library has no begin() status; validated on first read()

    Wire.begin(HEATSHIELD_I2C_SDA_PIN, HEATSHIELD_I2C_SCL_PIN);

    maxOk_ = particleSensor_.begin(Wire, I2C_SPEED_FAST);
    if (maxOk_) {
        // powerLevel, sampleAverage, ledMode(2=Red+IR), sampleRate, pulseWidth, adcRange
        // Red and IR are left at the same powerLevel (both needed at
        // comparable amplitude for a meaningful SpO2 ratio-of-ratios).
        particleSensor_.setup(60, 4, 2, 100, 411, 4096);
        particleSensor_.setPulseAmplitudeGreen(0);  // no green LED on MAX30102, disable to save power
    } else {
        Serial.println(F("[SensorManager] MAX30102 not detected on I2C bus."));
    }
}

void SensorManager::readDht(SensorReadings& out) {
    float t = dht_.readTemperature();
    float h = dht_.readHumidity();

    if (isnan(t) || isnan(h)) {
        out.dhtValid = false;
        out.temperatureC = lastGoodTemperature_;
        out.humidityPct = lastGoodHumidity_;
        dhtOk_ = false;
        return;
    }

    dhtOk_ = true;
    out.dhtValid = true;
    out.temperatureC = t;
    out.humidityPct = h;
    lastGoodTemperature_ = t;
    lastGoodHumidity_ = h;
}

void SensorManager::readPulseOx(SensorReadings& out) {
    out.maxSensorOk = maxOk_;
    out.irDcLevel = 0;
    if (!maxOk_) {
        out.maxValid = false;
        out.fingerPresent = false;
        out.heartRateBpm = lastGoodHeartRate_;
        out.spo2Pct = lastGoodSpo2_;
        return;
    }

    unsigned long startMs = millis();
    int count = 0;
    while (count < kPulseSampleTarget && (millis() - startMs) < kPulseWindowTimeoutMs) {
        particleSensor_.check();
        while (particleSensor_.available() && count < kPulseSampleTarget) {
            pulseIrBuffer[count] = (float)particleSensor_.getIR();
            pulseRedBuffer[count] = (float)particleSensor_.getRed();
            count++;
            particleSensor_.nextSample();
        }
    }
    unsigned long elapsedMs = millis() - startMs;

    // Helper: treat this cycle as "no valid reading" -- fall back to last
    // known good value, but also track how many cycles in a row this has
    // happened. After enough consecutive misses we stop trusting the old
    // value (see comment on kMaxConsecutiveInvalidBeforeReset) since that
    // almost certainly means the wearer isn't wearing the sensor at all,
    // rather than a single noisy sample window.
    auto reportInvalid = [&]() {
        out.maxValid = false;
        consecutiveInvalidPulseReads_++;
        if (hasEverHadValidPulse_ && consecutiveInvalidPulseReads_ >= kMaxConsecutiveInvalidBeforeReset) {
            lastGoodHeartRate_ = 75.0f;
            lastGoodSpo2_ = 97.0f;
            hasEverHadValidPulse_ = false;
        }
        // fingerPresent tracks "do we currently believe a finger is on the
        // sensor at all", not just "was this one window clean". If we still
        // have a recent genuine reading (hasEverHadValidPulse_ is true and we
        // haven't hit the reset threshold yet), assume the finger is still
        // there and this was just a noisy window. Otherwise, no finger.
        out.fingerPresent = hasEverHadValidPulse_;
        out.heartRateBpm = lastGoodHeartRate_;
        out.spo2Pct = lastGoodSpo2_;
    };

    if (count < kMinValidSamples) {
        reportInvalid();
        return;
    }

    // DC (mean) levels
    double sumIr = 0, sumRed = 0;
    for (int i = 0; i < count; i++) {
        sumIr += pulseIrBuffer[i];
        sumRed += pulseRedBuffer[i];
    }
    float dcIr = (float)(sumIr / count);
    float dcRed = (float)(sumRed / count);
    out.irDcLevel = (long)dcIr;

    if (dcIr < kFingerPresenceIrThreshold) {
        // No finger on the sensor -- reading would be meaningless.
        reportInvalid();
        return;
    }

    // AC (RMS of DC-removed signal) levels, for the SpO2 ratio-of-ratios
    // AND for the perfusion-index finger-presence check below.
    double sqIr = 0, sqRed = 0;
    for (int i = 0; i < count; i++) {
        float ir = pulseIrBuffer[i] - dcIr;
        float red = pulseRedBuffer[i] - dcRed;
        sqIr += (double)ir * ir;
        sqRed += (double)red * red;
    }
    float acIr = sqrtf((float)(sqIr / count));
    float acRed = sqrtf((float)(sqRed / count));

    // FIX: a high DC level with essentially no pulsatile AC component means
    // this is NOT a finger on the sensor (ambient light / sensor resting on
    // a surface / finger held just above without contact) -- it's the root
    // cause of "HR is displayed even with no finger present". Reject it here
    // before doing anything else with this window.
float perfusionIndex = (dcIr > 0.0f) ? (acIr / dcIr) : 0.0f;
float perfusionThreshold = hasEverHadValidPulse_ ? kMinPerfusionIndexHold : kMinPerfusionIndexDetect;
if (perfusionIndex < perfusionThreshold) {
    reportInvalid();
    return;
}

    float spo2 = lastGoodSpo2_;
    if (acIr > 0.0f && dcIr > 0.0f && dcRed > 0.0f) {
        float ratio = (acRed / dcRed) / (acIr / dcIr);
        // Empirical quadratic calibration curve (commonly used across
        // MAX3010x-based pulse oximeter projects), which tracks a healthy
        // resting adult's ~96-100% SpO2 far more accurately at realistic
        // ratios than the old straight-line formula.
        spo2 = -45.060f * ratio * ratio + 30.354f * ratio + 94.845f;
        spo2 = constrain(spo2, 70.0f, 100.0f);

        // FIX: reject implausibly low estimates outright instead of letting
        // them through to be silently floor-clamped to 88% by
        // preprocessing.cpp -- see kMinPlausibleSpo2Estimate comment above.
        if (spo2 < kMinPlausibleSpo2Estimate) {
            reportInvalid();
            return;
        }
    }

    // FIX: lightly smooth the IR waveform before peak-picking. This blunts
    // the dicrotic notch (the PPG waveform's secondary bump after the main
    // systolic peak) and single-sample noise spikes, both of which were
    // previously being counted as extra beats and roughly doubling the
    // reported heart rate.
    smoothSignal(pulseIrBuffer, smoothedIrBuffer, count, kSmoothingWindow);

    float smoothedDcIr = 0.0f;
    for (int i = 0; i < count; i++) smoothedDcIr += smoothedIrBuffer[i];
    smoothedDcIr /= count;

    // Heart rate via peak-interval detection on the smoothed IR AC signal.
    float effectiveRateHz = (elapsedMs > 0) ? (count * 1000.0f / elapsedMs) : 25.0f;
    // FIX: cap detectable rate at a realistic maximum (kMaxDetectableBpm)
    // instead of ~200 BPM, which gives a larger, more forgiving minimum
    // distance between accepted peaks.
    int minPeakDistanceSamples = (int)roundf(effectiveRateHz * (60.0f / kMaxDetectableBpm));
    if (minPeakDistanceSamples < 1) minPeakDistanceSamples = 1;

    float maxAc = 0.0f;
    for (int i = 0; i < count; i++) {
        float ac = fabsf(smoothedIrBuffer[i] - smoothedDcIr);
        if (ac > maxAc) maxAc = ac;
    }
    // FIX: higher fraction (0.5 vs the old 0.3) so the dicrotic notch --
    // normally well under half the main peak's amplitude -- doesn't clear
    // the bar and get counted as a second beat.
    float peakThreshold = kPeakAmplitudeFraction * maxAc;

    int peakIndices[kMaxPeaks];
    int peakCount = 0;
    int lastPeakIndex = -minPeakDistanceSamples;
    for (int i = 1; i < count - 1 && peakCount < kMaxPeaks; i++) {
        float acPrev = smoothedIrBuffer[i - 1] - smoothedDcIr;
        float acCur = smoothedIrBuffer[i] - smoothedDcIr;
        float acNext = smoothedIrBuffer[i + 1] - smoothedDcIr;
        bool isLocalMax = acCur > acPrev && acCur >= acNext;
        if (isLocalMax && acCur > peakThreshold && (i - lastPeakIndex) >= minPeakDistanceSamples) {
            peakIndices[peakCount++] = i;
            lastPeakIndex = i;
        }
    }

    // FIX: require at least 2 intervals (3 peaks), not just 1 (2 peaks), so
    // the median below reflects actual agreement between beats instead of a
    // single interval that could itself be a motion artifact.
    if (peakCount < 3) {
        reportInvalid();
        return;
    }

    // FIX: use the MEDIAN of individual peak-to-peak intervals instead of
    // one average over the whole window. A single stray extra/missed peak
    // (e.g. from a motion artifact) skews a plain average a lot; the median
    // shrugs it off as long as most intervals agree with each other.
    float intervalsSec[kMaxPeaks];
    int intervalCount = peakCount - 1;
    for (int i = 0; i < intervalCount; i++) {
        intervalsSec[i] = (peakIndices[i + 1] - peakIndices[i]) / effectiveRateHz;
    }
    // Simple insertion sort (intervalCount is at most kMaxPeaks-1, tiny).
    for (int i = 1; i < intervalCount; i++) {
        float key = intervalsSec[i];
        int j = i - 1;
        while (j >= 0 && intervalsSec[j] > key) {
            intervalsSec[j + 1] = intervalsSec[j];
            j--;
        }
        intervalsSec[j + 1] = key;
    }
    float medianIntervalSec = (intervalCount % 2 == 1)
        ? intervalsSec[intervalCount / 2]
        : 0.5f * (intervalsSec[intervalCount / 2 - 1] + intervalsSec[intervalCount / 2]);

    if (medianIntervalSec <= 0.0f) {
        reportInvalid();
        return;
    }

    float heartRate = constrain(60.0f / medianIntervalSec, 40.0f, (float)kMaxDetectableBpm);

    // FIX: reject a candidate reading that jumps further than physiologically
    // plausible from the last known-good value -- see kMaxHeartRateJumpBpm
    // comment above. This is the direct fix for BPM swinging wildly
    // (e.g. 150 -> 117 -> 88 -> 130) between consecutive windows on a
    // resting wearer: such swings are motion/noise artifacts, not real
    // heart-rate changes, and blending them in (as the old code did) let
    // them corrupt every subsequent reading via the smoothing below.
    if (hasEverHadValidPulse_ &&
        fabsf(heartRate - lastGoodHeartRate_) > kMaxHeartRateJumpBpm) {
        reportInvalid();
        return;
    }

    // FIX: smooth cycle-to-cycle instead of trusting each ~4s window in
    // isolation. If we already have a genuinely valid previous reading,
    // blend the new one in rather than snapping straight to it -- this
    // damps single-window noise (e.g. one window catching a motion
    // artifact) so a single bad window can't fire a false alert on its own.
    if (hasEverHadValidPulse_) {
        const float kSmoothingAlpha = 0.4f;  // weight given to the new reading
        heartRate = kSmoothingAlpha * heartRate + (1.0f - kSmoothingAlpha) * lastGoodHeartRate_;
        spo2 = kSmoothingAlpha * spo2 + (1.0f - kSmoothingAlpha) * lastGoodSpo2_;
    }

    out.maxValid = true;
    out.fingerPresent = true;
    out.heartRateBpm = heartRate;
    out.spo2Pct = spo2;

    consecutiveInvalidPulseReads_ = 0;
    hasEverHadValidPulse_ = true;
    lastGoodHeartRate_ = heartRate;
    lastGoodSpo2_ = spo2;
}

SensorReadings SensorManager::readAll() {
    SensorReadings readings{};
    readDht(readings);
    readPulseOx(readings);
    return readings;
}