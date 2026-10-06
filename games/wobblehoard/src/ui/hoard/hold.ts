// Hold to confirm (MERGE 3.1 step 4): a button that fills a ring over `ms` while it is held by a pointer, or by Enter / Space; letting go
// early cancels and nothing happens. The fill is a CSS custom property set through the CSSOM (CSP-safe), the label stays text.
import { h } from '../dom.ts';

export interface HoldButton {
  readonly el: HTMLButtonElement;
  setLabel(text: string): void;
  setDisabled(on: boolean): void;
  /** stop any hold in progress (the panel closed) */
  cancel(): void;
}

export function createHoldButton(label: string, ms: number, onDone: () => void, cls = 'hold-btn'): HoldButton {
  const text = h('span', { class: 'hold-label', text: label });
  const el = h('button', { class: cls, attrs: { type: 'button', 'data-holding': 'false' } }, h('span', { class: 'hold-fill', attrs: { 'aria-hidden': 'true' } }), text);
  let t0 = 0, raf = 0, holding = false, by: 'pointer' | 'key' | null = null;
  const set = (p: number): void => { el.style.setProperty('--hold', String(Math.max(0, Math.min(1, p)))); };
  const stop = (): void => { holding = false; by = null; cancelAnimationFrame(raf); raf = 0; el.dataset.holding = 'false'; set(0); };
  const tick = (): void => {
    if (!holding) return;
    const p = (performance.now() - t0) / ms;
    set(p);
    if (p >= 1) { stop(); onDone(); return; }
    raf = requestAnimationFrame(tick);
  };
  const start = (src: 'pointer' | 'key'): void => {
    if (holding || el.disabled) return;
    holding = true; by = src; t0 = performance.now(); el.dataset.holding = 'true';
    raf = requestAnimationFrame(tick);
  };
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } start('pointer'); });
  el.addEventListener('pointerup', () => { if (by === 'pointer') stop(); });
  el.addEventListener('pointercancel', () => { if (by === 'pointer') stop(); });
  el.addEventListener('lostpointercapture', () => { if (by === 'pointer') stop(); });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (!e.repeat) start('key');
  });
  el.addEventListener('keyup', (e) => { if ((e.key === 'Enter' || e.key === ' ') && by === 'key') stop(); });
  el.addEventListener('blur', () => { if (by === 'key') stop(); });
  // a click without a hold (a quick tap, or Enter pressed and released at once) explains the hold instead of doing nothing silently
  el.addEventListener('click', (e) => { e.preventDefault(); });
  set(0);
  return {
    el,
    setLabel(t) { text.textContent = t; },
    setDisabled(on) { el.disabled = on; if (on) stop(); },
    cancel: stop,
  };
}
