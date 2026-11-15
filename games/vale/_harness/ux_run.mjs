// VALE harness — UX evidence collector runner (orch1 evidence/ux). One part per run, each holds one heavy slot:
//   VALE_URL_PROD=http://localhost:5231 VALE_URL_DEV=http://localhost:5232 \
//   python3 art/blender/common/heavy.py run -- node _harness/ux_run.mjs <part> [--vp 1920x1080]
// parts: cold (prod build, fresh profile, per viewport) | menus | draft | hud | hud2 | practice | post
// Collects and measures only. The game code is never changed.
import { Rec, VPS, OUT, gotoNav, startQueue, driveFlow, deadline, load1, NAV } from './ux_lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROD = process.env.VALE_URL_PROD ?? 'http://localhost:5231';
const DEV = process.env.VALE_URL_DEV ?? 'http://localhost:5232';
const part = process.argv[2];
const vpArg = process.argv.includes('--vp') ? process.argv[process.argv.indexOf('--vp') + 1] : null;
const wait = (p, ms) => p.waitForTimeout(ms);
const scrollBottom = async (p) => p.evaluate(() => {
  const act = [...document.querySelectorAll('.scr')].find((e) => !e.classList.contains('is-leaving')) ?? document.body;
  let best = null;
  for (const el of act.querySelectorAll('*')) { const s = getComputedStyle(el); if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 80 && (!best || el.scrollHeight - el.clientHeight > best.scrollHeight - best.clientHeight)) best = el; }
  if (best) { best.scrollTop = best.scrollHeight; return { el: best.className.toString().slice(0, 50), more: best.scrollHeight - best.clientHeight }; }
  return null;
});
const scrollTop = (p) => p.evaluate(() => { for (const el of document.querySelectorAll('.scr *')) if (el.scrollTop > 0) el.scrollTop = 0; });

