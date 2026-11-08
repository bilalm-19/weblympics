import {
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Object3D, Scene } from "three";
import { rng } from "../tennis/crowd-layout.ts";
import { Painter } from "../tennis/stadium.ts";
import { bakeLighting } from "../track/bake.ts";
import type { BakeLights } from "../track/bake.ts";

// Basketball's city (user, 2026-11-08): the street court sits on its own
// block with roads on all four sides and the city round it: rows of buildings
// of varied heights and colours facing the court (shops with awnings and
// graffiti'd shutters on the ground floor, water towers and antennas on the
// roofs), taller rows and towers behind them, a hazy skyline of flat
// silhouettes far off, street lamps, parked cars, a crosswalk, benches, and a
// graffiti wall behind each bleacher. Nothing here moves, so it is cheap:
// the plain parts go through tennis's Painter (one lit, one unlit mesh), the
// buildings' walls are one mesh on one small window texture (the wall's
// colour is the vertex colour, the windows a 16x16 grid, a few lit), the
// graffiti one mesh on one canvas, and the light is baked into the vertex
// colours (track's bake.ts), so the whole city is four draw calls.
//
// The court's own parts (floor, hoop, fence, bleachers, crowd) stay in
// court.ts, which calls `buildCity` with the fence's size.

export interface Block {
  /** The fence at x = ±fenceX, from z = fenceBack (behind the hoop) to fenceFront. */
  fenceX: number;
  fenceBack: number;
  fenceFront: number;
}

/** Wall widths and storeys are whole window columns and floors, so a facade's windows come out even. */
const COL_W = 2.6;
const FLOOR_H = 3.2;
/** The window texture is CELLS x CELLS windows. */
const CELLS = 16;
const CELL_PX = 16;

const SIDEWALK = 3;
const ROAD = 8;
const KERB = 0.12;
const ROAD_Y = -0.15;

const WALLS = [0xb5523b, 0x9c4a3a, 0xc4703f, 0xd8c7a6, 0xe8dfcf, 0x8f98a3, 0x5d7690, 0x4f8a8b, 0xe0c27a, 0xa9b4bd, 0x7a5b8c, 0xc98f7a];
const GLASS = [0x9fbfd8, 0x8fb0c8, 0xb7c9d6];
const AWNINGS = [0xee334e, 0x00a651, 0x0081c8, 0xfcb131, 0x2a2d33, 0x7a3fa0];
const CARS = [0xd23a3a, 0xf2c12e, 0xf2c12e, 0xeeeeee, 0x2d5fa8, 0x22252a, 0xa9b0b8, 0x3e8a5a];

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** White wall with a grid of windows: dark glass, a few with blinds, a few lit. The vertex colour tints the lot. */
function windowTexture(rand: () => number): CanvasTexture {
  const size = CELLS * CELL_PX;
  const tex = canvasTexture(size, size, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, size, size);
    for (let r = 0; r < CELLS; r++) {
      for (let c = 0; c < CELLS; c++) {
        const x = c * CELL_PX + 3;
        const y = r * CELL_PX + 3;
        const k = rand();
        g.fillStyle = k < 0.1 ? "#ffd27a" : k < 0.14 ? "#fff0c0" : k < 0.3 ? "#7d8a99" : k < 0.65 ? "#2f3d4d" : "#3b4c60";
        g.fillRect(x, y, CELL_PX - 6, CELL_PX - 5);
        // a pale sill under each window
        g.fillStyle = "#d9d9d9";
        g.fillRect(x - 1, y + CELL_PX - 5, CELL_PX - 4, 1);
      }
    }
  });
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

const GRAFFITI_WORDS = ["HOOPS", "SWISH", "NEXT UP", "BALL IS LIFE", "CITY", "BUCKETS", "AND ONE", "WEBLYMPICS"];
const SPRAY = ["#ee334e", "#fcb131", "#00a651", "#0081c8", "#ff7ac8", "#c77dff", "#7ad8ff", "#ff9d5d", "#fff07a"];

/**
 * The graffiti atlas: the top half one long mural (the walls behind the
 * bleachers), the bottom half four tags (the shops' roller shutters).
 */
