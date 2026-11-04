// Boxing (task 30) through the same Room, Lobby and protocol as the other
// games, with a fake clock and fake sockets like spec/track-room.test.ts.
import { describe, expect, it } from "vitest";
import type { BoxingSnapshot } from "../shared/games/boxing/sim.ts";
import { DAMAGE, HEALTH, ROUND_TICKS, WINDUP_TICKS, damageFor } from "../shared/games/boxing/sim.ts";
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

function setup(format: RoomFormat = "bout", practice = false) {
  let now = 0;
  const records: MatchRecord[] = [];
  const room = new Room("BOXX", "boxing", practice, format, {
    record: (m) => records.push(m),
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: GRACE },
    onDestroy: () => {},
  });
  // a tick at a time (the room steps once per 1000/60 ms of clock)
  const run = (ms: number, each?: () => void) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 1000 / 60);
      each?.();
      room.pump();
    }
  };
  return { room, records, run, now: () => now };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const lobby = (c: Fake) => last(c, "lobby") as (LobbyView & { t: "lobby" }) | undefined;
const state = (c: Fake) => last(c, "state")!.state as BoxingSnapshot;

function seated(format: RoomFormat = "bout") {
  const s = setup(format);
  const a = client("a");
  const b = client("b");
  s.room.join(a);
  s.room.join(b);
  s.room.ready(a, true);
  s.room.ready(b, true);
  s.run(COUNTDOWN + 50);
  return { ...s, a, b };
}

/** Throws hooks with whichever hand is free, as fast as the rules allow. */
function puncher(s: ReturnType<typeof setup>, c: Fake) {
  let hand: "left" | "right" = "left";
  return () => {
    s.room.box(c, { t: "punch", kind: "hook", hand, at: s.now() });
    hand = hand === "left" ? "right" : "left";
  };
}

