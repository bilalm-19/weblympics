import { botInputs } from "../../../shared/games/bowling/bot.ts";
import {
  FRAMES,
  MAX_ROLL_TICKS,
  OVER_TICKS,
  RESULT_TICKS,
  clampThrow,
  createState,
  freshPins,
  isSplit,
  launchBall,
  rollStep,
  scoreCard,
  settled,
  snapshot,
  step,
} from "../../../shared/games/bowling/sim.ts";
import type { BowlingEvent, BowlingInput, BowlingSnapshot, BowlingState, ThrowRead, Vote } from "../../../shared/games/bowling/sim.ts";

// Bowling practice (task 29): the game's own sim in the page, you in seat 0
// against the bot, game after game. Task 38: "Just me" (the default) bowls
// the frames alone (two balls, spares and strikes count, the last frame's
// bonus ball), game after game, with no shot clock; "Reset pins each ball"
// gives every ball a full rack and keeps the pins knocked per ball instead.
// The ball and pins roll in the sim's own `rollStep`, so a ball does here
// what it does in a room. No room, no score kept, nothing sent anywhere. Pure
// apart from the seed, so it is tested (spec/bowling-practice.test.ts).

export type Mode = "solo" | "bot";

/** Reset pins each ball: this many recent balls are kept. */
export const RESET_KEPT = 10;
const PATH_EVERY = 2;

export class PracticeSim {
  state: BowlingState;
  paused = false;
  mode: Mode;
  /** Just me: every ball faces a full rack (first balls only). */
  resetPins = false;
  /** Reset pins: pins knocked down by each ball, oldest first (the latest RESET_KEPT). */
  balls: number[] = [];
  /** Reset pins: balls bowled and strikes, this session. */
  bowled = 0;
  strikes = 0;
  private queued: BowlingInput[] = [];
  private seed: number;

  constructor(seed: number, mode: Mode = "solo") {
    this.seed = seed;
    this.mode = mode;
    this.state = createState(seed, { endless: true });
  }

  /** A clean start: a fresh game whose counter moves on, so the view never takes it for the one it was showing. */
  private restart(): void {
    const matches = this.state.matches + 1;
    const best = this.state.best;
    this.queued = [];
    this.state = createState(this.seed, { endless: true });
    this.state.matches = matches;
    if (this.mode === "solo") this.state.best = [best[0], 0];
  }

