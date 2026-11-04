// Boxing (task 30): two boxers, jab and hook, guard both hands at the face.
//
// Pure and deterministic (seed + input stream). The server owns every hit: a
// client only sends `punch` (jab or hook, which hand, its own timestamp) and
// `guard` (up or down), never damage, a hit or a health. A punch has a
// wind-up: it lands JAB_WINDUP_MS / HOOK_WINDUP_MS after it is thrown, and
// only then does the sim look at the other boxer's guard, on that tick. So a
// guard raised when you see the punch coming still saves you, and nothing a
// client claims decides a hit. The round clock is the sim's own ticks, so a
// room that stops stepping (the reconnect pause) freezes it. The seed only
// drives the bot.

export type Seat = 0 | 1;
export type Hand = "left" | "right";
export type PunchKind = "jab" | "hook";
export type Format = "bout" | "unlimited";

export const TICK_MS = 1000 / 60;
const ticks = (ms: number): number => Math.round(ms / TICK_MS);

// GUESSES to be playtested, like track's numbers.
export const HEALTH = 100;
export const DAMAGE: Record<PunchKind, number> = { jab: 6, hook: 14 };
/** Share of a punch's damage that gets through a guard (rounded to whole points). */
export const BLOCKED_SHARE = 0.2;
export const WINDUP_MS: Record<PunchKind, number> = { jab: 200, hook: 350 };
export const WINDUP_TICKS: Record<PunchKind, number> = { jab: ticks(WINDUP_MS.jab), hook: ticks(WINDUP_MS.hook) };
/** A hand can throw again this long after its punch lands. */
export const RECOVER_MS = 150;
export const RECOVER_TICKS = ticks(RECOVER_MS);
/** The punch cap: punches a second the server counts per boxer, both hands together... */
export const MAX_PUNCH_RATE = 4;
/** ...with this many allowed together (a one-two) before it bites. */
export const PUNCH_BURST = 2;
/** A punch's own timestamp must be at least this long after the last counted one. */
export const MIN_PUNCH_GAP_MS = 100;
export const ROUNDS = 3;
export const ROUND_TICKS = 30 * 60;
export const BREAK_TICKS = 5 * 60;
/** A finished bout stays up this long before the next (practice, unlimited). */
export const OVER_TICKS = 240;

export const damageFor = (kind: PunchKind, guarded: boolean): number => (guarded ? Math.round(DAMAGE[kind] * BLOCKED_SHARE) : DAMAGE[kind]);

/** A punch in the air: thrown on `thrownTick`, lands (and is judged) on `landsTick`. */
export interface Punch {
  kind: PunchKind;
  hand: Hand;
  thrownTick: number;
  landsTick: number;
}

