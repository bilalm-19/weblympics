// Task 18: a player's look. Fixed lists in shared/look.ts, validated on the
// server; stored on the account, deleted with it, and put in the room state
// for both seats and spectators.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { addPasskey, deleteAccount, guestFor, lookOf, newGuestToken, seedDemoAccounts, setLook } from "../server/accounts.ts";
import { Lobby } from "../server/lobby.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { SCHEMA_VERSION, migrate, schemaVersion } from "../server/schema.ts";
import { DEFAULT_LOOKS, HAIRS, SHIRTS, SHORTS, SKINS, STYLES, parseLook } from "../shared/look.ts";
import type { Look } from "../shared/look.ts";
import type { ServerMsg } from "../shared/protocol.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshFile(): string {
  const d = mkdtempSync(join(tmpdir(), "weblympics-look-"));
  dirs.push(d);
  return join(d, "app.db");
}

const LOOK: Look = { shirt: "green", shorts: "white", skin: "s5", hair: "blonde", style: "cap" };

function account(db: DatabaseSync): string {
  const t = newGuestToken();
  guestFor(db, t);
  addPasskey(db, t, { id: `k-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
  return t;
}

describe("the look lists (task 18)", () => {
  it("accepts every combination of listed values", () => {
    for (const shirt of Object.keys(SHIRTS)) expect(parseLook({ ...LOOK, shirt })).not.toBeNull();
    for (const shorts of Object.keys(SHORTS)) expect(parseLook({ ...LOOK, shorts })).not.toBeNull();
    for (const skin of Object.keys(SKINS)) expect(parseLook({ ...LOOK, skin })).not.toBeNull();
    for (const hair of Object.keys(HAIRS)) expect(parseLook({ ...LOOK, hair })).not.toBeNull();
    for (const style of STYLES) expect(parseLook({ ...LOOK, style })).not.toBeNull();
    for (const d of DEFAULT_LOOKS) expect(parseLook(d)).toEqual(d);
  });

  it("rejects anything outside the lists, extra fields, and prototype tricks", () => {
    for (const bad of [
      null,
      "green",
      [],
      {},
      { ...LOOK, shirt: "#ff0000" },
      { ...LOOK, shirt: 0xff0000 },
      { ...LOOK, skin: "s7" },
      { ...LOOK, hair: "rainbow" },
      { ...LOOK, style: "crown" },
      { ...LOOK, style: "toString" },
      { ...LOOK, shirt: "constructor" },
      { ...LOOK, shirt: "__proto__" },
      { ...LOOK, extra: 1 },
      { shirt: "blue", shorts: "navy", skin: "s2", hair: "brown" },
      JSON.parse('{"shirt":"blue","shorts":"navy","skin":"s2","hair":"brown","style":"short","__proto__":{"x":1}}'),
    ]) {
      expect(parseLook(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("saving a look (task 18)", () => {
  it("an account saves one; a hostile value is refused and nothing is stored", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    const a = account(db);
    expect(setLook(db, a, LOOK)).toEqual({ ok: true, look: LOOK });
    expect(lookOf(db, a)).toEqual(LOOK);
    expect(setLook(db, a, { ...LOOK, shirt: "<script>" })).toMatchObject({ ok: false, status: 400 });
    expect(setLook(db, a, { ...LOOK, extra: "x".repeat(5000) })).toMatchObject({ ok: false, status: 400 });
    // the stored value is still the last good one, as plain enum values
    expect(lookOf(db, a)).toEqual(LOOK);
    expect(JSON.parse((db.prepare("SELECT look FROM players WHERE token = ?").get(a) as { look: string }).look)).toEqual(LOOK);
  });

  it("guests can't save one and always have the default", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    const g = newGuestToken();
    guestFor(db, g);
    expect(setLook(db, g, LOOK)).toMatchObject({ ok: false, status: 403 });
    expect(lookOf(db, g)).toBeNull();
  });

  it("survives reopening the database (a restart), and goes with the account", () => {
    const path = freshFile();
    let db = new DatabaseSync(path);
    migrate(db);
    const a = account(db);
    setLook(db, a, LOOK);
    db.close();
    db = new DatabaseSync(path);
    migrate(db);
    expect(lookOf(db, a)).toEqual(LOOK);
    deleteAccount(db, a);
    expect(db.prepare("SELECT COUNT(*) AS n FROM players WHERE look IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("schema v5 opens a v4 database and keeps its rows", () => {
    const path = freshFile();
    const db = new DatabaseSync(path);
    // exactly what v4 made: run the real steps up to 4 by hand-setting the version afterwards
    db.exec(`
      CREATE TABLE players (token TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
        account INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0, webauthn_id TEXT);
      CREATE UNIQUE INDEX players_account_name ON players (lower(name)) WHERE account = 1;
      CREATE TABLE matches (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, game TEXT NOT NULL, p0 TEXT, p1 TEXT,
        score0 INTEGER NOT NULL, score1 INTEGER NOT NULL, winner INTEGER, ended_at INTEGER NOT NULL,
        format TEXT NOT NULL DEFAULT 'points5', sets TEXT NOT NULL DEFAULT '[]', practice INTEGER NOT NULL DEFAULT 0,
        rated INTEGER NOT NULL DEFAULT 0, best_rally INTEGER);
      CREATE TABLE passkeys (id TEXT PRIMARY KEY, player TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL,
        transports TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, last_used_at INTEGER);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, player TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (4);
      INSERT INTO players (token, name, created_at, account, demo) VALUES ('demo-1', 'Demo One', 0, 1, 1), ('acct', 'Kept Name', 1, 1, 0);
    `);
    migrate(db);
    seedDemoAccounts(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(lookOf(db, "acct")).toBeNull();
    expect(setLook(db, "acct", LOOK).ok).toBe(true);
    expect(db.prepare("SELECT name FROM players WHERE token = 'acct'").get()).toEqual({ name: "Kept Name" });
    db.close();
  });
});

describe("looks in the room state (task 18)", () => {
  type Fake = Client & { seen: ServerMsg[] };
  const fake = (token: string, look: Look | null = null): Fake => {
    const seen: ServerMsg[] = [];
    return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, account: look !== null, look, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
  };
  const lastLobby = (c: Fake) => [...c.seen].reverse().find((m) => m.t === "lobby") as Extract<ServerMsg, { t: "lobby" }>;

  it("both seats and a spectator see each seat's look; a guest seat shows its default", () => {
    let now = 0;
    const room = new Room("LOOK", "tennis", false, "oneSet", { record: () => {}, clock: () => now, log: () => {}, timer: false, timing: {}, onDestroy: () => {} });
    const a = fake("a", LOOK);
    const b = fake("b");
    const watcher = fake("w");
    room.join(a);
    room.join(b);
    room.join(watcher);
    now += 100;
    for (const c of [a, b, watcher]) {
      const seats = lastLobby(c).seats;
      expect(seats[0]!.look).toEqual(LOOK);
      expect(seats[1]!.look).toEqual(DEFAULT_LOOKS[1]);
    }
  });

  it("a reclaimed seat keeps its look, and the bot has the default", () => {
    const l = new Lobby(true);
    l.sit(0, "a", "A", 0, { look: LOOK });
    expect(l.view(0).seats[0]!.look).toEqual(LOOK);
    expect(l.view(0).seats[1]!.look).toEqual(DEFAULT_LOOKS[1]);
  });
});

// ---- the running app: a hostile client posting a look ----

const base = inject("baseUrl");

describe("a hostile client and /api/look (running app)", () => {
  it("is refused for a guest and for an out-of-list value on a demo account; a good one is saved", async () => {
    const origin = new URL(base).origin;
    const me = await fetch(new URL("/api/me", base));
    const guest = me.headers.getSetCookie()[0].split(";")[0];
    const post = (cookie: string, look: unknown) =>
      fetch(new URL("/api/look", base), { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify({ look }) });
    expect((await post(guest, LOOK)).status).toBe(403);

    const demo = await fetch(new URL("/api/demo", base), { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"n":2}' });
    const session = demo.headers.getSetCookie()[0].split(";")[0];
    for (const bad of [{ ...LOOK, shirt: "gold" }, { ...LOOK, style: "crown" }, "cap", null]) expect((await post(session, bad)).status, JSON.stringify(bad)).toBe(400);
    const ok = await post(session, LOOK);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { look: Look }).look).toEqual(LOOK);

    // and it reaches the room: Demo Two's seat wears it
    const wsUrl = new URL("/ws", base);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(wsUrl, { headers: { cookie: session } });
    const seen: ServerMsg[] = [];
    ws.on("message", (d) => seen.push(JSON.parse(d.toString()) as ServerMsg));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ t: "hello" }));
    ws.send(JSON.stringify({ t: "create", game: "tennis", practice: true }));
    const deadline = Date.now() + 5000;
    let lobby: Extract<ServerMsg, { t: "lobby" }> | undefined;
    while (!lobby && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      lobby = seen.find((m) => m.t === "lobby") as typeof lobby;
    }
    ws.close();
    expect(lobby!.seats[0]!.look).toEqual(LOOK);
    // the welcome carries it too: the home screen's profile button draws it
    expect(seen.find((m) => m.t === "welcome")).toMatchObject({ name: "Demo Two", look: LOOK });
    // a guest's welcome has no look (they wear their seat's default)
    const gws = new WebSocket(wsUrl, { headers: { cookie: guest } });
    const gotWelcome = new Promise<ServerMsg>((resolve) => gws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === "welcome") resolve(m);
    }));
    await new Promise((r) => gws.once("open", r));
    gws.send(JSON.stringify({ t: "hello" }));
    expect(await gotWelcome).toMatchObject({ account: false, look: null });
    gws.close();
    // put Demo Two back to the default for other tests
    await post(session, DEFAULT_LOOKS[0]);
  });
});
