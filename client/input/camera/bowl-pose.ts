import { LM, OneEuro, bodyFrame, wrist } from "./pose.ts";
import type { BodyFrame, Point } from "./pose.ts";

// Bowling's camera (task 29, ADR 004): pose landmarks to the two things a
// bowler says, `aim` and `throw`. Pure: no DOM, no MediaPipe, unit tested on
// synthetic landmark streams (spec/bowling-bowl-pose.test.ts).
//
// - Aim: the bowling hand's position across the whole picture (not against
//   the shoulders), so walking, shifting and moving the hand all move it;
//   mirrored so the player's right aims right; -1..1; live. It locks when the
//   swing starts: the value just before the wrist began swinging.
// - Throw (the release): a wrist that was below the hip line rising back past
//   it (the arm coming forward past the hip), faster than a threshold. Speeds
//   are in shoulder widths a second against the shoulders, so a step towards
//   the camera or a crouch doesn't change the read. Its speed there is the
//   ball's speed. From the front a backswing also rises past the hip, so a
//   rise counts when the arm came down through the line just before it (the
//   forward swing after a backswing) or, with no backswing, when the model's
//   depth puts the wrist in front of the hips; a rise the depth puts behind
//   them never counts. Either hand; whichever crosses first.
// - Curve: the wrist's sideways sweep against the shoulders over a short
//   window around the release, scaled to spin -1..1 and locked after it, so
//   the follow-through and any later "steering" add nothing.
// - Fallback when the hips aren't seen (the shoulders are): the same rise
//   past a chest line instead, any rise counting as forward (the bottom of
//   the swing may be below the picture), and the read says so ("stand back").
// - One throw a turn, nothing off-turn, and a wrist (or the shoulders) lost
//   before the release never fires.
//
// Sides come from MediaPipe's left/right labels; the picture x is the raw
// camera image (the preview's mirror is CSS only), where the player's right
// is the image's left.

export type BowlHand = "left" | "right";

export interface BowlConfig {
  /** Picture x from the middle (share of the width) that gives full aim. */
  aimHalf: number;
  /** Aim inside this is straight. */
  aimDead: number;
  /** A wrist must have been this far below the line (shoulder widths) to count as coming up past it. */
  armBelow: number;
  /** ...this recently; and the arm must have come down through the line this recently (the pendulum's bottom). */
  armMemoryMs: number;
  /** Least speed (shoulder widths a second, against the shoulders) at the crossing for a throw. */
  minSpeed: number;
  /** Crossing speeds giving speed 0 and speed 1. */
  speed0: number;
  speed1: number;
  /** The fallback's line: this far below the shoulder line (shoulder widths), used when the hips aren't seen. */
  chestDown: number;
  /** A wrist this far behind the hips (model depth, shoulder widths) is a backswing, not a release. */
  behindZ: number;
  /** A wrist this far in front of the hips is coming forward: a release with no backswing before it. */
  frontZ: number;
  /** The curve window around the release, ms (half before, half after). */
  curveWindowMs: number;
  /** A sweep (shoulder widths over the window) inside this is straight. */
  sweepDead: number;
  /** A sweep giving full spin. */
  sweepFull: number;
  /** Up or down speed of a wrist (shoulder widths a second) that counts as swinging, for the aim lock. */
  swingVert: number;
  /** A swing pausing (at the top of the backswing) shorter than this is still one swing. */
  swingPauseMs: number;
  /** Speeds are measured over at least this span, so one jittery frame can't make a swing. */
  speedSpanMs: number;
  /** Frames further apart than this lose the swing (the camera stalled). */
  maxGapMs: number;
  /** A wrist must have been seen without a break this long before its crossing counts (one lost mid-swing doesn't fire). */
  seenMs: number;
}

