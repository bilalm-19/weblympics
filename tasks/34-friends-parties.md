# 34 Friends, status, parties and name tags

Status: designed with the user (2026-11-08); proposals 1-3 and 5 accepted, parties amended (4). Not built. Built only if basketball and bowling merge cleanly by Sunday evening; otherwise after the deadline.
Model: Opus 5.5
Waits on: the basketball and bowling merges (they change the protocol and rooms).

## Decided (user, 2026-11-08)
- **Friends:** add someone by their full name and tag, or by a friend link;
  they accept or decline. The friends list is for easy invites.
- **No chat of any kind** (user): "the point is for friends to play, they
  can contact each other themselves, the friends list is just ease of
  invite". Nothing to moderate or store.
- **Status:** online, away, offline.
- **Parties:** several people together; games stay 1v1, the others
  spectate. Public or private (invite only). Who plays next, the leader's
  choice of: leader picks, rotate with winner stays on, rotate with both
  swapping out, randomise.
- **Name tags:** an account's name is a chosen name plus a random 4-digit
  tag, `Sam#4821`. Several people may share a name; name and tag together
  are unique. If all 10,000 tags for a name are taken, the user is told to
  pick another name. The tag shows only in the friends list, the profile and
  friend requests; games, the score bar and the leaderboard show just the
  name. Changing your name keeps your tag if it's free under the new name.
  The demo accounts get fixed tags and stay locked.
- **Identity:** friendships, ratings, history and parties are stored by the
  hidden account id, never shown on screen or in links; a friend link
  carries its own random, single-use, expiring code.

## Design (Claude's proposal, to confirm)
- **Accounts only:** guests can't friend or be friended (no lasting
  identity); one passkey makes an account.
- **Friend requests:** exact name#tag only, no search or partial matches
  (nobody can browse the players); a request shows the sender's name, tag
  and character picture. Unfriend and decline are silent.
- **Status:** online while a tab is open, away after about 5 minutes idle or
  a hidden tab, offline with no tab; you can set "appear away" or "appear
  offline". Only friends see it. Worked out live from open connections, not
  stored past the session.
- **Invite to a match:** a friend gets a pop-up "Sam invites you to
  Tennis. Join?" that drops them into the room (the existing invite flow).
- **Parties:** up to 10 (the watcher limit). A leader; invite-only parties
  take friends or a party link. **Public parties are listed to the leader's
  friends** (user, 2026-11-08), never to strangers; anyone else needs the
  link. **In the party lobby, every member is shown** (name, look, status,
  who's playing next); **in a game the party shows compact** (a small strip,
  never covering the court or the HUD). The leader picks the game and the mode; two
  play, the rest watch through the spectator code; the party moves to the
  next match together. Leaving a party mid-match follows the room's rules.
- **Live updates over the WebSocket the page already has** (Claude,
  2026-11-08): requests, invites, status and party changes are pushed as
  small messages on the one connection each tab opens at load (the same one
  rooms use); no polling, no second connection. On reconnect the server
  sends the current friends list and party once, so nothing missed is lost.
  Friend links and adding by name are \`/api\` POSTs like the account routes
  (Origin checked, rate limited).
- **Server:** new tables (friendships, friend links, parties are in memory),
  a schema step with an old-db test, name tags as a schema step that gives
  every existing account a tag; all checked on the server, Origin checked,
  rate-limited requests, nothing about friends logged by name
  (`who(token)` only).

## Done when
- [ ] Each rule above in a spec that fails without it.
- [ ] Both viewports; keyboard reachable; e2e for adding a friend, an
      invite, a party playing and rotating.
- [ ] CLAUDE.md, README and spec agree (the "unique ignoring case" name
      rule replaced by the tag rule).
- [ ] `pnpm check` and `pnpm e2e --workers=1` green.
