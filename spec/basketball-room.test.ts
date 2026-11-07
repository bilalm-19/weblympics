// Basketball through the same Room, Lobby and protocol as the other games
// (task 32), with a fake clock and fake sockets like spec/archery-room.test.ts;
// and a rated shootout moving only the basketball rating on a throwaway db.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { addPasskey, guestFor, newGuestToken } from "../server/accounts.ts";
import { START_RATING, ratingOf, recordResult } from "../server/ratings.ts";
import { lateShotTicks } from "../server/rewind.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { asRoomFormat } from "../server/rooms.ts";
import { isRated, migrate } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";
import { SHOT_CLOCK_TICKS } from "../shared/games/basketball/sim.ts";
import type { BasketballSnapshot } from "../shared/games/basketball/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { powerFor } from "./basketball-helpers.ts";

const COUNTDOWN = 100;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function setup(format: RoomFormat = "shootout", practice = false) {
  let now = 0;
  const records: MatchRecord[] = [];
  const room = new Room("HOOP", "basketball", practice, format, {
    record: (m) => records.push(m),
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: 500 },
    onDestroy: () => {},
  });
  const run = (ms: number) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      room.pump();
    }
  };
  return { room, records, run };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const lobby = (c: Fake) => last(c, "lobby") as (LobbyView & { t: "lobby" }) | undefined;
const state = (c: Fake) => last(c, "state")!.state as BasketballSnapshot;

function seated(format: RoomFormat = "shootout", opts: { rated?: boolean } = {}) {
  const s = setup(format);
  const a = client("a");
  const b = client("b");
  if (opts.rated) {
    a.account = true;
    b.account = true;
  }
  s.room.join(a);
  s.room.join(b);
  if (opts.rated) expect(s.room.setRated(a, true)).toBeNull();
  s.room.ready(a, true);
  s.room.ready(b, true);
  s.run(COUNTDOWN + 50);
  return { ...s, a, b };
}

/** Runs until it is `c`'s turn, shoots `power`, then lets the result play out. */
function shootAs(s: ReturnType<typeof seated>, c: Fake, power: number) {
  for (let i = 0; i < 2000 && !(state(c).phase === "aim" && state(c).turn === c.seat); i++) s.run(16);
  s.room.hoop(c, { t: "shoot", power, aim: 0, at: 0 });
  s.run(4500);
}

/** Both seats swish all ten shots: level, so the room reaches the tie vote. */
function playLevel(s: ReturnType<typeof seated>) {
  for (let i = 0; i < 10; i++) {
    const shooter = state(s.a).turn === 0 ? s.a : s.b;
    shootAs(s, shooter, powerFor(state(s.a).spot, "swish"));
  }
  expect(state(s.a).phase).toBe("tie-vote");
}

/** Seat 0 swishes, seat 1 misses, through all ten shots. */
function playOneSided(s: ReturnType<typeof seated>) {
  for (let i = 0; i < 10; i++) {
    const shooter = state(s.a).turn === 0 ? s.a : s.b;
    const spot = state(s.a).spot;
    shootAs(s, shooter, shooter === s.a ? powerFor(spot, "swish") : powerFor(spot, "miss"));
  }
  s.run(500);
}

