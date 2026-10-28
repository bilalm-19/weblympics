# 19 Crowd reactions and sound

Status: queued, to start on Opus 5.5 once the integration branch is green and
merged (user, 2026-10-29). Tasks 16 and 20 are built, so both of its inputs
exist; it must branch from the merged result, not from `main` before the merge.
Model: Opus 5.5 for all of it (design, audio module, wiring and tests)
Session: its own session (B and C are finished)

## Already built, use it
- **Task 16** (`client/games/tennis/point-call.ts`): `pointCall(prev, next, name)`
  returns the call, a detail line, winner, loser and a weight (0 point, 1 game,
  2 set, 3 match). `reactions(call)` returns who cheers and who is frustrated.
  Drive the crowd's sides and the sounds from these two, not a second copy.
  `reaction-fx.ts` and `Player.react` already draw the players' own reactions.
- **Task 20** (`client/games/tennis/crowd-layout.ts`, `stadium.ts`): the crowd is
  four sections, `left`, `right`, `frontLeft`, `frontRight`, as seen on screen,
  each an unbroken block of the instanced meshes, and `buildStadium()` returns a
  `crowd` handle with the meshes, each section's block and each person's rest
  position. The arena turns round for seat 1, so working out which seat a
  section belongs to is this task's job.
- **Archery shares the room code:** the room, banner and score logic is tennis's;
  archery has its own view, so sound for archery is out of scope here.

## Goal
The crowd reacts to every point, and you hear it.

## Decided (user, 2026-10-21)
- One side of the stands cheers and the other is down. The front stand is split
  in half by which player you are.
- The loser's side boos or shakes its head.
- Cheering has a sound. More sound effects overall. When you score, your side
  claps.
- Synthesise the audio with Web Audio, no asset files (my recommendation, the
  user asked for it). Keep every sound behind one small module so a few CC0
  clips could replace the boo or cheer later without touching anything else.

## Scope
- **Crowd (visual):** the stands are split by seat: seat one's side and seat
  two's side. Map `left`/`right` and the front pair to seats using the camera's
  orientation for the viewer's own seat (a spectator sees seat one on the left). After a point, the scorer's side cheers (arms up, jumping) and the
  other side boos and shakes heads. The front stand is half and half the same
  way. A game or set point is a bigger reaction. Spectators see it by seat, with
  seat one on the left and seat two on the right. Instanced, cheap, flat
  shaded; keep the frame rate.
- **Sound:** clapping (layered, delayed filtered-noise bursts), a crowd roar
  swell, a boo (low gliding tone under noise), and the extra effects: a clap for
  the scorer's side, a whistle or soft gasp on a fault, a light cheer on a good
  shot. Hit and bounce sounds if cheap.
- **Controls:** a mute toggle (remembered locally), a master volume, and audio
  that starts only after the first user gesture (browser autoplay rules).
  Muted means no audio nodes are created.
- **Local only:** driven by the score snapshot every client already receives.
  No new network messages (the spec on allowed messages must still pass). The
  server stays the only owner of the score.
- prefers-reduced-motion: the crowd still changes pose but without the jumping
  loop.

## Done when
- [ ] Crowd reaction table-tested: for each score change, which side cheers and
      which is down, for seat one, seat two, bot point, and a spectator.
- [ ] Sound module has a unit test (mute creates nothing; no audio before a
      gesture) and the sounds are a pure function of the score event.
- [ ] Both viewports; no horizontal scroll; the mute button reachable on a phone.
- [ ] Frame rate not lower than before in the trail e2e test.
- [ ] CLAUDE.md layout and README mention sound and the mute toggle.
