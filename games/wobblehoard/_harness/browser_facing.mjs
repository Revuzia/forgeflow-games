// R15 FACING (owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn."): what the PLAYER sees.
// The real game in a browser; the sim stepped by the dev hook. For each walking squishy, every 0.1 s: the DRAWN face's forward on the floor (from the two eye
// beads the stage draws: the eye line's normal, eye 0 is the squishy's -x eye) against its travel (the body centre's velocity over 0.1 s), and the
// physics frame's facing (what probe_crawl reads) for comparison.
//   node _harness/browser_facing.mjs [--port=5388] [--only=desk|phone] [--tag=before] [--fams=slimegoo,firmsilicone,...] [--places=home,ripple,frostbell]
//        [--life=40] (s of autonomy per place) [--shots]
// -> rows on stdout, JSON in _harness/_reports/browser_facing_<tag>.json, pictures in _handoff/reports/shots_facing/<tag>_*.png (--shots, deviceScaleFactor 2)
import { launch, ROOT } from './pw.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PLACE_INFO } from '../src/data/places.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const PORT = Number(arg('port', 5388)), ONLY = arg('only', ''), TAG = arg('tag', 'f'), SHOTS = process.argv.includes('--shots');
const FAMS = arg('fams', 'slimegoo,jellygel,marshmallow,firmsilicone,gummy,putty').split(',').filter(Boolean);
const PLACES = arg('places', 'home,ripple,frostbell').split(',').filter(Boolean);
const LIFE_S = Number(arg('life', 40)), SKIP = arg('skip', '').split(',');
const IDX = Object.fromEntries(PLACE_INFO.map((p) => [p.id, p.idx]));
const SHOT_DIR = resolve(ROOT, '_handoff/reports/shots_facing');
mkdirSync(SHOT_DIR, { recursive: true }); mkdirSync(resolve(ROOT, '_harness/_reports'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAMES = [
  ['desk', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: SHOTS ? 2 : 1 }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: true, isMobile: true }],
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

// in the page: one sample of every squishy out: its world centre, the drawn face's forward, the physics frame's forward
const SAMPLE = () => {
  const wh = window.__WH__, L = wh.life(), mi = wh.shell.matInfo(), ev = wh.shell.eyeViews() || [];
  const out = [];
  for (const c of L ? L.chars : []) {
    if (c.kind !== 0) continue;
    const b = mi.bodies.find((x) => x.itemId === c.itemId);
    const v = ev.find((x) => x.id === c.view);
    let dfx = NaN, dfz = NaN, mx = NaN, mz = NaN;
    if (v && v.eyes.length === 2) {
      const e0 = v.eyes[0], e1 = v.eyes[1], ex = e1.x - e0.x, ez = e1.z - e0.z, l = Math.hypot(ex, ez);
      if (l > 1e-6) { dfx = -ez / l; dfz = ex / l; }
      mx = (e0.x + e1.x) / 2; mz = (e0.z + e1.z) / 2;
    }
    out.push({ id: c.itemId, sp: c.species, x: b ? b.w[0] : c.x, z: b ? b.w[2] : c.z, dfx, dfz, mx, mz, frame: c.face, scoot: c.scoot, flags: c.flags, asleep: c.asleep, carried: b ? b.carried : false });
  }
  return out;
};
const deg = (r) => (r * 180) / Math.PI;
const angBetween = (ax, az, bx, bz) => { const d = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1); return deg(Math.acos(Math.max(-1, Math.min(1, d)))); };
const pct = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r1 = (v) => Math.round(v * 10) / 10;

