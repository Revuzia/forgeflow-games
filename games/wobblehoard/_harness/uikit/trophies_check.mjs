// UI B6b: the Trophies and Records screen, measured. Three parts (one browser at a time; ports 5440-5449 only; everything started is stopped):
//   kit   the REAL screen on the kit page (B6b scenes: locked / some / all / filters / records) at the 8 kit sizes x 4 modes (normal, calm, contrast, forced):
//         a named dialog with one h2, K02 hit boxes (elementFromPoint grid), no horizontal scroll, the keyboard walk (Tab stays inside, a 3 px ring on every stop, Esc closes),
//         the switch and the filter work, Calm leaves no running transform animation, contrast-more has no blur, forced-colors separates earned from locked and keeps real text
//   game  the REAL game (dev server): the Trophies row (Menu) and chip (title) open it, inert behind, Esc and focus return; a real squeeze unlocks a trophy -> a trophy toast with the
//         first-ever line and the 'trophy' sound cue, said once; the screen then shows it earned with a date and Records counts it; Space and the tool keys do not reach the toy under it
//   prod  a production build into the scratch folder: the screen is a `later-*` chunk (js + css), the first-play budget G0b holds, the screen opens from the Menu with 0 CSP violations
//   node _harness/uikit/trophies_check.mjs [--only=kit,game,prod] [--sizes=1280x800,...] [--modes=normal,calm,contrast,forced] [--port=5442] [--out=<scratch dir>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const ONLY = opt('only', 'kit,game,prod').split(',').filter(Boolean);
const PORT = Number(opt('port', '5442'));
const wantSizes = opt('sizes').split(',').filter(Boolean);
const MODES = opt('modes', 'normal,calm,contrast,forced').split(',').filter(Boolean);
const OUT = resolve(opt('out') || resolve(ROOT, '_shots', 'uikit', 'B6b_check'));
const SIZES = KIT_SIZES.filter((s) => !wantSizes.length || wantSizes.includes(`${s.w}x${s.h}`));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
let total = 0, bad = 0, section = '';
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${section}] ${name}${extra !== '' ? '  ' + extra : ''}`); };
const stamp = (m) => console.log(`     .. ${((Date.now() - T0) / 1000).toFixed(0)} s  ${m}`);
const CTX = {
  normal: { reducedMotion: 'no-preference' }, calm: { reducedMotion: 'reduce' }, contrast: { contrast: 'more' }, forced: { forcedColors: 'active' },
};
const QUERY = { normal: '', calm: '&calm=1', contrast: '', forced: '' };

let browser, vite;
const errsOf = [];
const watch = (page) => { const errs = []; errsOf.push(errs); page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); }); page.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); return errs; };

/** the K02 grid: how much of a 44 x 44 box around each focusable's centre lands on the control itself (the control's own pixels, 4 px steps) */
const hitReport = () => {
  const root = document.querySelector('.tro');
  const sel = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const rows = [];
  for (const el of root.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let hit = 0, n = 0;
    for (let dy = -20; dy <= 20; dy += 4) for (let dx = -20; dx <= 20; dx += 4) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      n++;
      const top = document.elementFromPoint(x, y);
      if (top && (top === el || el.contains(top) || (top.closest('label') && top.closest('label').contains(el)))) hit++;
    }
    rows.push({ name: (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), cov: n ? hit / n : 1 });
  }
  for (const s of document.querySelectorAll('*')) if (s.scrollTop > 0) s.scrollTop = 0;
  return rows;
};

async function kitPage(size, mode, only) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, ...CTX[mode] });
  const page = await context.newPage();
  const errs = watch(page);
  await page.goto(`${vite.url}_harness/uikit/index.html?batch=B6b&only=${only}${QUERY[mode]}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 60000 });
  await sleep(500);
  return { context, page, errs };
}

