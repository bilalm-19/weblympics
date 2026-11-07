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
