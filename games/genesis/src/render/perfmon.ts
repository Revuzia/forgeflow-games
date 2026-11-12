// GENESIS — the frame monitor and its hidden overlay (macfix 2026-11, "smooth without lowering the quality").
//
// Main-thread milliseconds per subsystem, per frame, with no allocation in the frame: a fixed set of named slots
// (begin/end pairs add into the current frame's slot), a ring of the last FRAMES frame intervals and frame costs, and
// what happens outside frames (the sim's snapshots applied in the worker's message handler). The overlay (Shift+F12, or ?perf=1)
// shows fps, a frame-time graph (interval in grey, the main thread's own share in colour) and the subsystems' mean ms;
// it repaints four times a second, never in step with the frame it measures, and costs nothing while closed.
// The automation surface reads the same numbers (window.__GENESIS__.perf()).

import { PerfRecorder, type PerfContext, type PerfEnv } from './perfreport.ts';
import { perfNum, perfSwitch } from './perfswitch.ts';
import { gpuMem } from './gpumem.ts';

// PERF s12 bisection (GPU-HUNT-PLAN §2): `?recms=10000` the report's recording length (default 20 s, whatever asks);
// `?passsync=1` gl.finish() at every slot begin / end and pass mark while recording: per-pass ms that are exact on a
// driver whose timer spans overlap (ANGLE-Metal), at the price of a lower fps
const REC_MS = perfNum('recms');
const PASS_SYNC = perfSwitch('passsync', false);

export const PERF_SLOTS = [
  'view', 'ui.pre', 'camera', 'hover', 'planets', 'godfx', 'actors', 'uploads', 'shadows', 'scene', 'post', 'sim.pump', 'audio', 'ui.post', 'other',
] as const;
export type PerfSlot = (typeof PERF_SLOTS)[number];

const FRAMES = 240;
const NS = PERF_SLOTS.length;
const SLOT_INDEX: Record<string, number> = Object.fromEntries(PERF_SLOTS.map((s, i) => [s, i]));

export interface PerfSummary {
  frames: number;
  fps: number;
  /** frame interval (ms): mean, 50th, 95th, 99th percentile and the worst of the window */
  interval: { mean: number; p50: number; p95: number; p99: number; max: number };
  /** the main thread's own work inside the frame (ms) */
  work: { mean: number; p95: number; max: number };
  /** intervals over 25 ms (a missed 60 Hz vsync and more) and over 50 ms (a visible hitch) */
  spikes25: number;
  spikes50: number;
  /** mean ms per subsystem over the window */
  slots: Record<string, number>;
  /** sim snapshots applied per second over the last 4 s, and the main-thread ms they took (mean, worst) */
  msgs: number;
  applyMs: number;
  applyMax: number;
  /** GPU programs linked so far, and new ones since the monitor was switched on (each a possible hitch) */
  programs: number;
  newPrograms: number;
  /** programs the load-time warm-up linked (Renderer.warmUp) */
  warmed: number;
}

export class PerfMonitor {
  /** off: begin/end are a single branch */
  on = false;
  private readonly cur = new Float64Array(NS);
  private readonly open = new Float64Array(NS);
  private readonly ring = new Float64Array(FRAMES * NS);
  private readonly intervals = new Float64Array(FRAMES);
  private readonly works = new Float64Array(FRAMES);
  private readonly stamps = new Float64Array(FRAMES);
  private head = 0;
  private count = 0;
  private frameT0 = 0;
  private lastFrame = 0;
  private msgCount = 0;
  private applyAcc = 0;
  private readonly msgLog: number[] = [];
  private overlay: PerfOverlay | null = null;
  /** the renderer's linked programs (render/renderer.ts writes it each frame) */
  programs = 0;
  /** programs the load-time warm-up linked (app.ts writes it) */
  warmed = 0;
  private programsAtOn = -1;
  /** the 20 s performance report (perfreport.ts) */
  readonly recorder = new PerfRecorder(PERF_SLOTS);
  /** what the app reports per frame to the recorder, and the report header's facts (app.ts sets them) */
  context: (() => PerfContext) | null = null;
  env: (() => PerfEnv) | null = null;
  /** the GL context to time (app.ts) */
  private gl_: WebGL2RenderingContext | null = null;
  /** the GL context to time (app.ts); setting it also starts the live GPU memory audit (gpumem.ts) */
  get gl(): WebGL2RenderingContext | null { return this.gl_; }
  set gl(g: WebGL2RenderingContext | null) { this.gl_ = g; if (g) { try { gpuMem.install(g); } catch { /* unaudited */ } } }
  /** the three.js renderer (app.ts): its render-target binds are traced while recording (target sizes / formats) */
  three: unknown = null;

