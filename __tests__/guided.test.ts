import en from "../src/i18n/locales/en";
import { ANIMATION_NAMES, loadAnimation, type AnimationName } from "../src/guided/animations";
import { planPlayback, progressAt } from "../src/guided/playback";
import {
  ALL_GUIDES,
  AND_PAIRING_ANIMATION,
  BG5S_LIVE_STEP,
  NOT_FOUND_ANIMATION,
  TRY_AGAIN_ANIMATION,
  bgErrorText,
  bgLiveStepIsTap,
  bleGuideFor,
  bpErrorText,
  captureGuideFor,
  isUA651BLE,
  type GuideStep,
} from "../src/guided/guides";
import es from "../src/i18n/locales/es";
import ht from "../src/i18n/locales/ht";

// What the animation brief asks of each file (markers → how it plays).
const EXPECTED_KIND: Record<AnimationName, "introThenLoop" | "loop" | "once"> = {
  common_01_near_phone: "introThenLoop",
  common_02_searching: "loop",
  common_03_not_found: "once",
  common_04_success: "once",
  common_05_try_again: "once",
  bp3l_01_sit_rest: "introThenLoop",
  bp3l_02_wrap_cuff: "once",
  bp3l_03_arm_position: "once",
  bp3l_04_inflating: "introThenLoop",
  bp3l_05_done: "once",
  hs2s_01_step_on: "once",
  hs2s_02_stand_still: "loop",
  hs2s_03_step_off: "once",
  bg5s_01_wash_hands: "introThenLoop",
  bg5s_02_insert_strip: "introThenLoop",
  bg5s_03_lance_finger: "once",
  bg5s_04_blood_drop: "once",
  bg5s_05_apply_blood: "introThenLoop",
  bg5s_06_measuring: "loop",
  bg5s_07_done: "once",
  and_01_pairing: "introThenLoop",
  and_02_wrap_cuff: "once",
  and_03_press_start: "once",
  and_04_measuring: "loop",
  and_05_keep_near: "loop",
};

describe("bundled animations", () => {
  it("are the 25 files of the brief", () => {
    expect([...ANIMATION_NAMES].sort()).toEqual(Object.keys(EXPECTED_KIND).sort());
  });

  it.each(ANIMATION_NAMES)("%s is a 1080 x 1080, 30 fps vector file", (name) => {
    const a: any = loadAnimation(name);
    expect(a.w).toBe(1080);
    expect(a.h).toBe(1080);
    expect(a.fr).toBe(30);
    expect(a.assets ?? []).toEqual([]); // no embedded images
    expect(a.layers.every((l: any) => l.ty === 3 || l.ty === 4)).toBe(true); // null + shape only
  });

  it.each(ANIMATION_NAMES)("%s plays as the brief says, inside its frames", (name) => {
    const a: any = loadAnimation(name);
    const plan = planPlayback(a);
    expect(plan.kind).toBe(EXPECTED_KIND[name]);

    const ranges =
      plan.kind === "introThenLoop" ? [plan.intro, plan.loop] : plan.kind === "loop" ? [plan.loop] : [plan.once];
    for (const [first, last] of ranges) {
      expect(first).toBeGreaterThanOrEqual(a.ip);
      expect(last).toBeLessThan(a.op); // never `op`: layers end there
      expect(last).toBeGreaterThan(first);
    }
    if (plan.kind === "introThenLoop") {
      expect(plan.loop[0]).toBe(plan.intro[1] + 1); // the loop follows the intro
    }
    expect(plan.still).toBeGreaterThanOrEqual(a.ip);
    expect(plan.still).toBeLessThan(a.op);
  });
});

