// main.cpp
// ---------
// HeatShieldAI ESP32 firmware entry point. Wires together SensorManager,
// FeatureProcessor, TinyMLInference, DisplayManager and AlertManager into
// one continuous read -> preprocess -> infer -> display -> alert loop,
// with defensive handling at every stage so a single sensor/display/model
// hiccup degrades gracefully instead of crashing or hanging the device.

#include <Arduino.h>

#include "sensors.h"
#include "display.h"
#include "alerts.h"
#include "inference.h"
#include "preprocessing.h"
#include "model_params.h"
#include "lora_manager.h"
#include "lora_packet.h"

static SensorManager sensorManager;
static DisplayManager displayManager;
static AlertManager alertManager;
static TinyMLInference inference;
static LoRaManager loraManager;
static uint32_t loraSequenceNumber = 0;

// How long to actively poll the alert pattern + OLED page rotation after
// each sensor/inference cycle. This always runs (not just when an alert is
// active) so the OLED's 5-second page rotation keeps advancing smoothly
// between the relatively slow (1-6s) blocking MAX30102 reads, instead of
// only getting a chance to flip once per full loop() iteration. WARNING's
// alert cycle is the longest at on(150)+off(2850)=3000ms, and the OLED
// rotates every 5000ms, so this window comfortably covers both.
static const unsigned long kPollWindowMs = 5200;
static const unsigned long kLowHeapWarningBytes = 10000;

static void printBootDiagnostics(bool modelOk) {
    Serial.print(F("Free heap after init : "));
    Serial.print(ESP.getFreeHeap());
    Serial.println(F(" bytes"));

    Serial.print(F("Flash (sketch used)  : "));
    Serial.print(ESP.getSketchSize());
    Serial.println(F(" bytes"));

    Serial.print(F("Flash (free space)   : "));
    Serial.print(ESP.getFreeSketchSpace());
    Serial.println(F(" bytes"));

    if (modelOk) {
        Serial.print(F("Model size            : "));
        Serial.print(inference.modelSizeBytes());
        Serial.println(F(" bytes"));
        Serial.print(F("Tensor arena          : "));
        Serial.print(inference.tensorArenaUsedBytes());
        Serial.print(F(" / "));
        Serial.print(inference.tensorArenaSizeBytes());
        Serial.println(F(" bytes used"));
    }
}

void setup() {
    Serial.begin(115200);
    delay(300);  // let USB-serial settle on some ESP32 boards

    Serial.println(F("========================================"));
    Serial.println(F(" HeatShield AI - ESP32 Wearable Firmware"));
    Serial.println(F("========================================"));

    // ---- Sensors ----
    sensorManager.begin();
    if (!sensorManager.isMaxOk()) {
        Serial.println(F("[WARN] MAX30102 not detected on I2C bus. "
                          "Heart rate/SpO2 will use fallback defaults until reconnected."));
    }

    // ---- Display (never fatal if missing) ----
    bool displayOk = displayManager.begin();
    if (!displayOk) {
        Serial.println(F("[WARN] SSD1306 OLED not detected on I2C bus. "
                          "Continuing in Serial-only mode."));
    } else {
        displayManager.showBootScreen("Initializing...", "Loading TinyML model");
    }

    // ---- Alerts ----
    alertManager.begin();

    // ---- LoRa (node -> gateway telemetry; never fatal if missing) ----
    if (!loraManager.begin()) {
        Serial.println(F("[WARN] SX1278 LoRa module not detected on SPI bus. "
                          "Continuing without gateway telemetry."));
    }

    // ---- TinyML model ----
    bool modelOk = inference.begin();
    if (!modelOk) {
        Serial.print(F("[FATAL] Model initialization failed: "));
        Serial.println(inference.errorMessage());
        Serial.println(F("Will keep retrying in loop() every 5s. Device stays "
                          "responsive over Serial for debugging instead of hanging."));
        if (displayOk) {
            displayManager.showBootScreen("MODEL INIT FAILED", "See Serial Monitor");
        }
    } else {
        Serial.println(F("[OK] TinyML model loaded successfully."));
    }

    printBootDiagnostics(modelOk);

    if (displayOk) {
        displayManager.showBootScreen(modelOk ? "Ready." : "Degraded mode",
                                       modelOk ? "" : "Model init failed");
    }
    delay(500);
}

