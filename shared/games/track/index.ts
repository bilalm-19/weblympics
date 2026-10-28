import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, snapshot, step } from "./sim.ts";
import type { Format, Seat, StepInput, TrackState } from "./sim.ts";

/** Validates one seat's input. The seat comes from the connection, never the payload. */
export function asInput(seat: Seat, input: unknown): StepInput | null {
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  if (m.t !== "step" || (m.side !== "left" && m.side !== "right")) return null;
  if (typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
  return { t: "step", seat, side: m.side, at: m.at };
}

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
  create(seed, options) {
    const format = asFormat(options?.format);
    return makeInstance(createState(seed, { format, endless: options?.endless === true || format === "unlimited" }));
  },
};

function makeInstance(s: TrackState): GameInstance {
  return {
    step(inputs) {
      const parsed: StepInput[] = [];
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
    finished: () => (s.phase === "over" && s.winner !== null && s.format !== "unlimited" ? { winner: s.winner, score: [s.wins[0], s.wins[1]], format: s.format } : null),
    botInputs: (seat) => botInputs(s, seat),
  };
}
