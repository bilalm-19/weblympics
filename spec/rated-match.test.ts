// Task 7 end to end against the running app: the two demo accounts play a
// real rated one-set match (Demo One swings like the bot, from the server's
// own snapshots; Demo Two never swings, so Demo One wins every point),
// and a second session watching the leaderboard sees both ratings move within
// about a second of the match ending. Slow (a set takes a couple of
// minutes), so it is its own file.
import { describe, expect, inject, it } from "vitest";
import WebSocket from "ws";
import { botInputs } from "../shared/games/tennis/bot.ts";
import type { TennisSnapshot, TennisState } from "../shared/games/tennis/sim.ts";
import type { ServerMsg } from "../shared/protocol.ts";

const base = inject("baseUrl");
const origin = new URL(base).origin;
const wsUrl = new URL("/ws", base);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

async function demoCookie(n: 1 | 2): Promise<string> {
  const res = await fetch(new URL("/api/demo", base), { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ n }) });
  return res.headers.getSetCookie()[0].split(";")[0];
}

/** `plays`: swing at every ball the bot would, as seat 0, from each snapshot. */
async function connect(cookie: string, plays = false) {
  const ws = new WebSocket(wsUrl, { headers: { cookie } });
  const seen: ServerMsg[] = [];
  let lastSwingTick = -100;
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    // answer pings so the server keeps a round trip; drop game states to save memory
    if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", id: m.id }));
    else if (m.t !== "state") seen.push(m);
    else if (plays) {
      const snap = m.state as TennisSnapshot;
      const state = { ...snap, rng: 0 } as unknown as TennisState;
      for (const input of botInputs(state, 0)) {
        if (input.t === "swing" && snap.tick - lastSwingTick > 20) {
          lastSwingTick = snap.tick;
          ws.send(JSON.stringify({ t: "swing", dirX: input.dirX, kind: input.kind, level: input.level, tick: snap.tick }));
        }
      }
    }
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ t: "hello" }));
  return { ws, seen };
}

async function waitFor<T extends ServerMsg>(seen: ServerMsg[], ok: (m: ServerMsg) => boolean, ms = 5000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const i = seen.findIndex(ok);
    if (i !== -1) return seen.splice(i, 1)[0] as T;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Board = { you: { rating: number; wins: number; losses: number } | null; version: number };
const board = async (cookie: string): Promise<Board> => (await fetch(new URL("/api/leaderboard?sport=tennis", base), { headers: { cookie } })).json() as Promise<Board>;

describe("a rated match between two accounts (task 7, running app)", () => {
  it("moves both ratings when it ends, and a second session's board shows it within about a second", async () => {
    const [c1, c2] = [await demoCookie(1), await demoCookie(2)];
    const before = [await board(c1), await board(c2)];
    const start = before.map((b) => b.you ?? { rating: 1000, wins: 0, losses: 0 });

    const one = await connect(c1, true);
    const two = await connect(c2);
    one.ws.send(JSON.stringify({ t: "create", game: "tennis", practice: false }));
    const room = await waitFor<Extract<ServerMsg, { t: "room" }>>(one.seen, (m) => m.t === "room");
    two.ws.send(JSON.stringify({ t: "join", room: room.room }));
    await waitFor(two.seen, (m) => m.t === "room");
    one.ws.send(JSON.stringify({ t: "rated", rated: true }));
    const l = await waitFor<Extract<ServerMsg, { t: "lobby" }>>(one.seen, (m) => m.t === "lobby" && m.rated);
    expect(l.ratedBlocked).toBeNull();
    expect(l.ratings).toEqual([start[0].rating, start[1].rating]);
    one.ws.send(JSON.stringify({ t: "ready", ready: true }));
    two.ws.send(JSON.stringify({ t: "ready", ready: true }));

    // a second session polls the board every 100 ms; note when it changes
    let changedAt = 0;
    let stop = false;
    const watcher = (async () => {
      while (!stop) {
        const b = await board(c1);
        if (b.version !== before[0].version && !changedAt) changedAt = Date.now();
        await new Promise((r) => setTimeout(r, 100));
      }
    })();

    // the match ends when the room goes back to the ready check after playing
    await waitFor(one.seen, (m) => m.t === "lobby" && m.phase === "playing", 10_000);
    // anything older (the ready check before the start) is history now
    one.seen.length = 0;
    await waitFor(one.seen, (m) => m.t === "lobby" && !m.match && m.phase === "ready-check", 280_000);
    const endedAt = Date.now();
    while (!changedAt && Date.now() - endedAt < 3000) await new Promise((r) => setTimeout(r, 20));
    stop = true;
    await watcher;
    one.ws.close();
    two.ws.close();

    expect(changedAt).toBeGreaterThan(0);
    expect(changedAt - endedAt).toBeLessThan(1200);
    const after = [(await board(c1)).you!, (await board(c2)).you!];
    // one won and one lost; the changes are equal and opposite
    expect(after[0].wins + after[1].wins).toBe(start[0].wins + start[1].wins + 1);
    expect(after[0].losses + after[1].losses).toBe(start[0].losses + start[1].losses + 1);
    expect(after[0].rating - start[0].rating).toBe(-(after[1].rating - start[1].rating));
    expect(after[0].rating).not.toBe(start[0].rating);
    // and the history says so, rated
    const h = (await (await fetch(new URL("/api/history", base), { headers: { cookie: c1 } })).json()) as { matches: { rated: boolean; opponent: string }[] };
    expect(h.matches[0]).toMatchObject({ rated: true, opponent: "Demo Two" });
  }, 300_000);
});
