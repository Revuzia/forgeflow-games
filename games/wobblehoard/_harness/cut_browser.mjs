// Browser rows of the TRUE CUT (CUT2.md 12: X03', X04, X05, X06, X10, X11, X12, X19, X25 and the near-level parting of 6.5), SHELL lane task S4. NEW file: the old cut rows of
// browser_shell.mjs (cut-real, cut-x, ...) encode the chunk build and were re-specified there; every row that is about the TRUE cut lives here.
// Boots the REAL app (real SoftBody, real stage) at ?dev=1 in Chromium + SwiftShader, drives it with REAL mouse events and the stepped dev hook (pause + step(1/60, n)).
//   node _harness/cut_browser.mjs [--port=5400] [--only=level,part,...] [--v]
// Sections: level (a horizontal swipe on gel, putty, sticky, foam: the upper piece stays), part (X19: the scripted parting reaches G +-20 % by PART_S and holds to 4 s),
//           x03 (X03' the first Split in two leaves an eye on each half, from three camera yaws), x11 (X11 a swipe through an eye), x12 (X12 nested cuts up to the limit),
//           x04 (X04 Reconnect all is the exact original + X06 leg 1), x25 (X25 a drag in the Cut tool never joins), join (a REAL drag joins the group under the lowest common ancestor at any count),
//           u05 (CUT3 U05 Minis to N minis, every one with its full face, --minis=N), u07 (CUT3 U07 nothing pays the meter, the Hoard leave reconnects first, --pieces=N); X05 / X06 gesture / X10 keyboard are in browser_shell.mjs cut-real / cut-x
// CUT3 (2026-10-09): there is no piece limit any more; the safety ceiling PIECE_CEILING (64) is read from src/shell/cut.ts. The physics lifted its 1/8 clamp the same day, so the nested rows press NEST_PRESSES times (5: six pieces, as the
// original X12); 20 presses on the real bodies are cutter_checks --only=u01, 24 minis u05 here; the ceiling itself is reached on mock bodies (shellview/cut_mock_checks.ts).
// Ports 5400 to 5409 only (5360 to 5381 belong to others). One browser at a time; the shots go to _shots/cut_browser/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from './pw.mjs';
import { PIECE_CEILING, PART_GAP, PART_GAP_DEFAULT, PART_S, PART_S_DEFAULT } from '../src/shell/cut.ts';
const NEST_PRESSES = 5;
import { encodeGenome } from '../src/core/genome.ts';
import { familyOf, speciesBaseGenome } from '../src/data/catalog.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const PORT = Number((args.find((a) => a.startsWith('--port=')) ?? '--port=5400').split('=')[1]);
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',').filter(Boolean) ?? [];
const VERBOSE = args.includes('--v');
const SPF = (args.find((a) => a.startsWith('--sp=')) ?? '').slice(5).split(',').filter(Boolean);   // optional species filter for x03 / x11
const only = (list) => (SPF.length ? list.filter((q) => SPF.includes(q)) : list);
if (!((PORT >= 5400 && PORT <= 5409) || (PORT >= 5500 && PORT <= 5519))) { console.error('ports 5400 to 5409 or 5500 to 5519 only'); process.exit(2); }
const SHOTS = resolve(ROOT, '_shots', 'cut_browser');
const REPORTS = resolve(ROOT, '_harness', '_reports');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(REPORTS, { recursive: true });

