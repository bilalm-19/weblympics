// Bowling (task 29) through the same Room, Lobby and protocol as the other
// games, with a fake clock and fake sockets like spec/archery-room.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { addPasskey, guestFor, newGuestToken } from "../server/accounts.ts";
import { ratingOf, recordResult } from "../server/ratings.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { asRoomFormat } from "../server/rooms.ts";
import { isRated, migrate } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";
import type { BowlingSnapshot } from "../shared/games/bowling/sim.ts";
import { MAX_GRACE_TICKS, SHOT_CLOCK_TICKS } from "../shared/games/bowling/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { gutterBall, strikeBall } from "./bowling-helpers.ts";

const COUNTDOWN = 100;
const TICK = 1000 / 60;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function setup(format: RoomFormat = "game", practice = false) {
  let now = 0;
  const records: MatchRecord[] = [];
  const room = new Room("BOWL", "bowling", practice, format, {
    record: (m) => records.push(m),
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: 500 },
    onDestroy: () => {},
  });
  // a tick at a time
  const run = (ms: number, each?: () => void) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + TICK);
      each?.();
      room.pump();
    }
  };
  return { room, records, run, now: () => now };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const lobby = (c: Fake) => last(c, "lobby") as (LobbyView & { t: "lobby" }) | undefined;
const state = (c: Fake) => last(c, "state")!.state as BowlingSnapshot;

