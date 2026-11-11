#!/usr/bin/env node
// PERF lane — scripted play probe on the BUILT game (static server over a dist dir), headless Chromium / SwiftShader.
// SwiftShader renders on the CPU in the GPU process, so frame INTERVALS are meaningless; what this measures is the
// main thread: the rAF callback's own time per frame (distribution), tasks outside frames (worker messages: clone +
// apply), GL calls per frame by kind (draws, programs, uniforms, buffer / texture upload bytes, SYNCHRONOUS calls that
// stall the GPU pipe on a real GPU), renderer.info, and a V8 CPU profile (self time by function, GC).
//
//   node _harness/arc-work/perf-play.mjs --dist=dist --quality=high --size=888x500 --scenes=orbit,region,town \
//        --speeds=1,100,3000 --frames=40 [--gl=1] [--profile=1] [--save=path.gnss] [--people=0] [--pan=1] [--out=x.json]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const DIST = resolve(ROOT, opts.dist ?? 'dist');
const quality = opts.quality ?? 'high';
const [vw, vh] = String(opts.size ?? '888x500').split('x').map(Number);
const dpr = Number(opts.dpr ?? 1);
const scenes = (opts.scenes ?? 'orbit,region,town').split(',');
const speeds = (opts.speeds ?? '1').split(',').map(Number);
const nFrames = Number(opts.frames ?? 30);
const glCount = opts.gl === '1' || opts.gl === 'true';
const profile = opts.profile === '1' || opts.profile === 'true';
const pan = opts.pan !== '0';
const outFile = resolve(ROOT, opts.out ?? `_harness/scratch/arc/perf/play-${quality}-${vw}x${vh}.json`);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (p === '/__save' && opts.save) { res.setHeader('content-type', 'application/octet-stream'); res.end(readFileSync(resolve(ROOT, opts.save))); return; }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', MIME[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const PORT = server.address().port;

