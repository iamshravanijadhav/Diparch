// lora_manager.cpp
// See lora_manager.h for the contract this file implements.

#include "lora_manager.h"
#include <SPI.h>
#include <LoRa.h>

bool LoRaManager::begin() {
    // Remap SPI onto our chosen GPIOs (ESP32/ESP32-S3's GPIO matrix lets any
    // pin drive SPI, unlike MCUs with fixed SPI pins) before LoRa.begin()
    // touches the bus.
    SPI.begin(HEATSHIELD_LORA_SCK_PIN, HEATSHIELD_LORA_MISO_PIN,
              HEATSHIELD_LORA_MOSI_PIN, HEATSHIELD_LORA_NSS_PIN);
    LoRa.setPins(HEATSHIELD_LORA_NSS_PIN, HEATSHIELD_LORA_RST_PIN, HEATSHIELD_LORA_DIO0_PIN);

    ready_ = LoRa.begin(HEATSHIELD_LORA_FREQUENCY_HZ);
    if (!ready_) {
        Serial.println(F("[LoRaManager] SX1278 not detected on SPI bus. "
                          "Telemetry will not be sent until reconnected."));
        return false;
    }

    // Favor range/reliability over throughput -- this link only needs to
    // carry one ~31-byte packet every few seconds, not a high data rate.
    LoRa.setSpreadingFactor(9);
    LoRa.setSignalBandwidth(125E3);
    LoRa.setCodingRate4(5);
    LoRa.setTxPower(17);
    return true;
}

bool LoRaManager::send(const HeatShieldLoRaPacket& packet) {
    if (!ready_) return false;
    LoRa.beginPacket();
    LoRa.write(reinterpret_cast<const uint8_t*>(&packet), sizeof(packet));
    return LoRa.endPacket() == 1;
}
