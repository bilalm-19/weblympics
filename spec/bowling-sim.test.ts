// Bowling's rules (task 29, ADR 004): scoring, turns, the shot clock and its
// grace, the tie vote (user, 2026-11-08), unlimited, the closed messages and
// the bot. The pins' physics is spec/bowling-physics.test.ts.
import { describe, expect, it } from "vitest";
import { BOT_VOTE_TICK, botInputs } from "../shared/games/bowling/bot.ts";
import { asInput, bowling, bowlingFrom } from "../shared/games/bowling/index.ts";
import {
  FRAMES,
  MAX_GRACE_TICKS,
  OVER_TICKS,
  SHOT_CLOCK_TICKS,
  VOTE_TICKS,
  cloneState,
  createState,
  scoreCard,
  setLag,
  snapshot,
  step,
} from "../shared/games/bowling/sim.ts";
import type { BowlingSnapshot, BowlingState } from "../shared/games/bowling/sim.ts";
import { games } from "../shared/games/registry.ts";
import { bowl, gutterBall, playOut, runBot, strikeBall, timeout, toAim } from "./bowling-helpers.ts";

/** A game where both seats bowl only gutter balls: 0-0, then the vote. */
function levelGame(format: "game" | "unlimited" = "game"): BowlingState {
  const s = createState(7, { format, endless: format === "unlimited" });
  playOut(s, () => gutterBall);
  return s;
}

describe("bowling scoring (real ten-pin over five frames)", () => {
  it("open frames add up; a strike is 10 plus the next two balls, a spare 10 plus the next one", () => {
    expect(scoreCard([3, 4, 5, 2, 0, 0, 1, 1, 9, 0]).total).toBe(25);
    // strike, then 3 and 4: 17 + 7
    const c = scoreCard([10, 3, 4, 0, 0, 0, 0, 0, 0]);
    expect(c.frames.map((f) => f.score)).toEqual([17, 24, 24, 24, 24]);
    // spare, then 6: 16 + 6
    expect(scoreCard([7, 3, 6, 0, 0, 0, 0, 0, 0, 0]).frames.slice(0, 2).map((f) => f.score)).toEqual([16, 22]);
  });

  it("the fifth frame gives the bonus balls: up to three after a strike or spare, two otherwise", () => {
    const four = [0, 0, 0, 0, 0, 0, 0, 0];
    expect(scoreCard([...four, 10, 10, 10]).frames[4]).toMatchObject({ rolls: [10, 10, 10], marks: ["X", "X", "X"], score: 30 });
    expect(scoreCard([...four, 7, 3, 5]).frames[4]).toMatchObject({ rolls: [7, 3, 5], marks: ["7", "/", "5"], score: 15 });
    expect(scoreCard([...four, 10, 4, 6]).frames[4]).toMatchObject({ marks: ["X", "4", "/"], score: 20 });
    expect(scoreCard([...four, 4, 4]).frames[4]).toMatchObject({ rolls: [4, 4], score: 8 });
  });

  it("a perfect game is 150 and a gutter game 0", () => {
    expect(scoreCard(Array(7).fill(10)).total).toBe(150);
    expect(scoreCard(Array(10).fill(0)).total).toBe(0);
    expect(scoreCard(Array(10).fill(0)).frames[0].marks).toEqual(["-", "-"]);
  });

  it("a frame waiting on its bonus balls has no score yet, and neither do the frames after it", () => {
    const c = scoreCard([10, 3]);
    expect(c.frames[0].score).toBeNull();
    expect(c.frames[1].score).toBeNull();
    expect(c.total).toBe(0);
  });

  it("in play: twelve-ball perfection is impossible in five frames, seven strikes make 150", () => {
    const s = createState(1);
    playOut(s, (_s, seat) => (seat === 0 ? strikeBall() : gutterBall));
    expect(s.phase).toBe("over");
    expect(s.rolls[0]).toEqual(Array(7).fill(10));
    expect(snapshot(s).cards[0].total).toBe(150);
    expect(snapshot(s).cards[1].total).toBe(0);
    expect(s.winner).toBe(0);
  });
});

