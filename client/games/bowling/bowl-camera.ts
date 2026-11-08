import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { BowlDetector, DEFAULT_BOWL } from "../../input/camera/bowl-pose.ts";
import type { BowlHand, BowlRead } from "../../input/camera/bowl-pose.ts";

// Bowling's camera (task 29, ADR 004): the same webcam and local pose model
// as the other games (video never leaves the browser), read by bowl-pose.ts
// as `aim` (the bowling hand across the whole picture, walking too) and
// `throw` (a wrist coming forward past the hip: its speed, the aim locked at
// the swing's start, the curve from the sweep around the release). The pose
// model runs every frame, since a swing lasts about half a second, and is
// loaded only when the player opens this panel. Every step has "Use keyboard
// instead"; Escape or a refused permission leaves the keys and the Bowl button.

export interface BowlCallbacks {
  /** The aim changed, -1..1 (on your turn, and in the setup's aim step for the arrow). */
  aim(aim: number): void;
  /** A release: speed 0..1, the aim locked when the swing began, spin -1..1 (once a turn, only on your turn). */
  throw(speed: number, aim: number, spin: number): void;
  /** The setup panel opened (true) or closed (false); practice holds the game meanwhile. */
  pause(paused: boolean): void;
}

export interface BowlCamera {
  /** The camera is running (keys and the button still work alongside it). */
  on(): boolean;
  /** For the ready panel: off, on but not seeing you, or tracking. */
  state(): "off" | "on" | "ok";
  /** Whether it is this player's turn: a throw is only read on it, one a turn. */
  setTurn(mine: boolean): void;
  dispose(): void;
}

const STYLE_ID = "bowl-camera-style";
// the panel's own few rules, kept here so this file stands alone
const STYLE = `
.bc-read { display: flex; gap: 0.4rem; align-items: center; justify-content: center; padding: 0.3rem 0.5rem; border-radius: 8px;
  background: color-mix(in srgb, var(--bg, #111) 85%, transparent); font-size: 0.9rem; font-weight: 600; }
.bc-read[hidden] { display: none; }
.bc-read[data-warn="true"] { outline: 2px solid #f5b942; }
.bc-figure { display: block; width: 6rem; height: 8rem; margin: 0.25rem auto 0.75rem; color: #9ca3af; transition: color 0.15s; }
.bc-figure[data-ok="true"] { color: #4ade80; }
.bc-figure .bc-hips { opacity: 0.35; transition: opacity 0.15s; }
.bc-figure[data-ok="true"] .bc-hips { opacity: 1; }
.bc-arrow { display: block; width: 10rem; height: 4rem; margin: 0.25rem auto 0.75rem; }
.bc-arrow g { transition: transform 0.08s linear; }
.bc-debug { margin: 0; padding: 0.4rem; max-height: 40vh; overflow: auto; font: 11px/1.3 ui-monospace, monospace; white-space: pre;
  background: #000c; color: #e5e5e5; border-radius: 6px; pointer-events: auto; }
`;

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.append(s);
}

const STAND_WORDS = "Stand back so we see you down to your hips (put the laptop on a chair, or tilt the screen back).";
const SWING_WORDS = "Swing underarm, step and crouch if you like, it's the swing that counts. Sweep your hand across as you let go to curve it, no need to twist.";

const curveWords = (spin: number) => (Math.abs(spin) < 0.05 ? "none" : `${Math.abs(spin) < 0.5 ? "a little" : "a lot"} ${spin > 0 ? "right" : "left"}`);
const speedWords = (speed: number) => (speed < 0.33 ? "slow" : speed < 0.67 ? "medium" : "fast");

