// DYEFIELD — FFA spawn generator (CONTRACT_FFA §F1 "Spawns", §F4 "gen_ffa_spawns fairness report"; lane CORE).
// THREE-free, deterministic, node only.
//
//   node _harness/gen_ffa_spawns.ts                          # all built maps: generate + fairness report (no write)
//   node _harness/gen_ffa_spawns.ts --map pier18,lockwell     # some maps
//   node _harness/gen_ffa_spawns.ts --write                   # … and write maps.json <map>.ffaSpawns + a _changes note
//   node _harness/gen_ffa_spawns.ts --check                   # verify the ffaSpawns already in maps.json (no search)
//
// Method: 8 spawns by FARTHEST-POINT SAMPLING over the map's CORE nav nodes (the strongly connected component around
// team pad A — the set the bots' goals live in), on NAV distance (A* edge costs, symmetrised: (d(a→b) + d(b→a)) / 2).
// The maps are rot180-symmetric, so the sampling runs over MIRROR PAIRS (a node and the node at (−x, y, −z)): 4 pairs,
// each pair added together. Every candidate node must pass the F1 site rules:
//   * floor: a paintable floor texel under it with ny ≥ 0.9, and the whole 1.6 m drop-pad disc on flat paintable floor;
//   * ≥ 2.5 m clearance to walls (knee + chest sphere sweeps, 16 directions, grates included) and to edges (floor at the
//     same level on rings of 0.8 / 1.6 / 2.5 m, 16 directions) and ≥ 3 m of headroom (nothing overhead);
//   * the disc (+ 0.5 m) clear of grates, conveyors, springs, oob volumes and the A/B team pads' footprint.
// FPS is started from every pair; the best results are polished by a swap search (replace one pair by another candidate
// pair while the score improves). Score: the smallest nearest-spawn distance + ¼ of the mean, minus a penalty when a
// spawn's nav distance to the map centroid or to its nearest other spawn strays > 12 % from the mean (the gate is ±15 %),
// minus a penalty when a spawn's TERRITORY (the core nav nodes nearer to it than to any other spawn, by nav distance —
// the floor it can claim first) strays > 15 % from the mean. The territory term is ours, not an F1 gate: measured on the
// first Pier 18 set, the base-deck spawns owned ~370 nodes against ~800 for the corner spawns, and those crews finished
// FFA bot matches at 3.2–4.0 % (the F4 floor is 4 %). Cinder stays unbalanced (±47 %): its site-ok floor is the two
// beaches, and a heavier territory weight (400, all FPS starts polished) only packed the spawns two to a corner
// (nearest spawn 9 m) at ±43 % — so the weight stays 150 and Cinder's territory spread is reported, not fixed.
// Yaw faces the nav path toward the map centroid (the point ~6 m along it), in DEGREES like maps.json spawns.
//
// CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1): the FFA spawn-site POOL (maps.json <map>.ffaSites; ffaSpawns is kept as it is)
//   node _harness/gen_ffa_spawns.ts --count auto [--map ...]          # generate the pool + report (no write)
//   node _harness/gen_ffa_spawns.ts --count auto --write              # … and write maps.json <map>.ffaSites + a _changes note
//   node _harness/gen_ffa_spawns.ts --count 20 --map pier18           # a fixed size (even on a rot180 map)
//   node _harness/gen_ffa_spawns.ts --check                           # also verifies ffaSites (rules + regenerated = stored)
// The pool = the 8 ffaSpawns (same order) + new sites under the SAME site rules (floor ny, clearance incl. a map's
// ffaSpawnRules, off grates / conveyors / springs / oob / team pads), added in rot180 mirror pairs by HIDDEN COVERAGE:
// the respawn needs a site no foe sees (S2 / S6 "≥ 90 % unseen"), so over a seeded model of 600 layouts of 7 foes kept
// 14 m apart (FFA bots spread out) each new pair is the one that most often gives a layout with < 2 available sites (no foe
// seeing its chest within 30 m — no mist rule: a respawned runner is tall —, none within 3 m) one more, among the pairs
// keeping ≥ POOL_SPREAD m (nav)
// from every pool site (ties: the farther, then the lower index; none keeps it: the farthest pair). Size `auto`: one site per
// POOL_AREA_PER_SITE m² of core floor (territory samples × 4 m²), rounded to an even count, clamped to 16–24. Gates: the
// size in 16–24, every site site-ok, every pair of sites ≥ POOL_MIN_GAP m apart by nav, all mutually reachable; --check
// also regenerates the pool and requires it to equal the stored one (so the file and this generator cannot drift).
// Exit: 0 every map fair (and written with --write) · 1 a map failed a rule · 2 setup failure.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById, playableMaps, type MapDef } from '../runtime/src/core/data.ts';
import { conveyorAt, featuresOf, loadMapGeometry, oobAt, springAt, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { buildNav, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { padsOf, MATCH_FFA } from '../runtime/src/core/match/world.ts';
import { COMBAT, HITBOX, MOVE } from '../runtime/src/core/config.ts';
import { hash32, mulberry32 } from '../runtime/src/core/rng.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPS_JSON = resolve(HERE, '..', 'data', 'maps.json');
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const WRITE = argv.includes('--write');
const CHECK = argv.includes('--check');
const MAP_IDS = arg('--map', '').split(',').map((s) => s.trim()).filter(Boolean);
/** CHANGED(SPAWNS): --count auto | N → the site-pool mode (maps.json ffaSites); '' = the 8-spawn mode as before */
const COUNT_RAW = arg('--count', '').trim();
const POOL = COUNT_RAW !== '';
const POOL_MIN = 16, POOL_MAX = 24;
/** m² of core floor per pool site (auto size). Measured core floor 2026-09-30: pier18 4936, lockwell 4368 (its upper
 *  decks included), cinder 5144 m² → 22 / 20 / 24 sites. The respawn wants several SAFE candidates (unseen, ≥ 12 m from 7
 *  foes: each foe rules out ~450 m² of floor), so the density sits at the dense end the 16–24 range allows (150 m² put
 *  every map at the 24 cap: no longer sized to the map; 250 m² gave 20 / 18 / 20) */
const POOL_AREA_PER_SITE = 200;
/** m: the nav distance every two pool sites keep (gate) */
const POOL_MIN_GAP = 6;
/** m: a foe farther than this never sees a site (world.ts MATCH_FFA.seeRange) — the exposure measure's range */
const POOL_SEE_RANGE = 30;
/** the hidden-coverage choice of the new pool sites (see genPool): POOL_MC_K foe layouts of POOL_MC_FOES foes kept
 *  POOL_MC_SEP m apart; each new pair adds the most layouts-with-fewer-than-POOL_MC_WANT-available-sites, among the pairs
 *  keeping POOL_SPREAD m (nav) from every pool site */
const POOL_MC_K = Number(arg("--mc-k", "600")), POOL_MC_FOES = 7, POOL_MC_SEP = Number(arg("--mc-sep", "14")), POOL_MC_WANT = Number(arg("--want", "2"));
/** held-out layouts judging the final pool (report only) */
const POOL_MC_JUDGE_K = 3000;
const POOL_SPREAD = Number(arg("--spread", "9"));

// ── the F1 site rules ──
const N_SPAWNS = 8;
const PAD_R = MATCH_FFA.padRadius;   // 1.6 m
// CLEAR and MIN_NY are the defaults; a map may override them with maps.json <map>.ffaSpawnRules {clear, minNy}
// (orchestrator 2026-09-28: Cinder's isles are small basalt shelves — under the defaults only its two beaches
// qualified, 4 spawns shared each beach and FFA crews finished at 2.8-3.7 %). --clear / --minny override for trials.
const CLEAR_DEFAULT = 2.5;            // m to walls / edges
const MIN_NY_DEFAULT = 0.9;
let CLEAR = CLEAR_DEFAULT;
let MIN_NY = MIN_NY_DEFAULT;
// the centroid-distance fairness gate (default ±15 %); maps.json ffaSpawnRules.centroidGate overrides it for a map
// whose shape makes centre distance a poor fairness proxy (Cinder: a ring atoll — see the note there)
let CENTROID_GATE = 0.15;
const HEADROOM = 3.0;                 // m of free air above the pad
const FEATURE_MARGIN = 0.5;           // m around the disc: grates / conveyors / springs / oob / team pads
const FAIR = 0.15;                    // the gate: every spawn within ±15 % of the mean (centroid + nearest-spawn distance)
const TARGET = 0.12;                  // the search aims inside the gate
const THIN = 2.0;                     // m: candidate thinning grid
const TERR_TARGET = 0.15;             // territory spread the search aims inside (not a gate)
const DIRS = 16;
const GR = { grates: true } as const;

interface Candidate { node: number; x: number; y: number; z: number; mirror: number /* candidate index or -1 */ }
interface MapOut {
  id: string; spawns: Array<{ pos: [number, number, number]; yaw: number }>;
  dC: number[]; nn: number[]; devC: number; devNN: number; minPair: number; reachable: boolean; rulesOk: boolean;
  terr: number[]; devT: number;
  counts: Record<string, number>; ms: number; problems: string[];
}

// ── small graph helpers (CSR from the nav) ──
class MinHeap {
  private k: number[] = []; private v: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, val: number): void {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] < key || (k[p] === key && v[p] <= val)) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(out: [number, number]): void {
    const k = this.k, v = this.v;
    out[0] = k[0]; out[1] = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (!k.length) return;
    let i = 0; const n = k.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i, mk = lk, mv = lv;
      if (l < n && (k[l] < mk || (k[l] === mk && v[l] < mv))) { m = l; mk = k[l]; mv = v[l]; }
      if (r < n && (k[r] < mk || (k[r] === mk && v[r] < mv))) { m = r; mk = k[r]; mv = v[r]; }
      if (m === i) break;
      k[i] = k[m]; v[i] = v[m]; i = m;
    }
    k[i] = lk; v[i] = lv;
  }
}

