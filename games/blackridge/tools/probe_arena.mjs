// tools/probe_arena.mjs [W4] — LANTERNWALK arena acceptance gates G-A…G-K
// (PVP_BUILD_PLAN Part 4.1 row W4; arena.md Part 6). THREE-free, Node.
//
// Promotion of _design/pvp/arena_probe.mjs: measures the BUILT arena
// (core/level/maps/lanternwalk.js via buildCollidersFor) instead of an inline
// edit list, gates every measurement, and exits non-zero on any FAIL.
//
//   node tools/probe_arena.mjs           → run gates, exit 0/1
//   node tools/probe_arena.mjs --emit    → gates green ⇒ write the MEASURED
//     spawnPoints / clusters / flags / arena blocks into content.json
//     (Part 4.2: spawn data is PROBE-EMITTED, never hand-copied — C7b
//     happened once already). Emit is refused while any gate fails.
//
// Also validates the lane graph (core/level/lanes/lanternwalk.js) against the
// five Part 3.9 contract properties — the graph is W4 data, so its gate lives
// with W4's probe.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";
import { buildCollidersFor } from "../core/level/colliders.js";
import LANES from "../core/level/lanes/lanternwalk.js";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const EMIT = process.argv.includes("--emit");

const C = buildCollidersFor("lanternwalk", 1);
const boxes = C.boxes;
const AB = { x0: C.bounds.min[0], x1: C.bounds.max[0], z0: C.bounds.min[2], z1: C.bounds.max[2] };

// ------------------------------------------------------------ gate ledger
let anyFail = false;
function gate(id, ok, detail) {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) anyFail = true;
  console.log(`[${tag}] ${id}  ${detail}`);
}
function note(s) { console.log(`       ${s}`); }

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
  if (i1 < 0 || j1 < 0 || i0 > bx - 1 || j0 > bz - 1) continue;
  for (let j = Math.max(0, j0); j <= j1; j++) for (let i = Math.max(0, i0); i <= i1; i++) buckets[j * bx + i].push(b);
}
function blockedAt(x, z, y) {
  for (const b of buckets[bidx(x, z)]) {
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] &&
        b.min[1] <= y && b.max[1] >= y) return true;
  }
  return false;
}
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
const key = (x, z) => `${Math.round((x - AB.x0) / CELL)},${Math.round((z - AB.z0) / CELL)}`;
const set = new Map(); for (const p of pts) set.set(key(p[0], p[1]), p);
const seedPt = pts.reduce((a, p) => (Math.hypot(p[0] + 5, p[1]) < Math.hypot(a[0] + 5, a[1]) ? p : a), pts[0]);
const seen = new Set([key(seedPt[0], seedPt[1])]); const q = [seedPt];
while (q.length) {
  const [x, z] = q.pop();
  for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]]) {
    const k = key(x + dx, z + dz);
    if (set.has(k) && !seen.has(k)) { seen.add(k); q.push(set.get(k)); }
  }
}
const reach = [...seen].map((k) => set.get(k));
const reachKeys = seen;
const groundArea = reach.length * CELL * CELL;
const strayArea = (pts.length - reach.length) * CELL * CELL;

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
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function sample(arr, n) {
  const out = []; const st = Math.max(1, Math.floor(arr.length / n));
  for (let i = 0; i < arr.length; i += st) out.push(arr[i]);
  return out;
}
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

