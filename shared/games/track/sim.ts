// Track (task 26): run on the spot, race along a lane. One game, two events:
// the sprint (task 26) and hurdles (task 27). The lane has an obstacle list,
// empty for the sprint and ten hurdles for hurdles, so one sim runs both.
//
// Pure and deterministic (seed + input stream). The server owns every lane:
// a client only sends `step` events (which foot, and its own timestamp) and,
// in hurdles, `jump` events (its own timestamp), never a distance, a speed, a
// clear or a finish. Speed comes from the cadence the server counts on its
// own ticks; a jump puts the runner in the air for a fixed time from the tick
// it arrives, and the sim says whether they were in the air as they reached
// each hurdle. The seed only drives the bot.

export type Seat = 0 | 1;
export type Side = "left" | "right";
export type TrackEvent = "sprint" | "hurdles";
export type Format = "race" | "unlimited";

export const DT = 1 / 60;
export const TICK_MS = 1000 / 60;
/** Metres from the start to the line. */
export const LANE_LENGTH = 100;
/** Top speed, m/s, reached at FULL_CADENCE. */
export const MAX_SPEED = 10;
/**
 * Steps a second that give top speed; faster doesn't help. 8 then 6 were too
 * many pumps for the arms (playtests 2026-11-05 and 2026-11-08); 4 is a
 * GUESS until the recordings (docs/camera-playtest.md, "Track's and hurdles' moves").
 */
export const FULL_CADENCE = 4;
/** The human cap: steps a second the server will count, at most. */
export const MAX_CADENCE = 10;
/** A step's own timestamp must be at least this long after the last counted one. */
export const MIN_STEP_MS = 1000 / MAX_CADENCE;
/** Steps that may arrive together (network bunching) before the cap bites. */
export const STEP_BURST = 2;
/** Seconds over which the cadence is smoothed; also how fast it decays when you stop. */
export const CADENCE_TAU = 0.6;
/** m/s^2: how fast speed follows the cadence up, and down. */
export const ACCEL = 4;
export const DECEL = 5;
/** Below this many steps a second you are standing still. */
export const STILL_CADENCE = 0.3;
/** "On your marks... set" before the gun; steps before it are ignored. */
export const SET_TICKS = 90;
/** After the first runner finishes, the other has this long before a DNF. */
export const FINISH_GRACE_TICKS = 5 * 60;
/** A finished race stays up this long before the next (practice, unlimited). */
export const OVER_TICKS = 240;

// Hurdles (task 27). FIRST GUESSES until a playtest: ten hurdles 8.5 m apart
// (the real 110 m race is 13.72 m then 9.14 m; ours is 100 m).
export const HURDLE_COUNT = 10;
export const HURDLE_FIRST = 13;
export const HURDLE_SPACING = 8.5;
/** A jump keeps you in the air this many ticks (0.4 s), whatever your speed: faster runners fly further. */
export const AIR_TICKS = 24;
/** Each jump costs this much speed, m/s, so jumping all the time is slower than jumping at the hurdles. */
export const JUMP_COST = 1;
/** Reaching a hurdle on the ground knocks it down and leaves this share of your speed (a stumble). */
export const HIT_KEEP = 0.4;
/** The jump cap: a jump's own timestamp must be this long after the last counted one... */
export const MIN_JUMP_MS = 500;
/** ...and the server's bucket refills at this many jumps a second, holding one. */
export const JUMPS_PER_SECOND = 2;

/** Where the hurdles stand in an event, metres from the start. */
export const obstaclesFor = (event: TrackEvent): number[] =>
  event === "hurdles" ? Array.from({ length: HURDLE_COUNT }, (_, i) => HURDLE_FIRST + i * HURDLE_SPACING) : [];

/** A hurdle in one lane: standing, cleared, or knocked down. */
export type HurdleMark = "up" | "cleared" | "down";

