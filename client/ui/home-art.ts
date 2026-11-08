// Task 36: the home screen's pictures, from the approved mock (2026-11-08):
// each sport's flat card icon, its big looping preview and the field drawn
// in the background scene. Inline SVG only, no images and no Three.js; the
// previews loop with SVG's own animation elements (no script), and menu.ts
// pauses them while the tab is hidden or under reduced motion.

/** A sport's look on the home screen. */
export interface SportArt {
  /** The card's colour and its darker edge; white text on `colour` meets WCAG AA (client/ui/brand.ts). */
  colour: string;
  dark: string;
  /** The background scene's ground and hills while the sport is picked. */
  ground: string;
  hillFar: string;
  hillNear: string;
  /** The card icon's inner markup, in a 92x92 view box. */
  icon: string;
  /** The preview's inner markup, in a 320x180 view box. */
  preview: string;
  /** The sport's field in the scene, in its 1600x900 view box. */
  field: string;
}

const SKIN = "#f3cfae";
const SKIN2 = "#b57c55";

const ICON: Record<string, string> = {
  tennis: `<circle cx="46" cy="46" r="32" fill="#d7f05a" stroke="#b6cc3a" stroke-width="2"/><path d="M20 26 C40 38 40 54 20 66" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M72 26 C52 38 52 54 72 66" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="36" cy="30" rx="8" ry="5" fill="#fff" opacity=".35"/>`,
  archery: `<circle cx="46" cy="46" r="32" fill="#fff" stroke="#ddd" stroke-width="2"/><circle cx="46" cy="46" r="26" fill="#1d1d1f"/><circle cx="46" cy="46" r="20" fill="#2f7fe0"/><circle cx="46" cy="46" r="13" fill="#ee334e"/><circle cx="46" cy="46" r="6" fill="#fcb131"/><line x1="48" y1="44" x2="78" y2="14" stroke="#6b4a2a" stroke-width="3"/><path d="M74 12 L84 8 L80 18 Z" fill="#ee334e"/>`,
  track: `<path d="M10 58 L12 40 Q14 32 24 32 L34 32 L40 40 Q56 38 70 46 Q84 52 84 60 L84 64 L10 64 Z" fill="#2f7fe0"/><path d="M8 64 L86 64 Q88 70 82 72 L10 72 Q6 70 8 64Z" fill="#fff"/><path d="M50 72 L82 72 L80 76 L52 76Z" fill="#ee334e"/><path d="M30 52 L62 46" stroke="#fcb131" stroke-width="5" stroke-linecap="round"/><g stroke="#fff" stroke-width="2.5" stroke-linecap="round"><line x1="40" y1="40" x2="44" y2="36"/><line x1="46" y1="41" x2="50" y2="37"/><line x1="52" y1="42" x2="56" y2="38"/></g><ellipse cx="22" cy="34" rx="8" ry="3" fill="#12304a"/>`,
  boxing: `<path d="M24 36 Q22 16 46 16 Q68 16 68 38 L68 54 Q68 70 50 70 L36 70 Q24 70 24 56Z" fill="#ee334e"/><path d="M28 40 Q40 34 64 38" stroke="#f47386" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="66" cy="50" rx="8" ry="11" fill="#d62e48"/><rect x="28" y="68" width="34" height="14" rx="4" fill="#fff"/><rect x="28" y="70" width="34" height="3" fill="#1d1d1f"/>`,
  basketball: `<circle cx="46" cy="46" r="32" fill="#e8762a" stroke="#b9541a" stroke-width="2"/><g stroke="#2a1a10" stroke-width="3" fill="none"><line x1="14" y1="46" x2="78" y2="46"/><line x1="46" y1="14" x2="46" y2="78"/><path d="M24 22 Q38 46 24 70"/><path d="M68 22 Q54 46 68 70"/></g><ellipse cx="34" cy="28" rx="8" ry="5" fill="#fff" opacity=".25"/>`,
  bowling: `<path d="M46 10 Q56 10 55 24 Q53 32 58 40 Q66 54 60 80 L32 80 Q26 54 34 40 Q39 32 37 24 Q36 10 46 10Z" fill="#fff" stroke="#ccd" stroke-width="2"/><path d="M38 30 H54 M37 35 H55" stroke="#ee334e" stroke-width="3.5"/><ellipse cx="42" cy="18" rx="3" ry="5" fill="#fff" opacity=".8"/>`,
};

