// Task 23 (and CLAUDE.md): the home screen is inline SVG and CSS, never
// Three.js. The menu and everything it imports, followed through the whole
// import graph, must not reach "three". Task 36 adds small 3D card icons,
// but only through a dynamic import() after the flat page is drawn, and only
// where home-3d-gate.ts allows (a window wider than a phone, no reduced
// motion). The browser half (no canvas on the flat path, the loops, the
// cursor, the layout at three sizes) is e2e/home.e2e.ts and e2e/home-layout.e2e.ts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS_3D_MIN_WIDTH, wants3dIcons } from "../client/ui/home-3d-gate.ts";
import { ART } from "../client/ui/home-art.ts";
import { SPORTS } from "../client/ui/menu.ts";
import { contrast } from "../client/ui/brand.ts";

/** Static imports that reach the browser: `import type` is erased by the build, `import()` is loaded later. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
}

/** Every module reachable from `entry`, bare package names included as-is. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!file.endsWith(".ts")) return;
    for (const spec of importsOf(file)) {
      if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
      else seen.add(spec);
    }
  };
  walk(entry);
  return seen;
}

const menu = resolve(import.meta.dirname, "../client/ui/menu.ts");

describe("home screen has no Three.js on its flat path", () => {
  it("menu.ts and everything it imports never reach three", () => {
    const all = [...graph(menu)];
    expect(all.filter((m) => m === "three" || m.startsWith("three/"))).toEqual([]);
    // and it stays inside client/ui (inline SVG/CSS, no game code)
    expect(all.filter((m) => m.includes("/games/"))).toEqual([]);
  });

  it("the check would catch it: a game view does reach three", () => {
    const view = resolve(import.meta.dirname, "../client/games/tennis/view.ts");
    expect([...graph(view)]).toContain("three");
  });

  it("the 3D icons are only ever loaded with import(), never a static import", () => {
    const src = readFileSync(menu, "utf8");
    expect(src).toMatch(/await import\("\.\/home-3d\.ts"\)/);
    expect([...graph(menu)].some((m) => m.endsWith("home-3d.ts"))).toBe(false);
    // and that module is the one that brings three
    expect([...graph(resolve(dirname(menu), "home-3d.ts"))]).toContain("three");
  });
});

describe("the 3D card icons stay off weak and small screens (task 36)", () => {
  const base = { reducedMotion: false, width: 1920, automated: false, asked: false };

  it("a desktop window with motion allowed gets them", () => {
    expect(wants3dIcons(base)).toBe(true);
    expect(wants3dIcons({ ...base, width: ICONS_3D_MIN_WIDTH })).toBe(true);
  });

  it("a phone-width window, or reduced motion, stays flat", () => {
    expect(wants3dIcons({ ...base, width: 390 })).toBe(false);
    expect(wants3dIcons({ ...base, width: ICONS_3D_MIN_WIDTH - 1 })).toBe(false);
    expect(wants3dIcons({ ...base, reducedMotion: true })).toBe(false);
    expect(wants3dIcons({ ...base, reducedMotion: true, asked: true })).toBe(false);
  });

  it("a test browser stays flat unless the page asks for them", () => {
    expect(wants3dIcons({ ...base, automated: true })).toBe(false);
    expect(wants3dIcons({ ...base, automated: true, asked: true })).toBe(true);
  });
});

describe("every sport is reachable and drawn", () => {
  it("each sport in SPORTS has its own card colour, icon, preview and field", () => {
    for (const s of SPORTS) {
      const art = ART[s.id];
      expect(art, s.id).toBeDefined();
      expect(art.icon.length, s.id).toBeGreaterThan(50);
      expect(art.preview, s.id).toMatch(/repeatCount="indefinite"/);
      expect(art.field.length, s.id).toBeGreaterThan(20);
    }
  });

  it("the white name on every sport card meets WCAG AA (4.5:1)", () => {
    for (const s of SPORTS) expect(contrast("#ffffff", ART[s.id].colour), s.id).toBeGreaterThanOrEqual(4.5);
  });

  it("the previews loop on short cycles (at most 4 s)", () => {
    for (const s of SPORTS) {
      for (const [, d] of ART[s.id].preview.matchAll(/dur="([\d.]+)s"/g)) expect(Number(d), s.id).toBeLessThanOrEqual(4);
    }
  });
});
