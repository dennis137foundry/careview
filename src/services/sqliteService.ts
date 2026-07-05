import { open } from "react-native-quick-sqlite";

// Open (or create) the local database
const db = open({ name: "trinity.db" });

// ----------------------
// Initialize Database
// ----------------------

export function initDB() {
  // Create user table with all fields including BP thresholds + auth tokens
  db.execute(`
    CREATE TABLE IF NOT EXISTS user (
      patientId TEXT PRIMARY KEY,
      firstName TEXT,
      lastName TEXT,
      phone TEXT,
      providerFirstName TEXT,
      providerLastName TEXT,
      providerPracticeName TEXT,
      systolicHigh INTEGER DEFAULT 140,
      diastolicHigh INTEGER DEFAULT 90,
      authToken TEXT,
      refreshToken TEXT,
      edd TEXT DEFAULT NULL,
      eddSource TEXT DEFAULT NULL
    );
  `);

  // Migration: Add BP threshold columns if they don't exist
  try {
    db.execute("ALTER TABLE user ADD COLUMN systolicHigh INTEGER DEFAULT 140;");
    console.log("[DB] Added 'systolicHigh' column to user");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE user ADD COLUMN diastolicHigh INTEGER DEFAULT 90;");
    console.log("[DB] Added 'diastolicHigh' column to user");
  } catch (e) {
    // Column already exists
  }
  // Migration: JWT + refresh token storage (Wave 5 auth migration)
  try {
    db.execute("ALTER TABLE user ADD COLUMN authToken TEXT;");
    console.log("[DB] Added 'authToken' column to user");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE user ADD COLUMN refreshToken TEXT;");
    console.log("[DB] Added 'refreshToken' column to user");
  } catch (e) {
    // Column already exists
  }
  // Migration: estimated due date ("YYYY-MM-DD") + where it came from
  // ('emr' from login/profile refresh, 'patient' typed into the dashboard
  // card). Drives the pregnancy-aligned daily facts.
  try {
    db.execute("ALTER TABLE user ADD COLUMN edd TEXT DEFAULT NULL;");
    console.log("[DB] Added 'edd' column to user");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE user ADD COLUMN eddSource TEXT DEFAULT NULL;");
    console.log("[DB] Added 'eddSource' column to user");
  } catch (e) {
    // Column already exists
  }

  // Create devices table with all columns including friendlyName, source,
  // EMR inventory-unit IDs, and cuff size (BP only).
  db.execute(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      mac TEXT,
      model TEXT,
      bottleCode TEXT,
      friendlyName TEXT,
      source TEXT DEFAULT 'iHealthSDK',
      emrUnitId INTEGER DEFAULT NULL,
      emrAccessoryUnitId INTEGER DEFAULT NULL,
      cuffSize TEXT DEFAULT NULL,
      lastBattery INTEGER DEFAULT NULL,
      lastBatteryAt INTEGER DEFAULT NULL
    );
  `);

  db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migration: Add missing columns if table already existed with old schema
  try {
    db.execute("ALTER TABLE devices ADD COLUMN type TEXT;");
    console.log("[DB] Added 'type' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN mac TEXT;");
    console.log("[DB] Added 'mac' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN model TEXT;");
    console.log("[DB] Added 'model' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN bottleCode TEXT;");
    console.log("[DB] Added 'bottleCode' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN friendlyName TEXT;");
    console.log("[DB] Added 'friendlyName' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN source TEXT DEFAULT 'iHealthSDK';");
    console.log("[DB] Added 'source' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN emrUnitId INTEGER DEFAULT NULL;");
    console.log("[DB] Added 'emrUnitId' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN emrAccessoryUnitId INTEGER DEFAULT NULL;");
    console.log("[DB] Added 'emrAccessoryUnitId' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN cuffSize TEXT DEFAULT NULL;");
    console.log("[DB] Added 'cuffSize' column to devices");
  } catch (e) {
    // Column already exists
  }
  // Migration: last-known battery level (percent) + when it was read.
  // Populated from the iHealth SDK on each device connection.
  try {
    db.execute("ALTER TABLE devices ADD COLUMN lastBattery INTEGER DEFAULT NULL;");
    console.log("[DB] Added 'lastBattery' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN lastBatteryAt INTEGER DEFAULT NULL;");
    console.log("[DB] Added 'lastBatteryAt' column to devices");
  } catch (e) {
    // Column already exists
  }

  // Create readings table
  db.execute(`
    CREATE TABLE IF NOT EXISTS readings (
      id TEXT PRIMARY KEY,
      deviceId TEXT,
      deviceName TEXT,
      type TEXT,
      value REAL,
      value2 REAL,
      heartRate REAL,
      unit TEXT,
      ts INTEGER,
      synced INTEGER DEFAULT 0,
      measurementCondition TEXT,
      capturedAt INTEGER DEFAULT NULL
    );
  `);

  // Migration: Add synced column if table already existed
  try {
    db.execute("ALTER TABLE readings ADD COLUMN synced INTEGER DEFAULT 0;");
    console.log("[DB] Added 'synced' column to readings");
  } catch (e) {
    // Column already exists
  }

  // Migration: Add measurementCondition column
  try {
    db.execute("ALTER TABLE readings ADD COLUMN measurementCondition TEXT;");
    console.log("[DB] Added 'measurementCondition' column to readings");
  } catch (e) {
    // Column already exists
  }

  // Migration: when the reading ENTERED the app, as opposed to `ts` (when
  // the sample was taken — a BG5S stored record can be days older). The
  // dashboard's "last 48 hours" window keys on capturedAt; the EMR and
  // History keep the clinical ts.
  try {
    db.execute("ALTER TABLE readings ADD COLUMN capturedAt INTEGER DEFAULT NULL;");
    console.log("[DB] Added 'capturedAt' column to readings");
  } catch (e) {
    // Column already exists
  }

  // =====================================================================
  // Screening responses table (daily health checks, urine protein results)
  // =====================================================================
  db.execute(`
    CREATE TABLE IF NOT EXISTS screening_responses (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data TEXT,
      synced INTEGER DEFAULT 0
    );
  `);

  console.log("[DB] Database initialized");
}

// ----------------------
// User Helpers
// ----------------------
export interface LocalUser {
  patientId: string;
  firstName: string;
  lastName: string;
  phone: string;
  providerFirstName: string;
  providerLastName: string;
  providerPracticeName: string;
  systolicHigh?: number;
  diastolicHigh?: number;
  authToken?: string | null;
  refreshToken?: string | null;
  // Estimated due date "YYYY-MM-DD". 'emr' wins over 'patient' — a
  // clinician-verified EDD always overwrites a patient-entered one.
  edd?: string | null;
  eddSource?: EddSource | null;
}

export type EddSource = "emr" | "patient";

export function saveUser(u: LocalUser) {
  // Writes throw on failure. Callers (authService.verifyCode) must catch and
  // surface to the user — a silently-failed user save masked as login success
  // leads to HIPAA leaks and orphaned sync state.
  db.execute("DELETE FROM user;");
  db.execute(
    `INSERT INTO user
     (patientId, firstName, lastName, phone, providerFirstName, providerLastName, providerPracticeName, systolicHigh, diastolicHigh, authToken, refreshToken, edd, eddSource)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      u.patientId,
      u.firstName,
      u.lastName,
      u.phone,
      u.providerFirstName,
      u.providerLastName,
      u.providerPracticeName,
      u.systolicHigh ?? 140,
      u.diastolicHigh ?? 90,
      u.authToken ?? null,
      u.refreshToken ?? null,
      u.edd ?? null,
      u.eddSource ?? null,
    ]
  );
  // Patient ID — dev only.
  if (__DEV__) {
    console.log("[DB] User saved:", u.patientId);
  }
}

