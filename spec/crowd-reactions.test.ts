// Task 19: the crowd, placed by side, in every game. For each moment: which
// side cheers and which goes "aww" (never a boo), for seat 1, seat 2, a bot
// point and a spectator, with where on this screen each side is heard (pan)
// and how loud (your own side nearer and louder; a spectator gets seat 1's
// side on the left speaker and seat 2's on the right). Also how the stands
// move (crowd-motion.ts) and that they still change pose without the jumping
// loop under prefers-reduced-motion. All worked out on each screen from two
// snapshots; nothing here is sent anywhere.
import { describe, expect, it } from "vitest";
import { FAR_GAIN, ONLOOKER_GAIN, PLAYER_PAN, PRACTICE_GAIN, SPECTATOR_PAN, crowdVoices, pointEvent, sectionSeat } from "../client/audio/crowd.ts";
import type { CrowdContext, CrowdVoice, Seat, Stands } from "../client/audio/crowd.ts";
import { crowdPose, joinShare, reactionSeconds } from "../client/games/tennis/crowd-motion.ts";
import { crowdLayout } from "../client/games/tennis/crowd-layout.ts";
import { boxingCrowd } from "../client/games/boxing/sound.ts";
import { archeryCrowd } from "../client/games/archery/sound.ts";
import { trackCrowd } from "../client/games/track/sound.ts";
import { basketballCrowd } from "../client/games/basketball/sound.ts";
import { bowlingCrowd } from "../client/games/bowling/sound.ts";
import { createState as boxingState, snapshot as boxingSnap } from "../shared/games/boxing/sim.ts";
import type { BoxingSnapshot } from "../shared/games/boxing/sim.ts";
import { createState as trackState, snapshot as trackSnap } from "../shared/games/track/sim.ts";
import type { TrackSnapshot } from "../shared/games/track/sim.ts";
import { createState as bbState, snapshot as bbSnap } from "../shared/games/basketball/sim.ts";
import type { BasketballSnapshot, ShotResult } from "../shared/games/basketball/sim.ts";
import type { BallResult } from "../shared/games/bowling/sim.ts";

const ctx = (viewer: Seat | null, stands: Stands = "sides", practice = false): CrowdContext => ({ viewer, stands, practice });
const brief = (vs: CrowdVoice[]) => vs.map((v) => `${v.kind}:${v.side}@${v.pan.toFixed(2)}x${v.gain.toFixed(2)}`).sort();

