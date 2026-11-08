// Task 19: the shared audio module (client/audio/). One AudioContext, made
// only inside the first user gesture and only when sound isn't muted; muted
// (or effects off) means no audio nodes are made at all. Settings are saved
// per browser. The home music's notes are a pure function of the bar. Each
// game's sounds are a pure function of two snapshots (client/games/*/sound.ts).
import { describe, expect, it } from "vitest";
import { createAudioEngine } from "../client/audio/engine.ts";
import { AUDIO_KEY, DEFAULT_AUDIO, loadAudioSettings } from "../client/audio/settings.ts";
import { createSoundPlayer } from "../client/audio/sounds.ts";
import type { AnyCue, Cue } from "../client/audio/sounds.ts";
import { BPM, jazzBar } from "../client/audio/music.ts";
import { courtPan, paceLevel, swingCues, tennisCues } from "../client/games/tennis/sound.ts";
import { boxingCues } from "../client/games/boxing/sound.ts";
import { archeryCues } from "../client/games/archery/sound.ts";
import { trackCues } from "../client/games/track/sound.ts";
import { basketballCues } from "../client/games/basketball/sound.ts";
import { bowlingCues } from "../client/games/bowling/sound.ts";
import { createState as tennisState, snapshot as tennisSnap } from "../shared/games/tennis/sim.ts";
import type { TennisSnapshot } from "../shared/games/tennis/sim.ts";
import { pointWon } from "../shared/games/tennis/scoring.ts";
import { createState as boxingState, snapshot as boxingSnap } from "../shared/games/boxing/sim.ts";
import { createState as archeryState, snapshot as archerySnap } from "../shared/games/archery/sim.ts";
import type { ArcherySnapshot } from "../shared/games/archery/sim.ts";
import { createState as trackState, snapshot as trackSnap } from "../shared/games/track/sim.ts";
import type { TrackSnapshot } from "../shared/games/track/sim.ts";
import { createState as bbState, snapshot as bbSnap } from "../shared/games/basketball/sim.ts";
import type { BasketballSnapshot } from "../shared/games/basketball/sim.ts";
import { createState as bowlState, snapshot as bowlSnap } from "../shared/games/bowling/sim.ts";
import type { BowlingSnapshot } from "../shared/games/bowling/sim.ts";

// ---- a fake AudioContext that counts every node made ----
function fakeAudio() {
  const made = { contexts: 0, nodes: 0 };
  const param = () => {
    const p = { value: 0, setValueAtTime: () => p, exponentialRampToValueAtTime: () => p, linearRampToValueAtTime: () => p, setTargetAtTime: () => p, cancelScheduledValues: () => p };
    return p;
  };
  const node = (extra: object = {}) => {
    made.nodes++;
    const n: Record<string, unknown> = { connect: (to: unknown) => to, disconnect: () => {}, start: () => {}, stop: () => {}, ...extra };
    return n;
  };
  const makeContext = () => {
    made.contexts++;
    return {
      state: "running",
      sampleRate: 8000,
      currentTime: 0,
      destination: {},
      resume: async () => {},
      close: async () => {},
      createGain: () => node({ gain: param() }),
      createBiquadFilter: () => node({ frequency: param(), Q: param(), type: "lowpass" }),
      createOscillator: () => node({ frequency: param(), detune: param(), type: "sine" }),
      createStereoPanner: () => node({ pan: param() }),
      createBufferSource: () => node({ buffer: null, loop: false }),
      createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    } as unknown as AudioContext;
  };
  return { made, makeContext };
}

function memoryStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