/**
 * Update only the auth tokens on the existing user row. Called after a
 * successful refresh_token.php rotation. Throws on failure — stale
 * tokens in SQLite would cause every subsequent request to 401.
 */
export function updateAuthTokens(authToken: string | null, refreshToken: string | null) {
  db.execute("UPDATE user SET authToken = ?, refreshToken = ?;", [
    authToken,
    refreshToken,
  ]);
}

/**
 * Update only the due date on the existing user row. Targeted UPDATE so
 * tokens/thresholds are untouched. Throws on failure — callers surface it.
 */
export function updateUserEdd(edd: string | null, source: EddSource | null) {
  db.execute("UPDATE user SET edd = ?, eddSource = ?;", [edd, source]);
  if (__DEV__) {
    console.log(`[DB] EDD updated: ${edd} (${source})`);
  }
}

export function clearUser() {
  try {
    db.execute("DELETE FROM user;");
    console.log("[DB] User table cleared");
  } catch (e) {
    console.error("[DB] Failed to clear user:", e);
  }
}

export async function getUser(): Promise<LocalUser | null> {
  try {
    const res = db.execute(
      "SELECT patientId, firstName, lastName, phone, providerFirstName, providerLastName, providerPracticeName, systolicHigh, diastolicHigh, authToken, refreshToken, edd, eddSource FROM user LIMIT 1;"
    );
    if (!res.rows || res.rows.length === 0) return null;

    return res.rows.item(0) as LocalUser;
  } catch (e) {
    console.error("[DB] Failed to get user:", e);
    return null;
  }
}

