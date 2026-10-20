// GENESIS — the sigils' strokes (LIVING §3.6 "Sigils": original one-stroke glyphs, none of them Black & White's nor a
// bare primitive). The Touch traces the sigil of the miracle it casts in light (render/hand.ts) and the miracle burns
// it into the ground where it lands (render/fx/sigilfx.ts); the UI's recogniser templates are the UI team's (hook H8)
// — these are the drawn shapes only.
//
// Which glyph a miracle draws comes from the content: the `sigil` field of the power whose command casts it
// (powers.json, `miracle.<kind>`, or a `disaster.spawn` of that kind — the meteor), so a mod's power with its own sigil
// draws its own. SIGIL_OF_MIRACLE (the sim's god/miracles.ts SIGILS) is the fallback, and a sigil nobody authored
// draws 'wisp' — an original stroke, never a bare spiral or circle.
//
// Each glyph is authored as a few control points in a unit box (x right, y up, both −1..1) along the one stroke, then
// resampled into an even polyline (Catmull–Rom through the points, equal arc length per sample), so a trace at a
// constant rate draws the whole stroke at a constant speed. Pure data and arithmetic: no three.js, testable in Node.

import { BASE_PACK } from '../../data/index.ts';

/** the sigil of each miracle kind the sim sends (sim/god/miracles.ts `data.kind`, its SIGILS table) */
export const SIGIL_OF_MIRACLE: Readonly<Record<string, string>> = {
  water: 'drop', storm: 'anvil', lightning: 'fork', calm: 'ripple', forest: 'sprout', heal: 'knot', food: 'basket',
  fertility: 'seed', wood: 'log', teach: 'eye', fire: 'flame', fireball: 'trail', shield: 'arch', meteor: 'fall',
};

/** the glyph drawn for a sigil nobody authored (an invented miracle's) */
export const FALLBACK_SIGIL = 'wisp';

interface PowerLike { command?: string; params?: Record<string, unknown>; sigil?: string | null }

/** miracle kind → the `sigil` of the power that casts it, from the content (built once) */
let fromPowers: Map<string, string> | null = null;
function powerSigils(): Map<string, string> {
  if (fromPowers) return fromPowers;
  fromPowers = new Map();
  const list = ((BASE_PACK as unknown as { powers?: PowerLike[] }).powers ?? []);
  for (const pw of list) {
    if (!pw.sigil || typeof pw.command !== 'string') continue;
    if (pw.command.startsWith('miracle.') && pw.command !== 'miracle.cast') fromPowers.set(pw.command.slice(8), pw.sigil);
    else if (pw.command === 'disaster.spawn' && typeof pw.params?.kind === 'string') fromPowers.set(pw.params.kind, pw.sigil);
  }
  return fromPowers;
}

/** the sigil a miracle of `kind` draws: the casting power's `sigil` field, else the sim's table, else the fallback */
export function sigilOfMiracle(kind: string): string {
  const s = powerSigils().get(kind) ?? SIGIL_OF_MIRACLE[kind];
  return s && s in AUTHORED ? s : FALLBACK_SIGIL;
}

type P = [number, number];

/** a closed loop of n points round (cx, cy), radius r, starting at angle a0 and turning `turn` (+1 ccw) */
function loop(cx: number, cy: number, r: number, a0: number, n: number, turn = 1, rx = 1, ry = 1): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + turn * (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r * rx, cy + Math.sin(a) * r * ry]);
  }
  return out;
}

/** an almond (vesica) from tip a to tip b, its sides bulging w; one side then the other (a → b → a) */
function almond(ax: number, ay: number, bx: number, by: number, w: number, n: number): P[] {
  const out: P[] = [];
  const dx = bx - ax, dy = by - ay;
  const nx = -dy, ny = dx;
  for (let s = 0; s < 2; s++) {
    const sg = s === 0 ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      const t = s === 0 ? i / n : 1 - i / n;
      const b = Math.sin(t * Math.PI) * w * sg;
      if (s === 1 && i === 0) continue;
      out.push([ax + dx * t + nx * b, ay + dy * t + ny * b]);
    }
  }
  return out;
}

