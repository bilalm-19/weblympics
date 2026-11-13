# Playing offline on one computer (`pnpm local`)

An extra. The normal way to play is the hosted site; this runs the whole game
on your own computer, so you can play against the bots with no internet, no
account and no setup beyond installing it. Nothing changes about how the game
works: the server on your computer owns the ball and the score, and keeps
your profile, looks and match history in `data/app.db`.

## Start it

```bash
pnpm install
pnpm local
```

Then open **http://localhost:8080**. `PORT` and `DATA_DIR` work as they do for
`pnpm start`.

The first run needs internet once: it downloads the camera's two model files
(about 14 MB) into `models/`. After that, turn the wifi off and it still works.
Without them, keys and buttons still work and the camera says the model
didn't load.

## Why no certificate or warning

A browser only lets a page use the webcam on a secure page, and
`http://localhost` counts as one. So on the computer running the game, the
camera works over plain http, with nothing to install or click through.

## What is different from the hosted site

- **Only this computer can connect.** The server listens on 127.0.0.1, so
  other devices on the wifi can't reach it, and Windows and macOS don't ask
  about the firewall. To play with other devices, see
  [Wifi multiplayer](lan.md).
- **The page talks to this computer only.** The pose runtime (from
  `node_modules`) and the models (from `models/`) are served by this server,
  under `/pose/`, and the page's Content Security Policy allows nothing but
  this server. On the hosted site they come from jsDelivr and Google's storage
  instead. Video never leaves the browser either way.
- **Against the bots, or a second browser tab.** Rooms, practice and training
  all work. Friends and parties need other people, so they're for the hosted
  site or wifi multiplayer.

How it works: `scripts/local.ts` sets `POSE_FILES=local` and `HOST=127.0.0.1`
and starts the normal server; `server/index.ts` then serves `/pose/` and adds
a `<meta name="weblympics-pose-files">` to the page, which
`client/input/camera/camera.ts` reads (`shared/pose-files.ts`,
`spec/local-mode.test.ts`).
