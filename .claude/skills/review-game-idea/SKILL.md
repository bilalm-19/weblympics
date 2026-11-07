---
name: review-game-idea
description: Reviews a proposed Weblympics game, or a new or changed camera control in one, before it is built: would a newcomer know the move, can the server own the result, does it fit the project's idea of good and the 256 MB server. Use when the user pitches a new sport or event, asks "should we add X", or proposes a rule or control change. Reports a verdict (build / build with changes / drop) in the chat.
---

# Review a game idea

Decide whether a proposed game or control is worth building, and in what
shape, before any code. Report in the chat; don't write files unless asked.

## 1. Read first

- `docs/game-review-criteria.md` (criteria, personas, verdicts) and
  `docs/camera-playtest.md` (how camera numbers are recorded).
- `README.md` (the definition of good), `CLAUDE.md` (rules, and the games
  and controls already built), `tasks/00-overview.md` (what is open, the
  deadline).
- The idea's task file if there is one (`tasks/NN-*.md`), and any ADR.

If the pitch is a sentence or two, ask at most three questions that change
the verdict (usually: the camera move, how a point or win is decided, the
match length). Otherwise state your assumptions and go on.

## 2. The idea in one paragraph

What the player does with their body, what the server decides, how a match
ends. If you can't write it plainly, that is the first finding.

## 3. Are the moves intuitive?

List each action the camera would read. For each:
- **The real move:** what someone who knows the sport does.
- **What the camera would measure:** the landmark and the kind of threshold
  (a hand rising, a palm growing, a shoulder tilt), and whether a laptop
  webcam with a seated player can see it (it sees to mid-chest).
- **Risk:** a normal movement that would cross it by accident, or a real
  move too small or too hidden to read.

Count the actions, held states included (A2), and compare with the games
already built.

Then start one **fresh agent** (general-purpose) with only persona 1 from
the criteria and the paragraph from step 2 written as the player would read
it on screen (no code names). Tell it: "Do not read any file." Ask: what
would you do with your body for each action, what would confuse you, and
would you play again with your friend? Where its answers differ from what
the camera would measure, a newcomer will fail.

## 4. The rest of the criteria

Go through B to F of `docs/game-review-criteria.md`. For an idea:
- **C:** write the exact client messages and what the server owns. A message
  carrying a claim (a hit, a score, a position) fails C1: propose the input
  it should carry instead.
- **E:** compare a room's cost with the games running now (measured idle
  106 MB of 256 MB; a 60 Hz tick per room). Flag anything heavier.
- **Fit:** does it carry the README's idea further, or is it one more game
  for its own sake? With the deadline in view, say what it costs against
  finishing what is already open.

## 5. Recordings to make before building

Every camera number will start as a guess. List the recordings that would
replace them (`docs/camera-playtest.md`): each move to record, the
"moving, no action" recording that must stay below the threshold, and the
measure to compare. If the user could record them with an existing game's
`?debug` recorder (boxing's, in `client/games/boxing/box-camera.ts`), say
so; it can settle a risky move before any code is written.

## 6. Report

```
## <Game>: <build | build with changes | drop>

<one paragraph: the idea as understood>

| Action | Real move | Camera would measure | Risk | Result |
|---|---|---|---|---|

| Criterion | Result | Evidence |
|---|---|---|

**What persona 1 said:** <2-4 lines, quoted>
**Inputs to learn:** <n>
**Changes before building:** <numbered, smallest first>
**Recordings to make first:** <list>
**Open questions for the user:** <only ones that change the build>
```

Lead with the verdict and the one or two reasons that decide it. Rule
choices are the user's: recommend, don't decide.
