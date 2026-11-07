// STUB (task 29 part 2): bowling's camera is task 29 part 3, built by another
// agent at this same path. This no-op stands in so the view typechecks and
// plays on keys and buttons; part 3 replaces the whole file and keeps this
// interface. The camera only ever sends what a key does: an aim, a throw.

export interface BowlCallbacks {
  /** -1..1, live; locks when the swing starts. */
  aim(aim: number): void;
  /** The release. */
  throw(speed: number, aim: number, spin: number): void;
  /** The setup panel opened (true) or closed (false); practice holds meanwhile. */
  pause(paused: boolean): void;
}

export interface BowlCamera {
  on(): boolean;
  state(): "off" | "on" | "ok";
  /** Off-turn the camera sends nothing. */
  setTurn(mine: boolean): void;
  dispose(): void;
}

export function createBowlCamera(_view: HTMLElement, _button: HTMLButtonElement, _chip: HTMLElement, _cb: BowlCallbacks): BowlCamera {
  return {
    on: () => false,
    state: () => "off",
    setTurn: () => {},
    dispose: () => {},
  };
}
