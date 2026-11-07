// Basketball (task 32, ADR 003): a turn-by-turn shoot-off at one hoop. Pure
// and deterministic (seed + input stream): the server runs it, the client
// only draws the snapshot. A client says "I'm set", "aiming here" and "shot
// this hard, this way"; the sim flies the ball against its own rim and
// backboard and scores it. No random scatter: the same shot always does the
// same thing. The seed only picks unlimited's spots.
//
// Court axes: the rim's centre is above the origin at RIM.y; +z runs from
// the backboard out towards the shooters, +x is to the right as seen by a
// shooter at the free-throw line, +y is up. The board's face is the plane
// z = BOARD.z, parallel to the baseline.

export type Seat = 0 | 1;
export type Format = "shootout" | "unlimited";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const DT = 1 / 60;
export const TICK_MS = 1000 / 60;
export const GRAVITY = 9.81;

// ---- Geometry and physics. First guesses (agent, 2026-11-07), tuned only so
// the make windows are sane (free throw wide, 9 m thin, everything makeable
// with power 0..1); revisit with the camera's recordings (ADR 003). ----

/** The ball (a size 7 ball is about 24 cm across). */
export const BALL_R = 0.12;
/** The rim: centre height, inner radius (a real rim is 0.225; a little wider here, first guess), tube radius. */
export const RIM = { y: 3.05, r: 0.24, tube: 0.01 } as const;
/** The backboard's face: its plane, half its width, bottom and top edges (a real board is 1.8 m by 1.05 m). */
export const BOARD = { z: -0.39, halfWidth: 0.9, bottom: 2.9, top: 3.95 } as const;
/** Where the ball leaves the hands: this high, this far in front of the spot towards the hoop. */
export const RELEASE = { y: 2.2, forward: 0.35 } as const;
/** The fixed launch angle above horizontal, radians (58 degrees: a high arc drops in more). */
export const LAUNCH_ANGLE = (58 * Math.PI) / 180;
/** Launch speed, m/s, at power 0 and power 1 (along POWER_CURVE between). */
export const SPEED = { min: 7.0, max: 11.0 } as const;
/**
 * Power to speed is a curve (speed grows with power squared), so the soft end
 * of the bar is gentle: a near spot gets a wide window, the deep spot a thin
 * one near the top. Windows with these numbers (power, centred aim): free
 * throw 0.200-0.332, elbow 0.462-0.515, wing 0.646-0.681, top 0.703-0.734,
 * deep 0.863-0.886 (spec/basketball-physics.test.ts holds the shape).
 */
export const POWER_CURVE = 2;
/** Full aim (-1 or 1) turns the shot this far, radians, from straight at the hoop. */
export const AIM_YAW = 0.1;
/** Speed kept along the normal after a bounce (restitution), and of the rest along the surface. */
export const RIM_BOUNCE = { normal: 0.35, along: 0.75 } as const;
export const BOARD_BOUNCE = { normal: 0.6, along: 0.85 } as const;
export const FLOOR_BOUNCE = { normal: 0.6, along: 0.8 } as const;
/** Integration steps per 60 Hz tick: at 11 m/s a substep moves under 2 cm, well under the ball plus the rim tube. */
export const SUBSTEPS = 10;
/** A ball falling this far below the rim without going in can never go in: the shot is a miss. */
const DEAD_BELOW = 0.4;
/** A flight still undecided after this long (a ball balanced on the rim) is a miss. */
export const MAX_FLIGHT_TICKS = 360;

// ---- Turns and clock (ADR 003) ----

/** The shot clock: 15 s from the shooter's first `set`. */
export const SHOT_CLOCK_TICKS = 15 * 60;
/** If no `set` comes, the clock starts this far into the turn anyway (so a turn lasts at most 20 s). */
export const AUTO_CLOCK_TICKS = 5 * 60;
/** A shot after the buzzer counts within the seat's round trip, capped at 150 ms (ADR 001's cap). */
export const MAX_LATE_TICKS = 9;
/** How long the result stays up (the ball keeps falling) before the next turn. */
export const RESULT_TICKS = 120;
/** A finished practice match stays up this long before the next starts. */
export const OVER_TICKS = 240;
/** User, 2026-11-08: a level shootout asks both players "draw or play on"; 15 s, and no vote counts as draw. */
export const VOTE_TICKS = 15 * 60;
/** The ball's path in the snapshot keeps one point every this many ticks. */
export const PATH_EVERY = 2;
/** Unlimited keeps this many recent shots in the snapshot. */
const SHOTS_KEPT = 20;

