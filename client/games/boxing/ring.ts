import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import type { Scene } from "three";
import { Painter } from "../tennis/stadium.ts";
import { rng } from "../tennis/crowd-layout.ts";
import { SEAT_COLOURS } from "./scene-model.ts";
import type { CrowdFans } from "../tennis/crowd-motion.ts";
import type { Seat } from "../../audio/crowd.ts";

// The boxing ring (task 30), from primitives like tennis's stadium: static
// parts painted with vertex colours and merged into one lit and one unlit
// mesh (two draw calls), the crowd instanced (two more). A dark arena with
// the light on the ring, so the boxers stand out. No textures, no shadows:
// it renders the same under software rendering in the tests.
//
// Laid out for seat 0: its (blue) corner at +x, +z, behind the near boxer;
// red diagonally opposite; the other two white. The scene turns the ring
// round for seat 1.

/** The canvas's height above the arena floor; boxers stand on it. */
export const RING_Y = 0.9;
/** Half the width of the canvas inside the posts. */
export const RING_HALF = 2.7;
const APRON = 0.45;
const POST_H = 1.45;
const ROPE_HEIGHTS = [0.45, 0.85, 1.25];
const ROPE_COLOURS = [0xf2f4f7, 0xe0453a, 0xf2f4f7];

const FLOOR = 0x15171c;
const CANVAS = 0xd9dde3;
const SKIRT = 0x1d2a44;

function platform(paint: Painter): void {
  const outer = RING_HALF + APRON;
  // the arena floor around the ring
  paint.box(60, 0.1, 60, 0, -0.05, 0, FLOOR);
  // the raised block, a navy skirt with a white band at the top
  paint.box(outer * 2, RING_Y - 0.06, outer * 2, 0, (RING_Y - 0.06) / 2, 0, SKIRT);
  for (const s of [-1, 1]) {
    paint.box(outer * 2 + 0.02, 0.08, 0.02, 0, RING_Y - 0.1, s * (outer + 0.005), 0xf2f4f7, true);
    paint.box(0.02, 0.08, outer * 2 + 0.02, s * (outer + 0.005), RING_Y - 0.1, 0, 0xf2f4f7, true);
  }
  // the canvas on top, with a darker apron round it and a faint centre logo ring
  paint.box(outer * 2, 0.06, outer * 2, 0, RING_Y - 0.03, 0, 0xaeb4bd);
  paint.box(RING_HALF * 2, 0.062, RING_HALF * 2, 0, RING_Y - 0.03, 0, CANVAS);
  const logo = new CylinderGeometry(0.9, 0.9, 0.004, 32).translate(0, RING_Y + 0.002, 0);
  paint.add(logo, 0xc9ced6, true);
  const inner = new CylinderGeometry(0.78, 0.78, 0.004, 32).translate(0, RING_Y + 0.004, 0);
  paint.add(inner, CANVAS, true);
  // steps up to the two seat corners
  for (const [cx, cz] of [
    [1, 1],
    [-1, -1],
  ]) {
    for (let i = 0; i < 3; i++) {
      const h = (RING_Y * (i + 1)) / 3;
      const d = outer + 0.25 + (2 - i) * 0.3;
      paint.box(0.8, h, 0.3, cx * (RING_HALF - 0.6), h / 2, cz * d, 0x3a3f4a);
    }
  }
}

