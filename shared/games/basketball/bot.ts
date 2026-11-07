import { makeWindow } from "./sim.ts";
import type { BasketballInput, BasketballState, Seat } from "./sim.ts";

/** The bot gets set this far into its turn, then shoots this far in (about a person's pace). */
export const BOT_SET_TICK = 30;
export const BOT_SHOOT_TICK = 90;
/** After a level shootout the bot votes to play on, 1 s into the vote (user, 2026-11-08). */
export const BOT_VOTE_TICK = 60;
/** How far off the window's middle the bot's power can be, either way (power units). First guess, agent. */
export const BOT_POWER_SPREAD = 0.06;
/** How far off centre its aim can be, either way (-1..1 units). First guess, agent. */
export const BOT_AIM_SPREAD = 0.15;

// A number in [0, 1) from the state without touching its rng, so asking the
// bot never changes the game. Fixed for the turn, so every aim it sends in a
// turn agrees with its shot.
function noise(s: BasketballState, salt: number): number {
  let t = (s.rng ^ Math.imul(s.matches * 64 + s.round * 2 + s.turnInRound + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The bot plays by the same rules as a person: on its own turn it gets set,
 * sends its aim and shoots once, and the sim flies the ball. It aims for the
 * middle of the spot's make window with a hand that wobbles by the same
 * amount at every spot, so the near spots usually drop and the deep one
 * rarely does: beatable by anyone who finds the window. After a level
 * shootout it votes to play on.
 */
export function botInputs(s: BasketballState, seat: Seat): BasketballInput[] {
  if (s.phase === "tie-vote") return s.votes[seat] === null && s.phaseTick >= BOT_VOTE_TICK ? [{ t: "tie", seat, choice: "continue" }] : [];
  if (s.phase !== "aim" || s.turn !== seat) return [];
  const w = makeWindow(s.spot);
  const power = (w.lo + w.hi) / 2 + (noise(s, 1) - 0.5) * 2 * BOT_POWER_SPREAD;
  const aim = (noise(s, 2) - 0.5) * 2 * BOT_AIM_SPREAD;
  if (s.phaseTick === BOT_SET_TICK) return [{ t: "set", seat }];
  if (s.phaseTick >= BOT_SHOOT_TICK) return [{ t: "shoot", seat, power, aim, at: s.tick * (1000 / 60) }];
  if (s.phaseTick > BOT_SET_TICK && s.phaseTick % 6 === 0) {
    // the arrow drifts onto its aim, for watchers
    const k = Math.min(1, (s.phaseTick - BOT_SET_TICK) / (BOT_SHOOT_TICK - BOT_SET_TICK));
    return [{ t: "aim", seat, aim: aim * k }];
  }
  return [];
}
