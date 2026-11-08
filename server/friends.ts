// Friends (task 34), as functions over a database handle so a test can run
// them on a throwaway file (spec/friends-rules.test.ts). Accounts only: a
// guest has no lasting identity, so it can't friend or be friended. Everything
// is stored by the hidden player id; on the wire a person is only ever
// "Name#1234", exact (no search, no partial matches, so nobody can browse the
// players). A friend link carries its own random code, single use, expiring;
// only its hash is stored.
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { findByTag, getPlayer, lookOf, showTag } from "./accounts.ts";
import type { Player, Refusal } from "./accounts.ts";
import type { Look } from "../shared/look.ts";

/** How long a friend link works, ms. */
export const LINK_MS = 24 * 60 * 60 * 1000;
/** Most friends an account may have, and most requests it may have waiting on others. */
export const MAX_FRIENDS = 200;
export const MAX_PENDING = 50;
/** Live friend links per account; making another drops the oldest. */
const MAX_LINKS = 5;

export const GUESTS_CANT =
  "Guests can't add friends: a guest has no lasting identity. Create an account with a passkey (profile, top right) first.";
const NO_SUCH = "No account has that name and number. Check both: it looks like Sam#4821.";

export type FriendResult = { ok: true; outcome: "requested" | "friends" | "already"; other: string } | Refusal;
const refuse = (status: number, reason: string): Refusal => ({ ok: false, status, reason });

/** "Sam#4821" (spaces around the # allowed) into a name and a tag 0-9999, or null. */
export function parseNameTag(raw: unknown): { name: string; tag: number } | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const m = /^\s*(.{1,32}?)\s*#\s*(\d{4})\s*$/.exec(raw);
  if (!m) return null;
  const name = m[1].replace(/ {2,}/g, " ");
  return { name, tag: Number(m[2]) };
}

/** A player as "Name#1234". */
export const nameTag = (p: Pick<Player, "name" | "tag">): string => `${p.name}#${showTag(p.tag ?? 0)}`;

// one row per pair, the smaller id first
const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export function areFriends(db: DatabaseSync, x: string, y: string): boolean {
  const [a, b] = pair(x, y);
  return Boolean(db.prepare("SELECT 1 FROM friendships WHERE a = ? AND b = ?").get(a, b));
}

/** The ids of an account's friends. */
export function friendIds(db: DatabaseSync, player: string): string[] {
  return (db.prepare("SELECT b AS id FROM friendships WHERE a = ? UNION SELECT a AS id FROM friendships WHERE b = ?").all(player, player) as { id: string }[]).map((r) => r.id);
}

/** Ids of the accounts asking `player` to be friends, oldest first. */
export function requestIds(db: DatabaseSync, player: string): string[] {
  return (db.prepare("SELECT sender FROM friend_requests WHERE recipient = ? ORDER BY created_at, sender").all(player) as { sender: string }[]).map((r) => r.sender);
}

const count = (db: DatabaseSync, sql: string, ...args: string[]): number => (db.prepare(sql).get(...args) as { n: number }).n;

