/**
 * Which guided-measurement animation and text each device shows, and when.
 *
 * The rule that shapes this file: an animation never moves on by itself. Each
 * step either waits for the patient (a button) or for something the device
 * really reports (found, connected, reading arrived). Animation length is never
 * used as a timer.
 *
 *  - BP3L (iHealth cuff, CaptureScreen): three preparation steps the patient
 *    taps through, then the capture — phone finds the cuff, connects; the
 *    "measuring" picture starts when the cuff itself reports zeroing or
 *    pressure, with the live cuff pressure shown; the reading arrives. Cuff
 *    error codes are explained in plain words (bpErrorText).
 *  - HS2S (iHealth scale, CaptureScreen): no preparation. Stepping on is what
 *    wakes the scale, so "step on" shows while the phone looks for it; the
 *    scale's live weight shows while she stands still.
 *  - BG5S (iHealth glucose meter, CaptureScreen): two ways in.
 *      Import (the main button, unchanged): test on the meter, the app pulls
 *      the stored readings afterwards.
 *      Live "Test now, step by step" (the seven `tutorial` steps): the phone
 *      connects to the meter and starts its measurement. Inserting the strip
 *      is what turns the meter on, so step 2 waits for the meter to connect
 *      and accept the measurement; prick and drop are the patient's taps; the
 *      meter's "blood detected" moves to "wait for your result"; its result is
 *      saved through the usual sample-window prompt; step 7 (throw away)
 *      shows with the saved reading. Meter error codes: bgErrorText. The
 *      meter turning off (3 minutes without blood, strip out) ends the test.
 *      BG5S_LIVE_STEP names the step indexes.
 *  - A&D UA-651BLE (BleCaptureScreen): the patient starts the monitor with its
 *    START button and the reading comes to the phone afterwards. Two
 *    preparation steps, then "measuring" until the patient says it is done or
 *    the monitor connects, then "keep near" until the reading arrives.
 *
 * Every other model (BP5, BP5S, HS2, HS4S, other generic Bluetooth monitors)
 * gets no guide and keeps the capture screen exactly as it was: these
 * animations show particular devices and would mislead on others.
 *
 * Text comes from each manufacturer's own instructions (iHealth BP3L and BG5S
 * quick start guides, A&D UA-651BLE quick start guide and manual), as selected
 * in the animation brief.
 */

import type { TKey } from "../i18n/locales/en";
import type { AnimationName } from "./animations";

export type GuideStep = { anim: AnimationName; title: TKey; body: TKey };

/** iHealth devices (CaptureScreen). */
export type CaptureGuide = {
  model: "BP3L" | "HS2S" | "BG5S";
  /** Shown before the capture starts; the patient taps through them. */
  prep: GuideStep[];
  /** The BG5S live test, step by step (BG5S_LIVE_STEP); empty for the others. */
  tutorial: GuideStep[];
  /** While the phone looks for the device. */
  scan: GuideStep;
  /** Found, connecting. */
  connect: GuideStep;
  /** Connected, waiting for the reading (or importing, for the meter). */
  measure: GuideStep;
  /** Plays once above the saved reading. */
  success: AnimationName;
};

/** Generic Bluetooth monitors (BleCaptureScreen). */
export type BleGuide = {
  model: "UA651BLE";
  prep: GuideStep[];
  /** Cuff measuring; the patient can say "It's done". */
  measuring: GuideStep;
  /** Measurement finished; waiting for the monitor to send it. */
  keepNear: GuideStep;
  success: AnimationName;
};

export const NOT_FOUND_ANIMATION: AnimationName = "common_03_not_found";
export const TRY_AGAIN_ANIMATION: AnimationName = "common_05_try_again";
/** The first-time pairing picture on the add-device screen. */
export const AND_PAIRING_ANIMATION: AnimationName = "and_01_pairing";

