import { useCallback } from "react";
import { StatusBar, StatusBarStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Keep the status-bar glyphs (clock, battery, signal) readable on a screen by
 * setting the bar style whenever that screen gains focus.
 *
 * Use "light-content" (white glyphs) over dark/blue headers, "dark-content"
 * (black glyphs) over light backgrounds. This is applied on focus because
 * bottom-tab screens stay mounted — a declarative <StatusBar> doesn't reliably
 * switch when you change tabs.
 */
export function useStatusBarStyle(style: StatusBarStyle): void {
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle(style, true);
    }, [style])
  );
}
