// GENESIS — a $1-style unistroke recogniser for the sigils (LIVING.md §3.6; was CONTRACT §16.5's gestures). DOM-free
// (tests/ui-logic.test.ts).
//
// Wobbrock, Wilson & Li's $1 (resample to N points, scale, translate to the centroid, golden-section search over
// rotation, mean point distance), changed for casting:
//   * ORIENTATION-SENSITIVE: the falling flame and the meteor are the same kind of stroke on opposite diagonals, the
//     ripple and the log a loop at either end of a level line, so the candidate is never rotated to its "indicative
//     angle"; the search only tolerates ±25° of tilt;
//   * 1-D AWARE: a long level stroke has no height to normalise — thin strokes are scaled uniformly, keeping their
//     aspect, so the log is not inflated into a square;
//   * START- AND DIRECTION-FREE: every template is stored drawn forwards and backwards, and closed sigils (the knot,
//     the basket) from four starting points.
// Sigils (powers.json `sigil`): drop, anvil, fork, ripple, sprout, knot, basket, seed, log, eye, flame, trail, arch,
// fall. A mod may add a power with a sigil of its own and its template (addTemplate).

export type Pt = [number, number];

const N = 64;
const SIZE = 250;
const ANGLE_RANGE = (25 * Math.PI) / 180;
const ANGLE_PRECISION = (2 * Math.PI) / 180;
const PHI = 0.5 * (-1 + Math.sqrt(5));
/** thinner than this (min side / max side) counts as a 1-D stroke */
const ONE_D = 0.3;
const HALF_DIAG = 0.5 * Math.sqrt(SIZE * SIZE + SIZE * SIZE);

export interface Template { name: string; points: Normalized }
export interface Recognition { name: string; score: number; distance: number; second: { name: string; score: number } | null }

function pathLength(p: Pt[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return d;
}

export function resample(points: Pt[], n = N): Pt[] {
  if (points.length < 2) return Array.from({ length: n }, () => [points[0]?.[0] ?? 0, points[0]?.[1] ?? 0] as Pt);
  const I = pathLength(points) / (n - 1);
  if (I <= 0) return Array.from({ length: n }, () => [points[0][0], points[0][1]] as Pt);
  const src = points.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [[src[0][0], src[0][1]]];
  let D = 0;
  for (let i = 1; i < src.length; i++) {
    const d = Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d;
      const q: Pt = [src[i - 1][0] + t * (src[i][0] - src[i - 1][0]), src[i - 1][1] + t * (src[i][1] - src[i - 1][1])];
      out.push(q);
      src.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < n) out.push([src[src.length - 1][0], src[src.length - 1][1]]);
  return out.slice(0, n);
}

function centroid(p: Pt[]): Pt {
  let x = 0, y = 0;
  for (const q of p) { x += q[0]; y += q[1]; }
  return [x / p.length, y / p.length];
}

function bbox(p: Pt[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** scale into the reference square: `uniform` keeps the aspect (lines, arrows, waves), else each axis fills it */
function scaleTo(p: Pt[], uniform: boolean): Pt[] {
  const b = bbox(p);
  const w = Math.max(b.w, 1e-6), hh = Math.max(b.h, 1e-6);
  const sx = uniform ? SIZE / Math.max(w, hh) : SIZE / w;
  const sy = uniform ? SIZE / Math.max(w, hh) : SIZE / hh;
  return p.map((q) => [q[0] * sx, q[1] * sy]);
}

/** a stroke too thin to stretch (its noise would become its shape) */
function isOneD(p: Pt[]): boolean {
  const b = bbox(p);
  return Math.min(b.w, b.h) / Math.max(b.w, b.h, 1e-6) < ONE_D;
}

function translateToOrigin(p: Pt[]): Pt[] {
  const c = centroid(p);
  return p.map((q) => [q[0] - c[0], q[1] - c[1]]);
}

function rotateBy(p: Pt[], a: number): Pt[] {
  const c = centroid(p), cos = Math.cos(a), sin = Math.sin(a);
  return p.map((q) => [(q[0] - c[0]) * cos - (q[1] - c[1]) * sin + c[0], (q[0] - c[0]) * sin + (q[1] - c[1]) * cos + c[1]]);
}

function pathDistance(a: Pt[], b: Pt[]): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  return d / n;
}

function distanceAtBestAngle(p: Pt[], t: Pt[]): number {
  let a = -ANGLE_RANGE, b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b, f1 = pathDistance(rotateBy(p, x1), t);
  let x2 = (1 - PHI) * a + PHI * b, f2 = pathDistance(rotateBy(p, x2), t);
  while (Math.abs(b - a) > ANGLE_PRECISION) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = pathDistance(rotateBy(p, x1), t); }
    else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = pathDistance(rotateBy(p, x2), t); }
  }
  return Math.min(f1, f2);
}

/**
 * The normalised forms a stroke is compared in (screen y down, like pointer events): aspect-preserving, and — for
 * strokes that are not thin — stretched to fill the square ($1's own form, tolerant of squashed circles). A candidate
 * is compared with a template in each form both have; the better distance counts.
 */
