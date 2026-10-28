// VALE — the client fit sweep (client F9, F6, F5, F8): every front-door screen at 1280x720 (the default window
// size) and 1920x1080, real Chrome, the renderer on. Fails on a clipped label, on must-see content below the fold
// or under the footer, and on any text under the portal control bar (bottom-left).
//
//   node _harness/sweep_720.mjs [fast|flow] [--sizes 1280x720,1920x1080] [--only home,play,skins,postgame,draft,loading]
//                               [--out <report.json>] [--prefix fw_W2_sweep]
//
//   fast (default)  no queue: Play (every live mode), Collection Skins, the draft (a team pick, your hover, your lock,
//                   finalize), loading and post-game are built from the real catalog and pushed into the UI state.
//   flow            the draft, finalize and loading come from a REAL Co-op queue (Find match → Ready → pick a card →
//                   Lock in → the finalize timer → loading); Play, Collection and post-game as in `fast`.
//
// home (client F7): the progress band on a fresh profile and after a won match (level ring with XP to next, the
// first-win candle lit / spent with the reset time, Play again enabled), then one click on Play again must start the
// search. Per screen and size the report holds: clipped (text cut by its own box or an overflow ancestor; line-clamped
// descriptions are listed apart as `clamped`), fold (must-see elements not fully inside their scroll box or under
// the footer), portal (text under the control bar), and the screen's own metrics (Play: selected queue card and
// Find match boxes, gnomon / title overlap, the mode art; draft: the showcase box and the lock-in cue; skins: tiles
// per row). Shots: _harness/_shots/<prefix>_<w>_<screen>.png; report: _harness/_reports/<prefix>.json.
// Needs the dev server on :5190. Exit 0 = no failures.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const which = args[0] && !args[0].startsWith('--') ? args[0] : 'fast';
const PREFIX = opt('--prefix', 'fw_W2_sweep');
const OUT = opt('--out', join(HERE, '_reports', `${PREFIX}.json`));
const SIZES = opt('--sizes', '1280x720,1920x1080').split(',').map((s) => s.split('x').map(Number));
const ONLY = opt('--only', '').split(',').filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);

const R = { started: new Date().toISOString(), which, sizes: SIZES, screens: {}, failures: [], errors: [] };
const save = () => writeFileSync(OUT, JSON.stringify(R, null, 1));