export function createBowlCamera(view: HTMLElement, button: HTMLButtonElement, chip: HTMLElement, cb: BowlCallbacks): BowlCamera {
  addStyle();
  const video = document.createElement("video");
  video.className = "selfview";
  video.hidden = true;
  video.setAttribute("aria-label", "Your camera preview, not sent anywhere");
  const dock = document.createElement("div");
  dock.className = "cam-dock";
  // one line under the preview: whose turn, stand back, the last throw read
  const read = document.createElement("div");
  read.className = "bc-read";
  read.setAttribute("role", "status");
  read.hidden = true;
  dock.append(video, read);
  const panel = document.createElement("section");
  panel.className = "camera-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Camera setup");
  panel.hidden = true;
  view.append(dock, panel);

  const detector = new BowlDetector();
  let session: CameraSession | null = null;
  let starting = false;
  let tracking = false;
  let mine = false;
  // the setup step showing, if any: its frame handler updates the panel
  let step: ((r: BowlRead, f: CameraFrame) => void) | null = null;
  let aimSent: { t: number; aim: number } | null = null;
  let lastAim = 0;
  let lastThrow = "";
  let readShown = "";

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.textContent = text;
    chip.dataset.state = state;
  };
  const setRead = (text: string, warn: boolean) => {
    if (text === readShown) return;
    readShown = text;
    read.textContent = text;
    read.dataset.warn = String(warn);
  };

  const debug = createDebugReadout(dock);

  const sendAim = (t: number, aim: number) => {
    // throttled: a change of 0.02 or more, at most about 15 a second
    if (aimSent && (Math.abs(aim - aimSent.aim) < 0.02 || t - aimSent.t < 66)) return;
    aimSent = { t, aim };
    cb.aim(aim);
  };

  const onFrame = (f: CameraFrame) => {
    const r = detector.update(f);
    tracking = r.tracking;
    video.dataset.tracking = String(tracking);
    if (!r.tracking) setChip("Can't see your shoulders", "warn");
    else if (r.fallback) setChip("Stand back so we see your hips", "warn");
    else setChip("Tracking", "ok");
    lastAim = r.aim;
    debug?.frame(f, r);
    if (step) {
      // setup: the arrow follows the hand; nothing is thrown
      if (r.tracking) sendAim(f.t, r.aim);
      step(r, f);
      return;
    }
    if (!r.tracking) setRead("Shoulders in view", true);
    else if (!mine) setRead("Their turn, watch", false);
    else if (r.fallback) setRead("Stand back so we see your hips", true);
    else if (r.state === "thrown") setRead(lastThrow || "Thrown!", false);
    else setRead(r.swinging ? "Swinging…" : "Your turn: aim, then swing", false);
    if (!mine) return;
    if (r.tracking && !r.throw && !r.swinging) sendAim(f.t, r.aim);
    if (r.throw) {
      lastThrow = `Speed: ${speedWords(r.throw.speed)}. Curve: ${curveWords(r.throw.spin)}`;
      cb.throw(r.throw.speed, r.throw.aim, r.throw.spin);
    }
  };

  const close = () => {
    step = null;
    panel.hidden = true;
    // the setup consumed nothing: the turn starts afresh with the camera
    detector.newTurn();
    cb.pause(false);
  };

  const stop = () => {
    session?.stop();
    session = null;
    step = null;
    tracking = false;
    detector.reset();
    aimSent = null;
    video.hidden = true;
    read.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  /** "Use keyboard instead", Escape, or a refused camera: keys and the Bowl button. */
  const useKeyboard = () => {
    stop();
    close();
  };

  const keyboardButton = `<button data-step="keys">Use keyboard instead</button>`;
  const wire = () => panel.querySelector("[data-step=keys]")?.addEventListener("click", useKeyboard);

  const fail = (message: string) => {
    stop();
    step = null;
    panel.innerHTML = `<h2>No camera</h2><p class="error" role="alert"></p><div class="row"><button class="primary" data-step="close">OK</button></div>`;
    (panel.querySelector(".error") as HTMLElement).textContent = message;
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
    (panel.querySelector("[data-step=close]") as HTMLElement | null)?.focus();
  };

  // step 4: a try swing, read and shown but never sent
  const swingStep = () => {
    panel.innerHTML = `
      <h2>Bowl</h2>
      <p>${SWING_WORDS}</p>
      <p>The ball leaves your hand as it comes forward past your hip. Try one: nothing is bowled yet.</p>
      <p class="muted" data-try role="status">Waiting for a swing</p>
      <div class="row"><button class="primary" data-step="done">Start bowling</button>${keyboardButton}</div>`;
    const words = panel.querySelector("[data-try]") as HTMLElement;
    panel.querySelector("[data-step=done]")?.addEventListener("click", close);
    wire();
    (panel.querySelector("[data-step=done]") as HTMLElement | null)?.focus();
    const trial = new BowlDetector();
    trial.setTurn(true);
    let shown = "";
    step = (r, f) => {
      const t = trial.update(f);
      let w = shown || "Waiting for a swing";
      if (!r.tracking) w = "Step back until your shoulders are in view";
      else if (t.throw) {
        w = `Read it: speed ${speedWords(t.throw.speed)}, curve ${curveWords(t.throw.spin)}${t.throw.fallback ? " (stand back so we see your hips)" : ""}`;
        trial.newTurn();
      }
      if (w !== shown) words.textContent = shown = w;
    };
  };

  // step 3: moving the hand or walking slides the arrow
  const aimStep = () => {
    panel.innerHTML = `
      <h2>Aim</h2>
      <p>Move your bowling hand left or right, or walk: the arrow on the lane follows. It stays put once you start your swing.</p>
      <svg class="bc-arrow" viewBox="0 0 160 64" aria-hidden="true">
        <rect x="10" y="4" width="140" height="56" rx="4" fill="#c9a26b" opacity="0.5"/>
        <g><path d="M80 8 L90 24 L84 24 L84 56 L76 56 L76 24 L70 24 Z" fill="currentColor"/></g>
      </svg>
      <p class="muted" data-aim role="status">Middle</p>
      <div class="row"><button class="primary" data-step="next">Next</button>${keyboardButton}</div>`;
    const g = panel.querySelector(".bc-arrow g") as SVGGElement;
    const words = panel.querySelector("[data-aim]") as HTMLElement;
    panel.querySelector("[data-step=next]")?.addEventListener("click", swingStep);
    wire();
    (panel.querySelector("[data-step=next]") as HTMLElement | null)?.focus();
    let shown = "";
    step = (r) => {
      // the arrow slides across the lane (the start spot), as in the game
      g.style.transform = `translateX(${(r.aim * 60).toFixed(1)}px)`;
      const w = !r.tracking ? "Step back until your shoulders are in view" : Math.abs(r.aim) < 0.1 ? "Middle" : r.aim > 0 ? "Right" : "Left";
      if (w !== shown) words.textContent = shown = w;
    };
  };

  // step 2: the silhouette goes green once the hips are seen
  const standStep = () => {
    panel.innerHTML = `
      <h2>Stand back</h2>
      <p>${STAND_WORDS}</p>
      <svg class="bc-figure" viewBox="0 0 60 80" aria-hidden="true">
        <circle cx="30" cy="12" r="8" fill="currentColor"/>
        <path d="M14 24 H46 L42 50 H18 Z" fill="currentColor"/>
        <rect class="bc-hips" x="16" y="50" width="28" height="10" rx="3" fill="currentColor"/>
        <path d="M18 60 L16 78 M42 60 L44 78" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity="0.35"/>
      </svg>
      <p class="muted" data-hips role="status">Looking for your hips</p>
      <div class="row"><button class="primary" data-step="next">Next</button>${keyboardButton}</div>`;
    const fig = panel.querySelector(".bc-figure") as SVGElement;
    const words = panel.querySelector("[data-hips]") as HTMLElement;
    panel.querySelector("[data-step=next]")?.addEventListener("click", aimStep);
    wire();
    (panel.querySelector("[data-step=next]") as HTMLElement | null)?.focus();
    let shown = "";
    let okSince: number | null = null;
    step = (r) => {
      fig.dataset.ok = String(r.hipsSeen);
      const w = !r.tracking ? "Step back until your shoulders are in view" : r.hipsSeen ? "We can see your hips" : "Looking for your hips";
      if (w !== shown) words.textContent = shown = w;
      // hips seen for a second: on to aiming by itself
      const now = performance.now();
      okSince = r.hipsSeen ? (okSince ?? now) : null;
      if (okSince !== null && now - okSince > 1000) aimStep();
    };
  };

  const start = async () => {
    if (starting) return;
    starting = true;
    panel.innerHTML = `<h2>Starting camera…</h2><p class="muted" role="status">Waiting for permission.</p><div class="row">${keyboardButton}</div>`;
    wire();
    try {
      const stream = await openCamera(video);
      if (panel.hidden) {
        // left for the keyboard while the browser asked
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        return;
      }
      video.hidden = false;
      panel.innerHTML = `<h2>Loading pose model…</h2><p class="muted" role="status">The first time takes a few seconds.</p><div class="row">${keyboardButton}</div>`;
      wire();
      setChip("Loading…", "warn");
      // the pose model every frame (a swing lasts about 0.5 s); no hand model
      session = await startPose(video, stream, onFrame, () => {});
      if (panel.hidden) {
        // Escape while the model loaded: keys it is
        stop();
        return;
      }
      button.textContent = "Stop camera";
      read.hidden = false;
      standStep();
    } catch (err) {
      fail(err instanceof CameraError ? err.message : "The camera didn't start. Keep playing with keys and buttons.");
    } finally {
      starting = false;
    }
  };

  // step 1
  const intro = () => {
    panel.innerHTML = `
      <h2>Bowl with your camera</h2>
      <p class="tr-how">${STAND_WORDS}</p>
      <p>${SWING_WORDS}</p>
      <details class="rp-safety"><summary>Before you start</summary>
        <ul><li>Clear the space in front of and behind you: your arm swings both ways.</li><li>Hold nothing: there is no real ball.</li><li>Stop if anything hurts.</li></ul>
      </details>
      <p class="muted">The video stays in this browser; only the pose is used.</p>
      <div class="row">
        <button class="primary" data-step="start">Start camera</button>
        ${keyboardButton}
      </div>`;
    panel.querySelector("[data-step=start]")?.addEventListener("click", () => void start());
    wire();
  };

  const onButton = () => {
    if (session) {
      stop();
      return;
    }
    panel.hidden = false;
    cb.pause(true);
    intro();
    (panel.querySelector("[data-step=start]") as HTMLElement | null)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || panel.hidden) return;
    e.preventDefault();
    useKeyboard();
  };
  button.addEventListener("click", onButton);
  window.addEventListener("keydown", onKey);

  return {
    on: () => session !== null,
    state: () => (!session ? "off" : tracking ? "ok" : "on"),
    setTurn(m) {
      const fresh = m && !mine;
      mine = m;
      detector.setTurn(m);
      if (fresh) {
        // a new turn: the arrow shows where the hand is now
        aimSent = null;
        lastThrow = "";
        if (session && tracking && !step) sendAim(performance.now(), lastAim);
      }
    },
    dispose() {
      button.removeEventListener("click", onButton);
      window.removeEventListener("keydown", onKey);
      stop();
      debug?.dispose();
      dock.remove();
      panel.remove();
    },
  };
}

