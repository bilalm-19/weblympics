import { TICK_MS, otherSide } from "./sim.ts";
import type { Seat, StepInput, TrackState } from "./sim.ts";

/** The bot's cadence, steps a second, and how far each stride wanders from it. */
export const BOT_CADENCE = 6.8;
export const BOT_JITTER = 0.8;
/** Ticks after the gun before the bot's first step: a human-ish reaction. */
export const BOT_REACTION_TICKS = 12;

// A number in [0, 1) from the state without touching its rng, so asking the
// bot never changes the game (like archery's bot).
function noise(s: TrackState, salt: number): number {
  let t = (s.rng ^ Math.imul(s.races + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Ticks between the bot's steps at a cadence of `cadence` steps a second. */
export const ticksPerStep = (cadence: number): number => 60 / cadence;

/**
 * The bot runs by the same rules as a person: it sends alternating steps
 * with its own timestamps and the sim decides how far that gets it. Its
 * cadence wanders around BOT_CADENCE stride by stride, and the race's seed
 * makes some races quicker than others.
 */
export function botInputs(s: TrackState, seat: Seat): StepInput[] {
  if (s.phase !== "running" || s.solo) return [];
  const lane = s.lanes[seat];
  if (lane.finish !== null) return [];
  if (lane.steps === 0) {
    if (s.phaseTick < BOT_REACTION_TICKS) return [];
  } else {
    const form = (noise(s, 1) - 0.5) * 0.6;
    const stride = (noise(s, lane.steps + 2) - 0.5) * 2 * BOT_JITTER;
    const cadence = BOT_CADENCE + form + stride;
    if (s.tick - lane.lastStepTick < ticksPerStep(cadence)) return [];
  }
  return [{ t: "step", seat, side: otherSide(lane.lastSide), at: s.tick * TICK_MS }];
}
