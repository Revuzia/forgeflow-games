// owner_sheets.mjs: every screen of the REAL game (dev server, seeded Hoard) at the owner's sizes, plus the contact sheets (B7), plus the CSS "ever matched" coverage.
//   node _harness/uikit/owner_sheets.mjs [--sizes=1280x800,390x844,358x201] [--scenes=title,menu,...] [--raw=<dir>] [--out=<dir>] [--no-sheets] [--coverage=<file.json>]
//                                        [--set=main|empty] [--seed=none] [--port=5441] [--mode=normal|calm|contrast|forced] [--stress=1] [--all-sizes] [--sounds]
// Raw pictures (one per scene and size) go to --raw (default: the scratch folder of the run, NOT the repo); the contact sheets (<= 14 files in all) go to --out
// (default _handoff/reports/ui_screens). --stress=1 runs every scene with the worst text the UI must hold (a 50-character nickname is a dev hook-free proxy: a long
// species name via the save, dir=rtl on <html>, Arial-only font stack) and records horizontal overflow per scene.
// --coverage writes, for every style rule of every sheet the page loaded, whether ANY selector of it matched an element at the end of ANY scene (dynamic pseudo-classes
// and pseudo-elements are stripped before matching; media conditions are ignored): the rules that never matched are the deletion candidates (prove each one by hand).
// Ports 5440-5449 only. One browser; everything started is stopped.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, launch, startVite } from '../pw.mjs';

