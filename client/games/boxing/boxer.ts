import { CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, Quaternion, SphereGeometry, Vector3 } from "three";
import type { Look } from "../../../shared/look.ts";
import { makePlayer } from "../tennis/character.ts";
import { FALL_ANGLE, FOREARM, SHOULDER, UPPER_ARM, elbowPole, jabExtension, poseFor, solveElbow, WAIST_Y } from "./boxer-pose.ts";
import type { BoxerPose, Vec } from "./boxer-pose.ts";
import type { BoxerView, Hand } from "./scene-model.ts";

// A boxer (task 30): the tennis character's body, head and look
// (character.ts, built without its arms and racket) with two boxing arms and
// gloves, posed from the view model each frame. The upper body turns at the
// waist (a slip, a hunch, leaning into a jab), the head at the neck (a clean
// shot snaps it back), the whole boxer at the feet (a knockout). Each part
// eases toward the pose from boxer-pose.ts, so states blend instead of jumping.
//
// Local forward is -z, as for the tennis player; boxer-pose.ts's frame has z
// forward, so its z is negated here.

export interface Boxer {
  group: Group;
  /** Eases toward the pose for `view`; `dt` in seconds. */
  update(view: BoxerView, dt: number): void;
  setLook(look: Look): void;
  setGloveColour(colour: number): void;
  /**
   * First person, for the player's own boxer: only the arms and gloves show,
   * and the guard is drawn a little wider and lower so the gloves frame the
   * other boxer instead of covering them (drawing only: poseFor is unchanged).
   */
  setFirstPerson(on: boolean): void;
  /** The head's centre in world space now, for the camera to look at. */
  headWorld(out: Vector3): Vector3;
}

const UP = new Vector3(0, 1, 0);
// First person: your own guard, drawn wider (dx) and higher or lower (dy)
// than the pose so each guard still shows at the bottom of the frame and
// frames the other boxer instead of covering them. High stays highest, low
// sits in the middle and close together, none lowest.
const FP_OFFSET = {
  high: { dx: 0.11, dy: -0.1 },
  low: { dx: 0.03, dy: 0.12 },
  none: { dx: -0.02, dy: 0.26 },
} as const;
const HANDS = ["left", "right"] as const;

/** Moves toward a target at a rate (per second), the same at any frame rate. */
const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

function glove(material: MeshLambertMaterial): Group {
  const g = new Group();
  // the fist: a rounded mitt, longer along the forearm (local -y is forward)
  const fist = new Mesh(new SphereGeometry(0.115, 12, 10), material);
  fist.scale.set(1, 1.15, 0.95);
  const thumb = new Mesh(new SphereGeometry(0.05, 8, 6), material);
  thumb.position.set(0.075, 0.02, -0.05);
  thumb.scale.set(0.9, 1.4, 0.9);
  // the white cuff round the wrist
  const cuff = new Mesh(new CylinderGeometry(0.07, 0.075, 0.1, 10), new MeshLambertMaterial({ color: 0xf2f4f7 }));
  cuff.position.y = 0.13;
  g.add(fist, thumb, cuff);
  return g;
}

