// Basketball (task 32, ADR 003): spots, turns, the shot clock and its
// late-shot grace, scoring, sudden death, unlimited, the closed message set
// and the bot. The flight itself is spec/basketball-physics.test.ts.
import { describe, expect, it } from "vitest";
import { BOT_SHOOT_TICK, BOT_VOTE_TICK, botInputs } from "../shared/games/basketball/bot.ts";
import { asInput, basketball, basketballFrom } from "../shared/games/basketball/index.ts";
import {
  AUTO_CLOCK_TICKS,
  DEEP_SPOT,
  MAX_LATE_TICKS,
  RESULT_TICKS,
  SHOT_CLOCK_TICKS,
  SPOTS,
  SWISH_BONUS,
  VOTE_TICKS,
  cloneState,
  createState,
  makeWindow,
  setLag,
  snapshot,
  step,
} from "../shared/games/basketball/sim.ts";
import type { BasketballSnapshot, BasketballState, Seat } from "../shared/games/basketball/sim.ts";
import { games } from "../shared/games/registry.ts";
import { playMatch, powerFor, shoot, toTurn } from "./basketball-helpers.ts";

const miss = (spot: number) => powerFor(spot, "miss");
const swish = (s: BasketballState) => powerFor(s.spot, "swish");
const rimIn = (spot: number) => powerFor(spot, "rimIn");

/** Plays the five spots: seat 0 shoots `p0(state)`, seat 1 `p1(state)`; stops at sudden death or the end. */
function playSpots(s: BasketballState, p0: (s: BasketballState) => number, p1: (s: BasketballState) => number) {
  const out = [];
  while (s.phase !== "tie-vote" && s.phase !== "over") {
    toTurn(s);
    out.push(shoot(s, s.turn === 0 ? p0(s) : p1(s)));
    for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
  }
  return out;
}

describe("basketball registration and formats", () => {
  it("is registered as basketball, offering the shootout by default and unlimited", () => {
    expect(games.basketball).toBe(basketball);
    expect(basketball.name).toBe("Basketball");
    expect(basketball.formats).toEqual(["shootout", "unlimited"]);
    expect((basketball.create(1).snapshot() as BasketballSnapshot).format).toBe("shootout");
    expect((basketball.create(1, { format: "unlimited" }).snapshot() as BasketballSnapshot).format).toBe("unlimited");
    expect((basketball.create(1, { format: "oneSet" }).snapshot() as BasketballSnapshot).format).toBe("shootout");
  });

  it("has the ADR's five spots, nearest first, 2/2/3/3/4", () => {
    expect(SPOTS.map((s) => s.distance)).toEqual([4.6, 5.5, 6.75, 7.25, 9]);
    expect(SPOTS.map((s) => s.points)).toEqual([2, 2, 3, 3, 4]);
    expect(DEEP_SPOT).toBe(4);
  });
});

describe("basketball scoring", () => {
  it("a swish adds 1 to any basket, the money ball included (a swished money ball is 5)", () => {
    for (let spot = 0; spot < SPOTS.length; spot++) {
      const s = createState(1);
      s.spot = spot;
      const b = shoot(s, powerFor(spot, "swish"));
      expect(b).toMatchObject({ made: true, swish: true, rim: false, board: false, points: SPOTS[spot].points + SWISH_BONUS });
    }
    const s = createState(1);
    s.spot = DEEP_SPOT;
    expect(shoot(s, powerFor(DEEP_SPOT, "swish")).points).toBe(5);
  });

  it("a basket off the rim scores the spot's points with no bonus; a miss scores nothing", () => {
    const s = createState(1);
    const b = shoot(s, rimIn(0));
    expect(b).toMatchObject({ made: true, swish: false, rim: true, points: 2 });
    expect(s.totals[0]).toBe(2);
    const t = createState(1);
    t.spot = DEEP_SPOT;
    expect(shoot(t, rimIn(DEEP_SPOT)).points).toBe(4);
    const u = createState(1);
    expect(shoot(u, miss(0))).toMatchObject({ made: false, points: 0 });
    expect(u.totals[0]).toBe(0);
  });

  it("the result keeps the clamped power, aim and the spot's window for the power bar", () => {
    const s = createState(1);
    const b = shoot(s, 3, -7);
    expect(b).toMatchObject({ power: 1, aim: -1, made: false });
    expect(s.last).toMatchObject({ power: 1, aim: -1, window: makeWindow(0) });
    expect(snapshot(s).last!.window).toEqual(makeWindow(0));
  });

  it("totals the five spots and the higher total wins", () => {
    const s = createState(7);
    const baskets = playMatch(s, (st) => (st.turn === 0 ? swish(st) : miss(st.spot)));
    expect(baskets).toHaveLength(10);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    // 3 + 3 + 4 + 4 + 5, every one swished
    expect(s.totals).toEqual([19, 0]);
    expect(s.makes).toEqual([5, 0]);
    expect(s.attempts).toEqual([5, 5]);
    expect(s.longest).toEqual([9, 0]);
    expect(basketballFrom(s).finished()).toEqual({ winner: 0, score: [19, 0], format: "shootout" });
  });
});

