// GENESIS — ROADMAP-60FPS step 4: NO UPLOADS INSIDE RENDER PASSES (`?upsched=0` = as before; default on).
//
// three uploads a changed buffer when the first r.render() of the frame that draws it walks the scene (a shadow
// cascade's, after the cascade before it has drawn into the same atlas), and a changed texture at the draw that binds
// it. On ANGLE-Metal (the owner's M5) an upload or blit with draws pending in the open render encoder ENDS the render
// pass: store and reload of every attachment (the 4096² D32F shadow atlas, the 4x MSAA rgba16f hdr). Here every
// upload the game itself schedules goes up in the renderer's 'uploads' slot, after the frame's updates and before
// the shadow pass — between passes, where no encoder is open on a target that is drawn again:
//  - buffers (earlyAttr): a registered attribute (ring members: bodies, vegetation, roads, building pages, decals,
//    particles; terrain page batches) whose GL buffer three already made takes its needsUpdate here instead: the
//    ranges three would send are sent by gl.bufferSubData on the COPY_WRITE_BUFFER target (no vertex-array or
//    element binding touched), three's version is left as it is (it finds the buffer current), and the attribute's
//    onUploadCallback runs as after three's own upload;
//  - textures (texUpload): an owner's data texture flagged changed is uploaded by renderer.initTexture here;
//  - work (scheduleUpload): an owner's own GL upload (the city-lights cube's texSubImage + generateMipmap).
// Same bytes, same texels, uploaded before the passes of the frame that first draws them. A change made between the
// flush and the end of that frame's passes (a pass that writes during post) goes up the old way, at its draw. Until the renderer has flushed once (node tests, no renderer) all of
// it is immediate, as before.

import type { BufferAttribute, Texture, WebGLRenderer } from 'three';
import { perfSwitch } from './perfswitch.ts';

export const UPSCHED = perfSwitch('upsched', true);

let gl: WebGL2RenderingContext | null = null;
/** the renderer has flushed at least once: scheduling is live */
let live = false;
/** inside or after this frame's flush: changes go up the old way */
let flushedThisFrame = false;

const tasks: (() => void)[] = [];
const texs = new Set<Texture>();
const attrs = new Set<BufferAttribute>();
const bufOf = new WeakMap<BufferAttribute, WebGLBuffer>();
/** ranges [start, count, ...] (array elements) taken from three's updateRanges, per pending attribute (empty: whole) */
const rangesOf = new WeakMap<BufferAttribute, number[]>();
const isIdx = new WeakSet<BufferAttribute>();
/** an index buffer bound to COPY_WRITE_BUFFER raised a GL error on this browser: index updates stay with three */
let indexOk = true;
let indexChecked = false;

/** stats for the report / tests: uploads done in the slot this frame */
export const UPSCHED_STATS = { bufs: 0, bytes: 0, texs: 0, tasks: 0, late: 0 };

/** the renderer's context; scheduling starts with the first flush */
export function setUploadGL(g: WebGL2RenderingContext | null): void { gl = g; }

/** a frame's passes are done (the end of renderer.render): changes from here on wait for the next flush */
export function uploadFrameBegin(): void { flushedThisFrame = false; }

function deferring(): boolean { return UPSCHED && live && !flushedThisFrame && !!gl; }

/** run `fn` (an owner's GL upload) in the uploads slot; immediately when not scheduling */
export function scheduleUpload(fn: () => void): void {
  if (deferring()) tasks.push(fn); else fn();
}

/** a data texture's contents changed (replaces `tex.needsUpdate = true` at the owner) */
export function texUpload(tex: Texture): void {
  tex.needsUpdate = true;
  if (deferring()) texs.add(tex);
}

/**
 * register a buffer attribute whose updates go up in the uploads slot (its first upload — three's bufferData — still
 * happens at its first draw, which is when its GL buffer becomes known here)
 */
