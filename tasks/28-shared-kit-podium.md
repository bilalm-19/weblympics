# 28 Shared look kit and the podium

Status: planned (2026-11-05), waiting on the user's OK. Built first, before 29-31 start.
Model: Opus
Waits on: nothing. Tasks 29 (bowling), 30 (boxing) and 31 (looks) build on it.

## Context
The user (2026-11-05): track and archery "look too plain"; the characters
should be "like in tennis, what we set"; and "a cleaner end to a game, like a
pedestal the players stand on", in 3D. Track and archery draw their own
plain figures today; only tennis uses `character.ts`. Four agents will build
in parallel after this, so the pieces they all need are made once, here.

## Decided (user, 2026-11-05)
- The podium is a 3D scene, shared by every game.
- Every game uses the tennis character. There is no customisation yet (task
  18, waits on accounts), so the look comes from one per-seat palette; when
  18 lands it changes everywhere at once.

## Design (Claude's proposal)
- **`client/scene/`** (new, shared by every game; no game imports another):
  - `character.ts`: moved from `client/games/tennis/`. Tennis keeps working
    unchanged (a re-export or updated imports). Adds what the other games
    need: a held prop (`racket`, `bow`, `gloves`, `ball` or none), a run cycle
    (legs and arms, `run(phase, speed)`), and a few named poses (idle, cheer,
    wave, slump) for the podium and crowd-facing moments.
  - `looks.ts`: the per-seat palette (shirt, hair, trim), the one place a
    later profile (task 18) plugs in.
  - `crowd.ts`: the instanced crowd and stand pieces taken out of
    `stadium.ts`, as `buildStand(scene, {length, rows, at, facing})`, with a
    cheap idle bob and a `cheer()` burst. Tennis's stadium uses it.
  - `podium.ts`: the end-of-match scene (below).
- **Podium:** a 1st/2nd block in the game's own scene (no second renderer),
  the camera swings to it. Winner on the tall block cheering, runner-up
  clapping, confetti in Olympic colours (instanced quads, a few seconds).
  An HTML card over it: the result line per game (sets and games, the arrow
  total, the race times, the bowling score, the bout's rounds or KO), the
  best moment (best rally, best arrow, best time, best frame), and two
  buttons: **Rematch** (back to the room's ready check, which the server
  already does) and **Home** (leave). A draw (unlimited, or a tie) puts both
  on level blocks. Practice shows it with "Again" instead of "Rematch".
  Unlimited shows it to whoever is left when the other leaves.
  - API: `showPodium(scene, camera, {players, winner, lines, best, mode}, {rematch, home})`
    returns a disposer. Each game calls it from its own "over" handling;
    no protocol change (the result is already in each game's snapshot).
  - Keyboard: Rematch is focused first; Enter and Escape work. Reduced
    motion: no confetti, no camera swing.
- **Wire it into tennis** in this task (the others wire it in 29-31).

## Done when
- [ ] Tennis looks the same as before (e2e unchanged and green).
- [ ] `client/scene/` exists with character (props, run cycle, poses), looks,
      crowd and podium; CLAUDE.md layout updated.
- [ ] Tennis's match end shows the podium at both viewports; Rematch goes to
      the ready check, Home leaves (`e2e/podium.e2e.ts`).
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
