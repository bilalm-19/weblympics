// Boxing in front of the camera (task 30). Pure: landmarks in, punches and
// the guard out, so it is unit tested on synthetic sequences
// (spec/boxing-box-pose.test.ts), like run-pose.ts and archery's bow.ts.
//
// Laptop distance, upper body in view. Everything is in shoulder widths, in
// the frame of the shoulder line (pose.ts's `bodyFrame`), so distance from
// the camera and leaning don't matter. Sides come from MediaPipe's labels.
//
// - jab: a wrist moving fast toward the camera, away from its shoulder. The
//   pose model's z gives depth (smaller is nearer; roughly x's scale), so
//   "forward" is how far the wrist is in front of its own shoulder.
// - hook: a wrist sweeping fast across the body (toward the other side) at
//   about shoulder height, more sideways than forward.
// - guard: both wrists near the face (the nose when seen, else a point above
//   the shoulders' middle), with hysteresis so it doesn't flicker.
//
// This only reads what the body did; the sim decides what it is worth (the
// wind-up, the guard at landing, the cooldown and the punch cap), so a read
// here never has to be clever about cheating.
import { LM, bodyFrame, wrist } from "./pose.ts";
import type { BodyFrame, Point } from "./pose.ts";

export type BoxHand = "left" | "right";
export type BoxPunch = "jab" | "hook";

export const NOSE = 0;

const MIN_VISIBILITY = 0.5;
const seen = (p: Point | undefined): p is Point => p !== undefined && (p.visibility ?? 1) >= MIN_VISIBILITY;

export interface BoxConfig {
  /** Shoulder widths a second toward the camera that make a jab... */
  jabSpeed: number;
  /** ...ending at least this far in front of the shoulder. */
  jabReach: number;
  /** Shoulder widths a second across the body that make a hook... */
  hookSpeed: number;
  /** ...with the wrist within this of shoulder height (above or below). */
  hookBand: number;
  /** A hand slower than this (both ways) is re-armed for its next punch. */
  rearmSpeed: number;
  /** Two punches from one hand closer than this (ms) are one. */
  minGapMs: number;
  /** Both wrists within this of the face raise the guard... */
  guardOn: number;
  /** ...and it drops when either is farther than this. */
  guardOff: number;
  /** Where the face is, when the nose isn't seen: this far above the shoulders' middle. */
  faceUp: number;
}

// GUESSES to be playtested on a real webcam, like the bow's and the run's.
export const DEFAULT_BOX: BoxConfig = {
  jabSpeed: 4,
  jabReach: 0.5,
  hookSpeed: 4,
  hookBand: 0.7,
  rearmSpeed: 1.5,
  minGapMs: 250,
  guardOn: 0.55,
  guardOff: 0.75,
  faceUp: 0.6,
};

/** One wrist in the shoulder frame, in shoulder widths. */
export interface BoxWrist {
  /** Along the shoulder line from their middle; positive toward the player's left. */
  across: number;
  /** Below the shoulder line (negative above). */
  down: number;
  /** In front of its own shoulder, toward the camera; 0 when the model gives no depth. */
  forward: number;
}

export interface BoxFrame {
  left: BoxWrist | null;
  right: BoxWrist | null;
  /** The face in the same frame. */
  face: { across: number; down: number };
}

/** A frame's wrists and face, or null with no shoulders. */
export function boxFrame(lm: readonly Point[], aspect: number, cfg: BoxConfig = DEFAULT_BOX): BoxFrame | null {
  const frame = bodyFrame(lm, aspect);
  if (!frame) return null;
  const hand = (h: BoxHand): BoxWrist | null => {
    const w = wrist(lm, frame, h, aspect);
    if (!w) return null;
    const wp = lm[h === "left" ? LM.leftWrist : LM.rightWrist];
    const sp = lm[h === "left" ? LM.leftShoulder : LM.rightShoulder];
    const forward = wp.z !== undefined && sp.z !== undefined ? ((sp.z - wp.z) * aspect) / frame.width : 0;
    return { across: w.across, down: w.down, forward };
  };
  return { left: hand("left"), right: hand("right"), face: face(lm, frame, aspect, cfg) };
}

function face(lm: readonly Point[], frame: BodyFrame, aspect: number, cfg: BoxConfig): { across: number; down: number } {
  const n = lm[NOSE];
  if (!seen(n)) return { across: 0, down: -cfg.faceUp };
  const x = (n.x * aspect - frame.mid.x) / frame.width;
  const y = (n.y - frame.mid.y) / frame.width;
  const a = frame.across;
  // the down axis is the across axis turned a quarter, pointing down the image
  const d = a.x >= 0 ? { x: -a.y, y: a.x } : { x: a.y, y: -a.x };
  return { across: x * a.x + y * a.y, down: x * d.x + y * d.y };
}

