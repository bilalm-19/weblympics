// Bowling (task 29, ADR 004): two players take turns on one lane, five frames
// each, real ten-pin scoring. Pure and deterministic (seed + input stream):
// the server rolls the ball and knocks the pins; there is no random scatter,
// so the same throw always knocks the same pins. The seed only feeds the
// bot's wobble (bot.ts), never the physics.
//
// The lane is 2D, seen from above: x across (+x is the bowler's right), y down
// the lane from the foul line (0) to the head pin (LANE.length). The ball
// rolls straight down the boards from its start spot for the first two
// thirds, then bends by `spin`. Ball and pins are circles; a pin knocked past
// TILT from its spot is down.

export type Seat = 0 | 1;

export const DT = 1 / 60;
/** Physics substeps per tick: the fastest ball moves about 1.4 cm a substep, well under a pin's radius. */
export const SUBSTEPS = 12;

/** Real lane: 18.29 m foul line to head pin, 1.054 m wide, a gutter each side. */
export const LANE = { length: 18.29, width: 1.054, gutter: 0.235 } as const;
/** The head pin's spot; the pit starts 0.868 m behind it (34 3/16 in). */
export const HEAD_PIN_Y = LANE.length;
export const PIT_Y = HEAD_PIN_Y + 0.868;
/** Where the bend starts: the last third of the lane. */
export const BEND_Y = (LANE.length * 2) / 3;
/** A 8.5 in ball (radius m, mass kg, 15 lb) and a pin at its widest. */
export const BALL = { radius: 0.109, mass: 6.8 } as const;
export const PIN = { radius: 0.0605, mass: 1.53 } as const;
/** Pins sit 12 in apart in a triangle; rows are 12 in x sin 60 apart. */
export const PIN_SPACING = 0.3048;
export const ROW_SPACING = PIN_SPACING * Math.sin(Math.PI / 3);
/** How far the start spot can sit from the middle: the ball's edge on the lane's edge. */
export const START_RANGE = LANE.width / 2 - BALL.radius;

// Physics numbers: first guesses, tuned so a pocket ball at a good speed
// strikes, a curving pocket ball strikes more often than a straight one, a
// slow ball deflects and leaves pins and a head-on hit can split
// (spec/bowling-physics.test.ts). Revisit after the first playtest.
/** Ball speed in m/s for speed 0..1 (a real ball is about 7 to 9 m/s). */
export const SPEED = { min: 2, max: 10 } as const;
/**
 * The bend: per metre rolled over the last third, the ball's sideways
 * velocity grows by this share of its forward speed at spin 1, so the curve's
 * shape is the same at any speed (the start spot for a spin doesn't move with
 * pace). 0.02 is about a 7 degree entry at spin 1, 4 degrees at 0.6.
 */
export const HOOK_PER_M = 0.02;
/** The ball slows this much rolling, m/s^2. */
export const ROLL_DECEL = 0.15;
/** A knocked pin slides and tumbles to a stop at this, m/s^2. */
export const PIN_FRICTION = 4;
/** Bounciness: ball on pin, pin on pin, pin on the side walls (kickbacks). */
export const RESTITUTION = { ballPin: 0.7, pinPin: 0.6, wall: 0.5 } as const;
/** A pin moved this far from where it stood has fallen. */
export const TILT = 0.04;
/** Everything slower than this is still. */
const REST_SPEED = 0.02;

/** Five frames each (ADR 004): a perfect game is 150. */
export const FRAMES = 5;
/** 20 s a ball on the sim's ticks; running out rolls a gutter ball. */
export const SHOT_CLOCK_TICKS = 20 * 60;
/** A throw arriving after the buzzer counts within the seat's round trip, capped at 150 ms (ADR 001's cap). */
export const MAX_GRACE_TICKS = 9;
/** A roll that hasn't settled by now is called (a pin rocking forever). */
export const MAX_ROLL_TICKS = 10 * 60;
/** The pins lie as they fell for this long after they settle, before the sweep. */
export const RESULT_TICKS = 90;
/** A finished practice or unlimited game stays up this long before the next. */
export const OVER_TICKS = 240;
/** User, 2026-11-08: a level game asks both players "draw or play on"; 15 s, and no vote counts as draw. */
export const VOTE_TICKS = 15 * 60;
/** The path keeps a point every this many ticks. */
const PATH_EVERY = 2;

