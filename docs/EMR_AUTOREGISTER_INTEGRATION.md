# EMR Auto-Register Integration — App Plan

## Context

The Trinity EMR (PHP/Twig, source at `C:\Users\denni\Dropbox\Business\Websites\trinityemr.com`) now has a serialized device inventory (table `inventory_units`, one row per physical BP monitor or scale). A new endpoint lets the mobile app auto-register a device into EMR inventory at pairing time and assign it to the logged-in patient in one step. This removes the manual receiving step on the EMR admin side — nurses just pair in the app and the device is tracked.

This doc is the app-side integration brief. The EMR-side plan lives at `trinityemr.com/docs/INVENTORY_APP_AUTOREGISTER_PLAN.md` and covers the schema, endpoint logic, and verification on the server. A fresh Claude session should be able to execute this app-side work from this doc alone without re-deriving the design.

## What the EMR offers

### New endpoint: `POST https://trinitycareview.com/api/careviewapp/device_register.php`

**Headers:**
- `Authorization: Bearer <patient JWT>`
- `Content-Type: application/json`

**Request body:**
```json
{
  "patient_id": 12345,
  "mac": "A4C1386B2E90",
  "model": "BP3L",
  "category": "BP",
  "name": "BP3L A4C1",
  "friendly_name": "Mom's bedroom BP monitor",
  "source": "iHealthSDK"
}
```

Field notes sent by the app:
- `patient_id`: from Redux user state (same path vitals_sync uses).
- `mac`: uppercased hex string with all separators stripped (e.g. `A4:C1:38:6B:2E:90` → `A4C1386B2E90`). Server normalizes again defensively but app should send it clean.
- `model`: e.g. `"BP3L"`, `"HS2S"`, `"GATT_BP"`. From `DiscoveredDevice.type`.
- `category`: `"BP"` or `"SCALE"`.
- `name`: device's advertised name.
- `friendly_name`: the user-typed friendly name from the naming modal.
- `source`: `"iHealthSDK"` or `"BLE_GATT"`.

**Success response (200):**
```json
{
  "success": true,
  "unit_id": 42,
  "item_id": 7,
  "model": "BP3L",
  "manufacturer": "iHealth",
  "item_name": "iHealth BP3L"
}
```

Store `unit_id` locally; it will be sent on every vitals reading going forward. It's also the id you'd use for any future per-device operations.

**Error responses:**
| Status | `error` field | App should |
|---|---|---|
| 401 | "Unauthorized" | Static key mismatch — shouldn't happen. Log + bail. |
| 422 | validation messages | Malformed MAC or missing fields. Log + bail; do not retry. |
| 409 | "Device is assigned to another patient, contact Trinity" | Show blocking alert to the user with this exact message. Do not save the pairing locally. |
| 409 | "Device is out of service, contact Trinity" | Same as above. |
| 409 | "MAC registered under a different product" | Rare; same blocking alert. |
| 5xx | any | Retry with backoff. Keep the pairing in a "pending EMR registration" state locally; don't start pushing vitals from it until registered. |

Re-sending the same registration for the same `(patient_id, mac)` is **idempotent** — the EMR returns 200 with the same `unit_id`. Safe to call on every app startup if `emrUnitId` is missing locally.

### Modified endpoint: `POST /api/careviewapp/vitals_sync.php`

Same URL, same auth. New optional field per reading:
```json
{
  "patient_id": 12345,
  "vitals": [
    {
      "id": "reading_1234567890_xyz",
      "type": "BP",
      "value": 130,
      "value2": 85,
      "heartRate": 72,
      "unit": "mmHg",
      "ts": 1234567890000,
      "unit_id": 42
    }
  ]
}
```

- `unit_id` (optional, int): the EMR unit id from registration.
- Readings without `unit_id` still work (legacy behavior).
- Readings with a `unit_id` that isn't currently assigned to `patient_id` on the EMR are **silently dropped server-side** (no error to the app; the reading just won't appear in the EMR). This is how the EMR enforces server-side state when a device has been returned, decommissioned, or transferred by admin action.

The app does **not** need to handle any notification channel for out-of-service devices. Keep pairing locally, keep syncing; drops are silent.

## App-side changes

### A. SQLite: add `emrUnitId` column on `devices`

**File:** `src/services/sqliteService.ts`

The `devices` table currently has: `id, name, type, mac, model, bottleCode, friendlyName, source`. Add `emrUnitId`:

1. In the `CREATE TABLE IF NOT EXISTS devices` block (around line 42), add the column:
```sql
emrUnitId INTEGER DEFAULT NULL
```

2. Follow the existing `try { db.execute("ALTER TABLE devices ADD COLUMN ..."); } catch (e) {}` pattern around lines 62–97 to migrate existing installs:
```typescript
try {
  db.execute("ALTER TABLE devices ADD COLUMN emrUnitId INTEGER DEFAULT NULL;");
  console.log("[DB] Added 'emrUnitId' column to devices");
} catch (e) {
  // Column already exists
}
```

