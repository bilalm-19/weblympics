import { TICK_MS, other } from "./sim.ts";
import type { BoxingInput, BoxingState, Hand, PunchKind, Seat } from "./sim.ts";

/** Ticks from a punch being thrown to the bot raising its guard, at the quickest (250 ms)... */
export const BOT_REACTION_TICKS = 15;
/** ...plus up to this many more, by noise. So it rarely blocks a jab (200 ms) but often a hook (350 ms). */
export const BOT_REACTION_SPREAD = 12;
/** Share of punches the bot doesn't notice at all. */
export const BOT_MISS = 0.25;
/** Ticks the guard stays up after a punch lands on it. */
export const BOT_HOLD_TICKS = 12;
/** Chance a tick, with a hand free and nothing coming, that the bot throws: about one punch a second. */
export const BOT_PUNCH_CHANCE = 1 / 50;
/** Share of its punches that are jabs. */
export const BOT_JAB_SHARE = 0.65;

// A number in [0, 1) from the state without touching its rng, so asking the
// bot never changes the game (like track's and archery's bots).
function noise(s: BoxingState, salt: number): number {
  let t = (s.rng ^ Math.imul(s.bouts + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Whether the bot in `seat` wants its guard up this tick: it has seen a punch coming, after its reaction time. */
export function botWantsGuard(s: BoxingState, seat: Seat): boolean {
  const foe = s.boxers[other(seat)];
  for (const hand of ["left", "right"] as const) {
    const p = foe.punches[hand];
    if (!p) continue;
    const salt = p.thrownTick * 2 + (hand === "left" ? 0 : 1);
    if (noise(s, salt * 3 + 1) < BOT_MISS) continue;
    const react = BOT_REACTION_TICKS + Math.floor(noise(s, salt * 3 + 2) * BOT_REACTION_SPREAD);
    if (s.tick - p.thrownTick >= react) return true;
  }
  const hit = s.lastHit;
  return hit !== null && hit.seat === other(seat) && s.boxers[seat].guard && s.tick - hit.tick < BOT_HOLD_TICKS;
}

/**
 * The bot boxes by the same rules as a person: it sends guard and punch
 * inputs with its own timestamps and the sim decides what lands. It guards
 * when it sees a punch coming (after a human-ish reaction, sometimes not at
 * all), and otherwise drops its guard and throws now and then, mostly jabs.
 */
export function botInputs(s: BoxingState, seat: Seat): BoxingInput[] {
  if (s.phase !== "round") return [];
  const me = s.boxers[seat];
  const out: BoxingInput[] = [];
  const guard = botWantsGuard(s, seat);
  if (guard !== me.guard) out.push({ t: "guard", seat, up: guard });
  if (guard) return out;
  if (noise(s, s.tick * 13 + 5) >= BOT_PUNCH_CHANCE) return out;
  const free = (h: Hand) => me.punches[h] === null && s.tick >= me.readyAt[h];
  // alternate hands, starting with the left (the lead hand of an orthodox boxer)
  const first: Hand = me.thrown % 2 === 0 ? "left" : "right";
  const hand = free(first) ? first : free(first === "left" ? "right" : "left") ? (first === "left" ? "right" : "left") : null;
  if (!hand) return out;
  const kind: PunchKind = noise(s, me.thrown * 17 + 11) < BOT_JAB_SHARE ? "jab" : "hook";
  out.push({ t: "punch", seat, kind, hand, at: s.tick * TICK_MS });
  return out;
}