export interface Spot {
  id: "freeThrow" | "elbow" | "wing" | "top" | "deep";
  name: string;
  /** Metres from the spot to the point on the floor under the rim's centre. */
  distance: number;
  /** A make's points before the swish bonus. */
  points: number;
  /** Where on the court, radians: 0 is straight out from the board, + to the right (+x). */
  angle: number;
}

/** The five spots, nearest first (ADR 003). The angles are the scene's (agent's choice); the board is the only thing they change. */
export const SPOTS: readonly Spot[] = [
  { id: "freeThrow", name: "Free throw", distance: 4.6, points: 2, angle: 0 },
  { id: "elbow", name: "Elbow", distance: 5.5, points: 2, angle: (26 * Math.PI) / 180 },
  { id: "wing", name: "Wing three", distance: 6.75, points: 3, angle: (-45 * Math.PI) / 180 },
  { id: "top", name: "Top three", distance: 7.25, points: 3, angle: 0 },
  { id: "deep", name: "Deep", distance: 9, points: 4, angle: 0 },
];
/** The money ball, and where sudden death is shot from. */
export const DEEP_SPOT = SPOTS.length - 1;
/** A swish (no rim, no board) adds this to any make, the money ball included. */
export const SWISH_BONUS = 1;

/** The range of power that scores with a centred aim (`makeWindow`). */
export interface Window {
  lo: number;
  hi: number;
}

export interface ShotResult {
  seat: Seat;
  /** 0..4 the five spots, 5 and up sudden death; in unlimited, the turn number. */
  round: number;
  spot: number;
  distance: number;
  made: boolean;
  swish: boolean;
  rim: boolean;
  board: boolean;
  /** What it scored (0 on a miss). In sudden death it isn't added to the total. */
  points: number;
  /** The clamped power and aim the shot was flown with (0 and 0 if the clock ran out). */
  power: number;
  aim: number;
  /** This spot's make window, for the power bar. */
  window: Window;
  suddenDeath: boolean;
  /** Set when no shot came before the buzzer (and its grace). */
  lost?: "time";
}

export type Phase = "aim" | "flight" | "result" | "tie-vote" | "over";
export type Vote = "draw" | "continue";

export interface Ball {
  pos: Vec3;
  vel: Vec3;
}

export interface BasketballState {
  tick: number;
  format: Format;
  /** Practice: a finished match starts a fresh one. */
  endless: boolean;
  phase: Phase;
  phaseTick: number;
  /** 0..4 the spots, 5 and up sudden death; in unlimited, turns taken. */
  round: number;
  spot: number;
  suddenDeath: boolean;
  turn: Seat;
  /** Shots taken in this round (two closes it). */
  turnInRound: number;
  /** The shooter has sent `set` this turn (the ready cue on every screen). */
  set: boolean;
  /** phaseTick the shot clock started at, null until it does. */
  clockStart: number | null;
  /** Each seat's aim as they last sent it, -1..1 (only the shooter's changes). */
  aim: [number, number];
  ball: Ball | null;
  /** The current shot's clamped power and aim, from its release until the next turn. */
  release: { power: number; aim: number } | null;
  /** The current shot's path so far, one point every PATH_EVERY ticks, from the release. */
  path: Vec3[];
  /** The current shot's contacts so far. */
  contact: { rim: boolean; board: boolean };
  /** Ticks the current shot has flown. */
  flightTicks: number;
  last: ShotResult | null;
  /** This match's shots (unlimited keeps the latest 20). */
  shots: ShotResult[];
  totals: [number, number];
  makes: [number, number];
  attempts: [number, number];
  /** The longest make per seat, metres (0 if none). */
  longest: [number, number];
  winner: Seat | null;
  /** The match ended level: a seat voted draw, or the vote ran out. */
  draw: boolean;
  /** In "tie-vote": each seat's vote so far. */
  votes: [Vote | null, Vote | null];
  matches: number;
  /** Each seat's grace after the buzzer, ticks (set by the room from the measured round trip; 0 by default). */
  lag: [number, number];
  rng: number;
}

