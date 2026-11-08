# Game and feature rules

Moved out of `CLAUDE.md` on 2026-11-09 (it had grown to 811 lines; see the devlog). Nothing here was reworded: these are the per-game and per-feature rules and numbers, as agents wrote them. `CLAUDE.md` keeps the rules that cut across everything. The specs named in each rule are the real check.

- Scoring is real tennis for everyone (`spec/sim-scoring.test.ts`): one set by
  default, best of three or unlimited, tiebreak at 6-6, two serves per point, no lets.
  The score bar only renders the server's `ScoreState`. The call after a point
  (task 16, `spec/point-call.test.ts`, `e2e/call-banner.e2e.ts`) is worked out
  on each screen from two snapshots: no network message, spectators see it
  too, and it never covers the court or the HUD. Practice never ends
  (a won match starts a new one) and practice-vs-bot is never counted as a match between people
  (`spec/db.test.ts`).
- Rooms (task 4; `spec/lobby.test.ts`, `spec/room-rules.test.ts`,
  `spec/rooms.test.ts`): invite link or room code only, no public list. Two
  seats; a third arrival only spectates (no queue). Spectating (task 24,
  `spec/spectate.test.ts`, `e2e/spectate.e2e.ts`): anyone with the link may
  watch; the watch link (`#/watch/CODE`, `join` with `watch`) always
  spectates, even with a seat free (it only gives a player back their own
  held seat); at most 10 watchers a room (`MAX_WATCHERS`), checked by the
  server, and the 11th, by watch link or by invite with the seats full, gets
  "This match is full of watchers." and stays where they were. Spectators see
  the match, score, names and the watcher count, get no camera, ready or
  controls, and the server ignores every input they send. Phases `waiting ->
  ready-check -> countdown (3 s) -> playing`; each seat's `ready` is the
  server's, the bot is always ready, un-readying cancels the countdown, a
  disconnect before the match frees the seat. The host (first seat) picks one
  set (default), best of three or unlimited before play; a change clears both
  ready flags. Mid-match, a dropped connection holds the seat and pauses for
  30 s ("waiting for <name>", seconds left); the same token reclaims it and a
  3 s countdown resumes play, otherwise the room closes with no result.
  Pressing Leave mid-match ends it with no result. Unlimited has no winner,
  counts points and best rally, ends when someone leaves and is stored
  with no winner. Practice vs bot starts at once. One token may hold both
  seats (two tabs, for testing); its second seat is shown "<name> (2)".
