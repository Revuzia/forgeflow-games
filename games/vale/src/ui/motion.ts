// VALE UI — motion (bible §Menu mood · Motion; tokens.motion). Durations 60·100·160·240·360·720·900·1200;
// enter `dawn`, exit `dusk` at 0.7×, `swing` for reward settles only, timers linear. Stagger 32 ms,
// capped at 8 items (grids stagger by row, 48 ms). Forward = clockwise = enters from the RIGHT; back
// enters from the left. Reduced motion (setting or OS): 120 ms fades, no offsets, no wipe.

import { signal } from '@preact/signals';
import { TOKENS, type DurToken } from './tokens.ts';

const M = TOKENS.motion;
export const DUR = M.dur;
export const EASE = M.ease;
export const EXIT = M.exitFactor;

/** set by the app from Settings.access.reduceMotion OR prefers-reduced-motion */
export const reducedMotion = signal(false);

export const dur = (t: DurToken): number => M.dur[t];
export const exitDur = (t: DurToken): number => Math.round(M.dur[t] * EXIT);
export const stagger = (i: number): number => Math.min(i, M.stagger.capItems) * M.stagger.perItemMs;
export const staggerRow = (row: number): number => Math.min(row, M.stagger.capItems) * M.stagger.gridRowMs;

export type From = 'right' | 'left' | 'below' | 'above' | 'none' | 'scale';

function offset(from: From, px: number): string {
  switch (from) {
    case 'right': return `translate3d(${px}px,0,0)`;
    case 'left': return `translate3d(${-px}px,0,0)`;
    case 'below': return `translate3d(0,${px}px,0)`;
    case 'above': return `translate3d(0,${-px}px,0)`;
    case 'scale': return `scale(${M.modalScaleFrom})`;
    default: return 'none';
  }
}

export interface EnterOpts { from?: From; dist?: 'small' | 'panel'; delay?: number; d?: DurToken }

/** enter: fade + offset with `dawn`; reduced motion: 120 ms fade */
export function animateIn(el: Element | null, o: EnterOpts = {}): Animation | null {
  if (!el || !(el as HTMLElement).animate) return null;
  const k = scaleK();
  if (reducedMotion.value) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: M.reducedMotion.fadeMs, delay: Math.min(o.delay ?? 0, 60), easing: 'linear', fill: 'backwards' });
  }
  const px = (o.dist === 'panel' ? M.offsetPx.panel : M.offsetPx.small) * k;
  return el.animate(
    [{ opacity: 0, transform: offset(o.from ?? 'below', px) }, { opacity: 1, transform: 'none' }],
    { duration: M.dur[o.d ?? 'panel'], delay: o.delay ?? 0, easing: M.ease.dawn, fill: 'backwards' },
  );
}

/** exit: fade + offset with `dusk` at 0.7× the entry duration */
export function animateOut(el: Element | null, o: EnterOpts = {}): Promise<void> {
  if (!el || !(el as HTMLElement).animate) return Promise.resolve();
  const k = scaleK();
  let a: Animation;
  if (reducedMotion.value) {
    a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: M.reducedMotion.fadeMs, easing: 'linear', fill: 'forwards' });
  } else {
    const px = (o.dist === 'panel' ? M.offsetPx.panel : M.offsetPx.small) * k;
    a = el.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: offset(o.from ?? 'below', px) }],
      { duration: Math.round(M.dur[o.d ?? 'panel'] * EXIT), delay: o.delay ?? 0, easing: M.ease.dusk, fill: 'forwards' },
    );
  }
  return a.finished.then(() => undefined, () => undefined);
}

/** count a number from → to over `ms` with ease-out (rewards: 1200 ms); returns a cancel fn */
export function tween(from: number, to: number, ms: number, onFrame: (v: number, done: boolean) => void, delay = 0): () => void {
  if (reducedMotion.value || ms <= 0 || from === to) { onFrame(to, true); return () => undefined; }
  let raf = 0, start = 0, cancelled = false;
  const t0 = setTimeout(() => {
    const step = (now: number): void => {
      if (cancelled) return;
      if (!start) start = now;
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      onFrame(from + (to - from) * e, p >= 1);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }, delay);
  return () => { cancelled = true; clearTimeout(t0); cancelAnimationFrame(raf); };
}

function scaleK(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}
