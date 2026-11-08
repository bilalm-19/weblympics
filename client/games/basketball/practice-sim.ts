import { botInputs } from "../../../shared/games/basketball/bot.ts";
import { MAX_FLIGHT_TICKS, PATH_EVERY, SPOTS, SWISH_BONUS, createState, flyTick, launch, makeWindow, snapshot, step } from "../../../shared/games/basketball/sim.ts";
import type { BasketballEvent, BasketballInput, BasketballSnapshot, BasketballState, ShotResult, Vec3 } from "../../../shared/games/basketball/sim.ts";

// Basketball practice (task 32): the shootout sim in the page, you in seat 0
// against the bot, match after match (a finished one starts a fresh one).
// Task 38: "Just me" (the default) is one shooter alone: no turns and no shot
// clock; shoot, the ball comes back, shoot again, from a picked spot or
// cycling through the five. It flies the ball with the sim's own `launch` and
// `flyTick`, so a shot does here what it does in a room. No room, no score
// kept, nothing sent anywhere. Pure apart from the seed, so it is tested
// (spec/basketball-practice.test.ts).

export type Mode = "solo" | "bot";

/** Just me: the result stays up this long (the ball drops and rolls back) before the next shot. */
export const SOLO_RESULT_TICKS = 90;
/** Just me keeps this many recent shots in the snapshot. */
const SHOTS_KEPT = 20;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const pathPoint = (p: Vec3): Vec3 => ({ x: round3(p.x), y: round3(p.y), z: round3(p.z) });

export class PracticeSim {
  state: BasketballState;
  paused = false;
  mode: Mode;
  /** Just me: a spot index, or null to cycle through the five, one shot each. */
  spot: number | null = null;
  /** Just me: makes in a row now, and the most this session. */
  streak = 0;
  bestStreak = 0;
  private queued: BasketballInput[] = [];
  private seed: number;

  constructor(seed: number, mode: Mode = "solo") {
    this.seed = seed;
    this.mode = mode;
    this.state = this.fresh();
  }

  private fresh(): BasketballState {
    // solo uses "unlimited" so the board shows makes / shots, and never ends
    const s = createState(this.seed, { endless: true, format: this.mode === "solo" ? "unlimited" : "shootout" });
    if (this.mode === "solo") {
      s.spot = this.spot ?? 0;
      s.round = 0;
    }
    return s;
  }

  /** Switches between Just me and vs Bot: a clean start of the other. */
  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    // a fresh match, but its counter moves on, so the view never takes it for the one it was showing
    const matches = this.state.matches + 1;
    this.mode = mode;
    this.queued = [];
    this.streak = 0;
    this.state = this.fresh();
    this.state.matches = matches;
  }

  /** Just me: shoot from `spot` (0..4), or null to cycle. The next shot is from there. */
  setSpot(spot: number | null): void {
    this.spot = spot === null ? null : Math.max(0, Math.min(SPOTS.length - 1, Math.round(spot)));
    if (this.mode !== "solo") return;
    const s = this.state;
    if (s.phase === "aim" && this.spot !== null && this.spot !== s.spot) {
      s.spot = this.spot;
      s.round++;
      this.startTurn();
    }
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

  /** One tick: your queued messages and, vs Bot, the bot's, through the same sim the server runs. */
  tick(): BasketballEvent[] {
    if (this.paused) {
      this.queued = [];
      return [];
    }
    const inputs = this.queued;
    this.queued = [];
    if (this.mode === "solo") return this.soloTick(inputs);
    return step(this.state, [...inputs, ...botInputs(this.state, 1)]);
  }

  private startTurn(): void {
    const s = this.state;
    s.phase = "aim";
    s.phaseTick = 0;
    s.turn = 0;
    s.set = false;
    s.clockStart = null;
    s.aim = [0, 0];
    s.ball = null;
    s.release = null;
    s.path = [];
    s.contact = { rim: false, board: false };
    s.flightTicks = 0;
  }

  private soloTick(inputs: BasketballInput[]): BasketballEvent[] {
    const s = this.state;
    const ev: BasketballEvent[] = [];
    s.tick++;
    s.phaseTick++;
    if (s.phase === "aim") {
      for (const input of inputs) {
        if (s.phase !== "aim" || input.seat !== 0) continue;
        // "set" only lights the ready cue: there is no shot clock to start
        if (input.t === "set") s.set = true;
        else if (input.t === "aim") s.aim[0] = clamp(input.aim, -1, 1);
        else if (input.t === "shoot") {
          const power = clamp(input.power, 0, 1);
          const aim = clamp(input.aim, -1, 1);
          s.aim[0] = aim;
          s.ball = launch(s.spot, power, aim);
          s.path = [pathPoint(s.ball.pos)];
          s.contact = { rim: false, board: false };
          s.flightTicks = 0;
          s.release = { power, aim };
          s.phase = "flight";
          s.phaseTick = 0;
        }
      }
    } else if (s.phase === "flight" && s.ball) {
      s.flightTicks++;
      const r = flyTick(s.ball, s.contact);
      if (s.flightTicks % PATH_EVERY === 0 || r !== "flying") s.path.push(pathPoint(s.ball.pos));
      if (r !== "flying" || s.flightTicks >= MAX_FLIGHT_TICKS) this.land(r === "made", ev);
    } else if (s.phase === "result") {
      if (s.ball) flyTick(s.ball, s.contact, true);
      if (s.phaseTick >= SOLO_RESULT_TICKS) {
        s.round++;
        s.spot = this.spot ?? (s.spot + 1) % SPOTS.length;
        this.startTurn();
        ev.push({ type: "spot", round: s.round, spot: s.spot, suddenDeath: false });
      }
    }
    return ev;
  }

  private land(made: boolean, ev: BasketballEvent[]): void {
    const s = this.state;
    const sp = SPOTS[s.spot];
    const swish = made && !s.contact.rim && !s.contact.board;
    const { power, aim } = s.release ?? { power: 0, aim: 0 };
    const shot: ShotResult = {
      seat: 0,
      round: s.round,
      spot: s.spot,
      distance: sp.distance,
      made,
      swish,
      rim: s.contact.rim,
      board: s.contact.board,
      points: made ? sp.points + (swish ? SWISH_BONUS : 0) : 0,
      power,
      aim,
      window: makeWindow(s.spot),
      suddenDeath: false,
    };
    s.last = shot;
    s.shots.push(shot);
    if (s.shots.length > SHOTS_KEPT) s.shots.shift();
    s.totals[0] += shot.points;
    s.attempts[0]++;
    if (made) {
      s.makes[0]++;
      s.longest[0] = Math.max(s.longest[0], sp.distance);
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else this.streak = 0;
    s.phase = "result";
    s.phaseTick = 0;
    const { window: _w, ...rest } = shot;
    ev.push({ type: "basket", ...rest });
  }

  snapshot(): BasketballSnapshot {
    return snapshot(this.state);
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
