# Trinity CareView - Project Documentation

## Overview

Trinity CareView is a React Native (0.81.4) mobile app for iOS and Android designed for **remote patient monitoring of high-risk pregnancies**. It connects to iHealth medical devices (blood pressure monitors, weight scales) via Bluetooth, captures vital signs, and syncs data to the Trinity EMR system. The app also administers clinical screening questionnaires (daily health checks, urine protein tests) to monitor for preeclampsia.

**Package name:** `com.trinitycareview.app`
**Internal codename:** `cvdemo`

---

## Architecture

### Tech Stack
- **Framework:** React Native 0.81.4 with TypeScript
- **State Management:** Redux Toolkit (@reduxjs/toolkit)
- **Navigation:** React Navigation 7 (native-stack + bottom-tabs)
- **Local Database:** react-native-quick-sqlite
- **BLE/Devices:** Custom native module (`react-native-ihealth-devices`)
- **Charts:** react-native-gifted-charts / victory-native
- **Camera:** react-native-vision-camera (QR scanning)

### Project Structure
```
src/
  screens/
    Auth/         - Phone-based SMS login (AuthScreen, CodeVerifyScreen)
    Dashboard/    - Main hub with tips, latest readings, device grid
    Capture/      - Device measurement flow (BLE connect → measure → save)
    Devices/      - Device management (list, add, scan QR, rename)
    History/      - Reading history with charts, export CSV, sync status
    Profile/      - User info, provider details, messaging, sign out
  services/
    authService.ts           - SMS auth via trinityemr.com API
    deviceService.ts         - Unified BLE device management layer
    vitalsSyncService.ts     - Syncs readings + screenings to EMR
    screeningSyncService.ts  - Standalone screening sync service
    sqliteService.ts         - SQLite database layer (users, devices, readings, screenings)
    seedDemoData.ts          - 60-day demo data generator for testing
  redux/
    store.ts          - Redux store config
    userSlice.ts      - Auth state, BP thresholds, provider info
    deviceSlice.ts    - Registered device management
    readingSlice.ts   - Vital sign readings
  components/
    DailyHealthCheckModal.tsx  - Preeclampsia symptom screening
    UrineProteinModal.tsx      - Urine protein test results
    SendMessageModal.tsx       - Patient-to-care-team messaging
    SyncStatusBadge.tsx        - Cloud sync status indicator
    RenameDeviceModal.tsx      - Device rename dialog
    Toast/                     - Global toast notification system
  hooks/
    useVitalsSync.ts   - React hook for sync state + actions
  navigation/
    AppNavigator.tsx        - Root: auth vs main routing
    TabNavigator.tsx        - Bottom tabs (Dashboard, Devices, History, Profile)
    DashboardNavigator.tsx  - Dashboard stack (home + capture)
    DevicesNavigator.tsx    - Devices stack (list, add, QR scan, capture)
    HistoryNavigator.tsx    - History stack
    ProfileNavigator.tsx    - Profile stack (profile + wipe data)
  constants/
    pregnancyTips.ts   - 280 daily pregnancy wellness tips
  utils/
    getDailyTip.ts     - Rotating daily tip selector
modules/
  react-native-ihealth-devices/   - Custom native BLE module
    src/                          - TypeScript bridge (manager, hooks, types)
    android/                      - Kotlin native (iHealth SDK integration)
    ios/                          - Objective-C native (iHealth SDK + CoreBluetooth GATT)
```

---

## API Endpoints (trinityemr.com / trinitycareview.com)

All API calls use POST with JSON bodies.

### Authentication
| Endpoint | Purpose | Service |
|----------|---------|---------|
| `https://trinityemr.com/api/careviewapp/send_code.php` | Send SMS verification code | authService.ts |
| `https://trinityemr.com/api/careviewapp/verify_code.php` | Verify code, return patient profile + BP thresholds | authService.ts |

### Data Sync
| Endpoint | Purpose | Service |
|----------|---------|---------|
| `https://trinitycareview.com/api/careviewapp/vitals_sync.php` | Sync BP/weight readings | vitalsSyncService.ts |
| `https://trinitycareview.com/api/careviewapp/screening_sync.php` | Sync screening responses (via vitals service) | vitalsSyncService.ts |
| `https://appapi.trinityhhs.com/api/careviewapp/screening_sync.php` | Sync screening responses (standalone) | screeningSyncService.ts |

### Messaging
| Endpoint | Purpose | Service |
|----------|---------|---------|
| `https://trinitycareview.com/api/careviewapp/app_messenger.php` | Patient sends message to care team | SendMessageModal.tsx |

### API Key
All sync endpoints use the same API key: `dc9a8e0f685349ab93c0e06f417ff7f8c13fbbac170b71270b55bd2ba7c3ba85`

### Sync Payload Structures

**Vitals Sync (POST body):**
```json
{
  "patient_id": "string",
  "vitals": [
    {
      "id": "nanoid",
      "type": "BP" | "SCALE",
      "value": 120,
      "value2": 80,
      "heartRate": 72,
      "unit": "mmHg" | "lbs",
      "ts": 1712345678000,
      "measurement_condition": "string"
    }
  ]
}
```

