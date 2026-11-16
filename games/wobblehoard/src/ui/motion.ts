// UI motion helpers (UI.md 3.2 / 7): the duration and easing scale in code, Calm in one place, and a small WAAPI wrapper.
//
// CSS owns almost all motion (kit.css transitions read the body-level --k-mv-* / --k-fd-* tokens, which a11y.css collapses under Calm).
// This module is for the few things CSS cannot do alone: a squash on poke, a flash, a WAAPI one-shot, and "is Calm on right now".
// Calm = `body[data-calm="true"]` (written by hudBinding.ts from Settings.calm, whose default is prefers-reduced-motion) OR the OS preference.
//
// Pure functions first (no DOM) so probe_app.ts can test them under node; the DOM helpers guard every access.
import { EASE, MOTION } from './theme.ts';

export { EASE, MOTION };
export type MotionKind = 'move' | 'fade';

/** In Calm every MOVE duration is ~0 and every FADE is this long (UI.md 3.2: --t-move .01ms, --t-fade 140ms). */
export const CALM_MOVE_MS = 0.01;
export const CALM_FADE_MS = MOTION.t2;
export const FLASH_MS = 120;

/** The duration a transition of this kind should have. Pure. */
export function durationFor(ms: number, kind: MotionKind, calm: boolean): number {
  if (!calm) return ms;
  return kind === 'move' ? CALM_MOVE_MS : CALM_FADE_MS;
}

export function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Calm right now: the player's setting on the body, else the OS preference when the setting was never written. */
export function isCalm(): boolean {
  try {
    const v = typeof document !== 'undefined' ? document.body?.dataset.calm : undefined;
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch { /* no DOM */ }
  return prefersReducedMotion();
}

/** Write the Calm hook (a11y.css reads it). The shell calls this from its settings binding. */
export function setCalm(on: boolean): void {
  try { document.body.dataset.calm = String(on); } catch { /* no DOM */ }
}

/** Run `cb` when the OS reduced-motion preference changes. Returns the unsubscribe. */
export function watchReducedMotion(cb: (reduced: boolean) => void): () => void {
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const h = (): void => cb(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  } catch { return () => {}; }
}

export interface PlayOpts { ms?: number; kind?: MotionKind; easing?: string; fill?: FillMode; delay?: number }

/**
 * One WAAPI animation that obeys Calm: a `move` collapses to ~0 (it jumps to its end state), a `fade` becomes 140 ms.
 * Returns null where WAAPI is missing, so callers never need a fallback branch. The animation is removed from the element's timeline
 * effect on finish (fill 'none' by default): the final style must already be set by the caller (CSS class or CSSOM).
 */
export function play(el: Element, keyframes: Keyframe[], o: PlayOpts = {}): Animation | null {
  if (typeof el.animate !== 'function') return null;
  const kind = o.kind ?? 'move';
  const duration = durationFor(o.ms ?? MOTION.t3, kind, isCalm());
  try { return el.animate(keyframes, { duration, easing: o.easing ?? EASE.out, fill: o.fill ?? 'none', delay: o.delay ?? 0 }); } catch { return null; }
}

/** Squash and spring back (the jelly poke, a pressed chip). Calm: one 120 ms highlight instead, no transform. */
export function squash(el: Element, strength = 1): Animation | null {
  if (isCalm()) return flash(el);
  const k = Math.max(0, Math.min(1.5, strength));
  const sx = 1 + 0.1 * k, sy = 1 - 0.14 * k;
  return play(el, [
    { transform: 'scale(1, 1)' },
    { transform: `scale(${sx}, ${sy})`, offset: 0.32 },
    { transform: `scale(${1 - 0.04 * k}, ${1 + 0.05 * k})`, offset: 0.64 },
    { transform: 'scale(1, 1)' },
  ], { ms: MOTION.t4, easing: EASE.spring });
}

/** A 120 ms brightness blip: the Calm stand-in for a squash (opacity / filter only, never transform, never faster than 3 per second). */
export function flash(el: Element): Animation | null {
  if (typeof el.animate !== 'function') return null;
  try { return el.animate([{ filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }], { duration: FLASH_MS, easing: 'linear' }); } catch { return null; }
}
