// R15 FACING (owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn."): what the PLAYER sees.
// The real game in a browser (its own fresh vite dev server, no HMR: another engineer edits the tree), the sim stepped by the dev hook, one render per sample.
// The DRAWN face's forward on the floor = the normal of the line between the two eye beads the stage draws (stage.eyeCentres, the beads on the jelly's skin;
// eye 0 is the squishy's -x eye, so forward = (-ez, ex) of e1 - e0), against the travel = the body centre's velocity over +-0.1 s. The physics frame's
// facing (what probe_crawl reads) is recorded beside it.
//   node _harness/browser_facing.mjs [--port=5388] [--only=desk|phone] [--tag=before] [--sec=fams,home3,asked,calm,places,float] [--fams=all|a,b]
//        [--life=30] (s of autonomy per observation) [--shots] (deviceScaleFactor 2 pictures of walks in four headings, normal and Calm; no rows)
// -> progress + rows in _harness/_reports/browser_facing_<tag>.log, JSON in _harness/_reports/browser_facing_<tag>.json (written after every section),
//    pictures in _handoff/reports/shots_facing/<tag>_<frame>_*.png
import { launch, ROOT } from './pw.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { PLACE_INFO } from '../src/data/places.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const PORT = Number(arg('port', 5388)), ONLY = arg('only', ''), TAG = arg('tag', 'f'), SHOTS = process.argv.includes('--shots');
const FA = arg('fams', 'all'), FAMS = FA === 'all' ? [...MATERIAL_FAMILY_IDS] : FA.split(',').filter(Boolean);
const SEC = arg('sec', 'fams,home3,asked,calm,places,float').split(',');
const LIFE_S = Number(arg('life', 30)), QUALITY = arg('quality', 'high');   // (the graphics tier: high, med or low; --quality=low is LIFE's tightest wake budget)
const IDX = Object.fromEntries(PLACE_INFO.map((p) => [p.id, p.idx]));
const SHOT_DIR = resolve(ROOT, '_handoff/reports/shots_facing');
mkdirSync(SHOT_DIR, { recursive: true }); mkdirSync(resolve(ROOT, '_harness/_reports'), { recursive: true });
const LOG = resolve(ROOT, `_harness/_reports/browser_facing_${TAG}.log`), JSONF = resolve(ROOT, `_harness/_reports/browser_facing_${TAG}.json`);
writeFileSync(LOG, '');
const T0 = Date.now();
const log = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(0)}s] ` + a.join(' '); appendFileSync(LOG, s + '\n'); console.log(s); };
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

// in the page: one sample of every whole out: its world centre, the drawn face's forward (eye beads), the physics frame's yaw, its LIFE flags
const SAMPLE = () => {
  const wh = window.__WH__, L = wh.life(), mi = wh.shell.matInfo(), ev = wh.shell.eyeViews() || [];
  const out = [];
  for (const c of L ? L.chars : []) {
    if (c.kind !== 0) continue;
    const b = mi.bodies.find((x) => x.itemId === c.itemId);
    const v = ev.find((x) => x.id === c.view);
    let dfx = NaN, dfz = NaN;
    if (v && v.eyes.length === 2) {
      const e0 = v.eyes[0], e1 = v.eyes[1], ex = e1.x - e0.x, ez = e1.z - e0.z, l = Math.hypot(ex, ez);
      if (l > 1e-6) { dfx = -ez / l; dfz = ex / l; }
    }
    // (diagnosis: the physics state the crawl's turn reads, of the tracked body nearest this one)
    let dg = null;
    const W = window.__PW__;
    if (W && b) {
      let bi = -1, bd = 1e9;
      for (let k = 0; k < W.bodies.length; k++) { const B = W.bodies[k], d = Math.hypot(B.center.x - b.w[0], B.center.z - b.w[2]); if (d < bd) { bd = d; bi = k; } }
      if (bi >= 0 && bd < 0.05) { const B = W.bodies[bi], C = W.crawls[bi]; dg = { held: B.heldF, move: B.moveOn, cy: B.cyOn, car: B.carried, grav: B.gravityOn, sl: B.asleep, air: +C.s[5].toFixed(2), turn: C.turn, nc: B.nearCount, sv: +B.sV.toFixed(3), so: B.scootOn, d: Math.hypot(B.stx - B.cx, B.stz - B.cz).toFixed(2), on: C.on, chunk: B.chunk || B.capFlat, fy: Math.round(Math.atan2(2 * (B.qr[0] * B.qr[2] + B.qr[3] * B.qr[1]), 1 - 2 * (B.qr[0] * B.qr[0] + B.qr[1] * B.qr[1])) * 57.3), hy: Math.round(Math.atan2(B.stx - B.cx, B.stz - B.cz) * 57.3), vy: Math.round(Math.atan2(B.vcx, B.vcz) * 57.3), vb: +Math.hypot(B.vcx, B.vcz).toFixed(2), cx: +B.center.x.toFixed(3), wx: +b.w[0].toFixed(3), cz: +B.center.z.toFixed(3), wz: +b.w[2].toFixed(3), calls: B.__calls ? { ...B.__calls } : null, nudge: B.__lastNudge || null }; if (B.__calls) B.__calls = {}; }
    }
    out.push({ dg, id: c.itemId, sp: c.species, x: b ? b.w[0] : c.x, z: b ? b.w[2] : c.z, y: b ? b.w[1] : 0, dfx, dfz, frame: c.face, scoot: c.scoot, flags: c.flags, asleep: c.asleep, carried: b ? b.carried : false });
  }
  return out;
};
const deg = (r) => (r * 180) / Math.PI;
const angBetween = (ax, az, bx, bz) => { const d = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1); return deg(Math.acos(Math.max(-1, Math.min(1, d)))); };
const pct = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r1 = (v) => Math.round(v * 10) / 10;
const AIR = 128, TOUCH = 1 | 2;
const DIAG = [];   // (walk samples more than 60 deg off travel, with the crawl's inputs)

/** a history (samples every 0.1 s) -> per squishy: the travel samples (> 4 cm/s, not held or carried) split by how it travels (walk: LIFE's scoot; air: a hop or
 *  a toss; other: pushed, nudged, sliding), the drawn face vs travel, and each walk's start (the first sample above 4 cm/s) and heading class */
function analyse(hist) {
  const res = [];
  for (const [id, h] of hist) {
    const by = { walk: [], air: [], other: [] }, frm = [], walks = [], perc = [], toWay = [];
    let pushed = 0;
    let cur = null;
    for (let k = 1; k + 1 < h.length; k++) {
      const a = h[k - 1], b = h[k + 1], vx = (b.x - a.x) / 0.2, vz = (b.z - a.z) / 0.2, sp = Math.hypot(vx, vz), c = h[k];
      const moving = sp > 0.04 && !c.carried && (c.flags & TOUCH) === 0 && c.dfx === c.dfx;
      const mode = !moving ? null : (c.flags & AIR) !== 0 ? 'air' : c.scoot ? 'walk' : 'other';
      if (mode !== 'walk') { if (cur) { walks.push(cur); cur = null; } }
      if (!mode) continue;
      const ad = angBetween(c.dfx, c.dfz, vx, vz);
      by[mode].push(ad);
      if (mode === 'walk') {
        // the travel over +-0.5 s (what the eye reads as its way: a crawl cycle is about 1 s), and the glide's own heading (where it is going), and whether it is
        // pushed BACK (its travel more than 90 deg from its own heading: a walk blocked by a ball or a friend bounces off it each crawl cycle; not a turn's fault)
        const a5 = h[Math.max(0, k - 5)], b5 = h[Math.min(h.length - 1, k + 5)];
        perc.push(angBetween(c.dfx, c.dfz, b5.x - a5.x, b5.z - a5.z));
        if (c.dg) {
          const hr = (c.dg.hy * Math.PI) / 180, hx = Math.sin(hr), hz = Math.cos(hr);
          toWay.push(angBetween(c.dfx, c.dfz, hx, hz));
          if (angBetween(vx, vz, hx, hz) > 90) pushed++;
        }
      }
      if (mode === 'walk' && ad > 60 && DIAG.length < 400) DIAG.push({ sp: c.sp, t: r1(c.t), ad: r1(ad), v: Math.round(sp * 100) / 100, dg: c.dg });
      if (mode === 'walk') {
        const fr = c.frame === null ? NaN : (c.frame * Math.PI) / 180;
        frm.push(angBetween(Math.sin(fr), Math.cos(fr), vx, vz));
        if (!cur) cur = { t0: c.t, angs: [], hd: [], sp: [] };
        cur.angs.push(ad); cur.hd.push(deg(Math.atan2(vx, vz))); cur.sp.push(sp);
      }
    }
    if (cur) walks.push(cur);
    const W = by.walk;
    // heading class of a walk: toward the camera (+z within 45 deg), away (-z), or across
    const cls = (hd) => (Math.abs(hd) < 45 ? 'toward' : Math.abs(hd) > 135 ? 'away' : 'across');
    const byCls = { toward: [], away: [], across: [] };
    for (const w of walks) for (let i = 0; i < w.angs.length; i++) byCls[cls(w.hd[i])].push(w.angs[i]);
    let vmax = 0;
    for (let k = 2; k < h.length; k++) vmax = Math.max(vmax, Math.hypot(h[k].x - h[k - 2].x, h[k].z - h[k - 2].z) / 0.2);
    res.push({ raw: { W: W.map(r1), perc: perc.map(r1), way: toWay.map(r1), pushed }, id, sp: h[0].sp, samples: h.length, noFace: h.filter((c) => !(c.dfx === c.dfx)).length, asleep: h.filter((c) => c.asleep).length, vmax: Math.round(vmax * 100) / 100, walkN: W.length, walkMed: r1(pct(W, 0.5)), walk90: r1(pct(W, 0.9)), walkOver45: W.length ? r1((100 * W.filter((x) => x > 45).length) / W.length) : NaN, percMed: r1(pct(perc, 0.5)), perc90: r1(pct(perc, 0.9)), wayMed: r1(pct(toWay, 0.5)), way90: r1(pct(toWay, 0.9)), wayOver45: toWay.length ? r1((100 * toWay.filter((x) => x > 45).length) / toWay.length) : NaN, pushedPct: W.length ? r1((100 * pushed) / W.length) : NaN,
      frameMed: r1(pct(frm, 0.5)), airN: by.air.length, airMed: r1(pct(by.air, 0.5)), otherN: by.other.length, otherMed: r1(pct(by.other, 0.5)),
      cls: Object.fromEntries(Object.entries(byCls).map(([k, a]) => [k, a.length ? `${a.length} med ${r1(pct(a, 0.5))} p90 ${r1(pct(a, 0.9))}` : '-'])),
      walks: walks.map((w) => ({ t0: r1(w.t0), dur: r1(w.angs.length * 0.1), first: r1(w.angs[0]), med: r1(pct(w.angs, 0.5)), max: r1(Math.max(...w.angs)), heading: r1(pct(w.hd, 0.5)), v: Math.round(pct(w.sp, 0.5) * 100) / 100 })) });
  }
  return res;
}
const pooled = (res) => {   // every squishy's walk samples together (a section's one-line verdict)
  const all = [];
  for (const r of res) for (const w of r.walks) all.push(w);
  const starts = all.map((w) => w.first);
  const W = res.flatMap((r) => r.raw.W), P = res.flatMap((r) => r.raw.perc), Y = res.flatMap((r) => r.raw.way), pu = res.reduce((a, r) => a + r.raw.pushed, 0);
  const o45 = (a) => (a.length ? r1((100 * a.filter((x) => x > 45).length) / a.length) : NaN);
  return { walks: all.length, startMed: r1(pct(starts, 0.5)), n: W.length, med: r1(pct(W, 0.5)), p90: r1(pct(W, 0.9)), over45: o45(W), percMed: r1(pct(P, 0.5)), perc90: r1(pct(P, 0.9)), percOver45: o45(P), wayMed: r1(pct(Y, 0.5)), way90: r1(pct(Y, 0.9)), wayOver45: o45(Y), pushedPct: W.length ? r1((100 * pu) / W.length) : NaN };
};

const report = { tag: TAG, frames: {} };
const save = () => { report.diag = DIAG; writeFileSync(JSONF, JSON.stringify(report, null, 1)); };
const srv = await (async () => {
  const child = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--config', resolve(ROOT, '_harness/facing/vite.nohmr.config.ts')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const url = `http://localhost:${PORT}/`;
  for (let k = 0; k < 120; k++) { try { const r = await fetch(url); if (r.ok) break; } catch { /* not yet */ } await sleep(500); if (child.exitCode !== null) throw new Error('vite: ' + out); }
  return { url, stop: () => { try { process.kill(-child.pid); } catch { /* gone */ } } };
})();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { save(); } catch { /* ignore */ } srv.stop(); process.exit(143); });
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
    const R = (report.frames[frame] = { scripted: [], obs: {}, errs });
    const step = async (s) => { await page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s); };
    const boxOf = (sel) => page.evaluate((q) => { for (const e of document.querySelectorAll(q)) { const r = e.getBoundingClientRect(); if (r.width > 0 && !e.disabled && !e.closest('[hidden]')) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; }, sel);
    const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const tapSel = async (sel) => { const b = await boxOf(sel); if (!b) return false; await tapAt(b.x, b.y); await sleep(400); return true; };
    // (the eye beads are placed on the CPU in stage.update (bodyview -> face.update), so measuring needs no pixels: the GL draw (SwiftShader, 1.4 s a frame on a
    // loaded 4-core box) is switched off while sampling and switched on for a picture)
    // (what a render does besides drawing is kept: the camera's and the scene's matrices, which LIFE's on-screen test (stage.bodyScreenPoint) reads: without
    // them every squishy read as off screen after the room camera moved, and LIFE put the whole party to sleep)
    const drawOff = () => page.evaluate(() => { const st = window.__WH__.shell.stageObj(); if (!window.__R0__) window.__R0__ = st.render; st.render = () => { try { st.scene?.updateMatrixWorld(); st.camera.updateMatrixWorld(); } catch { /* ignore */ } }; });
    const drawOn = () => page.evaluate(() => { const st = window.__WH__.shell.stageObj(); if (window.__R0__) st.render = window.__R0__; });
    const shot = async (n) => {
      await drawOn();
      await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; window.__WH__.step(1 / 60, 1); });
      await page.screenshot({ path: resolve(SHOT_DIR, `${TAG}_${frame}_${n}.png`), timeout: 240000, caret: 'hide' });
      await drawOff();
    };
    const boot = async () => {
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 180000 });
      await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
      const b = await boxOf('.cta'); await tapAt(b.x, b.y);
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 90000 });
      await page.evaluate((QUALITY) => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', QUALITY); wh.setSetting('skipAnimations', true); wh.setSetting('calm', false); wh.pause(); }, QUALITY);
    };
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await boot();
    await step(2);
    await page.evaluate((pl) => sessionStorage.setItem('roomseed', JSON.stringify({ st: 45, pl })), Object.values(IDX).reduce((m, ix) => m | (1 << ix), 0));
    await page.reload({ waitUntil: 'load', timeout: 180000 });
    await boot();
    await step(2);
    await page.evaluate(`window.__SAMPLE__ = ${SAMPLE.toString()}`);
    await drawOff();
    await page.evaluate(async () => {
      const pm = await import('/src/physics/props.ts');
      const orig = pm.PropWorld.prototype.beginFrame;
      pm.PropWorld.prototype.beginFrame = function () { window.__PW__ = this; return orig.call(this); };
      // (diagnosis: LIFE's other drivers on a body, counted per sample)
      const sm = await import('/src/physics/softbody.ts');
      for (const k of ['nudge', 'hop', 'setSquash', 'moveTo', 'carryTo']) { const o = sm.SoftBody.prototype[k]; if (typeof o === 'function') sm.SoftBody.prototype[k] = function (...a) { this.__calls = this.__calls || {}; this.__calls[k] = (this.__calls[k] || 0) + 1; if (k === 'nudge') this.__lastNudge = [a[0].x, a[0].y, a[0].z]; return o.apply(this, a); }; }
    });
    log(frame, 'booted; life', JSON.stringify(await page.evaluate(() => { const L = window.__WH__.life(); return { place: L.place, chars: L.chars.map((c) => c.species) }; })));

    /** LIFE is QUIET (nobody walks) while a sheet or the menu is open, the tool is not the hand, or input is not live: close what is open (a stray Escape
     *  opens the menu) */
    const unquiet = async () => {
      for (let k = 0; k < 4 && (await page.evaluate(() => window.__WH__.life().quiet)); k++) {
        log(frame, 'quiet; open:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], .k-panel, .panel, .pt, .sheet')].filter((e) => !e.hidden && e.getBoundingClientRect().width > 0).map((e) => e.className.slice(0, 40)))));
        if (!(await tapSel('.pt-close'))) await page.keyboard.press('Escape');
        await sleep(400); await page.evaluate(() => window.__WH__.pause()); await step(0.5);
      }
      if (await page.evaluate(() => window.__WH__.life().quiet)) log(frame, 'STILL QUIET');
    };
    /** `secs` of sim, a sample every 0.1 s */
    const observe = async (secs) => {
      const hist = new Map();
      for (let t = 0; t < secs; t += 0.1) {
        const ss = await page.evaluate(() => { window.__WH__.step(1 / 60, 6); return window.__SAMPLE__(); });
        for (const c of ss) { if (!hist.has(c.id)) hist.set(c.id, []); hist.get(c.id).push({ t, ...c }); }
      }
      return analyse(hist);
    };
    const obs = async (label, secs) => {
      await unquiet();
      const res = await observe(secs);
      R.obs[label] = res;
      const p = pooled(res);
      R.pooled = R.pooled || {}; R.pooled[label] = p;
      log(`${frame} ${label} POOLED ${JSON.stringify(p)}`);
      for (const r of res) log(`   ${r.sp}: ${r.samples} samples (no face ${r.noFace}, asleep ${r.asleep}, top speed ${r.vmax} m/s); walk samples ${r.walkN}: face vs travel(0.2 s) median ${r.walkMed} p90 ${r.walk90} >45deg ${r.walkOver45}%; vs travel(1 s) median ${r.percMed} p90 ${r.perc90}; vs its own way median ${r.wayMed} p90 ${r.way90} >45deg ${r.wayOver45}%; pushed back ${r.pushedPct}% (physics frame median ${r.frameMed}); air ${r.airN} med ${r.airMed}; other ${r.otherN} med ${r.otherMed}; by heading ${JSON.stringify(r.cls)}; walks ${JSON.stringify(r.walks)}`);
      save();
    };
    const setFam = (fam) => page.evaluate(async (f) => {
      const gm = await import('/src/core/genome.ts'), cm = await import('/src/data/catalog.ts');
      const s = cm.CATALOG.find((d) => cm.familyOf(d.id) === f);
      if (!s) return null;
      window.__WH__.setGenome(gm.encodeGenome({ ...gm.makeStarterGenome(), species: s.id }));
      return s.id;
    }, fam);

    /** scripted walks of the play squishy (autonomy off), each from rest (2.5 s after the last: a still body turns back to the camera): `dirs` rows
     *  [name, dx, dz, from] = a 0.9 m walk along (dx, dz) from the start spot H + from x 0.9 (the walks chain: away then toward comes back to H); the drawn yaw every 4 frames */
    const scripted = async (fam, dirs, calm) => {
      const sp = await setFam(fam);
      await step(3);
      await page.evaluate((c) => window.__WH__.setSetting('calm', c), calm);
      const rows = [];
      for (const [nm, dx, dz, from] of dirs) {
        const tr = await page.evaluate(async ([dx, dz, nm, from]) => {
          const wh = window.__WH__, w = window.__PW__;
          const bd = w.bodies.find((b) => !b.chunk) ?? w.bodies[0];
          if (!window.__H0__) window.__H0__ = { x: bd.center.x, z: bd.center.z };
          const H = window.__H0__, sx = H.x + from[0] * 0.9, sz = H.z + from[1] * 0.9;
          if (Math.hypot(bd.center.x - sx, bd.center.z - sz) > 0.06) { bd.scootTo(sx, sz, 0.3); for (let k = 0; k < 40 && bd.scootOn; k++) wh.step(1 / 60, 12); bd.scootTo(NaN, 0, 0); }
          wh.step(1 / 60, 150);
          const view = () => { const ev = wh.shell.eyeViews() || []; let best = null, bd2 = 1e9; for (const v of ev) { if (v.eyes.length !== 2) continue; const mx = (v.eyes[0].x + v.eyes[1].x) / 2, mz = (v.eyes[0].z + v.eyes[1].z) / 2, d = Math.hypot(mx - bd.center.x, mz - bd.center.z); if (d < bd2) { bd2 = d; best = v; } } return best; };
          const yawOf = () => { const v = view(); if (!v) return NaN; const ex = v.eyes[1].x - v.eyes[0].x, ez = v.eyes[1].z - v.eyes[0].z; return Math.atan2(-ez, ex); };
          const frYaw = () => { const q = bd.frame; return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); };
          const { GAITS } = await import('/src/data/life.ts');
          const G = GAITS[bd.family]?.glide ?? 0.2;
          const x0 = bd.center.x, z0 = bd.center.z;
          bd.scootTo(x0 + dx * 0.9, z0 + dz * 0.9, G);
          const out = [];
          let turned = false;
          wh.step(1 / 60, 1);
          for (let k = 0; k < 400; k++) {
            if (nm === 'turn90' && !turned && Math.hypot(bd.center.x - x0, bd.center.z - z0) > 0.35) { turned = true; bd.scootTo(bd.center.x, bd.center.z - 0.6, G); }
            out.push([bd.center.x, bd.center.z, yawOf(), frYaw(), turned ? 1 : 0]);
            if (!bd.scootOn && k > 10) break;
            // (arrived within 3 cm, or no 2 cm of progress in 2 s: blocked by the room's edge or a thing)
            const L = out.length;
            if (L > 30 && Math.hypot(out[L - 1][0] - out[L - 31][0], out[L - 1][1] - out[L - 31][1]) < 0.02) break;
            wh.step(1 / 60, 4);
          }
          bd.scootTo(NaN, 0, 0);
          return { fam: bd.family, G, out };
        }, [dx, dz, nm, from]);
        const O = tr.out, dt = 4 / 60;
        let maxMov = 0, slid = NaN, tTurn = NaN, peakRate = 0;
        const movAngs = [], frAngs = [];
        const hd0 = Math.atan2(dx, dz);
        for (let k = 1; k + 1 < O.length; k++) {
          const vx = (O[k + 1][0] - O[k - 1][0]) / (2 * dt), vz = (O[k + 1][1] - O[k - 1][1]) / (2 * dt), sp = Math.hypot(vx, vz);
          const yd = O[k][2], yf = O[k][3];
          const rate = Math.abs(Math.atan2(Math.sin(O[k + 1][2] - O[k - 1][2]), Math.cos(O[k + 1][2] - O[k - 1][2]))) / (2 * dt);
          if (rate > peakRate) peakRate = rate;
          if (sp > 0.03) { const a = angBetween(Math.sin(yd), Math.cos(yd), vx, vz); movAngs.push(a); frAngs.push(angBetween(Math.sin(yf), Math.cos(yf), vx, vz)); if (a > maxMov) maxMov = a; }
          const off = Math.abs(Math.atan2(Math.sin(yd - hd0), Math.cos(yd - hd0)));
          if (O[k][4] === 0 && !(tTurn === tTurn) && off < (20 * Math.PI) / 180) { tTurn = k * dt; slid = Math.hypot(O[k][0] - O[0][0], O[k][1] - O[0][1]); }
        }
        const row = { fam: tr.fam, sp, calm, dir: nm, startYaw: r1(deg(O[0][2])), turnS: r1(tTurn * 10) / 10, movedBeforeFacingM: Math.round(slid * 100) / 100, peakRateDegS: Math.round(deg(peakRate)), movMed: r1(pct(movAngs, 0.5)), mov90: r1(pct(movAngs, 0.9)), movMax: r1(maxMov), frameMed: r1(pct(frAngs, 0.5)), walkS: r1(O.length * dt) };
        log(`${frame} scripted ${JSON.stringify(row)}`);
        if (process.env.FACING_DUMP) log('   series [x, z, drawnYawDeg, turned]', JSON.stringify(O.map((o) => [+o[0].toFixed(3), +o[1].toFixed(3), Math.round(deg(o[2])), o[4]])));
        rows.push(row);
      }
      await page.evaluate(() => window.__WH__.setSetting('calm', false));
      return rows;
    };
    /** --shots: a walk in each of four headings, pictures 0.25 s (the start: has it turned?) and 1.2 s (mid-walk) after the start */
    const shotWalks = async (fam, calm) => {
      await setFam(fam); await step(3);
      await page.evaluate((c) => window.__WH__.setSetting('calm', c), calm);
      for (const [nm, dx, dz] of [['right', 1, 0], ['away', 0, -1], ['left', -1, 0], ['toward', 0, 1]]) {
        await page.evaluate(async ([dx, dz]) => {
          const wh = window.__WH__, w = window.__PW__, bd = w.bodies.find((b) => !b.chunk) ?? w.bodies[0];
          if (!window.__H0__) window.__H0__ = { x: bd.center.x, z: bd.center.z };
          const H = window.__H0__;
          bd.scootTo(H.x - dx * 0.5, H.z - dz * 0.5, 0.3); for (let k = 0; k < 40 && bd.scootOn; k++) wh.step(1 / 60, 12); bd.scootTo(NaN, 0, 0); wh.step(1 / 60, 150);
          const { GAITS } = await import('/src/data/life.ts');
          bd.scootTo(bd.center.x + dx * 1.2, bd.center.z + dz * 1.2, GAITS[bd.family]?.glide ?? 0.2);
          wh.step(1 / 60, 15);
        }, [dx, dz]);
        await shot(`${fam}${calm ? '_calm' : ''}_${nm}_a_start`);
        await page.evaluate(() => window.__WH__.step(1 / 60, 57));
        await shot(`${fam}${calm ? '_calm' : ''}_${nm}_b_mid`);
        await page.evaluate(() => { const w = window.__PW__, bd = w.bodies.find((b) => !b.chunk) ?? w.bodies[0]; bd.scootTo(NaN, 0, 0); window.__WH__.step(1 / 60, 120); });
      }
      await page.evaluate(() => window.__WH__.setSetting('calm', false));
    };

    if (SHOTS) {
      await unquiet();   // (nothing open over the scene: the menu or a sheet)
      await page.evaluate(() => window.__WH__.setSetting('autonomy', false));
      for (const fam of FAMS) { await shotWalks(fam, false); await shotWalks(fam, true); log(frame, 'shots', fam); }
      await page.close(); await ctx.close();
      continue;
    }
    if (SEC.includes('fams')) {
      await page.evaluate(() => window.__WH__.setSetting('autonomy', false));
      // away from the camera, back toward it (from the far spot), right then left (back), and a walk to the right retargeted 90 degrees (away) on its way
      const base = [['away', 0, -1, [0, 0]], ['toward', 0, 1, [0, -1]], ['turn90', 1, 0, [0, 0]]];
      const first = [['away', 0, -1, [0, 0]], ['toward', 0, 1, [0, -1]], ['right', 1, 0, [0, 0]], ['left', -1, 0, [1, 0]], ['turn90', 1, 0, [0, 0]]];
      for (const fam of FAMS) R.scripted.push(...(await scripted(fam, fam === FAMS[0] ? first : base, false)));
      // Calm (the shell's Calm, or prefers-reduced-motion: the same world.calm) for three families
      for (const fam of FAMS.slice(0, 3)) R.scripted.push(...(await scripted(fam, base, true)));
      await page.evaluate(() => window.__WH__.setSetting('autonomy', true));
      await setFam('jellygel'); await step(2);
      save();
    }
    if (SEC.includes('home3') || SEC.includes('surge') || SEC.includes('asked') || SEC.includes('calm') || SEC.includes('places')) {
      // three out: capsules through the meter, then the Friends strip by real input (as browser_float.mjs)
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { window.__WH__.shell.grant(1); });
        for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
        await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
        for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
      }
      await step(1);
      await page.evaluate(() => window.__WH__.resume());
      if ((await page.evaluate(() => window.__WH__.shell.matInfo().count)) > 1) { await tapSel('.mat-chip'); await sleep(600); }
      await tapSel('.pt-btn'); await sleep(500);
      for (let k = 0; k < 3 && (await page.evaluate(() => window.__WH__.shell.matInfo().count)) < 3; k++) { await tapSel('.pt-chip[aria-pressed="false"]:not([data-play])'); await sleep(500); }
      for (let k = 0; k < 3 && (await page.evaluate(() => window.__WH__.shell.matInfo().count)) > 3; k++) { await tapSel('.pt-chip[aria-pressed="true"]:not([data-play])'); await sleep(500); }
      await tapSel('.pt-close'); await sleep(300);
      await page.evaluate(() => window.__WH__.pause());
      await step(2);
      // (LIFE is QUIET while a sheet is open, the tool is not the hand, or input is not live: nobody walks; close what is open)
      await unquiet();
      log(frame, 'out:', await page.evaluate(() => window.__WH__.shell.matInfo().count), JSON.stringify(await page.evaluate(() => { const L = window.__WH__.life(); let tier = null; try { tier = window.__WH__.shell.stageObj().stats().tier; } catch { /* none */ } return { tier, units: L.units, quiet: L.quiet, autonomy: L.autonomy, floatParked: L.floatParked, flags: L.chars.map((c) => c.flags) }; })));
    }
    if (SEC.includes('surge')) {
      // (diagnosis) each body out, autonomy off: a scripted walk 1.2 m along -x then +x; the centre every 0.1 s, the crawl's phase and amplitude
      await page.evaluate(() => window.__WH__.setSetting('autonomy', false));
      await step(3);
      const tr = await page.evaluate(() => {
        const wh = window.__WH__, w = window.__PW__, out = [];
        for (const bd of w.bodies) {
          const C = w.crawls[w.bodies.indexOf(bd)], rows = [];
          for (const dir of [-1, 1]) {
            const x0 = bd.center.x, z0 = bd.center.z;
            bd.scootTo(x0 + dir * 1.2, z0, 0.26);
            for (let k = 0; k < 60; k++) { wh.step(1 / 60, 6); rows.push([+bd.center.x.toFixed(3), +bd.center.z.toFixed(3), +C.s[0].toFixed(2), +C.s[1].toFixed(2), +bd.sV.toFixed(2), bd.family]); }
            bd.scootTo(NaN, 0, 0); wh.step(1 / 60, 120);
          }
          out.push(rows);
        }
        return out;
      });
      for (const rows of tr) { let back = 0; for (let k = 1; k < rows.length; k++) { const dx = rows[k][0] - rows[k - 1][0]; if (k < 60 ? dx > 0.004 : dx < -0.004) back++; } log(frame, 'surge', rows[0][5], 'backward samples', back, '/', rows.length, JSON.stringify(rows.map((r) => [r[0], r[1], r[2], r[3], r[4]]))); }
      await page.evaluate(() => window.__WH__.setSetting('autonomy', true));
    }
    if (SEC.includes('home3')) await obs('home_life', LIFE_S);
    if (SEC.includes('asked')) {
      // "Go play with..." by real input: the party popover, then a thing (asks the addressed squishy: the play squishy), twice (two things, two headings)
      for (let n = 0; n < 2; n++) {
        await page.evaluate(() => window.__WH__.resume());
        let ok = await tapSel('.dock-party');
        if (!ok) ok = await tapSel('.nametag');
        await sleep(400);
        const thing = await page.evaluate((n) => { const b = [...document.querySelectorAll('.pl-pop-thing')]; return b.length ? b[(n * 2) % b.length].dataset.thing : null; }, n);
        if (thing) await tapSel(`.pl-pop-thing[data-thing="${thing}"]`);
        await page.evaluate(() => window.__WH__.pause());
        log(frame, 'asked', thing, JSON.stringify(await page.evaluate(() => window.__liveLog.slice(-1))));
        await obs(`home_asked_${n}`, 14);
      }
    }
    if (SEC.includes('calm')) {
      await page.evaluate(() => window.__WH__.setSetting('calm', true));
      await obs('home_life_calm', LIFE_S);
      await page.evaluate(() => window.__WH__.setSetting('calm', false));
    }
    if (SEC.includes('places')) {
      for (const pl of ['ripple', 'frostbell']) {
        const ok = await page.evaluate((p) => window.__WH__.travel(p, true), pl);
        await page.evaluate(() => window.__WH__.pause());
        await step(4);
        log(frame, 'travel', pl, ok, JSON.stringify(await page.evaluate(() => { const L = window.__WH__.life(); return { place: L.place, n: L.chars.filter((c) => c.kind === 0).length }; })));
        await obs(`${pl}_life`, LIFE_S);
      }
      await page.evaluate(() => window.__WH__.travel('home', true));
      await page.evaluate(() => window.__WH__.pause());
      await step(3);
    }
    if (SEC.includes('float')) {
      await page.evaluate(() => window.__WH__.setSetting('gravity', false));
      await step(3);
      // floaters drift: every body's drawn face vs its drift (any travel over 4 cm/s, LIFE's flags aside), and vs the camera's side (+z)
      const hist = new Map();
      for (let t = 0; t < 15; t += 0.1) {
        const ss = await page.evaluate(() => { window.__WH__.step(1 / 60, 6); return window.__SAMPLE__(); });
        for (const c of ss) { if (!hist.has(c.id)) hist.set(c.id, []); hist.get(c.id).push({ t, ...c }); }
      }
      const fl = [];
      for (const [, h] of hist) {
        const vsT = [], vsCam = [];
        for (let k = 1; k + 1 < h.length; k++) {
          const a = h[k - 1], b = h[k + 1], vx = (b.x - a.x) / 0.2, vz = (b.z - a.z) / 0.2, c = h[k];
          if (!(c.dfx === c.dfx)) continue;
          vsCam.push(angBetween(c.dfx, c.dfz, 0, 1));
          if (Math.hypot(vx, vz) > 0.04) vsT.push(angBetween(c.dfx, c.dfz, vx, vz));
        }
        fl.push({ sp: h[0].sp, driftN: vsT.length, driftMed: r1(pct(vsT, 0.5)), camMed: r1(pct(vsCam, 0.5)), cam90: r1(pct(vsCam, 0.9)) });
      }
      R.float = fl;
      log(`${frame} float: ${JSON.stringify(fl)}`);
      await page.evaluate(() => window.__WH__.setSetting('gravity', true));
      save();
    }
    log(frame, 'errors', errs.length, errs.slice(0, 3).join(' | '));
    await page.close(); await ctx.close();
  }
} finally {
  save();
  await browser.close();
  srv.stop();
}
