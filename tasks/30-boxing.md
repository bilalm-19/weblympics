# 30 Boxing

Status: in progress (2026-11-05). Playable in 2D (keys, buttons, practice, rooms); camera playtested on a real webcam (two recordings, a trial detector behind `?debug`); being reworked to ADR 002: the rules are in (jabs to head or body, high/low guard, the slip; sim, bot, keys, buttons, specs; rework items 1-3, camera slip still to record); the 3D ring and the detector for everyone are still to come. A "maybe": dropped if not solid by Sat 7 Nov night.
Model: Opus
Waits on: nothing (the 3D ring is built from primitives with the tennis character; task 28's kit can replace it later)

## Context
The user asked for boxing on 2026-11-05 as a maybe, after bowling. It is
the hardest game here to make fair over the network: two people hitting
each other in real time. So it is built vs the bot first, then two people.

## Decided (user, 2026-11-05: "sounds good")
- Three rounds of 30 s. Jab and hook. Guard with both hands up by the face;
  a blocked punch does little. A health bar each; knockout at zero, else
  points decide.

## Rework (user, 2026-11-05 playtest; docs/adr/002-boxing-judged-at-landing.md)
1. Jabs only (sim, keys, bot); a jab has a target, head or body.
2. Guard high / low / none; one arm up is no guard.
3. Slip: lean left or right; a head jab that lands while leaning misses; short, can't punch while leaning. Keys A/D; camera shoulder lean (recorded before its threshold is set).
4. 3D ring from primitives, the tennis character with gloves, first-person view behind your head; guards, slip and hits shown.
5. The camera's trial detector (hand-model jab, guards by height) on for everyone, not only `?debug`.
Movement around the ring is out (user picked the slip only).

### Contract for the rework (Claude, 2026-11-05; the sim and the 3D view are built against it)
- Inputs (client to server, seat from the connection): `{ t: "punch", hand: "left"|"right", target: "head"|"body", at }`, `{ t: "guard", guard: "high"|"low"|null }`, `{ t: "slip", side: "left"|"right" }`. Anything else, or any extra claim, is dropped.
- `BoxerSnapshot`: `health`, `guard: Guard` (`"high"|"low"|null`), `slip: { side, until } | null` (until is a tick), `slipReadyAt` (tick), `punches: Record<Hand, Punch|null>` with `Punch { hand, target, thrownTick, landsTick }`, plus the existing counters and `slipped` (head jabs this boxer made miss).
- `Hit { seat, hand, target, outcome: "clean"|"blocked"|"slipped", damage, tick }`; events `throw { seat, hand, target }`, `hit { seat, hand, target, outcome, damage }`, `slip { seat, side }`, `round`, `bout` as before.
- Landing: a head jab on a slipping boxer is "slipped" (0 damage); a head jab on a high guard or a body jab on a low guard is "blocked" (BLOCKED_SHARE of damage, rounded); otherwise "clean".
- Keys: J jab to the head, K jab to the body, hold Space high guard, hold L low guard, A slip left, D slip right; phone buttons for each.

## Design (Claude's first proposal, superseded where the rework says)
- **Server owns every hit.** The client sends `punch` (`jab` or `hook`,
  `hand`, its timestamp) and `guard` (up or down) events, never damage or a
  hit. A punch has a wind-up: a jab lands 200 ms after it is thrown, a hook
  350 ms. When it lands, the server checks the other boxer's guard at that
  moment in its own sim: guarded, 20% damage; open, full. So a guard you
  raise when you see the punch coming still saves you, and lag can't give
  either side an advantage the sim doesn't. Deterministic (seed + inputs).
- **Numbers (guesses for playtest):** health 100; jab 6, hook 14; a hand
  can't throw again until its punch lands plus 150 ms; guarding stops you
  punching. A cap on punch rate (like track's step cap) so flailing buys
  nothing. Stamina is left out to keep it simple.
- **Rounds:** 3 x 30 s with a 5 s break; knockout ends it at once. After 3
  rounds, most damage dealt wins; an exact tie is a draw (stored, rated
  as a draw only between two people). Each round's damage is shown in the
  break.
- **Formats:** "bout" (rated between two people) and "unlimited" (bout
  after bout, counts wins and knockouts, unrated). Practice vs the bot is
  never rated.
- **Bot:** reacts to a thrown punch by guarding after a human-ish delay,
  with noise; mixes jabs and hooks; easier in practice.
- **Keyboard / touch:** J jab, K hook (left hand with Shift), hold Space or
  L to guard; on a phone, Jab, Hook and Guard buttons.
- **Camera** (pure maths in `client/input/camera/box-pose.ts`, unit
  tested): a wrist moving fast away from its shoulder toward the screen
  (the wrist's z and its apparent jump from the shoulder) is a jab; a wrist
  sweeping fast across the body at shoulder height is a hook; both wrists
  held near the face is the guard. Laptop distance, upper body in view.
- **Client:** `client/games/boxing/` with `view.ts` (ring from primitives,
  ropes, corner posts, lights, crowd from the shared kit; first-person-ish
  camera behind your boxer's shoulder so you see the other's face and
  guard; health bars, round and clock, "KO!" banner), `ring.ts`,
  `box-camera.ts`, `practice.ts` + `practice-sim.ts`. The shared character
  with `gloves`. Podium at the end.
- **Specs:** `spec/boxing-sim.test.ts` (wind-up, guard at landing time, the
  punch cap, rounds, KO, decision, draw, determinism), `spec/boxing-room.test.ts`
  (a client can't send damage; reconnect pauses the round),
  `spec/boxing-box-pose.test.ts`, `e2e/boxing.e2e.ts` at both viewports.

## Done when
- [ ] Rules above, each in a spec.
- [ ] Playable vs bot first, then two people, then practice; keys, buttons
      and the camera panel; both viewports.
- [ ] A menu tile (takes the last "??" tile); README and CLAUDE.md agree.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
- [ ] Real-webcam playtest by the user.
