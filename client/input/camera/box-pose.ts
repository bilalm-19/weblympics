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