export function makeBoxer(look: Look, gloveColour: number): Boxer {
  const player = makePlayer(look, 0, { arms: false });
  const { body, upper, head, sleeve, skin } = player.parts;

  // the knockdown turns everything at the feet
  const root = new Group();
  player.group.remove(body);
  root.add(body);
  player.group.add(root);

  // the upper body turns at the waist: torso, shoulders, neck, arms and head
  const waist = new Group();
  waist.position.y = WAIST_Y;
  body.add(waist);
  for (const m of upper) {
    body.remove(m);
    m.position.y -= WAIST_Y;
    waist.add(m);
  }
  const neckY = 1.47;
  const neck = new Group();
  neck.position.y = neckY - WAIST_Y;
  waist.add(neck);
  for (const m of head) {
    body.remove(m);
    m.position.y -= neckY;
    neck.add(m);
  }

  const gloveMat = new MeshLambertMaterial({ color: gloveColour });
  const arms = HANDS.map((hand) => {
    const s = hand === "right" ? 1 : -1;
    const upperArm = new Mesh(new CapsuleGeometry(0.062, UPPER_ARM - 0.06, 4, 8), sleeve);
    const fore = new Mesh(new CapsuleGeometry(0.055, FOREARM - 0.2, 4, 8), skin);
    const g = glove(gloveMat);
    waist.add(upperArm, fore, g);
    return { hand, s, upperArm, fore, glove: g };
  });
  const armParts = new Set<object>(arms.flatMap((a) => [a.upperArm, a.fore, a.glove]));
  // everything else on the boxer, hidden in first person (the shadow stays)
  const bodyParts: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && !armParts.has(o) && !armParts.has(o.parent ?? {})) bodyParts.push(o);
  });
  let firstPerson = false;

  // the eased state
  const cur: BoxerPose = poseFor({ look, guard: null, slip: null, jab: null, hit: null, ko: false });
  const tmp2 = new Vector3();
  const q = new Quaternion();
  // pose frame (from the feet, z forward) to the waist group's frame
  const local = (p: Vec, out: Vector3) => out.set(p.x, p.y - WAIST_Y, -p.z);

  const place = (mesh: Mesh | Group, a: Vector3, b: Vector3, at = 0.5) => {
    tmp2.copy(b).sub(a);
    mesh.position.copy(a).addScaledVector(tmp2, at);
    // the part's +y runs back from b to a, so a glove's -y points along the forearm
    q.setFromUnitVectors(UP, tmp2.normalize().negate());
    mesh.quaternion.copy(q);
  };

  const shoulderAt = (hand: Hand): Vec => ({ x: SHOULDER.x * (hand === "right" ? 1 : -1), y: SHOULDER.y, z: SHOULDER.z });
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();

  return {
    group: player.group,
    setLook: player.setLook,
    setGloveColour(colour) {
      gloveMat.color.setHex(colour);
    },
    setFirstPerson(on) {
      firstPerson = on;
      // the head and its hair or hat hang off the neck group, and setLook
      // only shows or hides the parts inside it, so this doesn't fight it
      neck.visible = !on;
      for (const m of bodyParts) if (!head.includes(m)) m.visible = !on;
    },
    headWorld(out) {
      player.group.updateMatrixWorld(true);
      return head[0].getWorldPosition(out);
    },
    update(view, dt) {
      const target = poseFor(view);
      const fast = (hand: Hand) => view.jab?.hand === hand && !view.ko;
      for (const hand of HANDS) {
        const rate = fast(hand) ? 60 : 16;
        const g = cur.gloves[hand];
        const t = { ...target.gloves[hand] };
        if (firstPerson) {
          const k = 1 - (view.jab?.hand === hand ? jabExtension(view.jab.t) : 0);
          const o = FP_OFFSET[view.ko ? "none" : (view.guard ?? "none")];
          t.x += (hand === "right" ? 1 : -1) * o.dx * k;
          t.y += o.dy * k;
        }
        g.x = ease(g.x, t.x, rate, dt);
        g.y = ease(g.y, t.y, rate, dt);
        g.z = ease(g.z, t.z, rate, dt);
        cur.elbowOut[hand] = ease(cur.elbowOut[hand], target.elbowOut[hand], rate, dt);
      }
      cur.lean = ease(cur.lean, target.lean, 14, dt);
      cur.drop = ease(cur.drop, target.drop, 14, dt);
      cur.reach = ease(cur.reach, target.reach, 30, dt);
      cur.head = ease(cur.head, target.head, 40, dt);
      cur.hunch = ease(cur.hunch, target.hunch, 30, dt);
      cur.step = ease(cur.step, target.step, 40, dt);
      // a knockdown topples (accelerating); getting up is quicker
      cur.fall = target.fall > cur.fall ? Math.min(target.fall, cur.fall + dt * (0.6 + cur.fall * 4)) : ease(cur.fall, target.fall, 6, dt);

      root.rotation.x = cur.fall * FALL_ANGLE;
      root.position.y = cur.fall * 0.14;
      // the step in is along the boxer's forward, local -z
      root.position.z = -cur.step;
      waist.position.y = WAIST_Y - cur.drop;
      waist.rotation.set(-(cur.hunch * 0.45 + cur.reach), 0, -cur.lean, "ZXY");
      neck.rotation.x = cur.head - cur.hunch * 0.3;

      for (const arm of arms) {
        const solved = solveElbow(shoulderAt(arm.hand), cur.gloves[arm.hand], UPPER_ARM, FOREARM, elbowPole(arm.hand, cur.elbowOut[arm.hand]));
        local(shoulderAt(arm.hand), a);
        local(solved.elbow, b);
        local(solved.glove, c);
        place(arm.upperArm, a, b);
        place(arm.fore, b, c, 0.4);
        place(arm.glove, b, c, 1);
      }
    },
  };
}
