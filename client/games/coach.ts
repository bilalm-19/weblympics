import "./coach.css";

// A short coach for boxing and track practice (user, 2026-11-09: "step-by-step
// coach like tennis, keep it simple"). A few steps, each a move with a stick-
// figure picture, ticked off when the player does it. It only listens to the
// inputs the practice already receives (keys, buttons or camera alike), so it
// adds no message and never touches the server. Optional: Skip hides it, and
// the choice is remembered in this browser.

export interface CoachStep {
  id: string;
  title: string;
  /** What to do, for keys and for the camera. */
  how: string;
  /** Stick figure: arms and legs as [x1, y1, x2, y2] lines in a 60 x 70 box. */
  figure: readonly (readonly [number, number, number, number])[];
  /** How many times the move must be done to tick the step off. */
  times: number;
}

/** What a player did, as the practice's link sees it. */
export type CoachEvent = { kind: "punch"; target: "head" | "body" } | { kind: "guard"; height: "high" | "low" } | { kind: "slip" } | { kind: "step" } | { kind: "jump" };

const BODY = [
  [30, 18, 30, 44], // spine
  [30, 44, 22, 66], // left leg
  [30, 44, 38, 66], // right leg
] as const;

export const BOXING_STEPS: readonly CoachStep[] = [
  { id: "head", title: "Jab the head", how: "J, or punch at head height.", times: 3, figure: [...BODY, [30, 26, 50, 18], [30, 26, 22, 34]] },
  { id: "body", title: "Jab the body", how: "K, or punch low, at your opponent's middle.", times: 3, figure: [...BODY, [30, 26, 50, 38], [30, 26, 22, 34]] },
  { id: "guard", title: "Guard", how: "Hold Space for a high guard, L for a low one. Hands up blocks head jabs.", times: 2, figure: [...BODY, [30, 26, 40, 12], [30, 26, 22, 12]] },
  { id: "slip", title: "Lean to slip", how: "Hold A or D, or lean your shoulders. A slipped head jab does no damage.", times: 1, figure: [[36, 18, 24, 44], [24, 44, 16, 66], [24, 44, 32, 66], [26, 28, 14, 36], [26, 28, 38, 34]] },
];

export const TRACK_STEPS: readonly CoachStep[] = [
  { id: "step", title: "Run on the spot", how: "A and D in turn, or pump your arms. Quick, small, steady steps.", times: 8, figure: [...BODY, [30, 26, 40, 34], [30, 26, 20, 18]] },
  { id: "jump", title: "Jump the hurdle", how: "Space, or both hands up together. Time it just before the hurdle (hurdles event).", times: 2, figure: [[30, 8, 30, 34], [30, 34, 20, 44], [30, 34, 40, 44], [30, 18, 18, 8], [30, 18, 42, 8]] },
];

export interface CoachState {
  /** Index of the step being taught; equals `steps.length` when all are done. */
  step: number;
  /** Times the current step's move has been done. */
  count: number;
}

export function startCoach(): CoachState {
  return { step: 0, count: 0 };
}

/** Whether an event is the move a step teaches. */
export function matches(step: CoachStep, e: CoachEvent): boolean {
  switch (step.id) {
    case "head":
      return e.kind === "punch" && e.target === "head";
    case "body":
      return e.kind === "punch" && e.target === "body";
    case "guard":
      return e.kind === "guard";
    case "slip":
      return e.kind === "slip";
    case "step":
      return e.kind === "step";
    case "jump":
      return e.kind === "jump";
    default:
      return false;
  }
}

/** The state after an event: a matching move counts, and enough of them moves to the next step. Pure. */
export function advance(steps: readonly CoachStep[], s: CoachState, e: CoachEvent): CoachState {
  const cur = steps[s.step];
  if (!cur || !matches(cur, e)) return s;
  const count = s.count + 1;
  return count >= cur.times ? { step: s.step + 1, count: 0 } : { step: s.step, count };
}

export const done = (steps: readonly CoachStep[], s: CoachState): boolean => s.step >= steps.length;

/** Steps that don't apply (jump outside hurdles) are skipped over so the coach never waits for them. */
export function applicable(steps: readonly CoachStep[], skip: (id: string) => boolean): readonly CoachStep[] {
  return steps.filter((s) => !skip(s.id));
}

const KEY = "wl_coach_off";
const off = (game: string): boolean => {
  try {
    return localStorage.getItem(`${KEY}_${game}`) === "1";
  } catch {
    return false;
  }
};
const remember = (game: string): void => {
  try {
    localStorage.setItem(`${KEY}_${game}`, "1");
  } catch {
    /* storage can be blocked; the coach just comes back next time */
  }
};

const svgOf = (figure: CoachStep["figure"]): string =>
  `<svg viewBox="0 0 60 70" width="48" height="56" aria-hidden="true" focusable="false"><circle cx="30" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="3"/>${figure
    .map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`)
    .join("")}</svg>`;

export interface Coach {
  /** Feed what the player did. */
  see(e: CoachEvent): void;
  /** The steps may change (track's event switch): drop the ones that don't apply. */
  retarget(skip: (id: string) => boolean): void;
  dispose(): void;
}

/**
 * Mounts the coach panel in the HUD. `game` names it (for the remembered
 * Skip). The panel is a compact card in the HUD's flow, under the buttons,
 * so it never covers the court or the scores.
 */
export function mountCoach(view: HTMLElement, game: string, all: readonly CoachStep[], skip: (id: string) => boolean = () => false): Coach {
  const el = document.createElement("section");
  el.className = "practice-coach";
  el.setAttribute("aria-label", "Coach");
  el.dataset.game = game;
  const hud = view.querySelector(".hud");
  const status = hud?.querySelector(":scope > .status");
  if (hud && status) hud.insertBefore(el, status);
  else (hud ?? view).append(el);
  let steps = applicable(all, skip);
  let state = startCoach();
  let hidden = off(game);
  el.hidden = hidden;

  const render = () => {
    el.dataset.done = String(done(steps, state));
    if (done(steps, state)) {
      el.innerHTML = `<p class="pcoach-done" role="status">All done. Keep practising, or Hide this.</p><button type="button" class="pcoach-hide">Hide</button>`;
    } else {
      const cur = steps[state.step];
      el.innerHTML = `
        <div class="pcoach-fig">${svgOf(cur.figure)}</div>
        <div class="pcoach-text" role="status" aria-live="polite">
          <b>${state.step + 1} of ${steps.length}: ${cur.title}</b>
          <span>${cur.how}</span>
          <small>${state.count} of ${cur.times}</small>
        </div>
        <button type="button" class="pcoach-hide">Skip coach</button>`;
    }
    el.querySelector(".pcoach-hide")?.addEventListener("click", (ev) => {
      // a focused button would take Space (the games' guard and jump key)
      (ev.currentTarget as HTMLElement).blur();
      hidden = true;
      el.hidden = true;
      remember(game);
    });
  };
  render();

  return {
    see(e) {
      if (hidden) return;
      const next = advance(steps, state, e);
      if (next === state) return;
      state = next;
      render();
    },
    retarget(skipNow) {
      const before = steps[state.step]?.id;
      steps = applicable(all, skipNow);
      const at = steps.findIndex((s) => s.id === before);
      state = at >= 0 ? { step: at, count: state.count } : { step: Math.min(state.step, steps.length), count: 0 };
      render();
    },
    dispose: () => el.remove(),
  };
}
