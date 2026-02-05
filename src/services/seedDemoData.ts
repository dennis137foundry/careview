// src/services/seedDemoData.ts
// ============================================================================
// Demo Account Seeding
// ============================================================================
//
// Phone: 5550001234  →  Seeds 60 days of realistic vitals
//
// Clinical Profile:
//   • Obese woman (~230 lbs, BMI ≈ 37)
//   • 4–12 weeks gestation (first trimester)
//   • High-risk pregnancy: chronic hypertension
//   • Trending toward gestational hypertension / early preeclampsia signs
//
// Data generated:
//   • ~85 BP readings  (1–2/day, ~8% missed days)
//   • ~48 scale readings (1/day, ~20% missed days)
//   • ~51 daily health checks (85% compliance, increasing symptoms)
//   • ~20 urine protein results (every 3 days, worsening trend)
//
// All seeded readings are marked synced = true so they don't trigger uploads.
// ============================================================================

import { saveReading, saveDevice } from "./sqliteService";
import type { DailyHealthCheckData, UrineProteinData } from "./sqliteService";

const DEMO_PHONE = "5550001234";
const DAYS = 60;

// ============================================================================
// Helpers
// ============================================================================

/** Random float between min and max, rounded to 1 decimal */
function randFloat(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

/** Random integer between min and max (inclusive) */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Returns true with given probability (0-1) */
function chance(probability: number): boolean {
  return Math.random() < probability;
}

/** Generate a timestamp for a given day offset and hour */
function makeTimestamp(daysAgo: number, hour: number, minuteJitter: number = 30): number {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, randInt(0, minuteJitter), randInt(0, 59), 0);
  return date.getTime();
}

/** Linear interpolation — value progresses from start to end over the 60-day window */
function lerp(start: number, end: number, dayIndex: number): number {
  const t = dayIndex / DAYS;
  return start + (end - start) * t;
}

// ============================================================================
// Demo Devices Seeder
// ============================================================================

function seedDemoDevices(): void {
  saveDevice({
    id: "demo_bp5s",
    name: "iHealth BP5S",
    type: "BP",
    mac: "AA:BB:CC:DD:EE:01",
    model: "BP5S",
    friendlyName: "Blood Pressure Monitor",
    source: "iHealthSDK",
  });

  saveDevice({
    id: "demo_hs2s",
    name: "iHealth HS2S",
    type: "SCALE",
    mac: "AA:BB:CC:DD:EE:02",
    model: "HS2S",
    friendlyName: "Smart Scale",
    source: "iHealthSDK",
  });

  console.log("📱 Demo devices seeded (BP5S, HS2S)");
}

// ============================================================================
// Blood Pressure Seeder
// ============================================================================
// Pattern: starts ~132/84, trends up to ~148/94 over 60 days
// 1–2 readings per day, ~8% missed days
// Heart rate: 78–92 bpm, rising slightly

function seedBloodPressure(): number {
  let count = 0;

  for (let day = DAYS; day >= 0; day--) {
    // ~8% chance of skipping a day
    if (chance(0.08)) continue;

    // Base values that trend upward
    const baseSystolic = lerp(132, 148, DAYS - day);
    const baseDiastolic = lerp(84, 94, DAYS - day);
    const baseHR = lerp(78, 92, DAYS - day);

    // Morning reading (always if not skipped)
    const sysMorning = Math.round(baseSystolic + randFloat(-6, 6));
    const diaMorning = Math.round(baseDiastolic + randFloat(-4, 4));
    const hrMorning = Math.round(baseHR + randFloat(-5, 5));
    const tsMorning = makeTimestamp(day, randInt(7, 9));

    saveReading({
      id: `demo_bp_${day}_am`,
      deviceId: "demo_bp5s",
      deviceName: "iHealth BP5S",
      type: "BP",
      value: sysMorning,
      value2: diaMorning,
      heartRate: hrMorning,
      unit: "mmHg",
      ts: tsMorning,
      synced: true,
      measurementCondition: `${hrMorning} bpm`,
    });
    count++;

    // ~60% chance of an evening reading
    if (chance(0.6)) {
      // Evening readings tend to be slightly higher
      const sysEvening = Math.round(baseSystolic + randFloat(-4, 8));
      const diaEvening = Math.round(baseDiastolic + randFloat(-3, 5));
      const hrEvening = Math.round(baseHR + randFloat(-3, 7));
      const tsEvening = makeTimestamp(day, randInt(18, 21));

      saveReading({
        id: `demo_bp_${day}_pm`,
        deviceId: "demo_bp5s",
        deviceName: "iHealth BP5S",
        type: "BP",
        value: sysEvening,
        value2: diaEvening,
        heartRate: hrEvening,
        unit: "mmHg",
        ts: tsEvening,
        synced: true,
        measurementCondition: `${hrEvening} bpm`,
      });
      count++;
    }
  }

  return count;
}

