// The trial camera detector (task 30 playtest), on sequences shaped like the
// user's real-webcam recordings (docs/playtest/boxing-2026-11-05-hand-model.txt).
// Heights are above the shoulder line, sizes and reach in shoulder widths.
import { describe, expect, it } from "vitest";
import { SlipDetector, TRIAL_BOX, TrialDetector, handMeasures } from "../client/input/camera/box-pose.ts";
import type { ArmMeasures, BoxHand, HandMeasures, TrialFrame } from "../client/input/camera/box-pose.ts";
import type { Point } from "../client/input/camera/pose.ts";

const arm = (reach: number, height = 0): ArmMeasures => ({ size: 0.2, elbow2d: 10, elbow3d: 130, forward: 3, reach, across: 0, down: -height });
const hand = (size: number, height: number, across: number): HandMeasures => ({ size, height, across });

// from the recording: each hand's typical size and position
const REST = { left: 0.24, right: 0.22 };
const SIDE = { left: 0.5, right: -0.5 };

function pose(opts: { height: number; heights?: Partial<Record<BoxHand, number>>; grow?: Partial<Record<BoxHand, number>>; reach?: Partial<Record<BoxHand, number>>; lost?: BoxHand[] }): TrialFrame {
  const h = (side: BoxHand) => (opts.lost?.includes(side) ? null : hand(REST[side] * (opts.grow?.[side] ?? 1), opts.heights?.[side] ?? opts.height, SIDE[side]));
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

  it("camera hooks are off (playtest 3): a wide swing with the hand lost throws nothing", () => {
    const d = new TrialDetector();
    const frames = [...hold(pose({ height: 0.6 }), 24), ...hold(pose({ height: 0.6, reach: { left: 1.1 }, lost: ["left"] }), 3), ...hold(pose({ height: 0.6 }), 12)];
    expect(run(d, frames).punches).toEqual([]);
  });

  it("with hooks on: the pose wrist swings out past 0.9 while the hand model loses that hand", () => {
    const d = new TrialDetector({ ...TRIAL_BOX, hooks: true });
    const frames = [...hold(pose({ height: 0.6 }), 24), ...hold(pose({ height: 0.6, reach: { left: 1.1 }, lost: ["left"] }), 3), ...hold(pose({ height: 0.6 }), 12)];
    const p = run(d, frames).punches;
    expect(p.map((x) => [x.hand, x.kind])).toEqual([["left", "hook"]]);
  });

  it("a pose-model glitch in the guard (reach 1.23 with the hand model still seeing the hand) isn't a hook", () => {
    const d = new TrialDetector({ ...TRIAL_BOX, hooks: true });
    const frames = [...hold(pose({ height: 0.6 }), 24), ...hold(pose({ height: 0.6, reach: { left: 1.23 } }), 3), ...hold(pose({ height: 0.6 }), 12)];
    expect(run(d, frames).punches).toEqual([]);
  });

  it("guards: both fists at 0.6 is high, at 0.33 low, at 0.17 (relaxed) none", () => {
    expect(run(new TrialDetector(), hold(pose({ height: 0.6 }), 10)).guard).toBe("high");
    expect(run(new TrialDetector(), hold(pose({ height: 0.33 }), 10)).guard).toBe("low");
    expect(run(new TrialDetector(), hold(pose({ height: 0.17 }), 10)).guard).toBe(null);
  });

  it("one arm up is no guard (user, playtest 3): one fist at the face and the other down or lost", () => {
    expect(run(new TrialDetector(), hold(pose({ height: 0.6, heights: { left: 0.17 } }), 10)).guard).toBe(null);
    expect(run(new TrialDetector(), hold(pose({ height: 0.6, heights: { right: 0.33 } }), 10)).guard).toBe(null);
    expect(run(new TrialDetector(), hold(pose({ height: 0.6, lost: ["left"] }), 10)).guard).toBe(null);
  });

  it("after a jab from the guard with the other arm left up, the guard stays down until both are up again", () => {
    const d = new TrialDetector();
    const guard = pose({ height: 0.6 });
    const oneUp = pose({ height: 0.6, heights: { right: 0.17 } });
    const r1 = run(d, [...hold(guard, 24), ...hold(pose({ height: 0.6, grow: { right: 1.5 } }), 3), ...hold(oneUp, 10)]);
    expect(r1.punches).toHaveLength(1);
    expect(r1.guard).toBe(null);
    expect(run(d, hold(guard, 5), 5000).guard).toBe("high");
  });

  it("raising both hands from relaxed into a high guard reads the guard, not a jab (playtest 4)", () => {
    // the palms rise from 0.17 to 0.6 over a third of a second and look a
    // little bigger nearer the face (at most 1.2x), as the recordings showed
    const d = new TrialDetector();
    const frames: TrialFrame[] = [...hold(pose({ height: 0.17 }), 24)];
    for (let i = 1; i <= 8; i++) frames.push(pose({ height: 0.17 + (0.43 * i) / 8, grow: { left: 1 + 0.2 * (i / 8), right: 1 + 0.15 * (i / 8) } }));
    frames.push(...hold(pose({ height: 0.6, grow: { left: 1.2, right: 1.15 } }), 24));
    const r = run(d, frames);
    expect(r.punches).toEqual([]);
    expect(r.guard).toBe("high");
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

describe("the camera panel uses the trial detector for everyone (playtest 4)", () => {
  it("box-camera.ts runs TrialDetector with the hand model, and never the old BoxTracker", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../client/games/boxing/box-camera.ts", import.meta.url), "utf8");
    // the old tracker read 17 "jabs" in 5 s of a held guard from depth noise
    expect(src).not.toMatch(/new BoxTracker\(/);
    expect(src).toMatch(/new TrialDetector\(/);
    expect(src).toMatch(/hands: true/);
  });
});

describe("camera slip: a shoulder lean (playtest 4)", () => {
  // tilt in degrees, + to the player's right; frames at 24 fps
  const feed = (d: InstanceType<typeof SlipDetector>, tilts: number[], t0 = 0) => {
    const out: Array<"left" | "right"> = [];
    tilts.forEach((tilt, i) => {
      const r = d.update(tilt, t0 + (i * 1000) / 24);
      if (r) out.push(r);
    });
    return out;
  };
  const still = (deg: number, n: number) => Array.from({ length: n }, () => deg);

  it("learns the neutral from the first second, so sitting a little tilted isn't a slip", () => {
    const d = new SlipDetector();
    // sits 6 degrees tilted the whole time: no slip
    expect(feed(d, still(6, 72))).toEqual([]);
    expect(d.neutral).toBeCloseTo(6, 5);
  });

  it("a lean past 8 degrees from neutral is one slip that way; it re-arms back within 4", () => {
    const d = new SlipDetector();
    const r = feed(d, [...still(0, 30), ...still(10, 12), ...still(0, 6), ...still(-10, 12), ...still(0, 6)]);
    expect(r).toEqual(["right", "left"]);
  });

  it("holding a lean is one slip, not many", () => {
    const d = new SlipDetector();
    expect(feed(d, [...still(0, 30), ...still(12, 72)])).toEqual(["right"]);
  });

  it("a small sway (within 8 degrees) is nothing", () => {
    const d = new SlipDetector();
    const sway = Array.from({ length: 96 }, (_, i) => 5 * Math.sin(i / 4));
    expect(feed(d, [...still(0, 30), ...sway])).toEqual([]);
  });

  it("lost shoulders (null) neither slip nor reset the neutral", () => {
    const d = new SlipDetector();
    feed(d, still(0, 30));
    expect(d.update(null, 2000)).toBeNull();
    expect(d.neutral).toBe(0);
  });

  it("the camera panel sends a slip from the shoulder lean", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../client/games/boxing/box-camera.ts", import.meta.url), "utf8");
    expect(src).toMatch(/new SlipDetector\(/);
    expect(src).toMatch(/cb\.slip\(/);
  });
});
