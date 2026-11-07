// Basketball's camera (task 32, ADR 003): ready, aim and the push read from
// pose landmarks on synthetic frames, in shoulder widths. The thresholds are
// first guesses (DEFAULT_SHOOT) until the task's recordings.
import { describe, expect, it } from "vitest";
import { DEFAULT_SHOOT, ShootDetector, aimFromAcross, powerFromPeak } from "../client/input/camera/shoot-pose.ts";
import type { ShootRead, ShotRead } from "../client/input/camera/shoot-pose.ts";
import { LM } from "../client/input/camera/pose.ts";
import type { Point } from "../client/input/camera/pose.ts";

const ASPECT = 16 / 9;
const FPS = 30;
const W = 0.2; // shoulder width in image heights (about 1 m from a laptop)

/** A wrist in shoulder widths: across (positive toward the player's left), down (below the shoulder line). */
interface H {
  across: number;
  down: number;
}
type Hand = H | null;

// at the chest, both hands a little either side of the middle
const CHEST_L: H = { across: 0.15, down: 0.75 };
const CHEST_R: H = { across: -0.15, down: 0.75 };
// above the head, past the face
const UP_L: H = { across: 0.1, down: -1.1 };
const UP_R: H = { across: -0.1, down: -1.1 };
// hanging at the sides
const SIDE_L: H = { across: 0.6, down: 1.6 };
const SIDE_R: H = { across: -0.6, down: 1.6 };

/**
 * A player facing a mirrored webcam (their left on image right), shoulders
 * level at image y `top`, hips in view unless `hips` is false. `lift` moves
 * the whole body up the image (a jump), in shoulder widths.
 */
function body(left: Hand, right: Hand, opts: { lift?: number; hips?: boolean } = {}): Point[] {
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const lift = opts.lift ?? 0;
  const at = (across: number, down: number): Point => ({ x: (0.5 * ASPECT + across * W) / ASPECT, y: 0.4 + (down - lift) * W, visibility: 1 });
  lm[LM.leftShoulder] = at(0.5, 0);
  lm[LM.rightShoulder] = at(-0.5, 0);
  if (left) lm[LM.leftWrist] = at(left.across, left.down);
  if (right) lm[LM.rightWrist] = at(right.across, right.down);
  if (opts.hips !== false) {
    lm[23] = at(0.35, 2.4);
    lm[24] = at(-0.35, 2.4);
  }
  return lm;
}

const lerp = (a: H, b: H, k: number): H => ({ across: a.across + (b.across - a.across) * k, down: a.down + (b.down - a.down) * k });
// a reach: slow start, fast middle, slow end, as a real arm moves
const ease = (k: number) => (1 - Math.cos(Math.PI * k)) / 2;

interface Seg {
  ms: number;
  left?: [Hand, Hand];
  right?: [Hand, Hand];
  lift?: [number, number];
  lost?: boolean;
  hips?: boolean;
  /** constant speed instead of easing in and out (a motion that carries on into the next segment) */
  linear?: boolean;
}

class Player {
  t = 0;
  left: Hand = CHEST_L;
  right: Hand = CHEST_R;
  lift = 0;
  reads: ShootRead[] = [];
  d: ShootDetector;
  constructor(d: ShootDetector) {
    this.d = d;
  }

  play(...segs: Seg[]): this {
    for (const s of segs) {
      const frames = Math.max(1, Math.round((s.ms / 1000) * FPS));
      for (let i = 1; i <= frames; i++) {
        this.t += 1000 / FPS;
        const k = s.linear ? i / frames : ease(i / frames);
        const mv = (r: [Hand, Hand] | undefined, cur: Hand): Hand => (!r ? cur : r[0] && r[1] ? lerp(r[0], r[1], k) : r[1]);
        this.left = mv(s.left, this.left);
        this.right = mv(s.right, this.right);
        if (s.lift) this.lift = s.lift[0] + (s.lift[1] - s.lift[0]) * k;
        const lm = s.lost ? null : body(this.left, this.right, { lift: this.lift, hips: s.hips });
        this.reads.push(this.d.update({ t: this.t, landmarks: lm, aspect: ASPECT }));
      }
    }
    return this;
  }