export type Format = "game" | "unlimited";
export type Phase = "aim" | "roll" | "result" | "tie-vote" | "over";
export type Vote = "draw" | "continue";

export interface Vec2 {
  x: number;
  y: number;
}

/** The ten pins' spots, pin 1 (the head pin) first, then left to right row by row. */
export const PIN_SPOTS: readonly Vec2[] = (() => {
  const spots: Vec2[] = [];
  for (let row = 0; row < 4; row++)
    for (let i = 0; i <= row; i++) spots.push({ x: (i - row / 2) * PIN_SPACING, y: HEAD_PIN_Y + row * ROW_SPACING });
  return spots;
})();

export interface Pin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where it stood when this ball was thrown, to tell a fall from a wobble. */
  homeX: number;
  homeY: number;
  standing: boolean;
  /** Swept away (or off the deck): not on the lane any more. */
  cleared: boolean;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gutter: boolean;
  /** Fell into the pit (or stopped): the roll is over for the ball. */
  gone: boolean;
}

/** What a throw asked for, after the sim's clamps; `ms` is the ball's speed in m/s. */
export interface ThrowRead {
  speed: number;
  aim: number;
  spin: number;
  ms: number;
}

/** One ball's result, for the call and the after-ball read. */
export interface BallResult {
  seat: Seat;
  /** 0..4, or FRAMES + n for the nth tie frame. */
  frame: number;
  ball: number;
  /** Pins this ball knocked down. */
  pins: number;
  /** Pin numbers (1..10) still standing after it. */
  left: number[];
  strike: boolean;
  spare: boolean;
  gutter: boolean;
  /** The shot clock ran out: a gutter ball. */
  timeout: boolean;
  /** The head pin is down and what stands is in two or more groups. */
  split: boolean;
  /** null when the clock ran out. */
  read: ThrowRead | null;
}

export interface FrameView {
  rolls: number[];
  /** What a scoresheet writes per ball: "X", "/", "-" or the pin count. */
  marks: string[];
  /** Running total through this frame, once its bonus balls are known; else null. */
  score: number | null;
}

export interface Card {
  frames: FrameView[];
  /** The running total of every frame scored so far. */
  total: number;
  /** Tie frames' pins, one per tie frame bowled (they decide a tie, never add to `total`). */
  tie: number[];
}

export interface BowlingState {
  tick: number;
  format: Format;
  /** Practice and unlimited: a finished game starts a fresh one. */
  endless: boolean;
  phase: Phase;
  phaseTick: number;
  /** 0..4, or FRAMES + n in the nth tie frame (0-based). */
  frame: number;
  /** Ball within the frame: 0, 1, or 2 (the fifth frame's bonus). */
  ball: number;
  turn: Seat;
  /** Each seat's balls this game, in order (frames 1-5). */
  rolls: [number[], number[]];
  /** Each seat's rolls in each tie frame bowled. */
  tieRolls: [number[][], number[][]];
  pins: Pin[];
  bowl: Ball | null;
  /** The current or last ball's path. */
  path: Vec2[];
  last: BallResult | null;
  /** The thrower's read of the ball in flight (the result keeps it too). */
  thrown: ThrowRead | null;
  /** Each seat's live aim (-1..1) as they last sent it. */
  aims: [number, number];
  /** Ticks of grace past the buzzer per seat, from its round trip (the room sets it). */
  grace: [number, number];
  /** Pins standing when the current ball was thrown (10 at a fresh rack). */
  rack: number;
  votes: [Vote | null, Vote | null];
  winner: Seat | null;
  draw: boolean;
  /** Games finished this session: won per seat, drawn, and each seat's best score. */
  wins: [number, number];
  draws: number;
  best: [number, number];
  matches: number;
  /** Seeds the bot's wobble only. */
  seed: number;
}