describe("basketball turns", () => {
  it("alternates shooters within a spot and swaps the first shooter each spot", () => {
    const s = createState(3);
    const order: [number, Seat][] = playMatch(s, (st) => (st.turn === 0 ? swish(st) : miss(st.spot))).map((b) => [b.spot, b.seat]);
    expect(order).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 1],
      [3, 0],
      [4, 0],
      [4, 1],
    ]);
  });

  it("ignores a message from the seat whose turn it isn't, and a second shot in a turn", () => {
    const s = createState(3);
    step(s, [{ t: "set", seat: 1 }]);
    step(s, [{ t: "aim", seat: 1, aim: 0.8 }]);
    step(s, [{ t: "shoot", seat: 1, power: 0.5, aim: 0, at: 0 }]);
    expect(s.phase).toBe("aim");
    expect(s.set).toBe(false);
    expect(s.aim).toEqual([0, 0]);
    // the shooter's shot flies; a second one in the same turn changes nothing
    step(s, [
      { t: "shoot", seat: 0, power: miss(0), aim: 0, at: 0 },
      { t: "shoot", seat: 0, power: swish(s), aim: 0, at: 0 },
    ]);
    expect(s.phase).toBe("flight");
    const flying = cloneState(s);
    step(s, [{ t: "shoot", seat: 0, power: swish(s), aim: 0, at: 0 }]);
    step(flying, []);
    expect(snapshot(s)).toEqual(snapshot(flying));
    for (let i = 0; i < 400 && s.phase === "flight"; i++) step(s, [{ t: "shoot", seat: 0, power: swish(s), aim: 0, at: 0 }]);
    expect(s.last).toMatchObject({ seat: 0, made: false });
    // and during the result too
    step(s, [{ t: "shoot", seat: 0, power: swish(s), aim: 0, at: 0 }]);
    expect(s.shots).toHaveLength(1);
  });

  it("keeps the shooter's aim for watchers, clamped", () => {
    const s = createState(3);
    step(s, [{ t: "aim", seat: 0, aim: 0.4 }]);
    expect(snapshot(s).aim).toEqual([0.4, 0]);
    step(s, [{ t: "aim", seat: 0, aim: -9 }]);
    expect(snapshot(s).aim).toEqual([-1, 0]);
  });
});

