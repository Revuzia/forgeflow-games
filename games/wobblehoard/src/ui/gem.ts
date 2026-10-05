// Tier gems (DESIGN 5.3, COLLECTION 9): rarity is never colour-only, so every tier has a SHAPE (circle, diamond, hexagon, 4-point star,
// 6-point star, 8-point prism), a text label and its frame colour from core/rarity.ts TIER_STYLE. Inline SVG, no assets.
// SHELL-2b's Hoard reuses gemSvg() for the plinths and the detail card.
import type { TierName } from '../contracts.ts';
import { TIER_NAMES, TIER_STYLE } from '../core/rarity.ts';

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

export const tierLabel = (tier: TierName): string => TIER_NAMES[tier] ?? 'Common';
export const tierColour = (tier: TierName): string => TIER_STYLE[tier]?.frameHex ?? '#fff1d6';

/** A decorative gem (aria-hidden: the tier label next to it carries the meaning). */
export function gemSvg(tier: TierName, cls = 'gem'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', gemPath(tier));
  p.setAttribute('fill', tierColour(tier));
  p.setAttribute('stroke', '#14102a');
  p.setAttribute('stroke-width', '1.4');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  svg.dataset.tier = tier;
  return svg;
}

/** Re-shape an existing gem in place (the name plate keeps one element). */
export function setGem(svg: SVGSVGElement, tier: TierName): void {
  const p = svg.querySelector('path');
  if (!p) return;
  p.setAttribute('d', gemPath(tier));
  p.setAttribute('fill', tierColour(tier));
  svg.dataset.tier = tier;
}