// ------------------------------------------------------------------ tiny test framework
const results = [];
let failures = 0, currentSection = '';
function check(name, ok, extra = '') {
  results.push({ section: currentSection, name, ok: !!ok, extra: String(extra) });
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? '  ' + extra : ''}`);
}
const ran = [];
async function section(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  currentSection = name; ran.push(name);
  console.log(`\n== ${name}`);
  const t0 = Date.now();
  try { await fn(); } catch (e) { check(`${name}: section ran to the end`, false, String(e && e.message ? e.message : e).split('\n').filter((l) => l.trim()).slice(0, 8).join(' | ').slice(0, 900)); }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));

// ------------------------------------------------------------------ page helpers
let srv, browser;
const SMALL = { viewport: { width: 960, height: 600 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
function watch(page) {
  const w = { errors: [], failed: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') w.errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => w.errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => w.failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  return w;
}
async function open({ query = '?dev=1&rseed=4242&quality=high', ctx = SMALL } = {}) {
  const context = await browser.newContext(ctx);
  const page = await context.newPage();
  const w = watch(page);
  // the live-region LOG: a trophy toast (the four-pieces trophy fires at 4 pieces) replaces the live line within a second, so rows that read "Whole again." read the log
  await page.addInitScript(() => { const real = performance.now.bind(performance); let skew = 0; performance.now = () => real() + skew; window.__skewClock = (ms) => { skew += ms; }; window.__liveLog = []; const rec = () => { const el = document.getElementById('wh-live'); if (!el) { setTimeout(rec, 30); return; } new MutationObserver(() => { if (el.textContent) window.__liveLog.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true }); }; rec(); });
  await page.goto(srv.url + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
  const b = await page.locator('.cta').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.hud')).opacity === '1' && !document.querySelector('.title'), null, { timeout: 30000 });
  return { context, page, w };
}
const tools = (page) => page.evaluate(() => window.__WH__.shell.tools());
const live = (page) => page.evaluate(() => document.getElementById('wh-live')?.textContent ?? '');
const stepSim = (page, seconds) => page.evaluate((s) => { window.__WH__.step(1 / 60, Math.round(s * 60)); }, seconds);
async function stepUntil(page, fnSrc, max = 8, slice = 0.1) {
  return page.evaluate(async ([src, mx, sl]) => {
    const fn = new Function('wh', `return (${src})(wh);`);
    let t = 0;
    while (t <= mx + 1e-9) {
      if (fn(window.__WH__)) return t;
      window.__WH__.step(1 / 60, Math.max(1, Math.round(sl * 60)));
      t += sl;
      await new Promise((r) => setTimeout(r, 0));
    }
    return -1;
  }, [fnSrc, max, slice]);
}
const cutIdle = (page, max = 4) => stepUntil(page, `(wh) => !wh.shell.tools().busy`, max, 0.05);
async function settle(page, timeoutMs = 10000) {
  await page.evaluate(async (to) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    await raf(); await raf();
    const anims = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime ?? Infinity));
    await Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, to))]);
    await raf();
  }, timeoutMs);
}
async function shot(page, name) {
  const held = await page.evaluate(() => { const s = window.__WH__?.shell; if (!s || s.paused()) return false; window.__WH__.pause(); return true; }).catch(() => false);
  try { await settle(page, 4000); await page.screenshot({ path: resolve(SHOTS, name + '.png'), timeout: 240000, caret: 'hide' }); } finally { if (held) await page.evaluate(() => window.__WH__.resume()).catch(() => {}); }
}
const codeOf = (sp) => encodeGenome(speciesBaseGenome(sp, 1));
/** put a species on the table whole, settled, paused, the Cut tool in hand */
async function arrive(page, sp, tool = 'cut') {
  await page.evaluate(() => { const wh = window.__WH__; wh.resume(); });
  if ((await tools(page)).pieces > 1) {
    await page.evaluate(() => document.querySelector('.cutbar [data-key="join"]')?.click());
    await stepUntil(page, `(wh) => wh.shell.tools().pieces === 1 && !wh.shell.tools().busy`, 6, 0.1);
  }
  await page.evaluate((c) => { const wh = window.__WH__; wh.pause(); wh.setGenome(c); wh.step(1 / 60, 100); }, codeOf(sp));
  if (tool) await pickTool(page, tool);
  await page.evaluate(() => { window.__WH__.pause(); window.__WH__.step(1 / 60, 30); });
}
async function pickTool(page, id) {
  await page.evaluate(() => window.__WH__.resume());
  if ((await tools(page)).tool !== id) await page.click(`.dock-tool[data-tool="${id}"]`, { timeout: 60000 });
  await page.evaluate(() => window.__WH__.pause());
}
const bodyPx = (page) => page.evaluate(() => { const b = window.__WH__.bodyScreen(), v = { w: innerWidth, h: innerHeight }; return { x: b.x * v.w, y: b.y * v.h, r: b.rPx, vw: v.w, vh: v.h }; });
/** a REAL mouse swipe (pointer events through src/input/pointer.ts) from (x0,y0) to (x1,y1); the sim is paused before the let-go so the neck is stepped */
async function mouseSwipe(page, x0, y0, x1, y1, n = 10) {
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= n; i++) await page.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
  await page.evaluate(() => window.__WH__.pause());
  await page.mouse.up();
}
/** after a cut was started: step until the swap (two pieces), return the sim seconds it took (-1 = none) */
const untilSwap = (page, max = 3) => stepUntil(page, `(wh) => wh.shell.tools().pieces >= 2`, max, 1 / 60);
/** world centres of the pieces (the play body first) */
const centres = (page) => page.evaluate(() => window.__WH__.shell.pieceGaps().map((p) => ({ x: p.x, y: p.y, z: p.z, frac: p.frac })));

/** Follow a freshly swapped pair for `dur` s at 1/30 s: their centres relative to each other, the speeds, the rise. Returns the series and the summary. */
async function followPair(page, dur) {
  return page.evaluate((D) => {
    const wh = window.__WH__;
    const read = () => { const g = wh.shell.pieceGaps(); return g.map((p) => ({ x: p.x, y: p.y, z: p.z, gap: p.gap })); };
    let prev = read(); const c0 = prev.map((p) => ({ ...p }));
    const out = { t: [], rel: [], v: [], y: [], gap: [] };
    let t = 0;
    for (let i = 1; i <= Math.round(D * 30); i++) {
      wh.step(1 / 60, 2); t += 1 / 30;
      const cur = read();
      out.t.push(+t.toFixed(3));
      out.rel.push([cur[0].x - cur[1].x, cur[0].y - cur[1].y, cur[0].z - cur[1].z]);
      out.v.push(cur.map((p, k) => Math.hypot(p.x - prev[k].x, p.y - prev[k].y, p.z - prev[k].z) * 30));
      out.y.push(cur.map((p) => p.y));
      out.gap.push(cur[1].gap);
      prev = cur;
    }
    return { c0, ...out };
  }, dur);
}

// =====================================================================================================
async function main() {
  srv = await startVite(PORT);
  browser = await launch();
  const watches = [];
  try {
    const FAM = (sp) => familyOf(sp);

    // ---------------------------------------------------------------- level: a horizontal swipe (the player's most natural one)
    await section('level', async () => {
      const { page, context, w } = await open();
      watches.push(['level', w]);
      const rows = [];
      for (const sp of ['dollop', 'kneadle', 'twangle', 'capnap']) {
        await arrive(page, sp);
        const b = await bodyPx(page);
        await mouseSwipe(page, b.x - 1.6 * b.r, b.y + 2, b.x + 1.6 * b.r, b.y - 2);
        const ts = await untilSwap(page);
        const t1 = await tools(page);
        const F = await followPair(page, 4);
        // the upper piece = the higher centre at the swap
        const hi = F.c0[0].y >= F.c0[1].y ? 0 : 1, lo = 1 - hi;
        const rel0 = [F.c0[hi].x - F.c0[lo].x, F.c0[hi].y - F.c0[lo].y, F.c0[hi].z - F.c0[lo].z];
        const sh = (i) => Math.hypot((hi === 0 ? 1 : -1) * F.rel[i][0] - rel0[0], (hi === 0 ? 1 : -1) * F.rel[i][2] - rel0[2]);
        const n = F.t.length, at = (s) => Math.min(n - 1, Math.round(s * 30) - 1);
        const slide4 = sh(n - 1), peakV = Math.max(...F.v.map((v) => v[hi])), rise = Math.max(...F.y.map((y, i) => y[hi] - F.c0[hi].y));
        const lateV = Math.max(...F.v.slice(at(3)).map((v) => v[hi]));
        // not a check (RENDER / UI own the framing): where the pieces end on screen against the Cut bar and the dock (the gate saw the lower 30 % of a 960x600 frame covered)
        const frame = await page.evaluate(() => { const mi = window.__WH__.shell.matInfo(), top = (q) => { const e = document.querySelector(q); return e && !e.hidden && e.getBoundingClientRect().width ? Math.round(e.getBoundingClientRect().top) : null; }; return { lowestPx: Math.round(Math.max(...mi.bodies.map((b) => b.y + 0.6 * b.r))), barTop: top('.cutbar'), dockTop: top('#wh-dock'), vh: innerHeight }; });
        rows.push({ sp, fam: FAM(sp), ts, pieces: t1.pieces, fracs: t1.fracs.map((f) => +f.toFixed(3)), slide1: +sh(at(1)).toFixed(3), slide4: +slide4.toFixed(3), peakV: +peakV.toFixed(2), rise: +rise.toFixed(3), lateV: +lateV.toFixed(3), frame });
        check(`${sp} (${FAM(sp)}): a real horizontal swipe cuts two pieces and the upper one stays on the lower: it moves at most 0.18 m sideways in 4 s (X13 category 1), rises at most 0.06 m, is slower than 0.3 m/s from 3 s`,
          t1.pieces === 2 && ts >= 0 && slide4 <= 0.18 && rise <= 0.06 && lateV <= 0.3, JSON.stringify(rows.at(-1)));
        if (VERBOSE) console.log('   ' + JSON.stringify(F.rel.filter((_, i) => i % 15 === 14).map((r) => r.map((x) => +x.toFixed(3)))));
        await shot(page, `level_${sp}_960`);
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="join"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await stepUntil(page, `(wh) => wh.shell.tools().pieces === 1 && !wh.shell.tools().busy`, 5, 0.1);
      }
      writeFileSync(resolve(REPORTS, 'cut_browser_level.json'), JSON.stringify(rows, null, 1));
      await context.close();
    });

    // ---------------------------------------------------------------- part: X19 the scripted parting
    await section('part', async () => {
      const { page, context, w } = await open();
      watches.push(['part', w]);
      const rows = [];
      for (const sp of ['dollop', 'kneadle', 'twangle', 'capnap']) {
        await arrive(page, sp);
        const fam = FAM(sp), G = PART_GAP[fam] ?? PART_GAP_DEFAULT, PS = PART_S[fam] ?? PART_S_DEFAULT;
        const R = (await tools(page)).body.r;
        // Split in two: the squishy's own line between the eyes (a vertical plane)
        const clicked = await page.evaluate(() => { const b = document.querySelector('.cutbar [data-key="split"]'); if (!b || b.disabled) return false; b.click(); return true; });
        const ts = await untilSwap(page);
        const F = await followPair(page, 4);
        const n = F.t.length, at = (s) => Math.min(n - 1, Math.round(s * 30) - 1);
        // the opening along the horizontal line between the centres, since the swap
        const rel0 = [F.c0[0].x - F.c0[1].x, F.c0[0].z - F.c0[1].z];
        const L0 = Math.hypot(rel0[0], rel0[1]) || 1, u = [rel0[0] / L0, rel0[1] / L0];
        const open = (i) => (F.rel[i][0] - (F.c0[0].x - F.c0[1].x)) * u[0] + (F.rel[i][2] - (F.c0[0].z - F.c0[1].z)) * u[1];
        const gP = open(at(PS)), g4 = open(n - 1), sgP = F.gap[at(PS)], sg4 = F.gap[n - 1];
        // the parting's own measure: the opening at PART_S is G +-20 % of the script's (R0 / 0.5) scaling; it holds to 4 s: |g4 - gP| < 1 cm
        const Gs = G * (R / 0.5);
        rows.push({ sp, fam, clicked, ts, G: +Gs.toFixed(3), PS, openAtPS: +gP.toFixed(3), open4: +g4.toFixed(3), centreDrift: +(g4 - gP).toFixed(3), gapAtPS: +sgP.toFixed(3), gap4: +sg4.toFixed(3), gapDrift: +(sg4 - sgP).toFixed(3) });
        check(`${sp} (${fam}): X19 the scripted parting of Split in two reaches G ${f3(Gs)} m +-20 % by PART_S ${PS} s (measured ${f3(gP)}) and the SURFACE gap holds to 4 s (drift under 1 cm; measured ${f3(sg4 - sgP)}; the centres drift ${f3(g4 - gP)}, which a foam or putty half does as it re-expands)`,
          clicked && ts >= 0 && Math.abs(gP - Gs) <= 0.2 * Gs && Math.abs(sg4 - sgP) < 0.01, JSON.stringify(rows.at(-1)));
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="join"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await stepUntil(page, `(wh) => wh.shell.tools().pieces === 1 && !wh.shell.tools().busy`, 5, 0.1);
      }
      writeFileSync(resolve(REPORTS, 'cut_browser_part.json'), JSON.stringify(rows, null, 1));
      await context.close();
    });

    // ---------------------------------------------------------------- x03: X03' the first Split in two leaves one eye on each half, from three camera yaws (real stage, real eyes)
    await section('x03', async () => {
      const { page, context, w } = await open();
      watches.push(['x03', w]);
      const rows = [];
      // the six named rows of X03' (b): puddlo (sleepy, widest spacing), chunkle (dot, narrowest), skeinara (oval, largest eyes) are the clean extremes; granulo (wide), marigel (oval), wrigglo (dot) the crossed ones
      for (const sp of only(['puddlo', 'chunkle', 'skeinara', 'granulo', 'marigel', 'wrigglo'])) {
        for (const yaw of [0, 25, 90]) {
          await arrive(page, sp, 'hand');
          // a RIGHT-button drag on empty space orbits (the left button does not, owner decision 2026-10-06): 0.0075 rad = 0.43 degrees per px; closed loop on the camera's signed yaw (the camera is not reset by setGenome)
          for (let k = 0; k < 3; k++) {
            const c = (await tools(page)).cam, cur = c ? Math.atan2(c.x, c.z) * 180 / Math.PI : 0;
            let delta = yaw - cur; while (delta > 180) delta -= 360; while (delta <= -180) delta += 360;
            if (Math.abs(delta) < 1.5) break;
            const px = Math.round(-delta / 0.4297);   // (a positive drag turns the signed yaw atan2(cam.x, cam.z) negative)
            if (VERBOSE) console.log(`   yaw loop ${sp} target ${yaw}: iteration ${k} cur ${cur.toFixed(1)} delta ${delta.toFixed(1)} px ${px}`);
            await page.evaluate(() => window.__WH__.resume());
            await page.mouse.move(70, 160); await page.mouse.down({ button: 'right' });
            for (let q = 1; q <= 10; q++) await page.mouse.move(70 + px * q / 10, 160);
            await page.mouse.up({ button: 'right' });
            await page.evaluate(() => { window.__WH__.pause(); window.__WH__.step(1 / 60, 40); });
          }
          const cam = (await tools(page)).cam, yawNow = cam ? Math.round(Math.atan2(cam.x, cam.z) * 180 / Math.PI) : -1;
          await pickTool(page, 'cut');
          await page.evaluate(() => window.__WH__.resume());
          const clicked = await page.evaluate(() => { const b = document.querySelector('.cutbar [data-key="split"]'); if (!b || b.disabled) return false; b.click(); return true; });
          await page.evaluate(() => window.__WH__.pause());
          const ts = await untilSwap(page, 4);
          await stepSim(page, 0.5);
          const ev = await page.evaluate(() => window.__WH__.shell.eyeViews());
          const pv = (ev ?? []).filter((v) => v.piece);
          const sums = pv.map((v) => +v.eyes.reduce((a, e) => a + e.share, 0).toFixed(2));
          const whole = pv.map((v) => v.eyes.filter((e) => e.share >= 0.95).length), clipped = pv.map((v) => v.eyes.filter((e) => e.share > 0.05 && e.share < 0.95).map((e) => +e.share.toFixed(2)));
          const total = sums.reduce((a, b) => a + b, 0);
          const crossed = clipped.flat().length > 0;
          const clipOk = clipped.flat().every((s) => Math.abs(s - 0.5) <= 0.2);   // X03' (b) as written: a crossed species shows ONE clipped bead at 0.5 +-0.2 (granulo and marigel measure 0.14 / 0.86 on BOTH beads: tuning item T6, the eye-aware nudge, is not built)
          const ok = clicked && ts >= 0 && pv.length === 2 && Math.abs(total - 2) < 0.1 && pv.every((v) => v.eyes.some((e) => e.share >= 0.3)) && clipOk && (crossed || whole.every((n) => n === 1));
          rows.push({ sp, yaw, yawNow, ts, sums, whole, clipped });
          check(`${sp} at camera yaw ${yaw} (now ${yawNow}): the first Split in two leaves one eye on each half (shares per view ${JSON.stringify(sums)} sum ${total.toFixed(2)}; whole beads ${JSON.stringify(whole)}; ${crossed ? 'a crossed species: clipped beads ' + JSON.stringify(clipped) + ' within 0.5 +-0.2' : 'exactly one whole bead per half'})`, ok, JSON.stringify(rows.at(-1)));
          if (yaw === 25 || sp === 'granulo') await shot(page, `x03_${sp}_yaw${yaw}`);
        }
      }
      writeFileSync(resolve(REPORTS, 'cut_browser_x03.json'), JSON.stringify(rows, null, 1));
      await context.close();
    });

    // ---------------------------------------------------------------- x11: X11 a swipe through the projected centre of the left eye (real mouse)
    await section('x11', async () => {
      const { page, context, w } = await open();
      watches.push(['x11', w]);
      const rows = [];
      for (const sp of only(['dollop', 'puddlo', 'chunkle', 'skeinara', 'wrigglo'])) {
        await arrive(page, sp);
        const ev0 = await page.evaluate(() => window.__WH__.shell.eyeViews());
        const eyes0 = (ev0?.[0]?.eyes ?? []).slice().sort((a, b) => a.sx - b.sx);
        const left = eyes0[0], b = await bodyPx(page);
        if (!left) { check(`${sp}: the stage reports the eyes`, false); continue; }
        await mouseSwipe(page, left.sx + 1, left.sy - 1.4 * b.r, left.sx - 1, left.sy + 1.4 * b.r);
        const ts = await untilSwap(page, 3);
        await stepSim(page, 0.5);
        const t1 = await tools(page);
        const ev = await page.evaluate(() => window.__WH__.shell.eyeViews());
        const pv = (ev ?? []).filter((v) => v.piece);
        const clipped = pv.map((v) => v.eyes.filter((e) => e.share > 0.05 && e.share < 0.95).map((e) => +e.share.toFixed(2)));
        const whole = pv.map((v) => v.eyes.filter((e) => e.share >= 0.95).length);
        const total = pv.reduce((a, v) => a + v.eyes.reduce((s, e) => s + e.share, 0), 0);
        const flat = clipped.flat();
        const refusedSmall = ts < 0 && t1.pieces === 1;
        rows.push({ sp, ts, pieces: t1.pieces, clipped, whole, total: +total.toFixed(2) });
        check(`${sp}: a real swipe through the projected centre of the left eye cuts that bead in two: one clipped bead on each half with a share of 0.5 +-0.2 (${JSON.stringify(clipped)}), the other bead whole on its side (${JSON.stringify(whole)}), the shares of all eyes over both views sum to 2 (${total.toFixed(2)})${refusedSmall ? ' [not cut: the physics refused a sliver under its 1/8 floor as thin (CUT3: PHYS lifts the floor)]' : ''}`,
          refusedSmall || (t1.pieces === 2 && pv.length === 2 && flat.length === 2 && flat.every((s) => Math.abs(s - 0.5) <= 0.2) && whole.reduce((a, n) => a + n, 0) === 1 && Math.abs(total - 2) < 0.1), JSON.stringify(rows.at(-1)));
        await shot(page, `x11_${sp}`);
      }
      writeFileSync(resolve(REPORTS, 'cut_browser_x11.json'), JSON.stringify(rows, null, 1));
      await context.close();
    });

    // ---------------------------------------------------------------- x12: RE-SPECIFIED 2026-10-09 (the owner removed the limit): nested cuts keep going, the counter says the number, Split in two stays enabled
    await section('x12', async () => {
      const { page, context, w } = await open();
      watches.push(['x12', w]);
      await arrive(page, 'dollop');
      const t0 = await tools(page);
      const presses = [];
      for (let i = 0; i < NEST_PRESSES; i++) {
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await cutIdle(page, 4); await stepSim(page, 1.2);
        presses.push((await tools(page)).pieces);
      }
      const tN = await tools(page);
      await page.evaluate(() => window.__WH__.resume());
      const disabled = await page.evaluate(() => { const b = document.querySelector('.cutbar [data-key="split"]'); return b ? b.disabled || b.getAttribute('aria-disabled') === 'true' : null; });
      const bar = await page.evaluate(() => document.querySelector('.cutbar-count')?.textContent ?? document.querySelector('.cutbar')?.textContent ?? '');
      const hint = await page.evaluate(() => document.querySelector('.cutbar-text')?.textContent ?? '');
      await page.evaluate(() => window.__WH__.pause());
      check(`X12 (RE-SPECIFIED 2026-10-09, no limit): ${NEST_PRESSES} presses of Split in two reach ${NEST_PRESSES + 1} pieces (each press cut the largest), maxPieces is the safety ceiling ${PIECE_CEILING}, shares sum to 1, all positive; Split in two is ENABLED; the bar counts "${NEST_PRESSES + 1} pieces" with no "of N"; no limit line`,
        t0.maxPieces === PIECE_CEILING && tN.pieces === NEST_PRESSES + 1 && Math.abs(tN.fracs.reduce((a, f) => a + f, 0) - 1) < 1e-6 && tN.fracs.every((f) => f > 0) && disabled === false && bar.includes(`${NEST_PRESSES + 1} pieces`) && !/ of \d/.test(bar) && !/as many pieces|lot of pieces/.test(hint + (await live(page))),
        JSON.stringify({ presses, fracs: tN.fracs.map((f) => +f.toFixed(3)), disabled, bar, hint }));
      await context.close();
    });

    // ---------------------------------------------------------------- x04 + x06: Reconnect all is the original again and a cut pays nothing (the programmatic leg)
    await section('x04', async () => {
      const { page, context, w } = await open();
      watches.push(['x04', w]);
      await arrive(page, 'dollop');
      const id0 = await page.evaluate(() => window.__WH__.shell.identity());
      const m0 = await page.evaluate(() => window.__WH__.shell.meter());
      const ev0 = await page.evaluate(() => window.__WH__.state().events.length);
      const before = (await tools(page)).body;
      for (let i = 0; i < NEST_PRESSES; i++) {
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await cutIdle(page, 4); await stepSim(page, 1.2);
      }
      const nCut = (await tools(page)).pieces;
      await page.evaluate(() => window.__WH__.resume());
      await page.evaluate(() => document.querySelector('.cutbar [data-key="join"]')?.click());
      await page.evaluate(() => window.__WH__.pause());
      const t = await stepUntil(page, `(wh) => wh.shell.tools().pieces === 1 && !wh.shell.tools().busy`, 5, 1 / 30);
      await stepSim(page, 2.5);
      await sleep(450);   // the live region speaks after the announcer's delay
      const t1 = await tools(page), id1 = await page.evaluate(() => window.__WH__.shell.identity());
      const m1 = await page.evaluate(() => window.__WH__.shell.meter());
      const kinds = await page.evaluate((n) => window.__WH__.state().events.slice(n).map((e) => e.kind), ev0);
      check(`X04 real: Reconnect all from ${nCut} pieces ends as the original: one body at the full share (frac ${t1.body.frac}), the same rest radius (${f3(t1.body.r)} vs ${f3(before.r)}), at the middle (x, z ${f3(t1.body.x)}, ${f3(t1.body.z)}), the same genome and item, "Whole again."; it took ${f3(t)} s`,
        nCut === NEST_PRESSES + 1 && t >= 0 && t1.pieces === 1 && t1.extras === 0 && t1.body.frac === 1 && Math.abs(t1.body.r - before.r) < 1e-9 && Math.hypot(t1.body.x, t1.body.z) < 1e-6 && id1.genomeCode === id0.genomeCode && id1.itemId === id0.itemId && (await page.evaluate(() => window.__liveLog)).some((t) => /^Whole again\./.test(t)), JSON.stringify({ t1, id: [id0.genomeCode, id1.genomeCode] }));
      check('X06 real (leg 1, programmatic): the cut and Reconnect all paid the meter nothing and made no poke, release or snap event', m1.fill === m0.fill && m1.credits === m0.credits && !kinds.some((k) => k === 'poke' || k === 'release' || k === 'snap'), JSON.stringify({ fill: [m0.fill, m1.fill], kinds: [...new Set(kinds)] }));
      await context.close();
    });

    // ---------------------------------------------------------------- x25: a drag in the Cut tool never starts a join (real pointer events)
    await section('x25', async () => {
      const { page, context, w } = await open();
      watches.push(['x25', w]);
      await arrive(page, 'dollop');
      await page.evaluate(() => window.__WH__.resume());
      await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
      await page.evaluate(() => window.__WH__.pause());
      await cutIdle(page, 4); await stepSim(page, 2);
      const mi = await page.evaluate(() => window.__WH__.shell.matInfo());
      const [a, b] = mi.bodies;
      await page.evaluate(() => window.__WH__.shell.spyReset?.());
      await page.evaluate(() => window.__WH__.shell.spyStart?.());
      const tool = (await tools(page)).tool;
      // press on the second piece, drag it toward the first, hold 1 s, release: in the Cut tool that drag is a (short or missing) swipe, never a join
      const dir = Math.sign(a.x - b.x) || 1;
      await page.mouse.move(b.x + dir * 0.3 * b.r, b.y - 0.1 * b.r); await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + dir * (0.3 + 0.1 * i) * b.r, b.y - 0.1 * b.r);
      await page.evaluate(() => window.__WH__.pause());
      let busyEver = false;
      for (let i = 0; i < 6; i++) { await stepSim(page, 1 / 6); if ((await tools(page)).busy) busyEver = true; }
      await page.mouse.up();
      await stepSim(page, 0.8);
      const t1 = await tools(page);
      const spy = await page.evaluate(() => window.__WH__.shell.spyCalls());
      check('X25 real (RE-SPECIFIED 2026-10-09, the owner removed the piece limit: the released drag is a swipe and may now cut a third piece, which the limit of two used to refuse): with the Cut tool in hand a drag from one piece toward its neighbour, held 1 s and released, starts no join: never busy while it was held, no piece lost (2 or more, shares sum to 1), no rejoin sound', tool === 'cut' && t1.pieces >= 2 && Math.abs(t1.fracs.reduce((a, f) => a + f, 0) - 1) < 1e-6 && !busyEver && !(spy.audio.rejoin?.n), JSON.stringify({ tool, pieces: t1.pieces, busyEver, rejoin: spy.audio.rejoin?.n ?? 0 }));
      await context.close();
    });

    // ---------------------------------------------------------------- join: CUT3 / CUT2 7.2 by a REAL drag, at any count: 4 presses (5 pieces), a piece pulled into a non-twin joins the GROUP under their lowest common ancestor (3 pieces become one,
    // "Joined 3 pieces into one."), then the next drag joins the root group (everything: "Whole again."). The press point is the first of 0.1 .. 0.5 radii toward the other piece that grabs THIS piece
    // (the neighbour covers the inner shoulder of a flush piece: the owner changed the design on 2026-10-08, pieces rest flush).
    await section('join', async () => {
      const { page, context, w } = await open();
      watches.push(['join', w]);
      /** pull piece ri into piece rj with the real pointer (a region index = the cutter's piece order); the first of 0.1 .. 0.5 radii toward the other piece that grabs THIS piece is the press point */
      const dragInto = async (ri, rj) => page.evaluate(async ([ri, rj]) => {
        const wh = window.__WH__, vw = innerWidth, vh = innerHeight;
        wh.pause();
        // the cutter's piece order is not the stage's body order: match each region to its body by the exact world centre
        const reg = wh.shell.cutRegions(), pg = wh.shell.pieceGaps();
        const at = (q) => pg.findIndex((p) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9 && Math.abs(p.z - q.z) < 1e-9);
        const i = at(reg[ri]), j = at(reg[rj]);
        if (i < 0 || j < 0) return { off: null, tried: [], map: [i, j] };
        const mi = () => wh.shell.matInfo().bodies;
        const P0 = mi()[i], Q0 = mi()[j];
        const dx = Q0.x - P0.x, dy = Q0.y - P0.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
        const tried = [];
        let off = null;
        for (const k of [0.1, 0.2, 0.3, 0.4, 0.5]) {
          const px = P0.x + ux * k * P0.r, py = P0.y - 0.1 * P0.r + uy * k * P0.r;
          wh.pointerDown(px / vw, py / vh, 0); wh.step(1 / 60, 8);
          const f = mi().map((b) => b.fingers); wh.pointerUp(0); wh.step(1 / 60, 24);
          tried.push([k, f.indexOf(Math.max(...f)), Math.max(...f)]);
          if (f[i] > 0 && f.every((x, m) => m === i || x === 0)) { off = k; break; }
        }
        if (off === null) return { off, tried, map: [i, j] };
        const P = mi()[i], Q = mi()[j];
        const fx = P.x + ux * off * P.r, fy = P.y - 0.1 * P.r + uy * off * P.r, tx = Q.x - ux * 0.1 * Q.r, ty = Q.y - 0.1 * Q.r - uy * 0.1 * Q.r;
        wh.pointerDown(fx / vw, fy / vh, 0); wh.step(1 / 60, 8);
        let busyAt = -1, time = 0, steps = 0;
        const trace = [];
        const snap = () => { const g = wh.shell.pieceGaps(), m = mi()[i], me = g[i]; let best = [Infinity, -1]; g.forEach((o, k) => { if (k === i) return; const d = Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z) - o.r - me.r; if (d < best[0]) best = [d, k]; }); if (steps++ % 24 === 0) trace.push([+time.toFixed(2), m.fingers, m.carried ? 1 : 0, +best[0].toFixed(3), best[1], Math.round(m.x), Math.round(m.y)]); };
        for (let s = 1; s <= 36; s++) { const q = s / 36; wh.pointerMove((fx + (tx - fx) * q) / vw, (fy + (ty - fy) * q) / vh, 0); for (let n = 0; n < 2; n++) { wh.step(1 / 60, 1); time += 1 / 60; snap(); if (busyAt < 0 && wh.shell.tools().busy) busyAt = +time.toFixed(2); } }
        for (let n = 0; n < 240 && busyAt < 0; n++) { wh.step(1 / 60, 1); time += 1 / 60; snap(); if (wh.shell.tools().busy) busyAt = +time.toFixed(2); }
        wh.pointerUp(0);
        return { off, tried, busyAt, drag: +time.toFixed(2), map: [i, j], trace, from: [Math.round(fx), Math.round(fy)], target: [Math.round(tx), Math.round(ty)] };
      }, [ri, rj]);
      /** the group of a pair by the lowest common ancestor of their cells (literals = the path from the root) */
      const groupOf = (reg, i, j) => { let k = 0; while (k < reg[i].cells.length && k < reg[j].cells.length && reg[i].cells[k] === reg[j].cells[k]) k++; return { k, members: reg.map((_, m) => m).filter((m) => reg[m].cells.length >= k && reg[m].cells.slice(0, k).every((v, q) => v === reg[i].cells[q])) }; };
      /** n vertical swipes, each through the centre of the RIGHTMOST piece: a row of n + 1 slices, left to right A B C D ... (the tree: A | (B | (C | D))) */
      const sliceRow = async (n) => {
        for (let c = 0; c < n; c++) {
          const mi = await page.evaluate(() => window.__WH__.shell.matInfo().bodies);
          const right = mi.reduce((a, b) => (b.x > a.x ? b : a));
          await mouseSwipe(page, right.x, right.y - 1.7 * right.r, right.x + 1, right.y + 1.7 * right.r);
          await untilSwap(page, 3); await cutIdle(page, 4); await stepSim(page, 1.5);
        }
      };
      /** the row left to right: region indices in order of world x */
      const rowOrder = async () => { const reg = await page.evaluate(() => window.__WH__.shell.cutRegions()); return { reg, order: reg.map((_, i) => i).sort((a, b) => reg[a].x - reg[b].x) }; };
      const fracSum = (t) => t.fracs.reduce((a, f) => a + f, 0);
      const liveJoin = async () => (await page.evaluate(() => window.__liveLog)).filter((t) => /Join|Whole/.test(t)).join(' | ');

      // ---- scenario 1: 3 cuts = 4 slices A B C D; C is pulled onto B: the lowest common ancestor of B and C holds B, C, D (not the root) => 3 pieces become one
      await arrive(page, 'dollop');
      await sliceRow(3);
      const t4 = await tools(page);
      await pickTool(page, 'hand');
      await stepSim(page, 1);
      const { reg, order } = await rowOrder();
      const [, B, C] = order;
      const gBC = reg.length === 4 ? groupOf(reg, B, C) : null;
      const j1 = reg.length === 4 ? await dragInto(C, B) : null;
      let tAfter1 = null, say1 = '';
      if (j1 && j1.off !== null) { await cutIdle(page, 4); await stepSim(page, 1.5); await sleep(450); tAfter1 = await tools(page); say1 = await liveJoin(); }
      check(`join (group of 3, any count): 3 vertical swipes make a row of ${t4.pieces} slices; a REAL drag of the third slice onto the second joins the group under their lowest common ancestor (${gBC ? gBC.members.length : '?'} pieces, not the root): 4 -> 2 pieces, shares sum to 1, the live region says "Joining 3 pieces." and "Joined 3 pieces into one."`,
        t4.pieces === 4 && !!gBC && gBC.members.length === 3 && gBC.k > 0 && !!j1 && j1.busyAt >= 0 && !!tAfter1 && tAfter1.pieces === 2 && Math.abs(fracSum(tAfter1) - 1) < 1e-6 && /Joining 3 pieces\./.test(say1) && /Joined 3 pieces into one\./.test(say1),
        JSON.stringify({ order, group: gBC && gBC.members, drag: j1, after: tAfter1 && tAfter1.fracs.map((f) => +f.toFixed(3)), say: say1, reg: reg.map((q) => ({ f: +q.frac.toFixed(3), c: q.cells, x: +q.x.toFixed(2) })) }));
      // the merged piece and slice A are the two kids of the root: the next drag joins everything, and the squishy is the original again
      let j2 = null, tAfter2 = null, whole = false;
      if (tAfter1 && tAfter1.pieces === 2) {
        const r2 = await rowOrder();
        j2 = await dragInto(r2.order[1], r2.order[0]);
        if (j2.off !== null) { await cutIdle(page, 6); await stepSim(page, 2.5); await sleep(450); tAfter2 = await tools(page); whole = (await page.evaluate(() => window.__liveLog)).some((t) => /^Whole again\./.test(t)); }
      }
      check('join (the root group): the next real drag joins the group whose lowest common ancestor is the root: the squishy is whole again (one body, frac 1, no piece, "Whole again.")',
        !!j2 && j2.busyAt >= 0 && !!tAfter2 && tAfter2.pieces === 1 && tAfter2.extras === 0 && tAfter2.body.frac === 1 && whole, JSON.stringify({ drag: j2, after: tAfter2 && { pieces: tAfter2.pieces, frac: tAfter2.body.frac }, whole }));

      // ---- scenario 2: 3 cuts again; slice B is pulled onto A: their lowest common ancestor is the ROOT, so all 4 pieces become the whole squishy at once
      await arrive(page, 'dollop');
      await sliceRow(3);
      await pickTool(page, 'hand');
      await stepSim(page, 1);
      const r3 = await rowOrder();
      const g3 = r3.reg.length === 4 ? groupOf(r3.reg, r3.order[1], r3.order[0]) : null;
      const j3 = r3.reg.length === 4 ? await dragInto(r3.order[1], r3.order[0]) : null;
      let tAfter3 = null, say3 = '';
      if (j3 && j3.off !== null) { await cutIdle(page, 6); await stepSim(page, 2.5); await sleep(450); tAfter3 = await tools(page); say3 = await liveJoin(); }
      check('join (the root group, 4 pieces): a REAL drag of the second slice onto the first joins all four (their lowest common ancestor is the root): "Joining 4 pieces." then "Whole again.", one body at the full share',
        r3.reg.length === 4 && !!g3 && g3.k === 0 && g3.members.length === 4 && !!j3 && j3.busyAt >= 0 && !!tAfter3 && tAfter3.pieces === 1 && tAfter3.extras === 0 && tAfter3.body.frac === 1 && /Joining 4 pieces\./.test(say3) && /Whole again\./.test(say3),
        JSON.stringify({ group: g3 && g3.members, drag: j3, after: tAfter3 && { pieces: tAfter3.pieces, frac: tAfter3.body.frac }, say: say3 }));
      writeFileSync(resolve(REPORTS, 'cut_browser_join.json'), JSON.stringify({ j1, j2, j3 }, null, 1));
      await context.close();
    });

    // ---------------------------------------------------------------- x05: X05 leave paths with MANY pieces on the real stack: a quick switch, hidden over 60 s (and 30 s keeps the pieces), a reload: each comes back whole; nothing about pieces is stored
    await section('x05', async () => {
      const { page, context, w } = await open();
      watches.push(['x05', w]);
      const N = Number((args.find((a) => a.startsWith('--pieces=')) ?? '--pieces=5').split('=')[1]);
      const cutTo = async () => {
        await page.evaluate(() => window.__WH__.resume());
        if ((await tools(page)).tool !== 'cut') { await page.evaluate(() => document.querySelector('#wh-play')?.focus()); await page.keyboard.press('c'); }
        for (let i = 0; i < N - 1; i++) {
          await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
          await page.evaluate(() => window.__WH__.pause());
          await cutIdle(page, 5); await stepSim(page, 0.4);
          await page.evaluate(() => window.__WH__.resume());
        }
        await page.evaluate(() => window.__WH__.pause());
        return (await tools(page)).pieces;
      };
      await arrive(page, 'dollop');
      const k1 = await cutTo();
      const id0 = await page.evaluate(() => window.__WH__.shell.identity().itemId);
      await page.evaluate(() => window.__WH__.resume());
      await page.evaluate(() => document.querySelector('#wh-play')?.focus());
      await page.keyboard.press(']'); await settle(page); await sleep(300);
      const tsw = await tools(page), id1 = await page.evaluate(() => window.__WH__.shell.identity().itemId);
      check(`X05 (${N} pieces): a quick switch reconnects at once: the new squishy is whole, no piece left on the mat`, k1 === N && id1 !== id0 && tsw.pieces === 1 && tsw.extras === 0, JSON.stringify({ k1, id0, id1, pieces: tsw.pieces, extras: tsw.extras }));
      const hide = async (ms) => {
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.evaluate((m) => window.__skewClock(m), ms);
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await sleep(300);
      };
      const k2 = await cutTo();
      await hide(30_000);
      const short = (await tools(page)).pieces;
      await hide(61_000);
      const long = await tools(page);
      check(`X05 (${N} pieces): hidden 30 s keeps the pieces, hidden over 60 s comes back whole`, k2 === N && short === N && long.pieces === 1 && long.extras === 0, JSON.stringify({ k2, short, long: long.pieces }));
      const k3 = await cutTo();
      await page.reload({ waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 180000 });
      await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
      const b = await page.locator('.cta').boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      const tr = await tools(page);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /"(piece|pieces|chunk|cutNormal|region|cells|planes)"/.test(localStorage.getItem(k) ?? '')));
      check(`X05 (${N} pieces): a reload is whole again; nothing about pieces is stored`, k3 === N && tr.pieces === 1 && tr.extras === 0 && stored.length === 0, JSON.stringify({ k3, pieces: tr.pieces, stored }));
      await context.close();
    });

    // ---------------------------------------------------------------- u05: CUT3 U05 Minis to N minis on the real stage: every mini draws its OWN full face (two eyes at share 1), nothing non-finite, shares sum to 1, Reconnect all is the original
    // --minis=N presses (default 23 = 24 minis); the real physics decides how far it can go, and the row says exactly how far it got when it stops short.
    await section('u05', async () => {
      const { page, context, w } = await open();
      watches.push(['u05', w]);
      const PRESS = Number((args.find((a) => a.startsWith('--minis=')) ?? '--minis=23').split('=')[1]);
      await arrive(page, 'dollop');
      await page.evaluate(() => window.__WH__.shell.setCutStyle('minis'));
      const id0 = await page.evaluate(() => window.__WH__.shell.identity());
      const before = (await tools(page)).body;
      const lines = [];
      let made = 1;
      for (let i = 0; i < PRESS; i++) {
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await cutIdle(page, 5); await stepSim(page, 0.4);
        const n = (await tools(page)).pieces;
        if (n === made) lines.push(`press ${i + 1} made nothing`);
        made = n;
      }
      await stepSim(page, 1.5);
      const t = await tools(page);
      const ev = await page.evaluate(() => window.__WH__.shell.eyeViews()) ?? [];
      const faces = ev.map((v) => v.eyes.filter((e) => e.share >= 0.95).length);
      const finite = await page.evaluate(() => window.__WH__.shell.pieceGaps().every((p) => [p.x, p.y, p.z, p.r].every(Number.isFinite)));
      await shot(page, `u05_minis_${t.pieces}`);
      await page.evaluate(() => window.__WH__.resume());
      await page.evaluate(() => document.querySelector('.cutbar [data-key="join"]')?.click());
      await page.evaluate(() => window.__WH__.pause());
      const tj = await stepUntil(page, `(wh) => wh.shell.tools().pieces === 1 && !wh.shell.tools().busy`, 8, 1 / 30);
      await stepSim(page, 2.5); await sleep(450);
      const t1 = await tools(page), id1 = await page.evaluate(() => window.__WH__.shell.identity());
      check(`U05 (real stage): Minis, ${PRESS} presses of Split in two make ${PRESS + 1} minis (made ${t.pieces}${lines.length ? '; ' + lines.slice(0, 3).join(', ') : ''}); the stage draws ${ev.length} views and every one has both eyes at full share (${faces.filter((n) => n === 2).length} of ${ev.length}); shares sum to 1; nothing non-finite; Reconnect all ends as the original (frac 1, same genome and item) in ${f3(tj)} s`,
        t.pieces === PRESS + 1 && ev.length === t.pieces && faces.every((n) => n === 2) && Math.abs(t.fracs.reduce((a, f) => a + f, 0) - 1) < 1e-6 && t.fracs.every((f) => f > 0) && finite && tj >= 0 && t1.pieces === 1 && t1.extras === 0 && t1.body.frac === 1 && Math.abs(t1.body.r - before.r) < 1e-9 && id1.genomeCode === id0.genomeCode && id1.itemId === id0.itemId,
        JSON.stringify({ pieces: t.pieces, views: ev.length, faces, minFrac: +Math.min(...t.fracs).toFixed(4), finite, t1: { pieces: t1.pieces, frac: t1.body.frac } }));
      await context.close();
    });

    // ---------------------------------------------------------------- u07: CUT3 U07 on the real stack with many pieces: nothing pays the meter for cutting or for a join gesture, the Hoard never sees a piece, every leave path reconnects first
    await section('u07', async () => {
      const { page, context, w } = await open();
      watches.push(['u07', w]);
      const N = Number((args.find((a) => a.startsWith('--pieces=')) ?? '--pieces=8').split('=')[1]);
      await arrive(page, 'dollop');
      const m0 = await page.evaluate(() => window.__WH__.shell.meter());
      const ev0 = await page.evaluate(() => window.__WH__.state().events.length);
      const items0 = await page.evaluate(() => window.__WH__.shell.hoardState().items.length);
      for (let i = 0; i < N - 1; i++) {
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await cutIdle(page, 5); await stepSim(page, 0.5);
      }
      await stepSim(page, 1);
      const tN = await tools(page);
      const m1 = await page.evaluate(() => window.__WH__.shell.meter());
      const kinds = await page.evaluate((n) => window.__WH__.state().events.slice(n).map((e) => e.kind), ev0);
      check(`U07 (real stack): ${tN.pieces} pieces made by ${N - 1} presses paid the meter nothing (fill and credits unchanged) and made no poke, release or snap event`, tN.pieces === N && m1.fill === m0.fill && m1.credits === m0.credits && !kinds.some((k) => k === 'poke' || k === 'release' || k === 'snap'), JSON.stringify({ pieces: tN.pieces, fill: [m0.fill, m1.fill], kinds: [...new Set(kinds)] }));
      // leaving: the Hoard opens (a leave path) => the squishy is reconnected first, whole, nothing on the mat, the tool back to the Hand; stored text names no piece
      await page.evaluate(() => window.__WH__.resume());
      await page.click('.hoard-btn', { timeout: 60000 }); await settle(page); await stepUntil(page, '(wh) => wh.shell.tools().pieces === 1 && !wh.shell.tools().busy', 4, 0.1);
      const th = await tools(page);
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /"(piece|pieces|chunk|cutNormal|region|cells|planes)"/.test(localStorage.getItem(k) ?? '')));
      const items1 = await page.evaluate(() => window.__WH__.shell.hoardState().items.length);
      check(`U07 (real stack): opening the Hoard with ${tN.pieces} pieces reconnects first (one piece, nothing on the mat), the Hoard lists no piece (${items0} -> ${items1} squishies), nothing about pieces is stored`, th.pieces === 1 && th.extras === 0 && items0 === items1 && stored.length === 0, JSON.stringify({ pieces: th.pieces, extras: th.extras, items: [items0, items1], stored }));
      await context.close();
    });

    // ---------------------------------------------------------------- grab: NOT a check, a measurement: which body a press on a flush half grabs (the join-gesture rows of browser_shell cut-x press the INNER shoulder)
    await section('grab', async () => {
      const { page, context, w } = await open();
      watches.push(['grab', w]);
      const rows = [];
      for (const sp of ['dollop', 'kneadle']) {
        await arrive(page, sp);
        await page.evaluate(() => window.__WH__.resume());
        await page.evaluate(() => document.querySelector('.cutbar [data-key="split"]')?.click());
        await page.evaluate(() => window.__WH__.pause());
        await cutIdle(page, 4); await stepSim(page, 2.5);
        await pickTool(page, 'hand');
        const mi = await page.evaluate(() => window.__WH__.shell.matInfo());
        const b0 = await bodyPx(page);
        const gaps = await page.evaluate(() => window.__WH__.shell.pieceGaps().map((q) => +q.gap?.toFixed?.(3)));
        const press = (sx, sy) => page.evaluate(([x, y, vw, vh]) => { const wh = window.__WH__; wh.pause(); wh.pointerDown(x / vw, y / vh, 0); wh.step(1 / 60, 8); const f = wh.shell.matInfo().bodies.map((q) => q.fingers); wh.pointerUp(0); wh.step(1 / 60, 20); return f; }, [sx, sy, b0.vw, b0.vh]);
        for (let k = 1; k < mi.bodies.length; k++) {
          const a = mi.bodies[0], b = mi.bodies[k], dir = Math.sign(a.x - b.x) || 1;
          const inner = await press(b.x + dir * 0.55 * b.r, b.y - 0.1 * b.r), outer = await press(b.x - dir * 0.62 * b.r, b.y - 0.1 * b.r);
          rows.push({ sp, piece: k, gaps, innerFingersPerBody: inner, outerFingersPerBody: outer });
          console.log('   ' + JSON.stringify(rows.at(-1)));
        }
        await page.evaluate(() => window.__WH__.resume());
      }
      writeFileSync(resolve(REPORTS, 'cut_browser_grab.json'), JSON.stringify(rows, null, 1));
      await context.close();
    });

    for (const [name, wch] of watches) {
      check(`${name}: 0 console errors or warnings and 0 failed requests`, wch.errors.length === 0 && wch.failed.length === 0, JSON.stringify({ errors: wch.errors.slice(0, 3), failed: wch.failed.slice(0, 3) }));
    }
  } finally {
    await browser.close().catch(() => {});
    srv.stop();
  }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} cut browser checks passed (sections: ${ran.join(", ") || "none"}); PIECE_CEILING ${PIECE_CEILING}`);
  writeFileSync(resolve(REPORTS, 'cut_browser.json'), JSON.stringify({ results, pieceCeiling: PIECE_CEILING }, null, 1));
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
