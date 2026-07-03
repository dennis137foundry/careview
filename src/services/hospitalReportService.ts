/**
 * hospitalReportService.ts
 *
 * Handles the patient-reported "I Went To The Hospital" event.
 *
 * The report is persisted to the durable `screening_responses` table (type
 * "hospital_visit_report") so it survives app restarts and offline periods,
 * then synced to the EMR's dedicated hospital_report.php endpoint. It reuses
 * the same JWT auth (authedFetch), demo-account gate, and unsynced queue that
 * vitals/screening use; syncAllPending() flushes it on the shared background
 * loop, so it inherits retry/backoff and online-resume for free.
 */

import {
  getUser,
  saveScreeningResponse,
  getUnsyncedScreeningResponses,
  markScreeningResponseSynced,
} from "./sqliteService";
import { authedFetch } from "./authToken";
import { isDemoAccount } from "./seedDemoData";

export const HOSPITAL_REPORT_TYPE = "hospital_visit_report" as const;

const HOSPITAL_REPORT_API_URL =
  "https://trinitycareview.com/api/careviewapp/hospital_report.php";

// RN's fetch has no default timeout; a stuck request would hang the sync loop.
const REQUEST_TIMEOUT_MS = 15000;

interface HospitalReportResponse {
  success: boolean;
  status?: "inserted" | "duplicate";
  id?: number;
  error?: string;
}

/**
 * POST to the hospital endpoint through the JWT wrapper with an abort-backed
 * timeout. patient_id is intentionally omitted — the server binds the row to
 * the authenticated patient from the Bearer token.
 */
async function postHospitalReport(body: {
  app_response_id: string;
  reported_at: number;
}): Promise<HospitalReportResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await authedFetch(HOSPITAL_REPORT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await res.json()) as HospitalReportResponse;

    // 201 (inserted) and 200 (duplicate) are both success. Anything else
    // without success:true is a failure the caller leaves queued for retry.
    if (!res.ok && res.status !== 200 && res.status !== 201) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Record a hospital visit. Persists locally first (throws on failure so the
 * caller can keep the modal open and let the patient retry), then kicks off a
 * background sync. The local row id doubles as app_response_id, so server-side
 * dedup makes retries idempotent.
 */
export function reportHospitalVisit(): string {
  const id = saveScreeningResponse(HOSPITAL_REPORT_TYPE, {});

  // Fire-and-forget — the UI must not block on the network. A failure here
  // just leaves the row queued in screening_responses; the shared background
  // sync (syncAllPending) will flush it on the next tick / when online.
  syncPendingHospitalReports().catch((err) => {
    console.error("[HospitalReport] Background sync error:", err);
  });

  return id;
}

/**
 * Send any unsynced hospital-visit reports to the EMR. Safe to call
 * repeatedly. Wired into syncAllPending so it shares the retry machinery.
 */
export async function syncPendingHospitalReports(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  const pending = () =>
    getUnsyncedScreeningResponses().filter(
      (r) => r.type === HOSPITAL_REPORT_TYPE
    );

  const user = await getUser();
  if (!user?.patientId) {
    console.warn("[HospitalReport] No user logged in, cannot sync");
    return { synced: 0, failed: 0, remaining: pending().length };
  }

  const rows = pending();

  // The demo / App-Reviewer account must never reach the EMR — mark reports
  // synced locally so the UI settles without leaking data into production.
  if (isDemoAccount(user.phone)) {
    rows.forEach((r) => markScreeningResponseSynced(r.id));
    return { synced: rows.length, failed: 0, remaining: 0 };
  }

  if (rows.length === 0) {
    return { synced: 0, failed: 0, remaining: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await postHospitalReport({
        app_response_id: row.id,
        reported_at: row.timestamp,
      });
      if (result.success) {
        markScreeningResponseSynced(row.id);
        synced++;
      } else {
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[HospitalReport] Sync failed for ${row.id}: ${message}`);
      failed++;
    }
  }

  console.log(
    `[HospitalReport] Sync complete: ${synced} synced, ${failed} failed`
  );

  return { synced, failed, remaining: pending().length };
}
