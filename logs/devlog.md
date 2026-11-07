# Dev log

Append-only record of decisions and key events, newest at the bottom. Copy
the format of the entries below (see CLAUDE.md, Docs).

## 2026-10-14 02:49 AEDT | decision | Crit 9 is the current crit, not crit 10

- **Situation:** Asked what this week's crit requires. First answer said crit 10
  because weeks were counted from 2026-07-27 without the teaching break.
- **Decision:** Treat this as crit 9 "All at once" (week 10): the final project
  goes real-time, plus one recorded multi-user decision. Lab is Wed 14:00
  (group yunlin), cutoff Wed 12:00.
- **Why:** The user's lab day matched crit 9, and the crit-groups API dates the
  week-9 holiday exception at 2026-10-06, which puts today in week 10.
- **Follow-up:** Real-time sync within ~1s with no reload; ADR for the
  multi-user behaviour; `reflections/crit-9.md`.

## 2026-10-14 02:49 AEDT | config | Repo default model set to Sonnet 5.5

- **Situation:** Sessions launched on Sonnet 5.
- **Decision:** Set `ANTHROPIC_MODEL` to `claude-sonnet-5-5` in
  `.claude/settings.local.json` (gitignored, so not committed).
- **Follow-up:** Takes effect on the next new session.

## 2026-10-14 03:23 AEDT | decision | Under lag, the hitter's view wins, within limits

- **Situation:** Crit 9 needs one recorded multi-user decision. Swings are
  judged when they reach the server, so lag (about 120 ms round trip) spends
  over half the 0.22 s hit window and on-time swings come back "too late".
  Nothing measures lag today.
- **Decision:** Judge each swing at the server tick the player's screen
  showed (rewind), checked against the server's own history. Capped at the
  player's measured round trip plus margin, never over 150 ms, never across a
  point change. Client plays the hit instantly and draws the confirmed return
  from where it is now. Written up as `docs/adr/001-who-wins-under-lag.md`.
- **Why:** Rejected server time only (lag silently eats the window, worst for
  the slower connection), a wider window (same slack for everyone, timing
  stops meaning anything) and drawing the ball ahead (jumps on every return).
  The cost lands on the opponent as a small late correction at the far end of
  their court.
- **Follow-up:** Build per `tasks/04-netcode-feel.md`: measure first (ping,
  `swing_resolve` logs, latency harness baseline), then rewind, then client.
  Spin shots for classic + timing parked until after.

## 2026-10-14 03:30 AEDT | event | ADR 001 is lag compensation, an industry standard (checked)

- **Situation:** Asked whether the rewind approach is used in real games.
  Answered from memory first, then checked each claim against sources.
- **Outcome:** Yes. The technique is called **lag compensation**: the server
  rewinds to what the player saw when the input was sent. Confirmed:
  - **Valve, Source engine:** Yahn Bernier, "Latency Compensating Methods in
    Client/Server In-game Protocol Design and Optimization", GDC 2001; uses
    Half-Life and Counter-Strike as examples. The Valve wiki defines lag
    compensation as rewinding time by the player's latency, and Source draws
    other players 100 ms in the past by default (`cl_interp 0.1`), as we plan
    for spectators.
  - **Overwatch (Blizzard):** "favor the shooter", in Tim Ford's own words
    (2016 dev update, later forum post on hit registration), with deliberate
    exceptions when the target uses an evasive ability.
  - **Rollback (GGPO, Tony Cannon, ~2006):** restore a saved state, apply the
    late input, resimulate to the present; needs a deterministic sim. Standard
    in fighting games (Street Fighter 6, Guilty Gear Strive). Our replay after
    an accepted late hit is this idea.
- **Corrections to what I said from memory:**
  - Source does cap the rewind (`sv_maxunlag`), but it keeps about 1 s of
    history and defaults to about 1 s, not 150 ms. Our 150 ms cap is far
    stricter than Source's.
  - "Favor the shooter" is from Ford's 2016 statements, not his GDC 2017
    netcode talk.
  - Valorant does rewind on the server (third-party summary), but Riot's stated
    goal is the opposite emphasis: a player holding a position should, on
    average, beat one peeking. Not a clean "favour the shooter" example.
- **Why it matters:** Answer for the pod arguing for server time only. This is
  how Source and Overwatch handle hits, adapted for a moving ball by replaying
  it forward, as rollback does. Known cost in shooters, "shot behind cover",
  is the same as ours: the opponent sees a late correction.