describe("basketball rooms", () => {
  it("offers its own formats: the shootout by default, or unlimited", () => {
    expect(asRoomFormat(undefined, "basketball")).toBe("shootout");
    expect(asRoomFormat("unlimited", "basketball")).toBe("unlimited");
    expect(asRoomFormat("stages", "basketball")).toBe("shootout");
    expect(asRoomFormat("shootout", "tennis")).toBe("oneSet");
    const s = setup();
    const a = client("a");
    s.room.join(a);
    expect(s.room.format(a, "oneSet")).toMatch(/no such format/);
    expect(s.room.format(a, "unlimited")).toBeNull();
    expect(lobby(a)!.format).toBe("unlimited");
  });

  it("parses set, aim and shoot exactly, and drops them whole with any extra field", () => {
    expect(parseClientMsg(JSON.stringify({ t: "set" }))).toEqual({ t: "set" });
    expect(parseClientMsg(JSON.stringify({ t: "aim", aim: -0.4 }))).toEqual({ t: "aim", aim: -0.4 });
    expect(parseClientMsg(JSON.stringify({ t: "shoot", power: 0.5, aim: 0.1, at: 99 }))).toEqual({ t: "shoot", power: 0.5, aim: 0.1, at: 99 });
    // archery's aim still parses as archery's
    expect(parseClientMsg(JSON.stringify({ t: "aim", yaw: 0.1, pitch: 0, draw: 1 }))).toEqual({ t: "aim", yaw: 0.1, pitch: 0, draw: 1 });
    for (const junk of [
      { t: "set", seat: 1 },
      { t: "aim", aim: 0.1, yaw: 0 },
      { t: "aim", aim: "left" },
      { t: "shoot", power: 0.5, aim: 0 },
      { t: "shoot", power: 0.5, aim: 0, at: 0, made: true },
      { t: "shoot", power: 0.5, aim: 0, at: "now" },
    ]) {
      expect(parseClientMsg(JSON.stringify(junk))).toBeNull();
    }
  });

  it("the server flies the shooter's ball and scores it; the other seat can't shoot out of turn", () => {
    const s = seated();
    expect(state(s.a).turn).toBe(0);
    s.room.hoop(s.b, { t: "shoot", power: powerFor(0, "swish"), aim: 0, at: 0 });
    s.run(100);
    expect(state(s.a).phase).toBe("aim");
    shootAs(s, s.a, powerFor(0, "swish"));
    expect(state(s.b).shots[0]).toMatchObject({ seat: 0, made: true, swish: true, points: 3 });
    expect(state(s.b).totals[0]).toBe(3);
    expect(state(s.b).turn).toBe(1);
  });

  it("the shooter's set and aim reach every viewer", () => {
    const s = seated();
    s.room.hoop(s.a, { t: "set" });
    s.room.hoop(s.a, { t: "aim", aim: 0.3 });
    s.room.hoop(s.a, { t: "aim", aim: 0.35 });
    s.run(100);
    expect(state(s.b)).toMatchObject({ set: true, clockRunning: true, aim: [0.35, 0] });
  });

  it("a spectator's set, aim and shot are ignored", () => {
    const s = seated();
    const w = client("w");
    s.room.join(w, true);
    s.room.hoop(w, { t: "set" });
    s.room.hoop(w, { t: "shoot", power: 0.3, aim: 0, at: 0 });
    s.run(100);
    expect(state(w)).toMatchObject({ phase: "aim", set: false });
  });

  it("a late shot's grace is the seat's round trip, capped at 150 ms; unmeasured lag gets none", () => {
    expect(lateShotTicks(null)).toBe(0);
    expect(lateShotTicks(0)).toBe(0);
    expect(lateShotTicks(50)).toBe(3);
    expect(lateShotTicks(150)).toBe(9);
    expect(lateShotTicks(2000)).toBe(9);
    // through the room: the same shot just after the buzzer counts with an
    // 80 ms round trip (5 ticks of grace) and is lost with none measured
    const lateShot = (rtt: number | null) => {
      const s = seated();
      s.a.rtt = rtt;
      s.room.hoop(s.a, { t: "set" });
      s.run(50);
      expect(state(s.a).clockRunning).toBe(true);
      // to 2 ticks after the buzzer (the clock started on the set's tick)
      s.run(Math.ceil(((SHOT_CLOCK_TICKS + 2) * 1000) / 60) - 50);
      s.room.hoop(s.a, { t: "shoot", power: powerFor(0, "swish"), aim: 0, at: 0 });
      s.run(4000);
      return state(s.b).shots[0];
    };
    expect(lateShot(80)).toMatchObject({ seat: 0, made: true });
    expect(lateShot(null)).toMatchObject({ seat: 0, made: false, lost: "time" });
  });

  it("a finished shootout is recorded as basketball, unrated unless the host asked and both seats are accounts", () => {
    const s = seated();
    playOneSided(s);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "basketball", format: "shootout", winner: 0, practice: false, score: [19, 0] });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("a finished shootout between two accounts with rated on is rated by isRated", () => {
    const s = seated("shootout", { rated: true });
    playOneSided(s);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "basketball", format: "shootout", winner: 0, practice: false });
    expect(isRated(s.records[0])).toBe(true);
  });

  it("a level shootout asks both players through the room; a spectator's vote is ignored; a draw vote ends it as a rated draw", () => {
    const s = seated("shootout", { rated: true });
    playLevel(s);
    const w = client("w");
    s.room.join(w, true);
    s.room.hoop(w, { t: "tie", choice: "draw" });
    s.run(100);
    expect(state(w)).toMatchObject({ phase: "tie-vote", vote: { votes: [null, null] } });
    expect(parseClientMsg(JSON.stringify({ t: "tie", choice: "continue" }))).toEqual({ t: "tie", choice: "continue" });
    expect(parseClientMsg(JSON.stringify({ t: "tie", choice: "maybe" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "tie", choice: "draw", seat: 0 }))).toBeNull();
    s.room.hoop(s.a, { t: "tie", choice: "continue" });
    s.run(100);
    expect(state(s.b).vote!.votes).toEqual(["continue", null]);
    s.room.hoop(s.b, { t: "tie", choice: "draw" });
    s.run(100);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "basketball", format: "shootout", winner: null, draw: true, score: [19, 19] });
    expect(isRated(s.records[0])).toBe(true);
  });

  it("both continue through the room: a sudden-death round decides it", () => {
    const s = seated();
    playLevel(s);
    s.room.hoop(s.a, { t: "tie", choice: "continue" });
    s.room.hoop(s.b, { t: "tie", choice: "continue" });
    s.run(100);
    expect(state(s.a)).toMatchObject({ phase: "aim", suddenDeath: true, turn: 1 });
    shootAs(s, s.b, powerFor(4, "miss"));
    shootAs(s, s.a, powerFor(4, "swish"));
    s.run(500);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "basketball", winner: 0, score: [19, 19] });
  });

  it("unlimited counts points and the best basket, and leaving stores it unrated", () => {
    const s = seated("unlimited");
    const spot = state(s.a).spot;
    shootAs(s, s.a, powerFor(spot, "swish"));
    const view = lobby(s.a)!;
    expect(state(s.a).format).toBe("unlimited");
    expect(view.tally!.points[0]).toBe(state(s.a).totals[0]);
    expect(view.tally!.points[0]).toBeGreaterThan(0);
    expect(view.tally!.bestRally).toBe(view.tally!.points[0]);
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "basketball", format: "unlimited", winner: null });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("practice vs the bot starts at once, the bot shoots its turns, and it is never rated", () => {
    const s = setup("shootout", true);
    const a = client("a");
    s.room.join(a);
    expect(lobby(a)!.phase).toBe("playing");
    // the person lets every clock run out; the bot still shoots its own turns
    s.run(60_000);
    const bot = state(a).shots.filter((sh) => sh.seat === 1);
    expect(bot.length).toBeGreaterThan(0);
    expect(bot.some((sh) => !sh.lost)).toBe(true);
    expect(s.records.every((r) => !isRated(r))).toBe(true);
  });

  it("a bot match plays to the end in a practice room and records game: basketball, unrated", () => {
    const s = setup("shootout", true);
    const a = client("a");
    s.room.join(a);
    // the person shoots a swish each turn: the match ends (practice records it, then starts another)
    for (let i = 0; i < 400 && s.records.length === 0; i++) {
      const st = state(a);
      if (st.phase === "aim" && st.turn === 0) s.room.hoop(a, { t: "shoot", power: powerFor(st.spot, "swish"), aim: 0, at: 0 });
      s.run(500);
    }
    expect(s.records.length).toBeGreaterThanOrEqual(1);
    expect(s.records[0]).toMatchObject({ game: "basketball", format: "shootout", practice: true });
    expect(s.records[0].winner === 0 || s.records[0].winner === 1).toBe(true);
    expect(isRated(s.records[0])).toBe(false);
  });
});

