// lora_manager.h
// --------------
// LoRaManager: sends HeatShieldLoRaPacket readings from this ESP32-S3 node
// to the classic-ESP32 gateway over an SX1278 ("Ra-02") 433MHz LoRa module.
// Point-to-point, fire-and-forget (no ack) -- fine for a periodic telemetry
// link where the next packet a few seconds later supersedes a lost one.
//
// NOTE ON THE FILE NAME: deliberately NOT named lora.h/lora.cpp. Windows'
// case-insensitive filesystem would otherwise make `#include <LoRa.h>`
// (the sandeepmistry/LoRa library's own header) resolve right back to this
// project-local file instead of the library, since the project's src/
// directory is searched before library include paths -- a real bug hit
// while developing this on Windows.

#ifndef HEATSHIELD_LORA_MANAGER_H
#define HEATSHIELD_LORA_MANAGER_H

#include <Arduino.h>
#include "lora_packet.h"

// ---- Pin assignments: SX1278 "Ra-02" module on the 7Semi ESP32-S3 DevKit ----
// Chosen clear of pins already used elsewhere in this firmware (DHT22=4,
// I2C/MAX30102+OLED=8/9, buzzer=17, vibration motor=18) and clear of the
// S3's flash/PSRAM bus, strapping pins, and native-USB pins (see sensors.h
// for the full rationale). All six pins below are broken out on the
// 7Semi board's header.
#define HEATSHIELD_LORA_SCK_PIN  12
#define HEATSHIELD_LORA_MISO_PIN 13
#define HEATSHIELD_LORA_MOSI_PIN 11
#define HEATSHIELD_LORA_NSS_PIN  10
#define HEATSHIELD_LORA_RST_PIN  14
#define HEATSHIELD_LORA_DIO0_PIN 6

#define HEATSHIELD_LORA_FREQUENCY_HZ 433E6

class LoRaManager {
public:
    // Configures SPI on the pins above and brings up the SX1278 at
    // HEATSHIELD_LORA_FREQUENCY_HZ. Never blocks forever: returns false
    // (without crashing) if the module doesn't respond on SPI, matching the
    // rest of this codebase's "degrade, don't crash" pattern -- sensors and
    // inference keep running with telemetry simply not going out.
    bool begin();
    bool isReady() const { return ready_; }

    // Sends one reading as a HeatShieldLoRaPacket (blocks for the packet's
    // airtime, typically well under 200ms at the spreading factor/bandwidth
    // configured in begin()). Returns false if begin() never succeeded or
    // the radio reported a transmit failure.
    bool send(const HeatShieldLoRaPacket& packet);

private:
    bool ready_ = false;
};

#endif  // HEATSHIELD_LORA_MANAGER_H