// ----------------------
// App Settings Helpers
// ----------------------

/**
 * Get a setting value from app_settings table
 */
export function getAppSetting(key: string): string | null {
  try {
    const res = db.execute(
      "SELECT value FROM app_settings WHERE key = ?;",
      [key]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0).value;
    }
    return null;
  } catch (e) {
    console.error("[DB] Failed to get app setting:", key, e);
    return null;
  }
}

/**
 * Set a setting value in app_settings table
 */
export function setAppSetting(key: string, value: string): void {
  try {
    db.execute(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?);",
      [key, value]
    );
    console.log("[DB] App setting saved:", key);
  } catch (e) {
    console.error("[DB] Failed to set app setting:", key, e);
  }
}

/**
 * Check if this is the first launch of the app
 * Returns true if no "has_launched" flag is set
 */
export function getIsFirstLaunch(): boolean {
  const hasLaunched = getAppSetting("has_launched");
  return hasLaunched !== "1";
}

/**
 * Mark that the app has been launched (no longer first launch)
 */
export function setFirstLaunchComplete(): void {
  setAppSetting("has_launched", "1");
  console.log("[DB] First launch flag set");
}

// ----------------------
// Device Helpers
// ----------------------
export type DeviceSource = "iHealthSDK" | "BLE_GATT";

export type CuffSize = "STANDARD" | "LARGE" | "XXL";

export type DeviceRecord = {
  id: string;
  name: string;
  type: "BP" | "SCALE" | "BG";
  mac: string;
  model?: string; // e.g., 'BP3L', 'BP5S', 'BG5S', 'HS2S', 'GATT_BP', 'GATT_SCALE'
  bottleCode?: string; // Legacy - was for BG5 test strips
  friendlyName?: string; // User-customizable display name
  source?: DeviceSource; // 'iHealthSDK' or 'BLE_GATT'

  // EMR inventory linkage (populated after successful device_register.php
  // call). NULL until registration succeeds; readings can still sync
  // without a unit_id while registration is pending.
  emrUnitId?: number | null;
  emrAccessoryUnitId?: number | null; // XXL cuffs register as a second unit
  cuffSize?: CuffSize | null; // BP only; null for scales

  // Last-known battery level (0–100), read from the iHealth SDK on connect.
  // null = never read (e.g. HS4S has no battery API, or not yet connected).
  lastBattery?: number | null;
  lastBatteryAt?: number | null; // epoch ms of the last battery read
};

