// The archery range (task 22; dressed up in task 31): mown grass, a tree line
// and low hills, target butts in the other lanes, a wooden shooting line,
// flags that stream with the real wind and a small stand of spectators who
// cheer a 10 or a bullseye. Built from primitives like tennis's stadium:
// static parts are merged by its Painter (two draw calls), the trees, flags
// and crowd are instanced. Flat-shaded, nothing loaded.
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  BoxGeometry,
} from "three";
import { RINGS, STAGES, TARGET } from "../../../shared/games/archery/sim.ts";
import type { Wind } from "../../../shared/games/archery/sim.ts";
import { rng } from "../tennis/crowd-layout.ts";
import type { CrowdLayout, CrowdSeat } from "../tennis/crowd-layout.ts";
import { PALETTE, Painter, crowd } from "../tennis/stadium.ts";
import type { CrowdHandle } from "../tennis/stadium.ts";
import { flagFly } from "./cues.ts";
import { createCrowdMotion } from "../tennis/crowd-motion.ts";
import type { CrowdKind, Size } from "../../audio/crowd.ts";

/** Ring colours from the outside in, in pairs: white, black, blue, red, gold. */
export const RING_COLOURS = [0xf5f5f5, 0xf5f5f5, 0x222222, 0x222222, 0x2f8be0, 0x2f8be0, 0xe03131, 0xe03131, 0xffd43b, 0xffd43b];

const lambert = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

/** The target face with its stand, its face centred at the origin facing +z. */
export function makeTarget(): Group {
  const g = new Group();
  const ring = TARGET.radius / RINGS;
  for (let i = 0; i < RINGS; i++) {
    const outer = TARGET.radius - i * ring;
    const geo = i === RINGS - 1 ? new CircleGeometry(outer, 32) : new RingGeometry(outer - ring, outer, 32);
    const m = new Mesh(geo, new MeshLambertMaterial({ color: RING_COLOURS[i] }));
    m.position.z = 0.002 * i;
    g.add(m);
  }
  // straw boss behind the face
  const boss = new Mesh(new CylinderGeometry(TARGET.radius * 1.15, TARGET.radius * 1.15, 0.3, 20), lambert(0xc9a25a));
  boss.rotation.x = Math.PI / 2;
  boss.position.z = -0.16;
  g.add(boss);
  const legMat = lambert(0x6b4f33);
  for (const sx of [-1, 1]) {
    const leg = new Mesh(new BoxGeometry(0.08, TARGET.centerY + 0.7, 0.08), legMat);
    leg.position.set(sx * 0.45, -TARGET.centerY / 2 + 0.05, -0.35);
    leg.rotation.x = -0.18;
    g.add(leg);
  }
  return g;
}

/** The flags stand on poles either side of the lane, this far out. */
const FLAG_X = 4.2;
const POLE_H = 4.2;
/** The spectators' stand: down the left of the range, facing it. */
const STAND = { x: -9, z0: -20, z1: -36, rows: 4, depth: 1, rise: 0.5 } as const;

export interface Range {
  /** The flags stream with this wind; `t` seconds, for the ripple. */
  setWind(w: Wind, t: number): void;
  /** The onlookers react (task 19): jump for a 10 or the bullseye, clap for a good arrow, slump at a miss. */
  react(kind: CrowdKind, size: Size): void;
  /** Animates the crowd; `dt` seconds. */
  update(dt: number): void;
  /** True while the crowd is reacting. */
  cheering(): boolean;
}

function sky(scene: Scene, paint: Painter, farthest: number): void {
  // a plain clear colour: a gradient texture behind everything costs a whole
  // screen of texture reads a frame on the software renderer
  scene.background = new Color(0x8fcaf5);

  // low rolling hills behind the tree line, two greens and a far blue-green
  const rand = rng(17);
  for (let i = 0; i < 9; i++) {
    const h = new IcosahedronGeometry(1, 1);
    h.scale(26 + rand() * 18, 7 + rand() * 7, 16);
    h.translate(-110 + i * 28 + rand() * 8, -2, -farthest - 60 - rand() * 25);
    // unlit: far away, and a lit hill costs a lot of pixels on a software renderer
    paint.add(h, [0x7fae6a, 0x6f9f61, 0x8ab68a][i % 3], true);
  }
  for (const s of [-1, 1]) {
    const h = new IcosahedronGeometry(1, 1);
    h.scale(22, 6, 50);
    h.translate(s * 70, -1.5, -farthest / 2 - 10);
    paint.add(h, 0x76a865, true);
  }

  // a few soft clouds: clusters of flattened puffs, unlit, in the merged mesh
  for (let c = 0; c < 6; c++) {
    const cx = (rand() - 0.5) * 160;
    const cy = 28 + rand() * 14;
    const cz = -farthest - 60 - rand() * 40;
    for (let p = 0; p < 5; p++) {
      const sc = 2.6 + rand() * 2.4;
      const puff = new IcosahedronGeometry(1, 1).scale(sc * 1.4, sc * 0.7, sc);
      puff.translate(cx + (p - 2) * 3.4 + rand() * 2, cy + rand() * 1.5, cz + rand() * 3);
      paint.add(puff, p % 2 ? 0xf4f8fb : 0xe6eef5, true);
    }
  }
}

