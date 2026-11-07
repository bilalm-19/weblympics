import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, setLag, snapshot, step } from "./sim.ts";
import type { BasketballInput, BasketballState, Format, Seat } from "./sim.ts";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Every key of `m` is one of `keys` (and all of `keys` are present). */
const exactly = (m: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(m);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(m, k));
};

/**
 * Validates one seat's input (ADR 003's closed set): exactly `{t:"set"}`,
 * `{t:"aim",aim}`, `{t:"shoot",power,aim,at}` with finite numbers, or the
 * tie vote `{t:"tie",choice:"draw"|"continue"}` (user, 2026-11-08). Anything
 * else, or any extra field, is dropped whole. The seat comes from the
 * connection, never the payload; the sim clamps power and aim, and ignores a
 * seat whose turn it isn't and a second shot in a turn.
 */
export function asInput(seat: Seat, input: unknown): BasketballInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const m = input as Record<string, unknown>;
  switch (m.t) {
    case "set":
      return exactly(m, ["t"]) ? { t: "set", seat } : null;
    case "aim":
      return exactly(m, ["t", "aim"]) && num(m.aim) ? { t: "aim", seat, aim: m.aim } : null;
    case "shoot":
      return exactly(m, ["t", "power", "aim", "at"]) && num(m.power) && num(m.aim) && num(m.at)
        ? { t: "shoot", seat, power: m.power, aim: m.aim, at: m.at }
        : null;
    case "tie":
      return exactly(m, ["t", "choice"]) && (m.choice === "draw" || m.choice === "continue") ? { t: "tie", seat, choice: m.choice } : null;
    default:
      return null;
  }
}

/** "unlimited" shoots from a random spot every turn; anything else is the five-spot shootout. */
export const asFormat = (format: unknown): Format => (format === "unlimited" ? "unlimited" : "shootout");

/** A basketball game starting from `start`; for tests. */
export function basketballFrom(start: BasketballState): BasketballInstance {
  return makeInstance(cloneState(start));
}

/**
 * The room may set each seat's late-shot grace (ticks, capped at 9 = 150 ms)
 * from its measured round trip; until it does, the grace is 0.
 */
export interface BasketballInstance extends GameInstance {
  setLag(seat: Seat, ticks: number): void;
}

export const basketball: GameDef = {
  id: "basketball",
  name: "Basketball",
  formats: ["shootout", "unlimited"],
  create(seed, options) {
    const format = asFormat(options?.format);
    return makeInstance(createState(seed, { format, endless: options?.endless === true || format === "unlimited" }));
  },
};

function makeInstance(s: BasketballState): BasketballInstance {
  return {
    step(inputs) {
      const parsed: BasketballInput[] = [];
      for (const { seat, input } of inputs) {
        const p = asInput(seat, input);
        if (p) parsed.push(p);
      }
      return step(s, parsed);
    },
    snapshot: () => snapshot(s),
    // a draw (voted, or the vote ran out) has no winner; unlimited never ends
    finished: () =>
      s.phase === "over" && s.format !== "unlimited" ? { winner: s.winner, score: [s.totals[0], s.totals[1]], format: s.format } : null,
    // the bot's messages go through `asInput` like a person's, so they leave
    // as the wire shape: the seat comes from where the room puts them
    botInputs: (seat) => botInputs(s, seat).map(({ seat: _seat, ...wire }) => wire),
    setLag: (seat, ticks) => setLag(s, seat, ticks),
  };
}
