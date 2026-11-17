// orch1 W2-A scratch (GFX-2 / FU-5 bar): fighters' on-screen chroma against their albedo chroma, lane OFF vs ON.
//   python3 art/blender/common/heavy.py run -- node _harness/_tmp_w2a_chroma.mjs [--seed 7] [--out file.json]
// Two RIFT matches seat all 16 fighters (units_gate's first seating); spectator, fog off, the game camera (28.5 m).
// Per fighter: the silhouette (meshes shown vs hidden, units_gate's rule), then the same frame drawn with every fighter
// material swapped for an albedo pass (diffuseColor = colour x map, sRGB out, no light, no grade). Signature zone = the
// silhouette's most chromatic quarter BY ALBEDO. Reported per fighter and switch state: screen C* / albedo C* (median
// over the zone; the bar is >= 0.70), the top-25 % L* on screen (<= 80), and the zone's screen C* (>= 20).
import { writeFileSync } from 'node:fs';
import { openBench, B } from './gfx_lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(opt('seed', 7)), OUT = opt('out', '_design/reviews/orch1/evidence/w2-a/fighter_chroma.json');
const FIGHTERS = ['ardit', 'burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'kemdo', 'lisvel', 'marund', 'nurrow', 'odrum', 'rishal', 'sukri', 'tunlan', 'ulkro', 'vashil'];

const measure = (b, a) => {
  const R = b.renderer, canvas = document.getElementById('c');
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lab = (r, g, bl) => {
    const [x0, y0, z0] = [lin(r), lin(g), lin(bl)];
    const x = (0.4124 * x0 + 0.3576 * y0 + 0.1805 * z0) / 0.95047, y = 0.2126 * x0 + 0.7152 * y0 + 0.0722 * z0, z = (0.0193 * x0 + 0.1192 * y0 + 0.9505 * z0) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const read = (x0, y0, w, h) => { const o = document.createElement('canvas'); o.width = w; o.height = h; const c = o.getContext('2d', { willReadFrequently: true }); c.drawImage(canvas, x0, y0, w, h, 0, 0, w, h); return c.getImageData(0, 0, w, h).data; };
  const med = (v) => { const s = [...v].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
  const set = (on) => { R.w2a.envKey.on = on; R.w2a.charTone.on = on; R.w2a.apply(); R.lod2Switch.on = on; };
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
    const rec = { id, def: e.def };
    for (const [tag, on] of [['before', false], ['after', true]]) {
      set(on);
      for (let i = 0; i < 3; i++) R.render(0);
      const F = read(x0, y0, W, H);
      meshes.forEach((m) => { m.visible = false; }); R.render(0); const G = read(x0, y0, W, H);
      meshes.forEach((m, i) => { m.visible = wasVis[i]; });
      // albedo pass: swap the fighter's materials, draw the scene straight to the canvas (no post, no grade)
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
      R.render(0);
      const N = W * H, px = [];
      for (let i = 1; i < N; i++) {
        const k = i * 4;
        const d = Math.max(Math.abs(F[k] - G[k]), Math.abs(F[k + 1] - G[k + 1]), Math.abs(F[k + 2] - G[k + 2]));
        if (d < 20) continue;
        const fs = F[k] + F[k + 1] + F[k + 2], gs = G[k] + G[k + 1] + G[k + 2];
        const dot = F[k] * G[k] + F[k + 1] * G[k + 1] + F[k + 2] * G[k + 2];
        const nf = Math.hypot(F[k], F[k + 1], F[k + 2]) || 1, ng = Math.hypot(G[k], G[k + 1], G[k + 2]) || 1;
        if (fs < gs && dot / (nf * ng) > 0.997) continue;
        const s = lab(F[k], F[k + 1], F[k + 2]), al = lab(A[k], A[k + 1], A[k + 2]);
        px.push({ L: s[0], C: Math.hypot(s[1], s[2]), aC: Math.hypot(al[1], al[2]) });
      }
      if (px.length < 200) { rec[tag] = { px: px.length, error: 'too few pixels' }; continue; }
      const byA = [...px].sort((p, q) => q.aC - p.aC).slice(0, Math.max(1, px.length >> 2));
      const Ls = px.map((p) => p.L).sort((p, q) => p - q);
      const top = Ls.slice(Math.floor(Ls.length * 0.75));
      const zoneC = med(byA.map((p) => p.C)), zoneA = med(byA.map((p) => p.aC));
      rec[tag] = { px: px.length, zoneScreenC: +zoneC.toFixed(1), zoneAlbedoC: +zoneA.toFixed(1), ratio: +(zoneC / zoneA).toFixed(2), top25L: +(top.reduce((s, v) => s + v, 0) / top.length).toFixed(1), meanC: +(px.reduce((s, p) => s + p.C, 0) / px.length).toFixed(1) };
    }
    out.push(rec);
  }
  set(true);
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
    const got = await page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, a), [measure.toString(), { ids }]);
    all.push(...got);
  } finally { await browser.close(); }
}
const bar = (r) => r && !r.error && r.ratio >= 0.7 && r.top25L <= 80 && r.zoneScreenC >= 20;
for (const r of all) console.log(r.def.padEnd(8), 'before', JSON.stringify(r.before), '\n         after ', JSON.stringify(r.after), bar(r.after) ? 'PASS' : 'FAIL');
const summary = { pass: all.filter((r) => bar(r.after)).length, of: all.length, fails: all.filter((r) => !bar(r.after)).map((r) => r.def) };
console.log(JSON.stringify(summary));
writeFileSync(OUT, JSON.stringify({ seed: SEED, bar: { ratio: 0.7, top25L: 80, zoneScreenC: 20 }, summary, fighters: all }, null, 1));
