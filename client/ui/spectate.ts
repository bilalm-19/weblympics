// Task 24: spectating, the same in every game's view. Players get "Copy watch
// link" next to "Copy invite"; a spectator gets a "Watching" badge with both
// players' names and how many are watching, and nothing to play with (each
// view already hides its controls and camera for a seat of null; the server
// ignores a spectator's input anyway). Only renders the server's `presence`.
import type { RoomInfo, ServerMsg } from "../../shared/protocol.ts";
import type { GameLink } from "../net/link.ts";
import { mountGuide } from "./guide.ts";
import "./spectate.css";

/** The watch link: opening it always spectates, even when a seat is free. */
export const watchUrl = (room: string): string => `${location.origin}/#/watch/${room}`;
/** The invite link: takes a free seat, else spectates. */
export const inviteUrl = (room: string): string => `${location.origin}/#/room/${room}`;

/** The watcher count in words: "1 watching", "3 watching". */
export const watchersText = (n: number): string => `${n} watching`;

/** The badge's names line: "Ana vs Ben", with an open seat shown as such. */
export function matchup(names: [string | null, string | null]): string {
  return `${names[0] ?? "Open seat"} vs ${names[1] ?? "Open seat"}`;
}

function copyButton(button: HTMLButtonElement, text: () => string): void {
  const label = button.textContent;
  let timer = 0;
  button.addEventListener("click", () => {
    navigator.clipboard
      ?.writeText(text())
      .then(() => (button.textContent = "Copied"))
      .catch(() => (button.textContent = "Copy failed"))
      .finally(() => {
        clearTimeout(timer);
        timer = window.setTimeout(() => (button.textContent = label), 2000);
      });
  });
}

/**
 * Adds the watch-link button (players) or the Watching badge (spectators) to a
 * game view's HUD. Call after the view's HTML is in place; returns dispose.
 */
export function addSpectating(view: HTMLElement, conn: GameLink, info: RoomInfo): () => void {
  const hud = view.querySelector(".hud") as HTMLElement | null;
  const invite = view.querySelector<HTMLButtonElement>("[data-action=copy]");
  if (!hud || !invite) return () => {};
  const watching = info.seat === null;
  view.classList.toggle("spectating", watching);

  const copyWatch = document.createElement("button");
  copyWatch.type = "button";
  copyWatch.dataset.action = "copy-watch";
  copyWatch.textContent = "Copy watch link";
  copyWatch.title = "Anyone with this link watches; it never takes a seat";
  copyWatch.dataset.link = watchUrl(info.room);
  invite.after(copyWatch);
  copyButton(copyWatch, () => watchUrl(info.room));
  // a spectator shares the watch link only: the invite could hand a friend a seat
  if (watching) invite.hidden = true;

  let badge: HTMLElement | null = null;
  if (watching) {
    badge = document.createElement("div");
    badge.className = "watch-badge";
    badge.setAttribute("role", "status");
    badge.innerHTML = `<span class="wb-pill"><b>Watching</b> <span class="wb-names"></span> <span class="wb-count"></span></span>`;
    hud.append(badge);
  }
  const names = badge?.querySelector(".wb-names") as HTMLElement | null;
  const count = badge?.querySelector(".wb-count") as HTMLElement | null;
  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t !== "presence") return;
    view.dataset.watchers = String(msg.spectators);
    if (names) names.textContent = matchup(msg.names);
    if (count) count.textContent = `· ${watchersText(msg.spectators)}`;
  });

  // the how-to-play "?" and its panel (task 35 item 3), in every game's button row
  const disposeGuide = mountGuide(view, info.game);

  return () => {
    unsubscribe();
    disposeGuide();
    badge?.remove();
    copyWatch.remove();
  };
}
