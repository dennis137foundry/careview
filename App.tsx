// App.tsx
import React, { useEffect } from "react";
import { Provider, useDispatch } from "react-redux";
import type { AppDispatch } from "./src/redux/store";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import RNBootSplash from "react-native-bootsplash";
import { StatusBar } from "react-native";
import { store } from "./src/redux/store";
import { initDB } from "./src/services/sqliteService";
import { loadUser, logout } from "./src/redux/userSlice";
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
      store.dispatch(logout());
    });

    const init = async () => {
      initDB();
      await dispatch(loadUser());
      // Hydrate the in-memory JWT cache from SQLite so the first sync
      // attempt after launch already has a Bearer header available.
      await loadAuthTokensFromStorage();

      // Initialize vitals sync service (monitors network, retries failed syncs)
      cleanupSync = initializeVitalsSync();

      RNBootSplash.hide({ fade: true });
    };
    init();

    // Cleanup on unmount
    return () => {
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