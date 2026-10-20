// The account API (task 17): who you are, passkeys, display name, sign out,
// delete. Every POST must come from this site's own page (Origin checked) and
// carries a small JSON body. Passkey checks are @simplewebauthn/server's; the
// challenges are random, single use and expire in two minutes. Cookies:
// `wl_guest` (a guest's random id) and `wl_session` (256 random bits, only
// its hash stored), both HttpOnly, SameSite=Lax, Secure off localhost. No
// cookie, credential or challenge is ever logged.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { DatabaseSync } from "node:sqlite";
import {
  SESSION_DAYS,
  addPasskey,
  createSession,
  deleteAccount,
  endSession,
  findPasskey,
  getDemo,
  getPlayer,
  lookOf,
  guestFor,
  matchCountFor,
  newGuestToken,
  passkeysOf,
  removePasskey,
  rename,
  sessionPlayer,
  setLook,
  touchPasskey,
  webauthnId,
} from "./accounts.ts";
import type { Player } from "./accounts.ts";
import type { Look } from "../shared/look.ts";
import { games } from "../shared/games/registry.ts";
import { Challenges, RateLimit, allowedOrigin, cookie, parseCookies, rpIdFor } from "./guard.ts";
import { history, leaderboard, longestRally, ratingOf } from "./ratings.ts";

export const GUEST_COOKIE = "wl_guest";
export const SESSION_COOKIE = "wl_session";
const GUEST_DAYS = 400;
const DAY_S = 24 * 60 * 60;
const MAX_BODY = 16 * 1024;
const RP_NAME = "Weblympics";

/** What the page is told about its own player. Never the internal token. */
export interface Me {
  name: string;
  account: boolean;
  demo: boolean;
  matches: number;
  passkeys: { id: string; createdAt: number; lastUsedAt: number | null }[];
  /** The saved look (task 18); null for the default (always, for a guest). */
  look: Look | null;
  /** Task 7: an account's rating per sport (every registered sport, 1000 until played); empty for a guest. */
  ratings: Record<string, { rating: number; wins: number; losses: number }>;
  /** Longest rally (shots) in any match you played. */
  longestRally: number;
}

export interface AuthDeps {
  db: DatabaseSync;
  log(event: string, fields?: Record<string, unknown>): void;
  /** Called after an account is deleted or signs out everywhere: drop its live sockets. */
  onGone(token: string): void;
  clock?: () => number;
  /** Per address per minute: passkey ceremonies (each is two requests), and other writes. */
  limits?: { ceremony: number; write: number };
  onFly?: boolean;
}

/** Who a request (HTTP or the WebSocket upgrade) is: the session's account, else the cookie's guest. */
export function identify(db: DatabaseSync, req: IncomingMessage): Player | null {
  const jar = parseCookies(req.headers.cookie);
  return sessionPlayer(db, jar.get(SESSION_COOKIE)) ?? guestFor(db, jar.get(GUEST_COOKIE));
}

/**
 * Where a client is, for rate limits. On Fly the proxy sets Fly-Client-IP to
 * the real address; anywhere else that header could be made up, so it's
 * ignored and the socket's address counts.
 */