const FIELD: Record<string, string> = {
  tennis: `<polygon points="560,640 1040,640 1260,900 340,900" fill="#2f7fd0" opacity=".9"/><polygon points="600,650 1000,650 1190,890 410,890" fill="none" stroke="#fff" stroke-width="5"/><line x1="800" y1="650" x2="800" y2="890" stroke="#fff" stroke-width="4"/><line x1="470" y1="740" x2="1130" y2="740" stroke="#fff" stroke-width="10" opacity=".9"/>`,
  archery: `<g transform="translate(1120 600)"><rect x="-6" y="0" width="12" height="70" fill="#8a5a2b"/><circle r="52" fill="#fff"/><circle r="40" fill="#2f7fe0"/><circle r="28" fill="#ee334e"/><circle r="14" fill="#fcb131"/></g><g transform="translate(420 640)"><rect x="-4" y="0" width="8" height="40" fill="#8a5a2b"/><circle r="28" fill="#fff"/><circle r="20" fill="#2f7fe0"/><circle r="12" fill="#ee334e"/><circle r="6" fill="#fcb131"/></g>`,
  track: `<polygon points="0,660 1600,660 1600,900 0,900" fill="#c9473a"/><g stroke="#fff" stroke-width="4"><line x1="0" y1="700" x2="1600" y2="700"/><line x1="0" y1="750" x2="1600" y2="750"/><line x1="0" y1="810" x2="1600" y2="810"/></g><rect x="1180" y="660" width="14" height="240" fill="#fff"/>`,
  boxing: `<polygon points="480,650 1120,650 1240,880 360,880" fill="#e9eef5"/><g stroke="#ee334e" stroke-width="6"><line x1="470" y1="620" x2="1130" y2="620"/><line x1="440" y1="660" x2="1160" y2="660"/></g><rect x="455" y="600" width="16" height="200" fill="#1d1d1f"/><rect x="1130" y="600" width="16" height="200" fill="#1d1d1f"/>`,
  basketball: `<polygon points="400,640 1200,640 1400,900 200,900" fill="#8e98a5"/><path d="M640 640 Q800 760 960 640" fill="none" stroke="#fff" stroke-width="5"/><rect x="740" y="640" width="120" height="140" fill="#2f7fe0" opacity=".7"/><g transform="translate(800 470)"><rect x="-6" y="40" width="12" height="140" fill="#666"/><rect x="-60" y="-10" width="120" height="70" fill="#fff" stroke="#666" stroke-width="5"/><ellipse cx="0" cy="62" rx="26" ry="6" fill="none" stroke="#ee334e" stroke-width="5"/></g>`,
  bowling: `<polygon points="700,620 900,620 1100,900 500,900" fill="#e5b77c"/><g stroke="#c48a4e" stroke-width="3"><line x1="760" y1="620" x2="620" y2="900"/><line x1="840" y1="620" x2="980" y2="900"/></g><g fill="#fff"><ellipse cx="800" cy="625" rx="6" ry="14"/><ellipse cx="786" cy="630" rx="6" ry="14"/><ellipse cx="814" cy="630" rx="6" ry="14"/></g>`,
};

