// UI v3 B4b live checks: Settings, How to play, Credits in the REAL game (dev server, frozen), by section:
//   node _harness/uikit/b4b_checks.mjs [--only=keyboard,reflow,calm,forced,contrast,boot,sheet] [--port=5447]
//   keyboard  K04: the Tab-only walk of every screen (stops, the trap, Esc order, focus returns, a 3 px ring on every stop), real keys change real settings, the ? key, the Menu rows, the cover
//   reflow    K03: 320x568 (and 320x256, and dir=rtl, and the 1.4.12 text-spacing override): no horizontal scroll, nothing outside the screen, the close button reachable
//   calm      K08: under reduced motion (Calm) the screens open with no transform animation running after they settle, their fades keep the Calm duration
//   forced    K08: under forced-colors a switch on / off, the selected segment and the slider fill differ by pixel diff, the jelly headings show real text, no backdrop-filter
//   contrast  prefers-contrast: more: the 4 px ring, the jelly off, no backdrop-filter
//   boot      the page boots without the screens: the empty Settings shell stands, no later-* request until a screen opens, a failed load toasts and recovers (route abort), 0 page errors
//   sheet     the first open of Settings (a later-* chunk) answers the live line and the focus the same way every time; the opener is aria-busy only while it loads
// Ports 5440-5449 only. One browser at a time; everything started is stopped. Pictures of the screens: b4b_shots.mjs; the Photo card in the portal sandbox: portal/photo_check.mjs.
import { launch, startVite } from '../pw.mjs';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5447'));
const ONLY = opt('only').split(',').filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, bad = 0, section = '';
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${section}] ${name}${extra !== '' ? '  ' + extra : ''}`); };

let browser, vite;
const errsAll = [];

async function boot({ w = 1280, h = 800, media = {}, touch = false, query = '' } = {}) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...media, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  await context.addInitScript(() => { addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); }); });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  errsAll.push(errs);
  await page.goto(`${vite.url}?dev=1&rseed=7${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, errs };
}
const play = async (page) => {
  await sleep(800);
  await page.evaluate(() => document.querySelector('.cta')?.click());
  await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
  await sleep(600);
};
const settle = (ms = 600) => sleep(ms);
/** wait for every finite animation of the page to finish (an entrance can start late on a busy machine: a measurement must not read its first frame) */
const animsDone = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))).catch(() => {});
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? { id: a.id || '', tag: a.tagName, cls: typeof a.className === 'string' ? a.className : '', key: a.getAttribute('data-key') || '', label: a.getAttribute('aria-label') || '' } : { id: '', tag: '', cls: '', key: '', label: '' }; });
const activeIn = (page, sel) => page.evaluate((s) => !!document.activeElement?.closest(s), sel);
const reasons = (page) => page.evaluate(() => window.__WH__.shell.pauseReasons());
const live = (page) => page.evaluate(() => document.getElementById('wh-live')?.textContent ?? '');
const settingsNow = (page) => page.evaluate(() => window.__WH__.state().settings);
const waitOpen = (page, sel, ms = 8000) => page.waitForFunction((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity === '1'; }, sel, { timeout: ms }).then(() => true, () => false);

/** the focus ring of whatever holds the focus: the visual node (a slider's thumb, a switch's track, a segment's face, or the control) and its outline width */
const ringOfActive = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a) return null;
  let cs;
  if (a instanceof HTMLInputElement && a.type === 'range') return { w: 99, style: 'thumb', halo: false, color: '' };   // (a slider's ring is on its thumb pseudo-element: proved by a pixel diff below)
  else if (a instanceof HTMLInputElement && a.type === 'checkbox') cs = getComputedStyle(a.parentElement.querySelector('.k-switch-ui'));
  else if (a instanceof HTMLInputElement && a.type === 'radio') cs = getComputedStyle(a.nextElementSibling);
  else cs = getComputedStyle(a);
  const w = parseFloat(cs.outlineWidth);
  const halo = cs.boxShadow && cs.boxShadow !== 'none';
  return { w, style: cs.outlineStyle, halo: !!halo, color: cs.outlineColor };
});

async function tabWalk(page, max = 40) {
  const stops = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const a = await active(page);
    const key = `${a.tag}#${a.id}|${a.key}|${a.label}|${a.cls.split(' ')[0]}`;
    if (stops.length && key === stops[0].key && i > 1) break;
    stops.push({ key, a, ring: await ringOfActive(page) });
  }
  return stops;
}

