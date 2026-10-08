#!/usr/bin/env node
// GENESIS — screenshot harness (CONTRACT.md §18). Headless Chromium (SwiftShader WebGL 2) via Playwright.
//
//   node _harness/shots.mjs                          # the default lookdev set
//   node _harness/shots.mjs specs.json               # a JSON array of shot specs (or { "shots": [...] })
//   node _harness/shots.mjs --name=orbit --cam='{"mode":"orbit","lat":20,"lon":-30,"dist":8000}' --params=source=lookdev
//   options: --size=1280x720  --only=name1,name2  --quality=high  --keep (leave the dev server running)
//
// Shot spec: { name, params?: "a=b&c=d" | {a:"b"}, camera?: CameraSpec, commands?: Command[], wait?: ticks to step,
//              frames?: frames to render before the capture (default 6), ui?: bool (default false), quality?, size?: [w,h],
//              exposure?: EV, canvasOnly?: bool }
// Starts `vite` on port 5190 (GENESIS_FROZEN=1: no HMR, so edits elsewhere never reload a page mid-shot) unless one
// is already serving there; saves PNGs to _shots/ and a JSON report (console errors, fps, timings) to
// _shots/report.json. Exit code 1 if any shot failed or any console error was seen.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '_shots');
const PORT = 5190;
const BASE = `http://localhost:${PORT}/`;

function loadPlaywright() {
  const candidates = ['/opt/node22/lib/node_modules/playwright', 'playwright'];
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error('playwright not found (expected /opt/node22/lib/node_modules/playwright)');
}

const DEFAULT_SHOTS = [
  { name: 'system', params: 'source=lookdev', camera: { mode: 'system' }, frames: 8 },
  { name: 'orbit-day', params: 'source=lookdev', camera: { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour: 13 }, frames: 8 },
  { name: 'terminator', params: 'source=lookdev', camera: { mode: 'orbit', lat: 8, lon: 20, dist: 7400, hour: 18.6 }, frames: 8 },
  { name: 'coast', params: 'source=lookdev', camera: { mode: 'orbit', poi: 'coast', dist: 330, tilt: 68, hour: 10.5 }, frames: 10 },
  { name: 'valley', params: 'source=lookdev', camera: { mode: 'surface', poi: 'valley', alt: 30, pitch: -2, hour: 9 }, frames: 10 },
  { name: 'sunset', params: 'source=lookdev', camera: { mode: 'surface', poi: 'westcoast', alt: 9, pitch: 4, sunElevation: 3, faceSun: true }, frames: 10 },
  { name: 'hud', params: 'source=lookdev&dev=1', camera: { mode: 'orbit', lat: 25, lon: -60, dist: 2600, hour: 11 }, frames: 8, ui: true },
  { name: 'airless', params: 'source=lookdev&scenario=barren', camera: { mode: 'surface', lat: 10, lon: 30, alt: 25, pitch: 6, hour: 15 }, frames: 8 },
];

function parseArgs(argv) {
  const out = { file: null, opts: {} };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      out.opts[k] = rest.length ? rest.join('=') : true;
    } else out.file = a;
  }
  return out;
}

