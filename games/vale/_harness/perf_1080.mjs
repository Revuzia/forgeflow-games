// VALE harness — the 1080p60 check: the real renderer in real Chrome (GPU, 1920×1080, DPR 1) for each
// quality preset, the camera on the densest fight of a live RIFT match, frame times from rAF.
//   VALE_HEADED=1 node _harness/perf_1080.mjs [--prod] [--t 600] [--sec 8] [--q low,medium,high,ultra] [--seed 7]
//                                             [--out _harness/_reports/perf_1080.json] [--no-build] [--keys] [--wait-idle <min>]
// Writes the report (default _harness/_reports/perf_1080.json) and prints one line per preset.
//
// --prod is the r12 B4 GATE: a production build of the bench (vite build into _harness/_prod/dist, gitignored),
// served by `vite preview` on the first free port in 5191-5199 (started and stopped here), RIFT at t 900 s,
// 10 s per preset, High and Low by default. It reports avg fps, p95 / p99 frame ms, the renderer's own CPU ms per
// frame (renderer.render, mean and p95) and the sim pump's, draw calls, programs and triangles per group
// (grass, canopy, terrain, clutter, rocks, landmarks, actors, VFX, ambient, overlay, post: Renderer.profile; main and
// shadow pass apart), the live programs (and how many the frame bound), the 5 worst frames, and
// exits non-zero on a miss of the hard budgets (counts, the same on any machine):
//   High (and Low, as a ceiling): ≤ 500k triangles a frame (every pass, shadows included), ≤ 450 draw calls,
//   ≤ 40 programs.
// The timing targets — renderer CPU ≤ 6 ms a frame (mean; High and Low), High: no dropped frames (≤ 1 % of the frames
// take more than 1.5× the measured vsync interval, the window's median interval), avg ≥ 59.4 fps (60 less that 1 %) and
// p95 ≤ 17.2 ms (16.7 plus 0.5 ms of vsync jitter: at 60 Hz rAF intervals land at 16.6 / 16.7 / 16.8 ms, so a strict
// p95 ≤ 16.7 flipped PASS / FAIL with no frame dropped, perf PERF-V1), p99 ≤ 25 ms; Low: no dropped frames and p95 ≤
// 17.2 ms — are checked only on an idle machine: 1-min load average < 3 and no heavy slot held
// by anyone else (art/blender/common/heavy.py status), before AND after the window. Otherwise they are reported as
// "not measured: machine busy" (renderer.render wraps the GL submission, so a GPU another process holds reads as
// CPU time: the same build read 7.6 and 2.5 ms minutes apart under load).
// --wait-idle <min>: wait up to <min> minutes for such a window (polled every 10 s, before the browser opens, so the
// bench's own page does not count against it) and measure again while a window was busy; the last idle
// measurement (else the last one) is reported.
// --no-build reuses the last _harness/_prod/dist. --keys keeps every program's three cache key in the report.
// dynres (perf PERF-M2, part of --prod; --no-dyn skips it, --dyn-sec <s> sets its match window, default 60): the
// real client's path into a match with dynamic resolution ON — 16 s of the Home menu (its 30 fps idle cap from 4 s),
// then the RIFT match at High. Hard check (any machine): the menu never moves the render scale (it stays 1.0).
// Idle machine only: after the window the match renders at High's own scale, 1.0 (else "not measured: machine busy").
// memory (perf PERF-M1, part of --prod; --no-mem skips it, --mem-cycles <n> sets the rebuilds, default 4; --mem-only
// runs it alone): the IDENTICAL RIFT match (same fighters, map, seed) torn down to the menu and set up again n times
// in one page (a fresh host each time, fast-forwarded to the same t: the deterministic sim gives the same state, so
// content caches fill once). Every texture / geometry / material / render target three uploads is tracked through its 'dispose'
// listener (live = on the GPU). Hard checks (any machine): at every menu after the 2nd, the live render targets and
// renderer.info geometries and textures are <= their menu_2 values (menu_1 may still be filling caches); macOS only
// (`footprint`): the GPU process grows <= 3 % from menu_2 to the last menu.
// match peak (perf PERF-m5, part of --prod; --no-match skips it, --match-only runs it alone, --match-scale <k> the sim speed,
// default 4, --match-min <m> the game minutes, default 30 or the match's end): a whole RIFT match from 0:00 at High, the
// camera locked on your (autopilot) fighter as the real client plays it, every frame rendered; per second of wall time the
// frame's peak triangles (every pass), draw calls and live programs. Hard checks (any machine): the match's PEAK second
// holds the same budgets as the fixed view (≤ 500k triangles, ≤ 450 draws, ≤ 40 programs). The report keeps the timeline,
// the draw groups of the frame after each new triangle peak and when each program was first seen.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PROD = args.includes('--prod');
const T = Number(opt('t', PROD ? 900 : 600)), SEC = Number(opt('sec', PROD ? 10 : 8));
const PRESETS = opt('q', PROD ? 'high,low' : 'low,medium,high,ultra').split(',');
const SEED = Number(opt('seed', 7));
const OUT = resolve(ROOT, opt('out', '_harness/_reports/perf_1080.json'));
const PROD_DIR = join(HERE, '_prod', 'dist');

