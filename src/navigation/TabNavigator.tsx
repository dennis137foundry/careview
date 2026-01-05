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
          backgroundColor: "#002040",
        },
        tabBarActiveTintColor: "#ffffff",
        tabBarInactiveTintColor: "#ffffff",
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
      <Tab.Screen
        name="Dashboard"
        component={DashboardNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: () => {
            navigation.navigate("Dashboard", { screen: "DashboardMain" });
          },
        })}
      />
      <Tab.Screen
        name="Devices"
        component={DevicesNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: () => {
            navigation.navigate("Devices", { screen: "DevicesMain" });
          },
        })}
      />
      <Tab.Screen
        name="History"
        component={HistoryNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: () => {
            navigation.navigate("History", { screen: "HistoryMain" });
          },
        })}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: () => {
            navigation.navigate("Profile", { screen: "ProfileMain" });
          },
        })}
      />
    </Tab.Navigator>
  );
}