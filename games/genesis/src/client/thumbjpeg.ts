// GENESIS — a save's picture as a JPEG data URL, encoded OFF the main thread (macfix r3).
//
// The frame's bitmap is copied (createImageBitmap, already scaled to 256 px) in the frame that drew it; this module
// transfers that ImageBitmap to a small worker (thumb.worker.ts), which draws it on an OffscreenCanvas and encodes it
// with convertToBlob. The old path drew it into a GPU-backed <canvas> and called toBlob, which reads the canvas back
// from the GPU synchronously: the main thread waited for the whole GPU queue (7.5 s / 50 s under SwiftShader, a
// hitch every autosave on a busy Mac GPU). Where there is no worker or no OffscreenCanvas, the fallback draws into a
// CPU-backed canvas (willReadFrequently), so toBlob's read is of CPU memory and never waits on the GPU.

export interface ThumbRequest { id: number; bmp: ImageBitmap; quality: number }
export interface ThumbReply { id: number; url: string | null }

/** a Blob as a data URL (FileReader exists in windows and workers) */
export function blobToDataURL(b: Blob | null): Promise<string | null> {
  return new Promise((ok) => {
    if (!b) { ok(null); return; }
    try {
      const r = new FileReader();
      r.onload = () => ok(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => ok(null);
      r.readAsDataURL(b);
    } catch { ok(null); }
  });
}

/** the worker's half: bitmap -> OffscreenCanvas -> JPEG data URL (the bitmap is closed) */
export async function encodeInWorker(bmp: ImageBitmap, quality = 0.8): Promise<string | null> {
  try {
    const c = new OffscreenCanvas(Math.max(1, bmp.width), Math.max(1, bmp.height));
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(bmp, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
    return await blobToDataURL(blob);
  } catch {
    return null;
  } finally {
    try { bmp.close(); } catch { /* closed */ }
  }
}

/** a CPU-backed 2D canvas of w x h (willReadFrequently keeps it out of GPU memory, so toBlob never waits on the GPU) */
export function cpuCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D | null } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  return { c, g: c.getContext('2d', { willReadFrequently: true }) };
}

/** a canvas as a JPEG data URL via toBlob (asynchronous encode) */
export function canvasJpegURL(c: HTMLCanvasElement, quality = 0.8): Promise<string | null> {
  return new Promise((ok) => {
    try { c.toBlob((b) => { void blobToDataURL(b).then(ok); }, 'image/jpeg', quality); } catch { ok(null); }
  });
}

/** the main-thread fallback: the bitmap through a CPU-backed canvas (the bitmap is closed) */
export function encodeOnMain(bmp: ImageBitmap, quality = 0.8): Promise<string | null> {
  try {
    const { c, g } = cpuCanvas(bmp.width, bmp.height);
    g?.drawImage(bmp, 0, 0);
    return canvasJpegURL(c, quality);
  } catch {
    return Promise.resolve(null);
  } finally {
    try { bmp.close(); } catch { /* closed */ }
  }
}

interface Port { post(m: ThumbRequest): void; waiting: Map<number, (url: string | null) => void> }
let port: Port | null | undefined;
let nextId = 1;
/** counters for the test surface: how many pictures each path encoded */
export const thumbStats = { worker: 0, main: 0, workerFailed: false };

function workerPort(): Port | null {
  if (port !== undefined) return port;
  port = null;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('thumbworker') === '0') return null;
    const w = new Worker(new URL('./thumb.worker.ts', import.meta.url), { type: 'module', name: 'genesis-thumb' });
    const waiting = new Map<number, (url: string | null) => void>();
    const fail = (): void => {
      port = null;
      thumbStats.workerFailed = true;
      try { w.terminate(); } catch { /* gone */ }
      for (const f of [...waiting.values()]) f(null);
      waiting.clear();
    };
    w.onmessage = (e: MessageEvent<ThumbReply>) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data.url); };
    w.onerror = (e) => { console.warn('[genesis] save-picture worker failed; encoding on the main thread', e.message ?? e); fail(); };
    w.onmessageerror = fail;
    port = { post: (m) => w.postMessage(m, [m.bmp]), waiting };
  } catch (e) {
    console.warn('[genesis] no save-picture worker; encoding on the main thread', e);
    port = null;
  }
  return port;
}

/**
 * a save picture's bitmap as a JPEG data URL, encoded in the worker where there is one (the bitmap is transferred and
 * so consumed either way). A worker that fails or answers null leaves the picture out (null) rather than re-encoding
 * on the main thread: the bitmap is gone, and the save keeps its last picture.
 */
export function encodeThumb(bmp: ImageBitmap, quality = 0.8): Promise<string | null> {
  const p = workerPort();
  if (!p) { thumbStats.main++; return encodeOnMain(bmp, quality); }
  const id = nextId++;
  return new Promise((ok) => {
    // (a worker that never answers must not hold the save: after 8 s the save goes ahead without a new picture)
    const late = setTimeout(() => { if (p.waiting.delete(id)) ok(null); }, 8000);
    p.waiting.set(id, (url) => { clearTimeout(late); if (url) thumbStats.worker++; ok(url); });
    try { p.post({ id, bmp, quality }); } catch { p.waiting.delete(id); thumbStats.main++; void encodeOnMain(bmp, quality).then(ok); }
  });
}
