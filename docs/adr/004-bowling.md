# ADR 004: Bowling: five frames, the server rolls the ball and the pins, the camera reads the forward swing

Status: accepted, 2026-11-08 (user, after the `review-game-idea` run;
devlog entry "Bowling: game-idea review and decisions"). Implementation:
task 29, `shared/games/bowling/`. Camera numbers are guesses until recorded
(`docs/camera-playtest.md`).

## In plain terms

Two players take turns bowling on one indoor lane, five frames each, with
real ten-pin scoring. You stand where the camera sees you down to your
hips. You move your hand, or walk, left or right to slide an arrow on the
lane: that is where the ball starts. Then you bowl underarm, stepping and
crouching if you like. The ball leaves your hand as it comes forward past
your hip, and how fast your arm comes through is how fast the ball rolls.
A sideways sweep of your hand as you let go curves it near the pins.

Your browser only ever says what you did: "aiming here", "threw this fast,
from here, with this much curve, at my time T". It never says how many pins
fell. The server rolls the ball and knocks the pins in its own sim.

## Context

- The user asked for bowling on 2026-11-05 with "faster matches" (5
  frames), and settled the rest on 2026-11-07/08.
- The first plan read the backswing past the hip from a seated laptop.
  The camera can't see a seated player's hips, and from the front the
  backswing goes behind the body, so the camera loses the wrist.
- In the review the reader stepped forward, crouched and twisted their
  wrist like Wii bowling, and asked "when does the ball actually leave my
  hand?". Both personas would walk sideways to aim, not move only a hand.
  The skipper thought the arrow aimed by itself and swept for curve while
  the ball rolled, "to steer it".
- Turns, not a live rally: lag delays the other screen, never a result.

## Options

For the camera move:
1. **Read the backswing and the forward swing.** Most faithful, but the
   backswing hides behind the body. Rejected.
2. **Read the forward swing past the hip (chosen).** The release is the
   wrist passing the hip going forward; its speed there is the ball's speed.
   The camera is placed to see the hips (the setup says when it does). If
   the hips aren't seen, the fallback reads the forward rise past the chest.

For aim:
1. **The hand against the shoulders.** Works close up, but ignores walking.
2. **The hand across the whole picture (chosen, user, on Claude's advice).**
   Walking, shifting and moving the hand all move the arrow, so a newcomer
   can't do it wrong; in a tight space the hand alone does it.

For steps and crouches:
1. **Ask players to stand still.** Fights the move they know.
2. **Allow them (chosen, user, on Claude's advice).** The swing is measured
   in shoulder widths against the shoulders, so a step towards the camera
   or a crouch doesn't change the speed read.

## Decision

- **Match ("game"):** five frames each, real ten-pin scoring: two balls a
  frame; a strike scores 10 plus the next two balls, a spare 10 plus the
  next ball; the fifth frame gives the bonus balls (up to three), so a
  perfect game is 150. Players alternate frames, seat 0 first. Highest
  total wins. A tie bowls one more frame each (no bonus balls), repeating
  until it breaks; tie frames decide the winner and aren't added to the
  score.
- **"Unlimited":** game after game, counts games won and the best score, no
  winner overall, ends when someone leaves, unrated. Rated by the usual
  rule (`isRated`) for "game" between two people; practice vs bot never.
- **Shot clock 20 s a ball on the server's clock;** running out rolls a
  gutter ball. A `throw` arriving after the buzzer counts only within the
  seat's measured round trip, capped at 150 ms (ADR 001's cap).
- **Client messages (closed):** `{ t: "aim", aim }` (throttled; the server
  keeps it so the opponent and spectators see the arrow) and
  `{ t: "throw", speed, aim, spin, at }`, `speed` 0..1, `aim` -1..1 (the
  start spot across the lane), `spin` -1..1, all clamped by the server.
  Anything else, any extra field, any message from a seat whose turn it
  isn't, and a second throw for one ball is dropped whole.
- **The server rolls the ball and the pins.** A 2D lane: the ball rolls
  straight from its start spot along its direction for the first two thirds,
  then bends by `spin`; ball-pin and pin-pin collisions as circles, a pin
  down once knocked past a tilt distance; gutters take the ball. Substeps
  per tick. **No random scatter:** the same throw always knocks the same
  pins, so the game is deterministic and testable. A strike needs the
  pocket at a good speed; a straight ball into the pocket strikes less
  often than one curving in.
- **Camera (pure maths in `client/input/camera/bowl-pose.ts`):**
  - *Aim:* the bowling hand's position across the whole picture (mirrored
    so moving right moves the arrow right) sends `aim`; the arrow follows
    it, in the setup step too. It locks when the swing starts.
  - *Throw:* either wrist passing the hip going forward, faster than a
    threshold, in shoulder widths a second against the shoulders. That
    moment is the release; its speed sets `speed`. The backswing isn't
    needed. The character copies the arm live, so the player sees the
    moment it counted.
  - *Curve:* the wrist's sideways sweep across the body in a short window
    around the release (about 0.15 s), locked after it, so the
    follow-through and "steering" afterwards add nothing. No wrist twist.
  - Steps and crouches allowed. The pose model runs every frame. Fallback
    with no hips seen: the forward rise past the chest sets the speed.
  - One throw a ball; off-turn the panel sends nothing.
- **On screen:** "Your turn" / "Their turn, watch"; a silhouette asking to
  stand back until the hips are seen; "Step and crouch if you like, it's
  the swing that counts"; the curve icon shows the sweep at the moment of
  letting go, "no need to twist"; the arrow shows only the start and
  direction for the first third of the lane (not the bend or the end); the
  last ball's path stays faintly drawn; after each ball, the speed read
  against a good-speed zone and "Curve: a little left / none", with the
  call ("STRIKE!", "7 pins", "Spare!").
- **Keys, mouse, touch:** left and right move the start spot, up and down
  set the curve; hold Space or the Bowl button, a power meter fills and
  falls, release throws. The same messages.
- **Look:** an indoor alley from primitives, tennis's character holding a
  ball, a crowd; a simple end card now, task 28's podium later.

## Consequences

- Lag delays when the other screen sees a throw, never the pins.
- The pin physics has to be tuned so strikes need accuracy (the pocket at
  speed) and a straight ball leaves pins more often than a curving one;
  the bot and the speed zone are tuned against the same sim.
- Accepted risks: a lunge can leave the frame (the hips check and a
  recording settle it); the aim across the picture depends on where you
  stand, which the live arrow shows before you throw.
- To revisit after the first real-webcam playtest: the swing thresholds,
  the curve window and scale, the aim scale, and whether strikes come too
  easily or too rarely.
