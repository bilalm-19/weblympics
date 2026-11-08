// The camera lean is deliberate (task 30; user, 2026-11-08: "it seems to
// easily slip left and right"). Playtest 5 measured that SlipDetector leaned
// on ONE raw frame 8 degrees off neutral, and a lean stops the boxer punching
// (`throwPunch` says "slipping"), so a jab's shoulder twist or a pose-model
// glitch leaned and ate the jabs after it. Now: past `slipAt` held for
// `holdMs` (time, not frames), and no lean starts within `jabQuietMs` of a jab
// the camera read. The numbers are guesses until the ?debug recording;
// these tests pin the behaviour on synthetic tilt series.
import { describe, expect, it } from "vitest";
import { DEFAULT_SLIP, SlipDetector } from "../client/input/camera/box-pose.ts";
import { TICK_MS, createState, step, throwPunch } from "../shared/games/boxing/sim.ts";

type Lean = "left" | "right" | null;

/** Feeds a tilt function of time (ms) at `fps` from t0 to t1; `jabs` are times the camera read a jab. Returns each change with its time. */
function run(d: SlipDetector, tilt: (t: number) => number, t0: number, t1: number, fps: number, jabs: number[] = []): Array<[number, Lean]> {
  const out: Array<[number, Lean]> = [];
  const pending = [...jabs];
  for (let i = 0; ; i++) {
    const t = t0 + (i * 1000) / fps;
    if (t > t1) break;
    while (pending.length && pending[0] <= t) {
      d.jab(pending.shift() as number);
    }
    const r = d.update(tilt(t), t);
    if (r !== undefined) out.push([t, r]);
  }
  return out;
}

/** A detector whose neutral (0) is learned over the first second at `fps`. */
function settled(fps: number): SlipDetector {
  const d = new SlipDetector();
  run(d, () => 0, 0, 1100, fps);
  expect(d.neutral).toBe(0);
  return d;
}

const sides = (xs: Array<[number, Lean]>) => xs.map(([, s]) => s);

describe("the camera lean is deliberate", () => {
  it("the numbers: 12 degrees held 200 ms, upright within 6, quiet for 250 ms after a jab (guesses until the recording)", () => {
    expect(DEFAULT_SLIP).toMatchObject({ slipAt: 12, rearmAt: 6, holdMs: 200, jabQuietMs: 250 });
  });

  it("one frame far off neutral (a pose-model glitch) is not a lean", () => {
    const d = settled(24);
    expect(sides(run(d, (t) => (t >= 2000 && t < 2042 ? 25 : 0), 1100, 3000, 24))).toEqual([]);
  });

  it("a jab's brief twist (20 degrees for 150 ms) never leans, whether or not the jab was read", () => {
    for (const fps of [15, 24, 30]) {
      const twist = (t: number) => (t >= 2000 && t < 2150 ? 20 : 0);
      expect(sides(run(settled(fps), twist, 1100, 3000, fps))).toEqual([]);
      expect(sides(run(settled(fps), twist, 1100, 3000, fps, [2000]))).toEqual([]);
    }
  });

  it("a read jab's twist held a little longer (18 degrees for 300 ms from the jab) still doesn't lean: the hold counts only after the quiet time", () => {
    const d = settled(24);
    expect(sides(run(d, (t) => (t >= 2000 && t < 2300 ? 18 : 0), 1100, 3000, 24, [2000]))).toEqual([]);
  });

  it("a stream of jabs with the shoulders twisting each time never leans", () => {
    const jabs = Array.from({ length: 10 }, (_, i) => 2000 + i * 200);
    const twist = (t: number) => (jabs.some((j) => t >= j && t < j + 150) ? (Math.floor((t - 2000) / 200) % 2 ? -16 : 16) : 0);
    expect(sides(run(settled(24), twist, 1100, 4500, 24, jabs))).toEqual([]);
  });

  it("a held lean leans, about 200 ms after the tilt passes 12 degrees, and ends back upright", () => {
    const d = settled(24);
    const out = run(d, (t) => (t >= 2000 && t < 3500 ? -15 : 0), 1100, 4000, 24);
    expect(sides(out)).toEqual(["left", null]);
    const [leanAt] = out[0];
    expect(leanAt - 2000).toBeGreaterThanOrEqual(DEFAULT_SLIP.holdMs);
    expect(leanAt - 2000).toBeLessThan(DEFAULT_SLIP.holdMs + 1000 / 24 + 1);
    expect(out[1][0]).toBeGreaterThanOrEqual(3500);
    expect(out[1][0]).toBeLessThan(3500 + 1000 / 24 + 1);
  });

  it("a lean held in the middle of jabbing goes, once the jabs stop for the quiet time and the hold", () => {
    const d = settled(24);
    // leaning from 2 s, a jab read at 2.05 s: the lean comes 250 + 200 ms on
    const out = run(d, (t) => (t >= 2000 ? 15 : 0), 1100, 3500, 24, [2050]);
    expect(sides(out)).toEqual(["right"]);
    expect(out[0][0]).toBeGreaterThanOrEqual(2050 + DEFAULT_SLIP.jabQuietMs + DEFAULT_SLIP.holdMs - 1000 / 24);
  });

  it("15 fps and 30 fps give the same leans, within a frame", () => {
    const series = (t: number) => {
      if (t >= 2000 && t < 2100) return 20; // a twist
      if (t >= 2500 && t < 3500) return 14; // a lean right
      if (t >= 4000 && t < 4180) return -14; // a short dip, under the hold
      if (t >= 4500 && t < 5500) return -16; // a lean left
      return 1;
    };
    const a = run(settled(15), series, 1100, 6000, 15);
    const b = run(settled(30), series, 1100, 6000, 30);
    expect(sides(a)).toEqual(["right", null, "left", null]);
    expect(sides(b)).toEqual(sides(a));
    a.forEach(([t], i) => expect(Math.abs(t - b[i][0])).toBeLessThanOrEqual(1000 / 15 + 1));
  });

  it("lost frames (null) don't break a hold: a lean through a dropped frame still goes", () => {
    const d = settled(24);
    const out: Lean[] = [];
    for (let i = 0; i < 24; i++) {
      const t = 2000 + (i * 1000) / 24;
      const r = d.update(i === 3 ? null : 15, t);
      if (r !== undefined) out.push(r);
    }
    expect(out).toEqual(["right"]);
  });

  it("neutral is still the median of the first second: settling at +6 then sitting at 0 reads as -6, but that alone is no lean now", () => {
    const d = new SlipDetector();
    run(d, () => 6, 0, 1100, 24);
    expect(d.neutral).toBe(6);
    expect(d.offset(0)).toBe(-6);
    expect(sides(run(d, () => -2, 2000, 4000, 24))).toEqual([]);
  });

  it("a lean refuses every punch in the sim ('slipping'), which is why an accidental lean must not happen", () => {
    const s = createState(1);
    step(s, [{ t: "slip", seat: 0, side: "right" }]);
    expect(throwPunch(s, { t: "punch", seat: 0, hand: "left", target: "head", at: s.tick * TICK_MS })).toBe("slipping");
    expect(s.boxers[0].thrown).toBe(0);
  });

  it("the camera panel tells the lean detector about each jab it reads", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../client/games/boxing/box-camera.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(tr\?\.punch\) slipper\.jab\(f\.t\)/);
  });
});
