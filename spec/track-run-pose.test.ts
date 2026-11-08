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

// Playtest 2026-11-05: arm pumps needed too much movement to run fast, and
// arms falling into step lost every other pump to the same-foot rule.
describe("elbows mode is easy on the arms", () => {
  it("a small quick pump (a quarter shoulder width) counts", () => {
    const tr = calibrated("elbows");
    expect(jog(tr, "elbows", 0.25, 5, 2).length).toBeGreaterThanOrEqual(9);
  });

  it("pumps on one arm only still come out as alternating steps", () => {
    const tr = calibrated("elbows");
    const steps: RunStep[] = [];
    for (let f = 0; f < 60; f++) {
      const t = (f / 30) * 1000;
      const lift = Math.max(0, Math.sin((t / 1000) * 4 * Math.PI)) * 0.5;
      const s = tr.update(runHeights(body(lift, 0), ASPECT, "elbows"), t);
      if (s) steps.push(s);
    }
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < steps.length; i++) expect(steps[i].side).not.toBe(steps[i - 1].side);
  });

  it("knees mode still reports the knee that rose", () => {
    const tr = calibrated("knees");
    expect(tr.update(runHeights(body(0.8, 0), ASPECT, "knees"), 0)).toEqual({ side: "left", t: 0 });
  });
});

// Playtest 2026-11-08: "pumps don't register". A step was 0.2 above the
// stand-still rest, re-armed below 0.08 above it; with the hands held higher
// than at calibration (or a rest saved on another day) a side never re-armed.
// Now each side is measured from its own recent low.
describe("adaptive steps: measured from each side's own recent low", () => {
  /** Frames of `heights(t)` (each side's lift, shoulder widths) for `seconds` at 30 fps; the steps read. */
  function feed(tr: RunTracker, mode: RunMode, seconds: number, heights: (t: number) => [number, number], from = 0): RunStep[] {
    const out: RunStep[] = [];
    for (let f = 0; f < seconds * 30; f++) {
      const t = from + (f / 30) * 1000;
      const [l, r] = heights(t);
      const s = tr.update(runHeights(body(l, r), ASPECT, mode), t);
      if (s) out.push(s);
    }
    return out;
  }
  /** Alternate pumps of `lift` on top of `base`, at `cadence` a second. */
  const pumps =
    (base: number, lift: number, cadence: number) =>
    (t: number): [number, number] => {
      const phase = (t / 1000) * cadence;
      const k = Math.floor(phase);
      const b = Math.sin((phase - k) * Math.PI) * lift;
      return k % 2 === 0 ? [base + b, base] : [base, base + b];
    };

  it.each(["elbows", "knees"] as const)("%s: a small quick pump counts with the hands (or knees) held high", (mode) => {
    // calibrated low, then held 0.5 higher, pumping a little past liftOn, 4 a second
    const tr = calibrated(mode);
    const lift = DEFAULT_RUN[mode].liftOn + 0.08;
    const steps = feed(tr, mode, 3, pumps(0.5, lift, 4));
    // main's tracker read one step here and then never re-armed
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps.length).toBeLessThanOrEqual(13);
  });

  it("a pump counts after the rest was saved at a different height (lower or higher)", () => {
    for (const offset of [-0.6, 0.6]) {
      const tr = new RunTracker("elbows");
      const r = runHeights(body(), ASPECT, "elbows")!;
      // a rest from another day: the hands now hang `offset` away from it
      tr.rest = { left: r.left + offset, right: r.right + offset };
      const steps = feed(tr, "elbows", 3, pumps(0, 0.25, 4));
      expect(steps.length, `rest ${offset}`).toBeGreaterThanOrEqual(10);
      expect(steps.length, `rest ${offset}`).toBeLessThanOrEqual(13);
    }
  });

  it("with no calibration at all it starts from the first frame", () => {
    const tr = new RunTracker("elbows");
    expect(feed(tr, "elbows", 3, pumps(0.3, 0.25, 4)).length).toBeGreaterThanOrEqual(10);
  });

  it("a fast steady pump gives steady steps, alternating", () => {
    const tr = calibrated("elbows");
    const steps = feed(tr, "elbows", 4, pumps(0.2, 0.25, 6));
    expect(steps.length).toBeGreaterThanOrEqual(22);
    expect(steps.length).toBeLessThanOrEqual(25);
    const gaps = steps.slice(1).map((s, i) => s.t - steps[i].t);
    // one step every 1/6 s, give or take a frame or two
    for (const g of gaps.slice(1)) expect(Math.abs(g - 1000 / 6)).toBeLessThanOrEqual(70);
    for (let i = 1; i < steps.length; i++) expect(steps[i].side).not.toBe(steps[i - 1].side);
  });

  it("jitter in the landmarks doesn't step, wherever the hands are held", () => {
    for (const base of [0, 0.5, 1]) {
      const tr = calibrated("elbows");
      // a seeded wobble of up to ±0.04 shoulder widths on each hand, every frame
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.08;
      // moving the hands to a new height may read one step; holding them there reads none
      feed(tr, "elbows", 1, () => [base, base]);
      expect(feed(tr, "elbows", 4, () => [base + rand(), base + rand()], 1000), `held at ${base}`).toEqual([]);
    }
  });

  it("hands drifting slowly up don't step", () => {
    const tr = calibrated("elbows");
    // up 0.6 over 6 s: a tenth a second, slower than the low's creep
    expect(feed(tr, "elbows", 6, (t) => [(t / 1000) * 0.1, (t / 1000) * 0.1])).toEqual([]);
  });

  it("raising the hands and holding them there is one step at most, then pumps count from up there", () => {
    const tr = calibrated("elbows");
    expect(feed(tr, "elbows", 1, () => [0.6, 0.6]).length).toBeLessThanOrEqual(1);
    expect(feed(tr, "elbows", 3, pumps(0.6, 0.22, 4), 1000).length).toBeGreaterThanOrEqual(10);
  });
});
