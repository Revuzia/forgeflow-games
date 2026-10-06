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
//     DESIGN 6.1 budget, beats once in order and the 'burst' beat on the audio time map, the DESIGN 6.3 escalation row exactly (burst particles, rings,
//     camera push / arc, time-scale dip) with ONE light ramp, per-frame mean luminance -> luminance-transition count per rolling second (FAIL if > 3),
//     skip() lands on the same final frame as the natural end (RGB fingerprint, every tier) and never hides the result, the Calm variant of every tier
//     (x0.65, no camera move / slow-mo / screen light / ramp, particles x0.3, rings -> fades), native vs puppet ceremony drivers, done robustness;
//   * the set: sky / ground gradient seams and band edges at 4 aspect ratios x 3 camera pitches; low vs med at one frozen pressed pose (seam + MAE);
//   * rarity contact sheets (one body per tier at 1280x800 for three genomes and one opaque-family species, and 390x844) and 6-tier x 7-beat
//     filmstrips of both ceremonies (1280x800 med + 390x844 low; the desktop frames also land in _shots/render/film/*.jpg);
//   * every ceremony body stays inside the top of the frame (the 1.25x spring-open + rise), the reveal owns the capsule it opens (a drop during
//     a reveal is independent and survives it), and the jelly honours the material family's translucency cap at every tier (node-side).
// SwiftShader is a CPU rasteriser: only the RELATIVE cost between tiers means anything here.
import { startVite, launch, ROOT } from './pw.mjs';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { makeStarterGenome } from '../src/core/genome.ts';
import { drawnTranslucency } from '../src/render/material.ts';
import { CATALOG, speciesBaseGenome } from '../src/data/catalog.ts';
import { translucencyMaxOf } from '../src/data/materials.ts';
import { StubBody } from '../src/render/stubBody.ts';
import { BodyProxy } from '../src/render/bodyproxy.ts';

