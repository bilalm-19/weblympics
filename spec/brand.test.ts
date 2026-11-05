// Task 14: the Weblympics colours. Every place a brand colour carries text
// (or a control's edge) meets WCAG AA, and the logo stays our own motif.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RINGS, TEXT_PAIRS, contrast } from "../client/ui/brand.ts";

describe("brand colours", () => {
  it("are the five Olympic ring colours, in order", () => {
    expect(RINGS.map((r) => r.name)).toEqual(["blue", "yellow", "black", "green", "red"]);
  });

  it("contrast: the WCAG maths is right on known pairs", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const p of TEXT_PAIRS) {
    const need = p.large ? 3 : 4.5;
    it(`${p.where}: at least ${need}:1`, () => {
      expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(need);
    });
  }

  it("the pairs listed are the ones style.css uses", () => {
    const css = readFileSync(new URL("../client/style.css", import.meta.url), "utf8").toLowerCase();
    for (const r of RINGS) expect(css).toContain(r.hex);
    for (const p of TEXT_PAIRS) {
      for (const hex of [p.fg, p.bg]) {
        // ring colours are referenced through their custom properties
        if (RINGS.some((r) => r.hex === hex)) continue;
        expect(css, `${p.where}: ${hex} in style.css`).toContain(hex);
      }
    }
  });

  it("the yellow and light blue never carry text on white or the sky", () => {
    for (const bg of ["#ffffff", "#cfe8fa"]) {
      expect(contrast("#fcb131", bg)).toBeLessThan(3);
      // so the logo's yellow letters get the ink outline, which does pass
      expect(contrast("#12385e", bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
