/**
 * cgmLogic.ts — pure rules for Dexcom continuous-glucose (CGM) sync.
 *
 * Dexcom declined Trinity production API access (2026-09-30). Its app writes
 * every sensor reading to Apple Health (iPhone) / Health Connect (Android)
 * about 3 hours late; CareView reads them there and sends them to the EMR as
 * vitals_sync.php type "CGM" (stored as Dexcom glucose; one alert per day, a
 * Continuous Glucose card on the chart — see CgmReadings.php in the EMR).
 *
 * Nothing here touches a device or the network, so it is tested in __tests__.
 */

/** One glucose sample as read from the phone's health store. */
export interface CgmSample {
  /** Health-store sample id (HKSample UUID / Health Connect metadata.id) — the EMR de-duplicates on it. */
  id: string;
  /** mg/dL */
  value: number;
  /** epoch ms */
  ts: number;
  /** bundle id / package name of the app that wrote it */
  sourceId: string;
  sourceName?: string;
}

/** What vitals_sync.php expects for one CGM reading. */
export interface CgmPayload {
  id: string;
  type: "CGM";
  value: number;
  unit: "mg/dL";
  ts: number;
}

export const CGM_CONFIG = {
  /** First sync after connecting: how far back to read. Health Connect allows 30 days without the history permission. */
  backfillDays: 30,
  /**
   * Each sync re-reads this far before the newest reading already sent. Dexcom
   * shares readings late and sometimes out of order (a sensor that lost the
   * phone back-fills when it reconnects); the EMR drops resends by sample id.
   */
  overlapHours: 6,
  /** Readings per request. A day is ~288. */
  batchSize: 250,
  /** While the app is open. Readings reach the health store ~3 h late anyway. */
  foregroundIntervalMs: 15 * 60 * 1000,
  /** Plausible sensor range (Dexcom reports 40–400). Outside this is a corrupt sample. */
  minValue: 20,
  maxValue: 600,
};

/**
 * Only readings the Dexcom app wrote. A glucose value the patient typed into
 * Apple Health, or one from another app or meter, is not a CGM reading — and
 * meter readings already reach the EMR through the CareView meter flow.
 * Dexcom apps identify as com.dexcom.* (G6, G7, ONE, Stelo, …).
 */
export function isDexcomSource(sourceId?: string | null, sourceName?: string | null): boolean {
  const id = (sourceId ?? "").toLowerCase();
  const name = (sourceName ?? "").toLowerCase();
  return id.startsWith("com.dexcom") || name.includes("dexcom") || name.includes("stelo");
}

/** Start of the window to read: backfill on the first sync, else the overlap before the newest reading sent. */
export function syncWindowStart(lastSentTs: number | null, now: number): number {
  const floor = now - CGM_CONFIG.backfillDays * 24 * 3600 * 1000;
  if (lastSentTs === null || !Number.isFinite(lastSentTs)) {
    return floor;
  }
  return Math.max(floor, lastSentTs - CGM_CONFIG.overlapHours * 3600 * 1000);
}

/** Dexcom readings only, plausible, newest-last, one per sample id. */
export function cleanSamples(samples: CgmSample[]): CgmSample[] {
  const seen = new Set<string>();
  return samples
    .filter(
      (s) =>
        !!s.id &&
        isDexcomSource(s.sourceId, s.sourceName) &&
        Number.isFinite(s.value) &&
        s.value >= CGM_CONFIG.minValue &&
        s.value <= CGM_CONFIG.maxValue &&
        Number.isFinite(s.ts)
    )
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.ts - b.ts);
}

export function toPayload(s: CgmSample): CgmPayload {
  return { id: s.id, type: "CGM", value: Math.round(s.value), unit: "mg/dL", ts: s.ts };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** The newest reading time the EMR has accepted (inserted or already had). */
export function newestTs(batch: CgmPayload[], prev: number | null): number | null {
  return batch.reduce<number | null>((m, r) => (m === null || r.ts > m ? r.ts : m), prev);
}
