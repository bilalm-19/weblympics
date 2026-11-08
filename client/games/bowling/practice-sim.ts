import { botInputs } from "../../../shared/games/bowling/bot.ts";
import { createState, snapshot, step } from "../../../shared/games/bowling/sim.ts";
import type { BowlingEvent, BowlingInput, BowlingSnapshot, BowlingState, Vote } from "../../../shared/games/bowling/sim.ts";

// Bowling practice (task 29): the game's own sim in the page, you in seat 0
// against the bot, game after game. No room, no score kept, nothing sent
// anywhere. Pure apart from the seed, so it is tested
// (spec/bowling-practice.test.ts).

export class PracticeSim {
  state: BowlingState;
  paused = false;
  private queued: BowlingInput[] = [];

  constructor(seed: number) {
    this.state = createState(seed, { endless: true });
  }

  aim(aim: number): void {
    this.queued.push({ t: "aim", seat: 0, aim });
  }

  throw(speed: number, aim: number, spin: number, at: number): void {
    this.queued.push({ t: "throw", seat: 0, speed, aim, spin, at });
  }

  tie(choice: Vote): void {
    this.queued.push({ t: "tie", seat: 0, choice });
  }

  tick(): BowlingEvent[] {
    if (this.paused) {
      this.queued = [];
      return [];
    }
    const inputs = [...this.queued, ...botInputs(this.state, 1)];
    this.queued = [];
    return step(this.state, inputs);
  }

  snapshot(): BowlingSnapshot {
    return snapshot(this.state);
  }
}
