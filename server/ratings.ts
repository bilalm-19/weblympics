// Ratings, leaderboards and match history (task 7). Elo per account per
// sport: everyone starts at 1000, K = 32, updated when a rated match ends, in
// the same transaction as its match row. Only `rated = 1` rows ever move a
// rating; `recomputeRatings` rebuilds every rating from those rows in order
// (after an admin removes a match, say). Pure over a db handle, so a test
// can run it on a throwaway file (spec/ratings.test.ts).
import type { DatabaseSync } from "node:sqlite";
import { DELETED_NAME, isTombstone } from "./accounts.ts";
import { insertMatch, parseSetsColumn } from "./schema.ts";
import type { MatchRecord } from "./schema.ts";

export const START_RATING = 1000;
export const K = 32;
/** No rating goes below this, so a run of losses can't sink a new player out of sight. */
export const FLOOR = 100;

/**
 * Elo: A's expected score is E = 1 / (1 + 10^((Rb - Ra) / 400)); after the
 * match A moves by K * (S - E), S = 1 for a win and 0 for a loss, and B by
 * the opposite amount. Rounded to whole points (half away from zero). The
 * loser never drops below FLOOR (applied where the ratings are stored).
 */
export function eloChange(winner: number, loser: number, k = K): number {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  const delta = k * (1 - expected);
  return Math.sign(delta) * Math.round(Math.abs(delta));
}

interface RatingRow {
  rating: number;
  wins: number;
  losses: number;
}

export function ratingOf(db: DatabaseSync, player: string, sport: string): RatingRow {
  const r = db.prepare("SELECT rating, wins, losses FROM ratings WHERE player = ? AND sport = ?").get(player, sport) as RatingRow | undefined;
  return r ?? { rating: START_RATING, wins: 0, losses: 0 };
}

function apply(db: DatabaseSync, sport: string, winner: string, loser: string, now: number): { winner: number; loser: number; delta: number } {
  const w = ratingOf(db, winner, sport);
  const l = ratingOf(db, loser, sport);
  const delta = eloChange(w.rating, l.rating);
  const upsert = db.prepare(
    `INSERT INTO ratings (player, sport, rating, wins, losses, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (player, sport) DO UPDATE SET rating = excluded.rating, wins = excluded.wins, losses = excluded.losses, updated_at = excluded.updated_at`,
  );
  upsert.run(winner, sport, w.rating + delta, w.wins + 1, w.losses, now);
  const lost = Math.max(FLOOR, l.rating - delta);
  upsert.run(loser, sport, lost, l.wins, l.losses + 1, now);
  return { winner: w.rating + delta, loser: lost, delta };
}

/**
 * Stores a finished match and, if it is rated, moves both players' rating in
 * its sport, all in one transaction. Returns the rating change if it moved.
 */
