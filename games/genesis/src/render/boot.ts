// GENESIS — the BOOT TRACE and the non-blocking shader preparation (LOADTIME ledger: _harness/arc-work/LOADTIME.md).
//
// 1. bootTrace: an always-on, cheap recorder of the start-up. It notes named marks (ms since navigation), every GPU
//    program's link — who asked (three's material name / type), the vertex + fragment source sizes, the time from
//    linkProgram to completion (polled through KHR_parallel_shader_compile's COMPLETION_STATUS_KHR, which never
//    waits) — and every SYNCHRONOUS query (getProgramParameter, getProgramInfoLog, getShaderInfoLog,
//    getUniformLocation, getActiveUniform…, useProgram) made on a program that had not finished: such a call makes the
//    browser wait for the compile on the main thread (Chrome on Windows: the D3D compiler, seconds per large
//    shader). The perf report prints it (`boot:` lines); `?boottrace=1` lists it on screen.
// 2. The boot's compile with no waiting (app.ts bootCompile): the full-screen passes' programs are asked for while
//    the world is still being made (requestPasses); then whole frames run with every draw of the main scene guarded
//    (guardedFrame: ask for its programs, draw only when they have finished), the boot waiting in between for
//    COMPLETION_STATUS with the page alive and the boot card counting "n of m" (programsReady).
//    `?bootc=0` restores the old path (three warm-up frames that link each program at its first draw, one at a time).

import type { Camera, Material, Object3D, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { perfSwitch } from './perfswitch.ts';
import { FullscreenQuad, PASS_MATERIALS } from './post/fsquad.ts';

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
  /** what the fragment shader is, from its own text (the last functions it defines, else its longest uniforms) */
  label: string;
}

interface Rec extends BootProgram { prog: WebGLProgram; owner?: string; }

