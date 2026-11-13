# Layout: what lives where

Moved out of `CLAUDE.md` on 2026-11-09. It was a paragraph per file and kept growing as every task added to it; the directory map in `CLAUDE.md` is enough to find your way, and this is the long version. Update it when a file moves.


- `shared/` pure, deterministic game sim and the WebSocket protocol, used by
  server and client. Each game lives in `shared/games/<name>/` (sim, bot,
  adapter) and registers in `shared/games/registry.ts`. Tennis scoring
  (points, games, sets, tiebreak, faults) is `shared/games/tennis/scoring.ts`;
  the sim keeps its `ScoreState` in the snapshot. `machine.ts` is training's
  seeded ball machine (feeds with the sim's own `launch()`). Archery
  (task 22) is `shared/games/archery/`: `sim.ts` (stages, seeded wind,
  flight, rings; `predictHit` with no wind is the client's preview),
  `bot.ts` (`solveAim` plus noise), `index.ts` (adapter). Track (task 26,
  sprint; task 27, hurdles) is `shared/games/track/`: `sim.ts` (lanes,
  steps to cadence to speed, the cadence cap, finish times; the `obstacles`
  list, empty for the sprint and ten hurdles for hurdles; the jump, its cap
  and the stumble), `bot.ts` (target cadence plus noise; one jump per
  hurdle plus noise), `index.ts` (adapter, closed `asInput` for `jump`,
  `asEvent`, `raceDetail` for the match row). Boxing (task 30) is `shared/games/boxing/`:
  `sim.ts` (jabs in the air with a wind-up, `judge` of guard and slip at
  landing, the held lean (slip), health, the per-hand recovery and
  the punch cap, rounds, KO, decision, draw), `bot.ts` (guards the right
  height or slips after a seeded reaction delay, jabs head or body),
  `index.ts` (adapter); its pure camera maths is
  `client/input/camera/box-pose.ts`. Its client is `client/games/boxing/`:
  `view.ts` (HUD, bout board, round call, J/K/Space/L/A/D and six
  buttons; turns each snapshot into a `RingView`), the 3D scene:
  `scene.ts` (renderer and cameras: first-person behind your head for a
  player, side-on for a spectator), `scene-model.ts` (`RingView`, what the
  scene draws, kept apart from the sim), `ring.ts` (the ring from
  primitives), `boxer.ts` (the tennis character with no arms plus boxing
  arms and gloves) and `boxer-pose.ts` (pure poses: `spec/boxing-pose.test.ts`),
  `box-camera.ts` (its camera panel; the pure maths is
  `box-pose.ts`), `hand-pick.ts` (a busy hand's jab goes to the free one), `practice.ts` + `practice-sim.ts` (in-page practice vs
  the bot), `boxing.css`; it reuses tennis's ready panel.
  Basketball (task 32, parts 1-2 so far) is `shared/games/basketball/`:
  `sim.ts` (spots, turns, the shot clock and late-shot grace, the flight
  against the rim and board, `makeWindow`, scoring, sudden death,
  unlimited; `BasketballSnapshot` is what a view draws), `bot.ts` (aims
  inside `makeWindow` plus noise), `index.ts` (adapter, closed `asInput`).
  `server/rewind.ts` `lateShotTicks` turns a seat's round trip into its grace.
  Its camera (part 3): `client/input/camera/shoot-pose.ts` (pure: ready,
  aim, the push, the aim lock; `spec/basketball-shoot-pose.test.ts`) and
  `client/games/basketball/shoot-camera.ts` (its panel: setup steps, the
  ready glow, the `?debug` readout and 1-8 recorder).
  Its client is `client/games/basketball/`: `view.ts` (HUD, shot clock,
  ready cue, floor arrow, power bar against `makeWindow`, the call, end
  card; ←/→ or the mouse aim, hold Space, the court or Shoot; camera behind
  the shooter for a player, side-on for a spectator), `calls.ts` (pure:
  the call with the stacking swish, "Too soft"/"Just right"/"Too hard", the
  spot line, the held bar: `spec/basketball-calls.test.ts`), `court.ts`
  (the city court from primitives; bleachers seated with tennis's
  `standSeats`/`seatCrowd`; seat 1's blue stand on the left, each side
  cheering or going aww for its shooter; it calls `city.ts`),
  `city.ts` (the city round the court, user 2026-11-08: buildings, shops,
  graffiti, roads, lamps, cars, a skyline; four merged meshes, light baked
  with track's `bake.ts`; the canvas's `data-calls` is the frame's draw
  calls, held to 60 by `e2e/basketball.e2e.ts`), `shooter.ts` (the tennis
  character with arms holding the ball, one shot; `shotPose` pure),
  `sound.ts` (its cues, task 19), `tie-vote.ts` (the level-score
  pop-up: Draw or Continue, D/C, sends `tie`; a spectator sees both
  choices: `spec/basketball-tie-vote.test.ts`), `shoot-camera.ts` (its camera,
  task 32 part 3), `practice.ts` + `practice-sim.ts` (in-page practice:
  "Just me" by default, alone with no shot clock, a spot or Cycle, makes /
  shots and streak; or vs the bot, task 38), `basketball.css`; it reuses
  tennis's ready panel. `client/games/practice-panel.ts` + `.css` is the
  small Just me / vs Bot panel basketball, bowling and track share (task 38).
  Bowling (task 29) is `shared/games/bowling/`: `sim.ts` (frames
  and ten-pin scoring `scoreCard`, turns, shot clock and grace, the tie
  vote, the 2D lane: ball path and bend, ball-pin and pin-pin circles,
  `simulateThrow`, `aimFor`, `speedZone` for the after-ball read),
  `bot.ts` (`solveThrow`: the pocket, or the most of the leftovers, plus
  noise), `index.ts` (adapter). Its client (part 2) is
  `client/games/bowling/`: `view.ts` (frame scoreboard, turn, clock, tie
  vote, end card, keys and buttons), `scene.ts` (cameras: behind the
  bowler, following the ball, the pin deck; side-on for a spectator),
  `alley.ts` (the hall from merged primitives, tennis's crowd via
  `crowdMeshes`), `calls.ts` (pure: the call, speed and curve read, the
  guide arrow, the meter: `spec/bowling-calls.test.ts`), `sound.ts`
  (its cues, task 19), `practice.ts` + `practice-sim.ts` (in-page practice: "Just
  me" by default, frames alone or "Reset pins each ball"; or vs the bot,
  task 38), `bowling.css`; it
  reuses tennis's ready panel. Its camera (part 3):
  `client/input/camera/bowl-pose.ts` (pure: aim across the picture, the
  release past the hip, speed, the curve window, the chest fallback;
  `spec/bowling-bowl-pose.test.ts`) and `client/games/bowling/bowl-camera.ts`
  (its panel: stand-back silhouette, aim arrow, a try swing, the `?debug`
  readout and the 1-9/0 recorder).
  `shared/look.ts`
  is the fixed lists for a player's look (tasks 18 and 33: clothes, colours,
  hair, face, headwear, eyewear) and `fromTask18`, the old shape's mapping.
  `shared/camera-settings.ts` is every camera setting's closed shape,
  defaults and `parseCameraSettings` (task 25).
- `server/` `index.ts` (http + ws + `/readme/`), `rooms.ts` (live rooms with
  the real clock and db), `room.ts` (one room: 60 Hz tick loop, seats,
  spectators, game), `lobby.ts` (pure room rules: phases, ready, format,
  countdown, the 30 s hold; clock injected), `db.ts` (SQLite on `/data`), `schema.ts` (versioned
  schema, migrations, match rows), `log.ts` (JSON log lines;
  players appear only as `who`, a per-run keyed hash; `/stats` in
  `index.ts` gives counts, loop timing and memory, task 8),
  task 17: `accounts.ts` (guests, accounts, passkeys, sessions, delete; pure
  over a db handle), `history.ts` (a player's recent matches and longest rally; task 37 removed Elo and the leaderboards that sat beside it), `auth.ts` (the `/api/*` account routes and passkey
  ceremonies), `guard.ts` (cookies, Origin check, challenges, rate limits),
  `names.ts` (pseudonyms and the chosen-name rules; shape shared in
  `shared/names.ts`).
  Task 34: `friends.ts` (pure over a db handle: Name#1234 lookup, requests,
  accept, decline, remove, friend links), `party.ts` (pure party rules:
  members, leader, modes, who plays next), `social.ts` (live status from
  open sockets, pushing friends lists and parties, party rooms; over
  injected deps for `spec/party-social.test.ts`); the tag helpers
  (`freeTag`, `findByTag`, `showTag`) are in `accounts.ts`.
  Task 39 (LAN mode, `docs/lan.md`): `index.ts` serves https when
  `TLS_CERT` and `TLS_KEY` are set; the local accounts, recovery codes and
  session renewal are in `accounts.ts`, their `/api/local/*` routes in
  `auth.ts` (only with `LAN_ACCOUNTS=1`, never on Fly).
  Rooms get their sim from the registry, so networking is game-agnostic.
- `client/` `audio/` (task 19, sound for every screen): `engine.ts` (the
  one AudioContext, made in the first gesture; mute, effects, music and
  volume buses; muted makes no nodes), `settings.ts` (saved in
  localStorage behind `loadAudioSettings`/`saveAudioSettings`, for task 25
  to move onto the account), `synth.ts` (noise bursts, tones, clap trains,
  bells, panning), `sounds.ts` (every game's sound recipe by name and the
  player that plays a list of cues), `crowd.ts` (pure: the crowd table,
  who cheers or awws by side, panned and weighted for this screen;
  `spec/crowd-reactions.test.ts`), `crowd-sound.ts` (the crowd's cheer,
  aww and applause: the one piece to swap for CC0 clips), `music.ts` (the
  home jazz loop, `jazzBar` pure), `toggle.ts` + `.css` (the sound button
  and panel in each HUD and beside the profile button), `index.ts`. Each
  game's `games/<name>/sound.ts` is a pure function of two snapshots to a
  list of cues (`spec/audio.test.ts`), and
  `games/tennis/crowd-motion.ts` moves any instanced crowd by side
  (`crowdPose` pure).   `ui/spectate.ts` + `.css` (task 24: "Copy watch link" and the
  watcher's badge, added to every game's HUD); task 34: `ui/social-state.ts`
  (the page's copy of the pushed friends list and party), `ui/friends.ts` +
  `.css` (the Friends button beside the profile button and its panel; the
  sheet style both panels share),
  `ui/party.ts` + `.css` (the party panel, opened from the home screen's
  Party button, the compact strip in a game's HUD, a friend's invite
  pop-up), `ui/dom.ts` (a text-safe element builder and the shared sheet
  dialog); `main.ts` mounts them; Vite app: `games/<name>/view.ts` (scene, HUD, input wiring),
  `games/tennis/score-bar.ts` (top score bar), task 16's point call:
  `point-call.ts` (pure: the call in tennis words, who won, how big, who
  reacts; task 19's crowd and sound use it), `call-banner.ts` + `.css`
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
  `games/tennis/character.ts` (Mii-style player and racket, dressed from
  the seat's look: clothes, hair, hats, glasses as primitives, the face
  drawn on the head; tasks 18 and 33; every game's character: a sport
  that draws its own limbs dresses them from `parts`' `sleeve`, `forearm`
  and `bottom`, as `spec/track-runner-look.test.ts` checks for track),
  `games/tennis/stroke.ts` (forehand/backhand keyframes, shot label text),
  `games/tennis/shot-fx.ts` (ball trail, bounce marks, shot arc),
  `games/tennis/trajectory-aid.ts` (pure: timing arcs, meter, strength ticks)
  with `aid.ts`/`aid-fx.ts`/`aid.css` drawing it (task 3; off, it hides
  the reticle and the shot messages too), `input/`
  (`keyboard.ts` for keys, pointer and buttons; `camera/` with `pose.ts` pure
  landmark maths, `camera.ts` webcam + lazy MediaPipe, `index.ts` setup
  panel), `net/socket.ts` (`Connection`), `net/link.ts` (`GameLink`), `ui/menu.ts` (home screen, task 36, from the mock the user approved
  on 2026-11-08: a full-screen SVG scene; a three-column top bar with the
  logo (overlapping rings) centred on the page, Friends, sound and the
  profile button on the right; three columns of equal height that follow
  the window's height (checked at 1920x1080, a 1366x657 laptop window and
  390x844, `e2e/home-layout.e2e.ts`): the six cards from the `SPORTS` list
  (2x3, icon in its own cell, arrow keys and one Tab stop), the selected
  sport's panel (a big looping SVG preview, name, line and input chip,
  "Create a room" big, then vs bot, Train/Practice and Party in one row,
  then the code box) and your party from `SocialState` (you alone, "Ready
  to play!", or up to ten in two rows of five with names, status dots, the
  leader's crown, an invite slot, "Change my look" opening the profile at
  its customise section); a phone stacks them, sports 3x2, the party a
  strip, Friends its icon and count, sound bottom right; the arrow as the
  mouse cursor; the footer keeps only the README link), `ui/home-art.ts`
  (each sport's card colour, flat icon, SMIL preview and scene field),
  `ui/home-3d.ts` (the cards' small spinning 3D icons: one shared
  renderer, loaded by `import()` only after the flat page and only where
  `ui/home-3d-gate.ts` allows, a window at least 761 wide, no reduced
  motion, WebGL; back to flat under 30 fps; a test browser stays flat
  unless `?icons3d`). The menu's static imports never reach Three.js:
  `spec/home-screen.test.ts`. `ui/profile-menu.ts` (the round
  profile button top right, its picture the head and shoulders of your own
  look from `look-preview.ts`, drawn once from the welcome's `look`, with
  your status dot; name beside it on desktop; its panel, a popover on desktop and a bottom sheet
  on a phone, holds the passkey sign in or create, sign out, the closed
  "Dev tools" with the demo accounts, and the ways to the profile dialog and
  the profile dialog: `e2e/home.e2e.ts`), `ui/brand.ts` (the five ring
  colours and every text/background pair, held to WCAG AA by
  `spec/brand.test.ts`; task 14), `ui/profile.ts` + `.css` (task 17's profile
  dialog, with task 33's look editor: live preview, Face/Hair/Clothes/Extras
  tabs of picture swatches, Save and Cancel; `ui/look-preview.ts` draws the
  look as SVG, whole or cropped, since the menu never loads Three.js; task
  25's "Camera settings" section with its Reset), `net/account.ts`
  (`/api/*` calls; the passkey prompt is loaded only when needed),
  `net/camera-settings.ts` (task 25: the one store every camera panel reads
  and saves; an account's from `/api/me`, a guest's in `localStorage`),
  `input/camera/power-calibration.ts` (task 25: pure soft/hard to a power
  range, for basketball's push and bowling's roll),
  Camera swings have two modes,
  "classic" (default) and "follow" (character copies the arm, hit at the
  hitting line), and two aim modes, "timing" (default) and "point"; see
  the camera setup notes in `tasks/done/`. Movement has two modes per seat,
  "auto" (default: the server walks you to the ball, `autoTargetX` in
  `sim.ts`) and "tilt" (lean to move); keys and buttons move you in either
  (task 2). Archery (task 22) is `games/archery/`: `view.ts` (range, sight,
  wind dial, target card, score; mouse, keys, hold button), `range.ts`
  (task 31: mown range, trees, hills, butts, shooting line, a small stand
  of tennis's instanced crowd that cheers a 10 or bullseye, flags that
  stream with the snapshot's wind; `cues.ts` is their pure maths),
  `archer.ts` + `archer-pose.ts` (pure; the tennis character holding the
  bow, posed from outside; another's turn and spectators see it over the
  shoulder: `spec/archery-look.test.ts`),
  `bow.ts` (pure: bow-hold landmarks to aim, draw, release),
  `bow-camera.ts` (its camera panel; loads the hand model too),
  `bow-model.ts` (the first-person bow), `practice.ts` + `practice-sim.ts`
  (in-page practice), `archery.css`; it reuses tennis's ready panel. Track
  (task 26) is `games/track/`: `view.ts` (side-on chase camera, race board
  with hurdles cleared, A/D, arrows and two tap buttons, Space and a Jump
  button in hurdles, a Sprint/Hurdles switch in practice), `lane.ts` (task
  31's stadium from tennis's `Painter`, `paintStand`, `fanMeshes` and `sky`;
  finish arch and clock; hurdles, the falling hurdle and the jump pose in
  their own functions at the end, task 27), `bake.ts` (bakes the light into
  the stadium's colours, so only runners are lit), `crowd.ts` (each stand's
  fans merged into one mesh, the cheer in the vertex shader), `runner.ts`
  (the tennis character with jointed legs and arms), `scene-model.ts`
  (pure: run pose, crowd excitement, clock: `spec/track-scene.test.ts`),
  `run-camera.ts` (its camera panel, opened first for a seat: mode, the
  optional stand-still, the jump, the `?debug` recorder), `practice.ts` + `practice-sim.ts` (in-page practice,
  either event: "Just me" by default, your lane alone with the sim's `solo`;
  or vs a pacer, task 38), `track.css`; the pure camera maths is
  `input/camera/run-pose.ts` (`RiseMeter`: each side from its recent low; steps, and `JumpTracker`:
  `spec/track-jump-pose.test.ts`); it reuses tennis's ready panel, which
  shows an event picker when given events.
- `scripts/local.ts` `pnpm local`: offline on this computer only
  (`docs/local.md`). `scripts/pose-models.ts` downloads the camera's models
  into `models/` once; `shared/pose-files.ts` says where the client loads the
  runtime and models from (this server's `/pose/` in local mode).
- `scripts/lan.ts` `pnpm lan` (task 39): makes the LAN certificate in
  `certs/` (self-signed, anonymous: `scripts/lan-cert.ts`) and starts the
  server in LAN mode on :8443.
  `server/lan-urls.ts` picks the address it prints (the default route, not a VM
  or WSL adapter).
- `spec/*.test.ts` vitest against the running app, plus the sim unit tests.
  `spec/temp.ts` (`openDb`, `cleanTemp`) closes test databases before removing
  their folders, which Windows needs.
- `e2e/*.e2e.ts` Playwright at both viewports, fake webcam.