// ── in-page instrumentation (before any app code) ──
const INIT = `(() => {
  const P = window.__PERFPLAY__ = { frames: [], tasks: [], on: false, gl: ${glCount}, c: null };
  const zero = () => ({ draw: 0, inst: 0, prog: 0, unif: 0, bufB: 0, bufN: 0, texB: 0, texN: 0, fbo: 0, sync: 0, syncNames: {}, compile: 0, state: 0 });
  P.c = zero();
  if (P.gl) {
    const G = WebGL2RenderingContext.prototype;
    const wrap = (name, fn) => { const o = G[name]; if (typeof o !== 'function') return; G[name] = function (...a) { fn(P.c, a); return o.apply(this, a); }; };
    for (const n of ['drawArrays', 'drawElements']) wrap(n, (c) => { c.draw++; });
    for (const n of ['drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) wrap(n, (c) => { c.draw++; c.inst++; });
    wrap('useProgram', (c) => { c.prog++; });
    for (const n of Object.getOwnPropertyNames(G)) if (/^uniform/.test(n) && n !== 'uniformBlockBinding') wrap(n, (c) => { c.unif++; });
    const bytes = (x) => (x && x.byteLength) || 0;
    // --stacks=1: who uploads (buffer / texture bytes by JS call site, while measuring)
    P.stacks = ${opts.stacks === '1'}; P.stk = {};
    const site = (kind, b) => { if (!P.stacks || !P.on) return; const st = (new Error().stack || '').split(String.fromCharCode(10)).slice(3, 9).map((l) => l.trim().replace('at ', '').replace(/https?:[^)]*[/]assets[/]/, '').replace(/[?][^:]*/, '')).join(' < '); const k = kind + ' ' + st; const e = P.stk[k] || (P.stk[k] = { n: 0, b: 0 }); e.n++; e.b += b; };
    wrap('bufferData', (c, a) => { const b = typeof a[1] === 'number' ? a[1] : bytes(a[1]); c.bufN++; c.bufB += b; site('bufData', b); });
    wrap('bufferSubData', (c, a) => { const b = a[4] != null ? a[4] * (a[2]?.BYTES_PER_ELEMENT || 1) : bytes(a[2]); c.bufN++; c.bufB += b; site('bufSub', b); });
    for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'copyTexSubImage2D']) wrap(n, (c, a) => { c.texN++; let b = 0; for (const x of a) if (x && typeof x === 'object' && 'byteLength' in x) b += x.byteLength; else if (x && typeof x === 'object' && 'width' in x) b += x.width * x.height * 4; c.texB += b; site(n, b); });
    wrap('bindFramebuffer', (c) => { c.fbo++; });
    for (const n of ['enable', 'disable', 'blendFunc', 'blendFuncSeparate', 'depthMask', 'depthFunc', 'colorMask', 'cullFace', 'viewport', 'scissor', 'bindTexture', 'activeTexture', 'bindVertexArray', 'bindBuffer']) wrap(n, (c) => { c.state++; });
    for (const n of ['compileShader', 'linkProgram']) wrap(n, (c) => { c.compile++; });
    for (const n of ['getParameter', 'getError', 'readPixels', 'getProgramParameter', 'getShaderParameter', 'getUniformLocation', 'getAttribLocation', 'checkFramebufferStatus', 'getExtension', 'getContextAttributes', 'getShaderPrecisionFormat', 'getProgramInfoLog', 'getShaderInfoLog', 'getBufferSubData', 'clientWaitSync', 'getSyncParameter', 'getQueryParameter', 'getActiveUniform', 'getActiveAttrib', 'getUniformBlockIndex', 'getActiveUniformBlockParameter', 'getIndexedParameter', 'isContextLost', 'getSupportedExtensions', 'getFramebufferAttachmentParameter', 'getTexParameter', 'finish']) wrap(n, (c) => { c.sync++; c.syncNames[n] = (c.syncNames[n] || 0) + 1; });
  }
  P.passes = ${opts.passes === '1'}; P.pass = {}; P.passN = 0;
  if (P.passes) {
    const G = WebGL2RenderingContext.prototype;
    const bind = G.bindFramebuffer, fin = G.finish, getP = G.getParameter, draws = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
    let cur = null, t0 = 0, drew = 0, vp = '';
    const ext = { md: null };
    const close = (gl) => { if (!P.on || !drew) { drew = 0; return; } fin.call(gl); const now = performance.now(); const k = vp; const e = P.pass[k] || (P.pass[k] = { ms: 0, n: 0, draws: 0 }); e.ms += now - t0; e.n++; e.draws += drew; drew = 0; };
    G.bindFramebuffer = function (t, f) { if (f !== cur) { close(this); cur = f; t0 = performance.now(); } return bind.call(this, t, f); };
    for (const n of draws) { const o = G[n]; G[n] = function (...a) { if (!drew) { const v = getP.call(this, this.VIEWPORT); vp = (cur ? (cur.__id || (cur.__id = 'fb' + (++P.passN))) : 'canvas') + ' ' + v[2] + 'x' + v[3]; if (!t0) t0 = performance.now(); } drew++; return o.apply(this, a); }; }
    const ge = G.getExtension; G.getExtension = function (n) { const e = ge.call(this, n); if (e && n === 'WEBGL_multi_draw' && !e.__w) { e.__w = 1; for (const m of ['multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL']) { const o = e[m]; if (o) e[m] = function (...a) { if (!drew) { const gl = P.glctx; if (gl) { const v = getP.call(gl, gl.VIEWPORT); vp = (cur ? (cur.__id || (cur.__id = 'fb' + (++P.passN))) : 'canvas') + ' ' + v[2] + 'x' + v[3]; } } drew++; P.c.draw++; P.c.multi = (P.c.multi || 0) + 1; return o.apply(this, a); }; } } P.glctx = this; return e; };
    P.closePass = () => { const gl = P.glctx; if (gl) close(gl); t0 = 0; };
  }
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (!P.on) { cb(t); return; }
    P.c = zero();
    const s = performance.now();
    cb(t);
    if (P.closePass) P.closePass();
    const e = performance.now();
    P.frames.push({ work: e - s, interval: last ? t - last : 0, gl: P.gl ? P.c : null });
    last = t;
  });
  // worker messages: the structured-clone read (first touch of e.data) and the handler, separately
  const W = Worker.prototype;
  const d = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'onmessage') || null;
  Object.defineProperty(W, 'onmessage', { configurable: true, set(fn) {
    this.__pp = fn;
    this.addEventListener('message', (ev) => {
      const s = performance.now();
      const data = ev.data;
      const m = performance.now();
      this.__pp && this.__pp.call(this, ev);
      const e = performance.now();
      if (P.on) P.tasks.push({ t: s, clone: m - s, handle: e - m, kind: (data && (data.t || data.type || data.kind)) || '?' });
    });
  }, get() { return this.__pp; } });
})();`;

