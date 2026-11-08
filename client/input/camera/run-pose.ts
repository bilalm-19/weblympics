// Running on the spot in front of the camera (track, task 26). Pure: landmarks
// in, footfalls out, so it is unit tested on synthetic sequences
// (spec/track-run-pose.test.ts), like pose.ts and archery's bow.ts.
//
// Two modes, both built until a real-webcam playtest picks the default:
// - "knees": a knee rising above where it rests is a step on that side. Needs
//   the legs in frame, so the player stands back.
// - "elbows": arm pumps. A runner's hands swing in turn; a hand rising toward
//   its shoulder is a step on that side. Works at laptop distance.
//
// Each mode reduces a frame to one number per side: how far that side's
// knee (or hand) is lifted above its calibrated rest, in shoulder widths, so
// distance from the camera doesn't matter. A side crossing `liftOn` counts a
// step on that side once; it must drop back below `liftOff` before it can
// count again. The sim does the rest (alternation, the cadence cap), so a
// read here never has to be clever about cheating.
//
// Elbows mode counts a pump on either arm and labels the steps left, right,
// left... itself: arms drifting in sync (or one tired arm) would otherwise
// lose every other pump to the sim's same-foot rule. The sim's cap (10 a
// second) still bounds it, so this buys no speed a fair runner can't reach.
import { LM, bodyFrame } from "./pose.ts";
import type { Point } from "./pose.ts";

export type RunMode = "knees" | "elbows";
export type RunSide = "left" | "right";

// MediaPipe pose landmark indices pose.ts doesn't name
export const LEGS = { leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26 } as const;

const MIN_VISIBILITY = 0.5;
const seen = (p: Point | undefined): p is Point => p !== undefined && (p.visibility ?? 1) >= MIN_VISIBILITY;

export interface RunConfig {
  /** A side lifted this far above its rest (shoulder widths) is a step... */
  liftOn: number;
  /** ...and must come back below this before it can step again. */
  liftOff: number;
  /** Two steps on the same side closer than this (ms) are one wobble, not two. */
  minGapMs: number;
}

// GUESSES to be playtested on a real webcam, like the bow's and the swing's.
export const DEFAULT_RUN: Record<RunMode, RunConfig> = {
  // a jogging knee comes up a third of a shoulder width or more
  knees: { liftOn: 0.3, liftOff: 0.12, minGapMs: 150 },
  // a quick pump lifts the hand only a little (the swing is mostly toward the
  // camera): a fifth of a shoulder width. 0.4 was too much (playtest 2026-11-05).
  elbows: { liftOn: 0.2, liftOff: 0.08, minGapMs: 150 },
};

/** Where each side sits, standing still: the calibration. */
export interface RunRest {
  left: number;
  right: number;
}

/**
 * Each side's height for `mode`, in shoulder widths above the shoulder line
 * (so higher is bigger), or null when it can't be read. Knees need the hips
 * and knees seen; elbows need the wrists. The shoulders give the scale.
 */
export function runHeights(lm: readonly Point[], aspect: number, mode: RunMode): RunRest | null {
  const frame = bodyFrame(lm, aspect);
  if (!frame) return null;
  const ids = mode === "knees" ? [LEGS.leftKnee, LEGS.rightKnee] : [LM.leftWrist, LM.rightWrist];
  const [l, r] = ids.map((i) => lm[i]);
  if (!seen(l) || !seen(r)) return null;
  // image y points down; up is toward the shoulders
  const up = (p: Point) => (frame.mid.y - p.y) / frame.width;
  return { left: up(l), right: up(r) };
}

/** The rest heights from a few still frames (the median, so one bad frame doesn't skew it), or null if too few. */
export function restFrom(samples: readonly RunRest[], min = 5): RunRest | null {
  if (samples.length < min) return null;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { left: median(samples.map((s) => s.left)), right: median(samples.map((s) => s.right)) };
}

export interface RunStep {
  side: RunSide;
  /** The frame's time, ms. */
  t: number;
}

/**
 * Turns frames into footfalls. Each side is a small state machine: down,
 * then up past `liftOn` (a step), then back below `liftOff`. Frames it can't
 * read are skipped, keeping each side's state.
 */
export class RunTracker {
  private up: Record<RunSide, boolean> = { left: false, right: false };
  private last: Record<RunSide, number> = { left: -Infinity, right: -Infinity };
  // elbows mode: the side the next counted pump is sent as
  private next: RunSide = "left";
  rest: RunRest | null = null;
  /** The latest lift per side (shoulder widths above rest), for the panel's meter. */
  lift: RunRest = { left: 0, right: 0 };
  readonly mode: RunMode;
  private cfg: RunConfig;

  constructor(mode: RunMode, cfg: RunConfig = DEFAULT_RUN[mode]) {
    this.mode = mode;
    this.cfg = cfg;
  }

  reset(): void {
    this.up = { left: false, right: false };
    this.last = { left: -Infinity, right: -Infinity };
    this.next = "left";
    this.lift = { left: 0, right: 0 };
  }

