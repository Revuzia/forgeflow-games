// GENESIS — the BOOT TRACE and the non-blocking shader preparation (LOADTIME ledger: _harness/arc-work/LOADTIME.md).
//
// 1. bootTrace: an always-on, cheap recorder of the start-up. It notes named marks (ms since navigation), every GPU
//    program's link — who asked (three's material name / type), the vertex + fragment source sizes, the time from
//    linkProgram to completion (polled through KHR_parallel_shader_compile's COMPLETION_STATUS_KHR, which never
//    waits) — and every SYNCHRONOUS query (getProgramParameter, getProgramInfoLog, getShaderInfoLog,
//    getUniformLocation, getActiveUniform…, useProgram) made on a program that had not finished: such a call makes the
//    browser wait for the compile on the main thread (Chrome on Windows: the D3D compiler, seconds per large
//    shader). The perf report prints it (`boot:` lines); `?boottrace=1` lists it on screen.
// 2. dryFrames / prepare: the boot's "everything the first frames will draw" compile, with no waiting. For a few
//    frames three's render() is replaced by compile() — it requests each material's program and returns — then the
//    boot waits for COMPLETION_STATUS on all of them, the page alive and the boot card counting "n of m".
//    `?bootc=0` restores the old path (three warm-up frames that link each program at its first draw, one at a time).

import type { Camera, Object3D, WebGLRenderer } from 'three';
import { perfSwitch } from './perfswitch.ts';

/** the non-blocking boot compile (`?bootc=0`: the old path) */
export const BOOT_COMPILE = perfSwitch('bootc');

const COMPLETION_STATUS_KHR = 0x91b1;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

export interface BootProgram {
  n: number;
  name: string;
  vs: number;
  fs: number;
  /** FNV-1a of the fragment source (duplicate sources linked as different programs) */
  fsHash: number;
  /** ms since navigation: linkProgram, and when it was seen complete (-1 = not yet) */
  tReq: number;
  tDone: number;
  /** before or after the first playable frame */
  phase: 'boot' | 'play';
  /** ms the main thread waited in synchronous queries made before the program had finished, and the first such call */
  blockedMs: number;
  blockedBy: string;
  /** set while the dry frames run: asked for without being drawn */
  dry: boolean;
}

interface Rec extends BootProgram { prog: WebGLProgram; }

class BootTrace {
  readonly marks: { name: string; t: number }[] = [];
  readonly programs: Rec[] = [];
  private byProg = new WeakMap<WebGLProgram, Rec>();
  private srcLen = new WeakMap<WebGLShader, { len: number; hash: number }>();
  private shaderOf = new WeakMap<WebGLShader, Rec>();
  private attached = new WeakMap<WebGLProgram, WebGLShader[]>();
  private pending = new Set<Rec>();
  private gl: WebGL2RenderingContext | null = null;
  private getParam: ((p: WebGLProgram, n: number) => unknown) | null = null;
  private parallel = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private three: WebGLRenderer | null = null;
  phase: 'boot' | 'play' = 'boot';
  dry = false;
  /** main-thread tasks over 50 ms seen before the first playable frame (the page did not answer meanwhile) */
  readonly longTasks: { t: number; d: number }[] = [];
  private ltObs: PerformanceObserver | null = null;