describe("bowling turns", () => {
  it("frames alternate, seat 0 first; a strike ends the frame, otherwise two balls", () => {
    const s = createState(2);
    expect(s.turn).toBe(0);
    const first = bowl(s, strikeBall());
    expect(first).toMatchObject({ seat: 0, frame: 0, ball: 0, strike: true });
    toAim(s);
    expect(s.turn).toBe(1);
    bowl(s, gutterBall);
    toAim(s);
    expect(s).toMatchObject({ turn: 1, ball: 1 });
    bowl(s, gutterBall);
    toAim(s);
    expect(s).toMatchObject({ turn: 0, frame: 1, ball: 0 });
  });

  it("the pins are reset each frame and the fallen ones cleared between balls", () => {
    const s = createState(3);
    // a light hit on the edge of the rack leaves pins standing
    const b = bowl(s, { speed: 0.5, aim: 0.45, spin: 0 });
    expect(b.pins).toBeGreaterThan(0);
    expect(b.pins).toBeLessThan(10);
    toAim(s);
    const snap = snapshot(s);
    expect(snap.pins.filter((p) => p.standing)).toHaveLength(10 - b.pins);
    expect(snap.pins.filter((p) => p.cleared)).toHaveLength(b.pins);
    // the second ball counts only what it knocks of the leftovers
    const second = bowl(s, gutterBall);
    expect(second.pins).toBe(0);
    toAim(s);
    expect(snapshot(s).pins.every((p) => p.standing && !p.cleared)).toBe(true);
  });

  it("off-turn throws and aims are ignored, and so is a second throw for one ball", () => {
    const s = createState(4);
    step(s, [{ t: "throw", seat: 1, speed: 1, aim: 0, spin: 0, at: 0 }]);
    step(s, [{ t: "aim", seat: 1, aim: 0.8 }]);
    expect(s.phase).toBe("aim");
    expect(s.aims[1]).toBe(0);
    step(s, [{ t: "throw", seat: 0, ...gutterBall, at: 0 }]);
    expect(s.phase).toBe("roll");
    const thrown = { ...s.thrown! };
    step(s, [{ t: "throw", seat: 0, ...strikeBall(), at: 0 }]);
    expect(s.thrown).toEqual(thrown);
  });

  it("two throws in one tick: only the first rolls", () => {
    const s = createState(4);
    step(s, [
      { t: "throw", seat: 0, ...gutterBall, at: 0 },
      { t: "throw", seat: 0, ...strikeBall(), at: 0 },
    ]);
    expect(s.thrown!.aim).toBe(-1);
  });

  it("the live aim is kept for everyone to see, clamped", () => {
    const s = createState(5);
    step(s, [{ t: "aim", seat: 0, aim: 4 }]);
    expect(snapshot(s).aims).toEqual([1, 0]);
  });

  it("the sim clamps a throw's speed, aim and spin", () => {
    const s = createState(5);
    step(s, [{ t: "throw", seat: 0, speed: 9, aim: -9, spin: 9, at: 0 }]);
    expect(s.thrown).toMatchObject({ speed: 1, aim: -1, spin: 1 });
  });
});

describe("bowling shot clock (20 s a ball, timeout is a gutter ball)", () => {
  it("running out rolls a gutter ball for the thrower", () => {
    const s = createState(6);
    const b = timeout(s);
    expect(b).toMatchObject({ seat: 0, pins: 0, timeout: true });
    expect(s.last).toMatchObject({ gutter: true, timeout: true, read: null });
    expect(s.rolls[0]).toEqual([0]);
  });

  it("the snapshot counts the clock down", () => {
    const s = createState(6);
    step(s, []);
    expect(snapshot(s).clock).toBe(SHOT_CLOCK_TICKS - 1);
  });

  it("a throw after the buzzer counts only within the seat's grace, capped at 9 ticks (150 ms)", () => {
    const late = (grace: number, after: number) => {
      const s = createState(8);
      setLag(s, 0, grace);
      for (let i = 0; i < SHOT_CLOCK_TICKS + after - 1; i++) step(s, []);
      if (s.phase !== "aim") return "timed out";
      step(s, [{ t: "throw", seat: 0, ...strikeBall(), at: 0 }]);
      return (s.phase as string) === "roll" ? "rolled" : "timed out";
    };
    expect(late(0, 0)).toBe("rolled");
    expect(late(0, 1)).toBe("timed out");
    expect(late(5, 5)).toBe("rolled");
    expect(late(5, 6)).toBe("timed out");
    // a huge lag is capped
    expect(late(1000, MAX_GRACE_TICKS)).toBe("rolled");
    expect(late(1000, MAX_GRACE_TICKS + 1)).toBe("timed out");
  });

  it("the game takes its grace from the room (setLag), defaulting to none", () => {
    const g = bowling.create(1);
    expect(g.setLag).toBeTypeOf("function");
    const s = createState(1);
    expect(s.grace).toEqual([0, 0]);
    setLag(s, 1, 4);
    setLag(s, 0, Number.NaN);
    expect(s.grace).toEqual([0, 4]);
  });
});

