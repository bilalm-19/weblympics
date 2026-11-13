# Weblympics

An immersive webcam-controlled sports game, played against a bot or a friend over the web. Six events: tennis, bowling, archery, a track sprint, boxing and a basketball shootout.

![The home screen: six sports, a room panel and your party](docs/media/home.png)

## Inspiration

Weblympics is a homage to the Wii and Kinect sports games I grew up on in the 2010s. Those games needed extra hardware. Weblympics brings the same immersive play to a browser tab, on a device you already own with a camera. The sports and mechanics come from playing those games and watching others play them, adapted to a webcam.

## What "good" means here

What made the Wii and Kinect games fun was that they were casual and easy enough for any age, with little skill gap because the mechanics were simple, and nothing rewarded being a "pro". Weblympics follows that and works in tight spaces. Good here means a stranger can load the page and be playing with a friend within a minute, with no tutorial or account.

- **One simple move per sport.** The move is the real one: swing, throw, run on the spot, jab, push. Never a combination or a button chart.
- **Easy to play, hard to dominate.** Webcam tracking is noisy and lag is real, so I cut precise controls and kept forgiving ones. Games are also more enjoyable when both players feel on par, for example in longer tennis rallies.
- **Features with a purpose.** Each exists to get friends playing together: invites, parties, spectating and easy rotation of players.
- **Optional depth.** Training and practice modes are for anyone who wants to improve. Nobody has to use them.

### What I left out, on purpose

- **Ratings and a leaderboard.** They go against the casual play the game is made for. Your profile shows only a count of matches played.
- **Precise racket control.** A racket that copies your arm was unplayable with webcam noise and lag, so tennis has a plain forehand or backhand.
- **Chat.** Others do it better. Friends can call each other on something established, and this site is where they play.

## Playing with friends

Invite a friend by their short **Name#1234** tag, or share a **room code** they type in, so nobody pastes long links, and the hassle of sending party codes to friends is removed. Parties hold up to 10: the leader picks the game and who plays next, two sit and the rest watch (until their go). Friends show as online, away or offline, and you can hide.

![Friends panel: your Name#1234 tag, add by tag, status, invite](docs/media/friends.png)
![The invite pop-up a friend sees: Join or Not now](docs/media/invite.png)
![A party of two with a slot to invite a friend](docs/media/party.png)
![The party controls: pick the game, who plays next, and who can find the party](docs/media/party-controls.png)

## Run it yourself

This repository continues the course project on its own GitHub ([bilalm-19/weblympics](https://github.com/bilalm-19/weblympics)). It runs directly on Windows or macOS with Node 24 and pnpm, with no WSL or Docker needed, and nothing deploys automatically from it. There are three ways to play:

| | Who can join | Internet | Certificate warning |
|---|---|---|---|
| **Hosted** (`pnpm build && pnpm start` behind a hosting service's https) | anyone with the link | yes | none |
| **Offline**, `pnpm local` | this computer only | first run only | none |
| **Wifi multiplayer**, `pnpm lan` (opt-in) | devices on the same wifi | first run only | once per device |

**Offline** is the simple extra. `pnpm local` runs the whole game at http://localhost:8080, to play the bots or try the camera. The first run downloads the camera's two model files (about 14 MB) into `models/`; after that it works with the wifi off. The browser treats `localhost` as secure, so the camera needs no certificate, and the game itself serves the pose runtime and models, so the page talks to nothing but your computer ([`docs/local.md`](docs/local.md)).

**Wifi multiplayer** takes some setup. One computer runs `pnpm lan` and the others open the https address it prints. The other devices reach it by IP address, so it serves https itself with a self-signed certificate it makes, named only "Weblympics LAN". Every device sees a "not private" warning once, and Chrome on other laptops can still get stuck on "Connecting" (not yet solved). Passkeys need a domain name, so accounts here use a one-click local account with a recovery code. Windows and macOS setup, the firewall, and what the warning does and doesn't mean are in [`docs/lan.md`](docs/lan.md).

## Controls

The webcam is the default, and "Use keyboard instead" is always available.

- **Tennis:** swing, palm out for a forehand, back of the hand for a backhand.
- **Archery:** hold an imaginary bow, pull back to draw, let go to shoot.
- **Track:** run on the spot.
- **Bowling:** choose your spot, hold and let go.
- **Boxing:** jab, guard high or low, or lean away.
- **Basketball:** push up towards the hoop.

Every rule and key is in [`docs/game-rules.md`](docs/game-rules.md).

A tennis rally and a basketball shot, played with the camera:

https://github.com/user-attachments/assets/9feb39fa-a819-45bc-ab69-50abd498c9c8

https://github.com/user-attachments/assets/62c12614-b6a5-4fbd-aae0-314ca9b8b712

## Many people, live, and still there tomorrow

- **Multi-user.** Each browser is its own person, told apart by a cookie the server sets (guest or passkey account). A room has two seats and up to 10 watchers.
- **Real-time.** Updates are pushed over a WebSocket, so a swing, a score or a friend coming online shows on every screen live, with no reload.
- **Persistent.** Accounts, friends, settings and finished matches are in SQLite on the server's disk (a hosting volume, or `data/` on your computer when you run it yourself), so they survive a restart or redeploy. Live rooms and parties are in memory, so a restart ends a match in progress.

## What is enforced, and what is judged

**Enforced in `spec/`:** server-owned hits, the lag numbers ([ADR 001](docs/adr/001-who-wins-under-lag.md)), no video leaving the browser (the page's Content Security Policy allows only this server and the pose model's hosts), logs without names, and room and friend rules. **Judged by people:** whether a move feels natural, which I playtested with peers. How I judged it is in [`PROCESS.md`](PROCESS.md).
