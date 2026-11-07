import { RINGS } from "./brand.ts";
import { profileButton } from "./profile-menu.ts";
import type { ProfileMenuActions, ProfileMenuWho } from "./profile-menu.ts";

/**
 * The profile button's actions (top right: sign in and out, the demo
 * accounts, the profile dialog, task 7's leaderboard) and the sport options.
 */
export interface MenuActions extends ProfileMenuActions {
  /** Training (task 5, tennis) or practice (task 22 archery, task 26 track): runs in the page, no server. */
  onTrain(sport: string): void;
  /** A room against the bot, for the selected sport. */
  onPractice(sport: string): void;
  onCreate(sport: string): void;
  onJoin(code: string): void;
  /** The player picked a playable sport. */
  onSelect?(sport: string): void;
}

/** Who the home screen says is playing; `look` is drawn as the profile picture. */
export type Identity = ProfileMenuWho;

/** One sport on the home screen. Adding a sport is one entry in SPORTS. */
export interface Sport {
  id: string;
  name: string;
  /** Only playable sports can be selected or start anything on the server. */
  playable: boolean;
  blurb: string;
  /** Small inline-SVG badge for the sport's button (its ball or kit). */
  icon: string;
  /** Markup for the framed preview: inline SVG and DOM only, no images, no Three.js. */
  thumbnail(): string;
}

