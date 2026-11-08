// Boxing's sim (task 30, ADR 002): the server owns every hit. Jabs only, to
// the head or the body, with a short wind-up; the defender's guard (high, low
// or none) and slip are judged on the landing tick; a slip is a window the
// sim ends itself, with a cooldown; a hand recovers before it throws again; a
// cap stops flailing; 3 x 30 s rounds, KO, decision, draw.
import { describe, expect, it } from "vitest";
import { BOT_PUNCH_CHANCE, botDefence, botInputs, botWantsGuard } from "../shared/games/boxing/bot.ts";
import { asInput, boxing, boxingFrom } from "../shared/games/boxing/index.ts";
import {
  BLOCKED_SHARE,
  BREAK_TICKS,
  HEALTH,
  JAB_DAMAGE,
  JAB_WINDUP_MS,
  JAB_WINDUP_TICKS,
  MAX_PUNCH_RATE,
  PUNCH_BURST,
  RECOVER_MS,
  RECOVER_TICKS,
  ROUNDS,
  ROUND_TICKS,
  TICK_MS,
  createState,
  damageFor,
  judge,
  snapshot,
  step,
} from "../shared/games/boxing/sim.ts";
import type { BoxingEvent, BoxingInput, BoxingState, Guard, Hand, Seat, Side, Target } from "../shared/games/boxing/sim.ts";
import { games } from "../shared/games/registry.ts";
import { isRated } from "../server/schema.ts";

const punch = (s: BoxingState, seat: Seat, target: Target = "head", hand: Hand = "right"): BoxingInput => ({ t: "punch", seat, hand, target, at: s.tick * TICK_MS });
const guard = (seat: Seat, g: Guard): BoxingInput => ({ t: "guard", seat, guard: g });
const slip = (seat: Seat, side: Side | null = "left"): BoxingInput => ({ t: "slip", seat, side });
const idle = (s: BoxingState, n: number) => {
  const ev: BoxingEvent[] = [];
  for (let i = 0; i < n; i++) ev.push(...step(s, []));
  return ev;
};

