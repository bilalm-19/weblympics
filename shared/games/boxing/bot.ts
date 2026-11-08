import { TICK_MS, other } from "./sim.ts";
import type { BoxingInput, BoxingState, Guard, Hand, Seat, Side, Target } from "./sim.ts";

// GUESSES to be playtested, like the sim's numbers.
/**
 * Ticks from a jab being thrown to the bot reacting to it, at the quickest
 * (about 67 ms; was 7 with the 150 ms wind-up, moved with the 100 ms one on
 * 2026-11-08 so the bot still blocks some, a GUESS)...
 */
export const BOT_REACTION_TICKS = 4;
/**
 * ...plus up to this many more, by noise. The jab lands JAB_WINDUP_TICKS (6)
 * after it is thrown and a reaction must be in by the tick before, so a
 * reaction drawn at 4 or 5 ticks is in time and anything slower is late: the
 * bot defends roughly a fifth of the jabs it notices, as before.
 */
export const BOT_REACTION_SPREAD = 10;
/** Share of jabs the bot doesn't notice at all. */
export const BOT_MISS = 0.25;
/** Share of the head jabs it does react to that it slips instead of guarding high. */
export const BOT_SLIP_SHARE = 0.35;
/** Ticks the guard stays up after a jab lands on it. */
export const BOT_HOLD_TICKS = 12;
/** Chance a tick, with a hand free and nothing coming, that the bot throws: about one jab a second. */
export const BOT_PUNCH_CHANCE = 1 / 50;
/** Share of its jabs aimed at the head, against an open boxer... */
export const BOT_HEAD_SHARE = 0.75;
/** ...and against one holding a high guard (more body, since the head is covered). */
export const BOT_HEAD_SHARE_VS_HIGH = 0.25;
/** Against a low guard it goes to the head this often. */
export const BOT_HEAD_SHARE_VS_LOW = 0.9;

// A number in [0, 1) from the state without touching its rng, so asking the
// bot never changes the game (like track's and archery's bots).
function noise(s: BoxingState, salt: number): number {
  let t = (s.rng ^ Math.imul(s.bouts + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** What the bot does about one incoming jab, once it has reacted: guard high, guard low, or slip. */
export type BotDefence = "high" | "low" | "slip";

/**
 * The bot in `seat`'s defence this tick: the first incoming jab it has
 * noticed and reacted to (after its human-ish delay) decides it, a body jab
 * gets the low guard and a head jab the high guard or, sometimes, a slip.
 * Null when nothing coming has been seen yet.
 */
export function botDefence(s: BoxingState, seat: Seat): BotDefence | null {
  const foe = s.boxers[other(seat)];
  for (const hand of ["left", "right"] as const) {
    const p = foe.punches[hand];
    if (!p) continue;
    const salt = p.thrownTick * 2 + (hand === "left" ? 0 : 1);
    if (noise(s, salt * 5 + 1) < BOT_MISS) continue;
    const react = BOT_REACTION_TICKS + Math.floor(noise(s, salt * 5 + 2) * BOT_REACTION_SPREAD);
    if (s.tick - p.thrownTick < react) continue;
    if (p.target === "body") return "low";
    return noise(s, salt * 5 + 3) < BOT_SLIP_SHARE ? "slip" : "high";
  }
  return null;
}

/** The guard the bot in `seat` wants this tick: the right height for a jab it has seen coming, or held a moment after one lands on it. */
export function botWantsGuard(s: BoxingState, seat: Seat): Guard {
  const d = botDefence(s, seat);
  if (d === "high" || d === "low") return d;
  const me = s.boxers[seat];
  const hit = s.lastHit;
  if (d === null && hit !== null && hit.seat === other(seat) && me.guard !== null && s.tick - hit.tick < BOT_HOLD_TICKS) return me.guard;
  return null;
}

/**
 * The bot boxes by the same rules as a person: it sends guard, slip and
 * punch inputs with its own timestamps and the sim decides what lands. It
 * guards the right height (or slips a head jab) when it sees a jab coming,
 * after a human-ish reaction and sometimes not at all, and otherwise drops its
 * guard and jabs now and then, mostly to the head, more to the body when the
 * other boxer holds a high guard.
 */
export function botInputs(s: BoxingState, seat: Seat): BoxingInput[] {
  if (s.phase !== "round") return [];
  const me = s.boxers[seat];
  const foe = s.boxers[other(seat)];
  const out: BoxingInput[] = [];
  const d = botDefence(s, seat);
  // a slip is a held lean (playtest 4): the bot leans while it sees a head
  // jab coming and straightens up once nothing is, like a person letting go
  if (d === "slip") {
    if (me.slip === null) {
      const side: Side = noise(s, s.tick * 7 + 3) < 0.5 ? "left" : "right";
      out.push({ t: "slip", seat, side });
    }
    return out;
  }
  if (me.slip !== null) out.push({ t: "slip", seat, side: null });
  const guard = botWantsGuard(s, seat);
  if (guard !== me.guard) out.push({ t: "guard", seat, guard });
  if (guard !== null || me.slip !== null) return out;
  if (noise(s, s.tick * 13 + 5) >= BOT_PUNCH_CHANCE) return out;
  const free = (h: Hand) => me.punches[h] === null && s.tick >= me.readyAt[h];
  // alternate hands, starting with the left (the lead hand of an orthodox boxer)
  const first: Hand = me.thrown % 2 === 0 ? "left" : "right";
  const second: Hand = first === "left" ? "right" : "left";
  const hand = free(first) ? first : free(second) ? second : null;
  if (!hand) return out;
  const headShare = foe.guard === "high" ? BOT_HEAD_SHARE_VS_HIGH : foe.guard === "low" ? BOT_HEAD_SHARE_VS_LOW : BOT_HEAD_SHARE;
  const target: Target = noise(s, me.thrown * 17 + 11) < headShare ? "head" : "body";
  out.push({ t: "punch", seat, hand, target, at: s.tick * TICK_MS });
  return out;
}
