/* eslint-disable react/no-unstable-nested-components */
// src/navigation/TabNavigator.tsx
import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

import DashboardNavigator from "./DashboardNavigator";
import DevicesNavigator from "./DevicesNavigator";
import HistoryNavigator from "./HistoryNavigator";
import ProfileNavigator from "./ProfileNavigator";

export type TabParamList = {
  Dashboard: undefined;
  Devices: undefined;
  History: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#002040", // navbar background
        },
        tabBarActiveTintColor: "#ffffff",   // active icon color
        tabBarInactiveTintColor: "#ffffff", // inactive icon color
        tabBarIcon: ({ color, size }) => {
          let iconName: string = "help-outline";

          if (route.name === "Dashboard") {
            iconName = "dashboard";
          } else if (route.name === "Devices") {
            iconName = "devices-other";
          } else if (route.name === "History") {
            iconName = "history";
          } else if (route.name === "Profile") {
            iconName = "person";
          }

          return <MaterialIcons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardNavigator} />
      <Tab.Screen name="Devices" component={DevicesNavigator} />
      <Tab.Screen name="History" component={HistoryNavigator} />
      <Tab.Screen name="Profile" component={ProfileNavigator} />
    </Tab.Navigator>
  );
}
