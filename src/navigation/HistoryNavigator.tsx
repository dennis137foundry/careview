import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HistoryScreen from "../screens/History/HistoryScreen";

export type HistoryStackParamList = { HistoryMain: undefined };
const Stack = createNativeStackNavigator<HistoryStackParamList>();

export default function HistoryNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HistoryMain" component={HistoryScreen} options={{ title: "History" }} />
    </Stack.Navigator>
  );
}