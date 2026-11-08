# 36 Home screen redesign

Status: built on branch `home-36` (2026-11-08), not merged; the mock files are deleted (the home screen is the mock now). `pnpm check` green; home, home-layout, layout, friends, sound and webcam e2e green (two load-only failures passed alone).
Model: Opus 5.5
Waits on: `integrate-rest` merged (the menu lists bowling; the party figures use task 33's looks). The friends panel's live data waits on task 34; until then it is built against task 34's protocol or left showing only your own status.

## The approved mock
Was `client/mock-home.html` + `client/mock-home-3d.ts` (deleted once built; in git history before `home-36`). The devlog's "Home mock" entries (2026-11-08) record each round and why.

## Differs from the mock (and why)
- Sport order is the real `SPORTS` order (Tennis, Bowling, Basketball, Track, Archery, Boxing; user, 2026-11-09), not the mock's.
- Card colours are the mock's hues darkened so the white names pass WCAG AA (`spec/home-screen.test.ts`); the mock's green, orange and blue failed.
- No "How to play" button: no sport has a guide yet. The row is vs bot, Train/Practice and Party (three, not four).
- The party figures are the real looks (`look-preview.ts`), not the mock's hand-drawn people; no waving arm (the look figure has fixed arms), so the idle moves are hop, sway and bob.
- The phone's sound button floats bottom right (task 19), not top left as the mock's music button.
- The pitch line and scene follow the selected sport; the preview follows focus or hover (as before), so the buttons' panel never names a sport they won't act on.
- A test browser gets the flat icons unless the page has `?icons3d`, so the suite's "no canvas on the menu" checks hold; one e2e checks the 3D path and its fallback (`?icons3d=slow`).
- The mock's confetti on Create a room is not built (it navigates away at once).

## Decided (user, 2026-11-08)
- Fills the screen: three columns of equal height. On the left, the six sport cards (2x3, icon in its own column, never over the name). In the middle, the panel: a big looping preview, the sport's name, one line and the input chip, "Create a room" as the big button, then Practice, Train, How to play and Party in one row, then the room code box. On the right, the party panel: you alone ("Ready to play!") or up to 10 people in two rows of five, each with a name, status dot and the leader's crown, an "Invite a friend" slot, and "Change my look".
- The logo is centred on the page (a three-column top bar), bigger, with rings that overlap like the Olympic rings.
- Top right: a "Friends · N online" button, then the profile button with your status dot. The friends panel (a popover on desktop, a bottom sheet on a phone) holds: Online / Away / Offline for yourself, "Add a friend: Name#1234", requests (Accept / ✕), and friends grouped Online, Away, Offline with what they're doing and Watch / Join / Invite. Escape, ✕ or a click outside closes it.
- Light on weak devices: the scene, previews and party are inline SVG and CSS. The 3D card icons load after the flat page, only with WebGL, a window at least 760 wide and no reduced motion, through one shared renderer, and fall back to the flat icons if the frame rate drops.
- Previews: tennis rally, archer, two sprinters (no finish line), jab, set shot, a bowler from behind in the same small figure style (no ears, ball outside the body).
- Phone (390x844): stacked, sports in a 3x2 grid, the party as a strip, Friends as an icon and count.

## Build
- Port the mock into `client/ui/menu.ts` (+ CSS) and `client/ui/profile-menu.ts`. Keep the `SPORTS` list driving the cards, the real buttons' wiring, and the profile panel's passkey, sign-out and closed "Dev tools". Delete the mock files when done.
- The party panel shows the real party when task 34 lands; until then, just you.
- Keep `spec/home-screen.test.ts` (no Three.js on the flat path) and `e2e/home.e2e.ts`; add e2e for the friends panel and the status choice at both viewports, and check a short laptop window (1366x657) as well as 1920x1080 and 390x844: no horizontal scroll, the code box in view, nothing spilling out of a panel.
- Update CLAUDE.md's `ui/menu.ts` layout line.

## Done when
- [x] The home screen matches the approved mock at all three sizes (differences above).
- [x] Specs and the home/friends/sound/webcam/layout e2e green; the full `pnpm e2e` is left to the integration branch.
- [x] CLAUDE.md and README agree (README makes no home-screen claim).
