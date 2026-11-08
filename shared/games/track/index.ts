import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, snapshot, step } from "./sim.ts";
import type { Format, Seat, TrackEvent, TrackInput, TrackState } from "./sim.ts";

/**
 * Validates one seat's input. The seat comes from the connection, never the
 * payload. A jump (task 27) is exactly { t, at }: anything else, or any extra
 * field, is dropped whole.
 */
export function asInput(seat: Seat, input: unknown): TrackInput | null {
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  if (m.t === "jump") {
    if (!Object.keys(m).every((k) => k === "t" || k === "at")) return null;
    return typeof m.at === "number" && Number.isFinite(m.at) ? { t: "jump", seat, at: m.at } : null;
  }
  if (m.t !== "step" || (m.side !== "left" && m.side !== "right")) return null;
  if (typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
  return { t: "step", seat, side: m.side, at: m.at };
}

/** "hurdles" (task 27), else the sprint (the default). */
export const asEvent = (event: unknown): TrackEvent => (event === "hurdles" ? "hurdles" : "sprint");

/** "unlimited" runs race after race; anything else is a single race. */
export const asFormat = (format: unknown): Format => (format === "unlimited" ? "unlimited" : "race");

/** A track game starting from `start`; for tests. */
export function trackFrom(start: TrackState): GameInstance {
  return makeInstance(cloneState(start));
}

export const track: GameDef = {
  id: "track",
  name: "Track",
  formats: ["race", "unlimited"],
  // task 27: the host picks the event like the format; the sprint (first) is the default
  events: ["sprint", "hurdles"],
  create(seed, options) {
    const format = asFormat(options?.format);
    return makeInstance(createState(seed, { format, endless: options?.endless === true || format === "unlimited", event: asEvent(options?.event) }));
  },
};

/**
 * What a track match row keeps beyond the score (task 27, for the stats
 * task): the event, so stats can tell sprint from hurdles; each seat's
 * finish time (a race: the race's, null for a DNF; unlimited: the best of the
 * game); and in hurdles each seat's hurdles cleared and knocked down (a race:
 * that race; unlimited: the last race run).
 */
export function raceDetail(s: TrackState): Record<string, unknown> {
  const times = s.format === "unlimited" ? [...s.best] : [s.lanes[0].finish, s.lanes[1].finish];
  const out: Record<string, unknown> = { event: s.event, times };
  if (s.event === "hurdles") {
    out.cleared = [s.lanes[0].cleared, s.lanes[1].cleared];
    out.hit = [s.lanes[0].hit, s.lanes[1].hit];
  }
  return out;
}

function makeInstance(s: TrackState): GameInstance {
  return {
    step(inputs) {
      const parsed: TrackInput[] = [];
      for (const { seat, input } of inputs) {
        const p = asInput(seat, input);
        if (p) parsed.push(p);
      }
      return step(s, parsed);
    },
    snapshot: () => snapshot(s),
    // the headline score is races won; the times are in the snapshot.
    // Unlimited has no winner (the room keeps its tally); practice's first
    // race is recorded, never rated
    finished: () =>
      s.phase === "over" && s.winner !== null && s.format !== "unlimited"
        ? { winner: s.winner, score: [s.wins[0], s.wins[1]], format: s.format, detail: raceDetail(s) }
        : null,
    // unlimited's row (stored when someone leaves) says which event too
    detail: () => raceDetail(s),
    // the bot's inputs go through asInput like a person's, so they are the
    // same messages a client sends: no seat (a jump with one is dropped whole)
    botInputs: (seat) => botInputs(s, seat).map(({ seat: _seat, ...msg }) => msg),
  };
}
