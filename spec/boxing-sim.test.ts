// Boxing's sim (task 30): the server owns every hit. Punches have a wind-up,
// the guard is checked when the punch lands, a hand recovers before it
// throws again, a cap stops flailing, 3 x 30 s rounds, KO, decision, draw.
import { describe, expect, it } from "vitest";
import { botInputs, botWantsGuard } from "../shared/games/boxing/bot.ts";
import { asInput, boxing, boxingFrom } from "../shared/games/boxing/index.ts";
import {
  BREAK_TICKS,
  DAMAGE,
  HEALTH,
  MAX_PUNCH_RATE,
  RECOVER_TICKS,
  ROUNDS,
  ROUND_TICKS,
  TICK_MS,
  WINDUP_TICKS,
  createState,
  damageFor,
  snapshot,
  step,
} from "../shared/games/boxing/sim.ts";
import type { BoxingInput, BoxingState, Hand, PunchKind, Seat } from "../shared/games/boxing/sim.ts";
import { games } from "../shared/games/registry.ts";
import { isRated } from "../server/schema.ts";

const punch = (s: BoxingState, seat: Seat, kind: PunchKind, hand: Hand = "right"): BoxingInput => ({ t: "punch", seat, kind, hand, at: s.tick * TICK_MS });
const guard = (seat: Seat, up: boolean): BoxingInput => ({ t: "guard", seat, up });
const idle = (s: BoxingState, n: number) => {
  for (let i = 0; i < n; i++) step(s, []);
};

describe("boxing punches", () => {
  it("is registered with its own formats, a bout by default", () => {
    expect(games.boxing).toBe(boxing);
    expect(boxing.formats).toEqual(["bout", "unlimited"]);
  });

  it("a jab lands after its 200 ms wind-up, a hook after 350 ms, for full damage on an open boxer", () => {
    expect(WINDUP_TICKS).toEqual({ jab: 12, hook: 21 });
    for (const kind of ["jab", "hook"] as const) {
      const s = createState(1);
      step(s, [punch(s, 0, kind)]);
      idle(s, WINDUP_TICKS[kind] - 1);
      expect(s.boxers[1].health).toBe(HEALTH);
      expect(s.boxers[0].punches.right).not.toBeNull();
      const ev = step(s, []);
      expect(ev).toContainEqual({ type: "hit", seat: 0, kind, hand: "right", guarded: false, damage: DAMAGE[kind] });
      expect(s.boxers[1].health).toBe(HEALTH - DAMAGE[kind]);
      expect(s.boxers[0].dealt).toBe(DAMAGE[kind]);
    }
  });

  it("a guarded punch does 20% of its damage", () => {
    expect(damageFor("jab", true)).toBe(1);
    expect(damageFor("hook", true)).toBe(3);
    const s = createState(1);
    step(s, [guard(1, true), punch(s, 0, "hook")]);
    idle(s, WINDUP_TICKS.hook);
    expect(s.boxers[1].health).toBe(HEALTH - 3);
    expect(s.boxers[0].blocked).toBe(1);
  });

  it("the guard is checked when the punch lands, not when it is thrown", () => {
    // guard raised after the throw, before landing: blocked
    const late = createState(1);
    step(late, [punch(late, 0, "hook")]);
    idle(late, 10);
    step(late, [guard(1, true)]);
    idle(late, WINDUP_TICKS.hook);
    expect(late.boxers[1].health).toBe(HEALTH - damageFor("hook", true));
    // guard up at the throw, dropped before landing: open
    const dropped = createState(1);
    step(dropped, [guard(1, true), punch(dropped, 0, "hook")]);
    idle(dropped, 10);
    step(dropped, [guard(1, false)]);
    idle(dropped, WINDUP_TICKS.hook);
    expect(dropped.boxers[1].health).toBe(HEALTH - DAMAGE.hook);
  });

  it("a hand can't throw again until its punch lands plus 150 ms; the other hand can", () => {
    const s = createState(1);
    step(s, [punch(s, 0, "jab", "right")]);
    idle(s, 5);
    step(s, [punch(s, 0, "jab", "right")]);
    expect(s.boxers[0].thrown).toBe(1);
    // the other hand is free (time apart from the cap's minimum gap)
    idle(s, 6);
    step(s, [punch(s, 0, "jab", "left")]);
    expect(s.boxers[0].thrown).toBe(2);
    // the right lands at tick 13; it is ready again RECOVER_TICKS later
    const readyAt = s.boxers[0].readyAt.right;
    expect(readyAt).toBe(1 + WINDUP_TICKS.jab + RECOVER_TICKS);
    // inputs are judged on the tick the step moves to: one tick early is refused
    while (s.tick < readyAt - 2) step(s, []);
    step(s, [punch(s, 0, "jab", "right")]);
    expect(s.boxers[0].thrown).toBe(2);
    step(s, [punch(s, 0, "jab", "right")]);
    expect(s.boxers[0].thrown).toBe(3);
  });

  it("guarding blocks punching", () => {
    const s = createState(1);
    step(s, [guard(0, true), punch(s, 0, "jab")]);
    expect(s.boxers[0].thrown).toBe(0);
    // drop the guard and throw in the same tick: it goes
    step(s, [guard(0, false), punch(s, 0, "jab")]);
    expect(s.boxers[0].thrown).toBe(1);
  });

  it("the punch cap: flailing both hands as fast as possible counts no more than the cap", () => {
    const s = createState(1);
    let at = 0;
    for (let i = 0; i < 60 * 10; i++) {
      // a punch on each hand every tick, timestamps racing ahead
      step(s, [
        { t: "punch", seat: 0, kind: "jab", hand: "left", at: (at += 50) },
        { t: "punch", seat: 0, kind: "jab", hand: "right", at: (at += 50) },
      ]);
    }
    expect(s.boxers[0].thrown).toBeLessThanOrEqual(MAX_PUNCH_RATE * 10 + 2);
    expect(s.boxers[0].capped).toBeGreaterThan(0);
  });

  it("punches stamped closer than the minimum gap are dropped even when the server's bucket has room", () => {
    const s = createState(1);
    step(s, [{ t: "punch", seat: 0, kind: "jab", hand: "left", at: 1000 }, { t: "punch", seat: 0, kind: "jab", hand: "right", at: 1020 }]);
    expect(s.boxers[0].thrown).toBe(1);
    expect(s.boxers[0].capped).toBe(1);
  });

  it("a client can't send damage, health or a seat: only a punch kind, a hand and a timestamp get through", () => {
    expect(asInput(0, { t: "punch", kind: "hook", hand: "left", at: 5, damage: 100, seat: 1 })).toEqual({ t: "punch", seat: 0, kind: "hook", hand: "left", at: 5 });
    expect(asInput(1, { t: "guard", up: true, health: 100 })).toEqual({ t: "guard", seat: 1, up: true });
    expect(asInput(0, { t: "punch", kind: "uppercut", hand: "left", at: 5 })).toBeNull();
    expect(asInput(0, { t: "punch", kind: "jab", hand: "left" })).toBeNull();
    expect(asInput(0, { t: "hit", damage: 100 })).toBeNull();
    expect(asInput(0, { t: "health", health: 0 })).toBeNull();
  });
});

