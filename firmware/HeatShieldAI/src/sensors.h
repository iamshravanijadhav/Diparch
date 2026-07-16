// sensors.h
// ----------
// SensorManager: owns and reads the DHT22 (temperature/humidity) and
// MAX30102 (heart rate/SpO2) sensors, with defensive handling for
// disconnected/invalid readings so the rest of the firmware never has to
// worry about NaN or garbage values reaching the model.

#ifndef HEATSHIELD_SENSORS_H
#define HEATSHIELD_SENSORS_H

#include <Arduino.h>
#include <DHT.h>
#include <MAX30105.h>

// ---- Pin assignments: ESP32-S3-WROOM-1 ----
// Chosen to avoid pins that are reserved/dangerous on the S3 regardless of
// the exact flash/PSRAM variant:
//   - GPIO26-32: SPI flash bus on every ESP32-S3-WROOM-1 module
//   - GPIO33-37: octal PSRAM/flash bus on R8/R32 variants (unused but
//     reserved on quad-PSRAM/no-PSRAM variants too, so left alone here)
//   - GPIO0, 3, 45, 46: strapping pins (boot mode / voltage select)
//   - GPIO19, 20: native USB D-/D+
//   - GPIO43, 44: default UART0 TX/RX (used by the USB-UART bridge chip)
#define HEATSHIELD_DHT_PIN 4
#define HEATSHIELD_DHT_TYPE DHT22
#define HEATSHIELD_I2C_SDA_PIN 8
#define HEATSHIELD_I2C_SCL_PIN 9

struct SensorReadings {
    float temperatureC;
    float humidityPct;
    float heartRateBpm;
    float spo2Pct;

    bool dhtValid;   // false if DHT22 read failed this cycle (NaN/timeout)
    bool maxValid;   // false if THIS cycle's window didn't yield a usable reading
                      // (can be a transient blip while a finger IS on -- e.g. it
                      // moved mid-window -- so heartRateBpm/spo2Pct still hold the
                      // last known-good number in that case)
    bool maxSensorOk;  // false if the MAX30102 IC itself failed to initialize

    // True only once we believe there is currently a finger on the sensor at
    // all (based on the perfusion-index check passing recently). False from
    // boot until the first genuine reading, and false again once enough
    // consecutive cycles have failed that we conclude the finger was
    // removed. UI code should use THIS (not maxValid) to decide whether to
    // show a number or a "Place finger" prompt -- maxValid alone can't tell
    // "no finger at all" apart from "finger present but this one window was
    // noisy".
    bool fingerPresent;

    // Raw MAX30102 IR DC level (mean of the collected window), exposed
    // purely for calibration: printed on Serial so kFingerPresenceIrThreshold
    // in sensors.cpp can be tuned to the actual sensor/finger/ambient-light
    // conditions instead of being a blind guess. 0 if maxSensorOk is false
    // or too few samples were collected to compute it.
    long irDcLevel;
};

class SensorManager {
public:
    // Initializes Wire (I2C), the DHT22, and the MAX30102. Never blocks
    // forever and never crashes: if a sensor fails to initialize, its *Ok
    // flag is left false and readAll() will report degraded (but not
    // fatal) readings for that sensor going forward.
    void begin();

    bool isDhtOk() const { return dhtOk_; }
    bool isMaxOk() const { return maxOk_; }

    // Reads DHT22 (near-instant) and collects a ~4 second MAX30102 pulse
    // window to estimate heart rate + SpO2 (blocking -- call this on the
    // main loop's own cadence, not from a tight loop). On any failure,
    // returns the last known-good value for that measurement with its
    // *Valid flag set false, so callers can decide how to react (e.g. keep
    // predicting with slightly stale data vs. flagging a sensor error on
    // the display) without ever receiving NaN.
    SensorReadings readAll();

private:
    DHT dht_{HEATSHIELD_DHT_PIN, HEATSHIELD_DHT_TYPE};
    MAX30105 particleSensor_;

    bool dhtOk_ = false;
    bool maxOk_ = false;

    float lastGoodTemperature_ = 28.0f;
    float lastGoodHumidity_ = 50.0f;
    float lastGoodHeartRate_ = 75.0f;
    float lastGoodSpo2_ = 97.0f;

    // FIX: how many consecutive cycles the MAX30102 has failed to produce a
    // valid (finger-present, enough real peaks) reading. Once this crosses
    // kMaxConsecutiveInvalidBeforeReset, lastGoodHeartRate_/lastGoodSpo2_ are
    // reset back to physiologically neutral defaults instead of being held
    // onto forever. Without this, a single noise-triggered "valid" reading
    // right after boot (or a brief false finger-detect) could contaminate
    // lastGood* and then be reported, unchanged, indefinitely as soon as no
    // finger is on the sensor -- which is exactly the "HR shown with no
    // finger placed" symptom.
    int consecutiveInvalidPulseReads_ = 0;
    bool hasEverHadValidPulse_ = false;

    void readDht(SensorReadings& out);
    void readPulseOx(SensorReadings& out);
};

#endif  // HEATSHIELD_SENSORS_H