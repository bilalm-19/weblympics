// MOCK ONLY (2026-11-08): the 3D layer for the home screen mock. Loaded after
// the flat page is on screen, and only on a capable device; otherwise the SVG
// party stays. Uses the game's own character (no racket arms) with simple arms
// added here, as boxing does, so character.ts is untouched.
import {
  CanvasTexture, SRGBColorSpace, MeshLambertMaterial as FaceMat,
  AmbientLight, BoxGeometry, CapsuleGeometry, Color, DirectionalLight, Group, Mesh, MeshLambertMaterial,
  PerspectiveCamera, Scene, SphereGeometry, TorusGeometry, CylinderGeometry, WebGLRenderer, LatheGeometry, Vector2,
  Vector3, TubeGeometry, CatmullRomCurve3, Shape, ExtrudeGeometry, ConeGeometry,
} from "three";
import { makePlayer } from "./games/tennis/character.ts";
import type { Look } from "../shared/look.ts";
import { SKINS } from "../shared/look.ts";

// The 2D face (big eyes with a shine, a wide smile, rosy cheeks), painted on
// the 3D head instead of the game's small one. A SphereGeometry's u = 0.75
// faces the front (-z), so the face is drawn around x = 0.75 of the width.
// The texture wraps a sphere, so the width covers 360 degrees and the height
// 180: features are drawn wide enough to read after the wrap.
const faces = new Map<number, CanvasTexture>();
function cartoonFace(skin: number): CanvasTexture {
  const hit = faces.get(skin);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = `#${skin.toString(16).padStart(6, "0")}`;
  g.fillRect(0, 0, c.width, c.height);
  const cx = 768;
  // cheeks
  g.fillStyle = "rgba(240,130,130,0.5)";
  for (const dx of [-100, 100]) { g.beginPath(); g.ellipse(cx + dx, 290, 34, 20, 0, 0, Math.PI * 2); g.fill(); }
  // eyes: big dark ovals with a white shine
  for (const dx of [-58, 58]) {
    g.fillStyle = "#12304a";
    g.beginPath(); g.ellipse(cx + dx, 232, 22, 38, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.ellipse(cx + dx + 7, 218, 8, 11, 0, 0, Math.PI * 2); g.fill();
  }
  // brows
  g.strokeStyle = "rgba(18,48,74,.55)"; g.lineWidth = 9; g.lineCap = "round";
  for (const dx of [-58, 58]) { g.beginPath(); g.moveTo(cx + dx - 22, 176); g.quadraticCurveTo(cx + dx, 166, cx + dx + 22, 176); g.stroke(); }
  // a wide smile
  g.strokeStyle = "#12304a"; g.lineWidth = 15;
  g.beginPath(); g.ellipse(cx, 286, 58, 42, 0, 0.16 * Math.PI, 0.84 * Math.PI); g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  faces.set(skin, t);
  return t;
}

type Move = "wave" | "hop" | "cheer" | "sway";
interface Member { name: string; look: Look; move: Move }

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A device we trust with a little 3D: not a phone, WebGL works, motion allowed. */
export function capable(): boolean {
  if (reduced || innerWidth < 760) return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function arm(mat: MeshLambertMaterial, skin: MeshLambertMaterial): Group {
  // pivot at the shoulder, arm hanging down
  const g = new Group();
  const upper = new Mesh(new CapsuleGeometry(0.075, 0.42, 4, 8), mat);
  upper.position.y = -0.27;
  const hand = new Mesh(new SphereGeometry(0.085, 10, 8), skin);
  hand.position.y = -0.55;
  g.add(upper, hand);
  return g;
}

/** The party: real characters in a small canvas, each with an idle move. */
export function mountParty(host: HTMLElement) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 5, 4);
  scene.add(sun);
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.25, 6.2);
  camera.lookAt(0, 0.95, 0);

  let figures: { g: Group; left: Group; right: Group; move: Move; phase: number; born: number }[] = [];
  let mouseX = 0;
  addEventListener("pointermove", (e) => (mouseX = (e.clientX / innerWidth) * 2 - 1));

  function set(members: Member[]) {
    for (const f of figures) scene.remove(f.g);
    figures = members.map((m, i) => {
      const p = makePlayer(m.look, 0xffffff, { arms: false });
      // swap in the 2D-style face (the first head part is the face sphere)
      const faceMesh = p.parts.head.find((h) => (h.material as FaceMat).map);
      if (faceMesh) (faceMesh.material as FaceMat) = new FaceMat({ map: cartoonFace(SKINS[m.look.skin]) });
      const left = arm(p.parts.top, p.parts.skin);
      const right = arm(p.parts.top, p.parts.skin);
      // shoulders sit about 1.38 m up, 0.27 m out
      left.position.set(-0.27, 1.38, 0);
      right.position.set(0.27, 1.38, 0);
      p.parts.body.add(left, right);
      const n = members.length;
      const spread = Math.min(1.25, 3.6 / Math.max(1, n - 1));
      p.group.position.x = (i - (n - 1) / 2) * spread;
      p.group.rotation.y = Math.PI; // face the camera (the character's forward is -z)
      scene.add(p.group);
      return { g: p.group, left, right, move: m.move, phase: i * 1.3, born: performance.now() };
    });
    // pull the camera back as the party grows
    camera.position.z = members.length <= 1 ? 4.4 : members.length <= 3 ? 6.2 : 8;
    camera.lookAt(0, 0.95, 0);
    resize();
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  let running = true;
  let stopped = false;
  document.addEventListener("visibilitychange", () => (running = !document.hidden));
  const frames: number[] = [];
  const tick = (now: number) => {
    if (stopped) return;
    requestAnimationFrame(tick);
    if (!running) return;
    frames.push(now);
    while (frames.length && now - frames[0] > 2000) frames.shift();
    const t = now / 1000;
    for (const f of figures) {
      const k = t + f.phase;
      // arrive: run in from below and settle
      const age = Math.min(1, (now - f.born) / 500);
      f.g.position.y = (1 - age) * -0.6;
      // turn a little toward the mouse
      f.g.rotation.y = Math.PI + mouseX * 0.35;
      f.left.rotation.set(0, 0, -0.12);
      f.right.rotation.set(0, 0, 0.12);
      if (f.move === "wave") {
        const w = Math.max(0, Math.sin(k * 2.6));
        f.right.rotation.set(0, 0, 2.5 + Math.sin(k * 9) * 0.35 * w);
      } else if (f.move === "hop") {
        f.g.position.y += Math.max(0, Math.sin(k * 3.4)) ** 3 * 0.22;
        f.left.rotation.z = -0.4; f.right.rotation.z = 0.4;
      } else if (f.move === "cheer") {
        const a = 2.6 + Math.sin(k * 5) * 0.25;
        f.left.rotation.z = -a; f.right.rotation.z = a;
      } else {
        f.g.rotation.z = Math.sin(k * 1.8) * 0.06;
      }
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(tick);
  return {
    set,
    /** Frames drawn per second over the last 2 s. */
    fps: () => frames.length / 2,
    stop: () => { stopped = true; renderer.dispose(); renderer.domElement.remove(); },
  };
}

/** Small spinning 3D icons for the sport cards: one shared renderer, one canvas per card via scissoring. */
export function mountIcons(cards: HTMLElement[]) {
  const ids = cards.map((c) => c.dataset.id ?? "");
  const canvases = cards.map((c) => {
    const cv = document.createElement("canvas");
    cv.className = "ic3d";
    c.appendChild(cv);
    return cv.getContext("2d")!;
  });
  const size = 160;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.4));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const camera = new PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0.2, 4);
  const mat = (c: number) => new MeshLambertMaterial({ color: new Color(c) });

  const make: Record<string, () => Group> = {
    // tennis ball: fuzz-yellow with the two curved seams
    // tennis ball: felt yellow, with the classic seam: one closed wavy curve
    // (the "tennis ball curve") drawn as a tube that sits just on the surface
    tennis: () => {
      const g = new Group();
      g.add(new Mesh(new SphereGeometry(0.7, 32, 24), mat(0xd7ec4a)));
      const pts: Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        // a standard parametrisation: a = 0.44 gives the familiar shape
        const a = 0.44;
        const x = Math.cos(t) + a * Math.cos(3 * t), y = Math.sin(t) - a * Math.sin(3 * t), z = 2 * Math.sqrt(a * (1 - a)) * Math.sin(2 * t);
        pts.push(new Vector3(x, y, z).normalize().multiplyScalar(0.705));
      }
      g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts, true), 200, 0.035, 8, true), mat(0xffffff)));
      return g;
    },
    // target face with black, blue, red, gold rings, a stand, and an arrow in the gold
    archery: () => {
      const g = new Group();
      [[0.82, 0xffffff], [0.68, 0x1d1d1f], [0.54, 0x2f7fe0], [0.4, 0xee334e], [0.24, 0xfcb131]].forEach(([r, c], i) => {
        const m = new Mesh(new CylinderGeometry(r as number, r as number, 0.1, 36), mat(c as number));
        m.rotation.x = Math.PI / 2; m.position.z = i * 0.025; g.add(m);
      });
      for (const sgn of [1, -1]) { const leg = new Mesh(new CylinderGeometry(0.04, 0.04, 1.1, 8), mat(0x8a5a2b)); leg.position.set(0.35 * sgn, -0.75, -0.15); leg.rotation.z = 0.25 * sgn; g.add(leg); }
      const shaft = new Mesh(new CylinderGeometry(0.025, 0.025, 0.9, 8), mat(0x6b4a2a)); shaft.rotation.x = Math.PI / 2; shaft.position.set(0.05, 0.05, 0.5); g.add(shaft);
      const flight = new Mesh(new BoxGeometry(0.02, 0.16, 0.18), mat(0xee334e)); flight.position.set(0.05, 0.05, 0.9); g.add(flight);
      return g;
    },
    // running shoe: upper, white sole, laces, a swoosh-free stripe, spikes plate
    // running shoe in profile: a shaped upper (extruded outline), a thick
    // white midsole, a red spike plate, laces and a contrast stripe
    track: () => {
      const g = new Group();
      const up = new Shape();
      up.moveTo(-0.85, -0.15); up.lineTo(-0.88, 0.25); up.quadraticCurveTo(-0.86, 0.52, -0.6, 0.55);
      up.lineTo(-0.35, 0.52); up.quadraticCurveTo(-0.1, 0.28, 0.25, 0.22); up.quadraticCurveTo(0.75, 0.12, 0.9, -0.05);
      up.lineTo(0.92, -0.15); up.lineTo(-0.85, -0.15);
      const upper = new Mesh(new ExtrudeGeometry(up, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 16 }), mat(0x2f7fe0));
      upper.position.z = -0.25; g.add(upper);
      const so = new Shape();
      so.moveTo(-0.9, -0.15); so.lineTo(0.95, -0.15); so.quadraticCurveTo(1.05, -0.2, 0.95, -0.34); so.lineTo(-0.88, -0.34); so.quadraticCurveTo(-0.98, -0.26, -0.9, -0.15);
      const sole = new Mesh(new ExtrudeGeometry(so, { depth: 0.58, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }), mat(0xffffff));
      sole.position.z = -0.29; g.add(sole);
      const plate = new Mesh(new BoxGeometry(0.9, 0.06, 0.6), mat(0xee334e)); plate.position.set(0.42, -0.38, 0); g.add(plate);
      for (let i = 0; i < 4; i++) { const spike = new Mesh(new ConeGeometry(0.035, 0.08, 6), mat(0x9aa4ad)); spike.rotation.x = Math.PI; spike.position.set(0.12 + i * 0.22, -0.45, 0); g.add(spike); }
      const stripe = new Shape(); stripe.moveTo(-0.55, 0.0); stripe.quadraticCurveTo(0.0, 0.18, 0.6, 0.02); stripe.lineTo(0.55, -0.06); stripe.quadraticCurveTo(0.0, 0.08, -0.5, -0.08);
      const st = new Mesh(new ExtrudeGeometry(stripe, { depth: 0.64, bevelEnabled: false }), mat(0xfcb131)); st.position.z = -0.32; g.add(st);
      for (let i = 0; i < 4; i++) { const lace = new Mesh(new CapsuleGeometry(0.025, 0.42, 3, 6), mat(0xffffff)); lace.rotation.x = Math.PI / 2; lace.position.set(-0.28 + i * 0.15, 0.42 - i * 0.07, 0); g.add(lace); }
      const collar = new Mesh(new TorusGeometry(0.2, 0.05, 8, 20), mat(0x1d1d1f)); collar.rotation.x = Math.PI / 2; collar.scale.set(1.2, 0.8, 1); collar.position.set(-0.62, 0.55, 0); g.add(collar);
      g.scale.setScalar(0.95);
      return g;
    },
    // boxing glove: padded fist, thumb, white cuff with a lace stripe
    boxing: () => {
      const g = new Group();
      const fist = new Mesh(new SphereGeometry(0.6, 22, 16), mat(0xee334e)); fist.scale.set(1, 1.1, 1.05); g.add(fist);
      const knuckle = new Mesh(new SphereGeometry(0.45, 18, 12), mat(0xf04a62)); knuckle.position.set(0, 0.22, 0.28); knuckle.scale.set(1.2, 0.7, 0.7); g.add(knuckle);
      const thumb = new Mesh(new CapsuleGeometry(0.17, 0.3, 4, 10), mat(0xd62e48)); thumb.position.set(0.5, -0.05, 0.25); thumb.rotation.z = 0.5; g.add(thumb);
      const cuff = new Mesh(new CylinderGeometry(0.42, 0.46, 0.5, 22), mat(0xffffff)); cuff.position.y = -0.82; g.add(cuff);
      const band = new Mesh(new CylinderGeometry(0.47, 0.47, 0.08, 22), mat(0x1d1d1f)); band.position.y = -0.66; g.add(band);
      return g;
    },
    // basketball: orange with the four black seams
    // basketball: pebbled orange, the two "great circle" seams and the two
    // curved side seams, all as thin tubes sitting on the surface
    basketball: () => {
      const g = new Group();
      g.add(new Mesh(new SphereGeometry(0.72, 36, 28), mat(0xe2702a)));
      const seam = mat(0x2a1a10), R = 0.722, w = 0.022;
      const ring = (f: (t: number) => Vector3) => {
        const pts: Vector3[] = [];
        for (let i = 0; i <= 120; i++) pts.push(f((i / 120) * Math.PI * 2).normalize().multiplyScalar(R));
        g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts, true), 160, w, 6, true), seam));
      };
      ring((t) => new Vector3(Math.cos(t), Math.sin(t), 0));
      ring((t) => new Vector3(0, Math.sin(t), Math.cos(t)));
      // the curved seams: circles bent towards the poles
      for (const sgn of [1, -1]) ring((t) => new Vector3(sgn * 0.62, Math.sin(t) * 0.78, Math.cos(t) * 0.78 + 0 * sgn));
      return g;
    },
    // bowling pin: real profile from a lathe, two red neck stripes
    bowling: () => {
      const g = new Group();
      const prof = [[0, -0.9], [0.22, -0.9], [0.36, -0.6], [0.4, -0.3], [0.34, 0.05], [0.18, 0.35], [0.15, 0.5], [0.22, 0.7], [0.2, 0.86], [0.1, 0.95], [0, 0.97]].map(([x, y]) => new Vector2(x, y));
      g.add(new Mesh(new LatheGeometry(prof, 28), mat(0xffffff)));
      for (const y of [0.36, 0.46]) { const st = new Mesh(new CylinderGeometry(0.175, 0.17, 0.05, 24), mat(0xee334e)); st.position.y = y; g.add(st); }
      return g;
    },
  };
  const objs = ids.map((id) => (make[id] ?? (() => new Group()))());

  let selected = "";
  let stopped = false;
  let running = true;
  document.addEventListener("visibilitychange", () => (running = !document.hidden));
  // draw all icons ~20 times a second: plenty for a slow spin, cheap for a weak laptop
  let last = 0;
  const tick = (now: number) => {
    if (stopped) return;
    requestAnimationFrame(tick);
    if (!running || now - last < 50) return;
    last = now;
    objs.forEach((o, i) => {
      scene.add(o);
      const on = ids[i] === selected;
      // flat things (the target) rock so they never turn edge-on; the rest spin
      // flat or side-on things rock so they never turn edge-on; round things spin
      const rock = ids[i] === "archery" || ids[i] === "track";
      o.rotation.y = rock ? Math.sin(now / (on ? 300 : 900) + i) * 0.55 : now / (on ? 600 : 2400) + i;
      o.rotation.x = ids[i] === "track" ? 0.2 : 0.25;
      o.position.y = on ? Math.sin(now / 200) * 0.08 : 0;
      renderer.render(scene, camera);
      scene.remove(o);
      const ctx = canvases[i];
      if (ctx.canvas.width !== size) { ctx.canvas.width = size; ctx.canvas.height = size; }
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(renderer.domElement, 0, 0);
    });
  };
  requestAnimationFrame(tick);
  return {
    select: (id: string) => (selected = id),
    stop: () => { stopped = true; renderer.dispose(); canvases.forEach((c) => c.canvas.remove()); },
  };
}

/** Confetti in the ring colours from a point, a few seconds, then gone. */
export function confetti(x: number, y: number) {
  if (reduced) return;
  const colours = ["#0081c8", "#fcb131", "#1d1d1f", "#00a651", "#ee334e"];
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;overflow:hidden";
  document.body.appendChild(box);
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("i");
    const a = Math.random() * Math.PI * 2, v = 250 + Math.random() * 350;
    p.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:8px;height:12px;background:${colours[i % 5]};border-radius:2px;`;
    p.animate(
      [
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        { transform: `translate(${Math.cos(a) * v}px, ${Math.sin(a) * v - 120}px) rotate(${Math.random() * 720}deg)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${Math.cos(a) * v * 1.2}px, ${Math.sin(a) * v + 300}px) rotate(${Math.random() * 1080}deg)`, opacity: 0 },
      ],
      { duration: 1800 + Math.random() * 600, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" },
    );
    box.appendChild(p);
  }
  setTimeout(() => box.remove(), 2600);
}

