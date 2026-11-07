---
name: review-game-idea
description: Reviews a proposed Weblympics game (or a big change to one) before anything is built, against the project's idea of good, the course brief and the 256 MB server. Use when the user pitches a new sport or event, asks "should we add X", or proposes a rule or control change to a game. Reports a verdict (build / build with changes / drop) in the chat.
---

# Review a game idea

Decide whether a proposed game is worth building, and in what shape, before
any code. Report in the chat; don't write files unless the user asks.

## 1. Read first

- `docs/game-review-criteria.md`: the criteria, personas and verdicts. This
  skill applies them; don't re-invent them.
- `README.md` (the definition of good), `CLAUDE.md` (rules and the games
  already built), `tasks/00-overview.md` (what is open, the deadline).
- The task file for this idea, if there is one (`tasks/NN-*.md`), and any
  ADR in `docs/adr/`.

If the pitch is a sentence or two, ask at most three questions that change
the verdict (usually: the camera move, how a point or win is decided, the
match length). Otherwise state your assumptions and go on.

## 2. Write the idea down in one paragraph

What the player does with their body, what the server decides, how a match
ends. If you can't write it plainly, that is the first finding.

## 3. Pick-up check (criteria A), through persona 1

Start an agent with no repo access (general-purpose, told not to read
any file), give it only persona 1 from the criteria and the paragraph from
step 2 written as the player would read it on screen (no code names), and
ask it:
- what would you try to do first, with your body and on keys?
- what would confuse you, and what would you need to be shown?
- would you want to play again with your friend? why or why not?

Then count the inputs yourself (A2, held states count) and compare with the
games already built (CLAUDE.md lists their controls).

## 4. The rest of the criteria

Go through B to F of `docs/game-review-criteria.md`. For an idea:
- **C:** write the exact client messages it would need and what the server
  owns. If a message would carry a claim (a hit, a score, a position), fail
  C1 and propose the input it should carry instead.
- **E:** estimate a room's cost against the measured baseline (idle 106 MB of
  256 MB; 60 Hz tick per room). Flag anything heavier than the games now
  running (many bodies, physics with many contacts, a large model).
- **F1:** list each camera number it will need and say it must come from a
  recording (`docs/camera-playtest.md`).
- **Fit:** does it carry the README's idea further, or is it one more game
  for its own sake? With the deadline (see `tasks/00-overview.md`) in view,
  say what it costs against finishing what is already open.

## 5. Report

```
## <Game>: <verdict>

<one paragraph: the idea as understood>

| Criterion | Result | Evidence |
|---|---|---|
| A1 Known move | pass/concern/fail | ... |
...

**What persona 1 said:** <2-4 lines, quoted>

**Changes needed before building:** <numbered, smallest first>
**Open questions for the user:** <only ones that change the build>
**Camera numbers to record:** <list>
```

Lead with the verdict and the one or two reasons that decide it. Rule
choices are the user's: recommend, don't decide.