  /** Switches between Just me and vs Bot. */
  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.restart();
  }

  /** Just me: every ball at a full rack, or normal frames. Either way a fresh start. */
  setResetPins(on: boolean): void {
    if (on === this.resetPins) return;
    this.resetPins = on;
    this.balls = [];
    this.bowled = 0;
    this.strikes = 0;
    this.restart();
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
    const inputs = this.queued;
    this.queued = [];
    if (this.mode === "solo") return this.soloTick(inputs);
    return step(this.state, [...inputs, ...botInputs(this.state, 1)]);
  }

  /** Just me: the running total of the game so far. */
  total(): number {
    return scoreCard(this.state.rolls[0]).total;
  }

  // ---- Just me: one bowler, the sim's own roll ----

  /** A fresh rack (all ten), or the leftovers with the fallen ones swept away. */
  private startBall(fullRack: boolean): void {
    const s = this.state;
    s.pins = fullRack ? freshPins() : s.pins.map((p) => (p.standing && !p.cleared ? { ...p, vx: 0, vy: 0 } : { ...p, vx: 0, vy: 0, standing: false, cleared: true }));
    s.rack = s.pins.filter((p) => p.standing).length;
    s.phase = "aim";
    s.phaseTick = 0;
    s.bowl = null;
    s.thrown = null;
  }

  private throwBall(read: ThrowRead): void {
    const s = this.state;
    s.thrown = read;
    s.aims[0] = read.aim;
    s.bowl = launchBall(read);
    s.path = [{ x: s.bowl.x, y: s.bowl.y }];
    for (const p of s.pins) {
      p.homeX = p.x;
      p.homeY = p.y;
    }
    s.phase = "roll";
    s.phaseTick = 0;
  }

  private finishBall(ev: BowlingEvent[]): void {
    const s = this.state;
    const left = s.pins.flatMap((p, i) => (p.standing && !p.cleared ? [i + 1] : []));
    const pins = s.rack - left.length;
    const fresh = s.rack === 10;
    const strike = fresh && pins === 10;
    const spare = !fresh && left.length === 0;
    if (this.resetPins) {
      this.balls.push(pins);
      if (this.balls.length > RESET_KEPT) this.balls.shift();
      this.bowled++;
      if (strike) this.strikes++;
    } else s.rolls[0].push(pins);
    s.last = { seat: 0, frame: s.frame, ball: s.ball, pins, left, strike, spare, gutter: s.bowl?.gutter ?? false, timeout: false, split: fresh && isSplit(left), read: s.thrown };
    s.phase = "result";
    s.phaseTick = 0;
    ev.push({ type: "bowl", seat: 0, frame: s.frame, ball: s.ball, pins, strike, spare, timeout: false });
  }

  /** After a result: the next ball in this frame, the next frame, or the end of the game. */
  private advance(ev: BowlingEvent[]): void {
    const s = this.state;
    if (this.resetPins) {
      // every ball is a first ball; the ball counter moves on so each is a new one to the view
      s.ball++;
      return this.startBall(true);
    }
    const cleared = s.last!.left.length === 0;
    if (s.frame === FRAMES - 1) {
      // the last frame: a strike or spare in its first two balls earns a third
      const own = s.rolls[0].slice(-(s.ball + 1));
      const bonus = s.ball === 1 && (own[0] === 10 || own[0] + own[1] === 10);
      if (s.ball === 0 || bonus) {
        s.ball++;
        return this.startBall(cleared);
      }
      const total = this.total();
      s.best = [Math.max(s.best[0], total), 0];
      s.matches++;
      s.phase = "over";
      s.phaseTick = 0;
      s.bowl = null;
      ev.push({ type: "bowlGame", winner: null, draw: false, score: [total, 0] });
      return;
    }
    if (s.ball === 0 && !cleared) {
      s.ball++;
      return this.startBall(false);
    }
    s.ball = 0;
    s.frame++;
    this.startBall(true);
  }

  private soloTick(inputs: BowlingInput[]): BowlingEvent[] {
    const s = this.state;
    const ev: BowlingEvent[] = [];
    s.tick++;
    s.phaseTick++;
    s.turn = 0;
    if (s.phase === "aim") {
      for (const input of inputs) {
        if (input.seat !== 0 || input.t === "tie") continue;
        if (input.t === "aim") s.aims[0] = Math.max(-1, Math.min(1, input.aim));
        else {
          // no shot clock alone: a throw whenever you're ready
          this.throwBall(clampThrow(input));
          break;
        }
      }
    } else if (s.phase === "roll" && s.bowl) {
      rollStep(s.bowl, s.pins, s.thrown!.spin);
      if (!s.bowl.gone && s.phaseTick % PATH_EVERY === 0) s.path.push({ x: s.bowl.x, y: s.bowl.y });
      if (settled(s.bowl, s.pins) || s.phaseTick >= MAX_ROLL_TICKS) this.finishBall(ev);
    } else if (s.phase === "result" && s.phaseTick >= RESULT_TICKS) {
      this.advance(ev);
    } else if (s.phase === "over" && s.phaseTick >= OVER_TICKS) {
      // the next game
      s.frame = 0;
      s.ball = 0;
      s.rolls = [[], []];
      s.tieRolls = [[], []];
      s.path = [];
      s.last = null;
      this.startBall(true);
    }
    return ev;
  }

  snapshot(): BowlingSnapshot {
    const snap = snapshot(this.state);
    // alone there's no shot clock
    if (this.mode === "solo") snap.clock = null;
    return snap;
  }
}