/** the hard budgets (counts; High, Low held to the same ceiling) and the timing targets (idle machine only) */
const BUDGET = { tris: 500000, draws: 450, programs: 40 };
/** perf PERF-V1: 0.5 ms of vsync jitter on the fps and p95 targets; a dropped frame is an interval > 1.5× the vsync */
const VSYNC_TOL_MS = 0.5;
const DROP_K = 1.5, DROP_SHARE = 0.01;
const TARGET = {
  high: { fps: +(60 * (1 - DROP_SHARE)).toFixed(1), p95Ms: 16.7 + VSYNC_TOL_MS, p99Ms: 25, cpuMs: 6, dropShare: DROP_SHARE },
  low: { p95Ms: 16.7 + VSYNC_TOL_MS, cpuMs: 6, dropShare: DROP_SHARE },
};
/** the display's frame interval read from a window of rAF intervals: their median (a busy window that runs below the
 *  display rate reads as no vsync at all and falls back to 60 Hz; the fps target fails such a window anyway) */
const vsyncOf = (r) => { const s = r.slice().sort((a, b) => a - b); const m = s.length ? s[Math.floor(s.length / 2)] : 0; return m > 4 && m < 17.5 ? m : 1000 / 60; };
const WAIT_IDLE_S = Number(opt('wait-idle', 0)) * 60;
const MEM_ONLY = args.includes('--mem-only');
const DYN = PROD && !MEM_ONLY && !args.includes('--match-only') && !args.includes('--no-dyn');
const MEM = (PROD || MEM_ONLY) && !args.includes('--match-only') && !args.includes('--no-mem');
const MEM_CYCLES = Math.max(2, Number(opt('mem-cycles', 4)));
const MEM_GPU_GROWTH = 0.03;
const DYN_SEC = Number(opt('dyn-sec', 60)), DYN_MENU_S = 16;
const MATCH_ONLY = args.includes('--match-only');
const MATCH = (PROD && !MEM_ONLY && !args.includes('--no-match')) || MATCH_ONLY;
const MATCH_SCALE = Number(opt('match-scale', 4)), MATCH_MAX_S = Number(opt('match-min', 30)) * 60;

// ── machine state ───────────────────────────────────────────────────────────────────────────────
function heavyOthers() {
  try {
    const s = execFileSync('python3', [join(ROOT, 'art/blender/common/heavy.py'), 'status'], { encoding: 'utf8', timeout: 15000 });
    return s.split('\n').map((l) => l.trim()).filter((l) => /^slot\d+:/.test(l) && !new RegExp(`pid ${process.pid}\\b`).test(l)).map((l) => l.replace(/ for \d+s/, ''));
  } catch (e) { return [`heavy status failed: ${e.message}`]; }
}
function machine() {
  const load = +loadavg()[0].toFixed(2), heavy = heavyOthers();
  return { load, heavy, idle: load < 3 && heavy.length === 0 };
}

