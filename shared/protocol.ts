import type { Hand, Level, MoveMode, SwingKind } from "./games/tennis/sim.ts";
import type { Look } from "./look.ts";

// A room's match format (task 4): the host picks it in the ready panel before
// play, from the ones its game offers (`GameDef.formats`). "unlimited" has no
// winner, counts points and the best rally (archery: the best arrow), is
// never rated, and ends when someone leaves. "stages" is archery's match,
// "race" is track's (task 26): one race, first across the line. "bout" is
// boxing's (task 30): three rounds, a knockout or a decision on damage.
export type RoomFormat = "oneSet" | "bestOfThree" | "stages" | "race" | "bout" | "unlimited";
export const ROOM_FORMATS: readonly RoomFormat[] = ["oneSet", "bestOfThree", "stages", "race", "bout", "unlimited"];

// waiting (a seat is empty) -> ready-check -> countdown (3 s) -> playing;
// paused while a dropped player's seat is held (30 s)
export type Phase = "waiting" | "ready-check" | "countdown" | "playing" | "paused";

export interface LobbySeat {
  name: string;
  ready: boolean;
  connected: boolean;
  bot: boolean;
  /** How the seat's character looks (task 18): the account's saved look, else the seat's default. */
  look: Look;
}

/** The room's state, owned by the server. */
export interface LobbyView {
  phase: Phase;
  /** A match is under way (it may be paused, or counting down to resume). */
  match: boolean;
  format: RoomFormat;
  /** Seat of the player who picks the format, else null. */
  host: 0 | 1 | null;
  seats: [LobbySeat | null, LobbySeat | null];
  /** Whole seconds left in the countdown, else null. */
  countdown: number | null;
  /** A dropped player's seat being held: whose, and whole seconds left. */
  hold: { seat: 0 | 1; name: string; seconds: number } | null;
  /** Unlimited only: points won by each seat this match, and the longest rally in shots (archery: the best arrow's points). */
  tally: { points: [number, number]; bestRally: number } | null;
  /** Task 7: the host's "rated" option. Whether it counts is `ratedBlocked === null`. */
  rated: boolean;
  /** Why a rated match isn't possible here right now (a guest seat, unlimited...), else null. */
  ratedBlocked: string | null;
  /** Each seat's rating in this room's sport (accounts only; null for a guest, the bot or an empty seat). */
  ratings: [number | null, number | null];
}

export type ClientMsg =
  // who you are comes from the page's cookies when the socket opens (a guest
  // id or an account's session, task 17); the client never says who it is
  | { t: "hello" }
  // format: the room's starting format ("oneSet" default, "bestOfThree",
  // "unlimited"); an unknown one gets the default. The host can change it in
  // the ready panel before play.
  | { t: "create"; game: string; practice: boolean; format?: string }
  // watch (task 24): the watch link; always spectates, even with a free seat.
  // Without it a free seat is taken, else the arrival spectates
  | { t: "join"; room: string; watch?: boolean }
  // ready-up: the sender's own seat only, before the match
  | { t: "ready"; ready: boolean }
  // the host's match format, before the match; a value not in ROOM_FORMATS is
  // a bad message
  | { t: "format"; format: RoomFormat }
  // task 7: the host's "rated" option, before the match; the server decides
  // whether the match actually counts
  | { t: "rated"; rated: boolean }
  // lift: hand height at contact in camera follow mode, -1..1 (server clamps)
  // timingAim: aim from how early or late the ball is met instead of dirX
  // tick: the server tick the player's screen showed when they swung; the
  // server judges the swing there if it can (ADR 001), within its own limits
  | { t: "swing"; dirX: number; kind: SwingKind; level: Level; hand?: Hand; lift?: number; timingAim?: boolean; tick?: number }
  | { t: "move"; x: number }
  // archery: the sight (yaw, pitch, radians) and draw (0..1) while drawing,
  // and the release that shoots; only the shooter's count, the sim clamps
  | { t: "aim"; yaw: number; pitch: number; draw: number }
  | { t: "release"; yaw: number; pitch: number; draw: number }
  // track (task 26): one footfall, which foot and the sender's own clock (ms).
  // Never a distance or a finish: the server counts steps into speed and caps
  // the cadence at a human maximum
  | { t: "step"; side: "left" | "right"; at: number }
  // boxing (task 30, ADR 002): a jab thrown (which hand, head or body, the
  // sender's own clock, ms), the guard (high, low or none) and a slip (which
  // way). Never damage, a hit or a health: the server lands the jab after its
  // wind-up and judges the guard and slip then. A message with any extra
  // field is dropped whole
  | { t: "punch"; hand: "left" | "right"; target: "head" | "body"; at: number }
  | { t: "guard"; guard: "high" | "low" | null }
  | { t: "slip"; side: "left" | "right" | null }
  // movement mode for the sender's own seat: "auto" (the server walks you to
  // the ball, the default) or "tilt" (only your own moves); anything else is
  // a bad message
  | { t: "mode"; mode: MoveMode }
  // practice only: hold the game while the player sets up the camera
  | { t: "pause"; paused: boolean }
  // reply to the server's ping, echoing its id, so it can time the round trip
  | { t: "pong"; id: number }
  | { t: "leave" };

