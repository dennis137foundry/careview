// App.tsx
import React, { useEffect } from "react";
import { Provider, useDispatch } from "react-redux";
import type { AppDispatch } from "./src/redux/store";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import RNBootSplash from "react-native-bootsplash";
import { AppState, StatusBar } from "react-native";
import { store } from "./src/redux/store";
import { initDB, getLastScreeningResponse } from "./src/services/sqliteService";
import {
  clearLoginSession,
  noteAppBackgrounded,
  noteAppForegrounded,
} from "./src/services/urineProteinSession";
import {
  cancelUrineReminders,
  ensureUrineRemindersScheduled,
} from "./src/services/urineReminderService";
import { loadUser, logout, setEdd, setBPThresholds } from "./src/redux/userSlice";
import {
  setDeviceBattery,
  setDeviceClockSetAt,
  setDeviceClockOffset,
} from "./src/redux/deviceSlice";
import { checkProfileOnForeground } from "./src/services/profileRefreshService";
import deviceService from "./src/services/deviceService";
import { refreshDeviceBatteries } from "./src/services/batteryRefreshService";
import { initializeVitalsSync } from "./src/hooks/useVitalsSync";
import {
  loadAuthTokensFromStorage,
  setOnAuthExpired,
} from "./src/services/authToken";
import AppNavigator from "./src/navigation/AppNavigator";
import { ToastProvider, useToast } from "./src/components/Toast";

// A device clock more than this far from the phone's was not set (or was
// reset) — small drift is normal and is simply corrected by setting it.
const CLOCK_OFF_THRESHOLD_MS = 10 * 60 * 1000;

const MyTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "#ffffff" },
};

// Foreground EMR profile check (EDD + BP thresholds). Internally
// self-throttled inside the service; safe to invoke on every launch and
// foreground. EMR-sourced EDD always overwrites a patient-entered one.
// It is also the call that discovers the EMR has ended this patient's
// app access, which authedFetch turns into a sign-out.
async function runProfileRefresh() {
  const { user } = store.getState();
  if (!user.isAuthenticated) return;

  const result = await checkProfileOnForeground(user.phone);
  if (!result) return;

  if (result.edd) {
    store.dispatch(setEdd({ edd: result.edd, source: "emr" }));
  }
  store.dispatch(setBPThresholds(result.bpThresholds));
}

function RootApp() {
  const dispatch = useDispatch<AppDispatch>();
  const { showToast } = useToast();

  useEffect(() => {
    let cleanupSync: (() => void) | undefined;

    // Registered before any authedFetch can fire so the first rejection
    // from the server routes back to AuthScreen instead of looping.
    // "access_revoked" is the EMR ending this patient's app access
    // (discharge, phone cleared/changed, App Login switched off) — say so,
    // rather than implying she can simply sign back in.
    setOnAuthExpired((reason) => {
      showToast({
        message:
          reason === "access_revoked"
            ? "Your CareView access has been turned off by your care team. Please contact them if you think this is a mistake."
            : "Your session expired. Please sign in again.",
        type: "info",
        duration: reason === "access_revoked" ? 8000 : 4000,
      });
      cancelUrineReminders();
      clearLoginSession();
      store.dispatch(logout());
    });

    const init = async () => {
      initDB();
      await dispatch(loadUser());
      // Hydrate the in-memory JWT cache from SQLite so the first sync
      // attempt after launch already has a Bearer header available.
      await loadAuthTokensFromStorage();

      // Rebuild the local urine-protein reminder series if the OS dropped
      // it (no-op when reminders are already pending).
      if (store.getState().user.isAuthenticated) {
        const lastUrine = getLastScreeningResponse("urine_protein_result");
        ensureUrineRemindersScheduled(lastUrine ? lastUrine.timestamp : null);
      }

      // Initialize vitals sync service (monitors network, retries failed syncs)
      cleanupSync = initializeVitalsSync();

      RNBootSplash.hide({ fade: true });

      // After splash — never blocks startup. Fire-and-forget.
      runProfileRefresh();
      // Refresh every registered device's battery so the Devices screen
      // and the pre-capture warning reflect the device as it is now, not
      // as it was at the last reading (a monitor charged overnight kept
      // showing last night's 11%). Devices that are asleep are skipped.
      if (store.getState().user.isAuthenticated) {
        refreshDeviceBatteries();
      }
    };
    init();

    // Re-check when the app returns to the foreground (self-throttled
    // inside the service).
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        // The "no hold in the login session" exception ends once the app
        // has been away for a minute or more (see urineProteinSession.ts);
        // a brief hop for a system permission dialog does not count.
        noteAppForegrounded();
        runProfileRefresh();
        if (store.getState().user.isAuthenticated) {
          refreshDeviceBatteries();
        }
      } else if (nextState === "background") {
        noteAppBackgrounded();
      }
    });

    // App-wide battery capture: native emits onBatteryLevel on every
    // device connection (capture AND the battery-only connect after
    // adding a device). Listening here — not per-screen — means no
    // reading is ever missed regardless of where the user is.
    const batterySub = deviceService.onBatteryLevel(({ mac, level }) => {
      if (typeof level === "number" && level >= 0 && level <= 100 && mac) {
        store.dispatch(setDeviceBattery({ mac, battery: level }));
      }
    });

    // App-wide too: native reports every time it sets a device's own clock
    // (add-device setup, and every glucose-meter connect), including what
    // the clock read just BEFORE it was set. A glucose meter out of the box
    // — or after a dead battery — runs from 2017; when it is found off by
    // more than a few minutes, remember (phone − meter) as the device's
    // clock offset. The meter flags readings taken on the unset clock, and
    // the capture flow dates them by adding this offset.
    const clockSub = deviceService.onDeviceClockSet(
      ({ mac, at, deviceDateBefore }) => {
        if (typeof at !== "number" || !Number.isFinite(at) || !mac) return;
        store.dispatch(setDeviceClockSetAt({ mac, at }));
        if (
          typeof deviceDateBefore === "number" &&
          Number.isFinite(deviceDateBefore) &&
          Math.abs(at - deviceDateBefore) > CLOCK_OFF_THRESHOLD_MS
        ) {
          store.dispatch(
            setDeviceClockOffset({ mac, offsetMs: at - deviceDateBefore })
          );
        }
      }
    );

    // Cleanup on unmount
    return () => {
      appStateSub.remove();
      batterySub.remove();
      clockSub.remove();
      if (cleanupSync) {
        cleanupSync();
      }
    };
  }, [dispatch, showToast]);

  return (
    <NavigationContainer theme={MyTheme}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <ToastProvider>
          <RootApp />
        </ToastProvider>
      </SafeAreaProvider>
    </Provider>
  );
}