/** single-source shortest nav distances (edge costs); pred optional */
function dijkstra(nav: NavGraph, src: number, pred?: Int32Array): Float64Array {
  const d = new Float64Array(nav.nodes).fill(Infinity);
  if (pred) pred.fill(-1);
  const h = new MinHeap(); const tmp: [number, number] = [0, 0];
  d[src] = 0; h.push(0, src);
  while (h.size) {
    h.pop(tmp);
    const du = tmp[0], u = tmp[1];
    if (du > d[u]) continue;
    for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) {
      const v = nav.edgeTo[e], nd = du + nav.edgeCost[e];
      if (nd < d[v]) { d[v] = nd; if (pred) pred[v] = u; h.push(nd, v); }
    }
  }
  return d;
}

/** the strongly connected core around node `start` (forward ∩ reverse reachability) — as bots/director.ts nodeMain */
function coreNodes(nav: NavGraph, start: number): Uint8Array {
  const fwd = new Uint8Array(nav.nodes), rev = new Uint8Array(nav.nodes);
  if (start < 0) return fwd.fill(1);
  const radj: number[][] = Array.from({ length: nav.nodes }, () => []);
  for (let u = 0; u < nav.nodes; u++) for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) radj[nav.edgeTo[e]].push(u);
  const q: number[] = [start]; fwd[start] = 1;
  for (let i = 0; i < q.length; i++) { const u = q[i]; for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) { const v = nav.edgeTo[e]; if (!fwd[v]) { fwd[v] = 1; q.push(v); } } }
  q.length = 0; q.push(start); rev[start] = 1;
  for (let i = 0; i < q.length; i++) { const u = q[i]; for (const v of radj[u]) if (!rev[v]) { rev[v] = 1; q.push(v); } }
  const out = new Uint8Array(nav.nodes);
  for (let n = 0; n < nav.nodes; n++) out[n] = fwd[n] & rev[n];
  return out;
}

// ── the site rules ──
function siteRules(def: MapDef, geo: MapGeometry, physics: PhysicsWorld, nav: NavGraph, painter: Painter,
  core: Uint8Array, counts: Record<string, number>): number[] {
  const F = featuresOf(geo);
  const A = painter.atlas;
  const pads = padsOf(def, geo);
  const grate = F.grates;
  // grate triangles' AABBs (x0, x1, y0, y1, z0, z1)
  const gbox: number[][] = [];
  for (let t = 0; t + 2 < grate.indices.length; t += 3) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = grate.indices[t + k] * 3;
      x0 = Math.min(x0, grate.positions[v]); x1 = Math.max(x1, grate.positions[v]);
      y0 = Math.min(y0, grate.positions[v + 1]); y1 = Math.max(y1, grate.positions[v + 1]);
      z0 = Math.min(z0, grate.positions[v + 2]); z1 = Math.max(z1, grate.positions[v + 2]);
    }
    gbox.push([x0, x1, y0, y1, z0, z1]);
  }
  const onGrate = (x: number, y: number, z: number): boolean => {
    for (const b of gbox) if (x >= b[0] - 0.1 && x <= b[1] + 0.1 && z >= b[4] - 0.1 && z <= b[5] + 0.1 && y >= b[2] - 0.6 && y <= b[3] + 3.2) return true;
    return false;
  };
  const floorTexel = (x: number, y: number, z: number): number => {
    const id = painter.nearest(x, y + 0.02, z, 0.35, 'floor');
    if (id < 0 || Math.abs(A.py[id] - y) > 0.15 || A.ny[id] < MIN_NY) return -1;
    return id;
  };
  const ok: number[] = [];
  const bump = (k: string): void => { counts[k] = (counts[k] ?? 0) + 1; };
  for (let n = 0; n < nav.nodes; n++) {
    if (!core[n]) { bump('not core'); continue; }
    const x = nav.x[n], y = nav.y[n], z = nav.z[n];
    // floor: physics agrees (ny ≥ 0.9) and a paintable floor texel under it
    const down = physics.raycast(x, y + 0.5, z, 0, -1, 0, 1.0, GR);
    if (!down || Math.abs(down.y - y) > 0.08 || down.ny < MIN_NY) { bump('floor ny < 0.9'); continue; }
    if (floorTexel(x, y, z) < 0) { bump('not paintable floor'); continue; }
    // team pads' footprint, springs
    let bad = false;
    for (const p of [pads.A, pads.B]) if (Math.hypot(x - p.x, z - p.z) < p.r + PAD_R + FEATURE_MARGIN && Math.abs(y - p.y) < 3) bad = true;
    if (bad) { bump('team pad footprint'); continue; }
    for (const s of F.springs) if (Math.hypot(x - s.x, z - s.z) < s.r + PAD_R + FEATURE_MARGIN && Math.abs(y - s.y) < 3) bad = true;
    if (bad) { bump('spring'); continue; }
    // the disc (+ margin): flat paintable floor inside PAD_R; no conveyor / oob / grate out to PAD_R + margin
    for (const rr of [0, 0.8, PAD_R, PAD_R + FEATURE_MARGIN]) {
      const m = rr === 0 ? 1 : DIRS;
      for (let k = 0; k < m && !bad; k++) {
        const a = (k / m) * Math.PI * 2;
        const px = x + Math.sin(a) * rr, pz = z + Math.cos(a) * rr;
        if (conveyorAt(F, px, y, pz, 0.3) >= 0 || oobAt(F, px, y + 0.1, pz) >= 0 || oobAt(F, px, y + 1.0, pz) >= 0 || onGrate(px, y, pz)) { bad = true; bump('grate/conveyor/oob'); }
        else if (rr <= PAD_R && floorTexel(px, y, pz) < 0) { bad = true; bump('pad disc off paintable floor'); }
      }
      if (bad) break;
    }
    if (bad) continue;
    // headroom
    if (physics.raycast(x, y + 0.1, z, 0, 1, 0, HEADROOM, GR) || physics.sphereCast(x, y + 0.6, z, 0, 1, 0, 0.5, HEADROOM - 0.6, GR)) { bump('headroom < 3 m'); continue; }
    // walls: knee + chest sweeps out to CLEAR
    for (let k = 0; k < DIRS && !bad; k++) {
      const a = (k / DIRS) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      if (physics.sphereCast(x, y + 0.45, z, dx, 0, dz, 0.25, CLEAR - 0.25, GR) || physics.sphereCast(x, y + 1.2, z, dx, 0, dz, 0.3, CLEAR - 0.3, GR)) bad = true;
    }
    if (bad) { bump('wall within 2.5 m'); continue; }
    // edges: floor at the same level on the rings
    for (const rr of [0.8, 1.6, CLEAR]) {
      for (let k = 0; k < DIRS && !bad; k++) {
        const a = (k / DIRS) * Math.PI * 2;
        const g = nav.ground(x + Math.sin(a) * rr, z + Math.cos(a) * rr, y - 0.3, y + 0.3);
        if (!(g === g)) bad = true;
      }
      if (bad) break;
    }
    if (bad) { bump('edge within 2.5 m'); continue; }
    ok.push(n);
  }
  counts['site ok'] = ok.length;
  return ok;
}