export interface Boxer {
  health: number;
  guard: boolean;
  /** Each hand's punch in the air, or null. */
  punches: Record<Hand, Punch | null>;
  /** Tick from which each hand may throw again. */
  readyAt: Record<Hand, number>;
  /** Damage this boxer has dealt this bout. */
  dealt: number;
  thrown: number;
  landed: number;
  /** Punches that landed on a guard. */
  blocked: number;
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
  kind: PunchKind;
  hand: Hand;
  guarded: boolean;
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
  | { t: "punch"; seat: Seat; kind: PunchKind; hand: Hand; /** the client's own clock, ms */ at: number }
  | { t: "guard"; seat: Seat; up: boolean };

export type BoxingEvent =
  | { type: "throw"; seat: Seat; kind: PunchKind; hand: Hand }
  | { type: "hit"; seat: Seat; kind: PunchKind; hand: Hand; guarded: boolean; damage: number }
  | { type: "round"; round: number; damage: [number, number] }
  | { type: "bout"; winner: Seat | null; result: Result; dealt: [number, number] };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

function freshBoxer(): Boxer {
  return {
    health: HEALTH,
    guard: false,
    punches: { left: null, right: null },
    readyAt: { left: 0, right: 0 },
    dealt: 0,
    thrown: 0,
    landed: 0,
    blocked: 0,
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
export type ThrowResult = "ok" | "not-round" | "guarding" | "hand-busy" | "too-fast";

/**
 * Throws one punch, in place, or says why not. Not between rounds, not with
 * the guard up, not with a hand still out or recovering, and not faster than
 * the cap (by the punch's own timestamp and by the server's bucket), so
 * flailing buys nothing.
 */
export function throwPunch(s: BoxingState, input: Extract<BoxingInput, { t: "punch" }>): ThrowResult {
  const b = s.boxers[input.seat];
  if (s.phase !== "round") return "not-round";
  if (b.guard) return "guarding";
  if (b.punches[input.hand] !== null || s.tick < b.readyAt[input.hand]) return "hand-busy";
  if ((b.lastAt !== null && !(input.at - b.lastAt >= MIN_PUNCH_GAP_MS)) || b.tokens < 1) {
    b.capped++;
    return "too-fast";
  }
  b.tokens -= 1;
  b.lastAt = input.at;
  b.thrown++;
  const landsTick = s.tick + WINDUP_TICKS[input.kind];
  b.punches[input.hand] = { kind: input.kind, hand: input.hand, thrownTick: s.tick, landsTick };
  b.readyAt[input.hand] = landsTick + RECOVER_TICKS;
  return "ok";
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
  for (const boxer of s.boxers) boxer.punches = { left: null, right: null };
  s.phase = "over";
  s.phaseTick = 0;
  s.bouts++;
  ev.push({ type: "bout", winner, result, dealt: [a.dealt, b.dealt] });
}

/** Lands every punch due this tick against the guard as it is now; both sides at once. */
function land(s: BoxingState, ev: BoxingEvent[]): void {
  const due: Hit[] = [];
  for (const seat of [0, 1] as const) {
    const b = s.boxers[seat];
    for (const hand of ["left", "right"] as const) {
      const p = b.punches[hand];
      if (!p || p.landsTick > s.tick) continue;
      b.punches[hand] = null;
      const guarded = s.boxers[other(seat)].guard;
      due.push({ seat, kind: p.kind, hand, guarded, damage: damageFor(p.kind, guarded), tick: s.tick });
    }
  }
  for (const hit of due) {
    const by = s.boxers[hit.seat];
    const to = s.boxers[other(hit.seat)];
    to.health = Math.max(0, to.health - hit.damage);
    by.dealt += hit.damage;
    by.landed++;
    if (hit.guarded) by.blocked++;
    s.roundDamage[s.round - 1][hit.seat] += hit.damage;
    s.lastHit = hit;
    ev.push({ type: "hit", seat: hit.seat, kind: hit.kind, hand: hit.hand, guarded: hit.guarded, damage: hit.damage });
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
    for (const input of inputs) if (input.t === "guard") s.boxers[input.seat].guard = input.up;
    if (s.phaseTick >= BREAK_TICKS) {
      s.phase = "round";
      s.phaseTick = 0;
      s.round++;
      s.roundDamage.push([0, 0]);
    }
    return ev;
  }
  for (const b of s.boxers) b.tokens = Math.min(PUNCH_BURST, b.tokens + MAX_PUNCH_RATE / 60);
  // inputs in order, so "guard down, then jab" in one tick throws the jab
  for (const input of inputs) {
    if (input.t === "guard") s.boxers[input.seat].guard = input.up;
    else if (throwPunch(s, input) === "ok") ev.push({ type: "throw", seat: input.seat, kind: input.kind, hand: input.hand });
  }
  land(s, ev);
  if (s.boxers.some((b) => b.health <= 0)) {
    endBout(s, ev, true);
    return ev;
  }
  if (s.phaseTick >= ROUND_TICKS) {
    // the bell: punches still in the air don't count
    for (const b of s.boxers) b.punches = { left: null, right: null };
    const done = s.roundDamage[s.round - 1];
    ev.push({ type: "round", round: s.round, damage: [done[0], done[1]] });
    if (s.round >= ROUNDS) endBout(s, ev, false);
    else {
      s.phase = "break";
      s.phaseTick = 0;
      for (const b of s.boxers) b.readyAt = { left: 0, right: 0 };
    }
  }
  return ev;
}
