// lora_manager.cpp
// See lora_manager.h for the contract this file implements.

#include "lora_manager.h"
#include <SPI.h>
#include <LoRa.h>
#include <string.h>

bool LoRaGatewayManager::begin() {
    SPI.begin(HEATSHIELD_LORA_SCK_PIN, HEATSHIELD_LORA_MISO_PIN,
              HEATSHIELD_LORA_MOSI_PIN, HEATSHIELD_LORA_NSS_PIN);
    LoRa.setPins(HEATSHIELD_LORA_NSS_PIN, HEATSHIELD_LORA_RST_PIN, HEATSHIELD_LORA_DIO0_PIN);

    ready_ = LoRa.begin(HEATSHIELD_LORA_FREQUENCY_HZ);
    if (!ready_) {
        Serial.println(F("[LoRaGatewayManager] SX1278 not detected on SPI bus."));
        return false;
    }

    // MUST match the node's radio settings (../HeatShieldAI/src/lora_manager.cpp)
    // exactly -- spreading factor, bandwidth, and coding rate all have to
    // agree on both ends for the demodulator to lock onto the signal.
    LoRa.setSpreadingFactor(9);
    LoRa.setSignalBandwidth(125E3);
    LoRa.setCodingRate4(5);
    return true;
}

LoRaReceiveResult LoRaGatewayManager::tryReceive(HeatShieldLoRaPacket& out, int& rssi, float& snr) {
    if (!ready_) return LoRaReceiveResult::kNone;

    int packetSize = LoRa.parsePacket();
    if (packetSize == 0) {
        return LoRaReceiveResult::kNone;
    }

    if (packetSize != (int)sizeof(HeatShieldLoRaPacket)) {
        // Drain the unexpected payload so the FIFO doesn't wedge on the
        // next parsePacket() call.
        while (LoRa.available()) LoRa.read();
        return LoRaReceiveResult::kInvalidSize;
    }

    uint8_t buffer[sizeof(HeatShieldLoRaPacket)];
    for (size_t i = 0; i < sizeof(buffer) && LoRa.available(); i++) {
        buffer[i] = (uint8_t)LoRa.read();
    }
    memcpy(&out, buffer, sizeof(out));

    if (out.magic != HEATSHIELD_LORA_MAGIC) {
        return LoRaReceiveResult::kBadMagic;
    }

    rssi = LoRa.packetRssi();
    snr = LoRa.packetSnr();
    return LoRaReceiveResult::kValid;
}
