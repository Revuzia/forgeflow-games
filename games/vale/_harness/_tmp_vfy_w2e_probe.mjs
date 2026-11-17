// VALE harness - orch1 W2-E round-1 VERIFIER probe (independent). Own frames + HUD measures at 1920x1080 and 1366x768.
//   UX_OUT=<dir> VALE_URL_DEV=http://localhost:<port> python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_w2e_probe.mjs <rift|dead|fray>
// Measures: HUD footprint, pairwise overlap of HUD plates, font families / sizes / tabular nums, cooldown state after a cast,
// click-marker size, damage-number meter over several windows (seed differs from the implementer's), DOM scan via ux_lib.
import { Rec, startQueue, driveFlow, deadline } from './ux_lib.mjs';

const DEV = process.env.VALE_URL_DEV ?? 'http://localhost:5761';
const SEED = process.env.VFY_SEED ?? '23';
const part = process.argv[2] ?? 'rift';
const wait = (p, ms) => p.waitForTimeout(ms);
const homeReady = async (rec) => { await rec.page.waitForFunction(() => !!document.querySelector('.scr--home') && !!window.__vale, null, { timeout: 90000 }); await wait(rec.page, 1200); };
const setScale = (rec, s) => rec.V((v, k) => v.state.match.value?.setTimeScale(k), s);
async function toMatch(rec, mode, queue, tag) {
  await startQueue(rec, mode, queue);
  await driveFlow(rec, tag + '_flow', { maxMs: 300000, cap: 0, paired: false });
  await rec.page.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 60000 });
}
const poll = (rec) => rec.V((v) => {
  const c = v.state.match.value; if (!c) return null; const me = c.view.players[c.you]; const my = c.view.entity(me?.entity);
  let near = 0, enemyNear = 0; if (my) for (const e of c.view.entities) if (e.kind === 'fighter' && e.alive && (e.x - my.x) ** 2 + (e.y - my.y) ** 2 < 100) { near++; if (e.team !== my.team) enemyNear++; }
  return { time: +c.view.time.toFixed(1), dead: (me?.respawnIn ?? 0) > 0, near, enemyNear, ended: !!c.view.result };
});

