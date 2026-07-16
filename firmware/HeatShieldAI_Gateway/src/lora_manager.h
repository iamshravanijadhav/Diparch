// lora_manager.h
// --------------
// LoRaGatewayManager: receives HeatShieldLoRaPacket telemetry from the
// ESP32-S3 sensor node over an SX1278 ("Ra-02") 433MHz LoRa module.
//
// NOTE ON THE FILE NAME: deliberately NOT named lora.h/lora.cpp. Windows'
// case-insensitive filesystem would otherwise make `#include <LoRa.h>` (the
// sandeepmistry/LoRa library's own header) resolve right back to this
// project-local file instead of the library, since the project's src/
// directory is searched before library include paths.
//
// The radio settings configured in begin() (spreading factor, bandwidth,
// coding rate, sync word) MUST match the node's ../HeatShieldAI/src/
// lora_manager.cpp exactly, or the two ends won't demodulate each other.

#ifndef HEATSHIELD_LORA_MANAGER_H
#define HEATSHIELD_LORA_MANAGER_H

#include <Arduino.h>
#include "lora_packet.h"

// ---- Pin assignments: SX1278 "Ra-02" module on the classic ESP32 devkit ----
// Standard hardware-VSPI pins for the classic ESP32 (the same convention
// used by almost every ESP32+SX1278 LoRa tutorial), since this board has no
// other peripherals to avoid conflicting with.
#define HEATSHIELD_LORA_SCK_PIN  18
#define HEATSHIELD_LORA_MISO_PIN 19
#define HEATSHIELD_LORA_MOSI_PIN 23
#define HEATSHIELD_LORA_NSS_PIN  5
#define HEATSHIELD_LORA_RST_PIN  14
#define HEATSHIELD_LORA_DIO0_PIN 2

#define HEATSHIELD_LORA_FREQUENCY_HZ 433E6

enum class LoRaReceiveResult {
    kNone,        // nothing waiting this poll -- not an error
    kInvalidSize, // a packet arrived but wasn't sizeof(HeatShieldLoRaPacket) -- noise/collision
    kBadMagic,    // right size but failed the magic-byte sanity check -- corruption/other sender
    kValid        // decoded successfully; out/rssi/snr are populated
};

class LoRaGatewayManager {
public:
    // Configures SPI on the pins above and brings up the SX1278 at
    // HEATSHIELD_LORA_FREQUENCY_HZ. Returns false (without crashing) if the
    // module doesn't respond on SPI.
    bool begin();
    bool isReady() const { return ready_; }

    // Non-blocking: call every loop() iteration. Returns kNone immediately
    // if no packet is waiting.
    LoRaReceiveResult tryReceive(HeatShieldLoRaPacket& out, int& rssi, float& snr);

private:
    bool ready_ = false;
};

#endif  // HEATSHIELD_LORA_MANAGER_H
