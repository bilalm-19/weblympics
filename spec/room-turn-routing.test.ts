// Basketball and bowling share two messages: a bare `aim` (no sight, unlike
// archery's) and the `tie` vote. The server hands both to `Room.turn`, which
// gives them to the room's own game; each game's own messages (`set`/`shoot`,
// `throw`) reach only that game.
import { describe, expect, it } from "vitest";
import { Room } from "../server/room.ts";
import type { Client } from "../server/room.ts";
import type { BasketballSnapshot } from "../shared/games/basketball/sim.ts";
import type { BowlingSnapshot } from "../shared/games/bowling/sim.ts";
import type { ServerMsg } from "../shared/protocol.ts";
import { powerFor } from "./basketball-helpers.ts";
import { gutterBall } from "./bowling-helpers.ts";

const COUNTDOWN = 100;

interface Fake extends Client {
  seen: ServerMsg[];
}

function client(token: string): Fake {
  const seen: ServerMsg[] = [];
  return { ws: { readyState: 1, send: (s: string) => seen.push(JSON.parse(s)) } as Fake["ws"], token, name: token, room: null, seat: null, rtt: null, pings: 0, outstanding: null, seen };
}

function seated(game: "basketball" | "bowling") {
  let now = 0;
  const room = new Room("TURN", game, false, game === "basketball" ? "shootout" : "game", {
    record: () => {},
    clock: () => now,
    log: () => {},
    timer: false,
    timing: { countdownMs: COUNTDOWN, graceMs: 500 },
    onDestroy: () => {},
  });
  const run = (ms: number) => {
    for (const end = now + ms; now < end; ) {
      now = Math.min(end, now + 16);
      room.pump();
    }
  };
  const a = client("a");
  const b = client("b");
  room.join(a);
  room.join(b);
  room.ready(a, true);
  room.ready(b, true);
  run(COUNTDOWN + 50);
  return { room, run, a, b };
}

const hoopState = (c: Fake) => c.seen.filter((m) => m.t === "state").at(-1)!.state as BasketballSnapshot;
const bowlState = (c: Fake) => c.seen.filter((m) => m.t === "state").at(-1)!.state as BowlingSnapshot;

describe("a bare aim and a tie vote reach the room's own game", () => {
  it("basketball: the aim moves the shooter's arrow; a bowling throw is dropped", () => {
    const s = seated("basketball");
    s.room.turn(s.a, { t: "set" });
    s.room.turn(s.a, { t: "aim", aim: 0.3 });
    s.room.turn(s.a, { t: "throw", speed: 0.7, aim: 0, spin: 0, at: 0 });
    s.run(100);
    expect(hoopState(s.b)).toMatchObject({ phase: "aim", turn: 0, set: true, aim: [0.3, 0] });
  });

  it("basketball: a tie vote reaches the shootout's vote", () => {
    const s = seated("basketball");
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 2000 && hoopState(s.a).phase !== "aim"; j++) s.run(16);
      const shooter = hoopState(s.a).turn === 0 ? s.a : s.b;
      s.room.turn(shooter, { t: "shoot", power: powerFor(hoopState(s.a).spot, "swish"), aim: 0, at: 0 });
      s.run(4500);
    }
    expect(hoopState(s.a).phase).toBe("tie-vote");
    s.room.turn(s.a, { t: "tie", choice: "continue" });
    s.run(100);
    expect(hoopState(s.b).vote!.votes).toEqual(["continue", null]);
  });

  it("bowling: the aim moves the bowler's start spot; a basketball set and shot are dropped", () => {
    const s = seated("bowling");
    s.room.turn(s.a, { t: "aim", aim: -0.4 });
    s.room.turn(s.a, { t: "set" });
    s.room.turn(s.a, { t: "shoot", power: 0.5, aim: 0, at: 0 });
    s.run(100);
    expect(bowlState(s.b)).toMatchObject({ phase: "aim", turn: 0 });
    expect(bowlState(s.b).aims).toEqual([-0.4, 0]);
  });

  it("bowling: a tie vote reaches the game's vote", () => {
    const s = seated("bowling");
    let thrownAt = -1;
    for (let i = 0; i < 20_000 && bowlState(s.a).phase !== "tie-vote"; i++) {
      const st = bowlState(s.a);
      if (st.phase === "aim" && st.tick !== thrownAt) {
        thrownAt = st.tick;
        s.room.turn(st.turn === 0 ? s.a : s.b, { t: "throw", ...gutterBall, at: 0 });
      }
      s.run(32);
    }
    expect(bowlState(s.a).phase).toBe("tie-vote");
    s.room.turn(s.b, { t: "tie", choice: "continue" });
    s.run(100);
    expect(bowlState(s.a).vote!.votes).toEqual([null, "continue"]);
  });
});
