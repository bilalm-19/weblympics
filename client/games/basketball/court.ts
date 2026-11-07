import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import type { Scene } from "three";
import { BOARD, RIM, SPOTS, spotPosition } from "../../../shared/games/basketball/sim.ts";
import { rng, standSeats } from "../tennis/crowd-layout.ts";
import type { CrowdLayout, CrowdSeat, Stand, Tiers } from "../tennis/crowd-layout.ts";
import { PALETTE, Painter, plantTrees, seatCrowd, sky } from "../tennis/stadium.ts";
import type { CrowdHandle } from "../tennis/stadium.ts";

// Basketball's park court (task 32), from primitives like tennis's stadium:
// the static parts painted with vertex colours and merged into one lit and
// one unlit mesh, the crowd and trees instanced (tennis's own pieces:
// `seatCrowd`, `standSeats`, `plantTrees`, `sky`). Asphalt, painted lines and
// the arc, one hoop with a backboard and a chain net, a chain-link fence,
// trees, sky, and aluminium bleachers along both sidelines whose fans jump on
// a make and slump on a miss. No shadows, no post-processing.
//
// The sim's axes: the rim's centre at (0, RIM.y, 0), +z out from the board
// towards the shooters, +x to the shooter's right, the board's face at
// z = BOARD.z.

/** The baseline is this far behind the rim's centre (a real court: 1.575 m). */
export const BASELINE_Z = -1.575;
/** The half-court line, 14 m from the baseline. */
export const HALFCOURT_Z = BASELINE_Z + 14;
/** Half the court's width (a real court is 15 m). */
export const HALF_W = 7.5;
/** The three-point arc's radius and the corner lines' x. */
const ARC_R = 6.75;
const CORNER_X = 6.6;
/** The free-throw line (just in front of the free-throw spot) and the lane's half width. */
const FT_Z = SPOTS[0].distance - 0.25;
const LANE_HALF = 2.45;

const ASPHALT = 0x4a4f57;
const ASPHALT_EDGE = 0x3c4047;
const LANE = 0x2f6fb5;
const LINE = 0xf4f4f0;
const RIM_COLOUR = 0xff6a1a;