async function kitPart() {
  section = 'kit';
  for (const size of SIZES) {
    for (const mode of MODES) {
      const tag = `${size.w}x${size.h} ${mode}`;
      const { context, page, errs } = await kitPage(size, mode, 'trophies-some');
      const f = await page.evaluate(() => {
        const d = document.querySelector('.tro');
        const t = document.getElementById(d.getAttribute('aria-labelledby'));
        const r = d.getBoundingClientRect();
        const st = document.querySelector('.kp-scene-b4').getBoundingClientRect();   // (the kit page's scene is the size of the viewport, drawn under its own heading)
        const sc = document.querySelector('.tro-scroll');
        return {
          role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), name: t?.textContent, h1: document.querySelectorAll('.tro h1').length, h2: document.querySelectorAll('.tro h2').length,
          cards: document.querySelectorAll('.tro-card').length, hiddenName: [...document.querySelectorAll('.tro-card[data-state="hidden"] .tro-name')].map((e) => e.textContent),
          fits: r.left >= st.left - 1 && r.top >= st.top - 1 && r.right <= st.right + 1 && r.bottom <= st.bottom + 1, hscroll: document.documentElement.scrollWidth > innerWidth || sc.scrollWidth > sc.clientWidth + 1,
          layout: document.body.dataset.layout, focus: document.activeElement?.className,
        };
      });
      check(`${tag}: a modal dialog named "Trophies", one h2 and no h1, 20 cards, the hidden one says ???, the panel is inside the viewport`, f.role === 'dialog' && f.modal === 'true' && f.name === 'Trophies' && f.h2 === 1 && f.h1 === 0 && f.cards === 20 && f.hiddenName.every((n) => n === '???') && f.fits, JSON.stringify(f));
      check(`${tag}: no horizontal scroll (page or pane)`, !f.hscroll);
      const hits = await page.evaluate(hitReport);
      const worst = hits.reduce((a, b) => (b.cov < a.cov ? b : a), { cov: 1, name: '-' });
      check(`${tag}: K02 every focusable has a 44x44 hit box (${hits.length} controls, worst ${(worst.cov * 100).toFixed(0)} % "${worst.name}")`, hits.length >= 9 && hits.every((r) => r.cov >= 0.85 && r.w >= 40 && r.h >= 32), JSON.stringify(hits.filter((r) => r.cov < 0.85 || r.w < 40 || r.h < 32)));

      if (mode === 'normal' && [1280, 390, 358].includes(size.w)) await keyboardWalk(page, tag);
      if (mode === 'normal') await interact(page, tag);
      if (mode === 'calm') {
        await sleep(900);
        const run = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getKeyframes().some((k) => 'transform' in k)).length);
        check(`${tag}: Calm leaves 0 running transform animations once the screen has settled`, run === 0, `${run} running`);
      }
      if (mode === 'contrast') {
        const c = await page.evaluate(() => ({ blur: [...document.querySelectorAll('.tro, .tro *')].some((e) => { const b = getComputedStyle(e).backdropFilter; return b && b !== 'none'; }), jelly: getComputedStyle(document.querySelector('.tro-title svg')).display, ring: getComputedStyle(document.documentElement).getPropertyValue('--k-ring-w') }));
        check(`${tag}: prefers-contrast: more has no backdrop blur and shows the real text of the heading (the jelly drawing is off)`, !c.blur && c.jelly === 'none', JSON.stringify(c));
      }
      if (mode === 'forced') {
        const c = await page.evaluate(() => {
          const e = document.querySelector('.tro-card[data-state="earned"] .tro-medal'), l = document.querySelector('.tro-card[data-state="locked"] .tro-medal');
          const cs = (x) => { const s = getComputedStyle(x); return { bg: s.backgroundColor, bd: s.borderTopStyle + ' ' + s.borderTopWidth, fg: s.color }; };
          const on = document.querySelector('.tro-chip[aria-pressed="true"]'), off = document.querySelector('.tro-chip[aria-pressed="false"]');
          const seg = document.querySelector('.tro-seg .k-seg-input:checked ~ .k-seg-face'), segOff = document.querySelector('.tro-seg .k-seg-input:not(:checked) ~ .k-seg-face');
          const p = document.querySelector('.tro-hero .k-progress-fill');
          return { earned: cs(e), locked: cs(l), chipOn: getComputedStyle(on).backgroundColor, chipOff: getComputedStyle(off).backgroundColor, segOn: getComputedStyle(seg).backgroundColor, segOff: getComputedStyle(segOff).backgroundColor, fill: getComputedStyle(p).backgroundColor, jelly: getComputedStyle(document.querySelector('.tro-title svg')).display, forced: matchMedia('(forced-colors: active)').matches };
        });
        check(`${tag}: forced-colors: an earned medal, a locked one, the pressed chip, the checked segment and the bar fill are told apart by system colours; the heading is real text`, c.forced && c.earned.bg !== c.locked.bg && c.earned.bd !== c.locked.bd && c.chipOn !== c.chipOff && c.segOn !== c.segOff && c.fill !== 'rgba(0, 0, 0, 0)' && c.jelly === 'none', JSON.stringify(c));
      }
      check(`${tag}: no page error, no console error`, errs.length === 0, errs.join(' | '));
      await context.close();
    }
    stamp(`kit ${size.w}x${size.h} done`);
  }
}

