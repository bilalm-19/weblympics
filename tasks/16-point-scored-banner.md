# 16 Point-scored banner and reaction effects

Status: built 2026-10-21 by session B (agent); look at it in a real match. Earlier: queued (user confirmed 2026-10-21: the call shows big at the top first, e.g. "15 love"; the crowd and sound reactions are task 19)
Model: Opus
Session: B (after 15)
Waits on: nothing in the sim; touches the score bar (task 1) and the stage
(character.ts), so do it as one change

## Goal
When a point is scored the call appears across the top in bold, in tennis terms
("15-Love", "30-15", "Deuce", "Advantage", "Game"), without covering the court;
the players react.

## Scope
- **Top banner:** a bold call across the top of the game screen, clear of the
  court, the score bar, the camera dock and the timing meter, at 1920x1080 and
  390x844. It uses tennis wording: love for zero, "all" for ties ("30-all"),
  Deuce, Advantage <name>, Game, Set, Match. The score bar's existing
  announcement (task 1) is folded into it, not duplicated.
- **Reaction effects:** the player who loses the point gets a frustrated
  scribble over their head; the winner gets a fitting effect (for example
  sparkles or a fist pump, stronger for a game or set). Effects are drawn over
  the characters on the client from the server's score snapshot.
- **Local to each screen (the user's suggestion, and the right call):** effects
  are purely visual and driven by the snapshot each client already receives, so
  nothing is sent over the network and the server stays the only owner of the
  score. Each player sees them on their own screen; spectators see them too.
- Respects prefers-reduced-motion (a static mark instead of a scribble
  animation); the call is also in a live region for screen readers.

## Done when
- [x] Banner never overlaps the court or other HUD pieces at both viewports
      (`e2e/call-banner.e2e.ts`, keys and camera on).
- [x] Wording test: every score transition produces the right call (table,
      `spec/point-call.test.ts`, built from real `pointWon` / `fault` steps).
- [x] Effects show for loser and winner, both seats, bot points and spectators
      (e2e: practice vs bot, and a room with two seats and a spectator).
- [x] No new network messages (the e2e checks every frame sent against the
      allowed list; no protocol or server change).

## As built (agent, 2026-10-21)
- `point-call.ts` (pure): `pointCall(prev, next, name)` gives the call, a
  detail line ("Bot wins the point"), winner, loser and a weight (0 point,
  1 game, 2 set, 3 match); `reactions(call)` says who cheers and who is
  frustrated. Task 19 should drive the crowd and sounds from these two.
- Wording: Love for zero, server's score first ("Love-15", "30-all"), Deuce,
  Advantage <name>, Game, Set, "Game, set, match"; a tiebreak in numbers. A
  first-serve fault shows "Fault" (no reactions); a double fault shows "Double
  fault" with the score it leaves underneath.
- `call-banner.ts`/`.css`: bold, under the HUD's measured bottom, centred on a
  wide screen; on a phone it takes the band's full width, or the left of it
  while the camera preview is on. Gold for a game, set or match. It is the
  live region; the score bar's own call is gone (folded in, not duplicated).
- `reaction-fx.ts`: a scribble over the loser, sparkles over the winner (5 for a
  point, up to 17 for the match), both larger for bigger moments;
  `Player.react` in `character.ts` adds a fist pump and a slump. Reduced
  motion: no pop-in, the scribble and sparkles stand still, the fist is held up.
- Training has no score, so no banner.
