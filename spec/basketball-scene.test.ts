// Task 32: the pure parts of basketball's scene: the shooter's one standard
// shot (shooter.ts) and the bleachers' crowd (court.ts, seated with tennis's
// own standSeats, so its sections are the two sidelines).
import { describe, expect, it } from "vitest";
import { HALF_W, bleacherLayout } from "../client/games/basketball/court.ts";
import { SHOT_TIMES, shotPose } from "../client/games/basketball/shooter.ts";

describe("basketball shooter", () => {
  it("holds the ball at the chest, then pushes it up past the face and lets go", () => {
    const hold = shotPose("hold");
    expect(hold.ball).not.toBeNull();
    expect(hold.ball!.y).toBeGreaterThan(1);
    expect(hold.ball!.y).toBeLessThan(1.4);
    const top = shotPose("shoot", SHOT_TIMES.rise + 0.01);
    expect(top.ball).toBeNull();
    for (const h of ["left", "right"] as const) expect(top.hands[h].y).toBeGreaterThan(2);
    // and the arms come back down afterwards
    const after = shotPose("shoot", SHOT_TIMES.rise + SHOT_TIMES.hold + SHOT_TIMES.down + 0.1);
    expect(after.hands.right.y).toBeLessThan(1);
  });

  it("dips the ball a little as the held power bar fills", () => {
    expect(shotPose("hold", 0, 1).ball!.y).toBeLessThan(shotPose("hold", 0, 0).ball!.y);
  });
});

describe("basketball bleachers", () => {
  const layout = bleacherLayout();
  it("seats a crowd on both sidelines, outside the court, and nobody at the ends", () => {
    const { left, right, frontLeft, frontRight } = layout.ranges;
    expect(left.count).toBeGreaterThan(40);
    expect(right.count).toBeGreaterThan(40);
    expect(frontLeft.count + frontRight.count).toBe(0);
    for (const s of layout.seats) {
      if (s.section === "left") expect(s.x).toBeLessThan(-HALF_W);
      if (s.section === "right") expect(s.x).toBeGreaterThan(HALF_W);
    }
  });

  it("is the same every time (seeded)", () => {
    expect(bleacherLayout()).toEqual(layout);
  });
});
