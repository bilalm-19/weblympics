// A player's look (task 18, widened by task 33): clothes, colours, hair, face
// and extras, each picked from a fixed list. Shared, so the server validates
// against exactly the lists the client draws from. A look is stored as small
// enum values; anything outside the lists, any extra field or any missing
// field is rejected, never stored.

export const TOP_COLOURS = {
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

export const BOTTOM_COLOURS = {
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

export const HAIR_COLOURS = {
  black: 0x1d1b1a,
  brown: 0x4a2c1a,
  auburn: 0x8a3b1e,
  blonde: 0xe0be6a,
  grey: 0x9a9a9a,
  blue: 0x3d6fd8,
} as const;

/** Task 18's names for the palettes, kept for older imports. */
export const SHIRTS = TOP_COLOURS;
export const SHORTS = BOTTOM_COLOURS;
export const HAIRS = HAIR_COLOURS;

/** A dress is a top that hides the bottom (it is drawn down to the knee instead). */
export const TOPS = ["tee", "polo", "hoodie", "jersey", "tank", "suit", "dress"] as const;
export const BOTTOMS = ["shorts", "trousers", "skirt"] as const;
export const HAIR_STYLES = ["short", "buzz", "fringe", "bob", "curly", "long", "ponytail", "bun", "afro", "spiky", "bald"] as const;
export const HEADWEAR = ["none", "cap", "visor", "headband", "beanie"] as const;
export const EYES = ["round", "almond", "sleepy", "wide"] as const;
export const BROWS = ["straight", "arched", "thick", "angled"] as const;
export const NOSES = ["button", "small", "long", "wide"] as const;
export const MOUTHS = ["smile", "grin", "neutral", "open"] as const;
export const FACIAL_HAIR = ["none", "stubble", "moustache", "goatee", "beard"] as const;
export const EYEWEAR = ["none", "round", "square", "sunglasses", "goggles"] as const;

export type TopColour = keyof typeof TOP_COLOURS;
export type BottomColour = keyof typeof BOTTOM_COLOURS;
export type Skin = keyof typeof SKINS;
export type HairColour = keyof typeof HAIR_COLOURS;
export type Top = (typeof TOPS)[number];
export type Bottom = (typeof BOTTOMS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Headwear = (typeof HEADWEAR)[number];
export type Eyes = (typeof EYES)[number];
export type Brows = (typeof BROWS)[number];
export type Nose = (typeof NOSES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type Eyewear = (typeof EYEWEAR)[number];

export interface Look {
  top: Top;
  topColour: TopColour;
  bottom: Bottom;
  bottomColour: BottomColour;
  skin: Skin;
  hairColour: HairColour;
  hairStyle: HairStyle;
  headwear: Headwear;
  eyes: Eyes;
  brows: Brows;
  nose: Nose;
  mouth: Mouth;
  facialHair: FacialHair;
  eyewear: Eyewear;
}

const keys = <T extends object>(o: T) => Object.keys(o) as Array<keyof T & string>;

/** Every field and its fixed list, in a fixed order (the order of lookKey). */
export const LOOK_OPTIONS: { readonly [K in keyof Look]: readonly Look[K][] } = {
  top: TOPS,
  topColour: keys(TOP_COLOURS),
  bottom: BOTTOMS,
  bottomColour: keys(BOTTOM_COLOURS),
  skin: keys(SKINS),
  hairColour: keys(HAIR_COLOURS),
  hairStyle: HAIR_STYLES,
  headwear: HEADWEAR,
  eyes: EYES,
  brows: BROWS,
  nose: NOSES,
  mouth: MOUTHS,
  facialHair: FACIAL_HAIR,
  eyewear: EYEWEAR,
};

export const LOOK_FIELDS = Object.keys(LOOK_OPTIONS) as Array<keyof Look>;

const BASE: Look = {
  top: "tee",
  topColour: "blue",
  bottom: "shorts",
  bottomColour: "navy",
  skin: "s2",
  hairColour: "brown",
  hairStyle: "short",
  headwear: "none",
  eyes: "round",
  brows: "straight",
  nose: "small",
  mouth: "smile",
  facialHair: "none",
  eyewear: "none",
};

/** Everyone's look until they pick one; guests always have it. Seat 1 gets a red top and black hair so the two seats differ. */
export const DEFAULT_LOOKS: readonly [Look, Look] = [BASE, { ...BASE, topColour: "red", hairColour: "black" }];

/** The editor's name for each field. */
export const LOOK_LABELS: Record<keyof Look, string> = {
  top: "Top",
  topColour: "Top colour",
  bottom: "Bottom",
  bottomColour: "Bottom colour",
  skin: "Skin",
  hairColour: "Hair colour",
  hairStyle: "Hair",
  headwear: "Headwear",
  eyes: "Eyes",
  brows: "Brows",
  nose: "Nose",
  mouth: "Mouth",
  facialHair: "Facial hair",
  eyewear: "Eyewear",
};

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Each option's spoken and shown name ("Purple top", "Skin tone 3", "Round glasses"). */
export function optionLabel<K extends keyof Look>(field: K, value: Look[K]): string {
  const v = String(value);
  switch (field) {
    case "topColour":
      return `${title(v)} top`;
    case "bottomColour":
      return `${title(v)} bottom`;
    case "hairColour":
      return `${title(v)} hair`;
    case "skin":
      return `Skin tone ${v.slice(1)}`;
    case "top":
      return ({ tee: "T-shirt", polo: "Polo", hoodie: "Hoodie", jersey: "Jersey", tank: "Tank top", suit: "Suit jacket", dress: "Dress" } as Record<string, string>)[v];
    case "hairStyle":
      return v === "short" ? "Short hair" : v === "long" ? "Long hair" : v === "buzz" ? "Buzz cut" : title(v);
    case "headwear":
      return v === "none" ? "No hat" : title(v);
    case "eyes":
      return `${title(v)} eyes`;
    case "brows":
      return `${title(v)} brows`;
    case "nose":
      return `${title(v)} nose`;
    case "facialHair":
      return v === "none" ? "Clean shaven" : title(v);
    case "eyewear":
      return v === "none" ? "No glasses" : v === "round" ? "Round glasses" : v === "square" ? "Square glasses" : title(v);
    default:
      return title(v);
  }
}

/** The look as one string, every field in LOOK_FIELDS order: what the e2e reads off a drawing. */
export function lookKey(l: Look): string {
  return LOOK_FIELDS.map((f) => l[f]).join("/");
}

/** The look if every field is one from its list and nothing else is there; otherwise null. */
export function parseLook(v: unknown): Look | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const given = Object.keys(m);
  if (given.length !== LOOK_FIELDS.length || !given.every((k) => (LOOK_FIELDS as string[]).includes(k))) return null;
  const out: Record<string, unknown> = {};
  for (const f of LOOK_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(m, f)) return null;
    const value = m[f];
    if (typeof value !== "string" || !(LOOK_OPTIONS[f] as readonly string[]).includes(value)) return null;
    out[f] = value;
  }
  return out as unknown as Look;
}

export function sameLook(a: Look, b: Look): boolean {
  return LOOK_FIELDS.every((f) => a[f] === b[f]);
}

/** A task-18 look, as stored before schema version 7 and as older callers of makePlayer still build. */
export interface LegacyLook {
  shirt: TopColour;
  shorts: BottomColour;
  skin: Skin;
  hair: HairColour;
  style: string;
}

/** A look in task 33's shape, whichever shape it came in. */
export function toLook(l: Look | LegacyLook): Look {
  return "shirt" in l ? fromTask18(l) : l;
}

/**
 * Task 18's look ({shirt, shorts, skin, hair, style}) in task 33's shape: the
 * same colours on a T-shirt and shorts, the style as a hairstyle or (for a
 * hat) a hat over short hair, and the default face. Server/schema.ts step 7
 * does the same in SQL for stored looks; spec/look.test.ts holds the two to
 * each other.
 */
export function fromTask18(old: LegacyLook): Look {
  const hat = old.style === "cap" || old.style === "visor" || old.style === "headband";
  const hair: HairStyle = old.style === "long" || old.style === "bun" || old.style === "bald" ? old.style : "short";
  return {
    ...BASE,
    topColour: old.shirt,
    bottomColour: old.shorts,
    skin: old.skin,
    hairColour: old.hair,
    hairStyle: hair,
    headwear: hat ? (old.style as Headwear) : "none",
  };
}