export interface Lane {
  /** Metres run. */
  distance: number;
  /** m/s. */
  speed: number;
  /** Smoothed steps a second, as the server counts them. */
  cadence: number;
  /** Steps counted this race. */
  steps: number;
  /** Steps ignored for landing on the same foot twice. */
  falseSteps: number;
  /** Steps ignored for coming faster than the human cap. */
  fastSteps: number;
  lastSide: Side | null;
  /** The last counted step's own timestamp (client ms). */
  lastAt: number | null;
  /** Tick of the last counted step. */
  lastStepTick: number;
  /** The cap's bucket: refills at MAX_CADENCE, holds STEP_BURST. */
  tokens: number;
  /** Seconds from the gun to the line, or null. */
  finish: number | null;
  /** Hurdles: each hurdle in this lane, standing, cleared or knocked down. */
  hurdles: HurdleMark[];
  cleared: number;
  hit: number;
  /** Ticks left in the air; 0 on the ground. */
  air: number;
  /** Jumps counted this race. */
  jumps: number;
  /** Jumps ignored for coming faster than the jump cap (or while in the air). */
  fastJumps: number;
  /** Where the last counted jump took off, metres (-1: none yet). */
  lastJumpDist: number;
  /** The last counted jump's own timestamp (client ms). */
  lastJumpAt: number | null;
  /** The jump cap's bucket. */
  jumpTokens: number;
}

export type Phase = "set" | "running" | "over";

export interface TrackState {
  tick: number;
  event: TrackEvent;
  format: Format;
  /** Practice and unlimited: a finished race starts another. */
  endless: boolean;
  /** One runner (in-page practice): the race ends when lane 0 finishes. */
  solo: boolean;
  phase: Phase;
  phaseTick: number;
  length: number;
  /** Hurdle positions in metres along the lane; empty for the sprint. */
  obstacles: number[];
  lanes: [Lane, Lane];
  /** Tick (from the gun) of the first finish, or null. */
  firstFinish: number | null;
  /** The last race's winner, or null before one ends. */
  winner: Seat | null;
  /** Races won this game. */
  wins: [number, number];
  /** Best time per seat this game, seconds. */
  best: [number | null, number | null];
  /** Races finished in this game. */
  races: number;
  rng: number;
}

export type LaneSnapshot = Omit<Lane, "lastAt" | "tokens" | "lastJumpAt" | "jumpTokens">;
export type TrackSnapshot = Omit<TrackState, "rng" | "lanes"> & { lanes: [LaneSnapshot, LaneSnapshot] };

export interface StepInput {
  t: "step";
  seat: Seat;
  side: Side;
  /** The client's own clock, ms; only has to rise by MIN_STEP_MS per counted step. */
  at: number;
}

export interface JumpInput {
  t: "jump";
  seat: Seat;
  /** The client's own clock, ms; only has to rise by MIN_JUMP_MS per counted jump. */
  at: number;
}

export type TrackInput = StepInput | JumpInput;

export type TrackGameEvent =
  | { type: "go" }
  | { type: "hurdle"; seat: Seat; index: number; cleared: boolean }
  | { type: "finish"; seat: Seat; time: number }
  | { type: "race"; winner: Seat; times: [number | null, number | null] }
  | { type: "deadheat" };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export const otherSide = (side: Side | null): Side => (side === "left" ? "right" : "left");

/** Target speed for a smoothed cadence: linear up to FULL_CADENCE. */
export const speedFor = (cadence: number): number => MAX_SPEED * Math.min(1, Math.max(0, cadence) / FULL_CADENCE);

function freshLane(hurdles: number): Lane {
  return {
    distance: 0,
    speed: 0,
    cadence: 0,
    steps: 0,
    falseSteps: 0,
    fastSteps: 0,
    lastSide: null,
    lastAt: null,
    lastStepTick: 0,
    tokens: STEP_BURST,
    finish: null,
    hurdles: Array.from({ length: hurdles }, () => "up" as const),
    cleared: 0,
    hit: 0,
    air: 0,
    jumps: 0,
    fastJumps: 0,
    lastJumpDist: -1,
    lastJumpAt: null,
    jumpTokens: 1,
  };
}

export interface StateOptions {
  format?: Format;
  endless?: boolean;
  solo?: boolean;
  event?: TrackEvent;
}

function startRace(s: TrackState): void {
  s.phase = "set";
  s.phaseTick = 0;
  s.lanes = [freshLane(s.obstacles.length), freshLane(s.obstacles.length)];
  s.firstFinish = null;
}