// grid BFS distances (the nav-path proxy at 0.5 m cells)
const idxOf = new Map(); reach.forEach((p, i) => idxOf.set(key(p[0], p[1]), i));
function snap(p) {
  let best = reach[0], bd = 1e9;
  for (const r of reach) { const d = Math.hypot(r[0] - p[0], r[1] - p[1]); if (d < bd) { bd = d; best = r; } }
  return best;
}
// 8-neighbour Dijkstra (octile) — a 4-neighbour BFS reports Manhattan
// lengths, which inflates diagonal routes ~30% and corrupts the parity
// ratios. Bucketed by 0.1 m cost for near-linear time.
const DIAG = CELL * Math.SQRT2;
function bfs(from) {
  const dist = new Float32Array(reach.length).fill(1e9);
  const s = idxOf.get(key(from[0], from[1])); if (s == null) return null;
  dist[s] = 0;
  const bucketsQ = []; const push = (i, d) => {
    const b = Math.floor(d * 10);
    (bucketsQ[b] = bucketsQ[b] || []).push(i);
  };
  push(s, 0);
  const NB = [[CELL, 0, CELL], [-CELL, 0, CELL], [0, CELL, CELL], [0, -CELL, CELL],
    [CELL, CELL, DIAG], [CELL, -CELL, DIAG], [-CELL, CELL, DIAG], [-CELL, -CELL, DIAG]];
  for (let b = 0; b < 4000; b++) {
    const bucket = bucketsQ[b]; if (!bucket) continue;
    for (let h = 0; h < bucket.length; h++) {
      const i = bucket[h];
      if (Math.floor(dist[i] * 10) !== b) continue; // stale entry
      const [x, z] = reach[i];
      for (const [dx, dz, c] of NB) {
        const j = idxOf.get(key(x + dx, z + dz));
        if (j != null && dist[j] > dist[i] + c) { dist[j] = dist[i] + c; push(j, dist[j]); }
      }
    }
  }
  return dist;
}
function pathLen(distField, to) {
  const s = snap(to);
  const d = distField[idxOf.get(key(s[0], s[1]))];
  return d > 1e8 ? NaN : d;
}

// ===========================================================================
// SPAWN SET — candidates from arena.md §2.2 as amended by C7b (five points
// inside their own flag room lose CTF; +3 CTF-only Lantern approaches and
// +2 market-pocket points keep every cluster ≥6 per mode inside the 50 cap).
// The probe REPAIRS (≤4 m nudge), re-takes yaw inside the cluster's ±60°
// inward cone, and EMITS — hand transcription is how C7b happened.
// ===========================================================================
const FLAG_WEST = [-33.5, 0, 12.0], FLAG_EAST = [6.5, 0, -30.0];
const ALL = ["tdm", "ctf", "ffa"];
const CLUSTER_META = {
  SC_WEST:    { inward: 0, node: "alley_mid", side: "west" },       // +X
  SC_ARCADE:  { inward: 0, node: "arcade_lightwell", side: "west" },
  SC_LANTERN: { inward: 0.7854, node: "lantern_yard", side: "west" }, // NE-ish (+X,−Z) → yaw −π/4? see yawFor
  SC_NORTH:   { inward: Math.PI, node: "cs1_mid", side: "east" },   // +Z (south)
  SC_MARKET:  { inward: Math.PI, node: "street_mouth", side: "east" },
  SC_GALLERY: { inward: Math.PI / 2, node: "gallery_mid", side: "east" }, // −X
  SC_PLAZA:   { inward: null, node: "plaza_center", side: "mid", modes: ["ffa"] },
};
// forward = (−sin yaw, −cos yaw). inward yaw values:
//   +X → −π/2 ·· −X → +π/2 ·· +Z(south) → π ·· −Z(north) → 0
CLUSTER_META.SC_WEST.inward = -Math.PI / 2;
CLUSTER_META.SC_ARCADE.inward = -Math.PI / 2;
CLUSTER_META.SC_LANTERN.inward = -Math.PI / 4;   // (+X,−Z) blend
CLUSTER_META.SC_GALLERY.inward = Math.PI / 2;

