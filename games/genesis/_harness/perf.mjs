#!/usr/bin/env node
// GENESIS — performance probe (CONTRACT.md §18): boots the app on the real sim worker in headless Chromium and
// measures, per run, the sim's achieved speed (ticks/s in the worker, which paces itself on its own thread) at each
// requested multiplier, plus the main thread's frame time. SwiftShader renders WebGL on the CPU, so the frame time is
// for regressions only — it says nothing about a real GPU — but it shares the cores with the worker, so the achieved
// speed measured here is a conservative floor.
//
//   node _harness/perf.mjs                                  # sandbox, speeds 1,10,100,1000, 12 s each
//   node _harness/perf.mjs --scenario=lookdev --speeds=100,1000 --secs=15 --quality=low --view=orbit|surface|system --size=640x360
// Uses (or starts) the vite dev server on :5190; prints a table and writes _shots/perf.json.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5190;
const BASE = `http://localhost:${PORT}/`;

const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));
const scenario = opts.scenario ?? 'sandbox';
const speeds = (opts.speeds ?? '1,10,100,1000').split(',').map(Number);
const secs = Number(opts.secs ?? 12);
const quality = opts.quality ?? 'high';
const view = opts.view ?? 'orbit';
const [vw, vh] = String(opts.size ?? '1280x720').split('x').map(Number);

async function serverUp() {
  try { return (await fetch(BASE, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}
async function startServer() {
  if (await serverUp()) return null;
  const child = spawn(resolve(ROOT, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT, env: { ...process.env, GENESIS_FROZEN: '1', BROWSER: 'none' }, stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) { if (await serverUp()) return child; await new Promise((r) => setTimeout(r, 500)); }
  child.kill();
  throw new Error('vite did not come up');
}

const server = await startServer();
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const url = `${BASE}?scenario=${scenario}&quality=${quality}&intro=0&speed=0&ui=0`;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
const bootS = (Date.now() - t0) / 1000;
await page.evaluate((v) => window.__GENESIS__.camera(v === 'surface'
  ? { mode: 'surface', poi: 'coast', alt: 40, pitch: -3, hour: 10 }
  : v === 'system' ? { mode: 'system' } : { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour: 10 }), view);
await page.evaluate(() => window.__GENESIS__.frames(3));

const rows = [];
for (const sp of speeds) {
  const r = await page.evaluate(async ({ sp, secs }) => {
    const G = window.__GENESIS__;
    G.setSpeed(sp);
    // let the worker's 1 s measuring window settle
    await new Promise((ok) => setTimeout(ok, 2500));
    const s0 = G.state();
    const t0 = performance.now();
    const f0 = s0.frames;
    const samples = [];
    while (performance.now() - t0 < secs * 1000) {
      await new Promise((ok) => setTimeout(ok, 1000));
      const s = G.state();
      samples.push({ achieved: s.achievedSpeed, frameMs: s.render.frameMs });
    }
    const s1 = G.state();
    const wall = (performance.now() - t0) / 1000;
    // clock smoothness: the interpolated render tick sampled every animation frame should advance in proportion to
    // real time (planet spin, sun and calendar move smoothly): relative jitter of its rate, and backward steps
    const clock = await new Promise((ok) => {
      const pts = [];
      const t1 = performance.now();
      const tickF = () => {
        pts.push([performance.now(), G.state().tick]);
        if (performance.now() - t1 < 4000) requestAnimationFrame(tickF); else ok(pts);
      };
      requestAnimationFrame(tickF);
    });
    const rates = [];
    let back = 0;
    for (let i = 1; i < clock.length; i++) {
      const dt = clock[i][0] - clock[i - 1][0], dk = clock[i][1] - clock[i - 1][1];
      if (dk < -1e-9) back++;
      if (dt > 0) rates.push((dk / dt) * 1000);
    }
    const mean = rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length);
    const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rates.length));
    G.setSpeed(0);
    const ach = samples.map((x) => x.achieved).filter((x) => x > 0);
    return {
      speed: sp,
      achievedSpeed: ach.reduce((a, b) => a + b, 0) / Math.max(1, ach.length),
      ticksPerSecond: (s1.snapTick - s0.snapTick) / wall,
      framesPerSecond: (s1.frames - f0) / wall,
      wallMsPerFrame: (wall * 1000) / Math.max(1, s1.frames - f0),
      cpuRenderMs: samples.reduce((a, b) => a + b.frameMs, 0) / Math.max(1, samples.length),
      clockTicksPerSecond: mean, clockJitter: mean > 0 ? sd / mean : 0, clockBackSteps: back, clockFrames: rates.length,
    };
  }, { sp, secs });
  rows.push(r);
  console.log(`${scenario} ${String(sp).padStart(5)}x  achieved ${r.achievedSpeed.toFixed(1).padStart(7)}x  ${r.ticksPerSecond.toFixed(0).padStart(6)} ticks/s  ` +
    `${r.framesPerSecond.toFixed(2)} fps (${r.wallMsPerFrame.toFixed(0)} ms/frame wall, ${r.cpuRenderMs.toFixed(1)} ms CPU in render())  ` +
    `clock ${r.clockTicksPerSecond.toFixed(1)} ticks/s, jitter ${(r.clockJitter * 100).toFixed(1)}% over ${r.clockFrames} frames, ${r.clockBackSteps} backward`);
}
await browser.close();
if (server) server.kill();
const report = { scenario, quality, view, size: [vw, vh], bootSeconds: bootS, rows, errors, at: new Date().toISOString() };
mkdirSync(resolve(ROOT, '_shots'), { recursive: true });
writeFileSync(resolve(ROOT, '_shots/perf.json'), JSON.stringify(report, null, 2));
if (errors.length) { console.log('console errors:', errors); process.exit(1); }
