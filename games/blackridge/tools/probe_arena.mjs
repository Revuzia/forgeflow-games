// tools/probe_arena.mjs [W4] — PVP arena acceptance gates G-A…G-K
// (PVP_BUILD_PLAN Part 4.1 row W4; arena.md Part 6). THREE-free, Node.
//
// Promotion of _design/pvp/arena_probe.mjs: measures the BUILT arena
// (core/level/maps/<mapId>.js via buildCollidersFor) instead of an inline
// edit list, gates every measurement, and exits non-zero on any FAIL.
//
//   node tools/probe_arena.mjs                      → lanternwalk, gates, 0/1
//   node tools/probe_arena.mjs --map=switchyard     → any registered arena
//   node tools/probe_arena.mjs --map=<id> --emit    → gates green ⇒ write the
//     MEASURED spawnPoints / clusters / flags / arena blocks into
//     content.json, under content.arenas[<id>] AND (when <id> is the arena
//     the flat keys currently hold, or the only arena in the registry) the
//     flat content.arena/clusters/spawnPoints/flags the match layer reads
//     (Part 4.2: spawn data is PROBE-EMITTED, never hand-copied — C7b
//     happened once already). Emit is refused while any gate fails.
//
// [multi-arena amendment] The probe used to hardcode LANTERNWALK three ways:
// buildCollidersFor("lanternwalk"), a static lane-graph import, and three
// top-level data constants (CLUSTER_META, the ~50 spawn seeds, FLAG_WEST/
// FLAG_EAST). All three are now map-driven: the geometry and lane graph come
// from <mapId>, and the data constants come from the ARENA_SPEC export the
// map module owns (core/level/maps/lanternwalk.js, bottom of file). Every
// gate's logic and thresholds are unchanged — only their INPUTS moved.
//
// Also validates the lane graph (core/level/lanes/<mapId>.js) against the
// five Part 3.9 contract properties — the graph is W4 data, so its gate lives
// with W4's probe.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";
import { buildCollidersFor } from "../core/level/colliders.js";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ARGV = process.argv.slice(2);
const EMIT = ARGV.includes("--emit");
// --map=<id> (default lanternwalk, so every existing invocation is unchanged)
const MAP_ID = (ARGV.find((a) => a.startsWith("--map=")) || "--map=lanternwalk").slice(6);
if (!MAP_ID) { console.error("usage: node tools/probe_arena.mjs [--map=<id>] [--emit]"); process.exit(2); }

// Map module + lane graph are dynamic: which arena runs is an argument now.
// A missing module is a HARD stop with the reason named — the probe measures
// a real build or it measures nothing (arch 1.6 rule: fail loudly, not empty).
let MAPMOD, LANES;
try {
  MAPMOD = await import(`../core/level/maps/${MAP_ID}.js`);
} catch (e) {
  console.error(`probe_arena: cannot load core/level/maps/${MAP_ID}.js — ${(e && e.message) || e}`);
  process.exit(2);
}
try {
  LANES = (await import(`../core/level/lanes/${MAP_ID}.js`)).default;
} catch (e) {
  console.error(`probe_arena: cannot load core/level/lanes/${MAP_ID}.js — ${(e && e.message) || e}`);
  process.exit(2);
}
const SPEC = MAPMOD.ARENA_SPEC;
if (!SPEC || !SPEC.clusterMeta || !SPEC.spawnSeeds || !SPEC.flagWest || !SPEC.flagEast) {
  console.error(`probe_arena: core/level/maps/${MAP_ID}.js exports no usable ARENA_SPEC ` +
    `{id, clusterMeta, spawnSeeds, flagWest, flagEast, vetoOverrides} — see lanternwalk.js for the shape`);
  process.exit(2);
}

const C = buildCollidersFor(MAP_ID, 1);
const boxes = C.boxes;
const AB = { x0: C.bounds.min[0], x1: C.bounds.max[0], z0: C.bounds.min[2], z1: C.bounds.max[2] };