describe("basketball shot clock", () => {
  it("starts on the shooter's first set, shows the ready cue, and runs out to a miss after 15 s", () => {
    const s = createState(3);
    for (let i = 0; i < 60; i++) step(s, []);
    expect(snapshot(s)).toMatchObject({ set: false, clockRunning: false, clockLeft: SHOT_CLOCK_TICKS });
    step(s, [{ t: "set", seat: 0 }]);
    expect(snapshot(s)).toMatchObject({ set: true, clockRunning: true, clockLeft: SHOT_CLOCK_TICKS });
    // a second set doesn't restart it
    for (let i = 0; i < 60; i++) step(s, []);
    step(s, [{ t: "set", seat: 0 }]);
    expect(snapshot(s).clockLeft).toBe(SHOT_CLOCK_TICKS - 61);
    const ev = [];
    for (let i = 0; i < SHOT_CLOCK_TICKS && s.phase === "aim"; i++) ev.push(...step(s, []));
    expect(ev.find((e) => e.type === "basket")).toMatchObject({ seat: 0, made: false, points: 0, lost: "time" });
    expect(s.attempts[0]).toBe(1);
  });

  it("starts 5 s into the turn when no set comes, so a turn lasts at most 20 s", () => {
    const s = createState(3);
    let ticks = 0;
    while (s.phase === "aim") {
      step(s, []);
      ticks++;
      if (ticks === AUTO_CLOCK_TICKS) expect(snapshot(s).clockRunning).toBe(true);
    }
    expect(ticks).toBe(AUTO_CLOCK_TICKS + SHOT_CLOCK_TICKS);
    expect(s.last).toMatchObject({ lost: "time", made: false });
  });

  it("a shot after the buzzer counts only within the seat's grace (its round trip, capped at 150 ms)", () => {
    const atBuzzer = () => {
      const s = createState(3);
      step(s, [{ t: "set", seat: 0 }]);
      for (let i = 0; i < SHOT_CLOCK_TICKS - 1; i++) step(s, []);
      return s;
    };
    // no grace: a shot on the buzzer's tick is lost
    const none = atBuzzer();
    step(none, [{ t: "shoot", seat: 0, power: swish(none), aim: 0, at: 0 }]);
    expect(none.last).toMatchObject({ lost: "time" });
    // 5 ticks of grace: the buzzer's tick and the 4 after it still take a
    // shot; on the 5th after it the turn is lost
    const late = atBuzzer();
    setLag(late, 0, 5);
    for (let i = 0; i < 4; i++) step(late, []);
    expect(late.phase).toBe("aim");
    step(late, [{ t: "shoot", seat: 0, power: swish(late), aim: 0, at: 0 }]);
    expect(late.phase).toBe("flight");
    const tooLate = atBuzzer();
    setLag(tooLate, 0, 5);
    for (let i = 0; i < 5; i++) step(tooLate, []);
    expect(tooLate.phase).toBe("aim");
    step(tooLate, [{ t: "shoot", seat: 0, power: swish(tooLate), aim: 0, at: 0 }]);
    expect(tooLate.last).toMatchObject({ lost: "time" });
    // the grace is capped
    const capped = createState(3);
    setLag(capped, 0, 100);
    expect(capped.lag[0]).toBe(MAX_LATE_TICKS);
    setLag(capped, 1, Number.NaN);
    expect(capped.lag[1]).toBe(0);
    // and the snapshot never shows anyone's lag
    expect(Object.keys(snapshot(capped))).not.toContain("lag");
  });
});