  constructor() {
    this.mark('script');
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        this.ltObs = new PerformanceObserver((list) => { for (const e of list.getEntries()) if (this.longTasks.length < 400) this.longTasks.push({ t: e.startTime, d: e.duration }); });
        this.ltObs.observe({ type: 'longtask', buffered: true });
      }
    } catch { /* no long-task timing here */ }
  }

  mark(name: string): void { this.marks.push({ name, t: now() }); }
  private markOnce(name: string): void { if (!this.marks.some((m) => m.name === name)) this.mark(name); }
  firstFrame(): void { this.markOnce('first frame'); }
  /** the boot card goes: programs asked for from here on are mid-game links */
  playable(): void {
    this.markOnce('playable');
    this.phase = 'play';
    // (long tasks are the perf report's business from here on)
    setTimeout(() => { try { this.ltObs?.disconnect(); } catch { /* gone */ } this.ltObs = null; }, 1000);
  }
  setThree(r: WebGLRenderer): void { this.three = r; }
  get parallelCompile(): boolean { return this.parallel; }

  /** wrap the context's shader calls (once, before three links anything) */
  install(gl: WebGL2RenderingContext): void {
    if (this.gl) return;
    this.gl = gl;
    try { this.parallel = !!gl.getExtension('KHR_parallel_shader_compile'); } catch { this.parallel = false; }
    const g = gl as unknown as Record<string, (...a: never[]) => unknown>;
    const orig = <K extends string>(k: K) => (g[k] as (...a: unknown[]) => unknown).bind(gl);
    const shaderSource = orig('shaderSource'), attachShader = orig('attachShader'), linkProgram = orig('linkProgram');
    const getProgramParameter = orig('getProgramParameter');
    this.getParam = getProgramParameter as (p: WebGLProgram, n: number) => unknown;
    const self = this;
    const createShader = orig('createShader');
    g.createShader = function (t: number) { const sh = createShader(t) as WebGLShader | null; if (sh) self.shaderTypes.set(sh, t); return sh; } as never;
    g.shaderSource = function (sh: WebGLShader, src: string) {
      self.srcLen.set(sh, { len: src.length, hash: fnv(src) });
      return shaderSource(sh, src);
    } as never;
    g.attachShader = function (p: WebGLProgram, sh: WebGLShader) {
      const l = self.attached.get(p); if (l) l.push(sh); else self.attached.set(p, [sh]);
      return attachShader(p, sh);
    } as never;
    g.linkProgram = function (p: WebGLProgram) {
      const r = linkProgram(p);
      try { self.onLink(p); } catch { /* untraced */ }
      return r;
    } as never;
    // the synchronous queries: on an unfinished program each one waits for the compile
    const sync = (k: string, ofShader: boolean) => {
      const f = orig(k);
      g[k] = function (...a: unknown[]) {
        const rec = ofShader ? self.shaderOf.get(a[0] as WebGLShader) : self.byProg.get(a[0] as WebGLProgram);
        if (!rec || rec.tDone >= 0) return f(...a);
        if (k === 'getProgramParameter' && a[1] === COMPLETION_STATUS_KHR) return f(...a);
        // (asked without waiting first: finished meanwhile = no wait)
        if (self.parallel && getProgramParameter(rec.prog, COMPLETION_STATUS_KHR)) { self.done(rec, now()); return f(...a); }
        const t0 = now();
        const out = f(...a);
        const t1 = now();
        rec.blockedMs += t1 - t0;
        if (!rec.blockedBy) rec.blockedBy = k;
        self.done(rec, t1);
        return out;
      } as never;
    };
    for (const k of ['getProgramParameter', 'getProgramInfoLog', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'getAttribLocation', 'getUniformBlockIndex', 'getActiveUniforms', 'getUniformIndices', 'useProgram', 'validateProgram']) sync(k, false);
    for (const k of ['getShaderParameter', 'getShaderInfoLog']) sync(k, true);
  }

  private onLink(p: WebGLProgram): void {
    let vs = 0, fs = 0, fsHash = 0;
    const shs = this.attached.get(p) ?? [];
    const gl = this.gl!;
    const rec: Rec = { prog: p, n: this.programs.length + 1, name: '', vs: 0, fs: 0, fsHash: 0, tReq: now(), tDone: -1, phase: this.phase, blockedMs: 0, blockedBy: '', dry: this.dry };
    for (const sh of shs) {
      const s = this.srcLen.get(sh);
      if (!s) continue;
      if (this.shaderTypes.get(sh) === gl.VERTEX_SHADER) vs = s.len; else { fs = s.len; fsHash = s.hash; }
      this.shaderOf.set(sh, rec);
    }
    rec.vs = vs; rec.fs = fs; rec.fsHash = fsHash;
    this.byProg.set(p, rec);
    this.programs.push(rec);
    this.pending.add(rec);
    this.poll();
  }
  private shaderTypes = new WeakMap<WebGLShader, number>();

  private done(rec: Rec, t: number): void {
    if (rec.tDone >= 0) return;
    rec.tDone = t;
    this.pending.delete(rec);
  }

  /** look at the unfinished programs without waiting; re-arms itself while any is left */
  private poll = (): void => {
    if (this.timer != null || !this.pending.size) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.check();
      this.poll();
    }, 8);
  };
  /** one look at every unfinished program (no waiting); the number still compiling */
  check(): number {
    if (!this.parallel || !this.getParam) return this.pending.size;
    const t = now();
    for (const rec of [...this.pending]) {
      let ok = false;
      try { ok = !!this.getParam(rec.prog, COMPLETION_STATUS_KHR); } catch { ok = true; }
      if (ok) this.done(rec, t);
    }
    return this.pending.size;
  }
  get pendingCount(): number { return this.pending.size; }

  /** names from three's program list (material name, else its type) */
  private nameAll(): void {
    const list = (this.three?.info.programs ?? []) as unknown as { program: WebGLProgram; name?: string; type?: string; usedTimes?: number }[];
    for (const p of list) {
      const rec = this.byProg.get(p.program);
      if (rec && !rec.name) rec.name = `${p.name || ''}${p.name && p.type ? ':' : ''}${p.type || ''}` || '?';
    }
  }

  snapshot(): { marks: { name: string; t: number }[]; programs: BootProgram[]; parallel: boolean; longTasks: { t: number; d: number }[] } {
    this.check();
    this.nameAll();
    return {
      marks: this.marks.map((m) => ({ ...m })), parallel: this.parallel, longTasks: this.longTasks.map((x) => ({ ...x })),
      programs: this.programs.map((r) => ({ n: r.n, name: r.name || '(raw gl)', vs: r.vs, fs: r.fs, fsHash: r.fsHash, tReq: r.tReq, tDone: r.tDone, phase: r.phase, blockedMs: r.blockedMs, blockedBy: r.blockedBy, dry: r.dry })),
    };
  }

  /** the perf report's lines; `all` = one line per program (else the 12 largest fragment shaders and every mid-game link) */
  lines(all = false): string[] {
    const S = this.snapshot();
    const L: string[] = [];
    const r0 = (x: number) => String(Math.round(x));
    const P = S.programs;
    const bootP = P.filter((p) => p.phase === 'boot'), playP = P.filter((p) => p.phase === 'play');
    const playable = S.marks.find((m) => m.name === 'playable')?.t ?? -1;
    L.push(`boot: ${S.marks.map((m) => `${m.name} ${r0(m.t)}`).join(' > ')} ms | parallel compile ${S.parallel ? 'yes' : 'NO (every link waits)'} | bootc=${BOOT_COMPILE ? 1 : 0}`);
    const lt = playable >= 0 ? S.longTasks.filter((x) => x.t < playable) : S.longTasks;
    L.push(`boot main thread: long tasks ${lt.length}${lt.length ? ` total ${r0(lt.reduce((a, x) => a + x.d, 0))} ms, worst ${lt.slice().sort((a, b) => b.d - a.d).slice(0, 5).map((x) => `${r0(x.d)}@${r0(x.t)}`).join(' ')}` : ''}`);
    const sum = (a: BootProgram[], f: (p: BootProgram) => number) => a.reduce((s, p) => s + f(p), 0);
    const blocked = (a: BootProgram[]) => a.filter((p) => p.blockedBy);
    const linkMs = (p: BootProgram) => (p.tDone >= 0 ? p.tDone - p.tReq : -1);
    const desc = (a: BootProgram[]) => `${a.length} (fragment ${r0(sum(a, (p) => p.fs) / 1000)}k chars, vertex ${r0(sum(a, (p) => p.vs) / 1000)}k) | waited-on synchronously ${blocked(a).length} for ${r0(sum(a, (p) => p.blockedMs))} ms`;
    L.push(`boot programs before playable: ${desc(bootP)} | asked without drawing ${bootP.filter((p) => p.dry).length} | unfinished at playable ${playable >= 0 ? bootP.filter((p) => p.tDone < 0 || p.tDone > playable).length : '?'}`);
    L.push(`boot programs after playable (each a possible hitch): ${desc(playP)}`);
    {
      // identical fragment sources linked more than once (variants that differ only in the vertex stage or not at all)
      const by = new Map<number, BootProgram[]>();
      for (const p of P) if (p.fs) { const l = by.get(p.fsHash); if (l) l.push(p); else by.set(p.fsHash, [p]); }
      const dup = [...by.values()].filter((l) => l.length > 1);
      if (dup.length) L.push(`boot same fragment source in several programs: ${dup.length} sources, ${sum(dup.map((l) => ({ fs: l[0].fs * (l.length - 1) }) as BootProgram), (p) => p.fs) / 1000 | 0}k chars compiled again: ${dup.sort((a, b) => b[0].fs * b.length - a[0].fs * a.length).slice(0, 8).map((l) => `${l[0].name} x${l.length} (${r0(l[0].fs / 1000)}k)`).join(', ')}`);
    }
    const row = (p: BootProgram) => `  #${p.n} ${p.name} | vs ${p.vs} fs ${p.fs} | asked ${r0(p.tReq)} ${p.tDone >= 0 ? `done +${r0(linkMs(p))}` : 'NOT DONE'}${p.blockedBy ? ` | WAITED ${r0(p.blockedMs)} ms in ${p.blockedBy}` : ''}${p.dry ? ' | dry' : ''} | ${p.phase}`;
    const show = all ? P : [...new Set([...P.slice().sort((a, b) => b.fs - a.fs).slice(0, 12), ...P.slice().sort((a, b) => linkMs(b) - linkMs(a)).slice(0, 6), ...playP])].sort((a, b) => a.n - b.n);
    L.push(all ? 'boot program list (ms since navigation; "done +" = link request to completion):' : 'boot program list (the 12 largest fragment sources, the 6 slowest links, every link after playable):');
    for (const p of show) L.push(row(p));
    return L;
  }
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export const bootTrace = new BootTrace();
(globalThis as { __GN_BOOTTRACE__?: unknown }).__GN_BOOTTRACE__ = bootTrace;

