import { BRACE, PULL } from "./bow-model.ts";

// The archer's pose (task 31), pure numbers so it can be tested: where the
// two hands are, which way the elbows bend and how the bow and body turn, in
// the tennis character's own frame (character.ts: x to their right, y up,
// forward -z, feet at the origin). At the line the archer stands side-on, the
// left shoulder toward the target (local -x), bow arm out, the draw hand on
// the string under the chin; at rest both arms hang, the bow held low.
//
// The draw hand follows the bow's own string (bow-model.ts's BRACE and PULL),
// so the hand is always on it. Before the draw the bow arm is bent a little
// and pushes out straight as the string comes back to the chin.

export interface V {
  x: number;
  y: number;
  z: number;
}

/** The archer's arm, a bit longer than tennis's so a drawn bow fits. */
export const ARM = { upper: 0.345, fore: 0.345 } as const;
export const SHOULDER = { bow: { x: -0.24, y: 1.36, z: 0 }, draw: { x: 0.24, y: 1.36, z: 0 } } as const;
/** The arrow's line at the shooting line: under the chin, in front of the chest. */
export const ANCHOR = { y: 1.48, z: -0.28 } as const;
/** The bow's grip from the body along the arrow, before and at full draw (the nock then reaches the chin). */
const GRIP_SET = 0.5;
const GRIP_FULL = 0.79;
/** The pitch turns everything at the line about this point (the chest). */
const PIVOT = { x: 0, y: 1.42, z: ANCHOR.z } as const;
/**
 * Where an archer's feet go so the arrow at the line is where the sim
 * launches it (x 0): side-on, the arrow's line is ANCHOR.z in front of the
 * chest, which is +x in the world, so the feet stand that far to the left.
 */
export const LINE_X = ANCHOR.z;

const REST = {
  bowHand: { x: -0.32, y: 0.86, z: -0.06 },
  drawHand: { x: 0.31, y: 0.86, z: 0.02 },
  bowPole: { x: -0.2, y: 0, z: 1 },
  drawPole: { x: 0.2, y: 0, z: 1 },
};

export interface ArcherPose {
  bowHand: V;
  drawHand: V;
  /** Which way each elbow bends (any length). */
  bowPole: V;
  drawPole: V;
  /** The bow's turn about y (0 at rest: arrow forward; pi/2 at the line: arrow toward local -x), then its tilt up. */
  bowYaw: number;
  bowPitch: number;
  /** The whole archer's turn about y: 0 faces down the range, -pi/2 side-on at the line, less the aim's yaw. */
  bodyYaw: number;
  /** The head's turn at the neck: back toward the target at the line. */
  headYaw: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const mix = (a: V, b: V, k: number): V => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** Turns p about PIVOT, round the z axis, so the arrow's line (-x) tips up by `pitch`. */
function tip(p: V, pitch: number): V {
  const dx = p.x - PIVOT.x;
  const dy = p.y - PIVOT.y;
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  return { x: PIVOT.x + dx * c + dy * s, y: PIVOT.y - dx * s + dy * c, z: p.z };
}

/** The winner's bow held up over the head at the end. */
const RAISED = { x: -0.3, y: 2.12, z: -0.08 };

/**
 * `stance` 0 at rest .. 1 at the line, `draw` 0..1 as the shooter sent it,
 * `pitch` and `yaw` the aim in radians (up and right positive); `raise` 0..1
 * lifts the bow overhead at rest (the winner, at the end).
 */
export function archerPose(stance: number, draw: number, pitch: number, yaw: number, raise = 0): ArcherPose {
  const k = clamp01(stance);
  const d = clamp01(draw);
  const gripX = -(GRIP_SET + (GRIP_FULL - GRIP_SET) * d);
  const grip = tip({ x: gripX, y: ANCHOR.y, z: ANCHOR.z }, pitch);
  const nock = tip({ x: gripX + BRACE + PULL * d, y: ANCHOR.y, z: ANCHOR.z }, pitch);
  const restBow = mix(REST.bowHand, RAISED, clamp01(raise) * (1 - k));
  return {
    bowHand: mix(restBow, grip, k),
    drawHand: mix(REST.drawHand, nock, k),
    // at the line the bow elbow turns down, the draw elbow out behind at shoulder height
    bowPole: mix(REST.bowPole, { x: 0, y: -1, z: 0.25 }, k),
    drawPole: mix(REST.drawPole, { x: 1, y: 0.3, z: 0.2 }, k),
    bowYaw: (k * Math.PI) / 2,
    bowPitch: k * pitch,
    bodyYaw: k * (-Math.PI / 2 - yaw),
    headYaw: k * 1.3,
  };
}

const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: V) => Math.sqrt(dot(a, a));
const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/**
 * Two-bone reach: the elbow for a hand at `hand`, bending toward `pole`. The
 * hand comes back along the line if it's out of reach (`hand` in the result).
 */
export function reach(shoulder: V, hand: V, pole: V, upper = ARM.upper, fore = ARM.fore): { elbow: V; hand: V } {
  const d0 = sub(hand, shoulder);
  const dist0 = len(d0) || 1e-6;
  const n = scale(d0, 1 / dist0);
  const d = Math.min(Math.max(dist0, Math.abs(upper - fore) + 1e-4), upper + fore - 1e-4);
  const along = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - along * along));
  let p = sub(pole, scale(n, dot(pole, n)));
  const pl = len(p);
  p = pl > 1e-6 ? scale(p, 1 / pl) : { x: 0, y: -1, z: 0 };
  return { elbow: add(add(shoulder, scale(n, along)), scale(p, h)), hand: add(shoulder, scale(n, d)) };
}
