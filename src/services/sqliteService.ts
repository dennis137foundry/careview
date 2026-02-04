import { open } from "react-native-quick-sqlite";

// Open (or create) the local database
const db = open({ name: "trinity.db" });

// ----------------------
// Initialize Database
// ----------------------

export function initDB() {
  // Create user table with all fields including BP thresholds
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
      diastolicHigh INTEGER DEFAULT 90
    );
  `);

  // Migration: Add BP threshold columns if they don't exist
  try {
    db.execute("ALTER TABLE user ADD COLUMN systolicHigh INTEGER DEFAULT 140;");
    console.log("✅ Added 'systolicHigh' column to user");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE user ADD COLUMN diastolicHigh INTEGER DEFAULT 90;");
    console.log("✅ Added 'diastolicHigh' column to user");
  } catch (e) {
    // Column already exists
  }

  // Create devices table with all columns including friendlyName and source
  db.execute(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      mac TEXT,
      model TEXT,
      bottleCode TEXT,
      friendlyName TEXT,
      source TEXT DEFAULT 'iHealthSDK'
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
    console.log("✅ Added 'type' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN mac TEXT;");
    console.log("✅ Added 'mac' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN model TEXT;");
    console.log("✅ Added 'model' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN bottleCode TEXT;");
    console.log("✅ Added 'bottleCode' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN friendlyName TEXT;");
    console.log("✅ Added 'friendlyName' column to devices");
  } catch (e) {
    // Column already exists
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN source TEXT DEFAULT 'iHealthSDK';");
    console.log("✅ Added 'source' column to devices");
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
      measurementCondition TEXT
    );
  `);

  // Migration: Add synced column if table already existed
  try {
    db.execute("ALTER TABLE readings ADD COLUMN synced INTEGER DEFAULT 0;");
    console.log("✅ Added 'synced' column to readings");
  } catch (e) {
    // Column already exists
  }

  // Migration: Add measurementCondition column
  try {
    db.execute("ALTER TABLE readings ADD COLUMN measurementCondition TEXT;");
    console.log("✅ Added 'measurementCondition' column to readings");
  } catch (e) {
    // Column already exists
  }

  // =====================================================================
  // NEW: Screening Responses Table
  // For tracking daily health checks and urine protein responses
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

  console.log("✅ Database initialized");
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
}

