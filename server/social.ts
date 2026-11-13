// Friends' live state and parties (task 34), over the one WebSocket each tab
// already opens. Who a socket is was settled from its cookies when it opened
// (server/index.ts); no message here names its sender. Status is worked out
// live from open connections and never stored: no socket is offline; the
// player's choice ("appear away", "appear offline") wins; else away when
// every tab says it is idle (hidden, or no input for about 5 minutes); else
// online. Only friends see it. A friend's list is pushed whole when anything
// in it changes (no polling), and once on connect, so a reconnect misses
// nothing. Parties live in memory only.
//
// Built over injected deps (a db handle, a room factory, a clock, timers off)
// so spec/party-social.test.ts runs it with fake sockets and real Rooms.
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { games } from "../shared/games/registry.ts";
import { MAX_PARTY, MAX_WATCHERS } from "../shared/protocol.ts";
import type { ClientMsg, FriendView, PartyMsg, PartyView, ServerMsg, ShownStatus } from "../shared/protocol.ts";
import { findByTag, getPlayer, lookOf } from "./accounts.ts";
import type { Player } from "./accounts.ts";
import { areFriends, friendIds, parseNameTag, publicCard, requestIds } from "./friends.ts";
import { who } from "./log.ts";
import { Party } from "./party.ts";
import { send } from "./room.ts";
import type { Client, Room } from "./room.ts";

export interface SocialDeps {
  db: DatabaseSync;
  log(event: string, fields?: Record<string, unknown>): void;
  /** A new (not practice) room for `game`, or null. */
  createRoom(game: string): Room | null;
  /** How long a party keeps a member whose last tab closed (a reload comes back in time). */
  graceMs?: number;
  /** Real timers (the live server); a test leaves them off and calls `expire`. */
  timers?: boolean;
  clock?: () => number;
}

/** Invites a player may send a minute. */
const INVITES_PER_MINUTE = 10;
/** Status, idle and party messages a second accepted from one socket. */
const SOCIAL_PER_SECOND = 20;

type Doing = FriendView["doing"];
const OFFLINE = JSON.stringify(["offline", null]);
/** A guest may join, lead and share a party by its link (user, 2026-11-08); inviting by Name#1234 needs a lasting name. */
export const GUESTS_INVITE = "Guests can't invite by name: a guest has no lasting identity. Copy the party link and send it instead, or create an account (profile, top right).";
/** Public parties are listed to the leader's friends; a guest has none. */
export const GUESTS_PUBLIC = "Only an account can make a party public to friends: a guest has no friends list. Share the party link instead.";

export class Social {
  private deps: SocialDeps;
  private clock: () => number;
  private online = new Map<string, Set<Client>>();
  private idle = new WeakSet<Client>();
  private chosen = new Map<string, ShownStatus>();
  private accounts = new Map<string, boolean>();
  private names = new Map<string, string>();
  private parties = new Map<string, Party>();
  private partyOf = new Map<string, Party>();
  private codeOf = new WeakMap<Party, string>();
  private roomOf = new WeakMap<Party, Room>();
  /** The tab a member last acted on their party from: the one moved into its rooms. */
  private partyTab = new Map<string, Client>();
  /** What each player's friends last saw of them, to push only on a change. */
  private seen = new Map<string, string>();
  private partySeen = new WeakMap<Party, string>();
  private leaving = new Map<string, { at: number; timer: NodeJS.Timeout | null }>();
  private invites = new Map<string, { start: number; count: number }>();
  private rate = new WeakMap<Client, { start: number; count: number }>();

  constructor(deps: SocialDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? Date.now;
  }

  // ---- connections ----