describe("the crowd table: a point to seat 1 or seat 2, on each screen", () => {
  // [who is watching, who won, expected voices: kind:side@pan x gain]
  const rows: [string, Seat | null, Seat, string[]][] = [
    // seat 1 (index 0) wins, heard by seat 1: their own side cheers on the left, near; seat 2's side awws on the right, further
    ["seat 1 wins, seat 1's screen", 0, 0, [`aww:1@${PLAYER_PAN.toFixed(2)}x${FAR_GAIN.toFixed(2)}`, `cheer:0@${(-PLAYER_PAN).toFixed(2)}x1.00`]],
    // the same point on seat 2's screen: the arena is turned, so seat 2's own (awwing) side is on the left and nearer
    ["seat 1 wins, seat 2's screen", 1, 0, [`aww:1@${(-PLAYER_PAN).toFixed(2)}x1.00`, `cheer:0@${PLAYER_PAN.toFixed(2)}x${FAR_GAIN.toFixed(2)}`]],
    ["seat 2 wins, seat 1's screen", 0, 1, [`aww:0@${(-PLAYER_PAN).toFixed(2)}x1.00`, `cheer:1@${PLAYER_PAN.toFixed(2)}x${FAR_GAIN.toFixed(2)}`]],
    ["seat 2 wins, seat 2's screen", 1, 1, [`aww:0@${PLAYER_PAN.toFixed(2)}x${FAR_GAIN.toFixed(2)}`, `cheer:1@${(-PLAYER_PAN).toFixed(2)}x1.00`]],
    // a spectator: seat 1's side on the left speaker, seat 2's on the right, equally loud
    ["seat 1 wins, spectator", null, 0, [`aww:1@${SPECTATOR_PAN.toFixed(2)}x1.00`, `cheer:0@${(-SPECTATOR_PAN).toFixed(2)}x1.00`]],
    ["seat 2 wins, spectator", null, 1, [`aww:0@${(-SPECTATOR_PAN).toFixed(2)}x1.00`, `cheer:1@${SPECTATOR_PAN.toFixed(2)}x1.00`]],
  ];
  for (const [label, viewer, winner, expected] of rows) {
    it(label, () => expect(brief(crowdVoices(pointEvent(winner, 0), ctx(viewer)))).toEqual(expected.sort()));
  }

  it("a bot point is seat 2's side cheering and yours going aww, the same as any other player's point", () => {
    // practice vs bot: you are seat 1, the bot seat 2
    const v = crowdVoices(pointEvent(1, 1), ctx(0, "sides", true));
    expect(v.find((x) => x.kind === "cheer")!.side).toBe(1);
    expect(v.find((x) => x.kind === "aww")!.side).toBe(0);
    // practice keeps the crowd, quieter
    for (const x of v) expect(x.gain).toBeLessThanOrEqual(PRACTICE_GAIN + 1e-9);
  });

  it("never boos: the only voices are cheer, aww and applause", () => {
    for (const viewer of [0, 1, null] as const)
      for (const stands of ["sides", "ends", "onlookers"] as const)
        for (const winner of [0, 1] as const)
          for (const size of [0, 1, 2, 3] as const)
            for (const v of crowdVoices(pointEvent(winner, size), ctx(viewer, stands))) expect(["cheer", "aww", "applause"]).toContain(v.kind);
  });

  it("everyone hears both sides at once, the winner's cheer and the loser's aww", () => {
    for (const viewer of [0, 1, null] as const) expect(crowdVoices(pointEvent(0, 2), ctx(viewer)).map((v) => v.kind).sort()).toEqual(["aww", "cheer"]);
  });

  it("bigger moments are bigger: the size carries through", () => {
    for (const size of [0, 1, 2, 3] as const) for (const v of crowdVoices(pointEvent(0, size), ctx(0))) expect(v.size).toBe(size);
  });

  it("training has no crowd at all", () => {
    expect(crowdVoices(pointEvent(0, 3), { ...ctx(0), training: true })).toEqual([]);
  });

  it("a level moment (a draw, the bell) is applause from both sides", () => {
    expect(crowdVoices({ size: 2 }, ctx(null)).map((v) => `${v.kind}:${v.side}`).sort()).toEqual(["applause:0", "applause:1"]);
  });
});

describe("the ring: each boxer's fans behind them", () => {
  it("a player hears their own fans near and the other boxer's further, both from the middle", () => {
    const v = crowdVoices(pointEvent(1, 3), ctx(0, "ends"));
    expect(v.find((x) => x.side === 0)).toMatchObject({ kind: "aww", pan: 0, gain: 1 });
    expect(v.find((x) => x.side === 1)).toMatchObject({ kind: "cheer", pan: 0, gain: FAR_GAIN });
  });
  it("a spectator, side-on, hears seat 1's fans on the left and seat 2's on the right", () => {
    const v = crowdVoices(pointEvent(0, 0), ctx(null, "ends"));
    expect(v.find((x) => x.side === 0)!.pan).toBeLessThan(0);
    expect(v.find((x) => x.side === 1)!.pan).toBeGreaterThan(0);
  });
});

describe("onlookers (archery, bowling): a few people, backing nobody, quiet", () => {
  it("applaud a good moment and aww a bad one, quietly, from the middle", () => {
    expect(crowdVoices({ cheer: 0, size: 1 }, ctx(1, "onlookers"))).toEqual([{ side: null, kind: "applause", size: 1, pan: 0, gain: ONLOOKER_GAIN }]);
    expect(crowdVoices({ aww: 0, size: 0 }, ctx(null, "onlookers"))[0].kind).toBe("aww");
  });
});

