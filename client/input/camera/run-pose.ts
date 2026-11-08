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
// Each mode reduces a frame to one number per side: how high that side's
// knee (or hand) is, in shoulder widths, so distance from the camera doesn't
// matter. A step is measured from that side's own recent low point, not from
// the stand-still calibration (playtest 2026-11-08: hands held higher than at
// calibration, a rest saved on the account from another day, never re-armed).
// Each side: armed, it follows its lowest height (creeping up slowly when the
// hands settle higher); rising `liftOn` above that low is a step; it re-arms
// once it falls back `reArm` from its peak, and its low starts again there.
// So a quick pump counts wherever the hands are held, and the calibration is
// only the starting low. The sim does the rest (alternation, the cadence cap),
// so a read here never has to be clever about cheating.
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

/** How one side's recent low is kept (`RiseMeter`), shared by the steps and the jump. */
export interface RiseConfig {
  /** Fired, a side re-arms once it falls this far (shoulder widths) from the top of its rise... */
  reArm: number;
  /** ...or once it has held still near the top this long (ms): hands that rise and stay put re-arm where they are. */
  holdMs: number;
  /** Armed, the low follows the side down at once but up at most this fast (shoulder widths a second), so hands settling higher never step and a pump does. */
  creep: number;
  /** A side unseen this long (ms) starts again from where it is next seen. */
  lostMs: number;
}

export interface RunConfig extends RiseConfig {
  /** A side rising this far above its own recent low (shoulder widths) is a step. */
  liftOn: number;
  /** Two steps on the same side closer than this (ms) are one wobble, not two. */
  minGapMs: number;
}

// GUESSES until the recordings (docs/camera-playtest.md, "Track's moves").
// Until 2026-11-08 a step was a side `liftOn` above the stand-still rest and
// re-armed only below `liftOff` above it (elbows 0.2 / 0.08, knees 0.3 / 0.12),
// so hands held higher than at calibration never re-armed.
export const DEFAULT_RUN: Record<RunMode, RunConfig> = {
  // a jogging knee comes up a third of a shoulder width or more
  knees: { liftOn: 0.25, reArm: 0.1, holdMs: 300, creep: 0.2, lostMs: 1000, minGapMs: 150 },
  // a quick pump lifts the hand only a little (the swing is mostly toward the
  // camera). 0.4 above rest was too much (playtest 2026-11-05) and 0.2 above
  // rest missed pumps with the hands held high (2026-11-08): now 0.15 from the
  // pump's own low, re-armed 0.07 down from its top.
  elbows: { liftOn: 0.15, reArm: 0.07, holdMs: 300, creep: 0.2, lostMs: 1000, minGapMs: 150 },
};

/** A new peak must beat the old by this much (shoulder widths) to restart the hold clock: landmark jitter isn't a rise. */
const PEAK_EPS = 0.02;

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
 * One side's recent low point and its rise above it (a hand, a knee, the
 * torso), so a move is measured from wherever that side is held, not from a
 * calibration. Armed, `low` follows the side down at once and up at most
 * `creep` a second; the owner decides when the rise is a move and calls
 * `fire`. Fired, it re-arms once the side falls `reArm` from the top of its
 * rise or holds near the top for `holdMs`, and the low starts again there.
 */
export class RiseMeter {
  /** The recent low, or null before the first frame (or a starting low, from a calibration). */
  low: number | null = null;
  /** Fired and not yet re-armed. */
  up = false;
  /** The latest height above the low. */
  lift = 0;
  private peak = -Infinity;
  private peakAt = -Infinity;
  private seenAt = -Infinity;
  private cfg: RiseConfig;

  constructor(cfg: RiseConfig) {
    this.cfg = cfg;
  }

  /** Starts again from `low` (a calibration), or from the next frame seen. */
  reset(low: number | null = null): void {
    this.low = low;
    this.up = false;
    this.lift = 0;
    this.peak = -Infinity;
    this.peakAt = -Infinity;
    this.seenAt = -Infinity;
  }

  /** One frame's height at `t` ms; returns the lift above the recent low. */
  update(h: number, t: number): number {
    const { reArm, holdMs, creep, lostMs } = this.cfg;
    const gap = this.seenAt === -Infinity ? 0 : t - this.seenAt;
    if (this.low === null || gap > lostMs) {
      this.low = h;
      this.up = false;
    }
    this.seenAt = t;
    if (this.up) {
      if (h >= this.peak + PEAK_EPS) {
        this.peak = h;
        this.peakAt = t;
      } else this.peak = Math.max(this.peak, h);
      if (h <= this.peak - reArm || t - this.peakAt >= holdMs) {
        this.up = false;
        this.low = h;
      }
    } else this.low = Math.min(h, this.low + (creep * gap) / 1000);
    this.lift = h - this.low;
    return this.lift;
  }

  /** The owner read a move at height `h`: wait for the fall (or the hold) before the next. */
  fire(h: number, t: number): void {
    this.up = true;
    this.peak = h;
    this.peakAt = t;
  }
}

