// Boxing (task 30, ADR 002): two boxers, jabs to the head or the body, a high
// or low guard, and a slip.
//
// Pure and deterministic (seed + input stream). The server owns every hit: a
// client only sends `punch` (which hand, head or body, its own timestamp),
// `guard` (high, low or none) and `slip` (left, right or none), never damage, a hit
// or a health. A jab has a short wind-up: it lands JAB_WINDUP_MS after it is
// thrown, and only on that tick does the sim look at the other boxer's guard
// and slip (`judge`). So a guard raised or a slip started when you see the
// jab coming still saves you, and nothing a client claims decides a hit. A
// slip is a held lean, like the guard (user, playtest 4: "it doesn't stay
// slipped"): a boxer leans for as long as they choose, head jabs miss the
// whole time, and they can't punch while leaning. The round clock is the sim's own ticks, so a room that
// stops stepping (the reconnect pause) freezes it. The seed only drives the
// bot.

export type Seat = 0 | 1;
export type Hand = "left" | "right";
/** Which way a slip leans. */
export type Side = "left" | "right";
export type Target = "head" | "body";
/** The guard: both fists by the face (high), forearms across the chest (low), or none. */
export type Guard = "high" | "low" | null;
export type Outcome = "clean" | "blocked" | "slipped";
export type Format = "bout" | "unlimited";

export const TICK_MS = 1000 / 60;
const ticks = (ms: number): number => Math.round(ms / TICK_MS);

// GUESSES to be playtested (ADR 002 leaves the numbers to the playtest).
export const HEALTH = 500;
/** A clean jab's damage. */
export const JAB_DAMAGE = 6;
/** Share of a jab's damage that gets through a guard of the right height (rounded to whole points). */
export const BLOCKED_SHARE = 0.2;
/**
 * Thrown to landing. Short: on camera the read already comes late in the
 * punch; 200 ms felt like lag (2026-11-05), and 150 ms still did (user,
 * 2026-11-08: "theres alot of delay"). A GUESS until the 2026-11-08 ?debug
 * recording.
 */
export const JAB_WINDUP_MS = 100;
export const JAB_WINDUP_TICKS = ticks(JAB_WINDUP_MS);
/**
 * A hand can throw again this long after its punch lands, so one hand jabs
 * at most every JAB_WINDUP_MS + RECOVER_MS = 200 ms (was 150 + 150 = 300;
 * user, 2026-11-08: "i cant throw lots of punches at once"). A GUESS until
 * the 2026-11-08 ?debug recording.
 */
export const RECOVER_MS = 100;
export const RECOVER_TICKS = ticks(RECOVER_MS);
/** The punch cap: punches a second the server counts per boxer, both hands together (was 4; 2026-11-08, a GUESS)... */
export const MAX_PUNCH_RATE = 6;
/** ...with this many allowed together (a one-two-three) before it bites (was 2; 2026-11-08, a GUESS). */
export const PUNCH_BURST = 3;
/** A punch's own timestamp must be at least this long after the last counted one. */
export const MIN_PUNCH_GAP_MS = 100;
export const ROUNDS = 3;
export const ROUND_TICKS = 30 * 60;
export const BREAK_TICKS = 5 * 60;
/** A finished bout stays up this long before the next (practice, unlimited). */
export const OVER_TICKS = 240;

export const damageFor = (outcome: Outcome): number =>
  outcome === "clean" ? JAB_DAMAGE : outcome === "blocked" ? Math.round(JAB_DAMAGE * BLOCKED_SHARE) : 0;

/**
 * What a jab does on landing, from the defender's state on that tick: a head
 * jab on a slipping boxer misses, a head jab on a high guard or a body jab on
 * a low guard is blocked, anything else is clean. The slip doesn't help
 * against a body jab.
 */
export function judge(target: Target, guard: Guard, slipping: boolean): Outcome {
  if (target === "head" && slipping) return "slipped";
  if ((target === "head" && guard === "high") || (target === "body" && guard === "low")) return "blocked";
  return "clean";
}