async function serverUp() {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function startServer() {
  if (await serverUp()) return null;
  const vite = resolve(ROOT, 'node_modules/.bin/vite');
  const child = spawn(vite, ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT, env: { ...process.env, GENESIS_FROZEN: '1', BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 120; i++) {
    if (await serverUp()) return child;
    if (child.exitCode != null) throw new Error(`vite exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`vite did not come up on ${PORT}:\n${log}`);
}

function paramsString(p) {
  if (!p) return '';
  if (typeof p === 'string') return p.replace(/^\?/, '');
  return new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
}

async function main() {
  const { file, opts } = parseArgs(process.argv.slice(2));
  let shots = DEFAULT_SHOTS;
  if (file) {
    const j = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    shots = Array.isArray(j) ? j : j.shots;
  } else if (opts.name) {
    shots = [{ name: opts.name, params: opts.params ?? 'source=lookdev', camera: opts.cam ? JSON.parse(opts.cam) : undefined, frames: Number(opts.frames ?? 6) }];
  }
  if (opts.only) {
    const only = new Set(String(opts.only).split(','));
    shots = shots.filter((s) => only.has(s.name));
  }
  const [dw, dh] = String(opts.size ?? '1280x720').split('x').map(Number);
  mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'],
  });
  const report = { started: new Date().toISOString(), base: BASE, shots: [], consoleErrors: [] };
  let failed = 0;
  // one page per distinct URL (booting a world costs seconds in SwiftShader)
  const pages = new Map();
  const getPage = async (url, size) => {
    const key = `${url}|${size.join('x')}`;
    if (pages.has(key)) return pages.get(key);
    // only one live page: a background page keeps rendering and would steal the (software) GPU from the next one
    for (const [k, e] of pages) {
      for (const err of e.errors) report.consoleErrors.push({ shot: '(page)', error: err });
      e.errors.length = 0;
      await e.ctx.close();
      pages.delete(k);
    }
    const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(600000);
    const errors = [];
    page.on('console', (m) => {
      const t = m.type();
      if (t === 'error') errors.push(m.text());
      if (opts.verbose || t === 'warning' || t === 'error') console.log(`  [${t}] ${m.text()}`);
    });
    page.on('pageerror', (e) => { errors.push(String(e && e.stack || e)); console.log(`  [pageerror] ${e}`); });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 600000 });
    await page.waitForFunction(() => !!window.__GENESIS__, null, { timeout: 600000 });
    await page.evaluate(() => window.__GENESIS__.ready);
    console.log(`  booted ${url} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const entry = { page, ctx, errors };
    pages.set(key, entry);
    return entry;
  };
  for (const s of shots) {
    const size = s.size ?? [dw, dh];
    const q = s.quality ?? opts.quality ?? 'high';
    const params = new URLSearchParams(paramsString(s.params ?? 'source=lookdev'));
    if (!params.has('quality')) params.set('quality', q);
    if (!params.has('intro')) params.set('intro', '0');
    // time stands still unless a shot asks otherwise: at 1× the sun moves ~2.5° per real second, and a software-
    // rendered frame takes seconds
    if (!params.has('speed')) params.set('speed', '0');
    const url = `${BASE}?${params.toString()}`;
    const t0 = Date.now();
    console.log(`shot ${s.name}: ${url}`);
    try {
      const { page, errors } = await getPage(url, size);
      const before = errors.length;
      const result = await page.evaluate(async (spec) => {
        const G = window.__GENESIS__;
        G.ui(!!spec.ui);
        if (spec.exposure != null) G.exposure(spec.exposure);
        else G.exposure(0);
        if (spec.camera) await G.camera(spec.camera);
        for (const c of spec.commands ?? []) await G.cmd(c);
        if (spec.wait) await G.step(spec.wait);
        const t = performance.now();
        await G.frames(spec.frames ?? 6);
        const ms = (performance.now() - t) / Math.max(1, spec.frames ?? 6);
        let path = null;
        if (spec.canvasOnly) path = await G.shot(spec.name);
        const st = G.state();
        return { path, msPerFrame: ms, state: { tick: st.tick, camera: st.camera, render: st.render, source: st.source } };
      }, s);
      let file = result.path;
      if (!s.canvasOnly) {
        file = resolve(SHOTS, `${s.name}.png`);
        await page.screenshot({ path: file });
      }
      const newErrors = errors.slice(before);
      report.shots.push({ name: s.name, file, url, ms: Date.now() - t0, msPerFrame: Math.round(result.msPerFrame), render: result.state.render, camera: result.state.camera, errors: newErrors });
      for (const e of newErrors) report.consoleErrors.push({ shot: s.name, error: e });
      console.log(`  → ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s, ${Math.round(result.msPerFrame)} ms/frame, ${result.state.render.triangles} tris, ${result.state.render.drawCalls} draws)`);
    } catch (e) {
      failed++;
      console.log(`  FAILED: ${e && e.stack || e}`);
      report.shots.push({ name: s.name, url, error: String(e && e.message || e) });
    }
  }
  for (const { page, errors } of pages.values()) {
    // errors raised during boot belong to no shot
    void page;
    for (const e of errors) if (!report.consoleErrors.some((x) => x.error === e)) report.consoleErrors.push({ shot: '(boot)', error: e });
  }
  await browser.close();
  if (server && !opts.keep) server.kill();
  report.finished = new Date().toISOString();
  writeFileSync(resolve(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.shots.length - failed}/${report.shots.length} shots, ${report.consoleErrors.length} console error(s)`);
  for (const e of report.consoleErrors) console.log(`  [${e.shot}] ${e.error}`);
  process.exit(failed || report.consoleErrors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });

void existsSync;
