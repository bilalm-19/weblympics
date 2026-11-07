import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOTTOM_COLOURS, HAIR_COLOURS, SKINS, TOP_COLOURS, lookKey, toLook } from "../../../shared/look.ts";
import type { Bottom, HairStyle, Headwear, LegacyLook, Look, Top } from "../../../shared/look.ts";
import type { ArmPose } from "../../input/camera/pose.ts";
import { strokePose } from "./stroke.ts";

// A Mii-style player built from primitives: big round head with a drawn face,
// tapered torso and limbs, a top and a bottom, oval racket. Local forward is
// -z (toward the net for seat 0); the racket is in the right hand (+x), and a
// left-handed player is the mirror image. Everything about the look comes
// from the seat's look (tasks 18 and 33, shared/look.ts) and can change live:
// the face (eyes, brows, nose, mouth, facial hair) is drawn on the head's
// texture in bold shapes so it reads at court distance; clothes, hair, hats
// and glasses are a few primitives each, low-poly and flat-shaded.

const SHOES = 0x4b5160;
/** The head's centre above the feet. Every hair, hat and glasses part is built around it, so the slump tips them together. */
const HEAD_Y = 1.78;

const smooth = (color: number) => new MeshLambertMaterial({ color });
const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

const css = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;
/** A colour scaled toward black (k < 1) or white (k > 1). */
function shade(hex: number, k: number): number {
  const ch = (s: number) => {
    const c = (hex >> s) & 0xff;
    return Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1)) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
/** Trim (collars, stripes, strings): white, or navy on a light top. */
const trimFor = (top: number) => (top === TOP_COLOURS.white || top === TOP_COLOURS.yellow ? 0x2b303b : 0xf7f8fa);

// ---- the face, drawn on the head's texture ----

const faceTextures = new Map<string, CanvasTexture>();

/**
 * One face per look's face fields, drawn on the part of the sphere that faces
 * -z. Canvas units are a 256x128 map (drawn at twice that); a SphereGeometry's
 * u = 0.75 faces -z, so the face is centred at x = 192. Positions match
 * look-preview.ts's SVG face and the glasses below (eyes at x +-13, y 54).
 */