/**
 * Turns frames into footfalls. Each side is a `RiseMeter`: rising `liftOn`
 * from its own recent low is a step; it must fall back `reArm` (or hold
 * still) before the next. Frames it can't read are skipped, keeping each
 * side's state. The stand-still calibration (`rest`) is only each side's
 * starting low; without one it starts from the first frame it sees.
 */
export class RunTracker {
  private meters: Record<RunSide, RiseMeter>;
  private last: Record<RunSide, number> = { left: -Infinity, right: -Infinity };
  // elbows mode: the side the next counted pump is sent as
  private next: RunSide = "left";
  private start: RunRest | null = null;
  /** The latest lift per side (shoulder widths above its recent low), for the panel's meter. */
  lift: RunRest = { left: 0, right: 0 };
  readonly mode: RunMode;
  readonly cfg: RunConfig;

  constructor(mode: RunMode, cfg: RunConfig = DEFAULT_RUN[mode]) {
    this.mode = mode;
    this.cfg = cfg;
    this.meters = { left: new RiseMeter(cfg), right: new RiseMeter(cfg) };
  }

  /** The stand-still calibration: each side's starting low. Setting it starts the tracker again from it. */
  get rest(): RunRest | null {
    return this.start;
  }
  set rest(r: RunRest | null) {
    this.start = r;
    this.reset();
  }

  /** A side's recent low (shoulder widths above the shoulder line), for the `?debug` readout. */
  low(side: RunSide): number | null {
    return this.meters[side].low;
  }

  reset(): void {
    for (const side of ["left", "right"] as const) this.meters[side].reset(this.start ? this.start[side] : null);
    this.last = { left: -Infinity, right: -Infinity };
    this.next = "left";
    this.lift = { left: 0, right: 0 };
  }