export function saveUser(u: LocalUser) {
  try {
    db.execute("DELETE FROM user;");
    db.execute(
      `INSERT INTO user 
       (patientId, firstName, lastName, phone, providerFirstName, providerLastName, providerPracticeName, systolicHigh, diastolicHigh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      ]
    );
    console.log("✅ User saved:", u.patientId);
  } catch (e) {
    console.error("❌ Failed to save user:", e);
  }
}

export function clearUser() {
  try {
    db.execute("DELETE FROM user;");
    console.log("✅ User table cleared");
  } catch (e) {
    console.error("❌ Failed to clear user:", e);
  }
}

export async function getUser(): Promise<LocalUser | null> {
  try {
    const res = db.execute(
      "SELECT patientId, firstName, lastName, phone, providerFirstName, providerLastName, providerPracticeName, systolicHigh, diastolicHigh FROM user LIMIT 1;"
    );
    if (!res.rows || res.rows.length === 0) return null;

    return res.rows.item(0) as LocalUser;
  } catch (e) {
    console.error("❌ Failed to get user:", e);
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
    console.error("❌ Failed to get app setting:", key, e);
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
    console.log("✅ App setting saved:", key);
  } catch (e) {
    console.error("❌ Failed to set app setting:", key, e);
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
  console.log("✅ First launch complete flag set");
}

// ----------------------
// Device Helpers
// ----------------------
export type DeviceSource = "iHealthSDK" | "BLE_GATT";

export type DeviceRecord = {
  id: string;
  name: string;
  type: "BP" | "SCALE";
  mac: string;
  model?: string; // e.g., 'BP3L', 'BP5S', 'HS2S', 'GATT_BP', 'GATT_SCALE'
  bottleCode?: string; // Legacy - was for BG5 test strips
  friendlyName?: string; // User-customizable display name
  source?: DeviceSource; // 'iHealthSDK' or 'BLE_GATT'
};

export function saveDevice(device: DeviceRecord) {
  try {
    console.log("💾 Saving device:", JSON.stringify(device));
    db.execute(
      "INSERT OR REPLACE INTO devices (id, name, type, mac, model, bottleCode, friendlyName, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
      [
        device.id,
        device.name,
        device.type,
        device.mac,
        device.model || null,
        device.bottleCode || null,
        device.friendlyName || null,
        device.source || "iHealthSDK",
      ]
    );
    console.log("✅ Device saved:", device.id);
  } catch (e) {
    console.error("❌ Failed to save device:", e);
  }
}

export function updateDeviceBottleCode(deviceId: string, bottleCode: string) {
  try {
    db.execute("UPDATE devices SET bottleCode = ? WHERE id = ?;", [
      bottleCode,
      deviceId,
    ]);
    console.log("✅ Bottle code updated for device:", deviceId);
  } catch (e) {
    console.error("❌ Failed to update bottle code:", e);
  }
}

export function updateDeviceFriendlyName(deviceId: string, friendlyName: string) {
  try {
    db.execute("UPDATE devices SET friendlyName = ? WHERE id = ?;", [
      friendlyName,
      deviceId,
    ]);
    console.log("✅ Friendly name updated for device:", deviceId);
  } catch (e) {
    console.error("❌ Failed to update friendly name:", e);
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
    console.log("✅ Device renamed:", deviceId, "->", newName);
  } catch (e) {
    console.error("❌ Failed to rename device:", e);
  }
}

export function getDevices(): DeviceRecord[] {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source FROM devices ORDER BY name;"
    );
    const out: DeviceRecord[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        out.push(res.rows.item(i) as DeviceRecord);
      }
    }
    console.log("📱 Loaded devices:", out.length);
    return out;
  } catch (e) {
    console.error("❌ Failed to get devices:", e);
    return [];
  }
}

export function getDevice(id: string): DeviceRecord | null {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source FROM devices WHERE id = ?;",
      [id]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0) as DeviceRecord;
    }
    return null;
  } catch (e) {
    console.error("❌ Failed to get device:", e);
    return null;
  }
}

export function getDeviceByType(type: "BP" | "SCALE"): DeviceRecord | null {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode, friendlyName, source FROM devices WHERE type = ? LIMIT 1;",
      [type]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0) as DeviceRecord;
    }
    return null;
  } catch (e) {
    console.error("❌ Failed to get device by type:", e);
    return null;
  }
}

export function removeDevice(id: string) {
  try {
    db.execute("DELETE FROM devices WHERE id = ?;", [id]);
    console.log("✅ Device removed:", id);
  } catch (e) {
    console.error("❌ Failed to remove device:", e);
  }
}

// ----------------------
// Reading Helpers
// ----------------------
export type SavedReading = {
  id: string;
  deviceId: string;
  deviceName: string;
  type: "BP" | "SCALE";
  value?: number;
  value2?: number;
  heartRate?: number;
  unit: string;
  ts: number;
  synced?: boolean;
  measurementCondition?: string;
};

export function saveReading(
  r: Omit<SavedReading, "id" | "ts"> & { id?: string; ts?: number }
) {
  const id =
    r.id || `reading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const ts = r.ts || Date.now();
  try {
    db.execute(
      "INSERT OR REPLACE INTO readings (id, deviceId, deviceName, type, value, value2, heartRate, unit, ts, synced, measurementCondition) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
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
      ]
    );
    console.log(
      "✅ Reading saved:",
      id,
      "measurementCondition:",
      r.measurementCondition
    );
  } catch (e) {
    console.error("❌ Failed to save reading:", e);
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
    console.error("❌ Failed to get readings:", e);
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
    console.log("📤 Unsynced readings:", out.length);
    return out;
  } catch (e) {
    console.error("❌ Failed to get unsynced readings:", e);
    return [];
  }
}

/** Mark a single reading as synced */
export function markReadingSynced(id: string) {
  try {
    db.execute("UPDATE readings SET synced = 1 WHERE id = ?;", [id]);
    console.log("✅ Reading marked as synced:", id);
  } catch (e) {
    console.error("❌ Failed to mark reading as synced:", e);
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
    console.log("✅ Marked", ids.length, "readings as synced");
  } catch (e) {
    console.error("❌ Failed to mark readings as synced:", e);
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
    console.error("❌ Failed to get unsynced count:", e);
    return 0;
  }
}

// =====================================================================
// Screening Response Helpers
// =====================================================================

export type ScreeningType =
  | "daily_health_check" // Headaches/visual disturbances before BP
  | "urine_protein_result" // 72-hour urine protein answer
  | "urine_protein_deferred"; // User pressed "Answer Later"

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

/**
 * Save a screening response
 */
export function saveScreeningResponse(
  type: ScreeningType,
  data: DailyHealthCheckData | UrineProteinData
): string {
  const id = `screening_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = Date.now();
  const dataJson = JSON.stringify(data);

  try {
    db.execute(
      "INSERT INTO screening_responses (id, type, timestamp, data, synced) VALUES (?, ?, ?, ?, 0);",
      [id, type, timestamp, dataJson]
    );
    console.log("✅ Screening response saved:", type, id);
    return id;
  } catch (e) {
    console.error("❌ Failed to save screening response:", e);
    return "";
  }
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
    console.error("❌ Failed to get last screening response:", e);
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
    console.error("❌ Failed to get screening responses in range:", e);
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
    console.error("❌ Failed to get unsynced screening responses:", e);
    return [];
  }
}

/**
 * Mark screening response as synced
 */
export function markScreeningResponseSynced(id: string) {
  try {
    db.execute("UPDATE screening_responses SET synced = 1 WHERE id = ?;", [id]);
    console.log("✅ Screening response marked as synced:", id);
  } catch (e) {
    console.error("❌ Failed to mark screening response as synced:", e);
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
  try {
    db.execute("DELETE FROM readings;");
    db.execute("DELETE FROM devices;");
    db.execute("DELETE FROM screening_responses;");
    db.execute("DELETE FROM app_settings;");
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
  updateDeviceName,  // ← Added
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
  getUnsyncedScreeningResponses,
  markScreeningResponseSynced,
  hasDailyHealthCheckToday,
  needsUrineProteinResponse,
  hasUrineProteinDeferredToday,
  wipeAllPatientData
};