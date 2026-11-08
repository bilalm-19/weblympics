// The profile panel (task 17): your name, passkeys, sign in and out, delete.
// A native <dialog>, so focus stays inside it and Escape closes it. Play never
// needs any of this: a guest can ignore it entirely.
import "./profile.css";
import { DEFAULT_LOOKS, HAIRS, LOOK_LABELS, SHIRTS, SHORTS, SKINS, STYLES, STYLE_LABELS, sameLook } from "../../shared/look.ts";
import type { Look } from "../../shared/look.ts";
import { NAME_MAX, NAME_MIN, nameShapeProblem, normaliseName } from "../../shared/names.ts";
import { ApiError, addPasskey, deleteAccount, fetchMe, passkeysSupported, removePasskey, saveLook, setName, signIn, signOut } from "../net/account.ts";
import type { Me } from "../net/account.ts";
import { lookSvg } from "./look-preview.ts";

export interface ProfileHooks {
  /** Who you are changed (signed in or out, claimed, renamed, deleted): reconnect and redraw. */
  onIdentityChange(): void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const COLOUR_FIELDS = [
  ["shirt", SHIRTS],
  ["shorts", SHORTS],
  ["skin", SKINS],
  ["hair", HAIRS],
] as const;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A swatch's spoken name: "Blue shirt", "Black hair", or "Skin tone 3". */
const swatchName = (field: string, value: string) => (field === "skin" ? `Skin tone ${value.slice(1)}` : `${titleCase(value)} ${field}`);

/**
 * The customise section (task 18): one radio group per field, from the fixed
 * lists, and a live preview. Native radios, so arrow keys move within a group.
 */
function customise(look: Look): string {
  const group = (field: keyof Look, options: string, legend: string) => `
    <fieldset class="look-field" data-field="${field}">
      <legend>${legend}</legend>
      <div class="look-options">${options}</div>
    </fieldset>`;
  const radio = (field: keyof Look, value: string, label: string, swatch: string) => `
    <label class="look-option" title="${label}">
      <input type="radio" name="look-${field}" value="${value}" ${look[field] === value ? "checked" : ""} />
      ${swatch}<span class="sr-only">${label}</span>
    </label>`;
  const colours = COLOUR_FIELDS.map(([field, palette]) =>
    group(
      field,
      Object.entries(palette)
        .map(([v, c]) => radio(field, v, swatchName(field, v), `<span class="look-swatch" style="background:${hex(c)}"></span>`))
        .join(""),
      LOOK_LABELS[field],
    ),
  ).join("");
  const styles = group("style", STYLES.map((s) => radio("style", s, STYLE_LABELS[s], `<span class="look-chip">${STYLE_LABELS[s]}</span>`)).join(""), LOOK_LABELS.style);
  return `
    <section class="profile-look" aria-labelledby="pf-look-title">
      <h3 id="pf-look-title">Your player</h3>
      <div class="look-layout">
        <div class="look-preview">${lookSvg(look, "Preview of your player")}</div>
        <form class="look-form">${colours}${styles}
          <div class="profile-actions"><button type="submit" class="profile-btn" id="pf-look-save">Save look</button></div>
        </form>
      </div>
    </section>`;
}

/** Task 7: your rating per sport, wins and losses, and your longest rally. */
function ratingLine(me: Me): string {
  const parts = Object.entries(me.ratings ?? {}).map(
    ([sport, r]) => `<li><strong>${sport.charAt(0).toUpperCase() + sport.slice(1)}</strong>: rating <span class="profile-rating">${r.rating}</span> (${r.wins} won, ${r.losses} lost)</li>`,
  );
  return `<ul class="profile-ratings">${parts.join("")}<li>Longest rally: ${me.longestRally} shots</li></ul>`;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Turns a failed passkey prompt or request into a short sentence. */
export function problem(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError")) return "The passkey prompt was closed.";
  if (e instanceof Error && e.name === "InvalidStateError") return "That passkey is already on this account.";
  return "Something went wrong. Try again.";
}

export function openProfile(hooks: ProfileHooks): void {
  document.querySelector("dialog.profile")?.remove();
  const dialog = document.createElement("dialog");
  dialog.className = "profile";
  dialog.setAttribute("aria-labelledby", "profile-title");
  document.body.append(dialog);

  let me: Me | null = null;
  let status = "";
  let confirmDelete = false;
  let confirmLastKey: string | null = null;
  let busy = false;
  // the look being tried on, before Save
  let draftLook: Look | null = null;

  const changed = (next: Me | null) => {
    me = next;
    hooks.onIdentityChange();
  };

  /** Runs one action with the buttons held, then redraws. */
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    status = "";
    render();
    try {
      await fn();
    } catch (e) {
      status = problem(e);
    }
    busy = false;
    render();
  };

  function render(): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.id;
    dialog.replaceChildren();
    const box = document.createElement("div");
    box.className = "profile-box";
    box.innerHTML = `
      <header class="profile-head">
        <h2 id="profile-title">Profile</h2>
        <button type="button" class="profile-close" data-act="close" aria-label="Close profile">×</button>
      </header>
      <div class="profile-body"></div>
      <p class="profile-status" role="status" aria-live="polite"></p>
    `;
    const body = box.querySelector<HTMLElement>(".profile-body")!;
    box.querySelector<HTMLElement>(".profile-status")!.textContent = status;
    dialog.append(box);

    if (!me) {
      body.innerHTML = `<p>Loading…</p>`;
    } else if (!me.account) {
      body.innerHTML = `
        <p class="profile-name">Playing as <strong></strong> (guest)</p>
        <p class="profile-note">Your matches are kept for this browser. Add a passkey to keep this profile on any device, choose your name and play rated matches. No password, nothing to remember.</p>
        <div class="profile-actions">
          <button type="button" class="profile-btn profile-btn--primary" id="pf-claim" data-act="claim">Create account with a passkey</button>
          <button type="button" class="profile-btn" id="pf-signin" data-act="signin">Sign in with a passkey</button>
        </div>
        ${passkeysSupported() ? "" : `<p class="profile-note">This browser has no passkey support.</p>`}
      `;
    } else if (me.demo) {
      body.innerHTML = `
        <p class="profile-name">Signed in as <strong></strong></p>
        <p class="profile-note">A demo account, for trying rated play. It is locked: no renaming, no passkeys, no deleting. Hidden from the public leaderboard.</p>
        ${ratingLine(me)}
        ${customise(draftLook ?? me.look ?? DEFAULT_LOOKS[0])}
        <div class="profile-actions">
          <button type="button" class="profile-btn" id="pf-signout" data-act="signout">Sign out</button>
        </div>
      `;
    } else {
      body.innerHTML = `
        ${ratingLine(me)}
        <form class="profile-rename" novalidate>
          <label for="pf-name">Display name</label>
          <div class="profile-row">
            <input id="pf-name" name="name" autocomplete="off" spellcheck="false" minlength="${NAME_MIN}" maxlength="${NAME_MAX}" aria-describedby="pf-name-hint" />
            <button type="submit" class="profile-btn" id="pf-save">Save name</button>
          </div>
          <p class="profile-hint" id="pf-name-hint">${NAME_MIN} to ${NAME_MAX} letters, digits, spaces or _ . ' -</p>
          <p class="profile-hint">Friends add you as <strong class="profile-tag"></strong>. Others may share your name; the number tells you apart, and is kept when you rename if it's free.</p>
        </form>
        ${customise(draftLook ?? me.look ?? DEFAULT_LOOKS[0])}
        <h3>Passkeys</h3>
        <ul class="profile-keys"></ul>
        <div class="profile-actions">
          <button type="button" class="profile-btn" id="pf-add" data-act="add">Add a passkey</button>
          <button type="button" class="profile-btn" id="pf-signout" data-act="signout">Sign out</button>
        </div>
        <section class="profile-danger" aria-labelledby="pf-danger-title">
          <h3 id="pf-danger-title">Delete account</h3>
          ${
            confirmDelete
              ? `<p class="profile-note">This removes your name, passkeys and rating for good. Past matches stay for your opponents, shown as "Deleted player". Confirm with one of your passkeys.</p>
                 <div class="profile-actions">
                   <button type="button" class="profile-btn profile-btn--danger" id="pf-delete-confirm" data-act="delete-confirm">Confirm with passkey and delete</button>
                   <button type="button" class="profile-btn" id="pf-delete-cancel" data-act="delete-cancel">Keep my account</button>
                 </div>`
              : `<button type="button" class="profile-btn profile-btn--danger" id="pf-delete" data-act="delete">Delete account…</button>`
          }
        </section>
      `;
      const input = body.querySelector<HTMLInputElement>("#pf-name")!;
      input.value = me.name;
      // task 34: Name#1234, shown only here, in the friends list and in requests
      body.querySelector<HTMLElement>(".profile-tag")!.textContent = `${me.name}#${me.tag ?? "????"}`;
      const hint = body.querySelector<HTMLElement>("#pf-name-hint")!;
      input.addEventListener("input", () => {
        // a pre-check only; the server decides
        const p = nameShapeProblem(normaliseName(input.value));
        hint.textContent = p ?? `${NAME_MIN} to ${NAME_MAX} letters, digits, spaces or _ . ' -`;
        hint.classList.toggle("is-bad", p !== null);
      });
      body.querySelector(".profile-rename")!.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = input.value;
        void act(async () => {
          changed(await setName(name));
          status = "Name saved.";
        });
      });
      const list = body.querySelector<HTMLElement>(".profile-keys")!;
      me.passkeys.forEach((k, i) => {
        const li = document.createElement("li");
        const label = `Passkey ${i + 1}`;
        const used = k.lastUsedAt ? `, last used ${fmtDate(k.lastUsedAt)}` : "";
        li.innerHTML = `<span><strong></strong> <span class="profile-hint"></span></span>`;
        li.querySelector("strong")!.textContent = label;
        li.querySelector(".profile-hint")!.textContent = `added ${fmtDate(k.createdAt)}${used}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "profile-btn profile-btn--small";
        const last = confirmLastKey === k.id;
        remove.textContent = last ? "Remove anyway" : "Remove";
        remove.id = `pf-remove-${i}`;
        remove.setAttribute("aria-label", last ? `Remove ${label} anyway, your last passkey` : `Remove ${label}`);
        remove.addEventListener("click", () =>
          act(async () => {
            try {
              me = await removePasskey(k.id, last);
              confirmLastKey = null;
              status = `${label} removed.`;
            } catch (e) {
              if (e instanceof ApiError && e.body.last === true) {
                confirmLastKey = k.id;
                status = `${e.message} Press "Remove anyway" to go ahead.`;
              } else throw e;
            }
          }),
        );
        li.append(remove);
        list.append(li);
      });
    }
    const lookForm = body.querySelector<HTMLFormElement>(".look-form");
    if (lookForm) {
      const readLook = (): Look => {
        const data = new FormData(lookForm);
        return {
          shirt: data.get("look-shirt"),
          shorts: data.get("look-shorts"),
          skin: data.get("look-skin"),
          hair: data.get("look-hair"),
          style: data.get("look-style"),
        } as Look;
      };
      lookForm.addEventListener("change", () => {
        // live preview only; nothing is sent until Save
        draftLook = readLook();
        body.querySelector(".look-preview")!.innerHTML = lookSvg(draftLook, "Preview of your player");
      });
      lookForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const look = readLook();
        void act(async () => {
          me = await saveLook(look);
          draftLook = null;
          status = me.look && sameLook(me.look, look) ? "Look saved. Everyone in your next room sees it." : "Look saved.";
          hooks.onIdentityChange();
        });
      });
    }
    const strong = body.querySelector<HTMLElement>(".profile-name strong");
    if (strong && me) strong.textContent = me.name;
    for (const b of box.querySelectorAll<HTMLButtonElement>("button")) if (b.dataset.act !== "close") b.disabled = busy;

    box.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => {
      b.addEventListener("click", () => {
        switch (b.dataset.act) {
          case "close":
            dialog.close();
            break;
          case "claim":
            void act(async () => {
              changed(await addPasskey());
              status = "Account created. You can now choose your name.";
            });
            break;
          case "add":
            void act(async () => {
              me = await addPasskey();
              status = "Passkey added.";
            });
            break;
          case "signin":
            void act(async () => {
              changed(await signIn());
              status = "Signed in.";
            });
            break;
          case "signout":
            void act(async () => {
              await signOut();
              changed(await fetchMe());
              status = "Signed out. You're playing as a guest.";
            });
            break;
          case "delete":
            confirmDelete = true;
            render();
            break;
          case "delete-cancel":
            confirmDelete = false;
            render();
            break;
          case "delete-confirm":
            void act(async () => {
              await deleteAccount();
              confirmDelete = false;
              changed(await fetchMe());
              status = "Account deleted. You're a new guest now.";
            });
            break;
        }
      });
    });
    // keep focus where it was across a redraw
    const again = focusedId ? dialog.querySelector<HTMLElement>(`#${focusedId}`) : null;
    if (again && !(again as HTMLButtonElement).disabled) again.focus();
    else if (!dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>(".profile-close")?.focus();
  }

  dialog.addEventListener("close", () => dialog.remove());
  // a click on the dimmed backdrop (outside the box) closes it
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  render();
  dialog.showModal();
  void fetchMe()
    .then((m) => {
      me = m;
      render();
    })
    .catch(() => {
      status = "Couldn't load your profile.";
      render();
    });
}
