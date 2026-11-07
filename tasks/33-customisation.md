# 33 Customisation: more looks and a cleaner editor

Status: built on branch `customise-33` (2026-11-08), not merged; agent choices in the devlog entry "Task 33 built".
Model: Opus 5.5
Waits on: nothing. Task 31's agents run in parallel and don't edit `character.ts`.

## Context
Task 18 gave accounts a look: five values (shirt, shorts, skin, hair colour,
one hat or hairstyle) from fixed lists in `shared/look.ts`, stored as JSON
in `players.look`, drawn by `client/games/tennis/character.ts` in games and
by `client/ui/look-preview.ts` as SVG on the home screen. The user
(2026-11-08) wants a cleaner editor and many more options.

## Decided (user, 2026-11-08)
- More options, kept simple: clothes (incl. a suit and a skirt), more hair
  (incl. a fringe and a bob cut), eyewear, smiles, facial hair, eye shape,
  nose shape.
- A cleaner editor.

## Design (Claude's proposal, the agent may refine)
- **Look fields** (each a fixed list in `shared/look.ts`, validated on the
  server; anything outside the lists or any extra field refused):
  - top: tee, polo, hoodie, jersey, tank, suit jacket, dress; top colour
  - bottom: shorts, trousers, skirt; bottom colour
  - skin; hair colour; hair: short, buzz, fringe, bob, curly, long,
    ponytail, bun, afro, spiky, bald
  - headwear: none, cap, visor, headband, beanie
  - eyes: round, almond, sleepy, wide; brows
  - nose: button, small, long, wide
  - mouth: smile, grin, neutral, open
  - facial hair: none, stubble, moustache, goatee, beard
  - eyewear: none, round glasses, square glasses, sunglasses, goggles
- **Old looks keep working:** a schema step (never edit an old one) maps
  every stored task-18 look to the new shape (style -> hair or headwear,
  shirt -> top colour with a tee, shorts -> bottom colour with shorts), with
  a test that opens a database made by the previous version. Guests and the
  two seats' defaults get sensible new defaults; the demo accounts can still
  change their look.
- **Drawn in both places:** `character.ts` (low-poly 3D, flat-shaded, faces
  as bold simple shapes readable at court distance) and `look-preview.ts`
  (SVG, the home screen never loads Three.js). Every game that uses the
  character (tennis, boxing, and basketball and bowling being built) gets the
  new looks for free.
- **The editor** (`client/ui/profile.ts` customise section, or its own
  dialog): a big live preview, tabs (Face, Hair, Clothes, Extras), options
  as picture swatches, Save and Cancel, keyboard reachable, both viewports.

## Done when
- [x] The new lists in `shared/look.ts`; server refuses anything outside them
      (`spec/look.test.ts` extended); the schema step and its old-db test.
- [x] Every option drawn in 3D and SVG; the editor at both viewports;
      `e2e/look.e2e.ts` extended.
- [x] CLAUDE.md's looks rule, README (says nothing about looks) and spec agree.
- [x] `pnpm check` and `pnpm e2e --workers=1` green (726 specs; 198 e2e, port 8207).
