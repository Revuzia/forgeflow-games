// WOBBLEHOARD RENDER probe (Chromium + SwiftShader), the render half of gate G3.
//   node _harness/browser_render.mjs [--body=stub|real|auto] [--quick] [--no-perf]
//
// Drives _harness/renderview (the Stage + the real soft body when src/physics/softbody.ts loads, else the dev stub) and:
//   * captures _shots/render/*.png: rest, mid-press, held press, release +80 / +250 ms, pulled, float, bounce + landing dust/ring, one per quality
//     tier, eyes tracking left vs right, bubbles mid-flight, glitter close-up, a 6-genome contact sheet, a 390x844 phone view;
//   * asserts 0 console errors/warnings (incl. shader compile errors), 0 failed requests, and that no canvas is blank;
//   * prints per-tier draw calls, triangles, fine-mesh vertices, synchronous ms/frame and the frame-time EMA;
//   * checks: 20x setBody leak test, dispose() releasing everything, context loss/restore, per-frame JS allocation,
//     auto-quality drop and explicit tier switching mid-session, DPR caps.
// SwiftShader is a CPU rasteriser: only the RELATIVE cost between tiers means anything here.
import { startVite, launch, ROOT } from './pw.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeStarterGenome } from '../src/core/genome.ts';

process.env.WH_FROZEN ??= '1'; // no HMR / watcher: another lane's edit must not reload the page mid-run
const args = process.argv.slice(2);
const flag = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : args.includes(`--${name}`) ? true : dflt; };
const BODY = flag('body', 'auto');
const QUICK = !!flag('quick', false);
const NO_PERF = QUICK || !!flag('no-perf', false);
const PORT = 5364;
const OUT = resolve(ROOT, '_shots/render');
const REPORT_DIR = resolve(ROOT, '_harness/_reports');
mkdirSync(OUT, { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });

const failures = [];
const report = { when: new Date().toISOString(), body: null, shots: [], problems: [], perf: {}, checks: {} };
const check = (ok, name, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
  report.checks[name] = { ok, extra };
  if (!ok) failures.push(name);
};

const srv = await startVite(PORT);
const browser = await launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });

/** Collect console errors / warnings / page errors / failed requests. `allow` = regexes of expected messages. */
function watch(page, label, allow = []) {
  const bad = [];
  const note = (kind, text) => {
    if (/\[vite\]/.test(text)) return;
    if (allow.some((r) => r.test(text))) return;
    bad.push(`[${label}] ${kind}: ${text}`);
  };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') note(m.type(), m.text()); });
  page.on('pageerror', (e) => note('pageerror', e.message));
  page.on('requestfailed', (r) => note('requestfailed', r.url()));
  page.on('crash', () => note('crash', 'page crashed'));
  return bad;
}

async function openView(ctx, query, label, allow = []) {
  const page = await ctx.newPage();
  const bad = watch(page, label, allow);
  await page.goto(`http://localhost:${PORT}/_harness/renderview/index.html?${query}`);
  await page.waitForFunction(() => window.__RV_READY__ === true, null, { timeout: 280000 });
  return { page, bad };
}

const b64 = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
async function shot(page, name, js = '') {
  const r = await page.evaluate((js) => {
    const R = window.__RV__;
    if (js) new Function('R', js)(R);
    const s = R.snapshotStats();
    return { png: s.png, stats: s.stats, info: R.info(), st: R.stage.stats() };
  }, js);
  writeFileSync(resolve(OUT, `${name}.png`), b64(r.png));
  const ok = r.stats.std > 8 && r.stats.nonBg > 0.2 && r.stats.distinct > 200;
  check(ok, `shot ${name} is not blank`, `std=${r.stats.std.toFixed(1)} nonBg=${(r.stats.nonBg * 100).toFixed(0)}% colours=${r.stats.distinct} tier=${r.st.tier} calls=${r.st.drawCalls}`);
  report.shots.push({ name, ...r.stats, tier: r.st.tier, drawCalls: r.st.drawCalls, triangles: r.st.triangles });
  return r;
}

async function sheet(ctx, name, cells, cols, cw, ch) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: cw * cols, height: ch * Math.ceil(cells.length / cols) });
  await p.setContent(`<body style="margin:0;background:#000;font:13px sans-serif;color:#fff;display:grid;grid-template-columns:repeat(${cols},${cw}px)">${cells.map(([n, png]) => `<div style="position:relative"><img src="${png}" width=${cw} height=${ch}><span style="position:absolute;left:6px;top:4px;text-shadow:0 0 3px #000">${n}</span></div>`).join('')}</body>`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: resolve(OUT, `${name}.png`) });
  await p.close();
}

