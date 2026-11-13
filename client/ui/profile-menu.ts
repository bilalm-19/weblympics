// The home screen's profile button (top right) and its panel. The picture is
// the player's own character, the head and shoulders of their saved look
// (a guest wears seat 1's default), drawn once as flat SVG by look-preview.ts:
// the menu never loads Three.js and nothing here animates or re-renders on a
// loop. The panel holds sign in and out, the demo accounts (behind a closed
// "Dev tools") and the way to the profile dialog.
// A native modal <dialog>: focus moves in, Tab stays inside, Escape closes it
// and focus goes back to the button. A popover under the button on desktop,
// a bottom sheet on a phone (style.css).
import { DEFAULT_LOOKS } from "../../shared/look.ts";
import type { Look } from "../../shared/look.ts";
import type { ShownStatus } from "../../shared/protocol.ts";
import { lanMode } from "../net/account.ts";
import { lookSvg } from "./look-preview.ts";
import { problem } from "./profile.ts";

export interface ProfileMenuWho {
  name: string;
  matches: number;
  account: boolean;
  demo: boolean;
  look: Look | null;
  /** Your "show me as" (task 34), drawn as a dot on the picture; none for a guest. */
  status?: ShownStatus;
}

export interface ProfileMenuActions {
  /** Passkey ceremonies; each resolves once who you are has changed (the menu is then drawn again). */
  onPasskey(kind: "signin" | "create"): Promise<void>;
  /** Dev tools: one of the two locked demo accounts. */
  onSignInDemo(n: 1 | 2): Promise<void>;
  /** Back to this browser's guest (signing out of an account or leaving a demo one). */
  onSignOut(): Promise<void>;
  /** The full profile dialog (name, passkeys, look, delete). */
  onProfile(): void;
}

// After an action from the panel the menu is drawn again (a fresh welcome);
// focus then goes back to the new profile button rather than to the page.
let refocus = false;

const matchesText = (n: number) => `${n} match${n === 1 ? "" : "es"} played`;
const kindText = (who: ProfileMenuWho) => (who.demo ? "Demo account" : who.account ? "Signed in" : "Guest");

/** The round button with the avatar (and the name beside it on desktop). Null until the server says who you are. */
export function profileButton(who: ProfileMenuWho, actions: ProfileMenuActions): HTMLElement | null {
  if (!who.name) return null;
  const look = who.look ?? DEFAULT_LOOKS[0];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pm-button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "pm-panel");
  button.setAttribute("aria-label", `Profile: ${who.name}${who.account ? "" : " (guest)"}`);
  button.dataset.account = who.demo ? "demo" : who.account ? "account" : "guest";
  const dot = who.status ? `<span class="sdot sdot--${who.status}" aria-hidden="true"></span>` : "";
  button.innerHTML = `<span class="pm-avatar">${lookSvg(look, null, "head")}${dot}</span><span class="pm-name"></span>`;
  button.querySelector(".pm-name")!.textContent = who.name;
  button.addEventListener("click", () => openPanel(button, who, look, actions));
  if (refocus) {
    refocus = false;
    queueMicrotask(() => button.isConnected && button.focus());
  }
  return button;
}