function faceTexture(l: Look): CanvasTexture {
  const key = [l.skin, l.eyes, l.brows, l.nose, l.mouth, l.facialHair, l.hairColour].join("/");
  const cached = faceTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.scale(2, 2);
  const skin = SKINS[l.skin];
  g.fillStyle = css(skin);
  g.fillRect(0, 0, 256, 128);
  const cx = 192;
  const hair = HAIR_COLOURS[l.hairColour];
  const ink = "#2a1d14";
  g.lineCap = "round";
  g.lineJoin = "round";

  // facial hair first, so the mouth sits on top of it
  const jaw = () => {
    g.beginPath();
    g.moveTo(cx - 36, 50);
    g.quadraticCurveTo(cx - 36, 96, cx, 101);
    g.quadraticCurveTo(cx + 36, 96, cx + 36, 50);
    g.lineTo(cx + 27, 54);
    g.quadraticCurveTo(cx + 24, 72, cx + 12, 70);
    g.lineTo(cx - 12, 70);
    g.quadraticCurveTo(cx - 24, 72, cx - 27, 54);
    g.closePath();
  };
  const moustache = (w: number, h: number) => {
    g.beginPath();
    g.moveTo(cx - w, 71);
    g.quadraticCurveTo(cx - w / 2, 66 - h / 2, cx, 67);
    g.quadraticCurveTo(cx + w / 2, 66 - h / 2, cx + w, 71);
    g.quadraticCurveTo(cx, 69 + h / 3, cx - w, 71);
    g.fill();
  };
  g.fillStyle = css(hair);
  switch (l.facialHair) {
    case "stubble":
      g.globalAlpha = 0.35;
      jaw();
      g.fill();
      g.beginPath();
      g.ellipse(cx, 69, 12, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      break;
    case "moustache":
      moustache(13, 7);
      break;
    case "goatee":
      moustache(10, 4);
      g.beginPath();
      g.ellipse(cx, 87, 8, 8, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "beard":
      jaw();
      g.fill();
      moustache(14, 7);
      break;
  }

  // eyes, with a light catch so they read on dark skin
  const eye = (x: number) => {
    g.fillStyle = ink;
    switch (l.eyes) {
      case "round":
        g.beginPath();
        g.ellipse(x, 54, 4.2, 5.2, 0, 0, Math.PI * 2);
        g.fill();
        break;
      case "almond":
        g.beginPath();
        g.moveTo(x - 6.5, 54);
        g.quadraticCurveTo(x, 47.5, x + 6.5, 54);
        g.quadraticCurveTo(x, 59, x - 6.5, 54);
        g.fill();
        break;
      case "sleepy":
        g.beginPath();
        g.ellipse(x, 55, 5, 3.6, 0, 0, Math.PI);
        g.fill();
        g.strokeStyle = ink;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(x - 6, 54.5);
        g.lineTo(x + 6, 54.5);
        g.stroke();
        break;
      case "wide":
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.ellipse(x, 54, 6.5, 7, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = ink;
        g.lineWidth = 1.4;
        g.stroke();
        g.fillStyle = ink;
        g.beginPath();
        g.arc(x, 55, 3.6, 0, Math.PI * 2);
        g.fill();
        break;
    }
    if (l.eyes !== "sleepy") {
      g.fillStyle = "#ffffffcc";
      g.beginPath();
      g.arc(x + 1.4, 52.4, 1.1, 0, Math.PI * 2);
      g.fill();
    }
  };
  eye(cx - 13);
  eye(cx + 13);

  // brows in a darkened hair colour (or brown, where the hair is too light to show)
  g.strokeStyle = css(shade(l.hairColour === "blonde" || l.hairColour === "grey" ? 0x6b4a2e : hair, 0.8));
  for (const s of [-1, 1]) {
    const x = cx + s * 13;
    g.beginPath();
    switch (l.brows) {
      case "straight":
        g.lineWidth = 2.6;
        g.moveTo(x - 6, 44);
        g.lineTo(x + 6, 44);
        break;
      case "arched":
        g.lineWidth = 2.4;
        g.moveTo(x - 6.5, 45.5);
        g.quadraticCurveTo(x, 39, x + 6.5, 45.5);
        break;
      case "thick":
        g.lineWidth = 4.6;
        g.moveTo(x - 6, 43.5);
        g.lineTo(x + 6, 43.5);
        break;
      case "angled":
        // low at the middle of the face, rising outward
        g.lineWidth = 2.8;
        g.moveTo(x - s * 6, 46);
        g.lineTo(x + s * 6, 41);
        break;
    }
    g.stroke();
  }

  // nose, a shade darker than the skin
  const noseInk = css(shade(skin, 0.78));
  g.strokeStyle = noseInk;
  g.fillStyle = noseInk;
  g.lineWidth = 2.4;
  g.beginPath();
  switch (l.nose) {
    case "button":
      g.ellipse(cx, 63, 3.6, 3, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "small":
      g.moveTo(cx, 58);
      g.lineTo(cx - 1.8, 64);
      g.stroke();
      break;
    case "long":
      g.moveTo(cx + 0.5, 54);
      g.lineTo(cx - 2.5, 65);
      g.lineTo(cx + 1.5, 66);
      g.stroke();
      break;
    case "wide":
      g.moveTo(cx - 6, 63);
      g.quadraticCurveTo(cx, 68, cx + 6, 63);
      g.stroke();
      break;
  }

  // mouth
  const lip = "#8a3a2c";
  g.strokeStyle = lip;
  g.lineWidth = 2.6;
  g.beginPath();
  switch (l.mouth) {
    case "smile":
      g.arc(cx, 72, 8, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      break;
    case "grin":
      g.moveTo(cx - 10, 74);
      g.quadraticCurveTo(cx, 87, cx + 10, 74);
      g.closePath();
      g.fillStyle = "#ffffff";
      g.fill();
      g.lineWidth = 2.2;
      g.stroke();
      break;
    case "neutral":
      g.moveTo(cx - 7, 76);
      g.lineTo(cx + 7, 76);
      g.stroke();
      break;
    case "open":
      g.ellipse(cx, 77, 5.5, 5, 0, 0, Math.PI * 2);
      g.fillStyle = "#5a1d16";
      g.fill();
      g.beginPath();
      g.ellipse(cx, 80, 3.4, 1.8, 0, 0, Math.PI * 2);
      g.fillStyle = "#d9605a";
      g.fill();
      break;
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  faceTextures.set(key, texture);
  return texture;
}

// ---- geometry helpers: parts built around the head's centre or the body ----

const UP = new Vector3(0, 1, 0);

/** A rod of radius r from a to b. */
function rod(a: [number, number, number], b: [number, number, number], r: number, sides = 5): BufferGeometry {
  const from = new Vector3(...a);
  const d = new Vector3(...b).sub(from);
  const geo = new CylinderGeometry(r, r, d.length(), sides);
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(UP, d.clone().normalize()));
  const mid = from.addScaledVector(d, 0.5);
  return geo.translate(mid.x, mid.y, mid.z);
}

// mergeGeometries needs all parts indexed or none; an icosahedron isn't, so
// none are (these are a few hundred triangles at most)
const merge = (parts: BufferGeometry[]) => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));

/** The head's hair caps share the head's slightly tall shape. */
const tall = (geo: BufferGeometry, k = 1.08) => geo.scale(1, k, 1);

// where the eyes are on the head (relative to its centre): the texture's eyes
// at x = 192 +- 13, y = 54 on a sphere of radius 0.3 stretched 1.08 tall
const EYE = { x: 0.092, y: 0.079, z: -0.31 };

function glassesFrames(square: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const ring = square ? new TorusGeometry(0.075, 0.013, 4, 4).rotateZ(Math.PI / 4).scale(1.1, 0.85, 1) : new TorusGeometry(0.06, 0.012, 5, 14);
    parts.push(ring.translate(s * EYE.x, EYE.y, EYE.z));
    const outer = s * (EYE.x + (square ? 0.078 : 0.06));
    parts.push(rod([outer, EYE.y, EYE.z], [s * 0.272, EYE.y, -0.2], 0.01), rod([s * 0.272, EYE.y, -0.2], [s * 0.3, EYE.y, 0.02], 0.01));
  }
  parts.push(rod([-EYE.x + 0.055, EYE.y + 0.005, EYE.z], [EYE.x - 0.055, EYE.y + 0.005, EYE.z], 0.01));
  return merge(parts);
}

function sunglasses(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(new CylinderGeometry(0.07, 0.07, 0.015, 12).rotateX(Math.PI / 2).scale(1.15, 0.85, 1).translate(s * EYE.x, EYE.y, EYE.z));
    parts.push(rod([s * (EYE.x + 0.075), EYE.y + 0.01, EYE.z], [s * 0.272, EYE.y, -0.2], 0.011), rod([s * 0.272, EYE.y, -0.2], [s * 0.3, EYE.y, 0.02], 0.011));
  }
  parts.push(rod([-0.04, EYE.y + 0.02, EYE.z], [0.04, EYE.y + 0.02, EYE.z], 0.012));
  return merge(parts);
}

function goggleStrap(): BufferGeometry {
  const parts: BufferGeometry[] = [new TorusGeometry(0.302, 0.022, 4, 24).rotateX(Math.PI / 2).translate(0, EYE.y, 0)];
  for (const s of [-1, 1]) parts.push(new TorusGeometry(0.075, 0.018, 5, 14).translate(s * EYE.x, EYE.y, EYE.z - 0.01));
  return merge(parts);
}

function goggleLenses(): BufferGeometry {
  return merge([-1, 1].map((s) => new CylinderGeometry(0.072, 0.072, 0.03, 14).rotateX(Math.PI / 2).translate(s * EYE.x, EYE.y, EYE.z - 0.012)));
}

/** The hair's top: a cap over the crown, down to just above the brows. */
const hairTop = (r = 0.315, theta = 0.36) => tall(new SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI * theta)).translate(0, 0.01, 0);
/** The hair over the back of the head (+z is the back). */
const hairBack = (r = 0.312, theta = 0.62) => tall(new SphereGeometry(r, 14, 8, 0, Math.PI, 0, Math.PI * theta));
/** A fringe: the front half of the head's top, cut lower, over the brows. */
const fringe = () => tall(new SphereGeometry(0.326, 14, 6, Math.PI, Math.PI, Math.PI * 0.18, Math.PI * 0.24));