describe("planPlayback", () => {
  it("turns exclusive-end markers into inclusive frame ranges", () => {
    const plan = planPlayback({
      ip: 0,
      op: 120,
      markers: [
        { cm: "intro", tm: 0, dr: 60 },
        { cm: "loop", tm: 60, dr: 60 },
      ],
    });
    expect(plan).toEqual({ kind: "introThenLoop", intro: [0, 59], loop: [60, 119], still: 60 });
  });

  it("holds the last drawn frame of a one-shot", () => {
    expect(planPlayback({ ip: 0, op: 45, markers: [{ cm: "outro", tm: 0, dr: 45 }] })).toEqual({
      kind: "once",
      once: [0, 44],
      still: 44,
    });
  });

  it("plays the whole file once when it has no markers", () => {
    expect(planPlayback({ ip: 0, op: 30 })).toEqual({ kind: "once", once: [0, 29], still: 29 });
  });

  it("maps a frame to player progress", () => {
    expect(progressAt({ ip: 0, op: 120 }, 60)).toBeCloseTo(0.5);
    expect(progressAt({ ip: 0, op: 0 }, 10)).toBe(0);
  });
});

describe("guides", () => {
  const steps = (g: any): GuideStep[] =>
    [...(g.prep ?? []), ...(g.tutorial ?? []), g.scan, g.connect, g.measure, g.measuring, g.keepNear].filter(
      Boolean
    );

  it.each(Object.entries(ALL_GUIDES))("%s uses only bundled animations and real text", (_n, g: any) => {
    for (const s of steps(g)) {
      expect(ANIMATION_NAMES).toContain(s.anim);
      expect(en[s.title]).toBeTruthy();
      expect(en[s.body]).toBeTruthy();
    }
    expect(ANIMATION_NAMES).toContain(g.success);
  });

  it("shared pictures exist", () => {
    for (const a of [NOT_FOUND_ANIMATION, TRY_AGAIN_ANIMATION, AND_PAIRING_ANIMATION]) {
      expect(ANIMATION_NAMES).toContain(a);
    }
  });

  it("picks the iHealth guide by model, and none for other models", () => {
    expect(captureGuideFor({ model: "BP3L", source: "iHealthSDK" })?.model).toBe("BP3L");
    expect(captureGuideFor({ model: "HS2S" })?.model).toBe("HS2S");
    expect(captureGuideFor({ model: "BG5S" })?.model).toBe("BG5S");
    for (const model of ["BP5", "BP5S", "HS2", "HS4S", "", undefined]) {
      expect(captureGuideFor({ model })).toBeNull();
    }
    expect(captureGuideFor(undefined)).toBeNull();
    // A generic Bluetooth device never gets an iHealth guide.
    expect(captureGuideFor({ model: "BP3L", source: "BLE_GATT" })).toBeNull();
  });

  it("gives the A&D guide only to a UA-651BLE", () => {
    expect(bleGuideFor({ model: "UA651BLE", source: "BLE_GATT" })?.model).toBe("UA651BLE");
    // Paired before the model was recovered from the name.
    expect(
      bleGuideFor({ model: "GATT_BP", name: "A&D_UA-651BLE_A89A0C", source: "BLE_GATT" })?.model
    ).toBe("UA651BLE");
    expect(bleGuideFor({ model: "UA767BLE", name: "A&D_UA-767BLE", source: "BLE_GATT" })).toBeNull();
    expect(bleGuideFor({ model: "GATT_BP", name: "BP Monitor", source: "BLE_GATT" })).toBeNull();
    expect(bleGuideFor({ model: "UA651BLE", source: "iHealthSDK" })).toBeNull();
    expect(isUA651BLE({ name: "a&d ua-651ble" })).toBe(true);
  });

  it("starts the scale at stepping on: there is no place-the-scale step", () => {
    const g = captureGuideFor({ model: "HS2S" })!;
    expect(g.prep).toEqual([]);
    expect(g.scan.anim).toBe("hs2s_01_step_on");
  });

  it("keeps the BP3L order of the brief: sit, cuff, arm, then measure", () => {
    const g = captureGuideFor({ model: "BP3L" })!;
    expect(g.prep.map((s) => s.anim)).toEqual([
      "bp3l_01_sit_rest",
      "bp3l_02_wrap_cuff",
      "bp3l_03_arm_position",
    ]);
    expect(g.measure.anim).toBe("bp3l_04_inflating");
    expect(g.success).toBe("bp3l_05_done");
  });

  it("walks the meter through all seven steps in order", () => {
    const g = captureGuideFor({ model: "BG5S" })!;
    expect(g.tutorial.map((s) => s.anim)).toEqual([
      "bg5s_01_wash_hands",
      "bg5s_02_insert_strip",
      "bg5s_03_lance_finger",
      "bg5s_04_blood_drop",
      "bg5s_05_apply_blood",
      "bg5s_06_measuring",
      "bg5s_07_done",
    ]);
  });

  it("names the live test steps after the seven animations", () => {
    const g = captureGuideFor({ model: "BG5S" })!;
    expect(g.tutorial[BG5S_LIVE_STEP.READY].anim).toBe("bg5s_01_wash_hands");
    expect(g.tutorial[BG5S_LIVE_STEP.STRIP].anim).toBe("bg5s_02_insert_strip");
    expect(g.tutorial[BG5S_LIVE_STEP.LANCE].anim).toBe("bg5s_03_lance_finger");
    expect(g.tutorial[BG5S_LIVE_STEP.DROP].anim).toBe("bg5s_04_blood_drop");
    expect(g.tutorial[BG5S_LIVE_STEP.APPLY].anim).toBe("bg5s_05_apply_blood");
    expect(g.tutorial[BG5S_LIVE_STEP.WAIT].anim).toBe("bg5s_06_measuring");
    expect(g.tutorial[BG5S_LIVE_STEP.DONE].anim).toBe("bg5s_07_done");
  });

  it("lets the patient tap past only her own live steps; the meter moves the rest", () => {
    const taps = Object.values(BG5S_LIVE_STEP).filter(bgLiveStepIsTap);
    expect(taps).toEqual([BG5S_LIVE_STEP.READY, BG5S_LIVE_STEP.LANCE, BG5S_LIVE_STEP.DROP]);
    // Never a tap past "apply" (no replaying the apply step) or the result.
    expect(bgLiveStepIsTap(BG5S_LIVE_STEP.STRIP)).toBe(false);
    expect(bgLiveStepIsTap(BG5S_LIVE_STEP.APPLY)).toBe(false);
    expect(bgLiveStepIsTap(BG5S_LIVE_STEP.WAIT)).toBe(false);
  });

  it("explains cuff and meter error codes with real text in every language", () => {
    const texts = [
      ...Array.from({ length: 40 }, (_x, i) => bpErrorText(i)),
      ...Array.from({ length: 12 }, (_x, i) => bgErrorText(i)),
      bgErrorText(500),
    ].filter(Boolean);
    expect(texts.length).toBeGreaterThan(10);
    for (const x of texts) {
      for (const key of [x!.title, x!.body]) {
        expect(en[key]).toBeTruthy();
        expect((es as any)[key]).toBeTruthy();
        expect((ht as any)[key]).toBeTruthy();
      }
    }
  });

  it("maps the cuff and meter codes the SDK documents", () => {
    expect(bpErrorText(0)?.body).toBe("guide.bpErrMove"); // arm movement
    expect(bpErrorText(3)?.body).toBe("guide.bpErrTight");
    expect(bpErrorText(4)?.body).toBe("guide.bpErrLoose");
    expect(bpErrorText(13)?.body).toBe("guide.bpErrBattery");
    expect(bpErrorText(15)?.body).toBe("guide.bpErrRangeHigh");
    expect(bpErrorText(11)).toBeNull(); // communication: the general "try again"
    expect(bpErrorText(undefined)).toBeNull();
    expect(bgErrorText(3)?.body).toBe("guide.bgErrUsedStrip");
    expect(bgErrorText(8)?.title).toBe("guide.bgErrLoTitle");
    expect(bgErrorText(9)?.title).toBe("guide.bgErrHiTitle");
    expect(bgErrorText(500)).toBeNull(); // command timeout: link, not the test
    expect(bgErrorText("3")).toBeNull();
  });

  it("never tells a patient to squeeze the finger", () => {
    const guideText = Object.entries(en)
      .filter(([k]) => k.startsWith("guide."))
      .map(([, v]) => v)
      .join(" ");
    expect(guideText).toMatch(/Don't squeeze/);
    expect(guideText.replace(/Don't squeeze/g, "")).not.toMatch(/squeez/i);
  });
});
