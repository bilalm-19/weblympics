import { cameraSettings, updateCameraSettings } from "../../net/camera-settings.ts";
import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { DEFAULT_JUMP, DEFAULT_RUN, JumpTracker, RunTracker, restFrom, runHeights, torsoOf, torsoRestFrom } from "../../input/camera/run-pose.ts";
import type { RunMode, RunRest, RunSide, Torso } from "../../input/camera/run-pose.ts";

// Track's camera (task 26): the same webcam and local pose model as tennis
// and archery (video never leaves the browser), read as running on the spot.
// Two modes until a real-webcam playtest picks one: "knees" (stand back, legs
// in frame) and "elbows" (arm pumps, laptop distance). A stand-still
// calibration first, like a start line; since 2026-11-08 it is only where
// each side's recent low starts (run-pose.ts measures every pump from its own
// low). Every step has "Use keyboard instead" (and Escape); A/D, the arrows
// and the tap buttons still work. Hurdles (task 27): both arms up (elbows) or
// a hop on the spot (knees) is a jump, read by `JumpTracker`; Space and the
// Jump button still work. Webcam by default (task 15): the view opens this
// setup first for a seated player. `?debug` adds a readout and a recorder.

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

// still frames needed for the calibration, and how long it may take
const CALIBRATE_FRAMES = 20;
const CALIBRATE_TIMEOUT_MS = 15_000;
/** The panel's lift meter is full at this lift above the recent low (shoulder widths): twice a pump's threshold. */
const METER_FULL = 2;

// Task 25: the mode and each mode's stand-still calibration are kept with
// every other camera setting (on the account when signed in). The stand-still
// still runs each time the camera starts; a saved one is the fallback if it's
// skipped.
const loadMode = (): RunMode => cameraSettings().track.mode;
const saveMode = (m: RunMode): void => updateCameraSettings((s) => (s.track.mode = m));
const savedRest = (m: RunMode): RunRest | null => cameraSettings().track.rest[m];
const saveRest = (m: RunMode, rest: RunRest): void => updateCameraSettings((s) => (s.track.rest[m] = { left: rest.left, right: rest.right }));