export interface BowlingSnapshot {
  tick: number;
  format: Format;
  endless: boolean;
  phase: Phase;
  phaseTick: number;
  frame: number;
  /** 0 in the regular frames, else which tie frame (1, 2...). */
  tieFrame: number;
  ball: number;
  turn: Seat;
  /** Ticks left on the shot clock in the aim phase (0 past the buzzer), else null. */
  clock: number | null;
  /** In "tie-vote": each seat's vote so far and ticks left; else null. */
  vote: { votes: [Vote | null, Vote | null]; ticksLeft: number } | null;
  cards: [Card, Card];
  pins: Array<{ n: number; x: number; y: number; standing: boolean; cleared: boolean }>;
  bowl: { x: number; y: number; gutter: boolean } | null;
  path: Vec2[];
  last: BallResult | null;
  thrown: ThrowRead | null;
  aims: [number, number];
  winner: Seat | null;
  draw: boolean;
  wins: [number, number];
  draws: number;
  best: [number, number];
  matches: number;
}

export type BowlingInput =
  | { t: "aim"; seat: Seat; aim: number }
  | { t: "throw"; seat: Seat; speed: number; aim: number; spin: number; at: number }
  | { t: "tie"; seat: Seat; choice: Vote };

export type BowlingEvent =
  | { type: "bowl"; seat: Seat; frame: number; ball: number; pins: number; strike: boolean; spare: boolean; timeout: boolean }
  | { type: "tieVote"; votes: [Vote | null, Vote | null] }
  | { type: "bowlGame"; winner: Seat | null; draw: boolean; score: [number, number] };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const ballSpeed = (speed: number): number => SPEED.min + clamp(speed, 0, 1) * (SPEED.max - SPEED.min);
export const startX = (aim: number): number => clamp(aim, -1, 1) * START_RANGE;

export function clampThrow(t: { speed: number; aim: number; spin: number }): ThrowRead {
  const speed = clamp(t.speed, 0, 1);
  return { speed, aim: clamp(t.aim, -1, 1), spin: clamp(t.spin, -1, 1), ms: ballSpeed(speed) };
}

// ---------- scoring ----------

/**
 * A scorecard from one player's balls, real ten-pin rules over `frames`
 * frames: a strike is 10 plus the next two balls, a spare 10 plus the next
 * one, and the last frame gives the bonus balls (up to three balls).
 */
export function scoreCard(rolls: readonly number[], frames = FRAMES): { frames: FrameView[]; total: number } {
  const out: FrameView[] = [];
  let i = 0;
  let running = 0;
  let total = 0;
  let known = true;
  for (let f = 0; f < frames; f++) {
    const lastFrame = f === frames - 1;
    const start = i;
    if (i >= rolls.length) {
      out.push({ rolls: [], marks: [], score: null });
      continue;
    }
    let score: number | null = null;
    if (rolls[i] === 10 && !lastFrame) {
      i += 1;
      if (rolls.length >= start + 3) score = 10 + rolls[start + 1] + rolls[start + 2];
    } else if (!lastFrame) {
      i += 2;
      const a = rolls[start];
      const b = rolls[start + 1];
      if (b !== undefined && a + b === 10) {
        if (rolls.length >= start + 3) score = 10 + rolls[start + 2];
      } else if (b !== undefined) score = a + b;
    } else {
      // the last frame: two balls, a third after a strike or spare
      const a = rolls[start];
      const b = rolls[start + 1];
      const bonus = b !== undefined && (a === 10 || a + b === 10);
      i += bonus ? 3 : 2;
      const own = rolls.slice(start, i);
      if (own.length === (bonus ? 3 : 2)) score = own.reduce((x, y) => x + y, 0);
    }
    const own = rolls.slice(start, Math.min(i, rolls.length));
    if (score !== null && known) {
      running += score;
      total = running;
    } else known = false;
    out.push({ rolls: own, marks: marks(own), score: score !== null && known ? running : null });
  }
  return { frames: out, total };
}

/** A scoresheet's marks for one frame's balls. */
function marks(rolls: readonly number[]): string[] {
  const m: string[] = [];
  let standing = 10;
  let fresh = true;
  for (const r of rolls) {
    if (fresh && r === 10) m.push("X");
    else if (!fresh && r === standing) m.push("/");
    else m.push(r === 0 ? "-" : String(r));
    // a full rack after a strike, a spare or a frame's second ball (the fifth frame's bonus ball)
    if (fresh && r < 10) {
      standing = 10 - r;
      fresh = false;
    } else {
      standing = 10;
      fresh = true;
    }
  }
  return m;
}

