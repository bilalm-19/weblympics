// Track (task 26): run on the spot, race along a lane. One game, two events:
// sprint now, hurdles later (task 27). The lane already has an obstacle list,
// empty for the sprint, so hurdles adds to this sim instead of replacing it.
//
// Pure and deterministic (seed + input stream). The server owns every lane:
// a client only sends `step` events (which foot, and its own timestamp) and
// never a distance, a speed or a finish. Speed comes from the cadence the
// server counts on its own ticks; the seed only drives the bot.

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
/** Steps a second that give top speed; faster doesn't help. */
export const FULL_CADENCE = 8;
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

export type LaneSnapshot = Omit<Lane, "lastAt" | "tokens">;
export type TrackSnapshot = Omit<TrackState, "rng" | "lanes"> & { lanes: [LaneSnapshot, LaneSnapshot] };

export interface StepInput {
  t: "step";
  seat: Seat;
  side: Side;
  /** The client's own clock, ms; only has to rise by MIN_STEP_MS per counted step. */
  at: number;
}

export type TrackGameEvent =
  | { type: "go" }
  | { type: "finish"; seat: Seat; time: number }
  | { type: "race"; winner: Seat; times: [number | null, number | null] }
  | { type: "deadheat" };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export const otherSide = (side: Side | null): Side => (side === "left" ? "right" : "left");

/** Target speed for a smoothed cadence: linear up to FULL_CADENCE. */
export const speedFor = (cadence: number): number => MAX_SPEED * Math.min(1, Math.max(0, cadence) / FULL_CADENCE);

function freshLane(): Lane {
  return { distance: 0, speed: 0, cadence: 0, steps: 0, falseSteps: 0, fastSteps: 0, lastSide: null, lastAt: null, lastStepTick: 0, tokens: STEP_BURST, finish: null };
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
  s.lanes = [freshLane(), freshLane()];
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
    obstacles: [],
    lanes: [freshLane(), freshLane()],
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

const laneSnapshot = ({ lastAt: _a, tokens: _t, ...rest }: Lane): LaneSnapshot => ({ ...rest });

export function snapshot(s: TrackState): TrackSnapshot {
  const { rng: _r, lanes, ...rest } = s;
  return { ...rest, obstacles: [...s.obstacles], wins: [...s.wins], best: [...s.best], lanes: [laneSnapshot(lanes[0]), laneSnapshot(lanes[1])] };
}

export function cloneState(s: TrackState): TrackState {
  return { ...s, obstacles: [...s.obstacles], wins: [...s.wins], best: [...s.best], lanes: [{ ...s.lanes[0] }, { ...s.lanes[1] }] };
}

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

/** One tick of a lane's running, in place; returns the finish time if it crossed the line. */
function run(s: TrackState, lane: Lane): number | null {
  lane.tokens = Math.min(STEP_BURST, lane.tokens + MAX_CADENCE * DT);
  lane.cadence *= 1 - DT / CADENCE_TAU;
  if (lane.cadence < STILL_CADENCE) lane.cadence = 0;
  const target = speedFor(lane.cadence);
  lane.speed = target > lane.speed ? Math.min(target, lane.speed + ACCEL * DT) : Math.max(target, lane.speed - DECEL * DT);
  if (lane.finish !== null || lane.speed <= 0) return null;
  const before = lane.distance;
  lane.distance += lane.speed * DT;
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

export function step(s: TrackState, inputs: readonly StepInput[]): TrackGameEvent[] {
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
  for (const input of inputs) takeStep(s, input);
  const seats: Seat[] = s.solo ? [0] : [0, 1];
  for (const seat of seats) {
    const time = run(s, s.lanes[seat]);
    if (time !== null) {
      ev.push({ type: "finish", seat, time });
      if (s.firstFinish === null) s.firstFinish = s.phaseTick;
    }
  }
  const done = s.solo ? s.lanes[0].finish !== null : seats.every((seat) => s.lanes[seat].finish !== null);
  if (done || (s.firstFinish !== null && s.phaseTick - s.firstFinish >= FINISH_GRACE_TICKS)) endRace(s, ev);
  return ev;
}
