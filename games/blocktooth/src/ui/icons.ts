// BLOCKTOOTH v2 — procedural SVG glyphs for cards, the ability bar, markers and toasts (FEATURES_V2 §4.3).
// Lane L8. UI, but DOM-free and THREE-free at module load (node probes import it: _harness/probe_icons.ts).
//
// Each glyph is drawn in a 24×24 viewBox from a few simple primitives: a MAIN path filled with the
// family colour and an optional DETAIL path filled cream, both stroked 2 px in ink #1b1426 with
// `vector-effect: non-scaling-stroke`, fill-rule nonzero (holes are counter-wound). Original shapes,
// no image generation, no star-level badge (§0.7). `GLYPHS[id]` is the main path data; the cream detail
// path lives in `GLYPH_DETAIL` (glyphSvg draws both).
//
// Also here (pure, probe-tested): `barSlots()` — the §4.2 ability-bar ordering rule — and `badgeFor()`,
// the §4.3 level-badge rule.

import type { UpgradeDef } from '../core/types.ts';
import type { GlyphId } from '../v2types.ts';
import { TITANS } from '../data/titans.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';

export const INK = '#1b1426';
export const CREAM = '#f4ecd8';

// ─────────────────────────────── path helpers (pure) ───────────────────────────────
const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** full circle as two arcs; ccw = counter-wound (a hole inside a clockwise shape under nonzero) */
function circle(cx: number, cy: number, r: number, ccw = false): string {
  const s = ccw ? 0 : 1;
  return `M${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 ${s} ${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 ${s} ${f(cx - r)} ${f(cy)} Z`;
}
function ellipse(cx: number, cy: number, rx: number, ry: number, ccw = false): string {
  const s = ccw ? 0 : 1;
  return `M${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 ${s} ${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 ${s} ${f(cx - rx)} ${f(cy)} Z`;
}
function ring(cx: number, cy: number, r0: number, r1: number): string { return circle(cx, cy, r1) + ' ' + circle(cx, cy, r0, true); }
function poly(pts: readonly number[]): string {
  let s = `M${f(pts[0])} ${f(pts[1])}`;
  for (let i = 2; i < pts.length; i += 2) s += ` L${f(pts[i])} ${f(pts[i + 1])}`;
  return s + ' Z';
}
function rect(x: number, y: number, w: number, h: number): string { return `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`; }
/** n-point star (2n vertices), first tip at angle `rot` (deg, 0 = up) */
function star(n: number, R: number, r: number, cx = 12, cy = 12, rot = 0): string {
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 === 0 ? R : r;
    pts.push(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr);
  }
  return poly(pts);
}
/** an arc band (annular sector) from a0 to a1 degrees (0 = up, clockwise) */
function arcBand(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const P = (r: number, a: number): [number, number] => [cx + Math.sin((a * Math.PI) / 180) * r, cy - Math.cos((a * Math.PI) / 180) * r];
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const [x0, y0] = P(r1, a0), [x1, y1] = P(r1, a1), [x2, y2] = P(r0, a1), [x3, y3] = P(r0, a0);
  return `M${f(x0)} ${f(y0)} A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} A${f(r0)} ${f(r0)} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}
/** a spiral band: `turns` turns from radius r0 to r1, band width growing from w0 to w1 */
function spiral(cx: number, cy: number, turns: number, r0: number, r1: number, w0: number, w1: number): string {
  const N = 36, out: number[] = [], inn: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = t * turns * Math.PI * 2, r = r0 + (r1 - r0) * t, w = (w0 + (w1 - w0) * t) / 2;
    out.push(cx + Math.cos(a) * (r + w), cy + Math.sin(a) * (r + w));
    inn.push(cx + Math.cos(a) * Math.max(0.2, r - w), cy + Math.sin(a) * Math.max(0.2, r - w));
  }
  const pts: number[] = out.slice();
  for (let i = inn.length - 2; i >= 0; i -= 2) pts.push(inn[i], inn[i + 1]);
  return poly(pts);
}
/** a thin bar from (x0,y0) to (x1,y1), width w */
function bar(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * (w / 2), ny = (dx / L) * (w / 2);
  return poly([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny]);
}

// ─────────────────────────────── the glyph set (58) ───────────────────────────────
type GlyphDef = [main: string, detail?: string];

const DEFS: Record<GlyphId, GlyphDef> = {
  // survival
  heart: ['M12 21 L3.6 12.6 C1.1 10.1 1.6 5.6 5 4.6 C7.5 3.9 10 5 12 7.5 C14 5 16.5 3.9 19 4.6 C22.4 5.6 22.9 10.1 20.4 12.6 Z',
    'M6.2 8.2 C6.6 7.2 7.5 6.8 8.4 7 L8 8.6 C7.6 8.6 7.2 8.9 7.1 9.3 Z'],
  plate: ['M12 2.5 L20.5 5.5 V11.5 C20.5 16.5 16.8 20 12 21.5 C7.2 20 3.5 16.5 3.5 11.5 V5.5 Z',
    circle(8.6, 8.4, 1.4) + ' ' + circle(15.4, 8.4, 1.4)],
  drip: ['M12 2.5 C15 7 19 10.5 19 14.5 A7 7 0 0 1 5 14.5 C5 10.5 9 7 12 2.5 Z',
    'M11 10.5 H13 V13.3 H15.8 V15.3 H13 V18.1 H11 V15.3 H8.2 V13.3 H11 Z'],
  thorn: ['M3 17.5 Q12 9.5 21 17.5 L21 21 Q12 13.5 3 21 Z M5.2 16 L4.6 7.6 L9.2 14 Z M10.6 13.4 L12 4.6 L13.8 13.3 Z M15.1 14 L19.6 7.8 L18.9 16.1 Z'],
  fang: ['M3.5 3 H15.5 C15.5 9 13 14.5 9.5 19.5 C6 14.5 3.5 9 3.5 3 Z',
    'M18.5 12.5 C19.8 14.5 21 15.8 21 17.2 A2.5 2.5 0 0 1 16 17.2 C16 15.8 17.2 14.5 18.5 12.5 Z'],
  brick: [rect(2.5, 5, 11.5, 5.5) + ' ' + rect(15.5, 5, 6, 5.5) + ' ' + rect(2.5, 12.5, 5, 5.5) + ' ' + rect(9.5, 12.5, 12, 5.5)],
  halo: [ellipse(12, 6.5, 8.5, 3.2) + ' ' + ellipse(12, 6.5, 5.2, 1.5, true), circle(12, 16, 5)],
  bandage: ['M5 8 H19 A4 4 0 0 1 19 16 H5 A4 4 0 0 1 5 8 Z',
    'M11 9.3 H13 V11 H14.7 V13 H13 V14.7 H11 V13 H9.3 V11 H11 Z'],
  // mobility
  boot: ['M7 3 H13 V11.5 L19.5 13.8 C21.2 14.4 21.5 15.8 21.5 17 V20 H3.5 V16 C3.5 13.8 4.8 12.3 7 11.8 Z',
    rect(3.5, 17.2, 18, 1.4)],
  dash: ['M2.5 5 H7.5 L14 12 L7.5 19 H2.5 L9 12 Z M10 5 H15 L21.5 12 L15 19 H10 L16.5 12 Z'],
  hourglass: ['M5 2.5 H19 V5 C19 8.5 14.5 10.5 14.5 12 C14.5 13.5 19 15.5 19 19 V21.5 H5 V19 C5 15.5 9.5 13.5 9.5 12 C9.5 10.5 5 8.5 5 5 Z',
    'M8 19.5 C8 17.2 12 15.2 12 15.2 C12 15.2 16 17.2 16 19.5 Z'],
  // growth
  arrowUp: [rect(3, 3, 18, 18), 'M12 5.5 L18 12 H14.5 V18.5 H9.5 V12 H6 Z'],
  star: [star(4, 10, 3.2)],
  dice: ['M5 3 H19 A2 2 0 0 1 21 5 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 Z',
    circle(8, 8, 2) + ' ' + circle(16, 16, 2)],
  cycle: ['M12 5 A8 8 0 1 1 4.48 10.26 L7.3 11.29 A5 5 0 1 0 12 8 V10.5 L6.6 6.5 L12 2.5 Z'],
  magnet: ['M3.5 3 H9.5 V12 A2.5 2.5 0 0 0 14.5 12 V3 H20.5 V12 A8.5 8.5 0 0 1 3.5 12 Z',
    rect(3.5, 3, 6, 3.4) + ' ' + rect(14.5, 3, 6, 3.4)],
  reach: [arcBand(12, 13, 8, 10.5, -70, 70) + ' ' + 'M8 22 C7 18 7 16 8 13.5 L9.5 16 L10.5 12.5 L12 15.5 L13.5 12.5 L14.5 16 L16 13.5 C17 16 17 18 16 22 Z'],
  // offense
  claw: ['M3.5 4 C6.5 9 7.5 14 7.5 20.5 L9.5 20.5 C9.5 13 8.5 8 6 3 Z M9.5 3 C12.5 8 13.5 13 13.5 20.5 L15.5 20.5 C15.5 13 14.5 8 12 3 Z M15.5 3 C18.5 8 19.5 12 19.5 18.5 L21.5 18.5 C21.5 12 20.5 7 18 3 Z'],
  tempo: ['M1.5 12.5 L4 10 L7.5 13.5 L15 5.5 L17.5 8 L7.5 18.5 Z', 'M9.5 16.5 L20 5.5 L22.5 8 L12 19 Z'],
  reticle: [ring(12, 12, 6, 9), rect(11, 1.5, 2, 6.5) + ' ' + rect(11, 16, 2, 6.5) + ' ' + rect(1.5, 11, 6.5, 2) + ' ' + rect(16, 11, 6.5, 2)],
  burst: [star(8, 10.5, 5.2)],
  bullseye: [ring(12, 12, 6.3, 10), circle(12, 12, 3.2)],
  exclaim: ['M9.3 2.5 H14.7 L13.6 15 H10.4 Z ' + circle(12, 18.8, 2.5)],
  fist: ['M4.5 9 C4.5 7 5.6 6 7.5 6 H17 C19 6 20 7.5 20 9.5 V15 C20 18.5 17.5 21 14 21 H10 C7 21 4.5 19 4.5 16 Z',
    rect(9, 6.3, 1.2, 5) + ' ' + rect(13, 6.3, 1.2, 5) + ' ' + rect(16.9, 6.5, 1.2, 4.8) + ' ' + 'M4.8 12.5 H12 V15 H5 Z'],
  links: ['M3.5 7 H11 A4 4 0 0 1 11 15 H3.5 A4 4 0 0 1 3.5 7 Z M4 9.5 A1.5 1.5 0 0 0 4 12.5 H10.5 A1.5 1.5 0 0 0 10.5 9.5 Z',
    'M13 9 H20.5 A4 4 0 0 1 20.5 17 H13 A4 4 0 0 1 13 9 Z M13.5 11.5 A1.5 1.5 0 0 0 13.5 14.5 H20 A1.5 1.5 0 0 0 20 11.5 Z'],
  chunk: [poly([3, 13, 7, 9.5, 11.5, 11, 11, 16, 6, 17.5]) + ' ' + poly([12.5, 6, 17, 3, 21, 6.5, 19.5, 10.5, 14, 10.5]) + ' ' + poly([13, 15, 17.5, 12.5, 21.5, 15.5, 19.5, 21, 14, 20.5])],
  wreck: [rect(3.5, 2, 17, 2.4) + ' ' + rect(11, 4, 2, 7) + ' ' + circle(12, 16, 6), circle(9.8, 14, 1.4)],
  // smash
  foot: [ellipse(12, 15.5, 5.5, 6.5) + ' ' + circle(5.6, 7.5, 2.1) + ' ' + circle(9.8, 4.6, 2.2) + ' ' + circle(14.4, 4.6, 2.2) + ' ' + circle(18.6, 7.5, 2.1)],
  ripple: [ellipse(12, 14.5, 10.5, 6.5) + ' ' + ellipse(12, 14.5, 7.4, 4.2, true), ellipse(12, 14.5, 3.8, 2) + ' ' + rect(11, 2.5, 2, 7.5)],
  bolt: ['M13.5 2 L5 13.5 H11 L9.5 22 L19 9.5 H13 Z'],
  // hook / ult
  hook: ['M15 2 H18 V14 A6 6 0 0 1 6 14 V11 H3 L7.5 5.5 L11.5 11 H9 V14 A3 3 0 0 0 15 14 Z'],
  megaphone: ['M2.5 9 H7 L16.5 3.5 V20.5 L7 15 H2.5 Z M7.5 15.3 L10 21 H7 L5 15.3 Z',
    rect(18.5, 11, 4, 2) + ' ' + bar(18.8, 7.6, 22, 5.6, 1.9) + ' ' + bar(18.8, 16.4, 22, 18.4, 1.9)],
  // kit — MOLO
  jaw: ['M2 3.5 H19.5 C21.5 3.5 22.3 5.4 21 7 L18 10.2 L16.4 7.4 L14.4 10.6 L12.4 7.4 L10.4 10.6 L8.4 7.4 L6.4 10.6 L4.4 7.4 L2 10 Z M2 20.5 H19.5 C21.5 20.5 22.3 18.6 21 17 L18 13.8 L16.4 16.6 L14.4 13.4 L12.4 16.6 L10.4 13.4 L8.4 16.6 L6.4 13.4 L4.4 16.6 L2 14 Z'],
  vortex: [spiral(12, 12, 2.25, 0.8, 9.2, 1.2, 3.4)],
  // kit — VOLT-KITE
  fork: ['M12.5 2 L6 12 H10.5 L6.5 22 L12.5 14.5 L14 21.5 L18.5 10.5 H14 L17 2 Z'],
  wire: [rect(2.5, 4, 3.2, 17.5) + ' ' + rect(18.3, 4, 3.2, 17.5), 'M5.7 6 Q12 16.5 18.3 6 V8.8 Q12 19.3 5.7 8.8 Z'],
  // kit — HEARTHBACK
  dome: ['M2.5 19 A9.5 9.5 0 0 1 21.5 19 Z ' + rect(1.5, 19, 21, 2.5), rect(10, 6.4, 4, 4.2)],
  lava: ['M12 2 C14 6 16 8.5 16 11 A4 4 0 0 1 8 11 C8 8.5 10 6 12 2 Z', ellipse(12, 18.5, 10, 3.2)],
  // kit — BRIARWICK
  turret: [rect(11, 12, 2, 9.5) + ' ' + 'M13 17.5 C15 14.5 18 14.3 20.5 15.4 C18.4 18 15.6 18.6 13 18.4 Z', 'M12 2.5 C16.5 5 17 10 12 13.5 C7 10 7.5 5 12 2.5 Z'],
  spore: [circle(12, 11, 6.2) + ' ' + circle(4.6, 17.5, 2.3) + ' ' + circle(19.4, 17.8, 2.1) + ' ' + circle(17.8, 4.2, 1.7) + ' ' + circle(5.6, 4.8, 1.5),
    circle(10, 9.4, 1.3) + ' ' + circle(14, 12.6, 1.1)],
  vine: ['M3 21.5 C3 14.5 11 14.5 11 8.5 C11 5.5 8.5 4.4 7 5.8 L5.3 4.2 C8 1.4 13.6 2.8 13.6 8.5 C13.6 16.4 5.6 16.4 5.6 21.5 Z',
    'M13.2 13 C16 10 20 10 21.8 12 C19.2 15.2 16 15 13.2 13 Z M5.8 9.4 C4.3 7.4 2.3 7.8 1.4 9.4 C2.9 11 4.9 11 5.8 9.4 Z'],
  // trigger-only
  flame: ['M12 2 C13 6 18 9 18 14.5 A6 6 0 0 1 6 14.5 C6 11 8 9.5 9 7 C10 9 10.5 10 11.5 10.5 C11 7.5 11 5 12 2 Z',
    'M12 12 C13 14 15 15 15 17 A3 3 0 0 1 9 17 C9 15.5 10.5 14.5 12 12 Z'],
  meteor: [poly([12.5, 10, 18.8, 8.6, 22, 13.8, 20.4, 20.2, 14.4, 21.6, 10.2, 16.8]),
    poly([2, 2, 13, 10.6, 11.4, 14]) + ' ' + poly([7, 1.8, 16, 8.8, 14.2, 9.8]) + ' ' + poly([1.8, 7.5, 10.4, 14.6, 9.8, 16.2])],
  snow: [star(6, 10.5, 2.6), circle(12, 12, 1.6)],
  // meta
  plus: ['M9.5 3 H14.5 V9.5 H21 V14.5 H14.5 V21 H9.5 V14.5 H3 V9.5 H9.5 Z'],
  lock: [rect(4.5, 10, 15, 11.5) + ' ' + 'M6.8 10 V7 A5.2 5.2 0 0 1 17.2 7 V10 H14.6 V7 A2.6 2.6 0 0 0 9.4 7 V10 Z', circle(12, 14.3, 1.6) + ' ' + rect(11.2, 15, 1.6, 3.6)],
  banish: [ring(12, 12, 8.6, 10.5), 'M5.5 8 L8 5.5 L12 9.5 L16 5.5 L18.5 8 L14.5 12 L18.5 16 L16 18.5 L12 14.5 L8 18.5 L5.5 16 L9.5 12 Z'],
  evo: [star(12, 11.2, 8.4) + ' ' + circle(12, 12, 5.6, true)],
  overload: [rect(3, 3, 18, 18), 'M13.4 4.8 L7.2 13 H11.4 L10.2 19.4 L16.8 10.6 H12.6 Z'],
  annex: ['M2 5.5 H9 L11 7.8 H22 V20.5 H2 Z', circle(16.2, 14.6, 3.2) + ' ' + rect(4.5, 11, 6.5, 1.5) + ' ' + rect(4.5, 14, 5, 1.5)],
  trafficLight: ['M8 2 H16 A1.5 1.5 0 0 1 17.5 3.5 V20.5 A1.5 1.5 0 0 1 16 22 H8 A1.5 1.5 0 0 1 6.5 20.5 V3.5 A1.5 1.5 0 0 1 8 2 Z',
    circle(12, 6.3, 2.2) + ' ' + circle(12, 12, 2.2) + ' ' + circle(12, 17.7, 2.2)],
  notice: ['M4.5 2 H15 L19.5 6.5 V22 H4.5 Z', rect(7, 6, 6, 1.5) + ' ' + rect(7, 9, 9.5, 1.5) + ' ' + ring(12.5, 16, 2, 3.8)],
  rush: [circle(14.5, 12, 8) + ' ' + rect(0.5, 7.5, 5, 1.8) + ' ' + rect(1.5, 11.1, 4.5, 1.8) + ' ' + rect(0.5, 14.7, 5, 1.8),
    rect(13.6, 6.5, 1.8, 6.3) + ' ' + bar(14.5, 12, 18.4, 14.6, 1.8)],
  coin: ['M4 8 V17.5 A8 3 0 0 0 20 17.5 V8 Z', ellipse(12, 8, 8, 3) + ' ' + rect(4, 11.4, 16, 1.2) + ' ' + rect(4, 14.6, 16, 1.2)],
  ribbon: [star(10, 8.4, 6.6, 12, 9) + ' ' + 'M8.2 13.5 L6 22.5 L9 20.8 L10.6 22.8 L12 15 Z M15.8 13.5 L18 22.5 L15 20.8 L13.4 22.8 L12 15 Z', circle(12, 9, 3.4)],
  swatch: [poly([2.8, 7.6, 8.4, 5, 13.4, 16, 7.8, 18.6]) + ' ' + poly([9.4, 4.2, 15.6, 4.2, 15.6, 16.4, 9.4, 16.4]) + ' ' + poly([15.8, 5.6, 21.4, 8.4, 16.8, 19.4, 13.4, 17.6])],
  key: [rect(2.5, 5, 19, 14), rect(2.5, 8, 19, 2.5) + ' ' + rect(5.5, 13, 4.2, 3.4) + ' ' + rect(12, 13.8, 7, 1.4)],
  till: [rect(5, 2.5, 14, 12.5) + ' ' + rect(1.8, 15, 15.2, 6),
    rect(10, 5.2, 4, 1.4) + ' ' + rect(7.8, 8.6, 8.4, 3.4) + ' ' + rect(4, 17.1, 6, 1.6)],
};

/** SVG main path data (viewBox 0 0 24 24) per glyph. */
export const GLYPHS: Record<GlyphId, string> = Object.fromEntries(
  (Object.keys(DEFS) as GlyphId[]).map((id) => [id, DEFS[id][0]]),
) as Record<GlyphId, string>;

/** Optional cream detail path per glyph ('' when none). */
export const GLYPH_DETAIL: Record<GlyphId, string> = Object.fromEntries(
  (Object.keys(DEFS) as GlyphId[]).map((id) => [id, DEFS[id][1] ?? '']),
) as Record<GlyphId, string>;

export const GLYPH_IDS: readonly GlyphId[] = Object.keys(DEFS) as GlyphId[];

// ─────────────────────────────── card → glyph (§4.3 iconFor) ───────────────────────────────
const ACTION_GLYPH: Record<string, GlyphId> = {
  spark: 'bolt', shockwave: 'ripple', heal: 'bandage', shield: 'plate', mass: 'arrowUp', xp: 'star',
  magnet: 'magnet', rubbleShot: 'chunk', frenzy: 'flame', cdReduce: 'hourglass', dashRefund: 'dash',
  meteor: 'meteor', arc: 'fork', magma: 'lava', bloom: 'turret', slowField: 'snow', ultCharge: 'megaphone',
};
const STAT_GLYPH: Record<string, GlyphId> = {
  maxHp: 'heart', armor: 'plate', regen: 'drip', iframes: 'halo', thorns: 'thorn', lifesteal: 'fang',
  rubbleHeal: 'brick', moveSpeed: 'boot', dashCharges: 'dash', dashCooldown: 'dash', dashDistance: 'dash',
  pickupRadius: 'reach', massGain: 'arrowUp', xpGain: 'star', luck: 'dice', rerolls: 'cycle',
  damage: 'claw', attackRate: 'tempo', attackRange: 'reticle', area: 'burst', critChance: 'bullseye',
  critMult: 'exclaim', knockback: 'fist', chains: 'links', chainRange: 'links', projectiles: 'chunk',
  buildingDamage: 'wreck', smashDamage: 'foot', smashRadius: 'ripple', sparkChance: 'bolt',
  abilityCooldown: 'hook', abilityPower: 'hook', biteCleave: 'jaw', pulseEvery: 'ripple',
  vacuumRadius: 'vortex', arcForks: 'fork', wireDuration: 'wire', wireDamage: 'wire', shellCapacity: 'dome',
  stompDelay: 'foot', magmaDuration: 'lava', turretCap: 'turret', turretRate: 'turret', sporeHeal: 'spore',
  vineLength: 'vine', ultCharge: 'megaphone', ultPower: 'megaphone',
};

/** The action / stat → glyph tables (the probe checks every value exists in GLYPHS). */
export const ICON_TABLES = { action: ACTION_GLYPH, stat: STAT_GLYPH } as const;

type DefLookup = (id: string) => UpgradeDef | undefined;
const byId: DefLookup = (id) => UPGRADE_BY_ID[id];

function ownGlyph(u: UpgradeDef): GlyphId {
  for (const e of u.effects) if (e.trigger) { const g = ACTION_GLYPH[e.trigger.action]; if (g) return g; }
  for (const e of u.effects) if (e.stat) { const g = STAT_GLYPH[e.stat]; if (g) return g; }
  return 'star';
}

/** §4.3: evolution → its base card's glyph; trigger card → the first trigger's action glyph; else the first stat's. */
export function iconFor(u: UpgradeDef): GlyphId {
  if (u.evo) {
    const base = byId(u.evo.base);
    if (base && base !== u) return ownGlyph(base);
  }
  return ownGlyph(u);
}

// ─────────────────────────────── bar glyphs: distinct per slot (F4) ───────────────────────────────
/** What set a trigger off → a glyph (a trigger card's second-choice glyph on the bar). */
const ON_GLYPH: Record<string, GlyphId> = {
  hurt: 'exclaim', dash: 'boot', hit: 'fist', kill: 'fang', crit: 'bullseye', collapse: 'wreck', floorBreak: 'brick',
  rankUp: 'arrowUp', levelUp: 'star', pickup: 'reach', crush: 'foot', interval: 'hourglass', ability: 'hook',
};
/** last-resort glyphs by family, then a shared tail of glyphs few cards lead with */
const FAMILY_SPARE: Record<string, readonly GlyphId[]> = {
  survival: ['heart', 'plate', 'drip', 'halo', 'bandage'], mobility: ['boot', 'dash', 'tempo', 'reach'],
  growth: ['arrowUp', 'star', 'dice', 'cycle'], offense: ['claw', 'burst', 'reticle', 'bullseye', 'exclaim'],
  smash: ['wreck', 'brick', 'fist', 'chunk'], mutation: ['spore', 'vortex', 'fang'], ult: ['megaphone'],
};
const SPARE_TAIL: readonly GlyphId[] = ['halo', 'cycle', 'reticle', 'burst', 'exclaim', 'links', 'hourglass', 'fang', 'brick', 'dice',
  'tempo', 'fist', 'wreck', 'claw', 'bullseye', 'reach', 'boot', 'drip', 'thorn', 'chunk', 'meteor', 'snow', 'spore', 'vortex'];

/**
 * A card's glyph candidates, best first: iconFor (§4.3) · its other effects' action / stat glyphs ·
 * what triggers it · its family's spares · a shared tail. Pure; the bar picks the first one that no
 * earlier slot already shows (barGlyphs), so ten slots never repeat a glyph.
 */
export function glyphCandidates(u: UpgradeDef): GlyphId[] {
  const out: GlyphId[] = [];
  const add = (g: GlyphId | undefined) => { if (g && GLYPHS[g] && !out.includes(g)) out.push(g); };
  add(iconFor(u));
  const src = u.evo ? [byId(u.evo.base), u] : [u];
  for (const d of src) {
    if (!d) continue;
    for (const e of d.effects) {
      if (e.trigger) { add(ACTION_GLYPH[e.trigger.action]); add(ON_GLYPH[e.trigger.on]); }
      if (e.stat) add(STAT_GLYPH[e.stat]);
    }
  }
  const fam = u.tags[0] === 'evolution' ? u.tags[1] : u.tags[0];
  for (const t of [fam, ...u.tags]) for (const g of FAMILY_SPARE[t ?? ''] ?? []) add(g);
  for (const g of SPARE_TAIL) add(g);
  return out;
}

/** The glyph of each bar slot (null for the `+N` slot): in slot order, each card's first candidate no earlier slot uses. */
export function barGlyphs(ids: readonly (string | null)[], defOf: DefLookup = byId): (GlyphId | null)[] {
  const used = new Set<GlyphId>();
  return ids.map((id) => {
    const d = id ? defOf(id) : undefined;
    if (!d) return null;
    const c = glyphCandidates(d);
    const g = c.find((x) => !used.has(x)) ?? c[0];
    used.add(g);
    return g;
  });
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
}
/** The ability-bar slot face (hud_v2.css .bt-slot centre) and the minimum fill contrast against it. */
export const SLOT_BG = '#fbf5e6';
export const SLOT_MIN_CONTRAST = 1.9;
/**
 * The bar's glyph fill: the family colour, deepened toward a saturated mid-tone until it separates
 * from the cream slot face (MOLO's cream kit accent, the cream ult family, pale tan / gold would
 * otherwise read as an ink outline on nothing); never darker than the ink-stroke's own weight, so it
 * never goes dark-on-dark either (luminance kept ≥ 0.12).
 */
export function barFill(u: UpgradeDef): string {
  let c = familyColor(u);
  const deep = DEEPEN[c.toLowerCase()] ?? '#b0612a';
  for (let i = 0; i < 12 && contrast(c, SLOT_BG) < SLOT_MIN_CONTRAST; i++) c = mix(c, deep, 0.2);
  return luminance(c) < 0.12 ? mix(c, '#ffffff', 0.35) : c;
}
/** hue-keeping deep targets for the pale family colours */
const DEEPEN: Record<string, string> = {
  '#ffd166': '#d9901a', '#f4ecd8': '#c98a2e', '#f1e4c8': '#3fae7f', '#c9a47a': '#9a6a3a', '#ff9ec7': '#d6457f', '#6ff3ff': '#1f9fb8',
};

// ─────────────────────────────── family colour + rarity frame ───────────────────────────────
export const FAMILY_COLORS: Readonly<Record<string, string>> = {
  survival: '#ff6f5e', mobility: '#4fb3b0', growth: '#ffd166', offense: '#e63946', smash: '#c9a47a',
  mutation: '#a07ce8', ult: '#f4ecd8',
  // kit / hook: the titan's canonical accent (familyColor resolves it); these are the fallbacks
  kit: '#4fb3b0', hook: '#4fb3b0',
  // 'trigger' / 'defense' never lead a card today; mapped so a future card never renders uncoloured
  trigger: '#ffd166', defense: '#ff6f5e',
};

function tagColor(tag: string | undefined, u: UpgradeDef): string {
  if (!tag) return FAMILY_COLORS.growth;
  if ((tag === 'kit' || tag === 'hook') && u.titan && TITANS[u.titan]) return TITANS[u.titan].colors.accent;
  return FAMILY_COLORS[tag] ?? FAMILY_COLORS.growth;
}

/** Family colour by tags[0]; an evolution uses tags[1] (its base card's family, §4.3). */
export function familyColor(u: UpgradeDef): string {
  if (u.tags[0] === 'evolution') return tagColor(u.tags[1], u);
  return tagColor(u.tags[0], u);
}

/** 'bt-frame-common|rare|epic|legendary|evolution' (shape + pattern, never colour-only; hud_v2.css). */
export function rarityFrameClass(u: UpgradeDef): string { return 'bt-frame-' + (u.evo ? 'evolution' : u.rarity); }

// ─────────────────────────────── rendering ───────────────────────────────
/** An inline <svg> string: main path in `fill`, detail path in cream, 2 px ink stroke. */
export function glyphSvg(id: GlyphId, fill: string, sizePx = 24): string {
  const main = GLYPHS[id] ?? GLYPHS.star;
  const det = GLYPH_DETAIL[id] ?? '';
  const st = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
  return `<svg class="bt-glyph" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true" focusable="false">` +
    `<path d="${main}" fill="${fill}" ${st}/>` +
    (det ? `<path d="${det}" fill="${CREAM}" ${st}/>` : '') + '</svg>';
}