export function saveDevice(device: DeviceRecord) {
  try {
    // Full device payload includes MAC / serial and friendly name
    // (sometimes the patient's name or room). PHI — dev only.
    if (__DEV__) {
      console.log("[DB] Saving device:", JSON.stringify(device));
    }
    // Upsert instead of INSERT OR REPLACE so columns not written here
    // (lastBattery / lastBatteryAt) survive a re-pair of an existing device.
    db.execute(
      `INSERT INTO devices (id, name, type, mac, model, bottleCode, friendlyName, source, emrUnitId, emrAccessoryUnitId, cuffSize)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         mac = excluded.mac,
         model = excluded.model,
         bottleCode = excluded.bottleCode,
         friendlyName = excluded.friendlyName,
         source = excluded.source,
         emrUnitId = excluded.emrUnitId,
         emrAccessoryUnitId = excluded.emrAccessoryUnitId,
         cuffSize = excluded.cuffSize;`,
      [
        device.id,
        device.name,
        device.type,
        device.mac,
        device.model || null,
        device.bottleCode || null,
        device.friendlyName || null,
        device.source || "iHealthSDK",
        device.emrUnitId ?? null,
        device.emrAccessoryUnitId ?? null,
        device.cuffSize ?? null,
      ]
    );
    if (__DEV__) {
      console.log("[DB] Device saved:", device.id);
    }
  } catch (e) {
    console.error("[DB] Failed to save device:", e);
  }
}

/**
 * Store the last-known battery level (0–100) for a device, with the time it
 * was read. Targeted UPDATE (won't disturb other columns). Matched by MAC so
 * the native battery event — which only carries mac — can find the row.
 */
export function updateDeviceBatteryByMac(mac: string, battery: number): void {
  try {
    db.execute(
      "UPDATE devices SET lastBattery = ?, lastBatteryAt = ? WHERE mac = ? COLLATE NOCASE;",
      [battery, Date.now(), mac]
    );
    if (__DEV__) {
      console.log(`[DB] Battery ${battery}% stored for device mac ${mac}`);
    }
  } catch (e) {
    console.error("[DB] Failed to update device battery:", e);
  }
}

/**
 * Populate the EMR inventory-unit IDs on an existing device row after
 * device_register.php returns them. emrAccessoryUnitId is only set for
 * XXL-cuff BP registrations; pass null for everything else.
 */
export function updateDeviceEmrUnits(
  deviceId: string,
  emrUnitId: number | null,
  emrAccessoryUnitId: number | null
) {
  try {
    db.execute(
      "UPDATE devices SET emrUnitId = ?, emrAccessoryUnitId = ? WHERE id = ?;",
      [emrUnitId, emrAccessoryUnitId, deviceId]
    );
    if (__DEV__) {
      console.log("[DB] EMR unit IDs updated for device:", deviceId);
    }
  } catch (e) {
    console.error("[DB] Failed to update EMR unit IDs:", e);
  }
}

/**
 * Devices paired locally but not yet registered with the EMR inventory.
 * Picked up by the background sync sweep to retry device_register.php.
 */
export function getDevicesWithoutEmrUnitId(): DeviceRecord[] {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source, emrUnitId, emrAccessoryUnitId, cuffSize, lastBattery, lastBatteryAt FROM devices WHERE emrUnitId IS NULL AND type IN ('BP', 'SCALE');"
    );
    const out: DeviceRecord[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        out.push(res.rows.item(i) as DeviceRecord);
      }
    }
    return out;
  } catch (e) {
    console.error("[DB] Failed to get devices without emrUnitId:", e);
    return [];
  }
}

export function updateDeviceBottleCode(deviceId: string, bottleCode: string) {
  try {
    db.execute("UPDATE devices SET bottleCode = ? WHERE id = ?;", [
      bottleCode,
      deviceId,
    ]);
    console.log("[DB] Bottle code updated for device:", deviceId);
  } catch (e) {
    console.error("[DB] Failed to update bottle code:", e);
  }
}