/** Everything a view needs; the seats' lag and the rng stay on the server. */
export interface BasketballSnapshot {
  tick: number;
  format: Format;
  endless: boolean;
  phase: Phase;
  phaseTick: number;
  round: number;
  spot: number;
  suddenDeath: boolean;
  turn: Seat;
  turnInRound: number;
  set: boolean;
  /** Ticks left on the shot clock (SHOT_CLOCK_TICKS until it starts, 0 at the buzzer). */
  clockLeft: number;
  clockRunning: boolean;
  /** The current spot's make window (`makeWindow(spot)`), for the power bar. */
  window: Window;
  aim: [number, number];
  ball: Ball | null;
  /** The current shot's clamped power and aim, from its release until the next turn. */
  release: { power: number; aim: number } | null;
  path: Vec3[];
  contact: { rim: boolean; board: boolean };
  last: ShotResult | null;
  shots: ShotResult[];
  totals: [number, number];
  makes: [number, number];
  attempts: [number, number];
  longest: [number, number];
  winner: Seat | null;
  /** The match ended level: a seat voted draw, or the vote ran out. */
  draw: boolean;
  /** In "tie-vote": each seat's vote so far and ticks left; else null. */
  vote: { votes: [Vote | null, Vote | null]; ticksLeft: number } | null;
  matches: number;
}

export type BasketballInput =
  | { t: "set"; seat: Seat }
  | { t: "aim"; seat: Seat; aim: number }
  | { t: "shoot"; seat: Seat; power: number; aim: number; at: number }
  | { t: "tie"; seat: Seat; choice: Vote };

