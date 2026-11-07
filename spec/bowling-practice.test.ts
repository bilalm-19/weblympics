// Bowling practice (task 29): the game in the page against the bot, game
// after game. No room or server.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/bowling/practice-sim.ts";
import { OVER_TICKS } from "../shared/games/bowling/sim.ts";
import { strikeBall } from "./bowling-helpers.ts";

const untilMyTurn = (sim: PracticeSim) => {
  for (let i = 0; i < 60 * 60 && !(sim.state.phase === "aim" && sim.state.turn === 0); i++) sim.tick();
};

describe("bowling practice", () => {
  it("your throw is rolled by the game's own sim: a pocket ball strikes", () => {
    const sim = new PracticeSim(1);
    untilMyTurn(sim);
    const t = strikeBall();
    sim.throw(t.speed, t.aim, t.spin, 0);
    for (let i = 0; i < 700 && sim.state.last === null; i++) sim.tick();
    expect(sim.state.last?.strike).toBe(true);
    expect(sim.snapshot().cards[0].frames[0].marks).toEqual(["X"]);
  });

  it("the bot bowls its own frames, and a finished game starts the next one", () => {
    const sim = new PracticeSim(2);
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
    const sim = new PracticeSim(3);
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
