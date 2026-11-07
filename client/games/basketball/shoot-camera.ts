// STUB (task 32 part 2): a no-op stand-in so the view typechecks and its e2e
// runs before the real camera (task 32 part 3, built in parallel) lands. It
// is to be replaced whole by that file; the interface below is the contract
// the view is wired against. With this stub the camera is never on, so the
// game plays on keys, the mouse and the buttons.

export interface ShootCallbacks {
  set(): void; // hands seen at the chest, still
  aim(aim: number): void; // -1..1, live
  shoot(power: number, aim: number): void; // aim already locked at push start
  pause(paused: boolean): void; // setup panel open/closed; practice holds meanwhile
}

export interface ShootCamera {
  on(): boolean; // camera running and shooting for you
  state(): "off" | "on" | "ok"; // for the ready panel
  setTurn(mine: boolean): void; // off-turn: sends nothing
  dispose(): void;
}

export function createShootCamera(_view: HTMLElement, _button: HTMLButtonElement, _chip: HTMLElement, _cb: ShootCallbacks): ShootCamera {
  return {
    on: () => false,
    state: () => "off",
    setTurn: () => {},
    dispose: () => {},
  };
}
