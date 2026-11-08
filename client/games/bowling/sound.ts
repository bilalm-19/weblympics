import type { BallResult, BowlingSnapshot } from "../../../shared/games/bowling/sim.ts";
import { crowdVoices } from "../../audio/crowd.ts";
import type { CrowdContext, CrowdEvent } from "../../audio/crowd.ts";
import { crowdCue } from "../../audio/sounds.ts";
import type { AnyCue } from "../../audio/sounds.ts";
import { reactionFor } from "./calls.ts";

// Bowling's sounds (task 29, moved onto the shared audio module by task 19),
// a pure function of two snapshots: the roll while the ball is on the lane
// (hollow and lower in the gutter), the pin crash (bigger the more pins go),
// the gutter's thud, and a few onlookers: quiet applause for a strike or
// spare (more for a strike), a soft "aww" at a gutter.

/** A new ball's result: the result phase with a different ball from last time. */
export function newResult(prev: BowlingSnapshot, next: BowlingSnapshot): BallResult | null {
  const r = next.last;
  if (!r || next.phase !== "result") return null;
  const p = prev.last;
  if (p && p.seat === r.seat && p.frame === r.frame && p.ball === r.ball && prev.matches === next.matches) return null;
  return r;
}

/** The onlookers' moment for a ball, or null. */
export function bowlingCrowd(r: BallResult): CrowdEvent | null {
  const react = reactionFor(r);
  if (react === "cheer") return { cheer: r.seat, size: r.strike ? 1 : 0 };
  if (react === "groan") return { aww: r.seat, size: 0 };
  return null;
}

export function bowlingCues(prev: BowlingSnapshot | null, next: BowlingSnapshot, ctx: CrowdContext): AnyCue[] {
  if (!prev) return [];
  const out: AnyCue[] = [];
  if (prev.phase === "aim" && next.phase === "roll") out.push({ loop: "roll", v: 1, tone: 0 });
  if (next.phase === "roll" && next.bowl?.gutter && !prev.bowl?.gutter) out.push({ loop: "roll", v: 1, tone: 1 });
  if (prev.phase === "roll" && next.phase !== "roll") out.push({ loop: "roll", v: 0 });
  const r = newResult(prev, next);
  if (r) {
    if (r.pins > 0) out.push({ s: "crash", v: r.strike ? 10 : r.pins });
    else if (r.gutter && !r.timeout) out.push({ s: "gutter" });
    const e = bowlingCrowd(r);
    if (e) for (const v of crowdVoices(e, ctx)) out.push(crowdCue(v));
  }
  return out;
}
