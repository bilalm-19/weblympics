import type { AudioEngine, Out } from "./engine.ts";
import type { CrowdVoice } from "./crowd.ts";
import { crowdApplause, crowdAww, crowdCheer } from "./crowd-sound.ts";
import { bell, clapTrain, hiss, tone, voice } from "./synth.ts";

// Every game's sounds (task 19), by name, each a small recipe on the shared
// synth pieces. A game never makes a sound itself: its pure cue function
// (client/games/<name>/sound.ts) turns two snapshots into a list of cues,
// and the player here plays them, only if the engine hands out an output
// (after a gesture, not muted, effects on). Any recipe can be swapped for a
// recorded clip later without touching a game.

export type SoundName =
  // tennis
  | "swing"
  | "hit"
  | "bounce"
  | "net"
  | "out"
  | "fault"
  // boxing
  | "glove"
  | "glove-blocked"
  | "slip"
  | "bell"
  | "ko-bell"
  // archery
  | "creak"
  | "twang"
  | "thunk"
  | "arrow-miss"
  // track
  | "set"
  | "gun"
  | "step"
  | "hurdle-hit"
  // basketball
  | "swish"
  | "clank"
  | "board"
  // bowling
  | "crash"
  | "gutter"
  // the crowd
  | "crowd-cheer"
  | "crowd-aww"
  | "crowd-applause"
  | "gasp";

export interface Cue {
  s: SoundName;
  /** The sound's own amount: a hit's strength 0..2, a crowd's size 0..3, pins 1..10, ring points. */
  v?: number;
  /** -1 left .. 1 right. */
  pan?: number;
  /** Level, 1 by default. */
  gain?: number;
}

/** Sounds that run on while something lasts: the bowling ball rolling, archery's wind, track's crowd murmur. */
export type LoopName = "roll" | "wind" | "murmur";
export interface LoopCue {
  loop: LoopName;
  /** 0 stops it; above 0 its level (0..1). */
  v: number;
  /** A loop's colour: the roll's gutter (1) or lane (0). */
  tone?: number;
}

export type AnyCue = Cue | LoopCue;

export const isLoop = (c: AnyCue): c is LoopCue => "loop" in c;

/** A crowd voice as a cue. */
export function crowdCue(v: CrowdVoice): Cue {
  const s: SoundName = v.kind === "cheer" ? "crowd-cheer" : v.kind === "aww" ? "crowd-aww" : "crowd-applause";
  return { s, v: v.size, pan: v.pan, gain: v.gain };
}

type Recipe = (o: Out, dest: AudioNode, v: number) => void;

