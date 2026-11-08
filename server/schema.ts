// The SQLite schema and its migrations. Kept apart from db.ts (which opens the
// real file on import) so a test can migrate a database it made itself.
import type { DatabaseSync } from "node:sqlite";

/**
 * Version 1: players, and matches with a first-to-5 point score.
 * Version 2: matches store real tennis results: score0/score1 become sets won,
 * plus the format, each set's games (JSON), whether it was a practice match,
 * and whether it counts towards ratings.
 * Version 3: unlimited matches (task 4) have no winner, so `winner` may be
 * NULL, and `best_rally` keeps the longest rally (shots). SQLite can't relax a
 * NOT NULL in place, so the table is rebuilt with every row kept.
 * Version 4 (task 17, accounts): a player row may be an account (claimed with
 * a passkey) or a locked demo account; accounts' names are unique ignoring
 * case. Passkeys (public keys only) and sessions (only a hash of the cookie)
 * get their own tables. The two demo players become locked demo accounts.
 * Version 5 (task 18): an account's look, as JSON of enum values from
 * shared/look.ts (validated before it is written); NULL means the default.
 * Version 6 (task 7): one Elo rating per account per sport (`ratings`, keyed
 * by player and sport id, so a new sport needs no schema change). The sport
 * of a match is its existing `game` column (the registry's id). Old rows
 * that were marked rated before accounts existed are marked unrated: they
 * were never between accounts, and ratings start from nothing.
 * Version 7 (task 33): looks get clothes styles, hairstyles apart from hats,
 * and a face. Every stored task-18 look ({shirt, shorts, skin, hair, style})
 * is rewritten in the new shape, as `fromTask18` in shared/look.ts does: the
 * shirt colour on a T-shirt, the shorts colour on shorts, a hat style becomes
 * that hat over short hair, a hair style stays, and the face is the default.
 * A stored value that isn't a task-18 look becomes NULL (the default).
 */
export const SCHEMA_VERSION = 7;

const V1 = `
  CREATE TABLE IF NOT EXISTS players (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    game TEXT NOT NULL,
    p0 TEXT,
    p1 TEXT,
    score0 INTEGER NOT NULL,
    score1 INTEGER NOT NULL,
    winner INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
  );
`;

// Version 1 rows keep their old first-to-5 points in score0/score1; format
// 'points5' marks them, and they are not rated (ratings never saw them).
const V2 = `
  ALTER TABLE matches ADD COLUMN format TEXT NOT NULL DEFAULT 'points5';
  ALTER TABLE matches ADD COLUMN sets TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE matches ADD COLUMN practice INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE matches ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;
`;

const V3 = `
  CREATE TABLE matches_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    game TEXT NOT NULL,
    p0 TEXT,
    p1 TEXT,
    score0 INTEGER NOT NULL,
    score1 INTEGER NOT NULL,
    winner INTEGER,
    ended_at INTEGER NOT NULL,
    format TEXT NOT NULL DEFAULT 'points5',
    sets TEXT NOT NULL DEFAULT '[]',
    practice INTEGER NOT NULL DEFAULT 0,
    rated INTEGER NOT NULL DEFAULT 0,
    best_rally INTEGER
  );
  INSERT INTO matches_v3 (id, room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated)
    SELECT id, room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated FROM matches;
  DROP TABLE matches;
  ALTER TABLE matches_v3 RENAME TO matches;
`;

const V4 = `
  ALTER TABLE players ADD COLUMN account INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN webauthn_id TEXT;
  UPDATE players SET account = 1, demo = 1 WHERE token IN ('demo-1', 'demo-2');
  CREATE UNIQUE INDEX players_account_name ON players (lower(name)) WHERE account = 1;
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    player TEXT NOT NULL,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX passkeys_player ON passkeys (player);
  CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    player TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_player ON sessions (player);
`;

const V5 = `
  ALTER TABLE players ADD COLUMN look TEXT;
`;

const V6 = `
  CREATE TABLE ratings (
    player TEXT NOT NULL,
    sport TEXT NOT NULL,
    rating INTEGER NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (player, sport)
  );
  CREATE INDEX ratings_board ON ratings (sport, rating DESC);
  CREATE INDEX matches_p0 ON matches (p0);
  CREATE INDEX matches_p1 ON matches (p1);
  UPDATE matches SET rated = 0;
`;