const SP = [
  // id, x, z, cluster, modes (null = all three)
  ["sp_w1", -44.5, -28.0, "SC_WEST", null], ["sp_w2", -46.5, -24.0, "SC_WEST", null],
  ["sp_w3", -43.5, -19.0, "SC_WEST", null], ["sp_w6", -43.0, -6.0, "SC_WEST", null],
  ["sp_w7", -43.5, -3.0, "SC_WEST", null], ["sp_w8", -45.5, 6.0, "SC_WEST", null],

  ["sp_a1", -36.0, -16.0, "SC_ARCADE", null], ["sp_a2", -27.5, -16.5, "SC_ARCADE", null],
  ["sp_a3", -28.0, -8.0, "SC_ARCADE", null], ["sp_a4", -37.5, -2.0, "SC_ARCADE", null],
  ["sp_a5", -33.5, 2.5, "SC_ARCADE", null], ["sp_a7", -32.0, -8.5, "SC_ARCADE", null],

  // C7b: sp_l1/l2/l3 sit inside (or stare into) their own flag room — CTF off
  ["sp_l1", -32.0, 12.5, "SC_LANTERN", ["tdm", "ffa"]],
  ["sp_l2", -39.5, 11.5, "SC_LANTERN", ["tdm", "ffa"]],
  ["sp_l3", -33.0, 9.5, "SC_LANTERN", ["tdm", "ffa"]],
  // sp_l4 sits in the D1 mouth with direct LOS to its own stand (V9) — CTF off
  ["sp_l4", -26.0, 13.0, "SC_LANTERN", ["tdm", "ffa"]],
  ["sp_l5", -17.5, 7.0, "SC_LANTERN", null],
  ["sp_l6", -23.0, 2.0, "SC_LANTERN", null], ["sp_l7", -12.0, 11.5, "SC_LANTERN", null],
  // C7b: +3 CTF-only on the Lantern Yard's plaza approaches (plaza SW/W —
  // the dense western edge is wall/prop-crowded below the 1.5 m clearance bar)
  ["sp_lc1", -16.0, 0.5, "SC_LANTERN", ["ctf"]],
  ["sp_lc2", -14.0, 6.0, "SC_LANTERN", ["ctf"]],
  ["sp_lc3", -19.5, -3.0, "SC_LANTERN", ["ctf"]],

  ["sp_n1", -38.0, -26.5, "SC_NORTH", null], ["sp_n2", -31.5, -22.5, "SC_NORTH", null],
  ["sp_n3", -27.0, -26.0, "SC_NORTH", null], ["sp_n4", -22.5, -22.0, "SC_NORTH", null],
  ["sp_n5", -17.0, -25.5, "SC_NORTH", null], ["sp_n6", -14.5, -21.0, "SC_NORTH", null],
  ["sp_n7", -23.5, -19.0, "SC_NORTH", null],

  ["sp_m1", -12.0, -25.5, "SC_MARKET", null], ["sp_m2", -4.0, -28.5, "SC_MARKET", null],
  ["sp_m3", -9.5, -21.0, "SC_MARKET", null], ["sp_m4", -0.5, -21.5, "SC_MARKET", null],
  ["sp_m6", 11.0, -22.5, "SC_MARKET", null],
  // C7b: ExH room points — CTF off
  ["sp_m7", 6.5, -32.0, "SC_MARKET", ["tdm", "ffa"]],
  ["sp_m8", 4.0, -27.5, "SC_MARKET", ["tdm", "ffa"]],
  // C7b: +2 CTF-only in the market-street pocket
  ["sp_mc1", -2.0, -24.5, "SC_MARKET", ["ctf"]],
  ["sp_mc2", 6.0, -21.5, "SC_MARKET", ["ctf"]],

  ["sp_g1", 20.0, -29.0, "SC_GALLERY", null], ["sp_g3", 21.0, -13.0, "SC_GALLERY", null],
  ["sp_g4", 19.5, -6.0, "SC_GALLERY", null], ["sp_g5", 20.5, 4.5, "SC_GALLERY", null],
  ["sp_g6", 19.5, 10.5, "SC_GALLERY", null], ["sp_g7", 10.5, -17.5, "SC_GALLERY", null],

  ["sp_p1", -17.0, -14.0, "SC_PLAZA", ["ffa"]], ["sp_p2", -8.0, -3.0, "SC_PLAZA", ["ffa"]],
  ["sp_p3", 0.0, -17.5, "SC_PLAZA", ["ffa"]], ["sp_p4", 12.5, -3.0, "SC_PLAZA", ["ffa"]],
  ["sp_p5", -2.0, 9.0, "SC_PLAZA", ["ffa"]], ["sp_p6", -12.0, 0.0, "SC_PLAZA", ["ffa"]],
];