// ── production build + preview ──────────────────────────────────────────────────────────────────
let server = null;
async function freePort() {
  for (let p = 5191; p <= 5199; p++) {
    const ok = await new Promise((res) => {
      const s = createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)));
      s.listen(p, 'localhost');
    });
    if (ok) return p;
  }
  throw new Error('no free port in 5191-5199');
}
if (PROD) {
  const vite = await import('vite');
  const configFile = join(ROOT, 'vite.config.ts');
  if (!args.includes('--no-build') || !existsSync(join(PROD_DIR, '_harness/web/render_bench.html'))) {
    const t0 = Date.now();
    await vite.build({
      configFile, root: ROOT, logLevel: 'warn',
      build: { outDir: PROD_DIR, emptyOutDir: true, rolldownOptions: { input: { bench: join(HERE, 'web/render_bench.html') } } },
    });
    console.log(`[prod] built the bench in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${PROD_DIR}`);
  }
  // the dev mannequin the bench draws for fighters without art (?dev=1), as the dev server serves it
  mkdirSync(join(PROD_DIR, 'art/out/_proof'), { recursive: true });
  copyFileSync(join(ROOT, 'art/out/_proof/_proof_mannequin.glb'), join(PROD_DIR, 'art/out/_proof/_proof_mannequin.glb'));
  const port = await freePort();
  server = await vite.preview({ configFile, root: ROOT, logLevel: 'warn', build: { outDir: PROD_DIR }, preview: { port, strictPort: true, host: 'localhost', open: false } });
  process.env.VALE_URL = `http://localhost:${port}`;
  console.log(`[prod] vite preview on ${process.env.VALE_URL}`);
}
const stopServer = async () => { if (server) { const s = server; server = null; await (s.close ? s.close() : new Promise((r) => s.httpServer.close(r))); } };
process.on('SIGINT', () => { void stopServer().finally(() => process.exit(130)); });
const { open } = await import('./pw.mjs');

