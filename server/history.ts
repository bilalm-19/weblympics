// A player's match history and longest rally (reads over match rows; task 7
// made it, task 37 removed the ratings it used to sit beside). Pure over a db
// handle, so a test can run it on a throwaway file.
import type { DatabaseSync } from "node:sqlite";
import { DELETED_NAME, isTombstone } from "./accounts.ts";
import { parseSetsColumn } from "./schema.ts";

export interface HistoryRow {
  endedAt: number;
  sport: string;
  format: string;
  opponent: string;
  /** "won" | "lost" | "none" (unlimited, no winner) */
  result: "won" | "lost" | "none";
  score: [number, number];
  sets: Array<[number, number]>;
  practice: boolean;
  bestRally: number | null;
}

/** A player's recent matches, newest first; a deleted opponent shows as "Deleted player", a guest by their pseudonym. */
export function history(db: DatabaseSync, player: string, limit = 20): HistoryRow[] {
  const rows = db
    .prepare(
      `SELECT m.game, m.format, m.p0, m.p1, m.winner, m.score0, m.score1, m.sets, m.practice, m.best_rally, m.ended_at,
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
