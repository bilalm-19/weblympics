// Track practice (task 26): the sprint in the page against the bot as a pacer,
// race after race. No room or server.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/track/practice-sim.ts";
import { OVER_TICKS, TICK_MS } from "../shared/games/track/sim.ts";

function runRace(sim: PracticeSim, everyTicks: number): void {
  let side: "left" | "right" = "left";
  for (let i = 0; i < 60 * 40 && sim.state.phase !== "over"; i++) {
    if (sim.state.phase === "running" && i % everyTicks === 0) {
      sim.step(side, i * TICK_MS);
      side = side === "left" ? "right" : "left";
    }
    sim.tick();
  }
}

describe("track practice", () => {
  it("runs a race against the pacer and starts the next one", () => {
    const sim = new PracticeSim(1);
    runRace(sim, 7);
    expect(sim.state.phase).toBe("over");
    expect(sim.state.lanes[0].finish).not.toBeNull();
    expect(sim.state.winner).toBe(0);
    for (let i = 0; i < OVER_TICKS; i++) sim.tick();
    expect(sim.state.phase).toBe("set");
    expect(sim.state.best[0]).not.toBeNull();
  });

  it("the pacer wins if you jog", () => {
    const sim = new PracticeSim(2);
    runRace(sim, 15);
    expect(sim.state.winner).toBe(1);
  });

  it("holds still while paused (the camera setup is open)", () => {
    const sim = new PracticeSim(3);
    for (let i = 0; i < 100; i++) sim.tick();
    sim.paused = true;
    const before = JSON.stringify(sim.state);
    for (let i = 0; i < 100; i++) {
      sim.step(i % 2 ? "left" : "right", i * 200);
      sim.tick();
    }
    expect(JSON.stringify(sim.state)).toBe(before);
  });
});