// The looping previews: a little figure doing each sport's move. Every loop
// repeats forever on a cycle of at most 2.6 s (e2e/home.e2e.ts checks both).
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const PREVIEW: Record<string, string> = {
  tennis: `
    <defs><linearGradient id="pt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#dff3ff"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#pt-sky)"/>
    <rect y="62" width="320" height="18" fill="#e9eef5"/><g fill="#e0453a"><circle cx="20" cy="70" r="4"/><circle cx="60" cy="68" r="4"/><circle cx="110" cy="70" r="4"/><circle cx="170" cy="68" r="4"/><circle cx="230" cy="70" r="4"/><circle cx="290" cy="68" r="4"/></g>
    <g fill="#2f7fe0"><circle cx="40" cy="70" r="4"/><circle cx="90" cy="68" r="4"/><circle cx="140" cy="70" r="4"/><circle cx="200" cy="68" r="4"/><circle cx="260" cy="70" r="4"/></g>
    <rect y="80" width="320" height="100" fill="#3f9a57"/>
    <polygon points="110,84 210,84 290,180 30,180" fill="#2f7fd0"/>
    <polygon points="118,88 202,88 276,176 44,176" fill="none" stroke="#fff" stroke-width="2"/>
    <line x1="160" y1="88" x2="160" y2="176" stroke="#fff" stroke-width="1.5"/>
    <rect x="62" y="116" width="196" height="12" fill="rgba(255,255,255,.35)"/><line x1="62" y1="116" x2="258" y2="116" stroke="#fff" stroke-width="2.5"/>
    <g transform="translate(176 96) scale(.55)"><rect x="-7" y="0" width="14" height="22" rx="6" fill="#e0453a"/><circle cy="-8" r="9" fill="${SKIN2}"/><rect x="-6" y="21" width="5" height="16" fill="#2b303b"/><rect x="1" y="21" width="5" height="16" fill="#2b303b"/>
      <g><animateTransform attributeName="transform" type="rotate" values="20;-60;20" keyTimes="0;.5;1" dur="1.8s" begin=".9s" repeatCount="indefinite"/><rect x="5" y="2" width="4" height="18" rx="2" fill="${SKIN2}"/><ellipse cx="7" cy="26" rx="6" ry="8" fill="none" stroke="#333" stroke-width="2"/></g></g>
    <g transform="translate(118 140)"><rect x="-10" y="0" width="20" height="30" rx="9" fill="#2f7fe0"/><circle cy="-11" r="12" fill="${SKIN}"/><path d="M-12 -14 Q0 -28 12 -14 Q8 -21 0 -21 Q-8 -21 -12 -14Z" fill="#4a2c1a"/>
      <rect x="-8" y="28" width="7" height="14" fill="#2b303b"/><rect x="1" y="28" width="7" height="14" fill="#2b303b"/>
      <g><animateTransform attributeName="transform" type="rotate" values="60;-70;60" keyTimes="0;.18;1" dur="1.8s" repeatCount="indefinite"/><rect x="7" y="2" width="5" height="22" rx="2.5" fill="${SKIN}"/><rect x="8" y="22" width="3" height="10" fill="#333"/><ellipse cx="9.5" cy="40" rx="7" ry="10" fill="none" stroke="#e0453a" stroke-width="2.5"/></g></g>
    <circle class="loop-ball" r="4" fill="#d7f05a" stroke="#9fb800" stroke-width="1"><animateMotion dur="1.8s" repeatCount="indefinite" keyPoints="0;.5;1" keyTimes="0;.5;1" calcMode="linear" path="M134 150 Q160 70 182 106 Q160 70 134 150"/></circle>`,
  archery: `
    <rect width="320" height="180" fill="#9fd6ff"/>
    <path d="M0 96 C60 80 120 92 180 84 C240 76 290 90 320 82 L320 180 L0 180Z" fill="#7cc6a0"/>
    <rect y="110" width="320" height="70" fill="#58a64a"/>
    <g fill="#4d9a40"><rect y="118" width="320" height="6"/><rect y="136" width="320" height="8"/><rect y="158" width="320" height="10"/></g>
    <line x1="150" y1="70" x2="150" y2="112" stroke="#8a8a8a" stroke-width="2"/>
    <path fill="#fcb131" d="M150 70 L172 74 L150 80Z"><animate attributeName="d" values="M150 70 L172 74 L150 80Z;M150 70 L170 76 L150 80Z;M150 70 L172 74 L150 80Z" dur="1.2s" repeatCount="indefinite"/></path>
    <g transform="translate(262 96)"><line x1="-14" y1="20" x2="-20" y2="44" stroke="#8a5a2b" stroke-width="4"/><line x1="14" y1="20" x2="20" y2="44" stroke="#8a5a2b" stroke-width="4"/>
      <circle r="30" fill="#fff" stroke="#ddd"/><circle r="24" fill="#1d1d1f"/><circle r="18" fill="#2f7fe0"/><circle r="12" fill="#ee334e"/><circle r="6" fill="#fcb131"/><circle r="2" fill="#fff"/></g>
    <g transform="translate(64 120)"><rect x="-9" y="0" width="18" height="28" rx="8" fill="#e0453a"/><circle cy="-11" r="11" fill="${SKIN}"/><path d="M-11 -13 Q0 -26 11 -13 Q7 -20 0 -20 Q-7 -20 -11 -13Z" fill="#1d1b1a"/>
      <rect x="-7" y="26" width="6" height="16" fill="#2b303b"/><rect x="1" y="26" width="6" height="16" fill="#2b303b"/>
      <rect x="6" y="2" width="24" height="5" rx="2.5" fill="${SKIN}"/>
      <path d="M30 -18 Q42 4 30 26" fill="none" stroke="#8a5a2b" stroke-width="3"/>
      <path stroke="#ccc" stroke-width="1" fill="none" d="M30 -18 L30 26"><animate attributeName="d" values="M30 -18 L30 26;M30 -18 L10 4 L30 26;M30 -18 L10 4 L30 26;M30 -18 L30 26" keyTimes="0;.35;.5;1" dur="2.2s" repeatCount="indefinite"/></path>
      <rect x="10" y="2" width="18" height="5" rx="2.5" fill="${SKIN}"><animate attributeName="x" values="10;-6;-6;10" keyTimes="0;.35;.5;1" dur="2.2s" repeatCount="indefinite"/><animate attributeName="width" values="18;16;16;18" keyTimes="0;.35;.5;1" dur="2.2s" repeatCount="indefinite"/></rect></g>
    <g class="loop-arrow"><animateMotion dur="2.2s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;.5;.8;1" calcMode="linear" path="M80 124 Q170 96 250 96"/><line x1="-14" y1="0" x2="8" y2="0" stroke="#5a3a1a" stroke-width="2"/><polygon points="8,-3 13,0 8,3" fill="#888"/><polygon points="-14,-3 -10,0 -14,3" fill="#ee334e"/></g>`,
  track: `
    <rect width="320" height="180" fill="#9fd6ff"/>
    <rect y="54" width="320" height="30" fill="#e9eef5"/>
    <g><animateTransform attributeName="transform" type="translate" from="0 0" to="-80 0" dur="1.2s" repeatCount="indefinite"/>
      <g fill="#2f7fe0">${range(26).map((i) => `<circle cx="${i * 16}" cy="${66 + (i % 2) * 6}" r="5"/>`).join("")}</g>
      <g fill="#e0453a">${range(26).map((i) => `<circle cx="${i * 16 + 8}" cy="${72 - (i % 2) * 6}" r="5"/>`).join("")}</g></g>
    <rect y="84" width="320" height="96" fill="#c9473a"/>
    <g stroke="#fff" stroke-width="2"><line x1="0" y1="112" x2="320" y2="112"/><line x1="0" y1="146" x2="320" y2="146"/><line x1="0" y1="178" x2="320" y2="178"/></g>
    <g><animateTransform attributeName="transform" type="translate" from="0 0" to="-64 0" dur=".5s" repeatCount="indefinite"/>
      <g fill="#fff" opacity=".85">${range(8).map((i) => `<rect x="${i * 64}" y="128" width="20" height="3"/><rect x="${i * 64 + 30}" y="160" width="20" height="3"/>`).join("")}</g></g>
    ${(
      [
        ["#2f7fe0", SKIN, 120, 104, "0s"],
        ["#f08a24", SKIN2, 100, 138, ".15s"],
      ] as const
    )
      .map(
        ([shirt, skin, x, y, d]) => `
    <g class="loop-runner" transform="translate(${x} ${y})"><animateTransform attributeName="transform" type="translate" values="${x} ${y};${x} ${y - 3};${x} ${y}" dur=".3s" begin="${d}" repeatCount="indefinite" additive="replace"/>
      <g transform="rotate(12)">
      <g><animateTransform attributeName="transform" type="rotate" values="40;-40;40" dur=".6s" begin="${d}" repeatCount="indefinite"/><rect x="-3" y="14" width="6" height="18" rx="3" fill="#2b303b"/></g>
      <g><animateTransform attributeName="transform" type="rotate" values="-40;40;-40" dur=".6s" begin="${d}" repeatCount="indefinite"/><rect x="-3" y="14" width="6" height="18" rx="3" fill="#1d1f24"/></g>
      <rect x="-7" y="-6" width="14" height="22" rx="6" fill="${shirt}"/>
      <g><animateTransform attributeName="transform" type="rotate" values="-50;50;-50" dur=".6s" begin="${d}" repeatCount="indefinite"/><rect x="-2.5" y="-4" width="5" height="16" rx="2.5" fill="${skin}"/></g>
      <circle cy="-14" r="9" fill="${skin}"/></g></g>`,
      )
      .join("")}`,
  boxing: `
    <rect width="320" height="180" fill="#2c3a5e"/>
    <g fill="#fff" opacity=".5">${range(14).map((i) => `<circle cx="${12 + i * 23}" cy="${30 + (i % 3) * 6}" r="2"/>`).join("")}</g>
    <polygon points="30,124 290,124 320,180 0,180" fill="#e9eef5"/>
    <g stroke="#ee334e" stroke-width="3"><line x1="22" y1="82" x2="298" y2="82"/><line x1="18" y1="100" x2="302" y2="100"/><line x1="14" y1="118" x2="306" y2="118"/></g>
    <rect x="16" y="70" width="8" height="70" fill="#1d1d1f"/><rect x="296" y="70" width="8" height="70" fill="#1d1d1f"/>
    <g transform="translate(118 118)"><rect x="-11" y="0" width="22" height="30" rx="9" fill="${SKIN}"/><rect x="-11" y="22" width="22" height="12" fill="#2f7fe0"/><circle cy="-13" r="12" fill="${SKIN}"/><path d="M-12 -16 Q0 -30 12 -16 Q8 -24 0 -24 Q-8 -24 -12 -16Z" fill="#4a2c1a"/>
      <circle cx="10" cy="-6" r="7" fill="#2f7fe0"/>
      <g class="loop-jab"><animateTransform attributeName="transform" type="translate" values="0 0;30 -6;0 0;0 0" keyTimes="0;.12;.3;1" dur="1.4s" repeatCount="indefinite"/><circle cx="14" cy="4" r="8" fill="#2f7fe0"/></g></g>
    <g transform="translate(200 118)"><animateTransform attributeName="transform" type="translate" values="200 118;200 118;206 118;200 118" keyTimes="0;.12;.2;1" dur="1.4s" repeatCount="indefinite"/>
      <rect x="-11" y="0" width="22" height="30" rx="9" fill="${SKIN2}"/><rect x="-11" y="22" width="22" height="12" fill="#ee334e"/><circle cy="-13" r="12" fill="${SKIN2}"/><path d="M-12 -16 Q0 -30 12 -16 Q8 -24 0 -24 Q-8 -24 -12 -16Z" fill="#1d1b1a"/>
      <circle cx="-12" cy="-10" r="8" fill="#ee334e"/><circle cx="-6" cy="4" r="8" fill="#ee334e"/></g>
    <g opacity="0"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;.1;.13;.25;1" dur="1.4s" repeatCount="indefinite"/><polygon points="178,98 184,90 186,99 194,96 188,104 194,110 185,108 182,116 179,107 171,108 177,102" fill="#fcb131"/></g>`,
  basketball: `
    <rect width="320" height="180" fill="#9fd6ff"/>
    <g fill="#5aa97f"><circle cx="30" cy="96" r="22"/><circle cx="58" cy="92" r="18"/><circle cx="296" cy="96" r="22"/></g>
    <g stroke="#9aa4ad" stroke-width="1" opacity=".7">${range(20).map((i) => `<line x1="${i * 16}" y1="86" x2="${i * 16 + 16}" y2="118"/><line x1="${i * 16 + 16}" y1="86" x2="${i * 16}" y2="118"/>`).join("")}</g>
    <rect y="118" width="320" height="62" fill="#8e98a5"/>
    <path d="M60 180 Q160 112 260 180" fill="none" stroke="#fff" stroke-width="2"/>
    <rect x="252" y="40" width="5" height="110" fill="#666"/>
    <rect x="216" y="34" width="44" height="30" fill="#fff" stroke="#666" stroke-width="2"/><rect x="230" y="44" width="16" height="12" fill="none" stroke="#ee334e" stroke-width="2"/>
    <ellipse cx="236" cy="64" rx="12" ry="3" fill="none" stroke="#ee334e" stroke-width="2.5"/>
    <path class="loop-net" fill="none" stroke="#eee" stroke-width="1.2" d="M224 64 L228 80 L244 80 L248 64 M230 64 L232 80 M242 64 L240 80"><animate attributeName="d" values="M224 64 L228 80 L244 80 L248 64 M230 64 L232 80 M242 64 L240 80;M224 64 L228 80 L244 80 L248 64 M230 64 L232 80 M242 64 L240 80;M224 64 L230 84 L242 84 L248 64 M230 64 L233 84 M242 64 L239 84;M224 64 L228 80 L244 80 L248 64 M230 64 L232 80 M242 64 L240 80" keyTimes="0;.62;.7;1" dur="2s" repeatCount="indefinite"/></path>
    <g transform="translate(86 132)"><rect x="-10" y="0" width="20" height="28" rx="8" fill="#e86a24"/><circle cy="-12" r="11" fill="${SKIN2}"/><path d="M-11 -14 Q0 -27 11 -14 Q7 -21 0 -21 Q-7 -21 -11 -14Z" fill="#1d1b1a"/>
      <rect x="-8" y="26" width="7" height="16" fill="#2b303b"/><rect x="1" y="26" width="7" height="16" fill="#2b303b"/>
      <g><animateTransform attributeName="transform" type="rotate" values="0;-150;-150;0" keyTimes="0;.18;.5;1" dur="2s" repeatCount="indefinite"/><rect x="6" y="2" width="5" height="18" rx="2.5" fill="${SKIN2}"/></g></g>
    <g class="loop-hoop-ball"><animateMotion dur="2s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;.15;.7;1" calcMode="linear" path="M100 118 Q170 0 236 62 L236 112"/>
      <circle r="7" fill="#f08a24"/><path d="M-7 0 H7 M0 -7 V7" stroke="#7a3a10" stroke-width="1"/></g>`,
  bowling: `
    <rect width="320" height="180" fill="#3c2a5e"/>
    <g fill="#fcb131" opacity=".85"><rect x="20" y="18" width="70" height="10" rx="5"/><rect x="230" y="18" width="70" height="10" rx="5"/></g>
    <g fill="#ee334e" opacity=".7"><rect x="100" y="14" width="120" height="6" rx="3"/></g>
    <polygon points="134,40 186,40 248,180 72,180" fill="#e5b77c"/>
    <polygon points="120,40 134,40 72,180 50,180" fill="#2b2140"/><polygon points="186,40 200,40 270,180 248,180" fill="#2b2140"/>
    <g fill="#c48a4e">${range(7).map((i) => `<polygon points="${158 + (i - 3) * 10},120 ${160 + (i - 3) * 10},114 ${162 + (i - 3) * 10},120"/>`).join("")}</g>
    ${[
      [160, 48],
      [154, 44],
      [166, 44],
      [148, 40],
      [160, 40],
      [172, 40],
    ]
      .map(
        ([x, y], i) => `
    <g class="loop-pin" transform="translate(${x} ${y})"><animateTransform attributeName="transform" type="rotate" values="0;0;${i % 2 ? 70 : -70};${i % 2 ? 70 : -70};0" keyTimes="0;.55;.62;.95;1" dur="2.6s" repeatCount="indefinite" additive="sum"/>
      <ellipse cx="0" cy="0" rx="3" ry="7" fill="#fff"/><rect x="-2.5" y="-4" width="5" height="1.5" fill="#ee334e"/></g>`,
      )
      .join("")}
    <g class="loop-bowl" opacity="0"><animateMotion dur="2.6s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;.22;.6;1" calcMode="linear" path="M205 160 Q218 96 162 50"/>
      <g><animateTransform attributeName="transform" type="scale" values="1;1;.5;.5" keyTimes="0;.22;.6;1" dur="2.6s" repeatCount="indefinite"/>
        <circle r="7" fill="#e0453a"/><circle cx="-2" cy="-2.5" r="1.1" fill="#7a1d18"/><circle cx="1.8" cy="-3.2" r="1.1" fill="#7a1d18"/><circle cx="0" cy="0" r="1.1" fill="#7a1d18"/></g>
      <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.22;.23;.6;.62;1" dur="2.6s" repeatCount="indefinite"/></g>
    <g transform="translate(184 136)">
      <rect x="-8" y="26" width="7" height="16" fill="#2b303b"/><rect x="1" y="26" width="7" height="16" fill="#2b303b"/>
      <rect x="-15" y="3" width="5" height="18" rx="2.5" fill="#2f7fe0" transform="rotate(12 -12 3)"/>
      <rect x="-10" y="0" width="20" height="28" rx="8" fill="#2f7fe0"/>
      <rect x="-3" y="-3" width="6" height="4" fill="${SKIN}"/><circle cy="-12" r="11" fill="#4a2c1a"/>
      <g transform="rotate(-20 9 3)"><animateTransform attributeName="transform" type="rotate" values="-20 9 3;-45 9 3;-20 9 3;-35 9 3;-20 9 3" keyTimes="0;.12;.22;.32;1" dur="2.6s" repeatCount="indefinite"/>
        <rect x="6.5" y="2" width="5" height="20" rx="2.5" fill="#2f7fe0"/><circle cx="9" cy="23" r="3" fill="${SKIN}"/>
        <g><circle cx="9" cy="30" r="7" fill="#e0453a"/><circle cx="7" cy="27.5" r="1.1" fill="#7a1d18"/><circle cx="10.8" cy="26.8" r="1.1" fill="#7a1d18"/>
          <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;.22;.23;.97;1" dur="2.6s" repeatCount="indefinite"/></g></g></g>`,
};

