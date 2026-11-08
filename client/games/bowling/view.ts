import { addSpectating } from "../../ui/spectate.ts";
import { FRAMES, HEAD_PIN_Y, startX, speedZone } from "../../../shared/games/bowling/sim.ts";
import type { BallResult, BowlingSnapshot, Card, Seat, Vote } from "../../../shared/games/bowling/sim.ts";
import { DEFAULT_LOOKS } from "../../../shared/look.ts";
import type { Look } from "../../../shared/look.ts";
import type { LobbyView, RoomFormat, RoomInfo, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { createReadyPanel } from "../tennis/ready-panel.ts";
import { createBowlCamera } from "./bowl-camera.ts";
import { arrowPoints, callFor, curveWords, meterAt, reactionFor, speedRead } from "./calls.ts";
import { createBowlingScene } from "./scene.ts";
import type { BowlView, PinView } from "./scene.ts";
import { bowlingCues, newResult } from "./sound.ts";
import { audioEngine, gameSounds, mountSoundToggle } from "../../audio/index.ts";
import type { CrowdContext } from "../../audio/crowd.ts";
import "./bowling.css";

// The bowling view (task 29, ADR 004): the alley (scene.ts) behind the
// bowler, the frame scoreboard, the guide arrow, the power meter, the
// after-ball read and the call. Left/Right move the start spot, Up/Down set
// the curve, hold Space (or the Bowl button) and the meter fills and falls;
// letting go throws. The client only says what the player did: "aiming
// here", "threw this fast, from here, with this curve". The server rolls the
// ball and knocks the pins; this only draws what it says.

const FORMATS: readonly RoomFormat[] = ["game", "unlimited"];
const SEAT_CSS = ["#2f7fe0", "#e0453a"] as const;
/** Start spot: per second while held, and one tap's step. */
const AIM_RATE = 0.8;
const AIM_TAP = 0.05;
/** Curve: one press's step. */
const SPIN_STEP = 0.2;
/** Aim messages at most this often (about 10 a second), and only on a change. */
const AIM_SEND_MS = 100;
/** The bowler's forward swing after the release, seconds. */
const SWING_S = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clock = (ticks: number) => `0:${String(Math.max(0, Math.ceil(ticks / 60))).padStart(2, "0")}`;

export interface BowlingViewOptions {
  local?: boolean;
  leaveLabel?: string;
  /** Task 38: practice's "Just me": one bowler, no second row, no one waiting. */
  solo?: () => boolean;
  /** Task 38: practice's own head line ("Just me · reset pins"), or null for the frame. */
  head?: () => string | null;
  /** Task 38: practice puts its panel in the view. */
  onView?(view: HTMLElement): void;
}

export function startBowling(root: HTMLElement, conn: GameLink, info: RoomInfo, onLeave: () => void, opts: BowlingViewOptions = {}): () => void {
  const view = document.createElement("div");
  view.className = "game bowling";
  view.innerHTML = `
    <canvas aria-label="Bowling alley"></canvas>
    <div class="hud">
      <div class="bw-board" aria-label="Scoreboard">
        <div class="bw-head"></div>
        <table class="bw-card"><tbody>
          <tr data-seat="0"></tr>
          <tr data-seat="1"></tr>
        </tbody></table>
      </div>
      <div class="hud-tools">
        <span class="muted code"></span>
        <span class="tracking" role="status" hidden></span>
        <button data-action="camera" hidden>Camera</button>
        <button data-action="copy">Copy invite</button>
        <button data-action="leave">Leave</button>
      </div>
      <div class="status" role="status"></div>
    </div>
    <div class="bw-call" aria-live="polite" hidden></div>
    <section class="bw-panel bw-vote" aria-label="Tie vote" hidden>
      <h2>Level! Draw, or play a tie frame?</h2>
      <p class="bw-vote-clock"></p>
      <div class="row bw-vote-buttons">
        <button type="button" data-vote="draw" aria-label="Draw (D)">Draw</button>
        <button type="button" class="primary" data-vote="continue" aria-label="Continue, play a tie frame (C)">Continue</button>
      </div>
      <p class="bw-vote-state" aria-live="polite"></p>
    </section>
    <section class="bw-panel bw-end" aria-label="Result" hidden>
      <h2 class="bw-end-title"></h2>
      <p class="bw-end-score"></p>
      <p class="bw-end-next muted"></p>
    </section>
    <div class="bw-read" role="status" hidden>
      <div class="bw-read-speed"><span class="bw-read-label"></span><span class="bw-read-bar"><i class="bw-read-zone"></i><b class="bw-read-mark"></b></span></div>
      <div class="bw-read-curve"></div>
    </div>
    <div class="bw-aim" hidden>
      <span class="bw-aim-curve"></span>
      <span class="bw-aim-keys muted">←/→ start · ↑/↓ curve · hold Space</span>
    </div>
    <div class="bw-meter" aria-hidden="true" hidden><i class="bw-meter-zone"></i><span></span></div>
    <div class="controls bw-controls" hidden>
      <button type="button" data-aim="-1" aria-label="Start spot left (Left arrow)">◀</button>
      <button type="button" data-aim="1" aria-label="Start spot right (Right arrow)">▶</button>
      <button type="button" data-spin="-1" aria-label="Curve left (Down arrow)">Curve ◀</button>
      <button type="button" data-spin="1" aria-label="Curve right (Up arrow)">Curve ▶</button>
      <button type="button" class="primary bw-bowl" aria-label="Hold to bowl, release to throw (Space)">Bowl</button>
    </div>
  `;
  root.replaceChildren(view);
  opts.onView?.(view);
  if (opts.local) {
    view.classList.add("local");
    for (const el of view.querySelectorAll<HTMLElement>(".code, [data-action=copy]")) el.hidden = true;
  }
  if (opts.leaveLabel) (view.querySelector("[data-action=leave]") as HTMLElement).textContent = opts.leaveLabel;

  const $ = <T extends HTMLElement>(sel: string) => view.querySelector(sel) as T;
  const canvas = $<HTMLCanvasElement>("canvas");
  const statusEl = $(".status");
  const callEl = $(".bw-call");
  const voteEl = $(".bw-vote");
  const endEl = $(".bw-end");
  const readEl = $(".bw-read");
  const aimEl = $(".bw-aim");
  const meterEl = $(".bw-meter");
  const controls = $(".bw-controls");
  $(".code").textContent = `Room ${info.room}`;
  canvas.dataset.frames = "0";
  canvas.dataset.thrown = "0";

  let snap: BowlingSnapshot | null = null;
  // the snapshot before, and when each arrived, to draw the ball and pins between them
  let prevSnap: BowlingSnapshot | null = null;
  let snapAt = 0;
  let snapGap = 1000 / 30;
  let names: [string | null, string | null] = [null, null];
  let lobby: LobbyView | null = null;
  let looks: [Look, Look] = [DEFAULT_LOOKS[0], DEFAULT_LOOKS[1]];
  const label = (seat: Seat) => (seat === info.seat ? "You" : (names[seat] ?? `Player ${seat + 1}`));
  const playing = () => !lobby || info.practice || lobby.phase === "playing";
  const myTurn = () => snap !== null && info.seat !== null && snap.phase === "aim" && snap.turn === info.seat && playing();

  // ---- the bowler's own aim, curve and meter ----
  let aim = 0;
  let spin = 0;
  let holdSince: number | null = null;
  let lastAimSent = 0;
  let sentAim: number | null = null;
  // a throw sent for this ball (one a ball; the server drops a second anyway)
  let thrownFor = "";
  const ballKey = (s: BowlingSnapshot) => `${s.matches}:${s.frame}:${s.ball}:${s.turn}`;

  const sendAim = (force = false) => {
    const now = performance.now();
    if (!myTurn() || aim === sentAim) return;
    if (!force && now - lastAimSent < AIM_SEND_MS) return;
    lastAimSent = now;
    sentAim = aim;
    conn.send({ t: "aim", aim });
  };
  const setAim = (a: number) => {
    aim = clamp(a, -1, 1);
    canvas.dataset.aim = aim.toFixed(2);
    sendAim();
  };
  const setSpin = (s: number) => {
    spin = clamp(Math.round(s * 10) / 10, -1, 1);
    canvas.dataset.spin = spin.toFixed(1);
    renderAim();
  };
  let swingStart: number | null = null;
  const doThrow = (speed: number, a: number, sp: number) => {
    if (!myTurn() || !snap || thrownFor === ballKey(snap)) return false;
    thrownFor = ballKey(snap);
    conn.send({ t: "throw", speed: clamp(speed, 0.05, 1), aim: clamp(a, -1, 1), spin: clamp(sp, -1, 1), at: performance.now() });
    canvas.dataset.thrown = String(Number(canvas.dataset.thrown) + 1);
    swingStart = performance.now();
    sounds.play([{ loop: "roll", v: 0 }]);
    return true;
  };
  const startHold = () => {
    if (!myTurn() || bowlCam.on() || holdSince !== null) return;
    holdSince = performance.now();
  };
  const endHold = (throwIt: boolean) => {
    if (holdSince === null) return;
    const speed = meterAt((performance.now() - holdSince) / 1000);
    holdSince = null;
    if (throwIt) {
      // the last aim goes first, so the opponent's arrow ends where the ball starts
      sendAim(true);
      doThrow(speed, aim, spin);
    }
  };

  // keys: arrows aim and curve, Space bowls, D and C vote
  // per held direction: when it went down and how far it has moved the spot since,
  // so the spot moves by the real time held whatever the frame rate
  const aimHeld = new Map<-1 | 1, { since: number; applied: number }>();
  const pressAim = (dir: -1 | 1) => {
    if (aimHeld.has(dir)) return;
    aimHeld.set(dir, { since: performance.now(), applied: 0 });
    setAim(aim + dir * AIM_TAP);
  };
  /** Moves the spot by the time held not yet applied. */
  const slideAim = (now: number) => {
    if (!myTurn() || bowlCam.on()) return;
    for (const [dir, h] of aimHeld) {
      const due = ((now - h.since) / 1000) * AIM_RATE;
      if (due > h.applied) {
        setAim(aim + dir * (due - h.applied));
        h.applied = due;
      }
    }
  };
  const releaseAim = (dir: -1 | 1) => {
    slideAim(performance.now());
    aimHeld.delete(dir);
    sendAim(true);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space" && e.target instanceof HTMLButtonElement && !e.target.closest(".bowling")) return;
    if (e.code === "KeyD" || e.code === "KeyC") {
      if (snap?.phase === "tie-vote") vote(e.code === "KeyD" ? "draw" : "continue");
      return;
    }
    const dir = e.code === "ArrowLeft" ? -1 : e.code === "ArrowRight" ? 1 : 0;
    if (dir) {
      e.preventDefault();
      if (e.repeat || !myTurn() || bowlCam.on()) return;
      pressAim(dir);
      return;
    }
    if (e.code === "ArrowUp" || e.code === "ArrowDown") {
      e.preventDefault();
      if (myTurn()) setSpin(spin + (e.code === "ArrowUp" ? SPIN_STEP : -SPIN_STEP));
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) startHold();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowLeft") releaseAim(-1);
    else if (e.code === "ArrowRight") releaseAim(1);
    else if (e.code === "Space") endHold(true);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // buttons: hold ◀ ▶ to slide the start, tap the curve, hold Bowl
  for (const b of controls.querySelectorAll<HTMLButtonElement>("button")) {
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    const a = b.dataset.aim ? (Number(b.dataset.aim) as -1 | 1) : null;
    const sp = b.dataset.spin ? Number(b.dataset.spin) : null;
    const bowl = b.classList.contains("bw-bowl");
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (!myTurn()) return;
      b.setPointerCapture?.(e.pointerId);
      if (a !== null && !bowlCam.on()) pressAim(a);
      else if (sp !== null) setSpin(spin + sp * SPIN_STEP);
      else if (bowl) startHold();
    });
    const up = (throwIt: boolean) => () => {
      if (a !== null && aimHeld.has(a)) releaseAim(a);
      if (bowl) endHold(throwIt);
    };
    b.addEventListener("pointerup", up(true));
    b.addEventListener("pointercancel", up(false));
  }

  // the tie vote: one choice each, the server keeps it
  let myVote: Vote | null = null;
  const vote = (choice: Vote) => {
    if (info.seat === null || snap?.phase !== "tie-vote" || myVote !== null || snap.vote?.votes[info.seat]) return;
    myVote = choice;
    conn.send({ t: "tie", choice });
    renderVote();
  };
  for (const b of voteEl.querySelectorAll<HTMLButtonElement>("[data-vote]")) b.addEventListener("click", () => vote(b.dataset.vote as Vote));
  if (info.seat === null) ($(".bw-vote-buttons")).hidden = true;

  // ---- the camera (task 29 part 3): the same aim and throw as the keys ----
  const cameraButton = $<HTMLButtonElement>("[data-action=camera]");
  cameraButton.hidden = info.seat === null;
  const bowlCam = createBowlCamera(view, cameraButton, $(".tracking"), {
    aim: (a) => {
      if (myTurn()) setAim(a);
    },
    throw: (speed, a, sp) => {
      if (!myTurn()) return;
      setAim(a);
      setSpin(sp);
      sendAim(true);
      doThrow(speed, a, sp);
    },
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
      openCamera: () => cameraButton.click(),
    },
    FORMATS,
  );
  readyPanel.camera("off");
  const camTimer = window.setInterval(() => readyPanel.camera(bowlCam.state()), 500);

  // task 19: sound through the shared module; a few onlookers, quiet applause
  const sounds = gameSounds();
  const crowdCtx: CrowdContext = { viewer: info.seat, stands: "onlookers", practice: info.practice };
  const leaveBtn = view.querySelector("[data-action=leave]") as HTMLElement;
  const disposeToggle = mountSoundToggle(audioEngine(), leaveBtn.parentElement as HTMLElement, leaveBtn);
  const bowlScene = createBowlingScene(canvas);

  // ---- the HUD ----
  let callTimer = 0;
  const call = (text: string, kind: string, ms = 1600) => {
    callEl.textContent = text;
    callEl.dataset.kind = kind;
    callEl.hidden = true;
    void callEl.offsetWidth;
    callEl.hidden = false;
    clearTimeout(callTimer);
    callTimer = window.setTimeout(() => (callEl.hidden = true), ms);
  };

  const cell = (text: string, cls: string) => `<td class="${cls}">${text}</td>`;
  const frameCell = (c: Card, f: number, current: boolean) => {
    const fr = c.frames[f];
    const last = f === FRAMES - 1;
    const slots = last ? 3 : 2;
    // a strike in a regular frame is written in the second box, as on a scoresheet
    const marks = !last && fr.marks[0] === "X" ? ["", "X"] : [...fr.marks];
    while (marks.length < slots) marks.push("");
    return `<td class="bw-frame${current ? " is-current" : ""}"><span class="bw-marks">${marks.map((m) => `<i>${m}</i>`).join("")}</span><b>${fr.score ?? ""}</b></td>`;
  };
  const renderBoard = (s: BowlingSnapshot) => {
    const solo = !!opts.solo?.();
    const head = solo ? "Just me" : opts.local ? "Practice" : s.format === "unlimited" ? `Unlimited · game ${s.matches + 1}` : "Five frames";
    const where = s.tieFrame > 0 ? `tie frame ${s.tieFrame}` : `frame ${Math.min(s.frame, FRAMES - 1) + 1} of ${FRAMES}`;
    const own = opts.head?.() ?? null;
    $(".bw-head").innerHTML = `<span>${own ?? `${head} · ${where}`}</span>${s.clock !== null ? `<span class="bw-clock" data-low="${s.clock <= 5 * 60}">${clock(s.clock)}</span>` : ""}`;
    const showTie = s.tieFrame > 0 || s.cards.some((c) => c.tie.length > 0);
    for (const seat of [0, 1] as const) {
      const row = view.querySelector(`.bw-card tr[data-seat="${seat}"]`) as HTMLElement;
      row.hidden = seat === 1 && solo;
      const c = s.cards[seat];
      row.style.setProperty("--seat", SEAT_CSS[seat]);
      row.dataset.turn = String(s.turn === seat && s.phase !== "over" && s.phase !== "tie-vote");
      let html = cell(label(seat), "bw-name");
      for (let f = 0; f < FRAMES; f++) html += frameCell(c, f, s.tieFrame === 0 && s.frame === f && s.turn === seat && s.phase !== "over");
      if (showTie) html += cell(c.tie.join(" ") || "–", "bw-tie");
      html += cell(String(c.total), "bw-total");
      row.innerHTML = html;
    }
    const hasTie = view.querySelector(".bw-card") as HTMLElement;
    hasTie.dataset.tie = String(showTie);
  };

  const renderRead = (r: BallResult | null) => {
    if (!r || !r.read) {
      readEl.hidden = true;
      return;
    }
    const sr = speedRead(r.read);
    readEl.hidden = false;
    readEl.dataset.verdict = sr.verdict ?? "none";
    const zoneText = sr.zone ? ` · good ${sr.zone.min.toFixed(1)}–${sr.zone.max.toFixed(1)}${sr.verdict === "good" ? " ✓" : sr.verdict === "slow" ? ", too slow" : ", too fast"}` : "";
    $(".bw-read-label").textContent = `Speed ${sr.ms.toFixed(1)} m/s${zoneText}`;
    const scale = (ms: number) => `${clamp(((ms - 2) / 8) * 100, 0, 100).toFixed(1)}%`;
    const zone = $(".bw-read-zone");
    zone.hidden = sr.zone === null;
    if (sr.zone) {
      zone.style.left = scale(sr.zone.min);
      zone.style.width = `calc(${scale(sr.zone.max)} - ${scale(sr.zone.min)})`;
    }
    $(".bw-read-mark").style.left = scale(sr.ms);
    $(".bw-read-curve").textContent = `Curve: ${curveWords(r.read.spin)}`;
  };

  const renderAim = () => {
    $(".bw-aim-curve").textContent = `Curve: ${curveWords(spin)}`;
    const z = speedZone(spin);
    const zoneEl = $(".bw-meter-zone");
    zoneEl.hidden = z === null;
    if (z) {
      zoneEl.style.left = `${(z.min * 100).toFixed(1)}%`;
      zoneEl.style.width = `${((z.max - z.min) * 100).toFixed(1)}%`;
    }
  };

  const renderVote = () => {
    const s = snap;
    voteEl.hidden = !s || s.phase !== "tie-vote" || !s.vote;
    if (!s?.vote) return;
    $(".bw-vote-clock").textContent = `${Math.ceil(s.vote.ticksLeft / 60)} s to choose · no choice is a draw`;
    const mine = info.seat !== null ? (s.vote.votes[info.seat] ?? myVote) : null;
    for (const b of voteEl.querySelectorAll<HTMLButtonElement>("[data-vote]")) {
      b.disabled = mine !== null;
      b.setAttribute("aria-pressed", String(mine === b.dataset.vote));
    }
    const words = (v: Vote | null) => (v === "draw" ? "draw" : v === "continue" ? "play on" : "deciding…");
    const lines: string[] = [];
    for (const seat of [0, 1] as const) {
      const v = seat === info.seat ? mine : s.vote.votes[seat];
      lines.push(`${label(seat)}: ${words(v)}`);
    }
    $(".bw-vote-state").textContent = lines.join(" · ");
  };

  const renderEnd = (s: BowlingSnapshot) => {
    // a room goes back to its ready panel at once: the result stays in the status line instead
    const show = s.phase === "over" && !(lobby && !info.practice && lobby.phase !== "playing");
    endEl.hidden = !show;
    if (s.phase !== "over") return;
    const t = [s.cards[0].total, s.cards[1].total];
    if (opts.solo?.()) {
      $(".bw-end-title").textContent = "Game over";
      $(".bw-end-score").textContent = `You scored ${t[0]}${s.best[0] ? ` · best ${s.best[0]}` : ""}`;
      $(".bw-end-next").textContent = "Next game in a moment…";
      return;
    }
    const title = s.draw ? "Draw" : s.winner === info.seat ? "You win!" : `${label(s.winner ?? 0)} wins`;
    $(".bw-end-title").textContent = title;
    $(".bw-end-score").textContent = `${label(0)} ${t[0]} · ${label(1)} ${t[1]}`;
    $(".bw-end-next").textContent = s.endless ? "Next game in a moment…" : "";
  };

  const updateHud = () => {
    if (!snap) return;
    const s = snap;
    renderBoard(s);
    renderVote();
    renderEnd(s);
    const l = lobby;
    const mine = myTurn();
    view.dataset.turn = mine ? "mine" : "";
    view.dataset.phase = s.phase;
    bowlCam.setTurn(mine);
    for (const b of controls.querySelectorAll<HTMLButtonElement>("button")) b.disabled = !mine;
    aimEl.hidden = meterEl.hidden = !mine;
    const result = () => {
      const t = [s.cards[0].total, s.cards[1].total];
      if (opts.solo?.()) return `Game over: ${t[0]}`;
      if (s.draw) return `A draw, ${t[0]} all.`;
      const w = (s.winner ?? 0) as Seat;
      return w === info.seat ? `You win, ${t[w]} to ${t[w === 0 ? 1 : 0]}!` : `${label(w)} wins, ${t[w]} to ${t[w === 0 ? 1 : 0]}.`;
    };
    if (l?.phase === "paused" && l.hold) statusEl.textContent = `Paused: waiting for ${l.hold.seat === info.seat ? "you" : l.hold.name} to reconnect (${l.hold.seconds} s)`;
    else if (l?.match && l.phase === "countdown") statusEl.textContent = `Back. Resuming in ${l.countdown ?? 0}…`;
    else if (s.phase === "over") statusEl.textContent = result();
    else if (l && !info.practice && l.phase !== "playing") statusEl.textContent = "";
    else if (s.phase === "tie-vote") statusEl.textContent = "Level!";
    else if (info.seat === null) statusEl.textContent = `${label(s.turn)} to bowl`;
    else statusEl.textContent = s.turn === info.seat ? "Your turn" : "Their turn, watch";
    if (l?.tally && s.phase !== "over") statusEl.textContent += ` · games won ${l.tally.points[0]}–${l.tally.points[1]} · best ${l.tally.bestRally}`;
  };

  const unsubscribe = conn.on((msg: ServerMsg) => {
    if (msg.t === "state") {
      const next = msg.state as BowlingSnapshot;
      const prev = snap;
      const now = performance.now();
      if (prev) snapGap = snapGap * 0.8 + clamp(now - snapAt, 10, 200) * 0.2;
      snapAt = now;
      prevSnap = prev;
      snap = next;
      // a new ball of mine: a fresh hold, the aim where it was
      if (next.phase === "aim" && (prev?.phase !== "aim" || (prev && ballKey(prev) !== ballKey(next)))) {
        holdSince = null;
        sentAim = null;
        for (const h of aimHeld.values()) {
          h.since = now;
          h.applied = 0;
        }
        if (next.turn === info.seat) sendAim(true);
        swingStart = null;
      }
      if (prev?.phase === "aim" && next.phase === "roll") swingStart ??= now;
      if (next.phase !== "tie-vote") myVote = null;
      // task 19: the roll, the pins, the gutter and the onlookers, from the snapshots (sound.ts)
      sounds.play(bowlingCues(prev, next, crowdCtx));
      // after a ball: the call, the read and the crowd
      const r = prev ? newResult(prev, next) : null;
      if (r) {
        const text = callFor(r);
        call(text, r.strike ? "strike" : r.spare ? "spare" : r.gutter && r.pins === 0 ? "gutter" : "pins");
        canvas.dataset.call = text;
        const react = reactionFor(r);
        if (react) bowlScene.react(react);
        renderRead(r);
      }
      if (next.phase === "roll") readEl.hidden = true;
      if (prev && prev.phase !== "over" && next.phase === "over") call(opts.solo?.() ? `Game: ${next.cards[0].total}` : next.draw ? "Draw" : next.winner === info.seat ? "You win!" : `${label((next.winner ?? 0) as Seat)} wins`, "end", 2200);
      canvas.dataset.phase = next.phase;
      canvas.dataset.turn = String(next.turn);
      canvas.dataset.frame = String(next.frame);
      canvas.dataset.matches = String(next.matches);
      canvas.dataset.totals = `${next.cards[0].total},${next.cards[1].total}`;
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
  controls.hidden = info.seat === null;
  setSpin(0);
  setAim(0);

  // ---- drawing, from the last two snapshots each frame ----
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const buildView = (now: number): BowlView | null => {
    const s = snap;
    if (!s) return null;
    const p = prevSnap;
    const t = clamp((now - snapAt) / snapGap, 0, 1);
    const ball = s.bowl && p?.bowl ? { x: lerp(p.bowl.x, s.bowl.x, t), y: lerp(p.bowl.y, s.bowl.y, t), gutter: s.bowl.gutter } : s.bowl;
    const pins: PinView[] = s.pins.map((pin, i) => {
      const q = p?.pins[i];
      return q && !pin.cleared && !q.cleared ? { ...pin, x: lerp(q.x, pin.x, t), y: lerp(q.y, pin.y, t) } : pin;
    });
    const mine = myTurn();
    const shownAim = mine ? aim : s.aims[s.turn];
    const holding = s.phase === "aim";
    const back = mine && holdSince !== null ? 0.4 + 0.6 * meterAt((now - holdSince) / 1000) : 0;
    const swing = swingStart !== null && !holding ? (now - swingStart) / 1000 / SWING_S : null;
    let shot: BowlView["shot"] = "aim";
    if (s.phase === "roll") shot = ball && ball.y < HEAD_PIN_Y - 3.5 ? "follow" : "deck";
    else if (s.phase === "result") shot = "deck";
    const a = s.phase === "aim" ? arrowPoints(shownAim, mine ? spin : 0) : [];
    const other = s.turn === 0 ? 1 : 0;
    return {
      spectator: info.seat === null,
      bowler: { seat: s.turn, look: looks[s.turn], x: startX(s.phase === "aim" ? shownAim : (s.thrown?.aim ?? shownAim)), back, swing, holding },
      waiting: opts.solo?.() ? null : { seat: other, look: looks[other] },
      ball,
      pins,
      arrow: a.length > 1 ? { from: a[0], to: a.at(-1)! } : null,
      path: s.path,
      shot,
    };
  };

  let frames = 0;
  let raf = 0;
  let last = performance.now();
  const meterBar = meterEl.querySelector("span") as HTMLElement;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    slideAim(now);
    const m = holdSince !== null ? meterAt((now - holdSince) / 1000) : 0;
    meterBar.style.width = `${(m * 100).toFixed(1)}%`;
    canvas.dataset.meter = m.toFixed(2);
    const v = buildView(now);
    if (v) {
      bowlScene.render(v, dt);
      canvas.dataset.shot = v.shot;
      canvas.dataset.arrow = v.arrow ? `${v.arrow.from.x.toFixed(3)},${v.arrow.to.y.toFixed(2)}` : "";
    }
    canvas.dataset.frames = String(++frames);
  };
  raf = requestAnimationFrame(frame);

  // Webcam by default (task 15): a seated player gets the camera setup first;
  // its "Use keyboard instead", Escape or a refused permission leave a game on keys
  if (info.seat !== null) cameraButton.click();

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(callTimer);
    clearInterval(camTimer);
    readyPanel.dispose();
    unsubscribe();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    bowlCam.dispose();
    disposeSpectating();
    sounds.dispose();
    disposeToggle();
    bowlScene.dispose();
  };
}