// ─────────────────────────────── §4.2 bar ordering + §4.3 badge (pure) ───────────────────────────────
export const BAR_SLOTS = 10;

export interface BarSlot { id: string | null; more: number }

/** Score for the > 10 case: evo 1000 · legendary 500 · epic 300 · trigger 200 · rare 100 · +50 maxed · +10 × stacks. */
export function barScore(u: UpgradeDef, stacks: number): number {
  let s = 0;
  if (u.evo) s += 1000;
  else if (u.rarity === 'legendary') s += 500;
  else if (u.rarity === 'epic') s += 300;
  else if (u.effects.some((e) => !!e.trigger)) s += 200;
  else if (u.rarity === 'rare') s += 100;
  if (stacks >= u.maxStacks) s += 50;
  return s + 10 * stacks;
}

/**
 * §4.2: owned ids in pick order, perk cards excluded. ≤ 10 → all of them; otherwise the top 9 by
 * barScore (ties by pick order) shown in pick order + a `+N` slot (id null, more = hidden count).
 */
export function barSlots(order: readonly string[], owned: Readonly<Record<string, number>>, defOf: DefLookup = byId): BarSlot[] {
  const L: string[] = [];
  for (const id of order) {
    if ((owned[id] ?? 0) <= 0 || L.includes(id)) continue;
    const d = defOf(id);
    if (!d || d.perk) continue;
    L.push(id);
  }
  if (L.length <= BAR_SLOTS) return L.map((id) => ({ id, more: 0 }));
  const ranked = L.map((id, i) => ({ id, i, s: barScore(defOf(id) as UpgradeDef, owned[id] ?? 0) }));
  ranked.sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = ranked.slice(0, BAR_SLOTS - 1).sort((a, b) => a.i - b.i);
  const out: BarSlot[] = keep.map((k) => ({ id: k.id, more: 0 }));
  out.push({ id: null, more: L.length - keep.length });
  return out;
}

/** §4.3 badge text: evolution `EVO`; maxed `MAX`; 2+ stacks `L<n>`; otherwise '' (no badge). */
export function badgeFor(u: UpgradeDef, stacks: number): string {
  if (u.evo) return 'EVO';
  if (stacks >= u.maxStacks) return 'MAX';
  if (stacks >= 2) return 'L' + stacks;
  return '';
}