describe("boxing jabs", () => {
  it("is registered with its own formats, a bout by default", () => {
    expect(games.boxing).toBe(boxing);
    expect(boxing.formats).toEqual(["bout", "unlimited"]);
  });

  it("the playtest's numbers: jab 6, a 100 ms wind-up (150 until the 2026-11-08 playtest), health 500", () => {
    expect(JAB_DAMAGE).toBe(6);
    expect(JAB_WINDUP_MS).toBe(100);
    expect(JAB_WINDUP_TICKS).toBe(6);
    expect(HEALTH).toBe(500);
  });

  it("2026-11-08: the cap is 6 a second with a burst of 3, and one hand jabs again 200 ms after its last throw", () => {
    expect(MAX_PUNCH_RATE).toBe(6);
    expect(PUNCH_BURST).toBe(3);
    expect(JAB_WINDUP_MS + RECOVER_MS).toBe(200);
    expect(JAB_WINDUP_TICKS + RECOVER_TICKS).toBe(12);
  });

  it("2026-11-08: left, right, left 100 ms apart are all thrown (the burst of 3; the left is free again at 200 ms)", () => {
    const s = createState(1);
    const hands: Hand[] = ["left", "right", "left"];
    let i = 0;
    for (let tick = 0; tick < 14; tick++) {
      // a press every 6 ticks (100 ms), stamped on the client's clock
      const inputs: BoxingInput[] = tick % 6 === 0 && i < 3 ? [{ t: "punch", seat: 0, hand: hands[i++], target: "head", at: tick * TICK_MS }] : [];
      step(s, inputs);
    }
    expect(s.boxers[0].thrown).toBe(3);
    expect(s.boxers[0].capped).toBe(0);
  });

  it("a jab lands after its wind-up, for full damage on an open boxer, to the head or the body", () => {
    for (const target of ["head", "body"] as const) {
      const s = createState(1);
      const thrown = step(s, [punch(s, 0, target)]);
      expect(thrown).toContainEqual({ type: "throw", seat: 0, hand: "right", target });
      expect(s.boxers[0].punches.right).toEqual({ hand: "right", target, thrownTick: 1, landsTick: 1 + JAB_WINDUP_TICKS });
      idle(s, JAB_WINDUP_TICKS - 1);
      expect(s.boxers[1].health).toBe(HEALTH);
      const ev = step(s, []);
      expect(ev).toContainEqual({ type: "hit", seat: 0, hand: "right", target, outcome: "clean", damage: JAB_DAMAGE });
      expect(s.lastHit).toEqual({ seat: 0, hand: "right", target, outcome: "clean", damage: JAB_DAMAGE, tick: 1 + JAB_WINDUP_TICKS });
      expect(s.boxers[1].health).toBe(HEALTH - JAB_DAMAGE);
      expect(s.boxers[0].dealt).toBe(JAB_DAMAGE);
      expect(s.boxers[0].landed).toBe(1);
    }
  });

  it("judge: every guard x target x slip gives the contract's outcome", () => {
    const want = (target: Target, g: Guard, slipping: boolean) => {
      if (target === "head" && slipping) return "slipped";
      if (target === "head" && g === "high") return "blocked";
      if (target === "body" && g === "low") return "blocked";
      return "clean";
    };
    // spelled out, so the table is read, not only recomputed
    expect(judge("head", null, false)).toBe("clean");
    expect(judge("head", "high", false)).toBe("blocked");
    expect(judge("head", "low", false)).toBe("clean");
    expect(judge("head", null, true)).toBe("slipped");
    expect(judge("head", "high", true)).toBe("slipped");
    expect(judge("head", "low", true)).toBe("slipped");
    expect(judge("body", null, false)).toBe("clean");
    expect(judge("body", "high", false)).toBe("clean");
    expect(judge("body", "low", false)).toBe("blocked");
    expect(judge("body", null, true)).toBe("clean");
    expect(judge("body", "high", true)).toBe("clean");
    expect(judge("body", "low", true)).toBe("blocked");
    for (const target of ["head", "body"] as const) for (const g of ["high", "low", null] as const) for (const sl of [false, true]) expect(judge(target, g, sl)).toBe(want(target, g, sl));
  });

  it("damage: clean full, blocked BLOCKED_SHARE rounded, slipped none", () => {
    expect(damageFor("clean")).toBe(JAB_DAMAGE);
    expect(damageFor("blocked")).toBe(Math.round(JAB_DAMAGE * BLOCKED_SHARE));
    expect(damageFor("blocked")).toBe(1);
    expect(damageFor("slipped")).toBe(0);
  });

  it("in the sim, each reachable guard x target x slip lands as judged (a slip can't start under a guard)", () => {
    const cases: Array<{ target: Target; defence: "none" | "high" | "low" | "slip"; outcome: string }> = [
      { target: "head", defence: "none", outcome: "clean" },
      { target: "head", defence: "high", outcome: "blocked" },
      { target: "head", defence: "low", outcome: "clean" },
      { target: "head", defence: "slip", outcome: "slipped" },
      { target: "body", defence: "none", outcome: "clean" },
      { target: "body", defence: "high", outcome: "clean" },
      { target: "body", defence: "low", outcome: "blocked" },
      { target: "body", defence: "slip", outcome: "clean" },
    ];
    for (const c of cases) {
      const s = createState(1);
      step(s, [punch(s, 0, c.target)]);
      // the defence goes on after the throw, before landing
      step(s, c.defence === "none" ? [] : c.defence === "slip" ? [slip(1)] : [guard(1, c.defence)]);
      const ev = idle(s, JAB_WINDUP_TICKS);
      const hit = ev.find((e) => e.type === "hit");
      expect(hit, `${c.target} vs ${c.defence}`).toMatchObject({ outcome: c.outcome, damage: damageFor(c.outcome as never) });
      expect(s.boxers[1].health).toBe(HEALTH - damageFor(c.outcome as never));
      expect(s.boxers[0].blocked).toBe(c.outcome === "blocked" ? 1 : 0);
      expect(s.boxers[1].slipped).toBe(c.outcome === "slipped" ? 1 : 0);
      expect(s.boxers[0].landed).toBe(c.outcome === "slipped" ? 0 : 1);
    }
  });

  it("the guard and slip are judged when the jab lands, not when it is thrown", () => {
    // guard raised after the throw, before landing: blocked
    const late = createState(1);
    step(late, [punch(late, 0, "head")]);
    idle(late, 5);
    step(late, [guard(1, "high")]);
    idle(late, JAB_WINDUP_TICKS);
    expect(late.boxers[1].health).toBe(HEALTH - damageFor("blocked"));
    // guard up at the throw, dropped before landing: clean
    const dropped = createState(1);
    step(dropped, [guard(1, "high"), punch(dropped, 0, "head")]);
    idle(dropped, 5);
    step(dropped, [guard(1, null)]);
    idle(dropped, JAB_WINDUP_TICKS);
    expect(dropped.boxers[1].health).toBe(HEALTH - JAB_DAMAGE);
    // guard switched from high to low before landing: a head jab is clean
    const switched = createState(1);
    step(switched, [guard(1, "high"), punch(switched, 0, "head")]);
    idle(switched, 5);
    step(switched, [guard(1, "low")]);
    idle(switched, JAB_WINDUP_TICKS);
    expect(switched.boxers[1].health).toBe(HEALTH - JAB_DAMAGE);
    // a lean let go before the jab lands doesn't save you
    const early = createState(1);
    step(early, [slip(1)]);
    step(early, [punch(early, 0, "head")]);
    idle(early, 3);
    step(early, [slip(1, null)]);
    idle(early, JAB_WINDUP_TICKS);
    expect(early.boxers[1].slip).toBeNull();
    expect(early.boxers[1].health).toBe(HEALTH - JAB_DAMAGE);
  });

  it("a hand can't throw again until its jab lands plus 100 ms; the other hand can", () => {
    const s = createState(1);
    step(s, [punch(s, 0, "head", "right")]);
    idle(s, 2);
    step(s, [punch(s, 0, "head", "right")]);
    expect(s.boxers[0].thrown).toBe(1);
    // the other hand is free (100 ms on: the cap's minimum gap)
    idle(s, 2);
    step(s, [punch(s, 0, "head", "left")]);
    expect(s.boxers[0].thrown).toBe(2);
    const readyAt = s.boxers[0].readyAt.right;
    expect(readyAt).toBe(1 + JAB_WINDUP_TICKS + RECOVER_TICKS);
    // inputs are judged on the tick the step moves to: one tick early is refused
    while (s.tick < readyAt - 2) step(s, []);
    step(s, [punch(s, 0, "head", "right")]);
    expect(s.boxers[0].thrown).toBe(2);
    step(s, [punch(s, 0, "head", "right")]);
    expect(s.boxers[0].thrown).toBe(3);
  });

  it("guarding, high or low, stops punching; drop it and throw in the same tick and it goes", () => {
    for (const g of ["high", "low"] as const) {
      const s = createState(1);
      step(s, [guard(0, g), punch(s, 0)]);
      expect(s.boxers[0].thrown).toBe(0);
      step(s, [guard(0, null), punch(s, 0)]);
      expect(s.boxers[0].thrown).toBe(1);
    }
  });

  it("the punch cap: flailing both hands as fast as possible counts no more than the cap", () => {
    const s = createState(1);
    let at = 0;
    for (let i = 0; i < 60 * 10; i++) {
      // a jab on each hand every tick, timestamps racing ahead
      step(s, [
        { t: "punch", seat: 0, hand: "left", target: "head", at: (at += 50) },
        { t: "punch", seat: 0, hand: "right", target: "body", at: (at += 50) },
      ]);
    }
    expect(s.boxers[0].thrown).toBeLessThanOrEqual(MAX_PUNCH_RATE * 10 + PUNCH_BURST);
    expect(s.boxers[0].capped).toBeGreaterThan(0);
  });

  it("jabs stamped closer than the minimum gap are dropped even when the server's bucket has room", () => {
    const s = createState(1);
    step(s, [
      { t: "punch", seat: 0, hand: "left", target: "head", at: 1000 },
      { t: "punch", seat: 0, hand: "right", target: "head", at: 1020 },
    ]);
    expect(s.boxers[0].thrown).toBe(1);
    expect(s.boxers[0].capped).toBe(1);
  });
});

