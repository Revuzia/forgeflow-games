// VALE harness - orch1 W2-E round-1 VERIFIER probe (independent). Own frames + HUD measures at 1920x1080 and 1366x768.
//   UX_OUT=<dir> VALE_URL_DEV=http://localhost:<port> python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_w2e_probe.mjs <rift|dead|fray>
// Measures: HUD footprint, pairwise overlap of HUD plates, font families / sizes / tabular nums, cooldown state after a cast,
// click-marker size, damage-number meter over several windows (seed differs from the implementer's), DOM scan via ux_lib.
import { Rec, startQueue, driveFlow, deadline } from './ux_lib.mjs';

const DEV = process.env.VALE_URL_DEV ?? 'http://localhost:5761';
const SEED = process.env.VFY_SEED ?? '23';
const part = process.argv[2] ?? 'rift';
const wait = (p, ms) => p.waitForTimeout(ms);
const homeReady0 = async (rec) => { await rec.page.waitForFunction(() => !!document.querySelector('.scr--home') && !!window.__vale, null, { timeout: 90000 }); await wait(rec.page, 1200); };
const homeReady = async (rec) => {
  await homeReady0(rec);
  for (let i = 0; i < 3; i++) {
    const bad = rec.console.some((c) => /504|renderer unavailable|Outdated Optimize/.test(c.type + ' ' + c.text));
    if (!bad) return;
    rec.obs(`warm-up reload ${i + 1}: vite dep optimisation broke the boot; dropped ${rec.console.length} boot lines`, rec.console.slice(0, 6));
    rec.console.length = 0; await wait(rec.page, 4000);
    await rec.page.reload({ waitUntil: 'domcontentloaded' }); await homeReady0(rec);
  }
};
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
  const dbs = document.querySelector('.dbars')?.getBoundingClientRect();
  const hpq = document.querySelector('.hpbar')?.getBoundingClientRect();
  const fit = dbs && res && hpq ? { dbars: [dbs.top, dbs.bottom].map((x) => +x.toFixed(1)), hp: [hpq.top, hpq.bottom].map((x) => +x.toFixed(1)), res: [res.top, res.bottom].map((x) => +x.toFixed(1)), resOverflowPx: +(res.bottom - dbs.bottom).toFixed(1), hpResOverlapPx: +(hpq.bottom - res.top).toFixed(1), dbarBottom: db ? +db.bottom.toFixed(1) : null } : null;
  const rc = document.querySelector('.recap')?.getBoundingClientRect();
  const hp = document.querySelector('.hpbar')?.getBoundingClientRect();
  const pip = document.querySelector('.aslot__pips i')?.getBoundingClientRect();
  const area = (r) => (r ? Math.round(r.width * r.height) : 0);
  return { vw, vh, plates, kids, overlaps: overl.slice(0, 20), fonts: fam, sizes, nonTabular: nonTab.slice(0, 12), nonTabularN: nonTab.length, smallText: small.slice(0, 12), smallN: small.length,
    dbar: db ? [Math.round(db.left), Math.round(db.top), Math.round(db.right), Math.round(db.bottom)] : null, dbarAreaPct: db ? +(100 * area(db) / (vw * vh)).toFixed(2) : null, bottomAreaPct: bb ? +(100 * area(bb) / (vw * vh)).toFixed(2) : null,
    resH: res ? +res.height.toFixed(1) : null, hpH: hp ? +hp.height.toFixed(1) : null, resText: document.querySelector('.resbar__num')?.textContent ?? null, hpText: document.querySelector('.hpbar__num')?.textContent ?? null,
    pip: pip ? [+pip.width.toFixed(1), +pip.height.toFixed(1), 'aslot__pips i'] : null, fit, recap: rc ? [rc.left, rc.top, rc.right, rc.bottom].map(Math.round) : null,
    fontVariants: [...new Set([...document.querySelectorAll('.hpbar__num,.resbar__num,.aslot__cd,.aslot__secs,.hud__top *')].map((e) => getComputedStyle(e).fontVariantNumeric))].slice(0, 6) };
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
  for (const el of document.querySelectorAll('.wmark')) { const r = el.getBoundingClientRect(); if (r.width > 2) out.push({ c: String(el.className).slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), op: +getComputedStyle(el).opacity }); }
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
    const got = new Set(); const t0 = Date.now(); let st; const meters = []; const cds = [];
    while (Date.now() - t0 < 13 * 60 * 1000) {
      await wait(p, 200); st = await poll(rec); if (!st || st.ended) break;
      if (st.enemyNear >= 1 && st.time > 60 && !got.has('fight') && !st.dead) {
        got.add('fight'); await setScale(rec, 1);
        // cast abilities to see cooldowns
        for (const k of ['KeyQ', 'KeyW', 'KeyE']) { await p.keyboard.press(k); await wait(p, 120); }
        meters.push(await p.evaluate(METER, 300));
        rec.obs('cooldown slots after Q/W/E', await p.evaluate(CD)); await rec.snap1('cast_cd', 'dial bar right after Q/W/E (1920)', { clipSel: '.hud__bottom' });
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
      if (st.dead && !got.has('dead')) { got.add('dead'); await setScale(rec, 1); rec.step('dead'); await wait(p, 300); await rec.snap2('dead_first', 'recap first frames'); await wait(p, 2000); await rec.snap2('dead_settled', 'recap settled');
        for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`hudfacts dead ${id}`, await p.evaluate(HUDFACTS)); }
        await rec.setVp(1920, 1080); await setScale(rec, 6); }
      if (st.time > 420 && !got.has('late')) { got.add('late'); await setScale(rec, 0); rec.step('late'); await rec.snap2('late', `HUD at ${st.time}s`); await rec.snap2('scoreboard', 'Tab', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } }); await setScale(rec, 6); }
      if (['fight', 'teamfight', 'late', 'dead'].every((k) => got.has(k)) && meters.length >= 4) break;
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
    await rec.snap2('scoreboard', 'FRAY scoreboard', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } });
    await p.keyboard.press('KeyP'); await wait(p, 900); await rec.snap2('shop', 'shop open');
    for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`shop vs hourboard ${id}`, await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); }; return { shop: r('.shop') ?? r('[class*=shop]'), hour: r('.hourboard') ?? r('[class*=hour]'), dbar: r('.dbar') }; })); }
    await rec.setVp(1920, 1080); await p.keyboard.press('KeyP');
  } catch (e) { rec.obs('fray failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}


async function dead() {
  const rec = new Rec('vfy_dead'); await rec.open(`/?dev=1&autopilot=match&speed=1&seed=${SEED}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 8);
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < 14 * 60 * 1000) {
      await wait(p, 150); st = await poll(rec); if (!st || st.ended) break;
      if (st.dead) {
        await setScale(rec, 1); rec.step('dead');
        // first frames: shoot at 1366 first (the tight viewport), then 1920
        await rec.setVp(1366, 768); await wait(p, 250); await rec.snap1('dead_first', `recap first frames t=${st.time}`); rec.obs('hudfacts dead_first 1366x768', await p.evaluate(HUDFACTS));
        await rec.setVp(1920, 1080); await rec.snap1('dead_first', 'recap first frames'); rec.obs('hudfacts dead_first 1920x1080', await p.evaluate(HUDFACTS));
        await wait(p, 2200); await rec.snap2('dead_settled', 'recap settled ~2.7 s after');
        for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`hudfacts dead_settled ${id}`, await p.evaluate(HUDFACTS)); }
        await rec.setVp(1920, 1080);
        if (await p.evaluate(() => !!document.querySelector('.recap__more'))) { await p.locator('.recap__more').click().catch(() => {}); await wait(p, 300); await rec.snap2('dead_expanded', 'recap +N more expanded'); for (const [id, w, h] of rec.vps) { await rec.setVp(w, h); rec.obs(`hudfacts dead_expanded ${id}`, await p.evaluate(HUDFACTS)); } }
        else rec.obs('no recap__more toggle (<=3 sources)');
        break;
      }
    }
    rec.obs('last poll', st);
  } catch (e) { rec.obs('dead failed: ' + String(e).slice(0, 240)); await rec.snap1('FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}


async function pops() {
  const rec = new Rec('vfy_pops'); await rec.open(`/?dev=1&autopilot=match&speed=1&seed=${SEED}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 6);
    const t0 = Date.now(); let st; const shots = { '1920x1080': 0, '1366x768': 0 }; const facts = [];
    while (Date.now() - t0 < 9 * 60 * 1000) {
      await wait(p, 150); st = await poll(rec); if (!st || st.ended) break;
      if (st.enemyNear >= 1 && st.time > 60 && !st.dead) {
        await setScale(rec, 1);
        for (const vp of ['1920x1080', '1366x768']) {
          if (shots[vp] >= 2) continue;
          const [w, h] = vp.split('x').map(Number); await rec.setVp(w, h);
          const ok = await p.waitForFunction(() => [...document.querySelectorAll('.wpop:not(.wpop--gold)')].some((e) => +getComputedStyle(e).opacity > 0.6), null, { timeout: 4000, polling: 16 }).then(() => true).catch(() => false);
          if (!ok) continue;
          await setScale(rec, 0);
          const f = await p.evaluate(() => { const P = globalThis.__valeHudPlates; return [...document.querySelectorAll('.wpop:not(.wpop--gold)')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); let hit = null; if (P) for (const q of P.rects()) { const ox = Math.min(r.right, q.r) - Math.max(r.left, q.l), oy = Math.min(r.bottom, q.b) - Math.max(r.top, q.t); if (ox > 1 && oy > 1) { hit = [ox, oy].map(Math.round); break; } } return { t: e.textContent, cls: String(e.className).slice(0, 40), op: +(+cs.opacity).toFixed(2), fs: cs.fontSize, color: cs.color, r: [r.left, r.top, r.right, r.bottom].map(Math.round), hit }; }); });
          facts.push({ vp, f });
          const c = f.find((x) => x.op > 0.6) ?? f[0];
          const cx = Math.max(0, Math.min(w - 480, (c.r[0] + c.r[2]) / 2 - 240)), cy = Math.max(0, Math.min(h - 300, (c.r[1] + c.r[3]) / 2 - 150));
          await rec.snap1('pop_full', `damage number visible at ${vp}, sim paused`);
          await rec.snap1('pop_crop', `crop around a damage number at ${vp}`, { clip: { x: cx, y: cy, width: 480, height: 300 } });
          shots[vp]++; await setScale(rec, 1);
        }
        await rec.setVp(1920, 1080); await setScale(rec, 6);
        if (shots['1920x1080'] >= 2 && shots['1366x768'] >= 2) break;
      }
    }
    rec.obs('pop facts', facts); rec.obs('last poll', st);
  } catch (e) { rec.obs('pops failed: ' + String(e).slice(0, 240)); }
  await rec.finish();
}


