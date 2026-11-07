// Task 24: spectating. Anyone with the link may watch (user, 2026-11-05), no
// public list, at most 10 watchers a room (user, 2026-11-05). The watch link
// always spectates, even with a seat free; the plain invite keeps taking a
// free seat. A spectator's input changes nothing, in every game. The first
// part runs the real Room with a fake clock (like spec/room-rules.test.ts);
// the second goes through the running server's WebSocket.
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import WebSocket from "ws";
import { MAX_WATCHERS, WATCHERS_FULL, parseClientMsg } from "../shared/protocol.ts";
import type { ClientMsg, RoomFormat, ServerMsg } from "../shared/protocol.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";

const COUNTDOWN = 100;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function setup(game = "tennis", format: RoomFormat = "oneSet", practice = false) {
  let now = 0;
  const room = new Room("WTCH", game, practice, format, {
    record: () => {},
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: 500 },
    onDestroy: () => {},
  });
  const run = (ms: number, each?: () => void) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      each?.();
      room.pump();
    }
  };
  return { room, run };
}

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;

describe("the watch link and the cap (real Room)", () => {
  it("a watch link spectates even when a seat is free; the plain invite still takes it", () => {
    const { room } = setup();
    const host = client("host");
    room.join(host);
    const watcher = client("w");
    expect(room.refusal(watcher, true)).toBeNull();
    room.join(watcher, true);
    expect(watcher.seat).toBeNull();
    expect(last(watcher, "room")!.seat).toBeNull();
    expect(room.seats[1]).toBeNull();
    expect(last(host, "presence")).toMatchObject({ spectators: 1 });
    const guest = client("g");
    room.join(guest);
    expect(guest.seat).toBe(1);
  });

  it("a mid-match watcher gets the room, the current state and the lobby at once", () => {
    const { room, run } = setup();
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    room.ready(a, true);
    room.ready(b, true);
    run(COUNTDOWN + 500);
    const w = client("w");
    room.join(w, true);
    expect(w.seen.map((m) => m.t).slice(0, 4)).toEqual(["room", "state", "presence", "lobby"]);
    const snap = last(w, "state")!.state as { tick: number };
    expect(snap.tick).toBeGreaterThan(0);
    expect(last(w, "lobby")!.phase).toBe("playing");
    expect(last(w, "presence")!.names).toEqual(["a", "b"]);
  });

  it(`takes ${MAX_WATCHERS} watchers; the next is refused by watch link and by invite when the seats are full`, () => {
    expect(MAX_WATCHERS).toBe(10);
    const { room } = setup();
    const a = client("a");
    room.join(a);
    for (let i = 0; i < MAX_WATCHERS; i++) {
      const w = client(`w${i}`);
      expect(room.refusal(w, true)).toBeNull();
      room.join(w, true);
    }
    expect(room.spectators.size).toBe(MAX_WATCHERS);
    expect(room.refusal(client("late"), true)).toBe(WATCHERS_FULL);
    // a seat is still free: the plain invite seats a player, watchers or not
    const b = client("b");
    expect(room.refusal(b)).toBeNull();
    room.join(b);
    expect(b.seat).toBe(1);
    // now the seats are full too: an invite arrival would only watch, so it is refused
    expect(room.refusal(client("late2"))).toBe(WATCHERS_FULL);
    // someone already watching isn't refused for being there
    expect(room.refusal([...room.spectators][0], true)).toBeNull();
    // one leaves, one more may come
    room.leave([...room.spectators][0]);
    expect(room.refusal(client("late3"), true)).toBeNull();
  });

  it("a player whose seat is held after a drop reclaims it even by the watch link, cap or not", () => {
    const { room, run } = setup();
    const a = client("a");
    const b = client("b");
    room.join(a);
    room.join(b);
    room.ready(a, true);
    room.ready(b, true);
    run(COUNTDOWN + 100);
    for (let i = 0; i < MAX_WATCHERS; i++) room.join(client(`w${i}`), true);
    room.leave(b, true);
    const back = client("b");
    expect(room.refusal(back, true)).toBeNull();
    room.join(back, true);
    expect(back.seat).toBe(1);
  });

  it("parses the watch flag; anything but a boolean is a bad message", () => {
    expect(parseClientMsg(JSON.stringify({ t: "join", room: "ABCD", watch: true }))).toEqual({ t: "join", room: "ABCD", watch: true });
    expect(parseClientMsg(JSON.stringify({ t: "join", room: "ABCD" }))).toEqual({ t: "join", room: "ABCD" });
    expect(parseClientMsg(JSON.stringify({ t: "join", room: "ABCD", watch: false }))).toEqual({ t: "join", room: "ABCD" });
    expect(parseClientMsg(JSON.stringify({ t: "join", room: "ABCD", watch: "yes" }))).toBeNull();
  });
});

// Every input a client can send during a room. A spectator sends all of them,
// every tick, and the room must come out exactly as it would without them.
const HOSTILE: ClientMsg[] = [
  { t: "swing", dirX: 1, kind: "forehand", level: 2 },
  { t: "move", x: 3 },
  { t: "mode", mode: "tilt" },
  { t: "aim", yaw: 0.1, pitch: 0.05, draw: 1 },
  { t: "release", yaw: 0.1, pitch: 0.05, draw: 1 },
  { t: "step", side: "left", at: 0 },
  { t: "step", side: "right", at: 50 },
  { t: "ready", ready: false },
  { t: "format", format: "unlimited" },
  { t: "rated", rated: true },
  { t: "pause", paused: true },
  { t: "aim", aim: -0.5 },
  { t: "throw", speed: 0.7, aim: 0.2, spin: -0.5, at: 0 },
  { t: "tie", choice: "draw" },
];

