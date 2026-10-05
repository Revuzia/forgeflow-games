// PHYS filmstrips: renders each scripted scenario of _harness/physview in headless Chromium (software WebGL) and saves a
// 4x3 montage PNG per scenario to _shots/phys/<scenario>.png plus <scenario>.json (per-step metrics, events, hash).
// Deterministic: the viewer steps the sim with a fixed dt, no wall clock.
//   node _harness/browser_physics.mjs                       all scenarios
//   node _harness/browser_physics.mjs hold_squash pinch     some
//   node _harness/browser_physics.mjs --p '{"smOmega":40}'  physics param override (SoftParams) for tuning; --f '{"friction":0.5}' overrides FINGER constants
//   node _harness/browser_physics.mjs --g 7 --detail 4      another genome / mesh detail
//   node _harness/browser_physics.mjs hold_squash --gf 1 --gb 1 --gs 0 --gz 1 --tag firm   genome extremes, files get a _<tag> suffix
//   node _harness/browser_physics.mjs press_close --px 0.2 --tag x20 --q mark=1             close-up of a hold at x=0.2, folded triangles magenta
//   (--q passes extra viewer params: frames=t1,..,t12  cd=<camera distance>  ct=x,y,z  yaw=  pitch=  mark=1)
//   node _harness/browser_physics.mjs family_demo --family slowrise --tag slowrise    a material family on the DOLLOP shape
//   node _harness/browser_physics.mjs family_demo --species tidelume --tag tidelume  a catalog species (its shape and its family)
//   node _harness/browser_physics.mjs --sheet                 the 50-species rest contact sheet (_harness/physview/sheet.html) -> species_sheet.png
// Each strip prints the worst mesh FOLD (largest dihedral between adjacent triangles; the rest shape's own maximum is ~50 deg) and the fold
// left in the last frame (a folded flap that is still there at the end is a FAIL: > 90 deg means a tucked-under triangle).
// Exits 1 on a console error, a failed request, a blank canvas, a non-finite sim, a safety-net reset or a fold left in the last frame.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, startVite, launch } from './pw.mjs';

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) > 0 && process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 5362;   // --port <n> when 5362 is taken
const FOLD_END_MAX = 90;   // degrees: a settled-ish last frame may not hold a crease sharper than this (rest shape max ~50)
const ALL = ['side_poke', 'hold_squash', 'pull_lobe', 'peak_flop', 'float_shove', 'pinch', 'top_peak_poke', 'top_peak_hold', 'hold_close', 'hold_shoulder', 'peak_shove', 'peak_rest_close', 'pinch_stagger',
  'tap_close', 'press_close', 'edge_low', 'edge_rim', 'fast_tap1', 'fast_tap3', 'rub', 'pull_far', 'pull_peak', 'mat_nudge', 'rub_peak', 'pinch_peak', 'tip_tap'];
const args = process.argv.slice(2);
const opt = {};
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--p' || args[i] === '--f' || args[i] === '--g' || args[i] === '--detail' || args[i] === '--out' || args[i] === '--px' || args[i] === '--tag' || args[i] === '--gf' || args[i] === '--gb' || args[i] === '--gs' || args[i] === '--gz' || args[i] === '--q' || args[i] === '--family' || args[i] === '--species') opt[args[i].slice(2)] = args[++i];
  else if (args[i] === '--sheet') opt.sheet = true;
  else if (args[i] === '--port') i++;
  else names.push(args[i]);
}
const scenarios = opt.sheet ? ['species_sheet'] : names.length ? names : ALL;
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
    if (opt.f) qs.set('f', opt.f);
    if (opt.g) qs.set('g', opt.g);
    if (opt.detail) qs.set('detail', opt.detail);
    if (opt.px) qs.set('px', opt.px);
    if (opt.family) qs.set('family', opt.family);
    if (opt.species) qs.set('species', opt.species);
    for (const k of ['gf', 'gb', 'gs', 'gz']) if (opt[k] !== undefined) qs.set(k, opt[k]);
    if (opt.q) for (const [k, v] of new URLSearchParams(opt.q)) qs.set(k, v);   // --q 'frames=1.2,1.3&cd=1.6&ct=0,0.7,0' ad-hoc camera / frame overrides
    await page.goto(`${vite.url}_harness/physview/${opt.sheet ? 'sheet' : 'index'}.html?${qs}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__PV__ && window.__PV__.ready, null, { timeout: 90000 });
    const info = await page.evaluate(() => {
      const pv = window.__PV__;
      return { frames: pv.frames, log: pv.log, events: pv.events, simMs: pv.simMs, hash: pv.stateHash, safety: pv.safetyResets, restTop: pv.restTop };
    });
    // blank-canvas check: the montage must contain many distinct bright pixels
    const stem = opt.tag ? `${name}_${opt.tag}` : name;
    const png = resolve(outDir, `${stem}.png`);
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
    writeFileSync(resolve(outDir, `${stem}.json`), JSON.stringify({ name, opt, ...info }, null, 1));
    const maxComp = Math.max(...info.log.map((r) => r.comp)), minVol = Math.min(...info.log.map((r) => r.vol)), maxVol = Math.max(...info.log.map((r) => r.vol));
    const maxStretch = Math.max(...info.log.map((r) => r.stretch)), maxFoot = Math.max(...info.log.map((r) => r.foot));
    const maxTop = Math.max(...info.log.map((r) => r.top)), maxCx = Math.max(...info.log.map((r) => Math.hypot(r.cx, r.cz)));
    const foldMax = Math.max(...info.log.map((r) => r.fold)), foldEnd = info.log[info.log.length - 1].fold, inwardMax = Math.max(...info.log.map((r) => r.inward));
    const ok = problems.length === 0 && lit > 100 && finite && info.safety === 0 && foldEnd <= FOLD_END_MAX;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} sim ${info.simMs.toFixed(0)} ms  maxComp ${maxComp.toFixed(2)}  vol ${minVol.toFixed(3)}..${maxVol.toFixed(3)}  stretch ${maxStretch.toFixed(2)}  top ${maxTop.toFixed(3)} (rest ${info.restTop.toFixed(3)})  footLift ${maxFoot.toFixed(3)}  drift ${maxCx.toFixed(3)}  fold max ${foldMax.toFixed(0)} end ${foldEnd.toFixed(0)} inward ${inwardMax}  events ${info.events.map((e) => e.kind).join(',') || '-'}  lit ${lit}${problems.length ? '\n   ' + problems.join('\n   ') : ''}${info.safety ? '\n   safetyResets ' + info.safety : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  vite.stop();
}
console.log(`filmstrips in ${outDir}`);
process.exit(bad ? 1 : 0);
