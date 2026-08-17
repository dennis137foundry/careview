import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "../screens/Dashboard/DashboardScreen";
// Routes iHealth devices to CaptureScreen and generic BLE devices to
// BleCaptureScreen. See CaptureRouter for why the flows are kept separate.
import CaptureScreen from "../screens/Capture/CaptureRouter";

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
