import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
} from "three";

// Track's scene (task 26), low-poly and flat-shaded from primitives: a red
// track with two lanes down +x, white lines, start and finish, grass and a
// low stand. Runners are small Mii-style figures with a run cycle.

export const LANE_WIDTH = 1.22;
/** Lane centres along z: seat 0 nearer the camera. */
export const laneZ = (seat: 0 | 1): number => (seat === 0 ? LANE_WIDTH / 2 : -LANE_WIDTH / 2);

const flat = (color: number) => new MeshLambertMaterial({ color, flatShading: true });

export function buildTrack(scene: Scene, length: number): void {
  scene.add(new HemisphereLight(0xdff2ff, 0x4a7a3a, 1.4));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(20, 40, 30);
  scene.add(sun);

  const grass = new Mesh(new PlaneGeometry(length + 80, 60), flat(0x6fbf5a));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(length / 2, -0.01, 0);
  scene.add(grass);

  const width = LANE_WIDTH * 4;
  const track = new Mesh(new PlaneGeometry(length + 30, width), flat(0xc4553a));
  track.rotation.x = -Math.PI / 2;
  track.position.set(length / 2, 0, 0);
  scene.add(track);

  const white = new MeshBasicMaterial({ color: 0xffffff });
  // lane lines, then start and finish across them
  for (const z of [-LANE_WIDTH, 0, LANE_WIDTH]) {
    const line = new Mesh(new PlaneGeometry(length + 30, 0.05), white);
    line.rotation.x = -Math.PI / 2;
    line.position.set(length / 2, 0.005, z);
    scene.add(line);
  }
  for (const [x, w] of [[0, 0.08], [length, 0.3]] as const) {
    const line = new Mesh(new PlaneGeometry(w, LANE_WIDTH * 2), white);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.006, 0);
    scene.add(line);
  }
  // distance marks every 10 m
  for (let x = 10; x < length; x += 10) {
    const mark = new Mesh(new PlaneGeometry(0.05, LANE_WIDTH * 2), new MeshBasicMaterial({ color: 0xf2c1b5 }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(x, 0.004, 0);
    scene.add(mark);
  }
  // finish posts and tape
  for (const z of [-LANE_WIDTH - 0.2, LANE_WIDTH + 0.2]) {
    const post = new Mesh(new CylinderGeometry(0.05, 0.05, 1.6, 6), flat(0xeeeeee));
    post.position.set(length, 0.8, z);
    scene.add(post);
  }
  const banner = new Mesh(new BoxGeometry(0.06, 0.3, LANE_WIDTH * 2 + 0.4), flat(0xffd23f));
  banner.position.set(length, 1.6, 0);
  scene.add(banner);

  // a low stand behind the far lane, in blocks
  const stand = new Group();
  for (let x = -10; x < length + 20; x += 6) {
    const block = new Mesh(new BoxGeometry(5.6, 1.4, 3), flat(x % 12 === 0 ? 0x2f7fe0 : 0x3d8ff0));
    block.position.set(x, 0.7, -width / 2 - 3);
    stand.add(block);
  }
  scene.add(stand);
}

export interface Runner {
  group: Group;
  /** `phase` in radians through the stride; `speed` 0..1 sets the swing size. */
  run(phase: number, speed: number): void;
}

export function makeRunner(shirt: number): Runner {
  const group = new Group();
  const skin = flat(0xf3cfae);
  const top = flat(shirt);
  const legs = flat(0x2b303b);

  const shadow = new Mesh(new CircleGeometry(0.35, 12), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);

  const body = new Group();
  group.add(body);
  const torso = new Mesh(new CylinderGeometry(0.17, 0.14, 0.55, 8), top);
  torso.position.y = 1.05;
  const head = new Mesh(new SphereGeometry(0.24, 12, 10), skin);
  head.position.y = 1.6;
  body.add(torso, head);

  // limbs hang from pivots; +x is forward along the track
  const limb = (y: number, z: number, len: number, mat: MeshLambertMaterial) => {
    const pivot = new Group();
    pivot.position.set(0, y, z);
    const m = new Mesh(new CapsuleGeometry(0.06, len, 3, 6), mat);
    m.position.y = -len / 2 - 0.05;
    pivot.add(m);
    body.add(pivot);
    return pivot;
  };
  const legL = limb(0.78, 0.1, 0.62, legs);
  const legR = limb(0.78, -0.1, 0.62, legs);
  const armL = limb(1.3, 0.22, 0.45, top);
  const armR = limb(1.3, -0.22, 0.45, top);

  return {
    group,
    run(phase, speed) {
      const swing = 0.15 + 0.75 * speed;
      const s = Math.sin(phase);
      // legs and opposite arms swing about z (forward and back along x)
      legL.rotation.z = s * swing;
      legR.rotation.z = -s * swing;
      armL.rotation.z = -s * swing * 0.9;
      armR.rotation.z = s * swing * 0.9;
      body.position.y = Math.abs(Math.cos(phase)) * 0.06 * speed;
      body.rotation.z = -0.15 * speed;
    },
  };
}
