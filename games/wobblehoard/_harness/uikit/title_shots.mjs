// Shoots the REAL title card (the live scene behind it) at the kit sizes of UI.md 4.1, in normal and Calm, and measures what a picture can prove.
//   node _harness/uikit/title_shots.mjs [--sizes=1280x800,390x844] [--modes=normal,calm,contrast,forced] [--chips] [--intro] [--port=5437] [--out=<dir>]
// --chips adds ?titlechips=1 (dev only: every destination chip shows, as it will once B4 / B6 land); --intro=200,420,640,860 also takes frames at those
// milliseconds INTO the intro (the page's animations are paused at birth and scrubbed with the Web Animations API; the intro's end timer is held).
// Pictures go to _shots/uikit/B2b/<mode>/<WxH>.png (gitignored), numbers to stdout and report.json. One browser at a time; everything started is stopped.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5437'));
const OUT = resolve(opt('out') || resolve(ROOT, '_shots', 'uikit', 'B2b'));
const wantSizes = opt('sizes').split(',').filter(Boolean);
const MODES = opt('modes', 'normal,calm').split(',').filter(Boolean);
const SIZES = KIT_SIZES.filter((s) => !wantSizes.length || wantSizes.includes(`${s.w}x${s.h}`));
const CTX = { normal: { reducedMotion: 'no-preference' }, calm: { reducedMotion: 'reduce' }, contrast: { contrast: 'more' }, forced: { forcedColors: 'active' } };
const query = `?dev=1${args.includes('--chips') ? '&titlechips=1' : ''}`;
const INTRO_AT = (args.find((a) => a.startsWith('--intro=')) ?? '').split('=')[1]?.split(',').map(Number).filter(Number.isFinite) ?? [];

/** In the page: the rectangles of the title's parts and how much of the squishy's disc each one covers (a 5 px grid over the disc). */
function measure() {
  const wh = window.__WH__;
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const q = (s) => document.querySelector(s);
  const parts = { mark: q('.title-mark'), plate: q('.title-promise'), cta: q('.cta'), chips: q('.title-chips') };
  const body = wh?.bodyScreen?.();
  const out = { iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, layout: q('.title')?.dataset.layout, body: body ? { x: Math.round(body.x * innerWidth), y: Math.round(body.y * innerHeight), r: Math.round(body.rPx) } : null, rects: {}, cover: {}, svgCap: null, chipsHit: [] };
  for (const [k, el] of Object.entries(parts)) out.rects[k] = rect(el);
  const svg = q('.title-mark .jl-svg');
  if (svg) out.svgCap = Math.round(svg.getBoundingClientRect().height / 1.36);
  out.markLines = new Set([...document.querySelectorAll('.title-mark .jl-svg')].map((s) => Math.round(s.getBoundingClientRect().top / 4))).size;
  if (out.body) {
    const { x, y, r } = out.body;
    for (const [k, el] of Object.entries(parts)) {
      if (!el) continue;
      // chips and the lockup are many small boxes: test the real boxes of the children, not their union
      const boxes = k === 'chips' ? [...el.children].map((c) => c.getBoundingClientRect()) : k === 'mark' ? [...el.querySelectorAll('.jl-svg')].map((c) => c.getBoundingClientRect()) : [el.getBoundingClientRect()];
      let n = 0, hit = 0;
      for (let dy = -r; dy <= r; dy += 5) for (let dx = -r; dx <= r; dx += 5) {
        if (dx * dx + dy * dy > r * r) continue;
        n++;
        const px = x + dx, py = y + dy;
        if (boxes.some((b) => px >= b.left && px <= b.right && py >= b.top && py <= b.bottom)) hit++;
      }
      out.cover[k] = n ? +(hit / n).toFixed(3) : 0;
    }
  }
  for (const c of document.querySelectorAll('.title-chip, .cta')) { const r = c.getBoundingClientRect(); out.chipsHit.push({ n: (c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }); }
  return out;
}

const vite = await startVite(PORT);
let browser;
const report = { runs: [], failures: [] };
const fail = (m) => { report.failures.push(m); console.log('FAIL ' + m); };
try {
  browser = await launch();
  for (const mode of MODES) {
    const ctx = await browser.newContext({ ...CTX[mode], deviceScaleFactor: 1 });
    for (const size of SIZES) {
      const tag = `${mode} ${size.w}x${size.h}`;
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      if (INTRO_AT.length) await page.addInitScript(() => {
        window.__holdIntro = true;
        const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => (window.__holdIntro && ms === 1350 ? 0 : st(fn, ms, ...a));
        new MutationObserver((ms, mo) => { if (!document.querySelector('.title')) return; mo.disconnect(); requestAnimationFrame(() => { window.__introAnims = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.title')); window.__introAnims.forEach((a) => a.pause()); window.__introReady = true; }); }).observe(document, { childList: true, subtree: true });
      });
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(`${vite.url}${query}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      mkdirSync(resolve(OUT, mode), { recursive: true });
      if (INTRO_AT.length) {
        await page.waitForFunction(() => window.__introReady === true, null, { timeout: 60000 });
        await page.evaluate(() => window.__WH__.pause());
        for (const t of INTRO_AT) {
          await page.evaluate((ms) => window.__introAnims.forEach((a) => { a.currentTime = ms; }), t);
          await page.waitForTimeout(80);
          await page.screenshot({ path: resolve(OUT, mode, `${size.w}x${size.h}_intro${t}.png`), timeout: 120000, caret: 'hide' });
        }
        await page.evaluate(() => { window.__holdIntro = false; window.__introAnims.forEach((a) => a.play()); window.__WH__.resume(); });
        await page.evaluate(() => document.querySelector('.title')?.dispatchEvent(new Event('x')));
        await page.keyboard.press('Shift');   // any key ends the held intro
      }
      await page.waitForFunction(() => document.querySelector('.title')?.dataset.intro === 'done', null, { timeout: 20000 });
      await page.waitForTimeout(600);
      await page.evaluate(() => { window.__WH__.pause(); window.__WH__.step(1 / 60, 30); });
      await page.waitForTimeout(150);
      const m = await page.evaluate(measure);
      await page.screenshot({ path: resolve(OUT, mode, `${size.w}x${size.h}.png`), timeout: 120000, caret: 'hide' });
      await page.evaluate(() => window.__WH__.resume());
      if (errs.length) fail(`${tag}: ${errs.slice(0, 2).join(' | ')}`);
      if (m.sw > m.iw) fail(`${tag}: horizontal scroll ${m.sw} > ${m.iw}`);
      if (m.layout !== size.layout) fail(`${tag}: card layout ${m.layout}, expected ${size.layout}`);
      report.runs.push({ tag, ...m });
      const c = m.cover;
      console.log(`${tag}: ${m.layout} | cap ${m.svgCap} lines ${m.markLines} | mark ${JSON.stringify(m.rects.mark)} plate ${m.rects.plate ? m.rects.plate.y + '..' + m.rects.plate.b : '-'} cta ${m.rects.cta ? m.rects.cta.y + '..' + m.rects.cta.b : '-'} | squishy ${JSON.stringify(m.body)} cover mark ${c.mark} plate ${c.plate} cta ${c.cta} chips ${c.chips}`);
      await page.close();
    }
    await ctx.close();
  }
} catch (e) {
  fail('harness crashed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
} finally {
  if (browser) await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.runs.length} page(s), ${report.failures.length} failure(s). Report: ${resolve(OUT, 'report.json')}`);
process.exit(report.failures.length ? 1 : 0);
