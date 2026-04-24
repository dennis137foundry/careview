/**
 * VitalsSyncService.ts
 *
 * Syncs vital sign readings and screening responses from local SQLite to Trinity EMR.
 * Integrates with existing sqliteService.ts
 *
 * Features:
 * - Immediate sync attempt on new reading
 * - Exponential backoff retry for failures
 * - Background sync of pending readings AND screening responses
 * - Network-aware (pauses when offline)
 * 
 * Updates:
 * - BP readings: heartRate sent as measurement_condition (e.g., "72 bpm")
 * - BG readings: meal timing sent as measurement_condition
 * - Screening responses: daily health checks and urine protein results
 */

import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import {
  getUser,
  getUnsyncedReadings,
  markReadingSynced,
  markReadingsSynced,
  getUnsyncedCount,
  getUnsyncedScreeningResponses,
  markScreeningResponseSynced,
  getDevice,
  getDevicesWithoutEmrUnitId,
  updateDeviceEmrUnits,
  SavedReading,
  ScreeningResponse,
} from "./sqliteService";
import { store } from "../redux/store";
import { setDeviceEmrUnits } from "../redux/deviceSlice";
import {
  registerDeviceWithEmr,
  normalizeMac,
} from "./deviceRegistrationService";
import { authedFetch } from "./authToken";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // API endpoints
  vitalsApiUrl: "https://trinitycareview.com/api/careviewapp/vitals_sync.php",
  screeningApiUrl: "https://trinitycareview.com/api/careviewapp/screening_sync.php",

  // API key - must match server
  apiKey: "dc9a8e0f685349ab93c0e06f417ff7f8c13fbbac170b71270b55bd2ba7c3ba85",

  // Retry settings (exponential backoff)
  retryDelays: [5000, 15000, 45000, 120000, 300000], // 5s, 15s, 45s, 2min, 5min
  maxRetries: 5,

  // Batch settings
  batchSize: 20,

  // Background sync interval (ms)
  backgroundSyncInterval: 60000, // 1 minute

  // Per-request timeout (ms). React Native's fetch has no default timeout —
  // without this, a stuck request blocks the entire sync loop.
  requestTimeout: 15000, // 15 seconds
};

// ============================================================================
// Types
// ============================================================================

interface SyncPayload {
  patient_id: number;
  vitals: VitalPayload[];
}

interface VitalPayload {
  id: string;
  type: "BP" | "SCALE";  // Remove "BG"
  value: number | null;
  value2?: number | null;
  heartRate?: number | null;
  unit: string;
  ts: number;
  recorded_date?: string;
  measurement_condition?: string | null;
  notes?: string | null;
  // EMR inventory unit id (inventory_units.id). Populated for readings
  // from devices that have been registered via device_register.php.
  // Omitted from the payload entirely (not sent as null) for devices
  // that haven't registered yet — the server treats the absence as
  // "legacy reading, store with patient_vitals.unit_id = NULL".
  unit_id?: number;
}

interface SyncResponse {
  success: boolean;
  summary: {
    total_received: number;
    inserted: number;
    duplicates_skipped: number;
    errors: number;
  };
  results: {
    inserted: Array<{ id: number; app_reading_id: string }>;
    duplicates: Array<{ app_reading_id: string }>;
    errors: Array<{ app_reading_id: string; error: string }>;
  };
  sync_timestamp: string;
}

interface ScreeningSyncPayload {
  patient_id: number;
  responses: ScreeningPayload[];
}

interface ScreeningPayload {
  id: string;
  type: string;
  timestamp: number;
  data: string; // JSON string
}

interface ScreeningSyncResponse {
  success: boolean;
  summary: {
    total_received: number;
    inserted: number;
    duplicates_skipped: number;
    skipped_no_alert: number;
    errors: number;
  };
  results: {
    daily_health_check: Array<{ status: string; app_response_id?: string }>;
    urine_protein: Array<{ status: string; app_response_id?: string }>;
    errors: Array<{ app_response_id?: string; error: string }>;
  };
  sync_timestamp: string;
}

type SyncStatus = "idle" | "syncing" | "offline" | "error";

interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  pendingScreeningCount: number;
  lastSyncAttempt: Date | null;
  lastSuccessfulSync: Date | null;
  lastError: string | null;
  retryCount: number;
}

// ============================================================================
// State
// ============================================================================

let syncState: SyncState = {
  status: "idle",
  pendingCount: 0,
  pendingScreeningCount: 0,
  lastSyncAttempt: null,
  lastSuccessfulSync: null,
  lastError: null,
  retryCount: 0,
};