const RECIPES: Record<SoundName, Recipe> = {
  // ---- tennis ----
  // the racket through the air: a quick rising then falling breath
  swing: (o, d, v) => hiss(o, d, { type: "bandpass", from: 500 + 250 * v, to: 2400 + 500 * v, q: 1.6, peak: 0.08 + 0.04 * v, attack: 0.06, length: 0.18 }),
  // strings on the ball: a hollow pop, higher and sharper the harder
  hit: (o, d, v) => {
    tone(o, d, { type: "triangle", from: 420 + v * 160, to: 140, peak: 0.22 + 0.06 * v, length: 0.08 });
    hiss(o, d, { type: "bandpass", from: 2200 + v * 600, q: 2, peak: 0.12 + 0.05 * v, attack: 0.002, length: 0.05 });
  },
  bounce: (o, d) => {
    tone(o, d, { type: "sine", from: 190, to: 90, peak: 0.16, length: 0.07 });
    hiss(o, d, { type: "lowpass", from: 1200, q: 0.7, peak: 0.05, attack: 0.002, length: 0.04 });
  },
  // the ball into the tape: a dull flap of cloth
  net: (o, d) => {
    hiss(o, d, { type: "lowpass", from: 700, to: 250, q: 3, peak: 0.25, attack: 0.004, length: 0.22 });
    tone(o, d, { type: "sine", from: 110, to: 70, peak: 0.18, length: 0.2 });
  },
  // the line judge: "out" is a falling two-note call
  out: (o, d) => {
    tone(o, d, { type: "square", from: 660, peak: 0.05, length: 0.16 });
    tone(o, d, { type: "square", from: 440, peak: 0.05, length: 0.24, delay: 0.16 });
  },
  // a fault: one short umpire's whistle
  fault: (o, d) => tone(o, d, { type: "sine", from: 2100, to: 1900, peak: 0.07, attack: 0.02, length: 0.32 }),

  // ---- boxing ----
  glove: (o, d, v) => {
    tone(o, d, { type: "sine", from: 150 + 30 * v, to: 60, peak: 0.4, length: 0.12 });
    hiss(o, d, { type: "lowpass", from: 2200, to: 500, q: 0.8, peak: 0.25, attack: 0.002, length: 0.09 });
  },
  // blocked: duller, on the arms
  "glove-blocked": (o, d) => {
    tone(o, d, { type: "sine", from: 110, to: 55, peak: 0.25, length: 0.1 });
    hiss(o, d, { type: "lowpass", from: 700, to: 200, q: 0.8, peak: 0.12, attack: 0.002, length: 0.08 });
  },
  slip: (o, d) => hiss(o, d, { type: "bandpass", from: 1600, to: 500, q: 1.4, peak: 0.1, attack: 0.03, length: 0.22 }),
  bell: (o, d) => bell(o, d, 880, 0.22, 1.6),
  "ko-bell": (o, d) => {
    bell(o, d, 880, 0.24, 1.2);
    bell(o, d, 880, 0.24, 1.6, 0.28);
  },

  // ---- archery ----
  // the string tightening: a few dry ticks, more as the draw grows
  creak: (o, d, v) => {
    for (let i = 0; i < 3; i++) hiss(o, d, { type: "bandpass", from: 900 + 500 * v, q: 8, peak: 0.05, attack: 0.002, length: 0.03, delay: i * 0.035 });
  },
  twang: (o, d, v) => {
    tone(o, d, { type: "triangle", from: 180 + 60 * v, to: 120, peak: 0.25, length: 0.35 });
    tone(o, d, { type: "sawtooth", from: 360 + 120 * v, to: 240, peak: 0.05, length: 0.2 });
    hiss(o, d, { type: "highpass", from: 3000, q: 0.7, peak: 0.06, attack: 0.004, length: 0.4, delay: 0.02 });
  },
  // into the boss: louder and sharper for a 10 or the bullseye (v is the ring points)
  thunk: (o, d, v) => {
    const k = v >= 10 ? 1.4 : 0.8 + 0.04 * v;
    tone(o, d, { type: "sine", from: 140, to: 70, peak: 0.3 * k, length: 0.14 });
    hiss(o, d, { type: "lowpass", from: 1800, to: 400, q: 0.9, peak: 0.12 * k, attack: 0.002, length: 0.1 });
  },
  "arrow-miss": (o, d) => hiss(o, d, { type: "lowpass", from: 600, to: 200, q: 0.8, peak: 0.08, attack: 0.004, length: 0.15 }),

  // ---- track ----
  // "set": the starter's short low call
  set: (o, d) => {
    tone(o, d, { type: "triangle", from: 196, to: 180, peak: 0.12, attack: 0.03, length: 0.35 });
    hiss(o, d, { type: "bandpass", from: 3000, q: 4, peak: 0.03, attack: 0.002, length: 0.06 });
  },
  gun: (o, d) => {
    hiss(o, d, { type: "lowpass", from: 5000, to: 600, q: 0.5, peak: 0.6, attack: 0.001, length: 0.35 });
    tone(o, d, { type: "sine", from: 120, to: 40, peak: 0.45, length: 0.25 });
  },
  // a spike on the track: v 0..1 how fast (higher and firmer at speed)
  step: (o, d, v) => {
    hiss(o, d, { type: "bandpass", from: 1400 + 800 * v, q: 1.5, peak: 0.05 + 0.04 * v, attack: 0.002, length: 0.04 });
    tone(o, d, { type: "sine", from: 90, to: 60, peak: 0.07, length: 0.05 });
  },
  "hurdle-hit": (o, d) => {
    tone(o, d, { type: "square", from: 300, to: 150, peak: 0.06, length: 0.15 });
    hiss(o, d, { type: "bandpass", from: 1200, q: 2, peak: 0.12, attack: 0.002, length: 0.2 });
  },

  // ---- basketball ----
  swish: (o, d) => hiss(o, d, { type: "bandpass", from: 5200, to: 1800, q: 0.9, peak: 0.2, attack: 0.02, length: 0.35 }),
  clank: (o, d) => {
    tone(o, d, { type: "square", from: 523, peak: 0.05, length: 0.25 });
    tone(o, d, { type: "triangle", from: 787, peak: 0.07, length: 0.35 });
    tone(o, d, { type: "sine", from: 1210, peak: 0.04, length: 0.18 });
  },
  board: (o, d) => {
    tone(o, d, { type: "sine", from: 140, to: 70, peak: 0.28, length: 0.16 });
    hiss(o, d, { type: "lowpass", from: 900, to: 200, q: 0.7, peak: 0.1, attack: 0.005, length: 0.12 });
  },

  // ---- bowling ----
  // pins going down, bigger the more (v 1..10)
  crash: (o, d, v) => {
    const s = Math.min(10, Math.max(1, v)) / 10;
    hiss(o, d, { type: "bandpass", from: 1800, q: 0.8, peak: 0.2 + 0.4 * s, attack: 0.005, length: 0.18 + 0.4 * s });
    clapTrain(o, d, { layers: 1 + Math.round(2 * s), rate: 14, peak: 0.12 + 0.12 * s, length: 0.25 + 0.4 * s });
    tone(o, d, { type: "triangle", from: 220, to: 90, peak: 0.18 * s, length: 0.25 });
  },
  gutter: (o, d) => {
    tone(o, d, { type: "sine", from: 110, to: 55, peak: 0.28, length: 0.35 });
    hiss(o, d, { type: "lowpass", from: 300, q: 1, peak: 0.16, attack: 0.01, length: 0.3 });
  },

  // ---- the crowd (crowd-sound.ts is the swappable piece) ----
  "crowd-cheer": (o, d, v) => crowdCheer(o, d, v),
  "crowd-aww": (o, d, v) => crowdAww(o, d, v),
  "crowd-applause": (o, d, v) => crowdApplause(o, d, v),
  // a soft intake of breath from the stands (a fault)
  gasp: (o, d) => hiss(o, d, { type: "bandpass", from: 1200, to: 1700, q: 0.9, peak: 0.06, attack: 0.05, length: 0.4 }),
};