describe("boxing slips", () => {
  it("a slip is a held lean (playtest 4): it lasts until the boxer comes back upright, however long", () => {
    const s = createState(1);
    const ev = step(s, [slip(0, "right")]);
    expect(ev).toContainEqual({ type: "slip", seat: 0, side: "right" });
    expect(s.boxers[0].slip).toBe("right");
    idle(s, 600);
    expect(s.boxers[0].slip).toBe("right");
    const back = step(s, [slip(0, null)]);
    expect(back).toContainEqual({ type: "slip", seat: 0, side: null });
    expect(s.boxers[0].slip).toBeNull();
  });

  it("a held lean protects from head jabs the whole time it is held (user, playtest 4)", () => {
    const s = createState(1);
    step(s, [slip(1, "left")]);
    idle(s, 300);
    for (let n = 0; n < 3; n++) {
      step(s, [punch(s, 0, "head", n % 2 === 0 ? "left" : "right")]);
      idle(s, 40);
    }
    expect(s.boxers[1].slipped).toBe(3);
    expect(s.boxers[1].health).toBe(HEALTH);
  });

  it("leaning straight from one side to the other is allowed; the same side again is no event", () => {
    const s = createState(1);
    step(s, [slip(0, "left")]);
    expect(step(s, [slip(0, "left")]).filter((e) => e.type === "slip")).toEqual([]);
    step(s, [slip(0, "right")]);
    expect(s.boxers[0].slip).toBe("right");
  });

  it("you can't punch while leaning; once upright you can", () => {
    const s = createState(1);
    step(s, [slip(0)]);
    step(s, [punch(s, 0)]);
    expect(s.boxers[0].thrown).toBe(0);
    expect(s.boxers[0].capped).toBe(0);
    step(s, [slip(0, null)]);
    step(s, [punch(s, 0)]);
    expect(s.boxers[0].thrown).toBe(1);
  });

  it("a slip starts with a guard up, and a guard change leaves the slip alone (user, playtest 4)", () => {
    const s = createState(1);
    step(s, [guard(0, "high"), slip(0)]);
    expect(s.boxers[0].slip).not.toBeNull();
    expect(s.boxers[0].guard).toBe("high");
    step(s, [guard(0, "low")]);
    expect(s.boxers[0].slip).not.toBeNull();
    expect(s.boxers[0].guard).toBe("low");
  });

  it("slipping with a high guard: a head jab misses; with a low guard a body jab is blocked", () => {
    expect(judge("head", "high", true)).toBe("slipped");
    expect(judge("body", "low", true)).toBe("blocked");
    expect(judge("body", "high", true)).toBe("clean");
  });

  it("no leaning between rounds; the bell ends a lean", () => {
    const s = createState(1);
    idle(s, ROUND_TICKS - 3);
    step(s, [slip(0)]);
    idle(s, 3);
    expect(s.phase).toBe("break");
    expect(s.boxers[0].slip).toBeNull();
    step(s, [slip(0)]);
    expect(s.boxers[0].slip).toBeNull();
    idle(s, BREAK_TICKS);
    expect(s.phase).toBe("round");
    step(s, [slip(0)]);
    expect(s.boxers[0].slip).not.toBeNull();
  });
});

