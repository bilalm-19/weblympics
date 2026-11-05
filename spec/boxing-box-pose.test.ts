// Boxing's camera (task 30): jab, hook and guard read from pose landmarks on
// synthetic frames, in shoulder widths.
import { describe, expect, it } from "vitest";
import { BoxTracker, DEFAULT_BOX, NOSE, boxFrame, cameraBoxing } from "../client/input/camera/box-pose.ts";
import type { BoxPunchEvent } from "../client/input/camera/box-pose.ts";
import { LM } from "../client/input/camera/pose.ts";
import { PracticeSim } from "../client/games/boxing/practice-sim.ts";
import { HEALTH } from "../shared/games/boxing/sim.ts";
import type { Point } from "../client/input/camera/pose.ts";

const ASPECT = 16 / 9;
const FPS = 30;

/** A wrist in shoulder widths: across (toward the player's left), down (below the shoulders), forward (toward the camera). */
interface W {
  across: number;
  down: number;
  forward: number;
}

// a boxer's stance: fists low in front of the chest
const LEFT_REST: W = { across: 0.4, down: 0.9, forward: 0.2 };
const RIGHT_REST: W = { across: -0.4, down: 0.9, forward: 0.2 };
// fists up by the chin
const LEFT_GUARD: W = { across: 0.2, down: -0.4, forward: 0.3 };
const RIGHT_GUARD: W = { across: -0.2, down: -0.4, forward: 0.3 };

/**
 * A boxer facing the camera, shoulders level at y 0.4 and `w` image heights
 * apart (smaller is farther away). Depth like the pose model's: z in x's
 * normalised scale, smaller nearer, shoulders at 0.
 */
function body(left: W, right: W, w = 0.2, nose = true): Point[] {
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const at = (across: number, down: number, forward = 0): Point => ({ x: (0.5 * ASPECT + across * w) / ASPECT, y: 0.4 + down * w, z: (-forward * w) / ASPECT, visibility: 1 });
  lm[LM.leftShoulder] = at(0.5, 0);
  lm[LM.rightShoulder] = at(-0.5, 0);
  lm[LM.leftWrist] = at(left.across, left.down, left.forward);
  lm[LM.rightWrist] = at(right.across, right.down, right.forward);
  lm[NOSE] = nose ? at(0, -0.6) : { ...at(0, -0.6), visibility: 0 };
  return lm;
}

const lerp = (a: W, b: W, k: number): W => ({ across: a.across + (b.across - a.across) * k, down: a.down + (b.down - a.down) * k, forward: a.forward + (b.forward - a.forward) * k });

/**
 * Plays a motion: for each segment, the moving hand goes from `from` to `to`
 * over `ms`, the other hand stays where it is. Returns every punch read.
 */
function play(tr: BoxTracker, segments: Array<{ hand: "left" | "right"; from: W; to: W; ms: number }>, w = 0.2, startT = 0): { punches: BoxPunchEvent[]; t: number; guards: boolean[] } {
  const punches: BoxPunchEvent[] = [];
  const guards: boolean[] = [];
  let t = startT;
  let left = LEFT_REST;
  let right = RIGHT_REST;
  for (const seg of segments) {
    const frames = Math.max(1, Math.round((seg.ms / 1000) * FPS));
    for (let i = 1; i <= frames; i++) {
      t += 1000 / FPS;
      const p = lerp(seg.from, seg.to, i / frames);
      if (seg.hand === "left") left = p;
      else right = p;
      const r = tr.update(boxFrame(body(left, right, w), ASPECT), t);
      if (r.punch) punches.push(r.punch);
      guards.push(r.guard);
    }
  }
  return { punches, t, guards };
}

const hold = (hand: "left" | "right", at: W, ms: number) => ({ hand, from: at, to: at, ms });

// a jab: the fist shoots straight at the camera, a long way in front of the shoulder
const JAB_OUT = (rest: W): W => ({ across: rest.across * 0.5, down: 0.1, forward: 1.4 });
// a right hook: the fist sweeps from outside the right shoulder across to the left, at shoulder height
const HOOK_FROM: W = { across: -1.1, down: 0.1, forward: 0.4 };
const HOOK_TO: W = { across: 0.4, down: 0.0, forward: 0.5 };

