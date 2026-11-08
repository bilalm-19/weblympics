import { JAB_WINDUP_MS, RECOVER_MS } from "../../../shared/games/boxing/sim.ts";
import type { Hand } from "../../../shared/games/boxing/sim.ts";

// Which hand a jab is sent with (task 30, playtest 5: "the delay between
// punches feels long"). The server refuses a hand that is still out or
// recovering ("hand-busy": JAB_WINDUP_MS + RECOVER_MS after its throw) and
// the press is simply lost. The view alternates hands for the keys, and the
// camera names the hand, so a jab asked for with a busy hand was lost even
// when the other hand was free. Which hand throws is only which glove is
// drawn (the server judges the same either way), so: use the asked-for hand
// unless it is busy and the other is not. Pure, so it is tested against the
// real sim (spec/boxing-hand-pick.test.ts).

/** Ms since this player last sent a jab with each hand, or null if never. */
export type SinceSent = Record<Hand, number | null>;

/** A little over the sim's 300 ms, for the tick the server happens to see it on. */
export const BUSY_MS = JAB_WINDUP_MS + RECOVER_MS + 20;

const busy = (since: number | null): boolean => since !== null && since < BUSY_MS;

/** The hand to throw with: `asked` unless it is busy and the other hand is free. */
export function chooseHand(asked: Hand, since: SinceSent): Hand {
  const other: Hand = asked === "left" ? "right" : "left";
  return busy(since[asked]) && !busy(since[other]) ? other : asked;
}
