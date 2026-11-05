// Boxing practice (task 30): the bout in the page against the bot, bout after
// bout. No room or server.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/boxing/practice-sim.ts";
import { BREAK_TICKS, HEALTH, JAB_DAMAGE, OVER_TICKS, ROUND_TICKS, TICK_MS } from "../shared/games/boxing/sim.ts";

describe("boxing practice", () => {
  it("your jabs land on the sparring partner after their wind-up, and the partner's health falls", () => {
    // the partner defends some jabs, so throw a few
    const sim = new PracticeSim(1);
    for (let n = 0; n < 6; n++) {
      sim.punch(n % 2 ? "right" : "left", n % 3 ? "head" : "body", n * 400);
      for (let i = 0; i < 24; i++) sim.tick();
    }
    expect(sim.state.boxers[0].thrown).toBe(6);
    expect(sim.state.boxers[0].dealt).toBeGreaterThan(0);
    expect(sim.state.boxers[1].health).toBeLessThan(HEALTH);
  });

  it("is endless: a finished bout starts the next one", () => {
    const sim = new PracticeSim(2);
    let hand: "left" | "right" = "left";
    for (let i = 0; i < 60 * 60 * 10 && sim.state.bouts === 0; i++) {
      if (i % 20 === 0) {
        sim.punch(hand, i % 40 === 0 ? "head" : "body", i * TICK_MS);
        hand = hand === "left" ? "right" : "left";
      }
      sim.tick();
    }
    expect(sim.state.bouts).toBe(1);
    for (let i = 0; i < OVER_TICKS + 5; i++) sim.tick();
    expect(sim.state.phase).toBe("round");
    expect(sim.state.boxers[0].health).toBe(HEALTH);
    expect(sim.state.boxers[1].health).toBe(HEALTH);
  });

  it("holds still while paused (the camera setup is open)", () => {
    const sim = new PracticeSim(3);
    for (let i = 0; i < 100; i++) sim.tick();
    sim.paused = true;
    const before = JSON.stringify(sim.state);
    sim.punch("left", "head", 0);
    sim.slip("left");
    for (let i = 0; i < 100; i++) sim.tick();
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it("the guard goes high, low and down, and a slip starts, with your input", () => {
    const sim = new PracticeSim(4);
    sim.guard("high");
    sim.tick();
    expect(sim.state.boxers[0].guard).toBe("high");
    sim.guard("low");
    sim.tick();
    expect(sim.state.boxers[0].guard).toBe("low");
    sim.guard(null);
    sim.tick();
    expect(sim.state.boxers[0].guard).toBeNull();
    sim.slip("right");
    sim.tick();
    expect(sim.state.boxers[0].slip?.side).toBe("right");
  });

  it("uses the sim's own numbers", () => {
    expect(JAB_DAMAGE).toBeGreaterThan(0);
    expect(BREAK_TICKS).toBeGreaterThan(0);
    expect(ROUND_TICKS).toBe(30 * 60);
  });
});