process.env.WH_FROZEN = '1';
const args = process.argv.slice(2);
const opt = (name, dflt = '') => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
const PORT = Number(opt('port', '5441'));
const SIZES = opt('sizes', '1280x800,390x844,358x201').split(',').filter(Boolean).map((s) => ({ w: Number(s.split('x')[0]), h: Number(s.split('x')[1]) }));
const WANT = opt('scenes').split(',').filter(Boolean);
const RAW = resolve(opt('raw') || resolve(ROOT, '_shots', 'owner_sheets'));
const OUT = resolve(opt('out') || resolve(ROOT, '_handoff', 'reports', 'ui_screens'));
const MODE = opt('mode', 'normal');
const STRESS = opt('stress') === '1';
const COVERAGE = opt('coverage');
const NO_SHEETS = args.includes('--no-sheets');
const SET = opt('set', 'main');             // which contact sheets to build: main | empty (run with --seed=none: a player with nothing in the Hoard yet)
const NO_SEED = opt('seed') === 'none';
const SOUND = args.includes('--sounds');   // the sound wiring table of every interactive control seen (K09)
const soundMap = new Map();
const ALL = args.includes('--all-sizes');   // run every scene at every size (the coverage run); otherwise a scene runs at the sizes it names
mkdirSync(RAW, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const log = (...a) => console.log(...a);
const note = (ok, name, detail = '') => { if (!ok) fails++; log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  [' + detail + ']' : ''}`); };

/** a Hoard to look at: 24 species, spares, a hearted copy, a resting copy, a NEW one (the kit's mock data, written as the game's own save) */
const hoardMock = await import(pathToFileURL(resolve(ROOT, '_harness', 'uikit', 'hoardMock.ts')).href);
const SAVE = hoardMock.makeSave();
const LONG = 'Wibblewobble Sir Squishington the Third of Jellyhaven';   // 50+ characters, one word chain

const CTX = {
  normal: {}, calm: { reducedMotion: 'reduce' }, contrast: { contrast: 'more' }, forced: { forcedColors: 'active' },
}[MODE] ?? {};

const vite = await startVite(PORT);
const browser = await launch();
const matchedAll = new Map();   // owner||selector -> matched

const COLLECT = () => {
  const seen = (window.__cov = window.__cov || new Map());
  const stripSel = (s) => s.replace(/::?(?:before|after|first-line|first-letter|placeholder|marker|selection|backdrop|-webkit-[a-z-]+|-moz-[a-z-]+)/g, '')
    .replace(/:(?:hover|active|focus-visible|focus-within|focus|target|visited|link)\b/g, '');
  const splitTop = (s) => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const walk = (rules, owner) => {
    for (const r of rules) {
      if (r.selectorText !== undefined && r.style) {
        const key = `${owner}||${r.selectorText}`;
        if (seen.get(key) === true) continue;
        let hit = false;
        for (const part of splitTop(r.selectorText)) {
          const q = stripSel(part).trim();
          if (!q) { hit = true; break; }
          try { if (document.querySelector(q)) { hit = true; break; } } catch { hit = true; break; }
        }
        seen.set(key, hit);
      } else if (r.cssRules) walk(r.cssRules, owner);
    }
  };
  for (const sh of document.styleSheets) {
    const owner = (sh.ownerNode && sh.ownerNode.getAttribute && sh.ownerNode.getAttribute('data-vite-dev-id')) || sh.href || 'inline';
    try { walk(sh.cssRules, String(owner).replace(/\\/g, '/')); } catch { /* cross-origin */ }
  }
  return seen.size;
};

/** In the page, after a scene: every interactive element, the sound its press makes (uiSound.kindOfControl) and whether ANY path (click, change, input) reaches the delegated listener. */
const SOUNDS = async () => {
  const m = await import('/src/ui/uiSound.ts');
  const CONTROL = 'button, [role="button"], [role="tab"], [role="switch"], a[href], label.k-switch, label.k-seg-opt, label.seg-opt, label.row-switch, .k-card[data-selectable], summary';
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="radio"], [tabindex]:not([tabindex="-1"])';
  const rows = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el.closest('[inert], [hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' && !(el instanceof HTMLInputElement)) continue;
    const tag = el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? el.type : '';
    const sig = `${tag}${type ? '[' + type + ']' : ''}${el.getAttribute('role') ? '@' + el.getAttribute('role') : ''}.${[...el.classList].filter((c) => /^(k-|cta|dock|hoard|plinth|tro|menu|opts|seg|fchip|tool|act|hcard|copy|gift|task)/.test(c)).slice(0, 3).join('.')}`;
    let kind, how;
    if (tag === 'input' && type === 'range') { kind = el.closest('[data-sound="none"]') ? null : 'tick'; how = 'input'; }
    else if (tag === 'input' && (type === 'checkbox' || type === 'radio')) { kind = el.closest('[data-sound="none"]') ? null : (type === 'radio' ? 'select' : 'on/off'); how = 'change'; }
    else if (tag === 'select') { kind = el.closest('[data-sound="none"]') ? null : 'select'; how = 'change'; }
    else if (el.closest(CONTROL)) { kind = m.kindOfControl(el.closest(CONTROL)); how = 'click'; }
    else if (el.getAttribute('role') === 'application' || el.getAttribute('role') === 'region' || ['div', 'p', 'img', 'section', 'pre'].includes(tag)) { kind = 'n/a (focusable content: the stage, a scroller, a picture)'; how = ''; }
    else { kind = 'NONE-not-a-listed-control'; how = ''; }
    rows.push({ sig, kind: kind === null ? 'none(opted out)' : kind, how, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) });
  }
  return rows;
};

/** K08 in the real game, after a scene: contrast-more and forced-colors carry no backdrop blur; forced-colors shows the real text of every jelly heading (the drawing is gone); Calm has no running transform animation. */
const MODE_CHECK = () => {
  const mode = document.documentElement.dataset.mode || '';
  void mode;
  const out = { blur: 0, svgShown: 0, jellyNoText: 0, moving: [] };
  for (const e of document.querySelectorAll('*')) { const c = getComputedStyle(e); if ((c.backdropFilter && c.backdropFilter !== 'none') || (c.webkitBackdropFilter && c.webkitBackdropFilter !== 'none')) out.blur++; }
  for (const j of document.querySelectorAll('.jl')) {
    if (j.closest('[hidden], [inert]') || j.getClientRects().length === 0) continue;
    for (const v of j.querySelectorAll(':scope > svg')) if (getComputedStyle(v).display !== 'none') out.svgShown++;
    const t = j.querySelector('.jl-text');
    if (t) { const r = t.getBoundingClientRect(); if (r.width < 6 || r.height < 6) out.jellyNoText++; }
  }
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running') continue;
    const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
    if (kf.some((k) => k.transform !== undefined && k.transform !== 'none') && Number.isFinite(a.effect.getComputedTiming().iterations) === false) out.moving.push(a.animationName || '(waapi)');
  }
  return out;
};
const modeRows = [];

