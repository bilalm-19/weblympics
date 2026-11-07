// ADR 001: a swing is judged at most 150 ms back, and no further than the
// client's measured round trip plus slack for jitter and the wait for the next
// tick and broadcast.

export const TICK_MS = 1000 / 60;
export const MAX_REWIND_TICKS = 9;
export const REWIND_MARGIN_MS = 50;

/**
 * How many ticks back a swing may be judged: back to the tick the player's
 * screen showed, but no further than their measured round trip plus a margin
 * allows, and never past MAX_REWIND_TICKS. No measured round trip means no
 * rewind: lag that hasn't been measured isn't forgiven.
 */
/**
 * Basketball (ADR 003): a shot that arrives after the buzzer counts within
 * the seat's measured round trip, capped at ADR 001's 150 ms. No margin and
 * no measured round trip means no grace.
 */
export function lateShotTicks(rtt: number | null): number {
  if (rtt === null || !Number.isFinite(rtt) || rtt <= 0) return 0;
  return Math.min(Math.ceil(rtt / TICK_MS), MAX_REWIND_TICKS);
}

export function rewindTicks(now: number, claimed: number | undefined, rtt: number | null): number {
  if (claimed === undefined || rtt === null) return 0;
  const byLag = Math.ceil((rtt + REWIND_MARGIN_MS) / TICK_MS);
  return Math.max(0, Math.min(now - claimed, byLag, MAX_REWIND_TICKS));
}
