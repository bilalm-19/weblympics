import { CapsuleGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry } from "three";
import type { Look } from "../../../shared/look.ts";
import { makePlayer } from "../tennis/character.ts";
import { runPose } from "./scene-model.ts";

// A runner (task 31): the tennis character's body, head and look
// (character.ts, built without its arms and racket, as boxing does) with
// jointed legs and arms of its own, posed each frame by runPose from the
// stride phase and the server's speed. The character's own legs and shoes are
// hidden; everything else (torso, head, hair or hat, the look's colours) is
// the character's. Local forward is -z, as for the tennis player; the view
// turns the runner to face down the track.

export interface Runner {
  group: Group;
  /** `phase` in radians through the stride; `speed` 0..1 of top speed; `set` crouches at the blocks. */
  run(phase: number, speed: number, set?: boolean): void;
  setLook(look: Look): void;
}

const HIP_Y = 0.78;
const THIGH = 0.4;
const SHIN = 0.4;
const SHOULDER_Y = 1.36;
const UPPER_ARM = 0.27;
const FOREARM = 0.27;

/** A limb segment hanging from a pivot along -y. */
function segment(radius: number, length: number, material: MeshLambertMaterial): { pivot: Group; end: Group } {
  const pivot = new Group();
  const mesh = new Mesh(new CapsuleGeometry(radius, length - radius * 2, 3, 8), material);
  mesh.position.y = -length / 2;
  const end = new Group();
  end.position.y = -length;
  pivot.add(mesh, end);
  return { pivot, end };
}

export function makeRunner(look: Look): Runner {
  const player = makePlayer(look, 0, { arms: false });
  const { body, upper, head, top, skin } = player.parts;

  // hide the character's straight legs and shoes: everything on the body that
  // isn't the torso, the head or the hair is a leg or a shoe
  const keep = new Set<object>([...upper, ...head]);
  for (const child of body.children) if (child instanceof Mesh && !keep.has(child)) child.visible = false;

  // the upper body leans at the hips
  const torso = new Group();
  torso.position.y = HIP_Y;
  body.add(torso);
  for (const m of [...upper, ...head]) {
    body.remove(m);
    m.position.y -= HIP_Y;
    torso.add(m);
  }

  // shorts' colour comes from the leg the character would have drawn
  const legMesh = body.children.find((c) => c instanceof Mesh && !keep.has(c)) as Mesh | undefined;
  const shorts = (legMesh?.material as MeshLambertMaterial | undefined) ?? new MeshLambertMaterial({ color: 0x2b303b });
  const shoe = new MeshLambertMaterial({ color: 0xf2f4f7 });

  const legs = ([-1, 1] as const).map((s) => {
    const thigh = segment(0.085, THIGH, shorts);
    thigh.pivot.position.set(s * 0.11, HIP_Y, 0);
    const shin = segment(0.07, SHIN, skin);
    thigh.end.add(shin.pivot);
    const foot = new Mesh(new CapsuleGeometry(0.06, 0.12, 3, 6), shoe);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, 0.02, -0.05);
    shin.end.add(foot);
    body.add(thigh.pivot);
    return { hip: thigh.pivot, knee: shin.pivot };
  });
  const arms = ([-1, 1] as const).map((s) => {
    const up = segment(0.06, UPPER_ARM, top);
    up.pivot.position.set(s * 0.24, SHOULDER_Y - HIP_Y, 0);
    up.pivot.rotation.z = s * 0.1;
    const fore = segment(0.055, FOREARM, skin);
    up.end.add(fore.pivot);
    const hand = new Mesh(new SphereGeometry(0.065, 8, 6), skin);
    hand.position.y = -FOREARM;
    fore.pivot.add(hand);
    torso.add(up.pivot);
    return { shoulder: up.pivot, elbow: fore.pivot };
  });

  return {
    group: player.group,
    setLook(l) {
      player.setLook(l);
    },
    run(phase, speed, set = false) {
      const p = runPose(phase, speed, set);
      // forward is -z: a positive turn about x swings a hanging limb's end
      // toward -z, and tips an upright part (the torso) back toward +z
      const [left, right] = legs;
      left.hip.rotation.x = p.hip.left;
      right.hip.rotation.x = p.hip.right;
      // a knee folds the shin back (+z)
      left.knee.rotation.x = -p.knee.left;
      right.knee.rotation.x = -p.knee.right;
      const [armL, armR] = arms;
      armL.shoulder.rotation.x = p.shoulder.left;
      armR.shoulder.rotation.x = p.shoulder.right;
      // the elbow folds the forearm forward and up
      armL.elbow.rotation.x = p.elbow.left;
      armR.elbow.rotation.x = p.elbow.right;
      torso.rotation.x = -p.lean;
      body.position.y = p.bounce;
    },
  };
}
