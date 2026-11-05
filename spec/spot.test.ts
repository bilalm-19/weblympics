// Task 21: training's endless hit-the-spot mode. The spot placement, the
// closeness words and the streak are pure (client/games/tennis/spot.ts); the
// mode runs in the page through the TrainingSim and LocalLink, so it is
// driven here with no clock and no browser. The browser flow is
// e2e/training.e2e.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalLink } from "../client/games/tennis/local-link.ts";
import { BULLSEYE_RADIUS, MOVE_EVERY, NEAR_RADIUS, SPOT_AREA, SPOT_RADIUS, afterBall, closeness, newSpotState, resultText, spotTarget } from "../client/games/tennis/spot.ts";
import type { Closeness } from "../client/games/tennis/spot.ts";
import { TrainingSim } from "../client/games/tennis/training-sim.ts";
import type { TrainingEvent } from "../client/games/tennis/training-sim.ts";
import { COURT, naturalKind } from "../shared/games/tennis/sim.ts";

describe("spot placement", () => {
  it("is seeded: the same seed gives the same spots, another seed different ones", () => {
    const a = Array.from({ length: 20 }, (_, n) => spotTarget(7, n));
    expect(Array.from({ length: 20 }, (_, n) => spotTarget(7, n))).toEqual(a);
    expect(Array.from({ length: 20 }, (_, n) => spotTarget(8, n))).not.toEqual(a);
  });

  it("is always on the machine's half, inside the singles lines and past the net", () => {
    for (const seed of [1, 2, 3, 99, 0xdeadbeef]) {
      for (let n = 0; n < 50; n++) {
        const s = spotTarget(seed, n);
        expect(s.x).toBeGreaterThanOrEqual(SPOT_AREA.minX);
        expect(s.x).toBeLessThanOrEqual(SPOT_AREA.maxX);
        expect(s.z).toBeGreaterThanOrEqual(SPOT_AREA.minZ);
        expect(s.z).toBeLessThanOrEqual(SPOT_AREA.maxZ);
        // the whole ring is in the court
        expect(Math.abs(s.x) + SPOT_RADIUS).toBeLessThanOrEqual(COURT.halfW + 0.5);
        expect(s.z).toBeLessThan(0);
      }
    }
  });

  it("moves a visible distance each time it moves", () => {
    let moved = 0;
    for (let n = 1; n < 60; n++) {
      const a = spotTarget(5, n - 1);
      const b = spotTarget(5, n);
      if (Math.hypot(a.x - b.x, a.z - b.z) >= 2.5) moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(57);
  });
});

describe("closeness of a landing to the spot", () => {
  const spot = { x: 1, z: -6 };
  const at = (dx: number, dz: number, extra: Partial<{ in: boolean; net: boolean }> = {}) => ({ x: spot.x + dx, z: spot.z + dz, in: true, net: false, ...extra });
  const table: [string, Parameters<typeof closeness>[0], Closeness, number | null][] = [
    ["dead centre", at(0, 0), "bullseye", 0],
    ["just inside the bullseye", at(BULLSEYE_RADIUS - 0.01, 0), "bullseye", BULLSEYE_RADIUS - 0.01],
    ["inside the ring", at(0, 1), "on", 1],
    ["just inside the ring's edge", at(SPOT_RADIUS - 0.001, 0), "on", SPOT_RADIUS - 0.001],
    ["just outside the ring", at(0, SPOT_RADIUS + 0.01), "near", SPOT_RADIUS + 0.01],
    ["near, diagonally", at(1.5, 1.5), "near", Math.hypot(1.5, 1.5)],
    ["past near", at(0, NEAR_RADIUS + 0.5), "wide", NEAR_RADIUS + 0.5],
    ["far across the court", at(-5, 3), "wide", Math.hypot(5, 3)],
    ["landed out, even on top of it", at(0, 0, { in: false }), "out", null],
    ["into the net", at(0, 6, { net: true, in: false }), "net", null],
  ];
  for (const [name, landing, kind, distance] of table) {
    it(`${name}: ${kind}`, () => {
      const r = closeness(landing, spot);
      expect(r.kind).toBe(kind);
      if (distance === null) expect(r.distance).toBeNull();
      else expect(r.distance).toBeCloseTo(distance, 6);
    });
  }

  it("no return at all is its own result", () => {
    expect(closeness(null, spot)).toEqual({ kind: "none", distance: null });
  });

  it("says it in words, with the distance when it landed in", () => {
    expect(resultText({ kind: "near", distance: 1.94 })).toBe("Close: 1.9 m");
    expect(resultText({ kind: "bullseye", distance: 0.2 })).toBe("Bullseye!: 0.2 m");
    expect(resultText({ kind: "out", distance: null })).toBe("Out");
  });
});

describe("streak and when the spot moves", () => {
  it("a hit on the spot adds to the streak and moves the spot", () => {
    let s = newSpotState();
    s = afterBall(s, "on");
    expect(s).toEqual({ n: 1, balls: 0, streak: 1, best: 1 });
    s = afterBall(s, "bullseye");
    expect(s).toEqual({ n: 2, balls: 0, streak: 2, best: 2 });
  });

  it("anything else breaks the streak, keeps the best, and the spot moves after a few balls", () => {
    let s = { n: 4, balls: 0, streak: 3, best: 5 };
    for (let k = 1; k < MOVE_EVERY; k++) {
      s = afterBall(s, k % 2 ? "near" : "out");
      expect(s.streak).toBe(0);
      expect(s.best).toBe(5);
      expect(s.n).toBe(4);
    }
    s = afterBall(s, "none");
    expect(s.n).toBe(5);
    expect(s.balls).toBe(0);
  });

  it("starts from the best streak kept in the browser", () => {
    expect(newSpotState(9)).toEqual({ n: 0, balls: 0, streak: 0, best: 9 });
    expect(afterBall(newSpotState(9), "on").best).toBe(9);
  });
});

/** Runs the mode on its own clock-free link, swinging on time at every ball. */
function play(seed: number, balls: number, swing = true) {
  const sim = new TrainingSim(seed, "right");
  const link = new LocalLink(sim);
  const spots: Extract<TrainingEvent, { type: "spot" }>[] = [];
  link.onTraining((e) => {
    if (e.type === "spot") spots.push(e);
  });
  link.emitTraining(sim.startSpot(0));
  let swung = false;
  for (let n = 0; n < 60 * 60 && spots.length <= balls; n++) {
    link.advance(1);
    const s = sim.state;
    const coming = s.phase === "rally" && s.lastHitter === 1 && s.ball.vz > 0 && !s.pending;
    if (!coming) swung = false;
    else if (swing && !swung && s.ball.z >= COURT.halfL) {
      link.send({ t: "swing", dirX: 0, kind: naturalKind(0, s.players[0].x, s.ball.x), level: 1, timingAim: true });
      swung = true;
    }
  }
  return { sim, spots };
}

describe("the mode runs in the page and never ends", () => {
  const original = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, XMLHttpRequest: (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest };
  beforeEach(() => {
    const fail = vi.fn(() => {
      throw new Error("hit the spot must not use the network");
    });
    Object.assign(globalThis, { WebSocket: fail, fetch: fail, XMLHttpRequest: fail });
  });
  afterEach(() => {
    Object.assign(globalThis, original);
  });

  it("opens with a spot, then reports every ball, hit or let go, and keeps feeding", () => {
    const { spots } = play(31, 12);
    expect(spots[0].result).toBeNull();
    const results = spots.slice(1).map((e) => e.result!.kind);
    expect(results.length).toBeGreaterThanOrEqual(12);
    // on-time medium returns mostly land in, so most get a distance
    expect(results.filter((k) => k !== "none" && k !== "out" && k !== "net").length).toBeGreaterThan(6);
    expect(globalThis.WebSocket).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("standing still, every ball goes by as 'no return' and the spot moves every few balls", () => {
    const { spots } = play(31, 2 * MOVE_EVERY, false);
    const results = spots.slice(1);
    expect(results.every((e) => e.result!.kind === "none")).toBe(true);
    expect(results[MOVE_EVERY - 1].state.n).toBe(1);
    expect(results[2 * MOVE_EVERY - 1].state.n).toBe(2);
  });

  it("is deterministic: the same seed and swings give the same results", () => {
    const a = play(77, 8).spots.map((e) => [e.target, e.result]);
    const b = play(77, 8).spots.map((e) => [e.target, e.result]);
    expect(b).toEqual(a);
  });

  it("going back to a lesson leaves the mode", () => {
    const { sim } = play(31, 1);
    expect(sim.spot).not.toBeNull();
    sim.setLesson("forehand");
    expect(sim.spot).toBeNull();
  });
});