const tieTotal = (rolls: readonly number[]): number => rolls.reduce((a, b) => a + b, 0);

export function card(s: BowlingState, seat: Seat): Card {
  const c = scoreCard(s.rolls[seat]);
  return { frames: c.frames, total: c.total, tie: s.tieRolls[seat].map(tieTotal) };
}

/** Pin numbers (1..10) that stand; a split is the head pin down and the rest in two or more groups. */
export function isSplit(standing: readonly number[]): boolean {
  if (standing.length < 2 || standing.includes(1)) return false;
  const near = (a: number, b: number) => Math.hypot(PIN_SPOTS[a - 1].x - PIN_SPOTS[b - 1].x, PIN_SPOTS[a - 1].y - PIN_SPOTS[b - 1].y) < PIN_SPACING * 1.05;
  const seen = new Set([standing[0]]);
  const queue = [standing[0]];
  while (queue.length) {
    const p = queue.pop()!;
    for (const q of standing) if (!seen.has(q) && near(p, q)) {
      seen.add(q);
      queue.push(q);
    }
  }
  return seen.size < standing.length;
}

// ---------- physics ----------

export function freshPins(): Pin[] {
  return PIN_SPOTS.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0, homeX: p.x, homeY: p.y, standing: true, cleared: false }));
}

export function launchBall(t: ThrowRead): Ball {
  return { x: startX(t.aim), y: 0, vx: 0, vy: t.ms, gutter: false, gone: false };
}

/** Moves the ball one substep along the lane: straight, then the bend over the last third. Pins aren't looked at. */
function moveBall(b: Ball, spin: number, h: number, gutters = true): void {
  if (b.gone) return;
  const v = Math.hypot(b.vx, b.vy);
  if (v > 0) {
    const nv = Math.max(0, v - ROLL_DECEL * h);
    b.vx *= nv / v;
    b.vy *= nv / v;
  }
  if (!b.gutter && b.y >= BEND_Y) b.vx += spin * HOOK_PER_M * b.vy * b.vy * h;
  if (b.gutter) b.vx = 0;
  b.x += b.vx * h;
  b.y += b.vy * h;
  if (gutters && !b.gutter && Math.abs(b.x) > LANE.width / 2) {
    b.gutter = true;
    b.x = Math.sign(b.x) * (LANE.width / 2 + LANE.gutter / 2);
    b.vx = 0;
  }
  if (b.y > PIT_Y || b.vy <= 0.01) b.gone = true;
}

/** Equal and opposite impulse along the line of centres, and separation, for two circles. */
function collide(a: { x: number; y: number; vx: number; vy: number }, ma: number, b: { x: number; y: number; vx: number; vy: number }, mb: number, minDist: number, e: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minDist * minDist || d2 === 0) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  // push apart in proportion to the other's mass
  const overlap = minDist - d;
  const wa = mb / (ma + mb);
  a.x -= nx * overlap * wa;
  a.y -= ny * overlap * wa;
  b.x += nx * overlap * (1 - wa);
  b.y += ny * overlap * (1 - wa);
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return true;
  const j = (-(1 + e) * rel) / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx;
  a.vy -= (j / ma) * ny;
  b.vx += (j / mb) * nx;
  b.vy += (j / mb) * ny;
  return true;
}

const DECK_START = HEAD_PIN_Y - PIN_SPACING;
const WALL_X = LANE.width / 2 + LANE.gutter;

function movePin(p: Pin, h: number): void {
  if (p.cleared) return;
  const v = Math.hypot(p.vx, p.vy);
  if (v > 0) {
    const nv = Math.max(0, v - PIN_FRICTION * h);
    p.vx *= nv / v;
    p.vy *= nv / v;
  }
  p.x += p.vx * h;
  p.y += p.vy * h;
  // the kickbacks: side walls beside the pin deck
  if (p.y > DECK_START && Math.abs(p.x) > WALL_X - PIN.radius) {
    p.x = Math.sign(p.x) * (WALL_X - PIN.radius);
    p.vx = -p.vx * RESTITUTION.wall;
  }
  if (Math.hypot(p.x - p.homeX, p.y - p.homeY) > TILT) p.standing = false;
  if (p.y > PIT_Y || p.y < DECK_START - 1) {
    p.standing = false;
    p.cleared = true;
  }
}

