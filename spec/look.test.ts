// Tasks 18 and 33: a player's look. Fixed lists in shared/look.ts, validated
// on the server; stored on the account, deleted with it, and put in the room
// state for both seats and spectators. Task 33 widened it (clothes, hair,
// face, extras) and schema step 7 rewrote the stored task-18 looks.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { addPasskey, deleteAccount, guestFor, lookOf, newGuestToken, seedDemoAccounts, setLook } from "../server/accounts.ts";
import { Lobby } from "../server/lobby.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { SCHEMA_VERSION, migrate, schemaVersion } from "../server/schema.ts";
import { BOTTOM_COLOURS, DEFAULT_LOOKS, HAIR_COLOURS, LOOK_FIELDS, LOOK_OPTIONS, SKINS, TOP_COLOURS, fromTask18, lookKey, parseLook, sameLook } from "../shared/look.ts";
import type { LegacyLook, Look } from "../shared/look.ts";
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

const LOOK: Look = {
  top: "suit",
  topColour: "green",
  bottom: "skirt",
  bottomColour: "white",
  skin: "s5",
  hairColour: "blonde",
  hairStyle: "bob",
  headwear: "beanie",
  eyes: "sleepy",
  brows: "thick",
  nose: "long",
  mouth: "open",
  facialHair: "goatee",
  eyewear: "sunglasses",
};

