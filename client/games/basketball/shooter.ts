import { CapsuleGeometry, Color, Group, Mesh, MeshLambertMaterial, Quaternion, SphereGeometry, Vector3 } from "three";
import type { Look } from "../../../shared/look.ts";
import { makePlayer } from "../tennis/character.ts";
import { FOREARM, SHOULDER, UPPER_ARM, elbowPole, solveElbow } from "../boxing/boxer-pose.ts";
import type { Vec } from "../boxing/boxer-pose.ts";

// A shooter (task 32): tennis's character (character.ts, built without its
// arms and racket) with two plain arms whose hands hold the ball at the chest,
// and one standard shot: up past the face, arms out towards the hoop, a
// follow-through, then back down. The elbows bend with boxing's pure
// two-bone solver (boxer-pose.ts). `shotPose` is pure, so it is tested.
//
// Frame for poses: metres from the point between the feet, x to the
// shooter's right, y up, z forward (towards the hoop). The character's local
// forward is -z, so z is negated when placing the parts.

export type Hand = "left" | "right";

export interface ShotPose {
  hands: Record<Hand, Vec>;
  /** Where the ball sits while held, or null once it has left the hands. */
  ball: Vec | null;
}

/** The shot's timeline after release starts, seconds: rise, hold the follow-through, come down. */
export const SHOT_TIMES = { rise: 0.18, hold: 0.75, down: 0.4 } as const;

const CHEST: ShotPose = {
  hands: { left: { x: -0.13, y: 1.18, z: 0.3 }, right: { x: 0.13, y: 1.18, z: 0.3 } },
  ball: { x: 0, y: 1.2, z: 0.42 },
};
const RELEASE: Record<Hand, Vec> = { left: { x: -0.09, y: 2.12, z: 0.38 }, right: { x: 0.09, y: 2.16, z: 0.42 } };
const RELAXED: Record<Hand, Vec> = { left: { x: -0.32, y: 0.78, z: 0.06 }, right: { x: 0.32, y: 0.78, z: 0.06 } };

const mix = (a: Vec, b: Vec, k: number): Vec => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
const smooth = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/**
 * The arms for a shooter: "hold" has the ball at the chest (`dip` 0..1 lowers
 * it a little as a held power bar fills); "shoot" is `t` seconds into the
 * shot (the ball leaves at the top of the rise); "relaxed" is hands down, no
 * ball (waiting or watching).
 */
export function shotPose(state: "hold" | "shoot" | "relaxed", t = 0, dip = 0): ShotPose {
  if (state === "relaxed") return { hands: { ...RELAXED }, ball: null };
  if (state === "hold") {
    const d = 0.08 * Math.min(1, Math.max(0, dip));
    const at = (v: Vec): Vec => ({ x: v.x, y: v.y - d, z: v.z });
    return { hands: { left: at(CHEST.hands.left), right: at(CHEST.hands.right) }, ball: at(CHEST.ball!) };
  }
  if (t < SHOT_TIMES.rise) {
    const k = smooth(t / SHOT_TIMES.rise);
    const hands = { left: mix(CHEST.hands.left, RELEASE.left, k), right: mix(CHEST.hands.right, RELEASE.right, k) };
    return { hands, ball: mix(CHEST.ball!, { x: 0, y: 2.2, z: 0.5 }, k) };
  }
  if (t < SHOT_TIMES.rise + SHOT_TIMES.hold) return { hands: { ...RELEASE }, ball: null };
  const k = smooth((t - SHOT_TIMES.rise - SHOT_TIMES.hold) / SHOT_TIMES.down);
  return { hands: { left: mix(RELEASE.left, RELAXED.left, k), right: mix(RELEASE.right, RELAXED.right, k) }, ball: null };
}

export interface Shooter {
  group: Group;
  setLook(look: Look): void;
  /** Eases the arms toward `pose`; `glow` 0..1 lights the hands (the ready cue). */
  update(pose: ShotPose, glow: number, dt: number): void;
}

const UP = new Vector3(0, 1, 0);
const GLOW = new Color(0xffd23f);
const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

export function makeShooter(look: Look): Shooter {
  const player = makePlayer(look, 0, { arms: false });
  const { body, sleeve, skin } = player.parts;
  const handMat = new MeshLambertMaterial({ color: skin.color.getHex() });
  const arms = (["left", "right"] as const).map((hand) => {
    const upper = new Mesh(new CapsuleGeometry(0.06, UPPER_ARM - 0.08, 4, 8), sleeve);
    const fore = new Mesh(new CapsuleGeometry(0.052, FOREARM - 0.12, 4, 8), skin);
    const palm = new Mesh(new SphereGeometry(0.068, 8, 6), handMat);
    body.add(upper, fore, palm);
    return { hand, upper, fore, palm, cur: { ...RELAXED[hand] } };
  });
  const a = new Vector3();
  const b = new Vector3();
  const tmp = new Vector3();
  const q = new Quaternion();
  const local = (p: Vec, out: Vector3) => out.set(p.x, p.y, -p.z);
  const place = (mesh: Mesh, from: Vector3, to: Vector3) => {
    tmp.copy(to).sub(from);
    mesh.position.copy(from).addScaledVector(tmp, 0.5);
    q.setFromUnitVectors(UP, tmp.normalize());
    mesh.quaternion.copy(q);
  };
  return {
    group: player.group,
    setLook: player.setLook,
    update(pose, glow, dt) {
      handMat.color.copy(skin.color);
      handMat.emissive.copy(GLOW).multiplyScalar(0.9 * glow);
      for (const arm of arms) {
        const target = pose.hands[arm.hand];
        // the shot itself is quick; settling back is gentler
        const rate = 30;
        arm.cur.x = ease(arm.cur.x, target.x, rate, dt);
        arm.cur.y = ease(arm.cur.y, target.y, rate, dt);
        arm.cur.z = ease(arm.cur.z, target.z, rate, dt);
        const s = arm.hand === "right" ? 1 : -1;
        const shoulder = { x: SHOULDER.x * s, y: SHOULDER.y, z: SHOULDER.z };
        const solved = solveElbow(shoulder, arm.cur, UPPER_ARM, FOREARM, elbowPole(arm.hand, 0.15));
        local(shoulder, a);
        local(solved.elbow, b);
        place(arm.upper, a, b);
        local(solved.glove, a);
        place(arm.fore, b, a);
        arm.palm.position.copy(a);
      }
    },
  };
}