  /**
   * `status`: the tab's own remembered choice, sent with its hello, so a
   * player who appears offline never flashes online on a reload. A choice
   * already held (another tab, or a reload within the grace) wins.
   */
  connect(c: Client, player: Player, status?: ShownStatus): void {
    if (status && status !== "online" && !this.chosen.has(player.token) && !this.online.has(player.token)) this.chosen.set(player.token, status);
    const mine = this.online.get(player.token) ?? new Set<Client>();
    mine.add(c);
    this.online.set(player.token, mine);
    this.accounts.set(player.token, player.account);
    this.names.set(player.token, player.name);
    const pending = this.leaving.get(player.token);
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this.leaving.delete(player.token);
    }
    this.sendFriends(c, player.token);
    const party = this.partyOf.get(player.token);
    send(c, { t: "party", party: party ? this.view(party, player.token) : null });
    this.refresh(player.token);
  }

  has(c: Client): boolean {
    return this.online.get(c.token)?.has(c) ?? false;
  }

  disconnect(c: Client): void {
    const mine = this.online.get(c.token);
    if (!mine) return;
    mine.delete(c);
    if (this.partyTab.get(c.token) === c) this.partyTab.delete(c.token);
    if (mine.size === 0) {
      this.online.delete(c.token);
      // a reload comes back within the grace: party place and chosen status kept
      const grace = this.deps.graceMs ?? 30_000;
      const timer = this.deps.timers ? setTimeout(() => this.expire(c.token), grace) : null;
      this.leaving.set(c.token, { at: this.clock() + grace, timer });
    }
    this.refresh(c.token);
  }

  // nothing about a player is kept once they have no tab ("not stored past the session")
  private forget(token: string): void {
    if (this.online.has(token)) return;
    this.chosen.delete(token);
    this.accounts.delete(token);
    this.names.delete(token);
    this.invites.delete(token);
  }

  /** A member whose last tab closed didn't come back in time: they leave their party. */
  expire(token: string): void {
    this.leaving.delete(token);
    if (this.online.has(token)) return;
    this.leaveParty(token);
    this.forget(token);
  }

  /** Tests: expire everyone whose grace ran out by `now`. */
  expireDue(now = this.clock()): void {
    for (const [token, l] of this.leaving) if (l.at <= now) this.expire(token);
  }

  // ---- status ----

  /** What friends see: offline with no tab, else the chosen status, else away when every tab is idle. */
  status(token: string): ShownStatus {
    const mine = this.online.get(token);
    if (!mine || mine.size === 0) return "offline";
    const chosen = this.chosen.get(token) ?? "online";
    if (chosen !== "online") return chosen;
    return [...mine].every((c) => this.idle.has(c)) ? "away" : "online";
  }

  private doing(token: string): Doing {
    if (this.status(token) === "offline") return null;
    const party = this.partyOf.get(token);
    if (party && party.public && party.isLeader(token)) return { kind: "party", code: this.codeOf.get(party)!, size: party.size, game: party.game };
    for (const c of this.online.get(token) ?? []) {
      const room = c.room;
      if (!room || room.isClosed()) continue;
      return room.practice ? { kind: "practice", game: room.gameId } : { kind: "match", game: room.gameId, room: room.id };
    }
    return { kind: "home" };
  }

  /**
   * Call after anything that may have changed what friends see of `token`
   * (a status, a room joined or left, a party): pushes the new friends list
   * to each of their friends who is online, and the party to its members,
   * but only if something changed.
   */
  refresh(token: string): void {
    const key = JSON.stringify([this.status(token), this.doing(token)]);
    // nobody is kept here once offline: an absent entry reads as offline
    if ((this.seen.get(token) ?? OFFLINE) !== key) {
      if (this.accounts.get(token)) for (const f of friendIds(this.deps.db, token)) this.pushFriends(f);
    }
    if (this.online.has(token)) this.seen.set(token, key);
    else this.seen.delete(token);
    const party = this.partyOf.get(token);
    if (party) this.pushParty(party);
  }

  /** Every online player, re-checked (a room can close without a message from them). */
  sweep(): void {
    for (const token of [...this.online.keys()]) this.refresh(token);
  }

  /** A name or look changed (task 17/18 routes): friends and the party see it at once. */
  profileChanged(token: string): void {
    const p = getPlayer(this.deps.db, token);
    if (p) this.names.set(token, p.name);
    if (this.accounts.get(token)) for (const f of friendIds(this.deps.db, token)) this.pushFriends(f);
    this.refresh(token);
    const party = this.partyOf.get(token);
    if (party) this.pushParty(party, true);
  }

  /** Friendships or requests changed for these players (the /api routes): each gets their list again. */
  friendsChanged(tokens: string[]): void {
    for (const t of tokens) this.pushFriends(t);
  }

  private friendsMsg(token: string): Extract<ServerMsg, { t: "friends" }> {
    const status = this.chosen.get(token) ?? "online";
    if (!this.accounts.get(token)) return { t: "friends", friends: [], requests: [], status };
    const { db } = this.deps;
    const friends: FriendView[] = [];
    for (const id of friendIds(db, token)) {
      const card = publicCard(db, id);
      if (card) friends.push({ ...card, status: this.status(id), doing: this.doing(id) });
    }
    friends.sort((a, b) => a.name.localeCompare(b.name) || a.tag.localeCompare(b.tag));
    const requests = requestIds(db, token)
      .map((id) => publicCard(db, id))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return { t: "friends", friends, requests, status };
  }

  private sendFriends(c: Client, token: string): void {
    send(c, this.friendsMsg(token));
  }

  private pushFriends(token: string): void {
    const mine = this.online.get(token);
    if (!mine) return;
    const msg = this.friendsMsg(token);
    for (const c of mine) send(c, msg);
  }

  // ---- messages ----

  /** status, idle, invite and party messages from `c`'s own player. */
  message(c: Client, msg: Extract<ClientMsg, { t: "status" | "idle" | "invite" | "party" }>): void {
    const w = this.rate.get(c) ?? { start: this.clock(), count: 0 };
    if (this.clock() - w.start >= 1000) {
      w.start = this.clock();
      w.count = 0;
    }
    this.rate.set(c, w);
    if (++w.count > SOCIAL_PER_SECOND) return;
    switch (msg.t) {
      case "status":
        if (msg.status === "online") this.chosen.delete(c.token);
        else this.chosen.set(c.token, msg.status);
        this.deps.log("status", { who: who(c.token), status: msg.status });
        this.pushFriends(c.token);
        break;
      case "idle":
        if (msg.idle) this.idle.add(c);
        else this.idle.delete(c);
        break;
      case "invite":
        this.invite(c, msg.to);
        break;
      case "party":
        this.party(c, msg);
        break;
    }
    this.refresh(c.token);
  }

  private notice(c: Client, message: string): void {
    send(c, { t: "notice", message });
  }

  /** Asks a friend (exact Name#1234) to join your party, or your room. Only friends; never a stranger. */
  private invite(c: Client, raw: string): void {
    if (!this.accounts.get(c.token)) return this.notice(c, GUESTS_INVITE);
    const nt = parseNameTag(raw);
    const them = nt && findByTag(this.deps.db, nt.name, nt.tag);
    if (!them || !areFriends(this.deps.db, c.token, them.token)) return this.notice(c, "You can only invite your friends.");
    const w = this.invites.get(c.token) ?? { start: this.clock(), count: 0 };
    if (this.clock() - w.start >= 60_000) {
      w.start = this.clock();
      w.count = 0;
    }
    this.invites.set(c.token, w);
    if (++w.count > INVITES_PER_MINUTE) return this.notice(c, "That's a lot of invites. Wait a minute.");
    const party = this.partyOf.get(c.token);
    let invite: Extract<ServerMsg, { t: "invited" }> | null = null;
    const card = publicCard(this.deps.db, c.token)!;
    if (party) invite = { t: "invited", from: card, kind: "party", code: this.codeOf.get(party)!, game: party.game };
    else if (c.room && !c.room.isClosed() && !c.room.practice) invite = { t: "invited", from: card, kind: "room", code: c.room.id, game: c.room.gameId };
    if (!invite) return this.notice(c, "Start a party or a room first, then invite.");
    // sent whether or not they show as offline: the sender learns nothing from it
    for (const tab of this.online.get(them.token) ?? []) send(tab, invite);
    this.deps.log("invite", { who: who(c.token), other: who(them.token), kind: invite.kind });
    this.notice(c, `Invite sent to ${them.name}.`);
  }

  // ---- parties ----

  /**
   * The party link's code: 128 random bits, like a friend link's, so it
   * can't be guessed. It lives only in memory with its party, works for
   * anyone (guest or account, several people) while the party exists, and
   * is never logged.
   */
  private newCode(): string {
    let code = "";
    do code = randomBytes(16).toString("base64url");
    while (this.parties.has(code));
    return code;
  }

  private party(c: Client, msg: PartyMsg): void {
    const token = c.token;
    // guests too (user, 2026-11-08): they join and share by the link and may
    // lead; only the friends-based parts (invite by name, public) need an account
    const mine = this.partyOf.get(token);
    if (msg.act !== "leave") this.partyTab.set(token, c);
    switch (msg.act) {
      case "create": {
        if (mine) return this.notice(c, "You're already in a party.");
        const game = c.room && !c.room.isClosed() ? c.room.gameId : "tennis";
        const party = new Party(token, game);
        const code = this.newCode();
        this.parties.set(code, party);
        this.codeOf.set(party, code);
        this.partyOf.set(token, party);
        this.deps.log("party_create", { who: who(token) });
        this.pushParty(party, true);
        return;
      }
      case "join": {
        const party = this.parties.get(msg.code);
        if (!party) return this.notice(c, "That party has ended.");
        if (mine === party) return this.pushParty(party, true);
        if (party.size >= MAX_PARTY) return this.notice(c, "That party is full (10 of 10).");
        if (mine) this.leaveParty(token);
        party.join(token);
        this.partyOf.set(token, party);
        this.deps.log("party_join", { who: who(token), size: party.size });
        this.pushParty(party, true);
        this.refresh(party.leader);
        return;
      }
      case "leave":
        if (mine) this.leaveParty(token);
        send(c, { t: "party", party: null });
        return;
    }
    if (!mine) return this.notice(c, "You're not in a party.");
    if (!mine.isLeader(token)) return this.notice(c, "Only the party leader can do that.");
    let changed = false;
    switch (msg.act) {
      case "public":
        if (msg.public && !this.isAccount(token)) return this.notice(c, GUESTS_PUBLIC);
        changed = mine.setPublic(token, msg.public);
        break;
      case "game":
        if (!Object.hasOwn(games, msg.game)) return this.notice(c, "No such game.");
        changed = mine.setGame(token, msg.game);
        break;
      case "mode":
        changed = mine.setMode(token, msg.mode);
        break;
      case "pick":
        changed = mine.pick(token, msg.ids);
        if (!changed) return this.notice(c, mine.mode === "pick" ? "Pick two members of the party." : "Switch to “Leader picks” first.");
        break;
      case "lead":
        changed = mine.makeLeader(token, msg.id);
        if (changed) this.guestLeaderPrivate(mine);
        break;
      case "start":
        return this.start(c, mine);
    }
    if (changed) {
      this.deps.log("party_change", { who: who(token), act: msg.act });
      this.pushParty(mine, true);
      this.refresh(mine.leader);
    }
  }

  /** An account, as its socket said, else from the database (a member offline within the grace). */
  private isAccount(token: string): boolean {
    return this.accounts.get(token) ?? getPlayer(this.deps.db, token)?.account ?? false;
  }

  /** A public party whose crown passed to a guest goes back to invite only: a guest has no friends to list it to. */
  private guestLeaderPrivate(party: Party): void {
    if (party.public && party.size > 0 && !this.isAccount(party.leader)) party.public = false;
  }

  private leaveParty(token: string): void {
    const party = this.partyOf.get(token);
    if (!party) return;
    this.partyOf.delete(token);
    this.partyTab.delete(token);
    const wasLeader = party.isLeader(token);
    const empty = party.leave(token);
    if (wasLeader) this.guestLeaderPrivate(party);
    this.deps.log("party_leave", { who: who(token), size: party.size });
    if (empty) {
      this.parties.delete(this.codeOf.get(party)!);
    } else {
      this.pushParty(party, true);
      if (wasLeader) this.refresh(party.leader);
    }
    for (const tab of this.online.get(token) ?? []) send(tab, { t: "party", party: null });
    this.refresh(token);
  }

  /** The tab a member is moved into the party's room with: the one they last used for the party, else any. */
  private tabOf(token: string): Client | null {
    const t = this.partyTab.get(token);
    if (t && this.online.get(token)?.has(t)) return t;
    const any = this.online.get(token);
    return any && any.size ? [...any][0] : null;
  }

  /**
   * The leader starts the next match: a fresh room for the party's game; the
   * two next sit (the room's own rules: ready, countdown), the rest watch
   * through the spectator path. Someone mid-match in another room is left
   * where they are.
   */
  private start(c: Client, party: Party): void {
    const next = party.next();
    if (!next) return this.notice(c, "A party match needs two people. Invite a friend.");
    const current = this.roomOf.get(party);
    if (current && !current.isClosed() && current.lobby.inMatch) return this.notice(c, "A match is still being played.");
    const room = this.deps.createRoom(party.game);
    if (!room) return this.notice(c, "No such game.");
    this.roomOf.set(party, room);
    const watchers = party.members.map((m) => m.token).filter((t) => !next.includes(t));
    let watching = 0;
    for (const [token, watch] of [...next.map((t) => [t, false] as const), ...watchers.map((t) => [t, true] as const)]) {
      const tab = this.tabOf(token);
      if (!tab) continue;
      if (tab.room && tab.room !== current && tab.seat !== null && tab.room.lobby.inMatch) continue;
      if (watch && watching >= MAX_WATCHERS) continue;
      tab.room?.leave(tab);
      if (room.refusal(tab, watch)) continue;
      room.join(tab, watch);
      if (watch) watching++;
    }
    this.deps.log("party_start", { who: who(c.token), room: room.id, size: party.size });
    this.pushParty(party, true);
    for (const m of party.members) this.refresh(m.token);
  }

  /** A room's match ended (Room's onMatchEnd): if it was a party's, rotate who plays next. */
  matchEnded(room: Room, tokens: [string | null, string | null], winner: 0 | 1 | null): void {
    for (const party of this.parties.values()) {
      if (this.roomOf.get(party) !== room) continue;
      const [a, b] = tokens;
      if (!a || !b || !party.has(a) || !party.has(b)) return;
      party.played([a, b], winner === null ? null : tokens[winner]);
      this.deps.log("party_rotate", { room: room.id, mode: party.mode });
      this.pushParty(party, true);
      return;
    }
  }

  view(party: Party, viewer: string): PartyView {
    const room = this.roomOf.get(party);
    const next = party.next();
    const idOf = (t: string) => party.member(t)!.id;
    const nameOf = (t: string) => this.names.get(t) ?? getPlayer(this.deps.db, t)?.name ?? "Player";
    let last: string | null = null;
    if (party.last) last = party.last.winner === null ? "The last match had no winner." : `${nameOf(party.last.winner)} won the last match.`;
    return {
      code: this.codeOf.get(party)!,
      members: party.members.map((m) => ({
        id: m.id,
        name: nameOf(m.token),
        look: lookOf(this.deps.db, m.token),
        status: this.status(m.token),
        leader: party.isLeader(m.token),
        you: m.token === viewer,
      })),
      public: party.public,
      game: party.game,
      mode: party.mode,
      next: next ? [idOf(next[0]), idOf(next[1])] : null,
      room: room && !room.isClosed() ? room.id : null,
      last,
    };
  }

  private pushParty(party: Party, force = false): void {
    // a key without the per-viewer `you`, so a change is noticed once
    const key = JSON.stringify(this.view(party, ""));
    if (!force && this.partySeen.get(party) === key) return;
    this.partySeen.set(party, key);
    for (const m of party.members) for (const tab of this.online.get(m.token) ?? []) send(tab, { t: "party", party: this.view(party, m.token) });
  }

  /** Tests and /stats: parties alive and members in them. */
  stats(): { parties: number; members: number } {
    let members = 0;
    for (const p of this.parties.values()) members += p.size;
    return { parties: this.parties.size, members };
  }
}
