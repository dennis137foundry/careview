// src/services/batteryRefreshService.ts
//
// Best-effort refresh of every registered iHealth device's battery level.
//
// The Devices screen and the low-battery warning before a capture both read
// devices.lastBattery, which is only ever updated when a device connects.
// Without this, a monitor charged overnight still showed last night's 11%
// the next morning and the app warned the patient to charge a full device.
//
// Runs at app start and on foreground (throttled). It scans briefly for the
// models the patient has registered and, for each registered device that
// answers, opens the battery-only connection (never a measurement) that the
// add-device flow already uses. A device that is asleep is simply not found
// and keeps its last reading and timestamp — the warning logic treats an old
// reading as unknown rather than as current.
//
// The iHealth SDK is a singleton: this must never overlap a capture or an
// add-device scan. Those screens report themselves as active while focused
// (markDeviceScreenActive), which both blocks a new refresh and cancels one
// in progress.

import { Platform } from "react-native";
import type { EmitterSubscription } from "react-native";
import deviceService from "./deviceService";
import { getDevices, type DeviceRecord } from "./sqliteService";

// Models whose battery the SDK can report over a battery-only connection.
// HS4S has no battery API; generic-BLE devices report battery on their own
// connections and are never scanned here.
const BATTERY_MODELS = new Set(["BP3L", "BP5", "BP5S", "HS2", "HS2S", "BG5S"]);

const THROTTLE_MS = 10 * 60 * 1000; // at most one refresh per 10 minutes
const SCAN_WINDOW_MS = 12_000; // how long to listen for registered devices
const PER_DEVICE_TIMEOUT_MS = 6_000; // how long to wait for one battery read

let running = false;
let lastRunAt = 0;
let deviceScreenActive = false;

// State of the run in progress. Every wait the run does registers its
// resolver in `wake` so a cancel can unblock it immediately; the run then
// notices `cancelled` and unwinds through its own cleanup. Only the run
// itself ever tears down its subscriptions and timers.
let cancelled = false;
let wake: (() => void) | null = null;
let subs: EmitterSubscription[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];

function cleanup(): void {
  subs.forEach((s) => s.remove());
  subs = [];
  timers.forEach((t) => clearTimeout(t));
  timers = [];
  wake = null;
}

/** Wait for `ms`, or until the run is cancelled. */
function waitOrCancel(ms: number): Promise<void> {
  return new Promise((resolve) => {
    wake = resolve;
    timers.push(setTimeout(resolve, ms));
  });
}

/**
 * A capture or add-device screen is (or is no longer) in front. While one
 * is, no refresh starts and any refresh in progress is cancelled — the SDK
 * scanner and connection belong to that screen.
 */
export function markDeviceScreenActive(active: boolean): void {
  deviceScreenActive = active;
  if (active) cancelBatteryRefresh();
}

/** Stop a refresh in progress. The run unwinds and cleans up after itself. */
export function cancelBatteryRefresh(): void {
  if (!running) return;
  cancelled = true;
  deviceService.stopScan().catch(() => {});
  if (wake) wake();
}

export function isBatteryRefreshRunning(): boolean {
  return running;
}

/**
 * Refresh battery levels for every registered iHealth device that is awake.
 * Silent on every failure — Bluetooth off, permission missing, nothing found.
 */
export async function refreshDeviceBatteries(opts: { force?: boolean } = {}): Promise<void> {
  if (running || deviceScreenActive) return;
  if (!opts.force && Date.now() - lastRunAt < THROTTLE_MS) return;

  const targets: DeviceRecord[] = getDevices().filter(
    (d) =>
      (d.source ?? "iHealthSDK") === "iHealthSDK" &&
      !!d.model &&
      BATTERY_MODELS.has(d.model) &&
      !!d.mac
  );
  if (targets.length === 0) return;

  // Status only — never ensureBluetoothReady(), which requests permissions
  // and would put a system prompt on screen at launch. CoreBluetooth reports
  // "unknown" for the first moment after a cold start, so re-check once.
  try {
    let status = await deviceService.getBluetoothStatus();
    if (status.state === "unknown" || status.state === "resetting") {
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      status = await deviceService.getBluetoothStatus();
    }
    if (!status.ready) return;
  } catch {
    return;
  }
  if (deviceScreenActive || running) return;

  running = true;
  cancelled = false;
  lastRunAt = Date.now();

  try {
    // The SDK must be authenticated before it will scan; the capture and
    // add-device flows do this too. Idempotent.
    await deviceService.authenticate().catch(() => {});
    if (cancelled) return;

    const byMac = new Map<string, DeviceRecord>();
    targets.forEach((d) => byMac.set(d.mac.toUpperCase(), d));
    const found = new Map<string, DeviceRecord>();

    // 1. Scan for the models on file until every registered device has been
    //    seen, the window closes, or the run is cancelled.
    await new Promise<void>((resolve) => {
      wake = resolve;
      subs.push(
        deviceService.onDeviceFound((dev) => {
          const key = String(dev.mac || "").toUpperCase();
          const registered = byMac.get(key);
          if (!registered || found.has(key)) return;
          found.set(key, registered);
          if (found.size === byMac.size) resolve();
        })
      );
      timers.push(setTimeout(resolve, SCAN_WINDOW_MS));

      const models = Array.from(new Set(targets.map((d) => d.model as string)));
      // iOS discovers the BG5S through its own additive scan path.
      const sdkTypes = models.filter((m) => m !== "BG5S" || Platform.OS === "android");
      const scans: Promise<unknown>[] = [];
      if (sdkTypes.length > 0) scans.push(deviceService.startScan(sdkTypes));
      if (Platform.OS === "ios" && models.includes("BG5S")) {
        scans.push(deviceService.startBG5SScan());
      }
      Promise.all(scans).catch(() => resolve());
    });
    cleanup();
    if (cancelled) return;
    await deviceService.stopScan().catch(() => {});
    if (found.size === 0) return;

    // 2. One battery-only connection per device, in turn. The result lands
    //    via the app-level onBatteryLevel listener (App.tsx); here we only
    //    wait for it — or a timeout — before moving to the next device.
    for (const device of found.values()) {
      if (cancelled) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
        subs.push(
          deviceService.onBatteryLevel(({ mac }) => {
            if (String(mac || "").toUpperCase() === device.mac.toUpperCase()) resolve();
          })
        );
        timers.push(setTimeout(resolve, PER_DEVICE_TIMEOUT_MS));
        deviceService.connectForBattery(device.mac, device.model as string).catch(() => resolve());
      });
      cleanup();
      if (cancelled) return;
      // iOS drops a battery-only link itself; Android leaves it up until the
      // device sleeps, which could confuse a capture started right after.
      // Drop it explicitly, then let the SDK settle before the next connect.
      await deviceService.disconnectAll().catch(() => {});
      await waitOrCancel(800);
      cleanup();
    }
  } catch (e) {
    console.warn("[BatteryRefresh] Failed:", e);
  } finally {
    cleanup();
    if (!cancelled) {
      deviceService.stopScan().catch(() => {});
    }
    running = false;
  }
}
