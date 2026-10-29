// VALE harness — perf PERF-m4: WebGL context loss and restore in a live RIFT match, on the real renderer in real
// Chrome (GPU). A production build of the render bench (vite build into _harness/_prod/dist, served by `vite preview`
// on the first free port in 5191-5199), manual frames so the same match state can be drawn before and after.
//
//   node _harness/probe_ctxloss.mjs [--no-build] [--t 120] [--seed 7] [--out _harness/_reports/fw_W1_ctxloss.json]
//
// Steps: the match at High with dynamic resolution on; a fixed view (your fighter) and an ultimate's VFX drawn with the
// sim held -> shot A. WEBGL_lose_context.loseContext(), 40 frames -> viewState must say 'lost', dynamic resolution must
// sample nothing. restoreContext() -> 'restoring', then 'ok' once the programs are rebuilt (frames drawn meanwhile).
// The same view and VFX again -> shot B. Checks (exit 1 on a miss):
//   * viewState goes ok -> lost -> restoring -> ok (the HUD's 'Restoring the view' plate follows it)
//   * no console warning or error from the GPU timer or anything else after the restore (the old build logged a
//     'getQueryParameter: object does not belong to this context' warning every frame)
//   * the GPU timer measures again on the new context (stats().gpuMs a number) and the render scale is the one it had
//   * the restored frame matches the first: mean luma within 3 %, mean absolute pixel difference <= 4 levels
//     (an un-rebaked sky PMREM leaves the world lit by the sun alone; an un-regenerated VFX atlas draws no particles)
//   * the live programs come back within 10 % of the count before the loss
// Shots: _harness/_shots/fw_W1_ctxloss_{a_before,b_lost,c_restored}.png
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 120)), SEED = Number(opt('seed', 7));
const OUT = resolve(ROOT, opt('out', '_harness/_reports/fw_W1_ctxloss.json'));
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

/** mean luma and the mean absolute difference of two screenshots' 3D area (Pillow; the HUD box is off) */
function compare(a, b) {
  const py = `
import sys, json
from PIL import Image, ImageChops, ImageStat
a = Image.open(sys.argv[1]).convert('RGB'); b = Image.open(sys.argv[2]).convert('RGB')
box = (0, 0, a.width, a.height)
la = ImageStat.Stat(a.convert('L')).mean[0]; lb = ImageStat.Stat(b.convert('L')).mean[0]
d = ImageStat.Stat(ImageChops.difference(a, b)).mean
print(json.dumps({'lumaA': round(la, 2), 'lumaB': round(lb, 2), 'meanAbsDiff': round(sum(d) / 3, 2)}))`;
  const pys = [process.env.VALE_PYTHON, join(ROOT, '..', '..', '.venv', 'bin', 'python3'), 'python3'].filter(Boolean);
  for (const p of pys) { try { return JSON.parse(execFileSync(p, ['-c', py, a, b], { encoding: 'utf8' }).trim()); } catch { /* next */ } }
  return null;
}

