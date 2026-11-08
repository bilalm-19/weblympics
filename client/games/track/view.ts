import { addSpectating } from "../../ui/spectate.ts";
import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { AIR_TICKS, MAX_SPEED } from "../../../shared/games/track/sim.ts";
import type { Seat, Side, TrackEvent, TrackSnapshot } from "../../../shared/games/track/sim.ts";
import type { LobbyView, RoomEvent, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { EVENT_LABELS, createReadyPanel } from "../tennis/ready-panel.ts";
import { DEFAULT_LOOKS } from "../../../shared/look.ts";
import { buildHurdles, buildTrack, jumpPose, laneZ } from "./lane.ts";
import type { HurdleRow, TrackScene } from "./lane.ts";
import { makeRunner } from "./runner.ts";
import { clockText, clockTime, excitement } from "./scene-model.ts";
import { createRunCamera } from "./run-camera.ts";
import "./track.css";
import { audioEngine, gameSounds, mountSoundToggle } from "../../audio/index.ts";
import type { CrowdContext } from "../../audio/crowd.ts";
import { trackCrowd, trackCues } from "./sound.ts";
import { TRACK_LEFT } from "./lane.ts";
import { reactionLevel } from "../tennis/crowd-motion.ts";

// The track view (task 26): a side-on chase camera on two lanes. You step by
// alternating A/D (or the arrows), the two tap buttons, or the camera; the
// server counts the steps and says where everyone is. This only draws it.
// Hurdles (task 27): Space, the Jump button or the camera jumps; the server
// says who is in the air and which hurdles are down.

const FORMATS: readonly RoomFormat[] = ["race", "unlimited"];
const EVENTS: readonly RoomEvent[] = ["sprint", "hurdles"];
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
const KEY_SIDE: Record<string, Side> = { KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right" };

export interface TrackViewOptions {
  local?: boolean;
  leaveLabel?: string;
  onView?(view: HTMLElement): void;
  /** Task 38: practice's "Just me": your lane alone, no second row or runner. */
  solo?: () => boolean;
}

const fmt = (t: number | null) => (t === null ? "–" : `${t.toFixed(2)} s`);

export function startTrack(root: HTMLElement, conn: GameLink, info: RoomInfo, onLeave: () => void, opts: TrackViewOptions = {}): () => void {
  const view = document.createElement("div");
  view.className = "game track";
  view.innerHTML = `
    <canvas aria-label="Running track"></canvas>
    <div class="hud">
      <div class="tr-board" aria-label="Race"></div>
      <div class="hud-tools">
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <span class="tr-events" role="radiogroup" aria-label="Event" hidden>
          ${EVENTS.map((e) => `<button type="button" role="radio" data-practice-event="${e}">${EVENT_LABELS[e]}</button>`).join("")}
        </span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
    </div>
    <div class="tr-call" aria-live="polite" hidden></div>
    <div class="controls" hidden>
      <button class="primary tr-step" type="button" data-side="left" aria-label="Left foot (A)">Left</button>
      <button class="tr-jump" type="button" aria-label="Jump (Space)" hidden>Jump</button>
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
  let stadium: TrackScene | null = null;
  // task 27: the hurdles, rebuilt when the event (or the course) changes
  let hurdleRow: HurdleRow | null = null;
  let hurdleKey = "";
  // each seat in its look (task 31): the default until the room says otherwise
  const runners = [makeRunner(DEFAULT_LOOKS[0]), makeRunner(DEFAULT_LOOKS[1])] as const;
  for (const seat of [0, 1] as const) {
    runners[seat].group.position.z = laneZ(seat);
    // the character faces -z; the track runs down +x
    runners[seat].group.rotation.y = -Math.PI / 2;
    scene.add(runners[seat].group);
  }
  const camera = new PerspectiveCamera(40, 1, 0.1, 400);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x86c4f4);
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
  // task 19: sound through the shared module; the stands placed by side
  const sounds = gameSounds();
  const crowdCtx: CrowdContext = { viewer: info.seat, stands: "sides", practice: info.practice, leftSeat: TRACK_LEFT };
  // the stands' finish reaction: the winner's half jumps, the other half slumps (lane.ts)
  const motionPref = matchMedia("(prefers-reduced-motion: reduce)");
  let finishReact: { cheer: Seat; aww: Seat | null; at: number } | null = null;
  const leaveBtn = view.querySelector("[data-action=leave]") as HTMLElement;
  const disposeToggle = mountSoundToggle(audioEngine(), leaveBtn.parentElement as HTMLElement, leaveBtn);
  // the crowd's murmur follows the stands' excitement (set each frame)
  let loudNow = 0.06;
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

  const hurdles = () => snap?.event === "hurdles";
  const jumpBtn = view.querySelector(".tr-jump") as HTMLButtonElement;
  const jump = () => {
    if (!canStep() || !hurdles()) return;
    conn.send({ t: "jump", at: performance.now() });
    canvas.dataset.jumpsSent = String(Number(canvas.dataset.jumpsSent ?? 0) + 1);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      // Space on a focused button (Camera, Ready, a format) presses that button; otherwise it jumps
      if (e.target instanceof HTMLButtonElement && e.target !== jumpBtn) return;
      if (!hurdles()) return;
      e.preventDefault();
      if (!e.repeat) jump();
      return;
    }
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
  jumpBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    jump();
  });
  jumpBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  // practice (in the page or vs the bot) has no ready panel: the player switches the event here
  const eventSwitch = view.querySelector(".tr-events") as HTMLElement;
  eventSwitch.hidden = !info.practice || info.seat === null;
  for (const b of eventSwitch.querySelectorAll<HTMLButtonElement>("[data-practice-event]")) {
    b.addEventListener("click", () => {
      conn.send({ t: "event", event: b.dataset.practiceEvent as RoomEvent });
      b.blur();
    });
  }

  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const runCam = createRunCamera(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    step,
    jump,
    hurdles,
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
      event: (event) => conn.send({ t: "event", event }),
    },
    FORMATS,
    EVENTS,
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
    const ev = EVENT_LABELS[s.event as TrackEvent];
    head.textContent = opts.solo?.() ? `Just me · ${ev} · ${s.length} m` : opts.local ? `Practice · ${ev} · ${s.length} m` : s.format === "unlimited" ? `Unlimited · ${ev} · ${s.length} m · race ${s.races + 1}` : `${ev} · ${s.length} m`;
    board.append(head);
    for (const seat of [0, 1] as const) {
      if (seat === 1 && opts.solo?.()) continue;
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
      if (s.event === "hurdles") {
        // task 27: hurdles cleared out of those reached
        const h = document.createElement("span");
        h.className = "tr-hurdles";
        h.dataset.cleared = String(lane.cleared);
        h.dataset.hit = String(lane.hit);
        h.textContent = `${lane.cleared}/${s.obstacles.length} cleared`;
        h.title = `${lane.cleared} cleared, ${lane.hit} knocked down`;
        row.append(h);
      }
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
    view.dataset.event = s.event;
    jumpBtn.hidden = s.event !== "hurdles";
    jumpBtn.disabled = !canStep();
    for (const b of eventSwitch.querySelectorAll<HTMLButtonElement>("[data-practice-event]")) b.setAttribute("aria-checked", String(b.dataset.practiceEvent === s.event));
    if (l?.phase === "paused" && l.hold) statusEl.textContent = `Paused: waiting for ${l.hold.seat === info.seat ? "you" : l.hold.name} to reconnect (${l.hold.seconds} s)`;
    else if (l?.match && l.phase === "countdown") statusEl.textContent = `Back. Resuming in ${l.countdown ?? 0}…`;
    else if (l && !info.practice && l.phase !== "playing" && s.phase !== "over") statusEl.textContent = "";
    else if (s.phase === "set") statusEl.textContent = "On your marks… set…";
    else if (s.phase === "over" && s.winner !== null) {
      const t = s.lanes[s.winner].finish;
      statusEl.textContent = opts.solo?.() ? `Your time: ${fmt(t)}${s.best[0] === t ? " · best!" : ""}` : s.winner === info.seat ? `You win in ${fmt(t)}!` : `${label(s.winner)} wins in ${fmt(t)}`;
    } else if (s.phase === "running") {
      const mine = info.seat === null ? null : s.lanes[info.seat];
      statusEl.textContent =
        mine?.finish != null
          ? `Finished in ${fmt(mine.finish)}`
          : info.seat === null
            ? "Racing"
            : s.event === "hurdles"
              ? "Run with A and D; Space to jump each hurdle"
              : "Run! Alternate A and D, or Left and Right";
    }
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as TrackSnapshot;
      const prev = snap;
      if (prev && prev.phase === "set" && next.phase === "running") call("Go!");
      if (next.length !== built) {
        stadium?.dispose();
        stadium = buildTrack(scene, next.length);
        built = next.length;
      }
      const key = next.obstacles.join(",");
      if (key !== hurdleKey) {
        hurdleRow?.dispose();
        hurdleRow = next.obstacles.length ? buildHurdles(scene, next.obstacles) : null;
        hurdleKey = key;
      }
      // a hurdle knocked down: the call says so for the viewer's own lane
      if (prev && info.seat !== null && prev.event === "hurdles" && next.lanes[info.seat].hit > prev.lanes[info.seat].hit) call("Hit!");
      // task 19: "set", the gun, the steps, a hurdle down, the murmur and the finish roar (sound.ts)
      sounds.play(trackCues(prev, next, { ...crowdCtx, murmur: loudNow }));
      const crowdEvent = prev ? trackCrowd(prev, next, next.solo) : null;
      if (crowdEvent?.cheer != null) {
        finishReact = { cheer: crowdEvent.cheer, aww: crowdEvent.aww ?? null, at: performance.now() };
        canvas.dataset.crowd = `cheer:${crowdEvent.cheer}${crowdEvent.aww != null ? ` aww:${crowdEvent.aww}` : ""}`;
      }
      snap = next;
      canvas.dataset.phase = next.phase;
      canvas.dataset.event = next.event;
      for (const seat of [0, 1] as const) {
        canvas.dataset[`d${seat}`] = next.lanes[seat].distance.toFixed(2);
        canvas.dataset[`steps${seat}`] = String(next.lanes[seat].steps);
        canvas.dataset[`jumps${seat}`] = String(next.lanes[seat].jumps);
        canvas.dataset[`cleared${seat}`] = String(next.lanes[seat].cleared);
        canvas.dataset[`hit${seat}`] = String(next.lanes[seat].hit);
      }
      canvas.dataset.races = String(next.races);
      updateHud();
    } else if (msg.t === "presence") {
      names = msg.names;
      updateHud();
    } else if (msg.t === "lobby") {
      const { t: _t, ...v } = msg;
      lobby = v;
      for (const seat of [0, 1] as const) {
        runners[seat].setLook(v.seats[seat]?.look ?? DEFAULT_LOOKS[seat]);
        canvas.dataset[`look${seat}`] = String(runners[seat].group.userData.look);
      }
      readyPanel.update(v);
      updateHud();
    }
  });

  view.querySelector("[data-action=leave]")?.addEventListener("click", onLeave);
  // task 24: watch link for players; the Watching badge and count for spectators
  const disposeSpectating = opts.local ? () => {} : addSpectating(view, conn, info);
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
  // when the first runner crossed the line, by this page's clock, for the crowd's burst
  let finishedAt: number | null = null;
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
        r.group.visible = !(seat === 1 && opts.solo?.());
        r.group.position.x = shown[seat];
        // a stride is about two metres at speed; on the spot it still ticks over with steps
        phase[seat] += dt * (lane.speed * 1.6 + lane.cadence * 1.2);
        r.run(phase[seat], Math.min(1, lane.speed / MAX_SPEED), s.phase === "set");
        // task 27: in the air, from the server's ticks left; the hurdles stand or fall
        jumpPose(r, lane.air > 0 ? 1 - lane.air / AIR_TICKS : null);
        hurdleRow?.update(seat, lane.hurdles, dt);
      }
      const anyFinish = s.lanes.some((l) => l.finish !== null);
      if (!anyFinish) finishedAt = null;
      else if (finishedAt === null) finishedAt = now;
      const lead = Math.max(s.lanes[0].distance, s.lanes[1].distance) / s.length;
      const loud = excitement(lead, finishedAt === null ? null : (now - finishedAt) / 1000, s.phase === "running");
      loudNow = loud;
      // chase the leader of the viewer's interest: my lane, or the front runner
      const focus = info.seat ?? (shown[0] >= shown[1] ? 0 : 1);
      const x = shown[focus];
      const portrait = camera.aspect < 1;
      camera.position.set(x - (portrait ? 2 : 3), portrait ? 3.2 : 2.6, portrait ? 9 : 8);
      camera.lookAt(x + (portrait ? 1.5 : 3), 0.8, 0);
      const fr = finishReact;
      const level = fr ? reactionLevel("cheer", 3, (now - fr.at) / 1000) : 0;
      if (fr && level === 0 && now - fr.at > 1000) finishReact = null;
      stadium?.update(camera.position.x, loud, now / 1000, clockText(clockTime(s)), fr ? { cheer: fr.cheer, aww: fr.aww, level, still: motionPref.matches } : undefined);
    }
    renderer.render(scene, camera);
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  // Webcam by default (task 15): a seated player gets the camera setup first,
  // with "Use keyboard instead" (run-camera.ts); practice holds the race
  // meanwhile; a spectator never does.
  if (info.seat !== null) cameraButton.click();

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    clearInterval(camTimer);
    readyPanel.dispose();
    unsubscribe();
    window.removeEventListener("keydown", onKey);
    runCam.dispose();
    disposeSpectating();
    sounds.dispose();
    disposeToggle();
    observer.disconnect();
    hurdleRow?.dispose();
    renderer.dispose();
  };
}