describe("the audio engine", () => {
  it("makes no AudioContext and no nodes before the first user gesture", () => {
    const { made, makeContext } = fakeAudio();
    const engine = createAudioEngine({ makeContext, storage: memoryStorage() });
    const player = createSoundPlayer(engine, () => 0);
    player.play([{ s: "hit", v: 2 }, { s: "crowd-cheer", v: 3 }, { loop: "roll", v: 1 }]);
    expect(engine.fx()).toBeNull();
    expect(engine.music()).toBeNull();
    expect(made).toEqual({ contexts: 0, nodes: 0 });
    // the gesture makes one context, and sounds play from then on
    engine.unlock();
    expect(made.contexts).toBe(1);
    const before = made.nodes;
    player.play([{ s: "hit", v: 2 }]);
    expect(made.nodes).toBeGreaterThan(before);
  });

  it("listens for the first gesture itself (a key or a tap anywhere)", () => {
    const { made, makeContext } = fakeAudio();
    const target = new EventTarget();
    const engine = createAudioEngine({ makeContext, storage: memoryStorage(), events: target });
    expect(engine.unlocked()).toBe(false);
    target.dispatchEvent(new Event("keydown"));
    expect(engine.unlocked()).toBe(true);
    expect(made.contexts).toBe(1);
    engine.dispose();
  });

  it("muted means no audio nodes are created at all, gesture or not", () => {
    const { made, makeContext } = fakeAudio();
    const storage = memoryStorage({ [AUDIO_KEY]: JSON.stringify({ ...DEFAULT_AUDIO, muted: true }) });
    const engine = createAudioEngine({ makeContext, storage });
    engine.unlock();
    const player = createSoundPlayer(engine, () => 0);
    player.play([{ s: "gun" }, { s: "crowd-aww", v: 1 }, { loop: "murmur", v: 0.5 }]);
    expect(engine.fx()).toBeNull();
    expect(engine.music()).toBeNull();
    expect(made).toEqual({ contexts: 0, nodes: 0 });
  });

  it("effects off makes no effect nodes; music off gives the music nothing", () => {
    const { made, makeContext } = fakeAudio();
    const engine = createAudioEngine({ makeContext, storage: memoryStorage() });
    engine.update({ effects: false, music: false });
    engine.unlock();
    expect(made.contexts).toBe(0);
    createSoundPlayer(engine, () => 0).play([{ s: "bell" }]);
    expect(made.nodes).toBe(0);
    expect(engine.music()).toBeNull();
  });

  it("saves the settings per browser and reads them back; malformed values fall back to the defaults", () => {
    const storage = memoryStorage();
    const engine = createAudioEngine({ makeContext: fakeAudio().makeContext, storage });
    engine.update({ music: false, volume: 0.3 });
    expect(loadAudioSettings(storage)).toEqual({ ...DEFAULT_AUDIO, music: false, volume: 0.3 });
    expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: "{not json" }))).toEqual(DEFAULT_AUDIO);
    expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: JSON.stringify({ muted: "yes", volume: 7 }) }))).toEqual({ ...DEFAULT_AUDIO, volume: 1 });
    expect(loadAudioSettings(null)).toEqual(DEFAULT_AUDIO);
  });

  it("music is on by default (user, 2026-11-08), and sound is not muted", () => {
    expect(DEFAULT_AUDIO.music).toBe(true);
    expect(DEFAULT_AUDIO.muted).toBe(false);
  });

  it("a burst of small crowd moments (a flurry of jabs) doesn't wash together: one per side within the gap", () => {
    const { made, makeContext } = fakeAudio();
    const engine = createAudioEngine({ makeContext, storage: memoryStorage() });
    engine.unlock();
    let t = 0;
    const player = createSoundPlayer(engine, () => t);
    const cheer: Cue = { s: "crowd-cheer", v: 0, pan: -0.4 };
    player.play([cheer]);
    const one = made.nodes;
    t = 100;
    player.play([cheer]);
    expect(made.nodes).toBe(one);
    t = 1000;
    player.play([cheer]);
    expect(made.nodes).toBeGreaterThan(one);
  });
});

describe("the home music", () => {
  it("walks a bass note every beat into the next bar's root by a semitone, and comps on swung off-beats", () => {
    for (let i = 0; i < 8; i++) {
      const bar = jazzBar(i);
      const next = jazzBar(i + 1);
      expect(bar.bass).toHaveLength(4);
      expect(Math.abs(bar.bass[3] - next.bass[0])).toBe(1);
      expect(bar.chord.length).toBeGreaterThanOrEqual(3);
      for (const b of bar.comp) expect(b).toBeGreaterThanOrEqual(0);
      for (const b of bar.comp) expect(b).toBeLessThan(4);
    }
    // a four-bar turnaround that loops
    expect(jazzBar(4).bass[0]).toBe(jazzBar(0).bass[0]);
    expect(BPM).toBeGreaterThan(80);
    expect(BPM).toBeLessThan(160);
  });
});

const names = (cues: AnyCue[]) => cues.map((c) => ("loop" in c ? `loop:${c.loop}` : c.s));

