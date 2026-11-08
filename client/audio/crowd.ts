// The crowd (task 19, user 2026-11-08): one crowd placed by side. Each seat
// has a side of the stands; after a moment the winner's side cheers and the
// loser's side goes "aww" (never boos), and everyone hears both sides at
// once. Each side's sound is panned and weighted to where its stand is on
// this screen: a player's own side is nearer and louder, a spectator hears
// seat 1's side on the left and seat 2's on the right. Pure, so the table is
// tested (spec/crowd-reactions.test.ts); worked out on each screen from the
// snapshots, never sent.

export type Seat = 0 | 1;
/** How big the moment is: 0 a point (or a shot), 1 a game, 2 a set, 3 the match. */
export type Size = 0 | 1 | 2 | 3;
export type CrowdKind = "cheer" | "aww" | "applause";

/**
 * Where the stands are, as this game draws them:
 * - "sides": the two seats' stands are the screen's left and right
 *   (tennis, basketball, track); a player's own side is on their left.
 * - "ends": each seat's fans sit behind their own boxer (boxing's ring): a
 *   player's own side is behind them, the other side in front.
 * - "onlookers": a few people watching, not split by seat (archery, bowling).
 */
export type Stands = "sides" | "ends" | "onlookers";

export interface CrowdContext {
  /** This screen's seat; null for a spectator. */
  viewer: Seat | null;
  stands: Stands;
  /** Practice keeps the crowd, quieter (user, 2026-11-08). */
  practice: boolean;
  /** Training has no crowd at all, so the coach's words stay clear. */
  training?: boolean;
  /**
   * Which seat's stand is on the screen's left, for "sides". By default
   * `leftSide(viewer)`: a player's own (tennis and track turn round for seat
   * 2), seat 1 for a spectator. Basketball's bleachers never turn, so seat 1's
   * blue stand is always the left one.
   */
  leftSeat?: Seat;
}

/**
 * Something the crowd reacts to: whose side cheers and whose side awws, as
 * big as the moment. Either may be absent (a miss is only an "aww" from the
 * shooter's side; a basket only a cheer). Neither: both sides applaud (the
 * end of a round, a draw).
 */
export interface CrowdEvent {
  cheer?: Seat | null;
  aww?: Seat | null;
  size: Size;
}

export interface CrowdVoice {
  /** Whose fans: a seat, or null for onlookers who back nobody. */
  side: Seat | null;
  kind: CrowdKind;
  size: Size;
  /** -1 left .. 1 right. */
  pan: number;
  /** 0..1, before the master volume. */
  gain: number;
}

/** Practice: the crowd at this share of its level. */
export const PRACTICE_GAIN = 0.45;
/** The other side's stand, heard from a player's seat. */
export const FAR_GAIN = 0.6;
/** Onlookers are a few people, not a stadium. */
export const ONLOOKER_GAIN = 0.5;
/** How far a spectator hears each side to its own speaker. */
export const SPECTATOR_PAN = 0.7;
/** How far a player hears their own side (left) and the other side (right). */
export const PLAYER_PAN = 0.45;

export const otherSeat = (s: Seat): Seat => (s === 0 ? 1 : 0);

/**
 * Which seat's fans sit on the screen's left: a player's own (the arena turns
 * round for seat 2, so it is always the left stand); a spectator sees seat 1
 * (index 0) on the left.
 */
export function leftSide(viewer: Seat | null): Seat {
  return viewer ?? 0;
}

/** Where one side's stand sounds from on this screen: its pan and its weight. */
export function sidePlace(side: Seat, ctx: CrowdContext): { pan: number; gain: number } {
  const scale = ctx.practice ? PRACTICE_GAIN : 1;
  if (ctx.stands === "onlookers") return { pan: 0, gain: ONLOOKER_GAIN * scale };
  const left = ctx.leftSeat ?? leftSide(ctx.viewer);
  // a spectator: seat 1's side on the left speaker, seat 2's on the right (the ring is seen side-on too)
  if (ctx.viewer === null) return { pan: side === left ? -SPECTATOR_PAN : SPECTATOR_PAN, gain: scale };
  const mine = side === ctx.viewer;
  // the ring: your own fans behind you (centred, near), theirs in front (centred, further)
  if (ctx.stands === "ends") return { pan: 0, gain: (mine ? 1 : FAR_GAIN) * scale };
  return { pan: side === left ? -PLAYER_PAN : PLAYER_PAN, gain: (mine ? 1 : FAR_GAIN) * scale };
}

/**
 * The crowd's voices for one event on this screen: the cheering side and the
 * "aww" side, both heard at once, each placed where its stand is. Onlookers
 * aren't split by seat: they applaud a good moment and aww a bad one,
 * quietly, from the middle. Training: nothing.
 */
export function crowdVoices(e: CrowdEvent, ctx: CrowdContext): CrowdVoice[] {
  if (ctx.training) return [];
  const cheer = e.cheer ?? null;
  const aww = e.aww ?? null;
  if (ctx.stands === "onlookers") {
    const p = sidePlace(0, ctx);
    return [{ side: null, kind: cheer === null && aww !== null ? "aww" : "applause", size: e.size, ...p }];
  }
  if (cheer === null && aww === null) return ([0, 1] as const).map((side) => ({ side, kind: "applause" as const, size: e.size, ...sidePlace(side, ctx) }));
  const out: CrowdVoice[] = [];
  if (cheer !== null) out.push({ side: cheer, kind: "cheer", size: e.size, ...sidePlace(cheer, ctx) });
  if (aww !== null && aww !== cheer) out.push({ side: aww, kind: "aww", size: e.size, ...sidePlace(aww, ctx) });
  return out;
}

export type Section = "left" | "right" | "frontLeft" | "frontRight";

/** Which seat a tennis-style crowd section belongs to on this screen: the left stand and the front's left half are `leftSeat`'s. */
export function sectionSeat(section: Section, viewer: Seat | null, leftSeat: Seat = leftSide(viewer)): Seat {
  return section === "left" || section === "frontLeft" ? leftSeat : otherSeat(leftSeat);
}

/** The point's event: the winner's side cheers, the loser's awws. */
export const pointEvent = (winner: Seat, size: Size): CrowdEvent => ({ cheer: winner, aww: otherSeat(winner), size });
