import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { DEFAULT_SHOOT, ShootDetector } from "../../input/camera/shoot-pose.ts";
import type { ShootConfig } from "../../input/camera/shoot-pose.ts";
import { powerRangeFrom } from "../../input/camera/power-calibration.ts";
import { cameraSettings, onCameraSettings, updateCameraSettings } from "../../net/camera-settings.ts";
import type { ShootHand, ShootRead } from "../../input/camera/shoot-pose.ts";

// Basketball's camera (task 32, ADR 003): the same webcam and local pose
// model as the other games (video never leaves the browser), read by
// shoot-pose.ts as `set` (hands still at the chest), `aim` (the hands'
// sideways offset) and `shoot` (a fast push up from the chest). The pose
// model runs every frame, since a push lasts 0.2-0.4 s, and is loaded only
// when the player opens this panel. Every step has "Use keyboard instead";
// Escape or a refused permission leaves the keys, mouse and Shoot button.

export interface ShootCallbacks {
  /** Hands still at the chest: the view sends `set` (once a turn, only on your turn). */
  set(): void;
  /** The aim changed, -1..1 (on your turn, and in the setup's aim step for the arrow). */
  aim(aim: number): void;
  /** A push: power 0..1, the aim locked when the push began (once a turn, only on your turn). */
  shoot(power: number, aim: number): void;
  /** The setup panel opened (true) or closed (false); practice holds the game meanwhile. */
  pause(paused: boolean): void;
}

export interface ShootCamera {
  /** The camera is running (keys, mouse and the button still work alongside it). */
  on(): boolean;
  /** For the ready panel: off, on but not seeing you, or tracking. */
  state(): "off" | "on" | "ok";
  /** Whether it is this player's turn: set and shoot are only read on it, one each a turn. */
  setTurn(mine: boolean): void;
  dispose(): void;
}

const STYLE_ID = "shoot-camera-style";
// the panel's own few rules, kept here so this file stands alone
const STYLE = `
.sc-read { display: flex; gap: 0.4rem; align-items: center; justify-content: center; padding: 0.3rem 0.5rem; border-radius: 8px;
  background: color-mix(in srgb, var(--bg, #111) 85%, transparent); font-size: 0.9rem; font-weight: 600; }
.sc-read[hidden] { display: none; }
.sc-read .sc-ball { width: 1rem; height: 1rem; border-radius: 50%; background: #8a5a2b; opacity: 0.45; transition: opacity 0.15s, box-shadow 0.15s; }
.sc-read[data-ready="true"] .sc-ball { opacity: 1; background: #f08a24; box-shadow: 0 0 10px 3px #f08a24aa; }
.sc-read[data-ready="true"] { outline: 2px solid #f08a24; }
.sc-arrow { display: block; width: 8rem; height: 5rem; margin: 0.25rem auto 0.75rem; }
.sc-arrow g { transition: transform 0.08s linear; transform-origin: 50px 58px; }
.sc-glow { display: block; width: 3rem; height: 3rem; margin: 0.25rem auto 0.75rem; border-radius: 50%; background: #8a5a2b; opacity: 0.4;
  transition: opacity 0.15s, box-shadow 0.15s; }
.sc-glow[data-ready="true"] { opacity: 1; background: #f08a24; box-shadow: 0 0 18px 6px #f08a24aa; }
.sc-debug { margin: 0; padding: 0.4rem; max-height: 40vh; overflow: auto; font: 11px/1.3 ui-monospace, monospace; white-space: pre;
  background: #000c; color: #e5e5e5; border-radius: 6px; pointer-events: auto; }
`;

function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = STYLE;
  document.head.append(s);
}

const PUSH_WORDS = "Push up and towards the hoop, like a real shot. No need to jump.";

/** The detector's numbers with this player's saved power range (task 25), if any. */
function shootConfig(): ShootConfig {
  const p = cameraSettings().basketball.power;
  return p ? { ...DEFAULT_SHOOT, power0: p[0], power1: p[1] } : { ...DEFAULT_SHOOT };
}

// quick calibration: this many of each push
const CALIBRATE_PUSHES = 2;