// ── in-page measurement ───────────────────────────────────────────────────────────────────────────────────
// must: [{ name, sel, all? }] — every match must sit fully inside its scroll boxes and above the footer
function measure(o) {
  const scr = [...document.querySelectorAll('.scr:not(.is-leaving)')].pop() ?? document.body;
  const shown = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const txt = (e) => (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
  const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const clipAnc = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return a; } return null; };
  const foot = scr.querySelector('.scr__foot');
  const footTop = foot ? foot.getBoundingClientRect().top : innerHeight;
  const clipped = [], clamped = [];
  for (const e of scr.querySelectorAll('*')) {
    if (!ownText(e) || !shown(e) || e.closest('[aria-hidden="true"], .tip, .sr-only, .skel')) continue;
    const cs = getComputedStyle(e);
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    if (clamp) { if (e.scrollHeight > e.clientHeight + 1) clamped.push({ t: txt(e), lines: cs.webkitLineClamp }); continue; }
    if ((cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) { clipped.push({ t: txt(e), cls: e.className, w: e.clientWidth, need: e.scrollWidth }); continue; }
    // cut by an overflow ancestor sideways (a chip squeezed out of a nowrap line), or vertically by a non-scrolling one
    const a = clipAnc(e);
    if (!a) continue;
    const r = e.getBoundingClientRect(), ar = a.getBoundingClientRect(), acs = getComputedStyle(a);
    const scrollsY = /auto|scroll/.test(acs.overflowY);
    if (r.right > ar.right + 1.5 || r.left < ar.left - 1.5) clipped.push({ t: txt(e), cls: e.className, by: a.className, side: Math.round(r.right - ar.right) });
    else if (!scrollsY && (r.bottom > ar.bottom + 1.5) && r.top < ar.bottom) clipped.push({ t: txt(e), cls: e.className, by: a.className, cutY: Math.round(r.bottom - ar.bottom) });
  }
  // must-see elements: fully inside every scrolling ancestor and above the footer
  const fold = [];
  for (const m of o.must ?? []) {
    const els = [...scr.querySelectorAll(m.sel)].filter(shown);
    if (!els.length) { fold.push({ name: m.name, missing: true }); continue; }
    for (const e of m.all ? els : els.slice(0, 1)) {
      const r = e.getBoundingClientRect();
      let cut = null;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (!/auto|scroll|hidden|clip/.test(cs.overflowY)) continue;
        const ar = a.getBoundingClientRect();
        if (r.bottom > ar.bottom + 1.5 || r.top < ar.top - 1.5) { cut = { by: String(a.className).slice(0, 40), box: rect(a) }; break; }
      }
      const fr = foot?.getBoundingClientRect();
      const underFoot = !!fr && !e.closest('.scr__foot') && r.bottom > footTop + 1 && r.right > fr.left && r.left < fr.right;
      if (cut || underFoot) fold.push({ name: m.name, t: txt(e), box: rect(e), cut, footTop: Math.round(footTop) });
    }
  }
  // the portal control bar (public/game_controls.js) bottom-left: no visible text under it
  const bar = document.getElementById('__ff_controls__');
  const portal = [];
  if (bar && shown(bar)) {
    const b = bar.getBoundingClientRect();
    for (const e of document.querySelectorAll('#ui *')) {
      if (!ownText(e) || !shown(e) || e.closest('.is-leaving')) continue;
      // the painted part only: clipped by every overflow ancestor (a scrolled-away row is not under the bar)
      const r0 = e.getBoundingClientRect();
      let l = r0.left, t = r0.top, rr = r0.right, bb = r0.bottom;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        l = Math.max(l, ar.left); t = Math.max(t, ar.top); rr = Math.min(rr, ar.right); bb = Math.min(bb, ar.bottom);
      }
      if (rr - l < 1 || bb - t < 1) continue;
      if (rr > b.left && l < b.right && bb > b.top && t < b.bottom) portal.push({ t: txt(e), box: [Math.round(l), Math.round(t), Math.round(rr), Math.round(bb)] });
    }
  }
  return { vh: innerHeight, footTop: Math.round(footTop), clipped, clamped, fold, portal, bar: bar ? rect(bar) : null };
}

const MUST = {
  home: [{ name: 'level ring', sel: '.lvring' }, { name: 'first win', sel: '.hband__win' }, { name: 'last match', sel: '.hband__last' }, { name: 'band action', sel: '.hband__go' },
    { name: 'feature', sel: '.home__feature' }, { name: 'tiles', sel: '.home__tiles .tile', all: true }, { name: 'feature CTA', sel: '.scr__foot .btn--chalk' }],
  play: [{ name: 'selected queue', sel: '.qcard.is-selected' }, { name: 'find match', sel: '.scr__foot .btn--chalk' }, { name: 'mode title', sel: '.play__mode h2' }, { name: 'mode art', sel: '.playart' }],
  skins: [{ name: 'first skin tile', sel: '.skin' }],
  draft: [{ name: 'fighter cards', sel: '.draft__grid .fcard', all: true }, { name: 'showcase', sel: '.dshow' }, { name: 'phase title', sel: '.phase__title' }, { name: 'seats', sel: '.dteam .seat', all: true }],
  finalize: [{ name: 'fighter name', sel: '.final__who h2' }, { name: 'section heads', sel: '.loadout h3, .loadout [role=tab]', all: true }, { name: 'picks', sel: '.loadout .picks', all: true }, { name: 'seats', sel: '.dteam .seat', all: true }],
  draft_fray: [{ name: 'fighter cards', sel: '.draft__grid .fcard', all: true }, { name: 'seat chips', sel: '.fseat', all: true }, { name: 'phase title', sel: '.phase__title' }],
  draft_lot: [{ name: 'your draw', sel: '.lot__draw' }, { name: 'lot cards', sel: '.lotcard', all: true }, { name: 'seats', sel: '.dteam .seat', all: true }],
  loading: [{ name: 'cards', sel: '.pcard', all: true }, { name: 'tip', sel: '.loading__tip' }],
  postgame: [{ name: 'tabs', sel: '.scr--postgame [role=tab]', all: true }],
};

