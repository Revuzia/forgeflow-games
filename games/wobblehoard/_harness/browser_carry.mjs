// Round 14 (R14_CARRY; the owner 2026-11-23: "make it easier to pick up and move squishies around"): THE NEW-PLAYER CARRY CHECK, on 1280 x 800 (mouse) and
// 390 x 844 (touch), with three out, at Home and at the places named. REAL INPUT for every player action (Playwright's mouse; CDP touch points on the phone);
// the sim is stepped by the dev hook between the input events (the software rasteriser runs far under real time), so every row is the same on every run.
//
// "A new player" knows nothing of the gesture rules: they press the squishy roughly in its MIDDLE and drag toward where they want it, watching the squishy
// (once it is in the hand they steer so it hangs over the spot), hold still a moment and let go. A try that does not end with the squishy resting within
// ARRIVE m of the spot is tried again from where it lies, with the press a little off the middle (below, above, toward the spot): up to TRIES.
//   carry  front left -> back right: tries until it is there, what went wrong in each failed try.
//   three  all three squishies to three chosen spots (back left, back right, front right): the presses and the sim seconds it takes.
// Usage: WH_FROZEN=1 node _harness/browser_carry.mjs [--port=5364] [--places=home,ripple,frostbell] [--only=desk|phone] [--tag=before] [--three] [--trace]
//   -> rows on stdout, pictures in _harness/_renders/carry/<tag>_<frame>_<place>_*.png, JSON in _harness/_reports/browser_carry_<tag>.json
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PLACE_INFO } from '../src/data/places.ts';
import { PLACE as HOME } from '../src/data/place_home.ts';
import { PLACE as HEARTHLOG } from '../src/data/place_hearthlog.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import { PLACE as FROSTBELL } from '../src/data/place_frostbell.ts';
import { PLACE as RAINLEAF } from '../src/data/place_rainleaf.ts';
import { PLACE as LANTERNROOF } from '../src/data/place_lanternroof.ts';
import { PLACE as CLOUDLOFT } from '../src/data/place_cloudloft.ts';
import { HOME_R } from '../src/render/roomcam.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5364)), ONLY = arg('only', ''), TAG = arg('tag', 'c'), TRACE = process.argv.includes('--trace'), THREE = process.argv.includes('--three');
const TRIES = Number(arg('tries', 4)), ARRIVE = Number(arg('arrive', 0.8)), EXTRAS = process.argv.includes('--extras');
const DEFS = { home: HOME, hearthlog: HEARTHLOG, ripple: RIPPLE, frostbell: FROSTBELL, rainleaf: RAINLEAF, lanternroof: LANTERNROOF, cloudloft: CLOUDLOFT };
const PLACES = arg('places', 'home,ripple,frostbell').split(',').filter((p) => DEFS[p]);
const NAMES = Object.fromEntries(PLACE_INFO.map((p) => [p.id, p.name])), IDX = Object.fromEntries(PLACE_INFO.map((p) => [p.id, p.idx]));
const SHOTS = resolve(ROOT, '_harness/_renders/carry');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [], data = [];
let fails = 0;
const check = (name, ok, detail = '') => { rows.push({ name, ok: !!ok, detail }); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const r2 = (v) => Math.round(v * 100) / 100;
const FRAMES = [
  ['desk', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }],
].filter(([n]) => !ONLY || n === ONLY);

const init = () => {
  window.__liveLog = [];
  const rec = () => { const el = document.getElementById('wh-live'); if (!el) { setTimeout(rec, 30); return; } new MutationObserver(() => { if (el.textContent) window.__liveLog.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true }); };
  rec();
  try {
    const seed = JSON.parse(sessionStorage.getItem('roomseed') || 'null');
    if (seed) { const k = 'wobblehoard:v2:journal', j = JSON.parse(localStorage.getItem(k) || 'null'); if (j) { j.st = Math.max(j.st | 0, seed.st); j.pl = (j.pl | 0) | seed.pl; localStorage.setItem(k, JSON.stringify(j)); } sessionStorage.removeItem('roomseed'); }
  } catch (e) { console.info('seed: ' + e); }
};

