// Weblympics colours (task 14): the five Olympic ring colours, and the text
// and background pairs the UI uses them in, so a test can hold every pair to
// WCAG AA (spec/brand.test.ts). Pure: no DOM.

export const RINGS = [
  { name: "blue", hex: "#0081c8" },
  { name: "yellow", hex: "#fcb131" },
  { name: "black", hex: "#1d1d1f" },
  { name: "green", hex: "#00a651" },
  { name: "red", hex: "#ee334e" },
] as const;

/** Relative luminance of a #rrggbb colour (WCAG 2). */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every text-on-background pair the brand colours appear in, as in
 * style.css. `large` is text at least 18.66px bold or 24px (AA 3:1);
 * everything else needs 4.5:1. For gradients the lighter and darker ends are
 * both listed.
 */
export const TEXT_PAIRS: readonly { where: string; fg: string; bg: string; large?: boolean }[] = [
  // home screen (task 36)
  { where: "menu ink on the sky (top)", fg: "#12385e", bg: "#bfe4ff" },
  { where: "menu soft ink on the panels", fg: "#3d5873", bg: "#ffffff" },
  { where: "input chip text", fg: "#12385e", bg: "#d9efff" },
  { where: "logo letters' ink outline on the sky", fg: "#12385e", bg: "#bfe4ff", large: true },
  { where: "primary button text on Olympic yellow", fg: "#4d2c00", bg: "#fcb131" },
  { where: "primary button text on its pale end", fg: "#4d2c00", bg: "#ffeec8" },
  { where: "vs-bot button text", fg: "#5a0016", bg: "#fff0f2" },
  { where: "train button text", fg: "#003a1c", bg: "#e6f8ee" },
  { where: "party button text", fg: "#3b1a6e", bg: "#f1e6ff" },
  { where: "join button text", fg: "#06263f", bg: "#e3f3ff" },
  { where: "readme link and Change my look on white", fg: "#0b5aa8", bg: "#ffffff" },
  { where: "focus ring on white (non-text, 3:1)", fg: "#0b63c4", bg: "#ffffff", large: true },
  // game UI (dark)
  { where: "accent (Olympic yellow) on the game background", fg: "#fcb131", bg: "#0f1720" },
  { where: "dark text on the accent (primary buttons)", fg: "#1a1400", bg: "#fcb131" },
  { where: "accent on the score bar", fg: "#fcb131", bg: "#1b2733" },
];
