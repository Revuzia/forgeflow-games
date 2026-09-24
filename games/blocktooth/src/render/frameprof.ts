// BLOCKTOOTH — frame profiler (dev / perf-attribution only; `?prof=1`).
//
// Per rendered frame: rAF gap, sim ticks + sim wall ms (from GameLoop), wall ms of every onFrame
// section (camera, lighting, each view, HUD, audio, render, dynres …), renderer.info deltas
// (programs / geometries / textures), JS heap delta (Chrome performance.memory — precise only
// with --enable-precise-memory-info), and the GPU time of core.render() via
// EXT_disjoint_timer_query_webgl2 (results arrive 1–3 frames later and are matched back by id).
// Keeps a ring of the last 1500 frames and the WORST 50 frames by rAF gap with their breakdown.
// Also records Long-Animation-Frame entries (script attribution for work outside rAF).
//
// Zero cost when off: the app only creates a FrameProf with ?prof=1.

import type * as THREE from 'three';

const RING = 1500;
const WORST = 50;

export interface ProfFrame {
  id: number;
  t: number;
  raw: number;
  ticks: number;
  sim: number;
  cpu: number;
  gpu: number;
  sec: Record<string, number>;
  dProg: number;
  dGeo: number;
  dTex: number;
  heap: number;
  dHeap: number;
  screen: string;
  note: string;
  scale: number;
}

interface GLTimer {
  gl: WebGL2RenderingContext;
  ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  pending: { q: WebGLQuery; id: number }[];
  free: WebGLQuery[];
  active: WebGLQuery | null;
}

