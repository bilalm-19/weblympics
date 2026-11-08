import { DEFAULT_LOOKS } from "../../shared/look.ts";
import type { Look } from "../../shared/look.ts";
import { MAX_PARTY } from "../../shared/protocol.ts";
import type { PartyMember, PartyView, ShownStatus } from "../../shared/protocol.ts";
import { RINGS } from "./brand.ts";
import { wants3dIcons } from "./home-3d-gate.ts";
import { ART, PLAIN_ART, sceneSvg } from "./home-art.ts";
import type { SportArt } from "./home-art.ts";
import { lookSvg } from "./look-preview.ts";
import { profileButton } from "./profile-menu.ts";
import type { ProfileMenuActions, ProfileMenuWho } from "./profile-menu.ts";

// The home screen (task 36, the mock the user approved on 2026-11-08). One
// screen, three columns of equal height on a desktop: the six sport cards on
// the left, the selected sport in the middle (a big looping preview, its
// name, a line and the input chip, "Create a room", then the smaller
// buttons and the room code box), and your party on the right (you alone,
// "Ready to play!", or the party the server pushed, up to ten). The logo is
// centred in a three-column top bar; Friends, sound and the profile button
// sit top right. A phone stacks it: sports 3x2, the panel, the party as a
// strip. All of it is inline SVG and CSS (home-art.ts): the menu never
// imports Three.js. The cards' small 3D icons (home-3d.ts) are fetched only
// after the flat page is drawn, and only where home-3d-gate.ts allows.

/**
 * The profile button's actions (top right: sign in and out, the demo
 * accounts, the profile dialog, task 7's leaderboard) and the sport options.
 */
export interface MenuActions extends ProfileMenuActions {
  /** Training (task 5, tennis) or practice (the other sports): runs in the page, no server. */
  onTrain(sport: string): void;
  /** A room against the bot, for the selected sport. */
  onPractice(sport: string): void;
  onCreate(sport: string): void;
  onJoin(code: string): void;
  /** The player picked a playable sport. */
  onSelect?(sport: string): void;
  /** The party panel (task 34): start one, or yours with its invites. */
  onParty?(opener: HTMLElement): void;
  /** "Change my look": the profile dialog, at its customise section. */
  onLook?(): void;
}

/** Who the home screen says is playing; `look` is drawn as the profile picture and in the party. */
export type Identity = ProfileMenuWho;

/** What the party panel shows: the server's word on friends and the party (client/ui/social-state.ts). */
export interface PartySource {
  state: { party: PartyView | null; status: ShownStatus };
  subscribe(fn: () => void): () => void;
}

/** One sport on the home screen. Adding a sport is one entry in SPORTS (and its art in home-art.ts). */
export interface Sport {
  id: string;
  name: string;
  /** Only playable sports can be selected or start anything on the server. */
  playable: boolean;
  /** A few words on its card. */
  tag: string;
  /** One line under the preview. */
  blurb: string;
  /** How you play it: the chip beside the line. */
  input: string;
}

/**
 * The sports on the home screen, in menu order. All six are playable
 * (CLAUDE.md). A `playable: false` entry is a "coming soon" placeholder:
 * aria-disabled, it only changes the preview, can't be selected and never
 * reaches the server.
 */
export const SPORTS: Sport[] = [
  { id: "tennis", name: "Tennis", playable: true, tag: "Rally and smash", blurb: "Rally against the bot or a friend. Swing to hit.", input: "Camera or keyboard" },
  { id: "bowling", name: "Bowling", playable: true, tag: "Five frames", blurb: "Pick your spot, add some curve, knock the pins down.", input: "Camera, keys or buttons" },
  { id: "archery", name: "Archery", playable: true, tag: "Read the wind", blurb: "Draw, aim, read the wind and hit the gold.", input: "Camera or mouse" },
  { id: "track", name: "Track", playable: true, tag: "Sprint 100 m", blurb: "Run on the spot and race to the line.", input: "Camera or A and D" },
  { id: "boxing", name: "Boxing", playable: true, tag: "Jab and guard", blurb: "Three quick rounds. Jab, guard and slip.", input: "Camera, keys or buttons" },
  { id: "basketball", name: "Basketball", playable: true, tag: "Shootout", blurb: "Five spots, one shot each. Swish for a bonus.", input: "Camera, keys or mouse" },
];

const artOf = (s: Sport): SportArt => ART[s.id] ?? PLAIN_ART;

