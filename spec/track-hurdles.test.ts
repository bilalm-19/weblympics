// Track hurdles (task 27): the second event of the track sim. Ten hurdles per
// lane, a jump with a fixed airtime, a speed cost per jump, a stumble on a
// hurdle reached on the ground, the jump cap, the bot, and the closed jump
// message.
import { describe, expect, it } from "vitest";
import { BOT_CADENCE, botInputs } from "../shared/games/track/bot.ts";
import { asEvent, asInput, raceDetail, track } from "../shared/games/track/index.ts";
import {
  AIR_TICKS,
  HIT_KEEP,
  HURDLE_COUNT,
  JUMP_COST,
  MIN_JUMP_MS,
  SET_TICKS,
  TICK_MS,
  createState,
  obstaclesFor,
  snapshot,
  speedFor,
  step,
  takeJump,
} from "../shared/games/track/sim.ts";
import type { Seat, TrackGameEvent, TrackInput, TrackState } from "../shared/games/track/sim.ts";
import { parseClientMsg } from "../shared/protocol.ts";

const hurdles = (seed = 1, solo = false) => createState(seed, { event: "hurdles", solo });

function toGun(s: TrackState): void {
  while (s.phase === "set") step(s, []);
}

/**
 * Runs `ticks` ticks with seat 0 stepping at `cadence` (alternating feet)
 * and `jumpAt(s, tick)` deciding when to jump. Returns every event.
 */
function race(s: TrackState, ticks: number, jumpAt: (s: TrackState) => boolean = () => false, cadence = 7, seat: Seat = 0): TrackGameEvent[] {
  const ev: TrackGameEvent[] = [];
  let next = 0;
  let left = true;
  for (let i = 0; i < ticks && s.lanes[seat].finish === null; i++) {
    const inputs: TrackInput[] = [];
    const at = (s.tick + 1) * TICK_MS;
    if (i >= next) {
      inputs.push({ t: "step", seat, side: left ? "left" : "right", at });
      left = !left;
      next += 60 / cadence;
    }
    if (jumpAt(s)) inputs.push({ t: "jump", seat, at });
    ev.push(...step(s, inputs));
  }
  return ev;
}

/** One jump per hurdle, timed so the middle of the flight is over it; `offset` seconds late (negative: early). */
const timed = (offset = 0, seat: Seat = 0) => {
  const jumped = new Set<number>();
  return (s: TrackState) => {
    const lane = s.lanes[seat];
    const i = s.obstacles.findIndex((h, k) => h > lane.distance && lane.hurdles[k] === "up");
    if (i < 0 || jumped.has(i) || lane.air > 0) return false;
    const half = (AIR_TICKS / 2) * (TICK_MS / 1000);
    if (lane.distance < s.obstacles[i] - lane.speed * (half - offset)) return false;
    jumped.add(i);
    return true;
  };
};

describe("hurdles: the course", () => {
  it("the sprint has no hurdles; hurdles has ten, at fixed spacing, inside the lane", () => {
    expect(createState(1).obstacles).toEqual([]);
    const s = hurdles();
    expect(s.obstacles).toHaveLength(HURDLE_COUNT);
    expect(s.obstacles).toEqual(obstaclesFor("hurdles"));
    const gaps = s.obstacles.slice(1).map((x, i) => x - s.obstacles[i]);
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(1);
    expect(s.obstacles[0]).toBeGreaterThan(5);
    expect(s.obstacles.at(-1)!).toBeLessThan(s.length - 5);
    for (const lane of s.lanes) expect(lane.hurdles).toEqual(Array(HURDLE_COUNT).fill("up"));
  });

  it("the adapter picks the event: hurdles if asked, else the sprint", () => {
    expect(asEvent("hurdles")).toBe("hurdles");
    expect(asEvent("marathon")).toBe("sprint");
    expect(asEvent(undefined)).toBe("sprint");
    expect((track.create(1, { event: "hurdles" }).snapshot() as { event: string; obstacles: number[] }).obstacles).toHaveLength(HURDLE_COUNT);
    expect((track.create(1).snapshot() as { event: string }).event).toBe("sprint");
    expect(track.events).toEqual(["sprint", "hurdles"]);
  });
});

