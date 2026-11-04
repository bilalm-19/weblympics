// Task 16: the call across the top after each point, in tennis words, and who
// reacts. Every row is a real transition through the scoring module
// (pointWon / fault), put into the snapshots the server sends.
import { describe, expect, it } from "vitest";
import { gameCall, pointCall, reactions } from "../client/games/tennis/point-call.ts";
import type { PointCall } from "../client/games/tennis/point-call.ts";
import { createScore, fault, pointWon } from "../shared/games/tennis/scoring.ts";
import type { ScoreState } from "../shared/games/tennis/scoring.ts";
import { createState, snapshot } from "../shared/games/tennis/sim.ts";
import type { PointReason, Seat, TennisSnapshot } from "../shared/games/tennis/sim.ts";

const NAMES = ["You", "Bot"] as const;
const name = (s: Seat) => NAMES[s];

function snap(score: ScoreState, tick: number, lastCall: TennisSnapshot["lastCall"], over = false, endless = false): TennisSnapshot {
  const s = snapshot(createState(1, { endless }));
  return { ...s, tick, score, lastCall, phase: over ? "over" : "serve", winner: over ? score.winner : null };
}

/** The score after `seq` points (each the winning seat), from 0-0 with `server` serving. */
function play(seq: Seat[], server: Seat = 0, format: ScoreState["format"] = "oneSet"): ScoreState {
  return seq.reduce((s, w) => pointWon(s, w), createScore(format, server));
}

/** The call for `winner` taking one more point from `from`. */
function callFor(from: ScoreState, winner: Seat, reason: PointReason = "unreturned", opts: { endless?: boolean } = {}): PointCall {
  const to = pointWon(from, winner);
  const over = to.winner !== null && !opts.endless;
  const prev = snap(from, 10, null, false, opts.endless);
  const next = snap(to, 11, { call: "point", seat: winner, reason, tick: 11 }, over, opts.endless);
  const c = pointCall(prev, next, name);
  expect(c).not.toBeNull();
  return c!;
}

const rep = (n: number, s: Seat): Seat[] => Array(n).fill(s);

describe("the call after each point, server's score first", () => {
  // [points before (winner of each), who wins the next one, expected call]; seat 0 serves
  const table: [string, Seat[], Seat, string][] = [
    ["love-15 the other way", [], 1, "Love-15"],
    ["15-Love", [], 0, "15-Love"],
    ["15-all", [0], 1, "15-all"],
    ["30-15", [0, 1], 0, "30-15"],
    ["30-all", [0, 1, 0], 1, "30-all"],
    ["40-30", [0, 1, 0, 1], 0, "40-30"],
    ["40-Love", [0, 0], 0, "40-Love"],
    ["Love-40", [1, 1], 1, "Love-40"],
    ["15-40", [1, 1, 1], 0, "15-40"],
    ["Deuce at 40-40", [0, 0, 0, 1, 1], 1, "Deuce"],
    ["Advantage server", [0, 0, 0, 1, 1, 1], 0, "Advantage You"],
    ["Advantage receiver", [0, 0, 0, 1, 1, 1], 1, "Advantage Bot"],
    ["back to Deuce", [0, 0, 0, 1, 1, 1, 0], 1, "Deuce"],
    ["Game from 40-Love", [0, 0, 0], 0, "Game"],
    ["Game from advantage", [0, 0, 0, 1, 1, 1, 1], 1, "Game"],
  ];
  for (const [label, before, winner, expected] of table) {
    it(`${label}: "${expected}"`, () => {
      expect(callFor(play(before), winner).call).toBe(expected);
    });
  }

  it("calls the server's score first when seat 1 serves", () => {
    expect(callFor(play([], 1), 0).call).toBe("Love-15");
    expect(callFor(play([1], 1), 1).call).toBe("30-Love");
  });

  it("calls a tiebreak in numbers, server first, with all for a tie", () => {
    // 6-6 in games: alternate whole games
    let s = createScore("oneSet", 0);
    for (let g = 0; g < 12; g++) s = rep(4, (g % 2) as Seat).reduce((x, w) => pointWon(x, w), s);
    expect(s.tiebreak).toBe(true);
    const first = s.server;
    const other: Seat = first === 0 ? 1 : 0;
    // the first server wins point one; the serve then passes, so "0-1" from the new server
    expect(callFor(s, first).call).toBe("0-1");
    const s1 = pointWon(s, first);
    expect(s1.server).toBe(other);
    expect(callFor(s1, other).call).toBe("1-all");
    // other goes 2-1 up; after three points the first server serves again, so their 1 comes first
    const s2 = pointWon(s1, other);
    const c3 = callFor(s2, other);
    expect(pointWon(s2, other).server).toBe(first);
    expect(c3.call).toBe("1-2");
  });

  it("Set and match", () => {
    // 5-0 in games, 40-0: the next point wins the set and (one set) the match
    let s = createScore("bestOfThree", 0);
    for (let g = 0; g < 5; g++) s = rep(4, 0).reduce((x, w) => pointWon(x, w), s);
    // game 6 goes to seat 0 whoever serves
    s = rep(3, 0).reduce((x, w) => pointWon(x, w), s);
    const set = callFor(s, 0);
    expect(set).toMatchObject({ kind: "set", call: "Set", detail: "You win the set", weight: 2 });

    let one = createScore("oneSet", 0);
    for (let g = 0; g < 5; g++) one = rep(4, 1).reduce((x, w) => pointWon(x, w), one);
    one = rep(3, 1).reduce((x, w) => pointWon(x, w), one);
    expect(callFor(one, 1)).toMatchObject({ kind: "match", call: "Game, set, match", detail: "Bot wins the match", weight: 3 });
    // practice: the sim restarts the match, and the drop in sets still reads as the match won
    expect(callFor(one, 1, "unreturned", { endless: true }).kind).toBe("match");
  });

  it("a game is a bigger moment than a point, and says who won it", () => {
    expect(callFor(play([0, 0, 0]), 0)).toMatchObject({ kind: "game", weight: 1, detail: "You win the game" });
    expect(callFor(play([]), 1)).toMatchObject({ kind: "point", weight: 0, detail: "Bot wins the point" });
  });
});

