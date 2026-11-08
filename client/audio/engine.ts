import { loadAudioSettings, saveAudioSettings } from "./settings.ts";
import type { AudioSettings } from "./settings.ts";

// The one audio engine for the whole page (task 19). It owns the single
// AudioContext, which it makes only inside the first user gesture (browsers
// refuse sound before one) and only if sound isn't muted: muted means no
// audio nodes are made at all. Every sound in every game asks it for an
// output (`fx()` for game sounds and the crowd, `music()` for the home
// screen's music) and makes nothing when it gets null back.
//
// The context is injected, so spec/audio.test.ts runs it against a fake
// that counts the nodes made.

/** Where a sound plays: the context, the bus to connect to, and a shared noise buffer. */
export interface Out {
  ctx: AudioContext;
  dest: AudioNode;
  noise: AudioBuffer;
}

export interface AudioEngine {
  settings(): AudioSettings;
  /** Changes some settings, saves them and tells every listener. */
  update(change: Partial<AudioSettings>): void;
  onChange(fn: (s: AudioSettings) => void): () => void;
  /** True once a user gesture has happened on this page. */
  unlocked(): boolean;
  /** Call inside a user gesture (the engine listens for the first one itself). */
  unlock(): void;
  /** The effects bus, or null when locked, muted or effects are off (then make nothing). */
  fx(): Out | null;
  /** The music bus, or null when locked, muted or music is off. */
  music(): Out | null;
  /** Called when the music may need to start or stop (a gesture, a setting). */
  onMusicChange(fn: () => void): () => void;
  dispose(): void;
}

export interface EngineDeps {
  makeContext: () => AudioContext;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** Where to listen for the first gesture (the window); none in tests. */
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
}

/** The music sits well under the game: on by default but quiet (user, 2026-11-08). */
export const MUSIC_LEVEL = 0.32;

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

export function createAudioEngine(deps: EngineDeps): AudioEngine {
  let s = loadAudioSettings(deps.storage);
  let gestured = false;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let fxBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  const listeners = new Set<(s: AudioSettings) => void>();
  const musicListeners = new Set<() => void>();

  // the context and the buses: made on first use, never while muted or before a gesture
  const ensure = (): boolean => {
    if (!gestured || s.muted) return false;
    if (!ctx) {
      try {
        ctx = deps.makeContext();
        master = ctx.createGain();
        master.gain.value = s.volume;
        master.connect(ctx.destination);
        fxBus = ctx.createGain();
        fxBus.connect(master);
        musicBus = ctx.createGain();
        musicBus.gain.value = MUSIC_LEVEL;
        musicBus.connect(master);
        // two seconds of seeded white noise, shared by every hiss, clap and roar
        const len = Math.floor(ctx.sampleRate * 2);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        let seed = 12345;
        for (let i = 0; i < len; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          d[i] = (seed / 2 ** 32) * 2 - 1;
        }
      } catch {
        ctx = null;
        return false;
      }
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return true;
  };

  const out = (bus: GainNode | null): Out | null => (ctx && bus && noise ? { ctx, dest: bus, noise } : null);

  const onGesture = () => {
    engine.unlock();
  };
  for (const g of GESTURES) deps.events?.addEventListener(g, onGesture, { capture: true } as AddEventListenerOptions);

  const engine: AudioEngine = {
    settings: () => ({ ...s }),
    update(change) {
      s = { ...s, ...change };
      saveAudioSettings(deps.storage, s);
      if (master && ctx) master.gain.setTargetAtTime(s.muted ? 0 : s.volume, ctx.currentTime, 0.03);
      if (fxBus && ctx) fxBus.gain.setTargetAtTime(s.effects ? 1 : 0, ctx.currentTime, 0.03);
      for (const fn of listeners) fn({ ...s });
      for (const fn of musicListeners) fn();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    unlocked: () => gestured,
    unlock() {
      const first = !gestured;
      gestured = true;
      // a context only once there is something to hear
      if (!s.muted && (s.effects || s.music)) ensure();
      if (first) for (const fn of musicListeners) fn();
    },
    fx() {
      if (!s.effects || !ensure()) return null;
      return out(fxBus);
    },
    music() {
      if (!s.music || !ensure()) return null;
      return out(musicBus);
    },
    onMusicChange(fn) {
      musicListeners.add(fn);
      return () => musicListeners.delete(fn);
    },
    dispose() {
      for (const g of GESTURES) deps.events?.removeEventListener(g, onGesture, { capture: true } as AddEventListenerOptions);
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
  return engine;
}