describe("basketball tie vote and sudden death", () => {
  /** Both seats shoot the same at every spot, so it's level after five: the vote. */
  function level(seed = 5): BasketballState {
    const s = createState(seed);
    playSpots(s, swish, swish);
    expect(s.phase).toBe("tie-vote");
    expect(s.totals[0]).toBe(s.totals[1]);
    return s;
  }
  /** Both seats vote to play on. */
  function playOn(s: BasketballState): void {
    step(s, [
      { t: "tie", seat: 0, choice: "continue" },
      { t: "tie", seat: 1, choice: "continue" },
    ]);
  }

  it("a level shootout asks both players; the snapshot shows the votes and the vote clock", () => {
    const s = level();
    expect(snapshot(s).vote).toEqual({ votes: [null, null], ticksLeft: VOTE_TICKS });
    expect(snapshot(s).draw).toBe(false);
    step(s, [{ t: "tie", seat: 1, choice: "continue" }]);
    expect(snapshot(s)).toMatchObject({ phase: "tie-vote", vote: { votes: [null, "continue"], ticksLeft: VOTE_TICKS - 1 } });
  });

  it("either seat choosing draw ends it as a draw, with no winner", () => {
    for (const seat of [0, 1] as const) {
      const s = level();
      const ev = step(s, [{ t: "tie", seat, choice: "draw" }]);
      expect(ev).toContainEqual({ type: "tieVote", votes: seat === 0 ? ["draw", null] : [null, "draw"] });
      expect(ev).toContainEqual({ type: "match", winner: null, draw: true, score: [s.totals[0], s.totals[1]] });
      expect(snapshot(s)).toMatchObject({ phase: "over", winner: null, draw: true, vote: null });
      expect(basketballFrom(s).finished()).toEqual({ winner: null, score: [s.totals[0], s.totals[1]], format: "shootout" });
    }
    // one continue and one draw is still a draw
    const s = level();
    step(s, [{ t: "tie", seat: 0, choice: "continue" }]);
    step(s, [{ t: "tie", seat: 1, choice: "draw" }]);
    expect(s).toMatchObject({ phase: "over", draw: true, winner: null });
  });

  it("no vote within 15 s counts as draw", () => {
    const s = level();
    step(s, [{ t: "tie", seat: 0, choice: "continue" }]);
    for (let i = 1; i < VOTE_TICKS - 1; i++) step(s, []);
    expect(s.phase).toBe("tie-vote");
    step(s, []);
    expect(s).toMatchObject({ phase: "over", draw: true, winner: null });
  });

  it("ignores a second vote, a vote out of the vote, and a malformed one", () => {
    // before the vote: nothing happens
    const early = createState(5);
    step(early, [{ t: "tie", seat: 0, choice: "draw" }]);
    expect(early.phase).toBe("aim");
    expect(early.votes).toEqual([null, null]);
    // a seat's first vote stands
    const s = level();
    step(s, [{ t: "tie", seat: 0, choice: "continue" }]);
    step(s, [{ t: "tie", seat: 0, choice: "draw" }]);
    expect(s.phase).toBe("tie-vote");
    expect(s.votes).toEqual(["continue", null]);
    // malformed votes never reach the sim
    for (const junk of [{ t: "tie" }, { t: "tie", choice: "win" }, { t: "tie", choice: "draw", seat: 1 }, { t: "tie", choice: "draw", extra: 1 }]) {
      expect(asInput(1, junk)).toBeNull();
    }
    expect(asInput(1, { t: "tie", choice: "draw" })).toEqual({ t: "tie", seat: 1, choice: "draw" });
    // after the match: nothing happens
    step(s, [{ t: "tie", seat: 1, choice: "draw" }]);
    expect(s.phase).toBe("over");
    step(s, [{ t: "tie", seat: 1, choice: "continue" }]);
    expect(s).toMatchObject({ phase: "over", draw: true });
  });

  it("the bot votes continue after 1 s, and never off the vote", () => {
    const s = level();
    for (let i = 0; i < BOT_VOTE_TICK; i++) {
      expect(botInputs(s, 1)).toEqual([]);
      step(s, []);
    }
    expect(botInputs(s, 1)).toEqual([{ t: "tie", seat: 1, choice: "continue" }]);
    step(s, botInputs(s, 1));
    expect(s.votes).toEqual([null, "continue"]);
    expect(botInputs(s, 1)).toEqual([]);
    // through the adapter: the wire shape, which the closed asInput takes
    const t = level();
    const g = basketballFrom(t);
    for (let i = 0; i <= BOT_VOTE_TICK; i++) g.step(g.botInputs(1).map((input) => ({ seat: 1 as Seat, input })));
    expect((g.snapshot() as BasketballSnapshot).vote!.votes).toEqual([null, "continue"]);
  });

  it("both continue: a sudden-death round from the deep spot; a make against a miss wins, not added to the score", () => {
    const s = level();
    playOn(s);
    expect(s.phase).toBe("aim");
    expect(s.suddenDeath).toBe(true);
    expect(s.spot).toBe(DEEP_SPOT);
    expect(s.turn).toBe(1); // round 5: the first shooter keeps alternating
    const before: [number, number] = [s.totals[0], s.totals[1]];
    toTurn(s);
    shoot(s, miss(DEEP_SPOT));
    for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
    toTurn(s);
    expect(s.turn).toBe(0);
    expect(shoot(s, powerFor(DEEP_SPOT, "swish"))).toMatchObject({ made: true, suddenDeath: true, points: 5 });
    for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    expect(s.totals).toEqual(before);
    expect(s.attempts).toEqual([5, 5]);
  });

  it("a level sudden-death round (both make or both miss) votes again, the first shooter alternating", () => {
    const s = level();
    const firsts: Seat[] = [];
    for (let round = 0; round < 3; round++) {
      playOn(s);
      toTurn(s);
      firsts.push(s.turn);
      const p = round === 1 ? powerFor(DEEP_SPOT, "swish") : miss(DEEP_SPOT);
      shoot(s, p);
      for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
      toTurn(s);
      shoot(s, p);
      for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
      expect(s.phase).toBe("tie-vote");
      expect(snapshot(s).vote).toEqual({ votes: [null, null], ticksLeft: VOTE_TICKS });
    }
    expect(firsts).toEqual([1, 0, 1]);
    // and a draw then ends it
    step(s, [{ t: "tie", seat: 0, choice: "draw" }]);
    expect(s).toMatchObject({ phase: "over", draw: true, winner: null });
  });

  it("unlimited never votes and never ends", () => {
    const s = createState(5, { format: "unlimited", endless: true });
    for (let i = 0; i < 10; i++) {
      toTurn(s);
      shoot(s, swish(s));
      for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
      expect(s.phase).not.toBe("tie-vote");
    }
    expect(basketballFrom(s).finished()).toBeNull();
  });
});