async function main() {
  vite = await startVite(PORT);
  browser = await launch();
  try {
    // ───────────────────────────────────────────────────────────────────────────── keyboard
    if (want('keyboard')) {
      section = 'keyboard';
      const { context, page, errs } = await boot();
      await play(page);
      // ---- Settings: open through the Menu with real keys; the walk
      await page.keyboard.press('p'); await settle(500);
      check('P opens the Menu (a layer); How to play and Credits are rows of it', await page.evaluate(() => !!document.querySelector('#wh-menu') && !!document.querySelector('.menu [data-key="howto"]') && !!document.querySelector('.menu [data-key="credits"]')));
      await page.focus('.menu [data-key="settings"]'); await page.keyboard.press('Enter');
      const open1 = await waitOpen(page, '.panel[data-open="true"]');
      await settle(300);
      const s1 = await page.evaluate(() => ({ focus: document.activeElement?.id, role: document.querySelector('.panel').getAttribute('role'), modal: document.querySelector('.panel').getAttribute('aria-modal'), name: document.getElementById(document.querySelector('.panel').getAttribute('aria-labelledby'))?.textContent, covered: window.__WH__.shell.pauseReasons().includes('covered'), loaded: !!document.querySelector('.panel .k-slider') }));
      check('Menu > Settings (the later-* chunk loads on the first open): the panel opens, focus is on its heading, it is a non-modal dialog named "Settings", the game keeps running under it', open1 && s1.focus === 'wh-settings-title' && s1.role === 'dialog' && s1.modal === 'false' && s1.name === 'Settings' && !s1.covered && s1.loaded, JSON.stringify(s1));
      const walk = await tabWalk(page);
      const ids = walk.map((s) => s.a.id || s.a.label || s.a.key);
      check('Settings: the Tab walk visits close, the 4 sliders, the switches, Gravity and Quality (one stop each: a radio group is one stop), the How to play link, then wraps to close (14 stops without Haptics)',
        walk.length === 14 && ids[0] === 'Close settings' && ids[ids.length - 1] === 'wh-howto-link' && ['wh-volume', 'wh-music', 'wh-boost', 'wh-shake', 'wh-uisounds', 'wh-extra', 'wh-calm', 'wh-skip', 'wh-fast', 'wh-keys'].every((i) => ids.includes(i)) && !ids.includes('wh-haptics'), ids.join(' > '));
      check('Settings: every stop but the sliders shows a focus ring of 3 px or more (outline) on its visual part (switch track, segment face, button)', walk.every((s) => s.ring && s.ring.w >= 3 && s.ring.style !== 'none'), walk.filter((s) => !(s.ring && s.ring.w >= 3)).map((s) => s.key).join(' | ') || `${walk.length} stops`);
      const sliderRings = [];
      for (const id of ['wh-volume', 'wh-music', 'wh-boost', 'wh-shake']) {
        await page.focus('#wh-settings-title'); await sleep(80);
        const blurred = await page.locator(`#${id}`).screenshot();
        await page.keyboard.press('Tab'); await page.focus(`#${id}`); await sleep(120);
        const focused = await page.locator(`#${id}`).screenshot();
        sliderRings.push(Buffer.compare(blurred, focused) !== 0);
      }
      check('Settings: a focused slider shows a ring on its thumb (the picture of the slider differs focused vs not, all four)', sliderRings.every(Boolean), sliderRings.join());
      check('Settings: Tab from the last stop wraps inside the panel; Shift+Tab from the first wraps to the last', await (async () => {
        await page.focus('#wh-howto-link'); await page.keyboard.press('Tab');
        const a = await activeIn(page, '.panel');
        await page.focus('.panel .icon-btn'); await page.keyboard.press('Shift+Tab');
        const b = await page.evaluate(() => document.activeElement?.id);
        return a && b === 'wh-howto-link';
      })());
      // real keys change real settings
      await page.focus('#wh-volume'); await page.keyboard.press('Home');
      await page.focus('#wh-music'); await page.keyboard.press('End');
      await page.focus('#wh-uisounds'); await page.keyboard.press('Space');
      await page.focus('#wh-extra'); await page.keyboard.press('Space');
      await page.focus('#wh-quality input:checked'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await page.focus('#wh-gravity input:checked'); await page.keyboard.press('ArrowRight');
      await settle(400);
      const st = await settingsNow(page);
      check('Settings: Home on Volume, End on Music, Space on Button sounds and Extra squish, arrows on Quality and Gravity reach the app (volume 0, music 1, uiSounds off, extra on, quality low -> med, float)',
        st.volume === 0 && st.music === 1 && st.uiSounds === false && st.extraSquish === true && st.quality === 'med' && st.gravity === false, JSON.stringify(st));
      const vals = await page.evaluate(() => ({ out: document.querySelector('#wh-volume').closest('.row').querySelector('output').textContent, q: document.querySelector('#wh-quality input:checked').value, g: document.querySelector('#wh-gravity input:checked').value, sw: document.querySelector('#wh-uisounds').checked, extra: document.querySelector('#wh-extra').checked }));
      check('Settings: the panel shows what the keys did (volume 0%, Medium, Float, switches)', vals.out === '0%' && vals.q === 'med' && vals.g === 'float' && vals.sw === false && vals.extra === true, JSON.stringify(vals));
      // ---- How to play from the Settings link, over Settings
      await page.focus('#wh-howto-link'); await page.keyboard.press('Enter'); await settle(700);
      const h1 = await page.evaluate(() => ({ open: !!document.querySelector('.scr-howto'), focus: document.activeElement?.getAttribute('aria-label'), settingsInert: document.querySelector('.panel').hasAttribute('inert'), role: document.querySelector('.scr-howto').getAttribute('role'), modal: document.querySelector('.scr-howto').getAttribute('aria-modal'), name: document.getElementById(document.querySelector('.scr-howto').getAttribute('aria-labelledby'))?.textContent, cards: document.querySelectorAll('.guide-card').length, hud: document.querySelector('.hud').hasAttribute('inert') }));
      check('Settings > How to play: a modal dialog named "How to play" with 5 cards opens over the panel (the panel and the HUD are inert), the close button has the focus', h1.open && h1.focus === 'Close how to play' && h1.settingsInert && h1.role === 'dialog' && h1.modal === 'true' && h1.name === 'How to play' && h1.cards === 5 && h1.hud, JSON.stringify(h1));
      const w2 = await tabWalk(page, 12);
      check('How to play: Tab stays inside the dialog (stops: the close button, the Keyboard disclosure) and wraps', w2.length === 2 && w2.every((s) => s.a.label === 'Close how to play' || s.a.tag === 'SUMMARY') && await activeIn(page, '.scr-howto'), w2.map((s) => s.key).join(' > '));
      check('How to play: every stop has a 3 px ring', w2.every((s) => s.ring && s.ring.w >= 3), JSON.stringify(w2.map((s) => s.ring && s.ring.w)));
      await page.keyboard.press('Escape'); await settle(500);
      const h2 = await page.evaluate(() => ({ gone: !document.querySelector('.scr-howto'), panelOpen: document.querySelector('.panel').dataset.open, panelInert: document.querySelector('.panel').hasAttribute('inert'), focus: document.activeElement?.id }));
      check('Esc closes ONLY How to play: Settings stays open (no longer inert) and the focus returns to the How to play link', h2.gone && h2.panelOpen === 'true' && !h2.panelInert && h2.focus === 'wh-howto-link', JSON.stringify(h2));
      await page.keyboard.press('Escape'); await settle(500);
      const h3 = await page.evaluate(() => ({ closed: document.querySelector('.panel').dataset.open === 'false', focus: document.activeElement?.id, menu: !!document.querySelector('#wh-menu') }));
      check('the next Esc closes Settings (focus to the squishy), and the Menu does not open on the same press', h3.closed && h3.focus === 'wh-play' && !h3.menu, JSON.stringify(h3));
      // ---- the ? key
      await page.focus('#wh-play'); await page.keyboard.press('?'); await settle(700);
      const q1 = await page.evaluate(() => ({ open: !!document.querySelector('.scr-howto'), covered: window.__WH__.shell.pauseReasons().includes('covered'), focus: document.activeElement?.getAttribute('aria-label') }));
      check('? opens How to play in play (the game is covered while it is up), the close button has the focus', q1.open && q1.covered && q1.focus === 'Close how to play', JSON.stringify(q1));
      await page.keyboard.press('?'); await settle(200);
      check('a second ? does not open a second one', await page.evaluate(() => document.querySelectorAll('.scr-howto').length === 1));
      await page.keyboard.press('Escape'); await settle(500);
      const q2 = await page.evaluate(() => ({ gone: !document.querySelector('.scr-howto'), focus: document.activeElement?.id, covered: window.__WH__.shell.pauseReasons().includes('covered') }));
      check('Esc closes it; the game runs again and the focus is back on the squishy (where the ? key was pressed)', q2.gone && !q2.covered && q2.focus === 'wh-play', JSON.stringify(q2));
      // ---- Credits through the Menu
      await page.keyboard.press('p'); await settle(500);
      await page.focus('.menu [data-key="credits"]'); await page.keyboard.press('Enter'); await settle(800);
      const c1 = await page.evaluate(() => ({ open: !!document.querySelector('.scr-credits'), menu: !!document.querySelector('#wh-menu'), covered: window.__WH__.shell.pauseReasons().includes('covered'), focus: document.activeElement?.getAttribute('aria-label'), version: document.querySelector('.credits-version')?.textContent, privacy: document.querySelector('.credits-privacy span')?.textContent, craft: document.querySelector('.credits-craft')?.textContent, built: [...document.querySelectorAll('.credits-name')].map((e) => e.textContent).join() }));
      check('Menu > Credits: the Menu closes, the screen opens (the game covered), the close button has the focus; version, the craft line, the three libraries and the privacy line are there', c1.open && !c1.menu && c1.covered && c1.focus === 'Close credits' && /^Version \d+\.\d+\.\d+$/.test(c1.version) && c1.craft === 'All sound is synthesised in your browser. All art is drawn in code.' && c1.built === 'three.js,Vite,TypeScript' && c1.privacy === 'Your squishies live in this browser. Signed in to ForgeFlow Games, only your trophies are shared with the site.', JSON.stringify(c1));
      const cw = await tabWalk(page, 8);
      check('Credits: Tab stops are the close button and the Licences disclosure; the licence text (a scroll region) joins once the disclosure is open', cw.length === 2 && await (async () => {
        await page.focus('.credits-licences > summary'); await page.keyboard.press('Space'); await settle(200);
        const w = await tabWalk(page, 8);
        return w.length === 3 && w.some((s) => s.a.tag === 'DIV') && w.every((s) => s.ring && s.ring.w >= 3);
      })(), cw.map((s) => s.key).join(' > '));
      const lic = await page.evaluate(() => ({ text: document.querySelector('.credits-text').textContent, label: document.querySelector('.credits-text').getAttribute('aria-label'), role: document.querySelector('.credits-text').getAttribute('role') }));
      check('Credits: the Licences disclosure holds the three.js MIT text (a labelled region)', /The MIT License/.test(lic.text) && /three\.js authors/.test(lic.text) && /THE SOFTWARE IS PROVIDED/.test(lic.text) && lic.role === 'region' && /three\.js/.test(lic.label), lic.label);
      await page.keyboard.press('Escape'); await settle(500);
      const c2 = await page.evaluate(() => ({ gone: !document.querySelector('.scr-credits'), covered: window.__WH__.shell.pauseReasons().includes('covered'), focus: document.activeElement?.getAttribute('aria-label') }));
      check('Esc closes Credits, the game runs again, the focus is back on the control that had it before the Menu (the squishy)', c2.gone && !c2.covered && await page.evaluate(() => document.activeElement?.id === 'wh-play'), JSON.stringify(c2));
      // the pointer paths: the dim area and the close button
      await page.evaluate(() => window.__WH_UI__.openDestination('howto')); await settle(600);
      await page.mouse.click(8, 400); await settle(400);
      check('a press on the dim area closes a reading screen', await page.evaluate(() => !document.querySelector('.scr-howto')));
      await page.evaluate(() => window.__WH_UI__.openDestination('credits')); await settle(600);
      await page.click('.scr-close'); await settle(400);
      check('the close button closes it', await page.evaluate(() => !document.querySelector('.scr-credits')));
      check('no page error and no console error in the whole keyboard section', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────────────────────────────────── reflow (K03)
    if (want('reflow')) {
      section = 'reflow';
      for (const [w, h] of [[320, 568], [320, 256]]) {
        const { context, page, errs } = await boot({ w, h });
        await play(page);
        const spacing = '*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p{margin-bottom:2em !important}';
        for (const mode of ['normal', 'spacing', 'rtl']) {
          if (mode === 'spacing') await page.addStyleTag({ content: spacing });
          if (mode === 'rtl') await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
          for (const [id, sel] of [['settings', '.panel[data-open="true"]'], ['howto', '.scr-howto'], ['credits', '.scr-credits']]) {
            await page.evaluate((i) => window.__WH_UI__.openDestination(i), id);
            await waitOpen(page, id === 'settings' ? sel : `${sel}`); await settle(300); await animsDone(page); await settle(150);
            if (id === 'credits') { await page.evaluate(() => { const d = document.querySelector('.credits-licences'); if (d) d.open = true; }); await settle(200); }
            const m = await page.evaluate((s) => {
              const root = document.querySelector(s); const rb = root.getBoundingClientRect();
              const body = root.querySelector('.k-panel-body') || root;
              const out = [];
              for (const el of root.querySelectorAll('*')) {
                if (el.closest('.sr-only') || el.classList.contains('sr-only') || el.closest('svg')) continue;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if (el.closest('.jl') ) continue;
                if (r.right > rb.right + 1 || r.left < rb.left - 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(rb.left)}..${Math.round(rb.right)}`);
              }
              const close = root.querySelector('.icon-btn, .scr-close')?.getBoundingClientRect();
              return { sw: document.documentElement.scrollWidth, iw: innerWidth, bodySW: body.scrollWidth, bodyCW: body.clientWidth, out: out.slice(0, 4), closeIn: !!close && close.left >= 0 && close.right <= innerWidth && close.top >= 0 && close.bottom <= innerHeight, closeRect: close ? [Math.round(close.left), Math.round(close.top), Math.round(close.right), Math.round(close.bottom)] : null, ih: innerHeight };
            }, sel);
            check(`${w}x${h} ${mode} ${id}: no horizontal scroll (page ${m.sw}/${m.iw}, body ${m.bodySW}/${m.bodyCW}), nothing outside the screen, the close button on screen`, m.sw <= m.iw && m.bodySW <= m.bodyCW + 1 && m.out.length === 0 && m.closeIn, `${m.out.join(' | ')} close ${JSON.stringify(m.closeRect)} of ${m.iw}x${m.ih}`);
            if (id === 'settings') await page.evaluate(() => window.__WH_UI__.closeSettings()); else await page.keyboard.press('Escape');
            await settle(450);
          }
          if (mode === 'rtl') await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
        }
        check(`${w}x${h}: no page error`, errs.length === 0, errs.slice(0, 2).join(' | '));
        await context.close();
      }
    }

    // ───────────────────────────────────────────────────────────────────────────── calm (K08)
    if (want('calm')) {
      section = 'calm';
      const { context, page, errs } = await boot({ media: { reducedMotion: 'reduce' } });
      await play(page);
      const calm = await page.evaluate(() => document.body.dataset.calm);
      check('reduced motion makes the game Calm (body[data-calm=true])', calm === 'true', String(calm));
      for (const [id, sel] of [['settings', '.panel[data-open="true"]'], ['howto', '.scr-howto'], ['credits', '.scr-credits']]) {
        await page.evaluate((i) => window.__WH_UI__.openDestination(i), id);
        await waitOpen(page, sel); await settle(900); await animsDone(page);
        const m = await page.evaluate((s) => {
          const el = document.querySelector(s);
          const anims = el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
          const mv = anims.filter((a) => { const k = a.effect?.getKeyframes?.() ?? []; return k.some((f) => 'transform' in f || 'translate' in f || 'scale' in f || 'rotate' in f); });
          const cs = getComputedStyle(el);
          const scrim = el.closest('.k-scrim');
          return { running: anims.length, moving: mv.length, names: mv.map((a) => a.animationName || a.transitionProperty).join(','), td: cs.transitionDuration, ad: cs.animationDuration + (scrim ? ', ' + getComputedStyle(scrim).animationDuration : ''), props: cs.transitionProperty };
        }, sel);
        check(`${id}: after it settles no transform animation is running (Calm)`, m.moving === 0, `${m.running} running, moving: ${m.names || 'none'}`);
        const secs = (v) => v.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000));
        const durs = id === 'settings' ? secs(m.td) : secs(m.ad);
        const props = m.props.split(',').map((x) => x.trim());
        const idx = props.indexOf('transform');
        check(`${id}: its move is ~0 ms and its fade is the Calm 140 ms (the panel's move, the scrim's fade)`, id === 'settings' ? (idx >= 0 && durs[idx] < 1 && durs.some((d) => Math.abs(d - 140) < 2)) : (durs.some((d) => d < 1) && durs.some((d) => Math.abs(d - 140) < 2)), `${m.td} | ${m.ad}`);
        if (id === 'settings') await page.evaluate(() => window.__WH_UI__.closeSettings()); else await page.keyboard.press('Escape');
        await settle(400);
      }
      check('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────────────────────────────────── forced colours (K08)
    if (want('forced')) {
      section = 'forced';
      const { context, page, errs } = await boot({ media: { forcedColors: 'active' } });
      await play(page);
      await page.evaluate(() => window.__WH_UI__.openSettings()); await waitOpen(page, '.panel[data-open="true"]'); await settle(600);
      // make sure uiSounds is on and extra squish off (the defaults), then compare the two switches' pictures
      const shotOf = (sel) => page.locator(sel).first().screenshot();
      const on = await shotOf('#wh-uisounds ~ .k-switch-ui'), off = await shotOf('#wh-extra ~ .k-switch-ui');
      check('forced-colors: a switch ON and a switch OFF differ by pixel diff (the track and the tick)', Buffer.compare(on, off) !== 0, `${on.length} vs ${off.length} bytes`);
      const sel1 = await shotOf('#wh-quality .k-seg-opt:has(input:checked) .k-seg-face'), sel0 = await shotOf('#wh-quality .k-seg-opt:has(input[value="low"]) .k-seg-face');
      check('forced-colors: the selected Quality segment and an unselected one differ by pixel diff (Highlight vs the face)', Buffer.compare(sel1, sel0) !== 0);
      await page.focus('#wh-volume'); await page.keyboard.press('Home'); await settle(150);
      const lo = await shotOf('#wh-volume'); await page.keyboard.press('End'); await settle(150);
      const hi = await shotOf('#wh-volume');
      check('forced-colors: the slider fill shows (0 % and 100 % differ by pixel diff)', Buffer.compare(lo, hi) !== 0);
      const j = await page.evaluate(() => { const t = document.getElementById('wh-settings-title'); const svg = t.querySelector('.jl-svg'); const r = t.getBoundingClientRect(); return { svg: svg ? getComputedStyle(svg).display : 'none', w: Math.round(r.width), h: Math.round(r.height), text: t.textContent }; });
      check('forced-colors: the jelly heading shows real text (the drawing is display:none, the heading still has a box and its words)', j.svg === 'none' && j.w > 40 && j.h > 10 && j.text.trim() === 'Settings', JSON.stringify(j));
      const bd = await page.evaluate(() => [...document.querySelectorAll('.panel, .panel *')].filter((e) => { const c = getComputedStyle(e); return (c.backdropFilter && c.backdropFilter !== 'none') || (c.webkitBackdropFilter && c.webkitBackdropFilter !== 'none'); }).length);
      check('forced-colors: no backdrop-filter anywhere in the panel', bd === 0, String(bd));
      const border = await page.evaluate(() => [...document.querySelectorAll('.panel .k-switch-ui, .panel .k-seg, .panel .set-link, .panel .icon-btn, .panel .set-card')].every((e) => parseFloat(getComputedStyle(e).borderTopWidth) >= 1 && getComputedStyle(e).borderTopStyle !== 'none'));
      check('forced-colors: every control and card has a real 1 px border', border);
      await page.evaluate(() => window.__WH_UI__.closeSettings()); await settle(400);
      for (const id of ['howto', 'credits']) {
        await page.evaluate((i) => window.__WH_UI__.openDestination(i), id); await waitOpen(page, `.scr-${id}`); await settle(500);
        const jj = await page.evaluate(() => { const t = document.querySelector('.scr-title'); const svg = t.querySelector('.jl-svg'); const r = t.getBoundingClientRect(); return { svg: svg ? getComputedStyle(svg).display : 'none', w: Math.round(r.width), text: t.textContent }; });
        const art = await page.evaluate(() => { const a = document.querySelector('.guide-art'); return a ? a.getAttribute('aria-hidden') : 'n/a'; });
        check(`forced-colors: ${id} heading shows real text (${jj.text.trim()})`, jj.svg === 'none' && jj.w > 40 && ['How to play', 'Credits'].includes(jj.text.trim()), JSON.stringify(jj));
        if (id === 'howto') check('forced-colors: the How to play pictures stay aria-hidden decoration', art === 'true');
        await page.keyboard.press('Escape'); await settle(400);
      }
      check('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────────────────────────────────── contrast: more
    if (want('contrast')) {
      section = 'contrast';
      const { context, page, errs } = await boot({ media: { contrast: 'more' } });
      await play(page);
      await page.evaluate(() => window.__WH_UI__.openSettings()); await waitOpen(page, '.panel[data-open="true"]'); await settle(500);
      const m = await page.evaluate(() => ({ ring: getComputedStyle(document.body).getPropertyValue('--k-ring-w').trim(), svg: getComputedStyle(document.querySelector('#wh-settings-title .jl-svg')).display, bd: [...document.querySelectorAll('.panel, .panel *')].filter((e) => { const c = getComputedStyle(e); return c.backdropFilter && c.backdropFilter !== 'none'; }).length }));
      check('prefers-contrast: more: the focus ring is 4 px, the jelly drawing is off (real text), no backdrop-filter', m.ring === '4px' && m.svg === 'none' && m.bd === 0, JSON.stringify(m));
      await page.focus('#wh-extra'); const r = await ringOfActive(page);
      check('prefers-contrast: more: a focused switch shows a 4 px outline', !!r && r.w >= 4, JSON.stringify(r));
      check('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }

    // ───────────────────────────────────────────────────────────────────────────── boot: the screens are later-* chunks
    if (want('boot')) {
      section = 'boot';
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const errs = []; errsAll.push(errs);
      const reqs = [];
      page.on('request', (r) => reqs.push(r.url()));
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await page.goto(`${vite.url}?dev=1&rseed=7`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await sleep(800);
      const before = reqs.filter((u) => /screens\/(later-|howToPlay|credits|screenCopy|screenFrame|guideArt|screens\.css)|settingsPanel/.test(u));
      const shell = await page.evaluate(() => { const p = document.querySelector('#wh-settings'); return p ? { cls: p.className, open: p.dataset.open, inert: p.hasAttribute('inert'), kids: p.children.length, disp: getComputedStyle(p).display } : null; });
      check('at boot no screen module is requested (Settings, How to play, Credits, the Photo card are later-* chunks)', before.length === 0, before.join(' | '));
      check('at boot the Settings shell stands: an empty, closed, inert, display:none `section.panel#wh-settings` (the contract `.panel[data-open]` holds from the start)', !!shell && shell.open === 'false' && shell.inert && shell.kids === 0 && shell.disp === 'none', JSON.stringify(shell));
      await page.click('.title [data-chip="howto"]');
      await page.waitForSelector('.scr-howto', { timeout: 10000 });
      const after = reqs.filter((u) => /screens\/(later-screens|howToPlay)/.test(u));
      check('the first How to play press fetches the chunk and opens the screen above the title (the title is inert, dimmed)', after.length >= 1 && await page.evaluate(() => document.querySelector('.title').hasAttribute('inert')), `${after.length} module requests`);
      const chipFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      await page.keyboard.press('Escape'); await settle(500);
      const back = await page.evaluate(() => ({ gone: !document.querySelector('.scr-howto'), focus: document.activeElement?.getAttribute('data-chip'), inert: document.querySelector('.title').hasAttribute('inert'), busy: !!document.querySelector('[aria-busy="true"]') }));
      check('Esc closes it, the title wakes, the focus returns to the How to play chip, nothing is left aria-busy', back.gone && back.focus === 'howto' && !back.inert && !back.busy, `${chipFocus} | ${JSON.stringify(back)}`);
      await page.click('.title [data-chip="credits"]'); await page.waitForSelector('.scr-credits', { timeout: 10000 });
      await page.keyboard.press('Escape'); await settle(400);
      check('the Credits chip opens Credits above the title and Esc returns the focus to it', await page.evaluate(() => !document.querySelector('.scr-credits') && document.activeElement?.getAttribute('data-chip') === 'credits'));
      check('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();

      // a failed load: the chunk request is aborted, a toast says so, the opener recovers, the next try works
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const p2 = await ctx2.newPage();
      const errs2 = []; errsAll.push(errs2);
      p2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message));
      await p2.goto(`${vite.url}?dev=1&rseed=7`, { waitUntil: 'load' });
      await p2.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await sleep(800);
      let blocked = 0;
      await p2.route(/later-screens|screens\/screenFrame|screens\/howToPlay|screens\/screens\.css/, (route) => { blocked++; route.abort(); });
      await p2.click('.title [data-chip="howto"]'); await sleep(1200);
      const failed = await p2.evaluate(() => ({ modal: document.querySelector('.wh-modal .k-modal-title')?.textContent, role: document.querySelector('.wh-modal .k-modal')?.getAttribute('role'), buttons: [...document.querySelectorAll('.wh-modal .k-btn')].map((b) => b.textContent.trim()), focus: document.activeElement?.textContent.trim(), gone: !document.querySelector('.scr-howto'), busy: !!document.querySelector('[aria-busy="true"]'), toast: [...document.querySelectorAll('.k-toast')].length }));
      check('a load that fails (the chunk request aborted) opens a dialog "That screen did not load" with Not now (focused, the safe answer) and Reload; nothing else opens, nothing stays aria-busy', blocked > 0 && failed.modal === 'That screen did not load' && failed.buttons.join() === 'Not now,Reload' && failed.focus === 'Not now' && failed.gone && !failed.busy, JSON.stringify(failed));
      await sleep(400);
      await p2.keyboard.press('Enter'); await sleep(500);
      const dismissed = await p2.evaluate(() => ({ gone: !document.querySelector('.wh-modal'), inert: document.querySelector('.title').hasAttribute('inert'), focus: document.activeElement?.getAttribute('data-chip') }));
      check('Not now closes it, the title is usable again and the focus returns to the chip', dismissed.gone && !dismissed.inert && dismissed.focus === 'howto', JSON.stringify(dismissed));
      await p2.click('.title [data-chip="howto"]'); await sleep(900);
      check('a second press fails the same way at once (the browser keeps a failed import for the life of the page), so the dialog offering the reload is the honest retry', await p2.evaluate(() => document.querySelector('.wh-modal .k-modal-title')?.textContent === 'That screen did not load' && !document.querySelector('.scr-howto')));
      await p2.unroute(/later-screens|screens\/screenFrame|screens\/howToPlay|screens\/screens\.css/);
      await sleep(400);
      await Promise.all([p2.waitForLoadState('load'), p2.click('.wh-modal .k-gel')]);
      await p2.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await sleep(900);
      await p2.click('.title [data-chip="howto"]'); const ok2 = await p2.waitForSelector('.scr-howto', { timeout: 15000 }).then(() => true, () => false);
      check('Reload brings the title back, and the How to play chip then opens the screen (the network is back)', ok2);
      check('no page error', errs2.length === 0, errs2.slice(0, 2).join(' | '));
      await ctx2.close();
    }

    // ───────────────────────────────────────────────────────────────────────────── sheet: the first open
    if (want('sheet')) {
      section = 'sheet';
      const { context, page, errs } = await boot();
      const reqs = [];
      page.on('request', (r) => { if (/screens\//.test(r.url())) reqs.push(r.url()); });
      await play(page);
      const t0 = Date.now();
      await page.keyboard.press('p'); await settle(400);
      await page.click('.menu [data-key="settings"]');
      const ok = await waitOpen(page, '.panel[data-open="true"]');
      const ms = Date.now() - t0;
      const f = await page.evaluate(() => ({ focus: document.activeElement?.id, busy: !!document.querySelector('[aria-busy="true"]'), gone: !document.querySelector('#wh-menu') }));
      check('the first Settings open (a later-* chunk in the dev server) lands focus on the heading, the Menu is closed and nothing stays aria-busy', ok && f.focus === 'wh-settings-title' && !f.busy && f.gone, `${ms} ms, ${JSON.stringify(f)}`);
      await page.keyboard.press('Escape'); await settle(500);
      await page.keyboard.press('p'); await settle(400);
      const reqsBefore = reqs.length;
      await page.click('.menu [data-key="settings"]');
      const ok2 = await waitOpen(page, '.panel[data-open="true"]');
      const vals = await page.evaluate(() => ({ vol: document.querySelector('#wh-volume').value, q: document.querySelector('#wh-quality input:checked').value }));
      check('the second open asks the network for no module again (the chunk is loaded) and the panel shows the current values', ok2 && reqs.length === reqsBefore && vals.vol === '80' && vals.q === 'auto', `${reqs.length - reqsBefore} new module requests, ${JSON.stringify(vals)}`);
      check('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
      await context.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    await vite.stop();
  }
  const all = errsAll.flat();
  console.log(`\n${total - bad}/${total} B4b live checks passed${all.length ? `  (page errors seen: ${all.length})` : ''}`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
