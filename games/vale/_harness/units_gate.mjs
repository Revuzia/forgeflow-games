// VALE harness — units_gate (orch1 FU-4): ONE rendered-pixel gate for roster colour. It merges max_units_ab (the in-game
// bench, fighters at the gameplay camera) with lineup_qa (crown break, value bands) and measures what the player SEES:
// the graded canvas pixels, in CIELAB and sRGB HSV, never the albedo.
//
//   python3 art/blender/common/heavy.py run -- node _harness/units_gate.mjs [--seeds 7,11,23] [--seatings 3] [--q high]
//        [--tag units_gate] [--lineup art/renders/lineup/<name>.json] [--only a,b] [--zoom 28.5] [--mode rift]
//   exit 0 = PASS, 1 = FAIL (the JSON is written either way), 2 = harness error.
//
// Capture: for every (seed, seating) the 16 fighters are seated on a RIFT bench in two matches (seats 0-9 take list[0..9],
// the second match list[6..15]; the seating k rotates the list by 5k so every fighter gets a different seat, lane side
// and light); the viewer is a spectator (palette viewer team -1, fog off) so a fighter of either team is in view.
// Per fighter: the frame is rendered with the fighter's meshes shown and hidden at the same camera; the pixels that
// differ (minus a pure-darkening shadow) are the silhouette. Metrics (cores only, silhouette eroded by 1 px):
//   top        median CIELAB + sRGB HSV of the top 25 % of the silhouette (the "top cluster")
//   crown      the top 12 % against the next 12 % (dL*, dHue at C >= 12): break = dL >= 8 or dHue >= 20
//   bands      mean L* of the brightest quarter / middle half / darkest quarter of the fighter's pixels (value_probe.mjs's
//              convention) against tokens.json fighter.valueLstar; the spatial top/mid/bottom rows are reported too
//   share      share of top-cluster pixels in the ally (HSV 200-225), harm/enemy (28-50) and heal (125-150) bands
// Gates (FU-4; min over the runs of a fighter, never the median: lighting-dependent reads):
//   P1  no pair of tops under 30 deg CIELAB hue (both C >= 15) with dE76 < 25 (min over every run pair)
//   P2  no top median inside the ally (200-225), enemy/harm (28-50) HSV band at S >= 0.40 (heal 125-150 reported only)
//   P3  top-quarter L* inside the bible band (70-85) on the median run (tokens.json fighter.valueLstar note); the middle half and
//       the darkest quarter are reported as valueMidOk / valueBottomOk, not gated (outline and cast shadows sit in the dark quarter)
//   P4  every fighter has a crown break (dL >= 8 or dHue >= 20) in the median of its runs
// Output: _design/reviews/orch1/evidence/units/<tag>.json + <tag>_sheet.png (contact sheet, one cell per fighter).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { openBench, B, load } from './gfx_lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const tag = arg('tag', 'units_gate'), q = arg('q', 'high'), zoom = Number(arg('zoom', 28.5)), mode = arg('mode', 'rift');
const seeds = arg('seeds', '7,11,23').split(',').map(Number);
const nSeatings = Number(arg('seatings', 3));
const only = arg('only', '');
const OUT = '_design/reviews/orch1/evidence/units';
mkdirSync(OUT, { recursive: true });
const FIGHTERS = ['ardit', 'burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'kemdo', 'lisvel', 'marund', 'nurrow', 'odrum', 'rishal', 'sukri', 'tunlan', 'ulkro', 'vashil'];
const BAND = { top: [70, 85], mid: [45, 65], bottom: [20, 35] };       // tokens.json fighter.valueLstar
const ALLY = [200, 225], HARM = [28, 50], HEAL = [125, 150];
const t0 = Date.now();

// ---- in-page measurement (runs in the bench page: it holds the canvas) ----
const measurePage = (b, a) => {
  const R = b.renderer, canvas = document.getElementById('c');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lab = (r, g, bl) => {
    const [R_, G_, B_] = [lin(r), lin(g), lin(bl)];
    const x = (0.4124 * R_ + 0.3576 * G_ + 0.1805 * B_) / 0.95047, y = 0.2126 * R_ + 0.7152 * G_ + 0.0722 * B_, z = (0.0193 * R_ + 0.1192 * G_ + 0.9505 * B_) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const hsv = (r, g, bl) => {
    r /= 255; g /= 255; bl /= 255;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
    let h = 0;
    if (d > 0) h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
    return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
  };
  const med = (v) => { const s = Float64Array.from(v).sort(); return s.length ? s[s.length >> 1] : NaN; };
  const read = (x0, y0, w, h) => {
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    const c = o.getContext('2d', { willReadFrequently: true }); c.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    return { img: c.getImageData(0, 0, w, h), url: () => o.toDataURL('image/png') };
  };
  const out = [];
  for (const id of a.ids) {
    const e = b.entities().find((x) => x.id === id);
    if (!e) { out.push({ id, error: 'entity missing' }); continue; }
    const act = R.actors.get(id);
    b.focus(e.x, e.y); b.zoom(a.zoom); b.frames(4, 1e-4);
    const mid = b.screen(e.x, e.y, 1.0);
    const W = 260, H = 320;
    const x0 = clamp(Math.round(mid.x - W / 2), 0, canvas.width - W), y0 = clamp(Math.round(mid.y - H * 0.62), 0, canvas.height - H);
    // actor meshes: the fighter's own tree. Hide = every mesh under the root (root.visible is rewritten every frame)
    const meshes = []; act.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
    const wasVis = meshes.map((m) => m.visible);
    const meshCount = meshes.length;
    R.render(0); const fg = read(x0, y0, W, H);
    meshes.forEach((m) => { m.visible = false; }); R.render(0); const bg = read(x0, y0, W, H);
    meshes.forEach((m, i) => { m.visible = wasVis[i]; });
    R.render(0);
    const F = fg.img.data, G = bg.img.data, N = W * H;
    let m = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const dr = F[i * 4] - G[i * 4], dg = F[i * 4 + 1] - G[i * 4 + 1], db = F[i * 4 + 2] - G[i * 4 + 2];
      const d = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
      if (d < 20) continue;
      // a cast shadow only darkens the ground in its own hue: colour direction unchanged, never brighter
      const fs = F[i * 4] + F[i * 4 + 1] + F[i * 4 + 2], gs = G[i * 4] + G[i * 4 + 1] + G[i * 4 + 2];
      const dot = F[i * 4] * G[i * 4] + F[i * 4 + 1] * G[i * 4 + 1] + F[i * 4 + 2] * G[i * 4 + 2];
      const nf = Math.hypot(F[i * 4], F[i * 4 + 1], F[i * 4 + 2]) || 1, ng = Math.hypot(G[i * 4], G[i * 4 + 1], G[i * 4 + 2]) || 1;
      if (fs < gs && dot / (nf * ng) > 0.997) continue;
      m[i] = 1;
    }
    // 3x3 majority opening (drops lone shadow/AA pixels) then a 1 px erosion for the core
    const open = new Uint8Array(N), core = new Uint8Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let n = 0, all4 = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += m[(y + dy) * W + x + dx];
      if (m[y * W + x] && n >= 5) open[y * W + x] = 1;
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (open[i] && open[i - 1] && open[i + 1] && open[i - W] && open[i + W]) core[i] = 1;
    }
    // largest connected component of `open` (the body; stray VFX or shadow islands drop out)
    const lab_ = new Int32Array(N); let best = 0, bestId = 0, cur = 0;
    for (let s = 0; s < N; s++) {
      if (!open[s] || lab_[s]) continue;
      cur++; let n = 0; const st = [s]; lab_[s] = cur;
      while (st.length) { const p = st.pop(); n++; for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < N && open[q] && !lab_[q]) { lab_[q] = cur; st.push(q); } }
      if (n > best) { best = n; bestId = cur; }
    }
    let y1 = -1, y2 = -1;
    for (let i = 0; i < N; i++) if (lab_[i] === bestId && core[i]) { const y = (i / W) | 0; if (y1 < 0) y1 = y; y2 = y; }
    const res = { id, def: e.def, team: e.team, meshes: meshCount, silPx: best, seen: best > 400 && y1 >= 0 };
    if (res.seen) {
      const hgt = y2 - y1 + 1; res.heightPx = hgt;
      const sel = (r0, r1) => { const px = []; for (let y = Math.floor(y1 + r0 * hgt); y < Math.ceil(y1 + r1 * hgt); y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (core[i] && lab_[i] === bestId) px.push(i); } return px; };
      const stat = (px) => {
        const L = [], A = [], Bb = [], R_ = [], G_ = [], B_ = [];
        for (const i of px) { const l = lab(F[i * 4], F[i * 4 + 1], F[i * 4 + 2]); L.push(l[0]); A.push(l[1]); Bb.push(l[2]); R_.push(F[i * 4]); G_.push(F[i * 4 + 1]); B_.push(F[i * 4 + 2]); }
        const l = med(L), aa = med(A), bb = med(Bb), rgb = [med(R_), med(G_), med(B_)];
        const hs = hsv(...rgb);
        return { n: px.length, lab: [l, aa, bb].map((v) => +v.toFixed(1)), C: +Math.hypot(aa, bb).toFixed(1), h: +((Math.atan2(bb, aa) * 180 / Math.PI + 360) % 360).toFixed(1), rgb, hsv: [+hs[0].toFixed(1), +hs[1].toFixed(3), +hs[2].toFixed(3)], meanL: +(L.reduce((s, v) => s + v, 0) / (L.length || 1)).toFixed(1) };
      };
      const top = sel(0, 0.25), mid = sel(0.25, 0.75), bot = sel(0.75, 1.01), cr = sel(0, 0.12), sh = sel(0.12, 0.24);
      res.top = stat(top); res.mid = stat(mid); res.bottom = stat(bot);
      res.valueBandsSpatial = { top: res.top.meanL, mid: res.mid.meanL, bottom: res.bottom.meanL };
      // tokens.json fighter.valueLstar convention (value_probe.mjs): the brightest / middle / darkest quarter of the fighter's pixels
      const allL = []; for (let i = 0; i < N; i++) if (core[i] && lab_[i] === bestId) allL.push(lab(F[i * 4], F[i * 4 + 1], F[i * 4 + 2])[0]);
      allL.sort((x, y) => x - y);
      const avg = (a0, a1) => { const sl = allL.slice(Math.floor(a0 * allL.length), Math.ceil(a1 * allL.length)); return +(sl.reduce((q, v) => q + v, 0) / (sl.length || 1)).toFixed(1); };
      res.valueBands = { top: avg(0.75, 1), mid: avg(0.25, 0.75), bottom: avg(0, 0.25) };
      const c1 = stat(cr), c2 = stat(sh);
      let dh = Math.abs(((c1.h - c2.h + 540) % 360) - 180);
      if (Math.min(c1.C, c2.C) < 12) dh = 0;
      const dL = Math.abs(c1.lab[0] - c2.lab[0]);
      res.crown = { lab: c1.lab, C: c1.C, h: c1.h, hsv: c1.hsv, shoulders: c2.lab, dL: +dL.toFixed(1), dHue: +dh.toFixed(1), break: dL >= 8 || dh >= 20 };
      // the share of top-cluster pixels in each reserved HSV band (S >= 0.4 and V >= 0.35: a saturated read)
      let nA = 0, nH = 0, nE = 0;
      for (const i of top) { const [h, s, v] = hsv(F[i * 4], F[i * 4 + 1], F[i * 4 + 2]); if (s >= 0.4 && v >= 0.35) { if (h >= 200 && h <= 225) nA++; if (h >= 28 && h <= 50) nH++; if (h >= 125 && h <= 150) nE++; } }
      res.topBandShare = { ally: +(nA / top.length).toFixed(3), harm: +(nH / top.length).toFixed(3), heal: +(nE / top.length).toFixed(3) };
      // crop for the sheet: fighter on a neutral cell, the rest masked to the ground
      res.crop = fg.url();
      res.crown.hsvTop = res.top.hsv;
    }
    out.push(res);
  }
  return out;
};