process.env.WH_FROZEN ??= '1'; // no HMR / watcher: another lane's edit must not reload the page mid-run
const args = process.argv.slice(2);
const flag = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : args.includes(`--${name}`) ? true : dflt; };
const BODY = flag('body', 'auto');
const QUICK = !!flag('quick', false);
const NO_PERF = QUICK || !!flag('no-perf', false);
// --only=a,b,...: run only these sections (iteration; the default runs everything). Sections: main, phone, sky, lifecycle, r2 (governor,
// multi-body API, 3-body leak, capsule drop / ownership), cer (every ceremony: budget, beats, flash, escalation; skip; calm; tier-up,
// 3 parents, drivers, done), chains, rarity, film, gallery, glow, strands, mat, capspot, cut, bundle (vite build + grep: no dev stage member in
// production), perf
const ONLY = typeof flag('only', '') === 'string' ? String(flag('only', '')).split(',').filter(Boolean) : [];
const ON = (name) => ONLY.length === 0 || ONLY.includes(name);
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
// colour difference of two 48x36 RGBA fingerprints: mean over the pixels of the largest |channel difference| (/255)
const fpDiffB = (a, b) => { let d = 0, n = 0; for (let i = 0; i < a.length; i += 4) { d += Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); n++; } return d / n; };
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
  if (ON('main')) {
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
  // the LOW tier pressed hard (round-2 fixes: the table horizon / mat edge used to show through the alpha-blended body as a straight seam;
  // the low tier read paler than med). One pose, frozen (dt 0), rendered at low and at med: seam detector + mean |RGB diff| over the body.
  await page.evaluate(() => { const R = window.__RV__; R.setQuality('low'); R.frames(2); R.press(0.0, 0.15, 0.9, 0.9); R.frames(60); });
  const qc = await page.evaluate(() => window.__RV__.qualityCompare('low', 'med'));
  report.perf.lowVsMed = qc;
  await shot(page, 'press_held_med_same_pose');
  await shot(page, 'press_held_low', "R.setQuality('low'); R.stage.update(0, { time: R.time, pointerNdc: null });");
  // eyes, glints and glitter put ~0.3 of a row's columns into one step in ANY tier (med is the reference); a straight seam across the body lines up most of them
  check(qc.seamA >= 0 && qc.seamA <= 0.5 && qc.seamA <= qc.seamB + 0.12, 'low tier pressed: no straight horizontal seam across the lower body (worst row: fraction of columns stepping together, low vs the med reference)', `low ${qc.seamA.toFixed(2)}, med ${qc.seamB.toFixed(2)} (a body-wide seam lines up > 0.5)`);
  // and two more genomes at rest (violet bands, green speckle): low has no transmission pass, so it imitates it; these numbers say how well
  const qg = await page.evaluate(() => { const R = window.__RV__; const o = {}; for (const s of ['16', '19']) { R.setGenome(s); R.frames(120); o[s] = R.qualityCompare('low', 'med'); } R.setGenome(''); R.setQuality('low'); R.frames(2); return o; });
  report.perf.lowVsMedGenomes = qg;
  check(qc.mae >= 0 && qc.mae <= 8 && qg['16'].mae <= 10 && qg['19'].mae <= 16, 'low tier vs med at the SAME frozen pose: mean |RGB diff| over the body (DOLLOP pressed <= 8, seed 16 <= 10, seed 19 <= 16 /255)',
    `DOLLOP pressed ${qc.mae.toFixed(2)} (bias R/G/B ${qc.bias.map((v) => v.toFixed(1)).join('/')}), seed 16 ${qg['16'].mae.toFixed(2)}, seed 19 ${qg['19'].mae.toFixed(2)} (mostly the silhouette rim, where med shows the background through)`);
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
  }

  /* ───────────────────────── phone viewport ───────────────────────── */
  if (ON('phone')) {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const { page: pp, bad: pbad } = await openView(pctx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, 'phone');
    await shot(pp, 'phone_390x844');
    await shot(pp, 'phone_390x844_press', 'R.press(0.0, 0.1, 0.9, 0.9); R.frames(36)');
    const sw = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, db: window.__RV__.info().drawingBuffer, pr: window.__RV__.info().pixelRatio }));
    check(sw.sw <= sw.iw, 'phone: no horizontal scroll', `scrollWidth ${sw.sw} <= innerWidth ${sw.iw}; drawing buffer ${sw.db.join('x')} @ DPR ${sw.pr}`);
    report.problems.push(...pbad);
    await pctx.close();
  }

  /* ───────────────────────── the production bundle: no dev stage member ships from src/render (verifier finding 11) ───────────────────────── */
  if (ON('bundle')) {
    // `vite build` to a temp folder, then grep the output. The stage's dev members (renderer, scene, views, flash, memory(), loseContext(), restoreContext(), info) live behind
    // import.meta.env.DEV, createStageDev lives in src/render/stageDev.ts (the harnesses import it, the game never does), and the stub body / the renderview page are harness-only.
    const out = join(tmpdir(), `wh-render-bundle-${process.pid}`);
    rmSync(out, { recursive: true, force: true });
    const b = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
    let built = b.status === 0; try { walk(out); } catch { built = false; }
    const text = files.filter((f) => /.(js|html|css|json)$/.test(f)).map((f) => ({ f, s: readFileSync(f, 'utf8') }));
    // (measured by a positive control: the same build with the dev flag on, NODE_ENV=development --mode development, contains particlesDropped, screenLight, contextLost,
    // fineVertices, eyeLook, `restoreContext:` and `loseContext:` once each and one more .loseContext() / .restoreContext() / WEBGL_lose_context than the production build)
    const NAMES = ['createStageDev', 'StubBody', 'stubBody', 'renderview', '__RV__', 'lifecycle3', 'particlesDropped', 'screenLight', 'contextLost', 'cameraFx: {', 'fineVertices', 'eyeLook', 'restoreContext:', 'loseContext:'];
    const found = NAMES.filter((k) => text.some((x) => x.s.includes(k)));
    // loseContext / restoreContext: only three's own forceContextLoss / forceContextRestore (one each, in the stage chunk: two WEBGL_lose_context lookups) and the shell's WebGL probe in the index chunk may use them (our dev members would add one more of each)
    const count = (re) => text.reduce((a, x) => a + (x.s.match(re) ?? []).length, 0);
    const lose = count(/.loseContext()/g), restore = count(/.restoreContext()/g), ext = count(/WEBGL_lose_context/g);
    const stageChunk = text.find((x) => /stage-/.test(x.f));
    const stageExt = stageChunk ? (stageChunk.s.match(/WEBGL_lose_context/g) ?? []).length : -1;
    report.bundle = { built, files: files.length, found, lose, restore, ext, stageExt };
    check(built && found.length === 0 && lose <= 2 && restore <= 1 && stageExt <= 2, 'production bundle (vite build + grep): none of createStageDev / StubBody / renderview / __RV__ / lifecycle3 / the stage readout (info, screenLight, particlesDropped) / contextLost ships; loseContext / restoreContext appear only inside three.js (one forceContextLoss, one forceContextRestore) and the WebGL probe of the shell',
      `built ${built}, ${files.length} files, dev names found: [${found.join(', ')}], .loseContext() x${lose}, .restoreContext() x${restore}, WEBGL_lose_context x${ext} (stage chunk x${stageExt})${built ? '' : ' ' + String(b.stderr || b.stdout).slice(-300)}`);
    rmSync(out, { recursive: true, force: true });
  }

  /* ───────────────────────── the set: a seamless dusk gradient at every aspect ratio and camera pitch ───────────────────────── */
  if (ON('sky'))
  // (round-2 fix: the distance fog of the ground beyond the mat saturated to one flat colour band whose lower end read as a hard edge across the
  // top of the frame, and the sky glow had a kink at the horizon). Bodies and the felt mat hidden; 8x8 block luminance. A vertical seam = a
  // step between neighbouring block columns; a band edge / kink = a large second difference down a column (a smooth gradient has a small one
  // even where it is steep). Before the fix: curvature 2.9 (desktop, default pitch) .. 4.3 (lowest pitch).
  {
    const sky = {};
    for (const [vw, vh, dprS] of QUICK ? [[1280, 800, 1], [390, 844, 2]] : [[1280, 800, 1], [390, 844, 2], [2560, 1080, 1], [800, 1280, 1]]) {
      const sctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dprS });
      const { page: kp, bad: kbad } = await openView(sctx, `quality=med&body=${BODY === 'auto' ? '' : BODY}`, `sky-${vw}x${vh}`, [/GPU stall due to ReadPixels/i]);
      for (const [pname, dp] of [['default', 0], ['lowest', -50], ['highest', 50]]) {
        const r = await kp.evaluate((dp) => { const R = window.__RV__; if (dp) R.orbit(0, dp); R.frames(200); return R.skyProbe(); }, dp);
        sky[`${vw}x${vh}@${dprS}:${pname}`] = r;
      }
      report.problems.push(...kbad);
      await sctx.close();
    }
    report.sky = sky;
    const worstCol = Math.max(...Object.values(sky).map((r) => r.maxColStep)), worstCurv = Math.max(...Object.values(sky).map((r) => r.maxRowCurv));
    const where = Object.entries(sky).sort((a, b) => b[1].maxRowCurv - a[1].maxRowCurv)[0];
    check(worstCol <= 1.0, 'sky / ground gradient: no vertical seams at any aspect ratio or camera pitch (max step between 8 px block columns <= 1/255)', `worst ${worstCol.toFixed(2)}/255 over ${Object.keys(sky).length} framings`);
    check(worstCurv <= 2.5, 'sky / ground gradient: no band edge or kink at any aspect ratio or camera pitch (max second difference down a column <= 2.5/255 per 8 px)', `worst ${worstCurv.toFixed(2)} at ${where[0]} (${where[1].w}x${where[1].h}, block ${where[1].at.join(',')}); steepest smooth slope ${Math.max(...Object.values(sky).map((r) => r.maxRowStep)).toFixed(2)}/255 per 8 px`);
  }

  /* ───────────────────────── lifecycle: leaks, dispose, context loss, allocation, auto tier ───────────────────────── */
  if (ON('lifecycle')) {
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
    // warm the MEASURED path itself first (body.step + stage.update, no render): the 30 rendered warm-up frames above leave the
    // optimizing compiler's first-time code and feedback for these 900 frames, which read as ~130 KB of "growth" that a second pass
    // does not repeat (steady state measured at -1..+7 KB per 900 frames, scratchpad/render4/alloc_probe.mjs)
    await lp.evaluate(() => window.__RV__.churn(300, false, false));
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
    // (only the context-lost / restored notices are expected; an INVALID_OPERATION "object does not belong to this context" is the stale-dispose bug of verifier finding 13)
    const { page: cp, bad: cbad } = await openView(cctx, `quality=low&body=${BODY === 'auto' ? '' : BODY}`, 'contextloss', [/CONTEXT_LOST|context lost|Context Lost|context restored|WebGL: .*(lost|restored)/i]);
    const cl = await cp.evaluate(() => window.__RV__.contextLossTest());
    console.log('  ' + cl.log.join('\n  '));
    check(cl.ok, 'webglcontextlost / restored: nothing throws, the stage renders again afterwards');
    check(!cbad.some((m) => /INVALID_OPERATION|does not belong/i.test(m)), 'after a context loss and restore, disposing the objects made before the loss logs no "does not belong to this context" warnings (verifier finding 13: about 30)', `${cbad.filter((m) => /INVALID_OPERATION|does not belong/i.test(m)).length} warnings`);
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
  if (ON('r2') || ON('cer') || ON('chains') || ON('rarity') || ON('film')) {
    const TIERS6 = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const rgbDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return d / (a.length / 4); };
    const lumaGrid = (fp) => { const o = new Float32Array(24 * 18); for (let y = 0; y < 36; y++) for (let x = 0; x < 48; x++) { const i = (y * 48 + x) * 4; o[(y >> 1) * 24 + (x >> 1)] += (0.2126 * fp[i] + 0.7152 * fp[i + 1] + 0.0722 * fp[i + 2]) / 4; } return o; };
    const fpDiff = (a, b) => { const A = lumaGrid(a), B = lumaGrid(b); let d = 0; for (let i = 0; i < A.length; i++) d += Math.abs(A[i] - B[i]); return d / A.length; };
    const CAP_BUDGET = { common: 1.6, uncommon: 2.0, rare: 2.6, epic: 3.2, legendary: 3.9, mythic: 4.5 };
    const MER_BUDGET = { common: 2.2, uncommon: 2.6, rare: 3.2, epic: 3.8, legendary: 4.5, mythic: 5.2 };
    const MER_BUDGET_EPIC = MER_BUDGET.epic;
    // the audio lane's time map (_spec/SOUND.md): capsule burst at 0.65 s + the tier pre-roll; merge burst at MERGE_CHARGE_S
    const SYNC = { capsule: { common: 0.65, uncommon: 0.65, rare: 0.95, epic: 1.15, legendary: 1.45, mythic: 1.65 }, merge: { common: 1.3, uncommon: 1.5, rare: 1.8, epic: 2.1, legendary: 2.4, mythic: 2.8 } };
    const bodyQ = BODY === 'auto' ? '' : BODY;
    const R2 = (report.round2 = { flash: {}, durations: {}, skip: {}, calm: {}, rarity: {}, multi: {}, cost3: {} });
    const sheetCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const ctx_for_sheets = () => sheetCtx;
    const rctx = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
    const { page: rp, bad: rbad } = await openView(rctx, `quality=low&body=${bodyQ}`, 'round2', [/GPU stall due to ReadPixels/i]);

    if (ON('r2')) {
    // ---- 0. the material family's translucency cap (CONTRACT 11): the jelly never draws an opaque family clearer than its cap, at any tier ----
    {
      let over = 0, n = 0, capped = 0;
      for (const d of CATALOG) for (let sd = 1; sd <= 12; sd++) {
        const g = speciesBaseGenome(d.id, sd), cap = translucencyMaxOf(d.family);
        for (const add of [0, 0.1, 0.15, 0.18, 0.2]) { const t = drawnTranslucency(g, add); n++; if (t > cap + 1e-9) over++; if (cap < 1) capped++; }
      }
      check(over === 0 && capped > 0, 'jelly translucency honours the material family cap at every rarity tier (50 species x 12 seeds x 5 tier additions)', `${over} over the cap of ${n} (${capped} in capped families)`);
    }
    // ---- 0b. BodyProxy forwards EVERY SoftMetrics field generically (node-side): strands, slosh, pull and fields nobody has named yet ----
    {
      const inner = new StubBody(makeStarterGenome());
      const m = inner.metrics;
      m.strands = 0.42; m.slosh = 0.31; m.pull = 0.77; m.futureField = 0.5;
      const px = new BodyProxy(inner);
      m.strands = 0.6; m.pull = 0.25;
      px.sync(1 / 60, 0);
      const got = px.metrics;
      check(got.strands === 0.6 && got.slosh === 0.31 && got.pull === 0.25 && got.futureField === 0.5 && got.compression === m.compression,
        'BodyProxy forwards every SoftMetrics field (strands, slosh, pull, unknown future ones), live each sync', JSON.stringify({ strands: got.strands, slosh: got.slosh, pull: got.pull, futureField: got.futureField }));
    }

    // ---- A. FlashGovernor, driven directly with adversarial sequences ----
    const fp = await rp.evaluate(() => window.__RV__.flashProbe());
    R2.flash = fp;
    check(fp.flashesIn1s <= 2 && fp.maxAlpha <= 0.25 + 1e-9, 'FlashGovernor: 12 flash requests inside 1 s grant <= 2, alpha capped at 0.25', `granted ${fp.flashesIn1s}, max alpha ${fp.maxAlpha}`);
    check(fp.stack[0] === true && fp.stack[1] === false && fp.stack[2] === false && fp.stack[3] === false && fp.stack[4] === true, 'FlashGovernor: granted flashes start >= 1 s apart (never stacked, never more than 2 in any second)', JSON.stringify(fp.stack));
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
    // calm / reduced motion (DESIGN 6.2): no drop, it fades in where it stands; onLand fires when it is fully there
    const capCalm = await rp.evaluate(() => {
      const R = window.__RV__;
      R.stage.clearBodies(); R.setGenome(''); R.setCalm(true); R.frames(10);
      const f0 = R.frameNo; R.dropCapsule();
      // screenPoint() is null until the capsule has landed (contract: not tappable while falling / fading in); from then on it must not move
      const ys = [], pts = []; let firstPoint = -1;
      for (let i = 0; i < 40; i++) { R.frames(1); const p = R.capsuleInfo().point; pts.push(!!p); if (p) { ys.push(p.y); if (firstPoint < 0) firstPoint = R.frameNo - f0; } }
      const out = { landedAfterFrames: R.capsuleLandedFrame - f0, firstPointFrame: firstPoint, points: ys.length, yRange: ys.length ? Math.max(...ys) - Math.min(...ys) : -1, hit: R.capsuleInfo().hit };
      R.setCalm(false); R.capsule?.remove(); R.frames(2);
      return out;
    });
    R2.multi.capsuleCalm = capCalm;
    check(capCalm.points >= 6 && capCalm.yRange >= 0 && capCalm.yRange < 1 && capCalm.landedAfterFrames >= 20 && capCalm.landedAfterFrames <= 34 && capCalm.firstPointFrame === capCalm.landedAfterFrames && capCalm.hit,
      'calm mode: the meter-full capsule fades in where it stands (no drop, no bounce), onLand after the ~0.45 s fade, tappable from exactly then', JSON.stringify(capCalm));
    // the reveal OWNS the capsule it opens (its handle reads as opening); a meter-full drop DURING a reveal makes an independent capsule that
    // lands beside the pad (where the result lands), on screen, and is still there, tappable, after the reveal ends
    const capOwn = await rp.evaluate(() => {
      const R = window.__RV__, S = R.stage;
      S.clearBodies(); R.setGenome(''); R.frames(5, 1 / 30);
      R.dropCapsule(); R.frames(70, 1 / 30);
      const h1 = R.capsule;
      const a = S.playCapsuleReveal({ result: { genome: R.genome, tier: 'rare' }, createBody: (g) => new (R.body.constructor)(g), capsule: h1 });
      R.frames(8, 1 / 30);
      h1.setSqueeze(0); h1.remove();                                   // ignored while opening
      const opening = { point: h1.screenPoint(), hit: h1.hitTest(160, 120, 400), landed: h1.landed };
      R.dropCapsule(); const h2 = R.capsule;
      let k = 0; while (a.active && k < 300) { R.frames(1, 1 / 30); k++; }
      R.frames(40, 1 / 30);
      const p = h2.screenPoint(), vw = window.innerWidth, vh = window.innerHeight;
      const out = { opening, revealFrames: k, h2: { landed: h2.landed, point: p, hit: !!p && h2.hitTest(p.x, p.y), onScreen: !!p && p.x - p.r >= 0 && p.x + p.r <= vw && p.y - p.r >= 0 && p.y + p.r <= vh }, bodies: R.info().bodies };
      h2.remove(); R.frames(2, 1 / 30);
      return out;
    });
    R2.multi.capsuleOwnership = capOwn;
    check(capOwn.opening.point === null && !capOwn.opening.hit && !capOwn.opening.landed && capOwn.h2.landed && capOwn.h2.hit && capOwn.h2.onScreen && capOwn.bodies === 1,
      'the reveal owns its capsule (handle reads as opening, squeeze / remove ignored); a capsule dropped DURING a reveal lands on screen and stays tappable after it', JSON.stringify(capOwn));
    await rp.evaluate(() => { const R = window.__RV__; R.stage.clearBodies(); R.setGenome(''); R.frames(2); });

    // ---- D2. the canvas is OPAQUE (verifier finding 2): the WebGL buffer is composited over the page's CSS gradient, so any pixel with alpha < 255 shows
    // it through (a lighter halo with a straight quad edge under a waiting capsule, black holes in every toDataURL capture). Three always makes its own
    // context with alpha, so the blending of every draw (decal shadows, the transmissive jelly) has to leave alpha at 1.
    {
      const o1 = await rp.evaluate(() => { const R = window.__RV__; R.stage.clearBodies(); R.setGenome(''); R.frames(40); R.dropCapsule(); R.frames(80); const a = R.opaqueProbe(); R.capsule?.remove(); R.frames(2); return a; });
      const o2 = await rp.evaluate(() => {
        const R = window.__RV__; R.stage.clearBodies(); R.setGenome(''); R.frames(30, 1 / 30); R.setCalm(true);
        R.capsuleReveal('common'); let burst = -1;
        for (let k = 0; k < 120 && R.cerState().active; k++) { R.frames(1, 1 / 30); const b = R.cerState().beats.find((x) => x.beat === 'burst'); if (b && burst < 0) burst = k; if (burst >= 0 && k >= burst + 9) break; }
        const a = R.opaqueProbe(); R.skipCer(); R.frames(8, 1 / 30); R.setCalm(false); return a;
      });
      R2.opaque = { idleCapsule: o1, calmBurst: o2 };
      check(o1.notOpaque === 0 && o2.notOpaque === 0, 'the canvas is opaque: no pixel with alpha < 255 under a waiting capsule or at a calm reveal burst + 9 frames (the page gradient never shows through)', `${o1.notOpaque} of ${o1.w * o1.h} / ${o2.notOpaque} of ${o2.w * o2.h}`);
    }
    // ---- D3. a createBody that throws inside play*(): the stage is exactly as it was (the capsule is back on the table, tappable; the pillar / dome / hidden bodies are gone) ----
    {
      const tp = await rp.evaluate(() => window.__RV__.throwProbe());
      R2.throwing = tp;
      const cp = tp.capsule, mg = tp.merge;
      check(cp.threw.includes('boom') && cp.after.ceremony === false && cp.after.views === cp.before.views && cp.primaryVisible && cp.capsuleStanding === true && cp.capsuleTappable === true && cp.after.children === cp.before.children
        && mg.threw.includes('boom') && mg.after.ceremony === false && mg.after.views === mg.before.views && mg.primaryVisible && mg.after.children === mg.before.children,
      'createBody throwing inside playCapsuleReveal (Legendary: no pillar leaks, the capsule stays on the table and tappable) and playMergeCeremony (Mythic: no dome, no orphan parents, the play body visible): the stage is as it was', JSON.stringify({ capsule: { before: cp.before, after: cp.after, tappable: cp.capsuleTappable }, merge: { before: mg.before, after: mg.after } }));
    }
    // ---- D4. clearBodies / removeBody / setBody while a ceremony runs: no dangling primary id, done resolves ----
    {
      const mp = await rp.evaluate(() => window.__RV__.misuseProbe());
      R2.misuse = mp;
      check(Object.values(mp).every((x) => x.done && x.primaryHasView) && mp.clearBodies.bodies === 0 && mp.setBody.bodies === 1,
        'clearBodies / removeBody(result) / setBody during a merge ends it at its final frame: done resolves, primaryBodyId() never points at a removed view (verifier finding 3)', JSON.stringify(mp));
    }
    }

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
    const REQ = { capsule: (tier) => ['grab', 'crack', ...(TIERS6.indexOf(tier) >= 2 ? ['preroll'] : []), 'burst', 'reveal', 'settle'], merge: () => ['press', 'fold', 'charge', 'burst', 'reveal', 'settle'] };
    let worstTransitions = 0, worstWhere = '';
    const natural = {};
    // DESIGN 6.3 escalation table, transcribed from the spec (index = result tier). Burst particles: motes + glitter + Epic spiral trails (24)
    // + Legendary aurora ribbons (3 x 14 segments) + Mythic star points (24). Camera: push fraction (Legendary: a 7% pull-back), arc degrees.
    const ESC = {
      particles: [12, 24 + 6, 40 + 12, 70 + 24, 120 + 3 * 14, 200 + 24],
      calmParticles: [4, 7 + 2, 12 + 4, 21 + 7, 36 + 1 * 14, 60 + 7],             // x0.3 (rounded per kind; one ribbon of three)
      rings: [0, 0, 1, 2, 3, 3], push: [0, 0.02, 0.04, 0.06, 0, 0.05], pull: [0, 0, 0, 0, 0.07, 0], arc: [0, 0, 6, 10, 15, 25],
      dip: [[1, 0], [1, 0], [1, 0], [0.6, 0.25], [0.5, 0.35], [0.4, 0.5]],
    };
    const escOk = (r, i) => {
      const s = r.stats, [dScale, dLen] = ESC.dip[i];
      const okP = s.burstParticles === ESC.particles[i], okR = s.rings === ESC.rings[i] && s.fades === 0;
      const okC = Math.abs(s.push - ESC.push[i]) <= 0.002 && Math.abs(s.pull - ESC.pull[i]) <= 0.002 && Math.abs(s.arcDeg - ESC.arc[i]) <= 0.2;
      const okT = dLen === 0 ? s.minTimeScale === 1 && s.dipSeconds === 0 : Math.abs(s.minTimeScale - dScale) <= 0.01 && s.dipSeconds >= dLen && s.dipSeconds <= dLen + 0.2;
      return { ok: okP && okR && okC && okT && s.ramps === 1 && r.particlesDropped === 0, txt: `particles ${s.burstParticles}/${ESC.particles[i]}, rings ${s.rings}/${ESC.rings[i]}, push ${(s.push * 100).toFixed(1)}%/${ESC.push[i] * 100}%, pull-back ${(s.pull * 100).toFixed(1)}%/${ESC.pull[i] * 100}%, arc ${s.arcDeg.toFixed(1)}/${ESC.arc[i]} deg, time scale ${s.minTimeScale.toFixed(2)} for ${s.dipSeconds.toFixed(2)} s / ${dScale} for ${dLen} s, light ramps ${s.ramps}, dropped ${r.particlesDropped}` };
    };
    if (ON('cer')) {
    for (const kind of ['capsule', 'merge']) {
      for (const tier of tiersToRun) {
        const r = await run({ kind, tier, dt: DT });
        natural[`${kind}:${tier}`] = r;
        const budget = (kind === 'capsule' ? CAP_BUDGET : MER_BUDGET)[tier];
        const flashes = zigzag(r.lumas), win = worstWindow(flashes, DT), sw = swing(r.lumas);
        if (win > worstTransitions) { worstTransitions = win; worstWhere = `${kind}:${tier}`; }
        const order = r.beats.map((b) => b.beat);
        const beatsOk = JSON.stringify(order) === JSON.stringify(REQ[kind](tier));
        const ts = r.beats.map((b) => b.t);
        const monotone = ts.every((t, i) => i === 0 || t >= ts[i - 1] - 1e-6);
        R2.durations[`${kind}:${tier}`] = { budget, measured: r.seconds, reported: r.duration, frames: r.frames, beats: r.beats.map((b) => `${b.beat}@${b.t.toFixed(2)}`), maxScreenLight: r.maxLight, maxParticles: r.maxParticles, lumaMin: sw.min, lumaMax: sw.max, transitions1s: win, transitions1s_at_0_02: worstWindow(zigzagT(r.lumas, 0.02), DT), transitions1s_at_0_01: worstWindow(zigzagT(r.lumas, 0.01), DT) };
        check(Math.abs(r.seconds - budget) <= 0.1 * budget && Math.abs(r.duration - budget) <= 0.01 * budget + 1e-9, `${kind} ${tier}: duration ${r.seconds.toFixed(2)} s within 10% of the ${budget.toFixed(1)} s budget`, `reported ${r.duration.toFixed(2)} s`);
        check(beatsOk && monotone && r.doneResolved && r.bodiesAtEnd === 1 && r.resultVisibleAtEnd, `${kind} ${tier}: beats fire once in order ${REQ[kind](tier).join('>')}, done resolves, result is the one visible body`, `${order.join('>')} done=${r.doneResolved} bodies=${r.bodiesAtEnd}`);
        check(r.maxLight <= 0.25 + 1e-6 && win <= 3, `${kind} ${tier}: flash-safe (screen alpha <= 0.25; <= 3 luminance transitions in any 1 s)`, `max alpha ${r.maxLight.toFixed(3)}, worst 1 s window ${win} transitions, luma ${sw.min.toFixed(3)}..${sw.max.toFixed(3)}, particles <= ${r.maxParticles}`);
        const bt = r.beats.find((b) => b.beat === 'burst')?.t ?? -1, want = SYNC[kind][tier];
        const pre = r.beats.find((b) => b.beat === 'preroll')?.t;
        check(Math.abs(bt - want) <= DT + 1e-6 && (pre === undefined || Math.abs(pre - 0.65) <= DT + 1e-6), `${kind} ${tier}: 'burst' beat on the audio time map (_spec/SOUND.md) at ${want.toFixed(2)} s${pre !== undefined ? ", 'preroll' at 0.65 s" : ''}`, `burst at ${bt.toFixed(3)} s${pre !== undefined ? `, preroll at ${pre.toFixed(3)} s` : ''}`);
        R2.durations[`${kind}:${tier}`].minTopPx = r.minTopPx; R2.durations[`${kind}:${tier}`].minSidePx = r.minSidePx;
        check(r.minTopPx >= 0, `${kind} ${tier}: every body stays inside the top of the frame (the 1.25x spring-open and the rise included)`, `closest silhouette ${r.minTopPx.toFixed(0)} px from the top (320x240 viewport), ${r.minSidePx.toFixed(0)} px from a side`);
        const esc = escOk(r, TIERS6.indexOf(tier));
        R2.durations[`${kind}:${tier}`].escalation = r.stats;
        check(esc.ok, `${kind} ${tier}: DESIGN 6.3 escalation row exactly (burst particles, rings, camera push / arc, time-scale dip) + ONE light ramp`, esc.txt);
      }
    }
    check(worstTransitions <= 3, 'FLASH PROBE: no 1 s window of any capsule / merge ceremony has more than 3 luminance transitions', `worst ${worstTransitions} (${worstWhere}), threshold ${FLASH_THR} mean linear luminance`);
    }

    // CHAINED ceremonies (the independent verifier's adversarial sequences): skip a bright reveal right after its burst and open the next
    // one at once (Fast open), five quick pops back to back, a queue of capsules each skipped, three Epics in a row. The burst light is
    // governed ACROSS ceremonies (granted flashes >= 1 s apart; a refused burst is played soft) and a skip inside a burst fades like the burst
    // light: the same <= 3 transitions per rolling second must hold for the whole chain (target <= 2).
    if (ON('chains')) {
      const CH = {
        mythicSkipThenQuickCommon: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.73 }, { kind: 'capsule', tier: 'common', quick: true, startAt: 1.81 }],
        mythicSkipThenQuickUncommon: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.73 }, { kind: 'capsule', tier: 'uncommon', quick: true, startAt: 1.81 }],
        legendarySkipThenQuickUncommon: [{ kind: 'capsule', tier: 'legendary', skipAt: 1.53 }, { kind: 'capsule', tier: 'uncommon', quick: true, startAt: 1.61 }],
        mergeMythicSkipThenQuickUncommon: [{ kind: 'merge', tier: 'mythic', skipAt: 2.88 }, { kind: 'capsule', tier: 'uncommon', quick: true, startAt: 2.96 }],
        mythicSkipThenCommon: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.70 }, { kind: 'capsule', tier: 'common', startAt: 1.70 }],
        quickPops5Common: [0, 1, 2, 3, 4].map(() => ({ kind: 'capsule', tier: 'common', quick: true, gap: 0 })),
        quickPops5Uncommon: [0, 1, 2, 3, 4].map(() => ({ kind: 'capsule', tier: 'uncommon', quick: true, gap: 0 })),
        rareQueueSkipped: [0, 1, 2, 3].map(() => ({ kind: 'capsule', tier: 'rare', skipAt: 1.0, gap: 0.05 })),
        epicCapsules3: [0, 1, 2].map(() => ({ kind: 'capsule', tier: 'epic', gap: 0 })),
      };
      const chains = {};
      let worstChain = 0, worstChainAt = '';
      for (const [name, seq] of Object.entries(QUICK ? { mythicSkipThenQuickCommon: CH.mythicSkipThenQuickCommon, quickPops5Uncommon: CH.quickPops5Uncommon } : CH)) {
        const r = await rp.evaluate(([seq, dt]) => window.__RV__.runChain(seq, dt), [seq, DT]);
        const w = worstWindow(zigzag(r.lumas), DT);
        chains[name] = { transitions1s: w, transitions1s_at_0_02: worstWindow(zigzagT(r.lumas, 0.02), DT), ramps: r.light.filter((v, i) => v > 0.01 && (i === 0 || r.light[i - 1] <= 0.01)).length, maxLight: Math.max(...r.light), marks: r.marks.join(' ') };
        if (w > worstChain) { worstChain = w; worstChainAt = name; }
      }
      R2.chains = chains;
      check(worstChain <= 3, 'FLASH PROBE, CHAINED ceremonies (skip + Fast open, 5 quick pops, a skipped queue, 3 Epics): <= 3 luminance transitions in any 1 s', `worst ${worstChain} (${worstChainAt}); per chain ${Object.entries(chains).map(([k, v]) => `${k} ${v.transitions1s}`).join(', ')}`);
      // the same chains at 60 fps (the verifier's own frame rate: a swing of >= 0.04 mean linear luminance is a transition, > 3 in any rolling second fails; the
      // target is 2): the four chains that breached it (4 transitions in 0.87 s) plus the five quick pops, which sat exactly at the limit
      {
        const DT60 = 1 / 60, c60 = {};
        let worst60 = 0, at60 = '';
        for (const name of QUICK ? ['mythicSkipThenQuickCommon'] : ['mythicSkipThenQuickCommon', 'mythicSkipThenQuickUncommon', 'legendarySkipThenQuickUncommon', 'mergeMythicSkipThenQuickUncommon', 'quickPops5Common']) {
          const r = await rp.evaluate(([seq, dt]) => window.__RV__.runChain(seq, dt), [CH[name], DT60]);
          const w = worstWindow(zigzag(r.lumas), DT60);
          c60[name] = { transitions1s: w, ramps: r.light.filter((v, i) => v > 0.01 && (i === 0 || r.light[i - 1] <= 0.01)).length, maxLight: Math.max(...r.light) };
          if (w > worst60) { worst60 = w; at60 = name; }
        }
        R2.chains60 = c60;
        check(worst60 <= 2, 'FLASH PROBE, CHAINED ceremonies at 60 fps (the verifier\'s MAJOR 1 repros: Mythic / Legendary capsule or Mythic merge skipped, then a Fast-open quick pop; five quick pops): at most 2 luminance transitions in any 1 s (limit 3)', `worst ${worst60} (${at60}); per chain ${Object.entries(c60).map(([k, v]) => `${k} ${v.transitions1s} (ramps ${v.ramps}, light <= ${v.maxLight.toFixed(3)})`).join(', ')}`);
      }
    }

    if (ON('cer')) {
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

    {
      const pt = await rp.evaluate(() => window.__RV__.particleTail());
      R2.particleTail = pt;
      check(pt.before >= 8 && pt.after >= pt.before - 2, 'a natural end does not clear the particles: the sparkles of a tier-up merge are alive on its last frame and still there one frame later (verifier finding 5: 16 -> 0 in one frame)', `${pt.before} -> ${pt.after}`);
    }

    // ceremony drivers: FEATURE-DETECTED. 'native' = bodies that implement setFold / tremble / burstOpen (the dev stub; PHYS may add them to
    // the real body at any time) must be driven through them; 'puppet' = the same drivers hidden, the render lane's procedural puppet folds the ball
    {
      const nat = await run({ kind: 'merge', tier: 'epic', dt: DT, drivers: 'native' });
      const pup = await run({ kind: 'merge', tier: 'epic', dt: DT, drivers: 'puppet' });
      R2.drivers = { native: { spy: nat.drivers, native: nat.native, foldMax: nat.foldMax }, puppet: { spy: pup.drivers, native: pup.native, foldMax: pup.foldMax } };
      check(nat.native.length >= 9 && nat.native.every(Boolean) && nat.drivers.setFoldMax >= 0.99 && nat.drivers.tremble > 0 && nat.drivers.trembleMax > 0.5 && nat.drivers.burstOpen === 1 && nat.doneResolved && nat.bodiesAtEnd === 1,
        'merge with NATIVE ceremony drivers: setFold rises to 1, tremble during the charge, ONE burstOpen, done resolves', JSON.stringify(nat.drivers));
      check(pup.native.length >= 9 && pup.native.every((x) => !x) && pup.foldMax >= 0.95 && pup.doneResolved && pup.bodiesAtEnd === 1 && pup.beats.length === 6,
        'merge with the drivers HIDDEN: the procedural puppet folds the parents into the ball (fold >= 0.95), every beat, done resolves', `fold ${pup.foldMax.toFixed(2)}, beats ${pup.beats.length}`);
    }
    {
      const d = await rp.evaluate(() => window.__RV__.doneRobustness());
      R2.doneRobustness = d;
      check(d.interruptedResolved && d.disposedResolved && d.secondFinished && !d.rejected, 'CeremonyHandle.done never rejects or hangs: resolves when interrupted by a new ceremony and when the stage is disposed mid-ceremony', JSON.stringify(d));
      const ar = await rp.evaluate(() => window.__RV__.addRemove3(20));
      R2.multi.addRemove3 = ar;
      const flat = ['geometries', 'textures', 'programs'].every((k) => ar.slice(2).every((x) => x[k] === ar[2][k]));
      check(flat, '20 cycles of addBody x3 (common / rare / mythic) + removeBody x3: renderer.info memory flat after the first cycles', ['geometries', 'textures', 'programs'].map((k) => `${k} ${ar.map((x) => x[k]).join(',')}`).join(' | '));
      await rp.evaluate(() => { const R = window.__RV__; R.stage.clearBodies(); R.setGenome(''); R.frames(2); });
    }

    // skip(): jumps to the final reveal frame (120 ms crossfade), result never hidden, same final frame as the natural end.
    // "Same final frame" = the 48x36 RGB fingerprint 3 s after `done` (the natural ending lands with a wobble that is still ringing out at its
    // last ceremony frame), mean |diff| <= 1.5/255 per channel for EVERY tier. Each body view runs its own clock and skip() fast-forwards the
    // result's clock to the natural end, so time-phased idle effects (Mythic hue cycle, satellites, core pulse, blink) line up; what is left is
    // the soft body's own settle after the landing vs a reset body (sub-millimetre).
    for (const kind of ['capsule', 'merge']) {
      for (const tier of QUICK ? ['mythic'] : TIERS6) {
        const budget = (kind === 'capsule' ? CAP_BUDGET : MER_BUDGET)[tier];
        // 3 s of settle frames after each: the natural ending lands with a wobble that is still ringing out at the last ceremony frame
        const nat = await run({ kind, tier, dt: DT, settle: 90 });
        const sk = await run({ kind, tier, dt: DT, skipAt: budget * 0.42, settle: 90 });
        const d = rgbDiff(nat.fingerprint, sk.fingerprint);
        const order = sk.beats.map((b) => b.beat);
        const win = worstWindow(zigzag(sk.lumas), DT);
        R2.skip[`${kind}:${tier}`] = { fingerprintMeanAbsDiff: d, activeFramesAfterSkip: sk.activeAfterSkip, beats: order, transitions1s: win, maxScreenLight: sk.maxLight };
        const same = (x) => !x.ceremony && !x.capsule && x.screenLight === 0 && x.cameraFx.dist === 1 && x.cameraFx.yaw === 0 && x.cameraFx.pitch === 0 && x.primaryIsResult;
        check(same(sk.finalState) && same(nat.finalState), `${kind} ${tier}: after skip() AND after the natural end the stage state is identical (no ceremony, capsule gone, no screen light, camera at rest, the result is the primary body)`, JSON.stringify(sk.finalState));
        check(d <= 1.5 && sk.activeAfterSkip * DT >= 0.12 - 1e-6 && sk.activeAfterSkip * DT <= 0.12 + 2 * DT && sk.doneResolved && sk.bodiesAtEnd === 1 && sk.resultVisibleAtEnd && order.includes('reveal') && order.includes('settle'),
          `${kind} ${tier}: skip() ends on the same final frame (RGB fingerprint mean |diff| ${d.toFixed(2)}/255 <= 1.5), 120 ms crossfade, result visible, done resolves`, `crossfade ${sk.activeAfterSkip} frames, beats ${order.join('>')}, result clock natural ${nat.resultClock.toFixed(3)} s vs skip ${sk.resultClock.toFixed(3)} s`);
        check(win <= 3 && sk.maxLight <= 0.25 + 1e-6 && sk.resultHiddenFrames === 0, `${kind} ${tier}: skip() is flash-safe and never hides the result (not even mid-crossfade)`, `transitions ${win}, result hidden on ${sk.resultHiddenFrames} crossfade frames`);
      }
    }

    // Calm: no camera moves, no slow-mo, particles x0.3, rings -> fades, durations x0.65, no flash
    for (const kind of ['capsule', 'merge']) for (const tier of QUICK ? ['mythic'] : TIERS6) {
      const norm = natural[`${kind}:${tier}`] ?? (await run({ kind, tier, dt: DT, calm: false }));
      const calm = await run({ kind, tier, dt: DT, calm: true });
      const budget = (kind === 'capsule' ? CAP_BUDGET : MER_BUDGET)[tier] * 0.65;
      R2.calm[`${kind}:${tier}`] = { measured: calm.seconds, budget, maxScreenLight: calm.maxLight, particles: calm.maxParticles, normalParticles: norm.maxParticles, camRange: calm.camRange, normalCamRange: norm.camRange, stats: calm.stats };
      const cs = calm.stats, ti = TIERS6.indexOf(tier);
      check(Math.abs(calm.seconds - budget) <= 0.1 * budget && calm.maxLight === 0 && calm.camRange < 1e-6 && calm.maxParticles <= 0.45 * norm.maxParticles + 4 && (tier === 'common' || norm.camRange > 0.02)
        && cs.minTimeScale === 1 && cs.dipSeconds === 0 && cs.rings === 0 && cs.fades === ESC.rings[ti] && cs.burstParticles === ESC.calmParticles[ti] && cs.ramps === 0,
        `Calm ${kind} ${tier}: duration x0.65 (${calm.seconds.toFixed(2)} s), no screen light / ramp, no camera move, no slow-motion, particles x0.3, rings become fades`,
        `camera ${calm.camRange.toExponential(0)} vs ${norm.camRange.toFixed(2)} normal, burst particles ${cs.burstParticles} (expected ${ESC.calmParticles[ti]}), live particles ${calm.maxParticles} vs ${norm.maxParticles}, time scale ${cs.minTimeScale}, rings ${cs.rings} fades ${cs.fades}, ramps ${cs.ramps}`);
    }
    // Calm is calmer where it counts (verifier finding 10): in a 3x3 grid of the frame the compressed calm reveal made 4 transitions of >= 0.1 relative swing in 1 s in the
    // frame centre against 2-3 in normal mode (the result appeared in one frame, the tremble and twinkle still ran). Calm may not be busier than normal in ANY cell.
    {
      const rel = (a, b) => Math.abs(a - b) >= 0.1 && Math.min(a, b) < 0.8;
      const zzRel = (L) => { const idx = []; let dir = 0, pivot = L[0]; for (let k = 1; k < L.length; k++) { const v = L[k]; if (dir === 0) { if (v > pivot && rel(v, pivot)) { dir = 1; pivot = v; idx.push(k); } else if (v < pivot && rel(v, pivot)) { dir = -1; pivot = v; idx.push(k); } } else if (dir === 1) { if (v > pivot) pivot = v; else if (rel(v, pivot)) { dir = -1; pivot = v; idx.push(k); } } else { if (v < pivot) pivot = v; else if (rel(v, pivot)) { dir = 1; pivot = v; idx.push(k); } } } return idx; };
      const worstCell = (r) => { let w = 0; for (let k = 0; k < 9; k++) w = Math.max(w, worstWindow(zzRel(r.grids.map((g) => g[k])), DT)); return w; };
      const local = {};
      for (const [kind, tier] of QUICK ? [['capsule', 'mythic']] : [['capsule', 'rare'], ['capsule', 'epic'], ['capsule', 'legendary'], ['capsule', 'mythic'], ['merge', 'mythic']]) {
        const n = await run({ kind, tier, dt: DT, calm: false }), cl = await run({ kind, tier, dt: DT, calm: true });
        local[`${kind}:${tier}`] = { normal: worstCell(n), calm: worstCell(cl) };
      }
      R2.localFlash = local;
      check(Object.values(local).every((x) => x.calm <= 3 && x.calm <= x.normal + 1), 'Calm is no busier than normal in any 3x3 cell of the frame (transitions of >= 0.1 relative swing in any 1 s: calm <= 3 and <= normal + 1)', Object.entries(local).map(([k, v]) => `${k} calm ${v.calm} / normal ${v.normal}`).join(', '));
    }
    await rp.evaluate(() => { const R = window.__RV__; R.setCalm(false); R.stage.clearBodies(); R.setGenome(''); R.frames(2); });
    }
    report.problems.push(...rbad);
    await rctx.close();

    // ---- F. rarity ladder reads from the object: one body per tier, desktop + phone ----
    if (ON('rarity')) {
      const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const { page: sp, bad: sbad } = await openView(sctx, `quality=med&body=${bodyQ}`, 'rarity', [/GPU stall due to ReadPixels/i]);
      const cells = [], fps = [];
      for (const tier of TIERS6) {
        const r = await sp.evaluate((tier) => { const R = window.__RV__; R.showTier(tier); R.frames(110); const png = R.snapshot(); return { png, fp: R.fingerprint(), info: R.info() }; }, tier);
        cells.push([tier, r.png]); fps.push(r.fp);
        R2.rarity[tier] = { rarityFx: r.info.rarity ?? null };
      }
      await sheet(ctx_for_sheets(), 'rarity_sheet', cells, 3, 640, 400);
      // the same ladder on two more genomes (a violet banded one and a green speckled one): the tier must read on ANY body colour
      for (const seed of ['16', '19']) {
        const cg = [];
        for (const tier of TIERS6) cg.push([`${tier} (seed ${seed})`, await sp.evaluate(([tier, seed]) => { const R = window.__RV__; R.showTier(tier, seed); R.frames(110); return R.snapshot(); }, [tier, seed])]);
        await sheet(ctx_for_sheets(), `rarity_sheet_seed${seed}`, cg, 3, 640, 400);
      }
      // ... and on a physically OPAQUE family (marshmallow, translucency capped at 0.4 at every tier): the tier must read without "more translucency"
      {
        const gm = speciesBaseGenome('wisplet', 1), cg = [];
        for (const tier of TIERS6) cg.push([`${tier} (wisplet, marshmallow)`, await sp.evaluate(([tier, g]) => { const R = window.__RV__; R.showTier(tier, g); R.frames(110); return R.snapshot(); }, [tier, gm])]);
        await sheet(ctx_for_sheets(), 'rarity_sheet_marshmallow', cg, 3, 640, 400);
      }
      const dmin = Math.min(...fps.slice(1).map((f, i) => fpDiff(fps[i], f)));
      check(dmin > 1.2, 'rarity sheet: every tier differs visibly from the previous one', `min adjacent mean |diff| ${dmin.toFixed(2)}/255`);
      // the Common merge makes no camera move (DESIGN 6.3 camera column: none); verifier: the merge widening was applied to every tier (12% for Common)
      {
        const cc = await sp.evaluate(() => window.__RV__.camThrough('merge', 'common'));
        R2.camCommonMerge = cc;
        check(cc.max <= cc.first * 1.04 && cc.min >= cc.first * 0.96, 'a Common merge keeps the play framing: the camera framing stays within 4% of its first frame from press to settle (1280x800; the old widening was 12%)', `first ${cc.first.toFixed(3)}, min ${cc.min.toFixed(3)}, max ${cc.max.toFixed(3)}, last ${cc.last.toFixed(3)}`);
      }
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
      // the tier halos never reach the sides of the narrow frame (verifier: the Mythic dome and the Rare / Epic auras touched the frame sides on 390x844)
      {
        const he = {};
        for (const tier of ['rare', 'epic', 'legendary', 'mythic']) he[tier] = (await pp2.evaluate((tier) => window.__RV__.haloEdge(tier), tier)).edge;
        R2.haloEdge = he;
        // ... nor does the Mythic dome of a ceremony swell past them (before the cap it crossed both sides by 111 px (capsule) / 153 px (merge) on 390x844 low)
        const dm = { merge: await pp2.evaluate(() => window.__RV__.domeMargin('merge')), capsule: await pp2.evaluate(() => window.__RV__.domeMargin('capsule')) };
        R2.domeMargin = dm;
        check(dm.merge.minMarginPx >= 0 && dm.capsule.minMarginPx >= 0, 'phone 390x844: the Mythic prism dome of a merge and of a capsule reveal stays inside the sides of the frame through the whole ceremony (rim margin >= 0 px; it crossed both sides by up to 153 px)', `merge ${dm.merge.minMarginPx.toFixed(0)} px (dome radius ${dm.merge.rx.toFixed(2)} at frame ${dm.merge.atFrame}), capsule ${dm.capsule.minMarginPx.toFixed(0)} px`);
        check(Object.values(he).every((v) => v <= 0.75), 'phone 390x844: no tier halo (Rare aura, Epic ring, Legendary pillar glow, Mythic dome) reaches the sides of the frame (mean |difference| of the 6 px edge columns with the tier FX on / hidden <= 0.75/255)', Object.entries(he).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
      }
      // MERGE_COST 3 on a narrow portrait frame (the triangle layout; the wide frames above used the row)
      const m3p = await pp2.evaluate(() => window.__RV__.runCeremony({ kind: 'merge', tier: 'epic', dt: 1 / 30, parents: 3, settle: 10 }));
      check(Math.abs(m3p.seconds - MER_BUDGET_EPIC) <= 0.1 * MER_BUDGET_EPIC && m3p.bodiesAtEnd === 1 && m3p.beats.length === 6 && m3p.doneResolved && m3p.maxLight <= 0.25 + 1e-6 && m3p.minTopPx >= 0,
        'merge with 3 parents on a 390x844 portrait frame (triangle layout): on budget, every beat, one body at the end, never above the frame top', `${m3p.seconds.toFixed(2)} s, beats ${m3p.beats.map((x) => x.beat).join('>')}, closest silhouette ${m3p.minTopPx.toFixed(0)} px from the top`);
      check(capP.info.landed && capP.info.hit && capP.whole, 'dropCapsule() on a 390x844 portrait frame: lands, whole on screen, tappable', JSON.stringify({ point: capP.info.point, hit: capP.info.hit }));
      writeFileSync(resolve(OUT, 'capsule_cue_phone.png'), b64(capP.png));
      await sheet(ctx_for_sheets(), 'rarity_sheet_phone', cellsP, 6, 260, 563);
      console.log('wrote rarity_sheet_phone.png');
      await pctx2.close();
      report.problems.push(...pbad2);
    }

    // ---- G. filmstrips: 6 tiers x 7 beats for both ceremonies, 1280x800 (med) and 390x844 (low) ----
    if (!QUICK && ON('film')) {
      const PRE = { common: 0, uncommon: 0, rare: 0.3, epic: 0.5, legendary: 0.8, mythic: 1.0 };
      const MERGE_BURST_AT = { common: 1.3, uncommon: 1.5, rare: 1.8, epic: 2.1, legendary: 2.4, mythic: 2.8 };   // = audio MERGE_CHARGE_S
      const timesFor = (kind, t) => {
        if (kind === 'capsule') {
          const burst = 0.65 + PRE[t], reveal = burst + 0.35, D = CAP_BUDGET[t];
          return [['grab', 0.2], ['crack', 0.5], ['tell', burst - 0.05], ['burst', burst + 0.1], ['drop', burst + 0.4], ['reveal', reveal + (D - reveal) * 0.5], ['final', D - 0.03]];
        }
        const t3 = MERGE_BURST_AT[t], D = MER_BUDGET[t];
        return [['slide', 0.25], ['press', 0.42], ['fold', 0.75], ['charge', t3 - 0.3], ['burst', t3 + 0.08], ['rise', t3 + 0.55], ['final', D - 0.03]];
      };
      mkdirSync(resolve(OUT, 'film'), { recursive: true });
      for (const [label, vp, query, cols, cw, ch, tiersSel] of [
        ['desktop', { width: 1280, height: 800 }, 'quality=med', 7, 320, 200, TIERS6],
        ['phone', { width: 390, height: 844 }, 'quality=low', 7, 130, 281, TIERS6],
      ]) {
        const fctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        const { page: fpg, bad: fbad } = await openView(fctx, `${query}&body=${bodyQ}`, `filmstrip-${label}`, [/GPU stall due to ReadPixels/i]);
        for (const kind of ['capsule', 'merge', 'merge3']) {   // merge3 = MERGE_COST 3 (row on wide frames, triangle on narrow ones)
          const cells = [];
          for (const tier of kind === 'merge3' ? ['rare', 'mythic'] : tiersSel) {
            const ts = timesFor(kind === 'merge3' ? 'merge' : kind, tier);
            for (let i = 0; i < ts.length; i++) {
              const [beat, t] = ts[i];
              const jpg = await fpg.evaluate(([kind, tier, t, first]) => { const R = window.__RV__; if (first) { if (kind === 'capsule') R.capsuleReveal(tier); else R.merge(tier, kind === 'merge3' ? 3 : 2, false); } R.cerSeek(t, 1 / 30); return R.stage.canvas.toDataURL('image/jpeg', 0.9); }, [kind, tier, t, i === 0]);
              if (label === 'desktop') writeFileSync(resolve(OUT, 'film', `${kind}_${tier}_${i}_${beat}.jpg`), b64(jpg));
              cells.push([`${tier} ${beat} ${t.toFixed(2)}s`, jpg]);
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

  /* ───────────────────────── stage B (RENDER-3): species gallery, contact glow, tack strands, several bodies on the mat ───────────────────────── */
  {
    const bodyQ = BODY === 'auto' ? '' : BODY;
    const RB = (report.stageB = { gallery: {}, glow: null, strands: {}, mat: {} });
    const sheetCtxB = await browser.newContext({ viewport: { width: 800, height: 600 } });
    // ---- gallery: all 50 species at rest (their own catalog look and material family), 1280x800 med and 390x844 low ----
    if (ON('gallery')) for (const [label, vp, q, cw, ch] of QUICK ? [['desktop', { width: 1280, height: 800 }, 'med', 256, 160]] : [['desktop', { width: 1280, height: 800 }, 'med', 256, 160], ['phone', { width: 390, height: 844 }, 'low', 117, 253]]) {
      const gctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const { page: gp, bad: gbad } = await openView(gctx, `quality=${q}&body=${bodyQ}`, `gallery-${label}`, [/GPU stall due to ReadPixels/i]);
      const cells = [], fps = [];
      for (const d of CATALOG) {
        const g = speciesBaseGenome(d.id, 1);
        const r = await gp.evaluate(([tier, g]) => { const R = window.__RV__; R.showTier(tier, g); R.frames(100); return { png: R.stage.canvas.toDataURL('image/jpeg', 0.88), fp: R.fingerprint() }; }, [d.tier, g]);
        cells.push([`${d.name} (${d.tier}, ${d.family})`, r.png]); fps.push(r.fp);
      }
      await sheet(sheetCtxB, `gallery_50_${label}`, cells, 10, cw, ch);
      console.log(`wrote gallery_50_${label}.png`);
      // distinguishable at a glance: every species' frame differs from every other's (luma grid mean |diff|)
      let minD = Infinity, pair = '';
      for (let a = 0; a < fps.length; a++) for (let b = a + 1; b < fps.length; b++) { const dd = fpDiffB(fps[a], fps[b]); if (dd < minD) { minD = dd; pair = `${CATALOG[a].id}/${CATALOG[b].id}`; } }
      RB.gallery[label] = { minPairDiff: minD, pair };
      check(minD > 1.0, `gallery ${label}: all 50 species differ visibly from each other at rest (closest pair: mean per-pixel max channel |diff|)`, `${minD.toFixed(2)}/255 (${pair})`);
      report.problems.push(...gbad);
      await gctx.close();
    }
    if (ON('glow') || ON('strands')) {
    const bctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    const { page: bp, bad: bbad } = await openView(bctx, `quality=med&body=${bodyQ}`, 'stageB', [/GPU stall due to ReadPixels/i]);
    // ---- B5 contact glow ----
    if (ON('glow')) {
      const glow = await bp.evaluate(() => { const R = window.__RV__; R.setGenome(''); R.frames(60); return R.contactGlowProbe(); });
      RB.glow = glow;
      if (!glow.hasTip) check(true, 'contact glow: skipped (the body has no tip(); feature-detected)', '');
      else check(glow.boxOn > glow.boxOff * 1.06 && glow.boxOn - glow.boxOff > 0.004 && Math.abs(glow.globalOn - glow.globalOff) < 0.02,
        'contact glow (B5): the pressed spot blooms (local luminance up), the frame does not flash (global mean change < 0.02)', `box ${glow.boxOff.toFixed(4)} -> ${glow.boxOn.toFixed(4)}, frame ${glow.globalOff.toFixed(4)} -> ${glow.globalOn.toFixed(4)}, strength ${glow.amt.toFixed(2)}`);
    }
    // ---- B6 tack strands (a sticky-stretch species and a slime; a gel must NOT string) ----
    if (ON('strands')) {
      const tacky = [CATALOG.find((d) => d.family === 'stickystretch'), CATALOG.find((d) => d.family === 'slimegoo')];
      const gel = CATALOG.find((d) => d.family === 'jellygel');
      for (const d of [...tacky, gel]) {
        const r = await bp.evaluate(([g]) => window.__RV__.strandProbe(g), [speciesBaseGenome(d.id, 1)]);
        RB.strands[d.id] = { family: r.family, maxStrands: r.maxStrands, strandFrames: r.strandFrames, tensionEvents: r.tensionEvents, snapEvents: r.snapEvents };
        if (r.png) writeFileSync(resolve(OUT, `strand_${d.id}.png`), b64(r.png));
        if (d.family === 'jellygel') check(r.strandFrames === 0 && r.snapEvents === 0, `tack strands (B6): a ${d.family} body (${d.id}) never strings`, JSON.stringify(RB.strands[d.id]));
        else if (r.maxStrands <= 0) check(true, `tack strands (B6): ${d.id} (${d.family}): skipped, the physics reports no strands for it yet`, JSON.stringify(RB.strands[d.id]));
        else check(r.strandFrames > 2 && r.snapEvents >= 1 && r.tensionEvents >= 2, `tack strands (B6): ${d.id} (${d.family}) strings when the held finger lifts, stretches, snaps once; the shell's strand hook gets tension frames and the snap`, JSON.stringify(RB.strands[d.id]));
      }
    }
    report.problems.push(...bbad);
    await bctx.close();
    }
    // ---- B1 several bodies on the mat, framed: desktop and phone ----
    if (ON('mat')) for (const [label, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
      const mctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const { page: mp, bad: mbad } = await openView(mctx, `quality=low&body=${bodyQ}`, `mat-${label}`, [/GPU stall due to ReadPixels/i]);
      for (const n of [2, 3, 5]) {
        const r = await mp.evaluate((n) => window.__RV__.matProbe(n, ['', '2', '3', '16', '19']), n);
        writeFileSync(resolve(OUT, `mat_${n}_${label}.png`), b64(r.png));
        const widths = r.boxes.map((q) => q[2] - q[0]).sort((a, b) => a - b), medW = widths[Math.floor(widths.length / 2)];
        RB.mat[`${label}:${n}`] = { inFrame: r.inFrame, minGapPx: r.minGapPx, medianBodyPx: medW, bodies: r.bodies };
        check(r.bodies === n && r.inFrame && r.minGapPx > 0.45 * medW && medW > (label === 'phone' ? 60 : 150),
          `mat (B1) ${label}: ${n} bodies at stage.matLayout(${n}) all inside the frame, readable (centres >= 0.45 body widths apart, bodies >= ${label === 'phone' ? 60 : 150} px wide)`,
          `min centre gap ${r.minGapPx.toFixed(0)} px, median body ${medW.toFixed(0)} px, in frame ${r.inFrame}`);
      }
      report.problems.push(...mbad);
      await mctx.close();
    }
    // ---- the meter-full capsule lands clear of the HUD's bottom 72 CSS px (default safe inset) and, wherever the frame allows, of the body ----
    // (the last two: a tall phone with the shell's real HUD rows, ~96 px on top and ~200 px at the bottom; a round and a wide species)
    // ---- the Hoard preview with the mat out (setBody + the mat bodies re-added): the framing eases, it never jumps in and back out ----
    if (ON('mat')) for (const [label, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
      const sctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const { page: sp2, bad: sbad } = await openView(sctx, `quality=low&body=${bodyQ}`, `swap-${label}`, [/GPU stall due to ReadPixels/i]);
      const r = await sp2.evaluate(() => window.__RV__.swapProbe());
      RB.mat[`swap:${label}`] = r;
      // (eased: under 2% of the framing per frame; it may settle by up to 1% on the first frame, the earlier snap jumped ~10% in)
      check(r.maxStep < 0.02 * r.before && r.minDuring >= Math.min(r.before, r.after) - 0.01 * r.before,
        `mat ${label}: a play-body swap with bodies on the mat (the Hoard preview) eases the framing from where it was (no jump in and back out)`,
        `framing ${r.before.toFixed(3)} -> ${r.after.toFixed(3)}, largest step per frame ${r.maxStep.toFixed(4)}, lowest during ${r.minDuring.toFixed(3)}, every 10th frame ${r.series.map((x) => x.toFixed(3)).join(',')}`);
      report.problems.push(...sbad);
      await sctx.close();
    }
    // The shell's REAL HUD rows (measured on the real app at every size: _handoff/reports/RENDER_R.md): the top bar ends at 56 CSS px, the bottom row starts
    // 74 px (portrait) / 77 px (landscape) above the bottom edge. The capsule stands BESIDE the squishy at every size, clear of those rows and of the body: on a narrow
    // portrait frame the camera pulls back a little (<= 1.2x, 1.32x for a very wide species) and the capsule stands a little smaller, never in front of the body (the owner's phone report).
    const HUD_P = { top: 56, bottom: 74 }, HUD_L = { top: 56, bottom: 77 };
    if (ON('capspot')) for (const [vw, vh, ins, sp] of [[568, 320, HUD_L, ''], [320, 256, HUD_L, ''], [844, 390, HUD_L, ''], [1280, 800, HUD_L, ''], [390, 844, null, ''],
      [390, 844, HUD_P, ''], [360, 640, HUD_P, ''], [412, 915, HUD_P, ''], [320, 568, HUD_P, ''],
      [390, 844, HUD_P, 'crimpo'], [390, 844, HUD_P, 'twangle'], [390, 844, HUD_P, 'wrigglo'], [320, 568, HUD_P, 'cushlet'], [844, 390, HUD_L, 'crimpo']]) {
      const cctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
      const { page: cp, bad: cbad } = await openView(cctx, `quality=low&body=${bodyQ}`, `capspot-${vw}x${vh}`, [/GPU stall due to ReadPixels/i]);
      const r = await cp.evaluate(([ins, g]) => {
        const R = window.__RV__;
        if (ins) R.stage.setSafeInsets(ins);
        if (g) R.setGenomeObject(g); else R.setGenome('');
        R.frames(120);
        const W = R.stage.canvas.clientWidth, H = R.stage.canvas.clientHeight, cam = R.stage.camera;
        const box = () => {
          const v = R.stage.views[0], Q = v.proxy.positions, P = new (cam.position.constructor)();
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (let i = 0; i < Q.length; i += 3) { P.set(Q[i], Q[i + 1], Q[i + 2]).project(cam); const sx = (P.x * 0.5 + 0.5) * W, sy = (1 - (P.y * 0.5 + 0.5)) * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
          return [x0, y0, x1, y1];
        };
        const b0 = box();
        R.dropCapsule();
        const tr = R.camTrace(150, 1 / 60);
        R.frames(1);
        let maxStep = 0; for (let i = 1; i < tr.length; i++) maxStep = Math.max(maxStep, Math.abs(tr[i] - tr[i - 1]) / tr[i - 1]);
        const ci = R.capsuleInfo(), b = box();
        const p = ci.point, rr = p ? p.r / 1.35 : 0;
        const cap = p ? [p.x - rr * 0.75, p.y - rr * 1.4, p.x + rr * 0.75, p.y + rr * 1.4] : null;
        const ov = cap ? Math.max(0, Math.min(cap[2], b[2]) - Math.max(cap[0], b[0])) * Math.max(0, Math.min(cap[3], b[3]) - Math.max(cap[1], b[1])) : -1;
        return { W, H, landed: ci.landed, hit: ci.hit, cap: cap && cap.map(Math.round), body: b.map(Math.round), bodyBefore: b0.map(Math.round), overlapPx2: Math.round(ov), maxStep, size: R.stage.info.cap?.size ?? -1, camScale: tr[tr.length - 1], camScale0: tr[0], png: R.snapshot() };
      }, [ins ?? null, sp ? speciesBaseGenome(sp, 1) : null]);
      const tag = `${vw}x${vh}${ins ? '_hud' : ''}${sp ? '_' + sp : ''}`;
      writeFileSync(resolve(OUT, `capspot_${tag}.png`), b64(r.png));
      const bot = ins ? ins.bottom : 72, top = ins ? ins.top : 0;
      const okBottom = !!r.cap && r.cap[3] <= r.H - bot && r.cap[0] >= 0 && r.cap[2] <= r.W && r.cap[1] >= top;
      const bw = r.body[2] - r.body[0], bw0 = r.bodyBefore[2] - r.bodyBefore[0], inFrame = r.body[0] >= 0 && r.body[2] <= r.W;
      RB.mat[`capspot:${tag}`] = { cap: r.cap, body: r.body, bodyBefore: r.bodyBefore, size: r.size, maxStep: r.maxStep };
      // body keeps >= 74% of its width (the pull-back is <= 1.2x: 83%, up to 1.32x = 76% for a very wide species; a little less when the aim shifts), the whole body stays in the frame, the camera eases (< 2% per frame), and the capsule is tappable
      check(r.landed && r.hit && okBottom && r.overlapPx2 === 0 && inFrame && bw >= 0.74 * bw0 && r.maxStep < 0.02,
        `capsule spot ${vw}x${vh}${ins ? ` with the shell's HUD rows (top ${top}, bottom ${bot})` : ''}${sp ? ', ' + sp : ''}: BESIDE the squishy, clear of the HUD rows and of the body, the body keeps its size (>= 74%) and the camera eases`,
        `capsule ${JSON.stringify(r.cap)} (size ${r.size.toFixed(2)}), body ${JSON.stringify(r.body)} (was ${bw0.toFixed(0)} px wide, now ${bw.toFixed(0)}), overlap ${r.overlapPx2} px2, largest camera step ${(r.maxStep * 100).toFixed(2)}%/frame, frame ${r.W}x${r.H}`);
      report.problems.push(...cbad);
      await cctx.close();
    }
    // every one of the 50 species on the 390x844 phone with the shell's real HUD rows: the capsule beside it, clear of the body and of the HUD rows, the body in the frame
    if (ON('capspot')) {
      const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const { page: ap2, bad: abad2 } = await openView(actx, `quality=low&body=${bodyQ}`, 'capspot-all', [/GPU stall due to ReadPixels/i]);
      const ids = CATALOG.map((d) => d.id);
      const res = [];
      for (const id of ids) {
        const r = await ap2.evaluate(([g, ins]) => {
          const R = window.__RV__;
          R.stage.setSafeInsets(ins); R.setGenomeObject(g); R.frames(60);
          const W = R.stage.canvas.clientWidth, H = R.stage.canvas.clientHeight, cam = R.stage.camera;
          const box = () => { const v = R.stage.views[0], Q = v.proxy.positions, P = new (cam.position.constructor)(); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i < Q.length; i += 3) { P.set(Q[i], Q[i + 1], Q[i + 2]).project(cam); const sx = (P.x * 0.5 + 0.5) * W, sy = (1 - (P.y * 0.5 + 0.5)) * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); } return [x0, y0, x1, y1]; };
          const b0 = box(); R.dropCapsule(); R.camTrace(120, 1 / 60); R.frames(1);
          const ci = R.capsuleInfo(), b = box(), p = ci.point, rr = p ? p.r / 1.35 : 0;
          const cap = p ? [p.x - rr * 0.75, p.y - rr * 1.4, p.x + rr * 0.75, p.y + rr * 1.4] : null;
          const ov = cap ? Math.max(0, Math.min(cap[2], b[2]) - Math.max(cap[0], b[0])) * Math.max(0, Math.min(cap[3], b[3]) - Math.max(cap[1], b[1])) : -1;
          const size = R.stage.info.cap?.size ?? -1; R.capsule?.remove(); R.frames(2);
          return { landed: ci.landed, hit: ci.hit, cap: cap && cap.map(Math.round), body: b.map(Math.round), w0: Math.round(b0[2] - b0[0]), ov: Math.round(ov), size, H };
        }, [speciesBaseGenome(id, 1), HUD_P]);
        const bw = r.body[2] - r.body[0];
        const ok = r.landed && r.hit && !!r.cap && r.cap[3] <= r.H - HUD_P.bottom && r.cap[1] >= HUD_P.top && r.cap[0] >= 0 && r.cap[2] <= 390 && r.ov === 0 && r.body[0] >= 0 && r.body[2] <= 390 && bw >= 0.74 * r.w0;
        res.push({ id, ok, ...r, bw });
      }
      const bad = res.filter((x) => !x.ok);
      RB.mat['capspot:all50'] = { failed: bad.map((x) => x.id), sizes: Object.fromEntries(res.map((x) => [x.id, +x.size.toFixed(2)])) };
      check(bad.length === 0, 'capsule spot, 390x844 with the HUD rows of the real shell, ALL 50 species: beside the squishy, clear of the body and of the HUD rows, the body in the frame and >= 74% of its width', bad.length ? bad.map((x) => `${x.id} cap ${JSON.stringify(x.cap)} body ${JSON.stringify(x.body)} ov ${x.ov} size ${x.size.toFixed(2)} w ${x.bw}/${x.w0}`).join('; ') : `smallest capsule ${Math.min(...res.map((x) => x.size)).toFixed(2)}, mean ${(res.reduce((a, x) => a + x.size, 0) / res.length).toFixed(2)}, widest pull-back to ${(Math.min(...res.map((x) => x.bw / x.w0)) * 100).toFixed(0)}% of the body's width`);
      report.problems.push(...abad2);
      await actx.close();
    }
    // A capsule that is ALREADY WAITING when the game boots: the shell drops it while it builds the game, before the stage's first resize(). Measured on the real app
    // (390x844, the real HUD rows): it stood in FRONT of the squishy, full size, against the frame's right edge (z 3.4); a capsule dropped during play stood beside it,
    // smaller (z 0.15, size 0.66). The stage now places it on the first update after the frame has a size. (Here: a fresh stage, the HUD rows set first as the shell's HUD
    // binding does, the capsule dropped, THEN resize().)
    if (ON('capspot')) {
      const bctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
      const { page: bp2, bad: bbad2 } = await openView(bctx, `quality=low&body=${bodyQ}`, 'capspot-boot', [/GPU stall due to ReadPixels/i]);
      const rows = [];
      for (const [vw, vh, ins, sp] of [[390, 844, HUD_P, 'dollop'], [390, 844, HUD_P, 'crimpo'], [360, 640, HUD_P, 'dollop'], [320, 568, HUD_P, 'cushlet'], [844, 390, HUD_L, 'dollop'], [568, 320, HUD_L, 'dollop'], [1280, 800, HUD_L, 'dollop']]) {
        const r = await bp2.evaluate(([g, vw, vh, ins]) => window.__RV__.bootDropProbe({ genome: g, w: vw, h: vh, insets: ins }), [speciesBaseGenome(sp, 1), vw, vh, ins]);
        writeFileSync(resolve(OUT, `capboot_${vw}x${vh}_${sp}.png`), b64(r.png));
        const beside = !!r.cap && (r.cap[0] >= r.body[2] - 2 || r.cap[2] <= r.body[0] + 2);
        const inside = !!r.cap && r.cap[3] <= vh - ins.bottom && r.cap[1] >= ins.top && r.cap[0] >= 0 && r.cap[2] <= vw;
        rows.push({ vw, vh, sp, ok: !r.beforeResize.landed && !r.beforeResize.point && r.landed && r.hit && inside && r.ov === 0 && beside && r.body[0] >= 0 && r.body[2] <= vw, r, beside });
      }
      RB.mat['capboot'] = rows.map((x) => ({ vw: x.vw, vh: x.vh, sp: x.sp, cap: x.r.cap, body: x.r.body, size: x.r.size, z: x.r.z }));
      const badBoot = rows.filter((x) => !x.ok);
      check(badBoot.length === 0, 'a capsule already waiting at boot (dropped before the stage has a size) lands, once the frame is sized, BESIDE the squishy, clear of it and of the HUD rows, tappable, never in front or full size against an edge (390x844 x2, 360x640, 320x568, 844x390, 568x320, 1280x800)',
        badBoot.length ? badBoot.map((x) => `${x.vw}x${x.vh} ${x.sp}: cap ${JSON.stringify(x.r.cap)} body ${JSON.stringify(x.r.body)} z ${x.r.z.toFixed(2)} size ${x.r.size.toFixed(2)} ov ${x.r.ov} landed ${x.r.landed} before ${JSON.stringify(x.r.beforeResize)}`).join('; ') : rows.map((x) => `${x.vw}x${x.vh} ${x.sp} z ${x.r.z.toFixed(2)} size ${x.r.size.toFixed(2)}`).join(', '));
      report.problems.push(...bbad2);
      await bctx.close();
      // ... and a WAITING capsule when the frame, the HUD rows or the squishy change under it: it glides to a clean spot by itself (rotate the phone, a taller HUD row, a wide species switched in)
      const lctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
      const { page: lp2, bad: lbad2 } = await openView(lctx, `quality=low&body=${bodyQ}`, 'capspot-live', [/GPU stall due to ReadPixels/i]);
      const L = await lp2.evaluate((o) => window.__RV__.capLiveProbe(o), { genome: speciesBaseGenome('dollop', 1), w1: 1280, h1: 800, ins1: HUD_L, w2: 390, h2: 844, ins2: HUD_P, bottom3: 200, wide: speciesBaseGenome('crimpo', 1) });
      ['desktop', 'phone', 'phone_hud200', 'phone_wide'].forEach((n, i) => writeFileSync(resolve(OUT, `caplive_${n}.png`), b64(L.pngs[i])));
      const okAt = (r, ins, W) => !!r.cap && r.landed && r.hit && r.cap[3] <= r.H - ins.bottom && r.cap[1] >= ins.top && r.cap[0] >= 0 && r.cap[2] <= W && r.ov === 0;
      const stepsOk = [okAt(L.r0, HUD_L, 1280), okAt(L.r1, HUD_P, 390), okAt(L.r2, { top: HUD_P.top, bottom: 200 }, 390), okAt(L.r3, { top: HUD_P.top, bottom: 200 }, 390)];
      RB.mat['caplive'] = { r0: L.r0.cap, r1: L.r1.cap, r2: L.r2.cap, r3: L.r3.cap, moved: L.moved };
      check(stepsOk.every(Boolean), 'a WAITING capsule stays clean when the world changes under it: the frame is turned from 1280x800 to 390x844, the HUD bottom row grows to 200 px, a wide squishy is switched in (it glides to a spot inside the frame, above the rows, clear of the body, still tappable)',
        `ok ${stepsOk.join('/')}; caps ${[L.r0, L.r1, L.r2, L.r3].map((r) => JSON.stringify(r.cap)).join(' ')}; bodies ${[L.r0, L.r1, L.r2, L.r3].map((r) => JSON.stringify(r.body)).join(' ')}; moved ${L.moved.map((m) => m.toFixed(2)).join(', ')} m`);
      report.problems.push(...lbad2);
      await lctx.close();
    }
    await sheetCtxB.close();
  }

  /* ───────────────────────── CUT visuals (_spec/CUT.md): chunks, seam, parting strand, bridge, 6 pieces framed, the X09 flash gate ───────────────────────── */
  if (ON('cut')) {
    const bodyQ = BODY === 'auto' ? '' : BODY;
    const RC = (report.cut = { faces: {}, runs: {}, framing: {}, cost: null });
    const zz = (L, thr = 0.04) => {
      const idx = []; let dir = 0, pivot = L[0];
      for (let k = 1; k < L.length; k++) {
        const v = L[k];
        if (dir === 0) { if (v - pivot >= thr) { dir = 1; pivot = v; idx.push(k); } else if (pivot - v >= thr) { dir = -1; pivot = v; idx.push(k); } }
        else if (dir === 1) { if (v > pivot) pivot = v; else if (pivot - v >= thr) { dir = -1; pivot = v; idx.push(k); } }
        else { if (v < pivot) pivot = v; else if (v - pivot >= thr) { dir = 1; pivot = v; idx.push(k); } }
      }
      return idx;
    };
    const ww = (idx, dt) => { let w = 0; for (let i = 0; i < idx.length; i++) { let n = 0; for (let j = i; j < idx.length && idx[j] - idx[i] < 1 / dt; j++) n++; w = Math.max(w, n); } return w; };
    const cctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    const { page: xp, bad: xbad } = await openView(cctx, `quality=med&body=${bodyQ}`, 'cut', [/GPU stall due to ReadPixels/i]);
    // ---- 1. a piece drawn without a face (AddBodyOpts.chunk): the real body and a stub piece, whole vs chunk ----
    for (const kind of ['real', 'stub']) {
      const r = await xp.evaluate(([g, kind]) => window.__RV__.chunkFaceProbe(g, kind), [speciesBaseGenome('dollop', 1), kind]);
      writeFileSync(resolve(OUT, `cut_face_whole_${kind}.png`), b64(r.pngWhole));
      writeFileSync(resolve(OUT, `cut_chunk_${kind}.png`), b64(r.pngChunk));
      RC.faces[kind] = { inkWhole: r.whole, inkChunk: r.chunk, eyeFootprint: r.mask, faceVisible: r.faceVisible };
      check(r.faceVisible[0] === true && r.faceVisible[1] === false && r.mask >= 30 && r.whole >= 0.3 * r.mask && r.chunk <= 0.05 * r.whole,
        `CUT: a ${kind} body added with { chunk: true } is drawn without a face (dark eye pixels inside the eyes' footprint: whole vs chunk, same body)`, `eye footprint ${r.mask} px, dark ink ${r.whole} -> ${r.chunk}, face visible ${r.faceVisible.join('/')}`);
    }
    // ---- 2. X09: 10 rapid cuts (seam, swap, parting strand; at 6 pieces the two smallest reconnect first) and a Reconnect all ----
    const DTc = 1 / 30;
    for (const [name, sp, calm] of QUICK ? [['sticky', 'twangle', false]] : [['sticky', 'twangle', false], ['gel', 'dollop', false], ['slime_calm', CATALOG.find((d) => d.family === 'slimegoo').id, true]]) {
      const r = await xp.evaluate(([g, calm, shots, dt]) => window.__RV__.cutProbe({ genome: g, cuts: 10, calm, shots, dt }), [speciesBaseGenome(sp, 1), calm, name === 'sticky', DTc]);
      for (const [k, jpg] of Object.entries(r.shots)) writeFileSync(resolve(OUT, `cut_${name}_${k}.jpg`), b64(jpg));
      const w = ww(zz(r.lumas), DTc), w02 = ww(zz(r.lumas, 0.02), DTc), maxLight = Math.max(0, ...r.light);
      const lo = Math.min(...r.lumas), hi = Math.max(...r.lumas);
      RC.runs[name] = { transitions1s: w, transitions1s_at_0_02: w02, maxLight, luma: [lo, hi], cutsDone: r.cutsDone, reconnects: r.reconnects, maxPieces: r.maxPieces, maxGlow: r.maxGlow, maxStrands: r.maxStrands, maxBridges: r.maxBridges, strandEvents: r.strandEvents, snapEvents: r.snapEvents, piecesAtEnd: r.piecesAtEnd, facesAtEnd: r.facesAtEnd, framed: r.framed, marks: r.marks.join(' ') };
      check(w <= 3 && maxLight === 0 && r.cutsDone === 10 && r.maxPieces <= 6 && r.wholeAtEnd && r.facesAtEnd === 1 && r.maxBridges >= 2,
        `CUT X09 (${name}): 10 rapid cuts + Reconnect all: <= 3 luminance transitions in any 1 s, no screen flash, never more than 6 pieces, whole again with one face`,
        `worst 1 s window ${w} transitions (${w02} at 0.02), luma ${lo.toFixed(3)}..${hi.toFixed(3)}, screen light ${maxLight}, cuts ${r.cutsDone}, reconnects ${r.reconnects}, pieces <= ${r.maxPieces}, glow <= ${r.maxGlow.toFixed(2)}, strands <= ${r.maxStrands}, bridges <= ${r.maxBridges}`);
      // (the sticky strand is visible for >= 5 frames per cut at 30 fps: it parts, stretches to ~1.3 piece radii and snaps in a few tenths)
      check(r.snapEvents >= r.cutsDone && (name !== 'sticky' || r.strandEvents >= 5 * r.cutsDone),
        `CUT parting strand (${name}): one strand per cut, stretched then snapped once each; the shell's strand hook hears it`, `snaps ${r.snapEvents}, stretch frames ${r.strandEvents}, cuts ${r.cutsDone}`);
      check(r.framed.inFrame && r.framed.pieces === 6 && r.framed.minPx >= 40, `CUT (${name}): 6 pieces on the mat, all inside the 640x480 frame`, JSON.stringify({ pieces: r.framed.pieces, minPx: r.framed.minPx }));
    }
    // ---- 2b. the SAME with the REAL soft body and the shell's own call order (src/shell/cut.ts + bodies.ts): the face piece swaps in through setBody (bodies.swapTo),
    // the chunk through addBody({ chunk }), partPieces, the pieces collide, a Reconnect all = setFrac + setBridge + moveTo each frame, then a fresh whole body via setBody.
    // (the stub flow above removes and adds bodies instead: it never exercised setBody with a cut's seam and bridges in flight, nor a piece GROWING under the camera)
    {
      const slimeId = CATALOG.find((d) => d.family === 'slimegoo').id;
      for (const [name, sp, calm, shots] of QUICK ? [['sticky', 'twangle', false, true]] : [['sticky', 'twangle', false, true], ['gel', 'dollop', false, false], ['putty', 'thudge', false, false], ['slime_calm', slimeId, true, false]]) {
        const r = await xp.evaluate(([sp, calm, shots, dt]) => window.__RV__.realCutProbe({ species: sp, swipes: [0, 0, 0, 0, 0], autoSmall: 0.14, calm, dt, shots, gapS: 0.45 }), [sp, calm, shots, DTc]);
        if (r.skipped) { check(true, 'CUT real-body flow: skipped (the real soft body did not load; feature-detected)'); break; }
        for (const [k, jpg] of Object.entries(r.shots)) writeFileSync(resolve(OUT, `cutreal_${name}_${k}.jpg`), b64(jpg));
        const w = ww(zz(r.lumas), DTc), w02 = ww(zz(r.lumas, 0.02), DTc), lo = Math.min(...r.lumas), hi = Math.max(...r.lumas), maxLight = Math.max(0, ...r.light);
        RC.runs['real_' + name] = { family: r.family, transitions1s: w, transitions1s_at_0_02: w02, luma: [lo, hi], maxLight, cutsDone: r.cutsDone, refused: r.refused, maxPieces: r.maxPieces, maxStrands: r.maxStrands, maxBridges: r.maxBridges, maxGlow: r.maxGlow, strandEvents: r.strandEvents, snapEvents: r.snapEvents, seamCarry: r.seamCarry, minTopPx: r.minTopPx, minTopByPhase: r.minTopByPhase, framed: r.framed, viewsAtEnd: r.viewsAtEnd, facesAtEnd: r.facesAtEnd, marks: r.marks.join(' ') };
        check(w <= 3 && maxLight === 0 && r.cutsDone >= 5 && r.maxPieces <= 6 && r.viewsAtEnd === 1 && r.facesAtEnd === 1 && r.piecesAtEnd === 1 && r.maxBridges >= 1,
          `CUT X09 with the real body (${name}, ${r.family}): 5+ rapid cuts and a Reconnect all in the shell's own call order: <= 3 luminance transitions in any 1 s, no screen flash, <= 6 pieces, a bridge per join, whole again with ONE view and ONE face`,
          `worst 1 s window ${w} (${w02} at 0.02), luma ${lo.toFixed(3)}..${hi.toFixed(3)}, screen light ${maxLight}, cuts ${r.cutsDone} (refused ${r.refused}), pieces <= ${r.maxPieces}, glow <= ${r.maxGlow.toFixed(2)}, threads <= ${r.maxStrands}, bridges <= ${r.maxBridges}, views at end ${r.viewsAtEnd}`);
        // the cut's seam glow rides over the swap onto the new pieces (setBody must not wipe it: it used to clearBodies() the cut effects) and fades there
        check(r.seamCarry.length >= 5 && r.seamCarry.every((v) => v > 0.05), `CUT seam (${name}): the neck's seam glow is carried over the swap onto the new pieces at every cut (setBody keeps it)`, `seam strength on the new pieces right after each swap: ${r.seamCarry.map((v) => v.toFixed(2)).join(' ')}`);
        // the threads between the parting pieces: three for sticky / slime (two when calm), at most one wisp for gel; each snaps once (the shell's strand voice hears it)
        const tacky = r.family === 'stickystretch' || r.family === 'slimegoo';
        check(tacky ? r.maxStrands >= 2 && r.snapEvents >= r.cutsDone - 1 && r.strandEvents >= 5 : r.maxStrands <= 1,
          `CUT parting threads (${name}, ${r.family}): ${tacky ? 'several threads hang between the pieces (>= 2), each cut hangs a thread that stretches and snaps' : 'at most one wisp'}`, `threads <= ${r.maxStrands}, stretch frames ${r.strandEvents}, snaps ${r.snapEvents}`);
        // a piece that GROWS while the others flow into it (setFrac up) stays inside the frame (the framing follows its growth), and the 6 pieces are framed whole
        check(r.framed.inFrame && r.framed.pieces >= 5 && r.framed.minPx >= 30 && r.minTopPx >= -2, `CUT framing (${name}): the pieces (up to 6) are inside the 640x480 frame, and the face piece never leaves the top of it while it grows back to full size`, `pieces ${r.framed.pieces}, smallest ${r.framed.minPx.toFixed(0)} px, highest point while it grows ${r.minTopPx.toFixed(0)} px from the top (neck ${(r.minTopByPhase.neck ?? 0).toFixed(0)}, pieces ${(r.minTopByPhase.pieces ?? 0).toFixed(0)})`);
      }
    }
    report.problems.push(...xbad);
    await cctx.close();
    // ---- 3. 6 pieces framed on desktop and phone (stills of the whole sequence on desktop) ----
    for (const [label, vp, q] of [['desktop', { width: 1280, height: 800 }, 'med'], ['phone', { width: 390, height: 844 }, 'low']]) {
      if (QUICK && label === 'phone') continue;
      const dctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const { page: dp, bad: dbad } = await openView(dctx, `quality=${q}&body=${bodyQ}`, `cut-${label}`, [/GPU stall due to ReadPixels/i]);
      const r = await dp.evaluate(([g, dt]) => window.__RV__.cutProbe({ genome: g, cuts: 5, calm: false, shots: true, dt }), [speciesBaseGenome('twangle', 1), DTc]);
      for (const [k, jpg] of Object.entries(r.shots)) writeFileSync(resolve(OUT, `cut_${label}_${k}.jpg`), b64(jpg));
      RC.framing[label] = r.framed;
      check(r.framed.inFrame && r.framed.pieces === 6 && r.framed.minPx >= (label === 'phone' ? 30 : 60), `CUT ${label}: 6 pieces framed (all inside ${vp.width}x${vp.height}, the smallest >= ${label === 'phone' ? 30 : 60} px wide)`, JSON.stringify({ pieces: r.framed.pieces, minPx: r.framed.minPx, boxes: r.framed.boxes }));
      if (label === 'desktop') {
        const cost = await dp.evaluate((g) => window.__RV__.cutCost(g, 3), speciesBaseGenome('twangle', 1));
        const best = (a) => Math.min(...a);
        RC.cost = { ...cost, ratio: best(cost.sixPieces) / best(cost.twoWhole) };
        check(RC.cost.ratio <= 1.5, 'CUT frame budget (render): 6 pieces cost <= 1.5x two whole bodies (1280x800 med, best of 3)',
          `6 pieces ${best(cost.sixPieces).toFixed(0)} ms vs 2 whole ${best(cost.twoWhole).toFixed(0)} ms (x${RC.cost.ratio.toFixed(2)}), draw calls ${cost.drawCalls.six} vs ${cost.drawCalls.two}, triangles ${cost.triangles.six} vs ${cost.triangles.two}`);
      }
      report.problems.push(...dbad);
      await dctx.close();
    }
  }

  /* ───────────────────────── perf (relative cost only) ───────────────────────── */
  if (!NO_PERF && ON('perf')) {
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
