// The Cut tool's bar (CUT.md 1, 2.6): while the blade is in hand, a small bar above the HUD's bottom row says what to do and offers the two
// buttons that make the tool work without a drag: Split in two (a vertical cut through the middle as the camera sees it) and Reconnect all;
// Done puts the Hand back. The swipe itself is drawn as a thin blade line over the canvas (an SVG line, no pointer events).
import { h } from './dom.ts';

export interface CutBar {
  readonly el: HTMLElement;
  show(on: boolean): void;
  /** pieces of the squishy now (1 = whole) and the most it can make */
  setPieces(n: number, max: number, busy: boolean): void;
  /** the swipe in progress in page px, or null */
  setBlade(b: { x0: number; y0: number; x1: number; y1: number } | null): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createCutBar(root: HTMLElement, o: { onSplit(): void; onReconnect(): void; onDone(): void }): CutBar {
  const text = h('p', { class: 'cutbar-text', text: 'Swipe across a squishy to cut it.' });
  const count = h('span', { class: 'cutbar-count' });
  const split = h('button', { class: 'act-btn', text: 'Split in two', attrs: { type: 'button', 'data-key': 'split' } });
  const join = h('button', { class: 'act-btn', text: 'Reconnect all', attrs: { type: 'button', 'data-key': 'join' } });
  const done = h('button', { class: 'act-btn primary', text: 'Done', attrs: { type: 'button', 'data-key': 'done' } });
  split.addEventListener('click', () => o.onSplit());
  join.addEventListener('click', () => o.onReconnect());
  done.addEventListener('click', () => o.onDone());
  const el = h('div', { class: 'cutbar', attrs: { role: 'group', 'aria-label': 'Cut tool', hidden: '' } },
    h('div', { class: 'cutbar-row' }, text, count), h('div', { class: 'cutbar-acts' }, split, join, done));
  root.append(el);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'blade'); svg.setAttribute('aria-hidden', 'true');
  const glow = document.createElementNS(SVG_NS, 'line'); glow.setAttribute('class', 'blade-glow');
  const line = document.createElementNS(SVG_NS, 'line'); line.setAttribute('class', 'blade-line');
  svg.append(glow, line);
  root.append(svg);
  svg.style.display = 'none';

  return {
    el,
    show(on) { el.hidden = !on; if (!on) svg.style.display = 'none'; },
    setPieces(n, max, busy) {
      count.textContent = n > 1 ? `${n} pieces` : '';
      text.textContent = n >= max ? "That's as many pieces as it can make." : n > 1 ? 'Swipe to cut again, or push pieces together to join them.' : 'Swipe across a squishy to cut it.';
      split.disabled = busy || n >= max;
      join.disabled = busy || n <= 1;
    },
    setBlade(b) {
      if (!b) { svg.style.display = 'none'; return; }
      svg.style.display = '';
      for (const l of [glow, line]) { l.setAttribute('x1', b.x0.toFixed(1)); l.setAttribute('y1', b.y0.toFixed(1)); l.setAttribute('x2', b.x1.toFixed(1)); l.setAttribute('y2', b.y1.toFixed(1)); }
    },
    destroy() { el.remove(); svg.remove(); },
  };
}
