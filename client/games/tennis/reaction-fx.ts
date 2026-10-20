import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from "three";
import type { Group } from "three";
import type { Seat } from "../../../shared/games/tennis/sim.ts";
import type { Reaction, Weight } from "./point-call.ts";

// The players' reactions to a point (task 16), drawn over their heads on this
// screen only, from the server's score snapshot (point-call.ts decides who
// reacts). The loser gets a frustrated scribble; the winner sparkles, more and
// bigger for a game, set or match, and pumps a fist (character.ts). Under
// reduced motion the scribble and the sparkles stand still.

/** How long a reaction lasts, ms: longer for a bigger moment. */
export const reactionMs = (weight: Weight): number => 1600 + 400 * weight;

// over the head: the head's top is about 2.1 m up
const OVER_HEAD = 2.55;

let scribbleTex: CanvasTexture | null = null;
/** A tangled dark scribble with a light edge, so it reads on grass and on the stands. */
function scribbleTexture(): CanvasTexture {
  if (scribbleTex) return scribbleTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  // a fixed loop of jittered circles (no randomness: every screen draws the same)
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const a = i * 0.83;
    const r = 30 + 18 * Math.sin(i * 1.7) + 8 * Math.cos(i * 2.9);
    pts.push([64 + r * Math.cos(a), 60 + r * 0.7 * Math.sin(a)]);
  }
  const path = () => {
    g.beginPath();
    g.moveTo(...pts[0]);
    for (const p of pts.slice(1)) g.lineTo(...p);
  };
  g.lineJoin = g.lineCap = "round";
  g.strokeStyle = "#ffffffd0";
  g.lineWidth = 11;
  path();
  g.stroke();
  g.strokeStyle = "#1d1b2a";
  g.lineWidth = 5;
  path();
  g.stroke();
  scribbleTex = new CanvasTexture(c);
  scribbleTex.colorSpace = SRGBColorSpace;
  return scribbleTex;
}

let sparkleTex: CanvasTexture | null = null;
/** A four-pointed star, gold with a white middle. */
function sparkleTexture(): CanvasTexture {
  if (sparkleTex) return sparkleTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.translate(32, 32);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 30 : 8;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    g.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  g.closePath();
  g.fillStyle = "#ffd426";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "#ffffff";
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 6, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.fill();
  sparkleTex = new CanvasTexture(c);
  sparkleTex.colorSpace = SRGBColorSpace;
  return sparkleTex;
}

const MAX_SPARKLES = 17;

interface Active {
  reaction: Reaction;
  weight: Weight;
  at: number;
}

export interface ReactionFx {
  /** Start a reaction for `seat` (replacing any it was showing). */
  react(seat: Seat, reaction: Reaction, weight: Weight, now: number): void;
  /**
   * Move the effects on; returns, per seat, how far into a fist pump (0..1,
   * 0 = none) and a slump (0..1) the character should be, for character.ts.
   */
  update(now: number): [{ pump: number; slump: number }, { pump: number; slump: number }];
  /** "cheer:2" or "frustrated:0" per seat while showing, else "" (for the e2e). */
  state(seat: Seat): string;
  dispose(): void;
}

/** One effect set per player, parented to the player so it walks with them. */
export function createReactionFx(players: readonly [{ group: Group }, { group: Group }], reducedMotion: () => boolean): ReactionFx {
  const make = (map: CanvasTexture, size: number) => {
    const s = new Sprite(new SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
    s.scale.setScalar(size);
    s.renderOrder = 10;
    s.visible = false;
    return s;
  };
  const rigs = players.map((p) => {
    const scribble = make(scribbleTexture(), 0.9);
    scribble.position.y = OVER_HEAD;
    const sparkles = Array.from({ length: MAX_SPARKLES }, () => make(sparkleTexture(), 0.3));
    p.group.add(scribble, ...sparkles);
    return { scribble, sparkles };
  });
  const active: [Active | null, Active | null] = [null, null];

  const hide = (seat: Seat) => {
    rigs[seat].scribble.visible = false;
    for (const s of rigs[seat].sparkles) s.visible = false;
  };

  return {
    react(seat, reaction, weight, now) {
      hide(seat);
      active[seat] = { reaction, weight, at: now };
    },
    update(now) {
      const still = reducedMotion();
      const out: [{ pump: number; slump: number }, { pump: number; slump: number }] = [
        { pump: 0, slump: 0 },
        { pump: 0, slump: 0 },
      ];
      for (const seat of [0, 1] as const) {
        const a = active[seat];
        if (!a) continue;
        const ms = reactionMs(a.weight);
        const t = (now - a.at) / ms;
        if (t >= 1) {
          active[seat] = null;
          hide(seat);
          continue;
        }
        // in fast, out slow
        const env = Math.min(1, t * 6) * Math.min(1, (1 - t) * 4);
        const { scribble, sparkles } = rigs[seat];
        if (a.reaction === "frustrated") {
          scribble.visible = true;
          const size = 0.85 + 0.2 * a.weight;
          const mat = scribble.material;
          mat.opacity = env;
          if (still) {
            mat.rotation = 0;
            scribble.scale.setScalar(size);
          } else {
            // a fast angry wobble and a little jitter in size
            mat.rotation = Math.sin(now / 45) * 0.35 + now / 260;
            scribble.scale.setScalar(size * (1 + 0.08 * Math.sin(now / 37)));
          }
          out[seat].slump = env;
        } else {
          const n = Math.min(MAX_SPARKLES, 5 + 4 * a.weight);
          for (let i = 0; i < sparkles.length; i++) {
            const s = sparkles[i];
            s.visible = i < n;
            if (!s.visible) continue;
            const ang = (i / n) * Math.PI * 2;
            // a burst outward and upward around the head; standing still under reduced motion
            const r = still ? 0.55 : 0.3 + t * (0.9 + 0.25 * a.weight);
            const y = OVER_HEAD - 0.3 + (still ? 0.15 * Math.sin(ang * 2) : t * 0.8 + 0.15 * Math.sin(ang * 2));
            s.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r * 0.5);
            s.material.opacity = env;
            s.material.rotation = still ? 0 : t * 3 + i;
            s.scale.setScalar((0.22 + 0.06 * a.weight) * (still ? 1 : 0.8 + 0.4 * Math.abs(Math.sin(t * 9 + i))));
          }
          // a fist pump: up and down twice, or held up under reduced motion
          out[seat].pump = still ? env : env * (0.65 + 0.35 * Math.abs(Math.sin(t * Math.PI * 4)));
        }
      }
      return out;
    },
    state(seat) {
      const a = active[seat];
      return a ? `${a.reaction}:${a.weight}` : "";
    },
    dispose() {
      for (const seat of [0, 1] as const) {
        const { scribble, sparkles } = rigs[seat];
        for (const s of [scribble, ...sparkles]) {
          s.removeFromParent();
          s.material.dispose();
        }
      }
    },
  };
}