// FIRST GUESSES, every one, until the ten recordings in task 29
// (docs/camera-playtest.md, "Bowling's moves") replace them. Reasoning: an
// arm is about 1.7 shoulder widths and the hips about 1.3 below the shoulder
// line, so a wrist swinging forward crosses the hip line about 40 degrees past
// the bottom, where its speed against the shoulders is about 0.65 of the
// hand's. A medium forward swing (0.5 s from the top of the backswing to the
// follow-through) reads about 6.5 a second there, a slow one (0.8 s) about 4,
// a fast one (0.3 s) about 11. Raising your arms to stretch starts from rest
// at your sides, so it is still slow (about 3) when it passes the hips: the
// throw needs 3.5. From the front the backswing rises past the hips too, so
// the release is the rise that follows the arm coming down through the line
// (the pendulum's bottom); a rise from rest counts only if the model's depth
// puts the wrist in front of the hips (0.3 shoulder widths; at the hip line a
// swinging wrist is about 1 in front or behind). Over the 150 ms curve window
// a medium swing travels about 1 shoulder width, so a natural follow-through
// drifting towards the middle moves the wrist about 0.15 across: the dead
// zone is 0.25, and a deliberate sweep of 0.7 is full spin.
export const DEFAULT_BOWL: BowlConfig = {
  aimHalf: 0.3,
  aimDead: 0.03,
  armBelow: 0.05,
  armMemoryMs: 600,
  minSpeed: 3.5,
  speed0: 3,
  speed1: 12,
  chestDown: 0.6,
  behindZ: 0.3,
  frontZ: 0.3,
  curveWindowMs: 150,
  sweepDead: 0.25,
  sweepFull: 0.7,
  swingVert: 2,
  swingPauseMs: 200,
  speedSpanMs: 50,
  maxGapMs: 250,
  seenMs: 120,
};

/** MediaPipe's hip landmarks. */
export const HIPS = [23, 24] as const;
const HANDS: readonly BowlHand[] = ["left", "right"];
const HAND_VISIBILITY = 0.3;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const inFrame = (p: Point | undefined, minVis: number): p is Point =>
  p !== undefined && (p.visibility ?? 1) >= minVis && p.y >= 0 && p.y <= 1 && p.x >= 0 && p.x <= 1;

/** A raw picture x (0..1, the camera's own, unmirrored) to aim: the player's right (image left) is positive. */
export function aimFromX(x: number, cfg: BowlConfig = DEFAULT_BOWL): number {
  const a = 0.5 - x;
  const past = Math.max(0, Math.abs(a) - cfg.aimDead);
  if (past === 0) return 0;
  return Math.sign(a) * clamp(past / (cfg.aimHalf - cfg.aimDead), 0, 1);
}

/** Crossing speed (shoulder widths a second) to the throw's speed, 0..1. */
export function speedFrom(v: number, cfg: BowlConfig = DEFAULT_BOWL): number {
  return clamp((v - cfg.speed0) / (cfg.speed1 - cfg.speed0), 0, 1);
}

/**
 * A sweep along the shoulder line (shoulder widths, positive towards the
 * player's left, as `wrist().across`) to spin: sweeping to your right curves
 * right (positive, the sim's +x).
 */
export function spinFromSweep(sweep: number, cfg: BowlConfig = DEFAULT_BOWL): number {
  const s = -sweep;
  const past = Math.max(0, Math.abs(s) - cfg.sweepDead);
  if (past === 0) return 0;
  return Math.sign(s) * clamp(past / (cfg.sweepFull - cfg.sweepDead), 0, 1);
}

/** A landmark below the shoulder line, in shoulder widths (negative above it). */
function downOf(p: Point, frame: BodyFrame, aspect: number): number {
  const v = { x: (p.x * aspect - frame.mid.x) / frame.width, y: (p.y - frame.mid.y) / frame.width };
  const u = frame.across;
  const d = u.x >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
  return v.x * d.x + v.y * d.y;
}

export interface BowlHandRead {
  /** Below the shoulder line, shoulder widths (negative above it). */
  down: number;
  /** Along the shoulder line from the middle, shoulder widths, positive to the player's left. */
  across: number;
  /** Raw picture x, 0..1. */
  x: number;
  /** Depth against the hips, shoulder widths, positive behind them (null if the model gave none). */
  z: number | null;
  /** Speed against the shoulders, shoulder widths a second (null until there are two samples). */
  speed: number | null;
  /** Upward speed against the shoulders (negative falling). */
  up: number | null;
  /** Sideways movement over the last curve window, shoulder widths (positive to the player's left). */
  sweep: number | null;
}