const icon = (body: string): string =>
  `<svg class="sport-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS = {
  tennis: icon(
    `<circle cx="12" cy="12" r="10" fill="#d8f03c" stroke="#8fa61a" stroke-width="1.2"/><path d="M4.5 5.5c4 3 4 10 0 13M19.5 5.5c-4 3-4 10 0 13" fill="none" stroke="#fff" stroke-width="1.8"/>`,
  ),
  archery: icon(
    `<circle cx="12" cy="12" r="10" fill="#fff" stroke="#9aa5b1" stroke-width="1.2"/><circle cx="12" cy="12" r="7" fill="#4dabf7"/><circle cx="12" cy="12" r="4.4" fill="#e03131"/><circle cx="12" cy="12" r="1.8" fill="#ffd23f"/>`,
  ),
  track: icon(
    `<circle cx="12" cy="12" r="10" fill="#c4553a" stroke="#8f3a26" stroke-width="1.2"/><path d="M5 9h14M5 12h14M5 15h14" stroke="#fff" stroke-width="1.2"/><path d="M15 6v12" stroke="#ffd23f" stroke-width="2.2"/>`,
  ),
  bowling: icon(
    `<path d="M12 2c2 0 2.6 2 2 4.5-.4 1.6 3 5 3 9.5 0 3.5-2 6-5 6s-5-2.5-5-6c0-4.5 3.4-7.9 3-9.5C9.4 4 10 2 12 2z" fill="#fff" stroke="#9aa5b1" stroke-width="1.2"/><path d="M9.6 7.6h4.8" stroke="#e03131" stroke-width="1.6"/>`,
  ),
  boxing: icon(
    `<circle cx="12" cy="12" r="10" fill="#e0453a" stroke="#a52a22" stroke-width="1.2"/><path d="M8 9.5c0-2 1.6-3.2 4-3.2s4 1.2 4 3.4v3.2c0 2.6-1.8 4.6-4 4.6s-4-2-4-4.6z" fill="#fff"/><path d="M8.6 15h6.8" stroke="#a52a22" stroke-width="1.6"/>`,
  ),
  basketball: icon(
    `<circle cx="12" cy="12" r="10" fill="#e8671c" stroke="#a8440f" stroke-width="1.2"/><path d="M2 12h20M12 2v20M5 4.8c3 2.6 3 11.8 0 14.4M19 4.8c-3 2.6-3 11.8 0 14.4" fill="none" stroke="#2a1a10" stroke-width="1.2"/>`,
  ),
  mystery: icon(
    `<circle cx="12" cy="12" r="10" fill="#e7ecf2" stroke="#9aa5b1" stroke-width="1.2"/><text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="800" font-family="system-ui, sans-serif" fill="#6b7a8a">?</text>`,
  ),
};

// A decorative Mii-style figure for the tennis loop (task 23), drawn in the
// preview's own SVG so it lines up with the court at any frame shape: round
// head, tapered torso, bright top, dark trousers, an oval racket in the right
// hand (as character.ts, but flat). Feet at (x, y), `s` its size (the far
// player is smaller), the racket arm a group the loop swings about the
// shoulder at (x + 7s, y - 34s). Pure SVG/CSS: the menu never loads Three.js.
function figure(x: number, y: number, s: number, shirt: string, hair: string, part: "near" | "far"): string {
  const p = (dx: number, dy: number) => `${x + dx * s},${y + dy * s}`;
  return `
    <g class="loop-${part}">
      <ellipse cx="${x}" cy="${y + 1 * s}" rx="${11 * s}" ry="${3 * s}" fill="#000" opacity=".22"/>
      <rect x="${x - 6 * s}" y="${y - 19 * s}" width="${4.5 * s}" height="${19 * s}" rx="${2 * s}" fill="#2b303b"/>
      <rect x="${x + 1.5 * s}" y="${y - 19 * s}" width="${4.5 * s}" height="${19 * s}" rx="${2 * s}" fill="#2b303b"/>
      <polygon points="${p(-6, -17)} ${p(6, -17)} ${p(8, -34)} ${p(-8, -34)}" fill="${shirt}"/>
      <rect x="${x - 11 * s}" y="${y - 34 * s}" width="${4 * s}" height="${13 * s}" rx="${2 * s}" fill="${shirt}" transform="rotate(12 ${p(-9, -34)})"/>
      <circle cx="${x}" cy="${y - 42 * s}" r="${8.5 * s}" fill="#f3cfae"/>
      <path d="M${p(-8.5, -43)} a${8.5 * s},${8.5 * s} 0 0 1 ${17 * s},0 z" fill="${hair}"/>
      <g class="loop-${part}-arm">
        <line x1="${x + 7 * s}" y1="${y - 34 * s}" x2="${x + 13 * s}" y2="${y - 22 * s}" stroke="${shirt}" stroke-width="${4 * s}" stroke-linecap="round"/>
        <line x1="${x + 13 * s}" y1="${y - 22 * s}" x2="${x + 15 * s}" y2="${y - 33 * s}" stroke="#2f3a46" stroke-width="${1.6 * s}"/>
        <ellipse cx="${x + 16 * s}" cy="${y - 40 * s}" rx="${5 * s}" ry="${7 * s}" fill="#ffffff55" stroke="#e4e7eb" stroke-width="${1.6 * s}"/>
      </g>
    </g>`;
}

const svg = (body: string): string =>
  `<svg class="thumb-svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${body}</svg>`;

const sky = (top: string, bottom: string): string => `
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
  </linearGradient></defs>
  <rect width="320" height="180" fill="url(#sky)"/>
  <ellipse cx="60" cy="22" rx="26" ry="8" fill="#fff" opacity=".85"/>
  <ellipse cx="250" cy="16" rx="34" ry="9" fill="#fff" opacity=".8"/>
`;

/** Blocky, multicoloured crowd patches across a stand, as in the arena. */
function crowd(y: number, rows: number, x0: number, x1: number): string {
  const colours = ["#ff6b6b", "#ffd166", "#4dabf7", "#f8f9fa", "#69db7c", "#b197fc", "#ffa94d"];
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (let x = x0, i = r * 3; x < x1; x += 9, i++) {
      out += `<rect x="${x}" y="${y + r * 7}" width="7" height="5" rx="1" fill="${colours[(i * 5 + r) % colours.length]}"/>`;
    }
  }
  return out;
}

