import type { Wind } from "../../../shared/games/archery/sim.ts";

// The range's flags (task 31) stream with the snapshot's wind, the same wind
// the server flies the arrow in, so they are an honest cue that agrees with
// the wind dial. Pure numbers; range.ts turns them into cloth.

/** Wind at or above this streams a flag straight out. */
export const FLAG_FULL_WIND = 6;
/** A still flag still hangs a little off the pole, so it shows. */
const LIMP = 0.1;

export interface FlagFly {
  /** Horizontal unit direction the flag streams toward, in world x and z (the wind's own). */
  dx: number;
  dz: number;
  /** The fly's angle from hanging straight down: small in no wind, about pi/2 streaming. */
  lift: number;
  /** How far the cloth ripples, and how fast (radians a second). */
  ripple: number;
  rate: number;
}

/** The world direction the wind blows toward: angle 0 is +x (right), pi/2 is -z (down the range). */
export function flagFly(w: Wind): FlagFly {
  const s = Math.max(0, Math.min(1, w.speed / FLAG_FULL_WIND));
  return {
    dx: Math.cos(w.angle),
    dz: -Math.sin(w.angle),
    lift: LIMP + s * (Math.PI / 2 - 0.05 - LIMP),
    ripple: 0.03 + 0.07 * s,
    rate: 3 + 0.8 * w.speed,
  };
}

/** The flags' direction as the dial shows it, degrees anticlockwise from right (0 right, 90 down the range). */
export function flagHeading(f: FlagFly): number {
  return Math.round(((Math.atan2(-f.dz, f.dx) * 180) / Math.PI + 360) % 360);
}