/** A jab in the air: thrown on `thrownTick`, lands (and is judged) on `landsTick`. */
export interface Punch {
  hand: Hand;
  target: Target;
  thrownTick: number;
  landsTick: number;
}

export interface Boxer {
  health: number;
  guard: Guard;
  /** Leaning to this side right now (a slip), or null when upright. */
  slip: Side | null;
  /** Each hand's jab in the air, or null. */
  punches: Record<Hand, Punch | null>;
  /** Tick from which each hand may throw again. */
  readyAt: Record<Hand, number>;
  /** Damage this boxer has dealt this bout. */
  dealt: number;
  thrown: number;
  /** Jabs that reached the other boxer (clean or blocked). */
  landed: number;
  /** Jabs that landed on a guard. */
  blocked: number;
  /** Head jabs this boxer made miss by slipping. */
  slipped: number;
  /** Punches dropped for coming faster than the cap. */
  capped: number;
  /** The last counted punch's own timestamp (client ms). */
  lastAt: number | null;
  /** The cap's bucket: refills at MAX_PUNCH_RATE, holds PUNCH_BURST. */
  tokens: number;
}

export type Phase = "round" | "break" | "over";
export type Result = "ko" | "decision" | "draw";

export interface Hit {
  /** Who threw it. */
  seat: Seat;
  hand: Hand;
  target: Target;
  outcome: Outcome;
  damage: number;
  tick: number;
}

export interface BoxingState {
  tick: number;
  format: Format;
  /** Practice and unlimited: a finished bout starts another. */
  endless: boolean;
  phase: Phase;
  phaseTick: number;
  /** 1..ROUNDS. */
  round: number;
  boxers: [Boxer, Boxer];
  /** Damage each seat dealt in each round so far (shown in the break). */
  roundDamage: Array<[number, number]>;
  lastHit: Hit | null;
  /** The last bout's winner (null for a draw or before one ends). */
  winner: Seat | null;
  result: Result | null;
  wins: [number, number];
  kos: [number, number];
  draws: number;
  bouts: number;
  rng: number;
}

export type BoxerSnapshot = Omit<Boxer, "lastAt" | "tokens">;
export type BoxingSnapshot = Omit<BoxingState, "rng" | "boxers"> & { boxers: [BoxerSnapshot, BoxerSnapshot] };

export type BoxingInput =
  | { t: "punch"; seat: Seat; hand: Hand; target: Target; /** the client's own clock, ms */ at: number }
  | { t: "guard"; seat: Seat; guard: Guard }
  | { t: "slip"; seat: Seat; side: Side | null };

export type BoxingEvent =
  | { type: "throw"; seat: Seat; hand: Hand; target: Target }
  | { type: "hit"; seat: Seat; hand: Hand; target: Target; outcome: Outcome; damage: number }
  | { type: "slip"; seat: Seat; side: Side | null }
  | { type: "round"; round: number; damage: [number, number] }
  | { type: "bout"; winner: Seat | null; result: Result; dealt: [number, number] };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

function freshBoxer(): Boxer {
  return {
    health: HEALTH,
    guard: null,
    slip: null,
    punches: { left: null, right: null },
    readyAt: { left: 0, right: 0 },
    dealt: 0,
    thrown: 0,
    landed: 0,
    blocked: 0,
    slipped: 0,
    capped: 0,
    lastAt: null,
    tokens: PUNCH_BURST,
  };
}

function startBout(s: BoxingState): void {
  s.phase = "round";
  s.phaseTick = 0;
  s.round = 1;
  s.boxers = [freshBoxer(), freshBoxer()];
  s.roundDamage = [[0, 0]];
  s.lastHit = null;
}

export interface StateOptions {
  format?: Format;
  endless?: boolean;
}

export function createState(seed: number, options: StateOptions = {}): BoxingState {
  const s: BoxingState = {
    tick: 0,
    format: options.format ?? "bout",
    endless: options.endless ?? false,
    phase: "round",
    phaseTick: 0,
    round: 1,
    boxers: [freshBoxer(), freshBoxer()],
    roundDamage: [[0, 0]],
    lastHit: null,
    winner: null,
    result: null,
    wins: [0, 0],
    kos: [0, 0],
    draws: 0,
    bouts: 0,
    rng: seed >>> 0,
  };
  startBout(s);
  return s;
}

