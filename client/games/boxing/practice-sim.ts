import { botInputs } from "../../../shared/games/boxing/bot.ts";
import { createState, snapshot, step } from "../../../shared/games/boxing/sim.ts";
import type { BoxingInput, BoxingSnapshot, BoxingState, Hand, PunchKind } from "../../../shared/games/boxing/sim.ts";

// Boxing practice (task 30): the bout sim in the page, you in seat 0 against
// the bot, bout after bout. No room, no score kept, nothing sent anywhere.
// Pure apart from the seed, so it is tested (spec/boxing-practice.test.ts).

export class PracticeSim {
  state: BoxingState;
  paused = false;
  private queued: BoxingInput[] = [];

  constructor(seed: number) {
    this.state = createState(seed, { endless: true });
  }

  punch(kind: PunchKind, hand: Hand, at: number): void {
    this.queued.push({ t: "punch", seat: 0, kind, hand, at });
  }

  guard(up: boolean): void {
    this.queued.push({ t: "guard", seat: 0, up });
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

  snapshot(): BoxingSnapshot {
    return snapshot(this.state);
  }
}
