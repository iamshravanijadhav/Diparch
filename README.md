# DIPARCH | HeatShield ⛏️

### An AI-Powered Safety Band for Mine Workers

**HeatShield** is a smart wearable safety system designed to help protect mine workers from heat stress, toxic gases, low oxygen, dust exposure, fatigue, and falls.

Developed by **DIPARCH**, HeatShield combines sensors, Edge AI (TinyML), and LoRa wireless communication to detect potential hazards, alert workers, and send information to a local monitoring dashboard—even in underground mines without an internet connection.

> **Vishwakarma Awards 2026–27**
>
> - **Application ID:** VK26-IITH-SM-0006
> - **Theme:** Mining
> - **Sub-theme:** Worker Health, Safety & Environmental Hazard Tracking
> - **Team:** Shravani Jadhav and Tanmay Baranwal
> - **Submission:** Stage 2 — Design Specification

---

## 📌 The Problem

Mine workers face dangerous conditions every day. Some hazards are difficult to notice before they cause serious harm.

The major problems include:

- **Heat Stress:** High temperatures and humidity can cause exhaustion, dizziness, and collapse.
- **Toxic Gases:** Carbon monoxide (CO) and hydrogen sulphide (H₂S) can be harmful, while methane (CH₄) can create explosion risks.
- **Low Oxygen:** Oxygen-deficient environments can cause workers to lose consciousness.
- **Dust Exposure:** Fine coal and silica dust can damage workers' respiratory health.
- **Fatigue and Falls:** Workers may become exhausted or fall and remain unnoticed when working alone.
- **Poor Connectivity:** Underground mines often have limited mobile network coverage, delaying emergency communication.

Traditional manual checks and fixed sensors may not detect every hazard at the exact location of a worker.

**Our goal is to bring safety monitoring closer to the worker and provide early warnings before a situation becomes critical.**

## 💡 Our Solution

HeatShield is a wearable safety band designed to be worn on the upper arm.

It monitors selected environmental conditions and worker health indicators, checks for dangerous conditions, and alerts workers using vibration, sound, and lights.

The system is designed to work with a local LoRa communication network, allowing information to reach a control-room dashboard without depending on mobile internet.

### How HeatShield Helps

- Monitors selected gases and environmental conditions.
- Tracks heart rate, skin temperature, and movement.
- Uses Edge AI to assess potential heat strain and other risks.
- Alerts workers locally when configured safety limits are crossed.
- Sends alerts to a local gateway and dashboard.
- Supports fall detection and emergency SOS alerts.
- Stores safety and exposure records for later review.

## ✨ Key Features

### 1. Real-Time Hazard Monitoring
The band is designed to monitor selected gases, air conditions, and worker-health indicators at regular intervals.

### 2. Edge AI and TinyML
A lightweight machine-learning model is planned to run directly on the ESP32-S3, allowing risk assessment without requiring cloud processing.

### 3. Offline Operation
The band communicates with repeater nodes and a local gateway using LoRa. Core monitoring and alert functions are designed to work without an internet connection.

### 4. Multiple Alert Mechanisms
The band includes:
- Vibration motor
- Audible buzzer
- Status light ring
- SOS/OK button

These provide different ways to communicate warnings in noisy and low-visibility environments.

### 5. Worker Health and Fall Monitoring
Heart-rate, skin-temperature, and motion sensors are intended to help identify potential worker distress and fall-related events.

### 6. Area Dust Monitoring
Fixed repeater nodes are designed to measure dust levels in the surrounding mine area. Optional H₂S sensing is also proposed for these nodes.

### 7. Local Monitoring Dashboard
A local gateway and dashboard are planned to display alerts, hazard information, and exposure records for safety officers.

### 8. Cost-Conscious Design
The Stage 2 design estimates the cost of one prototype band at **₹9,218**, with a future production target of ₹6,000 or less per band at 1,000 units.

---

## ⚙️ How It Works

The proposed system follows this workflow:

1. **Sense:** Sensors collect gas, environmental, heart-rate, skin-temperature, and motion readings.
2. **Check:** The firmware checks configured safety limits and urgent events.
3. **Assess:** A TinyML model calculates a risk score at regular intervals.
4. **Alert:** The band uses vibration, sound, and lights to warn the worker.
5. **Communicate:** LoRa sends status and alert messages through the repeater network.
6. **Monitor:** A local gateway receives information and displays it on the dashboard.
7. **Escalate:** If an urgent alert is not acknowledged, the proposed system can escalate it to the safety officer and rescue team.
8. **Record:** Events and exposure information are stored for later review.

*These behaviours and timings are design targets that require implementation and testing.*

---

## 🏗️ System Architecture