// Card colours: the mock's hues, darkened where needed so the white name and
// line on each card pass WCAG AA (pairs listed in client/ui/brand.ts).
export const ART: Record<string, SportArt> = {
  tennis: { colour: "#1e7a3c", dark: "#145a2b", ground: "#3f9a57", hillFar: "#7cc6a0", hillNear: "#4fae7b", icon: ICON.tennis, preview: PREVIEW.tennis, field: FIELD.tennis },
  bowling: { colour: "#1f63c0", dark: "#164a90", ground: "#c48a4e", hillFar: "#9a7bc7", hillNear: "#7a5bab", icon: ICON.bowling, preview: PREVIEW.bowling, field: FIELD.bowling },
  archery: { colour: "#c22f2a", dark: "#8f221e", ground: "#58a64a", hillFar: "#9cd08a", hillNear: "#6fb85e", icon: ICON.archery, preview: PREVIEW.archery, field: FIELD.archery },
  track: { colour: "#b3560c", dark: "#844008", ground: "#c9473a", hillFar: "#87c7a6", hillNear: "#5aa97f", icon: ICON.track, preview: PREVIEW.track, field: FIELD.track },
  boxing: { colour: "#7340c4", dark: "#542e92", ground: "#3c4f7a", hillFar: "#6f7fb0", hillNear: "#4c5d92", icon: ICON.boxing, preview: PREVIEW.boxing, field: FIELD.boxing },
  basketball: { colour: "#a3410f", dark: "#76300b", ground: "#7d8794", hillFar: "#8fc6a3", hillNear: "#66ad80", icon: ICON.basketball, preview: PREVIEW.basketball, field: FIELD.basketball },
};