const MODE_TEXT: Record<RunMode, { label: string; how: string; jump: string }> = {
  elbows: {
    label: "Pump your arms",
    how: "Stay at laptop distance, shoulders and hands in view. Swing your arms like a sprinter: each hand coming up is a step. Quick, small pumps beat big slow ones.",
    jump: "Hurdles: lift both hands together, about to your chest, to jump.",
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
  tracker.rest = savedRest(mode);
  // task 27: hurdles' jump, calibrated from the same stand-still frames
  let jumper = new JumpTracker(mode);
  let starting = false;
  let tracking = false;
  // calibration: collecting still frames until there are enough (the torso too, for knees mode's jump)
  let calibrating: { samples: RunRest[]; arms: RunRest[]; torsos: Torso[]; since: number } | null = null;
  const debug = createDebugReadout(dock, () => ({ tracker, jumper }));

  const setChip = (text: string, state: "ok" | "warn" | "off") => {
    chip.hidden = false;
    chip.textContent = text;
    chip.dataset.state = state;
  };

  const keyboardButton = `<button data-step="keys">Use keyboard instead</button>`;
  const wire = () => panel.querySelector("[data-step=keys]")?.addEventListener("click", useKeyboard);

  const finishCalibration = (rest: RunRest | null) => {
    const cal = calibrating;
    calibrating = null;
    if (rest) {
      tracker.rest = rest;
      saveRest(mode, rest);
      jumper.rest = { arms: cal ? restFrom(cal.arms) : null, torso: cal ? torsoRestFrom(cal.torsos) : null };
      close();
      return;
    }
    panel.innerHTML = `<h2>Couldn't see you still</h2><p class="error" role="alert">${mode === "knees" ? "Step back until your knees are in view, then try again." : "Get your shoulders and both hands in view, then try again."}</p><div class="row"><button class="primary" data-step="again">Try again</button><button data-step="close">Run without it</button>${keyboardButton}</div>`;
    panel.querySelector("[data-step=again]")?.addEventListener("click", calibrate);
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
    wire();
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
      bar.style.height = `${Math.round(Math.max(0, Math.min(1, tracker.lift[side] / (METER_FULL * tracker.cfg.liftOn))) * 100)}%`;
    }
    if (s) cb.step(s.side);
    // the jump is read every frame (the readout shows it in a sprint too), sent only in hurdles
    const jumped = jumper.update({ arms, torso }, f.t);
    if (jumped && cb.hurdles()) cb.jump();
    if (debug && f.landmarks) {
      const knees = mode === "knees" ? h : runHeights(f.landmarks, f.aspect, "knees");
      debug.frame(f.t, { elbows: arms, knees, torso }, s !== null, jumped);
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
    calibrating = null;
    tracker.reset();
    jumper.reset();
    video.hidden = true;
    meter.hidden = true;
    chip.hidden = true;
    button.textContent = "Camera";
  };

  /** "Use keyboard instead", Escape, or a refused camera: the keys and tap buttons. */
  const useKeyboard = () => {
    stop();
    close();
  };

  const fail = (message: string) => {
    stop();
    panel.innerHTML = `<h2>No camera</h2><p class="error" role="alert"></p><div class="row"><button class="primary" data-step="close">OK</button></div>`;
    (panel.querySelector(".error") as HTMLElement).textContent = message;
    panel.querySelector("[data-step=close]")?.addEventListener("click", close);
    (panel.querySelector("[data-step=close]") as HTMLElement | null)?.focus();
  };

  function calibrate(): void {
    panel.innerHTML = `<h2>Stand still</h2><p role="status">${mode === "knees" ? "Feet together, knees in view." : "Arms relaxed by your sides, hands in view."} Hold it for a moment.</p><div class="row"><button data-step="close">Skip</button>${keyboardButton}</div>`;
    panel.querySelector("[data-step=close]")?.addEventListener("click", () => {
      calibrating = null;
      close();
    });
    wire();
    calibrating = { samples: [], arms: [], torsos: [], since: performance.now() };
  }

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
      session = await startPose(video, stream, onFrame, () => {});
      if (panel.hidden) {
        // Escape while the model loaded: keys it is
        stop();
        return;
      }
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
        ${keyboardButton}
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
        tracker.rest = savedRest(mode);
        jumper = new JumpTracker(mode);
        saveMode(mode);
        mark();
      }),
    );
    mark();
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
    // Escape while calibrating keeps the camera on, as Skip does; anywhere else it is the keyboard
    if (calibrating) {
      calibrating = null;
      close();
    } else useKeyboard();
  };
  button.addEventListener("click", onButton);
  window.addEventListener("keydown", onKey);

  return {
    // since 2026-11-08 the calibration is optional: the tracker starts from the first frame it sees
    on: () => session !== null,
    state: () => (!session ? "off" : tracking ? "ok" : "on"),
    mode: () => mode,
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
// docs/camera-playtest.md ("Track's moves" and "Hurdles' moves"). Live: each
// side's height, its recent low and lift above it, steps a second, and the
// jump's reading. Recording: press 1-9 (0 for move 10) for a move, a 3 s
// countdown (beep), 5 s recorded (beep), saved (beep). Steps are "marked"
// by a metronome beep during the running moves (4 a second, top speed) so the
// table compares the steps read with the pumps asked for. Per move: the
// 10th/median/90th of each side's lift peaks (one per rise), of the jump's
// reading, the frames each side was seen, steps and jumps read. Steps and
// jumps are read by trackers of their own (always reading hurdles' jump), so
// a recording counts in the sprint too. C copies the table to paste into the
// chat. Never shown otherwise.
const MOVES = [
  { name: "standing still, arms relaxed", beat: 0 },
  { name: "elbows: small quick pumps, to the beat", beat: 4 },
  { name: "elbows: small pumps, hands held at the chest, to the beat", beat: 4 },
  { name: "elbows: big pumps, as a tired runner flails", beat: 0 },
  { name: "elbows: both arms up, one throw a second", beat: 0 },
  { name: "elbows: one arm up (left, then right)", beat: 0 },
  { name: "knees: jogging on the spot, to the beat", beat: 4 },
  { name: "knees: a hop on the spot, one a second", beat: 0 },
  { name: "knees: rising on tiptoe and settling", beat: 0 },
  { name: "elbows: running pumps with a both-arms jump every 2 s", beat: 0 },
] as const;
const COUNTDOWN_MS = 3000;
const RECORD_MS = 5000;

interface Rec {
  move: number;
  startsAt: number;
  endsAt: number;
  frames: number;
  seen: number;
  /** Each side's lift peaks (the top of each rise above its low), elbows and knees trackers. */
  peaks: Record<RunMode, Record<RunSide, number[]>>;
  run: Record<RunMode, Record<RunSide, number>>;
  /** The jump readings each frame (elbows: the lower hand's lift; knees: the torso's), and the torso's upward speed. */
  jumpLift: Record<RunMode, number[]>;
  torsoSpeed: number[];
  steps: Record<RunMode, number>;
  jumps: Record<RunMode, number>;
  beats: number;
}

interface Trackers {
  tracker: RunTracker;
  jumper: JumpTracker;
}

/** One frame's readings for the recorder: both modes' heights and the torso. */
export interface DebugRead {
  elbows: RunRest | null;
  knees: RunRest | null;
  torso: Torso | null;
}

interface DebugReadout {
  /** One frame at `t` ms: the readings, and whether the live trackers read a step or a jump on it. */
  frame(t: number, read: DebugRead, stepped: boolean, jumped: boolean): void;
  dispose(): void;
}

function createDebugReadout(dock: HTMLElement, live: () => Trackers): DebugReadout | null {
  if (!new URLSearchParams(location.search).has("debug")) return null;
  const el = document.createElement("pre");
  el.className = "tr-debug";
  el.setAttribute("aria-hidden", "true");
  // the dock ignores the pointer; the readout scrolls
  el.style.cssText = "margin:0;padding:0.4rem;max-height:40vh;overflow:auto;font:11px/1.3 ui-monospace,monospace;white-space:pre;background:#000c;color:#e5e5e5;border-radius:6px;pointer-events:auto";
  dock.append(el);
  // trackers of the recorder's own, both modes, reading every frame from the landmarks it is given
  const own = {
    run: { elbows: new RunTracker("elbows"), knees: new RunTracker("knees") },
    jump: { elbows: new JumpTracker("elbows"), knees: new JumpTracker("knees") },
  };
  let fps = 0;
  let lastT = 0;
  let status = "Press 1-9 or 0 to record a move, C to copy";
  let rec: Rec | null = null;
  const results = new Map<number, string>();
  let drawnAt = -Infinity;
  const stepTimes: number[] = [];
  let lastJump = "";
  let nextBeat = Infinity;
  let audio: AudioContext | null = null;

  const beep = (hz: number, ms = 150) => {
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator();
      o.frequency.value = hz;
      o.connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + ms / 1000);
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
  const sides = <T>(f: () => T): Record<RunSide, T> => ({ left: f(), right: f() });
  const modes = <T>(f: () => T): Record<RunMode, T> => ({ elbows: f(), knees: f() });

  const summarise = (r: Rec): string => {
    const m = MOVES[r.move - 1];
    const lines = [
      `[${r.move % 10}] ${m.name}  frames ${r.frames}  seen ${Math.round((100 * r.seen) / Math.max(1, r.frames))}%` +
        `  steps read elbows ${r.steps.elbows} knees ${r.steps.knees}` +
        (m.beat ? ` vs marked ${r.beats}` : "") +
        `  jumps read elbows ${r.jumps.elbows} knees ${r.jumps.knees}`,
    ];
    for (const mode of ["elbows", "knees"] as const)
      lines.push(
        `  ${mode.padEnd(6)} lift peaks L (${r.peaks[mode].left.length}) ${three(r.peaks[mode].left)} | R (${r.peaks[mode].right.length}) ${three(r.peaks[mode].right)}` +
          ` | jump reading ${three(r.jumpLift[mode])}` +
          (mode === "knees" ? ` | torso up-speed ${three(r.torsoSpeed, 1)}` : ""),
      );
    return lines.join("\n");
  };
  const table = () =>
    [...results.keys()]
      .sort((a, b) => a - b)
      .map((k) => results.get(k))
      .join("\n");

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "0" ? 10 : Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= MOVES.length && !rec) {
      const now = performance.now();
      rec = {
        move: d,
        startsAt: now + COUNTDOWN_MS,
        endsAt: now + COUNTDOWN_MS + RECORD_MS,
        frames: 0,
        seen: 0,
        peaks: modes(() => sides(() => [] as number[])),
        run: modes(() => sides(() => 0)),
        jumpLift: modes(() => [] as number[]),
        torsoSpeed: [],
        steps: modes(() => 0),
        jumps: modes(() => 0),
        beats: 0,
      };
      nextBeat = MOVES[d - 1].beat ? rec.startsAt : Infinity;
      beep(440);
    } else if (e.key === "c" || e.key === "C") {
      const text = `fps ~${fps.toFixed(0)}  run ${JSON.stringify(DEFAULT_RUN)}  jump ${JSON.stringify(DEFAULT_JUMP)}\n${table()}`;
      navigator.clipboard?.writeText(text).then(
        () => (status = "Copied. Paste it into the chat."),
        () => (status = "Copy failed: select the table text instead."),
      );
    }
  };
  window.addEventListener("keydown", onKey);

  return {
    dispose: () => {
      window.removeEventListener("keydown", onKey);
      void audio?.close();
    },
    frame(t, L, stepped, jumped) {
      if (lastT) fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, t - lastT));
      lastT = t;
      const { tracker, jumper } = live();
      if (stepped) stepTimes.push(t);
      while (stepTimes.length && t - stepTimes[0] > 2000) stepTimes.shift();
      if (jumped) lastJump = `at ${(t / 1000).toFixed(1)} s`;
      // both modes' own trackers, so one recording shows elbows and knees
      const ownSteps = modes(() => false);
      const ownJumps = modes(() => false);
      for (const mode of ["elbows", "knees"] as const) {
        ownSteps[mode] = own.run[mode].update(L[mode], t) !== null;
        ownJumps[mode] = own.jump[mode].update({ arms: L.elbows, torso: L.torso }, t);
      }
      const now = performance.now();
      let head = status;
      if (rec) {
        if (now < rec.startsAt) head = `[${rec.move % 10}] ${MOVES[rec.move - 1].name}: get ready… ${Math.ceil((rec.startsAt - now) / 1000)}`;
        else if (now < rec.endsAt) {
          if (rec.frames === 0) beep(660);
          if (now >= nextBeat) {
            beep(880, 40);
            rec.beats++;
            nextBeat += 1000 / MOVES[rec.move - 1].beat;
          }
          rec.frames++;
          if (L.elbows || L.knees) rec.seen++;
          for (const mode of ["elbows", "knees"] as const) {
            const r = own.run[mode];
            if (ownSteps[mode]) rec.steps[mode]++;
            if (ownJumps[mode]) rec.jumps[mode]++;
            rec.jumpLift[mode].push(own.jump[mode].lift);
            if (!L[mode]) continue;
            for (const side of ["left", "right"] as const) {
              // a rise is kept from leaving its low (0.05 shoulder widths) to coming back down
              const lift = r.lift[side];
              if (lift > 0.05) rec.run[mode][side] = Math.max(rec.run[mode][side], lift);
              else if (rec.run[mode][side] > 0) {
                rec.peaks[mode][side].push(rec.run[mode][side]);
                rec.run[mode][side] = 0;
              }
            }
          }
          if (L.torso) rec.torsoSpeed.push(own.jump.knees.speed);
          head = `[${rec.move % 10}] ${MOVES[rec.move - 1].name}: RECORDING ${Math.ceil((rec.endsAt - now) / 1000)}`;
        } else {
          for (const mode of ["elbows", "knees"] as const)
            for (const side of ["left", "right"] as const) if (rec.run[mode][side] > 0) rec.peaks[mode][side].push(rec.run[mode][side]);
          results.set(rec.move, summarise(rec));
          status = `Saved [${rec.move % 10}] ${MOVES[rec.move - 1].name}. Next move, or C to copy`;
          rec = null;
          nextBeat = Infinity;
          beep(330);
          head = status;
        }
      }
      // the text is redrawn 5 times a second, not every frame
      if (now - drawnAt < 200) return;
      drawnAt = now;
      const side = (sd: RunSide) =>
        `${sd.padEnd(5)} height ${n(L[tracker.mode]?.[sd] ?? null)}  low ${n(tracker.low(sd))}  lift ${n(tracker.lift[sd])}  (step at ${tracker.cfg.liftOn})`;
      const jumpWord = jumper.mode === "elbows" ? `both hands' lift ${n(jumper.lift)} (jump at ${DEFAULT_JUMP.armsOn})` : `torso lift ${n(jumper.lift)} (at ${DEFAULT_JUMP.riseOn}) up-speed ${n(jumper.speed, 1)} (at ${DEFAULT_JUMP.riseSpeed})`;
      const done = MOVES.map((m, i) => `${results.has(i + 1) ? "✓" : " "} ${(i + 1) % 10} ${m.name}`).join("\n");
      el.textContent = [
        `fps ${fps.toFixed(0)}  mode ${tracker.mode}   ${head}`,
        side("left"),
        side("right"),
        `steps/s ${(stepTimes.length / 2).toFixed(1)}  jump: ${jumpWord}  last jump read: ${lastJump || "none"}`,
        "",
        done,
        "",
        table(),
      ].join("\n");
    },
  };
}