- Accounts (task 17; `spec/accounts.test.ts`, `spec/auth-api.test.ts`,
  `e2e/accounts.e2e.ts`): who you are comes only from HttpOnly cookies the
  server sets (`wl_guest`, a random guest id; `wl_session`, 256 random bits
  with only its hash stored), never from a message. Play never needs an
  account. A guest keeps a server-made pseudonym, can't rename and is never
  ranked. A passkey (`@simplewebauthn`, never hand-rolled)
  claims the guest, keeping its history; an account may choose a name: 3 to
  16 ASCII letters, digits, spaces or `_ . ' -`, not reserved (Bot, Admin,
  the server's pseudonym shape) and passing `obscenity`, all checked on the
  server. Task 34: every account also has a random 4-digit tag (`Sam#4821`);
  several accounts may share a name, but name (ignoring case) and tag
  together are unique (a unique index); all 10,000 tags taken says "pick
  another name"; a rename keeps the tag if it is free under the new name;
  the demo accounts are `Demo One#0001` and `Demo Two#0002`. The tag shows
  only in the friends list, the profile and requests; games, the score bar
  show just the name. Every POST and the WebSocket check Origin;
  challenges are single use and expire in 2 minutes; ceremonies are rate
  limited; no cookie, challenge or credential is logged. Deleting needs a
  fresh passkey check and removes passkeys, sessions, name and look;
  match rows stay with a random tombstone shown as "Deleted player". The two
  demo accounts are locked (no rename, delete or passkey), hidden from the
  board, and reached only from the closed "Dev tools" in the home screen's
  profile panel.
- Friends, status and parties (task 34, `tasks/34-friends-parties.md`;
  `spec/friends-*.test.ts`, `spec/party-*.test.ts`, `e2e/friends-*.e2e.ts`):
  friends are accounts only (a guest is told why: no lasting identity); parties
  are open to guests (user, 2026-11-08, below). Add by the exact
  Name#1234 (no search, no partial matches) or a friend link (random code,
  single use, a day, only its hash stored); the other accepts or declines;
  decline and remove are silent. `/api/friends/*` POSTs check Origin and are
  rate limited. Everything is stored by the hidden player id; no id ever
  reaches a page. Status is worked out live from open sockets, never
  stored past the session: no tab is offline, every tab idle (hidden or no
  input for 5 minutes) is away, else online; a player may appear away or
  appear offline (remembered in that browser, sent with `hello`). Only
  friends see it, with what they're doing (a room's code to watch, a public
  party to join, practice, the home screen; nothing when offline). Requests,
  status, invites and party changes are pushed on the page's one socket
  (`friends`, `party`, `invited`, `notice`), sent whole on every
  (re)connect; no polling. Clients send only `status`, `idle`, `invite`
  {to: Name#1234, friends only} and `party` {act ...}; any extra field drops
  the message whole. Parties (memory only): up to 10 (`MAX_PARTY`, the
  watcher limit), a leader (passes to the longest-standing member), invite
  only by default or public (listed only to the leader's friends), the
  leader's game and who plays next: "pick", "winner" (stays on, loser to the
  back), "swap" (both to the back), "random" (not the pair who just played,
  with four or more). The leader starts a match: a fresh room for the game,
  the next two sit (the room's own ready rules), the rest join as spectators;
  a finished match rotates the order. A member whose last tab closes keeps
  their place for 30 s. Every member, guest or account, gets "Copy party
  link" (`#/party/CODE`): the code is 128 random bits, in memory only, works
  for anyone and several people while the party exists, is refused when the
  party is full ("That party is full (10 of 10).") or has ended, and is
  joined over the socket (a page with no socket yet joins on connect).
  Guests (known only by `wl_guest`, shown by their pseudonym) may create,
  join, lead (game, mode, start) and share a party, under the same leader
  and 30 s rules; inviting by Name#1234, the friends list and "Public to
  friends" stay accounts-only (a guest sees only the link; a public party
  whose crown passes to a guest goes back to invite only;
  `spec/party-social.test.ts`, `e2e/friends-party-guests.e2e.ts`). No chat of any kind (user, 2026-11-08). Logs carry
  only `who` hashes, never a name, tag, code or token.
- Looks (tasks 18 and 33; `spec/look.test.ts`, `e2e/look.e2e.ts`): an
  account's look is fourteen enum values from `shared/look.ts` (top, top
  colour, bottom, bottom colour, skin, hair colour, hair style, headwear,
  eyes, brows, nose, mouth, facial hair, eyewear), checked on the server
  (anything outside the lists, a missing field or any extra field is refused
  and nothing is stored). A dress hides the bottom; tall hair is drawn short
  under a cap or beanie; a hat takes the top's colour. Guests always wear
  their seat's default (seat 1 differs from seat 0). The server puts each
  seat's look in the room state, so both players and spectators see it. The
  demo accounts may change their look (it is how two seats get tested).
  Schema step 7 rewrote every stored task-18 look as `fromTask18` does.
  `makePlayer`/`setLook` still take a task-18 look, and `setLook` never
  shows or hides a part (boxing hides some in first person).
- Tennis, archery (task 22) and track (tasks 26-27, one game with two
  events: the sprint and hurdles) are the games; boxing
  (task 30, a "maybe") is playable on keys, buttons or the camera in a 3D ring;
  basketball (task 32, asked for on 2026-11-07) is playable on keys, the
  mouse and buttons in a city street court; its camera is part 3;
  bowling (task 29, asked for) is playable on keys, buttons or the camera in
  a bowling hall. Add another only when I ask. Each lives in `shared/games/<name>/` and registers in the registry, so
  rooms, lobby and reconnect stay game-agnostic. A game's specs are named
  `spec/<name>-*.test.ts` and `e2e/<name>-*.e2e.ts`.
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
  no winner). Practice runs in the page, cycling levels or on a picked distance
  and wind; nothing sent to the server. Camera: the aiming hand aims, the
  draw is the hands' gap along the shoulders, opening the drawing hand
  shoots (MediaPipe's hand model, fingers' fold in 3D); with no hand read a
  fast snap shoots; a slow closed return cancels. A fixed lens, so the board
  shrinks with distance.