  private syncName: string | null = null;
  private syncT = 0;
  /** (passsync) finish the GPU's work so far, charge it to the pass that was running, start `name` (null: none) */
  private sync(name: string | null): void {
    if (!PASS_SYNC || !this.gl || !this.recorder.recording) return;
    this.gl.finish();
    const t = performance.now();
    if (this.syncName) this.recorder.syncAdd(this.syncName, t - this.syncT);
    this.syncName = name;
    this.syncT = t;
  }

  begin(slot: PerfSlot): void {
    if (!this.on) return;
    this.sync(slot);
    this.open[SLOT_INDEX[slot]] = performance.now();
    if (this.recorder.recording) this.recorder.gpuBegin(slot);
  }

  end(slot: PerfSlot): void {
    if (!this.on) return;
    this.sync(null);
    if (this.recorder.recording) this.recorder.gpuEnd(slot);
    const i = SLOT_INDEX[slot];
    this.cur[i] += performance.now() - this.open[i];
  }

  /** (bisection) a named GPU pass starts here inside the 'scene' / 'post' slot: timed separately while recording */
  mark(name: string): void {
    if (!this.on || !this.recorder.recording) return;
    this.sync(name);
    this.recorder.gpuMark(name);
  }

  /** record `ms` of frames; `onDone` gets the report text */
  record(ms = 20000, onDone?: (text: string) => void): void {
    if (REC_MS != null && REC_MS > 0) ms = REC_MS;
    this.on = true;
    this.recorder.attach(this.gl);
    this.recorder.attachRenderer(this.three);
    try { this.recorder.env = this.env ? this.env() : null; } catch { this.recorder.env = null; }
    this.recorder.start(ms, onDone);
  }

  frameStart(now: number): void {
    if (!this.on) { this.programsAtOn = -1; return; }
    if (this.programsAtOn < 0) this.programsAtOn = this.programs;
    this.frameT0 = performance.now();
    this.cur.fill(0);
    this.recorder.frameBegin();
    if (this.lastFrame > 0) this.intervals[this.head] = now - this.lastFrame;
    else this.intervals[this.head] = 1000 / 60;
    this.lastFrame = now;
  }

  frameEnd(): void {
    if (!this.on) return;
    const work = performance.now() - this.frameT0;
    let sum = 0;
    for (let i = 0; i < NS - 1; i++) sum += this.cur[i];
    this.cur[NS - 1] = Math.max(0, work - sum);
    this.ring.set(this.cur, this.head * NS);
    this.works[this.head] = work;
    if (this.recorder.recording) {
      let ctx: PerfContext | null = null;
      try { ctx = this.context ? this.context() : null; } catch { ctx = null; }
      this.recorder.frameDone(this.intervals[this.head], work, this.cur, ctx);
    }
    this.stamps[this.head] = this.frameT0;
    this.head = (this.head + 1) % FRAMES;
    if (this.count < FRAMES) this.count++;
    this.overlay?.tick(this);
  }

  /** a frame that was not drawn (a hidden tab): the next interval starts afresh */
  skip(): void { this.lastFrame = 0; }

  /** a sim snapshot was applied (outside the frame, in the worker's message handler) and took `ms` */
  message(ms: number): void {
    if (!this.on) return;
    this.msgCount++;
    this.applyAcc += ms;
    const t = performance.now();
    this.msgLog.push(t, ms);
    while (this.msgLog.length > 2 && this.msgLog[0] < t - 4000) this.msgLog.splice(0, 2);
  }