// A low-poly court in perspective: stands, low green wall, mown stripes,
// white lines, a translucent net and an orange ball with its shadow.
function tennisThumb(): string {
  // court corners: far baseline 112..208 at y 86, near baseline 22..298 at y 176
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const edge = (t: number) => ({ y: lerp(86, 176, t), l: lerp(112, 22, t), r: lerp(208, 298, t) });
  let stripes = "";
  for (let i = 0; i < 8; i++) {
    const a = edge(i / 8);
    const b = edge((i + 1) / 8);
    stripes += `<polygon points="${a.l},${a.y} ${a.r},${a.y} ${b.r},${b.y} ${b.l},${b.y}" fill="${i % 2 ? "#5aa847" : "#68b553"}"/>`;
  }
  const singles = (t: number, side: -1 | 1) => {
    const e = edge(t);
    const inset = (e.r - e.l) * 0.11;
    return side < 0 ? e.l + inset : e.r - inset;
  };
  const line = (t0: number, t1: number, side: -1 | 1) =>
    `<line x1="${singles(t0, side)}" y1="${edge(t0).y}" x2="${singles(t1, side)}" y2="${edge(t1).y}"/>`;
  const across = (t: number, inner = false) => {
    const e = edge(t);
    return inner
      ? `<line x1="${singles(t, -1)}" y1="${e.y}" x2="${singles(t, 1)}" y2="${e.y}"/>`
      : `<line x1="${e.l}" y1="${e.y}" x2="${e.r}" y2="${e.y}"/>`;
  };
  const net = edge(0.47);
  const service = [0.24, 0.72];
  const mid = (t: number) => (edge(t).l + edge(t).r) / 2;
  return `
    <div class="thumb-art">
      ${svg(`
        ${sky("#4ea3ea", "#cfeafc")}
        <polygon points="0,38 320,38 320,78 0,78" fill="#7b8ea3"/>
        ${crowd(42, 5, 4, 316)}
        <rect y="76" width="320" height="10" fill="#2f8f4e"/>
        <rect y="86" width="320" height="94" fill="#4c9a3f"/>
        ${stripes}
        <g stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none">
          <polygon points="112,86 208,86 298,176 22,176"/>
          ${line(0, 1, -1)}${line(0, 1, 1)}
          ${across(service[0], true)}${across(service[1], true)}
          <line x1="${mid(service[0])}" y1="${edge(service[0]).y}" x2="${mid(service[1])}" y2="${edge(service[1]).y}"/>
        </g>
        <rect x="${net.l - 4}" y="${net.y - 13}" width="${net.r - net.l + 8}" height="13" fill="#1d2b36" opacity=".35"/>
        <line x1="${net.l - 4}" y1="${net.y - 13}" x2="${net.r + 4}" y2="${net.y - 13}" stroke="#fff" stroke-width="2"/>
        <rect x="${net.l - 6}" y="${net.y - 15}" width="2.5" height="16" fill="#e9ecef"/>
        <rect x="${net.r + 3.5}" y="${net.y - 15}" width="2.5" height="16" fill="#e9ecef"/>
        <g class="loop">
          ${figure(150, 96, 0.6, "#ee334e", "#1d1b1a", "far")}
          <ellipse class="loop-ball-shadow" rx="5" ry="1.8" fill="#000" opacity=".25"/>
          <circle class="loop-ball" r="3.4" fill="#ffb21c" stroke="#e8890c" stroke-width=".8"/>
          ${figure(208, 166, 1, "#0081c8", "#4a2c1a", "near")}
        </g>
      `)}
    </div>`;
}

