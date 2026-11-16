// The jelly display type renderer (UI.md 5): ensureJellyDefs, jellyWidth, jelly, setJelly, fitJelly, pokeJelly. Real text stays in the DOM;
// the drawing is an aria-hidden svg of <use> elements. Colours come from theme.ts; widths and finish live in jelly.css; a gradient stop is
// set by setAttribute and a custom property by the CSSOM (strict-CSP safe: no style attribute is ever written as text).
import { ADV, GLYPHS, SPACE_W, glyphFor, glyphId } from './glyphs.ts';
import { EASE, JELLY, MOTION, mixHex } from '../theme.ts';
import type { JellyTone, MedalId, TierId } from '../theme.ts';
import { flash, isCalm, play } from '../motion.ts';

export type JellySize = 'sm' | 'md' | 'lg' | 'xl';
export type JellyToneId = JellyTone | TierId | MedalId;
export interface JellyOpts {
  size?: JellySize;
  tone?: JellyToneId;
  tag?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3';
  /** 0..1: each letter sits a little off the line and off the vertical (a fixed, repeating pattern: the lockup's bounce). Default 0 = a straight line. */
  bounce?: number;
  /** One drawing per word, laid out as a flex row that wraps between words (the lockup: one line on wide, two on stack). Default: one drawing for the whole text. */
  words?: boolean;
  /** Every letter in its own `<g class="jl-c">` (the intro drop and `pokeJelly` move one letter at a time). The five passes still paint back to front. */
  letters?: boolean;
  /** A number or word that changes while the player watches (a counter): the element is a polite, atomic live region, so setJelly announces the new text once. */
  live?: boolean;
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

interface State { text: string; size: JellySize; tone: JellyToneId; bounce: number; words: boolean; letters: boolean }
const STATE = new WeakMap<HTMLElement, State>();

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

/** The drawing of one run of text: five passes (three at cap 24), each a group of <use>. `first` is the running letter index (the bounce pattern and the stagger continue across words). */
function drawing(part: string, st: State, first: number): SVGSVGElement {
  const units = jellyWidth(part), b = st.bounce, room = b ? 6 : 0;
  const svg = svgEl('svg') as SVGSVGElement;
  svg.setAttribute('class', 'jl-svg');
  svg.setAttribute('viewBox', `${-PAD_X} ${TOP - room} ${units + 2 * PAD_X} ${VIEW_H + 2 * room}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.setProperty('--jl-w', ((units + 2 * PAD_X) / 100).toFixed(3));
  for (const [cls, dx, dy] of st.size === 'sm' ? PASSES_SM : PASSES) {
    const g = svgEl('g');
    g.setAttribute('class', `jl-${cls}`);
    if (dx || dy) g.setAttribute('transform', `translate(${dx} ${dy})`);
    let x = 0, k = first;
    for (const ch of part) {
      const gl = glyphFor(ch);
      if (!gl) { x += SPACE_W; continue; }
      const u = svgEl('use');
      u.setAttribute('href', `#${glyphId(ch)}`);
      if (b) u.setAttribute('transform', `translate(${x} ${(LIFT[k % 8] * b).toFixed(1)}) rotate(${(TILT[k % 8] * b).toFixed(1)} ${gl[0] / 2} 50)`);
      else if (x) u.setAttribute('x', String(x));
      if (st.letters) {
        const c = svgEl('g');
        c.setAttribute('class', 'jl-c');
        c.setAttribute('data-i', String(k));
        c.style.setProperty('--i', String(k));
        c.append(u);
        g.append(c);
      } else g.append(u);
      x += gl[0] + ADV;
      k++;
    }
    svg.append(g);
  }
  return svg;
}

const countGlyphs = (s: string): number => { let n = 0; for (const ch of s) if (glyphFor(ch)) n++; return n; };

function paint(el: HTMLElement, text: string, st: State): void {
  const label = document.createElement('span');
  label.className = 'jl-text sr-only';
  label.textContent = text;
  const parts = st.words ? text.split(/\s+/).filter(Boolean) : [text];
  const room = st.bounce ? 6 : 0;
  el.classList.remove('jl-sm', 'jl-md', 'jl-lg', 'jl-xl', 'jl-words');   // a caller's own classes stay
  el.classList.add('jl', `jl-${st.size}`);
  if (st.words) el.classList.add('jl-words');
  el.dataset.tone = st.tone;
  el.style.setProperty('--jl-bd', `url(#jg-g-${st.tone})`);
  el.style.setProperty('--jl-flat', JELLY[st.tone].body);
  el.style.setProperty('--jl-sd', JELLY[st.tone].shade);
  if (room) el.style.setProperty('--jl-h', ((VIEW_H + 2 * room) / 100).toFixed(3)); else el.style.removeProperty('--jl-h');
  const svgs: SVGSVGElement[] = [];
  let n = 0;
  for (const part of parts) { svgs.push(drawing(part, st, n)); n += countGlyphs(part); }
  el.replaceChildren(label, ...svgs);
}

