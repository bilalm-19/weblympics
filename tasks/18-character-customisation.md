# 18 Character customisation

Status: built on session A's branch (agent choices in the devlog entry "Task 18 built")
Model: Sonnet
Session: A, after 17 (needs accounts)

## Goal
A signed-in player picks how their character looks; everyone in the room sees
it.

## Decided (user, 2026-10-21)
Colours for shirt, shorts, skin and hair, plus a hat or hairstyle, all from a
fixed list. Good enough for now.

## Scope
- A fixed enum palette and list in `shared/` (so server and client share it).
  The look is stored on the profile as small enum values, validated on the
  server; anything outside the lists is rejected, never stored.
- The server puts each seat's look in the room state; `character.ts` renders it
  (colours as material parameters, hats and hair as a few primitives, flat
  shaded, no assets). Spectators see it too.
- A customise panel on the profile with a live preview; works at both viewports
  and by keyboard.
- Guests get a default look and cannot save one.
- The look is deleted with the account (task 17).

## Done when
- [x] Server rejects an out-of-list value (hostile client test:
      `spec/look.test.ts`, unit and against the running app).
- [x] Look saved, survives a restart (db reopened in `spec/look.test.ts`;
      page reload in `e2e/look.e2e.ts`), shows on both seats and to a
      spectator (room-state unit test and the e2e).
- [x] Both viewports checked; preview not clipped (`e2e/look.e2e.ts`).
- [x] CLAUDE.md layout and `spec/` updated.
