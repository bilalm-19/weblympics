# Measuring a camera control on a real webcam

How we set a camera threshold from a real body instead of guessing. First used
for boxing (task 30, 2026-11-05); reusable for any game's camera maths.

## Why
The test webcam has nobody in it, so a threshold only tested on synthetic
landmarks is a guess. Boxing's first guesses missed a real hook entirely.
Screenshots of live numbers didn't work either: you can't hold a guard and
take a screenshot, so the "now" column was empty and the peaks caught the
moment you dropped your hands.

## The method
1. Add a readout behind `?debug` (before the `#` in the address). It shows
   each candidate measure live, never to players.
2. **Record one move at a time.** Press the move's number: a 3 s countdown
   (beep) to get into position, 5 s recorded (beep), a beep when saved.
3. For each measure and hand, keep the **typical** (median) and the **high**
   (90th percentile) and **low** (10th), not the max: one bad frame from the
   model can't skew it. Also keep the share of frames the hand was seen, and
   any punch the current detector read during the recording.
4. After all moves, press **C** to copy the table as text and paste it into
   the chat. No screenshots.
5. Pick the measure that separates the moves: a threshold sits between the
   "in" moves' high and the "out" moves' typical, with room on both sides.
   The "moving, no punch" recording must stay below it: that is what must
   **not** count.
6. Put the chosen numbers in the config, add a spec built from the recorded
   values, and log it in the devlog.

## Boxing's moves
1. **relaxed**: standing ready, hands loose at chest height, not guarding,
   not punching (the in-between state, so we know what "nothing" looks like).
2. **high guard**: both gloves in front of the face, held.
3. **low guard**: forearms across the chest, elbows tucked, gloves below the
   chin, held.
4. **jab to head**: straight punches at the screen at head height.
5. **hook to head**: swinging punches from the side at head height.
6. **jab to body**: straight punches at chest height (below the shoulders).
7. **moving, no punch**: sway, lean, raise and drop the guard.
8. **hook to body**: swinging punches at chest height.

