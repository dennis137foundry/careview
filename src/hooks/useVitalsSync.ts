/**
 * useVitalsSync.ts
 *
 * React hook for easy integration of vitals sync in components
 */

import { useState, useEffect, useCallback } from 'react';
import {
  initVitalsSync,
  syncReading,
  forceSyncAll,
  getSyncState,
  onSyncStateChange,
  refreshPendingCount,
} from '../services/vitalsSyncService';
import { saveReading, SavedReading } from '../services/sqliteService';

interface SyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  pendingCount: number;
  lastSyncAttempt: Date | null;
  lastSuccessfulSync: Date | null;
  lastError: string | null;
  retryCount: number;
}

interface UseVitalsSyncResult {
  // State
  syncState: SyncState;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  hasError: boolean;

  // Actions
  saveAndSync: (reading: Omit<SavedReading, 'id' | 'ts' | 'synced'>) => Promise<{
    saved: boolean;
    synced: boolean;
    readingId: string;
  }>;
  syncAll: () => Promise<{ synced: number; failed: number; remaining: number }>;
  refresh: () => void;
}

/**
 * Hook to manage vitals sync state and actions
 */
export function useVitalsSync(): UseVitalsSyncResult {
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = onSyncStateChange(setSyncState);
    return unsubscribe;
  }, []);

  // Save reading locally and attempt immediate sync
  const saveAndSync = useCallback(
    async (
      reading: Omit<SavedReading, 'id' | 'ts' | 'synced'>
    ): Promise<{ saved: boolean; synced: boolean; readingId: string }> => {
      // Generate ID and timestamp
      const readingId = `reading_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const ts = Date.now();

      // Save locally first (synced = false)
      const fullReading: SavedReading = {
        ...reading,
        id: readingId,
        ts,
        synced: false,
      };

      try {
        saveReading(fullReading);
        console.log(`[useVitalsSync] Reading saved locally: ${readingId}`);
      } catch (error) {
        console.error('[useVitalsSync] Failed to save reading:', error);
        return { saved: false, synced: false, readingId };
      }

      // Update pending count
      refreshPendingCount();

      // Attempt immediate sync
      const synced = await syncReading(fullReading);

      return { saved: true, synced, readingId };
    },
    []
  );

  // Sync all pending readings
  const syncAll = useCallback(async () => {
    return forceSyncAll();
  }, []);

  // Refresh pending count
  const refresh = useCallback(() => {
    refreshPendingCount();
  }, []);

  return {
    syncState,
    isOnline: syncState.status !== 'offline',
    isSyncing: syncState.status === 'syncing',
    pendingCount: syncState.pendingCount,
    hasError: syncState.status === 'error',

    saveAndSync,
    syncAll,
    refresh,
  };
}

/**
 * Initialize sync service at app startup
 * Call once in App.tsx or similar
 *
 * @example
 * useEffect(() => {
 *   const cleanup = initializeVitalsSync();
 *   return cleanup;
 * }, []);
 */
export function initializeVitalsSync(): () => void {
  return initVitalsSync();
}

export default useVitalsSync;