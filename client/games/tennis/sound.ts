import { COURT } from "../../../shared/games/tennis/sim.ts";
import type { Seat, TennisSnapshot } from "../../../shared/games/tennis/sim.ts";
import { crowdVoices, pointEvent } from "../../audio/crowd.ts";
import type { CrowdContext } from "../../audio/crowd.ts";
import { crowdCue } from "../../audio/sounds.ts";
import type { Cue } from "../../audio/sounds.ts";
import { pointCall } from "./point-call.ts";

// Tennis's sounds (task 19), a pure function of two snapshots: the other
// player's (or the bot's) hit by its pace, every bounce, the net cord, the
// line judge's "out", the umpire's fault whistle with a soft gasp, and the
// crowd after each point (point-call.ts decides who won it and how big it
// was). The player's own racket whoosh and hit play as they swing
// (`swingCues`), so the hit feels instant whatever the lag.

export interface TennisSoundContext extends CrowdContext {}

/** Where on this screen an x across the court sounds: the arena turns round for seat 2. */
export function courtPan(x: number, viewer: Seat | null): number {
  const screenX = viewer === 1 ? -x : x;
  return Math.max(-0.8, Math.min(0.8, screenX / (COURT.halfW + 2)));
}

/** A hit's strength 0..2 from the ball's pace off the racket (light 11 m/s, hard 18). */
export function paceLevel(vx: number, vz: number): number {
  return Math.max(0, Math.min(2, (Math.hypot(vx, vz) - 11) / 3.5));
}

/** The sounds of the change from `prev` to `next` on this screen. */
export function tennisCues(prev: TennisSnapshot | null, next: TennisSnapshot, ctx: TennisSoundContext): Cue[] {
  if (!prev) return [];
  const out: Cue[] = [];
  // someone else hit it (a player hears their own as they swing)
  const hitter = next.lastHitter;
  if (hitter !== null && (hitter !== prev.lastHitter || next.shots > prev.shots) && hitter !== ctx.viewer) {
    out.push({ s: "hit", v: paceLevel(next.ball.vx, next.ball.vz), pan: courtPan(next.players[hitter].x, ctx.viewer), gain: ctx.viewer === null ? 1 : 0.85 });
  }
  const lb = next.lastBounce;
  if (lb && lb.tick !== prev.lastBounce?.tick) {
    out.push({ s: "bounce", pan: courtPan(lb.x, ctx.viewer) });
    if (!lb.in) out.push({ s: "out" });
  }
  const lc = next.lastCall;
  if (lc && lc.tick !== prev.lastCall?.tick) {
    if (lc.reason === "net") out.push({ s: "net" });
    if (lc.call === "fault" || lc.reason === "double fault") {
      out.push({ s: "fault" });
      if (!ctx.training) out.push({ s: "gasp", gain: ctx.practice ? 0.5 : 1 });
    }
    const c = pointCall(prev, next, (s) => String(s));
    if (c && c.winner !== null) for (const v of crowdVoices(pointEvent(c.winner, c.weight), ctx)) out.push(crowdCue(v));
  }
  return out;
}

/** Your own swing, as it is sent: the whoosh, and the hit if the screen expects one (the server still decides). */
export function swingCues(level: number, expectHit: boolean): Cue[] {
  return expectHit ? [{ s: "swing", v: level }, { s: "hit", v: level }] : [{ s: "swing", v: level }];
}
