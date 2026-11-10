/**
 * How a guided-measurement animation plays, read from the file's own markers.
 *
 * Every animation in src/assets/guided carries named markers (end exclusive:
 * tm + dr), agreed in the animation brief:
 *   intro  — plays once
 *   loop   — repeats until the device (or the patient) moves the step on
 *   outro  — plays once
 *
 * A file with intro + loop plays the intro, then repeats only the loop. A file
 * with just an intro or just an outro plays once and HOLDS its last frame. A
 * loop-only file loops from the start.
 *
 * Ranges are INCLUSIVE frames [first, last] — what both native players take in
 * play(start, end). Two details matter:
 *  - A loop's first and last frames are drawn identically, so wrapping from
 *    last back to first is seamless.
 *  - A hold ends on the last DRAWN frame, never on `op`: at frame `op` a layer
 *    whose out-point is `op` is no longer drawn, and the picture would vanish.
 *
 * Pure: no React Native imports, so it is unit-tested against the real files.
 */

export type LottieMarker = { cm: string; tm: number; dr: number };
export type LottieTiming = { ip?: number; op: number; fr?: number; markers?: LottieMarker[] };
export type FrameRange = readonly [number, number];

export type PlaybackPlan =
  | { kind: "introThenLoop"; intro: FrameRange; loop: FrameRange; still: number }
  | { kind: "loop"; loop: FrameRange; still: number }
  | { kind: "once"; once: FrameRange; still: number };

function markerRange(m: LottieMarker | undefined, ip: number, op: number): FrameRange | null {
  if (!m || !Number.isFinite(m.tm) || !Number.isFinite(m.dr)) return null;
  const first = Math.max(ip, Math.round(m.tm));
  const last = Math.min(op - 1, Math.round(m.tm + m.dr) - 1);
  return last > first ? [first, last] : null;
}

/**
 * The playback for one animation. `still` is the single frame shown when the
 * phone asks for reduced motion: the waiting pose for a loop, the final pose
 * for a one-shot.
 */
export function planPlayback(anim: LottieTiming): PlaybackPlan {
  const ip = Number.isFinite(anim.ip) ? Number(anim.ip) : 0;
  const op = anim.op;
  const find = (name: string) => (anim.markers || []).find((m) => m?.cm === name);

  const intro = markerRange(find("intro"), ip, op);
  const loop = markerRange(find("loop"), ip, op);
  const outro = markerRange(find("outro"), ip, op);

  if (intro && loop) return { kind: "introThenLoop", intro, loop, still: loop[0] };
  if (loop) return { kind: "loop", loop, still: loop[0] };
  const once: FrameRange = intro ?? outro ?? [ip, Math.max(ip, op - 1)];
  return { kind: "once", once, still: once[1] };
}

/** A frame as the 0–1 progress the player's `progress` prop expects. */
export function progressAt(anim: LottieTiming, frame: number): number {
  const ip = Number.isFinite(anim.ip) ? Number(anim.ip) : 0;
  const span = anim.op - ip;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (frame - ip) / span));
}
