/* eslint-disable react/no-unstable-nested-components */
/* eslint-disable react-native/no-inline-styles */
// src/navigation/AppNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSelector } from "react-redux";
import { View, ActivityIndicator, Image } from "react-native";

import TabNavigator from "./TabNavigator";
import AuthScreen from "../screens/Auth/AuthScreen";
import CodeVerifyScreen from "../screens/Auth/CodeVerifyScreen";

import type { RootState } from "../redux/store";

export type RootStackParamList = {
  AuthPhone: undefined;
  AuthCode: { phone: string };
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { isAuthenticated, loading } = useSelector(
    (state: RootState) => state.user
  );

  // Show loading spinner while SQLite user is being checked
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#fff",
        }}
      >
        <ActivityIndicator size="large" color="#002040" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerTitle: () => (
          <Image
            source={require("../assets/cvlogo.png")}
            style={{ width: 140, height: 30 }}
            resizeMode="contain"
          />
        ),
        headerStyle: { backgroundColor: "#002040" },
        headerTintColor: "#fff",
        headerShadowVisible: false,
      }}
    >
      {isAuthenticated ? (
        // Authenticated: show main app
        <Stack.Screen
          name="Main"
          component={TabNavigator}
          options={{ headerShown: true }}
        />
      ) : (
        // Not authenticated: show auth flow
        <>
          <Stack.Screen
            name="AuthPhone"
            component={AuthScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="AuthCode"
            component={CodeVerifyScreen}
            options={{ headerShown: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}