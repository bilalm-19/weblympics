# Accounts, names, passkeys and ratings

Linked from the README, which is near its word limit. The rules here are
enforced by `spec/accounts.test.ts`, `spec/auth-api.test.ts` and
`e2e/accounts.e2e.ts`.

## Guests and accounts

- Nobody has to sign in to play. A first visit gets a guest profile: a random
  id in an `HttpOnly` cookie and a server-made name such as "Swift Otter 42".
  Guests play every mode, keep their matches in that browser, and are never
  rated or on a leaderboard.
- **Create account with a passkey** (Profile on the home screen) turns the
  guest into an account and keeps its history. A passkey is a key pair made by
  your phone, laptop or security key; the server stores only the public half.
  There is no password and nothing secret in this repo.
- Sign in on another device with the same passkey (synced passkeys) or add one
  per device. The last passkey can only be removed after a confirmation, since
  without one you can't sign back in.
- **Passkeys are bound to the site's domain.** One registered on
  `localhost` (development) does not work on the Fly URL and the other way
  round: they are separate registrations.

## Display names

An account may choose a name: 3 to 16 characters, ASCII letters, digits,
spaces and `_ . ' -`, with at least one letter, unique ignoring case. "Bot",
"Admin", "You", "Deleted player" and anything shaped like a server-made name
are reserved, and the `<name> (2)` two-tab label can't be typed (no
brackets). A profanity filter (the `obscenity` package; its word list ships
inside the package) runs on the server. It has gaps, so an admin can rename by
hand.

## Your player's look

An account (and either demo account) can pick its player's shirt, shorts,
skin and hair colours and a hat or hairstyle from fixed lists, in Profile.
The server refuses anything not on the lists. Everyone in the room, players
and spectators, sees it. Guests wear their seat's default (blue or red top).

## Rated matches and the leaderboard

- **Rated is an option on the invite.** The host (whoever made the room)
  switches "Rated match" on in the ready panel before play; changing it
  clears both ready flags, like the format. The server decides whether it
  counts: both seats must be signed-in accounts on different accounts, in a
  real room (not practice against the bot, not training), in a format with a
  winner (not unlimited), and the match must finish (leaving mid-match ends
  it with no result). A guest in the room shows the option as unavailable,
  with the reason.
- **Elo, one rating per sport.** Everyone starts at 1000. When a rated match
  ends, the winner's expected score is E = 1 / (1 + 10^((Rloser - Rwinner) /
  400)); the winner gains round(32 x (1 - E)) and the loser loses the same,
  never dropping below 100. A match only moves the rating of its own sport.
  The rating update is in the same database transaction as the match row,
  and ratings can be rebuilt from the rated match rows alone.
- **The leaderboard** (home screen, Leaderboard) has a tab per sport and lists
  accounts only: never guests, and not the demo accounts. Your row is
  highlighted and your rank is shown even outside the top list. It refreshes
  every second while open. Your profile shows your rating per sport and your
  longest rally; the leaderboard dialog lists your recent matches.

## Deleting an account

Profile, then **Delete account**, then confirm with one of your passkeys. It
removes your passkeys, sessions, name, look and ratings. Past match rows stay
so your opponents' records don't change; your side of them now holds a random
id that links to nothing and is shown as "Deleted player".

## Demo accounts

"Demo One" and "Demo Two" exist so two browsers can try a rated match without
passkeys. They are locked (no rename, delete or passkey), hidden from the
public leaderboard, and reached from the closed **Dev tools** control at the
bottom of the home screen. Anyone can use them, so treat them as public.

## Admin: rename or remove a name by hand

The database is SQLite in WAL mode on the Fly volume (`/data/app.db`). Open it
with `node:sqlite`, never by copying `app.db` alone, and take a backup first:

```sh
flyctl volumes snapshots create vol_49122gk5j8qm2p3r -a comp4020-final-bilalm004
flyctl ssh console -a comp4020-final-bilalm004 -C "node -e \"
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/app.db');
db.exec(\\\"VACUUM INTO '/data/backup-before-rename.db'\\\");
db.prepare('UPDATE players SET name = ? WHERE account = 1 AND lower(name) = lower(?)').run('Renamed Player 1', 'the bad name');
\""
```

Pick a replacement that passes the name rules above and isn't taken (the
unique index refuses a clash). To remove an account outright, the player can
delete it themselves; an admin script for that is not built.

## Security notes

- Session cookie: 256 random bits; only its SHA-256 is stored. Cookies are
  `HttpOnly`, `SameSite=Lax`, and `Secure` everywhere but `localhost`.
- Every `/api` POST and the WebSocket upgrade must come from this site's own
  page (the `Origin` header), which is the CSRF defence.
- Passkey checks are `@simplewebauthn/server`'s. Challenges are random, single
  use and expire after two minutes; the origin and rp id are checked on every
  ceremony. Ceremonies are rate limited per address.
- No cookie, challenge, credential or internal player id is written to the
  logs.
