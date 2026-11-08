import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { JumpTracker, RunTracker, restFrom, runHeights, torsoOf, torsoRestFrom } from "../../input/camera/run-pose.ts";
import type { RunMode, RunRest, RunSide, Torso } from "../../input/camera/run-pose.ts";

// Track's camera (task 26): the same webcam and local pose model as tennis
// and archery (video never leaves the browser), read as running on the spot.
// Two modes until a real-webcam playtest picks one: "knees" (stand back, legs
// in frame) and "elbows" (arm pumps, laptop distance). A stand-still
// calibration first, like a start line. Every step can be skipped; A/D, the
// arrows and the tap buttons still work. Hurdles (task 27): both arms up
// (elbows) or a hop on the spot (knees) is a jump, read by `JumpTracker` from
// the same calibration; Space and the Jump button still work.

export interface RunCameraCallbacks {
  step(side: RunSide): void;
  /** Hurdles (task 27): a jump read (both arms up, or a hop on the spot). */
  jump(): void;
  /** Hurdles is on: only then are jumps read and explained. */
  hurdles(): boolean;
  /** The setup panel opened (true) or closed (false); practice holds the race meanwhile. */
  pause(paused: boolean): void;
}

export interface RunCamera {
  on(): boolean;
  state(): "off" | "on" | "ok";
  mode(): RunMode;
  dispose(): void;
}

const MODE_KEY = "track-run-mode";
// still frames needed for the calibration, and how long it may take
const CALIBRATE_FRAMES = 20;
const CALIBRATE_TIMEOUT_MS = 15_000;

function loadMode(): RunMode {
  try {
    return localStorage.getItem(MODE_KEY) === "knees" ? "knees" : "elbows";
  } catch {
    return "elbows";
  }
}

function saveMode(m: RunMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // storage unavailable: the default next time
  }
}

const MODE_TEXT: Record<RunMode, { label: string; how: string; jump: string }> = {
  elbows: {
    label: "Pump your arms",
    how: "Stay at laptop distance, shoulders and hands in view. Swing your arms like a sprinter: each hand coming up is a step. Quick, small pumps beat big slow ones.",
    jump: "Hurdles: throw both arms up together to jump.",
  },
  knees: {
    label: "Lift your knees",
    how: "Step back until your knees are in view. Jog on the spot: each knee coming up is a step.",
    jump: "Hurdles: jump on the spot to jump.",
  },
};

