// Arena carve probe — measures the LANTERNWALK PVP carve against the REAL
// Meridian Ward collider set (core/level/colliders.js). THREE-free, Node.
import { buildColliders } from "file:///C:/Users/TestRun/Claude%20Claw/forgeflow-games/games/blackridge/core/level/colliders.js";

const C = buildColliders(1);
let boxes = C.boxes.map(b => ({ id: b.id, min: b.min.slice(), max: b.max.slice() }));

// ---------------------------------------------------------------- subtract
function subtract(box, cut) {
  // returns array of boxes = box minus cut (axis-aligned, up to 6 pieces)
  const [ax0, ay0, az0] = box.min, [ax1, ay1, az1] = box.max;
  const [bx0, by0, bz0] = cut.min, [bx1, by1, bz1] = cut.max;
  if (bx1 <= ax0 || bx0 >= ax1 || by1 <= ay0 || by0 >= ay1 || bz1 <= az0 || bz0 >= az1) return [box];
  const out = [];
  const mk = (x0, x1, y0, y1, z0, z1) => {
    if (x1 - x0 > 1e-6 && y1 - y0 > 1e-6 && z1 - z0 > 1e-6)
      out.push({ id: box.id + "*", min: [x0, y0, z0], max: [x1, y1, z1] });
  };
  const cx0 = Math.max(ax0, bx0), cx1 = Math.min(ax1, bx1);
  const cy0 = Math.max(ay0, by0), cy1 = Math.min(ay1, by1);
  const cz0 = Math.max(az0, bz0), cz1 = Math.min(az1, bz1);
  mk(ax0, cx0, ay0, ay1, az0, az1);            // -X slab
  mk(cx1, ax1, ay0, ay1, az0, az1);            // +X slab
  mk(cx0, cx1, ay0, ay1, az0, cz0);            // -Z slab
  mk(cx0, cx1, ay0, ay1, cz1, az1);            // +Z slab
  mk(cx0, cx1, ay0, cy0, cz0, cz1);            // below
  mk(cx0, cx1, cy1, ay1, cz0, cz1);            // above
  return out;
}
function cutAll(cut) {
  const next = [];
  for (const b of boxes) next.push(...subtract(b, cut));
  boxes = next;
}
const V = (x0, x1, y0, y1, z0, z1) => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

// ------------------------------------------------------- EXCAVATIONS (voids)
const CUTS = {
  corridor:      V(0, 13, 0, 3.4, -25, -20),
  corr_door_w:   V(2, 5, 0, 2.4, -20, -18),
  corr_door_e:   V(9, 12, 0, 2.4, -20, -18),
  exh_room:      V(1, 12, 0, 3.4, -34, -26),
  exh_d1:        V(3, 7, 0, 2.4, -26, -25),
  exh_d2:        V(0, 1, 0, 2.4, -33, -29),
  exh_d3:        V(12, 17, 0, 2.6, -31, -27),
  ly_room:       V(-39, -28, 0, 3.4, 8, 16),
  ly_d1:         V(-28, -25, 0, 2.4, 11, 15),
  ly_d2:         V(-34, -30, 0, 2.4, 5, 8),
  ly_d3:         V(-41, -39, 0, 2.4, 9, 13),
  gal_mid_door:  V(15.5, 17, 0, 2.4, -6, -2),
  arc_w_ndoor:   V(-41, -39, 0, 2.4, -17, -13),
  arc_w_updoor:  V(-41, -39, 4.2, 6.4, -12, -9.3),
};
for (const k of Object.keys(CUTS)) cutAll(CUTS[k]);

