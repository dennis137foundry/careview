/**
 * SyncStatusBadge.tsx
 *
 * A small component that shows sync status and pending count.
 * Can be placed in headers, footers, or anywhere you want to show sync state.
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useVitalsSync } from '../hooks/useVitalsSync';

interface SyncStatusBadgeProps {
  /** Show as a compact badge (just icon + count) or expanded (with text) */
  compact?: boolean;
  /** Called when user taps the badge */
  onPress?: () => void;
  /** Custom styles */
  style?: object;
}

export function SyncStatusBadge({
  compact = false,
  onPress,
  style,
}: SyncStatusBadgeProps) {
  const { syncState, isSyncing, pendingCount, isOnline, hasError, syncAll } = useVitalsSync();

  // Don't show anything if synced and no issues
  if (pendingCount === 0 && !hasError && isOnline) {
    return null;
  }

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (pendingCount > 0 && !isSyncing) {
      // Default action: try to sync
      syncAll();
    }
  };

  // Determine icon and color
  let iconName = 'cloud-done';
  let iconColor = '#28a745';
  let statusText = 'Synced';
  let bgColor = '#e8f5e9';

  if (!isOnline) {
    iconName = 'cloud-off';
    iconColor = '#6c757d';
    statusText = 'Offline';
    bgColor = '#f5f5f5';
  } else if (isSyncing) {
    iconName = 'cloud-upload';
    iconColor = '#007bff';
    statusText = 'Syncing...';
    bgColor = '#e3f2fd';
  } else if (hasError) {
    iconName = 'cloud-off';
    iconColor = '#dc3545';
    statusText = 'Sync error';
    bgColor = '#ffebee';
  } else if (pendingCount > 0) {
    iconName = 'cloud-queue';
    iconColor = '#ffc107';
    statusText = `${pendingCount} pending`;
    bgColor = '#fff8e1';
  }

  if (compact) {
    return (
      <TouchableOpacity
        onPress={handlePress}
        style={[styles.compactContainer, { backgroundColor: bgColor }, style]}
        activeOpacity={0.7}
      >
        {isSyncing ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <MaterialIcons name={iconName} size={18} color={iconColor} />
        )}
        {pendingCount > 0 && (
          <View style={[styles.badge, { backgroundColor: iconColor }]}>
            <Text style={styles.badgeText}>{pendingCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={[styles.container, { backgroundColor: bgColor }, style]}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        {isSyncing ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <MaterialIcons name={iconName} size={20} color={iconColor} />
        )}
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.statusText, { color: iconColor }]}>{statusText}</Text>
        {hasError && syncState.lastError && (
          <Text style={styles.errorText} numberOfLines={1}>
            {syncState.lastError}
          </Text>
        )}
      </View>
      {pendingCount > 0 && !isSyncing && (
        <MaterialIcons name="refresh" size={18} color={iconColor} style={styles.refreshIcon} />
      )}
    </TouchableOpacity>
  );
}

/**
 * A simple sync button with loading state
 */
export function SyncButton({ style }: { style?: object }) {
  const { isSyncing, pendingCount, isOnline, syncAll } = useVitalsSync();

  if (pendingCount === 0) {
    return null;
  }

  return (
    <TouchableOpacity
      onPress={() => syncAll()}
      disabled={isSyncing || !isOnline}
      style={[
        styles.syncButton,
        (!isOnline || isSyncing) && styles.syncButtonDisabled,
        style,
      ]}
      activeOpacity={0.7}
    >
      {isSyncing ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <MaterialIcons name="cloud-upload" size={20} color="#fff" />
      )}
      <Text style={styles.syncButtonText}>
        {isSyncing ? 'Syncing...' : `Sync ${pendingCount} reading${pendingCount !== 1 ? 's' : ''}`}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    position: 'relative',
  },
  iconContainer: {
    marginRight: 8,
  },
  textContainer: {
    flex: 1,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 12,
    color: '#dc3545',
    marginTop: 2,
  },
  refreshIcon: {
    marginLeft: 8,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007bff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  syncButtonDisabled: {
    backgroundColor: '#6c757d',
    opacity: 0.7,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default SyncStatusBadge;