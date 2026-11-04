# Weblympics

Wii-Tennis-style game in the browser. Two players (or one vs a bot) hit a shared
ball by swinging in front of their webcam; spectators watch live. The server
owns the ball and the score. Clients only send swing events and render what the
server says. Rooms, matches and ratings persist in SQLite on `/data`.

Brief: https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/
Fixed by the course: `fly.toml`, `Dockerfile` shape, `spec/invariants.test.ts`
(`/` returns 200, `/readme/` publishes `README.md`). Never delete those checks.

## Stack

TypeScript everywhere, pnpm, Node 24. Server: plain `node:http` + `ws` +
`node:sqlite`. Client: Vite + vanilla TS + Three.js, low-poly flat-shaded 3D (no
post-processing, no heavy assets). Camera swing detection is MediaPipe, loaded
lazily and only when a player enters a game. Video never leaves the browser.

## Layout (update this when it changes)

- `shared/` pure, deterministic game sim and the WebSocket protocol, used by
  server and client. Each game lives in `shared/games/<name>/` (sim, bot,
  adapter) and registers in `shared/games/registry.ts`. Tennis scoring
  (points, games, sets, tiebreak, faults) is `shared/games/tennis/scoring.ts`;
  the sim keeps its `ScoreState` in the snapshot. `machine.ts` is training's
  seeded ball machine (feeds with the sim's own `launch()`). Archery
  (task 22) is `shared/games/archery/`: `sim.ts` (stages, seeded wind,
  flight, rings; `predictHit` with no wind is the client's preview),
  `bot.ts` (`solveAim` plus noise), `index.ts` (adapter). Track (task 26,
  sprint; hurdles is task 27) is `shared/games/track/`: `sim.ts` (lanes,
  steps to cadence to speed, the cadence cap, finish times; an `obstacles`
  list, empty for the sprint), `bot.ts` (target cadence plus noise),
  `index.ts` (adapter). `shared/look.ts`
  is the fixed palette and hat/hair list for a player's look (task 18).
- `server/` `index.ts` (http + ws + `/readme/`), `rooms.ts` (live rooms with
  the real clock and db), `room.ts` (one room: 60 Hz tick loop, seats,
  spectators, game), `lobby.ts` (pure room rules: phases, ready, format,
  countdown, the 30 s hold; clock injected), `db.ts` (SQLite on `/data`), `schema.ts` (versioned
  schema, migrations, match rows, who is rated), `log.ts` (JSON log lines;
  players appear only as `who`, a per-run keyed hash; `/stats` in
  `index.ts` gives counts, loop timing and memory, task 8),
  task 17: `accounts.ts` (guests, accounts, passkeys, sessions, delete; pure
  over a db handle), `ratings.ts` (task 7: Elo, leaderboards, history), `auth.ts` (the `/api/*` account routes and passkey
  ceremonies), `guard.ts` (cookies, Origin check, challenges, rate limits),
  `names.ts` (pseudonyms and the chosen-name rules; shape shared in
  `shared/names.ts`).
  Rooms get their sim from the registry, so networking is game-agnostic.
- `client/` Vite app: `games/<name>/view.ts` (scene, HUD, input wiring),
  `games/tennis/score-bar.ts` (top score bar), task 16's point call:
  `point-call.ts` (pure: the call in tennis words, who won, how big, who
  reacts; task 19's crowd and sound should reuse it), `call-banner.ts` + `.css`
  (the big call across the top, the live region) and `reaction-fx.ts`
  (scribble and sparkles over the players; the fist pump and slump are
  `Player.react` in `character.ts`),
  `games/tennis/ready-panel.ts` + `.css` (the room's ready panel, task 4),
  training (task 5): `training.ts` + `.css` (coach panel, landing mark),
  `lessons.ts` (pure: steps, feedback words, "Why?" notes),
  `spot.ts` (pure: hit-the-spot placement, closeness, streak; task 21),
  `training-sim.ts` (sim + ball machine in the page) and `local-link.ts`
  (a `GameLink` like `Connection`, so `view.ts` renders training unchanged;
  no network),
  `games/tennis/stadium.ts` (arena from primitives: static parts merged into
  two vertex-coloured meshes, instanced crowd/trees; returns the crowd handle),
  `games/tennis/crowd-layout.ts` (pure: stands and seats in four sections,
  left, right, frontLeft, frontRight, for task 19 to drive),
  `games/tennis/character.ts` (Mii-style player and racket, coloured and
  hatted from the seat's look, task 18),
  `games/tennis/stroke.ts` (forehand/backhand keyframes, shot label text),
  `games/tennis/shot-fx.ts` (ball trail, bounce marks, shot arc),
  `games/tennis/trajectory-aid.ts` (pure: timing arcs, meter, strength ticks)
  with `aid.ts`/`aid-fx.ts`/`aid.css` drawing it (task 3), `input/`
  (`keyboard.ts` for keys, pointer and buttons; `camera/` with `pose.ts` pure
  landmark maths, `camera.ts` webcam + lazy MediaPipe, `index.ts` setup
  panel), `net/socket.ts` (`Connection`), `net/link.ts` (`GameLink`), `ui/menu.ts` (home screen: animated logo, then sport buttons from
  the `SPORTS` list in a left column and the framed preview (a looping SVG
  snippet per sport) with the selected sport's options in a right column,
  stacked on phones; the arrow as the mouse cursor; inline SVG/CSS only, no
  Three.js: `spec/home-screen.test.ts`; the Profile and Leaderboard buttons and the
  closed "Dev tools" with the demo accounts), `ui/brand.ts` (the five ring
  colours and every text/background pair, held to WCAG AA by
  `spec/brand.test.ts`; task 14), `ui/profile.ts` + `.css` (task 17's profile
  dialog, with task 18's customise section; `ui/look-preview.ts` draws the
  look as SVG, since the menu never loads Three.js), `net/account.ts`
  (`/api/*` calls; the passkey prompt is loaded only when needed),
  `ui/leaderboard.ts` + `.css` (task 7: a tab per sport, polled each second). Camera swings have two modes,
  "classic" (default) and "follow" (character copies the arm, hit at the
  hitting line), and two aim modes, "timing" (default) and "point"; see
  the camera setup notes in `tasks/done/`. Movement has two modes per seat,
  "auto" (default: the server walks you to the ball, `autoTargetX` in
  `sim.ts`) and "tilt" (lean to move); keys and buttons move you in either
  (task 2). Archery (task 22) is `games/archery/`: `view.ts` (range, sight,
  wind dial, target card, score; mouse, keys, hold button), `range.ts`,
  `bow.ts` (pure: bow-hold landmarks to aim, draw, release),
  `bow-camera.ts` (its camera panel; loads the hand model too),
  `bow-model.ts` (the first-person bow), `practice.ts` + `practice-sim.ts`
  (in-page practice), `archery.css`; it reuses tennis's ready panel. Track
  (task 26) is `games/track/`: `view.ts` (side-on chase camera, race board,
  A/D, arrows and two tap buttons), `lane.ts` (track and runners from
  primitives), `run-camera.ts` (its camera panel: mode, stand-still
  calibration), `practice.ts` + `practice-sim.ts` (in-page practice vs a
  pacer), `track.css`; the pure camera maths is `input/camera/run-pose.ts`;
  it reuses tennis's ready panel.
- `spec/*.test.ts` vitest against the running app, plus the sim unit tests.
- `e2e/*.e2e.ts` Playwright at both viewports, fake webcam.

## Commands

- `pnpm build && pnpm start` runs the app on :8080 (`DATA_DIR` overrides
  `./data`). `pnpm check` (typecheck + spec) and `pnpm e2e` need it running.
- `pnpm dev:server` + `pnpm dev:client` for hot reload (vite proxies to :8080).
  On this `/mnt/c` drive `node --watch` misses edits: restart `dev:server`
  before `pnpm check`, or the spec runs against the old server.
- Docker isn't available in this WSL; CI builds the image, so keep the
  Dockerfile's runtime stage free of dev dependencies.

## Docs

- `tasks/` is the work breakdown (start at `00-overview.md`, one numbered list in build order); update a task's
  status line when it changes.
- `README.md` 400-600 words on what "good" means here (served at `/readme/`).
  `PROCESS.md` 900-1100 words, rewritten each crit.
- `logs/devlog.md` is append-only. Log decisions, milestones, bugs and playtest
  findings: date/time (from `date`), type, what happened, outcome, why, and who
  decided it (`user`, `Claude` or `agent`).

## Rules

- The server never trusts a client's claim of a hit or a score; it resolves
  hits from swing timestamps against its own sim.
- Scoring is real tennis for everyone (`spec/sim-scoring.test.ts`): one set by
  default, best of three or unlimited, tiebreak at 6-6, two serves per point, no lets.
  The score bar only renders the server's `ScoreState`. The call after a point
  (task 16, `spec/point-call.test.ts`, `e2e/call-banner.e2e.ts`) is worked out
  on each screen from two snapshots: no network message, spectators see it
  too, and it never covers the court or the HUD. Practice never ends
  (a won match starts a new one) and practice-vs-bot is never rated
  (`spec/db.test.ts`).
- Rooms (task 4; `spec/lobby.test.ts`, `spec/room-rules.test.ts`,
  `spec/rooms.test.ts`): invite link or room code only, no public list. Two
  seats; a third arrival only spectates (no queue). Phases `waiting ->
  ready-check -> countdown (3 s) -> playing`; each seat's `ready` is the
  server's, the bot is always ready, un-readying cancels the countdown, a
  disconnect before the match frees the seat. The host (first seat) picks one
  set (default), best of three or unlimited before play; a change clears both
  ready flags. Mid-match, a dropped connection holds the seat and pauses for
  30 s ("waiting for <name>", seconds left); the same token reclaims it and a
  3 s countdown resumes play, otherwise the room closes with no result.
  Pressing Leave mid-match ends it with no result. Unlimited has no winner,
  counts points and best rally, ends when someone leaves and is stored
  unrated. Practice vs bot starts at once. One token may hold both seats (two
  tabs, for testing); its second seat is shown "<name> (2)" and its matches
  are unrated. Ratings read only `rated = 1` rows.
- Ratings (task 7; `spec/ratings.test.ts`, `spec/rated-match.test.ts`,
  `e2e/leaderboard.e2e.ts`): "rated" is the host's option on the room, set
  before play; a change clears both ready flags. A match is stored
  `rated = 1` only if the host had it on, both seats are accounts on
  different tokens, it isn't practice, the format has a winner and it
  finished (`isRated` in `server/schema.ts`; the lobby's `ratedBlocked` says
  why not, using the same rule). Elo per account per sport: start 1000,
  K = 32, floor 100, updated in the match row's transaction
  (`server/ratings.ts`). A match only moves its own sport's rating; sports are
  the registry's ids (`matches.game`, `ratings.sport`). The leaderboard lists
  accounts only, hides the demo accounts, and shows your rank outside the
  top list; it polls once a second.
- Accounts (task 17; `spec/accounts.test.ts`, `spec/auth-api.test.ts`,
  `e2e/accounts.e2e.ts`): who you are comes only from HttpOnly cookies the
  server sets (`wl_guest`, a random guest id; `wl_session`, 256 random bits
  with only its hash stored), never from a message. Play never needs an
  account. A guest keeps a server-made pseudonym, can't rename and is never
  rated or on a leaderboard. A passkey (`@simplewebauthn`, never hand-rolled)
  claims the guest, keeping its history; an account may choose a name: 3 to
  16 ASCII letters, digits, spaces or `_ . ' -`, unique ignoring case, not
  reserved (Bot, Admin, the server's pseudonym shape) and passing `obscenity`,
  all checked on the server. Every POST and the WebSocket check Origin;
  challenges are single use and expire in 2 minutes; ceremonies are rate
  limited; no cookie, challenge or credential is logged. Deleting needs a
  fresh passkey check and removes passkeys, sessions, name, look and ratings;
  match rows stay with a random tombstone shown as "Deleted player". The two
  demo accounts are locked (no rename, delete or passkey), hidden from the
  board, and reached only from the home screen's closed "Dev tools".
- Looks (task 18; `spec/look.test.ts`, `e2e/look.e2e.ts`): an account's look
  is five enum values from `shared/look.ts`, checked on the server (anything
  outside the lists, or any extra field, is refused and nothing is stored).
  Guests always wear their seat's default. The server puts each seat's look
  in the room state, so both players and spectators see it. The demo
  accounts may change their look (it is how two seats get tested).
- A schema change is a new step in `server/schema.ts` plus a test that opens
  a database made by the previous version; never edit an old step.
- A ball in the air is live for everyone, even one going out: a person may
  volley it or leave it. Once it has landed out (or bounced twice) it is dead
  and every swing misses. The bot lets go a ball it predicts will land out
  (`spec/rally-fixes.test.ts`, task 12).
- Game logic stays deterministic (seed + input stream) so it can be tested.
- Tennis, archery (task 22) and track (tasks 26-27, one game with two
  events: the sprint is playable, hurdles is task 27) are the games. Add
  another only when I ask. Each lives in `shared/games/<name>/` and registers in the registry, so
  rooms, lobby and reconnect stay game-agnostic. A game's specs are named
  `spec/<name>-*.test.ts` and `e2e/<name>-*.e2e.ts`.
- Video never leaves the browser. The game page's CSP `connect-src` allows
  only this server and the pose model's download hosts (`spec/privacy.test.ts`);
  it also blocks MediaPipe's own usage pings. Don't widen it casually.
- Training (task 5) runs in the page: no room, score or rating, and nothing
  sent to the server (`spec/training.test.ts`, `e2e/training.e2e.ts`).
  Required steps: swing, forehand, backhand, timing (early, on time and late
  each landing in), strength; auto-move stays on. Moving yourself is offered
  after them and optional. Figures in its notes come from `docs/reaction-time.md`.
  "Hit the spot" (task 21, `spec/spot.test.ts`) is an endless extra offered on
  the training screen, never required: seeded spot on the machine's half, a
  closeness word and ring colour per return, a streak, the best streak kept
  only in `localStorage`; Exit leaves. Same rules: nothing sent to the server.
- Archery (task 22; `spec/archery-*.test.ts`, `e2e/archery.e2e.ts`): eight
  stages (10 m to 50 m, wind rising from none), one arrow each per stage,
  turns alternate and the first shooter swaps; rings 10 to 1, bullseye 11;
  a tie goes to sudden death at 50 m (nearer the centre wins, exact tie
  shoots again, not added to the score); a 30 s shot clock. The server flies
  the arrow and scores it; the client's sight is `predictHit` with no wind.
  Formats are a game's own (`GameDef.formats`): archery offers "stages" and
  "unlimited" (random level each stage, counts points and best arrow,
  unrated). Practice runs in the page, cycling levels or on a picked distance
  and wind; nothing sent to the server. Camera: the aiming hand aims, the
  draw is the hands' gap along the shoulders, opening the drawing hand
  shoots (MediaPipe's hand model, fingers' fold in 3D); with no hand read a
  fast snap shoots; a slow closed return cancels. A fixed lens, so the board
  shrinks with distance.
- Track (task 26; `spec/track-*.test.ts`, `e2e/track-*.e2e.ts`): a 100 m
  lane per seat, lanes never interact. Clients send only `step` events (which
  foot, their own timestamp); the server owns distance, speed and the finish.
  Speed follows a smoothed cadence and decays when you stop. A step on the
  same foot twice is ignored, not punished; steps faster than the human cap
  (10 a second, by the step's own timestamp and by the server's own clock)
  are dropped, so shaking or mashing buys nothing. Steps before the gun
  don't count. First across the line wins; a dead heat is run again; the
  other runner has 5 s after the first finish. Formats: "race" (rated
  between two people) and "unlimited" (race after race, counts races won and
  best times, unrated). Practice vs bot is never rated. Practice runs in the
  page against the bot as a pacer; nothing sent to the server. Camera
  (`spec/track-run-pose.test.ts`): two modes behind a setting, "elbows"
  (a hand rising toward its shoulder is a step) and "knees" (a knee rising
  is a step; stand back), measured in shoulder widths from a stand-still
  calibration. "elbows" is the provisional default until a real-webcam
  playtest picks one.
- Camera is used for gameplay only. Every camera action has a keyboard/mouse
  equivalent, and the lobby and room work with no camera at all.
- Webcam is the default (task 15, `e2e/webcam-default.e2e.ts`): a seated
  player's game (practice, room, training) opens the camera setup first, with
  "Use keyboard instead" on each step; that, Escape or a refused permission
  leaves a playable game on keys. After the setup, practice offers training
  once per device ("Train first" / "Skip training"); Train stays on the home
  screen. Spectators get no camera setup.
- Auto-move (`spec/auto-move.test.ts`) walks slower than manual movement
  (`AUTO_SPEED` share of `PLAYER.speed`) so a wide hard shot can beat it;
  strength must keep mattering. The movement mode is an input to the sim,
  never a client claim of position.
- Logs never carry a token, cookie, passkey value or name, chosen or
  pseudonym (`spec/stats-logging.test.ts` runs a private server and reads its
  output); use `who(token)` from `server/log.ts`.
- Every bug fix adds a test that fails without it. When I correct you, put the
  rule here or in `spec/`, not only in the chat.
- Keep `README.md`, this file and `spec/` consistent; a claim in one needs to
  hold in the others.

## Viewports

Everything must work at desktop 1920x1080 and mobile 390x844: no horizontal
scroll, controls reachable, canvas not clipped. Check both for any UI change.

## Workflow

- Small changes (copy, styling tweaks, comments, renames): don't run tests.
- Changes confined to one game (`shared/games/<name>/`, `client/games/<name>/`,
  its specs): run only that game's specs (`pnpm vitest run spec/<name>`) and
  e2e (`pnpm e2e --workers=1 e2e/<name>`). Anything touching shared code
  falls under the next rule.
- Changes to `shared/`, `server/`, the protocol, the db or `spec/`: run
  `pnpm check` without being asked.
- UI or layout changes: run `pnpm e2e` (both viewports) without being asked.
  Use `pnpm e2e --workers=1` here: in parallel, several software-rendered
  1080p browsers starve the frame rate, and the trail and camera tests fail
  on code that passes one at a time.
- Never commit or push on red. Commit when green, in small commits with clear
  messages. Gate on the test command's own exit code, never on a
  pipe into `grep` (the pipe's status is grep's, so red can look green).
- When another session is editing the tree, stage files by name and check
  the commit against a clean build of HEAD (a `git worktree` on another
  port), since the shared working tree also builds in their unfinished work. Ask before every push (pushing to main deploys once the repo is public).
- Never commit secrets or `mise.local.toml`.
