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
