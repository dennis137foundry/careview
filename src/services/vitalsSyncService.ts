/**
 * VitalsSyncService.ts
 *
 * Syncs vital sign readings from local SQLite to Trinity EMR.
 * Integrates with existing sqliteService.ts
 *
 * Features:
 * - Immediate sync attempt on new reading
 * - Exponential backoff retry for failures
 * - Background sync of pending readings
 * - Network-aware (pauses when offline)
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  getUser,
  getUnsyncedReadings,
  markReadingSynced,
  markReadingsSynced,
  getUnsyncedCount,
  SavedReading,
} from './sqliteService';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // API endpoint - update for your environment
  apiUrl: 'https://trinityemr.com/api/careviewapp/vitals_sync.php',

  // API key - must match server
  apiKey: 'dc9a8e0f685349ab93c0e06f417ff7f8c13fbbac170b71270b55bd2ba7c3ba85', 

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
  id: string; // app_reading_id for tracking
  type: 'BP' | 'BG' | 'SCALE';
  value: number | null;
  value2?: number | null;
  heartRate?: number | null;
  unit: string;
  ts: number; // timestamp in ms
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

type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncAttempt: Date | null;
  lastSuccessfulSync: Date | null;
  lastError: string | null;
  retryCount: number;
}

// ============================================================================
// State
// ============================================================================

let syncState: SyncState = {
  status: 'idle',
  pendingCount: 0,
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
export function onSyncStateChange(listener: (state: SyncState) => void): () => void {
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

    console.log(`[VitalsSync] Network: ${isOnline ? 'online' : 'offline'}`);

    if (isOnline && wasOffline) {
      // Just came online - try to sync pending readings
      updateState({ status: 'idle' });
      syncPendingReadings();
    } else if (!isOnline) {
      updateState({ status: 'offline' });
      cancelRetry();
    }
  });

  return unsubscribe;
}

// ============================================================================
// API Communication
// ============================================================================

/**
 * Send readings to EMR API
 */