describe("bowling tie vote (user, 2026-11-08)", () => {
  it("a level game votes, with each seat's vote and the clock in the snapshot", () => {
    const s = levelGame();
    expect(s.phase).toBe("tie-vote");
    const snap = snapshot(s);
    expect(snap.vote).toEqual({ votes: [null, null], ticksLeft: VOTE_TICKS - s.phaseTick });
    step(s, [{ t: "tie", seat: 1, choice: "continue" }]);
    expect(snapshot(s).vote!.votes).toEqual([null, "continue"]);
  });

  for (const seat of [0, 1] as const) {
    it(`seat ${seat} choosing draw ends it as a draw`, () => {
      const s = levelGame();
      const ev = step(s, [{ t: "tie", seat, choice: "draw" }]);
      expect(s).toMatchObject({ phase: "over", winner: null, draw: true, draws: 1 });
      expect(ev.find((e) => e.type === "bowlGame")).toMatchObject({ winner: null, draw: true, score: [0, 0] });
      expect(bowlingFrom(s).finished()).toEqual({ winner: null, score: [0, 0], format: "game" });
    });
  }

  it("draw wins over continue whatever the order", () => {
    const s = levelGame();
    step(s, [{ t: "tie", seat: 0, choice: "continue" }]);
    expect(s.phase).toBe("tie-vote");
    step(s, [{ t: "tie", seat: 1, choice: "draw" }]);
    expect(s).toMatchObject({ phase: "over", draw: true });
  });

  it("both continue bowl a tie frame: no bonus balls, not added to the score; its pins decide", () => {
    const s = levelGame();
    step(s, [
      { t: "tie", seat: 0, choice: "continue" },
      { t: "tie", seat: 1, choice: "continue" },
    ]);
    expect(s).toMatchObject({ phase: "aim", frame: FRAMES, turn: 0, ball: 0 });
    expect(snapshot(s).tieFrame).toBe(1);
    // seat 0 strikes: no bonus balls in a tie frame, so it's seat 1's turn
    bowl(s, strikeBall());
    toAim(s);
    expect(s).toMatchObject({ turn: 1, ball: 0 });
    bowl(s, gutterBall);
    bowl(s, gutterBall);
    toAim(s);
    expect(s).toMatchObject({ phase: "over", winner: 0, draw: false });
    const snap = snapshot(s);
    expect(snap.cards[0]).toMatchObject({ total: 0, tie: [10] });
    expect(snap.cards[1]).toMatchObject({ total: 0, tie: [0] });
    expect(bowlingFrom(s).finished()).toEqual({ winner: 0, score: [0, 0], format: "game" });
  });

  it("a level tie frame votes again", () => {
    const s = levelGame();
    step(s, [
      { t: "tie", seat: 0, choice: "continue" },
      { t: "tie", seat: 1, choice: "continue" },
    ]);
    playOut(s, () => gutterBall);
    expect(s.phase).toBe("tie-vote");
    expect(s.votes).toEqual([null, null]);
    step(s, [
      { t: "tie", seat: 0, choice: "continue" },
      { t: "tie", seat: 1, choice: "continue" },
    ]);
    expect(s).toMatchObject({ phase: "aim", frame: FRAMES + 1 });
    expect(snapshot(s).tieFrame).toBe(2);
  });

  it("the vote clock running out counts a missing vote as draw", () => {
    const s = levelGame();
    step(s, [{ t: "tie", seat: 0, choice: "continue" }]);
    for (let i = 0; i < VOTE_TICKS + 2 && s.phase === "tie-vote"; i++) step(s, []);
    expect(s).toMatchObject({ phase: "over", winner: null, draw: true });
    expect(s.phaseTick).toBeLessThan(5);
  });

  it("votes off-phase and a second vote are ignored", () => {
    const s = createState(9);
    step(s, [{ t: "tie", seat: 0, choice: "draw" }]);
    expect(s.phase).toBe("aim");
    expect(s.votes).toEqual([null, null]);
    const t = levelGame();
    step(t, [{ t: "tie", seat: 0, choice: "continue" }]);
    step(t, [{ t: "tie", seat: 0, choice: "draw" }]);
    expect(t).toMatchObject({ phase: "tie-vote", votes: ["continue", null] });
  });

  it("the bot votes continue after a short delay, so the person decides", () => {
    const s = levelGame();
    expect(botInputs(s, 1)).toEqual([]);
    runBot(s, 1, BOT_VOTE_TICK - s.phaseTick);
    expect(s.votes).toEqual([null, null]);
    runBot(s, 1, 2);
    expect(s.votes).toEqual([null, "continue"]);
    step(s, [{ t: "tie", seat: 0, choice: "continue" }]);
    expect(s).toMatchObject({ phase: "aim", frame: FRAMES });
  });

  it("unlimited: a level game votes too; draw counts a drawn game and play goes on", () => {
    const s = levelGame("unlimited");
    expect(s.phase).toBe("tie-vote");
    step(s, [{ t: "tie", seat: 1, choice: "draw" }]);
    expect(s).toMatchObject({ phase: "over", draws: 1, wins: [0, 0] });
    expect(bowlingFrom(s).finished()).toBeNull();
    for (let i = 0; i < OVER_TICKS; i++) step(s, []);
    expect(s).toMatchObject({ phase: "aim", frame: 0, draws: 1 });
  });
});

