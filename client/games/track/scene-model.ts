// Track's look (task 31) as plain numbers, no Three.js, so it can be tested:
// the run cycle's joint angles from the stride phase and the server's speed,
// how loud the crowd is from how near the runners are to the line, and what
// the finish clock reads. Drawing only: nothing here feeds back into the sim.

import { DT } from "../../../shared/games/track/sim.ts";
import type { TrackSnapshot } from "../../../shared/games/track/sim.ts";

/** Joint angles in radians. Positive hip/shoulder swings the limb forward; positive knee/elbow folds it. */
export interface RunPose {
  hip: { left: number; right: number };
  knee: { left: number; right: number };
  shoulder: { left: number; right: number };
  elbow: { left: number; right: number };
  /** Forward lean of the whole body. */
  lean: number;
  /** Metres the body rises off its rest height. */
  bounce: number;
}

/**
 * The pose at `phase` (radians through the stride) for `speed` 0..1 of top
 * speed. Legs swing opposite each other and each arm opposite its own leg;
 * the stride, the knee lift, the arm drive and the lean all grow with speed.
 * `set` is the crouch at the blocks before the gun.
 */
export function runPose(phase: number, speed: number, set = false): RunPose {
  const v = Math.max(0, Math.min(1, speed));
  if (set) {
    return {
      hip: { left: 0.7, right: 0.25 },
      knee: { left: 1.1, right: 0.6 },
      shoulder: { left: 0.35, right: -0.25 },
      elbow: { left: 0.3, right: 0.3 },
      lean: 0.45,
      bounce: -0.12,
    };
  }
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const stride = 0.12 + 0.75 * v;
  // a leg swinging forward (its hip angle rising) has its knee folded up
  const fold = (rising: number) => 0.12 + (0.25 + 1.35 * v) * Math.max(0, rising);
  return {
    hip: { left: s * stride, right: -s * stride },
    knee: { left: fold(c), right: fold(-c) },
    shoulder: { left: -s * stride * 0.95, right: s * stride * 0.95 },
    elbow: { left: 0.25 + 1.1 * v, right: 0.25 + 1.1 * v },
    lean: 0.03 + 0.2 * v,
    bounce: Math.abs(c) * 0.07 * v,
  };
}

/**
 * How hard the crowd cheers, 0..1: a murmur at the blocks, rising as the
 * leader nears the line, and a burst for a few seconds after the first runner
 * crosses it. `lead` is the leader's share of the race (0..1), `sinceFinish`
 * seconds since the first finish (null before it).
 */
export function excitement(lead: number, sinceFinish: number | null, running: boolean): number {
  if (sinceFinish !== null) return Math.max(0.25, 1 - Math.max(0, sinceFinish - 2.5) / 3);
  if (!running) return 0.06;
  const l = Math.max(0, Math.min(1, lead));
  return 0.15 + 0.7 * l * l;
}

/**
 * The finish clock: 0.00 before the gun, the race time while running, and
 * stopped at the first finish (the winner's time).
 */
export function clockTime(s: TrackSnapshot): number {
  if (s.phase === "set") return 0;
  const finishes = s.lanes.map((l) => l.finish).filter((f): f is number => f !== null);
  if (finishes.length) return Math.min(...finishes);
  return s.phase === "running" ? s.phaseTick * DT : 0;
}

export const clockText = (t: number): string => t.toFixed(2);
