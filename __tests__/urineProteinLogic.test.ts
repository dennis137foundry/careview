import {
  buildReminderSchedule,
  computeUrineStatus,
  describeRelative,
  highestResultSince,
  isDuplicateEntry,
  isProteinAlert,
  shiftOutOfQuietHours,
  UNABLE_GRACE_MS,
  URINE_INTERVAL_MS,
} from "../src/services/urineProteinLogic";

const HOUR = 60 * 60 * 1000;

describe("computeUrineStatus", () => {
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);

  it("is owed and held when nothing was ever recorded", () => {
    const s = computeUrineStatus({
      lastResultAt: null,
      lastUnableAt: null,
      now,
      loginSession: false,
    });
    expect(s.owed).toBe(true);
    expect(s.holdActive).toBe(true);
    expect(s.dueAt).toBeNull();
  });

  it("never holds during the login session, even when owed", () => {
    const s = computeUrineStatus({
      lastResultAt: null,
      lastUnableAt: null,
      now,
      loginSession: true,
    });
    expect(s.owed).toBe(true);
    expect(s.holdActive).toBe(false);
  });

  it("is not owed inside 72 hours of the last result", () => {
    const s = computeUrineStatus({
      lastResultAt: now - 71 * HOUR,
      lastUnableAt: null,
      now,
      loginSession: false,
    });
    expect(s.owed).toBe(false);
    expect(s.holdActive).toBe(false);
    expect(s.dueAt).toBe(now - 71 * HOUR + URINE_INTERVAL_MS);
  });

  it("becomes owed and held at exactly 72 hours", () => {
    const s = computeUrineStatus({
      lastResultAt: now - URINE_INTERVAL_MS,
      lastUnableAt: null,
      now,
      loginSession: false,
    });
    expect(s.owed).toBe(true);
    expect(s.holdActive).toBe(true);
  });

  it("a can't-test report releases the hold for 24 hours but stays owed", () => {
    const unableAt = now - 2 * HOUR;
    const s = computeUrineStatus({
      lastResultAt: now - 100 * HOUR,
      lastUnableAt: unableAt,
      now,
      loginSession: false,
    });
    expect(s.owed).toBe(true);
    expect(s.holdActive).toBe(false);
    expect(s.graceUntil).toBe(unableAt + UNABLE_GRACE_MS);
  });

  it("the hold returns once the grace window ends", () => {
    const s = computeUrineStatus({
      lastResultAt: now - 100 * HOUR,
      lastUnableAt: now - 25 * HOUR,
      now,
      loginSession: false,
    });
    expect(s.holdActive).toBe(true);
    expect(s.graceUntil).toBeNull();
  });

  it("a can't-test report older than the last result is ignored", () => {
    const s = computeUrineStatus({
      lastResultAt: now - 1 * HOUR,
      lastUnableAt: now - 3 * HOUR,
      now,
      loginSession: false,
    });
    expect(s.owed).toBe(false);
    expect(s.graceUntil).toBeNull();
  });
});

describe("isDuplicateEntry", () => {
  const now = 1_000_000_000_000;
  it("flags a second entry within two minutes", () => {
    expect(isDuplicateEntry(now - 90 * 1000, now)).toBe(true);
  });
  it("does not flag after two minutes or with no prior entry", () => {
    expect(isDuplicateEntry(now - 2 * 60 * 1000, now)).toBe(false);
    expect(isDuplicateEntry(null, now)).toBe(false);
  });
});

describe("highestResultSince / isProteinAlert", () => {
  it("picks the worst reading in the window, not the newest", () => {
    const now = 1_000_000_000_000;
    const rows = [
      { timestamp: now - 10 * 60 * 1000, result: "Negative" },
      { timestamp: now - 3 * HOUR, result: "+2" },
      { timestamp: now - 30 * HOUR, result: "+4" }, // outside 24h
    ];
    expect(highestResultSince(rows, now - 24 * HOUR)).toBe("+2");
    expect(isProteinAlert("+2")).toBe(true);
    expect(isProteinAlert("+1")).toBe(false);
  });

  it("returns null when nothing is in the window", () => {
    expect(highestResultSince([], 0)).toBeNull();
  });
});

describe("reminder schedule", () => {
  it("shifts overnight reminders to 08:00 local", () => {
    const late = new Date(2026, 8, 5, 22, 30).getTime();
    const shifted = new Date(shiftOutOfQuietHours(late));
    expect(shifted.getDate()).toBe(6);
    expect(shifted.getHours()).toBe(8);

    const early = new Date(2026, 8, 5, 6, 15).getTime();
    const shiftedEarly = new Date(shiftOutOfQuietHours(early));
    expect(shiftedEarly.getDate()).toBe(5);
    expect(shiftedEarly.getHours()).toBe(8);

    const fine = new Date(2026, 8, 5, 14, 0).getTime();
    expect(shiftOutOfQuietHours(fine)).toBe(fine);
  });

  it("schedules the first reminder plus seven daily follow-ups", () => {
    const now = new Date(2026, 8, 5, 10, 0).getTime();
    const times = buildReminderSchedule({ firstAt: now + URINE_INTERVAL_MS, now });
    expect(times).toHaveLength(8);
    expect(times[0]).toBe(now + URINE_INTERVAL_MS);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("re-bases a series whose first reminder is already in the past", () => {
    const now = new Date(2026, 8, 5, 10, 0).getTime();
    const times = buildReminderSchedule({ firstAt: now - 5 * HOUR, now });
    expect(times.length).toBeGreaterThan(0);
    expect(times[0]).toBeGreaterThan(now);
  });
});

describe("describeRelative", () => {
  const now = new Date(2026, 8, 5, 12, 0).getTime();
  it("reads naturally", () => {
    expect(describeRelative(now - 20 * 1000, now)).toBe("just now");
    expect(describeRelative(now - 5 * 60 * 1000, now)).toBe("5 min ago");
    expect(describeRelative(now - 3 * HOUR, now)).toBe("3 hours ago");
    expect(describeRelative(now - 30 * HOUR, now)).toBe("yesterday");
    expect(describeRelative(now - 3 * 24 * HOUR, now)).toBe("3 days ago");
  });
});
