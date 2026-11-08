import type { RoomEvent, RoomFormat } from "../protocol.ts";
import { archery } from "./archery/index.ts";
import { basketball } from "./basketball/index.ts";
import { boxing } from "./boxing/index.ts";
import { tennis } from "./tennis/index.ts";
import { track } from "./track/index.ts";

export interface SeatInput {
  seat: 0 | 1;
  input: unknown;
}

/** Something a step did, for logs and replies. `seat` set means it concerns that player. */
export interface GameEvent {
  type: string;
  seat?: 0 | 1;
  [field: string]: unknown;
}

export interface GameInstance {
  step(inputs: readonly SeatInput[]): GameEvent[];
  /**
   * Lag compensation (ADR 001): play `input` as if it had arrived `ticksAgo`
   * ticks ago, then replay to now. Applied only if it connects there and no
   * point was scored since; returns null otherwise and leaves the game as it
   * was, so the caller judges the input now instead.
   */
  rewind?(input: SeatInput, ticksAgo: number): GameEvent[] | null;
  snapshot(): unknown;
  /**
   * Set once the match is over. `score` is the headline result (sets won in
   * tennis); `format` and `sets` (games per finished set) are optional detail.
   * `winner: null` is a draw (boxing's exact tie on damage, task 30); no
   * other game has one.
   */
  finished(): { winner: 0 | 1 | null; score: [number, number]; format?: string; sets?: Array<[number, number]>; detail?: Record<string, unknown> } | null;
  /**
   * Task 27: what the match row keeps beyond the score, as JSON (track: the
   * event, times, hurdles). `finished().detail` for a finished match; this
   * for unlimited's row, stored when someone leaves. Others leave it out.
   */
  detail?(): Record<string, unknown>;
  botInputs(seat: 0 | 1): unknown[];
  /**
   * Basketball (ADR 003): the room passes each seat's late-shot grace, ticks,
   * from its measured round trip (`lateShotTicks`, capped at 9 = 150 ms).
   * Other games leave it out.
   */
  setLag?(seat: 0 | 1, ticks: number): void;
}

export interface GameDef {
  id: string;
  name: string;
  /** The room formats the host may pick, the default first. */
  formats: readonly RoomFormat[];
  /** Task 27: the events the host may pick, the default first (track: sprint, hurdles); most games have none. */
  events?: readonly RoomEvent[];
  /**
   * `endless`: no winner, play until everyone leaves (practice).
   * `format`: the game's own match format id; unknown values get its default.
   * `event`: the game's own event (task 27, track); unknown values get its default.
   */
  create(seed: number, options?: { endless?: boolean; format?: string; event?: string }): GameInstance;
}

export const games: Record<string, GameDef> = { tennis, archery, track, boxing, basketball };