// ── measure ─────────────────────────────────────────────────────────────────────────────────────
const stat = (xs) => {
  const r = xs.slice().sort((a, b) => a - b);
  const p = (k) => (r.length ? r[Math.min(r.length - 1, Math.floor(r.length * k))] : 0);
  return { mean: r.length ? +(r.reduce((s, x) => s + x, 0) / r.length).toFixed(2) : 0, p50: +p(0.5).toFixed(2), p95: +p(0.95).toFixed(2), p99: +p(0.99).toFixed(2) };
};
const sumGroup = (g) => ({ calls: g.calls + g.shadowCalls, tris: g.tris + g.shadowTris, main: { calls: g.calls, tris: g.tris }, shadow: { calls: g.shadowCalls, tris: g.shadowTris } });
const out = {
  gpu: null, build: PROD ? 'prod' : 'dev', viewport: '1920x1080', dpr: 1, mode: 'rift', seed: SEED, matchTime: T, seconds: SEC,
  at: new Date().toISOString(), budgets: { ...BUDGET, targets: TARGET }, presets: {}, pass: true,
};
/** one preset's measurement (its own browser) */
async function measure(q) {
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=${q}&t=${T}&seed=${SEED}&dev=1&hud=1`, { wait: false, hmr: false });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
    const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
    if (err) throw new Error(`bench failed: ${err}`);
    out.gpu ??= await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    await page.waitForTimeout(4000);                                        // models, textures, shader warm-up
    await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
    await page.waitForTimeout(1500);
    const before = machine();
    await page.evaluate(() => window.__VALE_BENCH__.timing(true));
    const r = await page.evaluate((sec) => new Promise((res) => {
      const d = []; let last = performance.now(); const end = last + sec * 1000;
      const tick = (now) => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else res(d); };
      requestAnimationFrame(tick);
    }), SEC);
    const tm = await page.evaluate(() => window.__VALE_BENCH__.timing(true));
    const after = machine();
    const stats = await page.evaluate(() => window.__VALE_BENCH__.stats());
    const prof = await page.evaluate(() => window.__VALE_BENCH__.profile());
    const ft = stat(r), cpu = stat(tm.render), sim = stat(tm.pump);
    const avg = ft.mean;
    const vsyncMs = +vsyncOf(r).toFixed(2), dropped = r.filter((x) => x > vsyncMs * DROP_K).length;
    const groups = prof ? Object.fromEntries(Object.entries(prof.groups).filter(([, g]) => g.calls + g.shadowCalls > 0).map(([k, g]) => [k, sumGroup(g)])) : null;
    const detail = prof ? Object.fromEntries(Object.entries(prof.detail).slice(0, 40).map(([k, g]) => [k, sumGroup(g)])) : null;
    const res = {
      fps: +(1000 / avg).toFixed(1), avgMs: avg, p95Ms: ft.p95, p99Ms: ft.p99, frames: r.length,
      vsyncMs, dropped, droppedShare: r.length ? +(dropped / r.length).toFixed(4) : 0,
      worstMs: r.slice().sort((a, b) => b - a).slice(0, 5).map((x) => +x.toFixed(1)),
      worstCpuMs: tm.render.slice().sort((a, b) => b - a).slice(0, 5).map((x) => +x.toFixed(1)),
      cpuMs: cpu, simMs: sim,
      draws: prof?.total.calls ?? stats.sceneCalls, tris: prof?.total.tris ?? stats.sceneTriangles, programs: stats.programs, programsDrawn: prof?.programsDrawn ?? null,
      groups, detail, programList: prof?.programs.map((p) => (args.includes('--keys') ? p : { type: p.type, name: p.name, used: p.used })) ?? null, stats,
      machine: { before, after, idle: before.idle && after.idle },
    };
    // ── the gate
    const misses = [];
    if (res.tris > BUDGET.tris) misses.push(`triangles ${res.tris} > ${BUDGET.tris}`);
    if (res.draws > BUDGET.draws) misses.push(`draws ${res.draws} > ${BUDGET.draws}`);
    if (res.programs > BUDGET.programs) misses.push(`programs ${res.programs} > ${BUDGET.programs}`);
    const tg = TARGET[q];
    if (tg && !res.machine.idle) res.frameTargets = `not measured: machine busy (load ${before.load}/${after.load}${before.heavy.length || after.heavy.length ? `; ${[...new Set([...before.heavy, ...after.heavy])].join('; ')}` : ''})`;
    else if (tg) {
      const fm = [];
      if (tg.fps && res.fps < tg.fps) fm.push(`fps ${res.fps} < ${tg.fps}`);
      if (tg.p95Ms && res.p95Ms > tg.p95Ms) fm.push(`p95 ${res.p95Ms} ms > ${tg.p95Ms}`);
      if (tg.p99Ms && res.p99Ms > tg.p99Ms) fm.push(`p99 ${res.p99Ms} ms > ${tg.p99Ms}`);
      if (tg.dropShare !== undefined && res.droppedShare > tg.dropShare) fm.push(`${res.dropped} dropped frames (> ${DROP_K}× the ${vsyncMs} ms vsync) = ${(res.droppedShare * 100).toFixed(1)} % > ${tg.dropShare * 100} %`);
      if (tg.cpuMs && cpu.mean > tg.cpuMs) fm.push(`renderer CPU ${cpu.mean} ms > ${tg.cpuMs} ms`);
      res.frameTargets = fm.length ? `MISS: ${fm.join(', ')}` : 'pass';
      misses.push(...fm);
    }
    res.misses = misses;
    res.pass = misses.length === 0;
    res.errors = logs.filter((l) => !/favicon/.test(l)).slice(0, 20);
    const gs = groups ? Object.entries(groups).sort((a, b) => b[1].tris - a[1].tris).map(([k, g]) => `${k} ${(g.tris / 1000).toFixed(0)}k/${g.calls}`).join(' ') : '';
    console.log(`${q.padEnd(7)} ${res.fps} fps  avg ${res.avgMs} p95 ${res.p95Ms} p99 ${res.p99Ms} ms  vsync ${vsyncMs} ms, ${dropped} dropped  cpu ${cpu.mean} (p50 ${cpu.p50} p95 ${cpu.p95}) ms  sim ${sim.mean} ms  draws ${res.draws}  programs ${res.programs} (${res.programsDrawn} drawn)  tris ${(res.tris / 1000).toFixed(0)}k  [${gs}]`);
    console.log(`        load ${before.load}→${after.load}  ${res.frameTargets ?? ''}  ${PROD ? (res.pass ? 'PASS' : `FAIL: ${misses.join('; ')}`) : ''}`);
    return res;
  } finally {
    await browser.close();
  }
}

/** perf PERF-M2: Home menu → RIFT match with dynamic resolution on (see the header) */
async function dynres() {
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=${T}&seed=${SEED}&dev=1&hud=1&dyn=1&menufirst=${DYN_MENU_S}`, { wait: false, hmr: false });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
    const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
    if (err) throw new Error(`bench failed: ${err}`);
    await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
    const menuScale = await page.evaluate(() => window.__VALE_BENCH__.menuScale());
    const before = machine();
    const timeline = [];
    for (let s = 5; s <= DYN_SEC; s += 5) {
      await page.waitForTimeout(5000);
      const st = await page.evaluate(() => { const x = window.__VALE_BENCH__.stats(); return { scale: x.renderScale, w: x.width, h: x.height, bound: x.bound, gpuMs: x.gpuMs == null ? null : +x.gpuMs.toFixed(1), fps: +x.fps.toFixed(1) }; });
      timeline.push({ t: s, ...st });
    }
    const after = machine();
    const end = timeline[timeline.length - 1];
    const res = {
      menuS: DYN_MENU_S, matchS: DYN_SEC, menuScale, base: 1, scale: end.scale, buffer: `${end.w}x${end.h}`, minScale: Math.min(...timeline.map((x) => x.scale)),
      timeline, machine: { before, after, idle: before.idle && after.idle }, errors: logs.filter((l) => !/favicon/.test(l)).slice(0, 10),
    };
    const misses = [];
    if (menuScale !== null && menuScale < 1 - 1e-6) misses.push(`the menu moved the render scale to ${menuScale}`);
    if (!res.machine.idle) res.matchScale = `not measured: machine busy (load ${before.load}/${after.load}${before.heavy.length || after.heavy.length ? `; ${[...new Set([...before.heavy, ...after.heavy])].join('; ')}` : ''})`;
    else {
      if (end.scale < 1 - 1e-6) misses.push(`render scale ${end.scale} after ${DYN_SEC} s of the match (High's base 1.0)`);
      res.matchScale = end.scale < 1 - 1e-6 ? 'MISS' : 'pass';
    }
    res.misses = misses;
    res.pass = misses.length === 0;
    console.log(`dynres  menu ${DYN_MENU_S} s → scale ${menuScale}; match ${DYN_SEC} s → scale ${end.scale} (${res.buffer}, min ${res.minScale}, bound '${end.bound}', gpu ${end.gpuMs} ms, ${end.fps} fps)`);
    console.log(`        load ${before.load}→${after.load}  ${res.matchScale}  ${res.pass ? 'PASS' : `FAIL: ${misses.join('; ')}`}`);
    return res;
  } finally {
    await browser.close();
  }
}

