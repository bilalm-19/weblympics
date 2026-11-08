// Track (task 26) through the same Room, Lobby and protocol as tennis and
// archery, with a fake clock and fake sockets like spec/archery-room.test.ts.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { TrackSnapshot } from "../shared/games/track/sim.ts";
import { SET_TICKS } from "../shared/games/track/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { asRoomFormat } from "../server/rooms.ts";
import { insertMatch, isRated, migrate, parseSetsColumn } from "../server/schema.ts";
import type { MatchRecord } from "../server/schema.ts";

const COUNTDOWN = 100;
const GRACE = 500;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function setup(format: RoomFormat = "race", practice = false) {
  let now = 0;
  const records: MatchRecord[] = [];
  const room = new Room("TRAK", "track", practice, format, {
    record: (m) => records.push(m),
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: GRACE },
    onDestroy: () => {},
  });
  const run = (ms: number, each?: () => void) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      each?.();
      room.pump();
    }
  };
  return { room, records, run, now: () => now };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const lobby = (c: Fake) => last(c, "lobby") as (LobbyView & { t: "lobby" }) | undefined;
const state = (c: Fake) => last(c, "state")!.state as TrackSnapshot;

/** `opts.rated`: both seats are accounts and the host (seat 0) turns the rated option on (task 7). */
function seated(format: RoomFormat = "race", opts: { rated?: boolean } = {}) {
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
  // through "set" to the gun
  s.run(SET_TICKS * 17 + 50);
  return { ...s, a, b };
}

/** A runner stepping every `ms` on alternate feet, timestamped by the fake clock. */
function stepper(s: ReturnType<typeof setup>, c: Fake, ms: number) {
  let next = s.now();
  let side: "left" | "right" = "left";
  return () => {
    if (s.now() < next) return;
    s.room.step(c, { t: "step", side, at: s.now() });
    side = side === "left" ? "right" : "left";
    next += ms;
  };
}