function graffitiTexture(rand: () => number): CanvasTexture {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const tag = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, word: string, base: string) => {
    g.fillStyle = base;
    g.fillRect(x, y, w, h);
    // spray blobs behind the letters
    for (let i = 0; i < 6; i++) {
      const bx = x + rand() * w;
      const by = y + rand() * h;
      const br = h * (0.2 + rand() * 0.35);
      const grad = g.createRadialGradient(bx, by, 0, bx, by, br);
      const col = pick(SPRAY);
      grad.addColorStop(0, col);
      grad.addColorStop(0.7, col + "aa");
      grad.addColorStop(1, col + "00");
      g.fillStyle = grad;
      g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    const size = Math.min(h * 0.62, (w * 1.5) / Math.max(4, word.length));
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.rotate((rand() - 0.5) * 0.18);
    g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = size * 0.28;
    g.strokeStyle = "#1d1d1f";
    g.strokeText(word, 0, 0);
    g.lineWidth = size * 0.12;
    g.strokeStyle = "#ffffff";
    g.strokeText(word, 0, 0);
    g.fillStyle = pick(SPRAY);
    g.fillText(word, 0, 0);
    g.restore();
    // drips
    g.fillStyle = pick(SPRAY);
    for (let i = 0; i < 5; i++) g.fillRect(x + rand() * w, y + h * (0.55 + rand() * 0.2), 2, h * (0.1 + rand() * 0.25));
  };
  return canvasTexture(1024, 256, (g) => {
    // the mural: four panels side by side on grey concrete
    const bases = ["#6f747b", "#5b6168", "#7a7f86", "#666b72"];
    for (let i = 0; i < 4; i++) tag(g, i * 256, 0, 256, 128, GRAFFITI_WORDS[i], bases[i]);
    // the shutters: corrugated grey under the paint
    for (let i = 0; i < 4; i++) {
      tag(g, i * 256, 128, 256, 128, GRAFFITI_WORDS[4 + i], "#8d939a");
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (let y = 128; y < 256; y += 8) g.fillRect(i * 256, y, 256, 2);
    }
  });
}

/** Collects quads with their own uv and colour into one textured mesh: the buildings, the graffiti. */
class Quads {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private c = new Color();