function archeryThumb(): string {
  return `<div class="thumb-art">${svg(`
    ${sky("#5fb0ee", "#d6eefc")}
    <path d="M0 104 Q90 84 180 100 T320 96 V180 H0 Z" fill="#6fbf5a"/>
    <rect y="120" width="320" height="60" fill="#4f9e3d"/>
    <line x1="150" y1="118" x2="140" y2="156" stroke="#8d6e4f" stroke-width="3"/><line x1="190" y1="118" x2="200" y2="156" stroke="#8d6e4f" stroke-width="3"/>
    <g class="loop">
      <g class="loop-target">
        <circle cx="170" cy="92" r="40" fill="#fff" stroke="#adb5bd" stroke-width="1.4"/>
        <circle cx="170" cy="92" r="32" fill="#2b2f4a"/><circle cx="170" cy="92" r="24" fill="#4dabf7"/>
        <circle cx="170" cy="92" r="16" fill="#e03131"/><circle cx="170" cy="92" r="7" fill="#ffd23f"/>
      </g>
      <g class="loop-arrow">
        <line x1="170" y1="92" x2="116" y2="108" stroke="#6b4f33" stroke-width="2.4" stroke-linecap="round"/>
        <polygon points="116,108 108,103 113,109 109,114" fill="#ee334e"/><polygon points="123,106 115,101 120,107 116,112" fill="#ee334e"/>
      </g>
    </g>
  `)}</div>`;
}

function trackThumb(): string {
  const lanes = [0, 1, 2, 3].map((i) => `<polygon points="${-40 + i * 100},180 ${60 + i * 100},180 ${150 + i * 40},96 ${110 + i * 40},96" fill="${i % 2 ? "#c4553a" : "#cf6146"}"/>`).join("");
  return `<div class="thumb-art">${svg(`
    ${sky("#5fb0ee", "#d6eefc")}
    <rect y="70" width="320" height="26" fill="#3d8ff0"/><rect y="70" width="320" height="6" fill="#2f7fe0"/>
    <rect y="96" width="320" height="84" fill="#6fbf5a"/>
    ${lanes}
    <g stroke="#fff" stroke-width="1.6">${[0, 1, 2, 3, 4].map((i) => `<line x1="${-40 + i * 100}" y1="180" x2="${110 + i * 40}" y2="96"/>`).join("")}</g>
    <line x1="228" y1="118" x2="300" y2="118" stroke="#fff" stroke-width="4"/>
    <g class="loop">
    <g class="loop-runner-a"><g transform="translate(150 128)"><circle cy="-30" r="8" fill="#f3cfae"/><rect x="-6" y="-22" width="12" height="20" rx="4" fill="#2f7fe0"/>
      <line x1="0" y1="-2" x2="-10" y2="16" stroke="#2b303b" stroke-width="5" stroke-linecap="round"/><line x1="0" y1="-2" x2="10" y2="12" stroke="#2b303b" stroke-width="5" stroke-linecap="round"/></g></g>
    <g class="loop-runner-b"><g transform="translate(196 116) scale(.8)"><circle cy="-30" r="8" fill="#f3cfae"/><rect x="-6" y="-22" width="12" height="20" rx="4" fill="#e0453a"/>
      <line x1="0" y1="-2" x2="-9" y2="14" stroke="#2b303b" stroke-width="5" stroke-linecap="round"/><line x1="0" y1="-2" x2="10" y2="14" stroke="#2b303b" stroke-width="5" stroke-linecap="round"/></g></g>
    </g>
  `)}</div>`;
}