  summary(): PerfSummary {
    const n = this.count;
    const iv: number[] = [];
    const wk: number[] = [];
    const slots: Record<string, number> = {};
    for (const s of PERF_SLOTS) slots[s] = 0;
    for (let k = 0; k < n; k++) {
      const f = (this.head - 1 - k + FRAMES) % FRAMES;
      iv.push(this.intervals[f]);
      wk.push(this.works[f]);
      for (let i = 0; i < NS; i++) slots[PERF_SLOTS[i]] += this.ring[f * NS + i] / Math.max(1, n);
    }
    const sorted = iv.slice().sort((a, b) => a - b);
    const ws = wk.slice().sort((a, b) => a - b);
    const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const t = performance.now();
    let mc = 0, mb = 0, mx = 0;
    for (let i = 0; i < this.msgLog.length; i += 2) if (this.msgLog[i] >= t - 4000) { mc++; mb += this.msgLog[i + 1]; mx = Math.max(mx, this.msgLog[i + 1]); }
    const r2 = (x: number) => Math.round(x * 100) / 100;
    for (const s of PERF_SLOTS) slots[s] = r2(slots[s]);
    const im = mean(iv);
    return {
      frames: n, fps: im > 0 ? r2(1000 / im) : 0,
      interval: { mean: r2(im), p50: r2(pct(sorted, 0.5)), p95: r2(pct(sorted, 0.95)), p99: r2(pct(sorted, 0.99)), max: r2(sorted[sorted.length - 1] ?? 0) },
      work: { mean: r2(mean(wk)), p95: r2(pct(ws, 0.95)), max: r2(ws[ws.length - 1] ?? 0) },
      spikes25: iv.filter((x) => x > 25).length, spikes50: iv.filter((x) => x > 50).length,
      slots, msgs: r2(mc / 4), applyMs: r2(mc ? mb / mc : 0), applyMax: r2(mx),
      programs: this.programs, newPrograms: this.programsAtOn >= 0 ? this.programs - this.programsAtOn : 0,
      warmed: this.warmed,
    };
  }

  /** the last frames, oldest first: [interval, work] pairs (the overlay's graph) */
  history(out: Float64Array): number {
    const n = this.count;
    for (let k = 0; k < n; k++) {
      const f = (this.head - n + k + FRAMES) % FRAMES;
      out[k * 2] = this.intervals[f];
      out[k * 2 + 1] = this.works[f];
    }
    return n;
  }

  get overlayOpen(): boolean { return !!this.overlay; }

  /** show or hide the overlay (it switches the monitor on with it; ?perf=1 or a probe may keep it on without one) */
  toggleOverlay(host: HTMLElement, show = !this.overlay): void {
    if (show && !this.overlay) { this.on = true; this.overlay = new PerfOverlay(host, this); }
    else if (!show && this.overlay) { this.overlay.dispose(); this.overlay = null; }
  }

  /** lifetime counters for probes */
  totals(): { msgs: number; applyMs: number } { return { msgs: this.msgCount, applyMs: this.applyAcc }; }
}

/** the one monitor of the page */
export const perfmon = new PerfMonitor();

class PerfOverlay {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly graph: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly hist = new Float64Array(FRAMES * 2);
  private nextPaint = 0;

  private readonly status: HTMLDivElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly recBtn: HTMLButtonElement;
  private box: HTMLTextAreaElement | null = null;