/** A wrist coming up past the line, whatever its speed (the debug readout keeps them all). */
export interface BowlCrossing {
  hand: BowlHand;
  speed: number;
  z: number | null;
  /** Behind the hips by the model's depth: a backswing. */
  behind: boolean;
  /** After the arm came down through the line (or in front by depth): a forward swing. */
  forward: boolean;
  /** It counted as the release. */
  released: boolean;
}

export interface BowlThrow {
  /** 0..1 from the crossing speed. */
  speed: number;
  /** -1..1, locked when the swing began. */
  aim: number;
  /** -1..1 from the sweep in the window. */
  spin: number;
  /** The crossing speed itself, shoulder widths a second. */
  raw: number;
  /** The sweep in the window, shoulder widths, positive to the player's left. */
  sweep: number;
  hand: BowlHand;
  /** Read against the chest line (no hips seen). */
  fallback: boolean;
  /** When the wrist crossed. */
  at: number;
}

export type BowlState = "lost" | "off-turn" | "aiming" | "swinging" | "released" | "thrown";

export interface BowlRead {
  /** The shoulders are seen. */
  tracking: boolean;
  hipsSeen: boolean;
  /** Shoulders seen, hips not: the chest line is used ("stand back so we see your hips"). */
  fallback: boolean;
  /** The line a release crosses, below the shoulder line in shoulder widths (the hips, or the chest). */
  line: number | null;
  hands: Record<BowlHand, BowlHandRead | null>;
  /** Aim, -1..1, positive to the player's right; frozen at the swing's start while swinging. */
  aim: number;
  swinging: boolean;
  /** A wrist came up past the line this frame. */
  crossing: BowlCrossing | null;
  /** A throw this frame (once a turn, on turn only), emitted when the curve window closes. */
  throw: BowlThrow | null;
  state: BowlState;
}

export interface BowlFrame {
  t: number;
  landmarks: readonly Point[] | null;
  aspect: number;
}

interface Sample {
  t: number;
  down: number;
  across: number;
}

class HandTrack {
  history: Sample[] = [];
  seenSince: number | null = null;
  armedAt = -Infinity;
  /** When the wrist last came down through the line, fast: a rise soon after is the forward swing. */
  downAt = -Infinity;
  fastAt = -Infinity;
  swingStartT = -Infinity;
  swingAim: number | null = null;
  aimFilter = new OneEuro(1, 0.5);
  aim: number | null = null;
  aims: { t: number; aim: number }[] = [];

  /** Lost: the swing is forgotten (the aim's filter too, so it doesn't drag from where the hand was). */
  reset(): void {
    this.history = [];
    this.seenSince = null;
    this.armedAt = -Infinity;
    this.downAt = -Infinity;
    this.fastAt = -Infinity;
    this.swingStartT = -Infinity;
    this.swingAim = null;
    this.aimFilter.reset();
    this.aims = [];
  }
}

interface Pending {
  hand: BowlHand;
  raw: number;
  aim: number;
  at: number;
  emitAt: number;
  fromAcross: number;
  lastAcross: number;
  fallback: boolean;
}

/**
 * Aim and the throw from a stream of pose frames. `setTurn(true)` after
 * `false` starts a turn: one throw is allowed in it.
 */
export class BowlDetector {
  cfg: BowlConfig;
  private tracks: Record<BowlHand, HandTrack> = { left: new HandTrack(), right: new HandTrack() };
  /** The hand the arrow follows: the one that threw last (right until then). */
  private hand: BowlHand = "right";
  private aim = 0;
  private mine = false;
  private thrown = false;
  private pending: Pending | null = null;
  private turnAt = -Infinity;
  private turnPending = false;
  private lastT: number | null = null;

  constructor(cfg: BowlConfig = DEFAULT_BOWL) {
    this.cfg = cfg;
  }

  /** Whose turn it is. Going from not mine to mine starts a fresh turn. */
  setTurn(mine: boolean): void {
    if (mine && !this.mine) this.newTurn();
    if (!mine) this.pending = null;
    this.mine = mine;
  }

