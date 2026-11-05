// Boxing practice (task 30): the bout in the page against the bot, bout after
// bout. No room or server.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/boxing/practice-sim.ts";
import { BREAK_TICKS, DAMAGE, HEALTH, OVER_TICKS, ROUND_TICKS, TICK_MS } from "../shared/games/boxing/sim.ts";

describe("boxing practice", () => {
  it("your punch lands on the sparring partner after its wind-up, and the partner's health falls", () => {
    const sim = new PracticeSim(1);
    sim.punch("jab", "left", 0);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.state.boxers[0].thrown).toBe(1);
    expect(sim.state.boxers[1].health).toBeLessThanOrEqual(HEALTH - 1);
  });

  it("is endless: a finished bout starts the next one", () => {
    const sim = new PracticeSim(2);
    let hand: "left" | "right" = "left";
    for (let i = 0; i < 60 * 60 * 5 && sim.state.bouts === 0; i++) {
      if (i % 20 === 0) {
        sim.punch("hook", hand, i * TICK_MS);
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
    sim.punch("jab", "left", 0);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it("the guard goes up and down with your input", () => {
    const sim = new PracticeSim(4);
    sim.guard(true);
    sim.tick();
    expect(sim.state.boxers[0].guard).toBe(true);
    sim.guard(false);
    sim.tick();
    expect(sim.state.boxers[0].guard).toBe(false);
  });

  it("uses the sim's own numbers", () => {
    expect(DAMAGE.jab).toBeLessThan(DAMAGE.hook);
    expect(BREAK_TICKS).toBeGreaterThan(0);
    expect(ROUND_TICKS).toBe(30 * 60);
  });
});
