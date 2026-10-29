// VALE harness — the crowd's team-colour accents under its LOD (perf PERF-m5, engine-lod refix; src/render/crowd.ts
// bakeCrowd, lod.ts LOD.crowd). The real renderer (render bench on the dev server, real Chrome GPU, heavy slot), the sim
// held, the gameplay camera at its default zoom on Wicks of each kind and team. Per crop, the ACCENT PIXELS: the pixels
// that change by more than 24 levels when the crowd's accent parts are hidden (the stripe / band / glow as drawn, after
// every occluder). Three states of the same frame:
//   full       every crowd part and hull at its full index (the LOD off)
//   shipped    as the renderer builds it (body and hull LOD'd, the accents whole)
//   accentLod  control: the accent parts ALSO through LOD.crowd (the integ2 regression: 608 -> 445 px on a shieldwick);
//              the probe must see it, or its gate means nothing
// plus `floor`: shipped drawn twice (the noise of an identical frame).
//
//   node _harness/probe_crowd_accent.mjs [--t 900] [--seed 7] [--defs shieldwick,greatwick,glimwick] [--tag integ_engine]
//   → _harness/_reports/<tag>_crowd_accent.json, shots _harness/_shots/<tag>_accent_<def>_<team>.png (full | shipped |
//     accentLod | the full state's accent mask)
// Gate (exit 1): for every def, its crops' accent pixels shipped / full within 3 % (summed over its crops); every crop
// must show accent pixels (an empty crop fails, it is not "no difference"); the floor stays under 1 % of full.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 900)), SEED = Number(opt('seed', 7)), TAG = opt('tag', 'integ_engine');
const DEFS = opt('defs', 'shieldwick,greatwick,glimwick').split(',').filter(Boolean);
const CROP = 200, MIN_PX = 40, TOL = 0.03;
const REPS = join(HERE, '_reports'), SH = join(HERE, '_shots');
mkdirSync(REPS, { recursive: true }); mkdirSync(SH, { recursive: true });