  /** One frame's heights (from runHeights) at time `t`; returns a step if one landed. */
  update(h: RunRest | null, t: number): RunStep | null {
    if (!h || !this.rest) return null;
    let out: RunStep | null = null;
    for (const side of ["left", "right"] as const) {
      const lift = h[side] - this.rest[side];
      this.lift[side] = lift;
      if (!this.up[side] && lift >= this.cfg.liftOn) {
        this.up[side] = true;
        if (t - this.last[side] >= this.cfg.minGapMs && out === null) {
          this.last[side] = t;
          if (this.mode === "elbows") {
            out = { side: this.next, t };
            this.next = this.next === "left" ? "right" : "left";
          } else out = { side, t };
        }
      } else if (this.up[side] && lift < this.cfg.liftOff) this.up[side] = false;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Hurdles' jump (task 27; the control is the user's, 2026-11-08):
// - "elbows": both arms up at the same time. Both hands must be lifted
//   `armsOn` above their rest together; a running pump lifts one hand at a
//   time, and far less, so it never reads as a jump; one arm up isn't one.
// - "knees": jumping on the spot. The shoulder/hip midpoint rising quickly
//   (`riseSpeed`) past `riseOn` above where it stood in the stand-still
//   calibration. A jog bobs the body a little; it never gets that high.
// Both read once and must come back down (`armsOff` / `riseOff`) before the
// next. The step reads above are relative to the shoulders, so the body
// rising in a jump doesn't count as steps. All in shoulder widths.
// FIRST GUESSES, every number in DEFAULT_JUMP, until the recordings in
// docs/camera-playtest.md ("Hurdles' moves").

/** The shoulder/hip midpoint's height, image heights (down is bigger), and the shoulder width that scales it. */
export interface Torso {
  y: number;
  width: number;
}

/** The torso's midpoint and scale, or null without both shoulders and both hips seen. */
export function torsoOf(lm: readonly Point[], aspect: number): Torso | null {
  const frame = bodyFrame(lm, aspect);
  if (!frame) return null;
  const l = lm[LEGS.leftHip];
  const r = lm[LEGS.rightHip];
  if (!seen(l) || !seen(r)) return null;
  return { y: (frame.mid.y + (l.y + r.y) / 2) / 2, width: frame.width };
}

/** The standing torso from a few still frames (the median), or null if too few. */
export function torsoRestFrom(samples: readonly Torso[], min = 5): Torso | null {
  if (samples.length < min) return null;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { y: median(samples.map((s) => s.y)), width: median(samples.map((s) => s.width)) };
}

export interface JumpConfig {
  /** elbows: both hands lifted this far above rest together is a jump... */
  armsOn: number;
  /** ...and both must drop below this before the next. */
  armsOff: number;
  /** knees: the torso this far above its standing height... */
  riseOn: number;
  /** ...rising at least this fast (shoulder widths a second, over the last `speedMs`)... */
  riseSpeed: number;
  speedMs: number;
  /** ...and back below this before the next. */
  riseOff: number;
  /** Two jumps closer than this (ms) are one. */
  minGapMs: number;
}

// GUESSES until the recordings. A running pump lifts a hand 0.2 to 0.8
// shoulder widths; arms up for a jump bring both hands above the chest. A
// jog bobs the torso under a tenth of a shoulder width.
export const DEFAULT_JUMP: JumpConfig = { armsOn: 1.2, armsOff: 0.6, riseOn: 0.25, riseSpeed: 1.5, speedMs: 150, riseOff: 0.1, minGapMs: 400 };

/** What the jump reads from a frame: the hands' heights (runHeights, elbows) and the torso. */
export interface JumpFrame {
  arms: RunRest | null;
  torso: Torso | null;
}

/** Turns frames into jumps for one mode. Frames it can't read are skipped. */
export class JumpTracker {
  readonly mode: RunMode;
  private cfg: JumpConfig;
  /** The stand-still calibration: the hands' rest (elbows) and the standing torso (knees). */
  rest: { arms: RunRest | null; torso: Torso | null } = { arms: null, torso: null };
  /** The latest reading, 0..1 of the way to a jump, for the panel's meter. */
  level = 0;
  private up = false;
  private last = -Infinity;
  private history: Array<{ t: number; rise: number }> = [];

  constructor(mode: RunMode, cfg: JumpConfig = DEFAULT_JUMP) {
    this.mode = mode;
    this.cfg = cfg;
  }

  reset(): void {
    this.up = false;
    this.last = -Infinity;
    this.history = [];
    this.level = 0;
  }

  /** One frame at time `t` (ms); true if a jump read on it. */
  update(f: JumpFrame, t: number): boolean {
    return this.mode === "elbows" ? this.arms(f.arms, t) : this.body(f.torso, t);
  }

  private fire(t: number): boolean {
    this.up = true;
    if (t - this.last < this.cfg.minGapMs) return false;
    this.last = t;
    return true;
  }

  private arms(h: RunRest | null, t: number): boolean {
    const rest = this.rest.arms;
    if (!h || !rest) return false;
    const l = h.left - rest.left;
    const r = h.right - rest.right;
    // the lower hand decides: one arm up, however high, is not a jump
    const both = Math.min(l, r);
    this.level = Math.max(0, Math.min(1, both / this.cfg.armsOn));
    if (!this.up && both >= this.cfg.armsOn) return this.fire(t);
    if (this.up && Math.max(l, r) < this.cfg.armsOff) this.up = false;
    return false;
  }

  private body(torso: Torso | null, t: number): boolean {
    const rest = this.rest.torso;
    if (!torso || !rest) return false;
    // image y points down: standing higher than at rest is a positive rise
    const rise = (rest.y - torso.y) / rest.width;
    this.level = Math.max(0, Math.min(1, rise / this.cfg.riseOn));
    this.history.push({ t, rise });
    while (this.history.length > 1 && t - this.history[0].t > this.cfg.speedMs) this.history.shift();
    const first = this.history[0];
    const speed = t > first.t ? ((rise - first.rise) * 1000) / (t - first.t) : 0;
    if (!this.up && rise >= this.cfg.riseOn && speed >= this.cfg.riseSpeed) return this.fire(t);
    if (this.up && rise < this.cfg.riseOff) this.up = false;
    return false;
  }
}
