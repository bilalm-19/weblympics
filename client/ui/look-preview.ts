// A flat SVG figure of a look (tasks 18 and 33), for the profile button, its
// panel and the editor's live preview and picture swatches. The home screen
// never loads Three.js, so this draws the same choices from shared/look.ts as
// the 3D character (client/games/tennis/character.ts) does, with the same
// rules: a dress hides the bottom, tall hair is short under a cap or beanie,
// a hat takes the top's colour.
import { BOTTOM_COLOURS, HAIR_COLOURS, SKINS, TOP_COLOURS, lookKey } from "../../shared/look.ts";
import type { HairStyle, Look } from "../../shared/look.ts";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
function shade(n: number, k: number): string {
  const ch = (s: number) => {
    const c = (n >> s) & 0xff;
    return Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1)) & 0xff;
  };
  return hex((ch(16) << 16) | (ch(8) << 8) | ch(0));
}

const INK = "#2a1d14";
const LIP = "#8a3a2c";
const TALL_HAIR: readonly HairStyle[] = ["bun", "afro", "spiky", "curly"];

/** Head centre (50, 32), radius 20; eyes at 50 +- 7, y 32. */
function face(l: Look): string {
  const skin = SKINS[l.skin];
  const hair = hex(HAIR_COLOURS[l.hairColour]);
  const out: string[] = [];
  // facial hair under the mouth
  const jaw = `M30 32 Q30 54 50 55 Q70 54 70 32 L65 35 Q64 44 57 43 H43 Q36 44 35 35 Z`;
  const moustache = (w: number, h: number) => `<path d="M${50 - w} 42 Q${50 - w / 2} ${39 - h / 2} 50 39.5 Q${50 + w / 2} ${39 - h / 2} ${50 + w} 42 Q50 ${40.5 + h / 3} ${50 - w} 42 Z" fill="${hair}"/>`;
  switch (l.facialHair) {
    case "stubble":
      out.push(`<path d="M31.5 37 Q33 51 50 51.5 Q67 51 68.5 37 L64 39 Q63 46 56 46 H44 Q37 46 36 39 Z" fill="${hair}" opacity="0.3"/><ellipse cx="50" cy="41" rx="6.5" ry="1.8" fill="${hair}" opacity="0.3"/>`);
      break;
    case "moustache":
      out.push(moustache(8, 4));
      break;
    case "goatee":
      out.push(moustache(6, 2.5), `<ellipse cx="50" cy="49" rx="4.5" ry="4.5" fill="${hair}"/>`);
      break;
    case "beard":
      out.push(`<path d="${jaw}" fill="${hair}"/>`, moustache(8.5, 4));
      break;
  }
  // eyes
  for (const x of [43, 57]) {
    switch (l.eyes) {
      case "round":
        out.push(`<ellipse cx="${x}" cy="32" rx="2.3" ry="2.8" fill="${INK}"/>`);
        break;
      case "almond":
        out.push(`<path d="M${x - 3.6} 32 Q${x} 28.4 ${x + 3.6} 32 Q${x} 34.8 ${x - 3.6} 32 Z" fill="${INK}"/>`);
        break;
      case "sleepy":
        out.push(`<path d="M${x - 3} 32 A3 2 0 0 0 ${x + 3} 32 Z" fill="${INK}"/><line x1="${x - 3.4}" y1="32" x2="${x + 3.4}" y2="32" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`);
        break;
      case "wide":
        out.push(`<ellipse cx="${x}" cy="32" rx="3.6" ry="3.9" fill="#fff" stroke="${INK}" stroke-width="0.8"/><circle cx="${x}" cy="32.5" r="2" fill="${INK}"/>`);
        break;
    }
    if (l.eyes !== "sleepy") out.push(`<circle cx="${x + 0.8}" cy="31" r="0.6" fill="#fff" opacity="0.8"/>`);
  }
  // brows
  const browInk = shade(l.hairColour === "blonde" || l.hairColour === "grey" ? 0x6b4a2e : HAIR_COLOURS[l.hairColour], 0.8);
  for (const s of [-1, 1]) {
    const x = 50 + s * 7;
    const d =
      l.brows === "arched"
        ? `M${x - 3.6} 27.2 Q${x} 23.6 ${x + 3.6} 27.2`
        : l.brows === "angled"
          ? `M${x - s * 3.4} 27.6 L${x + s * 3.4} 24.8`
          : `M${x - 3.4} 26.2 L${x + 3.4} 26.2`;
    out.push(`<path d="${d}" stroke="${browInk}" stroke-width="${l.brows === "thick" ? 2.6 : 1.5}" fill="none" stroke-linecap="round"/>`);
  }
  // nose
  const noseInk = shade(skin, 0.78);
  const nose = {
    button: `<ellipse cx="50" cy="37" rx="2" ry="1.6" fill="${noseInk}"/>`,
    small: `<path d="M50 34 L49 37.5" stroke="${noseInk}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
    long: `<path d="M50.3 31.5 L48.6 38 L50.8 38.5" stroke="${noseInk}" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    wide: `<path d="M46.6 37 Q50 40 53.4 37" stroke="${noseInk}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  }[l.nose];
  out.push(nose);
  // mouth
  const mouth = {
    smile: `<path d="M45.5 42 Q50 46.5 54.5 42" stroke="${LIP}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    grin: `<path d="M44.5 42.5 Q50 50 55.5 42.5 Z" fill="#fff" stroke="${LIP}" stroke-width="1.3" stroke-linejoin="round"/>`,
    neutral: `<path d="M46 44 H54" stroke="${LIP}" stroke-width="1.6" stroke-linecap="round"/>`,
    open: `<ellipse cx="50" cy="44.5" rx="3.1" ry="2.8" fill="#5a1d16"/><ellipse cx="50" cy="46.2" rx="1.9" ry="1" fill="#d9605a"/>`,
  }[l.mouth];
  out.push(mouth);
  return out.join("");
}

