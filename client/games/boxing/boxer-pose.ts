import type { BoxerView, Hand } from "./scene-model.ts";

// The boxer's pose from the view model, as plain numbers (no Three.js), so it
// can be tested without WebGL (spec/boxing-pose.test.ts). boxer.ts eases the
// rig toward it each frame and bends the elbows with solveElbow.
//
// Frame: the boxer's own, metres from the point between their feet: x to
// their right, y up, z forward (toward the other boxer).

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** Where each shoulder turns, and the arm's two lengths (the forearm's runs to the glove's middle). */
export const SHOULDER = { x: 0.24, y: 1.36, z: 0 } as const;
export const UPPER_ARM = 0.32;
export const FOREARM = 0.42;
/** The head's centre (the tennis character's), and how far apart the two boxers stand. */
export const HEAD_Y = 1.78;
/** Where the upper body turns (the bottom of the torso). */
export const WAIST_Y = 0.85;
export const FOE_DISTANCE = 1.35;
/** How far back a knocked-out boxer tips, in radians, at `fall` 1: flat on the canvas. */
export const FALL_ANGLE = 1.5;

export interface BoxerPose {
  /** The middle of each glove. */
  gloves: Record<Hand, Vec>;
  /** 0 elbows hang down, 1 they point out to the side (forearms across the chest). */
  elbowOut: Record<Hand, number>;
  /** Sideways lean from the feet, radians: + to the boxer's own right. */
  lean: number;
  /** How far the body sinks (a slip ducks a little), metres. */
  drop: number;
  /** Forward lean into a jab, radians. */
  reach: number;
  /** A step in toward the other boxer with a jab, metres. */
  step: number;
  /** The head snapping back, radians (+ back). */
  head: number;
  /** Folding forward over the stomach, 0..1. */
  hunch: number;
  /** Knocked down: 0 standing .. 1 flat on the canvas (eased by the rig). */
  fall: number;
  /** Blocked: how far the gloves shake right now, metres (a decaying wobble). */
  shake: number;
}

const side = (hand: Hand) => (hand === "right" ? 1 : -1);
const v = (x: number, y: number, z: number): Vec => ({ x, y, z });

/** Each guard's glove, for the right hand (the left is its mirror). */
const GUARD_GLOVE = {
  // both fists by the face, either side of the chin
  high: v(0.14, 1.72, 0.36),
  // forearms across the chest, gloves just under the chin
  low: v(0.09, 1.38, 0.3),
  // no guard: loose, at chest height
  none: v(0.27, 1.16, 0.26),
} as const;
const GUARD_ELBOW = { high: 0.15, low: 0.55, none: 0.3 } as const;

/** Where a jab's glove ends up at full extension (right hand), before the step in (`step`). */
const JAB_GLOVE = {
  head: v(0.05, 1.64, 0.68),
  body: v(0.08, 1.12, 0.62),
} as const;
const JAB_REACH = 0.12;
const JAB_STEP = 0.24;

const SLIP_LEAN = 0.3;
const SLIP_DROP = 0.12;

const mirror = (p: Vec, hand: Hand): Vec => v(p.x * side(hand), p.y, p.z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec = (a: Vec, b: Vec, t: number): Vec => v(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

/**
 * How far out a jab's fist is along its `t`: 0 at the guard, 1 at the landing
 * (t = 1, fast out), back to 0 at t = 2 (a little slower in).
 */
export function jabExtension(t: number): number {
  if (t <= 0 || t >= 2) return 0;
  if (t <= 1) return 1 - (1 - t) * (1 - t);
  const back = t - 1;
  return 1 - back * back * (3 - 2 * back);
}

/** A reaction's strength `age` seconds after the hit: a quick rise, then it fades over about half a second. */
export function hitStrength(age: number): number {
  if (age < 0) return 0;
  if (age < 0.05) return age / 0.05;
  return Math.exp(-(age - 0.05) / 0.18);
}

/** The guard a glove sits in, for one boxer. */
export function guardGlove(view: Pick<BoxerView, "guard" | "ko">, hand: Hand): Vec {
  const g = view.ko ? "none" : (view.guard ?? "none");
  return mirror(GUARD_GLOVE[g], hand);
}

export function poseFor(view: BoxerView): BoxerPose {
  const guard = view.ko ? "none" : (view.guard ?? "none");
  const gloves = { left: guardGlove(view, "left"), right: guardGlove(view, "right") };
  const elbowOut: Record<Hand, number> = { left: GUARD_ELBOW[guard], right: GUARD_ELBOW[guard] };
  let reach = 0;
  let step = 0;
  if (view.jab && !view.ko) {
    const { hand, target, t } = view.jab;
    const e = jabExtension(t);
    gloves[hand] = lerpVec(gloves[hand], mirror(JAB_GLOVE[target], hand), e);
    // a punching arm's elbow comes in behind the fist
    elbowOut[hand] = lerp(elbowOut[hand], 0.1, e);
    reach = JAB_REACH * e;
    step = JAB_STEP * e;
  }
  const lean = view.slip && !view.ko ? (view.slip === "right" ? SLIP_LEAN : -SLIP_LEAN) : 0;
  const drop = view.slip && !view.ko ? SLIP_DROP : 0;

  let head = 0;
  let hunch = 0;
  let shake = 0;
  if (view.hit && !view.ko) {
    const k = hitStrength(view.hit.age);
    if (view.hit.outcome === "clean") {
      if (view.hit.target === "head") head = 0.55 * k;
      else hunch = 0.9 * k;
    } else if (view.hit.outcome === "blocked") {
      shake = 0.035 * k * Math.sin(view.hit.age * 70);
    }
    // slipped: the punch missed, nothing on the defender
  }
  if (shake) {
    for (const hand of ["left", "right"] as const) {
      if (view.jab?.hand === hand && jabExtension(view.jab.t) > 0) continue;
      gloves[hand] = v(gloves[hand].x + shake * side(hand), gloves[hand].y + shake * 0.5, gloves[hand].z);
    }
  }
  return { gloves, elbowOut, lean, drop, reach, step, head, hunch, fall: view.ko ? 1 : 0, shake };
}

const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a: Vec, b: Vec): Vec => v(a.x + b.x, a.y + b.y, a.z + b.z);
const scale = (a: Vec, s: number): Vec => v(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec) => Math.sqrt(dot(a, a));

/**
 * Where the elbow goes so the upper arm (`upper` long) and forearm (`fore`)
 * join the shoulder to the glove, bent toward `pole`. A glove out of reach is
 * pulled in along its line: the arm goes straight.
 */
export function solveElbow(shoulder: Vec, glove: Vec, upper: number, fore: number, pole: Vec): { elbow: Vec; glove: Vec } {
  const d0 = sub(glove, shoulder);
  const dist0 = len(d0) || 1e-6;
  const n = scale(d0, 1 / dist0);
  const d = Math.min(Math.max(dist0, Math.abs(upper - fore) + 1e-4), upper + fore - 1e-4);
  const reached = add(shoulder, scale(n, d));
  const along = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - along * along));
  // the pole's part square to the arm's line
  let p = sub(pole, scale(n, dot(pole, n)));
  const pl = len(p);
  p = pl > 1e-6 ? scale(p, 1 / pl) : v(0, -1, 0);
  return { elbow: add(add(shoulder, scale(n, along)), scale(p, h)), glove: reached };
}

/** The direction an elbow bends toward, from `elbowOut`: down, or out to that side. */
export function elbowPole(hand: Hand, out: number): Vec {
  const s = side(hand);
  return v(s * (0.25 + out), -(1 - out * 0.6), -0.25);
}