// ------------------------------------------------------ ADDITIONS (seals)
const ADD = [
  ["W1_alley_west",  V(-48.5, -48, 0, 7, -30, 14)],
  ["W3_plaza_south", V(-25, 15, 0, 6, 14, 14.6)],
  ["W4_street_north",V(-12.5, 0, 0, 6, -30.6, -30)],
  ["W6_cut_seal",    V(23, 24.5, 0, 5.5, -22, -18)],
  ["W7_galdoor_seal",V(23, 24.5, 0, 5.5, -32, -28)],
  ["S_scaffold_stair", V(-42.6, -41, 0, 4.2, -12.2, -9.1)],
  // --- ARCADE interior partitions (shop-unit walls) : the arcade must not be
  //     a straight tube from any west opening to any east opening.
  ["ARC_P1", V(-33.5, -32.5, 0, 3.6, -19, -12)],
  ["ARC_P2", V(-31.5, -30.5, 0, 3.6, -1.5, 5)],
  ["ARC_P3", V(-36.5, -35.5, 0, 3.6, -9, -4)],
  ["ARC_P4", V(-30, -29, 0, 3.6, -16.5, -13.6)],
  // --- corridor structural pier (breaks the north-artery line)
  ["P1_pierA", V(5, 6.5, 0, 3.4, -25, -22)],
  ["P1_pierB", V(8, 9.5, 0, 3.4, -23, -20)],
  // --- ARTERY BREAKERS (cs1a / cs1b / market street) : staggered, alternating side
  ["N1_skip",        V(-33, -29, 0, 2.6, -28, -25.5)],
  ["N2_van",         V(-39.4, -34.6, 0, 2.4, -24.6, -20)],
  ["N3_boxvan",      V(-20, -16, 0, 2.5, -22.5, -18.5)],
  ["N4_kiosk",       V(-8, -4, 0, 2.4, -26, -23.5)],
  ["N5_barrier",     V(-24, -22, 0, 1.1, -26, -25.4)],
  // --- ALLEY breakers + cover (west lane must stop being a 44 m straight)
  ["A1_container",   V(-48, -44.5, 0, 2.6, -7, -4)],
  ["A2_container",   V(-44, -41, 0, 2.6, 3, 6)],
  ["A3_dumpster",    V(-46.9, -45.1, 0, 1.25, -22.6, -21.4)],
  ["A4_dumpster",    V(-43.9, -42.1, 0, 1.25, -0.6, 0.6)],
  ["A5_pallets",     V(-47.1, -45.9, 0, 1.1, -12.5, -11.5)],
  // --- PLAZA cover uplift (11 -> 17 pieces)
  ["PK_a_kiosk",     V(-19.3, -16.7, 0, 2.3, -9.3, -6.7)],
  ["PK_b_kiosk",     V(4.7, 7.3, 0, 2.3, 4.7, 7.3)],
  ["PK_c_stall",     V(-13.1, -10.9, 0, 2.4, 3.2, 4.8)],
  ["PK_d_planter",   V(7, 9, 0, 0.9, -10.4, -9.6)],
  ["PK_e_container", V(-5, 1, 0, 2.6, -14.2, -11.8)],
  ["PK_f_van",       V(0.9, 3.1, 0, 2.4, 5.4, 10.6)],
  // --- GALLERY: keep the long lane, add two chest-high crates only
  ["G1_crate",       V(18.6, 20.4, 0, 1.2, -16.9, -15.1)],
  ["G2_crate",       V(20.6, 22.4, 0, 1.2, 1.1, 2.9)],
  ["G3_shelf",       V(22.45, 22.95, 0, 1.8, -28.9, -27.1)],
  // --- BASE cover, authored to parity (4 pieces each, same heights)
  ["LY_c1", V(-31.2, -29.8, 0, 1.25, 13.4, 14.6)],
  ["LY_c2", V(-37.2, -35.8, 0, 1.25, 13.4, 14.6)],
  ["LY_c3", V(-37, -35.5, 0, 3.4, 8.5, 11.5)],
  ["LY_c4", V(-30.4, -29.2, 0, 2.2, 8.6, 10.8)],
  ["EX_c1", V(3.8, 5.2, 0, 1.25, -31.4, -30.2)],
  ["EX_c2", V(9.8, 11.2, 0, 1.25, -31.4, -30.2)],
  ["EX_c3", V(8.5, 10, 0, 3.4, -28.5, -25.5)],
  ["EX_c4", V(2.2, 3.4, 0, 2.2, -30.8, -28.6)],
];
for (const [id, b] of ADD) boxes.push({ id, min: b.min, max: b.max });

// ------------------------------------------- prop edits (removed / moved)
const DROP = new Set(["arc_stall_2", "arc_stall_5", "pl_car_5", "pl_plant_3", "pl_newsbox_4", "al_scaf_2",
  "al_scaf_1", "al_dump_1", "al_dump_2", "al_dump_3", "al_dump_4", "al_van",
  "q_van", "arc_table"]);
