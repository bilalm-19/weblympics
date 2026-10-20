import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { matchCountFor as countFor, pruneSessions, seedDemoAccounts } from "./accounts.ts";
import { insertMatch, migrate } from "./schema.ts";
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

export function recordMatch(m: MatchRecord): void {
  insertMatch(db, m);
}

export function matchCountFor(token: string): number {
  return countFor(db, token);
}