  /** Hold where you are. */
  hold(ms: number, extra: Partial<Seg> = {}): this {
    return this.play({ ms, ...extra });
  }

  get sets(): number {
    return this.reads.filter((r) => r.set).length;
  }
  get shots(): ShotRead[] {
    return this.reads.flatMap((r) => (r.shot ? [r.shot] : []));
  }
  get last(): ShootRead {
    return this.reads[this.reads.length - 1];
  }
}

/** A player whose turn it is, standing with both hands at the chest. */
function onTurn(): Player {
  const d = new ShootDetector();
  d.setTurn(true);
  return new Player(d);
}

const push = (ms: number, hands: "both" | "left" | "right" = "both", from = { l: CHEST_L, r: CHEST_R }, to = { l: UP_L, r: UP_R }): Seg => ({
  ms,
  left: hands !== "right" ? [from.l, to.l] : undefined,
  right: hands !== "left" ? [from.r, to.r] : undefined,
});

describe("basketball camera: ready", () => {
  it("hands still at the chest send set once a turn", () => {
    const p = onTurn().hold(1500);
    expect(p.sets).toBe(1);
    expect(p.last.ready).toBe(true);
    expect(p.last.state).toBe("set");
    p.hold(1500);
    expect(p.sets).toBe(1);
  });

  it("one hand at the chest is enough", () => {
    const p = onTurn().play({ ms: 300, left: [CHEST_L, SIDE_L] }).hold(1000);
    expect(p.sets).toBe(1);
  });

  it("hands moving at the chest are not set yet", () => {
    const p = onTurn();
    for (let i = 0; i < 6; i++) p.play({ ms: 150, left: [CHEST_L, { across: 0.5, down: 0.75 }], right: [CHEST_R, { across: -0.5, down: 0.75 }] }, { ms: 150, left: [{ across: 0.5, down: 0.75 }, CHEST_L], right: [{ across: -0.5, down: 0.75 }, CHEST_R] });
    expect(p.sets).toBe(0);
  });

  it("hands hanging at the sides are not set", () => {
    const p = onTurn().play({ ms: 300, left: [CHEST_L, SIDE_L], right: [CHEST_R, SIDE_R] }).hold(1500);
    expect(p.sets).toBe(0);
    expect(p.last.ready).toBe(false);
  });

  it("a new turn allows set again", () => {
    const p = onTurn().hold(1000);
    p.d.setTurn(false);
    p.hold(500);
    p.d.setTurn(true);
    p.hold(1000);
    expect(p.sets).toBe(2);
  });

  it("a frame that ends above the chest asks to raise the hands", () => {
    const p = onTurn().hold(500, { left: [null, null], right: [null, null], hips: false });
    expect(p.last.tracking).toBe(true);
    expect(p.last.raise).toBe(true);
    expect(p.last.state).toBe("raise");
    expect(p.sets).toBe(0);
  });

  it("hands seen at the chest don't ask to raise them, even without hips", () => {
    const p = onTurn().hold(500, { hips: false });
    expect(p.last.raise).toBe(false);
  });
});

describe("basketball camera: aim", () => {
  it("follows the hands and is mirrored so the player's right aims right", () => {
    const p = onTurn().hold(500);
    expect(Math.abs(p.last.aim)).toBeLessThan(0.05);
    // move both hands to the player's right (negative across)
    p.play({ ms: 300, left: [CHEST_L, { across: -0.3, down: 0.75 }], right: [CHEST_R, { across: -0.6, down: 0.75 }] }).hold(600);
    expect(p.last.aim).toBeGreaterThan(0.6);
    p.play({ ms: 400, left: [null, { across: 0.6, down: 0.75 }], right: [null, { across: 0.3, down: 0.75 }] }).hold(600);
    expect(p.last.aim).toBeLessThan(-0.6);
  });

  it("is -1..1 with a small dead zone", () => {
    expect(aimFromAcross(0)).toBe(0);
    expect(aimFromAcross(0.03)).toBe(0);
    expect(aimFromAcross(-5)).toBe(1);
    expect(aimFromAcross(5)).toBe(-1);
    expect(aimFromAcross(-0.3)).toBeGreaterThan(0);
  });

  it("is live off-turn too (the setup step's arrow)", () => {
    const d = new ShootDetector();
    const p = new Player(d).hold(300);
    p.play({ ms: 300, left: [CHEST_L, { across: -0.3, down: 0.75 }], right: [CHEST_R, { across: -0.6, down: 0.75 }] }).hold(500);
    expect(p.last.aim).toBeGreaterThan(0.5);
  });
});