/**
 * Run `frame` (a whole renderer frame) `n` times with three's render() replaced by compile(): every material the frame
 * would draw gets its program REQUESTED (compileShader + linkProgram return at once; the driver compiles on its own
 * threads) and nothing waits for one. Render targets, uniforms and the scene graph are set up as usual; nothing is drawn.
 * compile() walks hidden objects too and reads the lights and the current render target as render() does, so the
 * programs asked for are the ones the real frames use (plus the hidden effects', which the warm-up wants anyway).
 * The scene is walked once per (scene, camera layers, render target, material set) and frame, not once per pass draw.
 */
export function dryFrames(r: WebGLRenderer, n: number, frame: (i: number) => void): void {
  const real = r.render;
  const readPixels = r.readRenderTargetPixels;
  bootTrace.dry = true;
  r.render = function (scene: Object3D, camera: Camera): void {
    try { r.compile(scene, camera); } catch (e) { console.warn('[genesis] boot compile: a pass could not be prepared', e); }
  } as typeof r.render;
  // (nothing was drawn: a read-back would only wait for the GPU and return an empty target)
  r.readRenderTargetPixels = function (): void { /* nothing drawn */ } as unknown as typeof r.readRenderTargetPixels;
  try {
    for (let i = 0; i < n; i++) frame(i);
  } finally {
    r.render = real;
    r.readRenderTargetPixels = readPixels;
    bootTrace.dry = false;
  }
}