```text
             ┌──────────────────────────┐
             │     HEATSHIELD BAND      │
             │                          │
             │  Gas and air sensors     │
             │  Heart-rate sensor       │
             │  Skin-temperature sensor │
             │  Motion and fall sensing │
             │                          │
             │  ESP32-S3 + TinyML        │
             │  Vibration + Buzzer       │
             │  Status Light + SOS      │
             └────────────┬─────────────┘
                          │
                     LoRa Radio
                          │
                          ▼
             ┌──────────────────────────┐
             │     REPEATER NODES       │
             │                          │
             │  Relay radio messages    │
             │  Measure area dust       │
             │  Optional H₂S sensing    │
             └────────────┬─────────────┘
                          │
                     LoRa Radio
                          │
                          ▼
             ┌──────────────────────────┐
             │      EDGE GATEWAY        │
             │                          │
             │  Raspberry Pi 4          │
             │  Local Server            │
             │  Message Processing      │
             └────────────┬─────────────┘
                          │
                          ▼
             ┌──────────────────────────┐
             │   SAFETY DASHBOARD       │
             │                          │
             │  Hazard Monitoring       │
             │  Alerts and Notifications│
             │  Exposure Records        │
             │  Safety Reports          │
             └──────────────────────────┘
```

The architecture is designed to keep the main monitoring and alert pathway operational without cloud connectivity. Cloud synchronisation is optional.

---

## 🔩 Hardware Components

The following components are specified in the Stage 2 design.

| Component | Purpose |
|---|---|
| ESP32-S3-MINI-1 | Main controller for sensing and planned Edge AI processing |
| Ai-Thinker Ra-01SH / SX1262 | LoRa wireless communication |
| Winsen MC113 | Methane detection |
| Winsen ME2-CO | Carbon monoxide detection |
| Winsen ME2-O2 | Oxygen monitoring |
| Sensirion SHT40 | Air temperature and humidity |
| Bosch BMP280 | Air pressure measurement |
| MAX30102 | Heart-rate sensing |
| 10 kΩ NTC thermistor | Skin-temperature measurement |
| ST LIS2DH12 | Motion and fall-related sensing |
| Plantower PMS7003 | Area dust monitoring on repeater nodes |
| Optional H₂S sensor | Hydrogen sulphide monitoring on repeater nodes |
| 3000 mAh 18650 Li-ion battery | Power supply |
| Vibration motor | Tactile alerts |
| Piezo buzzer | Audible alerts |
| WS2812 light ring | Visual status and warnings |
| Raspberry Pi 4 | Local gateway and dashboard host |

**Note:** These are the components selected in the design specification. Their procurement, assembly, calibration, and testing must be confirmed separately.

---

## 🧠 AI and Safety Logic

HeatShield is designed to use two complementary approaches.

### Fixed Safety Rules

The firmware is planned to check configured limits for gas readings, oxygen levels, falls, and SOS events.

**Fixed safety checks take priority over AI predictions.** The AI model must not delay a configured gas or other urgent safety alarm.

### TinyML Risk Assessment

The proposed model is a small decision-tree ensemble or a tiny 1D-CNN, using an 8-bit model.

The design targets:
- Model size below 50 KB.
- On-device inference in under 10 milliseconds.
- Risk scoring every 30 seconds.
- A risk score from 0 to 100.

Planned model inputs include:

- Heart rate and its trend
- Skin temperature and estimated core temperature
- Activity and movement
- Air temperature and humidity
- Heat index
- Gas readings
- Area dust readings

The proposed risk levels are:

| Level | Proposed score | Meaning |
|---|---:|---|
| 🟢 Green | Below 40 | Lower detected risk |
| 🟠 Amber | 40–70 | Warning; worker may need rest or other action |
| 🔴 Red | Above 70 | High detected risk; stronger alert |

The model is planned to be trained and evaluated using public heat-strain data, laboratory tests, and pilot data collected with worker consent.

**The model and thresholds are design-stage proposals, not validated safety predictions.**

---

## 📡 Communication Without Internet

Underground connectivity is one of the major challenges addressed by HeatShield.

The proposed LoRa network connects the band to fixed repeater nodes and a local gateway.

- The band sends status and alerts over LoRa.
- Repeater nodes help carry messages through the mine.
- A gateway receives messages and runs the local monitoring service.
- Safety officers can view information through a local dashboard.
- Cloud synchronisation can be added when internet connectivity is available.

### Communication Design Targets

| Parameter | Target |
|---|---|
| LoRa frequency | 865–867 MHz |
| Repeater spacing | Approximately 150–250 metres per hop |
| Dashboard alert delivery | Under 30 seconds |
| Network | Local LoRa radio mesh |
| Internet requirement | Not required for the designed local alert pathway |

Actual radio coverage, latency, and reliability must be verified in representative mine environments.

---

## 📊 Design Specifications

