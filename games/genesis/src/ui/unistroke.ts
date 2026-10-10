// GENESIS — a $1-style unistroke recogniser for miracle gestures (CONTRACT.md §16.5). DOM-free (tests/ui-logic.test.ts).
//
// Wobbrock, Wilson & Li's $1 (resample to N points, scale, translate to the centroid, golden-section search over
// rotation, mean point distance), changed for casting:
//   * ORIENTATION-SENSITIVE: a V and a caret (^) are the same stroke turned over, a zigzag and a wave differ mostly in
//     corners, so the candidate is never rotated to its "indicative angle"; the search only tolerates ±25° of tilt;
//   * 1-D AWARE: a straight line (and an arrow) has no height to normalise — thin strokes are scaled uniformly, keeping
//     their aspect, so "line" is not inflated into a square;
//   * START- AND DIRECTION-FREE: every template is stored drawn forwards and backwards, and closed shapes (circle,
//     square, triangle, star, heart) from four starting points, so a circle drawn anticlockwise from the top matches.
// Shapes (powers.json `gesture`): spiral, zigzag, double-zigzag, circle, triangle, v, wave, square, star, heart, caret,
// line, tilde, arrow. A mod may add a power with a new gesture name and its own template (addTemplate).

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

// ───────────────────────────── the shapes ─────────────────────────────

const poly = (pts: Pt[], steps = 12): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < steps; k++) {
    const t = k / steps;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
  }
  out.push(pts[pts.length - 1]);
  return out;
};

/** raw template strokes (screen coordinates, y down), as a person draws them */
export const SHAPES: Record<string, Pt[]> = {
  circle: Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * 100, Math.sin(a) * 100] as Pt; }),
  spiral: Array.from({ length: 90 }, (_, i) => { const t = i / 89; const a = t * Math.PI * 5.2; const r = 8 + t * 100; return [Math.cos(a) * r, Math.sin(a) * r] as Pt; }),
  square: poly([[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]]),
  triangle: poly([[0, -100], [100, 80], [-100, 80], [0, -100]]),
  star: poly([[-60, 90], [0, -100], [60, 90], [-95, -25], [95, -25], [-60, 90]]),
  heart: (() => {
    const out: Pt[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = Math.PI + (i / 64) * Math.PI * 2;
      out.push([16 * Math.sin(t) ** 3 * 6, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 6]);
    }
    return out;
  })(),
  v: poly([[-80, -100], [0, 100], [80, -100]]),
  caret: poly([[-80, 100], [0, -100], [80, 100]]),
  zigzag: poly([[-100, -80], [-30, 80], [30, -80], [100, 80]]),
  'double-zigzag': poly([[-120, -60], [-80, 60], [-40, -60], [0, 60], [40, -60], [80, 60], [120, -60]]),
  wave: Array.from({ length: 80 }, (_, i) => { const t = i / 79; return [t * 300 - 150, Math.sin(t * Math.PI * 6) * 40] as Pt; }),
  tilde: Array.from({ length: 50 }, (_, i) => { const t = i / 49; return [t * 200 - 100, -Math.sin(t * Math.PI * 2) * 35] as Pt; }),
  line: poly([[-120, 0], [120, 0]], 30),
  arrow: poly([[-120, 0], [100, 0], [55, -40], [100, 0], [55, 40]]),
};

/**
 * more ways people draw the same shape (recognised as it, never shown): a zigzag of two to four turns, starting up or
 * down; a double zigzag of four to seven
 */
export const VARIANTS: Record<string, Pt[][]> = {
  zigzag: [
    poly([[-100, 80], [-30, -80], [30, 80], [100, -80]]),
    poly([[-120, -70], [-60, 70], [0, -70], [60, 70], [120, -70]]),
    poly([[-120, 70], [-60, -70], [0, 70], [60, -70], [120, 70]]),
  ],
  'double-zigzag': [
    poly([[-125, -60], [-75, 60], [-25, -60], [25, 60], [75, -60], [125, 60]]),
    poly([[-140, -60], [-100, 60], [-60, -60], [-20, 60], [20, -60], [60, 60], [100, -60], [140, 60]]),
    poly([[-120, 60], [-80, -60], [-40, 60], [0, -60], [40, 60], [80, -60], [120, 60]]),
  ],
};

/** closed shapes: also stored from other starting points */
const CLOSED = new Set(['circle', 'square', 'triangle', 'star', 'heart']);

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

/** an SVG polyline "points" attribute of a shape fitted in a box (help card, gesture hints) */
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