function hostile(room: Room, c: Client): void {
  for (const m of HOSTILE) {
    if (m.t === "swing") room.swing(c, m);
    else if (m.t === "move") room.move(c, m.x);
    else if (m.t === "mode") room.mode(c, m.mode);
    else if ((m.t === "aim" && !("yaw" in m)) || m.t === "throw" || m.t === "tie") room.bowl(c, m);
    else if (m.t === "aim" || m.t === "release") room.aim(c, m);
    else if (m.t === "step") room.step(c, m);
    else if (m.t === "ready") room.ready(c, m.ready);
    else if (m.t === "format") expect(room.format(c, m.format)).toMatch(/host/);
    else if (m.t === "rated") expect(room.setRated(c, m.rated)).toMatch(/host/);
    else if (m.t === "pause") room.pause(c, m.paused);
  }
}

/** One match of `game`, seeded the same each time, with or without a spectator flooding inputs. */
function playWith(game: string, format: RoomFormat, practice: boolean, flood: boolean) {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.42);
  try {
    const { room, run } = setup(game, format, practice);
    const a = client("a");
    room.join(a);
    if (!practice) {
      const b = client("b");
      room.join(b);
      room.ready(a, true);
      room.ready(b, true);
    }
    const w = client("w");
    room.join(w, true);
    run(COUNTDOWN + 4000, flood ? () => hostile(room, w) : undefined);
    return { state: last(a, "state")!.state, lobby: room.lobbyView() };
  } finally {
    random.mockRestore();
  }
}

describe("hostile client: a spectator's input is rejected and changes nothing", () => {
  for (const [game, format] of [
    ["tennis", "oneSet"],
    ["archery", "stages"],
    ["track", "race"],
    ["bowling", "game"],
  ] as const) {
    it(`${game}: swing, move, mode, aim, release, step, ready, format, rated and pause from a spectator`, () => {
      const quiet = playWith(game, format, false, false);
      const flooded = playWith(game, format, false, true);
      expect(flooded.lobby).toEqual(quiet.lobby);
      expect(flooded.state).toEqual(quiet.state);
      expect(flooded.lobby.phase).toBe("playing");
    });
  }

  it("practice: a spectator can't pause the player's game or move the bot", () => {
    const quiet = playWith("tennis", "oneSet", true, false);
    const flooded = playWith("tennis", "oneSet", true, true);
    expect(flooded.state).toEqual(quiet.state);
  });
});

// Through the running server: the watch flag, the cap and its message.
const baseUrl = inject("baseUrl");
const wsUrl = new URL("/ws", baseUrl);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close();
});

class Peer {
  ws!: WebSocket;
  seen: ServerMsg[] = [];

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next<T extends ServerMsg["t"]>(type: T, timeoutMs = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.seen.findIndex((m) => m.t === type);
      if (i !== -1) return this.seen.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>;
      if (Date.now() > deadline) throw new Error(`no "${type}" message within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  static async connect(): Promise<Peer> {
    const res = await fetch(new URL("/api/me", baseUrl));
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("wl_guest="))!.split(";")[0];
    const p = new Peer();
    p.ws = new WebSocket(wsUrl, { headers: { cookie } });
    open.push(p.ws);
    p.ws.on("message", (data) => p.seen.push(JSON.parse(data.toString()) as ServerMsg));
    await new Promise((resolve, reject) => {
      p.ws.once("open", resolve);
      p.ws.once("error", reject);
    });
    p.send({ t: "hello" });
    await p.next("welcome");
    return p;
  }
}

describe("spectating through the server", () => {
  it("?watch spectates with a seat free, counts watchers, and the 11th hears the room is full of watchers", async () => {
    const host = await Peer.connect();
    host.send({ t: "create", game: "tennis", practice: false });
    const { room } = await host.next("room");

    const watchers: Peer[] = [];
    for (let i = 0; i < MAX_WATCHERS; i++) {
      const w = await Peer.connect();
      w.send({ t: "join", room, watch: true });
      expect((await w.next("room")).seat).toBeNull();
      expect(await w.next("state")).toHaveProperty("state");
      watchers.push(w);
    }
    for (;;) {
      const p = await host.next("presence");
      if (p.spectators === MAX_WATCHERS) break;
    }

    const late = await Peer.connect();
    late.send({ t: "join", room, watch: true });
    expect((await late.next("error")).message).toBe(WATCHERS_FULL);
    expect(late.seen.some((m) => m.t === "room")).toBe(false);

    // a seat is still free, so the plain invite seats a player
    const guest = await Peer.connect();
    guest.send({ t: "join", room });
    expect((await guest.next("room")).seat).toBe(1);

    // seats full: the invite would only watch, and there's no room for it
    const late2 = await Peer.connect();
    late2.send({ t: "join", room });
    expect((await late2.next("error")).message).toBe(WATCHERS_FULL);
  });

  it("a refused watcher stays where they were: the cap never pulls someone out of their own room", async () => {
    const host = await Peer.connect();
    host.send({ t: "create", game: "tennis", practice: false });
    const { room } = await host.next("room");
    for (let i = 0; i < MAX_WATCHERS; i++) {
      const w = await Peer.connect();
      w.send({ t: "join", room, watch: true });
      await w.next("room");
    }
    const other = await Peer.connect();
    other.send({ t: "create", game: "tennis", practice: false });
    const mine = await other.next("room");
    other.send({ t: "join", room, watch: true });
    await other.next("error");
    // still in their own room: a second arrival there is seated opposite them
    const friend = await Peer.connect();
    friend.send({ t: "join", room: mine.room });
    expect((await friend.next("room")).seat).toBe(1);
    for (;;) {
      const p = await other.next("presence");
      if (p.names[1] !== null) break;
    }
  });
});
