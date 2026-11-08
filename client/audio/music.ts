import type { AudioEngine, Out } from "./engine.ts";
import { hiss, tone } from "./synth.ts";

// The home screen's music (task 19, user 2026-11-08): a playful jazz loop
// made in the browser, no file. A walking bass, brushed drums and soft piano
// chords over a ii-V-I-VI turnaround in F, swung, at an easy tempo. On by
// default and quiet (the engine's music bus sits well under the effects),
// starting only at the first gesture, fading out into a game and back in on
// return, off with the music button. The notes are a pure function of the
// bar (`jazzBar`, spec/audio.test.ts), and the player only schedules them, so
// a recording could replace `createHomeMusic` without touching the menu.

export const BPM = 112;
const BEAT = 60 / BPM;
/** Swung eighths: the off-beat lands two thirds of the way through the beat. */
const SWING = 2 / 3;
const LOOKAHEAD = 0.25;
const TICK_MS = 60;
const FADE = 1.2;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// Gm7 | C7 | Fmaj7 | D7 (as roots and chord tones, MIDI note numbers)
const CHORDS: { root: number; tones: number[]; voicing: number[] }[] = [
  { root: 43, tones: [43, 46, 50, 53], voicing: [58, 62, 65, 69] }, // Gm7: Bb D F A (9)
  { root: 36, tones: [36, 40, 43, 46], voicing: [58, 62, 64, 69] }, // C7: Bb D E A (13)
  { root: 41, tones: [41, 45, 48, 52], voicing: [57, 60, 64, 67] }, // Fmaj7: A C E G (9)
  { root: 38, tones: [38, 42, 45, 48], voicing: [54, 57, 60, 64] }, // D7: F# A C E (9)
];

export interface JazzBar {
  /** One bass note per beat (MIDI). */
  bass: number[];
  /** The piano's chord (MIDI) and the beats it is struck on (fractions are swung off-beats). */
  chord: number[];
  comp: number[];
}

/**
 * Bar `i` of the loop: the bass walks root, chord tones, then a chromatic
 * step into the next bar's root; the piano comps on a few swung off-beats,
 * a different pattern each bar of the four-bar phrase.
 */
export function jazzBar(i: number): JazzBar {
  const n = CHORDS.length;
  const c = CHORDS[((i % n) + n) % n];
  const next = CHORDS[(((i + 1) % n) + n) % n];
  // the approach: a semitone above or below the next root, alternating by phrase
  const approach = next.root + (Math.floor(i / n) % 2 === 0 ? -1 : 1);
  const walk = i % 2 === 0 ? [c.tones[0], c.tones[1], c.tones[2], approach] : [c.tones[0], c.tones[2], c.tones[3], approach];
  const COMPS = [[1 + SWING, 3], [0, 2 + SWING], [1 + SWING, 3 + SWING], [0 + SWING, 2]];
  return { bass: walk, chord: c.voicing, comp: COMPS[((i % 4) + 4) % 4] };
}

export interface HomeMusic {
  /** The home screen is showing: play (once a gesture and the settings allow). */
  start(): void;
  /** Leaving the home screen: fade out. */
  stop(): void;
  /** True while notes are being scheduled. */
  playing(): boolean;
  dispose(): void;
}

export function createHomeMusic(engine: AudioEngine): HomeMusic {
  let wanted = false;
  let timer = 0;
  let bus: GainNode | null = null;
  let out: Out | null = null;
  let nextBar = 0;
  let barAt = 0;

  const scheduleBar = (o: Out, dest: AudioNode, i: number, t: number) => {
    const bar = jazzBar(i);
    const at = (beat: number) => t + Math.floor(beat) * BEAT + (beat % 1 ? BEAT * SWING : 0) - o.ctx.currentTime;
    // walking bass: a round plucked tone per beat
    bar.bass.forEach((note, b) => {
      tone(o, dest, { type: "triangle", from: hz(note), peak: 0.32, attack: 0.01, length: BEAT * 0.9, delay: at(b) });
      tone(o, dest, { type: "sine", from: hz(note + 12), peak: 0.08, attack: 0.005, length: BEAT * 0.3, delay: at(b) });
    });
    // brushes: a soft sweep on every beat, a tap on the swung off-beats of 2 and 4, a ride-ish tick
    for (let b = 0; b < 4; b++) {
      hiss(o, dest, { type: "bandpass", from: 3500, to: 2500, q: 0.7, peak: b % 2 ? 0.05 : 0.03, attack: 0.06, length: BEAT * 0.8, delay: at(b) });
      hiss(o, dest, { type: "highpass", from: 6000, q: 0.5, peak: 0.025, attack: 0.002, length: 0.08, delay: at(b) });
      if (b % 2) hiss(o, dest, { type: "highpass", from: 6500, q: 0.5, peak: 0.02, attack: 0.002, length: 0.06, delay: at(b + 0.5) });
    }
    // piano: a soft chord, each note a sine with a quick bright edge
    for (const beat of bar.comp) {
      for (const note of bar.chord) {
        tone(o, dest, { type: "sine", from: hz(note), peak: 0.045, attack: 0.008, length: BEAT * 1.1, delay: at(beat) });
        tone(o, dest, { type: "triangle", from: hz(note), peak: 0.015, attack: 0.004, length: BEAT * 0.25, delay: at(beat) });
      }
    }
  };

  const halt = () => {
    clearInterval(timer);
    timer = 0;
  };

  const fadeOut = () => {
    if (bus && out) {
      const t = out.ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.0001, t + FADE);
      const b = bus;
      setTimeout(() => b.disconnect(), FADE * 1000 + 600);
    }
    bus = null;
    out = null;
    halt();
  };

  const tick = () => {
    const o = engine.music();
    if (!o || !wanted) return fadeOut();
    if (!bus || out?.ctx !== o.ctx) {
      // a fresh start: fade in from silence, a beat from now
      out = o;
      bus = o.ctx.createGain();
      bus.gain.setValueAtTime(0.0001, o.ctx.currentTime);
      bus.gain.linearRampToValueAtTime(1, o.ctx.currentTime + FADE);
      bus.connect(o.dest);
      barAt = o.ctx.currentTime + 0.1;
    }
    while (barAt < o.ctx.currentTime + LOOKAHEAD) {
      scheduleBar(o, bus, nextBar, barAt);
      nextBar++;
      barAt += BEAT * 4;
    }
  };

  const refresh = () => {
    if (wanted && engine.music()) {
      if (!timer) {
        tick();
        timer = window.setInterval(tick, TICK_MS);
      }
    } else if (timer || bus) fadeOut();
  };
  const off = engine.onMusicChange(refresh);

  return {
    start() {
      wanted = true;
      refresh();
    },
    stop() {
      wanted = false;
      refresh();
    },
    playing: () => timer !== 0,
    dispose() {
      off();
      wanted = false;
      fadeOut();
    },
  };
}
