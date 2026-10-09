// Behaviour checks of the options bars and the HUD parts of B3b (UI.md 4.2, 4.4, 6) on the kit page: the real Cut bar and Snap bar (cutBar.ts, snapBar.ts) on a
// stub Cutter, the label mode each slot width earns, accessible names (label in name), disabled + reason, the style control (free, locked, keyboard), Done first on
// tiny, the Snap swatches, the meter ring's "capsule waiting" states, the quick switcher's forms. Seeds the B3d harness rows. Own vite (default port 5434).
//   node _harness/uikit/optbar_check.mjs [--port=5434]
import { launch, startVite } from '../pw.mjs';

process.env.WH_FROZEN = '1';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=5434').split('=')[1]);
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? '  ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = await startVite(PORT);
const browser = await launch({});
try {
  const open = async (w, h, only, o = {}, query = '') => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...o });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`${vite.url}_harness/uikit/index.html?batch=B3&only=${only}${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(350);
    return { ctx, page, errs };
  };

  // ============ 1280x800: the sheet of specimens ============
  {
    const { ctx, page, errs } = await open(1280, 800, 'opts-parts');
    const bars = await page.evaluate(() => window.__kitBars.map((b) => ({ id: b.id, kind: b.kind, mode: b.bar.mode, wrapped: b.bar.wrapped })));
    const mode = (id) => bars.find((b) => b.id === id);
    check('Cut bar label modes follow the slot: 700 long, 560 short, 440 icon, 340 tight, 270 tight + wrapped', mode('cut-long').mode === 'long' && mode('cut-short').mode === 'short' && mode('cut-icon').mode === 'icon' && mode('cut-tight').mode === 'tight' && !mode('cut-tight').wrapped && mode('cut-wrap').mode === 'tight' && mode('cut-wrap').wrapped, JSON.stringify(bars.filter((b) => b.id.startsWith('cut-')).slice(0, 5).map((b) => `${b.id}:${b.mode}${b.wrapped ? '+wrap' : ''}`)));
    check('Snap bar label modes follow the slot: 700 long, 480 short, 330 icon, 270 tight + wrapped', mode('snap-long').mode === 'long' && mode('snap-short').mode === 'short' && mode('snap-icon').mode === 'icon' && mode('snap-wrap').wrapped, JSON.stringify(bars.filter((b) => b.id.startsWith('snap-')).slice(0, 4).map((b) => `${b.id}:${b.mode}${b.wrapped ? '+wrap' : ''}`)));

    // no bar overflows its slot unless it wrapped; every option button is >= 44 high
    const overflow = await page.evaluate(() => window.__kitBars.filter((b) => !b.bar.wrapped && b.bar.el.getClientRects().length && b.bar.el.scrollWidth > b.bar.el.clientWidth + 1).map((b) => b.id));
    check('no bar overflows its slot (scrollWidth <= clientWidth) except the wrapped one', overflow.length === 0, JSON.stringify(overflow));
    const small = await page.evaluate(() => [...document.querySelectorAll('.opts button, .opts .k-seg-input')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute('aria-label') || e.className).slice(0, 30), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h < 44 || x.w < 44));
    check('every control in every bar has a box of at least 44 x 44 (the style faces by their hit input)', small.length === 0, JSON.stringify(small.slice(0, 4)));

    // names: label in name (WCAG 2.5.3), the accessible name is always the full one
    const names = await page.evaluate(() => {
      const out = [];
      for (const b of window.__kitBars) for (const btn of b.bar.el.querySelectorAll('button:not([aria-busy="true"])')) {   // (a busy button draws dots over its word: the name says Saving...)
        const vis = [...btn.querySelectorAll('.opts-label, .snap-tint-word')].filter((s) => getComputedStyle(s).position !== 'absolute').map((s) => s.textContent.trim()).join(' ');
        const name = btn.getAttribute('aria-label') ?? btn.textContent.trim();
        out.push({ id: b.id, key: btn.dataset.key ?? btn.dataset.tint, vis, name });
      }
      return out;
    });
    const bad = names.filter((n) => !n.name || (n.vis && !n.name.toLowerCase().includes(n.vis.toLowerCase())));
    check('accessible names: never empty; the visible word is contained in the name (Split / "Split in two", Save / "Save photo")', bad.length === 0, JSON.stringify(bad.slice(0, 3)));
    const full = names.find((n) => n.id === 'cut-short' && n.key === 'split');
    const savs = names.find((n) => n.id === 'snap-short' && n.key === 'save');
    check('short mode: the label is short, the name stays full', full.vis === 'Split' && full.name === 'Split in two' && savs.vis === 'Save' && savs.name === 'Save photo', JSON.stringify([full, savs]));
    const icon = names.find((n) => n.id === 'cut-icon' && n.key === 'join');
    check('icon mode: the buttons draw no word, the name stays full', icon.vis === '' && icon.name === 'Reconnect all', JSON.stringify(icon));

    // disabled + reason: whole = Reconnect off; two = Split off; the reason line is the aria-describedby target and holds the shell's words
    const dis = await page.evaluate(() => {
      const two = window.__kitBars.find((b) => b.id === 'cut-two').bar.el;
      const split = two.querySelector('[data-key=split]'), join = two.querySelector('[data-key=join]');
      const why = document.getElementById(split.getAttribute('aria-describedby') ?? '');
      const whole = window.__kitBars.find((b) => b.id === 'cut-whole').bar.el;
      return { splitDisabled: split.disabled, splitAria: split.getAttribute('aria-disabled'), joinDisabled: join.disabled, why: why?.textContent, whyCls: why?.className, wholeJoin: whole.querySelector('[data-key=join]').disabled, wholeSplit: whole.querySelector('[data-key=split]').disabled, wholeSplitDesc: whole.querySelector('[data-key=split]').hasAttribute('aria-describedby') };
    });
    check('two pieces at the limit: Split in two is really off (disabled + aria-disabled) with the shell\'s line as its description; Reconnect all stays ready', dis.splitDisabled && dis.splitAria === 'true' && !dis.joinDisabled && /as many pieces as it can make/.test(dis.why ?? ''), JSON.stringify(dis));
    check('whole: Split ready (no description), Reconnect all off', !dis.wholeSplit && !dis.wholeSplitDesc && dis.wholeJoin, JSON.stringify(dis));
    const busy = await page.evaluate(() => { const e = window.__kitBars.find((b) => b.id === 'cut-busy').bar.el; return ['split', 'join', 'undo'].map((k) => [e.querySelector(`[data-key=${k}]`).getAttribute('aria-disabled'), e.querySelector(`[data-key=${k}]`).disabled]).concat([[e.querySelector('[data-key=done]').getAttribute('aria-disabled'), e.querySelector('.opts-seg').getAttribute('aria-disabled')]]); });
    check('a cut plays: Split, Reconnect, Undo and the style are aria-disabled, Done is not', busy[0][0] === 'true' && busy[1][0] === 'true' && busy[2][0] === 'true' && busy[3][0] === null && busy[3][1] === 'true', JSON.stringify(busy));

    // the style control
    const seg = await page.evaluate(() => {
      const e = window.__kitBars.find((b) => b.id === 'cut-two').bar.el.querySelector('.opts-seg');
      const lock = e.querySelector('.opts-lock');
      const why = document.getElementById(e.getAttribute('aria-describedby') ?? '');
      return { role: e.getAttribute('role'), label: e.getAttribute('aria-label'), locked: e.dataset.locked, aria: e.getAttribute('aria-disabled'), lock: getComputedStyle(lock).display, why: why?.textContent, radios: [...e.querySelectorAll('input')].map((i) => `${i.value}:${i.checked}:${i.disabled}`).join(' ') };
    });
    check('locked style control: a radiogroup "Cut style", aria-disabled, a lock mark, the plain reason as its description, the radios NOT disabled (a press must reach the Cutter)', seg.role === 'radiogroup' && seg.label === 'Cut style' && seg.locked === 'true' && seg.aria === 'true' && seg.lock !== 'none' && seg.why === 'Reconnect first to change the cut style' && seg.radios === 'clean:true:false minis:false:false', JSON.stringify(seg));
    check('the style control is hidden when the Cutter offers no seam (cut-noseam)', await page.evaluate(() => window.__kitBars.find((b) => b.id === 'cut-noseam').bar.el.querySelector('.opts-seg').hidden === true));
    // pressing the locked control: refused, selection restored, the Cutter was asked, the plain reason shows as a tooltip
    await page.evaluate(() => { document.querySelector('.kp-sec').scrollIntoView(); });
    const lockedBar = await page.evaluate(() => window.__kitBars.findIndex((b) => b.id === 'cut-two'));
    const sel = `.opts-seg [data-style=minis]`;
    const handle = await page.evaluateHandle((i) => window.__kitBars[i].bar.el.querySelector('.opts-seg [data-style=minis]'), lockedBar);
    await handle.asElement().scrollIntoViewIfNeeded();
    await handle.asElement().click({ force: true });
    await sleep(150);
    const after = await page.evaluate((i) => {
      const b = window.__kitBars[i];
      const tip = document.querySelector('.k-tip:not([hidden])');
      return { asked: b.stub.asked.join(), style: b.stub.style, checked: [...b.bar.el.querySelectorAll('.opts-seg input')].map((x) => `${x.value}:${x.checked}`).join(' '), tip: tip?.textContent ?? null };
    }, lockedBar);
    check('pressing a locked face: the Cutter is asked (it says the reason in the live region), nothing changes, the selection stays, the plain reason shows', after.asked === 'minis' && after.style === 'clean' && after.checked === 'clean:true minis:false' && after.tip === 'Reconnect first to change the cut style', JSON.stringify(after));
    // a free control: whole squishy, Minis by click, then by the keyboard
    const freeIdx = await page.evaluate(() => window.__kitBars.findIndex((b) => b.id === 'cut-whole'));
    const h2 = await page.evaluateHandle((i) => window.__kitBars[i].bar.el.querySelector('.opts-seg [data-style=minis]'), freeIdx);
    await h2.asElement().scrollIntoViewIfNeeded();
    await h2.asElement().click({ force: true });
    await sleep(100);
    let free = await page.evaluate((i) => ({ asked: window.__kitBars[i].stub.asked.join(), style: window.__kitBars[i].stub.style, data: window.__kitBars[i].bar.el.dataset.style, checked: [...window.__kitBars[i].bar.el.querySelectorAll('.opts-seg input')].map((x) => `${x.value}:${x.checked}`).join(' ') }), freeIdx);
    check('a free style control: a press on Minis reaches the Cutter, the bar shows Minis (data-style, radio checked)', free.asked === 'minis' && free.style === 'minis' && free.data === 'minis' && free.checked === 'clean:false minis:true', JSON.stringify(free));
    await page.evaluate((i) => window.__kitBars[i].bar.el.querySelector('.opts-seg [data-style=minis]').focus(), freeIdx);
    await page.keyboard.press('ArrowLeft'); await sleep(100);
    free = await page.evaluate((i) => ({ asked: window.__kitBars[i].stub.asked.join(), style: window.__kitBars[i].stub.style }), freeIdx);
    check('the style control by keyboard: ArrowLeft moves the radio back to Clean cut and the Cutter hears it', free.asked === 'minis,clean' && free.style === 'clean', JSON.stringify(free));

    // keyboard walk of the long Cut bar (whole squishy): Split in two, then the style radiogroup (ONE stop), then Done, each with the focus ring (3 px lagoon outline)
    const longIdx = await page.evaluate(() => window.__kitBars.findIndex((b) => b.id === 'cut-long'));
    await page.evaluate((i) => { const b = window.__kitBars[i].bar.el.querySelector('[data-key=split]'); b.scrollIntoView({ block: 'center' }); b.focus(); }, longIdx);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');   // (a key press makes :focus-visible match; back on Split)
    const stops = [];
    for (let k = 0; k < 3; k++) {
      const r = await page.evaluate((i) => {
        const ae = document.activeElement; const bar = window.__kitBars[i].bar.el;
        if (!bar.contains(ae)) return { in: false };
        const cs = getComputedStyle(ae.matches('.k-seg-input') ? ae.nextElementSibling : ae);
        return { in: true, id: ae.dataset.key ?? ae.dataset.style, ring: ae.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
      }, longIdx);
      stops.push(r);
      await page.keyboard.press('Tab');
    }
    check('keyboard walk (Tab): Split in two, the checked style face, Done: three stops (Reconnect all is off and skipped), each draws the 3 px focus outline', stops.length === 3 && stops.every((x) => x.in && x.ring && x.outline === 'solid 3px') && stops.map((x) => x.id).join() === 'split,clean,done', JSON.stringify(stops));

    // the status line is drawn only on a full desktop dock (wide, not short)
    const status = await page.evaluate(() => { const s = window.__kitBars[0].bar.el.querySelector('.opts-status'); const cs = getComputedStyle(s); return { pos: cs.position, h: Math.round(s.getBoundingClientRect().height), text: s.querySelector('.opts-text').textContent }; });
    check('wide 1280x800: the instruction line is drawn above the controls (static, with height)', status.pos === 'static' && status.h > 10 && /Swipe across a squishy/.test(status.text), JSON.stringify(status));

    // Snap: swatches are a radiogroup with a roving tabindex
    const snap = await page.evaluate(() => {
      const b = window.__kitBars.find((x) => x.id === 'snap-long').bar.el;
      const g = b.querySelector('[role=radiogroup]');
      const r = [...g.querySelectorAll('[role=radio]')];
      return { label: g.getAttribute('aria-label'), n: r.length, tints: r.map((x) => x.dataset.tint).join(), checked: r.filter((x) => x.getAttribute('aria-checked') === 'true').map((x) => x.dataset.tint).join(), stops: r.filter((x) => x.tabIndex === 0).map((x) => x.dataset.tint).join(), names: r.map((x) => x.textContent.trim()).join() };
    });
    check('Snap swatches: radiogroup "Backdrop", Night, Lagoon, Dusk, Ember, Night checked, ONE tab stop (roving), names readable', snap.label === 'Backdrop' && snap.tints === 'night,lagoon,dusk,ember' && snap.checked === 'night' && snap.stops === 'night' && snap.names === 'Night,Lagoon,Dusk,Ember', JSON.stringify(snap));
    const saving = await page.evaluate(() => { const b = window.__kitBars.find((x) => x.id === 'snap-saving').bar.el.querySelector('[data-key=save]'); return { busy: b.getAttribute('aria-busy'), dis: b.getAttribute('aria-disabled'), name: b.getAttribute('aria-label'), native: b.disabled, dots: getComputedStyle(b.querySelector('.k-dots')).display }; });
    check('saving: aria-busy + aria-disabled (not disabled), the name says Saving..., three dots drawn', saving.busy === 'true' && saving.dis === 'true' && !saving.native && /^Saving/.test(saving.name) && saving.dots === 'flex', JSON.stringify(saving));
    check('no page errors on the sheet', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ============ the scenes at the kit sizes: the bar fits its slot, inside the viewport, Done first on tiny ============
  for (const [w, h, layout] of [[1280, 800, 'wide'], [888, 500, 'wide'], [390, 844, 'stack'], [320, 568, 'stack'], [844, 390, 'strip'], [568, 320, 'strip'], [632, 355, 'strip'], [358, 201, 'tiny']]) {
    for (const sec of ['scene-cut', 'scene-snap']) {
      const { ctx, page, errs } = await open(w, h, sec);
      const r = await page.evaluate(() => {
        const bar = document.querySelector('.opts');
        const rect = bar.getBoundingClientRect();
        const st = document.querySelector('.kp-scene').getBoundingClientRect();   // the scene is the viewport-sized stage; the page's header pushes it down
        const bs = [...bar.querySelectorAll('button')].filter((b) => b.getClientRects().length);
        const acts = bar.querySelector('.opts-row');
        return {
          layout: document.body.dataset.layout, mode: bar.dataset.labels, wrap: bar.dataset.wrap === 'true', slot: bar.parentElement?.className,
          inside: rect.left >= st.left - 0.5 && rect.right <= st.right + 0.5 && rect.top >= st.top - 0.5 && rect.bottom <= st.bottom + 0.5,
          over: bar.scrollWidth > bar.clientWidth + 1, first: acts.querySelector('button')?.dataset.key ?? acts.querySelector('button')?.dataset.tint, hscroll: document.documentElement.scrollWidth - innerWidth,
          h: Math.round(rect.height), w: Math.round(rect.width),
        };
      });
      check(`${w}x${h} ${sec}: layout ${layout}, the bar sits in the dock's slot, inside the viewport, no overflow (mode ${r.mode}${r.wrap ? ' wrapped' : ''}, ${r.w}x${r.h})`, r.layout === layout && r.slot === 'dock-attach-slot' && r.inside && (!r.over || r.wrap) && r.hscroll <= 0, JSON.stringify(r));
      if (layout === 'tiny') check(`${w}x${h} ${sec}: Done comes FIRST in the row (DOM order = Tab order = what is drawn)`, r.first === 'done', String(r.first));
      if (layout !== 'tiny' && sec === 'scene-cut') check(`${w}x${h} ${sec}: Done comes LAST in the row`, await page.evaluate(() => { const b = [...document.querySelectorAll('.opts .opts-row button')]; return b[b.length - 1].dataset.key === 'done'; }));
      if (errs.length) check(`${w}x${h} ${sec}: no page errors`, false, errs.slice(0, 2).join(' | '));
      await ctx.close();
    }
  }

  // ============ HUD parts: the capsule waiting, the switcher forms ============
  {
    const { ctx, page, errs } = await open(1280, 800, 'hud-parts');
    const hp = await page.evaluate(() => {
      const ready = [...document.querySelectorAll('.capsule-btn[data-ready="true"]')];
      const first = ready[0];
      const anim = first.getAnimations().map((a) => ({ name: a.animationName, it: a.effect.getComputedTiming().iterations }));
      const cs = getComputedStyle(first);
      return {
        n: ready.length, anim, shadow: cs.boxShadow.length > 30, gel: first.classList.contains('k-gel'), label: first.getAttribute('aria-label'),
        full: document.querySelectorAll('.meter[data-full="true"]').length, readyWord: getComputedStyle(document.querySelector('.meter[data-full="true"] .meter-ready')).display,
        busy: [...document.querySelectorAll('.capsule-btn')].some((b) => b.disabled),
        qsRow: document.querySelector('.kp-qs--row .qs-row')?.children.length, qsBtn: [...document.querySelectorAll('.kp-qs--row .qs-btn')].slice(0, 5).map((b) => `${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`).join(' '),
        qsNames: [...document.querySelectorAll('.kp-qs--row .qs-btn')].slice(0, 5).map((b) => b.getAttribute('aria-label')).join('|'),
        fold: document.querySelector('.kp-qs--fold .qs-count')?.textContent, steps: [...document.querySelectorAll('.kp-qs--fold .qs-step')].slice(0, 2).map((b) => b.getAttribute('aria-label')).join('|'),
        tierRim: getComputedStyle(document.querySelector('.kp-qs--row .qs-btn[data-tier=rare]')).borderTopWidth,
      };
    });
    check('a capsule waiting: Open is the kit gel, labelled "Open a capsule (N waiting)", breathes TWICE (k-breathe, 2 iterations) then keeps its halo, the ring glows (data-full)', hp.n >= 3 && hp.gel && hp.anim.some((a) => a.name === 'k-breathe' && a.it === 2) && hp.shadow && hp.full >= 3 && /^Open a capsule \(\d+ waiting\)$/.test(hp.label), JSON.stringify(hp));
    check('Normal motion: the ring does not say "Ready" (that is the Calm cue)', hp.readyWord === 'none', hp.readyWord);
    check('a ceremony: Open is disabled (the kit disabled look)', hp.busy);
    check('quick switcher row: five 44 x 44 buttons, each name carries the tier word, a 3 px tier rim', hp.qsRow === 5 && hp.qsBtn === '44x44 44x44 44x44 44x44 44x44' && /Play with Dollop, Common\|.*Uncommon\|Play with Pastrel, Rare/.test(hp.qsNames) && hp.tierRim === '3px', JSON.stringify([hp.qsRow, hp.qsBtn, hp.qsNames, hp.tierRim]));
    check('quick switcher fold: "1/6" between two chevrons named Previous squishy / Next squishy', hp.fold === '1/6' && hp.steps === 'Previous squishy|Next squishy', JSON.stringify([hp.fold, hp.steps]));
    check('no page errors on the HUD parts sheet', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
  // Calm: the same ring says Ready and nothing breathes
  {
    const { ctx, page } = await open(1280, 800, 'hud-parts', { reducedMotion: 'reduce' }, '&calm=1');
    const c = await page.evaluate(() => {
      const first = document.querySelector('.capsule-btn[data-ready="true"]');
      return { anim: first.getAnimations().filter((a) => a.animationName === 'k-breathe').length, ready: getComputedStyle(document.querySelector('.meter[data-full="true"] .meter-ready')).display, glyph: getComputedStyle(document.querySelector('.meter[data-full="true"] .meter-glyph')).opacity, halo: getComputedStyle(first).boxShadow.length > 30 };
    });
    check('Calm: no breathing, the halo stays steady, the ring says Ready (the glyph steps aside)', c.anim === 0 && c.ready === 'grid' && c.glyph === '0' && c.halo, JSON.stringify(c));
    await ctx.close();
  }
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
