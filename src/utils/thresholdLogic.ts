// src/utils/thresholdLogic.ts
// The high-reading thresholds and the two predicates that use them. Pure —
// no React, no native modules — so it is unit-tested in __tests__/.
//
// THE EMR IS THE ONLY SOURCE OF A THRESHOLD. It resolves, per number, the
// patient's own value → her provider's → the system default
// (VITAL_THRESHOLDS.MD in the EMR repo) and hands the result to the phone at
// login and on every launch / foreground / capture-screen open
// (profileRefreshService). The phone stores the last values the EMR sent so a
// capture still works offline; it never invents one of its own.

export interface VitalThresholds {
  /** BP is High when systolic >= this ... */
  systolicHigh: number;
  /** ... OR diastolic >= this. */
  diastolicHigh: number;
  /** Blood glucose (mg/dL) is High when the value >= this. */
  glucoseHigh: number;
}

/**
 * The EMR's own system defaults (ThresholdHelper::DEFAULTS). Used in exactly
 * one situation: a user row written by an app version that did not store one
 * of these numbers yet (glucoseHigh arrived with 2.4), until the launch-time
 * fetch replaces it. Never used to judge a reading in preference to a value
 * the EMR has sent.
 */
export const EMR_DEFAULT_THRESHOLDS: VitalThresholds = {
  systolicHigh: 140,
  diastolicHigh: 90,
  glucoseHigh: 180,
};

/**
 * Read the thresholds out of an EMR response (verify_code.php or
 * patient_profile.php):
 *   bpThresholds: { systolicHigh, diastolicHigh }
 *   bgThresholds: { high }
 * The EMR always sends all three as numbers; a field that is missing or not
 * a finite number keeps the value in `current` (the last one the EMR sent).
 */
export function thresholdsFromServer(
  data: any,
  current: VitalThresholds
): VitalThresholds {
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    systolicHigh: num(data?.bpThresholds?.systolicHigh, current.systolicHigh),
    diastolicHigh: num(data?.bpThresholds?.diastolicHigh, current.diastolicHigh),
    glucoseHigh: num(data?.bgThresholds?.high, current.glucoseHigh),
  };
}

/** A stored user row → thresholds; a column the row predates gets the EMR default. */
export function thresholdsFromStored(u: {
  systolicHigh?: number | null;
  diastolicHigh?: number | null;
  glucoseHigh?: number | null;
}): VitalThresholds {
  return {
    systolicHigh: u.systolicHigh ?? EMR_DEFAULT_THRESHOLDS.systolicHigh,
    diastolicHigh: u.diastolicHigh ?? EMR_DEFAULT_THRESHOLDS.diastolicHigh,
    glucoseHigh: u.glucoseHigh ?? EMR_DEFAULT_THRESHOLDS.glucoseHigh,
  };
}

/** BP is High when EITHER number meets its threshold — same test as the EMR. */
export function isBPHigh(
  systolic: number,
  diastolic: number,
  t: VitalThresholds
): boolean {
  return systolic >= t.systolicHigh || diastolic >= t.diastolicHigh;
}

/** Glucose is High at or above the threshold — same test as the EMR. */
export function isGlucoseHigh(value: number, t: VitalThresholds): boolean {
  return value > 0 && value >= t.glucoseHigh;
}
