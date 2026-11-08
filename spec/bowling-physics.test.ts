// Bowling's lane and pins (task 29, ADR 004): the server rolls the ball and
// knocks the pins in a 2D sim with no random scatter. These pin down the
// tuning the ADR asks for: a pocket ball at a good speed strikes, a curving
// one strikes more often than a straight one, a slow ball deflects and
// leaves pins, a head-on hit can split, gutters score 0, spares are pickable.
import { describe, expect, it } from "vitest";
import {
  BALL,
  BEND_Y,
  LANE,
  PIN,
  PIN_SPOTS,
  aimFor,
  ballXAt,
  freshPins,
  isSplit,
  pocketX,
  simulateThrow,
  speedZone,
  startX,
} from "../shared/games/bowling/sim.ts";

const pocket = (speed: number, spin: number) => simulateThrow({ speed, aim: aimFor(speed, spin), spin });

/** Strikes over a sweep of throws around the pocket: ten lines 1 cm apart, four good speeds. */
function sweep(spin: number): { strikes: number; throws: number } {
  let strikes = 0;
  let throws = 0;
  for (let dx = -0.05; dx <= 0.0501; dx += 0.01)
    for (const speed of [0.55, 0.65, 0.75, 0.85]) {
      throws++;
      const x = pocketX(spin) + (spin > 0 ? -dx : dx);
      if (simulateThrow({ speed, aim: aimFor(speed, spin, x), spin }).down === 10) strikes++;
    }
  return { strikes, throws };
}

describe("the lane", () => {
  it("has real dimensions: 18.29 m to the head pin, 1.05 m wide, pins a foot apart", () => {
    expect(LANE.length).toBeCloseTo(18.29);
    expect(LANE.width).toBeCloseTo(1.05, 2);
    expect(PIN_SPOTS[0]).toEqual({ x: 0, y: LANE.length });
    expect(Math.hypot(PIN_SPOTS[1].x - PIN_SPOTS[2].x, PIN_SPOTS[1].y - PIN_SPOTS[2].y)).toBeCloseTo(0.3048);
    expect(PIN_SPOTS).toHaveLength(10);
  });

  it("the ball rolls straight for the first two thirds, then bends by spin", () => {
    const t = { speed: 0.7, aim: 0.5, spin: -1 };
    expect(ballXAt(t, BEND_Y - 0.1)).toBeCloseTo(startX(0.5), 6);
    expect(ballXAt(t, LANE.length - 1)!).toBeLessThan(startX(0.5) - 0.1);
    expect(ballXAt({ ...t, spin: 1, aim: -0.5 }, LANE.length - 1)!).toBeGreaterThan(startX(-0.5) + 0.1);
    expect(ballXAt({ ...t, spin: 0 }, LANE.length - 1)).toBeCloseTo(startX(0.5), 6);
  });

  it("the same throw always knocks the same pins (no random scatter)", () => {
    const t = { speed: 0.62, aim: 0.31, spin: -0.4 };
    const a = simulateThrow(t);
    const b = simulateThrow(t);
    expect(b.standing).toEqual(a.standing);
    expect(b.pins).toEqual(a.pins);
    expect(b.path).toEqual(a.path);
  });
});

describe("pins and the pocket", () => {
  it("a curving pocket ball at a good speed strikes", () => {
    for (const speed of [0.5, 0.6, 0.7, 0.8, 0.9]) expect(pocket(speed, -0.6).down, `speed ${speed}`).toBe(10);
    // either hand: curving right into the 1-2 pocket
    expect(pocket(0.7, 0.6).down).toBe(10);
  });

  it("over a sweep of throws, a straight pocket ball strikes less often than one curving in", () => {
    const straight = sweep(0);
    const curving = sweep(-0.6);
    const hard = sweep(-1);
    expect(straight.strikes).toBeLessThan(curving.strikes);
    expect(straight.strikes).toBeLessThan(hard.strikes);
    // and a straight ball in the exact pocket leaves a pin at every good speed
    for (const speed of [0.5, 0.7, 0.9]) expect(pocket(speed, 0).down, `speed ${speed}`).toBeLessThan(10);
  });

  it("a slow ball deflects and leaves pins", () => {
    for (const speed of [0.1, 0.15]) {
      const r = pocket(speed, -0.6);
      expect(r.down, `speed ${speed}`).toBeGreaterThan(0);
      expect(r.down, `speed ${speed}`).toBeLessThan(10);
    }
  });

  it("a dead-centre head-on hit can leave a split", () => {
    const splits = [0.5, 0.7, 0.9].filter((speed) => isSplit(simulateThrow({ speed, aim: aimFor(speed, 0, 0), spin: 0 }).standing));
    expect(splits.length).toBeGreaterThan(0);
  });

  it("a gutter ball scores 0", () => {
    for (const t of [
      { speed: 0.7, aim: -1, spin: -1 },
      { speed: 0.7, aim: 1, spin: 1 },
      { speed: 1, aim: 0.95, spin: 0.5 },
    ]) {
      const r = simulateThrow(t);
      expect(r.gutter).toBe(true);
      expect(r.down).toBe(0);
    }
  });

  it("every single-pin spare can be picked up, and a common leave too", () => {
    for (let n = 1; n <= 10; n++) {
      const pins = freshPins().map((p, i) => (i + 1 === n ? p : { ...p, standing: false, cleared: true }));
      const spot = PIN_SPOTS[n - 1];
      const r = simulateThrow({ speed: 0.7, aim: aimFor(0.7, 0, spot.x, spot.y - BALL.radius - PIN.radius), spin: 0 }, pins);
      expect(r.down, `pin ${n}`).toBe(1);
    }
    // the 3-6-10 leave, at the 3 pin's left edge
    const leave = freshPins().map((p, i) => ([3, 6, 10].includes(i + 1) ? p : { ...p, standing: false, cleared: true }));
    const three = PIN_SPOTS[2];
    let best = 0;
    for (const dx of [-0.06, -0.03, 0, 0.03, 0.06])
      best = Math.max(best, simulateThrow({ speed: 0.8, aim: aimFor(0.8, 0, three.x + dx, three.y - 0.17), spin: 0 }, leave).down);
    expect(best).toBe(3);
  });

  it("isSplit: the head pin down and two or more groups standing", () => {
    expect(isSplit([7, 10])).toBe(true);
    expect(isSplit([4, 6])).toBe(true);
    expect(isSplit([4, 7])).toBe(false);
    expect(isSplit([1, 7, 10])).toBe(false);
    expect(isSplit([10])).toBe(false);
  });
});

describe("the speed zone (the after-ball read)", () => {
  it("is the run of speeds that carries a centred pocket ball to a strike, from this sim", () => {
    const zone = speedZone(-0.6)!;
    expect(zone.min).toBeGreaterThan(0.1);
    expect(zone.max).toBeGreaterThan(zone.min);
    for (const speed of [zone.min, (zone.min + zone.max) / 2, zone.max]) expect(pocket(speed, -0.6).down).toBe(10);
    expect(pocket(zone.min - 0.1, -0.6).down).toBeLessThan(10);
  });

  it("a straight ball has no speed that strikes from the exact pocket", () => {
    expect(speedZone(0)).toBeNull();
  });
});
