// Track (task 26): the sprint sim. Cadence to speed, alternation, the human
// cadence cap, the finish, determinism, and the bot never being recorded as a match between people.
import { describe, expect, it } from "vitest";
import { BOT_CADENCE, botInputs } from "../shared/games/track/bot.ts";
import { asInput, track } from "../shared/games/track/index.ts";
import {
  FULL_CADENCE,
  LANE_LENGTH,
  MAX_CADENCE,
  MAX_SPEED,
  MIN_STEP_MS,
  OVER_TICKS,
  SET_TICKS,
  TICK_MS,
  createState,
  snapshot,
  speedFor,
  step,
  takeStep,
} from "../shared/games/track/sim.ts";
import type { Seat, Side, StepInput, TrackGameEvent, TrackSnapshot, TrackState } from "../shared/games/track/sim.ts";
import { games } from "../shared/games/registry.ts";

/** Steps past "set" to the gun. */
function toGun(s: TrackState): void {
  while (s.phase === "set") step(s, []);
}

/**
 * Runs `ticks` ticks with each seat in `cadences` stepping at that many steps
 * a second (alternating feet unless `sameFoot`), timestamps from the tick.
 */
function runAt(s: TrackState, cadences: Partial<Record<Seat, number>>, ticks: number, opts: { sameFoot?: boolean; until?: () => boolean } = {}): TrackGameEvent[] {
  const ev: TrackGameEvent[] = [];
  const next: Record<number, number> = { 0: 0, 1: 0 };
  const side: Record<number, Side> = { 0: "left", 1: "left" };
  for (let i = 0; i < ticks && !opts.until?.(); i++) {
    const inputs: StepInput[] = [];
    for (const [k, cad] of Object.entries(cadences)) {
      const seat = Number(k) as Seat;
      if (!cad) continue;
      if (i >= next[seat]) {
        inputs.push({ t: "step", seat, side: side[seat], at: (s.tick + 1) * TICK_MS });
        if (!opts.sameFoot) side[seat] = side[seat] === "left" ? "right" : "left";
        next[seat] += 60 / cad;
      }
    }
    ev.push(...step(s, inputs));
  }
  return ev;
}

describe("track: cadence to speed", () => {
  it("speed rises with cadence, linear to FULL_CADENCE and capped there", () => {
    expect(speedFor(0)).toBe(0);
    expect(speedFor(FULL_CADENCE / 2)).toBeCloseTo(MAX_SPEED / 2);
    expect(speedFor(FULL_CADENCE)).toBe(MAX_SPEED);
    expect(speedFor(FULL_CADENCE * 3)).toBe(MAX_SPEED);
  });

  it("a faster cadence runs faster, and the counted cadence settles near the real one", () => {
    const slow = createState(1);
    const fast = createState(1);
    toGun(slow);
    toGun(fast);
    // both below FULL_CADENCE, so the faster one is faster (4 and 7 until FULL_CADENCE went to 4)
    runAt(slow, { 0: 2.5 }, 300);
    runAt(fast, { 0: 3.5 }, 300);
    expect(fast.lanes[0].speed).toBeGreaterThan(slow.lanes[0].speed);
    expect(fast.lanes[0].distance).toBeGreaterThan(slow.lanes[0].distance);
    // the smoothed cadence swings between steps, more at a low cadence
    expect(slow.lanes[0].cadence).toBeGreaterThan(1.5);
    expect(slow.lanes[0].cadence).toBeLessThan(3.5);
    expect(fast.lanes[0].cadence).toBeGreaterThan(2.5);
    expect(fast.lanes[0].cadence).toBeLessThan(4.5);
  });

  // Playtest 2026-11-08: "too many pumps for speed" (6 a second for top speed, 8 before that)
  it("top speed takes about 4 steps a second; the 10-a-second cap is unchanged", () => {
    expect(FULL_CADENCE).toBeGreaterThanOrEqual(3.5);
    expect(FULL_CADENCE).toBeLessThanOrEqual(4.5);
    expect(MAX_CADENCE).toBe(10);
    const s = createState(1);
    toGun(s);
    runAt(s, { 0: 4.5 }, 300);
    expect(s.lanes[0].speed).toBeGreaterThan(MAX_SPEED * 0.95);
  });

  it("stopping decays cadence and speed to nothing", () => {
    const s = createState(2);
    toGun(s);
    runAt(s, { 0: 7 }, 240);
    const moving = s.lanes[0].speed;
    expect(moving).toBeGreaterThan(5);
    runAt(s, {}, 240);
    expect(s.lanes[0].speed).toBe(0);
    expect(s.lanes[0].cadence).toBe(0);
  });

  it("steps before the gun don't count", () => {
    const s = createState(3);
    expect(s.phase).toBe("set");
    runAt(s, { 0: 8 }, SET_TICKS - 1);
    expect(s.lanes[0].steps).toBe(0);
    expect(s.lanes[0].distance).toBe(0);
  });
});

