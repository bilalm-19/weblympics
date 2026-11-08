# 35 One way to play, a guide per sport, guided training per sport

Status: planned (2026-11-08), to start once the running agents' branches merge (they edit the same views).
Model: Opus 5.5
Waits on: basketball and bowling merged; 31 (track and archery looks) and 33 (customisation) merged, since the guides sit in every game's view.

## Decided (user, 2026-11-08)
1. **Tennis keeps only the default controls.** Remove "Follow my arm" (keep
   the classic swing) and "Aim by pointing" (keep aim by timing). Movement
   keeps "auto" as the default and leaning as the one optional mode.
   (This picks up part of the parked "fewer options" idea now.)
2. **Same input** (replaced by round 2's room option below).
3. **A guide for every sport,** easy to pull up at the side: the controls
   in a minimal UI, with an outline figure doing each action (tennis: the
   forehand and backhand swings) and the body parts the camera looks for
   highlighted. Also part of training.
4. **Guided training for every sport,** like tennis's Train: short steps,
   each action explained with the outline figure, tried, with feedback.
   Archery, track, boxing, basketball and bowling each get one; their
   existing practice vs the bot stays.

## Decided, round 2 (user, 2026-11-08)
- **Input rule is a room option, not a fixed rule:** "Camera vs camera",
  "Keyboard vs keyboard" or "Any". The host (in a party, the party leader)
  picks it before play, like the format; a change clears both ready flags.
  If a seat's input doesn't match the option, its Ready is blocked, with the
  reason on the ready panel ("This room is camera only: turn your camera
  on"). "Any" lets keys meet camera. Practice vs bot, training and
  spectators are unaffected. (The server can't prove which input someone
  uses; the rule is for honest players, stated as such.)
- **Guide:** as proposed (a "?" button, side panel on desktop, bottom sheet
  on a phone, outline figure looping each move with the tracked points lit,
  the key equivalent, pauses practice and training, not a live match), and
  **the same figure and motions appear in each training step**.
- **Training steps per sport:** as proposed (archery: aim, draw, release,
  read the wind; track: run, speed up, finish; boxing: head jab, body jab,
  high guard, low guard, lean; basketball: ready, aim, soft / right / hard;
  bowling: aim, swing, curve), plus **track's jump** once hurdles (task 27)
  is in.
- **Where training starts:** as tennis does now: the Train button on the
  home screen for every sport, and practice offering "Train first / Skip"
  once per device after the camera setup.
- **Track's jump** (for task 27, hurdles): elbows mode: both arms up at
  the same time is a jump; knees mode: jumping on the spot is a jump. Keys
  and a button too.
- **Calibration and saved settings** go to task 25 (below there).

## Design (Claude's proposal, superseded where round 2 says)
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