function fail(screen, w, what, info) { R.failures.push({ screen, w, what, info }); console.log(`  ✗ ${screen} ${w}: ${what} ${JSON.stringify(info).slice(0, 300)}`); }
async function check(page, screen, w, extra = {}, mustKey = screen) {
  const m = await page.evaluate(measure, { must: MUST[mustKey] ?? [] });
  const row = { ...m, ...extra };
  (R.screens[screen] ??= {})[w] = row;
  if (m.clipped.length) fail(screen, w, `${m.clipped.length} clipped label(s)`, m.clipped.slice(0, 6));
  if (m.fold.length) fail(screen, w, `${m.fold.length} must-see element(s) below the fold`, m.fold.slice(0, 6));
  if (m.portal.length) fail(screen, w, `${m.portal.length} text(s) under the control bar`, m.portal.slice(0, 4));
  if (!m.clipped.length && !m.fold.length && !m.portal.length) console.log(`  ✓ ${screen} ${w}${m.clamped.length ? ` (${m.clamped.length} clamped)` : ''}`);
  save();
  return row;
}

const { browser, page, logs } = await open('/?dev=1', { width: SIZES[0][0], height: SIZES[0][1], hmr: false });
const W = (ms) => page.waitForTimeout(ms);
const vp = async (w, h) => { await page.setViewportSize({ width: w, height: h }); await W(700); };
const each = async (fn) => { for (const [w, h] of SIZES) { await vp(w, h); await fn(w, h); } };
async function step(name, fn) { try { await fn(); } catch (e) { R.errors.push({ name, err: String(e?.message ?? e).slice(0, 400) }); console.log(`  ✗ ${name}: ${String(e?.message ?? e).split('\n')[0]}`); await shot(page, `${PREFIX}_FAIL_${name}`).catch(() => {}); } save(); }
await page.waitForSelector('.home__headline, .scr--home', { timeout: 60000 }).catch(() => {});
await W(1500);

// ── Home (client F7): the progress band on a fresh profile and after a won match today; one click on Play again ──
if (want('home')) await step('home', async () => {
  const extra = () => page.evaluate(() => {
    const b = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
    const t = (s) => document.querySelector(s)?.innerText?.replace(/\s+/g, ' ').trim() ?? null;
    const go = document.querySelector('.hband__go');
    return { band: b('.hband'), tiles: b('.home__tiles'), level: t('.hband__level'), ring: document.querySelector('.lvring__fill')?.style.strokeDasharray ?? null,
      firstWin: t('.hband__win'), firstWinLit: !!document.querySelector('.hband__win.is-lit'), last: t('.hband__last'), action: t('.hband__go'),
      actionDisabled: !!go && (go.disabled || go.getAttribute('aria-disabled') === 'true'), feature: t('.home__featuretext h2'), cta: t('.scr__foot .btn--chalk') };
  });
  // 1. a fresh profile: level 1, no history, today's first win still to be had
  await vale(page, (v) => { v.__homeSaved = v.state.profile.value; v.state.profile.value = { ...v.state.profile.value, level: 1, xp: 0, history: [], firstWinAt: undefined }; v.router.reset('home', {}); });
  await W(1200);
  await each(async (w) => {
    const row = await check(page, 'home', `${w}_fresh`, await extra());
    if (!row.firstWinLit) fail('home', `${w}_fresh`, 'first-win candle is not lit on a fresh profile', { firstWin: row.firstWin });
    if (!/XP to level 2/.test(row.level ?? '')) fail('home', `${w}_fresh`, 'level ring has no XP to the next level', { level: row.level });
    await shot(page, `${PREFIX}_${w}_home_fresh`);
  });
  // 2. after a won match today: level 4 with 60 XP, the first win spent, a last match to repeat
  await vale(page, (v) => {
    const cv = v.cv; const f = cv.playable()[0]; const q = cv.queuesOf('rift').find((x) => x.kind === 'coop') ?? cv.c.queues[0]; const now = new Date().toISOString();
    v.state.profile.value = { ...v.__homeSaved, level: 4, xp: 60, firstWinAt: now, history: [{ matchId: 'fixture_home', at: now, queue: q.id, mode: q.mode, fighter: f.id, skin: cv.baseSkin(f.id)?.id ?? '', won: true,
      placement: 1, kills: 7, deaths: 2, assists: 9, cs: 120, duration: 1453, grants: { currency: {}, xp: 0, levelBefore: 4, levelAfter: 4, firstWin: true, lines: [] } }, ...v.__homeSaved.history] };
    v.router.reset('home', {});
  });
  await W(1200);
  await each(async (w) => {
    const row = await check(page, 'home', `${w}_after_win`, await extra());
    if (row.firstWinLit || !/Back in \d/.test(row.firstWin ?? '')) fail('home', `${w}_after_win`, 'first-win candle is not spent with the time to the reset', { firstWin: row.firstWin });
    if (!row.ring || parseFloat(row.ring) <= 0) fail('home', `${w}_after_win`, 'level ring shows no XP', { ring: row.ring });
    if (!/play again/i.test(row.action ?? '') || row.actionDisabled) fail('home', `${w}_after_win`, 'no enabled Play again', { action: row.action, disabled: row.actionDisabled });
    await shot(page, `${PREFIX}_${w}_home_after_win`);
  });
  // 3. one click on Play again starts the search for the last match's queue
  await page.locator('.scr:not(.is-leaving) .hband__go').first().click();
  await W(1500);
  const went = await vale(page, (v) => ({ route: v.router.route.value.screen, queue: v.state.queue.value?.state ?? null, req: v.state.lastRequest.value?.queue ?? null }));
  (R.screens.home ??= {}).play_again = went;
  if (went.route !== 'queue' || went.queue !== 'searching') fail('home', 'play_again', 'Play again did not start the search', went);
  else console.log(`  ✓ home: Play again → ${went.route} (${went.queue}, ${went.req})`);
  await vale(page, (v) => { try { v.session.cancelQueue(); } catch { /* not searching */ } v.state.profile.value = v.__homeSaved; v.router.reset('home', {}); });
  await W(1000);
});

