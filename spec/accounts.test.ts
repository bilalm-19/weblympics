// Task 17: accounts, passkeys, names, sessions and deletion, on a throwaway
// SQLite file (not the app's database), plus the pure guards they lean on.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { cleanTemp, openDb } from "./temp.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_TOKENS,
  addPasskey,
  createSession,
  deleteAccount,
  endSession,
  getDemo,
  getPlayer,
  guestFor,
  matchCountFor,
  newGuestToken,
  passkeysOf,
  removePasskey,
  rename,
  seedDemoAccounts,
  sessionPlayer,
} from "../server/accounts.ts";
import { Challenges, RateLimit, allowedOrigin, cookie, parseCookies } from "../server/guard.ts";
import { checkChosenName, pseudonym } from "../server/names.ts";
import { SCHEMA_VERSION, insertMatch, migrate, schemaVersion } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";

const dirs: string[] = [];
afterEach(() => {
  cleanTemp(dirs);
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-acct-"));
  dirs.push(d);
  return join(d, "app.db");
}

function freshDb(): DatabaseSync {
  const db = openDb(freshFile());
  migrate(db);
  seedDemoAccounts(db);
  return db;
}

const key = (id: string) => ({ id, publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ["internal"] });

const match = (over: Partial<MatchRecord> = {}): MatchRecord => ({
  room: "WXYZ",
  game: "tennis",
  tokens: ["t-a", "t-b"],
  score: [1, 0],
  winner: 0,
  format: "oneSet",
  sets: [[6, 2]],
  practice: false,
  ...over,
});

/** A guest made the way the page makes one, claimed with a passkey. */
function account(db: DatabaseSync, keyId = `k-${Math.random()}`): string {
  const token = newGuestToken();
  guestFor(db, token);
  expect(addPasskey(db, token, key(keyId)).ok).toBe(true);
  return token;
}

/** What schema v3 made, with the old demo guests and a match. */
function makeV3(path: string): void {
  const db = openDb(path);
  db.exec(`
    CREATE TABLE players (token TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, game TEXT NOT NULL, p0 TEXT, p1 TEXT,
      score0 INTEGER NOT NULL, score1 INTEGER NOT NULL, winner INTEGER, ended_at INTEGER NOT NULL,
      format TEXT NOT NULL DEFAULT 'points5', sets TEXT NOT NULL DEFAULT '[]', practice INTEGER NOT NULL DEFAULT 0,
      rated INTEGER NOT NULL DEFAULT 0, best_rally INTEGER
    );
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (3);
    INSERT INTO players VALUES ('demo-1', 'Demo One', 0), ('demo-2', 'Demo Two', 0),
      ('11111111-2222-4333-8444-555555555555', 'Lucky Otter 12', 5);
    INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at, format, sets, rated)
      VALUES ('OLDM', 'tennis', '11111111-2222-4333-8444-555555555555', 'demo-1', 1, 0, 0, 9, 'oneSet', '[[6,1]]', 1);
  `);
  db.close();
}

describe("schema v4 (task 17: accounts)", () => {
  it("opens a v3 database: players and matches kept, the demo guests become locked demo accounts", () => {
    const path = freshFile();
    makeV3(path);
    const db = openDb(path);
    migrate(db);
    seedDemoAccounts(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(getDemo(db, 1)).toEqual({ token: "demo-1", name: "Demo One", account: true, demo: true, tag: 1 });
    // an old guest is still a guest, with its history
    const guest = guestFor(db, "11111111-2222-4333-8444-555555555555")!;
    expect(guest).toMatchObject({ name: "Lucky Otter 12", account: false });
    expect(matchCountFor(db, guest.token)).toBe(1);
    // kept, but unrated from v6 on: only matches between accounts are rated (task 7)
    expect(db.prepare("SELECT rated FROM matches").get()).toEqual({ rated: 0 });
    // and the guest can claim it
    expect(addPasskey(db, guest.token, key("k1")).ok).toBe(true);
    expect(getPlayer(db, guest.token)).toMatchObject({ account: true, name: "Lucky Otter 12" });
    db.close();
  });
});

describe("guest profiles", () => {
  it("a new guest id gets a row and a pseudonym; the same id comes back as the same guest", () => {
    const db = freshDb();
    const token = newGuestToken();
    const first = guestFor(db, token)!;
    expect(first.account).toBe(false);
    expect(first.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    expect(guestFor(db, token)).toEqual(first);
  });

  it("a guest cookie can't name an account, a demo account or anything not shaped like our ids", () => {
    const db = freshDb();
    const acct = account(db);
    expect(guestFor(db, acct)).toBeNull();
    expect(guestFor(db, DEMO_TOKENS[1])).toBeNull();
    for (const bad of ["", "x", "demo-2", "deleted:abc", "a".repeat(500), "'; DROP TABLE players; --"]) expect(guestFor(db, bad)).toBeNull();
  });
});

describe("claiming with a passkey", () => {
  it("keeps the guest's token, so its match history stays", () => {
    const db = freshDb();
    const token = newGuestToken();
    guestFor(db, token);
    insertMatch(db, match({ tokens: [token, null], practice: true }));
    addPasskey(db, token, key("k1"));
    expect(getPlayer(db, token)!.account).toBe(true);
    expect(matchCountFor(db, token)).toBe(1);
  });

  it("refuses a passkey id that is already registered, and any passkey on a demo account", () => {
    const db = freshDb();
    account(db, "dup");
    const other = newGuestToken();
    guestFor(db, other);
    expect(addPasskey(db, other, key("dup"))).toMatchObject({ ok: false, status: 409 });
    expect(getPlayer(db, other)!.account).toBe(false);
    expect(addPasskey(db, DEMO_TOKENS[1], key("demo-key"))).toMatchObject({ ok: false, status: 403 });
    expect(passkeysOf(db, DEMO_TOKENS[1])).toEqual([]);
  });

  it("task 34: a claimed pseudonym another account already uses is kept, with a different tag", () => {
    const db = freshDb();
    const a = account(db);
    const b = newGuestToken();
    guestFor(db, b);
    db.prepare("UPDATE players SET name = (SELECT name FROM players WHERE token = ?) WHERE token = ?").run(a, b);
    addPasskey(db, b, key("kb"));
    const [pa, pb] = [getPlayer(db, a)!, getPlayer(db, b)!];
    expect(pb.name).toBe(pa.name);
    expect(pb.tag).not.toBeNull();
    expect(pb.tag).not.toBe(pa.tag);
  });
});

describe("passkeys on an account", () => {
  it("adds more, removes one, and removes the last only when confirmed", () => {
    const db = freshDb();
    const a = account(db, "k1");
    addPasskey(db, a, key("k2"));
    expect(passkeysOf(db, a).map((k) => k.id)).toEqual(["k1", "k2"]);
    expect(removePasskey(db, a, "k1", false)).toEqual({ ok: true, remaining: 1 });
    expect(removePasskey(db, a, "k2", false)).toMatchObject({ ok: false, status: 409 });
    expect(passkeysOf(db, a)).toHaveLength(1);
    expect(removePasskey(db, a, "k2", true)).toEqual({ ok: true, remaining: 0 });
  });

  it("can't remove someone else's passkey", () => {
    const db = freshDb();
    const a = account(db, "ka");
    const b = account(db, "kb");
    expect(removePasskey(db, a, "kb", true)).toMatchObject({ ok: false, status: 404 });
    expect(passkeysOf(db, b)).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("the cookie is 256 random bits; only its hash is stored", () => {
    const db = freshDb();
    const a = account(db);
    const { cookie: value } = createSession(db, a);
    expect(Buffer.from(value, "base64url")).toHaveLength(32);
    const stored = db.prepare("SELECT hash FROM sessions").all() as { hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0].hash).not.toContain(value);
    expect(JSON.stringify(db.prepare("SELECT * FROM sessions").all())).not.toContain(value);
    expect(sessionPlayer(db, value)!.token).toBe(a);
  });

  it("expires, ends on sign-out, and an unknown cookie is nobody", () => {
    const db = freshDb();
    const a = account(db);
    const now = 1_000_000;
    const { cookie: value, expires } = createSession(db, a, now);
    expect(sessionPlayer(db, value, expires - 1)).not.toBeNull();
    expect(sessionPlayer(db, value, expires)).toBeNull();
    endSession(db, value);
    expect(sessionPlayer(db, value, now)).toBeNull();
    expect(sessionPlayer(db, "nope")).toBeNull();
    expect(sessionPlayer(db, undefined)).toBeNull();
  });
});

describe("display names (task 17)", () => {
  it("length: 3 to 16 after trimming", () => {
    expect(checkChosenName("Al").ok).toBe(false);
    expect(checkChosenName("Ali")).toEqual({ ok: true, name: "Ali" });
    expect(checkChosenName("A".repeat(16)).ok).toBe(true);
    expect(checkChosenName("A".repeat(17)).ok).toBe(false);
    expect(checkChosenName("   Ace   ")).toEqual({ ok: true, name: "Ace" });
    expect(checkChosenName("Ace    Ventura")).toEqual({ ok: true, name: "Ace Ventura" });
  });

  it("characters: ASCII letters, digits, spaces and _ . ' - only, with a letter", () => {
    for (const ok of ["Ace_9", "O'Neil", "Jean-Luc", "Dr. Who"]) expect(checkChosenName(ok).ok, ok).toBe(true);
    for (const bad of ["<script>", "Ace!", "Zoë", "Аce" /* Cyrillic A */, "name​", "tab\there", "1234", "___", "emoji😀"]) {
      expect(checkChosenName(bad).ok, bad).toBe(false);
    }
  });

  it("reserved: Bot, Admin, the two-tab label and the server's own pseudonyms", () => {
    for (const bad of ["Bot", "bot", "BOT", "Admin", "admin 2", "Deleted player", "You", "Swift Otter 12", pseudonym()]) {
      expect(checkChosenName(bad), bad).toEqual({ ok: false, reason: "That name is reserved." });
    }
    // the two-tab label "<name> (2)" can't be chosen at all: brackets aren't allowed
    for (const bad of ["Ace (2)", "Ace(3)", "Demo One (2)"]) expect(checkChosenName(bad).ok, bad).toBe(false);
  });

  it("profanity, including disguised spellings, is refused; innocent words that contain one are not", () => {
    for (const bad of ["fuck", "FuCk3r", "sh1t head", "a55hole"]) expect(checkChosenName(bad).ok, bad).toBe(false);
    for (const ok of ["Scunthorpe", "Cassandra", "Grass Hopper"]) expect(checkChosenName(ok).ok, ok).toBe(true);
  });

  it("not a string, or very long, is refused without throwing", () => {
    for (const bad of [undefined, null, 42, ["Ace"], { name: "Ace" }, "x".repeat(10_000)]) expect(checkChosenName(bad).ok).toBe(false);
  });

  it("task 34: a shared name gets another tag; name and tag are unique ignoring case; guests and demo accounts can't rename", () => {
    const db = freshDb();
    const a = account(db);
    const b = account(db);
    const ra = rename(db, a, "Ace");
    expect(ra).toMatchObject({ ok: true, name: "Ace" });
    const tagA = getPlayer(db, a)!.tag;
    // the same name in another case is allowed: it gets a different tag
    const rb = rename(db, b, "ace");
    expect(rb).toMatchObject({ ok: true, name: "ace" });
    expect(getPlayer(db, b)!.tag).not.toBe(tagA);
    // renaming to your own name in another case keeps your tag
    expect(rename(db, a, "ACE")).toMatchObject({ ok: true, name: "ACE", tag: tagA });
    // a demo account's name and tag can't be taken: another "Demo One" gets another tag
    expect(rename(db, b, "demo one")).toMatchObject({ ok: true });
    expect(getPlayer(db, b)!.tag).not.toBe(1);

    const g = newGuestToken();
    guestFor(db, g);
    expect(rename(db, g, "Guesty")).toMatchObject({ ok: false, status: 403 });
    expect(rename(db, DEMO_TOKENS[1], "Hacked")).toMatchObject({ ok: false, status: 403 });
    expect(getDemo(db, 1).name).toBe("Demo One");
  });

  it("task 34: the database itself refuses two accounts with one name (any case) and one tag", () => {
    const db = freshDb();
    const a = account(db);
    const b = account(db);
    rename(db, a, "Unique");
    const tag = getPlayer(db, a)!.tag;
    expect(() => db.prepare("UPDATE players SET name = 'UNIQUE', tag = ? WHERE token = ?").run(tag, b)).toThrow(/UNIQUE/);
  });
});

describe("deleting an account (task 17)", () => {
  it("removes every identifying row; match rows stay, pointing at nothing that links back", () => {
    const db = freshDb();
    const a = account(db, "ka1");
    addPasskey(db, a, key("ka2"));
    rename(db, a, "Leaving Soon");
    createSession(db, a);
    const opponent = account(db, "kb");
    insertMatch(db, match({ tokens: [a, opponent] }));
    insertMatch(db, match({ tokens: [opponent, a], winner: 1 }));

    expect(deleteAccount(db, a)).toEqual({ ok: true });
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM players").all(),
      db.prepare("SELECT * FROM passkeys").all(),
      db.prepare("SELECT * FROM sessions").all(),
      db.prepare("SELECT * FROM matches").all(),
    ]);
    expect(dump).not.toContain(a);
    expect(dump).not.toContain("Leaving Soon");
    expect(dump).not.toContain("ka1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    // the opponent keeps both matches, with the same results
    expect(matchCountFor(db, opponent)).toBe(2);
    const rows = db.prepare("SELECT p0, p1, winner FROM matches ORDER BY id").all() as { p0: string; p1: string; winner: number }[];
    expect(rows[0]).toMatchObject({ p1: opponent, winner: 0 });
    expect(rows[0].p0).toMatch(/^deleted:/);
    expect(rows[1].p1).toBe(rows[0].p0);
    // and the name is free again
    expect(rename(db, opponent, "Leaving Soon").ok).toBe(true);
  });

  it("guests and demo accounts can't be deleted", () => {
    const db = freshDb();
    const g = newGuestToken();
    guestFor(db, g);
    expect(deleteAccount(db, g)).toMatchObject({ ok: false, status: 403 });
    expect(deleteAccount(db, DEMO_TOKENS[2])).toMatchObject({ ok: false, status: 403 });
    expect(getDemo(db, 2)).toBeTruthy();
  });
});

describe("guards", () => {
  it("parses cookies, first value wins", () => {
    const jar = parseCookies("a=1; wl_session=abc; a=2;  b = x ");
    expect(jar.get("a")).toBe("1");
    expect(jar.get("wl_session")).toBe("abc");
    expect(jar.get("b")).toBe("x");
    expect(parseCookies(undefined).size).toBe(0);
  });

  it("cookies are HttpOnly and SameSite=Lax always, Secure except on localhost", () => {
    const local = cookie("wl_session", "v", 60, "localhost:8110");
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Lax");
    expect(local).not.toContain("Secure");
    const live = cookie("wl_session", "v", 60, "comp4020-final-bilalm004.fly.dev");
    expect(live).toMatch(/HttpOnly; SameSite=Lax; Secure$/);
  });

  it("accepts only the page's own origin: https, or http on localhost", () => {
    expect(allowedOrigin("https://app.fly.dev", "app.fly.dev")).toBe("https://app.fly.dev");
    expect(allowedOrigin("http://localhost:8110", "localhost:8110")).toBe("http://localhost:8110");
    expect(allowedOrigin("http://app.fly.dev", "app.fly.dev")).toBeNull();
    expect(allowedOrigin("https://evil.example", "app.fly.dev")).toBeNull();
    expect(allowedOrigin("https://app.fly.dev.evil.example", "app.fly.dev")).toBeNull();
    expect(allowedOrigin("http://localhost:9999", "localhost:8110")).toBeNull();
    expect(allowedOrigin(undefined, "app.fly.dev")).toBeNull();
    expect(allowedOrigin("null", "app.fly.dev")).toBeNull();
  });

  it("a challenge works once, for its own purpose, and not after it expires", () => {
    let now = 0;
    const c = new Challenges<string>(1000, 10, () => now);
    c.add("abc", "reg:a");
    expect(c.take("abc", "reg:b")).toBe(false);
    // a wrong-purpose try still uses it up
    expect(c.take("abc", "reg:a")).toBe(false);
    c.add("def", "login");
    expect(c.take("def", "login")).toBe(true);
    expect(c.take("def", "login")).toBe(false);
    c.add("ghi", "login");
    now = 1000;
    expect(c.take("ghi", "login")).toBe(false);
    expect(c.take("never", "login")).toBe(false);
  });

  it("rate limits per key within a window", () => {
    let now = 0;
    const r = new RateLimit(3, 1000, () => now);
    expect([r.allow("ip"), r.allow("ip"), r.allow("ip"), r.allow("ip")]).toEqual([true, true, true, false]);
    expect(r.allow("other")).toBe(true);
    now = 1000;
    expect(r.allow("ip")).toBe(true);
  });
});
