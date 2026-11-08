import { describe, expect, it } from "vitest";
import { BOXING_STEPS, TRACK_STEPS, advance, applicable, done, matches, startCoach } from "../client/games/coach.ts";
import type { CoachEvent } from "../client/games/coach.ts";

// The practice coach for boxing and track (user, 2026-11-09). Pure rules: a
// step is ticked off by enough of its own move, in order, and nothing else.

const run = (steps: typeof BOXING_STEPS, events: CoachEvent[]) => events.reduce((s, e) => advance(steps, s, e), startCoach());
const head: CoachEvent = { kind: "punch", target: "head" };
const body: CoachEvent = { kind: "punch", target: "body" };

describe("the coach's steps", () => {
  it("boxing teaches the head jab, the body jab, the guard, then the lean, in that order", () => {
    expect(BOXING_STEPS.map((s) => s.id)).toEqual(["head", "body", "guard", "slip"]);
  });

  it("track teaches the steps, then the jump", () => {
    expect(TRACK_STEPS.map((s) => s.id)).toEqual(["step", "jump"]);
  });

  it("every step has a picture and something to do", () => {
    for (const s of [...BOXING_STEPS, ...TRACK_STEPS]) {
      expect(s.figure.length, s.id).toBeGreaterThan(3);
      expect(s.how.length, s.id).toBeGreaterThan(10);
      expect(s.times, s.id).toBeGreaterThan(0);
    }
  });
});

describe("what ticks a step off", () => {
  it("a head jab is not a body jab, and a step is not a jump", () => {
    expect(matches(BOXING_STEPS[0], head)).toBe(true);
    expect(matches(BOXING_STEPS[0], body)).toBe(false);
    expect(matches(BOXING_STEPS[1], body)).toBe(true);
    expect(matches(TRACK_STEPS[0], { kind: "jump" })).toBe(false);
  });

  it("counts a move up to the step's number, then goes on to the next step", () => {
    let s = startCoach();
    for (let i = 0; i < BOXING_STEPS[0].times - 1; i++) s = advance(BOXING_STEPS, s, head);
    expect(s).toEqual({ step: 0, count: BOXING_STEPS[0].times - 1 });
    s = advance(BOXING_STEPS, s, head);
    expect(s).toEqual({ step: 1, count: 0 });
  });

  it("a move from a later step does nothing yet (the coach teaches in order)", () => {
    expect(run(BOXING_STEPS, [body, body, body])).toEqual({ step: 0, count: 0 });
  });

  it("a whole lesson in order finishes it, and then nothing moves it", () => {
    const events: CoachEvent[] = [
      ...Array(3).fill(head),
      ...Array(3).fill(body),
      ...Array(2).fill({ kind: "guard", height: "high" }),
      { kind: "slip" },
    ];
    const s = run(BOXING_STEPS, events);
    expect(done(BOXING_STEPS, s)).toBe(true);
    expect(advance(BOXING_STEPS, s, head)).toBe(s);
  });

  it("track: eight steps, then two jumps", () => {
    const s = run(TRACK_STEPS, [...Array(8).fill({ kind: "step" }), ...Array(2).fill({ kind: "jump" })]);
    expect(done(TRACK_STEPS, s)).toBe(true);
  });
});

describe("the sprint has no hurdle to jump", () => {
  it("the jump step is left out outside the hurdles, so the coach never waits for it", () => {
    const sprint = applicable(TRACK_STEPS, (id) => id === "jump");
    expect(sprint.map((s) => s.id)).toEqual(["step"]);
    expect(done(sprint, run(sprint, Array(8).fill({ kind: "step" })))).toBe(true);
    expect(applicable(TRACK_STEPS, () => false)).toHaveLength(2);
  });
});
