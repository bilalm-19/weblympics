// What a score change means, worked out only from two server snapshots
// (task 16): the umpire's call in tennis words, who won and lost the point, and
// how big a moment it was. Pure, so the wording is table-tested
// (spec/point-call.test.ts), and shared by the banner, the players' reactions
// and (task 19) the crowd and the sounds. Nothing here is sent anywhere; the
// server stays the only owner of the score.
import type { ScoreState } from "../../../shared/games/tennis/scoring.ts";
import type { Seat, TennisSnapshot } from "../../../shared/games/tennis/sim.ts";

/** How big the moment is: 0 a point, 1 a game, 2 a set, 3 the match. */
export type Weight = 0 | 1 | 2 | 3;

export type CallKind = "fault" | "double fault" | "point" | "game" | "set" | "match";

export interface PointCall {
  kind: CallKind;
  /** The big line: "15-Love", "30-all", "Deuce", "Advantage Bot", "Game", "Set", "Game, set, match", "Fault". */
  call: string;
  /** The small line under it: who took it, or the score after a double fault. */
  detail: string;
  /** Who won the point; null for a first-serve fault (no point was played out). */
  winner: Seat | null;
  loser: Seat | null;
  weight: Weight;
  /** The server's tick for the call, so one call is never shown twice. */
  tick: number;
}

const WORDS = ["Love", "15", "30", "40"] as const;

/**
 * The umpire's call for the score as it stands after a point in a game (not
 * the point that ended a game: that is "Game"). Server's score first, love
 * for zero, "all" for ties, Deuce and Advantage from 40-40. A tiebreak is
 * called in plain numbers, server first.
 */
export function gameCall(score: ScoreState, name: (seat: Seat) => string): string {
  const s = score.server;
  const r: Seat = s === 0 ? 1 : 0;
  const ps = score.points[s];
  const pr = score.points[r];
  if (score.tiebreak) return ps === pr ? `${ps}-all` : `${ps}-${pr}`;
  if (ps >= 3 && pr >= 3) {
    if (ps === pr) return "Deuce";
    return `Advantage ${name(ps > pr ? s : r)}`;
  }
  if (ps === pr) return `${WORDS[ps]}-all`;
  return `${WORDS[ps]}-${WORDS[pr]}`;
}

/**
 * What the change from `prev` to `next` calls, or null if nothing new was
 * called (a new call is a new `lastCall` tick from the server).
 */
export function pointCall(prev: TennisSnapshot | null, next: TennisSnapshot, name: (seat: Seat) => string): PointCall | null {
  const lc = next.lastCall;
  if (!prev || !lc || lc.tick === prev.lastCall?.tick) return null;
  if (lc.call === "fault") {
    return { kind: "fault", call: "Fault", detail: "Second serve", winner: null, loser: null, weight: 0, tick: lc.tick };
  }
  const winner = lc.seat;
  const loser: Seat = winner === 0 ? 1 : 0;
  const a = prev.score;
  const b = next.score;
  const base = { winner, loser, tick: lc.tick };
  // practice starts a fresh match after one is won: a drop in sets is a match won
  const restarted = b.sets[0] + b.sets[1] < a.sets[0] + a.sets[1];
  let kind: CallKind;
  let weight: Weight;
  if (b.winner !== null || next.phase === "over" || restarted) [kind, weight] = ["match", 3];
  else if (b.sets[winner] !== a.sets[winner]) [kind, weight] = ["set", 2];
  else if (b.games[winner] !== a.games[winner]) [kind, weight] = ["game", 1];
  else [kind, weight] = ["point", 0];
  const won = (what: string) => `${name(winner)} ${name(winner) === "You" ? "win" : "wins"} the ${what}`;
  if (lc.reason === "double fault") {
    // the call is the fault; the score it leaves goes underneath
    const after = kind === "point" ? gameCall(b, name) : `${KIND_CALL[kind]} ${name(winner)}`;
    return { ...base, kind: "double fault", call: "Double fault", detail: after, weight };
  }
  if (kind === "point") return { ...base, kind, call: gameCall(b, name), detail: won("point"), weight };
  return { ...base, kind, call: KIND_CALL[kind], detail: won(kind), weight };
}

const KIND_CALL: Record<"game" | "set" | "match", string> = { game: "Game", set: "Set", match: "Game, set, match" };

export type Reaction = "cheer" | "frustrated";

/**
 * How each seat reacts to a call: the winner cheers, the loser is
 * frustrated, both as big as the moment. Nobody reacts to a first-serve
 * fault. The same for every screen (players and spectators), so the crowd
 * (task 19) can take its sides from it too.
 */
export function reactions(c: PointCall): { seat: Seat; reaction: Reaction; weight: Weight }[] {
  if (c.winner === null || c.loser === null) return [];
  return [
    { seat: c.winner, reaction: "cheer", weight: c.weight },
    { seat: c.loser, reaction: "frustrated", weight: c.weight },
  ];
}
