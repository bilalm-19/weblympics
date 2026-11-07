// The room's ready panel (task 4): who is in, who is ready, the host's
// format, a camera check and the safety notice. It only shows the server's
// room state (`lobby` messages) and sends `ready` / `format` requests; the
// server decides. Hidden in practice (the bot is always ready) and once the
// match is playing.
import type { LobbyView, RoomFormat } from "../../../shared/protocol.ts";
import "./ready-panel.css";

export const FORMAT_LABELS: Record<RoomFormat, string> = {
  oneSet: "One set",
  bestOfThree: "Best of three",
  stages: "Eight stages",
  race: "Race",
  bout: "Bout",
  game: "Five frames",
  unlimited: "Unlimited",
};

const FORMAT_NOTES: Record<RoomFormat, string> = {
  oneSet: "First to six games, tiebreak at 6-6.",
  bestOfThree: "First to two sets.",
  stages: "One arrow each per stage, 10 m to 50 m, the wind getting stronger. Highest total wins.",
  race: "One 100 m sprint, first across the line wins.",
  bout: "Three rounds of 30 seconds. A knockout wins at once, else the most damage dealt; a tie is a draw.",
  game: "Five frames each, real ten-pin scoring. Highest total wins; a tie is a draw unless you both play on.",
  unlimited: "Play as long as you like; points and best rally are counted. No winner, not rated.",
};

// archery's unlimited counts arrows, not rallies
const UNLIMITED_ARCHERY = "Random distance and wind every stage, as long as you like; points and best arrow are counted. No winner, not rated.";
// track's unlimited runs race after race
const UNLIMITED_TRACK = "Race after race, as long as you like; races won and best times are counted. No winner, not rated.";
// boxing's unlimited boxes bout after bout
const UNLIMITED_BOXING = "Bout after bout, as long as you like; bouts won and knockouts are counted. No winner, not rated.";

export interface ReadyPanel {
  update(view: LobbyView): void;
  /** Whether the camera is running and sees the player (for "camera OK"). */
  camera(state: "off" | "on" | "ok"): void;
  dispose(): void;
}

export interface ReadyCallbacks {
  ready(ready: boolean): void;
  format(format: RoomFormat): void;
  /** Task 7: the host's "rated" option. */
  rated(rated: boolean): void;
  /** Opens the camera setup (the same as the HUD's Camera button). */
  openCamera(): void;
}