const srv = await startVite(PORT);
const browser = await launch();
try {
  for (const [frame, ctxOpt] of FRAMES) {
    const touch = frame === 'phone', tall = touch;
    const ctx = await browser.newContext(ctxOpt);
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
    const W = ctxOpt.viewport.width, H = ctxOpt.viewport.height;
    let simFrames = 0;
    const step = async (s) => { simFrames += Math.round(s * 60); await page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s); };
    const frames = async (n) => { simFrames += n; await page.evaluate((k) => { window.__WH__.step(1 / 60, k); }, n); };
    const bodies = () => page.evaluate(() => window.__WH__.shell.matInfo().bodies.map((b, i) => ({ i, id: b.itemId, x: b.x, y: b.y, r: b.r, carried: b.carried, fingers: b.fingers, w: b.w })));
    const proj = (pts) => page.evaluate((ps) => ps.map(([x, y, z]) => window.__WH__.shell.project(x, y, z)), pts);
    const band = () => page.evaluate(() => { const t = document.querySelector('.hud-top')?.getBoundingClientRect(), b = document.querySelector('.hud-bottom')?.getBoundingClientRect(); return { top: t && t.height > 0 ? t.bottom : 0, bottom: b && b.height > 0 ? b.top : innerHeight }; });
    const shot = async (n) => { await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; }); await page.evaluate(async () => { const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); }); await page.screenshot({ path: resolve(SHOTS, `${TAG}_${frame}_${n}.png`), timeout: 180000 }); };
    const boxOf = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && !e.disabled ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
    const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const clickSel = async (sel) => { const b = await boxOf(sel); if (!b) return false; await tapAt(b.x, b.y); await sleep(350); return true; };
    const tp = (pts) => pts.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id: id + 1, radiusX: 8, radiusY: 8, force: 0.5 }));
    const fDown = async (x, y) => { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[x, y]]) }); else { await page.mouse.move(x, y); await page.mouse.down(); } };
    const fMove = async (x, y) => { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[x, y]]) }); else await page.mouse.move(x, y); };
    const fUp = async () => { if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up(); };

    /** ONE try of a new player: press at (b + off x r), drag toward the spot (tx, tz) at about 540 px/s, steering by the squishy once it is in the hand, hold
     *  still, let go. Returns what happened. */
    const view = () => page.evaluate(() => { const st = window.__WH__.shell.stageObj(), o = new Float32Array(6); const on = st.roomView ? st.roomView(o) : false; return on ? Array.from(o) : null; });
    let shotName = null;
    const tryCarry = async (i, tx, tz, off) => {
      const bd = await band(), b0 = (await bodies())[i];
      const out = { press: off, carried: false, mode: 'none', fingersMid: 0, rest: NaN, at: null, from: [r2(b0.w[0]), r2(b0.w[2])], frames: 0, liftFrames: -1, maxY: 0, scrolled: 0 };
      let px = Math.min(W - 10, Math.max(10, b0.x + off[0] * b0.r)), py = Math.min(bd.bottom - 10, Math.max(bd.top + 10, b0.y + off[1] * b0.r));
      const f0 = simFrames;
      await fDown(px, py); await frames(2);
      let held = 0;
      for (let k = 0; k < 320; k++) {
        const b = (await bodies())[i];
        out.maxY = Math.max(out.maxY, b.w[1]);
        if (b.carried && !out.carried) { out.carried = true; out.liftFrames = simFrames - f0; }
        if (k === 6) { out.fingersMid = b.fingers; out.mode = b.carried ? 'carry' : b.fingers > 0 ? 'press/rub' : 'stretch'; }
        const [ts, fs] = await proj([[tx, 0, tz], [b.w[0], 0, b.w[2]]]);
        if (!ts) break;
        // (not in the hand: the finger goes to the spot on screen; in the hand: the player moves the finger so the squishy hangs over the spot)
        let ax = ts.x, ay = ts.y;
        if (b.carried && fs) { ax = px + (ts.x - fs.x); ay = py + (ts.y - fs.y); }
        const dx = ax - px, dy = ay - py, L = Math.hypot(dx, dy);
        if (L < 8) { held++; if (held >= 24) break; await frames(2); continue; }
        held = 0;
        const s = Math.min(18, L);
        px = Math.min(W - 14, Math.max(14, px + (dx / L) * s)); py = Math.min(bd.bottom - 14, Math.max(bd.top + 14, py + (dy / L) * s));
        await fMove(px, py); await frames(2);
        if (k % 4 === 0) { const v = await view(); if (v && v[3] === 1) out.scrolled += 4; }
        if (shotName && b.carried && k >= 30) { await shot(shotName); shotName = null; }
        if (TRACE && k % 8 === 0) console.log('trace', k, JSON.stringify({ ptr: [Math.round(px), Math.round(py)], body: b.w.map(r2), carried: b.carried, fingers: b.fingers }));
      }
      if (out.mode === 'none') { const b = (await bodies())[i]; out.mode = b.carried ? 'carry' : b.fingers > 0 ? 'press/rub' : 'stretch'; }
      await fUp();
      await step(2.5);
      const b1 = (await bodies())[i];
      out.frames = simFrames - f0;
      out.at = [r2(b1.w[0]), r2(b1.w[2])]; out.rest = r2(Math.hypot(b1.w[0] - tx, b1.w[2] - tz)); out.maxY = r2(out.maxY);
      return out;
    };
    const OFFS = [[0, 0], [0, 0.4], [0, -0.45], [0.45, -0.3]];
    /** a new player's carry: tries until the squishy rests within ARRIVE m of the spot */
    const newPlayer = async (i, tx, tz) => {
      const log = [];
      for (let t = 0; t < TRIES; t++) {
        const b = (await bodies())[i], [ts] = await proj([[tx, 0, tz]]);
        // (the off-middle presses lean toward the spot on screen: "above" is up the frame; the fourth leans to the spot's side)
        const side = ts && ts.x < b.x ? -1 : 1, o = OFFS[Math.min(t, OFFS.length - 1)];
        const r = await tryCarry(i, tx, tz, [o[0] * side, o[1]]);
        log.push(r);
        if (r.rest < ARRIVE) return { tries: t + 1, ok: true, log };
      }
      return { tries: TRIES, ok: false, log };
    };

    const boot = async () => {
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 180000 });
      await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
      const b = await boxOf('.cta'); await tapAt(b.x, b.y);
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 90000 });
      await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'low'); wh.setSetting('skipAnimations', true); wh.pause(); });
    };
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await boot();
    await step(2); await page.evaluate(() => window.__WH__.resume()); await sleep(1500);
    await page.evaluate((pl) => sessionStorage.setItem('roomseed', JSON.stringify({ st: 45, pl })), Object.values(IDX).reduce((m, ix) => m | (1 << ix), 0));
    await page.reload({ waitUntil: 'load', timeout: 180000 });
    await boot();
    await step(2);
    await page.keyboard.press('Escape');
    // (with nothing to close, Escape opens the Menu (a phone): close it again, or a later tap lands on its rows: the Credits sheet covered the play view)
    for (let k = 0; k < 3 && (await page.evaluate(() => !!document.querySelector('#wh-menu:not([hidden]), .k-modal:not([hidden]), .panel[data-open="true"]'))); k++) { await page.keyboard.press('Escape'); await sleep(400); }
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => { window.__WH__.shell.grant(1); });
      for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
      for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
    }
    await step(1);
    const count = () => page.evaluate(() => window.__WH__.shell.matInfo().count);
    await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    if ((await count()) > 1) { await clickSel('.mat-chip'); await sleep(600); }
    // (a phone opens the Hoard over the play view after the capsules: it is closed, as a player closes it, so the Friends strip shows)

    // (the Friends strip hides while something covers the play view: a phone's "New stamp" moment after the capsules; a player waits for it to go)
    for (let k = 0; k < 30 && !(await boxOf('.pt-btn')); k++) await sleep(500);
    if (await clickSel('.pt-btn')) {
      // (a phone's sheet may hold a chip below its fold: it is scrolled into view first, as a finger would scroll it; until two friends are chosen)
      for (let k = 0; k < 6 && (await page.evaluate(() => document.querySelectorAll('.pt-chip[aria-pressed="true"]:not([data-play])').length)) < 2; k++) {
        await page.evaluate(() => document.querySelector('.pt-chip[aria-pressed="false"]:not([data-play])')?.scrollIntoView({ block: 'center' }));
        await sleep(200);
        await clickSel('.pt-chip[aria-pressed="false"]:not([data-play])');
      }
      // (Bring friends fills the party to the tier's three, as browser_cutparty does it, when a chip could not be reached)
      if ((await count()) < 3) await clickSel('.pt-bring');
      await clickSel('.pt-close');
    }
    if (process.argv.includes('--debug') || (await count()) < 3) console.log('party debug', JSON.stringify(await page.evaluate(() => { const v = (q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), getComputedStyle(e).visibility, e.closest('[hidden]') ? 'hidden' : '']; }; return { ds: { ...document.body.dataset }, open: [...document.querySelectorAll('.k-scrim:not([hidden]), .k-modal:not([hidden]), .panel[data-open="true"], #wh-menu:not([hidden]), [data-journal]')].map((e) => `${e.tagName}.${e.className}#${e.id}`), btn: v('.pt-btn'), strip: v('.pt-strip'), bring: v('.pt-bring'), chips: document.querySelectorAll('.pt-chip').length, pressed: document.querySelectorAll('.pt-chip[aria-pressed="true"]').length, matChip: v('.mat-chip'), count: window.__WH__.shell.matInfo().count, limit: window.__WH__.shell.matInfo().limit, live: (window.__liveLog || []).slice(-4) }; })));
    await page.evaluate(() => window.__WH__.pause()); await step(1.5);
    check(`${frame}: three squishies out`, (await count()) === 3, `${await count()} out`);

    for (const place of PLACES) {
      const def = DEFS[place], lay = tall && def.tall ? def.tall : def, B = lay.bounds;
      const home = place === 'home', cx = B.x, cz = B.z, hx = home ? (B.r ?? HOME_R) : B.hx, hz = home ? (B.r ?? HOME_R) : B.hz;
      const label = `${frame} ${NAMES[place] ?? place}`;
      const e0 = errs.length;
      if (!home || (await page.evaluate(() => window.__WH__.life()?.place ?? 0)) !== 0) {
        await page.evaluate(() => window.__WH__.resume());
        await clickSel('.dock-places');
        let go = false;
        // (a phone's sheet holds the far cards below its fold: the card is scrolled into view first, as a finger scrolls the sheet)
        for (let k = 0; k < 24 && !go; k++) { await sleep(400); await page.evaluate((q) => document.querySelector(q)?.scrollIntoView({ block: 'center' }), `.jn-go[data-place="${place}"]`); await sleep(150); go = await clickSel(`.jn-go[data-place="${place}"]`); }
        await page.evaluate(() => window.__WH__.pause());
        let arrived = false;
        for (let k = 0; k < 80 && !arrived; k++) { await step(0.25); arrived = await page.evaluate((ix) => { const L = window.__WH__.life(); return !!L && L.place === ix && !L.travelling; }, IDX[place]); }
        if (!arrived) { check(`${label}: arrived`, false); continue; }
      }
      await step(4);
      const things = (tall && def.tall ? def.tall.things : def.things).map((t) => [t.x, t.z]);
      const freeSpot = ([qx, qz]) => {
        let best = [qx, qz], bd2 = Infinity;
        for (let ix = -4; ix <= 4; ix++) for (let iz = -4; iz <= 4; iz++) {
          const x = qx + ix * 0.4, z = qz + iz * 0.4, d = Math.hypot(x - qx, z - qz);
          if (d > 1.45 || d >= bd2) continue;
          if (home ? Math.hypot(x - cx, z - cz) > hx - 0.8 : Math.abs(x - cx) > hx - 0.8 || Math.abs(z - cz) > hz - 0.8) continue;
          if (things.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.0)) continue;
          best = [x, z]; bd2 = d;
        }
        return best;
      };
      // the corners as a player names them (the spot inset 1 m from the walls; Home's felt is a disc: its back right is at (+0.55 r, -0.6 r))
      const corner = (sx, sz) => freeSpot(home ? [cx + sx * 0.55 * hx, cz + sz * 0.6 * hx] : [cx + sx * (hx - 1.0), cz + sz * (hz - 1.0)]);
      const backRight = corner(1, -1), backLeft = corner(-1, -1), frontRight = corner(1, 1);
      // ---- the carry: the squishy that stands most to the front left goes to the back right ----
      const bs = await bodies();
      const i = bs.reduce((a, b) => ((b.w[2] - b.w[0]) > (bs[a].w[2] - bs[a].w[0]) ? b.i : a), 0);
      const dist = Math.hypot(bs[i].w[0] - backRight[0], bs[i].w[2] - backRight[1]);
      await shot(`${place}_before`);
      shotName = `${place}_carrying`;
      const np = await newPlayer(i, backRight[0], backRight[1]);
      shotName = null;
      await shot(`${place}_after`);
      const what = np.log.map((r) => `${r.mode}${r.carried ? '+carried' : ''} rest ${r.rest} m, ${(r.frames / 60).toFixed(1)} s, max y ${r.maxY}, scrolled ${r.scrolled} frames`);
      data.push({ frame, place, kind: 'carry', from: np.log[0].from, to: backRight.map(r2), dist: r2(dist), tries: np.ok ? np.tries : null, log: np.log });
      check(`${label}: a NEW PLAYER moves a squishy from the front left to the back right (${r2(dist)} m) on the FIRST try`, np.ok && np.tries === 1,
        JSON.stringify({ tries: np.ok ? np.tries : `not in ${TRIES}`, what }));
      // ---- all three to three spots ----
      if (THREE) {
        const spots = [backLeft, backRight, frontRight];
        const f0 = simFrames;
        let presses = 0, done = 0;
        const bs2 = await bodies(), used = new Set();
        const order = [];
        for (const sp of spots) { let best = -1, bdd = Infinity; for (const b of bs2) { if (used.has(b.i)) continue; const d = Math.hypot(b.w[0] - sp[0], b.w[2] - sp[1]); if (d < bdd) { bdd = d; best = b.i; } } if (best >= 0) { used.add(best); order.push([best, sp]); } }
        const logs = [];
        for (const [bi, sp] of order) {
          const r = await newPlayer(bi, sp[0], sp[1]);
          presses += r.log.length;
          if (r.ok) done++;
          logs.push({ spot: sp.map(r2), tries: r.log.length, ok: r.ok, rests: r.log.map((q) => q.rest), at: r.log.map((q) => q.at), maxY: r.log.map((q) => q.maxY) });
        }
        if (done < 3) console.log('three log', JSON.stringify(logs));
        const secs = (simFrames - f0) / 60;
        data.push({ frame, place, kind: 'three', presses, done, secs: r2(secs), logs });
        check(`${label}: all three squishies to three spots (back left, back right, front right)`, done === 3 && order.length === 3, JSON.stringify({ done, presses, simSeconds: r2(secs) }));
        await shot(`${place}_three`);
      }
      // ---- the extras (--extras, at Home): the hint lines, the forgiving grab, two fingers (phone), Float ----
      if (EXTRAS && home) {
        const live = await page.evaluate(() => window.__liveLog.slice());
        const pill = await page.evaluate(() => document.querySelector('.hint')?.textContent ?? '');
        check(`${label}: "Drag to carry" was said once (the first-time hint); the gesture pill's room line names the carry`, live.filter((t) => /Drag to carry/.test(t)).length >= 1 && /Drag to carry/.test(pill) || live.filter((t) => /Drag to carry/.test(t)).length === 1,
          JSON.stringify({ said: live.filter((t) => /carry/i.test(t)).slice(0, 3), pill }));
        // the forgiving grab: a press 10 px outside the silhouette, dragged away, carries
        {
          const bs = await bodies(), bd = await band();
          const b = bs.reduce((a, c) => (Math.abs(c.x - W / 2) < Math.abs(a.x - W / 2) ? c : a));
          const side = b.x < W / 2 ? 1 : -1, x = b.x + side * (b.r + 10), y = b.y;
          const clear = bs.every((o) => o.i === b.i || Math.hypot(o.x - x, o.y - y) > o.r + 30);
          await fDown(x, y); await frames(2);
          let carried = false;
          for (let k = 1; k <= 10; k++) { await fMove(x + side * k * 8, Math.max(bd.top + 20, y - k * 8)); await frames(2); if ((await bodies())[b.i].carried) carried = true; }
          await fUp(); await step(2);
          check(`${label}: the forgiving grab: a ${touch ? 'finger' : 'click'} 10 px outside a squishy's outline picks it up`, !clear || carried, JSON.stringify({ r: Math.round(b.r), clear, carried }));
        }
        if (touch) {
          // two fingers, two squishies, at the same time
          const bs = (await bodies()).slice().sort((a, c) => a.x - c.x), a = bs[0], c = bs[bs.length - 1];
          const a0 = a.w, c0 = c.w;
          const T = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(pts) });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[a.x, a.y]]) }); await frames(2);
          await T([[a.x + 6, a.y - 16]]); await frames(2);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[a.x + 6, a.y - 16], [c.x, c.y]]) }); await frames(2);
          let both = 0;
          for (let k = 1; k <= 16; k++) { await T([[a.x + 6, a.y - 16 - k * 9], [c.x - k * 3, c.y - k * 9]]); await frames(2); const q = await bodies(); if (q[a.i].carried && q[c.i].carried) both++; }
          await shot(`${place}_twofingers`);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await step(2);
          const q = await bodies(), ma = Math.hypot(q[a.i].w[0] - a0[0], q[a.i].w[2] - a0[2]), mc = Math.hypot(q[c.i].w[0] - c0[0], q[c.i].w[2] - c0[2]);
          check(`${label}: two fingers carry TWO squishies at the same time (each finger its own), both moved`, both >= 8 && ma > 0.5 && mc > 0.5, JSON.stringify({ bothFrames: both, moved: [r2(ma), r2(mc)] }));
        }
        // Float: a floater is carried and stays where it is put
        {
          await page.evaluate(() => window.__WH__.setSetting('gravity', false)); await step(3);
          const bs = await bodies(), b = bs.reduce((a, c) => (Math.abs(c.x - W / 2) < Math.abs(a.x - W / 2) ? c : a)), bd = await band();
          await fDown(b.x, b.y); await frames(2);
          let carried = false, px = b.x, py = b.y;
          for (let k = 1; k <= 14; k++) { px += (b.x < W / 2 ? 1 : -1) * 9; py = Math.max(bd.top + 30, py - 7); await fMove(px, py); await frames(2); if ((await bodies())[b.i].carried) carried = true; }
          await frames(20);
          const held = (await bodies())[b.i].w;
          await fUp(); await step(3);
          const end = (await bodies())[b.i].w, drift = Math.hypot(end[0] - held[0], end[2] - held[2]), moved = Math.hypot(held[0] - b.w[0], held[2] - b.w[2]);
          await shot(`${place}_float`);
          check(`${label}: Float: a floating squishy is carried (${r2(moved)} m) and stays where it is put (3 s later within 0.25 m), still in the air`, carried && moved > 0.4 && drift < 0.25 && end[1] > 0.6,
            JSON.stringify({ carried, moved: r2(moved), drift: r2(drift), y: r2(end[1]) }));
          await page.evaluate(() => window.__WH__.setSetting('gravity', true)); await step(3);
        }
      }
      const errsHere = errs.slice(e0);
      check(`${label}: no console error and no page error`, errsHere.length === 0, errsHere.slice(0, 3).join(' | '));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
mkdirSync(resolve(ROOT, '_harness/_reports'), { recursive: true });
writeFileSync(resolve(ROOT, `_harness/_reports/browser_carry_${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), tag: TAG, rows, data }, null, 1));
console.log(`\n${rows.length - fails} ok, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
