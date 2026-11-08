import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector2,
} from "three";
import type { BufferGeometry, Scene } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BEND_Y, HEAD_PIN_Y, LANE, PIN, PIN_SPOTS, PIT_Y } from "../../../shared/games/bowling/sim.ts";
import type { CrowdLayout, CrowdSeat } from "../tennis/crowd-layout.ts";
import { rng } from "../tennis/crowd-layout.ts";
import { PALETTE, Painter, crowdMeshes } from "../tennis/stadium.ts";
import type { CrowdHandle } from "../tennis/stadium.ts";
import { createCrowdMotion } from "../tennis/crowd-motion.ts";

// The bowling alley (task 29), from primitives like tennis's arena: the
// static parts are painted with vertex colours and merged into two meshes
// (tennis's Painter), the lanes share one textured mesh, the crowd behind
// the approach is tennis's instanced crowd (crowdMeshes) on a seating layout
// of its own. World frame: x across the lane (+x the bowler's right), y up,
// and the lane runs away from the camera along -z, so a lane point (x, y)
// from the sim is the world point (x, 0, -y).

const W = LANE.width;
const G = LANE.gutter;
/** Capping between two lanes' gutters. */
const CAP = 0.2;
/** Centre to centre of two neighbouring lanes. */
export const LANE_PITCH = W + 2 * G + CAP;
/** Lanes each side of ours, for the look of a full house. */
const NEIGHBOURS = 3;
const HALL_HALF = (NEIGHBOURS + 0.5) * LANE_PITCH + 0.6;
/** The approach behind the foul line, and the seating behind it. */
const APPROACH = 4.6;
const SEATING_Z = APPROACH + 0.8;
const CEILING = 3.4;
/** Where the masking unit (the panel over the pins) hangs. */
const MASK_Z = -(HEAD_PIN_Y - 0.9);
const MASK_BOTTOM = 0.75;

const WOOD = 0xd9ad74;
const WOOD_DARK = 0xc29058;

/** A pin's outline, turned (radius, height) in metres: 38.1 cm tall, 12.1 cm across at the belly. */
const PIN_PROFILE = [
  [0, 0],
  [0.026, 0],
  [0.045, 0.05],
  [0.06, 0.115],
  [0.056, 0.17],
  [0.036, 0.232],
  [0.022, 0.262],
  [0.026, 0.3],
  [0.031, 0.335],
  [0.025, 0.368],
  [0, 0.381],
] as const;
export const PIN_HEIGHT = 0.381;

export function pinGeometry(): BufferGeometry {
  return new LatheGeometry(PIN_PROFILE.map(([r, y]) => new Vector2(r * (PIN.radius / 0.06), y)), 8);
}

/** A pin you can stand or lay down: white, two red neck stripes; its origin at its foot. */
export function makePin(): Group {
  const g = new Group();
  const body = new Mesh(pinGeometry(), new MeshLambertMaterial({ color: 0xf7f5ef, flatShading: true }));
  const stripe = new Mesh(new CylinderGeometry(0.025, 0.027, 0.018, 8, 1, true), new MeshLambertMaterial({ color: 0xd8262c, flatShading: true }));
  stripe.position.y = 0.282;
  const stripe2 = stripe.clone();
  stripe2.position.y = 0.252;
  stripe2.scale.setScalar(0.92);
  g.add(body, stripe, stripe2);
  return g;
}