- Track (task 26; `spec/track-*.test.ts`, `e2e/track-*.e2e.ts`): a 100 m
  lane per seat, lanes never interact. Clients send only `step` events (which
  foot, their own timestamp); the server owns distance, speed and the finish.
  Speed follows a smoothed cadence and decays when you stop; top speed at
  about 4 steps a second (`FULL_CADENCE`, was 6; user, 2026-11-08: "too many
  pumps for speed"). The bot is a pacer a person stepping steadily beats
  (user: "way too fast"; `spec/track-sim.test.ts`: slower than a steady 4 a
  second by 15% or more, and than a steady 3.5, but under 20 s). A step on the
  same foot twice is ignored, not punished; steps faster than the human cap
  (10 a second, by the step's own timestamp and by the server's own clock)
  are dropped, so shaking or mashing buys nothing. Steps before the gun
  don't count. First across the line wins; a dead heat is run again; the
  other runner has 5 s after the first finish. Formats: "race" (between
  two people) and "unlimited" (race after race, counts races won and
  best times). Practice vs bot is not a match between people. Practice runs in the
  page; nothing sent to the server. Camera
  (`spec/track-run-pose.test.ts`): two modes behind a setting, "elbows"
  (a hand rising 0.15 shoulder widths is a step; either arm counts, sent as
  alternating steps, since a small quick pump is what a person does) and
  "knees" (a knee rising is a step; stand back). Each step is measured from
  that side's own recent low, never from the stand-still calibration, which
  is only where the low starts (user, 2026-11-08: "pumps don't register";
  hands held higher than at calibration never re-armed); a side re-arms by
  falling back part of the way or holding still. "elbows" is the
  provisional default until a real-webcam playtest picks one. A seated
  player's track game opens the camera setup first (task 15; practice holds
  the race until it closes). `?debug` adds a readout and a recorder (the
  moves in `docs/camera-playtest.md`); every camera number is a guess until
  those recordings.
- Hurdles (task 27; `spec/track-hurdles.test.ts`, `spec/track-jump-pose.test.ts`,
  `e2e/track-hurdles.e2e.ts`): track's second event, the host's pick like
  the format ("sprint" default or "hurdles", `event` message, `LobbyView.event`;
  a change clears both ready flags; in practice the player switches it any
  time and the race restarts). Ten hurdles per lane, 8.5 m apart from 13 m.
  Clients send exactly `jump` {their own timestamp}; any extra field drops
  it whole. A jump keeps you in the air 0.4 s from the tick it arrives,
  costs 1 m/s, and is ignored in the air, before the gun, in the sprint, or
  faster than the jump cap (500 ms by its timestamp, and a server bucket of
  one refilling at 2 a second). In the air as you reach a hurdle clears it;
  on the ground knocks it down and leaves 40% of your speed. These numbers
  are guesses for the playtest. The bot jumps once per hurdle with seeded
  timing noise, so it sometimes hits one. No rating of its own (user,
  2026-11-08: ratings are going, match stats only): it is the `track` sport,
  stored exactly as the sprint. A track match row says which event: its
  `sets` JSON column holds `{ event, times, cleared, hit, sets }` (no schema
  step; `parseSetsColumn` reads either shape). Keys: Space or the Jump button.
  Camera: elbows mode, both hands rising about 0.6 shoulder widths together
  above their own recent lows, neither falling (was 1.2 above the
  stand-still rest; user, 2026-11-08: "arms have to go too high"); knees
  mode, a hop on the spot (the shoulder/hip midpoint rising fast above its
  own recent low). A running pump, a jogging step or one arm up never reads
  as a jump. Numbers in `DEFAULT_JUMP` are guesses until the recordings
  ("Track's and hurdles' moves" in `docs/camera-playtest.md`).
- Boxing's design is `docs/adr/002-boxing-judged-at-landing.md` (user,
  2026-11-05). The camera slip's numbers are first guesses until a lean is recorded. Camera
  numbers come from recordings (`docs/camera-playtest.md`), never guesses.
