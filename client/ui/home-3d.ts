// Task 36: the sport cards' small spinning 3D icons, from the approved mock
// (user, 2026-11-08: "small 3D touches, but don't overdo the 3d-ness").
// Never imported statically: menu.ts loads this module only after the flat
// page is on screen and only when home-3d-gate.ts allows it (a window at
// least 760 wide, no reduced motion); here WebGL is checked too. One shared
// renderer draws every icon in turn into a small 2D canvas per card, about
// 20 times a second. If the page can't hold ICONS_3D_MIN_FPS it stops, frees
// the renderer and the flat icons come back. Stops by itself once the menu
// is gone (a game started), so no WebGL context outlives the home screen.
import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { ICONS_3D_MIN_FPS } from "./home-3d-gate.ts";

export interface Icons3d {
  select(id: string): void;
  stop(): void;
}

export function webglWorks(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const mat = (c: number) => new MeshLambertMaterial({ color: new Color(c) });

const MAKE: Record<string, () => Group> = {
  // a tennis ball: felt yellow with its one closed wavy seam
  tennis: () => {
    const g = new Group();
    g.add(new Mesh(new SphereGeometry(0.7, 32, 24), mat(0xd7ec4a)));
    const pts: Vector3[] = [];
    const a = 0.44;
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * Math.PI * 2;
      pts.push(new Vector3(Math.cos(t) + a * Math.cos(3 * t), Math.sin(t) - a * Math.sin(3 * t), 2 * Math.sqrt(a * (1 - a)) * Math.sin(2 * t)).normalize().multiplyScalar(0.705));
    }
    g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts, true), 200, 0.035, 8, true), mat(0xffffff)));
    return g;
  },
  // a target face on a stand, an arrow in the gold
  archery: () => {
    const g = new Group();
    ([[0.82, 0xffffff], [0.68, 0x1d1d1f], [0.54, 0x2f7fe0], [0.4, 0xee334e], [0.24, 0xfcb131]] as const).forEach(([r, c], i) => {
      const m = new Mesh(new CylinderGeometry(r, r, 0.1, 36), mat(c));
      m.rotation.x = Math.PI / 2;
      m.position.z = i * 0.025;
      g.add(m);
    });
    for (const s of [1, -1]) {
      const leg = new Mesh(new CylinderGeometry(0.04, 0.04, 1.1, 8), mat(0x8a5a2b));
      leg.position.set(0.35 * s, -0.75, -0.15);
      leg.rotation.z = 0.25 * s;
      g.add(leg);
    }
    const shaft = new Mesh(new CylinderGeometry(0.025, 0.025, 0.9, 8), mat(0x6b4a2a));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0.05, 0.05, 0.5);
    const flight = new Mesh(new BoxGeometry(0.02, 0.16, 0.18), mat(0xee334e));
    flight.position.set(0.05, 0.05, 0.9);
    g.add(shaft, flight);
    return g;
  },
  // a running shoe side-on: shaped upper, white midsole, spike plate, laces, a stripe
  track: () => {
    const g = new Group();
    const up = new Shape();
    up.moveTo(-0.85, -0.15);
    up.lineTo(-0.88, 0.25);
    up.quadraticCurveTo(-0.86, 0.52, -0.6, 0.55);
    up.lineTo(-0.35, 0.52);
    up.quadraticCurveTo(-0.1, 0.28, 0.25, 0.22);
    up.quadraticCurveTo(0.75, 0.12, 0.9, -0.05);
    up.lineTo(0.92, -0.15);
    up.lineTo(-0.85, -0.15);
    const upper = new Mesh(new ExtrudeGeometry(up, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 16 }), mat(0x2f7fe0));
    upper.position.z = -0.25;
    const so = new Shape();
    so.moveTo(-0.9, -0.15);
    so.lineTo(0.95, -0.15);
    so.quadraticCurveTo(1.05, -0.2, 0.95, -0.34);
    so.lineTo(-0.88, -0.34);
    so.quadraticCurveTo(-0.98, -0.26, -0.9, -0.15);
    const sole = new Mesh(new ExtrudeGeometry(so, { depth: 0.58, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }), mat(0xffffff));
    sole.position.z = -0.29;
    const plate = new Mesh(new BoxGeometry(0.9, 0.06, 0.6), mat(0xee334e));
    plate.position.set(0.42, -0.38, 0);
    g.add(upper, sole, plate);
    for (let i = 0; i < 4; i++) {
      const spike = new Mesh(new ConeGeometry(0.035, 0.08, 6), mat(0x9aa4ad));
      spike.rotation.x = Math.PI;
      spike.position.set(0.12 + i * 0.22, -0.45, 0);
      const lace = new Mesh(new CapsuleGeometry(0.025, 0.42, 3, 6), mat(0xffffff));
      lace.rotation.x = Math.PI / 2;
      lace.position.set(-0.28 + i * 0.15, 0.42 - i * 0.07, 0);
      g.add(spike, lace);
    }
    const stripe = new Shape();
    stripe.moveTo(-0.55, 0);
    stripe.quadraticCurveTo(0, 0.18, 0.6, 0.02);
    stripe.lineTo(0.55, -0.06);
    stripe.quadraticCurveTo(0, 0.08, -0.5, -0.08);
    const st = new Mesh(new ExtrudeGeometry(stripe, { depth: 0.64, bevelEnabled: false }), mat(0xfcb131));
    st.position.z = -0.32;
    const collar = new Mesh(new TorusGeometry(0.2, 0.05, 8, 20), mat(0x1d1d1f));
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1.2, 0.8, 1);
    collar.position.set(-0.62, 0.55, 0);
    g.add(st, collar);
    g.scale.setScalar(0.95);
    return g;
  },
  // a boxing glove: padded fist, thumb, white cuff with a band
  boxing: () => {
    const g = new Group();
    const fist = new Mesh(new SphereGeometry(0.6, 22, 16), mat(0xee334e));
    fist.scale.set(1, 1.1, 1.05);
    const knuckle = new Mesh(new SphereGeometry(0.45, 18, 12), mat(0xf04a62));
    knuckle.position.set(0, 0.22, 0.28);
    knuckle.scale.set(1.2, 0.7, 0.7);
    const thumb = new Mesh(new CapsuleGeometry(0.17, 0.3, 4, 10), mat(0xd62e48));
    thumb.position.set(0.5, -0.05, 0.25);
    thumb.rotation.z = 0.5;
    const cuff = new Mesh(new CylinderGeometry(0.42, 0.46, 0.5, 22), mat(0xffffff));
    cuff.position.y = -0.82;
    const band = new Mesh(new CylinderGeometry(0.47, 0.47, 0.08, 22), mat(0x1d1d1f));
    band.position.y = -0.66;
    g.add(fist, knuckle, thumb, cuff, band);
    return g;
  },
  // a basketball: two great-circle seams and two curved side seams
  basketball: () => {
    const g = new Group();
    g.add(new Mesh(new SphereGeometry(0.72, 36, 28), mat(0xe2702a)));
    const seam = mat(0x2a1a10);
    const ring = (f: (t: number) => Vector3) => {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 120; i++) pts.push(f((i / 120) * Math.PI * 2).normalize().multiplyScalar(0.722));
      g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts, true), 160, 0.022, 6, true), seam));
    };
    ring((t) => new Vector3(Math.cos(t), Math.sin(t), 0));
    ring((t) => new Vector3(0, Math.sin(t), Math.cos(t)));
    for (const s of [1, -1]) ring((t) => new Vector3(s * 0.62, Math.sin(t) * 0.78, Math.cos(t) * 0.78));
    return g;
  },
  // a bowling pin turned on a lathe, two red neck stripes
  bowling: () => {
    const g = new Group();
    const profile = [[0, -0.9], [0.22, -0.9], [0.36, -0.6], [0.4, -0.3], [0.34, 0.05], [0.18, 0.35], [0.15, 0.5], [0.22, 0.7], [0.2, 0.86], [0.1, 0.95], [0, 0.97]].map(([x, y]) => new Vector2(x, y));
    g.add(new Mesh(new LatheGeometry(profile, 28), mat(0xffffff)));
    for (const y of [0.36, 0.46]) {
      const st = new Mesh(new CylinderGeometry(0.175, 0.17, 0.05, 24), mat(0xee334e));
      st.position.y = y;
      g.add(st);
    }
    return g;
  },
};

