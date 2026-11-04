import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { matchCountFor as countFor, pruneSessions, seedDemoAccounts } from "./accounts.ts";
import { ratingOf, recordResult } from "./ratings.ts";
import { migrate } from "./schema.ts";
import type { MatchRecord } from "./schema.ts";

export type { MatchRecord } from "./schema.ts";

const dir = process.env.DATA_DIR ?? (existsSync("/data") ? "/data" : "./data");
mkdirSync(dir, { recursive: true });

/** The app's one database. Accounts (accounts.ts) and matches live here. */
export const db = new DatabaseSync(join(dir, "app.db"));
db.exec("PRAGMA journal_mode = WAL;");
migrate(db);
// the two locked demo accounts (task 17); safe to run on every boot
seedDemoAccounts(db);
pruneSessions(db);
setInterval(() => pruneSessions(db), 60 * 60 * 1000).unref();

/** Stores a finished match; a rated one moves both ratings in the same transaction (task 7). */
export function recordMatch(m: MatchRecord): void {
  recordResult(db, m);
}

/** A player's rating in a sport, for the ready panel. */
export function currentRating(token: string, sport: string): number {
  return ratingOf(db, token, sport).rating;
}

export function matchCountFor(token: string): number {
  return countFor(db, token);
}
