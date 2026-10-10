// LOCK, INTEGRATION leg (_spec/LOCK.md): the whole feature on the live game through REAL input in Chromium (SwiftShader), on the dev server.
//   node _harness/shellview/lock_gate.mjs [--port=5450] [--only=desktop,xp,phone] [--shots=DIR] [--code=<genome code of a star>]
// desktop (960x600, a real mouse and real keys, granulo = a five-point star):
//   * Shift too early does nothing; press + pull a tip to level >= 0.95 (the px it took are printed), tap Shift: locked, the mouse is free;
//   * the same on all five tips (a five-way stretch), the marker count, the sound calls (audio.ui on/off), the volume; a click on a locked lobe lets that one go;
//   * Esc lets the rest go; nothing is carried; every number is printed.
// xp (fresh profile): one lobe locked and held, released by Esc after a known time: the SP paid against 1.0 + 0.65 x min(held, 3).
// phone (390x844, CDP multi-touch): 1 finger lifts (control), 2, 3, 4 and 5 fingers on the star never pick it up; their pulls are on slots 0..n-1.
// overshoot: the Shift window between "fully stretched" (pull 0.95) and "picked up" (1.15 x maxPull) in px, slow / fast / short drags, and a fast drag on a second lobe after one lock (never lifts).
// ground: the GROUND FIX live: a lone pointer dragged straight down into the table on dollop, cushlet, chunkle, fossilo, twangle: the volume stays sane (no inside-out) and returns.
// The page is long: run it against a vite started with WH_FROZEN=1 (another lane saving a file reloads a dev page mid-run), quality is fixed to `med` (`--quality=`): the auto governor falls to `low` on a loaded
// software-GL box and `low` caps the locks at 4.
import { launch, startVite } from '../pw.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const PORT = Number(arg('port', '5450'));
const ONLY = new Set(arg('only', 'desktop,xp,phone,overshoot,ground').split(','));
const SHOTS = arg('shots', 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard/_handoff/reports/lock_gate');
const QUALITY = arg('quality', 'med');   // a fixed tier: the auto governor drops to 'low' on a loaded SwiftShader box and 'low' caps the locks at 4 (LOCK.md rule 4)
const CODE = arg('code', 'g1.AREAAwEAAABHAKUA0dl9W3aSY3FnSwBlhII');   // granulo, seed 1 (a five-point star)
mkdirSync(SHOTS, { recursive: true });
let bad = 0, total = 0;
const out = {};
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const note = (k, v) => { out[k] = v; console.log(`     ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };

const srv = await startVite(PORT);
const browser = await launch({ headless: true });
const problems = [];
const wire = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${tag} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
};
async function open(ctxOpts, tag, touch = false) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  wire(page, tag);
  page.setDefaultTimeout(120000);
  await page.goto(`${srv.url}?dev=1&quality=${QUALITY}&genome=${encodeURIComponent(CODE)}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
  const cta = await page.locator('.cta').boundingBox();
  if (touch) await page.touchscreen.tap(cta.x + cta.width / 2, cta.y + cta.height / 2); else await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await sleep(2500);
  await page.evaluate(() => { window.__liveLog = []; const el = document.getElementById('wh-live'); if (el) new MutationObserver(() => window.__liveLog.push(el.textContent || '')).observe(el, { childList: true, characterData: true, subtree: true }); });
  return { context, page };
}
const H = (page) => ({
  st: () => page.evaluate(() => { const s = window.__WH__.state(); const m = s.metrics; return { locked: m.locked ?? 0, pull: m.pull ?? 0, grabbed: m.grabbed, carried: !!m.carried, stretch: m.stretch, fingers: m.fingers, volume: m.volume, grounded: m.grounded }; }),
  live: () => page.evaluate(() => document.getElementById('wh-live')?.textContent ?? ''),
  liveHas: (re) => page.evaluate((src) => (window.__liveLog ?? []).some((t) => new RegExp(src).test(t)), re.source),   // every polite line said since liveReset (a trophy line can replace ours within a second)
  liveReset: () => page.evaluate(() => { window.__liveLog = []; }),
  body: async (vw, vh) => { const b = await page.evaluate(() => window.__WH__.bodyScreen()); return { x: b.x * vw, y: b.y * vh, r: b.rPx }; },
  fill: () => page.evaluate(() => window.__WH__.shell.meter().fill),
  events: (kind) => page.evaluate((k) => window.__WH__.state().events.filter((e) => e.kind === k), kind),
  ui: () => page.evaluate(() => { const s = window.__WH__.state().audio.started ?? {}; return { on: s['ui:on'] ?? 0, off: s['ui:off'] ?? 0, ui: s.ui ?? 0 }; }),
  spy: () => page.evaluate(() => { const s = window.__WH__.state().audio.started ?? {}; return { n: (s['ui:on'] ?? 0) + (s['ui:off'] ?? 0), on: s['ui:on'] ?? 0, off: s['ui:off'] ?? 0 }; }),   // the REAL engine's started-voice counters (the spy list has no ui)
  markers: () => page.evaluate(() => { const i = window.__WH__.shell.stageInfo(); return i ? (i.lockMarkers ?? i.locks ?? null) : null; }),
  stageInfo: () => page.evaluate(() => window.__WH__.shell.stageInfo()),
  frames: (n) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => { if (++i >= k) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n),
  until: async (fn, ms = 6000, arg) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await page.evaluate(fn, arg); if (v) return v; await sleep(80); } return v; },
});
const shot = async (page, name, clip) => { try { await page.screenshot({ path: `${SHOTS}/${name}.png`, clip, type: 'png' }); } catch (e) { console.log('shot failed', name, e.message); } };

