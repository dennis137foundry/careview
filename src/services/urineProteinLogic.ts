// src/services/urineProteinLogic.ts
//
// Pure rules for the urine protein check. No React Native or SQLite imports,
// so every rule here is unit-testable (see __tests__/urineProteinLogic.test.ts).
//
// The clinical contract, as agreed 2026-09-05:
//   - Patients may record a result whenever they want, as often as they want.
//   - Trinity requires at least one result every 72 hours. When that window
//     passes with nothing recorded, the dashboard is HELD until the patient
//     either records a result or reports that they cannot test right now.
//   - "Can't test" is a real report (synced to the EMR), not a snooze. It
//     releases the hold for 24 hours and does not reset the 72-hour clock.
//   - The session in which the patient logged in never shows the hold: the
//     phone has no local history right after login, so "owed" would be true
//     for everyone. From the next app open onward the normal rule applies.

export const URINE_INTERVAL_HOURS = 72;
export const URINE_INTERVAL_MS = URINE_INTERVAL_HOURS * 60 * 60 * 1000;

export const UNABLE_GRACE_HOURS = 24;
export const UNABLE_GRACE_MS = UNABLE_GRACE_HOURS * 60 * 60 * 1000;

/** Two entries closer together than this ask "record another?" first. */
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

/** Window used for the "highest result" summaries in the app. */
export const HIGHEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PROTEIN_RESULTS = [
  "Negative",
  "Trace",
  "+1",
  "+2",
  "+3",
  "+4",
] as const;
export type ProteinResult = (typeof PROTEIN_RESULTS)[number];

/** Levels the EMR flags as an alert (mirrors ALERT_URINE_LEVELS in screening_sync.php). */
export const ALERT_RESULTS: ReadonlySet<string> = new Set(["+2", "+3", "+4"]);

export const UNABLE_REASONS = [
  { code: "out_of_strips", label: "I'm out of test strips" },
  { code: "no_kit", label: "I don't have my kit with me" },
  { code: "other", label: "Another reason" },
] as const;
export type UnableReasonCode = (typeof UNABLE_REASONS)[number]["code"];

export function unableReasonLabel(code: unknown): string {
  const hit = UNABLE_REASONS.find((r) => r.code === code);
  return hit ? hit.label : "Couldn't test";
}

export function isProteinResult(value: unknown): value is ProteinResult {
  return typeof value === "string" && (PROTEIN_RESULTS as readonly string[]).includes(value);
}

/** Position on the dipstick scale; -1 for anything unrecognised. */
export function proteinRank(result: unknown): number {
  return isProteinResult(result) ? PROTEIN_RESULTS.indexOf(result) : -1;
}

export function isProteinAlert(result: unknown): boolean {
  return typeof result === "string" && ALERT_RESULTS.has(result);
}

export function highestResult(results: unknown[]): ProteinResult | null {
  let best: ProteinResult | null = null;
  let bestRank = -1;
  for (const r of results) {
    const rank = proteinRank(r);
    if (rank > bestRank) {
      bestRank = rank;
      best = r as ProteinResult;
    }
  }
  return best;
}

export interface TimedResult {
  timestamp: number;
  result: unknown;
}

/** Highest result recorded at or after `sinceMs`, newest rows first or not. */
export function highestResultSince(
  rows: TimedResult[],
  sinceMs: number
): ProteinResult | null {
  return highestResult(
    rows.filter((r) => r.timestamp >= sinceMs).map((r) => r.result)
  );
}

// ---------------------------------------------------------------------------
// Due / hold state
// ---------------------------------------------------------------------------

export interface UrineStatusInput {
  /** Timestamp (ms) of the most recent recorded RESULT on this phone, or null. */
  lastResultAt: number | null;
  /** Timestamp (ms) of the most recent "can't test" report, or null. */
  lastUnableAt: number | null;
  now: number;
  /** True only during the app session in which the patient logged in. */
  loginSession: boolean;
}

export interface UrineStatus {
  /** 72+ hours since the last result (or never recorded). Lights the bell. */
  owed: boolean;
  /** Owed, outside the login session, and not inside a can't-test grace window. */
  holdActive: boolean;
  /** End of the current can't-test grace window, if one is in effect. */
  graceUntil: number | null;
  /** When the next result becomes owed; null when never recorded. */
  dueAt: number | null;
}

export function computeUrineStatus(input: UrineStatusInput): UrineStatus {
  const { lastResultAt, lastUnableAt, now, loginSession } = input;

  const owed = lastResultAt === null || now - lastResultAt >= URINE_INTERVAL_MS;
  const dueAt = lastResultAt === null ? null : lastResultAt + URINE_INTERVAL_MS;

  // A can't-test report only counts if it is newer than the last real result
  // and still inside its 24-hour window.
  let graceUntil: number | null = null;
  if (
    lastUnableAt !== null &&
    (lastResultAt === null || lastUnableAt > lastResultAt) &&
    now - lastUnableAt < UNABLE_GRACE_MS
  ) {
    graceUntil = lastUnableAt + UNABLE_GRACE_MS;
  }

  const holdActive = owed && !loginSession && graceUntil === null;

  return { owed, holdActive, graceUntil, dueAt };
}

export function isDuplicateEntry(lastResultAt: number | null, now: number): boolean {
  return lastResultAt !== null && now - lastResultAt < DUPLICATE_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Reminder schedule (local notifications)
// ---------------------------------------------------------------------------

/** Mirrors the EMR's SMS quiet hours (system_settings: 21:00 → 08:00). */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Move a reminder that would fire overnight to 08:00 local time. */
export function shiftOutOfQuietHours(ms: number): number {
  const d = new Date(ms);
  const hour = d.getHours();
  if (hour >= QUIET_START_HOUR) {
    d.setDate(d.getDate() + 1);
    d.setHours(QUIET_END_HOUR, 0, 0, 0);
    return d.getTime();
  }
  if (hour < QUIET_END_HOUR) {
    d.setHours(QUIET_END_HOUR, 0, 0, 0);
    return d.getTime();
  }
  return ms;
}

export interface ReminderScheduleInput {
  /** When the first reminder is wanted (e.g. last result + 72h). */
  firstAt: number;
  now: number;
  /** Daily follow-ups after the first reminder. */
  followUps?: number;
  stepMs?: number;
}

/**
 * Build the list of reminder times to pre-schedule. The app cannot wake
 * itself, so the follow-ups are scheduled up front. If `firstAt` is already
 * in the past the series is re-based to the next step after `now` so an
 * overdue patient still gets a reminder tomorrow rather than nothing.
 */
export function buildReminderSchedule(input: ReminderScheduleInput): number[] {
  const { now } = input;
  const followUps = input.followUps ?? 7;
  const stepMs = input.stepMs ?? DAY_MS;

  let first = input.firstAt;
  while (first <= now) {
    first += stepMs;
  }

  const out: number[] = [];
  for (let i = 0; i <= followUps; i++) {
    const t = shiftOutOfQuietHours(first + i * stepMs);
    if (t > now && !out.includes(t)) {
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function describeRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}
