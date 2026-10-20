import { COURT } from "../../../shared/games/tennis/sim.ts";

// Training's endless "hit the spot" mode (task 21), kept pure so it can be
// tested: where the spot goes, how close a return landed, and the streak.
// The spot is on the machine's half (z < 0); training is always seat 0.

/** Inside this distance of the spot's centre is a bullseye. */
export const BULLSEYE_RADIUS = 0.5;
/** The drawn ring: a landing inside it is "on the spot", keeps the streak going and moves the spot. */
export const SPOT_RADIUS = 1.2;
/** Up to here is "near": close, but the streak breaks. */
export const NEAR_RADIUS = 2.5;
/** The spot moves after this many balls without being hit. */
export const MOVE_EVERY = 3;

/** Where the spot may go: inside the singles lines with a margin, past the net's shadow. */
export const SPOT_AREA = {
  minX: -COURT.halfW + 0.9,
  maxX: COURT.halfW - 0.9,
  minZ: -COURT.halfL + 1,
  maxZ: -2.2,
} as const;

/** A number in [0, 1) from the seed and an index; the same inputs always give the same number. */
function unit(seed: number, i: number, salt: number): number {
  let t = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface Spot {
  x: number;
  z: number;
}

/**
 * Spot number `n` for this seed. Each spot is at least 2.5 m from the one
 * before, so a move is always a visible move.
 */
export function spotTarget(seed: number, n: number): Spot {
  const at = (k: number, tries: number): Spot => ({
    x: SPOT_AREA.minX + unit(seed, k, 11 + tries * 2) * (SPOT_AREA.maxX - SPOT_AREA.minX),
    z: SPOT_AREA.minZ + unit(seed, k, 12 + tries * 2) * (SPOT_AREA.maxZ - SPOT_AREA.minZ),
  });
  const first = at(0, 0);
  let prev = first;
  for (let k = 1; k <= n; k++) {
    let next = at(k, 0);
    for (let tries = 1; tries < 8 && Math.hypot(next.x - prev.x, next.z - prev.z) < 2.5; tries++) next = at(k, tries);
    prev = next;
  }
  return prev;
}

export type Closeness = "bullseye" | "on" | "near" | "wide" | "out" | "net" | "none";

export interface Landing {
  x: number;
  z: number;
  in: boolean;
  net: boolean;
}

/** How close a return landed to the spot: a word, a ring colour and the distance (null when it never landed in). */
export function closeness(landing: Landing | null, spot: Spot): { kind: Closeness; distance: number | null } {
  if (!landing) return { kind: "none", distance: null };
  if (landing.net) return { kind: "net", distance: null };
  if (!landing.in) return { kind: "out", distance: null };
  const d = Math.hypot(landing.x - spot.x, landing.z - spot.z);
  const kind: Closeness = d <= BULLSEYE_RADIUS ? "bullseye" : d <= SPOT_RADIUS ? "on" : d <= NEAR_RADIUS ? "near" : "wide";
  return { kind, distance: d };
}

export const CLOSENESS_WORDS: Record<Closeness, string> = {
  bullseye: "Bullseye!",
  on: "On the spot",
  near: "Close",
  wide: "Wide",
  out: "Out",
  net: "Into the net",
  none: "No return",
};

/** The ring colour for each result (gold, green, yellow, grey, red). */
export const CLOSENESS_COLOUR: Record<Closeness, number> = {
  bullseye: 0xfcb131,
  on: 0x00a651,
  near: 0xffe066,
  wide: 0xc9d0d8,
  out: 0xee334e,
  net: 0xee334e,
  none: 0xee334e,
};

/** What the player reads after a ball: "Close: 1.9 m", "Out". */
export function resultText(r: { kind: Closeness; distance: number | null }): string {
  const word = CLOSENESS_WORDS[r.kind];
  return r.distance === null ? word : `${word}: ${r.distance.toFixed(1)} m`;
}

export interface SpotState {
  /** Which spot (spotTarget's n) is showing. */
  n: number;
  /** Balls since the spot last moved. */
  balls: number;
  streak: number;
  best: number;
}

export const newSpotState = (best = 0): SpotState => ({ n: 0, balls: 0, streak: 0, best });

/**
 * After each ball: a landing on the spot (bullseye or inside the ring) adds to
 * the streak and moves the spot; anything else breaks the streak, and the spot
 * moves anyway after MOVE_EVERY balls.
 */
export function afterBall(s: SpotState, kind: Closeness): SpotState {
  const hit = kind === "bullseye" || kind === "on";
  const streak = hit ? s.streak + 1 : 0;
  const balls = s.balls + 1;
  const move = hit || balls >= MOVE_EVERY;
  return { n: move ? s.n + 1 : s.n, balls: move ? 0 : balls, streak, best: Math.max(s.best, streak) };
}