describe("track: alternation and the cadence cap", () => {
  it("the same foot twice is ignored (not punished): a one-key masher stands still", () => {
    const s = createState(4);
    toGun(s);
    runAt(s, { 0: 8 }, 300, { sameFoot: true });
    expect(s.lanes[0].steps).toBe(1);
    expect(s.lanes[0].falseSteps).toBeGreaterThan(30);
    expect(s.lanes[0].distance).toBeLessThan(2);
  });

  it("steps faster than the human cap are dropped, so shaking is no faster than the cap", () => {
    const capped = createState(5);
    const shaken = createState(5);
    toGun(capped);
    toGun(shaken);
    runAt(capped, { 0: MAX_CADENCE }, 300);
    runAt(shaken, { 0: 60 }, 300);
    expect(shaken.lanes[0].fastSteps).toBeGreaterThan(100);
    expect(shaken.lanes[0].steps).toBeLessThanOrEqual(capped.lanes[0].steps + 2);
    expect(shaken.lanes[0].distance).toBeLessThanOrEqual(capped.lanes[0].distance + 1);
  });

  it("a client's own timestamps can't beat the cap: a burst of steps in one tick counts at most twice", () => {
    const s = createState(6);
    toGun(s);
    const burst: StepInput[] = [];
    for (let i = 0; i < 20; i++) burst.push({ t: "step", seat: 0, side: i % 2 ? "right" : "left", at: i * MIN_STEP_MS });
    step(s, burst);
    expect(s.lanes[0].steps).toBeLessThanOrEqual(2);
  });

  it("timestamps closer than MIN_STEP_MS are too fast even when the server has room", () => {
    const s = createState(7);
    toGun(s);
    expect(takeStep(s, { t: "step", seat: 0, side: "left", at: 1000 })).toBe("ok");
    expect(takeStep(s, { t: "step", seat: 0, side: "right", at: 1000 + MIN_STEP_MS / 2 })).toBe("too-fast");
    expect(takeStep(s, { t: "step", seat: 0, side: "right", at: 1000 + MIN_STEP_MS })).toBe("ok");
    expect(takeStep(s, { t: "step", seat: 0, side: "right", at: 5000 })).toBe("same-foot");
  });

  it("the adapter takes the seat from the connection and drops junk", () => {
    expect(asInput(1, { t: "step", side: "left", at: 12, seat: 0, distance: 100 })).toEqual({ t: "step", seat: 1, side: "left", at: 12 });
    expect(asInput(0, { t: "step", side: "up", at: 1 })).toBeNull();
    expect(asInput(0, { t: "step", side: "left", at: Number.NaN })).toBeNull();
    expect(asInput(0, { t: "finish" })).toBeNull();
  });
});

describe("track: the finish", () => {
  it("first across the line wins; both times are recorded", () => {
    const s = createState(8);
    toGun(s);
    const ev = runAt(s, { 0: 8, 1: 6 }, 60 * 30);
    const race = ev.find((e) => e.type === "race");
    expect(race).toMatchObject({ type: "race", winner: 0 });
    expect(s.phase).toBe("over");
    const [a, b] = [s.lanes[0].finish!, s.lanes[1].finish!];
    expect(a).toBeLessThan(b);
    // a flat-out 100 m with a standing start: a little over 10 s
    expect(a).toBeGreaterThan(LANE_LENGTH / MAX_SPEED);
    expect(a).toBeLessThan(15);
    expect(s.lanes[0].distance).toBe(LANE_LENGTH);
    expect(s.wins).toEqual([1, 0]);
    expect(s.best[0]).toBe(a);
  });

  it("a runner who stops gets no time after the grace, and the other still wins", () => {
    const s = createState(9);
    toGun(s);
    runAt(s, { 0: 8 }, 60 * 25);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe(0);
    expect(s.lanes[1].finish).toBeNull();
  });

  it("a dead heat isn't a result: the race is run again", () => {
    const s = createState(13);
    toGun(s);
    const ev = runAt(s, { 0: 8, 1: 8 }, 60 * 20);
    expect(ev.some((e) => e.type === "deadheat")).toBe(true);
    expect(ev.some((e) => e.type === "race")).toBe(false);
    expect(s.wins).toEqual([0, 0]);
  });

  it("the sprint's lane has no obstacles (hurdles adds them, task 27)", () => {
    const s = createState(10);
    expect(s.event).toBe("sprint");
    expect(s.obstacles).toEqual([]);
  });

  it("practice and unlimited start the next race after the result", () => {
    const s = createState(11, { endless: true });
    toGun(s);
    runAt(s, { 0: 8, 1: 7 }, 60 * 30, { until: () => s.phase === "over" });
    expect(s.phase).toBe("over");
    runAt(s, {}, OVER_TICKS);
    expect(s.phase).toBe("set");
    expect(s.lanes[0].distance).toBe(0);
    expect(s.races).toBe(1);
  });

  it("solo (in-page practice) runs one lane and ends when it finishes", () => {
    const s = createState(12, { solo: true });
    toGun(s);
    runAt(s, { 0: 8, 1: 8 }, 60 * 20);
    expect(s.phase).toBe("over");
    expect(s.lanes[1].steps).toBe(0);
  });
});