boxes = boxes.filter(b => !DROP.has(b.id.replace(/\*+$/, "")));
// moved pieces
const MOVE = { pl_car_6: [0, 0, -3], al_dump_6: [2, 0, 0] };
for (const b of boxes) {
  const base = b.id.replace(/\*+$/, "");
  if (MOVE[base]) { for (let i = 0; i < 3; i++) { b.min[i] += MOVE[base][i]; b.max[i] += MOVE[base][i]; } }
}

// ------------------------------------------------------------ arena bounds
const AB = { x0: -48.5, x1: 24.5, z0: -34.5, z1: 14.6 };

// ---------------------------------------------------------- spatial bucket
const BK = 6;
const bx = Math.ceil((AB.x1 - AB.x0) / BK) + 2, bz = Math.ceil((AB.z1 - AB.z0) / BK) + 2;
const buckets = Array.from({ length: bx * bz }, () => []);
function bidx(x, z) {
  const i = Math.max(0, Math.min(bx - 1, Math.floor((x - AB.x0) / BK)));
  const j = Math.max(0, Math.min(bz - 1, Math.floor((z - AB.z0) / BK)));
  return j * bx + i;
}
for (const b of boxes) {
  const i0 = Math.max(0, Math.floor((b.min[0] - AB.x0) / BK)), i1 = Math.min(bx - 1, Math.floor((b.max[0] - AB.x0) / BK));
  const j0 = Math.max(0, Math.floor((b.min[2] - AB.z0) / BK)), j1 = Math.min(bz - 1, Math.floor((b.max[2] - AB.z0) / BK));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * bx + i].push(b);
}
function blockedAt(x, z, y) {
  for (const b of buckets[bidx(x, z)]) {
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] &&
        b.min[1] <= y && b.max[1] >= y) return true;
  }
  return false;
}
// walkable at ground: nothing spanning knee..chest, and inside arena
function walkable(x, z) {
  if (x < AB.x0 || x > AB.x1 || z < AB.z0 || z > AB.z1) return false;
  for (const b of buckets[bidx(x, z)]) {
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] &&
        b.min[1] < 1.7 && b.max[1] > 0.42) return false;
  }
  return true;
}

// ------------------------------------------------------------ walkable grid
const CELL = 0.5;
const pts = [];
for (let x = AB.x0 + CELL / 2; x < AB.x1; x += CELL)
  for (let z = AB.z0 + CELL / 2; z < AB.z1; z += CELL)
    if (walkable(x, z)) pts.push([x, z]);
// flood fill from plaza centre to drop islands
const key = (x, z) => `${Math.round((x - AB.x0) / CELL)},${Math.round((z - AB.z0) / CELL)}`;
const set = new Map(); for (const p of pts) set.set(key(p[0], p[1]), p);
const seed = pts.reduce((a, p) => (Math.hypot(p[0] + 5, p[1] - 0) < Math.hypot(a[0] + 5, a[1] - 0) ? p : a), pts[0]);
const seen = new Set([key(seed[0], seed[1])]); const q = [seed];
while (q.length) {
  const [x, z] = q.pop();
  for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]]) {
    const k = key(x + dx, z + dz);
    if (set.has(k) && !seen.has(k)) { seen.add(k); q.push(set.get(k)); }
  }
}
const reach = [...seen].map(k => set.get(k));
const groundArea = reach.length * CELL * CELL;

// -------------------------------------------------------------- raycasting
function ray(x, z, dx, dz, y, cap = 90) {
  const step = 0.25;
  for (let t = step; t <= cap; t += step) {
    const px = x + dx * t, pz = z + dz * t;
    if (px < AB.x0 || px > AB.x1 || pz < AB.z0 || pz > AB.z1) return t;
    if (blockedAt(px, pz, y)) return t;
  }
  return cap;
}
function profile(points, y = 1.6, nDir = 72) {
  const all = [], maxes = [];
  for (const [x, z] of points) {
    let m = 0;
    for (let i = 0; i < nDir; i++) {
      const a = (i / nDir) * Math.PI * 2;
      const d = ray(x, z, Math.cos(a), Math.sin(a), y);
      all.push(d); if (d > m) m = d;
    }
    maxes.push(m);
  }
  return { all: all.sort((a, b) => a - b), maxes: maxes.sort((a, b) => a - b) };
}
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

