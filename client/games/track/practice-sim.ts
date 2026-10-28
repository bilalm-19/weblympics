import { botInputs } from "../../../shared/games/track/bot.ts";
import { createState, snapshot, step } from "../../../shared/games/track/sim.ts";
import type { Side, StepInput, TrackSnapshot, TrackState } from "../../../shared/games/track/sim.ts";

// Track practice (task 26): the sprint sim in the page, one runner against the
// bot's lane as a pacer, race after race. No room, no score kept, nothing
// sent anywhere. Pure apart from the seed, so it is tested
// (spec/track-practice.test.ts).

export class PracticeSim {
  state: TrackState;
  paused = false;
  private queued: StepInput[] = [];

  constructor(seed: number) {
    this.state = createState(seed, { endless: true });
  }

  step(side: Side, at: number): void {
    this.queued.push({ t: "step", seat: 0, side, at });
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