/**
 * Puts a 3D icon in every card (a `canvas.ic3d`; the card's flat `svg.ic`
 * is hidden by the menu's `has3d` class) and returns its handle. `onFallback`
 * runs if the frame rate is too low, after the canvases are gone.
 */
export function mountIcons(cards: HTMLElement[], onFallback: () => void): Icons3d {
  const size = 160;
  const ids = cards.map((c) => c.dataset.sport ?? "");
  const canvases = cards.map((c) => {
    const cv = document.createElement("canvas");
    cv.className = "ic3d";
    cv.width = size;
    cv.height = size;
    cv.setAttribute("aria-hidden", "true");
    c.querySelector(".sport-art")!.append(cv);
    return cv.getContext("2d")!;
  });
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
  const objects = ids.map((id) => (MAKE[id] ?? (() => new Group()))());

  let selected = "";
  let stopped = false;
  let last = 0;
  // the page's own frame rate, measured over 2 s after a 1 s warm-up
  const started = performance.now();
  let frames = 0;
  let checked = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    renderer.dispose();
    renderer.forceContextLoss();
    for (const c of canvases) c.canvas.remove();
  };
  const tick = (now: number) => {
    if (stopped) return;
    // the menu was replaced (a game, or the menu drawn again): let go of WebGL
    if (!cards[0]?.isConnected) return stop();
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const age = now - started;
    if (!checked && age > 1000) frames++;
    if (!checked && age > 3000) {
      checked = true;
      // `?icons3d=slow` (tests) pretends the page is slow, to see the fallback
      if (frames / 2 < ICONS_3D_MIN_FPS || /[?&]icons3d=slow\b/.test(location.search)) {
        stop();
        onFallback();
        return;
      }
    }
    // the icons themselves: about 20 draws a second is plenty for a slow spin
    if (now - last < 50) return;
    last = now;
    objects.forEach((o, i) => {
      scene.add(o);
      const on = ids[i] === selected;
      // flat or side-on things rock so they never turn edge-on; round things spin
      const rock = ids[i] === "archery" || ids[i] === "track";
      o.rotation.y = rock ? Math.sin(now / (on ? 300 : 900) + i) * 0.55 : now / (on ? 600 : 2400) + i;
      o.rotation.x = ids[i] === "track" ? 0.2 : 0.25;
      o.position.y = on ? Math.sin(now / 200) * 0.08 : 0;
      renderer.render(scene, camera);
      scene.remove(o);
      const ctx = canvases[i];
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(renderer.domElement, 0, 0);
    });
  };
  requestAnimationFrame(tick);
  return { select: (id) => (selected = id), stop };
}