describe("basketball ratings", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function freshDb(): DatabaseSync {
    const d = mkdtempSync(join(tmpdir(), "weblympics-hoop-"));
    dirs.push(d);
    const db = new DatabaseSync(join(d, "app.db"));
    migrate(db);
    return db;
  }

  function account(db: DatabaseSync): string {
    const t = newGuestToken();
    guestFor(db, t);
    addPasskey(db, t, { id: `k-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
    return t;
  }

  it("a rated shootout moves only the basketball rating", () => {
    const db = freshDb();
    const p = account(db);
    const q = account(db);
    const s = seated("shootout", { rated: true });
    playOneSided(s);
    const m = { ...s.records[0], tokens: [p, q] as [string, string] };
    expect(recordResult(db, m).rated).toBe(true);
    expect(ratingOf(db, p, "basketball").rating).toBeGreaterThan(START_RATING);
    expect(ratingOf(db, q, "basketball").rating).toBeLessThan(START_RATING);
    for (const sport of ["tennis", "archery", "track", "boxing"]) {
      expect(ratingOf(db, p, sport).rating).toBe(START_RATING);
      expect(ratingOf(db, q, sport).rating).toBe(START_RATING);
    }
    const row = db.prepare("SELECT game, rated FROM matches").get() as { game: string; rated: number };
    expect(row).toEqual({ game: "basketball", rated: 1 });
  });

  it("a drawn shootout between two accounts is stored as a rated draw and moves no rating", () => {
    const db = freshDb();
    const p = account(db);
    const q = account(db);
    const s = seated("shootout", { rated: true });
    playLevel(s);
    // nobody votes: the 15 s vote clock runs out to a draw
    s.run(16_000);
    expect(s.records).toHaveLength(1);
    const m = { ...s.records[0], tokens: [p, q] as [string, string] };
    expect(m).toMatchObject({ winner: null, draw: true });
    expect(recordResult(db, m)).toEqual({ rated: true, delta: 0 });
    for (const sport of ["basketball", "tennis", "archery", "track", "boxing"]) {
      expect(ratingOf(db, p, sport).rating).toBe(START_RATING);
      expect(ratingOf(db, q, sport).rating).toBe(START_RATING);
    }
    const row = db.prepare("SELECT game, rated, winner FROM matches").get() as { game: string; rated: number; winner: number | null };
    expect(row).toEqual({ game: "basketball", rated: 1, winner: null });
  });
});
