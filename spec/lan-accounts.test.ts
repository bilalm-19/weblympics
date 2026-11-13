// Task 39: LAN mode's local accounts. On a LAN the page is reached by IP
// address, where passkeys can't work, so (only with LAN_ACCOUNTS=1) a guest
// becomes an account with one click and gets a recovery code: shown once,
// only its hash stored, the way back in from another browser. This runs the
// real handler (server/auth.ts) in this process on throwaway databases, one
// in LAN mode and one not, to show the default (Fly) is unchanged.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normaliseRecoveryCode, newRecoveryCode, seedDemoAccounts, sessionHash } from "../server/accounts.ts";
import { createAuth } from "../server/auth.ts";
import { migrate, schemaVersion } from "../server/schema.ts";

type Running = { server: Server; base: string; db: DatabaseSync; dir: string; logs: string[] };

async function start(lan: boolean): Promise<Running> {
  const dir = mkdtempSync(join(tmpdir(), "weblympics-lan-"));
  const db = new DatabaseSync(join(dir, "app.db"));
  migrate(db);
  seedDemoAccounts(db);
  const logs: string[] = [];
  const handle = createAuth({
    db,
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    onGone: () => {},
    limits: { ceremony: 1000, write: 1000 },
    onFly: false,
    lan,
  });
  const server = createServer((req, res) => void handle(req, res, new URL(req.url!, "http://x").pathname));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, db, dir, logs, base: `http://localhost:${(server.address() as { port: number }).port}` };
}

function stop(r: Running): void {
  r.server.close();
  r.db.close();
  rmSync(r.dir, { recursive: true, force: true });
}

