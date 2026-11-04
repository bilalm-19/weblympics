// A player's look (task 18): colours for shirt, shorts, skin and hair, and a
// hat or hairstyle, each picked from a fixed list. Shared, so the server
// validates against exactly the lists the client draws from. A look is stored
// as small enum values; anything outside the lists is rejected, never stored.

export const SHIRTS = {
  blue: 0x2f7fe0,
  red: 0xe0453a,
  green: 0x2fa84f,
  yellow: 0xf2c230,
  purple: 0x8a4fd8,
  orange: 0xf08a24,
  pink: 0xe85d9e,
  white: 0xf2f4f7,
  black: 0x2a2d34,
} as const;

export const SHORTS = {
  navy: 0x2b303b,
  black: 0x1d1f24,
  white: 0xeef1f5,
  khaki: 0xb59b6a,
  red: 0xb83a30,
  blue: 0x2c5fb3,
} as const;

export const SKINS = {
  s1: 0xf6dcc4,
  s2: 0xf3cfae,
  s3: 0xd9a77e,
  s4: 0xb57c55,
  s5: 0x8a5a3b,
  s6: 0x5e3a24,
} as const;

export const HAIRS = {
  black: 0x1d1b1a,
  brown: 0x4a2c1a,
  auburn: 0x8a3b1e,
  blonde: 0xe0be6a,
  grey: 0x9a9a9a,
  blue: 0x3d6fd8,
} as const;

/** Hats and hairstyles, drawn as a few primitives in character.ts. */
export const STYLES = ["short", "long", "bun", "bald", "cap", "visor", "headband"] as const;

export type Shirt = keyof typeof SHIRTS;
export type Shorts = keyof typeof SHORTS;
export type Skin = keyof typeof SKINS;
export type Hair = keyof typeof HAIRS;
export type Style = (typeof STYLES)[number];

export interface Look {
  shirt: Shirt;
  shorts: Shorts;
  skin: Skin;
  hair: Hair;
  style: Style;
}

/** Everyone's look until they pick one; guests always have it. Seat 1 gets a red top so the two seats differ. */
export const DEFAULT_LOOKS: readonly [Look, Look] = [
  { shirt: "blue", shorts: "navy", skin: "s2", hair: "brown", style: "short" },
  { shirt: "red", shorts: "navy", skin: "s2", hair: "black", style: "short" },
];

/** The labels the customise panel shows. */
export const LOOK_LABELS = {
  shirt: "Shirt",
  shorts: "Shorts",
  skin: "Skin",
  hair: "Hair",
  style: "Hat or hair",
} as const;

export const STYLE_LABELS: Record<Style, string> = {
  short: "Short hair",
  long: "Long hair",
  bun: "Bun",
  bald: "Bald",
  cap: "Cap",
  visor: "Visor",
  headband: "Headband",
};

const own = (o: object, k: unknown): boolean => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

/** The look if every field is one from its list and nothing else is there; otherwise null. */
export function parseLook(v: unknown): Look | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const keys = Object.keys(m);
  if (keys.length !== 5 || !keys.every((k) => k in LOOK_LABELS)) return null;
  if (!own(SHIRTS, m.shirt) || !own(SHORTS, m.shorts) || !own(SKINS, m.skin) || !own(HAIRS, m.hair)) return null;
  if (!(STYLES as readonly unknown[]).includes(m.style)) return null;
  return { shirt: m.shirt as Shirt, shorts: m.shorts as Shorts, skin: m.skin as Skin, hair: m.hair as Hair, style: m.style as Style };
}

export function sameLook(a: Look, b: Look): boolean {
  return a.shirt === b.shirt && a.shorts === b.shorts && a.skin === b.skin && a.hair === b.hair && a.style === b.style;
}
