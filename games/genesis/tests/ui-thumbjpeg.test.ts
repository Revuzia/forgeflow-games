// GENESIS — a save's picture is encoded off the main thread (macfix r3): the 256 px ImageBitmap is transferred to a
// worker that encodes it on an OffscreenCanvas (src/client/thumbjpeg.ts, thumb.worker.ts); without a worker the
// fallback canvas is CPU-backed (willReadFrequently), and app.ts no longer calls toBlob on a GPU-backed canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const g = globalThis as unknown as Record<string, unknown>;

class FakeBitmap { closed = false; width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } close() { this.closed = true; } }
class FakeReader {
  result: string | null = null; onload: (() => void) | null = null; onerror: (() => void) | null = null;
  readAsDataURL(b: { type: string }) { this.result = `data:${b.type};base64,AAAA`; queueMicrotask(() => this.onload?.()); }
}
g.FileReader = FakeReader;
/** a fresh copy of the module (its worker port is cached per module instance) */
const fresh = (tag: string) => import(`../src/client/thumbjpeg.ts?${tag}`) as Promise<typeof import('../src/client/thumbjpeg.ts')>;

test('the worker half draws the bitmap on an OffscreenCanvas and encodes a JPEG at 0.8, closing the bitmap', async () => {
  const calls: unknown[] = [];
  g.OffscreenCanvas = class {
    constructor(width: number, height: number) { calls.push(['size', width, height]); }
    getContext(k: string) { calls.push(['ctx', k]); return { drawImage: (b: unknown, x: number, y: number) => calls.push(['draw', b instanceof FakeBitmap, x, y]) }; }
    convertToBlob(o: { type: string; quality: number }) { calls.push(['blob', o.type, o.quality]); return Promise.resolve({ type: o.type }); }
  };
  const { encodeInWorker } = await fresh('worker-half');
  const bmp = new FakeBitmap(256, 144);
  const url = await encodeInWorker(bmp as unknown as ImageBitmap, 0.8);
  assert.equal(url, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(calls, [['size', 256, 144], ['ctx', '2d'], ['draw', true, 0, 0], ['blob', 'image/jpeg', 0.8]]);
  assert.ok(bmp.closed, 'the bitmap is closed');
});

test('encodeThumb transfers the bitmap to the worker and resolves with its reply', async () => {
  const posted: Array<{ m: { id: number; bmp: unknown; quality: number }; t: unknown[] }> = [];
  let worker: { onmessage: ((e: { data: unknown }) => void) | null } | null = null;
  g.OffscreenCanvas = class {};
  g.location = { search: '' };
  g.Worker = class {
    onmessage: ((e: { data: unknown }) => void) | null = null; onerror = null; onmessageerror = null;
    constructor() { worker = this; }
    postMessage(m: { id: number; bmp: unknown; quality: number }, t: unknown[]) { posted.push({ m, t }); }
    terminate() {}
  };
  const { encodeThumb, thumbStats } = await fresh('worker-path');
  const bmp = new FakeBitmap(256, 144);
  const p = encodeThumb(bmp as unknown as ImageBitmap, 0.8);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].m.bmp, bmp);
  assert.deepEqual(posted[0].t, [bmp], 'the bitmap is transferred, not copied');
  assert.equal(posted[0].m.quality, 0.8);
  worker!.onmessage!({ data: { id: posted[0].m.id, url: 'data:image/jpeg;base64,BBBB' } });
  assert.equal(await p, 'data:image/jpeg;base64,BBBB');
  assert.equal(thumbStats.worker, 1);
  assert.equal(thumbStats.main, 0);
  delete g.Worker; delete g.OffscreenCanvas; delete g.location;
});

test('without a worker the fallback canvas is CPU-backed (willReadFrequently) and encodes asynchronously', async () => {
  const opts: unknown[] = [];
  g.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: (k: string, o: unknown) => { opts.push([k, o]); return { drawImage() {} }; },
      toBlob: (cb: (b: unknown) => void, type: string, q: number) => { opts.push(['toBlob', type, q]); queueMicrotask(() => cb({ type })); },
    }),
  };
  const { encodeThumb, thumbStats } = await fresh('main-path');
  const bmp = new FakeBitmap(256, 144);
  assert.equal(await encodeThumb(bmp as unknown as ImageBitmap, 0.8), 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(opts, [['2d', { willReadFrequently: true }], ['toBlob', 'image/jpeg', 0.8]]);
  assert.ok(bmp.closed);
  assert.equal(thumbStats.main, 1);
  delete g.document;
});

test('app.ts encodes the save picture through thumbjpeg, with no toBlob of its own', () => {
  const src = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.ok(!/\.toBlob\(/.test(src), 'no toBlob in app.ts');
  assert.match(src, /encodeThumb\(bmp/);
  assert.ok(!/document\.createElement\('canvas'\)/.test(src.slice(src.indexOf('private async thumb()'), src.indexOf('waitFrames(n'))), 'thumb() makes no GPU-backed canvas');
});
