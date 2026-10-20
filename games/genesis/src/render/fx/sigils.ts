// GENESIS — the sigils' strokes (LIVING §3.6 "Sigils": original one-stroke glyphs, none of them Black & White's nor a
// bare primitive). The Touch traces the sigil of the miracle it casts in light (render/hand.ts) and the miracle burns
// it into the ground where it lands (render/fx/sigilfx.ts).
//
// ONE glyph per sigil, the same one everywhere: the strokes are the UI's recogniser templates (src/ui/unistroke.ts
// SHAPES, hook H8 — DOM-free data), the very shapes the sigil card shows and the player draws, so what the Touch traces
// and what lands on the ground is what was drawn. Here they are only fitted to a unit box (x right, y UP, the longer
// side spanning −1..1, the aspect kept) and resampled to an even polyline (equal arc length per sample), so a trace
// at a constant rate draws the whole stroke at a constant speed. A sigil with no template (a mod's power that brought
// none) draws the 'wisp' — an original stroke, never a bare spiral or circle.
//
// Which glyph a miracle draws comes from the content: the `sigil` field of the power whose command casts it
// (powers.json, `miracle.<kind>`, or a `disaster.spawn` of that kind — the meteor), so a mod's power with its own sigil
// draws its own; SIGIL_OF_MIRACLE (the sim's god/miracles.ts SIGILS) is the fallback. Pure data and arithmetic: no
// three.js, testable in Node.

import { BASE_PACK } from '../../data/index.ts';
import { SHAPES } from '../../ui/unistroke.ts';

/** the sigil of each miracle kind the sim sends (sim/god/miracles.ts `data.kind`, its SIGILS table) */
export const SIGIL_OF_MIRACLE: Readonly<Record<string, string>> = {
  water: 'drop', storm: 'anvil', lightning: 'fork', calm: 'ripple', forest: 'sprout', heal: 'knot', food: 'basket',
  fertility: 'seed', wood: 'log', teach: 'eye', fire: 'flame', fireball: 'trail', shield: 'arch', meteor: 'fall',
};

/** the glyph drawn for a sigil nobody authored (an invented miracle's) */
export const FALLBACK_SIGIL = 'wisp';

type P = [number, number];

/**
 * The wisp, for a sigil with no template: rising in a long S and curling back on itself into a small hooked tip —
 * one stroke, no closed primitive (screen coordinates, y down, like the templates).
 */
const WISP: P[] = [[-82, 88], [-32, 74], [2, 38], [-12, -2], [-2, -42], [36, -78], [74, -62], [58, -32], [34, -42]];

/** a sigil's raw stroke (screen coordinates, y down): the recogniser's template, else the wisp */
function rawStroke(id: string): P[] {
  const t = SHAPES[id];
  if (t && t.length >= 2) return t;
  return smoothThrough(WISP);
}

/** every sigil a stroke is drawn for: the templates' and the wisp */
export const SIGIL_IDS: readonly string[] = [...Object.keys(SHAPES), FALLBACK_SIGIL];

interface PowerLike { command?: string; params?: Record<string, unknown>; sigil?: string | null }

/** miracle kind / disaster kind → the `sigil` of the power that casts it, from the content (built once) */
let fromPowers: { miracle: Map<string, string>; disaster: Map<string, string> } | null = null;
function powerSigils(): { miracle: Map<string, string>; disaster: Map<string, string> } {
  if (fromPowers) return fromPowers;
  fromPowers = { miracle: new Map(), disaster: new Map() };
  const list = ((BASE_PACK as unknown as { powers?: PowerLike[] }).powers ?? []);
  for (const pw of list) {
    if (!pw.sigil || typeof pw.command !== 'string') continue;
    if (pw.command.startsWith('miracle.') && pw.command !== 'miracle.cast') fromPowers.miracle.set(pw.command.slice(8), pw.sigil);
    else if (pw.command === 'disaster.spawn' && typeof pw.params?.kind === 'string') fromPowers.disaster.set(pw.params.kind, pw.sigil);
  }
  return fromPowers;
}

/** the sigil a miracle of `kind` draws: the casting power's `sigil` field, else the sim's table, else the fallback */
export function sigilOfMiracle(kind: string): string {
  const P = powerSigils();
  const s = P.miracle.get(kind) ?? P.disaster.get(kind) ?? SIGIL_OF_MIRACLE[kind];
  return s && SHAPES[s] ? s : FALLBACK_SIGIL;
}

/**
 * The sigil of a disaster the god sends with one (a power whose command is `disaster.spawn` of that kind carries a
 * `sigil`: the meteor's `fall`) — null for a disaster no sigil sends (a volcano picked from the radial, nature's own)
 */
export function sigilOfDisaster(kind: string): string | null {
  const s = powerSigils().disaster.get(kind);
  return s && SHAPES[s] ? s : null;
}

/** a smooth curve through a few control points (Catmull–Rom), dense enough to resample */
function smoothThrough(ctrl: P[], steps = 16): P[] {
  const out: P[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

const cache = new Map<string, Float32Array>();

/**
 * The stroke of a sigil as `n` evenly spaced points (x, y pairs; y up; the longer side spans −1..1, centred), drawn in
 * the order the player draws it. Unknown ids get the wisp.
 */
export function sigilStroke(id: string, n = 96): Float32Array {
  const key = `${id}|${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = rawStroke(id);
  // fit: centred on its box, the longer side to −1..1, y flipped (screen y runs down; the glyph's up is up)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of raw) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = 2 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const pts: P[] = raw.map(([x, y]) => [(x - cx) * s, -(y - cy) * s]);
  // resample at equal arc length along the polyline
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const out = new Float32Array(n * 2);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const at = (i / (n - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < at) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (at - cum[j]) / seg));
    out[i * 2] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t;
    out[i * 2 + 1] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
  }
  cache.set(key, out);
  return out;
}