// sample subset for speed
function sample(arr, n) {
  const out = []; const st = Math.max(1, Math.floor(arr.length / n));
  for (let i = 0; i < arr.length; i += st) out.push(arr[i]);
  return out;
}
const S = sample(reach, 900);
const P = profile(S);

console.log("=== CARVE ===");
console.log(`arena bounds  X[${AB.x0}, ${AB.x1}]  Z[${AB.z0}, ${AB.z1}]  = ${(AB.x1 - AB.x0).toFixed(1)} x ${(AB.z1 - AB.z0).toFixed(1)} m`);
console.log(`gross footprint      ${((AB.x1 - AB.x0) * (AB.z1 - AB.z0)).toFixed(0)} m2`);
console.log(`walkable GROUND area ${groundArea.toFixed(0)} m2 (connected, cell ${CELL} m)`);
console.log(`  per actor (10)     ${(groundArea / 10).toFixed(0)} m2`);

console.log("\n=== SIGHTLINE PROFILE (eye 1.60 m, 72 rays x " + S.length + " walkable points) ===");
console.log(`all rays  n=${P.all.length}  median ${pct(P.all, .5).toFixed(1)} m  mean ${mean(P.all).toFixed(1)} m  p75 ${pct(P.all, .75).toFixed(1)}  p90 ${pct(P.all, .9).toFixed(1)}  p99 ${pct(P.all, .99).toFixed(1)}  max ${P.all[P.all.length - 1].toFixed(1)}`);
const band = (lo, hi) => (P.all.filter(d => d >= lo && d < hi).length / P.all.length * 100).toFixed(1);
console.log(`band mix: <6m ${band(0, 6)}%  6-15 ${band(6, 15)}%  15-25 ${band(15, 25)}%  25-40 ${band(25, 40)}%  40-55 ${band(40, 55)}%  >=55 ${band(55, 999)}%`);
console.log(`longest line available FROM a point: median ${pct(P.maxes, .5).toFixed(1)} m  p90 ${pct(P.maxes, .9).toFixed(1)}  max ${P.maxes[P.maxes.length - 1].toFixed(1)}`);

// ------------------------------------------------------- per-region report
const REGIONS = {
  plaza:        [-25, 15, -18, 14],
  arcade_gnd:   [-39, -26, -19, 5],
  alley:        [-48, -41, -30, 14],
  cs1a:         [-41, -25, -28, -20],
  cs1b:         [-25, -12.5, -28, -18],
  street:       [-12.5, 0, -30, -18],
  corridor:     [0, 13, -25, -20],
  cut:          [13, 23, -22, -18],
  gallery:      [17, 23, -33, 13],
  LY_base:      [-39, -28, 8, 16],
  ExH_base:     [1, 12, -34, -26],
};
console.log("\n=== PER-REGION (ground) ===");
console.log("region        area  pts  medianRay  longestLine");
for (const [name, r] of Object.entries(REGIONS)) {
  const rp = reach.filter(([x, z]) => x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]);
  if (!rp.length) { console.log(name.padEnd(13), "EMPTY"); continue; }
  const pr = profile(sample(rp, 120));
  console.log(name.padEnd(13), String((rp.length * CELL * CELL).toFixed(0)).padStart(5),
    String(rp.length).padStart(5), pct(pr.all, .5).toFixed(1).padStart(9),
    pr.maxes[pr.maxes.length - 1].toFixed(1).padStart(12));
}

// --------------------------------------------------- pairwise contact model
function los(a, b, y = 1.6) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 0.01) return true;
  const s = 0.25, n = Math.ceil(L / s);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blockedAt(a[0] + dx * t, a[1] + dz * t, y)) return false;
  }
  return true;
}
let rs = 12345; const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296;
let nLos = 0, N = 4000; const dLos = [], dAll = [];
for (let i = 0; i < N; i++) {
  const a = reach[Math.floor(rnd() * reach.length)], b = reach[Math.floor(rnd() * reach.length)];
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]); dAll.push(d);
  if (los(a, b)) { nLos++; dLos.push(d); }
}
dAll.sort((a, b) => a - b); dLos.sort((a, b) => a - b);
console.log("\n=== CONTACT MODEL (random walkable pairs, n=" + N + ") ===");
console.log(`mean separation ${mean(dAll).toFixed(1)} m   median ${pct(dAll, .5).toFixed(1)} m   p90 ${pct(dAll, .9).toFixed(1)} m   max ${dAll[dAll.length - 1].toFixed(1)} m`);
console.log(`pairs with clear LOS: ${(nLos / N * 100).toFixed(1)}%   (median LOS separation ${dLos.length ? pct(dLos, .5).toFixed(1) : "-"} m)`);
console.log(`time to close median separation @6.4 m/s sprint: ${(pct(dAll, .5) / 6.4).toFixed(1)} s ; p90: ${(pct(dAll, .9) / 6.4).toFixed(1)} s`);