3. Update the `DeviceRecord` TypeScript type (look for it in `src/services/sqliteService.ts` or `src/redux/deviceSlice.ts`) to include `emrUnitId: number | null`.

4. Update any `saveDevice` / `insertDevice` / `updateDevice` functions in `sqliteService.ts` to persist `emrUnitId`.

5. Update any `getDevices()` / `loadDevices()` functions to SELECT the new column.

### B. New service: `src/services/deviceRegistrationService.ts`

Single purpose: POST to the register endpoint and handle responses.

```typescript
import { getUser } from "./sqliteService";
import { authedFetch } from "./authToken";

const REGISTER_URL = "https://trinitycareview.com/api/careviewapp/device_register.php";

export interface RegisterPayload {
  patient_id: number;
  mac: string;            // normalized, uppercased, no separators
  model: string;
  category: "BP" | "SCALE";
  name: string;
  friendly_name: string;
  source: "iHealthSDK" | "BLE_GATT";
}

export interface RegisterSuccess {
  success: true;
  unit_id: number;
  item_id: number;
  model: string;
  manufacturer: string;
  item_name: string;
}

export interface RegisterConflict {
  success: false;
  status: 409;
  error: string;        // human-readable reason, show to user
}

export type RegisterResult =
  | { kind: "success"; data: RegisterSuccess }
  | { kind: "conflict"; message: string }
  | { kind: "retry"; message: string }   // 5xx / network
  | { kind: "fatal"; message: string };  // 401, 422, unknown

export async function registerDeviceWithEmr(payload: RegisterPayload): Promise<RegisterResult> {
  try {
    const res = await authedFetch(REGISTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));

    if (res.status === 200 && body.success) {
      return { kind: "success", data: body as RegisterSuccess };
    }
    if (res.status === 409) {
      return { kind: "conflict", message: body.error ?? "Device already registered" };
    }
    if (res.status === 401 || res.status === 422) {
      return { kind: "fatal", message: body.error ?? `HTTP ${res.status}` };
    }
    return { kind: "retry", message: body.error ?? `HTTP ${res.status}` };
  } catch (e: any) {
    return { kind: "retry", message: e?.message ?? "Network error" };
  }
}

/** Strip all non-hex characters and uppercase. */
export function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}
```

### C. Hook registration into the add-device flow

**File:** `src/screens/Devices/AddDeviceScreen.tsx`

The existing `confirmAddDevice()` function (around line 198) saves the device to Redux and SQLite after the user enters a friendly name. Extend it to call the EMR register endpoint immediately after the local save:

```typescript
async function confirmAddDevice() {
  // ... existing local-save logic runs first, producing a saved DeviceRecord ...
  const saved = /* existing */;

  const patientId = /* from Redux user state, same as vitalsSyncService uses */;
  const category: "BP" | "SCALE" = saved.type === "SCALE" ? "SCALE" : "BP";

  const result = await registerDeviceWithEmr({
    patient_id: patientId,
    mac: normalizeMac(saved.mac),
    model: saved.type,           // "BP3L" / "HS2S" / "GATT_BP" / etc
    category,
    name: saved.name,
    friendly_name: saved.friendlyName ?? saved.name,
    source: saved.source ?? "iHealthSDK",
  });

  switch (result.kind) {
    case "success":
      await updateDevice(saved.id, { emrUnitId: result.data.unit_id });
      dispatch(setDeviceEmrUnitId({ id: saved.id, emrUnitId: result.data.unit_id }));
      // success toast / navigate back
      break;

    case "conflict":
      // Device is assigned to another patient, out of service, or wrong product.
      // Roll back the local save and show the EMR's error message verbatim.
      await removeDevice(saved.id);
      dispatch(deleteDevice(saved.id));
      Alert.alert("Device Not Available", result.message);
      return;

    case "retry":
      // Keep the local pairing; retry in the background. No toast — sync will
      // pick it up on the next startup or sync tick.
      scheduleBackgroundRegister(saved.id);
      break;

    case "fatal":
      // Malformed payload or bad auth. Log and leave the device paired locally
      // but un-registered. Will not sync vitals until emrUnitId exists.
      console.error("[DeviceRegister] fatal:", result.message);
      break;
  }
}
```

### D. Background retry for pending registrations

If a registration returns `retry` (5xx / network), the device is paired locally but has no `emrUnitId`. Add a sweep:

1. In the existing background sync loop in `src/services/vitalsSyncService.ts` (the `backgroundSyncInterval` tick around line 53), add a call to a new `retryPendingDeviceRegistrations()` **before** the vitals push:

```typescript
export async function retryPendingDeviceRegistrations(): Promise<void> {
  const devices = await getDevicesWithoutEmrUnitId();  // new query
  if (devices.length === 0) return;
  const patientId = (await getUser())?.patientId;
  if (!patientId) return;

  for (const d of devices) {
    const result = await registerDeviceWithEmr({
      patient_id: patientId,
      mac: normalizeMac(d.mac),
      model: d.type,
      category: d.type === "SCALE" ? "SCALE" : "BP",
      name: d.name,
      friendly_name: d.friendlyName ?? d.name,
      source: (d.source as any) ?? "iHealthSDK",
    });
    if (result.kind === "success") {
      await updateDevice(d.id, { emrUnitId: result.data.unit_id });
    } else if (result.kind === "conflict" || result.kind === "fatal") {
      // Will never succeed; log and give up. User will need to contact Trinity.
      console.warn("[DeviceRegister] giving up on", d.id, result);
    }
    // `retry` → leave emrUnitId null; next tick will try again.
  }
}
```