/** HUD geometry / type facts */
const HUDFACTS = () => {
  const vw = innerWidth, vh = innerHeight;
  const sel = ['.hud__bottom', '.hud__top', '.hud__map', '.hud__side', '.hud__left', '.hud__right', '.dbar', '.recap', '.hourboard', '.hud__feed', '.feed', '.side', '.panels', '.hud__panels'];
  const plates = [];
  for (const s of sel) for (const el of document.querySelectorAll(s)) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') plates.push({ s, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] }); }
  // all direct children of .hud with size, to find anything we did not name
  const kids = [];
  const hud = document.querySelector('.hud');
  if (hud) for (const el of hud.querySelectorAll(':scope > *')) { const r = el.getBoundingClientRect(); if (r.width > 4 && r.height > 4) kids.push({ c: String(el.className).slice(0, 50), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] }); }
  const overl = [];
  const S = kids.filter((k) => (k.r[2] - k.r[0]) < vw - 4 || (k.r[3] - k.r[1]) < vh - 4);
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) { const a = S[i].r, b = S[j].r; const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); if (ox > 2 && oy > 2) overl.push({ a: S[i].c, b: S[j].c, ox, oy }); }
  // fonts on HUD text
  const fam = {}, sizes = {}; let nonTab = []; let small = [];
  if (hud) for (const el of hud.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const f = cs.fontFamily.split(',')[0].replace(/"/g, '').trim(); fam[f] = (fam[f] ?? 0) + 1;
    const fs = Math.round(parseFloat(cs.fontSize)); sizes[fs] = (sizes[fs] ?? 0) + 1;
    const t = el.textContent.trim();
    if (/^[\d\s/:.%+-]+$/.test(t) && /\d/.test(t) && !/tabular-nums/.test(cs.fontVariantNumeric)) nonTab.push(`${String(el.className).slice(0, 30)} "${t.slice(0, 12)}"`);
    if (fs < 11) small.push(`${String(el.className).slice(0, 30)} ${fs}px "${t.slice(0, 16)}"`);
  }
  const bb = document.querySelector('.hud__bottom')?.getBoundingClientRect();
  const db = document.querySelector('.dbar')?.getBoundingClientRect();
  const res = document.querySelector('.resbar')?.getBoundingClientRect();
  const hp = document.querySelector('.hpbar')?.getBoundingClientRect();
  const pip = document.querySelector('[class*="pip"]')?.getBoundingClientRect();
  const area = (r) => (r ? Math.round(r.width * r.height) : 0);
  return { vw, vh, plates, kids, overlaps: overl.slice(0, 20), fonts: fam, sizes, nonTabular: nonTab.slice(0, 12), nonTabularN: nonTab.length, smallText: small.slice(0, 12), smallN: small.length,
    dbar: db ? [Math.round(db.left), Math.round(db.top), Math.round(db.right), Math.round(db.bottom)] : null, dbarAreaPct: db ? +(100 * area(db) / (vw * vh)).toFixed(2) : null, bottomAreaPct: bb ? +(100 * area(bb) / (vw * vh)).toFixed(2) : null,
    resH: res ? +res.height.toFixed(1) : null, hpH: hp ? +hp.height.toFixed(1) : null, resText: document.querySelector('.resbar__num')?.textContent ?? null, hpText: document.querySelector('.hpbar__num')?.textContent ?? null,
    pip: pip ? [+pip.width.toFixed(1), +pip.height.toFixed(1), String(document.querySelector('[class*="pip"]').className).slice(0, 40)] : null };
};
const CD = () => {
  const out = [];
  for (const el of document.querySelectorAll('.aslot, [class*="aslot"]')) {
    if (!/^aslot( |$)/.test(String(el.className))) continue;
    out.push({ c: String(el.className).slice(0, 80), txt: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 30), sweep: !!el.querySelector('[class*="sweep"],[class*="cd"]') });
  }
  return out;
};
const MARKER = () => {
  const out = [];
  for (const el of document.querySelectorAll('[class*="marker"],[class*="click"],[class*="ping"]')) { const r = el.getBoundingClientRect(); if (r.width > 2) out.push({ c: String(el.className).slice(0, 50), w: Math.round(r.width), h: Math.round(r.height) }); }
  return out.slice(0, 10);
};
const METER = (n) => new Promise((resolve) => {
  const out = { frames: 0, popsSeen: 0, overBarFull: 0, overBarSoft: 0, maxPerTarget: 0, plates: typeof globalThis.__valeHudPlates, overFullSamples: [] };
  const seen = new Set(); let k = 0;
  const step = () => {
    const P = globalThis.__valeHudPlates;
    const pops = [...document.querySelectorAll('.wpop:not(.wpop--gold)')];
    const per = new Map();
    for (const el of pops) {
      const r = el.getBoundingClientRect(); const op = +getComputedStyle(el).opacity;
      if (!seen.has(el)) { seen.add(el); out.popsSeen++; }
      const tgt = el.dataset.dst; if (tgt) per.set(tgt, (per.get(tgt) ?? 0) + 1);
      if (P && op > 0.05) for (const q of P.rects()) {
        const ox = Math.min(r.right, q.r) - Math.max(r.left, q.l), oy = Math.min(r.bottom, q.b) - Math.max(r.top, q.t);
        if (ox > 1 && oy > 1) { if (op > 0.99) { out.overBarFull++; if (out.overFullSamples.length < 5) out.overFullSamples.push({ txt: el.textContent, op }); } else out.overBarSoft++; break; }
      }
    }
    for (const c of per.values()) out.maxPerTarget = Math.max(out.maxPerTarget, c);
    out.frames++;
    if (++k < n) requestAnimationFrame(step); else resolve(out);
  };
  requestAnimationFrame(step);
});

