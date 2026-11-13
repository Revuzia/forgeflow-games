/**
 * FFG runtime — 3d/ffg_frameprof.js  (ES module; dev / perf-attribution only)
 *
 * Port of blocktooth/src/render/frameprof.ts with the types stripped, adapted to
 * the Last Circle contract C3: `kernel.prof.begin(name)` / `kernel.prof.end(name)`
 * section timers (nesting-safe: each name keeps its own start stamp, so
 * "updaters" can enclose "bots"), `gpuBegin()` / `gpuEnd()` around the GPU work.
 *
 * ACTIVE ONLY WITH `?prof=1`. The kernel dynamic-imports this module only when
 * the flag is set, and its loop makes no profiler call at all when it is off —
 * without the flag `kernel.prof` is the frozen NOOP_PROF below. `&profgpu=0`
 * keeps the CPU marks but skips the GPU timer queries (isolates their own cost).
 *
 * Per rendered frame it records: the rAF gap (raw), the frame body's CPU ms,
 * every section's ms, the frame's HONEST draw calls + triangles (the kernel sets
 * renderer.info.autoReset = false and resets once per frame, so the shadow,
 * bloom and output passes are all counted, not just the last render() call),
 * program / geometry / texture deltas, the JS heap delta (Chrome
 * performance.memory; precise only with --enable-precise-memory-info) and the
 * GPU ms of the render section via EXT_disjoint_timer_query_webgl2 (results
 * arrive 1-3 frames later and are matched back by frame id).
 * A ring of the last 1500 frames, the WORST 50 by rAF gap (each with the frame
 * before it), and Long-Animation-Frame entries (script attribution for work
 * outside rAF).
 *
 * Milliseconds are INFORMATION (the box is shared and noisy); counts are exact.
 */

const RING = 1500;
const WORST = 50;

/** What the kernel exposes as `kernel.prof` when ?prof=1 is absent: every
 * method is an inert no-op, so a caller (ffg_royale3d.js per-module marks) never
 * has to feature-detect the profiler itself — only whether `kernel.prof` exists. */
export const NOOP_PROF = Object.freeze({
  enabled: false,
  gpuSupported: false,
  begin() {}, end() {}, mark() {}, skip() {},
  gpuBegin() {}, gpuEnd() {},
  annotate() {}, resync() {}, reset() {},
  frameBegin() {}, frameEnd() {},
  dump() { return { enabled: false, frames: 0 }; },
});

