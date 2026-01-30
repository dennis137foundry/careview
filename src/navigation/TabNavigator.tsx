/* eslint-disable react/no-unstable-nested-components */
// src/navigation/TabNavigator.tsx
import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#002040",
          paddingTop: 16,
          paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 20,
          height: 80 + (insets.bottom > 0 ? insets.bottom : 0),
          borderTopWidth: 0,
        },
        tabBarItemStyle: {
          paddingVertical: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
          marginTop: 4,
        },
        tabBarActiveTintColor: "#ffffff",
        tabBarInactiveTintColor: "rgba(255,255,255,0.6)",
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
          tabPress: (e: any) => {
            e.preventDefault();
            navigation.navigate("Dashboard", { screen: "DashboardMain" });
          },
        })}
      />
      <Tab.Screen
        name="Devices"
        component={DevicesNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: (e: any) => {
            e.preventDefault();
            navigation.navigate("Devices", { screen: "DevicesMain" });
          },
        })}
      />
      <Tab.Screen
        name="History"
        component={HistoryNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: (e: any) => {
            e.preventDefault();
            navigation.navigate("History", { screen: "HistoryMain" });
          },
        })}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileNavigator}
        listeners={({ navigation }: any) => ({
          tabPress: (e: any) => {
            e.preventDefault();
            navigation.navigate("Profile", { screen: "ProfileMain" });
          },
        })}
      />
    </Tab.Navigator>
  );
}