// ===========================================================================
// MAP-SPECIFIC INPUTS — everything below this block is generic measurement.
// The four required fields come straight off ARENA_SPEC; the optional `gates`
// / `flagMeta` fields carry the handful of constants that used to be written
// into the gate bodies as LANTERNWALK literals. Each has a generic fallback so
// a new arena's spec can omit it, but an arena whose gate numbers were tuned
// against a specific value should state it (lanternwalk does).
// ===========================================================================
const ALL = ["tdm", "ctf", "ffa"];
const CLUSTER_META = SPEC.clusterMeta;
const SP = SPEC.spawnSeeds;              // [id, x, z, clusterId, modes|null]
const FLAG_WEST = SPEC.flagWest, FLAG_EAST = SPEC.flagEast;
const VETO = SPEC.vetoOverrides || { v1M: 12.0, v2LosM: 25.0, v3ConeM: 20.0 };
const G = SPEC.gates || {};
// bounds centre — the fallback "somewhere in the middle" for maps that do not
// pin their own. Never used by lanternwalk (its spec pins both).
const CENTRE = [(AB.x0 + AB.x1) / 2, (AB.z0 + AB.z1) / 2];
// flood-fill origin: the traversal ORDER of the walkable component seeds
// G-C/G-D's `sample()` and G-E's PRNG walk, so it is pinned per map, not
// derived — moving it re-orders `reach` and moves every downstream number.
const NAV_SEED = G.navSeed || G.mid || CENTRE;
// "middle of the arena": G-I P3's path origin and the inward-yaw target for
// side:"mid" clusters (which have inward:null).
const MID = G.mid || CENTRE;
// surface the 0.5 m GROUND grid cannot see (arena.md §4.1 — lanternwalk's
// arcade balcony ring ≈250 m²). Added to G-B's per-actor surface.
const BALCONY_M2 = G.balconyAreaM2 != null ? G.balconyAreaM2 : 0;
// CTF halves, derived from each cluster's own `side` — no map-specific list.
const WSIDE = Object.keys(CLUSTER_META).filter((k) => CLUSTER_META[k].side === "west");
const ESIDE = Object.keys(CLUSTER_META).filter((k) => CLUSTER_META[k].side === "east");
// TDM home clusters (G-J parity). Fallback = each side's whole cluster set.
const TDM_HOME_W = G.tdmHomeWest || WSIDE;
const TDM_HOME_E = G.tdmHomeEast || ESIDE;
// flag identity half; the home position always comes from flagWest/flagEast.
const FLAG_META = SPEC.flagMeta || [
  { id: "flag_amber", team: 0, node: (CLUSTER_META[WSIDE[0]] || {}).node || null, standR: 1.2, standH: 2.5 },
  { id: "flag_slate", team: 1, node: (CLUSTER_META[ESIDE[0]] || {}).node || null, standR: 1.2, standH: 2.5 },
];

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
const seedPt = pts.reduce((a, p) =>
  (Math.hypot(p[0] - NAV_SEED[0], p[1] - NAV_SEED[1]) < Math.hypot(a[0] - NAV_SEED[0], a[1] - NAV_SEED[1]) ? p : a), pts[0]);
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
// SPAWN SET — the seeds live on the map module's ARENA_SPEC (see the
// MAP-SPECIFIC INPUTS block above). The probe REPAIRS each seed (≤4 m
// nudge), re-takes yaw inside the cluster's ±60° inward cone, and EMITS —
// hand transcription is how C7b happened.
// ===========================================================================
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
  // side:"mid" cluster (lanternwalk SC_PLAZA): inward = toward the arena
  // middle from the point (gates.mid; bounds centre when a spec omits it)
  const dx = MID[0] - x, dz = MID[1] - z;
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
  points.push({ id, cluster, modes: modes || ALL.slice(), x: got.x, z: got.z, yaw: Math.round(got.yaw * 100) / 100, clear: got.clear, view: got.view, longest: got.longest, cover: Math.min(0.9, Math.max(0.1, cov)) });   // `longest` carried so G-D's spawn clause MEASURES (it was dropped here, making that clause structurally vacuous)
}

// ===========================================================================
console.log(`=== ${MAP_ID.toUpperCase()} ARENA GATES (G-A…G-K) ===`);
console.log(`bounds X[${AB.x0},${AB.x1}] Z[${AB.z0},${AB.z1}]  boxes ${boxes.length}  walkable cells ${pts.length} (reach ${reach.length})`);

// ---- G-A walkable area + connectivity
gate("G-A", groundArea >= 2400 && groundArea <= 2800 && strayArea <= 60,
  `walkable ground ${groundArea.toFixed(0)} m² (target 2400–2800), disconnected stray ${strayArea.toFixed(0)} m² (≤60)`);

