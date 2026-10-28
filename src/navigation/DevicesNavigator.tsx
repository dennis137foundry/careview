// src/navigation/DevicesNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DevicesScreen from "../screens/Devices/DevicesScreen";
import AddDeviceScreen from "../screens/Devices/AddDeviceScreen";
// Routes iHealth devices to CaptureScreen and generic BLE devices to
// BleCaptureScreen. See CaptureRouter for why the flows are kept separate.
import CaptureScreen from "../screens/Capture/CaptureRouter";
import { useT } from "../i18n";

export type DevicesStackParamList = {
  DevicesMain: undefined;
  AddDevice: { 
    scannedId?: string;
    scannedBottleCode?: string;
    forDeviceId?: string;
  } | undefined;
  Capture: { 
    deviceId: string;
    bottleCode?: string;
  };
};

const Stack = createNativeStackNavigator<DevicesStackParamList>();

export default function DevicesNavigator() {
  const { t } = useT();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="DevicesMain"
        component={DevicesScreen}
        options={{ title: t("nav.devices") }}
      />
      <Stack.Screen
        name="AddDevice"
        component={AddDeviceScreen}
        options={{ title: t("nav.addDevice") }}
      />
      <Stack.Screen
        name="Capture"
        component={CaptureScreen}
        options={{ title: t("nav.captureReading") }}
      />
    </Stack.Navigator>
  );
}
