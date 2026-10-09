// B5 pictures: shoots the Hoard-family sections of the UI kit page (pages/b5.ts) at the kit sizes, one PNG per scene (just the viewport-sized scene, the page's own
// heading cropped away) or per parts section, with every scroll box back at the top. Faster than shoot.mjs (no hit-box sweep), and it can run a probe in each page.
//   node _harness/uikit/hoard_shots.mjs [--sizes=1280x800,390x844] [--sections=hoard-shelf,merge-pad] [--modes=normal,calm,contrast,forced] [--port=5436]
//        [--out=<dir>] [--eval="<js run in the page; its JSON result is printed>"] [--no-shots]
// Pictures: _shots/uikit/B5s/<mode>/<WxH>__<section>.png. Port 5435-5439 are the Hoard lane's. Everything started is stopped.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (name, dflt = '') => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : dflt; };
const PORT = Number(opt('port', '5436'));
const SECTIONS = opt('sections', 'hoard-shelf,hoard-filters,hoard-grid,hoard-card,hoard-card-new,hoard-gift,hoard-today,merge-pad,merge-hold,merge-pick,merge-last,tidy-plan,plate-new,plate-up,plate-spare').split(',').filter(Boolean);
const MODES = opt('modes', 'normal').split(',').filter(Boolean);
const wantSizes = opt('sizes').split(',').filter(Boolean);
const SIZES = KIT_SIZES.filter((s) => !wantSizes.length || wantSizes.includes(`${s.w}x${s.h}`));
const EVAL = opt('eval');
const OUT = resolve(opt('out') || resolve(ROOT, '_shots', 'uikit', 'B5s'));
const MODE_CTX = { normal: { reducedMotion: 'no-preference' }, calm: { reducedMotion: 'reduce' }, contrast: { contrast: 'more' }, forced: { forcedColors: 'active' } };

const vite = await startVite(PORT);
let browser = null;
let bad = 0;
try {
  browser = await launch({});
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark', ...(MODE_CTX[mode] ?? {}) });
    for (const size of SIZES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(`${vite.url}_harness/uikit/index.html?batch=B5&only=${SECTIONS.join(',')}${mode === 'calm' ? '&calm=1' : ''}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));   // panels slide in (220 ms): measure the settled boxes
      const kitErrors = await page.evaluate(() => window.__kitErrors ?? []);
      if (errors.length || kitErrors.length) { bad++; console.log(`FAIL ${mode} ${size.w}x${size.h}: ${[...errors, ...kitErrors].slice(0, 3).join(' | ')}`); }
      const dir = resolve(OUT, mode);
      mkdirSync(dir, { recursive: true });
      for (const id of SECTIONS) {
        const has = await page.evaluate((sid) => !!document.getElementById(`sec-${sid}`), id);
        if (!has) continue;
        await page.evaluate((sid) => {
          const sec = document.getElementById(`sec-${sid}`);
          for (const e of sec.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0;
          sec.scrollIntoView({ block: 'start' });
        }, id);
        if (EVAL) console.log(`${mode} ${size.w}x${size.h} ${id}:`, JSON.stringify(await page.evaluate(`(${EVAL})(${JSON.stringify(id)})`)));
        if (args.includes('--no-shots')) continue;
        const scene = page.locator(`#sec-${id} .kp-scene`);
        const target = (await scene.count()) ? scene.first() : page.locator(`#sec-${id}`);
        await target.screenshot({ path: resolve(dir, `${size.w}x${size.h}__${id}.png`) });
      }
      await page.close();
    }
    await ctx.close();
  }
} catch (e) {
  bad++;
  console.log('harness crashed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
} finally {
  if (browser) await browser.close().catch(() => {});
  vite.stop();
}
console.log(`done, ${bad} failure(s). Pictures: ${OUT}`);
process.exit(bad ? 1 : 0);