export function updateDeviceFriendlyName(deviceId: string, friendlyName: string) {
  try {
    db.execute("UPDATE devices SET friendlyName = ? WHERE id = ?;", [
      friendlyName,
      deviceId,
    ]);
    console.log("[DB] Friendly name updated for device:", deviceId);
  } catch (e) {
    console.error("[DB] Failed to update friendly name:", e);
  }
}

/**
 * Update device name (both name and friendlyName columns)
 * Used for renaming devices from the UI
 */
export function updateDeviceName(deviceId: string, newName: string) {
  try {
    db.execute("UPDATE devices SET name = ?, friendlyName = ? WHERE id = ?;", [
      newName,
      newName,
      deviceId,
    ]);
    console.log("[DB] Device renamed:", deviceId, "->", newName);
  } catch (e) {
    console.error("[DB] Failed to rename device:", e);
  }
}

export function getDevices(): DeviceRecord[] {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source, emrUnitId, emrAccessoryUnitId, cuffSize, lastBattery, lastBatteryAt FROM devices ORDER BY name;"
    );
    const out: DeviceRecord[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        out.push(res.rows.item(i) as DeviceRecord);
      }
    }
    console.log("[DB] Loaded devices:", out.length);
    return out;
  } catch (e) {
    console.error("[DB] Failed to get devices:", e);
    return [];
  }
}

export function getDevice(id: string): DeviceRecord | null {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source, emrUnitId, emrAccessoryUnitId, cuffSize, lastBattery, lastBatteryAt FROM devices WHERE id = ?;",
      [id]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0) as DeviceRecord;
    }
    return null;
  } catch (e) {
    console.error("[DB] Failed to get device:", e);
    return null;
  }
}

export function getDeviceByType(type: "BP" | "SCALE" | "BG"): DeviceRecord | null {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source, emrUnitId, emrAccessoryUnitId, cuffSize, lastBattery, lastBatteryAt FROM devices WHERE type = ? LIMIT 1;",
      [type]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0) as DeviceRecord;
    }
    return null;
  } catch (e) {
    console.error("[DB] Failed to get device by type:", e);
    return null;
  }
}

export function removeDevice(id: string) {
  try {
    db.execute("DELETE FROM devices WHERE id = ?;", [id]);
    console.log("[DB] Device removed:", id);
  } catch (e) {
    console.error("[DB] Failed to remove device:", e);
  }
}

// ----------------------
// Reading Helpers
// ----------------------
export type SavedReading = {
  id: string;
  deviceId: string;
  deviceName: string;
  type: "BP" | "SCALE" | "BG";
  value?: number;
  value2?: number;
  heartRate?: number;
  unit: string;
  ts: number;
  synced?: boolean;
  measurementCondition?: string;
  // When the reading entered the app (capture/sync moment). Defaults to
  // `ts` when not provided (e.g. seeded demo data). BG5S stored records
  // make the two diverge: ts = sample time on the meter, capturedAt = now.
  capturedAt?: number;
};

