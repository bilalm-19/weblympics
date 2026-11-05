import { addSpectating } from "../../ui/spectate.ts";
import { BREAK_TICKS, HEALTH, JAB_WINDUP_TICKS, ROUNDS, ROUND_TICKS } from "../../../shared/games/boxing/sim.ts";
import type { BoxerSnapshot, BoxingSnapshot, Guard, Hand, Outcome, Seat, Side, Target } from "../../../shared/games/boxing/sim.ts";
import { DEFAULT_LOOKS } from "../../../shared/look.ts";
import type { Look } from "../../../shared/look.ts";
import { createBoxingScene } from "./scene.ts";
import type { BoxerView, RingView } from "./scene-model.ts";
import type { LobbyView, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { createReadyPanel } from "../tennis/ready-panel.ts";
import { createBoxCamera } from "./box-camera.ts";
import "./boxing.css";

// The boxing view (task 30): the 3D ring (scene.ts), first-person for a
// player and side-on for a spectator, with the HUD over it. ADR 002: J jabs to the
// head, K to the body; hold Space for a high guard, L for a low one; A and D
// slip left and right; or the buttons, or the camera (box-camera.ts). The
// server lands every jab after its wind-up and judges the guard and slip
// then; this only draws what it says.

const FORMATS: readonly RoomFormat[] = ["bout", "unlimited"];
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
const PUNCH_KEYS: Record<string, Target> = { KeyJ: "head", KeyK: "body" };
const GUARD_KEYS: Record<string, "high" | "low"> = { Space: "high", KeyL: "low" };
const SLIP_KEYS: Record<string, Side> = { KeyA: "left", KeyD: "right" };

export interface BoxingViewOptions {
  local?: boolean;
  leaveLabel?: string;
}

const clock = (ticks: number) => {
  const s = Math.max(0, Math.ceil(ticks / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function startBoxing(root: HTMLElement, conn: GameLink, info: RoomInfo, onLeave: () => void, opts: BoxingViewOptions = {}): () => void {
  const view = document.createElement("div");
  view.className = "game boxing";
  view.innerHTML = `
    <canvas aria-label="Boxing ring"></canvas>
    <div class="hud">
      <div class="bx-board" aria-label="Bout">
        <div class="bx-head"></div>
        <div class="bx-row" data-seat="0"><span class="bx-name"></span><span class="bx-bar"><i></i></span><strong class="bx-hp"></strong></div>
        <div class="bx-row" data-seat="1"><span class="bx-name"></span><span class="bx-bar"><i></i></span><strong class="bx-hp"></strong></div>
      </div>
      <div>
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
    </div>
    <div class="bx-call" aria-live="polite" hidden></div>
    <div class="controls bx-controls" hidden>
      <button class="primary" type="button" data-punch="head" aria-label="Head jab (J)">Head</button>
      <button class="primary" type="button" data-punch="body" aria-label="Body jab (K)">Body</button>
      <button type="button" data-guard="high" aria-label="High guard (hold Space)">High guard</button>
      <button type="button" data-guard="low" aria-label="Low guard (hold L)">Low guard</button>
      <button type="button" data-slip="left" aria-label="Slip left (A)">Slip ◀</button>
      <button type="button" data-slip="right" aria-label="Slip right (D)">Slip ▶</button>
    </div>
  `;
  root.replaceChildren(view);
  if (opts.local) {
    view.classList.add("local");
    for (const el of view.querySelectorAll<HTMLElement>(".code, [data-action=copy]")) el.hidden = true;
  }
  if (opts.leaveLabel) (view.querySelector("[data-action=leave]") as HTMLElement).textContent = opts.leaveLabel;

  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const statusEl = view.querySelector(".status") as HTMLElement;
  const callEl = view.querySelector(".bx-call") as HTMLElement;
  (view.querySelector(".code") as HTMLElement).textContent = `Room ${info.room}`;
  canvas.dataset.frames = "0";

  let snap: BoxingSnapshot | null = null;
  let names: [string | null, string | null] = [null, null];
  let lobby: LobbyView | null = null;
  let looks: [Look, Look] = [DEFAULT_LOOKS[0], DEFAULT_LOOKS[1]];
  const label = (seat: Seat) => (seat === info.seat ? "You" : (names[seat] ?? (opts.local && seat === 1 ? "Sparring partner" : `Player ${seat + 1}`)));
  const playing = () => !lobby || info.practice || lobby.phase === "playing";
  const canBox = () => info.seat !== null && snap?.phase === "round" && playing();

  // ---- input: jabs, the guard and the slip, never a claim of damage ----
  let nextHand: Hand = "left";
  const count = () => (canvas.dataset.sent = String(Number(canvas.dataset.sent ?? 0) + 1));
  const punch = (target: Target, hand?: Hand) => {
    if (!canBox()) return false;
    // alternate hands; the server refuses a busy one and the other is tried next press
    const h = hand ?? nextHand;
    nextHand = h === "left" ? "right" : "left";
    conn.send({ t: "punch", hand: h, target, at: performance.now() });
    count();
    return true;
  };
  // the guard is a state: the last guard asked for, from a key, a button or the camera
  let guardNow: Guard = null;
  const guard = (g: Guard) => {
    if (g === guardNow) return;
    if (g !== null && !canBox()) return;
    guardNow = g;
    view.dataset.guard = g ?? "none";
    conn.send({ t: "guard", guard: g });
  };
  // a held key or button wins until let go; releasing one falls back to the other if it is still held
  const held = new Set<"high" | "low">();
  const hold = (g: "high" | "low", down: boolean) => {
    if (down) held.add(g);
    else held.delete(g);
    guard(down ? g : held.has("high") ? "high" : held.has("low") ? "low" : null);
  };
  const slip = (side: Side) => {
    if (!canBox()) return;
    conn.send({ t: "slip", side });
    canvas.dataset.slips = String(Number(canvas.dataset.slips ?? 0) + 1);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const g = GUARD_KEYS[e.code];
    if (g) {
      e.preventDefault();
      if (!e.repeat) hold(g, true);
      return;
    }
    const target = PUNCH_KEYS[e.code];
    const side = SLIP_KEYS[e.code];
    if (!target && !side) return;
    e.preventDefault();
    if (e.repeat) return;
    if (target) punch(target);
    else slip(side);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const g = GUARD_KEYS[e.code];
    if (g) hold(g, false);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  for (const b of view.querySelectorAll<HTMLButtonElement>(".bx-controls button")) {
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    const g = b.dataset.guard as "high" | "low" | undefined;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (b.dataset.punch) punch(b.dataset.punch as Target);
      else if (b.dataset.slip) slip(b.dataset.slip as Side);
      else if (g) hold(g, true);
    });
    if (g) for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, () => hold(g, false));
  }

  // ---- the camera: the same punch and guard as the keys ----
  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const boxCam = createBoxCamera(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    punch: (hand, target) => {
      if (punch(target, hand)) canvas.dataset.camPunch = String(Number(canvas.dataset.camPunch ?? 0) + 1);
    },
    guard: (g) => {
      // a held key or button outranks the camera
      if (held.size === 0) guard(g);
    },
    pause: (p) => {
      if (info.practice) conn.send({ t: "pause", paused: p });
    },
  });

  // ---- the room's ready panel (the host's format and rated option, ready-up) ----
  const readyPanel = createReadyPanel(
    view,
    info.seat,
    info.room,
    {
      ready: (ready) => conn.send({ t: "ready", ready }),
      format: (format) => conn.send({ t: "format", format }),
      rated: (rated) => conn.send({ t: "rated", rated }),
      openCamera: () => cameraButton.click(),
    },
    FORMATS,
  );
  readyPanel.camera("off");
  const camTimer = window.setInterval(() => readyPanel.camera(boxCam.state()), 500);

  let callTimer = 0;
  const call = (text: string, ms = 1400) => {
    callEl.textContent = text;
    callEl.hidden = true;
    void callEl.offsetWidth;
    callEl.hidden = false;
    clearTimeout(callTimer);
    callTimer = window.setTimeout(() => (callEl.hidden = true), ms);
  };

  const renderBoard = (s: BoxingSnapshot) => {
    (view.querySelector(".bx-head") as HTMLElement).textContent =
      (opts.local ? "Practice" : s.format === "unlimited" ? `Unlimited · bout ${s.bouts + 1}` : "Bout") +
      (s.phase === "break" ? ` · break after round ${s.round}` : ` · round ${s.round} of ${ROUNDS}`) +
      (s.phase === "round" ? ` · ${clock(ROUND_TICKS - s.phaseTick)}` : s.phase === "break" ? ` · ${clock(BREAK_TICKS - s.phaseTick)}` : "");
    for (const seat of [0, 1] as const) {
      const row = view.querySelector(`.bx-row[data-seat="${seat}"]`) as HTMLElement;
      row.style.setProperty("--seat", SEAT_CSS[seat]);
      (row.querySelector(".bx-name") as HTMLElement).textContent = label(seat);
      const hp = s.boxers[seat].health;
      (row.querySelector(".bx-bar i") as HTMLElement).style.width = `${((hp / HEALTH) * 100).toFixed(1)}%`;
      (row.querySelector(".bx-hp") as HTMLElement).textContent = String(hp);
    }
  };

  const updateHud = () => {
    if (!snap) return;
    const s = snap;
    renderBoard(s);
    const l = lobby;
    view.dataset.phase = s.phase;
    for (const b of view.querySelectorAll<HTMLButtonElement>(".bx-controls button")) b.disabled = !canBox();
    if (l?.phase === "paused" && l.hold) statusEl.textContent = `Paused: waiting for ${l.hold.seat === info.seat ? "you" : l.hold.name} to reconnect (${l.hold.seconds} s)`;
    else if (l?.match && l.phase === "countdown") statusEl.textContent = `Back. Resuming in ${l.countdown ?? 0}…`;
    else if (l && !info.practice && l.phase !== "playing" && s.phase !== "over") statusEl.textContent = "";
    else if (s.phase === "break") statusEl.textContent = "Break. Catch your breath.";
    else if (s.phase === "over") {
      statusEl.textContent =
        s.result === "draw" ? "A draw." : s.winner === info.seat ? (s.result === "ko" ? "Knockout! You win." : "You win on points.") : `${label((s.winner ?? 0) as Seat)} wins${s.result === "ko" ? " by knockout" : " on points"}.`;
    } else if (s.phase === "round") statusEl.textContent = info.seat === null ? "Boxing" : "J head · K body · hold Space high guard, L low · A/D slip";
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as BoxingSnapshot;
      const prev = snap;
      if (prev) {
        if (prev.phase !== "over" && next.phase === "over") call(next.result === "ko" ? "KO!" : next.result === "draw" ? "Draw" : "Time!", 2200);
        else if (prev.phase === "round" && next.phase === "break") call(`Round ${prev.round} over`, 1800);
        else if (prev.phase === "break" && next.phase === "round") call(`Round ${next.round}`, 1200);
      } else if (next.phase === "round" && next.phaseTick < 90) call(`Round ${next.round}`, 1200);
      if (next.lastHit && (!prev?.lastHit || next.lastHit.tick !== prev.lastHit.tick)) {
        flash(next.lastHit.seat === 0 ? 1 : 0, next.lastHit.outcome, next.lastHit.target);
        canvas.dataset.outcome = next.lastHit.outcome;
      }
      snap = next;
      canvas.dataset.g0 = next.boxers[0].guard ?? "none";
      canvas.dataset.g1 = next.boxers[1].guard ?? "none";
      canvas.dataset.slip0 = next.boxers[0].slip?.side ?? "none";
      canvas.dataset.phase = next.phase;
      canvas.dataset.round = String(next.round);
      canvas.dataset.h0 = String(next.boxers[0].health);
      canvas.dataset.h1 = String(next.boxers[1].health);
      canvas.dataset.bouts = String(next.bouts);
      updateHud();
    } else if (msg.t === "presence") {
      names = msg.names;
      updateHud();
    } else if (msg.t === "lobby") {
      const { t: _t, ...v } = msg;
      lobby = v;
      looks = [v.seats[0]?.look ?? DEFAULT_LOOKS[0], v.seats[1]?.look ?? DEFAULT_LOOKS[1]];
      readyPanel.update(v);
      updateHud();
    }
  });

  view.querySelector("[data-action=leave]")?.addEventListener("click", onLeave);
  const disposeSpectating = opts.local ? () => {} : addSpectating(view, conn, info);
  view.querySelector("[data-action=copy]")?.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    navigator.clipboard
      ?.writeText(`${location.origin}/#/room/${info.room}`)
      .then(() => (button.textContent = "Copied"))
      .catch(() => (button.textContent = "Copy failed"));
  });
  (view.querySelector(".bx-controls") as HTMLElement).hidden = info.seat === null;

  // ---- drawing: the 3D ring, from the server's snapshot each frame ----
  // the last hit on each boxer, with seconds since, for the scene's reaction
  const hits: Array<{ outcome: Outcome; target: Target; age: number } | null> = [null, null];
  function flash(victim: Seat, outcome: Outcome, target: Target): void {
    hits[victim] = { outcome, target, age: 0 };
  }
  const ringScene = createBoxingScene(canvas);

  const boxerView = (seat: Seat, b: BoxerSnapshot, s: BoxingSnapshot): BoxerView => {
    // a jab: t 0..1 from thrown to landed (the server's own ticks), then 1..2
    // on the way back over the same time; the snapshot drops a landed jab, so
    // the return is kept here from the last one seen
    let jab: BoxerView["jab"] = null;
    for (const hand of ["left", "right"] as const) {
      const p = b.punches[hand];
      if (p) {
        const t = Math.min(1, Math.max(0, (s.tick - p.thrownTick) / JAB_WINDUP_TICKS));
        jab = { hand, target: p.target, t };
        returning[seat] = { hand, target: p.target, landsTick: p.landsTick };
      }
    }
    const r = returning[seat];
    if (!jab && r) {
      const t = 1 + (s.tick - r.landsTick) / JAB_WINDUP_TICKS;
      if (t >= 2) returning[seat] = null;
      else jab = { hand: r.hand, target: r.target, t: Math.max(1, t) };
    }
    const ko = s.phase === "over" && s.result === "ko" && b.health <= 0;
    return { look: looks[seat], guard: b.guard, slip: b.slip?.side ?? null, jab, hit: hits[seat], ko, seat };
  };
  const returning: Array<{ hand: Hand; target: Target; landsTick: number } | null> = [null, null];

  let frames = 0;
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const h of hits) if (h) h.age += dt;
    if (snap) {
      const s = snap;
      const mine: Seat = info.seat ?? 0;
      const foe: Seat = mine === 0 ? 1 : 0;
      const v: RingView = { me: boxerView(mine, s.boxers[mine], s), foe: boxerView(foe, s.boxers[foe], s), spectator: info.seat === null };
      ringScene.render(v, dt);
    }
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    clearInterval(camTimer);
    readyPanel.dispose();
    unsubscribe();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    boxCam.dispose();
    disposeSpectating();
    ringScene.dispose();
  };
}