function clientIp(req: IncomingMessage, onFly: boolean): string {
  const fly = req.headers["fly-client-ip"];
  return (onFly && typeof fly === "string" && fly) || req.socket.remoteAddress || "?";
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    parts.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function json(res: ServerResponse, status: number, body: unknown, cookies: string[] = []): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(cookies.length ? { "set-cookie": cookies } : {}),
  });
  res.end(JSON.stringify(body));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createAuth(deps: AuthDeps) {
  const { db, log } = deps;
  const clock = deps.clock ?? Date.now;
  const challenges = new Challenges<string>(2 * 60_000, 2000, clock);
  // per address: passkey ceremonies, and everything else that writes
  const limits = deps.limits ?? { ceremony: 40, write: 60 };
  const onFly = deps.onFly ?? Boolean(process.env.FLY_APP_NAME);
  const ceremonyLimit = new RateLimit(limits.ceremony, 60_000, clock);
  const writeLimit = new RateLimit(limits.write, 60_000, clock);

  const me = (p: Player): Me => ({
    name: p.name,
    account: p.account,
    demo: p.demo,
    matches: matchCountFor(db, p.token),
    passkeys: passkeysOf(db, p.token).map((k) => ({ id: k.id, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    look: lookOf(db, p.token),
    ratings: p.account ? Object.fromEntries(Object.keys(games).map((sport) => [sport, ratingOf(db, p.token, sport)])) : {},
    longestRally: longestRally(db, p.token),
  });

  const sessionCookie = (token: string, host: string | undefined): string => {
    const s = createSession(db, token, clock());
    return cookie(SESSION_COOKIE, s.cookie, SESSION_DAYS * DAY_S, host);
  };
  const clear = (name: string, host: string | undefined) => cookie(name, "", 0, host);

  /** Handles /api/*; returns false for any other path. */
  return async function handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/api/")) return false;
    const host = req.headers.host;
    const jar = parseCookies(req.headers.cookie);

    if (path === "/api/me" && req.method === "GET") {
      const session = sessionPlayer(db, jar.get(SESSION_COOKIE), clock());
      if (session) return json(res, 200, me(session)), true;
      let guest = guestFor(db, jar.get(GUEST_COOKIE), clock());
      const set: string[] = [];
      // a browser from before accounts kept its guest id in localStorage: it
      // may hand it over once, but only an existing guest, never an account
      const legacy = req.headers["x-legacy-guest"];
      if (!guest && typeof legacy === "string" && getPlayer(db, legacy)?.account === false) guest = guestFor(db, legacy, clock());
      if (!guest) {
        const token = newGuestToken();
        guest = guestFor(db, token, clock())!;
        log("guest_new", { name: guest.name });
      }
      // refreshed on every visit, so a guest who keeps playing keeps their profile
      set.push(cookie(GUEST_COOKIE, guest.token, GUEST_DAYS * DAY_S, host));
      if (jar.has(SESSION_COOKIE)) set.push(clear(SESSION_COOKIE, host));
      return json(res, 200, me(guest), set), true;
    }

    // ---- task 7: leaderboards and history (reads; no Origin needed) ----
    if (path === "/api/leaderboard" && req.method === "GET") {
      const sport = new URL(req.url ?? "/", "http://x").searchParams.get("sport") ?? "";
      if (!Object.hasOwn(games, sport)) return json(res, 404, { error: "No such sport." }), true;
      const viewer = sessionPlayer(db, jar.get(SESSION_COOKIE), clock());
      return json(res, 200, leaderboard(db, sport, viewer?.token ?? null)), true;
    }
    if (path === "/api/history" && req.method === "GET") {
      const viewer = sessionPlayer(db, jar.get(SESSION_COOKIE), clock()) ?? guestFor(db, jar.get(GUEST_COOKIE), clock());
      return json(res, 200, { matches: viewer ? history(db, viewer.token) : [] }), true;
    }

    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." }), true;
    // a POST from another site's page (or with no Origin at all) is refused
    const origin = allowedOrigin(req.headers.origin, host);
    if (!origin) return json(res, 403, { error: "Wrong origin." }), true;
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "Bad request." }), true;
    const ip = clientIp(req, onFly);
    const ceremony = path.startsWith("/api/passkey/") || path.startsWith("/api/account/delete");
    if (!(ceremony ? ceremonyLimit : writeLimit).allow(ip)) return json(res, 429, { error: "Too many tries. Wait a minute." }), true;
    const rpID = rpIdFor(origin);
    const player = sessionPlayer(db, jar.get(SESSION_COOKIE), clock()) ?? guestFor(db, jar.get(GUEST_COOKIE), clock());

    switch (path) {
      // ---- add a passkey: claims the guest, or adds one to the account ----
      case "/api/passkey/register/options": {
        if (!player) return json(res, 401, { error: "Load the page first." }), true;
        if (player.demo) return json(res, 403, { error: "Demo accounts are locked." }), true;
        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID,
          userName: player.name,
          userDisplayName: player.name,
          userID: Buffer.from(webauthnId(db, player.token), "base64url"),
          attestationType: "none",
          excludeCredentials: passkeysOf(db, player.token).map((k) => ({ id: k.id, transports: k.transports })),
          authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        });
        challenges.add(options.challenge, `reg:${player.token}`);
        return json(res, 200, options), true;
      }
      case "/api/passkey/register/verify": {
        if (!player) return json(res, 401, { error: "Load the page first." }), true;
        if (player.demo) return json(res, 403, { error: "Demo accounts are locked." }), true;
        if (!isObject(body.response)) return json(res, 400, { error: "Bad request." }), true;
        let verified;
        try {
          verified = await verifyRegistrationResponse({
            response: body.response as unknown as RegistrationResponseJSON,
            expectedChallenge: (c) => challenges.take(c, `reg:${player.token}`),
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false,
          });
        } catch {
          verified = null;
        }
        if (!verified?.verified) return json(res, 400, { error: "That passkey couldn't be checked. Try again." }), true;
        const { credential } = verified.registrationInfo;
        const r = addPasskey(db, player.token, { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports ?? [] }, clock());
        if (!r.ok) return json(res, r.status, { error: r.reason }), true;
        const set: string[] = [];
        if (!player.account) {
          // claimed: from now on a session cookie says who this is, and the
          // guest cookie can't open the account
          set.push(sessionCookie(player.token, host), clear(GUEST_COOKIE, host));
          log("account_claim", { name: player.name });
        } else log("passkey_add", { name: player.name });
        return json(res, 200, me(getPlayer(db, player.token)!), set), true;
      }

      // ---- sign in with a passkey (any device, no user name needed) ----
      case "/api/passkey/login/options": {
        const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
        challenges.add(options.challenge, "login");
        return json(res, 200, options), true;
      }
      case "/api/passkey/login/verify": {
        const response = body.response;
        if (!isObject(response) || typeof response.id !== "string") return json(res, 400, { error: "Bad request." }), true;
        const found = findPasskey(db, response.id);
        let verified;
        try {
          verified = found
            ? await verifyAuthenticationResponse({
                response: response as unknown as AuthenticationResponseJSON,
                expectedChallenge: (c) => challenges.take(c, "login"),
                expectedOrigin: origin,
                expectedRPID: rpID,
                credential: { id: found.key.id, publicKey: found.key.publicKey, counter: found.key.counter, transports: found.key.transports },
                requireUserVerification: false,
              })
            : null;
        } catch {
          verified = null;
        }
        if (!found || !verified?.verified) return json(res, 401, { error: "That passkey isn't one we know here." }), true;
        touchPasskey(db, found.key.id, verified.authenticationInfo.newCounter, clock());
        const signedIn = getPlayer(db, found.player);
        if (!signedIn?.account) return json(res, 401, { error: "That passkey isn't one we know here." }), true;
        if (jar.has(SESSION_COOKIE)) endSession(db, jar.get(SESSION_COOKIE)!);
        log("sign_in", { name: signedIn.name });
        return json(res, 200, me(signedIn), [sessionCookie(signedIn.token, host)]), true;
      }

      // ---- the two locked demo accounts: the page only says which ----
      case "/api/demo": {
        const n = body.n === 1 || body.n === 2 ? body.n : null;
        if (!n) return json(res, 400, { error: "Bad request." }), true;
        const demo = getDemo(db, n);
        if (jar.has(SESSION_COOKIE)) endSession(db, jar.get(SESSION_COOKIE)!);
        log("sign_in", { name: demo.name, demo: true });
        return json(res, 200, me(demo), [sessionCookie(demo.token, host)]), true;
      }

      case "/api/logout": {
        const cookieValue = jar.get(SESSION_COOKIE);
        if (cookieValue) endSession(db, cookieValue);
        if (player?.account) log("sign_out", { name: player.name });
        return json(res, 200, { ok: true }, [clear(SESSION_COOKIE, host)]), true;
      }

      case "/api/name": {
        if (!player) return json(res, 401, { error: "Load the page first." }), true;
        const r = rename(db, player.token, body.name);
        if (!r.ok) return json(res, r.status, { error: r.reason }), true;
        log("rename", { from: player.name, to: r.name });
        return json(res, 200, me({ ...player, name: r.name })), true;
      }

      case "/api/look": {
        if (!player) return json(res, 401, { error: "Load the page first." }), true;
        const r = setLook(db, player.token, body.look);
        if (!r.ok) return json(res, r.status, { error: r.reason }), true;
        log("look", { name: player.name });
        return json(res, 200, me(player)), true;
      }

      case "/api/passkey/remove": {
        if (!player?.account) return json(res, 403, { error: "Sign in first." }), true;
        if (typeof body.id !== "string") return json(res, 400, { error: "Bad request." }), true;
        const r = removePasskey(db, player.token, body.id, body.confirm === true);
        if (!r.ok) return json(res, r.status, { error: r.reason, last: r.status === 409 }), true;
        log("passkey_remove", { name: player.name, remaining: r.remaining });
        return json(res, 200, me(player)), true;
      }

      // ---- delete: a fresh passkey check, then everything identifying goes ----
      case "/api/account/delete/options": {
        if (!player?.account) return json(res, 403, { error: "Sign in first." }), true;
        if (player.demo) return json(res, 403, { error: "Demo accounts are locked." }), true;
        const options = await generateAuthenticationOptions({
          rpID,
          userVerification: "preferred",
          allowCredentials: passkeysOf(db, player.token).map((k) => ({ id: k.id, transports: k.transports })),
        });
        challenges.add(options.challenge, `del:${player.token}`);
        return json(res, 200, options), true;
      }
      case "/api/account/delete": {
        if (!player?.account) return json(res, 403, { error: "Sign in first." }), true;
        if (player.demo) return json(res, 403, { error: "Demo accounts are locked." }), true;
        const response = body.response;
        if (!isObject(response) || typeof response.id !== "string") return json(res, 400, { error: "Bad request." }), true;
        const found = findPasskey(db, response.id);
        let verified;
        try {
          verified =
            found && found.player === player.token
              ? await verifyAuthenticationResponse({
                  response: response as unknown as AuthenticationResponseJSON,
                  expectedChallenge: (c) => challenges.take(c, `del:${player.token}`),
                  expectedOrigin: origin,
                  expectedRPID: rpID,
                  credential: { id: found.key.id, publicKey: found.key.publicKey, counter: found.key.counter, transports: found.key.transports },
                  requireUserVerification: false,
                })
              : null;
        } catch {
          verified = null;
        }
        if (!verified?.verified) return json(res, 401, { error: "Confirm with one of this account's passkeys." }), true;
        const r = deleteAccount(db, player.token);
        if (!r.ok) return json(res, r.status, { error: r.reason }), true;
        log("account_delete", {});
        deps.onGone(player.token);
        return json(res, 200, { ok: true }, [clear(SESSION_COOKIE, host), clear(GUEST_COOKIE, host)]), true;
      }
    }
    return json(res, 404, { error: "Not found." }), true;
  };
}