function postsAndRopes(paint: Painter): void {
  const corners: [number, number, number][] = [
    [1, 1, SEAT_COLOURS[0]],
    [-1, -1, SEAT_COLOURS[1]],
    [1, -1, 0xf2f4f7],
    [-1, 1, 0xf2f4f7],
  ];
  const c = RING_HALF + 0.05;
  for (const [sx, sz, colour] of corners) {
    const x = sx * c;
    const z = sz * c;
    paint.add(new CylinderGeometry(0.06, 0.06, POST_H, 8).translate(x, RING_Y + POST_H / 2, z), 0x9aa3ae);
    paint.add(new CylinderGeometry(0.075, 0.075, 0.05, 8).translate(x, RING_Y + POST_H + 0.02, z), 0x6b7480);
    // the corner pad, facing the middle, covering the ropes
    const pad = new BoxGeometry(0.34, POST_H - 0.25, 0.16).translate(0, 0, 0.1);
    const m = new Matrix4().makeRotationY(Math.atan2(-sx, -sz)).setPosition(x, RING_Y + 0.1 + (POST_H - 0.25) / 2, z);
    paint.add(pad.applyMatrix4(m), colour);
  }
  // three ropes a side, between the posts
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const rope = (a: Vector3, b: Vector3, colour: number) => {
    const d = b.clone().sub(a);
    const g = new CylinderGeometry(0.028, 0.028, d.length(), 6);
    q.setFromUnitVectors(up, d.clone().normalize());
    g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    paint.add(g, colour);
  };
  const order: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = order[i];
    const [bx, bz] = order[(i + 1) % 4];
    ROPE_HEIGHTS.forEach((h, k) => {
      rope(new Vector3(ax * c, RING_Y + h, az * c), new Vector3(bx * c, RING_Y + h, bz * c), ROPE_COLOURS[k]);
    });
    // the middle of each side ties the ropes together
    const mx = ((ax + bx) / 2) * c;
    const mz = ((az + bz) / 2) * c;
    paint.box(ax === bx ? 0.05 : 0.07, 0.86, ax === bx ? 0.07 : 0.05, mx, RING_Y + 0.85, mz, 0xf2f4f7);
  }
}

/** A square truss over the ring with lamps facing down: unlit, so they glow. */
function lights(paint: Painter): void {
  const y = 6.2;
  const r = 2.6;
  for (const s of [-1, 1]) {
    paint.box(r * 2 + 0.3, 0.2, 0.2, 0, y, s * r, 0x2a2e36);
    paint.box(0.2, 0.2, r * 2 + 0.3, s * r, y, 0, 0x2a2e36);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // a hanging cable to the dark roof
      paint.box(0.04, 6, 0.04, sx * r, y + 3.1, sz * r, 0x1b1e24);
    }
  }
  for (const t of [-0.6, 0, 0.6]) {
    for (const s of [-1, 1]) {
      for (const [x, z] of [
        [t * r, s * r],
        [s * r, t * r],
      ]) {
        paint.box(0.42, 0.18, 0.42, x, y - 0.2, z, 0x3a3f4a);
        paint.box(0.34, 0.02, 0.34, x, y - 0.3, z, 0xfff6dc, true);
      }
    }
  }
}

const SHIRTS = [0xb04848, 0xb07a3a, 0xa89a50, 0x4f86a8, 0x4560a8, 0x7d55a3, 0xa3557d, 0x9aa0a8, 0x4f9a68, 0x3a3f4a];
const SKIN = [0xc8a890, 0xb08a6c, 0x9a6e4c, 0x6e4a32, 0xd0b8a0];
const CROWD_ROWS = 6;
const ROW_DEPTH = 0.9;
const ROW_RISE = 0.42;
const FIRST_ROW = RING_HALF + APRON + 2.2;

/** The ring's crowd (task 19): the instanced fans, their rest poses, and whose fans each is. */
export interface RingCrowd extends CrowdFans {
  /** Fan i's seat: seat 1's fans fill the half behind its corner (+z, as laid out), seat 2's the other half. */
  sideOf: (i: number) => Seat;
}

/** Whose fan sits at arena z: seat 1's boxer stands at +z in the ring's own frame. */
export const ringSide = (z: number): Seat => (z >= 0 ? 0 : 1);