/** One tick of the roll, in place: SUBSTEPS of ball, pins and every contact between them. */
export function rollStep(ball: Ball, pins: Pin[], spin: number): void {
  const h = DT / SUBSTEPS;
  const live = pins.filter((p) => !p.cleared);
  for (let k = 0; k < SUBSTEPS; k++) {
    moveBall(ball, spin, h);
    for (const p of live) movePin(p, h);
    if (!ball.gone && !ball.gutter && ball.y > DECK_START - BALL.radius)
      for (const p of live) if (!p.cleared) collide(ball, BALL.mass, p, PIN.mass, BALL.radius + PIN.radius, RESTITUTION.ballPin);
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (a.cleared || b.cleared) continue;
        // still pins resting apart can't touch; skip the maths
        if (a.vx === 0 && a.vy === 0 && b.vx === 0 && b.vy === 0) continue;
        collide(a, PIN.mass, b, PIN.mass, 2 * PIN.radius, RESTITUTION.pinPin);
      }
  }
}

const still = (p: Pin) => p.cleared || Math.hypot(p.vx, p.vy) < REST_SPEED;

/** The roll is over: the ball has gone and every pin has stopped. */
export const settled = (ball: Ball, pins: readonly Pin[]): boolean => ball.gone && pins.every(still);

/**
 * Rolls `t` into `pins` (copied) until it settles; for the bot, the speed
 * zone and tests. Returns the pins as they lie and the ball's path.
 */
export function simulateThrow(t: { speed: number; aim: number; spin: number }, pins: readonly Pin[] = freshPins()): { pins: Pin[]; down: number; standing: number[]; path: Vec2[]; gutter: boolean } {
  const read = clampThrow(t);
  const ball = launchBall(read);
  const ps = pins.map((p) => ({ ...p, homeX: p.x, homeY: p.y }));
  const up = ps.filter((p) => p.standing && !p.cleared).length;
  const path: Vec2[] = [{ x: ball.x, y: ball.y }];
  for (let i = 0; i < MAX_ROLL_TICKS && !settled(ball, ps); i++) {
    rollStep(ball, ps, read.spin);
    if (!ball.gone && i % PATH_EVERY === 0) path.push({ x: ball.x, y: ball.y });
  }
  const standing = ps.flatMap((p, i) => (p.standing && !p.cleared ? [i + 1] : []));
  return { pins: ps, down: up - standing.length, standing, path, gutter: ball.gutter };
}

/** Where the ball would be across the lane when it reaches `y`, with no pins; null if it went in the gutter first. */
export function ballXAt(t: { speed: number; aim: number; spin: number }, y: number): number | null {
  const read = clampThrow(t);
  const b = launchBall(read);
  const h = DT / SUBSTEPS;
  for (let i = 0; i < MAX_ROLL_TICKS * SUBSTEPS && !b.gone; i++) {
    const before = { x: b.x, y: b.y };
    moveBall(b, read.spin, h);
    if (b.gutter) return null;
    if (b.y >= y) return before.x + ((y - before.y) / (b.y - before.y || 1)) * (b.x - before.x);
  }
  return null;
}

/** The ball's centre as it meets the head pin's row: one ball and one pin radius short of the spot. */
export const CONTACT_Y = HEAD_PIN_Y - BALL.radius - PIN.radius;
/**
 * The pocket: the ball's centre this far from the head pin's line as it gets
 * there, on the side it curves in from (the 1-3 for a ball curving left or
 * straight, the 1-2 for one curving right). First guess, tuned with the
 * physics.
 */
export const POCKET_X = 0.08;

/** The pocket's x for a ball curving with `spin`: curving left (or straight) takes the 1-3, curving right the 1-2. */
export const pocketX = (spin: number): number => (spin > 0 ? -POCKET_X : POCKET_X);

/**
 * The start spot (aim, -1..1) that brings a ball of `speed` and `spin` to
 * `x` across the lane at depth `y` (the pocket at the head pin by default).
 * The bend doesn't depend on the start spot, so one probe with no gutters
 * finds it; clamped to the lane. For the bot, the speed zone and tests.
 */
