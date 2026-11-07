// Basketball's sounds (task 32), made in the browser with WebAudio: no files.
// A swish (filtered noise falling away), a rim clank (two detuned metal
// tones), a board thud (a low knock), the crowd's cheer (a swell of noise
// with a few whistles) and its groan (a falling hum). Nothing plays until
// `unlock()` runs inside a user gesture (a key, a click, a touch), as
// browsers require; before that every call is silent.

export interface Sounds {
  /** Call from a user gesture; creates or resumes the audio context. */
  unlock(): void;
  swish(): void;
  clank(): void;
  thud(): void;
  cheer(big: boolean): void;
  groan(): void;
  dispose(): void;
}

export function createSounds(): Sounds {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;

  const ready = (): AudioContext | null => (ctx && ctx.state === "running" ? ctx : null);
  const noiseBuffer = (c: AudioContext): AudioBuffer => {
    if (noise) return noise;
    const len = Math.floor(c.sampleRate * 2);
    noise = c.createBuffer(1, len, c.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      d[i] = (seed / 2 ** 32) * 2 - 1;
    }
    return noise;
  };

  /** A burst of filtered noise with an envelope. */
  const hiss = (c: AudioContext, opts: { type: BiquadFilterType; from: number; to: number; q: number; gain: number; attack: number; length: number; delay?: number }) => {
    const t = c.currentTime + (opts.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = opts.type;
    f.Q.value = opts.q;
    f.frequency.setValueAtTime(opts.from, t);
    f.frequency.exponentialRampToValueAtTime(opts.to, t + opts.length);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.length);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random());
    src.stop(t + opts.length + 0.05);
  };

  const tone = (c: AudioContext, hz: number, type: OscillatorType, gain: number, length: number, delay = 0, slideTo?: number) => {
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + length);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + length + 0.05);
  };

  const safely = (play: (c: AudioContext) => void) => () => {
    const c = ready();
    if (!c) return;
    try {
      play(c);
    } catch {
      // no sound is fine
    }
  };

  return {
    unlock() {
      try {
        ctx ??= new AudioContext();
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        ctx = null;
      }
    },
    swish: safely((c) => hiss(c, { type: "bandpass", from: 5200, to: 1800, q: 0.9, gain: 0.22, attack: 0.02, length: 0.35 })),
    clank: safely((c) => {
      tone(c, 523, "square", 0.06, 0.25);
      tone(c, 787, "triangle", 0.08, 0.35);
      tone(c, 1210, "sine", 0.05, 0.18);
    }),
    thud: safely((c) => {
      tone(c, 140, "sine", 0.3, 0.16, 0, 70);
      hiss(c, { type: "lowpass", from: 900, to: 200, q: 0.7, gain: 0.12, attack: 0.005, length: 0.12 });
    }),
    cheer: (big: boolean) =>
      safely((c) => {
        hiss(c, { type: "bandpass", from: 900, to: 1400, q: 0.5, gain: big ? 0.28 : 0.16, attack: 0.25, length: big ? 2.4 : 1.5 });
        if (big) for (const [hz, d] of [[1800, 0.2], [2100, 0.6], [1700, 1.0]] as const) tone(c, hz, "sine", 0.03, 0.35, d, hz * 1.25);
      })(),
    groan: safely((c) => {
      hiss(c, { type: "lowpass", from: 700, to: 260, q: 1.2, gain: 0.14, attack: 0.15, length: 1.2 });
      tone(c, 220, "sawtooth", 0.03, 1.0, 0.05, 140);
    }),
    dispose() {
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
