// How soon can one boxer punch again? (task 30, playtest 5: "the delay between
// punches feels long".) These are measurements through the real sim (`step`)
// and the real camera detector, not readings of the constants: each test finds
// the shortest gap by trying gaps until every press is accepted, and prints
// the answer. The floors they pin are the numbers the devlog quotes.
import { describe, expect, it } from "vitest";
import { TRIAL_BOX, TrialDetector } from "../client/input/camera/box-pose.ts";
import type { HandMeasures, TrialFrame } from "../client/input/camera/box-pose.ts";
import { JAB_WINDUP_MS, MIN_PUNCH_GAP_MS, RECOVER_MS, TICK_MS, createState, step } from "../shared/games/boxing/sim.ts";
import type { BoxingInput, Hand } from "../shared/games/boxing/sim.ts";

interface Press {
  /** ms from the start (the client's own clock) */
  at: number;
  hand: Hand;
}

/** Plays presses, one on the first tick at or after its time, and returns whether each was thrown (a throw event came out). */
function play(presses: Press[]): boolean[] {
  const s = createState(1);
  const ok: boolean[] = presses.map(() => false);
  let next = 0;
  const end = Math.ceil((presses[presses.length - 1].at + 1000) / TICK_MS);
  for (let tick = 1; tick <= end; tick++) {
    const now = tick * TICK_MS;
    const inputs: BoxingInput[] = [];
    let i = -1;
    if (next < presses.length && presses[next].at <= now) {
      i = next++;
      inputs.push({ t: "punch", seat: 0, hand: presses[i].hand, target: "head", at: presses[i].at });
    }
    const ev = step(s, inputs);
    if (i >= 0 && ev.some((e) => e.type === "throw")) ok[i] = true;
  }
  return ok;
}

/** The shortest uniform gap (ms, in 1 ms steps) at which all `n` presses are thrown. */
function shortestGap(n: number, handFor: (i: number) => Hand): number {
  for (let g = 20; g <= 800; g++) {
    const presses = Array.from({ length: n }, (_, i) => ({ at: 100 + i * g, hand: handFor(i) }));
    if (play(presses).every(Boolean)) return g;
  }
  return Infinity;
}

const alternate = (i: number): Hand => (i % 2 === 0 ? "left" : "right");
const same = (): Hand => "right";

describe("the sim's own floors on the gap between punches", () => {
  it("two hands: two jabs are both thrown at the 100 ms punch gap", () => {
    expect(shortestGap(2, alternate)).toBe(MIN_PUNCH_GAP_MS);
  });

  it("alternating hands, J J J: the burst of 2 then the token bucket; the first hand again is 'hand-busy' until 300 ms after its first", () => {
    const g3 = shortestGap(3, alternate);
    console.log(`alternating, 3 presses: ${g3} ms apart`);
    expect(g3).toBeGreaterThanOrEqual(140);
    expect(g3).toBeLessThanOrEqual(150);
  });

  it("alternating hands, held for 40 presses: the cap of 4 a second is the floor, 250 ms", () => {
    const g = shortestGap(40, alternate);
    console.log(`alternating, 40 presses: ${g} ms apart`);
    expect(g).toBeGreaterThanOrEqual(240);
    expect(g).toBeLessThanOrEqual(260);
  });

  it("one hand twice: wind-up plus recovery, 300 ms", () => {
    const g = shortestGap(2, same);
    console.log(`same hand, 2 presses: ${g} ms apart`);
    expect(g).toBeGreaterThanOrEqual(JAB_WINDUP_MS + RECOVER_MS - 17);
    expect(g).toBeLessThanOrEqual(JAB_WINDUP_MS + RECOVER_MS + 17);
  });

  it("mashing J every 120 ms, alternating blindly: some presses are refused and lost", () => {
    const presses = Array.from({ length: 10 }, (_, i) => ({ at: 100 + i * 120, hand: alternate(i) }));
    const thrown = play(presses).filter(Boolean).length;
    console.log(`J every 120 ms, alternating blindly: ${thrown} of 10 thrown`);
    expect(thrown).toBeLessThan(10);
  });
});

// The camera path: the detector at the recorded frame rates, then the sim.
const REST = 0.22;
const hand = (size: number): HandMeasures => ({ size, height: 0.6, across: -0.5 });
const frame = (grow: number): TrialFrame => ({
  hands: { left: null, right: hand(REST * grow) },
  arms: { left: null, right: null },
});

/** Times (ms) of the jabs the detector reads when the fist is out for `out` frames then in for `back` frames, repeatedly. */
function jabTimes(fps: number, out: number, back: number, cycles: number): number[] {
  const d = new TrialDetector();
  const times: number[] = [];
  let i = 0;
  const feed = (grow: number) => {
    const t = (i++ * 1000) / fps;
    if (d.update(frame(grow), t).punch) times.push(t);
  };
  for (let k = 0; k < 24; k++) feed(1);
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < out; k++) feed(1.6);
    for (let k = 0; k < back; k++) feed(1);
  }
  return times;
}

describe("the camera path's floor between two jabs of one hand", () => {
  for (const fps of [19, 24, 30]) {
    it(`at ${fps} fps the detector's own floor is about its 250 ms minGap plus a frame`, () => {
      for (let back = 1; back < 40; back++) {
        const t = jabTimes(fps, 1, back, 2);
        if (t.length === 2) {
          const gap = t[1] - t[0];
          console.log(`camera ${fps} fps: second jab of the same hand after ${gap.toFixed(0)} ms (fist out 1 frame, back ${back} frames)`);
          expect(gap).toBeGreaterThanOrEqual(TRIAL_BOX.minGapMs);
          expect(gap).toBeLessThan(TRIAL_BOX.minGapMs + 2000 / fps + 1);
          return;
        }
      }
      throw new Error("never re-armed");
    });
  }

  it("the detector's floor at 24 fps (about 250-290 ms) is under the sim's 300 ms: a same-hand jab-jab at that pace is refused as 'hand-busy' and lost", () => {
    const t = jabTimes(24, 1, 6, 4);
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    const thrown = play(t.map((x) => ({ at: 100 + x, hand: "right" as Hand })));
    console.log(`camera 24 fps, one hand at its floor: gaps ${gaps.map((g) => g.toFixed(0)).join(", ")} ms, thrown ${thrown.filter(Boolean).length} of ${thrown.length}`);
    expect(Math.min(...gaps)).toBeLessThan(JAB_WINDUP_MS + RECOVER_MS);
    expect(thrown.filter(Boolean).length).toBeLessThan(thrown.length);
  });

  it("a fist that comes back only to 1.2x its rest (not within 1.15x) never re-arms: one jab of four", () => {
    const d = new TrialDetector();
    let jabs = 0;
    let i = 0;
    const feed = (grow: number) => {
      if (d.update(frame(grow), (i++ * 1000) / 24).punch) jabs++;
    };
    for (let k = 0; k < 24; k++) feed(1);
    for (let c = 0; c < 4; c++) {
      for (let k = 0; k < 2; k++) feed(1.6);
      for (let k = 0; k < 12; k++) feed(1.2);
    }
    console.log(`fist returns to 1.2x only: ${jabs} jabs of 4`);
    expect(jabs).toBe(1);
  });
});
