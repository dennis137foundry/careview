/**
 * The guided-measurement animations bundled with the app (src/assets/guided —
 * see SOURCES.md there for where each file came from and its checksum).
 *
 * Each file is required lazily, inside its loader, so an animation is parsed
 * only when a screen first shows it — not for every patient at app start.
 */

import type { LottieTiming } from "./playback";

const LOADERS = {
  // Shared connection screens
  common_01_near_phone: () => require("../assets/guided/common_01_near_phone.json"),
  common_02_searching: () => require("../assets/guided/common_02_searching.json"),
  common_03_not_found: () => require("../assets/guided/common_03_not_found.json"),
  common_04_success: () => require("../assets/guided/common_04_success.json"),
  common_05_try_again: () => require("../assets/guided/common_05_try_again.json"),

  // iHealth BP3L blood pressure cuff
  bp3l_01_sit_rest: () => require("../assets/guided/bp3l_01_sit_rest.json"),
  bp3l_02_wrap_cuff: () => require("../assets/guided/bp3l_02_wrap_cuff.json"),
  bp3l_03_arm_position: () => require("../assets/guided/bp3l_03_arm_position.json"),
  bp3l_04_inflating: () => require("../assets/guided/bp3l_04_inflating.json"),
  bp3l_05_done: () => require("../assets/guided/bp3l_05_done.json"),

  // iHealth HS2S scale (no "place the scale" step, by design)
  hs2s_01_step_on: () => require("../assets/guided/hs2s_01_step_on.json"),
  hs2s_02_stand_still: () => require("../assets/guided/hs2s_02_stand_still.json"),
  hs2s_03_step_off: () => require("../assets/guided/hs2s_03_step_off.json"),

  // iHealth BG5S glucose meter
  bg5s_01_wash_hands: () => require("../assets/guided/bg5s_01_wash_hands.json"),
  bg5s_02_insert_strip: () => require("../assets/guided/bg5s_02_insert_strip.json"),
  bg5s_03_lance_finger: () => require("../assets/guided/bg5s_03_lance_finger.json"),
  bg5s_04_blood_drop: () => require("../assets/guided/bg5s_04_blood_drop.json"),
  bg5s_05_apply_blood: () => require("../assets/guided/bg5s_05_apply_blood.json"),
  bg5s_06_measuring: () => require("../assets/guided/bg5s_06_measuring.json"),
  bg5s_07_done: () => require("../assets/guided/bg5s_07_done.json"),

  // A&D UA-651BLE cuff with its own monitor
  and_01_pairing: () => require("../assets/guided/and_01_pairing.json"),
  and_02_wrap_cuff: () => require("../assets/guided/and_02_wrap_cuff.json"),
  and_03_press_start: () => require("../assets/guided/and_03_press_start.json"),
  and_04_measuring: () => require("../assets/guided/and_04_measuring.json"),
  and_05_keep_near: () => require("../assets/guided/and_05_keep_near.json"),
} as const;

export type AnimationName = keyof typeof LOADERS;

export const ANIMATION_NAMES = Object.keys(LOADERS) as AnimationName[];

/** The parsed Lottie document (an object the player takes as `source`). */
export function loadAnimation(name: AnimationName): LottieTiming & Record<string, unknown> {
  return LOADERS[name]();
}
