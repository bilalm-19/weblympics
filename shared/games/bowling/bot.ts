import { BALL, PIN, aimFor, simulateThrow } from "./sim.ts";
import type { BowlingInput, BowlingState, Seat } from "./sim.ts";

/** The bot lines up for this long, sending its aim, then throws. */
export const BOT_THROW_TICK = 90;
/** After a level game the bot votes "continue" this long into the vote, so a person decides (user, 2026-11-08). */
export const BOT_VOTE_TICK = 60;
/** The bot's first ball: a firm ball curving left into the 1-3 pocket. */
export const BOT_SPEED = 0.7;
export const BOT_SPIN = -0.6;
/**
 * Its wobble at the release, plus or minus: first guesses that leave it a
 * fair bowler, not a perfect one (a strike now and then, open frames too).
 */
export const BOT_NOISE = { aim: 0.07, speed: 0.15, spin: 0.25 } as const;

export interface Plan {
  speed: number;
  aim: number;
  spin: number;
}

// A number in [0, 1) from the game's seed and where it is, without touching
// the state, so asking the bot never changes the game.
function noise(s: BowlingState, salt: number): number {
  let t = (s.seed ^ Math.imul(s.matches * 64 + s.frame * 4 + s.ball + 1, 0x9e3779b1) ^ Math.imul(s.turn + 1, 0x27d4eb2f) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The throw the bot means, before its wobble: the pocket at a full rack;
 * otherwise a straight ball at whichever target (each standing pin, or the
 * gap between two) the sim says knocks down the most of what's left.
 */
export function solveThrow(s: BowlingState): Plan {
  const standing = s.pins.filter((p) => p.standing && !p.cleared);
  if (standing.length === 10 || standing.length === 0) return { speed: BOT_SPEED, aim: aimFor(BOT_SPEED, BOT_SPIN), spin: BOT_SPIN };
  const targets: Array<{ x: number; y: number }> = standing.map((p) => ({ x: p.x, y: p.y }));
  for (let i = 0; i < standing.length; i++)
    for (let j = i + 1; j < standing.length; j++) targets.push({ x: (standing[i].x + standing[j].x) / 2, y: Math.min(standing[i].y, standing[j].y) });
  let best: Plan | null = null;
  let bestDown = -1;
  for (const t of targets) {
    const plan = { speed: BOT_SPEED, aim: aimFor(BOT_SPEED, 0, t.x, t.y - BALL.radius - PIN.radius), spin: 0 };
    const down = simulateThrow(plan, s.pins).down;
    if (down > bestDown) {
      best = plan;
      bestDown = down;
    }
  }
  return best!;
}

// the plan for the ball in hand, so the search runs once a ball, not every tick
const plans = new WeakMap<BowlingState, { key: string; plan: Plan }>();

function planFor(s: BowlingState): Plan {
  const key = `${s.matches}:${s.frame}:${s.ball}:${s.turn}:${s.rack}`;
  const cached = plans.get(s);
  if (cached?.key === key) return cached.plan;
  const aimed = solveThrow(s);
  const wobble = (salt: number, size: number) => (noise(s, salt) - 0.5) * 2 * size;
  const plan = {
    speed: aimed.speed + wobble(1, BOT_NOISE.speed),
    aim: aimed.aim + wobble(2, BOT_NOISE.aim),
    spin: aimed.spin + wobble(3, BOT_NOISE.spin),
  };
  plans.set(s, { key, plan });
  return plan;
}

/**
 * The bot plays by a person's rules: on its own turn it sends its aim while
 * it lines up, then one throw (the sim clamps it); after a level game it
 * votes to play on. It never acts off its turn.
 */
export function botInputs(s: BowlingState, seat: Seat): BowlingInput[] {
  if (s.phase === "tie-vote") return s.votes[seat] === null && s.phaseTick >= BOT_VOTE_TICK ? [{ t: "tie", seat, choice: "continue" }] : [];
  if (s.phase !== "aim" || s.turn !== seat) return [];
  const plan = planFor(s);
  if (s.phaseTick >= BOT_THROW_TICK) return [{ t: "throw", seat, speed: plan.speed, aim: plan.aim, spin: plan.spin, at: s.tick }];
  return s.phaseTick % 6 === 0 ? [{ t: "aim", seat, aim: plan.aim * Math.min(1, s.phaseTick / 60) }] : [];
}
