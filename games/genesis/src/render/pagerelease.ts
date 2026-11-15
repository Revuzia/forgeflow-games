// GENESIS — give the GPU and the workers back when the page goes (PERF s18, `?pagerelease=0` off).
//
// Owner, Mac round 7: eight page loads in one tab took the GPU process from 1.8 to 3.7 GB and the tab from 1.1 to
// 2.8 GB over the first three loads. Nothing released anything when a page went: the WebGL context (≈ 0.7 GB of
// textures, buffers and render targets), the patch / field workers and their heaps lived on until the browser's
// garbage collector got round to the dead document — or for as long as the browser kept the whole page frozen in its
// back/forward cache (a navigation to another URL, e.g. the same game with another ?switch, keeps the old page).
// So on `pagehide`:
//   1. the render workers are terminated (their heaps go at once);
//   2. the WebGL context is lost on purpose (WEBGL_lose_context): the GPU process frees every texture, buffer and
//      framebuffer of this page now, not at some later collection; the canvas shrinks to 1 x 1;
//   3. the hooks run (the renderer drops its scene graphs so the arrays can be collected).
// A page the browser kept frozen and brings back (`pageshow` with persisted) has no context any more: it reloads
// (the world was kept as the autosave on the way out — ui/saves.ts leaving()).
// The save on the way out uses the last thumbnail when the page is hidden, never the canvas, and the sim worker is
// not ours to stop (it writes that save).

import { perfSwitch } from './perfswitch.ts';

export const PAGE_RELEASE = perfSwitch('pagerelease', true);

interface WorkerLike { terminate(): void }
interface EventTargetLike { addEventListener(type: string, fn: (e: { persisted?: boolean }) => void): void }
interface CanvasLike { width: number; height: number }
interface GLLike { getExtension(name: string): unknown; isContextLost?(): boolean }

const workers = new Set<WorkerLike>();
const hooks: (() => void)[] = [];
/** what happened (the test surface and probes read it) */
export const PAGE_RELEASE_STATE = { installed: false, released: false, workers: 0, lostContext: false, reloads: 0 };

/** a worker the render side made: terminated when the page goes */
export function registerPageWorker<T extends WorkerLike>(w: T): T { workers.add(w); return w; }
export function unregisterPageWorker(w: WorkerLike): void { workers.delete(w); }
/** run when the page goes, after the context is lost (drop references to big arrays) */
export function onPageRelease(fn: () => void): void { hooks.push(fn); }

/** release now (idempotent). Exported for tests and for a caller that tears the game down itself. */
export function releasePage(gl: GLLike | null, canvas: CanvasLike | null): void {
  const S = PAGE_RELEASE_STATE;
  if (S.released) return;
  S.released = true;
  for (const w of workers) { try { w.terminate(); S.workers++; } catch { /* gone */ } }
  workers.clear();
  try {
    if (gl && !(gl.isContextLost?.() ?? false)) {
      const ext = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null;
      if (ext) { ext.loseContext(); S.lostContext = true; }
    }
  } catch { /* already gone */ }
  try { if (canvas) { canvas.width = 1; canvas.height = 1; } } catch { /* detached */ }
  for (const h of hooks.splice(0)) { try { h(); } catch { /* best effort */ } }
}

/**
 * Install the page-lifecycle listeners (once per page). `win` is the window (anything with addEventListener),
 * `reload` brings a page back that was restored without its context.
 */
export function installPageRelease(win: EventTargetLike | null | undefined, gl: GLLike | null, canvas: CanvasLike | null, reload: () => void, on = PAGE_RELEASE): boolean {
  const S = PAGE_RELEASE_STATE;
  if (!on || !win || typeof win.addEventListener !== 'function' || S.installed) return false;
  S.installed = true;
  win.addEventListener('pagehide', () => releasePage(gl, canvas));
  win.addEventListener('pageshow', (e) => {
    if (!e?.persisted || !S.released) return;
    S.reloads++;
    try { reload(); } catch { /* stays as it is */ }
  });
  return true;
}

/** tests */
export function pageReleaseReset(): void {
  workers.clear(); hooks.length = 0;
  Object.assign(PAGE_RELEASE_STATE, { installed: false, released: false, workers: 0, lostContext: false, reloads: 0 });
}
