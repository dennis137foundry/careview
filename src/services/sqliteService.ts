import { open } from "react-native-quick-sqlite";

// Open (or create) the local database
const db = open({ name: "trinity.db" });

// ----------------------
// Initialize Database
// ----------------------
export function initDB() {
  // Create user table with all fields
  db.execute(`
    CREATE TABLE IF NOT EXISTS user (
      patientId TEXT PRIMARY KEY,
      firstName TEXT,
      lastName TEXT,
      phone TEXT,
      providerFirstName TEXT,
      providerLastName TEXT,
      providerPracticeName TEXT
    );
  `);

  // Create devices table with all columns
  db.execute(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      mac TEXT,
      model TEXT,
      bottleCode TEXT
    );
  `);

  // Migration: Add missing columns if table already existed with old schema
  try {
    db.execute("ALTER TABLE devices ADD COLUMN type TEXT;");
    console.log("✅ Added 'type' column to devices");
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN mac TEXT;");
    console.log("✅ Added 'mac' column to devices");
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN model TEXT;");
    console.log("✅ Added 'model' column to devices");
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.execute("ALTER TABLE devices ADD COLUMN bottleCode TEXT;");
    console.log("✅ Added 'bottleCode' column to devices");
  } catch (e) {
    // Column already exists, ignore
  }

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
    // Column already exists, ignore
  }

  // Migration: Add measurementCondition column for BG meal timing and BP pulse info
  try {
    db.execute("ALTER TABLE readings ADD COLUMN measurementCondition TEXT;");
    console.log("✅ Added 'measurementCondition' column to readings");
  } catch (e) {
    // Column already exists, ignore
  }

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
}

export function saveUser(u: LocalUser) {
  try {
    db.execute("DELETE FROM user;");
    db.execute(
      `INSERT INTO user 
       (patientId, firstName, lastName, phone, providerFirstName, providerLastName, providerPracticeName)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        u.patientId,
        u.firstName,
        u.lastName,
        u.phone,
        u.providerFirstName,
        u.providerLastName,
        u.providerPracticeName,
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
      "SELECT patientId, firstName, lastName, phone, providerFirstName, providerLastName, providerPracticeName FROM user LIMIT 1;"
    );
    if (!res.rows || res.rows.length === 0) return null;

    return res.rows.item(0) as LocalUser;
  } catch (e) {
    console.error("❌ Failed to get user:", e);
    return null;
  }
}

// ----------------------
// Device Helpers
// ----------------------
export type DeviceRecord = {
  id: string;
  name: string;
  type: "BP" | "SCALE" | "BG";
  mac: string;
  model?: string; // e.g., 'BP3L', 'BG5', 'BG5S', 'HS2S'
  bottleCode?: string; // QR code from BG5 test strip bottle
};

export function saveDevice(device: DeviceRecord) {
  try {
    console.log("💾 Saving device:", JSON.stringify(device));
    db.execute(
      "INSERT OR REPLACE INTO devices (id, name, type, mac, model, bottleCode) VALUES (?, ?, ?, ?, ?, ?);",
      [
        device.id,
        device.name,
        device.type,
        device.mac,
        device.model || null,
        device.bottleCode || null,
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

export function getDevices(): DeviceRecord[] {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode FROM devices ORDER BY name;"
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
      "SELECT id, name, type, mac, model, bottleCode FROM devices WHERE id = ?;",
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

export function getDeviceByType(type: "BP" | "SCALE" | "BG"): DeviceRecord | null {
  try {
    const res = db.execute(
      "SELECT id, name, type, mac, model, bottleCode FROM devices WHERE type = ? LIMIT 1;",
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
  type: "BP" | "SCALE" | "BG";
  value?: number;
  value2?: number;
  heartRate?: number;
  unit: string;
  ts: number;
  synced?: boolean;
  measurementCondition?: string; // For BG: meal timing, For BP: pulse is stored separately but this can be used for extra context
};

export function saveReading(r: Omit<SavedReading, 'id' | 'ts'> & { id?: string; ts?: number }) {
  const id = r.id || `reading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    console.log("✅ Reading saved:", id, "measurementCondition:", r.measurementCondition);
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
    const res = db.execute("SELECT * FROM readings WHERE synced = 0 ORDER BY ts ASC;");
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
    db.execute(`UPDATE readings SET synced = 1 WHERE id IN (${placeholders});`, ids);
    console.log("✅ Marked", ids.length, "readings as synced");
  } catch (e) {
    console.error("❌ Failed to mark readings as synced:", e);
  }
}

/** Get count of unsynced readings */
export function getUnsyncedCount(): number {
  try {
    const res = db.execute("SELECT COUNT(*) as count FROM readings WHERE synced = 0;");
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0).count;
    }
    return 0;
  } catch (e) {
    console.error("❌ Failed to get unsynced count:", e);
    return 0;
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
  saveDevice,
  updateDeviceBottleCode,
  getDevices,
  getDevice,
  getDeviceByType,
  removeDevice,
  saveReading,
  getAllReadings,
  getUnsyncedReadings,
  markReadingSynced,
  markReadingsSynced,
  getUnsyncedCount,
};