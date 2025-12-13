/* eslint-disable react/no-unstable-nested-components */
/* eslint-disable react-native/no-inline-styles */
// src/navigation/AppNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSelector } from "react-redux";
import TabNavigator from "./TabNavigator";
import { View, ActivityIndicator, Image } from "react-native";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const user = useSelector((s: any) => s.user);

  // Show loading spinner while SQLite user is being checked
  if (user.loading) {
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

  // ✅ Navigator must return ONLY Stack.Screen elements as direct children
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
      <Stack.Screen
        name="Main"
        component={TabNavigator}
        options={{ headerShown: true }} // shows logo bar, no screen title bar
      />
    </Stack.Navigator>
  );
}
