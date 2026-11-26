#!/usr/bin/env node
// LOADTIME: boot one URL on SwiftShader against a running server and dump the boot trace (boot.ts).
//   bash _harness/slot.sh node _harness/arc-work/loadtime/boot-probe.mjs --base=http://127.0.0.1:5311 --query='scenario=babel&seed=307987276' --out=DIR --tag=a [--after=20] [--shot=1] [--size=640x360]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const opts = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : 'true']; }));
const OUT = resolve(ROOT, opts.out ?? '_harness/scratch/loadtime');
mkdirSync(OUT, { recursive: true });
const tag = opts.tag ?? 'a';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'] });
const [vw, vh] = String(opts.size ?? '640x360').split('x').map(Number);
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(3600000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || /boot compile|warm-up/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
// the page's own liveness: the longest gap between two 20 ms timer ticks while the boot card is up, and what the card said
await page.addInitScript(() => {
  const L = (window.__LT__ = { gaps: [], last: performance.now(), status: [] });
  setInterval(() => {
    const t = performance.now();
    if (t - L.last > 100) L.gaps.push([Math.round(L.last), Math.round(t - L.last)]);
    L.last = t;
    const s = document.getElementById('boot-status')?.textContent ?? '';
    if (s && L.status[L.status.length - 1]?.[1] !== s) L.status.push([Math.round(t), s]);
  }, 20);
});
// --parallel=K: EMULATE KHR_parallel_shader_compile (SwiftShader has none) the way a slow compiler behaves: a link takes
// K microseconds per source character on one of 4 compile threads; COMPLETION_STATUS_KHR answers without waiting; any
// other query on an unfinished program WAITS (busy) until its compile is done — what Chrome on D3D does. Times are a model.
if (opts.parallel) await page.addInitScript((K) => {
  const P = WebGL2RenderingContext.prototype;
  const src = new WeakMap(), att = new WeakMap(), ready = new WeakMap(), ofShader = new WeakMap();
  const workers = [0, 0, 0, 0];
  const gx = P.getExtension, ss = P.shaderSource, as = P.attachShader, lp = P.linkProgram;
  P.getExtension = function (n) { return n === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: 0x91b1 } : gx.call(this, n); };
  P.shaderSource = function (sh, s) { src.set(sh, s.length); return ss.call(this, sh, s); };
  P.attachShader = function (p, sh) { att.set(p, (att.get(p) ?? 0) + (src.get(sh) ?? 0)); ofShader.set(sh, p); return as.call(this, p, sh); };
  P.linkProgram = function (p) {
    const now = performance.now();
    let w = 0; for (let i = 1; i < 4; i++) if (workers[i] < workers[w]) w = i;
    const t = Math.max(now, workers[w]) + (att.get(p) ?? 0) * K / 1000;
    workers[w] = t; ready.set(p, t);
    return lp.call(this, p);
  };
  const wait = (p) => { const t = ready.get(p); if (t === undefined) return; while (performance.now() < t) { /* the driver is compiling */ } };
  for (const k of ['getProgramParameter', 'getProgramInfoLog', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'getAttribLocation', 'useProgram']) {
    const f = P[k];
    P[k] = function (p, a, ...r) {
      if (k === 'getProgramParameter' && a === 0x91b1) return performance.now() >= (ready.get(p) ?? 0);
      if (p) wait(p);
      return f.call(this, p, a, ...r);
    };
  }
  for (const k of ['getShaderParameter', 'getShaderInfoLog']) { const f = P[k]; P[k] = function (sh, ...r) { const p = ofShader.get(sh); if (p) wait(p); return f.call(this, sh, ...r); }; }
}, Number(opts.parallel));
// --profile=1: the main thread's CPU profile from navigation to playable (self time by function, top 40)
let cdp = null;
if (opts.profile) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
// --dump=1: keep every shader source (written as <tag>-src/<stage>-<chars>-<hash>.glsl, the 40 largest fragment sources)
if (opts.dump) await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype, ss = P.shaderSource, cs = P.createShader;
  const type = new WeakMap(); window.__SRC__ = new Map();
  P.createShader = function (t) { const sh = cs.call(this, t); if (sh) type.set(sh, t); return sh; };
  P.shaderSource = function (sh, s) { const k = (type.get(sh) === 0x8b31 ? 'vs' : 'fs') + ':' + s.length + ':' + s.slice(-200); if (!window.__SRC__.has(k)) window.__SRC__.set(k, s); return ss.call(this, sh, s); };
});
const T0 = Date.now();
await page.goto(`${opts.base ?? 'http://127.0.0.1:5311'}/?${opts.query ?? ''}`);
await page.evaluate(() => window.__GENESIS__.ready);
const tReady = Date.now() - T0;
if (cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; let tot = 0;
  profile.samples.forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber + 1}`; const d = (dt[i] ?? 0) / 1000; self.set(k, (self.get(k) ?? 0) + d); tot += d; });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, v]) => `${v.toFixed(0).padStart(7)} ms  ${k}`);
  writeFileSync(join(OUT, `${tag}-cpu.txt`), [`main-thread CPU self time, navigation to ready (${tot.toFixed(0)} ms sampled)`, ...top].join('\n'));
}
await new Promise((ok) => setTimeout(ok, Number(opts.after ?? 20) * 1000));
if (opts.eval) await page.evaluate(opts.eval);
// --land=N: the bench's standard landing (18 N / 35 W, the wheel zoom's distance), N frames, then the canvas alone
if (opts.land) {
  await page.evaluate(async (n) => {
    const G = window.__GENESIS__, st = G.state();
    const id = st.camera?.planet ?? st.planets?.[0]?.id ?? 0, radius = st.planets.find((p) => p.id === id).radius;
    await G.camera({ mode: 'orbit', planet: id, lat: 18, lon: -35, dist: Math.max(2, radius * 2.6 * Math.exp((4 * -800 + 2 * 80) * 0.0013)), yaw: 0, blend: 0 });
    await G.frames(n);
    G.hold(true);
  }, Number(opts.land));
  await page.locator('#game').screenshot({ path: join(OUT, `${tag}-land.png`) });
}
if (opts.dump) {
  const src = await page.evaluate(() => [...window.__SRC__.values()].map((s, i) => ({ s, vs: [...window.__SRC__.keys()][i].startsWith('vs') })));
  mkdirSync(join(OUT, `${tag}-src`), { recursive: true });
  let h = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(16); };
  for (const x of src.filter((x) => !x.vs).sort((a, b) => b.s.length - a.s.length).slice(0, 40)) writeFileSync(join(OUT, `${tag}-src`, `fs-${String(x.s.length).padStart(6, '0')}-${h(x.s)}.glsl`), x.s);
  for (const x of src.filter((x) => x.vs).sort((a, b) => b.s.length - a.s.length).slice(0, 8)) writeFileSync(join(OUT, `${tag}-src`, `vs-${String(x.s.length).padStart(6, '0')}-${h(x.s)}.glsl`), x.s);
}
const res = await page.evaluate(() => {
  const B = window.__GN_BOOTTRACE__;
  const playable = B.marks.find((m) => m.name === 'playable')?.t ?? 1e12;
  return { lines: B.lines(true), snap: B.snapshot(), gaps: window.__LT__.gaps.filter((g) => g[0] < playable), status: window.__LT__.status, progs: window.__GENESIS__.programs?.().length };
});
if (opts.shot) await page.screenshot({ path: join(OUT, `${tag}.png`) });
writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ query: opts.query, tReady, errors, ...res }, null, 1));
const txt = [`query: ${opts.query}`, `ready (wall, node side): ${tReady} ms`, `timer gaps > 100 ms before playable (start, length): ${res.gaps.map((g) => `${g[1]}@${g[0]}`).join(' ') || 'none'} | total ${res.gaps.reduce((a, g) => a + g[1], 0)} ms`,
  `boot card: ${res.status.map((s) => `${s[0]} "${s[1]}"`).join(' | ')}`, `errors: ${errors.length ? errors.join(' || ') : 'none'}`, ...res.lines].join('\n');
writeFileSync(join(OUT, `${tag}.txt`), txt);
console.log(txt.split('\n').slice(0, 12).join('\n'));
await browser.close();
