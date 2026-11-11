// GENESIS — the performance report (PERF session 5, owner: "make it work smoothly" on a Mac we cannot measure here).
//
// In the frame monitor's overlay (Shift+F12 or ?perf=1) "Record 20 s" captures, per frame: the interval and the main
// thread's own ms (per subsystem slot), the renderer's draw calls / triangles / patches built, the camera's height and
// travel, new GPU programs and sim snapshots — and the GPU time of each pass group (planets, actors, shadows, scene,
// post) through EXT_disjoint_timer_query_webgl2 where the browser has it (Chrome on a Mac does; without it the GPU
// column says so). Long tasks come from PerformanceObserver('longtask'). "Copy report" puts a compact text on the
// clipboard (or shows it selected, where the clipboard is blocked) for the owner to paste to us: frame-time
// percentiles, hitches over 50 ms with what was happening in them, GPU ms per pass, canvas / DPR / preset and the
// GPU's renderer string. Costs nothing unless recording (the hooks are one branch).

import { perfSwitchLine } from './perfswitch.ts';

declare const __GENESIS_BUILD__: string | undefined;
/** the commit + build time vite.config.ts stamps into the bundle ('dev' when run from source) */
export const BUILD_STAMP: string = typeof __GENESIS_BUILD__ === 'string' ? __GENESIS_BUILD__ : 'dev';

export const GPU_SLOTS = ['planets', 'actors', 'shadows', 'scene', 'post'] as const;
type GpuSlot = (typeof GPU_SLOTS)[number];

/** what the app tells the recorder each frame (app.ts perfmon.context) */
export interface PerfContext {
  drawCalls: number;
  triangles: number;
  shadowTris: number;
  patchesBuilt: number;
  altitude: number;
  /** camera position (any frame of reference that is continuous over a few frames), metres */
  cam: [number, number, number];
  speed: number;
  programs: number;
  /** anything else worth a word in a hitch line (e.g. 'cut') */
  note?: string;
}

/** static facts for the report header */
export interface PerfEnv {
  gpu: string;
  preset: string;
  canvas: string;
  dpr: number;
  extra?: string;
}

interface FrameRec {
  t: number; iv: number; work: number;
  slots: Float64Array;
  draws: number; tris: number; shadowTris: number; built: number; programs: number; alt: number; moved: number; speed: number;
  note: string;
  gpu: Float64Array;
}

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f1 = (x: number) => (Math.round(x * 10) / 10).toString();

/**
 * PERF s7 (the owner's M5 report: 300 ms frames with 206 ms of MAIN-thread time in the shadow pass and GPU timer sums
 * of ~1 s a frame — more than the frame itself, so ANGLE-Metal's timers overlap and cannot itemise the GPU): while
 * recording, every GL call that can block or move data is timed on the main thread and charged to the frame's current
 * slot: uploads (bytes), draws, framebuffer switches, syncs, compiles. An upload issued after a draw into the same
 * framebuffer is counted 'inside a pass': on a tile GPU (Apple) ANGLE must end the render pass there (store and reload
 * every attachment) or copy the resource — a cost no software renderer shows. Restored when the recording stops.
 */
