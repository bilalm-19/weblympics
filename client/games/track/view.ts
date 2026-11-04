import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { MAX_SPEED } from "../../../shared/games/track/sim.ts";
import type { Seat, Side, TrackSnapshot } from "../../../shared/games/track/sim.ts";
import type { LobbyView, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { createReadyPanel } from "../tennis/ready-panel.ts";
import { buildTrack, laneZ, makeRunner } from "./lane.ts";
import { createRunCamera } from "./run-camera.ts";
import "./track.css";

// The track view (task 26): a side-on chase camera on two lanes. You step by
// alternating A/D (or the arrows), the two tap buttons, or the camera; the
// server counts the steps and says where everyone is. This only draws it.

const FORMATS: readonly RoomFormat[] = ["race", "unlimited"];
const SEAT_COLOURS = [0x2f7fe0, 0xe0453a] as const;
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
const KEY_SIDE: Record<string, Side> = { KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };

export interface TrackViewOptions {
  local?: boolean;
  leaveLabel?: string;
  onView?(view: HTMLElement): void;
}

const fmt = (t: number | null) => (t === null ? "–" : `${t.toFixed(2)} s`);

export function startTrack(root: HTMLElement, conn: GameLink, info: RoomInfo, onLeave: () => void, opts: TrackViewOptions = {}): () => void {
  const view = document.createElement("div");
  view.className = "game track";
  view.innerHTML = `
    <canvas aria-label="Running track"></canvas>
    <div class="hud">
      <div class="tr-board" aria-label="Race"></div>
      <div>
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
    </div>
    <div class="tr-call" aria-live="polite" hidden></div>
    <div class="controls" hidden>
      <button class="primary tr-step" type="button" data-side="left" aria-label="Left foot (A)">Left</button>
      <button class="primary tr-step" type="button" data-side="right" aria-label="Right foot (D)">Right</button>
    </div>
  `;
  root.replaceChildren(view);
  opts.onView?.(view);
  if (opts.local) {
    view.classList.add("local");
    for (const el of view.querySelectorAll<HTMLElement>(".code, [data-action=copy]")) el.hidden = true;
  }
  if (opts.leaveLabel) (view.querySelector("[data-action=leave]") as HTMLElement).textContent = opts.leaveLabel;

  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const board = view.querySelector(".tr-board") as HTMLElement;
  const statusEl = view.querySelector(".status") as HTMLElement;
  const callEl = view.querySelector(".tr-call") as HTMLElement;
  (view.querySelector(".code") as HTMLElement).textContent = `Room ${info.room}`;
  canvas.dataset.frames = "0";

  const scene = new Scene();
  let built = 0;
  const runners = [makeRunner(SEAT_COLOURS[0]), makeRunner(SEAT_COLOURS[1])] as const;
  for (const seat of [0, 1] as const) {
    runners[seat].group.position.z = laneZ(seat);
    scene.add(runners[seat].group);
  }
  const camera = new PerspectiveCamera(40, 1, 0.1, 400);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x9fd3f5);
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // a tall phone screen: a wider lens so both lanes and some track ahead show
    camera.fov = camera.aspect < 1 ? 62 : 40;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  let snap: TrackSnapshot | null = null;
  let names: [string | null, string | null] = [null, null];
  let lobby: LobbyView | null = null;
  const label = (seat: Seat) => (seat === info.seat ? "You" : (names[seat] ?? (opts.local && seat === 1 ? "Pacer" : `Player ${seat + 1}`)));
  const playing = () => !lobby || info.practice || lobby.phase === "playing";
  const canStep = () => info.seat !== null && snap?.phase === "running" && playing();

  const step = (side: Side) => {
    if (!canStep()) return;
    conn.send({ t: "step", side, at: performance.now() });
    view.dataset.next = side === "left" ? "right" : "left";
    canvas.dataset.sent = String(Number(canvas.dataset.sent ?? 0) + 1);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const side = KEY_SIDE[e.code];
    if (!side) return;
    e.preventDefault();
    if (e.repeat) return;
    step(side);
  };
  window.addEventListener("keydown", onKey);

  for (const b of view.querySelectorAll<HTMLButtonElement>(".tr-step")) {
    // pointerdown, not click: a tap should land as the finger lands
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      step(b.dataset.side as Side);
    });
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const runCam = createRunCamera(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    step,
    pause: (p) => {
      if (info.practice) conn.send({ t: "pause", paused: p });
    },
  });

  const readyPanel = createReadyPanel(
    view,
    info.seat,
    info.room,
    {
      ready: (ready) => conn.send({ t: "ready", ready }),
      format: (format) => conn.send({ t: "format", format }),
      // task 7: the host's rated option is the room's, not tennis's
      rated: (rated) => conn.send({ t: "rated", rated }),
      openCamera: () => cameraButton.click(),
    },
    FORMATS,
  );
  readyPanel.camera("off");
  const camTimer = window.setInterval(() => readyPanel.camera(runCam.state()), 500);

  let callTimer = 0;
  const call = (text: string) => {
    callEl.textContent = text;
    callEl.hidden = true;
    void callEl.offsetWidth;
    callEl.hidden = false;
    clearTimeout(callTimer);
    callTimer = window.setTimeout(() => (callEl.hidden = true), 1400);
  };

  const renderBoard = (s: TrackSnapshot) => {
    board.replaceChildren();
    const head = document.createElement("div");
    head.className = "tr-head";
    head.textContent = opts.local ? `Practice · ${s.length} m` : s.format === "unlimited" ? `Unlimited · ${s.length} m · race ${s.races + 1}` : `Sprint · ${s.length} m`;
    board.append(head);
    for (const seat of [0, 1] as const) {
      const lane = s.lanes[seat];
      const row = document.createElement("div");
      row.className = "tr-row";
      row.dataset.seat = String(seat);
      row.style.setProperty("--seat", SEAT_CSS[seat]);
      const name = document.createElement("span");
      name.className = "tr-name";
      name.textContent = label(seat);
      const bar = document.createElement("span");
      bar.className = "tr-bar";
      bar.innerHTML = `<i style="width:${((lane.distance / s.length) * 100).toFixed(1)}%"></i>`;
      const time = document.createElement("strong");
      time.className = "tr-time";
      time.textContent = lane.finish !== null ? fmt(lane.finish) : `${lane.speed.toFixed(1)} m/s`;
      row.append(name, bar, time);
      if (s.best[seat] !== null && (opts.local || s.format === "unlimited")) row.title = `best ${fmt(s.best[seat])}`;
      board.append(row);
    }
  };

  const updateHud = () => {
    if (!snap) return;
    const s = snap;
    renderBoard(s);
    const l = lobby;
    view.dataset.phase = s.phase;
    for (const b of view.querySelectorAll<HTMLButtonElement>(".tr-step")) b.disabled = !canStep();
    if (l?.phase === "paused" && l.hold) statusEl.textContent = `Paused: waiting for ${l.hold.seat === info.seat ? "you" : l.hold.name} to reconnect (${l.hold.seconds} s)`;
    else if (l?.match && l.phase === "countdown") statusEl.textContent = `Back. Resuming in ${l.countdown ?? 0}…`;
    else if (l && !info.practice && l.phase !== "playing" && s.phase !== "over") statusEl.textContent = "";
    else if (s.phase === "set") statusEl.textContent = "On your marks… set…";
    else if (s.phase === "over" && s.winner !== null) {
      const t = s.lanes[s.winner].finish;
      statusEl.textContent = s.winner === info.seat ? `You win in ${fmt(t)}!` : `${label(s.winner)} wins in ${fmt(t)}`;
    } else if (s.phase === "running") {
      const mine = info.seat === null ? null : s.lanes[info.seat];
      statusEl.textContent = mine?.finish != null ? `Finished in ${fmt(mine.finish)}` : info.seat === null ? "Racing" : "Run! Alternate A and D, or Left and Right";
    }
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as TrackSnapshot;
      const prev = snap;
      if (prev && prev.phase === "set" && next.phase === "running") call("Go!");
      if (next.length !== built) {
        buildTrack(scene, next.length);
        built = next.length;
      }
      snap = next;
      canvas.dataset.phase = next.phase;
      for (const seat of [0, 1] as const) {
        canvas.dataset[`d${seat}`] = next.lanes[seat].distance.toFixed(2);
        canvas.dataset[`steps${seat}`] = String(next.lanes[seat].steps);
      }
      canvas.dataset.races = String(next.races);
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
  view.querySelector("[data-action=copy]")?.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    navigator.clipboard
      ?.writeText(`${location.origin}/#/room/${info.room}`)
      .then(() => (button.textContent = "Copied"))
      .catch(() => (button.textContent = "Copy failed"));
  });
  (view.querySelector(".controls") as HTMLElement).hidden = info.seat === null;

  let frames = 0;
  let raf = 0;
  let last = performance.now();
  // each runner's drawn distance eases toward the server's, and its stride phase
  const shown = [0, 0];
  const phase = [0, 0];
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (snap) {
      const s = snap;
      for (const seat of [0, 1] as const) {
        const lane = s.lanes[seat];
        // snap back at a new race; otherwise run on at the server's speed, corrected
        if (lane.distance < shown[seat] - 5) shown[seat] = lane.distance;
        shown[seat] += lane.speed * dt;
        shown[seat] += (lane.distance - shown[seat]) * Math.min(1, dt * 8);
        const r = runners[seat];
        r.group.position.x = shown[seat];
        // a stride is about two metres at speed; on the spot it still ticks over with steps
        phase[seat] += dt * (lane.speed * 1.6 + lane.cadence * 1.2);
        r.run(phase[seat], Math.min(1, lane.speed / MAX_SPEED));
      }
      // chase the leader of the viewer's interest: my lane, or the front runner
      const focus = info.seat ?? (shown[0] >= shown[1] ? 0 : 1);
      const x = shown[focus];
      const portrait = camera.aspect < 1;
      camera.position.set(x - (portrait ? 2 : 3), portrait ? 3.2 : 2.6, portrait ? 9 : 8);
      camera.lookAt(x + (portrait ? 1.5 : 3), 0.8, 0);
    }
    renderer.render(scene, camera);
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    clearInterval(camTimer);
    readyPanel.dispose();
    unsubscribe();
    window.removeEventListener("keydown", onKey);
    runCam.dispose();
    observer.disconnect();
    renderer.dispose();
  };
}
