import type { GameDef, GameInstance } from "../registry.ts";
import { botInputs } from "./bot.ts";
import { cloneState, createState, setLag, snapshot, step } from "./sim.ts";
import type { BowlingInput, BowlingState, Format, Seat } from "./sim.ts";

const KEYS: Record<BowlingInput["t"], readonly string[]> = {
  aim: ["t", "aim"],
  throw: ["t", "speed", "aim", "spin", "at"],
  tie: ["t", "choice"],
};

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validates one seat's input: exactly `aim` {aim}, `throw` {speed, aim,
 * spin, at} (finite numbers; the sim clamps them) or `tie` {choice: "draw" |
 * "continue"}. The seat comes from the connection, never the payload.
 * Anything else is dropped whole: an unknown type, a bad value or any extra
 * field (a pin count, a score, a seat). The sim ignores off-turn messages and
 * a second throw for one ball.
 */
export function asInput(seat: Seat, input: unknown): BowlingInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const m = input as Record<string, unknown>;
  if (m.t !== "aim" && m.t !== "throw" && m.t !== "tie") return null;
  const allowed = KEYS[m.t];
  if (Object.keys(m).some((k) => !allowed.includes(k))) return null;
  if (m.t === "aim") return num(m.aim) ? { t: "aim", seat, aim: m.aim } : null;
  if (m.t === "tie") return m.choice === "draw" || m.choice === "continue" ? { t: "tie", seat, choice: m.choice } : null;
  if (!num(m.speed) || !num(m.aim) || !num(m.spin) || !num(m.at)) return null;
  return { t: "throw", seat, speed: m.speed, aim: m.aim, spin: m.spin, at: m.at };
}

/** "unlimited" bowls game after game; anything else is one five-frame game. */
export const asFormat = (format: unknown): Format => (format === "unlimited" ? "unlimited" : "game");

/** A bowling game starting from `start`; for tests. */
export function bowlingFrom(start: BowlingState): GameInstance {
  return makeInstance(cloneState(start));
}

export const bowling: GameDef = {
  id: "bowling",
  name: "Bowling",
  formats: ["game", "unlimited"],
  create(seed, options) {
    const format = asFormat(options?.format);
    return makeInstance(createState(seed, { format, endless: options?.endless === true || format === "unlimited" }));
  },
};

function makeInstance(s: BowlingState): GameInstance {
  return {
    step(inputs) {
      const parsed: BowlingInput[] = [];
      for (const { seat, input } of inputs) {
        const p = asInput(seat, input);
        if (p) parsed.push(p);
      }
      return step(s, parsed);
    },
    snapshot: () => snapshot(s),
    // the headline score is each total; a draw (voted, or the vote ran out)
    // has no winner. Unlimited has no result (the room keeps its tally);
    // practice's first game is recorded, never rated
    finished: () =>
      s.phase === "over" && s.format !== "unlimited" ? { winner: s.winner, score: snapshot(s).cards.map((c) => c.total) as [number, number], format: s.format } : null,
    // on the wire shape, like a client's: the room adds the seat back and
    // asInput refuses an input that names its own seat
    botInputs: (seat) => botInputs(s, seat).map(({ seat: _seat, ...wire }) => wire),
    setLag: (seat, ticks) => setLag(s, seat, ticks),
  };
}
