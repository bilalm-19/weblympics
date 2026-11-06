// The ?debug recorder can answer playtest 5 next time (task 30): the tilt's own
// spread per move, and per-punch read/missed with the player marking real
// punches (P). A real webcam is needed to use it; this only pins that it is there
// and stays behind ?debug. Method: docs/camera-playtest.md.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../client/games/boxing/box-camera.ts", import.meta.url), "utf8");
const doc = readFileSync(new URL("../docs/camera-playtest.md", import.meta.url), "utf8");

describe("the boxing recorder (playtest 5)", () => {
  it("records the tilt's spread, marks real punches with P and reports read, missed and unmarked", () => {
    expect(src).toMatch(/tilt spread/);
    expect(src).toMatch(/e\.key === "p"/);
    expect(src).toMatch(/MISSED/);
    expect(src).toMatch(/detector jabs with no mark/);
  });

  it("is behind ?debug and documented", () => {
    expect(src).toMatch(/has\("debug"\)/);
    expect(doc).toMatch(/Press P at each real punch/);
  });
});