/** `seat`: this viewer's seat, null for a spectator. `formats`: the ones the room's game offers (`GameDef.formats`). */
export function createReadyPanel(
  parent: HTMLElement,
  seat: 0 | 1 | null,
  room: string,
  cb: ReadyCallbacks,
  formats: readonly RoomFormat[] = ["oneSet", "bestOfThree", "unlimited"],
): ReadyPanel {
  const notes = {
    ...FORMAT_NOTES,
    ...(formats.includes("stages") ? { unlimited: UNLIMITED_ARCHERY } : {}),
    ...(formats.includes("race") ? { unlimited: UNLIMITED_TRACK } : {}),
    ...(formats.includes("bout") ? { unlimited: UNLIMITED_BOXING } : {}),
  };
  const el = document.createElement("section");
  el.className = "ready-panel";
  el.setAttribute("aria-label", "Match setup");
  el.hidden = true;
  el.innerHTML = `
    <h2 class="rp-title"></h2>
    <ul class="rp-seats"></ul>
    <fieldset class="rp-format">
      <legend>Format</legend>
      <div class="rp-options" role="radiogroup" aria-label="Match format">
        ${formats.map((f) => `<button type="button" role="radio" data-format="${f}">${FORMAT_LABELS[f]}</button>`).join("")}
      </div>
      <p class="rp-note"></p>
      <label class="rp-rated">
        <input type="checkbox" role="switch" class="rp-rated-input" />
        <span>Rated match</span>
      </label>
      <p class="rp-rated-note"></p>
    </fieldset>
    <div class="rp-camera" data-seated>
      <span class="rp-cam-state" role="status"></span>
      <button type="button" data-action="rp-camera">Set up camera</button>
    </div>
    <details class="rp-safety" data-seated>
      <summary>Before you swing</summary>
      <ul>
        <li>Clear the space around you, about 1 m from the screen.</li>
        <li>Hold nothing; tie back hair, remove loose jewellery.</li>
        <li>Don't swing at full force. Stop if anything hurts.</li>
      </ul>
    </details>
    <p class="rp-hint" role="status" aria-live="polite"></p>
    <button type="button" class="primary rp-ready" data-seated></button>
  `;
  parent.append(el);

  // Sits below the HUD and below the camera preview when it is above the
  // panel's column (a phone), and above the swing buttons: measured, since
  // the preview's height depends on the camera.
  const place = () => {
    if (el.hidden) return;
    const box = (sel: string) => parent.querySelector(sel)?.getBoundingClientRect() ?? null;
    const p = parent.getBoundingClientRect();
    const me = el.getBoundingClientRect();
    let top = box(".hud")?.bottom ?? p.top;
    const dock = box(".cam-dock");
    if (dock && dock.height > 0 && dock.left < me.right && me.left < dock.right) top = Math.max(top, dock.bottom);
    const controls = box(".controls");
    const bottom = controls && controls.height > 0 ? controls.top : p.bottom;
    el.style.top = `${Math.round(top - p.top + 8)}px`;
    el.style.maxHeight = `${Math.max(120, Math.round(bottom - top - 16))}px`;
  };
  const observer = new ResizeObserver(place);
  for (const sel of [".hud", ".cam-dock"]) {
    const node = parent.querySelector(sel);
    if (node) observer.observe(node);
  }
  observer.observe(parent);

  const title = el.querySelector(".rp-title") as HTMLElement;
  const seatsEl = el.querySelector(".rp-seats") as HTMLElement;
  const note = el.querySelector(".rp-note") as HTMLElement;
  const readyBtn = el.querySelector(".rp-ready") as HTMLButtonElement;
  const hint = el.querySelector(".rp-hint") as HTMLElement;
  const camState = el.querySelector(".rp-cam-state") as HTMLElement;
  const formatButtons = [...el.querySelectorAll<HTMLButtonElement>("[data-format]")];
  const ratedInput = el.querySelector(".rp-rated-input") as HTMLInputElement;
  const ratedNote = el.querySelector(".rp-rated-note") as HTMLElement;
  ratedInput.addEventListener("change", () => cb.rated(ratedInput.checked));
  for (const node of el.querySelectorAll<HTMLElement>("[data-seated]")) node.hidden = seat === null;
  let view: LobbyView | null = null;

  for (const b of formatButtons) b.addEventListener("click", () => cb.format(b.dataset.format as RoomFormat));
  readyBtn.addEventListener("click", () => {
    if (seat === null || !view) return;
    cb.ready(!view.seats[seat]?.ready);
  });
  el.querySelector("[data-action=rp-camera]")?.addEventListener("click", cb.openCamera);

  const label = (n: 0 | 1) => (n === seat ? "You" : (view?.seats[n]?.name ?? "Open seat"));

  return {
    update(v) {
      view = v;
      // before the match only; a resume countdown is shown in the HUD
      const show = !v.match && (v.phase === "waiting" || v.phase === "ready-check" || v.phase === "countdown");
      el.hidden = !show;
      el.dataset.phase = v.phase;
      // no ball in play yet: the timing aid steps aside (ready-panel.css)
      parent.dataset.prematch = String(show);
      if (!show) return;
      title.textContent = v.phase === "countdown" ? `Starting in ${v.countdown ?? 0}…` : v.phase === "waiting" ? `Waiting for an opponent` : "Ready up";
      seatsEl.innerHTML = "";
      for (const n of [0, 1] as const) {
        const s = v.seats[n];
        const li = document.createElement("li");
        li.dataset.seat = String(n);
        li.dataset.ready = String(s?.ready ?? false);
        const who = document.createElement("span");
        who.className = "rp-name";
        who.textContent = s ? label(n) : "Open seat";
        const rating = v.ratings?.[n];
        if (s && rating !== null && rating !== undefined) {
          const r = document.createElement("span");
          r.className = "rp-rating";
          r.textContent = ` ${rating}`;
          r.title = "Rating";
          who.append(r);
        }
        const state = document.createElement("span");
        state.className = "rp-state";
        state.textContent = !s ? `share code ${room}` : s.ready ? "Ready" : "Not ready";
        li.append(who, state);
        if (v.host === n) li.title = "Picks the format";
        seatsEl.append(li);
      }
      const host = seat !== null && v.host === seat;
      for (const b of formatButtons) {
        const on = b.dataset.format === v.format;
        b.setAttribute("aria-checked", String(on));
        b.disabled = !host;
      }
      note.textContent = `${notes[v.format]}${host ? "" : " The host picks the format."}`;
      // task 7: the host's rated option; the server says when it can't count
      ratedInput.checked = v.rated && v.ratedBlocked === null;
      ratedInput.disabled = !host || v.ratedBlocked !== null;
      ratedNote.textContent =
        v.ratedBlocked !== null
          ? `Not rated: ${v.ratedBlocked}`
          : v.rated
            ? "Rated: the result changes both players' ratings."
            : host
              ? "Unrated. Turn on to play for rating."
              : "Unrated. The host decides.";
      if (seat !== null) {
        const mine = v.seats[seat]?.ready ?? false;
        readyBtn.textContent = mine ? "Not ready" : "I'm ready";
        readyBtn.setAttribute("aria-pressed", String(mine));
        readyBtn.disabled = v.phase === "waiting";
      }
      const other = seat === null ? null : v.seats[seat === 0 ? 1 : 0];
      hint.textContent =
        seat === null
          ? v.phase === "countdown"
            ? "Spectating. The match is about to start."
            : "Spectating. The match starts when both players are ready."
          : v.phase === "countdown"
          ? "Un-ready to stop the countdown."
          : v.phase === "waiting"
            ? "Send the invite link or the room code to a friend."
            : v.seats[seat]?.ready
              ? `Waiting for ${other?.name ?? "your opponent"} to ready up.`
              : "Ready when you are. No camera needed: keys and buttons work too.";
      place();
    },
    camera(state) {
      camState.dataset.state = state;
      camState.textContent = state === "ok" ? "Camera OK" : state === "on" ? "Camera on, can't see you yet" : "Camera off (optional)";
    },
    dispose() {
      observer.disconnect();
      delete parent.dataset.prematch;
      el.remove();
    },
  };
}
