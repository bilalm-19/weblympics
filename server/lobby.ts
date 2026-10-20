// The room's rules (task 4), apart from sockets and the game: who sits where,
// ready flags, the host's format, the countdown, and the 30 s hold on a seat
// whose player dropped mid-match. Pure, with the clock passed in, so every
// rule is tested without waiting (spec/lobby.test.ts). rooms.ts drives it.

import { DEFAULT_LOOKS } from "../shared/look.ts";
import type { Look } from "../shared/look.ts";
import type { LobbyView, Phase, RoomFormat } from "../shared/protocol.ts";

export type Seat = 0 | 1;

export const COUNTDOWN_MS = 3000;
export const GRACE_MS = 30_000;

export interface Timing {
  countdownMs: number;
  graceMs: number;
}

export interface SeatInfo {
  token: string;
  name: string;
  ready: boolean;
  connected: boolean;
  bot: boolean;
  /** A signed-in account (task 17), not a guest. */
  account: boolean;
  /** The account's saved look (task 18); null shows the seat's default. */
  look: Look | null;
}

/** Who is sitting down, beyond their token and name. */
export interface Sitter {
  account?: boolean;
  look?: Look | null;
}

export type Tick = "start" | "resume" | "close" | null;

const BOT_SEAT: Seat = 1;
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

export class Lobby {
  readonly practice: boolean;
  format: RoomFormat;
  /** Task 7: the host's "rated" option (off by default). */
  rated = false;
  seats: [SeatInfo | null, SeatInfo | null] = [null, null];
  host: Seat | null = null;
  /** A match has started and not ended (it may be paused or counting down to resume). */
  inMatch = false;
  private countdownUntil: number | null = null;
  // per seat: when its hold runs out, while that seat's player is gone mid-match
  private held: [number | null, number | null] = [null, null];
  private timing: Timing;

  constructor(practice: boolean, format: RoomFormat = "oneSet", timing: Partial<Timing> = {}) {
    this.practice = practice;
    this.format = practice ? "oneSet" : format;
    this.timing = { countdownMs: COUNTDOWN_MS, graceMs: GRACE_MS, ...timing };
    // the bot is always ready
    if (practice) this.seats[BOT_SEAT] = { token: "", name: "Bot", ready: true, connected: true, bot: true, account: false, look: null };
  }

  phase(): Phase {
    // practice is instant: the bot is always ready, so play starts as soon as
    // the player sits, with no countdown
    if (this.practice) return this.seats[0] ? "playing" : "waiting";
    if (this.held[0] !== null || this.held[1] !== null) return "paused";
    if (this.countdownUntil !== null) return "countdown";
    if (this.inMatch) return "playing";
    if (!this.seats[0] || !this.seats[1]) return "waiting";
    return "ready-check";
  }

  isHeld(seat: Seat): boolean {
    return this.held[seat] !== null;
  }

  /**
   * The seat a newcomer with `token` gets: a seat held for that token first
   * (reclaim), else the first free seat, else null (a spectator). A held seat
   * is never given to anyone else.
   */
  seatFor(token: string): Seat | null {
    for (const s of [0, 1] as const) if (this.held[s] !== null && this.seats[s]?.token === token) return s;
    for (const s of [0, 1] as const) if (this.seats[s] === null) return s;
    return null;
  }

  /** Puts a player in `seat` (from seatFor). Returns true if it reclaimed a held seat. */
  sit(seat: Seat, token: string, name: string, now: number, who: Sitter = {}): boolean {
    if (this.held[seat] !== null && this.seats[seat]?.token === token) {
      this.held[seat] = null;
      const s = this.seats[seat]!;
      s.connected = true;
      s.look = who.look ?? s.look;
      s.ready = true;
      // the match resumes after a countdown, once nobody else is still away
      if (this.held[other(seat)] === null) this.countdownUntil = now + this.timing.countdownMs;
      return true;
    }
    this.seats[seat] = { token, name, ready: this.practice, connected: true, bot: false, account: who.account ?? false, look: who.look ?? null };
    this.host ??= seat;
    this.recount(now);
    return false;
  }

  /** Sets a seated person's ready flag before the match; anything else is ignored. */
  setReady(seat: Seat, ready: boolean, now: number): boolean {
    const s = this.seats[seat];
    if (this.practice || this.inMatch || !s || s.bot || s.ready === ready) return false;
    s.ready = ready;
    this.recount(now);
    return true;
  }

  /** The host picks the format before play; it clears both ready flags. */
  setFormat(seat: Seat, format: RoomFormat, now: number): "ok" | "same" | "not host" | "started" {
    if (this.practice || this.host !== seat) return "not host";
    if (this.inMatch) return "started";
    if (format === this.format) return "same";
    this.format = format;
    for (const s of this.seats) if (s && !s.bot) s.ready = false;
    this.recount(now);
    return "ok";
  }

