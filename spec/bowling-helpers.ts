// Shared by the bowling specs: drive a BowlingState ball by ball.
import { botInputs } from "../shared/games/bowling/bot.ts";
import { MAX_ROLL_TICKS, RESULT_TICKS, SHOT_CLOCK_TICKS, aimFor, step } from "../shared/games/bowling/sim.ts";
import type { BowlingEvent, BowlingState, Seat } from "../shared/games/bowling/sim.ts";

export const POCKET = { speed: 0.7, spin: -0.6 } as const;
/** A curving pocket ball at a good speed: a strike on a full rack. */
export const strikeBall = () => ({ ...POCKET, aim: aimFor(POCKET.speed, POCKET.spin) });
/** Straight off the left edge: a gutter ball. */
export const gutterBall = { speed: 0.7, aim: -1, spin: -1 };

/** Steps until it's someone's turn to throw (or the game is voting or over). */
export function toAim(s: BowlingState): BowlingEvent[] {
  const ev: BowlingEvent[] = [];
  for (let i = 0; i < RESULT_TICKS + MAX_ROLL_TICKS + 10 && s.phase !== "aim" && s.phase !== "tie-vote" && s.phase !== "over"; i++) ev.push(...step(s, []));
  return ev;
}

/** The thrower throws `t` and the ball rolls until it's recorded; returns that ball's event. */
export function bowl(s: BowlingState, t: { speed: number; aim: number; spin: number }): Extract<BowlingEvent, { type: "bowl" }> {
  toAim(s);
  if (s.phase !== "aim") throw new Error(`not aiming: ${s.phase}`);
  const seat = s.turn;
  let ev = step(s, [{ t: "throw", seat, ...t, at: 0 }]);
  for (let i = 0; i < MAX_ROLL_TICKS + 5; i++) {
    const b = ev.find((e) => e.type === "bowl");
    if (b?.type === "bowl") return b;
    ev = step(s, []);
  }
  throw new Error("ball never settled");
}

/** Lets the shot clock run out for the thrower: a gutter ball. */
export function timeout(s: BowlingState): Extract<BowlingEvent, { type: "bowl" }> {
  toAim(s);
  for (let i = 0; i < SHOT_CLOCK_TICKS + 20; i++) {
    const b = step(s, []).find((e) => e.type === "bowl");
    if (b?.type === "bowl") return b;
  }
  throw new Error("clock never ran out");
}

/** Plays whole frames with each seat's chooser until the game votes or ends. */
export function playOut(s: BowlingState, choose: (s: BowlingState, seat: Seat) => { speed: number; aim: number; spin: number }): void {
  for (let i = 0; i < 60; i++) {
    toAim(s);
    if (s.phase !== "aim") return;
    bowl(s, choose(s, s.turn));
  }
  toAim(s);
}

/** Runs the bot for `seat` (and nothing for the other) for `ticks`. */
export function runBot(s: BowlingState, seat: Seat, ticks: number): BowlingEvent[] {
  const ev: BowlingEvent[] = [];
  for (let i = 0; i < ticks; i++) ev.push(...step(s, botInputs(s, seat)));
  return ev;
}