/** Small crowd moments (a jab, a plain basket) at most this often, so they never wash together. */
export const SMALL_CROWD_GAP_MS = 700;

export interface SoundPlayer {
  play(cues: AnyCue[]): void;
  /** Stops every running loop (leaving the game). */
  stopLoops(): void;
  dispose(): void;
}

interface Running {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  ctx: AudioContext;
}

export function createSoundPlayer(engine: AudioEngine, now: () => number = () => performance.now()): SoundPlayer {
  const loops = new Map<LoopName, Running>();
  const lastSmall = new Map<string, number>();

  const setLoop = (c: LoopCue) => {
    const running = loops.get(c.loop);
    if (c.v <= 0) {
      if (running) {
        running.gain.gain.setTargetAtTime(0.0001, running.ctx.currentTime, 0.08);
        running.src.stop(running.ctx.currentTime + 0.5);
        loops.delete(c.loop);
      }
      return;
    }
    let r = running;
    if (!r) {
      const o = engine.fx();
      if (!o) return;
      const src = o.ctx.createBufferSource();
      src.buffer = o.noise;
      src.loop = true;
      const filter = o.ctx.createBiquadFilter();
      const gain = o.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, o.ctx.currentTime);
      src.connect(filter).connect(gain).connect(o.dest);
      src.start();
      r = { src, filter, gain, ctx: o.ctx };
      loops.set(c.loop, r);
    }
    const t = r.ctx.currentTime;
    const v = Math.min(1, c.v);
    if (c.loop === "roll") {
      r.filter.type = "lowpass";
      r.filter.frequency.setTargetAtTime(c.tone ? 160 : 320, t, 0.05);
      r.filter.Q.value = c.tone ? 6 : 1;
      r.gain.gain.setTargetAtTime(0.16 * v, t, 0.1);
    } else if (c.loop === "wind") {
      r.filter.type = "bandpass";
      r.filter.Q.value = 0.8;
      r.filter.frequency.setTargetAtTime(300 + 500 * v, t, 0.4);
      r.gain.gain.setTargetAtTime(0.02 + 0.08 * v, t, 0.4);
    } else {
      r.filter.type = "bandpass";
      r.filter.Q.value = 0.5;
      r.filter.frequency.setTargetAtTime(600 + 500 * v, t, 0.2);
      r.gain.gain.setTargetAtTime(0.015 + 0.12 * v, t, 0.2);
    }
  };

  const stopLoops = () => {
    for (const name of [...loops.keys()]) setLoop({ loop: name, v: 0 });
  };

  return {
    play(cues) {
      for (const c of cues) {
        if (isLoop(c)) {
          setLoop(c);
          continue;
        }
        // a small crowd moment right after another of its kind is dropped
        if (c.s.startsWith("crowd-") && (c.v ?? 0) === 0) {
          const key = `${c.s}:${Math.sign(c.pan ?? 0)}`;
          const t = now();
          if (t - (lastSmall.get(key) ?? -Infinity) < SMALL_CROWD_GAP_MS) continue;
          lastSmall.set(key, t);
        }
        const o = engine.fx();
        if (!o) return;
        try {
          RECIPES[c.s](o, voice(o, { pan: c.pan, gain: c.gain }), c.v ?? 0);
        } catch {
          // no sound is fine
        }
      }
    },
    stopLoops,
    dispose: stopLoops,
  };
}
