// src/services/authToken.ts
//
// JWT + refresh-token lifecycle for the CareView API.
//
// The app gets an access token (JWT) and a refresh token from
// verify_code.php after OTP login. The access token is sent as
// Authorization: Bearer on every authed request. When it expires the
// server returns 401; we exchange the refresh token via refresh_token.php
// for a new pair and retry. If refresh fails (revoked / expired / network),
// the caller must treat that as "session over, log in again".
//
// Tokens are persisted in SQLite (user.authToken, user.refreshToken) and
// also held in memory for fast synchronous access during the sync loop.
// wipeAllPatientData() clears them via the DELETE on user.

import { getUser, updateAuthTokens } from "./sqliteService";

const REFRESH_URL =
  "https://trinitycareview.com/api/careviewapp/refresh_token.php";
const REFRESH_TIMEOUT_MS = 10000;

// In-memory cache. Loaded from SQLite at app boot and whenever
// setAuthTokens() is called. Kept in sync with the DB row.
let cachedAccess: string | null = null;
let cachedRefresh: string | null = null;

// Callback fired exactly once per refresh-token death (401 from
// refresh_token.php). App.tsx registers a handler that toasts the user
// and dispatches logout, which routes back to AuthScreen via the gate
// in AppNavigator.
let onAuthExpired: (() => void) | null = null;
let authExpiredFired = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Called after a successful verify_code.php or refresh_token.php response. */
export function setAuthTokens(access: string, refresh: string): void {
  cachedAccess = access;
  cachedRefresh = refresh;
  try {
    updateAuthTokens(access, refresh);
  } catch (e) {
    // If we can't persist, the app will still work this session but
    // will force re-login on cold start. Log and continue.
    console.error("[authToken] Failed to persist tokens:", e);
  }
}

/** Called on forced logout / HIPAA wipe / refresh failure. */
export function clearAuthTokens(): void {
  cachedAccess = null;
  cachedRefresh = null;
  try {
    updateAuthTokens(null, null);
  } catch (e) {
    console.error("[authToken] Failed to clear tokens:", e);
  }
}

/**
 * Register the handler fired when the refresh token is rejected (401 from
 * refresh_token.php). Called once at app boot from App.tsx with a closure
 * that has access to the Redux store and Toast provider.
 */
export function setOnAuthExpired(cb: () => void): void {
  onAuthExpired = cb;
  authExpiredFired = false;
}

/** Reset the latch — call after a successful login so the next 401 can fire. */
export function resetAuthExpiredLatch(): void {
  authExpiredFired = false;
}

/** Hydrate in-memory cache from SQLite. Call at app boot. */
export async function loadAuthTokensFromStorage(): Promise<void> {
  const user = await getUser();
  cachedAccess = user?.authToken ?? null;
  cachedRefresh = user?.refreshToken ?? null;
}

/** Synchronous accessor for the current access token. */
export function getAccessToken(): string | null {
  return cachedAccess;
}

/**
 * authedFetch — drop-in fetch wrapper that adds Authorization: Bearer
 * and handles 401 by refreshing the token and retrying once.
 *
 * Rules:
 *   - If no access token is cached, the request goes out as-is. The
 *     server will reject protected patient-write endpoints.
 *   - On 401 AND a refresh token is available: try to refresh, retry
 *     once. If the retry also 401s, return the second response —
 *     caller should treat that as session expired and force re-login.
 *   - If the refresh call itself fails (revoked / expired / network),
 *     clear tokens so the next call doesn't spin. Return the original
 *     401 response so the caller's normal error path runs.
 */
export async function authedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const first = await fetch(url, withAuthHeader(options, cachedAccess));

  if (first.status !== 401 || !cachedRefresh) {
    return first;
  }

  // Token may have expired. Attempt refresh + retry exactly once.
  const refreshed = await tryRefresh();
  if (!refreshed) {
    return first; // Caller handles the 401 (session expired).
  }

  return fetch(url, withAuthHeader(options, cachedAccess));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function withAuthHeader(
  options: RequestInit,
  token: string | null
): RequestInit {
  if (!token) return options;
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return { ...options, headers };
}

/**
 * Exchange the current refresh token for a new pair. On success, updates
 * the cached + persisted tokens and returns true. On failure, clears
 * cached tokens and returns false.
 */
async function tryRefresh(): Promise<boolean> {
  if (!cachedRefresh) return false;

  try {
    const res = await fetchWithTimeout(
      REFRESH_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: cachedRefresh }),
      },
      REFRESH_TIMEOUT_MS
    );

    if (!res.ok) {
      // 401 from refresh = token revoked/expired. Clear everything and
      // fire the auth-expired callback exactly once so the app routes
      // back to AuthScreen. Multiple parallel authedFetch calls can each
      // hit this branch; latch prevents N toasts/N logouts.
      if (res.status === 401) {
        clearAuthTokens();
        if (onAuthExpired && !authExpiredFired) {
          authExpiredFired = true;
          try {
            onAuthExpired();
          } catch (e) {
            console.error("[authToken] onAuthExpired threw:", e);
          }
        }
      }
      return false;
    }

    const data = await res.json().catch(() => null);
    if (!data || !data.success || !data.token || !data.refreshToken) {
      return false;
    }

    setAuthTokens(data.token, data.refreshToken);
    return true;
  } catch (e) {
    // Network error — don't clear tokens; user may retry when back online.
    console.warn("[authToken] Refresh network error:", e);
    return false;
  }
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out"));
    }, timeout);

    fetch(url, { ...options, signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