let isOnline = true;
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
let backgroundSyncIntervalId: ReturnType<typeof setInterval> | null = null;
let stateListeners: Array<(state: SyncState) => void> = [];

// ============================================================================
// State Management
// ============================================================================

function updateState(updates: Partial<SyncState>): void {
  syncState = { ...syncState, ...updates };
  stateListeners.forEach((listener) => listener(syncState));
}

/**
 * Subscribe to sync state changes
 */
export function onSyncStateChange(
  listener: (state: SyncState) => void
): () => void {
  stateListeners.push(listener);
  // Immediately call with current state
  listener(syncState);
  // Return unsubscribe function
  return () => {
    stateListeners = stateListeners.filter((l) => l !== listener);
  };
}

/**
 * Get current sync state
 */
export function getSyncState(): SyncState {
  return { ...syncState };
}

// ============================================================================
// Network Monitoring
// ============================================================================

/**
 * Initialize network monitoring
 */
export function initNetworkMonitoring(): () => void {
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    const wasOffline = !isOnline;
    isOnline = state.isConnected ?? false;

    console.log(`[VitalsSync] Network: ${isOnline ? "online" : "offline"}`);

    if (isOnline && wasOffline) {
      // Just came online - try to sync pending readings
      updateState({ status: "idle" });
      syncAllPending();
    } else if (!isOnline) {
      updateState({ status: "offline" });
      cancelRetry();
    }
  });

  return unsubscribe;
}

// ============================================================================
// Network Helpers
// ============================================================================

/**
 * fetch() wrapped with an AbortController-backed timeout AND the JWT
 * auth wrapper. React Native's fetch has no default timeout, so a stuck
 * connection would otherwise hang the sync loop ~60s. The auth wrapper
 * adds Authorization: Bearer and handles 401 refresh transparently;
 * the legacy X-API-Key header stays in place during the transition so
 * an old server or rotated-JWT edge case still works.
 */
function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = CONFIG.requestTimeout
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out"));
    }, timeout);

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

// ============================================================================
// API Communication - Vitals
// ============================================================================

/**
 * Send readings to EMR API
 */
