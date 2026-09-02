/**
 * Geometry sanity check for CRESTBOUND's Keep. Not a shipped harness — a
 * one-off validator for the authoring pass:
 *   1. every stairs def rises <= TUNE.stepUp per step
 *   2. every painting / gatedoor `p` sits on (or just in front of) a wall face
 *   3. every checkpoint, spawn and gate exit stands on a walkable surface
 *   4. rooms and their floor heights, printed as a table
 */
const KEEP = 'file:///C:/Users/TestRun/Claude%20Claw/forgeflow-games/games/crestbound/runtime/data/keep.js';
const TUNING = 'file:///C:/Users/TestRun/Claude%20Claw/forgeflow-games/games/crestbound/runtime/core/tuning.js';

const def = (await import(KEEP)).default;
const { TUNE } = await import(TUNING);

let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL  ' + m); };

/* ---- 1. stair risers ---------------------------------------------------- */
console.log('\n[1] stairs');
for (const o of def.objects) {
  if (o.kind !== 'stairs') continue;
  const top = o.p[1] + o.n * o.rise;
  const ok = o.rise <= TUNE.stepUp && Math.abs(top - o.top) < 1e-6;
  console.log(`  ${ok ? 'ok  ' : 'BAD '} n=${o.n} rise=${o.rise} run=${o.run} ${o.p[1].toFixed(2)} -> ${top.toFixed(2)} (declared ${o.top})`);
  if (!ok) fail(`stairs at ${o.p} rise ${o.rise} vs stepUp ${TUNE.stepUp}`);
}
/* spiral treads: consecutive platform tops in the SPIRAL band */
const spiral = def.objects.filter((o) => o.kind === 'platform' && o.rot && o.rot[1] !== undefined &&
  Math.hypot(o.p[0] + 13.5, o.p[2] - 7.5) < 3.0 && o.p[1] < 0.2 && o.p[1] > -8.2 && o.s[1] === 0.5);
spiral.sort((a, b) => b.p[1] - a.p[1]);
let worst = 0;
for (let i = 1; i < spiral.length; i++) worst = Math.max(worst, (spiral[i - 1].p[1] - spiral[i].p[1]));
console.log(`  ${worst <= TUNE.stepUp ? 'ok  ' : 'BAD '} spiral: ${spiral.length} treads, max riser ${worst.toFixed(4)} (stepUp ${TUNE.stepUp})`);
if (worst > TUNE.stepUp) fail('spiral riser too tall');

/* ---- 2. gates in front of a wall face ----------------------------------- */
console.log('\n[2] gate / painting placement');
const solids = def.objects.filter((o) => o.kind === 'platform' && !o.rot);
const aabb = (o) => ({
  x0: o.p[0] - o.s[0] / 2, x1: o.p[0] + o.s[0] / 2,
  y0: o.p[1] - o.s[1] / 2, y1: o.p[1] + o.s[1] / 2,
  z0: o.p[2] - o.s[2] / 2, z1: o.p[2] + o.s[2] / 2,
});
const boxes = solids.map(aabb);
/**
 * Is there a WALL PLANE within `d` behind p along `h` (the walk-in heading)?
 * A door sits in an OPENING, so the masonry is beside it, not behind it —
 * probe the tangent as well as the axis and accept a hit within 2.2 m either
 * side at the same depth. A painting hangs ON the face and hits at t = 0.02.
 */
function wallBehind(p, h, d, halfW) {
  const tx = -h[2], tz = h[0];                 // wall tangent
  const j = (halfW || 1.7) + 0.35;             // just past the jamb
  for (let t = 0.02; t <= d; t += 0.05) {
    for (const lat of [0, j, -j]) {
      const q = [p[0] + h[0] * t + tx * lat, p[1], p[2] + h[2] * t + tz * lat];
      for (const b of boxes) {
        if (q[0] >= b.x0 - 1e-6 && q[0] <= b.x1 + 1e-6 && q[1] >= b.y0 && q[1] <= b.y1 &&
            q[2] >= b.z0 - 1e-6 && q[2] <= b.z1 + 1e-6) return t;
      }
    }
  }
  return -1;
}
const heading = (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)];
const allGates = def.gates.concat(
  def.objects.filter((o) => o.kind === 'gatedoor' && !o.course).map((o) => ({ course: o.id, p: o.p, yaw: o.yaw, w: o.w })));
const widthOf = {};
for (const o of def.objects) if ((o.kind === 'painting' || o.kind === 'gatedoor') && o.course) widthOf[o.course] = o.w;
for (const g of allGates) {
  const t = wallBehind(g.p, heading(g.yaw), 1.0, (g.w || widthOf[g.course] || 3.4) / 2);
  const ok = t >= 0;
  console.log(`  ${ok ? 'ok  ' : 'BAD '} ${String(g.course).padEnd(11)} p=[${g.p.map((n) => n.toFixed(2)).join(', ')}] yaw=${g.yaw.toFixed(3)}  wall at ${ok ? t.toFixed(2) + ' m' : 'NONE'}`);
  if (!ok) fail(`gate ${g.course}: no wall face behind it`);
}

