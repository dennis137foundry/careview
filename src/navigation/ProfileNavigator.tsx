// src/navigation/ProfileNavigator.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProfileScreen from "../screens/Profile/ProfileScreen";
import WipeDataScreen from "../screens/Profile/WipeDataScreen";
import { useT } from "../i18n";

export type ProfileStackParamList = {
  ProfileMain: undefined;
  WipeData: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileNavigator() {
  const { t } = useT();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: t("nav.profile") }} />
      <Stack.Screen name="WipeData" component={WipeDataScreen} options={{ title: t("nav.wipeData") }} />
    </Stack.Navigator>
  );
}