**Screening Sync (POST body):**
```json
{
  "patient_id": "string",
  "responses": [
    {
      "id": "nanoid",
      "type": "daily_health_check" | "urine_protein_result",
      "timestamp": 1712345678000,
      "data": "{\"hasHeadaches\":false,\"hasVisualDisturbances\":false}"
    }
  ]
}
```

---

## iHealth SDK / BLE Native Module

### Module: `react-native-ihealth-devices`

Custom React Native bridge module providing Bluetooth connectivity to medical devices.

### Supported Devices
| Type | Models | Connection | Data |
|------|--------|------------|------|
| Blood Pressure | BP3L, BP5, BP5S | iHealth SDK (BLE) | Systolic, diastolic, pulse, irregular heartbeat |
| Weight Scale | HS2, HS2S, HS4S | iHealth SDK (BLE) | Weight, BMI, body fat |
| Generic BP | Any 0x1810 service | BLE GATT | Systolic, diastolic, pulse |
| Generic Scale | Any 0x181D service | BLE GATT | Weight |

### Native Bridge Functions (exposed to JS)
```
authenticate(licensePath) → Promise<boolean>
isAuthenticated() → Promise<boolean>
startScan(deviceTypes[]) → Promise<void>
stopScan() → Promise<void>
connectDevice(mac, deviceType) → Promise<boolean>
disconnectDevice(mac) → Promise<void>
disconnectAll() → Promise<void>
startMeasurement(mac) → Promise<void>
stopMeasurement(mac) → Promise<void>
getConnectedDevices() → Promise<Array>
getBatteryLevel(mac) → Promise<number>  // Returns -1 (not implemented)
keepAwake() / allowSleep()               // iOS only - screen idle timer
```

### Events Emitted (Native → JS)
```
onDeviceFound       → { mac, name, type, rssi, source }
onConnectionStateChanged → { mac, type, connected, source }
onScanStateChanged  → { scanning: boolean }
onBloodPressureReading → { mac, type, systolic, diastolic, pulse, timestamp, source }
onWeightReading     → { mac, type, weight, unit, timestamp, source }
onError             → { code, message }
onDebugLog          → { message }
```

### Platform Differences
- **Android (Kotlin):** Sequential timer-based scanning (3s per device type). Requires Location Services enabled. Uses `iHealthDevicesManager` SDK singleton.
- **iOS (Objective-C):** Simultaneous SDK + GATT scanning. Uses CoreBluetooth `CBCentralManager` for generic devices. License loaded from app bundle. Includes `keepAwake`/`allowSleep` for screen idle.

### Data Flow
1. JS calls `startScan(['BP5S', 'HS2S'])`
2. Native starts BLE scan → emits `onDeviceFound` events
3. JS calls `connectDevice(mac, 'BP5S')`
4. Native connects → emits `onConnectionStateChanged`
5. JS calls `startMeasurement(mac)`
6. Device captures reading → native emits `onBloodPressureReading` or `onWeightReading`
7. JS saves reading via Redux → SQLite → sync to EMR

---

## Authentication Flow

1. User enters phone number → `authService.sendCode(phone)` → SMS sent
2. User enters 6-digit code → `authService.verifyCode(phone, code)`
3. Server returns patient profile with BP thresholds
4. User saved to SQLite, Redux state updated (`login()`)
5. HIPAA: If different patient logs in, all prior patient data is wiped
6. Demo account: phone `5550001234` seeds 60 days of test data

---

## Clinical Features

### Blood Pressure Monitoring
- Captures systolic, diastolic, heart rate from iHealth devices
- Color-coded readings based on physician-set thresholds (default: 140/90)
- `isBPHigh()` checks: systolic >= threshold OR diastolic >= threshold

### Daily Health Check (Preeclampsia Screening)
- Prompted before BP readings (once per day, resets at 2am)
- Two questions: headaches? visual disturbances?
- Optional symptom details text field
- Warning banner if symptoms reported

### Urine Protein Testing
- Prompted every 72 hours on dashboard
- 6-level scale: Negative, Trace, +1, +2, +3, +4
- Can defer ("Answer Later")
- Results synced to EMR

### Pregnancy Wellness Tips
- 280 rotating daily tips (one per day of pregnancy)
- Covers nutrition, monitoring, symptoms, labor prep, postpartum

---

## Data Persistence

### SQLite Tables
- `user` — patient profile, BP thresholds
- `devices` — registered devices (type, MAC, model, friendly name, source)
- `readings` — vital signs (type, values, timestamp, sync status)
- `screening_responses` — health check + urine protein answers
- `app_settings` — key-value pairs (e.g., first launch flag)

### Sync Architecture
- Background sync every 60 seconds
- Batch size: 20 readings per request
- Exponential backoff retries: [5s, 15s, 45s, 2m, 5m] (max 5 retries)
- Network monitoring via @react-native-community/netinfo
- Auto-pause when offline, auto-resume when online
- Deduplication handled server-side (duplicates_skipped in response)

---

## Build & Run

```bash
npm install
npx react-native run-android
npx react-native run-ios
```

### Android
- Namespace: `com.trinitycareview.app`
- Permissions: Internet, Bluetooth (legacy + Android 12+), Fine Location, Storage
- iHealth SDK included as AAR dependency

### iOS
- iHealth SDK included as static library: `libiHealthSDK2.14.0.a`
- Frameworks: CoreBluetooth, ExternalAccessory
- License file: `com_trinitycareview_app_ios.pem`
