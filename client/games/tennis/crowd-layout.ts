import { COURT } from "../../../shared/games/tennis/sim.ts";

// Where the crowd sits, as plain numbers (no Three.js), so it can be tested
// and so task 19 (crowd reactions) can drive one section at a time.
//
// The arena is laid out in its own frame, for a camera behind the +z
// baseline: the "left" stand is at -x, the "right" stand at +x and the
// "front" stand (the end stand the camera looks at) at -z, split down its
// middle aisle into frontLeft (-x) and frontRight (+x). The seat-1 camera
// sees the whole arena turned round (`buildStadium(scene, true)`), so these
// names are always the sides as seen on this client's screen, not world
// sides or seats: mapping a seat to a side is task 19's job.

export const CROWD_SECTIONS = ["left", "right", "frontLeft", "frontRight"] as const;
export type CrowdSection = (typeof CROWD_SECTIONS)[number];

/** Grass inside the low walls. */
export const INNER = { halfW: COURT.halfW + 5, halfL: COURT.halfL + 6 } as const;
export const TIERS = 6;
export const TIER_DEPTH = 1.1;
export const TIER_RISE = 0.6;
export const WALL_H = 1;
/** Seat pitch along a tier. */
export const SEAT_PITCH = 0.62;
/** Share of seats with someone in them. */
export const OCCUPANCY = 0.82;

export interface Stand {
  /** centre of the stand's front edge */
  x: number;
  z: number;
  /** length along the wall */
  length: number;
  /** rotation about y: the stand rises away from the court (local -z) */
  angle: number;
  /** aisles (stairs) as local-x centres; no seats within AISLE_HALF of them */
  aisles: number[];
}

export const AISLE_HALF = 0.55;

export const STANDS: Record<"left" | "right" | "front", Stand> = (() => {
  const sideLength = INNER.halfL * 2 - 4;
  const frontLength = INNER.halfW * 2 - 2;
  return {
    left: { x: -(INNER.halfW + 0.6), z: -2, length: sideLength, angle: Math.PI / 2, aisles: [-sideLength / 6, sideLength / 6] },
    right: { x: INNER.halfW + 0.6, z: -2, length: sideLength, angle: -Math.PI / 2, aisles: [-sideLength / 6, sideLength / 6] },
    front: { x: 0, z: -(INNER.halfL + 0.6), length: frontLength, angle: 0, aisles: [0] },
  };
})();

/** A point in a stand's local frame, in the arena's frame. */
export function standToArena(s: Stand, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  return { x: s.x + c * lx + n * lz, y: ly, z: s.z - n * lx + c * lz };
}

export interface CrowdSeat {
  section: CrowdSection;
  /** Feet of the person, in the arena's frame. */
  x: number;
  y: number;
  z: number;
  /** Rotation about y that faces the court. */
  facing: number;
  /** 0 is the front row. */
  tier: number;
}

export interface CrowdLayout {
  /** Every occupied seat, grouped by section in CROWD_SECTIONS order. */
  seats: CrowdSeat[];
  /** Each section's run in `seats` (and in the crowd's instanced meshes). */
  ranges: Record<CrowdSection, { start: number; count: number }>;
}

/** Seeded so the crowd is the same every time. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Local x positions of the seats along one tier of a stand, skipping its aisles. */
export function seatColumns(s: Stand): number[] {
  const xs: number[] = [];
  for (let x = -s.length / 2 + 0.4; x < s.length / 2 - 0.3; x += SEAT_PITCH) {
    if (s.aisles.every((a) => Math.abs(x - a) > AISLE_HALF)) xs.push(x);
  }
  return xs;
}

export function crowdLayout(seed = 42): CrowdLayout {
  const rand = rng(seed);
  const bySection: Record<CrowdSection, CrowdSeat[]> = { left: [], right: [], frontLeft: [], frontRight: [] };
  for (const [name, s] of Object.entries(STANDS) as [keyof typeof STANDS, Stand][]) {
    for (let t = 0; t < TIERS; t++) {
      const y = WALL_H + (t + 1) * TIER_RISE;
      for (const lx of seatColumns(s)) {
        if (rand() >= OCCUPANCY) continue;
        const p = standToArena(s, lx, y, -(t + 0.55) * TIER_DEPTH);
        const section: CrowdSection = name === "front" ? (lx < 0 ? "frontLeft" : "frontRight") : name;
        bySection[section].push({ section, ...p, facing: s.angle, tier: t });
      }
    }
  }
  const seats: CrowdSeat[] = [];
  const ranges = {} as CrowdLayout["ranges"];
  for (const section of CROWD_SECTIONS) {
    ranges[section] = { start: seats.length, count: bySection[section].length };
    seats.push(...bySection[section]);
  }
  return { seats, ranges };
}
