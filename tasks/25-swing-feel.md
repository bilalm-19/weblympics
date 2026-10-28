# 25 Swing feel: live swing level, calibration profile, settings panel

Status: discussed with the user (2026-10-21), not built. The user asked for no
implementation yet; this file records the decisions and the original defaults.
Model: Opus (design and profile storage), Sonnet for the panel
Session: later; needs accounts (17) for profile storage and waits on the camera
panel changes in task 15 (session B)

## Decided (user, 2026-10-21)
- **First: show the swing level live.** A bar of peak swing speed with the two
  threshold ticks, and light / medium / hard lit as you swing. Do this alone
  before any calibration; it shows whether the thresholds are the real problem.
- **Calibration** (swing light, medium, hard; median of each, thresholds halfway,
  via `thresholdsFrom` in `pose.ts`, which falls back to the defaults when the
  three levels are not clearly different) is offered **both in training and in
  the camera settings**, and is **optional**: it is never forced in a room
  (a friend can wait; design choice by the user).
- **Saved to the user's profile** (task 17) and loaded on sign-in; guests save it
  in their browser only. Validated and clamped on the server. A **Reset to
  default** button restores every value below.
- **Switch settings during a game** from a **settings pop-up that opens to the
  side**, so the game stays visible and the player can keep swinging and
  pressing their tools. It must not cover the court, the timing meter or the
  swing bar, must not steal keyboard focus, and must collapse to a drawer at
  390x844. A change never applies in the middle of a swing.
- **Defaults stay classic swing and aim by timing**, whatever a browser has
  saved: a spec that a fresh profile gets them, and Reset restores them.
- **Swing delay: unchanged** (user, 2026-10-21). Camera cooldown stays 300 ms and
  the server's 250 ms stays. The direction filter for the double-count is
  still a separate, optional idea (`parked.md`).
- **Calibration is a mode of its own** (user, 2026-10-21): free practice swings
  first, then it walks you through the swings (light, medium, hard), you can
  skip or jump to any step, and when you are happy with a swing setting you
  press "Set". Practice swings are never counted against anything.
- **Two levels of calibration** (user, 2026-10-21):
  - **Full calibration in practice mode** (training): the better, guided one
    described below.
  - **Quick calibration in game mode**: optional, before you ready up, done with
    a swing or a few. The player can pick one specific stroke and strength to
    calibrate (for example only the forehand's hard swing) instead of the whole
    set. It lives in the ready panel / side settings pop-up, never delays the
    other player (they can ready up and wait; it is the player's own choice).
- **Forehand and backhand are both supported**, each with its own thresholds,
  in both levels of calibration (this settles the earlier open question: per-
  stroke pairs are in).

## Calibration mode, as I would build it (proposal, to settle with the user)
- This is the full version, opened from practice mode. The quick version (one
  chosen stroke and strength, a swing or a few, before ready-up) reuses the same
  strip and "Set" button in a small form. Camera only: speed has no
  keyboard meaning, so with no camera the entry is disabled with the reason.
  (CLAUDE.md says every camera action has a keyboard equivalent; this is the one
  place that cannot, so it needs a line in that rule.)
- A strip of the swings so far, each a dot at its peak speed against the two
  threshold ticks, coloured by the level it would be read as. Forehand and
  backhand each have their own strip, filled by the grip the camera reads, or by
  a tab the player picks.
- Steps Light, Medium, Hard per stroke, each a few swings. A step can be skipped
  or jumped to from a list; any swing can be dropped from its step; "Set" keeps
  the median of the step's swings. Thresholds sit halfway between the medians
  (`thresholdsFrom`). When the levels are not clearly different it says so and
  asks for another try, rather than silently using the defaults.
- A test stage after setting: swing freely and see the level each swing reads as,
  then Save (profile), Try again, or Reset to default.
- Never blocks play: optional in the lobby and in a room, nobody is held waiting
  on it, and closing it keeps the previous settings.

## Original default values (keep, to switch back later)
From `client/input/camera/pose.ts` unless marked.
- Swing (`DEFAULT_SWING`): start speed 2.5 shoulder-widths/s; thresholds
  light/medium at 5 and medium/hard at 9; hysteresis 0.1; **cooldownMs 300**;
  maxMs 600. A swing ends when speed falls below 60% of its peak.
- Calibration (`DEFAULT_CALIBRATION`): hand right; **mode "classic"**; **aim
  "timing"**; autoNeutral true; neutralTilt 0; neutralAcross -0.5; thresholds
  as above.
- Grip: `GRIP_THRESHOLD` 0.15 (a reading under it keeps the previous grip).
- Tilt (`DEFAULT_TILT`): deadZone 3 degrees, fullTilt 11 degrees, curve 1.4.
- Follow mode (`DEFAULT_ZONE`): line 0.25, minSpeed 2.5, cooldownMs 300,
  liftAt 1, liftRange 0.8.
- Landmark confidence: shoulders 0.5 (`MIN_VISIBILITY`); racket hand points 0.3
  (`MIN_HAND_VISIBILITY`).
- Server (`server/room.ts`): `SWING_COOLDOWN_TICKS` 15 (250 ms at 60 Hz).
- Hit window 0.32 s (task 12); auto-move `AUTO_SPEED` 0.7 of `PLAYER.speed`.

## Done when (to be refined)
- [ ] Live swing bar with threshold ticks and the lit level, both viewports.
- [ ] Full calibration in practice mode and quick calibration before ready-up
      (one chosen stroke and strength), both optional, both strokes; thresholds
      saved to the profile, clamped on the server (hostile-client test).
- [ ] Quick calibration never holds up the other player or the countdown.
- [ ] Reset to default restores every value above, including classic and timing.
- [ ] Side settings pop-up: keyboard works while it is open; both viewports.
- [ ] README, CLAUDE.md and `spec/` agree.