/**
 * What the playtest readout (`?debug`) shows for one arm, to choose how
 * "arm out" (a punch) is measured from a real webcam. All in shoulder widths.
 */
export interface ArmMeasures {
  /** The hand's apparent size: wrist to index and pinky knuckles. Grows as the fist nears the camera. */
  size: number | null;
  /** Elbow angle on screen, degrees (180 is straight). Foreshortened for a punch at the camera. */
  elbow2d: number | null;
  /** Elbow angle using the model's depth too, degrees. */
  elbow3d: number | null;
  /** Wrist in front of its shoulder from the model's depth (as `BoxWrist.forward`). */
  forward: number;
  /** Wrist's distance from its shoulder on screen. */
  reach: number;
  across: number;
  down: number;
}

const LEFT_INDEX = 19;
const RIGHT_INDEX = 20;

function angle(a: Point, b: Point, c: Point, aspect: number, depth: boolean): number | null {
  const v = (p: Point, q: Point) => [(p.x - q.x) * aspect, p.y - q.y, depth ? ((p.z ?? 0) - (q.z ?? 0)) * aspect : 0];
  const u = v(a, b);
  const w = v(c, b);
  const nu = Math.hypot(u[0], u[1], u[2]);
  const nw = Math.hypot(w[0], w[1], w[2]);
  if (nu < 1e-6 || nw < 1e-6) return null;
  const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (nu * nw);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** One arm's measures for the readout, or null when its shoulders or wrist aren't seen. */
export function armMeasures(lm: readonly Point[], aspect: number, hand: BoxHand): ArmMeasures | null {
  const frame = bodyFrame(lm, aspect);
  if (!frame) return null;
  const w = wrist(lm, frame, hand, aspect);
  if (!w) return null;
  const left = hand === "left";
  const sh = lm[left ? LM.leftShoulder : LM.rightShoulder];
  const el = lm[left ? LM.leftElbow : LM.rightElbow];
  const wr = lm[left ? LM.leftWrist : LM.rightWrist];
  const idx = lm[left ? LEFT_INDEX : RIGHT_INDEX];
  const pk = lm[left ? LM.leftPinky : LM.rightPinky];
  const dist = (p: Point, q: Point) => Math.hypot((p.x - q.x) * aspect, p.y - q.y) / frame.width;
  const size = seen(idx) && seen(pk) ? (dist(wr, idx) + dist(wr, pk)) / 2 : null;
  const elbowSeen = seen(el);
  const forward = wr.z !== undefined && sh.z !== undefined ? ((sh.z - wr.z) * aspect) / frame.width : 0;
  return {
    size,
    elbow2d: elbowSeen ? angle(sh, el, wr, aspect, false) : null,
    elbow3d: elbowSeen ? angle(sh, el, wr, aspect, true) : null,
    forward,
    reach: dist(wr, sh),
    across: w.across,
    down: w.down,
  };
}

/** One hand as the hand model (21 points) sees it, in the shoulder frame, in shoulder widths. */
export interface HandMeasures {
  /** Palm size: the mean of wrist to index knuckle, wrist to pinky knuckle and across the knuckles. */
  size: number;
  /** The palm's middle along the shoulder line; positive toward the player's left. */
  across: number;
  /** The palm's middle above the shoulder line (negative below). */
  height: number;
}

// hand model landmark indices
const H_WRIST = 0;
const H_INDEX_MCP = 5;
const H_MIDDLE_MCP = 9;
const H_PINKY_MCP = 17;

/**
 * The hand model's hands, assigned to the player's left or right by which side
 * of the shoulders' middle they are on (not MediaPipe's handedness label, which
 * a mirrored or a closed fist can flip; and not the pose wrists, which the
 * playtest showed are lost with the hands by the face). Two hands on one side
 * (a hook crossing over) are split by which is farther that way. Null without
 * shoulders.
 */
export function handMeasures(
  hands: readonly { points: readonly Point[] }[] | undefined,
  lm: readonly Point[],
  aspect: number,
): Record<BoxHand, HandMeasures | null> | null {
  const frame = bodyFrame(lm, aspect);
  if (!frame) return null;
  const a = frame.across;
  const d = a.x >= 0 ? { x: -a.y, y: a.x } : { x: a.y, y: -a.x };
  const toFrame = (p: Point) => {
    const x = (p.x * aspect - frame.mid.x) / frame.width;
    const y = (p.y - frame.mid.y) / frame.width;
    return { across: x * a.x + y * a.y, height: -(x * d.x + y * d.y) };
  };
  const dist = (p: Point, q: Point) => Math.hypot((p.x - q.x) * aspect, p.y - q.y) / frame.width;
  const read = (pts: readonly Point[]): HandMeasures | null => {
    const w = pts[H_WRIST];
    const i = pts[H_INDEX_MCP];
    const m = pts[H_MIDDLE_MCP];
    const k = pts[H_PINKY_MCP];
    if (!w || !i || !m || !k) return null;
    return { size: (dist(w, i) + dist(w, k) + dist(i, k)) / 3, ...toFrame(m) };
  };
  const seenHands = (hands ?? []).map((h) => read(h.points)).filter((h): h is HandMeasures => h !== null);
  const out: Record<BoxHand, HandMeasures | null> = { left: null, right: null };
  if (seenHands.length === 1) out[seenHands[0].across >= 0 ? "left" : "right"] = seenHands[0];
  else if (seenHands.length >= 2) {
    const [lo, hi] = [...seenHands].sort((p, q) => p.across - q.across);
    out.right = lo;
    out.left = hi;
  }
  return out;
}

export interface BoxPunchEvent {
  kind: BoxPunch;
  hand: BoxHand;
  /** The frame's time, ms. */
  t: number;
}

export interface BoxRead {
  guard: boolean;
  /** A punch thrown on this frame, or null. */
  punch: BoxPunchEvent | null;
  /** Whether the body could be read on this frame. */
  tracking: boolean;
}

/**
 * Turns frames into punches and the guard. Each hand keeps its last
 * position for its speed, and is "armed" until it throws; it re-arms once it
 * has slowed down and `minGapMs` has passed, so one punch is one event.
 * Frames it can't read are skipped (a lost hand loses its speed, not its
 * arming), and the guard keeps its last value.
 */
export class BoxTracker {
  private prev: Record<BoxHand, { w: BoxWrist; t: number } | null> = { left: null, right: null };
  private armed: Record<BoxHand, boolean> = { left: true, right: true };
  private last: Record<BoxHand, number> = { left: -Infinity, right: -Infinity };
  guard = false;
  private cfg: BoxConfig;

  constructor(cfg: BoxConfig = DEFAULT_BOX) {
    this.cfg = cfg;
  }

  reset(): void {
    this.prev = { left: null, right: null };
    this.armed = { left: true, right: true };
    this.last = { left: -Infinity, right: -Infinity };
    this.guard = false;
  }

  /** One frame (from boxFrame) at time `t`, ms. */
  update(f: BoxFrame | null, t: number): BoxRead {
    if (!f) {
      this.prev = { left: null, right: null };
      return { guard: this.guard, punch: null, tracking: false };
    }
    const c = this.cfg;
    let punch: BoxPunchEvent | null = null;
    for (const hand of ["left", "right"] as const) {
      const w = f[hand];
      const p = this.prev[hand];
      this.prev[hand] = w && { w, t };
      if (!w || !p || t <= p.t) continue;
      const dt = (t - p.t) / 1000;
      const vForward = (w.forward - p.w.forward) / dt;
      // toward the other side: the right hand moves to +across, the left to -across
      const vAcross = ((w.across - p.w.across) / dt) * (hand === "right" ? 1 : -1);
      if (!this.armed[hand]) {
        if (Math.abs(vForward) < c.rearmSpeed && Math.abs(vAcross) < c.rearmSpeed && t - this.last[hand] >= c.minGapMs) this.armed[hand] = true;
        continue;
      }
      let kind: BoxPunch | null = null;
      if (vForward >= c.jabSpeed && w.forward >= c.jabReach && vForward >= Math.abs(vAcross)) kind = "jab";
      else if (vAcross >= c.hookSpeed && Math.abs(w.down) <= c.hookBand && vAcross > Math.abs(vForward)) kind = "hook";
      if (kind && punch === null) {
        punch = { kind, hand, t };
        this.armed[hand] = false;
        this.last[hand] = t;
      }
    }
    const near = (w: BoxWrist | null, r: number) => w !== null && Math.hypot(w.across - f.face.across, w.down - f.face.down) <= r;
    if (f.left && f.right) this.guard = this.guard ? near(f.left, c.guardOff) && near(f.right, c.guardOff) : near(f.left, c.guardOn) && near(f.right, c.guardOn);
    // a punch takes that hand away from the face
    if (punch) this.guard = false;
    return { guard: this.guard, punch, tracking: true };
  }
}

// ---- Trial detector (task 30 playtest, docs/camera-playtest.md) ----
// Built from two real-webcam recordings (docs/playtest/boxing-2026-11-05-*).
// The pose model's depth fired "jabs" all the time, and it lost the hands by
// the face; the hand model sees them. So:
// - jab: the hand model's palm grows past `jabGrow` times that hand's own
//   resting size (its fist nearing the camera). Recorded: up to 1.45-1.67x on
//   jabs, at most 1.25x moving without punching.
// - hook: the pose wrist swings wider than `hookReach` from its shoulder while
//   the hand model has lost that hand or sees it far out to the side
//   (recorded: the hand model loses a hooking fist 75% of the time; the pose
//   reach is 0.96-1.29 in hooks, at most 0.73 moving). The hand-model check
//   stops the pose model's own glitches in the guard (it once read 1.23).
// - target: the palm above `headAt` is a head shot (recorded: jab to head
//   0.57-0.61, to body 0.13-0.25). For a hook, the pose wrist above
//   `hookHeadAt` (a GUESS: hooks to the body weren't recorded).
// - guard (user, playtest 3: "1 arm is no guard"): both palms must be seen
//   and up; one arm up, or either hand lost, is no guard. Both above `highGuardAt` is high (recorded
//   0.58-0.61), both in [lowGuardAt, highGuardAt) is low (0.31-0.36);
//   relaxed was 0.16-0.19. It must hold `guardFrames` frames to change.
// Heights are above the shoulder line, in shoulder widths.

export type BoxTarget = "head" | "body";
export type BoxGuard = "high" | "low" | null;

export interface TrialConfig {
  /** Off since the third playtest (user: "we can even remove hooks"): the camera throws jabs only. */
  hooks: boolean;
  jabGrow: number;
  /** A hand re-arms below this ratio of its resting size. */
  jabRearm: number;
  hookReach: number;
  /** ...and re-arms once back inside this. */
  hookRearm: number;
  /** A hand-model palm farther out than this (across) doesn't stop a hook. */
  hookSideAcross: number;
  headAt: number;
  hookHeadAt: number;
  highGuardAt: number;
  lowGuardAt: number;
  guardFrames: number;
  minGapMs: number;
  /** How fast a hand's resting size follows (per frame), when it isn't punching. */
  restFollow: number;
  /**
   * A hand that stays steady between `jabRearm` and `jabGrow` times its rest
   * this long (ms) after a punch has settled somewhere else (guard to
   * relaxed): that is its rest now. Without it the hand never gets back
   * inside `jabRearm`, and no later jab is read (playtest 5). A hold time, not
   * a camera threshold; a jab is out far above `jabGrow`, so it never counts.
   */
  restSettleMs: number;
}

export const TRIAL_BOX: TrialConfig = {
  hooks: false,
  jabGrow: 1.35,
  jabRearm: 1.15,
  hookReach: 0.9,
  hookRearm: 0.6,
  hookSideAcross: 0.8,
  headAt: 0.4,
  hookHeadAt: -0.15,
  highGuardAt: 0.47,
  lowGuardAt: 0.27,
  guardFrames: 3,
  // a hand's jabs this far apart at least: the sim's per-hand gap (wind-up 100
  // + recovery 100) since 2026-11-08, was 250, so the camera isn't the
  // bottleneck. A GUESS until the 2026-11-08 ?debug recording.
  minGapMs: 200,
  restFollow: 0.05,
  restSettleMs: 600,
};

export interface TrialPunch {
  kind: BoxPunch;
  hand: BoxHand;
  target: BoxTarget;
  t: number;
}

export interface TrialRead {
  punch: TrialPunch | null;
  guard: BoxGuard;
  /** Each hand's palm size over its resting size, for the readout. */
  grow: Record<BoxHand, number | null>;
}

export interface TrialFrame {
  hands: Record<BoxHand, HandMeasures | null> | null;
  arms: Record<BoxHand, ArmMeasures | null>;
}

export class TrialDetector {
  private rest: Record<BoxHand, number | null> = { left: null, right: null };
  private armed: Record<BoxHand, boolean> = { left: true, right: true };
  private last: Record<BoxHand, number> = { left: -Infinity, right: -Infinity };
  /** Since when each unarmed hand has sat between jabRearm and jabGrow of its rest. */
  private band: Record<BoxHand, number | null> = { left: null, right: null };
  private pending: { guard: BoxGuard; frames: number } = { guard: null, frames: 0 };
  guard: BoxGuard = null;
  private cfg: TrialConfig;

  constructor(cfg: TrialConfig = TRIAL_BOX) {
    this.cfg = cfg;
  }

  update(f: TrialFrame, t: number): TrialRead {
    const c = this.cfg;
    const grow: Record<BoxHand, number | null> = { left: null, right: null };
    let punch: TrialPunch | null = null;
    for (const hand of ["left", "right"] as const) {
      const h = f.hands?.[hand] ?? null;
      const arm = f.arms[hand];
      const rest = this.rest[hand];
      const ratio = h && rest ? h.size / rest : null;
      grow[hand] = ratio;
      const out = arm !== null && arm.reach >= c.hookReach && (h === null || Math.abs(h.across) >= c.hookSideAcross);
      // re-arm once the hand is back in
      if (!this.armed[hand]) {
        const inJab = ratio === null || ratio <= c.jabRearm;
        const inHook = arm === null || arm.reach <= c.hookRearm;
        if (inJab && inHook && t - this.last[hand] >= c.minGapMs) this.armed[hand] = true;
        else if (h && rest && ratio !== null && ratio > c.jabRearm && ratio < c.jabGrow && inHook) {
          // steady a little above the rest: the rest moved (playtest 5), so take it
          this.band[hand] ??= t;
          if (t - (this.band[hand] as number) >= c.restSettleMs && t - this.last[hand] >= c.minGapMs) {
            this.rest[hand] = h.size;
            this.armed[hand] = true;
          }
        } else this.band[hand] = null;
        if (this.armed[hand]) this.band[hand] = null;
      } else if (punch === null) {
        if (h && ratio !== null && ratio >= c.jabGrow) punch = { kind: "jab", hand, target: h.height >= c.headAt ? "head" : "body", t };
        else if (c.hooks && out && arm) punch = { kind: "hook", hand, target: -arm.down >= c.hookHeadAt ? "head" : "body", t };
        if (punch) {
          this.armed[hand] = false;
          this.last[hand] = t;
        }
      }
      // the resting size follows the hand only while it is in
      if (h && this.armed[hand] && (rest === null || h.size / rest < c.jabRearm)) {
        this.rest[hand] = rest === null ? h.size : rest + (h.size - rest) * c.restFollow;
      }
    }
    const l = f.hands?.left ?? null;
    const r = f.hands?.right ?? null;
    let seenGuard: BoxGuard = null;
    if (l && r && !punch) {
      const lo = Math.min(l.height, r.height);
      if (lo >= c.highGuardAt) seenGuard = "high";
      else if (lo >= c.lowGuardAt && Math.max(l.height, r.height) < c.highGuardAt) seenGuard = "low";
    }
    if (punch) {
      // a punch takes that hand off the guard at once
      this.guard = null;
      this.pending = { guard: null, frames: 0 };
    } else if (seenGuard === this.pending.guard) {
      this.pending.frames++;
      if (this.pending.frames >= c.guardFrames) this.guard = seenGuard;
    } else this.pending = { guard: seenGuard, frames: 1 };
    return { punch, guard: this.guard, grow };
  }

  reset(): void {
    this.rest = { left: null, right: null };
    this.armed = { left: true, right: true };
    this.last = { left: -Infinity, right: -Infinity };
    this.band = { left: null, right: null };
    this.pending = { guard: null, frames: 0 };
    this.guard = null;
  }
}

/** What the camera sends for one frame, in the shapes a key sends (ADR 002). */
export interface CameraBoxing {
  guard: BoxGuard;
  /** A jab read on this frame, or null. */
  jab: { hand: BoxHand; target: BoxTarget } | null;
}

/**
 * Turns either detector's read into ADR 002's messages. The trial detector's
 * guard height and each jab's target go straight through. The old tracker has
 * one guard and no target, so its guard is the high guard and its jab goes to
 * the head. Jabs only: a hook from either is dropped. No slip from the camera
 * until a real-webcam recording sets its threshold.
 */
export function cameraBoxing(read: TrialRead | BoxRead): CameraBoxing {
  if ("grow" in read) {
    return { guard: read.guard, jab: read.punch?.kind === "jab" ? { hand: read.punch.hand, target: read.punch.target } : null };
  }
  return { guard: read.guard ? "high" : null, jab: read.punch?.kind === "jab" ? { hand: read.punch.hand, target: "head" } : null };
}

// ---- Camera slip (task 30, playtest 4: "tilting isn't moving me") ----
// A slip is the shoulders tilting to one side, read from the shoulder line
// (`bodyFrame(...).tilt`, degrees, positive when leaning to the player's
// right). Neutral is the median of the first `neutralMs` of tracking, as
// tennis's tilt does, so how you sit doesn't matter. A slip is a held lean
// (playtest 4): held past `slipAt` degrees from neutral for `holdMs` you are
// leaning that way for as long as you stay past `rearmAt`; back within it,
// upright. Deliberate, not twitchy (user, 2026-11-08: "it seems to easily slip
// left and right"): one frame past the line used to lean, so a jab's shoulder
// twist or a pose-model glitch leaned and ate the jabs after it. The hold is
// in ms, not frames, so 15 fps and 30 fps behave the same; and no lean starts
// within `jabQuietMs` of a jab the camera read (`jab(t)`), the hold counting
// only from then on. GUESSES until the 2026-11-08 ?debug recording (moves 9
// and "lean slightly while jabbing"; docs/camera-playtest.md).

export interface SlipConfig {
  /** Degrees from neutral that start a lean, if held (was 8 until 2026-11-08; a GUESS). */
  slipAt: number;
  /** Back within this many degrees of neutral is upright (was 4; a GUESS). */
  rearmAt: number;
  /** The tilt must stay past `slipAt` this long (ms) before it leans (2026-11-08; a GUESS). */
  holdMs: number;
  /** No lean starts within this long (ms) after a jab the camera read: a jab twists the shoulders (2026-11-08; a GUESS). */
  jabQuietMs: number;
  neutralMs: number;
}

export const DEFAULT_SLIP: SlipConfig = { slipAt: 12, rearmAt: 6, holdMs: 200, jabQuietMs: 250, neutralMs: 1000 };

export class SlipDetector {
  private samples: number[] = [];
  private start: number | null = null;
  /** The side the tilt has been past `slipAt` on, and since when (ms), not yet a lean. */
  private pending: { side: BoxHand; since: number } | null = null;
  private lastJab = -Infinity;
  neutral: number | null = null;
  /** The lean now: a side, or null when upright. */
  lean: BoxHand | null = null;
  private cfg: SlipConfig;

  constructor(cfg: SlipConfig = DEFAULT_SLIP) {
    this.cfg = cfg;
  }

  /** The camera read a jab at `t` ms: its shoulder twist mustn't start a lean. */
  jab(t: number): void {
    this.lastJab = t;
    this.pending = null;
  }

  /**
   * One frame's shoulder tilt (null when the shoulders aren't seen) at `t` ms.
   * Returns the lean when it changes (a side, or null back upright), else
   * undefined. A lost frame keeps the lean (and a pending one) as it was.
   */
  update(tilt: number | null, t: number): BoxHand | null | undefined {
    if (tilt === null) return undefined;
    const c = this.cfg;
    if (this.neutral === null) {
      if (this.start === null) this.start = t;
      this.samples.push(tilt);
      if (t - this.start >= c.neutralMs && this.samples.length >= 5) {
        const s = [...this.samples].sort((a, b) => a - b);
        this.neutral = s[Math.floor(s.length / 2)];
      }
      return undefined;
    }
    const d = tilt - this.neutral;
    const side: BoxHand = d > 0 ? "right" : "left";
    let next = this.lean;
    if (this.lean !== null && (Math.abs(d) <= c.rearmAt || side !== this.lean)) next = null;
    if (next === null) {
      const quiet = t - this.lastJab < c.jabQuietMs;
      if (Math.abs(d) >= c.slipAt && !quiet) {
        if (this.pending?.side !== side) this.pending = { side, since: t };
        if (t - this.pending.since >= c.holdMs) next = side;
      } else this.pending = null;
    }
    if (next !== null) this.pending = null;
    if (next === this.lean) return undefined;
    this.lean = next;
    return next;
  }

  /** How far from neutral now, in degrees, for the readout; null before neutral is set. */
  offset(tilt: number | null): number | null {
    return tilt === null || this.neutral === null ? null : tilt - this.neutral;
  }

  reset(): void {
    this.samples = [];
    this.start = null;
    this.neutral = null;
    this.lean = null;
    this.pending = null;
    this.lastJab = -Infinity;
  }
}
