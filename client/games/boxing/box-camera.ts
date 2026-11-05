import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { BoxTracker, armMeasures, boxFrame } from "../../input/camera/box-pose.ts";
import type { ArmMeasures, BoxHand, BoxPunch } from "../../input/camera/box-pose.ts";

// Boxing's camera (task 30): the same webcam and local pose model as the other
// games (video never leaves the browser), read as punches and a guard by
// box-pose.ts. A jab is a fast hand toward the screen, a hook a fast sweep
// across the body, and both hands by your face is the guard. Laptop distance,
// upper body in view; the maths is in shoulder widths, so there is nothing to
// calibrate. Every step can be skipped: J, K, Space and the buttons still work.

export interface BoxCameraCallbacks {
  /** A punch the camera read; the view sends it as the same message a key does. */
  punch(kind: BoxPunch, hand: BoxHand): void;
  /** The guard went up (true) or down. */
  guard(up: boolean): void;
  /** The setup panel opened (true) or closed (false); practice holds the bout meanwhile. */
  pause(paused: boolean): void;
}

export interface BoxCamera {
  on(): boolean;
  state(): "off" | "on" | "ok";
  dispose(): void;
}

export function createBoxCamera(view: HTMLElement, button: HTMLButtonElement, chip: HTMLElement, cb: BoxCameraCallbacks): BoxCamera {
  const video = document.createElement("video");
  video.className = "selfview";
  video.hidden = true;
  video.setAttribute("aria-label", "Your camera preview, not sent anywhere");
  const dock = document.createElement("div");
  dock.className = "cam-dock";
  // what the camera last read, so a player sees a punch or the guard register
  const read = document.createElement("div");
  read.className = "bx-read";
  read.setAttribute("aria-hidden", "true");
  read.hidden = true;
  read.innerHTML = `<span data-read="guard">Guard</span><span data-read="punch">–</span>`;
  dock.append(video, read);
  const panel = document.createElement("section");
  panel.className = "camera-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Camera setup");
  panel.hidden = true;
  view.append(dock, panel);

  let session: CameraSession | null = null;
  const tracker = new BoxTracker();
  let starting = false;
  let tracking = false;
  let guardSent = false;
  let punchTimer = 0;
  const punchEl = read.querySelector("[data-read=punch]") as HTMLElement;
  const guardEl = read.querySelector("[data-read=guard]") as HTMLElement;

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.textContent = text;
    chip.dataset.state = state;
  };

  const debug = createDebugReadout(dock);

  const onFrame = (f: CameraFrame) => {
    const frame = f.landmarks ? boxFrame(f.landmarks, f.aspect) : null;
    debug?.frame(f);
    tracking = frame !== null;
    setChip(frame ? "Tracking" : "Can't see your shoulders", frame ? "ok" : "warn");
    video.dataset.tracking = String(tracking);
    const r = tracker.update(frame, f.t);
    if (r.guard !== guardSent) {
      guardSent = r.guard;
      cb.guard(r.guard);
    }
    guardEl.dataset.on = String(r.guard);
    if (r.punch) {
      debug?.punch(`${r.punch.hand} ${r.punch.kind}`);
      cb.punch(r.punch.kind, r.punch.hand);
      punchEl.textContent = `${r.punch.hand} ${r.punch.kind}`;
      clearTimeout(punchTimer);
      punchTimer = window.setTimeout(() => (punchEl.textContent = "–"), 600);
    }
  };

  const close = () => {
    panel.hidden = true;
    cb.pause(false);
  };

  const stop = () => {
    session?.stop();
    session = null;
    tracking = false;
    tracker.reset();
    if (guardSent) cb.guard(false);
    guardSent = false;
    video.hidden = true;
    read.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  const fail = (message: string) => {
    stop();
    panel.innerHTML = `<h2>No camera</h2><p class="error" role="alert"></p><div class="row"><button class="primary" data-step="close">OK</button></div>`;
    (panel.querySelector(".error") as HTMLElement).textContent = message;
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
  };

  const start = async () => {
    if (starting) return;
    starting = true;
    panel.innerHTML = `<h2>Starting camera…</h2><p class="muted" role="status">Waiting for permission.</p>`;
    try {
      const stream = await openCamera(video);
      video.hidden = false;
      panel.innerHTML = `<h2>Loading pose model…</h2><p class="muted" role="status">The first time takes a few seconds.</p>`;
      setChip("Loading…", "warn");
      session = await startPose(video, stream, onFrame, () => {});
      button.textContent = "Stop camera";
      read.hidden = false;
      panel.innerHTML = `<h2>Ready to box</h2><p role="status">Hands up by your face to guard. Jab: punch straight at the screen. Hook: sweep a hand across your body. Keep your shoulders in view.</p><div class="row"><button class="primary" data-step="close">Start boxing</button></div>`;
      panel.querySelector("[data-step=close]")?.addEventListener("click", close);
      (panel.querySelector("[data-step=close]") as HTMLElement | null)?.focus();
    } catch (err) {
      fail(err instanceof CameraError ? err.message : "The camera didn't start. Keep boxing with the keys or buttons.");
    } finally {
      starting = false;
    }
  };

  const intro = () => {
    panel.innerHTML = `
      <h2>Box with your camera</h2>
      <p class="tr-how">Stay at laptop distance with your shoulders and both hands in view. Hands up by your face is your guard. Punch toward the screen for a jab, or sweep a hand across your body for a hook.</p>
      <details class="rp-safety"><summary>Before you start</summary>
        <ul><li>Clear the space around you; don't hit anything or anyone.</li><li>Punch the air, not the screen.</li><li>Stop if anything hurts.</li></ul>
      </details>
      <p class="muted">The video stays in this browser; only the pose is used.</p>
      <div class="row">
        <button class="primary" data-step="start">Start camera</button>
        <button data-step="close">Use keyboard instead</button>
      </div>`;
    panel.querySelector("[data-step=start]")?.addEventListener("click", () => void start());
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
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
  button.addEventListener("click", onButton);

  return {
    on: () => session !== null,
    state: () => (!session ? "off" : tracking ? "ok" : "on"),
    dispose() {
      clearTimeout(punchTimer);
      button.removeEventListener("click", onButton);
      stop();
      dock.remove();
      panel.remove();
    },
  };
}

// Playtest readout (`?debug` in the address, before the `#`): each arm's live
// measures and their peaks since the last reset, to choose how "arm out" is
// read from a real webcam. Never shown to players otherwise. R resets the peaks.
function createDebugReadout(dock: HTMLElement): { frame(f: CameraFrame): void; punch(label: string): void } | null {
  if (!new URLSearchParams(location.search).has("debug")) return null;
  const el = document.createElement("pre");
  el.className = "bx-debug";
  el.setAttribute("aria-hidden", "true");
  dock.append(el);
  type Peak = { sizeMax: number; sizeMin: number; elbowMax: number; fwdMax: number; reachMax: number };
  const fresh = (): Peak => ({ sizeMax: -Infinity, sizeMin: Infinity, elbowMax: -Infinity, fwdMax: -Infinity, reachMax: -Infinity });
  const peaks: Record<BoxHand, Peak> = { left: fresh(), right: fresh() };
  let lastPunch = "–";
  let fps = 0;
  let lastT = 0;
  window.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") {
      peaks.left = fresh();
      peaks.right = fresh();
      lastPunch = "–";
    }
  });
  const n = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? "  –  " : v.toFixed(d).padStart(5));
  const row = (hand: BoxHand, m: ArmMeasures | null) => {
    const p = peaks[hand];
    if (m) {
      if (m.size !== null) {
        p.sizeMax = Math.max(p.sizeMax, m.size);
        p.sizeMin = Math.min(p.sizeMin, m.size);
      }
      if (m.elbow3d !== null) p.elbowMax = Math.max(p.elbowMax, m.elbow3d);
      p.fwdMax = Math.max(p.fwdMax, m.forward);
      p.reachMax = Math.max(p.reachMax, m.reach);
    }
    const ratio = p.sizeMin > 0 && Number.isFinite(p.sizeMax) ? p.sizeMax / p.sizeMin : null;
    return [
      `${hand.toUpperCase().padEnd(5)}      now    peak`,
      ` fist size ${n(m?.size ?? null)}  ${n(p.sizeMax)}  min ${n(p.sizeMin)} x${n(ratio, 1)}`,
      ` elbow 3d  ${n(m?.elbow3d ?? null, 0)}  ${n(p.elbowMax, 0)}  2d ${n(m?.elbow2d ?? null, 0)}`,
      ` depth fwd ${n(m?.forward ?? null)}  ${n(p.fwdMax)}`,
      ` reach 2d  ${n(m?.reach ?? null)}  ${n(p.reachMax)}`,
      ` height    ${n(m ? -m.down : null)}  (+ above shoulders)`,
    ].join("\n");
  };
  return {
    frame(f) {
      if (lastT) fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, f.t - lastT));
      lastT = f.t;
      const lm = f.landmarks;
      el.textContent = [
        `fps ${fps.toFixed(0)}   last punch: ${lastPunch}   (R resets peaks)`,
        row("left", lm ? armMeasures(lm, f.aspect, "left") : null),
        row("right", lm ? armMeasures(lm, f.aspect, "right") : null),
      ].join("\n");
    },
    punch(label) {
      lastPunch = label;
    },
  };
}