function ground(paint: Painter, farthest: number): void {
  // One mown field: bands across it every two metres out past the targets,
  // then plain grass to the horizon. Flat quads in the unlit merged mesh (no
  // texture, no lighting), so no pixel of grass is read from a texture or
  // lit, the software renderer's biggest cost on a screen that is mostly grass.
  const W = 300;
  const flat = (w: number, d: number, x: number, z: number, colour: number) =>
    paint.add(new PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, -0.01, z), colour, true);
  const near = 12;
  const far = -farthest - 30;
  for (let z = near, k = 0; z > far; z -= 2, k++) flat(W, 2, 0, z - 1, k % 2 ? 0x63b047 : 0x6fbf52);
  flat(W, 200, 0, far - 100, 0x5ea843);
  flat(W, 100, 0, near + 50, 0x5ea843);
  // the shooting lane a touch paler, and white distance lines across it every 10 m
  for (let d = 10; d <= farthest; d += 10) paint.box(6, 0.01, 0.08, 0, 0.002, -d, 0xf4f6f0, true);
  paint.box(0.06, 0.01, farthest, -3, 0.002, -farthest / 2, 0xe8eee0, true);
  paint.box(0.06, 0.01, farthest, 3, 0.002, -farthest / 2, 0xe8eee0, true);
}

/** The wooden shooting line: a plank across the range in front of the archers, a deck behind, a bench and quiver stands. */
function shootingLine(paint: Painter): void {
  const wood = 0xa8743f;
  const dark = 0x7a5230;
  // the line itself: a long low plank, white-painted top edge
  paint.box(14, 0.1, 0.16, 0, 0.05, -0.45, wood);
  paint.box(14, 0.02, 0.17, 0, 0.11, -0.45, 0xf8f9fa, true);
  for (let x = -7; x <= 7; x += 1.75) paint.box(0.12, 0.14, 0.2, x, 0.07, -0.45, dark);
  // a deck of boards behind the line, where the archers stand and wait
  for (let i = 0; i < 9; i++) paint.box(14, 0.04, 0.3, 0, 0.02, 0.2 + i * 0.32, i % 2 ? wood : 0xb3804a);
  // a bench and two ground quivers (a stake with arrows in the five colours)
  paint.box(2, 0.08, 0.4, -3.6, 0.45, 2.4, wood);
  for (const x of [-4.4, -2.8]) paint.box(0.08, 0.45, 0.36, x, 0.22, 2.4, dark);
  const colours = [PALETTE.blue, PALETTE.yellow, PALETTE.red, PALETTE.green];
  for (const x of [-5.4, 5.4]) {
    paint.add(new CylinderGeometry(0.04, 0.04, 0.9, 6).translate(x, 0.45, 0.6), dark);
    paint.add(new CylinderGeometry(0.09, 0.07, 0.4, 8).translate(x, 0.6, 0.6), PALETTE.black);
    colours.forEach((c, i) => paint.add(new ConeGeometry(0.03, 0.12, 3).translate(x - 0.045 + (i % 2) * 0.09, 0.86, 0.6 - 0.04 + Math.floor(i / 2) * 0.08), c));
  }
  // number boards on posts at each end of the line
  for (const s of [-1, 1]) {
    paint.box(0.08, 1.2, 0.08, s * 6.6, 0.6, -0.45, dark);
    paint.box(0.6, 0.45, 0.05, s * 6.6, 1.3, -0.45, s < 0 ? PALETTE.blue : PALETTE.red);
  }
}

