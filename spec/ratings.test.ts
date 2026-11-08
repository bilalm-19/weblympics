// Task 7: Elo ratings, per-sport leaderboards, match history and the rated
// option, on throwaway databases and the real Room with a fake clock. The
// leaderboard over HTTP against the running app is at the end.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { addPasskey, deleteAccount, guestFor, newGuestToken, rename, seedDemoAccounts } from "../server/accounts.ts";
import { Lobby } from "../server/lobby.ts";
import { FLOOR, K, START_RATING, eloChange, history, leaderboard, longestRally, ratingOf, recomputeRatings, recordResult } from "../server/ratings.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { SCHEMA_VERSION, migrate, schemaVersion } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";
import { games } from "../shared/games/registry.ts";
import type { GameDef } from "../shared/games/registry.ts";
import type { ServerMsg } from "../shared/protocol.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-elo-"));
  dirs.push(d);
  return join(d, "app.db");
}

function freshDb(path = freshFile()): DatabaseSync {
  const db = new DatabaseSync(path);
  migrate(db);
  seedDemoAccounts(db);
  return db;
}

function account(db: DatabaseSync, name?: string): string {
  const t = newGuestToken();
  guestFor(db, t);
  addPasskey(db, t, { id: `k-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
  if (name) expect(rename(db, t, name).ok).toBe(true);
  return t;
}

function guest(db: DatabaseSync): string {
  const t = newGuestToken();
  guestFor(db, t);
  return t;
}

/** A finished, rated match: `winner` beat `loser` in `sport`. */
const rated = (winner: string, loser: string, over: Partial<MatchRecord> = {}): MatchRecord => ({
  room: "RATE",
  game: "tennis",
  tokens: [winner, loser],
  score: [1, 0],
  winner: 0,
  format: "oneSet",
  sets: [[6, 3]],
  practice: false,
  ratedRequested: true,
  accounts: [true, true],
  ...over,
});

describe("Elo (task 7): start 1000, K = 32", () => {
  it("the test table: equal, favourite wins, upset, big gap", () => {
    expect(START_RATING).toBe(1000);
    expect(K).toBe(32);
    // equal ratings: expected 0.5, so 16 each way
    expect(eloChange(1000, 1000)).toBe(16);
    // the favourite (by 200) wins: expected 0.76, gains 8
    expect(eloChange(1200, 1000)).toBe(8);
    // the underdog (by 200) wins: expected 0.24, gains 24
    expect(eloChange(1000, 1200)).toBe(24);
    // 400 apart: expected 0.909 / 0.091
    expect(eloChange(1400, 1000)).toBe(3);
    expect(eloChange(1000, 1400)).toBe(29);
    // never more than K, never negative
    expect(eloChange(100, 3000)).toBeLessThanOrEqual(32);
    expect(eloChange(3000, 100)).toBeGreaterThanOrEqual(0);
  });

  it("a rated win moves both ratings by the same amount, in the match's own transaction", () => {
    const db = freshDb();
    const a = account(db);
    const b = account(db);
    expect(recordResult(db, rated(a, b))).toEqual({ rated: true, delta: 16 });
    expect(ratingOf(db, a, "tennis")).toEqual({ rating: 1016, wins: 1, losses: 0 });
    expect(ratingOf(db, b, "tennis")).toEqual({ rating: 984, wins: 0, losses: 1 });
    // seat 1 winning works the same way
    recordResult(db, rated(a, b, { winner: 1 }));
    expect(ratingOf(db, b, "tennis").wins).toBe(1);
  });

  it("floor: a rating never goes below 100", () => {
    const db = freshDb();
    const a = account(db);
    const b = account(db);
    // two players near the floor: an even match would take 16 off the loser
    const set = db.prepare("INSERT INTO ratings (player, sport, rating, wins, losses, updated_at) VALUES (?, 'tennis', ?, 0, 40, 0)");
    set.run(a, 105);
    set.run(b, 105);
    recordResult(db, rated(a, b));
    expect(ratingOf(db, a, "tennis").rating).toBe(121);
    expect(ratingOf(db, b, "tennis").rating).toBe(FLOOR);
    recordResult(db, rated(a, b));
    expect(ratingOf(db, b, "tennis").rating).toBe(FLOOR);
  });

  it("unrated matches never change a rating", () => {
    const db = freshDb();
    const a = account(db);
    const b = account(db);
    const g = guest(db);
    for (const m of [
      rated(a, b, { ratedRequested: false }),
      rated(a, b, { practice: true }),
      rated(a, b, { format: "unlimited", winner: null }),
      rated(a, g, { accounts: [true, false] }),
      rated(a, a),
      rated(a, b, { tokens: [a, null] }),
    ]) {
      expect(recordResult(db, m).rated, JSON.stringify(m)).toBe(false);
    }
    expect(ratingOf(db, a, "tennis")).toEqual({ rating: 1000, wins: 0, losses: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ratings").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches WHERE rated = 1").get()).toEqual({ n: 0 });
  });

  it("recomputing from the rated rows gives the same ratings, and ignores everything else", () => {
    const db = freshDb();
    const [a, b, c] = [account(db), account(db), account(db)];
    let t = 1000;
    for (const [w, l] of [[a, b], [b, c], [c, a], [a, c], [a, b]] as const) recordResult(db, rated(w, l), t++);
    recordResult(db, rated(c, a, { ratedRequested: false }), t++);
    const before = [a, b, c].map((p) => ratingOf(db, p, "tennis"));
    db.exec("UPDATE ratings SET rating = 5");
    recomputeRatings(db);
    expect([a, b, c].map((p) => ratingOf(db, p, "tennis"))).toEqual(before);
  });
});

describe("one rating per sport (task 7)", () => {
  // a fake second sport, registered only for this test
  const fake: GameDef = { id: "fakeball", name: "Fakeball", formats: games.tennis.formats, create: games.tennis.create };

  it("a match in one sport never changes another sport's rating, and each board lists only its own", () => {
    games.fakeball = fake;
    try {
      const db = freshDb();
      const a = account(db, "Tennis Ace");
      const b = account(db, "Fake Star");
      recordResult(db, rated(a, b));
      recordResult(db, rated(b, a, { game: "fakeball" }));
      recordResult(db, rated(b, a, { game: "fakeball" }));
      expect(ratingOf(db, a, "tennis").rating).toBe(1016);
      expect(ratingOf(db, b, "tennis").rating).toBe(984);
      expect(ratingOf(db, b, "fakeball")).toMatchObject({ wins: 2, losses: 0 });
      expect(ratingOf(db, a, "fakeball")).toMatchObject({ wins: 0, losses: 2 });
      expect(leaderboard(db, "tennis", null).top.map((r) => [r.name, r.rating])).toEqual([
        ["Tennis Ace", 1016],
        ["Fake Star", 984],
      ]);
      expect(leaderboard(db, "fakeball", null).top.map((r) => r.name)).toEqual(["Fake Star", "Tennis Ace"]);
      expect(leaderboard(db, "fakeball", null).top[0].rating).toBeGreaterThan(1000);
    } finally {
      delete games.fakeball;
    }
  });
});

describe("the leaderboard (task 7)", () => {
  it("lists accounts only, hides demo accounts, highlights you, and gives your rank outside the top list", () => {
    const db = freshDb();
    const players = Array.from({ length: 5 }, (_, i) => account(db, `Player ${String.fromCharCode(65 + i)}`));
    let t = 1;
    // A beats everyone, B beats C..E, and so on: a clear order
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) recordResult(db, rated(players[i], players[j]), t++);
    // the demo accounts play a rated match: their ratings move but they're hidden
    recordResult(db, rated("demo-1", "demo-2"), t++);
    expect(ratingOf(db, "demo-1", "tennis").rating).toBe(1016);

    const board = leaderboard(db, "tennis", players[4], 3);
    expect(board.top.map((r) => r.name)).toEqual(["Player A", "Player B", "Player C"]);
    expect(board.top.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(board.top.some((r) => r.you)).toBe(false);
    expect(board.you).toMatchObject({ name: "Player E", rank: 5, wins: 0, losses: 4, you: true });
    const all = leaderboard(db, "tennis", players[0]);
    expect(all.top.map((r) => r.name)).not.toContain("Demo One");
    expect(all.top.map((r) => r.name)).not.toContain("Demo Two");
    expect(all.top.find((r) => r.you)!.name).toBe("Player A");
    // a demo account still sees its own row and rank
    expect(leaderboard(db, "tennis", "demo-1").you).toMatchObject({ name: "Demo One", rating: 1016 });
  });

  it("guests are never on it, even with match rows", () => {
    const db = freshDb();
    const a = account(db, "Real Account");
    const g = guest(db);
    recordResult(db, rated(a, g, { accounts: [true, false] }));
    expect(leaderboard(db, "tennis", g).top).toEqual([]);
    expect(leaderboard(db, "tennis", g).you).toBeNull();
  });

  it("a deleted account leaves the board and shows as Deleted player in its opponent's history", () => {
    const db = freshDb();
    const a = account(db, "Stays Here");
    const b = account(db, "Goes Away");
    recordResult(db, rated(a, b), 1);
    recordResult(db, rated(b, a, { bestRally: 9 }), 2);
    deleteAccount(db, b);
    expect(leaderboard(db, "tennis", null).top.map((r) => r.name)).toEqual(["Stays Here"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE player = ?").get(b)).toEqual({ n: 0 });
    const h = history(db, a);
    expect(h.map((m) => [m.opponent, m.result])).toEqual([
      ["Deleted player", "lost"],
      ["Deleted player", "won"],
    ]);
    // the opponent's rating is unchanged by the deletion
    expect(ratingOf(db, a, "tennis").wins).toBe(1);
    // and a recompute after the deletion keeps no rating for the deleted side
    recomputeRatings(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE player LIKE 'deleted:%'").get()).toEqual({ n: 0 });
  });
});

describe("history and the longest rally (task 7)", () => {
  it("lists your matches newest first from your side, with the rally record", () => {
    const db = freshDb();
    const a = account(db, "History Buff");
    const b = account(db, "Rival Name");
    recordResult(db, rated(a, b, { sets: [[6, 4]], bestRally: 7 }), 10);
    recordResult(db, rated(b, a, { sets: [[6, 2]], bestRally: 12 }), 20);
    recordResult(db, { ...rated(a, b), practice: true, tokens: [a, null], bestRally: 3, ratedRequested: false }, 30);
    const h = history(db, a);
    expect(h.map((m) => [m.opponent, m.result, m.rated])).toEqual([
      ["Bot", "won", false],
      ["Rival Name", "lost", true],
      ["Rival Name", "won", true],
    ]);
    // seen from the loser's side the games are flipped
    expect(h[1].sets).toEqual([[2, 6]]);
    expect(longestRally(db, a)).toBe(12);
  });
});

describe("survives a restart (task 7)", () => {
  it("rating and history are still there after the database is closed and opened again", () => {
    const path = freshFile();
    let db = freshDb(path);
    const a = account(db, "Persistent One");
    const b = account(db, "Persistent Two");
    recordResult(db, rated(a, b));
    db.close();
    db = freshDb(path);
    expect(ratingOf(db, a, "tennis").rating).toBe(1016);
    expect(history(db, a)).toHaveLength(1);
    expect(leaderboard(db, "tennis", a).you).toMatchObject({ rank: 1, rating: 1016 });
    db.close();
  });

  it("schema v6 opens a v5 database: rows kept, old guest 'rated' rows unrated, ratings start empty", () => {
    const path = freshFile();
    const db = new DatabaseSync(path);
    // v5: build it through the real steps, then put the version back to 5 after adding a row
    migrate(db);
    // (and undo v7, task 25, which came later)
    db.exec("ALTER TABLE players DROP COLUMN camera_settings; DROP TABLE ratings; DROP INDEX IF EXISTS matches_p0; DROP INDEX IF EXISTS matches_p1; UPDATE schema_version SET version = 5;");
    db.prepare(
      "INSERT INTO matches (room, game, p0, p1, score0, score1, winner, ended_at, format, sets, practice, rated) VALUES ('OLD5', 'tennis', 'g1', 'g2', 1, 0, 0, 5, 'oneSet', '[[6,0]]', 0, 1)",
    ).run();
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT room, rated FROM matches").all()).toEqual([{ room: "OLD5", rated: 0 }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ratings").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("the rated option (task 7)", () => {
  type Fake = Client & { seen: ServerMsg[] };
  const fake = (token: string, account = true): Fake => {
    const seen: ServerMsg[] = [];
    return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, account, look: null, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
  };
  const lobbyOf = (c: Fake) => [...c.seen].reverse().find((m) => m.t === "lobby") as Extract<ServerMsg, { t: "lobby" }>;

  function setup(practice = false) {
    let now = 0;
    const records: MatchRecord[] = [];
    const room = new Room("RTD", "tennis", practice, "oneSet", {
      record: (m) => records.push(m),
      clock: () => now,
      log: () => {},
      timer: false,
      timing: { countdownMs: 50, graceMs: 200 },
      onDestroy: () => {},
      ratingOf: () => 1234,
    });
    return { room, records, step: (ms: number) => ((now += ms), room.pump()) };
  }

  it("the host sets it, a change clears both ready flags, and only the host can", () => {
    const { room } = setup();
    const a = fake("a");
    const b = fake("b");
    room.join(a);
    room.join(b);
    expect(lobbyOf(a)).toMatchObject({ rated: false, ratedBlocked: null, ratings: [1234, 1234] });
    room.ready(a, true);
    room.ready(b, true);
    expect(room.setRated(b, true)).toMatch(/host/);
    expect(lobbyOf(a).rated).toBe(false);
    expect(room.setRated(a, true)).toBeNull();
    const v = lobbyOf(b);
    expect(v.rated).toBe(true);
    expect(v.seats.map((s) => s!.ready)).toEqual([false, false]);
    expect(v.phase).toBe("ready-check");
  });

  it("a guest seat makes it unavailable, with the reason; the result is stored unrated even with the option on", () => {
    const { room, records, step } = setup();
    const a = fake("a");
    const g = fake("g", false);
    room.join(a);
    room.join(g);
    room.setRated(a, true);
    const v = lobbyOf(a);
    expect(v.ratedBlocked).toMatch(/guest/i);
    expect(v.ratings).toEqual([1234, null]);
    // the record the room would write says who was an account
    room.ready(a, true);
    room.ready(g, true);
    for (let i = 0; i < 10; i++) step(16);
    expect(records).toEqual([]);
    expect(lobbyOf(a).phase).toBe("playing");
  });

  it("unlimited, practice and one account on both seats are blocked", () => {
    const l = new Lobby(false, "unlimited");
    l.sit(0, "a", "A", 0, { account: true });
    l.sit(1, "b", "B", 0, { account: true });
    expect(l.ratedBlocked()).toMatch(/unlimited/i);
    expect(new Lobby(true).ratedBlocked()).toMatch(/practice/i);
    const same = new Lobby(false);
    same.sit(0, "a", "A", 0, { account: true });
    same.sit(1, "a", "A", 0, { account: true });
    expect(same.ratedBlocked()).toMatch(/both seats/i);
    const ok = new Lobby(false);
    ok.sit(0, "a", "A", 0, { account: true });
    ok.sit(1, "b", "B", 0, { account: true });
    expect(ok.ratedBlocked()).toBeNull();
    // once started it can't change
    ok.setReady(0, true, 0);
    ok.setReady(1, true, 0);
    ok.tick(10_000);
    expect(ok.setRated(0, true, 10_000)).toBe("started");
  });

  it("a finished match carries the host's choice and who was an account into its record", () => {
    const { room, records } = setup();
    const a = fake("a");
    const b = fake("b");
    room.join(a);
    room.join(b);
    room.setRated(a, true);
    // reach into the record the room builds for a finished match
    const rec = (room as unknown as { seatsForRecord(): Pick<MatchRecord, "accounts" | "ratedRequested"> }).seatsForRecord();
    expect(rec).toEqual({ accounts: [true, true], ratedRequested: true });
    expect(records).toEqual([]);
  });
});

// ---- the running app ----

const base = inject("baseUrl");

describe("rated option and leaderboard over the network (running app)", () => {
  it("a hostile client can't force rated: a non-host, a guest room and bad values are refused", async () => {
    const wsUrl = new URL("/ws", base);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const connect = async () => {
      const res = await fetch(new URL("/api/me", base));
      const cookie = res.headers.getSetCookie()[0].split(";")[0];
      const ws = new WebSocket(wsUrl, { headers: { cookie } });
      const seen: ServerMsg[] = [];
      ws.on("message", (d) => seen.push(JSON.parse(d.toString()) as ServerMsg));
      await new Promise((r) => ws.once("open", r));
      ws.send(JSON.stringify({ t: "hello" }));
      return { ws, seen };
    };
    const wait = async (seen: ServerMsg[], ok: (m: ServerMsg) => boolean) => {
      const deadline = Date.now() + 5000;
      for (;;) {
        const i = seen.findIndex(ok);
        if (i !== -1) return seen.splice(i, 1)[0];
        if (Date.now() > deadline) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const host = await connect();
    host.ws.send(JSON.stringify({ t: "create", game: "tennis", practice: false }));
    const room = (await wait(host.seen, (m) => m.t === "room")) as Extract<ServerMsg, { t: "room" }>;
    const joiner = await connect();
    joiner.ws.send(JSON.stringify({ t: "join", room: room.room }));
    await wait(joiner.seen, (m) => m.t === "room");
    for (const bad of [{ t: "rated" }, { t: "rated", rated: "yes" }, { t: "rated", rated: 1 }]) {
      host.ws.send(JSON.stringify(bad));
      expect(((await wait(host.seen, (m) => m.t === "error")) as { message: string }).message).toMatch(/bad message/);
    }
    joiner.ws.send(JSON.stringify({ t: "rated", rated: true }));
    expect(((await wait(joiner.seen, (m) => m.t === "error")) as { message: string }).message).toMatch(/host/);
    // the host may turn it on, but two guests can't play rated
    host.ws.send(JSON.stringify({ t: "rated", rated: true }));
    const l = (await wait(host.seen, (m) => m.t === "lobby" && m.rated)) as Extract<ServerMsg, { t: "lobby" }>;
    expect(l.ratedBlocked).toMatch(/guest/i);
    expect(l.ratings).toEqual([null, null]);
    host.ws.close();
    joiner.ws.close();
  });

  it("serves a board per registered sport, and none for an unknown one", async () => {
    const res = await fetch(new URL("/api/leaderboard?sport=tennis", base));
    expect(res.status).toBe(200);
    const board = (await res.json()) as { sport: string; top: { name: string }[]; you: unknown };
    expect(board.sport).toBe("tennis");
    expect(board.you).toBeNull();
    expect(board.top.map((r) => r.name)).not.toContain("Demo One");
    for (const bad of ["", "nope", "__proto__", "constructor"]) {
      expect((await fetch(new URL(`/api/leaderboard?sport=${bad}`, base))).status, bad).toBe(404);
    }
  });
});