/** The bleachers: low aluminium steps, a stand along each sideline. */
const BLEACHER: Tiers = { tiers: 5, depth: 0.75, rise: 0.4, wall: 0.05 };
const STAND_GAP = 1.6;
const STAND_LENGTH = 13;
const STAND_Z = (BASELINE_Z + HALFCOURT_Z) / 2 - 0.4;
export const STANDS: Record<"left" | "right", Stand> = {
  left: { x: -(HALF_W + STAND_GAP), z: STAND_Z, length: STAND_LENGTH, angle: Math.PI / 2, aisles: [0] },
  right: { x: HALF_W + STAND_GAP, z: STAND_Z, length: STAND_LENGTH, angle: -Math.PI / 2, aisles: [0] },
};
/** The fence round the park: x = ±FENCE_X, and z from FENCE_BACK to FENCE_FRONT. */
const FENCE_X = HALF_W + STAND_GAP + BLEACHER.tiers * BLEACHER.depth + 1.4;
const FENCE_BACK = BASELINE_Z - 3;
const FENCE_FRONT = HALFCOURT_Z + 4;
const FENCE_H = 3.4;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A flat painted line on the asphalt from (x0, z0) to (x1, z1). */
function line(paint: Painter, x0: number, z0: number, x1: number, z1: number, w = 0.06): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const m = new Matrix4().makeRotationY(Math.atan2(x1 - x0, z1 - z0));
  m.setPosition((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
  paint.box(w, 0.012, len, 0, 0, 0, LINE, true, m);
}

/** An arc of painted line, centre (cx, cz), radius r, from angle a0 for `len` radians (0 is +x, π/2 is +z). */
function arc(paint: Painter, cx: number, cz: number, r: number, a0: number, len: number, w = 0.06): void {
  // RingGeometry lies in xy; turned flat, its angle t lands at (cos t, 0, -sin t), so +z is t = -π/2
  const g = new RingGeometry(r - w / 2, r + w / 2, 48, 1, -a0 - len, len).rotateX(-Math.PI / 2).translate(cx, 0.008, cz);
  paint.add(g, LINE, true);
}

function courtFloor(scene: Object3D, paint: Painter): void {
  const grass = new Mesh(new PlaneGeometry(240, 240), new MeshLambertMaterial({ color: 0x4f8f45 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  scene.add(grass);
  // the park's asphalt, a darker band round it, the lane painted blue
  const pad = 1.2;
  paint.box(FENCE_X * 2, 0.04, FENCE_FRONT - FENCE_BACK, 0, -0.02, (FENCE_FRONT + FENCE_BACK) / 2, ASPHALT_EDGE);
  paint.box(HALF_W * 2 + pad * 2, 0.04, HALFCOURT_Z - BASELINE_Z + pad * 2, 0, -0.01, (HALFCOURT_Z + BASELINE_Z) / 2, ASPHALT);
  paint.box(LANE_HALF * 2, 0.012, FT_Z - BASELINE_Z, 0, 0.003, (FT_Z + BASELINE_Z) / 2, LANE, true);
  // the court's lines
  line(paint, -HALF_W, BASELINE_Z, HALF_W, BASELINE_Z);
  line(paint, -HALF_W, HALFCOURT_Z, HALF_W, HALFCOURT_Z);
  line(paint, -HALF_W, BASELINE_Z, -HALF_W, HALFCOURT_Z);
  line(paint, HALF_W, BASELINE_Z, HALF_W, HALFCOURT_Z);
  // the lane and the free-throw line, its circle (the far half dashed in real life; whole here)
  line(paint, -LANE_HALF, BASELINE_Z, -LANE_HALF, FT_Z);
  line(paint, LANE_HALF, BASELINE_Z, LANE_HALF, FT_Z);
  line(paint, -LANE_HALF, FT_Z, LANE_HALF, FT_Z);
  arc(paint, 0, FT_Z, 1.8, 0, Math.PI);
  // the three-point line: corners straight up from the baseline, then the arc
  const cornerZ = Math.sqrt(ARC_R * ARC_R - CORNER_X * CORNER_X);
  line(paint, -CORNER_X, BASELINE_Z, -CORNER_X, cornerZ);
  line(paint, CORNER_X, BASELINE_Z, CORNER_X, cornerZ);
  const a0 = Math.asin(cornerZ / ARC_R);
  arc(paint, 0, 0, ARC_R, a0, Math.PI - 2 * a0);
  // the restricted-area half circle and the centre circle's half at the half-court line
  arc(paint, 0, 0, 1.25, 0, Math.PI);
  arc(paint, 0, HALFCOURT_Z, 1.8, Math.PI, Math.PI);
  // the five spots, painted, the money ball's in gold
  SPOTS.forEach((sp, i) => {
    const p = spotPosition(i);
    paint.add(new CircleGeometry(0.22, 16).rotateX(-Math.PI / 2).translate(p.x, 0.01, p.z), i === SPOTS.length - 1 ? PALETTE.yellow : 0xdfe3e8, true);
    paint.add(new CircleGeometry(0.15, 16).rotateX(-Math.PI / 2).translate(p.x, 0.011, p.z), sp.points >= 3 ? PALETTE.red : PALETTE.blue, true);
  });
}

/** The chain net: chains from the rim to a narrower ring below, crossing in diamonds. Its own group, so it can sway. */
function chainNet(): Group {
  const net = new Group();
  const n = 14;
  const top = { r: RIM.r - 0.005, y: 0 };
  const rows = [
    { r: RIM.r - 0.03, y: -0.14 },
    { r: RIM.r - 0.06, y: -0.28 },
    { r: RIM.r - 0.085, y: -0.42 },
  ];
  const pts: number[] = [];
  const at = (k: number, ring: { r: number; y: number }, half = 0) => {
    const a = ((k + half) / n) * Math.PI * 2;
    return [Math.cos(a) * ring.r, ring.y, Math.sin(a) * ring.r];
  };
  for (let k = 0; k < n; k++) {
    let prev = top;
    rows.forEach((row, j) => {
      // each chain zigzags between its own column and the next, so the links cross in diamonds
      const from = at(k, prev, (j % 2) * 0.5);
      const to = at(k, row, ((j + 1) % 2) * 0.5);
      pts.push(...from, ...to);
      const from2 = at(k + 1, prev, (j % 2) * 0.5);
      pts.push(...from2, ...to);
      prev = row;
    });
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
  net.add(new LineSegments(geo, new LineBasicMaterial({ color: 0xc9ced6 })));
  // a thin ring at the bottom where the chains end
  const bottom = new Mesh(new TorusGeometry(rows[2].r, 0.006, 4, 24), new MeshLambertMaterial({ color: 0xaab1ba }));
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = rows[2].y;
  net.add(bottom);
  net.position.y = RIM.y;
  return net;
}

/** The hoop: pole, arm, backboard with its square, the rim and the net. Returns the net to sway. */
function hoop(scene: Object3D, paint: Painter): Group {
  const poleZ = BASELINE_Z - 1.0;
  const boardBack = BOARD.z - 0.05;
  paint.add(new CylinderGeometry(0.1, 0.12, 3.6, 8).translate(0, 1.8, poleZ), 0x2f3a46);
  // the padding round the pole's foot
  paint.box(0.34, 1.6, 0.34, 0, 0.8, poleZ, PALETTE.blue);
  // the arm out to the board
  paint.box(0.12, 0.12, boardBack - poleZ, 0, 3.5, (boardBack + poleZ) / 2, 0x2f3a46);
  paint.box(0.1, 0.5, 0.1, 0, 3.3, boardBack - 0.05, 0x2f3a46);
  // the board: a white slab with a black edge and the shooter's square above the rim
  const h = BOARD.top - BOARD.bottom;
  const cy = (BOARD.top + BOARD.bottom) / 2;
  paint.box(BOARD.halfWidth * 2 + 0.06, h + 0.06, 0.04, 0, cy, BOARD.z - 0.03, 0x1d1d1f);
  paint.box(BOARD.halfWidth * 2, h, 0.05, 0, cy, BOARD.z - 0.025, 0xf7f8fa);
  const sq = { w: 0.59, h: 0.45, y: RIM.y + 0.15 };
  paint.box(sq.w, 0.05, 0.006, 0, sq.y + sq.h, BOARD.z + 0.003, PALETTE.red, true);
  paint.box(0.05, sq.h, 0.006, -sq.w / 2, sq.y + sq.h / 2, BOARD.z + 0.003, PALETTE.red, true);
  paint.box(0.05, sq.h, 0.006, sq.w / 2, sq.y + sq.h / 2, BOARD.z + 0.003, PALETTE.red, true);
  paint.box(sq.w, 0.05, 0.006, 0, sq.y, BOARD.z + 0.003, PALETTE.red, true);
  // the rim (its tube drawn a little fatter than the sim's so it reads) and its bracket to the board
  paint.add(new TorusGeometry(RIM.r, 0.02, 6, 28).rotateX(Math.PI / 2).translate(0, RIM.y, 0), RIM_COLOUR);
  paint.box(0.14, 0.04, -BOARD.z - RIM.r + 0.02, 0, RIM.y - 0.02, (BOARD.z - RIM.r) / 2, RIM_COLOUR);
  const net = chainNet();
  scene.add(net);
  return net;
}

/** The chain-link fence: see-through panels on posts, round the park. */
function fence(scene: Object3D, paint: Painter): void {
  const links = canvasTexture(32, 32, (g) => {
    g.clearRect(0, 0, 32, 32);
    g.strokeStyle = "rgba(200,206,214,0.8)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 16);
    g.lineTo(16, 0);
    g.lineTo(32, 16);
    g.lineTo(16, 32);
    g.closePath();
    g.stroke();
  });
  links.wrapS = links.wrapT = RepeatWrapping;
  const side = (len: number, x: number, z: number, angle: number) => {
    const tex = links.clone();
    tex.needsUpdate = true;
    tex.repeat.set(len / 0.35, FENCE_H / 0.35);
    const panel = new Mesh(new PlaneGeometry(len, FENCE_H), new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, depthWrite: false }));
    panel.position.set(x, FENCE_H / 2, z);
    panel.rotation.y = angle;
    scene.add(panel);
    // the top rail, and a post every 3 m
    const m = new Matrix4().makeRotationY(angle);
    m.setPosition(x, 0, z);
    paint.add(new CylinderGeometry(0.03, 0.03, len, 6).rotateZ(Math.PI / 2).translate(0, FENCE_H, 0).applyMatrix4(m), 0x8d97a3);
    const posts = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= posts; i++) {
      paint.add(new CylinderGeometry(0.045, 0.045, FENCE_H, 6).translate(-len / 2 + (i * len) / posts, FENCE_H / 2, 0).applyMatrix4(m), 0x7b8591);
    }
  };
  const depth = FENCE_FRONT - FENCE_BACK;
  side(FENCE_X * 2, 0, FENCE_BACK, 0);
  side(depth, -FENCE_X, (FENCE_FRONT + FENCE_BACK) / 2, Math.PI / 2);
  side(depth, FENCE_X, (FENCE_FRONT + FENCE_BACK) / 2, Math.PI / 2);
  // the open end behind the shooters has a short return each side, the gate between
  side(4, -FENCE_X + 2, FENCE_FRONT, 0);
  side(4, FENCE_X - 2, FENCE_FRONT, 0);
}

/** One sideline's bleachers: aluminium benches on a frame, rising away from the court. */
function bleachers(paint: Painter, s: Stand, colour: number): void {
  const o = new Object3D();
  o.position.set(s.x, 0, s.z);
  o.rotation.set(0, s.angle, 0);
  o.updateMatrix();
  const base = o.matrix.clone();
  for (let t = 0; t < BLEACHER.tiers; t++) {
    const h = BLEACHER.wall + (t + 1) * BLEACHER.rise;
    const z = -(t + 0.5) * BLEACHER.depth;
    // the step's riser (open frame, drawn as a thin dark board) and the seat plank
    paint.box(s.length, 0.06, BLEACHER.depth * 0.9, 0, h - 0.03, z, t % 2 ? 0xb8c0c9 : 0xc9d0d8, false, base);
    paint.box(s.length, h - 0.06, 0.04, 0, (h - 0.06) / 2, z + BLEACHER.depth * 0.45, 0x6d7782, false, base);
    // a coloured kick board along the seat's front edge, the stand's colour
    paint.box(s.length, 0.08, 0.03, 0, h - 0.1, z + BLEACHER.depth * 0.46, colour, false, base);
  }
  // the frame's legs and the back rail
  const top = BLEACHER.wall + BLEACHER.tiers * BLEACHER.rise;
  for (const x of [-s.length / 2, -s.length / 4, 0, s.length / 4, s.length / 2]) {
    paint.box(0.08, top + 0.9, 0.08, x, (top + 0.9) / 2, -BLEACHER.tiers * BLEACHER.depth, 0x8a949f, false, base);
  }
  paint.box(s.length, 0.06, 0.06, 0, top + 0.9, -BLEACHER.tiers * BLEACHER.depth, 0x8a949f, false, base);
}

/** The bleachers' crowd, in tennis's layout shape: "left" and "right" stands, no end stands. */
export function bleacherLayout(seed = 42): CrowdLayout {
  const rand = rng(seed);
  const left: CrowdSeat[] = standSeats(STANDS.left, BLEACHER, rand, () => "left");
  const right: CrowdSeat[] = standSeats(STANDS.right, BLEACHER, rand, () => "right");
  const seats = [...left, ...right];
  return {
    seats,
    ranges: {
      left: { start: 0, count: left.length },
      right: { start: left.length, count: right.length },
      frontLeft: { start: seats.length, count: 0 },
      frontRight: { start: seats.length, count: 0 },
    },
  };
}

export type Reaction = "big" | "cheer" | "groan";

export interface Court {
  crowd: CrowdHandle;
  /** The chain net, to sway on a make. */
  net: Group;
  /** The crowd reacts to a shot: jumps (a swish or the money ball higher and longer) or slumps. */
  react(kind: Reaction): void;
  /** The last reaction, for tests. */
  reaction(): Reaction | null;
  /** Moves the crowd and the net; `now` in seconds. */
  update(now: number): void;
}

const CHEER = { big: { lift: 0.38, rate: 3.2, share: 1, secs: 2.8 }, cheer: { lift: 0.22, rate: 2.6, share: 0.65, secs: 1.8 } } as const;
const GROAN_SECS = 1.9;

export function buildCourt(scene: Scene): Court {
  const park = new Group();
  park.add(new HemisphereLight(0xe6f4ff, 0x5a6a4a, 1.5));
  const sun = new DirectionalLight(0xfff3dc, 2.2);
  sun.position.set(8, 16, 10);
  park.add(sun);
  const paint = new Painter();
  sky(scene, park, paint);
  courtFloor(park, paint);
  const net = hoop(park, paint);
  fence(park, paint);
  bleachers(paint, STANDS.left, PALETTE.blue);
  bleachers(paint, STANDS.right, PALETTE.red);
  const crowd = seatCrowd(park, bleacherLayout(), { left: PALETTE.blue, right: PALETTE.red });
  // trees outside the fence: along both sides and behind the hoop
  const rand = rng(77);
  const spots: [number, number][] = [];
  for (let i = 0; i < 22; i++) spots.push([(i % 2 ? 1 : -1) * (FENCE_X + 3 + rand() * 9), FENCE_BACK - 4 + rand() * (FENCE_FRONT - FENCE_BACK + 8)]);
  for (let i = 0; i < 14; i++) spots.push([(rand() - 0.5) * 50, FENCE_BACK - 4 - rand() * 14]);
  plantTrees(park, spots, rand);
  paint.build(park);
  scene.add(park);

  // each fan's own beat, and whether they join in a plain cheer
  const n = crowd.layout.seats.length;
  const phase = Array.from({ length: n }, () => rand());
  const keen = Array.from({ length: n }, () => rand());
  const m = new Matrix4();
  let current: { kind: Reaction; at: number } | null = null;
  let pending: Reaction | null = null;
  let last: Reaction | null = null;
  let moved = false;
  let swayAt = -Infinity;

  return {
    crowd,
    net,
    react(kind) {
      pending = kind;
      last = kind;
      if (kind !== "groan") swayAt = Number.NaN;
    },
    reaction: () => last,
    update(now) {
      if (pending) {
        current = { kind: pending, at: now };
        pending = null;
      }
      if (Number.isNaN(swayAt)) swayAt = now;
      // the net: a quick ripple after a make
      const st = now - swayAt;
      const k = st >= 0 && st < 1.2 ? Math.exp(-st * 3) : 0;
      net.scale.set(1 - 0.12 * k * Math.abs(Math.sin(st * 14)), 1 + 0.18 * k, 1 - 0.12 * k * Math.abs(Math.sin(st * 14)));
      net.rotation.y = 0.15 * k * Math.sin(st * 9);

      const t = current ? now - current.at : Infinity;
      const kind = current?.kind;
      const secs = kind === "groan" ? GROAN_SECS : kind ? CHEER[kind].secs : 0;
      if (!current || t > secs) {
        if (moved) {
          for (let i = 0; i < n; i++) {
            crowd.bodies.setMatrixAt(i, crowd.restBody[i]);
            crowd.heads.setMatrixAt(i, crowd.restHead[i]);
          }
          crowd.bodies.instanceMatrix.needsUpdate = true;
          crowd.heads.instanceMatrix.needsUpdate = true;
          moved = false;
        }
        current = t > secs ? null : current;
        return;
      }
      // fade in fast, out over the last half second
      const env = Math.min(1, t / 0.15) * Math.min(1, (secs - t) / 0.5);
      for (let i = 0; i < n; i++) {
        let body = 0;
        let head = 0;
        if (kind === "groan") {
          // a slump: shoulders down, head further down
          body = -0.06 * env;
          head = -0.14 * env;
        } else if (kind) {
          const c = CHEER[kind];
          if (keen[i] < c.share) {
            body = c.lift * env * Math.abs(Math.sin((t * c.rate + phase[i]) * Math.PI));
            head = body;
          }
        }
        crowd.bodies.setMatrixAt(i, m.makeTranslation(0, body, 0).multiply(crowd.restBody[i]));
        crowd.heads.setMatrixAt(i, m.makeTranslation(0, head, 0).multiply(crowd.restHead[i]));
      }
      crowd.bodies.instanceMatrix.needsUpdate = true;
      crowd.heads.instanceMatrix.needsUpdate = true;
      moved = true;
    },
  };
}