| Parameter | Stage 2 Design Target |
|---|---|
| Band dimensions | 68 × 92 × 32 mm |
| Weight | 190 g or less, including strap |
| Battery capacity | 3000 mAh |
| Target runtime | At least 16 hours |
| Estimated runtime | Approximately 24 hours based on the design's battery-budget calculation |
| Sensor sampling interval | Every 2 seconds |
| AI risk assessment | Every 30 seconds |
| Area dust sampling | Every minute |
| On-band alarm | Under 3 seconds after a configured limit is crossed |
| Dashboard alert | Under 30 seconds |
| Enclosure protection target | IP67 |
| Estimated prototype band cost | ₹9,218 |
| Future production cost target | ₹6,000 or less per band at 1,000 units |

**All figures above are design targets or estimates, not verified prototype performance or certification results.**

---

## 💰 Prototype Cost Estimate

The Stage 2 bill of materials estimates the cost of one prototype band at **₹9,218**.

The proposed Stage 3 demonstration kit is estimated at approximately **₹0.49 lakh**, including:

- Three safety bands
- Two repeater nodes with dust sensors
- One gateway
- One charging dock
- Test gas for demonstrations

The future production target is ₹6,000 or less per band at 1,000 units.

These costs are estimates based on the component prices and assumptions documented in October 2026. Final costs may change with supplier quotations, assembly, testing, certification, and deployment requirements.

---

## 🚧 Current Project Status

HeatShield was presented at **Vishwakarma Awards 2026–27, Stage 2 — Design Specification**.

The submitted design documents the following work:

- Parametric 3D CAD design and STEP export
- Strap-lug finite-element analysis (FEA) for two design versions
- Electronics connection plan
- Power distribution design
- Battery-budget calculation
- Hardware bill of materials
- Firmware logic and flowchart
- TinyML model design
- System architecture
- Safety and risk-mitigation planning
- Proposed fabrication and testing roadmap

**Important:** The Stage 2 submission states that the physical prototype had not yet been started. Hardware integration, firmware implementation, AI validation, radio testing, and dashboard integration should therefore be treated as planned work unless their completion is separately verified.

---

## 🗺️ Roadmap

The submitted design proposes a four-month development plan, subject to the availability of prototyping funds.

| Planned Period | Milestones |
|---|---|
| November 2026 | Finalise mechanical CAD, print the first enclosure, prepare the PCB design, and order components |
| December 2026 | Revise the enclosure, assemble the PCB, and bring up sensor drivers and safety alarms |
| January 2027 | Conduct enclosure and drop tests, integrate TinyML and LoRa, and develop the gateway and dashboard |
| February 2027 | Tune alerts, test radio range, complete integration, and prepare the Stage 3 demonstration kit |

### Planned Stage 3 Demonstration

The proposed demonstration will include:

- A gas alarm using test gas
- A heat-strain warning during a treadmill test
- A man-down alert
- A band-to-dashboard alert with a target delivery time under 30 seconds

These are planned milestones and are not presented as completed tests.

---

## 🛡️ Safety and Limitations

HeatShield is designed to support mine safety, not replace certified safety equipment or trained safety personnel.

Before deployment in a working mine, the system will require appropriate engineering validation, sensor calibration, testing, and regulatory approvals.

The Stage 2 design identifies relevant standards and approval pathways, including:

- IS/IEC 60079-0 and IS/IEC 60079-11
- IEC 60079-29-1
- EN 45544 and EN 50104
- IEC 60529 for enclosure protection
- IEC 62133-2 and IS 16046 for battery safety
- ISO 7243 and ISO 9886 for heat-strain-related considerations
- Appropriate DGMS-related testing and approval

Key areas requiring validation include gas sensor accuracy, ignition safety, radio reliability, battery behaviour, dust and moisture protection, fall detection, false alarms, and missed detections.

**HeatShield must not be used as the sole means of protecting workers until the system has been appropriately validated and approved.**

---

## 👥 Team

### DIPARCH — HeatShield

- **Shravani Jadhav**
- **Tanmay Baranwal**

**Vishwakarma Awards 2026–27**  
Application ID: `VK26-IITH-SM-0006`

---

## 📚 References

The Stage 2 submission lists the following source material:

1. ETV Bharat (13 August 2026), *141 Die In Coal Mine Accidents In Two Years: Government*.
2. *Monitoring and Assessment of Airborne Respirable Limestone Dust and Free Silica Content in an Indian Mine*. [PubMed Central](https://pmc.ncbi.nlm.nih.gov/articles/PMC6711325/)
3. Winsen — [MC113 combustible-gas sensor](https://www.winsen-sensor.com/)
4. Buller, M. J. et al. (2013), *Estimation of human core temperature from sequential heart rate observations*, Physiological Measurement, 34(7).
5. Standards listed in the submission: IS/IEC 60079-0, IS/IEC 60079-11, IEC 60079-29-1, EN 45544, EN 50104, IEC 60529, IEC 62133-2, IS 16046, ISO 7243, and ISO 9886.

Refer to the Vishwakarma Awards Stage 2 design specification for the full references, calculations, component assumptions, and proposed validation plan.

---

**DIPARCH | Building practical technology for safer workplaces.**
