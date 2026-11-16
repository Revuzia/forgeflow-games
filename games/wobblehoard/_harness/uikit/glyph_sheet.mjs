// The jelly glyph sheet runner (UI.md 5, gate R08 / K14). Two jobs:
//   1. COUNTERS: rasterises the OUTLINE silhouette of every glyph with a closed counter (A B D O P Q R 4 6 8 9 0) at the real cap sizes, using the
//      stroke widths the page's CSS actually gives each optical size, finds each enclosed hole and measures its largest inscribed circle in px
//      (distance transform, 4x supersampled, DPR 1). Rule: >= 2 px at cap 24, >= 4 px at cap 36 (and every larger cap), and the hole must exist.
//   2. PICTURES: the sheet (B2 kit page) at 1280x800 and 390x844 in normal and Calm, full page, into --out (default _handoff/reports/ui_glyph_sheet).
//   node _harness/uikit/glyph_sheet.mjs [--counters] [--shots] [--out=<dir>] [--port=5431] [--css=<extra css, for experiments>] [--caps=24,36,56,64,120]
//   Default (no flag) = both. Exit 1 when a counter rule fails. Ports 5430-5439 are this lane's; everything started is stopped.
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launch, startVite } from '../pw.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt = '') => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=').slice(1).join('=');
const wantCounters = args.includes('--counters') || !args.includes('--shots');
const wantShots = args.includes('--shots') || !args.includes('--counters');
const PORT = Number(opt('port', '5431'));
const OUT = resolve(opt('out') || resolve(ROOT, '_handoff', 'reports', 'ui_glyph_sheet'));
const EXTRA_CSS = opt('css');
const TRY = opt('try'); // a JSON file { name: [w, path] } of candidate glyphs measured instead of the shipped set (design iteration)
const CAPS = opt('caps', '24,36,56,64,120').split(',').map(Number);
const RULE = (cap) => (cap <= 24 ? 2 : 4); // px of clear counter

/** Runs in the page. `chars` that must keep `holes` closed counters; returns per char, per cap: the diameters (px) of every hole. */
async function pageMeasure({ expect, caps, custom }) {
  const { GLYPHS } = await import('/src/ui/jelly/glyphs.ts');
  const { jelly } = await import('/src/ui/jelly/jelly.ts');
  const SS = 4; // supersampling
  const outlineWidth = (cap) => {
    const el = jelly('A', { size: cap <= 24 ? 'sm' : 'md' });
    el.style.setProperty('--jl-cap', `${cap}px`);
    document.body.append(el);
    const w = parseFloat(getComputedStyle(el.querySelector('.jl-ol')).strokeWidth);
    el.remove();
    return w;
  };
  // squared Euclidean distance transform (Felzenszwalb & Huttenlocher) of a 0/1 image: distance of every pixel to the nearest 1
  const edt = (bin, W, H) => {
    const INF = 1e20, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
    const g = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = bin[i] ? 0 : INF;
    const pass = (n, get, set) => {
      for (let i = 0; i < n; i++) f[i] = get(i);
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
      for (let i = 0; i < n; i++) set(i, d[i]);
    };
    for (let x = 0; x < W; x++) pass(H, (y) => g[y * W + x], (y, val) => { g[y * W + x] = val; });
    for (let y = 0; y < H; y++) pass(W, (x) => g[y * W + x], (x, val) => { g[y * W + x] = val; });
    return g;
  };
  const holesOf = (d, ow, cap) => {
    const s = (cap / 100) * SS, pad = 24;
    const [w, path] = custom?.[d] ?? GLYPHS[d];
    const W = Math.ceil((w + 2 * pad) * s), H = Math.ceil((100 + 2 * pad + 20) * s);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(s, 0, 0, s, pad * s, pad * s);
    ctx.lineWidth = ow; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000';
    ctx.stroke(new Path2D(path));
    const px = ctx.getImageData(0, 0, W, H).data;
    const fill = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) fill[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
    // exterior = empty pixels reachable from the border; everything else empty is a hole
    const lab = new Int32Array(W * H).fill(-1), stack = [];
    const push = (i) => { if (!fill[i] && lab[i] === -1) { lab[i] = 0; stack.push(i); } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
    }
    const dist = edt(fill, W, H);
    let next = 1; const comps = [];
    for (let i0 = 0; i0 < W * H; i0++) {
      if (fill[i0] || lab[i0] !== -1) continue;
      const id = next++; let max = 0, area = 0, sx = 0, sy = 0; const st = [i0]; lab[i0] = id;
      while (st.length) {
        const i = st.pop(), x = i % W, y = (i / W) | 0; area++; sx += x; sy += y;
        if (dist[i] > max) max = dist[i];
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !fill[j] && lab[j] === -1) { lab[j] = id; st.push(j); }
      }
      // distance is measured between pixel centres: the clear disc is the max distance minus half a pixel, doubled, back to px at this cap
      comps.push({ diameterPx: (2 * (Math.sqrt(max) - 0.5)) / SS, areaPx: area / (SS * SS), at: [Math.round(sx / area / s - pad), Math.round(sy / area / s - pad)] });
    }
    return comps.sort((a, b) => b.diameterPx - a.diameterPx);
  };
  const out = {};
  for (const cap of caps) {
    const ow = outlineWidth(cap);
    for (const ch of Object.keys(expect)) (out[ch] ??= {})[cap] = { outline: ow, holes: holesOf(ch, ow, cap).map((c) => +c.diameterPx.toFixed(2)), at: holesOf(ch, ow, cap).map((c) => c.at) };
  }
  return out;
}

