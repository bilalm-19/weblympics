import { addSpectating } from "../../ui/spectate.ts";
import { BREAK_TICKS, HEALTH, ROUNDS, ROUND_TICKS, WINDUP_TICKS } from "../../../shared/games/boxing/sim.ts";
import type { BoxerSnapshot, BoxingSnapshot, Hand, PunchKind, Seat } from "../../../shared/games/boxing/sim.ts";
import type { LobbyView, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { createReadyPanel } from "../tennis/ready-panel.ts";
import { createBoxCamera } from "./box-camera.ts";
import "./boxing.css";

// The boxing view (task 30), first version: a flat 2D ring on one canvas, so
// the rules can be felt before the 3D scene (a later task) exists. You punch
// with J (jab) and K (hook), or the buttons; hold Space (or the Guard button)
// to guard, or the camera (box-camera.ts: a fast hand at the screen is a jab,
// a sweep across the body a hook, both hands by the face the guard). The
// server lands every punch after its wind-up and checks the guard then; this
// only draws what it says.

const FORMATS: readonly RoomFormat[] = ["bout", "unlimited"];
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
const SEAT_SKIN = ["#f3cfae", "#e0b48a"] as const;
const PUNCH_KEYS: Record<string, { kind: PunchKind; hand?: Hand }> = {
  KeyJ: { kind: "jab" },
  KeyK: { kind: "hook" },
};

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
      <button class="primary" type="button" data-punch="jab" aria-label="Jab (J)">Jab</button>
      <button class="primary" type="button" data-punch="hook" aria-label="Hook (K)">Hook</button>
      <button type="button" data-guard aria-label="Guard (hold Space)">Guard</button>
    </div>
  `;
  root.replaceChildren(view);
  if (opts.local) {
    view.classList.add("local");
    for (const el of view.querySelectorAll<HTMLElement>(".code, [data-action=copy]")) el.hidden = true;
  }
  if (opts.leaveLabel) (view.querySelector("[data-action=leave]") as HTMLElement).textContent = opts.leaveLabel;

  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const statusEl = view.querySelector(".status") as HTMLElement;
  const callEl = view.querySelector(".bx-call") as HTMLElement;
  (view.querySelector(".code") as HTMLElement).textContent = `Room ${info.room}`;
  canvas.dataset.frames = "0";

  let snap: BoxingSnapshot | null = null;
  let names: [string | null, string | null] = [null, null];
  let lobby: LobbyView | null = null;
  const label = (seat: Seat) => (seat === info.seat ? "You" : (names[seat] ?? (opts.local && seat === 1 ? "Sparring partner" : `Player ${seat + 1}`)));
  const playing = () => !lobby || info.practice || lobby.phase === "playing";
  const canBox = () => info.seat !== null && snap?.phase === "round" && playing();

  // ---- input: punches and the guard, never a claim of damage ----
  let nextHand: Hand = "left";
  const punch = (kind: PunchKind) => {
    if (!canBox()) return;
    // alternate hands; the server refuses a busy one and the other is tried next press
    const hand = nextHand;
    nextHand = hand === "left" ? "right" : "left";
    conn.send({ t: "punch", kind, hand, at: performance.now() });
    canvas.dataset.sent = String(Number(canvas.dataset.sent ?? 0) + 1);
  };
  let guardUp = false;
  const guard = (up: boolean) => {
    if (up === guardUp) return;
    if (up && !canBox()) return;
    guardUp = up;
    view.dataset.guard = String(up);
    conn.send({ t: "guard", up });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      guard(true);
      return;
    }
    const p = PUNCH_KEYS[e.code];
    if (!p) return;
    e.preventDefault();
    if (!e.repeat) punch(p.kind);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") guard(false);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  for (const b of view.querySelectorAll<HTMLButtonElement>("[data-punch]")) {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      punch(b.dataset.punch as PunchKind);
    });
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  const guardButton = view.querySelector("[data-guard]") as HTMLButtonElement;
  guardButton.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    guard(true);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) guardButton.addEventListener(ev, () => guard(false));
  guardButton.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---- the camera: the same punch and guard as the keys ----
  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const boxCam = createBoxCamera(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    punch: (kind, hand) => {
      if (!canBox()) return;
      nextHand = hand === "left" ? "right" : "left";
      conn.send({ t: "punch", kind, hand, at: performance.now() });
      canvas.dataset.sent = String(Number(canvas.dataset.sent ?? 0) + 1);
      canvas.dataset.camPunch = String(Number(canvas.dataset.camPunch ?? 0) + 1);
    },
    guard,
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
    } else if (s.phase === "round") statusEl.textContent = info.seat === null ? "Boxing" : "J jab · K hook · hold Space to guard";
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
      if (next.lastHit && (!prev?.lastHit || next.lastHit.tick !== prev.lastHit.tick)) flash(next.lastHit.seat === 0 ? 1 : 0, next.lastHit.guarded);
      snap = next;
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

  // ---- drawing: a flat ring, the boxers facing each other, punches in flight ----
  const hurt = [0, 0]; // seconds of "ouch" shake left, per boxer
  const blocked = [0, 0];
  function flash(victim: Seat, guarded: boolean): void {
    if (guarded) blocked[victim] = 0.25;
    else hurt[victim] = 0.3;
  }

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.round(view.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(view.clientHeight * dpr));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  const drawBoxer = (seat: Seat, b: BoxerSnapshot, tick: number, cx: number, floor: number, u: number, dir: 1 | -1, dt: number) => {
    hurt[seat] = Math.max(0, hurt[seat] - dt);
    blocked[seat] = Math.max(0, blocked[seat] - dt);
    const shake = hurt[seat] > 0 ? Math.sin(hurt[seat] * 90) * 0.12 * u : 0;
    const x = cx + shake;
    const shirt = SEAT_CSS[seat];
    ctx.save();
    // legs
    ctx.fillStyle = "#2b303b";
    ctx.fillRect(x - 0.55 * u, floor - 1.7 * u, 0.5 * u, 1.7 * u);
    ctx.fillRect(x + 0.05 * u, floor - 1.7 * u, 0.5 * u, 1.7 * u);
    // torso
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(x - 0.8 * u, floor - 3.9 * u, 1.6 * u, 2.4 * u, 0.4 * u);
    ctx.fill();
    // head
    ctx.fillStyle = SEAT_SKIN[seat];
    ctx.beginPath();
    ctx.arc(x, floor - 4.7 * u, 0.75 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(x + dir * 0.28 * u, floor - 4.78 * u, 0.09 * u, 0, Math.PI * 2);
    ctx.fill();
    // guard: both gloves up by the face
    const gloveR = 0.42 * u;
    const glove = (gx: number, gy: number, strong: boolean) => {
      ctx.fillStyle = strong ? "#fff" : shirt;
      ctx.strokeStyle = "#0008";
      ctx.lineWidth = 0.06 * u;
      ctx.beginPath();
      ctx.arc(gx, gy, gloveR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    for (const hand of ["left", "right"] as const) {
      const p = b.punches[hand];
      const rest = b.guard ? { x: x + dir * 0.55 * u, y: floor - 4.4 * u } : { x: x + dir * (hand === "left" ? 0.7 : 0.35) * u, y: floor - (hand === "left" ? 3.3 : 3.0) * u };
      let gx = rest.x;
      let gy = rest.y;
      if (p) {
        // wind-up then reach: the glove travels out, landing on the tick the server lands it
        const total = WINDUP_TICKS[p.kind];
        const t = Math.min(1, Math.max(0, (tick - p.thrownTick) / total));
        const reach = (p.kind === "jab" ? 2.6 : 2.2) * u * Math.sin(t * Math.PI * 0.5);
        gx = rest.x + dir * reach;
        gy = rest.y - (p.kind === "hook" ? Math.sin(t * Math.PI) * 0.5 * u : 0) - (hand === "left" ? 0.3 : 0) * u;
      }
      glove(gx, gy, p !== null);
    }
    if (blocked[seat] > 0) {
      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 0.14 * u;
      ctx.beginPath();
      ctx.arc(x + dir * 0.9 * u, floor - 4.2 * u, 1.1 * u, -0.9, 0.9);
      ctx.stroke();
    }
    ctx.restore();
  };

  let frames = 0;
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // arena
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1c2340");
    sky.addColorStop(1, "#3b3560");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const u = Math.min(w / 16, h / 9);
    const floor = h * 0.8;
    // ring floor and ropes
    ctx.fillStyle = "#c9b27c";
    ctx.fillRect(0, floor, w, h - floor);
    ctx.strokeStyle = "#e0453a";
    ctx.lineWidth = Math.max(2, u * 0.12);
    for (const y of [0.34, 0.5, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(0, h * y);
      ctx.lineTo(w, h * y);
      ctx.stroke();
    }
    if (snap) {
      const s = snap;
      const gap = Math.min(w * 0.36, 5.2 * u);
      drawBoxer(0, s.boxers[0], s.tick, w / 2 - gap / 2 - 0.5 * u, floor, u, 1, dt);
      drawBoxer(1, s.boxers[1], s.tick, w / 2 + gap / 2 + 0.5 * u, floor, u, -1, dt);
      if (s.phase === "break") {
        ctx.fillStyle = "#0006";
        ctx.fillRect(0, 0, w, h);
      }
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
    observer.disconnect();
  };
}