const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
const report = { at: new Date().toISOString(), map: 'rift', t: T, seed: SEED, crops: [], defs: {}, accentParts: null, pass: true, fails: [] };
const raw = async (p) => sharp(p).raw().toBuffer({ resolveWithObject: true });
/** pixels past 24 levels (max channel) between two crops, and the mask */
const diff = (x, y) => {
  const C = x.info.channels, n = x.info.width * x.info.height, m = new Uint8Array(n);
  let c = 0;
  for (let i = 0, k = 0; k < n; i += C, k++) {
    const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
    if (d > 24) { m[k] = 1; c++; }
  }
  return { px: c, mask: m };
};
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
  if (err) throw new Error(`bench failed: ${err}`);
  await B((b) => b.frames(90, 1 / 30));
  await page.waitForTimeout(5000);                                       // templates attach, the crowd bakes
  await B((b) => b.frames(30, 1 / 30));
  // the control's accent LODs (the regression), built with the renderer's own lodIndex
  report.accentParts = await page.evaluate(async () => {
    const R = window.__VALE_BENCH__.renderer;
    const L = await import('/src/render/lod.ts');
    await L.lodReady;
    const parts = [], bodies = [];
    R.crowd.group.traverse((o) => {
      if (o.isMesh && o.name === 'crowd_part_body') bodies.push({ tris: (o.geometry.userData.fullIndex ?? o.geometry.index).count / 3, lodTris: o.geometry.index.count / 3 });
      if (!o.isMesh || o.name !== 'crowd_part_accent') return;
      const g = o.geometry;
      g.userData.shipIndex = g.index;
      const l = L.lodIndex(g, 'crowd', L.LOD.minTrisCrowd, o.userData.valeLodUnit ?? 1);
      g.userData.ctlIndex = l;
      parts.push({ tris: g.index.count / 3, lodTris: l ? l.count / 3 : null, lodded: !!g.userData.fullIndex });
    });
    return { parts, bodies };
  });
  report.bodyParts = report.accentParts.bodies; report.accentParts = report.accentParts.parts;
  const bt = report.bodyParts.reduce((t, b) => [t[0] + b.tris, t[1] + b.lodTris], [0, 0]);
  console.log(`crowd sets: ${report.bodyParts.length} body parts ${bt[0]} -> ${bt[1]} tris (${(bt[1] / bt[0]).toFixed(3)}); ${report.accentParts.length} accent parts ${report.accentParts.reduce((t, p) => t + p.tris, 0)} tris whole`);
  const lodded = report.accentParts.filter((p) => p.lodded).length;
  if (lodded) { report.pass = false; report.fails.push(`${lodded} crowd accent parts draw through a LOD (crowd.ts bakeCrowd must keep them whole)`); }

  const units = await B((b) => b.entities('minion').filter((e) => e.alive));
  const setState = (state) => B((b, s) => {
    const R = b.renderer;
    R.crowd.group.traverse((o) => {
      const g = o.geometry;
      if (!o.isMesh || !g) return;
      if (g.userData.fullIndex) { g.userData.lodIndex ??= g.index; g.setIndex(s === 'full' ? g.userData.fullIndex : g.userData.lodIndex); }
      if (o.name === 'crowd_part_accent' && g.userData.shipIndex) g.setIndex(s === 'accentLod' && g.userData.ctlIndex ? g.userData.ctlIndex : g.userData.shipIndex);
    });
  }, state);
  const draw = (accents) => B((b, on) => {
    const R = b.renderer;
    R.crowd.group.traverse((o) => { if (o.name === 'crowd_part_accent') o.visible = on; });
    R.vfx.clear();
    for (let i = 0; i < 6; i++) R.render(0);
  }, accents);

  for (const def of DEFS) {
    for (const team of [0, 1]) {
      const cands = units.filter((u) => u.def === def && u.team === team).slice(0, 6);
      let row = null;
      for (const u of cands) {
        const at = await B((b, id) => {
          const R = b.renderer;
          b.zoom(R.map?.camera?.distance ?? 28.5);
          b.focusEntity(id); b.frames(12, 1e-4);
          const e = b.host.view.entity(id), a = R.actors.get(id);
          if (!e || !e.alive) return null;
          const lo = b.screen(e.x, e.y, 0), hi = b.screen(e.x, e.y, a?.artHeight ?? 1.2);
          return { cx: Math.round((lo.x + hi.x) / 2), cy: Math.round((lo.y + hi.y) / 2), px: Math.round(Math.hypot(hi.x - lo.x, hi.y - lo.y)), crowd: !!a?.crowdBake };
        }, u.id);
        if (!at) continue;
        const clip = { x: Math.max(0, Math.min(1920 - CROP, at.cx - CROP / 2)), y: Math.max(0, Math.min(1080 - CROP, at.cy - CROP / 2)), width: CROP, height: CROP };
        const name = `${TAG}_accent_${def}_${team}`;
        const st = {};
        for (const s of ['full', 'shipped', 'accentLod', 'shipped2']) {
          await setState(s === 'shipped2' ? 'shipped' : s);
          await draw(true);
          const on = await shot(page, `${name}_${s}_on`, clip);
          await draw(false);
          const off = await shot(page, `${name}_${s}_off`, clip);
          const [a, b] = await Promise.all([raw(on), raw(off)]);
          st[s] = { on, off, ...diff(a, b), img: a };
        }
        await setState('shipped'); await draw(true);
        if (st.full.px < MIN_PX) continue;                                 // not on screen / hidden: try the next one
        const fl = diff(st.shipped.img, st.shipped2.img);
        row = {
          def, team, id: u.id, unitPx: at.px, crowd: at.crowd, clip,
          accentPx: { full: st.full.px, shipped: st.shipped.px, accentLod: st.accentLod.px, shipped2: st.shipped2.px },
          ratio: { shipped: +(st.shipped.px / st.full.px).toFixed(3), accentLod: +(st.accentLod.px / st.full.px).toFixed(3) },
          floorPx: fl.px,
        };
        // sheet: full | shipped | accentLod | the full state's accent mask (white)
        const W = CROP, H = CROP, mask = Buffer.alloc(W * H * 3);
        for (let k = 0; k < W * H; k++) if (st.full.mask[k]) mask[k * 3] = mask[k * 3 + 1] = mask[k * 3 + 2] = 255;
        row.sheet = join(SH, `${name}.png`);
        await sharp({ create: { width: W * 4 + 12, height: H, channels: 3, background: { r: 20, g: 20, b: 20 } } })
          .composite([{ input: st.full.on, left: 0, top: 0 }, { input: st.shipped.on, left: W + 4, top: 0 }, { input: st.accentLod.on, left: 2 * W + 8, top: 0 }, { input: mask, raw: { width: W, height: H, channels: 3 }, left: 3 * W + 12, top: 0 }])
          .png().toFile(row.sheet);
        break;
      }
      if (!row) { report.pass = false; report.fails.push(`${def} team ${team}: no crop with >= ${MIN_PX} accent px (${cands.length} candidates; invisible or off screen)`); continue; }
      report.crops.push(row);
      console.log(`${def.padEnd(11)} team ${team}  ${String(row.unitPx).padStart(3)} px tall  accent px full ${row.accentPx.full}  shipped ${row.accentPx.shipped} (${row.ratio.shipped})  accentLod ${row.accentPx.accentLod} (${row.ratio.accentLod})  floor ${row.floorPx}`);
    }
    const rows = report.crops.filter((r) => r.def === def);
    if (!rows.length) continue;
    const s = (k) => rows.reduce((t, r) => t + r.accentPx[k], 0);
    const d = { full: s('full'), shipped: s('shipped'), accentLod: s('accentLod'), floor: rows.reduce((t, r) => t + r.floorPx, 0) };
    d.ratio = +(d.shipped / d.full).toFixed(3); d.ratioAccentLod = +(d.accentLod / d.full).toFixed(3);
    d.pass = Math.abs(d.ratio - 1) <= TOL && d.floor <= 0.01 * d.full;
    report.defs[def] = d;
    if (!d.pass) { report.pass = false; report.fails.push(`${def}: accent px shipped / full ${d.ratio} (gate 1 +- ${TOL}), floor ${d.floor}`); }
  }
  const ctl = Object.values(report.defs).some((d) => Math.abs(d.ratioAccentLod - 1) > TOL);
  report.control = { seesRegression: ctl };
  if (!ctl) report.fails.push('control: the accent-LOD state is also within 3 % (the probe cannot see the regression here; reported)');
  for (const [k, d] of Object.entries(report.defs)) console.log(`${k.padEnd(11)} accent px full ${d.full}  shipped ${d.shipped} (${d.ratio})  accentLod ${d.accentLod} (${d.ratioAccentLod})  floor ${d.floor}  ${d.pass ? 'PASS' : 'FAIL'}`);
} catch (e) {
  report.pass = false; report.fails.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  report.errors = logs.filter((l) => !/favicon/.test(l)).slice(0, 20);
  const out = join(REPS, `${TAG}_crowd_accent.json`);
  writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(`${report.pass ? 'PASS' : 'FAIL'}${report.fails.length ? `: ${report.fails.join('; ')}` : ''}  → ${out}`);
  await browser.close();
  process.exitCode = report.pass ? 0 : 1;
}