/** Tab-only walk inside the open screen: every stop is inside it, shows a 3 px ring, and Shift+Tab / Tab wrap; Esc closes */
async function keyboardWalk(page, tag) {
  const seen = [];
  const ring = () => page.evaluate(() => {
    const a = document.activeElement; if (!a) return null;
    const t = a.matches('.k-seg-input') ? a.nextElementSibling : a;   // (the radio is invisible: its face carries the ring)
    const s = getComputedStyle(t);
    const base = ['tro-close', 'tro-scroll', 'tro-chip', 'k-seg-input'].find((c) => a.classList.contains(c)) ?? a.className;
    return { id: base + (a.dataset.filter ? ':' + a.dataset.filter : '') + (a.matches('.k-seg-input') ? ':' + a.value : ''), inside: !!a.closest('.tro'), w: parseFloat(s.outlineWidth), st: s.outlineStyle };
  });
  await page.evaluate(() => document.activeElement?.blur?.());
  const first = await page.evaluate(() => { document.querySelector('.tro-scroll').focus(); return document.activeElement.className; });
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); seen.push(await ring()); }
  const ids = new Set(seen.map((s) => s && s.id));
  const wantChips = ['all', 'bronze', 'silver', 'gold', 'diamond'].every((f) => ids.has(`tro-chip:${f}`));
  check(`${tag}: K04 Tab-only: the walk stays inside the screen (10 stops), visits the switch, the five tier chips, the close button and the pane, a 3 px ring at every stop`,
    seen.every((s) => s && s.inside && s.w >= 3 && s.st !== 'none') && wantChips && ids.has('tro-close') && ids.has('tro-scroll') && [...ids].some((x) => x && x.startsWith('k-seg-input')), `${first} -> ${[...ids].join(', ')}${seen.filter((s) => !(s && s.inside && s.w >= 3)).length ? ' RING/INSIDE FAIL ' + JSON.stringify(seen.filter((s) => !(s && s.inside && s.w >= 3))) : ''}`);
  await page.keyboard.press('Shift+Tab');
  check(`${tag}: Shift+Tab goes back one stop and stays inside`, await page.evaluate(() => !!document.activeElement?.closest('.tro')));
}

async function interact(page, tag) {
  // the switch: Records, then back
  await page.evaluate(() => document.querySelector('.tro-seg .k-seg-input[value="records"]').click());
  await sleep(150);
  const r = await page.evaluate(() => ({ pane: document.querySelector('.tro-pane')?.dataset.pane, title: document.querySelector('.tro-title')?.textContent, tiles: document.querySelectorAll('.tro-tile').length, bars: document.querySelectorAll('.tro-bar').length, since: document.querySelector('.tro-since')?.textContent, label: document.querySelector('.tro-scroll').getAttribute('aria-label') }));
  check(`${tag}: the switch shows Records (the heading follows, 8 counters, 6 rarity bars, the since line)`, r.pane === 'records' && r.title === 'Records' && r.tiles === 8 && r.bars === 6 && /^Counting started .+ Play before that is not counted\.$/.test(r.since ?? '') && r.label === 'Records', JSON.stringify(r));
  await page.evaluate(() => document.querySelector('.tro-seg .k-seg-input[value="trophies"]').click());
  await sleep(100);
  // the tier filter
  await page.evaluate(() => document.querySelector('.tro-chip[data-filter="gold"]').click());
  await sleep(100);
  const g = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.tro-card')].map((c) => c.dataset.tier), pressed: [...document.querySelectorAll('.tro-chip[aria-pressed="true"]')].map((c) => c.dataset.filter), list: document.querySelector('.tro-list').getAttribute('aria-label') }));
  check(`${tag}: the Gold chip filters to the 3 gold trophies (one pressed chip, the list named)`, g.cards.length === 3 && g.cards.every((t) => t === 'gold') && g.pressed.join() === 'gold' && g.list === 'Gold trophies', JSON.stringify(g));
  await page.evaluate(() => document.querySelector('.tro-chip[data-filter="all"]').click());
  // Esc closes (the kit page does what hudBinding.escape does: the top layer)
  await page.keyboard.press('Escape');
  await sleep(100);
  check(`${tag}: Esc closes the screen`, await page.evaluate(() => !document.querySelector('.tro')));
}