// ── scoring a set of candidate indices ──
interface Metrics { dC: number[]; nn: number[]; devC: number; devNN: number; minNN: number; meanNN: number; score: number; reach: boolean; terr: number[]; devT: number }
/** territory: per spawn, the sample nodes nearer (nav distance from the spawn) to it than to any other spawn */
function territory(set: number[], TS: Float32Array[]): number[] {
  const out = new Array<number>(set.length).fill(0);
  const m = TS.length ? TS[set[0]].length : 0;
  for (let s = 0; s < m; s++) {
    let b = -1, bd = Infinity;
    for (let i = 0; i < set.length; i++) { const v = TS[set[i]][s]; if (v < bd) { bd = v; b = i; } }
    if (b >= 0) out[b]++;
  }
  return out;
}
function metrics(set: number[], D: Float64Array[], DC: Float64Array, TS: Float32Array[]): Metrics {
  const k = set.length;
  const nn: number[] = [], dC: number[] = [];
  let reach = true;
  for (let i = 0; i < k; i++) {
    let m = Infinity;
    for (let j = 0; j < k; j++) if (j !== i) { const v = D[set[i]][set[j]]; if (!Number.isFinite(v)) reach = false; if (v < m) m = v; }
    nn.push(m); dC.push(DC[set[i]]);
    if (!Number.isFinite(DC[set[i]])) reach = false;
  }
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
  const dev = (a: number[]): number => { const mu = mean(a); return a.reduce((s, v) => Math.max(s, Math.abs(v - mu) / mu), 0); };
  const devC = dev(dC), devNN = dev(nn), minNN = Math.min(...nn), meanNN = mean(nn);
  const terr = territory(set, TS), devT = dev(terr);
  // soft penalties steer the search; the F1 gates (±15 %) are enforced on the result (genMap → problems → FAIL)
  const score = reach
    ? minNN + 0.25 * meanNN - 400 * Math.max(0, devNN - TARGET) - 400 * Math.max(0, devC - TARGET) - 150 * Math.max(0, devT - TERR_TARGET)
    : -1e9;
  return { dC, nn, devC, devNN, minNN, meanNN, score, reach, terr, devT };
}

async function genMap(id: string, R: Awaited<ReturnType<typeof loadRapier>>): Promise<MapOut> {
  const t0 = performance.now();
  const def = mapById(id);
  const rules = (def as unknown as { ffaSpawnRules?: { clear?: number; minNy?: number; centroidGate?: number } }).ffaSpawnRules ?? {};
  CLEAR = Number(arg('--clear', String(rules.clear ?? CLEAR_DEFAULT)));
  MIN_NY = Number(arg('--minny', String(rules.minNy ?? MIN_NY_DEFAULT)));
  CENTROID_GATE = Number(arg('--centroid-gate', String((rules as { centroidGate?: number }).centroidGate ?? 0.15)));
  console.log(`[${id}] site rules: clear ${CLEAR} m · floor ny >= ${MIN_NY}${def && (def as unknown as { ffaSpawnRules?: unknown }).ffaSpawnRules ? ' (maps.json ffaSpawnRules)' : ''}`);
  const geo = await loadMapGeometry(def);
  const physics = new PhysicsWorld(R, geo);
  const nav = buildNav(geo, physics, def);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const pads = padsOf(def, geo);
  const core = coreNodes(nav, nav.nearest(pads.A.x, pads.A.y, pads.A.z));
  const counts: Record<string, number> = { 'nav nodes': nav.nodes };
  const problems: string[] = [];

  // map centroid: the core nodes' mean (x, z) at their median height → the nearest core node
  let sx = 0, sz = 0, nc = 0; const ys: number[] = [];
  for (let n = 0; n < nav.nodes; n++) if (core[n]) { sx += nav.x[n]; sz += nav.z[n]; ys.push(nav.y[n]); nc++; }
  ys.sort((a, b) => a - b);
  const cx = sx / nc, cz = sz / nc, cy = ys[ys.length >> 1];
  let cNode = -1, cBest = Infinity;
  for (let n = 0; n < nav.nodes; n++) {
    if (!core[n]) continue;
    const d = (nav.x[n] - cx) ** 2 + (nav.z[n] - cz) ** 2 + 4 * (nav.y[n] - cy) ** 2;
    if (d < cBest) { cBest = d; cNode = n; }
  }
  const fromC = dijkstra(nav, cNode);
  // territory samples: every core node thinned to one per 2 m cell and 1 m level (≈ floor area)
  const tcell = new Map<string, number>();
  for (let n = 0; n < nav.nodes; n++) {
    if (!core[n]) continue;
    const key = `${Math.floor(nav.x[n] / THIN)},${Math.floor(nav.z[n] / THIN)},${Math.round(nav.y[n])}`;
    if (!tcell.has(key)) tcell.set(key, n);
  }
  const tSamples = [...tcell.values()].sort((a, b) => a - b);
  counts['territory samples'] = tSamples.length;
  const toSamples = (d: Float64Array): Float32Array => Float32Array.from(tSamples, (n) => d[n]);

  let out: MapOut;
  if (CHECK) {
    const cur = def.ffaSpawns ?? [];
    if (cur.length !== N_SPAWNS) { problems.push(`maps.json ${id}.ffaSpawns has ${cur.length} entries (want ${N_SPAWNS})`); }
    const nodes = cur.map((s) => nav.nearest(s.pos[0], s.pos[1], s.pos[2]));
    const ok = new Set(siteRules(def, geo, physics, nav, painter, core, counts));
    for (let i = 0; i < nodes.length; i++) if (!ok.has(nodes[i])) problems.push(`spawn ${i} (node ${nodes[i]}) breaks a site rule`);
    const D = nodes.map((n) => dijkstra(nav, n));
    const Dsym = nodes.map((_, i) => { const a = new Float64Array(nodes.length); for (let j = 0; j < nodes.length; j++) a[j] = (D[i][nodes[j]] + D[j][nodes[i]]) / 2; return a; });
    const DC = new Float64Array(nodes.map((n, i) => (D[i][cNode] + fromC[n]) / 2));
    const m = metrics(nodes.map((_, i) => i), Dsym, DC, D.map(toSamples));
    out = { id, spawns: cur.map((s) => ({ pos: [s.pos[0], s.pos[1], s.pos[2]], yaw: s.yaw })), dC: m.dC, nn: m.nn, devC: m.devC, devNN: m.devNN,
      minPair: m.minNN, reachable: m.reach, rulesOk: problems.length === 0, counts, ms: performance.now() - t0, problems, terr: m.terr, devT: m.devT };
  } else {
    const site = siteRules(def, geo, physics, nav, painter, core, counts);
    // thin to a 2 m grid (per 1 m level): the node nearest each cell centre
    const cell = new Map<string, number>();
    for (const n of site) {
      const ix = Math.floor(nav.x[n] / THIN), iz = Math.floor(nav.z[n] / THIN), iy = Math.round(nav.y[n]);
      const key = `${ix},${iz},${iy}`;
      const ccx = (ix + 0.5) * THIN, ccz = (iz + 0.5) * THIN;
      const d = (nav.x[n] - ccx) ** 2 + (nav.z[n] - ccz) ** 2;
      const prev = cell.get(key);
      if (prev === undefined || d < (nav.x[prev] - ccx) ** 2 + (nav.z[prev] - ccz) ** 2 || (d === (nav.x[prev] - ccx) ** 2 + (nav.z[prev] - ccz) ** 2 && n < prev)) cell.set(key, n);
    }
    const thin = [...cell.values()].sort((a, b) => a - b);
    // mirror pairs (rot180: (x, y, z) → (−x, y, −z)); a candidate needs a mirror candidate within 1.2 m on its level
    const C: Candidate[] = thin.map((n) => ({ node: n, x: nav.x[n], y: nav.y[n], z: nav.z[n], mirror: -1 }));
    const sym = (def.symmetry ?? '').includes('rot180');
    if (sym) {
      for (let i = 0; i < C.length; i++) {
        let best = -1, bd = 1.2 * 1.2;
        for (let j = 0; j < C.length; j++) {
          if (Math.abs(C[j].y - C[i].y) > 0.3) continue;
          const d = (C[j].x + C[i].x) ** 2 + (C[j].z + C[i].z) ** 2;
          if (d < bd || (d === bd && j < best)) { bd = d; best = j; }
        }
        C[i].mirror = best;
      }
    }
    const usable = C.map((c, i) => (!sym || (c.mirror >= 0 && c.mirror !== i && C[c.mirror].mirror === i)) ? i : -1).filter((i) => i >= 0);
    counts['candidates (2 m thinned)'] = C.length;
    counts['usable (mirror pair)'] = usable.length;
    // all-pairs nav distances between candidates (symmetrised) and to the centroid
    const fwd = C.map((c) => dijkstra(nav, c.node));
    const D: Float64Array[] = C.map((_, i) => { const a = new Float64Array(C.length); for (let j = 0; j < C.length; j++) a[j] = (fwd[i][C[j].node] + fwd[j][C[i].node]) / 2; return a; });
    const DC = new Float64Array(C.map((c, i) => (fwd[i][cNode] + fromC[c.node]) / 2));
    const TS = fwd.map(toSamples);
    // groups: mirror pairs (sym) or singletons
    const groups: number[][] = [];
    const seen = new Set<number>();
    for (const i of usable) {
      if (seen.has(i)) continue;
      if (sym) { const j = C[i].mirror; seen.add(i); seen.add(j); if (Number.isFinite(D[i][j])) groups.push([Math.min(i, j), Math.max(i, j)]); }
      else { seen.add(i); groups.push([i]); }
    }
    counts['groups'] = groups.length;
    const per = sym ? 2 : 1, need = N_SPAWNS / per;
    if (groups.length < need) {
      problems.push(`only ${groups.length} candidate ${sym ? 'pairs' : 'sites'} pass the site rules (need ${need})`);
      out = { id, spawns: [], dC: [], nn: [], devC: 1, devNN: 1, minPair: 0, reachable: false, rulesOk: false, counts, ms: performance.now() - t0, problems, terr: [], devT: 1 };
    } else {
      const flat = (gs: number[]): number[] => gs.flatMap((g) => groups[g]);
      const gDist = (a: number, b: number): number => { let m = Infinity; for (const i of groups[a]) for (const j of groups[b]) m = Math.min(m, D[i][j]); return m; };
      let best: number[] = [], bestM: Metrics | null = null;
      const consider = (gs: number[]): void => {
        const m = metrics(flat(gs), D, DC, TS);
        if (!bestM || m.score > bestM.score + 1e-9) { bestM = m; best = gs.slice(); }
      };
      // FPS from every group
      const fpsResults: Array<{ gs: number[]; score: number }> = [];
      for (let s0 = 0; s0 < groups.length; s0++) {
        const gs = [s0];
        const md = new Float64Array(groups.length);
        for (let g = 0; g < groups.length; g++) md[g] = g === s0 ? -1 : gDist(s0, g);
        while (gs.length < need) {
          let pick = -1, pd = -1;
          for (let g = 0; g < groups.length; g++) if (md[g] > pd) { pd = md[g]; pick = g; }
          if (pick < 0 || !Number.isFinite(pd)) break;
          gs.push(pick); md[pick] = -1;
          for (let g = 0; g < groups.length; g++) if (md[g] >= 0) md[g] = Math.min(md[g], gDist(pick, g));
        }
        if (gs.length === need) fpsResults.push({ gs, score: metrics(flat(gs), D, DC, TS).score });
      }
      fpsResults.sort((a, b) => b.score - a.score || a.gs[0] - b.gs[0]);
      counts['fps starts'] = fpsResults.length;
      // polish the best few by swapping one group at a time
      for (const start of fpsResults.slice(0, 10)) {
        let cur = start.gs.slice(), curS = metrics(flat(cur), D, DC, TS).score;
        for (let it = 0; it < 40; it++) {
          let bi = -1, bg = -1, bs = curS;
          for (let i = 0; i < cur.length; i++) {
            for (let g = 0; g < groups.length; g++) {
              if (cur.includes(g)) continue;
              const trial = cur.slice(); trial[i] = g;
              const sc2 = metrics(flat(trial), D, DC, TS).score;
              if (sc2 > bs + 1e-9) { bs = sc2; bi = i; bg = g; }
            }
          }
          if (bi < 0) break;
          cur[bi] = bg; curS = bs;
        }
        consider(cur);
      }
      const m = bestM!;
      const set = flat(best).sort((a, b) => (C[a].z - C[b].z) || (C[a].x - C[b].x));
      const m2 = metrics(set, D, DC, TS);
      // yaw: toward the point ~6 m along the nav path to the centroid
      const pred = new Int32Array(nav.nodes);
      const spawns = set.map((ci) => {
        const c = C[ci];
        dijkstra(nav, c.node, pred);
        const path: number[] = [];
        for (let v = cNode; v >= 0 && path.length < 100000; v = pred[v]) { path.push(v); if (v === c.node) break; }
        path.reverse();
        let tx = nav.x[cNode], tz = nav.z[cNode], acc = 0;
        for (let k = 1; k < path.length; k++) {
          acc += Math.hypot(nav.x[path[k]] - nav.x[path[k - 1]], nav.z[path[k]] - nav.z[path[k - 1]]);
          if (acc >= 6) { tx = nav.x[path[k]]; tz = nav.z[path[k]]; break; }
        }
        let yaw = Math.atan2(tx - c.x, tz - c.z) * 180 / Math.PI;
        yaw = Math.round(yaw / 5) * 5;
        if (yaw <= -180) yaw += 360;
        return { pos: [round2(c.x), round2(c.y), round2(c.z)] as [number, number, number], yaw: yaw === 0 ? 0 : yaw };
      });
      void m;
      out = { id, spawns, dC: m2.dC, nn: m2.nn, devC: m2.devC, devNN: m2.devNN, minPair: m2.minNN, reachable: m2.reach,
        rulesOk: true, counts, ms: performance.now() - t0, problems, terr: m2.terr, devT: m2.devT };
    }
  }
  physics.dispose();
  if (!out.reachable) problems.push('not all spawns are mutually reachable (or the centroid is unreachable)');
  if (out.devC > CENTROID_GATE) problems.push(`centroid distance spread ${(out.devC * 100).toFixed(1)} % > ±${(CENTROID_GATE * 100).toFixed(0)} %`);
  if (out.devNN > FAIR) problems.push(`nearest-spawn distance spread ${(out.devNN * 100).toFixed(1)} % > ±15 %`);
  out.rulesOk = problems.length === 0;
  return out;
}

