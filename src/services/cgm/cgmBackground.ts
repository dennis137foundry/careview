/**
 * cgmBackground.ts — sends Dexcom CGM readings while the app is NOT open.
 *
 * iPhone: Apple Health background delivery (native CgmBackground module) —
 *   iOS wakes CareView when the Dexcom app saves new glucose readings; we send
 *   them and tell iOS we are done. Plus background fetch every ≥15 min as a
 *   fallback (iOS decides when; never after the app is force-quit).
 * Android: background fetch every ≥15 min, also after the app is closed
 *   (HeadlessJS) and after a reboot. Reading Health Connect from the
 *   background needs its "read in background" permission (asked at Connect).
 *
 * Nothing runs until the patient has connected (cgm_connected in app_settings).
 */
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import BackgroundFetch from "react-native-background-fetch";
import { initDB, getAppSetting } from "../sqliteService";
import { loadAuthTokensFromStorage } from "../authToken";

const CgmBackground: { enable(): void; disable(): void; finished(): void } | undefined =
  Platform.OS === "ios" ? NativeModules.CgmBackground : undefined;

// syncCgm is required lazily: cgmSyncService imports this file.
const sync = (reason: string): Promise<void> => require("./cgmSyncService").syncCgm(reason);

const isConnected = () => getAppSetting("cgm_connected") === "1";

let configured = false;
let healthKitSub: { remove(): void } | null = null;

/**
 * Android, app closed: HeadlessJS runs this with no React tree and no App.tsx
 * init, so it opens the database and loads the sign-in token itself.
 * Registered from index.js, before the app component.
 */
export function registerCgmHeadlessTask(): void {
  if (Platform.OS !== "android") return;
  BackgroundFetch.registerHeadlessTask(async (event) => {
    const taskId = event.taskId;
    if (event.timeout) {
      BackgroundFetch.finish(taskId);
      return;
    }
    try {
      initDB();
      if (isConnected()) {
        await loadAuthTokensFromStorage();
        await sync("headless");
      }
    } finally {
      BackgroundFetch.finish(taskId);
    }
  });
}

/** Turn background sending on (launch when connected, and right after Connect). */
export async function startCgmBackground(): Promise<void> {
  if (!isConnected()) {
    // Not connected — or this phone now belongs to another patient (the CGM
    // settings were wiped with her data): make sure nothing keeps waking up.
    CgmBackground?.disable();
    BackgroundFetch.stop().catch(() => {});
    return;
  }

  if (CgmBackground) {
    CgmBackground.enable();
    if (!healthKitSub) {
      healthKitSub = new NativeEventEmitter(NativeModules.CgmBackground).addListener(
        "CgmNewData",
        async () => {
          try {
            await sync("healthkit");
          } finally {
            CgmBackground.finished();
          }
        }
      );
    }
  }

  if (!configured) {
    configured = true;
    try {
      await BackgroundFetch.configure(
        {
          minimumFetchInterval: 15, // minutes; the OS decides the real rate
          stopOnTerminate: false, // Android: keep going after the app is closed
          enableHeadless: true, // Android: run registerCgmHeadlessTask's task when closed
          startOnBoot: true, // Android
          requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
        },
        async (taskId) => {
          try {
            await sync("fetch");
          } finally {
            BackgroundFetch.finish(taskId);
          }
        },
        (taskId) => BackgroundFetch.finish(taskId)
      );
    } catch (e) {
      configured = false;
      if (__DEV__) console.log("[CgmBackground] configure failed:", e);
    }
  } else {
    BackgroundFetch.start().catch(() => {});
  }
}

/** Turn background sending off (Stop). */
export function stopCgmBackground(): void {
  CgmBackground?.disable();
  healthKitSub?.remove();
  healthKitSub = null;
  BackgroundFetch.stop().catch(() => {});
}
