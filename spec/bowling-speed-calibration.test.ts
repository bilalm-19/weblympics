// Task 25 round 3: bowling's quick calibration, "roll soft, then roll hard",
// maps the player's own swing onto the speed bar (`speed0`/`speed1` in
// bowl-pose.ts), with the same generic maths as basketball's push.
import { describe, expect, it } from "vitest";
import { DEFAULT_BOWL, speedFrom } from "../client/input/camera/bowl-pose.ts";
import { DEFAULT_POWER_RULES, powerRangeFrom } from "../client/input/camera/power-calibration.ts";
import { parseCameraSettings } from "../shared/camera-settings.ts";

const DEFAULTS = { lo: DEFAULT_BOWL.speed0, hi: DEFAULT_BOWL.speed1 };
const cfgOf = (r: { lo: number; hi: number }) => ({ ...DEFAULT_BOWL, speed0: r.lo, speed1: r.hi });

describe("quick speed calibration (task 25)", () => {
  it("a short-armed or slow bowler's hard roll reads hard, not medium", () => {
    // crossing speeds well under the guessed medium (6.5) and fast (11)
    const r = powerRangeFrom([3.6, 4], [7.5, 8], DEFAULTS);
    expect(r.fellBack).toBe(false);
    expect(speedFrom(7.75, cfgOf(r.range))).toBeCloseTo(DEFAULT_POWER_RULES.hardAt, 2);
    expect(speedFrom(3.8, cfgOf(r.range))).toBeCloseTo(DEFAULT_POWER_RULES.softAt, 2);
    expect(speedFrom(7.75, DEFAULT_BOWL)).toBeLessThan(0.6);
  });

  it("keeps the defaults, and says so, when soft and hard rolls are too close", () => {
    expect(powerRangeFrom([6], [7], DEFAULTS)).toEqual({ range: DEFAULTS, fellBack: true });
    expect(powerRangeFrom([], [9], DEFAULTS).fellBack).toBe(true);
  });

  it("what it makes is a setting the server accepts; the bowling section is closed", () => {
    const r = powerRangeFrom([4], [11], DEFAULTS);
    expect(parseCameraSettings({ bowling: { speed: [r.range.lo, r.range.hi] } })?.bowling.speed).toEqual([r.range.lo, r.range.hi]);
    expect(parseCameraSettings({ bowling: { speed: null } })?.bowling.speed).toBeNull();
    expect(parseCameraSettings({ bowling: { speed: [DEFAULT_BOWL.speed0, DEFAULT_BOWL.speed1] } })).not.toBeNull();
    expect(parseCameraSettings({ bowling: { speed: [9, 3] } })).toBeNull();
    expect(parseCameraSettings({ bowling: {} })).toBeNull();
  });
});
