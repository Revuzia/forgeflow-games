// The jelly display type renderer (UI.md 5), glyph-sheet scope: ensureJellyDefs, jellyWidth, jelly. (setJelly, fitJelly, pokeJelly and the
// wobble come after the owner approves the lettering.) Real text stays in the DOM; the drawing is an aria-hidden svg of <use> elements.
// Colours come from theme.ts; widths and finish live in jelly.css; a gradient stop is set by setAttribute (strict-CSP safe).
import { ADV, GLYPHS, SPACE_W, glyphFor, glyphId } from './glyphs.ts';
import { JELLY, mixHex } from '../theme.ts';
import type { JellyTone, MedalId, TierId } from '../theme.ts';

export type JellySize = 'sm' | 'md' | 'lg' | 'xl';
export type JellyToneId = JellyTone | TierId | MedalId;
export interface JellyOpts {
  size?: JellySize;
  tone?: JellyToneId;
  tag?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3';
  /** 0..1: each letter sits a little off the line and off the vertical (a fixed, repeating pattern: the lockup's bounce). Default 0 = a straight line. */
  bounce?: number;
}

const NS = 'http://www.w3.org/2000/svg';
/** The viewBox margin (glyph units): the outline reaches 15 beyond a centre line, the contact shadow 7 below. */
const PAD_X = 6, TOP = -9, VIEW_H = 124;
/** Paint order, back to front, with each pass's offset (glyph units): contact shadow, ink outline, darker shade, body, gloss. */
const PASSES = [['sh', 0, 7], ['ol', 0, 0], ['sd', 0, 3], ['bd', 0, 0], ['hi', -3, -4]] as const;
/** The small optical size (cap 24) draws three passes: outline, flat body, gloss. */
const PASSES_SM = [PASSES[1], PASSES[3], PASSES[4]] as const;

/** The bounce pattern: tilt in degrees and lift in glyph units per letter (position mod 8), scaled by `bounce`. */
const TILT = [-3, 2, -2.5, 3, -1.5, 2.5, -2, 1.5], LIFT = [0, -4, 2, -3, 3, -2, 1, -4];

const svgEl = (tag: string): SVGElement => document.createElementNS(NS, tag);

let defs: SVGSVGElement | null = null;
/** The hidden svg holding every glyph path and one body gradient per tone (user-space, y 5..95: a bounding-box gradient will not paint on a straight I). Idempotent. */
export function ensureJellyDefs(): SVGSVGElement {
  if (defs && defs.isConnected) return defs;
  const svg = svgEl('svg') as SVGSVGElement;
  svg.setAttribute('class', 'jl-defs');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  const d = svgEl('defs');
  for (const ch of Object.keys(GLYPHS)) {
    const p = svgEl('path');
    p.setAttribute('id', glyphId(ch));
    p.setAttribute('d', GLYPHS[ch][1]);
    d.append(p);
  }
  for (const [id, s] of Object.entries(JELLY)) {
    const g = svgEl('linearGradient');
    g.setAttribute('id', `jg-g-${id}`);
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    g.setAttribute('x1', '0'); g.setAttribute('y1', '5'); g.setAttribute('x2', '0'); g.setAttribute('y2', '95');
    for (const [off, col] of [[0, s.top], [0.42, s.body], [1, mixHex(s.body, s.shade, 0.55)]] as const) {
      const st = svgEl('stop');
      st.setAttribute('offset', String(off));
      st.setAttribute('stop-color', col);
      g.append(st);
    }
    d.append(g);
  }
  const hi = svgEl('linearGradient');   // the gloss: strong at the top of the glyph, fading toward the base (light from above)
  hi.setAttribute('id', 'jg-hi');
  hi.setAttribute('gradientUnits', 'userSpaceOnUse');
  hi.setAttribute('x1', '0'); hi.setAttribute('y1', '5'); hi.setAttribute('x2', '0'); hi.setAttribute('y2', '95');
  for (const [off, a] of [[0, 0.9], [1, 0.25]] as const) {
    const st = svgEl('stop');
    st.setAttribute('offset', String(off));
    st.setAttribute('stop-color', 'white');
    st.setAttribute('stop-opacity', String(a));
    hi.append(st);
  }
  d.append(hi);
  svg.append(d);
  document.body.prepend(svg);
  defs = svg;
  return svg;
}

/** Width of `text` in glyph units, advances only (undrawn characters count as a space). */
export function jellyWidth(text: string): number {
  let x = 0;
  for (const ch of text) { const g = glyphFor(ch); x += g ? g[0] + ADV : SPACE_W; }
  return Math.max(0, x - ADV);
}

/** A jelly word: `<tag class="jl jl-md">` = a real text span (screen readers, the no-SVG fallback) + the aria-hidden drawing. */
export function jelly(text: string, o: JellyOpts = {}): HTMLElement {
  ensureJellyDefs();
  const size = o.size ?? 'md', tone = o.tone ?? 'amber';
  const st = JELLY[tone];
  const el = document.createElement(o.tag ?? 'span');
  el.className = `jl jl-${size}`;
  el.dataset.tone = tone;
  el.style.setProperty('--jl-bd', `url(#jg-g-${tone})`);
  el.style.setProperty('--jl-flat', st.body);
  el.style.setProperty('--jl-sd', st.shade);
  const label = document.createElement('span');
  label.className = 'jl-text sr-only';
  label.textContent = text;
  const units = jellyWidth(text), b = o.bounce ?? 0, room = b ? 6 : 0;
  const svg = svgEl('svg') as SVGSVGElement;
  svg.setAttribute('class', 'jl-svg');
  svg.setAttribute('viewBox', `${-PAD_X} ${TOP - room} ${units + 2 * PAD_X} ${VIEW_H + 2 * room}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  el.style.setProperty('--jl-w', ((units + 2 * PAD_X) / 100).toFixed(3));
  if (room) el.style.setProperty('--jl-h', ((VIEW_H + 2 * room) / 100).toFixed(3));
  for (const [cls, dx, dy] of size === 'sm' ? PASSES_SM : PASSES) {
    const g = svgEl('g');
    g.setAttribute('class', `jl-${cls}`);
    if (dx || dy) g.setAttribute('transform', `translate(${dx} ${dy})`);
    let x = 0, n = 0;
    for (const ch of text) {
      const gl = glyphFor(ch);
      if (!gl) { x += SPACE_W; continue; }
      const u = svgEl('use');
      u.setAttribute('href', `#${glyphId(ch)}`);
      if (b) u.setAttribute('transform', `translate(${x} ${(LIFT[n % 8] * b).toFixed(1)}) rotate(${(TILT[n % 8] * b).toFixed(1)} ${gl[0] / 2} 50)`);
      else if (x) u.setAttribute('x', String(x));
      g.append(u);
      x += gl[0] + ADV;
      n++;
    }
    svg.append(g);
  }
  el.append(label, svg);
  return el;
}