export function saveReading(
  r: Omit<SavedReading, "id" | "ts"> & { id?: string; ts?: number }
) {
  // Writes throw on failure. A silently-failed reading save looks like
  // success to the capture flow, hands off a nothing-row to the sync loop,
  // and loses the patient's measurement. Callers must catch + surface.
  const id =
    r.id || `reading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const ts = r.ts || Date.now();
  // Falls back to ts so seeded/legacy rows behave as if captured when taken.
  const capturedAt = r.capturedAt ?? ts;
  db.execute(
    "INSERT OR REPLACE INTO readings (id, deviceId, deviceName, type, value, value2, heartRate, unit, ts, synced, measurementCondition, capturedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
    [
      id,
      r.deviceId,
      r.deviceName,
      r.type,
      r.value ?? null,
      r.value2 ?? null,
      r.heartRate ?? null,
      r.unit,
      ts,
      r.synced ? 1 : 0,
      r.measurementCondition ?? null,
      capturedAt,
    ]
  );
  // Reading ID + measurement_condition (contains pulse for BP) — PHI.
  // Dev only.
  if (__DEV__) {
    console.log(
      "[DB] Reading saved:",
      id,
      "measurementCondition:",
      r.measurementCondition
    );
  }
}

/**
 * True if a reading with this id is already stored. Used by the BG5S
 * capture flow to recognize a meter record that was already captured
 * (the meter re-delivers stored records on every connection).
 */
export function readingExists(id: string): boolean {
  try {
    const res = db.execute("SELECT 1 FROM readings WHERE id = ? LIMIT 1;", [id]);
    return !!res.rows && res.rows.length > 0;
  } catch (e) {
    console.error("[DB] Failed to check reading existence:", e);
    return false;
  }
}

export function getAllReadings(): SavedReading[] {
  try {
    const res = db.execute("SELECT * FROM readings ORDER BY ts DESC;");
    const out: SavedReading[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows.item(i);
        out.push({
          ...row,
          synced: row.synced === 1,
        } as SavedReading);
      }
    }
    return out;
  } catch (e) {
    console.error("[DB] Failed to get readings:", e);
    return [];
  }
}

// ----------------------
// Sync Helpers
// ----------------------

/** Get all readings that haven't been synced yet */
export function getUnsyncedReadings(): SavedReading[] {
  try {
    const res = db.execute(
      "SELECT * FROM readings WHERE synced = 0 ORDER BY ts ASC;"
    );
    const out: SavedReading[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows.item(i);
        out.push({
          ...row,
          synced: false,
        } as SavedReading);
      }
    }
    console.log("[DB] Unsynced readings:", out.length);
    return out;
  } catch (e) {
    console.error("[DB] Failed to get unsynced readings:", e);
    return [];
  }
}

/** Mark a single reading as synced */
export function markReadingSynced(id: string) {
  try {
    db.execute("UPDATE readings SET synced = 1 WHERE id = ?;", [id]);
    console.log("[DB] Reading marked as synced:", id);
  } catch (e) {
    console.error("[DB] Failed to mark reading as synced:", e);
  }
}

/** Mark multiple readings as synced */
export function markReadingsSynced(ids: string[]) {
  try {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    db.execute(
      `UPDATE readings SET synced = 1 WHERE id IN (${placeholders});`,
      ids
    );
    console.log("[DB] Marked", ids.length, "readings as synced");
  } catch (e) {
    console.error("[DB] Failed to mark readings as synced:", e);
  }
}

/** Get count of unsynced readings */
export function getUnsyncedCount(): number {
  try {
    const res = db.execute(
      "SELECT COUNT(*) as count FROM readings WHERE synced = 0;"
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0).count;
    }
    return 0;
  } catch (e) {
    console.error("[DB] Failed to get unsynced count:", e);
    return 0;
  }
}

// =====================================================================
// Screening Response Helpers
// =====================================================================

export type ScreeningType =
  | "daily_health_check" // Headaches/visual disturbances before BP
  | "urine_protein_result" // 72-hour urine protein answer
  | "urine_protein_deferred" // User pressed "Answer Later"
  | "hospital_visit_report"; // Patient tapped "I Went To The Hospital"

export type ScreeningResponse = {
  id: string;
  type: ScreeningType;
  timestamp: number;
  data: string; // JSON string of response data
  synced: boolean;
};

export type DailyHealthCheckData = {
  hasHeadaches: boolean;
  hasVisualDisturbances: boolean;
  details?: string;
};

export type UrineProteinData = {
  result?: "Negative" | "Trace" | "+1" | "+2" | "+3" | "+4";
  deferred?: boolean;
};

export type HospitalVisitData = {
  // "When did you go" — local YYYY-MM-DD. The row timestamp captures when the
  // button was pressed; this captures the day of the actual visit.
  visitDate?: string;
  // Reserved for optional future context without a schema change on either side.
  hospitalName?: string;
  reason?: string;
};

/**
 * Save a screening response
 */
export function saveScreeningResponse(
  type: ScreeningType,
  data: DailyHealthCheckData | UrineProteinData | HospitalVisitData
): string {
  // Writes throw on failure. Callers (DailyHealthCheckModal, UrineProteinModal)
  // must catch and keep the modal open — otherwise the patient sees a
  // success screen while their clinical answer never leaves the phone.
  const id = `screening_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = Date.now();
  const dataJson = JSON.stringify(data);

  db.execute(
    "INSERT INTO screening_responses (id, type, timestamp, data, synced) VALUES (?, ?, ?, ?, 0);",
    [id, type, timestamp, dataJson]
  );
  // Screening IDs link to PHI in the EMR — dev only.
  if (__DEV__) {
    console.log("[DB] Screening response saved:", type, id);
  }
  return id;
}