/** a process's physical footprint in MB (macOS `footprint`), null elsewhere */
function footprintMb(pid) {
  try {
    const s = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 });
    const m = /Footprint:\s+([\d.]+)\s+(MB|GB|KB)/.exec(s);
    return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null;
  } catch { return null; }
}

/** perf PERF-M1: rebuild the identical match MEM_CYCLES times (see the header) */
async function memory() {
  const { browser, context, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=120&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
    const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
    if (err) throw new Error(`bench failed: ${err}`);
    const cdp = await context.newCDPSession(page);
    const bcdp = await browser.newBrowserCDPSession();
    // three registers a 'dispose' listener on every texture / geometry / material / render target it uploads and
    // removes it when that object is disposed: registered minus removed is what the GPU still holds
    await page.evaluate(() => {
      const b = window.__VALE_BENCH__;
      let p = b.renderer.scene; while (p && !Object.prototype.hasOwnProperty.call(p, 'addEventListener')) p = Object.getPrototypeOf(p);
      const add = p.addEventListener, rem = p.removeEventListener;
      const live = new Map(); window.__memLive = live; window.__memCycle = 0;
      const kind = (o) => (o.isWebGLRenderTarget || o.isRenderTarget ? 'target' : o.isTexture ? 'texture' : o.isBufferGeometry ? 'geometry' : o.isMaterial ? 'material' : null);
      p.addEventListener = function (type, fn) {
        if (type === 'dispose') { const k = kind(this); if (k && !live.has(this)) live.set(this, { k, c: window.__memCycle }); }
        return add.call(this, type, fn);
      };
      p.removeEventListener = function (type, fn) {
        const r = rem.call(this, type, fn);
        if (type === 'dispose' && live.has(this)) { const l = this._listeners?.dispose; if (!l || l.length === 0) live.delete(this); }
        return r;
      };
      window.__memSnap = () => {
        const by = { target: 0, texture: 0, geometry: 0, material: 0 }, kept = {};
        for (const [o, m] of live) {
          by[m.k]++;
          if (m.c >= 2) { const d = `c${m.c} ` + (m.k === 'target' ? `target ${o.width}x${o.height}` : m.k === 'geometry' ? `geometry ${o.type} v${o.attributes?.position?.count ?? 0}` : `${m.k} ${o.type ?? o.constructor?.name ?? ''} ${o.name ?? ''}`); kept[d] = (kept[d] ?? 0) + 1; }
        }
        return { by, kept };
      };
    });
    const sample = async (tag) => {
      for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await page.waitForTimeout(250); }
      const r = await page.evaluate(() => { const s = window.__VALE_BENCH__.renderer.stats(); return { geometries: s.geometries, textures: s.textures, programs: s.programs, ...window.__memSnap() }; });
      const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
      const gpu = ps.find((x) => x.type === 'GPU');
      const s = { tag, geometries: r.geometries, textures: r.textures, programs: r.programs, targets: r.by.target, tracked: r.by, gpuProcMb: gpu ? footprintMb(gpu.id) : null, kept: r.kept };
      console.log(`mem     ${tag.padEnd(7)} targets ${s.targets}  geometries ${s.geometries}  textures ${s.textures}  programs ${s.programs}  materials ${r.by.material}  GPU process ${s.gpuProcMb ?? '-'} MB`);
      return s;
    };
    const cycles = [];
    await page.evaluate(() => window.__VALE_BENCH__.frames(60, 1 / 30));
    cycles.push(await sample('match_0'));
    for (let c = 1; c <= MEM_CYCLES + 1; c++) {
      await page.evaluate((k) => { window.__memCycle = k; const b = window.__VALE_BENCH__; b.renderer.setScene('menu'); for (let i = 0; i < 30; i++) b.renderer.render(1 / 30); }, c);
      await page.waitForTimeout(1500);
      cycles.push(await sample(`menu_${c}`));
      if (c > MEM_CYCLES) break;
      await page.evaluate(() => window.__VALE_BENCH__.rebuild());
      await page.waitForTimeout(5000);                                    // models, textures, landmarks land
      await page.evaluate(() => window.__VALE_BENCH__.frames(90, 1 / 30));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.__VALE_BENCH__.frames(30, 1 / 30));
      cycles.push(await sample(`match_${c}`));
    }
    const menus = cycles.filter((x) => x.tag.startsWith('menu_'));
    const base = menus[1], last = menus[menus.length - 1];
    const misses = [];
    for (const m of menus.slice(2)) {
      for (const k of ['targets', 'geometries', 'textures']) if (m[k] > base[k]) misses.push(`${m.tag} ${k} ${m[k]} > menu_2 ${base[k]}`);
    }
    const growth = base.gpuProcMb && last.gpuProcMb ? +((last.gpuProcMb - base.gpuProcMb) / base.gpuProcMb).toFixed(4) : null;
    if (growth !== null && growth > MEM_GPU_GROWTH) misses.push(`GPU process +${(growth * 100).toFixed(1)} % from menu_2 to ${last.tag} (> ${MEM_GPU_GROWTH * 100} %)`);
    for (const x of cycles) if (x !== last) delete x.kept;
    const res = { cycles: MEM_CYCLES, timeline: cycles, gpuGrowth: growth, keptAtLastMenu: last.kept, misses, pass: misses.length === 0, errors: logs.filter((l) => !/favicon/.test(l)).slice(0, 10) };
    console.log(`mem     ${MEM_CYCLES} rebuilds: menu_2 → ${last.tag}: targets ${base.targets}→${last.targets}, geometries ${base.geometries}→${last.geometries}, textures ${base.textures}→${last.textures}, GPU process ${base.gpuProcMb ?? '-'}→${last.gpuProcMb ?? '-'} MB${growth === null ? '' : ` (${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(1)} %)`}  ${res.pass ? 'PASS' : `FAIL: ${misses.join('; ')}`}`);
    return res;
  } finally {
    await browser.close();
  }
}

