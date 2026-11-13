// Task 34: friends' live status and parties (server/social.ts) with fake
// sockets, a throwaway database and real Rooms on a fake clock: status worked
// out from open connections and seen only by friends, pushed (never polled),
// sent whole on (re)connect; parties: join by code, leader-only actions, the
// two next sit and the rest spectate, rotation after a match; guests join,
// lead and share by the link but never invite by Name#1234 or go public.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { cleanTemp, openDb } from "./temp.ts";
import { afterEach, describe, expect, it } from "vitest";
import { addPasskey, getPlayer, guestFor, newGuestToken, rename, seedDemoAccounts } from "../server/accounts.ts";
import { acceptFriend, nameTag, requestFriend } from "../server/friends.ts";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import { migrate } from "../server/schema.ts";
import { GUESTS_INVITE, GUESTS_PUBLIC, Social } from "../server/social.ts";
import { games } from "../shared/games/registry.ts";
import { parseClientMsg } from "../shared/protocol.ts";
import type { ClientMsg, FriendView, PartyView, ServerMsg } from "../shared/protocol.ts";

const dirs: string[] = [];
afterEach(() => {
  cleanTemp(dirs);
});

interface Fake extends Client {
  seen: ServerMsg[];
}

function setup() {
  const d = mkdtempSync(join(tmpdir(), "weblympics-social-"));
  dirs.push(d);
  const db = openDb(join(d, "app.db"));
  migrate(db);
  seedDemoAccounts(db);
  let now = 0;
  const rooms: Room[] = [];
  const logged: string[] = [];
  let social: Social;
  const createRoom = (game: string) => {
    const room = new Room(`R${rooms.length}`.padEnd(4, "X"), game, false, games[game].formats[0], {
      record: () => {},
      clock: () => now,
      log: () => {},
      timer: false,
      timing: { countdownMs: 50, graceMs: 200 },
      onDestroy: () => {},
      onMatchEnd: (r, tokens, winner) => social.matchEnded(r, tokens, winner),
    });
    rooms.push(room);
    return room;
  };
  social = new Social({ db, log: (e, f) => logged.push(JSON.stringify({ e, ...f })), createRoom, clock: () => now, graceMs: 1000 });
  const people = new Map<string, string>();
  const account = (name: string) => {
    const token = newGuestToken();
    guestFor(db, token);
    addPasskey(db, token, { id: `k-${name}`, publicKey: new Uint8Array([1]), counter: 0, transports: [] });
    rename(db, token, name);
    people.set(name, token);
    return token;
  };
  const befriend = (a: string, b: string) => {
    requestFriend(db, a, nameTag(getPlayer(db, b)!));
    acceptFriend(db, b, nameTag(getPlayer(db, a)!));
  };
  const tab = (token: string, status?: "online" | "away" | "offline"): Fake => {
    const p = getPlayer(db, token)!;
    const seen: ServerMsg[] = [];
    const c: Fake = { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: p.name, account: p.account, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
    social.connect(c, p, status);
    return c;
  };
  /** Sends what a browser would, through the real parser: a malformed message never arrives. */
  const say = (c: Fake, msg: unknown) => {
    const parsed = parseClientMsg(JSON.stringify(msg));
    if (parsed && (parsed.t === "status" || parsed.t === "idle" || parsed.t === "invite" || parsed.t === "party")) social.message(c, parsed as Extract<ClientMsg, { t: "party" }>);
    return parsed;
  };
  const advance = (ms: number) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      for (const r of rooms) r.pump();
    }
  };
  return { db, social, account, befriend, tab, say, rooms, logged, advance, people, setNow: (t: number) => (now = t) };
}

/** A new guest (no passkey): a server-made pseudonym, known only by its cookie's token. */
const guest = (s: ReturnType<typeof setup>): string => {
  const g = newGuestToken();
  guestFor(s.db, g);
  return g;
};

const last = <T extends ServerMsg["t"]>(c: Fake, t: T) => c.seen.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
const friendsOf = (c: Fake): FriendView[] => last(c, "friends")!.friends;
const partyOf = (c: Fake): PartyView | null => last(c, "party")!.party;
const friend = (c: Fake, name: string) => friendsOf(c).find((f) => f.name === name);