  /** A fresh turn: one throw allowed again, any swing under way forgotten. */
  newTurn(): void {
    this.thrown = false;
    this.pending = null;
    this.turnPending = true;
  }

  get turn(): boolean {
    return this.mine;
  }

  reset(): void {
    for (const h of HANDS) this.tracks[h].reset();
    this.pending = null;
    this.aim = 0;
    this.lastT = null;
  }

  update(f: BowlFrame): BowlRead {
    const cfg = this.cfg;
    if (this.turnPending) {
      this.turnAt = f.t;
      this.turnPending = false;
    }
    // a stalled camera: whatever was swinging is forgotten
    if (this.lastT !== null && f.t - this.lastT > cfg.maxGapMs) for (const h of HANDS) this.tracks[h].reset();
    this.lastT = f.t;

    const lm = f.landmarks;
    const frame = lm ? bodyFrame(lm, f.aspect) : null;
    const none: Record<BowlHand, BowlHandRead | null> = { left: null, right: null };
    if (!lm || !frame) {
      for (const h of HANDS) this.tracks[h].reset();
      // a release already read still goes, with the sweep it had
      const thr = this.emitDue(f.t, true);
      return {
        tracking: false,
        hipsSeen: false,
        fallback: false,
        line: null,
        hands: none,
        aim: this.aim,
        swinging: false,
        crossing: null,
        throw: thr,
        state: this.stateOf(thr, false),
      };
    }

    const hips = HIPS.filter((i) => inFrame(lm[i], 0.5)).map((i) => downOf(lm[i], frame, f.aspect));
    const hipsSeen = hips.length > 0;
    const line = hipsSeen ? hips.reduce((s, d) => s + d, 0) / hips.length : cfg.chestDown;
    const zScale = f.aspect / frame.width;

    const hands: Record<BowlHand, BowlHandRead | null> = { left: null, right: null };
    let crossing: BowlCrossing | null = null;
    for (const h of HANDS) {
      const tr = this.tracks[h];
      const p = lm[h === "left" ? LM.leftWrist : LM.rightWrist];
      const w = inFrame(p, HAND_VISIBILITY) ? wrist(lm, frame, h, f.aspect) : null;
      if (!w || !p) {
        tr.reset();
        continue;
      }
      const prev = tr.history[tr.history.length - 1];
      tr.seenSince ??= f.t;
      tr.history.push({ t: f.t, down: w.down, across: w.across });
      while (tr.history.length > 2 && f.t - tr.history[1].t > 3000) tr.history.shift();
      const base = this.before(tr, f.t);
      const dt = base ? (f.t - base.t) / 1000 : 0;
      const speed = base ? Math.hypot(w.down - base.down, w.across - base.across) / dt : null;
      const up = base ? (base.down - w.down) / dt : null;
      const from = this.sampleAt(tr, f.t - cfg.curveWindowMs);
      const z = typeof p.z === "number" ? p.z * zScale : null;
      hands[h] = { down: w.down, across: w.across, x: p.x, z, speed, up, sweep: from ? w.across - from.across : null };

      // aim from where the hand is in the picture
      tr.aim = aimFromX(tr.aimFilter.filter(p.x, f.t), cfg);
      tr.aims.push({ t: f.t, aim: tr.aim });
      while (tr.aims.length > 2 && f.t - tr.aims[1].t > 3000) tr.aims.shift();

      // swinging: the wrist moving up or down fast; the aim locks at its start
      if (up !== null && base && Math.abs(up) >= cfg.swingVert) {
        if (f.t - tr.fastAt > cfg.swingPauseMs) {
          tr.swingStartT = base.t;
          tr.swingAim = this.aimAt(tr, base.t);
        }
        tr.fastAt = f.t;
      } else if (f.t - tr.fastAt > cfg.swingPauseMs) {
        tr.swingAim = null;
      }

      // below the line: ready to come up past it
      if (w.down > line + cfg.armBelow) tr.armedAt = f.t;
      // coming down through the line, fast: the bottom of a pendulum is next
      if (prev && prev.down < line && w.down >= line && up !== null && -up >= cfg.swingVert) tr.downAt = f.t;
      // coming up past the line: the arm forward past the hip
      if (prev && prev.down >= line && w.down < line && f.t - tr.armedAt <= cfg.armMemoryMs && speed !== null) {
        const behind = z !== null && z > cfg.behindZ;
        // seated (no hips), the bottom of the swing is often below the picture: any rise past the chest is forward
        const forward = !hipsSeen || f.t - tr.downAt <= cfg.armMemoryMs || (z !== null && z < -cfg.frontZ);
        const released: boolean =
          !behind &&
          forward &&
          f.t - (tr.seenSince ?? f.t) >= cfg.seenMs &&
          speed >= cfg.minSpeed &&
          this.mine &&
          !this.thrown &&
          this.pending === null &&
          tr.swingStartT >= this.turnAt &&
          crossing === null;
        crossing = { hand: h, speed, z, behind, forward, released };
        if (released) {
          const fromS = this.sampleAt(tr, f.t - cfg.curveWindowMs / 2) ?? tr.history[0];
          this.pending = {
            hand: h,
            raw: speed,
            aim: tr.swingAim ?? tr.aim,
            at: f.t,
            emitAt: f.t + cfg.curveWindowMs / 2,
            fromAcross: fromS.across,
            lastAcross: w.across,
            fallback: !hipsSeen,
          };
        }
      }
      if (this.pending && this.pending.hand === h && this.pending.at !== f.t && f.t <= this.pending.emitAt) this.pending.lastAcross = w.across;
    }

    const thr = this.emitDue(f.t, this.pending !== null && hands[this.pending.hand] === null);

    // the arrow follows the hand that bowls: the one swinging on its own, else the one that threw last
    const alone = HANDS.filter((h) => this.tracks[h].swingAim !== null);
    if (alone.length === 1 && !this.pending) this.hand = alone[0];
    const shown: BowlHand | null = hands[this.hand] ? this.hand : hands[this.other(this.hand)] ? this.other(this.hand) : null;
    let swinging = false;
    if (shown) {
      const tr = this.tracks[shown];
      swinging = tr.swingAim !== null;
      this.aim = tr.swingAim ?? tr.aim ?? this.aim;
    }
    if (this.pending) {
      swinging = true;
      this.aim = this.pending.aim;
    } else if (thr) this.aim = thr.aim;

    return { tracking: true, hipsSeen, fallback: !hipsSeen, line, hands, aim: this.aim, swinging, crossing, throw: thr, state: this.stateOf(thr, swinging) };
  }