const V7 = `
  UPDATE players SET look = NULL
    WHERE look IS NOT NULL AND (json_valid(look) = 0 OR json_type(look) != 'object' OR json_type(look, '$.shirt') IS NOT 'text'
      OR json_type(look, '$.shorts') IS NOT 'text' OR json_type(look, '$.skin') IS NOT 'text'
      OR json_type(look, '$.hair') IS NOT 'text' OR json_type(look, '$.style') IS NOT 'text');
  UPDATE players SET look = json_object(
      'top', 'tee',
      'topColour', json_extract(look, '$.shirt'),
      'bottom', 'shorts',
      'bottomColour', json_extract(look, '$.shorts'),
      'skin', json_extract(look, '$.skin'),
      'hairColour', json_extract(look, '$.hair'),
      'hairStyle', CASE WHEN json_extract(look, '$.style') IN ('long', 'bun', 'bald') THEN json_extract(look, '$.style') ELSE 'short' END,
      'headwear', CASE WHEN json_extract(look, '$.style') IN ('cap', 'visor', 'headband') THEN json_extract(look, '$.style') ELSE 'none' END,
      'eyes', 'round',
      'brows', 'straight',
      'nose', 'small',
      'mouth', 'smile',
      'facialHair', 'none',
      'eyewear', 'none')
    WHERE look IS NOT NULL;
`;

export function schemaVersion(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  if (row) return row.version;
  // no version recorded: a database from before the version table is v1 if
  // it has the matches table, otherwise it is empty
  const hasMatches = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'matches'").get();
  const v = hasMatches ? 1 : 0;
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v);
  return v;
}

/** Brings `db` up to SCHEMA_VERSION, one step at a time, each in a transaction. */
export function migrate(db: DatabaseSync): void {
  const steps: Record<number, string> = { 1: V1, 2: V2, 3: V3, 4: V4, 5: V5, 6: V6, 7: V7 };
  let v = schemaVersion(db);
  if (v > SCHEMA_VERSION) throw new Error(`database schema ${v} is newer than this app (${SCHEMA_VERSION})`);
  while (v < SCHEMA_VERSION) {
    v++;
    db.exec("BEGIN");
    try {
      db.exec(steps[v]);
      db.prepare("UPDATE schema_version SET version = ?").run(v);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

export interface MatchRecord {
  room: string;
  game: string;
  tokens: [string | null, string | null];
  /** Headline result: sets won, in tennis; points won in unlimited. */
  score: [number, number];
  /** null: unlimited, which has no winner, or a draw. */
  winner: 0 | 1 | null;
  /** A finished match that ended level (boxing, task 30): no winner, but a result. */
  draw?: boolean;
  format: string;
  /** Games in each finished set. */
  sets: Array<[number, number]>;
  /**
   * Task 27: a game's own result detail (track: the event, finish times,
   * hurdles cleared and hit). No column of its own: stored in the `sets`
   * JSON column as `{ ...detail, sets }` (an object, where other games store
   * the bare array), so no schema step was needed. `setsOf` reads both.
   */
  detail?: Record<string, unknown>;
  practice: boolean;
  /** Longest rally in shots this match. */
  bestRally?: number;
  /** Task 7: the host turned "rated" on for the room. */
  ratedRequested?: boolean;
  /** Task 7: which seats were signed-in accounts (guests are never rated). */
  accounts?: [boolean, boolean];
}

/**
 * Whether a match counts towards ratings (task 7). All of: the host turned
 * "rated" on; both seats are signed-in accounts on different tokens (one
 * person on two tabs can't feed themselves wins); a real room, not practice
 * against the bot (a rating only reflects people beating people); a format
 * with a winner (not unlimited); and a finished match (a match left mid-way
 * is never recorded at all). Task 30: a draw (boxing's exact tie) between two
 * people is rated, stored with no winner; a reader tells it from unlimited by
 * `rated = 1`.
 */
export function isRated(m: MatchRecord): boolean {
  if (!m.ratedRequested || m.practice || m.format === "unlimited" || (m.winner === null && !m.draw)) return false;
  if (!m.accounts?.[0] || !m.accounts?.[1]) return false;
  return m.tokens[0] !== null && m.tokens[1] !== null && m.tokens[0] !== m.tokens[1];
}

/** The `sets` column as stored: the bare array, or (task 27, track) an object with the detail and `sets`. */
export function parseSetsColumn(raw: string): { sets: Array<[number, number]>; detail: Record<string, unknown> | null } {
  const v = JSON.parse(raw) as unknown;
  if (Array.isArray(v)) return { sets: v as Array<[number, number]>, detail: null };
  if (typeof v === "object" && v !== null) {
    const { sets, ...detail } = v as Record<string, unknown>;
    return { sets: Array.isArray(sets) ? (sets as Array<[number, number]>) : [], detail };
  }
  return { sets: [], detail: null };
}

/** Stores a match row; returns whether it was stored as rated. */
export function insertMatch(db: DatabaseSync, m: MatchRecord, endedAt = Date.now()): boolean {
  const rated = isRated(m);
  db.prepare(
    `INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated, best_rally)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.room,
    m.game,
    m.tokens[0],
    m.tokens[1],
    m.score[0],
    m.score[1],
    m.winner,
    endedAt,
    m.format,
    JSON.stringify(m.detail ? { ...m.detail, sets: m.sets } : m.sets),
    m.practice ? 1 : 0,
    rated ? 1 : 0,
    m.bestRally ?? null,
  );
  return rated;
}