const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const scenario = opts.scenario ?? 'sandbox';
const url = `http://127.0.0.1:${PORT}/?scenario=${scenario}&quality=${quality}&intro=0&speed=0${opts.ui === '0' ? '&ui=0' : ''}${opts.extra ? '&' + opts.extra : ''}`;
const T0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__GENESIS__);
await page.evaluate(() => window.__GENESIS__.ready);
const bootS = (Date.now() - T0) / 1000;
console.log(`boot ${bootS.toFixed(1)} s  ${quality} ${vw}x${vh}@${dpr}`);

let world = 'fresh';
if (opts.save) {
  const ok = await page.evaluate(async () => { const G = window.__GENESIS__; const b = await (await fetch('/__save')).arrayBuffer(); const r = await G.worlds_.saves.importFile(b, 'perf.gnss'); return r; });
  // the page may reload into the save (?load=<slot>): wait for the loaded world, whichever page it is on
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => { try { const G = window.__GENESIS__; return !!G && G.state().tick > 1000; } catch { return false; } }, null, { timeout: 900000, polling: 1000 });
  await page.evaluate(() => window.__GENESIS__.ready);
  console.log('loaded', page.url(), ((Date.now() - T0) / 1000).toFixed(0), 's');
  world = 'save:' + opts.save;
  console.log('import', ok, JSON.stringify(await page.evaluate(() => { const s = window.__GENESIS__.state(); return { tick: s.tick, agents: s.planets?.[0]?.agents, buildings: s.planets?.[0]?.buildings }; })));
}
const firstSettlement = await page.evaluate(() => { const s = window.__GENESIS__.state(); const l = (s.planets?.[0]?.settlements ?? []).slice().sort((a, b) => (b.pop ?? b.population ?? 0) - (a.pop ?? a.population ?? 0)); return l[0]?.id ?? null; }).catch(() => null);
console.log('settlement', firstSettlement, JSON.stringify(await page.evaluate(() => { const p = window.__GENESIS__.state().planets?.[0] ?? {}; return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? `[${v.length}]` : typeof v === 'object' ? '{}' : v])); })).slice(0, 600));

const CAM = {
  orbit: { mode: 'orbit', lat: 12, lon: -30, dist: 7600, hour: 10 },
  region: { mode: 'orbit', poi: firstSettlement != null ? `settlement:${firstSettlement}` : 'city', dist: 1400, tilt: 40, hour: 10 },
  town: { mode: 'orbit', poi: firstSettlement != null ? `settlement:${firstSettlement}` : 'city', dist: 150, tilt: 52, hour: 10 },
  street: { mode: 'surface', poi: 'coast', alt: 40, pitch: -3, hour: 10 },
};
// low-sun views (PERF F11: long evening shadows must survive the shadow-reach culling); --hour=H overrides
CAM.regionlow = { ...CAM.region, hour: Number(opts.hour ?? 17.6) };
CAM.townlow = { ...CAM.town, hour: Number(opts.hour ?? 17.6) };
// pop-in descent over a forest (PERF P2): each scene flies (blend s) from the previous one, shot early and settled
for (const d of [1200, 600, 350, 200, 120]) CAM['f' + d] = { mode: 'orbit', poi: 'forest', dist: d, tilt: 50, hour: 10, blend: Number(opts.blend ?? 1.5) };
CAM.ridgelow = { mode: 'orbit', poi: 'peak', dist: 1800, tilt: 30, hour: Number(opts.hour ?? 17.6) };

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (a) => ({ n: a.length, mean: a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? Math.max(...a) : 0, over16: a.filter((x) => x > 16.7).length, over33: a.filter((x) => x > 33).length, over50: a.filter((x) => x > 50).length });