- Boxing (task 30; `spec/boxing-*.test.ts`): jabs only. Clients send
  exactly `punch` {hand, target "head"|"body", their own timestamp},
  `guard` {"high"|"low"|null} and `slip` {"left"|"right"|null}; anything else, or any
  extra field, is dropped whole (`asInput`, `parseClientMsg`). A jab lands
  100 ms after it is thrown (was 150; user, 2026-11-08: "alot of delay")
  and is judged on that tick: a head jab on a
  slipping boxer is "slipped" (no damage), a head jab on a high guard or a
  body jab on a low guard is "blocked" (20%, rounded), anything else is
  "clean"; the slip doesn't help against a body jab. So a guard or slip
  started in time still saves you. A slip is a held lean, like the guard
  (user, playtest 4: "it doesn't stay slipped"): it lasts until the boxer
  sends `slip` null, and head jabs miss the whole time it is held (user's
  choice, knowing lean plus a low guard blocks everything; the only cost is
  no punching while leaning). It goes with any guard and a guard change
  leaves it alone (playtest 4: you lean with your hands up); while leaning a
  body jab still meets the guard. No punching while leaning or guarding. Health 500 (100 ended bot bouts in
  about 15 s; `spec/boxing-sim.test.ts` holds bouts to well over a round),
  jab 6; these numbers are guesses for the playtest. A hand can't throw
  again until its jab lands plus 100 ms, so one hand jabs every 200 ms; a
  punch cap (6 a second per boxer, burst of 3, by the punch's own timestamp
  and by the server's clock) so flailing buys nothing (user, 2026-11-08:
  "i cant throw lots of punches at once"; was 300 ms, 4 a second, burst 2;
  guesses until the next recording). The bot guards the height of the jab it
  sees after a reaction delay (4 ticks at the quickest, so it blocks
  roughly a fifth of what it notices), sometimes slips a head jab, jabs more to the
  body against a high guard, and stays beatable. Three rounds of 30 s with
  a 5 s break; jabs in the air at the bell don't count; a knockout ends it
  at once; after three rounds the most damage dealt wins and an exact tie
  is a draw (`finished()` gives `winner: null`, recorded with `draw`). The round clock is the sim's ticks, so the
  reconnect pause freezes it. Formats: "bout" (between two people)
  and "unlimited" (bout after bout, counts bouts won and knockouts,
  no winner). Practice vs bot is not a match between people. Camera
  (`spec/boxing-box-pose.test.ts`, `cameraBoxing` in `box-pose.ts`): it
  sends the same messages a key does, never a hit. A seated player's bout
  opens the camera setup first, practice paused until it closes (task 15;
  user, 2026-11-08; `e2e/boxing.e2e.ts`). Everyone gets the trial
  detector (`TrialDetector`, `spec/boxing-trial-detector.test.ts`; the old
  `BoxTracker` read "jabs" from depth noise in a held guard, playtest 4): the
  hand model's palm growing past its own resting size is a jab, its height
  the target; both palms up is the guard, high or low by height, one arm up
  is none; a jab's minimum gap per hand (`minGapMs` 200) matches the sim's,
  so the camera is never the bottleneck. A busy hand's jab goes to the free
  hand (`hand-pick.ts`), and a resting fist that drifted settles after
  `restSettleMs` (playtest 5). A shoulder lean is a held slip
  (`SlipDetector`), and deliberate (user, 2026-11-08: "it seems to easily
  slip"): neutral is the median of the first second of tracking; the tilt
  must stay past 12 degrees from it for 200 ms (time, not frames, so the
  frame rate doesn't matter) to lean, and no lean starts within 250 ms of
  a jab the camera read (a jab twists the shoulders,
  `spec/boxing-lean-noise.test.ts`); you lean for as long as you stay past
  6, back within 6 you're upright (guesses until the recording in
  `docs/camera-playtest.md`). The pose model
  runs every third frame (shoulders only). No hooks. `?debug` adds a readout
  and a recorder only (P marks each real punch; moves 5, 8, 9 and 10 on
  key 0 record fast jabs, jabs from the guard, leans and a slight lean
  while jabbing). Keys: J head jab, K body jab, hold Space
  high guard, hold L low guard, hold A/D to lean; six buttons on a phone
  (the slip ones held like the guards).
- Basketball (task 32, ADR 003; `spec/basketball-*.test.ts`): five spots
  (free throw 4.6 m, elbow 5.5, wing three 6.75, top three 7.25, deep 9),
  worth 2/2/3/3/4, one shot each per spot, alternating, the first shooter
  swapping each spot; a swish (no rim, no board) adds 1 to any make, so a
  swished money ball is 5. A level shootout asks both players, as bowling
  does (user, 2026-11-08): phase "tie-vote", each seat sends `tie` {choice
  "draw"|"continue"} once; either "draw" ends it as a draw (`winner: null`,
  recorded `draw`); only
  both "continue" plays a sudden-death round from the deep spot (a make
  against a miss wins, the first shooter alternating, not added to the
  score), and a level round votes again. 15 s to vote (`VOTE_TICKS`), no
  vote counts as "draw"; the bot votes "continue" after 1 s; off-phase,
  second and malformed votes and spectators' are ignored. Clients send
  exactly `set`, `aim` {aim}, `shoot` {power 0..1, aim -1..1, their own
  timestamp} and `tie`; anything else or any extra field is dropped whole,
  and so is an off-turn message or a second shot in a turn.
  The server flies the ball (fixed release and launch angle, gravity,
  substeps, a rim circle and a bounded board with fixed restitution); a make
  is the ball's centre crossing down through the rim plane inside the rim.
  No random scatter: the same shot always does the same thing; the seed only
  picks unlimited's spots. `makeWindow(spot)` is the power range that scores
  with a centred aim; the snapshot carries it for the power bar and the bot
  aims inside it. Shot clock 15 s on the sim's ticks, from the shooter's
  first `set` or 5 s into the turn; running out is a miss; a shot after the
  buzzer counts within the seat's measured round trip, capped at 150 ms (9
  ticks), none if unmeasured. Formats: "shootout" (between two
  people) and "unlimited" (a seeded random spot each turn, counts points,
  makes and the longest make, no winner). The physics numbers are
  first guesses until the camera's recordings. Camera (`ShootDetector` in
  `shoot-pose.ts`): it sends the same `set`, `aim` and `shoot` a key does.
  A wrist held still at the chest is `set`; the hands' sideways offset is
  the aim, the player's right aiming right; a wrist rising fast from the
  chest past the face, against the shoulder line (so a jump adds nothing),
  is the shot, its peak upward speed the power, both hands their mean; the
  aim locks where it was when the rise began; a push that stops low (a chest
  pass) is scaled down by its rise. One shot a turn, nothing off-turn, a
  hand lost mid-push never fires. Every number in `DEFAULT_SHOOT` is a guess
  until task 32's eight recordings.