describe("boxing camera: punches", () => {
  it("standing still with the fists low is nothing", () => {
    const tr = new BoxTracker();
    const r = play(tr, [hold("right", RIGHT_REST, 2000)]);
    expect(r.punches).toEqual([]);
    expect(r.guards.every((g) => !g)).toBe(true);
  });

  it("a fast straight punch toward the camera is a jab, on that hand, once", () => {
    const tr = new BoxTracker();
    const r = play(tr, [
      hold("left", LEFT_REST, 300),
      { hand: "left", from: LEFT_REST, to: JAB_OUT(LEFT_REST), ms: 150 },
      hold("left", JAB_OUT(LEFT_REST), 100),
      { hand: "left", from: JAB_OUT(LEFT_REST), to: LEFT_REST, ms: 250 },
    ]);
    expect(r.punches.map((p) => [p.kind, p.hand])).toEqual([["jab", "left"]]);
  });

  it("a fast sweep across the body at shoulder height is a hook", () => {
    const tr = new BoxTracker();
    const r = play(tr, [
      { hand: "right", from: RIGHT_REST, to: HOOK_FROM, ms: 400 },
      hold("right", HOOK_FROM, 200),
      { hand: "right", from: HOOK_FROM, to: HOOK_TO, ms: 200 },
      hold("right", HOOK_TO, 300),
    ]);
    expect(r.punches.map((p) => [p.kind, p.hand])).toEqual([["hook", "right"]]);
  });

  it("the same sweep down at the waist isn't a hook", () => {
    const low = (w: W): W => ({ ...w, down: 1.5 });
    const tr = new BoxTracker();
    const r = play(tr, [hold("right", low(HOOK_FROM), 300), { hand: "right", from: low(HOOK_FROM), to: low(HOOK_TO), ms: 200 }]);
    expect(r.punches).toEqual([]);
  });

  it("slow movements (reaching, not punching) are nothing", () => {
    const tr = new BoxTracker();
    const r = play(tr, [
      { hand: "left", from: LEFT_REST, to: JAB_OUT(LEFT_REST), ms: 1500 },
      { hand: "right", from: RIGHT_REST, to: HOOK_FROM, ms: 1000 },
      { hand: "right", from: HOOK_FROM, to: HOOK_TO, ms: 1500 },
    ]);
    expect(r.punches).toEqual([]);
  });

  it("a hand must come back and slow down before it punches again; alternating hands works", () => {
    const tr = new BoxTracker();
    const out = (h: "left" | "right") => (h === "left" ? JAB_OUT(LEFT_REST) : JAB_OUT(RIGHT_REST));
    const rest = (h: "left" | "right") => (h === "left" ? LEFT_REST : RIGHT_REST);
    const jab = (h: "left" | "right") => [
      { hand: h, from: rest(h), to: out(h), ms: 130 },
      { hand: h, from: out(h), to: rest(h), ms: 200 },
      hold(h, rest(h), 150),
    ];
    const r = play(tr, [...jab("left"), ...jab("right"), ...jab("left"), ...jab("right")]);
    expect(r.punches.map((p) => `${p.kind}:${p.hand}`)).toEqual(["jab:left", "jab:right", "jab:left", "jab:right"]);
  });

  it("measures in shoulder widths: standing farther back reads the same", () => {
    const seq = [hold("left", LEFT_REST, 200), { hand: "left" as const, from: LEFT_REST, to: JAB_OUT(LEFT_REST), ms: 150 }];
    const near = play(new BoxTracker(), seq, 0.2).punches;
    const far = play(new BoxTracker(), seq, 0.1).punches;
    expect(far.map((p) => p.kind)).toEqual(near.map((p) => p.kind));
    expect(near).toHaveLength(1);
  });
});

