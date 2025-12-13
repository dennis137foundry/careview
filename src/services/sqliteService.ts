import { open } from "react-native-quick-sqlite";

// Open (or create) the local database
const db = open({ name: "trinity.db" });

// ----------------------
// Initialize Database
// ----------------------
export function initDB() {
  // Create tables if they don't exist
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
      ts INTEGER
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
  type: 'BP' | 'SCALE' | 'BG';
  mac: string;
  model?: string;      // e.g., 'BP3L', 'BG5', 'BG5S', 'HS2S'
  bottleCode?: string; // QR code from BG5 test strip bottle
};

export function saveDevice(device: DeviceRecord) {
  try {
    console.log("💾 Saving device:", JSON.stringify(device));
    db.execute(
      "INSERT OR REPLACE INTO devices (id, name, type, mac, model, bottleCode) VALUES (?, ?, ?, ?, ?, ?);",
      [device.id, device.name, device.type, device.mac, device.model || null, device.bottleCode || null]
    );
    console.log("✅ Device saved:", device.id);
  } catch (e) {
    console.error("❌ Failed to save device:", e);
  }
}

export function updateDeviceBottleCode(deviceId: string, bottleCode: string) {
  try {
    db.execute(
      "UPDATE devices SET bottleCode = ? WHERE id = ?;",
      [bottleCode, deviceId]
    );
    console.log("✅ Bottle code updated for device:", deviceId);
  } catch (e) {
    console.error("❌ Failed to update bottle code:", e);
  }
}

export function getDevices(): DeviceRecord[] {
  try {
    const res = db.execute("SELECT id, name, type, mac, model, bottleCode FROM devices ORDER BY name;");
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
    const res = db.execute("SELECT id, name, type, mac, model, bottleCode FROM devices WHERE id = ?;", [id]);
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0) as DeviceRecord;
    }
    return null;
  } catch (e) {
    console.error("❌ Failed to get device:", e);
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
};

export function saveReading(r: SavedReading) {
  try {
    db.execute(
      "INSERT OR REPLACE INTO readings (id, deviceId, deviceName, type, value, value2, heartRate, unit, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      [
        r.id,
        r.deviceId,
        r.deviceName,
        r.type,
        r.value ?? null,
        r.value2 ?? null,
        r.heartRate ?? null,
        r.unit,
        r.ts,
      ]
    );
    console.log("✅ Reading saved:", r.id);
  } catch (e) {
    console.error("❌ Failed to save reading:", e);
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


export function getAllReadings(): SavedReading[] {
  try {
    const res = db.execute("SELECT * FROM readings ORDER BY ts DESC;");
    const out: SavedReading[] = [];
    if (res.rows) {
      for (let i = 0; i < res.rows.length; i++) {
        out.push(res.rows.item(i) as SavedReading);
      }
    }
    return out;
  } catch (e) {
    console.error("❌ Failed to get readings:", e);
    return [];
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
  removeDevice,
  saveReading,
  getAllReadings,
};
