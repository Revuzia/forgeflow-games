// VALE harness — the 1080p60 check: the real renderer in real Chrome (GPU, 1920×1080, DPR 1) for each
// quality preset, the camera on the densest fight of a live RIFT match, frame times from rAF.
//   VALE_HEADED=1 node _harness/perf_1080.mjs [--prod] [--t 600] [--sec 8] [--q low,medium,high,ultra] [--seed 7]
//                                             [--out _harness/_reports/perf_1080.json] [--no-build] [--keys]
// Writes the report (default _harness/_reports/perf_1080.json) and prints one line per preset.
//
// --prod is the r12 B4 GATE: a production build of the bench (vite build into _harness/_prod/dist, gitignored),
// served by `vite preview` on the first free port in 5191-5199 (started and stopped here), RIFT at t 900 s,
// 10 s per preset, High and Low by default. It reports avg fps, p95 / p99 frame ms, the renderer's own CPU ms per
// frame (renderer.render, mean and p95) and the sim pump's, draw calls, programs and triangles per group
// (grass, canopy, terrain, clutter, rocks, landmarks, actors, VFX, ambient, overlay, post: Renderer.profile) and
// exits non-zero on a miss of the hard budgets:
//   High (and Low, as a ceiling): ≤ 500k triangles a frame (every pass, shadows included), ≤ 450 draw calls,
//   ≤ 40 programs, renderer CPU ≤ 6 ms a frame.
// The frame-time targets (High avg ≥ 60 fps, p95 ≤ 16.7 ms, p99 ≤ 25 ms; Low p95 ≤ 16.7 ms) are checked only on
// an idle machine — 1-min load average < 3 and no heavy slot held by anyone else (art/blender/common/heavy.py
// status), before AND after the window — and are otherwise reported as "not measured: machine busy".
// --no-build reuses the last _harness/_prod/dist. --keys keeps every program's three cache key in the report.
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

/** the hard budgets (High; Low is held to the same ceiling) and the frame-time targets (idle machine only) */
const BUDGET = { tris: 500000, draws: 450, programs: 40, cpuMs: 6 };
const TARGET = { high: { fps: 60, p95Ms: 16.7, p99Ms: 25 }, low: { p95Ms: 16.7 } };

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
try {
  for (const q of PRESETS) {
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
      const groups = prof ? Object.fromEntries(Object.entries(prof.groups).filter(([, g]) => g.calls + g.shadowCalls > 0).map(([k, g]) => [k, sumGroup(g)])) : null;
      const detail = prof ? Object.fromEntries(Object.entries(prof.detail).slice(0, 40).map(([k, g]) => [k, sumGroup(g)])) : null;
      const res = {
        fps: +(1000 / avg).toFixed(1), avgMs: avg, p95Ms: ft.p95, p99Ms: ft.p99, frames: r.length,
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
      if (cpu.mean > BUDGET.cpuMs) misses.push(`renderer CPU ${cpu.mean} ms > ${BUDGET.cpuMs} ms`);
      const tg = TARGET[q];
      if (tg && !res.machine.idle) res.frameTargets = `not measured: machine busy (load ${before.load}/${after.load}${before.heavy.length || after.heavy.length ? `; ${[...new Set([...before.heavy, ...after.heavy])].join('; ')}` : ''})`;
      else if (tg) {
        const fm = [];
        if (tg.fps && res.fps < tg.fps) fm.push(`fps ${res.fps} < ${tg.fps}`);
        if (tg.p95Ms && res.p95Ms > tg.p95Ms) fm.push(`p95 ${res.p95Ms} ms > ${tg.p95Ms}`);
        if (tg.p99Ms && res.p99Ms > tg.p99Ms) fm.push(`p99 ${res.p99Ms} ms > ${tg.p99Ms}`);
        res.frameTargets = fm.length ? `MISS: ${fm.join(', ')}` : 'pass';
        misses.push(...fm);
      }
      res.misses = misses;
      res.pass = misses.length === 0;
      if (PROD && !res.pass) out.pass = false;
      res.errors = logs.filter((l) => !/favicon/.test(l)).slice(0, 20);
      out.presets[q] = res;
      const gs = groups ? Object.entries(groups).sort((a, b) => b[1].tris - a[1].tris).map(([k, g]) => `${k} ${(g.tris / 1000).toFixed(0)}k/${g.calls}`).join(' ') : '';
      console.log(`${q.padEnd(7)} ${res.fps} fps  avg ${res.avgMs} p95 ${res.p95Ms} p99 ${res.p99Ms} ms  cpu ${cpu.mean} (p50 ${cpu.p50} p95 ${cpu.p95}) ms  sim ${sim.mean} ms  draws ${res.draws}  programs ${res.programs} (${res.programsDrawn} drawn)  tris ${(res.tris / 1000).toFixed(0)}k  [${gs}]`);
      console.log(`        load ${before.load}→${after.load}  ${res.frameTargets ?? ''}  ${PROD ? (res.pass ? 'PASS' : `FAIL: ${misses.join('; ')}`) : ''}`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await stopServer();
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`GPU: ${out.gpu}  → ${OUT}`);
if (PROD) { console.log(out.pass ? 'GATE PASS' : 'GATE FAIL'); if (!out.pass) process.exitCode = 1; }
