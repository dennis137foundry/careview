// src/services/profileRefreshService.ts
// Once-a-day profile check against the EMR.
//
// Login (verify_code.php) delivers the patient's EDD and BP thresholds
// exactly once. This service is the middle ground between that and
// constant polling: at most one authenticated call per 24h, made when the
// app launches or returns to the foreground, hitting the lightweight
// patient_profile.php endpoint. Picks up EDD revisions (dating ultrasound
// moves the due date) and threshold changes without a re-login.

import { getAppSetting, setAppSetting } from "./sqliteService";
import { authedFetch } from "./authToken";
import { isDemoAccount } from "./seedDemoData";

const PROFILE_URL =
  "https://trinitycareview.com/api/careviewapp/patient_profile.php";
const LAST_CHECK_KEY = "last_profile_check";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ProfileRefreshResult {
  /** "YYYY-MM-DD" or null when the EMR has no pregnancy row / EDD. */
  edd: string | null;
  bpThresholds: {
    systolicHigh: number;
    diastolicHigh: number;
  };
}

/**
 * Fetch the profile if the last successful check is 24h+ old.
 * Returns null when skipped (recent check, demo account) or on any
 * failure — callers just try again on the next launch/foreground.
 */
export async function checkDailyProfileRefresh(
  phone?: string
): Promise<ProfileRefreshResult | null> {
  try {
    if (phone && isDemoAccount(phone)) {
      return null; // Demo account has no real EMR row to refresh from
    }

    const last = getAppSetting(LAST_CHECK_KEY);
    if (last && Date.now() - parseInt(last, 10) < CHECK_INTERVAL_MS) {
      return null;
    }

    const res = await authedFetch(PROFILE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (!res.ok) {
      console.warn("[ProfileRefresh] Server returned", res.status);
      return null;
    }

    const data = await res.json();
    if (!data?.success) {
      return null;
    }

    // Only stamp the check time on success so a failed attempt retries
    // on the next launch instead of waiting out the 24h window.
    setAppSetting(LAST_CHECK_KEY, String(Date.now()));

    return {
      edd: data.edd ?? null,
      bpThresholds: {
        systolicHigh: data.bpThresholds?.systolicHigh ?? 140,
        diastolicHigh: data.bpThresholds?.diastolicHigh ?? 90,
      },
    };
  } catch (e) {
    console.warn("[ProfileRefresh] Failed:", e);
    return null;
  }
}