export interface Normalized { uniform: Pt[]; stretched: Pt[] | null }

export function normalize(points: Pt[]): Normalized {
  const r = resample(points);
  return { uniform: translateToOrigin(scaleTo(r, true)), stretched: isOneD(r) ? null : translateToOrigin(scaleTo(r, false)) };
}

// ───────────────────────────── the sigils ─────────────────────────────

const poly = (pts: Pt[], steps = 12): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < steps; k++) {
    const t = k / steps;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
  }
  out.push(pts[pts.length - 1]);
  return out;
};

/** points along a circle (screen y down: a growing angle turns clockwise on screen), from angle a0 to a1 */
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 24): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt; });

/** a quadratic curve from a through the pull of c to b */
const quad = (a: Pt, c: Pt, b: Pt, n = 16): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as Pt; });

/** a smooth stroke through the given points (Catmull-Rom) */
const smooth = (pts: Pt[], steps = 8): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

const join = (...parts: Pt[][]): Pt[] => {
  const out: Pt[] = [];
  for (const p of parts) for (const q of p) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) out.push(q); }
  return out;
};

/**
 * The sigils (LIVING.md §3.6, hook H8): original one-stroke glyphs, one per miracle — none is a bare primitive (no
 * circle, spiral, zigzag, triangle, V, square or star) and none is another game's. Raw template strokes in screen
 * coordinates (y down), as a person draws them; ids are powers.json's `sigil` field, the strokes the sim's query
 * 'sigils' describes in words.
 */
export const SIGILS: Record<string, Pt[]> = {
  // a hook falling from the top that closes into a small loop at the bottom
  drop: join(quad([28, -100], [24, -10], [-12, 52]), arc(14, 56, 26, Math.PI, -Math.PI, 28)),
  // up, a flat top drawn right, down and back left under it (the open outline of an anvil cloud)
  anvil: poly([[-62, 100], [-62, -62], [100, -62], [100, -26], [-24, -26]]),
  // down, back up half way, down again to the right (a forked bolt)
  fork: poly([[-34, -100], [0, 40], [-14, -30], [62, 100]]),
  // a small closed loop, then a long level tail to the right
  ripple: join(arc(-92, 0, 24, 0, -Math.PI * 2, 26), poly([[-68, 0], [132, 0]], 24)),
  // up a stem, a leaf loop to the left, back to the stem, a leaf loop to the right
  sprout: join(poly([[0, 100], [0, 0]], 10), quad([0, 0], [-70, -2], [-62, -64]), quad([-62, -64], [-12, -60], [0, -28]),
    quad([0, -28], [70, -34], [62, -98]), quad([62, -98], [10, -92], [0, -58])),
  // a figure-eight drawn once
  knot: Array.from({ length: 65 }, (_, i) => { const t = (i / 64) * Math.PI * 2; return [62 * Math.sin(2 * t), -100 * Math.sin(t)] as Pt; }),
  // a U, then a handle looping over its top
  basket: join(smooth([[-92, -8], [-70, 62], [0, 84], [70, 62], [92, -8]]), smooth([[92, -8], [62, -70], [0, -100], [-62, -70], [-92, -8]])),
  // an almond outline, then a short stroke out of its tip
  seed: join(quad([0, -88], [80, -8], [0, 72]), quad([0, 72], [-80, -8], [0, -88]), poly([[0, -88], [14, -136]], 8)),
  // a long level stroke ending in a small loop (end grain)
  log: join(poly([[-132, 0], [68, 0]], 24), arc(92, 0, 24, Math.PI, -Math.PI, 26)),
  // an almond outline with a small loop inside
  eye: join(quad([-104, 0], [0, -80], [104, 0]), quad([104, 0], [0, 80], [-104, 0]), poly([[-104, 0], [-26, 0]], 8), arc(0, 0, 26, Math.PI, -Math.PI, 24)),
  // up the left side, curl over the tip, down the right, a small inward flick
  flame: smooth([[-46, 96], [-58, 40], [-40, -20], [-12, -72], [2, -104], [20, -94], [14, -70], [38, -24], [56, 36], [42, 92], [14, 70]]),
  // a loop with a long tail trailing down-left
  trail: join(arc(62, -62, 32, Math.PI * 0.75, Math.PI * 0.75 - Math.PI * 2, 28), poly([[39, -39], [-112, 112]], 22)),
  // up, a round arch over, down, a short foot out at each end
  arch: join(poly([[-112, 100], [-72, 100], [-72, 10]], 6), arc(0, 10, 72, Math.PI, Math.PI * 2, 24), poly([[72, 10], [72, 100], [112, 100]], 6)),
  // a long diagonal down-right ending in a small burst loop
  fall: join(poly([[-112, -112], [64, 64]], 24), arc(82, 82, 24, Math.PI * 1.25, Math.PI * 1.25 - Math.PI * 2, 26)),
};

