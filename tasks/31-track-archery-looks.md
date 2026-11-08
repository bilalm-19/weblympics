# 31 Track and archery looks

Status: planned (2026-11-05); no longer waits on 28 (user, 2026-11-08). Both halves built (2026-11-08, agents): track on `track-looks-31` (stadium, runners, crowd), archery on `archery-looks-31` (range, flags, crowd, the archer over the shoulder); both merged on `integrate-rest` (2026-11-08). Podium and end card wait on 28.
Model: Sonnet (one agent per game, in parallel)
Waits on: nothing (user, 2026-11-08). Uses tennis's character and crowd pieces directly, as boxing, basketball and bowling do; a simple end card now, task 28's podium later.

## Context
The user (2026-11-05): "everything looks too plain, I want some more colour,
detail, maybe an audience; the characters, like in tennis, should be what we
set." Same style as tennis: low-poly, flat-shaded, primitives and instancing,
no post-processing, no heavy assets, fine on a phone.

## Design (Claude's proposal)
- **Track** (`client/games/track/lane.ts`, `view.ts`):
  - A stadium: red tartan lanes with white lines and lane numbers, a green
    infield, stands down the far side and behind the finish with the shared
    crowd (cheering harder as the runners near the line), flags, a finish
    arch with a clock showing the race time, a start line with blocks.
  - Runners are the shared character with the run cycle, in the seat
    colours, stride and arm swing following the server's speed.
  - Bright sky and warm light; the chase camera unchanged.
  - The podium at the race's end (and at the end of unlimited).
- **Archery** (`client/games/archery/range.ts`, `view.ts`):
  - An outdoor range: grass with mown stripes, a tree line and low hills,
    a few colourful target butts at the other distances, a wooden shooting
    line, flags on poles along the range that stream with the wind (an
    honest cue matching the wind dial), a small stand of the shared crowd to
    the side who cheer a 10 or a bullseye.
  - The shooter is the shared character with the bow (it shows in the
    over-the-shoulder view and on the turn swap); the first-person bow is
    unchanged.
  - The podium at the match end.
- **Budget:** each scene keeps the frame rate of today's on the e2e's
  software renderer; crowds are instanced.

## Done when
- [ ] Both scenes as above, at both viewports, no gameplay change (all the
      game's specs and e2e unchanged and green).
- [ ] Screenshots before and after in the devlog entry.
- [ ] `pnpm e2e --workers=1` green.
