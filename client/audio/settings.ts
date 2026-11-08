// The sound settings (task 19): one master mute, separate effects and music
// switches, and a master volume. Kept per browser in localStorage behind
// these two functions only, so task 25's account settings can take them over
// later without touching anything else.

export interface AudioSettings {
  /** Everything off: no audio nodes are made at all. */
  muted: boolean;
  /** Game sounds and the crowd. */
  effects: boolean;
  /** The home screen's music. On by default, quiet (user, 2026-11-08). */
  music: boolean;
  /** Master volume, 0..1. */
  volume: number;
}

export const DEFAULT_AUDIO: AudioSettings = { muted: false, effects: true, music: true, volume: 0.8 };

export const AUDIO_KEY = "wl-audio";

/** The saved settings, or the defaults; anything malformed falls back field by field. */
export function loadAudioSettings(storage: Pick<Storage, "getItem"> | null): AudioSettings {
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(AUDIO_KEY) ?? "null");
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof AudioSettings) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_AUDIO[k] as boolean));
  const v = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : DEFAULT_AUDIO.volume;
  return { muted: bool("muted"), effects: bool("effects"), music: bool("music"), volume: v };
}

export function saveAudioSettings(storage: Pick<Storage, "setItem"> | null, s: AudioSettings): void {
  try {
    storage?.setItem(AUDIO_KEY, JSON.stringify(s));
  } catch {
    // private mode or blocked storage: the setting lasts this visit only
  }
}
