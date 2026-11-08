// Hurdles' camera jump (task 27; control chosen by the user, 2026-11-08), on
// synthetic landmarks: elbows mode reads both arms up together, knees mode
// reads jumping on the spot. A jump reads once; a running pump, a jogging
// step or one arm up never reads as one. The numbers are first guesses
// until the recordings (docs/camera-playtest.md, "Hurdles' moves").
import { describe, expect, it } from "vitest";
import { LM } from "../client/input/camera/pose.ts";
import type { Point } from "../client/input/camera/pose.ts";
import { DEFAULT_JUMP, JumpTracker, LEGS, RunTracker, restFrom, runHeights, torsoOf, torsoRestFrom } from "../client/input/camera/run-pose.ts";
import type { RunMode, Torso } from "../client/input/camera/run-pose.ts";

const ASPECT = 16 / 9;
const FPS = 30;

/**
 * A player facing the camera, `w` image heights between the shoulders, the
 * whole body raised `rise` shoulder widths (a jump), each wrist lifted
 * `left`/`right` and each knee lifted `kl`/`kr` shoulder widths above rest.
 */
function body(o: { left?: number; right?: number; kl?: number; kr?: number; rise?: number; w?: number } = {}): Point[] {
  const { left = 0, right = 0, kl = 0, kr = 0, rise = 0, w = 0.2 } = o;
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const top = 0.3 - rise * w;
  const at = (across: number, down: number): Point => ({ x: (0.5 * ASPECT + across * w) / ASPECT, y: top + down * w, visibility: 1 });
  lm[LM.leftShoulder] = at(0.5, 0);
  lm[LM.rightShoulder] = at(-0.5, 0);
  lm[LM.leftWrist] = at(0.6, 1.4 - left);
  lm[LM.rightWrist] = at(-0.6, 1.4 - right);
  lm[LEGS.leftHip] = at(0.3, 2);
  lm[LEGS.rightHip] = at(-0.3, 2);
  lm[LEGS.leftKnee] = at(0.3, 3 - kl);
  lm[LEGS.rightKnee] = at(-0.3, 3 - kr);
  return lm;
}

function tracker(mode: RunMode, w = 0.2): JumpTracker {
  const j = new JumpTracker(mode);
  const arms = [];
  const torsos: Torso[] = [];
  for (let i = 0; i < 10; i++) {
    arms.push(runHeights(body({ w }), ASPECT, "elbows")!);
    torsos.push(torsoOf(body({ w }), ASPECT)!);
  }
  j.rest = { arms: restFrom(arms), torso: torsoRestFrom(torsos) };
  return j;
}

/** Feeds `seconds` of frames, `pose(t)` giving the body at t ms; returns the times jumps read. */
function play(j: JumpTracker, seconds: number, pose: (t: number) => Parameters<typeof body>[0]): number[] {
  const out: number[] = [];
  for (let f = 0; f < seconds * FPS; f++) {
    const t = (f / FPS) * 1000;
    const lm = body(pose(t));
    if (j.update({ arms: runHeights(lm, ASPECT, "elbows"), torso: torsoOf(lm, ASPECT) }, t)) out.push(t);
  }
  return out;
}

/** A half-sine bump of `height` lasting `ms` starting at `start`, else 0. */
const bump = (t: number, start: number, ms: number, height: number) => (t >= start && t <= start + ms ? Math.sin(((t - start) / ms) * Math.PI) * height : 0);

/** Jogging: alternate sides lift by `lift` at `cadence` steps a second, the body bobbing `bob`. */
const jogging = (lift: number, cadence: number, bob = 0.05) => (t: number) => {
  const phase = (t / 1000) * cadence;
  const k = Math.floor(phase);
  const b = Math.sin((phase - k) * Math.PI);
  const [l, r] = k % 2 === 0 ? [b * lift, 0] : [0, b * lift];
  return { left: l, right: r, kl: l, kr: r, rise: b * bob };
};

