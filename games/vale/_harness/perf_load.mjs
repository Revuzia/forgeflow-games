// VALE harness — W4-C load and weak-device diagnostics (owner 2026-11-24: "the game froze their computer ... we need
// faster loading so everyone can use the game"). Measures a SERVED client (the live build mirrored in ./deploy, or any
// other build) in real Chrome under a device profile, with no dev handle (real clicks only), and prints one JSON table.
//
//   node _harness/perf_load.mjs --url http://localhost:5199/ --profile weak [--journey home|practice|coop] [--sec 30]
//        [--calibrate] [--tier low|medium|high|ultra] [--ctxloss] [--dump-shaders <dir>] [--out <json>] [--max-min 12]
//        [--query "fakegpu=<renderer string>&diag=1"]   extra page parameters
//   node _harness/perf_load.mjs --serve deploy [--port 5199] ...      serve a folder like the live CDN, then measure it
//   node _harness/perf_load.mjs --serve-only deploy [--mount /bench=<dir>]   only serve (Ctrl-C stops)
//   node _harness/perf_load.mjs --bench <render_bench URL> --profile weak --tiers low,medium,high [--t 600] [--sec 12]
//   node _harness/perf_load.mjs --plan baseline --serve deploy [--bench-dir <built bench dist>] --out <json>
//
// PROFILES (state exactly what ran; every profile is a cold, cache-disabled visit from a fresh browser profile):
//   fast         GPU (ANGLE Metal on a Mac), no CPU or network throttle, 1366x768, DPR 1
//   weak         GPU, CPU throttled 4x (CDP Emulation.setCPUThrottlingRate), network 20 Mbit/s down, 5 up, 40 ms RTT
//                (CDP Network.emulateNetworkConditions), 1366x768, DPR 1
//   weak6        as weak with the CPU throttled 6x
//   swiftshader  software WebGL (--use-angle=swiftshader --enable-unsafe-swiftshader), CPU 4x, network as weak
//   nogpu        --disable-gpu (no unsafe SwiftShader: Chrome's own answer on a machine whose GPU is blocked)
// --serve mimics the live CDN's headers (curl of forgeflow-games-cdn on 2026-11-25): html/js/css/json/svg brotli, glb
// gzip, other binaries raw; code `no-store`, catalog `public, max-age=86400`. It counts the bytes it sends per file
// (the waterfall's ground truth) and the page's Resource Timing is read too. The page's WebSocket (vale-net) is routed
// to nothing so a measurement never shows up on the real game server.
//
// WHAT IT READS (page init scripts, below three.js, so the minified live build needs no dev handle):
//   milestones   first paint, the boot plate, Home (the nav bar), Home quiet (first 1 s with no main-thread gap over
//                150 ms after Home showed), Play/Practice screens, the loading screen, the match HUD
//   waterfall    every response by kind (code, textures, meshes, audio, fonts, data, other) and phase (before Home,
//                Home to HUD, after the HUD), bytes on the wire and requests
//   stalls       every long animation frame >= 100 ms (LoAF: its scripts, invoker, function, source position with a
//                snippet of the minified source) with the WebGL time inside it by call (texture upload, shader
//                compile/link, buffer upload, draws) and a heartbeat's event-loop gaps >= 250 ms
//   GL           every live texture/buffer/renderbuffer (fw_r4_mem_track.js), the mip chains generateMipmap adds, the
//                drawing buffer; texture classes (size x format); the GPU renderer string, extensions offered
//   shaders      every program linked: kind (SHADER_NAME / SHADER_TYPE), variants (source hash), vertex/fragment KB and lines,
//                loops and their heads, texture fetches, when linked (phase, bursts of programs handed over within 100 ms),
//                whether KHR_parallel_shader_compile's COMPLETION_STATUS was polled first (three's compileAsync) and how long the
//                blocking queries on it took (LINK_STATUS, logs, reflection = the wait for the GPU process's compile);
//                --dump-shaders <dir> writes each unique program's sources as <hash>.vert / <hash>.frag
//   heap         CDP Runtime.getHeapUsage every 2 s (peak and at each milestone); decoded audio, live ImageBitmaps
//   quality      the stored video settings and the first-run calibration verdict (--calibrate passes ?calibrate=1,
//                which the client honours under automation; without it an automated browser keeps the High default)
//   fps          rAF intervals in the match (per second, mean / p50 / p95 / worst) for --sec seconds
//   ctxloss      (--ctxloss) WEBGL_lose_context in the match: what the player sees while lost (6 s, no restore), then
//                restoreContext() and the time until frames run and the plate is gone
//   bench        (--bench) the render bench's densest fight of a live 5v5 RIFT match (bots on every seat) at each tier
//                under the profile: fps, p95, draws, triangles, render scale (dynamic resolution on, as the game)
// Exit 0 = the run completed (it reports; it does not gate), 3 = the journey broke (the report says where).

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadavg, cpus, totalmem } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as Z } from 'node:zlib';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const t00 = Date.now();
const log = (s) => process.stderr.write(`${((Date.now() - t00) / 1000).toFixed(0).padStart(5)} s  ${s}\n`);

export const PROFILES = {
  fast: { cpu: 1, net: null, gpu: 'gpu' },
  weak: { cpu: 4, net: { down: 20e6, up: 5e6, rtt: 40 }, gpu: 'gpu' },
  weak6: { cpu: 6, net: { down: 20e6, up: 5e6, rtt: 40 }, gpu: 'gpu' },
  swiftshader: { cpu: 4, net: { down: 20e6, up: 5e6, rtt: 40 }, gpu: 'swiftshader' },
  nogpu: { cpu: 4, net: { down: 20e6, up: 5e6, rtt: 40 }, gpu: 'none' },
};
const GPU_ARGS = {
  gpu: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  none: ['--disable-gpu'],
};

// ── a static server with the live CDN's headers ──────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream',
  '.cube': 'application/octet-stream', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
  '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
const BR = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const GZ = new Set(['.glb', '.wasm']);
export function serve(mounts, port) {
  const cache = new Map();
  const sent = [];
  const t0 = Date.now();
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    const m = mounts.find(([pre]) => p === pre || p.startsWith(pre.endsWith('/') ? pre : pre + '/')) ?? mounts.find(([pre]) => pre === '/');
    if (!m) { res.writeHead(404).end(); return; }
    let rel = p.slice(m[0] === '/' ? 1 : m[0].length + 1);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(m[1], rel));
    if (!file.startsWith(m[1]) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); sent.push({ t: Date.now() - t0, path: p, status: 404, bytes: 0 }); return; }
    const ext = extname(file).toLowerCase();
    const ae = String(req.headers['accept-encoding'] ?? '');
    const enc = BR.has(ext) && /\bbr\b/.test(ae) ? 'br' : (BR.has(ext) || GZ.has(ext)) && /gzip/.test(ae) ? 'gzip' : null;
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*',
      'cache-control': /\/catalog\//.test(p) && !/manifest\.json$/.test(p) ? 'public, max-age=86400' : 'no-store, no-cache, must-revalidate, private' };
    if (enc) {
      const key = `${enc}:${file}`;
      let body = cache.get(key);
      if (!body) { const raw = readFileSync(file); body = enc === 'br' ? brotliCompressSync(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: 5 } }) : gzipSync(raw, { level: 6 }); cache.set(key, body); }
      res.writeHead(200, { ...headers, 'content-encoding': enc, 'content-length': body.length });
      res.end(body);
      sent.push({ t: Date.now() - t0, path: p, status: 200, bytes: body.length, raw: statSync(file).size, enc });
    } else {
      const size = statSync(file).size;
      res.writeHead(200, { ...headers, 'content-length': size });
      createReadStream(file).pipe(res);
      sent.push({ t: Date.now() - t0, path: p, status: 200, bytes: size, raw: size });
    }
  });
  return new Promise((ok, bad) => { srv.once('error', bad); srv.listen(port, 'localhost', () => ok({ url: `http://localhost:${port}/`, sent, reset: () => { sent.length = 0; }, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) })); });
}

