import {
  CircleGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { AIM_YAW, BALL_R, RIM, SPOTS, spotPosition } from "../../../shared/games/basketball/sim.ts";
import type { Seat, ShotResult, Vec3 } from "../../../shared/games/basketball/sim.ts";
import { DEFAULT_LOOKS } from "../../../shared/look.ts";
import type { Look } from "../../../shared/look.ts";
import type { LobbyView, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { addSpectating } from "../../ui/spectate.ts";
import { createReadyPanel } from "../tennis/ready-panel.ts";
import "./basketball.css";
import { bonusLine, heldPower, powerVerdict, shotCall, spotLine } from "./calls.ts";
import { buildCourt } from "./court.ts";
import { createShootCamera } from "./shoot-camera.ts";
import { SHOT_TIMES, makeShooter, shotPose } from "./shooter.ts";
import { createSounds } from "./sound.ts";
import { createTiePanel } from "./tie-vote.ts";
import type { TieChoice, WithVote } from "./tie-vote.ts";

// LOCAL TYPE EXTENSION (task 32 tie vote): `tie` isn't in this branch's
// ClientMsg yet; the rules agent adds it on basketball-rules. Sent through
// this cast until integration, then drop it.

// The basketball view (task 32, ADR 003): the park court (court.ts), the
// camera behind the shooter for a player and side-on for a spectator, the
// HUD over it. Mouse or Left/Right aim; hold Space, the mouse on the court or
// the Shoot button and a power bar fills then falls; let go to shoot. Or the
// camera (shoot-camera.ts): hands at the chest to get set, sway to aim, push
// up to shoot. The client only ever says "set", "aiming here" and "shot this
// hard, this way"; the server flies the ball and scores it, and this draws
// what it says.

const FORMATS: readonly RoomFormat[] = ["shootout", "unlimited"];
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
/** Aim per second while an arrow key or aim button is held. */
const KEY_AIM_RATE = 0.9;
/** At most this often an aim goes to the server (ADR 003: throttled, only when it changes). */
const AIM_SEND_MS = 100;
/** The non-shooter stands this far to the shooter's left, a little back. */
const WAITING_SIDE = 2.4;
const HINT = "Push up and towards the hoop, like a real shot. No need to jump.";

export interface BasketballViewOptions {
  local?: boolean;
  leaveLabel?: string;
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

export function startBasketball(root: HTMLElement, conn: GameLink, info: RoomInfo, onLeave: () => void, opts: BasketballViewOptions = {}): () => void {
  const view = document.createElement("div");
  view.className = "game basketball";
  view.innerHTML = `
    <canvas aria-label="Basketball court"></canvas>
    <div class="hud">
      <div class="bb-board" aria-label="Score">
        <div class="bb-head"><span class="bb-spot"></span><span class="bb-clock" role="timer" hidden></span></div>
        <div class="bb-bonus"></div>
        <div class="bb-row" data-seat="0"><span class="bb-name"></span><span class="bb-shots"></span><strong class="bb-total"></strong></div>
        <div class="bb-row" data-seat="1"><span class="bb-name"></span><span class="bb-shots"></span><strong class="bb-total"></strong></div>
      </div>
      <div>
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
      <p class="bb-hint" hidden></p>
    </div>
    <div class="bb-call" aria-live="polite" hidden><strong></strong><span></span></div>
    <div class="bb-lower">
      <div class="bb-power" data-mode="off" hidden>
        <div class="bb-power-label"><span class="bb-power-who"></span><b class="bb-verdict"></b></div>
        <div class="bb-power-bar" role="meter" aria-label="Shot power" aria-valuemin="0" aria-valuemax="100">
          <i class="bb-zone"></i><i class="bb-fill"></i><i class="bb-mark"></i>
        </div>
        <div class="bb-power-ends" aria-hidden="true"><span>soft</span><span>hard</span></div>
      </div>
    </div>
    <section class="bb-end" role="dialog" aria-label="Match result" hidden>
      <h2></h2>
      <p class="bb-end-score"></p>
      <ul class="bb-end-lines"></ul>
      <button type="button" class="primary" data-action="end-ok">OK</button>
    </section>
    <div class="controls bb-controls" hidden>
      <button type="button" class="move" data-aim="-1" aria-label="Aim left (Left arrow)">◀</button>
      <button type="button" class="primary bb-shoot" aria-label="Hold to fill the power bar, let go to shoot (Space)">Shoot</button>
      <button type="button" class="move" data-aim="1" aria-label="Aim right (Right arrow)">▶</button>
    </div>
  `;
  root.replaceChildren(view);
  if (opts.local) {
    view.classList.add("local");
    for (const el of view.querySelectorAll<HTMLElement>(".code, [data-action=copy]")) el.hidden = true;
  }
  if (opts.leaveLabel) (view.querySelector("[data-action=leave]") as HTMLElement).textContent = opts.leaveLabel;
  (view.querySelector(".code") as HTMLElement).textContent = `Room ${info.room}`;

  const canvas = view.querySelector("canvas") as HTMLCanvasElement;
  const statusEl = view.querySelector(".status") as HTMLElement;
  const spotEl = view.querySelector(".bb-spot") as HTMLElement;
  const clockEl = view.querySelector(".bb-clock") as HTMLElement;
  const bonusEl = view.querySelector(".bb-bonus") as HTMLElement;
  const callEl = view.querySelector(".bb-call") as HTMLElement;
  const hintEl = view.querySelector(".bb-hint") as HTMLElement;
  const powerEl = view.querySelector(".bb-power") as HTMLElement;
  const powerBar = view.querySelector(".bb-power-bar") as HTMLElement;
  const zoneEl = view.querySelector(".bb-zone") as HTMLElement;
  const fillEl = view.querySelector(".bb-fill") as HTMLElement;
  const markEl = view.querySelector(".bb-mark") as HTMLElement;
  const whoEl = view.querySelector(".bb-power-who") as HTMLElement;
  const verdictEl = view.querySelector(".bb-verdict") as HTMLElement;
  const endEl = view.querySelector(".bb-end") as HTMLElement;
  const shootBtn = view.querySelector(".bb-shoot") as HTMLButtonElement;
  canvas.dataset.frames = "0";
  canvas.dataset.view = info.seat === null ? "spectator" : "player";

  // ---- the scene ----
  const scene = new Scene();
  const court = buildCourt(scene);
  const shooters = [makeShooter(DEFAULT_LOOKS[0]), makeShooter(DEFAULT_LOOKS[1])];
  for (const s of shooters) scene.add(s.group);
  const ball = new Group();
  const ballMesh = new Mesh(new IcosahedronGeometry(BALL_R, 1), new MeshLambertMaterial({ color: 0xe8671c, flatShading: true }));
  const seamMat = new MeshBasicMaterial({ color: 0x2a1a10 });
  const seamA = new Mesh(new TorusGeometry(BALL_R * 1.005, 0.004, 4, 20), seamMat);
  const seamB = seamA.clone();
  seamB.rotation.y = Math.PI / 2;
  const seamC = new Mesh(new TorusGeometry(BALL_R * 1.005, 0.004, 4, 20), seamMat);
  seamC.rotation.x = Math.PI / 2;
  ball.add(ballMesh, seamA, seamB, seamC);
  scene.add(ball);
  const ballShadow = new Mesh(new CircleGeometry(BALL_R * 1.1, 12), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);
  // the floor arrow: from the spot towards the hoop, turned by the shooter's aim
  const arrow = new Group();
  const arrowShape = new Shape();
  arrowShape.moveTo(-0.07, 0);
  arrowShape.lineTo(0.07, 0);
  arrowShape.lineTo(0.07, 1);
  arrowShape.lineTo(0.22, 1);
  arrowShape.lineTo(0, 1.4);
  arrowShape.lineTo(-0.22, 1);
  arrowShape.lineTo(-0.07, 1);
  arrowShape.closePath();
  // drawn over everything, so the shooter's own body never hides it
  const arrowMat = new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false });
  const arrowMesh = new Mesh(new ShapeGeometry(arrowShape), arrowMat);
  arrowMesh.renderOrder = 10;
  // the shape points along +y; flat on the floor it points along -z (away from the shooter)
  arrowMesh.rotation.x = -Math.PI / 2;
  arrowMesh.position.y = 0.02;
  arrow.add(arrowMesh);
  scene.add(arrow);

  const camera = new PerspectiveCamera(50, 1, 0.1, 400);
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const resize = () => {
    const w = view.clientWidth || 1;
    const h = view.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(view);
  resize();

  // ---- state ----
  let snap: WithVote | null = null;
  let names: [string | null, string | null] = [null, null];
  let lobby: LobbyView | null = null;
  let looks: [Look, Look] = [DEFAULT_LOOKS[0], DEFAULT_LOOKS[1]];
  const label = (seat: Seat) => (seat === info.seat ? "You" : (names[seat] ?? (seat === 1 && info.practice ? "Bot" : `Player ${seat + 1}`)));
  const playing = () => !lobby || info.practice || lobby.phase === "playing";
  const myTurn = () => snap !== null && info.seat !== null && snap.phase === "aim" && snap.turn === info.seat && playing();

  // this turn's input: the aim, the held power bar, and whether set and the shot went
  let aim = 0;
  let lastSentAim = 0;
  let lastAimAt = 0;
  let setSent = false;
  let shotSent = false;
  let holdSince: number | null = null;
  const held = new Set<string>();
  // per held aim key or button: its direction, when it went down and how much aim frames have applied;
  // on release the rest of the time held is applied, so a short hold turns the
  // same on a slow frame rate (as archery's arrow keys)
  const aimHeld = new Map<string, { dir: number; since: number; applied: number }>();
  const pressAim = (key: string, dir: number) => {
    aimHeld.set(key, { dir, since: performance.now(), applied: 0 });
    setAim(aim);
  };
  const releaseAim = (key: string) => {
    const h = aimHeld.get(key);
    if (!aimHeld.delete(key) || !h) return;
    const missed = ((performance.now() - h.since) / 1000) * KEY_AIM_RATE - h.applied;
    if (missed > 0 && myTurn() && !shotSent && !shootCam.on()) {
      setAim(aim + h.dir * missed);
      flushAim(performance.now(), true);
    }
  };
  // the shooter's arms: when a shot started (for the animation), per seat
  const shotStarted: [number | null, number | null] = [null, null];
  // sound, only after a user gesture (sound.ts)
  const sounds = createSounds();
  // the tie vote: level after the five spots, draw or sudden death (tie-vote.ts)
  const tiePanel = createTiePanel(document, info.seat, (choice) => conn.send({ t: "tie", choice }), (s) => label(s));
  view.append(tiePanel.el);

  const sendSet = () => {
    if (!myTurn() || setSent) return;
    setSent = true;
    conn.send({ t: "set" });
  };
  const setAim = (a: number) => {
    if (!myTurn() || shotSent) return;
    aim = Math.max(-1, Math.min(1, a));
    sendSet();
  };
  const flushAim = (now: number, force = false) => {
    if (!myTurn() || shotSent || Math.abs(aim - lastSentAim) < 0.005) return;
    if (!force && now - lastAimAt < AIM_SEND_MS) return;
    lastAimAt = now;
    lastSentAim = aim;
    conn.send({ t: "aim", aim });
  };
  const shoot = (power: number, shotAim: number) => {
    if (!myTurn() || shotSent) return;
    shotSent = true;
    const p = Math.max(0, Math.min(1, power));
    conn.send({ t: "shoot", power: p, aim: Math.max(-1, Math.min(1, shotAim)), at: performance.now() });
    // the arms go up at once on this screen, whatever the lag
    shotStarted[info.seat as Seat] = performance.now();
    canvas.dataset.sent = String(Number(canvas.dataset.sent ?? 0) + 1);
  };
  const startHold = (key: string) => {
    sounds.unlock();
    if (!myTurn() || shotSent || shootCam.on()) return;
    held.add(key);
    if (holdSince === null) holdSince = performance.now();
    sendSet();
  };
  const endHold = (key: string, fire = true) => {
    if (!held.delete(key) || held.size > 0 || holdSince === null) return;
    const power = heldPower((performance.now() - holdSince) / 1000);
    holdSince = null;
    if (!fire) return;
    // the bar stays where it was let go until the result replaces it
    powerEl.dataset.mode = "sent";
    shoot(power, aim);
  };

  // ---- keys ----
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    // the tie vote's D and C
    if (down && !e.repeat && tiePanel.key(e.code)) {
      e.preventDefault();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Space"].includes(e.code)) return;
    // Space on a focused button (Camera, Ready, a format) presses that button; only the Shoot button's Space shoots
    if (e.code === "Space" && e.target instanceof HTMLButtonElement && e.target !== shootBtn) return;
    e.preventDefault();
    if (e.repeat) return;
    sounds.unlock();
    if (e.code === "Space") {
      if (down) startHold("Space");
      else endHold("Space");
      return;
    }
    if (down) pressAim(e.code, e.code === "ArrowLeft" ? -1 : 1);
    else releaseAim(e.code);
  };
  const keydown = onKey(true);
  const keyup = onKey(false);
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);

  // ---- mouse and touch on the court: the mouse's x aims, a press holds the bar; a finger drags to aim ----
  const aimFromPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * 2 - 1;
  };
  canvas.addEventListener("pointermove", (e) => {
    if (!myTurn() || shootCam.on()) return;
    if (e.pointerType === "mouse" || e.buttons) setAim(aimFromPointer(e));
  });
  canvas.addEventListener("pointerdown", (e) => {
    sounds.unlock();
    if (!myTurn() || shootCam.on()) return;
    if (e.pointerType === "mouse") {
      canvas.setPointerCapture(e.pointerId);
      startHold("Pointer");
    } else setAim(aimFromPointer(e));
  });
  canvas.addEventListener("pointerup", () => endHold("Pointer"));
  canvas.addEventListener("pointercancel", () => endHold("Pointer", false));

  // ---- the buttons: hold Shoot; hold an aim button to turn ----
  shootBtn.addEventListener("pointerdown", (e) => {
    shootBtn.setPointerCapture(e.pointerId);
    startHold("Button");
  });
  shootBtn.addEventListener("pointerup", () => endHold("Button"));
  shootBtn.addEventListener("pointercancel", () => endHold("Button", false));
  shootBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  for (const b of view.querySelectorAll<HTMLButtonElement>("[data-aim]")) {
    const key = `Btn${b.dataset.aim}`;
    b.addEventListener("pointerdown", (e) => {
      sounds.unlock();
      b.setPointerCapture(e.pointerId);
      pressAim(key, Number(b.dataset.aim));
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(type, () => releaseAim(key));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- the camera: the same set, aim and shot as the keys (shoot-camera.ts) ----
  const cameraButton = view.querySelector("[data-action=camera]") as HTMLButtonElement;
  cameraButton.hidden = info.seat === null;
  const shootCam = createShootCamera(view, cameraButton, view.querySelector(".tracking") as HTMLElement, {
    set: () => sendSet(),
    aim: (a) => setAim(a),
    shoot: (power, a) => {
      aim = Math.max(-1, Math.min(1, a));
      shoot(power, aim);
    },
    pause: (p) => {
      if (info.practice) conn.send({ t: "pause", paused: p });
    },
  });

  // ---- the room's ready panel ----
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
  const camTimer = window.setInterval(() => readyPanel.camera(shootCam.state()), 500);

  // ---- the call after a shot, the power bar, the end card ----
  let callTimer = 0;
  const showCall = (text: string, detail: string, kind: string, ms = 2000) => {
    (callEl.querySelector("strong") as HTMLElement).textContent = text;
    (callEl.querySelector("span") as HTMLElement).textContent = detail;
    callEl.dataset.kind = kind;
    callEl.hidden = true;
    void callEl.offsetWidth;
    callEl.hidden = false;
    clearTimeout(callTimer);
    callTimer = window.setTimeout(() => (callEl.hidden = true), ms);
  };
  const pct = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
  const showResultBar = (shot: ShotResult) => {
    powerEl.hidden = false;
    powerEl.dataset.mode = "result";
    zoneEl.style.left = pct(shot.window.lo);
    zoneEl.style.width = pct(shot.window.hi - shot.window.lo);
    fillEl.style.width = pct(shot.power);
    markEl.style.left = pct(shot.power);
    const verdict = shot.lost === "time" ? "No shot" : powerVerdict(shot.power, shot.window);
    whoEl.textContent = shot.seat === info.seat ? "Your power: " : `${label(shot.seat)}: `;
    verdictEl.textContent = verdict;
    powerEl.dataset.verdict = verdict;
    powerBar.setAttribute("aria-valuenow", String(Math.round(shot.power * 100)));
    powerBar.setAttribute("aria-valuetext", `${Math.round(shot.power * 100)}%, ${verdict}`);
  };
  let endShownFor = -1;
  let endTimer = 0;
  const hideEnd = () => {
    endEl.hidden = true;
    view.classList.remove("show-end");
  };
  (view.querySelector("[data-action=end-ok]") as HTMLElement).addEventListener("click", hideEnd);
  const showEnd = (s: WithVote) => {
    const h2 = endEl.querySelector("h2") as HTMLElement;
    const score = endEl.querySelector(".bb-end-score") as HTMLElement;
    if (s.draw) {
      // both chose a draw at the tie vote
      h2.textContent = "Draw";
      score.textContent = `${s.totals[0]} all`;
    } else if (s.winner !== null) {
      const w = s.winner;
      const l: Seat = w === 0 ? 1 : 0;
      h2.textContent = w === info.seat ? "You win!" : `${label(w)} wins`;
      const decided = s.shots.some((x) => x.suddenDeath);
      score.textContent = `${s.totals[w]} to ${s.totals[l]}${decided ? ", won in sudden death" : ""}`;
    } else return;
    const lines = endEl.querySelector(".bb-end-lines") as HTMLElement;
    lines.replaceChildren();
    for (const seat of [0, 1] as const) {
      const li = document.createElement("li");
      li.style.setProperty("--seat", SEAT_CSS[seat]);
      const swishes = s.shots.filter((x) => x.seat === seat && x.swish && !x.suddenDeath).length;
      li.textContent = `${label(seat)}: ${s.totals[seat]} pts, ${s.makes[seat]} of ${s.attempts[seat]} made${swishes ? `, ${swishes} swish${swishes > 1 ? "es" : ""}` : ""}`;
      lines.append(li);
    }
    endEl.hidden = false;
    view.classList.add("show-end");
    clearTimeout(endTimer);
    endTimer = window.setTimeout(hideEnd, info.practice ? 3800 : 8000);
  };

  // ---- the HUD ----
  const shotMark = (x: ShotResult) => (x.lost === "time" ? "⏱" : x.swish ? "★" : x.made ? "●" : "○");
  const renderBoard = (s: WithVote) => {
    spotEl.textContent = spotLine(s, opts.local);
    bonusEl.textContent = bonusLine(s.spot, s.suddenDeath);
    for (const seat of [0, 1] as const) {
      const row = view.querySelector(`.bb-row[data-seat="${seat}"]`) as HTMLElement;
      row.style.setProperty("--seat", SEAT_CSS[seat]);
      row.dataset.turn = String(s.turn === seat && s.phase !== "over");
      (row.querySelector(".bb-name") as HTMLElement).textContent = label(seat);
      const shots = row.querySelector(".bb-shots") as HTMLElement;
      if (s.format === "unlimited") shots.textContent = `${s.makes[seat]}/${s.attempts[seat]}${s.longest[seat] ? ` · ${s.longest[seat]} m` : ""}`;
      else {
        const mine = s.shots.filter((x) => x.seat === seat && !x.suddenDeath);
        shots.textContent = SPOTS.map((_, i) => (mine[i] ? shotMark(mine[i]) : "·")).join(" ");
        shots.setAttribute("aria-label", `${mine.filter((x) => x.made).length} of ${mine.length} made`);
      }
      (row.querySelector(".bb-total") as HTMLElement).textContent = String(s.totals[seat]);
    }
  };

  const updateHud = () => {
    if (!snap) return;
    const s = snap;
    renderBoard(s);
    const l = lobby;
    view.dataset.phase = l?.phase ?? "";
    view.dataset.turn = myTurn() ? "mine" : "";
    view.dataset.set = String(s.set && s.phase === "aim");
    shootBtn.disabled = !myTurn() || shotSent;
    for (const b of view.querySelectorAll<HTMLButtonElement>("[data-aim]")) b.disabled = !myTurn() || shotSent;
    clockEl.hidden = !s.clockRunning;
    if (s.clockRunning) {
      const secs = Math.ceil(s.clockLeft / 60);
      clockEl.textContent = `${secs}`;
      clockEl.dataset.low = String(secs <= 5);
      clockEl.setAttribute("aria-label", `Shot clock ${secs} seconds`);
    }
    const playingNow = playing();
    hintEl.hidden = !(myTurn() && !shotSent);
    hintEl.textContent = shootCam.on() ? HINT : `${HINT} Keys: ←/→ or the mouse aim; hold Space or Shoot, let go in the green.`;
    if (l?.phase === "paused" && l.hold) {
      statusEl.textContent = `Paused: waiting for ${l.hold.seat === info.seat ? "you" : l.hold.name} to reconnect (${l.hold.seconds} s)`;
    } else if (l?.match && l.phase === "countdown") statusEl.textContent = `Back. Resuming in ${l.countdown ?? 0}…`;
    else if (s.phase === "over" && s.draw) statusEl.textContent = `Draw, ${s.totals[0]} all`;
    else if (s.phase === "tie-vote") statusEl.textContent = "Level after five spots";
    else if (s.phase === "over" && s.winner !== null) {
      const w = s.winner;
      const score = `${s.totals[w]} to ${s.totals[w === 0 ? 1 : 0]}`;
      statusEl.textContent = w === info.seat ? `You win, ${score}!` : `${label(w)} wins, ${score}`;
    } else if (l && !info.practice && !playingNow) statusEl.textContent = "";
    else if (l?.tally) statusEl.textContent = `Unlimited · best basket ${l.tally.bestRally} · ${s.turn === info.seat && s.phase === "aim" ? "Your shot" : `${label(s.turn)} shooting`}`;
    else if (s.phase === "aim" || s.phase === "flight") {
      if (info.seat === null) statusEl.textContent = `${label(s.turn)} shooting${s.set && s.phase === "aim" ? " · set" : ""}`;
      else statusEl.textContent = s.turn === info.seat ? (s.set && s.phase === "aim" ? "Your shot · set" : "Your shot") : "Their shot, watch";
    } else statusEl.textContent = "";
    statusEl.dataset.turn = s.turn === info.seat ? "mine" : "theirs";
  };

  // ---- messages ----
  // the ball between snapshots: from where it was drawn to the newest position, over one snapshot's gap
  let ballFrom: Vec3 | null = null;
  let ballTo: Vec3 | null = null;
  let ballAt = 0;
  let ballGap = 1000 / 30;
  let lastStateAt = 0;
  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as WithVote;
      const prev = snap;
      const now = performance.now();
      if (lastStateAt) ballGap = Math.min(120, Math.max(16, now - lastStateAt));
      lastStateAt = now;
      // a new turn: a fresh aim, nothing sent yet
      if (next.phase === "aim" && (!prev || prev.phase !== "aim" || prev.turn !== next.turn || prev.round !== next.round)) {
        aim = 0;
        lastSentAim = 0;
        setSent = false;
        shotSent = false;
        holdSince = null;
        held.clear();
        for (const seat of [0, 1] as const) shotStarted[seat] = null;
      }
      if (prev) {
        // the shooter released: their arms go up (mine already did when I let go)
        if (prev.phase === "aim" && next.phase === "flight" && shotStarted[next.turn] === null) shotStarted[next.turn] = now;
        // the ball touched the rim or the board
        if (next.phase === "flight") {
          if (next.contact.rim && !prev.contact.rim) sounds.clank();
          if (next.contact.board && !prev.contact.board) sounds.thud();
        }
        // a shot was decided: the call, the crowd, the bar
        if ((prev.phase === "aim" || prev.phase === "flight") && next.phase === "result" && next.last) {
          const c = shotCall(next.last);
          const who = next.last.seat === info.seat ? "" : `${label(next.last.seat)}: `;
          showCall(`${who}${c.text}`, c.detail, next.last.made ? (c.crowd === "big" ? "big" : "make") : "miss");
          canvas.dataset.call = c.text;
          court.react(c.crowd);
          canvas.dataset.crowd = c.crowd;
          if (next.last.made) sounds.swish();
          if (c.crowd === "groan") sounds.groan();
          else sounds.cheer(c.crowd === "big");
          showResultBar(next.last);
          canvas.dataset.shots = String(Number(canvas.dataset.shots ?? 0) + 1);
        }
        if (!prev.suddenDeath && next.suddenDeath) window.setTimeout(() => showCall("Sudden death!", "From the deep spot, one shot each", "sd", 2200), 900);
        if (prev.phase !== "over" && next.phase === "over" && endShownFor !== next.matches) {
          endShownFor = next.matches;
          showEnd(next);
        }
      }
      // the ball: interpolate from where it is drawn now to the newest position
      if (next.ball) {
        ballFrom = ballTo && prev?.ball ? currentBall(now) : { ...next.ball.pos };
        ballTo = { ...next.ball.pos };
        ballAt = now;
      } else {
        ballFrom = ballTo = null;
      }
      snap = next;
      tiePanel.update(next);
      canvas.dataset.phase = next.phase;
      canvas.dataset.turn = String(next.turn);
      canvas.dataset.spot = String(next.spot);
      canvas.dataset.round = String(next.round);
      canvas.dataset.set = String(next.set);
      canvas.dataset.totals = `${next.totals[0]},${next.totals[1]}`;
      canvas.dataset.matches = String(next.matches);
      canvas.dataset.suddenDeath = String(next.suddenDeath);
      shootCam.setTurn(myTurn());
      updateHud();
    } else if (msg.t === "presence") {
      names = msg.names;
      updateHud();
    } else if (msg.t === "lobby") {
      const { t: _t, ...v } = msg;
      lobby = v;
      looks = [v.seats[0]?.look ?? DEFAULT_LOOKS[0], v.seats[1]?.look ?? DEFAULT_LOOKS[1]];
      readyPanel.update(v);
      if (snap) shootCam.setTurn(myTurn());
      updateHud();
    }
  });
  const currentBall = (now: number): Vec3 | null => {
    if (!ballTo) return null;
    if (!ballFrom) return ballTo;
    const k = Math.min(1, (now - ballAt) / ballGap);
    return lerp3(ballFrom, ballTo, k);
  };

  view.querySelector("[data-action=leave]")?.addEventListener("click", onLeave);
  // task 24: the watch link for players; the Watching badge and count for spectators
  const disposeSpectating = opts.local ? () => {} : addSpectating(view, conn, info);
  view.querySelector("[data-action=copy]")?.addEventListener("click", (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    navigator.clipboard
      ?.writeText(`${location.origin}/#/room/${info.room}`)
      .then(() => (button.textContent = "Copied"))
      .catch(() => (button.textContent = "Copy failed"));
  });
  (view.querySelector(".controls") as HTMLElement).hidden = info.seat === null;

  // ---- the frame ----
  const look = new Vector3();
  const placeCamera = (s: WithVote) => {
    const p = spotPosition(s.spot);
    const d = Math.hypot(p.x, p.z) || 1;
    const ox = p.x / d;
    const oz = p.z / d;
    const portrait = camera.aspect < 0.8;
    // the shooter's right, as they face the hoop
    const rx = oz;
    const rz = -ox;
    if (info.seat !== null) {
      // behind the shooter, above and a little over the right shoulder, looking
      // down the line to the hoop so the floor arrow shows past the shooter; a
      // phone stands further back with a wider lens
      const back = portrait ? 4.4 : 3.4;
      const side = portrait ? 0.35 : 0.7;
      camera.fov = portrait ? 66 : 50;
      camera.position.set(p.x + ox * back + rx * side, portrait ? 4.1 : 3.6, p.z + oz * back + rz * side);
      look.set(0, portrait ? 1.5 : 1.8, 0);
    } else if (!portrait) {
      // side-on: square to the line from the spot to the hoop, from the
      // shooter's left, the hoop on the left of the screen and the shooter on
      // the right; kept inside the bleachers (they start 9.1 m out)
      const mid = { x: p.x / 2, z: p.z / 2 };
      const away = Math.min(8.4, 5.5 + d * 0.4);
      camera.fov = 48;
      camera.position.set(mid.x - rx * away, 4.2, mid.z - rz * away);
      look.set(mid.x, 2, mid.z);
    } else {
      // a tall phone can't fit the line side-on: high, off to the shooter's
      // left and behind them, so the shooter and the whole board both fit
      camera.fov = 66;
      camera.position.set(p.x + ox * (4 + d * 0.3) - rx * 4.5, 7, p.z + oz * (4 + d * 0.3) - rz * 4.5);
      look.set(p.x * 0.5, 2, p.z * 0.5);
    }
    camera.updateProjectionMatrix();
    camera.lookAt(look);
  };

  let frames = 0;
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = snap;
    if (s) {
      // keys and aim buttons: aim turns while held
      if (myTurn() && !shotSent && !shootCam.on() && aimHeld.size > 0) {
        let dir = 0;
        for (const h of aimHeld.values()) {
          dir += h.dir;
          h.applied += KEY_AIM_RATE * dt;
        }
        if (dir) setAim(aim + dir * KEY_AIM_RATE * dt);
      }
      flushAim(now);

      // the live power bar while held
      if (holdSince !== null && myTurn()) {
        const p = heldPower((now - holdSince) / 1000);
        powerEl.hidden = false;
        powerEl.dataset.mode = "live";
        zoneEl.style.left = pct(s.window.lo);
        zoneEl.style.width = pct(s.window.hi - s.window.lo);
        fillEl.style.width = pct(p);
        markEl.style.left = pct(p);
        whoEl.textContent = "Let go in the green";
        verdictEl.textContent = "";
        powerEl.dataset.verdict = "";
        powerBar.setAttribute("aria-valuenow", String(Math.round(p * 100)));
        powerBar.setAttribute("aria-valuetext", `${Math.round(p * 100)}%`);
        canvas.dataset.power = p.toFixed(2);
      } else if (powerEl.dataset.mode === "live") {
        powerEl.dataset.mode = "off";
        powerEl.hidden = true;
      }

      // the two players: the shooter at the spot, the other beside them
      const p = spotPosition(s.spot);
      const d = Math.hypot(p.x, p.z) || 1;
      const facing = Math.atan2(p.x, p.z);
      for (const seat of [0, 1] as const) {
        const sh = shooters[seat];
        sh.setLook(looks[seat]);
        const shooting = s.turn === seat && s.phase !== "over";
        if (shooting) sh.group.position.set(p.x, 0, p.z);
        else {
          // to the shooter's left and a step towards the hoop, clear of the player camera's line
          const lx = (-p.z / d) * WAITING_SIDE - (p.x / d) * 1.2;
          const lz = (p.x / d) * WAITING_SIDE - (p.z / d) * 1.2;
          sh.group.position.set(p.x + lx, 0, p.z + lz);
        }
        sh.group.rotation.y = facing;
        const started = shotStarted[seat];
        const holding = shooting && s.phase === "aim" && started === null;
        const pose =
          started !== null && shooting
            ? shotPose("shoot", (now - started) / 1000)
            : holding
              ? shotPose("hold", 0, seat === info.seat && holdSince !== null ? heldPower((now - holdSince) / 1000) : 0)
              : shotPose("relaxed");
        const glow = holding && s.set ? 0.6 + 0.4 * Math.sin(now / 180) : 0;
        sh.update(pose, glow, dt);
        if (seat === s.turn) {
          // the ball: in the hands until it leaves them, then where the server says
          const flying = currentBall(now);
          if (flying) ball.position.set(flying.x, flying.y, flying.z);
          else if (pose.ball && shooting) {
            const c = Math.cos(facing);
            const sn = Math.sin(facing);
            // the pose's frame: z towards the hoop is the character's -z, turned by `facing`
            ball.position.set(p.x + pose.ball.x * c - pose.ball.z * sn, pose.ball.y, p.z - pose.ball.x * sn - pose.ball.z * c);
          }
          ball.visible = flying !== null || (pose.ball !== null && shooting);
          if (flying) ball.rotation.x -= dt * 9;
        }
      }
      ballShadow.visible = ball.visible;
      ballShadow.position.set(ball.position.x, 0.015, ball.position.z);
      canvas.dataset.ball = ball.visible ? `${ball.position.x.toFixed(2)},${ball.position.y.toFixed(2)},${ball.position.z.toFixed(2)}` : "";

      // the floor arrow: the shooter's aim (mine as I move it, theirs as sent)
      const shownAim = myTurn() ? aim : s.aim[s.turn];
      arrow.visible = s.phase === "aim" && playing();
      arrow.position.set(p.x - (p.x / d) * 0.7, 0, p.z - (p.z / d) * 0.7);
      // the arrow's own length reaches most of the way to the rim; it turns by the sim's yaw for this aim
      const reach = Math.max(1, d - 1.6);
      arrowMesh.scale.set(1, reach / 1.4, 1);
      // the group's -z points at the hoop at `facing`; a + turn swings it to the shooter's left, so aim right is a - turn
      arrow.rotation.y = facing - shownAim * AIM_YAW;
      arrowMat.color.setHex(s.turn === info.seat ? 0xffd23f : s.turn === 0 ? 0x5aa9ff : 0xff6b5e);
      canvas.dataset.aim = shownAim.toFixed(2);

      placeCamera(s);
      court.update(now / 1000);
    }
    renderer.render(scene, camera);
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  // Webcam by default (task 15): a seated player gets the camera setup first,
  // with "Use keyboard instead" (shoot-camera.ts); a spectator never does.
  if (info.seat !== null) cameraButton.click();

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    clearTimeout(endTimer);
    clearInterval(camTimer);
    readyPanel.dispose();
    unsubscribe();
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    shootCam.dispose();
    tiePanel.dispose();
    sounds.dispose();
    disposeSpectating();
    observer.disconnect();
    renderer.dispose();
  };
}