async function sendToApi(payload: SyncPayload): Promise<SyncResponse> {
  console.log(`[VitalsSync] Sending ${payload.vitals.length} readings to API...`);

  const response = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CONFIG.apiKey,
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
 */
function readingToPayload(reading: SavedReading): VitalPayload {
  return {
    id: reading.id,
    type: reading.type,
    value: reading.value ?? null,
    value2: reading.value2 ?? null,
    heartRate: reading.heartRate ?? null,
    unit: reading.unit,
    ts: reading.ts,
  };
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Sync a single reading immediately after capture
 * Returns true if synced successfully, false if queued for retry
 */
export async function syncReading(reading: SavedReading): Promise<boolean> {
  // Get patient ID
  const user = await getUser();
  if (!user?.patientId) {
    console.warn('[VitalsSync] No user logged in, cannot sync');
    return false;
  }

  if (!isOnline) {
    console.log('[VitalsSync] Offline, reading queued for later sync');
    updatePendingCount();
    scheduleRetry();
    return false;
  }

  updateState({ status: 'syncing', lastSyncAttempt: new Date() });

  try {
    const payload: SyncPayload = {
      patient_id: parseInt(user.patientId, 10),
      vitals: [readingToPayload(reading)],
    };

    const result = await sendToApi(payload);

    if (result.summary.inserted > 0 || result.summary.duplicates_skipped > 0) {
      // Success - mark as synced
      markReadingSynced(reading.id);
      updateState({
        status: 'idle',
        lastSuccessfulSync: new Date(),
        lastError: null,
        retryCount: 0,
      });
      updatePendingCount();
      console.log(`[VitalsSync] ✅ Reading ${reading.id} synced`);
      return true;
    }

    if (result.summary.errors > 0) {
      throw new Error(result.results.errors[0]?.error || 'Unknown error');
    }

    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[VitalsSync] ❌ Sync failed: ${message}`);
    updateState({
      status: 'error',
      lastError: message,
    });
    scheduleRetry();
    return false;
  }
}

/**
 * Sync all pending (unsynced) readings
 */
export async function syncPendingReadings(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  if (!isOnline) {
    console.log('[VitalsSync] Offline, skipping sync');
    return { synced: 0, failed: 0, remaining: getUnsyncedCount() };
  }

  const user = await getUser();
  if (!user?.patientId) {
    console.warn('[VitalsSync] No user logged in, cannot sync');
    return { synced: 0, failed: 0, remaining: getUnsyncedCount() };
  }

  const unsynced = getUnsyncedReadings();
  if (unsynced.length === 0) {
    console.log('[VitalsSync] No pending readings to sync');
    return { synced: 0, failed: 0, remaining: 0 };
  }

  console.log(`[VitalsSync] Syncing ${unsynced.length} pending readings...`);
  updateState({ status: 'syncing', lastSyncAttempt: new Date() });

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

      const result = await sendToApi(payload);

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
        console.warn(`[VitalsSync] Error for ${err.app_reading_id}: ${err.error}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[VitalsSync] Batch sync failed: ${message}`);
      totalFailed += batch.length;
    }

    // Small delay between batches to avoid overwhelming the server
    if (i + CONFIG.batchSize < unsynced.length) {
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
    }
  }

  const remaining = getUnsyncedCount();

  updateState({
    status: remaining > 0 ? 'error' : 'idle',
    lastSuccessfulSync: totalSynced > 0 ? new Date() : syncState.lastSuccessfulSync,
    lastError: totalFailed > 0 ? `${totalFailed} readings failed to sync` : null,
    retryCount: remaining > 0 ? syncState.retryCount : 0,
  });
  updatePendingCount();

  console.log(`[VitalsSync] Sync complete: ${totalSynced} synced, ${totalFailed} failed, ${remaining} remaining`);

  // Schedule retry if there are still pending readings
  if (remaining > 0) {
    scheduleRetry();
  }

  return { synced: totalSynced, failed: totalFailed, remaining };
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
    console.log('[VitalsSync] Offline, will retry when online');
    return;
  }

  const retryIndex = Math.min(syncState.retryCount, CONFIG.retryDelays.length - 1);
  const delay = CONFIG.retryDelays[retryIndex];

  console.log(`[VitalsSync] Scheduling retry in ${delay / 1000}s (attempt ${syncState.retryCount + 1})`);

  updateState({ retryCount: syncState.retryCount + 1 });

  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    syncPendingReadings();
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

  console.log('[VitalsSync] Starting background sync');

  backgroundSyncIntervalId = setInterval(() => {
    if (isOnline && syncState.status === 'idle') {
      const pending = getUnsyncedCount();
      if (pending > 0) {
        console.log(`[VitalsSync] Background sync: ${pending} pending readings`);
        syncPendingReadings();
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
    console.log('[VitalsSync] Background sync stopped');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function updatePendingCount(): void {
  const count = getUnsyncedCount();
  if (count !== syncState.pendingCount) {
    updateState({ pendingCount: count });
  }
}

/**
 * Force refresh of pending count (call after saving a reading)
 */
export function refreshPendingCount(): number {
  const count = getUnsyncedCount();
  updateState({ pendingCount: count });
  return count;
}

/**
 * Check if we have any pending readings
 */
export function hasPendingReadings(): boolean {
  return getUnsyncedCount() > 0;
}

/**
 * Manual trigger to sync all pending readings
 */
export async function forceSyncAll(): Promise<{
  synced: number;
  failed: number;
  remaining: number;
}> {
  // Reset retry count for manual sync
  updateState({ retryCount: 0 });
  return syncPendingReadings();
}

// ============================================================================
// Initialize
// ============================================================================

/**
 * Initialize the sync service
 * Call this once at app startup (e.g., in App.tsx)
 */
export function initVitalsSync(): () => void {
  console.log('[VitalsSync] Initializing...');

  // Update pending count
  updatePendingCount();

  // Start network monitoring
  const unsubscribeNetwork = initNetworkMonitoring();

  // Start background sync
  startBackgroundSync();

  // Initial sync attempt
  setTimeout(() => {
    if (isOnline && getUnsyncedCount() > 0) {
      syncPendingReadings();
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
  forceSyncAll,
  getSyncState,
  onSyncStateChange,
  hasPendingReadings,
  refreshPendingCount,
  startBackgroundSync,
  stopBackgroundSync,
};