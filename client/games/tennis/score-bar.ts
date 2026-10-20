// The score bar at the top of the game screen. It only renders the server's
// ScoreState from each snapshot; it never works a score out for itself. The
// umpire's call after a point is the big banner across the top (task 16,
// call-banner.ts and point-call.ts), not repeated here.
import { pointCalls } from "../../../shared/games/tennis/scoring.ts";
import type { TennisSnapshot } from "../../../shared/games/tennis/sim.ts";

type Seat = 0 | 1;

const FORMAT_NAMES: Record<string, string> = { oneSet: "One set", bestOfThree: "Best of three" };

export interface ScoreBar {
  /** `called`: a point was just called (point-call.ts), so the numbers that changed pulse. */
  update(snap: TennisSnapshot, names: (seat: Seat) => string, called?: boolean): void;
  dispose(): void;
}

/** Fills `el` with the bar; `update` with every server snapshot. */
export function createScoreBar(el: HTMLElement): ScoreBar {
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Score");
  el.removeAttribute("aria-live");
  const row = (seat: Seat) => `
    <div class="sb-row" data-seat="${seat}">
      <span class="sb-serve" aria-hidden="true"></span>
      <span class="sb-name"></span>
      <span class="sr-only sb-serving"></span>
      <span class="sb-num sb-sets" data-field="sets"></span>
      <span class="sb-num sb-games" data-field="games"></span>
      <span class="sb-num sb-points" data-field="points"></span>
    </div>`;
  el.innerHTML = `${row(0)}${row(1)}
    <div class="sb-foot"><span class="sb-format"></span></div>`;
  const formatEl = el.querySelector(".sb-format") as HTMLElement;
  const cell = (seat: Seat, field: string) => el.querySelector(`[data-seat="${seat}"] [data-field="${field}"]`) as HTMLElement;
  let prev: TennisSnapshot | null = null;

  const set = (target: HTMLElement, text: string, label: string, pulse: boolean) => {
    if (target.textContent !== text) target.textContent = text;
    target.setAttribute("aria-label", `${label} ${text}`);
    if (!pulse) return;
    // restart the animation even if it is still running from the last point
    target.classList.remove("sb-pulse");
    void target.offsetWidth;
    target.classList.add("sb-pulse");
  };

  return {
    update(snap, names, called = false) {
      const sc = snap.score;
      const calls = pointCalls(sc);
      for (const seat of [0, 1] as const) {
        const r = el.querySelector(`[data-seat="${seat}"]`) as HTMLElement;
        const serving = snap.phase !== "over" && sc.server === seat;
        r.dataset.serving = String(serving);
        r.dataset.won = String(snap.phase === "over" && snap.winner === seat);
        (r.querySelector(".sb-serve") as HTMLElement).textContent = serving ? (sc.faults === 1 ? "2" : "●") : "";
        (r.querySelector(".sb-serving") as HTMLElement).textContent = serving ? (sc.faults === 1 ? " serving, second serve" : " serving") : "";
        const nameEl = r.querySelector(".sb-name") as HTMLElement;
        if (nameEl.textContent !== names(seat)) nameEl.textContent = names(seat);
        const changed = called && prev !== null;
        set(cell(seat, "sets"), String(sc.sets[seat]), "sets", changed && prev!.score.sets[seat] !== sc.sets[seat]);
        set(cell(seat, "games"), String(sc.games[seat]), "games", changed && prev!.score.games[seat] !== sc.games[seat]);
        set(cell(seat, "points"), calls[seat], "points", changed && prev!.score.points[seat] !== sc.points[seat]);
      }
      const format = snap.endless ? "Practice" : (FORMAT_NAMES[sc.format] ?? sc.format);
      formatEl.textContent = sc.tiebreak ? `${format} · tiebreak` : format;
      prev = snap;
    },
    dispose() {},
  };
}