/* ---- 3. standing points are supported ----------------------------------- */
console.log('\n[3] standing points');
const T = def.terrain;
/** true if p is over the courtyard heightfield (which stands in for a floor) */
function onLawn(p) {
  return p[0] >= T.origin[0] && p[0] <= T.origin[0] + T.size[0] &&
    p[2] >= T.origin[1] && p[2] <= T.origin[1] + T.size[1];
}
function floorUnder(p) {
  let best = onLawn(p) && p[1] < 3 ? 0.0 : -Infinity;   // lawn flats are all h 0
  for (const b of boxes) {
    if (p[0] < b.x0 - 1e-6 || p[0] > b.x1 + 1e-6) continue;
    if (p[2] < b.z0 - 1e-6 || p[2] > b.z1 + 1e-6) continue;
    if (b.y1 <= p[1] + 0.35 && b.y1 > best) best = b.y1;
  }
  return best;
}
const stands = [{ id: 'spawn', p: def.spawn.p }]
  .concat(def.checkpoints.map((c) => ({ id: c.id, p: c.p })))
  .concat(def.gates.map((g) => ({ id: g.course + ':exit', p: g.exitP })));
for (const s of stands) {
  const f = floorUnder(s.p);
  const drop = s.p[1] - f;
  const ok = Number.isFinite(f) && drop >= -0.01 && drop < 0.4;
  console.log(`  ${ok ? 'ok  ' : 'BAD '} ${s.id.padEnd(18)} feet ${s.p[1].toFixed(2)}  floor ${Number.isFinite(f) ? f.toFixed(2) : 'NONE'}`);
  if (!ok) fail(`${s.id} unsupported`);
}

/* ---- 4. room table ------------------------------------------------------ */
console.log('\n[4] rooms');
const rooms = [
  ['UNDERCROFT', -8.00, -3.20, 'x -17.5..17.5  z -11..11'],
  ['LOBBY HALL', 0.00, 14.00, 'x -20..20  z -13.8..13.8'],
  ['stair landing', 2.70, 5.60, 'x -15.6..15.6  z -15..-8.34'],
  ['GALLERY', 6.30, 11.80, 'loop, 4 m wide, void x -16..16 z -2.82..8.80'],
  ['LONG HALL', 6.30, 11.80, 'x -12..12  z -34.6..-13.8'],
  ['LIBRARY NOOK', 6.30, 10.30, 'x 12..20  z -25.6..-16.4'],
  ['BALCONY', 6.30, null, 'x -4.5..4.5  z 13.8..17.2'],
  ['GARDEN LOFT', 6.30, null, 'x -4.5..4.5  z 23.2..27.2'],
  ['COURTYARD lawn', 0.00, 8.00, 'x -24..26  z 13..48 (heightfield 0..2.2)'],
  ['fountain water', 0.95, null, 'surface; floor -1.30, depth 2.25'],
  ['TOWER shaft', 0.00, 12.60, 'x -18.5..-15.5 (3.00 m)  z 33.2..36.5'],
  ['tower ledges', 3.40, null, 'then 6.60, 9.80, roof 12.60'],
  ['WYRM walk', -7.80, 9.19, 'helix r 4.60, 540 deg, 21.5 deg slope'],
  ['WYRM chute', 9.00, 0.50, 'helix r 1.80, 540 deg, 27 deg slope'],
  ['CRESTWAY vault', 0.00, 7.20, 'x -6.4..6.4  z 49.2..58'],
];
console.log('  room              floor    ceiling  extent');
for (const [n, f, c, e] of rooms) {
  console.log(`  ${n.padEnd(17)} ${String(f.toFixed(2)).padStart(6)}   ${c === null ? '   -  ' : String(c.toFixed(2)).padStart(6)}   ${e}`);
}

/* ---- 5. the balcony gap ------------------------------------------------- */
console.log('\n[5] the one authored jump');
const gap = 23.2 - 17.2;
console.log(`  balcony lip z 17.20 -> loft lip z 23.20 = ${gap.toFixed(2)} m flat`);
const { REACH_TABLE } = await import(TUNING);
for (const m of ['single', 'double', 'triple', 'longjump']) {
  const r = REACH_TABLE[m].rows.find((x) => x.dy === 0);
  console.log(`    ${m.padEnd(9)} safe ${r.safe}  max ${r.max}  ${r.safe >= gap ? '<= CLEARS' : ''}`);
}
if (REACH_TABLE.longjump.rows[0].safe < gap) fail('balcony gap exceeds long-jump safe');

console.log(`\n${fails === 0 ? 'ALL CHECKS PASS' : fails + ' FAILURES'}`);
process.exit(fails === 0 ? 0 : 1);