// ---- G-B per-actor surface
const perActor = (groundArea + BALCONY_M2) / 10; // + measured off-grid surface (gates.balconyAreaM2)
gate("G-B", perActor >= 250 && perActor <= 320, `per-actor surface ${perActor.toFixed(0)} m² (target 250–320, incl. ~${BALCONY_M2} m² balcony)`);

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
  const dPlaza = bfs(snap(MID));
  const p3w = pathLen(dPlaza, [FLAG_WEST[0], FLAG_WEST[2]]);
  const p3e = pathLen(dPlaza, [FLAG_EAST[0], FLAG_EAST[2]]);
  const p3d = (Math.abs(p3w - p3e) / ((p3w + p3e) / 2)) * 100;
  // P4 semantics: attacker spawn → enemy flag, as the MEAN path length over
  // each side's whole CTF spawn distribution (WSIDE/ESIDE — every cluster
  // whose clusterMeta.side names that half) — the expected respawn-to-attack
  // distance, not a centroid proxy.
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
  const homeW = points.filter((p) => TDM_HOME_W.includes(p.cluster) && p.modes.includes("tdm"));
  const homeE = points.filter((p) => TDM_HOME_E.includes(p.cluster) && p.modes.includes("tdm"));
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
  // Named-lane rule, generic by construction: a map with no L_BALCONY has
  // nothing to find, so this is a no-op there rather than a false FAIL.
  if (LANES.lanes.find((l) => l.id === "L_BALCONY" && l.throughGoing !== false)) fails.push("L_BALCONY must be throughGoing:false (V8)");
  // cycle: |edges| ≥ |nodes| on the connected component ⇒ at least one cycle
  const nEdges = LANES.lanes.filter((l) => l.a !== l.b).length;
  if (nEdges < Object.keys(J).length) fails.push("graph has no cycle");
  for (const k of Object.keys(LANES.approaches || {})) {
    for (const id of LANES.approaches[k]) if (!LANES.lanes.find((l) => l.id === id)) fails.push(`approaches.${k}: unknown lane ${id}`);
  }
  gate("G-LANES", fails.length === 0, fails.length ? fails.join(" | ") : `${Object.keys(J).length} junctions, ${LANES.lanes.length} lanes, cycle ok, waypoints on nav`);
}

// ---- G-K prop placement gate (probe_props against the ACTIVE map)
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "probe_props.mjs")], {
    cwd: ROOT, env: Object.assign({}, process.env, { BLACKRIDGE_MAP: MAP_ID }),
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

  const arena = {
    id: MAP_ID,
    bounds: { min: C.bounds.min.slice(), max: C.bounds.max.slice() },
    vetoOverrides: { v1M: VETO.v1M, v2LosM: VETO.v2LosM, v3ConeM: VETO.v3ConeM },
    _comment: "PROBE-EMITTED by tools/probe_arena.mjs --emit (measured geometry; PVP_BUILD_PLAN Part 4.2). Do not hand-edit spawnPoints/clusters/flags.",
  };
  const spawnPoints = points.map((p) => ({
    id: p.id, pos: [p.x, 0, p.z], yaw: p.yaw, cluster: p.cluster,
    cover: p.cover, modes: p.modes, zoneHint: CLUSTER_META[p.cluster].node,
  }));
  const flags = [FLAG_WEST, FLAG_EAST].map((home, i) => {
    const m = FLAG_META[i] || {};
    return {
      id: m.id, team: m.team != null ? m.team : i, home: home.slice(),
      node: m.node, standR: m.standR != null ? m.standR : 1.2,
      standH: m.standH != null ? m.standH : 2.5,
    };
  });

  // [multi-arena amendment] content.json carries BOTH shapes:
  //   content.arenas[<id>]  the REGISTRY — one measured block per arena, and
  //                         the only thing this emit is allowed to overwrite
  //                         for <id>. Another map's block is never touched.
  //   content.arena / .clusters / .spawnPoints / .flags
  //                         the FLAT "currently selected arena" view. It stays
  //                         the live surface core/match/{contract,match}.js and
  //                         modes/ctf.js read (unchanged consumers — C19/R9);
  //                         boot.js's startMatch re-points it at the chosen
  //                         arena before createSim.
  // The flat view is refreshed only when it already holds THIS map (or the
  // registry has nothing else) — emitting switchyard must not silently move a
  // lanternwalk session onto switchyard geometry.
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const arenas = content.arenas || (content.arenas = {});
  arenas[MAP_ID] = { arena, spawnPoints, clusters, flags };
  const flatId = content.arena && content.arena.id;
  const only = Object.keys(arenas).length === 1;
  const refreshFlat = !flatId || flatId === MAP_ID || only;
  if (refreshFlat) {
    content.arena = clone(arena);
    content.clusters = clone(clusters);
    content.spawnPoints = clone(spawnPoints);
    content.flags = clone(flags);
  }

  fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
  console.log(`emitted spawnPoints[${points.length}] / clusters[${Object.keys(clusters).length}] / flags[${flags.length}] / arena ` +
    `→ content.arenas.${MAP_ID}${refreshFlat ? " + the flat keys" : ` (flat keys left on '${flatId}')`} in content.json`);
}
