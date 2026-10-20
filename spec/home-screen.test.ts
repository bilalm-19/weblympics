// Task 23 (and CLAUDE.md): the home screen is inline SVG and CSS, never
// Three.js. The menu and everything it imports, followed through the whole
// import graph, must not reach "three". The browser half (no canvas, no WebGL
// context, the loops, the cursor) is e2e/home.e2e.ts.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
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

describe("home screen has no Three.js", () => {
  const menu = resolve(import.meta.dirname, "../client/ui/menu.ts");

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
});
