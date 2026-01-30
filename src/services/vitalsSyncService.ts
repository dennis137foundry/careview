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
  SavedReading,
  ScreeningResponse,
} from "./sqliteService";
import { store } from "../redux/store";

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
// API Communication - Vitals
// ============================================================================

/**
 * Send readings to EMR API
 */
async function sendVitalsToApi(payload: SyncPayload): Promise<SyncResponse> {
  console.log(
    `[VitalsSync] Sending ${payload.vitals.length} readings to API...`
  );
  console.log(`[VitalsSync] Payload:`, JSON.stringify(payload, null, 2));

  const response = await fetch(CONFIG.vitalsApiUrl, {
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
 */
function readingToPayload(reading: SavedReading): VitalPayload {
  let measurementCondition: string | null = null;

  if (reading.type === "BP" && reading.heartRate) {
    // For BP, send pulse/heart rate as measurement_condition
    measurementCondition = `${reading.heartRate} bpm`;
  }

  return {
    id: reading.id,
    type: reading.type,
    value: reading.value ?? null,
    value2: reading.value2 ?? null,
    heartRate: reading.heartRate ?? null,
    unit: reading.unit,
    ts: reading.ts,
    measurement_condition: measurementCondition,
  };
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
  console.log(`[ScreeningSync] Payload:`, JSON.stringify(payload, null, 2));

  const response = await fetch(CONFIG.screeningApiUrl, {
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
      console.log(`[VitalsSync] ✅ Reading ${reading.id} synced`);
      return true;
    }

    if (result.summary.errors > 0) {
      throw new Error(result.results.errors[0]?.error || "Unknown error");
    }

    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[VitalsSync] ❌ Sync failed: ${message}`);
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