describe("boxing inputs from the network", () => {
  it("accepts exactly the three contract inputs, the seat from the connection", () => {
    expect(asInput(0, { t: "punch", hand: "left", target: "head", at: 5 })).toEqual({ t: "punch", seat: 0, hand: "left", target: "head", at: 5 });
    expect(asInput(1, { t: "punch", hand: "right", target: "body", at: 0 })).toEqual({ t: "punch", seat: 1, hand: "right", target: "body", at: 0 });
    for (const g of ["high", "low", null] as const) expect(asInput(1, { t: "guard", guard: g })).toEqual({ t: "guard", seat: 1, guard: g });
    for (const side of ["left", "right"] as const) expect(asInput(0, { t: "slip", side })).toEqual({ t: "slip", seat: 0, side });
  });

  it("refuses any extra field: damage, health, a seat, an outcome, a slip's end", () => {
    expect(asInput(0, { t: "punch", hand: "left", target: "head", at: 5, damage: 100 })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "left", target: "head", at: 5, seat: 1 })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "left", target: "head", at: 5, outcome: "clean" })).toBeNull();
    expect(asInput(1, { t: "guard", guard: "high", health: 100 })).toBeNull();
    expect(asInput(1, { t: "slip", side: "left", until: 1e9 })).toBeNull();
    expect(asInput(1, { t: "slip", side: "left", seat: 0 })).toBeNull();
  });

  it("refuses the old shapes (hooks, kind, a boolean guard) and malformed inputs", () => {
    expect(asInput(0, { t: "punch", kind: "jab", hand: "left", at: 5 })).toBeNull();
    expect(asInput(0, { t: "punch", kind: "hook", hand: "left", target: "head", at: 5 })).toBeNull();
    expect(asInput(0, { t: "guard", up: true })).toBeNull();
    expect(asInput(0, { t: "guard", guard: true })).toBeNull();
    expect(asInput(0, { t: "guard" })).toBeNull();
    expect(asInput(0, { t: "guard", guard: "mid" })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "left", target: "legs", at: 5 })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "both", target: "head", at: 5 })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "left", target: "head" })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "left", target: "head", at: Infinity })).toBeNull();
    expect(asInput(0, { t: "punch", hand: "left", target: "head", at: "5" })).toBeNull();
    expect(asInput(0, { t: "slip", side: "back" })).toBeNull();
    expect(asInput(0, { t: "slip" })).toBeNull();
    expect(asInput(0, { t: "hit", damage: 100 })).toBeNull();
    expect(asInput(0, { t: "health", health: 0 })).toBeNull();
    expect(asInput(0, null)).toBeNull();
    expect(asInput(0, "punch")).toBeNull();
    expect(asInput(0, [])).toBeNull();
  });

  it("the game drops what asInput refuses: an old hook does nothing", () => {
    const g = boxing.create(1);
    g.step([{ seat: 0, input: { t: "punch", kind: "hook", hand: "left", at: 0 } }]);
    g.step([{ seat: 0, input: { t: "punch", hand: "left", target: "head", at: 0, damage: 500 } }]);
    for (let i = 0; i < 30; i++) g.step([]);
    const snap = g.snapshot() as ReturnType<typeof snapshot>;
    expect(snap.boxers[0].thrown).toBe(0);
    expect(snap.boxers[1].health).toBe(HEALTH);
  });
});