const BP3L: CaptureGuide = {
  model: "BP3L",
  prep: [
    { anim: "bp3l_01_sit_rest", title: "guide.bp3lSitTitle", body: "guide.bp3lSitBody" },
    { anim: "bp3l_02_wrap_cuff", title: "guide.bp3lCuffTitle", body: "guide.bp3lCuffBody" },
    { anim: "bp3l_03_arm_position", title: "guide.bp3lArmTitle", body: "guide.bp3lArmBody" },
  ],
  tutorial: [],
  scan: { anim: "bp3l_03_arm_position", title: "guide.bp3lConnectTitle", body: "guide.bp3lConnectBody" },
  connect: { anim: "bp3l_03_arm_position", title: "guide.bp3lConnectTitle", body: "guide.bp3lConnectBody" },
  measure: { anim: "bp3l_04_inflating", title: "guide.bp3lMeasureTitle", body: "guide.bp3lMeasureBody" },
  success: "bp3l_05_done",
};

const HS2S: CaptureGuide = {
  model: "HS2S",
  prep: [],
  tutorial: [],
  scan: { anim: "hs2s_01_step_on", title: "guide.hs2sStepOnTitle", body: "guide.hs2sStepOnBody" },
  // Found means she is already on it: the scale only wakes when stepped on.
  connect: { anim: "hs2s_02_stand_still", title: "guide.hs2sStandTitle", body: "guide.hs2sStandBody" },
  measure: { anim: "hs2s_02_stand_still", title: "guide.hs2sStandTitle", body: "guide.hs2sStandBody" },
  success: "hs2s_03_step_off",
};

const BG5S: CaptureGuide = {
  model: "BG5S",
  prep: [],
  tutorial: [
    { anim: "bg5s_01_wash_hands", title: "guide.bgReadyTitle", body: "guide.bgReadyBody" },
    { anim: "bg5s_02_insert_strip", title: "guide.bgStripTitle", body: "guide.bgStripBody" },
    { anim: "bg5s_03_lance_finger", title: "guide.bgLanceTitle", body: "guide.bgLanceBody" },
    { anim: "bg5s_04_blood_drop", title: "guide.bgDropTitle", body: "guide.bgDropBody" },
    { anim: "bg5s_05_apply_blood", title: "guide.bgApplyTitle", body: "guide.bgApplyBody" },
    { anim: "bg5s_06_measuring", title: "guide.bgWaitTitle", body: "guide.bgWaitBody" },
    { anim: "bg5s_07_done", title: "guide.bgDoneTitle", body: "guide.bgDoneBody" },
  ],
  scan: { anim: "common_01_near_phone", title: "guide.bgFindTitle", body: "guide.bgNearBody" },
  connect: { anim: "common_02_searching", title: "guide.bgImportTitle", body: "guide.bgNearBody" },
  measure: { anim: "common_02_searching", title: "guide.bgImportTitle", body: "guide.bgNearBody" },
  success: "common_04_success",
};

const UA651BLE: BleGuide = {
  model: "UA651BLE",
  prep: [
    { anim: "and_02_wrap_cuff", title: "guide.andCuffTitle", body: "guide.andCuffBody" },
    { anim: "and_03_press_start", title: "guide.andStartTitle", body: "guide.andStartBody" },
  ],
  measuring: { anim: "and_04_measuring", title: "guide.andMeasureTitle", body: "guide.andMeasureBody" },
  keepNear: { anim: "and_05_keep_near", title: "guide.andNearTitle", body: "guide.andNearBody" },
  success: "common_04_success",
};

type DeviceLike =
  | { model?: string | null; name?: string | null; source?: string | null }
  | null
  | undefined;

/** An A&D UA-651BLE: model from pairing, or its advertised name on older rows. */
export function isUA651BLE(device: DeviceLike): boolean {
  if (!device) return false;
  const norm = (s?: string | null) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm(device.model) === "UA651BLE" || norm(device.name).includes("UA651BLE");
}

/** The guide for an iHealth device, or null to keep the plain capture screen. */
export function captureGuideFor(device: DeviceLike): CaptureGuide | null {
  if (!device || device.source === "BLE_GATT") return null;
  switch ((device.model || "").toUpperCase()) {
    case "BP3L":
      return BP3L;
    case "HS2S":
      return HS2S;
    case "BG5S":
      return BG5S;
    default:
      return null;
  }
}