function hairGeometry(style: HairStyle): BufferGeometry | null {
  switch (style) {
    case "short":
      return merge([hairTop(), hairBack()]);
    case "buzz":
      return merge([hairTop(0.305, 0.33), hairBack(0.305, 0.58)]);
    case "fringe":
      return merge([hairTop(), hairBack(), fringe()]);
    case "bob":
      return merge([
        hairTop(0.322),
        hairBack(0.32),
        fringe(),
        // round the back and sides to the chin, open at the face
        new CylinderGeometry(0.33, 0.35, 0.36, 16, 1, true, -Math.PI * 0.64, Math.PI * 1.28).translate(0, -0.13, 0.01),
      ]);
    case "curly": {
      const parts = [hairTop(0.3), hairBack(0.3)];
      for (let ring = 0; ring < 3; ring++) {
        const theta = Math.PI * (0.08 + ring * 0.15);
        const n = 4 + ring * 4;
        for (let i = 0; i < n; i++) {
          const phi = (i / n) * Math.PI * 2 + ring * 0.4;
          // keep the face clear: no curls low on the front
          if (ring === 2 && Math.cos(phi) < -0.2) continue;
          const r = 0.31;
          parts.push(new IcosahedronGeometry(0.095, 0).translate(r * Math.sin(theta) * Math.sin(phi), r * 1.08 * Math.cos(theta), r * Math.sin(theta) * Math.cos(phi)));
        }
      }
      return merge(parts);
    }
    case "long":
      return merge([hairTop(), hairBack(), new CylinderGeometry(0.29, 0.26, 0.5, 14, 1, true, -Math.PI * 0.6, Math.PI * 1.2).translate(0, -0.2, 0.02)]);
    case "ponytail":
      return merge([
        hairTop(),
        hairBack(),
        new SphereGeometry(0.075, 8, 6).translate(0, 0.08, 0.31),
        new CapsuleGeometry(0.065, 0.3, 3, 8).translate(0, -0.12, 0.36),
      ]);
    case "bun":
      return merge([hairTop(), hairBack(), new SphereGeometry(0.11, 10, 8).translate(0, 0.24, 0.2)]);
    case "afro":
      return new IcosahedronGeometry(0.4, 1).scale(1.08, 0.95, 1).translate(0, 0.17, 0.12);
    case "spiky": {
      const parts = [hairTop(), hairBack()];
      const spikes: Array<[number, number]> = [
        [0, 0],
        [0.17, 0.15],
        [0.17, 0.5],
        [0.17, 0.85],
        [0.17, 1.15],
        [0.17, 1.5],
        [0.17, 1.85],
        [0.3, 0.3],
        [0.3, 0.75],
        [0.3, 1.25],
        [0.3, 1.7],
      ];
      for (const [t, p] of spikes) {
        const theta = Math.PI * t;
        const phi = Math.PI * p;
        const dir = new Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));
        const cone = new ConeGeometry(0.075, 0.2, 4).translate(0, 0.1, 0);
        cone.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir));
        parts.push(cone.translate(dir.x * 0.27, dir.y * 0.29, dir.z * 0.27));
      }
      return merge(parts);
    }
    case "bald":
      return null;
  }
}

