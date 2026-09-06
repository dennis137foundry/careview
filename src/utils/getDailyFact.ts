// src/utils/getDailyFact.ts
// Pregnancy-aligned daily fact selection.
//
// Replaces the old getDailyTip AsyncStorage rotation: the fact shown is a
// pure function of (EDD, today), so it never drifts when the app isn't
// opened, and every patient sees content matched to her week of pregnancy.
//
// Day-of-pregnancy math matches the EMR (PatientController):
//   LMP = EDD - 280 days, day of pregnancy = days since LMP + 1.

import { dayFacts, postpartumFacts } from "../constants/pregnancyFacts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DailyFact {
  fact: string;
  /** Day of pregnancy, floored at 1. Keeps counting past the EDD. */
  dayOfPregnancy: number;
  /** Week of pregnancy (1-based). Meaningless once isPostpartum. */
  week: number;
  /** 1–7 position within the week. Meaningless once isPostpartum. */
  dayOfWeek: number;
  /** True past 42 weeks — facts rotate from the postpartum pool. */
  isPostpartum: boolean;
}

/** Parse "YYYY-MM-DD" as a local-time date at midnight. Avoids the UTC
 *  shift that `new Date("YYYY-MM-DD")` applies, which would put patients
 *  west of UTC a day off around midnight. */
function parseLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  // JS Date rolls invalid components over (month 13 → January next year);
  // require an exact round-trip so "2026-13-45" is rejected, not shifted.
  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  return valid ? date : null;
}

/** Days from `from` (local midnight; defaults to today) until the given
 *  date. Negative when the date is in the past. */
function daysUntil(target: Date, from: Date = new Date()): number {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - day.getTime()) / MS_PER_DAY);
}

/**
 * Day of pregnancy for a given EDD ("YYYY-MM-DD") as of `asOf` (defaults to
 * today), floored at 1. Day 280 = the due date itself. Returns null for an
 * unparseable EDD.
 */
export function getDayOfPregnancy(edd: string, asOf?: Date): number | null {
  const eddDate = parseLocalDate(edd);
  if (!eddDate) return null;
  return Math.max(1, 280 - daysUntil(eddDate, asOf));
}

/**
 * Unfloored day of pregnancy as of a date; < 1 means before the pregnancy
 * started. Used by the wellness history to know where to stop paging back.
 */
export function getRawDayOfPregnancy(edd: string, asOf: Date): number | null {
  const eddDate = parseLocalDate(edd);
  if (!eddDate) return null;
  return 280 - daysUntil(eddDate, asOf);
}

/**
 * The fact to show for the given EDD on `asOf` (defaults to today). Returns
 * null only when the EDD string is unparseable — callers fall back to the
 * due-date prompt.
 */
export function getDailyFact(edd: string, asOf?: Date): DailyFact | null {
  const day = getDayOfPregnancy(edd, asOf);
  if (day === null) return null;

  if (day <= dayFacts.length) {
    return {
      fact: dayFacts[day - 1],
      dayOfPregnancy: day,
      week: Math.ceil(day / 7),
      dayOfWeek: ((day - 1) % 7) + 1,
      isPostpartum: false,
    };
  }

  // Past 42 weeks: baby has almost certainly arrived, but the app can't
  // know the delivery date. Rotate the postpartum pool daily, forever.
  const idx = (day - dayFacts.length - 1) % postpartumFacts.length;
  return {
    fact: postpartumFacts[idx],
    dayOfPregnancy: day,
    week: Math.ceil(day / 7),
    dayOfWeek: ((day - 1) % 7) + 1,
    isPostpartum: true,
  };
}