// ============================================================================
// Weight Seeder
// ============================================================================
// Pattern: starts ~228 lbs, gradual gain to ~234 lbs (normal pregnancy gain)
// 1 reading per day, ~20% missed days

function seedWeight(): number {
  let count = 0;

  for (let day = DAYS; day >= 0; day--) {
    // ~20% chance of skipping
    if (chance(0.2)) continue;

    // Gradual weight gain: ~228 → ~234 over 60 days
    const baseWeight = lerp(228.0, 234.0, DAYS - day);
    const weight = randFloat(baseWeight - 0.8, baseWeight + 0.8);
    const ts = makeTimestamp(day, randInt(6, 8)); // morning weigh-in

    saveReading({
      id: `demo_wt_${day}`,
      deviceId: "demo_hs2s",
      deviceName: "iHealth HS2S",
      type: "SCALE",
      value: weight,
      unit: "lbs",
      ts: ts,
      synced: true,
    });
    count++;
  }

  return count;
}

// ============================================================================
// Daily Health Checks Seeder
// ============================================================================
// Pattern: 85% compliance, increasing symptom frequency in later weeks
// Early weeks: almost always "no" to both
// Later weeks: occasional headaches, rare visual disturbances

function seedDailyHealthChecks(): number {
  let count = 0;

  for (let day = DAYS; day >= 0; day--) {
    // 85% compliance
    if (chance(0.15)) continue;

    const progress = (DAYS - day) / DAYS; // 0 → 1 over 60 days
    const ts = makeTimestamp(day, randInt(7, 9));

    // Headache probability increases: 5% early → 25% late
    const headacheChance = lerp(0.05, 0.25, DAYS - day);
    const hasHeadaches = chance(headacheChance);

    // Visual disturbance probability: 0% early → 12% late (only in last 3 weeks)
    const visualChance = progress > 0.65 ? lerp(0, 0.12, DAYS - day) : 0;
    const hasVisualDisturbances = chance(visualChance);

    let details: string | undefined;
    if (hasHeadaches && hasVisualDisturbances) {
      details = "Mild headache since morning, occasional blurry spots";
    } else if (hasHeadaches) {
      const headacheDescriptions = [
        "Mild headache, went away after resting",
        "Dull headache behind eyes",
        "Slight headache this morning",
        "Pressure feeling in temples",
      ];
      details = headacheDescriptions[randInt(0, headacheDescriptions.length - 1)];
    } else if (hasVisualDisturbances) {
      details = "Brief floaters when standing up";
    }

    const data: DailyHealthCheckData = {
      hasHeadaches,
      hasVisualDisturbances,
      details,
    };

    // Use the saveScreeningResponse function but override the timestamp
    // by directly inserting (saveScreeningResponse uses Date.now())
    saveScreeningResponseWithTimestamp(
      "daily_health_check",
      data,
      ts
    );
    count++;
  }

  return count;
}

// ============================================================================
// Urine Protein Seeder
// ============================================================================
// Pattern: every ~3 days, worsening trend
// Weeks 1-3: mostly Negative
// Weeks 4-5: mix of Negative and Trace
// Weeks 6-7: mix of Trace and +1
// Weeks 8-9: occasional +1, rare +2

