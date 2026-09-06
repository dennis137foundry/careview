// src/services/urineProteinSession.ts
//
// In-memory "login session" flag for the urine protein hold.
//
// Right after a login the phone has no local screening history, so the
// 72-hour rule would treat every patient as owed. The agreed behaviour is:
// never hold the home screen in the session in which the login happened;
// from the next app open onward the normal rule applies.
//
// "Next app open" means a cold start, or coming back after genuinely leaving
// the app. Android reports a brief `background` state for system dialogs the
// app itself raises (notification / Bluetooth / camera permission prompts),
// so a bare background→active hop cannot end the session — the very first
// device pairing would otherwise trip the hold. Instead, the session ends
// when the app has been away for at least AWAY_THRESHOLD_MS.
//
// Nothing is persisted on purpose — a cold start must clear it.

export const AWAY_THRESHOLD_MS = 60 * 1000;

let loginSession = false;
let backgroundedAt: number | null = null;

export function markLoginSession(): void {
  loginSession = true;
  backgroundedAt = null;
}

export function clearLoginSession(): void {
  loginSession = false;
  backgroundedAt = null;
}

/** AppState → "background". */
export function noteAppBackgrounded(now: number = Date.now()): void {
  if (loginSession && backgroundedAt === null) {
    backgroundedAt = now;
  }
}

/** AppState → "active". Ends the session if the app was away long enough. */
export function noteAppForegrounded(now: number = Date.now()): void {
  if (backgroundedAt !== null && now - backgroundedAt >= AWAY_THRESHOLD_MS) {
    loginSession = false;
  }
  backgroundedAt = null;
}

/**
 * True only while the login session is still in effect. Evaluates the away
 * threshold itself, so the answer is right no matter which AppState
 * listener (this module's caller or the dashboard's) runs first.
 */
export function isLoginSession(now: number = Date.now()): boolean {
  if (!loginSession) return false;
  if (backgroundedAt !== null && now - backgroundedAt >= AWAY_THRESHOLD_MS) {
    loginSession = false;
    backgroundedAt = null;
    return false;
  }
  return true;
}
