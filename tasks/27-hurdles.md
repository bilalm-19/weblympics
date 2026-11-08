# 27 Track: hurdles (second event)

Status: built on branch `hurdles-27` (2026-11-08), not merged; camera jump numbers are guesses until the recordings in `docs/camera-playtest.md` ("Hurdles' moves").
Model: Opus (sim), Sonnet for the view and pose
Session: later
Waits on: 26 (sprint)

## Decided (user, 2026-11-08)
- **The jump on camera:** elbows mode: both arms up together is a jump;
  knees mode: jumping on the spot is a jump. Keys and a button too. It
  goes in task 35's track training and guide.
- Nothing waits until after the deadline (user, 2026-11-08).

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

## Built (2026-11-08, agent)
- Ten hurdles 8.5 m apart from 13 m; a jump is 0.4 s in the air
  (`AIR_TICKS`) from the tick it arrives, costs 1 m/s; a hurdle reached on
  the ground falls and leaves 40% of your speed. Jump cap: 500 ms by the
  jump's timestamp, a server bucket of one refilling at 2 a second, none in
  the air. Race rule kept simple: pure sprint-with-hurdles, no bonus time.
- Ratings: none added (user, 2026-11-08: ratings are going, match stats
  only). Hurdles stays under track's sport id; a track match row stores
  `{ event, times, cleared, hit, sets }` in its `sets` JSON column (no
  schema step), so stats can tell hurdles from the sprint.

## Done when
- [x] Hurdles variant in `shared/games/track/` with specs: a clear, a hit,
      early and late jumps, a jump with no hurdle near, determinism.
- [x] `jump` in the protocol; the server never trusts a client's claim of a clear.
- [x] View, practice, keyboard, touch and camera jump; `e2e/track-hurdles.e2e.ts`
      at both viewports.
- [x] Event picker in the lobby; README, CLAUDE.md and `spec/` agree.
- [ ] The camera jump's numbers from a real recording.
