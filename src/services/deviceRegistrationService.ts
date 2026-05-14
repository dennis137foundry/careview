// src/services/deviceRegistrationService.ts
//
// Registers paired devices with the Trinity EMR inventory via
// device_register.php. The server:
//   1. Finds-or-creates an inventory_units row keyed by the MAC (stored
//      in the serial_number column — Trinity calls every physical
//      identifier a "Serial Number", MAC or not)
//   2. Assigns that unit to the patient (auto-reassigns from a prior
//      patient if needed, with a Returned + Dispensed transaction pair)
//   3. For XXL cuffs, creates a second inventory unit representing the
//      accessory and links it to the monitor via parent_unit_id
//
// Successful registration returns one or two unit_id values. The app
// stores them locally and includes them as unit_id in subsequent
// vitals_sync payloads so the EMR can attribute each reading to the
// exact physical device that produced it.

import type { CuffSize, DeviceSource } from "./sqliteService";
import { authedFetch } from "./authToken";

const REGISTER_URL =
  "https://trinitycareview.com/api/careviewapp/device_register.php";
const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisterPayload {
  patient_id: number;
  mac: string; // uppercase hex, separators stripped
  category: "BP" | "SCALE";
  cuff_size?: CuffSize; // required for BP, ignored for SCALE
  model: string; // e.g., "BP3L", "HS2S", "GATT_BP"
  name: string;
  friendly_name: string;
  source: DeviceSource;
}

export interface RegisterUnit {
  unit_id: number;
  equipment: string; // e.g., "BP Monitor Standard"
  role: "monitor" | "accessory" | "scale";
  parent_unit_id?: number;
  idempotent?: boolean;
}

export interface RegisterSuccessBody {
  success: true;
  units: RegisterUnit[];
}

export type RegisterResult =
  | { kind: "success"; data: RegisterSuccessBody }
  | { kind: "conflict"; message: string } // 409 — show user, abort local pairing
  | { kind: "retry"; message: string } // 5xx / network — sweep will retry
  | { kind: "fatal"; message: string }; // 401 / 422 — bail, won't succeed

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strip non-hex characters and uppercase. The server normalizes again
 * defensively, but sending clean input avoids edge cases.
 */
export function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

export async function registerDeviceWithEmr(
  payload: RegisterPayload
): Promise<RegisterResult> {
  try {
    const res = await fetchWithTimeout(REGISTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Body may not parse if server returned HTML (Apache error page,
    // maintenance mode). Treat that as a retryable network-style fault.
    const body = await res.json().catch(() => ({} as any));

    if (res.status === 200 && body?.success && Array.isArray(body.units)) {
      return { kind: "success", data: body as RegisterSuccessBody };
    }

    if (res.status === 409) {
      return {
        kind: "conflict",
        message: body?.error ?? "Device is not available for pairing.",
      };
    }

    if (res.status === 401 || res.status === 422) {
      return {
        kind: "fatal",
        message: body?.error ?? `HTTP ${res.status}`,
      };
    }

    return {
      kind: "retry",
      message: body?.error ?? `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return {
      kind: "retry",
      message: e?.message ?? "Network error",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out"));
    }, timeout);

    // authedFetch adds Authorization: Bearer and refreshes on 401.
    authedFetch(url, { ...options, signal: controller.signal })
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
