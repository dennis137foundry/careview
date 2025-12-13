import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "../screens/Dashboard/DashboardScreen";
import CaptureScreen from "../screens/Capture/CaptureScreen";

export type DashboardStackParamList = {
  DashboardMain: undefined;
  Capture: undefined;
};

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export default function DashboardNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="DashboardMain"
        component={DashboardScreen}
        options={{ title: "Dashboard" }}
      />
      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={{ title: "Capture" }} // can override styles here if needed
      />
    </Stack.Navigator>
  );
}
