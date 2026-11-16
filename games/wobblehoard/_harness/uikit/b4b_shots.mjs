// Shoots the REAL game's secondary screens (UI v3 B4b: Settings, How to play, Credits, the Photo card, and the title with its two new chips) at the kit sizes of UI.md 4.1, so a
// picture shows what the game shows (the kit page B4b has the same screens on mock data: shoot.mjs --batch B4b).
//   node _harness/uikit/b4b_shots.mjs [--sizes=1280x800,390x844] [--screens=settings,howto,credits,photo,title] [--modes=normal,calm,contrast,forced] [--port=5446] [--out=<dir>]
// Pictures go to _shots/uikit/B4b/<mode>/<WxH>__<screen>.png (gitignored), the numbers to stdout. Ports 5440-5449 only. One browser at a time; everything started is stopped.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5446'));
const OUT = resolve(opt('out') || resolve(ROOT, '_shots', 'uikit', 'B4b'));
const wantSizes = opt('sizes').split(',').filter(Boolean);
const SCREENS = opt('screens', 'settings,howto,credits,photo,title').split(',').filter(Boolean);
const MODES = opt('modes', 'normal').split(',').filter(Boolean);
const SIZES = KIT_SIZES.filter((s) => !wantSizes.length || wantSizes.includes(`${s.w}x${s.h}`));
const CTX = { normal: { reducedMotion: 'no-preference' }, calm: { reducedMotion: 'reduce' }, contrast: { contrast: 'more' }, forced: { forcedColors: 'active' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL ' + m); };

const vite = await startVite(PORT);
let browser;
try {
  browser = await launch();
  for (const mode of MODES) {
    mkdirSync(resolve(OUT, mode), { recursive: true });
    for (const sz of SIZES) {
      const context = await browser.newContext({ viewport: { width: sz.w, height: sz.h }, deviceScaleFactor: 1, ...CTX[mode] });
      const page = await context.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      // (a picture waits for every finite animation to finish: on a busy machine the entrance can start late, and a picture must show the screen, not its first frame)
      const shot = async (name) => {
        await sleep(300);
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))).catch(() => {});
        await sleep(200);
        await page.screenshot({ path: resolve(OUT, mode, `${sz.w}x${sz.h}__${name}.png`) });
      };
      await page.goto(`${vite.url}?dev=1&rseed=7${mode === 'calm' ? '&calm=1' : ''}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
      await sleep(1500);   // the title's intro
      if (SCREENS.includes('title')) await shot('title');
      if (SCREENS.includes('title')) {
        // the title's two new chips open their screens above the title
        const chips = await page.evaluate(() => [...document.querySelectorAll('.title [data-chip]')].map((c) => c.dataset.chip));
        console.log(`${mode} ${sz.w}x${sz.h} title chips: ${chips.join(',')}`);
        if (chips.includes('howto')) {
          await page.click('.title [data-chip="howto"]');
          await page.waitForSelector('.scr-howto', { timeout: 8000 });
          await shot('title-howto');
          await page.keyboard.press('Escape');
          await sleep(400);
        }
      }
      await page.evaluate(() => document.querySelector('.cta')?.click());
      await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
      await sleep(900);
      const open = async (what) => {
        if (what === 'settings') await page.evaluate(() => window.__WH_UI__.openSettings());
        else if (what === 'photo') await page.evaluate(() => window.__WH_UI__.openPhoto());
        else await page.evaluate((id) => window.__WH_UI__.openDestination(id), what);
      };
      const sel = { settings: '.panel[data-open="true"]', howto: '.scr-howto', credits: '.scr-credits', photo: '.photo-card' };
      const closeKey = async () => { await page.keyboard.press('Escape'); await sleep(450); };
      for (const what of ['settings', 'howto', 'credits', 'photo']) {
        if (!SCREENS.includes(what)) continue;
        try {
          await open(what);
          await page.waitForSelector(sel[what], { state: 'visible', timeout: 8000 });
          await shot(what);
          const m = await page.evaluate((s) => {
            const el = document.querySelector(s); const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom), sw: document.documentElement.scrollWidth, iw: innerWidth, layout: document.body.dataset.layout };
          }, sel[what]);
          console.log(`${mode} ${sz.w}x${sz.h} ${what}: box ${m.x},${m.y} -> ${m.r},${m.b} (${m.layout}) scrollWidth ${m.sw}/${m.iw}`);
          if (m.sw > m.iw) fail(`${what} ${sz.w}x${sz.h}: horizontal scroll ${m.sw} > ${m.iw}`);
          if (what === 'settings') { await page.evaluate(() => window.__WH_UI__.closeSettings()); await sleep(450); } else await closeKey();
        } catch (e) { fail(`${what} ${sz.w}x${sz.h} ${mode}: ${String(e.message).split('\n')[0]}`); await page.keyboard.press('Escape').catch(() => {}); }
      }
      if (errs.length) fail(`${sz.w}x${sz.h} ${mode} page errors: ${errs.slice(0, 3).join(' | ')}`);
      await context.close();
    }
  }
} finally {
  await browser?.close().catch(() => {});
  await vite.stop();
}
console.log(bad ? `\n${bad} failures` : '\nno failures');
process.exit(bad ? 1 : 0);
