import type { ClientMsg, ServerMsg } from "../../../shared/protocol.ts";
import { SPOTS } from "../../../shared/games/basketball/sim.ts";
import type { GameLink } from "../../net/link.ts";
import { createPracticePanel } from "../practice-panel.ts";
import { PracticeSim } from "./practice-sim.ts";
import { startBasketball } from "./view.ts";

// Basketball practice (task 32): the basketball view on a PracticeSim in the
// page, like archery's and boxing's practice. Nothing goes over the network.
// Task 38: it opens on "Just me" (shoot alone, no clock, a spot or Cycle);
// the panel's "vs Bot" switches to the shootout against the bot, any time.

const TICK_MS = 1000 / 60;

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
    if (msg.t === "set") this.sim.set();
    else if (msg.t === "aim" && "aim" in msg) this.sim.aim(msg.aim);
    else if (msg.t === "shoot") this.sim.shoot(msg.power, msg.aim, msg.at);
    else if (msg.t === "pause") this.sim.paused = msg.paused;
    else if (msg.t === "leave") this.stop();
  }

  private emit(msg: ServerMsg): void {
    for (const h of this.handlers) h(msg);
  }

  presence(): void {
    this.emit({ t: "presence", names: ["You", this.sim.mode === "bot" ? "Bot" : null], spectators: 0 });
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

export function startBasketballPractice(root: HTMLElement, onExit: () => void): () => void {
  const sim = new PracticeSim((Math.random() * 2 ** 32) >>> 0);
  const link = new PracticeLink(sim);
  let view: HTMLElement | null = null;
  const stopView = startBasketball(root, link, { room: "PRACTICE", game: "basketball", seat: 0, practice: true }, onExit, {
    local: true,
    leaveLabel: "Done",
    onView: (v) => (view = v),
    solo: () => sim.mode === "solo",
  });
  const spot = document.createElement("label");
  spot.dataset.for = "solo";
  spot.innerHTML = `Spot <select data-pick="spot"><option value="cycle">Cycle</option>${SPOTS.map((s, i) => `<option value="${i}">${s.name}</option>`).join("")}</select>`;
  const stat = document.createElement("span");
  stat.className = "pr-stat";
  stat.dataset.for = "solo";
  stat.setAttribute("aria-live", "polite");
  const panel = createPracticePanel(view ?? root, [spot, stat], (mode) => {
    sim.setMode(mode);
    link.presence();
    link.emitState();
  });
  const select = spot.querySelector("select") as HTMLSelectElement;
  select.addEventListener("change", () => {
    sim.setSpot(select.value === "cycle" ? null : Number(select.value));
    select.blur();
    link.emitState();
  });
  let shown = "";
  link.onState = () => {
    const s = sim.state;
    const text = `${s.makes[0]}/${s.attempts[0]} made · streak ${sim.streak}${sim.bestStreak ? ` (best ${sim.bestStreak})` : ""}`;
    if (text !== shown) stat.textContent = shown = text;
    stat.dataset.streak = String(sim.streak);
  };
  link.start();
  return () => {
    link.stop();
    panel.dispose();
    stopView();
  };
}
