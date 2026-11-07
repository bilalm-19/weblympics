// Basketball's flight (task 32, ADR 003): the server's ball against its own
// rim and backboard. No random scatter, so every case here is a fixed shot.
import { describe, expect, it } from "vitest";
import {
  BALL_R,
  RELEASE,
  RIM,
  SPOTS,
  createState,
  flyTick,
  launch,
  makeWindow,
  simulateShot,
  snapshot,
  step,
} from "../shared/games/basketball/sim.ts";
import { powerFor, shoot } from "./basketball-helpers.ts";

describe("basketball flight", () => {
  it("leaves a fixed release point; more power flies further; aim turns it sideways", () => {
    const soft = launch(0, 0.2, 0);
    const hard = launch(0, 0.8, 0);
    expect(soft.pos).toEqual(hard.pos);
    expect(soft.pos.y).toBe(RELEASE.y);
    expect(Math.hypot(hard.vel.x, hard.vel.y, hard.vel.z)).toBeGreaterThan(Math.hypot(soft.vel.x, soft.vel.y, soft.vel.z));
    // the free throw is straight out from the board: a centred aim has no sideways speed
    expect(soft.vel.x).toBeCloseTo(0, 9);
    expect(launch(0, 0.5, 1).vel.x).toBeGreaterThan(0);
    expect(launch(0, 0.5, -1).vel.x).toBeLessThan(0);
    // clamped
    expect(launch(0, 5, 9)).toEqual(launch(0, 1, 1));
  });

  it("a make is the ball's centre crossing down through the rim plane inside the rim", () => {
    const p = powerFor(0, "swish");
    const ball = launch(0, p, 0);
    const contact = { rim: false, board: false };
    let prev = { ...ball.pos };
    for (let t = 0; t < 400; t++) {
      prev = { ...ball.pos };
      const r = flyTick(ball, contact);
      if (r !== "flying") {
        expect(r).toBe("made");
        break;
      }
    }
    expect(prev.y).toBeGreaterThanOrEqual(RIM.y - 0.2);
    expect(ball.pos.y).toBeLessThan(RIM.y);
    expect(Math.hypot(ball.pos.x, ball.pos.z)).toBeLessThan(RIM.r + 0.2);
    // a ball going up through the rim's plane from below never counts: a soft shot falls short
    expect(simulateShot(0, 0, 0).made).toBe(false);
  });

  it("a ball can rattle in off the rim, and roll out off it", () => {
    for (const spot of [0, 1, 2]) {
      const inn = simulateShot(spot, powerFor(spot, "rimIn"), 0);
      expect(inn).toMatchObject({ made: true, rim: true, board: false });
      const out = simulateShot(spot, powerFor(spot, "rimOut"), 0);
      expect(out).toMatchObject({ made: false, rim: true, board: false });
    }
  });

  it("a bank shot: a hard ball off the bounded backboard can drop in", () => {
    const p = powerFor(3, "bank");
    expect(simulateShot(3, p, 0)).toMatchObject({ made: true, board: true });
    // the board is bounded: a shot aimed wide of it at full power flies past without touching it
    const wide = simulateShot(4, 1, 1);
    expect(wide.made).toBe(false);
  });

  it("identical shots give identical results, every time", () => {
    for (let i = 0; i < 20; i++) {
      const power = (i * 37) % 100 / 100;
      const aim = ((i * 13) % 21) / 10 - 1;
      expect(simulateShot(i % 5, power, aim)).toEqual(simulateShot(i % 5, power, aim));
    }
  });

  it("aiming off centre at the window's middle misses at full aim", () => {
    for (let spot = 0; spot < SPOTS.length; spot++) {
      const w = makeWindow(spot);
      expect(simulateShot(spot, (w.lo + w.hi) / 2, 1).made).toBe(false);
      expect(simulateShot(spot, (w.lo + w.hi) / 2, -1).made).toBe(false);
    }
  });

  it("the substeps keep a fast ball from passing through the rim", () => {
    // a full-power ball aimed so it reaches the rim: it touches, never tunnels
    const ball = launch(4, 1, 0);
    const contact = { rim: false, board: false };
    let minDist = Infinity;
    for (let t = 0; t < 300; t++) {
      if (flyTick(ball, contact) !== "flying") break;
      const h = Math.hypot(ball.pos.x, ball.pos.z);
      minDist = Math.min(minDist, Math.hypot(h - RIM.r, ball.pos.y - RIM.y));
    }
    expect(minDist).toBeGreaterThan(BALL_R + RIM.tube - 0.03);
  });
});

describe("basketball make window", () => {
  const windows = SPOTS.map((_, i) => makeWindow(i));

  it("every spot is makeable with power in 0..1, and every power in the window scores", () => {
    windows.forEach((w, spot) => {
      expect(w.lo).toBeGreaterThan(0);
      expect(w.hi).toBeLessThan(1);
      expect(w.hi).toBeGreaterThan(w.lo);
      for (let p = w.lo; p <= w.hi + 1e-9; p += 0.005) expect(simulateShot(spot, Math.min(p, w.hi), 0).made).toBe(true);
      // just outside it, it doesn't
      expect(simulateShot(spot, w.lo - 0.001, 0).made).toBe(false);
      expect(simulateShot(spot, w.hi + 0.001, 0).made).toBe(false);
    });
  });

  it("further needs harder, and the window narrows with distance: the free throw wide, 9 m thin", () => {
    for (let i = 1; i < windows.length; i++) expect(windows[i].lo).toBeGreaterThan(windows[i - 1].lo);
    const width = windows.map((w) => w.hi - w.lo);
    expect(width[0]).toBeGreaterThan(0.1);
    expect(width[4]).toBeLessThan(0.04);
    expect(width[0]).toBeGreaterThan(width[1]);
    expect(width[1]).toBeGreaterThan(width[4]);
    expect(width[2]).toBeGreaterThan(width[4]);
    expect(width[3]).toBeGreaterThan(width[4]);
    expect(width[0]).toBeGreaterThan(3 * width[4]);
  });

  it("is pure: the same answer every call, and a copy the caller can't spoil", () => {
    const w = makeWindow(2);
    w.lo = -5;
    expect(makeWindow(2)).toEqual(windows[2]);
  });
});

describe("basketball ball in play", () => {
  it("the snapshot's path follows the ball from the release, and the ball keeps falling after the call", () => {
    const s = createState(1);
    const b = shoot(s, powerFor(0, "swish"));
    expect(b.made).toBe(true);
    const snap = snapshot(s);
    expect(snap.phase).toBe("result");
    const last = snap.path[snap.path.length - 1];
    expect(last.y).toBeLessThan(RIM.y);
    const y = snap.ball!.pos.y;
    for (let i = 0; i < 10; i++) step(s, []);
    expect(snapshot(s).ball!.pos.y).toBeLessThan(y);
  });
});
