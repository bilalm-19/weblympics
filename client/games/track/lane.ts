import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  MeshLambertMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakeLighting } from "./bake.ts";
import type { BakeLights } from "./bake.ts";
import { cheer, cheerUniforms, mergeFans } from "./crowd.ts";
import type { Runner } from "./runner.ts";
import { FAN_SHIRTS, PALETTE, Painter, fanMeshes, paintStand, sky } from "../tennis/stadium.ts";
import { OCCUPANCY, TIERS, TIER_DEPTH, TIER_RISE, WALL_H, rng, seatColumns, standToArena } from "../tennis/crowd-layout.ts";
import type { Stand } from "../tennis/crowd-layout.ts";
import type { Material } from "three";

// Track's stadium (task 31), low-poly and flat-shaded from primitives like
// tennis's arena, and built from its pieces: the Painter merges every static
// part into two meshes, paintStand draws the stands, fanMeshes seats the
// crowd (merged per stand in crowd.ts), sky() gives the sky, clouds and
// hills. Eight red tartan lanes run down +x with the two seats in lanes 4
// and 5; the infield is on the near side (+z, under the chase camera), the
// long stand down the far side and another behind the finish. The stand is
// cut into blocks along the track so the ones off screen are culled. The
// light is baked into the stadium's colours (bake.ts): only the runners are lit.

export const LANE_WIDTH = 1.22;
/** Lane centres along z: seat 0 nearer the camera. */
export const laneZ = (seat: 0 | 1): number => (seat === 0 ? LANE_WIDTH / 2 : -LANE_WIDTH / 2);

const LANES = 8;
/** Half the width of the eight lanes; lane 1 is nearest the camera, at +z. */
const HALF = (LANES / 2) * LANE_WIDTH;
const TARTAN = 0xc4553a;
const RING = [PALETTE.blue, PALETTE.yellow, PALETTE.black, PALETTE.green, PALETTE.red];
/** Where the far stand's front edge sits, and how long each culled block of it is. */
const FAR_Z = -(HALF + 2.2);
const BLOCK = 20;
// share of a block's fans wearing its colour
const FAN_SHARE = 0.3;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export interface TrackScene {
  /** Each frame: the camera's x (the sky follows it), the crowd's excitement 0..1, seconds now, and the clock's text. */
  update(cameraX: number, excitement: number, now: number, clock: string): void;
  dispose(): void;
}


function ground(group: Group, paint: Painter, length: number): void {
  // Side by side strips, never stacked, so each ground pixel is drawn once:
  // the infield in mown bands toward the camera, the kerb, the tartan to the
  // far stand's foot. Nothing is drawn where the chase camera can't look.
  const x0 = -40;
  const x1 = length + 40;
  const far = FAR_Z - 0.2;
  const infieldEdge = HALF + 0.3;
  paint.add(new PlaneGeometry(x1 - x0, infieldEdge - far).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, -0.01, (far + infieldEdge) / 2), TARTAN);
  for (let x = x0, k = 0; x < x1; x += 10, k++) {
    paint.add(new PlaneGeometry(10, 40).rotateX(-Math.PI / 2).translate(x + 5, -0.01, infieldEdge + 20), k % 2 ? 0x5fb34c : 0x6cc257);
  }

  // lane lines, white, unlit so they stay crisp; the kerb along the infield
  const lx0 = -15;
  const lx1 = length + 18;
  const mid = (lx0 + lx1) / 2;
  for (let k = 0; k <= LANES; k++) paint.box(lx1 - lx0, 0.01, 0.05, mid, 0.004, HALF - k * LANE_WIDTH, 0xffffff, true);
  paint.box(x1 - x0, 0.08, 0.12, (x0 + x1) / 2, 0.04, HALF + 0.12, 0xf4f6f8);
  // start and finish across all eight lanes
  paint.box(0.08, 0.01, HALF * 2, 0, 0.005, 0, 0xffffff, true);
  paint.box(0.3, 0.01, HALF * 2, length, 0.005, 0, 0xffffff, true);
  // the finish's chequer just past the line, in the two seats' lanes
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 2; j++) paint.box(0.15, 0.012, LANE_WIDTH / 4, length + 0.225 + j * 0.15, 0.006, -LANE_WIDTH + (i + 0.5) * (LANE_WIDTH / 4), (i + j) % 2 ? 0x1d1d1f : 0xffffff, true);
  }
  // faint marks every 10 m across the two seats' lanes, a sense of speed
  for (let x = 10; x < length; x += 10) paint.box(0.05, 0.008, LANE_WIDTH * 2, x, 0.003, 0, 0xf2c1b5, true);
  // kerb markers every 10 m along the infield edge, in the ring colours
  for (let x = 0, i = 0; x <= length; x += 10, i++) paint.add(new ConeGeometry(0.16, 0.34, 4).translate(x, 0.17, HALF + 0.35), RING[i % 5]);

  // lane numbers on the track before the start, readable from the blocks
  const numbers = canvasTexture(64, 64 * LANES, (g) => {
    g.clearRect(0, 0, 64, 64 * LANES);
    g.fillStyle = "#ffffff";
    g.font = "bold 50px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let k = 0; k < LANES; k++) {
      g.save();
      g.translate(32, 64 * k + 32);
      // the top of each number points down the track (+x)
      g.rotate(Math.PI / 2);
      g.fillText(String(k + 1), 0, 2);
      g.restore();
    }
  });
  const numberGeometry = mergeGeometries([
    new PlaneGeometry(0.9, HALF * 2).rotateX(-Math.PI / 2).translate(-2.2, 0.007, 0),
    new PlaneGeometry(0.9, HALF * 2).rotateX(-Math.PI / 2).translate(length + 2.4, 0.007, 0),
  ]);
  group.add(new Mesh(numberGeometry, new MeshBasicMaterial({ map: numbers, transparent: true, depthWrite: false })));
}