export function createRunCamera(view: HTMLElement, button: HTMLButtonElement, chip: HTMLElement, cb: RunCameraCallbacks): RunCamera {
  const video = document.createElement("video");
  video.className = "selfview";
  video.hidden = true;
  video.setAttribute("aria-label", "Your camera preview, not sent anywhere");
  const dock = document.createElement("div");
  dock.className = "cam-dock";
  // a meter per side, so a player sees each lift register
  const meter = document.createElement("div");
  meter.className = "tr-meter";
  meter.setAttribute("aria-hidden", "true");
  meter.hidden = true;
  meter.innerHTML = `<span data-side="left"><i></i></span><span data-side="right"><i></i></span>`;
  dock.append(video, meter);
  const panel = document.createElement("section");
  panel.className = "camera-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Camera setup");
  panel.hidden = true;
  view.append(dock, panel);

  let mode = loadMode();
  let session: CameraSession | null = null;
  let tracker = new RunTracker(mode);
  // task 27: hurdles' jump, calibrated from the same stand-still frames
  let jumper = new JumpTracker(mode);
  let starting = false;
  let tracking = false;
  // calibration: collecting still frames until there are enough (the torso too, for knees mode's jump)
  let calibrating: { samples: RunRest[]; arms: RunRest[]; torsos: Torso[]; since: number } | null = null;

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.textContent = text;
    chip.dataset.state = state;
  };

  const finishCalibration = (rest: RunRest | null) => {
    const cal = calibrating;
    calibrating = null;
    if (rest) {
      tracker.rest = rest;
      tracker.reset();
      jumper.rest = { arms: cal ? restFrom(cal.arms) : null, torso: cal ? torsoRestFrom(cal.torsos) : null };
      jumper.reset();
      close();
      return;
    }
    panel.innerHTML = `<h2>Couldn't see you still</h2><p class="error" role="alert">${mode === "knees" ? "Step back until your knees are in view, then try again." : "Get your shoulders and both hands in view, then try again."}</p><div class="row"><button class="primary" data-step="again">Try again</button><button data-step="close">Not now</button></div>`;
    panel.querySelector("[data-step=again]")?.addEventListener("click", calibrate);
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
  };

  const onFrame = (f: CameraFrame) => {
    const h = f.landmarks ? runHeights(f.landmarks, f.aspect, mode) : null;
    tracking = h !== null;
    setChip(h ? "Tracking" : mode === "knees" ? "Can't see your knees" : "Can't see your hands", h ? "ok" : "warn");
    video.dataset.tracking = String(tracking);
    // hurdles' jump reads the hands (elbows) or the torso (knees), whatever the run mode reads
    const arms = f.landmarks ? (mode === "elbows" ? h : runHeights(f.landmarks, f.aspect, "elbows")) : null;
    const torso = f.landmarks ? torsoOf(f.landmarks, f.aspect) : null;
    if (calibrating) {
      if (h) calibrating.samples.push(h);
      if (h && arms) calibrating.arms.push(arms);
      if (h && torso) calibrating.torsos.push(torso);
      if (calibrating.samples.length >= CALIBRATE_FRAMES) finishCalibration(restFrom(calibrating.samples));
      else if (f.t - calibrating.since > CALIBRATE_TIMEOUT_MS) finishCalibration(null);
      return;
    }
    const s = tracker.update(h, f.t);
    for (const side of ["left", "right"] as const) {
      const bar = meter.querySelector(`[data-side=${side}] i`) as HTMLElement;
      bar.style.height = `${Math.round(Math.max(0, Math.min(1, tracker.lift[side] / 0.4)) * 100)}%`;
    }
    if (s) cb.step(s.side);
    if (cb.hurdles() && jumper.update({ arms, torso }, f.t)) cb.jump();
  };

  const close = () => {
    panel.hidden = true;
    cb.pause(false);
  };

  const stop = () => {
    session?.stop();
    session = null;
    tracking = false;
    calibrating = null;
    tracker.reset();
    jumper.reset();
    video.hidden = true;
    meter.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  const fail = (message: string) => {
    stop();
    panel.innerHTML = `<h2>No camera</h2><p class="error" role="alert"></p><div class="row"><button class="primary" data-step="close">OK</button></div>`;
    (panel.querySelector(".error") as HTMLElement).textContent = message;
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
  };

  function calibrate(): void {
    panel.innerHTML = `<h2>Stand still</h2><p role="status">${mode === "knees" ? "Feet together, knees in view." : "Arms relaxed by your sides, hands in view."} Hold it for a moment.</p><div class="row"><button data-step="close">Skip</button></div>`;
    panel.querySelector("[data-step=close]")?.addEventListener("click", () => {
      calibrating = null;
      close();
    });
    calibrating = { samples: [], arms: [], torsos: [], since: performance.now() };
  }

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
      meter.hidden = false;
      calibrate();
    } catch (err) {
      fail(err instanceof CameraError ? err.message : "The camera didn't start. Keep running with the keys or buttons.");
    } finally {
      starting = false;
    }
  };

  const intro = () => {
    panel.innerHTML = `
      <h2>Run with your camera</h2>
      <fieldset class="row" aria-label="Run mode">
        <legend>How to run</legend>
        ${(["elbows", "knees"] as const).map((m) => `<button type="button" data-mode="${m}">${MODE_TEXT[m].label}</button>`).join("")}
      </fieldset>
      <p class="tr-how"></p>
      <p class="tr-jump-how" hidden></p>
      <details class="rp-safety"><summary>Before you start</summary>
        <ul><li>Clear the space around you and check the floor isn't slippery.</li><li>Run on the spot; don't move toward the screen.</li><li>Stop if anything hurts.</li></ul>
      </details>
      <p class="muted">The video stays in this browser; only the pose is used.</p>
      <div class="row">
        <button class="primary" data-step="start">Start camera</button>
        <button data-step="close">Not now</button>
      </div>`;
    const how = panel.querySelector(".tr-how") as HTMLElement;
    const jumpHow = panel.querySelector(".tr-jump-how") as HTMLElement;
    const modeButtons = panel.querySelectorAll<HTMLButtonElement>("[data-mode]");
    const mark = () => {
      modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      how.textContent = MODE_TEXT[mode].how;
      jumpHow.textContent = MODE_TEXT[mode].jump;
      jumpHow.hidden = !cb.hurdles();
    };
    modeButtons.forEach((b) =>
      b.addEventListener("click", () => {
        mode = b.dataset.mode as RunMode;
        tracker = new RunTracker(mode);
        jumper = new JumpTracker(mode);
        saveMode(mode);
        mark();
      }),
    );
    mark();
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
    on: () => session !== null && tracker.rest !== null,
    state: () => (!session ? "off" : tracking ? "ok" : "on"),
    mode: () => mode,
    dispose() {
      button.removeEventListener("click", onButton);
      stop();
      dock.remove();
      panel.remove();
    },
  };
}
