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
import { setDeviceBattery } from "./src/redux/deviceSlice";
import { checkDailyProfileRefresh } from "./src/services/profileRefreshService";
import deviceService from "./src/services/deviceService";
import { initializeVitalsSync } from "./src/hooks/useVitalsSync";
import {
  loadAuthTokensFromStorage,
  setOnAuthExpired,
} from "./src/services/authToken";
import AppNavigator from "./src/navigation/AppNavigator";
import { ToastProvider, useToast } from "./src/components/Toast";

const MyTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "#ffffff" },
};

// Once-a-day EMR profile check (EDD + BP thresholds). Internally
// self-throttled to one call per 24h; safe to invoke on every launch
// and foreground. EMR-sourced EDD always overwrites a patient-entered one.
async function runProfileRefresh() {
  const { user } = store.getState();
  if (!user.isAuthenticated) return;

  const result = await checkDailyProfileRefresh(user.phone);
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

    // Registered before any authedFetch can fire so the first 401 from
    // refresh_token.php routes back to AuthScreen instead of looping.
    setOnAuthExpired(() => {
      showToast({
        message: "Your session expired. Please sign in again.",
        type: "info",
        duration: 4000,
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
    };
    init();

    // Re-check when the app returns to the foreground (self-throttled
    // to once per 24h inside the service).
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        // The "no hold in the login session" exception ends once the app
        // has been away for a minute or more (see urineProteinSession.ts);
        // a brief hop for a system permission dialog does not count.
        noteAppForegrounded();
        runProfileRefresh();
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

    // Cleanup on unmount
    return () => {
      appStateSub.remove();
      batterySub.remove();
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