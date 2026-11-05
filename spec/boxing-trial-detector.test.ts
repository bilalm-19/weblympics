// The trial camera detector (task 30 playtest), on sequences shaped like the
// user's real-webcam recordings (docs/playtest/boxing-2026-11-05-hand-model.txt).
// Heights are above the shoulder line, sizes and reach in shoulder widths.
import { describe, expect, it } from "vitest";
import { TrialDetector, handMeasures } from "../client/input/camera/box-pose.ts";
import type { ArmMeasures, BoxHand, HandMeasures, TrialFrame } from "../client/input/camera/box-pose.ts";
import type { Point } from "../client/input/camera/pose.ts";

const arm = (reach: number, height = 0): ArmMeasures => ({ size: 0.2, elbow2d: 10, elbow3d: 130, forward: 3, reach, across: 0, down: -height });
const hand = (size: number, height: number, across: number): HandMeasures => ({ size, height, across });

// from the recording: each hand's typical size and position
const REST = { left: 0.24, right: 0.22 };
const SIDE = { left: 0.5, right: -0.5 };

function pose(opts: { height: number; grow?: Partial<Record<BoxHand, number>>; reach?: Partial<Record<BoxHand, number>>; lost?: BoxHand[] }): TrialFrame {
  const h = (side: BoxHand) => (opts.lost?.includes(side) ? null : hand(REST[side] * (opts.grow?.[side] ?? 1), opts.height, SIDE[side]));
  return {
    hands: { left: h("left"), right: h("right") },
    arms: { left: arm(opts.reach?.left ?? 0.25), right: arm(opts.reach?.right ?? 0.25) },
  };
}

/** Feeds frames at 24 fps (as recorded) and collects the punches. */
function run(d: TrialDetector, frames: TrialFrame[], t0 = 0) {
  const out = [];
  let guard = null;
  for (let i = 0; i < frames.length; i++) {
    const r = d.update(frames[i], t0 + (i * 1000) / 24);
    if (r.punch) out.push(r.punch);
    guard = r.guard;
  }
  return { punches: out, guard };
}

const hold = (f: TrialFrame, n: number) => Array.from({ length: n }, () => f);

describe("trial detector", () => {
  it("reads nothing from a relaxed stance or a slightly growing hand (moving: at most 1.25x)", () => {
    const d = new TrialDetector();
    const frames = [...hold(pose({ height: 0.17 }), 24), ...hold(pose({ height: 0.2, grow: { left: 1.25, right: 1.2 } }), 3), ...hold(pose({ height: 0.17 }), 24)];
    expect(run(d, frames).punches).toEqual([]);
  });

  it("a jab: the fist grows 1.5x, at head height (0.6) is a head jab, at 0.2 a body jab", () => {
    const d = new TrialDetector();
    const guard = pose({ height: 0.6 });
    const frames = [...hold(guard, 24), ...hold(pose({ height: 0.6, grow: { right: 1.5 } }), 3), ...hold(guard, 12), ...hold(pose({ height: 0.2, grow: { left: 1.45 } }), 3), ...hold(guard, 12)];
    const p = run(d, frames).punches;
    expect(p.map((x) => [x.hand, x.kind, x.target])).toEqual([
      ["right", "jab", "head"],
      ["left", "jab", "body"],
    ]);
  });

  it("one jab held out is one punch; the hand must come back before the next", () => {
    const d = new TrialDetector();
    const frames = [...hold(pose({ height: 0.6 }), 24), ...hold(pose({ height: 0.6, grow: { right: 1.5 } }), 20), ...hold(pose({ height: 0.6 }), 12), ...hold(pose({ height: 0.6, grow: { right: 1.5 } }), 3)];
    expect(run(d, frames).punches).toHaveLength(2);
  });

  it("a hook: the pose wrist swings out past 0.9 while the hand model loses that hand", () => {
    const d = new TrialDetector();
    const frames = [...hold(pose({ height: 0.6 }), 24), ...hold(pose({ height: 0.6, reach: { left: 1.1 }, lost: ["left"] }), 3), ...hold(pose({ height: 0.6 }), 12)];
    const p = run(d, frames).punches;
    expect(p.map((x) => [x.hand, x.kind])).toEqual([["left", "hook"]]);
  });

  it("a pose-model glitch in the guard (reach 1.23 with the hand model still seeing the hand) isn't a hook", () => {
    const d = new TrialDetector();
    const frames = [...hold(pose({ height: 0.6 }), 24), ...hold(pose({ height: 0.6, reach: { left: 1.23 } }), 3), ...hold(pose({ height: 0.6 }), 12)];
    expect(run(d, frames).punches).toEqual([]);
  });

  it("guards: both fists at 0.6 is high, at 0.33 low, at 0.17 (relaxed) none", () => {
    expect(run(new TrialDetector(), hold(pose({ height: 0.6 }), 10)).guard).toBe("high");
    expect(run(new TrialDetector(), hold(pose({ height: 0.33 }), 10)).guard).toBe("low");
    expect(run(new TrialDetector(), hold(pose({ height: 0.17 }), 10)).guard).toBe(null);
  });

  it("a guard needs a few steady frames, so one stray frame doesn't drop it", () => {
    const d = new TrialDetector();
    const frames = [...hold(pose({ height: 0.6 }), 10), pose({ height: 0.17 }), ...hold(pose({ height: 0.6 }), 2)];
    expect(run(d, frames).guard).toBe("high");
  });
});

describe("handMeasures", () => {
  it("places the hand model's hands by side of the body, not by label, in shoulder widths", () => {
    const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
    // shoulders 0.2 apart at y 0.6 (aspect 1); the image isn't mirrored: the player's left is image right
    lm[11] = { x: 0.6, y: 0.6, visibility: 1 };
    lm[12] = { x: 0.4, y: 0.6, visibility: 1 };
    const palm = (cx: number, cy: number, s: number): Point[] => {
      const pts: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
      pts[0] = { x: cx, y: cy + s };
      pts[5] = { x: cx - s / 2, y: cy };
      pts[9] = { x: cx, y: cy };
      pts[17] = { x: cx + s / 2, y: cy };
      return pts;
    };
    const r = handMeasures([{ points: palm(0.65, 0.48, 0.04) }, { points: palm(0.35, 0.48, 0.04) }], lm, 1)!;
    expect(r.left!.height).toBeCloseTo(0.6, 5);
    expect(r.left!.across).toBeGreaterThan(0);
    expect(r.right!.across).toBeLessThan(0);
    expect(r.left!.size).toBeGreaterThan(0.15);
  });
});