describe("hurdles: clear or hit", () => {
  it("a well-timed jump clears every hurdle and keeps the speed", () => {
    const s = hurdles();
    toGun(s);
    const ev = race(s, 3000, timed(0));
    const lane = s.lanes[0];
    expect(lane.finish).not.toBeNull();
    expect(lane.cleared).toBe(HURDLE_COUNT);
    expect(lane.hit).toBe(0);
    expect(lane.hurdles.every((h) => h === "cleared")).toBe(true);
    expect(ev.filter((e) => e.type === "hurdle" && e.cleared)).toHaveLength(HURDLE_COUNT);
  });

  it("running into a hurdle without jumping knocks it down and stumbles you", () => {
    const s = hurdles();
    toGun(s);
    race(s, 3000, () => false, 7);
    const lane = s.lanes[0];
    expect(lane.hit).toBe(HURDLE_COUNT);
    expect(lane.cleared).toBe(0);
    expect(lane.hurdles.every((h) => h === "down")).toBe(true);
  });

  it("the stumble keeps only HIT_KEEP of the speed on the tick it happens", () => {
    const s = hurdles();
    toGun(s);
    let before = 0;
    let after = 0;
    race(s, 3000, (st) => {
      const l = st.lanes[0];
      if (l.hit === 0) before = l.speed;
      else if (after === 0) after = l.speed;
      return false;
    });
    // the speed seen after the hit is a stumble, then the cadence brings it back up
    expect(after).toBeLessThan(before * HIT_KEEP + 0.5);
  });

  it("hitting every hurdle is slower than clearing them all", () => {
    const clean = hurdles();
    const sloppy = hurdles();
    toGun(clean);
    toGun(sloppy);
    race(clean, 3000, timed(0));
    race(sloppy, 3000, () => false);
    expect(clean.lanes[0].finish!).toBeLessThan(sloppy.lanes[0].finish! - 1);
  });

  it("a jump far too early lands before the hurdle (a hit); far too late is a hit too", () => {
    for (const offset of [-0.5, 0.5]) {
      const s = hurdles();
      toGun(s);
      race(s, 3000, timed(offset));
      expect(s.lanes[0].hit, `offset ${offset}`).toBe(HURDLE_COUNT);
      expect(s.lanes[0].cleared).toBe(0);
    }
  });

  it("a little early or late still clears: inside the airtime is a clear", () => {
    for (const offset of [-0.12, 0.12]) {
      const s = hurdles();
      toGun(s);
      race(s, 3000, timed(offset));
      expect(s.lanes[0].cleared, `offset ${offset}`).toBe(HURDLE_COUNT);
    }
  });

  it("a jump with no hurdle near costs speed and clears nothing", () => {
    const s = hurdles();
    toGun(s);
    race(s, 90, () => false);
    const lane = s.lanes[0];
    expect(lane.distance).toBeLessThan(s.obstacles[0] - 3);
    const speed = lane.speed;
    expect(takeJump(s, { t: "jump", seat: 0, at: 99_999 })).toBe("ok");
    expect(lane.speed).toBeCloseTo(Math.max(0, speed - JUMP_COST));
    expect(lane.air).toBe(AIR_TICKS);
    for (let i = 0; i < AIR_TICKS; i++) step(s, []);
    expect(lane.air).toBe(0);
    expect(lane.cleared + lane.hit).toBe(0);
  });

  it("a stopped runner jumping in front of a hurdle never crosses it", () => {
    const s = hurdles();
    toGun(s);
    for (let i = 0; i < 200; i++) step(s, i % 30 === 0 ? [{ t: "jump", seat: 0, at: i * 1000 }] : []);
    expect(s.lanes[0].distance).toBe(0);
    expect(s.lanes[0].hurdles.every((h) => h === "up")).toBe(true);
  });
});

describe("hurdles: spam and the cap", () => {
  it("jumping all the time is slower than jumping at the hurdles", () => {
    const timedRun = hurdles();
    const spam = hurdles();
    toGun(timedRun);
    toGun(spam);
    race(timedRun, 3000, timed(0));
    // a jump every tick: the cap and the airtime let only some through, each costing speed
    race(spam, 3000, () => true);
    expect(spam.lanes[0].jumps).toBeGreaterThan(HURDLE_COUNT * 2);
    expect(spam.lanes[0].fastJumps).toBeGreaterThan(500);
    expect(timedRun.lanes[0].finish!).toBeLessThan(spam.lanes[0].finish ?? Infinity);
  });

  it("a jump can't start in the air, and timestamps closer than MIN_JUMP_MS are too fast", () => {
    const s = hurdles();
    toGun(s);
    race(s, 60);
    expect(takeJump(s, { t: "jump", seat: 0, at: 1000 })).toBe("ok");
    expect(takeJump(s, { t: "jump", seat: 0, at: 5000 })).toBe("in-air");
    for (let i = 0; i < AIR_TICKS; i++) step(s, []);
    expect(takeJump(s, { t: "jump", seat: 0, at: 1000 + MIN_JUMP_MS / 2 })).toBe("too-fast");
    for (let i = 0; i < 60; i++) step(s, []);
    expect(takeJump(s, { t: "jump", seat: 0, at: 1000 + MIN_JUMP_MS })).toBe("ok");
  });

  it("a client's own timestamps can't beat the server's bucket", () => {
    const s = hurdles();
    toGun(s);
    race(s, 60);
    // far-apart timestamps, but the server's bucket holds one jump and refills at 2 a second
    expect(takeJump(s, { t: "jump", seat: 0, at: 10_000 })).toBe("ok");
    for (let i = 0; i < AIR_TICKS; i++) step(s, []);
    expect(s.lanes[0].air).toBe(0);
    expect(takeJump(s, { t: "jump", seat: 0, at: 20_000 })).toBe("too-fast");
    // half a second (30 ticks) refills it, give or take a tick of rounding
    for (let i = 0; i < 31 - AIR_TICKS; i++) step(s, []);
    expect(takeJump(s, { t: "jump", seat: 0, at: 30_000 })).toBe("ok");
  });

  it("jumps before the gun don't count; the sprint ignores jumps", () => {
    const s = hurdles();
    for (let i = 0; i < SET_TICKS - 1; i++) step(s, [{ t: "jump", seat: 0, at: i * 1000 }]);
    expect(s.phase).toBe("set");
    expect(s.lanes[0].jumps).toBe(0);
    expect(s.lanes[0].air).toBe(0);
    const sprint = createState(1);
    toGun(sprint);
    expect(takeJump(sprint, { t: "jump", seat: 0, at: 1 })).toBe("no-hurdles");
    expect(sprint.lanes[0].jumps).toBe(0);
  });
});

