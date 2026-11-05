import type { ClientMsg, ServerMsg } from "../../../shared/protocol.ts";
import type { GameLink } from "../../net/link.ts";
import { PracticeSim } from "./practice-sim.ts";
import { startBoxing } from "./view.ts";

// Boxing practice (task 30): the boxing view on a PracticeSim in the page,
// like track's and archery's practice. Nothing goes over the network.

const TICK_MS = 1000 / 60;

class PracticeLink implements GameLink {
  private handlers = new Set<(msg: ServerMsg) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  readonly sim: PracticeSim;

  constructor(sim: PracticeSim) {
    this.sim = sim;
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: ClientMsg): void {
    if (msg.t === "punch") this.sim.punch(msg.hand, msg.target, msg.at);
    else if (msg.t === "guard") this.sim.guard(msg.guard);
    else if (msg.t === "slip") this.sim.slip(msg.side);
    else if (msg.t === "pause") this.sim.paused = msg.paused;
    else if (msg.t === "leave") this.stop();
  }

  private emit(msg: ServerMsg): void {
    for (const h of this.handlers) h(msg);
  }

  start(): void {
    this.emit({ t: "presence", names: ["You", "Sparring partner"], spectators: 0 });
    this.emit({ t: "state", state: this.sim.snapshot() });
    const startedAt = performance.now();
    let done = 0;
    // 60 Hz like a room, a state every other tick; after a stall, catch up at most 5
    this.timer = setInterval(() => {
      const due = Math.floor((performance.now() - startedAt) / TICK_MS);
      const n = Math.min(due - done, 5);
      done = due;
      for (let i = 0; i < n; i++) {
        this.sim.tick();
        if (++this.ticks % 2 === 0) this.emit({ t: "state", state: this.sim.snapshot() });
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function startBoxingPractice(root: HTMLElement, onExit: () => void): () => void {
  const link = new PracticeLink(new PracticeSim((Math.random() * 2 ** 32) >>> 0));
  const stopView = startBoxing(root, link, { room: "PRACTICE", game: "boxing", seat: 0, practice: true }, onExit, { local: true, leaveLabel: "Done" });
  link.start();
  return () => {
    link.stop();
    stopView();
  };
}