/** Hair behind the head (drawn first) and over it. */
function hair(style: HairStyle, colour: string): { back: string; front: string } {
  const top = `<path d="M30 34 Q30 12 50 12 Q70 12 70 34 Q62 24 50 24 Q38 24 30 34 Z" fill="${colour}"/>`;
  const fringe = `<path d="M31 30 Q34 17 50 17 Q66 17 69 30 Q62 26 57 29 Q53 25 49 29 Q45 25 41 29 Q36 26 31 30 Z" fill="${colour}"/>`;
  switch (style) {
    case "short":
      return { back: "", front: top };
    case "buzz":
      return { back: "", front: `<path d="M31 30 Q31 13 50 13 Q69 13 69 30 Q61 21 50 21 Q39 21 31 30 Z" fill="${colour}" opacity="0.85"/>` };
    case "fringe":
      return { back: "", front: top + fringe };
    case "bob":
      return {
        back: `<path d="M27 32 Q27 9 50 9 Q73 9 73 32 V50 Q68 53 64 49 V32 H36 V49 Q32 53 27 50 Z" fill="${colour}"/>`,
        front: `<path d="M29 33 Q29 10 50 10 Q71 10 71 33 L69 26 H31 Z" fill="${colour}"/>`,
      };
    case "curly": {
      const curls = [
        [32, 26],
        [36, 18],
        [43, 13],
        [50, 11],
        [57, 13],
        [64, 18],
        [68, 26],
        [40, 20],
        [50, 18],
        [60, 20],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${colour}"/>`)
        .join("");
      return { back: `<circle cx="29" cy="34" r="5" fill="${colour}"/><circle cx="71" cy="34" r="5" fill="${colour}"/>`, front: curls };
    }
    case "long":
      return {
        back: `<path d="M28 30 Q28 10 50 10 Q72 10 72 30 L74 62 Q50 66 26 62 Z" fill="${colour}"/>`,
        front: `<path d="M28 34 Q28 10 50 10 Q72 10 72 34 L74 60 Q66 56 66 40 Q58 24 50 24 Q42 24 34 40 Q34 56 26 60 Z" fill="${colour}"/>`,
      };
    case "ponytail":
      return {
        back: `<path d="M64 22 Q82 22 80 50 Q78 58 74 52 Q76 34 64 30 Z" fill="${colour}"/>`,
        front: top,
      };
    case "bun":
      return { back: "", front: `${top}<circle cx="50" cy="9" r="7" fill="${colour}"/>` };
    case "afro":
      return { back: `<circle cx="50" cy="27" r="27" fill="${colour}"/>`, front: `<path d="M31 30 Q31 16 50 16 Q69 16 69 30 Q60 23 50 23 Q40 23 31 30 Z" fill="${colour}"/>` };
    case "spiky":
      return { back: "", front: `<path d="M30 32 L27 18 L36 21 L37 8 L45 16 L50 4 L55 16 L63 8 L64 21 L73 18 L70 32 Q62 23 50 23 Q38 23 30 32 Z" fill="${colour}"/>` };
    case "bald":
      return { back: "", front: "" };
  }
}

function headwear(l: Look, colour: string): string {
  const wide = l.hairStyle === "afro" ? 8 : l.hairStyle === "curly" ? 4 : 0;
  const band = (y: number, h: number) => `<rect x="${30 - wide}" y="${y}" width="${40 + 2 * wide}" height="${h}" rx="2" fill="${colour}"/>`;
  switch (l.headwear) {
    case "cap":
      return `<path d="M29 30 Q29 11 50 11 Q71 11 71 30 Z" fill="${colour}"/><path d="M44 28 H82 Q80 33 70 33 H44 Z" fill="${colour}"/>`;
    case "visor":
      return `${band(22, 5)}<path d="M48 25 H80 Q78 30 70 30 H48 Z" fill="${colour}"/>`;
    case "headband":
      return band(21, 5);
    case "beanie":
      return `<path d="M29 29 Q29 6 50 6 Q71 6 71 29 Z" fill="${colour}"/><rect x="28" y="24" width="44" height="7" rx="3" fill="${shade(TOP_COLOURS[l.topColour], 0.8)}"/><circle cx="50" cy="5" r="4.5" fill="${colour}"/>`;
    case "none":
      return "";
  }
}

function eyewear(l: Look): string {
  const frame = "#1d1f24";
  switch (l.eyewear) {
    case "round":
      return `<g fill="none" stroke="${frame}" stroke-width="1.3"><circle cx="43" cy="32" r="5"/><circle cx="57" cy="32" r="5"/><path d="M48 31.5 H52 M38 32 L30.5 30.5 M62 32 L69.5 30.5"/></g>`;
    case "square":
      return `<g fill="none" stroke="${frame}" stroke-width="1.4" stroke-linejoin="round"><rect x="37.5" y="28" width="11" height="8.5" rx="1"/><rect x="51.5" y="28" width="11" height="8.5" rx="1"/><path d="M48.5 31 H51.5 M37.5 31 L30.5 30 M62.5 31 L69.5 30"/></g>`;
    case "sunglasses":
      return `<g fill="${frame}"><path d="M37 29 H49 V32 Q49 37 43 37 Q37 37 37 32 Z"/><path d="M51 29 H63 V32 Q63 37 57 37 Q51 37 51 32 Z"/></g><path d="M48 30 H52 M37 30 L30.5 29.5 M63 30 L69.5 29.5" stroke="${frame}" stroke-width="1.4"/>`;
    case "goggles":
      return `<rect x="29.5" y="29.5" width="41" height="5" fill="${frame}"/><g stroke="${frame}" stroke-width="1.6" fill="#8fd6ff" fill-opacity="0.75"><circle cx="43" cy="32" r="5"/><circle cx="57" cy="32" r="5"/></g>`;
    case "none":
      return "";
  }
}

/** The body: legs, bottom, arms and top, from the shoulders down. */
function body(l: Look): string {
  const top = TOP_COLOURS[l.topColour];
  const t = hex(top);
  const dark = shade(top, 0.8);
  const trim = l.topColour === "white" || l.topColour === "yellow" ? "#2b303b" : "#f7f8fa";
  const b = hex(BOTTOM_COLOURS[l.bottomColour]);
  const skin = hex(SKINS[l.skin]);
  const dress = l.top === "dress";
  const out: string[] = [];
  // legs: trousers to the shoes, otherwise bare
  const legColour = !dress && l.bottom === "trousers" ? b : skin;
  out.push(`<rect x="39" y="96" width="9" height="34" rx="4" fill="${legColour}"/><rect x="52" y="96" width="9" height="34" rx="4" fill="${legColour}"/>`);
  out.push(`<rect x="38" y="127" width="11" height="5" rx="2.5" fill="#4b5160"/><rect x="51" y="127" width="11" height="5" rx="2.5" fill="#4b5160"/>`);
  if (dress) out.push(`<path d="M36 90 H64 L70 116 Q50 120 30 116 Z" fill="${t}"/>`);
  else if (l.bottom === "shorts") out.push(`<path d="M36 92 H64 L63 112 H51 L50 104 L49 112 H37 Z" fill="${b}"/>`);
  else if (l.bottom === "trousers") out.push(`<rect x="37" y="92" width="26" height="14" rx="5" fill="${b}"/>`);
  else out.push(`<path d="M37 92 H63 L68 112 Q50 115 32 112 Z" fill="${b}"/>`);
  // arms: sleeve, then forearm (bare unless long sleeves)
  const sleeves = l.top === "tank" ? "none" : l.top === "hoodie" || l.top === "suit" ? "long" : "short";
  const upper = sleeves === "none" ? skin : t;
  const fore = sleeves === "long" ? t : skin;
  for (const x of [23, 69]) out.push(`<rect x="${x}" y="56" width="8" height="34" rx="4" fill="${fore}"/><rect x="${x}" y="56" width="8" height="15" rx="4" fill="${upper}"/>`);
  out.push(`<circle cx="27" cy="92" r="4.5" fill="${skin}"/><circle cx="73" cy="92" r="4.5" fill="${skin}"/>`);
  // the top
  if (l.top === "tank") {
    out.push(`<path d="M32 54 Q50 52 68 54 L64 96 H36 Z" fill="${skin}"/><path d="M36 60 Q50 66 64 60 L64 96 H36 Z" fill="${t}"/><rect x="36" y="52" width="5" height="10" fill="${t}"/><rect x="59" y="52" width="5" height="10" fill="${t}"/>`);
  } else {
    if (l.top === "hoodie") out.push(`<ellipse cx="50" cy="54" rx="14" ry="6" fill="${dark}"/>`);
    out.push(`<path d="M32 54 Q50 48 68 54 L64 96 H36 Z" fill="${t}"/>`);
  }
  switch (l.top) {
    case "polo":
      out.push(`<path d="M43 51 L50 58 L57 51 L54 50 L50 54 L46 50 Z" fill="${trim}"/><rect x="49" y="56" width="2" height="9" fill="${trim}"/>`);
      break;
    case "jersey":
      out.push(`<rect x="34.5" y="68" width="31" height="3.5" fill="${trim}"/><rect x="35" y="76" width="30" height="3.5" fill="${trim}"/><path d="M44 51 Q50 56 56 51" stroke="${trim}" stroke-width="2.2" fill="none"/>`);
      break;
    case "hoodie":
      out.push(`<rect x="40" y="80" width="20" height="9" rx="3" fill="${dark}"/><path d="M47 54 V64 M53 54 V64" stroke="${trim}" stroke-width="1.2" stroke-linecap="round"/>`);
      break;
    case "suit":
      out.push(`<path d="M44 52 L50 72 L56 52 Z" fill="#f7f8fa"/><path d="M49 56 H51 L52 70 L50 73 L48 70 Z" fill="${l.topColour === "red" ? "#2b303b" : "#c0392b"}"/><path d="M42 52 L47 66 L44 60 Z M58 52 L53 66 L56 60 Z" fill="${dark}" stroke="${dark}" stroke-width="2" stroke-linejoin="round"/>`);
      break;
    case "dress":
      out.push(`<rect x="36" y="88" width="28" height="3" fill="${trim}"/>`);
      break;
  }
  return out.join("");
}

/** The head: hair behind, neck, head, face, hair over it, hat, glasses. */
function head(l: Look): string {
  const covered = (l.headwear === "cap" || l.headwear === "beanie") && TALL_HAIR.includes(l.hairStyle);
  const h = hair(covered ? "short" : l.hairStyle, hex(HAIR_COLOURS[l.hairColour]));
  const skin = hex(SKINS[l.skin]);
  return `${h.back}<rect x="45" y="46" width="10" height="8" fill="${skin}"/><circle cx="50" cy="32" r="20" fill="${skin}"/>${face(l)}${h.front}${headwear(l, hex(TOP_COLOURS[l.topColour]))}${eyewear(l)}`;
}

/**
 * The SVG of a look. `crop`: "full" the whole figure; "head" only the head
 * and shoulders (the home screen's round profile button, face and hair
 * swatches); "top" the upper body (clothes swatches); "legs" from the waist
 * down (bottom swatches). `label: null` makes the drawing decorative
 * (aria-hidden), when what is around it already says what it is.
 */
export function lookSvg(look: Look, label: string | null, crop: "full" | "head" | "top" | "legs" = "full"): string {
  const box = { full: "0 0 100 140", head: "15 0 70 70", top: "20 47 60 60", legs: "22 84 56 52" }[crop];
  const a11y = label === null ? `aria-hidden="true" focusable="false"` : `role="img" aria-label="${label}"`;
  const cls = crop === "full" ? "look-svg" : `look-svg look-svg--${crop}`;
  return `<svg class="${cls}" viewBox="${box}" ${a11y} data-look="${lookKey(look)}">${crop === "full" ? `<ellipse cx="50" cy="134" rx="22" ry="4" fill="#0002"/>` : ""}${body(look)}${head(look)}</svg>`;
}
