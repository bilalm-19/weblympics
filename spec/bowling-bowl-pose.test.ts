// Bowling's camera (task 29, ADR 004): aim, the release past the hip, its
// speed and the curve, read from pose landmarks on synthetic frames, in
// shoulder widths. The thresholds are first guesses (DEFAULT_BOWL) until the
// task's ten recordings.
import { describe, expect, it } from "vitest";
import { BowlDetector, DEFAULT_BOWL, aimFromX, speedFrom, spinFromSweep } from "../client/input/camera/bowl-pose.ts";
import type { BowlHand, BowlRead, BowlThrow } from "../client/input/camera/bowl-pose.ts";
import { LM } from "../client/input/camera/pose.ts";
import type { Point } from "../client/input/camera/pose.ts";

const ASPECT = 16 / 9;
const FPS = 30;
/** Arm length, shoulder to wrist, in shoulder widths. */
const ARM = 1.7;
const deg = Math.PI / 180;

/** A wrist in shoulder widths: across (positive to the player's left), down (below the shoulder line), z (positive behind the hips). */
interface H {
  across: number;
  down: number;
  z: number;
}

/** The body: where it stands in the picture and how big it looks. */
interface Body {
  /** Shoulders' middle, picture x (0..1). */
  x: number;
  /** Shoulder line, picture y. */
  top: number;
  /** Shoulder width in picture heights (bigger is nearer the camera). */
  w: number;
  /** Hips below the shoulder line, shoulder widths (less in a crouch). */
  hipDown: number;
  hips: boolean;
}

const STAND: Body = { x: 0.5, top: 0.3, w: 0.15, hipDown: 1.3, hips: true };
const shoulderX = (hand: BowlHand) => (hand === "left" ? 0.5 : -0.5);
/** A hanging arm swung `a` degrees forward (towards the camera; negative is back), plus a sideways shift. */
const arm = (hand: BowlHand, a: number, shift = 0): H => ({ across: shoulderX(hand) + shift, down: ARM * Math.cos(a * deg), z: -ARM * Math.sin(a * deg) });
const HANG_L = arm("left", 0);
const HANG_R = arm("right", 0);

/** A player facing an unmirrored webcam (their left on picture right). */
function landmarks(left: H | null, right: H | null, b: Body): Point[] {
  const lm: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const at = (across: number, down: number, z = 0): Point => ({
    x: b.x + (across * b.w) / ASPECT,
    y: b.top + down * b.w,
    // MediaPipe's z is about x's scale, from the hips
    z: (z * b.w) / ASPECT,
    visibility: 1,
  });
  lm[LM.leftShoulder] = at(0.5, 0);
  lm[LM.rightShoulder] = at(-0.5, 0);
  if (left) lm[LM.leftWrist] = at(left.across, left.down, left.z);
  if (right) lm[LM.rightWrist] = at(right.across, right.down, right.z);
  if (b.hips) {
    lm[23] = at(0.35, b.hipDown);
    lm[24] = at(-0.35, b.hipDown);
  }
  return lm;
}

const ease = (k: number) => (1 - Math.cos(Math.PI * k)) / 2;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

interface State {
  left: H | null;
  right: H | null;
  body: Body;
}

class Player {
  t = 0;
  s: State = { left: HANG_L, right: HANG_R, body: STAND };
  reads: BowlRead[] = [];
  times: number[] = [];
  d: BowlDetector;
  constructor(d: BowlDetector) {
    this.d = d;
  }

  /** `ms` of frames; `f(k)` (k eased 0..1) changes what moves. `lost` sends no landmarks. */
  play(ms: number, f: (k: number, s: State) => Partial<State> = () => ({}), opts: { lost?: boolean; linear?: boolean } = {}): this {
    const frames = Math.max(1, Math.round((ms / 1000) * FPS));
    const start = { ...this.s };
    for (let i = 1; i <= frames; i++) {
      this.t += 1000 / FPS;
      const k = opts.linear ? i / frames : ease(i / frames);
      this.s = { ...this.s, ...f(k, start) };
      const lm = opts.lost ? null : landmarks(this.s.left, this.s.right, this.s.body);
      this.reads.push(this.d.update({ t: this.t, landmarks: lm, aspect: ASPECT }));
      this.times.push(this.t);
    }
    return this;
  }

