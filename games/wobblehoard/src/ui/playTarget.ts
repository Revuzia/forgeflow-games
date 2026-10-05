// The squishy as a keyboard target (audit finding 13): a focusable element laid over the squishy's screen disc, in the Tab order after the
// HUD buttons, with a visible focus ring (3 px lagoon, >= 3:1 on the ink). Space pokes it (hold = squish), arrows look around, +/- zoom,
// G / M toggle gravity / sound while it has focus (keyboard.ts). Pointer events pass through it to the canvas (pointer-events: none).
// role="application": a screen reader in browse mode switches to focus mode here and hands the keys to the toy.
import { h } from './dom.ts';

export interface PlayTarget {
  readonly el: HTMLElement;
  /** where the squishy is (CSS px over the canvas, radius in px) or null; cheap to call every frame (CSSOM only, no layout read) */
  place(disc: { x: number; y: number; r: number } | null): void;
  setLabel(text: string): void;
  focus(): void;
  readonly focused: boolean;
  destroy(): void;
}

export function createPlayTarget(root: HTMLElement): PlayTarget {
  const el = h('div', {
    class: 'play-target',
    attrs: { tabindex: '0', role: 'application', 'aria-roledescription': 'squishy', id: 'wh-play', 'aria-describedby': 'wh-play-help' },
  });
  const help = h('p', { class: 'sr-only', attrs: { id: 'wh-play-help' }, text: 'Press Space to poke, hold Space to squish, arrow keys to look around, plus and minus to zoom.' });
  root.append(el, help);
  let lx = NaN, ly = NaN, lr = NaN;
  return {
    el,
    place(d) {
      if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) { el.dataset.placed = 'false'; return; }
      const r = Math.max(28, d.r * 1.15);
      if (Math.abs(d.x - lx) < 0.5 && Math.abs(d.y - ly) < 0.5 && Math.abs(r - lr) < 0.5) return;
      lx = d.x; ly = d.y; lr = r;
      el.style.width = `${(2 * r).toFixed(1)}px`;
      el.style.height = `${(2 * r).toFixed(1)}px`;
      el.style.transform = `translate(${(d.x - r).toFixed(1)}px, ${(d.y - r).toFixed(1)}px)`;
      el.dataset.placed = 'true';
    },
    setLabel(text) { el.setAttribute('aria-label', text); },
    focus() { el.focus({ preventScroll: true }); },
    get focused() { return document.activeElement === el; },
    destroy() { el.remove(); help.remove(); },
  };
}