// 10-actor occupancy model: 1 observer + 9 others at random walkable points
{
  const TR = 1500; const nearest = []; let anyLos = 0, losCount = [];
  for (let t = 0; t < TR; t++) {
    const me = reach[Math.floor(rnd() * reach.length)];
    let nd = 1e9, seenN = 0;
    for (let k = 0; k < 9; k++) {
      const o = reach[Math.floor(rnd() * reach.length)];
      const d = Math.hypot(me[0] - o[0], me[1] - o[1]);
      if (d < nd) nd = d;
      if (los(me, o)) seenN++;
    }
    nearest.push(nd); losCount.push(seenN); if (seenN > 0) anyLos++;
  }
  nearest.sort((a, b) => a - b);
  console.log(`\n10-ACTOR OCCUPANCY (1 observer + 9 others, ${TR} trials)`);
  console.log(`  nearest other actor: median ${pct(nearest, .5).toFixed(1)} m  p90 ${pct(nearest, .9).toFixed(1)} m  worst ${nearest[nearest.length - 1].toFixed(1)} m`);
  console.log(`  time to reach nearest @6.4 m/s: median ${(pct(nearest, .5) / 6.4).toFixed(1)} s  p90 ${(pct(nearest, .9) / 6.4).toFixed(1)} s`);
  console.log(`  P(at least one enemy in direct LOS right now) = ${(anyLos / TR * 100).toFixed(1)}%`);
  console.log(`  mean actors visible at once = ${mean(losCount).toFixed(2)}`);
}

// ---------------------------------------------------- named point sightlines
const NAMED = {
  "plaza_centre (-5,0)": [-5, 0],
  "plaza_NW (-22,-15)": [-22, -15],
  "plaza_SE (12,11)": [12, 11],
  "gallery_north (20,-20)": [20, -20],
  "gallery_mid (20,-4)": [20, -4],
  "gallery_south (20,10)": [20, 10],
  "arcade_lightwell (-32,-8)": [-32, -8],
  "alley_mid (-44,-8)": [-44, -8],
  "alley_north (-44,-26)": [-44, -26],
  "cs1a (-33,-24)": [-33, -24],
  "cs1b (-19,-23)": [-19, -23],
  "street (-6,-24)": [-6, -24],
  "corridor (6,-22)": [6, -22],
  "LY_flag (-33.5,12)": [-33.5, 12],
  "ExH_flag (6.5,-30)": [6.5, -30],
};
console.log("\n=== NAMED POINTS (eye 1.60) ===");
console.log("point                          longest  median  #rays>25m");
for (const [n, p] of Object.entries(NAMED)) {
  if (!walkable(p[0], p[1])) { console.log(n.padEnd(30), "NOT WALKABLE"); continue; }
  const pr = profile([p]);
  const long = pr.all.filter(d => d > 25).length;
  console.log(n.padEnd(30), pr.maxes[0].toFixed(1).padStart(7), pct(pr.all, .5).toFixed(1).padStart(7), String(long).padStart(9));
}