  /** A quad from corner `p` along `r` (its width) and `u` (its height), facing r x u; uv from (u0, v0) to (u1, v1). */
  quad(p: Vector3, r: Vector3, u: Vector3, uv: [number, number, number, number], colour: number): void {
    const [u0, v0, u1, v1] = uv;
    const a = p;
    const b = p.clone().add(r);
    const c = b.clone().add(u);
    const d = p.clone().add(u);
    for (const [v, s, t] of [
      [a, u0, v0],
      [b, u1, v0],
      [c, u1, v1],
      [a, u0, v0],
      [c, u1, v1],
      [d, u0, v1],
    ] as const) {
      this.pos.push(v.x, v.y, v.z);
      this.uv.push(s, t);
    }
    this.c.setHex(colour);
    for (let i = 0; i < 6; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }

  build(parent: Object3D, map: CanvasTexture): Mesh {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    const mesh = new Mesh(g, new MeshLambertMaterial({ map, vertexColors: true }));
    parent.add(mesh);
    return mesh;
  }
}

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** One building: a box whose four walls carry the window grid and whose roof is plain wall colour. */
function building(walls: Quads, cx: number, cz: number, w: number, d: number, h: number, colour: number, rand: () => number): void {
  const hx = w / 2;
  const hz = d / 2;
  // a random whole-window offset, so neighbours don't share a pattern of lit windows
  const ou = Math.floor(rand() * CELLS) / CELLS;
  const ov = Math.floor(rand() * CELLS) / CELLS;
  const span = CELLS * COL_W;
  const tall = CELLS * FLOOR_H;
  const wall = (p: Vector3, r: Vector3, len: number) => walls.quad(p, r, v3(0, h, 0), [ou, ov, ou + len / span, ov + h / tall], colour);
  wall(v3(cx - hx, 0, cz + hz), v3(w, 0, 0), w);
  wall(v3(cx + hx, 0, cz - hz), v3(-w, 0, 0), w);
  wall(v3(cx + hx, 0, cz + hz), v3(0, 0, -d), d);
  wall(v3(cx - hx, 0, cz - hz), v3(0, 0, d), d);
  // the roof: one texel of plain wall (between windows)
  const t = 1.5 / (CELLS * CELL_PX);
  walls.quad(v3(cx - hx, h, cz + hz), v3(w, 0, 0), v3(0, 0, -d), [t, 1 - t, t, 1 - t], colour);
}

/** What stands on a roof: a parapet, and sometimes a water tower, a stair hut, plant boxes or an antenna. */
function rooftop(paint: Painter, cx: number, cz: number, w: number, d: number, h: number, colour: number, rand: () => number): void {
  const dark = new Color(colour).multiplyScalar(0.7).getHex();
  // the parapet: a low lip round the edge
  paint.box(w + 0.3, 0.6, 0.3, cx, h + 0.3, cz + d / 2, dark);
  paint.box(w + 0.3, 0.6, 0.3, cx, h + 0.3, cz - d / 2, dark);
  paint.box(0.3, 0.6, d, cx - w / 2, h + 0.3, cz, dark);
  paint.box(0.3, 0.6, d, cx + w / 2, h + 0.3, cz, dark);
  const k = rand();
  const ox = (rand() - 0.5) * (w - 4);
  const oz = (rand() - 0.5) * (d - 4);
  if (h < 45 && k < 0.45) {
    // the water tower: a wooden tank on legs, a cone roof
    const x = cx + ox;
    const z = cz + oz;
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) paint.box(0.15, 2.2, 0.15, x + lx, h + 1.1, z + lz, 0x3a3a3c);
    paint.add(new CylinderGeometry(1.3, 1.3, 2.6, 10).translate(x, h + 3.5, z), 0x8b5a3c);
    paint.add(new ConeGeometry(1.45, 1.2, 10).translate(x, h + 5.4, z), 0x4a3426);
  } else if (k < 0.7) {
    // an antenna mast with a cross bar
    const x = cx + ox;
    const z = cz + oz;
    const mast = 4 + rand() * (h > 45 ? 14 : 6);
    paint.add(new CylinderGeometry(0.08, 0.14, mast, 5).translate(x, h + mast / 2, z), 0x50555c);
    paint.box(1.6, 0.08, 0.08, x, h + mast * 0.7, z, 0x50555c);
    paint.box(0.25, 0.25, 0.25, x, h + mast, z, 0xee334e, true);
  }
  // a stair hut and the plant boxes on most roofs
  if (rand() < 0.7) paint.box(2.6, 2.4, 2.6, cx - ox * 0.5, h + 1.2, cz - oz * 0.5, 0x9a9ea3);
  if (rand() < 0.6) paint.box(1.6, 1, 1.2, cx + (rand() - 0.5) * (w - 3), h + 0.5, cz + (rand() - 0.5) * (d - 3), 0xc8ccd0);
}

/** A row of buildings along a street, facing the court. */
interface Row {
  /** "x": the row runs along x, its fronts at z = front; "z": along z, fronts at x = front. */
  along: "x" | "z";
  from: number;
  to: number;
  front: number;
  /** Which way the buildings extend from their front (+1 or -1 along the other axis). */
  back: 1 | -1;
  floors: (at: number) => [number, number];
  depth: [number, number];
  /** Shops on the ground floor, facing the court. */
  shops: boolean;
  glass?: number;
  /** The gap between buildings: [chance of one, its most metres]. */
  gaps?: [number, number];
}

