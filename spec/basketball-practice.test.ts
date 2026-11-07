// Task 32: basketball practice runs the shootout sim in the page against the
// bot, match after match, through the same step the server runs. No room.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/basketball/practice-sim.ts";
import { makeWindow } from "../shared/games/basketball/sim.ts";

/** Ticks until it is seat 0's turn to aim, then shoots inside the window. */
function myShot(sim: PracticeSim, inWindow = true): void {
  for (let i = 0; i < 5000 && !(sim.state.phase === "aim" && sim.state.turn === 0); i++) sim.tick();
  const w = makeWindow(sim.state.spot);
  sim.set();
  sim.tick();
  sim.shoot(inWindow ? (w.lo + w.hi) / 2 : 0, 0, 0);
  sim.tick();
}

describe("basketball practice", () => {
  it("plays turns with the bot and scores your shots", () => {
    const sim = new PracticeSim(7);
    myShot(sim);
    for (let i = 0; i < 400 && sim.state.phase !== "result"; i++) sim.tick();
    expect(sim.state.last?.seat).toBe(0);
    expect(sim.state.last?.made).toBe(true);
    // the bot takes its turn on its own
    for (let i = 0; i < 2000 && sim.state.shots.length < 2; i++) sim.tick();
    expect(sim.state.shots[1].seat).toBe(1);
  });

  it("never ends: a finished match starts a fresh one", () => {
    const sim = new PracticeSim(3);
    // miss every shot until the bot wins
    for (let i = 0; i < 20000 && sim.state.phase !== "over"; i++) {
      if (sim.state.phase === "aim" && sim.state.turn === 0 && sim.state.phaseTick === 10) sim.shoot(0, 0, 0);
      sim.tick();
    }
    expect(sim.state.phase).toBe("over");
    expect(sim.state.matches).toBe(1);
    for (let i = 0; i < 400 && sim.state.phase === "over"; i++) sim.tick();
    expect(sim.state.phase).toBe("aim");
    expect(sim.state.shots).toEqual([]);
  });

  it("holds while paused (the camera setup is open) and drops what was sent meanwhile", () => {
    const sim = new PracticeSim(1);
    sim.paused = true;
    const tick = sim.state.tick;
    sim.set();
    for (let i = 0; i < 100; i++) sim.tick();
    expect(sim.state.tick).toBe(tick);
    sim.paused = false;
    sim.tick();
    expect(sim.state.set).toBe(false);
  });
});
