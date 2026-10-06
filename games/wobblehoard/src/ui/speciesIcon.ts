// Species icons (COLLECTION 9.8): a small picture of every species for the Hoard, the gift shelf and the merge preview. Nothing is
// pre-rendered art and nothing is fetched: each icon is an inline SVG built from the species' REST SHAPE (physics/shape.ts restPoint,
// the same function the soft body is built from) seen from the play camera's angle, filled with the species' own palette
// (render/oklch.ts genomePalette of catalog speciesTemplateGenome: the colour the renderer draws), with its core glow, a soft gloss and
// its eyes. Cost: about 400 restPoint evaluations per species, once (cached as path data; each call clones a few SVG nodes).
// The silhouette variant (an unowned species) is the same outline in one flat tone.
import type { Genome } from '../core/genome.ts';
import { SPECIES, getSpecies, speciesTemplateGenome } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import { restPoint } from '../physics/shape.ts';
import { genomePalette, linearToSrgb } from '../render/oklch.ts';
import type { Rgb } from '../render/oklch.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = 96;
const PITCH = 0.3;   // the play camera looks down on the toy a little

interface IconData { outline: string; eyes: Array<[number, number, number]>; body: string; edge: string; light: string; core: string; coreAlpha: number; gloss: number; cx: number; cy: number; r: number }
const cache = new Map<string, IconData>();

const hex = (c: Rgb): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');

