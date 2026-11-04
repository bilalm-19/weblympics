# 29 Bowling

Status: planned (2026-11-05), waiting on the user's OK on the rules.
Model: Opus for the sim and camera; Sonnet for the view
Waits on: 28 (shared character, podium)

## Context
The user asked for bowling on 2026-11-05 (CLAUDE.md's "add another only when
I ask"), with "faster matches". The home menu already has a "Bowling, coming
soon" tile; this makes it playable.

## Decided (user, 2026-11-05)
- **5 frames**, not 10, so a match is quick.

## Design (Claude's proposal)
- **Rules:** real ten-pin scoring on 5 frames: two balls a frame, a strike
  scores 10 plus the next two balls, a spare 10 plus the next ball; the 5th
  frame gives bonus balls (up to 3 balls), so a perfect game is 150.
  Players alternate frames, seat 0 first. Higher total wins; a tie bowls
  one more frame each (sudden death, like archery's), repeating until it
  breaks. A 20 s shot clock: a ball not thrown in time rolls a gutter.
- **Server owns the pins.** The client sends one `throw` event: `speed`
  (0..1), `aim` (lateral start, -1..1), `curve` (-1..1) and its timestamp.
  The server clamps each, rolls the ball and knocks the pins in its own
  deterministic sim (seeded; simple 2D circle physics on the lane, ball and
  pin collisions plus pin-pin, a little seeded scatter so the same throw
  isn't always the same), and scores it. The client animates what the server
  says. Lanes are separate: players take turns on one lane, the other
  watches.
- **Formats** (`GameDef.formats`): "game" (5 frames, rated between two
  people) and "unlimited" (game after game, counts games won and best score,
  unrated). Practice vs bot never rated.
- **Bot:** picks a target (the pocket) and solves speed/aim/curve, plus
  noise (like archery's `solveAim`); it sometimes leaves a spare to pick up.
- **Keyboard / mouse / touch:** left/right (or drag) to move your start
  spot, hold Space (or the Bowl button) to swing: a power meter fills and
  falls; release to throw. Up/down sets curve. Same `throw` event.
- **Camera** (pure maths in `client/input/camera/bowl-pose.ts`, unit tested
  on synthetic landmarks): an underarm swing of the bowling arm. The wrist
  going back past the hip, then forward and up past the hip, is a throw;
  `speed` is the wrist's peak speed through the bottom (in shoulder widths
  a second); `aim` is where the body stands across the frame at release;
  `curve` is the wrist's sideways drift through the release. A slow swing
  is a slow ball; no swing, no throw. Laptop distance with the arm in view.
- **Client:** `client/games/bowling/` with `view.ts` (lane, pins, ball
  return, pin deck camera after the throw, scoreboard of frames and running
  totals, the turn), `alley.ts` (alley from primitives: polished lane,
  gutters, pins, bowlers' area, neon signs, crowd from the shared kit),
  `bowl-camera.ts`, `practice.ts` + `practice-sim.ts` (in the page, nothing
  sent). The shared character with a `ball` prop. Podium at the end.
- **Specs:** `spec/bowling-scoring.test.ts` (strikes, spares, the 5th
  frame, sudden death), `spec/bowling-sim.test.ts` (determinism, clamps, a
  straight pocket throw strikes most of the time, a gutter scores 0, the
  shot clock), `spec/bowling-room.test.ts` (turns, a client can't send pins
  or a score, reconnect), `spec/bowling-bowl-pose.test.ts`, and
  `e2e/bowling.e2e.ts` at both viewports.

## Done when
- [ ] Rules above, each in a spec that fails without it.
- [ ] Playable vs bot, vs a person by room code, and in practice, by keys,
      buttons and the fake-webcam setup panel, at both viewports.
- [ ] The menu tile is live; README, CLAUDE.md (rules and layout) agree.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
- [ ] Real-webcam playtest by the user (the swing thresholds are guesses).
