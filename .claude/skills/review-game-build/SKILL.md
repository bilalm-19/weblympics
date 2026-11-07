---
name: review-game-build
description: Reviews a playable Weblympics game against the project's idea of good, the course brief, CLAUDE.md's rules and the 256 MB server, including play-throughs by fresh persona agents who never see the code. Use when the user asks to review, audit or check a game (tennis, archery, track, boxing, or a new one), or "is <game> ready to ship". Reports findings and a verdict (ship / fix first / pull from the menu) in the chat.
---

# Review a built game

Find what stops a game from meeting the project's idea of good or the brief,
ranked by how much it would cost in marking. Report in the chat. Don't fix
anything unless the user asks; a review that also edits loses its outside
view.

Argument: the game's registry id (`tennis`, `archery`, `track`, `boxing`).
If none is given, ask which.

## 1. Read first

- `docs/game-review-criteria.md`: criteria A to F, the personas, the
  verdicts. Apply them; don't re-invent them.
- `README.md`, `CLAUDE.md` (the game's paragraphs under Layout and Rules),
  the game's task file and ADR, and the last entries about it in
  `logs/devlog.md` (grep the game's name). Note any open playtest finding:
  the review checks whether it is still true.

## 2. Run the app on a spare port

Never use 8080 or 5173 (the user's own dev processes). Build if `dist/` is
older than the last commit, then:

```bash
PORT=8191 DATA_DIR=$(mktemp -d) pnpm start   # run_in_background
```

Find and stop it later by port (`ss -ltnp | grep :8191`), never by name.

## 3. Persona play-throughs (criteria A, B, D)

Run personas 1 to 3 from the criteria as **fresh agents in parallel**
(general-purpose), one each. Each prompt holds only:
- the persona, word for word from the criteria;
- the URL (`http://localhost:8191/`, or the watch link for the spectator:
  open a vs-bot room yourself first and pass its `#/watch/CODE`);
- the game to play, by its name on the menu;
- the browser recipe below;
- "Do not read any file in the repository, and do not look at page source,
  scripts or network traffic. You only know what is on the screen."

Browser recipe for the persona agent:
> Write throwaway Playwright scripts (`.mjs`) in a temp dir outside the repo
> and run them with `node` from the repo root. Load Playwright with
> `const { chromium } = createRequire(process.cwd() + "/")("@playwright/test")`
> (`createRequire` from `node:module`; plain `playwright` doesn't resolve).
> Launch chromium with
> args `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`,
> `--use-gl=angle`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`
> and the persona's viewport (laptop 1920x1080; phone 390x844 with
> `isMobile` and `hasTouch`). Keep one browser open across steps if you can,
> or replay your steps each run. After each action, save a screenshot and
> look at it, and read `page.locator('body').ariaSnapshot()` to see what's
> on the screen. Act only through what you see: roles and visible text.
> The fake webcam shows a test pattern, not a person, so any camera move
> won't be read; note what the screen told you to do with your body and
> whether you could tell how to do it, then play on keys or buttons.

Each persona reports:
- seconds and steps from opening the URL to the first action that counted;
- every point they were unsure, with the words on screen at that moment;
- whether they found out how to play without leaving the page;
- whether they finished a match (or for a spectator, could tell who was
  winning), and what they'd tell their friend;
- screenshots of each stall (paths).

Persona 4 (the marker) is yours, not an agent's: open `/readme/`, check that
it says enough to get two browsers into this game, and that a finished match
is still there (match history or leaderboard) after a server restart on the
same `DATA_DIR`.

## 4. Code and harness checks (criteria C, F)

While the personas run, check yourself:
- **C1-C3:** the game's client message types in `shared/` (its adapter and
  the protocol parser): list them, confirm none carries a claim, that extra
  fields are dropped, and where the rate caps are. Point at the spec that
  holds each.
- **C5:** the sim takes no `Date.now()` or `Math.random()` (grep it).
- **F1:** every camera threshold in the game's pose file: from a recording
  (cite it) or a guess (list it as open).
- **F2/F3:** for each rule CLAUDE.md states about this game, find the spec
  that checks it and the README sentence that promises it; list any rule
  with no spec, any README claim with no rule, and anything the app does
  that none of them mention.
- Run the game's own tests only: `APP_URL=http://localhost:8191 pnpm vitest run spec/<game>`
  and `APP_URL=http://localhost:8191 pnpm e2e --workers=1 e2e/<game>`. Gate on the
  exit code. Report red as red.

## 5. Server cost (criteria E)

With the app on 8191: read `/stats`, then open 5 vs-bot rooms of this game
(a Playwright script, five pages, each starting practice vs the bot on
keys), wait 20 s, read `/stats` three times, 5 s apart. Report RSS per room
over the idle reading, `loop.avgMs` and `loop.maxMs`, and the projected RSS
at 10 rooms against the 256 MB limit. Local numbers are a lower bound; say
so. Tell the user if a reading on the live site would settle it (they can
run `curl https://comp4020-final-bilalm004.fly.dev/stats`).

## 6. Clean up

Close browsers, stop the 8191 server by its PID, delete the temp `DATA_DIR`
and the persona scripts.

## 7. Report

```
## <Game>: <ship | fix first | pull from the menu>

<two sentences: the verdict and the one or two reasons that decide it>

### Blockers (cost marks under the brief)
1. <finding> (<criterion>) — evidence: <file:line, screenshot, persona quote> — fix: <smallest change>

### Concerns
...

### Passes
<criteria that passed, one line each with the evidence>

| Criterion | Result |
|---|---|
| A1 ... | pass/concern/fail |

**Personas:** <one line each: time to first action, finished or not, the
quote that matters most>
**Server:** idle <x> MB, +<y> MB per room, loop avg/max <a>/<b> ms
**Tests:** <command>: <passed>/<total>, exit <code>
**Still open from the devlog:** <playtest findings still true, or fixed>
```

Rank blockers by marking weight: a broken viewport, the core interaction
failing, or a README claim the app doesn't keep come before polish. Say what
you could not check (a real webcam, two real people) rather than guessing.
If a finding shows a rule missing from `docs/game-review-criteria.md`,
`CLAUDE.md` or `spec/`, say which file it belongs in.