/** Hair that stands up off the head: under a cap or a beanie it is drawn as short hair. */
const TALL_HAIR: readonly HairStyle[] = ["bun", "afro", "spiky", "curly"];
/** A visor or headband sits on big hair, not inside it: its scale and how far back. */
const BAND_FIT: Partial<Record<HairStyle, { s: number; z: number }>> = {
  afro: { s: 1.38, z: 0.12 },
  curly: { s: 1.12, z: 0 },
  bob: { s: 1.06, z: 0 },
};

const capGeometry = () =>
  merge([
    tall(new SphereGeometry(0.33, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.42)).translate(0, 0.02, 0),
    new CylinderGeometry(0.22, 0.22, 0.03, 16, 1, false, Math.PI / 2, Math.PI).scale(1, 1, 0.8).translate(0, 0.2, -0.22),
  ]);
const visorGeometry = () =>
  merge([
    new TorusGeometry(0.305, 0.032, 5, 20).rotateX(Math.PI / 2).translate(0, 0.17, 0),
    new CylinderGeometry(0.22, 0.22, 0.03, 16, 1, false, Math.PI / 2, Math.PI).scale(1, 1, 0.8).translate(0, 0.18, -0.22),
  ]);
const headbandGeometry = () => new TorusGeometry(0.31, 0.04, 5, 20).rotateX(Math.PI / 2).translate(0, 0.15, 0);
const beanieGeometry = () =>
  merge([
    // the brim's bottom edge sits just above the brows
    // (the texture's brows are 0.154 above the head's centre)
    new SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 0.19, 0),
    new CylinderGeometry(0.325, 0.33, 0.08, 16).translate(0, 0.205, 0),
    new IcosahedronGeometry(0.075, 0).translate(0, 0.53, 0),
  ]);

// ---- clothes ----

type Sleeves = "none" | "short" | "long";
const SLEEVES: Record<Top, Sleeves> = { tee: "short", polo: "short", hoodie: "long", jersey: "short", tank: "none", suit: "long", dress: "short" };

let stringsTexture: CanvasTexture | null = null;
function strings(): CanvasTexture {
  if (stringsTexture) return stringsTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  g.strokeStyle = "rgba(245,245,245,0.9)";
  g.lineWidth = 1;
  for (let i = 2; i < 32; i += 4) {
    g.beginPath();
    g.moveTo(i + 0.5, 0);
    g.lineTo(i + 0.5, 32);
    g.moveTo(0, i + 0.5);
    g.lineTo(32, i + 0.5);
    g.stroke();
  }
  stringsTexture = new CanvasTexture(canvas);
  stringsTexture.wrapS = stringsTexture.wrapT = RepeatWrapping;
  stringsTexture.repeat.set(2, 2);
  return stringsTexture;
}

function racket(frameColor: number): Group {
  const r = new Group();
  const head = new Mesh(new TorusGeometry(0.2, 0.025, 6, 20), smooth(frameColor));
  head.scale.set(0.82, 1.15, 1);
  head.position.y = 0.48;
  const face = new Mesh(
    new CircleGeometry(0.2, 20),
    new MeshBasicMaterial({ map: strings(), transparent: true, side: DoubleSide, depthWrite: false }),
  );
  face.scale.copy(head.scale);
  face.position.y = 0.48;
  const throat = new Mesh(new CylinderGeometry(0.018, 0.022, 0.2, 6), smooth(frameColor));
  throat.position.y = 0.2;
  const grip = new Mesh(new CylinderGeometry(0.03, 0.03, 0.18, 8), smooth(0x22252c));
  grip.position.y = 0.04;
  r.add(head, face, throat, grip);
  return r;
}


const EMPTY = new BufferGeometry();

