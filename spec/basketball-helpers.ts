// Shared helpers for spec/basketball-*.test.ts: find powers that do a given
// thing from a spot (the flight is deterministic, so a scan finds them), and
// drive the sim turn by turn.
import { RESULT_TICKS, simulateShot, step } from "../shared/games/basketball/sim.ts";
import type { BasketballEvent, BasketballState, Seat } from "../shared/games/basketball/sim.ts";

export type Basket = Extract<BasketballEvent, { type: "basket" }>;
type Kind = "swish" | "rimIn" | "rimOut" | "bank" | "miss";

const found = new Map<string, number>();

/** A power (to 0.001) that does `kind` from `spot` with `aim`; the one nearest the middle of the run it finds. */
export function powerFor(spot: number, kind: Kind, aim = 0): number {
  const key = `${spot}:${kind}:${aim}`;
  const hit = found.get(key);
  if (hit !== undefined) return hit;
  const ok: number[] = [];
  for (let i = 0; i <= 1000; i++) {
    const r = simulateShot(spot, i / 1000, aim);
    const is =
      kind === "swish"
        ? r.made && !r.rim && !r.board
        : kind === "rimIn"
          ? r.made && r.rim && !r.board
          : kind === "rimOut"
            ? !r.made && r.rim && !r.board
            : kind === "bank"
              ? r.made && r.board
              : !r.made;
    if (is) ok.push(i / 1000);
  }
  if (ok.length === 0) throw new Error(`no ${kind} from spot ${spot}`);
  const p = ok[Math.floor(ok.length / 2)];
  found.set(key, p);
  return p;
}

/** Steps until it is `seat`'s turn to shoot (or anyone's), returning the events on the way. */
export function toTurn(s: BasketballState, seat?: Seat): BasketballEvent[] {
  const ev: BasketballEvent[] = [];
  for (let i = 0; i < 5000 && !(s.phase === "aim" && (seat === undefined || s.turn === seat)); i++) ev.push(...step(s, []));
  return ev;
}

/** The shooter shoots and the ball flies until the shot is decided; returns the basket event. */
export function shoot(s: BasketballState, power: number, aim = 0): Basket {
  const seat = s.turn;
  let ev = step(s, [{ t: "shoot", seat, power, aim, at: 0 }]);
  for (let i = 0; i < 1000; i++) {
    const b = ev.find((e): e is Basket => e.type === "basket");
    if (b) return b;
    ev = step(s, []);
  }
  throw new Error("shot never decided");
}

/** Whoever's turn it is shoots `powerOf(state)`, until the match is over; returns every basket. */
export function playMatch(s: BasketballState, powerOf: (s: BasketballState) => number): Basket[] {
  const out: Basket[] = [];
  for (let i = 0; i < 60 && s.phase !== "over"; i++) {
    toTurn(s);
    if ((s.phase as string) === "over") break;
    out.push(shoot(s, powerOf(s)));
    for (let j = 0; j < RESULT_TICKS + 1 && s.phase === "result"; j++) step(s, []);
  }
  return out;
}
