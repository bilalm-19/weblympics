// Task 32's tie vote (user, 2026-11-08, like bowling's): level after the five
// spots, both players pick Draw or Continue (sudden death). The panel
// (client/games/basketball/tie-vote.ts) is drawn from a snapshot with
// phase "tie-vote" and sends only { t: "tie", choice }; a spectator gets no
// buttons. The snapshot's vote fields come from the rules branch; here they
// are built by hand in the agreed shape.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createTiePanel } from "../client/games/basketball/tie-vote.ts";
import type { TieChoice, WithVote } from "../client/games/basketball/tie-vote.ts";
import { createState, snapshot } from "../shared/games/basketball/sim.ts";

function tieSnap(votes: [TieChoice | null, TieChoice | null], ticksLeft = 15 * 60): WithVote {
  return { ...snapshot(createState(1)), phase: "tie-vote", totals: [9, 9], vote: { votes, ticksLeft }, draw: false };
}

function panel(seat: 0 | 1 | null) {
  const doc = new JSDOM("<!doctype html><body></body>").window.document;
  const sent: TieChoice[] = [];
  const p = createTiePanel(doc, seat, (c) => sent.push(c), (s) => (s === 0 ? "Ana" : "Ben"));
  doc.body.append(p.el);
  const button = (c: TieChoice) => p.el.querySelector<HTMLButtonElement>(`[data-choice="${c}"]`);
  return { p, sent, button };
}

describe("basketball tie vote", () => {
  it("is hidden outside the vote", () => {
    const { p } = panel(0);
    p.update({ ...snapshot(createState(1)) });
    expect(p.el.hidden).toBe(true);
  });

  it("asks both players, counts down from ticksLeft and sends the choice once", () => {
    const { p, sent, button } = panel(0);
    p.update(tieSnap([null, null], 14 * 60 + 1));
    expect(p.el.hidden).toBe(false);
    expect(p.el.querySelector("h2")!.textContent).toBe("Level! Draw, or go to sudden death?");
    expect(p.el.querySelector(".bb-tie-clock")!.textContent).toBe("15 s");
    expect(p.el.textContent).toContain("They're choosing…");
    button("continue")!.click();
    expect(sent).toEqual(["continue"]);
    // after choosing: my choice shown, both buttons disabled, a second press sends nothing
    expect(button("continue")!.getAttribute("aria-pressed")).toBe("true");
    expect(button("draw")!.disabled).toBe(true);
    expect(p.el.querySelector(".bb-tie-mine")!.textContent).toBe("You chose: continue");
    button("draw")!.click();
    expect(p.key("KeyD")).toBe(true);
    expect(sent).toEqual(["continue"]);
  });

  it("shows the other player's choice once they've made it", () => {
    const { p } = panel(1);
    p.update(tieSnap(["continue", null]));
    expect(p.el.querySelector(".bb-tie-votes")!.textContent).toBe("They chose: continue");
  });

  it("takes D and C as keys", () => {
    const a = panel(0);
    a.p.update(tieSnap([null, null]));
    expect(a.p.key("KeyD")).toBe(true);
    expect(a.sent).toEqual(["draw"]);
    const b = panel(1);
    b.p.update(tieSnap([null, null]));
    expect(b.p.key("KeyC")).toBe(true);
    expect(b.sent).toEqual(["continue"]);
    // outside the vote the keys are left alone
    const c = panel(0);
    c.p.update({ ...snapshot(createState(1)) });
    expect(c.p.key("KeyD")).toBe(false);
    expect(c.sent).toEqual([]);
  });

  it("keeps a choice the server already holds (a reload mid-vote)", () => {
    const { p, button } = panel(0);
    p.update(tieSnap(["draw", null]));
    expect(button("draw")!.getAttribute("aria-pressed")).toBe("true");
    expect(button("continue")!.disabled).toBe(true);
  });

  it("gives a spectator both choices and no buttons", () => {
    const { p, sent } = panel(null);
    p.update(tieSnap(["draw", null]));
    expect(p.el.hidden).toBe(false);
    expect(p.el.querySelectorAll("button")).toHaveLength(0);
    expect(p.el.querySelector(".bb-tie-votes")!.textContent).toBe("Ana: drawBen: choosing…");
    expect(p.key("KeyC")).toBe(false);
    expect(sent).toEqual([]);
  });
});