describe("hurdles: determinism, the bot, the message", () => {
  it("the same seed and inputs give the same race", () => {
    const a = hurdles(42);
    const b = hurdles(42);
    const play = (s: TrackState) => {
      for (let i = 0; i < 1500; i++) {
        const ins: TrackInput[] = [...botInputs(s, 1)];
        if (i % 9 === 0) ins.push({ t: "step", seat: 0, side: (i / 9) % 2 ? "left" : "right", at: i * TICK_MS });
        if (i % 97 === 0) ins.push({ t: "jump", seat: 0, at: i * TICK_MS });
        step(s, ins);
      }
      return snapshot(s);
    };
    expect(play(a)).toEqual(play(b));
  });

  it("the bot clears most hurdles but not always, and finishes near its sprint pace", () => {
    let cleared = 0;
    let hit = 0;
    const times: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const s = hurdles(seed);
      toGun(s);
      for (let i = 0; i < 3000 && s.lanes[1].finish === null; i++) step(s, botInputs(s, 1));
      cleared += s.lanes[1].cleared;
      hit += s.lanes[1].hit;
      times.push(s.lanes[1].finish!);
    }
    expect(cleared + hit).toBe(20 * HURDLE_COUNT);
    // mostly clean, never perfect: beatable
    expect(cleared / (cleared + hit)).toBeGreaterThan(0.6);
    expect(hit).toBeGreaterThan(5);
    // its sprint is about 100 m at BOT_CADENCE; hurdles cost it a few seconds
    const sprintPace = 100 / speedFor(BOT_CADENCE);
    for (const t of times) expect(t).toBeGreaterThan(sprintPace);
  });

  it("a person jumping well beats the bot", () => {
    const s = hurdles(7);
    toGun(s);
    let next = 0;
    let left = true;
    for (let i = 0; i < 3000 && s.phase === "running"; i++) {
      const ins: TrackInput[] = [...botInputs(s, 1)];
      const at = (s.tick + 1) * TICK_MS;
      if (i >= next) {
        ins.push({ t: "step", seat: 0, side: left ? "left" : "right", at });
        left = !left;
        next += 60 / 7;
      }
      if (timed(0)(s)) ins.push({ t: "jump", seat: 0, at });
      step(s, ins);
    }
    expect(s.winner).toBe(0);
  });

  it("jump is exactly { t, at }: anything else or any extra field is dropped whole", () => {
    expect(asInput(1, { t: "jump", at: 12 })).toEqual({ t: "jump", seat: 1, at: 12 });
    expect(asInput(0, { t: "jump", at: 12, cleared: true })).toBeNull();
    expect(asInput(0, { t: "jump", at: 12, seat: 1 })).toBeNull();
    expect(asInput(0, { t: "jump" })).toBeNull();
    expect(asInput(0, { t: "jump", at: Number.NaN })).toBeNull();
    expect(asInput(0, { t: "jump", at: "12" })).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "jump", at: 5.5 }))).toEqual({ t: "jump", at: 5.5 });
    expect(parseClientMsg(JSON.stringify({ t: "jump", at: 5, cleared: 10 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "jump", at: null }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "event", event: "hurdles" }))).toEqual({ t: "event", event: "hurdles" });
    expect(parseClientMsg(JSON.stringify({ t: "event", event: "marathon" }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: "event", event: "hurdles", x: 1 }))).toBeNull();
  });

  it("the result detail names the event, the times and the hurdles", () => {
    const s = hurdles(3);
    toGun(s);
    for (let i = 0; i < 3000 && s.phase === "running"; i++) step(s, [...botInputs(s, 1)]);
    // seat 0 never ran: a DNF
    const d = raceDetail(s);
    expect(d.event).toBe("hurdles");
    expect((d.times as Array<number | null>)[0]).toBeNull();
    expect((d.times as Array<number | null>)[1]).toBe(s.lanes[1].finish);
    expect(d.cleared).toEqual([0, s.lanes[1].cleared]);
    expect(d.hit).toEqual([0, s.lanes[1].hit]);
    expect(raceDetail(createState(1))).toEqual({ event: "sprint", times: [null, null] });
  });
});