function bowlingThumb(): string {
  let pins = "";
  const rows = [[160], [150, 170], [140, 160, 180], [130, 150, 170, 190]];
  rows.forEach((row, r) =>
    row.forEach((x) => {
      const y = 70 - r * 8;
      pins += `<ellipse cx="${x}" cy="${y + 12}" rx="6" ry="9" fill="#fff" stroke="#adb5bd" stroke-width=".6"/><rect x="${x - 6}" y="${y + 6}" width="12" height="2.4" fill="#e03131"/>`;
    }),
  );
  return `<div class="thumb-art">${svg(`
    <rect width="320" height="180" fill="#2b2f4a"/>
    <polygon points="118,40 202,40 300,180 20,180" fill="#4a4f6a"/>
    <polygon points="126,40 194,40 270,180 50,180" fill="#e9b872"/>
    <g stroke="#d49a52" stroke-width="1">${[0.2, 0.4, 0.6, 0.8].map((t) => `<line x1="${126 + 68 * t}" y1="40" x2="${50 + 220 * t}" y2="180"/>`).join("")}</g>
    <g fill="#c0392b">${[0.3, 0.42, 0.5, 0.58, 0.7].map((t) => `<polygon points="${50 + 220 * t},140 ${46 + 220 * t},150 ${54 + 220 * t},150"/>`).join("")}</g>
    <g class="loop">
      <g class="loop-pins">${pins}</g>
      <g class="loop-bowl" style="transform-origin: 160px 160px"><circle cx="160" cy="160" r="13" fill="#3b5bdb"/><circle cx="156" cy="155" r="1.6" fill="#1c2b6b"/><circle cx="162" cy="154" r="1.6" fill="#1c2b6b"/></g>
    </g>
  `)}</div>`;
}

function boxingThumb(): string {
  const boxer = (x: number, shirt: string, dir: 1 | -1, cls: string) => `
    <g class="${cls}"><g transform="translate(${x} 150)">
      <rect x="-8" y="-34" width="7" height="34" rx="3" fill="#2b303b"/><rect x="1" y="-34" width="7" height="34" rx="3" fill="#2b303b"/>
      <rect x="-12" y="-72" width="24" height="42" rx="8" fill="${shirt}"/>
      <circle cy="-86" r="14" fill="#f3cfae"/>
      <g class="loop-glove-${dir === 1 ? "a" : "b"}"><circle cx="${dir * 22}" cy="-60" r="9" fill="#fff" stroke="#0007" stroke-width="1.4"/></g>
      <circle cx="${dir * 10}" cy="-76" r="8" fill="${shirt}" stroke="#0007" stroke-width="1.4"/>
    </g></g>`;
  return `<div class="thumb-art">${svg(`
    <rect width="320" height="180" fill="#2b2f4a"/>
    <rect y="150" width="320" height="30" fill="#c9b27c"/>
    <g stroke="#e0453a" stroke-width="3"><line x1="0" y1="60" x2="320" y2="60"/><line x1="0" y1="90" x2="320" y2="90"/><line x1="0" y1="120" x2="320" y2="120"/></g>
    <g fill="#fff" opacity=".18"><circle cx="40" cy="26" r="4"/><circle cx="90" cy="20" r="3"/><circle cx="230" cy="22" r="4"/><circle cx="285" cy="28" r="3"/></g>
    <g class="loop">
    ${boxer(112, "#2f7fe0", 1, "loop-box-a")}
    ${boxer(208, "#e0453a", -1, "loop-box-b")}
    </g>
  `)}</div>`;
}

