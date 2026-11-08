import type { Out } from "./engine.ts";

// The building blocks every synthesised sound is made of (task 19): a burst
// of filtered noise, a tone with an envelope, a clap train and a panner.
// Each takes the engine's `Out` (context, bus, shared noise), so nothing here
// makes a node unless the engine handed one out: muted or before a gesture,
// the callers get null and never reach these.

export interface Place {
  /** -1 left .. 1 right. */
  pan?: number;
  /** Multiplies the sound's own level. */
  gain?: number;
  /** Seconds from now. */
  delay?: number;
}

/** The node a sound connects to: a gain (and a panner when panned), into the bus. */
export function voice(o: Out, place: Place = {}): AudioNode {
  const g = o.ctx.createGain();
  g.gain.value = place.gain ?? 1;
  const pan = place.pan ?? 0;
  if (Math.abs(pan) > 0.01 && typeof o.ctx.createStereoPanner === "function") {
    const p = o.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(o.dest);
  } else g.connect(o.dest);
  return g;
}

export interface HissOpts {
  type: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  peak: number;
  attack: number;
  length: number;
  delay?: number;
}

/** A burst of filtered noise with an attack and an exponential fall. */
export function hiss(o: Out, dest: AudioNode, h: HissOpts): void {
  const t = o.ctx.currentTime + (h.delay ?? 0);
  const src = o.ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  const f = o.ctx.createBiquadFilter();
  f.type = h.type;
  f.Q.value = h.q ?? 1;
  f.frequency.setValueAtTime(h.from, t);
  if (h.to && h.to !== h.from) f.frequency.exponentialRampToValueAtTime(h.to, t + h.length);
  const g = o.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, h.peak), t + Math.max(0.002, h.attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(h.attack + 0.01, h.length));
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + h.length + 0.05);
}

export interface ToneOpts {
  type: OscillatorType;
  from: number;
  to?: number;
  peak: number;
  attack?: number;
  length: number;
  delay?: number;
  detune?: number;
}

/** A tone that rises in `attack` and falls away by `length`, optionally gliding. */
export function tone(o: Out, dest: AudioNode, t0: ToneOpts): void {
  const t = o.ctx.currentTime + (t0.delay ?? 0);
  const osc = o.ctx.createOscillator();
  osc.type = t0.type;
  osc.frequency.setValueAtTime(t0.from, t);
  if (t0.to && t0.to !== t0.from) osc.frequency.exponentialRampToValueAtTime(t0.to, t + t0.length);
  if (t0.detune) osc.detune.value = t0.detune;
  const g = o.ctx.createGain();
  const a = t0.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, t0.peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, t0.length));
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + t0.length + 0.05);
}

/**
 * Applause: one noise source per layer through a band filter, its gain
 * scheduled as a train of sharp claps at about `rate` a second each, so a
 * whole crowd clapping costs a few nodes rather than one per clap.
 */
export function clapTrain(o: Out, dest: AudioNode, opts: { layers: number; rate: number; peak: number; length: number; delay?: number; rand?: () => number }): void {
  const rand = opts.rand ?? Math.random;
  const t0 = o.ctx.currentTime + (opts.delay ?? 0);
  for (let l = 0; l < opts.layers; l++) {
    const src = o.ctx.createBufferSource();
    src.buffer = o.noise;
    src.loop = true;
    const f = o.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1100 + l * 450 + rand() * 300;
    f.Q.value = 1.2;
    const g = o.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    let t = t0 + rand() * 0.08;
    while (t < t0 + opts.length) {
      // the applause thins out towards its end
      const fade = 1 - ((t - t0) / opts.length) ** 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.peak * fade * (0.6 + 0.4 * rand())), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      t += (1 / opts.rate) * (0.55 + rand() * 0.9);
    }
    src.connect(f).connect(g).connect(dest);
    src.start(t0, rand());
    src.stop(t0 + opts.length + 0.1);
  }
}

/** A struck metal bell: a few inharmonic partials ringing down. */
export function bell(o: Out, dest: AudioNode, hz: number, peak: number, length: number, delay = 0): void {
  for (const [ratio, share] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]] as const) {
    tone(o, dest, { type: "sine", from: hz * ratio, peak: peak * share, attack: 0.002, length: length / Math.sqrt(ratio), delay });
  }
}