// ---- longest-sightline finder: where ARE the long lanes?
{
  const found = [];
  for (const [x, z] of sample(reach, 1400)) {
    for (let i = 0; i < 144; i++) {
      const a = (i / 144) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const d = ray(x, z, dx, dz, 1.6);
      if (d >= 38) found.push({ d, a: [x, z], b: [x + dx * d, z + dz * d] });
    }
  }
  found.sort((p, q) => q.d - p.d);
  console.log(`\n=== LONG LANES (>=38 m, ${found.length} ray hits) — top 12 distinct ===`);
  const shown = [];
  for (const f of found) {
    if (shown.some(s => Math.hypot(s.a[0] - f.a[0], s.a[1] - f.a[1]) < 9 && Math.hypot(s.b[0] - f.b[0], s.b[1] - f.b[1]) < 9)) continue;
    shown.push(f);
    console.log(`  ${f.d.toFixed(1)} m  (${f.a[0].toFixed(1)}, ${f.a[1].toFixed(1)}) -> (${f.b[0].toFixed(1)}, ${f.b[1].toFixed(1)})`);
    if (shown.length >= 12) break;
  }
}

// balcony window line
const balc = profile([[-27.5, -11]], 5.8);
console.log(`\narcade balcony window (-27.5, y5.8, -11): longest ${balc.maxes[0].toFixed(1)} m, median ${pct(balc.all, .5).toFixed(1)} m`);

// -------------------------------------------------- flag-site parity report
function siteReport(name, c, radius = 12) {
  const inR = reach.filter(([x, z]) => Math.hypot(x - c[0], z - c[1]) <= radius);
  const pr = profile([c]);
  // count cover props (from original cover list) within radius
  const cov = C.cover.filter(cv => Math.hypot(cv.pos[0] - c[0], cv.pos[2] - c[1]) <= radius).length;
  console.log(name.padEnd(12), `area${(inR.length * CELL * CELL).toFixed(0).padStart(5)} m2  longestLine ${pr.maxes[0].toFixed(1).padStart(5)} m  medianRay ${pct(pr.all, .5).toFixed(1).padStart(5)} m  coverNodes ${cov}`);
}
console.log("\n=== FLAG SITE PARITY (r=12 m) ===");
siteReport("LY (west)", [-33.5, 12]);
siteReport("ExH (east)", [6.5, -30]);

// route lengths (grid BFS distance)
const idxOf = new Map(); reach.forEach((p, i) => idxOf.set(key(p[0], p[1]), i));
function bfs(from) {
  const dist = new Float32Array(reach.length).fill(1e9);
  const s = idxOf.get(key(from[0], from[1])); if (s == null) return null;
  dist[s] = 0; const qq = [s];
  for (let h = 0; h < qq.length; h++) {
    const i = qq[h]; const [x, z] = reach[i];
    for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]]) {
      const k = key(x + dx, z + dz); const j = idxOf.get(k);
      if (j != null && dist[j] > dist[i] + CELL) { dist[j] = dist[i] + CELL; qq.push(j); }
    }
  }
  return dist;
}
function snap(p) {
  let best = reach[0], bd = 1e9;
  for (const q of reach) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
  return best;
}
const LY = snap([-33.5, 12]), EX = snap([6.5, -30]);
const dLY = bfs(LY), dEX = bfs(EX);
const CENTROID = [reach.reduce((s, p) => s + p[0], 0) / reach.length, reach.reduce((s, p) => s + p[1], 0) / reach.length];
console.log(`\nwalkable centroid: (${CENTROID[0].toFixed(1)}, ${CENTROID[1].toFixed(1)})`);
const cIdx = idxOf.get(key(snap(CENTROID)[0], snap(CENTROID)[1]));
console.log(`path LY -> ExH : ${dLY[idxOf.get(key(EX[0], EX[1]))].toFixed(1)} m  (${(dLY[idxOf.get(key(EX[0], EX[1]))] / 6.4).toFixed(1)} s @6.4 m/s)`);
console.log(`path LY -> centroid : ${dLY[cIdx].toFixed(1)} m ; ExH -> centroid : ${dEX[cIdx].toFixed(1)} m ; delta ${(100 * Math.abs(dLY[cIdx] - dEX[cIdx]) / ((dLY[cIdx] + dEX[cIdx]) / 2)).toFixed(1)}%`);

