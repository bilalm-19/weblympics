import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  DirectionalLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Group,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COURT } from "../../../shared/games/tennis/sim.ts";
import { CROWD_SECTIONS, INNER, STANDS, TIERS, TIER_DEPTH, TIER_RISE, WALL_H, AISLE_HALF, crowdLayout, rng } from "./crowd-layout.ts";
import type { CrowdLayout, CrowdSection, Stand } from "./crowd-layout.ts";

// The arena, built from primitives so there are no assets to ship. Static
// parts are painted with vertex colours and merged into two meshes (lit and
// unlit), so all the detail costs two draw calls; repeated things (crowd,
// trees, clouds) are instanced, one draw call each. Low-poly, flat-shaded,
// no post-processing.

const W = COURT.halfW;
const L = COURT.halfL;

// Weblympics palette (task 14): the five ring colours.
export const PALETTE = { blue: 0x0081c8, yellow: 0xfcb131, black: 0x1d1d1f, green: 0x00a651, red: 0xee334e } as const;

/** Each crowd section's seat colour, so the four halves read apart at a glance (task 19 drives them). */
export const SECTION_COLOUR: Record<CrowdSection, number> = {
  left: PALETTE.blue,
  right: PALETTE.red,
  frontLeft: PALETTE.green,
  frontRight: PALETTE.yellow,
};

/**
 * Collects static geometry, each piece with one colour, and merges it into one
 * lit (flat-shaded Lambert) and one unlit mesh: lots of detail, two draw calls.
 */
export class Painter {
  private lit: BufferGeometry[] = [];
  private unlit: BufferGeometry[] = [];
  private colour = new Color();

  add(geometry: BufferGeometry, colour: number, unlit = false): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute("uv");
    const n = g.getAttribute("position").count;
    this.colour.setHex(colour);
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([this.colour.r, this.colour.g, this.colour.b], i * 3);
    g.setAttribute("color", new Float32BufferAttribute(rgb, 3));
    (unlit ? this.unlit : this.lit).push(g);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, colour: number, unlit = false, m?: Matrix4): void {
    const g = new BoxGeometry(w, h, d).translate(x, y, z);
    this.add(m ? g.applyMatrix4(m) : g, colour, unlit);
  }

  build(parent: Object3D): void {
    if (this.lit.length) parent.add(new Mesh(mergeGeometries(this.lit), new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    if (this.unlit.length) parent.add(new Mesh(mergeGeometries(this.unlit), new MeshBasicMaterial({ vertexColors: true })));
  }
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d") as CanvasRenderingContext2D);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Mown-grass bands across a plane, `bands` of them over its length. */
function stripes(light: string, dark: string, bands: number): CanvasTexture {
  const tex = canvasTexture(1, 2, (g) => {
    g.fillStyle = light;
    g.fillRect(0, 0, 1, 1);
    g.fillStyle = dark;
    g.fillRect(0, 1, 1, 1);
  });
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(1, bands / 2);
  return tex;
}

// the court's playing surface: lines plus room to run behind and beside them
const SURFACE = { halfW: W + 2.4, halfL: L + 4.5 };

/** The court's grass: mown bands, and worn patches behind each baseline and at the service T. */
function courtTexture(): CanvasTexture {
  const cw = 128;
  const ch = 512;
  const pxX = cw / (SURFACE.halfW * 2);
  const pxZ = ch / (SURFACE.halfL * 2);
  return canvasTexture(cw, ch, (g) => {
    const bands = 14;
    for (let b = 0; b < bands; b++) {
      g.fillStyle = b % 2 ? "#5fb34c" : "#6cc257";
      g.fillRect(0, (b * ch) / bands, cw, ch / bands + 1);
    }
    const wear = (zMetres: number, rx: number, rz: number, alpha: number) => {
      const cx = cw / 2;
      const cy = (SURFACE.halfL + zMetres) * pxZ;
      g.save();
      g.translate(cx, cy);
      g.scale(rx * pxX, rz * pxZ);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, `rgba(196, 178, 104, ${alpha})`);
      grad.addColorStop(0.6, `rgba(170, 170, 92, ${alpha * 0.55})`);
      grad.addColorStop(1, "rgba(170, 170, 92, 0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, 1, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    for (const s of [-1, 1]) {
      wear(s * (L + 0.9), 3.4, 1.9, 0.75);
      wear(s * L * 0.55, 1.2, 1, 0.3);
    }
  });
}

function sky(scene: Scene, arena: Object3D, paint: Painter): void {
  scene.background = canvasTexture(2, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#2f86dc");
    grad.addColorStop(0.5, "#86c4f4");
    grad.addColorStop(0.85, "#d6edfc");
    grad.addColorStop(1, "#f4e9d2");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
  });
  scene.fog = new Fog(0xcde8fa, 60, 140);

  // soft clouds: clusters of flattened puffs, high and far
  const rand = rng(7);
  const puff = new IcosahedronGeometry(1, 1);
  const clouds = new InstancedMesh(puff, new MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb8cc }), 40);
  const m = new Matrix4();
  const o = new Object3D();
  let i = 0;
  for (let c = 0; c < 8; c++) {
    const cx = (rand() - 0.5) * 140;
    const cy = 24 + rand() * 14;
    const cz = -70 - rand() * 30;
    for (let p = 0; p < 5; p++) {
      o.position.set(cx + (p - 2) * 3.2 + rand() * 2, cy + rand() * 1.5, cz + rand() * 3);
      const s = 2.6 + rand() * 2.2;
      o.scale.set(s * 1.4, s * 0.7, s);
      o.updateMatrix();
      clouds.setMatrixAt(i++, m.copy(o.matrix));
    }
  }
  clouds.count = i;
  arena.add(clouds);

  // distant hills, two tones
  [-60, -25, 15, 50, 85].forEach((x, k) => {
    const g = new IcosahedronGeometry(1, 1);
    g.scale(28 + k * 3, 9 + (k % 2) * 5, 14);
    g.translate(x - 15, -2, -95);
    paint.add(g, k % 2 ? 0x6f9a6a : 0x7fa874);
  });
}

