// alerts.cpp
// See alerts.h for the contract this file implements.

#include "alerts.h"

void AlertManager::begin() {
    pinMode(HEATSHIELD_BUZZER_PIN, OUTPUT);
    pinMode(HEATSHIELD_VIBRATION_PIN, OUTPUT);
    applyOutputs(false);
    currentLevel_ = HeatStressLevel::SAFE;
    outputOn_ = false;
    lastToggleMs_ = millis();
}

void AlertManager::applyOutputs(bool on) {
    digitalWrite(HEATSHIELD_BUZZER_PIN, on ? HIGH : LOW);
    digitalWrite(HEATSHIELD_VIBRATION_PIN, on ? HIGH : LOW);
    outputOn_ = on;
}

unsigned long AlertManager::onDurationMsFor(HeatStressLevel level) const {
    switch (level) {
        case HeatStressLevel::WARNING:  return 150;
        case HeatStressLevel::DANGER:   return 300;
        case HeatStressLevel::CRITICAL: return 800;
        default:                        return 0;
    }
}

unsigned long AlertManager::offDurationMsFor(HeatStressLevel level) const {
    switch (level) {
        case HeatStressLevel::WARNING:  return 2850;  // gentle, occasional reminder
        case HeatStressLevel::DANGER:   return 700;   // more frequent pulsing
        case HeatStressLevel::CRITICAL: return 200;   // near-continuous alarm
        default:                        return 0;
    }
}

void AlertManager::setLevel(HeatStressLevel level) {
    if (level == currentLevel_) {
        return;
    }
    currentLevel_ = level;
    lastToggleMs_ = millis();
    applyOutputs(false);

    if (currentLevel_ == HeatStressLevel::SAFE) {
        return;
    }
    // Start the new pattern immediately with an "on" pulse so the wearer
    // gets instant feedback on an escalation rather than waiting out the
    // first off-duration.
    applyOutputs(true);
}

void AlertManager::update() {
    if (currentLevel_ == HeatStressLevel::SAFE) {
        if (outputOn_) {
            applyOutputs(false);
        }
        return;
    }

    unsigned long now = millis();
    unsigned long elapsed = now - lastToggleMs_;
    unsigned long threshold = outputOn_ ? onDurationMsFor(currentLevel_)
                                         : offDurationMsFor(currentLevel_);

    if (elapsed >= threshold) {
        applyOutputs(!outputOn_);
        lastToggleMs_ = now;
    }
}