function row(walls: Quads, graffiti: Quads, paint: Painter, r: Row, rand: () => number): void {
  let at = r.from + rand() * 2;
  while (at < r.to) {
    const cols = 3 + Math.floor(rand() * 4);
    const w = cols * COL_W;
    const mid = at + w / 2;
    const [lo, hi] = r.floors(mid);
    const floors = lo + Math.floor(rand() * (hi - lo + 1));
    const h = floors * FLOOR_H;
    const d = r.depth[0] + rand() * (r.depth[1] - r.depth[0]);
    const glass = r.glass !== undefined && rand() < r.glass;
    const colour = glass ? GLASS[Math.floor(rand() * GLASS.length)] : WALLS[Math.floor(rand() * WALLS.length)];
    const cx = r.along === "x" ? mid : r.front + (r.back * d) / 2;
    const cz = r.along === "x" ? r.front + (r.back * d) / 2 : mid;
    const bw = r.along === "x" ? w : d;
    const bd = r.along === "x" ? d : w;
    building(walls, cx, cz, bw, bd, h, colour, rand);
    rooftop(paint, cx, cz, bw, bd, h, colour, rand);
    if (r.shops) shopfronts(graffiti, paint, r, at, w, rand);
    const [chance, most] = r.gaps ?? [0.35, 3.5];
    at += w + (rand() < chance ? 1 + rand() * (most - 1) : 0);
  }
}

/** The ground floor facing the court: shop windows with an awning, or a graffiti'd roller shutter. */
function shopfronts(graffiti: Quads, paint: Painter, r: Row, at: number, w: number, rand: () => number): void {
  // the court is on the -back side; a front faces -back
  const out = -r.back;
  const place = (along: number, sx: number, sy: number, sz: number, y: number, off: number, colour: number, unlit = false) => {
    if (r.along === "x") paint.box(sx, sy, sz, along, y, r.front + out * off, colour, unlit);
    else paint.box(sz, sy, sx, r.front + out * off, y, along, colour, unlit);
  };
  const units = Math.max(1, Math.round(w / 6));
  const uw = w / units;
  for (let i = 0; i < units; i++) {
    const c = at + uw * (i + 0.5);
    if (rand() < 0.35) {
      // a roller shutter, sprayed: one of the atlas's four tags
      const tile = Math.floor(rand() * 4);
      const sw = uw - 0.8;
      const uv: [number, number, number, number] = [tile / 4, 0, (tile + 1) / 4, 0.5];
      if (r.along === "x") {
        // a quad facing +z is drawn left to right along +x; one facing -z right to left
        const p = out > 0 ? v3(c - sw / 2, 0.05, r.front + 0.06) : v3(c + sw / 2, 0.05, r.front - 0.06);
        graffiti.quad(p, v3(out * sw, 0, 0), v3(0, 3.1, 0), uv, 0xffffff);
      } else {
        const p = out > 0 ? v3(r.front + 0.06, 0.05, c + sw / 2) : v3(r.front - 0.06, 0.05, c - sw / 2);
        graffiti.quad(p, v3(0, 0, -out * sw), v3(0, 3.1, 0), uv, 0xffffff);
      }
      place(c, uw - 0.4, 0.4, 0.3, 3.3, 0.15, 0x50555c);
    } else {
      // dark shop glass in a pale frame, an awning in a bright colour above
      place(c, uw - 0.4, 3.2, 0.2, 1.7, 0.1, 0xd7d3cb);
      place(c, uw - 0.9, 2.5, 0.2, 1.5, 0.14, 0x2a3440);
      place(c, uw - 0.2, 0.25, 1.4, 3.5, 0.7, AWNINGS[Math.floor(rand() * AWNINGS.length)]);
    }
  }
}

/** A parked car, pointing along +x unless `turned`. */
function car(paint: Painter, x: number, z: number, turned: boolean, colour: number): void {
  const m = new Matrix4().makeRotationY(turned ? Math.PI / 2 : 0).setPosition(x, ROAD_Y, z);
  paint.box(4.1, 0.75, 1.8, 0, 0.6, 0, colour, false, m);
  paint.box(2.2, 0.6, 1.62, -0.2, 1.25, 0, 0x26303b, false, m);
  paint.box(2.0, 0.08, 1.66, -0.2, 1.58, 0, colour, false, m);
  for (const wx of [-1.3, 1.3]) for (const wz of [-0.85, 0.85]) paint.add(new CylinderGeometry(0.34, 0.34, 0.24, 8).rotateX(Math.PI / 2).translate(wx, 0.34, wz).applyMatrix4(m), 0x1b1c1e);
  // head and tail lamps
  paint.box(0.05, 0.16, 1.4, 2.06, 0.75, 0, 0xfff4d0, true, m);
  paint.box(0.05, 0.16, 1.4, -2.06, 0.75, 0, 0xb3202c, true, m);
}

