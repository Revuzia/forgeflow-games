// VALE harness — the fighters' match LOD1 A/B (perf PERF-m5, engine-lod; src/render/lod.ts faceLockedLod, actors.ts
// bodyLodOf). The real renderer (render bench, real Chrome GPU, heavy slot), manual frames, the gameplay camera at its
// default zoom on every fighter of one match. The same match state three times in one page (bench rebuild(): a fresh
// host fast-forwarded to the same `t`, the deterministic sim):
//   A   bodyLod on   (the match default: the body draws its face-locked LOD1, the hull copies are built over it)
//   B   bodyLod off  (full bodies, the hull plan as before)
//   A2  bodyLod on   (again: the noise floor; needlegrass, canopy sway and motes move between captures)
// Per fighter: its body's triangles (full -> LOD1, from the drawn geometry), its on-screen height in px, the frame's
// actor triangles by part (renderer.profile: fighter, .outline, .flash, .xray, crowd...), and the pixels of a crop
// around it that differ A/B against the A/A2 floor (`px24`: past 24 levels; `blob`: those with >= 3 neighbours past 24
// too, a solid patch). Then the menu showcase: it must keep the full body (no 'vale_body_lod1' geometry drawn there).
// Writes a contact sheet per fighter (A | B | 4x |A-B|) so the faces and silhouettes can be looked at.
//
//   node _harness/probe_body_lod.mjs [--map rift] [--t 75] [--seed 7] [--picks a,b,,c] [--tag integ_engine]
//   --picks: a fighter per seat, passed to the bench (an empty entry keeps that seat's default), so every fighter can be
//   covered in two runs. Every fighter of the match is drawn: the probe lifts seat 0's fog of war in the page (the
//   renderer's entityVisible -> true, fog off, re-applied after each rebuild); --no-reveal keeps seat 0's vision, and then
//   an enemy out of sight fails (below).
//   → _harness/_reports/<tag>_body_lod.json, shots _harness/_shots/<tag>_bodylod_<fighter>.png
// Done (engine-lod): every fighter draws its LOD1 in the match (body tris down), the head-locked face is unchanged,
// the A/B crop differs by no more solid patches than the floor allows (reported), and the menu draws full bodies.
// An actor that is not drawn (its root or body hidden, out of vision, or 'fighters main' 0 triangles in the frame) FAILS:
// an empty crop would otherwise read as 'no difference' (integ2 engine verify 1: Tunlan and Kemdo were empty crops).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAP = opt('map', 'rift'), T = Number(opt('t', 75)), SEED = Number(opt('seed', 7)), TAG = opt('tag', 'integ_engine');
const PICKS = opt('picks', ''), REVEAL = !args.includes('--no-reveal');
const CROP = 260;
const REPS = join(HERE, '_reports'), SH = join(HERE, '_shots');
mkdirSync(REPS, { recursive: true }); mkdirSync(SH, { recursive: true });