export function createState(seed: number, options: StateOptions = {}): TrackState {
  const s: TrackState = {
    tick: 0,
    event: options.event ?? "sprint",
    format: options.format ?? "race",
    endless: options.endless ?? false,
    solo: options.solo ?? false,
    phase: "set",
    phaseTick: 0,
    length: LANE_LENGTH,
    obstacles: obstaclesFor(options.event ?? "sprint"),
    lanes: [freshLane(0), freshLane(0)],
    firstFinish: null,
    winner: null,
    wins: [0, 0],
    best: [null, null],
    races: 0,
    rng: seed >>> 0,
  };
  startRace(s);
  return s;
}

const laneSnapshot = ({ lastAt: _a, tokens: _t, lastJumpAt: _j, jumpTokens: _k, ...rest }: Lane): LaneSnapshot => ({ ...rest, hurdles: [...rest.hurdles] });

export function snapshot(s: TrackState): TrackSnapshot {
  const { rng: _r, lanes, ...rest } = s;
  return { ...rest, obstacles: [...s.obstacles], wins: [...s.wins], best: [...s.best], lanes: [laneSnapshot(lanes[0]), laneSnapshot(lanes[1])] };
}

export function cloneState(s: TrackState): TrackState {
  return { ...s, obstacles: [...s.obstacles], wins: [...s.wins], best: [...s.best], lanes: [cloneLane(s.lanes[0]), cloneLane(s.lanes[1])] };
}

const cloneLane = (l: Lane): Lane => ({ ...l, hurdles: [...l.hurdles] });

/** Why a step was or wasn't counted. */
export type StepResult = "ok" | "not-running" | "same-foot" | "too-fast";

/**
 * Counts one step, in place, or says why not. A step must land on the other
 * foot (a repeat is ignored, not punished), its own timestamp must be at
 * least MIN_STEP_MS after the last counted one, and the server's bucket must
 * have room: so shaking a phone or mashing one key buys nothing.
 */
export function takeStep(s: TrackState, input: StepInput): StepResult {
  const lane = s.lanes[input.seat];
  if (s.phase !== "running" || lane.finish !== null) return "not-running";
  if (s.solo && input.seat !== 0) return "not-running";
  if (lane.lastSide === input.side) {
    lane.falseSteps++;
    return "same-foot";
  }
  if ((lane.lastAt !== null && !(input.at - lane.lastAt >= MIN_STEP_MS)) || lane.tokens < 1) {
    lane.fastSteps++;
    return "too-fast";
  }
  lane.tokens -= 1;
  lane.lastSide = input.side;
  lane.lastAt = input.at;
  lane.lastStepTick = s.tick;
  lane.steps++;
  lane.cadence += 1 / CADENCE_TAU;
  return "ok";
}

/** Why a jump was or wasn't counted. */
export type JumpResult = "ok" | "not-running" | "no-hurdles" | "in-air" | "too-fast";

/**
 * Takes off, in place, or says why not. Only in hurdles, after the gun and
 * before your finish; not while already in the air; and under the jump cap
 * (by the jump's own timestamp and the server's bucket), so mashing the key
 * buys nothing. A jump puts you in the air for AIR_TICKS from this tick and
 * costs JUMP_COST of speed, hurdle or not.
 */
export function takeJump(s: TrackState, input: JumpInput): JumpResult {
  const lane = s.lanes[input.seat];
  if (s.phase !== "running" || lane.finish !== null) return "not-running";
  if (s.solo && input.seat !== 0) return "not-running";
  if (s.obstacles.length === 0) return "no-hurdles";
  if (lane.air > 0) {
    lane.fastJumps++;
    return "in-air";
  }
  if ((lane.lastJumpAt !== null && !(input.at - lane.lastJumpAt >= MIN_JUMP_MS)) || lane.jumpTokens < 1) {
    lane.fastJumps++;
    return "too-fast";
  }
  lane.jumpTokens -= 1;
  lane.lastJumpAt = input.at;
  lane.lastJumpDist = lane.distance;
  lane.air = AIR_TICKS;
  lane.jumps++;
  lane.speed = Math.max(0, lane.speed - JUMP_COST);
  return "ok";
}

/** The index of the next hurdle ahead of `distance` in `s`, or -1 past the last. */
export const nextHurdle = (s: Pick<TrackState, "obstacles">, distance: number): number => s.obstacles.findIndex((x) => x > distance);