// Playtest readout (`?debug` in the address, before the `#`), the method in
// docs/camera-playtest.md ("Bowling's moves"). Live: each wrist against the
// hip line, its forward (upward) speed and sweep, the aim, whether the hips
// are seen and the detector's state. Recording: press 1-9 or 0 (move 10) for
// a move, a 3 s countdown (beep), 5 s recorded (beep), saved (beep). Per move:
// the 10th/median/90th of the speed at each crossing of the line going up
// (behind the hips by depth or not), of the throws' sweep, the frames the hips
// and each hand were seen, and the throws a detector read (one that is always
// on turn, so every recording counts). C copies the table as text to paste
// into the chat. Never shown otherwise.
const MOVES = [
  "slow swing",
  "medium swing",
  "fast swing",
  "medium with a step and crouch",
  "straight, natural follow-through (no curve)",
  "curve left",
  "curve right",
  "left-handed medium",
  "moving, no throw (pick up, stretch, walk sideways)",
  "medium at 1 m (the fallback)",
] as const;
const COUNTDOWN_MS = 3000;
const RECORD_MS = 5000;

interface Rec {
  move: number;
  startsAt: number;
  endsAt: number;
  frames: number;
  hips: number;
  seen: Record<BowlHand, number>;
  /** speed at each crossing going up, in front (or depth unknown) */
  cross: number[];
  /** speed at each crossing the depth put behind the hips (backswings) */
  behind: number[];
  sweeps: number[];
  speeds: number[];
  throws: string[];
}

