/* eslint-disable react/no-unstable-nested-components */
// src/navigation/TabNavigator.tsx
import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Import your custom SVG icons
import DashboardIcon from "../assets/icons/dashboard.svg";
import DevicesIcon from "../assets/icons/devices.svg";
import HistoryIcon from "../assets/icons/history.svg";
import ProfileIcon from "../assets/icons/profile.svg";

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

// Map route names to icon components
const TabIcons: Record<string, React.FC<{ width: number; height: number; fill: string }>> = {
  Dashboard: DashboardIcon,
  Devices: DevicesIcon,
  History: HistoryIcon,
  Profile: ProfileIcon,
};

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
          const IconComponent = TabIcons[route.name];
          if (IconComponent) {
            return <IconComponent width={size} height={size} fill={color} />;
          }
          return null;
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