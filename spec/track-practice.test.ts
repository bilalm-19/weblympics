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

describe("track practice: hurdles (task 27)", () => {
  it("switches to hurdles (a new race), the pacer jumps, and a jump from the player is taken", () => {
    const sim = new PracticeSim(1, "sprint", "bot");
    for (let i = 0; i < 200; i++) sim.tick();
    sim.setEvent("hurdles");
    expect(sim.state.event).toBe("hurdles");
    expect(sim.state.phase).toBe("set");
    expect(sim.state.obstacles).toHaveLength(10);
    while (sim.state.phase === "set") sim.tick();
    for (let i = 0; i < 30; i++) {
      if (i % 8 === 0) sim.step(i % 16 ? "right" : "left", i * TICK_MS);
      sim.tick();
    }
    sim.jump(5000);
    sim.tick();
    expect(sim.state.lanes[0].jumps).toBe(1);
    for (let i = 0; i < 60 * 20; i++) sim.tick();
    expect(sim.state.lanes[1].jumps).toBeGreaterThan(0);
    sim.setEvent("sprint");
    expect(sim.state.obstacles).toEqual([]);
  });
});

describe("track practice", () => {
  it("runs a race against the pacer and starts the next one", () => {
    const sim = new PracticeSim(1, "sprint", "bot");
    runRace(sim, 7);
    expect(sim.state.phase).toBe("over");
    expect(sim.state.lanes[0].finish).not.toBeNull();
    expect(sim.state.winner).toBe(0);
    for (let i = 0; i < OVER_TICKS; i++) sim.tick();
    expect(sim.state.phase).toBe("set");
    expect(sim.state.best[0]).not.toBeNull();
  });

  it("the pacer wins if you jog", () => {
    const sim = new PracticeSim(2, "sprint", "bot");
    runRace(sim, 15);
    expect(sim.state.winner).toBe(1);
  });

  it("holds still while paused (the camera setup is open)", () => {
    const sim = new PracticeSim(3, "sprint", "bot");
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

// Task 38: "Just me", the default: your lane alone, race after race.
describe("track practice: Just me (task 38)", () => {
  it("opens alone: no pacer runs, and the race ends when you finish", () => {
    const sim = new PracticeSim(1);
    expect(sim.mode).toBe("solo");
    expect(sim.state.solo).toBe(true);
    runRace(sim, 15);
    expect(sim.state.phase).toBe("over");
    expect(sim.state.lanes[1].distance).toBe(0);
    expect(sim.last.sprint).toBe(sim.state.lanes[0].finish);
    for (let i = 0; i < OVER_TICKS; i++) sim.tick();
    expect(sim.state.phase).toBe("set");
  });

  it("keeps your best time this session, only beaten by a faster run", () => {
    const sim = new PracticeSim(1);
    runRace(sim, 8);
    const fast = sim.best.sprint!;
    expect(fast).not.toBeNull();
    for (let i = 0; i < OVER_TICKS; i++) sim.tick();
    runRace(sim, 14);
    expect(sim.last.sprint!).toBeGreaterThan(fast);
    expect(sim.best.sprint).toBe(fast);
  });

  it("either event: hurdles alone too, and each event keeps its own best across switches", () => {
    const sim = new PracticeSim(1);
    runRace(sim, 8);
    const sprint = sim.best.sprint;
    sim.setEvent("hurdles");
    expect(sim.state.solo).toBe(true);
    expect(sim.state.obstacles).toHaveLength(10);
    expect(sim.best.hurdles).toBeNull();
    runRace(sim, 8);
    expect(sim.state.phase).toBe("over");
    expect(sim.best.hurdles).not.toBeNull();
    expect(sim.state.lanes[1].jumps).toBe(0);
    sim.setEvent("sprint");
    expect(sim.best.sprint).toBe(sprint);
    // the board's title carries the session's best
    expect(sim.state.best[0]).toBe(sprint);
  });

  it("switching to vs Bot brings the pacer back in a new race; back again runs alone", () => {
    const sim = new PracticeSim(1);
    for (let i = 0; i < 200; i++) sim.tick();
    sim.setMode("bot");
    expect(sim.state.solo).toBe(false);
    expect(sim.state.phase).toBe("set");
    for (let i = 0; i < 60 * 5; i++) sim.tick();
    expect(sim.state.lanes[1].distance).toBeGreaterThan(0);
    sim.setMode("solo");
    expect(sim.state.solo).toBe(true);
    expect(sim.state.lanes[1].distance).toBe(0);
  });
});
