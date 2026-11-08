// Task 31 + 33: a runner wears the look's clothes. The runner draws its own
// jointed legs and arms over the tennis character; after task 33 the
// character's leg is skin under shorts (only trousers colour it), so the
// runner's thighs must take the bottom's colour, not the leg's, and its upper
// arms the sleeve's (skin under a tank top), as boxing's do.
import type { Material, Mesh, MeshLambertMaterial, Object3D } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { BOTTOM_COLOURS, DEFAULT_LOOKS, SKINS, TOP_COLOURS } from "../shared/look.ts";
import type { Look } from "../shared/look.ts";

type Runner = typeof import("../client/games/track/runner.ts");
let runner: Runner;

beforeAll(async () => {
  // the face is drawn on a canvas; Node has none, and this only needs the meshes
  const noop = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => noop }) };
  runner = await import("../client/games/track/runner.ts");
});

/** Every visible mesh's colour, as hex. */
function colours(root: Object3D): Set<number> {
  const out = new Set<number>();
  root.traverseVisible((o) => {
    const m = (o as Mesh).material as Material | undefined;
    if (m && "color" in m) out.add((m as MeshLambertMaterial).color.getHex());
  });
  return out;
}

describe("a runner wears the look", () => {
  it("shorts colour the thighs, a tank top leaves the upper arms bare, a tee covers them", () => {
    const look: Look = { ...DEFAULT_LOOKS[0], top: "tank", topColour: "green", bottom: "shorts", bottomColour: "khaki", skin: "s5" };
    const r = runner.makeRunner(look);
    r.run(1, 0.8);
    const seen = colours(r.group);
    expect(seen.has(BOTTOM_COLOURS.khaki), "shorts colour on the thighs").toBe(true);
    // the upper arm (and the shin, hands and neck) are skin; nothing else is the top's colour but the torso
    const tee = runner.makeRunner({ ...look, top: "tee" });
    let teeArms = 0;
    let tankArms = 0;
    const count = (root: Object3D, hex: number) => {
      let n = 0;
      root.traverseVisible((o) => {
        const m = (o as Mesh).material as MeshLambertMaterial | undefined;
        if (m?.color?.getHex() === hex && (o as Mesh).geometry?.type === "CapsuleGeometry") n++;
      });
      return n;
    };
    teeArms = count(tee.group, TOP_COLOURS.green);
    tankArms = count(r.group, TOP_COLOURS.green);
    expect(teeArms, "a tee's sleeves cover the upper arms").toBeGreaterThan(tankArms);
    expect(seen.has(SKINS.s5)).toBe(true);
  });

  it("setLook recolours the thighs", () => {
    const r = runner.makeRunner(DEFAULT_LOOKS[0]);
    r.setLook({ ...DEFAULT_LOOKS[0], bottom: "shorts", bottomColour: "khaki" });
    expect(colours(r.group).has(BOTTOM_COLOURS.khaki)).toBe(true);
  });
});