- **Sources:**
  [Bernier 2001](https://www.semanticscholar.org/paper/Latency-Compensating-Methods-in-Client-Server-and-Bernier/330071040ca858ca710a24a03915366fcd46f021),
  [Valve: Lag Compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation),
  [Valve: Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking),
  [GDC Vault: Overwatch Gameplay Architecture and Netcode](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and),
  [Kotaku on Overwatch tick rate](https://kotaku.com/overwatchs-low-tick-rate-can-be-a-problem-1778708854),
  [Riot: Peeking into VALORANT's Netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode),
  [SnapNet: Rollback](https://www.snapnet.dev/blog/netcode-architectures-part-2-rollback/).
- **Follow-up:** Add a "prior art" paragraph to ADR 001 citing Bernier and
  rollback.

## 2026-10-14 03:40 AEDT | milestone | Task 04 step 1: lag is now measured

- **Situation:** Rewind needs each player's real round trip (to cap it) and
  a record of how swings are judged. Neither existed.
- **Outcome:** Server pings every client every 2 s and keeps a smoothed round
  trip; client answers pings. `step()` now returns events, and the server logs
  `swing_resolve` (room, seat, name, tick, rewind, rtt, outcome) per swing and
  `rally` (winner, shots, reason) per point. The swinger also gets the ruling
  back as a `swing` message. No gameplay change.
- **Tests written:** `spec/sim.test.ts` "step events" (hit then point with
  reason and shot count; miss reason matches `missReason`; serve swing is
  "no ball"; serve counts as shot 1 and resets). `spec/rooms.test.ts`: round
  trip is timed (checked it fails with pong handling broken), a pong for an
  unknown ping is ignored, the swinger gets the server's ruling. `pnpm check`
  103/103.
- **Bug found:** `node --watch` does not see edits on the `/mnt/c` drive, so
  the first `pnpm check` ran the new tests against the old server and timed
  out. Fix: restart `dev:server` before checking; noted in CLAUDE.md.
- **Follow-up:** Step 2, latency harness and baseline hit rates.

## 2026-10-14 04:31 AEDT | milestone | Task 04 steps 2-3: rewind built, 64% -> 98% at 150 ms

- **Situation:** Step 1 measured lag; next was a baseline harness, then the
  server rewind from ADR 001.
- **Outcome:** Server judges a swing at the tick the client claims, capped by
  `rewindTicks` (`server/rewind.ts`): the measured round trip plus 50 ms,
  never over 9 ticks (150 ms), nothing without a pong. The tennis adapter
  keeps 12 ticks of state history and replays forward after an accepted
  rewound hit. Logs now show `allowed` and `rewind` per swing.
- **Tests written and results:** `spec/latency.test.ts` (400 swings spread
  across the on-screen window, network in ticks, about 1 s): hit rate rewind
  off / on = 100/100 at 0 ms, 89.5/100 at 50, 81.3/100 at 100, 64.5/97.8 at
  150, 56.3/89.5 at 200. Asserts >=95% at 150 ms with rewind, <85% without.
  `spec/sim.test.ts`: rewind hits a swing that is late now but was on time;
  refuses one that still misses and leaves the game untouched; never crosses
  a point; refuses past its history; a rewound game equals one fed the swing
  live (determinism); cap tests; pending-point tests. `spec/rooms.test.ts`:
  no rewind without measured lag; non-integer tick rejected; room allows
  exactly the claimed ticks when lag covers them. Each key test checked to
  fail with its guard removed. `pnpm check` 124/124 in 21 s.
- **Design change found by measuring:** first rewind run gave no improvement
  at all. Points past the receiver were scored before a lagged swing arrived,
  and "points are final" then refused the rewind. Fix (user chose option 1 of
  3): a ball past the receiver (unreturned, or bouncing out on their side) is
  decided at once but scored 9 ticks later; a rewound hit cancels it. Net and
  own-side balls still score at once. ADR rule 3 updated.
- **Mistakes:** spent about 25 minutes on a real-time WebSocket-proxy harness
  that ran minutes per attempt, printed nothing until done, hung on a
  counting bug, and dropped "no ball" rulings (exactly the misses lag
  causes). User flagged the run time; replaced it with the tick-model test.
  Also briefly imported tennis code into the game-agnostic room; moved the
  cap into `server/rewind.ts` instead.
- **Follow-up:** Step 4, client sends the tick on screen with each swing (real
  players get no rewind until then), then real round trips into PROCESS.md.

## 2026-10-14 04:39 AEDT | event | ADR 001 gets a plain-language example and a log-reading table

- **Situation:** User found "judged at the moment the player saw, limited to
  measured lag plus 50 ms" hard to follow, and asked whether the explanation
  was documented. It wasn't: the ADR had only the formal rules, the devlog
  only that `allowed` and `rewind` exist.
- **Outcome:** Added "In plain terms" (Alice, tick 500 vs 506, the limit, a
  faked claim) and "Reading the logs" (what each `allowed`/`rewind`/`outcome`
  combination means) near the top of ADR 001.
- **Why:** Crit 10 has the author narrate from server logs alone, so the log
  fields need a key that can be read aloud.

## 2026-10-14 04:57 AEDT | milestone | Task 04 step 4: real players now get rewind

- **Situation:** Server rewind was built but no browser sent a tick, so every
  real swing logged `allowed 0`.
- **Outcome:** The game view now runs the latest server state forward with
  the shared sim (at most 9 ticks ahead) and draws that, so bounces and the
  net are drawn exactly and a confirmed return appears already on its way.
  Every swing sends the tick on screen and plays a short Web Audio click at
  once. The screen state never decides anything; each server state replaces
  it. Spectator delay left out (optional).
- **Tests written:** e2e "a swing carries the tick on screen, and the server
  allows rewind for it": four swings in a real browser each carry a
  whole-number tick no more than 9 past the latest state, every ruling has a
  measured round trip, and at least one has `allowed > 0`. Checked it fails
  with the client not sending the tick. `pnpm check` 124/124; `pnpm e2e
  --workers=1` 20/20 at both viewports.
- **Bug investigated, not ours:** first `pnpm e2e` had 3 failures (camera path
  at both viewports, desktop trail). Ran the same tests against HEAD and the
  pre-session commit in a clean worktree on :8090: the trail test failed on
  step-1 code in parallel but passed 3/3 one at a time, and the whole suite
  passes with `--workers=1`. Cause: parallel software-rendered 1080p browsers
  starve the frame rate. Noted in CLAUDE.md: run e2e with `--workers=1` here.
- **Follow-up:** Push and deploy (ask first), then play two real sessions to
  record real round trips and `allowed`/`rewind` from the logs for PROCESS.md
  and `reflections/crit-9.md`.

## 2026-10-14 05:03 AEDT | bug | Privacy e2e broke when the client started sending pong

- **Situation:** Verified commit 85a5e38 against a clean worktree of HEAD
  (another session is editing `client/style.css` and `client/ui/menu.ts`).
  `pnpm check` 124/124, but the camera path e2e failed at both viewports.
- **Cause:** That test allowlists every message type the page may send (the
  "no video leaves the browser" check). Step 1 made the client answer pings
  with `pong`, which wasn't on the list. The other session had already added
  it in the shared tree, which is why my shared-tree e2e run passed.
- **Correction:** The 04:57 entry put all three earlier e2e failures down to
  parallel load. The trail one was load; the camera ones were this bug, and
  my parallel run hid that.
- **Fix:** Added `"pong"` to the allowlist (only that hunk; the other session's
  menu and style work left uncommitted). Clean HEAD camera path e2e now 2/2.
- **Lesson:** With another session in the tree, verify on clean HEAD before
  attributing failures to the environment (already in CLAUDE.md; I checked
  the trail test that way but not the camera one).

## 2026-10-14 05:32 AEDT | bug | Joiner's view cut off: their camera sat inside the end stand

- **Situation:** User reported that the player who joins by invite link sees
  half the page cut off.
- **Cause:** Reproduced with two browsers at both viewports. Page layout was
  fine (both canvases fill the screen); the 3D view was not. The arena was
  built for the seat-0 camera only: end stand, wall segment, trees, clouds
  and hills all at -z. The seat-1 camera sits at z -22, y 9, inside the end
  stand's footprint (z -17.6 to -24.2), so it looked down through the tiers.
  The bottom half of the joiner's screen was one flat green, hiding their
  own player.
- **Fix:** `buildStadium(scene, behindSeat1)` builds the arena (lights
  included) into a group and turns it 180 degrees for seat 1, so the joiner
  gets the host's exact view. Background and fog stay on the scene. Rejected:
  removing the end stand (both ends bare) and moving both cameras (re-tuning
  at two viewports).
- **Test written:** e2e "the player who joins by invite link sees the whole
  court, not a wall": host creates a room, a second browser opens the invite
  link, and the brightness spread over the joiner's near court must exceed
  60. Without the fix it is exactly 0 at both viewports (checked).
- **Verification:** shared-tree e2e had one desktop camera failure (a click
  timeout on "Stop camera"). On a clean worktree of HEAD plus only these
  files, `pnpm e2e --workers=1` passed 22/22, so the failure comes from the
  other session's uncommitted `client/style.css` and `client/ui/menu.ts`.
  Also: my first 8090 check ran against a stale server still holding the
  port; reran on a fresh one.

## 2026-10-14 06:33 AEDT | bug | Flaky rewind test failed CI on a slower runner

- **Situation:** CI run for 8aa0cdf failed `spec/rooms.test.ts` "rewinds a swing
  with measured lag" (expected `allowed` 3, got 4); the next push passed with
  no code change.
- **Cause:** The test claimed `s.tick - 3` and asserted `allowed` was exactly
  3. The server judges at its current tick, so a swing arriving one tick
  late gives `now - claimed` of 4. The assertion depended on wall-clock timing.
- **Fix:** Assert bounds instead of one value: `allowed` is at most
  `min(ruling.tick - claimed, 9)` and at least 3 (the 50 ms margin alone covers
  3 ticks), and `rewind` is at most `allowed`. Exact cap values are still
  pinned in `spec/sim.test.ts`.
- **Verification:** `pnpm check` 124/124 five times in a row; the one test 6/6
  with four busy CPU loops running. Not reproduced on CI itself.

## 2026-10-14 22:58 AEDT | decision | Gameplay rework planned: tennis rules, ready-up, Wii-style shots, training mode

- **Situation:** User wanted several changes: a ready step before multiplayer,
  proper tennis scoring, an unlimited mode, clearer forehand/backhand, a way to
  see where a shot will land, a how-to-play flow, easier camera control, and
  accounts. Discussed and planned only; no code changed.
- **Findings (from reading `pose.ts`, `camera/index.ts`, `sim.ts`):**
  - Camera setup's neutral capture only feeds point aim, and swing-level
    calibration duplicates thresholds already in shoulder-widths/second. Neither
    matters for classic swing with timing aim, so both leave the default flow.
  - Swing double-count: the classic detector ignores direction and has a 300 ms
    cooldown, so a wind-up plus forward swing can read as two. Not fixed now.
  - Level (light/medium/hard) sets speed, loft and height sensitivity, not aim.
    With `predictLanding` at hand-set contact heights, depth diverged by level
    off 1.0 m (hard: net at 0.5 m, long at 1.5 m). I overstated how much a
    player controls height; it comes from the incoming ball, and timing is the
    only input. Real contact heights are still to be measured.
  - I wrongly called the palm-to-camera grip unnatural; a backhand shows the back
    of the hand to the camera, which matches the code. The weakness is
    detection (0.3 threshold, previous grip kept on unclear reads).
- **Decisions:** classic swing and timing aim only (Wii Tennis feel); timing
  sets left-right, strength sets depth, height is automatic (`launch()` solves
  the arc); a wrong-side swing becomes a miss; a default auto-move mode with
  tilt kept as the alternative; grip is the single forehand/backhand signal
  (two signals that disagree feel worse); no lets; format chosen by the host
  before play, changing it clears ready flags; unlimited is unrated; guests get
  full scoring. Training mode is the camera's onboarding, with three arcs (the
  live one lit, the others greyed) and a timing meter.
- **Parked:** accounts and profiles, room codes (invite links already exist),
  quick-chat, and the double-swing fix.
- **Why:** each control now does one thing, so the landing aid can be honest
  and a new player can learn the mapping.
- **Output:** tasks 11-18 and the "Gameplay rework" section in
  `tasks/00-overview.md` (build order and which tasks can run as parallel
  agents). Open: three or two strength levels; target depths need playtesting.

## 2026-10-14 23:07 AEDT | milestone | Task 14: camera setup, grip and tilt reworked (no real-webcam playtest yet)

- **Situation:** Camera opening asked for a neutral capture and light/medium/hard
  swings; grip flickered; tilt was either too twitchy (9 degrees) or too much (16).
- **Change:** Default flow is now safety notice ("Got it", optional "don't show
  again" in localStorage inside try/catch), hand/mode/aim choice, then a
  "can we see you" check (shoulders, elbow and wrist required; hand shown).
  Neutral capture and swing levels moved behind a collapsed Advanced section.
  Defaults stay classic + timing. Grip is still the only forehand/backhand
  signal: `GripTracker` smooths the palm reading (alpha 0.4), threshold lowered
  0.3 to 0.15, locks during a swing, keeps the last grip on an unclear reading;
  a large FOREHAND/BACKHAND badge sits under the preview. Tilt: `AutoNeutral`
  takes the median of the first 1 s of tracking (no movement until then),
  `fullTilt` 16 to 11 degrees with a 1.4 power curve, and a gauge shows dead
  zone (3 degrees), edges and current lean.
- **Why:** Fewer steps before play; one clear grip rule; easier lean.
- **Guesses to playtest:** smoothing alpha 0.4, grip threshold 0.15, fullTilt 11,
  curve 1.4, 1 s auto-neutral window. None verified on a real webcam; the fake
  e2e webcam has no person in it.
- **Verification:** `pnpm check` 131/131, `pnpm e2e --workers=1` 26/26 (port 8091).
  New unit tests for smoothing, lock, unclear reading, auto-neutral, curve,
  visibility; e2e for the notice, "don't show again" and blocked storage.

## 2026-10-14 23:17 AEDT | decision | Shot rules: strength sets depth, height solved, wrong side is a miss (task 12)

- **Situation:** Depth depended on contact height (`loft + heightGain`), so a
  low ball hit hard went into the net and a high one long, though the player
  never controls height. A mismatched forehand/backhand was a weaker shot.
- **Measured first** (throwaway bot-vs-bot script, 200 seeds x 2 min, old
  code): medium returns are met at 0.84-1.11 m (median 0.91), serve returns at
  1.04-1.11 m. With every swing forced light, contact is 1.11-1.46 m; forced
  hard, 0.38-1.11 m (median 0.45) and 4871 of 5003 points end in the net.
  Old `predictLanding` at 0.5-1.5 m: medium depth drifts 3.7-8.1 m, hard is in
  the net at 0.6-0.8 m and out at 1.5 m.
- **Decision:** `STROKES` is `{ speed, depth }`; light 11 m/s to 4 m past the
  net, medium 14 m/s to 6 m, hard 18 m/s (backhand 16.5) to 8 m, all inside
  the 11 m half. `launch()` takes the flight time from speed and solves the
  upward speed for the tick integration (`moveBall`), lengthening the flight
  only if the ball would cross lower than net + 0.3 m. Sweep of 2250 cases
  (contact 0.1-2.6 m, anywhere in the hit window, all levels, kinds, aims):
  none in the net, none long; depth within 0.3 m of target. `MISMATCH` deleted;
  `missReason(s, seat, kind, hand)` returns `"wrong side"`, except within 0.3 m
  of the player's middle where either side works. Follow-mode lift now moves
  depth by up to 1 m. The client labels the miss "wrong side".
- **Why three levels, and why hard doesn't win everything:** with height gone,
  hard would be strictly best, so hard gets a wider aim spread (0.15 / 0.2 /
  0.26 per level). Over the whole timing window, timing-aimed shots go out 8%
  light, 15% medium, 29% hard; hard reaches the far baseline in 1.2 s against
  1.56 s medium and 1.98 s light. Three distinct trade-offs, so three levels.
  Bot-only rallies at forced hard still last (mean 15.7 shots), because the
  bot never aims at full width; only people take the risk.
- **Tests:** table test (0.5-1.5 m, every level, both kinds: clears the net,
  lands in, near its depth) failed 13 tests on the old sim (hard in the net or
  long; light/medium off depth) and passes now; wrong side for each kind and
  for a left hand; timing side mapping for every seat, hand and kind.
  `pnpm check` 132/132.
- **Open:** HUD showing the detected level (task 12), playtest of the depths,
  and task 14 must make the grip reliable now that a wrong grip is a miss.

## 2026-10-14 23:01 AEDT | milestone | Pure tennis scoring module (task 11, step 1)

- **Situation:** Task 11 needs real tennis scoring, but `sim.ts` is being
  changed by another session, so wiring it in now would conflict.
- **Outcome:** Added `shared/games/tennis/scoring.ts` (immutable `ScoreState`,
  `createScore`, `pointWon`, `fault`, `pointCalls`, `displayScore`) and
  `spec/scoring.test.ts` (32 table-driven tests: 0/15/30/40, deuce and
  advantage, games, sets, tiebreak serve order and win-by-2, oneSet and
  bestOfThree, serve alternation, double fault). Sim, protocol and client
  untouched.
- **Why:** A pure module with no I/O or randomness keeps the server
  authoritative and the logic testable. Wiring comes after the sim change lands.

## 2026-10-14 23:38 AEDT | bug | Playtest: backhand shows NO GRIP or swings repeatedly; distance, elbow and preview size

- **Situation:** First real-webcam playtest of task 14. User reported: the
  backhand sometimes reads as NO GRIP; a backhand keeps swinging; 1.5-2 m is too
  far; the setup asks for the elbow, which is uncomfortable; the camera preview
  looks small, as if cropped.
- **Cause (from the code):**
  - NO GRIP: `palmFacing` returned null unless the elbow was visible, and a
    close player's elbow is usually out of frame, so the badge fell to NO GRIP.
  - Repeated backhand swings: the classic detector ignored direction, so the
    wind-up (toward the off-hand side) and the recovery both counted as swings
    along with the real stroke. This is the double-count parked in task 18,
    now showing on the backhand, so the direction part is pulled forward.
  - Preview: the stream was requested at 640x480 (4:3), so many webcams crop a
    4:3 window out of a wide sensor, and the preview box was 240 px 4:3.
- **Fix:** grip falls back to the hand's own direction (wrist to the
  pinky/thumb midpoint) when the elbow isn't visible, and the setup check needs
  only shoulders and the racket wrist. A classic swing only fires when its
  sideways sweep matches the grip (forehand toward the off-hand side, backhand
  toward the racket side, at least 0.15 shoulder-widths). The stream is asked
  for 1280x720 and the preview is 16:9, 300 px wide. Safety text now says
  about 1 m.
- **Tests written:** grip reads with the elbow hidden; `swingMatchesGrip`
  table; a backhand wind-up then stroke gives exactly one shot (fails without
  the direction check, checked).
- **Open:** the 0.15 sweep and the elbow-free fallback are untested with a real
  webcam; the longer cooldown and the settle rule from task 18 are still
  parked. Whether a camera is really cropping needs checking on the user's
  device (the browser may still pick 4:3).

## 2026-10-15 00:15 AEDT | bug | Backhand still needed the elbow; camera view too narrow

- **Situation:** After the elbow fallback, the user said the backhand still
  needs their elbow to be seen, and that the webcam's width matters more than
  its height; asked for a better preview position and more width.
- **Cause (hypothesis, not confirmed on the user's camera):** a backhand takes
  the racket hand across the body and out to the side. At close range a narrow
  view cuts the arm off, and the pose model's confidence in the wrist and hand
  drops below the 0.5 cutoff that every landmark shared, so the hand was
  dropped along with the elbow. My earlier fallback only helped when the wrist
  and hand still cleared 0.5.
- **Fix:**
  - Wrist, thumb and pinky are trusted at 0.3 (shoulders stay at 0.5), a guess
    to playtest.
  - The stream asks for a 16:9 1280x720 view, and when the camera has a zoom
    control it is set to its widest (best effort; unsupported cameras keep
    their own view).
  - The preview, grip badge and lean gauge now sit in one dock whose height
    follows the real video, so the preview shows the whole frame, never a
    cropped one (it was a fixed 16:9 box with object-fit cover, which crops
    any other shape).
- **Test written:** a hand at 0.35-0.4 confidence still gives a wrist, a
  backhand grip and "seen" in the setup check; at 0.15 it is dropped. Fails at
  the old 0.5 cutoff (checked).
- **Open:** I can't tell from here what resolution or field of view the
  browser really gave the user's camera. Needs a real-webcam check, including
  whether a backhand now holds without the elbow in frame.

## 2026-10-15 00:23 AEDT | decision | Dropped the camera zoom-out

- **Situation:** The last change set the webcam's zoom to its minimum when the
  camera exposes one. User asked what happens if it zooms out a lot.
- **Outcome:** Removed it; the 16:9 request stays. A far zoom-out makes the
  player small, so the wrist and fingers get fewer pixels and the model tracks
  the hand worse; wide lenses also stretch the arm and skew the shoulder tilt;
  and on some cameras the setting can persist outside the game.
- **Why:** It couldn't be tested here, and the user's "seems better" can't be
  attributed to the zoom or to the 16:9 request. If the backhand gets worse
  after this, the zoom was helping and a capped version is the next try.

## 2026-10-15 00:24 AEDT | decision | Score bar and point announcement added to task 11

- **Situation:** User wants the score shown at the top of the screen, and a
  visible announcement when a point is scored.
- **Outcome:** Added a "Score display" section and a done-when item to
  tasks/11: a top score bar (points, games, sets, server) driven by the
  server's score state, with a short announcement and pulse on each point.
- **Why:** The server owns the score, so the bar only renders the snapshot.
  Reduced-motion and screen-reader behaviour are in the spec up front.

## 2026-10-15 00:27 AEDT | decision | Refreshed stale task statuses and merged tasks into four deliverables

- **Situation:** User asked about tasks 1-10. Their status lines were stale:
  01 said the README was a template (it is a 569-word draft), 10 said PROCESS.md
  was a template (crit 9 reflection is written, 594 words), 03 predated the
  playtest. 05's "not started" was right: grep finds no grace, forfeit or
  duplicate-token handling in the server.
- **Decision:** Grouped work into scoring and results (11 + 06), room lifecycle
  (05 + 13), aim aids and training (16 + 17) and crit docs (01 + 10, with 07 as
  a standing rule). Files are kept; the overview has the new table.
- **Why:** Each pair edits the same code or the same document, so one branch
  avoids the sim.ts-style conflicts seen on the first merge.

## 2026-10-15 00:27 AEDT | decision | Process evidence (task 10) is the user's own, not a deliverable

- **Situation:** I had grouped 01 + 10 as a "crit docs" deliverable for an agent.
- **Outcome:** User said process evidence is theirs. Removed it from the
  deliverables; agents leave `PROCESS.md` and the reflections alone and only
  append devlog entries. README (01) stays a deliverable.
- **Why:** The process mark rests on the user's own account of how they worked.

## 2026-10-15 00:31 AEDT | decision | Renumbered tasks into one flat build-order list

- **Situation:** Task numbers had stacked up (original 01-10, new 11-18, then
  "deliverables" like 11 + half of 06), which the user found confusing.
- **Outcome:** `tasks/` now has one list, numbered 1-11 in build order, for
  open work only: scoring in the game, auto-move, trajectory aid, room rules +
  ready-up + formats (the old 05 and 13 merged), training mode, stroke
  animation, leaderboard, stats, menu and accessibility, README, ship. Finished
  work is in `tasks/done/`, unnumbered; parked work and the user's own process
  evidence are unnumbered files. The overview has an old-to-new table, because
  this log and the done/ files still use the old numbers (the log is
  append-only, so it is not rewritten).
- **Why:** One numbering, with "waits on" per task, is easier to plan from than
  groups of groups. Files were moved with git mv to keep their history.

## 2026-10-15 00:36 AEDT | decision | Third arrival stays a spectator; winner-stays-on parked

- **Situation:** Deciding the multi-user rules for task 4. User likes the
  "winner stays on" idea but wants it later.
- **Outcome:** A third person is a spectator, as today, with no queue. Winner
  stays on is in parked.md. Still open for task 4: disconnect grace, second tab
  with the same token, and whether open rooms are listed.
- **Why:** The queue needs the ready-up room state machine first; spectating
  already works and is tested.

## 2026-10-15 00:37 AEDT | decision | Two tabs, one player is allowed (for testing)

- **Situation:** Task 4 asked what happens when the same token opens a second
  tab. User wants two tabs able to join one room for testing, flagged for later.
- **Outcome:** Allowed. Checked the code: `join()` in server/rooms.ts has no
  token comparison, and the client keeps its token in localStorage, so two tabs
  of one browser share it; demo accounts (demo-1, demo-2) give two identities.
  Added to tasks/04 as decided, with a spec test requested so it isn't removed
  by accident, and flagged in parked.md: ratings should ignore a match whose
  two seats share a token, and reconnect needs a rule for which tab wins.
- **Why:** Cheapest option, matches current behaviour, and the user needs it
  while testing alone.

## 2026-10-15 00:40 AEDT | decision | Disconnect and open-room rules for task 4

- **Decision:** On a mid-match disconnect the seat is held and the match pauses
  for 30 s; the same token reclaims it and the match resumes, else the room
  closes. No forfeit, no bot takeover. Rooms are reached by invite link or room
  code only, with no public list.
- **Why:** Smallest behaviour that is fair to both players and keeps strangers
  out. Forfeit and bot takeover were the costlier alternatives.
- **Left for task 4:** identity (pseudonym per token, renaming), and which tab
  reclaims a seat when one token has two tabs.

## 2026-10-15 01:23 AEDT | milestone | Real tennis scoring in the game (task 1)

- **Situation:** The scoring module was built and unit-tested but the sim
  still played first to 5 points, and the HUD showed "You 2 – 1 Bot".
- **Outcome:** The sim keeps a `ScoreState` in the snapshot: the server serves
  from `score.server`, a serve the receiver never touched that goes in the net,
  out or on the server's side is a fault (second serve, then double fault), a
  rally end calls `pointWon`, and `score.winner` ends the match. One set by
  default, best of three via an optional `format` on create (no chooser yet,
  task 4). Practice starts a new match instead of ending. `matches` moved to
  schema v2 (version table, migration step, test that opens a v1 database):
  sets won, games per set, format, practice and a `rated` flag. A two-row
  score bar replaces the old score text and announces each call for 2 s.
- **Why:** Rewind used "points changed" to refuse crossing a point, but a
  fault doesn't change points, so the sim now counts ended serves (`rally`)
  and rewind checks that. Practice-vs-bot is stored but never rated, so a
  rating can't be farmed off the bot. The bar first had a third row for the
  format and call; on a phone that pushed the HUD 9 px into the camera
  preview's spot, so those moved into a right-hand column.

## 2026-10-15 01:19 AEDT | milestone | Trajectory aid (task 3): three timing arcs, timing meter, strength readout

- **Situation:** Aiming by timing (the camera default) showed one straight
  arc, so players couldn't see that early goes cross-court and late down the
  line. The detected strength was never shown (left open in shot rules).
- **Outcome:** With the camera aiming by timing, three arcs (early, on time,
  late) show on the opponent's court; the arc for the ball's current third of
  the hit window is lit, the others grey. A meter along the bottom (early | on
  time | late) has a marker that moves with the ball. The lit arc carries
  light/medium/hard depth ticks: the last swing's level is picked, and during
  a classic camera swing a marker slides with the peak wrist speed so far.
  After your hit the real arc replaces them until it lands. "Detected: hard"
  (camera) or "Chosen: hard" (keys/buttons) sits beside the meter. An "Aid"
  button switches it all off (remembered); the reticle and game don't depend
  on it. Pure logic in `client/games/tennis/trajectory-aid.ts` with 19 unit
  tests, drawing in `aid.ts`/`aid-fx.ts`/`aid.css`; `e2e/aid.e2e.ts` at both
  viewports. No change to `sim.ts`, the protocol or the HUD.
- **Why:** Each arc is a copy of the shared sim stepped to that moment and hit
  with the same timing-aimed swing the server resolves, not a separate
  formula, so the test can compare it with a real hit for every seat, hand
  and kind. Turning off timing aim in the arc helper fails 11 of the tests.
  The arcs are worked out once per incoming shot, not per frame. The keyboard
  depth ticks first ran three `predictLanding` calls every frame and the
  frame-rate-sensitive trail e2e failed 2 of 3 runs on desktop (with another
  agent's browsers also running); computed only for an incoming ball and
  cached, it passed 6 of 6.

## 2026-10-15 01:22 AEDT | milestone | Forehand and backhand get their own arcs and a shot label (task 6)

- **Situation:** User said the backhand doesn't read on screen. In
  `character.ts` it was the forehand's sweep run backwards: same arm height,
  same racket face, straight arm, a mirrored body turn. The opponent's and
  bot's strokes started at 45% of the swing, where both arcs point the arm
  straight ahead, so a viewer saw nearly the same thing for either.
- **Outcome:** `client/games/tennis/stroke.ts` keyframes each stroke (wind-up,
  contact, finish) for arm, elbow, wrist, racket face, shoulder turn and off
  arm. Forehand: back low on the racket side, finish high over the other
  shoulder. Backhand: back by the far hip with the face turned over, finish out
  on the racket side with the off arm flung back. Measured on the rig, contact
  is +0.63 m vs -0.51 m from the player's middle. A `.shot-label` shows FOREHAND
  (yellow) or BACKHAND (blue) on every stroke, both seats and the bot, in the
  side stands on desktop and bottom left on a phone. A wrong-side miss turns it
  red, strikes the stroke through and says which side the ball was on. The
  pop-in and shake are off under reduced motion. Tests: `spec/stroke.test.ts`
  (rig measurements, label text), `e2e/stroke.e2e.ts` (both viewports: arcs
  projected through the game camera, label clear of the court's corners, the
  controls and `.cam-dock`, reduced motion).
- **Why:** A measured difference can't quietly go back to "only the side
  changes". The label sits beside the court rather than on it, because the
  score bar (task 1) takes the top and the timing meter (task 3) the bottom.
  The layout e2e "invite link" frame-count check fails on and off on this
  branch and on a clean build of main alike while other agents' browsers keep
  the load average at 15-22; it isn't caused by this change.

## 2026-10-15 02:19 AEDT | decision | Playtest: out balls and a short timing window queued as task 12

- **Situation:** User reported getting the point on a ball they hit out, the bot
  returning a ball and the user still getting the point, and the early / on
  time / late window going by too quickly.
- **Findings (probes against the real sim and bot, no code changed):** the bot
  volleys balls that are going out; a swing is accepted for about 5 ticks
  (80 ms) after an out ball lands, which cancels the pending out point; the
  hit window is 0.22 s either side of the baseline, so each third is about
  0.15 s. The dev server log doesn't record who hit last, so a specific rally
  couldn't be matched; the user's case is not confirmed to be either.
- **Also found:** strength sets flight speed (22 m / ball speed gives 1.98,
  1.57 and 1.22 s to the far baseline for light, medium and hard); depth only
  decides where it bounces and how high it arrives. With full-speed auto-move
  nothing beats the opponent, so auto-move is being made slower (about 60% of
  5 m/s, to be tuned by measurement) and the agent was told.
- **Decision:** queued as tasks/12-rally-fixes.md, to start after task 2 lands,
  because auto-move changes who can reach what in the same rallies.
- **Also noted:** the Vite dev server has the same stale-file problem on /mnt/c
  as node --watch; after any merge restart both dev processes.

## 2026-10-15 02:46 AEDT | milestone | Auto-move (task 2): the server walks you to the ball, slower than you can run

- **Situation:** With the camera, moving meant leaning while also timing a
  swing, which is two skills at once. Task 2: a movement mode, the default,
  where the server moves you and you only swing. Lean stays as the other mode.
- **Outcome:** Each seat has a mode, `auto` or `tilt`, sent as
  `{ t: "mode" }` (anything else is a bad message) and fed to the sim as an
  input, so it stays in the input stream and rewind replays it. In auto
  `autoTargetX` aims 0.6 m (`AUTO_OFFSET`) short of the predicted contact, on
  the side the ball is heading to, so it comes on a clear forehand or backhand
  side (past `EITHER_SIDE`, inside reach). The wrong kind still misses. The
  bot moves by the same rule. Auto walks at `AUTO_SPEED` = 0.7 x 5 m/s.
  Measured from the far sideline on in-landing shots, full aim is reached
  100% light, 50% medium, 0% hard; straight shots 100% at every level.
  Bot-vs-bot mean rally is 3.91 (3.92 before). Camera: "Move: auto / Move:
  lean" under the preview, remembered in localStorage; in auto no lean
  targets are sent and the lean gauge is dimmed. Tests:
  `spec/auto-move.test.ts` (5 sim mutations each caught),
  `spec/rooms.test.ts` "movement mode" (all 3 fail on the old server),
  `e2e/auto-move.e2e.ts` at both viewports.
- **Why:** The user decided auto must be slower than manual movement. At full
  speed it reached 100/100/33% of full-aim shots, so strength would stop
  mattering. 0.6 (80/25/0) was closer to "light almost never beats it" but
  cut the bot's rallies to 3.76; 0.7 keeps them in the old band and gives
  medium a true 50/50. Keyboard/touch: every seat starts in auto, and a move
  key takes over at full speed until the next ball comes at you. Keyboard
  players get the help by default and can still go anywhere, and no
  keyboard-only toggle is needed. The user may overrule this.

## 2026-10-15 03:28 AEDT | bug | Out ball volleyed by the bot is not called out

- **Situation:** User: when the trajectory pointed out and they hit that swing,
  the ball went out, but the bot still hit it and the point wasn't counted as
  out. This matches the earlier probe: the bot swings at a ball in the air
  before it lands (a legal volley in the sim), and an out call only happens
  when the ball lands, so a volley skips it.
- **Decision:** a shot that will land out is dead from the moment it is hit,
  not only after it lands: the receiver can't hit it, the bot doesn't try, and
  the point is called when it lands. Written into tasks/12. This changes the
  rules for people too (no volleying a ball that is going out), which is what
  the user described wanting.
- **Why:** The out call should follow the shot, not whether the receiver
  happened to swing. Deciding at launch is deterministic and keeps rewind
  (ADR 001) safe because the ball's own history decides.

## 2026-10-15 03:34 AEDT | decision | Correction: a ball going out can be hit or left (not dead from launch)

- **Situation:** I had written "a shot that will land out is dead from the
  moment it is hit" into task 12 and told the user it was what they described.
  The user replied that they want to be able to hit something going out, or
  choose not to. My rule was an overreach on their report, which was about the
  bot hitting an out ball and it not being counted as out.
- **Decision:** the ball stays live in the air, for people and the bot alike.
  The bot decides not to swing at a ball it predicts will land out; a person may
  hit it or leave it, and if left it is out when it lands (their point). A ball
  that has landed out is dead, which closes the 80 ms window after the bounce.
- **Why:** it matches real tennis, keeps the choice with the player, and still
  fixes both reports: the bot no longer rescues out balls, and a swing can't
  cancel an out call after the bounce. Written into tasks/12; the agent building
  it was told to drop the dead-from-launch design.

## 2026-10-15 04:01 AEDT | decision | Wii-style home screen requested (task 13)

- **Situation:** User asked for a new home screen inspired by Wii Sports /
  Resort: "Weblympics" title, a thumbnail below it, sport buttons below that,
  on theme, listing every sport (only Tennis exists). Reference:
  design/reference/WiiSports-Menu.webp (300x237).
- **Decision:** Built as task 13, written to tasks/13-home-screen.md and given to
  an Opus agent. Took the look (pale sky-blue background, glossy pill buttons, a
  framed preview that follows the focused sport, a pointer marker) but not the
  reference's layout, since the user specified title, thumbnail, buttons. No
  Nintendo assets or text; all CSS/SVG, no Three.js on the menu. Tennis stays
  the only playable sport (CLAUDE.md); disabled "coming soon" buttons for other
  sports are optional and flagged for the user.
- **Why:** The menu is the first thing a player sees, and a list-driven sport
  menu makes adding a second game one entry once the core is solid.

## 2026-10-15 04:01 AEDT | bug | Dev server shows old code on this drive; cause not yet found

- **Situation:** After merges the user twice saw the old client (a score line
  reading "undefined – undefined", then no auto-move toggle) on the dev server.
- **Findings:** (1) `node --watch` and Vite's file watcher both miss edits on
  /mnt/c, so after a merge or branch switch both need a manual restart; the first
  stale view was Vite serving a cached view.ts, fixed by restarting it. (2) Port
  8080 serves the built bundle in dist/client, which was last built at
  00:15 on 15 Oct, so it stays old until `pnpm build`; 5173 is the one to use.
  (3) On the second report I confirmed from WSL and from Windows (PowerShell) that
  127.0.0.1:5173 and localhost:5173 both serve the new files, that
  wslrelay.exe is the Windows-side listener (expected), that there is no service
  worker, and that Vite sends Cache-Control: no-cache; only [::1] fails.
- **Status:** UNRESOLVED. A headless browser sees the new page, the user's
  browser still reportedly does not. Next: which browser, and does 127.0.0.1
  differ from localhost, a private window, hard refresh.
- **Why this matters:** a "fixed" feature that the user can't see wastes
  playtests. Worth a one-command restart script and a rule in CLAUDE.md.

## 2026-10-15 04:01 AEDT | milestone | Merge verification for tasks 1, 3, 6 and 2

- **Situation:** Four agent branches merged into main by me, each on a fresh
  integration branch with a clean build.
- **Outcome:** Tasks 1, 3 and 6 merged at c0d726b: pnpm check 227/227, pnpm e2e
  --workers=1 48/48. Task 2 merged at 47d2d7e: check 243/243, e2e 54/54. Both
  verified by me, not only by the agents' own reports.
- **Problems the merge caught:** task 1 changed createState's second argument
  from a score limit to an options object, so task 3's tests (written against
  the old signature) failed typecheck only on the merged tree; fixed by passing
  { endless: true }. Task 1's first e2e run failed the trail test under machine
  load (load average 10-13) and passed 3 of 3 alone and in the full run on a
  quiet machine, so it was load, not the code; that test is timing-sensitive
  and is on the test-gaps list.
- **Why:** Each branch was green alone; only the merged tree shows cross-branch
  breaks.

## 2026-10-15 04:01 AEDT | decision | Reaction time comes from ball speed, not depth

- **Situation:** User asked whether the speed and depth a ball is delivered at
  change the reaction time they have, in light of auto-move.
- **Measured (real sim, hit from the baseline):** flight to the far baseline is
  1.98 s light (11 m/s), 1.57 s medium (14 m/s), 1.22 s hard (18 m/s): about
  22 m / forward speed. The ball keeps 100% of its forward speed after the
  bounce and contact height doesn't change the time, so depth (4, 6, 8.2 m) only
  decides where it bounces. My first "sideways run" figure for hard was wrong
  (a full-aim hard shot lands out, so the probe stopped early); light needs
  about 1.7 m/s and medium 2.8 m/s of sideways running.
- **Decision:** auto-move was made slower than manual (the agent measured
  AUTO_SPEED options and chose 0.7, 3.5 m/s; manual stays 5 m/s) so hard wide
  shots still beat it. Making depth affect time would need a post-bounce speed
  change; not done, speed already does the job.
- **Why:** with full-speed auto-move nothing could beat the opponent, so strength
  would have stopped mattering.

## 2026-10-15 04:01 AEDT | event | Which model each agent ran on

- **Situation:** User asked whether the agents ran on Opus 5.5.
- **Outcome:** Read from each agent's transcript (the model field of every
  request). First wave: scoring module and camera setup ran on claude-sonnet-5-5;
  shot rules on claude-opus-5-5. Everything launched since (tasks 1, 3, 6, 2,
  12, 13) is claude-opus-5-5 via the `opus` alias. The main session itself
  (this log, merges, task files) is Sonnet 5.5.
- **Why:** The user wanted Opus for the building; recording it so the process
  evidence doesn't have to guess.

## 2026-10-15 04:03 AEDT | decision | Devlog rule: log as it happens, and say who decided

- **Decided by:** user (asked for the rule and for the user/Claude split to be
  visible); wording by Claude.
- **Situation:** The user checked whether things were being logged. Several
  decisions, the merge checks and the dev-server problem had not been written
  up until asked, and the log didn't say who made each call.
- **Outcome:** CLAUDE.md's Docs section now requires entries when things
  happen, entries for playtest findings, merges (with the checks run) and
  unresolved problems, and a Decided by line (user, Claude or agent). Tuning
  numbers count as Claude or agent guesses until the user playtests them, and
  any visible choice by Claude or an agent is told to the user at the time.
  Older entries have no Decided by line; the log is append-only, so they are
  not rewritten.
- **Why:** The process mark rests on an honest account of who decided what, and
  the user needs to know which choices are theirs to overrule.

## 2026-10-15 04:04 AEDT | milestone | Wii-style home screen (task 13)

- **Situation:** The user asked for a new home screen in the spirit of a
  console sports menu: "Weblympics" title, a thumbnail below it, the sports as
  on-theme buttons below that. The old menu was one dark-edged card on a sky.
- **Decision:** `client/ui/menu.ts` now renders title, a framed 16:9 preview,
  then glossy pill buttons from a `SPORTS` list (id, name, playable, blurb,
  icon, thumbnail renderer), then the selected sport's options (practice /
  create / join), then sign-in and the README link. Previews are inline SVG
  (a low-poly court with stands, stripes, net and ball for tennis); the old
  CSS Mii sprites now run inside the tennis preview (container units) and
  stay off on phones and under reduced motion. A drawn arrow marks the
  focused/hovered pill. Tennis is the only playable sport; Baseball, Bowling,
  Golf and Boxing are aria-disabled "coming soon" pills that only swap the
  preview, are out of the Tab order and never send anything. Arrow keys move
  between sports (roving tabindex), Enter on Tennis jumps to its options.
- **Outcome:** Fits 1920x1080 and 390x844 with no scroll at all; contrast is
  at least 4.9:1 for all text on the pale background (WCAG AA). New `e2e/home.e2e.ts`
  (order, keyboard, practice message unchanged, placeholders inert, every
  action present); full e2e 64/64 and `pnpm check` green. Screenshots in
  `docs/home-desktop.png` and `docs/home-mobile.png`.
- **Why:** The look comes from the reference, but everything is drawn in code
  (no Nintendo assets or text, no image files) and Three.js stays lazy. The
  placeholders show the "many sports" shape the user described without adding
  a second game; deleting four list entries removes them.

## 2026-10-15 04:05 AEDT | milestone | Rally fixes (task 12): out ball dead once it lands, bot leaves balls going out, 0.32 s window

- **Situation:** Three playtest reports: the bot returned a ball going out and
  no "out" was called; "I hit it out and still got the point"; and early / on
  time / late went by too quickly (0.22 s window, thirds of about 0.15 s).
- **Outcome:** A ball in the air stays live, even one going out (the user's
  ruling). Once it has landed out, or bounced twice, it is dead: `missReason`
  says `"out"` / `"two bounces"`, so a swing can no longer cancel the out call
  in the ~80 ms after the bounce. The bot runs the ball on with `moveBall`
  (`willLandIn`) and doesn't swing at one that will land out. `HIT_WINDOW_S`
  is 0.32 s (thirds about 0.21 s). A new sweep (`spec/rally-fixes.test.ts`,
  40 seeded matches, a random swinger vs the bot, its own referee with a copy
  of the physics) checks every point against where the ball landed and who
  hit it last. On the old code it found 43 hits on balls that had already
  landed out. With the wider window it then found a second bug: a ball past
  the end was decided at 3 m past *either* baseline, so a late hit from deep
  behind your own baseline was called "out" against you on the same tick.
  Now only the receiver's end, and only once past their window. Without the
  window part, a lagged swing in the late third arrived after the point was
  scored and rewind refused it (85% hits at 150 ms).
  Measured before -> after: bot-vs-bot mean rally 3.914 -> 3.918; auto reach
  from the far sideline 100/50/0% full aim and 100% straight, both; an
  auto-moved receiver is in reach with the right side at every tick of all
  three thirds, both; timing-aimed shots landing out 2/2/14% -> 0/2/15%; lag
  hit rate at 150 ms 100% with rewind, 76% without. `pnpm check` 258 tests
  and `pnpm e2e --workers=1` 54 passed, both exit 0.
- **Why:** The rally length barely moved because every bot-vs-bot point ends
  wide, and a wide ball lands out beside the court before the bot's swing
  zone, so the let-go rule never fires between bots; it shows up against
  people who hit long. The dead flag lives in the state per tick, so rewind
  stays deterministic and ADR 001's promise holds for balls still in the
  air. The latency and rewind tests had been using balls that landed about
  3 m long; they now use balls that land in, which is what they meant.

## 2026-10-15 04:24 AEDT | milestone | Merged tasks 12 and 13 into main (9e63f48)

- **Decided by:** Claude (merge and resolution); agents (the choices listed under Open); user (the out-ball rule, the home screen layout).
- **Situation:** The rally-fixes agent (task 12) and the home-screen agent (task 13) both finished; each had passed its own checks.
- **Outcome:** Merged both on a fresh integration branch. Conflicts were only in logs/devlog.md and the task overview table (both sides marked their own row done), resolved by keeping both. Verified on the combined tree: typecheck exit 0, pnpm check 258/258 exit 0, pnpm e2e --workers=1 64/64 exit 0, machine load 2.7 before and 6.4 after. Fast-forwarded main, restarted dev server and Vite by PID (a pattern kill took my shell down the first time) and confirmed both serve the new code. Both agents ran on claude-opus-5-5 (transcripts); PROCESS.md untouched.
- **Open:**
  - The three timing arcs are not shown for a ball that lands out before it reaches the player (no valid timing moment).
  - The bot's let-go rule never fires in bot-vs-bot play (every point ends wide), so only a targeted test proves it; needs the user's playtest, as does the 0.32 s window.
  - Agent choice, not yet confirmed: four disabled placeholder sports (Baseball, Bowling, Golf, Boxing) on the home screen.
  - Agent choice, not yet confirmed: keyboard and touch players start in auto-move.
  - The user's browser still reportedly shows old code on 5173 (see the dev-server entry); unresolved.
- **Why:** Each branch was green alone; only the merged tree shows cross-branch breaks, as the task 1 and 3 merge did.

## 2026-10-15 05:03 AEDT | decision | Keyboard and touch aim by timing unless an arrow is held; placeholder sports; keyboard starts in auto-move

- **Decided by:** user (option C, the placeholder sports and the keyboard auto-move answer); Claude (the pointer no longer aims, and the rule that touch buttons use timing).
- **Situation:** The user noticed that with the keyboard the highlighted trajectory didn't matter and the shot fell back to the middle. Cause: a keyboard swing sent only dirX from the arrow keys or pointer, never timingAim, and the three-arc aid only draws for timingAim, which was camera-only.
- **Outcome:** Option C: keyboard, mouse and touch swings aim by timing like the camera, so the lit arc is the shot; holding an arrow key while swinging aims by hand (timingAim false) and the single reticle returns. The pointer position no longer aims (Claude's choice, to make "no arrow = timing" unambiguous; the on-screen buttons use timing). Keyboard and touch players start in auto-move (user: yes). Home screen sports are now Tennis, Bowling, Archery and two ?? tiles (user: keep Bowling, add Archery, the rest ??; the two ?? is Claude's reading of "the rest"), the ?? tiles don't say Coming soon.
- **Tests:** keyboard e2e checks timingAim is false with an arrow held and true otherwise; the reticle and trail e2e now hold an arrow, since by default the three arcs replace the reticle; all three updated because the design changed, not because of a bug.

## 2026-10-15 05:03 AEDT | bug | The three arcs vanished for a ball that lands out

- **Decided by:** Claude (the fix); user (the rule that a ball going out can be hit).
- **Situation:** User asked why there is no trajectory for an out ball. timingArcs returned null if any of its nine simulated shots (three moments x three strengths) failed, and for a ball that lands out the later moments fail because the ball is dead after the bounce.
- **Finding (probe, real sim):** a hard wide shot landed out at about t62 and went dead at window position -0.5, so early is a legal volley and on-time and late are not.
- **Fix:** timingArcs returns the arcs that can still be hit and null for the moments after the ball goes dead; nothing is shown only if no moment can be hit. Tests: the out-ball case keeps early and drops late; a ball that lands in still gets all three; no arcs once dead. The out-ball test fails with the old give-up behaviour (checked).

## 2026-10-15 05:03 AEDT | bug | Flaky e2e "a swing carries the tick": 3 of 8 runs failed on clean main

- **Decided by:** Claude (the diagnosis and the test change).
- **Situation:** The test failed once on mobile in a full run and passed on rerun. Run 8 times on clean main with my changes stashed, it failed 3 of 8, so it was not my change and not machine load (load 2.5).
- **Cause:** It asserted at least one swing was allowed to rewind (allowed > 0). allowed is min(ticks behind, lag allowance, 9); on a loopback the screen can be exactly in step with the server, so all four swings can have allowed 0. A timing race in the test, not a game bug.
- **Fix:** assert the invariant that always holds (an integer from 0 to 9); rewind itself is covered deterministically in spec/latency.test.ts and spec/sim.test.ts. 8 of 8 passed after.
- **Verification:** pnpm check 261/261 and pnpm e2e --workers=1 66/66, both exit 0.

## 2026-10-15 05:03 AEDT | decision | Tasks 14, 15 and 16 queued; tasks 4 and 5 started

- **Decided by:** user (the features and that 4 and 5 start in their own agents); Claude (the task split and the dependencies).
- **Situation:** The user asked for: Olympic colours and a fun logo; a small recorded bot-vs-bot rally as the tennis thumbnail; a dedicated page when a sport is selected; webcam as the default when a game starts; a bold point-scored call at the top ("15 love"), not covering the court, with a frustrated scribble over the loser and a fitting effect for the winner, shown locally.
- **Outcome:** Written as tasks/14 (colours and logo), 15 (game pages, recorded thumbnail, webcam by default, waits on 4 and 5) and 16 (point banner and effects). Effects are driven from the server's score snapshot on each client, so no new network messages and the server stays the score's only owner (the user suggested local; Claude agrees it is the better approach). The logo must not copy the official Olympic rings. Tasks 4 and 5 started on Opus agents in separate worktrees; the agents record their own decisions as "Decided by: agent".
- **Why:** 4 touches rooms.ts and the protocol and 5 is client-side with a local sim, so they don't share files; the new tasks wait because 14 and 15 edit the home screen that 4's panel and 5's Train button also touch.

## 2026-10-15 05:35 AEDT | decision | Task 4: identity, which tab reclaims, and the room state machine's shape

- **Decided by:** agent (everything below; the user's rules for task 4 are taken as given: spectator only, two tabs allowed, 30 s hold then close, invite or code only, the phases, the formats, unlimited, camera never required).
- **Situation:** Task 4 left identity, the two-tab reclaim rule and the panel wording open, and several smaller rules had to be picked to build the phases.
- **Outcome:**
  - Identity: one pseudonym per token, made by the server from its word list ("Swift Otter 42"). Not renameable for now: no free text means nothing to moderate and no way to type someone else's name, "Bot" or "Demo One". If both seats show the same name (one token on two tabs), the second seat is shown as "<name> (2)".
  - Which tab reclaims: a held seat goes to the next connection with that token that joins the room. A tab already in the room (in the other seat, or watching) is never moved into it.
  - The state machine is a pure module (`server/lobby.ts`, injected clock and grace) so the 30 s rules are tested without a 30 s wait; `rooms.ts` drives it.
  - Before the match a disconnect frees the seat (un-readying it); only a match in progress holds a seat. A returning player gets the 3 s countdown again before play resumes, so a serve isn't already on them.
  - Pressing Leave mid-match ends the match at once with no result (nobody waits 30 s for someone who chose to go); the room stays open, waiting for a new opponent. Only an expired hold closes the room, as the user decided.
  - Host: whoever took the first seat; if they leave before the match the other seated player becomes host. Format changes only before the match; picking the same format again changes nothing.
  - After a finished match the room goes back to the ready check (rematch with the same or a new format).
  - Practice stays instant: the bot and the player are both ready, no countdown, no panel.
  - Ratings: a match where both seats share a token, or any unlimited match, is stored with rated = 0.
- **Why:** Each keeps the user's rules exactly and adds the least new surface; every choice is flagged in the report so the user can overrule it.

## 2026-10-15 06:35 AEDT | decision | Task 4 smaller choices: schema v3, wording, the panel's layout

- **Decided by:** agent.
- **Situation:** Building task 4 surfaced choices the brief didn't cover.
- **Outcome:**
  - Schema v3: `matches.winner` must be NULL for unlimited, and SQLite can't drop a NOT NULL in place, so v3 rebuilds the table (all rows and their `rated` kept) and adds `best_rally`. Test opens a v2 database.
  - Panel wording: "Waiting for an opponent" / "Ready up" / "Starting in 3…"; "I'm ready" / "Not ready"; "Camera off (optional)" / "Camera on, can't see you yet" / "Camera OK". HUD: "Paused: waiting for <name> to reconnect (27 s)" and "Back. Resuming in 3…".
  - The safety notice in the panel is collapsed under "Before you swing" so the Ready button is on the first screen at 390x844; the full notice still shows before the camera starts.
  - Before the match the timing aid, stroke line and shot label are hidden (there is no ball), so nothing sits under the panel. The panel places itself below the HUD and, on a phone, below the camera preview, measured at run time because the preview's height depends on the camera.
  - The panel is in its own files (`ready-panel.ts`, `ready-panel.css`); `client/ui/menu.ts` and the home screen styles are untouched, and the home screen has no format chooser.
- **Why:** Smallest change that keeps the user's rules, fits both viewports and leaves the queued home-screen work alone.

## 2026-10-15 06:35 AEDT | milestone | Task 4 built: ready-up, formats, 30 s seat hold, unlimited

- **Decided by:** agent (the build); user (the rules it implements).
- **Situation:** Task 4 started on an Opus agent in its own worktree (branch worktree-agent-a8daf84a0a540eb29).
- **Outcome:** `server/lobby.ts` (pure rules), `server/room.ts` (one room, no db import), `server/rooms.ts` (real clock, db, log). Protocol `ready`, `format`, `lobby`, `closed`. Ready panel and HUD states on the client. Tests written first; against a server built from the previous HEAD, all 8 new WebSocket tests and the 4 new db tests failed, and the lobby and room-rules suites can't import. `pnpm check` 298/298 exit 0; `pnpm e2e --workers=1` 72/72 exit 0 (load 1.2 before, 12.5 after: another session was busy). One existing e2e (the seat-1 shot label) assumed two-player play starts at once; it now readies up first, a design change, not a bug.
- **Open:** the two-session playtest and next-day pickup (needs the user); confirm the agent choices in tasks/04.
- **Why:** Crit 10 needs the multi-user rules written, built and tested.

## 2026-10-15 06:48 AEDT | milestone | Merged task 4 (room rules, ready-up, formats) into main

- **Decided by:** Claude (merge and verification); agent (the twelve choices below); user (the rules in the brief).
- **Situation:** The task 4 agent finished: server/lobby.ts (pure room state machine with an injected clock), server/room.ts, ready panel, schema v3 (matches.winner nullable, best_rally), README "Playing together", room rules in CLAUDE.md.
- **Outcome:** main fast-forwarded (no conflicts; main had not moved). Verified on a fresh build by me: typecheck exit 0, pnpm check 298/298 exit 0, pnpm e2e --workers=1 72/72 exit 0, with machine load 11 to 19 from another agent's browsers and no failures. The schema v3 migration was run by me on a temporary copy of the real dev database: version 2 to 3, all 28 matches kept and identical, the one rated match still rated, 1,176 players intact; the real file was not touched. The agent ran on claude-opus-5-5 (transcript). PROCESS.md and menu.ts untouched.
- **Agent choices, not yet confirmed by the user:** names are server-made and can't be changed; a held seat goes to the next tab with that token that joins; Leave mid-match ends the match with no result and keeps the room open; a disconnect before the match frees the seat; a reclaimed seat gets a 3 s countdown; host is the first seat, or the other player if they leave before the match; the format locks once the match starts; after a finished match the room returns to the ready check; practice vs bot stays instant; unlimited uses one-set scoring that never ends and tracks points and best rally; ready panel wording; the safety notice is collapsed in the panel; the timing aid and shot label are hidden before the match.
- **Open:** two real simultaneous sessions and a next-day pickup with the same token need the user's playtest (unchecked in the task file); task 7 must read only rated = 1 rows, which a new test enforces.

## 2026-10-15 15:04 AEDT | decision | Movement uses reaction time; earlier claim corrected; measurements noted

- **Decided by:** Claude (the measurements and the correction); user (asked whether running to a far ball reduces the reaction window, and to note it down).
- **Situation:** The user asked whether movement reduces reaction time when an opponent hits far away.
- **Findings:** Yes. Written up in docs/reaction-time.md. From the middle no in-bounds shot needs more than about 1.9 m/s, so auto-move (3.5 m/s) reaches all of them. From 4 m out auto-move reaches 100% of light, 80% of medium and 67% of hard returns; manual (5 m/s) reaches all of them. All of this assumes instant movement, so it is an upper bound.
- **Correction:** I told the user earlier that auto-move was slowed so hard wide shots still beat it. That holds only when the player is out of position; from the middle, no in-bounds shot beats auto-move. The agent's 100/50/0% was measured from the far sideline.
- **Probe error caught:** my first probe gave 0.43 s and x = 0 for every shot because the launching swing was refused (the seat had hit last); the table was discarded, and the redo checks the swing outcome. Recorded in the doc so it isn't repeated.
- **Open:** reaction delay (human and camera), the opponent's choice of aim, tilt movement and recovery between shots are not measured.

## 2026-10-15 05:48 AEDT | decision | Training mode (task 5) runs the view against a local link, not a server room

- **Decided by:** agent (the shape); user (local, no server room, no score, reuse the view).
- **Situation:** Training must reuse the tennis renderer (`view.ts`) but send nothing to the server. `startTennis` took a `Connection` and only ever called `on()` and `send()`.
- **Decision:** A `GameLink` interface (`client/net/link.ts`: `on`, `send`) that `Connection` already satisfies, and a `LocalLink` (`client/games/tennis/local-link.ts`) that answers the same messages from a `TrainingSim` stepped at 60 Hz in the page: swings, moves, mode and pause go into the shared sim, and it emits `state`, `swing` rulings and `presence` as a room would. `view.ts` changes only its parameter type plus an options argument (hide the room code and invite, and hand the scene to training for the landing mark and target zones). The ball machine is seat 1: `shared/games/tennis/machine.ts` feeds balls from the far baseline with the sim's own `launch()` (now exported), deterministic from a seed and the feed number.
- **Why:** One renderer, one sim; the network layer is the only thing swapped, so what training teaches is exactly what a room does. Pure pieces (feeds, swing reports, feedback text, lesson progress) can be unit tested without a browser.

## 2026-10-15 15:32 AEDT | decision | Training: movement optional, timing step covers all three thirds, short "Why?" notes

- **Decided by:** user (movement optional with auto-move on; teach timing to where it lands; brief explanations of timing, speed, reaction time and the point of it); agent (wording, step order, drill numbers, the "Why?" toggle).
- **Situation:** The first build made movement a required step from the middle of the court. docs/reaction-time.md shows auto-move reaches every in-bounds ball from the middle, so that drill taught nothing, and the user didn't want movement forced on anyone.
- **Outcome:** Required steps: camera check (a swing), forehand x2, backhand x2, timing (one early, one on time, one late, each landing in; the ring marks each landing), strength (a light and a hard in). Auto-move stays on through them. Then "Auto-move is on. Want to practise moving yourself?" Yes / No thanks; training counts as complete either way, and the end screen still offers "Practise moving" and "Try targets". The movement drill puts the player 4.2 m out before each feed and sends a medium ball to the far side, crossing 2.4-3.2 m out: spec checks that standing still misses all 30 feeds, a run reaches all of them, and auto-move's 3.5 m/s misses some. "Why?" notes (closed by default, 2-3 sentences) on timing, strength (flight 2.0 / 1.6 / 1.2 s, from the doc) and movement; nothing from the doc's "Not measured yet" list.
- **Checks:** merged main (task 4) first; only the devlog conflicted. `pnpm check` 342 tests exit 0; `pnpm e2e --workers=1` 78 passed exit 0 (load 3-8). Earlier e2e failures this session were a test bug (a step's swing loop running past the step) and load (load 13-17: a key landed a third late; the server on 8125 was killed by SIGTERM from outside), not the code.
- **Why:** A drill that can't be failed teaches nothing; the doc's numbers say where moving actually matters.

## 2026-10-15 15:48 AEDT | milestone | Merged task 5 (training mode) into main

- **Decided by:** Claude (merge and verification); user (the lesson changes: movement optional, timing-to-landing lesson, short explanations, resume the agent, architecture left to the agent); agent (the twelve choices below).
- **Situation:** The training agent had been stopped before committing, with about 1,500 uncommitted lines. I resumed it with the user's lesson changes; it committed, merged task 4 from main (only the devlog conflicted) and finished.
- **Outcome:** main fast-forwarded (branch based on fe6d49b). Verified by me on a fresh build: typecheck exit 0, pnpm check 342/342 exit 0, pnpm e2e --workers=1 78/78 exit 0 (machine load 1.4 before, 8.3 after), no horizontal overflow at 1920x1080 or 390x844. I looked at the training screens: the Learn to play panel (Use my camera, Keys and mouse, Skip training) and step 1 of 5 at both viewports, nothing overlapping the court. The agent ran on claude-opus-5-5 (transcript). server/, shared/protocol.ts and PROCESS.md untouched; the CSP is unchanged.
- **Architecture (the user asked my view; I recommended keeping it):** the real view runs against a local stand-in for the server connection (GameLink / LocalLink) with the shared sim stepped in the page; one renderer, no network, and view.ts changed by about 20 lines. launch() in sim.ts is now exported for the ball machine.
- **Agent choices, not yet confirmed by the user:** note text and step titles; the "Why?" notes sit behind a toggle that starts closed; two of each stroke and a light plus a hard for strength; the movement drill (4.2 m start, 2.4 to 3.2 m crossing, medium pace, auto-move off only for it); a step advances by itself 1.4 s after completing; optional targets (three rings, three hits); the start screen offers Use my camera / Keys and mouse / Skip training; every step has Skip step and Skip training; training hides the score, room code and invite; the coach panel is top-left on desktop and full width on a phone with a smaller camera preview; Train is a plain button after Practice vs bot, not an automatic step after the camera notice; the machine shows as "Ball machine" with no model drawn.
- **Open:** no real-webcam playtest of training; Train is not yet the default way in after the camera notice (task 15 makes webcam the default and wires the dedicated game page); the Why? figures need re-checking if STROKES, AUTO_SPEED or PLAYER change.

## 2026-10-15 16:17 AEDT | bug | Training: the machine fed balls during camera setup; coach hard to read at the side

- **Decided by:** user (the three requests and the flow: centred and paused first, concise, then move to the side); Claude (the Start button, the dimmed court, the wording, and training always starting in auto).
- **Situation:** In a playtest of training mode the user said: Move should be auto by default; it keeps shooting before the camera is set up; and the lessons on the side are hard to see. They want it centred with the game paused and concise first, then moved to the side once ready.
- **Findings:** (1) The ball machine ran from the moment the screen opened (checked in a real page: a ball in flight with no button pressed), and "Use my camera" started step 1 while balls were already coming. (2) Auto is already the code default and a fresh browser has no saved move-mode, so the user's lean must have been a value saved in their own browser; also view.ts sent the camera's saved mode on join, which carried a saved lean into training. I could not see their browser, so that cause is inferred, not confirmed.
- **Fix:** The training sim starts paused (a startPaused option, so only the real screen waits; the other tests build it unpaused); a centred card over a dimmed court with one short line, "Set up camera", "Start" and "Skip training"; closing the camera panel no longer releases the machine (holdPause); Start releases it and the coach slides to the side. Training starts in auto whatever was saved: reset(), plus a startMoveMode override through the view and the camera input (absent in real games, so they are unchanged).
- **Tests:** two unit tests (a paused sim feeds nothing until released; a saved lean doesn't carry in), both failing on the old behaviour (checked); an e2e that sets a saved lean, checks the card is centred, no ball in 3 s, concise (under 30 words), then Start moves the coach aside and no tilt mode is sent. The existing training e2e tests now use Set up camera and Start.
- **Verification:** pnpm check 344/344 exit 0 and pnpm e2e --workers=1 80/80 exit 0; I looked at the setup and started screens at both viewports.
- **Open:** the saved-lean cause is unconfirmed; on mobile the coach goes across the top, not the side.

## 2026-10-15 19:03 AEDT | decision | Swing-strength calibration per stroke added to the parked list

- **Decided by:** user (wants it on the list to discuss later); Claude (the wording and the notes on how strength works today).
- **Situation:** The user asked for a calibration of light, medium and hard swings, for forehand and backhand, to be noted down for later.
- **Outcome:** Added to tasks/parked.md with what the code does now (one pair of speed thresholds for both strokes, 5 and 9 by default, with hysteresis; calibration only behind Advanced) and the questions to settle first. No code changed and nothing is built.
- **Why:** The stance indicator and the grip work made it clear the two strokes may not read the same, but that needs a real-webcam look before any design.

## 2026-10-15 19:15 AEDT | milestone | Training reworked from playtest; stance label, stand-here ring and practice score fixed

- **Decided by:** user (each request below, and the strength levels being light, medium and hard); Claude (the designs, the Ready and Keys-only buttons, the wording, the stance label's look); agent (the root cause of the flaky test).
- **Training, from the user's playtest:** every step now opens centred over a dimmed court with the machine held, a few words (9 to 14 for title plus instruction, down from 17 to 46) and a Ready button; Ready slides it to the side and starts the balls. Start waits for the camera to be set up or Keys only is chosen (the camera is never required). The "Why?" drop-down is a plain line. Stale text is cleared while held, and the card says what is wanted now. The timing step asks for early, then on time, then late, and the strength step light, then medium, then hard, in order; a hit that isn't the one asked for says so ("That was on time. We want early."). The camera's setup panel was hidden under my own dim layer (the "Set up camera does nothing" report) and is now above it.
- **Movement drill (my bug):** I replaced a teleport with a forced walk to a start sideline, which sent the player from side to side and fought their keys; the walk is gone and each ball goes to the side away from where they stand. The camera control now switches to lean while the drill runs (it stayed in auto, so leaning sent nothing) and back after, without saving it.
- **Stance label:** a pill above the timing meter says which stroke the next swing is; with the camera it turns red when the grip would be a wrong-side miss (the sim's own kindFits, checked against real swings in a test). Keys show the ball's side's stroke and never warn. Not seen in red on a real camera yet.
- **Stand-here ring:** was drawn only by the old single arc, so it vanished when the three timing arcs replaced it (for keys and the camera); it is back, drawn last so nothing hides it, with a test that fails without the fix.
- **Practice score:** the match-winning point replaced the score with a fresh one in the same tick, so the board went from the final score to 0-0 and the finish was never shown. The won score now stays through the serve pause, then the new match starts. The test fails without it.
- **Flaky e2e, root cause (Opus agent, pinned seeds, 6 of 6 reproduced):** a test-helper race, not a game bug. A hit only counts when it lands (about 1.4 s after the swing) but the helper waited a fixed 0.7 s, re-read the card while it still said "swing late", and by the time it did the step had finished and the next step held the machine, so no ball came. Fixed by waiting for the landing, the next feed or the step's end; the long keys test then passed 8 of 8 on fresh seeds plus both viewports in the full run. The agent also exposed a stale movement assertion from my removal of the walk, now updated. It ran on claude-opus-5-5.
- **Verification:** full tree typecheck exit 0, pnpm check 368/368 exit 0, pnpm e2e --workers=1 90/90 exit 0. The stance and ring group was also built alone in a clean worktree (28 aid unit tests, 8 aid e2e) before committing it separately. Committed in three pieces: practice score (516e375), stance and ring (55a9162), training.
- **Open:** the red stance state and the lean in the movement drill are untested on a real webcam; the calibration discussion is parked; I used git stash in the shared checkout once for a few seconds while splitting a file (it popped cleanly, and I won't do it again).

## 2026-10-16 03:14 AEDT | decision | Handoff note written for the next session

- **Decided by:** user (asked for the open points to be noted for another session); Claude (what went in it).
- **Outcome:** tasks/handoff.md lists what is unpushed (74 commits), what needs the user's eyes on a real webcam, the parked discussion, the bot-strength question from the last playtest (the score was checked and is not a bug), the queued tasks, untested gaps, the working rules learned this stretch (restart both dev processes, find PIDs by port, spare ports, the long e2e), and which leftover worktrees can be removed. Linked from tasks/00-overview.md.
- **Why:** so a fresh session can start without this conversation.

## 2026-10-21 02:04 AEDT | decision | Next deliverables planned: accounts, per-sport leaderboards, crowd and sound, archery session

- **Decided by:** user (the feature list, passkeys only, guests off the leaderboard, Elo, accounts deletable, display names, rated as a host-set invite option, one leaderboard per sport, sport pages dropped, tasks 10 and 11 set aside, archery in its own session); Claude (passkeys via a library, `obscenity` for names, synthesised audio, the session split, Elo K = 32).
- **Outcome:** new task files 17 to 22 and tasks/sessions.md; tasks 7, 15 and 16 rewritten or tagged; overview table updated. Nothing built, no code changed.
- **Why:** Fly.io has no player sign-in, so accounts are built in; passkeys keep passwords and secrets out of a public repo.
- **Open:** how archery plays (settled in its own session); the display-name profanity check has honest gaps, so an admin can rename by hand.

## 2026-10-21 02:30 AEDT | decision | Archery planned (task 22)

- **Decided by:** user (GamePigeon layout, 8 stages inside a match with one arrow each, alternating turns, unlimited at randomised distances, bow-hold camera input with draw-for-strength and a snap-back release, preview without wind, a practice button that cycles levels with a picker and shows the wind angle, per-game test runs); Claude (shared board, sudden-death tie-break, slow return cancels a draw, server owns flight and score with the preview from the same shared maths, spec naming `spec/archery-*`).
- **Outcome:** tasks/22-archery.md rewritten with the decisions; CLAUDE.md's games rule now allows tennis and archery, and the workflow runs only a game's own specs for a change confined to that game. No code yet.
- **Why:** turn-based archery needs no lag compensation, so the server can own the shot without hurting feel; wind left out of the preview is the skill.
- **Open:** stage table, ring sizes, bullseye bonus and bot aim noise, to be settled in the build with tests.

## 2026-10-21 03:08 AEDT | milestone | Archery playable (task 22)

- **Decided by:** user (implement it); Claude (how: game-owned room formats, two new protocol messages `aim`/`release`, the GamePigeon-style view, the bow-gesture maths, practice as a separate in-page sim).
- **Outcome:** archery runs through the same Room, Lobby and reconnect as tennis. `GameDef.formats` lets each game offer its own formats (archery: "stages", "unlimited"); the lobby refuses one its game doesn't have; a practice room takes its game's default. The unlimited tally also counts archery arrows (best arrow in place of best rally). Client: `client/games/archery/` (range, sight from the no-wind `predictHit`, wind dial with strength and angle, target card, score panel, call after each arrow; mouse, arrow keys + Space, a hold-to-draw button). Camera: bow hand aims, wrist span is draw, a fast snap releases and a slow return cancels (`bow.ts`, pure and tested). Practice cycles levels three arrows at a time, or a picked distance, wind and angle. Menu: archery is playable and keeps its own options.
- **Why:** reusing the room code is what the registry was for; a game-owned format list kept tennis's "one set / best of three" out of archery without a second lobby.
- **Verification:** pnpm check 408/408 exit 0 (20 files, 40 archery specs), archery e2e 8/8 at both viewports. Ran on my own server on :8091; the dev servers on :8080/:5173 were left alone.
- **Open:** the bow gesture is untested on a real webcam (spans and release speed are guesses); ratings per sport wait for task 7; README is 618 words (was 588 before), over the 600 limit by user text I didn't want to cut.

## 2026-10-21 03:27 AEDT | bug | Archery: couldn't shoot; view moved to the centre (user playtest)

- **Decided by:** user (reported both; wants to shoot from the centre); Claude (causes and fixes).
- **What happened:** three causes, each now covered by an e2e that failed without the fix: (1) a mouse press on the range only drew if you dragged down, so a plain press-and-hold never shot; it now draws while held, like the button. (2) Space did nothing after opening practice, because the focused "Practice" button made the key handler skip every key. (3) The draw only grew inside the frame loop, so on a slow frame rate a quick hold could release with no draw at all; the draw now comes from how long it was held, at the moment of release. Also: the camera stood 0.35 m right of the arrow's line, so arrows seemed to fly in from the side; it is now straight behind the launch point. The tennis "Practice vs bot" label I had renamed is back (the full e2e caught it); archery's is "Play vs bot".
- **Also likely for the user:** the dev server on :8080 started at 01:40, before archery existed, and `node --watch` misses edits on /mnt/c, so an archery room there can't work until it is restarted.

## 2026-10-21 03:35 AEDT | decision | Archery: opening the drawing hand shoots

- **Decided by:** user (shoot by letting go of the pulling hand); Claude (how: MediaPipe's hand model for the fingertips, judged against the player's own closed grip; the snap kept as a fallback).
- **Outcome:** archery's camera also loads the hand landmarker (same host as the pose model, so connect-src is unchanged; tennis never loads it). `handOpenness` is fingertip distance from the wrist in palm lengths (about 1 a fist, 2 open); the drawing hand is the detected hand nearest the pose's drawing wrist, not MediaPipe's left/right label. While drawn, opening by 0.45 past the most closed it was this draw, to at least 1.55, shoots with that moment's aim and the fullest recent draw. With no hand reading, the old snap still shoots. The setup panel now says "Aiming hand" with "Left (pull with right)" / "Right (pull with left)" after the user asked what "bow hand" meant.
- **Why:** the pose model's hand points are knuckles, which barely move when a hand opens, so they couldn't tell open from closed.
- **Open:** thresholds untested on a real webcam; the hand model costs a second inference per frame (on a phone this may lower the frame rate).

## 2026-10-21 03:42 AEDT | bug | Archery: an open hand wasn't seen (user playtest)

- **Decided by:** user (reported it); Claude (cause and fix).
- **What happened:** openness was the fingertips' 2D distance from the wrist. A drawing hand points at the camera, so its fingers open along the line of sight and barely move in the image. Now it is how far each finger folds back (angle between wrist->knuckle and knuckle->tip), in 3D using the hand model's depth, 0 a fist to 1 open; thresholds 0.3 past the closed grip and at least 0.6. The spec's facing-the-camera case fails without depth.
- **Also:** a readout under the camera preview shows whether the hand model loaded and the pulling hand's openness live, so a playtest can say what it sees; the hand must be within a shoulder width of the pose's wrist (was half).
- **Open:** still unconfirmed on a real webcam.

## 2026-10-21 04:16 AEDT | bug | Archery playtest round: distance, draw, lost hand, first-person bow

- **Decided by:** user (reported the board not getting farther, the open hand being missed when pulled back, the draw being unreliable, asked for a bow on screen and for slower aiming); Claude (causes and fixes).
- **Distance:** the lens narrowed with distance so the board kept its size and only the background changed. Now a fixed lens (22 degrees, kept as wide on a portrait screen), so the board is big at 10 m and small at 50 m; the corner card still shows it up close.
- **Draw:** was the wrists' straight-line gap, so raising or lowering the aiming hand changed the power and side-on read weak. Now only the gap along the shoulder line (0.3 to 1.3 shoulder widths); spec covers aiming up and down leaving the draw alone.
- **Lost hand:** pulled back by the face the hand model drops the hand for a frame or two. The last reading now holds for 300 ms and the match to the pose's wrist allows 1.5 shoulder widths; spec covers a short loss then opening.
- **Aim:** half as sensitive (aimReach 0.9 to 1.8) and smoothed more.
- **Bow:** a first-person recurve with a string that draws back and a nocked arrow, drawn in its own overlay scene with a wider lens so it keeps its size; lower right, clear of the target at both viewports.
- **Verification:** pnpm check 417/417 exit 0; archery e2e 12/12. The full e2e earlier showed 5 failures while other sessions ran their own e2e on this machine; re-run alone, ready and stroke pass, and the one left (training with the camera, "centred sideways") fails the same on a clean build of HEAD in a worktree on :8093, so it is not from this work.

## 2026-10-21 04:32 AEDT | decision | Archery: the bow sits on the aiming hand's side

- **Decided by:** user (left-hand bow on the left, right-hand on the right); Claude (how).
- **Outcome:** the first-person bow is placed and canted by the camera panel's aiming-hand choice (saved, so it applies without the camera too; left by default), and the arrow rests on the far side of the riser. The new e2e found two bugs: on a phone the practice pickers sat over the camera setup's buttons (the dialog is now above them and the pickers hide while it is open), and a quick arrow-key tap could miss every frame on a slow page (the time held is now applied on release, like the draw).
- **Verification:** archery e2e 14/14 at both viewports.

## 2026-10-29 03:58 AEDT | decision | Track game: sprint first, hurdles second

- **Decided by:** user (wants a running-on-the-spot hurdles game; sprint first; one game with two events; build both knees and elbows camera modes and pick by playtest); Claude (structure: obstacle list in the sim from day one, `shared/games/track/` with a variant).
- **Outcome:** tasks 26 (sprint) and 27 (hurdles) written, overview and CLAUDE.md games line updated. Nothing built yet.

## 2026-10-29 04:21 AEDT | milestone | Track: sprint sim, bot, adapter and rooms (task 26)

- **Decided by:** user (the game, sprint first, server owns position, human cadence cap, formats); Claude (the numbers and the two open rules below).
- **What happened:** `shared/games/track/` (sim, bot, adapter) registered; a `step` message (foot and the client's own timestamp, never a distance); the room counts and floods-cuts steps and tallies races for unlimited; the ready panel labels "Race". `spec/track-sim.test.ts` and `spec/track-room.test.ts` cover cadence to speed, alternation, the cap, the finish, determinism, the bot, rooms, the hold, spectators and no rating vs the bot.
- **Numbers (first guesses, to tune by playtest):** 100 m lane; top speed 10 m/s at 8 steps a second, linear below; cap 10 steps a second (by timestamp and by a server-side bucket, burst of 2); cadence smoothed over 0.6 s; bot 6.8 steps a second with noise (about 15 s).
- **Open rules settled for now (Claude, reversible):** a false step (same foot twice) is ignored, not penalised, since a mis-read camera frame would otherwise cost a person time; a dead heat is re-run. Both are in the spec, so changing them is one test.
- **Verification:** `pnpm check` 444/444, exit 0, against a server built from this tree on :8431.

## 2026-10-29 04:36 AEDT | decision | Home menu: sports on the left, preview and options on the right

- **Decided by:** user (layout: sports as a left column, preview on the right shrunk to the same width, the selected sport's options under it, stacked on a phone); agent (how: a two-column grid from 900px, a compact wrapping tile grid above the preview below that, the pointer arrow on the tile's corner on a phone).
- **What happened:** `client/ui/menu.ts` wraps the picker and the detail (preview, error, options) in `.menu-body`; ids, roles, `data-sport`/`data-action` hooks, roving tabindex, disabled tiles and the loops are unchanged. `client/style.css` holds the layout; the sport grid is `auto-fill`, so new sports (track, task 26) slot in. `e2e/home.e2e.ts`'s order test now checks sports left of the preview and equal columns on desktop, and sports above the preview on a phone.
- **Verification:** against clean HEAD plus these files on :8092 (another session was editing the tree): typecheck and vitest 417/417, exit 0; `playwright --workers=1` 103 passed, 1 failed (desktop `aid.e2e.ts` "aid shows by default", in-game, not the menu); re-run alone, `aid.e2e.ts` 8/8, exit 0. Screenshots at 1920x1080 and 390x844 showed no horizontal scroll.

## 2026-10-29 05:00 AEDT | milestone | Track: sprint playable, view, practice and both camera modes (task 26)

- **Decided by:** user (keyboard/touch, practice in the page, both camera modes behind a setting); Claude (layout, the runner, the provisional default).
- **What happened:** `client/games/track/` (side-on chase view with a race board, A/D or the arrows, two tap buttons; lane and runners from primitives; practice against the bot as a pacer, in the page, nothing sent); `client/input/camera/run-pose.ts` (pure: each side's lift above a stand-still calibration in shoulder widths, a step per lift with hysteresis) with `run-camera.ts` (mode, calibrate, skip). Menu: Track takes the first "??" tile; "Practice" and "Play vs bot" now for every sport but tennis.
- **Camera default:** "elbows" for now, because it works at laptop distance; knees needs stepping back. Left to the real-webcam playtest (not done; the fake webcam has no person, so the e2e only covers the panel, both modes being pickable, the camera starting, and keys still working).
- **Not reused:** `character.ts`, which always holds a racket and has no leg joints; the runner is a small primitive figure.
- **Bug found by the e2e:** none in the game; the camera e2e first timed out because the pose model on a software-rendered page starves the in-page sim's timer, so that test waits longer for the gun.
- **Verification:** on a clean worktree of HEAD (684bdfe) plus only this change: typecheck exit 0, vitest 459/459 exit 0, full e2e at both viewports 116/116 exit 0 (`--workers=1`).

## 2026-10-21 02:34 AEDT | milestone | Task 20: court and stadium graphics, crowd in four addressable sections

- **Decided by:** user (scope: primitives only, crowd sections left / right / front split in half, budget); agent (session C, claude-opus-5-5: every visual choice below, the section names and colours).
- **What changed:** `client/games/tennis/stadium.ts` now paints its static parts with vertex colours and merges them into one lit and one unlit mesh, so the extra detail costs no draw calls: worn grass behind each baseline and at the T, a dark edge round the playing surface, a net with a centre strap, a cord along the bottom, capped posts and winders; an umpire's chair with ladder, parasol and umpire; two crouched ball kids at the posts; players' benches, towels and a cooler opposite the umpire; advertising boards along the low wall in the five Weblympics colours; light-grey stand risers with coloured bench rows and aisles with stairs; a rail, a back wall and a coloured canopy fascia per section; floodlight towers at the far corners; a warmer horizon in the sky.
- **Crowd for task 19:** the seat maths moved to a pure module, `client/games/tennis/crowd-layout.ts`, with four sections (`left`, `right`, `frontLeft`, `frontRight`, as drawn on this client's screen; the arena turns round for seat 1, so mapping seats to sections is task 19's). Each section is a contiguous run of instances in the crowd's two instanced meshes; `buildStadium` now returns `{ crowd }` with the meshes, the layout's ranges and each person's rest matrix. Each section has its own seat and fascia colour (left blue, right red, front-left green, front-right yellow) and about 30% of its fans wear it, so the halves read apart. Reactions and sound are not built (task 19). `spec/crowd-layout.test.ts` checks the sections are contiguous, cover every seat once, sit on their own side, split the end stand about in half, and are seeded.
- **Budget (measured with a WebGL draw-call counter in the page, practice vs bot, swiftshader, both servers built and run side by side on ports 8311 HEAD and 8310 this branch, two runs each):** draw calls per frame 70.0 / 70.9 before, 63.5 / 64.6 after (mobile 69.5 / 69.7 to 62.7 / 62.8). Triangles per frame about 33.6k to 34.2k before, 35.5k to 36.0k after (+5%). Frame rate in the same runs, desktop 13.0 / 10.7 before and 9.2 / 12.5 after, mobile 33.1 / 35.9 before and 35.9 / 37.7 after: within the noise of two other agents' browsers running at the time; no drop that shows over the noise.
- **Screenshots:** before [desktop](../docs/court-before-desktop.png), [mobile](../docs/court-before-mobile.png); after [desktop](../docs/court-after-desktop.png), [mobile](../docs/court-after-mobile.png). Looked at both: the court, net, both players, the ball and the HUD are all clear at 1920x1080 and 390x844; the umpire's chair sits left of the net outside the doubles alley, benches right; no horizontal scroll at either size.
- **No assets:** only Three.js primitives and canvas-drawn textures; no new files besides the module and the test.

## 2026-10-21 02:52 AEDT | milestone | Task 21: endless "Hit the spot" in training

- **Decided by:** user (scope: endless, beside the lessons, nothing sent, seeded spot, closeness, streak, best streak kept locally, Exit); agent (session C, claude-opus-5-5: everything below that the task left open).
- **What it is:** a button "Hit the spot" on the training screen's first card and on the end card. It opens centred and held like every step; Start releases the machine, which feeds mixed forehand and backhand balls for ever. A white ring with a red bullseye sits on the machine's half; each ball reports how close your return landed in a word and the landing mark's colour (Bullseye under 0.5 m gold, On the spot within the 1.2 m ring green, Close up to 2.5 m yellow, Wide grey, Out / Into the net / No return red) with the distance in metres, plus "Streak n · Best m". A landing on the spot adds to the streak and moves the spot; anything else breaks the streak, and the spot moves after three balls anyway. The best streak is kept in `localStorage` (`spot-best`, wrapped in try/catch). Exit goes back to the home screen. Keys and the camera both work (it is the same view); the camera is never required.
- **Agent choices to confirm:** the radii (0.5 / 1.2 / 2.5 m), moving after 3 balls, mixed feeds at medium, each new spot at least 2.5 m from the last, the spot area (singles lines less 0.9 m, from 1 m inside the baseline to 2.2 m past the net), the wording, and offering it from the first card as well as the end, so nobody has to finish the lessons to reach it.
- **Code:** `client/games/tennis/spot.ts` is pure (placement from a seeded hash, closeness, streak). `training-sim.ts` gains `startSpot()` and a `spot` training event; `setLesson` leaves the mode. `training.ts` draws the ring and the card. `view.ts` untouched.
- **Tests:** `spec/spot.test.ts` (22): placement seeded and inside the area, moves visibly; a table of landings to closeness (bullseye, on, near, wide, out, net, none); streak rules; the mode run through the LocalLink with the socket and fetch stubbed to throw (no network); unreturned balls; deterministic for a seed. `e2e/training.e2e.ts` adds one test at both viewports: open the mode, Start, swing on time, see the result word, the next ball comes, no websocket frames sent (pongs aside, as the other training tests do), Exit.
- **Screenshots:** [desktop](../docs/spot-desktop.png), [mobile](../docs/spot-mobile.png). Looked at both: the card is top left on desktop and across the top on a phone, the ring and bullseye show on the far court, the HUD, meter and buttons are clear, no horizontal scroll.
- **Verification:** typecheck exit 0; `pnpm check` 394/394 exit 0 (tasks 20+21 built alone in a second checkout on port 8311). The full e2e there was killed from outside at test 83 of 90 (exit 144, a signal), all 83 green; the training file then ran alone, 17 of 18 green including the new test at both viewports. The one failure, "training with the camera ... skippable" on desktop, also fails on the untouched baseline b9fabc8 under the same load (machine load average about 30 from other agents' browsers; MediaPipe on swiftshader starves the page and the 3 s centring poll times out). The screenshot at the failure shows the card centred. It passed in task 20's full run at lower load. Not a regression; flagged for the integrator to rerun at low load.
- **Also fixed:** task 20's commit had joined the CLAUDE.md "Camera is used for gameplay only" rule onto the end of the training rule's line (a lost newline when splitting the commit); restored here.

## 2026-10-21 03:59 AEDT | milestone | Task 14: Weblympics colours and an animated logo

- **Decided by:** user (Olympic palette, our own ring motif not the IOC's, animated: letters bounce in once, rings float on a loop, still under reduced motion); agent (session C, claude-opus-5-5: the design below).
- **Logo:** five separate rings in a wave (never interlinked, never the 3-over-2 layout) over "Weblympics", each letter in one ring colour, cycling blue, yellow, black, green, red, with a dark ink outline and a white rim so the yellow and blue letters read on the pale sky. Letters bounce in one after another (0.7 s, 60 ms apart); the rings float and tilt on a 4.8 s loop. Under reduced motion nothing animates. The `<h1>` keeps the accessible name "Weblympics".
- **Bug found and fixed while building it:** the menu is drawn twice on load (once at first paint, again when the server's welcome arrives), so the bounce started over half way and screenshots caught letters in mid-air. It now carries on from where it was across redraws (`--since` in `logo()`), and a finished bounce leaves no animation behind (fill `backwards`, not `both`; the held last frame also left a stale layer in full-page captures). `e2e/home.e2e.ts` "plays once per page load" fails without the fix (checked: removed `--since`, both viewports red) and passes with it.
- **Palette across the UI:** `--ring-*` custom properties in `style.css`; the game accent is now the Olympic yellow (#fcb131, was #ffd23f); Train is a green pill, Create a room red, Join blue, Practice vs bot yellow; the pressed sport and the pointed pill have a ring-blue edge; the Main Menu tab is Olympic blue; the score bar has a thin strip of the five colours along its top. Three.js materials keep their colours apart from the arena (task 20 already uses the palette).
- **Contrast (WCAG AA):** `client/ui/brand.ts` lists every text-on-colour pair (both ends of each gradient) and `spec/brand.test.ts` holds each to 4.5:1 (3:1 for large text and control edges), and checks each listed colour really is in `style.css`. Raw yellow (1.9:1 on white) and light blue never carry text on the pale backgrounds; the logo's coloured letters rely on the ink outline (11:1). The tab's first gradient (#0a8fd8, 3.6:1 with white) failed and was darkened to #0070ad (5.3:1).
- **Layout:** the logo is taller than the old title, which pushed the footer below the fold at 1080p, so the desktop preview went from 16:9 to 2:1. Everything fits one screen at 1920x1080 (an e2e checks the readme link) and the home screen still fits at 390x844 without horizontal scroll.
- **Screenshots:** before: `docs/home-desktop.png`, `docs/home-mobile.png` (from task 13, kept); after: [desktop](../docs/home-brand-desktop.png), [mobile](../docs/home-brand-mobile.png), [game on a phone](../docs/game-brand-mobile.png). Looked at all three: logo whole at both sizes, the coloured pills read, the score bar strip is there, nothing clipped.

## 2026-10-21 03:59 AEDT | milestone | Task 23: arrow cursor and looping thumbnails

- **Decided by:** user (the arrow is POINTER from menu.ts; lighter loop animations, not a replay; still under reduced motion; no Three.js, no files); agent (session C, claude-opus-5-5: the loops' content, CSS cursor rather than a following element).
- **Cursor (interpretation to confirm with the user, as the task says):** the page cursor itself is the chunky arrow on the home screen: a CSS `cursor` with the same SVG as a data URI, hotspot on its tip, on the menu, its pills, links and the disabled tiles; the room-code box keeps the text cursor. Only under `(hover: hover) and (pointer: fine)`, so touch shows none; the game's canvas keeps the browser's cursor. No element follows the mouse, so nothing lags or animates (reduced motion is moot for it). The arrow marker on the pointed sport pill stays. The CSP is unchanged (it only limits connect-src).
- **Loops:** every thumbnail loops, drawn inside its own SVG so it lines up at any frame shape (the old HTML sprites crossed the frame in cqi units and were hidden on phones; they are gone). Tennis: a rally, the near player (blue) and far player (red) taking turns, the ball arcing over the net with a bounce each side, 2.4 s. Bowling: the ball rolls into the pins, which tumble and reset, 3 s. Archery: an arrow flies into the target, which shivers, 2.8 s. ??: the question marks bob and three sparkles twinkle, 2.6 s. All transforms on SVG groups, so no layout shift (an e2e checks the frame's box doesn't move); they run on phones too.
- **Reduced motion:** one still frame (the tennis ball drawn mid-rally); an e2e checks no animation exists on the logo or any thumbnail under `reducedMotion: reduce`.
- **Hidden tab:** `visibilitychange` sets `.is-paused` on the preview, pausing every loop; an e2e checks paused when hidden and running again when shown.
- **No Three.js:** `spec/home-screen.test.ts` walks menu.ts's import graph and fails if it reaches `three` (and checks the walk does find `three` from view.ts); the e2e checks the home screen has no canvas. Note: Three.js is still in the one main bundle because `main.ts` imports the game view statically; it is not run on the home screen, but it is downloaded. Splitting it out is a `main.ts` change outside this task.
- **Screenshots:** [desktop](../docs/home-brand-desktop.png), [mobile](../docs/home-brand-mobile.png), loop frames [tennis](../docs/thumb-loop-0.png), [bowling](../docs/thumb-loop-1.png), [archery](../docs/thumb-loop-2.png), [??](../docs/thumb-loop-3.png), and [the cursor](../docs/home-cursor.png) (composited onto a capture: headless browsers don't draw the cursor). Looked at each loop at six points of its cycle at both viewports.
- **For session A:** `client/ui/menu.ts` changed in: the `<h1>` is now `${logo()}` (new `logo()` above `POINTER`), the old `sprite()` helper is replaced by `figure()`, every thumbnail function draws a `<g class="loop">`, the Train / Create pills gained `pill--green` / `pill--red`, and `renderMenu` adds a `visibilitychange` listener after `show(selected)`. The footer, the identity row and the demo buttons are untouched.
- **Verification (tasks 14 and 23, with 20 and 21 in the same tree):** typecheck exit 0; `pnpm check` 416/416 exit 0; `e2e/home.e2e.ts` and `e2e/layout.e2e.ts` alone at both viewports, all green. Full `pnpm e2e --workers=1`: 97 passed, 5 failed (exit 1) at machine load 30 to 41 from other agents' browsers. All five are camera or frame-rate tests: camera trail (desktop), invite-court view (desktop) and Set up camera panel (desktop) each passed when rerun alone (exit 0); "training with the camera ... skippable" (both viewports) fails the same way on the untouched baseline b9fabc8 under this load. None touch the home screen. The integrator should rerun the full e2e when the machine is quiet.

## 2026-10-21 03:45 AEDT | milestone | Task 15: webcam by default (session B)

- **Decided by:** user (webcam default, training after the camera setup, sport pages and thumbnails dropped); agent (the choices listed below).
- **What happened:** Practice, a room and training now open the camera setup as soon as a seated player arrives (safety notice unless remembered, then the hand, swing and aim choices). Every step has "Use keyboard instead" in place of Cancel. That button, Escape, or "Keep playing" after a refused or missing camera closes the setup and leaves a game played on keys and buttons. Spectators get no setup. Once the camera check is done, practice offers training once per device ("Camera ready: Train first / Skip training"). Train first leaves the bot room and opens training with the camera restarted straight away using the saved choices. In training, "Use keyboard instead" counts as Keys only.
- **Agent choices, not confirmed:** (1) the offer comes once per device (a `training-offered` flag in localStorage) and only from practice, because in a room someone may be waiting; (2) closing the setup the keyboard way clears focus, so Space swings rather than pressing the focused Camera button and reopening the panel (found while writing the test); (3) the wording "Camera ready" and "New here? A short lesson...".
- **Tests:** new `e2e/webcam-default.e2e.ts` (6 tests x 2 viewports: keyboard path, the second step, a refused permission, a room, Train first, Skip training), 12/12 exit 0. Existing e2e updated to take the keyboard path through a shared helper (`e2e/flow.ts`). pnpm check 368/368 exit 0 on the staged tree, built alone on port 8213. The full e2e (load 9-27, other sessions' browsers running) showed 8 failures before it was killed from outside (exit 143) at test 100. Two were my test bugs (an extra pause message from the setup that now opens by itself; a button looked up by role inside a hidden coach) and are fixed. The rest (trail count, coach centring, a 60 s keypress) also fail on an untouched build of main at the same load, so they are load, not this change.
- **Screens looked at:** the safety notice at 1920x1080, and the choices and "Camera ready" offer at 390x844; nothing clipped, no horizontal scroll.
- **Open:** not seen on a real webcam.

## 2026-10-21 04:47 AEDT | milestone | Task 16: point call across the top, players react (session B)

- **Decided by:** user (big call at the top in tennis words, reactions shown on each screen only, crowd and sound left to task 19); agent (the wording details, looks and placement below).
- **What happened:** After each point a bold call ("15-Love", "30-all", "Deuce", "Advantage Bot", "Game", "Set", "Game, set, match") goes across the top, under the HUD, with "Bot wins the point" underneath. It is gold for a game, set or match. It replaces the score bar's small call, so the call is shown once, and it is the live region for screen readers. The loser gets a scribble over their head and slumps; the winner gets sparkles (more for a bigger moment) and a fist pump. Each screen works all of this out from the snapshots it already receives (new pure `point-call.ts`), so nothing new is sent and spectators see it too. Training keeps no score, so it shows no call.
- **Agent choices, not confirmed:** "Love" in every call (the score bar's own cells still show 0/15/30/40); server's score first, as umpires call it; a first-serve fault shows "Fault" with no reactions; a double fault shows "Double fault" with the new score underneath; a tiebreak is called in numbers; on a phone the banner takes the left of the band while the camera preview is on; the call stays up 2 s plus 0.4 s per level of importance; reduced motion keeps the effects but still.
- **For task 19:** `pointCall` and `reactions` in `client/games/tennis/point-call.ts` already say who won, who lost and how big the moment was. The crowd and the sounds should be driven from them, not from a second copy.
- **Tests:** `spec/point-call.test.ts` (26 rows, built from real `pointWon` / `fault` steps; with the old "15-0" wording 6 rows fail). New `e2e/call-banner.e2e.ts` (7 tests x 2 viewports): clear of the court and every HUD piece with keys and with the camera on, both seats and a spectator see the same call and reactions, every sent frame is on the allowed list, reduced motion, training. pnpm check 394/394 exit 0. Full pnpm e2e --workers=1: 108 passed, 6 failed (exit 1) at load 27-29 with other sessions' browsers running. All 6 then passed when rerun (exit 0). Two of the banner failures were test races: a call ending between the visibility check and the measurement, and a slow spectator join. The tests now measure in one go and retry on the next call.
- **Screens looked at:** the banner at 1920x1080 and 390x844, with keys and with the camera; it covers neither the court, the score bar, the dock nor the meter, and the scribble shows over the player who lost the point. The far player's sparkles are small at desktop size.
- **Open:** not seen in a real match with a real person; the crowd and sounds are task 19.

## 2026-10-21 03:35 AEDT | milestone | Task 17 built: guest cookies, passkeys, display names, delete, locked demo accounts

- **Decided by:** user (passkeys, `@simplewebauthn`, `obscenity`, the name limits, deletion, locked demo accounts behind Dev tools; all in the task file); agent (session A, Opus 5.5: everything listed under "Agent choices").
- **What:** schema v4 (`account`, `demo`, `webauthn_id` on players; `passkeys` and `sessions` tables; a unique index on lower(name) among accounts; the two demo guests become locked demo accounts). New `server/accounts.ts`, `auth.ts`, `guard.ts`, `names.ts`, `shared/names.ts`; client `net/account.ts`, `ui/profile.ts` + `.css`; `/api/*` routes. The WebSocket no longer takes a token or demo number from `hello`: who you are is read from the cookies when the socket opens.
- **Agent choices (need the user's OK):**
  - Guest identity moved from a localStorage token sent in `hello` to an HttpOnly `wl_guest` cookie (400 days, refreshed on each visit). A browser from before keeps its guest: the page hands its old localStorage token over once (`x-legacy-guest`), and the server adopts it only if it is an existing guest, never an account.
  - Claiming keeps the guest's pseudonym as the account's first name (renamed only if another account already has it).
  - Name characters: ASCII only (no accented or other-script letters), so look-alike names can't copy someone; at least one letter. Reserved list adds "You", "Guest", "Deleted player", "Weblympics", "Moderator", and the server's own pseudonym shape. "<name> (2)" is impossible because brackets aren't allowed.
  - Deletion rewrites the player's token in `matches` to a random `deleted:` tombstone, so match rows stay with nothing linking back.
  - CSRF defence is an Origin check on every POST and the WebSocket upgrade (same host, https, or http on localhost). Rate limits per address: 40 passkey requests and 60 other writes a minute; `Fly-Client-IP` is trusted only on Fly.
  - Sessions last 90 days. Sign-in uses discoverable passkeys (no user name field).
  - The profile panel is a native `<dialog>` with its own module; `menu.ts` only gained a Profile button and the closed "Dev tools" `<details>`, to keep clear of session C's rewrite.
  - Admin rename command and the details live in `docs/accounts.md`; the README got one sentence and a link, since it was at 588 of 600 words (597 now).
- **Tests:** `spec/accounts.test.ts` (migration from v3, guests, claiming, passkeys, sessions, every name rule, delete, guards), `spec/auth-api.test.ts` (the real handler with a software ES256 authenticator: register, sign out, sign in on another device, replay refused, wrong origin refused, rate limit, no secrets in logs, hostile names, demo locks, delete) and `e2e/accounts.e2e.ts` (CDP virtual authenticator at both viewports). `spec/rooms.test.ts` reconnects by cookie now, so held-seat reclaim is still covered. `pnpm check` 409/409 exit 0.
- **Not checked:** a real passkey on a real phone or laptop, and on the Fly URL (passkeys are per domain).

## 2026-10-21 04:28 AEDT | milestone | Task 18 built: character looks from fixed lists, seen by everyone in the room

- **Decided by:** user (colours for shirt, shorts, skin and hair plus a hat or hairstyle, from a fixed list; guests get the default); agent (session A, Opus 5.5: the choices below).
- **What:** `shared/look.ts` (palette and styles, `parseLook` that refuses anything off the lists or with extra fields); schema v5 adds `players.look` (JSON of enum values, NULL for default) with a migration test from v4; `POST /api/look`; each lobby seat carries its look, so both players and spectators get it; `character.ts` takes a look and can change it live (colours as material parameters, hair and hats as a few primitives); a customise section in the profile dialog with a live preview.
- **Agent choices (need the user's OK):** nine shirt, six shorts, six skin, six hair colours; styles short, long, bun, bald, cap, visor, headband (the cap and visor take the shirt colour). The preview is a flat SVG figure, not the 3D model, because the home screen never loads Three.js. The look is chosen in the profile and seen in the next room you join (no live change mid-room). Demo accounts may change their look, since they are how two seats get tested; they stay locked for name, passkeys and delete. Swatches are native radios named "Blue shirt", "Skin tone 3" and so on, so screen readers and arrow keys work.
- **Bug found on the way (mine, not shipped):** my test server on port 8110 was the very first one I launched; later "restarts" failed with the port in use, so some runs used older server code. Fixed my restart to find the PID from the port, and re-ran task 17's whole `pnpm check` (409/409, exit 0) and its e2e against a fresh server built from the 17 commit in a separate worktree.
- **Tests:** `spec/look.test.ts` (every listed value accepted, hostile values refused and not stored, guests refused, survives reopening the db, deleted with the account, v4 to v5 migration, room state for both seats and a spectator, hostile POST against the running app) and `e2e/look.e2e.ts` (live preview, keyboard arrows, saved across a reload, seen on seat 1 by host, joiner and a spectator, both viewports).

## 2026-10-21 05:16 AEDT | milestone | Task 7 built: host's rated option, Elo per sport, leaderboard, history; a bug fixed on the way

- **Decided by:** user (rated as a host-set invite option that clears ready; Elo from 1000 with K = 32; one leaderboard and rating per sport; accounts only; demo accounts hidden; your rank shown); agent (session A, Opus 5.5: the choices below).
- **What:** schema v6 (`ratings` keyed by player and sport, indexes on match players); `server/ratings.ts` (Elo, `recordResult` writes the match row and both ratings in one transaction, `recomputeRatings` from `rated = 1` rows, leaderboard, history, longest rally); the lobby's `rated` option and `ratedBlocked` reason, each seat's rating in the room state; `GET /api/leaderboard?sport=` and `/api/history`; ready-panel switch; a leaderboard dialog with a tab per registered sport, polled each second; ratings and longest rally in the profile.
- **Agent choices (need the user's OK):**
  - "Floor" in the task's Elo table read as a rating floor of 100 (the loser never drops below it; the winner still gains the full amount).
  - The match's sport is the existing `matches.game` column (already the registry id) rather than a duplicate `sport` column; `ratings.sport` is new.
  - v6 marks every old row `rated = 0`: before accounts, "rated" rows were between guests, and the new rule rates accounts only. The v3 and v4 migration tests were updated to expect that (rows are all kept).
  - `isRated` now also needs the host's option and both seats to be accounts; `MatchRecord` carries both. Best rally is stored for every match now (it was unlimited only), for the longest-rally record.
  - The format notes in the ready panel no longer say "Rated." (whether it is rated is the switch now).
  - Short poll (1 s) rather than a push, as the simpler of the two the task allowed.
  - README is at its 600-word cap, so it carries one sentence (passkey accounts, Elo per sport, 1000, K = 32) and links `docs/accounts.md` for the formula, the per-domain passkey note and the admin command.
- **Bug (pre-existing, found by my e2e):** `client.room?.format(...) ?? "not in a room"` turned an accepted format change (which returns null) into an error message, so every successful format change also sent the host "not in a room". The same pattern in my new `rated` handler did it too. Fixed both; `spec/rooms.test.ts` has a test that failed before the fix.
- **Tests:** `spec/ratings.test.ts` (Elo table, floor, zero-sum, unrated never moves a rating, recompute, a fake second sport, board order and ranks, guests and demo hidden, deleted player, history, reopen the db, v5 to v6, the rated option on the real Room, hostile `rated` messages and unknown sports on the running app); `spec/rated-match.test.ts` (Demo One and Demo Two play a real rated set on the running app; a second session's board changes within 1.2 s of the end; about 100 s); `e2e/leaderboard.e2e.ts` (dialog, tabs, keyboard, fits both viewports, the switch with a guest and with two accounts).

## 2026-10-21 05:40 AEDT | milestone | Task 8 built: log lines without identities, /stats, and a test that reads the server's output

- **Decided by:** user (the scope in the task file); agent (session A, Opus 5.5: the choices below).
- **What:** every log line now names a player only as `who`, an 8-character HMAC of their internal id with a key made fresh at each start (lines can be followed per player within a run, never linked to an account or across restarts). `log()` also drops any field called token, cookie, session, name, credential, challenge and so on. New events: `connect` (with `again` when the same player already has a socket, i.e. a reconnect), `disconnect` (close code, a short reason, seconds connected, room), `swing_drop` (spectator or cooldown, with rtt), `tick_slow` (a loop pump over 8 ms), `bad_message`, `heartbeat_timeout`, and `error` for uncaught exceptions, unhandled rejections, socket errors and API errors (message only). `room_close` no longer writes the absent player's name. `GET /stats`: uptime, connections, players online, rooms, playing, seated, spectators, loop average and max ms, and memory (rss, heap, the 256 MB limit and percent used). `/healthz` is unchanged.
- **Agent choices (need the user's OK):** pseudonyms count as personal too, so no name of any kind is logged (the old lines had names); the 8 ms slow-pump threshold (half a 60 Hz tick); `/stats` is public and holds counts only.
- **Finding while testing (not production):** the server sits at about 112 MB RSS with no rooms (44% of the 256 MB machine); worth watching on Fly with `/stats`.
- **Test fix:** my task 18 e2e (`e2e/look.e2e.ts`) left two 3D browser contexts open, which starved the next file's first test (`ready.e2e.ts`: "Create a room" never reached a room within 5 s, on both viewports, in every full run). It now closes them; the leaderboard e2e does the same.
- **Open:** the PROCESS.md finding from real `flyctl logs` is the user's (agents don't run flyctl or edit PROCESS.md).
- **Tests:** `spec/stats-logging.test.ts` (`/stats` on the running app; a private server on a free port plays a session with a passkey sign-up, a rename, two players, a quick double swing, a bad message, a drop and a reclaim, then checks the events are there and that no cookie, session, challenge, passkey id, user handle or name appears in its output; making the server log a token on purpose turned it red).

## 2026-11-05 03:56 AEDT | playtest + bug | Track: arm running too hard; flaky "database is locked" in `pnpm check`

- **Decided by:** user (the finding: "I have to move my arms too much to make him run"); Claude (the numbers and either-arm rule).
- **What happened:** elbows mode needed each wrist to rise 0.4 shoulder widths above rest, alternate strictly, at 8 steps a second for top speed. A running arm swings mostly toward the camera, so a quick pump barely rises. Now: `liftOn` 0.2 / `liftOff` 0.08, a pump on either arm counts and the tracker labels steps left, right, left itself (the sim's same-foot rule and 10-a-second cap are unchanged, so it buys nothing over a fair runner); `FULL_CADENCE` 8 to 6; bot cadence 6.8 to 5.2 so it stays a fair pacer (same ~15 s race). Knees mode unchanged.
- **Bug:** `pnpm check` failed one random file per run with "database is locked" (on HEAD too): the server and test workers open `data/app.db` together and node:sqlite failed at once. `server/db.ts` `openDatabase` now waits up to 5 s for a lock.
- **Tests:** `spec/track-run-pose.test.ts` (a quarter-width pump counts; one arm alone gives alternating steps; knees still report the real side), `spec/db-lock.test.ts` (another process holds the lock; the write waits). Each fails on the old code.
- **Verification:** `pnpm check` exit 0 (25 files), `pnpm e2e --workers=1 e2e/track` 12/12 exit 0. Real-webcam feel still to be checked by the user.

## 2026-11-05 05:16 AEDT | decision | Spectating with the link (task 24 picked up)

- **Decided by:** user ("add a feature where people with the link can spectate too"); Claude (the design: a separate watch link that always spectates, a spectator view for every game, a per-room cap).
- **What happened:** task 24 had been parked on 2026-10-21 as "write down only". The user picked it up. A third arrival already spectates; the gap is a link that spectates on purpose (so a viewer never takes a free seat), a proper spectator view and a limit. The rule "no public room list" stays.
- **Next:** an agent builds it on main once the integrate5 merge lands, since it touches rooms and the menu that merge changed.

## 2026-11-05 05:17 AEDT | decision | Spectator cap: 10 per room

- **Decided by:** user (10); Claude (proposed a cap of 50 and explained why).
- **Why a cap:** the app runs on one shared CPU with 256 MB (`fly.toml`, fixed by the course), and every watcher gets the state 30 times a second; an uncapped link (or a script opening many tabs) could lag the two players or the whole server.

## 2026-11-05 05:37 AEDT | milestone | integrate5 merged into main (tasks 7, 8, 14-18, 20, 21, 23)

- **Decided by:** user (merge it, and clean up old worktrees); Claude (finishing the merge another session had resolved, and the checks).
- **What happened:** integrate5 (21 Oct: passkey accounts, looks, leaderboard and Elo, logging, brand, arena, point call, webcam default, hit the spot) had never reached main; main had since gained track and the new menu. Another session resolved the merge (six conflicts) and handed it over. I committed it, merged current main in (conflicts in server/db.ts, kept both the accounts' exported db and the lock wait, and in the devlog), and fast-forwarded main. 18 stale agent worktrees whose work was already on main or integrate5 were removed; one with 8 unsaved training files was kept.
- **Verification:** on merge-integrate5 with its own server (:8591, fresh data dir): typecheck and vitest 611/611 exit 0, twice (the "database is locked" flake seen before 8df2445 did not recur); `pnpm e2e --workers=1` 170/170 exit 0 at both viewports.

## 2026-11-05 05:48 AEDT | milestone | Spectating built (task 24)

- **Decided by:** user (anyone with the link may watch; at most 10 watchers a room); agent (everything below).
- **What:** `#/watch/CODE` joins with `watch: true` and always spectates, even with a seat free; the invite link is unchanged. The server caps watchers at 10 (`MAX_WATCHERS` in `shared/protocol.ts`): the 11th, by watch link or by invite once both seats are taken, gets "This match is full of watchers." and lands on the home screen with the link cleared. Every game's HUD gets "Copy watch link" beside "Copy invite" (`client/ui/spectate.ts`); a watcher sees a "Watching" badge with both names and the count instead of the invite, and no camera, ready button or controls (the views already hid them for a seat of null). A mid-match watcher gets room, state, presence and lobby at once.
- **Agent choices (need the user's OK):** (1) the watch link still gives a player back their own held seat after a drop, so a player who reopens the watch link mid-hold isn't locked out; (2) a refused join is checked before leaving the current room, so the cap never pulls someone out of their own room; (3) a watcher's page keeps `#/watch/CODE`, and a reconnect rejoins as a watcher; (4) a watcher sees "Copy watch link" but not "Copy invite"; (5) a tennis watcher hears a click on every hit (players hear their own swings only, as before); archery and track have no sound yet, so nothing to add; (6) the watch link is offered in practice rooms too (someone may want to watch a practice game).
- **Tests:** `spec/spectate.test.ts` (watch link with a free seat; mid-match state at once; the cap by watch link and by invite; held-seat reclaim; the parser; a hostile spectator sending swing, move, mode, aim, release, step, ready, format, rated and pause every tick leaves tennis, archery and track identical to a run without them; through the server, the 11th's error and that a refused join stays in its own room). `e2e/spectate.e2e.ts` at both viewports.

## 2026-11-05 06:39 AEDT | milestone | Home screen: profile button top right; Create a room is the big button

- **Decided by:** user (the sign-in menu moves to the top right behind a profile icon whose picture is the player's character; "create a room the big button and play vs bot the small"); agent (everything else below).
- **What happened:** a round profile button, top right of the home screen, shows the head and shoulders of the player's own look (`client/ui/profile-menu.ts`, drawn once as SVG by `look-preview.ts` with a new `"head"` crop; no Three.js, no render loop). The name sits beside it on desktop; on a phone only the picture shows and the name is its label ("Profile: <name>"). It opens a panel (a modal `<dialog>`: a popover under the button on desktop, a bottom sheet at 390x844) with a bigger figure, the name, guest/signed in/demo, matches played, passkey sign in and create account (or sign out / play as guest), "Edit profile and look" (the existing profile dialog), "Leaderboard", and the closed "Dev tools" with the demo accounts. The footer now holds only "What makes this good?". In each sport's options "Create a room" is the full-width yellow primary button, and vs the bot (now red) and Train/Practice are the smaller pair under it.
- **Agent choices (need the user's OK):** the server's `welcome` now carries the account's saved `look` (null for a guest, who wears seat 1's default), so the avatar is right on first paint and after every look save, sign in or sign out (each already reconnects); the panel's first focus is the first action, not the close button; Tab wraps inside the panel; after a sign in from the panel focus returns to the redrawn button; "Leave demo account" is now "Play as guest"; vs the bot took the red pill that Create a room had.
- **Tests:** `spec/look.test.ts` (the welcome carries Demo Two's saved look; a guest's is null). `e2e/home.e2e.ts` new: button top right with the look at both viewports, name beside it on desktop only, no overlap with the logo or options, no animation; the panel by keyboard (focus in, Tab stays in, Escape closes and returns focus, aria-expanded); popover vs bottom sheet, 44 px buttons, no sideways scroll; demo sign in from the panel changes name and picture; Create a room first, primary and bigger for all three sports. `accounts`, `look` and `leaderboard` e2e now reach sign in, the profile dialog and the board through the panel (shared helpers in `e2e/flow.ts`).
- **Verification:** `pnpm check` exit 0 (36 files, 611 tests). `pnpm e2e --workers=1` full suite: 177 passed, 1 failed, exit 1: `call-banner.e2e.ts:129` (three 3D browsers; the spectator missed one reaction frame); it passed alone (exit 0), and it doesn't touch the menu.

## 2026-11-05 07:15 AEDT | milestone + bug | Spectating and the profile button merged; the real cause of "database is locked"

- **Decided by:** Claude (merge, the fix); agents' choices are in their own entries above.
- **What happened:** spectate-24 (task 24: watch link, watcher view, 10 per room) and profile-menu (top-right profile with the character, sign-in in its panel, Create a room as the primary button) merged on integrate-6; only the devlog conflicted.
- **Bug:** the lock wait from 8df2445 didn't stop "database is locked": the failure is at `PRAGMA journal_mode = WAL` on open, which takes an exclusive lock SQLite's busy timeout doesn't retry, when several spec workers import server/db.ts on the same ./data/app.db. Fix: `spec/worker-data.ts` gives each worker its own DATA_DIR; `spec/db-lock.test.ts` checks it (fails without the setup file).
- **Verification:** on integrate-6 with its own server (:8991): vitest 37/37 files three runs in a row, exit 0; `pnpm e2e --workers=1` 184/184 exit 0 at both viewports.

## 2026-11-05 19:08 AEDT | bug | "Wrong origin" signing in with a passkey on the dev client

- **Decided by:** user (found it); Claude (cause and fix).
- **What happened:** on http://localhost:5173 every passkey POST got 403 "Wrong origin.". Vite's proxy forwarded /api with Host rewritten to localhost:8080 while the browser's Origin stayed localhost:5173, so server/guard.ts (Origin's host must equal Host) refused it. Through :8080 it worked.
- **Fix:** `vite.config.ts` proxies /api, /ws and /readme with `changeOrigin: false`, keeping the browser's Host. The server's check is unchanged. Production is unaffected (no proxy there).
- **Test:** `spec/dev-proxy.test.ts` (fails without the fix). Reproduced by curl: 403 before, 200 after. `pnpm check` 38 files exit 0.

## 2026-11-05 04:35 AEDT | milestone | Boxing: sim, bot, adapter, rooms and camera maths (task 30, first half)

- **Decided by:** user (the rules, 2026-11-05: 3 x 30 s rounds, jab and hook, guard both hands at the face, a blocked punch does little, health bars, KO else points); agent (the rest below).
- **What happened:** `shared/games/boxing/` (sim, bot, adapter) registered. New `punch` (jab or hook, hand, the client's timestamp) and `guard` (up or down) messages, never damage; the room flood-cuts them at 30 a second and the sim lands each punch after its wind-up (jab 200 ms, hook 350 ms), checking the other's guard on the landing tick. `client/input/camera/box-pose.ts` (pure: jab from the wrist's depth speed in front of its shoulder, hook from a fast sweep across at shoulder height, guard from both wrists near the nose, with hysteresis). No view, no menu tile: they wait on task 28.
- **Numbers (guesses for playtest):** health 100, jab 6, hook 14, guarded 20% (rounded: 1 and 3); recovery 150 ms after landing; cap 4 punches a second per boxer, burst 2, timestamps at least 100 ms apart; 5 s break. Bot reacts 250-450 ms after a throw and misses a quarter of punches, so it rarely blocks a jab but often a hook; about one punch a second, 65% jabs. Camera: jab 4 shoulder widths a second ending 0.5 in front; hook 4 a second within 0.7 of shoulder height; guard on within 0.55 of the face, off past 0.75.
- **Shared change:** `GameInstance.finished()` may give `winner: null` for a draw (only boxing does); `MatchRecord.draw` marks one, and `isRated` rates a draw between two people (no schema step: `winner` was already nullable). `RoomFormat` gains "bout"; the ready panel got its label and note so the client compiles.
- **Open rules settled for now (agent, reversible):** punches in the air at the bell don't count; a mutual KO on the same tick goes to damage dealt; the guard can move in the break but no punch can; a punch dropped by the cap is counted (`capped`), not punished.
- **Verification:** `APP_URL=http://localhost:8383 pnpm check` exit 0 against this worktree's own server on :8383.

## 2026-11-05 20:46 AEDT | milestone + playtest | Boxing: a first playable page, and the balance fixed

- **Decided by:** user (asked to see boxing; yes to a quick playable prototype with the numbers tuned first); Claude (health, the 2D view, the menu tile).
- **Finding:** run bot against bot, every one of 10 bouts ended in round 1 after 11 to 18 seconds with both boxers on 0 health: with health 100, jab 6 and hook 14 about ten clean punches decide a bout, so the three rounds never happened. Tried 100, 250, 400, 500, 600 over 40 bouts: average 14, 36, 58, 74, 88 s. Chose 500 (74 s average, most bouts into round 3, 36 of 40 still end in a KO). A real person guards more than the bot, so this is still a guess for a real playtest.
- **What happened:** `client/games/boxing/` (`view.ts` a flat 2D ring on one canvas with a bout board, round call and J/K/Space plus three buttons; `practice.ts` + `practice-sim.ts` in the page; `boxing.css`), wired in `client/main.ts` (`#/boxing/practice`, rooms) and the home menu: Boxing takes the "??" tile (icon, looping thumbnail). No camera yet (box-pose.ts is not wired), no 3D (task 28).
- **Merge:** merged main (accounts, profile, spectating) into the boxing branch first; four conflicts (CLAUDE.md, devlog, ready-panel, schema.ts: kept main's host-rated rule plus boxing's draw). Boxing's old rated specs now seat two accounts and turn rated on, as track's do. `.gitignore` now ignores `data-*/` after a test database was nearly committed.
- **Flaky test:** `spec/stats-logging.test.ts` failed by 1 (47 vs 48) twice across agents: the server rounds the memory percent from bytes and the test recomputed it from rounded megabytes. It now allows a difference of 1.
- **Tests:** `spec/boxing-practice.test.ts`, a bout-length spec in `spec/boxing-sim.test.ts` (fails at health 100: 15 s average), `e2e/boxing.e2e.ts` (5 tests at both viewports). `pnpm check` 42 files, 669 tests, exit 0. Full e2e at both viewports running on this branch.
- **Open:** README is 695 words against its 400 to 600 limit (it was 661 before this).

## 2026-11-05 21:15 AEDT | milestone | Boxing: the camera option

- **Decided by:** user ("add the camera option", after asking where it was); Claude (the panel and thresholds' wiring).
- **What happened:** `client/games/boxing/box-camera.ts` (a Camera button, a short safety panel, "Start camera" or "Use keyboard instead", then it tracks; a chip says Tracking or Can't see your shoulders; two pills show whether the guard is up and the last punch it read) wired into `view.ts`. The camera sends the same `punch` and `guard` messages a key does; the server still lands every hit. In practice the bout pauses while the panel is open. The maths is the existing `box-pose.ts`, which needs no calibration (shoulder widths from the shoulder line). I said "no camera yet" when handing over the first page and should have said so plainly.
- **Layout bug:** on a phone the camera preview overlapped the HUD. Cause of the confusion while fixing it: Vite's dev server on this /mnt/c drive served stale CSS, so my first two edits seemed to do nothing; restarting it with `--force` showed the real effect. Preview now sits at 240 px below the HUD (229 px), above the buttons (777 px), at 390x844.
- **Tests:** `spec/boxing-box-pose.test.ts` (a jab read from the body becomes a punch in the practice sim and costs health; a raised guard reaches the sim), `e2e/boxing.e2e.ts` (the panel, the fake webcam starting, keys still working, "Use keyboard instead"). The fake webcam has no person, so no real punch was ever read: the thresholds in `DEFAULT_BOX` are still guesses for a real-webcam playtest.
- **E2E on the first full run:** 190 passed, 4 failed. Two were `e2e/leaderboard.e2e.ts` hard-coding three sport tabs (boxing is the fourth): it now counts the tabs. Two were `call-banner.e2e.ts` on desktop reading a reaction after it had cleared, at machine load 13; all 20 call-banner and leaderboard tests pass alone at load 4. `pnpm check` 42 files, 671 tests, exit 0.

## 2026-11-05 21:59 AEDT | decision + tool | Boxing: arms in/out redesign agreed in discussion; a ?debug readout to measure real arms

- **Decided by:** user (in discussion: the 3D look; a cost to always guarding via head and body shots with high and low guards; a shoulder dodge; the character's arms follow the player's; a punch is an arm going from "in" to "out", hit or blocked by where the other's gloves are; no added wind-up, since a wind-up after the real punch has already landed feels like lag; detect "out" from the fist growing as it nears the camera); Claude (the readout, and measuring before building).
- **Playtest finding:** the hook doesn't register on a real webcam. Likely cause from the code: a hook must be more sideways than forward, and a real hook arcs forward too, with noisy model depth. Not yet confirmed with numbers.
- **What happened:** `armMeasures` in `client/input/camera/box-pose.ts` (fist size from wrist to index and pinky knuckles in shoulder widths, elbow angle on screen and with depth, depth in front of the shoulder, reach on screen, height) and a readout under the camera preview, only with `?debug` in the address, showing each arm's live value and peak (R resets). Not for players. The game's rules are unchanged until the numbers say which measure separates "in" from "out".
- **Next:** the user boxes with the readout; then ADR 002 (arms in/out, server judges, guard by glove position), the sim, keys, camera, 3D.

## 2026-11-05 22:11 AEDT | playtest + tool | Boxing: screenshots of live numbers didn't work; a recording mode instead

- **Decided by:** user (asked for the recording mode and for the method to be written down); Claude (the design).
- **Finding:** the first readout screenshot showed no live values (the hands were down to take it) and peaks from moments in between, so it said little about the guard. One real number: the model's depth peaked at 3.9 shoulder widths in front, against a real arm's reach of about 1.3, so depth alone looks too noisy for "arm out".
- **What happened:** the `?debug` readout now records: 1-7 picks a move, 3 s countdown, 5 s recorded, then the move's row (median, 10th and 90th percentile per measure and hand, share of frames seen, punches the current detector read) joins a table; C copies it as text. The method is `docs/camera-playtest.md`, reusable for other games' cameras.

## 2026-11-05 22:12 AEDT | decision | Boxing: a seated player's frame ends at mid-chest

- **Decided by:** user (pointed out a seated player's stomach isn't seen); Claude (the change).
- **What happened:** head or body is split at the shoulder line, not the stomach; the low guard is forearms across the chest with gloves below the chin; a body punch is aimed at chest height. If the two guards don't separate on camera, the fallback is one guard that blocks head shots only. `docs/camera-playtest.md` updated.

## 2026-11-05 22:16 AEDT | playtest | Boxing: first real-webcam recording, the pose model alone can't tell a punch

- **Decided by:** user (recorded the 7 moves); Claude (the reading).
- **Data:** `docs/playtest/boxing-2026-11-05-pose-only.txt`, about 25 fps.
- **Findings:**
  - The current detector fires "jab" all the time: 5 while relaxed, 13 while moving without punching, about 10 in each guard. Every one comes from the model's depth, which sits around 3 shoulder widths in front for every move (a real arm reaches about 1.3). This is also why a hook never registered: the depth noise makes every fast hand "forward", so the jab check wins first.
  - Fist size from the pose model barely moves: a jab's high is 0.25-0.26 against 0.22-0.24 for the guards, relaxed and moving. About 1.2x, not the 2x expected. It can't be a threshold.
  - Elbow angle with depth is 120-160 for everything: useless. On screen (2D) it jumps from 3 to 166 within one move: the elbow point is unstable.
  - Height works: a jab's wrist is at +0.13 to +0.19 (above the shoulders), relaxed, body punches and the low guard at -0.07 to -0.33.
  - The high guard read as hands far below the shoulders (-0.96 to -1.47) with straight arms, and the left hand seen only 66%: with the hands in front of the face the model seems to lose them and guess. To check with the user.
- **Outcome:** the pose model's three hand points are too coarse for "arm out". Next to try: the hand model archery already loads (21 points per hand), for the fist's size.

## 2026-11-05 22:18 AEDT | playtest | Boxing: the high guard was misread, not done wrong

- **Decided by:** user (described the guard); Claude (the reading).
- **Finding:** the user's high guard was fists at eye height, one either side of the eyes, the face partly covered: a normal guard. The pose model read the wrists 1 to 1.5 shoulder widths below the shoulders with straight arms, and lost the left hand a third of the time. So with the hands by the face the pose model loses them and guesses the arms are down: it fails in the position boxing needs most. Another reason to try the hand model, which finds hands in the image directly (caveat: it detects palms, and closed fists are harder for it).

## 2026-11-05 22:20 AEDT | change | Boxing: the hand model in the playtest readout

- **Decided by:** user ("yes add the hand model"); Claude (how).
- **What happened:** with `?debug`, boxing's camera also loads the hand model archery uses (21 points per hand). `handMeasures` in `client/input/camera/box-pose.ts` gives each hand's palm size (mean of wrist to index knuckle, wrist to pinky knuckle and across the knuckles, in shoulder widths), its height above the shoulders and its position across. Hands are assigned left or right by which side of the shoulders' middle they are on, not by MediaPipe's handedness label (mirroring or a closed fist can flip it) and not by the pose wrists (lost with the hands by the face). The recorded table gets a HAND MODEL line per hand next to the pose model's. The readout box now scrolls.
- **Why:** the pose model's fist size moved only about 1.2x on a jab and it lost the hands in the high guard. Players without `?debug` don't load the hand model yet: only if the numbers earn it.
- **Cost to watch:** a second model per frame; the recording's fps line will show it (it was about 25).

## 2026-11-05 22:26 AEDT | playtest | Boxing: second recording, with the hand model

- **Decided by:** user (recorded moves 1-7; 8, hook to body, not done); Claude (the reading). Moves renamed to say kind and target (a jab can go to the body: user's point), and "hook to body" added.
- **Data:** `docs/playtest/boxing-2026-11-05-hand-model.txt`. About 24 fps, so the hand model costs little (19-25 fps per move).
- **Findings:**
  - **Guards work with the hand model.** Seen 100% in both guards (the pose model lost a hand a third of the time). Knuckle height above the shoulders: high guard 0.58-0.61, low guard 0.31-0.36, relaxed 0.16-0.19, moving 0.18-0.20. High and low are about 0.27 apart, so two guards look possible. Low vs relaxed (0.15 apart) is the tight pair.
  - **Jab: the fist does grow, but less than hoped.** Each hand's size at rest is steady (left 0.23-0.26, right 0.21-0.24). The 90th percentile during jabs reaches 1.45-1.67x the hand's own guard size to the head and 1.38-1.5x to the body; moving without punching stays at or under 1.25x. A threshold relative to each hand's own size (about 1.35x) separates them, but the margin is thin, and a 90th percentile of a whole recording hides each punch's own peak. The hand is also lost on 9-19% of jab frames, probably at full extension.
  - **Hook: the hand model loses the hand 75% of the time** (a sideways fist, blur). The pose wrist does see it: reach from the shoulder on screen 0.96-1.29 in hooks against 0.25-0.73 moving. So a hook would come from the pose model and a jab from the hand model.
  - **The current detector is broken:** 13 "jabs" while relaxed, 13 in the high guard, 14 while moving. It must not stay on for players.
- **Next (proposed):** record each punch's own peak, and show a trial detector's verdict live so the user can judge by feel.

## 2026-11-05 22:30 AEDT | change | Boxing: a trial camera detector from the two recordings

- **Decided by:** user ("build the trial detector"); Claude (its rules, from the recorded numbers).
- **What it is:** a first draft of the real detector, on only with `?debug`, where it drives the practice bout in place of the old one (which fired "jabs" all the time). Players without `?debug` still get the old detector until this one is tuned.
- **Rules** (`TrialDetector`, `TRIAL_BOX` in `client/input/camera/box-pose.ts`): jab when the hand model's palm grows past 1.35x that hand's own resting size (rest follows the hand slowly while it's in; re-arms below 1.15x); hook when the pose wrist is more than 0.9 shoulder widths from its shoulder and the hand model has lost that hand or sees it far to the side (re-arms inside 0.6); head if the palm is above 0.4 over the shoulders, else body (a hook's target uses the pose wrist above -0.15, a guess: hooks to the body weren't recorded); high guard with both palms above 0.47, low with both in 0.27-0.47; the guard must hold 3 frames to change; 250 ms between punches from one hand.
- **Limits for now:** the sim has one guard and no target, so in the bout either guard counts as "up" and head or body is only shown. The readout shows the verdict big (orange for a punch, blue for a guard) and each recording lists what the trial detector read.
- **Tests:** `spec/boxing-trial-detector.test.ts` (8, from the recorded shapes: relaxed and moving read nothing, jab head and body, one held jab is one punch, a hook with the hand lost, a pose glitch with the hand seen isn't a hook, the three guard heights, a stray frame doesn't drop the guard; handMeasures sides and heights).

## 2026-11-05 22:33 AEDT | playtest | Boxing: trial detector, first free play

- **Decided by:** user (played it); Claude (the reading).
- **Findings (user):** (1) much laggier than before; (2) keeping one arm up after going from the guard to a punch confuses it; (3) hooks still mostly don't register.
- **Likely causes (Claude, unconfirmed):** (1) either the frame rate (the hand model runs after the pose model on every frame, and the readout rewrites a large text box each frame), or the read itself being late: a jab only counts at 1.35x the fist's size, near full extension. (2) hands are told apart by which side of the body they are on, so a fist crossing the middle swaps left and right; and with one hand left up the guard drops to none. (3) the hook rule needs the hand model to have lost the fist and the pose wrist past 0.9 from its shoulder; real hooks may not reach that.

## 2026-11-05 22:36 AEDT | decision + change | Boxing: choppiness, one arm up is no guard, camera hooks off

- **Decided by:** user ("whole thing is choppy, 1 arm is no guard do that, we can even remove hooks if its a problem and keep it simple"); Claude (how to cut the cost).
- **Choppy:** the whole page, not a late read. Running the pose and hand models one after the other on every frame, and rewriting the readout's text every frame. Now: `startPose` takes an optional `poseEvery` (only boxing's debug path sets it, to 3: the hands come from the hand model and the shoulders move slowly, so the pose model runs every third frame); the readout's text is redrawn 5 times a second. Tennis, archery and track are unchanged (default 1).
- **One arm up is no guard:** already how the trial detector worked (both palms must be up); now pinned by tests, including a jab from the guard with the other arm left up.
- **Hooks off for the camera:** `TRIAL_BOX.hooks = false`, so the camera throws jabs only; keys and buttons still hook. The hook rule stays behind the flag with its test, in case a later recording finds a signal.
- **Tests:** `spec/boxing-trial-detector.test.ts` 11 (hooks off, hooks on behind the flag, one arm up, the arm left up after a jab).

## 2026-11-05 22:58 AEDT | decision + playtest | Boxing: jabs only for everyone; the one-arm guard is better; 22 fps

- **Decided by:** user ("can just do jabs for now", "the 1 arm behaviour is better"); Claude (proposed jabs only for everyone, so a keyboard player's hook can't out-hit a camera player who can't throw one).
- **Playtest:** with the pose model every third frame and the readout redrawn 5 times a second, the camera runs at 22 fps and the user found it fine. Keeping one arm up after a jab no longer confuses it.
- **Decision:** boxing is jabs only, for keys, buttons, camera and bot. Not yet built. Next: the 3D ring and movement, discussed before building.

## 2026-11-05 23:03 AEDT | decision | Boxing: the rework plan, ADR 002

- **Decided by:** user ("lets do a only", movement is the slip, not moving around the ring; "everything sounds good, you can launch subagents"; log first); Claude (the order and the ADR).
- **What happened:** `docs/adr/002-boxing-judged-at-landing.md` records the design: jabs only with a head or body target; high and low guards and a slip, all states the server checks on the landing tick; clients send what they did, never a hit; no lag compensation for now. `tasks/30-boxing.md` lists the rework in order (jabs only, guards, slip, 3D, the camera detector for everyone). CLAUDE.md's boxing rule notes the rework until each piece lands.
- **Full e2e before this:** 197 passed, 1 failed: tennis's `layout.e2e.ts` "joins by invite" on desktop at load 9.5; it passed 6 of 6 alone (`--repeat-each=3`). Not boxing's code; the known load flake.
- **How it will be built:** the sim rework (jabs, target, guards, slip, bot, keys, specs) and the 3D view by separate agents in their own worktrees, the view against the sim's agreed snapshot shape; Claude merges, runs `pnpm check` and the full e2e, and the user playtests.

## 2026-11-05 23:30 AEDT | change | Boxing: sim, bot, inputs and keys follow ADR 002

- **Decided by:** user for the rules (ADR 002 and task 30's contract: jabs only with a head or body target, high/low/no guard, a slip that the server starts and ends, judged on the landing tick, blocked = BLOCKED_SHARE); agent for each choice listed below.
- **What happened:** `shared/games/boxing/sim.ts` is jabs only: a punch carries `hand` and `target`, the guard is `"high"|"low"|null`, a `slip` input starts a window the sim ends. `judge(target, guard, slipping)` decides on the landing tick: a head jab on a slipping boxer is slipped (0), a head jab on a high guard or a body jab on a low guard is blocked, else clean. `asInput`, `parseClientMsg` and the room accept exactly the three contract inputs. The bot guards the height of the jab it sees or slips a head jab. Keys J/K/Space/L/A/D and six buttons in the 2D view, which draws the guard height, the slip's lean and the outcome word. The camera sends the new shapes (`cameraBoxing`).
- **Agent's choices (not fixed by the ADR or contract):**
  - Numbers, all guesses for the playtest: jab damage 6, wind-up 150 ms (9 ticks), slip window 400 ms (24 ticks), slip cooldown 1 s from the slip's start, health 500, BLOCKED_SHARE 0.2 (so blocked = 1), recovery 150 ms and the punch cap unchanged.
  - A slip can't start with a guard up (simplest); raising a guard ends a slip; dropping a guard leaves one alone. A refused slip doesn't start the cooldown.
  - A punch thrown while slipping is refused like one thrown under a guard: it isn't counted against the cap.
  - The bell ends a slip; the break resets the slip cooldown (as it already reset each hand's recovery). The guard can still change in the break, a slip can't start.
  - `slipped` (head jabs this boxer made miss) counts on the defender; a slipped jab isn't counted in the thrower's `landed`.
  - Any extra field on a boxing message drops the whole message (stricter than before, where extras were stripped), in `asInput` and in `parseClientMsg`. So the adapter's `botInputs` now returns the wire shape without `seat`, which the room adds back.
  - Bot: reacts 7-16 ticks after a throw (the jab lands at 9, so it defends about a fifth of the jabs it notices), ignores 25%, slips 35% of the head jabs it reacts to (guards high if it can't slip), jabs to the head 75% against an open boxer, 25% against a high guard, 90% against a low one.
  - Keys: a held guard key or button beats the camera's guard; with both Space and L held, the last pressed wins and letting go falls back to the other.
  - Camera without `?debug`: the old tracker's jab goes to the head, its guard is the high guard, its hooks are dropped; the debug trial detector's guard and target go straight through, hooks dropped. No camera slip (needs a recording first). The panel's copy no longer mentions hooks.
- **Tests:** `spec/boxing-sim.test.ts` (every guard x target x slip, judged at landing, the slip window ending, the cooldown, no punching while slipping, no slip under a guard, the cap, asInput refusing old, malformed and extra-field inputs, the bot's guard height, its target mix, beatable, determinism, bout length), `spec/boxing-room.test.ts` (the protocol's three shapes, a slip through the room), `spec/boxing-practice.test.ts`, `spec/boxing-box-pose.test.ts` (`cameraBoxing`), `e2e/boxing.e2e.ts` (keys, the six buttons at both viewports). `pnpm check`: 43 files, 699 tests passed; `e2e/boxing`: 14 passed.
- **Why:** the user's rework (ADR 002), so standing in one guard loses to the other target and defence is a reaction judged by the server.

## 2026-11-06 00:13 AEDT | milestone | Boxing: the ADR 002 rules merged into boxing-30

- **Decided by:** user (the rules, ADR 002); agent (the choices listed in its entry above); Claude (reviewed and merged).
- **What happened:** `boxing-rules` (7f371a4, 71259b7) fast-forwarded into `boxing-30`. Claude read the shared changes: `shared/protocol.ts`, `server/room.ts` and `server/index.ts` only change boxing's three messages; the stricter "an extra field drops the whole message" applies to those three only.
- **Verification on the merged branch:** `pnpm check` 43 files, 699 tests, exit 0; full `pnpm e2e --workers=1` at both viewports: 194 passed, 4 failed (exit 1), all tennis and none touching boxing: `aid.e2e.ts:44`, `camera.e2e.ts:165` (the trail test CLAUDE.md names as load-sensitive), `layout.e2e.ts:175`, `training.e2e.ts:245`, at load average 14 with the 3D agent rendering alongside. Rerun alone: 8 of 8 passed, exit 0. Claude first wrote "exit 0" here before reading the summary; corrected. :8999 rebuilt for the user to play the new rules in 2D.
- **Open for the user:** the agent's own choices (no slip with a guard up, raising a guard ends a slip, the break resets the slip cooldown, an extra field drops the message) are reversible and await an OK.
## 2026-11-06 00:15 AEDT | milestone | Boxing: the 3D scene, built apart from the sim (task 30)

- **Decided by:** user (3D, a first-person-ish view); agent (everything below).
- **What happened:** a self-contained scene in `client/games/boxing/`, not wired in yet: `scene-model.ts` (the small view model the scene draws, `RingView` / `BoxerView`, so it never reads the sim snapshot while the sim is rewritten), `ring.ts` (raised canvas and apron, corner pads blue/red/white/white, three ropes a side, a truss of lamps, a dark arena with six rows of an instanced crowd; static parts merged into two meshes with tennis's `Painter`), `boxer.ts` (the tennis character built without its arms, plus two arms solved to the glove and rounded gloves in the seat colour), `boxer-pose.ts` (pure: guard, slip, jab along `t`, hit reactions, KO), `scene.ts` (`createBoxingScene(canvas)`).
- **Agent's choices:** a jab's `t` runs 0 to 1 out (landing at 1) and 1 to 2 back, and the jabbing boxer steps in 0.24 m. First person hides your own body and head and draws your guard a little wider and lower per guard, so your gloves frame the foe instead of covering their face; the pose itself is unchanged. A portrait screen pulls the first-person camera back and widens it; the spectator camera centres on a knocked-down boxer so they stay in frame. Boxers stand 1.35 m apart.
- **`character.ts`:** `makePlayer(look, racket, { arms: false })` and a `parts` field; `stadium.ts` exports `Painter`. Tennis passes no option. A before/after screenshot of tennis practice at 1080p differs only where the ball and the bot had moved.
- **Checks:** `spec/boxing-pose.test.ts` (7, pure); `stroke` and `look` specs still pass. Screenshots at both viewports in `docs/boxing-3d-*.png`. Software rendering (SwiftShader) at 1920x1080: about 9 fps for the boxing scene against about 6 for tennis practice on the same machine, 23 fps at 390x844.

## 2026-11-06 00:26 AEDT | milestone | Boxing: the 3D ring merged and wired in

- **Decided by:** user (3D, first person, slip only); agent (the scene's choices in its entry above); Claude (review, merge, wiring).
- **What happened:** `boxing-3d` merged (only the append-only devlog conflicted; both sides kept). Claude reviewed its tennis change: `makePlayer` gains an optional `{ arms: false }` and a `parts` field, `Painter` is exported; tennis passes no option, so it builds as before (the agent compared tennis screenshots before and after). `view.ts` now draws the 3D scene instead of the 2D canvas: each frame it turns the snapshot into a `RingView` (a jab's `t` from the server's thrown and landing ticks, its return kept in the view since the snapshot drops a landed jab; a hit's age from when the view saw it; each seat's look from the lobby; KO from the result). Every `data-*` hook the e2e reads is unchanged.
- **Looked at:** screenshots at 1920x1080 and 390x844 with the HUD and buttons: your gloves frame the bottom, the foe faces you, no horizontal scroll.
- **Known from the agent, unfixed:** the low guard sits only a little below the high guard in first person; a blocked jab's shake is small; faces don't change when hurt.
- **Tests:** `pnpm check` 44 files, 706 tests, exit 0; `pnpm e2e --workers=1 e2e/boxing` 14 passed, exit 0.

## 2026-11-06 00:29 AEDT | playtest | Boxing 3D, first camera play without ?debug

- **Decided by:** user (played it); Claude (the reading).
- **Findings:** (1) tilting does nothing: expected, the camera slip isn't built until a lean is recorded (A and D slip); (2) holding the hands up as a guard keeps registering punches, not the guard. Played without `?debug`, so this was the old `BoxTracker`, which the first recording already showed fires "jabs" from depth noise in any pose.
- **Next:** the trial detector becomes the default for everyone, and the old one leaves the game path.

## 2026-11-06 00:36 AEDT | bug fix | Boxing: the camera's guard read as jabs; the trial detector is now everyone's

- **Decided by:** user (found it: "if i hold my hands up as a guard, it just keeps registering punches"; confirmed no `?debug`); Claude (the fix).
- **Cause:** without `?debug` the panel still used the old `BoxTracker`, whose jab is the pose model's depth moving fast. Fed a held guard shaped like the user's recording (depth about 3 shoulder widths, wobbling), it reads 17 jabs in 5 s.
- **Fix:** `box-camera.ts` runs the `TrialDetector` for everyone, with the hand model always loaded and the pose model every third frame; the `?debug` readout now only shows and records what it reads. The old tracker stays in `box-pose.ts` with its spec but is off the game path.
- **Tests:** `spec/boxing-trial-detector.test.ts`: raising both hands from relaxed into a high guard reads the guard and no jab; and a check that the panel runs `TrialDetector` with hands on, never `new BoxTracker(`, which fails on the old code. `pnpm check` 44 files, 708 tests, exit 0; `pnpm e2e --workers=1 e2e/boxing` 14 passed, exit 0.
- **Still open:** tilting does nothing (no camera slip until a lean is recorded).

## 2026-11-06 00:47 AEDT | decision + change | Boxing: tilting slips, and a slip works with your hands up

- **Decided by:** user ("tilting isnt moving me"; chose "Slip with guard up" over keeping "a slip drops the guard"); Claude (the camera slip and its first numbers).
- **Rule change:** the rules agent had made a slip refuse to start with a guard up, and raising a guard end one. On camera a boxer leans with their hands up, so tilting would never have slipped. Now a slip starts with any guard and a guard change leaves it alone; while slipping a head jab misses and a body jab meets the guard as usual. The bot slips with its guard up too. ADR 002 and CLAUDE.md updated.
- **Camera slip:** `SlipDetector` in `client/input/camera/box-pose.ts`: the shoulder line's tilt (the same `bodyFrame` tennis uses, whose sign doesn't depend on mirroring), neutral from the median of the first second of tracking, 8 degrees past neutral fires one slip that way, back within 4 re-arms. First guesses from tennis's playtested tilt (dead zone 3, full 11). The camera sends the same `slip` message A and D do. The `?debug` readout shows the live tilt from neutral, and move 9 records a lean.
- **Tests:** `spec/boxing-sim.test.ts` (a slip starts with a guard up and survives a guard change; judge with a guard while slipping), `spec/boxing-trial-detector.test.ts` (neutral from the first second, one slip per lean each way, a held lean is one slip, a small sway is none, lost shoulders, the panel sends it). `pnpm check` 44 files, 715 tests, exit 0; `pnpm e2e --workers=1 e2e/boxing` 14 passed, exit 0.

## 2026-11-06 01:00 AEDT | decision + change | Boxing: the slip is a held lean

- **Decided by:** user ("the slip doesnt stay slipped in that position, it just comes back to center"; chose "stays leaned, protects the whole time" over a brief or a time-limited protection); Claude (the build).
- **Finding:** the slip was a timed event (a 400 ms window, then a 1 s cooldown), so the boxer came back to centre while the player still leaned.
- **Rule change:** `slip` is now a state like the guard: `{ t: "slip", side: "left"|"right"|null }`, sent when it changes; the boxer leans until null. Head jabs miss the whole time it is held; no punching while leaning. The window and cooldown constants are gone. The bot leans while it sees a head jab coming and straightens once nothing is.
- **Risk the user accepted:** leaning with a low guard blocks every jab (head jabs miss, body jabs are blocked), and the only cost is not punching. If bouts stall in play, the alternatives offered were protection only at the start of a lean, or up to about 1.5 s.
- **Input:** hold A or D (and the Slip buttons) to lean, let go to straighten; a held key or button outranks the camera. Camera: `SlipDetector` holds the lean while the shoulders stay past 4 degrees after crossing 8; swinging past centre to the other side switches it.
- **Tests:** `spec/boxing-sim.test.ts` (a lean lasts until null, protects from head jabs while held, switching sides, no punching while leaning, a lean let go before landing doesn't save you); `spec/boxing-trial-detector.test.ts` (held lean, the 4-8 degree band doesn't flicker, switching, lost frames keep it); `e2e/boxing.e2e.ts` (A held 1.5 s stays leaned, let go comes back; the Slip button the same). `pnpm check` 44 files, 717 tests, exit 0; boxing e2e 14 passed, exit 0.

## 2026-11-06 21:08 AEDT | playtest | Boxing after the push: leans too easily, punches register inconsistently, the gap between punches feels long

- **Decided by:** user (played it; asked for a separate agent to find out why: "in another agent, lets figure out the issues with boxing"); Claude (the hypotheses below, unconfirmed).
- **Findings (user):** (1) "it keeps leaning to either side too easily"; (2) "the punches are registering inconsistently"; (3) "the delay between punches feels long".
- **Hypotheses, not verified:** (1) `SlipDetector` leans past 8 degrees and holds until within 4, from a neutral learned only in the first second, on raw tilt from a pose model that now runs every third frame; a jab or a guard raise may twist the shoulders enough to lean. (2) A lean also stops punching in the sim (`throwPunch` returns "slipping"), so an accidental lean would silently eat jabs; the jab is also the hand model's palm growing 1.35x its own resting size, and the hand model lost the fist on 9 to 19 percent of jab frames in the second recording. (3) A hand can't throw again for the 150 ms wind-up plus 150 ms recovery, the cap is 4 punches a second with a burst of 2, the camera detector waits 250 ms and for the fist to come back within 1.15x, and the view alternates hands without retrying the other when one is busy.
- **Plan:** measure before changing anything (a per-frame trace in the `?debug` recorder, a sim-level measurement of the delay), change only what the measurement proves, keep ADR 002's rules as they are.

## 2026-11-07 21:17 AEDT | decision + change | Review skills for game ideas and built games

- **Decided by:** user (skills to review game ideas and built games against the project's aims and the spec; both an idea and a build review; results reported in the chat, logged only when asked; the build review judges whether the camera controls are intuitive without playing on a webcam; the keyboard path is not the focus; the persona ideas: someone who reads, someone who doesn't, a casual gamer, wifi lag, smoothness); Claude (the criteria, how the skills work, the merging of personas for cost).
- **What:** `docs/game-review-criteria.md` (the idea in one line, the marker's reading order, criteria A to F, five personas, verdicts) and two project skills: `.claude/skills/review-game-idea/` (before building: the moves, the persona reactions, server ownership and cost, recordings to make first; build / build with changes / drop) and `.claude/skills/review-game-build/` (per camera control: what the code needs in body terms, the real move, what the screen says, what the personas would do, false and missed reads, clashes, feedback; asks for a `?debug` recording where the evidence runs out; intuitive / fix the instructions / change controls). `.gitignore` now tracks `.claude/skills/` only; settings (the API key) and worktrees stay local.
- **Personas:** the skipper and the reader are fresh agents given only what that person takes in, never the code; tight space, patchy wifi and smoothness are worked out by the reviewer from the code, so a review costs two small agents.
- **Thrown away:** the first version had fresh agents play the running app through Playwright on keys, plus a 5-room server load test. Dropped because no agent can use a webcam (Chrome's fake camera shows a test pattern, not a person), so it only tested the keyboard path, which the user doesn't treat as the focus. Also dropped the phone, spectator and marker personas, which belonged to it.
- **Server figures taken (user ran flyctl and curl):** deploy 11, one shared-cpu-1x 256 MB machine in syd, auto-stops; idle RSS 106 MB (41%), cold start about 4 s, warm about 1 s. Not yet measured under load.
- **Commits:** 54cc21d, 0970b31, 6059f31. Not run on a game yet.

## 2026-11-07 23:16 AEDT | review | Basketball shoot-off: game-idea review, "build with changes" (nothing built yet)

- **Decided by:** user (the design: shoot-off, 5 spots, outdoor court, real rim and backboard physics, new home-screen tile, one shot style with no setting, stand about 1 m back, the review run); Claude (the review and the changes below); agent (two persona agents, the reader and the skipper). The changes are proposals until the user answers.
- **Design as reviewed:** 5 spots in an arc, 4.6 m to 9 m, turn by turn, one shot each per spot, the first shooter swaps each spot; 2 points inside the arc, 3 beyond, the last spot a 4-point money ball, +1 for a swish; a tie goes to sudden death from the deep spot; 15 s shot clock. The server owns the ball (seeded rim and backboard physics); the client sends one `shoot {power, aim, ts}`. Camera: no setting, any fast hand rise (one hand or both, either hand) is a shot, wrist speed sets the power, the hands' sideways offset from the shoulders sets the aim, one standard animation. Keys: hold Space or a Shoot button, a power bar fills and falls, release shoots. Formats "shootout" (rated) and "unlimited" (unrated).
- **Method:** `review-game-idea` run twice. The first run was by hand (the skill had not loaded in that session) and found A5 failing: nothing showed whether a miss was too soft or too hard. The second run used the real skill with fresh reader and skipper agents, shown the screen wording revised for that finding (hold at the chin, no jumping, power bar after each shot, floor arrow).
- **Verdict:** build with changes. The rules pass (server owns the shot, closed message, short match, light on the server, turns need no fast reaction). The camera push is the risk and can't be tuned without a recording.
- **What the personas said:** both still wanted to jump and push hard ("Kinect taught me big equals good"), both swayed 30-40 cm to aim, and neither knew whether the shot timer waited on them. The power bar fixed the first run's A5 finding: they would learn the push from "Too hard" and "Just right". The reader asked twice whether to push straight up or forward, and whether a sideways drift during the push changes the aim.
- **Criteria:** A1, A2 (2 inputs; boxing has 5), A5, B, C (one closed message, one shot a turn, seeded), D, E pass. Concerns: A3 (straight up or forward), A4 (aiming sway could read as a push), A6 (unproven at 1 m or seated), F1 (every number a guess). C4 needs a line: the server's own clock plus a small grace for the 15 s clock.
- **Changes proposed before building:**
  1. Say "no need to jump" on screen, and give a clear ready cue (hands glow, the clock starts).
  2. Say "push straight up, not forward"; show "Their shot, watch" off-turn.
  3. Keep the power bar with the spot's sweet zone after each shot ("Too soft / Just right / Too hard").
  4. Keep the floor arrow and make it visibly follow the hands in the setup step.
  5. Lock the aim when the push starts, so a sideways drift can't change it (the one change to the design).
  6. Make the sweet zone wider on the near spots so first shots go in.
  7. State in the UI that the +1 swish stacks on any basket, the money ball included.
- **Tight space:** a push read between chin and forehead should stay in frame at 1 m and seated, unproven. The pose model must run every frame (a push lasts 0.2-0.4 s), not boxing's every third.
- **Recordings to make first** (`docs/camera-playtest.md`, 1 m standing and seated): soft, medium and hard pushes with two hands; the same one-handed, each side; and "moving, no shot" (aiming sway, scratching, cheering), which must stay below the shot threshold. Boxing's `?debug` recorder can show today whether the hands stay tracked up to the forehead; it doesn't record push speed, so basketball needs its own recorder.
- **Open:** the user's answers on changes 1-7, and whether basketball is worth starting about two days before the noon Monday 9 Nov deadline, with boxing's fixes, the README (task 10) and ship (task 11) still open. No ADR, task file or code yet.

## 2026-11-07 23:26 AEDT | decision | Basketball: answers on the review's changes

- **Decided by:** user (each change below); Claude (the reasons offered).
- **Push up and towards the hoop** (change 2, user: "dont you push a little forward in basketball? straight up might be awkward"): the wording becomes "Push up and towards the hoop, like a real shot. No need to jump." The camera reads the rise of the wrists against the shoulders, which a forward-and-up push still has; a push that is nearly all forward (a chest pass) reads as soft, and the power bar shows it. The recordings use up-and-forward pushes.
- **No hand-widened sweet zone** (change 6, user: "wouldnt being closer give the same effect?"): yes, a nearer shot needs a slower ball, so the same push error moves it fewer centimetres and the same hoop takes a wider range of pushes. The server works each spot's sweet zone out from its own physics and the bar draws that; widen by hand only if a playtest shows first shots still miss.
- **Ready position at the chest** (user, over Claude's proposal of the chin): "we can do chest, it should be fine". Risk noted: seated close, the frame can end around mid-chest. If the hands aren't seen, the screen asks to raise them a little; the push itself is read as the wrists pass the face either way.
- **Still to confirm:** changes 1, 3, 4, 5 (aim locks when the push starts) and 7, as listed in the review entry above.

## 2026-11-07 23:28 AEDT | decision | Basketball: changes accepted; ADR 003 and task 32 written

- **Decided by:** user ("yes accept the rest, write the adr and task file": changes 1, 3, 4, 5 and 7 as listed); Claude (the ADR's details the user hasn't seen yet, listed in task 32 under "Claude's choices": the `set`/`aim`/`shoot` messages, the clock starting 5 s in if no `set`, a late shot counting within the round trip capped at 150 ms, no random scatter, the spot names, sudden death's alternating first shooter).
- **Written:** `docs/adr/003-basketball-shoot-off.md`, `tasks/32-basketball.md` (rules agent first, then the scene and camera agents in parallel, then integration), and the row in `tasks/00-overview.md`. No agent started.

## 2026-11-07 23:50 AEDT | decision + change | Agents get their own port and data folder; e2e runs on the laptop's GPU

- **Decided by:** user (asked how to keep agents' tests from clashing, whether e2e could run outside WSL's CPU drawing, then "go ahead with all three"); Claude (the port plan, the measurement, the switch).
- **Ports:** the tests default to `localhost:8080` (`APP_URL`) and Playwright reuses a running server, so an agent in a worktree would test the user's dev server on `main`, not its own code. CLAUDE.md now gives each agent a port (8201-8298, integration 8299) and a `DATA_DIR`, and says to always set `APP_URL`.
- **Finding:** the slow e2e wasn't for want of a GPU (the laptop has an RTX 5060 and WSL sees it); `playwright.config.ts` forced SwiftShader, CPU drawing. Headless Chrome in WSL won't use the GPU with any flag tried (it falls back to SwiftShader or llvmpipe); a headed browser through WSLg with Mesa's D3D12 driver reaches the NVIDIA card.
- **Measured** (`e2e/boxing` + `e2e/stroke`, one worker): SwiftShader 162 s, GPU 91 s, both 26/26. With 4 workers over boxing, stroke, aid and camera: SwiftShader 239 s and 3 of 48 failed (the stroke label and camera tests timing out, the frame-rate starvation CLAUDE.md warned of); GPU 72 s, 48/48.
- **Change:** `E2E_GPU=1` in `playwright.config.ts` swaps in the GPU flags and a headed browser; `pnpm e2e:gpu` sets it with the Mesa variables. Plain `pnpm e2e` is unchanged (SwiftShader); CI doesn't run e2e. CLAUDE.md: up to 4 e2e runs at once on the GPU, `--workers=1` and one run at a time on SwiftShader.
- **Cost:** the GPU runs open browser windows on the desktop while they run.

## 2026-11-08 00:06 AEDT | review + decision | Bowling: game-idea review and decisions; ADR 004, task 29 rewritten

- **Decided by:** user (stand and move the camera so the hips show, "your arm wouldn't be below your knees"; spin kept simple; a partial guide; indoor alley; build without task 28; "yes to all"; then aim across the picture and allowing steps and crouches on Claude's advice, "sounds good"; bowling runs in parallel with basketball); Claude (the review and the recommendations); agent (the reader and skipper personas).
- **Design as reviewed:** 5 frames of real ten-pin scoring, alternate frames, a tie bowls another frame, 20 s clock. The server rolls the ball (straight, then bending by spin over the last third) and the pins (2D circles), no random scatter. Camera: the full underarm swing with the hips in view; speed from the wrist through the bottom; aim from the hand; spin from a sideways sweep at release. Keys: start spot, spin, hold Space for power. An arrow for the first third of the lane; the last ball's path stays drawn.
- **Verdict:** build with changes. Both personas would play again ("bowling is the best thing in Wii Sports"); the server owns every pin. The real move fights the camera: the reader stepped, crouched, twisted the wrist, and asked "when does the ball actually leave my hand?"; both would walk to aim; the skipper thought the arrow aims itself and swept for curve while the ball rolled.
- **Criteria:** A1, A2 (3 inputs, curve optional), B, C, D, E pass; A3 to A6 concerns; the release undefined failed as written; C4 needs the late-throw line; F1 open.
- **Changes accepted:** plain words ("Your turn"); a hips silhouette; the arrow follows the hand in the setup step; the release is the wrist passing the hip going forward, with the character copying the arm (no backswing needed); the swing measured against the shoulders so steps and crouches are allowed; curve read only about 0.15 s around the release; the speed and curve read shown after each ball; aim from the hand's position across the whole picture, so walking works too.
- **Written:** `docs/adr/004-bowling.md`; `tasks/29-bowling.md` rewritten (rules agent first, then scene and camera in parallel; ten recordings for the user); the overview row. Next: the bowling rules agent on port 8202.

## 2026-11-08 00:22 AEDT | decision | Bowling: a tie asks both players, draw or a tie frame

- **Decided by:** user ("keep the extra tie frame - but have the players decide draw or not - even if one person says draw, its a draw, if they continue then the extra frame"); Claude (the 15 s vote clock with no choice counting as draw, the bot always continuing, the `tie` message).
- **Context:** asked how Wii Sports handles it; Claude believed (unverified) Wii Sports leaves a tie as a tie, where ADR 004 always bowled a tie frame.
- **Change:** ADR 004 and task 29 updated; the bowling rules agent, mid-build, was sent the rule (a "tie-vote" phase, a draw recorded and rated as boxing's).

## 2026-11-08 00:23 AEDT | process | Agents running and what Claude sent them

- **Decided by:** user (asked that what Claude sends to agents is logged too); Claude (the briefs and messages).
- **Basketball rules agent** (Opus 5.5, worktree, port 8201, branch `basketball-rules`): brief was task 32's item 1 against ADR 003, archery as the pattern, the Agents port rule, no client code, report the snapshot and message shapes and the make windows. Finished green (`pnpm check` 764 tests, exit 0; `e2e/home` 32 passed), commit 02e0c92. It found and fixed the bot never shooting in a room (its inputs carried `seat`, which the closed `asInput` dropped), with a test.
- **Basketball scene agent** (port 8203, branch `basketball-scene` from `basketball-rules`) and **camera agent** (port 8204, branch `basketball-camera`), started together. Claude fixed the interface between them in both briefs (`createShootCamera(view, button, chip, { set, aim, shoot, pause })` returning `{ on, state, setTurn, dispose }`): the scene agent wires it against a stub, the camera agent's file replaces the stub at merge, so they can build in parallel without touching each other's files. Both told to run e2e with `pnpm e2e:gpu --workers=2`.
- **Bowling rules agent** (port 8202, branch `bowling-rules`): brief was task 29's item 1 against ADR 004, keeping its registry, CLAUDE.md and devlog edits small since basketball touches the same files, and to report the strike rates (pocket at speed, straight vs curving, slow ball). Mid-build Claude sent it the user's tie rule (a "tie-vote" phase, `{ t: "tie", choice }`, either draw ends it as a rated draw, both continue bowls a tie frame, 15 s clock with no vote as draw, the bot continues, the specs to add).
- **Persona agents** (the reader and the skipper, two each for basketball's two review runs and for bowling's): told not to read any file, given only the screen wording or the button labels; their answers are in the review entries.
- **Why logged:** the briefs are where Claude's own choices enter the build (interfaces, ports, what to test); the user wants them visible, not only the agents' results.

## 2026-11-08 00:39 AEDT | milestone | Basketball camera agent finished (branch basketball-camera, c709077)

- **Decided by:** agent (the detector and its numbers, all first guesses); Claude (accepting it for the merge).
- **Result:** `pnpm check` 48 files, 791 tests, exit 0 (27 new in `spec/basketball-shoot-pose.test.ts`); `e2e/camera` + `e2e/home` 46 passed, exit 0 (plain `pnpm e2e`: its branch predates `e2e:gpu`).
- **Agent's addition beyond the brief:** a hand must rest in the chest zone 200 ms before a push counts, because a wave up from the hip read as a shot. Told to the user; theirs to keep or drop.
- **Not yet checked:** the panel has never run in a browser (no view until the scene branch is merged); every number waits on the user's eight recordings.

## 2026-11-08 00:51 AEDT | milestone + process | Bowling rules agent finished; bowling scene and camera agents started

- **Decided by:** agent (the physics and its numbers, first guesses); Claude (the next briefs); user (the open question below is theirs).
- **Rules result** (branch `bowling-rules`, 24135c1): `pnpm check` 47 files, 776 tests, exit 0; `e2e:gpu e2e/home` 32 passed, exit 0. The tie vote built as the user asked. Measured: a centred pocket ball with spin strikes at every speed 0.225-1; over 44 throws a straight ball strikes 5, spin 0.6 strikes 7, full spin 28 (a straight ball into the exact pocket always leaves the 10 pin); a slow ball (0.1) knocks 5; head-on leaves the 4-6 split family; the bot averages 74 of 150 with 5% strikes.
- **Agent's choices:** the hook is per metre rolled, not per second (slow balls had hooked into the gutter), speed 2-10 m/s, 12 substeps, the pocket 8 cm off the head pin's line, "game" a new room format.
- **Open, for the user:** a voted draw between two accounts is stored `rated = 1` but moves no rating (ratings only move with a winner; boxing's draw is the same). Half a point each would be a change in `server/ratings.ts`.
- **Merge note from the agent:** basketball and bowling both added the bare `{t:"aim",aim}` message; the server routes it to `room.hoop` on one branch and `room.bowl` on the other, so integration must route it by the room's game.
- **Sent:** a bowling scene agent (port 8205, branch `bowling-scene`) and a bowling camera agent (port 8206, branch `bowling-camera`), both from `bowling-rules`, with the fixed interface `createBowlCamera(view, button, chip, { aim, throw, pause })` returning `{ on, state, setTurn, dispose }` (the scene uses a stub until the merge). The scene brief includes the tie-vote panel (Draw / Continue, the 15 s clock, the other player's choice); the camera brief points at basketball's camera branch as the pattern to follow.

## 2026-11-08 01:22 AEDT | milestone | Bowling camera agent finished (branch bowling-camera, 8806e09)

- **Decided by:** agent (the detector and its numbers, all first guesses); Claude (accepting it for the merge).
- **Result:** `pnpm check` 48 files, 802 tests, exit 0 (26 new in `spec/bowling-bowl-pose.test.ts`); `e2e:gpu e2e/camera e2e/home` 46 passed, exit 0. The agent broke three rules one at a time to check each test fails without it.
- **Finding:** from the front, a backswing also rises past the hip line at about the forward swing's speed. So a rise past the hip is the release only if the arm came down through that line within 600 ms before it (the bottom of the swing), or the model's depth puts the wrist 0.3 shoulder widths in front of the hips; a rise with the wrist behind the hips never counts. If the pose model's depth proves noisy, as boxing's recordings found, the pendulum rule works alone.
- **Not yet checked:** never run with a person on camera (no view until the scene merges); the ten recordings are the user's.

## 2026-11-08 02:20 AEDT | decision + process | Basketball: a tie asks both players, like bowling

- **Decided by:** user ("for basketball, making it like bowling for the tie thing - just add a menu that pops up"); Claude (the details copied from bowling: 15 s, no choice counts as draw, the bot continues).
- **Context:** Claude listed how each game ends level today: boxing draws automatically, archery, track and basketball go straight to sudden death or a re-run, tennis can't tie, bowling votes. The user chose the vote for basketball only.
- **Change:** ADR 003 and task 32 updated. A draw is recorded and rated but moves no rating, as boxing's and bowling's (the half-point question is still open with the user).
- **Sent:** the basketball rules agent (resumed, branch `basketball-rules`, port 8201) was told to add the "tie-vote" phase and the `tie` message, copying bowling's parse and dispatch hunks byte for byte so one copy survives the merge, with the same snapshot field (`vote`), and specs. The basketball scene agent (branch `basketball-scene`, still running) was told to add the pop-up (Draw / Continue, the countdown, the other player's choice, D and C keys, no buttons for spectators) against that exact shape, with a local type extension until the merge, and a test that renders it from a snapshot.

## 2026-11-08 02:21 AEDT | decision + process | E2e back to headless: the GPU windows took over the user's screen

- **Decided by:** user ("can you launch the agent browsers in the background, they are taking over my screen"); Claude (the checks and the rule).
- **Checked:** with the NVIDIA GPU, a browser placed off-screen (`--window-position=-32000,-32000`) or started minimised still opened on the visible desktop (WSLg ignores both: window at 73,27 and 1296,37); `--ozone-platform=headless` and headless Chrome fall back to SwiftShader. No virtual display (Xvfb, weston) is installed.
- **Change:** CLAUDE.md: agents run e2e headless (`pnpm e2e --workers=1`, one or two runs at once); `pnpm e2e:gpu` only with the user's OK. The script and the `E2E_GPU` switch stay.
- **Sent:** the basketball scene agent, the bowling scene agent and the basketball rules agent were told to stop any `e2e:gpu` run and use headless from now on.

## 2026-11-08 02:29 AEDT | milestone | Basketball tie vote built on basketball-rules (4126c1c)

- **Decided by:** user (the rule); agent (the build); Claude (the merge note).
- **Result:** `pnpm check` 47 files, 773 tests, exit 0, on port 8201; no e2e (no view on that branch). Either seat's draw ends it as a rated draw with no rating change; both continue plays sudden death from the deep spot, a level round votes again; 15 s, a missing vote counts as draw; the bot continues after 1 s; unlimited never votes. The snapshot gains `vote` and `draw` with bowling's shape and names.
- **Merge note:** `server/index.ts` routes `tie` to `room.hoop()` on this branch and to `room.bowl()` on bowling's; either handler passes it to the room's own game, so integration keeps one route.

## 2026-11-08 02:31 AEDT | decision | Task 31 no longer waits on 28; the user's next ideas

- **Decided by:** user ("yeah mark it like that"; the ideas below); Claude (the reason 31 can go ahead).
- **Task 31:** track and archery looks can use tennis's character and crowd pieces directly, as boxing, basketball and bowling do, with a simple end card until task 28's podium. Task file and overview updated.
- **New ideas from the user, to discuss next:** friends (add, invite to a match), online / away / offline status, a party system (several people together, games stay 1v1, the others spectate; public or invite-only), and a cleaner customisation and looks UI.
- **Parked for later (not now):** removing the leaderboard and Elo for just "matches played", and removing non-default play options (e.g. in tennis), keeping leaning as optional. Written in `tasks/parked.md`.

## 2026-11-08 02:37 AEDT | decision | Social features: no party chat; who plays next has three modes; more look options

- **Decided by:** user (each point below); Claude (the proposals they answered).
- **No party chat** (user): "the point is for friends to play, they can contact each other themselves, the friends list is just ease of invite". So no chat of any kind, neither free text nor preset phrases: nothing to moderate, nothing to store.
- **Who plays next in a party** (user): the leader picks, or chooses "rotate" or "randomise".
- **Customisation** (user): a cleaner UI with more options: clothes, eyewear, smiles, facial hair, eye shape, nose shape and more.
- **Open:** how to tell apart people with the same name when adding friends (Claude: chosen names are already unique ignoring case on the server; guests' pseudonyms aren't chosen, and guests can't be friended).

## 2026-11-08 02:45 AEDT | decision | Names get a 4-digit tag (Name#1234); rotate has two modes

- **Decided by:** user ("we can do the # with the 4 random numbers, and if... all codes with that name are taken notify the user"; rotate as "winner stays on" or "both swap out", both offered); Claude (the options and the trade-off: unique names already worked, a tag lets several people share a name).
- **Rule:** an account's name becomes a chosen name plus a random 4-digit tag, e.g. `Sam#4821`. Several accounts may share a name; the name and tag together are unique. If every tag for that name is taken (all 10,000), the user is told to pick another name. Friendships, ratings and history stay stored by the hidden account id, never the name; the id is never shown.
- **Party modes:** leader picks, winner stays on, both swap out, randomise.
- **Changes this means (not built):** a schema step giving each existing account a tag, the name rules and the unique index (today "unique ignoring case" in CLAUDE.md and `spec/accounts.test.ts`), and everywhere a name is looked up. Where the tag shows (friends list and profile only, or everywhere) is still open.

## 2026-11-08 02:47 AEDT | decision + process | Tasks 33 and 34 written; customisation and track/archery looks agents started

- **Decided by:** user (the tag shows only in the friends list, profile and requests, "in games keep it clean"; a rename keeps the tag if free; demo accounts get fixed tags; "parallelise what you can"); Claude (the task files and the briefs).
- **Task 33** (customisation): more look fields and a cleaner editor; a schema step maps every stored task-18 look to the new shape. **Task 34** (friends, status, parties, name tags): designed, built only if basketball and bowling merge cleanly by Sunday evening.
- **Sent:** a customisation agent (port 8207, branch `customise-33`), and two task-31 agents, track looks (port 8208, branch `track-looks-31`) and archery looks (port 8209, branch `archery-looks-31`). To keep the merge small, the task-31 agents may not edit `client/games/tennis/character.ts` or `shared/look.ts` (the customisation agent owns them); they add the run cycle and the bow pose in their own game folders. All told to run e2e headless (`pnpm e2e --workers=1`) and to take before and after screenshots.

## 2026-11-08 02:53 AEDT | decision | Task 34: proposals accepted; public parties listed to friends; party shown in full in the lobby, compact in a game; live updates on the existing WebSocket

- **Decided by:** user (accounts only, exact Name#tag with no search, status rules, and the privacy rule on logs all accepted; public parties listed by friends; all members shown in the lobby, compact in a game); Claude (the transport: the page's existing WebSocket).
- **Transport:** the page already holds one WebSocket from load (`hello`/`welcome`, then rooms), so friend requests, invites, status and party changes are pushed on it; an invite arrives within about a tick. Polling (the leaderboard's way, once a second) would lag up to its interval and cost a request per tab per second; a second connection or SSE would duplicate what the socket does; LiveView isn't this stack. Adding a friend and friend links are `/api` POSTs like the account routes.
- **Logs:** explained to the user: `server/log.ts` writes JSON lines with a player only as `who`, a per-run keyed hash, never a name, token or cookie (`spec/stats-logging.test.ts`); friends events will follow it (e.g. "friend_request" with two hashes, never "Sam#4821 added Ali#0937").

## 2026-11-08 02:58 AEDT | review | How games reach the screen, and why it's WebSocket push, not polling

- **Decided by:** user (asked whether games poll and whether it's the right approach, and to log it); Claude (checked the code and wrote this). No change made.
- **What the code does** (`server/room.ts`, `client/games/tennis/view.ts`, ADR 001): every page holds one WebSocket. Each room steps its sim at 60 Hz (`TICK_MS`) and pushes the state every second tick (`BROADCAST_EVERY = 2`), 30 a second, to both seats and the spectators. Clients send only inputs with their own timestamp (a swing, a move, a step, a punch, a shot), never a hit or a score. Between snapshots the client runs the shared sim ahead, at most 9 ticks (`MAX_AHEAD_TICKS`), and the next snapshot always wins. Late swings are judged by ADR 001's rewind (at most 150 ms).
- **Why this is right:** (1) push beats polling: the server sends a hit the moment it happens, where polling waits to be asked and costs a request per player per update (30 a second for tennis); (2) the server owns the game, so a client can't claim a hit or score (CLAUDE.md's first rule); (3) running ahead on the client makes it smooth at the screen's frame rate despite the network; (4) one connection serves rooms, spectators and, in task 34, friends and parties.
- **Accepted:** the turn-based games (archery, basketball, bowling) use the same 30 a second though little changes in a turn; the messages are small and one path keeps the room code game-agnostic.
- **On screen vs logs:** names are always shown in full in the game and the friends list; only the server's log file replaces a player with a per-run hash (`who`), as `spec/stats-logging.test.ts` requires.