function seedUrineProtein(): number {
  let count = 0;

  const results: Array<"Negative" | "Trace" | "+1" | "+2" | "+3" | "+4"> = [
    "Negative", "Trace", "+1", "+2", "+3", "+4",
  ];

  for (let day = DAYS; day >= 0; day -= 3) {
    // Occasional skip (~10%)
    if (chance(0.1)) continue;

    const progress = (DAYS - day) / DAYS;
    const ts = makeTimestamp(day, randInt(8, 11));

    let result: typeof results[number];

    if (progress < 0.35) {
      // Weeks 1-3: mostly Negative
      result = chance(0.85) ? "Negative" : "Trace";
    } else if (progress < 0.55) {
      // Weeks 4-5: mix of Negative and Trace
      result = chance(0.5) ? "Negative" : "Trace";
    } else if (progress < 0.75) {
      // Weeks 5-6: mix of Trace and +1
      const roll = Math.random();
      result = roll < 0.3 ? "Negative" : roll < 0.7 ? "Trace" : "+1";
    } else if (progress < 0.9) {
      // Weeks 7-8: Trace to +1, occasional +2
      const roll = Math.random();
      result = roll < 0.2 ? "Trace" : roll < 0.7 ? "+1" : "+2";
    } else {
      // Last week: +1 to +2
      const roll = Math.random();
      result = roll < 0.3 ? "+1" : roll < 0.8 ? "+2" : "+3";
    }

    const data: UrineProteinData = { result };

    saveScreeningResponseWithTimestamp(
      "urine_protein_result",
      data,
      ts
    );
    count++;
  }

  return count;
}

// ============================================================================
// Helper: Save screening response with a specific timestamp
// ============================================================================
// The standard saveScreeningResponse() uses Date.now() for timestamp.
// We need to override that for historical seeding, so we import the db directly.

import { open } from "react-native-quick-sqlite";

const db = open({ name: "trinity.db" });

function saveScreeningResponseWithTimestamp(
  type: string,
  data: DailyHealthCheckData | UrineProteinData,
  timestamp: number
): void {
  const id = `demo_${type}_${timestamp}_${Math.random().toString(36).substr(2, 6)}`;
  const dataJson = JSON.stringify(data);

  try {
    db.execute(
      "INSERT OR REPLACE INTO screening_responses (id, type, timestamp, data, synced) VALUES (?, ?, ?, ?, 1);",
      [id, type, timestamp, dataJson]
    );
  } catch (e) {
    console.error("❌ Failed to save demo screening response:", e);
  }
}

// ============================================================================
// Clear Demo Data
// ============================================================================

function clearDemoData(): void {
  try {
    db.execute("DELETE FROM readings WHERE id LIKE 'demo_%';");
    db.execute("DELETE FROM screening_responses WHERE id LIKE 'demo_%';");
    db.execute("DELETE FROM devices WHERE id LIKE 'demo_%';");
    console.log("🗑  Cleared previous demo data");
  } catch (e) {
    console.error("❌ Failed to clear demo data:", e);
  }
}

// ============================================================================
// Main Seeder
// ============================================================================

export function seedDemoData(): void {
  console.log("🌱 Seeding demo data (60 days)...");

  // Clear any previous demo data first
  clearDemoData();

  // Seed demo devices so the Devices tab isn't empty
  seedDemoDevices();

  const bpCount = seedBloodPressure();
  const weightCount = seedWeight();
  const checkCount = seedDailyHealthChecks();
  const urineCount = seedUrineProtein();

  console.log("============================================");
  console.log("  Demo Data Seeded");
  console.log("============================================");
  console.log(`  BP readings:          ${bpCount}`);
  console.log(`  Weight readings:      ${weightCount}`);
  console.log(`  Daily health checks:  ${checkCount}`);
  console.log(`  Urine protein:        ${urineCount}`);
  console.log("============================================");
}

/**
 * Check if the logged-in user is the demo account
 */
export function isDemoAccount(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned === DEMO_PHONE || cleaned === `1${DEMO_PHONE}`;
}

/**
 * Check if demo data already exists (to avoid re-seeding on every login)
 */
export function hasDemoData(): boolean {
  try {
    const res = db.execute(
      "SELECT COUNT(*) as count FROM readings WHERE id LIKE 'demo_%';"
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows.item(0).count > 0;
    }
    return false;
  } catch (e) {
    return false;
  }
}

export default {
  seedDemoData,
  isDemoAccount,
  hasDemoData,
  clearDemoData,
};