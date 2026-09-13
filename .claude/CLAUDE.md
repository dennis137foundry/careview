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
    Dashboard/    - Home: wellness fact (tap → WellnessHistoryScreen), urine protein + health events tiles, latest readings
    Capture/      - Device measurement flow (BLE connect → measure → save). Both the Home and Devices stacks hold a Capture screen; tabs use popToTopOnBlur so only one is ever mounted, and every native-event listener also checks focused + capturing + same device (`ownsEvent`) before saving or tearing anything down
    Devices/      - Device management (list, add, scan QR, rename)
    History/      - Reading history with charts, export CSV, sync status
    Profile/      - User info, provider details, messaging, sign out
  services/
    authService.ts           - SMS auth via trinityemr.com API
    deviceService.ts         - Unified BLE device management layer
    vitalsSyncService.ts     - Syncs readings + screenings to EMR
    batteryRefreshService.ts - At app start + foreground (10-min throttle): brief scan for registered iHealth models, battery-only connect to each that answers. Blocked/cancelled while a capture or add-device screen is in front (markDeviceScreenActive). The pre-capture low-battery warning only trusts a level under 30 min old; otherwise the live read on connect decides
    sqliteService.ts         - SQLite database layer (users, devices, readings, screenings)
    seedDemoData.ts          - 60-day demo data generator for testing
  redux/
    store.ts          - Redux store config
    userSlice.ts      - Auth state, EMR-resolved thresholds (BP + glucose), provider info
    deviceSlice.ts    - Registered device management
    readingSlice.ts   - Vital sign readings
  components/
    DailyHealthCheckModal.tsx  - Preeclampsia symptom screening
    UrineProteinModal.tsx      - Urine protein picker (voluntary sheet + inline 72h hold, "can't test" reasons)
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
    pregnancyFacts.ts  - EDD-aligned daily facts (294 day-keyed + 42 postpartum)
  utils/
    getDailyFact.ts    - Pregnancy-day-aligned fact selector (EDD-based)
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
| `https://trinityemr.com/api/careviewapp/verify_code.php` | Verify code, return patient profile + thresholds (`bpThresholds`, `bgThresholds`) | authService.ts |
| `https://trinitycareview.com/api/careviewapp/patient_profile.php` | EDD + thresholds, fetched on every launch, foreground and capture-screen open | profileRefreshService.ts |

### Data Sync
| Endpoint | Purpose | Service |
|----------|---------|---------|
| `https://trinitycareview.com/api/careviewapp/vitals_sync.php` | Sync BP/weight readings | vitalsSyncService.ts |
| `https://trinitycareview.com/api/careviewapp/screening_sync.php` | Sync screening responses | vitalsSyncService.ts |

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
      "type": "daily_health_check" | "urine_protein_result" | "urine_protein_unable",
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
connectForBattery(mac, deviceType) → Promise<boolean>  // Battery-only: connect → query battery → disconnect, never measures. Result via onBatteryLevel. Resolves false for HS4S/GATT.
connectForSetup(mac, deviceType) → Promise<boolean>    // Add-device flow: same short connect, but also reads + sets the device's own clock (BG5S: setTime; BP3L/BP5S: SDK time sync) before battery + disconnect. Nothing erased. Result via onDeviceClockSet.
setDeviceClock(mac, deviceType, purge) → Promise<boolean>  // Already-connected device. BG5S: read + set clock (purge=false in practice). BP3L/BP5S: time sync. Others resolve false.
deleteDeviceRecords(mac, deviceType) → Promise<boolean>  // BG5S only: erase the meter's stored readings — called after every pulled record is saved locally. Best-effort.
disconnectDevice(mac) → Promise<void>
disconnectAll() → Promise<void>
startMeasurement(mac) → Promise<void>
stopMeasurement(mac) → Promise<void>
getConnectedDevices() → Promise<Array>
getBatteryLevel(mac) → Promise<number>  // Returns -1 (stub; battery arrives via onBatteryLevel events)
keepAwake() / allowSleep()               // iOS only - screen idle timer
```

### Events Emitted (Native → JS)
```
onDeviceFound       → { mac, name, type, rssi, source }
onConnectionStateChanged → { mac, type, connected, source }
onScanStateChanged  → { scanning: boolean }
onBloodPressureReading → { mac, type, systolic, diastolic, pulse, timestamp, source }
onBloodGlucoseReading → { mac, type, value, unit, dataID, timestamp, timeProof, source }  // Android: one per stored record, then onGlucoseMeterEvent stage "offline_synced". `timestamp` is the METER's clock; timeProof=false means taken before it was set. iOS pulls records via debugBG5SGetOfflineData instead (each has measureDate + canCorrect).
onWeightReading     → { mac, type, weight, unit, timestamp, source }
onBatteryLevel      → { mac, type, level, source, timestamp }  // Emitted on every connection (capture + battery-only connect after add). Global listener in App.tsx dispatches setDeviceBattery. No battery API: HS4S, GATT devices.
onDeviceClockSet    → { mac, type, at, purged, deviceDateBefore? }  // The app just set the device's own clock; `at` = phone time (epoch ms), `deviceDateBefore` = what the clock read first. App.tsx stores clockSetAt, and when the clock was off by >10 min, clockOffsetMs = at − deviceDateBefore (dates readings the meter flags as taken on the unset clock).
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
3. Server returns patient profile with the EMR-resolved thresholds (BP + glucose)
4. User saved to SQLite, Redux state updated (`login()`)
5. HIPAA: If a different patient logs in, all prior patient data is wiped. A plain Sign Out keeps readings/devices (the patient signs back in and finds them) but remembers the owner in `app_settings.owner_patient_id`, so the comparison still works with no user row; "Sign Out & Wipe Data" clears everything
6. Demo account: phone `5550001234` seeds 60 days of test data
7. **Data ownership.** Every reading and screening response is stamped with `patientId` (the signed-in patient at save time); every read and the sync loop are scoped to the signed-in patient, and login adopts unstamped legacy rows then purges any stamped with someone else. So even if a sign-out path ever forgets the owner, another patient's rows are never shown or uploaded under the wrong ID