  constructor(host: HTMLElement, m: PerfMonitor) {
    const root = document.createElement('div');
    root.className = 'gn-perf';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483000;pointer-events:none;background:rgba(8,10,14,.78);'
      + 'color:#d8e2ea;font:11px/1.25 ui-monospace,Menlo,Consolas,monospace;padding:6px 7px;border-radius:4px;contain:strict;'
      + 'width:236px;height:430px;';
    const graph = document.createElement('canvas');
    graph.width = 236 * 2; graph.height = 60 * 2;
    graph.style.cssText = 'display:block;width:236px;height:60px;margin-bottom:4px;';
    const text = document.createElement('pre');
    text.style.cssText = 'margin:0;white-space:pre;';
    // the performance report (perfreport.ts): record 20 s, then copy the text to paste to the developers
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:4px;margin:0 0 4px;pointer-events:auto;';
    const btn = (label: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'flex:1;font:11px ui-monospace,Menlo,monospace;color:#d8e2ea;background:#26303a;border:1px solid #4a5866;'
        + 'border-radius:3px;padding:3px 4px;cursor:pointer;';
      return b;
    };
    const recBtn = btn('Record 20 s');
    const copyBtn = btn('Copy report');
    copyBtn.disabled = true;
    copyBtn.style.opacity = '0.5';
    const status = document.createElement('div');
    status.style.cssText = 'margin:0 0 4px;color:#9fb0bf;min-height:13px;';
    bar.append(recBtn, copyBtn);
    // (a press on the bar is not a press on the world under it)
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel', 'dblclick']) bar.addEventListener(ev, (e) => e.stopPropagation());
    recBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (m.recorder.recording) return;
      this.box?.remove(); this.box = null;
      recBtn.disabled = true;
      copyBtn.disabled = true; copyBtn.style.opacity = '0.5';
      status.textContent = 'recording 20 s - play as usual';
      m.record(20000, () => {
        recBtn.disabled = false;
        copyBtn.disabled = false; copyBtn.style.opacity = '1';
        status.textContent = 'done - press Copy report';
      });
    });
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = m.recorder.report;
      if (!text) return;
      const fallback = () => {
        // (the clipboard is blocked in some frames: show the text selected, for Cmd/Ctrl+C)
        if (!this.box) {
          const ta = document.createElement('textarea');
          ta.readOnly = true;
          ta.style.cssText = 'position:fixed;left:250px;top:6px;width:min(640px,70vw);height:300px;z-index:2147483001;'
            + 'font:11px ui-monospace,Menlo,monospace;background:#0b0e12;color:#d8e2ea;border:1px solid #4a5866;';
          ta.addEventListener('keydown', (k) => { if (k.key === 'Escape') { ta.remove(); this.box = null; } k.stopPropagation(); });
          host.appendChild(ta);
          this.box = ta;
        }
        this.box.value = text;
        this.box.focus();
        this.box.select();
        status.textContent = 'press Cmd/Ctrl+C to copy (Esc closes)';
      };
      try {
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => { status.textContent = 'report copied - paste it to us'; }, fallback);
        else fallback();
      } catch { fallback(); }
    });
    this.status = status; this.copyBtn = copyBtn; this.recBtn = recBtn;
    root.append(bar, status, graph, text);
    host.appendChild(root);
    this.root = root; this.text = text; this.graph = graph;
    this.g = graph.getContext('2d');
  }

  tick(m: PerfMonitor): void {
    const t = performance.now();
    if (t < this.nextPaint) return;
    this.nextPaint = t + 250;
    const s = m.summary();
    const lines = [
      `${s.fps.toFixed(1).padStart(5)} fps   frame ${s.interval.mean.toFixed(1)} ms`,
      `p95 ${s.interval.p95.toFixed(1)}  p99 ${s.interval.p99.toFixed(1)}  max ${s.interval.max.toFixed(0)}`,
      `>25ms ${s.spikes25}  >50ms ${s.spikes50}  (last ${s.frames})`,
      `main ${s.work.mean.toFixed(2)} ms  p95 ${s.work.p95.toFixed(1)}`,
      `programs ${s.programs} (+${s.newPrograms}, warmed ${s.warmed})`,
      `snaps ${s.msgs.toFixed(1)}/s  apply ${s.applyMs.toFixed(2)} ms (max ${s.applyMax.toFixed(1)})`,
    ];
    for (const k of PERF_SLOTS) lines.push(`${k.padEnd(9)}${s.slots[k].toFixed(2).padStart(7)}`);
    this.text.textContent = lines.join('\n');
    const g = this.g;
    if (!g) return;
    const n = m.history(this.hist);
    const W = this.graph.width, H = this.graph.height, cap = 50;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.fillRect(0, H - (16.7 / cap) * H, W, 1);
    g.fillRect(0, H - (33.3 / cap) * H, W, 1);
    const bw = W / FRAMES;
    for (let k = 0; k < n; k++) {
      const x = (FRAMES - n + k) * bw;
      const iv = this.hist[k * 2], wk = this.hist[k * 2 + 1];
      const hi = Math.min(H, (iv / cap) * H);
      g.fillStyle = iv > 25 ? '#e0604a' : '#56606a';
      g.fillRect(x, H - hi, Math.max(1, bw - 0.5), hi);
      const hw = Math.min(H, (wk / cap) * H);
      g.fillStyle = '#7fd0a0';
      g.fillRect(x, H - hw, Math.max(1, bw - 0.5), hw);
    }
  }

  dispose(): void { this.root.remove(); this.box?.remove(); }
}
