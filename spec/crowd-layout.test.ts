import { describe, expect, it } from "vitest";
import { CROWD_SECTIONS, INNER, crowdLayout } from "../client/games/tennis/crowd-layout.ts";

// Task 20: the crowd sits in four sections that task 19 (reactions) drives one
// at a time: the left and right stands, and the end stand split in half.

describe("crowd layout", () => {
  const layout = crowdLayout();

  it("has the four sections, each a contiguous run of seats, covering every seat once", () => {
    expect(CROWD_SECTIONS).toEqual(["left", "right", "frontLeft", "frontRight"]);
    let next = 0;
    for (const section of CROWD_SECTIONS) {
      const { start, count } = layout.ranges[section];
      expect(start).toBe(next);
      expect(count).toBeGreaterThan(50);
      for (let i = start; i < start + count; i++) expect(layout.seats[i].section).toBe(section);
      next += count;
    }
    expect(next).toBe(layout.seats.length);
  });

  it("puts each section on its own side of the arena", () => {
    for (const seat of layout.seats) {
      if (seat.section === "left") expect(seat.x).toBeLessThan(-INNER.halfW);
      if (seat.section === "right") expect(seat.x).toBeGreaterThan(INNER.halfW);
      if (seat.section === "frontLeft" || seat.section === "frontRight") expect(seat.z).toBeLessThan(-INNER.halfL);
      if (seat.section === "frontLeft") expect(seat.x).toBeLessThan(0);
      if (seat.section === "frontRight") expect(seat.x).toBeGreaterThan(0);
    }
  });

  it("splits the end stand roughly in half and mirrors the side stands", () => {
    const { left, right, frontLeft, frontRight } = layout.ranges;
    expect(Math.abs(frontLeft.count - frontRight.count)).toBeLessThan(0.2 * frontLeft.count);
    expect(Math.abs(left.count - right.count)).toBeLessThan(0.2 * left.count);
  });

  it("is the same every time (seeded)", () => {
    expect(crowdLayout()).toEqual(layout);
  });
});
