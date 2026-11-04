# 24 Spectating mode

Status: built on branch `spectate-24` (agent, 2026-11-05), awaiting merge
and the user's OK on the agent's choices (devlog 2026-11-05 05:48).
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

## Done when
- [x] Decisions above recorded in this file and CLAUDE.md.
- [x] Spectator join path, limits and view, both viewports
  (`e2e/spectate.e2e.ts`).
- [x] Hostile-client test: a spectator's input is rejected
  (`spec/spectate.test.ts`, every game).
- [x] README, CLAUDE.md room rules and `spec/` agree.

## As built
- `#/watch/CODE` sends `join` with `watch: true` (an additive, optional field);
  the server never seats it, except to give a player back their own held seat
  after a drop. The invite (`#/room/CODE`) is unchanged.
- `MAX_WATCHERS = 10` and the message "This match is full of watchers." are in
  `shared/protocol.ts`; `Room.refusal` checks before the arrival leaves any
  room it is in, so a refused join changes nothing.
- `client/ui/spectate.ts` adds "Copy watch link" beside "Copy invite" in every
  game's HUD, and for a watcher the "Watching" badge (both names, the count)
  in place of the invite. Views already hid camera, ready and controls for a
  seat of null. A tennis watcher hears every hit.
