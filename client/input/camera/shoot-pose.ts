import { LM, OneEuro, bodyFrame, wrist } from "./pose.ts";
import type { Point } from "./pose.ts";

// Basketball's camera (task 32, ADR 003): pose landmarks to the three things
// a shooter says, `set`, `aim` and `shoot`. Pure: no DOM, no MediaPipe, unit
// tested on synthetic landmark streams (spec/basketball-shoot-pose.test.ts).
//
// Everything is in shoulder widths and measured against the shoulder line,
// so distance from the camera doesn't matter and a jump (shoulders and wrists
// rising together) adds nothing. Sides come from MediaPipe's left/right
// labels, not image x, so a mirrored preview changes nothing.
//
// - Ready: a wrist at the chest (below the shoulder line, near the body's
//   middle) held still for a moment is `set`, once a turn.
// - Aim: the seen hands' mean sideways offset from the shoulders' middle,
//   scaled to -1..1, positive to the player's right; live.
// - Shot: a wrist rising from the ready zone, faster than a threshold, past
//   the face (or, for a push that is nearly all forward, rising a little and
//   stopping: it reads soft). Its peak upward speed is the power; both hands
//   pushing give their mean. The aim locks where it was just before the rise
//   began. One shot a turn, nothing off-turn, and a hand lost mid-push never
//   fires.

export type ShootHand = "left" | "right";

export interface ShootConfig {
  /** The ready zone: wrist below the shoulder line by this much (shoulder widths), [top, bottom]. */
  readyDown: [number, number];
  /** The ready zone: wrist at most this far either side of the shoulders' middle. */
  readyAcross: number;
  /** A wrist slower than this (shoulder widths a second) is still. */
  stillSpeed: number;
  /** Still in the ready zone this long is `set`. */
  stillMs: number;
  /** A wrist must stay in the ready zone this long to be holding the ball (a hand sweeping through it isn't). */
  readyDwellMs: number;
  /** A push counts as "from the ready zone" if the wrist was holding the ball there this recently. */
  readyMemoryMs: number;
  /** Upward speed (shoulder widths a second, against the shoulder line) that starts a push. */
  startSpeed: number;
  /** Upward speed below which a push has stopped rising (it ends there). */
  stallSpeed: number;
  /** Below this upward speed the wrist wasn't rising yet: where the aim locks. */
  riseMin: number;
  /** The face line: a wrist this far above the shoulder line (negative is above) has passed the face. */
  faceDown: number;
  /** Least rise from the push's start for a push that stalls below the face to count (a chest pass). */
  minRise: number;
  /** A push that stalls below the face has its power scaled by its rise over this, so a chest pass reads soft. */
  fullRise: number;
  /** Least peak upward speed for any push to be a shot; slower is moving, not shooting. */
  minPeak: number;
  /** A push still under way after this long is too slow to be a shot. */
  maxPushMs: number;
  /** Peak upward speed giving power 0 and power 1. */
  power0: number;
  power1: number;
  /** Hands' offset from the shoulders' middle (shoulder widths) that gives full aim. */
  aimRange: number;
  /** Aim inside this is straight. */
  aimDead: number;
  /** Speeds are measured over at least this span, so one jittery frame can't make a push. */
  speedSpanMs: number;
}

// FIRST GUESSES, every one, until the recordings in task 32 (the eight moves
// in docs/camera-playtest.md, "Basketball's moves") replace them. Reasoning:
// a push from the chest (about 0.8 below the shoulders) to above the head
// (about -1) is 1.8 shoulder widths; a soft one over 0.5 s peaks near 7 a
// second, a hard one over 0.2 s near 17 (a smooth reach peaks at about 1.9
// times its average). Scratching your head (about a second) peaks near 3, so
// a shot needs 3.5. Hands hanging at your sides (about 1.5 below the
// shoulders, 0.6 out) are outside the ready zone, so raising an arm from
// there to wave is never a push.
export const DEFAULT_SHOOT: ShootConfig = {
  readyDown: [0.25, 1.2],
  readyAcross: 0.8,
  stillSpeed: 0.8,
  stillMs: 300,
  readyDwellMs: 200,
  readyMemoryMs: 300,
  startSpeed: 1.5,
  stallSpeed: 1.0,
  riseMin: 0.5,
  faceDown: -0.45,
  minRise: 0.3,
  fullRise: 1.2,
  minPeak: 3.5,
  maxPushMs: 700,
  power0: 3.5,
  power1: 16,
  aimRange: 0.6,
  aimDead: 0.05,
  speedSpanMs: 50,
};