describe("boxing rooms", () => {
  it("offers its own formats: a bout by default, or unlimited", () => {
    expect(asRoomFormat(undefined, "boxing")).toBe("bout");
    expect(asRoomFormat("unlimited", "boxing")).toBe("unlimited");
    expect(asRoomFormat("race", "boxing")).toBe("bout");
    expect(asRoomFormat("bout", "tennis")).toBe("oneSet");
    const s = setup();
    const a = client("a");
    s.room.join(a);
    expect(s.room.format(a, "stages")).toMatch(/no such format/);
    expect(s.room.format(a, "unlimited")).toBeNull();
    expect(lobby(a)!.format).toBe("unlimited");
  });

  it("parses punch and guard; a client can't send damage, health or a hit", () => {
    expect(parseClientMsg(JSON.stringify({ t: "punch", kind: "jab", hand: "left", at: 12.5 }))).toEqual({ t: "punch", kind: "jab", hand: "left", at: 12.5 });
    expect(parseClientMsg(JSON.stringify({ t: "punch", kind: "hook", hand: "right", at: 1, damage: 100, landed: true }))).toEqual({ t: "punch", kind: "hook", hand: "right", at: 1 });
    expect(parseClientMsg(JSON.stringify({ t: "guard", up: true, health: 100 }))).toEqual({ t: "guard", up: true });
    expect(parseClientMsg(JSON.stringify({ t: "punch", kind: "uppercut", hand: "left", at: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "punch", kind: "jab", hand: "left" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "guard", up: "yes" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "hit", damage: 100 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "health", health: 0 }))).toBeNull();
    // a hostile client sending extra fields straight to the room does no more than a punch
    const s = seated();
    s.room.box(s.a, { t: "punch", kind: "jab", hand: "left", at: 0, damage: 100 } as never);
    s.run(1000);
    expect(state(s.b).boxers[1].health).toBe(HEALTH - DAMAGE.jab);
  });

  it("the server times the punch: it lands after the wind-up and the guard counts at landing", () => {
    const s = seated();
    s.room.box(s.a, { t: "punch", kind: "hook", hand: "right", at: s.now() });
    // well inside the 350 ms wind-up nothing has landed
    s.run(200);
    expect(state(s.b).boxers[1].health).toBe(HEALTH);
    expect(state(s.b).boxers[0].punches.right).toMatchObject({ kind: "hook" });
    // b raises the guard after seeing it, before it lands: blocked
    s.room.box(s.b, { t: "guard", up: true });
    s.run(300);
    expect(state(s.a).boxers[1].health).toBe(HEALTH - damageFor("hook", true));
    expect(state(s.a).lastHit).toMatchObject({ seat: 0, kind: "hook", guarded: true });
  });

  it("a flood of punches from one seat is cut at the door and capped by the sim", () => {
    const s = seated();
    s.run(3000, () => {
      for (let i = 0; i < 100; i++) s.room.box(s.a, { t: "punch", kind: "jab", hand: i % 2 ? "left" : "right", at: s.now() + i });
    });
    expect(state(s.b).boxers[0].thrown).toBeLessThanOrEqual(4 * 3 + 2);
  });

  it("a knockout ends it, rated between two people; back to the ready check", () => {
    const s = seated();
    const hit = puncher(s, s.a);
    s.run(20_000, hit);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "boxing", format: "bout", winner: 0, practice: false });
    expect(isRated(s.records[0])).toBe(true);
    expect(state(s.b)).toMatchObject({ result: "ko", winner: 0 });
    expect(state(s.b).boxers[1].health).toBe(0);
    expect(lobby(s.a)!.phase).toBe("ready-check");
  });

  it("a draw is recorded with no winner and rated", () => {
    const s = seated();
    s.room.box(s.a, { t: "punch", kind: "jab", hand: "left", at: 0 });
    s.room.box(s.b, { t: "punch", kind: "jab", hand: "left", at: 0 });
    s.run(3 * 30_000 + 2 * 5000 + 1000);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ winner: null, draw: true, score: [DAMAGE.jab, DAMAGE.jab] });
    expect(isRated(s.records[0])).toBe(true);
  });

  it("a mid-round drop holds the seat and freezes the round clock and any punch in the air", () => {
    const s = seated();
    s.run(5000);
    s.room.box(s.a, { t: "punch", kind: "hook", hand: "left", at: s.now() });
    s.run(100);
    s.room.leave(s.b, true);
    expect(lobby(s.a)!.phase).toBe("paused");
    expect(lobby(s.a)!.hold).toMatchObject({ seat: 1, name: "b" });
    s.run(50);
    const frozen = state(s.a);
    expect(frozen.phaseTick).toBeLessThan(ROUND_TICKS);
    s.run(400);
    expect(state(s.a).phaseTick).toBe(frozen.phaseTick);
    expect(state(s.a).boxers[1].health).toBe(HEALTH);
    const back = client("b");
    s.room.join(back);
    expect(back.seat).toBe(1);
    s.run(COUNTDOWN + 50);
    expect(lobby(s.a)!.phase).toBe("playing");
    // the clock picks up where it stopped, and the hook lands
    s.run(WINDUP_TICKS.hook * 17 + 50);
    expect(state(s.a).boxers[1].health).toBe(HEALTH - DAMAGE.hook);
    expect(state(s.a).phaseTick).toBeLessThan(frozen.phaseTick + 60);
  });

  it("unlimited counts bouts won and leaving stores it unrated", () => {
    const s = seated("unlimited");
    s.run(20_000, puncher(s, s.a));
    expect(lobby(s.a)!.tally!.points[0]).toBeGreaterThanOrEqual(1);
    expect(s.records).toHaveLength(0);
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "boxing", format: "unlimited", winner: null });
    expect(isRated(s.records[0])).toBe(false);
  });

  it("practice vs the bot starts at once, the bot boxes, and it is never rated", () => {
    const s = setup("bout", true);
    const a = client("a");
    s.room.join(a);
    expect(lobby(a)!.phase).toBe("playing");
    // the room's seed is random, and the bot can knock a still player out
    // (which starts a new bout), so look at every state sent
    let thrown = 0;
    let health = HEALTH;
    s.run(10_000, () => {
      const st = state(a);
      thrown = Math.max(thrown, st.boxers[1].thrown);
      health = Math.min(health, st.boxers[0].health);
    });
    expect(thrown).toBeGreaterThanOrEqual(2);
    expect(health).toBeLessThan(HEALTH);
    s.run(3 * 30_000);
    expect(s.records.length).toBeGreaterThan(0);
    expect(s.records.every((r) => r.practice && !isRated(r))).toBe(true);
  });
});