export function aimFor(speed: number, spin: number, x: number = pocketX(spin), y = CONTACT_Y): number {
  const read = clampThrow({ speed, aim: 0, spin });
  const b = launchBall(read);
  const h = DT / SUBSTEPS;
  for (let i = 0; i < MAX_ROLL_TICKS * SUBSTEPS && !b.gone; i++) {
    const before = { x: b.x, y: b.y };
    moveBall(b, read.spin, h, false);
    if (b.y >= y) {
      const drift = before.x + ((y - before.y) / (b.y - before.y || 1)) * (b.x - before.x);
      return clamp((x - drift) / START_RANGE, -1, 1);
    }
  }
  return clamp(x / START_RANGE, -1, 1);
}

const zoneCache = new Map<number, { min: number; max: number } | null>();

/**
 * The after-ball "speed zone" (ADR 004): the speeds (0..1) that carry a
 * pocket ball with `spin` to the pins with enough pace to strike, worked out
 * from this sim (a sweep, cached per spin to a tenth). The widest unbroken
 * run of striking speeds; null if none strikes with that spin.
 */
export function speedZone(spin = -0.6): { min: number; max: number } | null {
  const key = Math.round(clamp(spin, -1, 1) * 10) / 10;
  if (zoneCache.has(key)) return zoneCache.get(key)!;
  let best: { min: number; max: number } | null = null;
  let run: { min: number; max: number } | null = null;
  for (let k = 0; k <= 40; k++) {
    const speed = k / 40;
    if (simulateThrow({ speed, aim: aimFor(speed, key), spin: key }).down === 10) {
      run = run ? { min: run.min, max: speed } : { min: speed, max: speed };
      if (!best || run.max - run.min > best.max - best.min) best = { ...run };
    } else run = null;
  }
  zoneCache.set(key, best);
  return best;
}

// ---------- the game ----------

export interface StateOptions {
  format?: Format;
  endless?: boolean;
}

export function createState(seed: number, options: StateOptions = {}): BowlingState {
  const s = {
    tick: 0,
    format: options.format ?? "game",
    endless: options.endless ?? false,
    grace: [0, 0],
    wins: [0, 0],
    draws: 0,
    best: [0, 0],
    matches: 0,
    seed: seed >>> 0,
  } as unknown as BowlingState;
  freshGame(s);
  return s;
}

function freshGame(s: BowlingState): void {
  s.frame = 0;
  s.ball = 0;
  s.turn = 0;
  s.rolls = [[], []];
  s.tieRolls = [[], []];
  s.path = [];
  s.last = null;
  s.aims = [0, 0];
  s.votes = [null, null];
  s.winner = null;
  s.draw = false;
  startBall(s, true);
}

const copyLast = (l: BallResult | null): BallResult | null => (l ? { ...l, left: [...l.left], read: l.read ? { ...l.read } : null } : null);

export function snapshot(s: BowlingState): BowlingSnapshot {
  return {
    tick: s.tick,
    format: s.format,
    endless: s.endless,
    phase: s.phase,
    phaseTick: s.phaseTick,
    frame: s.frame,
    tieFrame: s.frame >= FRAMES ? s.frame - FRAMES + 1 : 0,
    ball: s.ball,
    turn: s.turn,
    clock: s.phase === "aim" ? Math.max(0, SHOT_CLOCK_TICKS - s.phaseTick) : null,
    vote: s.phase === "tie-vote" ? { votes: [s.votes[0], s.votes[1]], ticksLeft: Math.max(0, VOTE_TICKS - s.phaseTick) } : null,
    cards: [card(s, 0), card(s, 1)],
    pins: s.pins.map((p, i) => ({ n: i + 1, x: p.x, y: p.y, standing: p.standing, cleared: p.cleared })),
    bowl: s.bowl && !s.bowl.gone ? { x: s.bowl.x, y: s.bowl.y, gutter: s.bowl.gutter } : null,
    path: s.path.map((p) => ({ ...p })),
    last: copyLast(s.last),
    thrown: s.thrown ? { ...s.thrown } : null,
    aims: [s.aims[0], s.aims[1]],
    winner: s.winner,
    draw: s.draw,
    wins: [s.wins[0], s.wins[1]],
    draws: s.draws,
    best: [s.best[0], s.best[1]],
    matches: s.matches,
  };
}

