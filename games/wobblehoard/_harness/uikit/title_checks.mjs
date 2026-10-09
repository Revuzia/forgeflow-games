// Live checks of the title card and the loading card (UI.md 4, 6; batch B2b), in the REAL app (real stage, real audio engine) at ?dev=1.
//   node _harness/uikit/title_checks.mjs [--only=boot,slow,dom,intro,poke,sound,calm,modes,sizes,start] [--port=5438] [--boot-shots]
// Sections: boot (the loading card follows the count of finished boot events) | slow (no script: the 12 s watchdog line) | dom (names, roles, focus,
// chips, tab order) | intro (any key skips it; it ends by itself) | poke (a tap squashes letters) | sound (the Sound chip) | calm (Calm and reduced motion:
// no pose, no drop, no idle, no transform animation) | modes (contrast more, forced colours) | sizes (the 8 kit sizes: layout, no overlap, 44 px hit boxes) |
// start (the button starts the game and the title leaves). --boot-shots writes the static card at the 8 sizes to _shots/uikit/B2b/boot/.
// One browser at a time; ports 5437-5439 are this lane's; everything started is stopped.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5438'));
const ONLY = opt('only').split(',').filter(Boolean);
const OUT = resolve(ROOT, '_shots', 'uikit', 'B2b');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, bad = 0, section = '';
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${section}] ${name}${extra !== '' ? '  ' + extra : ''}`); };
const want = (s) => !ONLY.length || ONLY.includes(s);

let browser, vite;
const QUERY = '?dev=1&titlechips=1';
/** Opens the app, resolves when the title card is up (phase title). `hold` keeps the intro's end timer from firing so a key press can be tested. */
async function openTitle({ size = { w: 1280, h: 800 }, ctx = {}, query = QUERY, hold = false, js = true } = {}) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, ...ctx, javaScriptEnabled: js });
  const page = await context.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errs.push('requestfailed: ' + r.url()));
  if (hold) await page.addInitScript(() => { window.__holdIntro = true; const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => (window.__holdIntro && ms === 1350 ? 0 : st(fn, ms, ...a)); });
  await page.goto(vite.url + query, { waitUntil: 'load' });
  if (js) await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, errs };
}
/** Everything the title shows, as numbers (animations parked at their start so a moving lockup does not blur the boxes). */
const factsInPage = () => {
  document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = 0; } catch { /* ignore */ } });
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const q = (s) => document.querySelector(s);
  const svgs = [...document.querySelectorAll('.title-mark .jl-svg')].map(r);
  const parts = { plate: r(q('.title-promise')), cta: r(q('.cta')), ...Object.fromEntries([...document.querySelectorAll('.title-chip')].map((c, i) => [`chip${i}:${c.dataset.chip}`, r(c)])) };
  svgs.forEach((s, i) => { parts[`word${i}`] = s; });
  const hits = [];
  for (const el of document.querySelectorAll('.title button')) {
    const b = el.getBoundingClientRect();
    if (!b.width) continue;
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    let n = 0, hit = 0;
    for (let dy = -20; dy <= 20; dy += 4) for (let dx = -20; dx <= 20; dx += 4) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      n++;
      const t = document.elementFromPoint(x, y);
      if (t && (t === el || el.contains(t))) hit++;
    }
    hits.push({ n: (el.dataset.chip || el.className.split(' ')[0]), w: Math.round(b.width), h: Math.round(b.height), cov: n ? hit / n : 1 });
  }
  const names = Object.keys(parts);
  const overlaps = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = parts[names[i]], b = parts[names[j]];
    if (a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1) overlaps.push(`${names[i]}/${names[j]}`);
  }
  const outside = names.filter((k) => parts[k] && (parts[k].x < -0.5 || parts[k].y < -0.5 || parts[k].r > innerWidth + 0.5 || parts[k].b > innerHeight + 0.5));
  return { layout: q('.title')?.dataset.layout, iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, words: svgs.length, lines: new Set(svgs.map((s) => Math.round(s.y / 6))).size, cap: svgs[0] ? svgs[0].h / (q('.title-mark use[transform]') ? 1.36 : 1.24) : 0, cta: parts.cta, plate: parts.plate, overlaps, outside, hits, chips: document.querySelectorAll('.title-chip').length };
};

try {
  vite = await startVite(PORT);
  browser = await launch();

  // ------------------------------------------------------------------ the loading card follows the count of finished boot events (R09)
  if (want('boot')) {
    section = 'boot';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.addInitScript(() => {
      window.__ev = [];
      window.addEventListener('wh:boot-progress', (e) => {
        const b = document.getElementById('boot');
        window.__ev.push({ done: e.detail.done, total: e.detail.total, step: b?.dataset.step, line: document.getElementById('boot-line')?.textContent, p: b?.style.getPropertyValue('--p'), title: !!document.querySelector('.title'), bootShown: !!b && getComputedStyle(b).display !== 'none' });
      });
    });
    await page.route('**/src/render/stage.ts*', async (route) => { await sleep(1800); await route.continue(); });   // the biggest import finishes last
    await page.goto(vite.url + '?dev=1', { waitUntil: 'load' });
    const first = await page.evaluate(() => ({ line: document.getElementById('boot-line')?.textContent, step: document.getElementById('boot')?.dataset.step, role: document.getElementById('boot')?.getAttribute('role') }));
    check('the card shows the first line and step 0 while scripts load', first.line === 'Warming up the jelly…' && (first.step === '0') && first.role === 'status', JSON.stringify(first));
    await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    const ev = await page.evaluate(() => window.__ev);
    check('one event per finished import and one for createGame: the counts are 0, 1, 2, 3, 4 of 4, in order', ev.map((e) => e.done).join() === '0,1,2,3,4' && ev.every((e) => e.total === 4), JSON.stringify(ev.map((e) => e.done)));
    check('the card carries the count: data-step follows it', ev.every((e) => e.step === String(e.done)), ev.map((e) => e.step).join());
    check('the line follows the count: Warming up the jelly, then Finding the felt (1 and 2), then Waking the squishy (3 and 4)', ev.map((e) => e.line).join('|') === 'Warming up the jelly…|Finding the felt…|Finding the felt…|Waking the squishy…|Waking the squishy…', ev.map((e) => e.line).join('|'));
    check('the bar is count / 4 with a 12 % floor (--p: .12, .25, .5, .75, 1)', ev.map((e) => Number(e.p)).join() === '0.12,0.25,0.5,0.75,1', ev.map((e) => e.p).join());
    check('the card stays up and the title does not exist until the fourth event (the slow stage import was held 1.8 s)', ev.slice(0, 4).every((e) => e.bootShown) && ev.every((e) => !e.title));
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 5000 }).then(() => check('the card is gone once the title is ready (it fades and removes itself)', true)).catch(() => check('the card is gone once the title is ready (it fades and removes itself)', false));
    check('title card exists, button live, no console error', await page.evaluate(() => !!document.querySelector('.title') && !document.querySelector('.cta').disabled), errs.slice(0, 2).join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ no script: the watchdog line and its Reload link (CSS only)
  if (want('slow') || args.includes('--boot-shots')) {
    section = 'slow';
    const { context, page, errs } = await openTitle({ js: false, query: '', size: { w: 390, h: 844 } });
    const f = () => page.evaluate(() => {
      const s = document.querySelector('.boot-slow'), a = s?.querySelector('a'), line = document.getElementById('boot-line');
      const b = a?.getBoundingClientRect();
      return { slow: s && getComputedStyle(s).visibility, link: a && getComputedStyle(a).visibility, href: a?.getAttribute('href'), linkH: b ? Math.round(b.height) : 0, line: line?.textContent, svgs: document.querySelectorAll('.boot-mark svg').length, hscroll: document.documentElement.scrollWidth - innerWidth, bar: getComputedStyle(document.querySelector('.boot-fill')).clipPath };
    });
    const t0 = await f();
    check('no script: the wordmark (2 drawings), the bar at its floor and the first line show; the watchdog line is hidden', t0.svgs === 2 && t0.line === 'Warming up the jelly…' && t0.slow === 'hidden' && /inset/.test(t0.bar) && t0.hscroll <= 0, JSON.stringify(t0));
    if (want('slow')) {
      await sleep(12400);
      const t1 = await f();
      check('after 12 s the slow line and its Reload link appear (CSS only); the link points at ./ and is 44 high', t1.slow === 'visible' && t1.link === 'visible' && t1.href === './' && t1.linkH >= 44, JSON.stringify(t1));
    }
    check('no console error on the static card', errs.length === 0, errs.slice(0, 2).join(' | '));
    await context.close();
    if (args.includes('--boot-shots')) {
      mkdirSync(resolve(OUT, 'boot'), { recursive: true });
      for (const s of KIT_SIZES) {
        const c = await browser.newContext({ viewport: { width: s.w, height: s.h }, javaScriptEnabled: false });
        const p = await c.newPage();
        await p.goto(vite.url, { waitUntil: 'load' });
        const m = await p.evaluate(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; }; return { mark: r(document.querySelector('.boot-mark')), bar: r(document.querySelector('.boot-bar')), line: r(document.getElementById('boot-line')), hscroll: document.documentElement.scrollWidth - innerWidth, ih: innerHeight }; });
        await p.screenshot({ path: resolve(OUT, 'boot', `${s.w}x${s.h}.png`) });
        check(`boot card at ${s.w}x${s.h}: no scroll, the wordmark, bar and line all on screen and in that order`, m.hscroll <= 0 && m.mark.y >= 0 && m.mark.b <= m.bar.y && m.bar.b <= m.line.y && m.line.b <= m.ih, JSON.stringify(m));
        await c.close();
      }
    }
  }

  // ------------------------------------------------------------------ names, roles, focus, chips, tab order
  if (want('dom')) {
    section = 'dom';
    const { context, page, errs } = await openTitle();
    await page.waitForFunction(() => document.querySelector('.title')?.dataset.intro === 'done', null, { timeout: 20000 });
    const d = await page.evaluate(() => {
      const t = document.querySelector('.title'), h1 = document.querySelector('.title-mark'), cta = document.querySelector('.cta');
      return {
        role: t.getAttribute('role'), modal: t.getAttribute('aria-modal'), labelled: document.getElementById(t.getAttribute('aria-labelledby'))?.textContent, describedBy: document.getElementById(t.getAttribute('aria-describedby'))?.textContent,
        h1: h1.tagName, text: h1.textContent, svgHidden: [...h1.querySelectorAll('.jl-svg')].every((s) => s.getAttribute('aria-hidden') === 'true'),
        cta: cta.textContent, disabled: cta.disabled, busy: cta.getAttribute('aria-busy'), focus: document.activeElement === cta, status: document.getElementById('wh-title-status').textContent,
        chips: [...document.querySelectorAll('.title-chip')].map((c) => c.dataset.chip), pressed: document.querySelector('.title-snd').getAttribute('aria-pressed'),
        renderedH1: [...document.querySelectorAll('h1')].filter((e) => e.checkVisibility({ visibilityProperty: true })).length, hud: getComputedStyle(document.querySelector('.hud')).visibility,
        font: getComputedStyle(cta).fontFamily.split(',')[0], plateBg: getComputedStyle(document.querySelector('.title-promise')).backgroundColor, plateBlur: getComputedStyle(document.querySelector('.title-promise')).backdropFilter,
      };
    });
    check('the dialog is named by the h1 ("SQUISH KEEPER", real text, the drawings are aria-hidden) and described by the tagline', d.role === 'dialog' && d.modal === 'true' && d.labelled === 'SQUISH KEEPER' && d.h1 === 'H1' && d.text === 'SQUISH KEEPER' && d.svgHidden && d.describedBy === 'A squishy toy that squishes back.', JSON.stringify(d));
    check('exactly one rendered h1 (the HUD one is hidden under the title)', d.renderedH1 === 1 && d.hud === 'hidden');
    check('the button reads "Wake it up", is live and focused on load, not busy, and the status line says ready', d.cta === 'Wake it up' && !d.disabled && d.busy === null && d.focus && /^Ready/.test(d.status), JSON.stringify({ cta: d.cta, disabled: d.disabled, busy: d.busy, focus: d.focus, status: d.status }));
    check('chips (dev flag): How to play, Trophies, Credits, Settings, Sound in that order; Sound is pressed (on)', d.chips.join() === 'howto,trophies,credits,settings,sound' && d.pressed === 'true', d.chips.join());
    check('the glass plate is the kit\'s (rgba(42, 23, 68, .86) with a blur) and the type is the UI stack, not the old --wh-font', /rgba\(42, 23, 68, 0\.86\)/.test(d.plateBg) && d.plateBlur !== 'none' && !/Arial Rounded/.test(d.font), `${d.plateBg} | ${d.plateBlur} | ${d.font}`);
    const order = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.dataset.chip || document.activeElement?.className.split(' ')[0])); }
    check('Tab from the button walks the chips in order (howto, trophies, credits, settings, sound) and then leaves the card', order.slice(0, 5).join() === 'howto,trophies,credits,settings,sound' && !/chip|cta/.test(order[5] ?? ''), order.join());
    check('no console error, no failed request', errs.length === 0, errs.slice(0, 2).join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ the intro: any key ends it; it ends by itself; the pose and the drop are there in normal motion
  if (want('intro')) {
    section = 'intro';
    {
      const { context, page } = await openTitle({ hold: true });
      const a = await page.evaluate(() => ({ intro: document.querySelector('.title').dataset.intro, anim: getComputedStyle(document.querySelector('.title-mark .jl-c')).animationName, cls: document.querySelector('.title-mark').classList.contains('jl-intro'), pose: document.querySelectorAll('.title-mark .jl-bd use[transform]').length, running: document.getAnimations().filter((x) => x.effect?.target?.classList?.contains('jl-c')).length }));
      check('normal motion: the intro is playing (jl-drop on every letter group, the bounce pose on 12 letters)', a.intro === 'play' && a.anim === 'jl-drop' && a.cls && a.pose === 12 && a.running === 60, JSON.stringify(a));
      await page.keyboard.press('Shift');
      const b = await page.evaluate(() => ({ intro: document.querySelector('.title').dataset.intro, cls: document.querySelector('.title-mark').classList.contains('jl-intro'), running: document.getAnimations().filter((x) => x.effect?.target?.classList?.contains('jl-c')).length, cta: getComputedStyle(document.querySelector('.cta')).animationName }));
      check('any key skips the intro at once: the letters stop animating, the button breathes', b.intro === 'done' && !b.cls && b.running === 0 && b.cta === 'k-breathe', JSON.stringify(b));
      await context.close();
    }
    {
      const { context, page } = await openTitle({ hold: true });
      await page.mouse.click(40, 400);   // a tap on empty scrim
      const b = await page.evaluate(() => document.querySelector('.title').dataset.intro);
      check('a tap anywhere skips it too', b === 'done', b);
      await context.close();
    }
    {
      const { context, page } = await openTitle();
      const t0 = Date.now();
      await page.waitForFunction(() => document.querySelector('.title')?.dataset.intro === 'done', null, { timeout: 8000 });
      check('left alone, the intro ends by itself within about 1.4 s (the timer)', Date.now() - t0 < 6000, `${Date.now() - t0} ms of wall time incl. page load`);
      await context.close();
    }
  }

  // ------------------------------------------------------------------ poke
  if (want('poke')) {
    section = 'poke';
    const { context, page } = await openTitle();
    await page.waitForFunction(() => document.querySelector('.title')?.dataset.intro === 'done', null, { timeout: 20000 });
    const box = await page.locator('.title-mark .jl-svg').first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
    const p = await page.evaluate(() => { const a = document.getAnimations().filter((x) => x.effect?.target?.classList?.contains('jl-c')); return { n: a.length, letters: new Set(a.map((x) => x.effect.target.dataset.i)).size, transform: a.every((x) => x.effect.getKeyframes().some((k) => k.transform)), ms: Math.round(a[0]?.effect.getTiming().duration ?? 0) }; });
    check('a tap on the lockup squashes the letter under it and its two neighbours (3 letters x 5 passes, transform, ~480 ms)', p.n === 15 && p.letters === 3 && p.transform && p.ms >= 400 && p.ms <= 520, JSON.stringify(p));
    check('the poke is still the title (the game did not start)', await page.evaluate(() => window.__WH__.state().phase === 'title'));
    await context.close();
  }

  // ------------------------------------------------------------------ the Sound chip
  if (want('sound')) {
    section = 'sound';
    const { context, page } = await openTitle();
    const read = () => page.evaluate(() => { const c = document.querySelector('.title-snd'); const hud = document.querySelector('button[aria-label="Mute sound"]'); return { pressed: c.getAttribute('aria-pressed'), icon: c.querySelector('path:last-child')?.getAttribute('d')?.slice(0, 12), muted: hud ? hud.getAttribute('aria-pressed') === 'true' : null, audio: window.__WH__.state().audio.state, phase: window.__WH__.state().phase }; });
    const a = await read();
    await page.click('.title-snd');
    const b = await read();
    await page.keyboard.press('Space');   // the chip keeps focus: Space toggles it back
    const c = await read();
    check('pressing Sound mutes (aria-pressed false, the icon changes, the game is muted: the HUD mute button heard it) and pressing it again unmutes', a.pressed === 'true' && b.pressed === 'false' && b.icon !== a.icon && b.muted === true && c.pressed === 'true' && c.muted === false, JSON.stringify([a, b, c]));
    // (any click, tap or key unlocks the audio: lifecycle.ts listens on window, as it did before the title was redesigned; that is a real user gesture, so it is not asserted against)
    check('Sound does not start the game (the phase stays title) and the title stays up', b.phase === 'title' && await page.evaluate(() => !!document.querySelector('.title')), b.phase);
    await context.close();
    const m = await openTitle({ query: QUERY + '&mute=1' });
    check('?mute=1: the chip starts un-pressed (sound off)', await m.page.evaluate(() => document.querySelector('.title-snd').getAttribute('aria-pressed')) === 'false');
    await m.context.close();
  }

  // ------------------------------------------------------------------ Calm / reduced motion
  if (want('calm')) {
    section = 'calm';
    const { context, page, errs } = await openTitle({ ctx: { reducedMotion: 'reduce' } });
    const d = await page.evaluate(() => ({
      calm: document.body.dataset.calm, intro: document.querySelector('.title').dataset.intro, pose: document.querySelectorAll('.title-mark .jl-bd use[transform]').length,
      letter: getComputedStyle(document.querySelector('.title-mark .jl-c')).animationName, idle: getComputedStyle(document.querySelector('.title-mark')).animationName, cta: getComputedStyle(document.querySelector('.cta')).animationName,
      moving: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.title') && a.effect.getKeyframes().some((k) => k.transform)).length,
    }));
    check('reduced motion: Calm is on, the intro is already over, a straight lockup (no bounce pose), no drop, no idle, no breathing', d.calm === 'true' && d.intro === 'done' && d.pose === 0 && d.letter === 'none' && d.idle === 'none' && d.cta === 'none', JSON.stringify(d));
    check('K08: 0 transform animations are running on the title', d.moving === 0, String(d.moving));
    const box = await page.locator('.title-mark .jl-svg').first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const p = await page.evaluate(() => { const a = document.getAnimations().filter((x) => x.effect?.target?.classList?.contains('jl-c')); return { n: a.length, noTransform: a.every((x) => !x.effect.getKeyframes().some((k) => k.transform)), ms: Math.round(a[0]?.effect.getTiming().duration ?? 0) }; });
    check('Calm poke: one 120 ms highlight on the letter (a filter, no transform)', p.n >= 5 && p.noTransform && p.ms === 120, JSON.stringify(p));
    check('no console error', errs.length === 0, errs.slice(0, 2).join(' | '));
    await context.close();
    // the saved setting wins over the OS: calm saved ON with no OS preference = the same quiet title
    const s = await openTitle({ query: QUERY, ctx: {} });
    await s.context.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx2.addInitScript(() => { try { localStorage.setItem('wobblehoard:v1:settings', JSON.stringify({ v: 2, volume: 0.8, squishBoost: 0.4, haptics: false, shake: 0.35, gravity: true, quality: 'auto', calm: true })); } catch { /* ignore */ } });
    const p2 = await ctx2.newPage();
    await p2.goto(vite.url + QUERY, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    const sv = await p2.evaluate(() => ({ calm: document.body.dataset.calm, pose: document.querySelectorAll('.title-mark .jl-bd use[transform]').length, idle: getComputedStyle(document.querySelector('.title-mark')).animationName, intro: document.querySelector('.title').dataset.intro }));
    check('a saved Calm setting (no OS preference) gives the same quiet title: known before the first frame', sv.calm === 'true' && sv.pose === 0 && sv.idle === 'none' && sv.intro === 'done', JSON.stringify(sv));
    await ctx2.close();
  }

  // ------------------------------------------------------------------ contrast more, forced colours
  if (want('modes')) {
    section = 'modes';
    {
      const { context, page } = await openTitle({ ctx: { contrast: 'more' } });
      const d = await page.evaluate(() => ({ svg: getComputedStyle(document.querySelector('.title-mark .jl-svg')).display, text: getComputedStyle(document.querySelector('.title-mark .jl-text')).position, blur: getComputedStyle(document.querySelector('.title-promise')).backdropFilter, name: document.querySelector('.title-mark').textContent }));
      check('contrast more: the drawn lockup is off, the real text shows (system 800), the plate has no blur', d.svg === 'none' && d.text === 'static' && d.blur === 'none' && d.name === 'SQUISH KEEPER', JSON.stringify(d));
      await context.close();
    }
    {
      const { context, page } = await openTitle({ ctx: { forcedColors: 'active' } });
      const d = await page.evaluate(() => ({ svg: getComputedStyle(document.querySelector('.title-mark .jl-svg')).display, cta: getComputedStyle(document.querySelector('.cta')).borderTopWidth, chip: getComputedStyle(document.querySelector('.title-snd')).borderTopWidth, fit: document.documentElement.scrollWidth <= innerWidth }));
      check('forced colours: real text instead of the drawing, a real border on the button and the chip, no scroll', d.svg === 'none' && parseFloat(d.cta) >= 1 && parseFloat(d.chip) >= 1 && d.fit, JSON.stringify(d));
      await context.close();
    }
  }

  // ------------------------------------------------------------------ the 8 kit sizes
  if (want('sizes')) {
    section = 'sizes';
    for (const s of KIT_SIZES) {
      const { context, page, errs } = await openTitle({ size: s });
      await page.waitForFunction(() => document.querySelector('.title')?.dataset.intro === 'done', null, { timeout: 20000 });
      await sleep(200);
      const f = await page.evaluate(factsInPage);
      const lines = s.layout === 'stack' ? 2 : 1;
      const ctaH = f.layout === 'tiny' ? 44 : f.layout === 'strip' ? 52 : 64;
      check(`${s.w}x${s.h} (${s.layout}): card layout, no scroll, the lockup on ${lines} line${lines > 1 ? 's' : ''}, nothing outside the screen, no two parts overlap`, f.layout === s.layout && f.sw <= f.iw && f.lines === lines && f.outside.length === 0 && f.overlaps.length === 0, `${f.layout} sw ${f.sw}/${f.iw} lines ${f.lines} cap ${f.cap.toFixed(0)} outside [${f.outside}] overlaps [${f.overlaps}]`);
      check(`${s.w}x${s.h}: the button is ${ctaH} high; the plate keeps its line(s); every button has a 44 x 44 hit box (K02 grid)`, Math.abs(f.cta.h - ctaH) <= 1 && f.hits.every((h) => h.cov >= 0.85), JSON.stringify({ cta: Math.round(f.cta.h), worst: f.hits.slice().sort((a, b) => a.cov - b.cov)[0] }));
      check(`${s.w}x${s.h}: console clean`, errs.length === 0, errs.slice(0, 1).join(' | '));
      await context.close();
    }
  }

  // ------------------------------------------------------------------ the button starts the game
  if (want('start')) {
    section = 'start';
    const { context, page } = await openTitle();
    await page.waitForFunction(() => document.querySelector('.title')?.dataset.intro === 'done', null, { timeout: 20000 });
    const cb = await page.locator('.cta').boundingBox();   // (a mouse click at the centre: the breathing button never holds still for Playwright's stability wait, as in browser_shell's wake())
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.title'), null, { timeout: 8000 });
    const s = await page.evaluate(() => ({ audio: window.__WH__.state().audio.state, h1: [...document.querySelectorAll('h1')].filter((e) => e.checkVisibility({ visibilityProperty: true })).map((e) => e.textContent) }));
    check('the button starts the game, unlocks the audio in the same gesture, the title leaves and one h1 (the HUD wordmark) remains', s.audio === 'running' && s.h1.length === 1 && s.h1[0] === 'SQUISH KEEPER', JSON.stringify(s));
    await context.close();
  }
} catch (e) {
  section = 'harness';
  check('ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  vite?.stop();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'title_checks.json'), JSON.stringify({ total, bad }, null, 2));
console.log(`\n${total - bad}/${total} title and boot live checks passed`);
process.exit(bad ? 1 : 0);