function createDebugReadout(dock: HTMLElement): { frame(f: CameraFrame, r: BowlRead): void; dispose(): void } | null {
  if (!new URLSearchParams(location.search).has("debug")) return null;
  const el = document.createElement("pre");
  el.className = "bc-debug";
  el.setAttribute("aria-hidden", "true");
  dock.append(el);
  // a second detector, always on turn and re-armed after each throw, so every recording counts its throws
  const counter = new BowlDetector();
  counter.setTurn(true);
  let fps = 0;
  let lastT = 0;
  let status = "Press 1-9 or 0 to record a move, C to copy";
  let rec: Rec | null = null;
  const results = new Map<number, string>();
  let drawnAt = -Infinity;
  let lastThrow = "";

  const beep = (hz: number) => {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.15);
      o.onended = () => void ctx.close();
    } catch {
      /* no sound is fine */
    }
  };
  const q = (xs: number[], p: number): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  };
  const n = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d));
  const three = (xs: number[], d = 2) => `(${xs.length}) lo ${n(q(xs, 0.1), d)} typ ${n(q(xs, 0.5), d)} hi ${n(q(xs, 0.9), d)}`;
  const pct = (k: number, of: number) => `${Math.round((100 * k) / Math.max(1, of))}%`;

  const summarise = (r: Rec): string =>
    [
      `[${r.move === 10 ? 0 : r.move}] ${MOVES[r.move - 1]}  frames ${r.frames}  hips seen ${pct(r.hips, r.frames)}  left ${pct(r.seen.left, r.frames)}  right ${pct(r.seen.right, r.frames)}`,
      `  release speed (crossing up, in front) ${three(r.cross, 1)} | behind (backswing) ${three(r.behind, 1)}`,
      `  throws read ${r.throws.length}: ${r.throws.join(", ") || "none"}`,
      `  throw speed 0..1 ${three(r.speeds)} | sweep ${three(r.sweeps)}`,
    ].join("\n");
  const table = () =>
    [...results.keys()]
      .sort((a, b) => a - b)
      .map((k) => results.get(k))
      .join("\n");

  const onKey = (e: KeyboardEvent) => {
    const d = Number(e.key);
    const move = e.key === "0" ? 10 : d;
    if (/^[0-9]$/.test(e.key) && move >= 1 && move <= MOVES.length && !rec) {
      const now = performance.now();
      rec = {
        move,
        startsAt: now + COUNTDOWN_MS,
        endsAt: now + COUNTDOWN_MS + RECORD_MS,
        frames: 0,
        hips: 0,
        seen: { left: 0, right: 0 },
        cross: [],
        behind: [],
        sweeps: [],
        speeds: [],
        throws: [],
      };
      beep(440);
    } else if (e.key === "c" || e.key === "C") {
      const text = `fps ~${fps.toFixed(0)}  config ${JSON.stringify(DEFAULT_BOWL)}\n${table()}`;
      navigator.clipboard?.writeText(text).then(
        () => (status = "Copied. Paste it into the chat."),
        () => (status = "Copy failed: select the table text instead."),
      );
    }
  };
  window.addEventListener("keydown", onKey);

  return {
    dispose: () => window.removeEventListener("keydown", onKey),
    frame(f, r) {
      if (lastT) fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, f.t - lastT));
      lastT = f.t;
      const c = counter.update(f);
      if (c.throw) {
        lastThrow = `${c.throw.hand} speed ${c.throw.speed.toFixed(2)} (${c.throw.raw.toFixed(1)}/s) spin ${c.throw.spin.toFixed(2)} (sweep ${c.throw.sweep.toFixed(2)}) aim ${c.throw.aim.toFixed(2)}${c.throw.fallback ? " FALLBACK" : ""}`;
        counter.newTurn();
      }
      const now = performance.now();
      let head = status;
      if (rec) {
        const key = rec.move === 10 ? 0 : rec.move;
        if (now < rec.startsAt) head = `[${key}] ${MOVES[rec.move - 1]}: get ready… ${Math.ceil((rec.startsAt - now) / 1000)}`;
        else if (now < rec.endsAt) {
          if (rec.frames === 0) beep(660);
          rec.frames++;
          if (c.hipsSeen) rec.hips++;
          for (const h of ["left", "right"] as const) if (c.hands[h]) rec.seen[h]++;
          if (c.crossing) (c.crossing.behind ? rec.behind : rec.cross).push(c.crossing.speed);
          if (c.throw) {
            rec.throws.push(`${c.throw.hand} ${c.throw.speed.toFixed(2)}/${c.throw.spin.toFixed(2)}`);
            rec.speeds.push(c.throw.speed);
            rec.sweeps.push(c.throw.sweep);
          }
          head = `[${key}] ${MOVES[rec.move - 1]}: RECORDING ${Math.ceil((rec.endsAt - now) / 1000)}`;
        } else {
          results.set(rec.move, summarise(rec));
          status = `Saved [${key}] ${MOVES[rec.move - 1]}. Next move, or C to copy`;
          rec = null;
          beep(330);
          head = status;
        }
      }
      // the text is redrawn 5 times a second, not every frame
      if (now - drawnAt < 200) return;
      drawnAt = now;
      const live = (h: BowlHand) => {
        const hr = r.hands[h];
        const vsHip = hr && r.line !== null ? hr.down - r.line : null;
        return `${h.padEnd(5)} vs ${r.fallback ? "chest" : "hip"} ${n(vsHip)} (+ below)  forward ${n(hr?.up, 1)}/s  speed ${n(hr?.speed, 1)}/s  sweep ${n(hr?.sweep)}  depth ${n(hr?.z)}`;
      };
      const done = MOVES.map((name, i) => `${results.has(i + 1) ? "✓" : " "} ${i === 9 ? 0 : i + 1} ${name}`).join("\n");
      el.textContent = [
        `fps ${fps.toFixed(0)}   ${head}`,
        live("left"),
        live("right"),
        `aim ${n(r.aim)}  hips seen ${r.hipsSeen ? "yes" : "NO (fallback)"}  state ${r.state}${r.swinging ? " (swinging)" : ""}`,
        `last throw read: ${lastThrow || "none"}`,
        `throw at ${DEFAULT_BOWL.minSpeed}+/s crossing, speed 1 at ${DEFAULT_BOWL.speed1}; curve from a sweep of ${DEFAULT_BOWL.sweepDead}, full at ${DEFAULT_BOWL.sweepFull}`,
        "",
        done,
        "",
        table(),
      ].join("\n");
    },
  };
}