/** The guide for a generic Bluetooth monitor, or null to keep the plain screen. */
export function bleGuideFor(device: DeviceLike): BleGuide | null {
  if (!device || device.source !== "BLE_GATT") return null;
  return isUA651BLE(device) ? UA651BLE : null;
}

/** Every guide, for tests. */
export const ALL_GUIDES = { BP3L, HS2S, BG5S, UA651BLE };

/**
 * The BG5S live test walks the seven `tutorial` steps by index. Which steps
 * wait for the patient and which for the meter:
 *   READY  (tap) → STRIP (meter connects and accepts the measurement)
 *   → LANCE (tap) → DROP (tap) → APPLY (meter: blood detected; also from
 *   LANCE / DROP if she is quicker than her taps) → WAIT (meter: result)
 *   → DONE (shown with the saved reading).
 */
export const BG5S_LIVE_STEP = {
  READY: 0,
  STRIP: 1,
  LANCE: 2,
  DROP: 3,
  APPLY: 4,
  WAIT: 5,
  DONE: 6,
} as const;

/** Steps the patient moves on from with a tap; the others wait for the meter. */
export function bgLiveStepIsTap(index: number): boolean {
  return (
    index === BG5S_LIVE_STEP.READY ||
    index === BG5S_LIVE_STEP.LANCE ||
    index === BG5S_LIVE_STEP.DROP
  );
}

export type DeviceErrorText = { title: TKey; body: TKey };

/**
 * A cuff error code in plain words (iHealth BP error numbers: iOS
 * BPDeviceError in BPMacroFile.h, the same numbers on Android's
 * ERROR_NUM_BP). Null for the codes that are not about the measurement
 * (data / communication), which keep the general "try again".
 */
export function bpErrorText(code: unknown): DeviceErrorText | null {
  const n = typeof code === "number" ? code : Number.NaN;
  const title: TKey = "guide.bpErrTitle";
  switch (n) {
    case 0: // arm / wrist movement
    case 17: // movement beyond range
      return { title, body: "guide.bpErrMove" };
    case 1: // no systolic
    case 2: // no diastolic
      return { title, body: "guide.bpErrNoPulse" };
    case 3: // blocked, or cuff too tight
      return { title, body: "guide.bpErrTight" };
    case 4: // leaking, or cuff too loose
      return { title, body: "guide.bpErrLoose" };
    case 5: // over 300 mmHg
    case 6: // over 15 mmHg for 160 s
      return { title, body: "guide.bpErrPressure" };
    case 13:
      return { title, body: "guide.bpErrBattery" };
    case 15: // systolic over 260 or diastolic over 199
      return { title, body: "guide.bpErrRangeHigh" };
    case 16: // systolic under 60 or diastolic under 40
      return { title, body: "guide.bpErrRangeLow" };
    case 18: // heart rate over limit
    case 19: // heart rate under limit
    case 20: // average pressure over limit
      return { title, body: "guide.bpErrRepeat" };
    default:
      return null;
  }
}

/**
 * A glucose meter error code in plain words (iOS BG5SError in BGMacroFile.h;
 * Android Bg5sProfile.ERROR_* — the same numbers). Null for codes that are
 * about the Bluetooth link or the app, which keep the general "try again".
 */
export function bgErrorText(code: unknown): DeviceErrorText | null {
  const n = typeof code === "number" ? code : Number.NaN;
  const title: TKey = "guide.bgErrTitle";
  switch (n) {
    case 0:
      return { title, body: "guide.bgErrLowBattery" };
    case 1: // strip pulled out during the measurement
      return { title, body: "guide.bgErrStripOut" };
    case 3: // used strip or moisture
      return { title, body: "guide.bgErrUsedStrip" };
    case 5: // too cold
    case 6: // too hot
      return { title, body: "guide.bgErrTemperature" };
    case 8: // below the meter's range (LO)
      return { title: "guide.bgErrLoTitle", body: "guide.bgErrLoBody" };
    case 9: // above the meter's range (HI)
      return { title: "guide.bgErrHiTitle", body: "guide.bgErrHiBody" };
    case 2: // reference voltage
    case 4: // reading transmission (EEPROM)
    case 10: // factory error
      return { title, body: "guide.bgErrRepeat" };
    default:
      return null;
  }
}