describe("elbows mode: both arms up together is a jump", () => {
  it("both arms thrown up reads once, then again only after they come down", () => {
    const j = tracker("elbows");
    // up at 0.2 s for 0.5 s, and again at 1.5 s
    const jumps = play(j, 2.5, (t) => {
      const a = bump(t, 200, 500, 1.6) + bump(t, 1500, 500, 1.6);
      return { left: a, right: a };
    });
    expect(jumps).toHaveLength(2);
    expect(jumps[0]).toBeGreaterThan(200);
    expect(jumps[0]).toBeLessThan(500);
    expect(jumps[1]).toBeGreaterThan(1500);
  });

  it("arms held up are one jump, not one a frame", () => {
    const j = tracker("elbows");
    expect(play(j, 2, () => ({ left: 1.6, right: 1.6 }))).toHaveLength(1);
  });

  it("one arm up, however high, is not a jump", () => {
    for (const side of ["left", "right"] as const) {
      const j = tracker("elbows");
      expect(play(j, 2, (t) => ({ [side]: bump(t, 200, 800, 2) }))).toEqual([]);
    }
  });

  it("running arm pumps, even big quick ones, never read as a jump; they still read as steps", () => {
    const j = tracker("elbows");
    expect(play(j, 4, jogging(0.8, 6))).toEqual([]);
    // the same frames do run
    const run = new RunTracker("elbows");
    run.rest = { left: runHeights(body(), ASPECT, "elbows")!.left, right: runHeights(body(), ASPECT, "elbows")!.right };
    let steps = 0;
    for (let f = 0; f < 4 * FPS; f++) {
      const t = (f / FPS) * 1000;
      if (run.update(runHeights(body(jogging(0.8, 6)(t)), ASPECT, "elbows"), t)) steps++;
    }
    expect(steps).toBeGreaterThan(15);
  });

  it("measures in shoulder widths: standing farther back reads the same", () => {
    const pose = (t: number) => {
      const a = bump(t, 200, 500, 1.6);
      return { left: a, right: a, w: 0.1 };
    };
    expect(play(tracker("elbows", 0.1), 1, pose)).toHaveLength(1);
  });

  it("nothing reads before calibration, or with a hand out of view", () => {
    const j = new JumpTracker("elbows");
    expect(play(j, 1, () => ({ left: 2, right: 2 }))).toEqual([]);
    const lost = body({ left: 2, right: 2 });
    lost[LM.leftWrist].visibility = 0.1;
    const k = tracker("elbows");
    expect(k.update({ arms: runHeights(lost, ASPECT, "elbows"), torso: torsoOf(lost, ASPECT) }, 0)).toBe(false);
  });
});

describe("knees mode: jumping on the spot is a jump", () => {
  it("a hop reads once at take-off", () => {
    const j = tracker("knees");
    // a 0.4 s hop, half a shoulder width up, at 0.3 s
    const jumps = play(j, 1.5, (t) => ({ rise: bump(t, 300, 400, 0.5) }));
    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toBeLessThan(500);
  });

  it("two hops a second apart read twice", () => {
    const j = tracker("knees");
    expect(play(j, 2.5, (t) => ({ rise: bump(t, 300, 400, 0.5) + bump(t, 1400, 400, 0.5) }))).toHaveLength(2);
  });

  it("jogging on the spot, knees high, never reads as a jump", () => {
    const j = tracker("knees");
    expect(play(j, 4, jogging(0.8, 6, 0.08))).toEqual([]);
  });

  it("rising slowly (standing up tall, on tiptoe) isn't a jump", () => {
    const j = tracker("knees");
    // 0.3 shoulder widths over two seconds
    expect(play(j, 3, (t) => ({ rise: Math.min(0.3, (t / 2000) * 0.3) }))).toEqual([]);
  });

  it("one knee up high (a step) isn't a jump", () => {
    const j = tracker("knees");
    expect(play(j, 1.5, (t) => ({ kl: bump(t, 200, 500, 1.5) }))).toEqual([]);
  });

  it("needs the hips in view, and a calibration", () => {
    const noHips = body();
    noHips[LEGS.leftHip].visibility = 0;
    expect(torsoOf(noHips, ASPECT)).toBeNull();
    const j = new JumpTracker("knees");
    expect(play(j, 1.5, (t) => ({ rise: bump(t, 300, 400, 0.5) }))).toEqual([]);
    expect(torsoRestFrom([{ y: 0.5, width: 0.2 }])).toBeNull();
  });

  it("a hop is well clear of the thresholds: the numbers are guesses with room on both sides", () => {
    expect(DEFAULT_JUMP.riseOn).toBeLessThan(0.5);
    expect(DEFAULT_JUMP.riseOn).toBeGreaterThan(0.08);
  });
});
