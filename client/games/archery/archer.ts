import { CapsuleGeometry, Group, Mesh, Quaternion, SphereGeometry, Vector3 } from "three";
import type { Look } from "../../../shared/look.ts";
import { makePlayer } from "../tennis/character.ts";
import { ARM, SHOULDER, archerPose, reach } from "./archer-pose.ts";
import type { V } from "./archer-pose.ts";
import { makeBow } from "./bow-model.ts";

// The archer (task 31): the tennis character in the seat's look (built
// without its arms and racket, as boxing does) with two arms of its own and
// the bow from bow-model.ts, posed each frame from archer-pose.ts. Seen from
// over the shoulder while someone else shoots, and by spectators; the
// shooter's own view stays first person with its own bow.

export interface Archer {
  /** Place this in the scene; move and turn it with `root`. */
  root: Group;
  setLook(look: Look): void;
  /**
   * `stance` 0 rest .. 1 at the line, the shooter's `draw`, `pitch` and
   * `yaw`, an arrow on the string (`loaded`) and `raise` (the winner's bow up).
   */
  pose(stance: number, draw: number, pitch: number, yaw: number, loaded: boolean, raise?: number): void;
}

const UP = new Vector3(0, 1, 0);

export function makeArcher(look: Look): Archer {
  const player = makePlayer(look, 0, { arms: false });
  const { body, sleeve, forearm, skin, head } = player.parts;
  const root = new Group();
  root.add(player.group);
  // the head (with its hair or hat) turns at the neck to look down the arrow
  const NECK_Y = 1.47;
  const neck = new Group();
  neck.position.y = NECK_Y;
  body.add(neck);
  for (const m of head) {
    body.remove(m);
    m.position.y -= NECK_Y;
    neck.add(m);
  }

  const upperGeo = new CapsuleGeometry(0.06, ARM.upper - 0.08, 4, 8);
  const foreGeo = new CapsuleGeometry(0.055, ARM.fore - 0.1, 4, 8);
  const handGeo = new SphereGeometry(0.065, 8, 6);
  const arm = () => {
    const upper = new Mesh(upperGeo, sleeve);
    const fore = new Mesh(foreGeo, forearm);
    const hand = new Mesh(handGeo, skin);
    body.add(upper, fore, hand);
    return { upper, fore, hand };
  };
  const bowArm = arm();
  const drawArm = arm();
  const bow = makeBow();
  bow.group.rotation.order = "ZYX";
  body.add(bow.group);

  const a = new Vector3();
  const b = new Vector3();
  const d = new Vector3();
  const q = new Quaternion();
  const place = (mesh: Mesh, from: V, to: V) => {
    a.set(from.x, from.y, from.z);
    b.set(to.x, to.y, to.z);
    d.copy(b).sub(a);
    mesh.position.copy(a).addScaledVector(d, 0.5);
    q.setFromUnitVectors(UP, d.normalize());
    mesh.quaternion.copy(q);
  };
  const limb = (parts: ReturnType<typeof arm>, shoulder: V, hand: V, pole: V) => {
    const r = reach(shoulder, hand, pole);
    place(parts.upper, shoulder, r.elbow);
    place(parts.fore, r.elbow, r.hand);
    parts.hand.position.set(r.hand.x, r.hand.y, r.hand.z);
    return r.hand;
  };

  return {
    root,
    setLook: player.setLook,
    pose(stance, draw, pitch, yaw, loaded, raise = 0) {
      const p = archerPose(stance, draw, pitch, yaw, raise);
      player.group.rotation.y = p.bodyYaw;
      neck.rotation.y = p.headYaw;
      const grip = limb(bowArm, SHOULDER.bow, p.bowHand, p.bowPole);
      limb(drawArm, SHOULDER.draw, p.drawHand, p.drawPole);
      bow.group.position.set(grip.x, grip.y, grip.z);
      bow.group.rotation.set(0, p.bowYaw, -p.bowPitch);
      // the bow's draw follows the hand only at the line; at rest it hangs undrawn
      bow.set(stance > 0.5 ? draw : 0, loaded && stance > 0.5, -1);
    },
  };
}