/** A jelly word: `<tag class="jl jl-md">` = a real text span (screen readers, the no-SVG fallback) + the aria-hidden drawing. */
export function jelly(text: string, o: JellyOpts = {}): HTMLElement {
  ensureJellyDefs();
  const st: State = { text, size: o.size ?? 'md', tone: o.tone ?? 'amber', bounce: o.bounce ?? 0, words: !!o.words, letters: !!o.letters };
  const el = document.createElement(o.tag ?? 'span');
  STATE.set(el, st);
  paint(el, text, st);
  if (o.live) { el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true'); }
  return el;
}

/** Change the text (and optionally the look) of an existing jelly element in place; the element, its tag, its id and its listeners stay. */
export function setJelly(el: HTMLElement, text: string, o: Omit<JellyOpts, 'tag'> = {}): void {
  ensureJellyDefs();
  const prev = STATE.get(el);
  const st: State = {
    text,
    size: o.size ?? prev?.size ?? 'md', tone: o.tone ?? prev?.tone ?? 'amber',
    bounce: o.bounce ?? prev?.bounce ?? 0, words: o.words ?? prev?.words ?? false, letters: o.letters ?? prev?.letters ?? false,
  };
  STATE.set(el, st);
  paint(el, text, st);
}

export interface FitOpts {
  /** The smallest cap height in px (UI.md: 14). */
  floor?: number;
  /** The largest cap height in px (a height-limited layout). */
  capMax?: number;
}

/**
 * Shrink the element's cap height until its drawing is at most `maxW` px wide (a row of words: their sum; a column of words: the widest).
 * Sets `--jl-cap` on the element, so call it again after the text, the size class or the layout changes. Never grows past the size class
 * (or `capMax`). Returns the cap in px, or 0 where nothing is laid out yet (a detached element, display none).
 */
export function fitJelly(el: HTMLElement, maxW: number, o: FitOpts = {}): number {
  const floor = o.floor ?? 14;
  el.style.removeProperty('--jl-cap');
  const svgs = [...el.querySelectorAll<SVGSVGElement>(':scope > .jl-svg')];
  if (!svgs.length) return 0;
  const first = svgs[0].getBoundingClientRect(), last = svgs[svgs.length - 1].getBoundingClientRect();
  const st = STATE.get(el);
  const ratio = (VIEW_H + (st?.bounce ? 12 : 0)) / 100;
  if (!first.height) return 0;
  const cap0 = first.height / ratio;
  const column = svgs.length > 1 && getComputedStyle(el).flexDirection.startsWith('column');
  const natural = column ? Math.max(...svgs.map((s) => s.getBoundingClientRect().width))
    : svgs.length > 1 ? Math.max(0, last.right - first.left) : first.width;
  let cap = natural > maxW ? cap0 * maxW / natural : cap0;
  if (o.capMax !== undefined) cap = Math.min(cap, o.capMax);
  cap = Math.max(floor, cap);
  if (Math.abs(cap - cap0) > 0.25) el.style.setProperty('--jl-cap', `${cap.toFixed(2)}px`);
  return cap;
}

/** Keep a jelly heading inside its room: shrink its cap (floor 20) until it fits, on open, when the entrance has settled and on every resize (a "How to play" heading on a 320 px phone,
 *  a "Your photo" one beside a close button). `room` is read each time. Returns the undo. */
export function keepFitted(title: HTMLElement, room: () => number, settle?: HTMLElement): () => void {
  const fit = (): void => { const w = room(); if (w > 0) fitJelly(title, w, { floor: 20 }); };
  fit();
  window.addEventListener('resize', fit);
  settle?.addEventListener('animationend', fit, { once: true });
  return () => window.removeEventListener('resize', fit);
}
/** the width a header's heading may use: the header's inner width less the close button and a gap */
export const headRoom = (head: HTMLElement, close: HTMLElement): number => {
  const cs = getComputedStyle(head);
  return head.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - close.offsetWidth - 12;
};

/** The index of the letter whose drawing is nearest to a viewport x (letters mode only), or -1. */
export function jellyLetterAt(el: HTMLElement, clientX: number): number {
  let best = -1, bestD = Infinity;
  for (const c of el.querySelectorAll<SVGGElement>('.jl-bd > .jl-c, .jl-ol > .jl-c')) {
    const r = c.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - clientX);
    if (d < bestD) { bestD = d; best = Number(c.dataset.i); }
  }
  return best;
}

const POKE_MS = MOTION.t4 + 120;
/**
 * Poke one letter (`at` = a letter index, or a viewport x to take the nearest letter; omitted = the middle one): it squashes and springs
 * back, its neighbours follow a beat later with less. Letters mode only (others: nothing moves, false). Calm: one 120 ms highlight on the
 * letter instead (no transform). Returns the index poked, or -1.
 */
export function pokeJelly(el: HTMLElement, at?: number | { x: number }): number {
  const all = [...el.querySelectorAll<SVGGElement>('.jl-bd > .jl-c')];
  if (!all.length) return -1;
  const idx = at === undefined ? Math.floor(all.length / 2) : typeof at === 'number' ? at : jellyLetterAt(el, at.x);
  if (idx < 0) return -1;
  const calm = isCalm();
  const hit = (i: number, strength: number, delay: number): void => {
    for (const c of el.querySelectorAll<SVGGElement>(`.jl-c[data-i="${i}"]`)) {
      if (calm) { if (delay === 0) flash(c); continue; }
      play(c, [
        { transform: 'scale(1, 1)' },
        { transform: `scale(${1 + 0.2 * strength}, ${1 - 0.26 * strength})`, offset: 0.28 },
        { transform: `scale(${1 - 0.07 * strength}, ${1 + 0.1 * strength})`, offset: 0.58 },
        { transform: `scale(${1 + 0.025 * strength}, ${1 - 0.03 * strength})`, offset: 0.8 },
        { transform: 'scale(1, 1)' },
      ], { ms: POKE_MS, easing: EASE.spring, delay });
    }
  };
  hit(idx, 1, 0);
  hit(idx - 1, 0.45, 55);
  hit(idx + 1, 0.45, 55);
  return idx;
}
