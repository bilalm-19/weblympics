// Task 34: the Friends button (beside the profile button) and its panel,
// styled after the approved mock (client/mock-home.html): "Show me as"
// Online / Away / Offline, your own Name#1234 and friend link, "Add a
// friend: Name#1234", requests (Accept / ✕), then friends grouped Online,
// Away and Offline with what they're doing and one action each (Watch a
// match, Join a public party, Invite). A popover on desktop, a bottom sheet
// on a phone. Renders only what the server pushes (social-state.ts); adding
// and answering are /api POSTs, and the server's lists follow over the socket.
import { DEFAULT_LOOKS } from "../../shared/look.ts";
import type { FriendView, RequestView, ShownStatus } from "../../shared/protocol.ts";
import { acceptFriend, addFriend, declineFriend, makeFriendLink, removeFriend } from "../net/account.ts";
import { el, sheet, svg } from "./dom.ts";
import { lookSvg } from "./look-preview.ts";
import { problem } from "./profile.ts";
import type { SocialState } from "./social-state.ts";
import { tagged } from "./social-state.ts";
import "./friends.css";

export interface FriendsWho {
  name: string;
  tag: string | null;
  account: boolean;
}

export interface FriendsActions {
  /** Watch a friend's match (the watch link's way in: never takes a seat). */
  onWatch(room: string): void;
  /** Open the party panel (yours, or the one just joined). */
  onParty(): void;
  /** In a room (not practice): Invite asks them to this room rather than starting a party. */
  inRoom?(): boolean;
}

const GAME_NAMES: Record<string, string> = { tennis: "Tennis", archery: "Archery", track: "Track", boxing: "Boxing", basketball: "Basketball", bowling: "Bowling" };
export const gameName = (id: string): string => GAME_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

const STATUS_WORDS: Record<ShownStatus, string> = { online: "Online", away: "Away", offline: "Offline" };

export const GUEST_NOTE = "Guests can't add friends: a guest has no lasting identity. Create an account with a passkey (profile, top right) to add friends.";
export const GUEST_PARTY_NOTE = "You can still start a party, or join one, by its link.";

/** What a friend is doing, in words. */
export function doingText(f: FriendView): string {
  const d = f.doing;
  if (!d) return f.status === "offline" ? "Offline" : "";
  if (d.kind === "match") return `In a match · ${gameName(d.game)}`;
  if (d.kind === "practice") return `Practising · ${gameName(d.game)}`;
  if (d.kind === "party") return `Public party · ${d.size} of 10 · ${gameName(d.game)}`;
  return f.status === "away" ? "Away" : "On the home screen";
}

const dot = (s: ShownStatus) => el("span", { class: `sdot sdot--${s}`, "aria-hidden": "true" });
const avatar = (p: { look: FriendView["look"] }, status?: ShownStatus) =>
  el("span", { class: "fr-av" }, svg(lookSvg(p.look ?? DEFAULT_LOOKS[0], null, "head")), status ? dot(status) : null);

/** The "Friends · N online" button; null until the server says who you are. */
export function friendsButton(who: FriendsWho, social: SocialState, actions: FriendsActions): HTMLButtonElement | null {
  if (!who.name) return null;
  const button = el("button", { type: "button", class: "fr-button", "aria-haspopup": "dialog", "aria-expanded": "false" });
  const draw = () => {
    const n = social.onlineCount();
    button.replaceChildren(el("span", { class: "fr-icon", "aria-hidden": "true" }, svg(PEOPLE_ICON)), el("span", { class: "fr-label", text: "Friends" }));
    if (who.account) button.append(el("span", { class: "fr-count" }, dot("online"), el("span", { class: "fr-n", "data-short": n > 9 ? "9+" : String(n), text: String(n) }), el("span", { class: "fr-olabel", text: " online" })));
    const reqs = social.state.requests.length;
    button.setAttribute("aria-label", who.account ? `Friends: ${n} online${reqs ? `, ${reqs} request${reqs === 1 ? "" : "s"}` : ""}` : "Friends");
    if (reqs) button.append(el("span", { class: "fr-badge", "aria-hidden": "true", text: reqs > 9 ? "9+" : String(reqs) }));
  };
  draw();
  const off = social.subscribe(() => (button.isConnected ? draw() : off()));
  button.addEventListener("click", () => openFriends(button, who, social, actions));
  return button;
}