// ── Play: every live mode, the default (first-visit) queue ──────────────────────────────────────────────────
if (want('play')) await step('play', async () => {
  const modes = await vale(page, (v) => v.cv.c.client.modeSlots.filter((s) => s.mode && s.status === 'live').map((s) => s.mode));
  for (const mode of modes) {
    await vale(page, (v, m) => { v.state.setPrefs({ lastMode: m, lastQueue: '' }); v.router.reset('play', { mode: m }); }, mode);
    await W(1400);
    await each(async (w) => {
      await page.evaluate(() => document.querySelector('.scr:not(.is-leaving) .scr__body')?.scrollTo(0, 0));
      await W(300);
      const extra = await page.evaluate(() => {
        const b = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
        const body = document.querySelector('.scr:not(.is-leaving) .scr__body');
        const title = document.querySelector('.play__mode h2');
        // the gnomon's painted shape vs the title's text box: sample the shadow polygon's edges
        const poly = document.querySelector('.dial__shadow');
        let hits = 0;
        if (poly && title) {
          const tr = title.getBoundingClientRect(), sv = poly.ownerSVGElement, m = poly.getScreenCTM();
          const pts = [...poly.points].map((p) => { const q = sv.createSVGPoint(); q.x = p.x; q.y = p.y; return q.matrixTransform(m); });
          for (let i = 0; i < pts.length; i++) for (let k = 0; k <= 20; k++) {
            const a = pts[i], c = pts[(i + 1) % pts.length], x = a.x + (c.x - a.x) * k / 20, y = a.y + (c.y - a.y) * k / 20;
            if (x > tr.left && x < tr.right && y > tr.top && y < tr.bottom) hits++;
          }
        }
        const art = document.querySelector('.playart img.aimg');
        return { body: body ? { h: body.clientHeight, sh: body.scrollHeight } : null, selected: b(document.querySelector('.qcard.is-selected')), selectedName: document.querySelector('.qcard.is-selected .qcard__name')?.innerText,
          find: b(document.querySelector('.scr__foot .btn--chalk')), title: b(title), gnomon: b(document.querySelector('.dial__gnomon')), gnomonOverTitle: hits,
          art: art ? { box: b(art), src: art.getAttribute('src'), ok: art.classList.contains('is-ok') } : null };
      });
      const row = await check(page, 'play', `${w}_${mode}`, extra);
      if (row.gnomonOverTitle) fail('play', `${w}_${mode}`, 'gnomon crosses the mode title', { hits: row.gnomonOverTitle, gnomon: row.gnomon, title: row.title });
      await shot(page, `${PREFIX}_${w}_play_${mode}`);
    });
  }
});

