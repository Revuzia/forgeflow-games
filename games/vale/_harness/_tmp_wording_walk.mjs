// TEMP (wording verifier r1): walk every screen + HUD state, dump all visible text and attributes, grep for
// bot / AI / CPU / computer / NPC wording and for any DOM marker that singles out computer seats.
//   node _harness/_tmp_wording_walk.mjs [menus|rift|bridge|fray|offline|all]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, vale, waitFor, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const which = process.argv[2] ?? 'all';
const OUT = join(HERE, '_reports', `_tmp_wording_walk_${which}.json`);
const BAN = /\b(bots?|a\.i\.?|ai|cpu|computers?|npcs?|robot)\b/i;
const dump = { snaps: [], hits: [], markers: [], errors: [] };

async function snap(page, tag) {
  const d = await page.evaluate(() => {
    const vis = (e) => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
    const attrs = [];
    for (const e of document.querySelectorAll('*')) {
      for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'aria-description', 'aria-valuetext', 'data-tip', 'data-tooltip']) { const v = e.getAttribute(a); if (v) attrs.push(`${a}=${v}`); }
      if (e.tagName === 'svg' || e.closest('svg')) continue;
    }
    const cls = [];
    for (const e of document.querySelectorAll('[class]')) { const c = typeof e.className === 'string' ? e.className : ''; if (/\bbot|is-bot|cpu|\bai\b|chip--bot|pcard__bot/i.test(c) && vis(e)) cls.push(`${e.tagName.toLowerCase()}.${c}`); }
    const dataAttrs = [];
    for (const e of document.querySelectorAll('*')) for (const a of e.attributes) if (/^data-/.test(a.name) && /bot|cpu|\bai\b/i.test(a.name + a.value)) dataAttrs.push(`${a.name}=${a.value}`);
    return { route: window.__vale?.router.route.value.screen ?? null, title: document.title, text: document.body.innerText, attrs, cls, dataAttrs };
  });
  dump.snaps.push({ tag, route: d.route, len: d.text.length });
  const lines = [d.title, ...d.text.split('\n'), ...d.attrs];
  for (const l of lines) if (BAN.test(l)) dump.hits.push({ tag, route: d.route, line: l.trim().slice(0, 200) });
  for (const c of [...d.cls, ...d.dataAttrs]) dump.markers.push({ tag, route: d.route, m: c.slice(0, 200) });
  return d;
}