/** snap a screen at both viewports, then (when it scrolls) its bottom */
async function shotScreen(rec, name, desc) {
  rec.step(name);
  await rec.snap2(name, desc);
  const sc = await scrollBottom(rec.page); await scrollTop(rec.page);
  if (sc) { await rec.snap2(`${name}_scrolled`, `${desc} (scrolled to the bottom of ${sc.el}; ${sc.more}px of extra content at 1920x1080)`, { before: async (p) => { await scrollBottom(p); } }); await scrollTop(rec.page); }
}
/** every tab of the current screen */
async function tabTour(rec, name) {
  const p = rec.page;
  const labels = await p.evaluate(() => [...document.querySelectorAll('.scr:not(.is-leaving) [role=tab]')].map((t) => (t.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean));
  rec.obs(`${name} tabs`, labels);
  for (const l of labels) {
    try {
      await p.locator('.scr:not(.is-leaving) [role=tab]', { hasText: l }).first().click({ timeout: 4000 });
      await wait(p, 650);
      await shotScreen(rec, `${name}_tab_${l.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`, `${name} screen, tab "${l}"`);
    } catch (e) { rec.obs(`tab "${l}" of ${name} failed: ${String(e).slice(0, 100)}`); }
  }
  return labels;
}
async function homeReady(rec, ms = 60000) { await rec.page.waitForFunction(() => !!document.querySelector('.scr--home') && !!window.__vale, null, { timeout: ms }); await wait(rec.page, 1200); }
const seedLevel = async (rec, level) => {
  await rec.page.evaluate((lv) => { const k = 'vale.profile.v1'; const raw = localStorage.getItem(k); if (!raw) return; const p = JSON.parse(raw); p.level = lv; localStorage.setItem(k, JSON.stringify(p)); }, level);
  await rec.page.reload({ waitUntil: 'domcontentloaded' }); await homeReady(rec);
};

// ═══ COLD: prod build, fresh context, first-run to first match frame ═══════════════════════════════
async function cold() {
  const vp = (vpArg ?? '1920x1080').split('x').map(Number);
  const rec = new Rec(`cold${vp[0]}`, { vps: [[`${vp[0]}x${vp[1]}`, vp[0], vp[1]]] });
  await rec.open(null, { base: PROD, width: vp[0], height: vp[1] });
  const p = rec.page; const T = rec.timings;
  rec.step('boot'); T.load1_start = load1();
  const navStart = Date.now();
  const nav = p.goto(PROD + '/', { waitUntil: 'commit' });
  await nav;
  T.t_commit_ms = Date.now() - navStart;
  let i = 0;
  while (i < 16) {
    const hasHome = await p.evaluate(() => !!document.querySelector('.scr--home')).catch(() => false);
    if (hasHome) break;
    await rec.snap1(`boot_${String(++i).padStart(2, '0')}`, `cold load, ${Date.now() - navStart} ms after navigation commit`);
    await wait(p, 120);
  }
  await p.waitForFunction(() => !!document.querySelector('.scr--home'), null, { timeout: 90000 });
  const nodeHome = Date.now() - navStart;
  const m1 = await rec.marks();
  T.cold = { nodeSideToHomeMs: nodeHome, marks: m1, resourcesAtHome: await rec.resources() };
  T.cold.frameStatsToHome = await rec.frameStats(0, m1.home_screen ?? m1.now);
  rec.step('home'); await wait(p, 600);
  await rec.snap1('home_first_paint', 'Home just after it appears on a cold load (fresh profile, empty cache)');
  const inv = await p.evaluate(() => ({ dialogs: document.querySelectorAll('[role=dialog],[role=alertdialog],.modal').length, toasts: document.querySelectorAll('.toast').length, nav: [...document.querySelectorAll('.nav__item')].map((e) => e.innerText.trim()), buttons: [...document.querySelectorAll('.scr--home button, .scr--home a')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)), canvases: document.querySelectorAll('canvas').length, fonts: [...document.fonts].filter((f) => f.status === 'loaded').length + '/' + document.fonts.size, title: document.title, lang: document.documentElement.lang, storage: Object.keys(localStorage) }));
  rec.obs('home inventory on first load', inv);
  await wait(p, 4500);
  rec.step('home_settled'); await rec.snap1('home_settled', 'Home 5 s after first paint (after the first-run video calibration window)');
  const m2 = await rec.marks(); T.cold.marksSettled = m2; T.cold.frameStatsHomeIdle5s = await rec.frameStats(m1.home_screen ?? 0, m2.now);
  rec.obs('video settings after first-run calibration', await p.evaluate(() => { try { const pr = JSON.parse(localStorage.getItem('vale.profile.v1')); return pr?.settings?.video ?? null; } catch { return null; } }));
  // warm reload
  const t1 = Date.now(); await p.reload({ waitUntil: 'commit' }); await p.waitForFunction(() => !!document.querySelector('.scr--home'), null, { timeout: 60000 });
  const mw = await rec.marks(); T.warm = { nodeSideToHomeMs: Date.now() - t1, marks: mw, resources: await rec.resources(), loadAvg: load1() };
  await wait(p, 1500);
  // first-run flow: Play -> RIFT -> Lantern Drill -> Find match
  rec.step('first_flow');
  const tPlay = Date.now(); await gotoNav(rec, 'Play'); T.t_play_click_to_screen_ms = Date.now() - tPlay;
  await rec.snap1('play_first_visit', 'Play on first visit (fresh profile, default selection)');
  const pre = await p.evaluate(() => ({ modes: [...document.querySelectorAll('.station')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')), queues: [...document.querySelectorAll('.qcard')].map((e) => e.innerText.trim().replace(/\s+/g, ' ').slice(0, 90)) }));
  rec.obs('Play: stations and queue cards on first visit', pre);
  await rec.click(p.locator('.station', { hasText: /RIFT/i }).first()); await wait(p, 500);
  await rec.click(p.locator('.qcard', { hasText: 'Lantern Drill' }).first()); await wait(p, 300);
  await rec.snap1('play_rift_coop', 'Play: RIFT, Lantern Drill (co-op) selected');
  const tFind = Date.now(); const mFind = await rec.marks();
  await rec.click(p.getByRole('button', { name: 'Find match' }));
  rec.step('flow');
  const flow = await driveFlow(rec, 'cold_flow', { maxMs: 240000, cap: 28, paired: false });
  const mHud = await rec.marks();
  T.match = { findClickToHudNodeMs: Date.now() - tFind, flowLoopMs: flow.ms, findClickAtPageMs: mFind.now, marks: mHud, hudMinusFindClickMs: mHud.hud ? mHud.hud - mFind.now : null, hud2rafMinusFindClickMs: mHud.hud_2raf ? mHud.hud_2raf - mFind.now : null,
    stageMsFromFind: { queue: mHud.queue ? mHud.queue - mFind.now : null, draft: mHud.draft ? mHud.draft - mFind.now : null, loading: mHud.loading ? mHud.loading - mFind.now : null, hud: mHud.hud ? mHud.hud - mFind.now : null } };
  T.match.resources = await rec.resources();
  if (!mHud.hud) rec.obs('HUD did not appear within the flow window');
  // first match frames
  rec.step('first_match');
  const hudAt = mHud.hud ?? (await rec.marks()).now;
  await rec.snap1('first_match_frame_0', 'first frame with the HUD in the DOM (prod, fresh profile, no autopilot)');
  await wait(p, 2500); await rec.snap1('first_match_frame_3s', '3 s after the HUD appeared');
  T.match.frameStatsFirst5s = null;
  await wait(p, 5000);
  await rec.snap1('first_match_hint_1', '8 s into the match: first-match hint lines (if any)');
  await wait(p, 8000); await rec.snap1('first_match_hint_2', '16 s into the match');
  await wait(p, 8000); await rec.snap1('first_match_hint_3', '24 s into the match');
  await wait(p, 8000); await rec.snap1('first_match_hint_4', '32 s into the match');
  const hudHints = await p.evaluate(() => [...document.querySelectorAll('.feed *, .hud__bl *')].filter((e) => !e.children.length && (e.innerText || '').trim()).map((e) => e.innerText.trim()).slice(0, 12));
  rec.obs('hud feed/hint text lines at 32 s', hudHints);
  // real input: right-click move, ability key, hover ability slot
  rec.step('first_match_input');
  await p.mouse.move(vp[0] * 0.62, vp[1] * 0.42); await p.mouse.click(vp[0] * 0.62, vp[1] * 0.42, { button: 'right' }); await wait(p, 1200);
  await rec.snap1('first_match_after_move_click', 'after one right-click on the ground');
  const slot = p.locator('.aslot__wrap').first();
  if (await slot.count()) { await slot.hover(); await wait(p, 700); await rec.snap1('first_match_ability_tooltip', 'hovering the first ability slot', {}); }
  const tip = await p.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 300)));
  rec.obs('tooltip text on ability hover', tip);
  await p.mouse.move(vp[0] * 0.5, vp[1] * 0.4); await p.keyboard.press('KeyQ'); await wait(p, 500);
  await rec.snap1('first_match_after_Q', 'after pressing Q with the cursor on the ground');
  await p.keyboard.press('Escape'); await wait(p, 700); await rec.snap1('first_match_esc_menu', 'Esc in the match: the in-match menu');
  T.match.frameStatsMatch = await rec.frameStats(hudAt, (await rec.marks()).now);
  T.loadAvgEnd = load1();
  await rec.finish({ cold: true });
}

// ═══ MENUS: every screen, tab, dialog ═══════════════════════════════════════════════════════════════
async function menus() {
  const rec = new Rec('menus'); await rec.open('/?dev=1&seed=7', { base: DEV });
  const p = rec.page; rec.step('home'); await homeReady(rec);
  await shotScreen(rec, 'home', 'Home screen');
  rec.obs('home buttons', await p.evaluate(() => [...document.querySelectorAll('.scr--home button, .scr--home a')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50))));
  // nav bar facts
  rec.obs('top bar', await p.evaluate(() => { const n = document.querySelector('.nav'); return n ? { text: n.innerText.replace(/\s+/g, ' ').slice(0, 200), rect: (({ x, y, width, height }) => [x, y, width, height].map(Math.round))(n.getBoundingClientRect()) } : null; }));
  // Play: each mode, each queue card
  await gotoNav(rec, 'Play'); await shotScreen(rec, 'play', 'Play screen default selection');
  const modes = await p.evaluate(() => [...document.querySelectorAll('.station')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')));
  rec.obs('mode stations', modes);
  for (const [mi, ml] of modes.entries()) {
    const mode = ml.split(' ')[0];
    try {
      await p.locator('.station').nth(mi).click({ timeout: 4000 }); await wait(p, 900);
      await rec.snap2(`play_${mode.toLowerCase()}`, `Play, mode ${ml}`);
      const qn = await p.locator('.qcard').count();
      for (let q = 0; q < qn; q++) {
        const t = (await p.locator('.qcard').nth(q).innerText()).trim().split('\n')[0];
        await p.locator('.qcard').nth(q).click({ timeout: 4000 }).catch(() => {}); await wait(p, 600);
        rec.step(`play_${mode}_q${q}`);
        await rec.snap2(`play_${mode.toLowerCase()}_q${q}_${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 14)}`, `Play, ${ml}, queue card ${q} "${t}" selected`);
      }
    } catch (e) { rec.obs(`play mode ${ml} failed: ${String(e).slice(0, 100)}`); }
  }
  // custom + practice screens
  for (const kind of ['custom', 'practice']) {
    try { await gotoNav(rec, 'Play'); await p.locator('.station').first().click(); await wait(p, 500); await p.locator('button', { hasText: new RegExp(kind === 'custom' ? 'Custom' : 'Practice', 'i') }).first().click({ timeout: 4000 }); await wait(p, 900); await shotScreen(rec, kind, `${kind} screen reached from the Play quiet link`); }
    catch (e) { rec.obs(`${kind} link failed: ${String(e).slice(0, 100)}`); try { await rec.V((v) => v.router.go(v.screens.includes('x') ? 'x' : arguments[0] ?? 'custom')); } catch { /* none */ } }
  }
  // Collection
  await gotoNav(rec, 'Collection'); await shotScreen(rec, 'collection', 'Collection');
  await tabTour(rec, 'collection');
  try {
    await p.locator('.nav__item', { hasText: 'Collection' }).click(); await wait(p, 700);
    const first = p.locator('.scr--collection .fcard').first(); if (await first.count()) { await first.click({ timeout: 4000 }); await wait(p, 1000); await shotScreen(rec, 'fighter_detail', 'a fighter detail screen from Collection'); await tabTour(rec, 'fighter_detail'); }
    else rec.obs('no .fcard in the collection');
  } catch (e) { rec.obs('fighter detail failed: ' + String(e).slice(0, 100)); }
  // Loadout
  try {
    const id = await rec.V((v) => v.cv.playable()[0]?.id);
    await rec.V((v, f) => v.router.go('loadout', { fighter: f }), id); await wait(p, 1200); await shotScreen(rec, 'loadout', `Loadout for ${id}`); await tabTour(rec, 'loadout');
  } catch (e) { rec.obs('loadout failed: ' + String(e).slice(0, 100)); }
  // Shop
  await gotoNav(rec, 'Shop'); await shotScreen(rec, 'shop', 'Shop'); await tabTour(rec, 'shop');
  try { const tile = p.locator('.scr--shop button[aria-pressed], .scr--shop .offer, .scr--shop [class*=tile]').first(); if (await tile.count()) { await tile.click({ timeout: 3000 }); await wait(p, 900); await rec.snap2('shop_item_selected', 'Shop with the first offer selected'); } } catch (e) { rec.obs('shop select failed ' + String(e).slice(0, 80)); }
  // Profile
  await gotoNav(rec, 'Profile'); await shotScreen(rec, 'profile', 'Profile'); await tabTour(rec, 'profile');
  // Settings
  await gotoNav(rec, 'Settings'); await shotScreen(rec, 'settings', 'Settings default tab'); await tabTour(rec, 'settings');
  try {
    await p.locator('.scr--settings [role=tab]', { hasText: /Video/i }).first().click(); await wait(p, 500);
    await p.getByRole('button', { name: /Reset this tab/i }).first().click({ timeout: 3000 }); await wait(p, 800); await rec.snap2('settings_reset_confirm', 'Settings: Reset this tab confirm dialog'); await p.keyboard.press('Escape'); await wait(p, 500);
  } catch (e) { rec.obs('reset dialog failed ' + String(e).slice(0, 80)); }
  try {
    await p.locator('.scr--settings [role=tab]', { hasText: /Controls/i }).first().click(); await wait(p, 600);
    const kb = p.locator('.scr--settings .keycap, .scr--settings [class*=keybind], .scr--settings button[class*=bind]').first();
    if (await kb.count()) { await kb.click({ timeout: 3000 }); await wait(p, 500); await rec.snap2('settings_controls_rebind_listening', 'Settings > Controls: a keybind awaiting a key'); await p.keyboard.press('Escape'); }
  } catch (e) { rec.obs('rebind failed ' + String(e).slice(0, 80)); }
  // nav hover tooltips + wallet
  try { await NAV(p, 'Shop').hover(); await wait(p, 600); await rec.snap2('nav_hover_shop', 'hovering a nav item'); } catch { /* none */ }
  // routes without chrome: queue screen alone
  await gotoNav(rec, 'Home');
  await rec.finish();
}

// ═══ DRAFT: every mode's queue → ready check → draft/ban → loading → first frame ═════════════════════
async function draft() {
  const rec = new Rec('draft'); await rec.open('/?dev=1&seed=7', { base: DEV });
  const p = rec.page; await homeReady(rec);
  await seedLevel(rec, 25); rec.obs('profile seeded to level 25 so every queue is unlocked (the fresh-profile lock states are in the menus phase)');
  const queues = [['rift', 'Quick'], ['rift', 'Draft'], ['rift', 'Ranked'], ['rift', 'Lantern Drill'], ['bridge', 'Standard'], ['fray', 'Standard']];
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const T = rec.timings.queues = {};
  for (const [mode, q] of queues) {
    const key = `${mode}_${q.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (only && !key.includes(only)) continue;
    try {
      await p.goto(DEV + '/?dev=1&seed=7', { waitUntil: 'domcontentloaded' }); await homeReady(rec);
      rec.step(`${key}_select`);
      const t0 = Date.now();
      await startQueue(rec, mode, q, { snapPlay: `${key}_play` });
      const flow = await driveFlow(rec, key, { maxMs: 300000, cap: 34, paired: true });
      const m = await rec.marks();
      T[key] = { flowMs: flow.ms, totalMs: Date.now() - t0, marks: m, reachedHud: !!m.hud };
      rec.step(`${key}_first_frame`);
      if (m.hud) { await wait(p, 1500); await rec.snap2(`${key}_first_match_frame`, `${key}: first HUD frame of the match`); }
      else rec.obs(`${key}: the HUD never appeared within the flow window`);
      await rec.V((v) => { try { v.state.match.value?.leave(); } catch { /* none */ } });
    } catch (e) { rec.obs(`${key} flow failed: ${String(e).slice(0, 160)}`); await rec.snap1(`${key}_FAILED_state`, `state when the ${key} flow failed`).catch(() => {}); }
  }
  // custom game
  try {
    await p.goto(DEV + '/?dev=1&seed=7', { waitUntil: 'domcontentloaded' }); await homeReady(rec);
    rec.step('custom_flow');
    await rec.V((v) => v.router.go('custom')); await wait(p, 1000);
    await rec.snap2('custom_lobby', 'custom game screen (level 25 profile)');
    const start = p.locator('.scr--custom .scr__foot button').last();
    const lbl = await start.innerText().catch(() => '?'); rec.obs('custom CTA label', lbl);
    await start.click({ timeout: 4000 });
    const flow = await driveFlow(rec, 'custom', { maxMs: 300000, cap: 30, paired: true });
    rec.timings.custom = { flowMs: flow.ms, marks: await rec.marks() };
    await rec.V((v) => { try { v.state.match.value?.leave(); } catch { /* none */ } });
  } catch (e) { rec.obs('custom flow failed: ' + String(e).slice(0, 160)); }
  await rec.finish();
}

// ═══ HUD helpers ════════════════════════════════════════════════════════════════════════════════════
async function installWatch(rec) {
  await rec.V((v) => {
    const c = v.state.match.value; const w = (window.__uxw = { ev: [], flags: {} });
    const me = () => c.view.players[c.you];
    c.onEvents((evs) => {
      const my = me()?.entity;
      for (const e of evs) {
        if (e.e === 'levelUp' && e.player === c.you) w.ev.push({ e: 'levelUp', level: e.level, t: e.t });
        else if (e.e === 'death' && e.dst === my) w.ev.push({ e: 'died', t: e.t });
        else if (e.e === 'takedown' && (e.killer === c.you || e.victim === c.you)) w.ev.push({ e: 'takedown', t: e.t, mine: e.killer === c.you ? 'kill' : 'death' });
        else if (e.e === 'damage' && (e.src === my || e.dst === my)) { const o = c.view.entity(e.src === my ? e.dst : e.src); w.ev.push({ e: 'dmg', t: e.t, other: o?.kind, dir: e.src === my ? 'out' : 'in' }); }
        else if (e.e === 'buy' && e.player === c.you) w.ev.push({ e: 'buy', item: e.item, t: e.t });
        if (w.ev.length > 400) w.ev.splice(0, 200);
      }
    });
  });
}
const poll = (rec) => rec.V((v) => {
  const c = v.state.match.value; if (!c) return null; const w = window.__uxw; const me = c.view.players[c.you]; const my = c.view.entity(me?.entity);
  let nearFighters = 0; if (my) for (const e of c.view.entities) if (e.kind === 'fighter' && e.alive && (e.x - my.x) ** 2 + (e.y - my.y) ** 2 < 100) nearFighters++;
  const evs = w.ev.splice(0);
  return { phase: c.view.phase, time: +c.view.time.toFixed(1), scale: c.timeScale, level: me?.level ?? my?.level, dead: (me?.respawnIn ?? 0) > 0, respawnIn: me?.respawnIn, gold: me?.gold, items: me?.items.filter(Boolean).length ?? 0, skill: me?.skillPoints, nearFighters, ended: !!c.view.result, evs };
});
const setScale = (rec, s) => rec.V((v, k) => v.state.match.value?.setTimeScale(k), s);

async function toMatch(rec, mode, queue, tag) {
  const p = rec.page;
  await startQueue(rec, mode, queue);
  const flow = await driveFlow(rec, tag + '_flow', { maxMs: 300000, cap: 12, paired: false });
  rec.obs(`${tag}: flow to HUD took ${flow.ms} ms`);
  await p.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 60000 });
  await installWatch(rec);
}

// ═══ HUD: RIFT autopilot match ══════════════════════════════════════════════════════════════════════
async function hud() {
  const rec = new Rec('hud'); await rec.open('/?dev=1&autopilot=match&speed=1&seed=7', { base: DEV });
  const p = rec.page; await homeReady(rec);
  await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
  rec.step('pregame');
  await setScale(rec, 1);
  let st = await poll(rec); rec.obs('first poll after HUD', st);
  await rec.snap2('hud_first_frame', `HUD at the first frame (sim phase ${st?.phase}, time ${st?.time})`);
  await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => rec.obs('never reached live'));
  await wait(p, 1500);
  rec.step('idle_live'); await rec.snap2('hud_idle_live', 'HUD, match live, standing at the fountain');
  // shop: open, suggested, search, tooltip, detail
  rec.step('shop');
  await p.mouse.move(960, 540); await p.keyboard.press('KeyP'); await wait(p, 900);
  await rec.snap2('hud_shop_open', 'shop open (P) at the fountain, default view with the suggested section');
  const shopFacts = await p.evaluate(() => ({ sections: [...document.querySelectorAll('.lshop__sech')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')), tags: [...document.querySelectorAll('.lshop__tag')].map((e) => e.innerText.trim()), tiles: document.querySelectorAll('.istile').length, gold: document.querySelector('.lshop__gold')?.innerText?.trim(), access: document.querySelector('.lshop__access')?.innerText?.trim() ?? null }));
  rec.obs('shop facts', shopFacts);
  try {
    const inp = p.locator('.lshop__search input').first(); await inp.click({ timeout: 3000 }); await p.keyboard.type('blade', { delay: 40 }); await wait(p, 600);
    await rec.snap2('hud_shop_search_blade', 'shop search "blade"', { before: async (pg) => { const i = pg.locator('.lshop__search input').first(); await i.fill('blade').catch(() => {}); } });
    rec.obs('search "blade" tiles', await p.evaluate(() => document.querySelectorAll('.istile').length));
    await inp.fill('zzzz'); await wait(p, 500); await rec.snap2('hud_shop_search_empty', 'shop search with no match ("zzzz")', { before: async (pg) => { await pg.locator('.lshop__search input').first().fill('zzzz'); } });
    await inp.fill(''); await wait(p, 400);
  } catch (e) { rec.obs('shop search failed: ' + String(e).slice(0, 120)); }
  try {
    const tile = p.locator('.istile').first(); await tile.hover(); await wait(p, 700);
    await rec.snap2('hud_shop_item_hover', 'shop: hovering the first item tile', { before: async (pg) => { await pg.locator('.istile').first().hover(); } });
    await tile.click(); await wait(p, 600); await rec.snap2('hud_shop_item_selected', 'shop: first item selected, detail panel');
    const tags = p.locator('.lshop__tag'); const tn = await tags.count();
    for (let i = 1; i < Math.min(tn, 4); i++) { await tags.nth(i).click(); await wait(p, 400); await rec.snap2(`hud_shop_tag_${i}`, `shop filter tag ${i}`, { before: async (pg) => { await pg.locator('.lshop__tag').nth(i).click(); } }); }
    await tags.first().click();
  } catch (e) { rec.obs('shop tile failed: ' + String(e).slice(0, 120)); }
  await p.keyboard.press('KeyP'); await wait(p, 600);
  // ability / item / stat tooltips
  rec.step('tooltips');
  const slots = p.locator('.aslot__wrap'); const sn = await slots.count(); rec.obs('ability slot count', sn);
  for (let i = 0; i < Math.min(sn, 4); i++) {
    const nm = ['a1', 'a2', 'a3', 'ult'][i];
    await rec.snap2(`hud_tip_ability_${nm}`, `tooltip on ability slot ${i}`, { before: async (pg) => { await pg.locator('.aslot__wrap').nth(i).hover(); await pg.waitForTimeout(500); } });
  }
  rec.obs('ability tooltip DOM (last)', await p.evaluate(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 400))));
  await rec.snap2('hud_tip_hp', 'tooltip on the health bar', { before: async (pg) => { const b = pg.locator('.dbars, [class*=hpbar], .dbar__frame').first(); await b.hover({ position: { x: 20, y: 8 } }).catch(() => {}); await pg.waitForTimeout(500); } });
  try { await p.locator('.dport__stats').first().click(); await wait(p, 700); await rec.snap2('hud_stats_ledger', 'the stats ledger opened from the portrait'); await p.locator('.dport__stats').first().click(); } catch (e) { rec.obs('stats ledger failed: ' + String(e).slice(0, 100)); }
  await p.mouse.move(960, 400);
  // scoreboard (held Tab)
  rec.step('scoreboard');
  await rec.snap2('hud_scoreboard', 'scoreboard held (Tab)', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); await pg.waitForTimeout(250); } });
  // minimap crops + ping wheel
  rec.step('minimap');
  await rec.snap2('hud_minimap_crop', 'the minimap region only', { clipSel: '.hud__map' });
  rec.step('ping');
  await rec.snap2('hud_ping_wheel', 'ping wheel held open (G) at the cursor', { before: async (pg) => { await pg.mouse.move(980, 520); await pg.keyboard.down('KeyG'); await pg.waitForTimeout(500); }, after: async (pg) => { await pg.keyboard.up('KeyG'); await pg.waitForTimeout(300); } });
  await p.mouse.move(1100, 480); await p.keyboard.press('KeyG'); await wait(p, 600);
  await rec.snap2('hud_ping_tap', 'after a tap of G (a ping at the cursor)');
  // in-match menu
  rec.step('esc_menu');
  await p.keyboard.press('Escape'); await wait(p, 800); await rec.snap2('hud_esc_menu', 'Esc: in-match menu'); await p.keyboard.press('Escape'); await wait(p, 500);
  // run the match, capture events
  rec.step('events');
  const got = new Set(); const T = rec.timings.hud = { start: Date.now() };
  await setScale(rec, 4);
  const t0 = Date.now(); let lastItemShot = 0;
  while (Date.now() - t0 < 14 * 60 * 1000) {
    await wait(p, 250);
    st = await poll(rec); if (!st) break;
    if (st.ended) break;
    const evs = st.evs ?? [];
    const lvl = evs.find((x) => x.e === 'levelUp' && x.level >= 2);
    if (lvl && !got.has('levelup')) { got.add('levelup'); await setScale(rec, 0); rec.step('levelup'); await rec.snap2('hud_levelup', `level-up event to level ${lvl.level} (sim paused for the shot; sim t=${st.time}, skill points ${st.skill})`); await setScale(rec, 4); rec.obs('level-up', { level: lvl.level, skillPoints: st.skill, time: st.time }); }
    const dmgOut = evs.some((x) => x.e === 'dmg' && x.dir === 'out' && x.other === 'fighter'), dmgIn = evs.some((x) => x.e === 'dmg' && x.dir === 'in' && x.other === 'fighter');
    if ((dmgOut || dmgIn) && !got.has('fight')) { got.add('fight'); await setScale(rec, 0); rec.step('fight'); await rec.snap2('hud_fight', `first fighter-vs-fighter damage (sim paused; t=${st.time})`); await setScale(rec, 1); await wait(p, 700); await rec.snap2('hud_fight_live', 'same fight, sim at x1 for 0.7 s'); await setScale(rec, 4); }
    if (st.nearFighters >= 4 && !got.has('teamfight') && st.time > 120) { got.add('teamfight'); await setScale(rec, 0); rec.step('teamfight'); await rec.snap2('hud_teamfight', `${st.nearFighters} fighters within 10 m (sim paused; t=${st.time})`); await setScale(rec, 4); }
    if (st.items >= 1 && !got.has('items') && Date.now() - lastItemShot > 5000) {
      lastItemShot = Date.now(); got.add('items'); await setScale(rec, 0); rec.step('items');
      await rec.snap2('hud_items_owned', `item slots with ${st.items} owned item(s) (t=${st.time})`);
      await rec.snap2('hud_tip_item', 'tooltip on the first owned item slot', { before: async (pg) => { await pg.locator('.islot:not(.is-empty)').first().hover(); await pg.waitForTimeout(500); } });
      await p.mouse.move(960, 300); await setScale(rec, 4);
    }
    if (st.dead && !got.has('dead')) {
      got.add('dead'); await setScale(rec, 1); rec.step('dead'); await wait(p, 1700);
      await rec.snap2('hud_dead_recap', `dead, respawn in ${st.respawnIn?.toFixed?.(1)} s, after the 1.2 s recap delay (sim x1; t=${st.time})`);
      await p.keyboard.press('KeyP'); await wait(p, 800); await rec.snap2('hud_dead_shop', 'shop opened while dead'); await p.keyboard.press('KeyP'); await wait(p, 400);
      await setScale(rec, 4);
    }
    if (st.time > 330 && !got.has('late')) { got.add('late'); await setScale(rec, 0); rec.step('late'); await rec.snap2('hud_midgame', `HUD at ${st.time}s of sim time (level ${st.level}, ${st.items} items)`); await rec.snap2('hud_midgame_scoreboard', 'scoreboard mid-game', { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } }); await setScale(rec, 4); }
    const need = ['levelup', 'fight', 'dead', 'items', 'late'];
    if (need.every((k) => got.has(k)) && got.has('teamfight')) break;
    if (st.time > 900 && need.filter((k) => got.has(k)).length >= 4) break;
  }
  rec.obs('captured events', [...got]); rec.obs('last poll', st);
  await setScale(rec, 1);
  await rec.finish();
}

// ═══ HUD2: BRIDGE and FRAY HUD ══════════════════════════════════════════════════════════════════════
async function hud2() {
  for (const [mode, q, tag] of [['bridge', 'Standard', 'bridge'], ['fray', 'Standard', 'fray']]) {
    const rec = new Rec(`hud_${tag}`); await rec.open('/?dev=1&autopilot=match&speed=1&seed=7', { base: DEV });
    const p = rec.page; await homeReady(rec);
    try {
      await toMatch(rec, mode, q, tag);
      await setScale(rec, 1);
      await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => {});
      await wait(p, 1500);
      await rec.snap2(`${tag}_idle`, `${mode} HUD, match live at the start`);
      await rec.snap2(`${tag}_minimap_crop`, `${mode} minimap region`, { clipSel: '.hud__map' });
      await rec.snap2(`${tag}_scoreboard`, `${mode} scoreboard held`, { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } });
      await p.mouse.move(980, 520);
      await rec.snap2(`${tag}_ping_wheel`, `${mode} ping wheel (G held)`, { before: async (pg) => { await pg.mouse.move(980, 520); await pg.keyboard.down('KeyG'); await pg.waitForTimeout(500); }, after: async (pg) => { await pg.keyboard.up('KeyG'); } });
      await p.keyboard.press('KeyP'); await wait(p, 800); await rec.snap2(`${tag}_shop`, `${mode} shop`); await p.keyboard.press('KeyP');
      await setScale(rec, 4);
      const t0 = Date.now(); let fight = false, mid = false;
      while (Date.now() - t0 < 6 * 60 * 1000) {
        await wait(p, 250); const st = await poll(rec); if (!st || st.ended) break;
        if (!fight && st.evs.some((x) => x.e === 'dmg' && x.other === 'fighter')) { fight = true; await setScale(rec, 0); await rec.snap2(`${tag}_fight`, `${mode} first fighter damage (paused, t=${st.time})`); await setScale(rec, 4); }
        if (!mid && st.time > 200) { mid = true; await setScale(rec, 0); await rec.snap2(`${tag}_midgame`, `${mode} at ${st.time}s`); await rec.snap2(`${tag}_midgame_scoreboard`, `${mode} scoreboard at ${st.time}s`, { before: async (pg) => { await pg.keyboard.down('Tab'); await pg.waitForTimeout(450); }, after: async (pg) => { await pg.keyboard.up('Tab'); } }); await setScale(rec, 4); }
        if (fight && mid) break;
      }
    } catch (e) { rec.obs(`${tag} failed: ${String(e).slice(0, 200)}`); await rec.snap1(`${tag}_FAILED`, 'state at failure').catch(() => {}); }
    await rec.finish();
  }
}

// ═══ PRACTICE: practice screen, tools, level-up, dummy fight ═════════════════════════════════════════
async function practice() {
  const rec = new Rec('practice'); await rec.open('/?dev=1&seed=7', { base: DEV });
  const p = rec.page; await homeReady(rec);
  rec.step('practice_screen');
  await rec.V((v) => v.router.go('practice')); await wait(p, 1200);
  await shotScreen(rec, 'practice_setup', 'Practice setup screen');
  const opts = await p.evaluate(() => [...document.querySelectorAll('.scr--practice .srow2')].map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 120)));
  rec.obs('practice rows', opts);
  try {
    const cta = p.locator('.scr--practice .scr__foot button').last(); rec.obs('practice CTA', await cta.innerText());
    await cta.click();
    const flow = await driveFlow(rec, 'practice', { maxMs: 120000, cap: 10, paired: false });
    rec.obs('practice flow to HUD ms', flow.ms);
    await p.waitForFunction(() => !!window.__vale?.state?.match?.value, null, { timeout: 30000 }); await installWatch(rec);
    const send = (cmd) => rec.V((v, c) => v.state.match.value.send(c), cmd);
    await setScale(rec, 1);
    await p.waitForFunction(() => window.__vale.state.match.value.view.phase === 'live', null, { timeout: 90000 }).catch(() => rec.obs('practice never went live'));
    await wait(p, 2500);
    rec.step('practice_hud'); await rec.snap2('practice_hud_idle', 'practice HUD with the practice tools panel');
    rec.obs('practice panel text', await p.evaluate(() => document.querySelector('.ptools')?.innerText?.replace(/\s+/g, ' ').slice(0, 400) ?? null));
    await send({ type: 'practice', action: 'spawnDummy' }); await wait(p, 1200); await rec.snap2('practice_dummy', 'after Spawn dummy');
    await send({ type: 'practice', action: 'gold' }); await wait(p, 500);
    await p.keyboard.press('KeyP'); await wait(p, 900); await rec.snap2('practice_shop_rich', 'practice: shop with infinite/boosted gold'); await p.keyboard.press('KeyP'); await wait(p, 300);
    await send({ type: 'practice', action: 'level' }); await wait(p, 350); await rec.snap2('practice_levelup_moment', '0.35 s after the practice Level action');
    for (let i = 0; i < 3; i++) { await send({ type: 'practice', action: 'level' }); await wait(p, 200); }
    await wait(p, 600); await rec.snap2('practice_level_pips', 'after four Level actions (ability rank pips / skill points)');
    // real fight with the dummy: find dummy position, teleport next to it, cast
    const info = await rec.V((v) => { const c = v.state.match.value; const me = c.view.entity(c.view.players[c.you].entity); const kinds = {}; for (const e of c.view.entities) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; const d = c.view.entities.filter((e) => e.kind === 'fighter' && e.id !== me.id).sort((a, b) => ((a.x - me.x) ** 2 + (a.y - me.y) ** 2) - ((b.x - me.x) ** 2 + (b.y - me.y) ** 2))[0]; return { me: [me.x, me.y], d: d ? [d.x, d.y, d.kind, d.id, d.team, me.team] : null, kinds }; });
    rec.obs('practice positions', info);
    if (info.d) { await send({ type: 'practice', action: 'teleport', x: info.d[0] - 3, y: info.d[1] }); await wait(p, 900); }
    for (const slot of ['a1', 'a2', 'a3', 'ult']) { await rec.V((v, s) => { const c = v.state.match.value; const me = c.view.entity(c.view.players[c.you].entity); const d = c.view.entities.filter((e) => e.kind === 'fighter' && e.id !== me.id).sort((a, b) => ((a.x - me.x) ** 2 + (a.y - me.y) ** 2) - ((b.x - me.x) ** 2 + (b.y - me.y) ** 2))[0]; c.send({ type: 'cast', slot: s, x: d?.x ?? me.x + 3, y: d?.y ?? me.y, ...(d ? { target: d.id } : {}) }); }, slot); await wait(p, 250); if (slot === 'a2') await rec.snap2('practice_cast_vfx', 'ability casts in flight at a dummy (live sim)'); }
    await wait(p, 700); await rec.snap2('practice_damage_meter', 'after casting at the dummy: damage meter in the practice panel');
    await send({ type: 'practice', action: 'heal' }); await send({ type: 'practice', action: 'resetCooldowns' });
    rec.obs('events after fight', (await poll(rec)));
    await p.keyboard.press('Escape'); await wait(p, 700); await rec.snap2('practice_esc_menu', 'practice in-match menu');
  } catch (e) { rec.obs('practice failed: ' + String(e).slice(0, 200)); await rec.snap1('practice_FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

// ═══ POST: end-of-match results (fast-forwarded) ═════════════════════════════════════════════════════
async function post() {
  const runs = process.argv.includes('--only') ? [process.argv[process.argv.indexOf('--only') + 1]] : ['fray', 'rift'];
  for (const which of runs) {
    const mode = which, q = which === 'rift' ? 'Lantern Drill' : 'Standard';
    const rec = new Rec(`post_${which}`); await rec.open(`/?dev=1&autopilot=match&speed=16&seed=${which === 'rift' ? 7 : 11}`, { base: DEV });
    const p = rec.page; await homeReady(rec);
    try {
      await toMatch(rec, mode, q, which);
      const t0 = Date.now(); let ended = false, lastLog = 0;
      rec.step('fast_forward');
      while (Date.now() - t0 < 16 * 60 * 1000) {
        await wait(p, 400);
        const st = await poll(rec).catch(() => null);
        if (!st) { const r = await rec.route(); if (/postgame/.test(r.scr)) break; continue; }
        if (Date.now() - lastLog > 30000) { lastLog = Date.now(); rec.obs('progress', { t: st.time, scale: st.scale, level: st.level }); }
        if (st.ended && !ended) { ended = true; rec.step('end_banner'); await setScale(rec, 1); await wait(p, 600); await rec.snap2('end_banner_early', 'result in the view; end banner starting (sim x1)'); await wait(p, 900); await rec.snap2('end_banner', 'end banner held over the last frame'); break; }
      }
      await p.waitForFunction(() => !!document.querySelector('.scr--postgame'), null, { timeout: 60000 }).catch(() => rec.obs('postgame never appeared'));
      await wait(p, 1800);
      rec.step('postgame'); await shotScreen(rec, 'postgame_summary', `${which} post-game default tab`);
      await tabTour(rec, 'postgame');
      rec.obs('postgame text (default tab)', await p.evaluate(() => document.querySelector('.scr--postgame')?.innerText?.replace(/\s+/g, ' ').slice(0, 700) ?? null));
      // buttons on the postgame screen
      const btns = await p.evaluate(() => [...document.querySelectorAll('.scr--postgame button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean));
      rec.obs('postgame buttons', btns);
      const hm = p.locator('.scr--postgame button', { hasText: /Home|Continue|Back|Play again/i }).first();
      if (await hm.count()) { await hm.click().catch(() => {}); await wait(p, 1800); await rec.snap2('after_postgame_leave', 'screen after the post-game CTA'); }
    } catch (e) { rec.obs(`post ${which} failed: ${String(e).slice(0, 200)}`); await rec.snap1(`post_${which}_FAILED`, 'state at failure').catch(() => {}); }
    await rec.finish();
  }
}


// ═══ DEAD: autopilot RIFT until the player's fighter dies (recap, respawn line, shop while dead) and a teamfight ═══
async function dead() {
  const rec = new Rec('hud_dead'); await rec.open('/?dev=1&autopilot=match&speed=1&seed=11', { base: DEV });
  const p = rec.page; await homeReady(rec);
  try {
    await toMatch(rec, 'rift', 'Lantern Drill', 'rift');
    await setScale(rec, 8);
    const got = new Set(); const t0 = Date.now(); let st;
    while (Date.now() - t0 < 14 * 60 * 1000) {
      await wait(p, 200); st = await poll(rec); if (!st || st.ended) break;
      if (st.dead && !got.has('dead')) {
        got.add('dead'); await setScale(rec, 1); rec.step('dead'); await wait(p, 1700);
        await rec.snap2('hud_dead_recap', `dead, respawn in ${st.respawnIn?.toFixed?.(1)} s, 1.7 s after the death (sim x1; t=${st.time})`);
        await wait(p, 1500); await rec.snap2('hud_dead_later', 'dead, 3 s after the death');
        await p.keyboard.press('KeyP'); await wait(p, 800); await rec.snap2('hud_dead_shop', 'shop opened while dead'); await p.keyboard.press('KeyP'); await wait(p, 400);
        rec.obs('death', { time: st.time, level: st.level, respawnIn: st.respawnIn });
        await setScale(rec, 8);
      }
      if (st.respawnIn === 0 && got.has('dead') && !got.has('respawn')) { got.add('respawn'); await setScale(rec, 1); await rec.snap2('hud_respawned', 'right after respawning'); await setScale(rec, 8); }
      if (st.nearFighters >= 5 && st.time > 90 && !got.has('teamfight') && st.evs.some((x) => x.e === 'dmg')) { got.add('teamfight'); await setScale(rec, 0); rec.step('teamfight'); await rec.snap2('hud_teamfight', `${st.nearFighters} fighters within 10 m with damage flowing (sim paused; t=${st.time})`); await setScale(rec, 8); }
      if (got.has('dead') && got.has('respawn') && got.has('teamfight')) break;
      if (st.time > 1100 && got.has('dead')) break;
    }
    rec.obs('captured', [...got]); rec.obs('last poll', st);
  } catch (e) { rec.obs('dead run failed: ' + String(e).slice(0, 200)); await rec.snap1('dead_FAILED', 'state at failure').catch(() => {}); }
  await rec.finish();
}

const parts = { dead, cold, menus, draft, hud, hud2, practice, post };
if (!parts[part]) { console.error('part? ' + Object.keys(parts).join(' | ')); process.exit(2); }
await deadline(part, 70 * 60 * 1000, parts[part]);
process.exit(0);