/** MediaPipe's hip landmarks: seen means the frame reaches below the chest. */
const HIPS = [23, 24] as const;

export interface HandRead {
  /** Below the shoulder line, shoulder widths (negative above it). */
  down: number;
  /** Along the shoulder line from the middle, shoulder widths, positive to the player's left. */
  across: number;
  /** Upward speed against the shoulder line, shoulder widths a second (null until there are two samples). */
  up: number | null;
  /** In the ready zone (at the chest). */
  ready: boolean;
}

export interface ShotRead {
  /** 0..1 from the peak upward speed. */
  power: number;
  /** -1..1, locked when the push began. */
  aim: number;
  /** Peak upward speed, shoulder widths a second (the mean over both hands if both pushed). */
  peak: number;
  hands: ShootHand | "both";
  at: number;
}

export type ShootState = "lost" | "raise" | "idle" | "ready" | "set" | "pushing" | "shot" | "off-turn";

export interface ShootRead {
  /** The shoulders are seen. */
  tracking: boolean;
  /** Shoulders seen but the frame ends above the chest (no wrists, no hips): "Raise your hands a little". */
  raise: boolean;
  hands: Record<ShootHand, HandRead | null>;
  /** A seen hand is at the chest now (the hands glow). */
  ready: boolean;
  /** Live aim, -1..1, positive to the player's right; frozen while a push is under way. */
  aim: number;
  pushing: boolean;
  /** `set` this frame (once a turn, on turn only). */
  set: boolean;
  /** A shot this frame (once a turn, on turn only). */
  shot: ShotRead | null;
  state: ShootState;
}

export interface ShootFrame {
  t: number;
  landmarks: readonly Point[] | null;
  aspect: number;
}

interface Sample {
  t: number;
  down: number;
  across: number;
}

interface Push {
  startedAt: number;
  fromDown: number;
  peak: number;
  aim: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const HANDS: readonly ShootHand[] = ["left", "right"];
const inFrame = (p: Point | undefined, minVis = 0.5): boolean =>
  p !== undefined && (p.visibility ?? 1) >= minVis && p.y >= 0 && p.y <= 1 && p.x >= 0 && p.x <= 1;

/** Aim from the hands' mean offset along the shoulder line (positive to the player's left). */
export function aimFromAcross(across: number, cfg: ShootConfig = DEFAULT_SHOOT): number {
  // the player's right is negative `across`, and screen right behind the shooter
  const a = -across;
  const past = Math.max(0, Math.abs(a) - cfg.aimDead);
  if (past === 0) return 0;
  return Math.sign(a) * clamp(past / (cfg.aimRange - cfg.aimDead), 0, 1);
}

/** Peak upward speed to power, 0..1. */
export function powerFromPeak(peak: number, cfg: ShootConfig = DEFAULT_SHOOT): number {
  return clamp((peak - cfg.power0) / (cfg.power1 - cfg.power0), 0, 1);
}

class HandTrack {
  history: Sample[] = [];
  lastReadyAt = -Infinity;
  inZoneSince: number | null = null;
  stillSince: number | null = null;
  push: Push | null = null;

  reset(): void {
    this.history = [];
    this.lastReadyAt = -Infinity;
    this.inZoneSince = null;
    this.stillSince = null;
    this.push = null;
  }
}

/**
 * Ready, aim and the push from a stream of pose frames. `setTurn(true)` after
 * `false` starts a turn: one `set` and one shot are allowed in it.
 */
export class ShootDetector {
  cfg: ShootConfig;
  private tracks: Record<ShootHand, HandTrack> = { left: new HandTrack(), right: new HandTrack() };
  private aimFilter = new OneEuro(1, 0.5);
  private aim = 0;
  /** filtered aim per frame, for locking it where the rise began */
  private aims: { t: number; aim: number }[] = [];
  private mine = false;
  private setSent = false;
  private shotTaken = false;
  /** When this turn began (the first frame after it did): a push that started rising before it never counts. */
  private turnAt = -Infinity;
  private turnPending = false;

  constructor(cfg: ShootConfig = DEFAULT_SHOOT) {
    this.cfg = cfg;
  }

