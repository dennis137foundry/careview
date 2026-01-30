// src/services/screeningSyncService.ts

import {
  getUnsyncedScreeningResponses,
  markScreeningResponseSynced
} from "./sqliteService";
import { store } from "../redux/store";

// API Configuration
const API_BASE_URL = "https://appapi.trinityhhs.com/api/careviewapp";
const API_KEY = "dc9a8e0f685349ab93c0e06f417ff7f8c13fbbac170b71270b55bd2ba7c3ba85";

// Sync state
type SyncStatus = "idle" | "syncing" | "error";

interface ScreeningSyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncAttempt: Date | null;
  lastSuccessfulSync: Date | null;
  lastError: string | null;
}

let syncState: ScreeningSyncState = {
  status: "idle",
  pendingCount: 0,
  lastSyncAttempt: null,
  lastSuccessfulSync: null,
  lastError: null,
};

// Listeners for state changes
type SyncStateListener = (state: ScreeningSyncState) => void;
const listeners: Set<SyncStateListener> = new Set();

function notifyListeners(): void {
  listeners.forEach((listener) => listener({ ...syncState }));
}

export function onScreeningSyncStateChange(
  listener: SyncStateListener
): () => void {
  listeners.add(listener);
  listener({ ...syncState });
  return () => listeners.delete(listener);
}

/**
 * Sync all unsynced screening responses to the EMR
 */
export async function syncScreeningResponses(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  if (syncState.status === "syncing") {
    console.log("[ScreeningSync] Already syncing, skipping...");
    return { synced: 0, failed: 0, remaining: syncState.pendingCount };
  }

  const unsyncedResponses = getUnsyncedScreeningResponses();

  if (unsyncedResponses.length === 0) {
    console.log("[ScreeningSync] No unsynced responses");
    return { synced: 0, failed: 0, remaining: 0 };
  }

  // Get patient ID from Redux store
  const state = store.getState();
  const patientId = state.user.patientId;

  if (!patientId) {
    console.error("[ScreeningSync] No patient ID available");
    return { synced: 0, failed: unsyncedResponses.length, remaining: unsyncedResponses.length };
  }

  syncState = {
    ...syncState,
    status: "syncing",
    pendingCount: unsyncedResponses.length,
    lastSyncAttempt: new Date(),
    lastError: null,
  };
  notifyListeners();

  console.log(`[ScreeningSync] Syncing ${unsyncedResponses.length} responses...`);

  // Filter out deferrals - we still mark them synced locally but don't send
  const toSync = unsyncedResponses.filter(
    (r) => r.type !== "urine_protein_deferred"
  );
  const deferrals = unsyncedResponses.filter(
    (r) => r.type === "urine_protein_deferred"
  );

  // Mark deferrals as synced locally (nothing to send to EMR)
  deferrals.forEach((d) => {
    markScreeningResponseSynced(d.id);
    console.log(`[ScreeningSync] Marked deferral as synced: ${d.id}`);
  });

  if (toSync.length === 0) {
    syncState = {
      ...syncState,
      status: "idle",
      pendingCount: 0,
      lastSuccessfulSync: new Date(),
    };
    notifyListeners();
    return { synced: deferrals.length, failed: 0, remaining: 0 };
  }

  // Format responses for API
  const formattedResponses = toSync.map((response) => ({
    id: response.id,
    type: response.type,
    timestamp: response.timestamp,
    data: response.data, // Already JSON string
  }));

  try {
    const response = await fetch(`${API_BASE_URL}/screening_sync.php`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify({
        patient_id: patientId,
        responses: formattedResponses,
      }),
    });

    const result = await response.json();
    console.log("[ScreeningSync] API Response:", result);

    if (!response.ok && response.status !== 207) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    // Mark successful syncs
    let syncedCount = deferrals.length;
    let failedCount = 0;

    // Process daily_health_check results
    if (result.results?.daily_health_check) {
      for (const r of result.results.daily_health_check) {
        if (r.status === "inserted" || r.status === "duplicate" || r.status === "skipped") {
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
        if (r.status === "inserted" || r.status === "duplicate" || r.status === "skipped") {
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

    const remaining = getUnsyncedScreeningResponses().length;

    syncState = {
      status: "idle",
      pendingCount: remaining,
      lastSyncAttempt: new Date(),
      lastSuccessfulSync: new Date(),
      lastError: failedCount > 0 ? `${failedCount} responses failed to sync` : null,
    };
    notifyListeners();

    console.log(`[ScreeningSync] Complete: ${syncedCount} synced, ${failedCount} failed, ${remaining} remaining`);

    return { synced: syncedCount, failed: failedCount, remaining };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[ScreeningSync] Error:", errorMessage);

    syncState = {
      ...syncState,
      status: "error",
      lastError: errorMessage,
    };
    notifyListeners();

    return {
      synced: deferrals.length,
      failed: toSync.length,
      remaining: getUnsyncedScreeningResponses().length,
    };
  }
}

/**
 * Get current sync state
 */
export function getScreeningSyncState(): ScreeningSyncState {
  return { ...syncState };
}

/**
 * Force sync all pending screening responses
 */
export async function forceScreeningSync(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  return syncScreeningResponses();
}