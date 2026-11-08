// Boxing (task 30) through the same Room, Lobby and protocol as the other
// games, with a fake clock and fake sockets like spec/track-room.test.ts.
import { describe, expect, it } from "vitest";
import type { BoxingSnapshot } from "../shared/games/boxing/sim.ts";
import { HEALTH, JAB_DAMAGE, JAB_WINDUP_TICKS, ROUND_TICKS, damageFor } from "../shared/games/boxing/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { LobbyView, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { asRoomFormat } from "../server/rooms.ts";
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

/** `opts.rated`: both seats are accounts (kept from task 7's rated rooms; ratings are gone, task 37). */
function seated(format: RoomFormat = "bout", opts: { rated?: boolean } = {}) {
  const s = setup(format);
  const a = client("a");
  const b = client("b");
  if (opts.rated) {
    a.account = true;
    b.account = true;
  }
  s.room.join(a);
  s.room.join(b);
  s.room.ready(a, true);
  s.room.ready(b, true);
  s.run(COUNTDOWN + 50);
  return { ...s, a, b };
}

/** Throws head jabs, alternating hands, as fast as the rules allow. */
function puncher(s: ReturnType<typeof setup>, c: Fake) {
  let hand: "left" | "right" = "left";
  return () => {
    s.room.box(c, { t: "punch", hand, target: "head", at: s.now() });
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

  it("parses punch, guard and slip; a client can't send damage, health, a hit or any extra field", () => {
    expect(parseClientMsg(JSON.stringify({ t: "punch", hand: "left", target: "head", at: 12.5 }))).toEqual({ t: "punch", hand: "left", target: "head", at: 12.5 });
    expect(parseClientMsg(JSON.stringify({ t: "punch", hand: "right", target: "body", at: 1 }))).toEqual({ t: "punch", hand: "right", target: "body", at: 1 });
    for (const guard of ["high", "low", null]) expect(parseClientMsg(JSON.stringify({ t: "guard", guard }))).toEqual({ t: "guard", guard });
    for (const side of ["left", "right"]) expect(parseClientMsg(JSON.stringify({ t: "slip", side }))).toEqual({ t: "slip", side });
    // any extra claim drops the whole message
    expect(parseClientMsg(JSON.stringify({ t: "punch", hand: "right", target: "head", at: 1, damage: 100 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "guard", guard: "high", health: 100 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "slip", side: "left", until: 9999 }))).toBeNull();
    // the old shapes and malformed ones
    expect(parseClientMsg(JSON.stringify({ t: "punch", kind: "jab", hand: "left", at: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "punch", kind: "hook", hand: "left", target: "head", at: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "guard", up: true }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "punch", hand: "left", target: "legs", at: 1 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "punch", hand: "left", target: "head" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "guard", guard: "yes" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "guard" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "slip", side: "up" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "hit", damage: 100 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "health", health: 0 }))).toBeNull();
    // a hostile client sending extra fields straight to the room does no more than a jab
    const s = seated();
    s.room.box(s.a, { t: "punch", hand: "left", target: "head", at: 0, damage: 100 } as never);
    s.run(1000);
    expect(state(s.b).boxers[1].health).toBe(HEALTH - JAB_DAMAGE);
  });

  it("the server times the jab: it lands after the wind-up and the guard counts at landing", () => {
    const s = seated();
    s.room.box(s.a, { t: "punch", hand: "right", target: "head", at: s.now() });
    // inside the 100 ms wind-up nothing has landed
    s.run(50);
    expect(state(s.b).boxers[1].health).toBe(HEALTH);
    expect(state(s.b).boxers[0].punches.right).toMatchObject({ target: "head" });
    // b raises the high guard after seeing it, before it lands: blocked
    s.room.box(s.b, { t: "guard", guard: "high" });
    s.run(300);
    expect(state(s.a).boxers[1].health).toBe(HEALTH - damageFor("blocked"));
    expect(state(s.a).lastHit).toMatchObject({ seat: 0, target: "head", outcome: "blocked" });
  });

  it("a slip sent through the room makes a head jab miss", () => {
    const s = seated();
    s.room.box(s.a, { t: "punch", hand: "right", target: "head", at: s.now() });
    s.run(50);
    s.room.box(s.b, { t: "slip", side: "left" });
    s.run(300);
    expect(state(s.a).boxers[1].health).toBe(HEALTH);
    expect(state(s.a).lastHit).toMatchObject({ seat: 0, outcome: "slipped", damage: 0 });
    expect(state(s.a).boxers[1].slipped).toBe(1);
  });

  it("a flood of punches from one seat is cut at the door and capped by the sim", () => {
    const s = seated();
    s.run(3000, () => {
      for (let i = 0; i < 100; i++) s.room.box(s.a, { t: "punch", hand: i % 2 ? "left" : "right", target: "head", at: s.now() + i });
    });
    expect(state(s.b).boxers[0].thrown).toBeLessThanOrEqual(4 * 3 + 2);
  });

  it("a knockout ends it; back to the ready check", () => {
    const s = seated("bout", { rated: true });
    const hit = puncher(s, s.a);
    s.run(60_000, hit);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "boxing", format: "bout", winner: 0, practice: false });
    expect(state(s.b)).toMatchObject({ result: "ko", winner: 0 });
    expect(state(s.b).boxers[1].health).toBe(0);
    expect(lobby(s.a)!.phase).toBe("ready-check");
  });

  it("a draw is recorded with no winner", () => {
    const s = seated("bout", { rated: true });
    s.room.box(s.a, { t: "punch", hand: "left", target: "head", at: 0 });
    s.room.box(s.b, { t: "punch", hand: "left", target: "head", at: 0 });
    s.run(3 * 30_000 + 2 * 5000 + 1000);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ winner: null, draw: true, score: [JAB_DAMAGE, JAB_DAMAGE] });
  });

  it("a mid-round drop holds the seat and freezes the round clock and any punch in the air", () => {
    const s = seated();
    s.run(5000);
    s.room.box(s.a, { t: "punch", hand: "left", target: "head", at: s.now() });
    // inside the jab's wind-up
    s.run(50);
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
    // the clock picks up where it stopped, and the jab lands
    s.run(JAB_WINDUP_TICKS * 17 + 50);
    expect(state(s.a).boxers[1].health).toBe(HEALTH - JAB_DAMAGE);
    expect(state(s.a).phaseTick).toBeLessThan(frozen.phaseTick + 60);
  });

  it("unlimited counts bouts won and leaving stores it unrated", () => {
    const s = seated("unlimited");
    s.run(60_000, puncher(s, s.a));
    expect(lobby(s.a)!.tally!.points[0]).toBeGreaterThanOrEqual(1);
    expect(s.records).toHaveLength(0);
    s.room.leave(s.b);
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ game: "boxing", format: "unlimited", winner: null });
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
    expect(s.records.every((r) => r.practice)).toBe(true);
  });
});
