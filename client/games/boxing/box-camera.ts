import { CameraError, openCamera, startPose } from "../../input/camera/camera.ts";
import type { CameraSession } from "../../input/camera/camera.ts";
import { bodyFrame as bodyFrameOf } from "../../input/camera/pose.ts";
import type { CameraFrame } from "../../input/camera/pose.ts";
import { DEFAULT_SLIP, SlipDetector, TRIAL_BOX, TrialDetector, armMeasures, boxFrame, cameraBoxing, handMeasures } from "../../input/camera/box-pose.ts";
import type { ArmMeasures, BoxGuard, BoxHand, BoxTarget, HandMeasures, TrialRead } from "../../input/camera/box-pose.ts";

// Boxing's camera (task 30): the same webcam and local pose model as the other
// games (video never leaves the browser), read as punches and a guard by
// box-pose.ts. A jab is a fast hand toward the screen and both hands by your
// face is the guard (ADR 002: jabs only; hooks read are dropped). Laptop distance,
// upper body in view; the maths is in shoulder widths, so there is nothing to
// calibrate. Every step can be skipped: J, K, Space and the buttons still work.

export interface BoxCameraCallbacks {
  /** A jab the camera read; the view sends it as the same message a key does. */
  punch(hand: BoxHand, target: BoxTarget): void;
  /** The guard changed: high, low or none. */
  guard(guard: BoxGuard): void;
  /** The lean changed: a side while the shoulders are tilted past the threshold, null back upright (the same message holding A or D sends). */
  slip(side: BoxHand | null): void;
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
  // the camera's detector for everyone (playtest 4, 2026-11-06: the old
  // BoxTracker read "jabs" from depth noise in a raised guard)
  const detector = new TrialDetector();
  // a lean of the shoulders is a slip (playtest 4), from the neutral set in the first second
  const slipper = new SlipDetector();
  let starting = false;
  let tracking = false;
  let guardSent: BoxGuard = null;
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
    tracking = frame !== null;
    setChip(frame ? "Tracking" : "Can't see your shoulders", frame ? "ok" : "warn");
    video.dataset.tracking = String(tracking);
    // the hand model's palms and the pose model's arms into a jab and a
    // guard; cameraBoxing turns that into ADR 002's messages. A shoulder
    // lean is a slip (SlipDetector). The ?debug readout only shows them.
    const lm = f.landmarks;
    const arms = { left: lm ? armMeasures(lm, f.aspect, "left") : null, right: lm ? armMeasures(lm, f.aspect, "right") : null };
    const hands = lm ? handMeasures(f.hands, lm, f.aspect) : null;
    const tr = lm ? detector.update({ hands, arms }, f.t) : null;
    const tilt = lm ? (bodyFrameOf(lm, f.aspect)?.tilt ?? null) : null;
    const leanChange = slipper.update(tilt, f.t);
    debug?.frame(f, arms, hands, tr, slipper.offset(tilt), slipper.lean, slipper.neutral);
    if (leanChange !== undefined) cb.slip(leanChange);
    const { guard: guardNow, jab } = tr ? cameraBoxing(tr) : { guard: guardSent, jab: null };
    if (guardNow !== guardSent) {
      guardSent = guardNow;
      cb.guard(guardNow);
    }
    guardEl.dataset.on = String(guardNow !== null);
    guardEl.textContent = guardNow === "low" ? "Low guard" : guardNow === "high" ? "High guard" : "Guard";
    if (jab) {
      cb.punch(jab.hand, jab.target);
      punchEl.textContent = `${jab.hand} jab · ${jab.target}`;
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
    detector.reset();
    if (slipper.lean !== null) cb.slip(null);
    slipper.reset();
    if (guardSent !== null) cb.guard(null);
    guardSent = null;
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
      // the hand model reads the fists; the pose model, every third frame,
      // only the shoulders (both every frame was choppy, playtest 3)
      session = await startPose(video, stream, onFrame, () => {}, { hands: true, poseEvery: 3 });
      button.textContent = "Stop camera";
      read.hidden = false;
      panel.innerHTML = `<h2>Ready to box</h2><p role="status">Hands up by your face to guard. Jab: punch straight at the screen. Lean your shoulders to one side and hold it to slip; straighten up to come back. Sit still for a second first, so it learns your centre. Keep your shoulders in view.</p><div class="row"><button class="primary" data-step="close">Start boxing</button></div>`;
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
      <p class="tr-how">Stay at laptop distance with your shoulders and both hands in view. Hands up by your face is your guard. Punch toward the screen for a jab. Slip with A and D (or the buttons) for now.</p>
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

// Playtest readout (`?debug` in the address, before the `#`), the method in
// docs/camera-playtest.md. Live: each arm's measures now. Recording: press 1-7
// for a move, a 3 s countdown, 5 s recorded, and the move's row joins a table
// (typical = median, high = 90th percentile, so one bad frame can't skew it).
// C copies the table as text to paste into the chat. Never shown otherwise.
// While recording, press P at each real punch you throw: the table then says,
// per mark, whether the detector fired and the highest palm ratio around it,
// and counts detector jabs with no mark (false reads). Every move also gets
// the tilt's own spread (does a jab or a guard lean you by accident?).
const MOVES = ["relaxed", "high guard", "low guard", "jab to head", "hook to head", "jab to body", "moving, no punch", "hook to body", "lean left, back, right, back"] as const;
const COUNTDOWN_MS = 3000;
const RECORD_MS = 5000;

type Sample = { size: number | null; e3: number | null; e2: number | null; fwd: number; reach: number; height: number };
type HandSample = { size: number; height: number; across: number };
/** One frame for the per-punch trace: time, each hand's palm size over its rest, the tilt from neutral, and what the detector fired. */
type TraceFrame = { t: number; grow: Record<BoxHand, number | null>; tilt: number | null; fired: BoxHand | null };
/** A mark (the user pressing P as they throw a real punch) is matched to a detector punch within this long (ms). */
const MARK_WINDOW_MS = 400;

function createDebugReadout(
  dock: HTMLElement,
): {
  frame(f: CameraFrame, m: Record<BoxHand, ArmMeasures | null>, hm: Record<BoxHand, HandMeasures | null> | null, tr: TrialRead | null, tilt: number | null, lean: BoxHand | null, neutral: number | null): void;
} | null {
  if (!new URLSearchParams(location.search).has("debug")) return null;
  const el = document.createElement("pre");
  el.className = "bx-debug";
  el.setAttribute("aria-hidden", "true");
  // the trial detector's verdict, big, so it can be read mid-punch
  const verdict = document.createElement("div");
  verdict.className = "bx-verdict";
  verdict.setAttribute("aria-hidden", "true");
  dock.append(verdict, el);
  let lastPunch = "";
  let lastPunchAt = -Infinity;
  let fps = 0;
  let lastT = 0;
  let status = "Press 1-9 to record a move (P at each real punch), C to copy";
  let rec: { move: number; startsAt: number; endsAt: number; frames: number; samples: Record<BoxHand, Sample[]>; hands: Record<BoxHand, HandSample[]>; punches: string[]; tilts: number[]; trace: TraceFrame[]; marks: number[]; neutral: number | null } | null = null;
  const results = new Map<number, string>();

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
  const n = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? "–" : v.toFixed(d));
  const summarise = (move: number, r: NonNullable<typeof rec>): string => {
    const lines = [`[${move}] ${MOVES[move - 1]}  frames ${r.frames}  read ${r.punches.length}: ${r.punches.join(", ") || "none"}`];
    lines.push(`  tilt from neutral (deg, + right) lo ${n(q(r.tilts, 0.05), 1)} typ ${n(q(r.tilts, 0.5), 1)} hi ${n(q(r.tilts, 0.95), 1)}`);
    lines.push(tiltLine(r));
    const tr = traceLines(r);
    if (tr) lines.push(...tr);
    for (const hand of ["left", "right"] as const) {
      const xs = r.samples[hand];
      const col = <K extends keyof Sample>(k: K) => xs.map((x) => x[k]).filter((v): v is number => v !== null);
      const sz = col("size");
      lines.push(
        `  ${hand.padEnd(5)} seen ${Math.round((100 * xs.length) / Math.max(1, r.frames))}%` +
          ` | size lo ${n(q(sz, 0.1))} typ ${n(q(sz, 0.5))} hi ${n(q(sz, 0.9))}` +
          ` | elbow3d typ ${n(q(col("e3"), 0.5), 0)} hi ${n(q(col("e3"), 0.9), 0)}` +
          ` | elbow2d typ ${n(q(col("e2"), 0.5), 0)} hi ${n(q(col("e2"), 0.9), 0)}` +
          ` | depth typ ${n(q(col("fwd"), 0.5))} hi ${n(q(col("fwd"), 0.9))}` +
          ` | reach typ ${n(q(col("reach"), 0.5))} hi ${n(q(col("reach"), 0.9))}` +
          ` | height lo ${n(q(col("height"), 0.1))} typ ${n(q(col("height"), 0.5))} hi ${n(q(col("height"), 0.9))}`,
      );
      const hs = r.hands[hand];
      const hcol = (k: keyof HandSample) => hs.map((x) => x[k]);
      lines.push(
        `  ${hand.padEnd(5)} HAND MODEL seen ${Math.round((100 * hs.length) / Math.max(1, r.frames))}%` +
          ` | size lo ${n(q(hcol("size"), 0.1))} typ ${n(q(hcol("size"), 0.5))} hi ${n(q(hcol("size"), 0.9))}` +
          ` | height lo ${n(q(hcol("height"), 0.1))} typ ${n(q(hcol("height"), 0.5))} hi ${n(q(hcol("height"), 0.9))}` +
          ` | across lo ${n(q(hcol("across"), 0.1))} typ ${n(q(hcol("across"), 0.5))} hi ${n(q(hcol("across"), 0.9))}`,
      );
    }
    return lines.join("\n");
  };
  const pct = (xs: number[], pred: (v: number) => boolean) => Math.round((100 * xs.filter(pred).length) / Math.max(1, xs.length));
  const tiltLine = (r: NonNullable<typeof rec>): string => {
    const ts = r.tilts;
    const mean = ts.reduce((a, b) => a + b, 0) / Math.max(1, ts.length);
    const sd = Math.sqrt(ts.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ts.length));
    const leans = r.punches.filter((p) => p.startsWith("lean")).length;
    const around = r.trace.filter((f) => f.fired && f.tilt !== null).map((f) => r.trace.filter((g) => g.tilt !== null && Math.abs(g.t - f.t) <= 300).map((g) => Math.abs(g.tilt as number)));
    const worst = around.map((xs) => Math.max(...xs));
    return (
      `  tilt spread: min ${n(Math.min(...ts), 1)} max ${n(Math.max(...ts), 1)} sd ${n(sd, 1)} | frames past 4 deg ${pct(ts, (v) => Math.abs(v) >= 4)}%, past 8 deg ${pct(ts, (v) => Math.abs(v) >= 8)}%` +
      ` | leans started ${leans} | neutral ${n(r.neutral, 1)} abs` +
      (worst.length ? ` | tilt within 300 ms of a read jab: worst ${n(q(worst, 0.5), 1)} typ, ${n(Math.max(...worst), 1)} max (n ${worst.length})` : "")
    );
  };
  const traceLines = (r: NonNullable<typeof rec>): string[] | null => {
    const fires = r.trace.filter((f) => f.fired);
    if (r.marks.length === 0 && fires.length === 0) return null;
    const out: string[] = [];
    const matched = new Set<TraceFrame>();
    r.marks.forEach((m, i) => {
      const win = r.trace.filter((f) => Math.abs(f.t - m) <= MARK_WINDOW_MS);
      const hit = win.find((f) => f.fired);
      if (hit) matched.add(hit);
      const peak = (hand: BoxHand) => Math.max(0, ...win.map((f) => f.grow[hand] ?? 0));
      const seenFrames = (hand: BoxHand) => win.filter((f) => f.grow[hand] !== null).length;
      out.push(
        `    punch ${i + 1} at +${((m - r.trace[0]?.t) / 1000 || 0).toFixed(1)}s: ${hit ? `READ (${hit.fired}, ${Math.round(hit.t - m)} ms after the mark)` : "MISSED"}` +
          ` | peak ratio left ${n(peak("left"))} right ${n(peak("right"))} (needs ${TRIAL_BOX.jabGrow})` +
          ` | frames with the hand seen: left ${seenFrames("left")} right ${seenFrames("right")} of ${win.length}`,
      );
    });
    const extra = fires.filter((f) => !matched.has(f) && !r.marks.some((m) => Math.abs(f.t - m) <= MARK_WINDOW_MS)).length;
    const read = r.marks.filter((m) => r.trace.some((f) => f.fired && Math.abs(f.t - m) <= MARK_WINDOW_MS)).length;
    out.unshift(`  marked punches ${r.marks.length}: read ${read}, missed ${r.marks.length - read} | detector jabs with no mark (false reads or unmarked) ${extra}`);
    return out;
  };
  const table = () => [...results.keys()].sort((a, b) => a - b).map((k) => results.get(k)).join("\n");

