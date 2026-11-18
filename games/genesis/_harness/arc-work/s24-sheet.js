// SESSION 24 (verify hill sheet): CPU re-evaluation of the terrain and water vertex heights of every drawn patch (same
// formula as terrainvert.glsl tGround, linear level, no geomorph), projected with the live camera and z-buffered into a
// 48x27 screen grid: per bin the nearest terrain vertex and the nearest water vertex, their heights above sea level and
// the sim cell (max weight) under them. Run with probe-s21 --eval.
(() => {
  const R = globalThis.__GENESIS_R__;
  const pvis = R.planets.get(R.primaryId) ?? [...R.planets.values()][0];
  const lod = pvis.lod, ft = pvis.fields.tex;
  const A = ft.A.image.data, G = ft.G.image.data, D = ft.D.image.data;
  const Rad = lod.radius, sea = pvis.pv.params.seaLevel, CA = 0.75;
  const cam = R.camera;
  const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).multiply(pvis.group.matrixWorld);
  const e = M.elements;
  const W = 48, H = 27;
  const tb = new Array(W * H).fill(null), wb = new Array(W * H).fill(null);
  const fl = pvis.pv.fields, sal = fl.get('salinity'), wat = fl.get('water'), srf = fl.get('surface');
  let nP = 0, nW = 0;
  const put = (buf, x, y, z, rec) => {
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0.1) return;
    const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw, ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
    if (nx < -1 || nx >= 1 || ny < -1 || ny >= 1) return;
    const bx = Math.floor((nx + 1) / 2 * W), by = Math.floor((1 - ny) / 2 * H), k = by * W + bx;
    if (!buf[k] || buf[k].d > cw) { rec.d = cw; buf[k] = rec; }
  };
  for (const p of lod.selected) {
    const r = lod.tcRange(p);
    if (!r) continue;
    nP++;
    const water = p.hasWater; if (water) nW++;
    const geo = r.mesh.geometry, pos = geo.attributes.position.array, ac = geo.attributes.aCells.array, am = geo.attributes.aMisc.array;
    const idx = geo.index.array, seen = new Set();
    for (let i = r.indexStart; i < r.indexStart + r.indexCount; i++) seen.add(idx[i]);
    for (const v of seen) {
      if (am[v * 4 + 2] > 0) continue; // skirt
      const dx = pos[v * 3], dy = pos[v * 3 + 1], dz = pos[v * 3 + 2];
      const cs = [ac[v * 4], ac[v * 4 + 1], ac[v * 4 + 2]].map((c) => Math.round(c));
      const wB = ac[v * 4 + 3], wC = am[v * 4], ws = [1 - wB - wC, wB, wC];
      let ax = 0, ay = 0, az = 0, aw = 0, bend = 0, dA = 0, best = 0;
      for (let j = 0; j < 3; j++) {
        const c = cs[j], w = ws[j];
        ax += A[c * 4] * w; ay += A[c * 4 + 1] * w; az += A[c * 4 + 2] * w; aw += A[c * 4 + 3] * w;
        bend += (G[c * 4] * dx + G[c * 4 + 1] * dy + G[c * 4 + 2] * dz + G[c * 4 + 3]) * w;
        dA += D[c * 4] * w;
        if (w > ws[best]) best = j;
      }
      const g = ax + CA * Rad * bend + am[v * 4 + 1] * ay + am[v * 4 + 3] * dA;
      const c = cs[best];
      const cell = { c, s: +A[c * 4].toFixed(1), wl: +A[c * 4 + 2].toFixed(1), wd: +A[c * 4 + 3].toFixed(1), sal: sal ? +sal[c].toFixed(2) : null };
      put(tb, dx * (Rad + g), dy * (Rad + g), dz * (Rad + g), { g: g - sea, chord: ax - sea, lvl: az - sea, simD: aw, cell, lev: p.level });
      if (water) put(wb, dx * (Rad + az), dy * (Rad + az), dz * (Rad + az), { h: az - sea, g: g - sea, simD: aw, cell, lev: p.level });
    }
  }
  // maps: visible class, terrain height above sea (10 m bands), water height above sea
  const ch = (v) => (v == null ? ' ' : v < -10 ? '#' : v < -2 ? '=' : v < 0 ? '-' : v < 5 ? '0' : v < 20 ? '1' : v < 50 ? '2' : '3');
  const vis = [], tmap = [], wmap = [], dmap = [];
  for (let y = 0; y < H; y++) {
    let a = '', b = '', c = '', d = '';
    for (let x = 0; x < W; x++) {
      const t = tb[y * W + x], w = wb[y * W + x];
      a += !t && !w ? '.' : w && (!t || w.d < t.d) ? 'W' : 'T';
      b += t ? ch(t.g) : ' ';
      c += w ? ch(w.h) : ' ';
      d += t ? ch(t.lvl) : ' ';
    }
    vis.push(a); tmap.push(b); wmap.push(c); dmap.push(d);
  }
  const rows = (lo, hi, fn) => { const out = []; for (let y = lo; y < hi; y++) for (let x = 0; x < W; x++) { const r = fn(x, y); if (r) out.push(r); } return out; };
  const stat = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return { n: s.length, min: +s[0].toFixed(1), p10: +s[Math.floor(s.length * 0.1)].toFixed(1), med: +s[s.length >> 1].toFixed(1), p90: +s[Math.floor(s.length * 0.9)].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };
  // per screen row band: terrain g of the visible-terrain bins, water h of the visible-water bins
  const bands = [];
  for (let y = 0; y < H; y += 3) {
    const tg = [], wh = [], wg = [];
    for (let yy = y; yy < Math.min(H, y + 3); yy++) for (let x = 0; x < W; x++) {
      const t = tb[yy * W + x], w = wb[yy * W + x];
      if (t) tg.push(t.g);
      if (w && (!t || w.d < t.d + 1)) { wh.push(w.h); wg.push(w.g); }
    }
    bands.push({ rows: `${y}-${y + 2}`, terrainG: stat(tg), waterH: stat(wh), groundUnderWater: stat(wg) });
  }
  // sample column x = 36 (the right hump) and x = 28: per row, terrain / water record
  const col = (x) => rows(0, H, (xx, y) => (xx !== x ? null : { y, t: tb[y * W + x] && { d: +tb[y * W + x].d.toFixed(0), g: +tb[y * W + x].g.toFixed(1), chord: +tb[y * W + x].chord.toFixed(1), lvl: +tb[y * W + x].lvl.toFixed(1), simD: +tb[y * W + x].simD.toFixed(1), cell: tb[y * W + x].cell }, w: wb[y * W + x] && { d: +wb[y * W + x].d.toFixed(0), h: +wb[y * W + x].h.toFixed(1) } }));
  const S = globalThis.__GENESIS_FX__?.fx?.screenState; const fog = S ? { density: S.fogDensity, scale: S.fogScale, col: [S.fogCol.x, S.fogCol.y, S.fogCol.z].map((v) => +v.toFixed(4)) } : null;
  return { fog, sea, Rad, nP, nW, tick: globalThis.__GENESIS__.state().tick, vis, terrainHeight: tmap, waterHeight: wmap, levelAtTerrain: dmap, bands, col36: col(36), col28: col(28), col12: col(12) };
})()