function grounds(scene: Object3D, paint: Painter): void {
  const outside = new Mesh(new PlaneGeometry(220, 220), new MeshLambertMaterial({ color: 0x3f7f45 }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.05;

  const inner = new Mesh(
    new PlaneGeometry(INNER.halfW * 2, INNER.halfL * 2),
    new MeshLambertMaterial({ map: stripes("#4f9a41", "#47903a", Math.round(INNER.halfL)) }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = -0.02;

  // the court itself, brighter so it stays the focus, worn where players stand
  const court = new Mesh(new PlaneGeometry(SURFACE.halfW * 2, SURFACE.halfL * 2), new MeshLambertMaterial({ map: courtTexture() }));
  court.rotation.x = -Math.PI / 2;
  court.position.y = -0.01;
  scene.add(outside, inner, court);

  // white lines, slightly raised, unlit so they stay crisp
  const line = (w: number, d: number, x: number, z: number) => paint.box(w, 0.02, d, x, 0.005, z, 0xffffff, true);
  const service = L * 0.55;
  const t = 0.1;
  line(W * 2 + t, t, 0, L);
  line(W * 2 + t, t, 0, -L);
  line(t, L * 2, -W, 0);
  line(t, L * 2, W, 0);
  line(W * 2, t, 0, service);
  line(W * 2, t, 0, -service);
  line(t, service * 2, 0, 0);
  line(t, 0.35, 0, L - 0.17);
  line(t, 0.35, 0, -L + 0.17);
  // a thin dark edge round the playing surface
  const e = 0.06;
  for (const s of [-1, 1]) {
    paint.box(SURFACE.halfW * 2, 0.012, e, 0, 0.0, s * SURFACE.halfL, 0x3f8a37, true);
    paint.box(e, 0.012, SURFACE.halfL * 2, s * SURFACE.halfW, 0.0, 0, 0x3f8a37, true);
  }
}

function net(scene: Object3D, paint: Painter): void {
  const width = W * 2 + 0.8;
  const mesh = canvasTexture(64, 16, (g) => {
    g.clearRect(0, 0, 64, 16);
    g.strokeStyle = "rgba(20,24,28,0.85)";
    g.lineWidth = 1;
    for (let x = 0.5; x < 64; x += 4) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 16);
      g.stroke();
    }
    for (let y = 0.5; y < 16; y += 4) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(64, y);
      g.stroke();
    }
  });
  mesh.wrapS = mesh.wrapT = RepeatWrapping;
  mesh.repeat.set(width / 1.2, 1);
  const netPlane = new Mesh(
    new PlaneGeometry(width, COURT.netH - 0.08),
    new MeshBasicMaterial({ map: mesh, transparent: true, side: DoubleSide, depthWrite: false }),
  );
  netPlane.position.y = (COURT.netH - 0.08) / 2;
  scene.add(netPlane);

  // the white band on top, the centre strap, posts with caps and a winder
  paint.box(width, 0.08, 0.04, 0, COURT.netH - 0.04, 0, 0xffffff, true);
  paint.box(0.06, COURT.netH - 0.06, 0.045, 0, (COURT.netH - 0.06) / 2, 0, 0xf4f4f4, true);
  // a dark skirt along the bottom, like a real net's cord
  paint.box(width, 0.05, 0.03, 0, 0.025, 0, 0x2b2f36, true);
  const postH = COURT.netH + 0.1;
  for (const s of [-1, 1]) {
    paint.add(new CylinderGeometry(0.06, 0.07, postH, 8).translate((s * width) / 2, postH / 2, 0), 0x2f3a46);
    paint.add(new CylinderGeometry(0.085, 0.085, 0.05, 8).translate((s * width) / 2, postH + 0.02, 0), PALETTE.yellow);
    paint.box(0.08, 0.08, 0.12, (s * width) / 2 + s * 0.06, 0.55, 0, 0x8a96a3);
  }
}

/** A seated or crouched person made of a few boxes, merged into the static mesh. */
function figure(paint: Painter, m: Matrix4, shirt: number, crouch = false): void {
  const skin = 0xf0c8a0;
  if (crouch) {
    paint.box(0.32, 0.32, 0.26, 0, 0.42, 0, shirt, false, m);
    paint.box(0.3, 0.26, 0.34, 0, 0.13, 0.05, 0x2b303b, false, m);
    paint.add(new IcosahedronGeometry(0.14, 1).translate(0, 0.74, 0).applyMatrix4(m), skin);
    paint.add(new IcosahedronGeometry(0.145, 1).scale(1, 0.55, 1).translate(0, 0.82, 0.01).applyMatrix4(m), shirt);
    return;
  }
  paint.box(0.44, 0.58, 0.3, 0, 0.29, 0, shirt, false, m);
  paint.box(0.42, 0.14, 0.4, 0, -0.05, 0.12, 0x2b303b, false, m);
  paint.add(new IcosahedronGeometry(0.19, 1).translate(0, 0.78, 0).applyMatrix4(m), skin);
  // a cap with a peak
  paint.add(new CylinderGeometry(0.18, 0.2, 0.1, 10).translate(0, 0.92, 0).applyMatrix4(m), 0xffffff);
  paint.box(0.22, 0.03, 0.14, 0, 0.88, 0.2, 0xffffff, false, m);
}

/** Umpire's chair at the net, ball kids at the posts, the players' benches opposite. */
function courtside(paint: Painter): void {
  const o = new Object3D();
  const place = (x: number, y: number, z: number, angle: number): Matrix4 => {
    o.position.set(x, y, z);
    o.rotation.set(0, angle, 0);
    o.updateMatrix();
    return o.matrix.clone();
  };

  // umpire's chair: four legs, a platform, a ladder, a seat, a parasol
  const cx = -(W + 2.6);
  const chair = place(cx, 0, 0, Math.PI / 2); // facing +x, the court
  const frame = 0x2f3a46;
  for (const [lx, lz] of [
    [-0.4, -0.4],
    [0.4, -0.4],
    [-0.4, 0.4],
    [0.4, 0.4],
  ]) {
    paint.box(0.08, 2, 0.08, lx, 1, lz, frame, false, chair);
  }
  for (const y of [0.5, 1, 1.5]) paint.box(0.84, 0.05, 0.05, 0, y, -0.4, frame, false, chair);
  paint.box(1, 0.08, 1, 0, 2.04, 0, PALETTE.green, false, chair);
  paint.box(0.6, 0.08, 0.5, 0, 2.38, -0.05, 0xffffff, false, chair);
  paint.box(0.6, 0.6, 0.08, 0, 2.7, -0.32, 0xffffff, false, chair);
  paint.box(0.95, 0.3, 0.06, 0, 2.25, 0.48, PALETTE.green, false, chair);
  paint.add(new CylinderGeometry(0.03, 0.03, 1.5, 6).translate(0, 3.3, -0.36).applyMatrix4(chair), frame);
  paint.add(new ConeGeometry(0.85, 0.32, 8).translate(0, 4.15, -0.36).applyMatrix4(chair), 0xffffff);
  paint.add(new ConeGeometry(0.87, 0.06, 8).translate(0, 3.99, -0.36).applyMatrix4(chair), PALETTE.blue);
  figure(paint, place(cx + 0.05, 2.44, 0, Math.PI / 2), 0x23305a);

  // ball kids, crouched by each net post, on the near side
  figure(paint, place(-(W + 1.3), 0, 1.1, Math.PI / 2 + 0.4), PALETTE.green, true);
  figure(paint, place(W + 1.3, 0, 1.1, -Math.PI / 2 - 0.4), PALETTE.green, true);

  // players' benches, a cooler and towels opposite the umpire
  const bx = W + 2.9;
  for (const z of [-1.7, 1.7]) {
    const bench = place(bx, 0, z, -Math.PI / 2);
    paint.box(1.5, 0.08, 0.45, 0, 0.45, 0, 0xffffff, false, bench);
    paint.box(1.5, 0.4, 0.06, 0, 0.75, -0.22, PALETTE.blue, false, bench);
    for (const lx of [-0.65, 0.65]) paint.box(0.06, 0.45, 0.4, lx, 0.225, 0, frame, false, bench);
    paint.box(0.4, 0.04, 0.3, 0.3, 0.51, 0, z < 0 ? PALETTE.red : PALETTE.yellow, false, bench);
  }
  const cooler = place(bx, 0, 0, -Math.PI / 2);
  paint.box(0.5, 0.36, 0.34, 0, 0.18, 0, PALETTE.blue, false, cooler);
  paint.box(0.52, 0.06, 0.36, 0, 0.39, 0, 0xffffff, false, cooler);
}

/** Boards along the low wall: panels in the five colours, each with a white stripe. */
function boards(paint: Painter): void {
  const colours = [PALETTE.blue, PALETTE.yellow, PALETTE.black, PALETTE.green, PALETTE.red];
  const H = 0.62;
  const run = (from: number, to: number, place: (c: number, len: number, inset: number) => void) => {
    const panel = 2.6;
    const gap = 0.16;
    const n = Math.floor((to - from + gap) / (panel + gap));
    const start = from + (to - from - (n * (panel + gap) - gap)) / 2;
    for (let i = 0; i < n; i++) place(start + i * (panel + gap) + panel / 2, panel, i);
  };
  const y = WALL_H / 2 - 0.02;
  // back wall (-z)
  run(-INNER.halfW + 0.4, INNER.halfW - 0.4, (x, len, i) => {
    const c = colours[i % 5];
    paint.box(len, H, 0.04, x, y, -INNER.halfL + 0.02, c, true);
    paint.box(len * 0.7, 0.07, 0.05, x, y, -INNER.halfL + 0.03, 0xffffff, true);
  });
  // side walls
  for (const s of [-1, 1]) {
    run(-INNER.halfL + 0.4, INNER.halfL - 0.4, (z, len, i) => {
      const c = colours[(i + (s > 0 ? 2 : 0)) % 5];
      paint.box(0.04, H, len, s * (INNER.halfW - 0.02), y, z, c, true);
      paint.box(0.05, 0.07, len * 0.7, s * (INNER.halfW - 0.03), y, z, 0xffffff, true);
    });
  }
}

function stands(scene: Object3D, paint: Painter): CrowdHandle {
  const o = new Object3D();
  const riser = [0xc9d0d8, 0xdfe4ea];
  for (const [name, s] of Object.entries(STANDS) as [keyof typeof STANDS, Stand][]) {
    o.position.set(s.x, 0, s.z);
    o.rotation.set(0, s.angle, 0);
    o.updateMatrix();
    const base = o.matrix.clone();
    // local frame: x along the stand, -z away from the court, y up
    const halves: { x0: number; x1: number; colour: number }[] =
      name === "front"
        ? [
            { x0: -s.length / 2, x1: 0, colour: SECTION_COLOUR.frontLeft },
            { x0: 0, x1: s.length / 2, colour: SECTION_COLOUR.frontRight },
          ]
        : [{ x0: -s.length / 2, x1: s.length / 2, colour: SECTION_COLOUR[name] }];
    for (let t = 0; t < TIERS; t++) {
      const h = WALL_H + (t + 1) * TIER_RISE;
      paint.box(s.length, h, TIER_DEPTH, 0, h / 2, -(t + 0.5) * TIER_DEPTH, riser[t % 2], false, base);
      // the row of seats: a coloured bench along each tier, in its section's colour
      for (const half of halves) {
        const len = half.x1 - half.x0;
        paint.box(len - 0.1, 0.12, 0.36, (half.x0 + half.x1) / 2, h + 0.06, -(t + 0.55) * TIER_DEPTH, half.colour, false, base);
        paint.box(len - 0.1, 0.34, 0.06, (half.x0 + half.x1) / 2, h + 0.2, -(t + 0.55) * TIER_DEPTH - 0.22, half.colour, false, base);
      }
      // aisles: pale stairs with a half step, cut through the benches
      for (const a of s.aisles) {
        paint.box(AISLE_HALF * 2, 0.04, TIER_DEPTH, a, h + 0.02, -(t + 0.5) * TIER_DEPTH, 0xf4f6f8, false, base);
        paint.box(AISLE_HALF * 2, TIER_RISE / 2, TIER_DEPTH / 2, a, h + TIER_RISE / 4, -(t + 0.75) * TIER_DEPTH, 0xeef1f4, false, base);
      }
    }
    // a rail along the front, a back wall, a canopy with a coloured fascia
    const top = WALL_H + TIERS * TIER_RISE;
    paint.box(s.length, 0.05, 0.05, 0, WALL_H + TIER_RISE + 0.9, -0.05, 0xf2f5e8, true, base);
    paint.box(s.length, 1.4, 0.25, 0, top + 0.7, -TIERS * TIER_DEPTH - 0.12, 0x34495e, false, base);
    const roofDepth = TIERS * TIER_DEPTH * 0.7;
    const roof = new BoxGeometry(s.length + 1, 0.15, roofDepth).rotateX(-0.12).translate(0, top + 3.2, -TIERS * TIER_DEPTH * 0.6);
    paint.add(roof.applyMatrix4(base), 0xf3f5f7);
    for (const half of halves) {
      const len = half.x1 - half.x0 + (name === "front" ? 0.5 : 1);
      const fascia = new BoxGeometry(len, 0.42, 0.12).translate((half.x0 + half.x1) / 2, top + 3.0 + Math.sin(0.12) * (roofDepth / 2 - 0.4) + 0.2, -TIERS * TIER_DEPTH * 0.6 + roofDepth / 2);
      paint.add(fascia.applyMatrix4(base), half.colour);
    }
    for (const x of [-s.length / 2, -s.length / 6, s.length / 6, s.length / 2]) {
      paint.box(0.18, 3.4, 0.18, x, top + 1.6, -TIERS * TIER_DEPTH + 0.3, 0x5b6b7b, false, base);
    }
  }

  // the low wall around the inner grass, with a bright cap
  const wall = (w: number, d: number, x: number, z: number) => paint.box(w, WALL_H, d, x, WALL_H / 2, z, 0x1e6b38);
  wall(INNER.halfW * 2 + 0.6, 0.3, 0, -INNER.halfL - 0.15);
  wall(0.3, INNER.halfL * 2, -INNER.halfW - 0.15, 0);
  wall(0.3, INNER.halfL * 2, INNER.halfW + 0.15, 0);
  paint.box(INNER.halfW * 2 + 0.6, 0.08, 0.34, 0, WALL_H, -INNER.halfL - 0.15, 0xffffff, true);
  paint.box(0.34, 0.08, INNER.halfL * 2, -INNER.halfW - 0.15, WALL_H, 0, 0xffffff, true);
  paint.box(0.34, 0.08, INNER.halfL * 2, INNER.halfW + 0.15, WALL_H, 0, 0xffffff, true);

  return crowd(scene);
}

const SHIRTS = [0xff5d5d, 0xffb347, 0xfff07a, 0x7ad8ff, 0x5d8bff, 0xc77dff, 0xff7ac8, 0xffffff, 0x7aff9b, 0xff9d5d];
const SKIN = [0xf6d2b0, 0xe8b48c, 0xc68a5e, 0x8d5a3b, 0xfbe0c8];
// share of each section's fans wearing its colour
const FAN_SHARE = 0.3;

/**
 * The crowd, for task 19 to drive. One instanced mesh for bodies and one for
 * heads; instance i of each is `layout.seats[i]`, and each section is a
 * contiguous run of instances (`layout.ranges`). To move someone, compose an
 * offset onto their rest matrix and call setMatrixAt, then flag
 * instanceMatrix.needsUpdate. Sections are sides as drawn on this client's
 * screen (the arena turns round for seat 1), see crowd-layout.ts.
 */
export interface CrowdHandle {
  layout: CrowdLayout;
  bodies: InstancedMesh;
  heads: InstancedMesh;
  /** Rest pose of each body and head, by instance. */
  restBody: Matrix4[];
  restHead: Matrix4[];
}

function crowd(scene: Object3D): CrowdHandle {
  return crowdMeshes(scene, crowdLayout());
}

/**
 * The instanced crowd for any seat layout: tennis's stands, or bowling's
 * seating behind the approach (task 29). Seeded, so a layout always looks
 * the same.
 */
export function crowdMeshes(scene: Object3D, layout: CrowdLayout, seed = 43): CrowdHandle {
  const rand = rng(seed);
  const n = layout.seats.length;
  const bodies = new InstancedMesh(new BoxGeometry(0.42, 0.55, 0.32), new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
  const heads = new InstancedMesh(new IcosahedronGeometry(0.17, 0), new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
  const color = new Color();
  const o = new Object3D();
  const restBody: Matrix4[] = [];
  const restHead: Matrix4[] = [];
  layout.seats.forEach((seat, i) => {
    const bob = (rand() - 0.5) * 0.08;
    const wide = 0.9 + rand() * 0.22;
    o.rotation.set(0, seat.facing + (rand() - 0.5) * 0.3, 0);
    o.position.set(seat.x, seat.y + 0.3 + bob, seat.z);
    o.scale.set(wide, 1, 1);
    o.updateMatrix();
    restBody.push(o.matrix.clone());
    bodies.setMatrixAt(i, o.matrix);
    o.position.y = seat.y + 0.72 + bob;
    o.scale.set(1, 1, 1);
    o.updateMatrix();
    restHead.push(o.matrix.clone());
    heads.setMatrixAt(i, o.matrix);
    const shirt = rand() < FAN_SHARE ? SECTION_COLOUR[seat.section] : SHIRTS[Math.floor(rand() * SHIRTS.length)];
    bodies.setColorAt(i, color.setHex(shirt));
    heads.setColorAt(i, color.setHex(SKIN[Math.floor(rand() * SKIN.length)]));
  });
  bodies.name = "crowd-bodies";
  heads.name = "crowd-heads";
  scene.add(bodies, heads);
  return { layout, bodies, heads, restBody, restHead };
}

function trees(scene: Object3D): void {
  const rand = rng(99);
  const spots: [number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    spots.push([side * (INNER.halfW + 14 + rand() * 10), -INNER.halfL - 6 + rand() * (INNER.halfL * 2 + 6)]);
  }
  for (let i = 0; i < 16; i++) spots.push([(rand() - 0.5) * 60, -INNER.halfL - 14 - rand() * 12]);

  const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });
  const leaves = new InstancedMesh(new ConeGeometry(1.6, 4.2, 7), flat(0x2f7a3a), spots.length);
  const crowns = new InstancedMesh(new IcosahedronGeometry(1.5, 0), flat(0x3d8f45), spots.length);
  const trunks = new InstancedMesh(new CylinderGeometry(0.2, 0.28, 1.6, 6), flat(0x6b4a2f), spots.length);
  const o = new Object3D();
  spots.forEach(([x, z], i) => {
    const s = 0.9 + rand() * 0.8;
    o.scale.setScalar(s);
    o.position.set(x, 0.8 * s, z);
    o.updateMatrix();
    trunks.setMatrixAt(i, o.matrix);
    o.position.set(x, (1.6 + 2.1) * s, z);
    o.updateMatrix();
    leaves.setMatrixAt(i, o.matrix);
    o.position.set(x, (1.6 + 1.2) * s, z);
    o.updateMatrix();
    crowns.setMatrixAt(i, o.matrix);
  });
  scene.add(leaves, crowns, trunks);
}

/** Floodlight towers at the two far corners, lamps facing the court. */
function floodlights(paint: Painter): void {
  const o = new Object3D();
  for (const s of [-1, 1]) {
    const x = s * (INNER.halfW + 9);
    const z = -(INNER.halfL + 5);
    paint.add(new CylinderGeometry(0.18, 0.3, 17, 6).translate(x, 8.5, z), 0x7d8a97);
    o.position.set(x, 17.4, z);
    o.lookAt(0, 0, 0);
    o.updateMatrix();
    paint.box(3, 1.6, 0.35, 0, 0, 0, 0x3a4652, false, o.matrix);
    for (const lx of [-1, 0, 1]) {
      for (const ly of [-0.4, 0.4]) paint.box(0.8, 0.6, 0.05, lx * 0.95, ly, 0.19, 0xfffbe6, true, o.matrix);
    }
  }
}

export interface Stadium {
  crowd: CrowdHandle;
}

/**
 * The arena is laid out for a camera behind the +z baseline (seat 0): the end
 * stand, trees, clouds and hills are at -z. `behindSeat1` turns it all round,
 * so the seat-1 camera at -z gets the same view instead of sitting inside the
 * end stand looking down through its tiers.
 */
export function buildStadium(scene: Scene, behindSeat1 = false): Stadium {
  const arena = new Group();
  arena.add(new HemisphereLight(0xe6f4ff, 0x5a8a4a, 1.5));
  const sun = new DirectionalLight(0xfff3dc, 2.3);
  sun.position.set(10, 16, 8);
  arena.add(sun);
  const paint = new Painter();
  sky(scene, arena, paint);
  grounds(arena, paint);
  net(arena, paint);
  courtside(paint);
  boards(paint);
  const crowd = stands(arena, paint);
  floodlights(paint);
  trees(arena);
  paint.build(arena);
  if (behindSeat1) arena.rotation.y = Math.PI;
  scene.add(arena);
  return { crowd };
}

export { CROWD_SECTIONS };