  /** One frame's heights (from runHeights) at time `t`; returns a step if one landed. */
  update(h: RunRest | null, t: number): RunStep | null {
    if (!h) return null;
    let out: RunStep | null = null;
    for (const side of ["left", "right"] as const) {
      const m = this.meters[side];
      const lift = m.update(h[side], t);
      this.lift[side] = lift;
      if (m.up || lift < this.cfg.liftOn) continue;
      m.fire(h[side], t);
      if (t - this.last[side] < this.cfg.minGapMs || out !== null) continue;
      this.last[side] = t;
      if (this.mode === "elbows") {
        out = { side: this.next, t };
        this.next = this.next === "left" ? "right" : "left";
      } else out = { side, t };
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Hurdles' jump (task 27; the control is the user's, 2026-11-08):
// - "elbows": both arms up at the same time. Both hands rising `armsOn` above
//   their own recent lows together, neither falling, is a jump. A running pump
//   lifts one hand at a time (the other is at its low), and where swinging
//   arms pass each other one of them is falling, so pumps never read as a
//   jump; one arm up isn't one.
// - "knees": jumping on the spot. The shoulder/hip midpoint rising quickly
//   (`riseSpeed`) past `riseOn` above its own recent low. A jog bobs the body
//   a little and never gets that high; rising slowly on tiptoe is followed by
//   the low, so it never gets that far above it.
// Each reads once, then re-arms when it comes back down (`RiseConfig.reArm`)
// or is held still. Measured from recent lows like the steps (playtest
// 2026-11-08: the arms had to go 1.2 shoulder widths above the stand-still
// rest, so jumps barely registered); the calibration is only the starting
// low. The step reads above are relative to the shoulders, so the body rising
// in a jump doesn't count as steps. All in shoulder widths.
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

/** The torso's height in shoulder widths of `width` (up is bigger), what the knees-mode jump follows. */
const torsoHeight = (t: Torso, width = t.width): number => -t.y / width;

export interface JumpConfig {
  /** elbows: both hands this far above their own recent lows together is a jump... */
  armsOn: number;
  /** ...unless either hand is falling faster than this (shoulder widths a second, over `speedMs`): swinging arms crossing. */
  armsFall: number;
  /** elbows: how each hand's low is kept (re-armed `reArm` down from the top, or held still). */
  arms: RiseConfig;
  /** knees: the torso this far above its own recent low... */
  riseOn: number;
  /** ...rising at least this fast (shoulder widths a second, over the last `speedMs`). */
  riseSpeed: number;
  speedMs: number;
  /** knees: how the torso's low is kept. */
  torso: RiseConfig;
  /** Two jumps closer than this (ms) are one. */
  minGapMs: number;
}

// GUESSES until the recordings. Until 2026-11-08: both hands 1.2 above the
// stand-still rest, re-armed below 0.6 (too high, playtest 2026-11-08); the
// torso 0.25 above its standing height at 1.5 a second, re-armed below 0.1.
// A small quick pump lifts one hand 0.15 to 0.5 from its low; arms thrown up
// bring both hands well past 0.6. A jog bobs the torso under a tenth of a
// shoulder width; a hop lifts it a third or more, fast.
export const DEFAULT_JUMP: JumpConfig = {
  armsOn: 0.6,
  armsFall: 0.5,
  arms: { reArm: 0.3, holdMs: 600, creep: 0.1, lostMs: 1000 },
  riseOn: 0.2,
  riseSpeed: 1.2,
  speedMs: 150,
  torso: { reArm: 0.1, holdMs: 600, creep: 0.2, lostMs: 1000 },
  minGapMs: 400,
};

/** What the jump reads from a frame: the hands' heights (runHeights, elbows) and the torso. */
export interface JumpFrame {
  arms: RunRest | null;
  torso: Torso | null;
}

/** Recent heights, for a speed over the last `ms`. */
class Recent {
  private xs: Array<{ t: number; v: number }> = [];

  /** Adds a height at `t` ms; returns the speed (a second) since the oldest kept. */
  push(v: number, t: number, ms: number): number {
    this.xs.push({ t, v });
    while (this.xs.length > 1 && t - this.xs[0].t > ms) this.xs.shift();
    const first = this.xs[0];
    return t > first.t ? ((v - first.v) * 1000) / (t - first.t) : 0;
  }

  clear(): void {
    this.xs = [];
  }
}

/** Turns frames into jumps for one mode. Frames it can't read are skipped. */
export class JumpTracker {
  readonly mode: RunMode;
  readonly cfg: JumpConfig;
  private start: { arms: RunRest | null; torso: Torso | null } = { arms: null, torso: null };
  /** The latest reading, 0..1 of the way to a jump, for the panel's meter. */
  level = 0;
  /** elbows: the lower hand's lift above its low; knees: the torso's (shoulder widths), for the `?debug` readout. */
  lift = 0;
  /** knees: the torso's upward speed (shoulder widths a second), for the readout. */
  speed = 0;
  private hands: Record<RunSide, RiseMeter>;
  private handSpeed: Record<RunSide, Recent> = { left: new Recent(), right: new Recent() };
  private body: RiseMeter;
  private bodySpeed = new Recent();
  private last = -Infinity;

  constructor(mode: RunMode, cfg: JumpConfig = DEFAULT_JUMP) {
    this.mode = mode;
    this.cfg = cfg;
    this.hands = { left: new RiseMeter(cfg.arms), right: new RiseMeter(cfg.arms) };
    this.body = new RiseMeter(cfg.torso);
  }

  /** The stand-still calibration: the hands' (elbows) and the torso's (knees) starting lows. Setting it starts again from it. */
  get rest(): { arms: RunRest | null; torso: Torso | null } {
    return this.start;
  }
  set rest(r: { arms: RunRest | null; torso: Torso | null }) {
    this.start = r;
    this.reset();
  }

  reset(): void {
    for (const side of ["left", "right"] as const) {
      this.hands[side].reset(this.start.arms ? this.start.arms[side] : null);
      this.handSpeed[side].clear();
    }
    this.body.reset(this.start.torso ? torsoHeight(this.start.torso) : null);
    this.bodySpeed.clear();
    this.last = -Infinity;
    this.level = 0;
    this.lift = 0;
    this.speed = 0;
  }

  /** One frame at time `t` (ms); true if a jump read on it. */
  update(f: JumpFrame, t: number): boolean {
    return this.mode === "elbows" ? this.arms(f.arms, t) : this.hop(f.torso, t);
  }

  private fire(t: number): boolean {
    if (t - this.last < this.cfg.minGapMs) return false;
    this.last = t;
    return true;
  }

  private arms(h: RunRest | null, t: number): boolean {
    if (!h) return false;
    const { left, right } = this.hands;
    const l = left.update(h.left, t);
    const r = right.update(h.right, t);
    const vl = this.handSpeed.left.push(h.left, t, this.cfg.speedMs);
    const vr = this.handSpeed.right.push(h.right, t, this.cfg.speedMs);
    // the lower hand decides: one arm up, however high, is not a jump
    this.lift = Math.min(l, r);
    this.level = Math.max(0, Math.min(1, this.lift / this.cfg.armsOn));
    if (left.up || right.up || this.lift < this.cfg.armsOn) return false;
    // swinging arms pass each other with one of them falling; a jump lifts both
    if (Math.min(vl, vr) < -this.cfg.armsFall) return false;
    left.fire(h.left, t);
    right.fire(h.right, t);
    return this.fire(t);
  }

  private hop(torso: Torso | null, t: number): boolean {
    if (!torso) return false;
    // scaled by the calibration's width when there is one, so the scale doesn't wobble mid-jump
    const height = torsoHeight(torso, this.start.torso?.width ?? torso.width);
    const rise = this.body.update(height, t);
    this.speed = this.bodySpeed.push(height, t, this.cfg.speedMs);
    this.lift = rise;
    this.level = Math.max(0, Math.min(1, rise / this.cfg.riseOn));
    if (this.body.up || rise < this.cfg.riseOn || this.speed < this.cfg.riseSpeed) return false;
    this.body.fire(height, t);
    return this.fire(t);
  }
}
