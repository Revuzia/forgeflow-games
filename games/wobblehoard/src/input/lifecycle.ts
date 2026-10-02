// Page lifecycle glue: tab hidden/shown, window blur, rotation, bfcache, and the audio-unlock fallbacks.
//  * hidden  -> app.setHidden(true): sim and audio pause, every finger is released, no dt spike on return
//  * blur / orientationchange -> release every pointer (a mouse button released outside the window never reports its up)
//  * iOS only lets audio start from touchend/click (not pointerdown), and an AudioContext can be 'interrupted' again by a
//    call or app switch: so any later gesture re-tries unlock() while the context is not running (cheap, idempotent).
import type { App } from '../app.ts';

export function attachLifecycle(app: Pick<App, 'setHidden' | 'input' | 'unlockAudio' | 'profile'>): () => void {
  const off: Array<() => void> = [];
  const on = (t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions | boolean): void => {
    t.addEventListener(type, fn, opts);
    off.push(() => t.removeEventListener(type, fn, opts));
  };
  const sync = (): void => { app.setHidden(document.visibilityState === 'hidden'); };
  on(document, 'visibilitychange', () => { sync(); if (document.visibilityState === 'hidden') app.profile.flush(); else app.unlockAudio(); });
  on(window, 'pagehide', () => { app.profile.flush(); app.setHidden(true); });
  on(window, 'pageshow', () => { sync(); });
  on(document, 'freeze', () => app.setHidden(true));
  on(document, 'resume', () => sync());
  on(window, 'blur', () => app.input.cancelAll());
  on(window, 'orientationchange', () => app.input.cancelAll());
  for (const t of ['touchend', 'click', 'keydown']) on(window, t, () => app.unlockAudio(), { capture: true, passive: true });
  return () => { for (const f of off.splice(0)) f(); };
}
