// Track (task 26) through the same Room, Lobby and protocol as tennis and
// archery, with a fake clock and fake sockets like spec/archery-room.test.ts.
import { describe, expect, it } from "vitest";
import type { TrackSnapshot } from "../shared/games/track/sim.ts";
import { SET_TICKS } from "../shared/games/track/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { asRoomFormat } from "../server/rooms.ts";
import { isRated } from "../server/schema.ts";
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
