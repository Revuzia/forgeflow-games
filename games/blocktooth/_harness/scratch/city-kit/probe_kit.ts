// city-kit lane probe: builds the kit for every REAL biome under node and checks the
// geometry contract (CONTRACT §6 table): unit space for base/floor, faceted non-indexed
// geometry, finite numbers, tri budgets, prop orientation/height, dispose().
// Run: node _harness/scratch/city-kit/probe_kit.ts
import { buildCityKit } from '../../../src/city/meshkit.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { PROP_INFO } from '../../../src/city/citygen.ts';
import type { BiomeId, PropKind } from '../../../src/core/types.ts';
import type * as THREE from 'three';

let fails = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };

function stats(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  const f = g.getAttribute('aFac');
  const o = g.getAttribute('outlineNormal');
  let bad = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = p.getComponent(i, k);
      if (!Number.isFinite(v)) bad++;
      mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v);
    }
    const nl = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    if (!(Math.abs(nl - 1) < 1e-3)) bad++;
    if (!Number.isFinite(c.getX(i) + c.getY(i) + c.getZ(i))) bad++;
  }
  // winding agrees with the stored face normal (faceted by construction)
  let wind = 0;
  for (let t = 0; t < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const ux = p.getX(t + 1) - ax, uy = p.getY(t + 1) - ay, uz = p.getZ(t + 1) - az;
    const vx = p.getX(t + 2) - ax, vy = p.getY(t + 2) - ay, vz = p.getZ(t + 2) - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n.getX(t) + cy * n.getY(t) + cz * n.getZ(t) < 0) wind++;
    // flat: all 3 normals equal
    if (n.getX(t) !== n.getX(t + 1) || n.getY(t) !== n.getY(t + 2)) wind++;
  }
  return { tris: p.count / 3, bad, wind, indexed: !!g.index, hasFac: !!f, hasOutline: !!o, mn, mx };
}

