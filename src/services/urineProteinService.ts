// src/services/urineProteinService.ts
//
// The one place that reads and writes urine protein screening rows. The
// dashboard tile, the hold, the bell and the History tab all go through
// getUrineProteinSnapshot(); the picker records through recordUrineProteinResult()
// and recordUrineProteinUnable(). Rules live in urineProteinLogic.ts.

import {
  getLastScreeningResponse,
  getScreeningResponsesInRange,
  saveScreeningResponse,
  type ScreeningResponse,
} from "./sqliteService";
import { syncPendingScreening } from "./vitalsSyncService";
import { isLoginSession } from "./urineProteinSession";
import {
  scheduleUnableFollowUp,
  scheduleUrineReminders,
} from "./urineReminderService";
import {
  computeUrineStatus,
  highestResultSince,
  HIGHEST_WINDOW_MS,
  isProteinResult,
  type ProteinResult,
  type UnableReasonCode,
  type UrineStatus,
} from "./urineProteinLogic";

export interface UrineSnapshot {
  lastResult: ProteinResult | null;
  lastResultAt: number | null;
  lastUnableAt: number | null;
  lastUnableReason: string | null;
  /** Highest result in the last 24 hours (null when none). */
  highestLast24h: ProteinResult | null;
  /** Results recorded since local midnight. */
  countToday: number;
  status: UrineStatus;
}

function parseData(row: ScreeningResponse | null): Record<string, unknown> {
  if (!row?.data) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

export function getUrineProteinSnapshot(now: number = Date.now()): UrineSnapshot {
  const lastResultRow = getLastScreeningResponse("urine_protein_result");
  const lastUnableRow = getLastScreeningResponse("urine_protein_unable");

  const lastResultData = parseData(lastResultRow);
  const lastUnableData = parseData(lastUnableRow);

  const lastResult = isProteinResult(lastResultData.result)
    ? lastResultData.result
    : null;
  const lastResultAt = lastResultRow ? lastResultRow.timestamp : null;
  const lastUnableAt = lastUnableRow ? lastUnableRow.timestamp : null;

  const dayRows = getScreeningResponsesInRange(
    "urine_protein_result",
    now - HIGHEST_WINDOW_MS,
    now
  ).map((r) => ({ timestamp: r.timestamp, result: parseData(r).result }));

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  return {
    lastResult,
    lastResultAt,
    lastUnableAt,
    lastUnableReason:
      typeof lastUnableData.reason === "string" ? lastUnableData.reason : null,
    highestLast24h: highestResultSince(dayRows, now - HIGHEST_WINDOW_MS),
    countToday: dayRows.filter((r) => r.timestamp >= midnight.getTime()).length,
    status: computeUrineStatus({
      lastResultAt,
      lastUnableAt,
      now,
      loginSession: isLoginSession(),
    }),
  };
}

/**
 * Persist a result. Throws if the local write fails so the caller can keep
 * the picker open. Sync and reminder scheduling are fire-and-forget.
 */
export function recordUrineProteinResult(result: ProteinResult): void {
  saveScreeningResponse("urine_protein_result", { result });
  const now = Date.now();
  syncPendingScreening().catch((err) => {
    console.error("[UrineProtein] Background sync error:", err);
  });
  scheduleUrineReminders(now);
}

/**
 * Persist a "can't test right now" report. Same failure contract as above.
 */
export function recordUrineProteinUnable(reason: UnableReasonCode): void {
  saveScreeningResponse("urine_protein_unable", { reason });
  const now = Date.now();
  syncPendingScreening().catch((err) => {
    console.error("[UrineProtein] Background sync error:", err);
  });
  scheduleUnableFollowUp(now);
}
