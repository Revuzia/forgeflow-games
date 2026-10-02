// PHYS filmstrips: renders each scripted scenario of _harness/physview in headless Chromium (software WebGL) and saves a
// 4x3 montage PNG per scenario to _shots/phys/<scenario>.png plus <scenario>.json (per-step metrics, events, hash).
// Deterministic: the viewer steps the sim with a fixed dt, no wall clock.
//   node _harness/browser_physics.mjs                       all scenarios
//   node _harness/browser_physics.mjs hold_squash pinch     some
//   node _harness/browser_physics.mjs --p '{"smOmega":40}'  physics param override (SoftParams) for tuning
//   node _harness/browser_physics.mjs --g 7 --detail 4      another genome / mesh detail
// Exits 1 on a console error, a failed request, a blank canvas, a non-finite sim or a safety-net reset.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, startVite, launch } from './pw.mjs';

const PORT = 5362;
const ALL = ['side_poke', 'hold_squash', 'pull_lobe', 'peak_flop', 'float_shove', 'pinch'];
const args = process.argv.slice(2);
const opt = {};
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--p' || args[i] === '--g' || args[i] === '--detail' || args[i] === '--out') opt[args[i].slice(2)] = args[++i];
  else names.push(args[i]);
}
const scenarios = names.length ? names : ALL;
const outDir = resolve(ROOT, '_shots', opt.out ?? 'phys');
mkdirSync(outDir, { recursive: true });

const vite = await startVite(PORT);
const browser = await launch();
let bad = 0;
try {
  for (const name of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
    const qs = new URLSearchParams({ scn: name });
    if (opt.p) qs.set('p', opt.p);
    if (opt.g) qs.set('g', opt.g);
    if (opt.detail) qs.set('detail', opt.detail);
    await page.goto(`${vite.url}_harness/physview/index.html?${qs}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__PV__ && window.__PV__.ready, null, { timeout: 90000 });
    const info = await page.evaluate(() => {
      const pv = window.__PV__;
      return { frames: pv.frames, log: pv.log, events: pv.events, simMs: pv.simMs, hash: pv.stateHash, safety: pv.safetyResets, restTop: pv.restTop };
    });
    // blank-canvas check: the montage must contain many distinct bright pixels
    const png = resolve(outDir, `${name}.png`);
    await page.locator('#wrap').screenshot({ path: png });
    const lit = await page.evaluate(() => {
      const c = document.getElementById('c');
      const g = document.createElement('canvas'); g.width = 200; g.height = 150;
      const x = g.getContext('2d'); x.drawImage(c, 0, 0, 200, 150);
      const d = x.getImageData(0, 0, 200, 150).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
      return n;
    });
    const finite = info.log.every((r) => Number.isFinite(r.vol) && Number.isFinite(r.top) && Number.isFinite(r.cy));
    writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify({ name, opt, ...info }, null, 1));
    const maxComp = Math.max(...info.log.map((r) => r.comp)), minVol = Math.min(...info.log.map((r) => r.vol)), maxVol = Math.max(...info.log.map((r) => r.vol));
    const maxStretch = Math.max(...info.log.map((r) => r.stretch)), maxFoot = Math.max(...info.log.map((r) => r.foot));
    const maxTop = Math.max(...info.log.map((r) => r.top)), maxCx = Math.max(...info.log.map((r) => Math.hypot(r.cx, r.cz)));
    const ok = problems.length === 0 && lit > 100 && finite && info.safety === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} sim ${info.simMs.toFixed(0)} ms  maxComp ${maxComp.toFixed(2)}  vol ${minVol.toFixed(3)}..${maxVol.toFixed(3)}  stretch ${maxStretch.toFixed(2)}  top ${maxTop.toFixed(3)} (rest ${info.restTop.toFixed(3)})  footLift ${maxFoot.toFixed(3)}  drift ${maxCx.toFixed(3)}  events ${info.events.map((e) => e.kind).join(',') || '-'}  lit ${lit}${problems.length ? '\n   ' + problems.join('\n   ') : ''}${info.safety ? '\n   safetyResets ' + info.safety : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`filmstrips in ${outDir}`);
process.exit(bad ? 1 : 0);