describe("status (worked out live, seen only by friends)", () => {
  it("a friend with a tab open is online, with none offline; strangers get nothing", () => {
    const s = setup();
    const [ana, ben, cy] = [s.account("Ana"), s.account("Ben"), s.account("Cyd")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    expect(friend(a, "Ben")).toMatchObject({ status: "offline", doing: null });
    const before = a.seen.length;
    const b = s.tab(ben);
    // pushed to Ana at once: no polling
    expect(a.seen.length).toBeGreaterThan(before);
    expect(friend(a, "Ben")).toMatchObject({ status: "online", doing: { kind: "home" } });
    expect(friend(b, "Ana")).toMatchObject({ status: "online" });
    // a stranger sees no one, and Ana and Ben don't see the stranger come online
    const n = a.seen.length;
    const c = s.tab(cy);
    expect(friendsOf(c)).toEqual([]);
    expect(a.seen.length).toBe(n);
    s.social.disconnect(b);
    expect(friend(a, "Ben")).toMatchObject({ status: "offline", doing: null });
  });

  it("away when every tab is idle; one active tab is enough for online", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b1 = s.tab(ben);
    const b2 = s.tab(ben);
    s.say(b1, { t: "idle", idle: true });
    expect(friend(a, "Ben")!.status).toBe("online");
    s.say(b2, { t: "idle", idle: true });
    expect(friend(a, "Ben")!.status).toBe("away");
    s.say(b1, { t: "idle", idle: false });
    expect(friend(a, "Ben")!.status).toBe("online");
  });

  it("appear away and appear offline are the player's choice; offline hides what they're doing too", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    s.say(b, { t: "status", status: "away" });
    expect(friend(a, "Ben")!.status).toBe("away");
    s.say(b, { t: "status", status: "offline" });
    expect(friend(a, "Ben")).toMatchObject({ status: "offline", doing: null });
    // Ben's own list remembers his choice
    expect(last(b, "friends")!.status).toBe("offline");
    s.say(b, { t: "status", status: "online" });
    expect(friend(a, "Ben")!.status).toBe("online");
  });

  it("a reload that remembers 'appear offline' never shows online, even for a moment", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    s.tab(ben, "offline");
    expect(a.seen.filter((m) => m.t === "friends").every((m) => (m as Extract<ServerMsg, { t: "friends" }>).friends.every((f) => f.status === "offline"))).toBe(true);
  });

  it("the choice isn't stored past the session: once the last tab is gone for good it resets", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    s.say(b, { t: "status", status: "away" });
    s.social.disconnect(b);
    s.setNow(5000);
    s.social.expireDue();
    s.tab(ben);
    expect(friend(a, "Ben")!.status).toBe("online");
  });

  it("what a friend is doing: in a room (with its code, to watch) or on the home screen", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    const room = s.rooms.length ? s.rooms[0] : null;
    expect(room).toBeNull();
    const r = new Room("ABCD", "archery", false, "stages", { record: () => {}, clock: () => 0, log: () => {}, timer: false, timing: {}, onDestroy: () => {} });
    r.join(b);
    s.social.refresh(ben);
    expect(friend(a, "Ben")!.doing).toEqual({ kind: "match", game: "archery", room: "ABCD" });
    r.leave(b);
    s.social.sweep();
    expect(friend(a, "Ben")!.doing).toEqual({ kind: "home" });
  });

  it("on (re)connect the whole list and requests come at once, so nothing missed is lost", () => {
    const s = setup();
    const [ana, ben, cy] = [s.account("Ana"), s.account("Ben"), s.account("Cyd")];
    s.befriend(ana, ben);
    requestFriend(s.db, cy, nameTag(getPlayer(s.db, ana)!));
    const a = s.tab(ana);
    const msg = last(a, "friends")!;
    expect(msg.friends.map((f) => `${f.name}#${f.tag}`)).toEqual([nameTag(getPlayer(s.db, ben)!)]);
    expect(msg.requests.map((r) => r.name)).toEqual(["Cyd"]);
    expect(partyOf(a)).toBeNull();
    // never an id
    expect(JSON.stringify(a.seen)).not.toContain(ben);
    expect(JSON.stringify(a.seen)).not.toContain(cy);
  });

  it("a guest's list is empty and a guest is never anyone's friend", () => {
    const s = setup();
    const g = newGuestToken();
    guestFor(s.db, g);
    const c = s.tab(g);
    expect(last(c, "friends")).toMatchObject({ friends: [], requests: [] });
  });
});