export const kindOf = (url) => {
  const e = extname(new URL(url, 'http://x').pathname).toLowerCase();
  if (['.js', '.mjs', '.css', '.html'].includes(e)) return 'code';
  if (['.webp', '.png', '.jpg', '.jpeg', '.hdr', '.cube', '.ktx2', '.svg', '.avif'].includes(e)) return 'textures';
  if (['.glb', '.gltf', '.bin'].includes(e)) return 'meshes';
  if (['.m4a', '.ogg', '.mp3', '.wav', '.opus'].includes(e)) return 'audio';
  if (['.woff', '.woff2', '.ttf', '.otf'].includes(e)) return 'fonts';
  if (e === '.json') return 'data';
  return 'other';
};

// ── the page side: milestones, LoAF, heartbeat, WebGL call timing, mip chains, fps ─────────────────────────────
function pageProbe() {
  if (window.__pl) return;
  const now = () => performance.now();
  const P = window.__pl = { ms: {}, loaf: [], gaps: [], lt: [], ev: [], bins: new Map(), glTot: {}, glBig: [], ext: [], fps: null, json: [], dumpShaders: !!window.__plDump };
  try { performance.setResourceTimingBufferSize(20000); } catch { /* */ }
  const obs = (type, fn, o = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...o }); } catch { /* */ } };
  obs('long-animation-frame', (e) => { if (e.duration >= 100) P.loaf.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration ?? 0), render: e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : 0,
    scripts: (e.scripts ?? []).filter((s) => s.duration >= 10).sort((a, b) => b.duration - a.duration).slice(0, 4).map((s) => ({ ms: Math.round(s.duration), inv: String(s.invoker).slice(0, 80), type: s.invokerType, fn: s.sourceFunctionName, url: s.sourceURL, pos: s.sourceCharPosition, layout: Math.round(s.forcedStyleAndLayoutDuration ?? 0) })) }); });
  obs('longtask', (e) => { P.lt.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }); });
  obs('event', (e) => { if (e.duration >= 100) P.ev.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), name: e.name }); }, { durationThreshold: 100 });
  obs('paint', (e) => { P.ms[e.name] ??= Math.round(e.startTime); });
  // heartbeat: what the event loop let through (a gap is time nothing could run: the page did not answer input)
  let last = now();
  setInterval(() => { const t = now(); if (t - last >= 250) P.gaps.push({ t: Math.round(last), ms: Math.round(t - last) }); last = t; }, 50);
  // milestones from the DOM
  const seen = (k, ok) => { if (P.ms[k] === undefined && ok) P.ms[k] = Math.round(now()); };
  setInterval(() => {
    const q = (s) => document.querySelector(s);
    seen('ui', !!q('#ui')?.firstElementChild);
    seen('home', document.querySelectorAll('.bar .nav__item').length >= 3);
    seen('plate', !!q('[data-plate]'));
    if (q('[data-plate]') && !P.plate) P.plate = (q('[data-plate]').textContent ?? '').trim().slice(0, 300);
    seen('loading', !!q('.loading'));
    seen('hud', !!q('.hud .dbar'));
    // the screen timeline (each .scr--<name> the first time it shows)
    for (const el of document.querySelectorAll('.scr')) { const m = /scr--([\w-]+)/.exec(el.className); if (m) seen(`scr:${m[1]}`, true); }
    for (const el of document.querySelectorAll('[role="dialog"]')) seen(`dialog:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`, true);
    if (q('.viewplate')) { seen('viewplate', true); P.viewplateLast = Math.round(now()); P.viewplateText = (q('.viewplate').textContent ?? '').trim().slice(0, 200); }
    const bar = q('.loading .bar-line[aria-valuenow]');
    if (bar) { const v = Number(bar.getAttribute('aria-valuenow')); const pr = (P.progress ??= []); if (!pr.length || pr.at(-1).v !== v) pr.push({ t: Math.round(now()), v }); }
  }, 100);
  // WebGL call timing, in 50 ms bins, so a long frame can say how much of it was GL and which call
  const G = WebGL2RenderingContext.prototype;
  const add = (name, t0, ms, info) => {
    P.glTot[name] = (P.glTot[name] ?? 0) + ms;
    const b = Math.floor(t0 / 50); let m = P.bins.get(b); if (!m) P.bins.set(b, (m = {})); m[name] = (m[name] ?? 0) + ms;
    if (ms >= 30 && P.glBig.length < 400) P.glBig.push({ t: Math.round(t0), ms: Math.round(ms), fn: name, info });
  };
  const timed = (name, group = name, infoOf) => { const o = G[name]; if (typeof o !== 'function') return; G[name] = function (...a) { const t0 = now(); try { return o.apply(this, a); } finally { const ms = now() - t0; if (ms > 0.05) add(group, t0, ms, ms >= 30 && infoOf ? infoOf(a) : undefined); } }; };
  const texInfo = (a) => {
    const src = a.find((x) => x && typeof x === 'object' && 'width' in x && !(ArrayBuffer.isView(x)));
    const nums = a.filter((x) => typeof x === 'number');
    return src ? `${src.width}x${src.height} ${src.constructor?.name ?? ''}` : `${nums.slice(2, 6).join(',')} (args)`;
  };
  for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'copyTexSubImage2D']) timed(n, 'texUpload', texInfo);
  timed('generateMipmap', 'mipmap');
  for (const n of ['bufferData', 'bufferSubData']) timed(n, 'bufferUpload');
  for (const n of ['compileShader', 'linkProgram']) timed(n, 'shaderCompileCall');
  for (const n of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog']) timed(n, 'shaderCompileWait');
  for (const n of ['getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'getAttribLocation']) timed(n, 'programReflect');
  for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) timed(n, 'draw');
  for (const n of ['readPixels', 'finish', 'getError', 'clientWaitSync']) timed(n, 'sync');
  // every shader program: its sources (as handed to the driver, after three's own unrolling), when it was linked, whether
  // the caller polled KHR_parallel_shader_compile's COMPLETION_STATUS (three's compileAsync) before the first blocking
  // query, and how long the blocking queries on it took (LINK_STATUS, info logs, uniform/attribute reflection: on Chrome
  // the first of these waits for the GPU process to finish translating and compiling the program)
  const shSrc = new WeakMap(), shProg = new WeakMap(), progs = new WeakMap(); P.progs = [];
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
  const shaderFacts = (vs, fs) => {
    const both = `${vs}\n${fs}`;
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const loops = [...strip(both).matchAll(/\b(for|while)\s*\(([^)]{0,120})\)/g)].map((m) => m[2].replace(/\s+/g, ' ').trim());
    const def = (k) => { const m = new RegExp(`#define ${k} (\\d+)`).exec(both); return m ? Number(m[1]) : 0; };
    const name = /#define SHADER_NAME (\S+)/.exec(both)?.[1] ?? /#define SHADER_TYPE (\S+)/.exec(both)?.[1] ?? null;
    return { name, vsKb: +(vs.length / 1024).toFixed(1), fsKb: +(fs.length / 1024).toFixed(1), fsLines: strip(fs).split('\n').filter((l) => l.trim()).length,
      loops: loops.length, loopHeads: [...new Set(loops)].slice(0, 8), defines: (both.match(/^#define /gm) ?? []).length,
      texFetches: (strip(fs).match(/\btexture(2D|Lod|Grad|Offset|Proj)?\s*\(/g) ?? []).length,
      lights: { point: def('NUM_POINT_LIGHTS'), spot: def('NUM_SPOT_LIGHTS'), dir: def('NUM_DIR_LIGHTS'), dirShadows: def('NUM_DIR_LIGHT_SHADOWS') }, hash: fnv(both) };
  };
  const ssrc = G.shaderSource; G.shaderSource = function (sh, src) { shSrc.set(sh, src); return ssrc.call(this, sh, src); };
  const atsh = G.attachShader; G.attachShader = function (p, sh) { let r = progs.get(p); if (!r) progs.set(p, (r = { sh: [] })); r.sh.push(sh); shProg.set(sh, p); return atsh.call(this, p, sh); };
  const lnk = G.linkProgram; G.linkProgram = function (p) {
    const r = progs.get(p) ?? { sh: [] }; progs.set(p, r);
    const src = r.sh.map((s) => shSrc.get(s) ?? '');
    const vs = src.find((s) => /gl_Position/.test(s)) ?? src[0] ?? '', fs = src.find((s) => s !== vs) ?? '';
    r.rec = { i: P.progs.length, t: Math.round(now()), ...shaderFacts(vs, fs), polled: 0, readyMs: null, blockedMs: 0, firstBlockMs: null };
    if (P.dumpShaders && !P.dumped?.has(r.rec.hash)) { (P.dumped ??= new Map()).set(r.rec.hash, { vs, fs }); }
    P.progs.push(r.rec);
    return lnk.call(this, p);
  };
  const progOf = (x) => progs.get(x) ?? progs.get(shProg.get(x));
  const blockOn = (name) => { const o = G[name]; G[name] = function (x, ...a) {
    const r = x && progOf(x)?.rec; const t0 = now(); const v = o.call(this, x, ...a); const ms = now() - t0;
    if (r) {
      if (name === 'getProgramParameter' && a[0] === 0x91B1) { r.polled++; if (v && r.readyMs == null) r.readyMs = Math.round(now() - r.t); }
      else { r.blockedMs += ms; if (r.firstBlockMs == null) { r.firstBlockMs = +ms.toFixed(1); r.firstBlockAt = Math.round(t0 - r.t); } }
    }
    return v; }; };
  for (const n of ['getProgramParameter', 'getProgramInfoLog', 'getShaderParameter', 'getShaderInfoLog', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'getAttribLocation', 'getUniformBlockIndex']) blockOn(n);
  P.shaderDump = () => (P.dumped ? Object.fromEntries(P.dumped) : null);
  const ge = G.getExtension; G.getExtension = function (n) { if (!P.ext.includes(n)) P.ext.push(n); return ge.call(this, n); };
  // mip chains (fw_r4_mem_track counts the levels it is given; generateMipmap adds a third on top of level 0)
  const lvl0 = new WeakMap(), live = new Set(), unit = new WeakMap();
  const BPP = { 0x8058: 4, 0x8C43: 4, 0x881A: 8, 0x8814: 16, 0x8229: 1, 0x822B: 2, 0x1908: 4, 0x1907: 3 };
  const at = G.activeTexture; G.activeTexture = function (u) { unit.set(this, u); return at.call(this, u); };
  const bound = new WeakMap();
  const bt = G.bindTexture; G.bindTexture = function (tg, t) { let m = bound.get(this); if (!m) bound.set(this, (m = new Map())); m.set(`${unit.get(this) ?? 0}:${tg}`, t); return bt.call(this, tg, t); };
  const cur = (gl, tg) => bound.get(gl)?.get(`${unit.get(gl) ?? 0}:${tg >= 0x8515 && tg <= 0x851A ? 0x8513 : tg}`);
  const ti = G.texImage2D; G.texImage2D = function (...a) { try { if (a[1] === 0) { const t = cur(this, a[0]); const [w, h] = a.length >= 9 ? [a[3], a[4]] : [a[5]?.width ?? 0, a[5]?.height ?? 0]; if (t) { const r = lvl0.get(t) ?? { b: 0, mip: false, ref: new WeakRef(t) }; r.b = w * h * (BPP[a[2]] ?? 4); lvl0.set(t, r); live.add(r); } } } catch { /* */ } return ti.apply(this, a); };
  const gm = G.generateMipmap; G.generateMipmap = function (tg) { const t = cur(this, tg); const r = t && lvl0.get(t); if (r) r.mip = true; return gm.call(this, tg); };
  const dt = G.deleteTexture; G.deleteTexture = function (t) { const r = t && lvl0.get(t); if (r) live.delete(r); return dt.call(this, t); };
  P.mipExtraMb = () => { let b = 0; for (const r of live) { if (!r.ref.deref()) { live.delete(r); continue; } if (r.mip) b += r.b / 3; } return +(b / 1048576).toFixed(1); };
  // JSON.parse of big bodies (the catalog)
  const jp = JSON.parse; JSON.parse = function (s, ...r) { const t0 = now(); try { return jp.call(this, s, ...r); } finally { const ms = now() - t0; if (ms >= 20) P.json.push({ t: Math.round(t0), ms: Math.round(ms), kb: Math.round((s?.length ?? 0) / 1024) }); } };
  // fps: rAF intervals from a mark on
  P.fpsStart = () => { const iv = []; P.fps = iv; let l = now(); const f = () => { const t = now(); iv.push([Math.round(t), +(t - l).toFixed(1)]); l = t; if (P.fps === iv && iv.length < 40000) requestAnimationFrame(f); }; requestAnimationFrame(f); };
  P.glInfo = () => {
    const c = document.getElementById('view'); const gl = c?.getContext('webgl2');
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const ex = gl.getSupportedExtensions() ?? [];
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), lost: gl.isContextLost(), buffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`, attrs: gl.getContextAttributes(),
      compressed: ex.filter((e) => /compressed_texture/.test(e)), parallelCompile: ex.includes('KHR_parallel_shader_compile'), timer: ex.includes('EXT_disjoint_timer_query_webgl2') };
  };
  P.dump = () => ({ ms: P.ms, loaf: P.loaf, gaps: P.gaps, lt: P.lt, ev: P.ev, glTot: Object.fromEntries(Object.entries(P.glTot).map(([k, v]) => [k, Math.round(v)])), glBig: P.glBig, ext: P.ext,
    plate: P.plate ?? null, viewplate: P.viewplateText ?? null, viewplateLast: P.viewplateLast ?? null, progress: P.progress ?? [], json: P.json,
    bins: [...P.bins.entries()], progs: P.progs });
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────
const pct = (xs, k) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const MB = (b) => +(b / 1048576).toFixed(2);
async function cdpOf(page) { return page.context().newCDPSession(page); }
async function applyProfile(cdp, prof) {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (prof.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: prof.net.rtt, downloadThroughput: prof.net.down / 8, uploadThroughput: prof.net.up / 8 });
  if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
}
async function launch(prof, size) {
  const release = await holdHeavy('perf_load');
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.VALE_HEADED !== '1',
    args: [...GPU_ARGS[prof.gpu], '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
  browser.on('disconnected', release);
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await context.routeWebSocket(/.*/, () => {});   // never reach the real game server (or a dev server's HMR)
  return { browser, context };
}
const machine = () => ({ load1: +loadavg()[0].toFixed(2), cpus: cpus().length, cpuModel: cpus()[0]?.model, memGb: Math.round(totalmem() / 2 ** 30), platform: process.platform });

/** the minified source around a LoAF script position, so a stall in the live build can be named */
const srcCache = new Map();
async function snippet(url, pos) {
  if (!url || !(pos >= 0) || !/^http/.test(url)) return null;
  try {
    let s = srcCache.get(url);
    if (s === undefined) { s = await (await fetch(url)).text(); srcCache.set(url, s); }
    return s.slice(Math.max(0, pos - 40), pos + 140).replace(/\s+/g, ' ');
  } catch { return null; }
}

// ── one journey ──────────────────────────────────────────────────────────────────────────────────────────────────
async function runJourney({ url, profileName, journey, sec, calibrate, tier, ctxloss, server, size }) {
  const prof = PROFILES[profileName];
  if (!prof) throw new Error(`unknown profile ${profileName}`);
  const rep = { kind: 'journey', profile: profileName, profileSpec: { ...prof, gpuArgs: GPU_ARGS[prof.gpu], window: `${size.width}x${size.height}`, dpr: 1, cache: 'disabled (cold)' },
    journey, url, at: new Date().toISOString(), machine: machine(), calibrate: !!calibrate, tier: tier ?? 'default', errors: [] };
  const { browser, context } = await launch(prof, size);
  await context.addInitScript({ path: join(HERE, 'fw_r4_mem_track.js') });
  if (opt('dump-shaders')) await context.addInitScript(() => { window.__plDump = true; });
  await context.addInitScript(pageProbe);
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && consoleLines.length < 40) consoleLines.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${String(e.message).slice(0, 240)}`));
  let crashed = false;
  page.on('crash', () => { crashed = true; rep.errors.push('page crashed (renderer process gone)'); });
  const cdp = await cdpOf(page);
  const bcdp = await browser.newBrowserCDPSession();
  await applyProfile(cdp, prof);
  // heap every 2 s (node side: keeps reading while the page is busy, a CDP call waits for the isolate)
  const heap = []; let heapStop = false; let mark = 'boot';
  const tStart = Date.now();
  const heapLoop = (async () => { while (!heapStop) { const h = await cdp.send('Runtime.getHeapUsage').catch(() => null); if (h) heap.push({ s: +((Date.now() - tStart) / 1000).toFixed(1), mark, usedMb: MB(h.usedSize), totalMb: MB(h.totalSize), backingMb: h.backingStorageSize != null ? MB(h.backingStorageSize) : null }); await new Promise((r) => setTimeout(r, 2000)); } })();
  const gpuProcMb = async () => {
    if (process.platform !== 'darwin') return null;
    try {
      const ps = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
      const { execFileSync } = await import('node:child_process');
      const fp = (pid) => { const m = /Footprint:\s+([\d.]+)\s+(MB|GB|KB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 })); return m ? Math.round(Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1)) : null; };
      const gpu = ps.find((x) => x.type === 'GPU');
      const rend = ps.filter((x) => x.type === 'renderer').map((x) => fp(x.id) ?? 0).sort((a, b) => b - a)[0] ?? null;
      return { rendererMb: rend, gpuProcessMb: gpu ? fp(gpu.id) : null };
    } catch { return null; }
  };
  const snapState = async (tag) => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const t = await page.evaluate(() => ({ mem: window.__memTrack?.() ?? null, mip: window.__pl?.mipExtraMb?.() ?? null, gl: window.__pl?.glInfo?.() ?? null, now: performance.now(),
      video: (() => { try { return JSON.parse(localStorage.getItem('vale.profile.v1'))?.settings?.video ?? null; } catch { return null; } })(),
      calib: (() => { try { return JSON.parse(localStorage.getItem('vale.calib.v1')); } catch { return null; } })(),
      dm: navigator.deviceMemory ?? null, hc: navigator.hardwareConcurrency ?? null })).catch((e) => ({ error: String(e.message).slice(0, 200) }));
    const h = await cdp.send('Runtime.getHeapUsage').catch(() => null);
    const os = await gpuProcMb();
    const g = t.mem?.gl;
    const [bw, bh] = String(t.gl?.buffer ?? '0x0').split('x').map(Number);
    const fbMb = MB(bw * bh * 8);   // the canvas' own colour + depth/stencil
    const s = { tag, atMs: Math.round(t.now ?? 0), heapUsedMb: h ? MB(h.usedSize) : null, heapTotalMb: h ? MB(h.totalSize) : null,
      gpuEstMb: g ? +(g.texMb + (t.mip ?? 0) + g.bufMb + g.rbMb + fbMb).toFixed(1) : null,
      gl: g ? { textures: g.texN, texMb: g.texMb, mipExtraMb: t.mip, buffers: g.bufN, bufMb: g.bufMb, renderbuffers: g.rbN, rbMb: g.rbMb, canvasMb: fbMb, programs: g.programs } : null,
      texClasses: t.mem?.texClasses ?? null, audio: t.mem?.audio ? { n: t.mem.audio.n, mb: t.mem.audio.mb } : null, bitmaps: t.mem?.bitmaps ? { n: t.mem.bitmaps.n, mb: t.mem.bitmaps.mb } : null,
      os, video: t.video, calib: t.calib, device: { deviceMemory: t.dm, hardwareConcurrency: t.hc }, glInfo: t.gl, error: t.error };
    if (s.gpuEstMb != null && s.heapUsedMb != null) s.heapPlusGpuMb = +(s.gpuEstMb + s.heapUsedMb + (s.audio?.mb ?? 0)).toFixed(1);
    (rep.states ??= []).push(s);
    log(`${tag}: heap ${s.heapUsedMb} MB, GPU est ${s.gpuEstMb} MB (${s.gl?.textures ?? '?'} textures ${s.gl?.texMb ?? '?'} MB + mips ${s.gl?.mipExtraMb ?? '?'}), audio ${s.audio?.mb ?? '?'} MB, video ${s.video?.preset ?? '?'}${os ? `, mac renderer ${os.rendererMb} + GPU proc ${os.gpuProcessMb} MB` : ''}`);
    return s;
  };
  const click = async (loc, timeout = 60000) => { await loc.first().waitFor({ state: 'visible', timeout }); for (let i = 0; i < 3; i++) { try { await loc.first().click({ timeout: 15000 }); return; } catch (e) { if (i === 2) throw e; await page.waitForTimeout(800); } } };
  const shotDir = join(HERE, '_shots');
  const shot = async (n) => { if (!flag('shots')) return; mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: join(shotDir, `perf_load_${profileName}_${n}.png`), timeout: 20000 }).catch(() => {}); };
  const slow = prof.cpu > 1 || prof.gpu !== 'gpu';
  const T = (ms) => (slow ? ms * 3 : ms);
  try {
    server?.reset();
    const q = new URLSearchParams();
    if (calibrate) q.set('calibrate', '1');
    // --query "fakegpu=ANGLE (Intel, ...)&diag=1": extra page parameters (ruling 67 QA: ?fakegpu= stands in a renderer string)
    for (const [k, v] of new URLSearchParams(opt('query', ''))) q.set(k, v);
    const target = url + (q.toString() ? `?${q}` : '');
    log(`${profileName}/${journey}: ${target}`);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: T(60000) });
    // Home, or a plate
    const homeOrPlate = await page.waitForFunction(() => window.__pl && (window.__pl.ms.home !== undefined || window.__pl.ms.plate !== undefined), null, { timeout: T(120000), polling: 250 }).then(() => true, () => false);
    if (!homeOrPlate) rep.errors.push('neither Home nor a plate within the timeout');
    mark = 'home';
    const plate = await page.evaluate(() => window.__pl.plate).catch(() => null);
    if (plate) { rep.plate = plate; log(`plate: ${plate}`); await shot('plate'); }
    if (tier && tier !== 'default' && !plate) {
      // apply the tier to the stored profile and reload (the game reads the profile at boot)
      const ok = await page.evaluate((tv) => { const raw = localStorage.getItem('vale.profile.v1'); if (!raw) return false; const p = JSON.parse(raw);
        const L = { low: { renderScale: 0.75, shadows: 1, ao: 0, bloom: false, antialias: 'off', particles: 0, scatter: 0, maxDpr: 1 }, medium: { renderScale: 0.9, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 1, scatter: 1, maxDpr: 1 },
          high: { renderScale: 1, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 1 }, ultra: { renderScale: 1, shadows: 3, ao: 2, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 2 } }[tv];
        p.settings.video = { ...p.settings.video, ...L, preset: tv }; localStorage.setItem('vale.profile.v1', JSON.stringify(p)); return true; }, tier).catch(() => false);
      if (!ok) rep.errors.push('could not store the tier');
      rep.note = 'tier set in the stored profile after a first Home, then reloaded: the waterfall is of the second (still cache-disabled) visit';
      server?.reset();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__pl && window.__pl.ms.home !== undefined, null, { timeout: T(120000), polling: 250 });
    }
    if (!plate) {
      await page.waitForTimeout(T(calibrate ? 8000 : 5000));   // the first-run calibration (3 s, up to 3 windows) and the Home vale settling
      await shot('home');
      await snapState('home');
    }
    if (!plate && journey !== 'home') {
      mark = 'menus';
      await click(page.locator('.nav__item', { hasText: 'Play' }));
      if (journey === 'practice') {
        await click(page.getByRole('button', { name: /^Practice/ }));
        await click(page.getByRole('button', { name: /Start practice/ }));
      } else {
        const st = page.locator('.station', { hasText: 'RIFT' });
        if (await st.first().isVisible().catch(() => false)) await st.first().click().catch(() => {});
        await click(page.locator('.qcard', { hasText: 'Lantern Drill' }));
        await click(page.getByRole('button', { name: 'Find match' }));
      }
      await page.evaluate(() => { window.__pl.ms.start = Math.round(performance.now()); });
      const until = Date.now() + T(240000);
      let lockTries = 0;
      while (!(await page.evaluate(() => window.__pl.ms.hud !== undefined).catch(() => false))) {
        if (crashed) throw new Error('page crashed before the HUD');
        if (Date.now() > until) throw new Error('no HUD within the timeout');
        const ready = page.getByRole('button', { name: /^Ready/ }).first();
        if (await ready.isVisible().catch(() => false)) await ready.click({ timeout: 3000 }).catch(() => {});
        const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').first();
        const lock = page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first();
        if (lockTries < 40 && await card.isVisible().catch(() => false) && await lock.isVisible().catch(() => false)) {
          lockTries++; await card.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250); await lock.click({ timeout: 3000 }).catch(() => {});
        }
        if (await page.evaluate(() => window.__pl.ms.loading !== undefined).catch(() => false)) mark = 'loading';
        await page.waitForTimeout(500);
      }
      mark = 'match';
      log('in the match');
      await page.evaluate(() => window.__pl.fpsStart());
      // play a little: move toward mid on the minimap, level and press abilities (the decoded audio and kit VFX come in)
      const end = Date.now() + sec * 1000; let k = 0;
      while (Date.now() < end) {
        const mm = await page.locator('.hud .mmap').first().boundingBox().catch(() => null);
        if (mm) await page.mouse.click(mm.x + mm.width * 0.5, mm.y + mm.height * 0.5, { button: 'right' }).catch(() => {});
        const lvl = page.locator('.hud .aslot__lvl').first();
        if (await lvl.isVisible().catch(() => false)) await lvl.click({ timeout: 1000 }).catch(() => {});
        await page.mouse.move(size.width / 2 + (k % 5) * 30, size.height * 0.45).catch(() => {});
        await page.keyboard.press(['KeyQ', 'KeyW', 'KeyE', 'KeyR'][k % 4]).catch(() => {});
        k++;
        await page.waitForTimeout(2500);
      }
      await shot('match');
      const iv = await page.evaluate(() => window.__pl.fps).catch(() => []);
      rep.fps = fpsSummary(iv);
      await snapState('match');
      if (ctxloss) rep.ctxloss = await ctxLossTest(page, T);
    }
  } catch (e) {
    rep.errors.push(String(e?.message ?? e).slice(0, 400)); log(`broke: ${e?.message ?? e}`); await shot('FAIL');
    if (!crashed) await snapState('at_error').catch(() => {});
  }
  heapStop = true; await heapLoop.catch(() => {});
  const d = await page.evaluate(() => window.__pl?.dump?.() ?? null).catch(() => null);
  if (opt('dump-shaders')) {
    const dir = resolve(ROOT, opt('dump-shaders')); mkdirSync(dir, { recursive: true });
    const sd = await page.evaluate(() => window.__pl?.shaderDump?.() ?? null).catch(() => null);
    for (const [h, v] of Object.entries(sd ?? {})) { writeFileSync(join(dir, `${h}.vert`), v.vs); writeFileSync(join(dir, `${h}.frag`), v.fs); }
  }
  const res = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => ({ u: r.name, s: Math.round(r.startTime), e: Math.round(r.responseEnd), tx: r.transferSize, enc: r.encodedBodySize, dec: r.decodedBodySize, it: r.initiatorType }))).catch(() => []);
  await browser.close().catch(() => {});
  rep.console = consoleLines;
  rep.heap = { peakUsedMb: heap.length ? Math.max(...heap.map((h) => h.usedMb)) : null, peakTotalMb: heap.length ? Math.max(...heap.map((h) => h.totalMb)) : null, series: heap.filter((_, i) => i % 3 === 0) };
  if (d) Object.assign(rep, await analyse(d, res, server?.sent ?? null));
  const sts = rep.states ?? [];
  rep.peak = { heapUsedMb: rep.heap.peakUsedMb, gpuEstMb: sts.length ? Math.max(...sts.map((s) => s.gpuEstMb ?? 0)) : null };
  rep.peak.heapPlusGpuMb = rep.peak.heapUsedMb != null && rep.peak.gpuEstMb != null ? +(rep.peak.heapUsedMb + rep.peak.gpuEstMb + Math.max(0, ...sts.map((s) => s.audio?.mb ?? 0))).toFixed(1) : null;
  return rep;
}

