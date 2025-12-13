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
import AppNavigator from "./src/navigation/AppNavigator";

const MyTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "#ffffff" },
};

function RootApp() {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    const init = async () => {
      initDB();
      await dispatch(loadUser());
      RNBootSplash.hide({ fade: true });
    };
    init();
  }, [dispatch]);

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
        <RootApp />
      </SafeAreaProvider>
    </Provider>
  );
}
