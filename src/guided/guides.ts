/**
 * Which guided-measurement animation and text each device shows, and when.
 *
 * The rule that shapes this file: an animation never moves on by itself. Each
 * step either waits for the patient (a button) or for something the device
 * really reports (found, connected, reading arrived). Animation length is never
 * used as a timer.
 *
 *  - BP3L (iHealth cuff, CaptureScreen): three preparation steps the patient
 *    taps through, then the existing capture — phone finds the cuff, connects,
 *    the cuff measures, the reading arrives.
 *  - HS2S (iHealth scale, CaptureScreen): no preparation. Stepping on is what
 *    wakes the scale, so "step on" shows while the phone looks for it.
 *  - BG5S (iHealth glucose meter, CaptureScreen): the meter is not live — the
 *    patient tests on the meter and the app imports the stored readings
 *    afterwards. The seven steps are therefore an optional "How to test"
 *    walkthrough the patient pages through, ending with the usual import.
 *    (The native layer can report strip / blood / result events, but that live
 *    path has not been tested on a real meter, so nothing here depends on it.)
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
  /** Optional "How to test" walkthrough offered on the start screen. */
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
