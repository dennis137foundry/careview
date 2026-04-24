// src/services/authService.ts
import { Alert } from "react-native";
import { saveUser, getUser, LocalUser, wipeAllPatientData } from "./sqliteService";
import { isDemoAccount, seedDemoData } from "./seedDemoData";
import { setAuthTokens, clearAuthTokens } from "./authToken";

const API_BASE = "https://trinityemr.com/api/careviewapp";
const REQUEST_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1500; // 1.5 seconds between retries

// ============================================================================
// Network Helpers
// ============================================================================

/** Fetch with a timeout — React Native's fetch has no default timeout */
function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT
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

/** Wait for a given number of milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fetch call silently up to MAX_RETRIES times.
 * Only throws after all attempts are exhausted.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);
      return response;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Auth] Attempt ${attempt}/${retries} failed:`, error.message);

      if (attempt < retries) {
        await wait(RETRY_DELAY);
      }
    }
  }

  throw lastError || new Error("Network request failed");
}

/** Check if an error is a network/connectivity issue (not a server response) */
function isNetworkError(e: any): boolean {
  const msg = e?.message?.toLowerCase() || "";
  return (
    msg.includes("network request failed") ||
    msg.includes("request timed out") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("aborted")
  );
}

// ============================================================================
// Auth Service
// ============================================================================

const authService = {
  /**
   * Send verification code via SMS
   * Retries silently up to 3 times before surfacing an error.
   */
  async sendCode(phone: string): Promise<boolean> {
    try {
      // Phone number is PHI — dev builds only.
      if (__DEV__) {
        console.log("[Auth] Sending code to:", phone);
      }

      const response = await fetchWithRetry(`${API_BASE}/send_code.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const data = await response.json();
      // Response may echo patientId — dev builds only.
      if (__DEV__) {
        console.log("[Auth] send_code response:", data);
      }

      if (data.success) {
        return true;
      }

      if (data.error === "not_found") {
        throw new Error("Phone number not registered. Please contact your provider.");
      }
      if (data.error === "sms_failed") {
        throw new Error("Failed to send SMS. Please try again.");
      }

      throw new Error(data.error || "Failed to send code");
    } catch (e: any) {
      console.error("[Auth] sendCode error:", e);

      if (isNetworkError(e)) {
        throw new Error(
          "Unable to reach the server. Please check your internet connection and try again."
        );
      }

      throw e;
    }
  },

  /**
   * Verify the 6-digit code
   * Retries silently up to 3 times before surfacing an error.
   */
  async verifyCode(phone: string, code: string): Promise<LocalUser | null> {
    try {
      // Phone is PHI — dev builds only.
      if (__DEV__) {
        console.log("[Auth] Verifying code for:", phone);
      }

      const response = await fetchWithRetry(`${API_BASE}/verify_code.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });

      const data = await response.json();
      // Response contains full patient + provider + thresholds — PHI.
      // Dev builds only.
      if (__DEV__) {
        console.log("[Auth] verify_code response:", data);
      }

      if (!data.success) {
        if (data.error === "invalid_or_expired_code") {
          throw new Error("Invalid or expired code. Please try again.");
        }
        if (data.error === "patient_not_found") {
          throw new Error("Patient record not found.");
        }
        throw new Error(data.error || "Verification failed");
      }

      // Extract BP thresholds from response (with defaults)
      const bpThresholds = data.bpThresholds || {};
      const systolicHigh = bpThresholds.systolicHigh ?? 140;
      const diastolicHigh = bpThresholds.diastolicHigh ?? 90;

      // Per-patient thresholds — PHI. Dev builds only.
      if (__DEV__) {
        console.log("[Auth] BP Thresholds from server:", { systolicHigh, diastolicHigh });
      }

      // Build LocalUser from response. JWT + refresh token come from the
      // server's auth response and get persisted alongside the rest of the
      // user row so they survive app restarts.
      const user: LocalUser = {
        patientId: String(data.patient.patientId),
        firstName: data.patient.firstName || "",
        lastName: data.patient.lastName || "",
        phone: data.patient.phone || phone,
        providerFirstName: data.provider?.firstName || "",
        providerLastName: data.provider?.lastName || "",
        providerPracticeName: data.provider?.practiceName || "",
        systolicHigh,
        diastolicHigh,
        authToken: data.token ?? null,
        refreshToken: data.refreshToken ?? null,
      };

      // ---------------------------------------------------------------
      // HIPAA safeguard: if a different patient was previously signed in,
      // wipe all local data before proceeding. Same patient keeps data.
      //
      // Both wipe and save can throw. We must NOT advance to the Main
      // navigator if either fails — a half-wiped DB with the old patient's
      // readings and the new patient's user row is exactly the HIPAA
      // leak the safeguard exists to prevent.
      // ---------------------------------------------------------------
      try {
        const previousUser = await getUser();
        if (previousUser && previousUser.patientId !== user.patientId) {
          // Patient IDs in this log — dev only.
          if (__DEV__) {
            console.log(
              `[Auth] Different patient detected (was ${previousUser.patientId}, now ${user.patientId}) — wiping local data`
            );
          }
          wipeAllPatientData();
          // Clear cached in-memory tokens too so no stale Bearer header
          // fires between the wipe and the new saveUser below.
          clearAuthTokens();
        }
        saveUser(user);
        // Hydrate the in-memory token cache from the just-issued pair.
        if (user.authToken && user.refreshToken) {
          setAuthTokens(user.authToken, user.refreshToken);
        }
        // Patient ID — dev only.
        if (__DEV__) {
          console.log("[Auth] User saved to SQLite:", user.patientId);
        }
      } catch (dbError: any) {
        console.error("[Auth] Failed to persist user or wipe prior data:", dbError);
        throw new Error(
          "Unable to complete sign-in due to a local storage error. Please try again, and contact support if the problem persists."
        );
      }

      // Demo account: prompt user to seed sample data
      if (isDemoAccount(phone)) {
        console.log("[Auth] Demo account detected — prompting for seed...");
        Alert.alert(
          "Demo Account Detected",
          "Would you like to seed the app with sample data?",
          [
            {
              text: "No",
              style: "cancel",
              onPress: () => {
                console.log("[Auth] Demo seed declined by user");
              },
            },
            {
              text: "Yes",
              onPress: () => {
                console.log("[Auth] Seeding demo data...");
                seedDemoData();
                console.log("[Auth] Demo data seeding complete");
              },
            },
          ],
        );
      }

      return user;
    } catch (e: any) {
      console.error("[Auth] verifyCode error:", e);

      if (isNetworkError(e)) {
        throw new Error(
          "Unable to reach the server. Please check your internet connection and try again."
        );
      }

      throw e;
    }
  },
};

export default authService;