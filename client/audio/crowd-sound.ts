import type { Out } from "./engine.ts";
import { clapTrain, hiss, tone } from "./synth.ts";

// The crowd's voice (task 19): a cheer (a roar swell with whistles and
// claps), an "aww" (a falling vowel-ish hum under a soft groan of noise) and
// applause (layered clap trains). Synthesised for now (user, 2026-11-08:
// "start synthesised, judge it by ear"); this file is the one piece to
// replace with a few CC0 clips later: keep the three signatures and nothing
// else changes. `size` 0..3 is how big the moment is; `dest` is already
// panned and weighted for where that side's stand is on this screen.

export function crowdCheer(o: Out, dest: AudioNode, size: number): void {
  const k = 0.55 + 0.15 * size;
  const length = 1.3 + 0.55 * size;
  // the roar: a broad swell of voices, brighter the bigger the moment
  hiss(o, dest, { type: "bandpass", from: 700, to: 900 + 250 * size, q: 0.6, peak: 0.22 * k, attack: 0.18, length });
  hiss(o, dest, { type: "bandpass", from: 1800, to: 2300, q: 1.1, peak: 0.08 * k, attack: 0.25, length: length * 0.85, delay: 0.05 });
  // clapping under it
  clapTrain(o, dest, { layers: 1 + Math.min(2, size), rate: 9, peak: 0.12 * k, length: length * 0.9, delay: 0.1 });
  // a whistle or two for a game, more for a set or the match
  const whistles = size >= 1 ? size + 1 : 0;
  for (let i = 0; i < whistles; i++) {
    const hz = 1700 + ((i * 397) % 600);
    tone(o, dest, { type: "sine", from: hz, to: hz * 1.3, peak: 0.025, attack: 0.03, length: 0.3, delay: 0.25 + i * 0.37 });
  }
}

export function crowdAww(o: Out, dest: AudioNode, size: number): void {
  const k = 0.6 + 0.15 * size;
  const length = 1.0 + 0.3 * size;
  // "aww": a few voices sliding down together, softened, and a groan of breath
  for (const [hz, detune] of [[330, 0], [262, 12], [392, -9]] as const) {
    tone(o, dest, { type: "triangle", from: hz, to: hz * 0.72, peak: 0.035 * k, attack: 0.12, length, detune });
  }
  hiss(o, dest, { type: "lowpass", from: 900, to: 320, q: 1.4, peak: 0.12 * k, attack: 0.12, length: length * 1.1 });
}

export function crowdApplause(o: Out, dest: AudioNode, size: number): void {
  const k = 0.5 + 0.2 * size;
  clapTrain(o, dest, { layers: 2 + Math.min(2, size), rate: 7, peak: 0.13 * k, length: 1.4 + 0.5 * size });
}
