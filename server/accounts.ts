// Players, accounts, passkeys and sessions (task 17), as functions over a
// database handle so a test can run them on a throwaway file
// (spec/accounts.test.ts). db.ts calls them on the real one.
//
// A player row is a guest (account = 0, server-made pseudonym, identified by
// a random id in an HttpOnly cookie) or an account (account = 1, claimed with
// a passkey, signed in by a session cookie). The row's `token` is its internal
// id: matches point at it, and it is never sent to any client. A guest's
// cookie never opens an account, so claiming a guest ends that cookie's use.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { checkChosenName, pseudonym } from "./names.ts";

export interface Player {
  token: string;
  name: string;
  account: boolean;
  demo: boolean;
}

export const SESSION_DAYS = 90;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
export const DELETED_NAME = "Deleted player";
// what a guest cookie may hold: the random UUIDs this server makes
const GUEST_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Two fixed demo accounts, so rated play can be tried with no passkey (one
// browser per account). Locked: no rename, no delete, no passkey, and hidden
// from the public board. The client only ever asks for "demo 1 or 2".
export const DEMO_TOKENS = { 1: "demo-1", 2: "demo-2" } as const;
const DEMO_NAMES = { 1: "Demo One", 2: "Demo Two" } as const;

type Row = { token: string; name: string; account: number; demo: number };
const toPlayer = (r: Row): Player => ({ token: r.token, name: r.name, account: r.account === 1, demo: r.demo === 1 });

export function seedDemoAccounts(db: DatabaseSync): void {
  for (const n of [1, 2] as const) {
    db.prepare("INSERT OR IGNORE INTO players (token, name, created_at, account, demo) VALUES (?, ?, 0, 1, 1)").run(DEMO_TOKENS[n], DEMO_NAMES[n]);
  }
}

export function getPlayer(db: DatabaseSync, token: string): Player | null {
  const r = db.prepare("SELECT token, name, account, demo FROM players WHERE token = ?").get(token) as Row | undefined;
  return r ? toPlayer(r) : null;
}

export function getDemo(db: DatabaseSync, n: 1 | 2): Player {
  return getPlayer(db, DEMO_TOKENS[n])!;
}

export const newGuestToken = (): string => randomUUID();

/**
 * The guest a guest cookie names. A new cookie value (one this server made,
 * not yet used) gets its row and pseudonym here. Never returns an account,
 * whatever the cookie says.
 */
export function guestFor(db: DatabaseSync, token: string | undefined, now = Date.now()): Player | null {
  if (!token || !GUEST_TOKEN.test(token)) return null;
  const found = getPlayer(db, token);
  if (found) return found.account ? null : found;
  const name = pseudonym();
  db.prepare("INSERT INTO players (token, name, created_at) VALUES (?, ?, ?)").run(token, name, now);
  return { token, name, account: false, demo: false };
}

// ---- sessions: 256 random bits in the cookie, only a hash in the db ----

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export function createSession(db: DatabaseSync, player: string, now = Date.now()): { cookie: string; expires: number } {
  const cookie = randomBytes(32).toString("base64url");
  const expires = now + SESSION_MS;
  db.prepare("INSERT INTO sessions (hash, player, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hash(cookie), player, now, expires);
  return { cookie, expires };
}

/** The account a session cookie belongs to, if the session is live. */
export function sessionPlayer(db: DatabaseSync, cookie: string | undefined, now = Date.now()): Player | null {
  if (!cookie || cookie.length > 100) return null;
  const r = db
    .prepare("SELECT p.token, p.name, p.account, p.demo FROM sessions s JOIN players p ON p.token = s.player WHERE s.hash = ? AND s.expires_at > ? AND p.account = 1")
    .get(hash(cookie), now) as Row | undefined;
  return r ? toPlayer(r) : null;
}

export function sessionHash(cookie: string): string {
  return hash(cookie);
}

export function endSession(db: DatabaseSync, cookie: string): void {
  db.prepare("DELETE FROM sessions WHERE hash = ?").run(hash(cookie));
}

export function pruneSessions(db: DatabaseSync, now = Date.now()): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}

// ---- passkeys ----

export interface StoredPasskey {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
  createdAt: number;
  lastUsedAt: number | null;
}

type PasskeyRow = { id: string; public_key: Uint8Array; counter: number; transports: string; created_at: number; last_used_at: number | null };
const toPasskey = (r: PasskeyRow): StoredPasskey => ({
  id: r.id,
  publicKey: new Uint8Array(r.public_key),
  counter: r.counter,
  transports: JSON.parse(r.transports) as string[],
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

export function passkeysOf(db: DatabaseSync, player: string): StoredPasskey[] {
  return (db.prepare("SELECT * FROM passkeys WHERE player = ? ORDER BY created_at").all(player) as PasskeyRow[]).map(toPasskey);
}

export function findPasskey(db: DatabaseSync, id: string): { player: string; key: StoredPasskey } | null {
  const r = db.prepare("SELECT * FROM passkeys WHERE id = ?").get(id) as (PasskeyRow & { player: string }) | undefined;
  return r ? { player: r.player, key: toPasskey(r) } : null;
}

/** The random user handle a passkey stores for this player (never the token). */
export function webauthnId(db: DatabaseSync, player: string): string {
  const r = db.prepare("SELECT webauthn_id FROM players WHERE token = ?").get(player) as { webauthn_id: string | null } | undefined;
  if (r?.webauthn_id) return r.webauthn_id;
  const id = randomBytes(32).toString("base64url");
  db.prepare("UPDATE players SET webauthn_id = ? WHERE token = ?").run(id, player);
  return id;
}

export type Refusal = { ok: false; status: number; reason: string };
export type Result<T = object> = ({ ok: true } & T) | Refusal;
const refuse = (status: number, reason: string): Refusal => ({ ok: false, status, reason });
const LOCKED = refuse(403, "Demo accounts are locked.");

/**
 * Stores a verified passkey for `player`. A guest becomes an account here,
 * keeping its token, so its match history stays; its pseudonym is kept (made
 * unique among accounts if another account already has it).
 */
export function addPasskey(db: DatabaseSync, player: string, key: Omit<StoredPasskey, "createdAt" | "lastUsedAt">, now = Date.now()): Result {
  const p = getPlayer(db, player);
  if (!p) return refuse(404, "No such player.");
  if (p.demo) return LOCKED;
  if (findPasskey(db, key.id)) return refuse(409, "That passkey is already registered.");
  db.exec("BEGIN");
  try {
    if (!p.account) {
      let name = p.name;
      while (db.prepare("SELECT 1 FROM players WHERE account = 1 AND lower(name) = lower(?)").get(name)) name = pseudonym();
      db.prepare("UPDATE players SET account = 1, name = ? WHERE token = ?").run(name, player);
    }
    db.prepare("INSERT INTO passkeys (id, player, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      key.id,
      player,
      key.publicKey,
      key.counter,
      JSON.stringify(key.transports),
      now,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}

export function touchPasskey(db: DatabaseSync, id: string, counter: number, now = Date.now()): void {
  db.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").run(counter, now, id);
}

/** Removes one of the account's own passkeys; the last one only with `confirm`. */
export function removePasskey(db: DatabaseSync, player: string, id: string, confirm: boolean): Result<{ remaining: number }> {
  const p = getPlayer(db, player);
  if (!p?.account) return refuse(403, "Sign in first.");
  if (p.demo) return LOCKED;
  const keys = passkeysOf(db, player);
  if (!keys.some((k) => k.id === id)) return refuse(404, "No such passkey on this account.");
  if (keys.length === 1 && !confirm) return refuse(409, "That is your last passkey: without one you can't sign in again once you sign out.");
  db.prepare("DELETE FROM passkeys WHERE id = ? AND player = ?").run(id, player);
  return { ok: true, remaining: keys.length - 1 };
}

/** An account picks its display name: checked here, unique ignoring case. */
export function rename(db: DatabaseSync, player: string, raw: unknown): Result<{ name: string }> {
  const p = getPlayer(db, player);
  if (!p?.account) return refuse(403, "Guests keep a server-made name. Add a passkey to choose one.");
  if (p.demo) return LOCKED;
  const check = checkChosenName(raw);
  if (!check.ok) return refuse(400, check.reason);
  const taken = db.prepare("SELECT 1 FROM players WHERE account = 1 AND lower(name) = lower(?) AND token <> ?").get(check.name, player);
  if (taken) return refuse(409, "That name is taken.");
  try {
    db.prepare("UPDATE players SET name = ? WHERE token = ?").run(check.name, player);
  } catch {
    // the unique index caught a race
    return refuse(409, "That name is taken.");
  }
  return { ok: true, name: check.name };
}

/**
 * Deletes an account: passkeys, sessions, the player row (name and look)
 * and, from task 7, its ratings. Match rows stay so opponents' records don't
 * change, but the token in them becomes a random tombstone: it is "Deleted
 * player" and nothing in it links back to who it was.
 */
export function deleteAccount(db: DatabaseSync, player: string): Result {
  const p = getPlayer(db, player);
  if (!p?.account) return refuse(403, "Sign in first.");
  if (p.demo) return LOCKED;
  const tombstone = `deleted:${randomBytes(12).toString("base64url")}`;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM passkeys WHERE player = ?").run(player);
    db.prepare("DELETE FROM sessions WHERE player = ?").run(player);
    for (const col of ["p0", "p1"]) db.prepare(`UPDATE matches SET ${col} = ? WHERE ${col} = ?`).run(tombstone, player);
    for (const t of ACCOUNT_TABLES) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) db.prepare(`DELETE FROM ${t} WHERE player = ?`).run(player);
    }
    db.prepare("DELETE FROM players WHERE token = ?").run(player);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}

// Per-player tables from later schema steps that go with the account.
const ACCOUNT_TABLES = ["ratings"];

export function matchCountFor(db: DatabaseSync, token: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE p0 = ? OR p1 = ?").get(token, token) as { n: number }).n;
}

/** Shown in place of a player who deleted their account. */
export const isTombstone = (token: string | null): boolean => token?.startsWith("deleted:") ?? false;
