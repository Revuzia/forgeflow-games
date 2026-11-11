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

export class PerfRecorder {
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
    L.push(`GENESIS perf report v1 · ${new Date().toISOString().slice(0, 19)}Z · ${f1(dur)} s · ${F.length} frames`);
    if (env) L.push(`gpu: ${env.gpu} | preset ${env.preset} | canvas ${env.canvas} | dpr ${env.dpr}${env.extra ? ' | ' + env.extra : ''}`);
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
      L.push(`gpu ms (mean/p95): ${g.map(([n, m, p]) => `${n} ${f1(m)}/${f1(p)}`).join(' ')} | total ${f1(mean(tot))}/${f1(pct(tot, 0.95))}${this.disjoint ? ` (disjoint ${this.disjoint})` : ''}`);
    } else L.push(`gpu ms: ${this.ext || this.disjoint ? 'no results' : 'no timer query in this browser'}`);
    L.push(`render: draws ${Math.round(mean(F.map((r) => r.draws)))} (max ${Math.max(...F.map((r) => r.draws))}) tris ${f1(mean(F.map((r) => r.tris)) / 1e6)}M shadow ${f1(mean(F.map((r) => r.shadowTris)) / 1e6)}M | patches built ${F.reduce((a, r) => a + r.built, 0)} | new programs ${F.reduce((a, r) => a + r.programs, 0)}`);
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