function fpsSummary(iv) {
  if (!iv?.length) return null;
  const xs = iv.slice(30).map((x) => x[1]);   // skip the first half-second
  const secs = new Map(); for (const [t, d] of iv) { const s = Math.floor(t / 1000); const v = secs.get(s) ?? { n: 0, worst: 0 }; v.n++; v.worst = Math.max(v.worst, d); secs.set(s, v); }
  const per = [...secs.values()].slice(1, -1).map((v) => v.n);
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { frames: iv.length, fps: r1(1000 / mean), p50Ms: pct(xs, 0.5), p95Ms: pct(xs, 0.95), p99Ms: pct(xs, 0.99), worstMs: Math.max(...xs), secsUnder30: per.filter((n) => n < 30).length, secs: per.length, minSecFps: per.length ? Math.min(...per) : null };
}

async function ctxLossTest(page, T) {
  const out = {};
  const r = await page.evaluate(() => { const gl = document.getElementById('view').getContext('webgl2'); const ext = gl.getExtension('WEBGL_lose_context'); if (!ext) return { error: 'no WEBGL_lose_context' };
    window.__plLose = ext; window.__pl.fpsStart(); window.__plT0 = performance.now(); ext.loseContext(); return { lostAt: Math.round(performance.now()) }; });
  if (r.error) return r;
  await page.waitForTimeout(6000);
  out.whileLost = await page.evaluate(() => ({ viewplate: document.querySelector('.viewplate')?.textContent?.trim() ?? null, plate: document.querySelector('[data-plate]')?.textContent?.trim() ?? null,
    hud: !!document.querySelector('.hud .dbar'), framesIn6s: window.__pl.fps.length }));
  await page.evaluate(() => { window.__pl.fpsStart(); window.__plR0 = performance.now(); window.__plLose.restoreContext(); });
  const until = Date.now() + T(60000);
  let ok = false;
  while (Date.now() < until) {
    const s = await page.evaluate(() => ({ plate: !!document.querySelector('.viewplate'), n: window.__pl.fps.length })).catch(() => null);
    if (s && !s.plate && s.n > 30) { ok = true; break; }
    await page.waitForTimeout(250);
  }
  out.restored = ok;
  out.afterRestore = await page.evaluate(() => { const iv = window.__pl.fps; const t0 = window.__plR0; const gaps = window.__pl.gaps.filter((g) => g.t >= t0 - 50);
    return { msToPlateGone: window.__pl.viewplateLast ? Math.max(0, Math.round(window.__pl.viewplateLast - t0)) : null, frames: iv.length, worstMs: Math.max(0, ...iv.map((x) => x[1])), gapsOver250: gaps.length, worstGapMs: Math.max(0, ...gaps.map((g) => g.ms)), lost: document.getElementById('view').getContext('webgl2').isContextLost() }; });
  return out;
}

