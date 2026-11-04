# 24 Spectating mode

Status: picked up (user, 2026-11-05: "people with the link can spectate too");
queued for an agent once the integrate5 merge is on main.
Model: Opus (rooms, privacy and what spectators may see)
Session: later

## Where it stands today
- A third arrival to a room becomes a spectator automatically: no queue, no
  seat (CLAUDE.md room rules). `server/room.ts` keeps a `spectators` set; the
  server sends `presence` with a spectator count; the ready panel says
  "Spectating. The match starts when both players are ready."
- Spectators already see crowd and banner effects as they arrive (tasks 16 and
  19), by seat.
- There is no public room list: rooms are invite link or code only, and that is
  a rule. A spectator can only arrive with the link.

## Decided (user, 2026-11-05)
- Anyone with the link can watch. Still no public list of rooms.
- At most 10 watchers per room.

## Design (Claude's proposal; the agent records its choices in the devlog)
- **A watch link:** players can copy a "Watch" link (`?watch=CODE`) next to the
  invite link. Opening it always spectates, even when a seat is free, so a
  viewer never takes a player's seat by accident. The plain invite link keeps
  today's behaviour (a free seat is taken, else spectate).
- **Spectator view:** the live match, score, crowd and sound, a "Watching"
  badge, the number of watchers, both players' names; no camera setup, no
  ready button, no input. Works for every game (tennis, archery, track, and
  bowling and boxing when they land), since rooms are game-agnostic.
- **Limit:** 10 watchers per room (user, 2026-11-05), for the shared CPU
  and 256 MB machine; the 11th sees a clear "this match is full of
  watchers" message.
- **Joining mid-match:** a spectator arriving during play sees the current
  state at once (the next snapshot).

## Questions settled by the design above (earlier list)
- How does someone start watching: a "Watch" link a player shares, or a list of
  live matches? A list would change the "no public list" rule; if wanted, only
  rooms whose host opts in.
- What a spectator sees: the match, the score, the crowd, a count of watchers,
  and whether names show. Spectator-to-player chat stays out (preset phrases
  only, per `parked.md`).
- Spectator limits (a cap per room for the 256 MB machine) and what happens at
  the cap.
- Winner-stays-on queue (parked) versus plain spectating: keep them separate.
- Whether a spectator sees a live view with sound and the cheering crowd.
- Mobile layout: a watcher on a phone at 390x844.

## Rules to keep
- Spectators never send input; the server ignores any swing or ready from them
  (hostile-client test).
- Video never leaves the browser; spectators get no camera.
- The server stays the only owner of the ball and score.

## Done when (to be refined)
- [ ] Decisions above recorded in this file and CLAUDE.md.
- [ ] Spectator join path, limits and view, both viewports.
- [ ] Hostile-client test: a spectator's input is rejected.
- [ ] README, CLAUDE.md room rules and `spec/` agree.