  private stateOf(thr: BowlThrow | null, swinging: boolean): BowlState {
    if (!this.mine) return "off-turn";
    if (thr || this.thrown) return "thrown";
    if (this.pending) return "released";
    return swinging ? "swinging" : "aiming";
  }

  /** The pending release, once its curve window has closed (or its hand is gone). */
  private emitDue(t: number, lost: boolean): BowlThrow | null {
    const p = this.pending;
    if (!p || (t < p.emitAt && !lost)) return null;
    this.pending = null;
    this.thrown = true;
    this.hand = p.hand;
    const sweep = p.lastAcross - p.fromAcross;
    return { speed: speedFrom(p.raw, this.cfg), aim: p.aim, spin: spinFromSweep(sweep, this.cfg), raw: p.raw, sweep, hand: p.hand, fallback: p.fallback, at: p.at };
  }

  private other(h: BowlHand): BowlHand {
    return h === "left" ? "right" : "left";
  }

  /** The latest sample at least `speedSpanMs` before t (or the oldest, if any is older than t). */
  private before(tr: HandTrack, t: number): Sample | null {
    const h = tr.history;
    if (h.length < 2) return null;
    for (let i = h.length - 2; i >= 0; i--) if (t - h[i].t >= this.cfg.speedSpanMs) return h[i];
    return h[0].t < t ? h[0] : null;
  }

  /** The latest sample at or before t, or null if none is that old. */
  private sampleAt(tr: HandTrack, t: number): Sample | null {
    return tr.history.findLast((s) => s.t <= t) ?? null;
  }

  private aimAt(tr: HandTrack, t: number): number {
    return tr.aims.findLast((a) => a.t <= t)?.aim ?? tr.aims[0]?.aim ?? tr.aim ?? this.aim;
  }
}
