import type { BasketballSnapshot, Seat } from "../../../shared/games/basketball/sim.ts";

// Basketball's tie vote (task 32, user, 2026-11-08, like bowling's): level
// after the five spots, both players choose Draw or Continue (sudden death)
// within 15 s. This panel only shows the server's `vote` and sends
// `{ t: "tie", choice }`; the server decides. A spectator sees both choices
// and no buttons. Keys: D draw, C continue.
//
// LOCAL TYPE EXTENSION: `shared/` on this branch (basketball-scene) has no
// tie vote yet; the rules agent adds `phase: "tie-vote"`, `vote` and `draw`
// on basketball-rules. These optional fields typecheck now and keep working
// once the real snapshot has them; drop them at integration.

export type TieChoice = "draw" | "continue";
export interface TieVote {
  votes: [TieChoice | null, TieChoice | null];
  ticksLeft: number;
}
export type WithVote = Omit<BasketballSnapshot, "phase"> & {
  phase: BasketballSnapshot["phase"] | "tie-vote";
  vote?: TieVote | null;
  draw?: boolean;
};

const WORD: Record<TieChoice, string> = { draw: "draw", continue: "continue" };

export interface TiePanel {
  el: HTMLElement;
  /** Draws the panel from a snapshot; hidden unless the phase is "tie-vote". */
  update(s: WithVote): void;
  /** A key: D draws, C continues. Returns true if it was taken. */
  key(code: string): boolean;
  dispose(): void;
}

/** `seat` is this viewer's seat, null for a spectator; `label` names a seat for a spectator. */
export function createTiePanel(doc: Document, seat: Seat | null, send: (choice: TieChoice) => void, label: (s: Seat) => string): TiePanel {
  const el = doc.createElement("section");
  el.className = "bb-tie";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Tie vote");
  el.hidden = true;
  el.innerHTML = `
    <h2>Level! Draw, or go to sudden death?</h2>
    <p class="bb-tie-clock" role="timer"></p>
    <div class="bb-tie-buttons">
      <button type="button" data-choice="draw" aria-keyshortcuts="D">Draw <kbd>D</kbd></button>
      <button type="button" class="primary" data-choice="continue" aria-keyshortcuts="C">Continue <kbd>C</kbd></button>
    </div>
    <p class="bb-tie-mine" role="status"></p>
    <ul class="bb-tie-votes" role="status"></ul>`;
  const clock = el.querySelector(".bb-tie-clock") as HTMLElement;
  const buttons = el.querySelector(".bb-tie-buttons") as HTMLElement;
  const mine = el.querySelector(".bb-tie-mine") as HTMLElement;
  const votes = el.querySelector(".bb-tie-votes") as HTMLElement;
  const choiceButtons = [...el.querySelectorAll<HTMLButtonElement>("[data-choice]")];
  // a spectator never gets the buttons
  if (seat === null) buttons.remove();

  let open = false;
  // what I chose, until the server's vote carries it (so a second press can't send again)
  let chosen: TieChoice | null = null;
  const choose = (c: TieChoice) => {
    if (seat === null || !open || chosen) return;
    chosen = c;
    send(c);
    mark();
  };
  const mark = () => {
    for (const b of choiceButtons) {
      b.disabled = chosen !== null;
      b.setAttribute("aria-pressed", String(b.dataset.choice === chosen));
    }
    mine.textContent = chosen ? `You chose: ${WORD[chosen]}` : "";
  };
  for (const b of choiceButtons) b.addEventListener("click", () => choose(b.dataset.choice as TieChoice));

  return {
    el,
    update(s) {
      const v = s.phase === "tie-vote" ? s.vote : null;
      open = !!v;
      el.hidden = !v;
      if (!v) {
        chosen = null;
        return;
      }
      clock.textContent = `${Math.max(0, Math.ceil(v.ticksLeft / 60))} s`;
      if (seat !== null) {
        chosen = v.votes[seat] ?? chosen;
        mark();
        const theirs = v.votes[seat === 0 ? 1 : 0];
        votes.innerHTML = "";
        const li = doc.createElement("li");
        li.textContent = theirs ? `They chose: ${WORD[theirs]}` : "They're choosing…";
        votes.append(li);
      } else {
        votes.innerHTML = "";
        for (const n of [0, 1] as const) {
          const li = doc.createElement("li");
          const c = v.votes[n];
          li.textContent = `${label(n)}: ${c ? WORD[c] : "choosing…"}`;
          votes.append(li);
        }
      }
    },
    key(code) {
      if (!open || seat === null) return false;
      if (code === "KeyD") choose("draw");
      else if (code === "KeyC") choose("continue");
      else return false;
      return true;
    },
    dispose() {
      el.remove();
    },
  };
}
