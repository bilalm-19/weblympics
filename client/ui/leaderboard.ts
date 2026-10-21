// The leaderboard (task 7): one tab per registered sport, top accounts by
// that sport's Elo with wins and losses, your row highlighted and your rank
// shown even outside the top list. A short poll (every second while open)
// keeps it within about a second of a rated match ending. Guests are never on
// it; the demo accounts are hidden. Also your recent matches.
import "./profile.css";
import "./leaderboard.css";
import { games } from "../../shared/games/registry.ts";

interface Row {
  rank: number;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  you: boolean;
}
interface Board {
  sport: string;
  top: Row[];
  you: Row | null;
  version: number;
}
interface Match {
  endedAt: number;
  sport: string;
  format: string;
  opponent: string;
  result: "won" | "lost" | "none";
  score: [number, number];
  sets: Array<[number, number]>;
  rated: boolean;
  practice: boolean;
  bestRally: number | null;
}

const POLL_MS = 1000;
const FORMAT_NAMES: Record<string, string> = { oneSet: "One set", bestOfThree: "Best of three", unlimited: "Unlimited", points5: "First to 5" };

export function openLeaderboard(): void {
  document.querySelector("dialog.board")?.remove();
  const sports = Object.values(games).map((g) => ({ id: g.id, name: g.name }));
  let sport = sports[0].id;
  let lastKey = "";
  let timer = 0;

  const dialog = document.createElement("dialog");
  dialog.className = "profile board";
  dialog.setAttribute("aria-labelledby", "board-title");
  dialog.innerHTML = `
    <div class="profile-box">
      <header class="profile-head">
        <h2 id="board-title">Leaderboard</h2>
        <button type="button" class="profile-close" aria-label="Close leaderboard">×</button>
      </header>
      <div class="board-tabs" role="tablist" aria-label="Sport">
        ${sports.map((s, i) => `<button type="button" role="tab" id="board-tab-${s.id}" data-sport="${s.id}" aria-controls="board-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${s.name}</button>`).join("")}
      </div>
      <section id="board-panel" role="tabpanel" aria-labelledby="board-tab-${sport}">
        <p class="profile-note board-rule">Elo rating: everyone starts at 1000; a rated win moves you up by up to 32. Accounts only.</p>
        <table class="board-table">
          <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Rating</th><th scope="col"><abbr title="Wins">W</abbr></th><th scope="col"><abbr title="Losses">L</abbr></th></tr></thead>
          <tbody></tbody>
        </table>
        <p class="board-you profile-note" aria-live="polite"></p>
      </section>
      <h3>Your recent matches</h3>
      <ul class="board-history"></ul>
    </div>
  `;
  document.body.append(dialog);
  const tbody = dialog.querySelector("tbody")!;
  const youEl = dialog.querySelector<HTMLElement>(".board-you")!;
  const panel = dialog.querySelector<HTMLElement>("#board-panel")!;
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>("[role=tab]")];

  const row = (r: Row) => {
    const tr = document.createElement("tr");
    if (r.you) {
      tr.className = "is-you";
      tr.setAttribute("aria-current", "true");
    }
    for (const v of [r.rank, r.name + (r.you ? " (you)" : ""), r.rating, r.wins, r.losses]) {
      const td = document.createElement("td");
      td.textContent = String(v);
      tr.append(td);
    }
    return tr;
  };

  async function refresh(): Promise<void> {
    try {
      const res = await fetch(`/api/leaderboard?sport=${encodeURIComponent(sport)}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const board = (await res.json()) as Board;
      const key = JSON.stringify(board);
      if (key === lastKey || board.sport !== sport) return;
      lastKey = key;
      tbody.replaceChildren(...board.top.map(row));
      if (board.top.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="5" class="board-empty">No rated matches yet.</td>`;
        tbody.append(tr);
      }
      const inTop = board.top.some((r) => r.you);
      youEl.textContent = board.you
        ? inTop
          ? `You are #${board.you.rank} with ${board.you.rating}.`
          : `You: #${board.you.rank}, rating ${board.you.rating} (${board.you.wins} won, ${board.you.losses} lost).`
        : "Sign in with a passkey and play a rated match to get on the board.";
      dialog.dataset.version = String(board.version);
    } catch {
      // offline for a moment: the next poll tries again
    }
  }

  async function loadHistory(): Promise<void> {
    const list = dialog.querySelector<HTMLElement>(".board-history")!;
    try {
      const { matches } = (await (await fetch("/api/history", { credentials: "same-origin" })).json()) as { matches: Match[] };
      list.replaceChildren();
      if (matches.length === 0) list.innerHTML = `<li class="profile-note">No matches yet.</li>`;
      for (const m of matches) {
        const li = document.createElement("li");
        const result = m.result === "won" ? "Won" : m.result === "lost" ? "Lost" : "Played";
        const games = m.sets.length ? m.sets.map(([a, b]) => `${a}-${b}`).join(", ") : `${m.score[0]}-${m.score[1]}`;
        const bits = [FORMAT_NAMES[m.format] ?? m.format, m.rated ? "rated" : "unrated", m.bestRally ? `best rally ${m.bestRally}` : ""].filter(Boolean);
        li.textContent = `${result} vs ${m.opponent}, ${games} (${bits.join(", ")})`;
        list.append(li);
      }
    } catch {
      list.textContent = "Couldn't load your matches.";
    }
  }

  const select = (i: number) => {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    sport = tabs[i].dataset.sport!;
    panel.setAttribute("aria-labelledby", tabs[i].id);
    lastKey = "";
    void refresh();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = (i + step + tabs.length) % tabs.length;
      select(next);
      tabs[next].focus();
    });
  });

  dialog.querySelector(".profile-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    clearInterval(timer);
    dialog.remove();
  });
  dialog.showModal();
  void refresh();
  void loadHistory();
  timer = window.setInterval(() => void refresh(), POLL_MS);
}