/**
 * Get the most recent screening response of a given type
 */
export function getLastScreeningResponse(
  type: ScreeningType
): ScreeningResponse | null {
  try {
    const res = db.execute(
      "SELECT id, type, timestamp, data, synced FROM screening_responses WHERE type = ? ORDER BY timestamp DESC LIMIT 1;",
      [type]
    );
    if (res.rows && res.rows.length > 0) {
      const row = res.rows.item(0);
      return {
        id: row.id,
        type: row.type as ScreeningType,
        timestamp: row.timestamp,
        data: row.data,
        synced: row.synced === 1,
      };
    }
    return null;
  } catch (e) {
    console.error("[DB] Failed to get last screening response:", e);
    return null;
  }
}

/**
 * Get all screening responses of a given type within a time range
 */
export function getScreeningResponsesInRange(
  type: ScreeningType,
  startTs: number,
  endTs: number
): ScreeningResponse[] {
  try {
    const res = db.execute(
      "SELECT id, type, timestamp, data, synced FROM screening_responses WHERE type = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC;",
      [type, startTs, endTs]
    );
    const out: ScreeningResponse[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows.item(i);
        out.push({
          id: row.id,
          type: row.type as ScreeningType,
          timestamp: row.timestamp,
          data: row.data,
          synced: row.synced === 1,
        });
      }
    }
    return out;
  } catch (e) {
    console.error("[DB] Failed to get screening responses in range:", e);
    return [];
  }
}

/**
 * Get all screening responses of a given type, newest first.
 */
export function getScreeningResponsesByType(
  type: ScreeningType
): ScreeningResponse[] {
  try {
    const res = db.execute(
      "SELECT id, type, timestamp, data, synced FROM screening_responses WHERE type = ? ORDER BY timestamp DESC;",
      [type]
    );
    const out: ScreeningResponse[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows.item(i);
        out.push({
          id: row.id,
          type: row.type as ScreeningType,
          timestamp: row.timestamp,
          data: row.data,
          synced: row.synced === 1,
        });
      }
    }
    return out;
  } catch (e) {
    console.error("[DB] Failed to get screening responses by type:", e);
    return [];
  }
}

/**
 * Get every screening response (all types), newest first. Used by the History
 * export so the CSV includes urine protein, daily health checks, and hospital
 * reports alongside device readings.
 */
export function getAllScreeningResponses(): ScreeningResponse[] {
  try {
    const res = db.execute(
      "SELECT id, type, timestamp, data, synced FROM screening_responses ORDER BY timestamp DESC;"
    );
    const out: ScreeningResponse[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows.item(i);
        out.push({
          id: row.id,
          type: row.type as ScreeningType,
          timestamp: row.timestamp,
          data: row.data,
          synced: row.synced === 1,
        });
      }
    }
    return out;
  } catch (e) {
    console.error("[DB] Failed to get all screening responses:", e);
    return [];
  }
}

/**
 * Get unsynced screening responses
 */
export function getUnsyncedScreeningResponses(): ScreeningResponse[] {
  try {
    const res = db.execute(
      "SELECT id, type, timestamp, data, synced FROM screening_responses WHERE synced = 0 ORDER BY timestamp ASC;"
    );
    const out: ScreeningResponse[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        const row = res.rows.item(i);
        out.push({
          id: row.id,
          type: row.type as ScreeningType,
          timestamp: row.timestamp,
          data: row.data,
          synced: false,
        });
      }
    }
    return out;
  } catch (e) {
    console.error("[DB] Failed to get unsynced screening responses:", e);
    return [];
  }
}

