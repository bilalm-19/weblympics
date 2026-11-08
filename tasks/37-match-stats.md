# 37 Match stats instead of ratings

Status: decided (user, 2026-11-08); starts after `integrate-rest` is on main; the friends part after task 34.
Model: Opus 5.5
Waits on: `integrate-rest` merged (bowling's draws, schema steps); task 34 for opening a friend's stats; task 27 stores the track event per match.

## Decided (user, 2026-11-08)
- **Remove ratings and the leaderboard:** Elo (`server/ratings.ts`), the
  leaderboard screen and its polling, the room's "rated" option and its
  blocked reasons (`isRated`, `ratedBlocked`), and their specs and e2e. A new
  schema step drops the ratings table; match rows stay (stats come from
  them). The open "half a point for a draw" question goes with it.
- **Stats per sport:** played, won, lost, drawn, and one record:
  tennis best rally, archery best arrow, track sprint fastest 100 m,
  **hurdles its own stats** (played/won/lost and fastest hurdles time,
  separate from the sprint), boxing knockouts, basketball longest make,
  bowling best score.
- **Only finished matches between two people count,** for everything,
  records included. Unlimited and practice vs the bot count for nothing.
- **Where:** in your profile; friends open each other's from the friends
  list, with head-to-head ("you vs Ali: 12-8").
- **Guests too:** they see their own stats on that browser (their guest id).
- Deleted accounts: their rows keep the tombstone; they show as "Deleted
  player" in a head-to-head.

## Done when
- [ ] Ratings, leaderboard and the rated option gone; schema step with its old-database test.
- [ ] Stats and head-to-head from match rows, pure and spec'd (`spec/stats-*.test.ts`), unlimited and practice excluded, hurdles apart from sprint.
- [ ] Profile and friend's stats at both viewports; e2e.
- [ ] CLAUDE.md (Ratings rules rewritten), README and spec agree.
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
