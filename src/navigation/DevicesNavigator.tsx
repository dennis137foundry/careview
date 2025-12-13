// src/navigation/DevicesNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DevicesScreen from "../screens/Devices/DevicesScreen";
import AddDeviceScreen from "../screens/Devices/AddDeviceScreen";
import ResultScreen from "../screens/Devices/ResultScreen";
import CaptureScreen from "../screens/Capture/CaptureScreen";
import ScanQRScreen from "../screens/Devices/ScanQRScreen";

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
  Capture: { 
    deviceId: string;
    bottleCode?: string;
  };
  Result: { reading: { value: string; timestamp: string } };
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
        name="Capture"
        component={CaptureScreen}
        options={{ title: "Capture Reading" }}
      />
      <Stack.Screen
        name="Result"
        component={ResultScreen}
        options={{ title: "Reading Result" }}
      />
    </Stack.Navigator>
  );
}