- Bowling (task 29, `docs/adr/004-bowling.md`; `spec/bowling-*.test.ts`,
  `e2e/bowling-*.e2e.ts`): five frames each, real ten-pin scoring
  (the fifth frame's bonus balls, perfect 150), frames alternate, seat 0
  first. Clients send exactly `aim` {aim}, `throw` {speed, aim, spin, at}
  and `tie` {choice "draw"|"continue"}; anything else or any extra field is
  dropped whole; off-turn messages, a second throw for one ball and a
  second vote are ignored. The server rolls the ball and the pins, with no
  random scatter. 20 s shot clock a ball (out of time is a gutter ball); a
  throw after the buzzer counts within the seat's round trip, capped at
  9 ticks (`setLag`, `lateShotTicks`). A level game (or tie frame) asks both
  to vote (user, 2026-11-08): either "draw" draws (`winner: null`, stored
  as a draw, like boxing's), both "continue"
  bowl a tie frame (no bonus balls, not added to the score); 15 s, a missing
  vote counts as draw; the bot votes continue. Formats "game" (between
  two people) and "unlimited" (games won, a level vote too, best
  score). The physics numbers are first guesses
  (`spec/bowling-physics.test.ts` holds what they must do: a pocket ball at
  speed strikes, a curving one more often than a straight one, a slow ball
  leaves pins, a head-on hit can split, spares are pickable). On screen:
  "Your turn" / "Their turn, watch"; the guide arrow shows only the start
  and the first third of the lane (never the bend or the end); the last
  path stays faint; after each ball the speed against `speedZone(spin)`
  (just the speed when null) and "Curve: ..." with the call. Keys: Left/
  Right start spot, Up/Down curve, hold Space (or Bowl) to fill a meter
  that rises and falls, let go to throw; D/C vote in a tie. Practice runs
  in the page; nothing sent to the server. Camera (`BowlDetector` in `bowl-pose.ts`): it sends the same `aim` and `throw` a
  key does. Aim is the bowling hand across the whole picture (walking
  works), the player's right aiming right, locked at the swing's start. A
  wrist coming up past the hip line fast, in shoulder widths a second
  against the shoulders (a step or crouch changes nothing), is the release
  and its speed; it counts only after the arm came down through the line
  (or with the model's depth in front), never a backswing behind. Spin is
  the sideways sweep over 150 ms around the release, then locked. No hips
  seen: a chest line instead, and the panel says stand back. One throw a
  turn, nothing off-turn, a wrist lost mid-swing never fires. Every number
  in `DEFAULT_BOWL` is a guess until task 29's ten recordings.
- "Just me" practice (task 38; `spec/basketball-practice.test.ts`,
  `spec/bowling-practice.test.ts`, `spec/track-practice.test.ts`,
  `e2e/{basketball,bowling,track}-practice.e2e.ts`): basketball, bowling and
  track practice open on "Just me", alone and unlimited, like archery's; a
  "vs Bot" switch in the practice panel (`client/games/practice-panel.ts`)
  changes it any time and restarts cleanly, and vs Bot is the old practice
  unchanged. Basketball: no turns, no shot clock, the ball comes back; a
  spot or Cycle; makes / shots and the streak. Bowling: frames alone (two
  balls, spares and strikes count), game after game, no shot clock, a
  running total; "Reset pins each ball" gives every ball a full rack and
  shows pins per ball. Track: your lane alone (the sim's `solo`), race after
  race, sprint or hurdles, your last and best time this session per event.
  All in each game's `practice-sim.ts`; the shared sims are unchanged. In
  the page, nothing sent to the server, never in stats.
- Practice coach for boxing and track (user, 2026-11-09: "a coach like
  tennis, keep it simple"; `spec/coach.test.ts`, `e2e/coach.e2e.ts`): a short
  card in the practice HUD (`client/games/coach.ts` + `.css`, class
  `practice-coach`; `.coach` is tennis training's, never reuse it). Boxing:
  head jab, body jab, guard, lean; track: run on the spot, then jump (the
  jump step only in the hurdles). Each step has a stick-figure picture and is
  ticked off by enough of its own move, in order. It only listens to what the
  practice's link already receives (keys, buttons or camera alike): no
  message, nothing sent to the server. "Skip coach" hides it and is
  remembered per game in `localStorage`.
- The in-game button row is the same in every game (user, 2026-11-09):
  `.hud-tools` at the top right, Leave rightmost, then sound, the watch link,
  the invite, the camera chip. Checked at 1920x1080 and 390x844: Leave is at
  the same spot on desktop; on a phone it is right-aligned but its height
  follows each game's score panel.
- Tennis keeps only the default controls (user, 2026-11-09; task 35 item 1):
  the camera setup has no "Follow my arm" or "Aim by pointing" any more, only
  the classic swing and aim by timing, and `calibrationFrom` reads a saved
  follow or point as those (`spec/camera-settings.test.ts`). The follow and
  point code stays, unreachable, until it is removed for good. Movement keeps
  "auto" with leaning as the optional mode.
- Archery's camera draw can only arm on your own turn (`BowTracker.setArmed`,
  `spec/archery-bow.test.ts`; user, 2026-11-09: it shot early at the start of
  a turn). The aiming circle never vanishes: an arrow that would fall short
  shows a red sight at the foot of the target, and the ring is wider with a
  dark edge (`predictHit` is null for a short arrow, common at range).
- Track's camera offers arm pumps only (user, 2026-11-09: the knees mode
  never detected the legs). A saved "knees" is read as "elbows"; the knees
  code and its settings shape stay for now.
- The home screen's sports run Tennis, Bowling, Basketball, Track, Archery,
  Boxing (user, 2026-11-09). Hovering or focusing a card only moves the
  pointer arrow; the preview, the title and the buttons stay the selected
  sport's.
- Camera settings (task 25; `spec/camera-settings.test.ts`,
  `e2e/accounts.e2e.ts`): every one (tennis's per-stroke swing thresholds,
  neutral, racket hand, swing, aim and movement mode; archery's bow hand;
  track's mode and stand-still per mode; basketball's power range;
  bowling's speed range) is one
  closed shape in `shared/camera-settings.ts`. An account's are stored on the
  server (`players.camera_settings`, schema v9, `/api/camera-settings`) and
  arrive with `/api/me` on any device; a guest's stay in the browser, and a
  passkey claim carries them over. The server refuses an unknown field, a
  wrong type or a value out of range whole and stores nothing; `null` is
  Reset to default. A fresh profile is classic swing, aim by timing and
  auto-move. Deleting the account deletes them.
- One swing counts once (task 25, `spec/camera.test.ts` "the
  double-count"): a classic sweep ends where the hand turns back; only a
  sweep in the hitting direction of the grip held counts, a wind-up is
  dropped whole and starts no cooldown, and an opposite sweep within
  `recoveryMs` (400 ms, was 800: user, 2026-11-09, switching strokes) of a counted swing is the recovery. Calibration
  counts with the same rule (`CalibrationRecorder`). The camera cooldown
  (300 ms) and the server's 250 ms are unchanged (user's decision).
  A swing starts from rest (the backhand fix, 2026-11-08, same spec: "a
  hand swaying back and forth is never a swing"): the hand's movement is
  split into legs where it turns back by 0.1 shoulder-widths; a sweep
  counts if its leg set off after 150 ms with no headway, or if it follows
  a take-back that did and goes 1.25x as far, and that stroke's kind is its
  direction, whatever grip the take-back showed. A sweep from rest may start
  at most 0.4 shoulder-widths onto the other stroke's side
  (`OTHER_SIDE_START`). So a drifting or swaying hand reads no swings with
  any grip. These numbers are guesses until a real-webcam recording.
- The trajectory aid off (user, 2026-11-08; `e2e/aid-messages.e2e.ts`)
  shows nothing to aim with: no reticle ring, no single arc, no stance pill
  and none of the stroke messages (the FOREHAND / BACKHAND label, the
  "Forehand · hard" line, "not sent"). Bounce marks and the ball's trail
  stay. With it on the messages sit in one centred row between the timing
  meter and the swing buttons (`.shot-messages`), never over the player or
  the court, at both viewports.
- Basketball's quick power calibration (task 25 round 3,
  `spec/basketball-power-calibration.test.ts`): optional, in the camera
  setup's aim step, "push soft, then push hard" twice each; their medians
  sit at 20% and 90% of the bar (`powerRangeFrom`); a hard push under 1.5x
  the soft keeps the defaults and says so. Never blocks a room. Bowling has
  the same in its swing step, "roll soft, then roll hard" onto
  `speed0`/`speed1` (`spec/bowling-speed-calibration.test.ts`).
- Sound (task 19; `spec/audio.test.ts`, `spec/crowd-reactions.test.ts`,
  `e2e/*-sound.e2e.ts`): one `client/audio/` module for every screen.
  Synthesised with Web Audio, no files; the crowd's voice sits in
  `crowd-sound.ts` so CC0 clips can replace it. No AudioContext before the
  first gesture; muted (or effects off) makes no audio nodes. One sound
  button in each game's HUD and beside the home screen's profile button:
  Sound, Effects and crowd, Music, Volume, remembered per browser (task 25
  moves it onto the account). Every sound is worked out on each screen from
  two snapshots (no new network message; your own swing's whoosh plays as
  you send it). The crowd is placed by side: the winner's side cheers and
  the loser's goes "aww" (never boos), everyone hears both, each side panned
  and weighted to where its stand is on that screen (your own side on your
  left and louder; a spectator hears seat 1 left, seat 2 right; boxing's
  fans sit behind their own boxer); bigger moments are bigger. Archery and
  bowling have a few onlookers who back nobody. Practice keeps the crowd
  quieter; training has none. Under prefers-reduced-motion the stands change
  pose without the jumping loop. Home music: a jazz loop on by default and
  quiet, starting at the first gesture, fading out into a game and back on
  the home screen.
- Auto-move (`spec/auto-move.test.ts`) walks slower than manual movement
  (`AUTO_SPEED` share of `PLAYER.speed`) so a wide hard shot can beat it;
  strength must keep mattering. The movement mode is an input to the sim,
  never a client claim of position.
