import type { BoxingSnapshot } from "../../../shared/games/boxing/sim.ts";
import { crowdVoices, otherSeat } from "../../audio/crowd.ts";
import type { CrowdContext, CrowdEvent } from "../../audio/crowd.ts";
import { crowdCue } from "../../audio/sounds.ts";
import type { Cue } from "../../audio/sounds.ts";

// Boxing's sounds (task 19), a pure function of two snapshots: a glove
// landing (a dull thud when blocked, a whoosh when slipped), the round bell,
// ding-ding at a KO, and the crowd round the ring: the thrower's fans cheer a
// clean jab (the other side awws a big one), both sides applaud the bell, and
// the winner's side roars at the end, bigger for a knockout.

/** The crowd's moment for a change, or null. Exported for the table test. */
export function boxingCrowd(prev: BoxingSnapshot, next: BoxingSnapshot): CrowdEvent | null {
  if (prev.phase !== "over" && next.phase === "over") {
    if (next.winner === null) return { size: 2 };
    return { cheer: next.winner, aww: otherSeat(next.winner), size: next.result === "ko" ? 3 : 2 };
  }
  if (prev.phase === "round" && next.phase === "break") return { size: 1 };
  const h = next.lastHit;
  if (h && h.tick !== prev.lastHit?.tick && h.outcome === "clean") return { cheer: h.seat, size: 0 };
  return null;
}

export function boxingCues(prev: BoxingSnapshot | null, next: BoxingSnapshot, ctx: CrowdContext): Cue[] {
  if (!prev) return [];
  const out: Cue[] = [];
  const h = next.lastHit;
  if (h && h.tick !== prev.lastHit?.tick) {
    // a jab on me sounds near; on them, a little further
    const gain = ctx.viewer === null || h.seat !== ctx.viewer ? 1 : 0.8;
    if (h.outcome === "clean") out.push({ s: "glove", v: h.target === "head" ? 1 : 0, gain });
    else if (h.outcome === "blocked") out.push({ s: "glove-blocked", gain });
    else out.push({ s: "slip", gain });
  }
  // the bell: a round starts or ends; ding-ding at a knockout
  if (prev.phase !== "over" && next.phase === "over") out.push({ s: next.result === "ko" ? "ko-bell" : "bell" });
  else if (prev.phase !== next.phase && (next.phase === "break" || next.phase === "round")) out.push({ s: "bell" });
  else if (prev.phase === "over" && next.phase === "round") out.push({ s: "bell" });
  const e = boxingCrowd(prev, next);
  if (e) for (const v of crowdVoices(e, ctx)) out.push(crowdCue(v));
  return out;
}
