import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HistoryScreen from "../screens/History/HistoryScreen";
import { useT } from "../i18n";

export type HistoryStackParamList = { HistoryMain: undefined };
const Stack = createNativeStackNavigator<HistoryStackParamList>();

export default function HistoryNavigator() {
  const { t } = useT();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HistoryMain" component={HistoryScreen} options={{ title: t("nav.history") }} />
    </Stack.Navigator>
  );
}