describe("tennis's sounds, from two snapshots", () => {
  const base = tennisSnap(tennisState(1));
  const ctx = { viewer: 0 as const, stands: "sides" as const, practice: false };
  it("the other player's hit, by its pace; your own is played as you swing", () => {
    const hit: TennisSnapshot = { ...base, lastHitter: 1, shots: 2, ball: { ...base.ball, vx: 0, vz: 18 } };
    expect(names(tennisCues({ ...base, lastHitter: 0, shots: 1 }, hit, ctx))).toEqual(["hit"]);
    expect(names(tennisCues({ ...base, lastHitter: 1, shots: 1 }, { ...hit, lastHitter: 0 }, ctx))).toEqual([]);
    expect(paceLevel(0, 18)).toBe(2);
    expect(paceLevel(0, 11)).toBe(0);
    expect(names(swingCues(1, true))).toEqual(["swing", "hit"]);
    expect(names(swingCues(1, false))).toEqual(["swing"]);
  });
  it("a bounce, and the line judge's out when it lands out", () => {
    expect(names(tennisCues(base, { ...base, lastBounce: { x: 1, z: -5, in: true, tick: 10 } }, ctx))).toEqual(["bounce"]);
    expect(names(tennisCues(base, { ...base, lastBounce: { x: 1, z: -15, in: false, tick: 10 } }, ctx))).toEqual(["bounce", "out"]);
  });
  it("a fault is the umpire's whistle and a gasp (none in training); a net cord thumps; a point brings the crowd", () => {
    const fault = { ...base, lastCall: { call: "fault" as const, seat: 0 as const, reason: "net" as const, tick: 20 } };
    expect(names(tennisCues(base, fault, ctx))).toEqual(["net", "fault", "gasp"]);
    expect(names(tennisCues(base, fault, { ...ctx, training: true }))).toEqual(["net", "fault"]);
    const point = { ...base, score: pointWon(base.score, 1), lastCall: { call: "point" as const, seat: 1 as const, reason: "out" as const, tick: 30 } };
    const cues = tennisCues(base, point, ctx) as Cue[];
    expect(cues.map((c) => c.s).sort()).toEqual(["crowd-aww", "crowd-cheer"]);
    // seat 2 won on seat 1's screen: the cheer is on the right
    expect(cues.find((c) => c.s === "crowd-cheer")!.pan).toBeGreaterThan(0);
    // training: the point is played but nobody's watching
    expect(tennisCues(base, point, { ...ctx, training: true })).toEqual([]);
  });
  it("is silent on the first snapshot and for the same snapshot twice", () => {
    expect(tennisCues(null, base, ctx)).toEqual([]);
    expect(tennisCues(base, base, ctx)).toEqual([]);
  });
  it("pans by where it happens on this screen (the arena turns round for seat 2)", () => {
    expect(courtPan(3, 0)).toBeGreaterThan(0);
    expect(courtPan(3, 1)).toBeLessThan(0);
    expect(courtPan(3, null)).toBeGreaterThan(0);
  });
});

describe("boxing's sounds", () => {
  const base = boxingSnap(boxingState(1));
  const ctx = { viewer: 0 as const, stands: "ends" as const, practice: false };
  const hit = (outcome: "clean" | "blocked" | "slipped") => ({ ...base, lastHit: { seat: 1 as const, hand: "left" as const, target: "head" as const, outcome, damage: 6, tick: 40 } });
  it("a clean glove thuds (and the thrower's fans cheer), blocked is duller, a slip whooshes", () => {
    expect(names(boxingCues(base, hit("clean"), ctx))).toEqual(["glove", "crowd-cheer"]);
    expect(names(boxingCues(base, hit("blocked"), ctx))).toEqual(["glove-blocked"]);
    expect(names(boxingCues(base, hit("slipped"), ctx))).toEqual(["slip"]);
  });
  it("the bell at the end of a round and the start of the next; ding-ding at a KO", () => {
    expect(names(boxingCues(base, { ...base, phase: "break" }, ctx))).toContain("bell");
    expect(names(boxingCues({ ...base, phase: "break" }, { ...base, phase: "round", round: 2 }, ctx))).toEqual(["bell"]);
    expect(names(boxingCues(base, { ...base, phase: "over", result: "ko", winner: 0 }, ctx))).toContain("ko-bell");
  });
});

describe("archery's sounds", () => {
  const base: ArcherySnapshot = archerySnap(archeryState(1));
  const ctx = { viewer: 0 as const, stands: "onlookers" as const, practice: false };
  it("the string creaks as the draw grows, twangs at the release, the arrow thunks louder for a 10", () => {
    const aiming = { ...base, phase: "aim" as const, aim: { ...base.aim, draw: 0.1 } };
    expect(names(archeryCues(aiming, { ...aiming, aim: { ...aiming.aim, draw: 0.6 } }, ctx))).toEqual(["creak"]);
    expect(names(archeryCues(aiming, { ...aiming, phase: "flight" }, ctx))).toEqual(["twang"]);
    const shot = { seat: 0 as const, stage: 0, distance: 10, hit: { x: 0, y: 0 }, points: 10, bullseye: false };
    const cues = archeryCues({ ...base, phase: "flight" }, { ...base, phase: "result", shots: [shot] }, ctx) as Cue[];
    expect(cues.map((c) => c.s)).toEqual(["thunk", "crowd-applause"]);
    expect(cues[0].v).toBe(10);
  });
  it("the wind hums by its strength, from the first snapshot", () => {
    const windy = { ...base, wind: { speed: 6, angle: 0 } };
    expect(archeryCues(null, windy, ctx)).toEqual([{ loop: "wind", v: 1 }]);
    expect(archeryCues(null, { ...base, wind: { speed: 0, angle: 0 } }, ctx)).toEqual([{ loop: "wind", v: 0 }]);
  });
});