async function sendVitalsToApi(payload: SyncPayload): Promise<SyncResponse> {
  console.log(
    `[VitalsSync] Sending ${payload.vitals.length} readings to API...`
  );
  // Payload contains vitals values, patient_id, and device details — PHI.
  // Gated to dev builds only; production logcat should not see raw readings.
  if (__DEV__) {
    console.log(`[VitalsSync] Payload:`, JSON.stringify(payload, null, 2));
  }

  const response = await fetchWithTimeout(CONFIG.vitalsApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": CONFIG.apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data: SyncResponse = await response.json();

  if (!response.ok && response.status !== 207) {
    throw new Error((data as any).error || `HTTP ${response.status}`);
  }

  return data;
}

/**
 * Convert SavedReading to API payload format
 *
 * Key mapping:
 * - BP: heartRate -> measurement_condition (e.g., "72 bpm")
 * - BG: measurementCondition -> measurement_condition (meal timing)
 * - SCALE: no measurement_condition
 *
 * If the source device has been registered with the EMR inventory,
 * the payload includes unit_id so the server can attribute the
 * reading to that specific physical device. Otherwise unit_id is
 * omitted and the server stores patient_vitals.unit_id = NULL.
 */
function readingToPayload(reading: SavedReading): VitalPayload {
  let measurementCondition: string | null = null;

  if (reading.type === "BP" && reading.heartRate) {
    // For BP, send pulse/heart rate as measurement_condition
    measurementCondition = `${reading.heartRate} bpm`;
  }

  // Look up the source device so we can attach its EMR unit_id if
  // registered. Omitted from payload when null (do NOT send null —
  // server distinguishes "field absent" from "explicit null").
  let unitId: number | undefined;
  if (reading.deviceId) {
    const device = getDevice(reading.deviceId);
    if (device?.emrUnitId != null) {
      unitId = device.emrUnitId;
    }
  }

  const payload: VitalPayload = {
    id: reading.id,
    type: reading.type,
    value: reading.value ?? null,
    value2: reading.value2 ?? null,
    heartRate: reading.heartRate ?? null,
    unit: reading.unit,
    ts: reading.ts,
    measurement_condition: measurementCondition,
  };
  if (unitId !== undefined) {
    payload.unit_id = unitId;
  }
  return payload;
}

// ============================================================================
// API Communication - Screening
// ============================================================================

/**
 * Send screening responses to EMR API
 */
async function sendScreeningToApi(
  payload: ScreeningSyncPayload
): Promise<ScreeningSyncResponse> {
  console.log(
    `[ScreeningSync] Sending ${payload.responses.length} responses to API...`
  );
  // Payload contains screening answers (headache/visual/protein) and
  // patient_id — PHI. Gated to dev only.
  if (__DEV__) {
    console.log(`[ScreeningSync] Payload:`, JSON.stringify(payload, null, 2));
  }

  const response = await fetchWithTimeout(CONFIG.screeningApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": CONFIG.apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data: ScreeningSyncResponse = await response.json();

  if (!response.ok && response.status !== 207) {
    throw new Error((data as any).error || `HTTP ${response.status}`);
  }

  return data;
}

/**
 * Convert ScreeningResponse to API payload format
 */
function screeningToPayload(response: ScreeningResponse): ScreeningPayload {
  return {
    id: response.id,
    type: response.type,
    timestamp: response.timestamp,
    data: response.data, // Already JSON string
  };
}

// ============================================================================
// Sync Operations - Vitals
// ============================================================================

/**
 * Sync a single reading immediately after capture
 * Returns true if synced successfully, false if queued for retry
 */
export async function syncReading(reading: SavedReading): Promise<boolean> {
  // Get patient ID
  const user = await getUser();
  if (!user?.patientId) {
    console.warn("[VitalsSync] No user logged in, cannot sync");
    return false;
  }

  if (!isOnline) {
    console.log("[VitalsSync] Offline, reading queued for later sync");
    updatePendingCounts();
    scheduleRetry();
    return false;
  }

  updateState({ status: "syncing", lastSyncAttempt: new Date() });

  try {
    const payload: SyncPayload = {
      patient_id: parseInt(user.patientId, 10),
      vitals: [readingToPayload(reading)],
    };

    const result = await sendVitalsToApi(payload);

    if (result.summary.inserted > 0 || result.summary.duplicates_skipped > 0) {
      // Success - mark as synced
      markReadingSynced(reading.id);
      updateState({
        status: "idle",
        lastSuccessfulSync: new Date(),
        lastError: null,
        retryCount: 0,
      });
      updatePendingCounts();
      console.log(`[VitalsSync] Reading ${reading.id} synced`);
      return true;
    }

    if (result.summary.errors > 0) {
      throw new Error(result.results.errors[0]?.error || "Unknown error");
    }

    // Unexpected response shape: server returned 2xx/207 but summary shows
    // 0 inserted, 0 duplicates, and 0 errors. Without this throw the reading
    // would stay synced=0 forever with no retry scheduled — it'd sit pending
    // until the next background tick and then loop silently. Raising here
    // routes through the catch below, which schedules exponential backoff.
    throw new Error(
      "Unexpected API response: 0 inserted, 0 duplicates, 0 errors"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[VitalsSync] Sync failed: ${message}`);
    updateState({
      status: "error",
      lastError: message,
    });
    scheduleRetry();
    return false;
  }
}

/**
 * Sync all pending (unsynced) vitals readings
 */
export async function syncPendingReadings(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  if (!isOnline) {
    console.log("[VitalsSync] Offline, skipping vitals sync");
    return { synced: 0, failed: 0, remaining: getUnsyncedCount() };
  }

  const user = await getUser();
  if (!user?.patientId) {
    console.warn("[VitalsSync] No user logged in, cannot sync");
    return { synced: 0, failed: 0, remaining: getUnsyncedCount() };
  }

  const unsynced = getUnsyncedReadings();
  if (unsynced.length === 0) {
    console.log("[VitalsSync] No pending vitals to sync");
    return { synced: 0, failed: 0, remaining: 0 };
  }

  console.log(`[VitalsSync] Syncing ${unsynced.length} pending vitals...`);

  let totalSynced = 0;
  let totalFailed = 0;

  // Process in batches
  for (let i = 0; i < unsynced.length; i += CONFIG.batchSize) {
    const batch = unsynced.slice(i, i + CONFIG.batchSize);

    try {
      const payload: SyncPayload = {
        patient_id: parseInt(user.patientId, 10),
        vitals: batch.map(readingToPayload),
      };

      const result = await sendVitalsToApi(payload);

      // Collect successfully synced IDs
      const syncedIds: string[] = [];

      // Inserted readings
      result.results.inserted.forEach((item) => {
        if (item.app_reading_id) {
          syncedIds.push(item.app_reading_id);
        }
      });

      // Duplicates are also considered "synced" (already in EMR)
      result.results.duplicates.forEach((item) => {
        if (item.app_reading_id) {
          syncedIds.push(item.app_reading_id);
        }
      });

      if (syncedIds.length > 0) {
        markReadingsSynced(syncedIds);
        totalSynced += syncedIds.length;
      }

      totalFailed += result.summary.errors;

      // Log any errors
      result.results.errors.forEach((err) => {
        console.warn(
          `[VitalsSync] Error for ${err.app_reading_id}: ${err.error}`
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[VitalsSync] Batch sync failed: ${message}`);
      totalFailed += batch.length;
    }

    // Small delay between batches to avoid overwhelming the server
    if (i + CONFIG.batchSize < unsynced.length) {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
    }
  }

  const remaining = getUnsyncedCount();

  console.log(
    `[VitalsSync] Vitals sync complete: ${totalSynced} synced, ${totalFailed} failed, ${remaining} remaining`
  );

  return { synced: totalSynced, failed: totalFailed, remaining };
}

// ============================================================================
// Sync Operations - Screening
// ============================================================================

/**
 * Sync all pending screening responses
 */
export async function syncPendingScreening(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  if (!isOnline) {
    console.log("[ScreeningSync] Offline, skipping screening sync");
    return {
      synced: 0,
      failed: 0,
      remaining: getUnsyncedScreeningResponses().length,
    };
  }

  // Get patient ID from Redux store
  const state = store.getState();
  const patientId = state.user.patientId;

  if (!patientId) {
    console.warn("[ScreeningSync] No patient ID available");
    const remaining = getUnsyncedScreeningResponses().length;
    return { synced: 0, failed: remaining, remaining };
  }

  const unsyncedResponses = getUnsyncedScreeningResponses();

  if (unsyncedResponses.length === 0) {
    console.log("[ScreeningSync] No pending screening responses");
    return { synced: 0, failed: 0, remaining: 0 };
  }

  console.log(
    `[ScreeningSync] Syncing ${unsyncedResponses.length} screening responses...`
  );

  // Filter out deferrals - we still mark them synced locally but don't send
  const toSync = unsyncedResponses.filter(
    (r) => r.type !== "urine_protein_deferred"
  );
  const deferrals = unsyncedResponses.filter(
    (r) => r.type === "urine_protein_deferred"
  );

  // Mark deferrals as synced locally (nothing to send to EMR)
  let syncedCount = 0;
  deferrals.forEach((d) => {
    markScreeningResponseSynced(d.id);
    syncedCount++;
    console.log(`[ScreeningSync] Marked deferral as synced: ${d.id}`);
  });

  if (toSync.length === 0) {
    return {
      synced: syncedCount,
      failed: 0,
      remaining: getUnsyncedScreeningResponses().length,
    };
  }

  // Format responses for API
  const formattedResponses = toSync.map(screeningToPayload);

  let failedCount = 0;

  try {
    const payload: ScreeningSyncPayload = {
      patient_id: parseInt(patientId, 10),
      responses: formattedResponses,
    };

    const result = await sendScreeningToApi(payload);

    // Process daily_health_check results
    if (result.results?.daily_health_check) {
      for (const r of result.results.daily_health_check) {
        if (
          r.status === "inserted" ||
          r.status === "duplicate" ||
          r.status === "skipped"
        ) {
          if (r.app_response_id) {
            markScreeningResponseSynced(r.app_response_id);
            syncedCount++;
          }
        } else {
          failedCount++;
        }
      }
    }

    // Process urine_protein results
    if (result.results?.urine_protein) {
      for (const r of result.results.urine_protein) {
        if (
          r.status === "inserted" ||
          r.status === "duplicate" ||
          r.status === "skipped"
        ) {
          if (r.app_response_id) {
            markScreeningResponseSynced(r.app_response_id);
            syncedCount++;
          }
        } else {
          failedCount++;
        }
      }
    }

    // Count errors
    failedCount += result.results?.errors?.length || 0;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[ScreeningSync] Error:", errorMessage);
    failedCount = toSync.length;
  }

  const remaining = getUnsyncedScreeningResponses().length;

  console.log(
    `[ScreeningSync] Complete: ${syncedCount} synced, ${failedCount} failed, ${remaining} remaining`
  );

  return { synced: syncedCount, failed: failedCount, remaining };
}

// ============================================================================
// Combined Sync Operations
// ============================================================================

/**
 * Retry any device-registration calls that didn't complete on initial pair.
 * A device is considered "pending registration" if its row exists in SQLite
 * but emrUnitId is still NULL. That happens when device_register.php was
 * offline/timed-out/5xx when the nurse added the device. This sweep re-
 * attempts registration on each background tick; once it succeeds, the
 * unit_id flows into subsequent vitals_sync payloads automatically.
 *
 * 409 / 422 / 401 responses are considered terminal here — retrying won't
 * help until a nurse/admin intervenes, so we log and move on.
 */
export async function syncPendingDeviceRegistrations(): Promise<void> {
  if (!isOnline) return;

  const user = await getUser();
  if (!user?.patientId) return;

  const pending = getDevicesWithoutEmrUnitId();
  if (pending.length === 0) return;

  console.log(
    `[DeviceRegister] Retrying ${pending.length} pending registration(s)...`
  );

  for (const device of pending) {
    const category = device.type; // "BP" | "SCALE"
    const result = await registerDeviceWithEmr({
      patient_id: parseInt(user.patientId, 10),
      mac: normalizeMac(device.mac),
      category,
      cuff_size:
        category === "BP"
          ? (device.cuffSize as "STANDARD" | "LARGE" | "XXL" | undefined) ??
            "STANDARD"
          : undefined,
      model: device.model ?? device.type,
      name: device.name,
      friendly_name: device.friendlyName ?? device.name,
      source: device.source ?? "iHealthSDK",
    });

    if (result.kind === "success") {
      const monitor = result.data.units.find((u) => u.role !== "accessory");
      const accessory = result.data.units.find((u) => u.role === "accessory");
      if (monitor) {
        updateDeviceEmrUnits(
          device.id,
          monitor.unit_id,
          accessory?.unit_id ?? null
        );
        store.dispatch(
          setDeviceEmrUnits({
            deviceId: device.id,
            emrUnitId: monitor.unit_id,
            emrAccessoryUnitId: accessory?.unit_id ?? null,
          })
        );
      }
    } else if (result.kind === "conflict" || result.kind === "fatal") {
      // Won't succeed on retry. Leave emrUnitId null; readings still sync
      // without unit_id. User/admin must resolve via EMR admin UI.
      console.warn(
        `[DeviceRegister] Giving up on ${device.id}: ${result.kind} — ${result.message}`
      );
    }
    // "retry" kind: silently leave for the next sweep.
  }
}

/**
 * Sync all pending data (vitals + screening)
 */
export async function syncAllPending(): Promise<{
  vitals: { synced: number; failed: number; remaining: number };
  screening: { synced: number; failed: number; remaining: number };
}> {
  if (!isOnline) {
    console.log("[Sync] Offline, skipping all sync");
    return {
      vitals: { synced: 0, failed: 0, remaining: getUnsyncedCount() },
      screening: {
        synced: 0,
        failed: 0,
        remaining: getUnsyncedScreeningResponses().length,
      },
    };
  }

  updateState({ status: "syncing", lastSyncAttempt: new Date() });

  // Retry any device registrations that didn't complete on initial pair
  // (offline, 5xx, etc.). Runs before vitals so readings have a chance to
  // pick up unit_id on this same sweep.
  await syncPendingDeviceRegistrations();

  // Sync vitals first
  const vitalsResult = await syncPendingReadings();

  // Then sync screening responses
  const screeningResult = await syncPendingScreening();

  // Update state based on combined results
  const totalRemaining = vitalsResult.remaining + screeningResult.remaining;
  const anySuccess = vitalsResult.synced > 0 || screeningResult.synced > 0;
  const anyFailed = vitalsResult.failed > 0 || screeningResult.failed > 0;

  updateState({
    status: totalRemaining > 0 ? "error" : "idle",
    lastSuccessfulSync: anySuccess ? new Date() : syncState.lastSuccessfulSync,
    lastError: anyFailed
      ? `${vitalsResult.failed + screeningResult.failed} items failed to sync`
      : null,
    retryCount: totalRemaining > 0 ? syncState.retryCount : 0,
  });

  updatePendingCounts();

  // Schedule retry if there are still pending items
  if (totalRemaining > 0) {
    scheduleRetry();
  }

  return {
    vitals: vitalsResult,
    screening: screeningResult,
  };
}

// ============================================================================
// Retry Logic
// ============================================================================

function cancelRetry(): void {
  if (retryTimeoutId !== null) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
}

function scheduleRetry(): void {
  cancelRetry();

  if (!isOnline) {
    console.log("[Sync] Offline, will retry when online");
    return;
  }

  const retryIndex = Math.min(
    syncState.retryCount,
    CONFIG.retryDelays.length - 1
  );
  const delay = CONFIG.retryDelays[retryIndex];

  console.log(
    `[Sync] Scheduling retry in ${delay / 1000}s (attempt ${syncState.retryCount + 1})`
  );

  updateState({ retryCount: syncState.retryCount + 1 });

  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    syncAllPending();
  }, delay);
}