/** Starting blocks in every lane, behind the line: a rail and two angled pads. */
function blocks(paint: Painter): void {
  const m = new Matrix4();
  for (let k = 0; k < LANES; k++) {
    const z = HALF - (k + 0.5) * LANE_WIDTH;
    paint.box(0.7, 0.05, 0.08, -0.65, 0.03, z, 0x8a96a3);
    for (const [dx, dz] of [
      [-0.4, 0.13],
      [-0.85, -0.13],
    ]) {
      m.makeRotationZ(0.75).setPosition(dx - 0.1, 0.09, z + dz);
      paint.box(0.08, 0.2, 0.14, 0, 0, 0, RING[k % 5], false, m);
    }
  }
}

/** Boards along the far side of the track, panels in the five colours with a white stripe. */
function boards(paint: Painter, length: number): void {
  const z = FAR_Z + 0.6;
  for (let x = -14, i = 0; x < length + 16; x += 3, i++) {
    paint.box(2.85, 0.7, 0.06, x, 0.35, z, RING[i % 5], true);
    paint.box(2, 0.08, 0.07, x, 0.38, z, 0xffffff, true);
  }
}

/** A flag on a pole: the cloth a thin box, tipped as if in a breeze. */
function flag(paint: Painter, x: number, y: number, z: number, colour: number, height = 3): void {
  paint.add(new CylinderGeometry(0.04, 0.05, height, 5).translate(x, y + height / 2, z), 0xdfe4ea);
  const m = new Matrix4().makeRotationY(-0.35).setPosition(x + 0.55, y + height - 0.4, z + 0.1);
  paint.box(1.1, 0.7, 0.03, 0, 0, 0, colour, false, m);
}

/**
 * The finish arch: two pillars, a beam with FINISH on it, the race clock on
 * it. It spans from the far boards to beyond the chase camera (which rides
 * at z 8 to 9), so no pillar ever stands between the camera and the runners.
 */
function arch(group: Group, paint: Painter, length: number): { draw(text: string): void } {
  const zFar = FAR_Z + 0.9;
  const zNear = 11;
  const span = zNear - zFar;
  const mid = (zNear + zFar) / 2;
  const top = 5.2;
  for (const z of [zFar, zNear]) {
    paint.box(0.5, top, 0.5, length, top / 2, z, 0x2b3242);
    paint.box(0.56, 0.3, 0.56, length, 0.15, z, PALETTE.yellow);
    flag(paint, length, top + 0.45, z, z > 0 ? PALETTE.blue : PALETTE.red, 2);
  }
  paint.box(0.5, 0.9, span + 0.5, length, top + 0.15, mid, 0x2b3242);
  // a stripe in the five colours along the beam's foot
  for (let i = 0; i < 5; i++) paint.box(0.52, 0.12, (span + 0.5) / 5, length, top - 0.24, zFar - 0.25 + ((i + 0.5) * (span + 0.5)) / 5, RING[i], true);
  const label = canvasTexture(512, 64, (g) => {
    g.fillStyle = "#2b3242";
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = "#ffffff";
    g.font = "bold 46px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("FINISH", 256, 34);
  });
  const finish = new Mesh(new PlaneGeometry(6, 0.75), new MeshBasicMaterial({ map: label }));
  finish.rotation.y = -Math.PI / 2;
  finish.position.set(length - 0.26, top + 0.15, -2.5);
  group.add(finish);

  // the clock: a dark box on the beam with a face down the track (seen
  // running in), and a second board on posts by the far boards just past the
  // line, facing the chase camera, so it is in shot as the runners finish
  paint.box(0.7, 1.3, 3.4, length, top + 1.25, 2.4, 0x1d1d1f);
  const board = { x: length + 2.6, y: 2.1, z: FAR_Z + 1.3 };
  paint.box(3.4, 1.3, 0.2, board.x, board.y, board.z - 0.12, 0x1d1d1f);
  for (const dx of [-1.2, 1.2]) paint.box(0.14, board.y - 0.6, 0.14, board.x + dx, (board.y - 0.6) / 2, board.z - 0.12, 0x2b3242);
  paint.box(3.4, 0.1, 0.22, board.x, board.y + 0.68, board.z - 0.12, PALETTE.yellow);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 88;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const face = new MeshBasicMaterial({ map: tex });
  const down = new Mesh(new PlaneGeometry(3.1, 1.07), face);
  down.rotation.y = -Math.PI / 2;
  down.position.set(length - 0.36, top + 1.25, 2.4);
  const side = new Mesh(new PlaneGeometry(3.1, 1.07), face);
  side.position.set(board.x, board.y, board.z);
  group.add(down, side);
  let shown = "";
  return {
    draw(text) {
      if (text === shown) return;
      shown = text;
      g.fillStyle = "#101216";
      g.fillRect(0, 0, 256, 88);
      g.fillStyle = "#ffd23f";
      g.font = "bold 64px ui-monospace, monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, 128, 48);
      tex.needsUpdate = true;
    },
  };
}