/** the shader programs: how many, which kinds and variants, how big, how many loops, when linked, what blocked */
function shaderTable(progs, phaseOf, ms) {
  if (!progs.length) return null;
  const sum = (xs, f) => +xs.reduce((a, x) => a + (f(x) ?? 0), 0).toFixed(1);
  const kinds = {};
  for (const p of progs) {
    const k = (kinds[p.name ?? '(unnamed ShaderMaterial)'] ??= { programs: 0, variants: new Set(), fsKbMax: 0, vsKbMax: 0, fsLinesMax: 0, loopsMax: 0, texFetchesMax: 0, blockedMs: 0, loopHeads: new Set(), lights: new Set() });
    k.programs++; k.variants.add(p.hash); k.fsKbMax = Math.max(k.fsKbMax, p.fsKb); k.vsKbMax = Math.max(k.vsKbMax, p.vsKb); k.fsLinesMax = Math.max(k.fsLinesMax, p.fsLines);
    k.loopsMax = Math.max(k.loopsMax, p.loops); k.texFetchesMax = Math.max(k.texFetchesMax, p.texFetches); k.blockedMs += p.blockedMs;
    for (const l of p.loopHeads) k.loopHeads.add(l); k.lights.add(`${p.lights.dir}d${p.lights.dirShadows}s/${p.lights.point}p/${p.lights.spot}sp`);
  }
  const byKind = Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1].programs - a[1].programs).map(([n, k]) => [n, { ...k, variants: k.variants.size, blockedMs: +k.blockedMs.toFixed(1), loopHeads: [...k.loopHeads].slice(0, 6), lights: [...k.lights] }]));
  const phases = {};
  for (const p of progs) { const ph = phaseOf(p.t); const v = (phases[ph] ??= { programs: 0, polledFirst: 0, blockedMs: 0, worstBlockMs: 0 }); v.programs++; if (p.polled > 0) v.polledFirst++; v.blockedMs += p.blockedMs; v.worstBlockMs = Math.max(v.worstBlockMs, p.firstBlockMs ?? 0); }
  for (const v of Object.values(phases)) v.blockedMs = +v.blockedMs.toFixed(1);
  // bursts: programs linked within 100 ms of each other (they all reach the driver in one go)
  const bursts = []; let cur = null;
  for (const p of progs.slice().sort((a, b) => a.t - b.t)) { if (cur && p.t - cur.end <= 100) { cur.n++; cur.end = p.t; cur.blockedMs += p.blockedMs; } else { cur = { at: p.t, end: p.t, n: 1, blockedMs: p.blockedMs }; bursts.push(cur); } }
  return {
    programs: progs.length, unique: new Set(progs.map((p) => p.hash)).size, totalSourceKb: sum(progs, (p) => p.vsKb + p.fsKb),
    polledBeforeBlocking: progs.filter((p) => p.polled > 0).length, blockedMsTotal: sum(progs, (p) => p.blockedMs),
    withLoops: progs.filter((p) => p.loops > 0).length, maxLoops: Math.max(...progs.map((p) => p.loops)), maxFsKb: Math.max(...progs.map((p) => p.fsKb)),
    byPhase: phases, byKind,
    bursts: bursts.filter((b) => b.n >= 3).map((b) => ({ ...b, blockedMs: +b.blockedMs.toFixed(1), phase: phaseOf(b.at) })),
    list: progs.map((p) => ({ i: p.i, t: p.t, phase: phaseOf(p.t), name: p.name, vsKb: p.vsKb, fsKb: p.fsKb, fsLines: p.fsLines, loops: p.loops, tex: p.texFetches, lights: p.lights, polled: p.polled, readyMs: p.readyMs, firstBlockMs: p.firstBlockMs, blockedMs: +p.blockedMs.toFixed(1), hash: p.hash })),
  };
}

