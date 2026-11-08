// Task 34: the party, on the page. In the lobby (this panel) every member is
// shown: picture, name, status, the leader's crown and who plays next; the
// leader picks the game, who plays next (leader picks, winner stays on, both
// swap out, randomise), public (listed to the leader's friends) or invite
// only, and starts the next match. In a game the party shows compact: one
// strip in the HUD's own row, never over the court or the HUD's buttons.
// A friend's invite arrives as a small pop-up, "Sam invites you to Tennis.
// Join?". No chat of any kind (user, 2026-11-08). Renders only what the
// server pushes; every leader action is checked again on the server.
import { DEFAULT_LOOKS } from "../../shared/look.ts";
import { MAX_PARTY, PARTY_MODES } from "../../shared/protocol.ts";
import type { PartyMember, PartyMode, PartyView } from "../../shared/protocol.ts";
import { el, sheet, svg } from "./dom.ts";
import { gameName } from "./friends.ts";
import { lookSvg } from "./look-preview.ts";
import type { Invite, SocialState } from "./social-state.ts";
import { tagged } from "./social-state.ts";
import "./party.css";

export const MODE_WORDS: Record<PartyMode, { name: string; note: string }> = {
  pick: { name: "Leader picks", note: "The leader chooses the two who play." },
  winner: { name: "Winner stays on", note: "The loser goes to the back of the queue." },
  swap: { name: "Both swap out", note: "Both players go to the back; the next two play." },
  random: { name: "Randomise", note: "Two members at random, not the pair who just played." },
};

/** The games a party may pick (the menu's playable sports). */
export interface PartyActions {
  games: { id: string; name: string }[];
  /** Watch the party's current match (it never takes a seat). */
  onWatch(room: string): void;
  /**
   * Signed in (the welcome's word): an account sees the friends to invite
   * and "Public to friends"; a guest has no friends list, so shares the
   * party link (user, 2026-11-08). The server checks both again.
   */
  account(): boolean;
}

export const partyUrl = (code: string): string => `${location.origin}/#/party/${code}`;

const nextNames = (p: PartyView): [string, string] | null => {
  if (!p.next) return null;
  const n = (id: string) => p.members.find((m) => m.id === id)?.name ?? "?";
  return [n(p.next[0]), n(p.next[1])];
};

/** "Ana vs Ben play next" or why nobody can yet. */
export function nextText(p: PartyView): string {
  const n = nextNames(p);
  return n ? `Next: ${n[0]} vs ${n[1]}` : "Invite someone: a match needs two.";
}

export function partyButton(social: SocialState, actions: PartyActions): HTMLButtonElement {
  const button = el("button", { type: "button", class: "pt-button", "aria-haspopup": "dialog", "aria-expanded": "false" });
  const draw = () => {
    const p = social.state.party;
    button.hidden = !p;
    if (p) {
      button.textContent = `Party · ${p.members.length}`;
      button.setAttribute("aria-label", `Your party: ${p.members.length} of ${MAX_PARTY}`);
    }
  };
  draw();
  const off = social.subscribe(() => (button.isConnected ? draw() : off()));
  button.addEventListener("click", () => openParty(button, social, actions));
  return button;
}

