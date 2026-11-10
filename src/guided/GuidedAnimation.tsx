/**
 * Plays one guided-measurement animation inside a light, rounded card.
 *
 * Playback comes from the file's own markers (see playback.ts): intro then a
 * repeating loop, a loop from the start, or a single play that holds its last
 * frame. The card only animates — it never decides when a step is over; the
 * screen does that from real device events or the patient's taps.
 *
 * The card is light because the animations are drawn for a light background
 * (navy outlines, pale surfaces). It clips its content: arms and hands run off
 * the 1080 canvas by design and must end at the card edge, not mid-screen.
 *
 * Reduced motion (an accessibility setting on both phones) shows one still
 * frame instead: the waiting pose for a loop, the final pose for a one-shot.
 * The animation is decorative for screen readers — the text under it is the
 * instruction.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import LottieView from "lottie-react-native";

import { loadAnimation, type AnimationName } from "./animations";
import { planPlayback, progressAt } from "./playback";

export const GUIDE_CARD_BACKGROUND = "#F4F8FA";

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(Boolean(v));
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) =>
      setReduce(Boolean(v))
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

type Props = {
  name: AnimationName;
  /** Edge length of the square card, in points. */
  size: number;
  style?: StyleProp<ViewStyle>;
};

function GuidedAnimation({ name, size, style }: Props) {
  const reduceMotion = useReduceMotion();
  return (
    <View
      style={[
        styles.card,
        { width: size, height: size, borderRadius: Math.round(size * 0.08) },
        style,
      ]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* A new animation (or a change of motion setting) is a fresh player:
          its playback state never carries over from the previous step. */}
      <Player key={`${name}:${reduceMotion ? "still" : "play"}`} name={name} still={reduceMotion} />
    </View>
  );
}

const Player = memo(function Player({ name, still }: { name: AnimationName; still: boolean }) {
  const source = useMemo(() => loadAnimation(name), [name]);
  const plan = useMemo(() => planPlayback(source), [source]);
  const ref = useRef<LottieView>(null);
  const started = useRef(false);
  // The `loop` prop must already be on when the loop segment is played: both
  // players read it at the moment play() is called.
  const [looping, setLooping] = useState(plan.kind === "loop");

  const start = useCallback(() => {
    if (still || started.current || !ref.current) return;
    started.current = true;
    if (plan.kind === "loop") ref.current.play(plan.loop[0], plan.loop[1]);
    else if (plan.kind === "introThenLoop") ref.current.play(plan.intro[0], plan.intro[1]);
    else ref.current.play(plan.once[0], plan.once[1]);
  }, [plan, still]);

  // iOS builds the animation the moment the source prop arrives and does not
  // reliably send onAnimationLoaded for an embedded file, so playback starts
  // here; Android queues this request until the file is parsed. Whichever of
  // this and onAnimationLoaded comes first starts it; the other is ignored.
  useEffect(() => {
    const id = requestAnimationFrame(start);
    return () => cancelAnimationFrame(id);
  }, [start]);

  // Intro finished: repeat just the loop. Props reach the native view before
  // commands sent in the same update, so `loop` is on when this runs.
  useEffect(() => {
    if (!looping || still || plan.kind !== "introThenLoop") return;
    ref.current?.play(plan.loop[0], plan.loop[1]);
  }, [looping, plan, still]);

  const onFinish = useCallback(
    (isCancelled: boolean) => {
      // Cancelled = interrupted (a new play, unmount): not the end of the intro.
      if (isCancelled) return;
      if (plan.kind === "introThenLoop") setLooping(true);
    },
    [plan]
  );

  return (
    <LottieView
      ref={ref}
      source={source as any}
      style={StyleSheet.absoluteFill}
      resizeMode="contain"
      autoPlay={false}
      loop={looping}
      progress={still ? progressAt(source, plan.still) : undefined}
      onAnimationLoaded={start}
      onAnimationFinish={onFinish}
    />
  );
});

export default memo(GuidedAnimation);

const styles = StyleSheet.create({
  card: {
    backgroundColor: GUIDE_CARD_BACKGROUND,
    overflow: "hidden",
  },
});