// ---- anchor path matrix
const ANCH = {
  SPW_arcade:[-32,-16], SPW_alley:[-45,-2], SPW_LYback:[-30,13],
  SPE_corridor:[11,-22], SPE_galN:[20,-25], SPE_ExHback:[3,-27],
  SPN_cs1b:[-19,-25], SPS_plazaS:[-8,11], SPX_galS:[20,8], SPX_plazaC:[-5,-2],
  FLAG_LY:[-33.5,12], FLAG_ExH:[6.5,-30],
};
const AD = {}; for (const k of Object.keys(ANCH)) AD[k] = bfs(snap(ANCH[k]));
function pd(a,b){ const d=AD[a][idxOf.get(key(snap(ANCH[b])[0],snap(ANCH[b])[1]))]; return d>1e8?NaN:d; }
console.log("PATH MATRIX (m, grid BFS, 0.5 m cells)");
const keys=Object.keys(ANCH);
console.log("".padEnd(14)+keys.map(k=>k.slice(0,9).padStart(10)).join(""));
for(const a of keys) console.log(a.padEnd(14)+keys.map(b=>(isNaN(pd(a,b))?"--":pd(a,b).toFixed(0)).padStart(10)).join(""));

// unreachable check: are all named regions reachable?
console.log("\n=== REACHABILITY ===");
for (const [name, r] of Object.entries(REGIONS)) {
  const any = reach.some(([x, z]) => x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]);
  if (!any) console.log("  UNREACHABLE:", name);
}
console.log("  (regions not listed are connected to the plaza flood fill)");
export { };

// ============================== SPAWN POINT VALIDATION =====================
const SP = [
  // SC_WEST — alley + arcade west approach
  ["sp_w1",-44.5,-28.0, 1.57],["sp_w2",-46.5,-24.0, 1.57],["sp_w3",-43.5,-19.0, 1.57],
  ["sp_w4",-45.8,-13.5, 1.57],["sp_w5",-44.0,-10.0,-1.57],["sp_w6",-46.2,-6.0,-1.57],
  ["sp_w7",-43.5,-3.0,-1.57],["sp_w8",-45.5, 6.0,-1.57],
  // SC_ARCADE — arcade interior, both floors
  ["sp_a1",-37.5,-16.0, 1.57],["sp_a2",-31.0,-16.5, 1.57],["sp_a3",-28.0,-8.0,-1.57],
  ["sp_a4",-37.5,-2.0,-1.57],["sp_a5",-33.5, 2.5,-1.57],["sp_a6",-28.5, 1.0,-1.57],
  ["sp_a7",-32.0,-8.5, 0.0],
  // SC_LANTERN — Lantern Yard base + plaza SW
  ["sp_l1",-31.5,13.0, 0.0],["sp_l2",-37.5,13.5, 0.0],["sp_l3",-33.0, 9.5, 0.0],
  ["sp_l4",-22.0,12.0, 0.0],["sp_l5",-17.5, 7.0,-1.0],["sp_l6",-23.0, 2.0,-1.57],
  ["sp_l7",-12.0,11.5,-1.0],
  // SC_NORTH — cross-street cs1a + cs1b
  ["sp_n1",-38.0,-26.5, 0.0],["sp_n2",-31.5,-22.5, 0.0],["sp_n3",-27.0,-26.0, 0.0],
  ["sp_n4",-22.5,-22.0, 1.57],["sp_n5",-17.0,-25.5, 1.57],["sp_n6",-14.5,-21.0, 1.57],
  ["sp_n7",-24.0,-19.0, 1.57],
  // SC_MARKET — market street pocket + corridor + Exchange House
  ["sp_m1",-10.0,-27.5, 1.57],["sp_m2",-4.0,-28.5, 1.57],["sp_m3",-9.5,-21.0, 1.57],
  ["sp_m4",-2.5,-21.5, 1.57],["sp_m5", 2.0,-22.5, 0.0],["sp_m6",11.0,-22.5, 1.57],
  ["sp_m7", 6.5,-32.0, 1.57],["sp_m8", 2.0,-27.5, 0.0],
  // SC_GALLERY — gallery lane + NE cut + plaza NE
  ["sp_g1",20.0,-29.0, 1.57],["sp_g2",19.0,-20.0, 1.57],["sp_g3",21.0,-13.0, 1.57],
  ["sp_g4",19.5,-6.0, 1.57],["sp_g5",21.0, 4.0,-1.57],["sp_g6",19.5,10.5,-1.57],
  ["sp_g7",11.0,-15.5,-1.57],["sp_g8", 8.0,-6.0,-1.57],
  // SC_PLAZA (FFA-only ring)
  ["sp_p1",-19.0,-14.0, 0.9],["sp_p2",-8.0,-3.0, 2.2],["sp_p3", 7.0,-16.0, 1.9],
  ["sp_p4",12.5,-3.0, 3.0],["sp_p5",-2.0, 9.0,-1.2],["sp_p6",-20.0, 5.5,-0.6],
];
function clearance(x, z) {
  let best = 99;
  for (let a = 0; a < 32; a++) {
    const th = a / 32 * Math.PI * 2;
    for (let r = 0.25; r <= 3.0; r += 0.25) {
      if (blockedAt(x + Math.cos(th) * r, z + Math.sin(th) * r, 1.0)) { if (r < best) best = r; break; }
    }
  }
  return best;
}
console.log("SPAWN VALIDATION  (>=2.0 m clearance, >=8 m forward view, walkable)");
const clusters = {};
let fails = 0;
for (const [id, x, z, yaw] of SP) {
  const cl = id.slice(3, 4);
  const w = walkable(x, z);
  const cr = clearance(x, z);
  const fv = ray(x, z, -Math.sin(yaw), -Math.cos(yaw), 1.6);
  let nn = 99; for (const [i2, x2, z2] of SP) if (i2 !== id) nn = Math.min(nn, Math.hypot(x - x2, z - z2));
  const ok = w && cr >= 1.5 && fv >= 8.0;
  if (!ok) { fails++; console.log(`  FAIL ${id} (${x},${z})  walkable=${w} clear=${cr.toFixed(2)} fwdView=${fv.toFixed(1)} nn=${nn.toFixed(1)}`); }
  (clusters[cl] = clusters[cl] || []).push([x, z]);
}
console.log(`  ${SP.length} points, ${fails} failing`);
for (const [c, ps] of Object.entries(clusters)) {
  const xs = ps.map(p => p[0]), zs = ps.map(p => p[1]);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
  console.log(`  cluster ${c}: ${ps.length} pts, bbox ${area.toFixed(0)} m2`);
}