2. Add `getDevicesWithoutEmrUnitId()` to `sqliteService.ts`:
```sql
SELECT * FROM devices WHERE emrUnitId IS NULL;
```

### E. Include `unit_id` in vitals sync payload

**File:** `src/services/vitalsSyncService.ts`

1. Update the `VitalPayload` interface (line 65) to include:
```typescript
unit_id?: number | null;
```

2. In the reading-to-payload conversion (lines 251–269 based on the earlier audit), look up the device by `deviceId` / `mac` stored on the `SavedReading` and map its `emrUnitId` into `unit_id`:
```typescript
const device = reading.deviceId
  ? await getDeviceById(reading.deviceId)
  : null;

const payload: VitalPayload = {
  // ... existing fields ...
  unit_id: device?.emrUnitId ?? null,
};
```

3. If `emrUnitId` is null (device not yet registered with EMR — still pending or fatal), omit the reading entirely OR send without `unit_id`. Recommendation: **send without `unit_id`** so the reading still lands in the EMR for the patient. The EMR will store it with `unit_id = NULL`, same as legacy payloads. This keeps data loss to zero during the rollout.

### F. Redux

**File:** `src/redux/deviceSlice.ts`

Extend the `Device` type with `emrUnitId: number | null`. Add a reducer:
```typescript
setDeviceEmrUnitId: (state, action: PayloadAction<{ id: string; emrUnitId: number }>) => {
  const d = state.devices.find(x => x.id === action.payload.id);
  if (d) d.emrUnitId = action.payload.emrUnitId;
}
```

## Files touched

| File | Change |
|---|---|
| `src/services/sqliteService.ts` | add `emrUnitId` column + migration; extend DeviceRecord type; update save/load queries |
| `src/services/deviceRegistrationService.ts` | **new** — register endpoint client |
| `src/screens/Devices/AddDeviceScreen.tsx` | `confirmAddDevice()` calls register after local save; handles 409/5xx/fatal |
| `src/services/vitalsSyncService.ts` | include `unit_id` in `VitalPayload`; add `retryPendingDeviceRegistrations()` to the background tick |
| `src/redux/deviceSlice.ts` | `emrUnitId` on Device, new `setDeviceEmrUnitId` reducer |
| `docs/EMR_AUTOREGISTER_INTEGRATION.md` | this doc |

No changes to: native iHealth module, QR scanner format, auth (OTP / static key), screening sync.

## Verification plan

Local (against a dev EMR with the migration applied):

1. Fresh install → log in as a test patient via OTP.
2. Pair a BP monitor (real iHealth device or the BLE GATT emulator path). Confirm the naming modal appears, type a name, confirm.
3. Watch logs: should see the register POST, 200 response, `emrUnitId` stored locally. Check `SELECT * FROM devices` in the local DB — row has `emrUnitId` populated.
4. Open the EMR admin UI at `/settings/inventory` → the device appears as a serialized unit under the correct product (e.g. "iHealth BP3L") with status Assigned and the correct patient name.
5. Take a BP reading on the device. On sync, confirm the vitals POST body includes `unit_id`. On the EMR, check `patient_vitals` — new row has `unit_id` populated.
6. Kill the network, try to add a second device (a scale). Local pairing saves. Restore network; within one background tick (~60s by default) the retry sweep registers it. Check `emrUnitId` becomes non-null.

Conflict cases:
7. Log in as a different test patient and try to pair the same physical device. Expect 409 with the "assigned to another patient" message, local device row should be rolled back, alert shown.
8. On the EMR, decommission the unit via the admin UI. Take another reading on the app. Sync should succeed (no error) but the reading should NOT appear in `patient_vitals` — check `app_vitals_rejected.log` on the EMR for the "unit_not_assigned" entry.

Legacy compatibility:
9. Manually clear `emrUnitId` on an existing device row. Take a reading. Sync should still succeed and the reading should land in `patient_vitals` with `unit_id = NULL`. The app should then pick it up in the retry sweep and register it on the next tick.

## Out of scope

- Changing auth (static API key → per-user bearer). Separate work item.
- Scanning iHealth's native QR code (which encodes the serial number, not the MAC). MAC from BLE is the identity; serial is a future column on the EMR side that admin can fill if they care.
- Showing the patient a "your device is assigned to Trinity" status indicator. App remains silent about EMR-side state; readings just silently drop if admin has taken the device out of service.
- Unpair / return flow from the app. Returns happen on the EMR admin side only (via the existing Units UI). App keeps whatever it has; EMR silently ignores stale readings.
