// The five small pictures on the How to play cards (UI.md 6): inline SVG drawn in code (72 x 56, decorative, `aria-hidden`), coloured by classes that read the theme tokens
// (screens.css `.ga-*`), so they follow the modes. A squished blob, a stretched blob, a ring around a capsule, a mini dock, two blobs becoming one. No asset, no font.
import { iconPaths } from '../icons.ts';
import type { GuideArt } from './screenCopy.ts';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag: string, attrs: Record<string, string>, ...kids: Element[]): SVGElement => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
const path = (d: string, cls: string): SVGElement => el('path', { d, class: cls });
const circle = (cx: number, cy: number, r: number, cls: string): SVGElement => el('circle', { cx: String(cx), cy: String(cy), r: String(r), class: cls });
/** an icon of the kit (24 grid) as a group at (x, y) scaled by s */
const iconG = (name: string, x: number, y: number, s: number): SVGElement => el('g', { transform: `translate(${x} ${y}) scale(${s})`, class: 'ga-line' }, ...iconPaths(name).map((d) => path(d, 'ga-line')));

function squish(): SVGElement[] {
  return [
    el('ellipse', { cx: '36', cy: '51', rx: '25', ry: '4', class: 'ga-shadow' }),
    path('M10 42 C10 29 21 22 36 22 C51 22 62 29 62 42 C62 46 58 48 54 48 H18 C14 48 10 46 10 42Z', 'ga-amber ga-ink'),
    path('M16 41 C16 44 18 46 22 46 H50 C54 46 56 44 56 41', 'ga-shade'),
    path('M17 36 C19 31 25 27 31 27', 'ga-gloss'),
    circle(36, 11, 7, 'ga-cream ga-ink'),
    path('M6 36 L2 34 M66 36 L70 34', 'ga-cream-line'),
  ];
}
function stretch(): SVGElement[] {
  return [
    el('ellipse', { cx: '34', cy: '52', rx: '26', ry: '3.5', class: 'ga-shadow' }),
    path('M5 36 C5 24 14 18 25 20 C35 22 39 26 47 26 C55 26 62 29 62 36 C62 43 55 46 47 45 C39 44 35 49 25 51 C14 53 5 48 5 36Z', 'ga-amber ga-ink'),
    path('M12 33 C13 28 18 25 23 25', 'ga-gloss'),
    circle(58, 36, 5, 'ga-cream ga-ink'),
    path('M42 10 H64 M58 5 L64 10 L58 15', 'ga-cream-line'),
  ];
}
function capsule(): SVGElement[] {
  return [
    circle(36, 28, 22, 'ga-track'),
    path('M36 6 A22 22 0 1 1 14 28', 'ga-ring'),
    el('g', { transform: 'rotate(-35 36 28)' },
      path('M30 22 A6 6 0 0 0 30 34 H36 V22Z', 'ga-lagoon ga-ink'), path('M36 22 H42 A6 6 0 0 1 42 34 H36Z', 'ga-cream ga-ink'), path('M31 25 H35', 'ga-gloss')),
  ];
}
function tools(): SVGElement[] {
  const chip = (cx: number, name: string, on: boolean): SVGElement[] => [circle(cx, 28, 11, on ? 'ga-amber ga-ink' : 'ga-surface ga-edge'), iconG(name, cx - 7.4, 28 - 7.4, 0.62)];
  return [el('rect', { x: '1', y: '12', width: '70', height: '32', rx: '16', class: 'ga-dock' }), ...chip(15, 'hand', true), ...chip(36, 'cut', false), ...chip(57, 'snap', false)];
}
function hoard(): SVGElement[] {
  return [
    circle(14, 17, 8, 'ga-amber ga-ink'), circle(14, 40, 8, 'ga-lagoon ga-ink'),
    path('M27 28 H40 M35 22 L41 28 L35 34', 'ga-cream-line'),
    path('M46 36 C46 26 52 20 58 20 C65 20 70 26 70 34 C70 42 64 48 57 48 C50 48 46 43 46 36Z', 'ga-plum ga-ink'),
    path('M51 33 C52 29 55 26 58 26', 'ga-gloss'),
    iconG('sparkle', 54, 2, 0.55),
  ];
}
const DRAW: Record<GuideArt, () => SVGElement[]> = { squish, stretch, capsule, tools, hoard };

export function guideArt(kind: GuideArt): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 72 56', class: 'guide-art', 'aria-hidden': 'true', focusable: 'false' }, ...DRAW[kind]());
  return svg as SVGSVGElement;
}