function round2(v: number): number { const r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }

/** yaw (DEGREES, 5° steps) from `node` toward the point ~6 m along its nav path to the centroid node (as genMap) */
function yawToward(nav: NavGraph, node: number, cNode: number, pred: Int32Array): number {
  dijkstra(nav, node, pred);
  const path: number[] = [];
  for (let v = cNode; v >= 0 && path.length < 100000; v = pred[v]) { path.push(v); if (v === node) break; }
  path.reverse();
  let tx = nav.x[cNode], tz = nav.z[cNode], acc = 0;
  for (let k = 1; k < path.length; k++) {
    acc += Math.hypot(nav.x[path[k]] - nav.x[path[k - 1]], nav.z[path[k]] - nav.z[path[k - 1]]);
    if (acc >= 6) { tx = nav.x[path[k]]; tz = nav.z[path[k]]; break; }
  }
  let yaw = Math.atan2(tx - nav.x[node], tz - nav.z[node]) * 180 / Math.PI;
  yaw = Math.round(yaw / 5) * 5;
  if (yaw <= -180) yaw += 360;
  return yaw === 0 ? 0 : yaw;
}

// ── CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1): the spawn-site pool ──
interface PoolOut {
  id: string; count: number; auto: number; area: number;
  sites: Array<{ pos: [number, number, number]; yaw: number }>;
  /** per site: nav distance (symmetrised) to its nearest other site */
  nn: number[]; minGap: number; reachable: boolean;
  /** per site: exposure (share of the core floor samples that see it within the see range) */
  expo: number[];
  /** the foe-layout model on the final pool: share of layouts with no available site / fewer than POOL_MC_WANT, mean */
  model: { none: number; mean: number; none18: number; mean18: number };
  /** --check: stored ffaSites count and whether the regenerated pool equals it (null: not checked) */
  stored: number; same: boolean | null;
  counts: Record<string, number>; ms: number; problems: string[];
}