/** Target butts in the lanes either side, at the other distances: painted bosses with a small face. */
function butts(paint: Painter, farthest: number): void {
  const bossColours = [PALETTE.blue, PALETTE.red, PALETTE.green, PALETTE.yellow, 0xc9a25a];
  const faces = [0xf5f5f5, 0x222222, 0x2f8be0, 0xe03131, 0xffd43b];
  const spots: Array<[number, number]> = [];
  STAGES.forEach((s, i) => {
    if (s.distance > farthest) return;
    spots.push([i % 2 ? 9 : -9, -s.distance]);
    if (i % 3 === 0) spots.push([i % 2 ? -14 : 14, -s.distance - 2]);
  });
  spots.forEach(([x, z], i) => {
    const y = TARGET.centerY;
    const r = TARGET.radius * 1.1;
    paint.box(r * 2, r * 2, 0.35, x, y, z - 0.2, bossColours[i % bossColours.length]);
    faces.forEach((c, k) => {
      const rr = TARGET.radius * (1 - k / faces.length);
      paint.add(new CylinderGeometry(rr, rr, 0.02, 16).rotateX(Math.PI / 2).translate(x, y, z + 0.0 + k * 0.012), c, true);
    });
    for (const sx of [-1, 1]) paint.box(0.09, y + 0.6, 0.09, x + sx * 0.5, (y + 0.6) / 2 - 0.2, z - 0.5, 0x6b4f33);
  });
}

function trees(group: Group, farthest: number): void {
  // pines and round trees either side and a thicker line behind the targets
  const rand = rng(23);
  const spots: Array<[number, number, number]> = [];
  for (let z = 4; z >= -farthest - 14; z -= 6) {
    for (const s of [-1, 1]) spots.push([s * (17 + rand() * 7), z + rand() * 2, rand()]);
  }
  for (let x = -40; x <= 40; x += 4.5) spots.push([x + rand(), -farthest - 14 - rand() * 8, rand()]);
  const pines = spots.filter((s) => s[2] < 0.6);
  const rounds = spots.filter((s) => s[2] >= 0.6);
  const o = new Object3D();
  const trunks = new InstancedMesh(new CylinderGeometry(0.18, 0.26, 1.6, 6), lambert(0x6b4a2f), spots.length);
  const cones = new InstancedMesh(new ConeGeometry(1.5, 4.2, 7), lambert(0x2f7a3a), pines.length);
  const balls = new InstancedMesh(new IcosahedronGeometry(1.6, 0), lambert(0x4a9a45), rounds.length);
  const put = (mesh: InstancedMesh, i: number, x: number, y: number, z: number, s: number) => {
    o.position.set(x, y * s, z);
    o.scale.setScalar(s);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  };
  let t = 0;
  pines.forEach(([x, z], i) => {
    const s = 0.9 + rand() * 0.8;
    put(trunks, t++, x, 0.8, z, s);
    put(cones, i, x, 3.6, z, s);
  });
  rounds.forEach(([x, z], i) => {
    const s = 0.8 + rand() * 0.6;
    put(trunks, t++, x, 0.8, z, s);
    put(balls, i, x, 2.8, z, s);
  });
  group.add(trunks, cones, balls);
}

/** A pennant, hoist on the pole (local x = 0), flying along local +x. */
function pennant(): BufferGeometry {
  const g = new BufferGeometry();
  // two triangles so it bends a little along its length
  g.setAttribute("position", new Float32BufferAttribute([0, 0.32, 0, 0, -0.32, 0, 0.7, 0, 0.04, 0.7, 0, 0.04, 0, 0.32, 0, 1.3, 0.02, 0], 3));
  g.computeVertexNormals();
  return g;
}