/** turn the page's raw records into the tables */
async function analyse(d, res, sent) {
  const ms = d.ms;
  const home = ms.home ?? null, hud = ms.hud ?? null;
  const phaseOf = (t) => (home == null || t < home ? 'beforeHome' : hud == null || t < hud ? 'homeToHud' : 'afterHud');
  const by = {};
  const add = (phase, kind, bytes, raw) => { const p = (by[phase] ??= { totalMb: 0, requests: 0, kinds: {} }); const k = (p.kinds[kind] ??= { mb: 0, n: 0, rawMb: 0 }); k.mb += bytes / 1048576; k.n++; k.rawMb += (raw ?? bytes) / 1048576; p.totalMb += bytes / 1048576; p.requests++; };
  for (const r of res) add(phaseOf(r.e), kindOf(r.u), r.tx || r.enc || 0, r.dec || r.enc || 0);
  for (const p of Object.values(by)) { p.totalMb = +p.totalMb.toFixed(2); for (const k of Object.values(p.kinds)) { k.mb = +k.mb.toFixed(2); k.rawMb = +k.rawMb.toFixed(2); } }
  const biggest = (phase) => res.filter((r) => phaseOf(r.e) === phase).sort((a, b) => (b.tx || b.enc) - (a.tx || a.enc)).slice(0, 12).map((r) => `${new URL(r.u).pathname.replace(/.*\//, '')} ${MB(r.tx || r.enc)} MB @${r.s}-${r.e} ms`);
  const audioBeforeHud = res.filter((r) => kindOf(r.u) === 'audio' && phaseOf(r.e) !== 'afterHud').length;
  // stalls: each long frame with the GL time inside it
  const bins = new Map(d.bins);
  const glIn = (t, dur) => { const o = {}; for (let b = Math.floor(t / 50); b <= Math.floor((t + dur) / 50); b++) for (const [k, v] of Object.entries(bins.get(b) ?? {})) o[k] = (o[k] ?? 0) + v; return Object.fromEntries(Object.entries(o).filter(([, v]) => v >= 5).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])); };
  const stalls = [];
  for (const l of d.loaf.sort((a, b) => b.ms - a.ms)) {
    const scripts = [];
    for (const s of l.scripts) scripts.push({ ...s, url: s.url ? s.url.replace(/.*\//, '') : s.url, snippet: stalls.length < 25 ? await snippet(s.url, s.pos) : undefined });
    stalls.push({ t: l.t, ms: l.ms, phase: phaseOf(l.t), renderMs: l.render, gl: glIn(l.t, l.ms), scripts });
  }
  const over = (xs, k) => xs.filter((x) => x.ms > k).length;
  const after = (xs, t0) => xs.filter((x) => t0 != null && x.t >= t0);
  const firstPaint = ms['first-contentful-paint'] ?? ms['first-paint'] ?? null;
  // Home quiet: the first 1 s window after Home with no heartbeat gap over 150 ms (gaps < 250 ms are not recorded, so
  // this reads the 250 ms gaps and the long frames together)
  let homeQuiet = null;
  if (home != null) {
    const blocks = [...d.gaps.map((g) => [g.t, g.t + g.ms]), ...d.loaf.map((l) => [l.t, l.t + l.ms])].filter(([s, e]) => e >= home).sort((a, b) => a[0] - b[0]);
    let t = home;
    for (const [s, e] of blocks) { if (s - t >= 1000) break; t = Math.max(t, e); }
    homeQuiet = Math.round(t);
  }
  const sentBy = sent ? (() => { const o = {}; for (const s of sent) { const k = kindOf(s.path); const v = (o[k] ??= { mb: 0, n: 0 }); v.mb += s.bytes / 1048576; v.n++; } for (const v of Object.values(o)) v.mb = +v.mb.toFixed(2); return { totalMb: +sent.reduce((a, s) => a + s.bytes / 1048576, 0).toFixed(2), requests: sent.length, kinds: o }; })() : null;
  return {
    milestonesMs: { firstPaint, ui: ms.ui ?? null, home, homeQuiet, plate: ms.plate ?? null, start: ms.start ?? null, loading: ms.loading ?? null, hud, startToHud: hud != null && ms.start != null ? hud - ms.start : null,
      loadingToHud: hud != null && ms.loading != null ? hud - ms.loading : null },
    screens: Object.fromEntries(Object.entries(ms).filter(([k]) => /^(scr|dialog):/.test(k)).sort((a, b) => a[1] - b[1])),
    progress: d.progress.length ? { steps: d.progress.length, first: d.progress[0], last: d.progress.at(-1), longestStallMs: d.progress.slice(1).reduce((m, p, i) => Math.max(m, p.t - d.progress[i].t), 0) } : null,
    waterfall: by, biggest: { beforeHome: biggest('beforeHome'), homeToHud: biggest('homeToHud') }, audioFilesBeforeHud: audioBeforeHud,
    serverSent: sentBy,
    stalls: {
      longFramesOver100: d.loaf.length, over250: over(d.loaf, 250), over1000: over(d.loaf, 1000),
      afterFirstPaintOver250: over(after(d.loaf, firstPaint), 250), worstMs: d.loaf.length ? Math.max(...d.loaf.map((l) => l.ms)) : 0,
      byPhase: Object.fromEntries(['beforeHome', 'homeToHud', 'afterHud'].map((p) => { const xs = d.loaf.filter((l) => phaseOf(l.t) === p); return [p, { n: xs.length, sumMs: xs.reduce((a, l) => a + l.ms, 0), worstMs: Math.max(0, ...xs.map((l) => l.ms)), over250: over(xs, 250) }]; })),
      firstMinuteOfMatch: hud != null ? (() => { const xs = d.loaf.filter((l) => l.t >= hud && l.t < hud + 60000); return { n: xs.length, worstMs: Math.max(0, ...xs.map((l) => l.ms)), over250: over(xs, 250) }; })() : null,
      heartbeatGapsOver250: d.gaps.length, worstGapMs: d.gaps.length ? Math.max(...d.gaps.map((g) => g.ms)) : 0,
      worst: stalls.slice(0, 25),
    },
    shaders: shaderTable(d.progs ?? [], phaseOf, ms),
    glTotalsMs: d.glTot, glBigCalls: d.glBig.sort((a, b) => b.ms - a.ms).slice(0, 30), jsonParses: d.json, extensionsRequested: d.ext, slowInputs: d.ev,
  };
}

// ── the render bench: the densest 5v5 fight per tier ─────────────────────────────────────────────────────────────
async function runBench({ benchUrl, profileName, tiers, t, sec, size }) {
  const prof = PROFILES[profileName];
  const out = { kind: 'bench', profile: profileName, profileSpec: { ...prof, gpuArgs: GPU_ARGS[prof.gpu], window: `${size.width}x${size.height}`, network: 'not applied (the bench loads before the window)' }, at: new Date().toISOString(), machine: machine(), t, sec, tiers: {} };
  for (const tier of tiers) {
    const { browser, context } = await launch(prof, size);
    await context.addInitScript({ path: join(HERE, 'fw_r4_mem_track.js') });
    const page = await context.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
    const r = { tier };
    try {
      const u = new URL(benchUrl); u.searchParams.set('mode', 'rift'); u.searchParams.set('q', tier); u.searchParams.set('t', String(t)); u.searchParams.set('seed', '7'); u.searchParams.set('dev', '1'); u.searchParams.set('hud', '0'); u.searchParams.set('dyn', '1');
      await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 600000, polling: 500 });
      const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null); if (err) throw new Error(err);
      await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
      const cdp = await cdpOf(page);
      if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
      await page.waitForTimeout(3000);
      await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); if (f) b.focus(f.x, f.y); });
      const iv = await page.evaluate(async (ms) => { const out = []; let l = performance.now(); const end = l + ms; await new Promise((res) => { const f = () => { const n = performance.now(); out.push([Math.round(n), +(n - l).toFixed(1)]); l = n; if (n < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return out; }, sec * 1000);
      r.fps = fpsSummary(iv);
      const s = await page.evaluate(() => { const x = window.__VALE_BENCH__.stats(); return { calls: x.calls, triangles: x.triangles, programs: x.programs, textures: x.textures, geometries: x.geometries, renderScale: x.renderScale, tier: x.tier, w: x.width, h: x.height, actors: x.actors, particles: x.particles, bound: x.bound }; });
      r.stats = s;
      const m = await page.evaluate(() => window.__memTrack?.() ?? null);
      const h = await cdp.send('Runtime.getHeapUsage').catch(() => null);
      r.gpuEstMb = m ? +(m.gl.texMb + m.gl.bufMb + m.gl.rbMb).toFixed(1) : null; r.texMb = m?.gl.texMb ?? null; r.textures = m?.gl.texN ?? null; r.heapUsedMb = h ? MB(h.usedSize) : null;
      const fight = await page.evaluate(() => { const b = window.__VALE_BENCH__; const f = b.fight(); return f ? { x: Math.round(f.x), y: Math.round(f.y), n: f.n ?? f.count ?? null } : null; });
      r.fight = fight;
      log(`bench ${profileName} ${tier}: ${r.fps?.fps} fps (p95 ${r.fps?.p95Ms} ms), ${s.calls} draws, ${s.triangles} tris, scale ${s.renderScale}, GPU est ${r.gpuEstMb} MB`);
    } catch (e) { r.error = String(e?.message ?? e).slice(0, 300); log(`bench ${tier} broke: ${r.error}`); }
    r.pageErrors = errs.slice(0, 5);
    out.tiers[tier] = r;
    await browser.close().catch(() => {});
  }
  return out;
}

// ── the baseline plan: every run in its own child process (a fresh browser and heavy slot each) ─────────────────────
async function child(argv) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], { stdio: ['ignore', 'pipe', 'inherit'] });
    let s = ''; p.stdout.on('data', (b) => { s += b; });
    p.on('close', (code) => { try { ok(JSON.parse(s)); } catch { ok({ error: `child exit ${code}`, argv, out: s.slice(0, 400) }); } });
  });
}