describe("basketball camera: the shot", () => {
  it("a fast two-hand push shoots once, with both hands", () => {
    const p = onTurn().hold(800).play(push(250)).hold(300);
    expect(p.shots).toHaveLength(1);
    expect(p.shots[0].hands).toBe("both");
    expect(p.shots[0].power).toBeGreaterThan(0.3);
    expect(p.last.state).toBe("shot");
  });

  it("one hand, left or right, shoots with that hand", () => {
    const l = onTurn().hold(800).play(push(250, "left")).hold(300);
    expect(l.shots.map((s) => s.hands)).toEqual(["left"]);
    const r = onTurn().hold(800).play(push(250, "right")).hold(300);
    expect(r.shots.map((s) => s.hands)).toEqual(["right"]);
    expect(Math.abs(l.shots[0].power - r.shots[0].power)).toBeLessThan(0.05);
  });

  it("a slow push reads softer than a fast one", () => {
    const soft = onTurn().hold(800).play(push(500)).hold(300).shots;
    const mid = onTurn().hold(800).play(push(300)).hold(300).shots;
    const hard = onTurn().hold(800).play(push(180)).hold(300).shots;
    expect(soft).toHaveLength(1);
    expect(mid).toHaveLength(1);
    expect(hard).toHaveLength(1);
    expect(soft[0].power).toBeLessThan(mid[0].power);
    expect(mid[0].power).toBeLessThan(hard[0].power);
    expect(hard[0].power).toBeLessThanOrEqual(1);
    expect(soft[0].power).toBeGreaterThanOrEqual(0);
  });

  it("power maps peak speed to 0..1", () => {
    expect(powerFromPeak(0)).toBe(0);
    expect(powerFromPeak(DEFAULT_SHOOT.power0)).toBe(0);
    expect(powerFromPeak(DEFAULT_SHOOT.power1)).toBe(1);
    expect(powerFromPeak(100)).toBe(1);
  });

  it("the aim locks where it was when the push began, despite drift", () => {
    const right = { l: { across: -0.25, down: 0.75 }, r: { across: -0.55, down: 0.75 } };
    const p = onTurn()
      .play({ ms: 300, left: [CHEST_L, right.l], right: [CHEST_R, right.r] })
      .hold(800);
    const before = p.last.aim;
    expect(before).toBeGreaterThan(0.6);
    // push up, drifting hard to the player's left on the way
    p.play(push(250, "both", right, { l: { across: 0.9, down: -1.1 }, r: { across: 0.6, down: -1.1 } })).hold(200);
    expect(p.shots).toHaveLength(1);
    expect(p.shots[0].aim).toBeCloseTo(before, 1);
  });

  it("a jump adds no power", () => {
    const still = onTurn().hold(800).play(push(300)).hold(300).shots;
    const jump = onTurn()
      .hold(800)
      .play({ ...push(300), lift: [0, 1.5] })
      .hold(300).shots;
    expect(jump).toHaveLength(1);
    expect(jump[0].power).toBeCloseTo(still[0].power, 2);
  });

  it("jumping with the hands at the chest is no shot", () => {
    const p = onTurn().hold(800).play({ ms: 200, lift: [0, 1.5] }, { ms: 200, lift: [1.5, 0] }).hold(300);
    expect(p.shots).toHaveLength(0);
  });

  it("a chest pass (nearly all forward, little rise) reads soft", () => {
    const pass = onTurn()
      .hold(800)
      .play(push(150, "both", { l: CHEST_L, r: CHEST_R }, { l: { across: 0.15, down: 0.3 }, r: { across: -0.15, down: 0.3 } }))
      .hold(400).shots;
    const shot = onTurn().hold(800).play(push(250)).hold(300).shots;
    expect(pass).toHaveLength(1);
    expect(pass[0].power).toBeLessThan(0.15);
    expect(pass[0].power).toBeLessThan(shot[0].power / 2);
  });

  it("one shot a turn, and a new turn allows another", () => {
    const p = onTurn().hold(800).play(push(250)).hold(200).play(push(400, "both", { l: UP_L, r: UP_R }, { l: CHEST_L, r: CHEST_R })).hold(800).play(push(250)).hold(300);
    expect(p.shots).toHaveLength(1);
    p.d.setTurn(false);
    p.d.setTurn(true);
    p.play(push(400, "both", { l: UP_L, r: UP_R }, { l: CHEST_L, r: CHEST_R })).hold(800).play(push(250)).hold(300);
    expect(p.shots).toHaveLength(2);
  });

  it("off-turn nothing: no set, no shot", () => {
    const p = new Player(new ShootDetector()).hold(1500).play(push(250)).hold(300);
    expect(p.sets).toBe(0);
    expect(p.shots).toHaveLength(0);
    expect(p.last.state).toBe("off-turn");
  });

  it("an off-turn push isn't saved up for the next turn", () => {
    // one steady push, the turn starting halfway up
    const mid: H = { across: 0.12, down: -0.2 };
    const p = new Player(new ShootDetector()).hold(800).play({ ms: 100, left: [CHEST_L, mid], right: [CHEST_R, { ...mid, across: -0.12 }], linear: true });
    p.d.setTurn(true);
    p.play({ ms: 100, left: [mid, UP_L], right: [{ ...mid, across: -0.12 }, UP_R], linear: true }).hold(300);
    expect(p.shots).toHaveLength(0);
  });

  it("landmarks lost mid-push don't fire a shot", () => {
    const p = onTurn()
      .hold(800)
      .play({ ms: 100, left: [CHEST_L, { across: 0.12, down: 0.2 }], right: [CHEST_R, { across: -0.12, down: 0.2 }] })
      .hold(100, { lost: true })
      .play({ ms: 100, left: [null, UP_L], right: [null, UP_R] })
      .hold(300);
    expect(p.shots).toHaveLength(0);
  });

  it("wrists lost mid-push (out of the top of the frame) don't fire", () => {
    const p = onTurn()
      .hold(800)
      .play({ ms: 100, left: [CHEST_L, { across: 0.12, down: 0.2 }], right: [CHEST_R, { across: -0.12, down: 0.2 }] })
      .hold(300, { left: [null, null], right: [null, null] });
    expect(p.shots).toHaveLength(0);
  });
});