function account(db: DatabaseSync): string {
  const t = newGuestToken();
  guestFor(db, t);
  addPasskey(db, t, { id: `k-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
  return t;
}

describe("the look lists (tasks 18 and 33)", () => {
  it("has exactly the fields and options task 33 lists, keeping task 18's palettes", () => {
    expect(LOOK_FIELDS).toEqual(["top", "topColour", "bottom", "bottomColour", "skin", "hairColour", "hairStyle", "headwear", "eyes", "brows", "nose", "mouth", "facialHair", "eyewear"]);
    expect(LOOK_OPTIONS.top).toEqual(["tee", "polo", "hoodie", "jersey", "tank", "suit", "dress"]);
    expect(LOOK_OPTIONS.bottom).toEqual(["shorts", "trousers", "skirt"]);
    expect(LOOK_OPTIONS.hairStyle).toEqual(["short", "buzz", "fringe", "bob", "curly", "long", "ponytail", "bun", "afro", "spiky", "bald"]);
    expect(LOOK_OPTIONS.headwear).toEqual(["none", "cap", "visor", "headband", "beanie"]);
    expect(LOOK_OPTIONS.eyes).toEqual(["round", "almond", "sleepy", "wide"]);
    expect(LOOK_OPTIONS.brows).toEqual(["straight", "arched", "thick", "angled"]);
    expect(LOOK_OPTIONS.nose).toEqual(["button", "small", "long", "wide"]);
    expect(LOOK_OPTIONS.mouth).toEqual(["smile", "grin", "neutral", "open"]);
    expect(LOOK_OPTIONS.facialHair).toEqual(["none", "stubble", "moustache", "goatee", "beard"]);
    expect(LOOK_OPTIONS.eyewear).toEqual(["none", "round", "square", "sunglasses", "goggles"]);
    // task 18's palettes, unchanged
    expect(LOOK_OPTIONS.topColour).toEqual(["blue", "red", "green", "yellow", "purple", "orange", "pink", "white", "black"]);
    expect(LOOK_OPTIONS.bottomColour).toEqual(["navy", "black", "white", "khaki", "red", "blue"]);
    expect(LOOK_OPTIONS.skin).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(LOOK_OPTIONS.hairColour).toEqual(["black", "brown", "auburn", "blonde", "grey", "blue"]);
    expect(Object.keys(TOP_COLOURS)).toEqual(LOOK_OPTIONS.topColour);
  });

  it("accepts every listed value of every field", () => {
    for (const field of LOOK_FIELDS) {
      for (const value of LOOK_OPTIONS[field]) expect(parseLook({ ...LOOK, [field]: value }), `${field}=${value}`).toEqual({ ...LOOK, [field]: value });
    }
    for (const d of DEFAULT_LOOKS) expect(parseLook(d)).toEqual(d);
  });

  it("the two seats' defaults differ", () => {
    expect(sameLook(DEFAULT_LOOKS[0], DEFAULT_LOOKS[1])).toBe(false);
    expect(DEFAULT_LOOKS[0]).toMatchObject({ top: "tee", topColour: "blue", bottom: "shorts", hairStyle: "short", headwear: "none", eyewear: "none" });
    expect(DEFAULT_LOOKS[1]).toMatchObject({ topColour: "red" });
  });

  it("refuses, for every field, a value outside its list, a missing field, a wrong type, and prototype tricks", () => {
    for (const field of LOOK_FIELDS) {
      for (const bad of ["", "gold", "#ff0000", 1, null, true, [], {}, "toString", "constructor", "__proto__", "NONE", ` ${LOOK[field]}`]) {
        expect(parseLook({ ...LOOK, [field]: bad }), `${field}=${JSON.stringify(bad)}`).toBeNull();
      }
      // another field's value is not this field's
      const other = LOOK_FIELDS.find((f) => !(LOOK_OPTIONS[field] as readonly string[]).includes(LOOK[f]))!;
      expect(parseLook({ ...LOOK, [field]: LOOK[other] }), `${field}=${LOOK[other]}`).toBeNull();
      const missing: Record<string, unknown> = { ...LOOK };
      delete missing[field];
      expect(parseLook(missing), `without ${field}`).toBeNull();
    }
  });

  it("refuses extra fields, task 18's old shape, and anything not an object", () => {
    for (const bad of [
      null,
      "green",
      [],
      {},
      [LOOK],
      { ...LOOK, extra: 1 },
      { ...LOOK, shirt: "blue" },
      { ...LOOK, style: "short" },
      { shirt: "blue", shorts: "navy", skin: "s2", hair: "brown", style: "short" },
      JSON.parse(`{"__proto__":{"x":1},${JSON.stringify(LOOK).slice(1)}`),
    ]) {
      expect(parseLook(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("lookKey names every field, in order", () => {
    expect(lookKey(DEFAULT_LOOKS[0])).toBe("tee/blue/shorts/navy/s2/brown/short/none/round/straight/small/smile/none/none");
  });
});

/** Task-18 looks, from task 18's lists written out here (they are gone from shared/look.ts). */
const OLD_STYLES = ["short", "long", "bun", "bald", "cap", "visor", "headband"] as const;
const OLD_LOOKS: LegacyLook[] = [];
for (const shirt of Object.keys(TOP_COLOURS) as Array<LegacyLook["shirt"]>) {
  for (const style of OLD_STYLES) OLD_LOOKS.push({ shirt, shorts: "navy", skin: "s2", hair: "brown", style });
}
for (const shorts of Object.keys(BOTTOM_COLOURS) as Array<LegacyLook["shorts"]>) OLD_LOOKS.push({ shirt: "blue", shorts, skin: "s1", hair: "black", style: "short" });
for (const skin of Object.keys(SKINS) as Array<LegacyLook["skin"]>) {
  for (const hair of Object.keys(HAIR_COLOURS) as Array<LegacyLook["hair"]>) OLD_LOOKS.push({ shirt: "green", shorts: "white", skin, hair, style: "cap" });
}

describe("schema v7 (task 33): stored task-18 looks in the new shape", () => {
  it("maps a task-18 look: shirt to a T-shirt's colour, shorts to shorts, a hat over short hair, a hairstyle kept, the face defaulted", () => {
    expect(fromTask18({ shirt: "green", shorts: "white", skin: "s5", hair: "blonde", style: "cap" })).toEqual({
      ...DEFAULT_LOOKS[0],
      topColour: "green",
      bottomColour: "white",
      skin: "s5",
      hairColour: "blonde",
      hairStyle: "short",
      headwear: "cap",
    });
    for (const [style, hairStyle, headwear] of [
      ["short", "short", "none"],
      ["long", "long", "none"],
      ["bun", "bun", "none"],
      ["bald", "bald", "none"],
      ["cap", "short", "cap"],
      ["visor", "short", "visor"],
      ["headband", "short", "headband"],
    ] as const) {
      expect(fromTask18({ shirt: "blue", shorts: "navy", skin: "s2", hair: "brown", style }), style).toMatchObject({ top: "tee", bottom: "shorts", hairStyle, headwear });
    }
    for (const old of OLD_LOOKS) expect(parseLook(fromTask18(old))).toEqual(fromTask18(old));
  });

  it("opens a v6 database with task-18 looks: each loads as its mapped new look, the rest kept", () => {
    const path = freshFile();
    let db = new DatabaseSync(path);
    // a v6 database: the real steps up to 6 (step 7 adds no table or column),
    // task-18 looks written as task 18 wrote them, and the version put back to 6
    migrate(db);
    db.exec("UPDATE schema_version SET version = 6");
    const insert = db.prepare("INSERT INTO players (token, name, created_at, account, look) VALUES (?, ?, 0, 1, ?)");
    OLD_LOOKS.forEach((old, i) => insert.run(`acct-${i}`, `Player ${i}`, JSON.stringify(old)));
    insert.run("no-look", "No Look", null);
    insert.run("garbage", "Garbage", "not json");
    insert.run("half", "Half", JSON.stringify({ shirt: "blue" }));
    db.prepare("INSERT INTO players (token, name, created_at, account, look) VALUES ('guest', 'Lucky Otter 12', 0, 0, ?)").run(JSON.stringify(OLD_LOOKS[0]));
    db.close();

    db = new DatabaseSync(path);
    migrate(db);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    OLD_LOOKS.forEach((old, i) => expect(lookOf(db, `acct-${i}`), JSON.stringify(old)).toEqual(fromTask18(old)));
    // stored as exactly the new shape: no task-18 field left behind
    for (const r of db.prepare("SELECT look FROM players WHERE token LIKE 'acct-%'").all() as Array<{ look: string }>) {
      expect(Object.keys(JSON.parse(r.look)).sort()).toEqual([...LOOK_FIELDS].sort());
    }
    // no look, or one that was never a task-18 look: the default
    for (const t of ["no-look", "garbage", "half"]) expect(lookOf(db, t), t).toBeNull();
    expect(db.prepare("SELECT look FROM players WHERE token IN ('garbage', 'half') ORDER BY token").all()).toEqual([{ look: null }, { look: null }]);
    // a guest never has a look, whatever the row says
    expect(lookOf(db, "guest")).toBeNull();
    // names kept, and the account can save a new look
    expect(db.prepare("SELECT name FROM players WHERE token = 'acct-0'").get()).toEqual({ name: "Player 0" });
    expect(setLook(db, "acct-0", LOOK).ok).toBe(true);
    // opening it again changes nothing
    db.close();
    db = new DatabaseSync(path);
    migrate(db);
    expect(lookOf(db, "acct-0")).toEqual(LOOK);
    expect(lookOf(db, "acct-1")).toEqual(fromTask18(OLD_LOOKS[1]));
    db.close();
  });
});

describe("the 3D character wears every option (task 33)", () => {
  type Character = typeof import("../client/games/tennis/character.ts");
  let character: Character;
  beforeAll(async () => {
    // the face and strings are drawn on a canvas; Node has none, and this only needs the meshes
    const noop: () => unknown = new Proxy(() => {}, { get: () => noop, apply: () => noop });
    (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => noop }) };
    character = await import("../client/games/tennis/character.ts");
  });

  it("builds and redresses for every option of every field, and its key is the look's", () => {
    const p = character.makePlayer(DEFAULT_LOOKS[0], 0);
    for (const field of LOOK_FIELDS) {
      for (const value of LOOK_OPTIONS[field]) {
        const look = { ...LOOK, [field]: value } as Look;
        p.setLook(look);
        expect(p.group.userData.look, `${field}=${value}`).toBe(lookKey(look));
        expect(character.makePlayer(look, 0).group.userData.look).toBe(lookKey(look));
      }
    }
  });

  it("still takes a task-18 look (other games' older code), worn as its mapped new look", () => {
    const old: LegacyLook = { shirt: "green", shorts: "white", skin: "s5", hair: "blonde", style: "cap" };
    const p = character.makePlayer(old, 0, { arms: false });
    expect(p.group.userData.look).toBe(lookKey(fromTask18(old)));
    p.setLook(LOOK);
    p.setLook(old);
    expect(p.group.userData.look).toBe(lookKey(fromTask18(old)));
  });

  it("setLook never shows or hides a part, so a sport that hides some (boxing's first person) keeps them hidden", () => {
    const p = character.makePlayer(DEFAULT_LOOKS[0], 0, { arms: false });
    const parts = [...p.parts.upper, ...p.parts.head];
    for (const m of parts) m.visible = false;
    for (const field of LOOK_FIELDS) for (const value of LOOK_OPTIONS[field]) p.setLook({ ...LOOK, [field]: value } as Look);
    expect(parts.every((m) => !m.visible)).toBe(true);
    // the head comes first, every hair, hat and glasses part after it
    expect(p.parts.head[0].position.y).toBeCloseTo(1.78);
  });
});

describe("saving a look (task 18)", () => {
  it("an account saves one; a hostile value is refused and nothing is stored", () => {
    const db = new DatabaseSync(freshFile());
    migrate(db);
    const a = account(db);
    expect(setLook(db, a, LOOK)).toEqual({ ok: true, look: LOOK });
    expect(lookOf(db, a)).toEqual(LOOK);
    expect(setLook(db, a, { ...LOOK, topColour: "<script>" })).toMatchObject({ ok: false, status: 400 });
    expect(setLook(db, a, { ...LOOK, eyewear: "monocle" })).toMatchObject({ ok: false, status: 400 });
    expect(setLook(db, a, { shirt: "blue", shorts: "navy", skin: "s2", hair: "brown", style: "short" })).toMatchObject({ ok: false, status: 400 });
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
    // start from the default, so "nothing stored" below can be seen
    expect((await post(session, DEFAULT_LOOKS[0])).status).toBe(200);
    const missing: Record<string, unknown> = { ...LOOK };
    delete missing.eyewear;
    for (const bad of [
      { ...LOOK, topColour: "gold" },
      { ...LOOK, hairStyle: "mohawk" },
      { ...LOOK, top: "cape" },
      { ...LOOK, eyewear: "monocle" },
      { ...LOOK, extra: "x" },
      missing,
      { shirt: "green", shorts: "white", skin: "s5", hair: "blonde", style: "cap" },
      "cap",
      null,
    ]) {
      expect((await post(session, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // none of them was stored
    const stored = (await (await fetch(new URL("/api/me", base), { headers: { cookie: session } })).json()) as { look: Look };
    expect(stored.look).toEqual(DEFAULT_LOOKS[0]);
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