const maxMin = Number(opt('max-min', 15));
const watchdog = setTimeout(() => { log(`watchdog: ${maxMin} min, exiting`); process.exit(4); }, maxMin * 60000); watchdog.unref();
const size = { width: Number(opt('w', 1366)), height: Number(opt('h', 768)) };
let server = null;
const mounts = [];
if (opt('serve') || opt('serve-only')) mounts.push(['/', resolve(ROOT, opt('serve') ?? opt('serve-only'))]);
for (let i = 0; i < args.length; i++) if (args[i] === '--mount') { const [pre, dir] = args[i + 1].split('='); mounts.unshift([pre, resolve(ROOT, dir)]); }
if (mounts.length) { server = await serve(mounts, Number(opt('port', 5199))); log(`serving ${mounts.map((m) => `${m[0]} <- ${m[1]}`).join(', ')} at ${server.url}`); }
if (flag('serve-only') || opt('serve-only')) { log('serving only; Ctrl-C stops'); await new Promise(() => {}); }

let result;
try {
  if (opt('plan') === 'baseline') {
    clearTimeout(watchdog);
    const url = server?.url ?? opt('url');
    const benchUrl = opt('bench-url') ?? (opt('bench-dir') ? `${url}bench/_harness/web/render_bench.html?catalog=${encodeURIComponent(url + 'catalog/manifest.json')}` : null);
    const runs = [
      ['fast', 'practice', ['--calibrate', '--sec', '20']],
      ['weak', 'practice', ['--calibrate', '--sec', '30']],
      ['weak', 'coop', ['--sec', '45']],
      ['weak6', 'home', ['--calibrate']],
      ['swiftshader', 'practice', ['--calibrate', '--sec', '30']],
      ['nogpu', 'home', []],
      ['fast', 'practice', ['--ctxloss', '--sec', '10']],
    ];
    result = { plan: 'baseline', at: new Date().toISOString(), machine: machine(), url, runs: [] };
    for (const [p, j, extra] of runs) { log(`── run ${p} ${j} ${extra.join(' ')}`); result.runs.push(await child(['--url', url, '--profile', p, '--journey', j, '--max-min', '14', ...extra])); }
    if (benchUrl) for (const p of ['fast', 'weak']) { log(`── bench ${p}`); result.runs.push(await child(['--bench', benchUrl, '--profile', p, '--tiers', 'low,medium,high', '--max-min', '25'])); }
    result.machineEnd = machine();
  } else if (opt('bench')) {
    result = await runBench({ benchUrl: opt('bench'), profileName: opt('profile', 'fast'), tiers: opt('tiers', 'low,medium,high').split(','), t: Number(opt('t', 600)), sec: Number(opt('sec', 12)), size });
  } else {
    const url = server?.url ?? opt('url');
    if (!url) throw new Error('--url or --serve is needed');
    result = await runJourney({ url, profileName: opt('profile', 'weak'), journey: opt('journey', 'practice'), sec: Number(opt('sec', 30)), calibrate: flag('calibrate'), tier: opt('tier'), ctxloss: flag('ctxloss'), server, size });
  }
} finally { await server?.close(); }
const json = JSON.stringify(result, null, 2);
if (opt('out')) { mkdirSync(dirname(resolve(ROOT, opt('out'))), { recursive: true }); writeFileSync(resolve(ROOT, opt('out')), json); log(`wrote ${opt('out')}`); }
process.stdout.write(json + '\n');
process.exit(result?.errors?.length ? 3 : 0);
