// Bowling practice (task 29): the game in the page against the bot, game
// after game. No room or server.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/bowling/practice-sim.ts";
import { FRAMES, OVER_TICKS, SHOT_CLOCK_TICKS } from "../shared/games/bowling/sim.ts";
import { strikeBall } from "./bowling-helpers.ts";

const untilMyTurn = (sim: PracticeSim) => {
  for (let i = 0; i < 60 * 60 && !(sim.state.phase === "aim" && sim.state.turn === 0); i++) sim.tick();
};

describe("bowling practice", () => {
  it("your throw is rolled by the game's own sim: a pocket ball strikes", () => {
    const sim = new PracticeSim(1, "bot");
    untilMyTurn(sim);
    const t = strikeBall();
    sim.throw(t.speed, t.aim, t.spin, 0);
    for (let i = 0; i < 700 && sim.state.last === null; i++) sim.tick();
    expect(sim.state.last?.strike).toBe(true);
    expect(sim.snapshot().cards[0].frames[0].marks).toEqual(["X"]);
  });

  it("the bot bowls its own frames, and a finished game starts the next one", () => {
    const sim = new PracticeSim(2, "bot");
    for (let i = 0; i < 60 * 60 * 10 && sim.state.matches === 0; i++) {
      if (sim.state.phase === "aim" && sim.state.turn === 0 && sim.state.phaseTick === 10) sim.throw(0.7, 0, 0, 0);
      if (sim.state.phase === "tie-vote" && sim.state.votes[0] === null) sim.tie("draw");
      sim.tick();
    }
    expect(sim.state.matches).toBe(1);
    expect(sim.state.rolls[1].length).toBeGreaterThan(0);
    for (let i = 0; i < OVER_TICKS + 5; i++) sim.tick();
    expect(sim.state.phase).toBe("aim");
    expect(sim.state.rolls).toEqual([[], []]);
  });

  it("holds still while paused (the camera setup is open), and drops what was sent meanwhile", () => {
    const sim = new PracticeSim(3, "bot");
    untilMyTurn(sim);
    sim.paused = true;
    const tick = sim.state.tick;
    sim.throw(0.7, 0, 0, 0);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(sim.state.tick).toBe(tick);
    sim.paused = false;
    sim.tick();
    expect(sim.state.phase).toBe("aim");
  });
});

// Task 38: "Just me", the default: the frames alone, game after game.
/** Waits for the next ball, then throws `t` and lets it settle. */
function soloBall(sim: PracticeSim, t: { speed: number; aim: number; spin: number }): void {
  for (let i = 0; i < 60 * 30 && sim.state.phase !== "aim"; i++) sim.tick();
  sim.throw(t.speed, t.aim, t.spin, 0);
  for (let i = 0; i < 60 * 15 && sim.state.phase !== "result"; i++) sim.tick();
}
const gutter = { speed: 0.7, aim: -1, spin: -1 };

describe("bowling practice: Just me (task 38)", () => {
  it("opens alone: every ball is yours, two a frame, and no bot bowls", () => {
    const sim = new PracticeSim(4);
    expect(sim.mode).toBe("solo");
    soloBall(sim, gutter);
    soloBall(sim, gutter);
    soloBall(sim, strikeBall());
    expect(sim.state.rolls[0]).toEqual([0, 0, 10]);
    expect(sim.state.rolls[1]).toEqual([]);
    const c = sim.snapshot().cards[0];
    expect(c.frames[0].marks).toEqual(["-", "-"]);
    expect(c.frames[1].marks).toEqual(["X"]);
  });

  it("has no shot clock: waiting long loses nothing", () => {
    const sim = new PracticeSim(4);
    for (let i = 0; i < SHOT_CLOCK_TICKS * 2; i++) sim.tick();
    expect(sim.state.phase).toBe("aim");
    expect(sim.state.rolls[0]).toEqual([]);
    expect(sim.snapshot().clock).toBeNull();
  });

  it("a strike counts the next two balls in the running total, as real scoring does", () => {
    const sim = new PracticeSim(4);
    soloBall(sim, strikeBall());
    soloBall(sim, gutter);
    soloBall(sim, gutter);
    expect(sim.total()).toBe(10);
  });

  it("plays a whole game alone, the last frame's bonus balls included, then starts the next", () => {
    const sim = new PracticeSim(4);
    // strikes all the way: one ball a frame, the fifth three balls
    for (let i = 0; i < FRAMES + 2; i++) soloBall(sim, strikeBall());
    expect(sim.state.rolls[0]).toHaveLength(FRAMES + 2);
    for (let i = 0; i < 200 && sim.state.phase !== "over"; i++) sim.tick();
    expect(sim.state.phase).toBe("over");
    expect(sim.state.matches).toBe(1);
    expect(sim.state.best[0]).toBe(sim.total());
    for (let i = 0; i < OVER_TICKS + 5; i++) sim.tick();
    expect(sim.state.phase).toBe("aim");
    expect(sim.state.rolls).toEqual([[], []]);
    expect(sim.state.frame).toBe(0);
  });

  it("Reset pins each ball: every ball faces a full rack, and the pins per ball are kept", () => {
    const sim = new PracticeSim(4);
    sim.setResetPins(true);
    soloBall(sim, { speed: 0.7, aim: 0.6, spin: 0 });
    const first = sim.balls[0];
    expect(first).toBeLessThan(10);
    for (let i = 0; i < 200 && sim.state.phase !== "aim"; i++) sim.tick();
    // a full rack again, not the leftovers
    expect(sim.state.rack).toBe(10);
    expect(sim.snapshot().pins.every((p) => p.standing)).toBe(true);
    soloBall(sim, strikeBall());
    expect(sim.balls).toEqual([first, 10]);
    expect(sim.strikes).toBe(1);
    expect(sim.bowled).toBe(2);
    // no frames are scored meanwhile
    expect(sim.state.rolls[0]).toEqual([]);
    sim.setResetPins(false);
    expect(sim.balls).toEqual([]);
    expect(sim.state.phase).toBe("aim");
  });

  it("switching to vs Bot starts a clean game against the bot; back again starts alone", () => {
    const sim = new PracticeSim(4);
    soloBall(sim, gutter);
    sim.setMode("bot");
    expect(sim.state.rolls).toEqual([[], []]);
    expect(sim.state.phase).toBe("aim");
    soloBall(sim, gutter);
    soloBall(sim, gutter);
    for (let i = 0; i < 60 * 60 && sim.state.rolls[1].length === 0; i++) sim.tick();
    expect(sim.state.rolls[1].length).toBeGreaterThan(0);
    sim.setMode("solo");
    expect(sim.state.rolls).toEqual([[], []]);
  });
});