### Session lifetime (authToken.ts)
- `verify_code.php` issues a 1 h access JWT + 30 d refresh token; `authedFetch` adds the Bearer header and refreshes once on 401
- The phone number is the login credential. The EMR keeps it unique per patient and **releases it at discharge** (phone nulled, login flag off, every refresh token revoked); clearing/changing the phone or switching "App Login Enabled" off in the EMR revokes sessions the same way
- Every EMR endpoint answers **`403 app_login_disabled`** once access is revoked. `authedFetch` treats that (from any call, including refresh) as the end of the session: tokens cleared, one `logout`, toast "Your CareView access has been turned off by your care team". A 401 on refresh, or a 401 with no refresh token, ends it as "session expired"
- `profileRefreshService` runs on every launch, every foreground and every capture-screen open (no throttle since 2.4); besides EDD/thresholds it is what discovers a revocation promptly — there is no push channel
- `send_code` / `verify_code` map `app_login_disabled` to a plain "turned off by your care team" message

---

## Clinical Features

### Blood Glucose Import (BG5S)
- The meter is not live: the patient tests on the meter, the app imports later. Every reading is dated by the METER's clock, never by import time
- Every connection (add-device and Capture) is a full sync: native reads the meter's clock, sets it, reports both (`onDeviceClockSet`); the screen pulls ALL stored records, dates each, dedups by deterministic id, and walks the new ones oldest-first through the sample-window prompt (likely window pre-selected from time of day; Skip leaves it on the meter). Once all are saved the meter's memory is erased (`deleteDeviceRecords`)
- Out of the box (and after a dead battery) the meter's clock runs from 2017-01-01. It flags readings taken on the unset clock (iOS `canCorrect`, Android `timeProof=false`); App.tsx stores `clockOffsetMs = phone − meter` whenever the clock is found off, and `datedBGTimestamp` adds it to flagged readings. No pairing order is required of the patient
- Server backstop: `vitals_sync.php` rejects readings dated before the patient's enrollment or in the future
- Time frames: the meter reports its status time and its record times as `"yyyy-MM-dd HH:mm:ss"` in **UTC** — Android parses both as GMT (parsing one in local time would shift every corrected reading by the phone's UTC offset). iOS gets `NSDate`s from the SDK and also emits epoch-ms `timestamp`. A reading whose time cannot be read is **undatable**: it is left on the meter, never dated by import time, and the reading id never falls back to `Date.now()`
- Only the BG5S's memory is ever read. iHealth BP monitors and scales are live and phone-stamped; the A&D GATT cuff writes its clock at pairing and its readings carry that. BP3L/BP5S get an SDK time sync at add-device for hygiene only
- Deliberately not used: the SDK's `processData:deviceDate:` / `adjustOfflineData` (same offset arithmetic, done in JS uniformly). Known edge: a meter that resets twice between imports dates the older batch with the newer offset (bounded to [2025, now+15 min])
- Devices card shows "Clock set <date>" / "Not set up yet — tap Capture to set the meter's clock" for a glucose meter

### Blood Pressure Monitoring
- Captures systolic, diastolic, heart rate from iHealth devices
- Color-coded readings based on the EMR-resolved thresholds (see below)
- `isBPHigh()` checks: systolic >= threshold OR diastolic >= threshold

### High-reading thresholds (app 2.4+)
- **The EMR is the only source of a threshold.** It resolves, per number, the patient's own
  value → her provider's → the system default (`VITAL_THRESHOLDS.MD` in the EMR repo) and sends
  the result as `bpThresholds { systolicHigh, diastolicHigh }` + `bgThresholds { high }`
- Fetched at login and by `profileRefreshService` on **every** cold start, **every** return to
  the foreground, and whenever a capture screen opens — no interval gate — so a change made in
  the EMR is on the phone before the next reading is judged
- Stored with the user row (SQLite `systolicHigh / diastolicHigh / glucoseHigh`) only so a
  capture still works offline; the phone never invents a value. `EMR_DEFAULT_THRESHOLDS` in
  `utils/thresholdLogic.ts` mirrors the EMR defaults and is used only for a column a stored row
  predates (upgrade from 2.3), until the launch-time fetch replaces it
- Glucose is judged exactly like BP: `isGlucoseHigh()` (value >= `glucoseHigh`) drives the
  capture "Above threshold" badge, the dashboard slide colour and the History row/stats
- Predicates and parsing are pure in `utils/thresholdLogic.ts`, tested in `__tests__/`

### Daily Health Check (Preeclampsia Screening)
- Prompted before BP readings (once per day, resets at 2am)
- Two questions: headaches? visual disturbances?
- Optional symptom details text field
- Warning banner if symptoms reported

### Urine Protein Testing (app 2.3+)
- Home-screen tile ("Record result"): patients record a result any time, any number per day (two-minute duplicate confirm, never a block)
- 72-hour minimum enforced by a HOLD: once 72h pass with no result, the picker renders inline over the home screen (tab bar still works) until a result is saved or the patient sends "I can't test right now" + reason. That report syncs as `urine_protein_unable`, shows on the EMR chart, gives 24h of grace, and does NOT reset the 72h clock
- Never held during the app session in which the login happened (`urineProteinSession.ts`). The session ends on a cold start or after the app has been away 60s+; a brief background hop for a system permission dialog does not end it. Notification permission is never requested in that session either
- Bell icon lights when a result is owed and opens the same picker; there is no alert bar
- Local reminder notifications (Notifee): last result + 72h, then daily for a week, shifted out of 21:00–08:00; rescheduled on every save (`urineReminderService.ts`)
- 6-level scale: Negative, Trace, +1, +2, +3, +4; +2 and above = alert. Summaries show the HIGHEST result in 24h, never the latest
- Rules live in `urineProteinLogic.ts` (pure, tested in `__tests__/`); reads/writes go through `urineProteinService.ts`

### Pregnancy Wellness Tips
- 280 rotating daily tips (one per day of pregnancy)
- Covers nutrition, monitoring, symptoms, labor prep, postpartum
- Tapping the hero opens WellnessHistoryScreen: today on top, one card per earlier day back to day 1, paged as you scroll (pure function of EDD + date, nothing stored)

---

## Data Persistence

### SQLite Tables
- `user` — patient profile, the last thresholds the EMR sent (BP + glucose)
- `devices` — registered devices (type, MAC, model, friendly name, source, clockSetAt, clockOffsetMs)
- `readings` — vital signs (type, values, timestamp, sync status)
- `screening_responses` — health checks, urine protein results, "can't test" reports, hospital reports
- `app_settings` — key-value pairs (e.g., first launch flag)

### Sync Architecture
- Background sync every 60 seconds
- Batch size: 20 readings per request
- Exponential backoff retries: [5s, 15s, 45s, 2m, 5m] (max 5 retries)
- Network monitoring via @react-native-community/netinfo
- Auto-pause when offline, auto-resume when online
- Deduplication handled server-side (duplicates_skipped in response)
- **Refused readings.** The EMR refuses a reading it will never accept (impossible value; date before the patient's enrollment or in the future) and reports it per reading. The batch answer is **207** (was 400, which made the app treat the whole batch as failed and stalled the queue). The app marks such a reading `synced = 2` — `rejected` on `SavedReading`, red cloud-alert badge and "Rejected by EMR" in the History CSV — and never resends it. An old-style 400 body that carries per-reading results is read as a 207

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
- License file: `ios/cvdemo/license.pem` (permanent; source copy `com_trinitycareview_app_ios.pem` kept in `.licenses/`). Android equivalent: `android/app/src/main/assets/license.pem`

