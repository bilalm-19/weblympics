# Process overview

## What I built and why

I grew up on the Wii/Xbox Kinect sports games, playing against bots, or with family and friends. During that era (the 2010s), these games needed extra hardware to play (the Wii remotes and sensor, or the Kinect), so playing was only really practical where they were already set up.

Weblympics is a homage to those games. It is developed in an attempt to bring back the same immersive style of play, with hardware that people already carry every day - devices with webcams (such as tablets and laptops) - but now, over the web! It started as tennis (the one I found most nostalgic!) ([`5a7e715`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/5a7e715)) and grew to six sports.

My definition of "good": a newcomer can pick it up and play with friends, whatever their skill.


## The stack, and what it costs

**WebSockets**
Each move (a swing, step, punch or throw) goes to the server and on to an opponent who must react to it, so the connection must be fast both ways. A socket pushes data as soon as it exists. Polling would make every move wait for the next check and add a request per check.

**Minimal dependencies**
The server runs on 256 MB, so it uses Node's standard library for the web server and database, `ws`, and three small libraries (passkeys, name filtering, the README page).

**Server-owned state**
The server owns shared things like the ball, and the score, so neither player has an advantage. The cost is that lag now matters.

**Persistence**
Rooms and matches are stored in SQLite on `/data`, so they survive restarts and redeploys. The schema is versioned in `server/schema.ts`, one new step per change.


## The Harness

CLAUDE.md tells agents to log decisions, keep to the lightweight stack, and where the layout and commands are. With many agents running, each added its own game to it, and CLAUDE.md grew to 811 lines, which wasted context on every session. I cut it to 141 and moved per-game detail to `docs/` ([`b658fc7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/b658fc7)).

## Alignment

To stay true to "easy to pick up", I wrote `docs/game-review-criteria.md`: rules a game must meet, plus five personas (a skipper, a reader, a tight space, patchy wifi, smoothness) ([`54cc21d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/54cc21d), [`6059f31`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/6059f31)). Two skills use it: `review-game-idea` pushes back on a pitch before any code, and the result becomes an ADR (basketball and bowling, [`4719f23`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/4719f23), [`13697c0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/13697c0)); `review-game-build` checks the built game against the same criteria.

## Testing

Whatever could be made deterministic was, so the behaviour could be confirmed. The sims run from a seed plus an input stream, so `spec/` (84 files, over a thousand tests) replays exact situations, and `e2e/` (40 files) runs the real app at desktop and phone sizes. The rules I set for the tests mattered more than the tests:

- **Every bug fix adds a test that fails without it.** For example, the winning point wiped the practice score to 0-0 in the same tick ([`516e375`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/516e375)).
- **A schema change is a new step plus a test that opens a database made by the previous version.** The rule is in CLAUDE.md ([`b312761`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/b312761)); the first such test is in `spec/db.test.ts` ([`a4a993f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/a4a993f)).
- **Numbers, not adjectives.** `pnpm check` fails if the lag test's hit rate at 150 ms drops under 95% ([`3653fc2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/3653fc2)).


## Playtesting
Claude can play a persona, but whether a movement feels right or comfortable for a human on a webcam needs a person. I played the games myself and watched peers play, at crits and outside them.

- **Tennis movement.** Lean-to-move made people struggle to move and hit at once, so rallies were short. The server now walks the seat to the ball ([`678457b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/678457b)); lean-to-move stays as a toggle ([`84ac175`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/84ac175)).
- **Free racket.** Webcam tracking plus lag made a racket that copies your arm unplayable ([`3783ec2`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/3783ec2)). The default became a plain forehand or backhand ([`1e7e024`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/1e7e024)).
- **Boxing.** The lean fired too easily and punches were inconsistent ([`6f4b250`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/6f4b250)); the fix was a deliberate held lean and jabs landing in 100 ms ([`dae32f3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/dae32f3)).
- **No ratings.** Elo and a leaderboard let strong players dominate newcomers, which is the opposite of what I wanted, so I removed them ([`17010b5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/17010b5), [`4536b8c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/4536b8c)).

A `?debug` mode records each move as numbers, so Claude set thresholds from real movements, not guesses ([`a6bd531`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/a6bd531)).

## Lag: who wins when screens disagree

Players can be on different networks and each see the ball slightly in the past, so a swing that was on time on the hitter's screen can reach the server late and miss the short hit window, so I decided to add some leeway. ADR 001 ([`99a1194`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/99a1194)) judges each swing at the tick the hitter saw, checked against the server's own history. This is lag compensation, an established technique used in games, such as in Counter-Strike ([Bernier, GDC 2001](https://www.semanticscholar.org/paper/Latency-Compensating-Methods-in-Client-Server-and-Bernier/330071040ca858ca710a24a03915366fcd46f021); [Valve's wiki](https://developer.valvesoftware.com/wiki/Lag_Compensation)) ([`82f98f0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/82f98f0)). How far back compensation goes is the player's measured round trip plus 50 ms for jitter, up to a maximum of 150 ms. A flat 150 ms leeway is not given to everyone as players with a good connection could hit balls that really were late. The cost to the opponent is small: a brief correction at the far end of their court, where the ball is smallest. In `spec/latency.test.ts`, on-time swings at a 150 ms round trip hit 76% of the time without this and 100% with it (results in [ADR 001](docs/adr/001-who-wins-under-lag.md)).

Boxing judges the guard and lean on the tick that a punch lands, so a guard raised before a punch still protects the user (ADR 002, [`5a24cea`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/5a24cea)). Archery, bowling and basketball are turn-based, so there is no race. A per-turn time limit stops one player stalling, and ties go to sudden death in archery, or a vote of both players in basketball and bowling ([`f86b2b7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/f86b2b7), [`9970a1f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/9970a1f)).

## Privacy

With a webcam, privacy was key. The video never leaves the browser; the server only receives the move that was perceived from the webcam. The page sets a Content Security Policy, a rule telling the browser it may only connect to this server and the pose model's download hosts ([`4bfef16`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/4bfef16)). `spec/privacy.test.ts` checks it, and a second check, `e2e/camera.e2e.ts`, fails if the page sends any message outside an allow-list. When friends' presence messages arrived, the test flagged them and I widened the allow-list deliberately ([`bf5ec97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/bf5ec97)). Players choose whether to appear online, away or offline.

## Subagent workflow

One main session discussed each task with me, split the work into parallel and dependent parts, and launched subagents. The contexts of the tasks running stays out of the main session, which only gets the results, so its context stays small for better performance and lower cost. This main session was also useful in discussions - e.g. on plan changes, it notified the running subagents to update their plans too.

Each agent had its own worktree, branch and port ([`17de314`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/17de314)), so they can work and test, without impacting other subagents. Finished branches are merged where I ran the full checks before moving `main` (e.g. [`b33da62`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/b33da62)). Early on, I told Claude to choose Sonnet or Opus per task to balance cost and ability; in the final week's $500 budget I used Opus freely, and noticed how fast several Opus agents spend credits. The append-only `logs/devlog.md` records decisions, who made them and what I sent agents, allowing for me to easily trace what was discussed and decided on earlier.

For looks, I gave Claude Gemini-generated characters and equipment as inspiration. For the home redesign I could not tell what Claude pictured fully, so I had it build an HTML mock and refined it over eight rounds ([`d02019c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/d02019c) to [`97b8f91`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/97b8f91)) before comitting to the expensive task of building/incorporating it ([`aa85eae`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bilalm004/commit/aa85eae)).
