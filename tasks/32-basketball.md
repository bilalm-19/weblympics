# 32 Basketball

Status: part 1 (rules) built on branch `basketball-rules`; part 2 (scene and view) built on `basketball-scene`, from it, with a stub `shoot-camera.ts` for part 3 to replace (agent, 2026-11-08); neither merged; parts 3-4 not done. Design accepted (ADR 003).
Model: Opus 5.5 for every part
Waits on: nothing. Task 28's podium can replace the end card later.

## Context
The user asked for basketball on 2026-11-07 (CLAUDE.md's "add another only
when I ask"): a shoot-off from different distances, turn by turn, an
outdoor court, fans cheering. The design and its reasons are
`docs/adr/003-basketball-shoot-off.md`; the review that shaped it is in the
devlog ("Basketball shoot-off: game-idea review", "Basketball: answers on
the review's changes").

## Decided (user, 2026-11-07)
- Five spots (4.6 m to 9 m), one shot each per spot, alternate, the first
  shooter swaps each spot. 2 inside the arc, 3 beyond, the deep spot a
  money ball of 4, +1 for a swish on any basket. Tie: sudden death from the
  deep spot. 15 s shot clock.
- Real rim and backboard physics on the server.
- An outdoor park court (fence, trees, sky), bleachers with a crowd that
  cheers on a make, louder on a swish or money ball, groans on a miss;
  sound made in the browser.
- A new home-screen tile (Bowling's placeholder stays).
- Camera: no setting. Any fast push of one hand or both is a shot; one
  standard animation. Stand about 1 m back; must work in tight spaces.
- Ready position: hands at the chest (user, over the chin).
- The review's changes: "no need to jump" and a ready cue; "push up and
  towards the hoop, like a real shot"; "Their shot, watch" off-turn; the
  power bar against the sweet zone after each shot; the floor arrow follows
  the hands in the setup step; the aim locks when the push starts; the
  sweet zone comes from the physics; the swish bonus stacks.

## Claude's choices in the ADR, open to the user
- Messages `set`, `aim` and `shoot` (`set` starts the clock and shows the
  ready cue on every screen; `aim` lets the opponent and spectators see the
  arrow).
- If no `set` arrives, the clock starts 5 s into the turn anyway.
- A shot after the buzzer counts within the seat's round trip, capped at
  150 ms (ADR 001's cap).
- No random scatter: the same shot always does the same thing.
- Spot names and the 7.25 m top three; sudden death's first shooter
  alternates.

## Build split (agents, each in its own worktree from `main`)
1. **Rules** (first; fixes the snapshot and messages the others build on):
   `shared/games/basketball/` `sim.ts` (spots, turns, shot clock, flight,
   rim and board, `makeWindow`, scoring, sudden death, unlimited), `bot.ts`
   (aims inside `makeWindow` plus noise; beatable), `index.ts` (adapter,
   closed `asInput`, formats "shootout" and "unlimited"), registered in
   `shared/games/registry.ts`. `spec/basketball-*.test.ts`: scoring, swish,
   the money ball, the turn order and swap, sudden death, the clock and the
   late-shot grace, messages dropped whole, off-turn and second shots
   ignored, determinism, a rim bounce in and out, a bank shot, the window
   narrowing with distance, the bot beatable. Rated by `isRated` with
   `game: "basketball"`.
2. **Scene and view** (after 1): `client/games/basketball/` `court.ts`
   (outdoor court from primitives, the hoop and chain net, bleachers and
   crowd reusing tennis's instanced crowd), `view.ts` (behind-the-shooter
   camera for a player, side-on for a spectator, the HUD and score board,
   the floor arrow, the power bar and its sweet zone, the call, "Your shot"
   / "Their shot, watch", keys, mouse and the Shoot button), sound in the
   browser, `practice.ts` + `practice-sim.ts` (in the page, nothing sent),
   `basketball.css`, the home tile and its looping SVG in `client/ui/menu.ts`;
   reuses tennis's ready panel. `e2e/basketball-*.e2e.ts` at both viewports.
3. **Camera** (alongside 2, after 1): `client/input/camera/shoot-pose.ts`
   (ready, aim, the push, the aim lock; unit tested on synthetic landmarks
   in `spec/basketball-shoot-pose.test.ts`), `client/games/basketball/
   shoot-camera.ts` (its panel, the setup step with the arrow, a `?debug`
   readout and recorder with the moves below).
4. **Integrate** (Claude): merge on one branch, CLAUDE.md (rules and
   layout), README, `pnpm check` and `pnpm e2e --workers=1`, the devlog.

## Recordings for the user (`docs/camera-playtest.md`), 1 m standing and seated
1. ready, two hands at the chest; 2. soft push, two hands; 3. medium;
4. hard; 5. medium, right hand only; 6. medium, left hand only;
7. moving, no shot (aim sway, scratching, cheering); 8. a chest pass
(nearly all forward). Measures: the wrist's upward speed in shoulder widths
a second, its peak, the frames the hands are seen, the aim offset.

## Done when
- [ ] Rules, bot and adapter registered; `spec/basketball-*.test.ts` green.
- [ ] Playable vs bot, vs a person by room code, spectated, and in practice,
      by keys, the button and the fake-webcam setup, at both viewports;
      `e2e/basketball-*.e2e.ts`.
- [ ] A finished "shootout" between two accounts is stored `rated = 1` with
      `game: "basketball"` and moves only the basketball rating.
- [ ] Menu tile live; README, CLAUDE.md and spec agree.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
- [ ] The user's recordings replace the camera guesses.