export function earlyAttr(a: BufferAttribute, isIndex = false): void {
  if (!UPSCHED) return;
  const o = a as unknown as { __early?: boolean; onUploadCallback: () => void; updateRanges: { start: number; count: number }[] };
  if (o.__early) return;
  o.__early = true;
  if (isIndex) isIdx.add(a);
  const prevCb = o.onUploadCallback;
  o.onUploadCallback = function (this: unknown) {
    // (three calls this right after its bufferData / bufferSubData, the attribute's buffer still bound)
    if (!bufOf.has(a) && gl) {
      const b = gl.getParameter(isIndex ? gl.ELEMENT_ARRAY_BUFFER_BINDING : gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
      if (b) bufOf.set(a, b);
    }
    prevCb.call(a);
  };
  const proto = Object.getPrototypeOf(a) as object;
  let d: PropertyDescriptor | undefined;
  for (let p: object | null = proto; p && !d; p = Object.getPrototypeOf(p)) d = Object.getOwnPropertyDescriptor(p, 'needsUpdate');
  const set = d?.set;
  if (!set) return;
  Object.defineProperty(a, 'needsUpdate', {
    configurable: true,
    set(v: boolean) {
      if (v === true && deferring() && bufOf.has(a) && (indexOk || !isIdx.has(a))) {
        // take the ranges three would have sent; an empty list means the whole array
        let r = rangesOf.get(a);
        if (!r) { r = []; rangesOf.set(a, r); }
        const ur = o.updateRanges;
        if (!attrs.has(a)) r.length = 0;
        if (ur.length === 0) { r.length = 0; r.push(0, a.array.length); }
        else for (const x of ur) r.push(x.start, x.count);
        a.clearUpdateRanges();
        attrs.add(a);
        return;
      }
      set.call(a, v);
    },
  });
}

/** the 'uploads' slot: every scheduled upload of this frame goes up now (renderer.render, before the shadow pass) */
export function flushUploads(r: WebGLRenderer): void {
  UPSCHED_STATS.bufs = 0; UPSCHED_STATS.bytes = 0; UPSCHED_STATS.texs = 0; UPSCHED_STATS.tasks = 0;
  flushedThisFrame = true;
  if (!UPSCHED) return;
  if (!gl) gl = r.getContext() as WebGL2RenderingContext;
  live = true;
  if (attrs.size && gl) {
    const g = gl;
    for (const a of attrs) {
      const b = bufOf.get(a);
      const r0 = rangesOf.get(a);
      if (!b || !r0) { (a as unknown as { version: number }).version++; continue; }
      const first = isIdx.has(a) && indexChecked === false;
      if (first) { indexChecked = true; while (g.getError() !== g.NO_ERROR) { /* clear */ } }
      g.bindBuffer(g.COPY_WRITE_BUFFER, b);
      if (first && g.getError() !== g.NO_ERROR) { indexOk = false; (a as unknown as { version: number }).version++; r0.length = 0; continue; }
      const arr = a.array as unknown as ArrayBufferView & { length: number; BYTES_PER_ELEMENT: number };
      // (ranges merged into one sorted pass: overlapping marks send their bytes once)
      const rs: [number, number][] = [];
      for (let k = 0; k < r0.length; k += 2) rs.push([r0[k], Math.min(arr.length, r0[k] + r0[k + 1])]);
      rs.sort((x, y) => x[0] - y[0]);
      let cs = -1, ce = -1;
      const send = () => { if (ce > cs) { g.bufferSubData(g.COPY_WRITE_BUFFER, cs * arr.BYTES_PER_ELEMENT, arr, cs, ce - cs); UPSCHED_STATS.bytes += (ce - cs) * arr.BYTES_PER_ELEMENT; } };
      for (const [s, e] of rs) { if (s <= ce) ce = Math.max(ce, e); else { send(); cs = s; ce = e; } }
      send();
      r0.length = 0;
      UPSCHED_STATS.bufs++;
      try { (a as unknown as { onUploadCallback: () => void }).onUploadCallback(); } catch { /* owner's */ }
    }
    attrs.clear();
    g.bindBuffer(g.COPY_WRITE_BUFFER, null);
  }
  for (const fn of tasks) { try { fn(); } catch { /* owner's */ } UPSCHED_STATS.tasks++; }
  tasks.length = 0;
  for (const t of texs) {
    const img = (t as unknown as { image: unknown }).image as { complete?: boolean } | null;
    if (!img || (t as unknown as { isRenderTargetTexture?: boolean }).isRenderTargetTexture || img.complete === false) continue;
    try { r.initTexture(t); UPSCHED_STATS.texs++; } catch { /* left to three at its draw */ }
  }
  texs.clear();
}

/** every attribute and the index of a geometry (a BatchedMesh page, after its first addGeometry made them) */
export function earlyGeo(geo: { attributes: Record<string, unknown>; index: unknown }): void {
  if (!UPSCHED) return;
  for (const a of new Set(Object.values(geo.attributes))) earlyAttr(a as BufferAttribute);
  if (geo.index) earlyAttr(geo.index as BufferAttribute, true);
}

/** (tests) forget the scheduler's state */
export function uploadSchedReset(): void { live = false; flushedThisFrame = false; tasks.length = 0; texs.clear(); attrs.clear(); gl = null; }