/* ───────────────────────────────────────────────── the real game ───────────────────────────────────────────────── */
async function openGame(size = { w: 1280, h: 800 }, query = '?dev=1&rseed=7') {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await context.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
  const page = await context.newPage();
  const errs = watch(page);
  await page.goto(`${vite.url}index.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, errs };
}
const wake = async (page) => { await page.locator('.cta').click({ force: true }); await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 }); await page.waitForFunction(() => !document.querySelector('.title'), null, { timeout: 30000 }); };
/** every finite animation has ended (a slow machine renders few frames: the entrance can still be scaling at 600 ms) */
const settled = (page) => page.evaluate(async () => { for (let i = 0; i < 200; i++) { if (!document.getAnimations().some((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))) return true; await new Promise((r) => setTimeout(r, 50)); } return false; });
const squeeze = (page) => page.evaluate(() => {
  const wh = window.__WH__; const B = wh.bodyScreen(); wh.pause(); wh.step(1 / 60, 30);
  wh.pointerDown(B.x, B.y - 0.45 * B.rPx / innerHeight);
  wh.step(1 / 60, 96);
  wh.pointerUp(); wh.step(1 / 60, 20);
  wh.resume?.();
});

async function gamePart() {
  section = 'game';
  // ---- the title chip
  {
    const { context, page, errs } = await openGame();
    const chips = await page.evaluate(() => [...document.querySelectorAll('.title [data-chip]')].map((c) => c.dataset.chip));
    check('the title has a Trophies chip (its flag in shell/destinations.ts is on)', chips.includes('trophies'), chips.join());
    await sleep(1800);   // (the intro is 1.2 s)
    await page.screenshot({ path: resolve(OUT, 'game_title_1280x800.png') });
    await page.evaluate(() => document.querySelector('.title [data-chip="trophies"]').focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('.tro', { timeout: 15000 });
    await settled(page);
    await page.screenshot({ path: resolve(OUT, 'game_title_trophies_1280x800.png') });
    const o = await page.evaluate(() => { const d = document.querySelector('.tro'); const r = d.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + 40); return { titleInert: document.querySelector('.title').hasAttribute('inert'), above: !!top && d.contains(top), name: document.getElementById(d.getAttribute('aria-labelledby')).textContent, focus: document.activeElement?.className, cards: document.querySelectorAll('.tro-card').length, count: document.querySelector('.tro-count')?.textContent, acct: document.querySelector('.tro-acct-text')?.textContent, xp: document.querySelector('.tro-xpline')?.textContent }; });
    check('from the title chip: it opens ABOVE the title (the title goes inert), named "Trophies", 20 cards, "0 / 20", "Saved on this device.", the XP line', o.titleInert && o.above && o.name === 'Trophies' && o.cards === 20 && /^0 \/ 20/.test(o.count ?? '') && o.acct === 'Saved on this device.' && o.xp === '0 of 355 XP (counts when signed in)', JSON.stringify(o));
    await page.keyboard.press('Escape'); await sleep(400);
    const c = await page.evaluate(() => ({ gone: !document.querySelector('.tro'), inert: document.querySelector('.title').hasAttribute('inert'), focus: document.activeElement?.getAttribute('data-chip') }));
    check('Esc closes it, the title is live again and focus returns to the chip that opened it', c.gone && !c.inert && c.focus === 'trophies', JSON.stringify(c));
    check('no page error, no console error (title chip path)', errs.length === 0, errs.join(' | '));
    await context.close();
  }
  // ---- a real unlock, the toast, the sound, the Menu row, the screen
  {
    const { context, page, errs } = await openGame();
    await wake(page);
    await page.evaluate(() => { window.__said = []; const l = document.getElementById('wh-live'); new MutationObserver(() => { if (l.textContent) window.__said.push(l.textContent); }).observe(l, { childList: true, characterData: true, subtree: true }); });
    const cues0 = await page.evaluate(() => (window.__WH_UI__.cues().kinds.trophy ?? 0));
    await squeeze(page);
    const t = await page.evaluate(async () => {
      for (let i = 0; i < 200; i++) {
        const el = document.querySelector('.toast[data-kind="trophy"]');
        if (el) return { text: el.textContent, hidden: el.getAttribute('aria-hidden'), chip: el.querySelector('.k-tier')?.getAttribute('data-tier'), icon: !!el.querySelector('.k-icon') };
        await new Promise((r) => setTimeout(r, 25));
      }
      return null;
    });
    check('a real squeeze earns "Hello, Squishy": a trophy toast with a Bronze chip and the first-ever line "Find your trophies in the Menu."', !!t && /Hello, Squishy/.test(t.text) && /Find your trophies in the Menu\./.test(t.text) && t.chip === 'bronze' && t.icon && t.hidden === 'true', JSON.stringify(t));
    await page.waitForFunction(() => window.__said.some((x) => /trophy/i.test(x)), null, { timeout: 5000 }).catch(() => {});   // (the live region speaks 250 ms after the toast: bursts are merged)
    await sleep(600);
    const s = await page.evaluate(() => ({ said: window.__said.filter((x) => /trophy/i.test(x)), cues: window.__WH_UI__.cues().kinds.trophy ?? 0 }));
    check('the live region said it ONCE ("Bronze trophy: Hello, Squishy.") and the trophy sound cue fired', s.said.length === 1 && s.said[0] === 'Bronze trophy: Hello, Squishy.' && s.cues > cues0, JSON.stringify(s));
    await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 });
    // the Menu row says "1 / 20" and opens the screen
    await page.click('button[aria-label="Menu"]');
    await page.waitForSelector('#wh-menu', { timeout: 10000 }); await sleep(400);
    const row = await page.evaluate(() => { const r = document.querySelector('#wh-menu [data-key="trophies"]'); return r ? { text: r.textContent.trim().replace(/\s+/g, ' '), order: [...document.querySelectorAll('#wh-menu .menu-link')].map((x) => x.dataset.key).join() } : null; });
    check('the Menu has a Trophies row after Settings with "1 / 20"', !!row && /^Trophies\s*1 \/ 20$/.test(row.text) && /^settings,trophies/.test(row.order), JSON.stringify(row));
    await page.click('#wh-menu [data-key="trophies"]');
    await page.waitForSelector('.tro', { timeout: 15000 }); await sleep(700);
    const o = await page.evaluate(() => {
      const d = document.querySelector('.tro'); const card = document.querySelector('.tro-card[data-slug="first_squish"]');
      return { menuGone: !document.querySelector('#wh-menu'), hudInert: document.querySelector('.hud').hasAttribute('inert'), earned: card?.dataset.state, status: card?.querySelector('.tro-status')?.textContent.trim(), tier: card?.querySelector('.tro-tier')?.textContent.trim(), count: document.querySelector('.tro-count')?.textContent, xp: document.querySelector('.tro-xpline')?.textContent, focus: document.activeElement?.className, name: document.getElementById(d.getAttribute('aria-labelledby')).textContent };
    });
    await settled(page);
    await page.screenshot({ path: resolve(OUT, 'game_menu_trophies_1280x800.png') });
    check('from the Menu: the Menu is gone, the HUD behind is inert, "Hello, Squishy" is earned with a date, "1 / 20", "5 of 355 XP (counts when signed in)"', o.menuGone && o.hudInert && o.earned === 'earned' && /^Earned .+\d{4}/.test(o.status ?? '') && /Bronze/i.test(o.tier ?? '') && /^1 \/ 20/.test(o.count ?? '') && o.xp === '5 of 355 XP (counts when signed in)', JSON.stringify(o));
    // the toy must not hear the keyboard through the screen: Space held, and the tool keys
    const before = await page.evaluate(() => ({ ev: window.__WH__.state().events.length, last: window.__WH__.state().events.map((e) => e.kind + e.t).join(), tool: window.__WH__.shell.tools().tool }));
    for (const k of ['c', 's', '2', 'h']) await page.keyboard.press(k);
    await page.keyboard.down('Space'); await sleep(350); await page.keyboard.up('Space'); await sleep(250);
    const after = await page.evaluate(() => ({ last: window.__WH__.state().events.map((e) => e.kind + e.t).join(), tool: window.__WH__.shell.tools().tool, hoard: !!document.querySelector('.hoard[data-open="true"]'), screen: !!document.querySelector('.tro') }));
    check('keys under the screen do not reach the toy: C S 2 H and a held Space change nothing (same events, the Hand still in hand, the Hoard not opened) and the screen stays', after.last === before.last && after.tool === 'hand' && before.tool === 'hand' && !after.hoard && after.screen, JSON.stringify({ before, after }));
    // Records counts the squeeze
    await page.evaluate(() => document.querySelector('.tro-seg .k-seg-input[value="records"]').click()); await sleep(200);
    const rec = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tro-tile')].map((t) => [t.dataset.record, t.querySelector('.tro-tile-n').textContent])));
    check('Records: Squeezes counts the real squeeze (>= 1), the others are 0 or real', Number(rec.squeezes) >= 1 && Object.keys(rec).length === 8, JSON.stringify(rec));
    await page.evaluate(() => document.querySelector('.tro-seg .k-seg-input[value="trophies"]').click()); await sleep(100);
    await page.keyboard.press('Escape'); await sleep(500);
    const c = await page.evaluate(() => ({ gone: !document.querySelector('.tro'), focus: document.activeElement?.getAttribute('aria-label'), hudInert: document.querySelector('.hud').hasAttribute('inert') }));
    check('Esc closes it, the HUD is live again and focus returns to the Menu button', c.gone && !c.hudInert && c.focus === 'Menu', JSON.stringify(c));
    // a SECOND unlock while the screen is open updates it live (the toast comes too)
    await page.click('button[aria-label="Menu"]'); await page.waitForSelector('#wh-menu'); await sleep(300);
    await page.click('#wh-menu [data-key="trophies"]'); await page.waitForSelector('.tro'); await sleep(500);
    check('opened again: still one screen, the same trophy earned', await page.evaluate(() => document.querySelectorAll('.tro').length === 1 && document.querySelector('.tro-card[data-slug="first_squish"]').dataset.state === 'earned'));
    await page.keyboard.press('Escape'); await sleep(300);
    const csp = await page.evaluate(() => window.__csp ?? []);
    check('0 CSP violations, no page error, no console error', csp.length === 0 && errs.length === 0, `${csp.join(' | ')} ${errs.join(' | ')}`);
    await context.close();
  }
  // ---- the portal phone, the real game
  {
    const { context, page, errs } = await openGame({ w: 358, h: 201 });
    await wake(page);
    await page.click('button[aria-label="Menu"]'); await page.waitForSelector('#wh-menu'); await sleep(400);
    await page.click('#wh-menu [data-key="trophies"]'); await page.waitForSelector('.tro'); await settled(page);
    const g = await page.evaluate(() => { const r = document.querySelector('.tro').getBoundingClientRect(); return { w: r.width, h: r.height, layout: document.body.dataset.layout, seg: [...document.querySelectorAll('.tro-seg .k-seg-face')].map((f) => f.getBoundingClientRect().width) }; });
    check('the portal phone (358x201): the screen is the whole box, the switch shows two icons (>= 44 wide each)', g.layout === 'tiny' && g.w >= 357 && g.h >= 200 && g.seg.every((w) => w >= 44), JSON.stringify(g));
    await page.screenshot({ path: resolve(OUT, 'game_358x201_trophies.png') });
    await page.keyboard.press('Escape'); await sleep(300);
    check('no page error (portal phone)', errs.length === 0, errs.join(' | '));
    await context.close();
  }
}

/* ───────────────────────────────────────────────── a production build ───────────────────────────────────────────────── */
async function prodPart() {
  section = 'prod';
  const dist = resolve(OUT, 'dist');
  const vb = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  let log = '';
  try { log = execFileSync(process.execPath, [vb, 'build', '--outDir', dist, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }); } catch (e) { log = String(e.stdout ?? '') + String(e.stderr ?? e.message); }
  const files = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = resolve(d, e.name); if (e.isDirectory()) walk(p); else files.push({ name: e.name, p, size: statSync(p).size }); } };
  if (existsSync(dist)) walk(dist);
  const later = files.filter((f) => f.name.startsWith('later-trophies'));
  const g0b = /\[G0b\][^\n]*/.exec(log)?.[0] ?? '(no G0b line)', g0 = /\[G0\][^\n]*/.exec(log)?.[0] ?? '(no G0 line)';
  const css = files.filter((f) => f.name.endsWith('.css'));
  const cssRaw = css.reduce((a, f) => a + f.size, 0), cssGz = css.reduce((a, f) => a + gzipSync(readFileSync(f.p), { level: 9 }).length, 0);
  check('the screen is a later-* chunk: a later-trophies js AND a later-trophies css exist in dist, and the first-play budget G0b holds', later.some((f) => f.name.endsWith('.js')) && later.some((f) => f.name.endsWith('.css')) && /\[G0b\]/.test(g0b) && !/OVER BUDGET/.test(log), `${later.map((f) => `${f.name} ${f.size} B`).join(', ')} | ${g0} | ${g0b}`);
  const lw = later.reduce((a, f) => a + gzipSync(readFileSync(f.p), { level: 9 }).length, 0);
  stamp(`later-trophies gzip ${lw} B; all css ${(cssRaw / 1024).toFixed(1)} KB raw ${(cssGz / 1024).toFixed(1)} KB gzip (K05 cap 120 / 30)`);
  check('K05: all dist css <= 120 KB raw and <= 30 KB gzip', cssRaw <= 120 * 1024 && cssGz <= 30 * 1024, `${(cssRaw / 1024).toFixed(1)} KB raw, ${(cssGz / 1024).toFixed(1)} KB gzip`);
  const idx = readFileSync(resolve(dist, 'index.html'), 'utf8');
  check('the first-play index.html does not reference the later-trophies chunk (it is a dynamic import)', !/later-trophies/.test(idx));
  // open it from the Menu in the production bundle
  const { createServer } = await import('node:http');
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = createServer((req, res) => {
    const u = decodeURIComponent((req.url ?? '/').split('?')[0]); const p = resolve(dist, '.' + (u === '/' ? '/index.html' : u));
    if (!p.startsWith(dist) || !existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; res.end('no'); return; }
    const ext = p.slice(p.lastIndexOf('.'));
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream'); res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(PORT + 2, '127.0.0.1', r));
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
    const page = await context.newPage();
    const errs = watch(page);
    const reqs = []; page.on('request', (r) => reqs.push(r.url()));
    await page.goto(`http://127.0.0.1:${PORT + 2}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.cta:not([disabled])', { timeout: 120000 });
    const before = reqs.filter((u) => /later-trophies/.test(u)).length;
    await page.locator('.cta').click({ force: true });
    await page.waitForSelector('button[aria-label="Menu"]', { timeout: 30000 }); await sleep(800);
    await page.click('button[aria-label="Menu"]'); await page.waitForSelector('#wh-menu'); await sleep(400);
    await page.click('#wh-menu [data-key="trophies"]');
    await page.waitForSelector('.tro', { timeout: 20000 }); await sleep(500);
    const o = await page.evaluate(() => ({ cards: document.querySelectorAll('.tro-card').length, sheet: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.selectorText && r.selectorText.includes('.tro-card')); } catch { return false; } }), name: document.getElementById(document.querySelector('.tro').getAttribute('aria-labelledby'))?.textContent }));
    const after = reqs.filter((u) => /later-trophies/.test(u));
    check('production: the chunk was NOT fetched before the press and was fetched (js + css) after it; the screen opens with its styles', before === 0 && after.some((u) => u.endsWith('.js')) && after.some((u) => u.endsWith('.css')) && o.cards === 20 && o.sheet && o.name === 'Trophies', JSON.stringify({ before, after: after.map((u) => u.split('/').pop()), o }));
    await page.screenshot({ path: resolve(OUT, 'prod_1280x800_trophies.png') });
    const csp = await page.evaluate(() => window.__csp ?? []);
    check('production: strict CSP, 0 violations, no page error, no console error', csp.length === 0 && errs.length === 0, `${csp.join(' | ')} ${errs.join(' | ')}`);
    await context.close();
  } finally { server.close(); }
}

async function main() {
  vite = await startVite(PORT);
  browser = await launch();
  try {
    if (ONLY.includes('kit')) await kitPart();
    if (ONLY.includes('game')) await gamePart();
    if (ONLY.includes('prod')) await prodPart();
  } finally {
    await browser.close().catch(() => {});
    vite.stop();
  }
  console.log(`\n${total - bad}/${total} checks passed${bad ? `, ${bad} FAILED` : ''} (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); try { vite?.stop(); } catch { /* ignore */ } process.exit(1); });
