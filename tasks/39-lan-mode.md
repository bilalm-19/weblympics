# 39 LAN mode: play on the same wifi

Status: built and specced (Claude, 2026-11-13); needs a playtest on real devices (a laptop host and at least one phone and one other laptop).
Model: Opus 5.5
Waits on: nothing.

## Decided (user, 2026-11-13)
- A local version people on the same wifi can play: one computer runs the
  server, everyone else opens it in a browser. The Fly app stays as it is.
- Friends, names and character customisation must still work on a LAN.
- Accounts without passkeys (option A of two offered): a one-click local
  account, plus a recovery code to sign in on another device. Option B, real
  passkeys through a hostname and a trusted certificate on every device, was
  turned down as too much setup for each new player.

## Why it needs more than `pnpm start`
- The webcam only works on a secure page (https or localhost). By IP address
  over http it is refused, the guest cookie (Secure off localhost) is
  dropped, and `allowedOrigin` refuses the socket. Serving https fixes all
  three without loosening any check.
- Passkeys need a domain name as their rp id, never an IP address, so on a
  LAN nobody could become an account, and friends, names and looks are
  accounts only.

## Built
- `pnpm lan` (`scripts/lan.ts`): builds, makes a certificate for localhost
  and this computer's IPv4 addresses (self-signed and anonymous, made by
  `scripts/lan-cert.ts`; remade when an address changes), then starts the server with
  `TLS_CERT`, `TLS_KEY`, `LAN_ACCOUNTS=1` and port 8443.
- `server/index.ts`: https when `TLS_CERT` and `TLS_KEY` are set, and prints
  the addresses to open. Unset on Fly, so nothing changes there.
- Local accounts and recovery codes (`server/accounts.ts`, `server/auth.ts`,
  schema v11), only in LAN mode and never on Fly. Rules in
  `docs/accounts.md#lan-mode-local-accounts`.
- The profile dialog and the profile menu offer them in place of passkeys in
  LAN mode. Guest messages that named passkeys now say "create an account"
  in both modes.
- Anonymous certificate (user, 2026-11-13): mkcert wrote the host's Windows
  username, computer name and full name into every certificate, readable by
  any player via "view certificate". `scripts/lan-cert.ts` now makes a
  self-signed "Weblympics LAN" one with `selfsigned` (a dev dependency), so
  no mkcert or openssl is needed; an old mkcert certificate is replaced on
  the next run (`spec/lan-cert.test.ts`).

- Offline on one computer (user, 2026-11-13: two modes, offline as the
  simple extra and wifi multiplayer opt-in with its warnings written down):
  `pnpm local` (`scripts/local.ts`, `docs/local.md`) listens on 127.0.0.1,
  where http://localhost is a secure page, so no certificate; the server
  serves the pose runtime and models under `/pose/` and the page's
  `connect-src` is `'self'`. `pnpm lan` serves them the same way
  (`spec/local-mode.test.ts`).

## Done when
- [x] `spec/lan-accounts.test.ts`: code shape and typing, v10 to v11 keeps
  every player, only the hash stored and never logged, sign in elsewhere with
  the code, a new code ends the old, renewal, delete needs your own code, demo
  accounts locked, off by default and always off on Fly.
- [x] Checked by hand over the LAN address: https, a Secure guest cookie, a
  local account's socket welcomed with its tag, another site's origin refused
  (403); in Chromium at 390 x 844, create shows the code, and a second browser
  signs in with it typed in lower case.
- [ ] Playtest on real devices: camera on a phone through the warning, a
  match between two devices, friends online across them.
- [ ] Hosted from Windows (Private profile, firewall prompt) and from macOS (firewall prompt, `caffeinate`), as `docs/lan.md` says.

## Not built
- Chrome on another laptop stays on "Connecting" over `pnpm lan`: its
  WebSocket never reaches the server (2026-11-13). Cause not confirmed; the
  server now logs `tls_error` and `ws_refused` to tell.
- An e2e for the LAN profile flow (`e2e/` runs against the normal app).