  window.addEventListener("keydown", (e) => {
    const d = Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= MOVES.length && !rec) {
      const now = performance.now();
      rec = { move: d, startsAt: now + COUNTDOWN_MS, endsAt: now + COUNTDOWN_MS + RECORD_MS, frames: 0, samples: { left: [], right: [] }, hands: { left: [], right: [] }, punches: [], tilts: [], trace: [], marks: [], neutral: null };
      beep(440);
    } else if ((e.key === "p" || e.key === "P") && rec && performance.now() >= rec.startsAt && performance.now() < rec.endsAt) {
      // a real punch, marked by the player as they throw it
      rec.marks.push(performance.now());
    } else if (e.key === "c" || e.key === "C") {
      const text = `fps ~${fps.toFixed(0)}\n${table()}`;
      navigator.clipboard?.writeText(text).then(
        () => (status = "Copied. Paste it into the chat."),
        () => (status = "Copy failed: select the table text instead."),
      );
    }
  });

  let grow: TrialRead["grow"] = { left: null, right: null };
  const now0 = () => performance.now();
  // the text is redrawn 5 times a second, not every frame (it was choppy)
  let drawnAt = -Infinity;
  let liveTilt: number | null = null;
  let liveLean: BoxHand | null = null;
  const liveHand = (hand: BoxHand, h: HandMeasures | null | undefined) =>
    `${hand.padEnd(5)} HAND size ${n(h?.size ?? null)} (x${n(grow[hand])} rest)  height ${n(h?.height ?? null)}  across ${n(h?.across ?? null)}`;
  const live = (hand: BoxHand, m: ArmMeasures | null) =>
    `${hand.padEnd(5)} size ${n(m?.size ?? null)}  elbow3d ${n(m?.elbow3d ?? null, 0)}  depth ${n(m?.forward ?? null)}  reach ${n(m?.reach ?? null)}  height ${n(m ? -m.down : null)}`;

  return {
    frame(f, m, hm, tr, tilt, lean, neutral) {
      if (lastT) fps = 0.9 * fps + 0.1 * (1000 / Math.max(1, f.t - lastT));
      lastT = f.t;
      grow = tr?.grow ?? { left: null, right: null };
      if (tr?.punch) {
        lastPunch = `${tr.punch.hand} ${tr.punch.kind} · ${tr.punch.target}`;
        lastPunchAt = now0();
        if (rec && now0() >= rec.startsAt && now0() < rec.endsAt) rec.punches.push(lastPunch);
      }
      if (lean && lean !== liveLean && rec && now0() >= rec.startsAt && now0() < rec.endsAt) rec.punches.push(`lean ${lean}`);
      liveLean = lean;
      liveTilt = tilt;
      const showPunch = now0() - lastPunchAt < 700;
      const leanWord = lean ? ` · LEAN ${lean.toUpperCase()}` : "";
      verdict.textContent = showPunch ? lastPunch.toUpperCase() : (tr?.guard ? `${tr.guard.toUpperCase()} GUARD` : "–") + leanWord;
      verdict.dataset.kind = showPunch ? "punch" : tr?.guard || lean ? "guard" : "none";
      const now = performance.now();
      let head = status;
      if (rec) {
        if (now < rec.startsAt) head = `[${rec.move}] ${MOVES[rec.move - 1]}: get ready… ${Math.ceil((rec.startsAt - now) / 1000)}`;
        else if (now < rec.endsAt) {
          if (rec.frames === 0) beep(660);
          rec.frames++;
          if (tilt !== null) rec.tilts.push(tilt);
          rec.neutral = neutral;
          rec.trace.push({ t: f.t, grow: tr?.grow ?? { left: null, right: null }, tilt, fired: tr?.punch?.kind === "jab" ? tr.punch.hand : null });
          for (const hand of ["left", "right"] as const) {
            const a = m[hand];
            if (a) rec.samples[hand].push({ size: a.size, e3: a.elbow3d, e2: a.elbow2d, fwd: a.forward, reach: a.reach, height: -a.down });
            const h = hm?.[hand];
            if (h) rec.hands[hand].push({ size: h.size, height: h.height, across: h.across });
          }
          head = `[${rec.move}] ${MOVES[rec.move - 1]}: RECORDING ${Math.ceil((rec.endsAt - now) / 1000)}`;
        } else {
          results.set(rec.move, summarise(rec.move, rec));
          status = `Saved [${rec.move}] ${MOVES[rec.move - 1]}. Next move, or C to copy`;
          rec = null;
          beep(330);
          head = status;
        }
      }
      const done = MOVES.map((name, i) => `${results.has(i + 1) ? "✓" : " "} ${i + 1} ${name}`).join("   ");
      if (now - drawnAt < 200) return;
      drawnAt = now;
      el.textContent = [`fps ${fps.toFixed(0)}   ${head}`, live("left", m.left), live("right", m.right), liveHand("left", hm?.left), liveHand("right", hm?.right), `tilt from neutral ${liveTilt === null ? "(sit still: learning your centre)" : `${liveTilt.toFixed(1)} deg`}  lean at ±${DEFAULT_SLIP.slipAt}, upright within ±${DEFAULT_SLIP.rearmAt}`, "", done, "", table()].join("\n");
    },
  };
}
