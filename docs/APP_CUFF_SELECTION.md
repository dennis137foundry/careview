# Mobile App — BP Cuff Size Selection

## Context

Trinity's EMR inventory is being restructured so that BP devices are tracked as three distinct Equipment types rather than a single "BP Monitor" category:

- **BP Monitor Standard** — standard cuff
- **BP Monitor Large** — large cuff
- **XXL BP Cuff** — an oversized accessory cuff that sits on a Standard monitor (sold/used when a patient's arm is larger than the monitor's built-in cuff accommodates)

The device itself can't tell us its cuff size — iHealth SDK reports the hardware model (BP3L, BP5, etc.) but cuff sizes are a physical accessory. So the nurse has to tell us at pairing time.

This doc is the app-side brief for adding the Cuff Size picker and wiring the updated register payload/response. The EMR-side changes (inventory model, endpoint branching) live at `trinityemr.com/docs/INVENTORY_EQUIPMENT_OVERHAUL_PLAN.md`. A fresh Claude session in this repo should be able to execute this work from this doc alone.

## What the EMR does with the new field

The app sends one new field in the existing `device_register.php` POST: `cuff_size`. The server branches:

| `cuff_size` | EMR creates |
|---|---|
| `"STANDARD"` | 1 unit under BP Monitor Standard SKU |
| `"LARGE"` | 1 unit under BP Monitor Large SKU |
| `"XXL"` | 2 units: 1 BP Monitor Standard + 1 XXL BP Cuff (linked via `parent_unit_id`) |

Both units in the XXL case are assigned to the patient in one transaction. The cuff's serial is synthesized server-side as `XXLCUFF-{monitor_mac}` — no nurse input needed.

The response becomes a `units` array (always — even for single-unit cases — for consistency):

```json
{
  "success": true,
  "units": [
    { "unit_id": 42, "equipment": "BP Monitor Standard", "role": "monitor" },
    { "unit_id": 43, "equipment": "XXL BP Cuff",         "role": "accessory", "parent_unit_id": 42 }
  ]
}
```

**Cuff-size mismatch (409):** If a MAC was previously registered with `cuff_size=STANDARD` and the nurse now pairs it declaring `LARGE`, the server returns 409 with `error: "Cuff size mismatch"`. The app treats this as a conflict — show the user a blocking alert and abort the local save.

**Scale category is unchanged** — no cuff_size field is meaningful for scales. Category=`SCALE` → always one unit under the Scale SKU.

## App-side changes

### A. SQLite schema — add `cuffSize` + multi-unit tracking

**File:** `src/services/sqliteService.ts` (near line 40–97 where the `devices` table is created/migrated)

The current schema has `emrUnitId INTEGER` (single unit per device). XXL changes that — one paired BP device produces two EMR units. Two options:

**Option A (recommended): Second column for the cuff.**

```sql
ALTER TABLE devices ADD COLUMN cuffSize TEXT DEFAULT NULL;
-- cuffSize: NULL (not a BP device or not asked) / "STANDARD" / "LARGE" / "XXL"

ALTER TABLE devices ADD COLUMN emrAccessoryUnitId INTEGER DEFAULT NULL;
-- Populated only for XXL pairs. Points at the cuff unit on the EMR.
```

Keeps `emrUnitId` as "the primary unit" (the monitor) and puts the cuff ID in `emrAccessoryUnitId` so existing code paths (vitals sync using `emrUnitId`) don't change.

**Option B:** Move to a JSON column `emrUnitIds TEXT` containing an array. Cleaner long-term but forces every read site to parse JSON.

Use Option A. Follow the existing `try { db.execute("ALTER TABLE devices ADD COLUMN ..."); } catch {}` migration pattern already established in `sqliteService.ts` lines 62–97.

Also update:
- `DeviceRecord` interface — add `cuffSize: string | null` and `emrAccessoryUnitId: number | null`
- `saveDevice` / `updateDevice` / `getDevices` — persist and select the new columns

### B. Redux

**File:** `src/redux/deviceSlice.ts`

