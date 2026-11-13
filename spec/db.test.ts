// Schema migrations and what a match row stores (task 1). Runs on a throwaway
// SQLite file, not the app's own database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, insertMatch, migrate, schemaVersion } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-db-"));
  dirs.push(d);
  return join(d, "app.db");
}

/** Exactly what server/db.ts created before schema versions existed (v1). */
function makeV1(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);
  db.prepare("INSERT INTO players (token, name, created_at) VALUES ('t-a', 'Old Otter', 1)").run();
  db.prepare(
    "INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at) VALUES ('ABCD', 'tennis', 't-a', 't-b', 5, 3, 0, 1000)",
  ).run();
  db.close();
}

const match = (over: Partial<MatchRecord> = {}): MatchRecord => ({
  room: "WXYZ",
  game: "tennis",
  tokens: ["t-a", "t-b"],
  score: [1, 0],
  winner: 0,
  format: "oneSet",
  sets: [[7, 6]],
  practice: false,
  ...over,
});

describe("schema migrations", () => {
  it("opens a database made by the previous schema, keeps its rows and records the new version", () => {
    const path = freshFile();
    makeV1(path);
    const db = new DatabaseSync(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT name FROM players WHERE token = 't-a'").get()).toEqual({ name: "Old Otter" });
    // the old first-to-5 row survives, marked as such
    expect(db.prepare("SELECT score0, score1, winner, format, sets, practice, rated FROM matches").get()).toEqual({
      score0: 5,
      score1: 3,
      winner: 0,
      format: "points5",
      sets: "[]",
      practice: 0,
      rated: 0,
    });
    // and a new-style row can go in next to it
    insertMatch(db, match());
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches").get()).toEqual({ n: 2 });
    db.close();
  });

  it("creates the current schema on an empty database, and migrating again changes nothing", () => {
    const path = freshFile();
    const db = new DatabaseSync(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    insertMatch(db, match());
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({ n: 1 });
    db.close();
  });

  it("refuses a database from a newer version of the app rather than damage it", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION + 1);
    expect(() => migrate(db)).toThrow(/newer/);
    db.close();
  });
});

/** What schema v2 made (v1 plus the V2 step), with a row in it. */
function makeV2(path: string): void {
  makeV1(path);
  const db = new DatabaseSync(path);
  db.exec(`
    ALTER TABLE matches ADD COLUMN format TEXT NOT NULL DEFAULT 'points5';
    ALTER TABLE matches ADD COLUMN sets TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE matches ADD COLUMN practice INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE matches ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (2);
    INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated)
      VALUES ('V2RM', 'tennis', 't-a', 't-b', 1, 0, 0, 2000, 'oneSet', '[[6,3]]', 0, 1);
  `);
  db.close();
}

describe("schema v3 (task 4: unlimited)", () => {
  it("opens a v2 database, keeps every row and its rating, and then takes a match with no winner", () => {
    const path = freshFile();
    makeV2(path);
    const db = new DatabaseSync(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const rows = db.prepare("SELECT room, winner, format, rated, best_rally FROM matches ORDER BY id").all();
    // every row survives; v6 (task 7) marked the old guest-vs-guest
    // "rated" row unrated, and nothing sets the column again (task 37)
    expect(rows).toEqual([
      { room: "ABCD", winner: 0, format: "points5", rated: 0, best_rally: null },
      { room: "V2RM", winner: 0, format: "oneSet", rated: 0, best_rally: null },
    ]);
    insertMatch(db, match({ room: "UNLM", format: "unlimited", winner: null, score: [14, 9], sets: [], bestRally: 11 }));
    expect(db.prepare("SELECT winner, score0, score1, rated, best_rally FROM matches WHERE room = 'UNLM'").get()).toEqual({
      winner: null,
      score0: 14,
      score1: 9,
      rated: 0,
      best_rally: 11,
    });
    db.close();
  });
});

describe("schema v10 (task 37: ratings are gone)", () => {
  /** What a v9 database held: the ratings table with a row in it, and match rows, some of them stored rated. */
  function makeV9(path: string): void {
    const db = new DatabaseSync(path);
    migrate(db);
    db.exec(`
      CREATE TABLE ratings (
        player TEXT NOT NULL, sport TEXT NOT NULL, rating INTEGER NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL, PRIMARY KEY (player, sport)
      );
      CREATE INDEX ratings_board ON ratings (sport, rating DESC);
      INSERT INTO ratings (player, sport, rating, wins, updated_at) VALUES ('t-a', 'tennis', 1016, 1, 5);
      INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated)
        VALUES ('OLD1', 'tennis', 't-a', 't-b', 1, 0, 0, 3000, 'oneSet', '[[6,3]]', 0, 1);
      UPDATE schema_version SET version = 9;
    `);
    db.close();
  }

  it("opens a v9 database, drops the ratings table, keeps every match row and records the new version", () => {
    const path = freshFile();
    makeV9(path);
    const db = new DatabaseSync(path);
    expect(db.prepare("SELECT version FROM schema_version").get()).toEqual({ version: 9 });
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('ratings', 'ratings_board')").all()).toEqual([]);
    expect(db.prepare("SELECT room, winner, sets FROM matches WHERE room = 'OLD1'").get()).toEqual({ room: "OLD1", winner: 0, sets: "[[6,3]]" });
    db.close();
  });

  it("a new match row is never stored rated, whoever played", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    insertMatch(db, match({ room: "REAL" }));
    insertMatch(db, match({ room: "PRAC", practice: true, tokens: ["t-a", null] }));
    expect(db.prepare("SELECT room, practice, rated FROM matches ORDER BY id").all()).toEqual([
      { room: "REAL", practice: 0, rated: 0 },
      { room: "PRAC", practice: 1, rated: 0 },
    ]);
    db.close();
  });
});

describe("match rows", () => {
  it("store sets won, each set's games and the format", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    insertMatch(db, match({ score: [2, 1], format: "bestOfThree", sets: [[6, 4], [3, 6], [7, 6]] }));
    const row = db.prepare("SELECT score0, score1, format, sets FROM matches").get() as Record<string, unknown>;
    expect(row).toMatchObject({ score0: 2, score1: 1, format: "bestOfThree" });
    expect(JSON.parse(row.sets as string)).toEqual([
      [6, 4],
      [3, 6],
      [7, 6],
    ]);
    db.close();
  });
});

describe("no rated option (task 37)", () => {
  it("the protocol no longer knows a rated message, so it is dropped whole", async () => {
    const { parseClientMsg } = await import("../shared/protocol.ts");
    expect(parseClientMsg(JSON.stringify({ t: "rated", rated: true }))).toBeNull();
  });
});