describe("boxing camera: the guard", () => {
  it("both fists by the face raise the guard; one alone doesn't", () => {
    const one = play(new BoxTracker(), [{ hand: "left", from: LEFT_REST, to: LEFT_GUARD, ms: 300 }, hold("left", LEFT_GUARD, 300)]);
    expect(one.guards.at(-1)).toBe(false);
    const tr = new BoxTracker();
    const both = play(tr, [
      { hand: "left", from: LEFT_REST, to: LEFT_GUARD, ms: 300 },
      { hand: "right", from: RIGHT_REST, to: RIGHT_GUARD, ms: 300 },
      hold("right", RIGHT_GUARD, 300),
    ]);
    expect(both.guards.at(-1)).toBe(true);
    // raising the fists to the face isn't a punch
    expect(both.punches).toEqual([]);
  });

  it("works without the nose seen (a point above the shoulders stands in)", () => {
    const tr = new BoxTracker();
    const r = tr.update(boxFrame(body(LEFT_GUARD, RIGHT_GUARD, 0.2, false), ASPECT), 0);
    expect(r.guard).toBe(true);
  });

  it("has hysteresis: a small drift doesn't drop it, lowering a fist does", () => {
    const tr = new BoxTracker();
    tr.update(boxFrame(body(LEFT_GUARD, RIGHT_GUARD), ASPECT), 0);
    // between guardOn and guardOff from the face
    const drift: W = { ...LEFT_GUARD, across: LEFT_GUARD.across + (DEFAULT_BOX.guardOn + DEFAULT_BOX.guardOff) / 2 - 0.2 };
    expect(tr.update(boxFrame(body(drift, RIGHT_GUARD), ASPECT), 33).guard).toBe(true);
    // starting from that drifted pose, the guard wouldn't go up
    expect(new BoxTracker().update(boxFrame(body(drift, RIGHT_GUARD), ASPECT), 0).guard).toBe(false);
    expect(tr.update(boxFrame(body(LEFT_REST, RIGHT_GUARD), ASPECT), 66).guard).toBe(false);
  });

  it("frames it can't read keep the guard and lose nothing else; no shoulders is no frame", () => {
    const tr = new BoxTracker();
    tr.update(boxFrame(body(LEFT_GUARD, RIGHT_GUARD), ASPECT), 0);
    const lost = body(LEFT_GUARD, RIGHT_GUARD);
    lost[LM.leftShoulder].visibility = 0;
    expect(boxFrame(lost, ASPECT)).toBeNull();
    expect(tr.update(null, 33)).toEqual({ guard: true, punch: null, tracking: false });
  });
});

// The camera panel (client/games/boxing/box-camera.ts) turns a detector's
// read into the same punch and guard messages a key sends (`cameraBoxing`,
// ADR 002). So a camera jab must land on the sparring partner through the
// practice sim, and a raised guard must reach the sim as a guard.
describe("the camera's reads reach the sim like keys do", () => {
  it("a jab read from the body becomes a head jab in the practice sim and costs the partner health", () => {
    const tr = new BoxTracker();
    const { punches } = play(tr, [hold("left", LEFT_REST, 400), { hand: "left", from: LEFT_REST, to: { across: 0.4, down: 0.6, forward: 1.2 }, ms: 120 }]);
    expect(punches).toHaveLength(1);
    const msg = cameraBoxing({ guard: false, punch: punches[0], tracking: true });
    expect(msg.jab).toEqual({ hand: "left", target: "head" });
    const sim = new PracticeSim(5);
    sim.punch(msg.jab!.hand, msg.jab!.target, 0);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.state.boxers[0].thrown).toBe(1);
    expect(sim.state.boxers[1].health).toBeLessThan(HEALTH);
  });

  it("both hands up by the face is a guard read, sent as the high guard, and the sim raises it", () => {
    const tr = new BoxTracker();
    const { guards } = play(tr, [{ hand: "left", from: LEFT_REST, to: LEFT_GUARD, ms: 300 }, { hand: "right", from: RIGHT_REST, to: RIGHT_GUARD, ms: 300 }]);
    expect(guards.at(-1)).toBe(true);
    const msg = cameraBoxing({ guard: guards.at(-1)!, punch: null, tracking: true });
    expect(msg).toEqual({ guard: "high", jab: null });
    const sim = new PracticeSim(6);
    sim.guard(msg.guard);
    sim.tick();
    expect(sim.state.boxers[0].guard).toBe("high");
  });

  it("the old tracker's hook is dropped: jabs only", () => {
    expect(cameraBoxing({ guard: false, punch: { kind: "hook", hand: "right", t: 0 }, tracking: true })).toEqual({ guard: null, jab: null });
  });

  it("the trial detector's guard height and jab target go straight through; its hooks are dropped", () => {
    const grow = { left: null, right: null };
    expect(cameraBoxing({ guard: "low", punch: { kind: "jab", hand: "right", target: "body", t: 0 }, grow })).toEqual({ guard: "low", jab: { hand: "right", target: "body" } });
    expect(cameraBoxing({ guard: "high", punch: null, grow })).toEqual({ guard: "high", jab: null });
    expect(cameraBoxing({ guard: null, punch: { kind: "hook", hand: "left", target: "head", t: 0 }, grow })).toEqual({ guard: null, jab: null });
  });
});
