import type { AudioEngine } from "./engine.ts";
import type { AudioSettings } from "./settings.ts";
import "./toggle.css";

// The sound button (task 19): one small round button, in each game's HUD and
// on the home screen beside the profile button. A tap opens a little panel:
// Sound on/off (everything), Effects, Music and the volume. Reachable at both
// viewports; the panel is fixed to the top right and never wider than the
// screen. The choices are saved by the engine (settings.ts).

const ICON_ON = `<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

let uid = 0;

/**
 * Puts the sound button into `host` (before `before`, if given) and returns
 * dispose. Games show the music switch too, so it can be turned off from
 * anywhere.
 */
export function mountSoundToggle(engine: AudioEngine, host: Element, before: Element | null = null): () => void {
  const id = `snd-panel-${++uid}`;
  const wrap = document.createElement("div");
  wrap.className = "snd";
  wrap.innerHTML = `
    <button type="button" class="snd-button" data-action="sound" aria-haspopup="true" aria-expanded="false" aria-controls="${id}"></button>
    <div class="snd-panel" id="${id}" role="group" aria-label="Sound settings" hidden>
      <label class="snd-row"><input type="checkbox" data-snd="sound"> Sound</label>
      <label class="snd-row"><input type="checkbox" data-snd="effects"> Effects and crowd</label>
      <label class="snd-row"><input type="checkbox" data-snd="music"> Music (home screen)</label>
      <label class="snd-row snd-volume">Volume <input type="range" min="0" max="100" step="5" data-snd="volume" aria-label="Volume"></label>
    </div>
  `;
  host.insertBefore(wrap, before);
  const button = wrap.querySelector(".snd-button") as HTMLButtonElement;
  const panel = wrap.querySelector(".snd-panel") as HTMLElement;
  const input = (k: string) => wrap.querySelector(`[data-snd=${k}]`) as HTMLInputElement;

  const render = (s: AudioSettings) => {
    const on = !s.muted;
    button.innerHTML = on ? ICON_ON : ICON_OFF;
    button.setAttribute("aria-label", on ? "Sound on: settings" : "Sound off: settings");
    button.dataset.state = on ? "on" : "off";
    input("sound").checked = on;
    input("effects").checked = s.effects;
    input("music").checked = s.music;
    input("volume").value = String(Math.round(s.volume * 100));
    for (const k of ["effects", "music", "volume"]) input(k).disabled = !on;
  };
  render(engine.settings());
  const off = engine.onChange(render);

  const open = (show: boolean) => {
    panel.hidden = !show;
    button.setAttribute("aria-expanded", String(show));
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    engine.unlock();
    open(panel.hidden !== false);
  });
  // keys typed in the panel are for the panel, not the game (Space mustn't swing)
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      open(false);
      button.focus();
    }
    e.stopPropagation();
  });
  input("sound").addEventListener("change", () => engine.update({ muted: !input("sound").checked }));
  input("effects").addEventListener("change", () => engine.update({ effects: input("effects").checked }));
  input("music").addEventListener("change", () => engine.update({ music: input("music").checked }));
  input("volume").addEventListener("input", () => engine.update({ volume: Number(input("volume").value) / 100 }));
  const outside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) open(false);
  };
  document.addEventListener("pointerdown", outside, true);

  return () => {
    off();
    document.removeEventListener("pointerdown", outside, true);
    wrap.remove();
  };
}