/**
 * Mark screening response as synced
 */
export function markScreeningResponseSynced(id: string) {
  try {
    db.execute("UPDATE screening_responses SET synced = 1 WHERE id = ?;", [id]);
    console.log("[DB] Screening response marked as synced:", id);
  } catch (e) {
    console.error("[DB] Failed to mark screening response as synced:", e);
  }
}

/**
 * Check if daily health check was completed today (after 2am reset)
 * Returns true if a response exists after today's 2am
 */
export function hasDailyHealthCheckToday(): boolean {
  const now = new Date();
  const today2am = new Date(now);
  today2am.setHours(2, 0, 0, 0);

  // If current time is before 2am, use yesterday's 2am as the reset point
  if (now.getHours() < 2) {
    today2am.setDate(today2am.getDate() - 1);
  }

  const responses = getScreeningResponsesInRange(
    "daily_health_check",
    today2am.getTime(),
    Date.now()
  );

  return responses.length > 0;
}

/**
 * Check if urine protein response is needed (72+ hours since last answer)
 * Returns true if user needs to answer the urine protein question
 */
export function needsUrineProteinResponse(): boolean {
  const lastAnswer = getLastScreeningResponse("urine_protein_result");

  if (!lastAnswer) {
    // Never answered - needs response
    return true;
  }

  const hoursSinceLastAnswer =
    (Date.now() - lastAnswer.timestamp) / (1000 * 60 * 60);
  return hoursSinceLastAnswer >= 72;
}

/**
 * Check if user has deferred urine protein today
 * This is used to show the alert bar
 */
export function hasUrineProteinDeferredToday(): boolean {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const deferrals = getScreeningResponsesInRange(
    "urine_protein_deferred",
    todayStart.getTime(),
    Date.now()
  );

  // Check if there's a deferral today that hasn't been answered
  if (deferrals.length === 0) return false;

  const lastDeferral = deferrals[0];
  const lastAnswer = getLastScreeningResponse("urine_protein_result");

  // If there's an answer after the deferral, the deferral is resolved
  if (lastAnswer && lastAnswer.timestamp > lastDeferral.timestamp) {
    return false;
  }

  return true;
}


export function wipeAllPatientData() {
  // Called when a different patient logs in (HIPAA). Must clear every table
  // that holds prior-patient data, including the `user` row itself — leaving
  // the old user row in place is a PII leak if the subsequent saveUser fails.
  try {
    db.execute("DELETE FROM readings;");
    db.execute("DELETE FROM devices;");
    db.execute("DELETE FROM screening_responses;");
    db.execute("DELETE FROM app_settings;");
    db.execute("DELETE FROM user;");
  } catch (e) {
    console.error("Failed to wipe patient data:", e);
    throw e;
  }
}

// ----------------------
// Exports
// ----------------------
export default {
  initDB,
  saveUser,
  clearUser,
  getUser,
  // App Settings
  getAppSetting,
  setAppSetting,
  getIsFirstLaunch,
  setFirstLaunchComplete,
  // Devices
  saveDevice,
  updateDeviceBottleCode,
  updateDeviceFriendlyName,
  updateDeviceName,
  getDevices,
  getDevice,
  getDeviceByType,
  removeDevice,
  // Readings
  saveReading,
  getAllReadings,
  getUnsyncedReadings,
  markReadingSynced,
  markReadingsSynced,
  getUnsyncedCount,
  // Screening
  saveScreeningResponse,
  getLastScreeningResponse,
  getScreeningResponsesInRange,
  getScreeningResponsesByType,
  getUnsyncedScreeningResponses,
  markScreeningResponseSynced,
  hasDailyHealthCheckToday,
  needsUrineProteinResponse,
  hasUrineProteinDeferredToday,
  wipeAllPatientData
};
