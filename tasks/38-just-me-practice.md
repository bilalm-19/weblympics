# 38 "Just me" practice for basketball, bowling and track

Status: built on `just-me-38` (agent, 2026-11-08); waiting for Claude to merge.
Model: Opus 5.5
Waits on: nothing (the sound agent, task 19, also touches these views: keep changes to the practice files).

## Decided (user, 2026-11-08)
- Like archery's practice: practice alone, unlimited, no bot. In-page,
  nothing sent to the server, never counted for stats.
- **Practice opens on "Just me"**; a "vs Bot" switch in the small practice
  panel (like archery's level picker) changes it any time. Practice vs the
  bot stays as it is.
- **Basketball:** no turns and no shot clock; shoot, the ball comes back,
  shoot again. Pick a spot (free throw ... deep) or "Cycle". Shows makes /
  shots and the current streak.
- **Bowling:** normal frames (two balls, spares and strikes count) played
  out alone, game after game, plus a "Reset pins each ball" switch to
  practise first balls only. Shows the frame score and a running total.
- **Sprint / hurdles:** run alone, no pacer, race after race; your time and
  your best time this session, either event.

## Done when
- [x] Each game's practice offers Just me (default) and vs Bot; specs for the solo sims (`spec/<game>-practice.test.ts`).
- [x] E2e at both viewports for each game's solo practice.
- [x] CLAUDE.md (practice lines) and README agree (README makes no practice claim).