/** A street lamp at (x, z), its arm reaching towards (tx, tz). */
function lamp(paint: Painter, x: number, z: number, tx: number, tz: number): void {
  const a = Math.atan2(tx - x, tz - z);
  const m = new Matrix4().makeRotationY(a).setPosition(x, 0, z);
  paint.add(new CylinderGeometry(0.07, 0.11, 6.4, 6).translate(0, 3.2, 0).applyMatrix4(m), 0x3d434a);
  paint.add(new CylinderGeometry(0.16, 0.2, 0.6, 6).translate(0, 0.3, 0).applyMatrix4(m), 0x3d434a);
  paint.box(0.1, 0.1, 1.5, 0, 6.35, 0.7, 0x3d434a, false, m);
  paint.box(0.42, 0.16, 0.62, 0, 6.27, 1.4, 0x3d434a, false, m);
  paint.box(0.32, 0.04, 0.5, 0, 6.18, 1.4, 0xfff1c4, true, m);
}

function bench(paint: Painter, x: number, z: number, angle: number): void {
  const m = new Matrix4().makeRotationY(angle).setPosition(x, 0, z);
  paint.box(1.8, 0.07, 0.45, 0, 0.46, 0, 0x8b5a3c, false, m);
  paint.box(1.8, 0.4, 0.06, 0, 0.75, -0.22, 0x8b5a3c, false, m);
  for (const lx of [-0.75, 0.75]) paint.box(0.08, 0.46, 0.4, lx, 0.23, 0, 0x2f3338, false, m);
}

/** A small street tree in a pit: trunk, cone and crown, painted in with the rest. */
function streetTree(paint: Painter, x: number, z: number, s: number): void {
  paint.box(1.1, 0.06, 1.1, x, 0.02, z, 0x5b4636);
  paint.add(new CylinderGeometry(0.13 * s, 0.18 * s, 2 * s, 6).translate(x, s, z), 0x6b4a2f);
  paint.add(new IcosahedronGeometry(1.3 * s, 0).translate(x, 2.7 * s, z), 0x3d8f45);
  paint.add(new ConeGeometry(1.1 * s, 2.2 * s, 7).translate(x, 3.5 * s, z), 0x2f7a3a);
}

/** A traffic light on a pole at (x, z), facing along the angle. */
function trafficLight(paint: Painter, x: number, z: number, angle: number): void {
  const m = new Matrix4().makeRotationY(angle).setPosition(x, 0, z);
  paint.add(new CylinderGeometry(0.07, 0.09, 3.4, 6).translate(0, 1.7, 0).applyMatrix4(m), 0x2f3338);
  paint.box(0.36, 1.0, 0.3, 0, 3.6, 0, 0x22252a, false, m);
  paint.box(0.2, 0.2, 0.02, 0, 3.92, 0.16, 0x5a1a1a, true, m);
  paint.box(0.2, 0.2, 0.02, 0, 3.6, 0.16, 0x5a4a1a, true, m);
  paint.box(0.2, 0.2, 0.02, 0, 3.28, 0.16, 0x3cff7a, true, m);
}

