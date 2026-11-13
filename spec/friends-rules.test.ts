// Task 34: name tags and friends over a throwaway SQLite file
// (server/accounts.ts, server/friends.ts, the v8 schema step): every account
// is Name#1234, name and tag together unique; all 10,000 taken is said
// plainly; a rename keeps its tag if free; guests can't friend; requests,
// accept, decline, remove, links (single use, expiring, only a hash stored).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { cleanTemp, openDb } from "./temp.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_TAGS_TAKEN,
  DEMO_TOKENS,
  addPasskey,
  deleteAccount,
  findByTag,
  freeTag,
  getDemo,
  getPlayer,
  guestFor,
  newGuestToken,
  rename,
  seedDemoAccounts,
  showTag,
} from "../server/accounts.ts";
import {
  GUESTS_CANT,
  LINK_MS,
  acceptFriend,
  areFriends,
  createFriendLink,
  declineFriend,
  friendIds,
  nameTag,
  parseNameTag,
  removeFriend,
  requestFriend,
  requestIds,
  useFriendLink,
} from "../server/friends.ts";
import { SCHEMA_VERSION, migrate, schemaVersion } from "../server/schema.ts";

const dirs: string[] = [];
afterEach(() => {
  cleanTemp(dirs);
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-friends-"));
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

function account(db: DatabaseSync, name?: string): string {
  const token = newGuestToken();
  guestFor(db, token);
  expect(addPasskey(db, token, key(`k-${Math.random()}`)).ok).toBe(true);
  if (name) expect(rename(db, token, name).ok).toBe(true);
  return token;
}

const tagOf = (db: DatabaseSync, t: string) => nameTag(getPlayer(db, t)!);

describe("schema v8 (task 34): name tags and friends tables", () => {
  it("opens a v7 database: every account gets a tag, the demo accounts #0001 and #0002, guests none; rows kept", () => {
    const path = freshFile();
    const old = openDb(path);
    migrate(old);
    // roll the fresh database back to what v7 made (task 33's looks step stays; task 25's v9 column goes)
    old.exec(`
      ALTER TABLE players DROP COLUMN camera_settings;
      DROP TABLE friendships; DROP TABLE friend_requests; DROP TABLE friend_links;
      DROP INDEX players_name_tag;
      ALTER TABLE players DROP COLUMN tag;
      CREATE UNIQUE INDEX players_account_name ON players (lower(name)) WHERE account = 1;
      UPDATE schema_version SET version = 7;
      INSERT INTO players (token, name, created_at, account, demo) VALUES ('demo-1', 'Demo One', 0, 1, 1), ('demo-2', 'Demo Two', 0, 1, 1);
      INSERT INTO players (token, name, created_at, account) VALUES ('acct-a', 'Sam', 1, 1), ('acct-b', 'Ali', 2, 1);
      INSERT INTO players (token, name, created_at) VALUES ('11111111-2222-4333-8444-555555555555', 'Lucky Otter 12', 3);
      CREATE TABLE ratings (player TEXT NOT NULL, sport TEXT NOT NULL, rating INTEGER NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (player, sport));
      INSERT INTO ratings (player, sport, rating, updated_at) VALUES ('acct-a', 'tennis', 1032, 5);
    `);
    expect(schemaVersion(old)).toBe(7);
    old.close();

    const db = openDb(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    // v11 (task 39) added recovery codes after this step
    expect(SCHEMA_VERSION).toBe(11);
    expect(getDemo(db, 1).tag).toBe(1);
    expect(getDemo(db, 2).tag).toBe(2);
    for (const t of ["acct-a", "acct-b"]) {
      const tag = getPlayer(db, t)!.tag!;
      expect(tag).toBeGreaterThanOrEqual(0);
      expect(tag).toBeLessThan(10_000);
    }
    expect(getPlayer(db, "11111111-2222-4333-8444-555555555555")!.tag).toBeNull();
    // v10 (task 37) dropped the ratings table the v7 database still had
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ratings'").all()).toEqual([]);
    // the new tables work
    const a = getPlayer(db, "acct-a")!;
    const b = getPlayer(db, "acct-b")!;
    expect(requestFriend(db, b.token, nameTag(a)).ok).toBe(true);
    expect(acceptFriend(db, a.token, nameTag(b)).ok).toBe(true);
    expect(areFriends(db, a.token, b.token)).toBe(true);
    db.close();
  });
});

describe("name tags", () => {
  it("every account gets a random 4-digit tag on claiming; guests have none", () => {
    const db = freshDb();
    const g = newGuestToken();
    guestFor(db, g);
    expect(getPlayer(db, g)!.tag).toBeNull();
    const a = account(db);
    expect(getPlayer(db, a)!.tag).toEqual(expect.any(Number));
    expect(showTag(7)).toBe("0007");
    expect(showTag(4821)).toBe("4821");
  });

  it("several accounts may share a name; the name (any case) and tag find exactly one", () => {
    const db = freshDb();
    const [a, b, c] = [account(db, "Sam"), account(db, "sam"), account(db, "SAM")];
    const tags = [a, b, c].map((t) => getPlayer(db, t)!.tag);
    expect(new Set(tags).size).toBe(3);
    expect(findByTag(db, "sAm", tags[1]!)!.token).toBe(b);
  });

  it("a rename keeps the tag if it is free under the new name, else gets another", () => {
    const db = freshDb();
    const a = account(db, "Ana");
    const tag = getPlayer(db, a)!.tag!;
    expect(rename(db, a, "Anna")).toMatchObject({ ok: true, tag });
    const b = account(db, "Bea");
    db.prepare("UPDATE players SET tag = ? WHERE token = ?").run((tag + 1) % 10_000, b);
    // b moves to Anna: its own tag is free there, so it keeps it
    expect(rename(db, b, "Anna")).toMatchObject({ ok: true, tag: (tag + 1) % 10_000 });
    // a third Anna whose tag is a's gets another
    const c = account(db, "Cat");
    db.prepare("UPDATE players SET tag = ? WHERE token = ?").run(tag, c);
    const r = rename(db, c, "anna");
    expect(r.ok).toBe(true);
    expect(getPlayer(db, c)!.tag).not.toBe(tag);
  });

  it("if all 10,000 tags for a name are taken, the user is told plainly to pick another", () => {
    const db = freshDb();
    const insert = db.prepare("INSERT INTO players (token, name, created_at, account, tag) VALUES (?, 'Full', 0, 1, ?)");
    db.exec("BEGIN");
    for (let t = 0; t < 10_000; t++) insert.run(`full-${t}`, t);
    db.exec("COMMIT");
    expect(freeTag(db, "full")).toBeNull();
    const a = account(db, "Other");
    expect(rename(db, a, "FULL")).toEqual({ ok: false, status: 409, reason: ALL_TAGS_TAKEN });
    expect(ALL_TAGS_TAKEN).toMatch(/pick another name/i);
    expect(getPlayer(db, a)!.name).toBe("Other");
    // one of them leaves a tag free: then it is that one
    db.prepare("DELETE FROM players WHERE token = 'full-4821'").run();
    expect(rename(db, a, "Full")).toMatchObject({ ok: true, tag: 4821 });
  });

  it("the demo accounts keep their fixed tags and stay locked", () => {
    const db = freshDb();
    expect(nameTag(getDemo(db, 1))).toBe("Demo One#0001");
    expect(nameTag(getDemo(db, 2))).toBe("Demo Two#0002");
    expect(rename(db, DEMO_TOKENS[1], "Free")).toMatchObject({ ok: false, status: 403 });
  });

  it("Name#1234 parses with spaces around the #; anything else is refused", () => {
    expect(parseNameTag("Sam#4821")).toEqual({ name: "Sam", tag: 4821 });
    expect(parseNameTag("  Racket  Queen # 0042 ")).toEqual({ name: "Racket Queen", tag: 42 });
    for (const bad of ["Sam", "Sam#", "Sam#12", "Sam#12345", "#4821", "Sam#abcd", 42, null, { name: "Sam" }, "x".repeat(100) + "#1234"]) {
      expect(parseNameTag(bad), String(bad)).toBeNull();
    }
  });
});

describe("friend requests (accounts only, exact Name#1234)", () => {
  it("guests can't send, accept or be found; they are told why", () => {
    const db = freshDb();
    const g = newGuestToken();
    const guest = guestFor(db, g)!;
    const a = account(db, "Ana");
    expect(requestFriend(db, g, tagOf(db, a))).toEqual({ ok: false, status: 403, reason: GUESTS_CANT });
    expect(GUESTS_CANT).toMatch(/guest/i);
    // a guest's pseudonym with any tag finds nobody
    for (let t = 0; t < 20; t++) expect(requestFriend(db, a, `${guest.name}#${showTag(t)}`)).toMatchObject({ ok: false, status: 404 });
    expect(acceptFriend(db, g, tagOf(db, a))).toMatchObject({ ok: false, status: 403 });
    expect(createFriendLink(db, g)).toMatchObject({ ok: false, status: 403 });
  });

  it("a request waits for the other's yes; accept makes friends both ways", () => {
    const db = freshDb();
    const [a, b] = [account(db, "Ana"), account(db, "Ben")];
    expect(requestFriend(db, a, tagOf(db, b))).toMatchObject({ ok: true, outcome: "requested" });
    expect(areFriends(db, a, b)).toBe(false);
    expect(requestIds(db, b)).toEqual([a]);
    expect(requestIds(db, a)).toEqual([]);
    expect(acceptFriend(db, b, tagOf(db, a))).toMatchObject({ ok: true, outcome: "friends" });
    expect(areFriends(db, a, b)).toBe(true);
    expect(friendIds(db, a)).toEqual([b]);
    expect(friendIds(db, b)).toEqual([a]);
    expect(requestIds(db, b)).toEqual([]);
    // asking again changes nothing
    expect(requestFriend(db, a, tagOf(db, b))).toMatchObject({ ok: true, outcome: "already" });
  });

  it("two people asking each other become friends at once", () => {
    const db = freshDb();
    const [a, b] = [account(db, "Ana"), account(db, "Ben")];
    requestFriend(db, a, tagOf(db, b));
    expect(requestFriend(db, b, tagOf(db, a))).toMatchObject({ ok: true, outcome: "friends" });
    expect(areFriends(db, a, b)).toBe(true);
  });

  it("a wrong tag, a near name or yourself finds nobody (no search, no partial matches)", () => {
    const db = freshDb();
    const [a, b] = [account(db, "Ana"), account(db, "Benjamin")];
    const tag = showTag(getPlayer(db, b)!.tag!);
    const wrong = showTag((getPlayer(db, b)!.tag! + 1) % 10_000);
    for (const raw of [`Benjamin#${wrong}`, `Ben#${tag}`, `Benjamin*#${tag}`, `%#${tag}`, `Benj_min#${tag}`]) {
      expect(requestFriend(db, a, raw), raw).toMatchObject({ ok: false });
    }
    expect(requestFriend(db, a, tagOf(db, a))).toMatchObject({ ok: false, status: 400 });
    expect(requestIds(db, b)).toEqual([]);
  });

  it("decline and remove are silent; accepting a request that isn't there is refused", () => {
    const db = freshDb();
    const [a, b] = [account(db, "Ana"), account(db, "Ben")];
    requestFriend(db, a, tagOf(db, b));
    expect(declineFriend(db, b, tagOf(db, a)).ok).toBe(true);
    expect(requestIds(db, b)).toEqual([]);
    expect(acceptFriend(db, b, tagOf(db, a))).toMatchObject({ ok: false, status: 404 });
    requestFriend(db, a, tagOf(db, b));
    acceptFriend(db, b, tagOf(db, a));
    expect(removeFriend(db, a, tagOf(db, b)).ok).toBe(true);
    expect(areFriends(db, a, b)).toBe(false);
    expect(friendIds(db, b)).toEqual([]);
  });

  it("deleting an account removes its friendships and requests both ways", () => {
    const db = freshDb();
    const [a, b, c] = [account(db, "Ana"), account(db, "Ben"), account(db, "Cyd")];
    requestFriend(db, a, tagOf(db, b));
    acceptFriend(db, b, tagOf(db, a));
    requestFriend(db, a, tagOf(db, c));
    requestFriend(db, c, tagOf(db, b));
    createFriendLink(db, a);
    expect(deleteAccount(db, a).ok).toBe(true);
    expect(friendIds(db, b)).toEqual([]);
    expect(requestIds(db, c)).toEqual([]);
    expect(requestIds(db, b)).toEqual([c]);
    const dump = JSON.stringify([db.prepare("SELECT * FROM friendships").all(), db.prepare("SELECT * FROM friend_requests").all(), db.prepare("SELECT * FROM friend_links").all()]);
    expect(dump).not.toContain(a);
  });
});

describe("friend links", () => {
  it("opening one makes friends; it works once, only a hash is stored, and it expires", () => {
    const db = freshDb();
    const [a, b, c] = [account(db, "Ana"), account(db, "Ben"), account(db, "Cyd")];
    const link = createFriendLink(db, a, 1000);
    if (!link.ok) throw new Error("no link");
    expect(link.code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(JSON.stringify(db.prepare("SELECT * FROM friend_links").all())).not.toContain(link.code);
    // your own link does nothing
    expect(useFriendLink(db, a, link.code, 1000)).toMatchObject({ ok: false, status: 400 });
    expect(useFriendLink(db, b, link.code, 2000)).toMatchObject({ ok: true, outcome: "friends" });
    expect(areFriends(db, a, b)).toBe(true);
    // single use
    expect(useFriendLink(db, c, link.code, 3000)).toMatchObject({ ok: false, status: 404 });
    // expiring
    const late = createFriendLink(db, a, 0);
    if (!late.ok) throw new Error("no link");
    expect(useFriendLink(db, c, late.code, LINK_MS + 1)).toMatchObject({ ok: false, status: 404 });
    expect(areFriends(db, a, c)).toBe(false);
    for (const bad of [undefined, 42, "", "x", "a/b", "x".repeat(200)]) expect(useFriendLink(db, c, bad).ok).toBe(false);
  });

  it("the link never says who made it: the code is random, not the id or the name", () => {
    const db = freshDb();
    const a = account(db, "Ana");
    const link = createFriendLink(db, a);
    if (!link.ok) throw new Error("no link");
    expect(link.code).not.toContain(a);
    expect(link.code.toLowerCase()).not.toContain("ana");
  });
});
