// A flat SVG figure of a look (task 18), for the customise panel's live
// preview. The home screen never loads Three.js, so this draws the same
// colours and hat or hair from shared/look.ts as the 3D character does.
import { HAIRS, SHIRTS, SHORTS, SKINS } from "../../shared/look.ts";
import type { Look } from "../../shared/look.ts";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * `crop: "head"` frames only the head and shoulders, for the home screen's
 * round profile button. `label: null` makes the drawing decorative
 * (aria-hidden), when the button around it already says who it is.
 */
export function lookSvg(look: Look, label: string | null, crop: "full" | "head" = "full"): string {
  const shirt = hex(SHIRTS[look.shirt]);
  const shorts = hex(SHORTS[look.shorts]);
  const skin = hex(SKINS[look.skin]);
  const hair = hex(HAIRS[look.hair]);
  const hairTop = `<path d="M30 34 Q30 12 50 12 Q70 12 70 34 Q62 24 50 24 Q38 24 30 34 Z" fill="${hair}"/>`;
  const parts: Record<Look["style"], string> = {
    short: hairTop,
    long: `<path d="M28 34 Q28 10 50 10 Q72 10 72 34 L74 60 Q66 56 66 40 Q58 24 50 24 Q42 24 34 40 Q34 56 26 60 Z" fill="${hair}"/>`,
    bun: `${hairTop}<circle cx="50" cy="9" r="7" fill="${hair}"/>`,
    bald: "",
    cap: `<path d="M29 30 Q29 11 50 11 Q71 11 71 30 Z" fill="${shirt}"/><path d="M44 28 H82 Q80 33 70 33 H44 Z" fill="${shirt}"/>`,
    visor: `${hairTop}<rect x="30" y="22" width="40" height="5" rx="2" fill="${shirt}"/><path d="M48 25 H80 Q78 30 70 30 H48 Z" fill="${shirt}"/>`,
    headband: `${hairTop}<rect x="30" y="22" width="40" height="5" rx="2" fill="${shirt}"/>`,
  };
  const head = crop === "head";
  const a11y = label === null ? `aria-hidden="true" focusable="false"` : `role="img" aria-label="${label}"`;
  return `<svg class="look-svg${head ? " look-svg--head" : ""}" viewBox="${head ? "15 0 70 70" : "0 0 100 140"}" ${a11y} data-look="${look.shirt}/${look.shorts}/${look.skin}/${look.hair}/${look.style}">
    <ellipse cx="50" cy="134" rx="22" ry="4" fill="#0002"/>
    <rect x="39" y="96" width="9" height="34" rx="4" fill="${shorts}"/>
    <rect x="52" y="96" width="9" height="34" rx="4" fill="${shorts}"/>
    <rect x="37" y="92" width="26" height="14" rx="5" fill="${shorts}"/>
    <rect x="23" y="56" width="8" height="34" rx="4" fill="${shirt}"/>
    <rect x="69" y="56" width="8" height="34" rx="4" fill="${shirt}"/>
    <circle cx="27" cy="92" r="4.5" fill="${skin}"/>
    <circle cx="73" cy="92" r="4.5" fill="${skin}"/>
    <path d="M32 54 Q50 48 68 54 L64 96 H36 Z" fill="${shirt}"/>
    <circle cx="50" cy="32" r="20" fill="${skin}"/>
    <circle cx="43" cy="32" r="2" fill="#2a1d14"/><circle cx="57" cy="32" r="2" fill="#2a1d14"/>
    <path d="M44 40 Q50 45 56 40" stroke="#8a3a2c" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    ${parts[look.style]}
  </svg>`;
}
