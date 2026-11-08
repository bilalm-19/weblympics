// A party's rules (task 34), apart from sockets, rooms and the database:
// members (at most 10), the leader, public or invite-only, the game, who
// plays next and how that rotates. Pure, with randomness passed in, so every
// rule is tested directly (spec/party-rules.test.ts). server/social.ts drives
// it. Games stay 1v1: two members play, the rest watch.
import { MAX_PARTY } from "../shared/protocol.ts";
import type { PartyMode } from "../shared/protocol.ts";

export interface Member {
  token: string;
  /** The party's own id for this member, random, never an account's id. */
  id: string;
}

export type JoinResult = "joined" | "already" | "full";

export class Party {
  members: Member[] = [];
  leader: string;
  public = false;
  game: string;
  mode: PartyMode = "winner";
  /**
   * Rotation order: who plays next is its first two. "winner" keeps the
   * winner first and sends the loser to the back; "swap" sends both to the
   * back; "pick" is the leader moving two to the front; "random" draws two.
   */
  order: string[] = [];
  /** The last match's result, for the lobby ("Ana won"); set by the caller. */
  last: { winner: string | null } | null = null;
  private rand: () => number;

  constructor(leader: string, game: string, rand: () => number = Math.random) {
    this.leader = leader;
    this.game = game;
    this.rand = rand;
    this.join(leader);
  }

  has(token: string): boolean {
    return this.members.some((m) => m.token === token);
  }

  member(token: string): Member | undefined {
    return this.members.find((m) => m.token === token);
  }

  byId(id: string): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  get size(): number {
    return this.members.length;
  }

  join(token: string): JoinResult {
    if (this.has(token)) return "already";
    if (this.members.length >= MAX_PARTY) return "full";
    let id = "";
    do id = Array.from({ length: 8 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(this.rand() * 32)]).join("");
    while (this.byId(id));
    this.members.push({ token, id });
    this.order.push(token);
    return "joined";
  }

  /** A member goes. The leader's crown passes to the longest-standing member. Returns true if the party is now empty. */
  leave(token: string): boolean {
    if (!this.has(token)) return this.members.length === 0;
    this.members = this.members.filter((m) => m.token !== token);
    this.order = this.order.filter((t) => t !== token);
    if (this.leader === token && this.members.length > 0) this.leader = this.members[0].token;
    return this.members.length === 0;
  }

  isLeader(token: string): boolean {
    return this.leader === token;
  }

  /** The two who play next, or null with fewer than two members. */
  next(): [string, string] | null {
    return this.order.length >= 2 ? [this.order[0], this.order[1]] : null;
  }

  /** Leader only: hands the crown to another member. */
  makeLeader(by: string, id: string): boolean {
    const m = this.byId(id);
    if (!this.isLeader(by) || !m || m.token === by) return false;
    this.leader = m.token;
    return true;
  }

  setPublic(by: string, value: boolean): boolean {
    if (!this.isLeader(by) || this.public === value) return false;
    this.public = value;
    return true;
  }

  setGame(by: string, game: string): boolean {
    if (!this.isLeader(by) || this.game === game) return false;
    this.game = game;
    return true;
  }

  /** Leader only. Picking "random" draws the next two at once. */
  setMode(by: string, mode: PartyMode): boolean {
    if (!this.isLeader(by) || this.mode === mode) return false;
    this.mode = mode;
    if (mode === "random") this.draw();
    return true;
  }

  /** Leader only, in "pick" mode: these two members play next. */
  pick(by: string, ids: [string, string]): boolean {
    if (!this.isLeader(by) || this.mode !== "pick") return false;
    const [a, b] = ids.map((id) => this.byId(id));
    if (!a || !b || a === b) return false;
    this.order = [a.token, b.token, ...this.order.filter((t) => t !== a.token && t !== b.token)];
    return true;
  }

  /**
   * A match between `players` ended; `winner` is one of them, or null (a
   * draw, or a format with no winner). Rotates by the mode.
   */
  played(players: [string, string], winner: string | null): void {
    this.last = { winner };
    const [p0, p1] = players;
    const rest = this.order.filter((t) => t !== p0 && t !== p1);
    const inParty = (t: string) => this.has(t);
    switch (this.mode) {
      case "pick":
        // the leader picks again; until then the same two are first
        return;
      case "winner": {
        if (winner === null || !inParty(winner)) {
          this.order = [...rest, ...[p0, p1].filter(inParty)];
          return;
        }
        const loser = winner === p0 ? p1 : p0;
        this.order = [winner, ...rest, ...(inParty(loser) ? [loser] : [])];
        return;
      }
      case "swap":
        this.order = [...rest, ...[p0, p1].filter(inParty)];
        return;
      case "random":
        this.draw([p0, p1]);
        return;
    }
  }

  /**
   * Two at random. With four or more members, two who didn't just play
   * (`avoid`) are drawn, so the same pair doesn't keep coming up.
   */
  private draw(avoid: string[] = []): void {
    const pool = this.order.length >= 4 ? this.order.filter((t) => !avoid.includes(t)) : [...this.order];
    if (pool.length < 2) return;
    const i = Math.floor(this.rand() * pool.length);
    let j = Math.floor(this.rand() * (pool.length - 1));
    if (j >= i) j++;
    const a = pool[i];
    const b = pool[j];
    this.order = [a, b, ...this.order.filter((t) => t !== a && t !== b)];
  }
}