const results = [];
for (const sc of scenes) {
  await page.evaluate((c) => window.__GENESIS__.camera(c), CAM[sc]);
  // --early=N: a shot N frames after the move too (what the player sees while things stream in)
  if (opts.early && opts.shot) { mkdirSync(dirname(resolve(ROOT, opts.shot)), { recursive: true }); await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.early)); await page.screenshot({ path: resolve(ROOT, `${opts.shot}-${sc}-early.png`) }); }
  await page.evaluate((n) => window.__GENESIS__.frames(n), Number(opts.settle ?? 6));
  if (opts.shot) { mkdirSync(dirname(resolve(ROOT, opts.shot)), { recursive: true }); await page.screenshot({ path: resolve(ROOT, `${opts.shot}-${sc}.png`) }); }
  console.log('scene', sc, 'settled', ((Date.now() - T0) / 1000).toFixed(0), 's');
  // --report=MS: the in-game performance report (render/perfreport.ts) over MS of frames, printed as the player gets it
  if (opts.report) { const txt = await page.evaluate((ms) => window.__GENESIS__.perfReport(ms), Number(opts.report)); console.log('REPORT ' + sc + '\n' + txt + '\nEND REPORT'); }
  for (const sp of speeds) {
    await page.evaluate((s) => { window.__GENESIS__.setSpeed(s); }, sp);
    await page.evaluate(() => window.__GENESIS__.frames(3));
    await page.evaluate(() => { const P = window.__PERFPLAY__; P.frames.length = 0; P.tasks.length = 0; P.on = true; window.__GENESIS__.perf(true); });
    if (opts.attrs === '1') await page.evaluate(() => {
      // --attrs=1: which scene objects re-upload or replace their vertex data while we measure (by object path)
      const R = globalThis.__GENESIS_R__; const seen = new Map();
      const path = (o) => { const a = []; for (let x = o; x && a.length < 5; x = x.parent) a.push(x.name || x.type); return a.reverse().join('/'); };
      R.scene.traverse((o) => { const g = o.geometry; if (!g) return; const at = { ...g.attributes }; if (g.index) at.index = g.index; if (o.instanceMatrix) at.instanceMatrix = o.instanceMatrix; if (o.instanceColor) at.instanceColor = o.instanceColor; seen.set(o, { geo: g, at: Object.fromEntries(Object.entries(at).map(([k, v]) => [k, { a: v, v: v.version }])) }); });
      const tex = new Map();
      const texOf = (o, cb) => { const ms = o.material; for (const m of (Array.isArray(ms) ? ms : ms ? [ms] : [])) { for (const [k, u] of Object.entries(m.uniforms || {})) { const v = u && u.value; if (v && v.isTexture) cb(v, path(o) + ' ' + k); } for (const k of ['map', 'normalMap']) if (m[k] && m[k].isTexture) cb(m[k], path(o) + ' ' + k); } };
      R.scene.traverse((o) => texOf(o, (t, name) => { if (!tex.has(t)) tex.set(t, { v: t.version, name }); }));
      window.__PERFPLAY__.attrs0 = { seen, path, tex, texOf };
      // draws by target and object (rough triangles: index or position count / 3 × instances; BatchedMesh = its live slots' total)
      const T = R.three, orig = T.renderBufferDirect.bind(T), dr = {}; window.__PERFPLAY__.draws = dr;
      T.renderBufferDirect = (cam, scene, geo, mat, obj, group) => { const rt = T.getRenderTarget(); const tgt = cam.isOrthographicCamera ? 'shadow' : rt ? 'rt' + rt.width + 'x' + rt.height : 'canvas';
        const n = (geo.index ? geo.index.count : geo.attributes.position ? geo.attributes.position.count : 0) / 3; const inst = obj.isInstancedMesh ? obj.count : obj.isBatchedMesh ? 1 : (geo.instanceCount ?? 1);
        const k = tgt + ' ' + path(obj) + ' [' + (mat.name || mat.type) + ']'; const e = dr[k] || (dr[k] = { n: 0, t: 0 }); e.n++; e.t += (obj.isBatchedMesh ? Math.min(n, (geo.drawRange.count === Infinity ? n * 3 : geo.drawRange.count) / 3) : n) * (inst === Infinity ? 1 : inst); return orig(cam, scene, geo, mat, obj, group); };
      window.__PERFPLAY__.undraw = () => { T.renderBufferDirect = orig; };
    });
    if (opts.heap === '1') { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
    if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    const t0 = Date.now();
    // --panreport=MS: the in-game report (with the GL call trace) recorded DURING the measured, panned frames
    if (opts.panreport) await page.evaluate((ms) => { window.__PANREP__ = window.__GENESIS__.perfReport(ms); }, Number(opts.panreport));
    // pan / zoom while measuring: drags across the canvas and wheel steps, between frames
    let k = 0;
    while (true) {
      const n = await page.evaluate(() => window.__PERFPLAY__.frames.length);
      if (n >= nFrames) break;
      if (pan) {
        const x = vw / 2 + Math.sin(k) * vw * 0.2, y = vh / 2 + Math.cos(k * 0.7) * vh * 0.15;
        await page.mouse.move(x, y);
        if (k % 6 < 3) { await page.mouse.down(); await page.mouse.move(x + 30, y + 8, { steps: 3 }); await page.mouse.up(); }
        else await page.mouse.wheel(0, k % 2 ? 60 : -60);
      }
      await page.evaluate(() => window.__GENESIS__.frames(1));
      k++;
    }
    if (opts.panreport) { const txt = await page.evaluate(() => window.__PANREP__); console.log('PANREPORT ' + sc + ' ' + sp + '\n' + txt + '\nEND REPORT'); }
    if (opts.attrs === '1') { const rows = await page.evaluate(() => {
      const R = globalThis.__GENESIS_R__; const { seen, path } = window.__PERFPLAY__.attrs0; const agg = {};
      const add = (o, what, b) => { const k = path(o) + ' ' + what; const e = agg[k] || (agg[k] = { n: 0, b: 0 }); e.n++; e.b += b; };
      R.scene.traverse((o) => { const g = o.geometry; if (!g) return; const old = seen.get(o);
        if (!old) { add(o, 'NEW OBJECT', 0); return; }
        if (old.geo !== g) add(o, 'NEW GEOMETRY', 0);
        const at = { ...g.attributes }; if (g.index) at.index = g.index; if (o.instanceMatrix) at.instanceMatrix = o.instanceMatrix; if (o.instanceColor) at.instanceColor = o.instanceColor;
        for (const [k, v] of Object.entries(at)) { const was = old.at[k]; const b = v.array ? v.array.byteLength : 0;
          if (!was || was.a !== v) add(o, 'new attr ' + k, b); else if (v.version !== was.v) add(o, 'upd ' + k + ' x' + (v.version - was.v), b * Math.min(1, v.version - was.v)); } });
      const { tex, texOf } = window.__PERFPLAY__.attrs0; const done = new Set();
      R.scene.traverse((o) => texOf(o, (t, name) => { if (done.has(t)) return; done.add(t); const was = tex.get(t); const img = t.image || {}; const b = img.data ? img.data.byteLength : (img.width || 0) * (img.height || 0) * 4;
        if (was && t.version !== was.v) { const k = 'TEX ' + name + ' ' + (img.width || '?') + 'x' + (img.height || '?') + ' x' + (t.version - was.v); agg[k] = { n: t.version - was.v, b: b * (t.version - was.v) }; } }));
      return Object.entries(agg).sort((a, b) => b[1].b - a[1].b).slice(0, 90); });
      const dr = await page.evaluate(() => { const P = window.__PERFPLAY__; P.undraw(); return Object.entries(P.draws).sort((a, b) => b[1].t - a[1].t).slice(0, 40); });
      console.log('   draws by target/object (per frame: calls, k tris; BatchedMesh rough):'); for (const [k2, v] of dr) console.log(`     ${(v.n / Math.max(1, nFrames)).toFixed(1).padStart(6)}  ${(v.t / Math.max(1, nFrames) / 1000).toFixed(0).padStart(6)}k  ${k2.slice(0, 160)}`);
      console.log('   attribute churn over the measured frames (object, what, kB of one copy):'); for (const [k2, v] of rows) console.log(`     ${(v.b / 1024).toFixed(0).padStart(7)} kB ${String(v.n).padStart(4)}x  ${k2.slice(0, 200)}`); }
    if (opts.heap === '1') {
      // allocation sampling: bytes allocated per frame by the allocating function (self), live or already collected
      const { profile: hp } = await cdp.send('HeapProfiler.stopSampling', {});
      await cdp.send('HeapProfiler.disable');
      const agg = new Map();
      const walk = (n, chain) => { const cf = n.callFrame; const name = `${cf.functionName || '(anon)'} ${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}`; const ch = [name, ...chain].slice(0, 4); if (n.selfSize) { const k = ch.join(' < '); agg.set(k, (agg.get(k) || 0) + n.selfSize); } for (const c of n.children || []) walk(c, ch); };
      walk(hp.head, []);
      const nF = Math.max(1, nFrames);
      // (sampled: live-object sizes of the samples taken, a fair estimate of the allocation rate per site)
      console.log('   heap samples by site (kB per frame):');
      for (const [k2, v] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`     ${(v / nF / 1024).toFixed(1).padStart(8)}  ${k2.slice(0, 300)}`);
    }
    let prof = null;
    if (profile) { prof = (await cdp.send('Profiler.stop')).profile; await cdp.send('Profiler.disable'); }
    const data = await page.evaluate(() => { const P = window.__PERFPLAY__; P.on = false; const G = window.__GENESIS__; const st = G.state(); return { pass: P.pass, frames: P.frames, tasks: P.tasks, perf: G.perf(), state: { tick: st.tick, agents: st.planets?.[0]?.agents, buildings: st.planets?.[0]?.buildings, achieved: st.achievedSpeed, render: st.render } }; });
    await page.evaluate(() => window.__GENESIS__.setSpeed(0));
    const fr = data.frames.slice(1);
    const work = fr.map((f) => f.work);
    const snaps = data.tasks;
    const r = {
      scene: sc, speed: sp, quality, size: `${vw}x${vh}@${dpr}`, world, wallS: (Date.now() - t0) / 1000,
      work: stat(work), interval: stat(fr.map((f) => f.interval)),
      slots: data.perf.slots, programs: data.perf.programs, newPrograms: data.perf.newPrograms,
      msgs: { n: snaps.length, clone: stat(snaps.map((s) => s.clone)), handle: stat(snaps.map((s) => s.handle)), kinds: [...new Set(snaps.map((s) => s.kind))] },
      state: data.state,
    };
    if (glCount && fr.length) {
      const keys = ['draw', 'inst', 'prog', 'unif', 'bufB', 'bufN', 'texB', 'texN', 'fbo', 'sync', 'compile', 'state'];
      r.gl = Object.fromEntries(keys.map((k2) => [k2, +(fr.reduce((a, f) => a + f.gl[k2], 0) / fr.length).toFixed(1)]));
      r.gl.maxBufB = Math.max(...fr.map((f) => f.gl.bufB)); r.gl.maxTexB = Math.max(...fr.map((f) => f.gl.texB));
      const sn = {}; for (const f of fr) for (const [k2, v] of Object.entries(f.gl.syncNames)) sn[k2] = (sn[k2] || 0) + v / fr.length;
      r.gl.syncNames = Object.fromEntries(Object.entries(sn).map(([k2, v]) => [k2, +v.toFixed(2)]));
    }
    if (prof) {
      const self = new Map(); const dtSum = prof.timeDeltas.reduce((a, b) => a + b, 0);
      const byId = new Map(prof.nodes.map((n) => [n.id, n]));
      const cnt = new Map(); for (const s of prof.samples) cnt.set(s, (cnt.get(s) || 0) + 1);
      const per = dtSum / Math.max(1, prof.samples.length) / 1000;
      for (const [id, c] of cnt) { const n = byId.get(id); const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + c * per); }
      const tot = [...self.values()].reduce((a, b) => a + b, 0);
      const idle = self.get('(idle) :0') || 0;
      r.profile = { totalMs: +tot.toFixed(0), idleMs: +idle.toFixed(0), gcMs: +(self.get('(garbage collector) :0') || 0).toFixed(1), top: [...self.entries()].filter(([k2]) => !k2.startsWith('(idle)') && !k2.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k2, v]) => [k2, +(v / Math.max(1, fr.length)).toFixed(2)]) };
      writeFileSync(outFile.replace(/\.json$/, `-${sc}-${sp}.cpuprofile`), JSON.stringify(prof));
    }
    if (opts.passes === '1') { r.passes = Object.fromEntries(Object.entries(data.pass).map(([k, v]) => [k, { msPerFrame: +(v.ms / Math.max(1, data.frames.length)).toFixed(1), drawsPerFrame: +(v.draws / Math.max(1, data.frames.length)).toFixed(1), binds: +(v.n / Math.max(1, data.frames.length)).toFixed(1) }]).sort((a, b) => b[1].msPerFrame - a[1].msPerFrame)); console.log('   passes', JSON.stringify(r.passes)); await page.evaluate(() => { window.__PERFPLAY__.pass = {}; }); }
    results.push(r);
    const w = r.work;
    console.log(`${sc.padEnd(7)} ${String(sp).padStart(5)}x  work mean ${w.mean.toFixed(1)} p50 ${w.p50.toFixed(1)} p95 ${w.p95.toFixed(1)} p99 ${w.p99.toFixed(1)} max ${w.max.toFixed(1)} >16:${w.over16} >33:${w.over33} >50:${w.over50} /${w.n}  | msgs ${r.msgs.n} clone p95 ${r.msgs.clone.p95.toFixed(1)} max ${r.msgs.clone.max.toFixed(1)} handle p95 ${r.msgs.handle.p95.toFixed(1)} max ${r.msgs.handle.max.toFixed(1)} | interval p50 ${r.interval.p50.toFixed(0)} | prog +${r.newPrograms}` +
      (r.gl ? ` | gl draw ${r.gl.draw} prog ${r.gl.prog} unif ${r.gl.unif} buf ${(r.gl.bufB / 1024).toFixed(0)}k/${r.gl.bufN} tex ${(r.gl.texB / 1024).toFixed(0)}k/${r.gl.texN} sync ${r.gl.sync} ${JSON.stringify(r.gl.syncNames)}` : ''));
    console.log('   slots', JSON.stringify(Object.fromEntries(Object.entries(r.slots).filter(([, v]) => v > 0.05).map(([k2, v]) => [k2, +v.toFixed(2)]))), 'render', JSON.stringify(r.state.render));
    if (opts.stacks === '1') { const stk = await page.evaluate(() => { const P = window.__PERFPLAY__; const o = P.stk || {}; P.stk = {}; return o; }); const nF = Math.max(1, nFrames); console.log('   uploads by site (per frame):'); for (const [k2, v] of Object.entries(stk).sort((a, b) => b[1].b - a[1].b).slice(0, 25)) console.log(`     ${(v.b / nF / 1024).toFixed(0).padStart(7)} kB ${(v.n / nF).toFixed(1).padStart(6)}x  ${k2.slice(0, 400)}`); }
    if (r.profile) console.log('   profile gc', r.profile.gcMs, 'ms; top/frame:', r.profile.top.slice(0, 14).map(([k2, v]) => `${k2}=${v}`).join(' | '));
  }
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ quality, size: [vw, vh, dpr], bootS, results, errors: errors.slice(0, 20) }, null, 2));
console.log('errors', errors.length, errors.slice(0, 3));
await browser.close();
server.close();
