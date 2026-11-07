# Game review criteria

What a Weblympics game idea or build is reviewed against. Read by the
`review-game-idea` and `review-game-build` skills (`.claude/skills/`). When a
review finds a rule missing here, add it here, not only in the chat.

## The idea in one line

Wii Sports in a browser tab: anyone can open a link and play with a friend,
using a move they already know from the real sport, with the webcam as the
controller and almost nothing to learn first. (User, 2026-11-07: "easy for
anyone to just open and play", "the learning curve should not be high".)

## Sources the review checks against, in the marker's reading order

1. `README.md`: the definition of good. A game that doesn't serve it is a
   feature with no reason to exist, which the brief marks down.
2. `CLAUDE.md`: the rules (server authority, determinism, keyboard
   equivalents, viewports, privacy, a game's file and spec layout).
3. `spec/`: the checks. Each promise a game makes needs one, or a note that
   it is judged and how.
4. The running app.

The brief (`spec/README.md` links it): multi-user, real-time (within about a
second, no reload), persists across restarts and redeploys; "one idea,
carried all the way"; marked down for "features with no reason to exist" and
a README promising a kind of good the rules and checks never mention.

## Criteria

Each criterion is pass, concern or fail, with evidence.

### A. Pick up and play
- **A1 Known move.** The camera move is the real sport's move, or a plain
  stand-in for it, that a person would try without being told.
- **A2 Few inputs.** Count the distinct actions a player must learn. Up to 3
  is easy, 4 to 5 needs on-screen help, 6 or more is a concern unless
  practice teaches them in order. Held states (a guard, a lean) count.
- **A3 Screen matches code.** What the camera setup, training and HUD tell
  a newcomer to do is what the code actually measures, at the size and
  speed it needs. Nothing needs the README to be understood.
- **A4 No false or silent reads.** Normal play (a guard, a sway, a wind-up)
  doesn't cross a threshold; the real move clears it with room; one
  control doesn't silently block another.
- **A5 Fails kindly.** After a move the screen shows what was read (or that
  nothing was), quickly enough to correct the next one.
- **A6 Fits a laptop webcam.** Works seated, seeing to mid-chest, either
  hand, ordinary light.

### B. Together
- **B1 Two people, live.** It is a two-seat game in a room, both players see
  each other's actions within about a second, and spectators see the same.
- **B2 Co-presence.** It is more fun because the other person is there now
  (reacting to them, not just playing side by side).
- **B3 Short match.** A match fits a casual session (a few minutes) and has a
  clear end and winner, or a stated unlimited format.

### C. Fair and server-owned
- **C1 Server owns the outcome.** Clients send only what the player did,
  with their own timestamp; the server decides hits, scores and the end.
- **C2 Closed messages.** The accepted client messages are listed and
  anything else, or any extra field, is dropped whole.
- **C3 Mashing buys nothing.** Rate caps by the input's timestamp and by the
  server's clock.
- **C4 Lag rule.** It says who wins when two screens disagree (ADR 001 is
  tennis's answer).
- **C5 Deterministic.** Seed plus input stream gives the same match, so it
  can be tested.

### D. Works for everyone
- **D1 Fallback.** Keys or buttons exist so a game can be played with no
  camera (CLAUDE.md requires it; the marker's phone-sized window has none).
  It only has to work; it is not what the review judges.
- **D2 Both viewports**: 1920x1080 and 390x844, no horizontal scroll,
  controls reachable, canvas not clipped.
- **D3 No camera needed** to reach the lobby, the room or a game.
- **D4 Video stays in the browser**; no change to the CSP's `connect-src`.

### E. Fits the server
Fly: one shared-cpu-1x machine, 256 MB, auto-stops when idle.
Measured 2026-11-07 (deploy 11): idle RSS 106 MB (41%), cold start about
4 s, warm load about 1 s. Every room runs a 60 Hz tick.
- **E1 Memory.** Per-room cost from `/stats` with rooms running; at least 10
  rooms at once must stay under about 200 MB RSS.
- **E2 Tick time.** `loop.avgMs` well under the 16.7 ms tick, `maxMs` under
  it.
- **E3 Assets.** Low-poly primitives, no heavy downloads; any model is lazy
  and loaded only when a player enters the game.

### F. Evidence
- **F1 Camera numbers from recordings** (`docs/camera-playtest.md`); a guess
  is labelled as one and listed as open.
- **F2 Specs** are `spec/<name>-*.test.ts` and `e2e/<name>-*.e2e.ts`, and
  every rule the game states has one.
- **F3 Consistent claims.** What README, CLAUDE.md and `spec/` say about the
  game agrees with each other and with the app.
- **F4 Decisions logged.** Rule choices have an ADR or devlog entry naming
  who decided.

## Personas

Five ways a newcomer can fail. The first two are fresh agents that have not
read the code: each gets only what that person would take in and says what
they would do with their body. The other three the reviewer works out from
the code and the recordings. No agent plays on a webcam; the user's
playtests judge feel.

1. **The skipper** (agent). Doesn't read paragraphs and clicks the biggest
   button. Gets only button labels, headings, pictures and anything that
   animates. Doesn't know the sport's terms (jab, slip, backhand). Tests
   whether the game shows the move without words, the Wii way.
2. **The reader** (agent). Reads every word of the setup, training and
   hints, in order. A casual gamer who has played Wii Sports or Kinect and
   makes moves big and exaggerated. Tests whether the instructions say what
   the code measures, and whether big moves still read as the right
   control.
3. **Tight space** (from the code). Seated at a laptop about 50 cm from the
   camera, framed to mid-chest, ordinary indoor light, maybe left-handed.
   For each move: is the body part in frame and tracked, and does the move
   still clear its threshold at that size?
4. **Patchy wifi** (from the code). 150 to 300 ms of lag with jitter, and a
   2 s dropout. Does an on-time move still count (ADR 001 looks back at most
   150 ms)? What does the opponent see? What does the dropout do (the 30 s
   hold)?
5. **Smoothness** (from the code). An ordinary laptop. Add up the delay
   from the move to the screen: camera frame, how often the model runs, the
   detector's waits and cooldowns, the server tick, the animation. Note
   what costs frame rate (the model plus the 3D scene) and where the
   player waits on the game rather than the other way round.

To save budget: skip the skipper for a wording-only change, and skip patchy
wifi and smoothness when only instructions or thresholds changed.

## Verdicts

- **Idea:** build / build with changes (listed) / drop.
- **Build:** intuitive / fix the instructions / change controls.