// ── Collection: Skins ───────────────────────────────────────────────────────────────────────────────────
if (want('skins')) await step('skins', async () => {
  await vale(page, (v) => v.router.reset('collection', { tab: 'skins' }));
  await W(1500);
  await each(async (w) => {
    await page.evaluate(() => document.querySelector('.scr:not(.is-leaving) .scr__body')?.scrollTo(0, 0));
    await W(400);
    const extra = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.scr--collection .skin')];
      const tops = new Map();
      for (const t of tiles) { const y = Math.round(t.getBoundingClientRect().top); tops.set(y, (tops.get(y) ?? 0) + 1); }
      const first = tiles[0]?.getBoundingClientRect();
      // every name across the whole tab (not just the visible part): scrollWidth vs clientWidth, scrollHeight vs clientHeight
      const names = [...document.querySelectorAll('.scr--collection .skin__name')];
      const cut = names.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.innerText);
      return { tiles: tiles.length, perRow: Math.max(...tops.values()), tile: first ? [Math.round(first.width), Math.round(first.height)] : null, names: names.length, namesCut: cut, sticky: getComputedStyle(document.querySelector('.skinsect__head') ?? document.body).position };
    });
    const row = await check(page, 'skins', w, extra);
    if (row.namesCut.length) fail('skins', w, `${row.namesCut.length} skin name(s) cut anywhere in the tab`, row.namesCut.slice(0, 8));
    await shot(page, `${PREFIX}_${w}_collection_skins`);
  });
});

// ── post-game (fixture result from the real catalog) ────────────────────────────────────────────────────────
if (want('postgame')) await step('postgame', async () => {
  await vale(page, (v) => {
    const cv = v.cv; const fs = cv.playable().slice(0, 10); const items = cv.c.items.filter((i) => i.icon).map((i) => i.id);
    const roles = cv.rolesOrdered().map((r) => r.id);
    const names = ['ruth_afterlight', 'lark_on_the_rim', 'mina_noonmark', 'cobb_and_candle', 'pia_morningside', 'noor_lampwright', 'petra_wickwalk', 'maeve_in_amber', 'lilt_and_tally', 'chalkdust_ines'];
    const players = fs.map((f, i) => ({ player: i, team: i < 5 ? 0 : 1, name: names[i], fighter: f.id, skin: cv.baseSkin(f.id)?.id ?? '', role: roles[i % 5], controller: i === 0 ? 'human' : 'bot',
      kills: (i * 3) % 11, deaths: (i * 5) % 7, assists: (i * 7) % 13, cs: 80 + i * 17, gold: 7000 + i * 913, level: 11 + (i % 6), damageToFighters: 9000 + i * 2711, damageTaken: 12000 + i * 1000, healing: i * 1300, structureDamage: (i % 4) * 2100,
      items: Array.from({ length: 6 }, (_, k) => (k < 3 + (i % 4) ? items[(i * 5 + k * 3) % items.length] : null)), placement: i < 5 ? 1 : 2, won: i < 5 }));
    const result = { matchId: 'fixture', queue: cv.queuesOf('rift').find((q) => q.kind === 'coop')?.id, mode: 'rift', map: cv.mode('rift')?.map, seed: 1, catalogVersion: '', duration: 1834, winningTeam: 0, reason: 'core', players, goldGraph: [0, 200, -300, 800, 1500, 900, 2400], digest: '' };
    v.state.postgame.value = { result, grants: { currency: {}, xp: 120, levelBefore: 3, levelAfter: 3, firstWin: false, lines: [] }, you: 0 };
    v.router.reset('postgame', {});
  });
  await W(2500);
  for (const tab of ['summary', 'scoreboard']) {
    if (tab === 'scoreboard') { await page.locator('.scr--postgame [role=tab]', { hasText: /Scoreboard/i }).first().click().catch(() => {}); await W(900); }
    await each(async (w) => { await check(page, 'postgame', `${w}_${tab}`); await shot(page, `${PREFIX}_${w}_postgame_${tab}`); });
  }
});

