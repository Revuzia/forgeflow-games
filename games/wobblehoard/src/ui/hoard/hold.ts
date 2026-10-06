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
  // the hold completes on the CLOCK (a timer, and checked again at the release), not on painted frames: a slow device (or a page whose
  // frames take a second) still merges after a real 0.5 s hold; animation frames only draw the ring
  let t0 = 0, raf = 0, timer = 0, holding = false, by: 'pointer' | 'key' | null = null;
  const set = (p: number): void => { el.style.setProperty('--hold', String(Math.max(0, Math.min(1, p)))); };
  const stop = (): void => { holding = false; by = null; cancelAnimationFrame(raf); raf = 0; clearTimeout(timer); timer = 0; el.dataset.holding = 'false'; set(0); };
  const finish = (): void => { if (!holding) return; stop(); onDone(); };
  const tick = (): void => {
    if (!holding) return;
    const p = (performance.now() - t0) / ms;
    set(p);
    if (p >= 1) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };
  const start = (src: 'pointer' | 'key'): void => {
    if (holding || el.disabled) return;
    holding = true; by = src; t0 = performance.now(); el.dataset.holding = 'true';
    raf = requestAnimationFrame(tick);
    timer = window.setTimeout(finish, ms);
  };
  /** let go: done if the hold lasted (the timer may not have run yet on a busy page), else cancelled */
  const release = (): void => { if (holding && performance.now() - t0 >= ms) finish(); else stop(); };
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } start('pointer'); });
  el.addEventListener('pointerup', () => { if (by === 'pointer') release(); });
  el.addEventListener('pointercancel', () => { if (by === 'pointer') stop(); });
  el.addEventListener('lostpointercapture', () => { if (by === 'pointer') release(); });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (!e.repeat) start('key');
  });
  el.addEventListener('keyup', (e) => { if ((e.key === 'Enter' || e.key === ' ') && by === 'key') release(); });
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
