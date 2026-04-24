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
import { loadUser } from "./src/redux/userSlice";
import { initializeVitalsSync } from "./src/hooks/useVitalsSync";
import { loadAuthTokensFromStorage } from "./src/services/authToken";
import AppNavigator from "./src/navigation/AppNavigator";
import { ToastProvider } from "./src/components/Toast";

const MyTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "#ffffff" },
};

function RootApp() {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    let cleanupSync: (() => void) | undefined;

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
  }, [dispatch]);

  return (
    <ToastProvider>
      <NavigationContainer theme={MyTheme}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <AppNavigator />
      </NavigationContainer>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <RootApp />
      </SafeAreaProvider>
    </Provider>
  );
}