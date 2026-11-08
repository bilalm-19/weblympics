// Task 34: the friends API (/api/friends/*) end to end. The first part runs
// the real handler (server/auth.ts) in this process on a throwaway database,
// with real passkeys from the software authenticator; the last part checks
// the running app: a request pushes the friends list over the socket each
// tab already has, and who a socket is comes only from its cookies.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { seedDemoAccounts } from "../server/accounts.ts";
import { createAuth } from "../server/auth.ts";
import { migrate } from "../server/schema.ts";
import type { ServerMsg } from "../shared/protocol.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

let server: Server;
let base = "";
let db: DatabaseSync;
let dir = "";
const changed: string[][] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "weblympics-friends-api-"));
  db = new DatabaseSync(join(dir, "app.db"));
  migrate(db);
  seedDemoAccounts(db);
  const handle = createAuth({ db, log: () => {}, onGone: () => {}, onFriends: (t) => changed.push(t), limits: { ceremony: 1000, write: 1000 } });
  server = createServer((req, res) => void handle(req, res, new URL(req.url!, "http://x").pathname));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

class Browser {
  jar = new Map<string, string>();
  origin: string | null;
  constructor(origin: string | null = null) {
    this.origin = origin;
  }
  get cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  private remember(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (/Max-Age=0/.test(c)) this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async get(path: string) {
    const res = await fetch(base + path, { headers: { cookie: this.cookie } });
    this.remember(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  async post(path: string, body: unknown = {}) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { cookie: this.cookie, origin: this.origin ?? base, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    this.remember(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
}

type Opts = { challenge: string; rp: { id: string }; user: { id: string } };

async function account(name: string): Promise<{ b: Browser; tag: string }> {
  const b = new Browser();
  await b.get("/api/me");
  const options = (await b.post("/api/passkey/register/options")).body as unknown as Opts;
  const reg = await b.post("/api/passkey/register/verify", { response: new SoftAuthenticator(base).register(options) });
  expect(reg.body.tag).toMatch(/^\d{4}$/);
  const r = await b.post("/api/name", { name });
  expect(r.status).toBe(200);
  return { b, tag: `${name}#${r.body.tag as string}` };
}

describe("the friends API (in process, task 34)", () => {
  it("/api/me carries the tag for an account, none for a guest", async () => {
    const g = new Browser();
    expect((await g.get("/api/me")).body.tag).toBeNull();
    const { b } = await account("Tagged");
    expect((await b.get("/api/me")).body.tag).toMatch(/^\d{4}$/);
  });

  it("add, accept: both are told to refresh; decline and remove are silent", async () => {
    const ana = await account("Ana Api");
    const ben = await account("Ben Api");
    changed.length = 0;
    expect((await ana.b.post("/api/friends/add", { who: ben.tag })).body).toEqual({ ok: true, outcome: "requested" });
    expect(changed).toHaveLength(1);
    expect((await ben.b.post("/api/friends/accept", { who: ana.tag })).body).toEqual({ ok: true, outcome: "friends" });
    expect((await ana.b.post("/api/friends/remove", { who: ben.tag })).status).toBe(200);
    expect((await ben.b.post("/api/friends/decline", { who: ana.tag })).status).toBe(200);
    // nothing in a reply names an id
    expect(JSON.stringify(changed)).not.toContain("Ana Api");
  });

  it("a guest is refused with the reason; a wrong tag is 404; a bad body 400", async () => {
    const g = new Browser();
    await g.get("/api/me");
    const ben = await account("Ben Guestcheck");
    const r = await g.post("/api/friends/add", { who: ben.tag });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/guests can't add friends/i);
    expect((await g.post("/api/friends/link")).status).toBe(403);
    const ana = await account("Ana Guestcheck");
    const wrong = ben.tag.replace(/#(\d{4})$/, (_, t: string) => `#${String((Number(t) + 1) % 10000).padStart(4, "0")}`);
    expect((await ana.b.post("/api/friends/add", { who: wrong })).status).toBe(404);
    expect((await ana.b.post("/api/friends/add", { who: { name: "Ben" } })).status).toBe(400);
  });

  it("a friend link: made by one, opened by another, then spent", async () => {
    const ana = await account("Ana Link");
    const ben = await account("Ben Link");
    const cyd = await account("Cyd Link");
    const link = await ana.b.post("/api/friends/link");
    expect(link.body.code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect((await ben.b.post("/api/friends/link/use", { code: link.body.code })).body).toEqual({ ok: true, outcome: "friends" });
    expect((await cyd.b.post("/api/friends/link/use", { code: link.body.code })).status).toBe(404);
  });

  it("every friends POST checks Origin", async () => {
    const ana = await account("Ana Origin");
    const evil = new Browser("https://evil.example");
    evil.jar = ana.b.jar;
    for (const path of ["/api/friends/add", "/api/friends/accept", "/api/friends/link", "/api/friends/link/use", "/api/friends/remove", "/api/friends/decline"]) {
      expect((await evil.post(path, { who: "Ben#0001" })).status, path).toBe(403);
    }
  });
});

describe("the friends API is rate limited (task 34)", () => {
  it("writes past the limit are refused with 429", async () => {
    const d = mkdtempSync(join(tmpdir(), "weblympics-friends-rl-"));
    const rdb = new DatabaseSync(join(d, "app.db"));
    migrate(rdb);
    const handle = createAuth({ db: rdb, log: () => {}, onGone: () => {}, limits: { ceremony: 100, write: 3 } });
    const s = createServer((req, res) => void handle(req, res, new URL(req.url!, "http://x").pathname));
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const url = `http://localhost:${(s.address() as { port: number }).port}`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${url}/api/friends/add`, { method: "POST", headers: { origin: url, "content-type": "application/json" }, body: '{"who":"Sam#0001"}' });
      codes.push(r.status);
    }
    s.close();
    rdb.close();
    rmSync(d, { recursive: true, force: true });
    expect(codes.slice(3)).toEqual([429, 429]);
  });
});

// ---- against the running app ----

const appBase = inject("baseUrl");
const wsUrl = new URL("/ws", appBase);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

async function demoCookie(n: 1 | 2): Promise<string> {
  const page = new URL(appBase).origin;
  const res = await fetch(new URL("/api/demo", appBase), { method: "POST", headers: { origin: page, "content-type": "application/json" }, body: JSON.stringify({ n }) });
  return res.headers.getSetCookie()[0].split(";")[0];
}

async function open(cookie: string, hello: Record<string, unknown> = { t: "hello" }) {
  const ws = new WebSocket(wsUrl, { headers: { cookie } });
  const seen: ServerMsg[] = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", id: m.id }));
    else seen.push(m);
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  ws.send(JSON.stringify(hello));
  return { ws, seen };
}

async function until<T extends ServerMsg>(seen: ServerMsg[], ok: (m: ServerMsg) => m is T, ms?: number): Promise<T>;
async function until(seen: ServerMsg[], ok: (m: ServerMsg) => boolean, ms?: number): Promise<ServerMsg>;
async function until(seen: ServerMsg[], ok: (m: ServerMsg) => boolean, ms = 5000): Promise<ServerMsg> {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = [...seen].reverse().find(ok);
    if (m) return m;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const isFriends = (m: ServerMsg): m is Extract<ServerMsg, { t: "friends" }> => m.t === "friends";

describe("live over the page's own socket (running app, task 34)", () => {
  it("the welcome carries the tag; a friends list follows; a hello claiming to be someone else changes nothing", async () => {
    const one = await demoCookie(1);
    const a = await open(one, { t: "hello", token: "demo-2", name: "Demo Two" });
    const w = (await until(a.seen, (m) => m.t === "welcome")) as Extract<ServerMsg, { t: "welcome" }>;
    expect(w).toMatchObject({ name: "Demo One", tag: "0001" });
    await until(a.seen, isFriends);
    a.ws.close();
  });

  it("a friend request is pushed to the other's open tab within moments, with no polling", async () => {
    // two fresh accounts on the running app (the demo accounts are shared with other spec files)
    const page = new URL(appBase).origin;
    const live = async (name: string) => {
      const me = await fetch(new URL("/api/me", appBase));
      let cookie = me.headers.getSetCookie()[0].split(";")[0];
      const post = async (path: string, body: unknown = {}) => {
        const r = await fetch(new URL(path, appBase), { method: "POST", headers: { origin: page, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
        const set = r.headers.getSetCookie().find((c) => c.startsWith("wl_session="));
        if (set) cookie = set.split(";")[0];
        return { status: r.status, body: (await r.json()) as Record<string, unknown> };
      };
      const options = (await post("/api/passkey/register/options")).body as unknown as Opts;
      await post("/api/passkey/register/verify", { response: new SoftAuthenticator(page).register(options) });
      const r = await post("/api/name", { name });
      return { post, cookie: () => cookie, tag: `${name}#${r.body.tag as string}` };
    };
    const n = Math.floor(Math.random() * 1e5);
    const one = await live(`Live A${n}`);
    const two = await live(`Live B${n}`);
    const b = await open(two.cookie());
    await until(b.seen, isFriends);
    expect((await one.post("/api/friends/add", { who: two.tag })).status).toBe(200);
    const got = await until(b.seen, (m): m is Extract<ServerMsg, { t: "friends" }> => isFriends(m) && m.requests.some((q) => q.name === `Live A${n}`));
    expect(`${got.requests[0].name}#${got.requests[0].tag}`).toBe(one.tag);
    // accepting: they show as offline (no tab), then online when a tab opens, then offline by choice
    await two.post("/api/friends/accept", { who: one.tag });
    const shows = (status: string) => (m: ServerMsg) => isFriends(m) && m.friends.some((f) => f.name === `Live A${n}` && f.status === status);
    await until(b.seen, shows("offline"));
    const a = await open(one.cookie());
    await until(b.seen, shows("online"));
    const count = b.seen.length;
    a.ws.send(JSON.stringify({ t: "status", status: "offline" }));
    await until(b.seen, (m) => b.seen.indexOf(m) >= count && shows("offline")(m));
    a.ws.close();
    b.ws.close();
  }, 30_000);
});