function clearance(x, z) {
  let best = 99;
  for (let a = 0; a < 32; a++) {
    const th = (a / 32) * Math.PI * 2;
    for (let r = 0.25; r <= 3.0; r += 0.25) {
      if (blockedAt(x + Math.cos(th) * r, z + Math.sin(th) * r, 1.0)) { if (r < best) best = r; break; }
    }
  }
  return best;
}
function inwardYawFor(cluster, x, z) {
  const meta = CLUSTER_META[cluster];
  if (meta.inward != null) return meta.inward;
  // SC_PLAZA: inward = toward the plaza centre from the point
  const dx = -5 - x, dz = -2 - z;
  return Math.atan2(-dx, -dz);
}
function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
// best-view yaw within ±60° of the cluster's inward normal (C6)
function coneYaw(x, z, cluster) {
  const c0 = inwardYawFor(cluster, x, z);
  let by = c0, bv = 0;
  for (let k = -12; k <= 12; k++) {
    const yaw = normAng(c0 + (k / 12) * (Math.PI / 3));
    const v = ray(x, z, -Math.sin(yaw), -Math.cos(yaw), 1.6);
    if (v > bv) { bv = v; by = yaw; }
  }
  return [by, bv];
}
// repair: nudge ≤4 m to a walkable spot with clearance ≥1.5 and coned view ≥8,
// and (G-D clause 3) no ray ≥40 m from the point.
function placePoint(id, x0, z0, cluster) {
  for (let r = 0; r <= 4.01; r += 0.5) {
    for (let a = 0; a < (r === 0 ? 1 : 24); a++) {
      const th = (a / 24) * Math.PI * 2;
      const x = Math.round((x0 + Math.cos(th) * r) * 2) / 2;
      const z = Math.round((z0 + Math.sin(th) * r) * 2) / 2;
      if (!walkable(x, z)) continue;
      const cr = clearance(x, z); if (cr < 1.5) continue;
      const [yaw, view] = coneYaw(x, z, cluster);
      if (view < 8.0) continue;
      const pr = profile([[x, z]]);
      if (pr.maxes[0] >= 40.0) continue; // G-D: no keyhole originates at a spawn
      return { x, z, yaw, clear: cr, view, longest: pr.maxes[0] };
    }
  }
  return null;
}

const points = [];
const unplaced = [];
for (const [id, x0, z0, cluster, modes] of SP) {
  const got = placePoint(id, x0, z0, cluster);
  if (!got) { unplaced.push(id); continue; }
  // dedupe: ≥3 m from every already-accepted point
  const clash = points.find((p) => Math.hypot(p.x - got.x, p.z - got.z) < 3.0);
  if (clash) { unplaced.push(`${id} (spacing vs ${clash.id}@${clash.x},${clash.z} got ${got.x},${got.z})`); continue; }
  const cov = Math.round((1 - profile([[got.x, got.z]], 1.0, 16).all.filter((d) => d > 4).length / 16) * 10) / 10;
  points.push({ id, cluster, modes: modes || ALL.slice(), x: got.x, z: got.z, yaw: Math.round(got.yaw * 100) / 100, clear: got.clear, view: got.view, cover: Math.min(0.9, Math.max(0.1, cov)) });
}

// ===========================================================================
console.log("=== LANTERNWALK ARENA GATES (G-A…G-K) ===");
console.log(`bounds X[${AB.x0},${AB.x1}] Z[${AB.z0},${AB.z1}]  boxes ${boxes.length}  walkable cells ${pts.length} (reach ${reach.length})`);

// ---- G-A walkable area + connectivity
gate("G-A", groundArea >= 2400 && groundArea <= 2800 && strayArea <= 60,
  `walkable ground ${groundArea.toFixed(0)} m² (target 2400–2800), disconnected stray ${strayArea.toFixed(0)} m² (≤60)`);

// ---- G-B per-actor surface
const perActor = (groundArea + 250) / 10; // + measured balcony ring ≈250 m²
gate("G-B", perActor >= 250 && perActor <= 320, `per-actor surface ${perActor.toFixed(0)} m² (target 250–320, incl. ~250 m² balcony)`);

// ---- sightline profile (G-C, G-D)
const S = sample(reach, 900);
const P = profile(S);
const bandPct = (lo, hi) => (P.all.filter((d) => d >= lo && d < hi).length / P.all.length) * 100;
const under6 = bandPct(0, 6), under15 = bandPct(0, 15);
gate("G-C", under6 >= 40 && under15 >= 70, `band mix <6 m ${under6.toFixed(1)}% (≥40), <15 m ${under15.toFixed(1)}% (≥70)`);
const ge55 = bandPct(55, 999), ge40 = bandPct(40, 999);
const spawnLong = points.filter((p) => p.longest >= 40);
// "0.0% ≥ 55 m" is arena.md's own measurement convention: its twelve accepted
// 55–67 m keyholes (§4.4, residual R3) existed while it reported 0.0%, so the
// gate is <0.05% (rounds to 0.0), not literal zero.
gate("G-D", ge55 < 0.05 && ge40 <= 1.5 && spawnLong.length === 0,
  `rays ≥55 m ${ge55.toFixed(3)}% (<0.05, R3 keyholes accepted), ≥40 m ${ge40.toFixed(2)}% (≤1.5), spawns with a ≥40 m ray: ${spawnLong.length}`);

