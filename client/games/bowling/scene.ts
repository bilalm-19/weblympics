import {
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShapeGeometry,
  Shape,
  Vector3,
  WebGLRenderer,
} from "three";
import { BALL, HEAD_PIN_Y, PIN_SPOTS } from "../../../shared/games/bowling/sim.ts";
import type { Vec2 } from "../../../shared/games/bowling/sim.ts";
import type { Look } from "../../../shared/look.ts";
import { makePlayer } from "../tennis/character.ts";
import type { Player } from "../tennis/character.ts";
import { buildAlley, makeBall, makePin } from "./alley.ts";

// The bowling scene (task 29): the alley, the bowler, the ball, the pins, the
// guide arrow and the last ball's path, drawn from a BowlView each frame. It
// reads nothing else: view.ts builds the BowlView from the server's snapshots.
// A player's camera sits behind the bowler, follows the ball down the lane
// and ends on the pin deck; a spectator's is up and to the side.
//
// World frame: x across the lane (+x the bowler's right), y up, the lane
// running away along -z: a lane point (x, y) is (x, 0, -y).

export const SEAT_COLOURS = [0x2f7fe0, 0xe0453a] as const;

export interface BowlerView {
  seat: 0 | 1;
  look: Look;
  /** Where the ball would start across the lane (startX of the aim), metres. */
  x: number;
  /** 0..1 how far the arm is back while the power meter fills. */
  back: number;
  /** 0..1 through the release and follow-through after a throw, else null. */
  swing: number | null;
  /** The ball is in the hand. */
  holding: boolean;
}

export interface PinView {
  n: number;
  x: number;
  y: number;
  standing: boolean;
  cleared: boolean;
}

export interface BowlView {
  spectator: boolean;
  bowler: BowlerView;
  /** The other player, waiting by the ball return. */
  waiting: { seat: 0 | 1; look: Look } | null;
  ball: { x: number; y: number; gutter: boolean } | null;
  pins: PinView[];
  /** The guide arrow: the start and a third of the way down, else null. */
  arrow: { from: Vec2; to: Vec2 } | null;
  /** The current or last ball's path (lane coords). */
  path: Vec2[];
  /** Where the camera wants to be. */
  shot: "aim" | "follow" | "deck";
}

export interface BowlingScene {
  render(v: BowlView, dt: number): void;
  /** The crowd cheers or groans. */
  react(kind: "cheer" | "groan"): void;
  dispose(): void;
}

/** The bowler's hand sits this far right of their middle: the body stands this far left of the start spot. */
const HAND_X = 0.24;
const BOWLER_Z = 0.9;
const BALL_IN_HAND = BALL.radius * 1.25;

/** How the arm hangs (rotation about x; + is forward) through the swing. */
export function armAngle(back: number, swing: number | null): number {
  if (swing === null) return 0.15 - 1.15 * back;
  // the forward swing from the top of the backswing, past the hip, up to the follow-through
  const t = Math.min(1, Math.max(0, swing));
  const forward = t < 0.45 ? t / 0.45 : 1;
  const settle = t < 0.7 ? 0 : (t - 0.7) / 0.3;
  return -1.0 + 2.8 * (1 - (1 - forward) ** 2) - 1.2 * settle * settle;
}

function arrowMesh(): Mesh {
  // a flat arrow, 1 m long along +y of its shape (laid on the lane later), drawn over everything
  const s = new Shape();
  const w = 0.03;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, 0.86);
  s.lineTo(0.08, 0.86);
  s.lineTo(0, 1);
  s.lineTo(-0.08, 0.86);
  s.lineTo(-w, 0.86);
  s.closePath();
  const m = new Mesh(new ShapeGeometry(s), new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthTest: false }));
  m.renderOrder = 5;
  return m;
}