/** A sport the art doesn't know yet: a plain card and an empty preview. */
export const PLAIN_ART: SportArt = {
  colour: "#3d5873",
  dark: "#2a3e52",
  ground: "#3f9a57",
  hillFar: "#7cc6a0",
  hillNear: "#4fae7b",
  icon: `<circle cx="46" cy="46" r="32" fill="#e7ecf2"/><text x="46" y="60" text-anchor="middle" font-size="40" font-weight="800" fill="#6b7a8a">?</text>`,
  preview: `<rect width="320" height="180" fill="#c9dcf0"/>`,
  field: "",
};

/** The background scene: sky, drifting clouds, hills, a stand with a bobbing crowd, the ground; the field changes per sport. */
export function sceneSvg(): string {
  const colours = ["#2f7fe0", "#e0453a", "#2fa84f", "#f2c230", "#8a4fd8", "#f08a24", "#e85d9e"];
  const fans = range(80)
    .map((i) => `<circle cx="${10 + i * 20}" cy="${500 + (i % 3) * 12}" r="7" fill="${colours[i % colours.length]}"/>`)
    .join("");
  return `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs><linearGradient id="home-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#e6f6ff"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#home-sky)"/>
    <g class="hs-cloud"><ellipse cx="200" cy="120" rx="90" ry="30"/><ellipse cx="260" cy="105" rx="60" ry="28"/></g>
    <g class="hs-cloud hs-cloud--2"><ellipse cx="700" cy="190" rx="110" ry="32"/><ellipse cx="770" cy="172" rx="70" ry="30"/></g>
    <g class="hs-cloud hs-cloud--3"><ellipse cx="1200" cy="90" rx="80" ry="26"/></g>
    <path class="hs-hills-far" d="M0 520 C200 440 360 470 520 430 C700 385 860 460 1040 420 C1220 380 1400 440 1600 400 L1600 900 L0 900Z"/>
    <polygon fill="#e9eef5" points="0,560 1600,560 1600,470 0,470"/>
    <polygon fill="#cdd7e3" points="0,560 1600,560 1600,540 0,540"/>
    <g class="hs-fans">${fans}</g>
    <path class="hs-hills-near" d="M0 600 C300 570 600 590 900 575 C1200 560 1400 585 1600 570 L1600 900 L0 900Z"/>
    <rect class="hs-ground" y="610" width="1600" height="290"/>
    <g class="hs-field"></g>
  </svg>`;
}
