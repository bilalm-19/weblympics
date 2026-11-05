// Task 8: the /stats endpoint, and the server's log lines. The log test starts
// its own copy of the server (its own port and throwaway data dir) so it can
// read every line the server prints, plays a short session through it, and
// fails if a token, cookie, passkey id or display name appears.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import type { ServerMsg } from "../shared/protocol.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

const appBase = inject("baseUrl");

describe("/stats (task 8, running app)", () => {
  it("reports rooms, players online, uptime and memory against the 256 MB limit, and nothing about who", async () => {
    const res = await fetch(new URL("/stats", appBase));
    expect(res.status).toBe(200);
    const s = (await res.json()) as Record<string, unknown> & { memory: Record<string, number>; loop: Record<string, number> };
    expect(s).toMatchObject({
      uptimeSeconds: expect.any(Number),
      connections: expect.any(Number),
      playersOnline: expect.any(Number),
      rooms: expect.any(Number),
      playing: expect.any(Number),
      seated: expect.any(Number),
      spectators: expect.any(Number),
    });
    expect(s.memory.limitMb).toBe(256);
    expect(s.memory.rssMb).toBeGreaterThan(10);
    expect(s.memory.rssMb).toBeLessThan(4096);
    // the server rounds the percent from exact bytes, the megabytes are rounded
    // first, so near a rounding edge the two differ by one (seen as 47 vs 48)
    expect(Math.abs(s.memory.usedPercent - Math.round((s.memory.rssMb / 256) * 100))).toBeLessThanOrEqual(1);
    expect(s.memory.heapUsedMb).toBeGreaterThan(0);
    expect(s.loop).toEqual({ avgMs: expect.any(Number), maxMs: expect.any(Number) });
    expect(JSON.stringify(s)).not.toMatch(/name|token|Demo/i);
  });
});

// ---- a private server, to read its output ----

let child: ChildProcess;
let out = "";
let base = "";
let dataDir = "";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  dataDir = mkdtempSync(join(tmpdir(), "weblympics-logs-"));
  base = `http://localhost:${port}`;
  child = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => (out += d.toString()));
  child.stderr!.on("data", (d) => (out += d.toString()));
  const deadline = Date.now() + 60_000;
  while (!out.includes('"listening"')) {
    if (Date.now() > deadline) throw new Error(`private server didn't start:\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}, 70_000);

afterAll(() => {
  child?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

const lines = () =>
  out
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

async function socket(cookie: string) {
  const url = new URL("/ws", base);
  url.protocol = "ws:";
  const ws = new WebSocket(url, { headers: { cookie } });
  const seen: ServerMsg[] = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", id: m.id }));
    else seen.push(m);
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ t: "hello" }));
  return { ws, seen };
}

async function until(seen: ServerMsg[], ok: (m: ServerMsg) => boolean, ms = 8000): Promise<ServerMsg> {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = seen.find(ok);
    if (m) return m;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("the server's log lines (task 8)", () => {
  it("a session's events appear, and no token, cookie, passkey id or name is ever written", async () => {
    const secrets: string[] = [];
    const names: string[] = [];
    const jar = new Map<string, string>();
    const remember = (res: Response) => {
      for (const c of res.headers.getSetCookie()) {
        const [k, v] = c.split(";")[0].split("=");
        if (v) {
          jar.set(k, v);
          secrets.push(v);
        }
      }
    };

    // a guest who becomes an account with a passkey and picks a name
    const meRes = await fetch(`${base}/api/me`);
    remember(meRes);
    names.push(((await meRes.json()) as { name: string }).name);
    let cookie = `wl_guest=${jar.get("wl_guest")}`;
    const auth = new SoftAuthenticator(base);
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`${base}${path}`, { method: "POST", headers: { origin: base, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
      remember(r);
      return (await r.json()) as Record<string, unknown>;
    };
    const opts = (await post("/api/passkey/register/options", {})) as { challenge: string; rp: { id: string }; user: { id: string } };
    secrets.push(opts.challenge, opts.user.id);
    await post("/api/passkey/register/verify", { response: auth.register(opts) });
    secrets.push(auth.credentials[0].id.toString("base64url"));
    cookie = `wl_session=${jar.get("wl_session")}`;
    const chosen = `Logcheck ${Math.floor(Math.random() * 1e5)}`;
    expect((await post("/api/name", { name: chosen })).name).toBe(chosen);
    names.push(chosen);

    // two players in a room; one swings twice quickly (the second is dropped), drops and comes back
    const a = await socket(cookie);
    await until(a.seen, (m) => m.t === "welcome");
    a.ws.send(JSON.stringify({ t: "create", game: "tennis", practice: false }));
    const room = (await until(a.seen, (m) => m.t === "room")) as Extract<ServerMsg, { t: "room" }>;
    const gRes = await fetch(`${base}/api/me`);
    remember(gRes);
    names.push(((await gRes.json()) as { name: string }).name);
    const guestCookie = gRes.headers.getSetCookie()[0].split(";")[0];
    const b = await socket(guestCookie);
    b.ws.send(JSON.stringify({ t: "join", room: room.room }));
    await until(b.seen, (m) => m.t === "room");
    a.ws.send(JSON.stringify({ t: "ready", ready: true }));
    b.ws.send(JSON.stringify({ t: "ready", ready: true }));
    await until(a.seen, (m) => m.t === "lobby" && m.phase === "playing");
    a.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "forehand", level: 1 }));
    a.ws.send(JSON.stringify({ t: "swing", dirX: 0, kind: "forehand", level: 1 }));
    a.ws.send("not json");
    // the server's ruling on the first swing comes back before anyone leaves
    await until(a.seen, (m) => m.t === "swing");
    b.ws.close();
    await until(a.seen, (m) => m.t === "lobby" && m.phase === "paused");
    const back = await socket(guestCookie);
    back.ws.send(JSON.stringify({ t: "join", room: room.room }));
    await until(back.seen, (m) => m.t === "room");
    await new Promise((r) => setTimeout(r, 300));
    a.ws.close();
    back.ws.close();
    await new Promise((r) => setTimeout(r, 300));

    const events = new Set(lines().map((l) => l.event));
    for (const e of ["listening", "guest_new", "account_claim", "rename", "connect", "hello", "room_create", "room_join", "ready", "match_start", "swing_resolve", "swing_drop", "bad_message", "disconnect", "seat_hold", "seat_reclaim", "room_leave"]) {
      expect(events, e).toContain(e);
    }
    // a reconnect is marked, and a disconnect says why
    expect(lines().some((l) => l.event === "disconnect" && typeof l.code === "number" && typeof l.reason === "string")).toBe(true);
    expect(lines().some((l) => l.event === "swing_drop" && l.reason === "cooldown")).toBe(true);
    expect(lines().every((l) => !("name" in l) && !("token" in l))).toBe(true);

    expect(secrets.filter(Boolean).length).toBeGreaterThanOrEqual(5);
    for (const s of secrets.filter((x) => x && x.length >= 8)) expect(out, "a secret value is in the log").not.toContain(s);
    for (const n of names) expect(out, `a name (${n}) is in the log`).not.toContain(n);
  }, 60_000);
});
