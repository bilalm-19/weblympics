# Weblympics

Wii-Tennis-style game in the browser. Two players (or one vs a bot) hit a shared
ball by swinging in front of their webcam; spectators watch live. The server
owns the ball and the score. Clients only send swing events and render what the
server says. Rooms and matches persist in SQLite on `/data`.

Brief: https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/
Fixed by the course: `fly.toml`, `Dockerfile` shape, `spec/invariants.test.ts`
(`/` returns 200, `/readme/` publishes `README.md`). Never delete those checks.

## Stack

TypeScript everywhere, pnpm, Node 24. Server: plain `node:http` + `ws` +
`node:sqlite`. Client: Vite + vanilla TS + Three.js, low-poly flat-shaded 3D (no
post-processing, no heavy assets). Camera swing detection is MediaPipe, loaded
lazily and only when a player enters a game. Video never leaves the browser.

## Layout

- `shared/` pure, deterministic game sims and the WebSocket protocol, used by the server and the client. Each game is `shared/games/<name>/` (sim, bot, adapter) and registers in `shared/games/registry.ts`.
- `server/` plain `node:http` + `ws` + `node:sqlite`: rooms (`room.ts`, `rooms.ts`, `lobby.ts`), accounts and friends, the db and its versioned `schema.ts`. Rooms get their sim from the registry, so networking is game-agnostic.
- `client/` the Vite app: `games/<name>/` (view, scene, camera, practice), `input/` (keyboard and the camera maths in `camera/`), `audio/`, `ui/` (home screen, profile, friends, party, guide), `net/`.
- `spec/*.test.ts` vitest against the running app plus the sim unit tests; `e2e/*.e2e.ts` Playwright at both viewports.
- The file-by-file map is `docs/layout.md`. **Keep this file short** (user, 2026-11-09: it had grown to 811 lines, 12 agent branches each adding their game to it in one day). A new game's or feature's detail goes in `docs/game-rules.md` or `docs/layout.md`, never here; only a rule that cuts across the whole project belongs in this file.

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
- `docs/game-rules.md` is every sport's and feature's rules and numbers, and `docs/layout.md` the file-by-file map: the detail lives there, not here.
- `logs/devlog.md` is append-only. Log decisions, milestones, bugs and playtest
  findings: date/time (from `date`), type, what happened, outcome, why, and who
  decided it (`user`, `Claude` or `agent`).

## Rules

- The server never trusts a client's claim of a hit or a score; it resolves
  hits from swing timestamps against its own sim.
- A schema change is a new step in `server/schema.ts` plus a test that opens
  a database made by the previous version; never edit an old step.
- A ball in the air is live for everyone, even one going out: a person may
  volley it or leave it. Once it has landed out (or bounced twice) it is dead
  and every swing misses. The bot lets go a ball it predicts will land out
  (`spec/rally-fixes.test.ts`, task 12).
- Game logic stays deterministic (seed + input stream) so it can be tested.
- Video never leaves the browser. The game page's CSP `connect-src` allows
  only this server and the pose model's download hosts (`spec/privacy.test.ts`);
  it also blocks MediaPipe's own usage pings. Don't widen it casually.
- Camera is used for gameplay only. Every camera action has a keyboard/mouse
  equivalent, and the lobby and room work with no camera at all. The one
  exception is calibration (task 25): swing or push speed has no key
  meaning, so calibrating is camera only, always optional, and with no
  camera it isn't offered (the reason says so); keys play on the defaults.
- Webcam is the default (task 15, `e2e/webcam-default.e2e.ts`): a seated
  player's game (practice, room, training) opens the camera setup first, with
  "Use keyboard instead" on each step; that, Escape or a refused permission
  leaves a playable game on keys. After the setup, practice offers training
  once per device ("Train first" / "Skip training"); Train stays on the home
  screen. Spectators get no camera setup.