export function cloneState(s: BowlingState): BowlingState {
  return {
    ...s,
    rolls: [[...s.rolls[0]], [...s.rolls[1]]],
    tieRolls: [s.tieRolls[0].map((r) => [...r]), s.tieRolls[1].map((r) => [...r])],
    pins: s.pins.map((p) => ({ ...p })),
    bowl: s.bowl ? { ...s.bowl } : null,
    path: s.path.map((p) => ({ ...p })),
    last: copyLast(s.last),
    thrown: s.thrown ? { ...s.thrown } : null,
    aims: [s.aims[0], s.aims[1]],
    grace: [s.grace[0], s.grace[1]],
    votes: [s.votes[0], s.votes[1]],
    wins: [s.wins[0], s.wins[1]],
    best: [s.best[0], s.best[1]],
  };
}

/** The room's late-throw grace for `seat`, in ticks (its round trip, capped at MAX_GRACE_TICKS). */
export function setLag(s: BowlingState, seat: Seat, ticks: number): void {
  s.grace[seat] = Number.isFinite(ticks) ? clamp(Math.floor(ticks), 0, MAX_GRACE_TICKS) : 0;
}

/** A fresh rack (all ten), or the leftovers with the fallen ones swept away. */
function startBall(s: BowlingState, fullRack: boolean): void {
  s.pins = fullRack ? freshPins() : s.pins.map((p) => (p.standing && !p.cleared ? { ...p, vx: 0, vy: 0 } : { ...p, vx: 0, vy: 0, standing: false, cleared: true }));
  s.rack = s.pins.filter((p) => p.standing).length;
  s.phase = "aim";
  s.phaseTick = 0;
  s.bowl = null;
  s.thrown = null;
}

function throwBall(s: BowlingState, read: ThrowRead): void {
  s.thrown = read;
  s.aims[s.turn] = read.aim;
  s.bowl = launchBall(read);
  s.path = [{ x: s.bowl.x, y: s.bowl.y }];
  for (const p of s.pins) {
    p.homeX = p.x;
    p.homeY = p.y;
  }
  s.phase = "roll";
  s.phaseTick = 0;
}

const inTie = (s: BowlingState): boolean => s.frame >= FRAMES;
const isLastFrame = (s: BowlingState): boolean => s.frame === FRAMES - 1;

/** The ball and pins have settled (or the clock ran out): record the ball. */
function finishBall(s: BowlingState, read: ThrowRead | null, ev: BowlingEvent[]): void {
  const seat = s.turn;
  if (read === null) s.path = [];
  const left = s.pins.flatMap((p, i) => (p.standing && !p.cleared ? [i + 1] : []));
  const pins = s.rack - left.length;
  const fresh = s.rack === 10;
  const strike = fresh && pins === 10;
  const spare = !fresh && left.length === 0;
  if (inTie(s)) {
    const k = s.frame - FRAMES;
    while (s.tieRolls[seat].length <= k) s.tieRolls[seat].push([]);
    s.tieRolls[seat][k].push(pins);
  } else s.rolls[seat].push(pins);
  s.last = {
    seat,
    frame: s.frame,
    ball: s.ball,
    pins,
    left,
    strike,
    spare,
    gutter: read === null || (s.bowl?.gutter ?? false),
    timeout: read === null,
    split: fresh && isSplit(left),
    read,
  };
  s.phase = "result";
  s.phaseTick = 0;
  ev.push({ type: "bowl", seat, frame: s.frame, ball: s.ball, pins, strike, spare, timeout: read === null });
}

const scoreTotals = (s: BowlingState): [number, number] => [scoreCard(s.rolls[0]).total, scoreCard(s.rolls[1]).total];

