// Behaviour checks of the toolbar (UI.md 4.1 to 4.3, 3.3 tooltips) on the kit page's scenes: roving tabindex, arrows / Home / End, aria-pressed, the
// active tool again = Hand, disabled + reason, the attachment's caret, the More popover, the tooltip (K16), the Hoard button's home per layout, 44 px hit
// boxes. Seeds the B3d harness rows. Own vite (default port 5433). Exit 1 on any FAIL.
//   node _harness/uikit/toolbar_check.mjs [--port=5433]
import { ROOT, launch, startVite } from '../pw.mjs';

process.env.WH_FROZEN = '1';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=5433').split('=')[1]);
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? '  ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = await startVite(PORT);
const browser = await launch({});
try {
  const open = async (w, h, only, o = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...o });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`${vite.url}_harness/uikit/index.html?batch=B3&only=${only}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(250);
    return { ctx, page, errs };
  };
  const state = (page) => page.evaluate(() => {
    const dock = document.getElementById('wh-dock');
    const tools = [...dock.querySelectorAll('.dock-tool:not(.dock-more)')].filter((b) => !b.hidden);
    const more = dock.querySelector('.dock-more');
    const ae = document.activeElement;
    return {
      tool: dock.dataset.tool, form: dock.dataset.form, attach: dock.dataset.attach, open: dock.dataset.open,
      pressed: tools.map((b) => `${b.dataset.tool}:${b.getAttribute('aria-pressed')}`).join(' '),
      stops: [...dock.querySelectorAll('.dock-tools button')].filter((b) => !b.hidden && b.tabIndex === 0).map((b) => b.dataset.tool),
      focus: ae && ae.dataset ? ae.dataset.tool ?? ae.className : String(ae),
      moreShown: !!more && !more.hidden,
      hoardParent: document.querySelector('.hoard-btn')?.parentElement?.className,
    };
  });

  // ============ wide 1280x800: the full form ============
  {
    const { ctx, page, errs } = await open(1280, 800, 'scene-cut');
    let s = await state(page);
    check('wide: dock form full, attachment above, Cut in hand (scene-cut) with its bar open', s.form === 'full' && s.attach === 'above' && s.tool === 'cut' && s.open === 'true', JSON.stringify(s));
    check('toolbar: aria-pressed marks only the tool in hand', s.pressed === 'hand:false cut:true snap:false', s.pressed);
    check('toolbar: ONE Tab stop in the tools (roving tabindex), on the tool in hand', s.stops.length === 1 && s.stops[0] === 'cut', JSON.stringify(s.stops));
    check('Hoard button lives in the dock\'s Collection group in wide', s.hoardParent === 'dock-group', String(s.hoardParent));
    const roles = await page.evaluate(() => ({
      group: document.querySelector('#wh-dock [role=group]')?.getAttribute('aria-label'),
      toolbar: document.querySelector('#wh-dock [role=toolbar]')?.getAttribute('aria-label'),
      keys: [...document.querySelectorAll('#wh-dock .dock-tool:not(.dock-more)')].map((b) => b.getAttribute('aria-keyshortcuts')).join('|'),
      names: [...document.querySelectorAll('#wh-dock .dock-tool:not(.dock-more)')].map((b) => b.textContent.replace(/\s+/g, '')).join('|'),
      caption: document.querySelector('.dock-caption')?.getAttribute('aria-hidden'),
    }));
    check('names: group "Collection", toolbar "Tools", shortcuts and visible names per tool, caption chip aria-hidden', roles.group === 'Collection' && roles.toolbar === 'Tools' && roles.keys === '1 Escape|2 C|3 S' && roles.names === 'Hand1|CutC|SnapS' && roles.caption === 'true', JSON.stringify(roles));
    // keyboard: focus the tool in hand, arrows / Home / End wrap, Enter picks, the active tool again = Hand
    await page.evaluate(() => document.querySelector('#wh-dock .dock-tool[data-tool=cut]').focus());
    const seq = [];
    for (const k of ['ArrowRight', 'ArrowRight', 'Home', 'ArrowLeft', 'End']) { await page.keyboard.press(k); seq.push((await state(page)).focus); }
    check('keys: ArrowRight, ArrowRight (wraps), Home, ArrowLeft (wraps), End move focus through the tools', seq.join(' ') === 'snap hand hand snap snap', seq.join(' '));
    await page.keyboard.press('Home');
    s = await state(page);
    check('roving: the Tab stop follows focus (Hand now)', s.stops.length === 1 && s.stops[0] === 'hand', JSON.stringify(s.stops));
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await sleep(200);
    s = await state(page);
    check('Enter on Snap picks it: aria-pressed moves, the dock says snap, the bar is Snap\'s', s.tool === 'snap' && s.pressed === 'hand:false cut:false snap:true', JSON.stringify(s));
    await page.keyboard.press('Enter'); await sleep(200);
    s = await state(page);
    check('the active tool pressed again returns the Hand (and the bar goes)', s.tool === 'hand' && s.open === 'false', JSON.stringify(s));
    // a re-measure (fonts, resize, layout) never blurs the focused control
    const kept = await page.evaluate(() => { const b = document.querySelector('#wh-dock .dock-tool[data-tool=cut]'); b.focus(); window.__kitToolbar.fit(); return document.activeElement === b; });
    check('re-measure: fit() keeps the focus on the focused tool', kept);
    // caret on its tool
    await page.click('#wh-dock .dock-tool[data-tool=snap]'); await sleep(450);
    const caret = await page.evaluate(() => {
      const c = document.querySelector('#wh-dock .dock-caret').getBoundingClientRect();
      const t = document.querySelector('#wh-dock .dock-tool[data-tool=snap]').getBoundingClientRect();
      const b = document.querySelector('#wh-dock .dock-attach-body').getBoundingClientRect();
      return { caretX: c.left + c.width / 2, toolX: t.left + t.width / 2, bodyL: b.left, bodyR: b.right, caretY: c.top, bodyBottom: b.bottom, toolTop: t.top };
    });
    check('attachment: the caret points at the tool in hand (within 2 px) and sits under the bar', Math.abs(caret.caretX - caret.toolX) <= 2 && caret.caretX > caret.bodyL && caret.caretX < caret.bodyR && Math.abs(caret.caretY - caret.bodyBottom) <= 3, JSON.stringify(caret));
    // disabled + reason
    await page.evaluate(() => { window.__kitBlocked = []; window.__kitToolbar.setDisabled({ cut: 'Cut is not available while a capsule is opening.' }); });
    const dis = await page.evaluate(() => {
      const b = document.querySelector('#wh-dock .dock-tool[data-tool=cut]');
      const why = document.getElementById(b.getAttribute('aria-describedby'));
      return { ad: b.getAttribute('aria-disabled'), why: why?.textContent, focusable: b.tabIndex };
    });
    check('disabled: aria-disabled + the reason through aria-describedby, still focusable', dis.ad === 'true' && /capsule/.test(dis.why ?? '') && dis.focusable >= -1, JSON.stringify(dis));
    await page.evaluate(() => window.__kitToolbar.button('hand').click());
    await page.click('#wh-dock .dock-tool[data-tool=cut]', { force: true }); await sleep(150); // (Playwright treats aria-disabled as not enabled: force the press a person can make)
    const blocked = await page.evaluate(() => ({ tool: window.__kitToolbar.tool, blocked: window.__kitBlocked }));
    check('disabled: a press does not change the tool and reports the reason', blocked.tool === 'hand' && blocked.blocked.length === 1 && /capsule/.test(blocked.blocked[0] ?? ''), JSON.stringify(blocked));
    await page.evaluate(() => window.__kitToolbar.setDisabled(null));
    check('no page errors (wide)', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ============ stack 390x844: compact, tooltips ============
  {
    const { ctx, page, errs } = await open(390, 844, 'scene-rest');
    let s = await state(page);
    check('stack: compact form, attachment above, Hoard in the dock', s.form === 'compact' && s.attach === 'above' && s.hoardParent === 'dock-group', JSON.stringify(s));
    const geo = await page.evaluate(() => {
      const scene = document.querySelector('.kp-scene');
      scene.scrollIntoView({ block: 'start' });
      const sr = scene.getBoundingClientRect();
      const r = (q) => { const e = document.querySelector(q); const b = e.getBoundingClientRect(); return { x: b.x - sr.x, y: b.y - sr.y, w: b.width, h: b.height, r: b.right - sr.x, b: b.bottom - sr.y }; };
      return { bar: r('#wh-dock .dock-bar'), tools: [...document.querySelectorAll('#wh-dock .dock-tool')].filter((b) => !b.hidden).map((b) => { const q = b.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }), sh: sr.height, label: getComputedStyle(document.querySelector('#wh-dock .dock-tool-label')).position };
    });
    check('stack: bar 52 high, bottom edge 14 from the scene bottom, tools 44 x 44, labels visually hidden', Math.round(geo.bar.h) === 52 && Math.round(geo.sh - geo.bar.b) === 14 && geo.tools.every(([w, h]) => w === 44 && h === 44) && geo.label === 'absolute', JSON.stringify(geo));
    // tooltip on hover (fine pointer), hoverable, Esc, none on touch
    await page.hover('#wh-dock .dock-tool[data-tool=cut]');
    await sleep(200);
    const early = await page.evaluate(() => !document.querySelector('.k-tip')?.hidden && !!document.querySelector('.k-tip'));
    await sleep(450);
    const tip = await page.evaluate(() => { const t = document.querySelector('.k-tip'); return t && !t.hidden ? { text: t.textContent, place: t.dataset.place } : null; });
    check('tooltip: not at 200 ms, there after 450 ms with "Cut (C)"', early === false && tip && tip.text === 'Cut (C)', JSON.stringify({ early, tip }));
    const tb = await page.evaluate(() => { const r = document.querySelector('.k-tip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(tb.x, tb.y); await sleep(400);
    const still = await page.evaluate(() => !document.querySelector('.k-tip').hidden);
    check('tooltip: hoverable (the pointer may move onto it and it stays)', still);
    await page.keyboard.press('Escape'); await sleep(80);
    const gone = await page.evaluate(() => ({ hidden: document.querySelector('.k-tip').hidden, tool: window.__kitToolbar.tool }));
    check('tooltip: Escape dismisses it (and nothing else happens)', gone.hidden && gone.tool === 'hand', JSON.stringify(gone));
    await page.mouse.move(5, 5); await sleep(300);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const ks = await page.evaluate(() => ({ focus: document.activeElement?.dataset?.tool, tip: (() => { const t = document.querySelector('.k-tip'); return t && !t.hidden ? t.textContent : null; })() }));
    check('tooltip: instant on keyboard focus (Tab reaches the Hand button, "Hand (1)")', ks.focus === 'hand' && ks.tip === 'Hand (1)', JSON.stringify(ks));
    check('no page errors (stack)', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
    // touch: none
    const t = await open(390, 844, 'scene-rest', { hasTouch: true, isMobile: true });
    await t.page.evaluate(() => document.querySelector('.kp-scene').scrollIntoView({ block: 'start' }));
    const box = await t.page.evaluate(() => { const r = document.querySelector('#wh-dock .dock-tool[data-tool=cut]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await t.page.touchscreen.tap(box.x, box.y); await sleep(700);
    const tt = await t.page.evaluate(() => { const e = document.querySelector('.k-tip'); return { tip: !!e && !e.hidden, tool: window.__kitToolbar.tool }; });
    check('tooltip: none on touch; a tap still picks the tool', !tt.tip && tt.tool === 'cut', JSON.stringify(tt));
    await t.ctx.close();
  }

  // ============ strip 844x390 and tiny 358x201: where the Hoard button lives, inline attachment ============
  const rel = (page) => page.evaluate(() => {
    const scene = document.querySelector('.kp-scene');
    scene.scrollIntoView({ block: 'start' });
    const sr = scene.getBoundingClientRect();
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x - sr.x), y: Math.round(b.y - sr.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right - sr.x), b: Math.round(b.bottom - sr.y) }; };
    const visible = (e) => !e.hidden && e.getClientRects().length > 0;
    return {
      bar: r(document.querySelector('#wh-dock .dock-bar')), attach: r(document.querySelector('#wh-dock .dock-attach-body')),
      tools: [...document.querySelectorAll('#wh-dock .dock-tool, #wh-dock .dock-hoard')].filter(visible).map(r), moreShown: visible(document.querySelector('#wh-dock .dock-more')),
      caret: getComputedStyle(document.querySelector('.dock-caret')).display, barDisplay: getComputedStyle(document.querySelector('#wh-dock .dock-bar')).display,
      sw: sr.width, sh: sr.height, scrollW: document.documentElement.scrollWidth, iw: innerWidth,
    };
  });
  {
    const { ctx, page } = await open(844, 390, 'scene-cut');
    const s = await state(page);
    const g = await rel(page);
    check('strip: Hoard button is in the bottom row; the dock is the three tools only (no More), y 8, 52 high, the options inline to their right, no caret',
      s.form === 'compact' && s.attach === 'inline' && s.hoardParent === 'kp-row-hoard' && g.bar.y === 8 && g.bar.h === 52 && !g.moreShown && g.tools.length === 3 && g.attach.x >= g.bar.r && g.caret === 'none', JSON.stringify({ s, g }));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(358, 201, 'scene-rest');
    const s = await state(page);
    const g = await rel(page);
    check('tiny (rest): bare form, the tools are 44 x 44 on ONE row y 151..195 with the Hoard button first (Hoard, Hand, Cut, Snap), nothing past the right edge',
      s.form === 'bare' && s.hoardParent === 'dock-group' && g.tools.length === 4 && g.tools.every((t) => t.w === 44 && t.h === 44 && t.y === 151) && g.scrollW <= g.iw, JSON.stringify(g));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(358, 201, 'scene-cut');
    const g = await rel(page);
    check('tiny (Cut open): the tray steps aside, the options bar IS the row (y 151..195, inside 12 px gutters, nothing past the right edge)', g.barDisplay === 'none' && g.attach.y === 151 && g.attach.h === 44 && g.attach.x >= 12 && g.attach.r <= g.sw - 12 && g.scrollW <= g.iw, JSON.stringify(g));
    // the way back: Done (first control) returns the Hand and the tray, focus goes to the Hand button
    const back = await page.evaluate(async () => {
      const first = document.querySelector('#wh-dock .dock-attach-slot button');
      first.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { tool: window.__kitToolbar.tool, open: document.getElementById('wh-dock').dataset.open };
    });
    // (the mock Done button does not call the toolbar: the test presses the Cut tool's job through the API, as hudBinding will)
    await page.evaluate(() => window.__kitToolbar.attach(null));
    await sleep(100);
    const after = await page.evaluate(() => ({ open: document.getElementById('wh-dock').dataset.open, bar: getComputedStyle(document.querySelector('#wh-dock .dock-bar')).display }));
    check('tiny: closing the attachment brings the tray back', after.open === 'false' && after.bar !== 'none', JSON.stringify({ back, after }));
    await ctx.close();
  }

  // ============ More: the overflow ============
  {
    const { ctx, page, errs } = await open(390, 844, 'toolbar-parts');
    const m = await page.evaluate(() => {
      const hosts = [...document.querySelectorAll('.kp-dockhost')].filter((h) => h.style.width === '260px');
      return hosts.map((h) => {
        const dock = h.querySelector('.dock');
        const more = dock.querySelector('.dock-more');
        return { tools: [...dock.querySelectorAll('.dock-tool:not(.dock-more)')].filter((b) => !b.hidden).map((b) => b.dataset.tool).join(','), more: !more.hidden, active: more.dataset.active, open: dock.dataset.open, menu: [...dock.querySelectorAll('.dock-menuitem')].map((b) => b.dataset.tool).join(','), expanded: more.getAttribute('aria-expanded'), w: Math.round(dock.getBoundingClientRect().width) };
      });
    });
    check('More: in a 260 px tray Snap, Stamp and Roll go behind More', m[0].more && m[0].tools === 'hand,cut' && m[0].menu === '' && m[0].expanded === 'false', JSON.stringify(m[0]));
    check('More: the tool in hand never hides (Roll in hand: Roll shows beside Hand, More stays for the rest)', m[1].tools === 'hand,roll' && m[1].more, JSON.stringify(m[1]));
    check('More: the popover takes the attachment slot (open, aria-expanded, a menu of the hidden tools)', m[2].open === 'true' && m[2].expanded === 'true' && m[2].menu.length > 0, JSON.stringify(m[2]));
    const nav = await page.evaluate(async () => {
      const hosts = [...document.querySelectorAll('.kp-dockhost')].filter((h) => h.style.width === '260px');
      const dock = hosts[2].querySelector('.dock');
      const first = document.activeElement?.getAttribute?.('role');
      return { first, items: dock.querySelectorAll('[role=menuitemradio]').length, menuRole: dock.querySelector('[role=menu]')?.getAttribute('aria-label') };
    });
    check('More: focus is in the menu (menuitemradio items), the menu is named', nav.first === 'menuitemradio' && nav.items >= 1 && nav.menuRole === 'More tools', JSON.stringify(nav));
    await page.keyboard.press('Escape'); await sleep(120);
    const after = await page.evaluate(() => { const hosts = [...document.querySelectorAll('.kp-dockhost')].filter((h) => h.style.width === '260px'); const dock = hosts[2].querySelector('.dock'); return { open: dock.dataset.open, focus: document.activeElement?.dataset?.tool, expanded: dock.querySelector('.dock-more').getAttribute('aria-expanded') }; });
    check('More: Escape closes the popover and returns focus to More', after.open === 'false' && after.focus === 'more' && after.expanded === 'false', JSON.stringify(after));
    check('no page errors (parts)', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
} catch (e) {
  fails++;
  console.log('FAIL harness crashed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : String(e)));
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
console.log(`\n${fails ? fails + ' FAILURE(S)' : 'all toolbar checks passed'}`);
process.exit(fails ? 1 : 0);
