import { DEEP_SPOT, SPOTS, SWISH_BONUS } from "../../../shared/games/basketball/sim.ts";
import type { ShotResult, Window } from "../../../shared/games/basketball/sim.ts";

// Basketball's words (task 32): the call after a shot, the power bar's
// verdict and the spot line. Pure, so spec/basketball-calls.test.ts holds
// them; the view only puts them on screen. Nothing here decides a score:
// every number comes from the server's ShotResult.

/** The power bar takes this long to fill; then it falls for as long, and so on. */
export const FILL_SECONDS = 1;

/** The keys' and button's power bar while held: fills 0 to 1 in FILL_SECONDS, falls back, and again. */
export function heldPower(seconds: number): number {
  const t = (Math.max(0, seconds) / FILL_SECONDS) % 2;
  return t <= 1 ? t : 2 - t;
}

export type Verdict ="Too soft" | "Just right" | "Too hard";

/** The shot's power against its spot's make window. */
export function powerVerdict(power: number, w: Window): Verdict {
  if (power < w.lo) return "Too soft";
  if (power > w.hi) return "Too hard";
  return "Just right";
}

export interface Call {
  /** The big word: "SWISH! +3", "Off the rim", "Time's up". */
  text: string;
  /** The small line under it: how the points add up, so the stacking swish is plain ("4 + 1 swish"). */
  detail: string;
  /** How loud the crowd goes: a swish or the money ball is "big". */
  crowd: "big" | "cheer" | "groan";
}

/**
 * The call after a shot. A make names how it went in and what it scored; a
 * swish says its +1 stacks on the spot's points (a swished money ball reads
 * "+5", "4 + 1 swish"). In sudden death nothing is added, so no points show.
 */
export function shotCall(shot: Pick<ShotResult, "made" | "swish" | "rim" | "board" | "points" | "spot" | "suddenDeath" | "lost">): Call {
  if (shot.lost === "time") return { text: "Time's up", detail: "No shot before the buzzer", crowd: "groan" };
  const money = shot.spot === DEEP_SPOT;
  if (!shot.made) {
    const text = shot.rim ? "Off the rim" : shot.board ? "Off the board" : "Air ball!";
    return { text, detail: shot.suddenDeath ? "Sudden death" : "", crowd: "groan" };
  }
  const base = SPOTS[shot.spot].points;
  const word = shot.swish ? "SWISH!" : shot.board ? "Bank shot!" : shot.rim ? "Rattled in!" : "In!";
  if (shot.suddenDeath) return { text: word, detail: "Sudden death", crowd: shot.swish ? "big" : "cheer" };
  const detail = shot.swish ? `${base} + ${SWISH_BONUS} swish${money ? ", money ball" : ""}` : money ? `${base}, money ball` : "";
  return { text: `${word} +${shot.points}`, detail, crowd: shot.swish || money ? "big" : "cheer" };
}

/** The spot line: "Spot 3 of 5 · Wing three · 3 pts", sudden death or unlimited's random spot. */
export function spotLine(s: { format: string; spot: number; round: number; suddenDeath: boolean }, practice = false, solo = false): string {
  const sp = SPOTS[s.spot];
  if (s.suddenDeath) return `Sudden death · ${sp.name} · decides it`;
  const where = solo ? "Just me" : s.format === "unlimited" ? "Unlimited" : `Spot ${s.spot + 1} of ${SPOTS.length}`;
  return `${practice ? "Practice · " : ""}${where} · ${sp.name} · ${sp.points} pts`;
}

/** The line under it: the swish bonus stacks, said once per spot. */
export function bonusLine(spot: number, suddenDeath: boolean): string {
  if (suddenDeath) return "A make against a miss wins";
  const sp = SPOTS[spot];
  return spot === DEEP_SPOT ? `Money ball: a swish makes it ${sp.points + SWISH_BONUS}` : `A swish adds ${SWISH_BONUS}: ${sp.points + SWISH_BONUS} pts`;
}