// ── the draft: a fixture board (fast) or a real Co-op queue (flow) ──────────────────────────────────────────
const draftFixture = (patch) => vale(page, (v, p) => {
  const cv = v.cv; const fs = cv.playable(); const roles = cv.rolesOrdered().map((r) => r.id);
  const q = cv.queuesOf('rift').find((x) => x.kind === 'coop') ?? cv.queuesOf('rift')[0];
  const names = ['You', 'belle_of_noon', 'ines_at_dusk', 'twomark_tess', 'ostler_k', 'dunmoor_ash', 'noor_lampwright', 'lilt_and_tally', 'chalkdust_ines', 'petra_wickwalk'];
  const prev = v.state.draft.value;
  const seats = Array.from({ length: 10 }, (_, i) => ({ player: i, team: i < 5 ? 0 : 1, name: names[i], isBot: i > 0, isYou: i === 0, role: roles[i % 5],
    ...(p.phase === 'finalize' ? { locked: fs[(i * 3 + 1) % fs.length].id, skin: cv.baseSkin(fs[(i * 3 + 1) % fs.length].id)?.id } : {}) }));
  // an ally already locked (a taken card with its taker's name) and one hovering (the ally intent rim)
  if (p.phase !== 'finalize') { seats[1].locked = fs[9].id; seats[2].hover = fs[11].id; }
  if (p.hover) seats[0].hover = fs[p.hover].id;
  if (p.lock) { seats[0].locked = fs[p.hover].id; seats[0].skin = cv.baseSkin(fs[p.hover].id)?.id; }
  if (p.phase === 'finalize') { seats[0].locked = fs[p.hover ?? 4].id; seats[0].skin = cv.baseSkin(seats[0].locked)?.id; seats[0].loadout = v.state.profile.value.loadouts[seats[0].locked] ?? { spells: [], boons: [] }; }
  const d = { queue: q.id, mode: 'rift', phase: p.phase ?? 'pick', turn: p.phase === 'finalize' ? null : { players: [0, 1, 2, 3, 4], action: 'pick' }, timer: 24, timerMax: 30, seats,
    bans: [], bench: {}, available: fs.map((f) => f.id), log: ['Picks are revealed together.'], trades: [] };
  v.state.draft.value = d;
  if (v.router.route.value.screen !== 'draft') v.router.reset('draft', {});
  return !!prev;
}, patch);

async function draftChecks(tag) {
  await each(async (w) => {
    const extra = await page.evaluate(() => {
      const b = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      const scr = document.querySelector('.scr--draft:not(.is-leaving)');
      const big = [...scr.querySelectorAll('img, canvas')].map((e) => e.getBoundingClientRect()).filter((r) => r.width >= 200 && r.height >= 200).map((r) => [Math.round(r.width), Math.round(r.height)]);
      const role = [...scr.querySelectorAll('.fcard__role, .fcard__roleicon')].filter((e) => e.offsetParent).map((e) => ({ t: e.innerText || e.getAttribute('aria-label') || e.title, w: e.clientWidth, sw: e.scrollWidth }));
      return { show: b(scr.querySelector('.dshow')), showArt: b(scr.querySelector('.dshow__art img')), showName: scr.querySelector('.dshow__name')?.innerText ?? null, showState: scr.querySelector('.dshow')?.className ?? null,
        abilities: scr.querySelectorAll('.dshow__kit .sicon').length, bigVisuals: big, roleShown: role.length, roleClipped: role.filter((x) => x.sw > x.w + 1) };
    });
    await check(page, tag === 'finalize' ? 'finalize' : 'draft', `${w}_${tag}`, extra);
    await shot(page, `${PREFIX}_${w}_draft_${tag}`);
  });
}