const cloneBoxer = (b: Boxer): Boxer => ({
  ...b,
  punches: { left: b.punches.left && { ...b.punches.left }, right: b.punches.right && { ...b.punches.right } },
  readyAt: { ...b.readyAt },
});

const boxerSnapshot = (b: Boxer): BoxerSnapshot => {
  const { lastAt: _a, tokens: _t, ...rest } = cloneBoxer(b);
  return rest;
};

export function snapshot(s: BoxingState): BoxingSnapshot {
  const { rng: _r, boxers, ...rest } = s;
  return {
    ...rest,
    roundDamage: s.roundDamage.map((d) => [d[0], d[1]]),
    lastHit: s.lastHit && { ...s.lastHit },
    wins: [...s.wins],
    kos: [...s.kos],
    boxers: [boxerSnapshot(boxers[0]), boxerSnapshot(boxers[1])],
  };
}

export function cloneState(s: BoxingState): BoxingState {
  return {
    ...s,
    boxers: [cloneBoxer(s.boxers[0]), cloneBoxer(s.boxers[1])],
    roundDamage: s.roundDamage.map((d) => [d[0], d[1]]),
    lastHit: s.lastHit && { ...s.lastHit },
    wins: [...s.wins],
    kos: [...s.kos],
  };
}

/** Why a punch was or wasn't thrown. */
export type ThrowResult = "ok" | "not-round" | "guarding" | "slipping" | "hand-busy" | "too-fast";

/**
 * Throws one jab, in place, or says why not. Not between rounds, not with a
 * guard up, not while slipping, not with a hand still out or recovering, and
 * not faster than the cap (by the punch's own timestamp and by the server's
 * bucket), so flailing buys nothing.
 */
export function throwPunch(s: BoxingState, input: Extract<BoxingInput, { t: "punch" }>): ThrowResult {
  const b = s.boxers[input.seat];
  if (s.phase !== "round") return "not-round";
  if (b.guard !== null) return "guarding";
  if (b.slip !== null) return "slipping";
  if (b.punches[input.hand] !== null || s.tick < b.readyAt[input.hand]) return "hand-busy";
  if ((b.lastAt !== null && !(input.at - b.lastAt >= MIN_PUNCH_GAP_MS)) || b.tokens < 1) {
    b.capped++;
    return "too-fast";
  }
  b.tokens -= 1;
  b.lastAt = input.at;
  b.thrown++;
  const landsTick = s.tick + JAB_WINDUP_TICKS;
  b.punches[input.hand] = { hand: input.hand, target: input.target, thrownTick: s.tick, landsTick };
  b.readyAt[input.hand] = landsTick + RECOVER_TICKS;
  return "ok";
}

/** Why a lean did or didn't change. */
export type SlipResult = "ok" | "not-round" | "same";

/**
 * Leans to a side or comes back upright (null), in place, or says why not:
 * only in a round. The lean lasts until the boxer sends another (user,
 * playtest 4: it follows the player and protects from head jabs the whole
 * time). A guard may stay up (playtest 4: a boxer leans with their hands up):
 * while leaning a head jab misses and a body jab meets the guard as usual.
 */
export function setSlip(s: BoxingState, input: Extract<BoxingInput, { t: "slip" }>): SlipResult {
  const b = s.boxers[input.seat];
  if (s.phase !== "round") return "not-round";
  if (b.slip === input.side) return "same";
  b.slip = input.side;
  return "ok";
}

/** A guard change; it leaves a slip alone (a guard and a slip go together, playtest 4). */
function setGuard(b: Boxer, guard: Guard): void {
  b.guard = guard;
}