// A park court seen from behind the shooter: fence, trees, asphalt with the
// lane and the arc, the hoop; the shooter pushes up and the ball arcs into
// the net, which ripples, then it all starts again.
function basketballThumb(): string {
  const fence = Array.from({ length: 17 }, (_, i) => `<line x1="${i * 20}" y1="58" x2="${i * 20}" y2="104"/>`).join("");
  return `<div class="thumb-art">${svg(`
    ${sky("#5fb0ee", "#d6eefc")}
    <g fill="#3d8f45"><circle cx="30" cy="62" r="22"/><circle cx="72" cy="56" r="18"/><circle cx="250" cy="58" r="20"/><circle cx="292" cy="64" r="24"/></g>
    <rect y="58" width="320" height="46" fill="#c9ced6" opacity=".18"/>
    <g stroke="#9aa5b1" stroke-width="1">${fence}<line x1="0" y1="58" x2="320" y2="58" stroke-width="2"/></g>
    <rect y="104" width="320" height="76" fill="#4a4f57"/>
    <polygon points="138,104 182,104 196,150 124,150" fill="#2f6fb5"/>
    <g stroke="#f4f4f0" stroke-width="1.6" fill="none">
      <line x1="0" y1="104" x2="320" y2="104"/>
      <polygon points="138,104 182,104 196,150 124,150"/>
      <path d="M40 104 Q40 176 160 176 Q280 176 280 104"/>
    </g>
    <rect x="157" y="46" width="6" height="58" fill="#2f3a46"/>
    <rect x="132" y="22" width="56" height="34" rx="2" fill="#f7f8fa" stroke="#1d1d1f" stroke-width="1.6"/>
    <rect x="150" y="34" width="20" height="15" fill="none" stroke="#ee334e" stroke-width="1.6"/>
    <g class="loop">
      <g class="loop-net"><path d="M148 52 L152 66 L168 66 L172 52 M152 52 L156 66 M160 52 L160 66 M168 52 L164 66" stroke="#e4e7eb" stroke-width="1.1" fill="none"/></g>
      <ellipse cx="160" cy="52" rx="13" ry="3" fill="none" stroke="#ff6a1a" stroke-width="2.4"/>
      <g class="loop-shooter"><g transform="translate(160 176)">
        <rect x="-8" y="-30" width="7" height="30" rx="3" fill="#2b303b"/><rect x="1" y="-30" width="7" height="30" rx="3" fill="#2b303b"/>
        <rect x="-12" y="-66" width="24" height="40" rx="8" fill="#0081c8"/>
        <circle cy="-80" r="13" fill="#4a2c1a"/>
        <g class="loop-hoop-arms"><line x1="-9" y1="-60" x2="-5" y2="-86" stroke="#f3cfae" stroke-width="6" stroke-linecap="round"/><line x1="9" y1="-60" x2="5" y2="-86" stroke="#f3cfae" stroke-width="6" stroke-linecap="round"/></g>
      </g></g>
      <g class="loop-hoop-ball"><circle r="8" fill="#e8671c" stroke="#a8440f" stroke-width="1"/><path d="M-8 0h16M0 -8v16" stroke="#2a1a10" stroke-width=".9"/></g>
    </g>
  `)}</div>`;
}

function mysteryThumb(): string {
  return `<div class="thumb-art">${svg(`
    <rect width="320" height="180" fill="#c9dcf0"/>
    <rect width="320" height="180" fill="#ffffff" opacity=".25"/>
    <g class="loop">
      <text class="loop-mystery" x="160" y="124" text-anchor="middle" font-size="110" font-weight="800" font-family="system-ui, sans-serif" fill="#7d93ab">??</text>
      <path class="loop-spark" d="M70 50 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" fill="#fcb131"/>
      <path class="loop-spark" d="M250 40 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="#0081c8"/>
      <path class="loop-spark" d="M240 130 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" fill="#ee334e"/>
    </g>
  `)}</div>`;
}

/**
 * The sports on the home screen, in menu order. Tennis, archery, track,
 * boxing and basketball are playable (CLAUDE.md). The others are "coming soon" placeholders:
 * aria-disabled, they only change the preview, can't be selected and never
 * reach the server. Delete an entry to drop it.
 */
export const SPORTS: Sport[] = [
  { id: "tennis", name: "Tennis", playable: true, icon: ICONS.tennis, blurb: "Rally against the bot or a friend. Swing with your camera or the keyboard.", thumbnail: tennisThumb },
  { id: "bowling", name: "Bowling", playable: false, icon: ICONS.bowling, blurb: "Coming soon.", thumbnail: bowlingThumb },
  { id: "archery", name: "Archery", playable: true, icon: ICONS.archery, blurb: "Read the wind and hit the gold, stage by stage. Draw with your camera or the mouse.", thumbnail: archeryThumb },
  { id: "track", name: "Track", playable: true, icon: ICONS.track, blurb: "Sprint 100 m against the bot or a friend. Run on the spot with your camera, or tap A and D.", thumbnail: trackThumb },
  { id: "boxing", name: "Boxing", playable: true, icon: ICONS.boxing, blurb: "Three rounds of 30 seconds against the bot or a friend. Jab, hook and guard with the keyboard or buttons.", thumbnail: boxingThumb },
  { id: "basketball", name: "Basketball", playable: true, icon: ICONS.basketball, blurb: "A shootout from five spots on a park court, turn by turn. Push up to shoot with your camera, or hold Space.", thumbnail: basketballThumb },
];