// ---- G-E 10-actor occupancy
{
  let rs = 12345; const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296;
  const TR = 1500; const nearest = []; let anyLos = 0;
  for (let t = 0; t < TR; t++) {
    const me = reach[Math.floor(rnd() * reach.length)];
    let nd = 1e9, seenN = 0;
    for (let k = 0; k < 9; k++) {
      const o = reach[Math.floor(rnd() * reach.length)];
      const d = Math.hypot(me[0] - o[0], me[1] - o[1]);
      if (d < nd) nd = d;
      if (seenN === 0 && los(me, o)) seenN++;
    }
    nearest.push(nd); if (seenN > 0) anyLos++;
  }
  nearest.sort((a, b) => a - b);
  const med = pct(nearest, 0.5), p90 = pct(nearest, 0.9), pl = (anyLos / TR) * 100;
  gate("G-E", med <= 12 && p90 <= 22 && pl >= 70,
    `nearest-of-9 median ${med.toFixed(1)} m (≤12), p90 ${p90.toFixed(1)} m (≤22), P(≥1 in LOS) ${pl.toFixed(1)}% (≥70)`);
}

// ---- G-F loop probe: every spawn ↔ every spawn + both flags; no dead-end rects
{
  const fields = new Map();
  const d0 = bfs(snap([points[0].x, points[0].z]));
  let unreachable = 0;
  for (const p of points.slice(1)) {
    const d = pathLen(d0, [p.x, 0, p.z].filter((_, i) => i !== 1).map(Number) && [p.x, p.z]);
    if (isNaN(d)) { unreachable++; note(`G-F: ${p.id} unreachable from ${points[0].id}`); }
  }
  const dW = pathLen(d0, [FLAG_WEST[0], FLAG_WEST[2]]);
  const dE = pathLen(d0, [FLAG_EAST[0], FLAG_EAST[2]]);
  // dead-end rect check: every ground walkRect must connect to ≥2 others
  const L = C.walkRects.filter((r) => !r.y);
  const rectCells = (r) => reach.filter(([x, z]) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]);
  const overlaps = (a, b, pad = 0.6) =>
    a.min[0] <= b.max[0] + pad && a.max[0] >= b.min[0] - pad &&
    a.min[1] <= b.max[1] + pad && a.max[1] >= b.min[1] - pad;
  const deadEnds = [];
  for (const r of L) {
    let conn = 0;
    for (const o of L) if (o !== r && overlaps(r, o)) conn++;
    if (conn < 2) deadEnds.push(`${r.id}(${conn})`);
  }
  gate("G-F", unreachable === 0 && !isNaN(dW) && !isNaN(dE) && deadEnds.length === 0,
    `spawn connectivity ${points.length - 1 - unreachable}/${points.length - 1}, flags reachable ${!isNaN(dW) && !isNaN(dE)}, dead-end rects: ${deadEnds.length ? deadEnds.join(",") : "none"}`);
}