describe("basketball camera: moving, no shot", () => {
  it("swaying to aim doesn't shoot", () => {
    const p = onTurn().hold(500);
    for (let i = 0; i < 4; i++) {
      p.play({ ms: 400, left: [null, { across: -0.3, down: 0.7 }], right: [null, { across: -0.6, down: 0.8 }] });
      p.play({ ms: 400, left: [null, { across: 0.6, down: 0.8 }], right: [null, { across: 0.3, down: 0.7 }] });
    }
    expect(p.shots).toHaveLength(0);
  });

  it("scratching your head doesn't shoot", () => {
    const head: H = { across: -0.3, down: -1.0 };
    const p = onTurn().hold(800).play({ ms: 1000, right: [CHEST_R, head] }).hold(600).play({ ms: 900, right: [head, CHEST_R] }).hold(400);
    expect(p.shots).toHaveLength(0);
  });

  it("waving from the side doesn't shoot", () => {
    const wave: H = { across: -0.9, down: -1.2 };
    const p = onTurn().play({ ms: 300, left: [CHEST_L, SIDE_L], right: [CHEST_R, SIDE_R] }).hold(500);
    for (let i = 0; i < 3; i++) p.play({ ms: 200, right: [SIDE_R, wave] }, { ms: 300, right: [wave, { across: -1.3, down: -1.1 }] }, { ms: 300, right: [null, SIDE_R] });
    expect(p.shots).toHaveLength(0);
  });

  it("hands bobbing a little at the chest don't shoot", () => {
    const p = onTurn().hold(500);
    for (let i = 0; i < 5; i++)
      p.play({ ms: 150, left: [CHEST_L, { across: 0.15, down: 0.6 }], right: [CHEST_R, { across: -0.15, down: 0.6 }] }, { ms: 150, left: [null, CHEST_L], right: [null, CHEST_R] });
    expect(p.shots).toHaveLength(0);
  });
});