/** Rows of seats on four sides: raised steps in the static mesh, the people instanced. */
function crowd(arena: Group, paint: Painter): RingCrowd {
  const rand = rng(31);
  const spots: { x: number; y: number; z: number; facing: number }[] = [];
  for (let side = 0; side < 4; side++) {
    const facing = (side * Math.PI) / 2;
    const m = new Matrix4().makeRotationY(facing);
    for (let row = 0; row < CROWD_ROWS; row++) {
      const dist = FIRST_ROW + row * ROW_DEPTH;
      const y = row * ROW_RISE;
      const half = dist - 0.2;
      // the step this row sits on (in the ring's +z side's frame, then turned)
      if (row > 0) paint.add(new BoxGeometry(half * 2 + ROW_DEPTH * 2, y, ROW_DEPTH).translate(0, y / 2, dist).applyMatrix4(m), row % 2 ? 0x22252c : 0x262a32);
      for (let x = -half + 0.4; x <= half - 0.4; x += 0.62) {
        if (rand() < 0.12) continue;
        const p = new Vector3(x + (rand() - 0.5) * 0.1, y, dist).applyMatrix4(m);
        spots.push({ x: p.x, y: p.y, z: p.z, facing: facing + Math.PI + (rand() - 0.5) * 0.4 });
      }
    }
  }
  const n = spots.length;
  const bodies = new InstancedMesh(new BoxGeometry(0.42, 0.55, 0.3), new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
  const heads = new InstancedMesh(new IcosahedronGeometry(0.16, 0), new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
  const o = new Object3D();
  const colour = new Color();
  const restBody: Matrix4[] = [];
  const restHead: Matrix4[] = [];
  spots.forEach((s, i) => {
    const bob = (rand() - 0.5) * 0.08;
    o.position.set(s.x, s.y + 0.55 + bob, s.z);
    o.rotation.set(0, s.facing, 0);
    o.scale.set(0.9 + rand() * 0.2, 1, 1);
    o.updateMatrix();
    bodies.setMatrixAt(i, o.matrix);
    restBody.push(o.matrix.clone());
    o.position.y = s.y + 0.98 + bob;
    o.scale.set(1, 1, 1);
    o.updateMatrix();
    heads.setMatrixAt(i, o.matrix);
    restHead.push(o.matrix.clone());
    // task 19: a share of each half wears its boxer's corner colour, so the sides read apart
    const shirt = rand() < 0.3 ? SEAT_COLOURS[ringSide(s.z)] : SHIRTS[Math.floor(rand() * SHIRTS.length)];
    bodies.setColorAt(i, colour.setHex(shirt));
    heads.setColorAt(i, colour.setHex(SKIN[Math.floor(rand() * SKIN.length)]));
  });
  bodies.name = "crowd-bodies";
  heads.name = "crowd-heads";
  arena.add(bodies, heads);
  const sides = spots.map((s) => ringSide(s.z));
  // a low barrier between the ring and the first row
  for (let side = 0; side < 4; side++) {
    const m = new Matrix4().makeRotationY((side * Math.PI) / 2);
    const d = FIRST_ROW - 0.7;
    paint.add(new BoxGeometry(d * 2, 0.8, 0.08).translate(0, 0.4, d).applyMatrix4(m), 0x2b3242);
    paint.add(new BoxGeometry(d * 2, 0.05, 0.1).translate(0, 0.82, d).applyMatrix4(m), 0x55607a, true);
  }
  return { bodies, heads, restBody, restHead, sideOf: (i) => sides[i] };
}

/** The ring and arena, lights included, in one group (turn it with `rotation.y` for seat 1), and its crowd. */
export function buildRing(scene: Scene): { arena: Group; crowd: RingCrowd } {
  scene.background = new Color(0x0b0c10);
  scene.fog = new Fog(0x0b0c10, 9, 22);
  const arena = new Group();
  const paint = new Painter();
  platform(paint);
  postsAndRopes(paint);
  lights(paint);
  const fans = crowd(arena, paint);
  paint.build(arena);
  scene.add(arena);
  return { arena, crowd: fans };
}