void loop() {
    // ---- Recover from a failed model init without ever hard-crashing ----
    if (!inference.isReady()) {
        Serial.println(F("[FATAL] Inference unavailable. Retrying model init in 5s..."));
        delay(5000);
        if (inference.begin()) {
            Serial.println(F("[OK] Model initialized on retry."));
        }
        return;
    }

    if (ESP.getFreeHeap() < kLowHeapWarningBytes) {
        Serial.print(F("[WARN] Low free heap: "));
        Serial.print(ESP.getFreeHeap());
        Serial.println(F(" bytes"));
    }

    // ---- Read sensors (SensorManager already substitutes last-known-good
    // values and flags *_valid on failure; it never returns NaN) ----
    SensorReadings readings = sensorManager.readAll();

    if (!readings.dhtValid) {
        Serial.println(F("[WARN] DHT22 read invalid this cycle (disconnected/NaN?). "
                          "Using last known-good Temperature/Humidity."));
        if (displayManager.isReady()) {
            displayManager.showSensorWarning("DHT22");
        }
    }
    if (!readings.maxSensorOk) {
        Serial.println(F("[WARN] MAX30102 hardware unavailable. Using fallback HR/SpO2."));
    } else if (!readings.fingerPresent) {
        Serial.println(F("[INFO] No finger detected on sensor. Place a finger on the "
                          "MAX30102 to begin heart rate / SpO2 monitoring."));
    } else if (!readings.maxValid) {
        Serial.println(F("[WARN] Weak/noisy pulse signal this cycle. "
                          "Using last known-good HeartRate/SpO2."));
    }

    // ---- Defense-in-depth sanitization before touching the model ----
    bool corrected = FeatureProcessor::sanitizeInputs(
        readings.temperatureC, readings.humidityPct,
        readings.heartRateBpm, readings.spo2Pct);
    if (corrected) {
        Serial.println(F("[WARN] One or more sensor readings were out-of-range/NaN "
                          "and were clamped to safe bounds before inference."));
    }

    // ---- Preprocess: pack features (incl. Heat Index) + normalize ----
    float rawFeatures[HEATSHIELD_NUM_FEATURES];
    FeatureProcessor::packFeatures(readings.temperatureC, readings.humidityPct,
                                    readings.heartRateBpm, readings.spo2Pct, rawFeatures);

    float normalizedFeatures[HEATSHIELD_NUM_FEATURES];
    FeatureProcessor::normalize(rawFeatures, normalizedFeatures);

    // ---- Push fresh readings to the OLED's rotating Sensor Data page.
    // Sensors/inference keep running regardless of what's on screen or
    // whether the OLED is even connected (setSensorData/update() are
    // no-ops when !isReady()). ----
    displayManager.setSensorData(readings.temperatureC, readings.humidityPct,
                                  readings.heartRateBpm, readings.spo2Pct,
                                  rawFeatures[4], readings.fingerPresent);
    displayManager.update();

    // ---- Run inference ----
    InferenceResult result;
    bool inferenceOk = inference.predict(normalizedFeatures, result);

    // ---- Debug output (always printed, per project requirements) ----
    Serial.println(F("-----------------------------------------------"));
    Serial.print(F("Temperature       : ")); Serial.print(readings.temperatureC, 2); Serial.println(F(" C"));
    Serial.print(F("Humidity          : ")); Serial.print(readings.humidityPct, 2); Serial.println(F(" %"));
    if (readings.fingerPresent) {
        Serial.print(F("Heart Rate        : ")); Serial.print(readings.heartRateBpm, 1); Serial.println(F(" BPM"));
        Serial.print(F("SpO2              : ")); Serial.print(readings.spo2Pct, 1); Serial.println(F(" %"));
    } else {
        Serial.println(F("Heart Rate        : -- (place finger on sensor)"));
        Serial.println(F("SpO2              : -- (place finger on sensor)"));
    }
    if (readings.maxSensorOk) {
        Serial.print(F("MAX30102 IR Level : ")); Serial.print(readings.irDcLevel);
        Serial.println(readings.fingerPresent ? F(" (finger detected)") : F(" (no finger / calibrate threshold)"));
    }
    Serial.print(F("Heat Index        : ")); Serial.print(rawFeatures[4], 2); Serial.println(F(" C"));

    Serial.print(F("Normalized Inputs : ["));
    for (int i = 0; i < HEATSHIELD_NUM_FEATURES; i++) {
        Serial.print(normalizedFeatures[i], 4);
        if (i < HEATSHIELD_NUM_FEATURES - 1) Serial.print(F(", "));
    }
    Serial.println(F("]"));

    if (!inferenceOk) {
        Serial.print(F("[ERROR] Inference failed: "));
        Serial.println(inference.errorMessage());
        if (displayManager.isReady()) {
            displayManager.showSensorWarning("TFLite Invoke()");
        }
        delay(1000);
        return;
    }

    const char* className = HEATSHIELD_CLASS_NAMES[result.predictedClass];
    float confidencePercent = result.confidence * 100.0f;
    HeatStressLevel level = static_cast<HeatStressLevel>(result.predictedClass);

    Serial.print(F("Prediction        : ")); Serial.println(className);
    Serial.print(F("Confidence        : ")); Serial.print(confidencePercent, 1); Serial.println(F(" %"));

    Serial.print(F("Raw Probabilities : ["));
    for (int i = 0; i < HEATSHIELD_NUM_CLASSES; i++) {
        Serial.print(HEATSHIELD_CLASS_NAMES[i]);
        Serial.print(F("="));
        Serial.print(result.probabilities[i], 4);
        if (i < HEATSHIELD_NUM_CLASSES - 1) Serial.print(F(", "));
    }
    Serial.println(F("]"));

    Serial.print(F("Inference Time    : ")); Serial.print(result.inferenceTimeUs); Serial.println(F(" us"));
    Serial.print(F("Free Heap         : ")); Serial.print(ESP.getFreeHeap()); Serial.println(F(" bytes"));
    Serial.print(F("Flash Used        : ")); Serial.print(ESP.getSketchSize()); Serial.println(F(" bytes"));
    Serial.print(F("Model Size        : ")); Serial.print(inference.modelSizeBytes()); Serial.println(F(" bytes"));
    Serial.print(F("Tensor Arena Used : ")); Serial.print(inference.tensorArenaUsedBytes());
    Serial.print(F(" / ")); Serial.print(inference.tensorArenaSizeBytes()); Serial.println(F(" bytes"));

    // ---- Display + alerts ----
    alertManager.setLevel(level);
    displayManager.setPrediction(className, confidencePercent, alertManager.isAlertActive());
    displayManager.update();

    // ---- Send this cycle's reading to the gateway over LoRa ----
    HeatShieldLoRaPacket loraPacket{};
    loraPacket.magic = HEATSHIELD_LORA_MAGIC;
    loraPacket.sequenceNumber = loraSequenceNumber++;
    loraPacket.temperatureC = readings.temperatureC;
    loraPacket.humidityPct = readings.humidityPct;
    loraPacket.heartRateBpm = readings.heartRateBpm;
    loraPacket.spo2Pct = readings.spo2Pct;
    loraPacket.heatIndexC = rawFeatures[4];
    loraPacket.fingerPresent = readings.fingerPresent ? 1 : 0;
    loraPacket.predictedClass = static_cast<uint8_t>(result.predictedClass);
    loraPacket.confidencePercent = confidencePercent;

    if (loraManager.isReady()) {
        bool sent = loraManager.send(loraPacket);
        Serial.print(F("[LoRa] Packet #")); Serial.print(loraPacket.sequenceNumber);
        Serial.println(sent ? F(" sent to gateway.") : F(" send FAILED (radio busy/error)."));
    }

    // Actively poll the (non-blocking, millis()-based) alert pattern AND the
    // OLED page rotation for a while so: (a) an active WARNING/DANGER/
    // CRITICAL alert is actually audible/felt between sensor-read cycles,
    // and (b) the OLED keeps flipping pages every 5s even while we're not
    // inside a blocking sensor read. This always runs (not just when an
    // alert is active) so page rotation stays smooth in the SAFE state too.
    // No delay() is used to decide *when* to switch pages -- that decision
    // is made entirely by millis() comparisons inside displayManager.update();
    // the delay(10) below is just a cooperative CPU yield between polls.
    unsigned long pollStart = millis();
    while (millis() - pollStart < kPollWindowMs) {
        alertManager.update();
        displayManager.update();
        delay(10);
    }
}