if (want('draft') && which === 'fast') await step('draft_fixture', async () => {
  await draftFixture({});
  await W(1500);
  await draftChecks('myturn');
  await draftFixture({ hover: 4 });
  await W(900);
  await draftChecks('hover');
  const before = await vale(page, (v) => v.audioLog?.length ?? 0);
  await draftFixture({ hover: 4, lock: true });
  await W(250);
  await shot(page, `${PREFIX}_${SIZES[SIZES.length - 1][0]}_draft_lockbeat_250ms`);
  await W(1200);
  R.lockCue = await vale(page, (v, n) => ({ played: (v.audioLog ?? []).slice(n).map((x) => x.id), fighter: v.state.draft.value?.seats[0].locked }), before);
  console.log('  lock-in cue', JSON.stringify(R.lockCue));
  await draftChecks('locked');
  await draftFixture({ phase: 'finalize', hover: 4 });
  await W(1500);
  await draftChecks('finalize');
  for (const tab of ['Boons', 'Battle spells']) {
    const t = page.locator('.scr--draft:not(.is-leaving) .loadout [role=tab]', { hasText: tab }).first();
    if (await t.count()) { await t.click(); await W(400); await each(async (w) => { await check(page, 'finalize', `${w}_${tab.replace(' ', '_').toLowerCase()}`); await shot(page, `${PREFIX}_${w}_draft_finalize_${tab.replace(' ', '_').toLowerCase()}`); }); }
  }
  await vale(page, (v) => { v.state.draft.value = null; v.router.reset('home', {}); });
  await W(800);
});

if (want('draft') && which === 'flow') await step('draft_flow', async () => {
  await vale(page, (v) => { v.state.setPrefs({ lastMode: 'rift', lastQueue: '' }); v.router.reset('play', { mode: 'rift' }); });
  await W(1200);
  await page.locator('.qcard', { hasText: /Co-op/i }).first().click();
  await W(400);
  await page.getByRole('button', { name: 'Find match' }).click();
  await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
  await W(300);
  const ready = page.locator('.ready').getByRole('button', { name: /^Ready/ });
  if (await ready.count()) await ready.click();
  await waitFor(page, (v) => !!v.state.draft.value, 30000);
  await waitFor(page, (v) => { const s = v.state.draft.value; const m = s?.seats.find((x) => x.isYou); return !s || (s.phase !== 'pick' && s.phase !== 'ban') || !!m?.locked || (s.turn?.action !== 'ban' && !!s.turn?.players.includes(m?.player)); }, 90000);
  await W(900);
  await draftChecks('myturn');
  const card = page.locator('.scr--draft:not(.is-leaving) .fcard:not(.is-taken):not(.is-locked):not(.is-banned):not([aria-disabled="true"])').nth(3);
  await card.click();
  await W(700);
  await draftChecks('hover');
  const before = await vale(page, (v) => v.audioLog?.length ?? 0);
  await page.locator('.scr--draft').getByRole('button', { name: /Lock in/i }).first().click();
  await W(250);
  await shot(page, `${PREFIX}_${SIZES[SIZES.length - 1][0]}_draft_lockbeat_250ms`);
  await W(1000);
  R.lockCue = await vale(page, (v, n) => ({ played: (v.audioLog ?? []).slice(n).map((x) => x.id), fighter: v.state.draft.value?.seats.find((s) => s.isYou)?.locked }), before);
  console.log('  lock-in cue', JSON.stringify(R.lockCue));
  await draftChecks('locked');
  await waitFor(page, (v) => { const s = v.state.draft.value; return !s || ['finalize', 'trade', 'done'].includes(s.phase); }, 120000);
  await W(1200);
  await draftChecks('finalize');
  for (const tab of ['Boons', 'Battle spells']) {
    const t = page.locator('.scr--draft:not(.is-leaving) .loadout [role=tab]', { hasText: tab }).first();
    if (await t.count()) { await t.click(); await W(400); await each(async (w) => { await check(page, 'finalize', `${w}_${tab.replace(' ', '_').toLowerCase()}`); await shot(page, `${PREFIX}_${w}_draft_finalize_${tab.replace(' ', '_').toLowerCase()}`); }); }
  }
  // the loading screen lasts only while the match loads: measure at the size the window already has first, then the other
  await waitFor(page, (v) => v.router.route.value.screen === 'loading' || !!v.state.match.value, 120000);
  await W(900);
  for (const [w, h] of [...SIZES].reverse()) {
    if (await vale(page, (v) => v.router.route.value.screen !== 'loading')) { R.errors.push({ name: 'loading_flow', err: `the match started before the ${w} measurement` }); break; }
    await vp(w, h);
    if (await vale(page, (v) => v.router.route.value.screen !== 'loading')) { R.errors.push({ name: 'loading_flow', err: `the match started before the ${w} measurement (not a fit failure; the fast run measures loading at every size)` }); break; }
    await check(page, 'loading', `${w}_flow`);
    await shot(page, `${PREFIX}_${w}_loading_flow`);
  }
});