/**
 * The logo (task 14, redrawn for task 36): five rings that overlap in a
 * zig-zag, the second and fourth dropped by half a ring, as the user asked
 * (2026-11-08); drawn flat, never woven over and under. Then the word, each
 * letter in one of the ring colours with a dark outline (the black ring's
 * letters white, so they read). Letters bounce in once on load; the rings
 * float a little on a slow loop. A still frame under reduced motion.
 */
// The menu is drawn again when the server's welcome arrives (and on every
// return from a game); the bounce carries on from where it was instead of
// starting over, so it plays once per page load.
let bounceStart: number | null = null;

// ring geometry, in the logo's own units: radius, stroke, the step between
// centres (overlapping by 44% of a ring) and the drop of rings 2 and 4
const R = 12;
const STROKE = 4;
const OUTER = 2 * R + STROKE;
const STEP = OUTER * 0.56;
const DROP = OUTER * 0.5;

export function logo(): string {
  bounceStart ??= performance.now();
  const since = Math.round(performance.now() - bounceStart);
  const w = 4 * STEP + OUTER;
  const h = OUTER + DROP;
  const rings = RINGS.map(
    (r, i) =>
      `<circle class="logo-ring logo-ring--${r.name}" cx="${(OUTER / 2 + i * STEP).toFixed(2)}" cy="${(OUTER / 2 + (i % 2 ? DROP : 0)).toFixed(2)}" r="${R}" stroke-width="${STROKE}" style="--i:${i}" stroke="${r.hex}"/>`,
  ).join("");
  const letters = [..."Weblympics"].map((ch, i) => `<span class="logo-letter" style="--i:${i}; --c:${i % 5 === 2 ? "#ffffff" : RINGS[i % 5].hex}">${ch}</span>`).join("");
  return `
    <h1 class="logo" aria-label="Weblympics" style="--since:${since}ms">
      <svg class="logo-rings" viewBox="${-2} ${-2} ${(w + 4).toFixed(2)} ${(h + 4).toFixed(2)}" aria-hidden="true" focusable="false">${rings}</svg>
      <span class="logo-word">${letters}</span>
    </h1>`;
}

// A chunky pointer arrow, drawn here (not a Nintendo asset), that marks the
// focused or hovered sport card.
const POINTER = `<svg class="pointer" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <path d="M6 3 L6 25 L11.5 20 L15.5 29 L20 27 L16 18.5 L24 18.5 Z" fill="#fff" stroke="#1769b8" stroke-width="2.4" stroke-linejoin="round"/>
</svg>`;

// Each action's little picture (emoji, as in the mock; decorative).
const ICO = { create: "🏟️", practice: "🤖", train: "🎯", party: "🎉" };

/** The vs-the-bot and in-page buttons' words: tennis has a bot match and training; the rest a bot match and practice. */
const practiceLabel = (sport: string) => (sport === "tennis" ? "Practice vs bot" : "Play vs bot");
const trainLabel = (sport: string) => (sport === "tennis" ? "Train" : "Practice");
const trainNote = (sport: string) => (sport === "tennis" ? "Learn the moves" : "In the page, no room");

// A short party title and each member's idle move, so a group doesn't move in step.
const MOVES = ["hop", "sway", "bob", "sway", "hop"];

/**
 * The selected sport's options: a room (the big primary button, user
 * 2026-11-05), then a room vs the bot, training or practice in the page,
 * and the party, or join a room by code. "How to play" waits for a guide.
 */
const sportOptions = (sport: string) => `
  <div class="options-row">
    <button class="pill pill--primary" data-action="create" type="button" aria-label="Create a room"><span class="ico" aria-hidden="true">${ICO.create}</span><span class="lbl">Create a room<small>Send a link to a friend</small></span></button>
    <button class="pill pill--red" data-action="practice" type="button" aria-label="${practiceLabel(sport)}"><span class="ico" aria-hidden="true">${ICO.practice}</span><span class="lbl"><span class="lbl-main">${practiceLabel(sport)}</span><small>Play the bot now</small></span></button>
    <button class="pill pill--green" data-action="train" type="button" aria-label="${trainLabel(sport)}"><span class="ico" aria-hidden="true">${ICO.train}</span><span class="lbl"><span class="lbl-main">${trainLabel(sport)}</span><small>${trainNote(sport)}</small></span></button>
    <button class="pill pill--purple" data-action="party" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Party"><span class="ico" aria-hidden="true">${ICO.party}</span><span class="lbl"><span class="lbl-main">Party</span><small>Play with friends</small></span></button>
  </div>
  <form class="join">
    <input id="code" name="code" placeholder="CODE" maxlength="4" autocomplete="off" aria-label="Room code" />
    <button class="pill pill--blue" type="submit">Join</button>
  </form>
`;