- Logs never carry a token, cookie, passkey value or name, chosen or
  pseudonym (`spec/stats-logging.test.ts` runs a private server and reads its
  output); use `who(token)` from `server/log.ts`.
- Every bug fix adds a test that fails without it. When I correct you, put the
  rule here or in `spec/`, not only in the chat.
- Keep `README.md`, this file and `spec/` consistent; a claim in one needs to
  hold in the others.
- No ratings (task 37, user, 2026-11-08; `spec/db.test.ts` "schema v10"):
  Elo, the leaderboard, its polling, the room's "Rated match" switch, the
  `rated` message and `LobbyView` fields, `isRated` and `ratedBlocked` are
  gone, and schema step 10 drops the `ratings` table. Every finished match
  is still a row in `matches` (`insertMatch`), practice and unlimited
  flagged as before; the old `rated` column stays in the table, always 0
  now, and nothing reads it. The server no longer needs a host option or
  account check to store a match. Stats from these rows (played, won, lost,
  drawn, one record per sport, head-to-head) are the rest of
  `tasks/37-match-stats.md` and are not built yet.
- A room link typed into a tab that is already open joins the room (user,
  2026-11-09): `useRoomLink` in `client/main.ts` runs at load and on
  `hashchange`, and never re-joins the room you are in
  (`e2e/layout.e2e.ts`, "typed into a tab").
- `e2e/camera.e2e.ts` "sends no video" fails on the Vite dev server (:5173)
  because the dev client's own hot-reload socket is on the page; it passes on
  a built app. Run it against `pnpm build && pnpm start`.
- Per-game and per-feature rules (scoring, rooms, accounts, friends and parties, looks, each sport's inputs and numbers, calibration, sound, practice, the guide) are in `docs/game-rules.md`; read the section for what you are changing. The named specs are the real check, and a rule there still binds. Rooms: invite link or room code only, two seats, anyone else spectates, at most 10 watchers. Accounts: who you are comes only from HttpOnly cookies the server sets, never from a message. Camera: webcam by default, every camera action has a key or mouse equivalent.

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
- E2e runs headless: `pnpm e2e --workers=1`, and at most one or two runs at
  once across all sessions and agents. The browsers draw on the CPU
  (SwiftShader), and in parallel several 1080p ones starve the frame rate,
  so the trail and camera tests fail on code that passes alone (measured: 3
  of 48 failed with 4 workers). Re-run a lone failure by itself before
  calling it a bug. `pnpm e2e:gpu` uses the laptop's GPU (1.8x faster, 48 of
  48 green with 4 workers) but needs visible browser windows under WSLg
  (off-screen and minimised windows still show; headless falls back to
  SwiftShader), which take over the user's screen: only with the user's OK,
  e.g. when they're away.
- Never commit or push on red. Commit when green, in small commits with clear
  messages. Gate on the test command's own exit code, never on a
  pipe into `grep` (the pipe's status is grep's, so red can look green).
- When another session is editing the tree, stage files by name and check
  the commit against a clean build of HEAD (a `git worktree` on another
  port), since the shared working tree also builds in their unfinished work. Ask before every push (pushing to main deploys once the repo is public).
- Agents: each task is discussed with the user, then
  built by agents, one git worktree and one branch each, never `main`. An
  agent runs its app on its assigned port with its own data folder
  (`pnpm build && PORT=82NN DATA_DIR=./data-82NN pnpm start`) and always
  sets `APP_URL=http://localhost:82NN` for `pnpm check` and `pnpm e2e`:
  without it the tests hit :8080, the user's dev server on `main`, and pass
  or fail on code the agent never ran. Ports: 8080/5173 the user's dev
  server, 8201-8298 agents, 8299 the integration branch. Restart the app
  before each check; e2e as in the rule above. Agents commit on their
  branch only and never push; Claude merges on an integration branch, runs
  the full checks there, then moves `main`.
- Never commit secrets or `mise.local.toml`.