const rep = { at: new Date().toISOString(), t: T, seed: SEED, checks: {} };
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1&dyn=1`, { wait: false, hmr: false });
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
  if (err) throw new Error(`bench failed: ${err}`);
  const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
  await B((b) => { b.frames(90, 1 / 30); });
  await page.waitForTimeout(4000);                                         // textures, props, landmarks land
  await B((b) => {
    const R = b.renderer;
    window.__views = [R.viewState];
    R.onViewState((s) => window.__views.push(s));
    b.frames(30, 1 / 30);
  });
  // the fixed view: your fighter, an ultimate's VFX at it, the sim held (dt 0 frames redraw the same state)
  const scene = async (name) => B((b, nm) => {
    const me = b.you();
    b.focus(me.x, me.y); b.zoom(26);
    b.renderer.vfx.clear();
    for (let i = 0; i < 6; i++) b.renderer.render(1 / 30);                // camera settles (no sim pump)
    b.renderer.vfxTest('lib_ult_lumen', me.x + 2, me.y, { tier: 4 });
    for (let i = 0; i < 9; i++) b.renderer.render(1 / 30);
    const s = b.renderer.stats();
    return { name: nm, programs: s.programs, calls: s.calls, tris: s.triangles, scale: s.renderScale, gpuMs: s.gpuMs, vfx: s.vfx, particles: s.particles, view: b.renderer.viewState };
  }, name);
  // a few live frames so the GPU timer has readings
  await B((b) => { for (let i = 0; i < 40; i++) b.renderer.render(1 / 60); });
  rep.before = await scene('before');
  const fileA = await shot(page, 'fw_W1_ctxloss_a_before');
  const warnBefore = logs.length;
  rep.lost = await B((b) => {
    const gl = b.renderer.gl.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { error: 'no WEBGL_lose_context' };
    window.__ctxExt = ext;
    ext.loseContext();
    return { ok: true };
  });
  await page.waitForTimeout(300);
  rep.during = await B((b) => {
    const R = b.renderer;
    for (let i = 0; i < 40; i++) R.render(1 / 60);
    return { view: R.viewState, dynFrames: R.dyn.frames, scale: R.stats().renderScale };
  });
  await shot(page, 'fw_W1_ctxloss_b_lost');
  await page.waitForTimeout(1500);
  const warnLost = logs.length;
  const t0 = Date.now();
  await B(() => window.__ctxExt.restoreContext());
  // draw frames while the restore compiles; poll until 'ok'
  let okAfter = null;
  for (let i = 0; i < 200; i++) {
    const v = await B((b) => { for (let k = 0; k < 4; k++) b.renderer.render(1 / 60); return b.renderer.viewState; });
    if (v === 'ok' && i > 0) { okAfter = Date.now() - t0; break; }
    await page.waitForTimeout(50);
  }
  rep.restoreMs = okAfter;
  await B((b) => { for (let i = 0; i < 60; i++) b.renderer.render(1 / 60); });
  rep.after = await scene('after');
  const fileC = await shot(page, 'fw_W1_ctxloss_c_restored');
  rep.views = await page.evaluate(() => window.__views);
  rep.holdLeftMs = await B((b) => Math.max(0, Math.round(b.renderer.dynHoldUntil - performance.now())));
  rep.logsBefore = logs.slice(0, warnBefore).filter((l) => !/favicon/.test(l)).slice(0, 10);
  rep.logsWhileLost = logs.slice(warnBefore, warnLost).slice(0, 10);
  rep.logsAfterRestore = logs.slice(warnLost).slice(0, 20);
  rep.logCountAfterRestore = logs.length - warnLost;
  rep.compare = compare(fileA, fileC);

  const c = rep.checks;
  const seq = rep.views.join('>');
  c.viewSequence = { got: seq, pass: /ok>lost>restoring>ok$/.test(seq) };
  c.lostState = { got: rep.during.view, dynSampled: rep.during.dynFrames, pass: rep.during.view === 'lost' && rep.during.dynFrames === 0 };
  c.restored = { ms: okAfter, pass: okAfter !== null };
  c.consoleAfterRestore = { count: rep.logCountAfterRestore, pass: rep.logCountAfterRestore === 0 };
  c.gpuTimer = { before: rep.before.gpuMs, after: rep.after.gpuMs, pass: rep.before.gpuMs === null || typeof rep.after.gpuMs === 'number' };
  c.scale = { before: rep.before.scale, after: rep.after.scale, pass: rep.before.scale === rep.after.scale };
  c.programs = { before: rep.before.programs, after: rep.after.programs, pass: rep.after.programs >= Math.floor(rep.before.programs * 0.9) };
  if (rep.compare) {
    const r = rep.compare.lumaB / Math.max(1, rep.compare.lumaA);
    c.frame = { ...rep.compare, ratio: +r.toFixed(3), pass: Math.abs(1 - r) <= 0.03 && rep.compare.meanAbsDiff <= 4 };
  } else c.frame = { pass: false, error: 'no Pillow to compare the shots' };
  rep.pass = Object.values(c).every((x) => x.pass);
  for (const [k, v] of Object.entries(c)) console.log(`${k.padEnd(20)} ${v.pass ? 'PASS' : 'FAIL'}  ${JSON.stringify({ ...v, pass: undefined })}`);
} catch (e) {
  rep.error = e.stack ?? String(e); rep.pass = false;
  console.log('probe_ctxloss failed:', e.message);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1));
console.log(`probe_ctxloss: ${rep.pass ? 'PASS' : 'FAIL'} -> ${OUT}`);
process.exit(rep.pass ? 0 : 1);