class BootTrace {
  readonly marks: { name: string; t: number }[] = [];
  readonly programs: Rec[] = [];
  private byProg = new WeakMap<WebGLProgram, Rec>();
  private srcLen = new WeakMap<WebGLShader, { len: number; hash: number; label: string }>();
  private shaderOf = new WeakMap<WebGLShader, Rec>();
  private attached = new WeakMap<WebGLProgram, WebGLShader[]>();
  private pending = new Set<Rec>();
  private gl: WebGL2RenderingContext | null = null;
  private getParam: ((p: WebGLProgram, n: number) => unknown) | null = null;
  private parallel = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private three: WebGLRenderer | null = null;
  phase: 'boot' | 'play' = 'boot';
  /** ms spent inside compileShader + linkProgram themselves (they should return at once where compiles are parallel) */
  callMs = 0;
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
  setThree(r: WebGLRenderer, scene?: Object3D): void { this.three = r; this.scene = scene ?? null; }
  private scene: Object3D | null = null;
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
      self.srcLen.set(sh, { len: src.length, hash: fnv(src), label: labelOf(src) });
      return shaderSource(sh, src);
    } as never;
    g.attachShader = function (p: WebGLProgram, sh: WebGLShader) {
      const l = self.attached.get(p); if (l) l.push(sh); else self.attached.set(p, [sh]);
      return attachShader(p, sh);
    } as never;
    const compileShader = orig('compileShader');
    g.compileShader = function (sh: WebGLShader) { const t0 = now(); const r = compileShader(sh); self.callMs += now() - t0; return r; } as never;
    g.linkProgram = function (p: WebGLProgram) {
      const t0 = now();
      const r = linkProgram(p);
      self.callMs += now() - t0;
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
    let vs = 0, fs = 0, fsHash = 0, label = '';
    const shs = this.attached.get(p) ?? [];
    const gl = this.gl!;
    const rec: Rec = { prog: p, n: this.programs.length + 1, name: '', vs: 0, fs: 0, fsHash: 0, tReq: now(), tDone: -1, phase: this.phase, blockedMs: 0, blockedBy: '', dry: this.dry, label: '' };
    for (const sh of shs) {
      const s = this.srcLen.get(sh);
      if (!s) continue;
      if (this.shaderTypes.get(sh) === gl.VERTEX_SHADER) vs = s.len; else { fs = s.len; fsHash = s.hash; label = s.label; }
      this.shaderOf.set(sh, rec);
    }
    rec.vs = vs; rec.fs = fs; rec.fsHash = fsHash; rec.label = label;
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
    // …and who draws with it: the nearest named objects above a mesh whose material holds the program now
    const props = (this.three as unknown as { properties?: { get(o: unknown): { currentProgram?: { program: WebGLProgram } } } } | null)?.properties;
    if (!props || !this.scene) return;
    this.scene.traverse((o) => {
      const m = (o as unknown as { material?: unknown }).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        let rec: Rec | undefined;
        try { const cp = props.get(mat).currentProgram; rec = cp ? this.byProg.get(cp.program) : undefined; } catch { rec = undefined; }
        if (!rec || rec.owner) continue;
        const names: string[] = [];
        for (let x: Object3D | null = o; x && names.length < 3; x = x.parent) if (x.name) names.unshift(x.name);
        rec.owner = names.join('>') || o.type;
      }
    });
  }

  snapshot(): { marks: { name: string; t: number }[]; programs: BootProgram[]; parallel: boolean; longTasks: { t: number; d: number }[] } {
    this.check();
    this.nameAll();
    return {
      marks: this.marks.map((m) => ({ ...m })), parallel: this.parallel, longTasks: this.longTasks.map((x) => ({ ...x })),
      programs: this.programs.map((r) => ({ n: r.n, name: (r.name || '(raw gl)') + (r.owner ? ` @${r.owner}` : ''), vs: r.vs, fs: r.fs, fsHash: r.fsHash, tReq: r.tReq, tDone: r.tDone, phase: r.phase, blockedMs: r.blockedMs, blockedBy: r.blockedBy, dry: r.dry, label: r.label })),
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
    L.push(`boot compile calls: ${r0(this.callMs)} ms inside compileShader + linkProgram (all programs so far)`);
    L.push(`boot programs before playable: ${desc(bootP)} | asked without drawing ${bootP.filter((p) => p.dry).length} | unfinished at playable ${playable >= 0 ? bootP.filter((p) => p.tDone < 0 || p.tDone > playable).length : '?'}`);
    L.push(`boot programs after playable (each a possible hitch): ${desc(playP)}`);
    {
      // identical fragment sources linked more than once (variants that differ only in the vertex stage or not at all)
      const by = new Map<number, BootProgram[]>();
      for (const p of P) if (p.fs) { const l = by.get(p.fsHash); if (l) l.push(p); else by.set(p.fsHash, [p]); }
      const dup = [...by.values()].filter((l) => l.length > 1);
      if (dup.length) L.push(`boot same fragment source in several programs: ${dup.length} sources, ${sum(dup.map((l) => ({ fs: l[0].fs * (l.length - 1) }) as BootProgram), (p) => p.fs) / 1000 | 0}k chars compiled again: ${dup.sort((a, b) => b[0].fs * b.length - a[0].fs * a.length).slice(0, 8).map((l) => `${l[0].name} x${l.length} (${r0(l[0].fs / 1000)}k)`).join(', ')}`);
    }
    const row = (p: BootProgram) => `  #${p.n} ${p.name} [${p.label}] | vs ${p.vs} fs ${p.fs} | asked ${r0(p.tReq)} ${p.tDone >= 0 ? `done +${r0(linkMs(p))}` : 'NOT DONE'}${p.blockedBy ? ` | WAITED ${r0(p.blockedMs)} ms in ${p.blockedBy}` : ''}${p.dry ? ' | dry' : ''} | ${p.phase}`;
    const show = all ? P : [...new Set([...P.slice().sort((a, b) => b.fs - a.fs).slice(0, 12), ...P.slice().sort((a, b) => linkMs(b) - linkMs(a)).slice(0, 6), ...playP])].sort((a, b) => a.n - b.n);
    L.push(all ? 'boot program list (ms since navigation; "done +" = link request to completion):' : 'boot program list (the 12 largest fragment sources, the 6 slowest links, every link after playable):');
    for (const p of show) L.push(row(p));
    return L;
  }
}