/** One stand: painted, and its fans seated as one mesh that cheers with the others. */
function stand(group: Group, paint: Painter, s: Stand, colours: [number, number], seed: number, fanMaterial: MeshLambertMaterial): void {
  paintStand(paint, s, [
    { x0: -s.length / 2, x1: 0, colour: colours[0] },
    { x0: 0, x1: s.length / 2, colour: colours[1] },
  ], 1, true);
  const rand = rng(seed);
  const seats: { x: number; y: number; z: number; facing: number; colour: number }[] = [];
  for (let t = 0; t < TIERS; t++) {
    const y = WALL_H + (t + 1) * TIER_RISE;
    for (const lx of seatColumns(s)) {
      if (rand() >= OCCUPANCY) continue;
      seats.push({ ...standToArena(s, lx, y, -(t + 0.55) * TIER_DEPTH), facing: s.angle, colour: lx < 0 ? colours[0] : colours[1] });
    }
  }
  const fans = fanMeshes(seats, (seat, r) => (r() < FAN_SHARE ? seat.colour : FAN_SHIRTS[Math.floor(r() * FAN_SHIRTS.length)]), seed + 1);
  const crowd = mergeFans(
    fans.bodies,
    fans.heads,
    seats.map(() => rand()),
    seats.map(() => rand() * Math.PI * 2),
  );
  fans.bodies.dispose();
  fans.heads.dispose();
  crowd.material = fanMaterial;
  group.add(crowd);
  // flags on the roof's back edge
  const top = WALL_H + TIERS * TIER_RISE;
  for (const lx of [-s.length / 2 + 1, 0, s.length / 2 - 1]) {
    const p = standToArena(s, lx, 0, -TIERS * TIER_DEPTH + 0.3);
    flag(paint, p.x, top + 3.3, p.z, RING[Math.floor(rand() * 5)], 2.4);
  }
}

/**
 * Builds the stadium into `scene` for a race of `length` metres and returns
 * what changes each frame: the sky's follow, the crowd and the clock.
 */