class Browser {
  jar = new Map<string, string>();
  base: string;
  constructor(base: string) {
    this.base = base;
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
    const res = await fetch(this.base + path, { headers: { cookie: this.cookie } });
    this.remember(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookies: res.headers.getSetCookie() };
  }
  async post(path: string, body: unknown = {}) {
    const res = await fetch(this.base + path, {
      method: "POST",
      headers: { cookie: this.cookie, origin: this.base, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    this.remember(res);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
}

describe("recovery codes", () => {
  it("are four groups of four from letters and digits that can't be misread", () => {
    for (let i = 0; i < 200; i++) {
      const code = newRecoveryCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/);
    }
  });
  it("read the same however they're typed, and anything else is not a code", () => {
    const code = newRecoveryCode();
    const plain = code.replaceAll("-", "");
    expect(normaliseRecoveryCode(code.toLowerCase())).toBe(plain);
    expect(normaliseRecoveryCode(` ${plain.slice(0, 8)} ${plain.slice(8)} `)).toBe(plain);
    for (const bad of ["", "ABCD", "O".repeat(16), "1".repeat(16), 42, null, "A".repeat(100)]) expect(normaliseRecoveryCode(bad)).toBeNull();
  });
});

describe("schema v11 (task 39)", () => {
  it("a v10 database migrates with every player kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "weblympics-v10-"));
    const db = new DatabaseSync(join(dir, "app.db"));
    try {
      migrate(db);
      // back to what v10 left: no recovery code table
      db.exec("DROP TABLE recovery_codes");
      db.prepare("UPDATE schema_version SET version = 10").run();
      db.prepare("INSERT INTO players (token, name, created_at) VALUES ('p-1', 'Old Guest', 1)").run();
      migrate(db);
      expect(schemaVersion(db)).toBe(11);
      expect(db.prepare("SELECT name FROM players WHERE token = 'p-1'").get()).toEqual({ name: "Old Guest" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM recovery_codes").get()).toEqual({ n: 0 });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("LAN mode", () => {
  let r: Running;
  beforeAll(async () => {
    r = await start(true);
  });
  afterAll(() => stop(r));

  it("the schema has the recovery code table (v11)", () => {
    expect(schemaVersion(r.db)).toBe(11);
    expect(r.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'recovery_codes'").get()).toBeTruthy();
  });

  it("a guest becomes an account with one click, gets a code once, and only its hash is stored", async () => {
    const b = new Browser(r.base);
    const first = await b.get("/api/me");
    expect(first.body).toMatchObject({ account: false, lan: true, recovery: false });

    const made = await b.post("/api/local/create");
    expect(made.status).toBe(200);
    const code = made.body.code as string;
    expect(normaliseRecoveryCode(code)).not.toBeNull();
    expect(made.body.me).toMatchObject({ account: true, recovery: true, lan: true });
    expect((made.body.me as { tag: string }).tag).toMatch(/^\d{4}$/);
    // signed in by a session now; the guest cookie is gone
    expect(b.jar.has("wl_session")).toBe(true);
    expect(b.jar.has("wl_guest")).toBe(false);

    const stored = r.db.prepare("SELECT hash FROM recovery_codes").all() as { hash: string }[];
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(code.replaceAll("-", ""));
    // a second create is refused: it's an account already
    expect((await b.post("/api/local/create")).status).toBe(409);
    // nothing logged carries the code
    expect(r.logs.join("\n")).not.toContain(code.replaceAll("-", ""));
  });

  it("an account can save a look, rename and add friends, as a passkey account can", async () => {
    const a = new Browser(r.base);
    await a.get("/api/me");
    await a.post("/api/local/create");
    const renamed = await a.post("/api/name", { name: "Sam" });
    expect(renamed.status).toBe(200);
    const b = new Browser(r.base);
    await b.get("/api/me");
    await b.post("/api/local/create");
    const tag = (renamed.body as { tag: string }).tag;
    expect((await b.post("/api/friends/add", { who: `Sam#${tag}` })).body).toMatchObject({ ok: true, outcome: "requested" });
  });

  it("the code signs in on another browser; a wrong code doesn't", async () => {
    const home = new Browser(r.base);
    await home.get("/api/me");
    const made = await home.post("/api/local/create");
    await home.post("/api/name", { name: "Roaming" });

    const other = new Browser(r.base);
    await other.get("/api/me");
    expect((await other.post("/api/local/recover", { code: "AAAA-BBBB-CCCC-DDDD" })).status).toBe(401);
    const back = await other.post("/api/local/recover", { code: (made.body.code as string).toLowerCase() });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ name: "Roaming", account: true });
    expect((await other.get("/api/me")).body).toMatchObject({ name: "Roaming", account: true });
  });

  it("a new code replaces the old one", async () => {
    const b = new Browser(r.base);
    await b.get("/api/me");
    const old = (await b.post("/api/local/create")).body.code as string;
    const fresh = await b.post("/api/local/new-code");
    expect(fresh.status).toBe(200);
    const code = fresh.body.code as string;
    expect(code).not.toBe(old);
    const c = new Browser(r.base);
    expect((await c.post("/api/local/recover", { code: old })).status).toBe(401);
    expect((await c.post("/api/local/recover", { code })).status).toBe(200);
  });

  it("a guest can't make a new code", async () => {
    const g = new Browser(r.base);
    await g.get("/api/me");
    expect((await g.post("/api/local/new-code")).status).toBe(403);
  });

  it("a regular player's session is renewed on each visit, so they stay signed in", async () => {
    const b = new Browser(r.base);
    await b.get("/api/me");
    await b.post("/api/local/create");
    const mine = sessionHash(b.jar.get("wl_session")!);
    // as if it had nearly run out
    r.db.prepare("UPDATE sessions SET expires_at = ? WHERE hash = ?").run(Date.now() + 60_000, mine);
    const seen = await b.get("/api/me");
    expect(seen.cookies.some((c) => c.startsWith("wl_session=") && /Max-Age=7776000/.test(c))).toBe(true);
    const row = r.db.prepare("SELECT expires_at AS e FROM sessions WHERE hash = ?").get(mine) as { e: number };
    expect(row.e).toBeGreaterThan(Date.now() + 80 * 24 * 60 * 60 * 1000);
  });

  it("deleting needs the account's own code, and takes the code with it", async () => {
    const other = new Browser(r.base);
    await other.get("/api/me");
    const otherCode = (await other.post("/api/local/create")).body.code as string;

    const b = new Browser(r.base);
    await b.get("/api/me");
    const code = (await b.post("/api/local/create")).body.code as string;
    expect((await b.post("/api/local/delete", { code: otherCode })).status).toBe(401);
    expect((await b.post("/api/local/delete", { code })).status).toBe(200);
    expect((await new Browser(r.base).post("/api/local/recover", { code })).status).toBe(401);
    // the other account is untouched
    expect((await new Browser(r.base).post("/api/local/recover", { code: otherCode })).status).toBe(200);
  });

  it("demo accounts stay locked", async () => {
    const b = new Browser(r.base);
    await b.post("/api/demo", { n: 1 });
    expect((await b.post("/api/local/new-code")).status).toBe(403);
  });
});

describe("outside LAN mode (Fly, and the default)", () => {
  let r: Running;
  beforeAll(async () => {
    r = await start(false);
  });
  afterAll(() => stop(r));

  it("has no local accounts: the routes don't exist and /api/me says so", async () => {
    const b = new Browser(r.base);
    expect((await b.get("/api/me")).body).toMatchObject({ lan: false, account: false });
    for (const path of ["/api/local/create", "/api/local/recover", "/api/local/new-code", "/api/local/delete"]) {
      expect((await b.post(path, { code: "AAAA-BBBB-CCCC-DDDD" })).status, path).toBe(404);
    }
  });

  it("doesn't renew sessions", async () => {
    const b = new Browser(r.base);
    await b.post("/api/demo", { n: 2 });
    const seen = await b.get("/api/me");
    expect(seen.cookies.some((c) => c.startsWith("wl_session="))).toBe(false);
  });

  it("is never on when running on Fly, even with lan set", () => {
    const dir = mkdtempSync(join(tmpdir(), "weblympics-lan-fly-"));
    const db = new DatabaseSync(join(dir, "app.db"));
    migrate(db);
    // createAuth reads lan only when not on Fly; the Me it builds says which
    let said: unknown;
    const handle = createAuth({ db, log: () => {}, onGone: () => {}, onFly: true, lan: true });
    const server = createServer((req, res) => void handle(req, res, "/api/me"));
    return new Promise<void>((done) =>
      server.listen(0, "127.0.0.1", async () => {
        const res = await fetch(`http://localhost:${(server.address() as { port: number }).port}/api/me`);
        said = ((await res.json()) as { lan: boolean }).lan;
        server.close();
        db.close();
        rmSync(dir, { recursive: true, force: true });
        expect(said).toBe(false);
        done();
      }),
    );
  });
});
