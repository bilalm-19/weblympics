import { describe, expect, it } from "vitest";
import { FOREARM, SHOULDER, UPPER_ARM, elbowPole, hitStrength, jabExtension, poseFor, solveElbow } from "../client/games/boxing/boxer-pose.ts";
import type { BoxerView } from "../client/games/boxing/scene-model.ts";
import { firstPersonCamera } from "../client/games/boxing/scene.ts";
import { DEFAULT_LOOKS } from "../shared/look.ts";

// Task 30, the 3D view: the boxer's pose is pure numbers from the view model
// (boxer-pose.ts), so what each state looks like is pinned here without WebGL.
// Frame: the boxer's own, x to their right, y up, z toward the other boxer.

const idle: BoxerView = { look: DEFAULT_LOOKS[0], guard: null, slip: null, jab: null, hit: null, ko: false };
const view = (patch: Partial<BoxerView>): BoxerView => ({ ...idle, ...patch });

describe("boxer pose", () => {
  it("a high guard holds the gloves by the face, a low guard under the chin, none lower still", () => {
    const high = poseFor(view({ guard: "high" }));
    const low = poseFor(view({ guard: "low" }));
    const none = poseFor(view({ guard: null }));
    for (const hand of ["left", "right"] as const) {
      expect(high.gloves[hand].y).toBeGreaterThan(low.gloves[hand].y + 0.2);
      expect(low.gloves[hand].y).toBeGreaterThan(none.gloves[hand].y + 0.1);
      // by the face: near head height (1.78), in front of it
      expect(high.gloves[hand].y).toBeGreaterThan(1.6);
      expect(high.gloves[hand].z).toBeGreaterThan(0.2);
    }
    // gloves on their own sides
    expect(high.gloves.left.x).toBeLessThan(0);
    expect(high.gloves.right.x).toBeGreaterThan(0);
    // the low guard's forearms lie across the chest: elbows out
    expect(low.elbowOut.left).toBeGreaterThan(high.elbowOut.left);
  });

  it("a slip leans and drops to its own side", () => {
    const left = poseFor(view({ guard: "high", slip: "left" }));
    const right = poseFor(view({ guard: "high", slip: "right" }));
    expect(right.lean).toBeGreaterThan(0.15);
    expect(left.lean).toBeLessThan(-0.15);
    expect(left.drop).toBeGreaterThan(0.05);
    expect(poseFor(view({ guard: "high" })).lean).toBe(0);
  });

  it("a jab's glove reaches out at head or body height when it lands, and is back by the end", () => {
    const guard = poseFor(view({ guard: "high" }));
    const head = poseFor(view({ guard: "high", jab: { hand: "left", target: "head", t: 1 } }));
    const body = poseFor(view({ guard: "high", jab: { hand: "right", target: "body", t: 1 } }));
    // out in front, well past the guard
    expect(head.gloves.left.z).toBeGreaterThan(guard.gloves.left.z + 0.25);
    expect(body.gloves.right.z).toBeGreaterThan(guard.gloves.right.z + 0.2);
    // at the target's height: head about the head (1.78), body at the stomach
    expect(head.gloves.left.y).toBeGreaterThan(1.5);
    expect(body.gloves.right.y).toBeLessThan(1.25);
    expect(body.gloves.right.y).toBeGreaterThan(0.95);
    // the other hand keeps its guard
    expect(head.gloves.right).toEqual(guard.gloves.right);
    // and steps in with it
    expect(head.step).toBeGreaterThan(0.1);
    // halfway out, part of the way
    const mid = poseFor(view({ guard: "high", jab: { hand: "left", target: "head", t: 0.5 } }));
    expect(mid.gloves.left.z).toBeGreaterThan(guard.gloves.left.z);
    expect(mid.gloves.left.z).toBeLessThan(head.gloves.left.z);
    // back in the guard at the end of the return
    for (const t of [0, 2, 2.5]) {
      const end = poseFor(view({ guard: "high", jab: { hand: "left", target: "head", t } }));
      expect(end.gloves.left.z).toBeCloseTo(guard.gloves.left.z, 5);
      expect(end.gloves.left.y).toBeCloseTo(guard.gloves.left.y, 5);
    }
    expect(jabExtension(1)).toBe(1);
  });

  it("the arm can reach a jab's glove (the rig doesn't come apart)", () => {
    const p = poseFor(view({ jab: { hand: "right", target: "head", t: 1 } }));
    const shoulder = { ...SHOULDER };
    const { elbow, glove } = solveElbow(shoulder, p.gloves.right, UPPER_ARM, FOREARM, elbowPole("right", p.elbowOut.right));
    const d = (a: typeof glove, b: typeof glove) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(d(shoulder, elbow)).toBeCloseTo(UPPER_ARM, 4);
    expect(d(elbow, glove)).toBeCloseTo(FOREARM, 4);
    expect(d(glove, p.gloves.right)).toBeLessThan(0.05);
  });

  it("a clean shot to the head snaps it back, to the body hunches, blocked shakes the gloves, slipped does nothing", () => {
    const at = (outcome: "clean" | "blocked" | "slipped", target: "head" | "body", age = 0.08) =>
      poseFor(view({ guard: "high", hit: { outcome, target, age } }));
    expect(at("clean", "head").head).toBeGreaterThan(0.3);
    expect(at("clean", "head").hunch).toBe(0);
    expect(at("clean", "body").hunch).toBeGreaterThan(0.5);
    expect(at("clean", "body").head).toBe(0);
    // the shake wobbles: some moment in the first tenth of a second moves the gloves
    const shakes = [0.02, 0.04, 0.06, 0.08].map((age) => Math.abs(at("blocked", "head", age).shake));
    expect(Math.max(...shakes)).toBeGreaterThan(0.01);
    const slipped = at("slipped", "head");
    const still = poseFor(view({ guard: "high" }));
    expect(slipped).toEqual(still);
    // reactions fade
    expect(hitStrength(1.5)).toBeLessThan(0.01);
    expect(at("clean", "head", 1.5).head).toBeLessThan(0.01);
  });

  it("a knockout lies down and drops the guard", () => {
    const ko = poseFor(view({ guard: "high", ko: true, jab: { hand: "left", target: "head", t: 1 } }));
    expect(ko.fall).toBe(1);
    expect(ko.gloves.left.y).toBeLessThan(poseFor(view({ guard: "high" })).gloves.left.y);
    expect(ko.step).toBe(0);
    expect(poseFor(view({ guard: "high" })).fall).toBe(0);
  });
});

describe("first-person camera", () => {
  it("a portrait screen pulls back and widens so the foe's head and both gloves still fit", () => {
    const wide = firstPersonCamera(1920 / 1080);
    const tall = firstPersonCamera(390 / 844);
    expect(tall.fov).toBeGreaterThan(wide.fov);
    expect(tall.back).toBeGreaterThan(wide.back);
  });
});