describe("boxing rounds and results", () => {
  it("three rounds of 30 s with a 5 s break; no punches in the break; punches in the air at the bell don't count", () => {
    const s = createState(1);
    idle(s, ROUND_TICKS - 5);
    step(s, [punch(s, 0, "jab")]);
    const ev: unknown[] = [];
    for (let i = 0; i < 4; i++) ev.push(...step(s, []));
    expect(ev).toContainEqual({ type: "round", round: 1, damage: [0, 0] });
    expect(s.phase).toBe("break");
    expect(s.boxers[1].health).toBe(HEALTH);
    step(s, [punch(s, 0, "jab")]);
    expect(s.boxers[0].thrown).toBe(1);
    idle(s, BREAK_TICKS);
    expect(s.phase).toBe("round");
    expect(s.round).toBe(2);
    idle(s, ROUND_TICKS + BREAK_TICKS);
    expect(s.round).toBe(ROUNDS);
    expect(s.roundDamage).toHaveLength(3);
  });

  it("a knockout ends the bout at once", () => {
    const s = createState(1);
    s.boxers[1].health = DAMAGE.hook;
    step(s, [punch(s, 0, "hook")]);
    const ev = [];
    for (let i = 0; i < WINDUP_TICKS.hook; i++) ev.push(...step(s, []));
    expect(ev).toContainEqual({ type: "bout", winner: 0, result: "ko", dealt: [DAMAGE.hook, 0] });
    expect(s.phase).toBe("over");
    expect(s.round).toBe(1);
    expect(s.kos).toEqual([1, 0]);
  });

  it("after three rounds the most damage dealt wins", () => {
    const g = boxing.create(1);
    g.step([{ seat: 1, input: { t: "punch", kind: "jab", hand: "left", at: 0 } }]);
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) g.step([]);
    expect(g.finished()).toEqual({ winner: 1, score: [0, DAMAGE.jab], format: "bout" });
    expect((g.snapshot() as ReturnType<typeof snapshot>).result).toBe("decision");
  });

  it("an exact tie on damage is a draw: no winner, and it is still a result (rated between two people)", () => {
    const g = boxing.create(1);
    g.step([
      { seat: 0, input: { t: "punch", kind: "jab", hand: "left", at: 0 } },
      { seat: 1, input: { t: "punch", kind: "jab", hand: "left", at: 0 } },
    ]);
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) g.step([]);
    const r = g.finished();
    expect(r).toEqual({ winner: null, score: [DAMAGE.jab, DAMAGE.jab], format: "bout" });
    expect((g.snapshot() as ReturnType<typeof snapshot>).result).toBe("draw");
    const rec = { room: "X", game: "boxing", tokens: ["a", "b"] as [string, string], score: r!.score, winner: null, draw: true, format: "bout", sets: [], practice: false };
    expect(isRated(rec)).toBe(true);
    expect(isRated({ ...rec, practice: true })).toBe(false);
  });

  it("unlimited boxes bout after bout, counts wins and KOs, and never finishes", () => {
    const g = boxing.create(1, { format: "unlimited" });
    const snap = () => g.snapshot() as ReturnType<typeof snapshot>;
    for (let bout = 0; bout < 2; bout++) {
      for (let i = 0; i < 2000 && snap().phase === "round"; i++) {
        const s = snap();
        const hand: Hand = s.boxers[0].punches.left === null && s.tick >= s.boxers[0].readyAt.left ? "left" : "right";
        g.step([{ seat: 0, input: { t: "punch", kind: "hook", hand, at: s.tick * TICK_MS } }]);
      }
      expect(snap().phase).toBe("over");
      expect(g.finished()).toBeNull();
      for (let i = 0; i < 300 && snap().phase === "over"; i++) g.step([]);
    }
    expect(snap().wins).toEqual([2, 0]);
    expect(snap().kos).toEqual([2, 0]);
    expect(snap().boxers[1].health).toBe(HEALTH);
  });

  it("the snapshot carries no cap internals", () => {
    const snap = snapshot(createState(1));
    expect(snap).not.toHaveProperty("rng");
    expect(snap.boxers[0]).not.toHaveProperty("tokens");
    expect(snap.boxers[0]).not.toHaveProperty("lastAt");
  });
});