async function genPool(id: string, R: Awaited<ReturnType<typeof loadRapier>>): Promise<PoolOut> {
  const t0 = performance.now();
  const def = mapById(id);
  const rules = (def as unknown as { ffaSpawnRules?: { clear?: number; minNy?: number } }).ffaSpawnRules ?? {};
  CLEAR = Number(arg('--clear', String(rules.clear ?? CLEAR_DEFAULT)));
  MIN_NY = Number(arg('--minny', String(rules.minNy ?? MIN_NY_DEFAULT)));
  console.log(`[${id}] pool · site rules: clear ${CLEAR} m · floor ny >= ${MIN_NY}${(def as unknown as { ffaSpawnRules?: unknown }).ffaSpawnRules ? ' (maps.json ffaSpawnRules)' : ''}`);
  const geo = await loadMapGeometry(def);
  const physics = new PhysicsWorld(R, geo);
  const nav = buildNav(geo, physics, def);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const pads = padsOf(def, geo);
  const core = coreNodes(nav, nav.nearest(pads.A.x, pads.A.y, pads.A.z));
  const counts: Record<string, number> = { 'nav nodes': nav.nodes };
  const problems: string[] = [];

  // the centroid node (as genMap) and the core floor area (one sample per 2 m cell and 1 m level = 4 m²)
  let sx = 0, sz = 0, nc = 0; const ys: number[] = [];
  for (let n = 0; n < nav.nodes; n++) if (core[n]) { sx += nav.x[n]; sz += nav.z[n]; ys.push(nav.y[n]); nc++; }
  ys.sort((a, b) => a - b);
  const cx = sx / nc, cz = sz / nc, cy = ys[ys.length >> 1];
  let cNode = -1, cBest = Infinity;
  for (let n = 0; n < nav.nodes; n++) {
    if (!core[n]) continue;
    const d = (nav.x[n] - cx) ** 2 + (nav.z[n] - cz) ** 2 + 4 * (nav.y[n] - cy) ** 2;
    if (d < cBest) { cBest = d; cNode = n; }
  }
  const tcell = new Map<string, number>();
  for (let n = 0; n < nav.nodes; n++) {
    if (!core[n]) continue;
    const key = `${Math.floor(nav.x[n] / THIN)},${Math.floor(nav.z[n] / THIN)},${Math.round(nav.y[n])}`;
    if (!tcell.has(key)) tcell.set(key, n);
  }
  const area = tcell.size * THIN * THIN;
  // exposure of a site at node n: the share of the core floor samples (one per 2 m cell and 1 m level) whose eye sees the
  // chest of a runner standing there (the canSee ray: map collision only, 0.25 m slack) within POOL_SEE_RANGE. The chest
  // is world.ts siteSeen's: feet MOVE.skin over the floor + half the tall hit height. No mist rule (skeptic fix
  // 2026-09-30): canSee's mist hides only SLICK targets, and a respawned runner is tall
  const eyeSamples = [...tcell.values()];
  const seeR = POOL_SEE_RANGE;
  // visOf(n)[i] = 1: the eye of core sample i sees the chest of a runner standing at node n
  const visMemo = new Map<number, Uint8Array>();
  const visOf = (n: number): Uint8Array => {
    const hit = visMemo.get(n);
    if (hit) return hit;
    const x = nav.x[n], cy = nav.y[n] + MOVE.skin + HITBOX.height * 0.5, z = nav.z[n];
    const out = new Uint8Array(eyeSamples.length);
    for (let i = 0; i < eyeSamples.length; i++) {
      const s = eyeSamples[i];
      const ex = nav.x[s], ey = nav.y[s] + COMBAT.eyeHeight, ez = nav.z[s];
      const dx = x - ex, dy = cy - ey, dz = z - ez, d = Math.hypot(dx, dy, dz);
      if (d > seeR) continue;
      if (d < 1e-3) { out[i] = 1; continue; }
      const h = physics.raycast(ex, ey, ez, dx, dy, dz, d);
      if (!h || h.toi >= d - 0.25) out[i] = 1;
    }
    visMemo.set(n, out);
    return out;
  };
  const exposure = (n: number): number => { const v = visOf(n); let see = 0; for (let i = 0; i < v.length; i++) see += v[i]; return see / Math.max(1, v.length); };
  const sym = (def.symmetry ?? '').includes('rot180');
  const auto = Math.max(POOL_MIN, Math.min(POOL_MAX, 2 * Math.round(area / POOL_AREA_PER_SITE / 2)));
  const want = COUNT_RAW === '' || COUNT_RAW === 'auto' ? auto : Math.round(Number(COUNT_RAW));
  counts['core floor m²'] = area;
  if (!(want >= POOL_MIN && want <= POOL_MAX)) problems.push(`pool size ${want} outside ${POOL_MIN}–${POOL_MAX}`);
  if (sym && want % 2 !== 0) problems.push(`pool size ${want} is odd on a rot180 map (sites are added in mirror pairs)`);

  // the base: the 8 ffaSpawns, as stored
  const baseRaw = def.ffaSpawns ?? [];
  if (baseRaw.length !== N_SPAWNS) problems.push(`maps.json ${id}.ffaSpawns has ${baseRaw.length} entries (want ${N_SPAWNS})`);
  const baseNodes = baseRaw.map((s) => nav.nearest(s.pos[0], s.pos[1], s.pos[2]));
  const site = siteRules(def, geo, physics, nav, painter, core, counts);
  const siteOk = new Set(site);
  baseNodes.forEach((n, i) => { if (!siteOk.has(n)) problems.push(`ffaSpawns ${i} (node ${n}) breaks a site rule`); });

  // candidates: site-ok nodes thinned to a 2 m grid per 1 m level; rot180 mirror pairs (as genMap)
  const cell = new Map<string, number>();
  for (const n of site) {
    const ix = Math.floor(nav.x[n] / THIN), iz = Math.floor(nav.z[n] / THIN), iy = Math.round(nav.y[n]);
    const key = `${ix},${iz},${iy}`;
    const ccx = (ix + 0.5) * THIN, ccz = (iz + 0.5) * THIN;
    const d = (nav.x[n] - ccx) ** 2 + (nav.z[n] - ccz) ** 2;
    const prev = cell.get(key);
    if (prev === undefined || d < (nav.x[prev] - ccx) ** 2 + (nav.z[prev] - ccz) ** 2 || (d === (nav.x[prev] - ccx) ** 2 + (nav.z[prev] - ccz) ** 2 && n < prev)) cell.set(key, n);
  }
  const thin = [...cell.values()].sort((a, b) => a - b);
  const C: Candidate[] = thin.map((n) => ({ node: n, x: nav.x[n], y: nav.y[n], z: nav.z[n], mirror: -1 }));
  if (sym) {
    for (let i = 0; i < C.length; i++) {
      let best = -1, bd = 1.2 * 1.2;
      for (let j = 0; j < C.length; j++) {
        if (Math.abs(C[j].y - C[i].y) > 0.3) continue;
        const d = (C[j].x + C[i].x) ** 2 + (C[j].z + C[i].z) ** 2;
        if (d < bd || (d === bd && j < best)) { bd = d; best = j; }
      }
      C[i].mirror = best;
    }
  }
  const usable = C.map((c, i) => (!sym || (c.mirror >= 0 && c.mirror !== i && C[c.mirror].mirror === i)) ? i : -1).filter((i) => i >= 0);
  counts['candidates (2 m thinned)'] = C.length;
  counts['usable (mirror pair)'] = usable.length;
  const fwdC = C.map((c) => dijkstra(nav, c.node));
  const fwdB = baseNodes.map((n) => dijkstra(nav, n));
  const dCC = (i: number, j: number): number => (fwdC[i][C[j].node] + fwdC[j][C[i].node]) / 2;
  const dBC = (b: number, j: number): number => (fwdB[b][C[j].node] + fwdC[j][baseNodes[b]]) / 2;
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const i of usable) {
    if (seen.has(i)) continue;
    if (sym) { const j = C[i].mirror; seen.add(i); seen.add(j); groups.push([Math.min(i, j), Math.max(i, j)]); }
    else { seen.add(i); groups.push([i]); }
  }
  counts['groups'] = groups.length;

  // HIDDEN COVERAGE (the respawn needs a site no foe sees, CONTRACT_FFA_SPAWNS §S2/§S6 "≥ 90 % unseen"). A Monte-Carlo model
  // of the foes: POOL_MC_K layouts of POOL_MC_FOES foes on core floor samples, kept ≥ POOL_MC_SEP m apart (FFA bots spread
  // out: measured on pier18 the spread model predicts the matches' unseen-candidate counts, a uniform one does not), from a
  // stream seeded by the map id (deterministic). A site is AVAILABLE in a layout when no foe there sees its chest (the canSee
  // ray within 30 m; no mist rule) and none stands within siteClear m. Each new pair is the one that adds the most
  // availability where the pool still has fewer than POOL_MC_WANT available sites (Σ min(available, WANT) over the layouts),
  // among the pairs keeping ≥ POOL_SPREAD m (nav) from every pool site; a tie → the farther pair, then the lower index.
  // No pair keeps POOL_SPREAD m any more → the farthest pair (plain farthest point).
  const idHash = [...id].reduce((h, ch) => hash32(h, ch.charCodeAt(0)), 0x5b175e5);
  const makeLayouts = (seed: number, K: number, sep: number): Int32Array[] => {
    const mc = mulberry32(seed);
    const out: Int32Array[] = [];
    for (let k = 0; k < K; k++) {
      const foes: number[] = [];
      for (let t = 0; foes.length < POOL_MC_FOES && t < 20000; t++) {
        const c = Math.floor(mc() * eyeSamples.length);
        const n = eyeSamples[c];
        if (foes.every((f) => Math.hypot(nav.x[eyeSamples[f]] - nav.x[n], nav.z[eyeSamples[f]] - nav.z[n]) >= sep)) foes.push(c);
      }
      out.push(Int32Array.from(foes));
    }
    return out;
  };
  /** out[k] = 1: a runner standing at node n is available in layout k (no foe sees its chest, none within siteClear) */
  const availIn = (L: Int32Array[], n: number): Uint8Array => {
    const v = visOf(n);
    const out = new Uint8Array(L.length);
    for (let k = 0; k < L.length; k++) {
      let ok = 1;
      for (const f of L[k]) {
        const s = eyeSamples[f];
        if (v[f] || Math.hypot(nav.x[s] - nav.x[n], nav.y[s] - nav.y[n], nav.z[s] - nav.z[n]) < MATCH_FFA.siteClear) { ok = 0; break; }
      }
      out[k] = ok;
    }
    return out;
  };
  const layouts = makeLayouts(idHash, POOL_MC_K, POOL_MC_SEP);
  const availMemo = new Map<number, Uint8Array>();
  const avail = (n: number): Uint8Array => {
    const hit = availMemo.get(n);
    if (hit) return hit;
    const out = availIn(layouts, n);
    availMemo.set(n, out);
    return out;
  };
  const cnt = new Int32Array(layouts.length);
  for (const n of baseNodes) { const a = avail(n); for (let k = 0; k < cnt.length; k++) cnt[k] += a[k]; }
  // spread: a group's nearest nav distance to the current set (and, for a pair, the gap between its two members)
  const md = new Float64Array(groups.length);
  for (let g = 0; g < groups.length; g++) {
    let m = Infinity;
    for (const j of groups[g]) for (let b = 0; b < baseNodes.length; b++) m = Math.min(m, dBC(b, j));
    if (groups[g].length === 2) m = Math.min(m, dCC(groups[g][0], groups[g][1]));
    md[g] = Number.isFinite(m) ? m : -1;
  }
  const gain = (g: number): number => {
    let s = 0;
    const a0 = avail(C[groups[g][0]].node), a1 = groups[g].length > 1 ? avail(C[groups[g][1]].node) : null;
    for (let k = 0; k < cnt.length; k++) {
      const c = cnt[k];
      if (c >= POOL_MC_WANT) continue;
      s += Math.min(c + a0[k] + (a1 ? a1[k] : 0), POOL_MC_WANT) - c;
    }
    return s;
  };
  const picked: number[] = [];
  let spreadOnly = 0;
  while (baseNodes.length + picked.length < want) {
    let pg = -1, pv = -1, pd = -1;
    for (let g = 0; g < groups.length; g++) {
      if (!(md[g] >= POOL_SPREAD)) continue;
      const v = gain(g);
      if (v > pv || (v === pv && md[g] > pd)) { pv = v; pd = md[g]; pg = g; }
    }
    if (pg < 0) { pd = 0; for (let g = 0; g < groups.length; g++) if (md[g] > pd) { pd = md[g]; pg = g; } if (pg >= 0) spreadOnly++; }
    if (pg < 0) { problems.push(`only ${baseNodes.length + picked.length} sites: no site-ok candidate left (want ${want})`); break; }
    if (baseNodes.length + picked.length + groups[pg].length > want) { problems.push(`size ${want} cannot be filled by whole mirror pairs`); break; }
    for (const j of groups[pg]) { picked.push(j); const a = avail(C[j].node); for (let k = 0; k < cnt.length; k++) cnt[k] += a[k]; }
    md[pg] = -1;
    for (let g = 0; g < groups.length; g++) {
      if (md[g] < 0) continue;
      for (const j of groups[g]) for (const p of groups[pg]) md[g] = Math.min(md[g], dCC(p, j));
    }
  }
  counts['pairs by spread only'] = spreadOnly;
  // the verdict on the final pool (report + _changes), on HELD-OUT layouts (other seeds; the choice never saw them): foes
  // kept POOL_MC_SEP m apart and, a harder case, 18 m apart — the share of layouts with no available site, the mean count
  const poolNodes = [...baseNodes, ...picked.map((ci) => C[ci].node)];
  const judge = (L: Int32Array[]): { none: number; mean: number } => {
    const c = new Int32Array(L.length);
    for (const n of poolNodes) { const a = availIn(L, n); for (let k = 0; k < c.length; k++) c[k] += a[k]; }
    let none = 0, sum = 0;
    for (let k = 0; k < c.length; k++) { if (c[k] === 0) none++; sum += c[k]; }
    return { none: none / Math.max(1, c.length), mean: sum / Math.max(1, c.length) };
  };
  const h14 = judge(makeLayouts(hash32(idHash, 0x401d), POOL_MC_JUDGE_K, POOL_MC_SEP)), h18 = judge(makeLayouts(hash32(idHash, 0x401e), POOL_MC_JUDGE_K, 18));
  const model = { none: h14.none, mean: h14.mean, none18: h18.none, mean18: h18.mean };
  const pred = new Int32Array(nav.nodes);
  const sites: PoolOut['sites'] = [
    ...baseRaw.map((s) => ({ pos: [s.pos[0], s.pos[1], s.pos[2]] as [number, number, number], yaw: s.yaw })),
    ...picked.map((ci) => ({ pos: [round2(C[ci].x), round2(C[ci].y), round2(C[ci].z)] as [number, number, number], yaw: yawToward(nav, C[ci].node, cNode, pred) })),
  ];
  // spread: every site's nav distance to its nearest other site; mutual reachability
  const fwdOf = (k: number): Float64Array => (k < baseNodes.length ? fwdB[k] : fwdC[picked[k - baseNodes.length]]);
  const nodeOf = (k: number): number => (k < baseNodes.length ? baseNodes[k] : C[picked[k - baseNodes.length]].node);
  const nn: number[] = [];
  let reachable = true;
  for (let a = 0; a < sites.length; a++) {
    let m = Infinity;
    for (let b = 0; b < sites.length; b++) {
      if (a === b) continue;
      const d = (fwdOf(a)[nodeOf(b)] + fwdOf(b)[nodeOf(a)]) / 2;
      if (!Number.isFinite(d)) reachable = false;
      m = Math.min(m, d);
    }
    nn.push(m);
  }
  const minGap = nn.length ? Math.min(...nn) : 0;
  const expo = sites.map((_, k) => exposure(nodeOf(k)));
  if (!reachable) problems.push('not all pool sites are mutually reachable');
  if (minGap < POOL_MIN_GAP) problems.push(`two pool sites are ${minGap.toFixed(1)} m apart by nav (gate ≥ ${POOL_MIN_GAP} m)`);
  // --check: the stored pool = the regenerated one, every stored site site-ok, the first 8 = ffaSpawns
  const stored = def.ffaSites ?? [];
  let same: boolean | null = null;
  if (CHECK) {
    if (!stored.length) problems.push(`maps.json ${id} has no ffaSites`);
    else {
      same = stored.length === sites.length && stored.every((s, i) => s.pos.every((v, k) => Math.abs(v - sites[i].pos[k]) < 0.006) && s.yaw === sites[i].yaw);
      if (!same) problems.push(`the stored ffaSites (${stored.length}) differ from the regenerated pool (${sites.length})`);
      if (stored.length < POOL_MIN || stored.length > POOL_MAX) problems.push(`stored ffaSites has ${stored.length} sites (want ${POOL_MIN}–${POOL_MAX})`);
      stored.forEach((s, i) => { const n = nav.nearest(s.pos[0], s.pos[1], s.pos[2]); if (!siteOk.has(n)) problems.push(`stored ffaSites ${i} (node ${n}) breaks a site rule`); });
      const b8 = baseRaw.every((s, i) => !!stored[i] && s.pos.every((v, k) => v === stored[i].pos[k]) && s.yaw === stored[i].yaw);
      if (!b8) problems.push('the first 8 stored ffaSites are not the 8 ffaSpawns');
    }
  }
  physics.dispose();
  return { id, count: sites.length, auto, area, sites, nn, minGap, reachable, expo, model, stored: stored.length, same, counts, ms: performance.now() - t0, problems };
}

