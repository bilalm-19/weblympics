// Task 32: basketball's words on screen (client/games/basketball/calls.ts).
// The call after a shot, the power bar's verdict, the spot line and the held
// power bar. Every number comes from the server's ShotResult.
import { describe, expect, it } from "vitest";
import { bonusLine, heldPower, powerVerdict, shotCall, spotLine } from "../client/games/basketball/calls.ts";
import { DEEP_SPOT } from "../shared/games/basketball/sim.ts";

const shot = (o: Partial<Parameters<typeof shotCall>[0]>) => ({ made: false, swish: false, rim: false, board: false, points: 0, spot: 0, suddenDeath: false, ...o });

describe("basketball calls", () => {
  it("names how a make went in and what it scored", () => {
    expect(shotCall(shot({ made: true, swish: true, points: 3, spot: 2 })).text).toBe("SWISH! +3");
    expect(shotCall(shot({ made: true, board: true, points: 2, spot: 1 })).text).toBe("Bank shot! +2");
    expect(shotCall(shot({ made: true, rim: true, points: 2 })).text).toBe("Rattled in! +2");
  });

  it("says the swish's +1 stacks, the money ball included (a swished money ball is +5)", () => {
    const c = shotCall(shot({ made: true, swish: true, points: 5, spot: DEEP_SPOT }));
    expect(c.text).toBe("SWISH! +5");
    expect(c.detail).toBe("4 + 1 swish, money ball");
    expect(c.crowd).toBe("big");
    expect(shotCall(shot({ made: true, swish: true, points: 3, spot: 0 })).detail).toBe("2 + 1 swish");
  });

  it("groans at a miss, says why, and says time's up when no shot came", () => {
    expect(shotCall(shot({ rim: true }))).toMatchObject({ text: "Off the rim", crowd: "groan" });
    expect(shotCall(shot({ board: true })).text).toBe("Off the board");
    expect(shotCall(shot({})).text).toBe("Air ball!");
    expect(shotCall(shot({ lost: "time" })).text).toBe("Time's up");
  });

  it("cheers louder for a swish or the money ball than a plain make", () => {
    expect(shotCall(shot({ made: true, rim: true, points: 2 })).crowd).toBe("cheer");
    expect(shotCall(shot({ made: true, rim: true, points: 4, spot: DEEP_SPOT })).crowd).toBe("big");
  });

  it("shows no points in sudden death (it only decides the winner)", () => {
    expect(shotCall(shot({ made: true, swish: true, points: 5, spot: DEEP_SPOT, suddenDeath: true })).text).toBe("SWISH!");
  });

  it("judges the power against the window", () => {
    const w = { lo: 0.4, hi: 0.5 };
    expect(powerVerdict(0.3, w)).toBe("Too soft");
    expect(powerVerdict(0.45, w)).toBe("Just right");
    expect(powerVerdict(0.6, w)).toBe("Too hard");
  });

  it("writes the spot line and the bonus line", () => {
    expect(spotLine({ format: "shootout", spot: 2, round: 2, suddenDeath: false })).toBe("Spot 3 of 5 · Wing three · 3 pts");
    expect(spotLine({ format: "shootout", spot: DEEP_SPOT, round: 5, suddenDeath: true })).toMatch(/^Sudden death/);
    expect(spotLine({ format: "unlimited", spot: 0, round: 7, suddenDeath: false })).toBe("Unlimited · Free throw · 2 pts");
    expect(bonusLine(DEEP_SPOT, false)).toBe("Money ball: a swish makes it 5");
    expect(bonusLine(0, false)).toBe("A swish adds 1: 3 pts");
  });

  it("fills the held power bar in a second, then lets it fall", () => {
    expect(heldPower(0)).toBe(0);
    expect(heldPower(0.5)).toBeCloseTo(0.5);
    expect(heldPower(1)).toBeCloseTo(1);
    expect(heldPower(1.25)).toBeCloseTo(0.75);
    expect(heldPower(2.5)).toBeCloseTo(0.5);
  });
});
