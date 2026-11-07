---
name: review-game-build
description: Reviews whether a built Weblympics game's camera controls are intuitive, without a webcam: what the code needs from your body versus the real sport's move, what the screen tells a newcomer versus what the code needs, and what goes wrong (moves that misfire, clashes, no feedback). Use when the user asks to review, audit or check a game (tennis, archery, track, boxing, or a new one), or "is <game> intuitive". Reports per control in the chat, and asks for a ?debug recording where the evidence runs out.
---

# Review a built game

Judge whether each camera control is one a newcomer would get right, from
the code, the screen and the user's recordings. No agent plays on a
webcam: the user's playtests judge feel; this review tells them what to look
at. Report in the chat. Don't fix anything unless asked; a review that also
edits loses its outside view.

Argument: the game's registry id (`tennis`, `archery`, `track`, `boxing`).
If none is given, ask which.

## 1. Read first

- `docs/game-review-criteria.md` (criteria, personas, verdicts) and
  `docs/camera-playtest.md` (how recordings are made).
- `README.md` and the game's paragraphs in `CLAUDE.md`: the controls as
  promised.
- The game's camera code: its pose file in `client/input/camera/`
  (`pose.ts` tennis, `run-pose.ts` track, `box-pose.ts` boxing) or in the
  game's folder (`bow.ts` archery), and its camera panel
  (`client/games/<game>/*-camera.ts`, or `client/input/camera/index.ts`).
- Recordings in `docs/playtest/<game>-*.txt`, the game's ADR, and the last
  devlog entries naming it (`grep -n <game> logs/devlog.md`). Note every open
  playtest finding.

## 2. The controls in plain words

List each player action the camera reads (a stroke, a jab, a guard, a lean,
a step, a draw, a release). For each, write:
- **What the code needs:** the measure and its numbers, in body terms ("your
  palm must look 1.35x bigger than its resting size", "shoulders tilted 8
  degrees past where they were in the first second"), with `file:line`.
- **Where the number came from:** a recording (cite the file and the row),
  or a guess (say so).
- **The real move:** what a person who knows the sport does for this action.
- **Gap:** where the two differ (a move nobody would make, a move people make
  that doesn't count, a move they'd make bigger or smaller than the
  threshold).

Count the actions a player has to learn, held states included (criterion
A2).

## 3. What the screen tells a newcomer

Collect every word and picture a new player gets about the camera, from the
code: the camera setup steps, training or practice prompts, the HUD's hints,
any on-screen silhouette or demo. Quote them.

Then start two **fresh agents** in parallel (general-purpose), each told:
"Do not read any file. You only know what is given here."
- **The skipper** (persona 1): its persona word for word, and only the
  button labels, headings, picture descriptions and animations, no
  paragraphs.
- **The reader** (persona 2): its persona word for word, and every quoted
  word in the order a player meets it.

Ask each, for every action the game needs: what exactly would you do with
your body, how big and how fast? And which actions would you not know how
to do at all?

Compare their answers with step 2's "what the code needs". Each mismatch is
a place a new player fails. Skip the skipper for a wording-only change.

## 4. Tight space, patchy wifi, smoothness

Personas 3 to 5 from the criteria, worked out by you from the code:
- **Tight space:** for each move, at mid-chest framing about 50 cm away:
  is the landmark in frame and tracked (the recordings' "seen" share), and
  does the move clear its threshold at that size? Note any assumption of
  standing, one hand or good light.
- **Patchy wifi:** trace one on-time move at 150 to 300 ms of lag with
  jitter: does it count (the lag rule, ADR 001), what does the opponent
  see, and what does a 2 s dropout do? Read the game's timing and the
  room's hold in `server/room.ts` and `server/lobby.ts`.
- **Smoothness:** add up the delay from the move to the screen with each
  part's source (camera frame rate, how often the model runs, the
  detector's waits and cooldowns, the sim's wind-up or recovery, the 60 Hz
  tick, the animation). Say where the player waits on the game.

Skip patchy wifi and smoothness when only instructions or thresholds
changed.

## 5. What goes wrong

From the code and the recordings:
- **False reads:** does normal play cross a threshold? Check the recorded
  "moving, no action" and neighbouring moves against each threshold (a
  guard read as jabs, a sway read as a lean, a wind-up read as a swing).
- **Missed reads:** is the real move's typical value only just past the
  threshold, or is the body part lost on many frames (the "seen" share)?
- **Clashes:** does one control silently block another (leaning stops
  punching, a guard stops a swing)? Does the player see why?
- **Feedback:** after a move, does the screen show what was read (or that
  nothing was), quickly enough to correct the next one?
- **Body and setup:** does it assume standing, a full-body view, good light,
  one handedness, or a mirrored picture? A laptop webcam with the player
  seated sees to mid-chest.

## 6. Ask for a recording where the evidence runs out

When a finding can't be settled from the code and the existing recordings,
name the recording that would settle it, following
`docs/camera-playtest.md`: the moves to record, one at a time (for example
"relaxed", "guard held, no punch", "lean left and hold", "jab, head"), what
measure to look at and what it should show. If the game has no `?debug`
recorder yet (only boxing has one, in `client/games/boxing/box-camera.ts`),
say that one is needed and what it should record for this game. If one
summary line per move isn't enough to replay a move through the detector,
say a per-frame trace is needed.

## 7. Report

```
## <Game>: <intuitive | fix the instructions | change controls>

<two sentences: the verdict and what decides it>

| Action | What the code needs | Real move | Screen says | Skipper would | Reader would | Result |
|---|---|---|---|---|---|---|
| Jab | palm 1.35x resting size (box-pose.ts:NN, recorded) | ... | ... | ... | ... | intuitive / instructions / change move |

### Problems, worst first
1. <what a newcomer would do and why it fails> — evidence: <file:line,
   recording row, quote> — smallest fix: <instruction wording, threshold
   from which recording, or a different move>

**Tight space:** <moves that fail seated and close, or "all fine">
**Patchy wifi:** <what happens at 300 ms and on a 2 s dropout>
**Smoothness:** move to screen <n> ms (<biggest parts>)
**Inputs to learn:** <n> (<list>)
**Guesses still in the controls:** <numbers with no recording>
**Recordings to make:** <move list and what each should show, or "none">
**For your next playtest:** <3-5 things to try and watch for>
**Open playtest findings:** <from the devlog: still explained by the code,
or fixed>
```

Rule and control choices are the user's: recommend, don't decide. If a
finding shows a rule missing from `docs/game-review-criteria.md`,
`CLAUDE.md` or `spec/`, say which file it belongs in.