const EXPECT = { A: 1, B: 2, D: 1, O: 1, P: 1, Q: 1, R: 1, 4: 1, 6: 1, 8: 2, 9: 1, 0: 1 };
const report = { when: new Date().toISOString(), counters: null, failures: [], shots: [] };
const fail = (m) => { report.failures.push(m); console.log('FAIL ' + m); };

const vite = await startVite(PORT);
let browser = null;
try {
  browser = await launch({});
  if (wantCounters) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${vite.url}_harness/uikit/index.html?batch=B2&only=jelly-spacing`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
    if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
    const custom = TRY ? JSON.parse(readFileSync(TRY, 'utf8')) : null;
    const expect = custom ? Object.fromEntries(Object.keys(custom).map((k) => [k, 1])) : EXPECT;
    const res = await page.evaluate(pageMeasure, { expect, caps: CAPS, custom });
    report.counters = res;
    const header = ['glyph', ...CAPS.map((c) => `cap ${c}`)];
    console.log(header.join('\t'));
    let worst = Infinity;
    for (const ch of Object.keys(expect)) {
      const cells = [];
      for (const cap of CAPS) {
        const hs = res[ch][cap].holes;
        cells.push(hs.length ? hs.map((v) => v.toFixed(1)).join('+') : 'NONE');
        if (hs.length < expect[ch]) fail(`${ch} at cap ${cap}: ${hs.length} closed counter(s), expected ${expect[ch]}`);
        const min = hs.length ? Math.min(...hs) : 0;
        if (hs.length >= expect[ch]) worst = Math.min(worst, min / RULE(cap));
        if (hs.length && min < RULE(cap)) fail(`${ch} at cap ${cap}: smallest counter ${min.toFixed(2)} px < ${RULE(cap)} px (outline ${res[ch][cap].outline})`);
      }
      console.log([ch, ...cells].join('\t'));
    }
    console.log(`counter rule: worst ratio to the limit ${worst.toFixed(2)} (>= 1 passes); outline widths per cap: ${CAPS.map((c) => `${c}:${res.A[c].outline}`).join(' ')}`);
    await ctx.close();
  }
  if (wantShots) {
    mkdirSync(OUT, { recursive: true });
    // The owner's set: words + alphabet at both sizes in both modes (4 files), plus two review sheets at desktop size (6 files in all).
    const SHEETS = [
      { name: 'glyph_sheet_1280x800_normal', w: 1280, h: 800, calm: false, only: 'jelly-words,jelly-alpha' },
      { name: 'glyph_sheet_1280x800_calm', w: 1280, h: 800, calm: true, only: 'jelly-words,jelly-alpha' },
      { name: 'glyph_sheet_390x844_normal', w: 390, h: 844, calm: false, only: 'jelly-words,jelly-alpha' },
      { name: 'glyph_sheet_390x844_calm', w: 390, h: 844, calm: true, only: 'jelly-words,jelly-alpha' },
      { name: 'glyph_large_and_anatomy_1280', w: 1280, h: 800, calm: false, only: 'jelly-big,jelly-anatomy' },
      { name: 'glyph_tones_and_spacing_1280', w: 1280, h: 800, calm: false, only: 'jelly-tones,jelly-spacing' },
    ];
    const bufs = {};
    for (const sh of SHEETS) {
      const ctx = await browser.newContext({ viewport: { width: sh.w, height: sh.h }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: sh.calm ? 'reduce' : 'no-preference' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      await page.goto(`${vite.url}_harness/uikit/index.html?batch=B2${sh.calm ? '&calm=1' : ''}&only=${sh.only}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__kitReady === true, null, { timeout: 30000 });
      if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS });
      await page.waitForTimeout(250);
      const hs = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (hs > 0) fail(`${sh.name}: horizontal scroll ${hs}px`);
      const file = resolve(OUT, `${sh.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      report.shots.push(file);
      // the picture below the header line (the header prints the mode), to compare normal and Calm byte for byte
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      bufs[sh.name] = await page.screenshot({ fullPage: true, clip: { x: 0, y: 70, width: sh.w, height: total - 70 } });
      console.log(`shot ${sh.name}.png${errs.length ? '  ERRORS ' + errs.slice(0, 3).join(' | ') : ''}`);
      if (errs.length) fail(`${sh.name}: page errors ${errs.slice(0, 2).join(' | ')}`);
      await ctx.close();
    }
    for (const size of ['1280x800', '390x844']) {
      const same = Buffer.compare(bufs[`glyph_sheet_${size}_normal`], bufs[`glyph_sheet_${size}_calm`]) === 0;
      report.calmIdentical = { ...(report.calmIdentical ?? {}), [size]: same };
      console.log(`Calm vs normal at ${size}: ${same ? 'byte-identical' : 'DIFFERENT'} (everything below the header line)`);
    }
  }
} catch (e) {
  fail('runner crashed: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)));
} finally {
  if (browser) await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'sheet_report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.failures.length} failure(s).`);
process.exit(report.failures.length ? 1 : 0);