  hold(ms: number): this {
    return this.play(ms);
  }

  get throws(): BowlThrow[] {
    return this.reads.flatMap((r) => (r.throw ? [r.throw] : []));
  }
  get last(): BowlRead {
    return this.reads[this.reads.length - 1];
  }
}

function onTurn(): Player {
  const d = new BowlDetector();
  d.setTurn(true);
  return new Player(d).hold(500);
}

interface SwingOpts {
  hand?: BowlHand;
  /** Forward swing time, top of the backswing to the follow-through. */
  fwdMs?: number;
  /** Sideways sweep (shoulder widths, positive to the player's left) over 20-60 degrees, around the release. */
  sweep?: number;
  /** A natural follow-through's drift towards the body's middle (shoulder widths, from the bottom to the top). */
  drift?: number;
  /** The body during the forward swing (a step and crouch). */
  body?: (k: number) => Body;
}

const BACK = -60;
const FRONT = 70;
const smooth = (a: number, lo: number, hi: number) => {
  const k = Math.min(1, Math.max(0, (a - lo) / (hi - lo)));
  return k * k * (3 - 2 * k);
};

/** An underarm bowl: back 60 degrees, pause, forward to 70 in front. */
function bowl(p: Player, o: SwingOpts = {}): Player {
  const hand = o.hand ?? "right";
  const fwd = o.fwdMs ?? 500;
  const toMiddle = hand === "left" ? -1 : 1;
  const set = (h: H): Partial<State> => (hand === "left" ? { left: h } : { right: h });
  p.play(400, (k) => set(arm(hand, BACK * k)));
  p.hold(100);
  p.play(fwd, (k, s0) => {
    const a = mix(BACK, FRONT, k);
    const shift = (o.sweep ?? 0) * smooth(a, 20, 60) + toMiddle * (o.drift ?? 0) * smooth(a, 0, FRONT);
    return { ...set(arm(hand, a, shift)), ...(o.body ? { body: o.body(k) } : { body: s0.body }) };
  });
  return p.hold(400);
}

describe("bowling camera: aim", () => {
  it("follows the hand across the picture, mirrored: moving to your right aims right", () => {
    const p = onTurn();
    expect(Math.abs(p.last.aim)).toBeLessThan(0.15);
    // the right hand moves to the player's right: picture left
    p.play(400, () => ({ right: { ...HANG_R, across: -1.5 } })).hold(400);
    const right = p.last.aim;
    expect(right).toBeGreaterThan(0.2);
    p.play(400, () => ({ right: { ...HANG_R, across: 0.8 } })).hold(400);
    expect(p.last.aim).toBeLessThan(right);
    expect(aimFromX(0.2)).toBe(1);
    expect(aimFromX(0.8)).toBe(-1);
    expect(aimFromX(0.5)).toBe(0);
  });

  it("walking moves it: the whole body to your left aims left", () => {
    const p = onTurn();
    const start = p.last.aim;
    // the player walks to their left: picture right
    p.play(1200, (k) => ({ body: { ...STAND, x: mix(0.5, 0.75, k) } })).hold(500);
    expect(p.last.aim).toBeLessThan(start - 0.5);
    expect(p.last.aim).toBeGreaterThanOrEqual(-1);
  });

  it("locks when the swing starts: a sweep at the release doesn't move it", () => {
    const p = onTurn();
    p.play(1000, (k, s0) => ({ body: { ...s0.body, x: mix(0.5, 0.4, k) } })).hold(500);
    const before = p.last.aim;
    expect(before).toBeGreaterThan(0.2);
    bowl(p, { sweep: -1.2 });
    expect(p.throws).toHaveLength(1);
    expect(p.throws[0].aim).toBeCloseTo(before, 1);
  });

  it("is frozen while swinging", () => {
    const p = onTurn();
    const before = p.last.aim;
    p.play(400, (k) => ({ right: arm("right", BACK * k, -0.6 * k) }));
    expect(p.last.swinging).toBe(true);
    expect(p.last.aim).toBeCloseTo(before, 1);
  });
});