  /** The host turns "rated" on or off before play; like the format, it clears both ready flags. */
  setRated(seat: Seat, rated: boolean, now: number): "ok" | "same" | "not host" | "started" {
    if (this.practice || this.host !== seat) return "not host";
    if (this.inMatch) return "started";
    if (rated === this.rated) return "same";
    this.rated = rated;
    for (const s of this.seats) if (s && !s.bot) s.ready = false;
    this.recount(now);
    return "ok";
  }

  /**
   * Why a match here can't be rated right now, or null if it would be (when
   * the host has it on and the match is finished). The server's own rule,
   * the same one isRated() applies to the stored result.
   */
  ratedBlocked(): string | null {
    if (this.practice) return "Practice against the bot is never rated.";
    if (this.format === "unlimited") return "Unlimited has no winner, so it isn't rated.";
    const [a, b] = this.seats;
    if (!a || !b) return "Rated needs two signed-in players.";
    if (!a.account || !b.account) return "A guest is playing: rated needs both players signed in.";
    if (a.token === b.token) return "One account on both seats can't play rated.";
    return null;
  }

  /**
   * The person in `seat` went. Mid-match a dropped connection holds the seat
   * and pauses the match; choosing to leave ends the match ("ended"). Before
   * the match the seat is simply freed.
   */
  leave(seat: Seat, now: number, dropped: boolean): "held" | "ended" | "freed" {
    const s = this.seats[seat];
    if (!s) return "freed";
    if (this.inMatch && !this.practice && dropped) {
      s.connected = false;
      s.ready = false;
      this.held[seat] = now + this.timing.graceMs;
      this.countdownUntil = null;
      return "held";
    }
    const ended = this.inMatch && !this.practice;
    this.seats[seat] = null;
    if (ended) {
      // nobody waits for a seat whose match is over: free any held one too
      for (const t of [0, 1] as const) if (this.held[t] !== null) this.seats[t] = null;
      this.endMatch();
    }
    // the host went: the other seated person picks the format from now on
    if (this.host !== null && !this.seats[this.host]) {
      const o = other(this.host);
      this.host = this.seats[o] && !this.seats[o]!.bot ? o : null;
    }
    this.recount(now);
    return ended ? "ended" : "freed";
  }

  /** The match was won (or abandoned): back to the ready check, nobody ready. */
  endMatch(): void {
    this.inMatch = false;
    this.held = [null, null];
    this.countdownUntil = null;
    for (const s of this.seats) if (s && !s.bot) s.ready = this.practice;
  }

  /** Advances the clock: a countdown that has run out starts or resumes play; an expired hold closes the room. */
  tick(now: number): Tick {
    if (this.held.some((until) => until !== null && now >= until)) return "close";
    if (this.countdownUntil !== null && now >= this.countdownUntil) {
      this.countdownUntil = null;
      if (this.inMatch) return "resume";
      this.inMatch = true;
      return "start";
    }
    return null;
  }

  /**
   * A seat's name as shown. One token on two tabs (allowed, for testing) would
   * show the same name twice, so the second seat gets " (2)".
   */
  name(seat: Seat): string | null {
    const s = this.seats[seat];
    if (!s) return null;
    return seat === 1 && !s.bot && this.seats[0]?.name === s.name ? `${s.name} (2)` : s.name;
  }

  view(now: number): Omit<LobbyView, "tally" | "ratings"> {
    const seat = (n: Seat) => {
      const s = this.seats[n];
      return s ? { name: this.name(n)!, ready: s.ready, connected: s.connected, bot: s.bot, look: s.look ?? DEFAULT_LOOKS[n] } : null;
    };
    const secs = (until: number) => Math.max(0, Math.ceil((until - now) / 1000));
    const heldSeat = this.held[0] !== null ? 0 : this.held[1] !== null ? 1 : null;
    return {
      phase: this.phase(),
      match: this.inMatch,
      format: this.format,
      host: this.host,
      seats: [seat(0), seat(1)],
      countdown: this.countdownUntil === null ? null : secs(this.countdownUntil),
      hold: heldSeat === null ? null : { seat: heldSeat, name: this.name(heldSeat)!, seconds: secs(this.held[heldSeat]!) },
      rated: this.rated,
      ratedBlocked: this.ratedBlocked(),
    };
  }

  // before the match: both seated and ready starts the countdown; anything
  // else cancels it
  private recount(now: number): void {
    if (this.inMatch || this.practice) return;
    const both = this.seats[0]?.ready === true && this.seats[1]?.ready === true;
    if (!both) this.countdownUntil = null;
    else this.countdownUntil ??= now + this.timing.countdownMs;
  }
}