const matchWaits = async (page) => {
  for (let i = 0; i < 120; i++) {                       // ModelLibrary.pending == 0, then a few frames
    const p = await B(page, (b) => b.renderer.lib?.pending ?? 0);
    if (p === 0) break;
    await page.waitForTimeout(1000);
  }
  await B(page, (b) => { b.frames(30, 1 / 30); });
};

const runs = [];                                        // one entry per fighter per match
const errors = [];
const startRun = async (seed, seating, half) => {
  const list = FIGHTERS.map((_, i) => FIGHTERS[(i + seating * 5) % 16]);
  const seats = half === 0 ? list.slice(0, 10) : list.slice(6, 16);
  const want = (half === 0 ? list.slice(0, 10) : list.slice(10, 16)).filter((f) => !only || only.split(',').includes(f));
  if (!want.length) return;
  const { browser, page, logs } = await openBench({ q, t: 4, mode, seed, extra: `&picks=${seats.join(',')}`, land: 1500 });
  try {
    await matchWaits(page);
    // spectator + fog off: every seat is in view whatever its team
    await B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; b.frames(6, 1 / 30); });
    const ents = await B(page, (b) => b.entities('fighter'));
    const ids = want.map((f) => ents.find((e) => e.def === f)?.id);
    const missing = want.filter((_, i) => ids[i] === undefined);
    if (missing.length) errors.push({ seed, seating, half, missing });
    const got = await page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, a), [measurePage.toString(), { ids: ids.filter((x) => x !== undefined), zoom }]);
    for (const r of got) runs.push({ seed, seating, half, ...r });
    if (logs.length) errors.push({ seed, seating, half, page: logs.slice(0, 3) });
  } finally { await browser.close(); }
  console.log(`run seed ${seed} seating ${seating} half ${half}: ${want.length} fighters, ${((Date.now() - t0) / 1000) | 0} s, load ${load()}`);
};