export type BasketballEvent =
  | ({ type: "basket" } & Omit<ShotResult, "window">)
  | { type: "spot"; round: number; spot: number; suddenDeath: boolean }
  | { type: "tieVote"; votes: [Vote | null, Vote | null] }
  | { type: "match"; winner: Seat | null; draw: boolean; score: [number, number] };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function random(s: BasketballState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- flight

/** Where the spot is on the floor (court axes). */
export function spotPosition(spot: number): { x: number; z: number } {
  const sp = SPOTS[spot];
  return { x: sp.distance * Math.sin(sp.angle), z: sp.distance * Math.cos(sp.angle) };
}

export const launchSpeed = (power: number): number => SPEED.min + Math.pow(clamp(power, 0, 1), POWER_CURVE) * (SPEED.max - SPEED.min);

/** The ball leaving the hands at `spot` with `power` 0..1 and `aim` -1..1 (both clamped). */
export function launch(spot: number, power: number, aim: number): Ball {
  const p = spotPosition(spot);
  const len = Math.hypot(p.x, p.z);
  // towards the hoop, and the shooter's right (they face -z from the free-throw line)
  const dx = -p.x / len;
  const dz = -p.z / len;
  const rx = -dz;
  const rz = dx;
  const yaw = clamp(aim, -1, 1) * AIM_YAW;
  const hx = dx * Math.cos(yaw) + rx * Math.sin(yaw);
  const hz = dz * Math.cos(yaw) + rz * Math.sin(yaw);
  const v = launchSpeed(power);
  const vh = v * Math.cos(LAUNCH_ANGLE);
  return {
    pos: { x: p.x + dx * RELEASE.forward, y: RELEASE.y, z: p.z + dz * RELEASE.forward },
    vel: { x: vh * hx, y: v * Math.sin(LAUNCH_ANGLE), z: vh * hz },
  };
}

/** Bounces `ball` off a surface with outward unit normal `n`, keeping `normal` of the speed into it and `along` of the rest. */
function bounce(ball: Ball, n: Vec3, k: { normal: number; along: number }): void {
  const vn = ball.vel.x * n.x + ball.vel.y * n.y + ball.vel.z * n.z;
  if (vn >= 0) return;
  const tx = ball.vel.x - vn * n.x;
  const ty = ball.vel.y - vn * n.y;
  const tz = ball.vel.z - vn * n.z;
  ball.vel.x = tx * k.along - vn * k.normal * n.x;
  ball.vel.y = ty * k.along - vn * k.normal * n.y;
  ball.vel.z = tz * k.along - vn * k.normal * n.z;
}

/** The rim is a torus: the ball meets it if its centre comes within BALL_R + tube of the rim's circle. */
function hitRim(ball: Ball): boolean {
  const p = ball.pos;
  const h = Math.hypot(p.x, p.z);
  // nearest point on the rim's circle (straight below the centre any point will do)
  const qx = h > 1e-9 ? (p.x / h) * RIM.r : RIM.r;
  const qz = h > 1e-9 ? (p.z / h) * RIM.r : 0;
  const nx = p.x - qx;
  const ny = p.y - RIM.y;
  const nz = p.z - qz;
  const d = Math.hypot(nx, ny, nz);
  const reach = BALL_R + RIM.tube;
  if (d >= reach || d < 1e-9) return false;
  const n = { x: nx / d, y: ny / d, z: nz / d };
  p.x = qx + n.x * reach;
  p.y = RIM.y + n.y * reach;
  p.z = qz + n.z * reach;
  bounce(ball, n, RIM_BOUNCE);
  return true;
}

/** The board's face, bounded: the ball's centre must be within the face (its edges are ignored). */
function hitBoard(ball: Ball): boolean {
  const p = ball.pos;
  if (p.z - BALL_R >= BOARD.z || p.z < BOARD.z - BALL_R) return false;
  if (Math.abs(p.x) > BOARD.halfWidth || p.y < BOARD.bottom || p.y > BOARD.top) return false;
  if (ball.vel.z >= 0) return false;
  p.z = BOARD.z + BALL_R;
  bounce(ball, { x: 0, y: 0, z: 1 }, BOARD_BOUNCE);
  return true;
}

export type FlightStatus = "flying" | "made" | "missed";

/**
 * One 60 Hz tick of flight, in SUBSTEPS steps, in place. `contact` collects
 * rim and board touches. Returns "made" when the ball's centre crosses down
 * through the rim's plane inside the rim, "missed" once it can no longer go
 * in. After the shot is decided (`decided`), it only bounces off the floor,
 * for the view.
 */
export function flyTick(ball: Ball, contact: { rim: boolean; board: boolean }, decided = false): FlightStatus {
  const h = DT / SUBSTEPS;
  let status: FlightStatus = "flying";
  for (let i = 0; i < SUBSTEPS; i++) {
    const prevY = ball.pos.y;
    const prevX = ball.pos.x;
    const prevZ = ball.pos.z;
    ball.vel.y -= GRAVITY * h;
    ball.pos.x += ball.vel.x * h;
    ball.pos.y += ball.vel.y * h;
    ball.pos.z += ball.vel.z * h;
    if (decided) {
      if (ball.pos.y < BALL_R && ball.vel.y < 0) {
        ball.pos.y = BALL_R;
        bounce(ball, { x: 0, y: 1, z: 0 }, FLOOR_BOUNCE);
      }
      continue;
    }
    if (hitRim(ball)) contact.rim = true;
    if (hitBoard(ball)) contact.board = true;
    if (status !== "flying") continue;
    if (prevY >= RIM.y && ball.pos.y < RIM.y) {
      const f = (prevY - RIM.y) / (prevY - ball.pos.y);
      const x = prevX + f * (ball.pos.x - prevX);
      const z = prevZ + f * (ball.pos.z - prevZ);
      if (Math.hypot(x, z) < RIM.r) status = "made";
    }
    if (status === "flying" && ball.vel.y < 0 && ball.pos.y < RIM.y - DEAD_BELOW) status = "missed";
  }
  return status;
}

/** The whole flight of a shot: whether it went in, its contacts, and how many ticks it took to decide. */
export function simulateShot(spot: number, power: number, aim: number): { made: boolean; rim: boolean; board: boolean; ticks: number } {
  const ball = launch(spot, power, aim);
  const contact = { rim: false, board: false };
  for (let t = 1; t <= MAX_FLIGHT_TICKS; t++) {
    const r = flyTick(ball, contact);
    if (r !== "flying") return { made: r === "made", ...contact, ticks: t };
  }
  return { made: false, ...contact, ticks: MAX_FLIGHT_TICKS };
}

const WINDOW_STEPS = 1000;
const windows = new Map<number, Window>();

/**
 * The range of power that scores from `spot` with a centred aim: the unbroken
 * run of makes (rattles in included) around the swishes, sampled every 0.001.
 * A hard straight shot can also kiss in off the board, and a few lucky
 * powers outside the window still drop; the window is the "just right" band
 * the power bar shows as green. Pure; worked out once per spot from the same
 * flight the server uses. The bot aims inside it.
 */
export function makeWindow(spot: number): Window {
  const cached = windows.get(spot);
  if (cached) return { ...cached };
  const made: boolean[] = [];
  const swishes: number[] = [];
  for (let i = 0; i <= WINDOW_STEPS; i++) {
    const r = simulateShot(spot, i / WINDOW_STEPS, 0);
    made.push(r.made);
    if (r.made && !r.rim && !r.board) swishes.push(i);
  }
  let w: Window = { lo: 0, hi: 0 };
  if (swishes.length > 0) {
    let lo = swishes[Math.floor(swishes.length / 2)];
    let hi = lo;
    while (lo > 0 && made[lo - 1]) lo--;
    while (hi < WINDOW_STEPS && made[hi + 1]) hi++;
    w = { lo: lo / WINDOW_STEPS, hi: hi / WINDOW_STEPS };
  }
  windows.set(spot, w);
  return { ...w };
}

// ---------------------------------------------------------------- the game

const firstShooter = (round: number): Seat => (round % 2 === 0 ? 0 : 1);

function startTurn(s: BasketballState): void {
  s.phase = "aim";
  s.phaseTick = 0;
  s.set = false;
  s.clockStart = null;
  s.aim = [0, 0];
  s.ball = null;
  s.release = null;
  s.path = [];
  s.contact = { rim: false, board: false };
  s.flightTicks = 0;
}

/** Starts round `round`: a spot of the five, sudden death from the deep spot, or in unlimited a random spot. */
function startRound(s: BasketballState, round: number, ev: BasketballEvent[]): void {
  s.round = round;
  s.turnInRound = 0;
  if (s.format === "unlimited") {
    s.spot = Math.floor(random(s) * SPOTS.length);
    s.suddenDeath = false;
  } else {
    s.suddenDeath = round >= SPOTS.length;
    s.spot = s.suddenDeath ? DEEP_SPOT : round;
    s.turn = firstShooter(round);
  }
  startTurn(s);
  ev.push({ type: "spot", round: s.round, spot: s.spot, suddenDeath: s.suddenDeath });
}

function freshMatch(s: BasketballState, ev: BasketballEvent[]): void {
  s.shots = [];
  s.last = null;
  s.totals = [0, 0];
  s.makes = [0, 0];
  s.attempts = [0, 0];
  s.longest = [0, 0];
  s.winner = null;
  s.draw = false;
  s.votes = [null, null];
  s.turn = 0;
  startRound(s, 0, ev);
}

export interface StateOptions {
  format?: Format;
  endless?: boolean;
}

export function createState(seed: number, options: StateOptions = {}): BasketballState {
  const s: BasketballState = {
    tick: 0,
    format: options.format ?? "shootout",
    endless: options.endless ?? false,
    phase: "aim",
    phaseTick: 0,
    round: 0,
    spot: 0,
    suddenDeath: false,
    turn: 0,
    turnInRound: 0,
    set: false,
    clockStart: null,
    aim: [0, 0],
    ball: null,
    release: null,
    path: [],
    contact: { rim: false, board: false },
    flightTicks: 0,
    last: null,
    shots: [],
    totals: [0, 0],
    makes: [0, 0],
    attempts: [0, 0],
    longest: [0, 0],
    winner: null,
    draw: false,
    votes: [null, null],
    matches: 0,
    lag: [0, 0],
    rng: seed >>> 0,
  };
  freshMatch(s, []);
  return s;
}

/** The room sets each seat's late-shot grace from its measured round trip; clamped to 0..MAX_LATE_TICKS. */
export function setLag(s: BasketballState, seat: Seat, ticks: number): void {
  s.lag[seat] = Number.isFinite(ticks) ? clamp(Math.round(ticks), 0, MAX_LATE_TICKS) : 0;
}

/** Ticks the shot clock has run this turn, or null before it starts. */
const clockElapsed = (s: BasketballState): number | null => (s.clockStart === null ? null : s.phaseTick - s.clockStart);

const copyShot = (r: ShotResult): ShotResult => ({ ...r, window: { ...r.window } });
const copyBall = (b: Ball): Ball => ({ pos: { ...b.pos }, vel: { ...b.vel } });

export function snapshot(s: BasketballState): BasketballSnapshot {
  const elapsed = clockElapsed(s);
  return {
    tick: s.tick,
    format: s.format,
    endless: s.endless,
    phase: s.phase,
    phaseTick: s.phaseTick,
    round: s.round,
    spot: s.spot,
    suddenDeath: s.suddenDeath,
    turn: s.turn,
    turnInRound: s.turnInRound,
    set: s.set,
    clockLeft: elapsed === null ? SHOT_CLOCK_TICKS : Math.max(0, SHOT_CLOCK_TICKS - elapsed),
    clockRunning: elapsed !== null && s.phase === "aim",
    window: makeWindow(s.spot),
    aim: [s.aim[0], s.aim[1]],
    ball: s.ball ? copyBall(s.ball) : null,
    release: s.release ? { ...s.release } : null,
    path: s.path.map((p) => ({ ...p })),
    contact: { ...s.contact },
    last: s.last ? copyShot(s.last) : null,
    shots: s.shots.map(copyShot),
    totals: [s.totals[0], s.totals[1]],
    makes: [s.makes[0], s.makes[1]],
    attempts: [s.attempts[0], s.attempts[1]],
    longest: [s.longest[0], s.longest[1]],
    winner: s.winner,
    draw: s.draw,
    vote: s.phase === "tie-vote" ? { votes: [s.votes[0], s.votes[1]], ticksLeft: Math.max(0, VOTE_TICKS - s.phaseTick) } : null,
    matches: s.matches,
  };
}

export function cloneState(s: BasketballState): BasketballState {
  return {
    ...s,
    aim: [s.aim[0], s.aim[1]],
    ball: s.ball ? copyBall(s.ball) : null,
    release: s.release ? { ...s.release } : null,
    path: s.path.map((p) => ({ ...p })),
    contact: { ...s.contact },
    last: s.last ? copyShot(s.last) : null,
    shots: s.shots.map(copyShot),
    totals: [s.totals[0], s.totals[1]],
    makes: [s.makes[0], s.makes[1]],
    attempts: [s.attempts[0], s.attempts[1]],
    longest: [s.longest[0], s.longest[1]],
    votes: [s.votes[0], s.votes[1]],
    lag: [s.lag[0], s.lag[1]],
  };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const pathPoint = (p: Vec3): Vec3 => ({ x: round3(p.x), y: round3(p.y), z: round3(p.z) });

/** Scores the turn's shot (or the lost turn) and shows the result. */
function land(s: BasketballState, made: boolean, power: number, aim: number, ev: BasketballEvent[], lost?: "time"): void {
  const seat = s.turn;
  const sp = SPOTS[s.spot];
  const swish = made && !s.contact.rim && !s.contact.board;
  const points = made ? sp.points + (swish ? SWISH_BONUS : 0) : 0;
  const shot: ShotResult = {
    seat,
    round: s.round,
    spot: s.spot,
    distance: sp.distance,
    made,
    swish,
    rim: s.contact.rim,
    board: s.contact.board,
    points,
    power,
    aim,
    window: makeWindow(s.spot),
    suddenDeath: s.suddenDeath,
  };
  if (lost) shot.lost = lost;
  s.last = shot;
  s.shots.push(shot);
  if (s.format === "unlimited" && s.shots.length > SHOTS_KEPT) s.shots.shift();
  // sudden death only decides the winner; the score stays the five spots' total
  if (!s.suddenDeath) {
    s.totals[seat] += points;
    s.attempts[seat]++;
    if (made) {
      s.makes[seat]++;
      s.longest[seat] = Math.max(s.longest[seat], sp.distance);
    }
  }
  s.phase = "result";
  s.phaseTick = 0;
  const { window: _w, ...rest } = shot;
  ev.push({ type: "basket", ...rest });
}

function finishMatch(s: BasketballState, winner: Seat | null, ev: BasketballEvent[]): void {
  s.winner = winner;
  s.draw = winner === null;
  s.phase = "over";
  s.phaseTick = 0;
  s.matches++;
  s.ball = null;
  ev.push({ type: "match", winner, draw: winner === null, score: [s.totals[0], s.totals[1]] });
}

/** Level after the five spots or a sudden-death round (user, 2026-11-08): both vote to draw or to play on. */
function startVote(s: BasketballState): void {
  s.phase = "tie-vote";
  s.phaseTick = 0;
  s.votes = [null, null];
  s.ball = null;
  s.path = [];
}

/** The vote is in (or its clock ran out): any "draw", or no vote, draws; both "continue" shoot a sudden-death round. */
function settleVote(s: BasketballState, ev: BasketballEvent[]): void {
  ev.push({ type: "tieVote", votes: [s.votes[0], s.votes[1]] });
  if (s.votes[0] === "continue" && s.votes[1] === "continue") {
    s.votes = [null, null];
    return startRound(s, Math.max(SPOTS.length, s.round + 1), ev);
  }
  finishMatch(s, null, ev);
}

/** After a result: the other seat's turn, the next spot, a tie vote or the end. */
function advance(s: BasketballState, ev: BasketballEvent[]): void {
  s.turnInRound++;
  if (s.format === "unlimited") {
    // a fresh random spot every turn, the seats taking turns
    s.turn = other(s.turn);
    return startRound(s, s.round + 1, ev);
  }
  if (s.turnInRound < 2) {
    s.turn = other(s.turn);
    startTurn(s);
    return;
  }
  if (s.round < SPOTS.length - 1) return startRound(s, s.round + 1, ev);
  if (s.round === SPOTS.length - 1) {
    if (s.totals[0] !== s.totals[1]) return finishMatch(s, s.totals[0] > s.totals[1] ? 0 : 1, ev);
    return startVote(s);
  }
  // sudden death: a make against a miss wins; both or neither, vote again
  const [a, b] = s.shots.slice(-2);
  if (a.made !== b.made) return finishMatch(s, a.made ? a.seat : b.seat, ev);
  startVote(s);
}

export function step(s: BasketballState, inputs: readonly BasketballInput[]): BasketballEvent[] {
  const ev: BasketballEvent[] = [];
  s.tick++;
  s.phaseTick++;
  for (const input of inputs) {
    // one vote per seat per vote, only while voting
    if (input.t === "tie" && s.phase === "tie-vote" && s.votes[input.seat] === null) s.votes[input.seat] = input.choice;
  }
  if (s.phase === "aim") {
    for (const input of inputs) {
      if (input.t === "tie" || s.phase !== "aim" || input.seat !== s.turn) continue;
      if (input.t === "set") {
        if (!s.set) {
          s.set = true;
          if (s.clockStart === null) s.clockStart = s.phaseTick;
        }
      } else if (input.t === "aim") {
        s.aim[input.seat] = clamp(input.aim, -1, 1);
      } else {
        const elapsed = clockElapsed(s);
        // after the buzzer, only within the seat's grace (its round trip, capped)
        if (elapsed !== null && elapsed >= SHOT_CLOCK_TICKS + s.lag[s.turn]) continue;
        const power = clamp(input.power, 0, 1);
        const aim = clamp(input.aim, -1, 1);
        s.aim[input.seat] = aim;
        s.ball = launch(s.spot, power, aim);
        s.path = [pathPoint(s.ball.pos)];
        s.contact = { rim: false, board: false };
        s.flightTicks = 0;
        s.phase = "flight";
        s.phaseTick = 0;
        s.release = { power, aim };
      }
    }
  }
  if (s.phase === "aim") {
    if (s.clockStart === null && s.phaseTick >= AUTO_CLOCK_TICKS) s.clockStart = AUTO_CLOCK_TICKS;
    const elapsed = clockElapsed(s);
    if (elapsed !== null && elapsed >= SHOT_CLOCK_TICKS + s.lag[s.turn]) land(s, false, 0, 0, ev, "time");
  } else if (s.phase === "flight" && s.ball) {
    s.flightTicks++;
    const r = flyTick(s.ball, s.contact);
    if (s.flightTicks % PATH_EVERY === 0 || r !== "flying") s.path.push(pathPoint(s.ball.pos));
    if (r !== "flying" || s.flightTicks >= MAX_FLIGHT_TICKS) {
      const shot = s.release ?? { power: 0, aim: 0 };
      land(s, r === "made", shot.power, shot.aim, ev);
    }
  } else if (s.phase === "result") {
    // the decided ball keeps falling (through the net, or to the floor) for the view
    if (s.ball) flyTick(s.ball, s.contact, true);
    if (s.phaseTick >= RESULT_TICKS) advance(s, ev);
  } else if (s.phase === "tie-vote" && (s.votes.includes("draw") || (s.votes[0] !== null && s.votes[1] !== null) || s.phaseTick >= VOTE_TICKS)) {
    settleVote(s, ev);
  } else if (s.phase === "over" && s.endless && s.phaseTick >= OVER_TICKS) {
    freshMatch(s, ev);
  }
  return ev;
}