Extend the `Device` type with `cuffSize` and `emrAccessoryUnitId`. Add a reducer to update both EMR unit ids in one action (since they're set together at register time):

```typescript
setDeviceEmrUnits: (state, action: PayloadAction<{
  id: string;
  emrUnitId: number;
  emrAccessoryUnitId: number | null;
}>) => {
  const d = state.devices.find(x => x.id === action.payload.id);
  if (d) {
    d.emrUnitId          = action.payload.emrUnitId;
    d.emrAccessoryUnitId = action.payload.emrAccessoryUnitId;
  }
}
```

### C. New UI: Cuff Size picker screen

**File:** `src/screens/Devices/CuffSizeScreen.tsx` (new)

Shown after the nurse selects a BP device to pair but before the friendly-name naming modal. Three big buttons in a card layout matching existing device screens:

```
┌───────────────────────────────────┐
│  Which cuff size is on this BP    │
│  monitor?                          │
│                                    │
│  [ Standard cuff           → ]    │
│  [ Large cuff              → ]    │
│  [ XXL cuff (accessory)    → ]    │
│                                    │
│  Back                              │
└───────────────────────────────────┘
```

Each button is a full-width `TouchableOpacity`. On tap, dispatch the choice to state and navigate to the existing friendly-name modal. Store locally on the `DeviceRecord` draft until `confirmAddDevice()` runs.

Only show this screen when `category === "BP"`. Scales go straight to the naming modal as today.

### D. Device registration call update

**File:** `src/services/deviceRegistrationService.ts`

Add `cuff_size` to `RegisterPayload`:

```typescript
export interface RegisterPayload {
  patient_id: number;
  mac: string;
  model: string;
  category: "BP" | "SCALE";
  cuff_size?: "STANDARD" | "LARGE" | "XXL";   // only when category === "BP"
  name: string;
  friendly_name: string;
  source: "iHealthSDK" | "BLE_GATT";
}
```

Update `RegisterSuccess` to match the new array response:

```typescript
export interface RegisterSuccess {
  success: true;
  units: Array<{
    unit_id: number;
    equipment: string;
    role: "monitor" | "accessory" | "scale";
    parent_unit_id?: number;
  }>;
}
```

In the success branch, extract both unit ids:

```typescript
if (result.kind === "success") {
  const monitor   = result.data.units.find(u => u.role !== "accessory");
  const accessory = result.data.units.find(u => u.role === "accessory");
  await updateDevice(saved.id, {
    emrUnitId:          monitor?.unit_id ?? null,
    emrAccessoryUnitId: accessory?.unit_id ?? null,
  });
  dispatch(setDeviceEmrUnits({
    id:                 saved.id,
    emrUnitId:          monitor!.unit_id,
    emrAccessoryUnitId: accessory?.unit_id ?? null,
  }));
}
```

### E. Hook into `confirmAddDevice()`

**File:** `src/screens/Devices/AddDeviceScreen.tsx` (around line 198, `confirmAddDevice()`)

Pass the picked `cuffSize` in the register payload. Only set it when `category === "BP"`:

```typescript
const cuffSize = saved.type === "SCALE" ? undefined : saved.cuffSize ?? "STANDARD";
// Default to STANDARD if somehow the picker was skipped — defensive only.
// The picker screen is the source of truth.

const result = await registerDeviceWithEmr({
  patient_id:  patientId,
  mac:         normalizeMac(saved.mac),
  model:       saved.type,
  category:    saved.type === "SCALE" ? "SCALE" : "BP",
  cuff_size:   cuffSize,
  name:        saved.name,
  friendly_name: saved.friendlyName ?? saved.name,
  source:      saved.source ?? "iHealthSDK",
});
```

### F. Cuff-size mismatch (409) handling

Add to the `result.kind === "conflict"` branch:

```typescript
if (result.message.includes("Cuff size mismatch")) {
  Alert.alert(
    "Cuff Size Mismatch",
    "This device was previously registered with a different cuff size. Please contact Trinity to update the device record before pairing.",
  );
  await removeDevice(saved.id);
  dispatch(deleteDevice(saved.id));
  return;
}
```

Same rollback pattern as existing 409 handlers.

## Files touched

| File | Change |
|---|---|
| `src/services/sqliteService.ts` | Add `cuffSize` + `emrAccessoryUnitId` columns + migration; extend DeviceRecord type; update save/load queries |
| `src/redux/deviceSlice.ts` | `cuffSize`, `emrAccessoryUnitId` on Device; new `setDeviceEmrUnits` reducer |
| `src/screens/Devices/CuffSizeScreen.tsx` | **new** — 3-button picker |
| `src/services/deviceRegistrationService.ts` | Add `cuff_size` to payload, change response shape to `units` array |
| `src/screens/Devices/AddDeviceScreen.tsx` | Gate BP devices through CuffSizeScreen; pass `cuffSize` to register; handle mismatch 409 |
| Navigation config (wherever the device-add stack lives) | Insert CuffSizeScreen between device select and naming modal for BP-category devices |
| `docs/APP_CUFF_SELECTION.md` | this doc |

No changes to: iHealth native module, BLE scanning, QR scan format (existing `TYPE:MAC` still works — cuff_size just needs picking after), auth/OTP flow, screening sync, vitals sync.

## Verification plan

1. **Standard BP pair** — scan a BP device, pick Standard cuff, name it, save. Check: 200 response with `units.length === 1`, `emrUnitId` populated, `emrAccessoryUnitId` NULL. Local devices row has `cuffSize="STANDARD"`.
2. **Large BP pair** — same, picking Large. `units.length === 1`, equipment="BP Monitor Large".
3. **XXL BP pair** — pick XXL. `units.length === 2`. Local row has both `emrUnitId` AND `emrAccessoryUnitId` populated. EMR shows two units: BP Monitor Standard + XXL BP Cuff, both assigned to the test patient.
4. **Scale pair** — scan a scale. No cuff picker appears. One unit registered under Scale SKU.
5. **Cuff mismatch** — re-pair the same BP MAC but with a different cuff size. Expect 409 with a mismatch message; local pairing rolled back; alert shown.
6. **Idempotent re-pair** — pair, delete locally (keep EMR state), pair again with the same cuff size. Expect 200 with the same unit_ids.
7. **Back navigation** — on the cuff picker, tap Back. Should return to device selection without saving anything.
8. **Offline** — put phone in airplane mode, try to pair. Expected: local save succeeds, register enters the "retry" state, background sweep registers on reconnect.

## Out of scope

- Letting the user edit cuff size after pairing. Too complex (needs EMR re-registration, possibly inventory transfer). Force re-pair instead.
- Scales with different capacities (adult / pediatric) — all scales are one equipment type.
- Mobile Phone pairing — these are handed out by admin via the EMR UI, not paired via the app.
- Auth / bearer tokens — still static X-API-Key, unchanged.
