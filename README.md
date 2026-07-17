# HeatShield AI

> AI-Powered Wearable for Heat Stress Prevention in Construction Workers

HeatShield AI is an intelligent wearable safety system developed by **Team DIPARCH** to help prevent heat-related illnesses among construction workers. The system combines **Edge AI (TinyML)**, **IoT**, and **real-time health monitoring** to predict heat stress and provide early alerts before critical conditions occur.

---

# 📁 Repository Structure

```
DIP/
│
├── firmware/
│   ├── HeatShieldAI/              # Main ESP32 Wearable Firmware
│   ├── HeatShieldAI_Dashboard/    # Backend Server & Dashboard Files
│   ├── HeatShieldAI_Gateway/      # LoRa Gateway Firmware
│   └── HeatShieldAI_Mobile/       # Mobile Application
│
├── HeatShieldAI/
│   ├── dataset/                   # Dataset used for model training
│   ├── docs/                      # Documentation
│   ├── training/                  # TinyML Model Training
│   └── README.md                  # ML Documentation
│
└── README.md
```

---

# 📦 Folder Description

## 📁 firmware/

Contains all firmware and application source code.

---

### 📟 HeatShieldAI

Firmware running on the ESP32 wearable.

#### Responsibilities

- Read sensor values
- Run TinyML inference
- Display data on OLED
- Trigger buzzer & vibration alerts
- Send data to backend

---

### 🌐 HeatShieldAI_Dashboard

Contains the complete backend server and dashboard application.

#### Responsibilities

- Receive data from ESP32
- Process incoming sensor data
- Store and manage worker information
- Display live dashboard
- Real-time monitoring
- WebSocket communication

---

### 📡 HeatShieldAI_Gateway

Firmware for the LoRa Gateway.

#### Responsibilities

- Receive LoRa packets
- Forward wearable data
- Maintain gateway communication

---

### 📱 HeatShieldAI_Mobile

Mobile application for workers and supervisors.

#### Features

- Live monitoring
- Notifications
- Worker information
- Health status

---

# 🤖 HeatShieldAI/

Contains everything related to the TinyML model.

### 📂 dataset/

Training and testing datasets.

---

### 📂 training/

Model training source code.

Includes

- Data preprocessing
- Feature engineering
- Model training
- Model evaluation
- Model export

---

### 📂 docs/

Documentation

- System Architecture
- Hardware Design
- TinyML Workflow
- Deployment Guide

---

# 🚀 System Architecture

```
Sensors
   │
   ▼
ESP32 Wearable
(TinyML Inference)
   │
   ▼
LoRa Gateway
   │
   ▼
Backend Server
(Node.js)
   │
   ▼
Dashboard / Mobile App
```

---

# 🛠 Technology Stack

## Hardware

- ESP32-32x
- ESP32-S3-Wroom1
- MAX30102
- DHT22
- OLED Display
- LoRa Module
- Buzzer
- Vibration Motor

## Software

- PlatformIO
- Arduino Framework
- Node.js
- Express.js
- Socket.IO
- Firebase
- TinyML
- TensorFlow Lite Micro

---

# 🎯 Features

- AI-powered heat stress prediction
- TinyML running on ESP32
- Offline Edge AI
- OLED live display
- Buzzer & vibration alerts
- Real-time dashboard
- LoRa communication
- Mobile support
- Low-power wearable

---

# ⚙️ Project Setup

## 1️⃣ Clone Repository

```bash
git clone https://github.com/<your-username>/HeatShieldAI.git

cd HeatShieldAI
```

---

# 2️⃣ Install PlatformIO

Install:

- VS Code
- PlatformIO Extension

Open

```
firmware/HeatShieldAI
```

---

# 3️⃣ Install Firmware Libraries

PlatformIO automatically installs all required libraries.

If using Arduino IDE, install:

- Adafruit GFX
- Adafruit SSD1306
- DHT Sensor Library
- SparkFun MAX3010x
- ArduinoJson

---

# 4️⃣ Upload Firmware

Connect ESP32.

Run

```bash
pio run

pio run --target upload
```

or

```bash
pio run -t upload
```

---

# 5️⃣ Backend Setup

Navigate to

```bash
cd firmware/HeatShieldAI_Dashboard
```

Install dependencies

```bash
npm install
```

Start backend

```bash
npm start
```

or

```bash
node server.js
```

Backend runs at

```
http://localhost:3000
```

---

# 6️⃣ Mobile App

Navigate to

```bash
cd firmware/HeatShieldAI_Mobile
```

Install dependencies

```bash
npm install
```

Start Expo

```bash
npx expo start
```

---

# 7️⃣ Gateway Setup

Navigate to

```
firmware/HeatShieldAI_Gateway
```

Open in PlatformIO and upload firmware to the gateway ESP32.

---

# 📡 Communication Flow

```
Sensors
      │
      ▼
ESP32 Wearable
      │
      ▼
LoRa Gateway
      │
      ▼
Backend Server
      │
      ▼
Dashboard
      │
      ▼
Mobile App
```

---



# 📄 License

This repository is intended for academic research and startup prototype development by **Team DIPARCH**.