describe("parties", () => {
  function three() {
    const s = setup();
    const [ana, ben, cy] = [s.account("Ana"), s.account("Ben"), s.account("Cyd")];
    s.befriend(ana, ben);
    s.befriend(ana, cy);
    const a = s.tab(ana);
    const b = s.tab(ben);
    const c = s.tab(cy);
    s.say(a, { t: "party", act: "create" });
    const code = partyOf(a)!.code;
    s.say(b, { t: "party", act: "join", code });
    s.say(c, { t: "party", act: "join", code });
    return { s, ana, ben, cy, a, b, c, code };
  }

  it("create, join by code: everyone sees every member, the leader and who plays next", () => {
    const { a, b, c } = three();
    for (const t of [a, b, c]) {
      const p = partyOf(t)!;
      expect(p.members.map((m) => m.name)).toEqual(["Ana", "Ben", "Cyd"]);
      expect(p.members.find((m) => m.leader)!.name).toBe("Ana");
      expect(p.members.filter((m) => m.you)).toHaveLength(1);
      expect(p.next!.map((id) => p.members.find((m) => m.id === id)!.name)).toEqual(["Ana", "Ben"]);
      expect(p.public).toBe(false);
      expect(p.mode).toBe("winner");
    }
  });

  it("a guest joins by the code and is shown by their pseudonym; the code is a long random one", () => {
    const { s, a, code } = three();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const g = guest(s);
    const gt = s.tab(g);
    s.say(gt, { t: "party", act: "join", code });
    const name = getPlayer(s.db, g)!.name;
    expect(partyOf(gt)!.members.map((m) => m.name)).toEqual(["Ana", "Ben", "Cyd", name]);
    expect(partyOf(a)!.members.at(-1)).toMatchObject({ name, look: null, leader: false });
    expect(partyOf(gt)!.code).toBe(code);
  });

  it("the code is reusable while the party exists: leave and rejoin by it", () => {
    const { s, b, code } = three();
    s.say(b, { t: "party", act: "leave" });
    expect(partyOf(b)).toBeNull();
    s.say(b, { t: "party", act: "join", code });
    expect(partyOf(b)!.members.map((m) => m.name)).toEqual(["Ana", "Cyd", "Ben"]);
  });

  it("a guest creates, leads and starts a party; another guest joins by its code and plays", () => {
    const s = setup();
    const [g1, g2, g3] = [guest(s), guest(s), guest(s)];
    const [t1, t2, t3] = [s.tab(g1), s.tab(g2), s.tab(g3)];
    s.say(t1, { t: "party", act: "create" });
    const code = partyOf(t1)!.code;
    expect(partyOf(t1)!.members).toEqual([expect.objectContaining({ name: getPlayer(s.db, g1)!.name, leader: true, you: true })]);
    s.say(t2, { t: "party", act: "join", code });
    s.say(t3, { t: "party", act: "join", code });
    s.say(t1, { t: "party", act: "game", game: "boxing" });
    s.say(t1, { t: "party", act: "mode", mode: "swap" });
    expect(partyOf(t3)).toMatchObject({ game: "boxing", mode: "swap" });
    s.say(t1, { t: "party", act: "start" });
    const room = s.rooms[0];
    expect(room.gameId).toBe("boxing");
    expect([t1.seat, t2.seat]).toEqual([0, 1]);
    expect(t3.room).toBe(room);
    expect(t3.seat).toBeNull();
    // swap: both to the back
    s.social.matchEnded(room, [g1, g2], 0);
    const p = partyOf(t1)!;
    expect(p.next!.map((id) => p.members.find((m) => m.id === id)!.name)).toEqual([getPlayer(s.db, g3)!.name, getPlayer(s.db, g1)!.name]);
  });

  it("a guest leader's crown passes to the longest-standing member, and a guest keeps their place for the grace", () => {
    const s = setup();
    const [g1, g2, ana] = [guest(s), guest(s), s.account("Ana")];
    const [t1, t2, a] = [s.tab(g1), s.tab(g2), s.tab(ana)];
    s.say(t1, { t: "party", act: "create" });
    const code = partyOf(t1)!.code;
    s.say(t2, { t: "party", act: "join", code });
    s.say(a, { t: "party", act: "join", code });
    // the guest leader's last tab closes: still leader within the grace
    s.social.disconnect(t1);
    expect(partyOf(a)!.members.find((m) => m.leader)!.name).toBe(getPlayer(s.db, g1)!.name);
    s.setNow(500);
    const back = s.tab(g1);
    expect(partyOf(back)!.members.find((m) => m.you)!.leader).toBe(true);
    s.social.disconnect(back);
    s.setNow(2000);
    s.social.expireDue();
    // gone: the crown passes to the next longest-standing member, another guest
    expect(partyOf(a)!.members.map((m) => m.name)).toEqual([getPlayer(s.db, g2)!.name, "Ana"]);
    expect(partyOf(t2)!.members.find((m) => m.you)!.leader).toBe(true);
    s.say(t2, { t: "party", act: "mode", mode: "pick" });
    expect(partyOf(a)!.mode).toBe("pick");
  });

  it("a guest can't invite by Name#1234 or make the party public (no friends list); they're told to share the link", () => {
    const s = setup();
    const ana = s.account("Ana");
    const g = guest(s);
    const a = s.tab(ana);
    const gt = s.tab(g);
    s.say(gt, { t: "party", act: "create" });
    s.say(gt, { t: "invite", to: nameTag(getPlayer(s.db, ana)!) });
    expect(last(a, "invited")).toBeUndefined();
    expect(last(gt, "notice")!.message).toBe(GUESTS_INVITE);
    expect(GUESTS_INVITE).toMatch(/party link/i);
    s.say(gt, { t: "party", act: "public", public: true });
    expect(partyOf(gt)!.public).toBe(false);
    expect(last(gt, "notice")!.message).toBe(GUESTS_PUBLIC);
  });

  it("a public party whose crown passes to a guest goes back to invite only", () => {
    const s = setup();
    const [ana, dee] = [s.account("Ana"), s.account("Dee")];
    s.befriend(ana, dee);
    const g = guest(s);
    const a = s.tab(ana);
    const d = s.tab(dee);
    const gt = s.tab(g);
    s.say(a, { t: "party", act: "create" });
    s.say(a, { t: "party", act: "public", public: true });
    s.say(gt, { t: "party", act: "join", code: partyOf(a)!.code });
    expect(friend(d, "Ana")!.doing).toMatchObject({ kind: "party" });
    s.say(a, { t: "party", act: "leave" });
    expect(partyOf(gt)).toMatchObject({ public: false, members: [expect.objectContaining({ leader: true, you: true })] });
    // the guest leads now; an account given the crown can make it public again
    s.say(d, { t: "party", act: "join", code: partyOf(gt)!.code });
    s.say(gt, { t: "party", act: "lead", id: partyOf(gt)!.members.find((m) => !m.you)!.id });
    s.say(d, { t: "party", act: "public", public: true });
    expect(partyOf(gt)!.public).toBe(true);
  });

  it("a full party refuses the code with a plain message; a bad or old code is refused", () => {
    const s = setup();
    const lead = guest(s);
    const l = s.tab(lead);
    s.say(l, { t: "party", act: "create" });
    const code = partyOf(l)!.code;
    const tabs = Array.from({ length: 9 }, () => s.tab(guest(s)));
    for (const t of tabs) s.say(t, { t: "party", act: "join", code });
    expect(partyOf(l)!.members).toHaveLength(10);
    const late = s.tab(guest(s));
    s.say(late, { t: "party", act: "join", code });
    expect(partyOf(late)).toBeNull();
    expect(last(late, "notice")!.message).toBe("That party is full (10 of 10).");
    // someone leaves: the same link works again
    s.say(tabs[0], { t: "party", act: "leave" });
    s.say(late, { t: "party", act: "join", code });
    expect(partyOf(late)!.members).toHaveLength(10);
    // a code that never existed, and one whose party has ended
    const other = s.tab(guest(s));
    s.say(other, { t: "party", act: "join", code: "AAAAAAAAAAAAAAAAAAAAAA" });
    expect(last(other, "notice")!.message).toMatch(/party has ended/i);
    const solo = s.tab(guest(s));
    s.say(solo, { t: "party", act: "create" });
    const old = partyOf(solo)!.code;
    s.say(solo, { t: "party", act: "leave" });
    s.say(other, { t: "party", act: "join", code: old });
    expect(partyOf(other)).toBeNull();
    expect(last(other, "notice")!.message).toMatch(/party has ended/i);
    // a malformed code never reaches the server's rules
    expect(s.say(other, { t: "party", act: "join", code: "../x" })).toBeNull();
    expect(s.say(other, { t: "party", act: "join", code, as: "Ana" })).toBeNull();
  });

  it("only the leader changes things; anyone else is told so and nothing changes", () => {
    const { s, a, b } = three();
    s.say(b, { t: "party", act: "public", public: true });
    s.say(b, { t: "party", act: "mode", mode: "swap" });
    s.say(b, { t: "party", act: "game", game: "archery" });
    s.say(b, { t: "party", act: "start" });
    expect(last(b, "notice")!.message).toMatch(/only the party leader/i);
    expect(partyOf(a)).toMatchObject({ public: false, mode: "winner", game: "tennis", room: null });
    s.say(a, { t: "party", act: "public", public: true });
    s.say(a, { t: "party", act: "mode", mode: "swap" });
    s.say(a, { t: "party", act: "game", game: "archery" });
    expect(partyOf(b)).toMatchObject({ public: true, mode: "swap", game: "archery" });
    s.say(a, { t: "party", act: "game", game: "chess" });
    expect(partyOf(b)!.game).toBe("archery");
  });

  it("malformed party messages are dropped whole by the parser", () => {
    for (const bad of [
      { t: "party" },
      { t: "party", act: "fly" },
      { t: "party", act: "create", leader: true },
      { t: "party", act: "join", code: "x" },
      { t: "party", act: "join", code: 42 },
      { t: "party", act: "public", public: "yes" },
      { t: "party", act: "mode", mode: "chaos" },
      { t: "party", act: "pick", ids: ["abcdefgh"] },
      { t: "party", act: "pick", ids: ["abcdefgh", "abcdefgh"] },
      { t: "party", act: "pick", ids: ["abcdefgh", "ijkmnpqr"], token: "x" },
      { t: "party", act: "lead", id: "../../" },
      { t: "status", status: "invisible" },
      { t: "status", status: "away", as: "someone" },
      { t: "idle", idle: 1 },
      { t: "invite", to: 42 },
      { t: "invite", to: "Ana#0001", from: "Ben#0002" },
    ]) {
      expect(parseClientMsg(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it("public parties are listed to the leader's friends, never to strangers", () => {
    const { s, ana, a } = three();
    const [dee, eve] = [s.account("Dee"), s.account("Eve")];
    s.befriend(ana, dee);
    const d = s.tab(dee);
    const e = s.tab(eve);
    expect(friend(d, "Ana")!.doing).toEqual({ kind: "home" });
    s.say(a, { t: "party", act: "public", public: true });
    expect(friend(d, "Ana")!.doing).toMatchObject({ kind: "party", size: 3, game: "tennis", code: partyOf(a)!.code });
    expect(friendsOf(e)).toEqual([]);
    expect(JSON.stringify(e.seen)).not.toContain(partyOf(a)!.code);
    // back to invite-only: the listing goes
    s.say(a, { t: "party", act: "public", public: false });
    expect(friend(d, "Ana")!.doing).toEqual({ kind: "home" });
  });

  it("at most 10: the 11th is told it's full", () => {
    const s = setup();
    const lead = s.account("Lead");
    const l = s.tab(lead);
    s.say(l, { t: "party", act: "create" });
    const code = partyOf(l)!.code;
    const tabs = Array.from({ length: 10 }, (_, i) => s.tab(s.account(`Member ${String.fromCharCode(65 + i)}`)));
    for (const t of tabs) s.say(t, { t: "party", act: "join", code });
    expect(partyOf(l)!.members).toHaveLength(10);
    expect(partyOf(tabs[9])).toBeNull();
    expect(last(tabs[9], "notice")!.message).toMatch(/full/i);
  });

  it("start: the two next sit in a new room for the party's game; the others watch through the spectator path", () => {
    const { s, a, b, c } = three();
    s.say(a, { t: "party", act: "start" });
    const room = s.rooms[0];
    expect(room.gameId).toBe("tennis");
    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    expect(c.room).toBe(room);
    expect(c.seat).toBeNull();
    expect(room.spectators.has(c)).toBe(true);
    expect(partyOf(c)!.room).toBe(room.id);
    // a spectator's input is ignored by the room, as for any watcher
    room.ready(c, true);
    expect(room.lobbyView().seats.every((x) => !x?.ready)).toBe(true);
  });

  it("winner stays on: after a match the loser watches and the next member plays, in a fresh room", () => {
    const { s, ana, ben, a, b, c } = three();
    s.say(a, { t: "party", act: "start" });
    const room = s.rooms[0];
    // the match's result, as the room reports it: Ben won
    s.social.matchEnded(room, [ana, ben], 1);
    const p = partyOf(a)!;
    const names = p.next!.map((id) => p.members.find((m) => m.id === id)!.name);
    expect(names).toEqual(["Ben", "Cyd"]);
    expect(p.last).toBe("Ben won the last match.");
    s.say(a, { t: "party", act: "start" });
    const next = s.rooms[1];
    expect(b.room).toBe(next);
    expect(c.room).toBe(next);
    expect([b.seat, c.seat].sort()).toEqual([0, 1]);
    expect(a.room).toBe(next);
    expect(a.seat).toBeNull();
  });

  it("a real match finishing in the party's room rotates it (a track race, winner stays on)", () => {
    const { s, a, b } = three();
    s.say(a, { t: "party", act: "game", game: "track" });
    s.say(a, { t: "party", act: "start" });
    const room = s.rooms[0];
    expect(room.gameId).toBe("track");
    room.ready(a, true);
    room.ready(b, true);
    s.advance(3000);
    // Ben runs, Ana stands still: Ben wins the race
    let side: "left" | "right" = "left";
    for (let i = 0; i < 2000 && room.lobby.inMatch; i++) {
      room.step(b, { t: "step", side, at: i * 120 + 4000 });
      side = side === "left" ? "right" : "left";
      s.advance(120);
    }
    expect(room.lobby.inMatch).toBe(false);
    const p = partyOf(a)!;
    expect(p.next!.map((id) => p.members.find((m) => m.id === id)!.name)).toEqual(["Ben", "Cyd"]);
    expect(p.last).toBe("Ben won the last match.");
  });

  it("start is refused while the party's match is still being played", () => {
    const { s, a, b } = three();
    s.say(a, { t: "party", act: "start" });
    const room = s.rooms[0];
    room.ready(a, true);
    room.ready(b, true);
    s.advance(200);
    expect(room.lobby.inMatch).toBe(true);
    s.say(a, { t: "party", act: "start" });
    expect(s.rooms).toHaveLength(1);
    expect(last(a, "notice")!.message).toMatch(/still being played/i);
  });

  it("leader picks: the leader chooses the two; a non-member id is refused", () => {
    const { s, a, b } = three();
    s.say(a, { t: "party", act: "mode", mode: "pick" });
    const p = partyOf(a)!;
    const id = (n: string) => p.members.find((m) => m.name === n)!.id;
    s.say(a, { t: "party", act: "pick", ids: [id("Cyd"), id("Ben")] });
    expect(partyOf(b)!.next).toEqual([id("Cyd"), id("Ben")]);
    s.say(a, { t: "party", act: "pick", ids: [id("Cyd"), "zzzzzzzz"] });
    expect(partyOf(b)!.next).toEqual([id("Cyd"), id("Ben")]);
  });

  it("the leader leaving passes the crown; a member's last tab closing keeps their place for the grace, then they leave", () => {
    const { s, a, b, c } = three();
    s.social.disconnect(b);
    expect(partyOf(a)!.members.map((m) => m.name)).toEqual(["Ana", "Ben", "Cyd"]);
    expect(partyOf(a)!.members.find((m) => m.name === "Ben")!.status).toBe("offline");
    s.setNow(2000);
    s.social.expireDue();
    expect(partyOf(a)!.members.map((m) => m.name)).toEqual(["Ana", "Cyd"]);
    s.say(a, { t: "party", act: "leave" });
    expect(partyOf(a)).toBeNull();
    expect(partyOf(c)!.members).toEqual([expect.objectContaining({ name: "Cyd", leader: true })]);
  });

  it("a reload within the grace keeps the party", () => {
    const { s, ben, a, b } = three();
    s.social.disconnect(b);
    s.setNow(500);
    const again = s.tab(ben);
    s.setNow(2000);
    s.social.expireDue();
    expect(partyOf(again)!.members.map((m) => m.name)).toEqual(["Ana", "Ben", "Cyd"]);
    expect(partyOf(a)!.members).toHaveLength(3);
  });
});

describe("invites (friends only)", () => {
  it("a friend gets the invite to your party; a stranger can't be invited; nothing says whether they're really there", () => {
    const s = setup();
    const [ana, ben, cy] = [s.account("Ana"), s.account("Ben"), s.account("Cyd")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    const c = s.tab(cy);
    s.say(a, { t: "invite", to: nameTag(getPlayer(s.db, ben)!) });
    expect(last(a, "notice")!.message).toMatch(/start a party or a room/i);
    s.say(a, { t: "party", act: "create" });
    s.say(a, { t: "invite", to: nameTag(getPlayer(s.db, ben)!) });
    expect(last(b, "invited")).toMatchObject({ kind: "party", code: partyOf(a)!.code, game: "tennis", from: { name: "Ana" } });
    s.say(a, { t: "invite", to: nameTag(getPlayer(s.db, cy)!) });
    expect(last(c, "invited")).toBeUndefined();
    expect(last(a, "notice")!.message).toMatch(/only invite your friends/i);
  });

  it("from a room, the invite carries the room's code (the existing invite flow)", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    const r = new Room("WXYZ", "boxing", false, "bout", { record: () => {}, clock: () => 0, log: () => {}, timer: false, timing: {}, onDestroy: () => {} });
    r.join(a);
    s.say(a, { t: "invite", to: nameTag(getPlayer(s.db, ben)!) });
    expect(last(b, "invited")).toMatchObject({ kind: "room", code: "WXYZ", game: "boxing" });
  });

  it("invites are rate limited", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    s.say(a, { t: "party", act: "create" });
    for (let i = 0; i < 15; i++) {
      s.setNow(i * 100);
      s.say(a, { t: "invite", to: nameTag(getPlayer(s.db, ben)!) });
    }
    expect(b.seen.filter((m) => m.t === "invited")).toHaveLength(10);
  });
});

describe("logs (task 8's rule)", () => {
  it("party and invite events carry only `who` hashes, never a token or a name", () => {
    const s = setup();
    const [ana, ben] = [s.account("Ana"), s.account("Ben")];
    s.befriend(ana, ben);
    const a = s.tab(ana);
    const b = s.tab(ben);
    s.say(a, { t: "status", status: "away" });
    s.say(a, { t: "party", act: "create" });
    s.say(b, { t: "party", act: "join", code: partyOf(a)!.code });
    // a guest by the link, with a bad code first
    const g = guest(s);
    const gt = s.tab(g);
    s.say(gt, { t: "party", act: "join", code: "BBBBBBBBBBBBBBBBBBBBBB" });
    s.say(gt, { t: "party", act: "join", code: partyOf(a)!.code });
    s.say(a, { t: "invite", to: nameTag(getPlayer(s.db, ben)!) });
    s.say(a, { t: "party", act: "start" });
    const out = s.logged.join("\n");
    expect(out).toContain("party_create");
    expect(out).toContain("party_join");
    for (const secret of [ana, ben, g, "Ana", "Ben", getPlayer(s.db, g)!.name, partyOf(a)!.code, "BBBBBBBBBBBBBBBBBBBBBB"]) expect(out).not.toContain(secret);
  });
});
