// The error card (UI.md 6): when the game cannot go on, a friendly full-screen card, never a blank page. A little blob mascot (original, drawn here), a jelly heading, a plain line
// about what failed and what to try, ONE gel button (Reload by default; a soft retry passes its own words), and the technical part folded away under "Details" with a Copy
// button for the people who help. Text always goes through textContent. First-play code and nothing but the kit: it must still draw when a lazy module is what failed.
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { jelly } from './jelly/jelly.ts';
import './jelly/jelly.css';
import './overlay.css';

export interface ErrorCardOptions {
  title: string;
  /** one or two plain sentences: what failed and what the player can do */
  message: string;
  /** technical detail, folded under "Details" (error.message). Optional. */
  detail?: string;
  /** the gel button's words (default "Reload"; a soft retry says "Try again") */
  buttonLabel?: string;
  onReload?: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function mascot(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 96 80');
  svg.setAttribute('class', 'errorcard-mascot');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const part = (tag: string, cls: string, attrs: Record<string, string>): void => {
    const e = document.createElementNS(SVG_NS, tag);
    e.setAttribute('class', cls);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
  };
  part('ellipse', 'eb-shadow', { cx: '48', cy: '76', rx: '34', ry: '4' });
  part('path', 'eb-body', { d: 'M10 60C8 34 26 10 48 10s40 24 38 50c-1 11-14 15-38 15S11 71 10 60Z' });
  part('path', 'eb-belly', { d: 'M14 62c2 8 14 11 34 11s32-3 34-11c-6 6-18 8-34 8s-28-2-34-8Z' });
  part('ellipse', 'eb-gloss', { cx: '32', cy: '26', rx: '11', ry: '6', transform: 'rotate(-28 32 26)' });
  part('ellipse', 'eb-eye', { cx: '37', cy: '46', rx: '4.4', ry: '5.6' });
  part('ellipse', 'eb-eye', { cx: '59', cy: '46', rx: '4.4', ry: '5.6' });
  part('circle', 'eb-spark', { cx: '38.6', cy: '44', r: '1.6' });
  part('circle', 'eb-spark', { cx: '60.6', cy: '44', r: '1.6' });
  part('path', 'eb-mouth', { d: 'M41 62Q48 55 55 62' });
  part('path', 'eb-sweat', { d: 'M76 30c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10Z' });
  return svg;
}

export function showErrorCard(root: HTMLElement, o: ErrorCardOptions): HTMLElement {
  root.querySelector('.errorcard')?.remove();
  const btn = h('button', { class: 'cta k-btn k-gel k-cta errorcard-go', attrs: { type: 'button', 'data-key': 'reload' }, on: { click: () => { (o.onReload ?? (() => location.reload()))(); } } },
    h('span', { class: 'k-btn-label cta-label', text: o.buttonLabel ?? 'Reload' }));
  // the heading is the jelly type where it can be drawn; if it cannot, a plain h2 says the same words (the card must never fail to show)
  let title: HTMLElement;
  try {
    // (the drawn alphabet has the straight apostrophe only: the curly one is drawn straight, and the real text for readers keeps the original)
    title = jelly(o.title.replace(/[‘’]/g, "'"), { size: o.title.length > 22 || innerHeight <= 340 ? 'sm' : 'md', tone: 'amber', tag: 'h2', words: true });
    const real = title.querySelector('.jl-text');
    if (real) real.textContent = o.title;
    title.classList.add('errorcard-title');
  } catch { title = h('h2', { class: 'errorcard-title', text: o.title }); }
  title.id = 'wh-err-title';

  let more: HTMLElement | null = null;
  if (o.detail) {
    const text = o.detail.slice(0, 300);
    const detail = h('p', { class: 'errorcard-detail', text, attrs: { tabindex: '0' } });
    const copyLabel = h('span', { class: 'k-btn-label', text: 'Copy details' });
    const copy = h('button', { class: 'k-btn k-btn--sm errorcard-copy', attrs: { type: 'button', 'data-sound': 'none' } }, icon('copy'), copyLabel);
    copy.addEventListener('click', () => {
      const done = (words: string): void => { copyLabel.textContent = words; window.setTimeout(() => { copyLabel.textContent = 'Copy details'; }, 2000); };
      const select = (): void => {
        // no clipboard in this frame (a sandboxed portal): select the text so the player can copy it by hand
        try { const r = document.createRange(); r.selectNodeContents(detail); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); } catch { /* ignore */ }
        done('Select and copy');
      };
      try { void navigator.clipboard.writeText(text).then(() => done('Copied'), select); } catch { select(); }
    });
    more = h('details', { class: 'errorcard-more' }, h('summary', {}, h('span', { text: 'Details' }), icon('chevronDown')), detail, copy);
  }

  const el = h('div', { class: 'errorcard', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-err-title', 'aria-describedby': 'wh-err-msg' } },
    h('div', { class: 'errorcard-box' },
      mascot(), title,
      h('p', { class: 'errorcard-msg', text: o.message, attrs: { id: 'wh-err-msg' } }),
      btn, more));
  root.append(el);
  btn.focus({ preventScroll: true });
  return el;
}

/** Cheap WebGL2 feature test on a throwaway canvas (frees the context straight away). */
export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}
