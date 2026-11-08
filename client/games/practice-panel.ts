import "./practice-panel.css";

// Task 38: the small practice panel shared by basketball, bowling and track
// (like archery's level picker). It opens on "Just me"; "vs Bot" switches to
// today's practice against the bot, any time. A game adds its own pickers
// (basketball's spot, bowling's reset-pins switch) beside it. It sits in the
// HUD's own row, so it never covers the court, the lane or the scores.

export type PracticeMode = "solo" | "bot";

export const MODE_LABELS: Record<PracticeMode, string> = { solo: "Just me", bot: "vs Bot" };

export interface PracticePanel {
  el: HTMLElement;
  mode(): PracticeMode;
  /** Shows only the pickers meant for this mode (`data-for="solo"` or `"bot"`). */
  sync(): void;
  dispose(): void;
}

/**
 * Builds the panel into `view`'s HUD (before its status line) with the mode
 * switch first, then `extras`. `onMode` runs when the player picks the other
 * mode; the game restarts its practice there.
 */
export function createPracticePanel(view: HTMLElement, extras: HTMLElement[], onMode: (mode: PracticeMode) => void): PracticePanel {
  let mode: PracticeMode = "solo";
  const el = document.createElement("section");
  el.className = "pr-panel";
  el.setAttribute("aria-label", "Practice settings");
  const group = document.createElement("span");
  group.className = "pr-modes";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Practise");
  for (const m of ["solo", "bot"] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.mode = m;
    b.textContent = MODE_LABELS[m];
    b.addEventListener("click", () => {
      // a focused button would take Space (the games' shoot, bowl and jump key)
      b.blur();
      if (m === mode) return;
      mode = m;
      panel.sync();
      onMode(m);
    });
    group.append(b);
  }
  el.append(group, ...extras);
  const hud = view.querySelector(".hud");
  const status = hud?.querySelector(":scope > .status");
  if (hud && status) hud.insertBefore(el, status);
  else (hud ?? view).append(el);
  const panel: PracticePanel = {
    el,
    mode: () => mode,
    sync() {
      for (const b of group.querySelectorAll<HTMLButtonElement>("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
      for (const x of el.querySelectorAll<HTMLElement>("[data-for]")) x.hidden = x.dataset.for !== mode;
      view.dataset.practice = mode;
    },
    dispose: () => el.remove(),
  };
  panel.sync();
  return panel;
}