for (const seed of seeds) for (let s = 0; s < nSeatings; s++) for (const half of [0, 1]) {
  try { await startRun(seed, s, half); } catch (e) { errors.push({ seed, seating: s, half, error: String(e.message ?? e).slice(0, 300) }); console.log('run failed', seed, s, half, String(e.message ?? e).slice(0, 200)); }
}

// ---- aggregate ----
const median = (v) => { const s = [...v].sort((x, y) => x - y); return s[s.length >> 1]; };
const hdiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const per = {};
for (const f of FIGHTERS) {
  const rs = runs.filter((r) => r.def === f);
  const seen = rs.filter((r) => r.seen);
  per[f] = { runs: rs.length, seenRuns: seen.length, emptyRuns: rs.length - seen.length };
  if (!seen.length) continue;
  const mt = (k) => median(seen.map((r) => r.top[k]));
  per[f].topLab = [0, 1, 2].map((i) => +median(seen.map((r) => r.top.lab[i])).toFixed(1));
  per[f].topC = +Math.hypot(per[f].topLab[1], per[f].topLab[2]).toFixed(1);
  per[f].topH = +((Math.atan2(per[f].topLab[2], per[f].topLab[1]) * 180 / Math.PI + 360) % 360).toFixed(1);
  per[f].topHsv = [0, 1, 2].map((i) => +median(seen.map((r) => r.top.hsv[i])).toFixed(3));
  per[f].crownHsv = [0, 1, 2].map((i) => +median(seen.map((r) => r.crown.hsv[i])).toFixed(3));
  per[f].valueBands = Object.fromEntries(['top', 'mid', 'bottom'].map((k) => [k, +median(seen.map((r) => r.valueBands[k])).toFixed(1)]));
  per[f].valueBandsMinMax = Object.fromEntries(['top', 'mid', 'bottom'].map((k) => [k, [Math.min(...seen.map((r) => r.valueBands[k])), Math.max(...seen.map((r) => r.valueBands[k]))].map((v) => +v.toFixed(1))]));
  per[f].crown = { dL: +median(seen.map((r) => r.crown.dL)).toFixed(1), dHue: +median(seen.map((r) => r.crown.dHue)).toFixed(1), breakRuns: seen.filter((r) => r.crown.break).length };
  per[f].crown.break = per[f].crown.dL >= 8 || per[f].crown.dHue >= 20;
  per[f].bandShare = { ally: +Math.max(...seen.map((r) => r.topBandShare.ally)).toFixed(3), harm: +Math.max(...seen.map((r) => r.topBandShare.harm)).toFixed(3), heal: +Math.max(...seen.map((r) => r.topBandShare.heal)).toFixed(3) };
  per[f].heightPx = median(seen.map((r) => r.heightPx));
  void mt;
}
const fails = [];
// P1 pairs: min over every run pair (lighting), conditions on C >= 15 and hue < 30 deg
const pairs = [];
for (let i = 0; i < FIGHTERS.length; i++) for (let j = i + 1; j < FIGHTERS.length; j++) {
  const A = runs.filter((r) => r.def === FIGHTERS[i] && r.seen), Bq = runs.filter((r) => r.def === FIGHTERS[j] && r.seen);
  if (!A.length || !Bq.length) continue;
  let minE = Infinity, minH = Infinity, hit = null;
  for (const a of A) for (const b of Bq) {
    const e = dE(a.top.lab, b.top.lab), h = hdiff(a.top.h, b.top.h);
    minE = Math.min(minE, e); minH = Math.min(minH, h);
    if (e < 25 && h < 30 && a.top.C >= 15 && b.top.C >= 15 && !hit) hit = { dE: +e.toFixed(1), dHue: +h.toFixed(1), runA: `${a.seed}/${a.seating}`, runB: `${b.seed}/${b.seating}` };
  }
  const mA = per[FIGHTERS[i]], mB = per[FIGHTERS[j]];
  const medE = dE(mA.topLab, mB.topLab), medH = hdiff(mA.topH, mB.topH);
  pairs.push({ a: FIGHTERS[i], b: FIGHTERS[j], dEMin: +minE.toFixed(1), dHueMin: +minH.toFixed(1), dEMedian: +medE.toFixed(1), dHueMedian: +medH.toFixed(1), fail: !!hit, worst: hit });
  if (hit) fails.push({ gate: 'P1 pair', a: FIGHTERS[i], b: FIGHTERS[j], ...hit });
}
pairs.sort((x, y) => x.dEMin - y.dEMin);
for (const f of FIGHTERS) {
  const p = per[f];
  if (!p.seenRuns) { fails.push({ gate: 'capture', fighter: f, why: 'no run saw the fighter' }); continue; }
  const [h, s, v] = p.topHsv, [ch, cs] = p.crownHsv;
  const inBand = (hh, ss, band) => ss >= 0.4 && hh >= band[0] && hh <= band[1];
  p.inAlly = inBand(h * 1, s, ALLY) || inBand(ch, cs, ALLY);
  p.inHarm = inBand(h, s, HARM) || inBand(ch, cs, HARM);
  p.inHeal = inBand(h, s, HEAL) || inBand(ch, cs, HEAL);
  if (p.inAlly) fails.push({ gate: 'P2 ally band', fighter: f, topHsv: p.topHsv, crownHsv: p.crownHsv });
  if (p.inHarm) fails.push({ gate: 'P2 enemy/harm band', fighter: f, topHsv: p.topHsv, crownHsv: p.crownHsv });
  p.valueBottomOk = p.valueBands.bottom >= BAND.bottom[0] && p.valueBands.bottom <= BAND.bottom[1];   // reported only: the 1-px ink outline and cast shadows sit in the darkest quarter
  p.valueMidOk = p.valueBands.mid >= BAND.mid[0] && p.valueBands.mid <= BAND.mid[1];                // reported only
  p.valueOk = p.valueBands.top >= BAND.top[0] && p.valueBands.top <= BAND.top[1];                    // tokens.json: gate = top25 70-85
  if (!p.valueOk) fails.push({ gate: 'P3 value band (top25)', fighter: f, valueBands: p.valueBands, bible: BAND.top });
  if (!p.crown.break) fails.push({ gate: 'P4 crown break', fighter: f, crown: p.crown });
}
// optional: lineup_qa facing 0/180 crown + value (Blender) merged in
let lineup = null;
const lp = arg('lineup', '');
if (lp && existsSync(lp)) {
  const J = JSON.parse(readFileSync(lp, 'utf8'));
  lineup = {};
  for (const [nm, fi] of Object.entries(J.fighters ?? {})) {
    const f0 = fi.facings?.['0'], f180 = fi.facings?.['180'];
    lineup[nm] = { crownBreak0: f0?.crown?.break ?? null, crownBreak180: f180?.crown?.break ?? null, valueBands0: f0?.valueBands ?? null, sigPct0: f0?.sigPct ?? null };
    if (per[nm] && (f0?.crown?.break === false || f180?.crown?.break === false)) fails.push({ gate: 'P4 crown break (lineup facing 0/180)', fighter: nm, lineup: lineup[nm] });
  }
}
const known = {
  'Vashil-Dunsom dE 6.3': (() => { const p = pairs.find((x) => [x.a, x.b].sort().join() === 'dunsom,vashil'); return p ? { dEMin: p.dEMin, dEMedian: p.dEMedian, fail: p.fail } : null; })(),
  'Ardit helm in the ally band': per.ardit ? { topHsv: per.ardit.topHsv, crownHsv: per.ardit.crownHsv, inAlly: per.ardit.inAlly } : null,
};
const report = {
  gate: 'units_gate', tag, pass: fails.length === 0 && !errors.some((e) => e.error), seeds, seatings: nSeatings, q, mode, zoom,
  load1: load(), seconds: Math.round((Date.now() - t0) / 1000), bands: { ally: ALLY, harmEnemy: HARM, heal: HEAL, valueLstar: BAND },
  fails, knownOnHead: known, fighters: per, pairsWorst10: pairs.slice(0, 10), pairs, lineup, errors,
  runs: runs.map(({ crop, ...r }) => r),
};
writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(report, null, 1));

