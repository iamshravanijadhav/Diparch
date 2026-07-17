# HeatShield AI

> AI-Powered Wearable for Heat Stress Prevention in Construction Workers

HeatShield AI is an intelligent wearable safety system developed by **Team DIPARCH** to help prevent heat-related illnesses among construction workers. The system combines **Edge AI (TinyML)**, **IoT**, and **real-time health monitoring** to predict heat stress and provide early alerts before critical conditions occur.

---

## 📁 Repository Structure

```
DIP/
│
├── firmware/
│   ├── HeatShieldAI/              # Main ESP32 wearable firmware
│   ├── HeatShieldAI_Dashboard/    # Backend Files
│   ├── HeatShieldAI_Gateway/      # LoRa Gateway firmware
│   └── HeatShieldAI_Mobile/       # Mobile application
│
├── HeatShieldAI/
│   ├── dataset/                   # Training datasets
│   ├── docs/                      # Documentation
│   ├── training/                  # TinyML model training
│   └── README.md                  # ML documentation
│
└── README.md
```

---

# 📦 Folder Description

## 📁 firmware/

Contains all software required to run the complete HeatShield AI ecosystem.

### HeatShieldAI

Main firmware running on the ESP32 wearable.

**Responsibilities**

- Read sensor data
- Run TinyML inference
- Display worker status
- Trigger alerts
- Send data to gateway

---

### HeatShieldAI_Dashboard

Supervisor dashboard for monitoring workers.

**Features**

- Live worker monitoring
- Risk level visualization
- Worker status
- Health analytics

---

### HeatShieldAI_Gateway

Gateway responsible for communication between wearable devices and the backend.

**Responsibilities**

- Receive LoRa packets
- Forward data
- Synchronize workers
- Maintain connectivity

---

### HeatShieldAI_Mobile

Mobile application for worker and supervisor access.

**Features**

- Live monitoring
- Alerts
- Notifications
- Worker information

---

## 📁 HeatShieldAI/

Contains all resources related to the TinyML model.

### dataset/

Training and testing datasets collected from wearable sensors.

---

### training/

Scripts and notebooks used to train the TinyML model.

Includes

- Data preprocessing
- Feature engineering
- Model training
- Model evaluation
- Model export

---

### docs/

Project documentation including

- Architecture
- Sensor specifications
- Model workflow
- Deployment guides

---

# 🚀 System Overview

```
Wearable (ESP32)
        │
        ▼
TinyML Prediction
        │
        ▼
LoRa Gateway
        │
        ▼
Cloud / Backend
        │
        ▼
Dashboard & Mobile App
```

---

# 🛠 Technology Stack

### Hardware

- ESP32
- MAX30102
- DHT22
- OLED Display
- Buzzer
- Vibration Motor
- LoRa Module

### Software

- PlatformIO
- Arduino Framework
- Node.js
- Firebase
- TinyML
- TensorFlow Lite Micro

---

# 🎯 Features

- Real-time heat stress prediction
- TinyML inference on-device
- Offline Edge AI
- OLED live display
- Buzzer and vibration alerts
- LoRa communication
- Live dashboard
- Mobile monitoring
- Low-power wearable design

---



## 📄 License

This repository is intended for academic research and startup prototype development by Team DIPARCH.
