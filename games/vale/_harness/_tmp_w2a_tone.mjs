// orch1 W2-A scratch (character light): sweep the fighter tone (valeCharAo: AO weight, roll-off knee / ceiling) and the
// eye fill / crown scale over all 16 fighters, game camera 28.5 m, RIFT, spectator, fog off; per variant and fighter the
// top-25 % L* on screen (bars: <= 80 ruling 46, >= 70 units_gate P3), the signature-zone screen C* / albedo C* (>= 0.70)
// and the zone's screen C* (>= 20). Method as _tmp_w2a_chroma.mjs (silhouette = shown vs hidden; zone = the most
// chromatic quarter by albedo).
//   VALE_URL=... python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_tone.mjs --variants '<json>' [--seed 7] [--out f.json]
// variant: { name, ao, knee, ceil, fill (x the configured fill), crown (x the configured crown) }
import { writeFileSync } from 'node:fs';
import { openBench, B } from './gfx_lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(opt('seed', 7)), OUT = opt('out', null);
const VARIANTS = JSON.parse(opt('variants', '[{"name":"head"}]'));
const FIGHTERS = ['ardit', 'burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'kemdo', 'lisvel', 'marund', 'nurrow', 'odrum', 'rishal', 'sukri', 'tunlan', 'ulkro', 'vashil'];

const measure = (b, a) => {
  const R = b.renderer, canvas = document.getElementById('c'), U = R.w2a.uniforms;
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lab = (r, g, bl) => {
    const [x0, y0, z0] = [lin(r), lin(g), lin(bl)];
    const x = (0.4124 * x0 + 0.3576 * y0 + 0.1805 * z0) / 0.95047, y = 0.2126 * x0 + 0.7152 * y0 + 0.0722 * z0, z = (0.0193 * x0 + 0.1192 * y0 + 0.9505 * z0) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const read = (x0, y0, w, h) => { const o = document.createElement('canvas'); o.width = w; o.height = h; const c = o.getContext('2d', { willReadFrequently: true }); c.drawImage(canvas, x0, y0, w, h, 0, 0, w, h); return c.getImageData(0, 0, w, h).data; };
  const med = (v) => { const s = [...v].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
  R.w2a.apply();
  const base = { ao: U.valeCharAo.value.clone(), fill: U.valeCharFill.value.clone(), crown: U.valeCharCrown.value.clone(), spec: U.valeCharSpecRoll?.value ?? 0 };
  const setV = (v) => {
    R.w2a.apply();
    U.valeCharAo.value.set(v.ao ?? base.ao.x, v.knee ?? base.ao.y, v.ceil ?? base.ao.z, v.floor ?? base.ao.w);
    U.valeCharFill.value.copy(base.fill).multiplyScalar(v.fill ?? 1);
    U.valeCharCrown.value.set(v.crownAbs ?? base.crown.x * (v.crown ?? 1), v.pow ?? base.crown.y);
    if (U.valeCharSpecRoll) U.valeCharSpecRoll.value = v.spec ?? base.spec;
  };
  const out = [];
  for (const id of a.ids) {
    const e = b.entities().find((x) => x.id === id);
    if (!e) continue;
    const act = R.actors.get(id);
    b.focus(e.x, e.y); b.zoom(28.5); b.frames(4, 1e-4);
    const mid = b.screen(e.x, e.y, 1.0);
    const W = 260, H = 320;
    const x0 = Math.max(0, Math.min(canvas.width - W, Math.round(mid.x - W / 2))), y0 = Math.max(0, Math.min(canvas.height - H, Math.round(mid.y - H * 0.62)));
    const meshes = []; act.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
    const wasVis = meshes.map((m) => m.visible);
    setV({});
    for (let i = 0; i < 3; i++) R.render(0);
    meshes.forEach((m) => { m.visible = false; }); R.render(0); const G = read(x0, y0, W, H);
    meshes.forEach((m, i) => { m.visible = wasVis[i]; });
    const swaps = [];
    for (const m of meshes) {
      if (!m.visible || !m.material || Array.isArray(m.material) || !m.material.isMeshStandardMaterial) continue;
      const c = m.material.clone();
      c.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', 'gl_FragColor = vec4( diffuseColor.rgb, 1.0 );'); };
      c.customProgramCacheKey = () => 'w2a_albedo';
      c.toneMapped = false;
      swaps.push([m, m.material]); m.material = c;
    }
    R.gl.setRenderTarget(null); R.gl.render(R.scene, R.rig.camera);
    const A = read(x0, y0, W, H);
    for (const [m, mat] of swaps) { m.material.dispose(); m.material = mat; }
    // a lighting-independent silhouette: the raw (no post) albedo frame vs the raw frame with the fighter hidden
    meshes.forEach((m) => { m.visible = false; }); R.gl.setRenderTarget(null); R.gl.render(R.scene, R.rig.camera); const G0 = read(x0, y0, W, H);
    meshes.forEach((m, i) => { m.visible = wasVis[i]; });
    const MASK = a.mask === 'raw';
    const rec = { id, def: e.def };
    for (const v of a.variants) {
      setV(v);
      for (let i = 0; i < 3; i++) R.render(0);
      const F = read(x0, y0, W, H);
      const N = W * H, px = [];
      for (let i = 1; i < N; i++) {
        const k = i * 4;
        const d = Math.max(Math.abs(F[k] - G[k]), Math.abs(F[k + 1] - G[k + 1]), Math.abs(F[k + 2] - G[k + 2]));
        if (MASK) {
          if (Math.max(Math.abs(A[k] - G0[k]), Math.abs(A[k + 1] - G0[k + 1]), Math.abs(A[k + 2] - G0[k + 2])) < 4) continue;
          // interior only (a pixel whose 4 neighbours are fighter too: the SMAA edge blends with the ground)
          const nb = [k - 4, k + 4, k - W * 4, k + W * 4];
          if (nb.some((q) => q < 0 || q >= A.length || Math.max(Math.abs(A[q] - G0[q]), Math.abs(A[q + 1] - G0[q + 1]), Math.abs(A[q + 2] - G0[q + 2])) < 4)) continue;
        } else {
        if (d < 20) continue;
        const fs = F[k] + F[k + 1] + F[k + 2], gs = G[k] + G[k + 1] + G[k + 2];
        const dot = F[k] * G[k] + F[k + 1] * G[k + 1] + F[k + 2] * G[k + 2];
        const nf = Math.hypot(F[k], F[k + 1], F[k + 2]) || 1, ng = Math.hypot(G[k], G[k + 1], G[k + 2]) || 1;
        if (fs < gs && dot / (nf * ng) > 0.997) continue;
        }
        const s = lab(F[k], F[k + 1], F[k + 2]), al = lab(A[k], A[k + 1], A[k + 2]);
        px.push({ L: s[0], C: Math.hypot(s[1], s[2]), aC: Math.hypot(al[1], al[2]) });
      }
      if (px.length < 200) { rec[v.name] = { px: px.length, error: 'too few pixels' }; continue; }
      const byA = [...px].sort((p, q) => q.aC - p.aC).slice(0, Math.max(1, px.length >> 2));
      const Ls = px.map((p) => p.L).sort((p, q) => p - q);
      const top = Ls.slice(Math.floor(Ls.length * 0.75));
      const zoneC = med(byA.map((p) => p.C)), zoneA = med(byA.map((p) => p.aC));
      rec[v.name] = { px: px.length, zoneC: +zoneC.toFixed(1), ratio: +(zoneC / zoneA).toFixed(2), top25L: +(top.reduce((s, x) => s + x, 0) / top.length).toFixed(1), meanC: +(px.reduce((s, p) => s + p.C, 0) / px.length).toFixed(1), p50L: +Ls[Ls.length >> 1].toFixed(1) };
    }
    out.push(rec);
  }
  setV({});
  return out;
};

const all = [];
for (const half of [0, 1]) {
  const seats = half === 0 ? FIGHTERS.slice(0, 10) : FIGHTERS.slice(6, 16);
  const want = half === 0 ? FIGHTERS.slice(0, 10) : FIGHTERS.slice(10, 16);
  const { browser, page } = await openBench({ q: 'high', t: 4, mode: 'rift', seed: SEED, extra: `&picks=${seats.join(',')}`, land: 1500 });
  try {
    for (let i = 0; i < 120; i++) { if ((await B(page, (b) => b.renderer.lib?.pending ?? 0)) === 0) break; await page.waitForTimeout(1000); }
    await B(page, (b) => { b.frames(30, 1 / 30); const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; b.frames(6, 1 / 30); });
    const ents = await B(page, (b) => b.entities('fighter'));
    const ids = want.map((f) => ents.find((e) => e.def === f)?.id).filter((x) => x !== undefined);
    all.push(...await page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, a), [measure.toString(), { ids, variants: VARIANTS, mask: opt('mask', 'raw') }]));
  } finally { await browser.close(); }
}
const sum = {};
for (const v of VARIANTS) {
  const r = all.map((f) => f[v.name]).filter((x) => x && !x.error);
  const t = r.map((x) => x.top25L);
  sum[v.name] = { n: r.length, top25Min: Math.min(...t), top25Max: Math.max(...t), under70: all.filter((f) => f[v.name]?.top25L < 70).map((f) => f.def), over80: all.filter((f) => f[v.name]?.top25L > 80).map((f) => f.def), ratioMin: Math.min(...r.map((x) => x.ratio)), zoneCMin: Math.min(...r.map((x) => x.zoneC)) };
}
for (const f of all) console.log(f.def.padEnd(8), VARIANTS.map((v) => `${v.name}:${f[v.name]?.top25L}/${f[v.name]?.ratio}`).join('  '));
console.log(JSON.stringify(sum, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify({ seed: SEED, variants: VARIANTS, summary: sum, fighters: all }, null, 1));
