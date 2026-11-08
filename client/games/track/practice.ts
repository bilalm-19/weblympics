import type { ClientMsg, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { createPracticePanel } from "../practice-panel.ts";
import { PracticeSim } from "./practice-sim.ts";
import { startTrack } from "./view.ts";

// Track practice (task 26): the track view on a PracticeSim in the page, like
// archery's practice. Nothing goes over the network. Task 38: it opens on
// "Just me" (your lane alone, race after race, your time and best); the
// panel's "vs Bot" brings the pacer back, any time.

const TICK_MS = 1000 / 60;

const fmt = (t: number | null) => (t === null ? "–" : `${t.toFixed(2)} s`);

class PracticeLink implements GameLink {
  private handlers = new Set<(msg: ServerMsg) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  readonly sim: PracticeSim;
  onState: () => void = () => {};

  constructor(sim: PracticeSim) {
    this.sim = sim;
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    if (msg.t === "step") this.sim.step(msg.side, msg.at);
    else if (msg.t === "jump") this.sim.jump(msg.at);
    else if (msg.t === "event") {
      this.sim.setEvent(msg.event);
      this.emitState();
    } else if (msg.t === "pause") this.sim.paused = msg.paused;
    else if (msg.t === "leave") this.stop();
  }

  private emit(msg: ServerMsg): void {
    for (const h of this.handlers) h(msg);
  }

  presence(): void {
    this.emit({ t: "presence", names: ["You", this.sim.mode === "bot" ? "Pacer" : null], spectators: 0 });
  }

  emitState(): void {
    this.emit({ t: "state", state: this.sim.snapshot() });
    this.onState();
  }

  start(): void {
    this.presence();
    this.emitState();
    const startedAt = performance.now();
    let done = 0;
    // 60 Hz like a room, a state every other tick; after a stall, catch up at most 5
    this.timer = setInterval(() => {
      const due = Math.floor((performance.now() - startedAt) / TICK_MS);
      const n = Math.min(due - done, 5);
      done = due;
      for (let i = 0; i < n; i++) {
        this.sim.tick();
        if (++this.ticks % 2 === 0) this.emitState();
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function startTrackPractice(root: HTMLElement, onExit: () => void): () => void {
  const sim = new PracticeSim((Math.random() * 2 ** 32) >>> 0);
  const link = new PracticeLink(sim);
  let view: HTMLElement | null = null;
  const stopView = startTrack(root, link, { room: "PRACTICE", game: "track", seat: 0, practice: true }, onExit, {
    local: true,
    leaveLabel: "Done",
    onView: (v) => (view = v),
    solo: () => sim.mode === "solo",
  });
  const stat = document.createElement("span");
  stat.className = "pr-stat";
  stat.dataset.for = "solo";
  stat.setAttribute("aria-live", "polite");
  const panel = createPracticePanel(view ?? root, [stat], (mode) => {
    sim.setMode(mode);
    link.presence();
    link.emitState();
  });
  let shown = "";
  link.onState = () => {
    const ev = sim.state.event;
    const text = `Last ${fmt(sim.last[ev])} · best ${fmt(sim.best[ev])}`;
    if (text !== shown) stat.textContent = shown = text;
  };
  link.start();
  return () => {
    link.stop();
    panel.dispose();
    stopView();
  };
}