describe("tennis's stands: which section is whose, on each screen", () => {
  it("your own side is the left stand and the left half of the front; a spectator sees seat 1 on the left", () => {
    expect(sectionSeat("left", 0)).toBe(0);
    expect(sectionSeat("frontLeft", 0)).toBe(0);
    expect(sectionSeat("right", 0)).toBe(1);
    expect(sectionSeat("frontRight", 0)).toBe(1);
    // seat 2's camera has the arena turned round, so its own fans are on its left too
    expect(sectionSeat("left", 1)).toBe(1);
    expect(sectionSeat("frontRight", 1)).toBe(0);
    expect(sectionSeat("left", null)).toBe(0);
    expect(sectionSeat("right", null)).toBe(1);
  });
  it("splits the crowd roughly in half by seat", () => {
    const layout = crowdLayout();
    const count = (viewer: Seat | null) => {
      const n = [0, 0];
      for (const s of layout.seats) n[sectionSeat(s.section, viewer)]++;
      return n;
    };
    const [a, b] = count(0);
    expect(Math.abs(a - b) / (a + b)).toBeLessThan(0.1);
  });
});

describe("each game's moments", () => {
  it("boxing: a clean jab is the thrower's fans cheering; a KO roars, a decision less, a draw is applause; the bell is applause", () => {
    const base = boxingSnap(boxingState(1));
    const s = (patch: Partial<BoxingSnapshot>): BoxingSnapshot => ({ ...base, ...patch });
    const hit = (seat: Seat, outcome: "clean" | "blocked" | "slipped") => s({ lastHit: { seat, hand: "left", target: "head", outcome, damage: 6, tick: 50 } });
    expect(boxingCrowd(base, hit(1, "clean"))).toEqual({ cheer: 1, size: 0 });
    expect(boxingCrowd(base, hit(1, "blocked"))).toBeNull();
    expect(boxingCrowd(base, hit(0, "slipped"))).toBeNull();
    expect(boxingCrowd(base, s({ phase: "over", winner: 0, result: "ko" }))).toEqual({ cheer: 0, aww: 1, size: 3 });
    expect(boxingCrowd(base, s({ phase: "over", winner: 1, result: "decision" }))).toEqual({ cheer: 1, aww: 0, size: 2 });
    expect(boxingCrowd(base, s({ phase: "over", winner: null, result: "draw" }))).toEqual({ size: 2 });
    expect(boxingCrowd(base, s({ phase: "break" }))).toEqual({ size: 1 });
  });

  it("archery: the bullseye and a 10 bring the onlookers up, an 8 or 9 a clap, a miss an aww, the rest nothing", () => {
    expect(archeryCrowd({ seat: 0, points: 11, bullseye: true })).toEqual({ cheer: 0, size: 2 });
    expect(archeryCrowd({ seat: 1, points: 10, bullseye: false })).toEqual({ cheer: 1, size: 1 });
    expect(archeryCrowd({ seat: 1, points: 8, bullseye: false })).toEqual({ cheer: 1, size: 0 });
    expect(archeryCrowd({ seat: 0, points: 5, bullseye: false })).toBeNull();
    expect(archeryCrowd({ seat: 0, points: 0, bullseye: false })).toEqual({ aww: 0, size: 0 });
  });

  it("track: the winner's side roars at the finish and the other side awws; in-page practice (solo) only cheers", () => {
    const base = trackSnap(trackState(1));
    const running: TrackSnapshot = { ...base, phase: "running" };
    expect(trackCrowd(running, { ...running, phase: "over", winner: 1 }, false)).toEqual({ cheer: 1, aww: 0, size: 3 });
    expect(trackCrowd(running, { ...running, phase: "over", winner: 0 }, true)).toEqual({ cheer: 0, size: 2 });
    expect(trackCrowd(running, running, false)).toBeNull();
  });

  it("basketball: the shooter's side cheers a make (bigger for a swish or the money ball) and awws a miss; the winner's side roars at the end", () => {
    const base = bbSnap(bbState(1));
    const shot = (p: Partial<ShotResult>): ShotResult => ({ seat: 1, round: 0, spot: 0, distance: 4.6, made: false, swish: false, rim: false, board: false, points: 0, power: 0.5, aim: 0, window: { lo: 0.4, hi: 0.6 }, suddenDeath: false, ...p });
    const flight: BasketballSnapshot = { ...base, phase: "flight" };
    const result = (p: Partial<ShotResult>): BasketballSnapshot => ({ ...base, phase: "result", last: shot(p) });
    expect(basketballCrowd(flight, result({ made: true, rim: true, points: 2 }))).toEqual({ cheer: 1, size: 0 });
    expect(basketballCrowd(flight, result({ made: true, swish: true, points: 3 }))).toEqual({ cheer: 1, size: 1 });
    expect(basketballCrowd(flight, result({ made: false, rim: true }))).toEqual({ aww: 1, size: 0 });
    expect(basketballCrowd({ ...base, phase: "result" }, { ...base, phase: "over", winner: 0 })).toEqual({ cheer: 0, aww: 1, size: 3 });
    expect(basketballCrowd({ ...base, phase: "result" }, { ...base, phase: "over", winner: null, draw: true })).toEqual({ size: 2 });
  });

  it("bowling: a strike gets more than a spare, a gutter an aww, a plain count nothing", () => {
    const ball = (p: Partial<BallResult>): BallResult => ({ seat: 0, frame: 0, ball: 0, pins: 0, left: [], strike: false, spare: false, gutter: false, timeout: false, split: false, read: null, ...p });
    expect(bowlingCrowd(ball({ pins: 10, strike: true }))).toEqual({ cheer: 0, size: 1 });
    expect(bowlingCrowd(ball({ seat: 1, pins: 3, spare: true }))).toEqual({ cheer: 1, size: 0 });
    expect(bowlingCrowd(ball({ gutter: true }))).toEqual({ aww: 0, size: 0 });
    expect(bowlingCrowd(ball({ pins: 6 }))).toBeNull();
  });
});

