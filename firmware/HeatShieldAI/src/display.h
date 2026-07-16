// display.h
// ----------
// DisplayManager: wraps the SSD1306 OLED (128x64, I2C) to show boot status,
// sensor warnings, and a continuously rotating two-page display:
//   Page 1 (Sensor Data): Temperature, Humidity, Heart Rate, Heat Index
//   Page 2 (Prediction):  Predicted class, Confidence, Alert status
//
// Rotation is driven entirely by millis() comparisons in update() -- no
// delay() is ever used to time the page switch. Sensor/inference data is
// pushed in via setSensorData()/setPrediction() whenever it's fresh (once
// per read/inference cycle); update() just decides, based on elapsed time,
// whether to flip pages and/or redraw with whatever the latest data is.
// Both setters and update() are no-ops if the OLED isn't ready, so sensors
// and inference keep running normally with the display disconnected.

#ifndef HEATSHIELD_DISPLAY_H
#define HEATSHIELD_DISPLAY_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define HEATSHIELD_OLED_WIDTH 128
#define HEATSHIELD_OLED_HEIGHT 64
#define HEATSHIELD_OLED_I2C_ADDRESS 0x3C
#define HEATSHIELD_OLED_RESET_PIN -1  // no dedicated reset pin; shares ESP32 reset

enum class DisplayPage : uint8_t {
    SensorData = 0,
    Prediction = 1,
};

class DisplayManager {
public:
    // Initializes the SSD1306 over the already-begun Wire bus. Returns
    // false (without crashing/blocking) if the display doesn't ACK on I2C,
    // so the firmware can keep running "headless" (Serial-only) if the
    // OLED is missing or miswired.
    bool begin();
    bool isReady() const { return ready_; }

    void showBootScreen(const char* line1, const char* line2 = "");

    // Immediately shows a one-off warning screen (e.g. sensor disconnected)
    // interrupting the page rotation. Rotation resumes automatically at the
    // next scheduled page change (within kRotationIntervalMs).
    void showSensorWarning(const char* sensorName);

    // Pushes fresh data for each rotating page. Cheap (just stores values);
    // safe to call every sensor-read / inference cycle regardless of which
    // page is currently showing. If the page currently on screen is the one
    // being updated, the new values are redrawn on the next update() call.
    void setSensorData(float temperatureC, float humidityPct, float heartRateBpm, float spo2Pct, float heatIndexC, bool fingerPresent);
    void setPrediction(const char* className, float confidencePercent, bool alertActive);

    // Call every loop() iteration (cheap: a couple of millis() comparisons
    // when there's nothing to do). Advances the page-rotation state machine
    // and redraws only when the page flips or new data arrived for the
    // currently-visible page. Never blocks.
    void update();

private:
    static const unsigned long kRotationIntervalMs = 5000;

    Adafruit_SSD1306 display_{HEATSHIELD_OLED_WIDTH, HEATSHIELD_OLED_HEIGHT, &Wire, HEATSHIELD_OLED_RESET_PIN};
    bool ready_ = false;

    DisplayPage currentPage_ = DisplayPage::SensorData;
    unsigned long lastRotateMs_ = 0;
    bool needsRedraw_ = true;

    // Latest sensor-page data
    float temperatureC_ = 0.0f;
    float humidityPct_ = 0.0f;
    float heartRateBpm_ = 0.0f;
    float spo2Pct_ = 0.0f;
    float heatIndexC_ = 0.0f;
    bool hasSensorData_ = false;
    bool fingerPresent_ = false;

    // Latest prediction-page data
    const char* className_ = "N/A";
    float confidencePercent_ = 0.0f;
    bool alertActive_ = false;
    bool hasPrediction_ = false;

    void drawSensorPage();
    void drawPredictionPage();
    void redraw();
};

#endif  // HEATSHIELD_DISPLAY_H