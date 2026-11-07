import { botInputs } from "../../../shared/games/basketball/bot.ts";
import { createState, snapshot, step } from "../../../shared/games/basketball/sim.ts";
import type { BasketballEvent, BasketballInput, BasketballSnapshot, BasketballState } from "../../../shared/games/basketball/sim.ts";

// Basketball practice (task 32): the shootout sim in the page, you in seat 0
// against the bot, match after match (a finished one starts a fresh one). No
// room, no score kept, nothing sent anywhere. Pure apart from the seed, so it
// is tested (spec/basketball-practice.test.ts).

export class PracticeSim {
  state: BasketballState;
  paused = false;
  private queued: BasketballInput[] = [];

  constructor(seed: number) {
    this.state = createState(seed, { endless: true });
  }

  set(): void {
    this.queued.push({ t: "set", seat: 0 });
  }

  aim(aim: number): void {
    this.queued.push({ t: "aim", seat: 0, aim });
  }

  shoot(power: number, aim: number, at: number): void {
    this.queued.push({ t: "shoot", seat: 0, power, aim, at });
  }

  /** One tick: your queued messages and the bot's, through the same sim the server runs. */
  tick(): BasketballEvent[] {
    if (this.paused) {
      this.queued = [];
      return [];
    }
    const inputs = [...this.queued, ...botInputs(this.state, 1)];
    this.queued = [];
    return step(this.state, inputs);
  }

  snapshot(): BasketballSnapshot {
    return snapshot(this.state);
  }
}
