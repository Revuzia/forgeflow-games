// PERF F3: upload only the written prefix of an instanced / streamed attribute. three re-uploads the WHOLE array on
// needsUpdate unless update ranges are given; the instanced pools are sized for the worst case (groundcover 6000
// instances = 384 kB of instanceMatrix per mesh) and usually hold a fraction of it. The GPU keeps the old tail, which
// is never drawn (mesh.count bounds every draw), so the image is identical.
import { BufferAttribute, InstancedBufferAttribute, Texture } from 'three';
import type { BufferGeometry, InterleavedBufferAttribute, WebGLRenderer } from 'three';
import { BUF_RING, ringDrop, ringGeo, ringMark } from './bufring.ts';

type Attr = BufferAttribute | InstancedBufferAttribute;

/** mark items [0, count) of `a` for upload (nothing when count is 0) */
export function uploadPrefix(a: Attr | InterleavedBufferAttribute | null | undefined, count: number): void {
  if (!a || count <= 0) return;
  // (PERF s16) a ringed attribute uploads through its next buffer (bufring.ts)
  if (ringMark(a, 0, Math.min((a as Attr).array.length, count * a.itemSize))) return;
  const b = a as Attr;
  if (typeof b.clearUpdateRanges !== 'function') { (a as Attr).needsUpdate = true; return; }
  b.clearUpdateRanges();
  b.addUpdateRange(0, Math.min(b.array.length, count * b.itemSize));
  b.needsUpdate = true;
}

/**
 * PERF F16 (session 8): ONE upload per attribute per frame on ANGLE-Metal (Chrome / Safari on a Mac).
 * There a gl.bufferSubData into a buffer the GPU still reads takes a NEW Metal buffer of the WHOLE buffer's size and
 * blits everything around the range across (BufferMtl::putDataInNewBufferAndStartUsingNewBuffer), and every 64 MB of
 * such fresh allocations makes ANGLE wait for the whole GPU queue (BufferManager GC, WaitUntilFinished). three issues
 * one bufferSubData per disjoint update range: a BatchedMesh pool taking three patches in three places paid three
 * whole-pool copies. The ranges of an attribute are kept as their single covering span instead: one copy; the gap
 * between them is re-sent from the CPU array, which holds the same bytes as the GPU (same image). Elsewhere (D3D,
 * desktop GL, SwiftShader) sub-updates cost what they write, so the ranges stay as three keeps them.
 * `?span=0` / `?span=1` force it off / on.
 */
let spanInstalled = false;
export function installSpanUploads(on: boolean): boolean {
  if (!on || spanInstalled) return spanInstalled;
  spanInstalled = true;
  const proto = BufferAttribute.prototype as unknown as { addUpdateRange(start: number, count: number): void; updateRanges: { start: number; count: number }[] };
  proto.addUpdateRange = function (this: { updateRanges: { start: number; count: number }[] }, start: number, count: number): void {
    const r = this.updateRanges;
    if (r.length === 0) { r.push({ start, count }); return; }
    const a = r[0];
    const end = Math.max(a.start + a.count, start + count);
    a.start = Math.min(a.start, start);
    a.count = end - a.start;
    // (ranges pushed by other code paths are folded in too)
    for (let i = 1; i < r.length; i++) {
      const b = r[i];
      const e = Math.max(a.start + a.count, b.start + b.count);
      a.start = Math.min(a.start, b.start);
      a.count = e - a.start;
    }
    r.length = 1;
  };
  return true;
}

/**
 * PERF F18 (session 8): write `src` into a geometry's attribute (or its index), KEEPING the GPU buffer while it is big
 * enough — capacities grow in powers of two — instead of a new BufferAttribute of the exact size at every rebuild.
 * A new attribute is a gl.bufferData of a size never seen: on ANGLE-Metal a fresh allocation, and every 64 MB of them a
 * wait for the whole GPU queue. The caller bounds the draw (geometry.setDrawRange); the tail past `src` is never read.
 */
