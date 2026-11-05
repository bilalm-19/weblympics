# ADR 002: Boxing: jabs, two guards and a slip, judged by the server when the punch lands

Status: accepted, 2026-11-05 (user, in the task 30 playtest discussion).
Implementation: task 30, `shared/games/boxing/`. Data behind the camera
numbers: `docs/playtest/boxing-2026-11-05-*.txt`, method in
`docs/camera-playtest.md`.

## In plain terms

You jab, to the head or the body. You defend three ways: a **high guard**
(both fists by your face) stops head jabs, a **low guard** (forearms across
your chest) stops body jabs, and a **slip** (lean your shoulders to one side)
makes a head jab miss. Body jabs beat a high guard and a slip; head jabs beat
a low guard. Standing in one guard all bout loses to the other target.

Your browser only ever says what you did: "jab, left hand, to the head, at my
time T", "high guard up", "slip left". It never says "I hit" or "I
dodged". The server decides on the tick the jab **lands**: it looks at the
other boxer's guard and lean at that moment in its own sim.

## Context

- Two people hit each other in real time over the network. Whatever rule
  decides a hit has to give lag no advantage the sim doesn't, and a client
  must not be able to claim one (CLAUDE.md: the server never trusts a client's
  claim of a hit).
- Always guarding cost nothing in the first version: one guard, and a guarded
  punch did 20%. The user asked for a reason not to.
- The camera is a laptop webcam, often with the player seated: the picture
  ends at mid-chest. The first two recordings showed the pose model's depth
  is noise (it put the wrist about 3 shoulder widths in front for every move)
  and it loses the hands by the face; the hand model sees them. A hook (a
  sideways fist) was lost by both models most of the time.

## Options

1. **Punch events with a fixed wind-up (the first version).** A jab lands
   200 ms after it is read, a hook 350 ms. Simple, but on a camera the read
   already comes near full extension, so the hit lands after the real fist has
   stopped: the user felt it as lag.
2. **Arms follow the player, a hit is a collision.** Send the arm pose 30
   times a second; the server collides gloves with heads. Most faithful, but
   it rests on depth, which the recordings showed is noise; and it is most of
   the time left before Saturday.
3. **Arm in or out (chosen).** A jab is the moment a fist goes from in to
   out (on camera: the hand model's palm grows past 1.35x its own resting
   size as it nears the lens). Target from the fist's height. The defender's
   guard and lean are states the server keeps. The arms on screen follow
   these states, not the raw pose.

## Decision

- **Punches:** jabs only, for keys, buttons, camera and the bot (user: "can
  just do jabs for now"; Claude: so a keyboard player can't out-hit a camera
  player who can't throw a hook). A jab carries its hand and target (head or
  body).
- **Defence:** the guard is a state, `high` / `low` / none, sent when it
  changes; one arm up is no guard (user, playtest 3). A slip is an event,
  `slip left` or `right`: the server starts a short slip window itself and
  ends it, so holding a lean buys nothing; the camera fires one when the
  shoulders tilt past a threshold and re-arms when they come back.
- **Judged at landing:** a jab lands a short time after it is thrown (the
  number is tuned in the playtest; on camera the read comes late in the
  punch, so it is kept short). On that tick: a head jab misses if the
  defender is leaning, is blocked by a high guard; a body jab is blocked by a
  low guard. Blocked does a small share of damage; a clean jab full damage.
- **A slip costs something:** it lasts a short window and can't be held; you
  can't punch while leaning. (Numbers in the playtest.)
- **The camera never decides:** it only turns your body into the same
  messages a key sends. The server checks rate (the punch cap) and order.

## Consequences

- A guard or a slip you start when you see the jab coming still counts if it
  is in place on the landing tick, so defence is a reaction, not only a
  prediction.
- Lag: you see the other's jab about 50-150 ms late. A jab is fast: mostly you
  defend by reading the other's stance, as in real boxing. A laggy defender
  has less time; this ADR does **not** compensate for that (ADR 001's rewind
  is tennis's). Revisit only if two-person play feels unfair.
- No arm pose goes over the network: only a few small state messages. Nothing
  about the body is stored or logged.
- Hooks are kept in code behind a switch for the camera (`TRIAL_BOX.hooks`),
  off, in case a later recording finds a signal.
