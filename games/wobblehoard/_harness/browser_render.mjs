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
// Round 2 (DESIGN 5.3 / 6.x) adds, before the perf block:
//   * FlashGovernor driven with adversarial sequences (<= 2 flashes / s, alpha <= 0.25, rings >= 500 ms apart, coral/cyan never alternating < 500 ms, calm = none);
//   * multi-body API (addBody / removeBody / clearBodies / setBody sugar / setBodyTier), a 3-body + ceremony leak test and dispose, the meter-full capsule drop (lands, tappable);
//   * EVERY tier's capsule reveal and merge ceremony (plus tier-up, 3 parents, quick pop) stepped deterministically at 30 fps: duration within 10% of the
//     DESIGN 6.1 budget, beats once in order, per-frame mean luminance -> luminance-transition count per rolling second (FAIL if > 3), skip() lands on the same final
//     frame as the natural end, and the Calm variant (x0.65, no camera move, no screen light, particles x0.3);
//   * rarity contact sheets (one body per tier, desktop + 390x844) and 6-tier x beats filmstrips of both ceremonies (desktop + phone).
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
  // pressed from above: the body is squashed against the table (the global compression metric rises), then released
  await shot(page, 'press_from_above_held', 'R.frames(120); R.orbit(0, 0.75); R.frames(90); R.press(0.0, 0.05, 1.0, 0.8); R.frames(66)');
  await shot(page, 'press_from_above_release_t80ms', 'R.release(); R.frames(5)');
  await page.evaluate(() => { const R = window.__RV__; R.frames(60); R.orbit(0, -0.75); R.frames(90); });
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
  // the LOW tier pressed hard (round-2 fix: the table horizon / mat edge used to show through the alpha-blended body as a straight seam)
  await shot(page, 'press_held_low', "R.setQuality('low'); R.frames(2); R.press(0.0, 0.15, 0.9, 0.9); R.frames(60)");
  await shot(page, 'press_held_med_same_pose', "R.release(); R.frames(60); R.setQuality('med'); R.press(0.0, 0.15, 0.9, 0.9); R.frames(60)");
  await page.evaluate(() => { const R = window.__RV__; R.release(); R.frames(90); R.setQuality('med'); R.frames(2); });

  // DPR caps per tier
  const dpr = await page.evaluate(() => {
    const R = window.__RV__, out = {};
    for (const q of ['low', 'med', 'high']) { R.setQuality(q); R.resize(300, 200, 3); out[q] = R.info().pixelRatio; }
    R.setQuality('med'); R.resize(720, 540, 1);
    return out;
  });
  check(dpr.low <= 1 && dpr.med <= 1.5 && dpr.high <= 2 && dpr.high === 2, 'resize() caps DPR per tier', JSON.stringify(dpr));

  // eyes follow the pointer: left vs right
  await page.evaluate(() => { const R = window.__RV__; R.frames(60); R.zoom(-3); R.setPointer(-0.9, 0.05); R.frames(40); }); // notches: 0.70x distance
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
  check(Math.abs(cam.restoredDistance - 1) < 0.03, 'camera probe restores the default framing', `distance ${cam.restoredDistance.toFixed(3)}x`);
  await page.evaluate(() => { window.__RV__.frames(60); });

  // bubbles mid-flight, glitter close-up
  const bub = await shot(page, 'bubbles_midflight', 'R.setAutoFx(false); R.spawn("bubbles", 0, 0.8, 0.1, 0.9); R.frames(34)');
  check((bub.info.fx?.bubbles ?? 0) > 3, 'bubbles are alive mid-flight', `${bub.info.fx?.bubbles}`);
  const glitterGenome = { ...makeStarterGenome(), glitter: 1, hue: 292, coreHue: 340, chroma: 0.8 };
  await page.evaluate((g) => { const R = window.__RV__; R.setGenomeObject(g); R.frames(100); R.zoom(-3.8); R.frames(30); }, glitterGenome);
  const gl = await shot(page, 'glitter_closeup', 'R.spawn("glitter", 0.2, 0.5, 0.5, 0.8); R.frames(10)');
  check((gl.info.fx?.glitter ?? 0) >= 100, 'glitter specks suspended in the body (genome.glitter = 1)', `${gl.info.fx?.glitter}`);
  await page.evaluate(() => { window.__RV__.zoom(3.8); window.__RV__.setAutoFx(true); });

  // 6-genome contact sheet (rest pose)
  const seeds = ['', '2', '3', '8', '16', '19']; // apricot starter, teal + glitter, pink, cyan bands + sleepy eyes, violet bands, green speckle
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

  /* ───────────────────────── round 2: multi-body, rarity, ceremonies, flash safety (DESIGN 5.3, 6.x) ───────────────────────── */
  {
    const TIERS6 = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const CAP_BUDGET = { common: 1.6, uncommon: 2.0, rare: 2.6, epic: 3.2, legendary: 3.9, mythic: 4.5 };
    const MER_BUDGET = { common: 2.2, uncommon: 2.6, rare: 3.2, epic: 3.8, legendary: 4.5, mythic: 5.2 };
    const bodyQ = BODY === 'auto' ? '' : BODY;
    const R2 = (report.round2 = { flash: {}, durations: {}, skip: {}, calm: {}, rarity: {}, multi: {}, cost3: {} });
    const sheetCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const ctx_for_sheets = () => sheetCtx;
    const rctx = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
    const { page: rp, bad: rbad } = await openView(rctx, `quality=low&body=${bodyQ}`, 'round2', [/GPU stall due to ReadPixels/i]);

    // ---- A. FlashGovernor, driven directly with adversarial sequences ----
    const fp = await rp.evaluate(() => window.__RV__.flashProbe());
    R2.flash = fp;
    check(fp.flashesIn1s <= 2 && fp.maxAlpha <= 0.25 + 1e-9, 'FlashGovernor: 12 flash requests inside 1 s grant <= 2, alpha capped at 0.25', `granted ${fp.flashesIn1s}, max alpha ${fp.maxAlpha}`);
    check(fp.stack[0] === true && fp.stack[1] === false && fp.stack[3] === false, 'FlashGovernor: a flash is never stacked inside the 480 ms ramp, never 3 in a window', JSON.stringify(fp.stack));
    check(fp.rings[0] === true && fp.rings[1] === false && fp.rings[2] === true && fp.rings[3] === false, 'FlashGovernor: shock rings are >= 500 ms apart', JSON.stringify(fp.rings));
    check(fp.tints[0] === 'coral' && fp.tints[1] !== 'cyan' && fp.tints[3] !== 'cyan' && fp.tints[4] === 'cyan', 'FlashGovernor: ember-coral and lagoon-cyan never alternate faster than 2 Hz', JSON.stringify(fp.tints));
    check(fp.calmFlash === 0 && fp.calmRing === false, 'FlashGovernor: calm mode grants no flash and no ring', `${fp.calmFlash} ${fp.calmRing}`);

    // ---- B. multi-body API sanity ----
    const api = await rp.evaluate(() => {
      const R = window.__RV__, S = R.stage;
      const out = {};
      R.setGenome(''); R.frames(3);
      out.afterSetBody = R.info().bodies;
      const a = R.addBody('2', 'rare', -1.2, 0), b = R.addBody('3', 'epic', 1.2, 0);
      R.frames(3);
      out.three = R.info().bodies;
      out.ids = [S.primaryBodyId(), a, b];
      S.removeBody(99999); S.setBodyTier(99999, 'mythic');           // unknown ids must be harmless
      S.removeBody(a); R.frames(2);
      out.afterRemove = R.info().bodies;
      S.clearBodies(); R.frames(2);
      out.afterClear = R.info().bodies;
      let threw = false; try { R.stage.render(); } catch { threw = true; }
      out.renderEmptyThrew = threw;
      R.setGenome(''); R.frames(3);
      out.afterSetBodyAgain = R.info().bodies;
      return out;
    });
    R2.multi.api = api;
    check(api.afterSetBody === 1 && api.three === 3 && api.afterRemove === 2 && api.afterClear === 0 && !api.renderEmptyThrew && api.afterSetBodyAgain === 1 && new Set(api.ids).size === 3,
      'addBody / removeBody / clearBodies / setBody-as-sugar behave (unique ids, unknown ids harmless, empty stage renders)', JSON.stringify(api));

    // ---- C. 3-body leak test (+ ceremonies skipped mid-way each cycle) ----
    const m3 = await rp.evaluate(() => window.__RV__.lifecycle3(18));
    const pk = (a, k) => a.map((x) => x[k]);
    // the content cycles with period 6 (tier x genome x ceremony), so a leak shows as lap 3 differing from lap 2
    const lapsSame = (k, slack) => [6, 7, 8, 9, 10, 11].every((i) => Math.abs(m3.after[i + 6][k] - m3.after[i][k]) <= slack);
    R2.multi.leak3 = m3;
    check(!m3.err && lapsSame('textures', 0) && lapsSame('programs', 0) && lapsSame('geometries', 1),
      '3 bodies x 18 cycles with merge + capsule ceremonies (skipped): lap 3 == lap 2 for geometries / textures / programs (no growth)', `geometries ${pk(m3.after, 'geometries').join(',')} | textures ${pk(m3.after, 'textures').join(',')} | programs ${pk(m3.after, 'programs').join(',')}${m3.err ? ' ERR ' + m3.err : ''}`);
    check(!m3.err && m3.endAfterDispose.geometries === 0 && m3.endAfterDispose.textures <= 2 && m3.endAfterDispose.programs === 0,
      'dispose() after the 3-body / ceremony cycles releases every geometry, program and our textures', `geometries ${m3.endAfterDispose.geometries}, textures ${m3.endAfterDispose.textures} (<= 2 = three-owned), programs ${m3.endAfterDispose.programs}`);

    // ---- D. meter-full capsule drop: lands, stays tappable, exposes a screen point ----
    const cap = await rp.evaluate(() => {
      const R = window.__RV__;
      R.setGenome(''); R.frames(30); R.dropCapsule();
      let f = 0; while (!R.capsuleInfo().landed && f < 150) { R.frames(1); f++; }
      const landedAfter = f;
      R.frames(40);
      const c = R.capsuleInfo();
      const ok = c.landed && c.point && c.hit;
      const miss = R.capsule && !R.capsule.hitTest(c.point.x + 400, c.point.y + 300);
      R.setSqueeze(0.5); R.frames(5);
      const sq = R.capsuleInfo();
      const vw = window.innerWidth, vh = window.innerHeight;
      return { landedAfter, info: c, miss, ok, inView: !!c.point && c.point.x - c.point.r >= 0 && c.point.x + c.point.r <= vw && c.point.y - c.point.r >= 0 && c.point.y + c.point.r <= vh, squeezePoint: sq.point };
    });
    R2.multi.capsule = cap;
    check(cap.ok && cap.miss && cap.inView && cap.landedAfter < 100, 'dropCapsule() on the desktop frame: lands (<3.3 s), stays tappable, fully inside the viewport, hitTest rejects far taps', JSON.stringify({ landedFrames: cap.landedAfter, point: cap.info.point, hit: cap.info.hit, miss: cap.miss }));
    await rp.evaluate(() => { const R = window.__RV__; R.stage.clearBodies(); R.setGenome(''); R.frames(2); });

    // ---- E. ceremonies: durations vs budget, beats, flash windows, skip, calm ----
    // A luminance transition = a direction flip of the per-frame mean RELATIVE luminance (linear light, 0..1) after a swing of at least FLASH_THR.
    // WCAG 2.3.1's general-flash swing is 0.10 of max luminance; the gate here is 0.04 (2.5x stricter, ~60% of this dusk scene's own mean luminance).
    // Smaller swings (0.02 and 0.01) are reported for information: at 0.01 plain body movement over the dark table already registers.
    const FLASH_THR = 0.04;
    const zigzagT = (L, FLASH_THR) => {            // direction flips after a swing >= FLASH_THR
      const idx = []; let dir = 0, pivot = L[0];
      for (let k = 1; k < L.length; k++) {
        const v = L[k];
        if (dir === 0) { if (v - pivot >= FLASH_THR) { dir = 1; pivot = v; idx.push(k); } else if (pivot - v >= FLASH_THR) { dir = -1; pivot = v; idx.push(k); } }
        else if (dir === 1) { if (v > pivot) pivot = v; else if (pivot - v >= FLASH_THR) { dir = -1; pivot = v; idx.push(k); } }
        else { if (v < pivot) pivot = v; else if (v - pivot >= FLASH_THR) { dir = 1; pivot = v; idx.push(k); } }
      }
      return idx;
    };
    const zigzag = (L) => zigzagT(L, FLASH_THR);
    const worstWindow = (idx, dt) => { let w = 0; for (let i = 0; i < idx.length; i++) { let n = 0; for (let j = i; j < idx.length && idx[j] - idx[i] < 1 / dt; j++) n++; w = Math.max(w, n); } return w; };
    const swing = (L) => { let lo = Infinity, hi = 0; for (const v of L) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return { min: lo, max: hi }; };
    const run = (o) => rp.evaluate((o) => window.__RV__.runCeremony(o), o);
    const DT = 1 / 30;
    const tiersToRun = QUICK ? ['common', 'mythic'] : TIERS6;
    const REQ = { capsule: ['grab', 'crack', 'burst', 'reveal', 'settle'], merge: ['press', 'fold', 'charge', 'burst', 'reveal', 'settle'] };
    let worstTransitions = 0, worstWhere = '';
    const natural = {};
    for (const kind of ['capsule', 'merge']) {
      for (const tier of tiersToRun) {
        const r = await run({ kind, tier, dt: DT });
        natural[`${kind}:${tier}`] = r;
        const budget = (kind === 'capsule' ? CAP_BUDGET : MER_BUDGET)[tier];
        const flashes = zigzag(r.lumas), win = worstWindow(flashes, DT), sw = swing(r.lumas);
        if (win > worstTransitions) { worstTransitions = win; worstWhere = `${kind}:${tier}`; }
        const order = r.beats.map((b) => b.beat);
        const beatsOk = JSON.stringify(order) === JSON.stringify(REQ[kind]);
        const ts = r.beats.map((b) => b.t);
        const monotone = ts.every((t, i) => i === 0 || t >= ts[i - 1] - 1e-6);
        R2.durations[`${kind}:${tier}`] = { budget, measured: r.seconds, reported: r.duration, frames: r.frames, beats: r.beats.map((b) => `${b.beat}@${b.t.toFixed(2)}`), maxScreenLight: r.maxLight, maxParticles: r.maxParticles, lumaMin: sw.min, lumaMax: sw.max, transitions1s: win, transitions1s_at_0_02: worstWindow(zigzagT(r.lumas, 0.02), DT), transitions1s_at_0_01: worstWindow(zigzagT(r.lumas, 0.01), DT) };
        check(Math.abs(r.seconds - budget) <= 0.1 * budget && Math.abs(r.duration - budget) <= 0.01 * budget + 1e-9, `${kind} ${tier}: duration ${r.seconds.toFixed(2)} s within 10% of the ${budget.toFixed(1)} s budget`, `reported ${r.duration.toFixed(2)} s`);
        check(beatsOk && monotone && r.doneResolved && r.bodiesAtEnd === 1 && r.resultVisibleAtEnd, `${kind} ${tier}: beats fire once in order ${REQ[kind].join('>')}, done resolves, result is the one visible body`, `${order.join('>')} done=${r.doneResolved} bodies=${r.bodiesAtEnd}`);
        check(r.maxLight <= 0.25 + 1e-6 && win <= 3, `${kind} ${tier}: flash-safe (screen alpha <= 0.25; <= 3 luminance transitions in any 1 s)`, `max alpha ${r.maxLight.toFixed(3)}, worst 1 s window ${win} transitions, luma ${sw.min.toFixed(3)}..${sw.max.toFixed(3)}, particles <= ${r.maxParticles}`);
      }
    }
    check(worstTransitions <= 3, 'FLASH PROBE: no 1 s window of any capsule / merge ceremony has more than 3 luminance transitions', `worst ${worstTransitions} (${worstWhere}), threshold ${FLASH_THR} mean linear luminance`);

    // tier-up accent (+0.4 s), 3-parent merge, quick pop
    for (const tier of QUICK ? ['mythic'] : ['rare', 'epic', 'mythic']) {
      const r = await run({ kind: 'merge', tier, dt: DT, tierUp: true });
      const budget = MER_BUDGET[tier] + 0.4, win = worstWindow(zigzag(r.lumas), DT);
      R2.durations[`merge+tierUp:${tier}`] = { budget, measured: r.seconds, transitions1s: win, maxScreenLight: r.maxLight };
      check(Math.abs(r.seconds - budget) <= 0.1 * budget && r.maxLight <= 0.25 + 1e-6 && win <= 3, `merge ${tier} + TIER UP: ${r.seconds.toFixed(2)} s vs ${budget.toFixed(1)} s budget, still flash-safe`, `transitions ${win}, alpha ${r.maxLight.toFixed(3)}`);
    }
    {
      const r = await run({ kind: 'merge', tier: 'epic', dt: DT, parents: 3 });
      check(Math.abs(r.seconds - MER_BUDGET.epic) <= 0.1 * MER_BUDGET.epic && r.bodiesAtEnd === 1 && r.beats.length === 6, 'merge with 3 parents completes on budget with every beat', `${r.seconds.toFixed(2)} s, bodies ${r.bodiesAtEnd}, beats ${r.beats.length}`);
      const q = await run({ kind: 'capsule', tier: 'common', dt: DT, quick: true });
      check(Math.abs(q.seconds - 0.8) <= 0.08 && q.bodiesAtEnd === 1, 'quick pop (common, fast open): 0.8 s', `${q.seconds.toFixed(2)} s`);
    }

    // skip(): jumps to the final reveal frame (120 ms crossfade), result never hidden, same final frame as the natural end
    // "same final frame": luminance of the 48x36 fingerprint box-filtered to 24x18 (time-phased idle effects such as Mythic's slowly cycling aura hue differ by phase, not by state)
    const lumaGrid = (fp) => { const o = new Float32Array(24 * 18); for (let y = 0; y < 36; y++) for (let x = 0; x < 48; x++) { const i = (y * 48 + x) * 4; o[(y >> 1) * 24 + (x >> 1)] += (0.2126 * fp[i] + 0.7152 * fp[i + 1] + 0.0722 * fp[i + 2]) / 4; } return o; };
    const fpDiff = (a, b) => { const A = lumaGrid(a), B = lumaGrid(b); let d = 0; for (let i = 0; i < A.length; i++) d += Math.abs(A[i] - B[i]); return d / A.length; };
    for (const kind of ['capsule', 'merge']) {
      for (const tier of QUICK ? ['mythic'] : ['common', 'rare', 'mythic']) {
        const budget = (kind === 'capsule' ? CAP_BUDGET : MER_BUDGET)[tier];
        // 3 s of settle frames after each: the natural ending lands with a wobble that is still ringing out at the last ceremony frame
        const nat = await run({ kind, tier, dt: DT, settle: 90 });
        const sk = await run({ kind, tier, dt: DT, skipAt: budget * 0.42, settle: 90 });
        const d = fpDiff(nat.fingerprint, sk.fingerprint);
        const order = sk.beats.map((b) => b.beat);
        const win = worstWindow(zigzag(sk.lumas), DT);
        R2.skip[`${kind}:${tier}`] = { fingerprintMeanAbsDiff: d, activeFramesAfterSkip: sk.activeAfterSkip, beats: order, transitions1s: win, maxScreenLight: sk.maxLight };
        const same = (x) => !x.ceremony && !x.capsule && x.screenLight === 0 && x.cameraFx.dist === 1 && x.cameraFx.yaw === 0 && x.cameraFx.pitch === 0 && x.primaryIsResult;
        check(same(sk.finalState) && same(nat.finalState), `${kind} ${tier}: after skip() AND after the natural end the stage state is identical (no ceremony, capsule gone, no screen light, camera at rest, the result is the primary body)`, JSON.stringify(sk.finalState));
        check(d <= (tier === 'mythic' ? 11 : 6) && sk.activeAfterSkip >= 1 && sk.activeAfterSkip * DT <= 0.12 + 2 * DT && sk.doneResolved && sk.bodiesAtEnd === 1 && sk.resultVisibleAtEnd && order.includes('reveal') && order.includes('settle'),
          `${kind} ${tier}: skip() ends on the same final frame (mean luminance |diff| ${d.toFixed(2)}/255; time-phased idle effects differ: Mythic's hue cycle and core pulse, tolerance 11 for it, 6 otherwise), 120 ms crossfade, result visible, done resolves`, `crossfade ${sk.activeAfterSkip} frames, beats ${order.join('>')}`);
        check(win <= 3 && sk.maxLight <= 0.25 + 1e-6, `${kind} ${tier}: skip() is flash-safe too`, `transitions ${win}`);
      }
    }

    // Calm: no camera moves, no slow-mo, particles x0.3, rings -> fades, durations x0.65, no flash
    for (const kind of ['capsule', 'merge']) {
      const tier = 'mythic';
      const norm = natural[`${kind}:${tier}`] ?? (await run({ kind, tier, dt: DT, calm: false }));
      const calm = await run({ kind, tier, dt: DT, calm: true });
      const budget = (kind === 'capsule' ? CAP_BUDGET : MER_BUDGET)[tier] * 0.65;
      R2.calm[`${kind}:${tier}`] = { measured: calm.seconds, budget, maxScreenLight: calm.maxLight, particles: calm.maxParticles, normalParticles: norm.maxParticles, camRange: calm.camRange, normalCamRange: norm.camRange };
      check(Math.abs(calm.seconds - budget) <= 0.1 * budget && calm.maxLight === 0 && calm.camRange < 1e-6 && calm.maxParticles <= 0.45 * norm.maxParticles + 4 && norm.camRange > 0.02,
        `Calm ${kind} ${tier}: duration x0.65 (${calm.seconds.toFixed(2)} s), no screen light, camera effects ${calm.camRange.toExponential(0)} vs ${norm.camRange.toFixed(2)} in the normal run, particles ${calm.maxParticles} vs ${norm.maxParticles}`);
    }
    await rp.evaluate(() => { const R = window.__RV__; R.setCalm(false); R.stage.clearBodies(); R.setGenome(''); R.frames(2); });
    report.problems.push(...rbad);
    await rctx.close();

    // ---- F. rarity ladder reads from the object: one body per tier, desktop + phone ----
    {
      const sctx = await browser.newContext({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 1 });
      const { page: sp, bad: sbad } = await openView(sctx, `quality=med&body=${bodyQ}`, 'rarity', [/GPU stall due to ReadPixels/i]);
      const cells = [], fps = [];
      for (const tier of TIERS6) {
        const r = await sp.evaluate((tier) => { const R = window.__RV__; R.showTier(tier); R.frames(110); const png = R.snapshot(); return { png, fp: R.fingerprint(), info: R.info() }; }, tier);
        cells.push([tier, r.png]); fps.push(r.fp);
        R2.rarity[tier] = { rarityFx: r.info.rarity ?? null };
      }
      await sheet(ctx_for_sheets(), 'rarity_sheet', cells, 3, 480, 360);
      const dmin = Math.min(...fps.slice(1).map((f, i) => fpDiff(fps[i], f)));
      check(dmin > 1.2, 'rarity sheet: every tier differs visibly from the previous one', `min adjacent mean |diff| ${dmin.toFixed(2)}/255`);
      console.log('wrote rarity_sheet.png');
      await sctx.close();
      report.problems.push(...sbad);

      const pctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const { page: pp2, bad: pbad2 } = await openView(pctx2, `quality=low&body=${bodyQ}`, 'rarity-phone', [/GPU stall due to ReadPixels/i]);
      const cellsP = [];
      for (const tier of TIERS6) cellsP.push([tier, await pp2.evaluate((tier) => { const R = window.__RV__; R.showTier(tier); R.frames(100); return R.snapshot(); }, tier)]);
      // the same cue on a 390x844 portrait frame: the capsule must be whole on screen and tappable (it lands in FRONT of the body there)
      const capP = await pp2.evaluate(() => {
        const R = window.__RV__;
        R.showTier('common'); R.frames(30); R.dropCapsule();
        let f = 0; while (!R.capsuleInfo().landed && f < 200) { R.frames(1); f++; }
        R.frames(60);
        const c = R.capsuleInfo(), vw = window.innerWidth, vh = window.innerHeight;
        return { landedFrames: f, info: c, whole: !!c.point && c.point.x - c.point.r >= 0 && c.point.x + c.point.r <= vw && c.point.y - c.point.r >= 0 && c.point.y + c.point.r <= vh, png: R.snapshot() };
      });
      R2.multi.capsulePhone = { landedFrames: capP.landedFrames, info: capP.info, whole: capP.whole };
      check(capP.info.landed && capP.info.hit && capP.whole, 'dropCapsule() on a 390x844 portrait frame: lands, whole on screen, tappable', JSON.stringify({ point: capP.info.point, hit: capP.info.hit }));
      writeFileSync(resolve(OUT, 'capsule_cue_phone.png'), b64(capP.png));
      await sheet(ctx_for_sheets(), 'rarity_sheet_phone', cellsP, 6, 260, 563);
      console.log('wrote rarity_sheet_phone.png');
      await pctx2.close();
      report.problems.push(...pbad2);
    }

    // ---- G. filmstrips: 6 tiers x beats for both ceremonies (desktop med + phone low) ----
    if (!QUICK) {
      const PRE = { common: 0, uncommon: 0, rare: 0.3, epic: 0.5, legendary: 0.8, mythic: 1.0 };
      const timesFor = (kind, t) => {
        if (kind === 'capsule') { const burst = 0.65 + PRE[t], D = CAP_BUDGET[t]; return [0.2, burst - 0.15, burst + 0.1, burst + 0.45, burst + 1.0, D - 0.03]; }
        const T1 = 0.4, T2 = 0.5, T3 = 0.4 + 1.5 * PRE[t], T4 = 0.2, D = MER_BUDGET[t];
        return [T1 * 0.8, T1 + 0.3 * T2 + 0.1, T1 + T2 + 0.05, T1 + T2 + T3 * 0.75, T1 + T2 + T3 + T4 + 0.12, D - 0.03];
      };
      for (const [label, vp, query, cols, cw, ch, tiersSel] of [
        ['desktop', { width: 260, height: 208 }, 'quality=med', 6, 260, 208, TIERS6],
        ['phone', { width: 390, height: 844 }, 'quality=low', 6, 130, 281, ['rare', 'mythic']],
      ]) {
        const fctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        const { page: fpg, bad: fbad } = await openView(fctx, `${query}&body=${bodyQ}`, `filmstrip-${label}`, [/GPU stall due to ReadPixels/i]);
        for (const kind of ['capsule', 'merge']) {
          const cells = [];
          for (const tier of tiersSel) {
            const ts = timesFor(kind, tier);
            for (let i = 0; i < ts.length; i++) {
              const png = await fpg.evaluate(([kind, tier, t, first]) => { const R = window.__RV__; if (first) { if (kind === 'capsule') R.capsuleReveal(tier); else R.merge(tier, 2, false); } R.cerSeek(t, 1 / 30); return R.snapshot(); }, [kind, tier, ts[i], i === 0]);
              cells.push([`${tier} ${ts[i].toFixed(2)}s`, png]);
            }
            await fpg.evaluate(() => { const R = window.__RV__; if (R.cerState().active) R.skipCer(); R.frames(12); });
          }
          await sheet(ctx_for_sheets(), `ceremony_${kind}_${label}`, cells, cols, cw, ch);
          console.log(`wrote ceremony_${kind}_${label}.png`);
        }
        report.problems.push(...fbad);
        await fctx.close();
      }
    }
    await sheetCtx.close();
  }

  /* ───────────────────────── perf (relative cost only) ───────────────────────── */
  if (!NO_PERF) {
    const pctx = await browser.newContext({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 1 });
    // the synchronous timing uses gl.readPixels, which makes Chromium print a harmless "GPU stall" performance warning
    const { page: pp, bad: pbad } = await openView(pctx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, 'perf', [/GPU stall due to ReadPixels/i]);
    // Other lanes share this machine's 4 cores, so one timing is noisy: 3 interleaved rounds (low, med, high, low, ...), best and median reported.
    const rounds = { low: [], med: [], high: [] };
    for (let r = 0; r < 3; r++) {
      for (const q of ['low', 'med', 'high']) {
        rounds[q].push(await pp.evaluate((q) => { const R = window.__RV__; R.setQuality(q); R.frames(3); return R.timeRender(3); }, q));
      }
    }
    // frame-time EMA from real rAF pacing: needs enough frames for the GPU queue to back-pressure the main thread
    const perf = {};
    for (const q of ['low', 'med', 'high']) {
      const e = await pp.evaluate(async (q) => {
        const R = window.__RV__;
        R.setQuality(q); R.frames(2);
        const raf = await R.rafFrames(30);
        const st = R.stage.stats();
        return { rafMsPerFrame: raf.wallMsPerFrame, frameMsEma: st.frameMsEma, drawCalls: st.drawCalls, triangles: st.triangles, fineVertices: R.info().fineVertices };
      }, q);
      const sorted = [...rounds[q]].sort((a, b) => a - b);
      perf[q] = { ...e, syncBestMs: sorted[0], syncMedianMs: sorted[1], syncRoundsMs: rounds[q] };
    }
    report.perf.byTier = perf;
    // round 2: the same measurement with THREE bodies on the table (common + rare + mythic), best/median of 3 interleaved rounds
    {
      const r3 = { low: [], med: [], high: [] }, stats3 = {};
      await pp.evaluate(() => { const R = window.__RV__; R.setGenome(''); R.addBody('2', 'rare', -1.15, 0.1); R.addBody('3', 'mythic', 1.15, 0.1); R.frames(3); });
      for (let r = 0; r < 3; r++) {
        for (const q of ['low', 'med', 'high']) {
          const o = await pp.evaluate((q) => { const R = window.__RV__; R.setQuality(q); R.frames(3); const ms = R.timeRender(3); const st = R.stage.stats(); return { ms, drawCalls: st.drawCalls, triangles: st.triangles, bodies: R.info().bodies }; }, q);
          r3[q].push(o.ms); stats3[q] = { drawCalls: o.drawCalls, triangles: o.triangles, bodies: o.bodies };
        }
      }
      const cost3 = {};
      for (const q of ['low', 'med', 'high']) { const sorted = [...r3[q]].sort((a, b) => a - b); cost3[q] = { syncBestMs: sorted[0], syncMedianMs: sorted[1], ...stats3[q], oneBodyBestMs: perf[q].syncBestMs, ratio: sorted[0] / perf[q].syncBestMs }; }
      report.perf.threeBodies = cost3;
      if (report.round2) report.round2.cost3 = cost3;
      console.log('\nthree bodies on the table (common + rare + mythic) vs one, SwiftShader 480x360:');
      for (const q of ['low', 'med', 'high']) console.log(`  ${q.padEnd(4)} best ${cost3[q].syncBestMs.toFixed(0).padStart(5)} ms (1 body ${cost3[q].oneBodyBestMs.toFixed(0)} ms, x${cost3[q].ratio.toFixed(2)}) | draw calls ${cost3[q].drawCalls} | triangles ${cost3[q].triangles}`);
      check(cost3.low.ratio < 3.6 && cost3.med.ratio < 3.6, 'three bodies cost < 3.6x one body (shared env / programs; per-body jelly + FX only)', `low x${cost3.low.ratio.toFixed(2)}, med x${cost3.med.ratio.toFixed(2)}, high x${cost3.high.ratio.toFixed(2)}`);
      await pp.evaluate(() => { const R = window.__RV__; R.stage.clearBodies(); R.setGenome(''); R.setQuality('med'); R.frames(2); });
    }
    console.log('\nper-tier cost under SwiftShader at 480x360 (CPU rasteriser, shared machine: relative numbers only):');
    for (const q of ['low', 'med', 'high']) {
      const p = perf[q];
      console.log(`  ${q.padEnd(4)} sync best ${p.syncBestMs.toFixed(0).padStart(5)} / median ${p.syncMedianMs.toFixed(0).padStart(5)} ms/frame | rAF-paced ${p.rafMsPerFrame.toFixed(0).padStart(5)} ms/frame, frame-time EMA ${p.frameMsEma.toFixed(0).padStart(5)} ms | draw calls ${p.drawCalls} | triangles ${p.triangles} | fine verts ${p.fineVertices}`);
    }
    check(perf.low.syncBestMs < perf.med.syncBestMs && perf.low.syncBestMs < perf.high.syncBestMs && perf.med.syncBestMs <= perf.high.syncBestMs * 1.15, 'cost rises with tier (low < med <~ high; best of 3 rounds)', `${perf.low.syncBestMs.toFixed(0)} / ${perf.med.syncBestMs.toFixed(0)} / ${perf.high.syncBestMs.toFixed(0)} ms`);
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