describe("track: determinism and the bot", () => {
  it("the same seed and inputs give the same race", () => {
    const play = () => {
      const s = createState(42);
      const g: { snap: TrackSnapshot[] } = { snap: [] };
      for (let i = 0; i < 60 * 15; i++) {
        const inputs = [...botInputs(s, 1)];
        if (i % 9 === 0) inputs.push({ t: "step", seat: 0, side: (i / 9) % 2 ? "right" : "left", at: i * TICK_MS });
        step(s, inputs);
        if (i % 60 === 0) g.snap.push(snapshot(s));
      }
      return JSON.stringify(g);
    };
    expect(play()).toBe(play());
  });

  it("asking the bot doesn't change the game", () => {
    const s = createState(43);
    toGun(s);
    const before = JSON.stringify(s);
    botInputs(s, 1);
    botInputs(s, 1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("the bot runs near its cadence, alternating feet, and finishes", () => {
    const s = createState(44);
    toGun(s);
    let ev: TrackGameEvent[] = [];
    for (let i = 0; i < 60 * 25 && s.phase === "running"; i++) ev = ev.concat(step(s, botInputs(s, 1)));
    expect(s.lanes[1].falseSteps).toBe(0);
    expect(s.lanes[1].fastSteps).toBe(0);
    expect(s.lanes[1].finish).not.toBeNull();
    const t = s.lanes[1].finish!;
    const expected = LANE_LENGTH / speedFor(BOT_CADENCE);
    expect(t).toBeGreaterThan(expected * 0.9);
    expect(t).toBeLessThan(expected * 1.4);
  });

  // User, 2026-11-08: the bot was "way too fast". A person pumping a steady 4
  // a second (top speed) beats it every race, with room; 3.5 a second still
  // beats it; and it isn't absurdly slow (a pacer, not a walker).
  it("a person stepping steadily at FULL_CADENCE beats the bot clearly; the bot still runs a race", () => {
    const personTime = (cadence: number, seed: number) => {
      const s = createState(seed);
      toGun(s);
      runAt(s, { 0: cadence }, 60 * 30, { until: () => s.lanes[0].finish !== null });
      return s.lanes[0].finish!;
    };
    for (let seed = 1; seed <= 20; seed++) {
      const s = createState(seed);
      toGun(s);
      for (let i = 0; i < 60 * 30 && s.lanes[1].finish === null; i++) step(s, botInputs(s, 1));
      const bot = s.lanes[1].finish!;
      const full = personTime(FULL_CADENCE, seed);
      expect(bot, `seed ${seed}`).toBeGreaterThan(full * 1.15);
      expect(bot, `seed ${seed}`).toBeGreaterThan(personTime(3.5, seed));
      expect(bot, `seed ${seed}`).toBeLessThan(20);
    }
  });

  it("is registered with its formats, race by default; practice vs the bot is never rated", () => {
    expect(games.track).toBe(track);
    expect(track.formats).toEqual(["race", "unlimited"]);
    const g = track.create(1, { endless: true, format: "race" });
    for (let i = 0; i < 60 * 30 && !g.finished(); i++) g.step(g.botInputs(1).map((input) => ({ seat: 1 as const, input })));
    const result = g.finished();
    expect(result).toMatchObject({ winner: 1, format: "race" });
  });

  it("unlimited never finishes (the room keeps its tally)", () => {
    const g = track.create(2, { format: "unlimited" });
    for (let i = 0; i < 60 * 30; i++) {
      g.step(g.botInputs(0).map((input) => ({ seat: 0 as const, input })));
      expect(g.finished()).toBeNull();
    }
    expect((g.snapshot() as TrackSnapshot).races).toBeGreaterThan(0);
  });
});