/** The sky: a hazy city gradient, a few flat clouds, and the far skyline as pale silhouettes. */
function citySky(scene: Scene, paint: Painter, rand: () => number): void {
  scene.background = canvasTexture(2, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#2f7fcf");
    grad.addColorStop(0.5, "#8cc0ea");
    grad.addColorStop(0.85, "#d8e4ee");
    grad.addColorStop(1, "#ece6da");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
  });
  scene.fog = new Fog(0xd8e2ea, 80, 330);
  // clouds: flattened puffs, high and far
  for (let c = 0; c < 9; c++) {
    const cx = (rand() - 0.5) * 360;
    const cy = 70 + rand() * 40;
    const cz = -200 - rand() * 60;
    for (let p = 0; p < 4; p++) {
      const s = 7 + rand() * 6;
      paint.add(new IcosahedronGeometry(1, 1).scale(s * 1.6, s * 0.6, s).translate(cx + (p - 1.5) * 9 + rand() * 5, cy + rand() * 4, cz), p % 2 ? 0xf6f9fb : 0xe9eff4, true);
    }
  }
  // the skyline: towers in two hazy tones, some with a spire, all round the city
  const towers = (n: number, place: (i: number) => [number, number], tone: number) => {
    for (let i = 0; i < n; i++) {
      const [x, z] = place(i);
      const w = 10 + rand() * 18;
      const h = 30 + rand() * rand() * 130;
      paint.box(w, h, w, x, h / 2 - 1, z, tone, true);
      if (rand() < 0.3) paint.box(w * 0.55, h * 0.18, w * 0.55, x, h + h * 0.09 - 1, z, tone, true);
      if (rand() < 0.2) paint.add(new ConeGeometry(0.6, 18, 4).translate(x, h * 1.12 + 8, z), tone, true);
    }
  };
  towers(30, (i) => [-260 + i * 18 + rand() * 8, -190 - rand() * 40], 0xa9b8c7);
  towers(22, (i) => [-240 + i * 22 + rand() * 10, -150 - rand() * 20], 0x96a7b8);
  for (const s of [-1, 1]) towers(14, (i) => [s * (150 + rand() * 50), -140 + i * 22 + rand() * 8], 0xa2b2c2);
  towers(12, (i) => [-200 + i * 36 + rand() * 10, 170 + rand() * 30], 0xa9b8c7);
}

/** The light the city is baked with: the court's own hemisphere and sun (court.ts). */
export const CITY_LIGHTS: BakeLights = { sky: 0xe6f4ff, ground: 0x6a6e72, hemi: 1.5, sun: 0xfff3dc, sunIntensity: 2.2, sunDir: new Vector3(8, 16, 10) };

