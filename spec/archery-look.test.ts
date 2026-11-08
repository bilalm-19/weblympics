import { describe, expect, it } from "vitest";
import { ANCHOR, ARM, LINE_X, SHOULDER, archerPose, reach } from "../client/games/archery/archer-pose.ts";
import { BRACE, PULL } from "../client/games/archery/bow-model.ts";
import { FLAG_FULL_WIND, flagFly, flagHeading } from "../client/games/archery/cues.ts";
import { standLayout } from "../client/games/archery/range.ts";

// Task 31, the archery range's look: the flags are an honest wind cue (they
// stream where the dial points, harder in more wind), the archer's hands stay
// on the bow and string, and the crowd sits beside the range. Pure numbers,
// no WebGL.

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("flags", () => {
  it("stream the way the wind dial points, for every direction", () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const f = flagFly({ speed: 5, angle: (deg * Math.PI) / 180 });
      expect(flagHeading(f)).toBe(deg);
    }
    // the sim's frame: 0 is the shooter's right (+x), pi/2 down the range (-z)
    const left = flagFly({ speed: 8, angle: Math.PI });
    expect(left.dx).toBeCloseTo(-1);
    const down = flagFly({ speed: 8, angle: Math.PI / 2 });
    expect(down.dz).toBeCloseTo(-1);
  });

  it("hang nearly limp with no wind and lift with more, straight out from FLAG_FULL_WIND", () => {
    const lifts = [0, 1, 3, FLAG_FULL_WIND, 8].map((speed) => flagFly({ speed, angle: 0 }).lift);
    expect(lifts[0]).toBeLessThan(0.2);
    for (let i = 1; i < 4; i++) expect(lifts[i]).toBeGreaterThan(lifts[i - 1]);
    expect(lifts[3]).toBeGreaterThan(1.4);
    expect(lifts[4]).toBe(lifts[3]);
  });
});

describe("archer pose", () => {
  it("at rest faces down the range with the bow low; at the line stands side-on", () => {
    const rest = archerPose(0, 0, 0, 0);
    expect(rest.bodyYaw).toBeCloseTo(0);
    expect(rest.bowHand.y).toBeLessThan(1);
    const line = archerPose(1, 0.5, 0, 0);
    expect(line.bodyYaw).toBeCloseTo(-Math.PI / 2);
    // the aim's yaw turns the archer with it
    expect(archerPose(1, 0.5, 0, 0.2).bodyYaw).toBeCloseTo(-Math.PI / 2 - 0.2);
  });

  it("keeps the draw hand on the string: the bow's own brace plus pull behind the grip", () => {
    for (const d of [0, 0.3, 0.7, 1]) {
      const p = archerPose(1, d, 0, 0);
      expect(p.drawHand.x - p.bowHand.x).toBeCloseTo(BRACE + PULL * d, 5);
      expect(p.drawHand.y).toBeCloseTo(p.bowHand.y, 5);
    }
    // a full draw brings the string back to the chin (the draw shoulder's side)
    expect(archerPose(1, 1, 0, 0).drawHand.x).toBeGreaterThan(-0.3);
  });

  it("both hands are within the arms' reach for every usual aim, so neither leaves the bow", () => {
    for (const d of [0, 0.5, 1]) {
      for (const pitch of [-0.2, 0, 0.15, 0.3]) {
        const p = archerPose(1, d, pitch, 0);
        for (const [shoulder, hand] of [
          [SHOULDER.bow, p.bowHand],
          [SHOULDER.draw, p.drawHand],
        ] as const) {
          expect(dist(shoulder, hand)).toBeLessThan(ARM.upper + ARM.fore);
          const r = reach(shoulder, hand, { x: 0, y: -1, z: 0 });
          expect(dist(r.hand, hand)).toBeLessThan(1e-6);
          expect(dist(shoulder, r.elbow)).toBeCloseTo(ARM.upper, 5);
          expect(dist(r.elbow, r.hand)).toBeCloseTo(ARM.fore, 5);
        }
      }
    }
  });

  it("a pitched aim tips the arrow up; the winner raises the bow at rest", () => {
    const flat = archerPose(1, 0.5, 0, 0);
    const up = archerPose(1, 0.5, 0.3, 0);
    expect(up.bowHand.y).toBeGreaterThan(flat.bowHand.y + 0.1);
    expect(up.bowPitch).toBeCloseTo(0.3);
    expect(archerPose(0, 0, 0, 0, 1).bowHand.y).toBeGreaterThan(2);
  });

  it("stands the archer so the arrow at the line is where the sim launches it (x 0)", () => {
    // turning about y by t maps local (x, z) to world (x cos t + z sin t, -x sin t + z cos t)
    const p = archerPose(1, 0.5, 0, 0);
    const t = p.bodyYaw;
    const world = (x: number, z: number) => ({ x: LINE_X + x * Math.cos(t) + z * Math.sin(t), z: -x * Math.sin(t) + z * Math.cos(t) });
    // the grip and the nock both sit on x 0, the nock nearer the shooter than the grip
    const grip = world(p.bowHand.x, p.bowHand.z);
    const nock = world(p.drawHand.x, p.drawHand.z);
    expect(grip.x).toBeCloseTo(0, 5);
    expect(nock.x).toBeCloseTo(0, 5);
    expect(grip.z).toBeLessThan(nock.z);
    expect(p.bowHand.z).toBeCloseTo(ANCHOR.z, 5);
  });
});

describe("the spectators' stand", () => {
  it("is one crowd section beside the range, clear of the lanes, facing it", () => {
    const layout = standLayout();
    expect(layout.seats.length).toBeGreaterThan(40);
    expect(layout.ranges.left).toEqual({ start: 0, count: layout.seats.length });
    for (const s of layout.seats) {
      expect(s.x).toBeLessThan(-8);
      expect(s.facing).toBeCloseTo(Math.PI / 2);
      expect(s.y).toBeGreaterThan(0);
    }
  });
});
