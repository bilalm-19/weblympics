import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { matchCountFor as countFor, pruneSessions, seedDemoAccounts } from "./accounts.ts";
import { insertMatch, migrate } from "./schema.ts";
import type { MatchRecord } from "./schema.ts";

export type { MatchRecord } from "./schema.ts";

const dir = process.env.DATA_DIR ?? (existsSync("/data") ? "/data" : "./data");
mkdirSync(dir, { recursive: true });

/** How long a write waits for another process's lock before giving up, ms. */
export const LOCK_WAIT_MS = 5000;

/**
 * Opens a database file. Several processes open the same one (the server,
 * and test workers that import this module), so a write waits for another's
 * lock instead of failing at once with "database is locked".
 */
export function openDatabase(file: string, lockWaitMs = LOCK_WAIT_MS): DatabaseSync {
  const d = new DatabaseSync(file, { timeout: lockWaitMs });
  d.exec("PRAGMA journal_mode = WAL;");
  return d;
}

/** The app's one database. Accounts (accounts.ts) and matches live here. */
export const db = openDatabase(join(dir, "app.db"));
migrate(db);
// the two locked demo accounts (task 17); safe to run on every boot
seedDemoAccounts(db);
pruneSessions(db);
setInterval(() => pruneSessions(db), 60 * 60 * 1000).unref();

/** Stores a finished match. */
export function recordMatch(m: MatchRecord): void {
  insertMatch(db, m);
}

export function matchCountFor(token: string): number {
  return countFor(db, token);
}