// ---- G-G spawn validity (incl. the C7b per-mode cluster counts)
{
  let fails = [];
  if (points.length < 40 || points.length > 50) fails.push(`count ${points.length} outside 40–50`);
  if (unplaced.length) fails.push(`unplaced: ${unplaced.join(",")}`);
  for (const p of points) {
    if (!walkable(p.x, p.z)) fails.push(`${p.id} not walkable`);
    if (p.clear < 1.5) fails.push(`${p.id} clearance ${p.clear}`);
    if (p.view < 8) fails.push(`${p.id} view ${p.view.toFixed(1)}`);
    const dCone = Math.abs(normAng(p.yaw - inwardYawFor(p.cluster, p.x, p.z)));
    if (dCone > Math.PI / 3 + 0.02) fails.push(`${p.id} yaw outside ±60° cone`); // 0.02 = 2-dp yaw rounding
  }
  const byCluster = {};
  for (const p of points) (byCluster[p.cluster] = byCluster[p.cluster] || []).push(p);
  for (const [cid, ps] of Object.entries(byCluster)) {
    const xs = ps.map((p) => p.x), zs = ps.map((p) => p.z);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    let maxPair = 0;
    for (const a of ps) for (const b of ps) maxPair = Math.max(maxPair, Math.hypot(a.x - b.x, a.z - b.z));
    if (area < 110) fails.push(`${cid} bbox ${area.toFixed(0)} m² < 110`);
    if (maxPair < 14) fails.push(`${cid} max pair separation ${maxPair.toFixed(1)} m < 14`);
  }
  // per-mode counts — the C7b regression stopper
  for (const mode of ALL) {
    for (const [cid, meta] of Object.entries(CLUSTER_META)) {
      if (meta.modes && !meta.modes.includes(mode)) continue;
      const n = (byCluster[cid] || []).filter((p) => p.modes.includes(mode)).length;
      if (n < 6) fails.push(`mode ${mode}: cluster ${cid} has ${n} eligible (<6)`);
    }
  }
  // C7b V8/V9 for CTF-eligible points: ≥6 m from own flag; no LOS to own
  // stand from under 10 m
  for (const p of points) {
    if (!p.modes.includes("ctf")) continue;
    const side = CLUSTER_META[p.cluster].side;
    if (side === "mid") continue;
    const own = side === "west" ? FLAG_WEST : FLAG_EAST;
    const d = Math.hypot(p.x - own[0], p.z - own[2]);
    if (d < 6) fails.push(`${p.id} V8: ${d.toFixed(1)} m from own flag`);
    if (d < 10 && los([p.x, p.z], [own[0], own[2]])) fails.push(`${p.id} V9: LOS to own stand at ${d.toFixed(1)} m`);
  }
  gate("G-G", fails.length === 0, fails.length ? fails.join(" | ") : `${points.length} points, 7 clusters, per-mode counts ≥6, yaw cones ok`);
}

