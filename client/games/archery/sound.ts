import type { ArcherySnapshot } from "../../../shared/games/archery/sim.ts";
import { crowdVoices } from "../../audio/crowd.ts";
import type { CrowdContext, CrowdEvent } from "../../audio/crowd.ts";
import { crowdCue } from "../../audio/sounds.ts";
import type { AnyCue } from "../../audio/sounds.ts";
import { FLAG_FULL_WIND } from "./cues.ts";

// Archery's sounds (task 19), a pure function of two snapshots: the string
// creaking as the shooter's draw grows (theirs too, from the aim they send),
// the release twang, the arrow's thunk in the boss (louder for a 10), the
// wind by its strength, and a few onlookers' quiet applause for a 10 or the
// bullseye, a soft "aww" for a miss.

/** The onlookers' moment for a new arrow, or null. */
export function archeryCrowd(shot: { points: number; bullseye: boolean; seat: 0 | 1 }): CrowdEvent | null {
  if (shot.bullseye) return { cheer: shot.seat, size: 2 };
  if (shot.points >= 10) return { cheer: shot.seat, size: 1 };
  if (shot.points >= 8) return { cheer: shot.seat, size: 0 };
  if (shot.points === 0) return { aww: shot.seat, size: 0 };
  return null;
}

/** The wind's hum level 0..1 (0: none). */
export const windLevel = (speed: number): number => Math.max(0, Math.min(1, speed / FLAG_FULL_WIND));

/** Each step of the draw (a quarter) creaks once. */
export const DRAW_STEPS = 4;

export function archeryCues(prev: ArcherySnapshot | null, next: ArcherySnapshot, ctx: CrowdContext): AnyCue[] {
  const out: AnyCue[] = [];
  const w = windLevel(next.wind.speed);
  if (!prev || prev.wind.speed !== next.wind.speed) out.push({ loop: "wind", v: w });
  if (!prev) return out;
  if (next.phase === "aim" && prev.phase === "aim" && prev.turn === next.turn) {
    const a = Math.floor(prev.aim.draw * DRAW_STEPS);
    const b = Math.floor(next.aim.draw * DRAW_STEPS);
    if (b > a) out.push({ s: "creak", v: next.aim.draw });
  }
  if (prev.phase === "aim" && next.phase === "flight") out.push({ s: "twang", v: next.aim.draw });
  if (next.shots.length > prev.shots.length) {
    const shot = next.shots[next.shots.length - 1];
    out.push(shot.hit ? { s: "thunk", v: shot.points } : { s: "arrow-miss" });
    const e = archeryCrowd(shot);
    if (e) for (const v of crowdVoices(e, ctx)) out.push(crowdCue(v));
  }
  return out;
}
