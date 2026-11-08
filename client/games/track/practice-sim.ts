import { botInputs } from "../../../shared/games/track/bot.ts";
import { createState, snapshot, step } from "../../../shared/games/track/sim.ts";
import type { Side, TrackEvent, TrackInput, TrackSnapshot, TrackState } from "../../../shared/games/track/sim.ts";

// Track practice (task 26): the sim in the page, race after race. Task 27:
// the sprint or hurdles, switched any time (the race starts again). Task 38:
// "Just me" (the default) runs your lane alone, using the sim's own `solo`
// (no pacer, the race ends when you finish); "vs Bot" puts the bot's lane
// back as a pacer. Your last time and your best time this session are kept
// per event, across switches. No room, no score kept, nothing sent anywhere.
// Pure apart from the seed, so it is tested (spec/track-practice.test.ts).

export type Mode = "solo" | "bot";

export class PracticeSim {
  state: TrackState;
  paused = false;
  mode: Mode;
  /** Your best and last finish this session, per event, seconds. */
  best: Record<TrackEvent, number | null> = { sprint: null, hurdles: null };
  last: Record<TrackEvent, number | null> = { sprint: null, hurdles: null };
  private queued: TrackInput[] = [];
  private seed: number;

  constructor(seed: number, event: TrackEvent = "sprint", mode: Mode = "solo") {
    this.seed = seed;
    this.mode = mode;
    this.state = this.fresh(event);
  }

  private fresh(event: TrackEvent): TrackState {
    const s = createState(this.seed, { endless: true, event, solo: this.mode === "solo" });
    // the session's best for this event, so the board's title carries it
    s.best[0] = this.best[event];
    return s;
  }

  /** Switches the event; a new race starts from "set". */
  setEvent(event: TrackEvent): void {
    if (event === this.state.event) return;
    this.queued = [];
    this.state = this.fresh(event);
  }

  /** Switches between Just me and vs Bot; a new race starts from "set". */
  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.queued = [];
    this.state = this.fresh(this.state.event);
  }

  step(side: Side, at: number): void {
    this.queued.push({ t: "step", seat: 0, side, at });
  }

  jump(at: number): void {
    this.queued.push({ t: "jump", seat: 0, at });
  }

  tick(): void {
    if (this.paused) {
      this.queued = [];
      return;
    }
    const inputs = this.mode === "bot" ? [...this.queued, ...botInputs(this.state, 1)] : this.queued;
    this.queued = [];
    const ev = step(this.state, inputs);
    for (const e of ev) {
      if (e.type !== "finish" || e.seat !== 0) continue;
      const event = this.state.event;
      this.last[event] = e.time;
      const b = this.best[event];
      if (b === null || e.time < b) this.best[event] = e.time;
    }
  }

  snapshot(): TrackSnapshot {
    return snapshot(this.state);
  }
}
