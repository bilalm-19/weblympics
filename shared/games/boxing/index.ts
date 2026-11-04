import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, snapshot, step } from "./sim.ts";
import type { BoxingInput, BoxingState, Format, Seat } from "./sim.ts";

/**
 * Validates one seat's input. The seat comes from the connection, never the
 * payload, and anything else in it (damage, health, a hit) is dropped.
 */
export function asInput(seat: Seat, input: unknown): BoxingInput | null {
  if (typeof input !== "object" || input === null) return null;
  const m = input as Record<string, unknown>;
  if (m.t === "guard") return typeof m.up === "boolean" ? { t: "guard", seat, up: m.up } : null;
  if (m.t !== "punch") return null;
  if (m.kind !== "jab" && m.kind !== "hook") return null;
  if (m.hand !== "left" && m.hand !== "right") return null;
  if (typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
  return { t: "punch", seat, kind: m.kind, hand: m.hand, at: m.at };
}

/** "unlimited" boxes bout after bout; anything else is a single bout. */
export const asFormat = (format: unknown): Format => (format === "unlimited" ? "unlimited" : "bout");

/** A boxing game starting from `start`; for tests. */
export function boxingFrom(start: BoxingState): GameInstance {
  return makeInstance(cloneState(start));
}

export const boxing: GameDef = {
  id: "boxing",
  name: "Boxing",
  formats: ["bout", "unlimited"],
  create(seed, options) {
    const format = asFormat(options?.format);
    return makeInstance(createState(seed, { format, endless: options?.endless === true || format === "unlimited" }));
  },
};

function makeInstance(s: BoxingState): GameInstance {
  return {
    step(inputs) {
      const parsed: BoxingInput[] = [];
      for (const { seat, input } of inputs) {
        const p = asInput(seat, input);
        if (p) parsed.push(p);
      }
      return step(s, parsed);
    },
    snapshot: () => snapshot(s),
    // the headline score is damage dealt; a draw has no winner. Unlimited
    // has no result (the room keeps its tally); practice's first bout is
    // recorded, never rated
    finished: () =>
      s.phase === "over" && s.result !== null && s.format !== "unlimited"
        ? { winner: s.winner, score: [s.boxers[0].dealt, s.boxers[1].dealt], format: s.format }
        : null,
    botInputs: (seat) => botInputs(s, seat),
  };
}
