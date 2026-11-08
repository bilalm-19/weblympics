import { Matrix4 } from "three";
import type { InstancedMesh } from "three";
import type { CrowdKind, Seat, Size } from "../../audio/crowd.ts";

// The stands' reactions (task 19), for any instanced crowd (tennis's arena,
// basketball's bleachers, boxing's ring): each fan belongs to a seat's side
// (or to nobody), and after a moment each side moves the way the crowd table
// (client/audio/crowd.ts) says: the cheering side jumps with arms up, the
// "aww" side slumps and shakes its head, applause is a small bob. Bigger
// moments: more fans join, higher and for longer. Under
// prefers-reduced-motion the crowd still changes pose (up, or slumped) but
// holds it, with no jumping loop or head shake. `crowdPose` is pure
// (spec/crowd-reactions.test.ts); only changed instances are re-uploaded,
// and nothing at all while the crowd is at rest.

export interface CrowdPose {
  /** Lift of the body, metres. */
  body: number;
  /** Lift of the head on top of that, metres. */
  head: number;
  /** Head turn about y, radians (the shake). */
  shake: number;
}

/** How long a reaction lasts, seconds, by size. */
export const reactionSeconds = (kind: CrowdKind, size: Size): number => (kind === "aww" ? 1.6 + 0.3 * size : kind === "applause" ? 1.6 + 0.4 * size : 1.8 + 0.6 * size);

/** The share of a side's fans who join in, by size: everyone for the match. */
export const joinShare = (size: Size): number => Math.min(1, 0.55 + 0.15 * size);

const REST: CrowdPose = { body: 0, head: 0, shake: 0 };

/** How strongly a reaction is going `t` seconds in, 0..1: in quickly, out over the last half second. */
export function reactionLevel(kind: CrowdKind, size: Size, t: number): number {
  const secs = reactionSeconds(kind, size);
  if (t < 0 || t >= secs) return 0;
  return Math.min(1, t / 0.15) * Math.min(1, (secs - t) / 0.5);
}

/**
 * One fan's pose `t` seconds into a reaction. `beat` is the fan's own phase
 * (radians) so a stand doesn't move as one; `reduced`: hold the pose, no loop.
 */
export function crowdPose(kind: CrowdKind, size: Size, t: number, beat: number, reduced: boolean): CrowdPose {
  const env = reactionLevel(kind, size, t);
  if (env === 0) return REST;
  if (kind === "cheer") {
    const lift = 0.16 + 0.07 * size;
    if (reduced) return { body: 0.1 * env, head: 0.06 * env, shake: 0 };
    const jump = Math.abs(Math.sin(t * (7 + size) + beat));
    return { body: lift * env * jump, head: lift * 0.25 * env * jump, shake: 0 };
  }
  if (kind === "aww") {
    const shake = reduced ? 0 : 0.35 * env * Math.sin(t * 9 + beat);
    return { body: -0.06 * env, head: -0.12 * env, shake };
  }
  const bob = reduced ? 0.5 : Math.abs(Math.sin(t * 10 + beat));
  return { body: 0.03 * env * bob, head: 0.01 * env * bob, shake: 0 };
}

export interface CrowdFans {
  bodies: InstancedMesh;
  heads: InstancedMesh;
  restBody: Matrix4[];
  restHead: Matrix4[];
}

export interface CrowdMotion {
  /** Starts each side's reaction; a side not named keeps doing what it was. */
  react(moves: { side: Seat | null; kind: CrowdKind; size: Size }[], now: number): void;
  /** Poses the crowd for this frame; `now` in seconds. */
  update(now: number): void;
  /** What each side is doing now, for tests: "cheer:2", "aww:0" or "". */
  state(side: Seat | null): string;
}

/**
 * Drives `fans`: `sideOf(i)` is fan i's side (a seat, or null for onlookers
 * who join every reaction named for null).
 */
export function createCrowdMotion(fans: CrowdFans, sideOf: (i: number) => Seat | null, reduced: () => boolean, seed = 7): CrowdMotion {
  const n = fans.restBody.length;
  const side = Array.from({ length: n }, (_, i) => sideOf(i));
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const beat = Array.from({ length: n }, () => rand() * Math.PI * 2);
  const keen = Array.from({ length: n }, () => rand());
  const current = new Map<Seat | null, { kind: CrowdKind; size: Size; at: number }>();
  const moved = new Uint8Array(n);
  const m = new Matrix4();
  const turn = new Matrix4();

  return {
    react(moves, now) {
      for (const mv of moves) current.set(mv.side, { kind: mv.kind, size: mv.size, at: now });
    },
    state(sd) {
      const c = current.get(sd);
      return c ? `${c.kind}:${c.size}` : "";
    },
    update(now) {
      if (current.size === 0) return;
      let dirty = false;
      const red = reduced();
      for (let i = 0; i < n; i++) {
        const r = current.get(side[i]);
        const join = r && keen[i] < joinShare(r.size);
        const p = join ? crowdPose(r.kind, r.size, now - r.at, beat[i], red) : REST;
        if (p === REST) {
          if (moved[i]) {
            fans.bodies.setMatrixAt(i, fans.restBody[i]);
            fans.heads.setMatrixAt(i, fans.restHead[i]);
            moved[i] = 0;
            dirty = true;
          }
          continue;
        }
        fans.bodies.setMatrixAt(i, m.makeTranslation(0, p.body, 0).multiply(fans.restBody[i]));
        m.makeTranslation(0, p.body + p.head, 0).multiply(fans.restHead[i]);
        if (p.shake) m.multiply(turn.makeRotationY(p.shake));
        fans.heads.setMatrixAt(i, m);
        moved[i] = 1;
        dirty = true;
      }
      if (dirty) {
        fans.bodies.instanceMatrix.needsUpdate = true;
        fans.heads.instanceMatrix.needsUpdate = true;
      }
      for (const [k, r] of current) if (now - r.at >= reactionSeconds(r.kind, r.size)) current.delete(k);
    },
  };
}
