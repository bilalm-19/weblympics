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
- **A3 First action fast.** A new player does something that counts within
  about 30 seconds of the game opening, on keys and on the camera.
- **A4 Learnable on the page.** Keys or buttons are shown in the HUD; a
  practice or training mode exists; the camera setup shows the move.
  Nothing needs the README to be understood.
- **A5 Fails kindly.** A missed or unread move says why (or the game shows
  what it read), so the player can correct it.

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
- **D1 Keyboard equivalent** for every camera action, and phone buttons.
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

Each play-through is done by a fresh agent that has not read the code, given
only what that person would have.

1. **Casual friend, laptop.** Sent an invite link by a friend, never seen the
   site, has a webcam, will give up after about a minute of confusion.
2. **Phone, no webcam.** 390x844, plays on the on-screen buttons.
3. **Spectator.** Opens a watch link mid-match and wants to know who is
   winning.
4. **The marker.** Arrives with only the URL, starts at `/readme/`, wants to
   get two browsers into a match, and comes back the next day.

## Verdicts

- **Idea:** build / build with changes (listed) / drop.
- **Build:** ship / fix first (the listed blockers) / pull from the menu.
