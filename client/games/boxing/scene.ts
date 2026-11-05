import { DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { DEFAULT_LOOKS } from "../../../shared/look.ts";
import { makeBoxer } from "./boxer.ts";
import { FOE_DISTANCE, HEAD_Y } from "./boxer-pose.ts";
import { buildRing, RING_Y } from "./ring.ts";
import { SEAT_COLOURS } from "./scene-model.ts";
import type { RingView } from "./scene-model.ts";

// The boxing scene (task 30): the ring, two boxers and the camera, drawn
// from a RingView each frame. It reads nothing else: view.ts builds the
// RingView from the server's snapshot. A player sees first-person, from just
// above and behind their own head (hidden), their own gloves at the bottom of
// the frame and the other boxer's face, guard and lean in the middle. A
// spectator sees both from the side, `me` on the left.

export interface BoxingScene {
  /** Draws one frame; `dt` is the seconds since the last one (for easing). */
  render(v: RingView, dt: number): void;
  /** Fits the canvas to its container (also called on its own when the container resizes). */
  resize(): void;
  dispose(): void;
}

/** Where each boxer stands: `me` at +z facing -z, the foe at -z facing +z. */
const ME_Z = FOE_DISTANCE / 2;
const HEAD = RING_Y + HEAD_Y;

/**
 * The first-person camera for a canvas of `aspect` (width / height): how far
 * behind the head and above it, the vertical field of view, and where it
 * looks. A narrow (portrait) canvas pulls back and widens, so both your own
 * gloves and the foe's head still fit across it.
 */
export function firstPersonCamera(aspect: number): { back: number; up: number; fov: number; lookY: number } {
  if (aspect >= 1.2) return { back: 0.5, up: 0.32, fov: 58, lookY: HEAD - 0.3 };
  if (aspect >= 0.8) return { back: 0.65, up: 0.38, fov: 64, lookY: HEAD - 0.28 };
  return { back: 0.95, up: 0.45, fov: 72, lookY: HEAD - 0.22 };
}

export function createBoxingScene(canvas: HTMLCanvasElement): BoxingScene {
  const scene = new Scene();
  const arena = buildRing(scene);
  scene.add(new HemisphereLight(0xdfe6f2, 0x1a1c22, 1.1));
  // the lamps over the ring: a key light from above and in front of each boxer
  const key = new DirectionalLight(0xfff4e0, 2.2);
  key.position.set(1.5, 9, 3);
  const back = new DirectionalLight(0xcfdcff, 1.0);
  back.position.set(-2, 7, -4);
  scene.add(key, back);

  const me = makeBoxer(DEFAULT_LOOKS[0], SEAT_COLOURS[0]);
  const foe = makeBoxer(DEFAULT_LOOKS[1], SEAT_COLOURS[1]);
  me.group.position.set(0, RING_Y, ME_Z);
  foe.group.position.set(0, RING_Y, -ME_Z);
  foe.group.rotation.y = Math.PI;
  scene.add(me.group, foe.group);

  const camera = new PerspectiveCamera(52, 1, 0.05, 60);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  let aspect = 1;
  let firstPerson: boolean | null = null;
  const container = canvas.parentElement ?? canvas;
  const resize = () => {
    const w = container.clientWidth || canvas.clientWidth || 1;
    const h = container.clientHeight || canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const placeCamera = (spectator: boolean) => {
    if (spectator) {
      // side-on, far enough back that both boxers fit across a narrow screen
      // raised a little and off the middle rope tie; a portrait screen
      // widens the view rather than backing into the crowd
      const wide = aspect >= 1;
      camera.fov = wide ? 42 : 80;
      // portrait stands just inside the ropes, so no post or rope is in front
      camera.position.set(wide ? 4.2 : 2.6, HEAD + (wide ? 0.55 : 0.2), wide ? 0.9 : 0.25);
      camera.lookAt(0, RING_Y + (wide ? 1.15 : 1.25), 0);
    } else {
      const c = firstPersonCamera(aspect);
      camera.fov = c.fov;
      camera.position.set(0, HEAD + c.up, ME_Z + c.back);
      camera.lookAt(0, c.lookY, -ME_Z);
    }
    camera.updateProjectionMatrix();
  };

  const lookKeys = ["", ""];
  const gloveKeys = [-1, -1];
  const tmp = new Vector3();

  return {
    resize,
    render(v, dt) {
      const step = Math.min(Math.max(dt, 0), 0.1);
      const fp = !v.spectator;
      if (fp !== firstPerson) {
        firstPerson = fp;
        me.setFirstPerson(fp);
      }
      // the ring turns round so your own corner is behind you
      const mySeat = v.me.seat ?? 0;
      arena.rotation.y = !v.spectator && mySeat === 1 ? Math.PI : 0;
      [v.me, v.foe].forEach((b, i) => {
        const boxer = i === 0 ? me : foe;
        const seat = b.seat ?? (i === 0 ? 0 : 1);
        const key = JSON.stringify(b.look);
        if (key !== lookKeys[i]) {
          boxer.setLook(b.look);
          lookKeys[i] = key;
        }
        if (seat !== gloveKeys[i]) {
          boxer.setGloveColour(SEAT_COLOURS[seat]);
          gloveKeys[i] = seat;
        }
        boxer.update(b, step);
      });
      placeCamera(v.spectator);
      canvas.dataset.foeHead = foe.headWorld(tmp).project(camera).toArray().map((n) => n.toFixed(2)).join(",");
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      renderer.dispose();
    },
  };
}
