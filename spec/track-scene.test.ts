// Task 31: track's look as plain numbers (client/games/track/scene-model.ts):
// the run cycle follows the server's speed, the crowd gets louder toward the
// line and bursts at the finish, and the finish clock reads the race time.
// Drawing only; nothing here feeds the sim.
import { describe, expect, it } from "vitest";
import { clockText, clockTime, excitement, runPose } from "../client/games/track/scene-model.ts";
import { DT, LANE_LENGTH, createState, snapshot, step, takeStep } from "../shared/games/track/sim.ts";

describe("run cycle", () => {
  it("swings legs opposite each other and each arm opposite its leg", () => {
    for (const phase of [0.4, 1.3, 2.2, 4]) {
      const p = runPose(phase, 0.8);
      expect(p.hip.left).toBeCloseTo(-p.hip.right);
      expect(Math.sign(p.shoulder.left)).toBe(-Math.sign(p.hip.left));
    }
  });

  it("strides longer, drives the arms harder and leans more with speed", () => {
    const stride = (v: number) => Math.max(...[0, 0.5, 1, 1.5, 2, 2.5, 3].map((ph) => Math.abs(runPose(ph, v).hip.left)));
    expect(stride(1)).toBeGreaterThan(stride(0.5));
    expect(stride(0.5)).toBeGreaterThan(stride(0));
    expect(runPose(0, 1).elbow.left).toBeGreaterThan(runPose(0, 0).elbow.left);
    expect(runPose(0, 1).lean).toBeGreaterThan(runPose(0, 0).lean);
    // standing still: no bounce
    expect(runPose(1, 0).bounce).toBe(0);
  });

  it("clamps speed outside 0..1 and crouches at the blocks", () => {
    expect(runPose(1, 3)).toEqual(runPose(1, 1));
    const set = runPose(1, 0, true);
    expect(set.lean).toBeGreaterThan(runPose(1, 1).lean);
    expect(set.bounce).toBeLessThan(0);
  });
});

describe("crowd", () => {
  it("murmurs at the blocks, rises toward the line, bursts at the finish and settles", () => {
    const blocks = excitement(0, null, false);
    const early = excitement(0.2, null, true);
    const late = excitement(0.9, null, true);
    const burst = excitement(1, 0.5, true);
    expect(blocks).toBeLessThan(early);
    expect(early).toBeLessThan(late);
    expect(late).toBeLessThan(burst);
    expect(burst).toBe(1);
    expect(excitement(1, 10, false)).toBeLessThan(burst);
    for (const v of [blocks, early, late, burst]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("finish clock", () => {
  it("reads 0.00 at the blocks, the race time while running, and stops at the first finish", () => {
    const s = createState(7, { solo: true });
    expect(clockText(clockTime(snapshot(s)))).toBe("0.00");
    while (s.phase === "set") step(s, []);
    for (let i = 0; i < 60; i++) step(s, []);
    expect(clockTime(snapshot(s))).toBeCloseTo(60 * DT, 5);

    // run lane 0 to the line at a steady cadence
    let at = 0;
    let side: "left" | "right" = "left";
    for (let i = 0; i < 60 * 40 && s.phase === "running"; i++) {
      if (i % 10 === 0) {
        at += 1000 / 6;
        takeStep(s, { t: "step", seat: 0, side, at });
        side = side === "left" ? "right" : "left";
      }
      step(s, []);
    }
    const lane = snapshot(s).lanes[0];
    expect(lane.distance).toBeGreaterThanOrEqual(LANE_LENGTH);
    expect(lane.finish).not.toBeNull();
    expect(clockTime(snapshot(s))).toBe(lane.finish);
  });
});