/** The lane's boards, arrows and dots, painted once into a texture (along the canvas's height, foul line at the bottom). */
function laneTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 2048;
  const g = c.getContext("2d")!;
  const len = PIT_Y;
  const py = (y: number) => c.height - (y / len) * c.height;
  const boards = 39;
  for (let b = 0; b < boards; b++) {
    g.fillStyle = b % 2 ? "#dcb27a" : "#d3a56c";
    g.fillRect((b / boards) * c.width, 0, c.width / boards + 1, c.height);
  }
  // the pin deck: a paler, worn patch under the pins
  g.fillStyle = "#e9cf9f";
  g.fillRect(0, py(PIT_Y), c.width, py(HEAD_PIN_Y - 0.25) - py(PIT_Y));
  const board = (n: number) => ((n - 0.5) / boards) * c.width;
  // the dots at 7 ft and the arrows at 15 ft, on every fifth board from each side
  g.fillStyle = "#4a2a14";
  for (const n of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
    g.beginPath();
    g.arc(board(n), py(2.13), 1.6, 0, Math.PI * 2);
    g.fill();
  }
  for (const n of [5, 10, 15, 20, 25, 30, 35]) {
    // the middle arrow sits furthest up the lane, the outer ones nearer: a "V"
    const y = 4.57 + Math.abs(n - 20) * -0.06;
    const x = board(n);
    g.beginPath();
    g.moveTo(x, py(y + 0.32));
    g.lineTo(x - 2.4, py(y));
    g.lineTo(x + 2.4, py(y));
    g.closePath();
    g.fill();
  }
  // a faint line where the ball starts to bend (none on a real lane; it's the oil's end)
  g.fillStyle = "#c79a5f";
  g.fillRect(0, py(BEND_Y), c.width, 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The lit sign over the masking units: the brand in neon. */
function neonTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0d1f";
  g.fillRect(0, 0, c.width, c.height);
  g.font = "bold 76px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 28;
  g.strokeStyle = "#ff8be6";
  g.lineWidth = 5;
  g.strokeText("WEBLYMPICS LANES", c.width / 2, c.height / 2 + 4);
  g.shadowBlur = 10;
  g.fillStyle = "#ffe3f8";
  g.fillText("WEBLYMPICS LANES", c.width / 2, c.height / 2 + 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The seating behind the approach: tiers of benches facing down the lanes, split down a middle aisle. */
export function seatingLayout(seed = 7): CrowdLayout {
  const rand = rng(seed);
  const left: CrowdSeat[] = [];
  const right: CrowdSeat[] = [];
  for (let tier = 0; tier < 3; tier++) {
    const z = SEATING_Z + 0.4 + tier * 0.9;
    const y = 0.25 + tier * 0.45;
    for (let x = -HALL_HALF + 0.8; x < HALL_HALF - 0.8; x += 0.62) {
      if (Math.abs(x) < 0.7 || rand() > 0.7) continue;
      const seat: CrowdSeat = { section: x < 0 ? "left" : "right", x, y, z, facing: Math.PI, tier };
      (x < 0 ? left : right).push(seat);
    }
  }
  return {
    seats: [...left, ...right],
    ranges: { left: { start: 0, count: left.length }, right: { start: left.length, count: right.length }, frontLeft: { start: 0, count: 0 }, frontRight: { start: 0, count: 0 } },
  };
}

export interface Alley {
  crowd: CrowdHandle;
  /** Crowd reaction now: "cheer" jumps, "groan" slumps; eases out over about two seconds. */
  react(kind: "cheer" | "groan"): void;
  /** Moves the crowd for this frame. */
  update(dt: number): void;
}

export function buildAlley(scene: Scene, reduced: () => boolean = () => matchMedia("(prefers-reduced-motion: reduce)").matches): Alley {
  const hall = new Group();
  hall.add(new HemisphereLight(0xfff1e0, 0x2a2440, 1.4));
  const key = new DirectionalLight(0xfff6e8, 1.6);
  key.position.set(2, 8, 4);
  const deck = new DirectionalLight(0xffffff, 0.9);
  deck.position.set(0, 4, -HEAD_PIN_Y + 4);
  deck.target.position.set(0, 0, -HEAD_PIN_Y);
  hall.add(key, deck, deck.target);

  const paint = new Painter();
  const len = PIT_Y;
  const midZ = -len / 2;

  // the lanes: one textured plane per lane, merged
  const lanes: BufferGeometry[] = [];
  for (let k = -NEIGHBOURS; k <= NEIGHBOURS; k++) {
    const ox = k * LANE_PITCH;
    lanes.push(new PlaneGeometry(W, len).rotateX(-Math.PI / 2).translate(ox, 0, midZ));
    // gutters: a channel each side, along the whole lane, a little below it
    for (const s of [-1, 1]) {
      const gx = ox + s * (W / 2 + G / 2);
      paint.box(G, 0.02, len, gx, -0.06, midZ, 0x8a939e);
      paint.box(0.02, 0.06, len, gx - s * (G / 2 - 0.01), -0.03, midZ, 0xa3acb6);
      // the capping between lanes
      paint.box(CAP, 0.06, len, ox + s * (W / 2 + G + CAP / 2), 0.03, midZ, 0x3a3f4c);
      // the kickbacks: side walls beside the pin deck
      paint.box(0.05, 0.55, PIT_Y - HEAD_PIN_Y + 1.2, ox + s * (W / 2 + G + 0.025), 0.27, -(HEAD_PIN_Y + (PIT_Y - HEAD_PIN_Y) / 2) + 0.2, 0x2b2f3d);
    }
    // the foul line and the approach's dots
    paint.box(W + 2 * G, 0.004, 0.025, ox, 0.002, 0, 0x22252c);
    // the pit behind the deck, and its dark back
    paint.box(W + 2 * G, 0.02, 0.9, ox, -0.25, -(PIT_Y + 0.45), 0x101218);
    // the masking unit's coloured face, one of the ring colours each
    const ring = [PALETTE.blue, PALETTE.yellow, PALETTE.green, PALETTE.red][(k + 8) % 4];
    paint.box(W + 2 * G, 0.12, 0.02, ox, MASK_BOTTOM + 0.12, MASK_Z + 0.03, ring, true);
    // the neighbours' pins stand still: a full rack each, merged
    if (k !== 0) for (const p of PIN_SPOTS) paint.add(pinGeometry().translate(ox + p.x, 0, -p.y), 0xf7f5ef);
    // a ball return between every other pair of lanes, by the approach
    if (k % 2 === 0) {
      const rx = ox - LANE_PITCH / 2;
      paint.box(0.55, 0.42, 1.1, rx, 0.21, 2.4, 0x2f3a6b);
      paint.box(0.6, 0.08, 1.15, rx, 0.45, 2.4, 0x5a6bc4);
      paint.add(new CylinderGeometry(0.05, 0.05, 1.6, 6).rotateX(Math.PI / 2).translate(rx - 0.15, 0.48, 1.1), 0xb8c0cc);
      paint.add(new CylinderGeometry(0.05, 0.05, 1.6, 6).rotateX(Math.PI / 2).translate(rx + 0.15, 0.48, 1.1), 0xb8c0cc);
      // a ball or two waiting on it
      paint.add(new CylinderGeometry(0.1, 0.1, 0.2, 10).rotateZ(Math.PI / 2).translate(rx, 0.6, 1.6), [0x7048e8, 0xe8590c, 0x0c8599][(k + 8) % 3]);
    }
  }
  const laneMesh = new Mesh(mergeGeometries(lanes), new MeshLambertMaterial({ map: laneTexture() }));
  hall.add(laneMesh);

  // the approach: wide boards behind the foul line, then the carpet by the seats
  paint.box(HALL_HALF * 2, 0.04, APPROACH, 0, -0.02, APPROACH / 2, WOOD_DARK);
  for (let i = 0; i < 18; i++) paint.box(HALL_HALF * 2, 0.002, 0.012, 0, 0.001, 0.25 + i * 0.25, WOOD);
  paint.box(HALL_HALF * 2, 0.04, 6, 0, -0.02, SEATING_Z + 2.6, 0x3b2a5c);
  // the seating: three tiers of benches
  for (let tier = 0; tier < 3; tier++) {
    const z = SEATING_Z + 0.4 + tier * 0.9;
    const y = 0.25 + tier * 0.45;
    paint.box(HALL_HALF * 2 - 1, y, 0.9, 0, y / 2, z + 0.1, 0x2c2f45);
    paint.box(HALL_HALF * 2 - 1.2, 0.08, 0.45, 0, y + 0.04, z, [PALETTE.blue, PALETTE.red, PALETTE.green][tier]);
  }

  // walls, ceiling and the masking units' dark band over the pins
  paint.box(0.2, CEILING, len + APPROACH + 10, -HALL_HALF - 0.1, CEILING / 2, -len / 2 + 4, 0x23203a);
  paint.box(0.2, CEILING, len + APPROACH + 10, HALL_HALF + 0.1, CEILING / 2, -len / 2 + 4, 0x23203a);
  paint.box(HALL_HALF * 2, CEILING, 0.2, 0, CEILING / 2, -(PIT_Y + 1), 0x15131f);
  paint.box(HALL_HALF * 2, CEILING, 0.2, 0, CEILING / 2, SEATING_Z + 5.6, 0x23203a);
  paint.box(HALL_HALF * 2, 0.1, len + APPROACH + 10, 0, CEILING, -len / 2 + 4, 0x1a1828);
  paint.box(HALL_HALF * 2, CEILING - MASK_BOTTOM, 0.1, 0, MASK_BOTTOM + (CEILING - MASK_BOTTOM) / 2, MASK_Z - 0.03, 0x161a33);
  // ceiling light strips down the hall, and neon tubes along the side walls
  for (let k = -NEIGHBOURS; k <= NEIGHBOURS; k++) paint.box(0.08, 0.02, len, k * LANE_PITCH + LANE_PITCH / 2, CEILING - 0.06, midZ, 0xfff7e0, true);
  const neon = [0xff4fd8, 0x4fc3ff, 0xfcb131];
  for (const s of [-1, 1]) {
    neon.forEach((c, i) => paint.box(0.03, 0.04, len * 0.8, s * (HALL_HALF - 0.02), 1.6 + i * 0.35, midZ, c, true));
  }
  // a neon pin outline either side of the sign
  const m = new Matrix4();
  for (const s of [-1, 1]) {
    const o = new Object3D();
    o.position.set(s * 3.4, 2.35, MASK_Z + 0.06);
    o.updateMatrix();
    m.copy(o.matrix);
    paint.box(0.04, 0.6, 0.02, -0.08, 0, 0, 0xff4fd8, true, m);
    paint.box(0.04, 0.6, 0.02, 0.08, 0, 0, 0xff4fd8, true, m);
    paint.box(0.2, 0.04, 0.02, 0, 0.3, 0, 0xff4fd8, true, m);
    paint.box(0.2, 0.04, 0.02, 0, -0.3, 0, 0xff4fd8, true, m);
  }
  paint.build(hall);

  // the brand sign in neon over our lane's masking unit
  const sign = new Mesh(new PlaneGeometry(4.2, 0.52), new MeshBasicMaterial({ map: neonTexture() }));
  sign.position.set(0, 2.35, MASK_Z + 0.05);
  hall.add(sign);
  scene.add(hall);

  const crowd = crowdMeshes(hall, seatingLayout());
  // task 19: the onlookers back nobody; they jump for a strike or spare and
  // slump and shake their heads at a gutter, holding the pose under reduced motion
  const motion = createCrowdMotion(crowd, () => null, reduced);
  let clock = 0;

  return {
    crowd,
    react(kind) {
      motion.react([{ side: null, kind: kind === "cheer" ? "cheer" : "aww", size: 1 }], clock);
    },
    update(dt) {
      clock += dt;
      motion.update(clock);
    },
  };
}

/** A ball, low-poly and flat-shaded, in `colour`, with three finger holes on top; its origin at its centre. */
export function makeBall(colour: number, radius: number): Group {
  const g = new Group();
  g.add(new Mesh(new IcosahedronGeometry(radius, 1), new MeshLambertMaterial({ color: colour, flatShading: true })));
  const hole = new MeshBasicMaterial({ color: 0x111111 });
  for (const [x, z] of [[-0.025, -0.02], [0.025, -0.02], [0, 0.035]]) {
    const h = new Mesh(new CircleGeometry(radius * 0.13, 6), hole);
    h.rotation.x = -Math.PI / 2;
    h.position.set(x, radius * 0.995, z);
    g.add(h);
  }
  return g;
}