/** how each sigil is drawn, in words (the sigil card's tooltips; the same words as the sim's query 'sigils') */
export const SIGIL_WORDS: Record<string, string> = {
  drop: 'a hook falling from the top that closes into a small loop at the bottom',
  anvil: 'up, a flat top drawn right, down and back left under it',
  fork: 'down, back up half way, down again to the right',
  ripple: 'a small closed loop, then a long level tail to the right',
  sprout: 'up a stem, a leaf loop to the left, back to the stem, a leaf loop to the right',
  knot: 'a figure-eight drawn once',
  basket: 'a U, then a handle looping over its top',
  seed: 'an almond outline, then a short stroke out of its tip',
  log: 'a long level stroke ending in a small loop',
  eye: 'an almond outline with a small loop inside',
  flame: 'up the left side, curl over the tip, down the right, a small inward flick',
  trail: 'a loop with a long tail trailing down-left',
  arch: 'up, a round arch over, down, a short foot out at each end',
  fall: 'a long diagonal down-right ending in a small burst loop',
};

/** the template strokes by id (the sigils; a mod's power may bring its own with addTemplate) */
export const SHAPES: Record<string, Pt[]> = SIGILS;

/** more ways people draw the same sigil (recognised as it, never shown) */
export const VARIANTS: Record<string, Pt[][]> = {
  // the anvil's top drawn a little shorter, the under-stroke a little longer
  anvil: [poly([[-62, 100], [-62, -60], [80, -60], [92, -22], [-40, -22]])],
  // the fork's second stroke from lower down
  fork: [poly([[-30, -100], [4, 30], [-6, -10], [58, 100]])],
};

/** closed sigils: also stored from other starting points */
const CLOSED = new Set(['knot', 'basket']);

function rotateStart(p: Pt[], frac: number): Pt[] {
  // drop the duplicated closing point, rotate the list, close again
  const open = p.slice(0, -1);
  const k = Math.round(open.length * frac) % open.length;
  const r = [...open.slice(k), ...open.slice(0, k)];
  r.push(r[0]);
  return r;
}

export class Unistroke {
  private templates: Template[] = [];

  constructor(shapes: Record<string, Pt[]> = SHAPES, variants: Record<string, Pt[][]> = VARIANTS) {
    for (const [name, pts] of Object.entries(shapes)) this.addTemplate(name, pts);
    for (const [name, list] of Object.entries(variants)) if (shapes[name]) for (const pts of list) this.addTemplate(name, pts);
  }

  /** add a shape (drawn as a person would draw it; screen y down): forwards, backwards and, if closed, from four starts */
  addTemplate(name: string, pts: Pt[]): void {
    const variants: Pt[][] = [];
    const closed = CLOSED.has(name) || Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6;
    const starts = closed ? [0, 0.25, 0.5, 0.75] : [0];
    for (const s of starts) {
      const base = s ? rotateStart(pts, s) : pts;
      variants.push(base, [...base].reverse());
    }
    for (const v of variants) this.templates.push({ name, points: normalize(v) });
  }

  names(): string[] { return [...new Set(this.templates.map((t) => t.name))]; }

  /**
   * Recognise a stroke (screen points). `allowed` limits the answer to these shapes (the gestures the powers use).
   * score 0..1 (1 = perfect); a score under ~0.72 is not a confident match.
   */
  recognize(points: Pt[], allowed?: ReadonlySet<string>): Recognition | null {
    if (points.length < 5 || pathLength(points) < 20) return null;
    const cand = normalize(points);
    // a line is straight: a stroke that wanders (a zigzag of any count, a scribble) is never one, however thin
    const straight = Math.hypot(points[points.length - 1][0] - points[0][0], points[points.length - 1][1] - points[0][1]) / pathLength(points);
    const best = new Map<string, number>();
    for (const t of this.templates) {
      if (allowed && !allowed.has(t.name)) continue;
      if (t.name === 'line' && straight < 0.8) continue;
      let d = distanceAtBestAngle(cand.uniform, t.points.uniform);
      if (cand.stretched && t.points.stretched) d = Math.min(d, distanceAtBestAngle(cand.stretched, t.points.stretched));
      if (d < (best.get(t.name) ?? Infinity)) best.set(t.name, d);
    }
    const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
    if (!ranked.length) return null;
    const sc = (d: number) => Math.max(0, 1 - d / HALF_DIAG);
    const [name, distance] = ranked[0];
    return { name, distance, score: sc(distance), second: ranked[1] ? { name: ranked[1][0], score: sc(ranked[1][1]) } : null };
  }
}

/** an SVG polyline "points" attribute of a sigil fitted in a box (the controls card, the sigil card) */
export function shapePolyline(name: string, size = 28, pad = 3): string {
  const pts = SHAPES[name];
  if (!pts) return '';
  const b = bbox(pts);
  const s = (size - pad * 2) / Math.max(b.w, b.h, 1e-6);
  const ox = (size - b.w * s) / 2, oy = (size - b.h * s) / 2;
  const step = Math.max(1, Math.floor(pts.length / 48));
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(`${((pts[i][0] - b.x) * s + ox).toFixed(1)},${((pts[i][1] - b.y) * s + oy).toFixed(1)}`);
  const last = pts[pts.length - 1];
  out.push(`${((last[0] - b.x) * s + ox).toFixed(1)},${((last[1] - b.y) * s + oy).toFixed(1)}`);
  return out.join(' ');
}
