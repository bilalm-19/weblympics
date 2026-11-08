// Task 32: basketball practice runs the shootout sim in the page against the
// bot, match after match, through the same step the server runs. No room.
import { describe, expect, it } from "vitest";
import { PracticeSim } from "../client/games/basketball/practice-sim.ts";
import { SHOT_CLOCK_TICKS, SPOTS, makeWindow, simulateShot } from "../shared/games/basketball/sim.ts";

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
    const sim = new PracticeSim(7, "bot");
    myShot(sim);
    for (let i = 0; i < 400 && sim.state.phase !== "result"; i++) sim.tick();
    expect(sim.state.last?.seat).toBe(0);
    expect(sim.state.last?.made).toBe(true);
    // the bot takes its turn on its own
    for (let i = 0; i < 2000 && sim.state.shots.length < 2; i++) sim.tick();
    expect(sim.state.shots[1].seat).toBe(1);
  });

  it("never ends: a finished match starts a fresh one", () => {
    const sim = new PracticeSim(3, "bot");
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
    const sim = new PracticeSim(1, "bot");
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

// Task 38: "Just me", the default: one shooter, no turns, no shot clock.
/** Waits for the next shot, then shoots from wherever it is (in the window, or an air ball). */
function soloShot(sim: PracticeSim, make: boolean): void {
  for (let i = 0; i < 1000 && sim.state.phase !== "aim"; i++) sim.tick();
  const w = makeWindow(sim.state.spot);
  sim.shoot(make ? (w.lo + w.hi) / 2 : 0, 0, 0);
  for (let i = 0; i < 1000 && sim.state.phase !== "result"; i++) sim.tick();
}

describe("basketball practice: Just me (task 38)", () => {
  it("opens alone: every shot is yours, and no bot shoots", () => {
    const sim = new PracticeSim(5);
    expect(sim.mode).toBe("solo");
    for (let i = 0; i < 4; i++) soloShot(sim, true);
    expect(sim.state.shots).toHaveLength(4);
    expect(sim.state.shots.every((x) => x.seat === 0)).toBe(true);
    expect(sim.state.attempts).toEqual([4, 0]);
  });

  it("has no shot clock: a shot long after the setup still flies, and nothing is lost to time", () => {
    const sim = new PracticeSim(5);
    sim.set();
    for (let i = 0; i < SHOT_CLOCK_TICKS * 2; i++) sim.tick();
    expect(sim.state.phase).toBe("aim");
    expect(sim.snapshot().clockRunning).toBe(false);
    expect(sim.state.shots).toEqual([]);
    soloShot(sim, true);
    expect(sim.state.last?.made).toBe(true);
    expect(sim.state.last?.lost).toBeUndefined();
  });

  it("the ball comes back: after a shot the next one is ready, with no end", () => {
    const sim = new PracticeSim(5);
    for (let i = 0; i < 12; i++) soloShot(sim, i % 2 === 0);
    for (let i = 0; i < 200 && sim.state.phase !== "aim"; i++) sim.tick();
    expect(sim.state.phase).toBe("aim");
    expect(sim.state.attempts[0]).toBe(12);
    expect(sim.state.makes[0]).toBe(6);
  });

  it("a picked spot stays put; Cycle goes through the five", () => {
    const sim = new PracticeSim(5);
    sim.setSpot(4);
    expect(sim.state.spot).toBe(4);
    for (let i = 0; i < 3; i++) soloShot(sim, false);
    expect(sim.state.shots.map((x) => x.spot)).toEqual([4, 4, 4]);
    // Cycle carries on from the spot you were at
    sim.setSpot(null);
    for (let i = 0; i < 5; i++) soloShot(sim, false);
    expect(sim.state.shots.slice(-5).map((x) => x.spot)).toEqual([0, 1, 2, 3, 4]);
  });

  it("scores a shot just as the server's flight does", () => {
    const sim = new PracticeSim(5);
    sim.setSpot(2);
    const w = makeWindow(2);
    const power = (w.lo + w.hi) / 2;
    soloShot(sim, true);
    const r = simulateShot(2, power, 0);
    expect(sim.state.last?.made).toBe(r.made);
    expect(sim.state.last?.points).toBe(r.made ? SPOTS[2].points + (!r.rim && !r.board ? 1 : 0) : 0);
  });

  it("counts the streak: makes in a row, a miss resets it, the best stays", () => {
    const sim = new PracticeSim(5);
    soloShot(sim, true);
    soloShot(sim, true);
    soloShot(sim, true);
    expect(sim.streak).toBe(3);
    soloShot(sim, false);
    expect(sim.streak).toBe(0);
    soloShot(sim, true);
    expect(sim.streak).toBe(1);
    expect(sim.bestStreak).toBe(3);
  });

  it("switching to vs Bot starts the shootout cleanly, and the bot takes its turn", () => {
    const sim = new PracticeSim(5);
    soloShot(sim, true);
    sim.setMode("bot");
    expect(sim.state.format).toBe("shootout");
    expect(sim.state.shots).toEqual([]);
    expect(sim.state.spot).toBe(0);
    myShot(sim);
    for (let i = 0; i < 3000 && sim.state.shots.length < 2; i++) sim.tick();
    expect(sim.state.shots[1].seat).toBe(1);
    sim.setMode("solo");
    expect(sim.state.shots).toEqual([]);
    expect(sim.state.phase).toBe("aim");
  });
});