describe("basketball unlimited", () => {
  it("draws a seeded spot each turn, the seats taking turns; counts points, makes and the longest make; never ends", () => {
    const s = createState(11, { format: "unlimited", endless: true });
    const spots: number[] = [];
    const seats: Seat[] = [];
    for (let i = 0; i < 12; i++) {
      toTurn(s);
      spots.push(s.spot);
      seats.push(s.turn);
      shoot(s, swish(s));
      for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
    }
    expect(new Set(spots).size).toBeGreaterThan(2);
    expect(seats).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(s.phase).not.toBe("over");
    expect(s.winner).toBeNull();
    expect(s.makes).toEqual([6, 6]);
    const pts = (seat: Seat) => s.shots.filter((b) => b.seat === seat).reduce((n, b) => n + b.points, 0);
    expect(s.totals).toEqual([pts(0), pts(1)]);
    expect(s.longest[0]).toBe(Math.max(...s.shots.filter((b) => b.seat === 0).map((b) => b.distance)));
    expect(basketballFrom(s).finished()).toBeNull();
    // the same seed draws the same spots
    const t = createState(11, { format: "unlimited", endless: true });
    const again: number[] = [];
    for (let i = 0; i < 12; i++) {
      toTurn(t);
      again.push(t.spot);
      shoot(t, swish(t));
      for (let j = 0; j < RESULT_TICKS + 1 && t.phase === "result"; j++) step(t, []);
    }
    expect(again).toEqual(spots);
  });
});

describe("basketball messages", () => {
  it("accepts exactly set, aim and shoot with finite numbers; the seat comes from the connection", () => {
    expect(asInput(1, { t: "set" })).toEqual({ t: "set", seat: 1 });
    expect(asInput(0, { t: "aim", aim: -0.3 })).toEqual({ t: "aim", seat: 0, aim: -0.3 });
    expect(asInput(0, { t: "shoot", power: 0.4, aim: 0.1, at: 1234 })).toEqual({ t: "shoot", seat: 0, power: 0.4, aim: 0.1, at: 1234 });
    // out-of-range numbers pass here; the sim clamps them
    expect(asInput(0, { t: "shoot", power: 7, aim: -3, at: 0 })).toEqual({ t: "shoot", seat: 0, power: 7, aim: -3, at: 0 });
  });

  it("drops anything else, or any extra field, whole", () => {
    const junk: unknown[] = [
      null,
      42,
      "shoot",
      [],
      { t: "set", ready: true },
      { t: "set", seat: 0 },
      { t: "aim" },
      { t: "aim", aim: "left" },
      { t: "aim", aim: Number.NaN },
      { t: "aim", aim: 0.1, power: 1 },
      { t: "aim", yaw: 0.1, pitch: 0, draw: 1 },
      { t: "shoot", power: 0.5, aim: 0 },
      { t: "shoot", power: 0.5, aim: 0, at: Infinity },
      { t: "shoot", power: "0.5", aim: 0, at: 0 },
      { t: "shoot", power: 0.5, aim: 0, at: 0, made: true },
      { t: "shoot", power: 0.5, aim: 0, at: 0, points: 5 },
      { t: "release", yaw: 0, pitch: 0, draw: 1 },
      { t: "score", seat: 0, points: 4 },
    ];
    for (const j of junk) expect(asInput(0, j)).toBeNull();
    // and through the game: a junk shot does nothing
    const g = basketball.create(1);
    const before = g.snapshot() as BasketballSnapshot;
    g.step([{ seat: 0, input: { t: "shoot", power: 0.3, aim: 0, at: 0, made: true } }]);
    expect((g.snapshot() as BasketballSnapshot).phase).toBe("aim");
    expect((g.snapshot() as BasketballSnapshot).tick).toBe(before.tick + 1);
  });
});

