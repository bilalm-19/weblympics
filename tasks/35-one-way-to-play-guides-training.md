# 35 One way to play, a guide per sport, guided training per sport

Status: planned (2026-11-08), to start once the running agents' branches merge (they edit the same views).
Model: Opus 5.5
Waits on: basketball and bowling merged; 31 (track and archery looks) and 33 (customisation) merged, since the guides sit in every game's view.

## Decided (user, 2026-11-08)
1. **Tennis keeps only the default controls.** Remove "Follow my arm" (keep
   the classic swing) and "Aim by pointing" (keep aim by timing). Movement
   keeps "auto" as the default and leaning as the one optional mode.
   (This picks up part of the parked "fewer options" idea now.)
2. **Both players use the same input.** In a room, both players are on the
   camera or both on the keyboard; the ready-up waits until they match.
   Practice vs the bot, training and spectators are unaffected.
3. **A guide for every sport,** easy to pull up at the side: the controls
   in a minimal UI, with an outline figure doing each action (tennis: the
   forehand and backhand swings) and the body parts the camera looks for
   highlighted. Also part of training.
4. **Guided training for every sport,** like tennis's Train: short steps,
   each action explained with the outline figure, tried, with feedback.
   Archery, track, boxing, basketball and bowling each get one; their
   existing practice vs the bot stays.

## Design (Claude's proposal)
- **Same input (2):** each seat's input ("camera" or "keys") is part of the
  lobby state, set by the client when the camera turns on or off, shown on
  the ready panel ("Both on camera" / "Sam is on keys, you're on camera").
  Ready is refused while they differ, and switching mid-lobby clears both
  ready flags (like a format change). It is a lobby rule (`server/lobby.ts`,
  pure), so every game gets it; a spec covers it. Mid-match a switch is
  ignored by the rule (the match already started). The server can't prove
  which input someone uses, so this is an honest-player rule for fair
  matches, stated as such.
- **Guide (3):** one shared component `client/ui/guide/` (`guide.ts` +
  `.css`) and pure per-sport data (`guide-data.ts`): for each action its
  name, the key equivalent, one line of instruction, and a pose sequence
  for an SVG outline figure (head, torso, arms, legs as strokes) with the
  tracked landmarks (wrists, shoulders, hips, palms) highlighted as dots.
  A small "?" button on every game screen and in practice opens it as a
  side panel (a bottom sheet on a phone), never covering the court's middle
  or the HUD; Escape closes it; keyboard reachable; it pauses practice and
  training, not a live match. Actions per sport:
  - tennis: forehand, backhand, timing (early/on time/late), strength,
    lean to move (optional)
  - archery: aim with the front hand, draw, release, let down
  - track: run on the spot (elbows; knees)
  - boxing: jab head, jab body, high guard, low guard, lean (slip)
  - basketball: ready at the chest, aim, push up and towards the hoop
  - bowling: aim (hand or walk), the underarm swing, the curve sweep
- **Training (4):** one shared step runner reusing tennis's training
  pattern (`training.ts`, `lessons.ts`, `local-link.ts`): each sport a pure
  list of steps (show the guide's figure, ask for the action, detect it from
  the same messages a key or the camera sends, give feedback, move on),
  running in the page with nothing sent to the server. A "Train" button in
  each sport's options on the home screen. Tennis's training gets the same
  figure in its steps.

## Build split
- **Agent A: one way to play** (1 and 2): tennis camera panel and pose
  options, the lobby rule, the ready panel, specs and e2e; CLAUDE.md and
  README controls text.
- **Agent B: guides and training** (3 and 4): the guide component and data,
  the "?" button in every game, the training runner and five sports'
  steps, tennis training's figures; specs and e2e.
  A doesn't touch the guide or training; B doesn't touch the lobby or the
  tennis camera options.

## Done when
- [ ] Tennis's panel offers only the classic swing, aim by timing, and Move:
      auto/lean; old saved choices fall back to the defaults.
- [ ] The same-input rule in `spec/lobby.test.ts` and a room spec; the ready
      panel shows it; e2e at both viewports.
- [ ] Every sport has the guide, opened from "?" at both viewports, with the
      outline figure and highlights; e2e.
- [ ] Every sport has a guided training, nothing sent to the server; specs
      and e2e.
- [ ] CLAUDE.md, README and spec agree.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