describe("faults", () => {
  it("a first fault is called Fault, and nobody reacts", () => {
    const from = play([]);
    const prev = snap(from, 10, null);
    const next = snap(fault(from), 11, { call: "fault", seat: 0, reason: "net", tick: 11 });
    const c = pointCall(prev, next, name)!;
    expect(c).toMatchObject({ kind: "fault", call: "Fault", winner: null });
    expect(reactions(c)).toEqual([]);
  });

  it("a double fault is called, with the score it leaves underneath", () => {
    const from = fault(play([0]));
    const to = fault(from);
    expect(to.points).toEqual([1, 1]);
    const c = pointCall(snap(from, 10, null), snap(to, 11, { call: "point", seat: 1, reason: "double fault", tick: 11 }), name)!;
    expect(c).toMatchObject({ kind: "double fault", call: "Double fault", detail: "15-all", winner: 1, loser: 0 });
  });
});

describe("one call per server call", () => {
  it("the same lastCall tick is not called twice, and the first snapshot calls nothing", () => {
    const s = play([0]);
    const lc = { call: "point" as const, seat: 0 as Seat, reason: "unreturned" as PointReason, tick: 5 };
    expect(pointCall(snap(s, 5, lc), snap(s, 6, lc), name)).toBeNull();
    expect(pointCall(null, snap(s, 6, lc), name)).toBeNull();
    expect(pointCall(snap(s, 5, null), snap(s, 6, null), name)).toBeNull();
  });
});

describe("who reacts", () => {
  // the same for both seats, a bot point and a spectator: it depends only on the snapshot
  for (const [label, winner] of [["seat 0 (or the host) wins", 0], ["seat 1 (or the bot) wins", 1]] as const) {
    it(`${label}: the winner cheers and the loser is frustrated, as big as the moment`, () => {
      const p = callFor(play([]), winner);
      const loser = winner === 0 ? 1 : 0;
      expect(reactions(p)).toEqual([
        { seat: winner, reaction: "cheer", weight: 0 },
        { seat: loser, reaction: "frustrated", weight: 0 },
      ]);
      const g = callFor(play(rep(3, winner)), winner);
      expect(reactions(g).map((r) => r.weight)).toEqual([1, 1]);
    });
  }

  it("names only change the words, never who reacts (a spectator sees names, a player sees You)", () => {
    const from = play([]);
    const to = pointWon(from, 1);
    const prev = snap(from, 1, null);
    const next = snap(to, 2, { call: "point", seat: 1, reason: "out", tick: 2 });
    const player = pointCall(prev, next, name)!;
    const spectator = pointCall(prev, next, (s) => ["Ana", "Ben"][s])!;
    expect(reactions(player)).toEqual(reactions(spectator));
    expect(spectator.detail).toBe("Ben wins the point");
  });
});

describe("gameCall", () => {
  it("is Love-all at the start", () => {
    expect(gameCall(createScore("oneSet", 0), name)).toBe("Love-all");
  });
});
