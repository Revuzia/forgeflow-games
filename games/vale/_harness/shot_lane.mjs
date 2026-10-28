// VALE harness — lane surface look-dev (the painted lanes: stone-to-stone variation, the worn walked path, verge
// breakup, decals). The real renderer at the gameplay camera, VFX and UI hidden, fog of war off, one browser per
// map and tier. Per map it writes the canonical shot, a second road spot, a close-up (zoom 16 m) of the first
// spot, and at the end a telegraph read: the bench's telegraph set (enemy delayed circles, a line, an ally ring,
// an own cone aim) over the lane, with the numbers that say whether the ground stays calm under it:
//
//   ground hp   the ground's high-pass luma std (luma minus its 9×9 box mean) over the central screen block,
//               telegraphs off: how busy the stone is at the scale a telegraph's edge reads at (lower = calmer)
//   tele delta  mean |luma change| inside the pixels the telegraphs change by ≥ 6 (their own coverage), and
//               the ratio delta / ground hp: the telegraph must stand well clear of the stone's own detail
//
//   node _harness/shot_lane.mjs [--maps rift,bridge,fray] [--q high] [--tele low] [--out dir] [--t 75] [--seed 7]
//
// Shots: _harness/_shots/lane_paint_<map>.png (canonical, High), lane_paint_<map>_b.png, lane_paint_<map>_close.png,
// lane_paint_<map>_tele_<tier>.png (+ _q<tier> suffix on the first three when --q is not high). --out copies
// every shot there too (before / after sets). Report: _harness/_reports/shot_lane.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAPS = opt('maps', 'rift,bridge,fray').split(',');
const Q = opt('q', 'high');
const TELE = opt('tele', 'low');
const OUT = opt('out', '');
const T = Number(opt('t', 75));
const SEED = Number(opt('seed', 7));
const RES = { high: [1920, 1080], low: [1280, 720], medium: [1920, 1080], ultra: [1920, 1080] };
if (OUT) mkdirSync(OUT, { recursive: true });
const keep = (p) => { if (OUT) copyFileSync(p, join(OUT, basename(p))); return p; };

/** the lane spots per map (world x, y): the canonical one, a second road, both on the walked stone */
function spotsOf(b) {
  const m = b.catalog.maps.find((x) => x.id === b.host.setup.map);
  const [W, H] = m.size;
  const along = (path, f) => {
    let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    let d = L * f;
    for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (d <= l) { const t = d / l; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; } d -= l; }
    return path[path.length - 1];
  };
  if (m.lanes.length >= 3) return { a: along(m.lanes[1].path, 0.3), b: along(m.lanes[0].path, 0.45) };
  if (m.lanes.length) return { a: along(m.lanes[0].path, 0.38), b: along(m.lanes[0].path, 0.62) };
  return { a: [W / 2, H * 0.36], b: [W * 0.3, H * 0.55] };
}

function install() {
  const b = window.__VALE_BENCH__, R = b.renderer;
  const fx = R.vfx.screen.fx;
  R.vfx.draw = () => {}; R.vfx.group.visible = false; R.vfx.clear(); fx.setDead = () => {}; fx.reset();
  R.fog.enabled = false;
  const ctx = R.gl.getContext();
  const grab = () => {
    const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight;
    R.gl.setRenderTarget(null);
    const buf = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    return { w, h, L };
  };
  /** high-pass luma std over the central block (the middle 50 % × 50 %) */
  const hp = (f) => {
    const { w, h, L } = f, r = 4;
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
    let n = 0, s2 = 0, sm = 0;
    for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y++) for (let x = Math.floor(w * 0.25); x < Math.floor(w * 0.75); x++) {
      const x0 = x - r, x1 = x + r + 1, y0 = y - r, y1 = y + r + 1;
      const box = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((2 * r + 1) ** 2);
      const d = L[y * w + x] - box; s2 += d * d; sm += L[y * w + x]; n++;
    }
    return { hp: +Math.sqrt(s2 / n).toFixed(2), mean: +(sm / n).toFixed(1) };
  };
  window.__LP__ = {
    at: (x, y, zoom) => { b.focus(x, y); b.zoom(zoom); R.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 14; i++) R.render(1 / 60); return hp(grab()); },
    tele: (x, y) => {
      b.focus(x, y); b.zoom(28.5); R.director.telegraphs.length = 0; b.clearAim();
      for (let i = 0; i < 14; i++) R.render(1 / 60);
      const off = grab(), g = hp(off);
      b.telegraphTest(x, y);
      for (let i = 0; i < 18; i++) R.render(1 / 60);
      const on = grab();
      let n = 0, s = 0;
      for (let i = 0; i < on.L.length; i++) { const d = Math.abs(on.L[i] - off.L[i]); if (d >= 6) { n++; s += d; } }
      const delta = n ? s / n : 0;
      return { groundHp: g.hp, groundMean: g.mean, telePx: n, teleDelta: +delta.toFixed(1), ratio: +(delta / Math.max(0.1, g.hp)).toFixed(2) };
    },
    clear: () => { R.director.telegraphs.length = 0; b.clearAim(); },
  };
  return true;
}

const REPORT = join(HERE, '_reports', 'shot_lane.json');
mkdirSync(dirname(REPORT), { recursive: true });
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { note: 'lane surface look-dev (_harness/shot_lane.mjs)', runs: {} };
const tag = opt('tag', 'run');
report.runs[tag] ??= {};

async function session(map, tier, fn) {
  const [w, h] = RES[tier] ?? RES.high;
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${map}&q=${tier}&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false, width: w, height: h });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
    const B = (f, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [f.toString(), a]);
    await B((b) => b.frames(60, 1 / 30));
    await page.waitForTimeout(5000);
    await B((b) => b.frames(6, 1 / 30));
    await page.evaluate(`(${install.toString()})()`);
    const L = (f, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__LP__, x), [f.toString(), a]);
    const spots = await B(spotsOf);
    return await fn({ page, B, L, spots, logs });
  } finally {
    await browser.close();
  }
}

for (const map of MAPS) {
  const out = (report.runs[tag][map] ??= {});
  const sfx = Q === 'high' ? '' : `_q${Q}`;
  await session(map, Q, async ({ page, L, spots, logs }) => {
    out.spots = spots;
    out.a = await L((v, a) => v.at(a[0], a[1], 28.5), spots.a);
    keep(await shot(page, `lane_paint_${map}${sfx}`));
    out.b = await L((v, a) => v.at(a[0], a[1], 28.5), spots.b);
    keep(await shot(page, `lane_paint_${map}_b${sfx}`));
    out.close = await L((v, a) => v.at(a[0], a[1], 16), spots.a);
    keep(await shot(page, `lane_paint_${map}_close${sfx}`));
    out.logs = logs.filter((l) => !/favicon|toNonIndexed/.test(l)).slice(0, 8);
    console.log(map, Q, 'ground hp', JSON.stringify({ a: out.a, b: out.b, close: out.close }));
  });
  if (TELE && TELE !== 'none') {
    await session(map, TELE, async ({ page, L, spots }) => {
      out[`tele_${TELE}`] = await L((v, a) => v.tele(a[0], a[1]), spots.a);
      keep(await shot(page, `lane_paint_${map}_tele_${TELE}`));
      console.log(map, TELE, 'telegraph', JSON.stringify(out[`tele_${TELE}`]));
    });
  }
  report.generated = new Date().toISOString();
  writeFileSync(REPORT, JSON.stringify(report, null, 1));
}
console.log(`report: ${REPORT}`);
