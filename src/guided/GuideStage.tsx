/**
 * One guided step on a capture screen: the animation card, an optional
 * "Step 2 of 3", a title and the instruction. Buttons stay with the screen,
 * which owns what each one does.
 *
 * Styled for the capture screens' dark backdrop.
 */

import React from "react";
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import GuidedAnimation from "./GuidedAnimation";
import type { AnimationName } from "./animations";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

/** Card size for a step: as wide as the screen allows, never oversized. */
export const GUIDE_CARD_SIZE = Math.round(Math.min(SCREEN_WIDTH - 48, 340));
/** Smaller card above a saved reading. */
export const GUIDE_SUCCESS_SIZE = Math.round(Math.min(SCREEN_WIDTH * 0.42, 170));

type Props = {
  anim: AnimationName;
  title: string;
  body?: string;
  stepLabel?: string;
  size?: number;
  /** What the device is doing right now ("The meter is waiting for blood."). */
  status?: string;
  /** A live number from the device (cuff pressure, weight), under the text. */
  liveValue?: { value: string; unit: string; label?: string } | null;
};

export default function GuideStage({
  anim,
  title,
  body,
  stepLabel,
  size = GUIDE_CARD_SIZE,
  status,
  liveValue,
}: Props) {
  return (
    <View style={styles.stage}>
      <GuidedAnimation name={anim} size={size} />
      {stepLabel ? <Text style={styles.step}>{stepLabel}</Text> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {status ? (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
      {liveValue ? (
        <View style={styles.live}>
          {liveValue.label ? <Text style={styles.liveLabel}>{liveValue.label}</Text> : null}
          <Text style={styles.liveNumber}>
            {liveValue.value}
            <Text style={styles.liveUnit}> {liveValue.unit}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A quiet text button under the main one ("Skip to measurement", "How to test"). */
export function GuideLinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.link}
      accessibilityRole="button"
      hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
    >
      <Text style={styles.linkText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: "center",
    width: "100%",
  },
  step: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: "#7fd6de",
  },
  title: {
    marginTop: 8,
    fontSize: 21,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  body: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 23,
    color: "rgba(255,255,255,0.82)",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  status: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "600",
    color: "#7fd6de",
    textAlign: "center",
  },
  live: {
    marginTop: 12,
    alignItems: "center",
  },
  liveLabel: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: "rgba(255,255,255,0.6)",
  },
  liveNumber: {
    marginTop: 2,
    fontSize: 40,
    fontWeight: "700",
    color: "#fff",
    fontVariant: ["tabular-nums"],
  },
  liveUnit: {
    fontSize: 18,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
  },
  link: {
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  linkText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#7fd6de",
  },
});