function befriend(db: DatabaseSync, x: string, y: string, now: number): void {
  const [a, b] = pair(x, y);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT OR IGNORE INTO friendships (a, b, created_at) VALUES (?, ?, ?)").run(a, b, now);
    db.prepare("DELETE FROM friend_requests WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)").run(x, y, y, x);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function canHaveFriends(p: Player | null): p is Player {
  return Boolean(p?.account);
}

/**
 * `from` asks the account named `raw` ("Name#1234") to be friends. If they
 * had already asked `from`, it is accepted at once. Refused for a guest, an
 * unknown name and tag, yourself, or past the limits.
 */
export function requestFriend(db: DatabaseSync, from: string, raw: unknown, now = Date.now()): FriendResult {
  const me = getPlayer(db, from);
  if (!canHaveFriends(me)) return refuse(403, GUESTS_CANT);
  const nt = parseNameTag(raw);
  if (!nt) return refuse(400, "Type their name and number, like Sam#4821.");
  const them = findByTag(db, nt.name, nt.tag);
  if (!them) return refuse(404, NO_SUCH);
  if (them.token === from) return refuse(400, "That's you.");
  if (areFriends(db, from, them.token)) return { ok: true, outcome: "already", other: them.token };
  if (db.prepare("SELECT 1 FROM friend_requests WHERE sender = ? AND recipient = ?").get(them.token, from)) {
    if (count(db, "SELECT COUNT(*) AS n FROM friendships WHERE a = ? OR b = ?", from, from) >= MAX_FRIENDS) return refuse(409, `You have ${MAX_FRIENDS} friends, the most there can be.`);
    befriend(db, from, them.token, now);
    return { ok: true, outcome: "friends", other: them.token };
  }
  if (count(db, "SELECT COUNT(*) AS n FROM friendships WHERE a = ? OR b = ?", from, from) >= MAX_FRIENDS) return refuse(409, `You have ${MAX_FRIENDS} friends, the most there can be.`);
  if (count(db, "SELECT COUNT(*) AS n FROM friend_requests WHERE sender = ?", from) >= MAX_PENDING) return refuse(429, "You have a lot of requests waiting. Wait for some answers first.");
  db.prepare("INSERT OR IGNORE INTO friend_requests (sender, recipient, created_at) VALUES (?, ?, ?)").run(from, them.token, now);
  return { ok: true, outcome: "requested", other: them.token };
}

/** Accepts a request from `raw` (Name#1234); refused if they never asked. */
export function acceptFriend(db: DatabaseSync, me: string, raw: unknown, now = Date.now()): FriendResult {
  if (!canHaveFriends(getPlayer(db, me))) return refuse(403, GUESTS_CANT);
  const nt = parseNameTag(raw);
  const them = nt && findByTag(db, nt.name, nt.tag);
  if (!them || !db.prepare("SELECT 1 FROM friend_requests WHERE sender = ? AND recipient = ?").get(them.token, me)) return refuse(404, "That request is no longer there.");
  if (count(db, "SELECT COUNT(*) AS n FROM friendships WHERE a = ? OR b = ?", me, me) >= MAX_FRIENDS) return refuse(409, `You have ${MAX_FRIENDS} friends, the most there can be.`);
  befriend(db, me, them.token, now);
  return { ok: true, outcome: "friends", other: them.token };
}

/** Declines a request, silently: the sender is never told. Declining one that isn't there is fine. */
export function declineFriend(db: DatabaseSync, me: string, raw: unknown): FriendResult {
  if (!canHaveFriends(getPlayer(db, me))) return refuse(403, GUESTS_CANT);
  const nt = parseNameTag(raw);
  const them = nt && findByTag(db, nt.name, nt.tag);
  if (!them) return refuse(404, "That request is no longer there.");
  db.prepare("DELETE FROM friend_requests WHERE sender = ? AND recipient = ?").run(them.token, me);
  return { ok: true, outcome: "already", other: them.token };
}

/** Unfriends, silently. Also withdraws a request you sent them. */
export function removeFriend(db: DatabaseSync, me: string, raw: unknown): FriendResult {
  if (!canHaveFriends(getPlayer(db, me))) return refuse(403, GUESTS_CANT);
  const nt = parseNameTag(raw);
  const them = nt && findByTag(db, nt.name, nt.tag);
  if (!them) return refuse(404, NO_SUCH);
  const [a, b] = pair(me, them.token);
  db.prepare("DELETE FROM friendships WHERE a = ? AND b = ?").run(a, b);
  db.prepare("DELETE FROM friend_requests WHERE sender = ? AND recipient = ?").run(me, them.token);
  return { ok: true, outcome: "already", other: them.token };
}

// ---- friend links: a random code, only its hash stored ----

const hash = (code: string): string => createHash("sha256").update(`friend-link:${code}`).digest("hex");

/** A new friend link code for `player` (an account), working for LINK_MS, once. */
export function createFriendLink(db: DatabaseSync, player: string, now = Date.now()): { ok: true; code: string; expires: number } | Refusal {
  if (!canHaveFriends(getPlayer(db, player))) return refuse(403, GUESTS_CANT);
  db.prepare("DELETE FROM friend_links WHERE expires_at <= ?").run(now);
  const mine = db.prepare("SELECT hash FROM friend_links WHERE player = ? ORDER BY expires_at DESC").all(player) as { hash: string }[];
  for (const old of mine.slice(MAX_LINKS - 1)) db.prepare("DELETE FROM friend_links WHERE hash = ?").run(old.hash);
  const code = randomBytes(16).toString("base64url");
  const expires = now + LINK_MS;
  db.prepare("INSERT INTO friend_links (hash, player, expires_at) VALUES (?, ?, ?)").run(hash(code), player, expires);
  return { ok: true, code, expires };
}

/**
 * `me` opens someone's friend link: the two become friends at once (its maker
 * chose to share it; opening it is the other's yes). Single use: the code is
 * gone after this, whatever happens.
 */
export function useFriendLink(db: DatabaseSync, me: string, code: unknown, now = Date.now()): FriendResult {
  if (!canHaveFriends(getPlayer(db, me))) return refuse(403, GUESTS_CANT);
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{10,64}$/.test(code)) return refuse(404, "That friend link doesn't work any more. Ask for a new one.");
  const row = db.prepare("SELECT player, expires_at FROM friend_links WHERE hash = ?").get(hash(code)) as { player: string; expires_at: number } | undefined;
  if (!row || row.expires_at <= now) return refuse(404, "That friend link doesn't work any more. Ask for a new one.");
  if (row.player === me) return refuse(400, "That's your own friend link: send it to a friend.");
  db.prepare("DELETE FROM friend_links WHERE hash = ?").run(hash(code));
  const owner = getPlayer(db, row.player);
  if (!canHaveFriends(owner)) return refuse(404, "That friend link doesn't work any more. Ask for a new one.");
  if (areFriends(db, me, owner.token)) return { ok: true, outcome: "already", other: owner.token };
  for (const t of [me, owner.token]) {
    if (count(db, "SELECT COUNT(*) AS n FROM friendships WHERE a = ? OR b = ?", t, t) >= MAX_FRIENDS) return refuse(409, `One of you has ${MAX_FRIENDS} friends, the most there can be.`);
  }
  befriend(db, me, owner.token, now);
  return { ok: true, outcome: "friends", other: owner.token };
}

/** What a friends list shows about a player: name, tag, look. Never the id. */
export function publicCard(db: DatabaseSync, token: string): { name: string; tag: string; look: Look | null } | null {
  const p = getPlayer(db, token);
  if (!p?.account) return null;
  return { name: p.name, tag: showTag(p.tag ?? 0), look: lookOf(db, token) };
}
