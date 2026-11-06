// Why the camera "leans too easily" (task 30, playtest 5), as measured facts
// about the code, not a tuning: SlipDetector thresholds RAW per-frame shoulder
// tilt, and a lean stops the boxer punching (`throwPunch` says "slipping").
// The recordings in docs/playtest/ hold no tilt, so what a real jab does to
// the shoulder line is UNKNOWN until the ?debug recorder's tilt spread is read
// (docs/camera-playtest.md). Nothing here changes a threshold.
import { describe, expect, it } from "vitest";
import { SlipDetector } from "../client/input/camera/box-pose.ts";
import { TICK_MS, createState, step, throwPunch } from "../shared/games/boxing/sim.ts";

const feed = (d: SlipDetector, tilts: number[], t0: number, fps = 24) => {
  const out: Array<"left" | "right" | null> = [];
  tilts.forEach((tilt, i) => {
    const r = d.update(tilt, t0 + (i * 1000) / fps);
    if (r !== undefined) out.push(r);
  });
  return out;
};
const still = (deg: number, n: number) => Array.from({ length: n }, () => deg);

describe("the camera lean is raw tilt against a threshold", () => {
  it("one frame 8 degrees off neutral (a pose-model glitch or a shoulder shrug) starts a lean, and the next frame ends it", () => {
    const d = new SlipDetector();
    const out = feed(d, [...still(0, 30), 8, ...still(0, 5)], 0);
    expect(out).toEqual(["right", null]);
  });

  it("a lean lasts as long as the tilt stays past 4 degrees: a jab that leaves the shoulders 5 degrees off for a second is still leaning if it crossed 8", () => {
    const d = new SlipDetector();
    const out = feed(d, [...still(0, 30), 8.5, ...still(5, 24)], 0);
    expect(out).toEqual(["right"]);
    expect(d.lean).toBe("right");
  });

  it("neutral is the median of the first second: a player still settling (leaning 6 degrees for the first second, then sitting at 0) is 'leaning' 6 degrees the other way for good", () => {
    const d = new SlipDetector();
    // 24 frames while settling at +6, then upright at 0: the neutral is 6, so upright reads as -6
    feed(d, still(6, 25), 0);
    expect(d.neutral).toBe(6);
    expect(d.offset(0)).toBe(-6);
    // and 2 more degrees of ordinary movement is a lean
    expect(feed(d, still(-2, 5), 2000)).toEqual(["left"]);
  });

  it("a lean refuses every punch in the sim ('slipping'), so one accidental lean eats the jabs thrown during it", () => {
    const s = createState(1);
    step(s, [{ t: "slip", seat: 0, side: "right" }]);
    expect(throwPunch(s, { t: "punch", seat: 0, hand: "left", target: "head", at: s.tick * TICK_MS })).toBe("slipping");
    expect(s.boxers[0].thrown).toBe(0);
  });
});