/** After a result: the next ball in this frame, the other bowler, the next frame, a vote or the end. */
function advance(s: BowlingState, ev: BowlingEvent[]): void {
  const cleared = s.last!.left.length === 0;
  if (!inTie(s) && isLastFrame(s)) {
    // the fifth frame: a strike or spare in its first two balls earns a third
    const own = s.rolls[s.turn].slice(-(s.ball + 1));
    const bonus = s.ball === 1 && (own[0] === 10 || own[0] + own[1] === 10);
    if (s.ball === 0 || bonus) {
      s.ball++;
      return startBall(s, cleared);
    }
  } else if (s.ball === 0 && !cleared) {
    // a regular or tie frame: a second ball at the leftovers
    s.ball++;
    return startBall(s, false);
  }
  s.ball = 0;
  if (s.turn === 0) {
    s.turn = 1;
    return startBall(s, true);
  }
  s.turn = 0;
  if (!inTie(s) && s.frame < FRAMES - 1) {
    s.frame++;
    return startBall(s, true);
  }
  // both have bowled the fifth frame, or a tie frame
  const k = s.frame - FRAMES;
  const decide = inTie(s) ? [tieTotal(s.tieRolls[0][k] ?? []), tieTotal(s.tieRolls[1][k] ?? [])] : scoreTotals(s);
  if (decide[0] !== decide[1]) return finishGame(s, decide[0] > decide[1] ? 0 : 1, ev);
  // level (user, 2026-11-08): both vote to draw or to bowl a tie frame
  s.phase = "tie-vote";
  s.phaseTick = 0;
  s.votes = [null, null];
  s.bowl = null;
}

function finishGame(s: BowlingState, winner: Seat | null, ev: BowlingEvent[]): void {
  const score = scoreTotals(s);
  s.winner = winner;
  s.draw = winner === null;
  if (winner === null) s.draws++;
  else s.wins[winner]++;
  s.best = [Math.max(s.best[0], score[0]), Math.max(s.best[1], score[1])];
  s.matches++;
  s.phase = "over";
  s.phaseTick = 0;
  s.bowl = null;
  ev.push({ type: "bowlGame", winner, draw: winner === null, score });
}

/** The vote is in (or its clock ran out): any "draw", or no vote, draws; both "continue" bowl a tie frame. */
function settleVote(s: BowlingState, ev: BowlingEvent[]): void {
  ev.push({ type: "tieVote", votes: [s.votes[0], s.votes[1]] });
  if (s.votes[0] === "continue" && s.votes[1] === "continue") {
    s.frame = Math.max(FRAMES, s.frame + 1);
    s.ball = 0;
    s.turn = 0;
    s.votes = [null, null];
    return startBall(s, true);
  }
  finishGame(s, null, ev);
}

export function step(s: BowlingState, inputs: readonly BowlingInput[]): BowlingEvent[] {
  const ev: BowlingEvent[] = [];
  s.tick++;
  s.phaseTick++;
  for (const input of inputs) {
    if (input.t === "tie") {
      // one vote per seat per vote, only while voting
      if (s.phase === "tie-vote" && s.votes[input.seat] === null) s.votes[input.seat] = input.choice;
      continue;
    }
    if (s.phase !== "aim" || input.seat !== s.turn) continue;
    if (input.t === "aim") {
      s.aims[input.seat] = clamp(input.aim, -1, 1);
      continue;
    }
    // a throw: on the clock, or after the buzzer within the seat's grace
    if (s.phaseTick <= SHOT_CLOCK_TICKS + s.grace[input.seat]) {
      throwBall(s, clampThrow(input));
      break;
    }
  }
  if (s.phase === "aim" && s.phaseTick > SHOT_CLOCK_TICKS + s.grace[s.turn]) {
    finishBall(s, null, ev);
  } else if (s.phase === "roll" && s.bowl) {
    rollStep(s.bowl, s.pins, s.thrown!.spin);
    if (!s.bowl.gone && s.phaseTick % PATH_EVERY === 0) s.path.push({ x: s.bowl.x, y: s.bowl.y });
    if (settled(s.bowl, s.pins) || s.phaseTick >= MAX_ROLL_TICKS) finishBall(s, s.thrown, ev);
  } else if (s.phase === "result" && s.phaseTick >= RESULT_TICKS) {
    advance(s, ev);
  } else if (s.phase === "tie-vote" && (s.votes.includes("draw") || (s.votes[0] !== null && s.votes[1] !== null) || s.phaseTick >= VOTE_TICKS)) {
    settleVote(s, ev);
  } else if (s.phase === "over" && s.endless && s.phaseTick >= OVER_TICKS) {
    freshGame(s);
  }
  return ev;
}