export function openParty(opener: HTMLElement | null, social: SocialState, actions: PartyActions): void {
  document.querySelector<HTMLDialogElement>("dialog.pt-panel")?.close();
  const { dialog, close } = sheet("pt-panel", "Party", opener, opener?.closest(".menu") ?? document.body);
  const status = el("p", { class: "pt-msg", role: "status", "aria-live": "polite" });
  const body = el("div", { class: "pt-body" });
  const title = el("h2", { text: "Party" });
  const x = el("button", { type: "button", class: "fr-x", "aria-label": "Close party", text: "✕" });
  x.addEventListener("click", close);
  dialog.append(el("header", { class: "fr-head" }, title, x), body, status);
  const send = (msg: Parameters<SocialState["link"]["send"]>[0]) => social.link.send(msg);
  let picks: string[] = [];
  // invited while open, kept across the server's redraws
  const invited = new Set<string>();

  const memberRow = (m: PartyMember, p: PartyView, leader: boolean) => {
    const playing = p.next?.includes(m.id) ?? false;
    const row = el(
      "li",
      { class: `pt-member${playing ? " pt-member--next" : ""}`, "data-status": m.status },
      el("span", { class: "fr-av" }, svg(lookSvg(m.look ?? DEFAULT_LOOKS[0], null, "head")), el("span", { class: `sdot sdot--${m.status}`, "aria-hidden": "true" })),
      el(
        "span",
        { class: "pt-who" },
        el("span", { class: "pt-name" }, el("span", { text: m.name }), m.you ? el("span", { class: "pt-you", text: " (you)" }) : null, m.leader ? el("span", { class: "pt-crown", title: "Party leader", "aria-label": "leader", text: " 👑" }) : null),
        el("span", { class: "pt-sub", text: `${m.status === "online" ? "Online" : m.status === "away" ? "Away" : "Offline"}${playing ? " · plays next" : " · watches"}` }),
      ),
    );
    if (leader && p.mode === "pick") {
      const box = el("input", { type: "checkbox", class: "pt-pick", "aria-label": `Pick ${m.name} to play` }) as HTMLInputElement;
      box.checked = picks.includes(m.id);
      box.addEventListener("change", () => {
        picks = box.checked ? [...picks.filter((i) => i !== m.id), m.id].slice(-2) : picks.filter((i) => i !== m.id);
        if (picks.length === 2) send({ t: "party", act: "pick", ids: [picks[0], picks[1]] });
        draw();
      });
      row.append(box);
    }
    if (leader && !m.you) {
      const crown = el("button", { type: "button", class: "pt-small", "aria-label": `Make ${m.name} the leader`, text: "Make leader" });
      crown.addEventListener("click", () => send({ t: "party", act: "lead", id: m.id }));
      row.append(crown);
    }
    return row;
  };

  const draw = () => {
    const p = social.state.party;
    if (!p) {
      title.textContent = "Party";
      const start = el("button", { type: "button", class: "pt-primary", text: "Start a party" });
      start.addEventListener("click", () => send({ t: "party", act: "create" }));
      body.replaceChildren(el("p", { class: "fr-note", text: "Play with up to 9 others: two play, the rest watch, and the party moves to the next match together. Share the party link to bring people in." }), start);
      return;
    }
    const me = p.members.find((m) => m.you);
    const leader = me?.leader ?? false;
    if (p.mode !== "pick") picks = [];
    title.textContent = p.members.length >= MAX_PARTY ? `Your party · full (${MAX_PARTY} of ${MAX_PARTY})` : `Your party · ${p.members.length} of ${MAX_PARTY}`;
    const parts: Node[] = [];
    parts.push(el("p", { class: "pt-next", text: `${gameName(p.game)} · ${nextText(p)}` }));
    if (p.last) parts.push(el("p", { class: "pt-last", text: p.last }));
    parts.push(el("ul", { class: "pt-members", "aria-label": "Members" }, ...p.members.map((m) => memberRow(m, p, leader))));

    if (leader) {
      const game = el("select", { "aria-label": "Game" }) as HTMLSelectElement;
      for (const g of actions.games) game.append(el("option", { value: g.id, text: g.name }));
      game.value = p.game;
      game.addEventListener("change", () => send({ t: "party", act: "game", game: game.value }));
      const modes = el("div", { class: "pt-modes", role: "radiogroup", "aria-label": "Who plays next" });
      for (const mode of PARTY_MODES) {
        const b = el("button", { type: "button", role: "radio", "aria-checked": String(p.mode === mode), title: MODE_WORDS[mode].note, text: MODE_WORDS[mode].name });
        b.addEventListener("click", () => send({ t: "party", act: "mode", mode }));
        modes.append(b);
      }
      // public means listed to the leader's friends: only an account has any
      const vis = el("div", { class: "pt-modes", role: "radiogroup", "aria-label": "Who can find the party" });
      for (const pub of [false, true]) {
        const b = el("button", { type: "button", role: "radio", "aria-checked": String(p.public === pub), text: pub ? "Public to friends" : "Invite only" });
        b.addEventListener("click", () => send({ t: "party", act: "public", public: pub }));
        vis.append(b);
      }
      const account = actions.account();
      const startMatch = el("button", { type: "button", class: "pt-primary", text: p.room ? "Start the next match" : "Start the match" });
      startMatch.disabled = !p.next;
      startMatch.addEventListener("click", () => {
        send({ t: "party", act: "start" });
        close();
      });
      parts.push(
        el("label", { class: "pt-field" }, el("span", { text: "Game" }), game),
        el("div", { class: "pt-field" }, el("span", { text: "Who plays next" }), modes),
        el("p", { class: "pt-note", text: MODE_WORDS[p.mode].note + (p.mode === "pick" ? " Tick two members." : "") }),
        ...(account
          ? [
              el("div", { class: "pt-field" }, el("span", { text: "Who can find it" }), vis),
              el("p", { class: "pt-note", text: p.public ? "Your friends see it in their friends list and can join." : "Only people you invite, or who have the link, can join." }),
            ]
          : [el("p", { class: "pt-note", text: "Only people with the party link can join." })]),
        startMatch,
      );
    } else {
      parts.push(el("p", { class: "pt-note", text: `${MODE_WORDS[p.mode].name} · ${p.public ? "public to the leader's friends" : "invite only"}. The leader starts each match.` }));
    }
    if (p.room) {
      const watch = el("button", { type: "button", class: "pt-secondary", text: "Go to the party's match" });
      watch.addEventListener("click", () => {
        close();
        actions.onWatch(p.room!);
      });
      parts.push(watch);
    }

    // the party link, for every member (guests too): whoever has it may join
    const copy = el("button", { type: "button", class: "pt-secondary", text: "Copy party link" });
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(partyUrl(p.code)).then(
        () => (status.textContent = "Party link copied: whoever has it can join."),
        () => (status.textContent = `Party link: ${partyUrl(p.code)}`),
      );
    });
    const full = p.members.length >= MAX_PARTY;
    // invite: an account's friends who are around and not in the party yet;
    // a guest has no friends list, so only the link (user, 2026-11-08)
    const inParty = new Set(p.members.map((m) => m.name));
    const around = social.state.friends.filter((f) => f.status !== "offline" && !inParty.has(f.name));
    if (!actions.account()) {
      parts.push(el("h3", { class: "fr-group", text: "Invite" }), el("p", { class: "pt-note", text: full ? "The party is full: the link works again when someone leaves." : "Send the party link to whoever you want to play with." }), copy);
    } else if (full) {
      parts.push(el("h3", { class: "fr-group", text: "Invite" }), el("p", { class: "pt-note", text: "The party is full: the link works again when someone leaves." }), copy);
    } else {
      const invites = el("ul", { class: "pt-invites", "aria-label": "Invite friends" });
      for (const f of around) {
        const sent = invited.has(tagged(f));
        const b = el("button", { type: "button", class: "fr-act", "aria-label": `Invite ${tagged(f)}`, text: sent ? "Invited ✓" : "Invite" });
        b.disabled = sent;
        b.addEventListener("click", () => {
          invited.add(tagged(f));
          b.textContent = "Invited ✓";
          b.disabled = true;
          send({ t: "invite", to: tagged(f) });
        });
        invites.append(el("li", { class: "fr-row" }, el("span", { class: "fr-who" }, el("span", { class: "fr-name", text: f.name })), b));
      }
      parts.push(el("h3", { class: "fr-group", text: "Invite" }), around.length ? invites : el("p", { class: "pt-note", text: "No friends online to invite. Send the party link instead." }), copy);
    }
    const leave = el("button", { type: "button", class: "pt-leave", text: "Leave party" });
    leave.addEventListener("click", () => {
      send({ t: "party", act: "leave" });
      close();
    });
    parts.push(leave);
    body.replaceChildren(...parts);
  };

  draw();
  const off = social.subscribe(() => (dialog.isConnected ? draw() : off()));
  const offNotice = social.onNotice((m) => (dialog.isConnected ? (status.textContent = m) : offNotice()));
  dialog.addEventListener("close", () => {
    off();
    offNotice();
  });
  dialog.showModal();
  dialog.querySelector<HTMLElement>(".pt-primary, .pt-body button")?.focus();
}