/** Task 24 (user, 2026-11-05): at most this many watchers per room, for the shared CPU and 256 MB machine. */
export const MAX_WATCHERS = 10;
/** The error an arrival gets when a room already has MAX_WATCHERS watchers and no free seat for them. */
export const WATCHERS_FULL = "This match is full of watchers.";

export interface RoomInfo {
  room: string;
  game: string;
  seat: 0 | 1 | null;
  practice: boolean;
}

export type ServerMsg =
  // account: signed in with a passkey (or a demo account); demo: one of the
  // two locked demo accounts; look: the account's saved look (task 18), null
  // for a guest or the default, drawn as the home screen's profile picture
  | { t: "welcome"; name: string; account: boolean; demo: boolean; matches: number; look: Look | null }
  | ({ t: "room" } & RoomInfo)
  // spectators: how many are watching (task 24: at most MAX_WATCHERS)
  | { t: "presence"; names: [string | null, string | null]; spectators: number }
  | ({ t: "lobby" } & LobbyView)
  // the room is gone: a dropped player didn't come back in time
  | { t: "closed"; room: string; reason: string }
  | { t: "state"; state: unknown }
  | { t: "ping"; id: number }
  // the server's ruling on your swing: hit, or why it missed
  // allowed: ticks back the server would judge it; rewind: ticks back it did
  | { t: "swing"; tick: number; outcome: string; rtt: number | null; allowed: number; rewind: number }
  | { t: "error"; message: string };

/** Boxing's messages carry no extra claim: one with any other field is dropped whole (task 30's contract). */
const onlyKeys = (m: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(m).every((k) => keys.includes(k));

export function parseClientMsg(raw: string): ClientMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case "hello":
      return { t: "hello" };
    case "create":
      if (typeof m.game !== "string") return null;
      return { t: "create", game: m.game, practice: m.practice === true, format: typeof m.format === "string" ? m.format : undefined };
    case "join":
      if (typeof m.room !== "string") return null;
      if (m.watch !== undefined && typeof m.watch !== "boolean") return null;
      return m.watch ? { t: "join", room: m.room, watch: true } : { t: "join", room: m.room };
    case "ready":
      return typeof m.ready === "boolean" ? { t: "ready", ready: m.ready } : null;
    case "format":
      return (ROOM_FORMATS as readonly unknown[]).includes(m.format) ? { t: "format", format: m.format as RoomFormat } : null;
    case "rated":
      return typeof m.rated === "boolean" ? { t: "rated", rated: m.rated } : null;
    case "swing": {
      const { dirX, kind, level, hand, lift, timingAim, tick } = m;
      if (typeof dirX !== "number" || !Number.isFinite(dirX)) return null;
      if (level !== 0 && level !== 1 && level !== 2) return null;
      if (kind !== "forehand" && kind !== "backhand") return null;
      if (hand !== undefined && hand !== "right" && hand !== "left") return null;
      if (lift !== undefined && (typeof lift !== "number" || !Number.isFinite(lift))) return null;
      if (timingAim !== undefined && typeof timingAim !== "boolean") return null;
      if (tick !== undefined && !Number.isSafeInteger(tick)) return null;
      return { t: "swing", dirX, kind, level, hand, lift, timingAim, tick: tick as number | undefined };
    }
    case "move":
      return typeof m.x === "number" && Number.isFinite(m.x) ? { t: "move", x: m.x } : null;
    case "aim":
    case "release": {
      const { yaw, pitch, draw } = m;
      if (![yaw, pitch, draw].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      return { t: m.t, yaw: yaw as number, pitch: pitch as number, draw: draw as number };
    }
    case "step":
      if (m.side !== "left" && m.side !== "right") return null;
      return typeof m.at === "number" && Number.isFinite(m.at) ? { t: "step", side: m.side, at: m.at } : null;
    case "punch":
      if (!onlyKeys(m, ["t", "hand", "target", "at"])) return null;
      if (m.hand !== "left" && m.hand !== "right") return null;
      if (m.target !== "head" && m.target !== "body") return null;
      return typeof m.at === "number" && Number.isFinite(m.at) ? { t: "punch", hand: m.hand, target: m.target, at: m.at } : null;
    case "guard":
      if (!onlyKeys(m, ["t", "guard"])) return null;
      return m.guard === "high" || m.guard === "low" || m.guard === null ? { t: "guard", guard: m.guard } : null;
    case "slip":
      if (!onlyKeys(m, ["t", "side"])) return null;
      return m.side === "left" || m.side === "right" || m.side === null ? { t: "slip", side: m.side } : null;
    case "mode":
      return m.mode === "auto" || m.mode === "tilt" ? { t: "mode", mode: m.mode } : null;
    case "pause":
      return typeof m.paused === "boolean" ? { t: "pause", paused: m.paused } : null;
    case "pong":
      return Number.isInteger(m.id) ? { t: "pong", id: m.id as number } : null;
    case "leave":
      return { t: "leave" };
    default:
      return null;
  }
}