describe("bowling camera: the throw", () => {
  it("a forward swing past the hip throws once, with the hips seen", () => {
    const p = bowl(onTurn());
    expect(p.throws).toHaveLength(1);
    const t = p.throws[0];
    expect(t.hand).toBe("right");
    expect(t.fallback).toBe(false);
    expect(t.raw).toBeGreaterThan(DEFAULT_BOWL.minSpeed);
    expect(p.last.state).toBe("thrown");
  });

  it("the backswing alone (rising past the hip behind you) doesn't throw", () => {
    const p = onTurn().play(400, (k) => ({ right: arm("right", BACK * k) })).hold(1000);
    expect(p.throws).toHaveLength(0);
    // and with no depth from the model, a rise straight from hanging still doesn't
    const q = onTurn();
    q.play(400, (k) => ({ right: { ...arm("right", BACK * k), z: 0 } })).hold(1000);
    expect(q.throws).toHaveLength(0);
  });

  it("no backswing: a forward swing from hanging still throws (the depth says forward)", () => {
    const p = onTurn().play(400, (k) => ({ right: arm("right", FRONT * k) })).hold(400);
    expect(p.throws).toHaveLength(1);
  });

  it("faster reads faster", () => {
    const speeds = [800, 500, 300].map((ms) => bowl(onTurn(), { fwdMs: ms }).throws[0]);
    for (const t of speeds) expect(t).toBeDefined();
    expect(speeds[0].speed).toBeLessThan(speeds[1].speed);
    expect(speeds[1].speed).toBeLessThan(speeds[2].speed);
    expect(speeds[0].speed).toBeGreaterThan(0);
  });

  it("left and right hands both throw", () => {
    const l = bowl(onTurn(), { hand: "left" });
    expect(l.throws).toHaveLength(1);
    expect(l.throws[0].hand).toBe("left");
    const r = bowl(onTurn(), { hand: "right" });
    expect(l.throws[0].raw).toBeCloseTo(r.throws[0].raw, 1);
  });

  it("a left hander's aim locks from the left hand", () => {
    const p = onTurn();
    // the left hand out to the player's left, the right hanging
    p.play(400, () => ({ left: { ...HANG_L, across: 1.5 } })).hold(500);
    const leftAim = aimFromX(STAND.x + (1.5 * STAND.w) / ASPECT);
    bowl(p, { hand: "left" });
    const t = p.throws[0];
    expect(t.hand).toBe("left");
    // the swing starts from where the hand was; a lefty swings from beside the body, the hand having come back
    expect(t.aim).toBeLessThan(0);
    expect(leftAim).toBeLessThan(0);
  });

  it("a step towards the camera and a crouch read about the same speed as standing", () => {
    const stand = bowl(onTurn()).throws[0];
    const step = bowl(onTurn(), {
      // nearer the camera (bigger), lower in the picture, the hips nearer the shoulders
      body: (k) => ({ ...STAND, w: mix(0.15, 0.21, k), top: mix(0.3, 0.38, k), hipDown: mix(1.3, 1.15, k) }),
    }).throws[0];
    expect(step).toBeDefined();
    expect(Math.abs(step.raw - stand.raw) / stand.raw).toBeLessThan(0.15);
  });

  it("speed maps 0..1 from the crossing speed", () => {
    expect(speedFrom(DEFAULT_BOWL.speed0)).toBe(0);
    expect(speedFrom(DEFAULT_BOWL.speed1)).toBe(1);
    expect(speedFrom(100)).toBe(1);
  });

  it("one throw a turn; a new turn allows another", () => {
    const p = bowl(bowl(onTurn()));
    expect(p.throws).toHaveLength(1);
    p.d.newTurn();
    bowl(p);
    expect(p.throws).toHaveLength(2);
  });

  it("off-turn nothing is thrown, and a swing begun off-turn doesn't count on the turn", () => {
    const d = new BowlDetector();
    d.setTurn(false);
    const p = bowl(new Player(d).hold(500));
    expect(p.throws).toHaveLength(0);
    expect(p.last.state).toBe("off-turn");
    // the turn arrives mid-backswing
    p.play(400, (k) => ({ right: arm("right", BACK * k) }));
    d.setTurn(true);
    p.play(500, (k) => ({ right: arm("right", mix(BACK, FRONT, k)) })).hold(300);
    expect(p.throws).toHaveLength(0);
    // the next swing does
    p.play(400, (k) => ({ right: arm("right", mix(FRONT, 0, k)) })).hold(400);
    bowl(p);
    expect(p.throws).toHaveLength(1);
  });

  it("a wrist lost mid-swing doesn't fire", () => {
    const p = onTurn();
    p.play(400, (k) => ({ right: arm("right", BACK * k) })).hold(100);
    // forward to the bottom, lost through the hip, back above it
    p.play(200, (k) => ({ right: arm("right", mix(BACK, 0, k)) }));
    p.play(100, () => ({ right: null }));
    p.play(100, () => ({ right: arm("right", 60) }));
    p.play(300, (k) => ({ right: arm("right", mix(60, FRONT, k)) })).hold(300);
    expect(p.throws).toHaveLength(0);
  });

  it("a wrist that reappears just below the hip and rises straight past it doesn't fire", () => {
    const p = onTurn();
    p.play(400, (k) => ({ right: arm("right", BACK * k) })).hold(100);
    p.play(200, (k) => ({ right: arm("right", mix(BACK, 0, k)) }));
    // lost through the bottom, seen again 25 degrees forward (still below the hip), then on up fast
    p.play(100, () => ({ right: null }));
    p.play(130, (k) => ({ right: arm("right", mix(25, FRONT, k)) }), { linear: true }).hold(300);
    const rise = p.reads.filter((r) => r.crossing && !r.crossing.behind).map((r) => r.crossing);
    // fast enough to be a throw had the wrist been seen through the bottom of the swing
    expect(rise[0]?.speed).toBeGreaterThan(DEFAULT_BOWL.minSpeed);
    expect(p.throws).toHaveLength(0);
  });

  it("the whole body lost mid-swing doesn't fire", () => {
    const p = onTurn();
    p.play(400, (k) => ({ right: arm("right", BACK * k) })).hold(100);
    p.play(200, (k) => ({ right: arm("right", mix(BACK, 0, k)) }));
    p.play(100, () => ({}), { lost: true });
    p.play(300, (k) => ({ right: arm("right", mix(30, FRONT, k)) })).hold(300);
    expect(p.throws).toHaveLength(0);
    expect(p.reads.some((r) => !r.tracking)).toBe(true);
  });
});

