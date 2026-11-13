# Accounts, names, passkeys

Linked from the README, which is near its word limit. The rules here are
enforced by `spec/accounts.test.ts`, `spec/auth-api.test.ts` and
`e2e/accounts.e2e.ts`.

## Guests and accounts

- Nobody has to sign in to play. A first visit gets a guest profile: a random
  id in an `HttpOnly` cookie and a server-made name such as "Swift Otter 42".
  Guests play every mode, keep their matches in that browser, and are never
  ranked.
- **Create account with a passkey** (the profile button, top right of the home screen) turns the
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

## Matches, not ratings

Task 37 removed ratings, the leaderboard and the room's "Rated match" option.
Every finished match is still stored as a row (practice against the bot and
unlimited are flagged); the old `rated` column stays in the table but is
never set or read, and schema step 10 dropped the `ratings` table. Your
profile shows your longest rally. Per-sport stats come next (task 37).

## Deleting an account

Profile, then **Delete account**, then confirm with one of your passkeys. It
removes your passkeys, sessions, name and look. Past match rows stay
so your opponents' records don't change; your side of them now holds a random
id that links to nothing and is shown as "Deleted player".

## Demo accounts

"Demo One" and "Demo Two" exist so two browsers can try two seats without
passkeys. They are locked (no rename, delete or passkey), and reached from the closed **Dev tools** control in the
home screen's profile panel (the round button, top right). Anyone can use them, so treat them as public.

## LAN mode: local accounts

Only when the game runs with `pnpm lan` ([lan.md](lan.md)); the Fly app has
none of this (`/api/local/*` answers 404, and `LAN_ACCOUNTS` is ignored on
Fly). Enforced by `spec/lan-accounts.test.ts`.

- On a LAN the page is reached by IP address, where passkeys can't work (a
  passkey's rp id must be a domain name). **Create account** instead makes the
  guest an account in one click, keeping its history, pseudonym and a new
  `#1234` tag, as a passkey claim does. It is signed in by the usual session
  cookie, renewed on each visit so a regular player is never signed out by
  the session running out.
- Each local account has one **recovery code**: 16 characters from
  `A-Z` and `2-9` without `I`, `L` and `O` (about 79 bits), shown as four
  groups of four. It is returned once, by the request that makes it; the
  database keeps only its SHA-256 (`recovery_codes`, schema v11; a fast
  hash is enough for a long random code). Case, spaces and dashes don't
  matter when it's typed. It is never logged.
- The code signs in on any browser (`/api/local/recover`, under the passkey
  rate limit). **Make a new recovery code** replaces it, and the old one stops
  working at once.
- Deleting a local account asks for its code in place of the passkey check;
  the code goes with the account.
- Anyone with the code is you. If someone else has seen it, make a new one.
  Lost the code and this browser's cookies? The account can't be reached
  again (the host can still remove its name by hand, below).

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