const fmt = (a: number[]) => a.map((v) => v.toFixed(2)).join(',');
let totalTris = 0;
let maxOv = 0;
for (const id of Object.keys(BIOMES) as BiomeId[]) {
  const b = BIOMES[id];
  const t0 = process.hrtime.bigint();
  const kit = buildCityKit(b);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let biomeTris = 0;
  console.log(`\n== ${id}: built in ${ms.toFixed(0)} ms`);
  for (const a of b.archetypes) {
    const m = kit.arch[a.id];
    if (!m) { fail(`${id}/${a.id} missing`); continue; }
    const row: string[] = [];
    for (const piece of ['base', 'floor', 'roof'] as const) {
      const s = stats(m[piece]);
      biomeTris += s.tris;
      row.push(`${piece} ${s.tris}t y[${s.mn[1].toFixed(2)},${s.mx[1].toFixed(2)}] xz[${s.mn[0].toFixed(2)}..${s.mx[0].toFixed(2)}|${s.mn[2].toFixed(2)}..${s.mx[2].toFixed(2)}]`);
      if (s.bad) fail(`${id}/${a.id}/${piece} ${s.bad} non-finite/unnormalised values`);
      if (s.wind) fail(`${id}/${a.id}/${piece} ${s.wind} winding/flat mismatches`);
      if (s.indexed) fail(`${id}/${a.id}/${piece} indexed`);
      if (!s.hasFac || !s.hasOutline) fail(`${id}/${a.id}/${piece} missing aFac/outlineNormal`);
      // CONTRACT §6: unit space. Documented kit tolerances (meshkit.ts header): decorative
      // overhangs (awnings, canopies, balconies, fire escapes, blade signs, bogies) may reach
      // 0.06 unit past ±0.5 over the parcel setback; shells that WRAP the storeys above (podium
      // terrace, dish plinth kit, cooling-tower flare) may rise to y = 3.01 in the base (self-roofing
      // one-storey bases: < 2); the
      // cooling crown / gantry hook may hang to y = −3.01 below the roof storey.
      const ov = Math.max(-0.5 - s.mn[0], s.mx[0] - 0.5, -0.5 - s.mn[2], s.mx[2] - 0.5);
      if (ov > 0.0601) fail(`${id}/${a.id}/${piece} xz overhang ${ov.toFixed(3)} > 0.06`);
      maxOv = Math.max(maxOv, ov);
      const wraps = a.shape === 'podium' || a.shape === 'dish' || a.shape === 'cylinder';
      if (piece === 'floor' && (s.mn[1] < -0.001 || s.mx[1] > 1.001)) fail(`${id}/${a.id}/floor y outside [0,1]: ${s.mn[1]}..${s.mx[1]}`);
      // archetypes that can stand one storey tall carry their own roof kit on the base slab; it
      // must fit inside the storey above (hidden there when n ≥ 2)
      const selfRoof = a.floors[0] === 1;
      if (piece === 'base' && (s.mn[1] < -0.001 || s.mx[1] > (wraps ? 3.01 : selfRoof ? 1.999 : 1.001))) fail(`${id}/${a.id}/base y ${s.mn[1]}..${s.mx[1]}`);
      if (piece === 'roof' && s.mn[1] < -3.01) fail(`${id}/${a.id}/roof dips below −3 storeys: ${s.mn[1]}`);
      if (s.tris > 900) fail(`${id}/${a.id}/${piece} ${s.tris} tris (budget ~400, hard 900)`);
    }
    console.log(`  ${a.id.padEnd(18)} ${a.shape.padEnd(10)} ${row.join(' · ')}`);
  }
  for (const kind of Object.keys(kit.props) as PropKind[]) {
    const pm = kit.props[kind];
    const s = stats(pm.geo);
    biomeTris += s.tris;
    const info = PROP_INFO[kind];
    const len = s.mx[2] - s.mn[2], wid = s.mx[0] - s.mn[0];
    console.log(`  prop ${kind.padEnd(10)} ${String(s.tris).padStart(4)}t  h=${pm.height.toFixed(2)}  len(z)=${len.toFixed(2)} (info ${info.len})  wid(x)=${wid.toFixed(2)} (info ${info.wid})  minY=${s.mn[1].toFixed(2)}`);
    if (s.bad) fail(`${id}/prop ${kind} ${s.bad} bad values`);
    if (s.wind) fail(`${id}/prop ${kind} ${s.wind} winding mismatches`);
    if (s.tris > 600) fail(`${id}/prop ${kind} ${s.tris} tris > 600`);
    if (s.mn[1] < -0.01) fail(`${id}/prop ${kind} below ground ${s.mn[1]}`);
    if (!(pm.height > 0.2)) fail(`${id}/prop ${kind} height ${pm.height}`);
    if (kind !== 'tree' && kind !== 'pylon' && kind !== 'lamp' && kind !== 'signpost' && (len > info.len * 1.35 + 0.4 || wid > info.wid * 1.35 + 0.4)) fail(`${id}/prop ${kind} footprint ${len.toFixed(2)}x${wid.toFixed(2)} vs PROP_INFO ${info.len}x${info.wid}`);
  }
  const rs = stats(kit.rubble);
  biomeTris += rs.tris;
  console.log(`  rubble ${rs.tris}t min[${rs.mn.map((v) => v.toFixed(4)).join(',')}] max[${rs.mx.map((v) => v.toFixed(4)).join(',')}]`);
  if (rs.bad || rs.wind) fail(`${id}/rubble bad=${rs.bad} wind=${rs.wind}`);
  if (rs.mn[0] < -0.5001 || rs.mx[0] > 0.5001 || rs.mn[2] < -0.5001 || rs.mx[2] > 0.5001 || rs.mx[1] > 1.001 || rs.mx[1] < 0.999 || rs.mn[1] < -0.02) fail(`${id}/rubble outside unit box / top not at 1`);
  for (const k of ['road', 'sidewalk', 'plaza', 'lot'] as const) if (!kit.ground[k]) fail(`${id}/ground ${k} missing`);
  if (!kit.facade) fail(`${id}/facade missing`);
  console.log(`  total ${biomeTris} tris`);
  totalTris += biomeTris;
  kit.dispose();
  kit.dispose();   // idempotent
}
console.log(`\nmax decorative overhang ${maxOv.toFixed(3)} unit`);
console.log(`ALL BIOMES ${totalTris} tris; ${fails ? fails + ' FAILURES' : 'PASS'}`);
process.exit(fails ? 1 : 0);