export class FrameProf {
  private readonly names: string[] = [];
  private readonly idx = new Map<string, number>();
  private cur = new Float64Array(64);
  private last = 0;
  private id = 0;
  private readonly ring: ProfFrame[] = [];
  private head = 0;
  private worst: ProfFrame[] = [];
  private prevProg = -1;
  private prevGeo = -1;
  private prevTex = -1;
  private prevHeap = -1;
  private note = '';
  private readonly timer: GLTimer | null = null;
  private readonly byId = new Map<number, ProfFrame>();
  readonly loaf: { t: number; dur: number; block: number; render: number; style: number; scripts: string[] }[] = [];
  private frameStart = 0;
  gpuSupported = false;
  /** app-provided render scale for the current frame (DynRes) */
  scale = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    try {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GLTimer['ext'] | null;
      if (ext) {
        this.timer = { gl, ext, pending: [], free: [], active: null };
        this.gpuSupported = true;
      }
    } catch { /* no timer */ }
    try {
      const PO = (globalThis as unknown as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
      if (PO && PO.supportedEntryTypes && PO.supportedEntryTypes.includes('long-animation-frame')) {
        const po = new PO((list) => {
          for (const e of list.getEntries() as unknown as {
            startTime: number; duration: number; blockingDuration: number; renderStart: number; styleAndLayoutStart: number;
            scripts: { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number }[];
          }[]) {
            if (this.loaf.length > 400) this.loaf.shift();
            this.loaf.push({
              t: Math.round(e.startTime), dur: Math.round(e.duration), block: Math.round(e.blockingDuration),
              render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0),
              style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0),
              scripts: (e.scripts || []).map((s) => `${Math.round(s.duration)}ms ${s.invoker} ${s.sourceFunctionName || ''} ${(s.sourceURL || '').split('/').pop()}`),
            });
          }
        });
        po.observe({ type: 'long-animation-frame', buffered: false });
      }
    } catch { /* no LoAF */ }
  }

  /** Annotate the current frame (e.g. "dynres 0.9", "draft open"). */
  annotate(s: string): void { this.note += (this.note ? ' ' : '') + s; }

  begin(): void {
    this.cur.fill(0);
    this.frameStart = this.last = performance.now();
  }

  /** Charge the time since the previous mark to `name`. */
  mark(name: string): void {
    const now = performance.now();
    let i = this.idx.get(name);
    if (i === undefined) {
      i = this.names.length;
      this.names.push(name);
      this.idx.set(name, i);
      if (i >= this.cur.length) { const n = new Float64Array(this.cur.length * 2); n.set(this.cur); this.cur = n; }
    }
    this.cur[i] += now - this.last;
    this.last = now;
  }

  /** Reset the mark clock without charging (skip untimed gaps). */
  skip(): void { this.last = performance.now(); }

  gpuBegin(): void {
    const T = this.timer;
    if (!T || T.active) return;
    const q = T.free.pop() ?? T.gl.createQuery();
    if (!q) return;
    T.gl.beginQuery(T.ext.TIME_ELAPSED_EXT, q);
    T.active = q;
  }

  gpuEnd(): void {
    const T = this.timer;
    if (!T || !T.active) return;
    T.gl.endQuery(T.ext.TIME_ELAPSED_EXT);
    T.pending.push({ q: T.active, id: this.id });
    T.active = null;
  }

  private pollGpu(): void {
    const T = this.timer;
    if (!T) return;
    const gl = T.gl;
    const disjoint = gl.getParameter(T.ext.GPU_DISJOINT_EXT);
    while (T.pending.length) {
      const p = T.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
      T.pending.shift();
      T.free.push(p.q);
      const f = this.byId.get(p.id);
      if (f && !disjoint) f.gpu = Math.round(ns / 1e4) / 100;
    }
  }

  end(raw: number, ticks: number, sim: number, info: THREE.WebGLInfo, screen: string): void {
    const end = performance.now();
    this.pollGpu();
    const sec: Record<string, number> = {};
    for (let i = 0; i < this.names.length; i++) if (this.cur[i] >= 0.05) sec[this.names[i]] = Math.round(this.cur[i] * 100) / 100;
    const prog = info.programs ? info.programs.length : 0;
    const geo = info.memory.geometries, tex = info.memory.textures;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heap = mem ? mem.usedJSHeapSize : 0;
    const f: ProfFrame = {
      id: this.id, t: Math.round(this.frameStart), raw: Math.round(raw * 100) / 100, ticks, sim: Math.round(sim * 100) / 100,
      cpu: Math.round((end - this.frameStart) * 100) / 100, gpu: -1, sec,
      dProg: this.prevProg < 0 ? 0 : prog - this.prevProg,
      dGeo: this.prevGeo < 0 ? 0 : geo - this.prevGeo,
      dTex: this.prevTex < 0 ? 0 : tex - this.prevTex,
      heap: Math.round(heap / 1024), dHeap: this.prevHeap < 0 ? 0 : Math.round((heap - this.prevHeap) / 1024),
      screen, note: this.note, scale: this.scale,
    };
    this.prevProg = prog; this.prevGeo = geo; this.prevTex = tex; this.prevHeap = heap;
    this.note = '';
    const prevF = this.ring[(this.head - 1 + RING) % RING];
    const old = this.ring[this.head];
    if (old) this.byId.delete(old.id);
    this.ring[this.head] = f;
    this.head = (this.head + 1) % RING;
    this.byId.set(f.id, f);
    this.id++;
    // worst-N by rAF gap
    if (this.worst.length < WORST || raw > this.worst[this.worst.length - 1].raw) {
      (f as ProfFrame & { prev?: ProfFrame }).prev = prevF;
      this.worst.push(f);
      this.worst.sort((a, b) => b.raw - a.raw);
      if (this.worst.length > WORST) this.worst.length = WORST;
    }
  }

  reset(): void {
    this.ring.length = 0; this.head = 0; this.worst = []; this.byId.clear(); this.loaf.length = 0;
  }

  /** Everything recorded: worst frames (with the 2 frames before each), the per-section means, LoAFs. */
  dump(): unknown {
    const n = this.ring.length;
    const ordered: ProfFrame[] = [];
    for (let i = 0; i < n; i++) ordered.push(this.ring[(this.head - n + i + RING * 2) % RING] ?? this.ring[i]);
    const mean: Record<string, number> = {};
    const max: Record<string, number> = {};
    let gpuSum = 0, gpuN = 0;
    for (const f of ordered) {
      for (const k in f.sec) { mean[k] = (mean[k] ?? 0) + f.sec[k] / n; max[k] = Math.max(max[k] ?? 0, f.sec[k]); }
      if (f.gpu >= 0) { gpuSum += f.gpu; gpuN++; }
    }
    for (const k in mean) mean[k] = Math.round(mean[k] * 100) / 100;
    return {
      gpuSupported: this.gpuSupported, frames: n, gpuMean: gpuN ? Math.round((gpuSum / gpuN) * 100) / 100 : -1,
      gpuP: pctl(ordered.filter((f) => f.gpu >= 0).map((f) => f.gpu)),
      rawP: pctl(ordered.map((f) => f.raw)), cpuP: pctl(ordered.map((f) => f.cpu)),
      mean, max,
      worst: this.worst.map((f) => {
        const p = (f as ProfFrame & { prev?: ProfFrame }).prev;
        return { ...f, prev: p ? { ...p, prev: undefined } : null };
      }), series: ordered.map((f) => [f.raw, f.cpu, f.gpu, f.ticks, f.dHeap, f.screen === 'play' ? 1 : 0, f.sec.render ?? 0, f.note, f.id, f.scale]),
      loaf: this.loaf,
    };
  }
}

function pctl(a: number[]): Record<string, number> {
  if (!a.length) return {};
  const s = a.slice().sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length - 1] };
}
