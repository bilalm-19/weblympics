// Ways the trial camera detector can swallow a real punch (task 30, playtest 5:
// "the punches are registering inconsistently"). Frames are shaped like the
// recording docs/playtest/boxing-2026-11-05-hand-model.txt: hand-model palm
// sizes per hand, at 24 fps. Each test is one mechanism, measured.
import { describe, expect, it } from "vitest";
import { TrialDetector } from "../client/input/camera/box-pose.ts";
import type { TrialFrame } from "../client/input/camera/box-pose.ts";

const FPS = 24;
const frame = (size: number | null): TrialFrame => ({
  hands: { left: null, right: size === null ? null : { size, height: 0.6, across: -0.5 } },
  arms: { left: null, right: null },
});

/** Feeds right-hand palm sizes at 24 fps and returns the times of the jabs read. */
function jabs(sizes: Array<number | null>): number[] {
  const d = new TrialDetector();
  const out: number[] = [];
  sizes.forEach((s, i) => {
    const t = (i * 1000) / FPS;
    if (d.update(frame(s), t).punch) out.push(Math.round(t));
  });
  return out;
}
const hold = (v: number | null, n: number) => Array.from({ length: n }, () => v);

describe("a stale rest settles (playtest 5)", () => {
  // the recording: the right palm is 0.21-0.22 in the relaxed and high guard and 0.24 in the low guard
  it("a hand that sits steady between x1.15 and x1.35 of its rest (0.21 learned, 0.25 held) for 600 ms becomes the new rest, so the next jab is read; without it only the first is", () => {
    const sizes = [...hold(0.21, 6), ...hold(0.25, 48), ...hold(0.37, 3), ...hold(0.25, 48), ...hold(0.37, 3), ...hold(0.25, 12)];
    expect(jabs(sizes)).toHaveLength(2);
  });

  it("a real jab passing through the band in a quarter of a second doesn't rebase anything", () => {
    const rise = [0.21 * 1.2, 0.21 * 1.3, 0.21 * 1.5, 0.21 * 1.6];
    const sizes = [...hold(0.21, 24), ...rise, ...hold(0.21, 12), ...rise, ...hold(0.21, 12)];
    expect(jabs(sizes)).toHaveLength(2);
  });
});

describe("other ways a jab is missed (measured, not changed)", () => {
  it("a jab whose peak frame is lost by the hand model (the recording lost 9-44% of jab frames) is still read from the frames either side, if they pass x1.35", () => {
    const sizes = [...hold(0.21, 24), 0.21 * 1.4, null, 0.21 * 1.4, ...hold(0.21, 12)];
    expect(jabs(sizes)).toHaveLength(1);
  });

  it("a jab that never passes x1.35 in any frame the hand model saw is simply not read (peak frame lost, neighbours only x1.25)", () => {
    const sizes = [...hold(0.21, 24), 0.21 * 1.25, null, null, 0.21 * 1.25, ...hold(0.21, 12)];
    expect(jabs(sizes)).toHaveLength(0);
  });

  it("a slow push-out (a second long, x1.0 to x1.6) lets the resting size creep up while the ratio is under x1.15, and it is still read", () => {
    const slow = Array.from({ length: 24 }, (_, i) => 0.21 * (1 + (0.6 * (i + 1)) / 24));
    expect(jabs([...hold(0.21, 24), ...slow, ...hold(0.21, 12)])).toHaveLength(1);
  });

  it("a hand lost for more than the minimum gap (200 ms since 2026-11-08) while the fist is out re-arms, and the same fist seen again is read as a second jab", () => {
    // 3 frames out, lost 8 frames (333 ms), then still out: a double count of one punch
    const sizes = [...hold(0.21, 24), ...hold(0.21 * 1.5, 3), ...hold(null, 8), ...hold(0.21 * 1.5, 3), ...hold(0.21, 12)];
    expect(jabs(sizes)).toHaveLength(2);
  });
});
