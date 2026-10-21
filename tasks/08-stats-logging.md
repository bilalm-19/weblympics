# 8 Server logging and stats

Status: built on session A's branch except the production-logs finding, which needs the user (agents don't run flyctl or edit PROCESS.md). Agent choices in the devlog entry "Task 8 built".
Model: Sonnet

## Goal
Crit 11 ("Fly by instruments") wants server-side logging that tells you what
the app is doing in production, and PROCESS.md should show you used it.

## Scope
- Log fields worth having: connect/disconnect with reason, reconnects, swing
  accepted/rejected with reason and latency, tick drift and loop duration,
  room lifecycle, match results, errors.
- A `/healthz` or `/stats` endpoint: rooms, players online, uptime, memory
  against the 256 MB limit.
- Don't log tokens or anything personal; test that.
- Read real logs with `flyctl logs` after a session and write down one thing
  they taught you.

## Done when
- [x] Each event above appears in the logs during a real two-player game
      (`spec/stats-logging.test.ts` plays one through a private server and
      checks the events; a real playtest on Fly is still worth a look).
- [x] Stats endpoint reports memory and is covered by a spec test (`/stats`).
- [x] A spec test fails if a token appears in log output (checked by making
      the server log one on purpose: the test went red).
- [ ] One concrete finding from production logs is recorded in PROCESS.md
      (the user's: `flyctl logs -a comp4020-final-bilalm004` after a session,
      or `curl https://comp4020-final-bilalm004.fly.dev/stats`).