describe("bowling camera: the curve", () => {
  it("a straight swing with a natural follow-through reads no curve", () => {
    for (const hand of ["left", "right"] as const) {
      const t = bowl(onTurn(), { hand, drift: 0.2 }).throws[0];
      expect(t.spin).toBe(0);
    }
  });

  it("sweeping to your right curves right, to your left curves left", () => {
    // the player's right is negative across
    const right = bowl(onTurn(), { sweep: -0.8 }).throws[0];
    const left = bowl(onTurn(), { sweep: 0.8 }).throws[0];
    expect(right.spin).toBeGreaterThan(0.4);
    expect(left.spin).toBeLessThan(-0.4);
    const little = bowl(onTurn(), { sweep: -0.5 }).throws[0];
    expect(little.spin).toBeGreaterThan(0);
    expect(little.spin).toBeLessThan(right.spin);
  });

  it("sweeping after the window (steering the ball) adds nothing", () => {
    const p = bowl(onTurn());
    p.play(500, (_k, s0) => ({ right: { ...(s0.right as H), across: -2 } }));
    p.play(500, (_k, s0) => ({ right: { ...(s0.right as H), across: 1 } }));
    expect(p.throws).toHaveLength(1);
    expect(p.throws[0].spin).toBe(0);
  });

  it("the throw is sent when the window closes, at most 0.1 s after the release", () => {
    const p = bowl(onTurn());
    const i = p.reads.findIndex((r) => r.throw);
    const late = p.times[i] - p.throws[0].at;
    expect(late).toBeGreaterThanOrEqual(DEFAULT_BOWL.curveWindowMs / 2);
    expect(late).toBeLessThanOrEqual(100 + 1e-6);
    expect(spinFromSweep(0)).toBe(0);
    expect(spinFromSweep(-DEFAULT_BOWL.sweepFull)).toBe(1);
  });
});