const frames = (page) => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
async function clickAll(page, sel, tag, scope = '') {
  const n = await page.locator(sel).count();
  for (let i = 0; i < n; i++) {
    const l = page.locator(sel).nth(i);
    if (!(await l.isVisible().catch(() => false))) continue;
    await l.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(350);
    await snap(page, `${tag}#${i}`);
    // hover the controls for tooltips
  }
}
async function hoverSome(page, sel, tag, max = 40) {
  const n = Math.min(max, await page.locator(sel).count());
  for (let i = 0; i < n; i++) {
    const l = page.locator(sel).nth(i);
    if (!(await l.isVisible().catch(() => false))) continue;
    await l.hover({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(450);
    await snap(page, `${tag}~${i}`);
  }
  await page.mouse.move(5, 5);
}

async function menus() {
  const s = await open('/?dev=1', { hmr: false });
  const { page } = s;
  try {
    await page.waitForTimeout(1500); await frames(page);
    await snap(page, 'home');
    await hoverSome(page, 'button, [role=tab], .nav__item, .chip', 'home_hover', 30);
    const screens = await vale(page, (v) => v.screens);
    for (const sc of ['play', 'collection', 'shop', 'profile', 'settings', 'practice', 'custom', 'loadout']) {
      if (!screens.includes(sc)) continue;
      await vale(page, (v, x) => v.router.go(x, {}, { root: true }), sc);
      await page.waitForTimeout(900);
      await snap(page, sc);
      await clickAll(page, `.scr--${sc}:not(.is-leaving) [role=tab]`, `${sc}_tab`);
      if (sc === 'play') {
        for (const m of ['RIFT', 'BRIDGE', 'FRAY']) {
          await page.locator('.station', { hasText: m }).first().click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(500); await snap(page, `play_${m}`);
          await clickAll(page, '.qcard', `play_${m}_q`);
          await hoverSome(page, '.qcard, .station, .chip, button', `play_${m}_hover`, 25);
        }
      }
      if (sc === 'custom' || sc === 'practice') {
        await clickAll(page, `.scr--${sc}:not(.is-leaving) [role=radio]`, `${sc}_radio`);
        for (const sel of await page.locator(`.scr--${sc}:not(.is-leaving) select`).all()) {
          const opts = await sel.locator('option').allTextContents();
          for (const o of opts) if (BAN.test(o)) dump.hits.push({ tag: `${sc}_select`, line: o });
        }
        await hoverSome(page, `.scr--${sc}:not(.is-leaving) button`, `${sc}_hover`, 30);
      }
      if (sc === 'settings') {
        const tabs = page.locator('.scr--settings:not(.is-leaving) [role=tab]');
        for (let i = 0; i < await tabs.count(); i++) { await tabs.nth(i).click().catch(() => {}); await page.waitForTimeout(400); await snap(page, `settings_tab_${i}`); await hoverSome(page, '.scr--settings:not(.is-leaving) [title], .scr--settings:not(.is-leaving) .info, .scr--settings:not(.is-leaving) label', `settings_${i}_hover`, 25); }
      }
      if (sc === 'collection' || sc === 'shop') await hoverSome(page, `.scr--${sc}:not(.is-leaving) .fcard, .scr--${sc}:not(.is-leaving) button`, `${sc}_hover`, 20);
    }
    // all strings via cv
    const strings = await vale(page, (v) => Object.entries(v.cv.c.strings ?? {}).map(([k, x]) => `${k}: ${x}`));
    for (const l of strings) if (BAN.test(l.split(': ').slice(1).join(': '))) dump.hits.push({ tag: 'cv.strings', line: l });
    // the party: invite a partner
    await vale(page, (v) => v.router.go('play', {}, { root: true }));
    await page.waitForTimeout(800);
    await clickAll(page, '.party button, .party__add', 'party');
    await snap(page, 'party_after');
  } catch (e) { dump.errors.push(String(e?.message ?? e)); }
  dump.errors.push(...s.logs.slice(0, 10));
  await s.browser.close();
}

async function offline() {
  const s = await open('/?dev=1&server=ws://127.0.0.1:9', { hmr: false });
  const { page } = s;
  try {
    for (const t of [500, 3000, 8000]) { await page.waitForTimeout(t); await snap(page, `offline_${t}`); }
    await page.locator('button', { hasText: /Try again/i }).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400); await snap(page, 'offline_retry');
    await page.waitForTimeout(6000); await snap(page, 'offline_after');
  } catch (e) { dump.errors.push(String(e?.message ?? e)); }
  await s.browser.close();
}

async function match(mode) {
  const s = await open('/?dev=1&autopilot=match&speed=16', { hmr: false });
  const { page } = s;
  const route = () => vale(page, (v) => v.router.route.value.screen);
  try {
    await page.waitForTimeout(1500); await frames(page);
    await page.locator('.nav__item', { hasText: 'Play' }).click();
    await page.waitForTimeout(600);
    await page.locator('.station', { hasText: mode.toUpperCase() }).first().click();
    await page.waitForTimeout(500);
    if (mode === 'rift') await page.locator('.qcard', { hasText: 'Lantern Drill' }).click().catch(() => {});
    await snap(page, `${mode}_play`);
    await page.getByRole('button', { name: 'Find match' }).click();
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); await snap(page, `${mode}_queue_${i}`); if (await vale(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value)) break; }
    await waitFor(page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
    await snap(page, `${mode}_found`);
    const ready = page.getByRole('button', { name: /^Ready/ });
    if (await ready.count()) await ready.first().click();
    // draft: snapshot every second until loading
    for (let i = 0; i < 200; i++) {
      await page.waitForTimeout(700);
      await snap(page, `${mode}_draft_${i}`);
      const st = await vale(page, (v) => ({ d: !!v.state.draft.value, l: !!v.state.loading.value, m: !!v.state.match.value, seats: v.state.draft.value?.seats.map((x) => ({ n: x.name, b: x.isBot, r: x.ready })) }));
      if (i === 2 && st.seats) dump.draftSeats = st.seats;
      if (i === 3) await hoverSome(page, '.scr--draft:not(.is-leaving) .fcard, .scr--draft:not(.is-leaving) .seat, .scr--draft:not(.is-leaving) button', `${mode}_draft_hover`, 15);
      if (st.l || st.m) break;
    }
    // draft seat DOM: do bot seats differ structurally from yours/others?
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(800); await snap(page, `${mode}_loading_${i}`); if (await vale(page, (v) => v.state.match.value?.view.phase === 'live')) break; }
    await waitFor(page, (v) => v.state.match.value?.view.phase === 'pregame' || v.state.match.value?.view.phase === 'live', 90000);
    await page.locator('.hud .dbar').first().waitFor({ state: 'visible', timeout: 60000 });
    await shot(page, `_tmp_wording_${mode}_hud`).catch(() => {});
    let t = 0;
    for (let i = 0; i < 400; i++) {
      await page.waitForTimeout(1500);
      await snap(page, `${mode}_hud_${i}`);
      if (i % 5 === 1) { await page.keyboard.down('Tab'); await page.waitForTimeout(300); const sb = await snap(page, `${mode}_scoreboard_${i}`); if (i === 1) { dump[`${mode}_scoreboard`] = sb.text.slice(0, 3000); dump[`${mode}_scoreboard_rows`] = await page.evaluate(() => [...document.querySelectorAll('.hud .hscore tr, .hud .hscore [class*=row]')].map((r) => r.className).slice(0, 20)); await shot(page, `_tmp_wording_${mode}_scoreboard`).catch(() => {}); } await page.keyboard.up('Tab'); }
      if (i === 3) { await page.keyboard.press('KeyP'); await page.waitForTimeout(500); await snap(page, `${mode}_shop`); await hoverSome(page, '.hud .lshop button, .hud .lshop [class*=item]', `${mode}_shop_hover`, 12); await page.keyboard.press('Escape'); }
      if (i === 4) { await hoverSome(page, '.hud .dbar *[class*=slot], .hud .dbar button', `${mode}_bar_hover`, 12); }
      if (i === 6) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); await snap(page, `${mode}_menu`); await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      t = await vale(page, (v) => ({ end: !!v.state.ending.value || v.router.route.value.screen === 'postgame' }));
      if (t.end) break;
    }
    await waitFor(page, (v) => v.state.ending.value || v.router.route.value.screen === 'postgame', 1500000);
    await page.waitForTimeout(600); await snap(page, `${mode}_end`);
    await waitFor(page, (v) => v.router.route.value.screen === 'postgame', 30000);
    await page.waitForTimeout(1500); await snap(page, `${mode}_postgame`);
    await clickAll(page, '.scr--postgame:not(.is-leaving) [role=tab]', `${mode}_postgame_tab`);
    await shot(page, `_tmp_wording_${mode}_postgame`).catch(() => {});
    dump[`${mode}_postgame_rows`] = await page.evaluate(() => [...document.querySelectorAll('.scr--postgame tbody tr')].map((r) => r.className + ' | ' + r.innerText.replace(/\s+/g, ' ').slice(0, 80)));
    await hoverSome(page, '.scr--postgame:not(.is-leaving) button, .scr--postgame:not(.is-leaving) .itemslot', `${mode}_pg_hover`, 15);
    dump[`${mode}_route_end`] = await route();
  } catch (e) { dump.errors.push(`${mode}: ${String(e?.message ?? e)}`); await shot(page, `_tmp_wording_${mode}_FAIL`).catch(() => {}); }
  dump.errors.push(...s.logs.slice(0, 10).map((l) => `${mode}: ${l}`));
  await s.browser.close();
}

const plan = which === 'all' ? ['menus', 'offline', 'rift', 'bridge', 'fray'] : [which];
for (const p of plan) { console.log('==', p); if (p === 'menus') await menus(); else if (p === 'offline') await offline(); else await match(p); }
mkdirSync(dirname(OUT), { recursive: true });
const uniq = [...new Map(dump.hits.map((h) => [h.line, h])).values()];
const uniqM = [...new Map(dump.markers.map((h) => [h.m, h])).values()];
writeFileSync(OUT, JSON.stringify({ ...dump, hits: uniq, markers: uniqM }, null, 1));
console.log(`snaps ${dump.snaps.length}  hits ${uniq.length}  markers ${uniqM.length}  errors ${dump.errors.length}`);
for (const h of uniq.slice(0, 40)) console.log('HIT', h.tag, '|', h.line);
for (const m of uniqM.slice(0, 20)) console.log('MARK', m.tag, '|', m.m);
for (const e of dump.errors.slice(0, 20)) console.log('ERR', e);
