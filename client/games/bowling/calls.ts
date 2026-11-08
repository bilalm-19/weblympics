import { LANE, ballSpeed, ballXAt, speedZone } from "../../../shared/games/bowling/sim.ts";
import type { BallResult, Vec2 } from "../../../shared/games/bowling/sim.ts";

// Bowling's words (task 29, ADR 004), pure so they are tested
// (spec/bowling-calls.test.ts): the call after a ball, the after-ball speed
// and curve read, and the guide arrow's points. The view only shows them.

/** The call after a ball: "STRIKE!", "Spare!", "Split!", "Gutter", "Time's up", "7 pins". */
export function callFor(r: BallResult): string {
  if (r.timeout) return "Time's up";
  if (r.strike) return "STRIKE!";
  if (r.spare) return "Spare!";
  if (r.split) return "Split!";
  if (r.gutter && r.pins === 0) return "Gutter";
  if (r.pins === 0) return "No pins";
  return r.pins === 1 ? "1 pin" : `${r.pins} pins`;
}

/** How the crowd and the sound take it: a strike or spare cheers, a gutter (or the clock) groans. */
export function reactionFor(r: BallResult): "cheer" | "groan" | null {
  if (r.strike || r.spare) return "cheer";
  if (r.gutter && r.pins === 0) return "groan";
  return null;
}

/** "Curve: a little left / none / a lot right", from the throw's spin (-1 left .. 1 right, as the bowler sees it). */
export function curveWords(spin: number): string {
  const a = Math.abs(spin);
  if (a < 0.1) return "none";
  const side = spin < 0 ? "left" : "right";
  return a < 0.5 ? `a little ${side}` : `a lot ${side}`;
}

export interface SpeedRead {
  /** The ball's speed, m/s. */
  ms: number;
  /** The good-speed zone for that curve, m/s, or null when no speed strikes with it (a straight ball). */
  zone: { min: number; max: number } | null;
  /** Where the read sits against the zone: below, in it, above, or null without a zone. */
  verdict: "slow" | "good" | "fast" | null;
}

/** The after-ball speed read against the sim's own speed zone for that spin. */
export function speedRead(read: { speed: number; spin: number; ms: number }): SpeedRead {
  const z = speedZone(read.spin);
  const zone = z ? { min: ballSpeed(z.min), max: ballSpeed(z.max) } : null;
  const verdict = zone === null ? null : read.ms < zone.min - 0.05 ? "slow" : read.ms > zone.max + 0.05 ? "fast" : "good";
  return { ms: read.ms, zone, verdict };
}

/** The share of the lane the guide arrow covers: the first third, never the bend or the end. */
export const ARROW_SHARE = 1 / 3;

/**
 * The guide arrow's points along the lane: from the foul line to a third of
 * the way down, for a ball started at `aim` (the sim's own path, so it can't
 * disagree with the roll). The ball runs straight down the boards over that
 * stretch, so the arrow shows the start and the direction, never the bend.
 */
export function arrowPoints(aim: number, spin: number, steps = 6): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * LANE.length * ARROW_SHARE;
    const x = ballXAt({ speed: 0.6, aim, spin }, Math.max(0.01, y));
    if (x === null) break;
    pts.push({ x, y });
  }
  return pts;
}

/** The power meter fills in this long, then falls in as long again, and so on while held. */
export const METER_FILL_S = 1.1;

/** The meter's speed (0..1) after holding for `seconds`: up over METER_FILL_S, down over as long, repeating. */
export function meterAt(seconds: number): number {
  const p = (Math.max(0, seconds) / METER_FILL_S) % 2;
  return p <= 1 ? p : 2 - p;
}
