#!/usr/bin/env node
// GENESIS — screenshot harness (CONTRACT.md §18). Headless Chromium (SwiftShader WebGL 2) via Playwright.
//
//   node _harness/shots.mjs                          # the default lookdev set
//   node _harness/shots.mjs specs.json               # a JSON array of shot specs (or { "shots": [...] })
//   node _harness/shots.mjs --name=orbit --cam='{"mode":"orbit","lat":20,"lon":-30,"dist":8000}' --params=source=lookdev
//   options: --size=1280x720  --only=name1,name2  --quality=high  --keep (leave the dev server running)
//
// Shot spec: { name, params?: "a=b&c=d" | {a:"b"}, commands?: Command[], wait?: ticks to step, camera?: CameraSpec
//              (applied in that order: the world changes, time passes, then the camera frames it),
//              frames?: frames to render before the capture (default 6), ui?: bool (default false), quality?, size?: [w,h],
//              exposure?: EV, canvasOnly?: bool,
//              run?: { speed, seconds } — let the sim run in real time at that speed after `wait` (then pause unless
//                     keep: true), e.g. a settlement living at 100× while the page renders,
//              select?: { kind, id } | "agent:nearest" | "building:nearest" | "settlement:<id>" — open the inspector on it,
//              follow?: same forms as select — keep the camera on it,
//              click?: "agent:nearest" | "building:nearest" | [x, y] — a real click there (picking, then the inspector) }
// Values in commands / camera / select may use: "$poi:<name>" → that POI's unit vector on the primary world
// (e.g. "pos": "$poi:homestead"), "$created" → the id of the last settlement (else entity) a command created on this
// page (also inside strings: "poi": "settlement:$created"). A command with "as": "<name>" also keeps what it created
// as "$<name>" (e.g. "as": "plains" → "settlement:$plains"); "as" is not sent to the sim. Shots of the same URL share
// one page, so a sequence of shots follows one world through time.
// chronicle?: true | N — after the shot, print the world's chronicle (all, or the last N entries) and save it as
// _shots/<name>.chronicle.txt.
// script?: string | string[] — JS run in the page (async; G = __GENESIS__, vars) after camera / select / click, e.g.
// "await G.ui_.open('palette', { query: 'rain' })" — drives the UI for a shot; its return value is printed.
// pick?: "agent:settlement:<id>" — before the camera, keep a living member of that settlement (the first the sim lists)
// as "$agent", e.g. camera { target: { kind: "agent", id: "$agent" } } and select { kind: "agent", id: "$agent" }.
// Starts `vite` on port 5190 (GENESIS_FROZEN=1: no HMR, so edits elsewhere never reload a page mid-shot) unless one
// is already serving there; saves PNGs to _shots/ and a JSON report (console errors, fps, timings) to
// _shots/report.json. Exit code 1 if any shot failed or any console error was seen.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '_shots');
// port: --port=N (or GENESIS_PORT); 5190 by default. Lanes working in parallel each use their own (UI 5193, audio 5194,
// visual fixes 5196–5198), so their dev servers and captures never share a page.
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '').slice(7) || process.env.GENESIS_PORT || 5190);
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
  { name: 'sunset', params: 'source=lookdev', camera: { mode: 'surface', poi: 'coast', alt: 30, pitch: 2, sunElevation: 4, faceSun: true }, frames: 10 },
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
        const vars = (window.__shotVars ??= { created: null });
        // "$poi:<name>" and "$created" substitution (see the header)
        const subst = (v) => {
          if (typeof v === 'string') {
            // named values ($created, and whatever a command kept with "as"), longest names first; then POIs, so
            // "$poi:settlement:$plains" works
            const names = Object.keys(vars).sort((a, b) => b.length - a.length);
            for (const k of names) if (v === `$${k}`) return vars[k];
            let out = v;
            for (const k of names) if (out.includes(`$${k}`)) out = out.split(`$${k}`).join(String(vars[k]));
            if (out.startsWith('$poi:')) { const p = G.poi(out.slice(5)); if (!p) throw new Error(`no POI '${out.slice(5)}'`); return p.pos; }
            return out;
          }
          if (Array.isArray(v)) return v.map(subst);
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x)]));
          return v;
        };
        const refOf = (sel) => {
          if (!sel) return null;
          if (typeof sel === 'object') return subst(sel);
          const [kind, what] = String(subst(sel)).split(':');
          if (kind === 'agent' && what === 'nearest') { const a = G.agents(1)[0]; return a ? { kind: 'agent', id: a.id } : null; }
          if (kind === 'building' && what === 'nearest') { const a = G.buildings(1)[0]; return a ? { kind: 'building', id: a.id } : null; }
          return { kind, id: Number(what) };
        };
        G.ui(!!spec.ui);
        // toasts outlive the seconds a software-rendered frame takes
        G.toastLife(spec.toastLife ?? 120000);
        if (spec.exposure != null) G.exposure(spec.exposure);
        else G.exposure(0);
        // the world first (commands, then time), then the camera: a camera `hour` must land after the stepping, or a
        // world whose day is not 24 h would be photographed at whatever hour the steps left it
        const results = [];
        for (const c0 of spec.commands ?? []) {
          const { as, ...c1 } = c0;
          const c = subst(c1);
          const r = await G.cmd(c);
          results.push({ k: c.k, ok: r.ok, msg: r.msg });
          const made = (r.created ?? []).find((e) => e.kind === 'settlement') ?? (r.created ?? [])[0];
          if (made) { vars.created = made.id; if (as) vars[as] = made.id; }
        }
        if (spec.wait) await G.step(spec.wait);
        let ran = null;
        if (spec.run) {
          const t0 = G.state().tick;
          G.setSpeed(spec.run.speed ?? 100);
          await new Promise((ok) => setTimeout(ok, (spec.run.seconds ?? 10) * 1000));
          const st = G.state();
          ran = { speed: spec.run.speed ?? 100, seconds: spec.run.seconds ?? 10, ticks: Math.round(st.tick - t0), achievedSpeed: st.achievedSpeed };
          if (!spec.run.keep) G.setSpeed(0);
        }
        if (spec.pick) {
          const [kind, scope, sid] = String(subst(spec.pick)).split(':');
          if (kind === 'agent' && scope === 'settlement') {
            const list = (await G.query('agents', { settlement: Number(sid) })) ?? [];
            vars.agent = list.length ? list[0].id : null;
            if (vars.agent == null) throw new Error(`nobody lives in settlement ${sid}`);
          }
        }
        if (spec.camera) await G.camera(subst(spec.camera));
        if (spec.follow) G.follow(refOf(spec.follow));
        if (spec.select !== undefined) {
          // people are pickable once drawn: let a frame or two place them first
          await G.frames(2);
          G.select(refOf(spec.select));
        }
        let clicked = null;
        if (spec.click) {
          // a real click on what is drawn there (picking end to end): "agent:nearest" / "building:nearest" or [x, y]
          await G.frames(2);
          let xy = Array.isArray(spec.click) ? spec.click : null;
          if (!xy) { const l = String(spec.click).startsWith('building') ? G.buildings(1) : G.agents(1); xy = l[0]?.screen ?? null; }
          if (xy) { G.click(xy[0], xy[1]); clicked = { at: xy, selected: G.state().selected }; }
        }
        // script?: a string of JS run in the page as an async function (G = window.__GENESIS__, vars) after the camera,
        // select and click: drives the UI for a shot (open the palette, type, arm a tool, open a panel...)
        let scripted = null;
        if (spec.script) {
          const AsyncFunction = Object.getPrototypeOf(async function () { /* */ }).constructor;
          scripted = await new AsyncFunction('G', 'vars', Array.isArray(spec.script) ? spec.script.join('\n') : spec.script)(G, vars);
        }
        const t = performance.now();
        await G.frames(spec.frames ?? 6);
        const ms = (performance.now() - t) / Math.max(1, spec.frames ?? 6);
        let path = null;
        if (spec.canvasOnly) path = await G.shot(spec.name);
        const st = G.state();
        let chronicle = null;
        if (spec.chronicle) {
          const all = (await G.query('chronicle', {})) ?? [];
          chronicle = (typeof spec.chronicle === 'number' ? all.slice(-spec.chronicle) : all).map((e) => `[${e.kind}] Year ${e.year}, day ${e.day}: ${e.text}`);
        }
        return { path, msPerFrame: ms, results, ran, clicked, chronicle, scripted, state: { tick: st.tick, camera: st.camera, render: st.render, source: st.source, life: st.life, selected: st.selected, planets: st.planets } };
      }, s);
      let file = result.path;
      if (!s.canvasOnly) {
        file = resolve(SHOTS, `${s.name}.png`);
        await page.screenshot({ path: file });
      }
      const newErrors = errors.slice(before);
      report.shots.push({ name: s.name, file, url, ms: Date.now() - t0, msPerFrame: Math.round(result.msPerFrame), tick: result.state.tick, commands: result.results, render: result.state.render, camera: result.state.camera, life: result.state.life, selected: result.state.selected, planets: result.state.planets, errors: newErrors });
      if (result.state.life) console.log(`  life: ${JSON.stringify(result.state.life)}${result.state.selected ? ` · selected ${JSON.stringify(result.state.selected)}` : ''}`);
      if (result.clicked) console.log(`  clicked ${JSON.stringify(result.clicked.at.map((v) => Math.round(v)))} → selected ${JSON.stringify(result.clicked.selected)}`);
      if (result.scripted != null) console.log(`  script → ${JSON.stringify(result.scripted).slice(0, 400)}`);
      if (result.ran) console.log(`  ran ${result.ran.seconds} s at ${result.ran.speed}×: ${result.ran.ticks} ticks, achieved ×${Number(result.ran.achievedSpeed).toFixed(1)}`);
      report.shots[report.shots.length - 1].ran = result.ran;
      for (const r of result.results) console.log(`  cmd ${r.k}: ${r.ok ? 'ok' : 'REFUSED'} — ${r.msg ?? ''}`);
      if (result.chronicle) {
        writeFileSync(resolve(SHOTS, `${s.name}.chronicle.txt`), result.chronicle.join('\n') + '\n');
        console.log(`  chronicle (${result.chronicle.length} entries):`);
        for (const line of result.chronicle) console.log(`    ${line}`);
        report.shots[report.shots.length - 1].chronicle = result.chronicle;
      }
      for (const r of result.results) if (!r.ok) report.consoleErrors.push({ shot: s.name, error: `command ${r.k} refused: ${r.msg}` });
      for (const e of newErrors) report.consoleErrors.push({ shot: s.name, error: e });
      console.log(`  → ${file} (${((Date.now() - t0) / 1000).toFixed(1)} s, ${Math.round(result.msPerFrame)} ms/frame, ${result.state.render.triangles} tris, ${result.state.render.drawCalls} draws)`);
    } catch (e) {
      failed++;
      console.log(`  FAILED: ${e && e.stack || e}`);
      report.shots.push({ name: s.name, url, error: String(e && e.message || e) });
    }
  }
  for (const { errors } of pages.values()) {
    // errors raised during boot belong to no shot
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