describe("track's sounds", () => {
  const base: TrackSnapshot = trackSnap(trackState(1));
  const ctx = { viewer: 0 as const, stands: "sides" as const, practice: false, murmur: 0.2 };
  it("'set', then the gun; footsteps as the server counts them; a hurdle knocked down", () => {
    expect(names(trackCues({ ...base, phase: "over" }, { ...base, phase: "set" }, ctx))).toContain("set");
    expect(names(trackCues(base, { ...base, phase: "running" }, ctx))).toContain("gun");
    const running = { ...base, phase: "running" as const };
    const stepped = { ...running, lanes: [{ ...running.lanes[0], steps: 1, speed: 5 }, running.lanes[1]] as TrackSnapshot["lanes"] };
    expect(names(trackCues(running, stepped, ctx))).toEqual(["loop:murmur", "step"]);
    const hit = { ...running, lanes: [{ ...running.lanes[0], hit: 1 }, running.lanes[1]] as TrackSnapshot["lanes"] };
    expect(names(trackCues(running, hit, ctx))).toContain("hurdle-hit");
  });
  it("the finish roar: the winner's side cheers, the other awws", () => {
    const running = { ...base, phase: "running" as const };
    expect(names(trackCues(running, { ...running, phase: "over", winner: 1 }, ctx)).sort()).toEqual(["crowd-aww", "crowd-cheer", "loop:murmur"]);
  });
});

describe("basketball's sounds", () => {
  const base: BasketballSnapshot = bbSnap(bbState(1));
  const ctx = { viewer: 0 as const, stands: "sides" as const, practice: false, leftSeat: 0 as const };
  it("the rim clanks and the board thuds as the ball touches them; a make swishes and the shooter's side cheers", () => {
    const flight = { ...base, phase: "flight" as const };
    expect(names(basketballCues(flight, { ...flight, contact: { rim: true, board: false } }, ctx))).toEqual(["clank"]);
    expect(names(basketballCues(flight, { ...flight, contact: { rim: false, board: true } }, ctx))).toEqual(["board"]);
    const last = { seat: 0 as const, round: 0, spot: 0, distance: 4.6, made: true, swish: true, rim: false, board: false, points: 3, power: 0.5, aim: 0, window: { lo: 0.4, hi: 0.6 }, suddenDeath: false };
    expect(names(basketballCues(flight, { ...base, phase: "result", last }, ctx))).toEqual(["swish", "crowd-cheer"]);
    expect(names(basketballCues(flight, { ...base, phase: "result", last: { ...last, made: false, swish: false, points: 0 } }, ctx))).toEqual(["crowd-aww"]);
  });
});

describe("bowling's sounds", () => {
  const base: BowlingSnapshot = bowlSnap(bowlState(1));
  const ctx = { viewer: 0 as const, stands: "onlookers" as const, practice: false };
  it("the roll runs while the ball is on the lane, hollow in the gutter; the pins crash by how many; a gutter thuds", () => {
    const aim = { ...base, phase: "aim" as const };
    const roll = { ...base, phase: "roll" as const, bowl: { x: 0, y: 1, gutter: false } };
    expect(bowlingCues(aim, roll, ctx)).toEqual([{ loop: "roll", v: 1, tone: 0 }]);
    expect(bowlingCues(roll, { ...roll, bowl: { x: 0.5, y: 5, gutter: true } }, ctx)).toEqual([{ loop: "roll", v: 1, tone: 1 }]);
    const last = { seat: 0 as const, frame: 0, ball: 0, pins: 10, left: [], strike: true, spare: false, gutter: false, timeout: false, split: false, read: null };
    const cues = bowlingCues(roll, { ...base, phase: "result", last }, ctx);
    expect(names(cues)).toEqual(["loop:roll", "crash", "crowd-applause"]);
    expect((cues[1] as Cue).v).toBe(10);
    expect(names(bowlingCues(roll, { ...base, phase: "result", last: { ...last, pins: 0, strike: false, gutter: true } }, ctx))).toEqual(["loop:roll", "gutter", "crowd-aww"]);
  });
});