export function recordResult(db: DatabaseSync, m: MatchRecord, now = Date.now()): { rated: boolean; delta: number } {
  db.exec("BEGIN");
  try {
    const rated = insertMatch(db, m, now);
    let delta = 0;
    if (rated && m.winner !== null) {
      const winner = m.tokens[m.winner]!;
      const loser = m.tokens[m.winner === 0 ? 1 : 0]!;
      delta = apply(db, m.game, winner, loser, now).delta;
    }
    db.exec("COMMIT");
    return { rated, delta };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Rebuilds every rating from the rated match rows, oldest first. */
export function recomputeRatings(db: DatabaseSync, now = Date.now()): void {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM ratings");
    const rows = db.prepare("SELECT game, p0, p1, winner FROM matches WHERE rated = 1 AND winner IS NOT NULL ORDER BY ended_at, id").all() as {
      game: string;
      p0: string;
      p1: string;
      winner: 0 | 1;
    }[];
    for (const r of rows) {
      const winner = r.winner === 0 ? r.p0 : r.p1;
      const loser = r.winner === 0 ? r.p1 : r.p0;
      // a deleted player's side keeps no rating, but the opponent's result stands
      apply(db, r.game, winner, loser, now);
    }
    db.exec("DELETE FROM ratings WHERE player LIKE 'deleted:%'");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface BoardRow {
  rank: number;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  you: boolean;
}

export interface Board {
  sport: string;
  top: BoardRow[];
  /** Your own row, even outside the top list; null if you have no rated match in this sport (or are a guest). */
  you: BoardRow | null;
  /** Changes whenever the board does, so a page can poll cheaply. */
  version: number;
}

// who is on the public board: accounts, not demo ones, with a rated match here
const LISTED = "p.account = 1 AND p.demo = 0";

/**
 * A sport's leaderboard: accounts only (never guests), demo accounts hidden,
 * by rating then wins. Ties share a rank. `viewer` gets their own row and
 * rank, even a demo account (whose rank is where it would be).
 */
export function leaderboard(db: DatabaseSync, sport: string, viewer: string | null, limit = 20): Board {
  const rows = db
    .prepare(
      `SELECT r.player, p.name, r.rating, r.wins, r.losses FROM ratings r JOIN players p ON p.token = r.player
       WHERE r.sport = ? AND ${LISTED} ORDER BY r.rating DESC, r.wins DESC, lower(p.name) LIMIT ?`,
    )
    .all(sport, limit) as { player: string; name: string; rating: number; wins: number; losses: number }[];
  const rankOf = (rating: number) =>
    1 + (db.prepare(`SELECT COUNT(*) AS n FROM ratings r JOIN players p ON p.token = r.player WHERE r.sport = ? AND ${LISTED} AND r.rating > ?`).get(sport, rating) as { n: number }).n;
  const top = rows.map((r) => ({ rank: rankOf(r.rating), name: r.name, rating: r.rating, wins: r.wins, losses: r.losses, you: r.player === viewer }));
  let you: BoardRow | null = null;
  if (viewer) {
    const mine = db
      .prepare("SELECT p.name, r.rating, r.wins, r.losses FROM ratings r JOIN players p ON p.token = r.player WHERE r.sport = ? AND r.player = ? AND p.account = 1")
      .get(sport, viewer) as { name: string; rating: number; wins: number; losses: number } | undefined;
    if (mine) you = { rank: rankOf(mine.rating), name: mine.name, rating: mine.rating, wins: mine.wins, losses: mine.losses, you: true };
  }
  const v = db.prepare("SELECT COALESCE(MAX(updated_at), 0) AS t, COUNT(*) AS n FROM ratings WHERE sport = ?").get(sport) as { t: number; n: number };
  return { sport, top, you, version: v.t * 1000 + v.n };
}

export interface HistoryRow {
  endedAt: number;
  sport: string;
  format: string;
  opponent: string;
  /** "won" | "lost" | "none" (unlimited, no winner) */
  result: "won" | "lost" | "none";
  score: [number, number];
  sets: Array<[number, number]>;
  rated: boolean;
  practice: boolean;
  bestRally: number | null;
}

/** A player's recent matches, newest first; a deleted opponent shows as "Deleted player", a guest by their pseudonym. */
export function history(db: DatabaseSync, player: string, limit = 20): HistoryRow[] {
  const rows = db
    .prepare(
      `SELECT m.game, m.format, m.p0, m.p1, m.winner, m.score0, m.score1, m.sets, m.rated, m.practice, m.best_rally, m.ended_at,
              p0.name AS n0, p1.name AS n1
       FROM matches m LEFT JOIN players p0 ON p0.token = m.p0 LEFT JOIN players p1 ON p1.token = m.p1
       WHERE m.p0 = ? OR m.p1 = ? ORDER BY m.ended_at DESC, m.id DESC LIMIT ?`,
    )
    .all(player, player, limit) as {
    game: string;
    format: string;
    p0: string | null;
    p1: string | null;
    winner: 0 | 1 | null;
    score0: number;
    score1: number;
    sets: string;
    rated: number;
    practice: number;
    best_rally: number | null;
    ended_at: number;
    n0: string | null;
    n1: string | null;
  }[];
  return rows.map((r) => {
    const me = r.p0 === player ? 0 : 1;
    const them = me === 0 ? 1 : 0;
    const token = them === 0 ? r.p0 : r.p1;
    const name = them === 0 ? r.n0 : r.n1;
    const opponent = r.practice ? "Bot" : isTombstone(token) ? DELETED_NAME : (name ?? (token ? DELETED_NAME : "Nobody"));
    // task 27: a track row's column is an object holding the detail and the sets
    const sets = parseSetsColumn(r.sets).sets.map(([a, b]) => (me === 0 ? [a, b] : [b, a]) as [number, number]);
    return {
      endedAt: r.ended_at,
      sport: r.game,
      format: r.format,
      opponent,
      result: r.winner === null ? "none" : r.winner === me ? "won" : "lost",
      score: me === 0 ? [r.score0, r.score1] : [r.score1, r.score0],
      sets,
      rated: r.rated === 1,
      practice: r.practice === 1,
      bestRally: r.best_rally,
    };
  });
}

/** The longest rally (shots) a player has been in, any sport, any match. */
export function longestRally(db: DatabaseSync, player: string): number {
  const r = db.prepare("SELECT MAX(best_rally) AS n FROM matches WHERE p0 = ? OR p1 = ?").get(player, player) as { n: number | null };
  return r.n ?? 0;
}
