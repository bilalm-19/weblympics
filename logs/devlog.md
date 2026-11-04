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