/** perf PERF-m5: a whole RIFT match at High, per-second peaks of triangles / draws / programs (see the header) */
async function matchPeak() {
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=0&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
    const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
    if (err) throw new Error(`bench failed: ${err}`);
    await page.waitForTimeout(3000);                                        // models, textures, shader warm-up
    await page.evaluate(([scale, maxT]) => {
      const b = window.__VALE_BENCH__, r = b.renderer, host = b.host;
      const S = { done: false, secs: [], progs: [], profiles: [], pending: false, error: null, endT: 0, ended: false, maxProg: 0, progsAtMax: [] };
      window.__peak = S;
      host.setTimeScale(scale);
      b.follow();
      const seen = new Set();
      const fresh = () => ({ tris: 0, calls: 0, programs: 0, frames: 0, worstMs: 0, crowd: 0 });
      let last = performance.now(), secAt = last, cur = fresh(), best = 0, want = false;
      const tick = (now) => {
        try {
          const iv = now - last, dt = Math.min(0.1, iv / 1000);
          last = now;
          host.pump(dt);
          r.render(dt);
          const st = r.stats();
          cur.frames++;
          cur.tris = Math.max(cur.tris, st.triangles); cur.calls = Math.max(cur.calls, st.calls); cur.programs = Math.max(cur.programs, st.programs);
          cur.crowd = Math.max(cur.crowd ?? 0, st.crowd ?? 0);
          // the live programs when their count first reaches its match maximum (which ones push it over the budget)
          if (st.programs > S.maxProg) {
            S.maxProg = st.programs;
            S.progsAtMax = (r.gl.info.programs ?? []).map((p) => ({ type: p.type, name: p.name, used: p.usedTimes, key: p.cacheKey }));
            S.progsAtMaxT = +host.view.time.toFixed(1);
          }
          cur.worstMs = Math.max(cur.worstMs, iv);
          if (now - secAt >= 1000) {
            const t = +host.view.time.toFixed(1);
            S.secs.push({ t, ...cur, worstMs: +cur.worstMs.toFixed(1), actors: st.actors, vfx: st.vfx, particles: st.particles });
            for (const p of r.gl.info.programs ?? []) {
              if (seen.has(p.cacheKey)) continue;
              seen.add(p.cacheKey);
              const e = { t, name: p.name, type: p.type };
              // a program first built after the opening minute: the meshes drawing with it (name > parent > grandparent)
              if (S.secs.length > 60) {
                const users = new Set();
                r.scene.traverse((o) => {
                  for (const m of [o.material, o.customDepthMaterial].flat()) {
                    if (m && r.gl.properties.get(m).currentProgram === p) users.add(`${o.name || o.type} > ${o.parent?.name || o.parent?.type || '-'} > ${o.parent?.parent?.name || '-'} [${m.name || m.type}]`);
                  }
                });
                e.users = [...users].slice(0, 6);
              }
              S.progs.push(e);
            }
            if (cur.tris > best * 1.02) { best = cur.tris; want = true; }
            cur = fresh(); secAt = now;
          }
          if (want && !S.pending) {
            want = false; S.pending = true;
            const t = +host.view.time.toFixed(1);
            r.profile().then((p) => { S.pending = false; if (p) S.profiles.push({ t, total: p.total, groups: p.groups, detail: Object.fromEntries(Object.entries(p.detail).slice(0, 16)) }); });
          }
          if (host.ended || host.view.time >= maxT) { S.done = true; S.endT = host.view.time; S.ended = !!host.ended; return; }
          requestAnimationFrame(tick);
        } catch (e) { S.error = String(e?.stack ?? e); S.done = true; }
      };
      requestAnimationFrame(tick);
    }, [MATCH_SCALE, MATCH_MAX_S]);
    const t0 = Date.now();
    for (;;) {
      await page.waitForTimeout(15000);
      const p = await page.evaluate(() => { const S = window.__peak; const last = S.secs[S.secs.length - 1]; return { done: S.done, error: S.error, n: S.secs.length, t: last?.t ?? 0, tris: Math.max(0, ...S.secs.map((x) => x.tris)), programs: Math.max(0, ...S.secs.map((x) => x.programs)) }; });
      console.log(`match   ${Math.round((Date.now() - t0) / 1000)} s: game ${p.t} s, peak so far ${(p.tris / 1000).toFixed(0)}k triangles, ${p.programs} programs`);
      if (p.done) break;
      if (Date.now() - t0 > (MATCH_MAX_S / MATCH_SCALE) * 3000 + 600000) throw new Error('match peak: timed out');
    }
    const S = await page.evaluate(() => window.__peak);
    if (S.error) throw new Error(`match peak failed: ${S.error}`);
    const secs = S.secs;
    const peakOf = (k) => secs.reduce((m, x) => (x[k] > m[k] ? x : m), secs[0]);
    const pt = peakOf('tris'), pc = peakOf('calls'), pp = peakOf('programs');
    const over = (k, lim) => secs.filter((x) => x[k] > lim).map((x) => x.t);
    const profiles = S.profiles.map((p) => ({ t: p.t, total: p.total, groups: Object.fromEntries(Object.entries(p.groups).filter(([, g]) => g.calls + g.shadowCalls > 0).map(([k, g]) => [k, sumGroup(g)])), detail: Object.fromEntries(Object.entries(p.detail).map(([k, g]) => [k, sumGroup(g)])) }));
    const firstT = secs.length ? secs[0].t : 0;
    const res = {
      scale: MATCH_SCALE, endT: +S.endT.toFixed(1), ended: S.ended, seconds: secs.length,
      peak: { tris: pt.tris, trisAt: pt.t, draws: pc.calls, drawsAt: pc.t, programs: pp.programs, programsAt: pp.t },
      overBudget: { tris: over('tris', BUDGET.tris), draws: over('calls', BUDGET.draws), programs: over('programs', BUDGET.programs) },
      lateProgramsAfter60s: S.progs.filter((x) => x.t > firstT + 60),
      programsFirstSeen: S.progs.map((x) => ({ t: x.t, name: x.name, type: x.type })),
      programsAtMax: { t: S.progsAtMaxT ?? null, list: S.progsAtMax },
      programsSeen: S.progs.length, peakProfile: profiles.length ? profiles[profiles.length - 1] : null, profiles, timeline: secs,
      errors: logs.filter((l) => !/favicon/.test(l)).slice(0, 20),
    };
    const misses = [];
    if (pt.tris > BUDGET.tris) misses.push(`peak triangles ${pt.tris} > ${BUDGET.tris} at ${pt.t} s (${res.overBudget.tris.length} s over)`);
    if (pc.calls > BUDGET.draws) misses.push(`peak draws ${pc.calls} > ${BUDGET.draws} at ${pc.t} s`);
    if (pp.programs > BUDGET.programs) misses.push(`peak programs ${pp.programs} > ${BUDGET.programs} at ${pp.t} s`);
    res.misses = misses;
    res.pass = misses.length === 0;
    const gs = res.peakProfile ? Object.entries(res.peakProfile.groups).sort((a, b) => b[1].tris - a[1].tris).map(([k, g]) => `${k} ${(g.tris / 1000).toFixed(0)}k/${g.calls}`).join(' ') : '';
    console.log(`match   ${secs.length} s to game ${res.endT} s (x${MATCH_SCALE}${S.ended ? ', ended' : ''}): peak ${(pt.tris / 1000).toFixed(0)}k triangles at ${pt.t} s, ${pc.calls} draws at ${pc.t} s, ${pp.programs} programs at ${pp.t} s; ${res.lateProgramsAfter60s.length} programs first seen after 1:00  [peak frame ${res.peakProfile?.t ?? '-'} s: ${gs}]`);
    console.log(`        ${res.pass ? 'PASS' : `FAIL: ${misses.join('; ')}`}`);
    return res;
  } finally {
    await browser.close();
  }
}

