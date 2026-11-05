import type { Look } from "../../../shared/look.ts";

// What the boxing scene draws (task 30, the 3D view), kept apart from the
// sim's snapshot: view.ts turns the server's state into this each frame, so
// the scene never reads the sim and the sim can change without touching it.

export type Guard = "high" | "low" | null;
export type Hand = "left" | "right";
export type Target = "head" | "body";
export type Outcome = "clean" | "blocked" | "slipped";

/**
 * A jab's `t` runs 0 (thrown) to 1 (landed: full extension, the moment the
 * server judges it), then 1 to 2 while the fist comes back to the guard
 * (`JAB_RETURN` units, so the return takes as long as the throw). At 2 or
 * more the glove is back and the jab can be dropped (null).
 */
export const JAB_RETURN = 1;

export interface BoxerView {
  /** The player's chosen colours and hat (shared/look.ts); the seat default when they have none. */
  look: Look;
  guard: Guard;
  /** Leaning away right now (a slip), to the boxer's own left or right. */
  slip: "left" | "right" | null;
  /** A jab in progress, see `JAB_RETURN`; null when none. Hands are the boxer's own. */
  jab: { hand: Hand; target: Target; t: number } | null;
  /** The most recent time this boxer was hit: outcome, where, and seconds since. */
  hit: { outcome: Outcome; target: Target; age: number } | null;
  ko: boolean;
  /** Which corner: glove colour (0 blue, 1 red). Defaults: `me` 0, `foe` 1. */
  seat?: 0 | 1;
}

export interface RingView {
  me: BoxerView;
  foe: BoxerView;
  /** Spectators: no "me", show both from the side (`me` is drawn on the left). */
  spectator: boolean;
}

/** Corner colours: seat 0 blue, seat 1 red (the same as the seat colours in the HUD). */
export const SEAT_COLOURS = [0x2f7fe0, 0xe0453a] as const;
