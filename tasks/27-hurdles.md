# 27 Track: hurdles (second event)

Status: planned (2026-10-29), not built.
Model: Opus (sim), Sonnet for the view and pose
Session: later
Waits on: 26 (sprint)

## Context
The second event of the `track` game. Same lane, steps and camera as sprint,
plus obstacles and a jump. Because task 26 builds the sim with an empty
obstacle list, this task fills the list and adds the jump.

## Design (Claude's proposal)
- **Obstacles:** about 10 hurdles at fixed spacing per lane.
- **Jump event:** the client sends `jump` with a timestamp. The sim gives a
  fixed airtime and distance scaled by speed, and a small speed cost so
  spamming does not pay.
- **Clear or hit:** airborne when crossing a hurdle clears it; otherwise the
  hurdle falls and you stumble (lose speed). Early and late jumps both cost.
  The server resolves this from timestamps against its own sim.
- **Race:** first across the line wins. Open: pure sprint-with-hurdles, or
  clean clears give bonus time.
- **Keyboard / touch:** `Space` or a jump button.
- **Camera jump:** the shoulder/hip midpoint rising quickly above the
  calibrated standing height, added to `run-pose.ts`.
- **Client:** jump pose and a falling-hurdle animation; the HUD adds hurdles
  cleared.

## Done when
- [ ] Hurdles variant in `shared/games/track/` with specs: a clear, a hit,
      early and late jumps, a jump with no hurdle near, determinism.
- [ ] `jump` in the protocol; the server never trusts a client's claim of a clear.
- [ ] View, practice, keyboard, touch and camera jump; `e2e/track-hurdles.e2e.ts`
      at both viewports.
- [ ] Event picker in the lobby; README, CLAUDE.md and `spec/` agree.