/** wait (≤ `sec` seconds, polled every 10 s) for an idle machine; true when one came */
async function waitIdle(sec) {
  const end = Date.now() + sec * 1000;
  for (;;) {
    const m = machine();
    if (m.idle) return true;
    if (Date.now() >= end) return false;
    console.log(`        waiting for an idle machine: load ${m.load}${m.heavy.length ? `; ${m.heavy.join('; ')}` : ''}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
}

try {
  const deadline = Date.now() + WAIT_IDLE_S * 1000;
  for (const q of MEM_ONLY || MATCH_ONLY ? [] : PRESETS) {
    let res = null;
    for (;;) {
      if (WAIT_IDLE_S > 0) await waitIdle(Math.max(0, (deadline - Date.now()) / 1000));
      const r = await measure(q);
      if (!res || r.machine.idle || !res.machine.idle) res = r;
      if (res.machine.idle || WAIT_IDLE_S <= 0 || Date.now() >= deadline) break;
      console.log(`        ${q}: the window was busy, measuring again`);
    }
    if (PROD && !res.pass) out.pass = false;
    out.presets[q] = res;
  }
  if (DYN) {
    if (WAIT_IDLE_S > 0) await waitIdle(Math.max(0, (deadline - Date.now()) / 1000));
    out.dynres = await dynres();
    if (!out.dynres.pass) out.pass = false;
  }
  if (MEM) {
    out.memory = await memory();
    if (!out.memory.pass) out.pass = false;
  }
  if (MATCH) {
    out.match = await matchPeak();
    if (!out.match.pass) out.pass = false;
  }
} finally {
  await stopServer();
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`GPU: ${out.gpu}  → ${OUT}`);
if (PROD || MEM_ONLY || MATCH_ONLY) { console.log(out.pass ? 'GATE PASS' : 'GATE FAIL'); if (!out.pass) process.exitCode = 1; }