async function misc() {
  const rec = new Rec('vfy_misc'); await rec.open(`/?dev=1&welcome=1&seed=${SEED}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    rec.step('name');
    const got = await p.waitForFunction(() => /call you/i.test(document.body.innerText), null, { timeout: 15000 }).then(() => true).catch(() => false);
    rec.obs('name prompt appeared', got);
    if (got) { await wait(p, 600); await rec.snap2('name_prompt', 'one-time name prompt (?welcome=1, fresh profile)'); await p.keyboard.press('Escape').catch(() => {}); await wait(p, 400); }
    await rec.goto(`/?dev=1&autopilot=match&speed=1&seed=${SEED}`); await homeReady(rec);
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 1);
    await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => {});
    await wait(p, 1500);
    rec.step('ping');
    await rec.snap2('ping_wheel', 'ping wheel (G held 0.6 s)', { before: async (pg, id) => { const [w, h] = id.split('x').map(Number); await pg.mouse.move(Math.round(w * 0.5), Math.round(h * 0.45)); await pg.keyboard.down('KeyG'); await pg.waitForTimeout(600); await pg.mouse.move(Math.round(w * 0.5) + 70, Math.round(h * 0.45) - 30); await pg.waitForTimeout(150); }, after: async (pg) => { await pg.keyboard.up('KeyG'); await pg.waitForTimeout(300); } });
    rec.step('click');
    for (const [id, w, h] of rec.vps) {
      await rec.setVp(w, h);
      await p.mouse.click(Math.round(w * 0.62), Math.round(h * 0.42), { button: 'right' });
      const m = await p.evaluate(() => [...document.querySelectorAll('.wmark')].map((e) => { const r = e.getBoundingClientRect(); return { c: String(e.className), w: Math.round(r.width), h: Math.round(r.height), op: +getComputedStyle(e).opacity }; }));
      rec.obs(`marker ${id}`, m);
      await rec.snap1('click_marker', `right-click marker at ${id}, shot as the click returns`, { clip: { x: Math.round(w * 0.62) - 160, y: Math.round(h * 0.42) - 110, width: 320, height: 220 } });
    }
  } catch (e) { rec.obs('misc failed: ' + String(e).slice(0, 240)); }
  await rec.finish();
}


async function post() {
  const rec = new Rec('vfy_post'); await rec.open(`/?dev=1&autopilot=match&speed=1&seed=${SEED}`, { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 16);
    const t0 = Date.now();
    while (Date.now() - t0 < 12 * 60 * 1000) { await wait(p, 500); const st = await poll(rec); if (!st || st.ended) break; }
    await p.waitForFunction(() => !!document.querySelector('.scr--postgame'), null, { timeout: 90000 }).catch(() => rec.obs('postgame never appeared'));
    await wait(p, 2200); rec.step('post');
    await rec.snap2('postgame', 'postgame default tab');
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.scr--postgame [role=tab]')].map((t) => (t.innerText || '').trim()));
    for (const l of tabs) { try { await p.locator('.scr--postgame [role=tab]', { hasText: l }).first().click({ timeout: 3000 }); await wait(p, 700); await rec.snap2('post_' + l.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 16), `postgame tab ${l}`); } catch { /* none */ } }
  } catch (e) { rec.obs('post failed: ' + String(e).slice(0, 240)); }
  await rec.finish();
}

const parts = { rift, fray, dead, pops, misc, post };
await deadline(part, 25 * 60 * 1000, parts[part]);
process.exit(0);
