/* Data lane: per course, what sits in the spawn frame's corridor.
 *  - coins BEHIND the spawn (between hero and the 6.8 m camera) -> foreground pancakes
 *  - rings / large objects within 12 m of the spawn
 *  - is there a text sign within 6 m of the spawn?
 * node _harness/_data_spawnscan.mjs */
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = await import(pathToFileURL(path.join(ROOT, 'runtime/data/index.js')).href);
const ids = ['keep', ...idx.ALL_COURSE_IDS];
const v3 = (a) => Array.isArray(a) ? a : [a.x, a.y, a.z];
function expandCoins(list) {
  const out = [];
  for (const c of list || []) {
    if (!c) continue;
    if (c.ring) { const r = c.ring, ctr = v3(r.c), n = Math.max(1, r.n | 0 || 8), rad = r.r || 2; const y = Number.isFinite(r.y) ? r.y : ctr[1]; const a0 = Number.isFinite(r.from) ? r.from : 0;
      for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; out.push([ctr[0] + Math.cos(a) * rad, y, ctr[2] + Math.sin(a) * rad]); } }
    else if (c.arc) { const r = c.arc, ctr = v3(r.c), n = Math.max(1, r.n | 0 || 6), rad = r.r || 2; const y = Number.isFinite(r.y) ? r.y : ctr[1]; const a0 = Number.isFinite(r.from) ? r.from : 0; const a1 = Number.isFinite(r.to) ? r.to : Math.PI;
      for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * (n === 1 ? 0 : i / (n - 1)); out.push([ctr[0] + Math.cos(a) * rad, y, ctr[2] + Math.sin(a) * rad]); } }
    else if (c.line) { const l = c.line, a = v3(l.a), b = v3(l.b), n = Math.max(2, l.n | 0 || 5);
      for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); } }
    else if (c.grid) { const g = c.grid, o = v3(g.p), nx = Math.max(1, g.nx | 0 || 3), nz = Math.max(1, g.nz | 0 || 3); const sx = g.dx || 2, sz = g.dz || 2;
      for (let j = 0; j < nz; j++) for (let i2 = 0; i2 < nx; i2++) out.push([o[0] + i2 * sx, o[1], o[2] + j * sz]); }
    else out.push(v3(c.p !== undefined ? c.p : c));
  }
  return out;
}
for (const id of ids) {
  const file = id === 'keep' ? 'runtime/data/keep.js' : `runtime/data/courses/${id}.js`;
  const def = (await import(pathToFileURL(path.join(ROOT, file)).href)).default;
  const cp0 = (def.checkpoints && def.checkpoints[0]) || def.spawn;
  const sp = v3(cp0.p), yaw = cp0.yaw || 0;
  const f = [-Math.sin(yaw), -Math.cos(yaw)], r = [Math.cos(yaw), -Math.sin(yaw)];
  const rel = (p) => { const dx = p[0] - sp[0], dz = p[2] - sp[2]; return { ahead: dx * f[0] + dz * f[1], side: dx * r[0] + dz * r[1], up: p[1] - sp[1], d: Math.hypot(dx, p[1] - sp[1], dz) }; };
  const coins = expandCoins(def.coins);
  const inCorridor = (q) => q.ahead < -0.5 && q.ahead > -9.5 && Math.abs(q.side) < 3.0 && q.up > -1.5 && q.up < 4;
  const behind = coins.map(rel).filter(inCorridor).length;
  // which coin DEFS put coins in the corridor (index into def.coins + the spec)
  const corridorDefs = [];
  (def.coins || []).forEach((c, ci) => {
    const pts = expandCoins([c]);
    const hits = pts.map(rel).filter(inCorridor);
    if (hits.length) corridorDefs.push(`coins[${ci}] ${JSON.stringify(c).slice(0, 110)} -> ${hits.length} in corridor (ahead ${hits.map(q => q.ahead.toFixed(1)).join(',')})`);
  });
  const near = [];
  for (const o of def.objects || []) {
    if (!o) continue;
    if (o.kind === 'rings') { o.pts.forEach((p, i) => { const q = rel(p); if (q.d < 12) near.push(`ring[${i}] ${p.map(v=>+v.toFixed(1))} d=${q.d.toFixed(1)}`); }); continue; }
    const p = o.p || o.a; if (!p) continue;
    const q = rel(v3(p));
    const big = o.s ? Math.max(...o.s) : (o.h || o.r || o.len || 0);
    if (q.d < 12 && q.up > 2.0 && big >= 2.0 && o.kind !== 'text' && o.kind !== 'light')
      near.push(`${o.kind}${o.kindOf ? ':' + o.kindOf : ''} up=${q.up.toFixed(1)} ahead=${q.ahead.toFixed(1)} side=${q.side.toFixed(1)} s=${JSON.stringify(o.s || o.h || o.r)}`);
  }
  const signs = (def.objects || []).filter(o => o && o.kind === 'text' && rel(v3(o.p)).d <= 6.0).map(o => `"${String(o.text).slice(0, 34)}" d=${rel(v3(o.p)).d.toFixed(1)}`);
  console.log(`== ${id}  spawn ${JSON.stringify(sp)} yaw ${yaw.toFixed(2)}  coins ${coins.length}  coinsBehindSpawn(camera corridor) ${behind}`);
  for (const n of near) console.log('   NEAR/OVER:', n);
  for (const n of corridorDefs) console.log('   CORRIDOR:', n);
  console.log('   signs<=6m:', signs.length ? signs.join(' | ') : 'NONE');
}
