import "./guide.css";

// A guide for every sport (task 35 item 3, built small; user, 2026-11-09:
// "it doesn't need to be big, but needs to be built fast"). A "?" button in
// the game's button row opens a panel of the moves: an outline figure that
// loops the move, what to do with the camera, and the key that does the same.
// A side panel on a desktop and a bottom sheet on a phone; it never covers the
// court. It is only a picture and words: it sends nothing and changes no game
// state, so it is safe to open mid-match. Escape or "Close" shuts it.

/** Which part of the figure moves, drawn as a looping CSS animation. */
export type Motion = "swing-fore" | "swing-back" | "jab" | "guard" | "lean" | "run" | "jump" | "push" | "roll" | "draw";

export interface GuideMove {
  id: string;
  title: string;
  /** With the camera: the body part the camera looks for is lit in the figure. */
  camera: string;
  /** The key, button or mouse that does the same. */
  keys: string;
  motion: Motion;
  /** The part of the body the camera tracks for this move (lit in the picture). */
  lit: "arm" | "arms" | "legs" | "torso";
}

export const GUIDE: Record<string, readonly GuideMove[]> = {
  tennis: [
    { id: "forehand", title: "Forehand", camera: "Palm to the screen, then swing your racket arm across your body.", keys: "Space, or 1, 2, 3 for light, medium, hard", motion: "swing-fore", lit: "arm" },
    { id: "backhand", title: "Backhand", camera: "Back of your hand to the screen, then swing back out.", keys: "The same keys: the ball's side picks the stroke", motion: "swing-back", lit: "arm" },
    { id: "move", title: "Move", camera: "The game walks you to the ball. Lean your shoulders to move yourself.", keys: "A and D", motion: "lean", lit: "torso" },
  ],
  bowling: [
    { id: "aim", title: "Aim and curve", camera: "Move your bowling hand across the picture to aim.", keys: "Left and Right to aim, Up and Down to curve", motion: "roll", lit: "arm" },
    { id: "roll", title: "Roll", camera: "Swing your arm up past your hip, fast for a fast ball.", keys: "Hold Space (or Bowl) to fill the meter, let go to throw", motion: "roll", lit: "arm" },
  ],
  basketball: [
    { id: "aim", title: "Aim", camera: "Your hands' sideways offset is the aim.", keys: "Left and Right, or the mouse", motion: "push", lit: "arms" },
    { id: "shoot", title: "Shoot", camera: "Push both hands up and out from your chest, harder for more power.", keys: "Hold Space (or Shoot), let go in the green", motion: "push", lit: "arms" },
  ],
  track: [
    { id: "run", title: "Run on the spot", camera: "Pump your arms: each hand coming up is a step.", keys: "A and D in turn, or Left and Right", motion: "run", lit: "arms" },
    { id: "jump", title: "Jump the hurdle", camera: "Both hands up together, just before the hurdle.", keys: "Space, or the Jump button (hurdles)", motion: "jump", lit: "arms" },
  ],
  archery: [
    { id: "aim", title: "Aim", camera: "The hand holding the bow aims; move it to place the sight.", keys: "The mouse or the arrow keys", motion: "draw", lit: "arm" },
    { id: "draw", title: "Draw and let go", camera: "Pull your other hand back along your shoulders, then open it to shoot.", keys: "Hold Space (or the button), let go to shoot", motion: "draw", lit: "arms" },
  ],
  boxing: [
    { id: "jab", title: "Jab", camera: "Punch toward the screen: high for the head, low for the body.", keys: "J for the head, K for the body", motion: "jab", lit: "arms" },
    { id: "guard", title: "Guard", camera: "Both hands up, high or low, to block.", keys: "Hold Space for high, L for low", motion: "guard", lit: "arms" },
    { id: "slip", title: "Lean to slip", camera: "Lean your shoulders to one side; a slipped head jab does no damage.", keys: "Hold A or D", motion: "lean", lit: "torso" },
  ],
};

/** The moves for a game, or none for a game the guide doesn't know. */
export const movesFor = (game: string): readonly GuideMove[] => GUIDE[game] ?? [];

const figure = (m: GuideMove): string =>
  `<svg class="gd-fig" data-motion="${m.motion}" data-lit="${m.lit}" viewBox="0 0 80 90" width="64" height="72" aria-hidden="true" focusable="false">
    <circle class="gd-head" cx="40" cy="12" r="8"/>
    <line class="gd-torso" x1="40" y1="20" x2="40" y2="54"/>
    <line class="gd-leg gd-leg-l" x1="40" y1="54" x2="30" y2="84"/>
    <line class="gd-leg gd-leg-r" x1="40" y1="54" x2="50" y2="84"/>
    <g class="gd-arm gd-arm-l" style="transform-origin:40px 28px"><line x1="40" y1="28" x2="24" y2="46"/></g>
    <g class="gd-arm gd-arm-r" style="transform-origin:40px 28px"><line x1="40" y1="28" x2="56" y2="46"/></g>
  </svg>`;

/** The panel's markup for a game's moves. */
export function guideHtml(moves: readonly GuideMove[]): string {
  return moves
    .map(
      (m) => `<li class="gd-move" data-move="${m.id}">
        ${figure(m)}
        <div class="gd-text">
          <b>${m.title}</b>
          <span><em>Camera:</em> ${m.camera}</span>
          <span><em>Keys:</em> ${m.keys}</span>
        </div>
      </li>`,
    )
    .join("");
}

/**
 * Adds a "?" button to the game's button row and the panel it opens. Does
 * nothing for a game with no moves. Returns dispose.
 */
export function mountGuide(view: HTMLElement, game: string): () => void {
  const moves = movesFor(game);
  const tools = view.querySelector(".hud-tools");
  if (!moves.length || !tools) return () => {};

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gd-button";
  button.dataset.action = "guide";
  button.textContent = "?";
  button.setAttribute("aria-label", "How to play: the moves");
  button.setAttribute("aria-expanded", "false");
  tools.append(button);

  const panel = document.createElement("section");
  panel.className = "gd-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "How to play");
  panel.hidden = true;
  panel.innerHTML = `
    <div class="gd-head-row"><h2>How to play</h2><button type="button" class="gd-close">Close</button></div>
    <p class="gd-note">The camera reads the lit body part. Every move has a key too.</p>
    <ul class="gd-list">${guideHtml(moves)}</ul>`;
  view.append(panel);

  // Each game's on-screen controls are a different height (bowling's is two
  // rows), so a fixed offset left the sheet over them on a phone. Measured when
  // it opens: the sheet's bottom edge sits just above the controls.
  const clearControls = () => {
    const controls = view.querySelector<HTMLElement>(".controls:not([hidden])");
    const top = controls ? controls.getBoundingClientRect().top - view.getBoundingClientRect().top : view.clientHeight;
    panel.style.setProperty("--gd-bottom", `${Math.max(0, view.clientHeight - top) + 8}px`);
  };

  const set = (open: boolean) => {
    if (open) clearControls();
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    view.dataset.guide = open ? "open" : "";
  };
  const toggle = () => {
    // a focused button would take Space (the games' shoot, guard and jump key)
    button.blur();
    set(panel.hidden === true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !panel.hidden) set(false);
  };
  button.addEventListener("click", toggle);
  panel.querySelector(".gd-close")?.addEventListener("click", () => set(false));
  window.addEventListener("keydown", onKey);

  return () => {
    window.removeEventListener("keydown", onKey);
    button.remove();
    panel.remove();
  };
}
