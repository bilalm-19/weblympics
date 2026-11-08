import { botInputs } from "../../../shared/games/track/bot.ts";
import { createState, snapshot, step } from "../../../shared/games/track/sim.ts";
import type { Side, TrackEvent, TrackInput, TrackSnapshot, TrackState } from "../../../shared/games/track/sim.ts";

// Track practice (task 26): the sim in the page, one runner against the bot's
// lane as a pacer, race after race. No room, no score kept, nothing sent
// anywhere. Task 27: the sprint or hurdles, switched any time (the race
// starts again). Pure apart from the seed, so it is tested
// (spec/track-practice.test.ts).

export class PracticeSim {
  state: TrackState;
  paused = false;
  private queued: TrackInput[] = [];
  private seed: number;

  constructor(seed: number, event: TrackEvent = "sprint") {
    this.seed = seed;
    this.state = createState(seed, { endless: true, event });
  }

  /** Switches the event; a new race starts from "set". */
  setEvent(event: TrackEvent): void {
    if (event === this.state.event) return;
    this.queued = [];
    this.state = createState(this.seed, { endless: true, event });
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
    const inputs = [...this.queued, ...botInputs(this.state, 1)];
    this.queued = [];
    step(this.state, inputs);
  }

  snapshot(): TrackSnapshot {
    return snapshot(this.state);
  }
}