describe("track rooms", () => {
  it("offers its own formats: a race by default, or unlimited", () => {
    expect(asRoomFormat(undefined, "track")).toBe("race");
    expect(asRoomFormat("unlimited", "track")).toBe("unlimited");
    expect(asRoomFormat("stages", "track")).toBe("race");
    expect(asRoomFormat("race", "tennis")).toBe("oneSet");
    const s = setup();
    const a = client("a");
    s.room.join(a);
    expect(s.room.format(a, "oneSet")).toMatch(/no such format/);
    expect(s.room.format(a, "unlimited")).toBeNull();
    expect(lobby(a)!.format).toBe("unlimited");
  });

  it("parses step messages; a client can't send a distance, a speed or a finish", () => {
    expect(parseClientMsg(JSON.stringify({ t: "step", side: "left", at: 123.5 }))).toEqual({ t: "step", side: "left", at: 123.5 });
    expect(parseClientMsg(JSON.stringify({ t: "step", side: "left", at: 1, distance: 100 }))).toEqual({ t: "step", side: "left", at: 1 });
    expect(parseClientMsg(JSON.stringify({ t: "step", side: "both", at: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "step", side: "left" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "finish", time: 1 }))).toBeNull();
  });

  function raceToTheLine(s: ReturnType<typeof seated>) {
    const fast = stepper(s, s.a, 125);
    const slow = stepper(s, s.b, 170);
    s.run(30_000, () => {
      fast();
      slow();
    });
  }

  it("the server runs each lane from its own steps; the faster runner wins, and it is unrated unless the host asked and both seats are accounts (task 7)", () => {
    const s = seated();
    expect(state(s.a).phase).toBe("running");
    raceToTheLine(s);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "track", format: "race", winner: 0, practice: false, score: [1, 0] });
    expect(isRated(s.records[0])).toBe(false);
    const snap = state(s.b);
    expect(snap.lanes[0].finish).toBeLessThan(snap.lanes[1].finish!);
    // back to the ready check for a rematch
    expect(lobby(s.a)!.phase).toBe("ready-check");
  });

  it("a race is rated when the host turns it on and both seats are accounts", () => {
    const s = seated("race", { rated: true });
    raceToTheLine(s);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "track", format: "race", winner: 0, practice: false });
    expect(isRated(s.records[0])).toBe(true);
  });

  it("a flood of steps from one seat is cut at the door and capped by the sim", () => {
    const s = seated();
    let side: "left" | "right" = "left";
    // 200 steps in one tick, every tick: far past any human cadence
    s.run(3000, () => {
      for (let i = 0; i < 200; i++) {
        s.room.step(s.a, { t: "step", side, at: s.now() + i });
        side = side === "left" ? "right" : "left";
      }
    });
    const lane = state(s.b).lanes[0];
    // the cap is 10 steps a second, so 3 s can't count more than ~32
    expect(lane.steps).toBeLessThanOrEqual(33);
    expect(lane.speed).toBeLessThanOrEqual(10);
  });

  it("a spectator sees both lanes; a mid-race drop holds the seat and the same token reclaims it", () => {
    const s = seated();
    const watcher = client("w");
    s.room.join(watcher);
    expect(watcher.seat).toBeNull();
    const run = stepper(s, s.a, 130);
    s.run(1000, run);
    expect(state(watcher).lanes[0].distance).toBeGreaterThan(0);
    s.room.leave(s.b, true);
    expect(lobby(s.a)!.phase).toBe("paused");
    expect(lobby(s.a)!.hold).toMatchObject({ seat: 1, name: "b" });
    // paused: nobody runs (let the last broadcast after the drop arrive first)
    s.run(50);
    const frozen = state(s.a).lanes[0].distance;
    s.run(200, run);
    expect(state(s.a).lanes[0].distance).toBe(frozen);
    const back = client("b");
    s.room.join(back);
    expect(back.seat).toBe(1);
    s.run(COUNTDOWN + 50);
    expect(lobby(s.a)!.phase).toBe("playing");
  });

  it("unlimited counts races won and leaving stores it unrated", () => {
    const s = seated("unlimited");
    const fast = stepper(s, s.a, 125);
    s.run(20_000, fast);
    expect(lobby(s.a)!.tally!.points[0]).toBeGreaterThanOrEqual(1);
    expect(s.records).toHaveLength(0);
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "track", format: "unlimited", winner: null });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("practice vs the bot starts at once, the bot runs its lane, and it is never rated", () => {
    const s = setup("race", true);
    const a = client("a");
    s.room.join(a);
    expect(lobby(a)!.phase).toBe("playing");
    s.run(25_000);
    expect(state(a).lanes[1].steps).toBeGreaterThan(20);
    expect(s.records.length).toBeGreaterThan(0);
    expect(s.records.every((r) => r.practice && !isRated(r))).toBe(true);
  });
});

// Task 27: the event picker (sprint or hurdles), jumps through the room, and
// the stored row naming the event, for the stats task.
function eventRace(event: "sprint" | "hurdles", format: RoomFormat = "race") {
  const s = setup(format);
  const a = client("a");
  const b = client("b");
  s.room.join(a);
  s.room.join(b);
  if (event === "hurdles") expect(s.room.event(a, "hurdles")).toBeNull();
  s.room.ready(a, true);
  s.room.ready(b, true);
  s.run(COUNTDOWN + 50);
  s.run(SET_TICKS * 17 + 50);
  return { ...s, a, b };
}

