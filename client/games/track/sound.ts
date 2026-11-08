import { MAX_SPEED } from "../../../shared/games/track/sim.ts";
import type { Seat, TrackSnapshot } from "../../../shared/games/track/sim.ts";
import { crowdVoices, otherSeat } from "../../audio/crowd.ts";
import type { CrowdContext, CrowdEvent } from "../../audio/crowd.ts";
import { crowdCue } from "../../audio/sounds.ts";
import type { AnyCue } from "../../audio/sounds.ts";

// Track's sounds (task 19), a pure function of two snapshots: the starter's
// "set" and the gun, footsteps as the server counts them (my own nearer,
// quicker as I speed up), a hurdle knocked down, the crowd's murmur rising
// to the line, and the finish roar: the winner's side cheers, the other
// side's "aww".

/** The crowd's moment for a change, or null. */
export function trackCrowd(prev: TrackSnapshot, next: TrackSnapshot, solo: boolean): CrowdEvent | null {
  if (prev.phase !== "over" && next.phase === "over" && next.winner !== null) {
    if (solo) return { cheer: next.winner, size: 2 };
    return { cheer: next.winner, aww: otherSeat(next.winner), size: 3 };
  }
  return null;
}

export function trackCues(prev: TrackSnapshot | null, next: TrackSnapshot, ctx: CrowdContext & { murmur: number }): AnyCue[] {
  const out: AnyCue[] = [];
  if (!ctx.training) out.push({ loop: "murmur", v: ctx.murmur * (ctx.practice ? 0.5 : 1) });
  if (!prev) return out;
  if (next.phase === "set" && prev.phase !== "set") out.push({ s: "set" });
  if (prev.phase === "set" && next.phase === "running") out.push({ s: "gun" });
  for (const seat of [0, 1] as Seat[]) {
    const a = prev.lanes[seat];
    const b = next.lanes[seat];
    const mine = seat === ctx.viewer;
    // a spectator hears both runners; a player hears their own clearly and the other faintly
    const gain = ctx.viewer === null ? 0.7 : mine ? 1 : 0.35;
    if (next.phase === "running" && b.steps > a.steps) out.push({ s: "step", v: Math.min(1, b.speed / MAX_SPEED), gain, pan: seat === 0 ? -0.15 : 0.15 });
    if (b.hit > a.hit) out.push({ s: "hurdle-hit", gain });
  }
  const e = trackCrowd(prev, next, next.solo);
  if (e) for (const v of crowdVoices(e, ctx)) out.push(crowdCue(v));
  return out;
}