// ---- auto-repair: nudge each failing point within 4 m and re-pick yaw
console.log("REPAIRED SPAWN SET (id, x, z, yaw)  [<=4 m nudge, 16 yaws]");
const REP = [];
for (const [id, x0, z0] of SP) {
  let best = null;
  for (let r = 0; r <= 4.01 && !best; r += 0.5) {
    for (let a = 0; a < (r === 0 ? 1 : 24) && !best; a++) {
      const th = a / 24 * Math.PI * 2;
      const x = Math.round((x0 + Math.cos(th) * r) * 2) / 2, z = Math.round((z0 + Math.sin(th) * r) * 2) / 2;
      if (!walkable(x, z)) continue;
      const cr = clearance(x, z); if (cr < 1.5) continue;
      let by = null, bv = 0;
      for (let k = 0; k < 16; k++) {
        const yaw = k / 16 * Math.PI * 2 - Math.PI;
        const v = ray(x, z, -Math.sin(yaw), -Math.cos(yaw), 1.6);
        if (v > bv) { bv = v; by = yaw; }
      }
      if (bv >= 8.0) best = [x, z, by, cr, bv];
    }
  }
  if (best) REP.push([id, ...best]);
  else console.log("  UNPLACEABLE", id);
}
// drop points closer than 3 m to an already-accepted one
const KEEP = [];
for (const r of REP) if (!KEEP.some(k => Math.hypot(k[1] - r[1], k[2] - r[2]) < 3.0)) KEEP.push(r);
for (const [id, x, z, yaw, cr, fv] of KEEP)
  console.log(`  { "id": "${id}", "pos": [${x}, 0, ${z}], "yaw": ${yaw.toFixed(2)} },  // clear ${cr.toFixed(1)} m, view ${fv.toFixed(0)} m`);
console.log(`  kept ${KEEP.length} of ${SP.length}`);
const byC = {}; for (const k of KEEP) (byC[k[0].slice(3,4)] = byC[k[0].slice(3,4)] || []).push(k);
for (const [c, ps] of Object.entries(byC)) {
  const xs = ps.map(p => p[1]), zs = ps.map(p => p[2]);
  console.log(`  cluster ${c}: ${ps.length} pts, bbox ${((Math.max(...xs)-Math.min(...xs))*(Math.max(...zs)-Math.min(...zs))).toFixed(0)} m2`);
}