function openPanel(button: HTMLButtonElement, who: ProfileMenuWho, look: Look, actions: ProfileMenuActions): void {
  const host = button.closest(".menu") ?? document.body;
  host.querySelector("dialog.pm-panel")?.remove();
  const dialog = document.createElement("dialog");
  dialog.className = "pm-panel";
  dialog.id = "pm-panel";
  dialog.setAttribute("aria-labelledby", "pm-title");
  const demoButton = (n: 1 | 2) => {
    const name = n === 1 ? "Demo One" : "Demo Two";
    return who.demo && who.name === name ? "" : `<button type="button" class="pm-btn" data-demo="${n}">Sign in as ${name}</button>`;
  };
  dialog.innerHTML = `
    <div class="pm-box">
      <header class="pm-head">
        <div class="pm-figure">${lookSvg(look, "Your player")}</div>
        <div class="pm-who">
          <h2 id="pm-title"></h2>
          <p class="pm-kind">${kindText(who)}</p>
          <p class="pm-matches">${matchesText(who.matches)}</p>
        </div>
        <button type="button" class="pm-close" data-act="close" aria-label="Close">×</button>
      </header>
      <div class="pm-actions" role="group" aria-label="Sign in">
        ${
          who.account
            ? `<button type="button" class="pm-btn" data-act="signout">${who.demo ? "Play as guest" : "Sign out"}</button>`
            : lanMode()
            ? // task 39: on a LAN, the profile dialog makes the account (and shows its recovery code once)
              `<p class="pm-note">Playing as a guest. An account keeps your name, look and friends on this game's computer.</p>
               <button type="button" class="pm-btn pm-btn--primary" data-act="profile">Create account or sign in</button>`
            : `<p class="pm-note">Playing as a guest: your matches stay in this browser. A passkey keeps them on any device.</p>
               <button type="button" class="pm-btn pm-btn--primary" data-act="create">Create account with a passkey</button>
               <button type="button" class="pm-btn" data-act="signin">Sign in with a passkey</button>`
        }
      </div>
      <div class="pm-actions" role="group" aria-label="More">
        ${who.account || !lanMode() ? `<button type="button" class="pm-btn" data-act="profile">${who.account ? "Edit profile and look" : "Profile details"}</button>` : ""}
      </div>
      <details class="pm-devtools">
        <summary>Dev tools</summary>
        <div class="pm-actions" role="group" aria-label="Demo accounts">${demoButton(1)}${demoButton(2)}</div>
      </details>
      <p class="pm-status" role="status" aria-live="polite"></p>
    </div>`;
  dialog.querySelector("#pm-title")!.textContent = who.name;
  const status = dialog.querySelector<HTMLElement>(".pm-status")!;

  const close = () => dialog.open && dialog.close();
  dialog.addEventListener("close", () => {
    button.setAttribute("aria-expanded", "false");
    dialog.remove();
    if (button.isConnected) button.focus();
  });
  // Tab wraps within the panel (a modal <dialog> alone lets it out to the browser's own UI)
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    // a closed <details> hides its buttons from Tab but not from getClientRects
    const stops = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), summary")].filter(
      (el) => el.tagName === "SUMMARY" || !el.closest("details:not([open])"),
    );
    if (stops.length === 0) return;
    const [first, last] = [stops[0], stops[stops.length - 1]];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  // a click outside the box (on the backdrop) closes it
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  let busy = false;
  const run = (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    status.textContent = "";
    for (const b of dialog.querySelectorAll<HTMLButtonElement>(".pm-btn")) b.disabled = true;
    fn().then(
      () => {
        // the menu is drawn again with the new identity; focus its button
        refocus = true;
        if (!dialog.isConnected) return;
        busy = false;
        for (const b of dialog.querySelectorAll<HTMLButtonElement>(".pm-btn")) b.disabled = false;
      },
      (e: unknown) => {
        busy = false;
        for (const b of dialog.querySelectorAll<HTMLButtonElement>(".pm-btn")) b.disabled = false;
        status.textContent = problem(e);
      },
    );
  };

  dialog.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      switch (b.dataset.act) {
        case "close":
          close();
          break;
        case "create":
        case "signin":
          run(() => actions.onPasskey(b.dataset.act as "signin" | "create"));
          break;
        case "signout":
          run(() => actions.onSignOut());
          break;
        case "profile":
          close();
          actions.onProfile();
          break;
      }
    }),
  );
  dialog.querySelectorAll<HTMLButtonElement>("[data-demo]").forEach((b) =>
    b.addEventListener("click", () => run(() => actions.onSignInDemo(Number(b.dataset.demo) as 1 | 2))),
  );

  host.append(dialog);
  button.setAttribute("aria-expanded", "true");
  dialog.showModal();
  // the first action, not the close button, so Enter does the likely thing
  dialog.querySelector<HTMLElement>(".pm-actions .pm-btn")?.focus();
}