// ============================================================================
// Background Sync
// ============================================================================

/**
 * Start background sync timer
 */
export function startBackgroundSync(): void {
  if (backgroundSyncIntervalId !== null) {
    return; // Already running
  }

  console.log("[Sync] Starting background sync");

  backgroundSyncIntervalId = setInterval(() => {
    if (isOnline && syncState.status === "idle") {
      const pendingVitals = getUnsyncedCount();
      const pendingScreening = getUnsyncedScreeningResponses().length;
      const totalPending = pendingVitals + pendingScreening;

      if (totalPending > 0) {
        console.log(
          `[Sync] Background sync: ${pendingVitals} vitals, ${pendingScreening} screening responses pending`
        );
        syncAllPending();
      }
    }
  }, CONFIG.backgroundSyncInterval);
}

/**
 * Stop background sync timer
 */
export function stopBackgroundSync(): void {
  if (backgroundSyncIntervalId !== null) {
    clearInterval(backgroundSyncIntervalId);
    backgroundSyncIntervalId = null;
    console.log("[Sync] Background sync stopped");
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function updatePendingCounts(): void {
  const vitalsCount = getUnsyncedCount();
  const screeningCount = getUnsyncedScreeningResponses().length;

  if (
    vitalsCount !== syncState.pendingCount ||
    screeningCount !== syncState.pendingScreeningCount
  ) {
    updateState({
      pendingCount: vitalsCount,
      pendingScreeningCount: screeningCount,
    });
  }
}

/**
 * Force refresh of pending counts (call after saving a reading or response)
 */
export function refreshPendingCount(): {
  vitals: number;
  screening: number;
  total: number;
} {
  const vitalsCount = getUnsyncedCount();
  const screeningCount = getUnsyncedScreeningResponses().length;

  updateState({
    pendingCount: vitalsCount,
    pendingScreeningCount: screeningCount,
  });

  return {
    vitals: vitalsCount,
    screening: screeningCount,
    total: vitalsCount + screeningCount,
  };
}

/**
 * Check if we have any pending data
 */
export function hasPendingData(): boolean {
  return getUnsyncedCount() > 0 || getUnsyncedScreeningResponses().length > 0;
}

/**
 * Legacy alias for backwards compatibility
 */
export function hasPendingReadings(): boolean {
  return getUnsyncedCount() > 0;
}

/**
 * Manual trigger to sync all pending data
 */
export async function forceSyncAll(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  // Reset retry count for manual sync
  updateState({ retryCount: 0 });

  const result = await syncAllPending();

  // Return combined totals for backwards compatibility
  return {
    synced: result.vitals.synced + result.screening.synced,
    failed: result.vitals.failed + result.screening.failed,
    remaining: result.vitals.remaining + result.screening.remaining,
  };
}

// ============================================================================
// Initialize
// ============================================================================

/**
 * Initialize the sync service
 * Call this once at app startup (e.g., in App.tsx)
 */
export function initVitalsSync(): () => void {
  console.log("[Sync] Initializing...");

  // Update pending counts
  updatePendingCounts();

  // Start network monitoring
  const unsubscribeNetwork = initNetworkMonitoring();

  // Start background sync
  startBackgroundSync();

  // Initial sync attempt
  setTimeout(() => {
    if (isOnline && hasPendingData()) {
      syncAllPending();
    }
  }, 2000);

  // Return cleanup function
  return () => {
    unsubscribeNetwork();
    stopBackgroundSync();
    cancelRetry();
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  initVitalsSync,
  syncReading,
  syncPendingReadings,
  syncPendingScreening,
  syncAllPending,
  forceSyncAll,
  getSyncState,
  onSyncStateChange,
  hasPendingReadings,
  hasPendingData,
  refreshPendingCount,
  startBackgroundSync,
  stopBackgroundSync,
};