/** Fibonacci sphere directions (deterministic). */
function dirs(n: number): Float64Array {
  const out = new Float64Array(n * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * ga;
    out[i * 3] = Math.cos(a) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}
const DIRS = dirs(420);

function build(g: Genome): IconData {
  const R0 = 1;
  const p = [0, 0, 0];
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  // project every rest point: screen x right, screen y DOWN
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < DIRS.length / 3; i++) {
    restPoint(g.species, DIRS[i * 3], DIRS[i * 3 + 1], DIRS[i * 3 + 2], R0, p, 0);
    xs.push(p[0]); ys.push(-(p[1] * cp - p[2] * sp));
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) { minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // outline: the farthest projected point per angle bin around the centre, gaps filled, lightly smoothed
  const B = 72, rad = new Array<number>(B).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - cx, dy = ys[i] - cy;
    const b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * B) % B;
    rad[b] = Math.max(rad[b], Math.hypot(dx, dy));
  }
  for (let k = 0; k < 3; k++) for (let b = 0; b < B; b++) if (!rad[b]) rad[b] = Math.max(rad[(b + B - 1) % B], rad[(b + 1) % B]);
  const sm = rad.map((r, b) => (rad[(b + B - 1) % B] + 2 * r + rad[(b + 1) % B]) / 4);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = (VIEW * 0.84) / span;
  const pts = sm.map((r, b) => { const a = (b + 0.5) / B * 2 * Math.PI - Math.PI; return [VIEW / 2 + Math.cos(a) * r * k, VIEW / 2 + Math.sin(a) * r * k]; });
  // a closed smooth path: quadratic curves through each bin point, joined at the midpoints between neighbours
  const mid = (i: number): [number, number] => { const a = pts[i % B], b = pts[(i + 1) % B]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const m = mid(B - 1);
  let d = `M${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  for (let i = 0; i < B; i++) { const q = mid(i); d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }
  d += 'Z';
  // eyes on the front of the rest shape (an approximation of the renderer's face placement; enough for a 48-96 px icon)
  const ex = 0.2 + 0.14 * (g.eyeSpacing - 0.5), ey = 0.06 + 0.32 * (g.eyeHeight - 0.5);
  const er = (0.075 + 0.05 * (g.eyeSize - 0.5)) * k;
  const eyes: Array<[number, number, number]> = [];
  for (const s of [-1, 1]) {
    const l = Math.hypot(ex, ey, 1);
    restPoint(g.species, (s * ex) / l, ey / l, 1 / l, R0, p, 0);
    eyes.push([VIEW / 2 + (p[0] - cx) * k, VIEW / 2 + (-(p[1] * cp - p[2] * sp) - cy) * k, Math.max(2.2, er)]);
  }
  const pal = genomePalette(g);
  return {
    outline: d, eyes, body: hex(pal.body), edge: hex(pal.attenuation), light: hex(pal.glow), core: hex(pal.core),
    coreAlpha: 0.15 + 0.5 * (g.coreGlow ?? 0.5), gloss: 0.25 + 0.45 * (g.gloss ?? 0.5), cx: VIEW / 2, cy: VIEW / 2, r: (span * k) / 2,
  };
}

function dataOf(species: string): IconData | null {
  const hit = cache.get(species);
  if (hit) return hit;
  if (!getSpecies(species)) return null;
  try { const dd = build(speciesTemplateGenome(species as SpeciesId)); cache.set(species, dd); return dd; } catch { return null; }
}

let uid = 0;
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/**
 * The icon of a species as a fresh inline SVG (decorative: aria-hidden; the name is always written beside it). `silhouette`: one flat
 * tone (an unowned species, COLLECTION 9.2). An unknown species gets the fallback: a soft round blob.
 */
export function speciesIcon(species: string, opts: { silhouette?: boolean; cls?: string } = {}): SVGSVGElement {
  const svg = el('svg', { viewBox: `0 0 ${VIEW} ${VIEW}`, class: opts.cls ?? 'sp-icon', 'aria-hidden': 'true', focusable: 'false' });
  const d = dataOf(species);
  const outline = d ? d.outline : `M48 14a34 34 0 1 1 0 68a34 34 0 1 1 0-68z`;
  if (opts.silhouette || !d) {
    svg.append(el('path', { d: outline, class: 'sp-sil' }));
    return svg;
  }
  const id = `spi${++uid}`;
  const defs = el('defs', {});
  const g = el('radialGradient', { id: `${id}b`, cx: '42%', cy: '34%', r: '72%' });
  g.append(el('stop', { offset: '0%', 'stop-color': d.light }), el('stop', { offset: '58%', 'stop-color': d.body }), el('stop', { offset: '100%', 'stop-color': d.edge }));
  const c = el('radialGradient', { id: `${id}c`, cx: '50%', cy: '50%', r: '50%' });
  c.append(el('stop', { offset: '0%', 'stop-color': d.core, 'stop-opacity': d.coreAlpha.toFixed(2) }), el('stop', { offset: '100%', 'stop-color': d.core, 'stop-opacity': '0' }));
  defs.append(g, c);
  const shadow = el('ellipse', { cx: d.cx, cy: d.cy + d.r * 0.92, rx: d.r * 0.78, ry: d.r * 0.12, class: 'sp-shadow' });
  const body = el('path', { d: outline, fill: `url(#${id}b)` });
  const core = el('circle', { cx: d.cx, cy: d.cy + d.r * 0.12, r: d.r * 0.55, fill: `url(#${id}c)` });
  const gloss = el('ellipse', { cx: d.cx - d.r * 0.32, cy: d.cy - d.r * 0.42, rx: d.r * 0.24, ry: d.r * 0.13, fill: '#ffffff', 'fill-opacity': d.gloss.toFixed(2), transform: `rotate(-28 ${(d.cx - d.r * 0.32).toFixed(1)} ${(d.cy - d.r * 0.42).toFixed(1)})` });
  svg.append(defs, shadow, body, core, gloss);
  for (const [x, y, r] of d.eyes) {
    svg.append(el('ellipse', { cx: x.toFixed(1), cy: y.toFixed(1), rx: r.toFixed(1), ry: (r * 1.12).toFixed(1), fill: '#1b1030' }));
    svg.append(el('circle', { cx: (x - r * 0.32).toFixed(1), cy: (y - r * 0.38).toFixed(1), r: (r * 0.3).toFixed(1), fill: '#ffffff' }));
  }
  return svg;
}

/** Build every icon's path data ahead of time (idle time after boot), so the first Hoard opening is quick. */
export function warmSpeciesIcons(budgetMs = 8): () => void {
  let i = 0, stop = false;
  const step = (): void => {
    if (stop) return;
    const t0 = performance.now();
    while (i < SPECIES.length && performance.now() - t0 < budgetMs) dataOf(SPECIES[i++]);
    if (i < SPECIES.length) setTimeout(step, 30);
  };
  setTimeout(step, 0);
  return () => { stop = true; };
}