describe("basketball determinism", () => {
  it("the same seed and inputs give the same game, and identical shots identical results", () => {
    const run = () => {
      const s = createState(99);
      playMatch(s, (st) => [0.3, 0.5, 0.66, 0.72, 0.87][st.spot] + (st.turn === 0 ? 0.004 : -0.02));
      return snapshot(s);
    };
    expect(run()).toEqual(run());
    const a = createState(1);
    const b = createState(2);
    expect(shoot(a, 0.61, 0.2)).toEqual(shoot(b, 0.61, 0.2));
    expect(snapshot(a).path).toEqual(snapshot(b).path);
  });

  it("the snapshot holds what a view needs: phase, spot, turn, clock, scores, the ball and its path, the window", () => {
    const s = createState(1);
    step(s, [{ t: "set", seat: 0 }]);
    step(s, [{ t: "shoot", seat: 0, power: swish(s), aim: 0, at: 0 }]);
    for (let i = 0; i < 20; i++) step(s, []);
    const snap = snapshot(s);
    expect(snap).toMatchObject({ phase: "flight", spot: 0, turn: 0, round: 0, suddenDeath: false, totals: [0, 0], window: makeWindow(0) });
    expect(snap.ball).not.toBeNull();
    expect(snap.release).toEqual({ power: swish(s), aim: 0 });
    expect(snap.path.length).toBeGreaterThan(5);
    expect(snap.path[0].y).toBeCloseTo(2.2, 1);
    // plain JSON: it survives the wire unchanged
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});

describe("basketball bot", () => {
  it("never shoots off its turn, and shoots once on its turn after getting set", () => {
    const s = createState(4);
    expect(botInputs(s, 1)).toEqual([]);
    for (let i = 0; i < BOT_SHOOT_TICK + 5; i++) {
      expect(botInputs(s, 1)).toEqual([]);
      step(s, botInputs(s, 0));
    }
    expect(s.phase).toBe("flight");
  });

  it("through the adapter its messages are the wire shape, so the closed asInput takes them", () => {
    const g = basketball.create(4);
    let sent: unknown[] = [];
    for (let i = 0; i < BOT_SHOOT_TICK + 5; i++) {
      const out = g.botInputs(0);
      sent = sent.concat(out);
      g.step(out.map((input) => ({ seat: 0, input })));
    }
    expect(sent.every((m) => asInput(0, m) !== null)).toBe(true);
    expect(sent.some((m) => (m as { t: string }).t === "shoot")).toBe(true);
    expect((g.snapshot() as BasketballSnapshot).phase).toBe("flight");
  });

  it("aims inside the window with noise: near spots mostly drop, the deep spot rarely", () => {
    const made = SPOTS.map(() => 0);
    const tries = 60;
    for (let seed = 1; seed <= tries; seed++) {
      for (let spot = 0; spot < SPOTS.length; spot++) {
        const s = createState(seed * 7919);
        s.spot = spot;
        s.round = spot;
        let out = [] as ReturnType<typeof step>;
        for (let i = 0; i < 1000 && !out.some((e) => e.type === "basket"); i++) out = step(s, botInputs(s, 0));
        if (s.last!.made) made[spot]++;
      }
    }
    expect(made[0] / tries).toBeGreaterThan(0.5);
    expect(made[DEEP_SPOT] / tries).toBeLessThan(made[0] / tries);
    expect(made[DEEP_SPOT] / tries).toBeLessThan(0.7);
  });

  it("is beatable: a player who swishes every shot beats it over many seeded games", () => {
    let wins = 0;
    let botPoints = 0;
    const games = 20;
    for (let seed = 1; seed <= games; seed++) {
      const s = createState(seed * 104729);
      for (let i = 0; i < 4000 && s.phase !== "over"; i++) {
        const inputs = s.phase === "aim" && s.turn === 0 && s.phaseTick === 20 ? [{ t: "shoot" as const, seat: 0 as Seat, power: swish(s), aim: 0, at: 0 }] : botInputs(s, 1);
        step(s, inputs);
      }
      expect(s.phase).toBe("over");
      if (s.winner === 0) wins++;
      botPoints += s.totals[1];
    }
    expect(wins).toBeGreaterThanOrEqual(games - 1);
    // and it isn't a pushover either: it scores
    expect(botPoints / games).toBeGreaterThan(4);
  });
});