  /** Whose turn it is. Going from not mine to mine starts a fresh turn. */
  setTurn(mine: boolean): void {
    if (mine && !this.mine) this.newTurn();
    this.mine = mine;
  }

  /** A fresh turn: `set` and a shot allowed again, any push under way forgotten. */
  newTurn(): void {
    this.setSent = false;
    this.shotTaken = false;
    this.turnPending = true;
    for (const h of HANDS) {
      this.tracks[h].push = null;
      this.tracks[h].stillSince = null;
    }
  }

  get turn(): boolean {
    return this.mine;
  }

  reset(): void {
    for (const h of HANDS) this.tracks[h].reset();
    this.aimFilter.reset();
    this.aims = [];
    this.aim = 0;
  }

  update(f: ShootFrame): ShootRead {
    const cfg = this.cfg;
    if (this.turnPending) {
      this.turnAt = f.t;
      this.turnPending = false;
    }
    const lm = f.landmarks;
    const frame = lm ? bodyFrame(lm, f.aspect) : null;
    const none: Record<ShootHand, HandRead | null> = { left: null, right: null };
    if (!lm || !frame) {
      // shoulders gone: every push and the stillness are forgotten
      for (const h of HANDS) this.tracks[h].reset();
      this.aims = [];
      return { tracking: false, raise: false, hands: none, ready: false, aim: this.aim, pushing: false, set: false, shot: null, state: "lost" };
    }

    const hands: Record<ShootHand, HandRead | null> = { left: null, right: null };
    for (const h of HANDS) {
      const tr = this.tracks[h];
      const w = inFrame(lm[h === "left" ? LM.leftWrist : LM.rightWrist], 0.3) ? wrist(lm, frame, h, f.aspect) : null;
      if (!w) {
        // lost mid-push: that push never fires
        tr.reset();
        continue;
      }
      tr.history.push({ t: f.t, down: w.down, across: w.across });
      while (tr.history.length > 2 && f.t - tr.history[1].t > 600) tr.history.shift();
      const ready = w.down >= cfg.readyDown[0] && w.down <= cfg.readyDown[1] && Math.abs(w.across) <= cfg.readyAcross;
      hands[h] = { down: w.down, across: w.across, up: this.upSpeed(tr, f.t), ready };
    }

    const seen = HANDS.filter((h) => hands[h] !== null);
    const hipsSeen = HIPS.some((i) => inFrame(lm[i]));
    const raise = seen.length === 0 && !hipsSeen;
    const anyPushing = HANDS.some((h) => this.tracks[h].push !== null);

    // aim: live from the seen hands; held still while a push is under way
    // (from the hands at the chest when any are, so a hand hanging at your side doesn't pull it)
    const aiming = seen.some((h) => hands[h]?.ready) ? seen.filter((h) => hands[h]?.ready) : seen;
    if (aiming.length > 0 && !anyPushing) {
      const across = aiming.reduce((s, h) => s + (hands[h] as HandRead).across, 0) / aiming.length;
      this.aim = aimFromAcross(this.aimFilter.filter(across, f.t), cfg);
    }
    this.aims.push({ t: f.t, aim: this.aim });
    while (this.aims.length > 2 && f.t - this.aims[1].t > 1000) this.aims.shift();

    let set = false;
    let shot: ShotRead | null = null;
    let fired: { hand: ShootHand; stall: number | null } | null = null;
    for (const h of HANDS) {
      const r = hands[h];
      if (!r) continue;
      const tr = this.tracks[h];
      // holding the ball: in the ready zone for a moment, not just passing through
      if (r.ready) {
        tr.inZoneSince ??= f.t;
        if (f.t - tr.inZoneSince >= cfg.readyDwellMs) tr.lastReadyAt = f.t;
      } else tr.inZoneSince = null;
      // stillness at the chest
      const speed = this.speed(tr, f.t);
      if (r.ready && speed !== null && speed < cfg.stillSpeed) tr.stillSince ??= f.t;
      else if (!r.ready || (speed !== null && speed >= cfg.stillSpeed)) tr.stillSince = null;

      const up = r.up;
      if (up === null) continue;
      const p = tr.push;
      if (!p) {
        // a push starts below the face, from a hand that was holding the ball at the chest
        if (up >= cfg.startSpeed && r.down > cfg.faceDown && f.t - tr.lastReadyAt <= cfg.readyMemoryMs) {
          const from = this.riseStart(tr);
          // a rise begun before this turn (off-turn) isn't saved up for it
          if (from.t < this.turnAt) continue;
          tr.push = { startedAt: from.t, fromDown: from.down, peak: up, aim: this.aimAt(from.t) };
        }
        continue;
      }
      p.peak = Math.max(p.peak, up);
      const rise = p.fromDown - r.down;
      if (r.down <= cfg.faceDown) {
        // past the face
        if (p.peak >= cfg.minPeak) fired ??= { hand: h, stall: null };
        else tr.push = null;
      } else if (up < cfg.stallSpeed) {
        // stopped rising below the face: a chest pass if it rose enough and fast enough, else nothing
        if (rise >= cfg.minRise && p.peak >= cfg.minPeak) fired ??= { hand: h, stall: rise };
        else tr.push = null;
      } else if (f.t - p.startedAt > cfg.maxPushMs) {
        tr.push = null;
      }
    }

    const pushingNow = HANDS.some((h) => this.tracks[h].push !== null);
    if (fired) {
      const pushes = HANDS.filter((h) => this.tracks[h].push !== null);
      const ps = pushes.map((h) => this.tracks[h].push as Push);
      const peak = ps.reduce((s, x) => s + x.peak, 0) / ps.length;
      const first = ps.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
      if (this.mine && !this.shotTaken) {
        // a push that stopped below the face (mostly forward) is scaled by how far it rose
        const scale = fired.stall === null ? 1 : clamp(fired.stall / cfg.fullRise, 0, 1);
        shot = { power: powerFromPeak(peak, cfg) * scale, aim: first.aim, peak, hands: pushes.length === 2 ? "both" : pushes[0], at: f.t };
        this.shotTaken = true;
      }
      for (const h of HANDS) this.tracks[h].push = null;
    }

    const ready = seen.some((h) => (hands[h] as HandRead).ready);
    const still = seen.some((h) => {
      const s = this.tracks[h].stillSince;
      return s !== null && f.t - s >= cfg.stillMs;
    });
    if (still && this.mine && !this.setSent && !this.shotTaken) {
      set = true;
      this.setSent = true;
    }

    const shownAim = pushingNow ? (HANDS.map((h) => this.tracks[h].push).find((p) => p)?.aim ?? this.aim) : this.aim;
    const state: ShootState = !this.mine
      ? "off-turn"
      : shot || this.shotTaken
        ? "shot"
        : pushingNow
          ? "pushing"
          : raise
            ? "raise"
            : this.setSent
              ? "set"
              : ready
                ? "ready"
                : "idle";
    return { tracking: true, raise, hands, ready, aim: shownAim, pushing: pushingNow, set, shot, state };
  }