// ── FRAY pick and the BRIDGE Lot (fixtures, fast): clipped labels and the fold ─────────────────────────────────
if (want('draft') && which === 'fast') await step('draft_other', async () => {
  for (const kind of ['fray', 'lot']) {
    await vale(page, (v, kind) => {
      const cv = v.cv; const fs = cv.playable(); const roles = cv.rolesOrdered().map((r) => r.id);
      const mode = kind === 'fray' ? 'fray' : 'bridge';
      const q = cv.queuesOf(mode)[0];
      const names = ['You', 'belle_of_noon', 'ines_at_dusk', 'twomark_tess', 'ostler_k', 'dunmoor_ash', 'noor_lampwright', 'lilt_and_tally', 'chalkdust_ines', 'petra_wickwalk'];
      const seats = Array.from({ length: 10 }, (_, i) => ({ player: i, team: kind === 'fray' ? i : i < 5 ? 0 : 1, name: names[i], isBot: i > 0, isYou: i === 0, ...(kind === 'fray' ? {} : { role: roles[i % 5] }),
        ...(kind === 'lot' || i % 3 === 1 ? { locked: fs[(i * 3 + 2) % fs.length].id } : {}), rerolls: 1 }));
      v.state.draft.value = { queue: q.id, mode, phase: kind === 'fray' ? 'pick' : 'bench', turn: kind === 'fray' ? { players: seats.map((x) => x.player), action: 'free' } : null, timer: 18, timerMax: 25, seats,
        bans: [], bench: kind === 'lot' ? { 0: fs.slice(10, 13).map((f) => f.id), 1: fs.slice(13, 16).map((f) => f.id) } : {}, available: fs.map((f) => f.id), log: ['The Lot is drawn.'], trades: [] };
      if (v.router.route.value.screen !== 'draft') v.router.reset('draft', {});
    }, kind);
    await W(1500);
    await each(async (w) => { await check(page, 'draft', `${w}_${kind}`, {}, `draft_${kind}`); await shot(page, `${PREFIX}_${w}_draft_${kind}`); });
  }
  await vale(page, (v) => { v.state.draft.value = null; v.router.reset('home', {}); });
  await W(800);
});

// ── loading (fixture, fast) ─────────────────────────────────────────────────────────────────────────────────
if (want('loading') && which === 'fast') await step('loading', async () => {
  for (const mode of ['rift', 'fray']) {
    await vale(page, (v, mode) => {
      const cv = v.cv; const fs = cv.playable(); const roles = cv.rolesOrdered().map((r) => r.id);
      const q = cv.queuesOf(mode)[0];
      const names = ['ruth_afterlight', 'lark_on_the_rim', 'mina_noonmark', 'cobb_and_candle', 'pia_morningside', 'noor_lampwright', 'petra_wickwalk', 'maeve_in_amber', 'lilt_and_tally', 'chalkdust_ines'];
      const seats = Array.from({ length: 10 }, (_, i) => { const f = fs[(i * 3) % fs.length]; return { player: i, team: mode === 'fray' ? i : i < 5 ? 0 : 1, name: names[i], fighter: f.id, skin: cv.baseSkin(f.id)?.id ?? '', role: mode === 'fray' ? undefined : roles[i % 5], loadout: { spells: [], boons: [] }, controller: i === 0 ? 'human' : 'bot', colorIndex: i }; });
      v.state.loading.value = { setup: { matchId: 'fixture_' + mode, seed: 1, queue: q.id, mode, map: cv.mode(mode).map, seats, catalogVersion: '' }, progress: 0.4 };
      v.router.reset('loading', {});
    }, mode);
    await W(2200);
    await each(async (w) => { await W(500); await check(page, 'loading', `${w}_${mode}`); await shot(page, `${PREFIX}_${w}_loading_${mode}`); });
  }
  await vale(page, (v) => { v.state.loading.value = null; v.router.reset('home', {}); });
});

R.finished = new Date().toISOString();
R.logs = logs.filter((l) => !/Failed to load resource|favicon/.test(l)).slice(0, 30);
save();
await browser.close();
const n = R.failures.length + R.errors.length;
console.log(`\n${n ? `✗ ${R.failures.length} failure(s), ${R.errors.length} error(s)` : '✓ no failures'} → ${OUT}`);
process.exit(n ? 1 : 0);