/**
 * The logo (task 14). The ring motif is our own: five loose, separate rings
 * in a wave over the word, never interlinked in the official 3-over-2
 * layout. Then the word, each letter in one
 * of the five colours with a dark outline (so even yellow reads on the pale
 * sky). Letters bounce in once on load; the rings float on a slow loop. Pure
 * SVG and CSS, a still frame under reduced motion (style.css).
 */
// The menu is drawn again when the server's welcome arrives (and on every
// return from a game); the bounce carries on from where it was instead of
// starting over, so it plays once per page load.
let bounceStart: number | null = null;

export function logo(): string {
  bounceStart ??= performance.now();
  const since = Math.round(performance.now() - bounceStart);
  const rings = RINGS.map(
    (r, i) => `<circle class="logo-ring logo-ring--${r.name}" cx="${18 + i * 31}" cy="${i % 2 ? 26 : 18}" r="13" style="--i:${i}" stroke="${r.hex}"/>`,
  ).join("");
  const letters = [..."Weblympics"].map((ch, i) => `<span class="logo-letter" style="--i:${i}; --c:${RINGS[i % 5].hex}">${ch}</span>`).join("");
  return `
    <h1 class="logo" aria-label="Weblympics" style="--since:${since}ms">
      <svg class="logo-rings" viewBox="0 0 160 42" aria-hidden="true" focusable="false">${rings}</svg>
      <span class="logo-word">${letters}</span>
    </h1>`;
}

// A chunky pointer arrow, drawn here (not a Nintendo asset), that marks the
// focused or hovered sport button.
const POINTER = `<svg class="pointer" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <path d="M6 3 L6 25 L11.5 20 L15.5 29 L20 27 L16 18.5 L24 18.5 Z" fill="#fff" stroke="#1769b8" stroke-width="2.4" stroke-linejoin="round"/>
</svg>`;

/**
 * The selected sport's options: a room (the big primary button, user
 * 2026-11-05), a room vs the bot and in-page training or practice (the
 * smaller pair), or join one by code.
 */