describe("bowling unlimited", () => {
  it("game after game: counts games won and the best score, never finishes", () => {
    const s = createState(10, { format: "unlimited", endless: true });
    playOut(s, (_s, seat) => (seat === 0 ? strikeBall() : gutterBall));
    expect(s).toMatchObject({ phase: "over", winner: 0, wins: [1, 0], best: [150, 0] });
    expect(bowlingFrom(s).finished()).toBeNull();
    for (let i = 0; i < OVER_TICKS; i++) step(s, []);
    expect(s).toMatchObject({ phase: "aim", frame: 0, turn: 0 });
    expect(s.rolls).toEqual([[], []]);
    playOut(s, (_s, seat) => (seat === 1 ? strikeBall() : gutterBall));
    expect(s).toMatchObject({ wins: [1, 1], best: [150, 150], matches: 2 });
  });

  it("the game format finishes once and stays finished", () => {
    const s = createState(11);
    playOut(s, (_s, seat) => (seat === 1 ? strikeBall() : gutterBall));
    const g = bowlingFrom(s);
    expect(g.finished()).toEqual({ winner: 1, score: [0, 150], format: "game" });
    for (let i = 0; i < OVER_TICKS * 2; i++) g.step([]);
    expect((g.snapshot() as BowlingSnapshot).phase).toBe("over");
  });
});

