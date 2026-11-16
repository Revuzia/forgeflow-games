// Shoots the UI kit page (_harness/uikit/index.html) at the 8 kit sizes of UI.md 4.1 in 4 modes and measures what a sheet can prove.
//   node _harness/uikit/shoot.mjs --batch B0 [--sizes=1280x800,320x568] [--modes=normal,calm,contrast,forced] [--sections=buttons,controls]
//                                 [--tile=1100] [--port=5430] [--no-shots] [--out=<dir>] [--only=<section ids>: build only those sections (fast; the
//                                 "idle hook is dead" check needs the B0 busy dots and is skipped)]
// Modes: normal | calm (OS reduced-motion + body[data-calm=true]) | contrast (prefers-contrast: more) | forced (forced-colors: active).
// Forced pseudo-states (data-force="hover focus-visible active") are painted through the DevTools protocol, so the sheet shows every state
// without kit.css carrying test-only selectors. Pictures go to _shots/uikit/<batch>/<mode>/<WxH>__<section>[_n].png (gitignored), the numbers
// to _shots/uikit/<batch>/report.json and to stdout. Ports 5430-5434 are this lane's. One browser at a time; everything started is stopped.
// Exit code 1 on: a page error, horizontal scroll, a wrong layout class, a hit-box coverage below the floor, a mode leak (blur in a mode that bans it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';
import { KIT_SIZES } from '../../src/ui/layout.ts';

process.env.WH_FROZEN = '1'; // no HMR / file watching while this runs
// `--batch B3` (the documented exit command) and `--batch=B3` both work
const args = process.argv.slice(2).reduce((a, x, i, all) => { if (i > 0 && /^--[a-z]+$/.test(all[i - 1]) && !x.startsWith('--')) a[a.length - 1] += `=${x}`; else a.push(x); return a; }, []);
const opt = (name, dflt = '') => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
const BATCH = opt('batch', 'B0');
const PORT = Number(opt('port', '5430'));
const TILE = Number(opt('tile', '1100'));
const NO_SHOTS = args.includes('--no-shots');
const wantSizes = opt('sizes').split(',').filter(Boolean);
const wantModes = opt('modes', 'normal,calm,contrast,forced').split(',').filter(Boolean);
const wantSections = opt('sections').split(',').filter(Boolean);
const ONLY = opt('only');
const OUT = resolve(opt('out') || resolve(ROOT, '_shots', 'uikit', BATCH));
const SIZES = KIT_SIZES.filter((s) => !wantSizes.length || wantSizes.includes(`${s.w}x${s.h}`));
const HIT_FLOOR = 0.6; // below this a control has no real 44 px hit box; 0.85 is the target (rounded corners cost a 44 px button about 11 %)
const HIT_TARGET = 0.85;

const MODES = {
  normal: { ctx: { reducedMotion: 'no-preference' }, query: '' },
  calm: { ctx: { reducedMotion: 'reduce' }, query: '&calm=1' },
  contrast: { ctx: { contrast: 'more' }, query: '' },
  forced: { ctx: { forcedColors: 'active' }, query: '' },
};

/** Runs in the page: how much of a 44 x 44 box around each focusable's centre hits the control itself (K02 preview). */
function pageHitReport() {
  const sel = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const rows = [];
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // an inert control (the HUD behind an open Menu) and the content of a closed disclosure (the error card's Details) cannot take focus: they are not focusables (B4a)
    if (el.closest('[inert]')) continue;
    const closedDetails = el.closest('details:not([open])');
    if (closedDetails && !(el.tagName === 'SUMMARY' && el.parentElement === closedDetails)) continue;
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let hit = 0, n = 0;
    for (let dy = -20; dy <= 20; dy += 4) for (let dx = -20; dx <= 20; dx += 4) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      n++;
      const top = document.elementFromPoint(x, y);
      if (top && (top === el || el.contains(top) || (top.closest && top.closest('label') && top.closest('label').contains(el)))) hit++;
    }
    const name = (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    rows.push({ name: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${name}"`, w: Math.round(r.width), h: Math.round(r.height), cov: n ? hit / n : 1 });
  }
  scrollTo(0, 0);
  // (B6b) a screen that scrolls INSIDE itself (the Trophies pane) was scrolled by scrollIntoView above: the picture must show it at the top, as a player first sees it
  for (const s of document.querySelectorAll('*')) if (s.scrollTop > 0) s.scrollTop = 0;
  return rows;
}

/** Runs in the page: facts that prove a mode took effect (K08 preview) and the Calm rule (no running transform animation after settle). */
function pageModeFacts() {
  const glass = document.querySelector('.k-glass');
  const gs = glass ? getComputedStyle(glass) : null;
  const gel = document.querySelector('.k-gel:not([aria-disabled])');
  const sw = document.querySelector('.k-switch-input:checked ~ .k-switch-ui');
  const swOff = document.querySelector('.k-switch-input:not(:checked) ~ .k-switch-ui');
  const run = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getKeyframes().some((k) => 'transform' in k));
  return {
    body: { layout: document.body.dataset.layout, density: document.body.dataset.density ?? null, tall: document.body.dataset.tall, calm: document.body.dataset.calm },
    media: { forced: matchMedia('(forced-colors: active)').matches, more: matchMedia('(prefers-contrast: more)').matches, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, hover: matchMedia('(hover: hover)').matches },
    backdrop: gs ? (gs.backdropFilter || gs.getPropertyValue('-webkit-backdrop-filter') || 'n/a') : 'no .k-glass',
    glassBg: gs ? gs.backgroundColor : null,
    gelImage: gel ? getComputedStyle(gel).backgroundImage.slice(0, 40) : null,
    gelBorder: gel ? getComputedStyle(gel).borderTopWidth : null,
    swOnBg: sw ? getComputedStyle(sw).backgroundColor : null,
    swOffBg: swOff ? getComputedStyle(swOff).backgroundColor : null,
    runningTransformAnimations: run.length,
    hscroll: document.documentElement.scrollWidth - innerWidth,
    font: getComputedStyle(document.body).fontFamily.split(',')[0],
    kitErrors: window.__kitErrors ?? [],
  };
}

