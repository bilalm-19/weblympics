# Boxing: handoff for the playtest session (2026-11-05)

Read this, then `CLAUDE.md` (rules) and `tasks/30-boxing.md` (the spec).

## Where it is
- Branch `boxing-30`, in the worktree `.claude/worktrees/agent-a88919096404261da`. **Not merged into `main`**, nothing pushed. `main` is at 571d966 and is an ancestor of `boxing-30`, so merging is a clean fast-forward.
- Green on this branch: `pnpm check` 42 files, 671 tests; `pnpm e2e --workers=1` 198 passed at both viewports (all exit 0).
- A server built from this branch is on **:8999** (`DATA_DIR=/tmp/bx-data`). Practice: `http://localhost:8999/#/boxing/practice`. Use `localhost`, the camera only works there or on https. Your main dev servers (:8080, :5173) run `main` and do not know boxing.
- Changing code: `pnpm build`, kill :8999 (`fuser -k 8999/tcp`), restart with `PORT=8999 DATA_DIR=/tmp/bx-data pnpm start`. For hot reload, run `pnpm dev:client --port 5199 --force` after pointing the proxy in `vite.config.ts` at :8999 (do not commit that edit). On this `/mnt/c` drive Vite serves stale CSS and `node --watch` misses edits: restart with `--force` if a change seems to do nothing.

## What exists
- `shared/games/boxing/`: `sim.ts` (rules), `bot.ts`, `index.ts` (adapter, registered). Server owns every hit; clients send only `punch` (jab|hook, hand, own timestamp) and `guard` (up|down).
- `client/input/camera/box-pose.ts`: pure camera maths (`boxFrame`, `BoxTracker`, `DEFAULT_BOX`). In shoulder widths from the shoulder line, so there is no calibration.
- `client/games/boxing/`: `view.ts` (flat 2D ring, one canvas), `box-camera.ts` (Camera button, safety panel, Tracking chip, Guard and last-punch pills), `practice.ts` + `practice-sim.ts` (in the page, nothing sent), `boxing.css`.
- Home menu: Boxing took the "??" tile. Keys: **J jab, K hook, hold Space guard**; three buttons on a phone.
- Specs `spec/boxing-*.test.ts`, e2e `e2e/boxing.e2e.ts`.

## The numbers (all guesses until played)
Game (`shared/games/boxing/sim.ts`): health **500** (was 100: two bots knocked each other out in about 15 s, so the 3 rounds never happened; 500 gives about 75 s bouts and mostly round 3), jab 6, hook 14, blocked punch 20% (rounded), wind-up jab 200 ms and hook 350 ms, a hand recovers 150 ms after landing, cap 4 punches/s per boxer with a burst of 2 and 100 ms between timestamps, 3 rounds x 30 s, 5 s break.
Bot (`bot.ts`): guards 250-450 ms after a punch is thrown, ignores 25% of punches, about one punch a second, 65% jabs.
Camera (`DEFAULT_BOX` in `box-pose.ts`): `jabSpeed` 4 and `jabReach` 0.5 (shoulder widths/s, and how far in front of the shoulder), `hookSpeed` 4 and `hookBand` 0.7 (within this of shoulder height), `rearmSpeed` 1.5, `minGapMs` 250, `guardOn` 0.55 and `guardOff` 0.75 (distance of both wrists from the face), `faceUp` 0.6 (face height if the nose is not seen).

## Not done, and not known
1. **No real person has ever been read by the camera.** The test webcam is a pattern with nobody in it, so only the panel and the maths on synthetic bodies are tested. This is the main job: play with a real webcam and note what fails.
2. **Playtest questions:** does a real jab register (not as a hook), does a hook, does the guard flicker or stay up, does a punch feel late, are punches firing by accident when you move, is the bout too short or too long with a human, is the bot too easy or too hard. Each is one constant above.
3. **The 3D scene** waits on the shared character and podium (task 28). Branch `kit-28` holds about 1,700 lines of that, committed but **unverified** (its agent was stopped mid-test). The current ring is flat 2D on purpose.
4. **Rules the agent chose that the user has not OKed:** a draw between two people is rated (stored with no winner); punches still in the air at the bell don't count; a double KO on the same tick goes to whoever dealt more damage, else a draw; the guard can move in the break but punches can't; the punch cap is per boxer across both hands.
5. Two-person rooms exist and are tested at the server, but have not been played by two humans.

## Rules to keep (from CLAUDE.md)
- The server never trusts a client's claim of a hit or damage. Camera and keys send the same two messages.
- A bug fix adds a test that fails without it. Log playtest findings and decisions in `logs/devlog.md` (time from `date`, who decided).
- UI changes: run `pnpm e2e --workers=1` (both viewports). Changes to `shared/`, `server/`, `spec/`: run `pnpm check`. Never commit on red; ask before every push.
- Stage files by name. Never commit `data*/` folders (they are now in `.gitignore`) or `mise.local.toml`.
- README is 710 words against its 400-600 limit; trim it at the README rewrite.
- Boxing is "dropped if not solid by Saturday night" (7 Nov).

## Other unmerged work (so it is not forgotten)
Branches `worktree-agent-ac7cf30a326f909a2` (bowling rules and server), `worktree-agent-abf3d33159a052196` (hurdles, finished and green), `kit-28` (podium, unverified). Their agents' calls are in the devlog.