const PEOPLE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="9" cy="8" r="3.6" fill="currentColor"/><path d="M2.5 20c0-4 2.9-6.5 6.5-6.5s6.5 2.5 6.5 6.5z" fill="currentColor"/><circle cx="17" cy="9" r="2.8" fill="currentColor" opacity=".6"/><path d="M15.5 13.7c3.6-.4 6 1.9 6 5.3h-4.4" fill="currentColor" opacity=".6"/></svg>`;

export function openFriends(opener: HTMLElement | null, who: FriendsWho, social: SocialState, actions: FriendsActions): void {
  document.querySelector<HTMLDialogElement>("dialog.fr-panel")?.close();
  const { dialog, close } = sheet("fr-panel", "Friends", opener, opener?.closest(".menu") ?? document.body);
  const status = el("p", { class: "fr-msg", role: "status", "aria-live": "polite" });
  const say = (text: string) => (status.textContent = text);
  const run = (fn: () => Promise<string | void>) =>
    fn().then(
      (text) => text && say(text),
      (e: unknown) => say(problem(e)),
    );

  const head = el("header", { class: "fr-head" }, el("h2", { text: "Friends" }), el("button", { type: "button", class: "fr-x", "aria-label": "Close friends", text: "✕" }));
  head.querySelector("button")!.addEventListener("click", close);
  dialog.append(head);

  if (!who.account) {
    // a guest has no friends list, but may start, lead and share a party by
    // its link (user, 2026-11-08)
    const bar = el("div", { class: "fr-partybar" });
    const drawBar = () => {
      const party = social.state.party;
      const pb = el("button", { type: "button", class: "fr-partybtn", text: party ? `Your party · ${party.members.length} of 10` : "Start a party" });
      pb.addEventListener("click", () => {
        if (!social.state.party) social.link.send({ t: "party", act: "create" });
        close();
        actions.onParty();
      });
      bar.replaceChildren(pb);
    };
    drawBar();
    const off = social.subscribe(() => (dialog.isConnected ? drawBar() : off()));
    dialog.addEventListener("close", () => off());
    dialog.append(el("p", { class: "fr-note", text: GUEST_NOTE }), el("p", { class: "fr-note", text: GUEST_PARTY_NOTE }), el("div", { class: "fr-list" }, bar));
    dialog.showModal();
    head.querySelector("button")!.focus();
    return;
  }

  // ---- show me as ----
  const mine = el("div", { class: "fr-mystatus", role: "group", "aria-label": "Show me as" });
  for (const s of ["online", "away", "offline"] as const) {
    const b = el("button", { type: "button", "data-status": s, title: s === "offline" ? "Friends see you as offline" : s === "away" ? "Friends see you as away" : "Friends see you online" }, dot(s), STATUS_WORDS[s]);
    b.addEventListener("click", () => {
      social.setStatus(s);
      say(s === "offline" ? "Friends now see you as offline." : s === "away" ? "Friends now see you as away." : "Friends now see you online.");
    });
    mine.append(b);
  }

  // ---- you, and your friend link ----
  const me = el(
    "div",
    { class: "fr-me" },
    el("span", { class: "fr-me-text" }, "You are ", el("strong", { class: "fr-me-tag", text: `${who.name}#${who.tag ?? "????"}` })),
    el("button", { type: "button", class: "fr-link", text: "Copy friend link" }),
  );
  me.querySelector(".fr-link")!.addEventListener("click", () =>
    run(async () => {
      const { code } = await makeFriendLink();
      const url = `${location.origin}/#/friend/${code}`;
      try {
        await navigator.clipboard.writeText(url);
        return "Friend link copied. It works once, for a day.";
      } catch {
        return `Friend link (works once, for a day): ${url}`;
      }
    }),
  );

  // ---- add ----
  const form = el(
    "form",
    { class: "fr-add" },
    el("input", { name: "who", placeholder: "Add a friend: Name#1234", "aria-label": "Friend's name and number, like Sam#4821", autocomplete: "off", spellcheck: "false", maxlength: "40" }),
    el("button", { type: "submit", text: "Add" }),
  );
  const input = form.querySelector("input")!;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!/#\s*\d{4}\s*$/.test(value)) return say("Type their name and number, like Sam#4821. Their number is next to their name in their friends list.");
    run(async () => {
      const r = await addFriend(value);
      input.value = "";
      return r.outcome === "friends" ? `You and ${value} are now friends.` : r.outcome === "already" ? `${value} is already your friend.` : `Request sent to ${value}.`;
    });
  });

  const list = el("div", { class: "fr-list" });
  // who was invited while the panel is open: the server's pushes redraw the
  // list (inviting can start a party), and "Invited ✓" must survive that
  const invited = new Set<string>();
  dialog.append(mine, me, form, status, list);

  const drawMine = () => {
    for (const b of mine.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(b.dataset.status === social.state.status));
  };

  const requestRow = (r: RequestView) => {
    const who = tagged(r);
    const accept = el("button", { type: "button", class: "fr-ok", "aria-label": `Accept ${who}`, text: "Accept" });
    const decline = el("button", { type: "button", class: "fr-no", "aria-label": `Decline ${who}`, text: "✕" });
    accept.addEventListener("click", () => run(async () => (await acceptFriend(who), `You and ${who} are now friends.`)));
    decline.addEventListener("click", () => run(async () => void (await declineFriend(who))));
    return el("li", { class: "fr-row" }, avatar(r), el("span", { class: "fr-who" }, nameLine(r), el("span", { class: "fr-doing", text: "Wants to be friends" })), el("span", { class: "fr-req" }, accept, decline));
  };

  const friendRow = (f: FriendView) => {
    const who = tagged(f);
    const row = el("li", { class: `fr-row${f.status === "offline" ? " fr-row--off" : ""}`, "data-status": f.status }, avatar(f, f.status), el("span", { class: "fr-who" }, nameLine(f), el("span", { class: "fr-doing", text: doingText(f) })));
    const d = f.doing;
    let act: HTMLButtonElement | null = null;
    if (d?.kind === "match") {
      act = el("button", { type: "button", class: "fr-act fr-act--watch", "aria-label": `Watch ${who}'s match`, text: "Watch" });
      act.addEventListener("click", () => {
        close();
        actions.onWatch(d.room);
      });
    } else if (d?.kind === "party" && social.state.party?.code !== d.code) {
      act = el("button", { type: "button", class: "fr-act fr-act--join", "aria-label": `Join ${who}'s party`, text: "Join" });
      act.addEventListener("click", () => {
        social.link.send({ t: "party", act: "join", code: d.code });
        close();
        actions.onParty();
      });
    } else if (f.status !== "offline") {
      const sent = invited.has(who);
      const toRoom = !social.state.party && (actions.inRoom?.() ?? false);
      act = el("button", { type: "button", class: "fr-act", "aria-label": `Invite ${who} to your ${toRoom ? "match" : "party"}`, text: sent ? "Invited ✓" : "Invite" });
      act.disabled = sent;
      act.addEventListener("click", () => {
        invited.add(who);
        act!.textContent = "Invited ✓";
        act!.disabled = true;
        // no party yet (and not in a room): start one, then invite (the socket keeps the order)
        if (!social.state.party && !toRoom) social.link.send({ t: "party", act: "create" });
        social.link.send({ t: "invite", to: who });
      });
    }
    // remove takes two clicks, so a slip doesn't unfriend anyone
    const remove = el("button", { type: "button", class: "fr-remove", "aria-label": `Remove ${who} from friends`, title: "Remove friend", text: "⋯" });
    let armed = false;
    remove.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        remove.textContent = "Remove?";
        remove.classList.add("is-armed");
        remove.setAttribute("aria-label", `Confirm: remove ${who} from friends`);
        return;
      }
      run(async () => (await removeFriend(who), `${who} removed.`));
    });
    row.append(el("span", { class: "fr-acts" }, act, remove));
    return row;
  };

  const group = (title: string, items: HTMLElement[]) =>
    items.length ? [el("h3", { class: "fr-group", text: `${title} · ${items.length}` }), el("ul", { class: "fr-ul", "aria-label": title }, ...items)] : [];

  const drawList = () => {
    const { friends, requests, loaded, party } = social.state;
    const by = (s: ShownStatus) => friends.filter((f) => f.status === s).map(friendRow);
    const partyBar = el("div", { class: "fr-partybar" });
    if (actions.inRoom?.() && !party) partyBar.hidden = true;
    const pb = el("button", { type: "button", class: "fr-partybtn", text: party ? `Your party · ${party.members.length} of 10` : "Start a party" });
    pb.addEventListener("click", () => {
      if (!party) social.link.send({ t: "party", act: "create" });
      close();
      actions.onParty();
    });
    partyBar.append(pb);
    list.replaceChildren(
      partyBar,
      ...group("Requests", requests.map(requestRow)),
      ...group("Online", by("online")),
      ...group("Away", by("away")),
      ...group("Offline", by("offline")),
    );
    if (loaded && friends.length === 0 && requests.length === 0) list.append(el("p", { class: "fr-empty", text: "No friends yet. Add someone by their name and number, or send them your friend link." }));
  };

  drawMine();
  drawList();
  const off = social.subscribe(() => {
    if (!dialog.isConnected) return off();
    drawMine();
    drawList();
  });
  const offNotice = social.onNotice((m) => (dialog.isConnected ? say(m) : offNotice()));
  dialog.addEventListener("close", () => {
    off();
    offNotice();
  });
  dialog.showModal();
  mine.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
}

function nameLine(p: { name: string; tag: string }): HTMLElement {
  return el("span", { class: "fr-name" }, el("span", { class: "fr-n1", text: p.name }), el("span", { class: "fr-tag", text: `#${p.tag}` }));
}