describe("bowling camera: moving, no throw", () => {
  it("picking something up doesn't throw", () => {
    const p = onTurn();
    // bend: the shoulders drop towards the hips, the hand reaches the floor, back up, a second each way
    p.play(1000, (k) => ({ body: { ...STAND, top: mix(0.3, 0.45, k), hipDown: mix(1.3, 0.7, k) }, right: { ...HANG_R, down: mix(1.7, 2.2, k), z: mix(0, -0.6, k) } }));
    p.hold(300);
    p.play(1000, (k) => ({ body: { ...STAND, top: mix(0.45, 0.3, k), hipDown: mix(0.7, 1.3, k) }, right: { ...HANG_R, down: mix(2.2, 1.7, k), z: mix(-0.6, 0, k) } }));
    p.hold(500);
    expect(p.throws).toHaveLength(0);
  });

  it("stretching both arms up and out to the sides doesn't throw", () => {
    const p = onTurn();
    const up = (hand: BowlHand, k: number): H => {
      const a = 170 * k * deg;
      const side = hand === "left" ? 1 : -1;
      return { across: shoulderX(hand) + side * ARM * Math.sin(a), down: ARM * Math.cos(a), z: 0 };
    };
    for (let i = 0; i < 2; i++) {
      p.play(1000, (k) => ({ left: up("left", k), right: up("right", k) }));
      p.play(1000, (k) => ({ left: up("left", 1 - k), right: up("right", 1 - k) }));
    }
    expect(p.throws).toHaveLength(0);
  });

  it("walking sideways, arms swinging naturally, doesn't throw", () => {
    const p = onTurn();
    p.play(
      3000,
      (k) => {
        const a = 20 * Math.sin(k * 2 * Math.PI * 3);
        return { body: { ...STAND, x: mix(0.5, 0.2, k) }, left: arm("left", -a), right: arm("right", a) };
      },
      { linear: true },
    );
    expect(p.throws).toHaveLength(0);
  });
});

describe("bowling camera: the fallback without hips", () => {
  const SEATED: Body = { ...STAND, top: 0.5, w: 0.25, hips: false };
  const low = (a: number): H => arm("right", a);

  it("reports the fallback and throws on the rise past the chest", () => {
    const d = new BowlDetector();
    d.setTurn(true);
    const p = new Player(d);
    p.s = { left: null, right: { ...low(30), z: 0 }, body: SEATED };
    p.hold(500);
    expect(p.last.tracking).toBe(true);
    expect(p.last.hipsSeen).toBe(false);
    expect(p.last.fallback).toBe(true);
    // the hand swings forward and up from below the chest
    p.play(400, (k) => ({ right: { ...low(mix(30, 110, k)), z: 0 } })).hold(400);
    expect(p.throws).toHaveLength(1);
    expect(p.throws[0].fallback).toBe(true);
    // faster reads faster there too
    const q = new Player(new BowlDetector());
    q.d.setTurn(true);
    q.s = { left: null, right: { ...low(30), z: 0 }, body: SEATED };
    q.hold(500).play(250, (k) => ({ right: { ...low(mix(30, 110, k)), z: 0 } })).hold(400);
    expect(q.throws[0].raw).toBeGreaterThan(p.throws[0].raw);
  });

  it("with the hips in view it isn't the fallback", () => {
    const p = onTurn();
    expect(p.last.hipsSeen).toBe(true);
    expect(p.last.fallback).toBe(false);
    expect(p.last.line).toBeCloseTo(1.3, 1);
  });
});
