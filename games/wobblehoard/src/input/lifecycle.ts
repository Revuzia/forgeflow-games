// Page lifecycle glue: tab hidden/shown, window blur, rotation, bfcache, and the audio-unlock fallbacks.
//  * hidden  -> app.setHidden(true): sim and audio pause, every finger is released, no dt spike on return
//  * blur / orientationchange -> release every pointer (a mouse button released outside the window never reports its up)
//  * iOS only lets audio start from touchend/click (not pointerdown), and an AudioContext can be 'interrupted' again by a
//    call or app switch: so any later gesture re-tries unlock() while the context is not running (cheap, idempotent).
import type { Game as App } from '../shell/game.ts';

export function attachLifecycle(app: Pick<App, 'setHidden' | 'input' | 'unlockAudio' | 'profile' | 'collection'>): () => void {
  const off: Array<() => void> = [];
  const on = (t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions | boolean): void => {
    t.addEventListener(type, fn, opts);
    off.push(() => t.removeEventListener(type, fn, opts));
  };
  const sync = (): void => { app.setHidden(document.visibilityState === 'hidden'); };
  // saves: write now when the page may go away; fold in another tab's change when this one comes back (COLLECTION 5.4 two tabs)
  const flush = (): void => { try { app.profile.flush(); } catch { /* ignore */ } try { app.collection.flush(); } catch { /* ignore */ } };
  const refresh = (): void => { try { app.profile.sync?.(); } catch { /* ignore */ } try { app.collection.sync(); } catch { /* ignore */ } };
  on(document, 'visibilitychange', () => { sync(); if (document.visibilityState === 'hidden') flush(); else { app.unlockAudio(); refresh(); } });
  on(window, 'pagehide', () => { flush(); app.setHidden(true); });
  on(window, 'focus', () => refresh());
  on(window, 'pageshow', () => { sync(); });
  on(document, 'freeze', () => app.setHidden(true));
  on(document, 'resume', () => sync());
  on(window, 'blur', () => app.input.cancelAll());
  on(window, 'orientationchange', () => app.input.cancelAll());
  for (const t of ['touchend', 'click', 'keydown']) on(window, t, () => app.unlockAudio(), { capture: true, passive: true });
  return () => { for (const f of off.splice(0)) f(); };
}