function reportPool(r: PoolOut): void {
  const mean = r.nn.reduce((s, v) => s + v, 0) / Math.max(1, r.nn.length);
  console.log(`\n── ${r.id} pool: ${r.problems.length ? 'FAIL' : 'OK'} · ${r.count} sites (auto ${r.auto} for ${r.area} m² of core floor, ${POOL_AREA_PER_SITE} m²/site, ${POOL_MIN}–${POOL_MAX}) · ${(r.ms / 1000).toFixed(1)} s`);
  console.log(`   site filter: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`   nav distance to the nearest other site: min ${r.minGap.toFixed(1)} m (gate ≥ ${POOL_MIN_GAP} m) · mean ${mean.toFixed(1)} m · mutually reachable ${r.reachable ? 'yes' : 'NO'} · held-out foe layouts (${POOL_MC_JUDGE_K} each): no available site ${(r.model.none * 100).toFixed(1)} % (foes ${POOL_MC_SEP} m apart; mean ${r.model.mean.toFixed(2)} available) / ${(r.model.none18 * 100).toFixed(1)} % (18 m apart; mean ${r.model.mean18.toFixed(2)}) · exposure mean ${(r.expo.reduce((s, v) => s + v, 0) / Math.max(1, r.expo.length) * 100).toFixed(1)} % (ffaSpawns ${(r.expo.slice(0, 8).reduce((s, v) => s + v, 0) / 8 * 100).toFixed(1)} %, new ${(r.expo.slice(8).reduce((s, v) => s + v, 0) / Math.max(1, r.expo.length - 8) * 100).toFixed(1)} %)${r.same === null ? '' : ` · stored ${r.stored} = regenerated: ${r.same ? 'yes' : 'NO'}`}`);
  console.log('    #   x        y       z       yaw°   nearest site   exposure   (0-7 = ffaSpawns)');
  r.sites.forEach((s, i) => {
    console.log(`   ${String(i).padStart(2)} ${s.pos[0].toFixed(2).padStart(7)} ${s.pos[1].toFixed(2).padStart(6)} ${s.pos[2].toFixed(2).padStart(7)} ${String(s.yaw).padStart(6)}   ${r.nn[i].toFixed(1).padStart(6)} m   ${(r.expo[i] * 100).toFixed(1).padStart(6)} %`);
  });
  for (const p of r.problems) console.log(`   PROBLEM: ${p}`);
}

/** CHANGED(SPAWNS): insert / replace <map>.ffaSites right after the map's ffaSpawns block, and the _changes note (text
 *  surgery, as writeMaps; verified: the file parses and only ffaSites / _changes differ) */
function writePool(results: PoolOut[]): void {
  const { src, eol } = readMapsLf();
  const before = JSON.parse(src) as { maps: Array<Record<string, unknown>> } & Record<string, unknown>;
  const lines = src.split('\n');
  for (const r of results) {
    const idLine = lines.findIndex((l) => l === `      "id": ${JSON.stringify(r.id)},`);
    if (idLine < 0) throw new Error(`maps.json: no map line for ${r.id}`);
    let end = lines.findIndex((l, i) => i > idLine && /^ {6}"id": /.test(l));
    if (end < 0) end = lines.length;
    const old = lines.findIndex((l, i) => i > idLine && i < end && l === '      "ffaSites": [');
    if (old >= 0) {
      const close = lines.findIndex((l, i) => i > old && l === '      ],');
      lines.splice(old, close - old + 1);
    }
    const fs0 = lines.findIndex((l, i) => i > idLine && l === '      "ffaSpawns": [');
    if (fs0 < 0) throw new Error(`maps.json: ${r.id} has no ffaSpawns block`);
    const close = lines.findIndex((l, i) => i > fs0 && l === '      ],');
    if (close < 0) throw new Error(`maps.json: ${r.id} ffaSpawns block has no close`);
    lines.splice(close + 1, 0, ...ffaBlock(r.sites, 'ffaSites').split('\n'));
  }
  const note = `2026-09-30 CHANGED(SPAWNS) ffaSites (CONTRACT_FFA_SPAWNS S1, CORE lane): ${results.map((r) => `${r.id} ${r.count} sites (${r.area} m² of core floor; nearest-site nav gap min ${r.minGap.toFixed(1)} m)`).join(', ')} — the FFA spawn-site pool the random safe respawn draws from (runtime/src/core/match/world.ts ffaSitePool / chooseSite). Generated by node _harness/gen_ffa_spawns.ts --count auto --write: the 8 ffaSpawns (unchanged, first) + new sites under the same site rules (floor ny, clearance incl. ffaSpawnRules, off grates / conveyors / springs / oob / team pads) added in rot180 mirror pairs by hidden coverage (a seeded model of ${POOL_MC_K} layouts of ${POOL_MC_FOES} foes kept ${POOL_MC_SEP} m apart; each pair adds the most layouts with fewer than ${POOL_MC_WANT} available sites, an available site = no foe sees its chest (feet MOVE.skin over the floor + half the tall hit height) within 30 m and none stands within 3 m — no mist rule since the skeptic fix of 2026-09-30: canSee's mist hides only SLICK targets and a respawned runner is tall —, among the pairs keeping ${POOL_SPREAD} m nav from the pool; held-out check, layouts with no available site (foes 14 / 18 m apart): ${results.map((r) => `${r.id} ${(r.model.none * 100).toFixed(1)} / ${(r.model.none18 * 100).toFixed(1)} %`).join(', ')}); size = one site per ${POOL_AREA_PER_SITE} m² of core floor, even, clamped to ${POOL_MIN}-${POOL_MAX}; yaw (degrees) faces the nav path to the map centre. --check regenerates and compares. ffaSpawns kept as-is for back-compat. Nothing else in this file changed.`;
  let text = lines.join('\n');
  const obj = JSON.parse(text) as Record<string, unknown>;
  const prevChanges = Array.isArray(obj._changes) ? (obj._changes as string[]).filter((c) => !c.includes('CHANGED(SPAWNS) ffaSites')) : [];
  const allChanges = [...prevChanges, note];
  const block = `  "_changes": [\n${allChanges.map((c, i) => `    ${JSON.stringify(c)}${i < allChanges.length - 1 ? ',' : ''}`).join('\n')}\n  ],`;
  const tl = text.split('\n');
  const cs = tl.findIndex((l) => l === '  "_changes": [');
  if (cs >= 0) { const ce = tl.findIndex((l, i) => i > cs && l === '  ],'); tl.splice(cs, ce - cs + 1, ...block.split('\n')); }
  else { const di = tl.findIndex((l) => l.startsWith('  "_doc": ')); tl.splice(di + 1, 0, ...block.split('\n')); }
  text = tl.join('\n');
  const after = JSON.parse(text) as typeof before;
  const strip = (o: typeof before): string => JSON.stringify({ ...o, _changes: undefined, maps: o.maps.map((m) => ({ ...m, ffaSites: undefined })) });
  if (strip(after) !== strip(before)) throw new Error('maps.json write would change more than ffaSites / _changes — aborted');
  for (const r of results) {
    const m = after.maps.find((x) => x.id === r.id) as { ffaSites?: unknown[] };
    if (!m || !Array.isArray(m.ffaSites) || m.ffaSites.length !== r.count) throw new Error(`maps.json write: ${r.id}.ffaSites missing after write`);
  }
  writeMapsEol(text, eol);
}

/** CHANGED(SPAWNS): maps.json as LF text + the file's own line ending (a Windows checkout with core.autocrlf has CRLF: the
 *  line surgery matched no line there) — the writers work on LF and write the file's ending back */
function readMapsLf(): { src: string; eol: string } {
  const raw = readFileSync(MAPS_JSON, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { src: raw.replace(/\r\n/g, '\n'), eol };
}
function writeMapsEol(text: string, eol: string): void {
  writeFileSync(MAPS_JSON, eol === '\n' ? text : text.replace(/\n/g, eol), 'utf8');
}

/** a number the way Python's json.dump writes a float (the file is Python-formatted): 12.3, 0.0, -4.0 */
function pyNum(v: number): string {
  if (Object.is(v, -0)) v = 0;
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

function ffaBlock(spawns: MapOut['spawns'], key: 'ffaSpawns' | 'ffaSites' = 'ffaSpawns'): string {
  const I = '      ';
  const lines: string[] = [`${I}"${key}": [`];
  spawns.forEach((s, i) => {
    lines.push(`${I}  {`, `${I}    "pos": [`, ...s.pos.map((v, k) => `${I}      ${pyNum(v)}${k < 2 ? ',' : ''}`), `${I}    ],`,
      `${I}    "yaw": ${pyNum(s.yaw)}`, `${I}  }${i < spawns.length - 1 ? ',' : ''}`);
  });
  lines.push(`${I}],`);
  return lines.join('\n');
}

/** insert / replace <map>.ffaSpawns right after the map's "spawns" block, and the top-level _changes note (text surgery,
 *  so the rest of the Python-formatted file stays byte-identical) */
function writeMaps(results: MapOut[]): void {
  const { src, eol } = readMapsLf();                              // CHANGED(SPAWNS): CRLF-safe (see readMapsLf)
  const before = JSON.parse(src) as { maps: Array<Record<string, unknown>> } & Record<string, unknown>;
  const lines = src.split('\n');
  for (const r of results) {
    const idLine = lines.findIndex((l) => l === `      "id": ${JSON.stringify(r.id)},`);
    if (idLine < 0) throw new Error(`maps.json: no map line for ${r.id}`);
    let end = lines.findIndex((l, i) => i > idLine && /^ {6}"id": /.test(l));
    if (end < 0) end = lines.length;
    // drop an old block
    const old = lines.findIndex((l, i) => i > idLine && i < end && l === '      "ffaSpawns": [');
    if (old >= 0) {
      const close = lines.findIndex((l, i) => i > old && l === '      ],');
      lines.splice(old, close - old + 1);
    }
    const sp = lines.findIndex((l, i) => i > idLine && l === '      "spawns": {');
    if (sp < 0) throw new Error(`maps.json: ${r.id} has no "spawns" block`);
    const close = lines.findIndex((l, i) => i > sp && l === '      },');
    if (close < 0) throw new Error(`maps.json: ${r.id} spawns block has no close`);
    lines.splice(close + 1, 0, ...ffaBlock(r.spawns).split('\n'));
  }
  // _changes (top level, after _doc)
  const note = `2026-09-28 CHANGED(CORE) ffaSpawns: ${results.map((r) => r.id).join(', ')} gained 8 FFA drop-pad spawns each (FREE-FOR-ALL, CONTRACT_FFA §F1), generated by _harness/gen_ffa_spawns.ts (farthest-point sampling over core nav nodes in rot180 mirror pairs; floor ny ≥ 0.9, ≥ 2.5 m clear of walls / edges, off grates / conveyors / springs / oob / team pads; nav distance to the centroid and to the nearest spawn within ±15 % of the mean). Authorized by the owner's FFA request; nothing else in this file changed.`;
  let text = lines.join('\n');
  const obj = JSON.parse(text) as Record<string, unknown>;
  const prevChanges = Array.isArray(obj._changes) ? (obj._changes as string[]).filter((c) => !c.includes('CHANGED(CORE) ffaSpawns')) : [];
  const allChanges = [...prevChanges, note];
  const block = `  "_changes": [\n${allChanges.map((c, i) => `    ${JSON.stringify(c)}${i < allChanges.length - 1 ? ',' : ''}`).join('\n')}\n  ],`;
  const tl = text.split('\n');
  const cs = tl.findIndex((l) => l === '  "_changes": [');
  if (cs >= 0) { const ce = tl.findIndex((l, i) => i > cs && l === '  ],'); tl.splice(cs, ce - cs + 1, ...block.split('\n')); }
  else { const di = tl.findIndex((l) => l.startsWith('  "_doc": ')); tl.splice(di + 1, 0, ...block.split('\n')); }
  text = tl.join('\n');
  // verify: parses, and only ffaSpawns / _changes differ
  const after = JSON.parse(text) as typeof before;
  const strip = (o: typeof before): string => JSON.stringify({ ...o, _changes: undefined, maps: o.maps.map((m) => ({ ...m, ffaSpawns: undefined })) });
  if (strip(after) !== strip(before)) throw new Error('maps.json write would change more than ffaSpawns / _changes — aborted');
  for (const r of results) {
    const m = after.maps.find((x) => x.id === r.id) as { ffaSpawns?: unknown[] };
    if (!m || !Array.isArray(m.ffaSpawns) || m.ffaSpawns.length !== N_SPAWNS) throw new Error(`maps.json write: ${r.id}.ffaSpawns missing after write`);
  }
  writeMapsEol(text, eol);
}

function report(r: MapOut): void {
  const pct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  console.log(`\n── ${r.id}: ${r.rulesOk ? 'FAIR' : 'FAIL'} · ${(r.ms / 1000).toFixed(1)} s`);
  console.log(`   site filter: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (r.spawns.length) {
    const mC = mean(r.dC), mN = mean(r.nn);
    console.log(`   nav distance to the map centroid: mean ${mC.toFixed(1)} m, spread ±${(r.devC * 100).toFixed(1)} % (gate ±15 %)`);
    console.log(`   nav distance to the nearest spawn: mean ${mN.toFixed(1)} m, spread ±${(r.devNN * 100).toFixed(1)} % (gate ±15 %) · min ${r.minPair.toFixed(1)} m · mutually reachable ${r.reachable ? 'yes' : 'NO'}`);
    const mT = mean(r.terr);
    console.log(`   territory (core nav samples nearest to the spawn): mean ${mT.toFixed(0)}, spread ±${(r.devT * 100).toFixed(1)} % (search target ±${TERR_TARGET * 100} %, info)`);
    console.log('    #   x        y       z       yaw°   to centroid        to nearest spawn     territory');
    r.spawns.forEach((s, i) => {
      console.log(`   ${String(i).padStart(2)} ${s.pos[0].toFixed(2).padStart(7)} ${s.pos[1].toFixed(2).padStart(6)} ${s.pos[2].toFixed(2).padStart(7)} ${String(s.yaw).padStart(6)}   ${r.dC[i].toFixed(1).padStart(5)} m (${pct(r.dC[i] / mC - 1).padStart(8)})   ${r.nn[i].toFixed(1).padStart(5)} m (${pct(r.nn[i] / mN - 1).padStart(8)})   ${String(r.terr[i] ?? '-').padStart(5)} (${pct((r.terr[i] ?? mT) / mT - 1).padStart(8)})`);
    });
  }
  for (const p of r.problems) console.log(`   PROBLEM: ${p}`);
}

async function main(): Promise<number> {
  let R: Awaited<ReturnType<typeof loadRapier>>;
  const ids = MAP_IDS.length ? MAP_IDS : playableMaps().map((m) => m.id);
  try { R = await loadRapier(); } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  console.log(`gen_ffa_spawns · maps ${ids.join(', ')} · ${CHECK ? 'check the maps.json spawns + site pools' : POOL ? `generate the site pools (--count ${COUNT_RAW})` : 'generate'}${WRITE && !CHECK ? ' + write maps.json' : ''}`);
  const results: MapOut[] = [];
  const pools: PoolOut[] = [];
  for (const id of ids) {
    try {
      // the 8 spawns: generated (plain run) or checked (--check); a pool-only run (--count) skips them
      if (!POOL || CHECK) { results.push(await genMap(id, R)); report(results[results.length - 1]); }
      // CHANGED(SPAWNS): the site pool — generated with --count, checked with --check
      if (POOL || CHECK) { pools.push(await genPool(id, R)); reportPool(pools[pools.length - 1]); }
    } catch (e) { console.log(`SETUP FAILED (${id}):`, (e as Error).stack ?? e); return 2; }
  }
  const bad = [...results.filter((r) => !r.rulesOk).map((r) => r.id), ...pools.filter((p) => p.problems.length).map((p) => `${p.id} pool`)];
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'gen_ffa_spawns.json'), JSON.stringify({ at: new Date().toISOString(), check: CHECK, count: COUNT_RAW, results, pools }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  if (WRITE && !CHECK) {
    if (bad.length) { console.log(`\nNOT WRITTEN: ${bad.join(', ')} failed`); return 1; }
    if (POOL) {
      writePool(pools);
      console.log(`\nmaps.json: ffaSites written for ${pools.map((r) => `${r.id} (${r.count})`).join(', ')} (+ the _changes note)`);
    } else {
      writeMaps(results);
      console.log(`\nmaps.json: ffaSpawns written for ${results.map((r) => r.id).join(', ')} (+ the _changes note)`);
    }
  }
  console.log(`\nRESULT: ${bad.length ? `FAIL (${bad.join(', ')})` : 'OK'}`);
  return bad.length ? 1 : 0;
}

main().then((c) => process.exit(c), (e) => { console.log('SETUP FAILED:', (e as Error)?.stack ?? e); process.exit(2); });
