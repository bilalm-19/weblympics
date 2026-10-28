// Track's camera (task 26): running on the spot read from pose landmarks, in
// both modes ("knees" and "elbows"), on synthetic frames.
import { describe, expect, it } from "vitest";
import { DEFAULT_RUN, LEGS, RunTracker, restFrom, runHeights } from "../client/input/camera/run-pose.ts";
import type { RunMode, RunRest, RunStep } from "../client/input/camera/run-pose.ts";
import { LM } from "../client/input/camera/pose.ts";
import type { Point } from "../client/input/camera/pose.ts";

const ASPECT = 16 / 9;

/**
 * A player facing the camera, shoulders level at y 0.3 and `w` image heights
 * apart (smaller is farther away). `left`/`right` lift that side's knee and
 * wrist by that many shoulder widths above where they rest.
 */
function body(left = 0, right = 0, w = 0.2): Point[] {
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const at = (across: number, down: number): Point => ({ x: (0.5 * ASPECT + across * w) / ASPECT, y: 0.3 + down * w, visibility: 1 });
  lm[LM.leftShoulder] = at(0.5, 0);
  lm[LM.rightShoulder] = at(-0.5, 0);
  lm[LM.leftWrist] = at(0.6, 1.4 - left);
  lm[LM.rightWrist] = at(-0.6, 1.4 - right);
  lm[LEGS.leftHip] = at(0.3, 2);
  lm[LEGS.rightHip] = at(-0.3, 2);
  lm[LEGS.leftKnee] = at(0.3, 3 - left);
  lm[LEGS.rightKnee] = at(-0.3, 3 - right);
  return lm;
}

function calibrated(mode: RunMode, w = 0.2): RunTracker {
  const tr = new RunTracker(mode);
  const samples: RunRest[] = [];
  for (let i = 0; i < 10; i++) samples.push(runHeights(body(0, 0, w), ASPECT, mode)!);
  tr.rest = restFrom(samples);
  return tr;
}

/** Jogging: sides lift in turn, `lift` high, at `cadence` steps a second for `seconds`, 30 frames a second. */
function jog(tr: RunTracker, mode: RunMode, lift: number, cadence: number, seconds: number, w = 0.2): RunStep[] {
  const steps: RunStep[] = [];
  const fps = 30;
  for (let f = 0; f < seconds * fps; f++) {
    const t = (f / fps) * 1000;
    // a step every 1/cadence s; left on even steps, each a half-sine bump
    const phase = (t / 1000) * cadence;
    const k = Math.floor(phase);
    const bump = Math.sin((phase - k) * Math.PI) * lift;
    const [l, r] = k % 2 === 0 ? [bump, 0] : [0, bump];
    const s = tr.update(runHeights(body(l, r, w), ASPECT, mode), t);
    if (s) steps.push(s);
  }
  return steps;
}

describe.each(["knees", "elbows"] as const)("running on the spot: %s", (mode) => {
  it("standing still is no steps", () => {
    const tr = calibrated(mode);
    for (let i = 0; i < 90; i++) expect(tr.update(runHeights(body(), ASPECT, mode), i * 33)).toBeNull();
  });

  it("jogging counts one step per lift, alternating sides", () => {
    const tr = calibrated(mode);
    const steps = jog(tr, mode, 0.8, 4, 3);
    expect(steps.length).toBeGreaterThanOrEqual(11);
    expect(steps.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < steps.length; i++) expect(steps[i].side).not.toBe(steps[i - 1].side);
  });

  it("a small fidget below the threshold isn't a step", () => {
    const tr = calibrated(mode);
    expect(jog(tr, mode, DEFAULT_RUN[mode].liftOn * 0.6, 4, 2)).toEqual([]);
  });

  it("measures in shoulder widths: standing farther back counts the same", () => {
    const near = jog(calibrated(mode, 0.2), mode, 0.8, 4, 3, 0.2).length;
    const far = jog(calibrated(mode, 0.1), mode, 0.8, 4, 3, 0.1).length;
    expect(far).toBe(near);
  });

  it("frames it can't read are skipped, and nothing counts before calibration", () => {
    const tr = new RunTracker(mode);
    expect(tr.update(runHeights(body(1, 0), ASPECT, mode), 0)).toBeNull();
    const lost = body(1, 0);
    lost[mode === "knees" ? LEGS.leftKnee : LM.leftWrist].visibility = 0.1;
    expect(runHeights(lost, ASPECT, mode)).toBeNull();
  });
});

describe("the two modes read different joints", () => {
  it("knees mode needs the legs in frame; elbows mode doesn't", () => {
    const noLegs = body();
    for (const i of Object.values(LEGS)) noLegs[i].visibility = 0;
    expect(runHeights(noLegs, ASPECT, "knees")).toBeNull();
    expect(runHeights(noLegs, ASPECT, "elbows")).not.toBeNull();
  });

  it("calibration needs a few frames and ignores a bad one", () => {
    expect(restFrom([{ left: 1, right: 1 }])).toBeNull();
    const rest = restFrom([...Array(6).fill({ left: -3, right: -3 }), { left: 5, right: 5 }]);
    expect(rest).toEqual({ left: -3, right: -3 });
  });
});
