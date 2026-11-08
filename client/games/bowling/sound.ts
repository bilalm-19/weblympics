// Bowling's sounds (task 29), made in the browser with WebAudio: no files.
// The roll (filtered noise while the ball is on the lane), the pin crash
// (bigger the more pins go), the gutter's hollow thud, and the crowd's cheer
// and groan. Nothing plays until the page has had a user gesture (a key or a
// tap): the AudioContext is only made inside one, as browsers require.

export interface BowlingSound {
  /** Starts the rolling sound, or changes it (`gutter`: hollow and lower). */
  roll(on: boolean, gutter?: boolean): void;
  /** Pins going down; `size` 1..10. */
  crash(size: number): void;
  gutter(): void;
  cheer(big: boolean): void;
  groan(): void;
  dispose(): void;
}

export function createBowlingSound(): BowlingSound {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let rolling: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;

  const unlock = () => {
    if (ctx) return;
    try {
      ctx = new AudioContext();
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
  };
  // the first gesture anywhere on the page makes the sound possible
  const events = ["pointerdown", "keydown"] as const;
  for (const e of events) window.addEventListener(e, unlock, { capture: true });

  /** A burst of filtered noise. */
  const burst = (type: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, at = 0) => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  };

  const tone = (type: OscillatorType, from: number, to: number, peak: number, length: number, at = 0) => {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
  };

  const stopRoll = () => {
    if (!rolling || !ctx) return;
    const { src, gain } = rolling;
    gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
    src.stop(ctx.currentTime + 0.4);
    rolling = null;
  };

  return {
    roll(on, gutter = false) {
      if (!ctx || !noise) return;
      if (!on) return stopRoll();
      if (!rolling) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.1);
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start();
        rolling = { src, filter, gain };
      }
      rolling.filter.frequency.setTargetAtTime(gutter ? 160 : 320, ctx.currentTime, 0.05);
      rolling.filter.Q.value = gutter ? 6 : 1;
    },
    crash(size) {
      const s = Math.min(10, Math.max(1, size)) / 10;
      // the hit, then the pins clattering
      burst("bandpass", 1800, 0.8, 0.25 + 0.5 * s, 0.005, 0.18 + 0.4 * s);
      for (let i = 0; i < 2 + Math.round(6 * s); i++) burst("bandpass", 2400 + Math.random() * 2600, 6, 0.1 + 0.15 * s, 0.003, 0.08, 0.04 + Math.random() * (0.25 + 0.4 * s));
      tone("triangle", 220, 90, 0.2 * s, 0.25);
    },
    gutter() {
      tone("sine", 110, 55, 0.3, 0.35);
      burst("lowpass", 300, 1, 0.2, 0.01, 0.3);
    },
    cheer(big) {
      burst("bandpass", 1200, 0.7, big ? 0.35 : 0.22, 0.25, big ? 1.8 : 1.2);
      burst("bandpass", 2600, 1.2, big ? 0.15 : 0.1, 0.3, big ? 1.5 : 1.0, 0.05);
    },
    groan() {
      tone("sawtooth", 220, 130, 0.08, 0.9);
      tone("sawtooth", 180, 105, 0.06, 0.9, 0.03);
      burst("lowpass", 500, 1, 0.12, 0.2, 0.8);
    },
    dispose() {
      for (const e of events) window.removeEventListener(e, unlock, { capture: true });
      stopRoll();
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
