// Quick power calibration (task 25 round 3), for any game that reads power
// from how fast you move: basketball's push (`power0`/`power1` in
// shoot-pose.ts) and, once bowling lands, its roll (`speed0`/`speed1` in
// bowl-pose.ts). "Push soft, then push hard": the player's own soft and hard
// peak speeds become the ends of the power bar, so a small or slow mover, a
// long arm or a seat close to the camera still reaches the whole bar. Pure,
// unit tested (spec/basketball-power-calibration.test.ts).
//
// The ends sit a little outside the player's own moves (their soft push reads
// as a soft, not a zero, shot and their hard one as hard, not past the end).
// Like `thresholdsFrom`, a soft and hard too close together aren't a range: the
// defaults stay, and the result says so.

export interface PowerRange {
  /** Peak speed giving power 0. */
  lo: number;
  /** Peak speed giving power 1. */
  hi: number;
}

export interface PowerCalibration {
  range: PowerRange;
  /** True when the moves weren't clearly different (or missing): `range` is the defaults. */
  fellBack: boolean;
}

export interface PowerCalibrationRules {
  /** The hard move's median must be at least this many times the soft one's. */
  minRatio: number;
  /** Where a soft move lands on the bar (0..1), and a hard one. */
  softAt: number;
  hardAt: number;
  /** The range is never stretched past these (speeds a camera can't really see). */
  floor: number;
  ceiling: number;
}

/** First guesses, like every camera number until recordings replace them. */
export const DEFAULT_POWER_RULES: PowerCalibrationRules = { minRatio: 1.5, softAt: 0.2, hardAt: 0.9, floor: 0.5, ceiling: 40 };

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The power bar's ends from a player's soft and hard moves' peak speeds. */
export function powerRangeFrom(soft: readonly number[], hard: readonly number[], defaults: PowerRange, rules: PowerCalibrationRules = DEFAULT_POWER_RULES): PowerCalibration {
  const fallback = { range: { ...defaults }, fellBack: true };
  const ok = (xs: readonly number[]) => xs.length > 0 && xs.every((x) => Number.isFinite(x) && x > 0);
  if (!ok(soft) || !ok(hard)) return fallback;
  const s = median(soft);
  const h = median(hard);
  if (!(h >= s * rules.minRatio)) return fallback;
  // the line through (s, softAt) and (h, hardAt), read at 0 and 1
  const per = (h - s) / (rules.hardAt - rules.softAt);
  const lo = Math.max(rules.floor, s - rules.softAt * per);
  const hi = Math.min(rules.ceiling, h + (1 - rules.hardAt) * per);
  if (!(hi - lo >= 1)) return fallback;
  return { range: { lo: Math.round(lo * 100) / 100, hi: Math.round(hi * 100) / 100 }, fellBack: false };
}