const sportOptions = (sport: string) => `
  <button class="pill pill--primary" data-action="create">Create a room</button>
  <button class="pill pill--red" data-action="practice">${sport === "tennis" ? "Practice vs bot" : "Play vs bot"}</button>
  <button class="pill pill--green" data-action="train">${sport === "tennis" ? "Train" : "Practice"}</button>
  <form class="join">
    <label for="code" hidden>Room code</label>
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
): void {
  const { name } = who;
  root.replaceChildren();
  let selected = SPORTS.find((s) => s.playable && s.id === sportId) ?? SPORTS.find((s) => s.playable) ?? SPORTS[0];
  const menu = document.createElement("main");
  menu.className = "menu";
  menu.innerHTML = `
    <div class="menu-tab" aria-hidden="true">Main Menu</div>
    <div class="menu-column">
      ${logo()}
      <div class="menu-body">
        <nav class="menu-picker" aria-label="Choose a sport">
          <p class="menu-label" aria-hidden="true">Sports</p>
          <div class="sports" role="group" aria-label="Sports">
            ${SPORTS.map(
              (s) => `
              <button class="pill sport" data-sport="${s.id}" type="button"
                ${s.playable ? `aria-pressed="${s === selected}"` : `aria-disabled="true"`}
                tabindex="${s === selected ? 0 : -1}">
                ${s.icon}<span class="sport-name">${s.name}</span>
                ${s.playable || s.name === "??" ? "" : `<span class="sport-soon">Coming soon</span>`}
                ${POINTER}
              </button>`,
            ).join("")}
          </div>
        </nav>
        <div class="menu-detail">
          <figure class="thumb">
            <div class="thumb-frame" role="img" aria-label="${selected.name} preview"></div>
            <figcaption class="thumb-caption"><strong></strong> <span></span></figcaption>
          </figure>
          <p class="error" role="alert" hidden></p>
          <section class="options" aria-labelledby="options-title">
            <h2 id="options-title">${selected.name}</h2>
            <div class="options-row">${sportOptions(selected.id)}</div>
          </section>
        </div>
      </div>
      <footer class="menu-footer">
        <p class="readme"><a href="/readme/">What makes this good?</a></p>
      </footer>
    </div>
    <div class="menu-corner">${name ? "" : `<p class="menu-connecting" role="status">Connecting…</p>`}</div>
  `;
  // top right: the profile button, its picture the player's own character
  const button = profileButton(who, actions);
  if (button) menu.querySelector(".menu-corner")!.append(button);
  const errorEl = menu.querySelector<HTMLElement>(".error");
  if (errorEl && error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
  }

  // Preview: shows the focused or hovered sport, falling back to the selected one.
  const frame = menu.querySelector<HTMLElement>(".thumb-frame")!;
  const caption = menu.querySelector<HTMLElement>(".thumb-caption")!;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>(".sport")];
  let shown: Sport | null = null;
  const show = (sport: Sport) => {
    for (const b of buttons) b.classList.toggle("is-pointed", b.dataset.sport === sport.id);
    if (shown === sport) return;
    shown = sport;
    frame.innerHTML = sport.thumbnail();
    frame.setAttribute("aria-label", `${sport.name} preview${sport.playable ? "" : ", coming soon"}`);
    frame.classList.toggle("is-soon", !sport.playable);
    caption.querySelector("strong")!.textContent = sport.name;
    caption.querySelector("span")!.textContent = sport.blurb;
  };
  const sportOf = (b: HTMLElement) => SPORTS.find((s) => s.id === b.dataset.sport)!;
  const settle = () => {
    const active = buttons.find((b) => b === document.activeElement || b.matches(":hover"));
    show(active ? sportOf(active) : selected);
  };
  show(selected);
  // the loops stop while the tab is hidden (task 23); the listener goes with the menu
  const pause = () => frame.classList.toggle("is-paused", document.hidden);
  pause();
  const onVisibility = () => (menu.isConnected ? pause() : document.removeEventListener("visibilitychange", onVisibility));
  document.addEventListener("visibilitychange", onVisibility);
  // when focus leaves the group, Tab comes back to the selected sport, never
  // to a placeholder (placeholders take focus only to preview them)
  menu.querySelector(".sports")!.addEventListener("focusout", (event) => {
    const to = (event as FocusEvent).relatedTarget as Node | null;
    if (to && menu.querySelector(".sports")!.contains(to)) return;
    for (const b of buttons) b.tabIndex = b.getAttribute("aria-pressed") === "true" ? 0 : -1;
  });

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
      actions.onSelect?.(sport.id);
      menu.querySelector<HTMLElement>("#options-title")!.textContent = sport.name;
      (menu.querySelector("[data-action=train]") as HTMLElement).textContent = sport.id === "tennis" ? "Train" : "Practice";
      (menu.querySelector("[data-action=practice]") as HTMLElement).textContent = sport.id === "tennis" ? "Practice vs bot" : "Play vs bot";
      // opening a sport takes you to its options (practice / create / join)
      const options = menu.querySelector<HTMLElement>(".options")!;
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
  menu.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget as HTMLFormElement).get("code");
    if (typeof code === "string" && code.trim()) actions.onJoin(code.trim().toUpperCase());
  });
  root.append(menu);
}
