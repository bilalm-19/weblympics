// Task 25 round 3: basketball's quick calibration, "push soft, then push
// hard", maps the player's own range onto the power bar (`power0`/`power1`).
// The maths is generic (bowling's roll will use it too) and pure.
import { describe, expect, it } from "vitest";
import { DEFAULT_POWER_RULES, powerRangeFrom } from "../client/input/camera/power-calibration.ts";
import { DEFAULT_SHOOT, powerFromPeak } from "../client/input/camera/shoot-pose.ts";
import { parseCameraSettings } from "../shared/camera-settings.ts";

const DEFAULTS = { lo: DEFAULT_SHOOT.power0, hi: DEFAULT_SHOOT.power1 };
const cfgOf = (r: { lo: number; hi: number }) => ({ ...DEFAULT_SHOOT, power0: r.lo, power1: r.hi });

describe("quick power calibration (task 25)", () => {
  it("a small, slow pusher's soft push reads soft and their hard push reads hard, not weak", () => {
    // pushes far below the guessed defaults (soft 3.6, hard 7)
    const r = powerRangeFrom([3.4, 3.8], [6.8, 7.2], DEFAULTS);
    expect(r.fellBack).toBe(false);
    const cfg = cfgOf(r.range);
    expect(powerFromPeak(3.6, cfg)).toBeCloseTo(DEFAULT_POWER_RULES.softAt, 2);
    expect(powerFromPeak(7, cfg)).toBeCloseTo(DEFAULT_POWER_RULES.hardAt, 2);
    // with the defaults that hard push would have been a weak shot
    expect(powerFromPeak(7, DEFAULT_SHOOT)).toBeLessThan(0.35);
  });

  it("a big, fast pusher's hard push no longer pins the bar at full", () => {
    const r = powerRangeFrom([9, 10, 11], [24, 26], DEFAULTS);
    expect(r.fellBack).toBe(false);
    expect(powerFromPeak(25, cfgOf(r.range))).toBeLessThan(1);
    expect(powerFromPeak(25, DEFAULT_SHOOT)).toBe(1);
  });

  it("uses the median, so one odd push doesn't skew it", () => {
    const a = powerRangeFrom([4, 4.2, 30], [10, 10.4, 10.2], DEFAULTS);
    const b = powerRangeFrom([4, 4.2], [10, 10.4, 10.2], DEFAULTS);
    expect(a.range.lo).toBeCloseTo(powerRangeFrom([4.2], [10.2], DEFAULTS).range.lo, 5);
    expect(b.fellBack).toBe(false);
  });

  it("falls back to the defaults, and says so, when soft and hard are too close or missing", () => {
    for (const [soft, hard] of [
      [[6], [7]],
      [[6, 6.5], [6.2, 6.4]],
      [[8], [5]],
      [[], [10]],
      [[5], []],
      [[NaN], [10]],
      [[0], [10]],
    ] as [number[], number[]][]) {
      const r = powerRangeFrom(soft, hard, DEFAULTS);
      expect(r, JSON.stringify([soft, hard])).toEqual({ range: DEFAULTS, fellBack: true });
    }
  });

  it("whatever it makes, the server accepts it as a setting (in range, in order)", () => {
    for (const [soft, hard] of [
      [[1], [2]],
      [[3.5], [7]],
      [[10], [38]],
      [[0.6], [39]],
    ] as [number[], number[]][]) {
      const r = powerRangeFrom(soft, hard, DEFAULTS);
      expect(r.range.hi).toBeGreaterThan(r.range.lo);
      expect(parseCameraSettings({ basketball: { power: [r.range.lo, r.range.hi] } }), JSON.stringify(r)).not.toBeNull();
    }
  });
});