/** Geometry shared by every player with the same choice: built once, swapped in by setLook, never disposed. */
const shapes = new Map<string, BufferGeometry>();
function shape(key: string, build: () => BufferGeometry | null): BufferGeometry {
  let g = shapes.get(key);
  if (!g) {
    g = build() ?? EMPTY;
    shapes.set(key, g);
  }
  return g;
}

// the torso: a cylinder from y 0.77 to 1.39, radius 0.17 at the waist and
// 0.2 at the chest; its front surface is at about z = -0.19
const TORSO_FRONT = -0.19;

/** Collars, stripes and the shirt under a suit, in the trim colour. */
function topTrim(top: Top): BufferGeometry | null {
  switch (top) {
    case "polo":
      return merge([new TorusGeometry(0.085, 0.03, 4, 10).rotateX(Math.PI / 2).translate(0, 1.46, 0), new BoxGeometry(0.04, 0.13, 0.012).translate(0, 1.33, TORSO_FRONT - 0.008)]);
    case "jersey":
      return merge([
        new CylinderGeometry(0.203, 0.2, 0.07, 12, 1, true).translate(0, 1.2, 0),
        new CylinderGeometry(0.195, 0.19, 0.07, 12, 1, true).translate(0, 1.07, 0),
        new TorusGeometry(0.075, 0.022, 4, 10).rotateX(Math.PI / 2).translate(0, 1.45, 0),
      ]);
    case "hoodie":
      // drawstrings
      return merge([-1, 1].map((s) => rod([s * 0.04, 1.42, -0.16], [s * 0.05, 1.26, TORSO_FRONT - 0.01], 0.011)));
    case "suit":
      // the shirt front, a white V under the jacket
      return new ConeGeometry(0.075, 0.24, 3).rotateZ(Math.PI).scale(1, 1, 0.25).translate(0, 1.3, TORSO_FRONT - 0.004);
    case "dress":
      return new CylinderGeometry(0.178, 0.175, 0.05, 12, 1, true).translate(0, 0.86, 0);
    default:
      return null;
  }
}

/** Hood, pocket, lapels: a shade darker than the top. */
function topAccent(top: Top): BufferGeometry | null {
  switch (top) {
    case "hoodie":
      return merge([new TorusGeometry(0.15, 0.065, 5, 10, Math.PI).rotateX(Math.PI / 2).translate(0, 1.44, 0.02), new BoxGeometry(0.26, 0.1, 0.03).translate(0, 0.95, TORSO_FRONT + 0.012)]);
    case "suit":
      return merge([-1, 1].map((s) => rod([s * 0.06, 1.44, -0.15], [s * 0.035, 1.17, TORSO_FRONT - 0.012], 0.022, 4)));
    default:
      return null;
  }
}

/** A tank top's straps over bare shoulders, in the top's colour. */
const tankStraps = () => merge([-1, 1].map((s) => new BoxGeometry(0.07, 0.05, 0.34).translate(s * 0.12, 1.43, 0)));
/** A suit's tie and knot. */
const tie = () => merge([new BoxGeometry(0.045, 0.2, 0.015).translate(0, 1.22, TORSO_FRONT - 0.014), new BoxGeometry(0.05, 0.04, 0.02).translate(0, 1.36, TORSO_FRONT - 0.012)]);

/** What's worn below the waist, in the bottom's colour; a dress hides it. */
function lowerGeometry(bottom: Bottom, top: Top): BufferGeometry | null {
  if (top === "dress") return null;
  const hips = new CylinderGeometry(0.178, 0.175, 0.14, 12).translate(0, 0.79, 0);
  switch (bottom) {
    case "shorts":
      return merge([hips, ...[-0.1, 0.1].map((x) => new CylinderGeometry(0.105, 0.11, 0.3, 8).translate(x, 0.66, 0))]);
    case "trousers":
      return hips;
    case "skirt":
      return new CylinderGeometry(0.178, 0.28, 0.32, 12).translate(0, 0.68, 0);
  }
}
const dressSkirt = () => new CylinderGeometry(0.175, 0.31, 0.42, 12).translate(0, 0.62, 0);