const GL_TRACED = [
  'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexSubImage2D', 'copyTexSubImage2D',
  'generateMipmap', 'blitFramebuffer', 'readPixels', 'clear', 'invalidateFramebuffer', 'bindFramebuffer', 'useProgram', 'linkProgram',
  'compileShader', 'getProgramParameter', 'getShaderParameter', 'flush', 'finish', 'clientWaitSync', 'getError', 'getParameter',
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'bindVertexArray',
] as const;
const GL_UPLOADS = new Set<string>(['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexSubImage2D', 'generateMipmap']);
const GL_DRAWS = new Set<string>(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL']);

/** bytes an upload call moves (approximate for images: width x height x 4 when the source is not a typed array) */
function uploadBytes(op: string, a: unknown[]): number {
  const view = (x: unknown) => (x && typeof x === 'object' && 'byteLength' in (x as object) ? (x as ArrayBufferView).byteLength : 0);
  if (op === 'bufferData') return typeof a[1] === 'number' ? (a[1] as number) : view(a[1]);
  if (op === 'bufferSubData') return typeof a[4] === 'number' && a[2] && (a[2] as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ? (a[4] as number) * (a[2] as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT : view(a[2]);
  if (op === 'texSubImage2D') return typeof a[4] === 'number' && typeof a[5] === 'number' ? (a[4] as number) * (a[5] as number) * 4 : 0;
  if (op === 'texImage2D') return typeof a[3] === 'number' && typeof a[4] === 'number' ? (a[3] as number) * (a[4] as number) * 4 : 0;
  if (op === 'texSubImage3D') return typeof a[5] === 'number' ? (a[5] as number) * (a[6] as number) * (a[7] as number) * 4 : 0;
  if (op === 'texImage3D') return typeof a[3] === 'number' ? (a[3] as number) * (a[4] as number) * (a[5] as number) * 4 : 0;
  return 0;
}

interface GlStat { ms: number; n: number; bytes: number; inPass: number; max: number }

/**
 * PERF s8 — the buffer memory ANGLE's Metal back end (Chrome on a Mac) allocates for these calls (BufferMtl.mm,
 * mtl_buffer_manager.mm): gl.bufferData takes a NEW Metal buffer of its size; gl.bufferSubData into a buffer the GPU
 * still reads (anything drawn in the last frames while the GPU lags) takes a new buffer of the buffer's WHOLE size
 * (putDataInNewBufferAndStartUsingNewBuffer) and blits the rest across. Buffers are reused only at the exact same size
 * once the GPU is done with them; every 64 MB of fresh allocations ANGLE flushes with WaitUntilFinished — the main
 * thread then waits for the whole GPU queue inside that GL call. Estimated here as if every sub-updated buffer were in
 * use (an upper bound), per slot, with the sizes seen: a size first seen this recording counts as fresh.
 */
export interface MetalAlloc { bytes: number; fresh: number; n: number }

export class GlTrace {
  slot = 'other';
  readonly stats = new Map<string, GlStat>();
  passSwitches = 0;
  inPassUploads = 0;
  /** per slot: Metal buffer bytes ANGLE would take (bufferData + whole-buffer copies for bufferSubData) */
  readonly metal = new Map<string, MetalAlloc>();
  /** buffer sizes ANGLE's free lists would hold (each size counted once: the steady state reuses them) */
  private sizesSeen = new Map<number, number>();
  private bound = new Map<number, WebGLBuffer | null>();
  private bufSize = new WeakMap<WebGLBuffer, number>();
  private drawn = false;
  private restore: (() => void)[] = [];

  /** wrap the context's (and WEBGL_multi_draw's) calls; idempotent */
  install(gl: WebGL2RenderingContext): void {
    if (this.restore.length) return;
    const wrap = (obj: Record<string, unknown>, name: string) => {
      const orig = obj[name];
      if (typeof orig !== 'function') return;
      const own = Object.prototype.hasOwnProperty.call(obj, name);
      const self = this;
      obj[name] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        const r = (orig as (...x: unknown[]) => unknown).apply(obj, a);
        self.note(name, performance.now() - t, a);
        return r;
      };
      this.restore.push(() => { if (own) obj[name] = orig; else delete obj[name]; });
    };
    for (const n of GL_TRACED) wrap(gl as unknown as Record<string, unknown>, n);
    // (buffer bindings, untimed: which buffer a bufferData / bufferSubData targets, for the Metal estimate)
    {
      const o = gl as unknown as Record<string, unknown>;
      const orig = o.bindBuffer;
      if (typeof orig === 'function') {
        const own = Object.prototype.hasOwnProperty.call(o, 'bindBuffer');
        const self = this;
        o.bindBuffer = function (target: number, buf: WebGLBuffer | null) { self.bound.set(target, buf); return (orig as (t: number, b: WebGLBuffer | null) => void).call(o, target, buf); };
        this.restore.push(() => { if (own) o.bindBuffer = orig; else delete o.bindBuffer; });
      }
    }
    try {
      const md = gl.getExtension('WEBGL_multi_draw') as Record<string, unknown> | null;
      if (md) for (const n of ['multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL']) wrap(md, n);
    } catch { /* none */ }
  }

  uninstall(): void { for (const f of this.restore.splice(0).reverse()) f(); }

  reset(): void { this.stats.clear(); this.metal.clear(); this.sizesSeen.clear(); this.passSwitches = 0; this.inPassUploads = 0; this.drawn = false; }

  /** the Metal allocation a buffer call implies (see MetalAlloc) */
  private noteMetal(op: string, a: unknown[], bytes: number): void {
    const buf = this.bound.get(a[0] as number);
    let size = 0;
    if (op === 'bufferData') { size = bytes; if (buf) this.bufSize.set(buf, size); }
    else size = buf ? this.bufSize.get(buf) ?? 0 : 0;
    if (size <= 0) return;
    size = Math.ceil(size / 16) * 16;
    let m = this.metal.get(this.slot);
    if (!m) { m = { bytes: 0, fresh: 0, n: 0 }; this.metal.set(this.slot, m); }
    m.bytes += size; m.n++;
    const seen = this.sizesSeen.get(size) ?? 0;
    // (a size never seen is a fresh allocation; sizes cycle through ~3 buffers while the GPU lags two frames)
    if (seen < 3) { m.fresh += size; this.sizesSeen.set(size, seen + 1); }
  }

  private note(op: string, ms: number, a: unknown[]): void {
    let inPass = 0, bytes = 0;
    if (op === 'bindFramebuffer') { this.passSwitches++; this.drawn = false; }
    else if (GL_DRAWS.has(op)) this.drawn = true;
    else if (GL_UPLOADS.has(op)) {
      bytes = uploadBytes(op, a);
      if (this.drawn) { inPass = 1; this.inPassUploads++; }
      if (op === 'bufferData' || op === 'bufferSubData') this.noteMetal(op, a, bytes);
    }
    const key = `${this.slot}|${op}`;
    let s = this.stats.get(key);
    if (!s) { s = { ms: 0, n: 0, bytes: 0, inPass: 0, max: 0 }; this.stats.set(key, s); }
    s.ms += ms; s.n++; s.bytes += bytes; s.inPass += inPass;
    if (ms > s.max) s.max = ms;
  }

  /** report lines: the costliest (slot, call) pairs per frame */
  lines(frames: number): string[] {
    const k = 1 / Math.max(1, frames);
    const rows = [...this.stats.entries()].sort((a, b) => b[1].ms - a[1].ms);
    const tot = rows.reduce((x, [, s]) => x + s.ms, 0);
    const L = [`gl calls (main ms/frame in the call): total ${f1(tot * k)} | framebuffer switches ${f1(this.passSwitches * k)}/frame | uploads inside a pass ${f1(this.inPassUploads * k)}/frame`];
    L.push('  ' + rows.slice(0, 16).map(([key, s]) => `${key} ${f2(s.ms * k)}ms x${f1(s.n * k)}${s.bytes ? ` ${f2((s.bytes * k) / 1e6)}MB` : ''}${s.inPass ? ` inpass ${f1(s.inPass * k)}` : ''} max ${f1(s.max)}`).join(' · '));
    if (this.metal.size) {
      const ms = [...this.metal.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
      const all = ms.reduce((x, [, m]) => x + m.bytes, 0), fresh = ms.reduce((x, [, m]) => x + m.fresh, 0);
      L.push(`metal buffer allocs (est., ANGLE-Metal): ${f1((all * k) / 1e6)} MB/frame, fresh sizes ${f1(fresh / 1e6)} MB over the recording (a full GPU wait per 64 MB fresh) | `
        + ms.map(([s, m]) => `${s} ${f1((m.bytes * k) / 1e6)}MB x${f1(m.n * k)}`).join(' · '));
    }
    return L;
  }
}
const f2 = (x: number) => (Math.round(x * 100) / 100).toString();

export class PerfRecorder {
  /** GL calls timed per slot while recording (GlTrace) */
  readonly glTrace = new GlTrace();
  recording = false;
  /** the finished report text (after stop) */
  report = '';
  private t0 = 0;
  private until = 0;
  private frames: FrameRec[] = [];
  private slotNames: readonly string[];
  private gl: WebGL2RenderingContext | null = null;
  private ext: TimerExt | null = null;
  private pool: WebGLQuery[] = [];
  private pending: { q: WebGLQuery; slot: number; rec: FrameRec }[] = [];
  private openSlot = -1;
  private cur: FrameRec | null = null;
  private lastCam: [number, number, number] | null = null;
  private lastBuilt = -1;
  private lastPrograms = -1;
  private longTasks: { t: number; d: number }[] = [];
  private obs: PerformanceObserver | null = null;
  private disjoint = 0;
  private gpuOk = false;
  private onDone: ((text: string) => void) | null = null;
  env: PerfEnv | null = null;

  constructor(slotNames: readonly string[]) { this.slotNames = slotNames; }

  /** the GL context whose passes are timed (null: no GPU column) */
  attach(gl: WebGL2RenderingContext | null): void {
    this.gl = gl;
    try { this.ext = gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) : null; } catch { this.ext = null; }
  }

  get hasGpuTimer(): boolean { return !!this.ext; }

  start(ms: number, onDone?: (text: string) => void): void {
    this.frames = [];
    this.longTasks = [];
    this.pending = [];
    this.disjoint = 0;
    this.gpuOk = false;
    this.lastCam = null;
    this.lastBuilt = -1;
    this.lastPrograms = -1;
    this.t0 = performance.now();
    this.until = this.t0 + ms;
    this.recording = true;
    this.report = '';
    this.glTrace.reset();
    this.glTrace.slot = 'other';
    try { if (this.gl && !/[?&]gltrace=0(&|$)/.test(globalThis.location?.search ?? '')) this.glTrace.install(this.gl); } catch { /* untraced */ }
    this.onDone = onDone ?? null;
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        this.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) this.longTasks.push({ t: e.startTime - this.t0, d: e.duration }); });
        this.obs.observe({ type: 'longtask', buffered: false } as PerformanceObserverInit);
      }
    } catch { this.obs = null; }
  }

  /** perfmon.begin / end of a slot while recording: GPU timer queries around the pass groups */
  gpuBegin(slot: string): void {
    this.glTrace.slot = slot;
    const gl = this.gl, ext = this.ext;
    if (!gl || !ext || this.openSlot >= 0 || !this.cur) return;
    const i = (GPU_SLOTS as readonly string[]).indexOf(slot);
    if (i < 0) return;
    try {
      const q = this.pool.pop() ?? gl.createQuery();
      if (!q) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      this.openSlot = i;
      this.pending.push({ q, slot: i, rec: this.cur });
    } catch { this.ext = null; }
  }

  gpuEnd(slot: string): void {
    if (this.glTrace.slot === slot) this.glTrace.slot = 'other';
    const gl = this.gl, ext = this.ext;
    if (!gl || !ext || this.openSlot < 0 || GPU_SLOTS[this.openSlot] !== slot) return;
    try { gl.endQuery(ext.TIME_ELAPSED_EXT); } catch { this.ext = null; }
    this.openSlot = -1;
  }

  /** the start of a frame being recorded (perfmon.frameStart) */
  frameBegin(): void {
    if (!this.recording) return;
    this.cur = { t: 0, iv: 0, work: 0, slots: new Float64Array(this.slotNames.length), draws: 0, tris: 0, shadowTris: 0, built: 0, programs: 0, alt: 0, moved: 0, speed: 0, note: '', gpu: new Float64Array(GPU_SLOTS.length).fill(-1) };
  }

  /** the end of a frame (perfmon.frameEnd): its interval, the main thread's ms and slots, and the app's context */
  frameDone(iv: number, work: number, slots: Float64Array, ctx: PerfContext | null): void {
    const r = this.cur;
    if (!this.recording || !r) return;
    this.cur = null;
    const now = performance.now();
    r.t = now - this.t0; r.iv = iv; r.work = work; r.slots.set(slots);
    if (ctx) {
      r.draws = ctx.drawCalls; r.tris = ctx.triangles; r.shadowTris = ctx.shadowTris; r.alt = ctx.altitude; r.speed = ctx.speed; r.note = ctx.note ?? '';
      r.built = this.lastBuilt >= 0 ? Math.max(0, ctx.patchesBuilt - this.lastBuilt) : 0;
      r.programs = this.lastPrograms >= 0 ? Math.max(0, ctx.programs - this.lastPrograms) : 0;
      r.moved = this.lastCam ? Math.hypot(ctx.cam[0] - this.lastCam[0], ctx.cam[1] - this.lastCam[1], ctx.cam[2] - this.lastCam[2]) : 0;
      this.lastBuilt = ctx.patchesBuilt; this.lastPrograms = ctx.programs; this.lastCam = [ctx.cam[0], ctx.cam[1], ctx.cam[2]];
    }
    this.frames.push(r);
    this.pollGpu(false);
    if (now >= this.until) this.stop();
  }

  private pollGpu(final: boolean): void {
    const gl = this.gl, ext = this.ext;
    if (!gl || !this.pending.length) return;
    try {
      if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        // (the GPU's clock jumped: every result in flight is meaningless)
        this.disjoint++;
        for (const p of this.pending) this.pool.push(p.q);
        this.pending = [];
        return;
      }
      while (this.pending.length) {
        const p = this.pending[0];
        if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { if (final) { gl.deleteQuery(p.q); this.pending.shift(); continue; } break; }
        const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
        p.rec.gpu[p.slot] = (p.rec.gpu[p.slot] < 0 ? 0 : p.rec.gpu[p.slot]) + ns / 1e6;
        this.gpuOk = true;
        this.pool.push(p.q);
        this.pending.shift();
      }
    } catch { this.ext = null; }
  }

  stop(): void {
    if (!this.recording) return;
    this.recording = false;
    this.glTrace.uninstall();
    if (this.openSlot >= 0) this.gpuEnd(GPU_SLOTS[this.openSlot]);
    try { this.obs?.disconnect(); } catch { /* gone */ }
    this.obs = null;
    // (results of the last frames arrive a frame or two later: give them a moment)
    const finish = () => { this.pollGpu(true); this.report = this.compose(); this.onDone?.(this.report); };
    if (this.pending.length && typeof setTimeout !== 'undefined') setTimeout(finish, 120); else finish();
  }

  /** the report text (compact, for pasting) */
  compose(): string {
    const F = this.frames.slice(1);
    const L: string[] = [];
    const env = this.env;
    const dur = F.length ? (F[F.length - 1].t - F[0].t + F[0].iv) / 1000 : 0;
    L.push(`GENESIS perf report v1 · ${new Date().toISOString().slice(0, 19)}Z · ${f1(dur)} s · ${F.length} frames · build ${BUILD_STAMP}`);
    if (env) L.push(`gpu: ${env.gpu} | preset ${env.preset} | canvas ${env.canvas} | dpr ${env.dpr}${env.extra ? ' | ' + env.extra : ''}`);
    L.push(`perf fixes (A/B switches, effective): ${perfSwitchLine() || 'none'}`);
    if (typeof navigator !== 'undefined') L.push(`ua: ${navigator.userAgent.replace(/\s+/g, ' ').slice(0, 160)} | cores ${navigator.hardwareConcurrency ?? '?'}`);
    if (!F.length) { L.push('no frames recorded'); return L.join('\n'); }
    const iv = F.map((r) => r.iv), wk = F.map((r) => r.work);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    L.push(`frame ms: p50 ${f1(pct(iv, 0.5))} p95 ${f1(pct(iv, 0.95))} p99 ${f1(pct(iv, 0.99))} max ${f1(Math.max(...iv))} | fps ${f1(1000 / Math.max(1e-3, mean(iv)))} | >20ms ${iv.filter((x) => x > 20).length} >33ms ${iv.filter((x) => x > 33.4).length} >50ms ${iv.filter((x) => x > 50).length}`);
    L.push(`main ms: mean ${f1(mean(wk))} p95 ${f1(pct(wk, 0.95))} max ${f1(Math.max(...wk))}`);
    const sl = this.slotNames.map((n, i) => [n, mean(F.map((r) => r.slots[i])), pct(F.map((r) => r.slots[i]), 0.95)] as [string, number, number]).filter((x) => x[1] >= 0.05);
    L.push(`main by slot (mean/p95): ${sl.map(([n, m, p]) => `${n} ${f1(m)}/${f1(p)}`).join(' ')}`);
    if (this.gpuOk) {
      const g = GPU_SLOTS.map((n, i) => { const v = F.map((r) => r.gpu[i]).filter((x) => x >= 0); return [n, mean(v), pct(v, 0.95), v.length] as [string, number, number, number]; });
      const tot = F.map((r) => { let s = 0, any = false; for (const x of r.gpu) if (x >= 0) { s += x; any = true; } return any ? s : -1; }).filter((x) => x >= 0);
      L.push(`gpu ms (mean/p95): ${g.map(([n, m, p]) => `${n} ${f1(m)}/${f1(p)}`).join(' ')} | total ${f1(mean(tot))}/${f1(pct(tot, 0.95))}${this.disjoint ? ` (disjoint ${this.disjoint})` : ''}${mean(tot) > mean(iv) * 1.05 ? ' | NOTE: more GPU ms than frame ms: this driver\'s timer spans overlap, not additive' : ''}`);
    } else L.push(`gpu ms: ${this.ext || this.disjoint ? 'no results' : 'no timer query in this browser'}`);
    L.push(`render: draws ${Math.round(mean(F.map((r) => r.draws)))} (max ${Math.max(...F.map((r) => r.draws))}) tris ${f1(mean(F.map((r) => r.tris)) / 1e6)}M shadow ${f1(mean(F.map((r) => r.shadowTris)) / 1e6)}M | patches built ${F.reduce((a, r) => a + r.built, 0)} | new programs ${F.reduce((a, r) => a + r.programs, 0)}`);
    if (this.glTrace.stats.size) L.push(...this.glTrace.lines(this.frames.length));
    const alts = F.map((r) => r.alt);
    L.push(`camera: alt ${Math.round(Math.min(...alts))}-${Math.round(Math.max(...alts))} m, travelled ${Math.round(F.reduce((a, r) => a + r.moved, 0))} m | sim speed ${[...new Set(F.map((r) => r.speed))].join('/')}`);
    const lt = this.longTasks;
    L.push(`long tasks: ${lt.length}${lt.length ? ` (max ${Math.round(Math.max(...lt.map((x) => x.d)))} ms, total ${Math.round(lt.reduce((a, x) => a + x.d, 0))} ms)` : ''}`);
    // hitches: the worst frames over 50 ms (or the worst five) with what was going on
    const bad = F.filter((r) => r.iv > 50).sort((a, b) => b.iv - a.iv).slice(0, 12);
    L.push(`hitches >50ms: ${F.filter((r) => r.iv > 50).length}`);
    for (const r of bad.sort((a, b) => a.t - b.t)) {
      const top = this.slotNames.map((n, i) => [n, r.slots[i]] as [string, number]).filter((x) => x[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const gsum = Array.from(r.gpu).filter((x) => x >= 0);
      const lts = lt.filter((x) => x.t <= r.t && x.t + x.d >= r.t - r.iv);
      L.push(`  t ${f1(r.t / 1000)}s ${Math.round(r.iv)} ms: main ${Math.round(r.work)} [${top.map(([n, v]) => `${n} ${Math.round(v)}`).join(' ')}]`
        + `${gsum.length ? ` gpu ${f1(gsum.reduce((a, x) => a + x, 0))}` : ''} | draws ${r.draws} built ${r.built} +prog ${r.programs} | alt ${Math.round(r.alt)} moved ${Math.round(r.moved)} m`
        + `${lts.length ? ` | longtask ${Math.round(Math.max(...lts.map((x) => x.d)))}` : ''}${r.note ? ` | ${r.note}` : ''}`);
    }
    // a coarse timeline: worst interval per second
    // (at most 30 buckets: a long recording widens them)
    const span = Math.max(1, Math.ceil((F[F.length - 1].t + 1) / 1000 / 30));
    const secs: number[] = [];
    for (const r of F) { const s = Math.floor(r.t / 1000 / span); secs[s] = Math.max(secs[s] ?? 0, r.iv); }
    L.push(`worst per ${span} s: ${Array.from(secs, (x) => Math.round(x ?? 0)).join(' ')}`);
    return L.join('\n');
  }
}