/** the authored control points of every glyph (LIVING §3.6 table, in order) */
const AUTHORED: Record<string, () => P[]> = {
  // a hook falling from the top that closes into a small loop at the bottom
  drop: () => [[0.05, 0.95], [0.18, 0.45], [0.2, 0.0], [0.08, -0.45], [-0.18, -0.68], [-0.38, -0.5], [-0.3, -0.22], [-0.05, -0.2], [0.12, -0.42]],
  // up, a flat top drawn right, down and back left under it (the open outline of an anvil cloud)
  anvil: () => [[-0.55, -0.85], [-0.6, -0.1], [-0.62, 0.55], [-0.1, 0.6], [0.45, 0.6], [0.85, 0.58], [0.6, 0.3], [0.2, 0.18], [-0.3, 0.16]],
  // down, back up half way, down again to the right (a forked bolt)
  fork: () => [[-0.35, 0.95], [-0.15, 0.4], [0.02, -0.1], [-0.12, 0.2], [-0.2, 0.38], [0.05, -0.15], [0.25, -0.55], [0.42, -0.95]],
  // a small closed loop, then a long level tail to the right
  ripple: () => [...loop(-0.6, 0.0, 0.26, -Math.PI / 2, 10), [-0.3, -0.02], [0.2, 0.0], [0.6, 0.02], [0.92, 0.0]],
  // up a stem, a leaf loop to the left, back to the stem, a leaf loop to the right
  sprout: () => [[0, -0.95], [0, -0.45], [0, 0.0], [-0.35, 0.18], [-0.62, 0.42], [-0.4, 0.55], [-0.12, 0.3], [0, 0.12], [0, 0.35], [0.32, 0.5], [0.6, 0.78], [0.35, 0.86], [0.1, 0.6], [0, 0.45], [0, 0.85]],
  // a figure-eight drawn once (a lemniscate, upright)
  knot: () => {
    const out: P[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      const d = 1 + Math.sin(t) * Math.sin(t);
      out.push([(0.62 * Math.sin(t) * Math.cos(t)) / d, (0.9 * Math.cos(t)) / d]);
    }
    return out;
  },
  // a U, then a handle looping over its top
  basket: () => [[-0.62, 0.15], [-0.55, -0.45], [-0.2, -0.72], [0.2, -0.72], [0.55, -0.45], [0.62, 0.15], [0.5, 0.62], [0.0, 0.9], [-0.5, 0.62], [-0.62, 0.15], [-0.4, 0.05]],
  // an almond outline, then a short stroke out of its tip
  seed: () => [...almond(0, 0.72, 0, -0.72, 0.42, 10), [0.08, 0.86], [0.22, 1.0]],
  // a long level stroke ending in a small loop (end grain)
  log: () => [[-0.95, 0.0], [-0.3, 0.02], [0.3, 0.0], [0.55, 0.0], ...loop(0.72, 0.0, 0.18, Math.PI, 10, -1)],
  // an almond outline with a small loop inside
  eye: () => [...almond(-0.9, 0.0, 0.9, 0.0, 0.32, 12), [-0.6, 0.0], [-0.25, 0.0], ...loop(0, 0, 0.2, Math.PI, 10, -1)],
  // up the left side, curl over the tip, down the right, a small inward flick
  flame: () => [[-0.25, -0.88], [-0.52, -0.35], [-0.38, 0.2], [-0.1, 0.62], [0.08, 0.95], [0.22, 0.62], [0.42, 0.15], [0.46, -0.35], [0.22, -0.85], [0.02, -0.62], [0.05, -0.35]],
  // a loop with a long tail trailing down-left
  trail: () => [...loop(0.42, 0.45, 0.32, -Math.PI * 0.75, 12), [0.12, 0.1], [-0.3, -0.35], [-0.92, -0.92]],
  // up, a round arch over, down, a short foot out at each end
  arch: () => [[-0.95, -0.82], [-0.62, -0.82], [-0.62, -0.2], [-0.6, 0.25], [-0.32, 0.65], [0.0, 0.78], [0.32, 0.65], [0.6, 0.25], [0.62, -0.2], [0.62, -0.82], [0.95, -0.82]],
  // a long diagonal down-right ending in a small burst loop
  fall: () => [[-0.92, 0.92], [-0.4, 0.4], [0.2, -0.2], [0.5, -0.5], ...loop(0.64, -0.64, 0.2, Math.PI * 0.75, 10)],
  // (a sigil the table does not name — an invented miracle's: a wisp rising in a long S and curling back on itself
  // into a small hooked tip — one stroke, no closed primitive)
  wisp: () => [[-0.82, -0.88], [-0.32, -0.74], [0.02, -0.38], [-0.12, 0.02], [-0.02, 0.42], [0.36, 0.78], [0.74, 0.62], [0.58, 0.32], [0.34, 0.42]],
};

export const SIGIL_IDS: readonly string[] = Object.keys(AUTHORED);

const cache = new Map<string, Float32Array>();

/**
 * The stroke of a sigil as `n` evenly spaced points (x, y pairs in −1..1), drawn in order. Unknown ids get the wisp.
 */
export function sigilStroke(id: string, n = 96): Float32Array {
  const key = `${id}|${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ctrl = (AUTHORED[id] ?? AUTHORED[FALLBACK_SIGIL])();
  // a dense Catmull–Rom curve through the control points
  const dense: P[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < 16; k++) {
      const t = k / 16, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);
  // resample at equal arc length
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const out = new Float32Array(n * 2);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out[i * 2] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
    out[i * 2 + 1] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
  }
  cache.set(key, out);
  return out;
}