const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${MAP}&q=high&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1${PICKS ? `&picks=${encodeURIComponent(PICKS)}` : ''}`, { wait: false, hmr: false });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
const report = { at: new Date().toISOString(), map: MAP, t: T, seed: SEED, picks: PICKS || null, reveal: REVEAL, fighters: {}, modes: {}, menu: null, pass: true, fails: [] };
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__?.error ?? null);
  if (err) throw new Error(`bench failed: ${err}`);
  const shots = {};
  for (const mode of ['A', 'B', 'A2']) {
    await B((b, [on, reveal]) => {
      const R = b.renderer;
      R.opts.bodyLod = on; b.rebuild();
      // every fighter drawn, whatever seat 0 sees (harness only: the A/B is about the body, not the fog)
      if (reveal) { R.entityVisible = () => true; R.fog.enabled = false; }
      b.frames(20, 1 / 30);
    }, [mode !== 'B', REVEAL]);
    await page.waitForTimeout(6000);                                     // templates attach, textures land
    await B((b) => b.frames(10, 1 / 30));
    const ids = await B((b) => b.entities('fighter').filter((e) => e.alive).map((e) => ({ id: e.id, def: e.def })));
    const rows = {};
    for (const f of ids) {
      const r = await page.evaluate(async (id) => {
        const b = window.__VALE_BENCH__, R = b.renderer;
        b.zoom(R.map?.camera?.distance ?? 28.5);
        b.focusEntity(id); b.frames(12, 1e-4);
        const pending = R.profile();
        b.frames(1, 1e-4);
        const p = await pending;
        const a = R.actors.get(id);
        let body = null, bodyShown = false;
        // drawn: the actor root and every ancestor of its body visible (traverseVisible), and the body itself
        a?.model?.traverseVisible((o) => { if (o.isSkinnedMesh && !o.userData.valeOutline && o.geometry.index && o.geometry.getAttribute('uv')) bodyShown = true; });
        let rootShown = !!a?.model;
        for (let o = a?.model; o; o = o.parent) if (!o.visible) rootShown = false;
        a?.model?.traverse((o) => {
          if (!o.isSkinnedMesh || o.userData.valeOutline || !o.geometry.index || !o.geometry.getAttribute('uv')) return;
          const t = o.geometry.index.count / 3;
          if (!body || t > body.tris) body = { tris: t, geometry: o.geometry.name || '(template)' };
        });
        const e = b.host.view.entity(id);
        const lo = b.screen(e.x, e.y, 0), hi = b.screen(e.x, e.y, a?.artHeight ?? 1.9);
        const parts = Object.fromEntries(Object.entries(p.detail).filter(([k]) => k.startsWith('actors:')).map(([k, v]) => [k.slice(7), { tris: v.tris, shadow: v.shadowTris, calls: v.calls }]));
        return { body, shown: rootShown && bodyShown, alive: !!e?.alive, px: Math.round(Math.hypot(hi.x - lo.x, hi.y - lo.y)), cx: Math.round((lo.x + hi.x) / 2), cy: Math.round((lo.y + hi.y) / 2), frame: p.total, parts };
      }, f.id);
      const clip = { x: Math.max(0, Math.min(1920 - CROP, r.cx - CROP / 2)), y: Math.max(0, Math.min(1080 - CROP, r.cy - CROP / 2)), width: CROP, height: CROP };
      r.shot = await shot(page, `${TAG}_bodylod_${f.def}_${mode}`, clip);
      rows[f.def] = { id: f.id, ...r };
    }
    report.modes[mode] = rows;
    shots[mode] = rows;
  }
  // the menu showcase keeps the full body
  report.menu = await page.evaluate(async () => {
    const b = window.__VALE_BENCH__, R = b.renderer;
    R.setScene('menu');
    const f = b.catalog.fighters[0].id;
    b.menu('fighter', f);
    for (let i = 0; i < 20; i++) { R.render(1 / 30); await new Promise((r) => setTimeout(r, 150)); }
    let lod = 0, full = 0;
    R.menu.scene.traverse((o) => { if (o.isSkinnedMesh && !o.userData.valeOutline) { if (o.geometry.name === 'vale_body_lod1') lod++; else full++; } });
    return { fighter: f, lodBodies: lod, fullMeshes: full, lodSwitch: { ...R.lodSwitch } };
  });
  if (report.menu.lodBodies > 0 || report.menu.fullMeshes === 0) { report.pass = false; report.fails.push(`menu showcase draws ${report.menu.lodBodies} LOD1 bodies (${report.menu.fullMeshes} full meshes)`); }

  const raw = (p) => sharp(p).raw().toBuffer({ resolveWithObject: true });
  const cmp = (x, y) => {
    const W = x.info.width, H = x.info.height, C = x.info.channels, on = new Uint8Array(W * H);
    let sum = 0, n24 = 0, blob = 0;
    for (let i = 0, k = 0; i < x.data.length; i += C, k++) {
      const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
      sum += d;
      if (d > 24) { n24++; on[k] = 1; }
    }
    for (let py = 1; py < H - 1; py++) for (let px = 1; px < W - 1; px++) {
      if (!on[py * W + px]) continue;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && on[(py + dy) * W + px + dx]) nb++;
      if (nb >= 3) blob++;
    }
    return { mean: +(sum / (W * H)).toFixed(2), px24: n24, blob };
  };
  let bodyFull = 0, bodyLod = 0;
  for (const [def, a] of Object.entries(shots.A)) {
    const b = shots.B[def], a2 = shots.A2[def];
    if (!b || !a2) continue;
    const [ia, ib, ia2] = await Promise.all([a.shot, b.shot, a2.shot].map(raw));
    const diff = cmp(ia, ib), floor = cmp(ia, ia2);
    // contact sheet: A | B | |A-B| x4
    const W = ia.info.width, H = ia.info.height, C = ia.info.channels;
    const d = Buffer.alloc(W * H * 3);
    for (let i = 0, k = 0; i < ia.data.length; i += C, k += 3) for (let c = 0; c < 3; c++) d[k + c] = Math.min(255, Math.abs(ia.data[i + c] - ib.data[i + c]) * 4);
    const sheet = join(SH, `${TAG}_bodylod_${def}.png`);
    await sharp({ create: { width: W * 3 + 8, height: H, channels: 3, background: { r: 20, g: 20, b: 20 } } })
      .composite([{ input: a.shot, left: 0, top: 0 }, { input: b.shot, left: W + 4, top: 0 }, { input: d, raw: { width: W, height: H, channels: 3 }, left: W * 2 + 8, top: 0 }])
      .png().toFile(sheet);
    const row = {
      bodyTris: [b.body?.tris ?? null, a.body?.tris ?? null], bodyGeometry: [b.body?.geometry ?? null, a.body?.geometry ?? null], px: a.px,
      fighterTris: [b.parts, a.parts], frameTris: [b.frame.tris, a.frame.tris], diff, floor, sheet,
    };
    bodyFull += row.bodyTris[0] ?? 0; bodyLod += row.bodyTris[1] ?? 0;
    report.fighters[def] = row;
    // an actor that is not drawn is a FAIL, never 'no difference': its root or body hidden, or no fighter triangles
    const mainTris = (p) => p?.fighter?.tris ?? 0;                      // the fighters' main pass in the frame
    for (const [m, r] of [['A', a], ['B', b], ['A2', a2]]) {
      if (!r.shown || !(mainTris(r.parts) > 0)) { report.pass = false; report.fails.push(`${def} (${m}): not drawn (root/body visible ${r.shown}, alive ${r.alive}, fighters main ${mainTris(r.parts)} tris): an empty crop`); }
    }
    row.shown = [b.shown, a.shown]; row.fightersMain = [mainTris(b.parts), mainTris(a.parts)];
    if (a.body?.geometry !== 'vale_body_lod1') { report.pass = false; report.fails.push(`${def}: the match body draws ${a.body?.geometry} (not its LOD1)`); }
    if (b.body?.geometry === 'vale_body_lod1') { report.pass = false; report.fails.push(`${def}: bodyLod off still draws the LOD1`); }
    const sum = (p, k) => Object.entries(p).filter(([n]) => n.startsWith('fighter')).reduce((s, [, v]) => s + v[k], 0);
    console.log(`${def.padEnd(8)} ${String(row.px).padStart(4)} px tall  body ${row.bodyTris[0]} -> ${row.bodyTris[1]} tris  fighters' main ${sum(b.parts, 'tris')} -> ${sum(a.parts, 'tris')}  frame ${row.frameTris[0]} -> ${row.frameTris[1]}  crop A/B mean ${diff.mean} >24 ${diff.px24} blob ${diff.blob}  (floor A/A2 mean ${floor.mean} >24 ${floor.px24} blob ${floor.blob})`);
  }
  report.total = { bodyFull, bodyLod, share: bodyFull ? +(bodyLod / bodyFull).toFixed(3) : null };
  console.log(`bodies ${bodyFull} -> ${bodyLod} tris (${report.total.share}); menu: ${report.menu.lodBodies} LOD1 bodies, ${report.menu.fullMeshes} full skinned meshes (lodSwitch ${JSON.stringify(report.menu.lodSwitch)})`);
} catch (e) {
  report.pass = false; report.fails.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  report.errors = logs.filter((l) => !/favicon/.test(l)).slice(0, 20);
  const out = join(REPS, `${TAG}_body_lod.json`);
  writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(`${report.pass ? 'PASS' : 'FAIL'}${report.fails.length ? `: ${report.fails.join('; ')}` : ''}  → ${out}`);
  await browser.close();
  process.exitCode = report.pass ? 0 : 1;
}