/** Builds the city round the court's block into `parent` (its own group, four draw calls), and sets the scene's sky and fog. */
export function buildCity(scene: Scene, parent: Object3D, block: Block): void {
  const rand = rng(2026);
  const paint = new Painter();
  const walls = new Quads();
  const graffiti = new Quads();
  const { fenceX, fenceBack, fenceFront } = block;

  // the street grid: the court's block (a sidewalk round the fence), a road
  // on each side, then the sidewalk under the buildings
  const inX = fenceX + SIDEWALK;
  const backZ = fenceBack - SIDEWALK;
  const frontZ = fenceFront + SIDEWALK;
  const outX = inX + ROAD;
  const outBack = backZ - ROAD;
  const outFront = frontZ + ROAD;
  const rowX = outX + SIDEWALK;
  const rowBack = outBack - SIDEWALK;
  const rowFront = outFront + SIDEWALK;

  paint.add(new PlaneGeometry(900, 900).rotateX(-Math.PI / 2).translate(0, ROAD_Y, 0), 0x3b3e44);
  const slab = (x0: number, x1: number, z0: number, z1: number, colour = 0xa3a39c) => paint.box(x1 - x0, KERB, z1 - z0, (x0 + x1) / 2, ROAD_Y + KERB / 2, (z0 + z1) / 2, colour);
  // the court's block (the court's own pad covers its middle)
  slab(-inX, inX, backZ, frontZ);
  // the sidewalks across the roads, under every row of buildings
  slab(-200, 200, rowBack - 60, outBack);
  slab(-200, 200, outFront, rowFront + 60);
  for (const s of [-1, 1]) slab(s > 0 ? outX : -outX - 60 - SIDEWALK, s > 0 ? outX + 60 + SIDEWALK : -outX, outBack, outFront);

  // road markings: dashed centre lines, the kerbside lines, crosswalks at the block's corners
  const mark = (w: number, d: number, x: number, z: number, colour = 0xd9d6cc) => paint.box(w, 0.01, d, x, ROAD_Y + 0.02, z, colour, true);
  const midBack = (backZ + outBack) / 2;
  const midFront = (frontZ + outFront) / 2;
  for (let x = -120; x < 120; x += 6) {
    if (Math.abs(Math.abs(x) - (inX + ROAD / 2)) < 6) continue;
    mark(3, 0.14, x, midBack, 0xe8c547);
    mark(3, 0.14, x, midFront, 0xe8c547);
  }
  for (const s of [-1, 1]) {
    const midSide = s * (inX + ROAD / 2);
    for (let z = outBack - 80; z < outFront + 80; z += 6) {
      if (Math.abs(z - midBack) < 6 || Math.abs(z - midFront) < 6) continue;
      mark(0.14, 3, midSide, z, 0xe8c547);
    }
    // zebra crossings over the back road and the side roads, by each corner
    for (let k = 0; k < 6; k++) {
      const zz = backZ - 0.8 - k * 1.3;
      mark(3, 0.6, s * (inX - 2.2), zz);
      const xx = s * (inX + 0.8 + k * 1.3);
      mark(0.6, 3, xx, backZ + 2.2);
      mark(0.6, 3, xx, frontZ - 2.2);
    }
  }

  // the buildings: low shops across the street behind the hoop (so the
  // skyline shows over them above the board), mid-rises down both sides,
  // taller rows behind, towers further back
  // (the player's camera sees only about 12 degrees over the horizon above
  // the board, so the rows behind the hoop step up with distance and the
  // far towers stand apart, sky and the skyline between them)
  const behindHoop = (x: number): [number, number] => (Math.abs(x) < 18 ? [2, 2] : Math.abs(x) < 40 ? [4, 8] : [5, 12]);
  row(walls, graffiti, paint, { along: "x", from: -95, to: 95, front: rowBack, back: -1, floors: behindHoop, depth: [10, 14], shops: true }, rand);
  row(walls, graffiti, paint, { along: "x", from: -110, to: 110, front: rowBack - 22, back: -1, floors: (x) => (Math.abs(x) < 24 ? [3, 4] : [7, 14]), depth: [12, 16], shops: false, glass: 0.3, gaps: [0.6, 6] }, rand);
  row(walls, graffiti, paint, { along: "x", from: -130, to: 130, front: rowBack - 48, back: -1, floors: (x) => (Math.abs(x) < 30 ? [4, 9] : [12, 34]), depth: [14, 18], shops: false, glass: 0.6, gaps: [0.9, 14] }, rand);
  for (const s of [-1, 1] as const) {
    row(walls, graffiti, paint, { along: "z", from: rowBack + 1, to: rowFront + 30, front: s * rowX, back: s, floors: () => [4, 12], depth: [11, 14], shops: true }, rand);
    row(walls, graffiti, paint, { along: "z", from: rowBack + 1, to: rowFront + 40, front: s * (rowX + 20), back: s, floors: () => [10, 24], depth: [12, 16], shops: false, glass: 0.5 }, rand);
  }
  row(walls, graffiti, paint, { along: "x", from: -rowX + 1, to: rowX - 1, front: rowFront, back: 1, floors: () => [4, 10], depth: [11, 14], shops: true }, rand);

  // the graffiti walls behind the bleachers, just outside the fence
  const wallX = fenceX + 1.1;
  const wz0 = fenceBack + 1;
  const wz1 = fenceFront - 3;
  const wallH = 2.6;
  for (const s of [-1, 1]) {
    paint.box(0.3, wallH, wz1 - wz0, s * wallX, wallH / 2, (wz0 + wz1) / 2, 0x7d8188);
    paint.box(0.4, 0.15, wz1 - wz0 + 0.1, s * wallX, wallH + 0.07, (wz0 + wz1) / 2, 0x9a9ea3);
    // the mural on the side facing the court: the atlas's top half, once along the wall
    // (a quad faces r x up: +z along the wall faces -x, -z faces +x)
    const p = s > 0 ? v3(wallX - 0.16, 0, wz0) : v3(-wallX + 0.16, 0, wz1);
    graffiti.quad(p, v3(0, 0, s > 0 ? wz1 - wz0 : wz0 - wz1), v3(0, wallH, 0), [0, 0.5, 1, 1], 0xffffff);
    // and the side facing the street
    const q = s > 0 ? v3(wallX + 0.16, 0, wz1) : v3(-wallX - 0.16, 0, wz0);
    graffiti.quad(q, v3(0, 0, s > 0 ? wz0 - wz1 : wz1 - wz0), v3(0, wallH, 0), [0, 0.5, 1, 1], 0xffffff);
  }

  // street lamps round the court's block, arms over the court
  for (const s of [-1, 1]) {
    lamp(paint, s * (inX - 0.6), backZ + 0.6, 0, 4);
    lamp(paint, s * (inX - 0.6), frontZ - 0.6, 0, 4);
    lamp(paint, s * (inX - 0.6), (backZ + frontZ) / 2, 0, (backZ + frontZ) / 2);
    lamp(paint, s * 9, backZ + 0.6, s * 9, 0);
    // and along the far sidewalks, over the road
    for (let z = outBack + 4; z < outFront; z += 14) lamp(paint, s * (outX + 0.6), z, 0, z);
    for (const x of [24, 48, 72]) lamp(paint, s * x, outBack - 0.6, s * x, backZ);
  }
  // traffic lights at the back corners
  for (const s of [-1, 1]) {
    trafficLight(paint, s * (inX - 0.4), backZ + 0.4, s > 0 ? Math.PI / 2 : -Math.PI / 2);
    trafficLight(paint, s * (outX + 0.4), outBack - 0.4, 0);
  }

  // parked cars along the kerbs
  const kerbCars = (positions: number[], fixed: number, turned: boolean) => {
    for (const p of positions) {
      if (rand() < 0.2) continue;
      const colour = CARS[Math.floor(rand() * CARS.length)];
      if (turned) car(paint, fixed, p, true, colour);
      else car(paint, p, fixed, false, colour);
    }
  };
  kerbCars([-60, -50, -40, -30, 22, 30, 40, 52, 62], outBack + 1.2, false);
  kerbCars([-34, -20, -14, 16, 26, 44], backZ - 1.2, false);
  kerbCars([-26, -14, 14, 26], outFront - 1.2, false);
  for (const s of [-1, 1]) {
    kerbCars([backZ + 8, backZ + 14, frontZ - 10, frontZ - 4, frontZ + 14], s * (outX - 1.2), true);
    kerbCars([backZ + 3, backZ + 18, frontZ - 6], s * (inX + 1.2), true);
  }

  // benches, a hydrant and bins on the block's sidewalk; trees on the far sidewalks
  for (const s of [-1, 1]) {
    bench(paint, s * 5.5, backZ + 1.1, 0);
    bench(paint, s * 4, frontZ - 1.1, Math.PI);
    paint.add(new CylinderGeometry(0.14, 0.17, 0.7, 8).translate(s * 12, 0.35, backZ + 0.7), 0xd23a3a);
    paint.add(new CylinderGeometry(0.3, 0.26, 0.9, 8).translate(s * 2.5, 0.45, frontZ - 0.8), 0x2f6f4f);
    for (let z = outBack + 10; z < outFront; z += 14) streetTree(paint, s * (outX + 1.8), z, 0.8 + rand() * 0.3);
    for (const x of [30, 54, 80]) streetTree(paint, s * x, outBack - 1.8, 0.8 + rand() * 0.3);
  }
  for (const x of [-30, -12, 12, 30]) streetTree(paint, x, outFront + 1.8, 0.8 + rand() * 0.3);

  citySky(scene, paint, rand);

  const city = new Group();
  city.name = "city";
  walls.build(city, windowTexture(rng(31)));
  graffiti.build(city, graffitiTexture(rng(17)));
  paint.build(city);
  // the city never moves and nor does the sun: its light goes into its vertex colours
  bakeLighting(city, CITY_LIGHTS);
  parent.add(city);
}
