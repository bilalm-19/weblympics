// Task 34: a party's pure rules (server/party.ts): at most 10, a leader who
// passes the crown on leaving, leader-only settings, and the four ways of
// choosing who plays next. Randomness is injected so "randomise" is checked.
import { describe, expect, it } from "vitest";
import { Party } from "../server/party.ts";
import { MAX_PARTY } from "../shared/protocol.ts";

/** A seeded generator (mulberry32), so random draws repeat. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function party(n: number, rand = seeded(1)): Party {
  const p = new Party("p0", "tennis", rand);
  for (let i = 1; i < n; i++) p.join(`p${i}`);
  return p;
}

describe("members and the leader", () => {
  it("holds at most 10 (the watcher limit); a second join is a no-op", () => {
    expect(MAX_PARTY).toBe(10);
    const p = party(10);
    expect(p.size).toBe(10);
    expect(p.join("p10")).toBe("full");
    expect(p.join("p3")).toBe("already");
    expect(p.size).toBe(10);
  });

  it("member ids are the party's own, never the account's", () => {
    const p = party(3);
    for (const m of p.members) {
      expect(m.id).not.toContain(m.token);
      expect(m.id).toMatch(/^[a-z2-9]{8}$/);
    }
    expect(new Set(p.members.map((m) => m.id)).size).toBe(3);
  });

  it("the creator leads; when the leader leaves, the longest-standing member leads; the last one out ends it", () => {
    const p = party(3);
    expect(p.isLeader("p0")).toBe(true);
    expect(p.leave("p0")).toBe(false);
    expect(p.leader).toBe("p1");
    p.leave("p1");
    expect(p.leader).toBe("p2");
    expect(p.leave("p2")).toBe(true);
  });

  it("only the leader changes public, game, mode, picks or hands over the crown", () => {
    const p = party(3);
    expect(p.setPublic("p1", true)).toBe(false);
    expect(p.setGame("p1", "archery")).toBe(false);
    expect(p.setMode("p1", "pick")).toBe(false);
    expect(p.makeLeader("p1", p.member("p1")!.id)).toBe(false);
    expect(p.public).toBe(false);
    expect(p.game).toBe("tennis");
    expect(p.mode).toBe("winner");
    expect(p.setPublic("p0", true)).toBe(true);
    expect(p.makeLeader("p0", p.member("p2")!.id)).toBe(true);
    expect(p.isLeader("p2")).toBe(true);
    // the old leader no longer can
    expect(p.setGame("p0", "archery")).toBe(false);
  });

  it("starts invite-only, so nobody is listed until the leader makes it public", () => {
    expect(party(1).public).toBe(false);
  });
});

describe("who plays next", () => {
  it("nobody with one member; the first two to join with two or more", () => {
    expect(party(1).next()).toBeNull();
    expect(party(4).next()).toEqual(["p0", "p1"]);
  });

  it("winner stays on: the loser goes to the back, the next in line comes in", () => {
    const p = party(4);
    p.played(["p0", "p1"], "p1");
    expect(p.next()).toEqual(["p1", "p2"]);
    expect(p.order).toEqual(["p1", "p2", "p3", "p0"]);
    p.played(["p1", "p2"], "p1");
    expect(p.next()).toEqual(["p1", "p3"]);
    // a draw: both go to the back
    p.played(["p1", "p3"], null);
    expect(p.next()).toEqual(["p0", "p2"]);
  });

  it("both swap out: the two who played go to the back in order", () => {
    const p = party(4);
    p.setMode("p0", "swap");
    p.played(["p0", "p1"], "p0");
    expect(p.next()).toEqual(["p2", "p3"]);
    p.played(["p2", "p3"], "p3");
    expect(p.next()).toEqual(["p0", "p1"]);
  });

  it("two people: every mode just has them play again", () => {
    for (const mode of ["winner", "swap", "random"] as const) {
      const p = party(2);
      p.setMode("p0", mode);
      p.played(["p0", "p1"], "p1");
      expect(new Set(p.next())).toEqual(new Set(["p0", "p1"]));
    }
  });

  it("leader picks: only in that mode, only members, two different; the pick stays until changed", () => {
    const p = party(4);
    const id = (t: string) => p.member(t)!.id;
    expect(p.pick("p0", [id("p2"), id("p3")])).toBe(false);
    p.setMode("p0", "pick");
    expect(p.pick("p1", [id("p2"), id("p3")])).toBe(false);
    expect(p.pick("p0", [id("p2"), "nobody12"])).toBe(false);
    expect(p.pick("p0", [id("p2"), id("p2")])).toBe(false);
    expect(p.pick("p0", [id("p3"), id("p2")])).toBe(true);
    expect(p.next()).toEqual(["p3", "p2"]);
    p.played(["p3", "p2"], "p2");
    expect(p.next()).toEqual(["p3", "p2"]);
  });

  it("randomise: any two members, never the pair who just played when four or more are there", () => {
    const p = party(6, seeded(7));
    p.setMode("p0", "random");
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const before = p.next()!;
      p.played(before, before[0]);
      const after = p.next()!;
      expect(after[0]).not.toBe(after[1]);
      expect(after.some((t) => before.includes(t))).toBe(false);
      for (const t of after) seen.add(t);
    }
    // everyone gets a go
    expect(seen.size).toBe(6);
  });

  it("someone who leaves drops out of the order; the rotation carries on", () => {
    const p = party(4);
    p.leave("p1");
    expect(p.next()).toEqual(["p0", "p2"]);
    p.played(["p0", "p2"], "p2");
    expect(p.next()).toEqual(["p2", "p3"]);
    // a winner who left mid-way: both who played go to the back
    p.leave("p2");
    p.played(["p2", "p3"], "p2");
    expect(p.next()).toEqual(["p0", "p3"]);
  });
});