// ---- contact sheet: one cell per fighter (its best-lit run), in a page ----
try {
  const cells = FIGHTERS.map((f) => { const r = runs.filter((x) => x.def === f && x.seen).sort((a, b) => b.silPx - a.silPx)[0]; return { f, url: r?.crop, p: per[f] }; });
  const { chromium } = await import('playwright-core');
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await br.newPage({ viewport: { width: 880, height: 1100 } });
  const png = await pg.evaluate(async (cs) => {
    const cw = 220, ch = 340, cols = 4, rows = Math.ceil(cs.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch;
    const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < cs.length; i++) {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch, k = cs[i];
      if (k.url) { const im = new Image(); im.src = k.url; await im.decode(); g.drawImage(im, x, y, 220, 270); }
      const p = k.p;
      g.fillStyle = '#fff'; g.font = '13px sans-serif'; g.fillText(k.f, x + 6, y + 276);
      g.font = '11px sans-serif';
      if (p?.topLab) {
        const rgb = `hsl(0 0% 0%)`; void rgb;
        g.fillText(`top L ${p.topLab[0]} C ${p.topC} h ${p.topH}`, x + 6, y + 292);
        g.fillText(`HSV ${p.topHsv[0]} ${p.topHsv[1]} ${p.topHsv[2]}`, x + 6, y + 306);
        g.fillText(`crown dL ${p.crown.dL} dH ${p.crown.dHue} ${p.crown.break ? 'BREAK' : 'NO BREAK'}`, x + 6, y + 320);
        g.fillText(`L* ${p.valueBands.top}/${p.valueBands.mid}/${p.valueBands.bottom}`, x + 6, y + 334);
      }
    }
    return c.toDataURL('image/png').split(',')[1];
  }, cells);
  await br.close();
  writeFileSync(`${OUT}/${tag}_sheet.png`, Buffer.from(png, 'base64'));
} catch (e) { console.log('sheet failed', String(e.message ?? e).slice(0, 200)); }

console.log(JSON.stringify({ pass: report.pass, fails: fails.length, seconds: report.seconds, known }, null, 1));
for (const f of fails) console.log('FAIL', JSON.stringify(f));
process.exit(report.pass ? 0 : errors.some((e) => e.error) && !runs.length ? 2 : 1);