export interface Player {
  group: Group;
  /**
   * `swing` 0..1 through a stroke, or null at rest. `backhand` swings (or, at
   * rest, holds the racket) across the body. `side` 1 is right-handed. `aim`
   * (-1 left .. 1 right, as the player sees it) turns the ready arm toward it.
   */
  pose(swing: number | null, backhand: boolean, side: 1 | -1, aim?: number): void;
  /**
   * Copy a real arm (camera "follow" mode): upper arm and forearm point where
   * the player's do, smoothed between camera frames. The racket carries on
   * from the forearm; `backhand` turns its face over.
   */
  follow(arm: ArmPose, backhand: boolean, side: 1 | -1): void;
  /**
   * Where the middle of the strings is now, in the player's own frame: x to
   * their right, y up, z toward the net (metres from their feet).
   */
  racketHead(): { x: number; y: number; z: number };
  /**
   * A reaction to the point (task 16), laid over whatever pose was set this
   * frame: `pump` 0..1 raises the free arm in a fist pump, `slump` 0..1 drops
   * the head and shoulders. Call after pose() or follow().
   */
  react(pump: number, slump: number): void;
  /**
   * Dresses the player in a look (tasks 18 and 33): recolours, and swaps the
   * clothes, hair, hat, glasses and face. Only ever swaps geometry, materials'
   * colours and the face texture; it never shows or hides a part, so a sport
   * that hides parts (boxing's first person) keeps them hidden. A task-18
   * look ({shirt, shorts, skin, hair, style}) is still accepted.
   */
  setLook(look: Look | LegacyLook): void;
  /**
   * The pieces another sport poses itself (boxing, task 30): the mirrored
   * body, the torso parts above the hips (the clothes' trim with them), the
   * head first and then every hair, hat and glasses part, each placed at the
   * head's centre, and the top and skin materials (setLook recolours them).
   * `sleeve` is the upper arm's (the top's colour, or skin under a tank top);
   * `arm` is the racket arm's shoulder pivot and `hand` its wrist, for a sport
   * that holds something else there.
   */
  parts: {
    body: Group;
    upper: Mesh[];
    head: Mesh[];
    top: MeshLambertMaterial;
    skin: MeshLambertMaterial;
    sleeve: MeshLambertMaterial;
    arm: Group;
    hand: Group;
  };
}

export interface PlayerOptions {
  /** false builds no arms and no racket, for a sport that adds its own (boxing). Default true. */
  arms?: boolean;
  /** false keeps the arms but leaves the racket out, for a sport that holds something else. Default true. */
  racket?: boolean;
}

const DOWN = new Vector3(0, -1, 0);
// how far toward a new camera reading the arm moves each rendered frame
const FOLLOW_SMOOTHING = 0.45;

