import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, snapshot, step } from "./sim.ts";
import type { BoxingInput, BoxingState, Format, Seat } from "./sim.ts";

const KEYS: Record<BoxingInput["t"], readonly string[]> = {
  punch: ["t", "hand", "target", "at"],
  guard: ["t", "guard"],
  slip: ["t", "side"],
};

/**
 * Validates one seat's input: exactly one of the three contract shapes
 * (task 30's "Contract for the rework"), `punch` {hand, target, at},
 * `guard` {guard: "high"|"low"|null} or `slip` {side}. The seat comes from
 * the connection, never the payload. Anything else is dropped whole: an
 * unknown type, a bad value, or any extra field (a damage, a health, a hit,
 * a seat, the old `kind` or `up`).
 */
export function asInput(seat: Seat, input: unknown): BoxingInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const m = input as Record<string, unknown>;
  if (m.t !== "punch" && m.t !== "guard" && m.t !== "slip") return null;
  const allowed = KEYS[m.t];
  if (Object.keys(m).some((k) => !allowed.includes(k))) return null;
  if (m.t === "guard") return m.guard === "high" || m.guard === "low" || m.guard === null ? { t: "guard", seat, guard: m.guard } : null;
  if (m.t === "slip") return m.side === "left" || m.side === "right" || m.side === null ? { t: "slip", seat, side: m.side } : null;
  if (m.hand !== "left" && m.hand !== "right") return null;
  if (m.target !== "head" && m.target !== "body") return null;
  if (typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
  return { t: "punch", seat, hand: m.hand, target: m.target, at: m.at };
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
    // on the wire shape, like a client's: the room adds the seat back and
    // asInput refuses an input that names its own seat
    botInputs: (seat) => botInputs(s, seat).map(({ seat: _seat, ...wire }) => wire),
  };
}
