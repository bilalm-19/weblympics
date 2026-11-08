// A jab asked for with a busy hand is lost by the server ("hand-busy"), even
// with the other hand free (task 30, playtest 5: punches register
// inconsistently, the gap feels long). The view now gives way to the free hand.
import { describe, expect, it } from "vitest";
import { BUSY_MS, chooseHand } from "../client/games/boxing/hand-pick.ts";
import { JAB_WINDUP_MS, RECOVER_MS, TICK_MS, createState, step } from "../shared/games/boxing/sim.ts";
import type { Hand } from "../shared/games/boxing/sim.ts";

/** The view's logic on a stream of (time, asked hand) jabs; returns how many the real sim threw. */
function thrown(asks: Array<[number, Hand]>, pick: boolean): number {
  const s = createState(1);
  const sentAt: Record<Hand, number | null> = { left: null, right: null };
  let n = 0;
  let next = 0;
  for (let tick = 1; tick <= Math.ceil((asks[asks.length - 1][0] + 600) / TICK_MS); tick++) {
    const inputs = [];
    if (next < asks.length && asks[next][0] <= tick * TICK_MS) {
      const [at, asked] = asks[next++];
      const h = pick ? chooseHand(asked, { left: sentAt.left === null ? null : at - sentAt.left, right: sentAt.right === null ? null : at - sentAt.right }) : asked;
      sentAt[h] = at;
      inputs.push({ t: "punch" as const, seat: 0 as const, hand: h, target: "head" as const, at });
    }
    n += step(s, inputs).filter((e) => e.type === "throw").length;
  }
  return n;
}

describe("choosing the hand for a jab", () => {
  it("the busy window is the sim's wind-up plus recovery, with a little to spare", () => {
    expect(BUSY_MS).toBeGreaterThanOrEqual(JAB_WINDUP_MS + RECOVER_MS);
  });

  it("keeps the asked-for hand when it is free, or when both are busy", () => {
    expect(chooseHand("left", { left: null, right: null })).toBe("left");
    expect(chooseHand("left", { left: 1000, right: 50 })).toBe("left");
    expect(chooseHand("left", { left: 100, right: 100 })).toBe("left");
  });

  it("gives way to the other hand when the asked-for one is still out", () => {
    expect(chooseHand("right", { left: null, right: 150 })).toBe("left");
    expect(chooseHand("right", { left: 600, right: 200 })).toBe("left");
  });

  // 150 ms apart: inside one hand's 200 ms gap (100 ms wind-up + 100 ms
  // recovery since 2026-11-08; these were 200 ms apart against the old 300)
  it("two right-hand jabs 150 ms apart (a camera player jabbing with one hand): the second is lost without it, thrown with it", () => {
    const asks: Array<[number, Hand]> = [
      [100, "right"],
      [250, "right"],
    ];
    expect(thrown(asks, false)).toBe(1);
    expect(thrown(asks, true)).toBe(2);
  });

  it("a keyboard player whose alternation was flipped by a refused press: J every 150 ms keeps landing", () => {
    // R, R (asked twice by the camera), then the alternation continues
    const asks: Array<[number, Hand]> = [
      [100, "right"],
      [250, "right"],
      [400, "left"],
      [550, "right"],
    ];
    expect(thrown(asks, false)).toBe(3);
    expect(thrown(asks, true)).toBe(4);
  });
});