export function makePlayer(initial: Look | LegacyLook, racketColor: number, opts: PlayerOptions = {}): Player {
  const group = new Group();
  // everything that mirrors for a left-hander
  const body = new Group();
  group.add(body);

  const shadow = new Mesh(new CircleGeometry(0.45, 16), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  group.add(shadow);

  // materials, recoloured by setLook
  const top = smooth(0xffffff);
  const accent = flat(0xffffff);
  const trim = flat(0xffffff);
  const tieMat = flat(0xffffff);
  const bottomMat = smooth(0xffffff);
  const skinMat = smooth(0xffffff);
  const legMat = smooth(0xffffff);
  const shoulderMat = smooth(0xffffff);
  const sleeve = smooth(0xffffff);
  const foreMat = smooth(0xffffff);
  const hairMat = flat(0xffffff);
  const hatMat = flat(0xffffff);
  const frameMat = flat(0x1d1f24);
  const lensMat = new MeshLambertMaterial({ color: 0x8fd6ff, transparent: true, opacity: 0.75 });

  for (const x of [-0.11, 0.11]) {
    const leg = new Mesh(new CapsuleGeometry(0.085, 0.62, 4, 8), legMat);
    leg.position.set(x, 0.42, 0);
    const shoe = new Mesh(new CapsuleGeometry(0.07, 0.12, 4, 8), smooth(SHOES));
    shoe.rotation.x = Math.PI / 2;
    shoe.position.set(x, 0.06, -0.04);
    body.add(leg, shoe);
  }
  // shorts, trousers' hips or a skirt; and a dress's skirt in the top's colour
  const lower = new Mesh(EMPTY, bottomMat);
  const dress = new Mesh(EMPTY, top);
  body.add(lower, dress);

  const torso = new Mesh(new CylinderGeometry(0.2, 0.17, 0.62, 12), top);
  torso.position.y = 1.08;
  const shoulders = new Mesh(new SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shoulderMat);
  shoulders.position.y = 1.38;
  shoulders.scale.set(1, 0.45, 0.85);
  const neck = new Mesh(new CylinderGeometry(0.06, 0.07, 0.1, 8), skinMat);
  neck.position.y = 1.47;
  // the top's details, built in body coordinates (the mesh sits at the origin)
  const trimMesh = new Mesh(EMPTY, trim);
  const accentMesh = new Mesh(EMPTY, accent);
  const straps = new Mesh(EMPTY, top);
  const tieMesh = new Mesh(EMPTY, tieMat);
  body.add(torso, shoulders, neck, trimMesh, accentMesh, straps, tieMesh);

  const faceMat = new MeshLambertMaterial();
  const head = new Mesh(new SphereGeometry(0.3, 20, 14), faceMat);
  head.position.y = HEAD_Y;
  head.scale.set(1, 1.08, 1);
  // hair, hat and glasses, each one mesh built around the head's centre
  const hairMesh = new Mesh(EMPTY, hairMat);
  const hatMesh = new Mesh(EMPTY, hatMat);
  const frames = new Mesh(EMPTY, frameMat);
  const lenses = new Mesh(EMPTY, lensMat);
  const headParts = [hairMesh, hatMesh, frames, lenses];
  for (const m of headParts) m.position.y = HEAD_Y;
  body.add(head, ...headParts);
  // the head and every hair, hat or glasses part tip forward together when
  // the player slumps (task 16)
  const headGroup = [head, ...headParts];

  // the off arm hangs relaxed: a sleeve, a forearm (bare or sleeved) and a hand
  const offArm = new Group();
  offArm.position.set(-0.24, 1.36, 0);
  const offUpper = new Mesh(new CapsuleGeometry(0.06, 0.2, 4, 8), sleeve);
  offUpper.position.y = -0.14;
  const offFore = new Mesh(new CapsuleGeometry(0.055, 0.22, 4, 8), foreMat);
  offFore.position.y = -0.4;
  const offHand = new Mesh(new SphereGeometry(0.065, 8, 6), skinMat);
  offHand.position.y = -0.56;
  offArm.add(offUpper, offFore, offHand);
  offArm.rotation.order = "YXZ";
  offArm.rotation.z = -0.12;
  if (opts.arms !== false) body.add(offArm);

  // Racket arm: a shoulder pivot with the arm hanging along -y. Euler order
  // YXZ: x raises the arm forward (toward -z), then y turns it around the body
  // (positive y swings it across to the left), so a raised arm can sweep.
  const arm = new Group();
  arm.rotation.order = "YXZ";
  arm.position.set(0.24, 1.36, 0);
  const upperSleeve = new Mesh(new CapsuleGeometry(0.06, 0.2, 4, 8), sleeve);
  upperSleeve.position.y = -0.14;
  // the elbow bends only when copying a real arm; canned strokes keep it straight
  const elbow = new Group();
  elbow.position.y = -0.27;
  const foreSleeve = new Mesh(new CapsuleGeometry(0.055, 0.18, 4, 8), foreMat);
  foreSleeve.position.y = -0.13;
  const hand = new Mesh(new SphereGeometry(0.065, 8, 6), skinMat);
  hand.position.y = -0.29;
  // wrist: at rotation.x = PI the racket carries on along the arm; more than
  // PI tips the head up. `roll` spins it about its own shaft: 0 shows the
  // strings to the camera behind, PI/2 stands the face on edge for a swing.
  const wrist = new Group();
  wrist.position.y = -0.29;
  const roll = new Group();
  if (opts.racket !== false) roll.add(racket(racketColor));
  wrist.add(roll);
  elbow.add(foreSleeve, hand, wrist);
  arm.add(upperSleeve, elbow);
  if (opts.arms !== false) body.add(arm);

  const upperTarget = new Quaternion();
  const foreTarget = new Quaternion();
  const toLocal = (v: { out: number; up: number; fwd: number }) => new Vector3(v.out, v.up, -v.fwd).normalize();
  // the middle of the strings, for racketHead()
  const headMarker = new Group();
  headMarker.position.y = 0.48;
  roll.add(headMarker);
  const headPos = new Vector3();

  const hatShape = (h: Headwear) =>
    shape(`hat/${h}`, () => (h === "cap" ? capGeometry() : h === "visor" ? visorGeometry() : h === "headband" ? headbandGeometry() : h === "beanie" ? beanieGeometry() : null));

  const setLook = (given: Look | LegacyLook) => {
    const l = toLook(given);
    const key = lookKey(l);
    if (group.userData.look === key) return;
    const topHex = TOP_COLOURS[l.topColour];
    const skinHex = SKINS[l.skin];
    const bottomHex = BOTTOM_COLOURS[l.bottomColour];
    const sleeves = SLEEVES[l.top];
    top.color.setHex(topHex);
    accent.color.setHex(shade(topHex, 0.8));
    trim.color.setHex(l.top === "suit" ? 0xf7f8fa : trimFor(topHex));
    tieMat.color.setHex(l.topColour === "red" ? 0x2b303b : 0xc0392b);
    bottomMat.color.setHex(bottomHex);
    skinMat.color.setHex(skinHex);
    // trousers reach the shoes; under shorts, a skirt or a dress the legs are bare
    legMat.color.setHex(l.top !== "dress" && l.bottom === "trousers" ? bottomHex : skinHex);
    shoulderMat.color.setHex(sleeves === "none" ? skinHex : topHex);
    sleeve.color.setHex(sleeves === "none" ? skinHex : topHex);
    foreMat.color.setHex(sleeves === "long" ? topHex : skinHex);
    hairMat.color.setHex(HAIR_COLOURS[l.hairColour]);
    hatMat.color.setHex(topHex);

    lower.geometry = shape(`lower/${l.bottom}/${l.top === "dress"}`, () => lowerGeometry(l.bottom, l.top));
    dress.geometry = l.top === "dress" ? shape("dress", dressSkirt) : EMPTY;
    trimMesh.geometry = shape(`trim/${l.top}`, () => topTrim(l.top));
    accentMesh.geometry = shape(`accent/${l.top}`, () => topAccent(l.top));
    straps.geometry = l.top === "tank" ? shape("straps", tankStraps) : EMPTY;
    tieMesh.geometry = l.top === "suit" ? shape("tie", tie) : EMPTY;

    // tall hair is drawn as short hair under a cap or a beanie
    const covered = (l.headwear === "cap" || l.headwear === "beanie") && TALL_HAIR.includes(l.hairStyle);
    const hair = covered ? "short" : l.hairStyle;
    hairMesh.geometry = shape(`hair/${hair}`, () => hairGeometry(hair));
    hatMesh.geometry = hatShape(l.headwear);
    // a band sits on big hair, not inside it
    const fit = l.headwear === "visor" || l.headwear === "headband" ? BAND_FIT[l.hairStyle] : undefined;
    hatMesh.scale.set(fit?.s ?? 1, 1, fit?.s ?? 1);
    hatMesh.position.z = fit?.z ?? 0;
    frames.geometry =
      l.eyewear === "round" || l.eyewear === "square"
        ? shape(`glasses/${l.eyewear}`, () => glassesFrames(l.eyewear === "square"))
        : l.eyewear === "sunglasses"
          ? shape("sunglasses", sunglasses)
          : l.eyewear === "goggles"
            ? shape("goggles", goggleStrap)
            : EMPTY;
    lenses.geometry = l.eyewear === "goggles" ? shape("goggle-lenses", goggleLenses) : EMPTY;

    faceMat.map = faceTexture(l);
    faceMat.needsUpdate = true;
    group.userData.look = key;
  };
  setLook(initial);

  return {
    group,
    setLook,
    parts: {
      body,
      upper: [torso, shoulders, neck, trimMesh, accentMesh, straps, tieMesh],
      head: headGroup,
      top,
      skin: skinMat,
      sleeve,
      arm,
      hand: wrist,
    },
    follow(pose, backhand, side) {
      body.scale.x = side;
      body.rotation.y = 0;
      offArm.rotation.set(0, 0, -0.12);
      upperTarget.setFromUnitVectors(DOWN, toLocal(pose.upper));
      // the forearm's direction relative to the upper arm
      foreTarget.setFromUnitVectors(DOWN, toLocal(pose.fore)).premultiply(upperTarget.clone().invert());
      arm.quaternion.slerp(upperTarget, FOLLOW_SMOOTHING);
      elbow.quaternion.slerp(foreTarget, FOLLOW_SMOOTHING);
      // racket carries on from the forearm, head tipped up a little
      wrist.rotation.x = Math.PI + 0.5;
      roll.rotation.y = backhand ? -Math.PI / 2 : Math.PI / 2;
    },
    pose(swing, backhand, side, aim = 0) {
      body.scale.x = side;
      elbow.quaternion.identity();
      if (swing === null) {
        // ready: arm down and forward, racket head up in front; a backhand
        // holds it across the body. Aim turns the arm a little toward it.
        const turn = -aim * side * 0.35;
        arm.rotation.set(0.75, (backhand ? 0.95 : -0.55) + turn, 0);
        // racket head up, tipped slightly forward
        wrist.rotation.x = Math.PI + 2.1;
        roll.rotation.y = 0;
        // the body group is mirrored for a left-hander but its turn is not,
        // so the turn takes the side's sign
        body.rotation.y = (backhand ? 0.3 : -0.1) * side;
        offArm.rotation.set(0, 0, -0.12);
        return;
      }
      // Each stroke has its own path (stroke.ts): the forehand low on the
      // racket side up to high over the other shoulder, the backhand from the
      // far hip out to the racket side with the shoulders turning the other way.
      const p = strokePose(swing, backhand);
      arm.rotation.set(p.armX, p.armY, 0);
      elbow.rotation.set(p.elbow, 0, 0);
      wrist.rotation.x = p.wristX;
      roll.rotation.y = p.roll;
      body.rotation.y = p.bodyY * side;
      offArm.rotation.set(p.offX, p.offY, -0.12);
    },
    react(pump, slump) {
      // the free arm comes up past the head, bent a little at the top
      if (pump > 0) offArm.rotation.set(-0.4 * pump, 0, -0.12 - 2.6 * pump);
      // chin down and the shoulders forward
      // (forward is -z, so a negative x turn tips them toward the net)
      for (const m of headGroup) m.rotation.x = -0.45 * slump;
      body.rotation.x = -0.12 * slump;
    },
    racketHead() {
      group.updateMatrixWorld(true);
      headMarker.getWorldPosition(headPos);
      group.worldToLocal(headPos);
      // the player's forward is local -z
      return { x: headPos.x, y: headPos.y, z: -headPos.z };
    },
  };
}