function flags(group: Group, paint: Painter, farthest: number): (w: Wind, t: number) => void {
  const spots: Array<[number, number]> = [];
  for (let d = 5; d <= farthest; d += 10) for (const s of [-1, 1]) spots.push([s * FLAG_X, -d]);
  const colours = [PALETTE.yellow, PALETTE.red, PALETTE.blue, PALETTE.green, 0xffffff];
  for (const [x, z] of spots) {
    paint.add(new CylinderGeometry(0.035, 0.05, POLE_H, 6).translate(x, POLE_H / 2, z), 0xe9ecef);
    paint.add(new IcosahedronGeometry(0.07, 0).translate(x, POLE_H + 0.04, z), PALETTE.yellow);
  }
  const mesh = new InstancedMesh(pennant(), new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide, flatShading: true }), spots.length);
  const colour = new Color();
  spots.forEach((_, i) => mesh.setColorAt(i, colour.setHex(colours[i % colours.length])));
  mesh.name = "range-flags";
  group.add(mesh);
  const o = new Object3D();
  o.rotation.order = "YZX";
  return (w, t) => {
    const f = flagFly(w);
    const heading = Math.atan2(-f.dz, f.dx);
    spots.forEach(([x, z], i) => {
      const phase = t * f.rate + i * 1.7;
      o.position.set(x, POLE_H - 0.34, z);
      // y turns the fly to the wind, z lifts it from hanging, x flaps it about its length
      o.rotation.set(Math.sin(phase) * f.ripple * 3, heading, -(Math.PI / 2 - f.lift) + Math.sin(phase * 0.7) * f.ripple);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}

/** The stand's seats: a crowd layout in tennis's shape (all one section), for its instanced crowd. */
export function standLayout(): CrowdLayout {
  const rand = rng(61);
  const seats: CrowdSeat[] = [];
  for (let row = 0; row < STAND.rows; row++) {
    for (let z = STAND.z0 - 0.4; z > STAND.z1 + 0.4; z -= 0.62) {
      if (rand() > 0.85) continue;
      // facing the range (+x): the crowd's rotation is about y
      seats.push({ section: "left", x: STAND.x - row * STAND.depth - 0.5, y: (row + 1) * STAND.rise, z, facing: Math.PI / 2, tier: row });
    }
  }
  const none = { start: seats.length, count: 0 };
  return { seats, ranges: { left: { start: 0, count: seats.length }, right: none, frontLeft: none, frontRight: none } };
}

function stand(paint: Painter): void {
  const len = STAND.z0 - STAND.z1;
  const mid = (STAND.z0 + STAND.z1) / 2;
  const riser = [0xc9d0d8, 0xdfe4ea];
  const seat = [PALETTE.blue, PALETTE.green, PALETTE.yellow, PALETTE.red];
  for (let row = 0; row < STAND.rows; row++) {
    const h = (row + 1) * STAND.rise;
    const x = STAND.x - (row + 0.5) * STAND.depth;
    paint.box(STAND.depth, h, len, x, h / 2, mid, riser[row % 2]);
    paint.box(0.36, 0.1, len - 0.1, x, h + 0.05, mid, seat[row % seat.length]);
  }
  // a rail at the front, an awning on posts, a sign
  const back = STAND.x - STAND.rows * STAND.depth;
  paint.box(0.05, 0.05, len, STAND.x + 0.05, 0.9, mid, 0xf2f5e8, true);
  for (const z of [STAND.z0, mid, STAND.z1]) paint.box(0.14, 4.6, 0.14, back, 2.3, z, 0x5b6b7b);
  const roof = new BoxGeometry(STAND.rows * STAND.depth + 1, 0.12, len + 1).rotateZ(-0.12).translate(STAND.x - (STAND.rows * STAND.depth) / 2, 4.5, mid);
  paint.add(roof, 0xf3f5f7);
  paint.box(0.1, 0.4, len + 1, STAND.x + 0.5, 4.5, mid, PALETTE.blue);
}

/** Lights, sky, ground, scenery and flags for a range out to `farthest` metres. */
export function buildRange(scene: Scene, farthest: number): Range {
  const group = new Group();
  group.add(new HemisphereLight(0xe6f4ff, 0x5a8a4a, 1.3));
  const sun = new DirectionalLight(0xfff3dc, 1.9);
  sun.position.set(8, 14, 6);
  group.add(sun);
  const paint = new Painter();
  sky(scene, paint, farthest);
  ground(paint, farthest);
  shootingLine(paint);
  butts(paint, farthest);
  stand(paint);
  const setFlags = flags(group, paint, farthest);
  trees(group, farthest);
  paint.build(group);
  const fans: CrowdHandle = crowd(group, standLayout());
  scene.add(group);

  // task 19: the onlookers back nobody; each on their own beat, holding the pose under reduced motion
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const motion = createCrowdMotion(fans, () => null, () => reducedMotion.matches);
  let clock = 0;
  return {
    setWind: setFlags,
    react(kind, size) {
      motion.react([{ side: null, kind, size }], clock);
    },
    cheering: () => motion.state(null) !== "",
    update(dt) {
      clock += dt;
      motion.update(clock);
    },
  };
}