describe("boxing determinism and the bot", () => {
  const bout = (seed: number) => {
    const g = boxing.create(seed);
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) {
      g.step([...g.botInputs(0).map((input) => ({ seat: 0 as const, input })), ...g.botInputs(1).map((input) => ({ seat: 1 as const, input }))]);
    }
    return { snap: g.snapshot(), result: g.finished() };
  };

  it("the same seed and inputs give the same bout", () => {
    expect(bout(7)).toEqual(bout(7));
    expect(bout(7)).not.toEqual(bout(8));
  });

  it("asking the bot doesn't change the game", () => {
    const s = createState(3);
    idle(s, 100);
    const before = JSON.stringify(s);
    botInputs(s, 1);
    botWantsGuard(s, 1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("two bots box a full bout with jabs and hooks, some blocked, to a result", () => {
    const g = boxing.create(11);
    const kinds = new Set<string>();
    let blocked = 0;
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) {
      const ev = g.step([...g.botInputs(0).map((input) => ({ seat: 0 as const, input })), ...g.botInputs(1).map((input) => ({ seat: 1 as const, input }))]);
      for (const e of ev) {
        if (e.type === "hit") {
          kinds.add(String(e.kind));
          if (e.guarded) blocked++;
        }
      }
    }
    expect(kinds).toEqual(new Set(["jab", "hook"]));
    expect(blocked).toBeGreaterThan(0);
    expect(g.finished()).not.toBeNull();
  });

  it("the bot guards after a human-ish reaction, not at once, and blocks more hooks than jabs", () => {
    let jabs = 0;
    let hooks = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const kind of ["jab", "hook"] as const) {
        const s = createState(seed);
        idle(s, 10 + (seed % 7));
        step(s, [punch(s, 0, kind)]);
        // never guarding on the very next tick
        expect(botWantsGuard(s, 1)).toBe(false);
        const g = boxingFrom(s);
        for (let i = 0; i < WINDUP_TICKS[kind]; i++) g.step(g.botInputs(1).map((input) => ({ seat: 1 as const, input })));
        const after = g.snapshot() as ReturnType<typeof snapshot>;
        if (after.lastHit?.guarded) kind === "jab" ? jabs++ : hooks++;
      }
    }
    expect(hooks).toBeGreaterThan(jabs);
    expect(hooks).toBeGreaterThan(50);
    expect(hooks).toBeLessThan(200);
  });
});
