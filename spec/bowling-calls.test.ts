// Bowling's words and guides on screen (task 29, ADR 004): the call after a
// ball, the speed and curve read, the guide arrow and the power meter.
import { describe, expect, it } from "vitest";
import { ARROW_SHARE, METER_FILL_S, arrowPoints, callFor, curveWords, meterAt, reactionFor, speedRead } from "../client/games/bowling/calls.ts";
import { BEND_Y, LANE, ballSpeed, speedZone, startX } from "../shared/games/bowling/sim.ts";
import type { BallResult } from "../shared/games/bowling/sim.ts";

const ball = (over: Partial<BallResult>): BallResult => ({
  seat: 0,
  frame: 0,
  ball: 0,
  pins: 0,
  left: [],
  strike: false,
  spare: false,
  gutter: false,
  timeout: false,
  split: false,
  read: { speed: 0.6, aim: 0, spin: 0, ms: ballSpeed(0.6) },
  ...over,
});

describe("bowling calls", () => {
  it("names the ball as a scoresheet would", () => {
    expect(callFor(ball({ pins: 10, strike: true }))).toBe("STRIKE!");
    expect(callFor(ball({ pins: 3, spare: true }))).toBe("Spare!");
    expect(callFor(ball({ pins: 8, split: true, left: [7, 10] }))).toBe("Split!");
    expect(callFor(ball({ gutter: true }))).toBe("Gutter");
    expect(callFor(ball({ gutter: true, timeout: true, read: null }))).toBe("Time's up");
    expect(callFor(ball({ pins: 7 }))).toBe("7 pins");
    expect(callFor(ball({ pins: 1 }))).toBe("1 pin");
  });

  it("the crowd cheers a strike or spare and groans at a gutter", () => {
    expect(reactionFor(ball({ pins: 10, strike: true }))).toBe("cheer");
    expect(reactionFor(ball({ pins: 2, spare: true }))).toBe("cheer");
    expect(reactionFor(ball({ gutter: true }))).toBe("groan");
    expect(reactionFor(ball({ pins: 6 }))).toBeNull();
  });

  it("says the curve in plain words", () => {
    expect(curveWords(0)).toBe("none");
    expect(curveWords(-0.2)).toBe("a little left");
    expect(curveWords(0.8)).toBe("a lot right");
  });

  it("reads the speed against the sim's own zone for that curve, and just the speed when there is none", () => {
    const z = speedZone(-0.6)!;
    const inZone = speedRead({ speed: (z.min + z.max) / 2, spin: -0.6, ms: ballSpeed((z.min + z.max) / 2) });
    expect(inZone.verdict).toBe("good");
    expect(inZone.zone).toEqual({ min: ballSpeed(z.min), max: ballSpeed(z.max) });
    expect(speedRead({ speed: 0, spin: -0.6, ms: ballSpeed(0) }).verdict).toBe("slow");
    // a straight ball has no striking speed in this sim: the read, no zone
    expect(speedZone(0)).toBeNull();
    const straight = speedRead({ speed: 0.6, spin: 0, ms: ballSpeed(0.6) });
    expect(straight.zone).toBeNull();
    expect(straight.verdict).toBeNull();
  });

  it("the guide arrow starts at the start spot and stops a third of the way down, short of the bend", () => {
    for (const [aim, spin] of [[0, 0], [0.5, -1], [-0.8, 1]]) {
      const pts = arrowPoints(aim, spin);
      expect(pts[0].x).toBeCloseTo(startX(aim), 3);
      const end = pts.at(-1)!;
      expect(end.y).toBeCloseTo(LANE.length * ARROW_SHARE, 3);
      expect(end.y).toBeLessThan(BEND_Y);
      // straight down the boards: the curve doesn't show on it
      expect(end.x).toBeCloseTo(startX(aim), 3);
    }
  });

  it("the power meter fills, then falls, then fills again while held", () => {
    expect(meterAt(0)).toBe(0);
    expect(meterAt(METER_FILL_S / 2)).toBeCloseTo(0.5);
    expect(meterAt(METER_FILL_S)).toBeCloseTo(1);
    expect(meterAt(METER_FILL_S * 1.5)).toBeCloseTo(0.5);
    expect(meterAt(METER_FILL_S * 2)).toBeCloseTo(0);
  });
});
