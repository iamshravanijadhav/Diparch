// alerts.h
// ---------
// AlertManager: drives the buzzer and vibration motor with a non-blocking
// (millis()-based) pattern that escalates with heat-stress level. Uses
// digitalWrite only (no PWM/tone) so it works with the simplest possible
// active-buzzer + transistor-driven-vibration-motor wiring.

#ifndef HEATSHIELD_ALERTS_H
#define HEATSHIELD_ALERTS_H

#include <Arduino.h>

// See sensors.h for the full rationale on S3-safe pin selection: GPIO17/18
// are general-purpose pins clear of the flash/PSRAM bus, strapping pins,
// native USB, and the UART0 bridge pins.
#define HEATSHIELD_BUZZER_PIN 17
#define HEATSHIELD_VIBRATION_PIN 18

// Indices MUST match HEATSHIELD_CLASS_NAMES order in model_params.h /
// CLASS_NAMES in training/common.py: SAFE=0, WARNING=1, DANGER=2, CRITICAL=3.
enum class HeatStressLevel {
    SAFE = 0,
    WARNING = 1,
    DANGER = 2,
    CRITICAL = 3
};

class AlertManager {
public:
    void begin();

    // Sets the target alert level. Safe to call every loop iteration with
    // the same value; the pattern only resets when the level actually
    // changes.
    void setLevel(HeatStressLevel level);

    // Advances the buzzer/vibration pattern's non-blocking state machine.
    // Call this every loop() iteration (it returns immediately if nothing
    // needs to change yet).
    void update();

    bool isAlertActive() const { return currentLevel_ != HeatStressLevel::SAFE; }

private:
    HeatStressLevel currentLevel_ = HeatStressLevel::SAFE;
    bool outputOn_ = false;
    unsigned long lastToggleMs_ = 0;

    void applyOutputs(bool on);
    unsigned long onDurationMsFor(HeatStressLevel level) const;
    unsigned long offDurationMsFor(HeatStressLevel level) const;
};

#endif  // HEATSHIELD_ALERTS_H