export function createBowlingScene(canvas: HTMLCanvasElement): BowlingScene {
  const scene = new Scene();
  scene.background = new Color(0x15131f);
  const alley = buildAlley(scene);

  const bowlers: [Player, Player] = [
    makePlayer({ shirt: "blue", shorts: "navy", skin: "s2", hair: "brown", style: "short" }, SEAT_COLOURS[0], { racket: false }),
    makePlayer({ shirt: "red", shorts: "navy", skin: "s2", hair: "black", style: "short" }, SEAT_COLOURS[1], { racket: false }),
  ];
  const handBalls = bowlers.map((b, i) => {
    const ball = makeBall(SEAT_COLOURS[i], BALL_IN_HAND);
    ball.position.y = -0.06;
    b.parts.hand.add(ball);
    scene.add(b.group);
    return ball;
  });

  const lanes = [makeBall(SEAT_COLOURS[0], BALL.radius), makeBall(SEAT_COLOURS[1], BALL.radius)];
  for (const b of lanes) {
    b.visible = false;
    scene.add(b);
  }

  const pins = PIN_SPOTS.map(() => {
    const p = makePin();
    scene.add(p);
    return { mesh: p, tilt: 0, dir: new Vector3(0, 0, -1) };
  });

  const arrow = arrowMesh();
  arrow.rotation.x = -Math.PI / 2;
  scene.add(arrow);
  // a soft spot under the arrow's start, so the start reads even from far back
  const spot = new Mesh(new PlaneGeometry(0.12, 0.12), new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6, depthTest: false }));
  spot.rotation.x = -Math.PI / 2;
  spot.renderOrder = 5;
  scene.add(spot);

  const pathLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthTest: false }));
  pathLine.renderOrder = 4;
  scene.add(pathLine);
  let pathKey = "";

  const camera = new PerspectiveCamera(45, 1, 0.05, 80);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const container = canvas.parentElement ?? canvas;
  let aspect = 1;
  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect >= 1 ? 45 : 62;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const camPos = new Vector3(0, 1.9, 4);
  const camLook = new Vector3(0, 0.3, -12);
  const wantPos = new Vector3();
  const wantLook = new Vector3();
  let firstFrame = true;
  const q = new Quaternion();

  const target = (v: BowlView) => {
    const portrait = aspect < 1;
    const ball = v.ball;
    // the ball's depth as the camera follows it, stopping short of the deck view
    const deckZ = -(HEAD_PIN_Y - (portrait ? 3.6 : 3.0));
    if (v.spectator) {
      if (v.shot === "aim" || !ball) {
        if (v.shot === "deck") {
          wantPos.set(1.8, 2.4, -(HEAD_PIN_Y - 2.4));
          wantLook.set(0, 0, -(HEAD_PIN_Y + 0.4));
        } else {
          wantPos.set(portrait ? 2.6 : 3.0, 3.0, portrait ? 4.8 : 3.6);
          wantLook.set(0, 0.2, -6);
        }
      } else {
        const y = Math.min(ball.y, HEAD_PIN_Y - 2.4);
        wantPos.set(1.9, 2.5, -y + 1.2);
        wantLook.set(ball.x * 0.5, 0, -y - 2.5);
      }
      return;
    }
    if (v.shot === "aim") {
      // behind the bowler, over the shoulder, looking down the lane at the pins
      // over the right shoulder, high enough that the bowler sits low in the frame
      wantPos.set(v.bowler.x + (portrait ? 0.35 : 0.55), portrait ? 2.7 : 2.35, portrait ? 5.4 : 4.3);
      wantLook.set(v.bowler.x * 0.2, 0, -HEAD_PIN_Y + 3);
    } else if (v.shot === "follow" && ball) {
      const z = Math.max(-ball.y + 3.2, deckZ);
      wantPos.set(ball.x * 0.5, 1.15, z);
      wantLook.set(ball.x * 0.7, 0.05, z - 6);
    } else {
      wantPos.set(0, portrait ? 0.95 : 0.75, deckZ);
      wantLook.set(0, 0.15, -(HEAD_PIN_Y + 0.4));
    }
  };

  return {
    react(kind) {
      alley.react(kind);
    },
    render(v, dt) {
      const step = Math.min(Math.max(dt, 0), 0.1);
      alley.update(step);

      // the bowler on the approach, and the other one by the ball return
      bowlers.forEach((b, i) => {
        const g = b.group;
        if (v.bowler.seat === i) {
          b.setLook(v.bowler.look);
          g.visible = true;
          const swingZ = v.bowler.swing === null ? 0 : -0.5 * Math.min(1, v.bowler.swing * 1.6);
          g.position.set(v.bowler.x - HAND_X, 0, BOWLER_Z + swingZ);
          g.rotation.set(0, 0, 0);
          const a = armAngle(v.bowler.back, v.bowler.swing);
          b.parts.arm.rotation.set(a, 0, 0);
          // a little crouch and lean into the release
          const lean = v.bowler.swing === null ? 0.2 * v.bowler.back : 0.25 * Math.sin(Math.min(1, v.bowler.swing) * Math.PI);
          b.parts.body.rotation.x = -lean;
          handBalls[i].visible = v.bowler.holding;
        } else if (v.waiting && v.waiting.seat === i) {
          b.setLook(v.waiting.look);
          g.visible = true;
          g.position.set(-1.35, 0, 2.6);
          g.rotation.set(0, 0.5, 0);
          b.parts.arm.rotation.set(0.1, 0, 0);
          b.parts.body.rotation.x = 0;
          handBalls[i].visible = false;
        } else g.visible = false;
      });

      // the rolling ball, turning as it goes
      lanes.forEach((b, i) => {
        b.visible = v.ball !== null && v.bowler.seat === i;
        if (!b.visible || !v.ball) return;
        const y = v.ball.gutter ? BALL.radius - 0.05 : BALL.radius;
        b.position.set(v.ball.x, y, -v.ball.y);
        b.rotation.x = -v.ball.y / BALL.radius;
      });

      // the pins: standing, tipping over toward where they were knocked, or swept away
      for (const p of v.pins) {
        const pin = pins[p.n - 1];
        if (!pin) continue;
        pin.mesh.visible = !p.cleared;
        if (p.cleared) {
          pin.tilt = 0;
          continue;
        }
        const home = PIN_SPOTS[p.n - 1];
        const dx = p.x - home.x;
        const dz = -(p.y - home.y);
        if (!p.standing && Math.hypot(dx, dz) > 0.005) pin.dir.set(dx, 0, dz).normalize();
        const want = p.standing ? 0 : Math.PI / 2;
        pin.tilt += (want - pin.tilt) * (1 - Math.exp(-14 * step));
        q.setFromAxisAngle(new Vector3(pin.dir.z, 0, -pin.dir.x).normalize(), pin.tilt);
        pin.mesh.quaternion.copy(q);
        pin.mesh.position.set(p.x, 0.06 * Math.sin(pin.tilt), -p.y);
      }

      // the guide arrow: the start and the first third, nothing further
      arrow.visible = spot.visible = v.arrow !== null;
      if (v.arrow) {
        const { from, to } = v.arrow;
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        arrow.position.set(from.x, 0.012, -from.y);
        arrow.scale.set(1, Math.max(0.01, len), 1);
        arrow.rotation.set(-Math.PI / 2, 0, -Math.atan2(to.x - from.x, to.y - from.y));
        spot.position.set(from.x, 0.011, -from.y - 0.06);
      }

      // the last ball's path, faint
      const key = v.path.length ? `${v.path.length}:${v.path[0].x.toFixed(3)}:${v.path.at(-1)!.y.toFixed(2)}` : "";
      if (key !== pathKey) {
        pathKey = key;
        pathLine.geometry.dispose();
        pathLine.geometry = new BufferGeometry().setFromPoints(v.path.map((p) => new Vector3(p.x, 0.008, -p.y)));
      }
      pathLine.visible = v.path.length > 1;

      target(v);
      if (firstFrame) {
        camPos.copy(wantPos);
        camLook.copy(wantLook);
        firstFrame = false;
      } else {
        const k = 1 - Math.exp(-(v.shot === "follow" ? 7 : 3.5) * step);
        camPos.lerp(wantPos, k);
        camLook.lerp(wantLook, k);
      }
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      renderer.dispose();
    },
  };
}