describe("bowling messages (closed asInput)", () => {
  it("accepts exactly aim, throw and tie, with the seat from the connection", () => {
    expect(asInput(1, { t: "aim", aim: 0.3 })).toEqual({ t: "aim", seat: 1, aim: 0.3 });
    expect(asInput(0, { t: "throw", speed: 0.5, aim: -0.2, spin: 0.4, at: 123 })).toEqual({ t: "throw", seat: 0, speed: 0.5, aim: -0.2, spin: 0.4, at: 123 });
    expect(asInput(0, { t: "tie", choice: "draw" })).toEqual({ t: "tie", seat: 0, choice: "draw" });
    expect(asInput(1, { t: "tie", choice: "continue" })).toEqual({ t: "tie", seat: 1, choice: "continue" });
  });

  it("drops anything else, or any extra field, whole", () => {
    const bad: unknown[] = [
      null,
      "throw",
      [],
      { t: "release", yaw: 0, pitch: 0, draw: 1 },
      { t: "aim", yaw: 0, pitch: 0, draw: 1 },
      { t: "aim" },
      { t: "aim", aim: "left" },
      { t: "aim", aim: Number.NaN },
      { t: "aim", aim: 0, seat: 1 },
      { t: "throw", speed: 0.5, aim: 0, spin: 0 },
      { t: "throw", speed: 0.5, aim: 0, spin: 0, at: Infinity },
      { t: "throw", speed: "fast", aim: 0, spin: 0, at: 0 },
      { t: "throw", speed: 0.5, aim: 0, spin: 0, at: 0, pins: 10 },
      { t: "throw", speed: 0.5, aim: 0, spin: 0, at: 0, seat: 1 },
      { t: "tie", choice: "win" },
      { t: "tie" },
      { t: "tie", choice: "draw", seat: 0 },
      { t: "score", score: 150 },
      { t: "strike" },
    ];
    for (const b of bad) expect(asInput(0, b), JSON.stringify(b)).toBeNull();
  });

  it("a malformed vote through the game changes nothing", () => {
    const s = levelGame();
    const g = bowlingFrom(s);
    g.step([
      { seat: 0, input: { t: "tie", choice: "maybe" } },
      { seat: 1, input: { t: "tie", choice: "draw", extra: 1 } },
    ]);
    expect((g.snapshot() as BowlingSnapshot).vote!.votes).toEqual([null, null]);
  });
});

describe("bowling registration and determinism", () => {
  it("is registered as bowling with its formats, the game first", () => {
    expect(games.bowling).toBe(bowling);
    expect(bowling).toMatchObject({ id: "bowling", name: "Bowling", formats: ["game", "unlimited"] });
  });

  it("the same seed and inputs play out the same; the snapshot is a copy", () => {
    const run = () => {
      const s = createState(42);
      runBot(s, 0, 1);
      const out: BowlingSnapshot[] = [];
      for (let i = 0; i < 3000; i++) {
        step(s, [...botInputs(s, 0), ...botInputs(s, 1)]);
        if (i % 300 === 0) out.push(snapshot(s));
      }
      return out;
    };
    expect(run()).toEqual(run());
    const s = createState(1);
    const snap = snapshot(s);
    snap.pins[0].standing = false;
    expect(s.pins[0].standing).toBe(true);
    const c = cloneState(s);
    c.rolls[0].push(5);
    expect(s.rolls[0]).toEqual([]);
  });
});

describe("the bowling bot", () => {
  it("never throws or aims off its turn", () => {
    const s = createState(12);
    for (let i = 0; i < 200; i++) {
      expect(botInputs(s, 1)).toEqual([]);
      step(s, []);
    }
  });

  it("throws on its turn and picks up spares sometimes, and is beatable", () => {
    let strikes = 0;
    let balls = 0;
    let botBest = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = createState(seed * 7919);
      const ev = runBot(s, 0, 1);
      for (let i = 0; i < 60_000 && s.phase !== "over" && s.phase !== "tie-vote"; i++) ev.push(...step(s, [...botInputs(s, 0), ...botInputs(s, 1)]));
      for (const e of ev) if (e.type === "bowl") {
        balls++;
        if (e.strike) strikes++;
      }
      botBest = Math.max(botBest, snapshot(s).cards[0].total);
    }
    expect(balls).toBeGreaterThan(60);
    // a fair bowler: some strikes, but far from every ball
    expect(strikes).toBeGreaterThan(0);
    expect(strikes / balls).toBeLessThan(0.6);
    // a person throwing strikes beats it
    expect(botBest).toBeLessThan(150);
  });

  it("a person bowling strikes beats the bot", () => {
    const s = createState(99);
    for (let i = 0; i < 60_000 && s.phase !== "over"; i++) {
      if (s.phase === "aim" && s.turn === 0 && s.phaseTick === 10) step(s, [{ t: "throw", seat: 0, ...strikeBall(), at: 0 }]);
      else step(s, botInputs(s, 1));
    }
    expect(s).toMatchObject({ phase: "over", winner: 0 });
  });
});