  /** Upward speed over the last `speedSpanMs` or more, positive rising. */
  private upSpeed(tr: HandTrack, t: number): number | null {
    const prev = this.before(tr, t);
    if (!prev) return null;
    const cur = tr.history[tr.history.length - 1];
    return (prev.down - cur.down) / ((cur.t - prev.t) / 1000);
  }

  private speed(tr: HandTrack, t: number): number | null {
    const prev = this.before(tr, t);
    if (!prev) return null;
    const cur = tr.history[tr.history.length - 1];
    return Math.hypot(prev.down - cur.down, prev.across - cur.across) / ((cur.t - prev.t) / 1000);
  }

  /** The latest sample at least `speedSpanMs` before t (or the oldest, if any is older than t). */
  private before(tr: HandTrack, t: number): Sample | null {
    const h = tr.history;
    if (h.length < 2) return null;
    for (let i = h.length - 2; i >= 0; i--) if (t - h[i].t >= this.cfg.speedSpanMs) return h[i];
    return h[0].t < t ? h[0] : null;
  }

  /** Walk back to where the wrist began rising: the sample before the rise. */
  private riseStart(tr: HandTrack): Sample {
    const h = tr.history;
    let i = h.length - 1;
    while (i > 0) {
      const a = h[i - 1];
      const b = h[i];
      const v = (a.down - b.down) / ((b.t - a.t) / 1000);
      if (v < this.cfg.riseMin) break;
      i--;
    }
    return h[Math.max(0, i)];
  }

  private aimAt(t: number): number {
    return this.aims.findLast((a) => a.t <= t)?.aim ?? this.aims[0]?.aim ?? this.aim;
  }
}
