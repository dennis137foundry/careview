import {
  CGM_CONFIG,
  CgmSample,
  chunk,
  cleanSamples,
  isDexcomSource,
  newestTs,
  syncWindowStart,
  toPayload,
} from "../src/services/cgm/cgmLogic";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const s = (id: string, value: number, ts: number, sourceId = "com.dexcom.G7", sourceName = "Dexcom G7"): CgmSample => ({
  id,
  value,
  ts,
  sourceId,
  sourceName,
});

describe("isDexcomSource — only readings the Dexcom app wrote", () => {
  it("accepts Dexcom apps on both platforms", () => {
    expect(isDexcomSource("com.dexcom.G7", "Dexcom G7")).toBe(true); // iOS bundle id
    expect(isDexcomSource("com.dexcom.g7", "")).toBe(true); // Android package
    expect(isDexcomSource("com.dexcom.stelo", undefined)).toBe(true);
    expect(isDexcomSource("", "Stelo")).toBe(true);
  });
  it("refuses typed-in values and other apps", () => {
    expect(isDexcomSource("com.apple.Health", "Health")).toBe(false);
    expect(isDexcomSource("com.trinitycareview.app", "CareView")).toBe(false);
    expect(isDexcomSource("com.abbott.freestyle.libre", "FreeStyle Libre")).toBe(false);
    expect(isDexcomSource(null, null)).toBe(false);
  });
});

describe("syncWindowStart", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  it("backfills 30 days on the first sync", () => {
    expect(syncWindowStart(null, now)).toBe(now - CGM_CONFIG.backfillDays * DAY);
  });
  it("re-reads 6 hours before the newest reading sent (late, out-of-order readings)", () => {
    expect(syncWindowStart(now - DAY, now)).toBe(now - DAY - 6 * HOUR);
  });
  it("never reaches further back than the backfill", () => {
    expect(syncWindowStart(now - 90 * DAY, now)).toBe(now - CGM_CONFIG.backfillDays * DAY);
  });
});

describe("cleanSamples", () => {
  it("keeps Dexcom readings only, drops implausible values and repeats, sorts oldest first", () => {
    const out = cleanSamples([
      s("b", 140, 2000),
      s("a", 120, 1000),
      s("a", 120, 1000), // same sample twice
      s("typed", 95, 1500, "com.apple.Health", "Health"),
      s("junk", 2047, 1600),
      s("zero", 0, 1700),
      s("", 110, 1800), // no id: cannot be de-duplicated by the EMR
    ]);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("payload and batching", () => {
  it("sends the EMR's CGM shape, mg/dL whole numbers", () => {
    expect(toPayload(s("u1", 123.6, 5000))).toEqual({ id: "u1", type: "CGM", value: 124, unit: "mg/dL", ts: 5000 });
  });
  it("chunks a day of readings into batches", () => {
    const day = Array.from({ length: 288 }, (_, i) => i);
    expect(chunk(day, CGM_CONFIG.batchSize).map((c) => c.length)).toEqual([250, 38]);
  });
  it("remembers the newest reading the EMR accepted", () => {
    const batch = [toPayload(s("1", 100, 10)), toPayload(s("2", 100, 30)), toPayload(s("3", 100, 20))];
    expect(newestTs(batch, null)).toBe(30);
    expect(newestTs(batch, 50)).toBe(50);
    expect(newestTs([], 7)).toBe(7);
  });
});