// ---- G-H boundary probe — no invisible walls
{
  const samples = [];
  for (let x = AB.x0; x <= AB.x1; x += 2) { samples.push([x, AB.z0, 0, 1]); samples.push([x, AB.z1, 0, -1]); }
  for (let z = AB.z0; z <= AB.z1; z += 2) { samples.push([AB.x0, z, 1, 0]); samples.push([AB.x1, z, -1, 0]); }
  const solidNear = (x, z) => {
    for (const b of buckets[bidx(x, z)]) {
      if (x >= b.min[0] - 0.5 && x <= b.max[0] + 0.5 && z >= b.min[2] - 0.5 && z <= b.max[2] + 0.5 &&
          b.min[1] <= 1.0 && b.max[1] >= 1.0) return true;
    }
    return false;
  };
  const bad = [];
  for (const [x, z, nx, nz] of samples) {
    if (solidNear(x, z)) continue;
    // geometry may sit just beyond the AABB (base-room rims): scan outward 3 m
    let found = false;
    for (let t = 0.5; t <= 3.0; t += 0.5) {
      const px = x - nx * t, pz = z - nz * t; // outward = −inward normal
      for (const b of boxes) {
        if (px >= b.min[0] - 0.3 && px <= b.max[0] + 0.3 && pz >= b.min[2] - 0.3 && pz <= b.max[2] + 0.3 &&
            b.min[1] <= 1.0 && b.max[1] >= 1.0) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) bad.push(`(${x.toFixed(0)},${z.toFixed(0)})`);
  }
  gate("G-H", bad.length === 0, bad.length ? `open boundary at ${bad.slice(0, 8).join(" ")}${bad.length > 8 ? ` +${bad.length - 8}` : ""}` : `all ${samples.length} perimeter samples backed by geometry`);
}

// ---- G-I CTF parity
{
  const dPlaza = bfs(snap([-5, -2]));
  const p3w = pathLen(dPlaza, [FLAG_WEST[0], FLAG_WEST[2]]);
  const p3e = pathLen(dPlaza, [FLAG_EAST[0], FLAG_EAST[2]]);
  const p3d = (Math.abs(p3w - p3e) / ((p3w + p3e) / 2)) * 100;
  // P4 semantics: attacker spawn → enemy flag, as the MEAN path length over
  // each side's whole CTF spawn distribution (three clusters per side) — the
  // expected respawn-to-attack distance, not a centroid proxy.
  const WSIDE = ["SC_LANTERN", "SC_ARCADE", "SC_WEST"], ESIDE = ["SC_MARKET", "SC_GALLERY", "SC_NORTH"];
  const dFromE = bfs(snap([FLAG_EAST[0], FLAG_EAST[2]]));
  const dFromW = bfs(snap([FLAG_WEST[0], FLAG_WEST[2]]));
  const wPts = points.filter((p) => WSIDE.includes(p.cluster) && p.modes.includes("ctf"));
  const ePts = points.filter((p) => ESIDE.includes(p.cluster) && p.modes.includes("ctf"));
  const p4w = mean(wPts.map((p) => pathLen(dFromE, [p.x, p.z])));
  const p4e = mean(ePts.map((p) => pathLen(dFromW, [p.x, p.z])));
  const p4d = (Math.abs(p4w - p4e) / ((p4w + p4e) / 2)) * 100;
  const lw = profile([[FLAG_WEST[0], FLAG_WEST[2]]]).maxes[0];
  const le = profile([[FLAG_EAST[0], FLAG_EAST[2]]]).maxes[0];
  const p5d = Math.abs(lw - le);
  const covW = C.cover.filter((cv) => Math.hypot(cv.pos[0] - FLAG_WEST[0], cv.pos[2] - FLAG_WEST[2]) <= 5.5).length;
  const covE = C.cover.filter((cv) => Math.hypot(cv.pos[0] - FLAG_EAST[0], cv.pos[2] - FLAG_EAST[2]) <= 5.5).length;
  gate("G-I", p3d <= 8 && p4d <= 8 && p5d <= 10 && covW === covE && covW >= 4,
    `P3 mid→flag ${p3w.toFixed(1)}/${p3e.toFixed(1)} m (${p3d.toFixed(1)}% ≤8) | P4 atk→enemy ${p4w.toFixed(1)}/${p4e.toFixed(1)} m (${p4d.toFixed(1)}% ≤8) | P5 longest-into-site ${lw.toFixed(1)}/${le.toFixed(1)} m (Δ${p5d.toFixed(1)} ≤10) | P2 cover ${covW}/${covE}`);
  note(`flag separation ${pathLen(bfs(snap([FLAG_WEST[0], FLAG_WEST[2]])), [FLAG_EAST[0], FLAG_EAST[2]]).toFixed(1)} m of path`);
}

// ---- G-J TDM parity (home centroid → walkable centroid ±8%)
{
  // TDM parity measures the TDM spawn distribution — tdm-eligible points only
  const homeW = points.filter((p) => (p.cluster === "SC_LANTERN" || p.cluster === "SC_ARCADE") && p.modes.includes("tdm"));
  const homeE = points.filter((p) => (p.cluster === "SC_MARKET" || p.cluster === "SC_GALLERY") && p.modes.includes("tdm"));
  const cw = [mean(homeW.map((p) => p.x)), mean(homeW.map((p) => p.z))];
  const ce = [mean(homeE.map((p) => p.x)), mean(homeE.map((p) => p.z))];
  const centroid = snap([mean(reach.map((p) => p[0])), mean(reach.map((p) => p[1]))]);
  const dw = pathLen(bfs(snap(cw)), centroid);
  const de = pathLen(bfs(snap(ce)), centroid);
  const dd = (Math.abs(dw - de) / ((dw + de) / 2)) * 100;
  gate("G-J", dd <= 8,
    `home(${cw[0].toFixed(1)},${cw[1].toFixed(1)})/(${ce[0].toFixed(1)},${ce[1].toFixed(1)}) → centroid(${centroid[0].toFixed(1)},${centroid[1].toFixed(1)}) ${dw.toFixed(1)}/${de.toFixed(1)} m (${dd.toFixed(1)}% ≤8)`);
}

// ---- lane graph contract (Part 3.9 — five properties, W4 data)
{
  const fails = [];
  const J = LANES.junctions;
  const adj = new Map(Object.keys(J).map((k) => [k, []]));
  for (const ln of LANES.lanes) {
    if (!J[ln.a]) fails.push(`${ln.id}: endpoint ${ln.a} not a junction`);
    if (!J[ln.b]) fails.push(`${ln.id}: endpoint ${ln.b} not a junction`);
    if (J[ln.a] && J[ln.b] && ln.a !== ln.b) { adj.get(ln.a).push(ln.b); adj.get(ln.b).push(ln.a); }
    const chain = [J[ln.a], ...ln.wp, J[ln.b]].filter(Boolean);
    for (let i = 0; i < chain.length; i++) {
      const w = chain[i];
      if (w[1] > 0.5) continue; // balcony waypoint — ground grid cannot judge it
      if (!walkable(w[0], w[2]) || !reachKeys.has(key(snap([w[0], w[2]])[0], snap([w[0], w[2]])[1]))) {
        const s = snap([w[0], w[2]]);
        if (Math.hypot(s[0] - w[0], s[1] - w[2]) > 0.75) fails.push(`${ln.id} wp[${i}] (${w[0]},${w[2]}) off nav`);
      }
      if (i > 0 && Math.abs(chain[i - 1][1] - w[1]) < 0.5) {
        const d = Math.hypot(chain[i - 1][0] - w[0], chain[i - 1][2] - w[2]);
        if (d > 12.001) fails.push(`${ln.id} wp[${i - 1}]→wp[${i}] gap ${d.toFixed(1)} m > 12`);
      }
    }
    if (ln.a === ln.b && ln.throughGoing !== false) fails.push(`${ln.id}: self-loop must be throughGoing:false`);
  }
  if (LANES.lanes.find((l) => l.id === "L_BALCONY" && l.throughGoing !== false)) fails.push("L_BALCONY must be throughGoing:false (V8)");
  // cycle: |edges| ≥ |nodes| on the connected component ⇒ at least one cycle
  const nEdges = LANES.lanes.filter((l) => l.a !== l.b).length;
  if (nEdges < Object.keys(J).length) fails.push("graph has no cycle");
  for (const k of Object.keys(LANES.approaches || {})) {
    for (const id of LANES.approaches[k]) if (!LANES.lanes.find((l) => l.id === id)) fails.push(`approaches.${k}: unknown lane ${id}`);
  }
  gate("G-LANES", fails.length === 0, fails.length ? fails.join(" | ") : `${Object.keys(J).length} junctions, ${LANES.lanes.length} lanes, cycle ok, waypoints on nav`);
}

// ---- G-K prop placement gate (probe_props against the lanternwalk map)
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "probe_props.mjs")], {
    cwd: ROOT, env: Object.assign({}, process.env, { BLACKRIDGE_MAP: "lanternwalk" }),
    encoding: "utf8", timeout: 120000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const tail = out.trim().split(/\r?\n/).slice(-3).join(" · ");
  gate("G-K", r.status === 0, `probe_props.mjs exit ${r.status} — ${tail}`);
}

