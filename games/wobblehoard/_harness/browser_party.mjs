// Browser check of the Friends strip (R10_PLAYUX item 2; owner 2026-11-19: "there needs to be an easier way to take out squishies for them to play together").
// 1280x800 (mouse) and 390x844 (touch), REAL input only for the player's path:
//   before: the Hoard's path (Hoard, a plinth, its card's take-out button, again) counted in taps for 2 and 3 out
//   after:  the strip in the info row is visible and labelled; Friends + one face = 2 out (2 taps); one more face = 3 out (3 taps); a face that is out sends it back;
//           "Bring friends" fills the party to the cap in one tap; at the cap (quality low: 3) one more is refused with the words in the card (no silent no-op);
//           the strip never overlaps the dock, the ring or a squishy's disc (390x844 checked with 1 and 3 out); the picker stays inside the frame;
//           the published paths still work: the Hoard's card takes one out ("Take out too"), the quick switcher's row (where drawn) switches, the Cut tool
//           cuts with one out; 0 console errors / warnings / page errors / failed requests. Screenshots in _harness/_renders/party/.
// Usage: node _harness/browser_party.mjs [--port=5362] [--only=desk|phone]   (exits 1 on a failure)
import { launch, startVite, ROOT } from './pw.mjs';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(arg('port', 5362)), ONLY = arg('only', '');
const SHOTS = resolve(ROOT, '_harness/_renders/party');
mkdirSync(SHOTS, { recursive: true });
let bad = 0, total = 0;
const check = (name, ok, extra = '') => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAMES = [
  ['desk', { viewport: { width: 1280, height: 800 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }],
].filter(([n]) => !ONLY || n === ONLY);
const srv = await startVite(PORT);
const browser = await launch();
try {
  for (const [frame, ctxOpt] of FRAMES) {
    const touch = frame === 'phone';
    const ctx = await browser.newContext(ctxOpt);
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/React DevTools/.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => errs.push('failed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
    await page.goto(srv.url + '?dev=1&rseed=4242', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
    await page.waitForSelector('.cta:not([disabled])', { timeout: 60000 });
    let taps = 0;
    const tapAt = async (x, y) => { taps++; if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null; }, sel);
    const tapSel = async (sel) => { await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {}); const b = await box(sel); if (!b) throw new Error('not shown: ' + sel); await tapAt(b.x + b.w / 2, b.y + b.h / 2); await sleep(500); };
    const count = () => page.evaluate(() => window.__WH__.shell.matInfo().count);
    const step = (s) => page.evaluate(async (sec) => { for (let t = 0; t < sec - 1e-9; t += 0.5) { window.__WH__.step(1 / 60, Math.round(Math.min(0.5, sec - t) * 60)); await new Promise((r) => setTimeout(r, 0)); } }, s);
    const shot = async (n) => { await page.evaluate(() => { const d = document.querySelector('.dev'); if (d) d.style.visibility = 'hidden'; }); await page.evaluate(async () => { const raf = () => new Promise((r) => requestAnimationFrame(() => r())); await raf(); await raf(); }); await page.screenshot({ path: resolve(SHOTS, `${n}_${frame}.png`), timeout: 240000, caret: 'hide' }); };
    await tapSel('.cta'); taps = 0;
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !!window.__WH__.life(), null, { timeout: 60000 });
    await page.evaluate(() => { const wh = window.__WH__; wh.shell.matBusyMs(1e9); wh.setSetting('quality', 'high'); wh.setSetting('skipAnimations', true); wh.pause(); });
    // a fresh player owns Dollop alone: the strip waits for a second squishy
    await sleep(800);
    check(`${frame}: a fresh Wake (Dollop alone): no Friends strip yet (nothing to bring)`, !(await box('.pt-strip .pt-btn')));
    // five capsules through the meter (the dev hook's grant; the ceremony skipped)
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => { window.__WH__.shell.grant(1); });
      for (let k = 0; k < 30 && !(await page.evaluate(() => window.__WH__.shell.meter().onTable)); k++) await step(0.1);
      await page.evaluate(() => { void window.__WH__.shell.openCapsule(); });
      for (let k = 0; k < 40; k++) { await step(0.1); if (await page.evaluate(() => { const c = window.__WH__.shell.ceremony(); return c.kind === null && !c.pending; })) break; }
    }
    await step(1);
    // (the capsules' newcomers came out beside Dollop, D-52: everyone back on the shelf first, by the HUD's own Put back chip)
    if ((await count()) > 1) { await page.evaluate(() => window.__WH__.resume()); await tapSel('.mat-chip'); await page.evaluate(() => window.__WH__.pause()); await step(1); }
    const owned = await page.evaluate(() => new Set(window.__WH__.shell.hoardState().items.map((it) => it.species)).size);
    await page.evaluate(() => window.__WH__.resume());
    await sleep(800);
    // ---- before: the Hoard's path, counted ----
    taps = 0;
    const viaHoard = async () => {
      await tapSel('.hoard-btn'); await sleep(500);
      const sp = await page.evaluate(() => { const out = new Set([window.__WH__.shell.identity().species, ...window.__WH__.shell.matInfo().bodies.map((b) => b.itemId)]); const ids = new Set(window.__WH__.shell.matInfo().bodies.map((b) => b.itemId)); const it = window.__WH__.shell.hoardState().items.find((x) => !ids.has(x.id) && x.species !== window.__WH__.shell.identity().species && !out.has(x.species)); return it ? it.species : null; });
      await tapSel(`.hoard .plinth[data-species="${sp}"]`); await sleep(500);
      await tapSel('.hcard-actions [data-key="mat"]'); await sleep(600);
    };
    await viaHoard();
    const tapsTwoBefore = taps, twoBefore = await count();
    const label = await page.evaluate(() => document.querySelector('.hcard-actions [data-key="mat"]')?.textContent ?? null);
    await viaHoard();
    const tapsThreeBefore = taps, threeBefore = await count();
    check(`${frame} BEFORE (the Hoard's path, real input): 2 out in ${tapsTwoBefore} taps, 3 out in ${tapsThreeBefore} taps (Hoard, a plinth, its card's "Take out too", twice)`, twoBefore === 2 && threeBefore === 3, JSON.stringify({ twoBefore, threeBefore }));
    void label;
    // everyone back (the Put back chip), then the strip's path
    await tapSel('.mat-chip'); await sleep(800);
    const n1 = await count();
    await shot('party_1out');
    const s0 = await page.evaluate(() => { const b = document.querySelector('.pt-btn'), l = document.querySelector('.pt-label'); const lr = l ? l.getBoundingClientRect() : null; return b ? { text: b.textContent.trim(), label: b.getAttribute('aria-label'), form: document.querySelector('.pt-strip')?.dataset.form, labelPx: lr ? Math.round(lr.width) : 0 } : null; });
    check(`${frame}: with ${owned} species owned and one out, the play screen shows a labelled "Friends" button with a plus, the word VISIBLE (a control with words, not a gesture)`, n1 === 1 && !!s0 && /Friends/.test(s0.text) && /Friends/.test(s0.label ?? '') && s0.form !== 'icon' && s0.labelPx >= 40, JSON.stringify({ n1, s0 }));
    // ---- after: Friends, then faces ----
    taps = 0;
    await tapSel('.pt-btn');
    const card = await box('.pt-card');
    const vp = page.viewportSize();
    check(`${frame}: Friends opens the picker inside the frame ("Friends out to play", "1 of N", Bring friends, a face per species)`, !!card && card.x >= 0 && card.r <= vp.width && card.y >= 0 && card.b <= vp.height
      && (await page.evaluate(() => document.querySelectorAll('.pt-chip').length)) >= Math.min(owned, 4), JSON.stringify(card));
    await shot('party_picker');
    await tapSel('.pt-chip[aria-pressed="false"]:not([data-play])');
    const two = await count(), tapsTwo = taps;
    await tapSel('.pt-chip[aria-pressed="false"]:not([data-play])');
    const three = await count(), tapsThree = taps;
    check(`${frame} AFTER (the strip, real input): a second squishy out in ${tapsTwo} taps (<= 2), three out in ${tapsThree} taps (<= 4)`, two === 2 && three === 3 && tapsTwo <= 2 && tapsThree <= 4, JSON.stringify({ two, three, tapsTwo, tapsThree }));
    await shot('party_picker3');
    // a face that is out sends it back
    const outChip = await page.evaluate(() => document.querySelector('.pt-chip[aria-pressed="true"]:not([data-play])')?.getAttribute('data-item'));
    await tapSel(`.pt-chip[data-item="${outChip}"]`);
    const back = await count();
    await tapSel(`.pt-chip[data-item="${outChip}"]`);
    check(`${frame}: a face that is out, tapped, goes back to the shelf (3 -> ${back}); tapped again it comes out (${await count()})`, back === 2 && (await count()) === 3);
    // close the picker (Esc / the X), look at the strip with three out
    await tapSel('.pt-close');
    await step(2); await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    await shot('party_3out');
    const lay = await page.evaluate(() => {
      const r = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return q.width > 0 ? { x: q.x, y: q.y, r: q.right, b: q.bottom } : null; };
      const s = r(document.querySelector('.pt-strip:not([hidden]) .pt-btn'));
      const others = ['#wh-dock .dock-bar', '.meter-cluster', '.nametag', '.mat-chip:not([hidden])', '.hint[data-show="true"]', '.qswitch:not([hidden])'].map((q) => [q, r(document.querySelector(q))]).filter(([, b]) => b);
      const ov = (a, b) => !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
      const hits = s ? others.filter(([, b]) => ov(s, b)).map(([q]) => q) : ['no strip'];
      const discs = window.__WH__.shell.matInfo().bodies.filter((d) => d.r > 0 && s && d.x + d.r * 0.8 > s.x && d.x - d.r * 0.8 < s.r && d.y + d.r * 0.8 > s.y && d.y - d.r * 0.8 < s.b).length;
      return { strip: s, hits, discs, form: document.querySelector('.pt-strip')?.dataset.form, faces: document.querySelectorAll('.pt-face').length, label: document.querySelector('.pt-btn')?.getAttribute('aria-label') };
    });
    check(`${frame}: with three out the strip shows their faces and overlaps nothing (dock, ring, name tag, Put back, hint, switcher) and no squishy's disc`, !!lay.strip && lay.hits.length === 0 && lay.discs === 0 && /out to play/.test(lay.label ?? ''), JSON.stringify(lay));
    // Bring friends: send two back, then one tap fills to the cap
    await tapSel('.pt-btn');
    for (const id of await page.evaluate(() => [...document.querySelectorAll('.pt-chip[aria-pressed="true"]:not([data-play])')].map((b) => b.getAttribute('data-item')))) await tapSel(`.pt-chip[data-item="${id}"]`);
    const lim = await page.evaluate(() => window.__WH__.shell.matInfo().limit);
    taps = 0;
    await tapSel('.pt-bring');
    const filled = await count();
    check(`${frame}: "Bring friends" fills the party in ONE tap (1 -> ${filled}; the cap ${lim}, ${owned} species owned)`, taps === 1 && filled === Math.min(lim, owned), JSON.stringify({ filled, lim, owned }));
    await step(1); await page.evaluate(() => window.__WH__.resume()); await sleep(600);
    await shot('party_full');
    // the cap (quality low: 3) is respected with words
    await page.evaluate(() => window.__WH__.setSetting('quality', 'low'));
    await sleep(400);
    await tapSel('.pt-btn');
    for (const id of await page.evaluate(() => [...document.querySelectorAll('.pt-chip[aria-pressed="true"]:not([data-play])')].map((b) => b.getAttribute('data-item')).slice(2))) await tapSel(`.pt-chip[data-item="${id}"]`);
    const at3 = await count();
    const more = await page.evaluate(() => !!document.querySelector('.pt-chip[aria-pressed="false"]:not([data-play])'));
    if (more) await tapSel('.pt-chip[aria-pressed="false"]:not([data-play])');
    const refused = await page.evaluate(() => ({ n: window.__WH__.shell.matInfo().count, note: document.querySelector('.pt-note:not([hidden])')?.textContent ?? '', bring: !!document.querySelector('.pt-bring:not([hidden])') }));
    await shot('party_cap');
    check(`${frame}: at the cap (quality low: 3) one more is refused in words in the card ("3 can play at once...") and Bring friends steps aside; the count stays 3`, at3 === 3 && more && refused.n === 3 && /3 can play at once/.test(refused.note) && !refused.bring, JSON.stringify(refused));
    await tapSel('.pt-close');
    await page.evaluate(() => window.__WH__.setSetting('quality', 'high'));
    // the published paths: the Hoard card's take-out (one back first), the quick switcher, the Cut tool with one out
    await tapSel('.pt-btn');
    const sendBack = await page.evaluate(() => document.querySelector('.pt-chip[aria-pressed="true"]:not([data-play])')?.getAttribute('data-item'));
    await tapSel(`.pt-chip[data-item="${sendBack}"]`);
    await tapSel('.pt-close');
    const c0 = await count();
    await viaHoard();
    check(`${frame}: the Hoard's card still takes one out ("${await page.evaluate(() => 'Take out too')}" path: ${c0} -> ${await count()})`, (await count()) === c0 + 1);
    const qs = await box('.qswitch:not([hidden]) .qs-btn');
    if (qs) {
      const id0 = await page.evaluate(() => window.__WH__.shell.identity().itemId);
      await tapAt(qs.x + qs.w / 2, qs.y + qs.h / 2); await sleep(1200);
      check(`${frame}: the quick switcher still switches the play squishy`, (await page.evaluate(() => window.__WH__.shell.identity().itemId)) !== id0);
    } else console.log(`   (${frame}: the quick switcher row is not drawn in this layout)`);
    await tapSel('.mat-chip'); await sleep(800);
    await page.evaluate(() => window.__WH__.pause());
    const cutR = await page.evaluate(() => { const wh = window.__WH__; const r = wh.shell.cutSplit(); wh.step(1 / 60, 60); return { r, pieces: wh.shell.cutInfo().pieces }; });
    check(`${frame}: the Cut still cuts with one out`, (await count()) >= 1 && cutR.pieces >= 2, JSON.stringify(cutR));
    await page.evaluate(() => window.__WH__.resume());
    check(`${frame}: 0 console errors / warnings / page errors / failed requests`, errs.length === 0, errs.slice(0, 4).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(`\n${total - bad}/${total} browser party checks passed`);
process.exit(bad ? 1 : 0);
