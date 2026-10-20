// Task 17: the account API end to end. Most of it runs the real handler
// (server/auth.ts) in this process on a throwaway database, so the rate limit
// can be small and nothing touches the app's own data; the passkeys come from
// a software authenticator and are checked by @simplewebauthn for real. The
// last block checks the running app: cookies say who a socket is, and the
// client can't say otherwise.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { getPlayer, matchCountFor, seedDemoAccounts } from "../server/accounts.ts";
import { createAuth } from "../server/auth.ts";
import { insertMatch, migrate } from "../server/schema.ts";
import type { ServerMsg } from "../shared/protocol.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

let server: Server;
let base = "";
let db: DatabaseSync;
let dir = "";
const logged: string[] = [];
const gone: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "weblympics-api-"));
  db = new DatabaseSync(join(dir, "app.db"));
  migrate(db);
  seedDemoAccounts(db);
  const handle = createAuth({
    db,
    log: (event, fields) => logged.push(JSON.stringify({ event, ...fields })),
    onGone: (t) => gone.push(t),
    limits: { ceremony: 1000, write: 1000 },
  });
  server = createServer((req, res) => void handle(req, res, new URL(req.url!, "http://x").pathname));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  base = `http://localhost:${port}`;
});

afterAll(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A browser: keeps its cookies, sends its page's Origin on POSTs. */
class Browser {
  jar = new Map<string, string>();
  setCookies: string[] = [];
  origin: string;
  constructor(origin = base) {
    this.origin = origin;
  }

  private remember(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      this.setCookies.push(c);
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/Max-Age=0/.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  get cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(base + path, { headers: { cookie: this.cookie } });
    this.remember(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { cookie: this.cookie, origin: this.origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    this.remember(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
}

type Opts = { challenge: string; rp: { id: string }; user: { id: string }; rpId?: string };

/** Registers a passkey from `auth` for whoever `b` is now. */
async function register(b: Browser, auth: SoftAuthenticator) {
  const options = (await b.post("/api/passkey/register/options")).body as unknown as Opts;
  return b.post("/api/passkey/register/verify", { response: auth.register(options) });
}

async function login(b: Browser, auth: SoftAuthenticator, cred = auth.credentials[0]) {
  const options = (await b.post("/api/passkey/login/options")).body as unknown as Opts;
  return b.post("/api/passkey/login/verify", { response: auth.authenticate(options, cred) });
}

/** The internal token behind a browser's cookies, read straight from the db (tests only). */
function tokenOf(b: Browser): string | null {
  const guest = b.jar.get("wl_guest");
  if (guest) return guest;
  return null;
}

describe("guest, then passkey (task 17)", () => {
  it("a first visit gets a guest cookie and a pseudonym; the page never sees the token", async () => {
    const b = new Browser();
    const me = await b.get("/api/me");
    expect(me.body).toMatchObject({ account: false, demo: false, matches: 0, passkeys: [] });
    expect(me.body.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    expect(JSON.stringify(me.body)).not.toContain(b.jar.get("wl_guest")!);
    const set = b.setCookies.find((c) => c.startsWith("wl_guest="))!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    // same cookie, same guest
    expect((await b.get("/api/me")).body.name).toBe(me.body.name);
  });

  it("register, sign out, sign in again: same account, history kept, a session cookie with only its hash stored", async () => {
    const b = new Browser();
    const guest = (await b.get("/api/me")).body;
    const token = tokenOf(b)!;
    insertMatch(db, { room: "HIST", game: "tennis", tokens: [token, null], score: [1, 0], winner: 0, format: "oneSet", sets: [[6, 0]], practice: true });
    const auth = new SoftAuthenticator(base);

    const claimed = await register(b, auth);
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({ account: true, name: guest.name, matches: 1 });
    expect((claimed.body.passkeys as unknown[]).length).toBe(1);
    // the guest cookie is gone; a session cookie says who this is now
    expect(b.jar.has("wl_guest")).toBe(false);
    const session = b.jar.get("wl_session")!;
    expect(Buffer.from(session, "base64url")).toHaveLength(32);
    expect(b.setCookies.find((c) => c.startsWith("wl_session="))).toMatch(/HttpOnly; SameSite=Lax/);
    expect(JSON.stringify(db.prepare("SELECT * FROM sessions").all())).not.toContain(session);
    expect(getPlayer(db, token)!.account).toBe(true);

    await b.post("/api/logout");
    expect(b.jar.has("wl_session")).toBe(false);
    const after = await b.get("/api/me");
    expect(after.body.account).toBe(false);
    expect(after.body.name).not.toBe(guest.name);
    // the old session cookie no longer works either
    const stale = new Browser();
    stale.jar.set("wl_session", session);
    expect((await stale.get("/api/me")).body.account).toBe(false);

    // another device: just the passkey
    const other = new Browser();
    const signedIn = await login(other, auth);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ account: true, name: guest.name, matches: 1 });
    expect(matchCountFor(db, token)).toBe(1);
  });

  it("an old guest cookie can't open the account it became", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const oldGuest = b.jar.get("wl_guest")!;
    await register(b, new SoftAuthenticator(base));
    const thief = new Browser();
    thief.jar.set("wl_guest", oldGuest);
    const me = await thief.get("/api/me");
    expect(me.body.account).toBe(false);
    expect(thief.jar.get("wl_guest")).not.toBe(oldGuest);
  });

  it("adds a second passkey, and removing the last one needs confirmation", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const phone = new SoftAuthenticator(base);
    const laptop = new SoftAuthenticator(base);
    await register(b, phone);
    const two = await register(b, laptop);
    expect((two.body.passkeys as { id: string }[]).length).toBe(2);
    const [k1, k2] = two.body.passkeys as { id: string }[];
    expect((await b.post("/api/passkey/remove", { id: k1.id })).status).toBe(200);
    const last = await b.post("/api/passkey/remove", { id: k2.id });
    expect(last.status).toBe(409);
    expect(last.body.last).toBe(true);
    expect((await b.post("/api/passkey/remove", { id: k2.id, confirm: true })).body.passkeys).toEqual([]);
    // the phone's passkey is gone: it no longer signs in
    expect((await login(new Browser(), phone)).status).toBe(401);
  });
});

describe("ceremony checks (task 17)", () => {
  it("a challenge works once: replaying a whole registration is refused", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const auth = new SoftAuthenticator(base);
    const options = (await b.post("/api/passkey/register/options")).body as unknown as Opts;
    const response = auth.register(options);
    expect((await b.post("/api/passkey/register/verify", { response })).status).toBe(200);
    const again = new Browser();
    await again.get("/api/me");
    expect((await again.post("/api/passkey/register/verify", { response })).status).toBe(400);
  });

  it("a sign-in signed for another origin, or with an invented challenge, is refused", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const auth = new SoftAuthenticator(base);
    await register(b, auth);
    const options = (await new Browser().post("/api/passkey/login/options")).body as unknown as Opts;
    const phishing = new SoftAuthenticator("https://evil.example");
    phishing.credentials = auth.credentials;
    expect((await new Browser().post("/api/passkey/login/verify", { response: phishing.authenticate(options) })).status).toBe(401);
    expect((await new Browser().post("/api/passkey/login/verify", { response: auth.authenticate({ challenge: "bWFkZS11cA" }) })).status).toBe(401);
  });

  it("every POST from another site's page, or with no Origin, is refused", async () => {
    const evil = new Browser("https://evil.example");
    await evil.get("/api/me");
    for (const path of ["/api/passkey/register/options", "/api/name", "/api/logout", "/api/demo", "/api/account/delete"]) {
      expect((await evil.post(path, { n: 1, name: "Pwned" })).status, path).toBe(403);
    }
    const res = await fetch(`${base}/api/demo`, { method: "POST", body: '{"n":1}' });
    expect(res.status).toBe(403);
  });

  it("bad bodies are refused without a crash", async () => {
    const b = new Browser();
    await b.get("/api/me");
    for (const body of ["not json", "[]", '"x"', "x".repeat(20_000)]) {
      const res = await fetch(`${base}/api/name`, { method: "POST", headers: { cookie: b.cookie, origin: base }, body });
      expect(res.status, body.slice(0, 10)).toBe(400);
    }
    expect((await b.post("/api/passkey/login/verify", { response: "nope" })).status).toBe(400);
    expect((await b.post("/api/passkey/login/verify", { response: { id: 5 } })).status).toBe(400);
  });

  it("rate-limits passkey ceremonies per address", async () => {
    const limited = createAuth({ db, log: () => {}, onGone: () => {}, limits: { ceremony: 3, write: 3 } });
    const s = createServer((req, res) => void limited(req, res, new URL(req.url!, "http://x").pathname));
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const url = `http://localhost:${(s.address() as { port: number }).port}`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${url}/api/passkey/login/options`, { method: "POST", headers: { origin: url }, body: "{}" });
      statuses.push(res.status);
    }
    s.close();
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("never logs a cookie, a challenge or a credential", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const auth = new SoftAuthenticator(base);
    await register(b, auth);
    await b.post("/api/logout");
    await login(b, auth);
    const all = logged.join("\n");
    for (const [, value] of b.jar) expect(all).not.toContain(value);
    expect(all).not.toContain(auth.credentials[0].id.toString("base64url"));
    for (const row of db.prepare("SELECT token FROM players").all() as { token: string }[]) expect(all).not.toContain(row.token);
  });
});

describe("display name over the API (task 17)", () => {
  it("a hostile client sending a name directly is checked by the server", async () => {
    const guest = new Browser();
    await guest.get("/api/me");
    expect((await guest.post("/api/name", { name: "Sneaky" })).status).toBe(403);

    const b = new Browser();
    await b.get("/api/me");
    await register(b, new SoftAuthenticator(base));
    for (const name of ["", "ab", "x".repeat(17), "<img src=x>", "Bot", "Admin", "Swift Otter 12", "Ace (2)", "fuck", 42, null, ["Ace"]]) {
      const r = await b.post("/api/name", { name });
      expect(r.status, JSON.stringify(name)).toBeGreaterThanOrEqual(400);
    }
    const ok = await b.post("/api/name", { name: "  Racket   Queen " });
    expect(ok.body.name).toBe("Racket Queen");
    const c = new Browser();
    await c.get("/api/me");
    await register(c, new SoftAuthenticator(base));
    expect((await c.post("/api/name", { name: "racket queen" })).status).toBe(409);
  });
});

describe("demo accounts (task 17)", () => {
  it("the page only says which; it is locked against rename, passkeys and delete", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const me = await b.post("/api/demo", { n: 2 });
    expect(me.body).toMatchObject({ name: "Demo Two", account: true, demo: true });
    for (const bad of [{ n: 3 }, { n: "1" }, { n: "demo-1" }, {}]) expect((await new Browser().post("/api/demo", bad)).status).toBe(400);

    expect((await b.post("/api/name", { name: "Not Demo" })).status).toBe(403);
    expect((await b.post("/api/passkey/register/options")).status).toBe(403);
    expect((await b.post("/api/account/delete/options")).status).toBe(403);
    expect((await b.post("/api/account/delete", { response: { id: "x" } })).status).toBe(403);
    expect(getPlayer(db, "demo-2")).toEqual({ token: "demo-2", name: "Demo Two", account: true, demo: true });
    // sign out goes back to a guest
    await b.post("/api/logout");
    expect((await b.get("/api/me")).body.demo).toBe(false);
  });
});

describe("delete over the API (task 17)", () => {
  it("needs a fresh passkey check from this account, then removes it and drops its sockets", async () => {
    const b = new Browser();
    await b.get("/api/me");
    const token = tokenOf(b)!;
    const auth = new SoftAuthenticator(base);
    await register(b, auth);
    await b.post("/api/name", { name: "Gone Tomorrow" });

    // no proof, or someone else's passkey, is refused
    expect((await b.post("/api/account/delete", { response: { id: "x" } })).status).toBe(401);
    const other = new Browser();
    await other.get("/api/me");
    const otherAuth = new SoftAuthenticator(base);
    await register(other, otherAuth);
    const opts = (await b.post("/api/account/delete/options")).body as unknown as Opts;
    expect((await b.post("/api/account/delete", { response: otherAuth.authenticate(opts) })).status).toBe(401);
    // a sign-in challenge can't be used to delete
    const loginOpts = (await b.post("/api/passkey/login/options")).body as unknown as Opts;
    expect((await b.post("/api/account/delete", { response: auth.authenticate(loginOpts) })).status).toBe(401);

    const fresh = (await b.post("/api/account/delete/options")).body as unknown as Opts & { allowCredentials: unknown[] };
    expect(fresh.allowCredentials).toHaveLength(1);
    const del = await b.post("/api/account/delete", { response: auth.authenticate(fresh) });
    expect(del.status).toBe(200);
    expect(gone).toContain(token);
    expect(getPlayer(db, token)).toBeNull();
    expect(b.jar.size).toBe(0);
    expect((await login(new Browser(), auth)).status).toBe(401);
    expect(db.prepare("SELECT 1 FROM players WHERE name = 'Gone Tomorrow'").get()).toBeUndefined();
  });
});

// ---- against the running app ----

const appBase = inject("baseUrl");
const wsUrl = new URL("/ws", appBase);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

async function welcome(headers: Record<string, string>, hello: Record<string, unknown> = { t: "hello" }): Promise<Extract<ServerMsg, { t: "welcome" }>> {
  const ws = new WebSocket(wsUrl, { headers });
  try {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const got = new Promise<Extract<ServerMsg, { t: "welcome" }>>((resolve) =>
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString()) as ServerMsg;
        if (m.t === "welcome") resolve(m);
      }),
    );
    ws.send(JSON.stringify(hello));
    return await got;
  } finally {
    ws.close();
  }
}

describe("who a socket is (running app, task 17)", () => {
  it("comes from the cookies; a hello claiming a token or a demo account changes nothing", async () => {
    const res = await fetch(new URL("/api/me", appBase));
    const cookie = res.headers.getSetCookie()[0].split(";")[0];
    const me = (await res.json()) as { name: string };
    const w = await welcome({ cookie }, { t: "hello", token: "demo-1", demo: 1 });
    expect(w).toMatchObject({ name: me.name, account: false, demo: false });
    expect(JSON.stringify(w)).not.toContain(cookie.split("=")[1]);
  });

  it("a socket with no cookie is a new guest, and is given its cookie", async () => {
    const ws = new WebSocket(wsUrl);
    const setCookie = await new Promise<string | undefined>((resolve, reject) => {
      ws.once("upgrade", (r) => resolve(([] as string[]).concat(r.headers["set-cookie"] ?? [])[0]));
      ws.once("error", reject);
    });
    ws.close();
    expect(setCookie).toMatch(/^wl_guest=[0-9a-f-]{36}; .*HttpOnly; SameSite=Lax/);
  });

  it("a socket opened from another site's page is refused", async () => {
    const ws = new WebSocket(wsUrl, { headers: { origin: "https://evil.example" } });
    const outcome = await new Promise<string>((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("refused"));
      ws.once("unexpected-response", () => resolve("refused"));
    });
    ws.close();
    expect(outcome).toBe("refused");
  });

  it("the demo accounts are seeded on the running app and the page can sign in as one", async () => {
    const page = new URL(appBase).origin;
    const res = await fetch(new URL("/api/demo", appBase), { method: "POST", headers: { origin: page, "content-type": "application/json" }, body: '{"n":1}' });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie()[0].split(";")[0];
    expect(await welcome({ cookie })).toMatchObject({ name: "Demo One", account: true, demo: true });
  });
});
