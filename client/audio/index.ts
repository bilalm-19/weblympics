import { createAudioEngine } from "./engine.ts";
import type { AudioEngine } from "./engine.ts";
import { createHomeMusic } from "./music.ts";
import type { HomeMusic } from "./music.ts";
import { createSoundPlayer } from "./sounds.ts";
import type { SoundPlayer } from "./sounds.ts";

// The page's one audio engine and the home music (task 19), made on first
// use. Games get a player with `gameSounds()`; the menu starts and stops the
// music; every screen mounts the toggle (toggle.ts).

let engine: AudioEngine | null = null;
let music: HomeMusic | null = null;

export function audioEngine(): AudioEngine {
  engine ??= createAudioEngine({
    makeContext: () => new AudioContext(),
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
    events: window,
  });
  return engine;
}

/** A sound player for one game view; dispose it with the view. */
export function gameSounds(): SoundPlayer {
  return createSoundPlayer(audioEngine());
}

export function homeMusic(): HomeMusic {
  music ??= createHomeMusic(audioEngine());
  return music;
}

export { mountSoundToggle } from "./toggle.ts";
