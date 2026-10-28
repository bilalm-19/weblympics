# 26 Track: sprint (first event)

Status: in progress (2026-10-29): sim, bot, adapter and rooms built and specced.
Model: Opus (sim and protocol), Sonnet for the view
Session: later
Waits on: nothing. Task 27 (hurdles) builds on this.

## Context
"Track" is one game with two events: sprint (this task) and hurdles (task 27).
You run on the spot and race along a lane. The user asked for it on
2026-10-29, which is the "add another only when I ask" go-ahead in CLAUDE.md.
Sprint ships first as the hurdles sim with an empty obstacle list, so nothing
is thrown away.

## Decided (user, 2026-10-29)
- One game, id `track`, in `shared/games/track/` (sim, bot, adapter),
  registered in the registry. The event is a variant: `sprint` now, `hurdles`
  in task 27. One set of specs (`spec/track-*.test.ts`) and e2e
  (`e2e/track-*.e2e.ts`).
- Sprint first, hurdles later.
- **Two camera run modes, "knees" and "elbows", picked by playtest.** Both are
  built behind a setting; the playtest decides the default and the loser may
  be removed (log it in the devlog).

## Design (Claude's proposal, to settle in the build)
- **Sim:** a lane per seat, fixed length. The sim has an obstacle list from
  day one (empty for sprint). Input is `step` events with a timestamp. Speed
  rises with a smoothed cadence and decays when you stop. Steps must alternate
  sides and the rate is capped at a human maximum, so shaking cannot cheat.
  First across the line wins; times are recorded. Lanes never interact.
- **Server owns position.** Clients send steps, never distance or a finish.
  Deterministic (seed + input stream); the seed only drives the bot.
- **Formats** (`GameDef.formats`): "race" (rated vs a human) and "unlimited"
  (repeated runs, counts best time, unrated). Practice vs bot is never rated.
- **Bot:** target cadence with noise, like archery's `solveAim`.
- **Keyboard / touch (required equivalent):** alternate `A`/`D` (or left/right
  arrows), or two tap buttons on mobile.
- **Camera:** pure landmark maths in `client/input/camera/run-pose.ts`.
  - Knees mode: a knee rising above its calibrated rest height counts as a
    step; needs legs in frame, so the setup panel says to step back.
  - Elbows mode: alternating arm pumps (elbow or wrist height against the
    shoulder) count as steps; works at laptop distance.
  - A stand-still calibration step, like `bow-camera.ts`. With no camera the
    lobby and room still work.
- **Client:** `client/games/track/` with `view.ts`, `lane.ts` (low-poly lane,
  reuses `character.ts` for the runner plus a run cycle), HUD (distance bar,
  speed, time), `practice.ts` + `practice-sim.ts` (in the page, nothing sent
  to the server). Reuses tennis's ready panel. Side-on chase camera showing
  both lanes at 390x844 and 1920x1080.

## Still open
- Cadence-to-speed curve, step cap, lane length and bot cadence (tune by
  playtest).
- Knees vs elbows default.
- Whether a false step (no alternation) costs time or is ignored.

## Done when
- [x] `shared/games/track/` sim, bot and adapter, registered; `spec/track-*.test.ts`
      cover cadence to speed, alternation, the cadence cap, finish, determinism,
      and no rating vs the bot.
- [x] Rooms, lobby, reconnect hold and spectators work through the same server code.
- [ ] Client view at both viewports, keyboard and touch; `e2e/track-sprint.e2e.ts`.
- [ ] Practice runs in the page with nothing sent to the server.
- [ ] Camera knees and elbows modes both work with the fake webcam; `run-pose.ts`
      unit-tested.
- [ ] Menu tile, CLAUDE.md layout, README and `spec/` agree.
- [ ] Playtest both camera modes on a real webcam; pick the default; devlog it.