export function renderMenu(
  root: HTMLElement,
  who: Identity,
  error: string | null,
  actions: MenuActions,
  /** The sport selected last time the menu was shown, if it is playable. */
  sportId?: string,
  /** The party and your shown status (task 34); without it the party panel shows just you. */
  social?: PartySource,
): void {
  const { name } = who;
  root.replaceChildren();
  let selected = SPORTS.find((s) => s.playable && s.id === sportId) ?? SPORTS.find((s) => s.playable) ?? SPORTS[0];
  const menu = document.createElement("main");
  menu.className = "menu";
  menu.innerHTML = `
    <div class="home-scene" aria-hidden="true">${sceneSvg()}</div>
    <header class="menu-top">
      <div class="menu-top-left"></div>
      ${logo()}
      <div class="menu-corner">${name ? "" : `<p class="menu-connecting" role="status">Connecting…</p>`}</div>
    </header>
    <div class="menu-body">
      <nav class="menu-picker" aria-label="Choose a sport">
        <div class="sports" role="group" aria-label="Sports">
          ${SPORTS.map((s) => {
            const art = artOf(s);
            return `
            <button class="sport" data-sport="${s.id}" type="button" style="--c:${art.colour}; --c-dark:${art.dark}"
              ${s.playable ? `aria-pressed="${s === selected}"` : `aria-disabled="true"`}
              tabindex="${s === selected ? 0 : -1}">
              <span class="sport-name">${s.name}</span>
              <span class="sport-tag">${s.playable ? s.tag : "Coming soon"}</span>
              ${s.playable ? "" : `<span class="sport-soon">Coming soon</span>`}
              <span class="sport-art" aria-hidden="true"><svg class="ic" viewBox="0 0 92 92" focusable="false">${art.icon}</svg></span>
              ${POINTER}
            </button>`;
          }).join("")}
        </div>
      </nav>
      <section class="menu-detail" aria-label="Selected sport">
        <figure class="thumb">
          <div class="thumb-frame" role="img" aria-label="${selected.name} preview"></div>
        </figure>
        <div class="pitch">
          <h2 id="options-title">${selected.name}</h2>
          <p class="pitch-line"></p>
          <span class="pitch-chip"></span>
        </div>
        <p class="error" role="alert" hidden></p>
        <section class="options" aria-labelledby="options-title">${sportOptions(selected.id)}</section>
      </section>
      <aside class="menu-party" aria-label="Your party">
        <p class="party-title"></p>
        <div class="crew"></div>
        <button type="button" class="party-look">Change my look</button>
      </aside>
    </div>
    <footer class="menu-footer">
      <p class="readme"><a href="/readme/">What makes this good?</a></p>
    </footer>
  `;
  // top right: the profile button, its picture the player's own character
  const corner = menu.querySelector<HTMLElement>(".menu-corner")!;
  const button = profileButton(who, actions);
  if (button) corner.append(button);
  const errorEl = menu.querySelector<HTMLElement>(".error");
  if (errorEl && error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
  }

  // ---- the scene and the preview: they follow the focused or hovered sport, else the selected one ----
  const scene = menu.querySelector<HTMLElement>(".home-scene")!;
  const frame = menu.querySelector<HTMLElement>(".thumb-frame")!;
  const line = menu.querySelector<HTMLElement>(".pitch-line")!;
  const chip = menu.querySelector<HTMLElement>(".pitch-chip")!;
  const title = menu.querySelector<HTMLElement>("#options-title")!;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>(".sport")];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the previews loop with SVG's own animation (SMIL): paused while the tab
  // is hidden (task 23) and held on one still frame under reduced motion
  const holdLoops = () => {
    const svg = frame.querySelector<SVGSVGElement>("svg");
    if (!svg) return;
    if (reduced) {
      svg.pauseAnimations();
      svg.setCurrentTime(0.35);
    } else if (document.hidden) svg.pauseAnimations();
    else svg.unpauseAnimations();
    menu.classList.toggle("is-hidden-tab", document.hidden);
  };
  let shown: Sport | null = null;
  const show = (sport: Sport) => {
    for (const b of buttons) b.classList.toggle("is-pointed", b.dataset.sport === sport.id);
    if (shown === sport) return;
    shown = sport;
    const art = artOf(sport);
    frame.innerHTML = `<svg class="thumb-svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${art.preview}</svg>`;
    frame.setAttribute("aria-label", `${sport.name} preview${sport.playable ? "" : ", coming soon"}`);
    frame.classList.toggle("is-soon", !sport.playable);
    holdLoops();
  };
  // the scene and the words under the preview are the selected sport's: the
  // buttons below them act on it, so a hovered card never relabels them
  const pick = (sport: Sport) => {
    const art = artOf(sport);
    scene.style.setProperty("--ground", art.ground);
    scene.style.setProperty("--hill-far", art.hillFar);
    scene.style.setProperty("--hill-near", art.hillNear);
    scene.querySelector(".hs-field")!.innerHTML = art.field;
    title.textContent = sport.name;
    line.textContent = sport.blurb;
    chip.textContent = sport.input;
  };
  const sportOf = (b: HTMLElement) => SPORTS.find((s) => s.id === b.dataset.sport)!;
  const settle = () => {
    const active = buttons.find((b) => b === document.activeElement || b.matches(":hover"));
    show(active ? sportOf(active) : selected);
  };
  show(selected);
  pick(selected);
  const onVisibility = () => (menu.isConnected ? holdLoops() : document.removeEventListener("visibilitychange", onVisibility));
  document.addEventListener("visibilitychange", onVisibility);
  // when focus leaves the group, Tab comes back to the selected sport, never
  // to a placeholder (placeholders take focus only to preview them)
  const group = menu.querySelector(".sports")!;
  group.addEventListener("focusout", (event) => {
    const to = (event as FocusEvent).relatedTarget as Node | null;
    if (to && group.contains(to)) return;
    for (const b of buttons) b.tabIndex = b.getAttribute("aria-pressed") === "true" ? 0 : -1;
  });

  const setLabels = (sport: string) => {
    const practice = menu.querySelector<HTMLElement>("[data-action=practice]")!;
    const train = menu.querySelector<HTMLElement>("[data-action=train]")!;
    practice.setAttribute("aria-label", practiceLabel(sport));
    practice.querySelector(".lbl-main")!.textContent = practiceLabel(sport);
    train.setAttribute("aria-label", trainLabel(sport));
    train.querySelector(".lbl-main")!.textContent = trainLabel(sport);
    train.querySelector("small")!.textContent = trainNote(sport);
  };

  buttons.forEach((b, i) => {
    const sport = sportOf(b);
    b.addEventListener("focus", () => show(sport));
    b.addEventListener("mouseenter", () => show(sport));
    b.addEventListener("mouseleave", () => queueMicrotask(settle));
    b.addEventListener("blur", () => queueMicrotask(settle));
    b.addEventListener("click", () => {
      // placeholders are never selectable and never reach the server
      if (!sport.playable) return;
      for (const other of buttons) if (other.hasAttribute("aria-pressed")) other.setAttribute("aria-pressed", String(other === b));
      selected = sport;
      pick(sport);
      actions.onSelect?.(sport.id);
      setLabels(sport.id);
      icons3d?.select(sport.id);
      // opening a sport takes you to its options (practice / create / join)
      const options = menu.querySelector<HTMLElement>(".menu-detail")!;
      options.classList.remove("is-opened");
      void options.offsetWidth;
      options.classList.add("is-opened");
      menu.querySelector<HTMLElement>(".options button")?.focus();
    });
    b.addEventListener("keydown", (event) => {
      const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let next: number | null = null;
      if (event.key in step) next = (i + step[event.key] + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      if (next === null) return;
      event.preventDefault();
      // roving tabindex: the group is one Tab stop, arrows move inside it
      for (const other of buttons) other.tabIndex = -1;
      buttons[next].tabIndex = 0;
      buttons[next].focus();
    });
  });

  menu.querySelector("[data-action=practice]")?.addEventListener("click", () => actions.onPractice(selected.id));
  menu.querySelector("[data-action=train]")?.addEventListener("click", () => actions.onTrain(selected.id));
  menu.querySelector("[data-action=create]")?.addEventListener("click", () => actions.onCreate(selected.id));
  const partyBtn = menu.querySelector<HTMLButtonElement>("[data-action=party]")!;
  partyBtn.addEventListener("click", () => actions.onParty?.(partyBtn));
  menu.querySelector(".party-look")!.addEventListener("click", () => actions.onLook?.());
  menu.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget as HTMLFormElement).get("code");
    if (typeof code === "string" && code.trim()) actions.onJoin(code.trim().toUpperCase());
  });

  // ---- your party (right column; a strip on a phone) ----
  const drawParty = () => {
    drawPartyPanel(menu, who, social, actions);
    // your status dot on the profile picture follows "show me as" at once
    const dot = menu.querySelector(".pm-avatar .sdot");
    if (dot && social) dot.className = `sdot sdot--${social.state.status}`;
  };
  drawParty();
  if (social) {
    const off = social.subscribe(() => (menu.isConnected ? drawParty() : off()));
  }

  root.append(menu);

  // ---- the 3D card icons: after the flat page is on screen, only where allowed ----
  let icons3d: { select(id: string): void; stop(): void } | null = null;
  const env = {
    reducedMotion: reduced,
    width: innerWidth,
    automated: navigator.webdriver === true,
    asked: /[?&]icons3d\b/.test(location.search),
  };
  if (wants3dIcons(env)) {
    const load = async () => {
      if (!menu.isConnected) return;
      const m = await import("./home-3d.ts");
      if (!menu.isConnected || !m.webglWorks()) return;
      menu.classList.add("has3d");
      icons3d = m.mountIcons(buttons, () => {
        menu.classList.remove("has3d");
        menu.dataset.icons = "flat";
      });
      menu.dataset.icons = "3d";
      icons3d.select(selected.id);
    };
    if ("requestIdleCallback" in window) requestIdleCallback(() => void load(), { timeout: 1500 });
    else setTimeout(() => void load(), 300);
  }
}

