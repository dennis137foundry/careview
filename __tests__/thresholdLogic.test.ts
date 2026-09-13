import {
  EMR_DEFAULT_THRESHOLDS,
  isBPHigh,
  isGlucoseHigh,
  thresholdsFromServer,
  thresholdsFromStored,
} from "../src/utils/thresholdLogic";

const t = { systolicHigh: 150, diastolicHigh: 100, glucoseHigh: 200 };

describe("isBPHigh — either number at or above its threshold", () => {
  it("is High at the threshold, on either side", () => {
    expect(isBPHigh(150, 80, t)).toBe(true);
    expect(isBPHigh(120, 100, t)).toBe(true);
  });
  it("is not High just under both", () => {
    expect(isBPHigh(149, 99, t)).toBe(false);
  });
});

describe("isGlucoseHigh", () => {
  it("is High at the threshold", () => {
    expect(isGlucoseHigh(200, t)).toBe(true);
    expect(isGlucoseHigh(199, t)).toBe(false);
  });
  it("never flags a missing reading", () => {
    expect(isGlucoseHigh(0, t)).toBe(false);
  });
});

describe("thresholdsFromServer — the EMR's numbers win, missing keeps current", () => {
  it("reads bpThresholds + bgThresholds", () => {
    expect(
      thresholdsFromServer(
        { bpThresholds: { systolicHigh: 135, diastolicHigh: 85 }, bgThresholds: { high: 160 } },
        t
      )
    ).toEqual({ systolicHigh: 135, diastolicHigh: 85, glucoseHigh: 160 });
  });
  it("keeps the current value for anything the response lacks (older EMR)", () => {
    expect(thresholdsFromServer({ bpThresholds: { systolicHigh: 135, diastolicHigh: 85 } }, t))
      .toEqual({ systolicHigh: 135, diastolicHigh: 85, glucoseHigh: 200 });
    expect(thresholdsFromServer({}, t)).toEqual(t);
    expect(thresholdsFromServer({ bgThresholds: { high: "180" } }, t).glucoseHigh).toBe(200);
  });
});

describe("thresholdsFromStored — a row from app 2.3 has no glucoseHigh", () => {
  it("fills only the missing column with the EMR default", () => {
    expect(thresholdsFromStored({ systolicHigh: 150, diastolicHigh: 100 })).toEqual({
      systolicHigh: 150,
      diastolicHigh: 100,
      glucoseHigh: EMR_DEFAULT_THRESHOLDS.glucoseHigh,
    });
  });
});