// ===========================================================================
if (anyFail) {
  console.log("\nRESULT: FAIL");
  process.exit(1);
}
console.log("\nRESULT: PASS");

// --------------------------------------------------------------- --emit
if (EMIT) {
  const file = path.join(ROOT, "content.json");
  const content = JSON.parse(fs.readFileSync(file, "utf8"));

  const byCluster = {};
  for (const p of points) (byCluster[p.cluster] = byCluster[p.cluster] || []).push(p);
  const clusters = {};
  for (const [cid, meta] of Object.entries(CLUSTER_META)) {
    const ps = byCluster[cid] || [];
    const anchor = snap([mean(ps.map((p) => p.x)), mean(ps.map((p) => p.z))]);
    clusters[cid] = {
      anchor: [Math.round(anchor[0] * 2) / 2, 0, Math.round(anchor[1] * 2) / 2],
      node: meta.node,
      inwardYaw: meta.inward != null ? Math.round(meta.inward * 100) / 100 : null,
      side: meta.side,
    };
    if (meta.modes) clusters[cid].modes = meta.modes.slice();
  }

  content.arena = {
    id: "lanternwalk",
    bounds: { min: C.bounds.min.slice(), max: C.bounds.max.slice() },
    vetoOverrides: { v1M: 12.0, v2LosM: 25.0, v3ConeM: 20.0 },
    _comment: "PROBE-EMITTED by tools/probe_arena.mjs --emit (measured geometry; PVP_BUILD_PLAN Part 4.2). Do not hand-edit spawnPoints/clusters/flags.",
  };
  content.clusters = clusters;
  content.spawnPoints = points.map((p) => ({
    id: p.id, pos: [p.x, 0, p.z], yaw: p.yaw, cluster: p.cluster,
    cover: p.cover, modes: p.modes, zoneHint: CLUSTER_META[p.cluster].node,
  }));
  content.flags = [
    { id: "flag_amber", team: 0, home: FLAG_WEST.slice(), node: "lantern_yard", standR: 1.2, standH: 2.5 },
    { id: "flag_slate", team: 1, home: FLAG_EAST.slice(), node: "exchange_house", standR: 1.2, standH: 2.5 },
  ];

  fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
  console.log(`emitted spawnPoints[${points.length}] / clusters[${Object.keys(clusters).length}] / flags[2] / arena → content.json`);
}