/**
 * Wait, without blocking, until every program asked for so far has finished compiling; `tick(done, total)` after each
 * look (the boot card's count). With no KHR_parallel_shader_compile there is nothing to poll: returns at once (the
 * first draw waits, as before). Gives up after `maxMs` (the first frames then wait for the rest).
 */
export async function programsReady(tick: (done: number, total: number) => void, maxMs = 180000): Promise<{ total: number; left: number; ms: number }> {
  const t0 = now();
  const total = () => bootTrace.programs.length;
  if (!bootTrace.parallelCompile) return { total: total(), left: 0, ms: 0 };
  for (;;) {
    const left = bootTrace.check();
    tick(total() - left, total());
    if (!left || now() - t0 > maxMs) return { total: total(), left, ms: now() - t0 };
    await new Promise((ok) => setTimeout(ok, 30));
  }
}

/** `?boottrace=1`: the list on screen (a plain scrolling box over the game; click the cross to close) */
export function showBootTrace(): void {
  if (typeof document === 'undefined') return;
  let box = document.getElementById('gn-boottrace');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gn-boottrace';
    box.style.cssText = 'position:fixed;left:8px;top:8px;right:8px;max-height:70vh;overflow:auto;z-index:99999;background:rgba(8,10,14,.92);color:#cfe3d4;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;padding:10px 28px 10px 10px;border:1px solid #3a4a44;border-radius:6px;white-space:pre;user-select:text';
    document.body.appendChild(box);
  }
  const fill = () => {
    box!.textContent = bootTrace.lines(true).join('\n');
    const x = document.createElement('button');
    x.textContent = '×';
    x.setAttribute('aria-label', 'Close the boot list');
    x.style.cssText = 'position:absolute;right:6px;top:4px;background:none;border:0;color:#cfe3d4;font-size:16px;cursor:pointer';
    x.onclick = () => { clearInterval(iv); box!.remove(); };
    box!.appendChild(x);
  };
  fill();
  // (mid-game links join the list)
  const iv = setInterval(() => { if (!document.hidden) fill(); }, 2000);
}
