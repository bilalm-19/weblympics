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
import { parseCameraSettings } from "../shared/camera-settings.ts";
import type { CameraSettings } from "../shared/camera-settings.ts";
import { parseLook } from "../shared/look.ts";
import type { Look } from "../shared/look.ts";
import { checkChosenName, pseudonym } from "./names.ts";

export interface Player {
  token: string;
  name: string;
  account: boolean;
  demo: boolean;
  /** Task 34: an account's 4-digit tag (0-9999, shown as #0042); null for a guest. */
  tag: number | null;
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
// task 34: the demo accounts' fixed tags, Demo One#0001 and Demo Two#0002
const DEMO_TAGS = { 1: 1, 2: 2 } as const;

type Row = { token: string; name: string; account: number; demo: number; tag: number | null };
const toPlayer = (r: Row): Player => ({ token: r.token, name: r.name, account: r.account === 1, demo: r.demo === 1, tag: r.account === 1 ? r.tag : null });
const COLS = "token, name, account, demo, tag";

/** Task 34: how many tags a name has (0000 to 9999). */
export const TAGS = 10_000;
export const ALL_TAGS_TAKEN = "Every number for that name is taken. Please pick another name.";
/** A tag as shown: always four digits. */
export const showTag = (tag: number): string => String(tag).padStart(4, "0");

/**
 * A free tag for `name` among accounts (ignoring case), or null if all 10,000
 * are taken. `prefer` (a rename keeps its tag) is used when free; otherwise a
 * random one, so tags say nothing about when someone joined. `except`: the
 * account itself, whose own row doesn't block it.
 */
export function freeTag(db: DatabaseSync, name: string, prefer: number | null = null, except = ""): number | null {
  const taken = new Set(
    (db.prepare("SELECT tag FROM players WHERE account = 1 AND lower(name) = lower(?) AND token <> ? AND tag IS NOT NULL").all(name, except) as { tag: number }[]).map((r) => r.tag),
  );
  if (prefer !== null && !taken.has(prefer)) return prefer;
  if (taken.size >= TAGS) return null;
  for (let i = 0; i < 40; i++) {
    const t = Math.floor(Math.random() * TAGS);
    if (!taken.has(t)) return t;
  }
  // nearly full: walk from a random start
  const start = Math.floor(Math.random() * TAGS);
  for (let i = 0; i < TAGS; i++) {
    const t = (start + i) % TAGS;
    if (!taken.has(t)) return t;
  }
  return null;
}

/** The account with this name (ignoring case) and tag, if any. */
export function findByTag(db: DatabaseSync, name: string, tag: number): Player | null {
  const r = db.prepare(`SELECT ${COLS} FROM players WHERE account = 1 AND lower(name) = lower(?) AND tag = ?`).get(name, tag) as Row | undefined;
  return r ? toPlayer(r) : null;
}

export function seedDemoAccounts(db: DatabaseSync): void {
  for (const n of [1, 2] as const) {
    db.prepare("INSERT OR IGNORE INTO players (token, name, created_at, account, demo, tag) VALUES (?, ?, 0, 1, 1, ?)").run(DEMO_TOKENS[n], DEMO_NAMES[n], DEMO_TAGS[n]);
  }
}

export function getPlayer(db: DatabaseSync, token: string): Player | null {
  const r = db.prepare(`SELECT ${COLS} FROM players WHERE token = ?`).get(token) as Row | undefined;
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
  return { token, name, account: false, demo: false, tag: null };
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
    .prepare("SELECT p.token, p.name, p.account, p.demo, p.tag FROM sessions s JOIN players p ON p.token = s.player WHERE s.hash = ? AND s.expires_at > ? AND p.account = 1")
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
 * keeping its token, so its match history stays; its pseudonym is kept, with
 * a random free tag (task 34; a new pseudonym only if all its tags are taken).
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
      let tag = freeTag(db, name);
      while (tag === null) {
        name = pseudonym();
        tag = freeTag(db, name);
      }
      db.prepare("UPDATE players SET account = 1, name = ?, tag = ? WHERE token = ?").run(name, tag, player);
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

/**
 * An account picks its display name, checked here. Task 34: several accounts
 * may share a name; name (ignoring case) and tag together are unique. The
 * tag is kept if it is free under the new name, else a random free one; if
 * all 10,000 are taken the user is told to pick another name.
 */
export function rename(db: DatabaseSync, player: string, raw: unknown): Result<{ name: string; tag: number }> {
  const p = getPlayer(db, player);
  if (!p?.account) return refuse(403, "Guests keep a server-made name. Add a passkey to choose one.");
  if (p.demo) return LOCKED;
  const check = checkChosenName(raw);
  if (!check.ok) return refuse(400, check.reason);
  const tag = freeTag(db, check.name, p.tag, player);
  if (tag === null) return refuse(409, ALL_TAGS_TAKEN);
  try {
    db.prepare("UPDATE players SET name = ?, tag = ? WHERE token = ?").run(check.name, tag, player);
  } catch {
    // the unique index caught a race
    return refuse(409, "That name and number were just taken. Try again.");
  }
  return { ok: true, name: check.name, tag };
}

/**
 * Deletes an account: passkeys, sessions, the player row (name, look and
 * camera settings)
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
    // task 34: friendships and requests either way go with the account
    db.prepare("DELETE FROM friendships WHERE a = ? OR b = ?").run(player, player);
    db.prepare("DELETE FROM friend_requests WHERE sender = ? OR recipient = ?").run(player, player);
    db.prepare("DELETE FROM players WHERE token = ?").run(player);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}

// Per-player tables from later schema steps that go with the account.
const ACCOUNT_TABLES = ["ratings", "friend_links"];

/** An account's saved look, or null (the seat's default). Guests never have one. */
export function lookOf(db: DatabaseSync, player: string): Look | null {
  const r = db.prepare("SELECT look, account FROM players WHERE token = ?").get(player) as { look: string | null; account: number } | undefined;
  if (!r?.look || r.account !== 1) return null;
  try {
    return parseLook(JSON.parse(r.look));
  } catch {
    return null;
  }
}

/** Saves an account's look (task 18): every field from its fixed list, or nothing is written. */
export function setLook(db: DatabaseSync, player: string, raw: unknown): Result<{ look: Look }> {
  const p = getPlayer(db, player);
  if (!p?.account) return refuse(403, "Guests get the default look. Add a passkey to save one.");
  const look = parseLook(raw);
  if (!look) return refuse(400, "That look isn't one of the choices.");
  db.prepare("UPDATE players SET look = ? WHERE token = ?").run(JSON.stringify(look), player);
  return { ok: true, look };
}

/** An account's saved camera settings (task 25), or null (the defaults). Guests never have any here. */
export function cameraSettingsOf(db: DatabaseSync, player: string): CameraSettings | null {
  const r = db.prepare("SELECT camera_settings, account FROM players WHERE token = ?").get(player) as { camera_settings: string | null; account: number } | undefined;
  if (!r?.camera_settings || r.account !== 1) return null;
  try {
    return parseCameraSettings(JSON.parse(r.camera_settings));
  } catch {
    return null;
  }
}

/**
 * Saves an account's camera settings (task 25): the closed shape with every
 * value in range, or nothing is written. `null` is Reset to default.
 */
export function setCameraSettings(db: DatabaseSync, player: string, raw: unknown): Result<{ settings: CameraSettings | null }> {
  const p = getPlayer(db, player);
  if (!p?.account) return refuse(403, "Guests keep camera settings in this browser. Add a passkey to save them to an account.");
  if (raw === null) {
    db.prepare("UPDATE players SET camera_settings = NULL WHERE token = ?").run(player);
    return { ok: true, settings: null };
  }
  const settings = parseCameraSettings(raw);
  if (!settings) return refuse(400, "Those camera settings aren't valid.");
  db.prepare("UPDATE players SET camera_settings = ? WHERE token = ?").run(JSON.stringify(settings), player);
  return { ok: true, settings };
}

export function matchCountFor(db: DatabaseSync, token: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE p0 = ? OR p1 = ?").get(token, token) as { n: number }).n;
}

/** Shown in place of a player who deleted their account. */
export const isTombstone = (token: string | null): boolean => token?.startsWith("deleted:") ?? false;