function seated(format: RoomFormat = "game", opts: { rated?: boolean } = {}) {
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

/** Plays until the game votes or ends: each seat throws its own ball as soon as it's their turn. */
function playOut(s: ReturnType<typeof seated>, ball: (seat: 0 | 1) => { speed: number; aim: number; spin: number }) {
  let thrownAt = -1;
  for (let i = 0; i < 20_000; i++) {
    const st = state(s.a);
    if (st.phase === "over" || st.phase === "tie-vote" || lobby(s.a)!.phase !== "playing") return;
    if (st.phase === "aim" && st.tick !== thrownAt) {
      thrownAt = st.tick;
      const c = st.turn === 0 ? s.a : s.b;
      s.room.bowl(c, { t: "throw", ...ball(st.turn), at: s.now() });
    }
    s.run(TICK * 2);
  }
}

describe("bowling rooms", () => {
  it("offers its own formats: a five-frame game by default, or unlimited", () => {
    expect(asRoomFormat(undefined, "bowling")).toBe("game");
    expect(asRoomFormat("unlimited", "bowling")).toBe("unlimited");
    expect(asRoomFormat("bout", "bowling")).toBe("game");
    expect(asRoomFormat("game", "tennis")).toBe("oneSet");
    const s = setup();
    const a = client("a");
    s.room.join(a);
    expect(s.room.format(a, "stages")).toMatch(/no such format/);
    expect(s.room.format(a, "unlimited")).toBeNull();
    expect(lobby(a)!.format).toBe("unlimited");
  });

  it("parses aim, throw and tie; a client can't send pins, a score or any extra field", () => {
    expect(parseClientMsg(JSON.stringify({ t: "aim", aim: -0.4 }))).toEqual({ t: "aim", aim: -0.4 });
    expect(parseClientMsg(JSON.stringify({ t: "throw", speed: 0.7, aim: 0.1, spin: -0.3, at: 99 }))).toEqual({ t: "throw", speed: 0.7, aim: 0.1, spin: -0.3, at: 99 });
    expect(parseClientMsg(JSON.stringify({ t: "tie", choice: "continue" }))).toEqual({ t: "tie", choice: "continue" });
    // archery's aim still parses as archery's
    expect(parseClientMsg(JSON.stringify({ t: "aim", yaw: 0.1, pitch: 0, draw: 0.5 }))).toEqual({ t: "aim", yaw: 0.1, pitch: 0, draw: 0.5 });
    for (const bad of [
      { t: "aim", aim: 0.1, yaw: 0 },
      { t: "aim", aim: "left" },
      { t: "throw", speed: 0.7, aim: 0, spin: 0, at: 1, pins: 10 },
      { t: "throw", speed: 0.7, aim: 0, spin: 0 },
      { t: "throw", speed: null, aim: 0, spin: 0, at: 1 },
      { t: "tie", choice: "win" },
      { t: "tie", choice: "draw", seat: 1 },
      { t: "strike" },
    ])
      expect(parseClientMsg(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
  });

  it("the server rolls the thrower's ball; the other seat can't throw out of turn, the aim reaches everyone", () => {
    const s = seated();
    s.room.bowl(s.b, { t: "throw", ...strikeBall(), at: 0 });
    s.room.bowl(s.a, { t: "aim", aim: 0.35 });
    s.run(100);
    expect(state(s.b)).toMatchObject({ phase: "aim", turn: 0 });
    expect(state(s.b).aims).toEqual([0.35, 0]);
    s.room.bowl(s.a, { t: "throw", ...strikeBall(), at: s.now() });
    s.run(6000);
    expect(state(s.b).last).toMatchObject({ seat: 0, strike: true, pins: 10 });
    expect(state(s.b).cards[0].frames[0].marks).toEqual(["X"]);
    expect(state(s.b).turn).toBe(1);
  });

  it("a throw after the buzzer counts within the seat's measured round trip, capped at 150 ms", () => {
    const lateBy = (rtt: number | null, ticksLate: number | null) => {
      const s = seated();
      s.a.rtt = rtt;
      // to just past the buzzer, by the game's own clock (the state goes out every other tick)
      while (state(s.a).phase === "aim" && state(s.a).phaseTick < SHOT_CLOCK_TICKS + (ticksLate ?? 0)) s.run(TICK);
      if (ticksLate !== null) s.room.bowl(s.a, { t: "throw", ...strikeBall(), at: s.now() });
      s.run(6000);
      return state(s.a).last!;
    };
    // 100 ms is 6 ticks of grace
    expect(lateBy(100, 3)).toMatchObject({ timeout: false, strike: true });
    // no measured round trip, no grace
    expect(lateBy(null, 2)).toMatchObject({ timeout: true, pins: 0 });
    // a huge round trip still gets only 9 ticks: just inside counts, and the clock still runs out
    expect(lateBy(5000, MAX_GRACE_TICKS - 2)).toMatchObject({ timeout: false });
    expect(lateBy(5000, null)).toMatchObject({ timeout: true });
  });

  it("a finished game between two accounts is recorded as bowling and rated", () => {
    const s = seated("game", { rated: true });
    playOut(s, (seat) => (seat === 0 ? strikeBall() : gutterBall));
    s.run(500);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "bowling", format: "game", winner: 0, score: [150, 0], practice: false });
    expect(isRated(s.records[0])).toBe(true);
    expect(lobby(s.a)!.phase).toBe("ready-check");
  });

  it("unrated unless the host asked and both seats are accounts", () => {
    const s = seated();
    playOut(s, (seat) => (seat === 1 ? strikeBall() : gutterBall));
    s.run(500);
    expect(s.records[0]).toMatchObject({ game: "bowling", winner: 1 });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("a level game votes; either seat's draw records a draw, rated between two accounts", () => {
    const s = seated("game", { rated: true });
    playOut(s, () => gutterBall);
    expect(state(s.a).phase).toBe("tie-vote");
    expect(state(s.b).vote!.votes).toEqual([null, null]);
    s.room.bowl(s.a, { t: "tie", choice: "continue" });
    s.run(100);
    expect(state(s.b).vote!.votes).toEqual(["continue", null]);
    s.room.bowl(s.b, { t: "tie", choice: "draw" });
    s.run(500);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "bowling", winner: null, draw: true, score: [0, 0] });
    expect(isRated(s.records[0])).toBe(true);
  });

  it("both continue bowl a tie frame through the room", () => {
    const s = seated();
    playOut(s, () => gutterBall);
    s.room.bowl(s.a, { t: "tie", choice: "continue" });
    s.room.bowl(s.b, { t: "tie", choice: "continue" });
    s.run(100);
    expect(state(s.a)).toMatchObject({ phase: "aim", tieFrame: 1, turn: 0 });
    playOut(s, (seat) => (seat === 1 ? strikeBall() : gutterBall));
    s.run(500);
    expect(s.records[0]).toMatchObject({ winner: 1, score: [0, 0] });
  });

  it("unlimited counts games won and the best score, a draw for nobody, and leaving stores it unrated", () => {
    const s = seated("unlimited");
    playOut(s, (seat) => (seat === 0 ? strikeBall() : gutterBall));
    s.run(500);
    expect(lobby(s.a)!.tally).toEqual({ points: [1, 0], bestRally: 150 });
    expect(s.records).toHaveLength(0);
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "bowling", format: "unlimited", winner: null, score: [1, 0] });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("practice vs the bot starts at once, plays a game to the end as bowling, and is never rated", () => {
    const s = setup("game", true);
    const a = client("a");
    s.room.join(a);
    expect(lobby(a)!.phase).toBe("playing");
    // the person lets every clock run out; the bot bowls its own frames,
    // and wins (a gutter game can't tie a bot that knocks a pin)
    s.run(12 * 25_000);
    expect(s.records.length).toBeGreaterThan(0);
    expect(s.records[0]).toMatchObject({ game: "bowling", format: "game", winner: 1, practice: true });
    expect(s.records[0].score[1]).toBeGreaterThan(0);
    expect(s.records.every((r) => !isRated(r))).toBe(true);
  });
});

describe("a rated bowling game moves only the bowling rating", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function account(db: DatabaseSync): string {
    const t = newGuestToken();
    guestFor(db, t);
    addPasskey(db, t, { id: `k-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
    return t;
  }

  it("a win moves both players' bowling rating and leaves tennis alone; a draw moves neither", () => {
    const d = mkdtempSync(join(tmpdir(), "weblympics-bowl-"));
    dirs.push(d);
    const db = new DatabaseSync(join(d, "app.db"));
    migrate(db);
    const a = account(db);
    const b = account(db);
    const s = seated("game", { rated: true });
    playOut(s, (seat) => (seat === 0 ? strikeBall() : gutterBall));
    s.run(500);
    const win = { ...s.records[0], tokens: [a, b] as [string, string] };
    expect(recordResult(db, win)).toMatchObject({ rated: true, delta: 16 });
    expect(ratingOf(db, a, "bowling")).toMatchObject({ rating: 1016, wins: 1 });
    expect(ratingOf(db, b, "bowling")).toMatchObject({ rating: 984, losses: 1 });
    expect(ratingOf(db, a, "tennis").rating).toBe(1000);
    expect(ratingOf(db, a, "archery").rating).toBe(1000);
    // a voted draw is stored rated, with no winner, and moves nobody (as boxing's)
    const t = seated("game", { rated: true });
    playOut(t, () => gutterBall);
    t.room.bowl(t.a, { t: "tie", choice: "draw" });
    t.run(500);
    expect(recordResult(db, { ...t.records[0], tokens: [a, b] })).toEqual({ rated: true, delta: 0 });
    expect(ratingOf(db, a, "bowling").rating).toBe(1016);
    const row = db.prepare("SELECT game, rated, winner FROM matches ORDER BY id DESC LIMIT 1").get();
    expect(row).toEqual({ game: "bowling", rated: 1, winner: null });
    db.close();
  });
});