// the five tips of the star on screen: directions (screen space, y down) from the body centre and the way each is dragged (the two low tips go sideways along the table: down is floored)
const TIPS = [
  { name: 'top', a: -90, dx: 0, dy: -1 },
  { name: 'upper-right', a: -18, dx: 0.95, dy: -0.31 },
  { name: 'lower-right', a: 54, dx: 1, dy: 0.08 },
  { name: 'lower-left', a: 126, dx: -1, dy: 0.08 },
  { name: 'upper-left', a: 198, dx: -0.95, dy: -0.31 },
];

try {
  // ───────────────────────────── desktop 960x600 ─────────────────────────────
  if (ONLY.has('desktop')) {
    console.log('\n== desktop 960x600, real mouse + real keys, granulo ==');
    const VW = 960, VH = 600;
    const { context, page } = await open({ viewport: { width: VW, height: VH } }, 'desktop');
    const h = H(page);
    await page.evaluate(() => window.__WH__.shell.spyStart());
    const clampXY = (x, y) => [Math.min(VW - 2, Math.max(2, x)), Math.min(VH - 2, Math.max(2, y))];

    /** press tip k (trying a few radii), drag along its direction until the pull level reaches 0.95 (or the limit); returns { ok, px, pull } with the mouse still DOWN */
    async function pullTip(tip, wantFull = true) {
      const b = await h.body(VW, VH);
      const ca = Math.cos((tip.a * Math.PI) / 180), sa = Math.sin((tip.a * Math.PI) / 180);
      let pressed = false, used = 0;
      for (const f of [0.85, 0.7, 0.55, 0.4]) {
        const [x0, y0] = clampXY(b.x + ca * b.r * f, b.y + sa * b.r * f);
        await page.mouse.move(x0, y0); await sleep(40);
        await page.mouse.down(); await sleep(140);
        if ((await h.st()).grabbed || (await h.st()).fingers > 0) { pressed = true; used = f; tip.x0 = x0; tip.y0 = y0; break; }
        await page.mouse.up(); await sleep(60);
      }
      if (!pressed) return { ok: false, px: 0, pull: 0, reason: 'no grab' };
      let px = 0, s = await h.st();
      const step = 18;
      while (s.pull < 0.95 && px < 700) {
        px += step;
        const [x, y] = clampXY(tip.x0 + tip.dx * px, tip.y0 + tip.dy * px);
        await page.mouse.move(x, y, { steps: 1 });
        await sleep(30);
        s = await h.st();
        if (px >= 200 && Math.abs(x - tip.x0) < 1 && Math.abs(y - tip.y0) < 1) break;   // clamped on the edge: no further
      }
      await sleep(250);
      s = await h.st();
      return { ok: s.pull >= 0.95, px, pull: s.pull, radius: used, reachedEdge: false };
    }

    // 1. Shift too early
    {
      const tip = TIPS[1];
      const b = await h.body(VW, VH);
      const [x0, y0] = [b.x + Math.cos((tip.a * Math.PI) / 180) * b.r * 0.7, b.y + Math.sin((tip.a * Math.PI) / 180) * b.r * 0.7];
      await page.mouse.move(x0, y0); await page.mouse.down(); await sleep(150);
      for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + tip.dx * i * 6, y0 + tip.dy * i * 6, { steps: 1 }); await sleep(30); }
      await sleep(200);
      const s0 = await h.st();
      const u0 = await h.spy();
      await page.keyboard.press('Shift'); await sleep(300);
      const s1 = await h.st();
      const u1 = await h.spy();
      check('Shift pressed too early (pull ' + s0.pull.toFixed(2) + ' < 0.95) does nothing: no lock, the pull goes on, no sound call', s0.grabbed && s0.pull < 0.9 && s1.locked === 0 && s1.grabbed && u1.n === u0.n && !/^Locked/.test(await h.live()), `pull ${s0.pull.toFixed(2)}, locked ${s1.locked}, grabbed ${s1.grabbed}, ui calls ${u0.n}->${u1.n}`);
      await page.mouse.up(); await sleep(2000);
    }

    // 2. lock the five tips one after another: a five-way stretch
    const rows = [];
    const volumes = [];
    let carriedEver = false;
    await h.frames(2);
    await shot(page, 'd0_rest', { x: 160, y: 40, width: 640, height: 480 });
    for (let k = 0; k < TIPS.length; k++) {
      const tip = TIPS[k];
      const before = await h.st();
      const uiBefore = await h.spy();
      const r = await pullTip(tip);
      const mid = await h.st();
      await page.keyboard.press('Shift');
      await h.until(() => (window.__WH__.state().metrics.locked ?? 0) > 0, 100);   // (the call is synchronous; this lets a frame pass)
      await sleep(350);
      const after = await h.st();
      const uiAfter = await h.spy();
      await page.mouse.up(); await sleep(500);
      const free = await h.st();
      if (free.carried || mid.carried || after.carried) carriedEver = true;
      volumes.push(+free.volume.toFixed(3));
      rows.push({ tip: tip.name, pressRadius: r.radius, pxToFull: r.px, pullAtShift: +mid.pull.toFixed(3), lockedBefore: before.locked, lockedAfter: free.locked, grabbedAfterShift: after.grabbed, uiOn: uiAfter.on - uiBefore.on, uiOff: uiAfter.off - uiBefore.off });
      if (!r.ok || free.locked !== before.locked + 1) { console.log(`   (tip ${tip.name}: full ${r.ok}, locked ${before.locked} -> ${free.locked}, reason ${r.reason ?? ''})`); }
      if (k === 0) { await h.frames(3); await shot(page, 'd1_one_locked', { x: 160, y: 40, width: 640, height: 480 }); }
    }
    note('lockRows', rows);
    const sFive = await h.st();
    check('five lobes locked, one after another, each fully stretched (pull level >= 0.95 at the Shift), locked = 5', rows.every((r) => r.pullAtShift >= 0.95) && sFive.locked === 5, `locked ${sFive.locked}; px to full per tip ${rows.map((r) => r.pxToFull).join('/')}`);
    check('each Shift freed the mouse (grabbed false straight after the Shift) and made ONE lock sound call', rows.every((r) => !r.grabbedAfterShift && r.uiOn === 1 && r.uiOff === 0), JSON.stringify(rows.map((r) => [r.grabbedAfterShift, r.uiOn])));
    check('the star was never picked up while locking (carried false all the way)', !carriedEver && !sFive.carried);
    await h.frames(4);
    const mk = await h.markers();
    const live5 = await h.live();
    note('five-way', { st: sFive, markers: mk, live: live5, volumes });
    check('the stage draws one marker per lock (5)', mk === 5, `markers ${mk}`);
    await sleep(1500);
    await shot(page, 'd2_five_locked', { x: 0, y: 0, width: VW, height: VH });
    const s5b = await h.st();
    check('1.5 s later all five are still locked, the star is finite and keeps its volume (0.8 .. 1.3 x)', s5b.locked === 5 && s5b.volume > 0.8 && s5b.volume < 1.3, `locked ${s5b.locked}, volume ${s5b.volume.toFixed(3)}, stretch ${s5b.stretch.toFixed(2)}`);

    // 3. a sixth press on the empty space does nothing; a click ON a locked lobe lets that one go
    await h.liveReset();
    const f0 = await h.fill();
    const ev0 = (await h.events('snap')).length;
    // the lower-right tip was locked 3rd: click along its pull line from the far end inward until one lock goes
    let hit = null;
    const lockedStart = (await h.st()).locked;
    {
      const tip = TIPS[2];
      for (let off = rows[2].pxToFull + 20; off >= 10 && !hit; off -= 14) {
        const [x, y] = clampXY(tip.x0 + tip.dx * off, tip.y0 + tip.dy * off);
        await page.mouse.move(x, y); await sleep(30);
        await page.mouse.down(); await sleep(110); await page.mouse.up(); await sleep(260);
        const s = await h.st();
        if (s.locked < lockedStart) hit = { off, locked: s.locked };
      }
    }
    const uiMid = await h.ui();
    note('clickRelease', { hit, uiStarted: uiMid, live: await h.live() });
    check('a click on a locked lobe lets that one go (locked n -> n-1), says "Let go."', hit && hit.locked === lockedStart - 1 && (await h.liveHas(/Let go./)), JSON.stringify(hit));
    await sleep(1800);
    const f1 = await h.fill();
    const snaps1 = await h.events('snap');
    note('afterClick', { fillGainSP30: +((f1 - f0) * 30).toFixed(3), snap: snaps1.at(-1) });

    // 4. Esc lets the rest go
    await h.frames(2);
    await shot(page, 'd3_four_locked', { x: 0, y: 0, width: VW, height: VH });
    await h.liveReset();
    const uiE0 = await h.spy();
    await page.keyboard.press('Escape'); await sleep(400);
    const sE = await h.st();
    const uiE1 = await h.spy();
    check('Esc lets the remaining four go at once (locked 0), says "Let go of all.", one off sound call, the Menu does not open', sE.locked === 0 && (await h.liveHas(/Let go of all/)) && uiE1.off === uiE0.off + 1 && uiE1.on === uiE0.on && !(await page.evaluate(() => !!document.querySelector('#wh-menu'))), `locked ${sE.locked}, live "${await h.live()}", ui on/off ${uiE0.on}/${uiE0.off} -> ${uiE1.on}/${uiE1.off}`);
    await sleep(4000);
    const f2 = await h.fill();
    const snaps2 = await h.events('snap');
    const sSet = await h.st();
    note('afterEsc', { fillGainSP30: +((f2 - f1) * 30).toFixed(3), totalSP30: +((f2 - 0) * 30).toFixed(3), snaps: snaps2.slice(-5).map((e) => ({ f: e.finger, i: +e.intensity.toFixed(2), held: +(e.heldFor ?? 0).toFixed(2) })) });
    check('the star settles after the release (stretch < 0.25, volume 0.85 .. 1.15, nothing held)', sSet.stretch < 0.25 && sSet.volume > 0.85 && sSet.volume < 1.15 && !sSet.grabbed && sSet.locked === 0, JSON.stringify(sSet));
    await shot(page, 'd4_settled', { x: 160, y: 40, width: 640, height: 480 });
    await context.close();
  }

  // ───────────────────────────── xp (fresh profile) ─────────────────────────────
  if (ONLY.has('xp')) {
    console.log('\n== hold XP: one lobe locked, held, released by Esc ==');
    const VW = 960, VH = 600;
    for (const waitS of [4.5, 1.2]) {   // SIM seconds held after the lock (the sim runs slower than the wall clock here: the page is paused and stepped, so the hold is exact)
      const { context, page } = await open({ viewport: { width: VW, height: VH } }, 'xp' + waitS);
      const h = H(page);
      const f0 = await h.fill();
      const tip = TIPS[1];
      const b = await h.body(VW, VH);
      const x0 = b.x + Math.cos((tip.a * Math.PI) / 180) * b.r * 0.75, y0 = b.y + Math.sin((tip.a * Math.PI) / 180) * b.r * 0.75;
      await page.mouse.move(x0, y0); await page.mouse.down(); await sleep(150);
      let px = 0, s = await h.st();
      while (s.pull < 0.97 && px < 700) { px += 18; await page.mouse.move(Math.min(VW - 2, x0 + tip.dx * px), Math.max(2, y0 + tip.dy * px), { steps: 1 }); await sleep(30); s = await h.st(); }
      await page.keyboard.press('Shift'); await sleep(300);
      await page.mouse.up();
      const lockedAt = await page.evaluate(() => window.__WH__.shell.xp().pending);
      // wait for the sim to have run `waitS` seconds since the Shift (the sim clock can lag the wall clock on this machine: poll the snap's heldFor after the release)
      await page.evaluate((n) => { const w = window.__WH__; w.pause(); w.step(1 / 20, n); w.resume(); }, Math.round(waitS * 20));
      await sleep(300);
      await page.keyboard.press('Escape');
      await sleep(900);
      const snaps = await h.events('snap');
      const snap = snaps.at(-1);
      await sleep(600);
      const f1 = await h.fill();
      const held = snap?.heldFor ?? 0;
      const expected = 1 + 0.65 * Math.min(held, 3);
      const sp = (f1 - f0) * 30;
      note(`xp_${waitS}s`, { snap: snap ? { i: +snap.intensity.toFixed(3), heldFor: +snap.heldFor.toFixed(3), finger: snap.finger } : null, spPaid: +sp.toFixed(3), expectedCap: +expected.toFixed(3), pendingWhileLocked: lockedAt });
      check(`hold XP, lobe held ${waitS} s after the lock: one snap (pull ${snap?.intensity?.toFixed(2)}, heldFor ${held.toFixed(2)} s) paid ${sp.toFixed(3)} SP against 1.0 + 0.65 x min(held, 3) = ${expected.toFixed(3)} (fresh meter)`, !!snap && snap.intensity >= 0.95 && Math.abs(sp - expected) < 0.08 && sp <= 2.95 + 0.08);
      await context.close();
    }
  }

  // ───────────────────────────── overshoot (a human drags PAST the limit) ─────────────────────────────
  // A lone hand that asks for more than 1.15 x maxPull picks the body UP (B3), and a carried body refuses the lock: the window for Shift is pull 0.95 .. 1.15 of the distance. A fast drag skips it.
  if (ONLY.has('overshoot')) {
    console.log('\n== overshoot: fast drags past the limit, then Shift (960x600, granulo upper-right tip) ==');
    const VW = 960, VH = 600;
    const { context, page } = await open({ viewport: { width: VW, height: VH } }, 'overshoot');
    const h = H(page);
    const tip = TIPS[1];
    const rowsO = [];
    /** a fresh body (setGenome), settled: on the table, still. A press that lands on nothing is retried (a reset body can still be arriving). */
    const freshBody = async () => {
      await page.evaluate((c) => window.__WH__.setGenome(c), CODE); await sleep(1500);
      await h.until(() => { const m = window.__WH__.state().metrics; return m.grounded && m.stretch < 0.05 && !m.carried; }, 15000);
      await sleep(500);
    };
    /** press tip t at 0.85 R (then smaller) with the real mouse until a grab registers; returns the press point, the mouse is DOWN */
    const pressTip = async (t) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const b = await h.body(VW, VH);
        const a = (t.a * Math.PI) / 180;
        const f = [0.85, 0.7, 0.85, 0.55][attempt % 4];
        const x0 = b.x + Math.cos(a) * b.r * f, y0 = b.y + Math.sin(a) * b.r * f;
        await page.mouse.move(x0, y0); await sleep(40); await page.mouse.down(); await sleep(200);
        { const st0 = await h.st(); if (st0.fingers > 0 || st0.grabbed) return { x0, y0 }; }   // (a press is a finger until the drag turns it into a pull: no grab yet)
        await page.mouse.up(); await sleep(700);
      }
      return null;
    };
    // (the window first: 6 px steps, the px at which the pull reaches 0.95 and the px at which the body is picked up)
    {
      const b = await h.body(VW, VH);
      const a = (tip.a * Math.PI) / 180;
      const x0 = b.x + Math.cos(a) * b.r * 0.85, y0 = b.y + Math.sin(a) * b.r * 0.85;
      await page.mouse.move(x0, y0); await sleep(40); await page.mouse.down(); await sleep(200);
      let full = null, lift = null, maxPullSeen = 0;
      for (let px = 6; px <= 600 && lift === null; px += 6) {
        await page.mouse.move(Math.min(VW - 2, x0 + tip.dx * px), Math.max(2, y0 + tip.dy * px), { steps: 1 }); await sleep(120);
        const s = await h.st(); maxPullSeen = Math.max(maxPullSeen, s.pull);
        if (full === null && s.pull >= 0.95) full = px;
        if (s.carried) lift = px;
      }
      await page.mouse.up(); await sleep(400);
      note('window', { pxToFull: full, pxToLift: lift, lockWindowPx: full !== null && lift !== null ? lift - full : null, bodyRadiusPx: Math.round(b.r) });
      await page.evaluate((c) => window.__WH__.setGenome(c), CODE); await sleep(2500);
    }
    for (const [label, stepPx, total, gapMs] of [['slow approach (18 px steps, stop at 0.95)', 18, 0, 30], ['fast drag 440 px (22 steps of 20 px, 16 ms)', 20, 440, 16], ['fast drag 300 px (15 steps of 20 px, 16 ms)', 20, 300, 16], ['medium drag 250 px (25 steps of 10 px, 25 ms)', 10, 250, 25], ['short drag 220 px (22 steps of 10 px, 25 ms)', 10, 220, 25]]) {
      await freshBody();
      const pr = await pressTip(tip);
      if (!pr) { rowsO.push({ label, px: 0, atShift: { pull: 0, carried: false, grabbed: false }, locked: 0, carriedAfter: false, pressFailed: true }); continue; }
      const { x0, y0 } = pr;
      let px = 0, s = await h.st(), flipAt = null;
      if (total === 0) { while (s.pull < 0.95 && px < 700) { px += stepPx; await page.mouse.move(Math.min(VW - 2, x0 + tip.dx * px), Math.max(2, y0 + tip.dy * px), { steps: 1 }); await sleep(gapMs); s = await h.st(); } }
      else { for (let i = 1; i * stepPx <= total; i++) { px = i * stepPx; await page.mouse.move(Math.min(VW - 2, x0 + tip.dx * px), Math.max(2, y0 + tip.dy * px), { steps: 1 }); await sleep(gapMs); } }
      await sleep(150);
      s = await h.st();
      const atShift = { pull: +s.pull.toFixed(3), carried: s.carried, grabbed: s.grabbed };
      await page.keyboard.press('Shift'); await sleep(300);
      const after = await h.st();
      rowsO.push({ label, px, atShift, locked: after.locked, carriedAfter: after.carried });
      await page.mouse.up(); await sleep(300);
      await page.keyboard.press('Escape'); await sleep(500);
    }
    // with ONE lock held the body has two hands: a fast drag far past the limit on a second lobe must NOT lift it, and Shift then locks that lobe too
    {
      await freshBody();
      const lockTip = async (t, stepPx, total, gapMs) => {
        const pr = await pressTip(t);
        if (!pr) return { atShift: { pull: 0, carried: false }, locked: -1, carriedAfter: false, pressFailed: true };
        const { x0, y0 } = pr;
        let px = 0, st = await h.st();
        if (total === 0) { while (st.pull < 0.95 && px < 700) { px += stepPx; await page.mouse.move(Math.min(VW - 2, x0 + t.dx * px), Math.max(2, y0 + t.dy * px), { steps: 1 }); await sleep(gapMs); st = await h.st(); } }
        else { for (let i = 1; i * stepPx <= total; i++) { px = i * stepPx; await page.mouse.move(Math.min(VW - 2, Math.max(2, x0 + t.dx * px)), Math.max(2, Math.min(VH - 2, y0 + t.dy * px)), { steps: 1 }); await sleep(gapMs); } }
        await sleep(150);
        const atShift = await h.st();
        await page.keyboard.press('Shift'); await sleep(300);
        const after = await h.st();
        await page.mouse.up(); await sleep(300);
        return { atShift: { pull: +atShift.pull.toFixed(3), carried: atShift.carried }, locked: after.locked, carriedAfter: after.carried };
      };
      const first = await lockTip(TIPS[1], 18, 0, 30);
      const second = await lockTip(TIPS[3], 20, 440, 16);
      note('overshootSecondLobe', { first, second });
      check('with one lock held, a FAST drag 440 px past the limit on a second lobe does not lift the body (two hands) and Shift locks it (locked 2)', first.locked === 1 && !second.atShift.carried && !second.carriedAfter && second.locked === 2, JSON.stringify({ first, second }));
      await page.keyboard.press('Escape'); await sleep(500);
    }
    note('overshoot', rowsO);
    for (const r of rowsO) check('overshoot row: ' + r.label + ' -> ' + (r.pressFailed ? 'THE PRESS NEVER GRABBED (row not run)' : r.locked === 1 ? 'LOCKED' : r.atShift.carried ? 'the body was picked up (carried), the Shift did nothing' : 'not locked (pull ' + r.atShift.pull + ')'), !r.pressFailed, JSON.stringify(r));
    await context.close();
  }

  // ───────────────────────────── ground (the GROUND FIX, live) ─────────────────────────────
  // A lone finger pressed on the top of the squishy and dragged straight DOWN past the pick-up line used to fold 5 of 12 species to about 180 degrees (twangle turned inside out).
  // The live game has no fold meter: the volume (1 = rest) is the inside-out detector (a flipped mesh reads far from 1), and the lowest-point readout is not exposed; so this row is a
  // live smoke test of the fix, not the physics proof (that is probe_lock.ts --only=ground).
  if (ONLY.has('ground')) {
    console.log('\n== ground: a lone pointer dragged straight down into the table (960x600) ==');
    const VW = 960, VH = 600;
    const { context, page } = await open({ viewport: { width: VW, height: VH } }, 'ground');
    const h = H(page);
    const species = { dollop: 'g1.AQAAAAEAAAAdAAkA0aDNz-NYxql-RACCgXo', cushlet: 'g1.AQkAAgEAAABMATUAHzopLU1MQGCvAACah4E', chunkle: 'g1.AQYAAAEAAAAAADkA3GFBp72pbFyEAABtgHs', fossilo: 'g1.AS4CAQEAAAAKACsAnRvpPOOXJWCxrsV8eXU', twangle: 'g1.AQIAAwEAAABQACgAjVk-hKlej89cAACIg5g' };
    for (const [name, code] of Object.entries(species)) {
      await page.evaluate((c) => window.__WH__.setGenome(c), code); await sleep(3000);
      const b = await h.body(VW, VH);
      // BELOW the centre: a drag down is then OUTWARD (gestures.ts outwardCos) = a pull; from the top it would be a rub. A press that lands on nothing is retried a little lower / higher.
      let x0 = b.x, y0 = b.y + b.r * 0.35;
      for (const f of [0.35, 0.5, 0.25, 0.6, 0.4]) {
        x0 = b.x; y0 = b.y + b.r * f;
        await page.mouse.move(x0, y0); await sleep(40); await page.mouse.down(); await sleep(250);
        if ((await h.st()).grabbed || (await h.st()).fingers > 0) break;
        await page.mouse.up(); await sleep(500);
      }
      let vmin = 9, vmax = 0, px = 0, carried = false, nan = false, grabbedEver = false, pullMax = 0;
      for (let i = 1; i <= 40; i++) {
        px = i * 14;
        await page.mouse.move(x0, Math.min(VH - 2, y0 + px), { steps: 1 }); await sleep(40);
        const s = await h.st();
        if (!Number.isFinite(s.volume)) nan = true;
        vmin = Math.min(vmin, s.volume); vmax = Math.max(vmax, s.volume); carried = carried || s.carried; grabbedEver = grabbedEver || s.grabbed; pullMax = Math.max(pullMax, s.pull);
      }
      await sleep(600);
      const s1 = await h.st();
      vmin = Math.min(vmin, s1.volume); vmax = Math.max(vmax, s1.volume);
      await page.mouse.up(); await sleep(3000);
      const s2 = await h.st();
      note('ground_' + name, { dragPx: px, vmin: +vmin.toFixed(3), vmax: +vmax.toFixed(3), carried, volumeAfter: +s2.volume.toFixed(3), stretchAfter: +s2.stretch.toFixed(2), grabbedEver, pullMax: +pullMax.toFixed(2), nan });
      check(`ground: ${name}: a lone pointer dragged ${px} px straight down from the lower front (a pull, outward from the centre): volume stays 0.6 .. 1.5 (no inside-out) and returns to 0.85 .. 1.15, no NaN`, grabbedEver && !nan && vmin >= 0.6 && vmax <= 1.5 && s2.volume > 0.85 && s2.volume < 1.15, `grab ${grabbedEver} (pull up to ${pullMax.toFixed(2)}), volume ${vmin.toFixed(2)} .. ${vmax.toFixed(2)}, after ${s2.volume.toFixed(3)}, carried ${carried}`);
    }
    await context.close();
  }

  // ───────────────────────────── phone 390x844 ─────────────────────────────
  if (ONLY.has('phone')) {
    console.log('\n== phone 390x844, CDP multi-touch, granulo ==');
    const VW = 390, VH = 844;
    const { context, page } = await open({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, 'phone', true);
    const h = H(page);
    const cdp = await context.newCDPSession(page);
    const phoneRows = [];
    async function fingers(n, label, dirs) {
      await sleep(1500);
      const bb = await h.body(VW, VH);
      const pts = TIPS.slice(0, n).map((t, k) => {
        const a = (t.a * Math.PI) / 180;
        const d = dirs ? dirs[k] : { dx: Math.cos(a), dy: Math.sin(a) };
        return { id: k + 1, x0: bb.x + Math.cos(a) * bb.r * 0.7, y0: bb.y + Math.sin(a) * bb.r * 0.7, dx: d.dx, dy: d.dy };
      });
      const pos = (p, f) => ({ id: p.id, x: Math.min(VW - 2, Math.max(2, p.x0 + p.dx * f)), y: Math.min(VH - 2, Math.max(2, p.y0 + p.dy * f)) });
      const touch = (type, f, only) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : pts.filter((p) => !only || only.includes(p.id)).map((p) => pos(p, f)) });
      await touch('touchStart', 0);
      await h.until((k) => window.__WH__.state().metrics.fingers >= k, 5000, n);
      await sleep(300);
      const fingersAtStart = (await h.st()).fingers;
      let carried = false, maxPull = 0, maxStretch = 0, locked = 0;
      let minGrounded = true;
      for (let i = 1; i <= 36; i++) {
        await touch('touchMove', (i * 150) / 36);
        await sleep(25);
        if (i % 4 === 0) { const s = await h.st(); carried = carried || s.carried; maxPull = Math.max(maxPull, s.pull); maxStretch = Math.max(maxStretch, s.stretch); locked = Math.max(locked, s.locked); minGrounded = minGrounded && s.grounded; }
      }
      await sleep(500);
      const sm = await h.st();
      const gev = await page.evaluate(() => window.__WH__.state().events.filter((e) => e.kind === 'grab').map((e) => e.finger));
      const lastGrabs = gev.slice(-n);
      carried = carried || sm.carried;
      if (n === 5) await shot(page, 'p5_five_fingers', { x: 0, y: 150, width: VW, height: 560 });
      if (n === 3) await shot(page, 'p3_three_fingers', { x: 0, y: 150, width: VW, height: 560 });
      await touch('touchEnd', 0);
      await sleep(2500);
      const sr = await h.st();
      phoneRows.push({ label, n, fingersAtStart, fingersDownAfter: sm.fingers, carried, grabbedSlots: lastGrabs.join(','), maxPull: +maxPull.toFixed(2), maxStretch: +maxStretch.toFixed(2), grounded: minGrounded, lockedMax: locked, afterRelease: { fingers: sr.fingers, carried: sr.carried, stretch: +sr.stretch.toFixed(2) } });
      return { sm, carried, lastGrabs, sr, fingersAtStart };
    }
    // control: ONE finger dragged hard up lifts the body (so the "never picked up" rows can fail)
    {
      const r = await fingers(1, 'control, one finger dragged up', [{ dx: 0, dy: -1.9 }]);
      note('oneFingerUp', { carried: r.carried, stretch: r.sm.stretch });
      check('control: ONE finger dragged 285 px up from the star picks the squishy up (carried true), so the "never picked up" rows below can fail', r.carried, `carried ${r.carried}`);
    }
    for (const n of [2, 3, 4, 5]) {
      // all fingers dragged UP hard (the worst case for a pick-up), 150 px extra beyond a lone pick-up threshold is not needed: use the outward star directions AND a second run upward
      const r = await fingers(n, `${n} fingers outward`, null);
      const sl = [...new Set(r.lastGrabs)].sort((a, b) => a - b).join(',');
      check(`${n} fingers on the star (outward): the physics sees ${n} fingers down at the touch, grab events on slots 0..${n - 1}, the star is never picked up (carried false throughout), settles after`, r.fingersAtStart === n && sl === [...Array(n).keys()].join(',') && !r.carried && r.sr.fingers === 0 && !r.sr.carried, JSON.stringify(phoneRows.at(-1)));
    }
    for (const n of [3, 5]) {
      const up = [...Array(n)].map(() => ({ dx: 0, dy: -1 }));
      const r = await fingers(n, `${n} fingers UP`, up);
      check(`${n} fingers all dragged UP (worst case for a lift): never picked up`, !r.carried && r.fingersAtStart === n && r.sr.fingers === 0, JSON.stringify(phoneRows.at(-1)));
    }
    note('phoneRows', phoneRows);
    await context.close();
  }

  const safe = problems.filter((p) => !/favicon|GPU stall|ReadPixels/.test(p));
  check('no console error or page error during all of it', safe.length === 0, safe.slice(0, 5).join(' | '));
} catch (e) {
  console.log('SCRIPT ERROR', e);
  bad++;
} finally {
  await browser.close();
  srv.stop();
}
writeFileSync(`${SHOTS}/lock_gate_numbers.json`, JSON.stringify(out, null, 1));
console.log(`\n${total - bad}/${total} lock gate checks passed`);
process.exit(bad ? 1 : 0);