export function createShootCamera(view: HTMLElement, button: HTMLButtonElement, chip: HTMLElement, cb: ShootCallbacks): ShootCamera {
  addStyle();
  const video = document.createElement("video");
  video.className = "selfview";
  video.hidden = true;
  video.setAttribute("aria-label", "Your camera preview, not sent anywhere");
  const dock = document.createElement("div");
  dock.className = "cam-dock";
  // the ready cue: the ball glows while your hands hold it at your chest
  const read = document.createElement("div");
  read.className = "sc-read";
  read.setAttribute("role", "status");
  read.hidden = true;
  read.innerHTML = `<span class="sc-ball" aria-hidden="true"></span><span data-read="text">Hands at your chest</span>`;
  const readText = read.querySelector("[data-read=text]") as HTMLElement;
  dock.append(video, read);
  const panel = document.createElement("section");
  panel.className = "camera-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Camera setup");
  panel.hidden = true;
  view.append(dock, panel);

  const detector = new ShootDetector(shootConfig());
  // a sign-in, a sign-out or a reset elsewhere: the next push uses the new range
  const offSettings = onCameraSettings(() => (detector.cfg = shootConfig()));
  let session: CameraSession | null = null;
  let starting = false;
  let tracking = false;
  let mine = false;
  // the setup step showing, if any: its frame handler updates the panel
  let step: ((r: ShootRead) => void) | null = null;
  let aimSent: { t: number; aim: number } | null = null;
  let lastAim = 0;
  // set while the quick power calibration reads pushes
  let calibrating: ((f: CameraFrame) => void) | null = null;

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.textContent = text;
    chip.dataset.state = state;
  };

  const debug = createDebugReadout(dock);

  const sendAim = (t: number, aim: number) => {
    // throttled: a change of 0.02 or more, at most about 15 a second (the server takes 40)
    if (aimSent && (Math.abs(aim - aimSent.aim) < 0.02 || t - aimSent.t < 66)) return;
    aimSent = { t, aim };
    cb.aim(aim);
  };

  const onFrame = (f: CameraFrame) => {
    const r = detector.update(f);
    tracking = r.tracking;
    video.dataset.tracking = String(tracking);
    if (!r.tracking) setChip("Can't see your shoulders", "warn");
    else if (r.raise) setChip("Raise your hands a little", "warn");
    else setChip("Tracking", "ok");
    read.dataset.ready = String(r.ready && !r.pushing);
    readText.textContent = !r.tracking
      ? "Shoulders in view"
      : r.raise
        ? "Raise your hands a little"
        : r.state === "off-turn"
          ? "Their shot, watch"
          : r.state === "shot"
            ? "Shot!"
            : r.ready
              ? "Ready: push up to shoot"
              : "Hands at your chest";
    lastAim = r.aim;
    debug?.frame(f, r);
    calibrating?.(f);
    if (step) {
      // setup: the arrow follows the hands; nothing is set or shot
      if (r.tracking) sendAim(f.t, r.aim);
      step(r);
      return;
    }
    if (!mine) return;
    if (r.set) cb.set();
    if (r.tracking && !r.shot) sendAim(f.t, r.aim);
    if (r.shot) cb.shoot(r.shot.power, r.shot.aim);
  };

  const close = () => {
    step = null;
    calibrating = null;
    panel.hidden = true;
    // the setup consumed nothing: the turn starts afresh with the camera
    detector.newTurn();
    cb.pause(false);
  };

  const stop = () => {
    session?.stop();
    session = null;
    step = null;
    calibrating = null;
    tracking = false;
    detector.reset();
    aimSent = null;
    video.hidden = true;
    read.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  /** "Use keyboard instead", Escape, or a refused camera: keys, mouse and the Shoot button. */
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

  // step 3: moving the hands swings the arrow
  const aimStep = () => {
    panel.innerHTML = `
      <h2>Aim</h2>
      <p>Move your hands left or right at your chest: the arrow follows.</p>
      <svg class="sc-arrow" viewBox="0 0 100 64" aria-hidden="true"><g><path d="M50 4 L62 22 L54 22 L54 58 L46 58 L46 22 L38 22 Z" fill="currentColor"/></g></svg>
      <p class="muted" data-aim role="status">Straight</p>
      <p>${PUSH_WORDS}</p>
      <div class="row"><button class="primary" data-step="done">Start shooting</button>${keyboardButton}</div>
      ${powerRow()}`;
    const g = panel.querySelector(".sc-arrow g") as SVGGElement;
    const words = panel.querySelector("[data-aim]") as HTMLElement;
    panel.querySelector("[data-step=done]")?.addEventListener("click", close);
    wirePower();
    wire();
    (panel.querySelector("[data-step=done]") as HTMLElement | null)?.focus();
    let shown = "";
    step = (r) => {
      g.style.transform = `rotate(${(r.aim * 40).toFixed(1)}deg)`;
      const w = Math.abs(r.aim) < 0.1 ? "Straight" : r.aim > 0 ? "Right" : "Left";
      if (w !== shown) words.textContent = shown = w;
    };
  };

  // Quick power calibration (task 25 round 3): optional, camera only (speed
  // has no key), never needed to play or to ready up. "Push soft, then push
  // hard" sets where the power bar starts and ends for this player.
  const powerRow = () => {
    const mine = cameraSettings().basketball.power !== null;
    return `<details class="advanced">
        <summary>Power${mine ? ": calibrated" : ""}</summary>
        <p class="muted">Optional. Push soft, then push hard: the power bar fits your own pushes. Camera only; saved with your settings.</p>
        <div class="row"><button data-step="calibrate">Calibrate power</button>${mine ? `<button data-step="power-reset">Default power</button>` : ""}</div>
        <p class="muted" data-power role="status"></p>
      </details>`;
  };
  const wirePower = () => {
    panel.querySelector("[data-step=calibrate]")?.addEventListener("click", () => calibrate("soft", [], []));
    panel.querySelector("[data-step=power-reset]")?.addEventListener("click", () => {
      updateCameraSettings((s) => (s.basketball.power = null));
      aimStep();
      (panel.querySelector("[data-power]") as HTMLElement).textContent = "Back to the default power.";
    });
  };

  const calibrate = (stage: "soft" | "hard", soft: number[], hard: number[]) => {
    const list = stage === "soft" ? soft : hard;
    panel.innerHTML = `
      <h2>Push ${stage}</h2>
      <p>${stage === "soft" ? "Hold the ball at your chest, then push up softly, the gentlest shot you'd take." : "Now push up hard, the strongest shot you'd take."} ${CALIBRATE_PUSHES} times.</p>
      <p class="muted" data-count role="status">0 of ${CALIBRATE_PUSHES}</p>
      <div class="row"><button data-step="cancel">Cancel</button></div>`;
    const count = panel.querySelector("[data-count]") as HTMLElement;
    panel.querySelector("[data-step=cancel]")?.addEventListener("click", aimStep);
    (panel.querySelector("[data-step=cancel]") as HTMLElement | null)?.focus();
    // its own detector, always on turn and re-armed after each push, so every push counts once
    const reader = new ShootDetector({ ...DEFAULT_SHOOT });
    reader.setTurn(true);
    step = () => {};
    calibrating = (f) => {
      const r = reader.update(f);
      if (!r.shot) return;
      reader.newTurn();
      list.push(r.shot.peak);
      count.textContent = `${list.length} of ${CALIBRATE_PUSHES}`;
      if (list.length < CALIBRATE_PUSHES) return;
      calibrating = null;
      if (stage === "soft") return calibrate("hard", soft, hard);
      const result = powerRangeFrom(soft, hard, { lo: DEFAULT_SHOOT.power0, hi: DEFAULT_SHOOT.power1 });
      if (!result.fellBack) updateCameraSettings((s) => (s.basketball.power = [result.range.lo, result.range.hi]));
      aimStep();
      (panel.querySelector("[data-power]") as HTMLElement).textContent = result.fellBack
        ? "Your soft and hard pushes came out too close together, so the default power stays. Try again with a clearer difference."
        : "Power calibrated to your pushes.";
      (panel.querySelector(".advanced") as HTMLDetailsElement).open = true;
    };
  };

  // step 2: the hands at the chest glow
  const readyStep = () => {
    panel.innerHTML = `
      <h2>Hold the ball</h2>
      <p>Hold an imaginary ball at your chest with one hand or both, and keep still. The ball glows when you're ready.</p>
      <span class="sc-glow" aria-hidden="true"></span>
      <p class="muted" data-ready role="status">Hands at your chest</p>
      <div class="row"><button class="primary" data-step="next">Next</button>${keyboardButton}</div>`;
    const glow = panel.querySelector(".sc-glow") as HTMLElement;
    const words = panel.querySelector("[data-ready]") as HTMLElement;
    panel.querySelector("[data-step=next]")?.addEventListener("click", aimStep);
    wire();
    (panel.querySelector("[data-step=next]") as HTMLElement | null)?.focus();
    let shown = "";
    let readySince: number | null = null;
    step = (r) => {
      glow.dataset.ready = String(r.ready);
      const w = !r.tracking ? "Step back until your shoulders are in view" : r.raise ? "Raise your hands a little" : r.ready ? "Ready" : "Hands at your chest";
      if (w !== shown) words.textContent = shown = w;
      // held at the chest for a second: on to aiming by itself
      const now = performance.now();
      readySince = r.ready ? (readySince ?? now) : null;
      if (readySince !== null && now - readySince > 1000) aimStep();
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
      panel.innerHTML = `<h2>Loading pose model…</h2><p class="muted" role="status">The first time takes a few seconds.</p>`;
      setChip("Loading…", "warn");
      // the pose model every frame (a push lasts 0.2-0.4 s); no hand model
      session = await startPose(video, stream, onFrame, () => {});
      if (panel.hidden) {
        // Escape while the model loaded: keys it is
        stop();
        return;
      }
      button.textContent = "Stop camera";
      read.hidden = false;
      readyStep();
    } catch (err) {
      fail(err instanceof CameraError ? err.message : "The camera didn't start. Keep playing with keys and buttons.");
    } finally {
      starting = false;
    }
  };

  // step 1
  const intro = () => {
    panel.innerHTML = `
      <h2>Shoot with your camera</h2>
      <p class="tr-how">Stand about 1 m back, shoulders in view. Seated works too: keep your hands where the camera sees them.</p>
      <p>${PUSH_WORDS}</p>
      <details class="rp-safety"><summary>Before you start</summary>
        <ul><li>Clear the space around you, above your head too.</li><li>Hold nothing: there is no real ball.</li><li>Stop if anything hurts.</li></ul>
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
        // a new turn: let the arrow show where the hands are now
        aimSent = null;
        if (session && tracking && !step) sendAim(performance.now(), lastAim);
      }
    },
    dispose() {
      offSettings();
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
// docs/camera-playtest.md ("Basketball's moves"). Live: each wrist's height,
// upward speed, the aim and the detector's state. Recording: press 1-8 for a
// move, a 3 s countdown (beep), 5 s recorded (beep), saved (beep). Per move:
// the 10th/median/90th of each push's peak upward speed, the frames each
// hand was seen, the aim, and the shots a detector read (one that is always
// on turn, so off-turn recordings count too). C copies the table as text to
// paste into the chat. Never shown otherwise.
const MOVES = [
  "ready, two hands at the chest",
  "soft push, two hands",
  "medium push, two hands",
  "hard push, two hands",
  "medium push, right hand only",
  "medium push, left hand only",
  "moving, no shot (aim sway, scratching, cheering)",
  "chest pass (nearly all forward)",
] as const;
const COUNTDOWN_MS = 3000;
const RECORD_MS = 5000;
/** For the readout only: an upward run faster than this is one "push" whose peak is kept. */
const RUN_SPEED = 1.0;

interface Rec {
  move: number;
  startsAt: number;
  endsAt: number;
  frames: number;
  seen: Record<ShootHand, number>;
  peaks: Record<ShootHand, number[]>;
  run: Record<ShootHand, number>;
  up: Record<ShootHand, number[]>;
  height: Record<ShootHand, number[]>;
  aims: number[];
  shots: string[];
}

function createDebugReadout(dock: HTMLElement): { frame(f: CameraFrame, r: ShootRead): void; dispose(): void } | null {
  if (!new URLSearchParams(location.search).has("debug")) return null;
  const el = document.createElement("pre");
  el.className = "sc-debug";
  el.setAttribute("aria-hidden", "true");
  dock.append(el);
  // a second detector, always on turn and re-armed after each shot, so every recording counts its shots
  const counter = new ShootDetector();
  counter.setTurn(true);
  let fps = 0;
  let lastT = 0;
  let status = "Press 1-8 to record a move, C to copy";
  let rec: Rec | null = null;
  const results = new Map<number, string>();
  let drawnAt = -Infinity;
  let lastShot = "";

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
  const three = (xs: number[], d = 2) => `lo ${n(q(xs, 0.1), d)} typ ${n(q(xs, 0.5), d)} hi ${n(q(xs, 0.9), d)}`;

  const summarise = (r: Rec): string => {
    const lines = [`[${r.move}] ${MOVES[r.move - 1]}  frames ${r.frames}  shots read ${r.shots.length}: ${r.shots.join(", ") || "none"}`];
    lines.push(`  aim (-1 left .. 1 right) ${three(r.aims)}`);
    for (const h of ["left", "right"] as const) {
      lines.push(
        `  ${h.padEnd(5)} seen ${Math.round((100 * r.seen[h]) / Math.max(1, r.frames))}%` +
          ` | push peak up-speed (${r.peaks[h].length}) ${three(r.peaks[h], 1)}` +
          ` | up-speed ${three(r.up[h], 1)}` +
          ` | height ${three(r.height[h])}`,
      );
    }
    return lines.join("\n");
  };
  const table = () =>
    [...results.keys()]
      .sort((a, b) => a - b)
      .map((k) => results.get(k))
      .join("\n");

  const onKey = (e: KeyboardEvent) => {
    const d = Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= MOVES.length && !rec) {
      const now = performance.now();
      const both = <T>(f: () => T): Record<ShootHand, T> => ({ left: f(), right: f() });
      rec = {
        move: d,
        startsAt: now + COUNTDOWN_MS,
        endsAt: now + COUNTDOWN_MS + RECORD_MS,
        frames: 0,
        seen: both(() => 0),
        peaks: both(() => [] as number[]),
        run: both(() => 0),
        up: both(() => [] as number[]),
        height: both(() => [] as number[]),
        aims: [],
        shots: [],
      };
      beep(440);
    } else if (e.key === "c" || e.key === "C") {
      const text = `fps ~${fps.toFixed(0)}  config ${JSON.stringify(shootConfig())}\n${table()}`;
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
      if (c.shot) {
        lastShot = `${c.shot.hands} power ${c.shot.power.toFixed(2)} aim ${c.shot.aim.toFixed(2)} peak ${c.shot.peak.toFixed(1)}`;
        counter.newTurn();
      }
      const now = performance.now();
      let head = status;
      if (rec) {
        if (now < rec.startsAt) head = `[${rec.move}] ${MOVES[rec.move - 1]}: get ready… ${Math.ceil((rec.startsAt - now) / 1000)}`;
        else if (now < rec.endsAt) {
          if (rec.frames === 0) beep(660);
          rec.frames++;
          if (c.tracking) rec.aims.push(c.aim);
          if (c.shot) rec.shots.push(`${c.shot.hands} ${c.shot.power.toFixed(2)}`);
          for (const h of ["left", "right"] as const) {
            const hr = c.hands[h];
            if (!hr) {
              if (rec.run[h] > 0) rec.peaks[h].push(rec.run[h]);
              rec.run[h] = 0;
              continue;
            }
            rec.seen[h]++;
            rec.height[h].push(-hr.down);
            if (hr.up === null) continue;
            rec.up[h].push(hr.up);
            if (hr.up > RUN_SPEED) rec.run[h] = Math.max(rec.run[h], hr.up);
            else if (rec.run[h] > 0) {
              rec.peaks[h].push(rec.run[h]);
              rec.run[h] = 0;
            }
          }
          head = `[${rec.move}] ${MOVES[rec.move - 1]}: RECORDING ${Math.ceil((rec.endsAt - now) / 1000)}`;
        } else {
          for (const h of ["left", "right"] as const) if (rec.run[h] > 0) rec.peaks[h].push(rec.run[h]);
          results.set(rec.move, summarise(rec));
          status = `Saved [${rec.move}] ${MOVES[rec.move - 1]}. Next move, or C to copy`;
          rec = null;
          beep(330);
          head = status;
        }
      }
      // the text is redrawn 5 times a second, not every frame
      if (now - drawnAt < 200) return;
      drawnAt = now;
      const live = (h: ShootHand) => {
        const hr = r.hands[h];
        return `${h.padEnd(5)} height ${n(hr ? -hr.down : null)}  up-speed ${n(hr?.up, 1)}  across ${n(hr?.across)}  ${hr?.ready ? "AT CHEST" : ""}`;
      };
      const done = MOVES.map((name, i) => `${results.has(i + 1) ? "✓" : " "} ${i + 1} ${name}`).join("\n");
      el.textContent = [
        `fps ${fps.toFixed(0)}   ${head}`,
        live("left"),
        live("right"),
        `aim ${n(r.aim)}  state ${r.state}${r.pushing ? " (pushing)" : ""}${r.raise ? " (raise your hands)" : ""}`,
        `last shot read: ${lastShot || "none"}   shot at ${DEFAULT_SHOOT.minPeak}+ up-speed, power 1 at ${shootConfig().power1}`,
        "",
        done,
        "",
        table(),
      ].join("\n");
    },
  };
}