export class FrameProf {
  constructor(renderer, opts) {
    opts = opts || {};
    this.enabled = true;
    this.budget = opts.budget || null;
    this.renderer = renderer;
    this.names = [];
    this.idx = new Map();
    this.cur = new Float64Array(64);     // ms charged per section this frame
    this.start = new Float64Array(64);   // per-section begin() stamp (-1 = not open)
    this.start.fill(-1);
    this.id = 0;
    this.ring = [];
    this.head = 0;
    this.worst = [];
    this.byId = new Map();
    this.loaf = [];
    this.prevProg = -1; this.prevGeo = -1; this.prevTex = -1; this.prevHeap = -1;
    this.note = "";
    this.frameStart = 0;
    this.lastMark = 0;
    this.inFrame = false;
    this.timer = null;
    this.gpuSupported = false;
    let gpuOn = true;
    try { gpuOn = new URLSearchParams(location.search).get("profgpu") !== "0"; } catch (e) { /* default on */ }
    try {
      const gl = renderer.getContext();
      const ext = gpuOn ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
      if (ext) {
        this.timer = { gl, ext, pending: [], free: [], active: null };
        this.gpuSupported = true;
      }
    } catch (e) { /* no timer */ }
    try {
      const PO = globalThis.PerformanceObserver;
      if (PO && PO.supportedEntryTypes && PO.supportedEntryTypes.includes("long-animation-frame")) {
        const po = new PO((list) => {
          for (const e of list.getEntries()) {
            if (this.loaf.length > 400) this.loaf.shift();
            this.loaf.push({
              t: Math.round(e.startTime), dur: Math.round(e.duration), block: Math.round(e.blockingDuration || 0),
              render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0),
              style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0),
              scripts: (e.scripts || []).map((s) => Math.round(s.duration) + "ms " + s.invoker + " " + (s.sourceFunctionName || "") + " " + String(s.sourceURL || "").split("/").pop()),
            });
          }
        });
        po.observe({ type: "long-animation-frame", buffered: false });
        this._po = po;
      }
    } catch (e) { /* no LoAF */ }
  }

  _slot(name) {
    let i = this.idx.get(name);
    if (i === undefined) {
      i = this.names.length;
      this.names.push(name);
      this.idx.set(name, i);
      if (i >= this.cur.length) {
        const n = new Float64Array(this.cur.length * 2); n.set(this.cur); this.cur = n;
        const s = new Float64Array(this.start.length * 2); s.fill(-1); s.set(this.start); this.start = s;
      }
    }
    return i;
  }

  /** C3: open a named section. Re-opening an open section restarts it. */
  begin(name) { this.start[this._slot(name)] = performance.now(); }

  /** C3: close a named section and charge its elapsed ms to this frame. */
  end(name) {
    const i = this._slot(name);
    const s = this.start[i];
    if (s < 0) return;
    this.cur[i] += performance.now() - s;
    this.start[i] = -1;
  }

  /** blocktooth-style sequential mark: charge the time since the previous mark. */
  mark(name) {
    const now = performance.now();
    this.cur[this._slot(name)] += now - this.lastMark;
    this.lastMark = now;
  }

  /** Reset the sequential-mark clock without charging. */
  skip() { this.lastMark = performance.now(); }

  /** Free-text note on the current frame (e.g. "warmup +27 programs"). */
  annotate(s) { this.note += (this.note ? " " : "") + s; }

  gpuBegin() {
    const T = this.timer;
    if (!T || T.active) return;          // TIME_ELAPSED queries cannot nest
    const q = T.free.pop() || T.gl.createQuery();
    if (!q) return;
    T.gl.beginQuery(T.ext.TIME_ELAPSED_EXT, q);
    T.active = q;
  }

  gpuEnd() {
    const T = this.timer;
    if (!T || !T.active) return;
    T.gl.endQuery(T.ext.TIME_ELAPSED_EXT);
    T.pending.push({ q: T.active, id: this.id });
    T.active = null;
  }

  _pollGpu() {
    const T = this.timer;
    if (!T) return;
    const gl = T.gl;
    const disjoint = gl.getParameter(T.ext.GPU_DISJOINT_EXT);
    while (T.pending.length) {
      const p = T.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT);
      T.pending.shift();
      T.free.push(p.q);
      const f = this.byId.get(p.id);
      if (f && !disjoint) f.gpu = Math.round(ns / 1e4) / 100;
    }
  }

  /** Kernel only: start of a frame body. */
  frameBegin() {
    this.cur.fill(0);
    this.frameStart = this.lastMark = performance.now();
    this.inFrame = true;
  }

  /** Kernel only: end of a frame body. `raw` = rAF gap in ms (or the stepped dt). */
  frameEnd(raw, info) {
    if (!this.inFrame) return;
    this.inFrame = false;
    const end = performance.now();
    this._pollGpu();
    const sec = {};
    for (let i = 0; i < this.names.length; i++) if (this.cur[i] >= 0.005) sec[this.names[i]] = Math.round(this.cur[i] * 1000) / 1000;
    const prog = info && info.programs ? info.programs.length : 0;
    const geo = info ? info.memory.geometries : 0, tex = info ? info.memory.textures : 0;
    const mem = performance.memory;
    const heap = mem ? mem.usedJSHeapSize : 0;
    const f = {
      id: this.id, t: Math.round(this.frameStart), raw: Math.round(raw * 100) / 100,
      cpu: Math.round((end - this.frameStart) * 100) / 100, gpu: -1, sec,
      draws: info ? info.render.calls : 0, tris: info ? info.render.triangles : 0,
      programs: prog,
      dProg: this.prevProg < 0 ? 0 : prog - this.prevProg,
      dGeo: this.prevGeo < 0 ? 0 : geo - this.prevGeo,
      dTex: this.prevTex < 0 ? 0 : tex - this.prevTex,
      heap: Math.round(heap / 1024), dHeap: this.prevHeap < 0 ? 0 : Math.round((heap - this.prevHeap) / 1024),
      note: this.note,
    };
    this.prevProg = prog; this.prevGeo = geo; this.prevTex = tex; this.prevHeap = heap;
    this.note = "";
    const prevF = this.ring.length ? this.ring[(this.head - 1 + RING) % RING] : null;
    const old = this.ring[this.head];
    if (old) this.byId.delete(old.id);
    this.ring[this.head] = f;
    this.head = (this.head + 1) % RING;
    this.byId.set(f.id, f);
    this.id++;
    if (this.worst.length < WORST || raw > this.worst[this.worst.length - 1].raw) {
      f.prev = prevF;
      this.worst.push(f);
      this.worst.sort((a, b) => b.raw - a.raw);
      if (this.worst.length > WORST) this.worst.length = WORST;
    }
  }

  /** Re-read the program / geometry / texture / heap baselines, so work done
   * BETWEEN frames (the warm-up) is not charged to the next frame's deltas. */
  resync() {
    const info = this.renderer && this.renderer.info;
    if (info) {
      this.prevProg = info.programs ? info.programs.length : 0;
      this.prevGeo = info.memory.geometries;
      this.prevTex = info.memory.textures;
    }
    const mem = performance.memory;
    if (mem) this.prevHeap = mem.usedJSHeapSize;
  }

  reset() {
    this.ring.length = 0; this.head = 0; this.worst = []; this.byId.clear(); this.loaf.length = 0;
  }

  /** Everything recorded: per-section mean/max, GPU ms, percentiles, the worst
   * frames (each with the frame before it), a compact series, LoAFs, budget. */
  dump() {
    const n = this.ring.length;
    const ordered = [];
    for (let i = 0; i < n; i++) ordered.push(n < RING ? this.ring[i] : this.ring[(this.head + i) % RING]);
    const mean = {}, max = {};
    let gpuSum = 0, gpuN = 0;
    for (const f of ordered) {
      for (const k in f.sec) { mean[k] = (mean[k] || 0) + f.sec[k] / n; max[k] = Math.max(max[k] || 0, f.sec[k]); }
      if (f.gpu >= 0) { gpuSum += f.gpu; gpuN++; }
    }
    for (const k in mean) mean[k] = Math.round(mean[k] * 1000) / 1000;
    const rawP = pctl(ordered.map((f) => f.raw));
    const drawsP = pctl(ordered.map((f) => f.draws));
    const B = this.budget;
    return {
      enabled: true,
      gpuSupported: this.gpuSupported, frames: n,
      gpuMean: gpuN ? Math.round((gpuSum / gpuN) * 100) / 100 : -1,
      gpuP: pctl(ordered.filter((f) => f.gpu >= 0).map((f) => f.gpu)),
      rawP, cpuP: pctl(ordered.map((f) => f.cpu)),
      drawsP, trisP: pctl(ordered.map((f) => f.tris)),
      newPrograms: ordered.reduce((s, f) => s + Math.max(0, f.dProg), 0),
      mean, max,
      budget: B,
      // INFORMATION only: ms on a shared box are not a pass/fail.
      overBudget: B ? {
        drawFrames: ordered.filter((f) => f.draws > B.drawCallsMax).length,
        p99RawOver: rawP.p99 != null ? rawP.p99 > B.p99Ms : null,
      } : null,
      worst: this.worst.map((f) => Object.assign({}, f, { prev: f.prev ? Object.assign({}, f.prev, { prev: undefined }) : null })),
      series: ordered.map((f) => [f.raw, f.cpu, f.gpu, f.draws, f.tris, f.dProg, f.dHeap, f.sec.render || 0, f.note, f.id]),
      seriesCols: ["raw", "cpu", "gpu", "draws", "tris", "dProg", "dHeapKB", "renderMs", "note", "id"],
      loaf: this.loaf.slice(),
    };
  }
}

function pctl(a) {
  if (!a.length) return {};
  const s = a.slice().sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length - 1] };
}