async function rift() {
  const rec = new Rec('vfy_rift'); await rec.open(`/?dev=1&autopilot=match&speed=1&seed=${SEED}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 1);
    await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => {});
    await wait(p, 1500);
    rec.step('idle');
    for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`hudfacts idle ${id}`, await p.evaluate(HUDFACTS)); }
    await rec.setVp(1920, 1080);
    await rec.snap2('idle', 'HUD at the fountain');
    await rec.snap2('dial', 'dial bar crop', { clipSel: '.hud__bottom' });
    // click marker at both viewports, shot 60 ms after the click
    rec.step('click');
    await rec.snap2('click', 'right-click marker ~60 ms after', { before: async (pg, id) => { const [w, h] = id.split('x').map(Number); await pg.mouse.click(Math.round(w * 0.66), Math.round(h * 0.4), { button: 'right' }); await pg.waitForTimeout(60); }, settle: 0 });
    rec.obs('marker elements', await p.evaluate(MARKER));
    await setScale(rec, 6);
    const got = new Set(); const t0 = Date.now(); let st; const meters = [];
    while (Date.now() - t0 < 11 * 60 * 1000) {
      await wait(p, 200); st = await poll(rec); if (!st || st.ended) break;
      if (st.enemyNear >= 1 && st.time > 60 && !got.has('fight') && !st.dead) {
        got.add('fight'); await setScale(rec, 1);
        // cast abilities to see cooldowns
        for (const k of ['KeyQ', 'KeyW', 'KeyE']) { await p.keyboard.press(k); await wait(p, 120); }
        meters.push(await p.evaluate(METER, 300));
        rec.obs('cooldown slots after Q/W/E', await p.evaluate(CD));
        await setScale(rec, 0); rec.step('fight'); await rec.snap2('fight', `first fight, paused t=${st.time}`);
        for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`hudfacts fight ${id}`, await p.evaluate(HUDFACTS)); }
        await rec.setVp(1920, 1080);
        await setScale(rec, 6);
      }
      if (st.near >= 4 && st.time > 120 && !got.has('teamfight') && !st.dead) {
        got.add('teamfight'); await setScale(rec, 1); meters.push(await p.evaluate(METER, 300));
        await setScale(rec, 0); rec.step('teamfight'); await rec.snap2('teamfight', `${st.near} fighters within 10 m, paused t=${st.time}`);
        await setScale(rec, 1); await wait(p, 350); await rec.snap2('teamfight_live', 'teamfight live x1'); await setScale(rec, 6);
      }
      if (got.has('fight') && st.enemyNear >= 1 && meters.length < 5 && !st.dead && Math.random() < 0.15) { await setScale(rec, 1); meters.push(await p.evaluate(METER, 240)); await setScale(rec, 6); }
      if (st.dead && !got.has('dead')) { got.add('dead'); await setScale(rec, 1); rec.step('dead'); await wait(p, 300); await rec.snap2('dead_first', 'recap first frames'); await wait(p, 2000); await rec.snap2('dead_settled', 'recap settled'); await setScale(rec, 6); }
      if (st.time > 420 && !got.has('late')) { got.add('late'); await setScale(rec, 0); rec.step('late'); await rec.snap2('late', `HUD at ${st.time}s`); await rec.snap2('scoreboard', 'Tab', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } }); await setScale(rec, 6); }
      if (['fight', 'teamfight', 'late'].every((k) => got.has(k)) && meters.length >= 4) break;
    }
    rec.obs('meters', meters);
    rec.obs('meter totals', meters.reduce((a, m) => ({ frames: a.frames + m.frames, pops: a.pops + m.popsSeen, full: a.full + m.overBarFull, soft: a.soft + m.overBarSoft, maxPer: Math.max(a.maxPer, m.maxPerTarget) }), { frames: 0, pops: 0, full: 0, soft: 0, maxPer: 0 }));
    rec.obs('captured', [...got]); rec.obs('last poll', st);
  } catch (e) { rec.obs('rift failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

async function fray() {
  const rec = new Rec('vfy_fray'); await rec.open(`/?dev=1&autopilot=match&speed=1&seed=${SEED}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await startQueue(rec, 'fray', 'Standard');
    let shot = false;
    await driveFlow(rec, 'fray_flow', { maxMs: 300000, cap: 0, paired: false, until: async (s) => { if (s.scr === 'scr--draft' && !shot) { shot = true; await wait(p, 900); await rec.snap2('draft', 'FRAY draft'); } return false; } });
    await p.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 60000 });
    await setScale(rec, 1);
    await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => {});
    await wait(p, 1500);
    rec.step('hour'); await rec.snap2('idle', 'FRAY HUD');
    for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`hudfacts fray ${id}`, await p.evaluate(HUDFACTS)); }
    await rec.setVp(1920, 1080);
    await rec.snap2('shop', 'shop open', { before: async (pg) => { await pg.keyboard.press('KeyP'); await pg.waitForTimeout(800); }, after: async (pg) => { await pg.keyboard.press('KeyP'); await pg.waitForTimeout(300); } });
  } catch (e) { rec.obs('fray failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

const parts = { rift, fray };
await deadline(part, 25 * 60 * 1000, parts[part]);
process.exit(0);