try {
  /* ───────────────────────── main session: poses, tiers, eyes, fx, genomes ───────────────────────── */
  const W = 720, H = 540;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const { page, bad } = await openView(ctx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, 'main');
  const kind = await page.evaluate(() => ({ kind: window.__RV__.bodyKind, err: window.__RV__.bodyError }));
  report.body = kind;
  console.log(`soft body: ${kind.kind}${kind.err ? ' (' + kind.err + ')' : ''}`);
  if (BODY === 'real') check(kind.kind === 'real', 'real soft body loaded', kind.err ?? '');

  await shot(page, 'rest');
  await shot(page, 'press_mid', 'R.press(0.0, 0.15, 0.9, 0.9); R.frames(21)');
  await shot(page, 'press_held', 'R.frames(39)');
  await shot(page, 'release_t80ms', 'R.release(); R.frames(5)');
  await shot(page, 'release_t250ms', 'R.frames(10)');
  await shot(page, 'pull_stretched', 'R.frames(120); R.pull(0.0, 0.3, 0.3, 0.6); R.frames(40)');
  await shot(page, 'snap_t100ms', 'R.releasePull(); R.frames(6)');
  await shot(page, 'float', 'R.frames(120); R.setGravity(false); R.frames(150)');
  await shot(page, 'float_poked', 'R.press(0.1, 0.0, 0.7, 0.4); R.frames(20)');
  await shot(page, 'bounce_airborne', 'R.release(); R.setGravity(true); R.frames(90); R.nudge(0, 3.2, 0); R.frames(18)');
  await shot(page, 'bounce_land_dust', 'R.framesUntilEvent("land", 150); R.frames(7)');

  // each quality tier, same settled pose
  const tiers = {};
  await page.evaluate(() => { const R = window.__RV__; R.frames(150); });
  for (const q of ['low', 'med', 'high']) {
    const r = await shot(page, `tier_${q}`, `R.setQuality('${q}'); R.frames(2)`);
    tiers[q] = { fineVertices: r.info.fineVertices, drawCalls: r.st.drawCalls, triangles: r.st.triangles };
  }
  report.perf.tiers = tiers;
  check(tiers.high.fineVertices >= 10000 && tiers.med.fineVertices >= 5000 && tiers.low.fineVertices < tiers.med.fineVertices && tiers.low.fineVertices >= 2000,
    'fine mesh >= ~5k verts on med/high, fewer on low', `high ${tiers.high.fineVertices} / med ${tiers.med.fineVertices} / low ${tiers.low.fineVertices}`);
  check(tiers.low.triangles < tiers.med.triangles && tiers.med.triangles < tiers.high.triangles, 'triangle count rises with tier', `${tiers.low.triangles} / ${tiers.med.triangles} / ${tiers.high.triangles}`);
  await page.evaluate(() => { window.__RV__.setQuality('med'); window.__RV__.frames(2); });

  // DPR caps per tier
  const dpr = await page.evaluate(() => {
    const R = window.__RV__, out = {};
    for (const q of ['low', 'med', 'high']) { R.setQuality(q); R.resize(300, 200, 3); out[q] = R.info().pixelRatio; }
    R.setQuality('med'); R.resize(720, 540, 1);
    return out;
  });
  check(dpr.low <= 1 && dpr.med <= 1.5 && dpr.high <= 2 && dpr.high === 2, 'resize() caps DPR per tier', JSON.stringify(dpr));

  // eyes follow the pointer: left vs right
  await page.evaluate(() => { const R = window.__RV__; R.frames(60); R.zoom(-3); R.setPointer(-0.9, 0.05); R.frames(40); });
  const left = await shot(page, 'eyes_pointer_left');
  await page.evaluate(() => { const R = window.__RV__; R.setPointer(0.9, 0.05); R.frames(40); });
  const right = await shot(page, 'eyes_pointer_right');
  const lk = [left.info.eyeLook, right.info.eyeLook];
  check(lk[0] && lk[1] && lk[0][0] < -0.25 && lk[0][2] < -0.25 && lk[1][0] > 0.25 && lk[1][2] > 0.25, 'iris/glints follow pointerNdc (left vs right)', `left look x=${lk[0]?.[0].toFixed(2)},${lk[0]?.[2].toFixed(2)} right look x=${lk[1]?.[0].toFixed(2)},${lk[1]?.[2].toFixed(2)}`);
  await page.evaluate(() => { const R = window.__RV__; R.setPointer(null); R.zoom(3); R.frames(30); });

  // camera rig
  const cam = await page.evaluate(() => window.__RV__.cameraProbe());
  report.checks.camera = cam;
  check(cam.finite === 1, 'camera stays finite under NaN / huge inputs');
  check(cam.lowestPitchDeg > 2 && cam.lowestCameraY > 0.5 && cam.highestPitchDeg < 85, 'orbit pitch is clamped (never under the table, never top-down)', `pitch ${cam.lowestPitchDeg.toFixed(1)}..${cam.highestPitchDeg.toFixed(1)} deg, lowest camera y ${cam.lowestCameraY.toFixed(2)}`);
  check(cam.farthest > 1.5 && cam.farthest < 2.1 && cam.nearest > 0.45 && cam.nearest < 0.65, 'zoom is clamped', `distance ${cam.nearest.toFixed(2)}x .. ${cam.farthest.toFixed(2)}x of the framing distance`);
  check(cam.orbitMovesCameraAfter2Frames > 0.01 && cam.orbitMovesCameraAfter2Frames < cam.orbitMovedAfterSettle * 0.6 && cam.orbitMovedAfterSettle > 0.5, 'orbit is damped (moves smoothly, then settles)', `after 2 frames ${cam.orbitMovesCameraAfter2Frames.toFixed(2)}, settled ${cam.orbitMovedAfterSettle.toFixed(2)}`);
  check(cam.shakeOffsetFrame1 > 0.005 && cam.shakeOffsetAfter2s < 0.002 && cam.shakeOffsetWhenScale0 < 1e-6, 'shake impulse decays, and setShakeScale(0) disables it', `frame1 ${cam.shakeOffsetFrame1.toFixed(3)}, frame9 ${cam.shakeOffsetFrame9.toFixed(3)}, after 2 s ${cam.shakeOffsetAfter2s.toFixed(4)}, scale 0: ${cam.shakeOffsetWhenScale0.toExponential(1)}`);
  await page.evaluate(() => { const R = window.__RV__; R.orbit(0, 0.0); R.frames(120); });

  // bubbles mid-flight, glitter close-up
  const bub = await shot(page, 'bubbles_midflight', 'R.setAutoFx(false); R.spawn("bubbles", 0, 0.8, 0.1, 0.9); R.frames(34)');
  check((bub.info.fx?.bubbles ?? 0) > 3, 'bubbles are alive mid-flight', `${bub.info.fx?.bubbles}`);
  const glitterGenome = { ...makeStarterGenome(), glitter: 1, hue: 292, coreHue: 340, chroma: 0.8 };
  await page.evaluate((g) => { const R = window.__RV__; R.setGenomeObject(g); R.frames(100); R.zoom(-5); R.frames(30); }, glitterGenome);
  const gl = await shot(page, 'glitter_closeup', 'R.spawn("glitter", 0.2, 0.5, 0.5, 0.8); R.frames(10)');
  check((gl.info.fx?.glitter ?? 0) >= 100, 'glitter specks suspended in the body (genome.glitter = 1)', `${gl.info.fx?.glitter}`);
  await page.evaluate(() => { window.__RV__.zoom(5); window.__RV__.setAutoFx(true); });

  // 6-genome contact sheet (rest pose)
  const seeds = ['', '1', '2', '3', '4', '5'];
  const cells = [];
  for (const s of seeds) {
    const png = await page.evaluate((s) => { const R = window.__RV__; R.setGenome(s); R.frames(110); return R.snapshot(); }, s);
    cells.push([s === '' ? 'DOLLOP (starter)' : `seed ${s}`, png]);
  }
  await sheet(ctx, 'contact_sheet_6', cells, 3, 480, 360);
  console.log('wrote contact_sheet_6.png');
  report.problems.push(...bad);
  await ctx.close();

  /* ───────────────────────── phone viewport ───────────────────────── */
  {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const { page: pp, bad: pbad } = await openView(pctx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, 'phone');
    await shot(pp, 'phone_390x844');
    await shot(pp, 'phone_390x844_press', 'R.press(0.0, 0.1, 0.9, 0.9); R.frames(36)');
    const sw = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, db: window.__RV__.info().drawingBuffer, pr: window.__RV__.info().pixelRatio }));
    check(sw.sw <= sw.iw, 'phone: no horizontal scroll', `scrollWidth ${sw.sw} <= innerWidth ${sw.iw}; drawing buffer ${sw.db.join('x')} @ DPR ${sw.pr}`);
    report.problems.push(...pbad);
    await pctx.close();
  }

  /* ───────────────────────── lifecycle: leaks, dispose, context loss, allocation, auto tier ───────────────────────── */
  {
    const lctx = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
    const { page: lp, bad: lbad } = await openView(lctx, `quality=low&body=${BODY === 'auto' ? '' : BODY}`, 'lifecycle');

    const m1 = await lp.evaluate(() => window.__RV__.memoryCycles(20, false));
    const pick = (a, k) => a.map((x) => x[k]);
    const same = (a, k, from) => a.slice(from).every((x) => x[k] === a[from][k]);
    check(['geometries', 'textures', 'programs'].every((k) => same(m1, k, 3)), '20x setBody (same genome): renderer.info.memory is flat after warm-up', `geometries ${pick(m1, 'geometries').join(',')} | textures ${m1[19].textures} | programs ${m1[19].programs}`);
    // 5 genomes repeated 4x: whatever the first lap used, laps 2-4 must not add anything (geometry +1 slack: the happy-arc mesh is uploaded lazily the first time an eye squints)
    const m2 = await lp.evaluate(() => window.__RV__.memoryCycles(20, true));
    const lap = (k) => [0, 1, 2, 3, 4].map((j) => [5, 10, 15].map((o) => m2[o + j][k]));
    const geoOk = lap('geometries').every((l, j) => Math.max(...l) - m2[j].geometries <= 1);
    const texOk = same(m2, 'textures', 1);
    const progOk = [5, 6, 7, 8, 9].every((i) => m2[i + 5].programs === m2[i].programs && m2[i + 10].programs === m2[i].programs);
    check(geoOk && texOk && progOk, '20x setBody (5 genomes x 4 laps): laps 2-4 add no geometries / textures / programs', `geometries ${pick(m2, 'geometries').join(',')} | textures ${pick(m2, 'textures').join(',')} | programs ${pick(m2, 'programs').join(',')}`);
    report.checks.leakSeries = { sameGenome: m1, variants: m2 };

    const lc = await lp.evaluate(() => window.__RV__.lifecycle(20));
    // three keeps its transmission render target and the shared DFG lookup texture alive inside the renderer and never exposes
    // them, so renderer.dispose() leaves exactly those 2 textures counted; everything we created must be gone.
    check(!lc.err && lc.endAfterDispose.geometries === 0 && lc.endAfterDispose.textures <= 2 && lc.endAfterDispose.programs === 0, 'stage.dispose() releases every geometry, material program and our textures (second stage, 20 setBody cycles, then dispose)', `after cycles: geometries ${lc.after[19]?.geometries} textures ${lc.after[19]?.textures}; after dispose: geometries ${lc.endAfterDispose.geometries} textures ${lc.endAfterDispose.textures} (<= 2 = three's own transmission target + DFG LUT) programs ${lc.endAfterDispose.programs}${lc.err ? ' ERR ' + lc.err : ''}`);

    // JS heap growth around N frames, measured with CDP (performance.memory only refreshes between tasks)
    const cdp = await lctx.newCDPSession(lp);
    const heapNow = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
    await lp.evaluate(() => window.__RV__.churn(30, true));          // warm: shader compiles, JIT
    let h0 = await heapNow();
    await lp.evaluate(() => window.__RV__.retainObjects(20000));
    const hSelf = (await cdp.send('Runtime.getHeapUsage')).usedSize - h0;
    await lp.evaluate(() => window.__RV__.releaseObjects());
    check(hSelf > 200 * 1024, 'heap probe is sensitive (retaining 20000 objects moves the number)', `+${(hSelf / 1024).toFixed(0)} KB`);
    h0 = await heapNow();
    await lp.evaluate(() => window.__RV__.churn(900, false, false));
    const h1 = await heapNow();
    await lp.evaluate(() => window.__RV__.churn(60, true, false));
    const h2 = await heapNow();
    report.perf.heap = { updateKB: (h1 - h0) / 1024, renderKB: (h2 - h1) / 1024 };
    check((h1 - h0) / 1024 < 256, 'update() allocates ~nothing per frame (900 frames of body.step + stage.update, GC forced before/after)', `heap delta ${((h1 - h0) / 1024).toFixed(1)} KB (${((h1 - h0) / 1024 / 900).toFixed(3)} KB/frame); then 60 frames WITH render(): ${((h2 - h1) / 1024).toFixed(1)} KB`);
    report.problems.push(...lbad);
    await lctx.close();

    // context loss / restore: Chromium logs its own CONTEXT_LOST warnings here, which are expected
    const cctx = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
    const { page: cp, bad: cbad } = await openView(cctx, `quality=low&body=${BODY === 'auto' ? '' : BODY}`, 'contextloss', [/CONTEXT_LOST|context lost|Context Lost|context restored|WebGL: /i]);
    const cl = await cp.evaluate(() => window.__RV__.contextLossTest());
    console.log('  ' + cl.log.join('\n  '));
    check(cl.ok, 'webglcontextlost / restored: nothing throws, the stage renders again afterwards');
    report.problems.push(...cbad);
    await cctx.close();

    // quality governor: auto starts at med and drops when frames are slow; explicit tiers are honoured mid-session
    const actx = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
    const { page: ap, bad: abad } = await openView(actx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, 'governor');
    const gov = await ap.evaluate(async () => {
      const R = window.__RV__;
      R.setQuality('auto');
      const start = R.stage.stats().tier;
      const r = await R.rafFrames(70);
      const afterAuto = R.stage.stats().tier;
      R.setQuality('high'); R.frames(2); const hi = R.stage.stats().tier;
      R.setQuality('low'); R.frames(2); const lo = R.stage.stats().tier;
      R.setQuality('med'); R.frames(2); const md = R.stage.stats().tier;
      const s = R.snapshotStats();
      return { start, afterAuto, wall: r.wallMsPerFrame, ema: r.ema, hi, lo, md, std: s.stats.std, mode: R.info().mode };
    });
    report.perf.governor = gov;
    check(gov.start === 'med', "setQuality('auto') starts at med", `start tier ${gov.start}`);
    check(gov.wall < 30 || gov.afterAuto === 'low', 'auto governor drops a tier when the 1 s average frame time exceeds ~24 ms', `${gov.wall.toFixed(0)} ms/frame -> tier ${gov.afterAuto} (EMA ${gov.ema.toFixed(0)} ms)`);
    check(gov.hi === 'high' && gov.lo === 'low' && gov.md === 'med' && gov.std > 8, 'explicit tiers are honoured, and switching mid-session keeps rendering', `${gov.hi}/${gov.lo}/${gov.md}`);
    report.problems.push(...abad);
    await actx.close();
  }

  /* ───────────────────────── perf (relative cost only) ───────────────────────── */
  if (!NO_PERF) {
    const pctx = await browser.newContext({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 1 });
    // the synchronous timing uses gl.readPixels, which makes Chromium print a harmless "GPU stall" performance warning
    const { page: pp, bad: pbad } = await openView(pctx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, 'perf', [/GPU stall due to ReadPixels/i]);
    const perf = {};
    for (const q of ['low', 'med', 'high']) {
      perf[q] = await pp.evaluate(async (q) => {
        const R = window.__RV__;
        R.setQuality(q); R.frames(4);
        const ms = R.timeRender(4);
        const raf = await R.rafFrames(8);
        const st = R.stage.stats();
        return { syncMsPerFrame: ms, rafMsPerFrame: raf.wallMsPerFrame, frameMsEma: st.frameMsEma, drawCalls: st.drawCalls, triangles: st.triangles, fineVertices: R.info().fineVertices };
      }, q);
    }
    report.perf.byTier = perf;
    console.log('\nper-tier cost under SwiftShader at 480x360 (relative numbers only):');
    for (const q of ['low', 'med', 'high']) {
      const p = perf[q];
      console.log(`  ${q.padEnd(4)} sync ${p.syncMsPerFrame.toFixed(0).padStart(5)} ms/frame | raf ${p.rafMsPerFrame.toFixed(0).padStart(5)} ms | frame-time EMA ${p.frameMsEma.toFixed(0).padStart(5)} ms | draw calls ${p.drawCalls} | triangles ${p.triangles} | fine verts ${p.fineVertices}`);
    }
    check(perf.low.syncMsPerFrame < perf.med.syncMsPerFrame && perf.med.syncMsPerFrame < perf.high.syncMsPerFrame, 'cost rises with tier (low < med < high)', `${perf.low.syncMsPerFrame.toFixed(0)} / ${perf.med.syncMsPerFrame.toFixed(0)} / ${perf.high.syncMsPerFrame.toFixed(0)} ms`);
    report.problems.push(...pbad);
    await pctx.close();
  }

  check(report.problems.length === 0, 'zero console errors / warnings / page errors / failed requests (incl. shader compile errors)', report.problems.length ? '\n    ' + report.problems.slice(0, 12).join('\n    ') : '');
} catch (e) {
  console.error('probe crashed:', e);
  failures.push('probe crashed: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  writeFileSync(resolve(REPORT_DIR, 'browser_render.json'), JSON.stringify({ ...report, failures }, null, 2) + '\n');
  await browser.close().catch(() => {});
  srv.stop();
}
console.log(failures.length ? `\nFAILED (${failures.length}): ${failures.join('; ')}` : '\nALL RENDER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