/**
 * The party, compact, in a game's HUD (its own row, like the watch badge):
 * "Party · 4 · Next: Ana vs Ben", the leader's "Next match" once this one is
 * over, and a button to the panel. Returns dispose.
 */
export function addPartyStrip(root: HTMLElement, social: SocialState, actions: PartyActions, inMatch: () => boolean, onInvite: (() => void) | null): () => void {
  const hud = root.querySelector<HTMLElement>(".hud");
  if (!hud) return () => {};
  const strip = el("div", { class: "party-strip", role: "group", "aria-label": "Party" });
  hud.append(strip);
  const draw = () => {
    const p = social.state.party;
    // an account in a room can invite friends to it; a guest sees nothing here
    const invite = onInvite ? el("button", { type: "button", class: "ps-open", text: "Invite friends" }) : null;
    invite?.addEventListener("click", () => onInvite!());
    strip.hidden = !p && !invite;
    if (!p) return strip.replaceChildren(...(invite ? [invite] : []));
    const leader = p.members.some((m) => m.you && m.leader);
    const open = el("button", { type: "button", class: "ps-open", "aria-label": `Party: ${p.members.length} members. Open the party`, text: `Party · ${p.members.length}` });
    open.addEventListener("click", () => openParty(open, social, actions));
    const next = el("span", { class: "ps-next", text: nextText(p) });
    const parts: Node[] = [open, next];
    if (invite) parts.push(invite);
    if (leader && !inMatch() && p.next) {
      const go = el("button", { type: "button", class: "ps-go", text: "Next match" });
      go.addEventListener("click", () => social.link.send({ t: "party", act: "start" }));
      parts.push(go);
    }
    strip.replaceChildren(...parts);
  };
  draw();
  const off = social.subscribe(draw);
  // the match ending changes whether "Next match" shows
  const timer = setInterval(draw, 1000);
  return () => {
    off();
    clearInterval(timer);
    strip.remove();
  };
}

/** A friend's invite: a small pop-up, never modal, gone after 30 s. */
export function showInvite(invite: Invite, onJoin: () => void): void {
  document.querySelector(".invite-toast")?.remove();
  const who = invite.from.name;
  const text = invite.kind === "party" ? `${who} invites you to their party (${gameName(invite.game)}). Join?` : `${who} invites you to ${gameName(invite.game)}. Join?`;
  const join = el("button", { type: "button", class: "it-join", text: "Join" });
  const later = el("button", { type: "button", class: "it-later", text: "Not now" });
  const toast = el(
    "div",
    { class: "invite-toast", role: "alertdialog", "aria-label": `Invite from ${who}`, "aria-live": "assertive" },
    el("span", { class: "fr-av" }, svg(lookSvg(invite.from.look ?? DEFAULT_LOOKS[0], null, "head"))),
    el("p", { text }),
    el("span", { class: "it-acts" }, join, later),
  );
  const done = () => {
    clearTimeout(timer);
    toast.remove();
  };
  join.addEventListener("click", () => {
    done();
    onJoin();
  });
  later.addEventListener("click", done);
  toast.addEventListener("keydown", (e) => e.key === "Escape" && done());
  const timer = setTimeout(done, 30_000);
  document.body.append(toast);
}