const report = { tag: TAG, frames: {} };
// (our own dev server: no HMR, no watching (another engineer edits the tree: a reload mid-measurement destroyed the page); killed at the end)
const srv = await (async () => {
  const child = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--config', resolve(ROOT, '_harness/facing/vite.nohmr.config.ts')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const url = `http://localhost:${PORT}/`;
  for (let k = 0; k < 120; k++) { try { const r = await fetch(url); if (r.ok) break; } catch { /* not yet */ } await sleep(500); if (child.exitCode !== null) throw new Error('vite: ' + log); }
  return { url, stop: () => { try { process.kill(-child.pid); } catch { /* gone */ } } };
})();
const browser = await launch();
try {
  for (const [frame, ctxOpt] of FRAMES) {
    const touch = frame === 'phone';
    const ctx = await browser.newContext(ctxOpt);
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
    const R = (report.frames[frame] = { walks: [], scripted: [], party: [], errs });
    const step = async (s) => { await page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s); };
    const boxOf = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && !e.disabled ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
    const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const clickSel = async (sel) => { const b = await boxOf(sel); if (!b) return false; await tapAt(b.x, b.y); await sleep(350); return true; };
    const shot = async (n) => {
      if (!SHOTS) return;
      await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; });
      await page.evaluate(async () => { window.__WH__.step(1 / 60, 1); const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); });
      await page.screenshot({ path: resolve(SHOT_DIR, `${TAG}_${frame}_${n}.png`), timeout: 180000 });
    };
    const boot = async () => {
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 180000 });
      await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
      const b = await boxOf('.cta'); await tapAt(b.x, b.y);
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 90000 });
      await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('skipAnimations', true); wh.pause(); });
    };
    const closeOver = async () => { for (let k = 0; k < 3 && (await page.evaluate(() => !!document.querySelector('#wh-menu:not([hidden]), .k-modal:not([hidden]), .panel[data-open="true"], #wh-journal, #wh-travel'))); k++) { await page.keyboard.press('Escape'); await sleep(400); } };
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await boot();
    await step(2);
    await page.evaluate((pl) => sessionStorage.setItem('roomseed', JSON.stringify({ st: 45, pl })), Object.values(IDX).reduce((m, ix) => m | (1 << ix), 0));
    await page.reload({ waitUntil: 'load', timeout: 180000 });
    await boot();
    await step(2);
    await page.keyboard.press('Escape'); await sleep(300); await closeOver();

    /** observe `secs` of sim: every 0.1 s a sample of every squishy out; walks are cut where a squishy moves (centre speed > 4 cm/s) */
    const observe = async (secs, label, shotEvery = 0) => {
      const hist = new Map();   // id -> [{t, x, z, dfx, dfz, frame}]
      let shotN = 0, lastShot = -1e9;
      for (let t = 0; t < secs; t += 0.1) {
        const ss = await page.evaluate(() => { window.__WH__.step(1 / 60, 6); return window.__SAMPLE__(); });
        for (const c of ss) { if (!hist.has(c.id)) hist.set(c.id, []); hist.get(c.id).push({ t, ...c }); }
        if (shotEvery > 0 && t - lastShot >= shotEvery) {
          // a picture when one walks with its speed up
          const moving = ss.some((c) => { const h = hist.get(c.id); if (!h || h.length < 3) return false; const a = h[h.length - 3], b = h[h.length - 1]; return Math.hypot(b.x - a.x, b.z - a.z) / 0.2 > 0.06; });
          if (moving) { await shot(`${label}_${String(shotN++).padStart(2, '0')}`); lastShot = t; }
        }
      }
      // per squishy: walking samples (speed > 4 cm/s over 0.2 s, not carried), the drawn face vs travel and the frame vs travel
      const res = [];
      for (const [id, h] of hist) {
        const draw = [], frm = [], seg = [];
        let cur = null;
        for (let k = 1; k + 1 < h.length; k++) {
          const a = h[k - 1], b = h[k + 1], vx = (b.x - a.x) / 0.2, vz = (b.z - a.z) / 0.2, sp = Math.hypot(vx, vz), c = h[k];
          const walking = sp > 0.04 && !c.carried && c.scoot;
          if (!walking || !(c.dfx === c.dfx)) { if (cur) { seg.push(cur); cur = null; } continue; }
          const ad = angBetween(c.dfx, c.dfz, vx, vz);
          const fr = c.frame === null ? NaN : (c.frame * Math.PI) / 180, af = angBetween(Math.sin(fr), Math.cos(fr), vx, vz);
          draw.push(ad); frm.push(af);
          if (!cur) cur = { t0: c.t, n: 0, angs: [], hd: [] };
          cur.n++; cur.angs.push(ad); cur.hd.push(deg(Math.atan2(vx, vz)));
        }
        if (cur) seg.push(cur);
        const sp = h[0].sp;
        res.push({ id, sp, n: draw.length, drawMed: r1(pct(draw, 0.5)), draw90: r1(pct(draw, 0.9)), over45: draw.length ? r1((100 * draw.filter((x) => x > 45).length) / draw.length) : NaN, frameMed: r1(pct(frm, 0.5)), frame90: r1(pct(frm, 0.9)),
          walks: seg.map((s) => ({ t0: r1(s.t0), dur: r1(s.n * 0.1), first: r1(s.angs[0]), med: r1(pct(s.angs, 0.5)), heading: r1(pct(s.hd, 0.5)) })) });
      }
      return res;
    };
    await page.evaluate(`window.__SAMPLE__ = ${SAMPLE.toString()}`);
    const life = await page.evaluate(() => window.__WH__.life());
    console.log(frame, 'place', life.place, 'chars', JSON.stringify(life.chars.map((c) => [c.species, c.view, c.face, c.scoot])));
    if (!SKIP.includes('life')) {
      const res = await observe(LIFE_S, 'home_life', SHOTS ? 3 : 0);
      for (const r of res) console.log(`${frame} home life ${r.sp}: ${r.n} walking samples; drawn face vs travel median ${r.drawMed} deg, p90 ${r.draw90}, >45 deg ${r.over45}%; physics frame vs travel median ${r.frameMed}, p90 ${r.frame90}; walks ${JSON.stringify(r.walks)}`);
      R.walks.push({ place: 'home', res });
    }
    // ---- each family as the play squishy: its own walks (autonomy) at Home
    await page.evaluate(async () => {
      const pm = await import('/src/physics/props.ts');
      const orig = pm.PropWorld.prototype.beginFrame;
      pm.PropWorld.prototype.beginFrame = function () { window.__PW__ = this; return orig.call(this); };
    });
    const setFam = (fam) => page.evaluate(async (f) => {
      const gm = await import('/src/core/genome.ts'), cm = await import('/src/data/catalog.ts');
      const s = cm.CATALOG.find((d) => cm.familyOf(d.id) === f);
      if (!s) return null;
      window.__WH__.setGenome(gm.encodeGenome({ ...gm.makeStarterGenome(), species: s.id }));
      return s.id;
    }, fam);
    if (!SKIP.includes('fams')) for (const fam of FAMS) {
      const sp = await setFam(fam);
      await step(3);
      const res = await observe(LIFE_S, `home_${fam}`, 0);
      for (const r of res) console.log(`${frame} home ${fam} (${sp}) life ${r.sp}: ${r.n} walking samples; drawn face vs travel median ${r.drawMed} deg, p90 ${r.draw90}, >45 deg ${r.over45}%; physics frame vs travel median ${r.frameMed}, p90 ${r.frame90}; walks ${JSON.stringify(r.walks)}`);
      R.walks.push({ place: 'home', fam, res });
    }
    // ---- scripted walks (autonomy off): from rest facing the camera, a 1.2 m walk toward / away from the camera, left, right, and a 90 degree retarget
    // on the way; every 2 frames the drawn face's yaw and the travel; the turn: how long and how far it goes before its face is within 20 degrees of its way
    if (!SKIP.includes('scripted')) {
      await page.evaluate(() => window.__WH__.setSetting('autonomy', false));
      for (const fam of FAMS) {
        const sp = await setFam(fam);
        await step(3);
        const dirs = [['right', 1, 0], ['away', 0, -1], ['left', -1, 0], ['toward', 0, 1], ['turn90', 1, 0]];
        for (const [nm, dx, dz] of dirs) {
          const tr = await page.evaluate(async ([dx, dz, nm]) => {
            const wh = window.__WH__, w = window.__PW__;
            const bd = w.bodies.find((b) => !b.chunk) ?? w.bodies[0];
            // (back to the spot it started from, facing the camera: a still body turns back to +Z)
            if (!window.__H0__) window.__H0__ = { x: bd.center.x, z: bd.center.z };
            const H = window.__H0__;
            bd.scootTo(H.x - dx * 0.6, H.z - dz * 0.6, 0.2); wh.step(1 / 60, 600); bd.scootTo(NaN, 0, 0); wh.step(1 / 60, 240);
            const view = () => { const ev = wh.shell.eyeViews() || []; let best = null, bd2 = 1e9; for (const v of ev) { if (v.eyes.length !== 2) continue; const mx = (v.eyes[0].x + v.eyes[1].x) / 2, mz = (v.eyes[0].z + v.eyes[1].z) / 2, d = Math.hypot(mx - bd.center.x, mz - bd.center.z); if (d < bd2) { bd2 = d; best = v; } } return best; };
            const yawOf = () => { const v = view(); if (!v) return NaN; const ex = v.eyes[1].x - v.eyes[0].x, ez = v.eyes[1].z - v.eyes[0].z; return Math.atan2(-ez, ex); /* atan2(fx, fz) of (-ez, ex) */ };
            const frYaw = () => { const q = bd.frame; return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); };
            const G = { slowrise: 0.18, marshmallow: 0.22, mochidough: 0.18, jellygel: 0.26, waterfill: 0.22, putty: 0.12, stickystretch: 0.2, slimegoo: 0.1, firmsilicone: 0.32, popdome: 0.28, gummy: 0.28, beadsqueeze: 0.22 }[bd.family] ?? 0.2;
            const x0 = bd.center.x, z0 = bd.center.z;
            bd.scootTo(x0 + dx * 1.2, z0 + dz * 1.2, G);
            const out = [];
            let turned = false;
            for (let k = 0; k < 600; k++) {
              if (nm === 'turn90' && !turned && Math.hypot(bd.center.x - x0, bd.center.z - z0) > 0.4) { turned = true; bd.scootTo(bd.center.x, bd.center.z - 1.0, G); }
              out.push([bd.center.x, bd.center.z, yawOf(), frYaw(), turned ? 1 : 0]);
              wh.step(1 / 60, 2);
              if (k > 30 && Math.hypot(bd.center.x - (turned ? out[out.length - 1][0] : x0 + dx * 1.2), 0) < 0 ) break;
              if (!bd.scootOn && k > 30) { out.push([bd.center.x, bd.center.z, yawOf(), frYaw(), 2]); break; }
            }
            bd.scootTo(NaN, 0, 0);
            return { fam: bd.family, G, x0, z0, out };
          }, [dx, dz, nm]);
          // analysis: heading of the target; drawn yaw vs travel (velocity over 4 frames) while moving faster than 3 cm/s
          const O = tr.out, dt = 2 / 60;
          let maxMov = 0, slid = 0, tTurn = NaN, peakRate = 0, x = O[0][0], z = O[0][1], movAngs = [], frAngs = [];
          const hd0 = Math.atan2(dx, dz);
          for (let k = 2; k + 2 < O.length; k++) {
            const vx = (O[k + 2][0] - O[k - 2][0]) / (4 * dt), vz = (O[k + 2][1] - O[k - 2][1]) / (4 * dt), sp = Math.hypot(vx, vz);
            const yd = O[k][2], yf = O[k][3];
            let rate = Math.abs(Math.atan2(Math.sin(O[k + 1][2] - O[k - 1][2]), Math.cos(O[k + 1][2] - O[k - 1][2]))) / (2 * dt);
            if (rate > peakRate) peakRate = rate;
            if (sp > 0.03) { const a = angBetween(Math.sin(yd), Math.cos(yd), vx, vz); movAngs.push(a); frAngs.push(angBetween(Math.sin(yf), Math.cos(yf), vx, vz)); if (a > maxMov) maxMov = a; }
            const want = O[k][4] === 1 ? Math.PI : hd0;
            const off = Math.abs(Math.atan2(Math.sin(yd - want), Math.cos(yd - want)));
            if (O[k][4] === 0 && !(tTurn === tTurn) && off < (20 * Math.PI) / 180) { tTurn = k * dt; slid = Math.hypot(O[k][0] - O[0][0], O[k][1] - O[0][1]); }
          }
          const row = { fam: tr.fam, dir: nm, startYaw: r1(deg(O[0][2])), turnS: r1(tTurn * 10) / 10, slidBeforeTurnM: Math.round(slid * 100) / 100, peakRateDegS: Math.round(deg(peakRate)), movMed: r1(pct(movAngs, 0.5)), mov90: r1(pct(movAngs, 0.9)), movMax: r1(maxMov), frameMed: r1(pct(frAngs, 0.5)), frame90: r1(pct(frAngs, 0.9)) };
          console.log(`${frame} scripted ${JSON.stringify(row)}`);
          R.scripted.push(row);
        }
      }
      await page.evaluate(() => window.__WH__.setSetting('autonomy', true));
    }
    await page.close(); await ctx.close();
  }
} finally {
  writeFileSync(resolve(ROOT, `_harness/_reports/browser_facing_${TAG}.json`), JSON.stringify(report, null, 1));
  await browser.close();
  srv.stop();
}