function endBout(s: BoxingState, ev: BoxingEvent[], ko: boolean): void {
  const [a, b] = s.boxers;
  let winner: Seat | null;
  if (ko && (a.health <= 0) !== (b.health <= 0)) winner = a.health <= 0 ? 1 : 0;
  else winner = a.dealt === b.dealt ? null : a.dealt > b.dealt ? 0 : 1;
  const result: Result = winner === null ? "draw" : ko && (a.health <= 0) !== (b.health <= 0) ? "ko" : "decision";
  s.winner = winner;
  s.result = result;
  if (winner === null) s.draws++;
  else {
    s.wins[winner]++;
    if (result === "ko") s.kos[winner]++;
  }
  for (const boxer of s.boxers) {
    boxer.punches = { left: null, right: null };
    boxer.slip = null;
  }
  s.phase = "over";
  s.phaseTick = 0;
  s.bouts++;
  ev.push({ type: "bout", winner, result, dealt: [a.dealt, b.dealt] });
}

/** Lands every jab due this tick against the defender's guard and slip as they are now; both sides at once. */
function land(s: BoxingState, ev: BoxingEvent[]): void {
  const due: Hit[] = [];
  for (const seat of [0, 1] as const) {
    const b = s.boxers[seat];
    for (const hand of ["left", "right"] as const) {
      const p = b.punches[hand];
      if (!p || p.landsTick > s.tick) continue;
      b.punches[hand] = null;
      const to = s.boxers[other(seat)];
      const outcome = judge(p.target, to.guard, to.slip !== null);
      due.push({ seat, hand, target: p.target, outcome, damage: damageFor(outcome), tick: s.tick });
    }
  }
  for (const hit of due) {
    const by = s.boxers[hit.seat];
    const to = s.boxers[other(hit.seat)];
    to.health = Math.max(0, to.health - hit.damage);
    by.dealt += hit.damage;
    if (hit.outcome === "slipped") to.slipped++;
    else by.landed++;
    if (hit.outcome === "blocked") by.blocked++;
    s.roundDamage[s.round - 1][hit.seat] += hit.damage;
    s.lastHit = hit;
    ev.push({ type: "hit", seat: hit.seat, hand: hit.hand, target: hit.target, outcome: hit.outcome, damage: hit.damage });
  }
}

export function step(s: BoxingState, inputs: readonly BoxingInput[]): BoxingEvent[] {
  const ev: BoxingEvent[] = [];
  s.tick++;
  s.phaseTick++;
  if (s.phase === "over") {
    if (s.endless && s.phaseTick >= OVER_TICKS) startBout(s);
    return ev;
  }
  if (s.phase === "break") {
    for (const input of inputs) if (input.t === "guard") setGuard(s.boxers[input.seat], input.guard);
    if (s.phaseTick >= BREAK_TICKS) {
      s.phase = "round";
      s.phaseTick = 0;
      s.round++;
      s.roundDamage.push([0, 0]);
    }
    return ev;
  }
  for (const b of s.boxers) {
    b.tokens = Math.min(PUNCH_BURST, b.tokens + MAX_PUNCH_RATE / 60);
  }
  // inputs in order, so "guard down, then jab" in one tick throws the jab
  for (const input of inputs) {
    if (input.t === "guard") setGuard(s.boxers[input.seat], input.guard);
    else if (input.t === "slip") {
      if (setSlip(s, input) === "ok") ev.push({ type: "slip", seat: input.seat, side: input.side });
    } else if (throwPunch(s, input) === "ok") ev.push({ type: "throw", seat: input.seat, hand: input.hand, target: input.target });
  }
  land(s, ev);
  if (s.boxers.some((b) => b.health <= 0)) {
    endBout(s, ev, true);
    return ev;
  }
  if (s.phaseTick >= ROUND_TICKS) {
    // the bell: punches still in the air don't count, and a lean ends
    for (const b of s.boxers) {
      b.punches = { left: null, right: null };
      b.slip = null;
    }
    const done = s.roundDamage[s.round - 1];
    ev.push({ type: "round", round: s.round, damage: [done[0], done[1]] });
    if (s.round >= ROUNDS) endBout(s, ev, false);
    else {
      s.phase = "break";
      s.phaseTick = 0;
      for (const b of s.boxers) {
        b.readyAt = { left: 0, right: 0 };
      }
    }
  }
  return ev;
}