A punch is two choices: its kind (jab or hook) and its target (head or body,
from the fist's height). Punches alternate left, right, about one a second,
each back to the guard before the next, so "in" and "out" don't blur.

A player may sit at a laptop, where the frame ends around mid-chest and the
stomach isn't seen. So every move happens between the chin and mid-chest:
head or body is split at the shoulder line, which is always in view. If the
high and low guards don't separate on camera, the fallback is one guard that
blocks head shots only, with a body shot getting through any guard.

## Track's and hurdles' moves
Tasks 26-27, `client/input/camera/run-pose.ts` (`RunTracker`/`DEFAULT_RUN`,
`JumpTracker`/`DEFAULT_JUMP`) and `client/games/track/run-camera.ts` with
`?debug`. Every number there is a first guess until these. Since 2026-11-08
each step and jump is measured from that hand's (knee's, torso's) own recent
low, not from the stand-still rest, so record as you would really run: hands
where they fall, not posed.

Open a track practice with `?debug` before the `#` (sprint is fine: the
recorder reads the jump in either event). Start the camera in **elbows**
mode at laptop distance and do the stand-still. The recorder reads both
modes at once, so moves 7-9 need you stood back with your knees and hips in
view (the readout's `knees` rows show `–` when it can't see them). Keys 1-9
and 0 (move 10); a 3 s countdown, 5 s recorded. Moves 2, 3 and 7 play a
**beat at 4 a second** (top speed since 2026-11-08): one pump or knee per
beat, alternating sides, so "steps read" can be checked against "marked".
1. **standing still**, arms relaxed (what "nothing" looks like).
2. **elbows: small quick pumps to the beat**, as in a race, hands low.
3. **elbows: small pumps to the beat with the hands held at the chest**
   (the case that never re-armed before: must still read every beat).
4. **elbows: big pumps**, as high as a tired runner flails, any speed.
   Must not read as a jump.
5. **elbows: both arms up**, one throw a second or so, down between (as
   high as feels natural for a jump, not stretched).
6. **elbows: one arm up**, left, then right. Must not read as a jump.
7. **knees: jogging on the spot to the beat**, knees up. Must not read as
   a jump.
8. **knees: a hop on the spot**, one a second or so.
9. **knees: rising on tiptoe** and settling. Must not read as a jump.
0. **elbows: running pumps with a both-arms jump every 2 s or so** (a
   real hurdle race: the jump must read, the pumps around it mustn't).

Then **C** copies the table (with the current numbers) to paste into the
chat. Per move it gives, for each mode: each side's **lift peaks** (the
top of each rise above its recent low, lo/typ/hi), the **jump reading**
(elbows: the lower hand's lift above its low; knees: the torso's), the
torso's **up-speed** (knees), the share of frames **seen**, and **steps
read** (vs **marked** beats) and **jumps read** by the current detectors.

What each number is set from:
- `DEFAULT_RUN.elbows.liftOn` (now 0.15) sits under moves 2 and 3's low
  lift peaks and over move 1's high; `reArm` (0.07) under the smallest
  pump's height. Moves 2 and 3: steps read should match marked (20).
- `DEFAULT_RUN.knees.liftOn` (0.25) the same from moves 7 and 1.
- `FULL_CADENCE` (4) and the bot: if 4 a second felt hard to keep up in
  moves 2/3/7, say so.
- `DEFAULT_JUMP.armsOn` (0.6) sits between move 4's and 6's high jump
  reading and move 5's low; moves 5 and 0 read one jump per throw, all
  others none. `armsFall` (0.5) is checked by moves 4 and 0.
- `DEFAULT_JUMP.riseOn` (0.2) and `riseSpeed` (1.2) sit between moves 7
  and 9's high and move 8's low; move 8 reads one per hop.

## Basketball's moves
Task 32, `client/games/basketball/shoot-camera.ts` with `?debug`. Record
each standing about 1 m back, then again seated at the laptop. Pushes are
up and towards the hoop (ADR 003), one every second or so, back to the
chest between, any hand unless the move says.
1. **ready**: two hands at the chest, holding an imaginary ball, still.
2. **soft push**, two hands.
3. **medium push**, two hands.
4. **hard push**, two hands.
5. **medium push, right hand only.**
6. **medium push, left hand only.**
7. **moving, no shot**: sway the hands left and right to aim, scratch your
   head, cheer with your arms up. None of this may read as a shot.
8. **chest pass**: nearly all forward, the hands barely rising.

Measures, per hand, in shoulder widths against the shoulder line:
- **up-speed**: the wrist's upward speed a second; and each push's **peak**
  (lo/typ/hi of the peaks of each upward run in the recording). The shot
  threshold (`minPeak`) sits between move 7's high and move 2's low; soft,
  medium and hard set `power0` and `power1`.
- **seen**: the share of frames the hand was seen (does a push leave the
  top of the frame, seated or standing?).
- **height**: the wrist above the shoulder line (negative below): where the
  ready zone and the face line go.
- **aim**: the aim the hands give, -1..1, over the recording.
- **shots read**: the shots the current detector read, with power: moves
  2-6 should read one per push, 7 none, 8 soft.

## Bowling's moves
Task 29, `client/games/bowling/bowl-camera.ts` with `?debug`. Stand about
2 m back, hips in view (the panel's silhouette is green), underarm swings
one every second or two, right hand unless the move says. Keys 1-9, and 0
for move 10.
1. **slow swing.**
2. **medium swing.**
3. **fast swing.**
4. **medium with a step and crouch**, as a real bowler does.
5. **straight with a natural follow-through**: must read no curve.
6. **curve left**: sweep the hand to your left as you let go.
7. **curve right.**
8. **left-handed medium.**
9. **moving, no throw**: pick something up, stretch, walk sideways. None of
   this may read as a throw.
0. **medium at 1 m** (hips out of view: the chest fallback).

Measures, in shoulder widths against the shoulders:
- **release speed**: the wrist's speed as it comes up past the hip line,
  lo/typ/hi over the crossings in front, and separately those the model's
  depth put behind the hips (backswings). The threshold (`minSpeed`) sits
  between move 9's high and move 1's low; 1-3 set `speed0` and `speed1`; 4
  should read like 2.
- **sweep**: the wrist's sideways move over the 150 ms around each throw.
  Move 5 sets the dead zone (`sweepDead`), 6 and 7 the full sweep.
- **hips seen, left, right**: the share of frames each was seen (does the
  swing leave the frame? does move 10 lose the hips?).
- **throws read**: the current detector's throws, speed/spin: one a swing in
  1-8 and 10, none in 9.

## Measures (all in shoulder widths, so distance doesn't matter)
- **size**: the hand's apparent size (wrist to index and pinky knuckles). It
  grows as the fist nears the camera: the main candidate for "arm out".
- **elbow3d / elbow2d**: how straight the elbow is, degrees (180 straight),
  with and without the model's depth.
- **depth**: the model's estimate of the wrist in front of its shoulder. On
  the first try it peaked at 3.9 (a real arm reaches about 1.3), so it is
  probably too noisy to use alone.
- **reach**: wrist to shoulder on screen.
- **height**: wrist above the shoulder line (negative below): head or body.