/** Hurdles the lane reached this tick, between `before` and its distance now: cleared in the air, knocked down on the ground. */
function hurdlesCrossed(s: TrackState, seat: Seat, lane: Lane, before: number, ev: TrackGameEvent[]): void {
  for (let i = 0; i < s.obstacles.length; i++) {
    const x = s.obstacles[i];
    if (!(before < x && x <= lane.distance) || lane.hurdles[i] !== "up") continue;
    const cleared = lane.air > 0;
    lane.hurdles[i] = cleared ? "cleared" : "down";
    if (cleared) lane.cleared++;
    else {
      lane.hit++;
      lane.speed *= HIT_KEEP;
    }
    ev.push({ type: "hurdle", seat, index: i, cleared });
  }
}

/** One tick of a lane's running, in place; returns the finish time if it crossed the line. */
function run(s: TrackState, seat: Seat, lane: Lane, ev: TrackGameEvent[]): number | null {
  lane.jumpTokens = Math.min(1, lane.jumpTokens + JUMPS_PER_SECOND * DT);
  lane.tokens = Math.min(STEP_BURST, lane.tokens + MAX_CADENCE * DT);
  lane.cadence *= 1 - DT / CADENCE_TAU;
  if (lane.cadence < STILL_CADENCE) lane.cadence = 0;
  const target = speedFor(lane.cadence);
  lane.speed = target > lane.speed ? Math.min(target, lane.speed + ACCEL * DT) : Math.max(target, lane.speed - DECEL * DT);
  if (lane.finish !== null || lane.speed <= 0) {
    if (lane.air > 0) lane.air--;
    return null;
  }
  const before = lane.distance;
  lane.distance += lane.speed * DT;
  hurdlesCrossed(s, seat, lane, before, ev);
  if (lane.air > 0) lane.air--;
  if (lane.distance < s.length) return null;
  // the moment it crossed, within this tick, so ties are rare and times exact
  const frac = (s.length - before) / (lane.distance - before);
  lane.distance = s.length;
  lane.finish = Math.round(((s.phaseTick - 1 + frac) * DT) * 1000) / 1000;
  return lane.finish;
}

function endRace(s: TrackState, ev: TrackGameEvent[]): void {
  const times: [number | null, number | null] = [s.lanes[0].finish, s.lanes[1].finish];
  if (s.solo) {
    s.winner = 0;
  } else {
    const [a, b] = times;
    if (a !== null && b !== null && a === b) {
      // a dead heat: run it again (it isn't a result)
      ev.push({ type: "deadheat" });
      startRace(s);
      return;
    }
    s.winner = b === null || (a !== null && a < b) ? 0 : 1;
    s.wins[s.winner]++;
  }
  for (const seat of [0, 1] as const) {
    const t = times[seat];
    if (t !== null && (s.best[seat] === null || t < s.best[seat]!)) s.best[seat] = t;
  }
  s.phase = "over";
  s.phaseTick = 0;
  s.races++;
  ev.push({ type: "race", winner: s.winner, times });
}

export function step(s: TrackState, inputs: readonly TrackInput[]): TrackGameEvent[] {
  const ev: TrackGameEvent[] = [];
  s.tick++;
  s.phaseTick++;
  if (s.phase === "set" && s.phaseTick >= SET_TICKS) {
    s.phase = "running";
    s.phaseTick = 0;
    ev.push({ type: "go" });
    return ev;
  }
  if (s.phase === "over") {
    if (s.endless && s.phaseTick >= OVER_TICKS) startRace(s);
    return ev;
  }
  if (s.phase !== "running") return ev;
  for (const input of inputs) {
    if (input.t === "jump") takeJump(s, input);
    else takeStep(s, input);
  }
  const seats: Seat[] = s.solo ? [0] : [0, 1];
  for (const seat of seats) {
    const time = run(s, seat, s.lanes[seat], ev);
    if (time !== null) {
      ev.push({ type: "finish", seat, time });
      if (s.firstFinish === null) s.firstFinish = s.phaseTick;
    }
  }
  const done = s.solo ? s.lanes[0].finish !== null : seats.every((seat) => s.lanes[seat].finish !== null);
  if (done || (s.firstFinish !== null && s.phaseTick - s.firstFinish >= FINISH_GRACE_TICKS)) endRace(s, ev);
  return ev;
}