export function buildTrack(scene: Scene, length: number): TrackScene {
  const group = new Group();
  // the lights stay for the runners; the stadium has them baked in (bake.ts)
  const lights: BakeLights = { sky: 0xe6f4ff, ground: 0x5a8a4a, hemi: 1.5, sun: 0xfff0d4, sunIntensity: 2.2, sunDir: new Vector3(-20, 30, 25) };
  const hemi = new HemisphereLight(lights.sky, lights.ground, lights.hemi);
  const sun = new DirectionalLight(lights.sun, lights.sunIntensity);
  sun.position.copy(lights.sunDir);
  scene.add(hemi, sun);
  const paint = new Painter();

  // the sky, clouds and hills ride along with the camera, as if far away
  const skyGroup = new Group();
  const skyPaint = new Painter();
  sky(scene, skyGroup, skyPaint);
  skyPaint.build(skyGroup);
  // the gradient would be a full-screen textured pass every frame; the
  // renderer's clear colour is the same blue for free, and the stands hide
  // most of the sky from the chase camera anyway
  scene.background = null;
  group.add(skyGroup);

  ground(group, paint, length);
  blocks(paint);
  boards(paint, length);
  const clock = arch(group, paint, length);

  // every fan shares one material: its lighting baked like the rest, its cheer in the vertex shader
  const fanMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  // the far stand in blocks of BLOCK metres, each block's halves in two ring colours
  const farStart = -25;
  const farEnd = length + 15;
  for (let x = farStart, i = 0; x < farEnd; x += BLOCK, i++) {
    const len = Math.min(BLOCK, farEnd - x);
    const s: Stand = { x: x + len / 2, z: FAR_Z, length: len - 0.4, angle: 0, aisles: [] };
    stand(group, paint, s, [RING[(2 * i) % 5], RING[(2 * i + 1) % 5]], 100 + i, fanMaterial);
  }
  // the end stand behind the finish, rising away down the track
  const endStand: Stand = { x: length + 19, z: -1, length: 26, angle: -Math.PI / 2, aisles: [0] };
  stand(group, paint, endStand, [PALETTE.blue, PALETTE.red], 300, fanMaterial);
  // flags along the infield, past the kerb
  for (let x = 5, i = 0; x < length; x += 15, i++) flag(paint, x, 0, HALF + 2.2, RING[i % 5], 2.6);

  paint.build(group);
  bakeLighting(group, lights);
  // the baked fans' material (bakeLighting gives each mesh its own; share one)
  const uniforms = cheerUniforms();
  let fans: Material | null = null;
  group.traverse((o) => {
    if (o instanceof Mesh && o.name === "crowd") {
      if (fans) {
        (o.material as Material).dispose();
        o.material = fans;
      } else fans = o.material as Material;
    }
  });
  if (fans) cheer(fans, uniforms);
  scene.add(group);

  return {
    update(cameraX, loud, now, text) {
      skyGroup.position.x = cameraX;
      clock.draw(text);
      uniforms.uLoud.value = loud;
      uniforms.uTime.value = now;
    },
    dispose() {
      scene.remove(group, hemi, sun);
    },
  };
}

// ---------------------------------------------------------------------------
// Hurdles (task 27). Kept apart from the track and the runner above so the
// scenery (task 31) can change those freely: the view calls these on its own,
// and the jump pose only moves a runner's outer group.

const HURDLE_HEIGHT = 0.84;

export interface HurdleRow {
  /** Shows each hurdle in a lane standing ("up", "cleared") or knocked down ("down"); `dt` animates the fall. */
  update(seat: 0 | 1, marks: readonly string[], dt: number): void;
  dispose(): void;
}

/** One hurdle from primitives: two white uprights, feet and a striped bar; it pivots at its base so it can tip over. */
function makeHurdle(): Group {
  const pivot = new Group();
  const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });
  const white = flat(0xf4f4f4);
  const black = flat(0x22262e);
  const width = LANE_WIDTH * 0.8;
  for (const z of [-width / 2, width / 2]) {
    const post = new Mesh(new BoxGeometry(0.05, HURDLE_HEIGHT, 0.05), white);
    post.position.set(0, HURDLE_HEIGHT / 2, z);
    const foot = new Mesh(new BoxGeometry(0.5, 0.04, 0.06), black);
    foot.position.set(-0.2, 0.02, z);
    pivot.add(post, foot);
  }
  // the bar in stripes, so it reads at a distance
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    const seg = new Mesh(new BoxGeometry(0.04, 0.12, width / stripes), i % 2 ? white : black);
    seg.position.set(0, HURDLE_HEIGHT - 0.06, -width / 2 + (i + 0.5) * (width / stripes));
    pivot.add(seg);
  }
  return pivot;
}

/** Both lanes' hurdles at `obstacles` (metres along the track), added to `scene`. */
export function buildHurdles(scene: Scene, obstacles: readonly number[]): HurdleRow {
  const group = new Group();
  const rows: Group[][] = [[], []];
  for (const seat of [0, 1] as const) {
    for (const x of obstacles) {
      const h = makeHurdle();
      h.position.set(x, 0, laneZ(seat));
      group.add(h);
      rows[seat].push(h);
    }
  }
  scene.add(group);
  return {
    update(seat, marks, dt) {
      rows[seat].forEach((h, i) => {
        // knocked down: it tips forward, down the track, until it lies flat
        if (marks[i] === "down") h.rotation.z += (-Math.PI / 2 + 0.08 - h.rotation.z) * Math.min(1, dt * 9);
        else h.rotation.z = 0;
      });
    },
    dispose() {
      scene.remove(group);
    },
  };
}

/**
 * A runner's jump on top of the run cycle: the whole figure lifts over the
 * bar and leans into it. `t` 0..1 through the flight, or null on the ground.
 * It moves only the runner's outer group, so any runner model works.
 */
export function jumpPose(r: Runner, t: number | null): void {
  if (t === null) {
    r.group.position.y = 0;
    r.group.rotation.z = 0;
    return;
  }
  const k = Math.min(1, Math.max(0, t));
  r.group.position.y = Math.sin(Math.PI * k) * 0.75;
  // lean forward on the way up, level out coming down
  r.group.rotation.z = -0.35 * Math.sin(Math.PI * k);
}
