// display.cpp
// See display.h for the contract this file implements.

#include "display.h"

bool DisplayManager::begin() {
    // SSD1306_SWITCHCAPVCC: generate display voltage from 3.3V internally,
    // the standard setting for the common 128x64 SSD1306 breakout boards.
    ready_ = display_.begin(SSD1306_SWITCHCAPVCC, HEATSHIELD_OLED_I2C_ADDRESS);
    if (!ready_) {
        Serial.println(F("[DisplayManager] SSD1306 not detected on I2C bus."));
        return false;
    }
    display_.clearDisplay();
    display_.setTextColor(SSD1306_WHITE);
    display_.display();

    currentPage_ = DisplayPage::SensorData;
    lastRotateMs_ = millis();
    needsRedraw_ = true;
    return true;
}

void DisplayManager::showBootScreen(const char* line1, const char* line2) {
    if (!ready_) return;
    display_.clearDisplay();
    display_.setTextSize(1);
    display_.setCursor(0, 0);
    display_.println(F("HeatShield AI"));
    display_.println(F("------------------"));
    display_.setCursor(0, 24);
    display_.println(line1);
    if (line2 != nullptr && line2[0] != '\0') {
        display_.setCursor(0, 36);
        display_.println(line2);
    }
    display_.display();
}

void DisplayManager::showSensorWarning(const char* sensorName) {
    if (!ready_) return;
    display_.clearDisplay();
    display_.setTextSize(1);
    display_.setCursor(0, 0);
    display_.println(F("SENSOR WARNING"));
    display_.println(F("------------------"));
    display_.setCursor(0, 24);
    display_.print(sensorName);
    display_.println(F(" issue,"));
    display_.setCursor(0, 36);
    display_.println(F("using last good value."));
    display_.display();
    // Deliberately does NOT touch needsRedraw_/currentPage_: normal page
    // rotation resumes on its own at the next scheduled flip.
}

void DisplayManager::setSensorData(float temperatureC, float humidityPct,
                                    float heartRateBpm, float spo2Pct,
                                    float heatIndexC, bool fingerPresent) {
    temperatureC_ = temperatureC;
    humidityPct_ = humidityPct;
    heartRateBpm_ = heartRateBpm;
    spo2Pct_ = spo2Pct;
    heatIndexC_ = heatIndexC;
    fingerPresent_ = fingerPresent;
    hasSensorData_ = true;
    if (currentPage_ == DisplayPage::SensorData) {
        needsRedraw_ = true;
    }
}

void DisplayManager::setPrediction(const char* className, float confidencePercent, bool alertActive) {
    className_ = className;
    confidencePercent_ = confidencePercent;
    alertActive_ = alertActive;
    hasPrediction_ = true;
    if (currentPage_ == DisplayPage::Prediction) {
        needsRedraw_ = true;
    }
}

void DisplayManager::drawSensorPage() {
    display_.clearDisplay();

    display_.setTextSize(1);
    display_.setCursor(0, 0);
    display_.print(F("HeatShield AI"));
    display_.drawFastHLine(0, 10, HEATSHIELD_OLED_WIDTH, SSD1306_WHITE);

    if (!hasSensorData_) {
        display_.setCursor(0, 26);
        display_.println(F("Waiting for"));
        display_.setCursor(0, 36);
        display_.println(F("sensor data..."));
        display_.display();
        return;
    }

    display_.setCursor(0, 13);
    display_.print(F("Temp: "));
    display_.print(temperatureC_, 1);
    display_.println(F(" C"));

    display_.setCursor(0, 23);
    display_.print(F("Humidity: "));
    display_.print(humidityPct_, 1);
    display_.println(F(" %"));

    display_.setCursor(0, 33);
    if (fingerPresent_) {
        display_.print(F("HR: "));
        display_.print(heartRateBpm_, 1);
        display_.println(F(" BPM"));
    } else {
        display_.println(F("HR: -- (no finger)"));
    }

    display_.setCursor(0, 43);
    if (fingerPresent_) {
        display_.print(F("SpO2: "));
        display_.print(spo2Pct_, 1);
        display_.println(F(" %"));
    } else {
        display_.println(F("SpO2: -- (no finger)"));
    }

    display_.setCursor(0, 53);
    display_.print(F("Heat Index: "));
    display_.print(heatIndexC_, 1);
    display_.println(F("C"));

    display_.display();
}

void DisplayManager::drawPredictionPage() {
    display_.clearDisplay();

    display_.setTextSize(1);
    display_.setCursor(0, 0);
    display_.print(F("HeatShield AI"));
    if (hasPrediction_ && alertActive_) {
        display_.setCursor(100, 0);
        display_.print(F("[!]"));
    }
    display_.drawFastHLine(0, 10, HEATSHIELD_OLED_WIDTH, SSD1306_WHITE);

    if (!hasPrediction_) {
        display_.setCursor(0, 26);
        display_.println(F("Waiting for"));
        display_.setCursor(0, 36);
        display_.println(F("prediction..."));
        display_.display();
        return;
    }

    display_.setCursor(0, 14);
    display_.print(F("Heat Stress Level:"));

    display_.setTextSize(2);
    display_.setCursor(0, 24);
    display_.println(className_);

    display_.setTextSize(1);
    display_.setCursor(0, 44);
    display_.print(F("Confidence: "));
    display_.print(confidencePercent_, 1);
    display_.print(F("%"));

    display_.setCursor(0, 54);
    display_.print(F("Alert: "));
    display_.print(alertActive_ ? F("ACTIVE") : F("SAFE"));

    display_.display();
}

void DisplayManager::redraw() {
    if (!ready_) return;
    if (currentPage_ == DisplayPage::SensorData) {
        drawSensorPage();
    } else {
        drawPredictionPage();
    }
}

void DisplayManager::update() {
    if (!ready_) return;

    unsigned long now = millis();
    if (now - lastRotateMs_ >= kRotationIntervalMs) {
        currentPage_ = (currentPage_ == DisplayPage::SensorData) ? DisplayPage::Prediction
                                                                   : DisplayPage::SensorData;
        lastRotateMs_ = now;
        needsRedraw_ = true;
    }

    if (needsRedraw_) {
        redraw();
        needsRedraw_ = false;
    }
}