/** The party panel and the phone's strip: you alone, or the party the server pushed. */
function drawPartyPanel(menu: HTMLElement, who: Identity, social: PartySource | undefined, actions: MenuActions): void {
  const party = social?.state.party ?? null;
  const panel = menu.querySelector<HTMLElement>(".menu-party")!;
  const titleEl = panel.querySelector<HTMLElement>(".party-title")!;
  const crew = panel.querySelector<HTMLElement>(".crew")!;
  const partyBtn = menu.querySelector<HTMLButtonElement>("[data-action=party]")!;
  const members: PartyMember[] = party
    ? party.members
    : [{ id: "you", name: who.name || "You", look: who.look, status: social?.state.status ?? "online", leader: false, you: true }];
  const n = members.length;
  const full = n >= MAX_PARTY;
  titleEl.textContent = !party ? "Just you · start a party" : full ? `Your party · full (${MAX_PARTY} of ${MAX_PARTY})` : `Your party · ${n} of ${MAX_PARTY}`;
  partyBtn.setAttribute("aria-label", party ? `Your party: ${n} of ${MAX_PARTY}` : "Party");
  partyBtn.querySelector("small")!.textContent = party ? `${n} of ${MAX_PARTY}` : "Play with friends";
  const slot = party !== null && !full;
  const items = n + (slot ? 1 : 0);
  const rows = items > 5 ? 2 : 1;
  crew.style.setProperty("--cols", String(rows === 2 ? Math.ceil(items / 2) : items));
  crew.style.setProperty("--rows", String(rows));
  crew.dataset.size = n === 1 && !party ? "solo" : rows === 2 ? "big" : "small";
  const parts: HTMLElement[] = members.map((m, i) => member(m, i, !party));
  if (slot) {
    const invite = document.createElement("button");
    invite.type = "button";
    invite.className = "slot";
    invite.innerHTML = `<span aria-hidden="true">+</span> Invite a friend`;
    invite.addEventListener("click", () => actions.onParty?.(invite));
    parts.push(invite);
  }
  crew.replaceChildren(...parts);
}

const STATUS_WORDS: Record<ShownStatus, string> = { online: "online", away: "away", offline: "offline" };

function member(m: PartyMember, i: number, alone: boolean): HTMLElement {
  const look: Look = m.look ?? DEFAULT_LOOKS[0];
  const el = document.createElement("div");
  el.className = `member m-${MOVES[i % MOVES.length]}`;
  el.dataset.status = m.status;
  if (m.you) el.dataset.you = "true";
  el.innerHTML = `${alone ? `<p class="bubble">Ready to play!</p>` : ""}<div class="member-fig">${lookSvg(look, null).replace("<svg ", `<svg preserveAspectRatio="xMidYMax meet" `)}</div><p class="nameplate"><span class="sdot sdot--${m.status}" aria-hidden="true"></span><span class="np-name"></span>${m.leader ? `<span class="lead" role="img" aria-label="leader" title="Party leader">👑</span>` : ""}</p>`;
  el.querySelector(".np-name")!.textContent = m.name;
  el.setAttribute("aria-label", `${m.name}${m.you ? " (you)" : ""}, ${STATUS_WORDS[m.status]}${m.leader ? ", party leader" : ""}`);
  el.setAttribute("role", "group");
  return el;
}
