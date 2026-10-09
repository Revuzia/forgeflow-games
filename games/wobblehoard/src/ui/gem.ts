// Tier gems (DESIGN 5.3, COLLECTION 9, UI.md 3.1): rarity is never colour-only, so every tier has a SHAPE (circle, diamond, hexagon, 4-point star,
// 6-point star, 8-point prism), a text label, and its colour. The colours come from theme.ts TIERS (the one place; the copies in core/rarity.ts
// are read by probes only), each gem is a faceted jewel (a light-to-dark gradient in the tier colour, an ink outline, a specular highlight),
// and Mythic wears the prism. Inline SVG, no assets; the gradients live in one hidden defs svg (stops set by setAttribute: CSP-safe).
// The Hoard's plinths, the detail card and the reveal plate reuse gemSvg(); the HUD name plate does too. Copy never names a gem shape.
import type { TierName } from '../contracts.ts';
import { TIER_NAMES, TIER_STYLE } from '../core/rarity.ts';
import { PALETTE, TIERS, TIER_IDS, mixHex } from './theme.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function starPath(points: number, outer: number, inner: number, rot = -Math.PI / 2): string {
  const n = points * 2;
  let d = '';
  for (let i = 0; i < n; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    d += `${i ? 'L' : 'M'}${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)} `;
  }
  return d + 'Z';
}
function polyPath(sides: number, r: number, rot = -Math.PI / 2): string {
  let d = '';
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    d += `${i ? 'L' : 'M'}${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)} `;
  }
  return d + 'Z';
}

/** The gem outline for a tier, in a 24x24 box. */
export function gemPath(tier: TierName): string {
  switch (TIER_STYLE[tier]?.gem) {
    case 'diamond': return polyPath(4, 9.5);
    case 'hexagon': return polyPath(6, 9.2);
    case 'star4': return starPath(4, 10.5, 4.2);
    case 'star6': return starPath(6, 10.5, 5.6);
    case 'prism8': return starPath(8, 10.5, 7.4, -Math.PI / 2);
    default: return 'M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z';
  }
}

/** The specular glint: a small bright ellipse up and left of the centre; it stays inside the narrowest gem (the 4-point star's core, radius 4.2). */
const GLINT = { cx: '10.3', cy: '9.7', rx: '1.35', ry: '.8', transform: 'rotate(-38 10.3 9.7)' };

export const tierLabel = (tier: TierName): string => TIER_NAMES[tier] ?? 'Common';
export const tierColour = (tier: TierName): string => TIERS[tier as keyof typeof TIERS]?.frame ?? PALETTE.cream;

let defs: SVGSVGElement | null = null;
const gradId = (tier: string): string => `wh-gem-${tier}`;
const stopEl = (offset: string, colour: string): SVGStopElement => {
  const s = document.createElementNS(SVG_NS, 'stop');
  s.setAttribute('offset', offset);
  s.setAttribute('stop-color', colour);
  return s;
};

/** One hidden svg with a gradient per tier (user-space, 24 grid): light top left, the tier colour, darker belly. Idempotent. */
function ensureGemDefs(): void {
  if (defs && defs.isConnected) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  const d = document.createElementNS(SVG_NS, 'defs');
  for (const id of TIER_IDS) {
    const g = document.createElementNS(SVG_NS, 'linearGradient');
    g.setAttribute('id', gradId(id));
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    g.setAttribute('x1', '5'); g.setAttribute('y1', '3'); g.setAttribute('x2', '19'); g.setAttribute('y2', '21');
    const t = TIERS[id];
    if (t.prism) {
      // the prism: the four spectrum colours across the stone
      t.prism.forEach((c, i, all) => g.append(stopEl(`${Math.round((i / (all.length - 1)) * 100)}%`, c)));
    } else {
      g.append(stopEl('0%', mixHex(t.frame, PALETTE.cream, 0.5)), stopEl('48%', t.frame), stopEl('100%', mixHex(t.frame, PALETTE.ink, 0.32)));
    }
    d.append(g);
  }
  svg.append(d);
  (document.body ?? document.documentElement).append(svg);
  defs = svg;
}

/** A decorative gem (aria-hidden: the tier label next to it carries the meaning). */
export function gemSvg(tier: TierName, cls = 'gem'): SVGSVGElement {
  ensureGemDefs();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('class', 'gem-body');
  p.setAttribute('stroke', PALETTE.ink);
  p.setAttribute('stroke-width', '1.4');
  p.setAttribute('stroke-linejoin', 'round');
  const hi = document.createElementNS(SVG_NS, 'ellipse');
  hi.setAttribute('class', 'gem-hi');
  for (const [k, v] of Object.entries(GLINT)) hi.setAttribute(k, v);
  hi.setAttribute('fill', PALETTE.cream);
  hi.setAttribute('fill-opacity', '.62');
  svg.append(p, hi);
  setGem(svg, tier);
  return svg;
}

/** Re-shape an existing gem in place (the name plate keeps one element). */
export function setGem(svg: SVGSVGElement, tier: TierName): void {
  const p = svg.querySelector('.gem-body') ?? svg.querySelector('path');
  if (!p) return;
  p.setAttribute('d', gemPath(tier));
  p.setAttribute('fill', TIERS[tier as keyof typeof TIERS] ? `url(#${gradId(tier)})` : tierColour(tier));
  svg.dataset.tier = tier;
}
