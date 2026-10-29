// VALE harness — perf PERF-m5: the triangle LODs (src/render/lod.ts) A/B on the real renderer in real Chrome (GPU).
// A production build of the render bench (vite build into _harness/_prod/dist; --no-build reuses it), RIFT at High,
// the camera on the densest fight at `--t`, the sim held: the same frame drawn with the LODs (every shadow caster's
// shadow LOD, the crowd's outline-hull LOD) and without them.
//
//   node _harness/probe_lod.mjs [--no-build] [--t 900] [--seed 7] [--out _harness/_reports/fw_W1_lod.json]
//
// Reports the frame's triangles by group and pass both ways, and the pixel difference of the two frames. Checks
// (exit 1 on a miss): the shadow pass draws <= 40 % of its triangles; the whole frame draws fewer; the two frames
// differ by a mean of <= 1.5 levels with <= 0.5 % of pixels more than 24 levels apart (the LODs keep the picture).
// Shots: _harness/_shots/fw_W1_lod_{on,off}.png
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 900)), SEED = Number(opt('seed', 7));
const OUT = resolve(ROOT, opt('out', '_harness/_reports/fw_W1_lod.json'));
const PROD_DIR = join(HERE, '_prod', 'dist');

async function freePort() {
  for (let p = 5191; p <= 5199; p++) {
    const ok = await new Promise((res) => { const s = createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(p, 'localhost'); });
    if (ok) return p;
  }
  throw new Error('no free port in 5191-5199');
}
const vite = await import('vite');
const configFile = join(ROOT, 'vite.config.ts');
if (!args.includes('--no-build') || !existsSync(join(PROD_DIR, '_harness/web/render_bench.html'))) {
  await vite.build({ configFile, root: ROOT, logLevel: 'warn', build: { outDir: PROD_DIR, emptyOutDir: true, rolldownOptions: { input: { bench: join(HERE, 'web/render_bench.html') } } } });
}
mkdirSync(join(PROD_DIR, 'art/out/_proof'), { recursive: true });
copyFileSync(join(ROOT, 'art/out/_proof/_proof_mannequin.glb'), join(PROD_DIR, 'art/out/_proof/_proof_mannequin.glb'));
const port = await freePort();
const server = await vite.preview({ configFile, root: ROOT, logLevel: 'warn', build: { outDir: PROD_DIR }, preview: { port, strictPort: true, host: 'localhost', open: false } });
process.env.VALE_URL = `http://localhost:${port}`;
const { open, shot } = await import('./pw.mjs');

function compare(a, b) {
  const py = `
import sys, json
from PIL import Image, ImageChops, ImageStat
a = Image.open(sys.argv[1]).convert('RGB'); b = Image.open(sys.argv[2]).convert('RGB')
d = ImageChops.difference(a, b)
m = ImageStat.Stat(d).mean
g = d.convert('L')
hist = g.histogram(); big = sum(hist[25:]); n = a.width * a.height
print(json.dumps({'meanAbsDiff': round(sum(m) / 3, 3), 'over24Share': round(big / n, 5)}))`;
  for (const p of [process.env.VALE_PYTHON, join(ROOT, '..', '..', '.venv', 'bin', 'python3'), 'python3'].filter(Boolean)) {
    try { return JSON.parse(execFileSync(p, ['-c', py, a, b], { encoding: 'utf8' }).trim()); } catch { /* next */ }
  }
  return null;
}
const sum = (g) => ({ main: g.tris, shadow: g.shadowTris, calls: g.calls + g.shadowCalls });

const rep = { at: new Date().toISOString(), t: T, seed: SEED };
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
  if (err) throw new Error(`bench failed: ${err}`);
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B((b) => { b.frames(90, 1 / 30); });
  await page.waitForTimeout(4000);
  await B((b) => { b.frames(60, 1 / 30); const f = b.fight(); if (f) b.focus(f.x, f.y); for (let i = 0; i < 12; i++) b.renderer.render(1 / 30); });
  const frame = async (on) => B(async (b, lodOn) => {
    const R = b.renderer;
    R.lodSwitch.shadow = lodOn;
    // the crowd's hull views keep their full index in userData (crowd.ts)
    R.crowd.group.traverse((o) => {
      const g = o.geometry;
      if (!g?.userData?.fullIndex) return;
      g.userData.lodIndex ??= g.index;
      g.setIndex(lodOn ? g.userData.lodIndex : g.userData.fullIndex);
    });
    R.vfx.clear();
    for (let i = 0; i < 6; i++) R.render(0);
    const pending = R.profile();                                             // resolves on the next drawn frame
    R.render(0);
    const p = await pending;
    const groups = {};
    for (const [k, g] of Object.entries(p.groups)) if (g.calls + g.shadowCalls > 0) groups[k] = { main: g.tris, shadow: g.shadowTris, calls: g.calls + g.shadowCalls };
    const detail = {};
    for (const [k, g] of Object.entries(p.detail)) if (g.tris + g.shadowTris > 3000) detail[k] = { main: g.tris, shadow: g.shadowTris };
    let shadowTris = 0, mainTris = 0;
    for (const g of Object.values(p.groups)) { shadowTris += g.shadowTris; mainTris += g.tris; }
    return { total: p.total, mainTris, shadowTris, groups, detail, stats: { actors: R.stats().actors, particles: R.stats().particles } };
  }, on);
  // one frame each way, LOD last so the shot pair is taken from identical states
  rep.off = await frame(false);
  const fileOff = await shot(page, 'fw_W1_lod_off');
  rep.on = await frame(true);
  const fileOn = await shot(page, 'fw_W1_lod_on');
  rep.compare = compare(fileOff, fileOn);
  rep.lodStats = await B((b) => {
    let casters = 0, hooked = 0;
    b.renderer.scene.traverseVisible((o) => { if (o.isMesh && o.castShadow) { casters++; if (Object.prototype.hasOwnProperty.call(o, 'onBeforeShadow')) hooked++; } });
    return { casters, hooked };
  });
  const c = {};
  c.shadowShare = { off: rep.off.shadowTris, on: rep.on.shadowTris, share: +(rep.on.shadowTris / Math.max(1, rep.off.shadowTris)).toFixed(3) };
  c.shadowShare.pass = c.shadowShare.share <= 0.4;
  c.frame = { off: rep.off.total.tris, on: rep.on.total.tris, pass: rep.on.total.tris < rep.off.total.tris };
  c.picture = { ...(rep.compare ?? { error: 'no Pillow' }), pass: !!rep.compare && rep.compare.meanAbsDiff <= 1.5 && rep.compare.over24Share <= 0.005 };
  c.console = { errors: logs.filter((l) => !/favicon/.test(l)).slice(0, 10), pass: logs.filter((l) => !/favicon/.test(l)).length === 0 };
  rep.checks = c;
  rep.pass = Object.values(c).every((x) => x.pass);
  for (const [k, v] of Object.entries(c)) console.log(`${k.padEnd(12)} ${v.pass ? 'PASS' : 'FAIL'}  ${JSON.stringify({ ...v, pass: undefined })}`);
  console.log('groups off', JSON.stringify(rep.off.groups));
  console.log('groups on ', JSON.stringify(rep.on.groups));
} catch (e) {
  rep.error = e.stack ?? String(e); rep.pass = false;
  console.log('probe_lod failed:', e.message);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1));
console.log(`probe_lod: ${rep.pass ? 'PASS' : 'FAIL'} -> ${OUT}`);
process.exit(rep.pass ? 0 : 1);
