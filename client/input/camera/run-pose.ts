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
