// src/services/profileRefreshService.ts
// Profile check against the EMR: the due date and the high-reading thresholds.
//
// THE THRESHOLDS ARE THE EMR'S. It resolves, per number, the patient's own
// value → her provider's → the system default (VITAL_THRESHOLDS.MD in the
// EMR repo) and this call fetches the result from the lightweight
// patient_profile.php endpoint on EVERY cold start, EVERY return to the
// foreground, and whenever a capture screen opens — so a change made in the
// EMR reaches the phone before the next reading is judged. There is no
// interval gate (until app 2.4 this ran at most once per five minutes, so a
// changed threshold could go unnoticed for a while). The payload is a few
// hundred bytes. If the EMR cannot be reached the phone keeps the last values
// the EMR sent (stored with the user row); it never substitutes its own.
//
// It is also how the app learns, promptly, that the EMR has ended this
// patient's access: patient_profile.php answers 403 `app_login_disabled`
// once she is discharged, her verification phone is cleared or changed,
// or App Login is switched off, and authedFetch turns that into a sign-out
// (see authToken.ts). There is no push channel, so this foreground call is
// what makes "discharge signs the phone out" happen the next time the app
// is opened rather than whenever the next reading is taken.

import { authedFetch } from "./authToken";
import { isDemoAccount } from "./seedDemoData";
import { setEdd, setThresholds } from "../redux/userSlice";
import type { AppDispatch, RootState } from "../redux/store";
import { thresholdsFromServer, type VitalThresholds } from "../utils/thresholdLogic";

const PROFILE_URL =
  "https://trinitycareview.com/api/careviewapp/patient_profile.php";

export interface ProfileRefreshResult {
  /** "YYYY-MM-DD" or null when the EMR has no pregnancy row / EDD. */
  edd: string | null;
  thresholds: VitalThresholds;
}

/**
 * Fetch the profile. Returns null when skipped (demo account) or on any
 * failure — callers just try again on the next launch/foreground/capture.
 * A 403 `app_login_disabled` is handled inside authedFetch (tokens cleared,
 * logout dispatched) before this function sees the response.
 *
 * `current` is what the phone holds now; a threshold the response lacks
 * keeps that value rather than a default.
 */
export async function fetchProfile(
  current: VitalThresholds,
  phone?: string
): Promise<ProfileRefreshResult | null> {
  try {
    if (phone && isDemoAccount(phone)) {
      return null; // Demo account has no real EMR row to refresh from
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

    return {
      edd: data.edd ?? null,
      thresholds: thresholdsFromServer(data, current),
    };
  } catch (e) {
    console.warn("[ProfileRefresh] Failed:", e);
    return null;
  }
}

/**
 * Fetch and apply: EMR-sourced EDD always overwrites a patient-entered one;
 * the thresholds replace the stored ones (Redux + SQLite). Fire-and-forget —
 * never blocks the caller, never throws.
 */
export async function refreshProfile(
  dispatch: AppDispatch,
  getState: () => RootState
): Promise<void> {
  const { user } = getState();
  if (!user.isAuthenticated) return;

  const result = await fetchProfile(user.thresholds, user.phone);
  if (!result) return;

  if (result.edd) {
    dispatch(setEdd({ edd: result.edd, source: "emr" }));
  }
  dispatch(setThresholds(result.thresholds));
}
