import { AIR_TICKS, TICK_MS, nextHurdle, otherSide } from "./sim.ts";
import type { Seat, TrackInput, TrackState } from "./sim.ts";

/**
 * The bot's cadence, steps a second, and how far each stride wanders from it.
 * With FULL_CADENCE 4 (2026-11-08), 3.2 runs about 16.4 s (15.3 to 18.0
 * over seeds; it was 15.3 s at 5.2 against FULL_CADENCE 6). The best
 * possible is 11.4 s, a steady 4 pumps a second runs 12.3 s and a steady 3.5
 * runs 13.9 s, so a person pumping steadily beats it (user: the old bot was
 * "way too fast"). Guesses until the recordings.
 */
export const BOT_CADENCE = 3.2;
export const BOT_JITTER = 0.5;
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

/** Hurdles: how far the bot's take-off wanders from the best one, seconds either way (half the airtime is 0.2 s). */
export const BOT_JUMP_JITTER = 0.2;

/** Ticks between the bot's steps at a cadence of `cadence` steps a second. */
export const ticksPerStep = (cadence: number): number => 60 / cadence;

/**
 * The bot runs by the same rules as a person: it sends alternating steps
 * with its own timestamps and the sim decides how far that gets it. Its
 * cadence wanders around BOT_CADENCE stride by stride, and the race's seed
 * makes some races quicker than others.
 */
export function botInputs(s: TrackState, seat: Seat): TrackInput[] {
  if (s.phase !== "running" || s.solo) return [];
  const lane = s.lanes[seat];
  if (lane.finish !== null) return [];
  const out: TrackInput[] = [];
  const jump = botJump(s, seat);
  if (jump) out.push(jump);
  if (lane.steps === 0) {
    if (s.phaseTick < BOT_REACTION_TICKS) return out;
  } else {
    const form = (noise(s, 1) - 0.5) * 0.6;
    const stride = (noise(s, lane.steps + 2) - 0.5) * 2 * BOT_JITTER;
    const cadence = BOT_CADENCE + form + stride;
    if (s.tick - lane.lastStepTick < ticksPerStep(cadence)) return out;
  }
  out.push({ t: "step", seat, side: otherSide(lane.lastSide), at: s.tick * TICK_MS });
  return out;
}

/**
 * Hurdles (task 27): the bot jumps once per hurdle, aiming to be at the top
 * of its flight over the bar, give or take up to BOT_JUMP_JITTER seconds
 * (seeded per hurdle and race). A take-off that wanders past the edge of the
 * airtime knocks the hurdle down, so it sometimes stumbles and stays beatable.
 */
function botJump(s: TrackState, seat: Seat): TrackInput | null {
  const lane = s.lanes[seat];
  if (s.obstacles.length === 0 || lane.air > 0 || lane.speed <= 0) return null;
  const i = nextHurdle(s, lane.distance);
  if (i < 0) return null;
  const prev = i > 0 ? s.obstacles[i - 1] : -Infinity;
  // already jumped for this one
  if (lane.jumps > 0 && lane.lastJumpDist > prev) return null;
  const late = (noise(s, 1000 + i * 7 + seat) - 0.5) * 2 * BOT_JUMP_JITTER;
  const takeoff = s.obstacles[i] - lane.speed * ((AIR_TICKS / 2) * (TICK_MS / 1000) - late);
  if (lane.distance < takeoff) return null;
  return { t: "jump", seat, at: s.tick * TICK_MS };
}
