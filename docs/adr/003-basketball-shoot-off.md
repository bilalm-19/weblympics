# ADR 003: Basketball: a turn-by-turn shoot-off, the server flies the ball, the camera reads one push

Status: accepted, 2026-11-07 (user, after two runs of `review-game-idea`;
devlog entries "Basketball shoot-off: game-idea review" and "Basketball:
answers on the review's changes"). Implementation: task 32,
`shared/games/basketball/`. Camera numbers are guesses until recorded
(`docs/camera-playtest.md`).

## In plain terms

Two players take turns shooting at one hoop on an outdoor court, from five
spots that get further away. You hold an imaginary ball at your chest, move
your hands left or right to swing an arrow on the floor, then push up and
towards the hoop, with one hand or both. How fast you push is how hard you
shoot. The ball can swish, rattle in, roll out or bank off the board. After
each shot a bar shows how hard you pushed against that spot's green zone.

Your browser only ever says what you did: "I'm set", "aiming here", "shot
this hard, this way, at my time T". It never says "I scored". The server
flies the ball against its own rim and backboard and scores it.

## Context

- The user asked for basketball on 2026-11-07: a shoot-off, different
  distances, turn by turn, an outdoor court, fans cheering.
- Turns, not a live rally: no reaction faster than lag allows is needed, so
  bad wifi only delays the other screen, it never changes a result.
- The camera is a laptop webcam, often close (the user wants it to work in
  tight spaces, standing about 1 m back or seated). At 1 m a laptop camera
  sees roughly mid-chest to a little above the head, so a full release
  leaves the top of the frame. The shot has to be read on the way up.
- Both persona agents in the review wanted to jump and to push hard
  ("Kinect taught me big equals good"), swayed 30-40 cm to aim, and in the
  first run said they would quit if a miss gave no reason. The power bar
  fixed that in the second run.

## Options

1. **Make window.** Power and aim inside a window is a make, outside a miss.
   Simple and easy to read, but no rattles, roll-outs or bank shots.
2. **Real rim and backboard (chosen, user).** The server integrates the ball
   under gravity and bounces it off a rim (a circle of radius `RIM_R`) and a
   backboard (a bounded plane). Harder to tune, more fun to watch.
3. **Arm follows the player.** Send the wrist path and fly the ball from it.
   Rests on the pose model's depth, which boxing's recordings showed is
   noise. Rejected.

For the camera move:
1. **Two styles behind a setting** (set shot, jump shot). Rejected by the
   user: no setting.
2. **One push, any hand (chosen, user).** Either wrist or both rising fast
   from the chest past the face is a shot. Both hands: their mean; one hand:
   that one. Left- and right-handed both work with nothing to pick. The same
   shot animation every time.

## Decision

- **Match ("shootout"):** five spots: free throw 4.6 m (2), elbow 5.5 m
  (2), wing three 6.75 m (3), top three 7.25 m (3), deep 9 m (the money
  ball, 4). One shot each per spot, players alternate, the first shooter
  swaps each spot. A swish (no rim, no board) adds 1 to any basket, the
  money ball included (so a swished money ball is 5). Highest total wins.
- **A tie: the players choose** (user, 2026-11-08, the same as bowling's,
  ADR 004). A pop-up asks both "Draw, or go to sudden death?". If either
  chooses draw, it is a draw (`winner: null`, recorded and rated as a draw
  between two people). Only if both choose to continue is a sudden-death
  round shot from the deep spot, one shot each, the first shooter
  alternating: a make against a miss wins; a level round asks again.
  Sudden death decides the winner and is not added to the score. 15 s to
  choose, no choice counts as draw; the bot always continues. Message:
  `{ t: "tie", choice: "draw" | "continue" }`.
- **"Unlimited":** a seeded random spot each turn, counts points, makes and
  the longest make, no winner, ends when someone leaves, unrated.
- **Rated** by the usual rule (`isRated`): "shootout" between two accounts
  on different tokens, host's option on. Practice vs bot never.
- **Shot clock 15 s on the server's clock.** It starts on the shooter's
  first `set`, or 5 s into the turn if no `set` comes, so a client can
  stall at most 20 s. Running out is a miss. A `shoot` that arrives after
  the buzzer counts only within the seat's measured round trip, capped at
  150 ms (ADR 001's cap), by the server's clock.
- **Client messages (closed):** `{ t: "set" }`, `{ t: "aim", aim }`
  (throttled; the server keeps it so the opponent and spectators see the
  arrow) and `{ t: "shoot", power, aim, at }` with `power` 0..1 and `aim`
  -1..1, both clamped by the server. Anything else, any extra field, any
  message from a seat whose turn it isn't, and a second `shoot` in a turn,
  is dropped whole.
- **The server flies the ball.** A fixed release point and launch angle;
  `power` maps to launch speed, `aim` to a yaw. Gravity, the rim circle and
  the board, fixed restitution, substeps per tick so a fast ball can't pass
  through the rim. A make is the ball's centre crossing down through the rim
  plane inside the rim. No random scatter: the same shot always does the
  same thing (the seed only picks unlimited's spots), so the game is
  deterministic and testable.
- **Sweet zone from the physics:** a pure `makeWindow(spot)` in `shared/`
  gives the range of `power` that scores with a centred aim. The client bar
  draws it; the bot aims inside it. A near spot's window is naturally wider
  (a slower ball, the same hoop), so it is not widened by hand unless a
  playtest shows first shots still miss.
- **Camera (pure maths in `client/input/camera/shoot-pose.ts`):**
  - *Ready:* one or both wrists at the chest (below the shoulder line, near
    the body's middle) and still for a moment sends `set`; the hands glow.
    If the frame ends above the chest, the screen asks to raise the hands a
    little.
  - *Aim:* the hands' sideways offset from the shoulders' middle, in
    shoulder widths, sent as `aim`; the floor arrow follows it, in the
    setup step too.
  - *Shot:* a wrist rising from the ready position past the face faster
    than a threshold, in shoulder widths a second against the shoulder line.
    Its peak upward speed sets `power`. The aim **locks when the push
    starts**, so a sideways drift during the push changes nothing.
  - Measured against the shoulders, so jumping adds nothing; a push that is
    nearly all forward (a chest pass) rises little and reads as soft, and
    the power bar shows it. The pose model runs every frame (a push lasts
    0.2-0.4 s).
  - One shot a turn; off-turn the panel sends nothing.
- **On screen:** "Your shot" / "Their shot, watch"; "Push up and towards
  the hoop, like a real shot. No need to jump."; after each shot the power
  bar against the sweet zone with "Too soft", "Just right" or "Too hard",
  and the call ("SWISH! +3", "Off the rim").
- **Keys, mouse, touch:** mouse or arrow keys aim; hold Space or the Shoot
  button, a power bar fills and falls, release shoots. The same messages.

## Consequences

- Lag delays when the other screen sees a shot, never whether it scored.
- A tuned physics model means the camera's power mapping and the window
  have to be tuned together from recordings; until then every camera number
  is labelled a guess.
- Small: the ball flies for about 1.5 s a turn, so a room costs less than a
  tennis rally.
- Accepted risk: with the ready position at the chest (user's choice over
  the chin), a seated player close to the laptop may need to raise their
  hands to be seen.
- Changes to revisit after the first real-webcam playtest: the push speed
  thresholds, the aim scale, whether one-handed shots need more smoothing
  than two-handed ones, and whether near windows need widening.
