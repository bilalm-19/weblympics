# 15 Webcam by default

Status: built 2026-10-21 by session B (agent); needs a real-webcam look. Narrowed 2026-10-21: the dedicated sport pages and recorded
thumbnails are dropped for now (user); they can return later.
Model: Sonnet
Session: B (first)
Waits on: nothing now (tasks 4 and 5 are built)

## Goal
Starting a game opens the camera flow first. The camera is the default way to
play and is still never required.

## Scope
- When a game starts (practice, room, training), the camera setup opens first:
  safety notice, then start camera, with a clear "Use keyboard instead" path.
- Training becomes the step after the camera setup, as the handoff notes
  ("Train is not yet the default way in after the camera notice"). Keep Train
  also available as its own button, and keep Skip training.
- Denying permission, or no camera present, falls back to the keyboard without
  a dead end.
- Every camera action keeps its keyboard or mouse equivalent; the lobby and room
  work with no camera at all (CLAUDE.md rule).
- The saved movement/swing mode choices still apply; training still starts in
  auto-move whatever was saved.

## Done when
- [x] Starting a game opens the camera flow first; "keyboard instead" and a
      denied permission both reach a playable game. e2e covers both, at both
      viewports (`e2e/webcam-default.e2e.ts`).
- [x] Training follows camera setup, and Skip works ("Camera ready: Train
      first / Skip training", offered once per device after practice's setup).
- [x] CSP unchanged; video still never leaves the browser (no server or
      protocol change; `spec/privacy.test.ts` passes).
- [x] README and CLAUDE.md say webcam is the default and still optional.

## As built (agent, 2026-10-21)
- `createCameraInput` gained `openSetup()` (safety notice unless remembered,
  then the choices) and `resume()` (start with the saved choices). The view
  opens the setup for any seated player; spectators get none.
- Every setup step has "Use keyboard instead" (it replaced Cancel); that,
  Escape, or "Keep playing" after a failure closes it and blurs focus, so
  Space swings instead of pressing the Camera button.
- After the visibility check, practice offers training once per device
  (`training-offered` in localStorage): "Train first" leaves the practice room
  and opens training with the camera restarted at once; "Skip training" goes
  on with the match. A room doesn't offer it (someone may be waiting).
- In training, "Use keyboard instead" counts as Keys only; Set up camera and
  Keys only stay on the coach.
