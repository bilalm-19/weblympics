# 29 Bowling

Status: parts 1-3 built (rules on `bowling-rules`, scene and view on `bowling-scene`, camera on `bowling-camera`, 2026-11-08) and merged on `integrate-rest` (2026-11-08), the camera replacing the scene's stub (part 4, integration; `main` moves after Claude's review). Camera numbers wait on the ten recordings. Design accepted (ADR 004). Runs in parallel with basketball (task 32).
Model: Opus 5.5 for every part
Waits on: nothing. Built without task 28; its podium replaces the end card later.

## Context
The user asked for bowling on 2026-11-05 with "faster matches". The first
plan (5 Nov) read the backswing from a seated player and waited on task 28.
It was reworked with the user on 2026-11-07/08 and reviewed with
`review-game-idea`; the design is `docs/adr/004-bowling.md`, the review and
decisions are in the devlog ("Bowling: game-idea review and decisions").

## Decided (user)
- 5 frames, real ten-pin scoring, alternate frames; 20 s shot clock.
- A tie: both players choose; either choosing draw makes it a draw, both
  choosing to continue bowls a tie frame (asked again if level); 15 s to
  choose, no choice counts as draw; the bot always continues.
- Server rolls the ball and pins; no random scatter.
- Camera: the underarm swing, standing, the camera placed to see the hips;
  the forward swing past the hip is the release and its speed; aim from the
  hand's position across the whole picture (walking works too), locked at
  the swing; curve from the hand's sideways sweep at release, read in a
  short window; steps and crouches allowed; fallback reads the rise past
  the chest when the hips aren't seen.
- Keys: left/right start spot, up/down curve, hold Space or the Bowl button.
- A partial guide: an arrow for the start and direction over the first
  third of the lane; the last ball's path stays drawn.
- Indoor alley, tennis's character, a simple end card now.
- Formats "game" (rated between two people) and "unlimited" (unrated).
- The review's changes: plain words ("Your turn"), a hips silhouette, the
  arrow follows the hand in the setup step, the release defined and shown,
  curve read only around the release, the speed and curve read shown after
  each ball.

## Claude's choices in the ADR, open to the user
- Messages `aim` and `throw` (the opponent and spectators see the arrow).
- A late throw counts within the round trip, capped at 150 ms.
- Tie frames have no bonus balls and aren't added to the score; the 15 s vote clock.
- The curve window about 0.15 s; the ball bends over the last third.

## Build split (agents, each in its own worktree from `main`)
1. **Rules** (first): `shared/games/bowling/` `sim.ts` (frames, scoring,
   turns, shot clock and late grace, the lane, the ball's path and bend,
   ball-pin and pin-pin collisions, gutters, tie frames, unlimited),
   `bot.ts` (solves aim, speed and curve for the pocket or the leftover
   pins, plus noise; beatable), `index.ts` (closed `asInput`, formats
   "game" and "unlimited"), registered in `shared/games/registry.ts`.
   `spec/bowling-*.test.ts`: scoring (strikes, spares, the fifth frame,
   perfect 150, gutter game 0), tie frames, turns, the clock and grace,
   messages dropped whole, off-turn and second throws ignored,
   determinism, a pocket ball at speed strikes, a straight pocket ball
   strikes less often than a curving one over a sweep of throws, a slow
   ball deflects, a gutter, a spare pickup possible, the bot beatable, a
   room plays a bot game to the end with `game: "bowling"`, a rated game
   moves only the bowling rating.
2. **Scene and view** (after 1): `client/games/bowling/` `alley.ts`,
   `view.ts` (behind-the-bowler camera, a pin-deck view after the throw,
   side-on for a spectator, the frame scoreboard, the arrow and last path,
   the speed zone and curve read, the call, keys and buttons), sound in
   the browser, `practice.ts` + `practice-sim.ts`, `bowling.css`; the menu
   tile goes live; reuses tennis's ready panel and character.
   `e2e/bowling-*.e2e.ts` at both viewports.
3. **Camera** (alongside 2): `client/input/camera/bowl-pose.ts` (aim across
   the picture, the release past the hip, speed, the curve window, the
   fallback; `spec/bowling-bowl-pose.test.ts` on synthetic landmarks),
   `client/games/bowling/bowl-camera.ts` (panel, hips check, setup step
   with the arrow, a `?debug` readout and recorder with the moves below).
4. **Integrate** (Claude).

## Recordings for the user (`docs/camera-playtest.md`), about 2 m back, hips in view
1. slow swing; 2. medium; 3. fast; 4. medium with a step and crouch;
5. straight with a natural follow-through (must read no curve); 6. curve
left; 7. curve right; 8. left-handed medium; 9. moving, no throw (picking
up, stretching, walking sideways); 10. medium at 1 m (the fallback).

## Done when
- [ ] Rules, bot and adapter registered; `spec/bowling-*.test.ts` green.
- [ ] Playable vs bot, vs a person by room code, spectated, and in practice,
      by keys, buttons and the fake-webcam setup, at both viewports.
- [ ] A finished "game" between two accounts is rated and moves only the
      bowling rating.
- [ ] Menu tile live; README, CLAUDE.md and spec agree.
- [ ] `pnpm check` and `pnpm e2e:gpu` green.
- [ ] The user's recordings replace the camera guesses.