describe("how the stands move", () => {
  it("the cheering side jumps, the aww side slumps and shakes its head, applause bobs; all settle back to rest", () => {
    const t = 0.5;
    const cheer = Math.max(...[0, 1, 2, 3, 4, 5].map((b) => crowdPose("cheer", 1, t, b, false).body));
    expect(cheer).toBeGreaterThan(0.1);
    const aww = crowdPose("aww", 1, t, 1, false);
    expect(aww.body).toBeLessThan(0);
    expect(aww.head).toBeLessThan(0);
    expect(Math.max(...[0, 1, 2, 3].map((b) => Math.abs(crowdPose("aww", 1, t, b, false).shake)))).toBeGreaterThan(0.05);
    expect(crowdPose("applause", 1, t, 1, false).body).toBeGreaterThanOrEqual(0);
    for (const k of ["cheer", "aww", "applause"] as const) expect(crowdPose(k, 2, reactionSeconds(k, 2) + 0.01, 0, false)).toEqual({ body: 0, head: 0, shake: 0 });
  });

  it("bigger moments: more fans join, higher and longer", () => {
    expect(joinShare(3)).toBe(1);
    expect(joinShare(0)).toBeLessThan(joinShare(2));
    expect(reactionSeconds("cheer", 3)).toBeGreaterThan(reactionSeconds("cheer", 0));
    const peak = (size: 0 | 3) => Math.max(...Array.from({ length: 50 }, (_, i) => crowdPose("cheer", size, 0.2 + i * 0.02, 0, false).body));
    expect(peak(3)).toBeGreaterThan(peak(0));
  });

  it("prefers-reduced-motion: the crowd still changes pose (up, or slumped) but holds it, with no jumping loop or head shake", () => {
    const at = (t: number) => crowdPose("cheer", 2, t, 0.3, true);
    expect(at(0.5).body).toBeGreaterThan(0);
    // held: the same pose a moment later (no bounce)
    expect(at(0.7).body).toBeCloseTo(at(0.5).body, 6);
    expect(at(0.9).body).toBeCloseTo(at(0.5).body, 6);
    const aww = [0.4, 0.6, 0.8].map((t) => crowdPose("aww", 2, t, 0.3, true));
    for (const p of aww) {
      expect(p.body).toBeLessThan(0);
      expect(p.shake).toBe(0);
    }
  });
});
