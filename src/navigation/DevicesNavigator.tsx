// src/navigation/DevicesNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DevicesScreen from "../screens/Devices/DevicesScreen";
import AddDeviceScreen from "../screens/Devices/AddDeviceScreen";
import CaptureScreen from "../screens/Capture/CaptureScreen";
import ScanQRScreen from "../screens/Devices/ScanQRScreen";
import BG5SDebugScreen from "../screens/Devices/BG5SDebugScreen";

export type DevicesStackParamList = {
  DevicesMain: undefined;
  AddDevice: { 
    scannedId?: string;
    scannedBottleCode?: string;
    forDeviceId?: string;
  } | undefined;
  ScanQR: { 
    deviceId?: string;
    deviceName?: string;
    returnTo?: 'AddDevice' | 'Capture';
  } | undefined;
  BG5SDebug: undefined;
  Capture: { 
    deviceId: string;
    bottleCode?: string;
  };
};

const Stack = createNativeStackNavigator<DevicesStackParamList>();

export default function DevicesNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="DevicesMain"
        component={DevicesScreen}
        options={{ title: "Devices" }}
      />
      <Stack.Screen
        name="AddDevice"
        component={AddDeviceScreen}
        options={{ title: "Add Device" }}
      />
      <Stack.Screen
        name="ScanQR"
        component={ScanQRScreen}
        options={{ title: "Scan QR Code" }}
      />
      <Stack.Screen
        name="BG5SDebug"
        component={BG5SDebugScreen}
        options={{ title: "BG5S Debug" }}
      />
      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={{ title: "Capture Reading" }}
      />
    </Stack.Navigator>
  );
}