async function openGame(size) {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, hasTouch: size.w < 500 && size.h > size.w, ...CTX });
  await context.addInitScript(({ hoard, stress, long }) => {
    try { if (hoard) localStorage.setItem('wobblehoard:v2:hoard', hoard); } catch { /* none */ }
    addEventListener('securitypolicyviolation', (e) => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); });
    // the dev overlay (fps, draw calls) is not what a player sees
    document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.dev { display: none !important; }'; document.head.append(st); });
    if (stress) {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.setAttribute('dir', 'rtl');
        const st = document.createElement('style');   // (the page's own CSP forbids this in production; the dev server allows it. Arial-only text, as K03 asks)
        st.textContent = ':root, body, button, input, select { --wh-font: Arial, sans-serif !important; --wh-font-ui: Arial, sans-serif !important; font-family: Arial, sans-serif !important; }';
        document.head.append(st);
      });
      void long;
    }
  }, { hoard: NO_SEED ? '' : SAVE.json, stress: STRESS, long: LONG });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console ${m.text().slice(0, 200)}`); });
  await page.goto(`${vite.url}index.html?dev=1&rseed=7`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__WH__ && window.__WH__.state().phase === 'title', null, { timeout: 120000 });
  return { context, page, errs };
}

const settled = (page) => page.evaluate(async () => { for (let i = 0; i < 100; i++) { if (!document.getAnimations().some((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))) return true; await new Promise((r) => setTimeout(r, 50)); } return false; });

/** a real mouse press on an empty corner: the browser's focus-visible heuristic goes back to "pointer" (a keyboard press, like Escape, makes every later script focus show a ring) */
const pointerMode = async (page) => { await page.mouse.move(3, 3); await page.mouse.down(); await page.mouse.up(); };

async function closeAll(page) {
  for (let i = 0; i < 8; i++) {
    const s = await page.evaluate(() => ({
      hoard: document.body.dataset.hoard || '', layers: window.__WH_UI__ ? window.__WH_UI__.layers() : 0, settings: window.__WH_UI__ ? window.__WH_UI__.settingsOpen() : false,
      menu: window.__WH_UI__ ? window.__WH_UI__.menuOpen() : false, tool: window.__WH__.shell.tools().tool, err: !!document.querySelector('.errorcard'),
    }));
    if (s.err) { await page.evaluate(() => document.querySelector('.errorcard')?.remove()); continue; }
    if (s.hoard === 'open' || s.hoard === 'card' || s.hoard === 'merge') { await page.evaluate(() => (document.querySelector('.hoard [data-key="x"]') || document.querySelector('.hoard [aria-label="Close the Hoard"]'))?.click()); await sleep(300); continue; }
    if (s.settings) { await page.evaluate(() => window.__WH_UI__.closeSettings()); await sleep(250); continue; }
    if (s.menu) { await page.evaluate(() => window.__WH_UI__.closeMenu('button')); await sleep(250); continue; }
    if (s.layers > 0) {
      // a layer (How to play, Credits, Trophies, the Photo card, a modal): its own close / done button, as a finger would; Escape only when it has none
      const hit = await page.evaluate(() => {
        // the topmost layer's own close / done button: the LAST visible match in the document (layers are appended in the order they open; the Hoard's hidden panel is earlier in the page)
        const all = [...document.querySelectorAll('.tro [aria-label^="Close"], .scr [aria-label^="Close"], .photo [data-key="done"], .photo [aria-label^="Close"], [role="dialog"] [data-key="done"], [role="dialog"] [aria-label^="Close"]')]
          .filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert]'));
        const b = all[all.length - 1];
        if (b) b.click();
        return !!b;
      });
      if (!hit) { await page.keyboard.press('Escape'); await sleep(300); await pointerMode(page); } else await sleep(350);
      continue;
    }
    if (s.tool !== 'hand') { await page.evaluate(() => document.querySelector('.dock-tool[data-tool="hand"]')?.click()); await sleep(250); continue; }
    break;
  }
}

/** every scene: id, which sizes it runs at (null = all), the setup (the picture is taken after it) */
const SCENES = [
  { id: 'title', phase: 'title', run: async (page) => { await sleep(1900); } },
  { id: 'play-hand', run: async (page) => {
    // stress: the name plate holds a 50-character nickname and a long species name (the DOM the HUD builds, filled with the worst text; the real nickname comes from a stored name)
    if (STRESS) await page.evaluate((long) => {
      const nick = document.querySelector('.nametag-nick'), name = document.querySelector('.nametag-name');
      if (name) name.textContent = 'Wibblewobble Sir Squishington';
      if (nick) { nick.textContent = '“' + long + '”'; nick.hidden = false; }
    }, LONG);
    await sleep(700);
  } },
  { id: 'play-capsule', run: async (page) => { await page.evaluate(() => window.__WH__.shell.grant(1)); await sleep(1400); } },
  { id: 'toast', run: async (page) => { await page.evaluate(() => { const u = window.__WH_UI__; u.toast('success', 'Photo saved.'); u.toast('info', 'Your Hoard is getting full. Tidy up to make room.'); }); await sleep(500); } },
  { id: 'offline', run: async (page) => { await page.evaluate(() => { window.__WH__.shell.forceOffline(true); window.__WH_UI__.toast('error', 'Could not save your photo. Try again.'); }); await sleep(3500); }, after: async (page) => { await page.evaluate(() => window.__WH__.shell.forceOffline(false)); await sleep(300); } },
  { id: 'play-cut', run: async (page) => { await page.evaluate(() => document.querySelector('.dock-tool[data-tool="cut"]')?.click()); await sleep(700); }, after: async (page) => { await page.evaluate(() => document.querySelector('.dock-tool[data-tool="hand"]')?.click()); await sleep(250); } },
  { id: 'play-snap', run: async (page) => { await page.evaluate(() => document.querySelector('.dock-tool[data-tool="snap"]')?.click()); await sleep(700); }, after: async (page) => { await page.evaluate(() => document.querySelector('.dock-tool[data-tool="hand"]')?.click()); await sleep(250); } },
  { id: 'menu', run: async (page) => { await page.evaluate(() => window.__WH_UI__.openMenu()); await sleep(600); } },
  { id: 'settings', run: async (page) => { await page.evaluate(() => window.__WH_UI__.openDestination('settings')); await page.waitForSelector('.k-panel, .panel[data-open]', { timeout: 15000 }); await sleep(700); } },
  { id: 'howto', sizes: ['1280x800', '390x844'], run: async (page) => { await page.evaluate(() => window.__WH_UI__.openDestination('howto')); await sleep(900); } },
  { id: 'credits', sizes: ['1280x800', '390x844'], run: async (page) => { await page.evaluate(() => window.__WH_UI__.openDestination('credits')); await sleep(900); } },
  { id: 'trophies', run: async (page) => { await page.evaluate(() => window.__WH_UI__.openDestination('trophies')); await page.waitForSelector('.tro', { timeout: 15000 }); await sleep(900); } },
  { id: 'records', sizes: ['1280x800', '390x844'], run: async (page) => { await page.evaluate(() => window.__WH_UI__.openDestination('trophies')); await page.waitForSelector('.tro', { timeout: 15000 }); await sleep(500); await page.evaluate(() => document.querySelector('.tro-seg input[value="records"]')?.click()); await sleep(600); } },
  { id: 'hoard-shelf', sizes: ['1280x800', '390x844'], keep: true, run: async (page) => { await page.evaluate(() => document.querySelector('.hoard-btn')?.click()); await page.waitForSelector('.hoard', { timeout: 15000 }); await sleep(900); } },
  { id: 'hoard-card', sizes: ['1280x800', '390x844'], keep: true, run: async (page) => { await page.evaluate(() => document.querySelector('.plinth[data-owned="true"][data-tier="uncommon"], .plinth[data-owned="true"]')?.click()); await sleep(800); } },
  { id: 'hoard-merge', sizes: ['1280x800', '390x844'], keep: true, run: async (page) => {
    await page.evaluate((sp) => { document.querySelector('.hcard-back')?.click(); }, SAVE.mergeSpecies); await sleep(400);
    await page.evaluate((sp) => document.querySelector(`.plinth[data-species="${sp}"]`)?.click(), SAVE.mergeSpecies); await sleep(600);
    await page.evaluate(() => document.querySelector('.hcard [data-key="merge"]')?.click()); await sleep(900);
  } },
  { id: 'hoard-gift', sizes: ['1280x800', '390x844'], keep: true, run: async (page) => {
    await page.evaluate(() => document.querySelector('.hmerge [aria-label="Close"]')?.click()); await sleep(500);
    await page.evaluate(() => document.querySelector('.hcard-back')?.click()); await sleep(500);
    await page.evaluate(() => document.querySelector('#wh-tab-gift')?.click()); await sleep(800);
  } },
  { id: 'hoard-today', sizes: ['1280x800', '390x844'], run: async (page) => { await page.evaluate(() => document.querySelector('#wh-tab-today')?.click()); await sleep(800); } },
  { id: 'reveal', sizes: ['1280x800', '390x844'], run: async (page) => {
    await closeAll(page);
    await page.evaluate(() => { window.__WH__.shell.grant(1); }); await sleep(600);
    await page.evaluate(() => window.__WH__.shell.openCapsule());
    // the ceremony ends in a plate: wait for it, then a beat for its entrance
    await page.waitForFunction(() => !!document.querySelector('.plate:not([hidden])'), null, { timeout: 40000 }).catch(() => {});
    await sleep(900);
  } },
  { id: 'photo', sizes: ['1280x800', '390x844'], run: async (page) => { await page.evaluate(() => window.__WH_UI__.openPhoto()); await sleep(900); } },
  { id: 'error', sizes: ['1280x800', '390x844'], run: async (page) => {
    await page.evaluate(async () => { const m = await import('/src/ui/errorCard.ts'); m.showErrorCard(document.getElementById('ui'), { title: 'The jelly got stuck', message: 'Something went wrong while waking the squishy. Reloading usually fixes it.', detail: 'Error: WebGL context lost (simulated for the picture)' }); });
    await sleep(900);
  } },
];

const shots = {};   // size -> scene -> path
const failuresByScene = [];
for (const size of SIZES) {
  const tag = `${size.w}x${size.h}`;
  log(`\n=== ${tag} (${MODE}${STRESS ? ', stress' : ''}) ===`);
  const { context, page, errs } = await openGame(size);
  shots[tag] = {};
  let woke = false;
  const wake = async () => {
    if (woke) return;
    await page.locator('.cta').click({ force: true });
    await page.waitForFunction(() => window.__WH__.state().phase === 'play', null, { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.title'), null, { timeout: 30000 });
    woke = true; await sleep(600);
  };
  for (const sc of SCENES) {
    if (WANT.length && !WANT.includes(sc.id)) continue;
    if (sc.sizes && !sc.sizes.includes(tag) && !ALL) continue;
    if (sc.id !== 'title') await wake();
    try {
      await sc.run(page);
      await settled(page);
      const file = resolve(RAW, `${sc.id}_${tag}${MODE === 'normal' ? '' : '_' + MODE}${STRESS ? '_stress' : ''}.png`);
      await page.screenshot({ path: file });
      shots[tag][sc.id] = file;
      const ov = await page.evaluate(() => ({ sx: document.documentElement.scrollWidth - innerWidth, bx: document.body.scrollWidth - innerWidth }));
      if (STRESS || ov.sx > 1 || ov.bx > 1) note(ov.sx <= 1 && ov.bx <= 1, `${tag} ${sc.id}: no horizontal overflow`, `${ov.sx} / ${ov.bx} px`);
      if (COVERAGE) await page.evaluate(COLLECT);
      if (MODE !== 'normal') modeRows.push({ tag, id: sc.id, ...(await page.evaluate(MODE_CHECK)) });
      if (SOUND) for (const r of await page.evaluate(SOUNDS)) { const k = `${r.sig} => ${r.kind} (${r.how})`; const e = soundMap.get(k) ?? { n: 0, ex: r.label, scenes: new Set() }; e.n++; e.scenes.add(`${sc.id}`); soundMap.set(k, e); }
      if (sc.after) await sc.after(page);
      if (!sc.keep) await closeAll(page);
    } catch (e) {
      note(false, `${tag} ${sc.id}: scene ran`, String(e.message).split('\n')[0].slice(0, 160));
      failuresByScene.push(`${tag} ${sc.id}`);
      try { await closeAll(page); } catch { /* next */ }
    }
  }
  await closeAll(page).catch(() => {});
  const csp = await page.evaluate(() => window.__csp || []);
  note(csp.length === 0, `${tag}: 0 CSP violations`, csp.slice(0, 2).join(' | '));
  note(errs.length === 0, `${tag}: no page or console error`, errs.slice(0, 2).join(' | '));
  if (COVERAGE) {
    const cov = await page.evaluate(() => [...(window.__cov || new Map()).entries()]);
    for (const [k, v] of cov) matchedAll.set(k, (matchedAll.get(k) || false) || v);
  }
  await context.close();
}

if (COVERAGE) {
  const unmatched = [...matchedAll.entries()].filter(([, v]) => !v).map(([k]) => k);
  const byFile = {};
  for (const k of unmatched) { const [f, sel] = k.split('||'); const short = f.replace(/^.*\/games\/wobblehoard\//, '').replace(/^\/@fs\//, ''); (byFile[short] ||= []).push(sel); }
  writeFileSync(resolve(COVERAGE), JSON.stringify({ rules: matchedAll.size, unmatched: unmatched.length, byFile }, null, 1));
  log(`\ncoverage: ${matchedAll.size} rules seen, ${unmatched.length} never matched an element -> ${COVERAGE}`);
}

if (MODE !== 'normal') {
  const bad = modeRows.filter((r) => (MODE !== 'calm' && r.blur > 0) || (MODE === 'forced' && (r.svgShown > 0 || r.jellyNoText > 0)) || (MODE === 'calm' && r.moving.length > 0));
  note(bad.length === 0, `K08 ${MODE}: ${modeRows.length} scenes: ${MODE === 'calm' ? 'no infinite transform animation running' : 'no backdrop blur'}${MODE === 'forced' ? ', every jelly heading shows its real text and no drawing' : ''}`, bad.slice(0, 6).map((r) => `${r.tag} ${r.id} blur ${r.blur} svg ${r.svgShown} notext ${r.jellyNoText} moving ${r.moving.join('+')}`).join(' | '));
}
if (SOUND) {
  log('\n--- interactive control kinds and the sound each one makes (K09) ---');
  const rows = [...soundMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, e] of rows) log(`  ${k.padEnd(78)} x${String(e.n).padStart(3)}  e.g. "${e.ex}"  [${[...e.scenes].slice(0, 4).join(',')}]`);
  const bad = rows.filter(([k]) => k.includes('NONE-'));
  note(bad.length === 0, 'every interactive control reaches the delegated sound listener (or says data-sound="none")', bad.map(([k]) => k.split(' =>')[0]).slice(0, 6).join(' | '));
}

/* ─────────────────────────────────────── contact sheets ─────────────────────────────────────── */
// the sheets: [file, size, scene ids, columns, scale]
const SHEETS_MAIN = [
  ['01_play_1280x800.png', '1280x800', ['title', 'play-hand', 'play-cut', 'play-snap'], 2, 0.75],
  ['02_menus_1280x800.png', '1280x800', ['menu', 'settings', 'howto', 'credits'], 2, 0.75],
  ['03_hoard_1280x800.png', '1280x800', ['hoard-shelf', 'hoard-card', 'hoard-merge', 'hoard-gift'], 2, 0.75],
  ['04_hoard2_1280x800.png', '1280x800', ['hoard-today', 'reveal', 'play-capsule', 'toast'], 2, 0.75],
  ['05_trophies_1280x800.png', '1280x800', ['trophies', 'records', 'photo', 'error'], 2, 0.75],
  ['11_play_390x844.png', '390x844', ['title', 'play-hand', 'play-capsule', 'play-cut', 'play-snap', 'toast'], 6, 0.8],
  ['12_menus_390x844.png', '390x844', ['menu', 'settings', 'howto', 'credits', 'trophies', 'records'], 6, 0.8],
  ['13_hoard_390x844.png', '390x844', ['hoard-shelf', 'hoard-card', 'hoard-merge', 'hoard-gift', 'hoard-today', 'reveal'], 6, 0.8],
  ['14_overlays_390x844.png', '390x844', ['photo', 'error'], 2, 0.9],
  ['21_portal_358x201.png', '358x201', ['title', 'play-hand', 'play-cut', 'menu', 'trophies', 'hoard-shelf'], 3, 1.25],
];
const SHEETS_EMPTY = [
  ['06_empty_offline_1280x800.png', '1280x800', ['hoard-shelf', 'hoard-gift', 'hoard-today', 'trophies', 'records', 'offline'], 3, 0.6],
  ['16_empty_offline_390x844.png', '390x844', ['hoard-shelf', 'hoard-gift', 'hoard-today', 'trophies', 'offline'], 5, 0.7],
];
const SHEETS = SET === 'empty' ? SHEETS_EMPTY : SHEETS_MAIN;
if (!NO_SHEETS && MODE === 'normal' && !STRESS && !COVERAGE) {
  mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 1200 }, deviceScaleFactor: 1 });
  const cp = await ctx.newPage();
  for (const [file, tag, ids, cols, scale] of SHEETS) {
    const have = ids.filter((id) => shots[tag]?.[id]);
    if (!have.length) continue;
    const [w, h] = tag.split('x').map(Number);
    const cw = Math.round(w * scale), ch = Math.round(h * scale), gap = 14, head = 26;
    const rows = Math.ceil(have.length / cols);
    const W = cols * cw + (cols + 1) * gap, H = rows * (ch + head) + (rows + 1) * gap;
    const cells = have.map((id) => `<figure><figcaption>${id} &nbsp; ${tag}</figcaption><img width="${cw}" height="${ch}" src="data:image/png;base64,${readFileSync(shots[tag][id]).toString('base64')}"></figure>`).join('');
    await cp.setViewportSize({ width: W, height: H });
    await cp.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0b0818;font:600 13px/26px system-ui,sans-serif;color:#c9bdcf;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:${gap}px;padding:${gap}px;align-content:start}figure{margin:0}figcaption{height:${head}px;letter-spacing:.06em;text-transform:uppercase}img{display:block;border-radius:6px;outline:1px solid #3b2a5f}</style>${cells}`);
    await sleep(150);
    await cp.screenshot({ path: resolve(OUT, file), clip: { x: 0, y: 0, width: W, height: H } });
    log(`sheet ${file}: ${have.length} scenes (${W}x${H})`);
  }
  await ctx.close();
}

await browser.close();
vite.stop();
log(fails ? `\n${fails} FAIL` : '\nall ok');
process.exit(fails ? 1 : 0);
