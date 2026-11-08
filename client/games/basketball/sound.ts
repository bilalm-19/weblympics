import type { BasketballSnapshot } from "../../../shared/games/basketball/sim.ts";
import { crowdVoices, otherSeat } from "../../audio/crowd.ts";
import type { CrowdContext, CrowdEvent } from "../../audio/crowd.ts";
import { crowdCue } from "../../audio/sounds.ts";
import type { Cue } from "../../audio/sounds.ts";
import { shotCall } from "./calls.ts";

// Basketball's sounds (task 32, moved onto the shared audio module by task
// 19), a pure function of two snapshots: the rim's clank and the board's
// thud as the ball touches them, the swish of a make, and the crowd placed by
// side: the shooter's side cheers a make (bigger for a swish or the money
// ball) and goes "aww" at a miss; the winner's side roars at the end.

/** The crowd's moment for a change, or null. */
export function basketballCrowd(prev: BasketballSnapshot, next: BasketballSnapshot): CrowdEvent | null {
  if (prev.phase !== "over" && next.phase === "over") {
    if (next.winner === null) return { size: 2 };
    return { cheer: next.winner, aww: otherSeat(next.winner), size: 3 };
  }
  if ((prev.phase === "aim" || prev.phase === "flight") && next.phase === "result" && next.last) {
    const c = shotCall(next.last);
    const shooter = next.last.seat;
    if (!next.last.made) return { aww: shooter, size: 0 };
    return { cheer: shooter, size: c.crowd === "big" ? 1 : 0 };
  }
  return null;
}

export function basketballCues(prev: BasketballSnapshot | null, next: BasketballSnapshot, ctx: CrowdContext): Cue[] {
  if (!prev) return [];
  const out: Cue[] = [];
  if (next.phase === "flight") {
    if (next.contact.rim && !prev.contact.rim) out.push({ s: "clank" });
    if (next.contact.board && !prev.contact.board) out.push({ s: "board" });
  }
  if ((prev.phase === "aim" || prev.phase === "flight") && next.phase === "result" && next.last?.made) out.push({ s: "swish", gain: next.last.swish ? 1.2 : 0.7 });
  const e = basketballCrowd(prev, next);
  if (e) for (const v of crowdVoices(e, ctx)) out.push(crowdCue(v));
  return out;
}
