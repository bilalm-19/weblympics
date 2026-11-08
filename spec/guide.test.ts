import { describe, expect, it } from "vitest";
import { GUIDE, guideHtml, movesFor } from "../client/ui/guide.ts";
import { SPORTS } from "../client/ui/menu.ts";

// The how-to-play guide (task 35 item 3, built small; user, 2026-11-09). Pure:
// every sport has moves, every move has a picture, a camera line and a key.

describe("the guide's moves", () => {
  it("every sport on the home screen has a guide", () => {
    for (const s of SPORTS) expect(movesFor(s.id).length, s.id).toBeGreaterThan(0);
  });

  it("a game the guide doesn't know has no moves, so no button is added", () => {
    expect(movesFor("curling")).toEqual([]);
  });

  it("every move says what to do with the camera, which key does the same, and what the camera looks at", () => {
    for (const [game, moves] of Object.entries(GUIDE)) {
      for (const m of moves) {
        expect(m.camera.length, `${game} ${m.id} camera`).toBeGreaterThan(10);
        expect(m.keys.length, `${game} ${m.id} keys`).toBeGreaterThan(2);
        expect(["arm", "arms", "legs", "torso"], `${game} ${m.id} lit`).toContain(m.lit);
      }
    }
  });

  it("the move ids are unique within a game", () => {
    for (const [game, moves] of Object.entries(GUIDE)) expect(new Set(moves.map((m) => m.id)).size, game).toBe(moves.length);
  });

  it("tennis teaches the forehand and the backhand, boxing the jab, guard and lean, track the run and the jump", () => {
    expect(movesFor("tennis").map((m) => m.id)).toEqual(expect.arrayContaining(["forehand", "backhand"]));
    expect(movesFor("boxing").map((m) => m.id)).toEqual(["jab", "guard", "slip"]);
    expect(movesFor("track").map((m) => m.id)).toEqual(["run", "jump"]);
  });

  it("the keys named are the keys the games use (CLAUDE.md): boxing's J and K, track's A and D", () => {
    expect(movesFor("boxing")[0].keys).toMatch(/J/);
    expect(movesFor("boxing")[0].keys).toMatch(/K/);
    expect(movesFor("track")[0].keys).toMatch(/A and D/);
  });
});

describe("the panel's markup", () => {
  it("draws one outline figure per move, each with its own motion and the lit part", () => {
    const html = guideHtml(movesFor("boxing"));
    expect(html.match(/class="gd-fig"/g)).toHaveLength(3);
    expect(html).toContain('data-motion="jab"');
    expect(html).toContain('data-lit="arms"');
  });

  it("names the camera and the key for each move", () => {
    const html = guideHtml(movesFor("tennis"));
    expect(html).toContain("Camera:");
    expect(html).toContain("Keys:");
    expect(html).toContain("Forehand");
  });
});
