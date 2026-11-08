# Weblympics

An immersive webcam-controlled sports game, played against a bot or a friend over the web. Six events: tennis, bowling, archery, a track sprint, boxing and a basketball shootout.

## Inspiration

Weblympics is a homage to the Wii and Kinect sports games I grew up on in the 2010s. Those games needed extra hardware. Weblympics brings the same immersive play to a browser tab, on a device you already own with a camera, such as a tablet or laptop. The sports and their mechanics come from playing those games and watching others play them, adapted to a webcam.

## What "good" means here

What made the Wii and Kinect games fun was that they were casual and easy enough for any age to play, with little skill gap because the mechanics were simple, and no 'reward' was given for beign 'good'. Weblympics follows that, and is playable in tight spaces to make play more accomodating. Good here means a stranger can load the page and be playing with a friend within a minute, with no tutorial or account.

- **One simple move per sport.** The move is the real one: swing, throw, run on the spot, jab, push. It is never a combination or a button chart.
- **Easy to play, hard to dominate.** Webcam tracking is noisy and lag is real, so I cut precise controls and kept forgiving ones. Furthermore, games feel more enjoyable when both players feel on par (for example, longer tennis rallies)
- **Features with a purpose.** Each exists to get friends playing together: invites, parties, spectating and easy rotation of players.
- **Optional depth.** Training and practice modes are there for anyone who wants to improve, and nobody has to use them.

### What I left out, on purpose

- **Ratings and a leaderboard.** This goes against the casual playstyle the game is made for, and was thus removed. Instead a basic stats count is available on the player's profile/
- **Precise racket control.** A racket that copies your arm was unplayable with webcam noise and lag, so tennis has a plain forehand or backhand.
- **Chat.** Others do it better. Friends can call each other on something established, and this site is where they play.

## Playing with friends

Invite a friend by their short **Name#1234** tag, or share a **room code** that they type in, so nobody has to paste long links. Parties hold up to 10: the leader picks the game and who plays next, two sit and the rest watch. A room/game has two seats and up to 10 watchers. Friends show as online, away or offline, and you can hide.

## Controls

The webcam is the default, and "Use keyboard instead" is always available.

- **Tennis:** palm to the screen is a forehand, the back of your hand a backhand. The game walks you to the ball.
- **Archery:** hold an imaginary bow. Your front hand aims, pulling the other back sets strength, and letting go shoots.
- **Track:** run on the spot (arms or knees), or alternate A and D. Hurdles: throw both arms up, or press Space.
- **Bowling:** pick the start spot and curve, then hold and let go. Keys are the arrows and Space.
- **Boxing:** jab to the head or body, and defend with a high guard, a low guard or a lean.
- **Basketball:** push up towards the hoop, and a bar shows your power against the green.

## How it works, and what is enforced

The server owns the ball/shared state and the score. Clients send only moves (a swing, step, punch or throw), never video, and render what the server says.

If the ball was hittable on your screen when you swung, it counts, checked against the server's own record. This is lag compensation, as in Counter-Strike ([Bernier, GDC 2001](https://www.semanticscholar.org/paper/Latency-Compensating-Methods-in-Client-Server-and-Bernier/330071040ca858ca710a24a03915366fcd46f021)), but capped at 150 ms. At a 150 ms round trip, 100% of on-time swings hit, against 76% without it ([ADR 001](docs/adr/001-who-wins-under-lag.md)). The opponent may see your return slightly late.

**Enforced by checks in `spec/`:** server-owned hits, the lag numbers, no video leaving the browser (the page's Content Security Policy, which only lets it connect to this server and the pose model's download hosts, checked by `privacy.test.ts`), logs without names or tokens, and room and friend rules. **Judged by people:** whether a move feels natural. I playtested each sport with peers and changed it until newcomers managed (see `PROCESS.md`).