/** a shader's own words: the last two functions defined in its last 12 k characters, else its longest `u…` names */
function labelOf(src: string): string {
  const tail = src.length > 12000 ? src.slice(-12000) : src;
  const fn: string[] = [];
  const re = /\b(?:float|vec[234]|void|mat[34]|int|bool)\s+([A-Za-z_]\w*)\s*\(/g;
  for (let m = re.exec(tail); m; m = re.exec(tail)) if (m[1] !== 'main') fn.push(m[1]);
  if (fn.length) return fn.slice(-2).join('/');
  const us = [...new Set(tail.match(/\bu[A-Z]\w+/g) ?? [])].sort((a, b) => b.length - a.length);
  return us.slice(0, 2).join('/');
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export const bootTrace = new BootTrace();
(globalThis as { __GN_BOOTTRACE__?: unknown }).__GN_BOOTTRACE__ = bootTrace;

/** the boot's non-blocking compile runs only where the browser can report a compile without waiting for it */
export function bootCompileOn(): boolean { return BOOT_COMPILE && bootTrace.parallelCompile; }

type Props = { get(o: unknown): { currentProgram?: { isReady(): boolean } } };
type Drawn = Object3D & { material?: Material | Material[]; geometry?: { attributes?: Record<string, unknown> }; isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean; isInstancedMesh?: boolean; instanceColor?: unknown; isSkinnedMesh?: boolean; isBatchedMesh?: boolean };

/**
 * Ask for the programs one draw of `scene` through `camera` would use — the VISIBLE objects on the camera's layers,
 * one per (material, kind of object, vertex attributes): three's compile() does the asking (compileShader +
 * linkProgram return at once) with the scene's lights and the current render target, as render() would. Returns
 * whether every one of them has finished compiling (COMPLETION_STATUS, no waiting).
 */
function requestVisible(r: WebGLRenderer, scene: Object3D, camera: Camera): boolean {
  const props = (r as unknown as { properties: Props }).properties;
  const seen = new Set<string>();
  let ready = true;
  scene.traverseVisible((o) => {
    const d = o as Drawn;
    if (!d.material || !(d.isMesh || d.isPoints || d.isLine || d.isSprite) || !o.layers.test(camera.layers)) return;
    const mats = Array.isArray(d.material) ? d.material : [d.material];
    let key = `${o.type}${d.isInstancedMesh ? 'I' : ''}${d.instanceColor ? 'C' : ''}${d.isSkinnedMesh ? 'S' : ''}${d.isBatchedMesh ? 'B' : ''}|${d.geometry?.attributes ? Object.keys(d.geometry.attributes).join(',') : ''}`;
    for (const m of mats) key += `|${(m as unknown as { id: number }).id}.${m.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    // (compile() walks the object's children too; they are visited here in their own right, so they are detached for the call)
    const kids = o.children;
    o.children = NO_KIDS;
    try { r.compile(o, camera, scene as Scene); } finally { o.children = kids; }
    for (const m of mats) { const p = props.get(m).currentProgram; if (p && !p.isReady()) ready = false; }
  });
  return ready;
}
const NO_KIDS: Object3D[] = [];

/**
 * Run `frame` (a whole renderer frame) with every draw of the MAIN scene guarded: its programs are asked for first, and
 * the draw happens only if all of them have finished compiling — otherwise that pass is left out of this frame (a
 * per-frame pass: nothing remembers it) and the compile goes on in the browser's own threads. Draws of anything else
 * (the full-screen passes, the one-off bakes that latch "done") are made as usual: their programs were asked for
 * earlier (requestPasses), and one that is still not ready waits as it always did. Returns how many scene passes
 * were left out and how many programs the frame asked for. Nothing is drawn differently: a pass either runs
 * exactly as render() runs it, or not at all.
 */
export function guardedFrame(r: WebGLRenderer, mainScene: Object3D, frame: () => void): { skipped: number; asked: number } {
  const real = r.render;
  const before = bootTrace.programs.length;
  let skipped = 0;
  bootTrace.dry = true;
  r.render = function (this: WebGLRenderer, scene: Object3D, camera: Camera): void {
    if (scene === mainScene) {
      let ok = false;
      try { ok = requestVisible(r, scene, camera); } catch (e) { ok = true; console.warn('[genesis] boot compile: a pass could not be prepared', e); }
      if (!ok) { skipped++; return; }
    }
    bootTrace.dry = false;
    try { real.call(r, scene, camera); } finally { bootTrace.dry = true; }
  } as typeof r.render;
  try { frame(); } finally { r.render = real; bootTrace.dry = false; }
  return { skipped, asked: bootTrace.programs.length - before };
}

/**
 * Ask for the program of every live full-screen pass material (fsquad.ts PASS_MATERIALS) against an offscreen target,
 * as all but the last pass draw (`only`: just these materials, e.g. the last pass against the canvas = a null target). Returns at once; call again when more passes exist (one already asked for is a cache hit).
 */
export function requestPasses(r: WebGLRenderer, target: WebGLRenderTarget | null, only?: (Material | undefined)[]): void {
  if (!target && !only) return;
  const prev = r.getRenderTarget();
  const q = new FullscreenQuad();
  bootTrace.dry = true;
  try {
    r.setRenderTarget(target);
    for (const m of only ?? PASS_MATERIALS) { if (!m) continue; q.mesh.material = m; try { r.compile(q.mesh, q.camera); } catch (e) { console.warn('[genesis] boot compile: a pass material could not be prepared', e); } }
  } finally { bootTrace.dry = false; r.setRenderTarget(prev); q.mesh.geometry.dispose(); }
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
