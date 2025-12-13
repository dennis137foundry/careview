// src/navigation/SettingsNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import SettingsScreen from "../screens/Settings/SettingsScreen";
import AccountScreen from "../screens/Settings/AccountScreen";

export type SettingsStackParamList = {
  SettingsMain: undefined;
  Account: undefined;
};

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="SettingsMain"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <Stack.Screen
        name="Account"
        component={AccountScreen}
        options={{ title: "Account" }}
      />
    </Stack.Navigator>
  );
}