async function forceStates(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-force]' });
  let n = 0;
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
    const i = attributes.indexOf('data-force');
    if (i < 0) continue;
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: attributes[i + 1].split(' ').filter(Boolean) });
    n++;
  }
  return { cdp, n };
}

const report = { batch: BATCH, when: new Date().toISOString(), runs: [], failures: [] };
const fail = (msg) => { report.failures.push(msg); console.log('FAIL ' + msg); };

const vite = await startVite(PORT);
let browser = null;
try {
  browser = await launch({});
  for (const mode of wantModes) {
    const def = MODES[mode];
    if (!def) { fail(`unknown mode ${mode}`); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark', ...def.ctx });
    for (const size of SIZES) {
      const tag = `${mode} ${size.w}x${size.h}`;
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`); });
      page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.goto(`${vite.url}_harness/uikit/index.html?batch=${BATCH}${def.query}${ONLY ? '&only=' + ONLY : ''}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      const { cdp, n: forced } = await forceStates(page);
      await page.waitForTimeout(300);
      const facts = await page.evaluate(pageModeFacts);
      const hits = await page.evaluate(pageHitReport);
      const low = hits.filter((r) => r.cov < HIT_TARGET).sort((a, b) => a.cov - b.cov);
      const run = { mode, size: `${size.w}x${size.h}`, forcedNodes: forced, controls: hits.length, hitBelowTarget: low.length, hitBelowFloor: low.filter((r) => r.cov < HIT_FLOOR).length, worstHits: low.slice(0, 6), facts, consoleErrors, shots: [] };

      // ---- hard checks ----
      if (consoleErrors.length || facts.kitErrors.length) fail(`${tag}: page errors: ${[...consoleErrors, ...facts.kitErrors].slice(0, 3).join(' | ')}`);
      if (facts.hscroll > 0) fail(`${tag}: horizontal scroll ${facts.hscroll}px (K03)`);
      if (facts.body.layout !== size.layout) fail(`${tag}: body[data-layout]=${facts.body.layout}, expected ${size.layout}`);
      if (run.hitBelowFloor) fail(`${tag}: ${run.hitBelowFloor} control(s) have no 44 px hit box: ${low.filter((r) => r.cov < HIT_FLOOR).slice(0, 3).map((r) => `${r.name} ${r.w}x${r.h} cov ${r.cov.toFixed(2)}`).join('; ')}`);
      if ((mode === 'contrast' || mode === 'forced') && facts.backdrop !== 'none' && facts.backdrop !== 'no .k-glass') fail(`${tag}: backdrop-filter is "${facts.backdrop}" (must be none in ${mode})`);
      if (mode === 'forced' && !facts.media.forced) fail(`${tag}: forced-colors emulation did not take`);
      if (mode === 'contrast' && !facts.media.more) fail(`${tag}: prefers-contrast emulation did not take`);
      if (mode === 'calm' && facts.runningTransformAnimations > 0) fail(`${tag}: ${facts.runningTransformAnimations} transform animation(s) still running under Calm (K08)`);
      if (mode === 'normal' && !ONLY && facts.runningTransformAnimations === 0) fail(`${tag}: normal mode shows no busy-dot animation (the idle hook is dead)`);
      if (mode === 'forced' && facts.swOnBg && facts.swOffBg && facts.swOnBg === facts.swOffBg) fail(`${tag}: switch on and off have the same background in forced-colors (${facts.swOnBg})`);

      // ---- pictures ----
      if (!NO_SHOTS) {
        const dir = resolve(OUT, mode);
        mkdirSync(dir, { recursive: true });
        const ids = await page.evaluate(() => [...document.querySelectorAll('section[id^="sec-"]')].map((s) => s.id.slice(4)));
        for (const id of ids.filter((s) => !wantSections.length || wantSections.includes(s))) {
          const box = await page.evaluate((sid) => { const r = document.getElementById(`sec-${sid}`).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; }, id);
          const tiles = Math.max(1, Math.ceil(box.h / TILE));
          for (let t = 0; t < tiles; t++) {
            const y = box.y + t * TILE, h = Math.min(TILE, box.h - t * TILE);
            const file = resolve(dir, `${size.w}x${size.h}__${id}${tiles > 1 ? '_' + (t + 1) : ''}.png`);
            await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: Math.min(size.w, Math.ceil(box.x + box.w)), height: Math.max(1, Math.ceil(h)) } });
            run.shots.push(file.replace(ROOT, '.').replaceAll('\\', '/'));
          }
        }
      }
      await cdp.detach().catch(() => {});
      await page.close();
      report.runs.push(run);
      console.log(`${tag}: layout ${facts.body.layout}${facts.body.density ? '/' + facts.body.density : ''}${facts.body.tall === 'true' ? '/tall' : ''} | forced ${forced} | controls ${hits.length}, hit<${HIT_TARGET} ${low.length} (worst ${low[0] ? low[0].cov.toFixed(2) : '-'}) | hscroll ${facts.hscroll} | anim ${facts.runningTransformAnimations} | backdrop ${facts.backdrop} | shots ${run.shots.length}`);
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
console.log(`\n${report.runs.length} page(s) measured, ${report.failures.length} failure(s). Report: ${resolve(OUT, 'report.json')}`);
process.exit(report.failures.length ? 1 : 0);
