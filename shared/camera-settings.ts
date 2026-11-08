// Every camera setting a player can change (task 25), in one closed shape.
// Shared, so the server checks exactly what the client saves: an account's
// settings are stored on the server and loaded on sign-in on any device; a
// guest's stay in the browser. `parseCameraSettings` is the only way in: an
// unknown field, a wrong type or a value outside its range refuses the whole
// thing, and nothing is stored.
//
// A section left out (an older client, or a game added later) takes its
// defaults; inside a section every field must be there.

export type Side = "left" | "right";

export interface TennisSettings {
  /** Racket hand. */
  hand: Side;
  /** "classic" (default): a quick swing plays a stroke; "follow": the character copies the arm. */
  mode: "classic" | "follow";
  /** "timing" (default): early or late steers the shot; "point": where the hand points. */
  aim: "timing" | "point";
  /** "auto" (default): the server walks you to the ball; "tilt": lean to move. */
  move: "auto" | "tilt";
  /** Lean neutral from the first second of tracking (true), or `neutralTilt`. */
  autoNeutral: boolean;
  neutralTilt: number;
  neutralAcross: number;
  /** Peak wrist speeds (shoulder widths a second) between light/medium and medium/hard, per stroke. */
  forehand: [number, number];
  backhand: [number, number];
}

/** Where each side rests, standing still (shoulder widths above the shoulder line). */
export interface RunRestSetting {
  left: number;
  right: number;
}

export interface CameraSettings {
  tennis: TennisSettings;
  archery: { bowHand: Side };
  track: { mode: "elbows" | "knees"; rest: { elbows: RunRestSetting | null; knees: RunRestSetting | null } };
  /** The player's own push speeds giving power 0 and power 1, or null for the defaults (task 25 round 3). */
  basketball: { power: [number, number] | null };
  /** The player's own roll speeds giving speed 0 and speed 1, or null for the defaults (task 25 round 3). */
  bowling: { speed: [number, number] | null };
}

/** The swing thresholds tennis starts with (`DEFAULT_SWING` in client/input/camera/pose.ts). */
export const DEFAULT_THRESHOLDS: [number, number] = [5, 9];

/** A fresh profile: classic swing, aim by timing, auto-move (user's choice after playtesting). */
export function defaultCameraSettings(): CameraSettings {
  return {
    tennis: {
      hand: "right",
      mode: "classic",
      aim: "timing",
      move: "auto",
      autoNeutral: true,
      neutralTilt: 0,
      neutralAcross: -0.5,
      forehand: [...DEFAULT_THRESHOLDS],
      backhand: [...DEFAULT_THRESHOLDS],
    },
    archery: { bowHand: "left" },
    track: { mode: "elbows", rest: { elbows: null, knees: null } },
    basketball: { power: null },
    bowling: { speed: null },
  };
}

// The ranges a value may take. Wide enough for any real player, narrow
// enough that a stored value can't break a game.
export const LIMITS = {
  /** swing thresholds, shoulder widths a second */
  swing: [1, 40],
  /** degrees */
  tilt: [-30, 30],
  /** shoulder widths */
  across: [-3, 3],
  /** run rest heights, shoulder widths */
  rest: [-8, 3],
  /** basketball push and bowling roll speeds giving power 0 and 1, shoulder widths a second */
  power: [0, 40],
} as const satisfies Record<string, readonly [number, number]>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
/** Exactly these keys, no more and no fewer. */
const exactly = (o: Obj, keys: readonly string[]): boolean => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.hasOwn(o, x));
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
// stored to a thousandth: plenty for a speed or a tilt, and a tidy row
const tidy = (v: number): number => Math.round(v * 1000) / 1000;

/** Two increasing values in range, the second at least `gap` above the first. */
function pair(v: unknown, limits: readonly [number, number], gap: number): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2 || !inRange(v[0], limits) || !inRange(v[1], limits)) return null;
  if (!(v[1] - v[0] >= gap)) return null;
  return [tidy(v[0]), tidy(v[1])];
}

function rest(v: unknown): RunRestSetting | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !exactly(v, ["left", "right"]) || !inRange(v.left, LIMITS.rest) || !inRange(v.right, LIMITS.rest)) return undefined;
  return { left: tidy(v.left), right: tidy(v.right) };
}

const SIDES = ["left", "right"] as const;

function tennis(v: unknown): TennisSettings | null {
  const keys = ["hand", "mode", "aim", "move", "autoNeutral", "neutralTilt", "neutralAcross", "forehand", "backhand"] as const;
  if (!isObj(v) || !exactly(v, keys)) return null;
  if (!oneOf(v.hand, SIDES) || !oneOf(v.mode, ["classic", "follow"] as const) || !oneOf(v.aim, ["timing", "point"] as const)) return null;
  if (!oneOf(v.move, ["auto", "tilt"] as const) || typeof v.autoNeutral !== "boolean") return null;
  if (!inRange(v.neutralTilt, LIMITS.tilt) || !inRange(v.neutralAcross, LIMITS.across)) return null;
  const forehand = pair(v.forehand, LIMITS.swing, 0.1);
  const backhand = pair(v.backhand, LIMITS.swing, 0.1);
  if (!forehand || !backhand) return null;
  return {
    hand: v.hand,
    mode: v.mode,
    aim: v.aim,
    move: v.move,
    autoNeutral: v.autoNeutral,
    neutralTilt: tidy(v.neutralTilt),
    neutralAcross: tidy(v.neutralAcross),
    forehand,
    backhand,
  };
}

const SECTIONS = ["tennis", "archery", "track", "basketball", "bowling"] as const;

/** The settings if every field is known and in range; otherwise null. Sections left out take their defaults. */
export function parseCameraSettings(v: unknown): CameraSettings | null {
  if (!isObj(v)) return null;
  if (!Object.keys(v).every((k) => oneOf(k, SECTIONS))) return null;
  const out = defaultCameraSettings();
  if (Object.hasOwn(v, "tennis")) {
    const t = tennis(v.tennis);
    if (!t) return null;
    out.tennis = t;
  }
  if (Object.hasOwn(v, "archery")) {
    const a = v.archery;
    if (!isObj(a) || !exactly(a, ["bowHand"]) || !oneOf(a.bowHand, SIDES)) return null;
    out.archery = { bowHand: a.bowHand };
  }
  if (Object.hasOwn(v, "track")) {
    const t = v.track;
    if (!isObj(t) || !exactly(t, ["mode", "rest"]) || !oneOf(t.mode, ["elbows", "knees"] as const)) return null;
    const r = t.rest;
    if (!isObj(r) || !exactly(r, ["elbows", "knees"])) return null;
    const elbows = rest(r.elbows);
    const knees = rest(r.knees);
    if (elbows === undefined || knees === undefined) return null;
    out.track = { mode: t.mode, rest: { elbows, knees } };
  }
  if (Object.hasOwn(v, "basketball")) {
    const b = v.basketball;
    if (!isObj(b) || !exactly(b, ["power"])) return null;
    if (b.power === null) out.basketball = { power: null };
    else {
      const p = pair(b.power, LIMITS.power, 1);
      if (!p) return null;
      out.basketball = { power: p };
    }
  }
  if (Object.hasOwn(v, "bowling")) {
    const b = v.bowling;
    if (!isObj(b) || !exactly(b, ["speed"])) return null;
    if (b.speed === null) out.bowling = { speed: null };
    else {
      const p = pair(b.speed, LIMITS.power, 1);
      if (!p) return null;
      out.bowling = { speed: p };
    }
  }
  return out;
}