describe("boxing rounds and results", () => {
  it("three rounds of 30 s with a 5 s break; no jabs in the break; jabs in the air at the bell don't count", () => {
    const s = createState(1);
    idle(s, ROUND_TICKS - 5);
    step(s, [punch(s, 0)]);
    const ev = idle(s, 4);
    expect(ev).toContainEqual({ type: "round", round: 1, damage: [0, 0] });
    expect(s.phase).toBe("break");
    expect(s.boxers[1].health).toBe(HEALTH);
    step(s, [punch(s, 0)]);
    expect(s.boxers[0].thrown).toBe(1);
    // the guard may still be moved in the break
    step(s, [guard(0, "low")]);
    expect(s.boxers[0].guard).toBe("low");
    idle(s, BREAK_TICKS);
    expect(s.phase).toBe("round");
    expect(s.round).toBe(2);
    idle(s, ROUND_TICKS + BREAK_TICKS);
    expect(s.round).toBe(ROUNDS);
    expect(s.roundDamage).toHaveLength(3);
  });

  it("a knockout ends the bout at once", () => {
    const s = createState(1);
    s.boxers[1].health = JAB_DAMAGE;
    step(s, [punch(s, 0)]);
    const ev = idle(s, JAB_WINDUP_TICKS);
    expect(ev).toContainEqual({ type: "bout", winner: 0, result: "ko", dealt: [JAB_DAMAGE, 0] });
    expect(s.phase).toBe("over");
    expect(s.round).toBe(1);
    expect(s.kos).toEqual([1, 0]);
  });

  it("after three rounds the most damage dealt wins", () => {
    const g = boxing.create(1);
    g.step([{ seat: 1, input: { t: "punch", hand: "left", target: "body", at: 0 } }]);
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) g.step([]);
    expect(g.finished()).toEqual({ winner: 1, score: [0, JAB_DAMAGE], format: "bout" });
    expect((g.snapshot() as ReturnType<typeof snapshot>).result).toBe("decision");
  });

  it("an exact tie on damage is a draw: no winner, and it is still a result (rated between two people)", () => {
    const g = boxing.create(1);
    g.step([
      { seat: 0, input: { t: "punch", hand: "left", target: "head", at: 0 } },
      { seat: 1, input: { t: "punch", hand: "left", target: "head", at: 0 } },
    ]);
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) g.step([]);
    const r = g.finished();
    expect(r).toEqual({ winner: null, score: [JAB_DAMAGE, JAB_DAMAGE], format: "bout" });
    expect((g.snapshot() as ReturnType<typeof snapshot>).result).toBe("draw");
    const rec = { room: "X", game: "boxing", tokens: ["a", "b"] as [string, string], score: r!.score, winner: null, draw: true, format: "bout", sets: [], practice: false, ratedRequested: true, accounts: [true, true] as [boolean, boolean] };
    expect(isRated(rec)).toBe(true);
    expect(isRated({ ...rec, ratedRequested: false })).toBe(false);
    expect(isRated({ ...rec, accounts: [true, false] })).toBe(false);
    expect(isRated({ ...rec, practice: true })).toBe(false);
  });

  it("unlimited boxes bout after bout, counts wins and KOs, and never finishes", () => {
    const g = boxing.create(1, { format: "unlimited" });
    const snap = () => g.snapshot() as ReturnType<typeof snapshot>;
    for (let bout = 0; bout < 2; bout++) {
      for (let i = 0; i < 20_000 && snap().phase !== "over"; i++) {
        const s = snap();
        const hand: Hand = s.boxers[0].punches.left === null && s.tick >= s.boxers[0].readyAt.left ? "left" : "right";
        g.step([{ seat: 0, input: { t: "punch", hand, target: "head", at: s.tick * TICK_MS } }]);
      }
      expect(snap().phase).toBe("over");
      expect(snap().result).toBe("ko");
      expect(g.finished()).toBeNull();
      for (let i = 0; i < 300 && snap().phase === "over"; i++) g.step([]);
    }
    expect(snap().wins).toEqual([2, 0]);
    expect(snap().kos).toEqual([2, 0]);
    expect(snap().boxers[1].health).toBe(HEALTH);
  });

  it("the snapshot has the contract's boxer fields and no cap internals", () => {
    const s = createState(1);
    step(s, [punch(s, 0, "body"), slip(1, "right")]);
    const snap = snapshot(s);
    expect(snap).not.toHaveProperty("rng");
    const b0 = snap.boxers[0];
    const b1 = snap.boxers[1];
    expect(b0).not.toHaveProperty("tokens");
    expect(b0).not.toHaveProperty("lastAt");
    expect(b0.guard).toBeNull();
    expect(b0.punches.right).toEqual({ hand: "right", target: "body", thrownTick: 1, landsTick: 1 + JAB_WINDUP_TICKS });
    expect(b1.slip).toBe("right");
    for (const k of ["health", "guard", "slip", "punches", "readyAt", "dealt", "thrown", "landed", "blocked", "slipped", "capped"]) expect(b0).toHaveProperty(k);
    // a copy: changing the state doesn't change a snapshot already taken
    s.boxers[1].slip = "left";
    expect(b1.slip).toBe("right");
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
    step(s, [punch(s, 0)]);
    idle(s, 4);
    const before = JSON.stringify(s);
    botInputs(s, 1);
    botWantsGuard(s, 1);
    botDefence(s, 1);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("the bot sends only contract inputs, each one asInput accepts", () => {
    const s = createState(5);
    for (let i = 0; i < 60 * 40; i++) {
      const inputs = [...botInputs(s, 0), ...botInputs(s, 1)];
      for (const input of inputs) {
        const { seat, ...wire } = input;
        expect(asInput(seat, wire)).toEqual(input);
      }
      step(s, inputs);
    }
  });

  it("two bots box a full bout: head and body jabs, clean, blocked and slipped, to a result", () => {
    const g = boxing.create(11);
    const targets = new Set<string>();
    const outcomes = new Set<string>();
    for (let i = 0; i < 3 * ROUND_TICKS + 2 * BREAK_TICKS && !g.finished(); i++) {
      const ev = g.step([...g.botInputs(0).map((input) => ({ seat: 0 as const, input })), ...g.botInputs(1).map((input) => ({ seat: 1 as const, input }))]);
      for (const e of ev) {
        if (e.type === "hit") {
          targets.add(String(e.target));
          outcomes.add(String(e.outcome));
        }
      }
    }
    expect(targets).toEqual(new Set(["head", "body"]));
    expect(outcomes).toEqual(new Set(["clean", "blocked", "slipped"]));
    expect(g.finished()).not.toBeNull();
  });

  it("the bot reacts after a human-ish delay, guards the right height for the target, and sometimes slips a head jab", () => {
    let defended = 0;
    let wrong = 0;
    let slips = 0;
    let highs = 0;
    let lows = 0;
    const N = 200;
    for (let seed = 0; seed < N; seed++) {
      for (const target of ["head", "body"] as const) {
        const s = createState(seed);
        idle(s, 10 + (seed % 7));
        step(s, [punch(s, 0, target)]);
        // never on the very next tick
        expect(botDefence(s, 1)).toBeNull();
        expect(botInputs(s, 1).filter((i) => i.t !== "punch")).toEqual([]);
        const g = boxingFrom(s);
        for (let i = 0; i < JAB_WINDUP_TICKS + 2; i++) {
          const inputs = g.botInputs(1) as Array<{ t: string; guard?: Guard }>;
          for (const input of inputs) {
            if (input.t === "slip") {
              slips++;
              if (target === "body") wrong++;
            }
            if (input.t === "guard" && input.guard === "high") {
              highs++;
              if (target === "body") wrong++;
            }
            if (input.t === "guard" && input.guard === "low") {
              lows++;
              if (target === "head") wrong++;
            }
          }
          g.step(inputs.map((input) => ({ seat: 1 as const, input })));
        }
        const after = g.snapshot() as ReturnType<typeof snapshot>;
        if (after.lastHit && after.lastHit.outcome !== "clean") defended++;
      }
    }
    expect(wrong).toBe(0);
    expect(highs).toBeGreaterThan(0);
    expect(lows).toBeGreaterThan(0);
    expect(slips).toBeGreaterThan(0);
    // it defends some jabs in time but far from all: it stays beatable
    expect(defended).toBeGreaterThan(N * 2 * 0.05);
    expect(defended).toBeLessThan(N * 2 * 0.5);
  });

  it("the bot jabs mostly to the head, and more to the body when the other holds a high guard", () => {
    const share = (g: Guard) => {
      let head = 0;
      let all = 0;
      for (let seed = 0; seed < 40; seed++) {
        const s = createState(seed);
        if (g) step(s, [guard(0, g)]);
        for (let i = 0; i < 60 * 20; i++) {
          const inputs = botInputs(s, 1);
          for (const input of inputs) {
            if (input.t !== "punch") continue;
            all++;
            if (input.target === "head") head++;
          }
          step(s, inputs);
        }
      }
      return head / all;
    };
    expect(share(null)).toBeGreaterThan(0.6);
    expect(share("high")).toBeLessThan(0.4);
    expect(share("low")).toBeGreaterThan(0.75);
  });

  it("the bot is beatable: a player who jabs to the body when it is open wins most bouts", () => {
    // jab steadily to the body (the bot never holds a low guard unless it reads a body jab)
    let wins = 0;
    const N = 10;
    for (let seed = 1; seed <= N; seed++) {
      const s = createState(seed);
      let hand: Hand = "left";
      while (s.phase !== "over") {
        const inputs = botInputs(s, 1);
        if (s.tick % 20 === 0) {
          inputs.push({ t: "punch", seat: 0, hand, target: s.tick % 40 === 0 ? "body" : "head", at: s.tick * TICK_MS });
          hand = hand === "left" ? "right" : "left";
        }
        step(s, inputs);
      }
      if (s.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(N - 2);
    expect(BOT_PUNCH_CHANCE).toBeLessThan(1 / 20);
  });
});

// Playtest 2026-11-05: with health 100 two bots knocked each other out in
// about 15 seconds, so the three rounds never happened. Health is 500 now.
describe("boxing: a bout is worth watching", () => {
  it("bots trading jabs last well into the bout, and a good share go past round 1", () => {
    let pastRoundOne = 0;
    let seconds = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed++) {
      const s = createState(seed);
      while (s.phase !== "over" && s.tick < 60 * 400) step(s, [...botInputs(s, 0), ...botInputs(s, 1)]);
      seconds += s.tick / 60;
      if (s.round > 1) pastRoundOne++;
    }
    expect(seconds / N).toBeGreaterThan(45);
    expect(pastRoundOne).toBeGreaterThanOrEqual(N - 1);
  });
});