describe("track rooms: the event (task 27)", () => {
  it("the sprint by default; the host picks hurdles, which clears both ready flags; the other seat can't", () => {
    const s = setup();
    const a = client("a");
    const b = client("b");
    s.room.join(a);
    s.room.join(b);
    expect(lobby(a)!.event).toBe("sprint");
    expect(state(a).event).toBe("sprint");
    s.room.ready(a, true);
    s.room.ready(b, true);
    expect(s.room.event(b, "hurdles")).toMatch(/only the host/);
    expect(s.room.event(a, "hurdles")).toBeNull();
    const v = lobby(b)!;
    expect(v.event).toBe("hurdles");
    expect(v.seats.map((x) => x!.ready)).toEqual([false, false]);
    expect(state(b).event).toBe("hurdles");
    expect(state(b).obstacles).toHaveLength(10);
  });

  it("a game without events refuses one; the event can't change mid-match", () => {
    const tennis = new Room("TENN", "tennis", false, "oneSet", { record: () => {}, clock: () => 0, log: () => {}, timer: false, timing: {}, onDestroy: () => {} });
    const t = client("t");
    tennis.join(t);
    expect(tennis.lobbyView().event).toBeNull();
    expect(tennis.event(t, "hurdles")).toMatch(/no such event/);
    const s = seated();
    expect(s.room.event(s.a, "hurdles")).toMatch(/started/);
  });

  it("jumps go through the room; the server judges each hurdle from its own sim", () => {
    const s = eventRace("hurdles");
    s.run(6000, stepper(s, s.a, 130));
    // never jumped: every hurdle reached so far is down
    const lane = state(s.b).lanes[0];
    expect(lane.distance).toBeGreaterThan(state(s.b).obstacles[0]);
    expect(lane.cleared).toBe(0);
    expect(lane.hit).toBeGreaterThan(0);
    s.room.step(s.a, { t: "jump", at: s.now() });
    s.run(50);
    expect(state(s.b).lanes[0].jumps).toBe(1);
  });

  for (const event of ["sprint", "hurdles"] as const) {
    it(`a finished ${event} race's stored row says "${event}", with each seat's time${event === "hurdles" ? " and hurdles" : ""}`, () => {
      const s = eventRace(event);
      const fast = stepper(s, s.a, 125);
      // under FULL_CADENCE, so it is slower whatever the hurdles do (170 ms until FULL_CADENCE went to 4)
      const slow = stepper(s, s.b, 330);
      s.run(40_000, () => {
        fast();
        slow();
      });
      expect(s.records).toHaveLength(1);
      const r = s.records[0];
      expect(r).toMatchObject({ game: "track", format: "race", winner: 0 });
      expect(r.detail!.event).toBe(event);
      const times = r.detail!.times as [number, number];
      expect(times[0]).toBeLessThan(times[1]);
      if (event === "hurdles") {
        expect(r.detail!.cleared).toEqual([0, 0]);
        expect(r.detail!.hit).toEqual([10, 10]);
      } else expect(r.detail!.cleared).toBeUndefined();
      // through the real table: the event is in the row's JSON column, and the sets still read as before
      const db = new DatabaseSync(":memory:");
      migrate(db);
      insertMatch(db, r);
      const row = db.prepare("SELECT game, sets FROM matches").get() as { game: string; sets: string };
      expect(row.game).toBe("track");
      expect(JSON.parse(row.sets).event).toBe(event);
      const parsed = parseSetsColumn(row.sets);
      expect(parsed.sets).toEqual([]);
      expect(parsed.detail).toMatchObject({ event, times });
      db.close();
    });
  }

  it("unlimited hurdles' row (stored on leaving) says hurdles too, with the best times", () => {
    const s = eventRace("hurdles", "unlimited");
    // knocking every hurdle down is slow, and the other runner never starts: the race ends 5 s after a finish
    s.run(40_000, stepper(s, s.a, 125));
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ format: "unlimited", winner: null });
    expect(s.records[0].detail).toMatchObject({ event: "hurdles" });
    expect((s.records[0].detail!.times as Array<number | null>)[0]).toBeGreaterThan(0);
  });

  it("practice vs the bot: the player switches the event any time and the race restarts", () => {
    const s = setup("race", true);
    const a = client("a");
    s.room.join(a);
    s.run(3000);
    expect(s.room.event(a, "hurdles")).toBeNull();
    s.run(50);
    expect(state(a).event).toBe("hurdles");
    expect(state(a).lanes[1].distance).toBeLessThan(1);
    s.run(15_000);
    // the bot jumps its hurdles
    expect(state(a).lanes[1].jumps).toBeGreaterThan(0);
  });
});