export function putGrowable(geo: BufferGeometry, name: string, src: Float32Array | Uint32Array, itemSize: number, instanced = false): BufferAttribute {
  const isIndex = name === 'index';
  let a = (isIndex ? geo.index : geo.getAttribute(name)) as BufferAttribute | null;
  if (!a || a.array.length < src.length || a.array.constructor !== src.constructor || a.itemSize !== itemSize || !!(a as InstancedBufferAttribute).isInstancedBufferAttribute !== instanced) {
    // (PERF s16) a ringed attribute replaced by a bigger one: its members' buffers go now (three frees only the installed one, at the geometry's dispose)
    ringDrop(a);
    let cap = (instanced ? 256 : 1024) * itemSize;
    while (cap < src.length) cap *= 2;
    const arr = src instanceof Uint32Array ? new Uint32Array(cap) : new Float32Array(cap);
    a = instanced ? new InstancedBufferAttribute(arr, itemSize) : new BufferAttribute(arr, itemSize);
    if (isIndex) geo.setIndex(a); else geo.setAttribute(name, a);
  }
  (a.array as Float32Array | Uint32Array).set(src as never);
  // (PERF s16) rewritten whole at each rebuild into a buffer drawn every frame: a ring of 3 (bufring.ts)
  if (BUF_RING && src.length > 0) {
    ringGeo(geo, name);
    if (ringMark(a, 0, src.length)) return (isIndex ? geo.index : geo.getAttribute(name)) as BufferAttribute;
  }
  a.clearUpdateRanges();
  if (src.length > 0) a.addUpdateRange(0, src.length);
  a.needsUpdate = true;
  return a;
}

/**
 * F16 is OFF by default since session 9 (`?span=1` turns it on): the owner's M5 A/B (build 31cb64e7) ran 1.2-1.3 fps
 * with it and 1.7 without, main thread 590-748 ms vs 347. Reading: the whole-buffer re-allocation it avoided happens
 * in the GPU process (a memcpy + a blit there), but every byte of a bufferSubData — the GAP bytes of a merged span
 * included — crosses Chrome's command-buffer transfer memory from the page's main thread, which blocks when that ring
 * is full: two patches landing in slots 0 and 15 of a page sent 2.2 MB instead of 280 kB per attribute set.
 * F23 (no page churn) removes the fresh allocations F16 was meant to save.
 */
export function wantSpanUploads(_r: WebGLRenderer): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('span') === '1';
  } catch { return false; }
}

/**
 * PERF F20 (session 8): texture uploads BEFORE the frame's first render pass. three uploads a changed texture at the
 * first draw that samples it — in the middle of the shadow or scene pass. On ANGLE-Metal a texture upload is a staged
 * blit, and a blit into a texture with render work pending in the open command buffer ENDS THE RENDER PASS (store and
 * reload of every attachment: the 4096² shadow atlas, the 4x MSAA HDR target on Ultra). Every texture flagged
 * needsUpdate is noted here (a wrapped Texture.needsUpdate setter) and uploaded by renderer.initTexture at the start
 * of the next frame, before any pass (three then finds it current at the draw). Same texels, uploaded earlier in the
 * same frame. Images still loading are left to three as before.
 */
const pendingTex = new Set<Texture>();
let texHooked = false;
export function installTexturePreUpload(): void {
  if (texHooked) return;
  texHooked = true;
  const proto = Texture.prototype as unknown as object;
  const d = Object.getOwnPropertyDescriptor(proto, 'needsUpdate');
  if (!d || !d.set) return;
  const set = d.set;
  Object.defineProperty(proto, 'needsUpdate', {
    configurable: true, enumerable: d.enumerable,
    get: d.get,
    set(this: Texture, v: boolean) {
      set.call(this, v);
      if (v !== true || pendingTex.size >= 4096) return;
      pendingTex.add(this);
      // (a texture disposed before the flush is dropped: initTexture would re-create it)
      if (!this.hasEventListener('dispose', dropPending)) this.addEventListener('dispose', dropPending);
    },
  });
}
function dropPending(this: Texture): void { pendingTex.delete(this); }

function ready(t: Texture): boolean {
  const img = (t as unknown as { image: unknown }).image as { complete?: boolean; data?: unknown; width?: number } | unknown[] | null;
  if (!img) return false;
  if (Array.isArray(img)) return img.length > 0 && img.every((f) => !!f && (f as { complete?: boolean }).complete !== false);
  if ((t as unknown as { isVideoTexture?: boolean }).isVideoTexture) return false;
  return (img as { complete?: boolean }).complete !== false;
}

/** upload the textures flagged since the last call (call before the frame's first render pass); returns the count */
export function flushTextureUploads(r: WebGLRenderer): number {
  if (pendingTex.size === 0) return 0;
  let n = 0;
  for (const t of pendingTex) {
    // (render-target textures and textures being disposed are left alone; initTexture skips current versions)
    if ((t as unknown as { isRenderTargetTexture?: boolean }).isRenderTargetTexture || !ready(t)) continue;
    try { r.initTexture(t); n++; } catch { /* left to three at its draw */ }
  }
  pendingTex.clear();
  return n;
}
