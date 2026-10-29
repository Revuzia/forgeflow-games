/**
 * royale/towngen.js - Last Circle Wave 6, lane 6B: the TOWN LAYOUT GENERATOR (contract C-LAYOUT).
 *
 * Pure data, THREE-free, DOM-free, NO imports (it loads unchanged in Node and in Chrome: 9 map-seeds hashed identically in both, see the lane report).
 * Nothing in the live game imports this file in Wave 6; Wave 7 (lane 7A) wires it.
 *
 * API
 *   layout(seed, poi, heightFn, waterY, theme, opts?)      ONE point of interest as data (a town, a village, a farm, a compound)
 *   layoutMap(seed, mapId, pois, heightFn, waterY, opts?)   { towns: [layout per POI], compounds: [layout per site], links, stats }
 *   placeCompounds(seed, mapId, towns, heightFn, waterY)    the SEPARATE compound list (farthest-point fill; layoutMap calls it)
 *   PLANS[mapId] / planFor(mapId, poi) / defaultPois(mapId) the per-POI plan (kind, block grid, theme, reach) of the three maps
 *   enterableBoxes(layouts), summarize(layout), makeSampler(fn), mulberry32, hash32, subRng, VERSION and the constants
 *   streetProps(layout, seed)                              (Wave 7) the static street dressing of one grid layout as citykit list entries minus the height:
 *                                                          lights, hydrants, benches, planters, parked cars, parking-lot / park / yard dressing
 *   layoutMap(..., { reserve: [[x0, z0, x1, z1], ...] })   (Wave 7) rectangles of landmarks the caller keeps (Savanna's overpass and crane): no block, building or
 *                                                          compound is placed on them, and compounds keep 60 m from them like from a town
 *   PLANS[map].compounds.inner / .jitter                   (Wave 7, Savanna only) favour the interior / pick among near-best candidates at random, so the compound
 *                                                          fill is scattered instead of a lattice on the map border (0 / 0 = the Wave-6 farthest-point fill)
 *   heightFn = the BASE ground (maps.js heightAt0, before any pad / corridor is registered); pois = the map's land-snapped POI list.
 *
 * theme: 'city' (Savanna) | 'resort' (Isla Viva) | 'lodge' (Deepwood) select palette keys (manifest palettes + variants) and the parcel mix;
 * compound themes 'farm' | 'ruin' | 'mill'. opts.kind: grid kinds 'core' | 'town' | 'village' | 'yard' (cols x rows blocks of 56 m) or cluster
 * kinds 'compound' | 'farm' | 'lane' | 'green' (buildings facing a yard rectangle). opts.cols / rows / minBlocks / maxShift / reach tune the search.
 *
 * A layout (all coordinates metres, world XZ, every number rounded to 0.001; heights 0.01):
 *   id, kind, theme, seed, poi {x, z, r}, centre [x, z] (where the layout really is: a POI on water or a lake moves it; Wave 7 sets poi.x/z = centre),
 *   anchor {x, z, shift, level|axis}, stage {tries, maxShift, hard, fallback} (how far it had to search), stats {...}
 *   grid {cols, rows, pitch 56, roadW 10, sidewalkW 3, jog, rowShift[], colShift[]}   (grid kinds)
 *   blocks[] {id, i, j, cx, cz, x0, z0, x1, z1 (the 46 m block square: parcels + sidewalk), ground {min, max, relief}} + dropped[] {i, j, why}
 *   roads {nodes [{id, x, z, deg}], edges [{id, a, b, axis, len, width, sides}], portals [{node, dx, dz}] (ways out of the town), streets [maximal straight runs]}
 *   corridors [{points, width}]  -> registerCorridor(points, width)      pads [{id, shape {x0, x1, z0, z1}, height, falloff}] -> registerPad(shape, height, falloff)
 *   parcels[] {id, block, use: house|shop|midrise|tower|hall|shed|barn|shell|lot, rect, facing [fx, fz] (toward the street / yard),
 *              building {cx, cz, w, d, turn 0-3, rot = turn * PI/2, facing, aabb [x0, z0, x1, z1] (the EXACT collider box), gen 'house'|'tower'|'shell',
 *                        arch, floors (<= 3), floorH, height, enterable, palette {key, variant}, kit (shells: the manifest type), ground {min, max, med}}}
 *   doors[] {id, parcel, kind front|back|interior, floor, x, z, axis, nx, nz, width 2.26, rooms [a, b], out [x, z], street {edge, node, x, z, curb [x, z], dist}}
 *   rooms[] {id, parcel, floor, kind, cells [i0, j0, i1, j1] (local 2.5 m cells), x0, z0, x1, z1, cx, cz, area, doors[], stairs[]}
 *   stairs[] {id, parcel, from, to, x0, z0, x1, z1, dx, dz, bottom, top, rise, run 5, width 2.5, slopeDeg, approach, exit}
 *   compound (cluster kinds) {yard [x0, z0, x1, z1], fence [segments], gate, cars [{x, z, turn}], props [silo], fields [rects], entry {x, z}, bounds}
 *   bridges[] {x0, z0, x1, z1, len, width, deck}  (Riverside Mill: the lane crosses the river)
 *
 * Door convention = maps.js house(): local +Z is the front, rotateY(rot) maps it to (sin rot, cos rot); a house with rot = ROT[turn] is drawn by
 * house(b.cx, b.cz, b.w, b.d, b.rot, ...). tower() has NO rot parameter today (its door is +Z): 7A must add one (or draw turned towers another way).
 *
 * Technique: BLOCKTOOTH's grid and recursive parcel bisection (games/blocktooth/src/city/citygen.ts, splitBlock) transliterated - every parcel is
 * also forced to touch a street. Streets longer than ~150 m get a JOG (alternate columns / rows shift 12-16 m, opposite signs on the two axes, so
 * a street breaks into <= 2-block runs). Blocks below waterY + 0.8 (the generator keeps 1.5) are dropped, the grid slides to the cheapest nearby
 * dry, gentle anchor (relief ladder 6.5 / 9 / 12 m over the 56 m cell, pads flatten the rest), and the road graph is the union of the rings of the kept
 * blocks (so it never runs through a block). A POI whose own ground is water moves its layout to the nearest shore (up to its `reach`).
 * Compounds: farthest-point fill on a fixed 20 m grid over dry land, >= 60 m from every town, inside +-720 m of the map centre, as a SEPARATE list
 * (not POIs: no label, no roads, no landing heat). Counts per map are in PLANS (30 / 8 / 36: the plan's "~24" misses the citycheck coverage targets).
 *
 * DETERMINISM: a pure function of (seed, poi, heightFn, waterY, theme, opts, the towns laid out before it on the same map). The RNG is
 * mulberry32(seed ^ hash32(poi.id)) - the same generator as the sim's (implemented locally so this module has no imports; the selftest asserts the
 * sequences are identical), with independent derived streams per block / parcel / site. Only + - * / and Math.sqrt / floor / ceil / round / min / max /
 * abs / sign / imul are used (no sin / cos / pow / hypot / atan: engines differ in their last bit); quarter turns come from exact tables.
 *
 * Wave 7 completion (city theme only; every other theme's output is untouched):
 *   building.sy (shell parcels)   a vertical stretch of the kit shell (citykit `sy`): skyline towers 1.25-1.8x the modelled 35-54 m, so the downtown reaches 60-90 m on the same footprint;
 *                                 building.height / visualHeight already include it. STRETCH_RANGES = the per-type ranges.
 *   parcel.lot 'gas' | 'market' | 'plaza' | 'court'   LANDMARK_LOTS: a few lots per town (downtown 3, a 3 x 3 town 2, a 3 x 2 town 1, plus the random ones) that maps.js builds as a gas station,
 *                                 a market, a clock-tower plaza and a sports court; a lot too small for its landmark (LM_FIT) is never chosen for it, and streetProps leaves them undressed.
 *
 * VERSION is the generator version: any change that moves output bumps it (lane 7C's squad version guard reads it).
 */

export const VERSION = 4;                          // 4 = Wave 7b (Isla Viva and Deepwood only: link roads routed round water and steep ground, plan.preferGrid, the docks / crater / mill layouts, themed lots and street dressing; Savanna's layouts are byte-identical to 3 apart from their `v` field); 3 = Wave 7 completion (Savanna / city theme only): stretched skyline shells (`sy`), landmark lots (gas / market / plaza / court), bigger homesteads and hamlets, no sand shell colormap; isla_viva and deepwood layouts are byte-identical to 2 (their `v` field aside). 2 = Wave 7: layoutMap({ reserve }), streetProps, Savanna compounds scattered (PLANS.ashgrid.compounds.inner / jitter); isla_viva and deepwood layouts are byte-identical to 1

// ── constants ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const PITCH = 56;                          // road centreline spacing: blocks stay inside the bot planner's 64 m window
export const ROAD_W = 10;
export const SIDEWALK_W = 3;
export const BLOCK_HALF = PITCH / 2 - ROAD_W / 2;       // 23: block square (parcels + sidewalk) half size
export const PARCEL_HALF = BLOCK_HALF - SIDEWALK_W;      // 20: parcel square half size (a 40 x 40 m buildable square)
export const CELL = 2.5;                                  // interior module (Wave 8 house grammar grid)
export const DOOR_W = 2.26;                               // wallDoorwayWide
export const WET_MARGIN = 0.8;                            // the plan: a block must sit >= waterY + 0.8
export const LONG_STREET = 150;                           // a straight street longer than this gets a jog
export const MAX_SHELL_SHARE = 0.2;                       // O3: closed shells <= 20 % of buildings
export const MAX_FLOORS = 3;                              // O3: <= 3 walkable floors
const GEN_WET = 1.5;                                      // the generator keeps 0.7 m more than the plan's 0.8 (8 m node spacing: aliasing slack)
const HP = PITCH / 2;                                     // 28: block centre -> street centreline
const LAT = 2;                                            // terrain lattice pitch for structural decisions (m)
// the lot margins: a city grid (Wave 7 polish) builds closer to the lot lines - a 1.5 m gap between neighbours (was 2.0) and 1.2 m of front yard - so a block
// holds more building; every other theme keeps the Wave-6 numbers. gridAttempt sets them for its own duration (see below).
let FRONT_SETBACK = 1.5, SIDE_MARGIN = 1.0, BACK_MARGIN = 1.0;
const RELIEF_LEVELS = [6.5, 9, 12];                   // block relief ladder (m over the 56 m cell); pads (C-PAD) flatten what is left
const COMPOUND_MIN_TOWN = 60;                             // m, compound centre to the nearest town footprint
const COMPOUND_REACH = 720;                               // m, +- from the map centre
const COMPOUND_GRID = 20;                                 // m, farthest-point candidate grid

// ── rng ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** identical to royale sim's mulberry32 (runtime/sim/royale.js) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** FNV-1a 32 bit */
export function hash32(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** the layout's own stream: mulberry32(seed ^ hash(id)), optionally forked by a salt string */
export function subRng(seed, id, salt) {
  let s = ((seed | 0) ^ hash32(id)) >>> 0;
  if (salt) s = (s ^ hash32(salt)) >>> 0;
  return mulberry32(s);
}
const rint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const rrange = (r, lo, hi) => lo + (hi - lo) * r();
const pick = (r, a) => a[Math.floor(r() * a.length)];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
const dist2 = (a, b) => Math.sqrt(a * a + b * b);                  // not Math.hypot: its last bit differs between engines
// stair slope in degrees by storey height (rise over a 5 m run): atan is not used (engines differ in its last bit; the rounded values are fixed)
const STAIR_DEG = { 3: 30.96, 3.4: 34.22, 4: 38.66, 5: 45, 6: 50.19 };
const r3 = (v) => Math.round(v * 1000) / 1000;
function wpick(r, items, wf) {
  let tot = 0;
  for (const it of items) tot += wf(it);
  if (!(tot > 0)) return null;
  let x = r() * tot;
  for (const it of items) { x -= wf(it); if (x <= 0) return it; }
  return items[items.length - 1];
}

// ── quarter turns ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ROT = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
const COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];
const FACE = [[0, 1], [1, 0], [0, -1], [-1, 0]];         // turn -> (sin rot, cos rot) = the world direction of local +Z (the door side)
const turnOf = (fx, fz) => (fz > 0 ? 0 : fx > 0 ? 1 : fz < 0 ? 2 : 3);
/** local (u along local x, v along local z, origin = building centre) -> world [x, z]; rotateY(rot): x' = x c + z s, z' = -x s + z c */
function toWorld(b, u, v) { const c = COS[b.turn], s = SIN[b.turn]; return [b.cx + u * c + v * s, b.cz - u * s + v * c]; }
function worldRect(b, u0, v0, u1, v1) {
  const p = toWorld(b, u0, v0), q = toWorld(b, u1, v1);
  return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
}
const worldDir = (turn, a, b) => [a * COS[turn] + b * SIN[turn], -a * SIN[turn] + b * COS[turn]];   // local vector -> world vector

// ── terrain sampler (a 2 m lattice cache over any pure heightFn) ──────────────────────────────────────────────────────────────────────
/** `fn(x, z)` must be pure for the lifetime of the sampler. Lattice nodes sit at even metres; structural decisions only read nodes. */
// The lattice lives in one pooled pair of typed arrays (allocating 8 MB per sampler made GC the biggest cost): the most recently made sampler owns
// them (entries are stamped with its id); an older sampler that lost ownership falls back to its own Map, so results never mix.
const POOL = { vals: null, stamp: null, owner: 0, nextId: 1 };
const NON_FINITE = -50;                                  // what a non-finite height node counts as (Wave 7: maps.js's TerrainField could return NaN on a few seeds; fixed there, guarded here)
const WIN = 480, SPAN = 2 * WIN + 1;                    // +-960 m of lattice nodes in typed arrays, a Map beyond
export function makeSampler(fn) {
  if (!POOL.vals) { POOL.vals = new Float64Array(SPAN * SPAN); POOL.stamp = new Int32Array(SPAN * SPAN); }
  const id = POOL.nextId++;
  POOL.owner = id;
  const own = new Map();
  return {
    isSampler: true,
    h: fn,
    bc: new Map(),                                      // block summaries by centre (shared by every attempt on this ground)
    n(i, j) {
      if (POOL.owner === id && i >= -WIN && i <= WIN && j >= -WIN && j <= WIN) {
        const k = (j + WIN) * SPAN + (i + WIN);
        if (POOL.stamp[k] === id) return POOL.vals[k];
        let v = fn(i * LAT, j * LAT);
        if (!(v - v === 0)) v = NON_FINITE;                 // (a NaN / infinite ground node reads as deep water: the block is dropped, nothing downstream sees a NaN)
        POOL.vals[k] = v; POOL.stamp[k] = id;
        return v;
      }
      const k = (i + 65536) * 131072 + (j + 65536);
      let v = own.get(k);
      if (v === undefined) { v = fn(i * LAT, j * LAT); if (!(v - v === 0)) v = NON_FINITE; own.set(k, v); }
      return v;
    },
  };
}
function asSampler(h) { return h && h.isSampler ? h : makeSampler(h); }
/** lo / hi / mean over the lattice nodes inside [x0,x1] x [z0,z1], every `stride`-th node. The returned object is a SHARED scratch: read it before the next scan.
 *  With `keep` the node heights are also left in VALS[0..n) (for medianOfVals). */
const SC = { lo: 0, hi: 0, mean: 0, n: 0 };
const VALS = new Float64Array(2048);
function scan(S, x0, x1, z0, z1, stride, keep) {
  // nodes are aligned to GLOBAL multiples of `stride`, so every scan of every size reads (and shares) the same cached nodes
  const i0 = Math.ceil(Math.ceil(x0 / LAT) / stride) * stride, i1 = Math.floor(x1 / LAT), j0 = Math.ceil(Math.ceil(z0 / LAT) / stride) * stride, j1 = Math.floor(z1 / LAT);
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (let j = j0; j <= j1; j += stride) for (let i = i0; i <= i1; i += stride) {
    const v = S.n(i, j);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    sum += v;
    if (keep && n < 2048) VALS[n] = v;
    n++;
  }
  SC.lo = lo; SC.hi = hi; SC.mean = n ? sum / n : 0; SC.n = n;
  return SC;
}
/** does the rectangle (grown by pad) overlap any of the avoid rectangles (the footprints of towns already laid out on this map)? */
function hitsAvoid(avoid, x0, z0, x1, z1, pad) {
  if (!avoid) return false;
  for (const a of avoid) if (x0 - pad < a[2] && x1 + pad > a[0] && z0 - pad < a[3] && z1 + pad > a[1]) return true;
  return false;
}
/** median of VALS[0..n) (insertion sort for the small footprints, the typed-array sort beyond) */
function medianOfVals(n) {
  n = Math.min(n, 2048);
  if (n === 0) return 0;
  if (n <= 48) {
    for (let i = 1; i < n; i++) { const v = VALS[i]; let j = i - 1; while (j >= 0 && VALS[j] > v) { VALS[j + 1] = VALS[j]; j--; } VALS[j + 1] = v; }
    return VALS[n >> 1];
  }
  const t = VALS.subarray(0, n);
  t.sort();
  return t[n >> 1];
}
/** ground summary of a rectangle from the 4 m lattice nodes inside it (+2 m): min / max / median - recorded per building, for the pads */
function groundOf(S, x0, z0, x1, z1) {
  const sc = scan(S, x0 - 2, x1 + 2, z0 - 2, z1 + 2, 2, true);
  const lo = sc.lo, hi = sc.hi, n = sc.n;
  return { min: r2(lo), max: r2(hi), med: r2(medianOfVals(n)) };
}

// ── archetypes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// dims = [frontage w (local x), depth d (local z)] on the 2.5 m module. A building needs a stair strip of >= 4 cells (d >= 10) for a
// second floor and a second strip (w >= 12.5) for a third. gen = which maps.js generator draws it today (house() / tower()); Wave 8's
// house grammar replaces both and reads the room / door / stair records.
const ARCH = {
  house_s: { use: "house", gen: "house", dims: [[7.5, 7.5], [10, 7.5]], floors: [1], fh: 3.4 },
  house_m: { use: "house", gen: "house", dims: [[10, 10], [12.5, 10]], floors: [1, 2], fh: 3.4 },
  cabin: { use: "house", gen: "house", dims: [[7.5, 7.5], [10, 7.5], [7.5, 10]], floors: [1, 2], fh: 3.4 },
  shop: { use: "shop", gen: "house", dims: [[10, 10], [12.5, 10], [12.5, 12.5]], floors: [1, 2], fh: 4.0 },
  midrise: { use: "midrise", gen: "tower", dims: [[12.5, 12.5], [15, 15]], floors: [2, 3], fh: 4.0 },
  tower: { use: "tower", gen: "tower", dims: [[15, 15], [17.5, 17.5]], floors: [3], fh: 4.0 },
  hall: { use: "hall", gen: "house", dims: [[15, 10], [17.5, 12.5], [20, 12.5]], floors: [1], fh: 5.0 },
  shed: { use: "shed", gen: "house", dims: [[5, 5], [7.5, 5], [7.5, 7.5]], floors: [1], fh: 3.0 },
  barn: { use: "barn", gen: "house", dims: [[17.5, 12.5], [20, 12.5]], floors: [1], fh: 6.0 },
  // Wave 7b stage B: the themed towns' two-storey houses (always two walkable floors: maps.js builds the upper floor, its stairwell and ramp, and a balcony): a whitewashed resort villa,
  // a timber lodge. Only the resort / lodge mixes name them.
  villa: { use: "house", gen: "house", dims: [[10, 10], [12.5, 10]], floors: [2], fh: 3.4 },
  lodge2: { use: "house", gen: "house", dims: [[10, 10], [12.5, 10]], floors: [2], fh: 3.4 },
};
// Closed kit shells (skyline and back-of-block fill only, <= 20 %). [manifest type, w, d, height] = bbox_m at suggested_scale
// (assets/props/city/manifest.json; the selftest re-reads the manifest and fails if these drift). Front is +Z.
const SHELLS = {
  skyline: [["skyscraper/building-skyscraper-a", 16.32, 16.32, 34.56], ["skyscraper/building-skyscraper-b", 16.32, 16.32, 53.76],
    ["skyscraper/building-skyscraper-e", 15.54, 14.904, 48.96],
    ["commercial/building-m", 14.88, 14.904, 37.8]],     // (Wave 7 polish: skyscraper-c and -d are left out: their manifest collider ends 3 m short of the drawn rear, a 1.6 m clip at body height)
  mid: [["commercial/building-a", 10.603, 11.28, 15.516], ["commercial/building-f", 10.08, 12.36, 20.316],
    ["commercial/building-h", 10.603, 12.094, 15.516], ["commercial/building-c", 10.603, 13.08, 10.716]],
  // city towns' kit houses (Wave 7 polish): the stage-A list minus type-h and type-q, whose manifest colliders leave the drawn mesh 0.19 / 0.38 m outside them at body height, plus type-c / -e / -o
  house_city: [["suburban/building-type-a", 9.36, 7.403, 6.002], ["suburban/building-type-i", 9.262, 7.401, 5.31], ["suburban/building-type-c", 9.262, 7.403, 7.442], ["suburban/building-type-e", 9.36, 7.401, 8.19], ["suburban/building-type-o", 9.144, 7.401, 8.19]],
  house: [["suburban/building-type-a", 9.36, 7.403, 6.002], ["suburban/building-type-h", 9.36, 6.595, 5.31],
    ["suburban/building-type-i", 9.262, 7.401, 5.31], ["suburban/building-type-q", 8.928, 6.376, 6.61]],
  // Wave 7b: the kit shell lists of the two new themes (footprints = manifest bbox_m at the suggested scale; towngen.selftest re-reads them). resort strips are low-rise: no 20 m mid-rise (commercial f);
  // a lodge village is steep gables only (no bungalows h / i, no flat-roofed modern villa q).
  mid_resort: [["commercial/building-a", 10.603, 11.28, 15.516], ["commercial/building-h", 10.603, 12.094, 15.516], ["commercial/building-c", 10.603, 13.08, 10.716]],
  house_lodge: [["suburban/building-type-a", 9.36, 7.403, 6.002], ["suburban/building-type-c", 9.262, 7.403, 7.442], ["suburban/building-type-e", 9.36, 7.401, 8.19], ["suburban/building-type-o", 9.144, 7.401, 8.19]],
};
// palette keys per theme (O2): the kit's two colormaps + their recoloured variants (manifest palettes.<key>.variants)
const THEMES = {
  city: { house: ["suburban", [null, "slate", "brick", "sand"]], big: ["commercial", [null, "slate", "brick", "sand"]], shell: "skyline" },
  resort: { house: ["suburban", ["coral", "mint", "lagoon", "sun", "shell", "rose"]], big: ["commercial", ["coral", "mint", "lagoon", "sun", "shell", "rose"]], shell: "mid_resort" },
  lodge: { house: ["suburban", ["pine", "cedar", "walnut", "driftwood", "forest", "barn"]], big: ["commercial", ["pine", "cedar", "walnut", "driftwood", "forest", "barn"]], shell: "house_lodge" },
  farm: { house: ["suburban", ["brick", "sand", null]], big: ["commercial", ["sand", "brick"]], shell: "house" },
  ruin: { house: ["suburban", ["slate", "sand", "brick"]], big: ["commercial", ["slate", "sand"]], shell: "house" },
  mill: { house: ["suburban", ["brick", "slate", null]], big: ["commercial", ["brick", "slate"]], shell: "house" },
};
// archetype weights per theme / kind ("lot" = a parcel with no building: parking, pocket park, yard; "shell" = closed kit building)
const MIX = {
  "city/core": { tower: 30, midrise: 36, shop: 16, lot: 1.5, shell: 24 },                                          // (Wave 7 completion: random lots halved here too: the landmark lots are the forced ones)
  "city/town": { house_s: 18, house_m: 24, shop: 24, midrise: 12, shed: 2, lot: 1.5, shell: 22 },                 // (Wave 7 completion: the random lots halved: a town's landmark lots are mostly the forced ones, see lmQuota)
  "city/village": { house_s: 26, house_m: 24, shop: 22, midrise: 4, shed: 6, lot: 3, shell: 20 },
  "city/yard": { hall: 36, shed: 22, shop: 12, lot: 8, shell: 10 },
  "resort/core": { midrise: 30, shop: 30, house_m: 12, villa: 14, lot: 4, shell: 10 },                            // (stage B: villas - two real floors and a balcony - take from house_m)
  "resort/town": { house_s: 16, house_m: 18, villa: 22, shop: 24, midrise: 12, lot: 6, shell: 8 },
  "resort/village": { house_s: 24, house_m: 20, villa: 18, shop: 22, shed: 8, lot: 6, shell: 4 },
  "lodge/core": { midrise: 20, shop: 30, cabin: 22, lodge2: 12, hall: 10, lot: 4, shell: 6 },                     // (stage B: two-storey lodges take from the cabins)
  "lodge/town": { cabin: 38, lodge2: 18, house_m: 8, shop: 16, hall: 8, shed: 6, lot: 6, shell: 4 },
  "lodge/village": { cabin: 46, lodge2: 14, house_m: 8, shop: 12, hall: 6, shed: 8, lot: 4, shell: 2 },
};
// Wave 7 completion, city theme only: what an empty lot can be besides parking / a pocket park / a yard. maps.js draws each one from boxes (a gas station: canopy, pumps, kiosk; a
// market: striped stalls; a plaza: a clock tower; a court: a sports court with stands and floodlights); streetProps leaves them undressed, a lot too small for its landmark is a yard.
export const LANDMARK_LOTS = ["gas", "market", "plaza", "court"];
const LM_FIT = { gas: [18, 14], market: [17, 13], plaza: [14, 14], court: [24, 15] };        // [long side, short side] of the lot a landmark needs (maps.js buildLandmark checks the same numbers)
// how many parcels of a city layout are FORCED to be landmark lots (the rest of a town's lots are random): a downtown 3, a 3 x 2 town 1, a 3 x 3 town 2; villages, yards and 2-block towns none (their random lots may still be landmarks) (every
// town keeps its >= 6 enterable buildings). A forced lot replaces one would-be building, so the shell budget is estimated on one building fewer per lot.
const lmQuota = (kind, nBlocks) => (kind === "core" ? 3 : kind === "town" ? (nBlocks >= 9 ? 2 : nBlocks >= 6 ? 1 : 0) : 0);
const LM_WEIGHTS = { core: { plaza: 3, market: 1.5, court: 1.5, gas: 0.6 }, town: { gas: 2, market: 2, plaza: 1.5, court: 1.5 } };
const LOT_KINDS = { core: ["parking", "park", "plaza", "plaza", "market", "court"], town: ["parking", "park", "yard", "market", "gas", "plaza", "court"], village: ["parking", "park", "market", "gas", "plaza", "yard"] };
const mixFor = (theme, kind) => MIX[theme + "/" + kind] || MIX["city/" + kind] || MIX["city/town"];
const GRID_KINDS = new Set(["core", "town", "village", "yard"]);

// ── plans: one entry per POI of the three maps (maps.js POI tables), sized to this game ──────────────────────────────────────────────
// kind = grid kind (cols x rows blocks) or a cluster kind: farm | lane | compound. minBlocks = fewest kept blocks the town accepts
// before it relaxes the relief ladder. maxShift caps how far the grid may slide to find dry, gentle ground (m).
export const PLANS = {
  ashgrid: {
    theme: "city",
    pois: {
      downtown: { kind: "core", cols: 4, rows: 4, minBlocks: 12, maxShift: 16 },
      metro: { kind: "town", cols: 3, rows: 2, minBlocks: 4, maxShift: 60 },
      overpass: { kind: "town", cols: 2, rows: 2, minBlocks: 3, maxShift: 60 },
      yard: { kind: "yard", cols: 3, rows: 2, minBlocks: 3, maxShift: 60, identity: "containers" },     // (P23: the container yard - container stacks on its biggest parcels, see applyIdentity)
      mall: { kind: "town", cols: 3, rows: 2, minBlocks: 4, maxShift: 60, identity: "mall" },           // (P23: the Old Mall - a department store and its car park on the middle block)
      crane: { kind: "village", cols: 3, rows: 1, minBlocks: 2, maxShift: 50 },
      rubble: { kind: "village", cols: 2, rows: 1, minBlocks: 2, maxShift: 60 },
      motorpool: { kind: "yard", cols: 3, rows: 1, minBlocks: 2, maxShift: 50 },
      outpost: { kind: "town", cols: 3, rows: 3, minBlocks: 6, maxShift: 50 },
    },
    compounds: { count: 30, themes: ["farm", "ruin"], weights: [3, 2], inner: 0.8, jitter: 0.2, variety: true },     // inner / jitter: see placeCompounds (Wave 7 spreads Savanna's compounds over the map instead of a ring on its border)
  },
  isla_viva: {
    theme: "resort",
    pois: {
      palm_bay: { kind: "town", cols: 3, rows: 2, minBlocks: 3, maxShift: 110, reach: 440, preferGrid: true },
      coco_village: { kind: "town", cols: 3, rows: 2, minBlocks: 3, maxShift: 110, reach: 440, preferGrid: true },
      jungle_market: { kind: "town", cols: 3, rows: 2, minBlocks: 3, maxShift: 110, reach: 440, preferGrid: true },
      lagoon_docks: { kind: "docks", maxShift: 110, reach: 520 },
      banana_farm: { kind: "farm", theme: "farm", maxShift: 70, reach: 700 },
      cliff_temples: { kind: "green", theme: "ruin", maxShift: 70, reach: 440 },
      volcano_rim: { kind: "crater", theme: "ruin", maxShift: 0, reach: 0 },
      shipwreck: { kind: "lane", theme: "ruin", maxShift: 70, reach: 700 },
    },
    compounds: { count: 24, themes: ["resort", "farm", "ruin"], weights: [4, 2, 1] },
  },
  deepwood: {
    theme: "lodge",
    pois: {
      logging: { kind: "town", cols: 3, rows: 2, minBlocks: 3, maxShift: 110, reach: 440, preferGrid: true, identity: "woodyard" },     // (P23: the logging camp - woodyards with log piles)
      lakeside: { kind: "town", cols: 3, rows: 2, minBlocks: 3, maxShift: 110, reach: 440, preferGrid: true },
      ranger: { kind: "green", theme: "lodge", maxShift: 80 },
      hollow: { kind: "lane", theme: "lodge", maxShift: 70 },
      quarry: { kind: "lane", theme: "lodge", maxShift: 80 },
      mill: { kind: "mill", theme: "mill", maxShift: 50 },
      firewatch: { kind: "green", theme: "lodge", maxShift: 60 },
      meadow: { kind: "farm", theme: "farm", maxShift: 70 },
    },
    compounds: { count: 30, themes: ["lodge", "farm", "ruin"], weights: [4, 2, 1] },
  },
};
/** the maps.js POI tables, as authored (isla_viva's five inland POIs are snapped to land per seed by maps.js; pass the snapped list to layoutMap) */
const POI_TABLE = {
  ashgrid: [["downtown", "Downtown Core", 0, 0, 150], ["metro", "Metro Plaza", 60, -430, 110], ["overpass", "The Overpass", 430, 80, 120],
    ["yard", "Container Yard", 420, 430, 110], ["mall", "Old Mall", -430, -60, 120], ["crane", "Crane Heights", -380, -430, 90],
    ["rubble", "Rubble Row", -60, 430, 110], ["motorpool", "Motor Pool", -430, 380, 90], ["outpost", "Savanna Outpost", 220, 250, 95]],
  isla_viva: [["palm_bay", "Palm Bay", -520, 90, 90], ["coco_village", "Coco Village", -60, 350, 110], ["volcano_rim", "Volcano Rim", 40, -60, 130],
    ["shipwreck", "Shipwreck Cove", 470, -430, 95], ["cliff_temples", "Cliff Temples", 480, 60, 110], ["lagoon_docks", "Lagoon Docks", 120, 620, 100],
    ["jungle_market", "Jungle Market", -350, -380, 100], ["banana_farm", "Banana Farm", -340, 360, 90]],
  deepwood: [["logging", "Logging Camp", -430, -380, 110], ["ranger", "Ranger Ridge", 300, -80, 120], ["lakeside", "Lakeside Cabins", -260, 430, 130],
    ["hollow", "Hunter's Hollow", 430, -430, 100], ["quarry", "Old Quarry", -480, 60, 110], ["mill", "Riverside Mill", 40, 40, 90],
    ["firewatch", "Fire Watch", 60, -520, 80], ["meadow", "Meadow Farm", 430, 430, 100]],
};
export function defaultPois(mapId) {
  return (POI_TABLE[mapId] || []).map((p) => ({ id: p[0], name: p[1], x: p[2], z: p[3], r: p[4] }));
}
/** plan for one POI (unknown ids get a theme default sized from poi.r) */
export function planFor(mapId, poi) {
  const M = PLANS[mapId];
  const base = M && M.pois[poi.id];
  const theme = (base && base.theme) || (M && M.theme) || "city";
  if (base) return Object.assign({ theme }, base, { theme });
  const n = poi.r >= 140 ? 3 : poi.r >= 80 ? 2 : 1;
  return { theme, kind: "town", cols: n, rows: n, minBlocks: 1, maxShift: Math.round(poi.r * 0.6) };
}

// ── interior (rooms, doors, stairs) ───────────────────────────────────────────────────────────────────────────────────────────────────
function guillotine(rng, i0, j0, i1, j1, k, out) {
  // split the cell rectangle into <= k rooms; every room has area >= 3 cells (7.5 m x 2.5 m is the thinnest allowed)
  const rooms = [[i0, j0, i1, j1]];
  let guard = 0;
  while (rooms.length < k && guard++ < 24) {
    let best = -1, ba = 0;
    for (let a = 0; a < rooms.length; a++) {
      const r = rooms[a], w = r[2] - r[0], d = r[3] - r[1], area = w * d;
      if (area >= 6 && Math.max(w, d) >= 2 && area > ba) { ba = area; best = a; }
    }
    if (best < 0) break;
    const r = rooms[best], w = r[2] - r[0], d = r[3] - r[1];
    const alongI = w > d ? true : d > w ? false : rng() < 0.5;
    const L = alongI ? w : d;
    if (L < 2) break;
    const cut = clamp(Math.round(L * rrange(rng, 0.38, 0.62)), 1, L - 1);
    if (alongI) { rooms[best] = [r[0], r[1], r[0] + cut, r[3]]; rooms.push([r[0] + cut, r[1], r[2], r[3]]); }
    else { rooms[best] = [r[0], r[1], r[2], r[1] + cut]; rooms.push([r[0], r[1] + cut, r[2], r[3]]); }
  }
  for (const r of rooms) out.push(r);
}
const ROOM_KINDS = {
  house: ["living", "kitchen", "bedroom", "bath", "bedroom", "storage"],
  shop: ["shop", "storage", "office", "storage"],
  midrise: ["lobby", "office", "meeting", "office", "storage"],
  tower: ["lobby", "office", "meeting", "office", "storage"],
  hall: ["hall", "office", "storage"],
  shed: ["storage"],
  barn: ["hall", "storage", "storage"],
};
function roomTarget(use, floor, nx, nz) {
  const cells = nx * nz;
  if (use === "shed") return 1;
  if (use === "hall" || use === "barn") return cells >= 24 ? 2 : 1;
  if (use === "shop") return floor === 0 ? 2 : 2;
  if (use === "midrise" || use === "tower") return cells >= 30 ? 4 : 3;
  return cells >= 20 ? 3 : cells >= 9 ? 2 : 1;      // house
}
/** rooms, doors and stairs of one enterable building, in WORLD coordinates (cells are also kept local for Wave 8). Pure of (bd, rng). */
function genInterior(rng, bd, pid) {
  const U = CELL, w = bd.w, d = bd.d, nx = Math.round(w / U), nz = Math.round(d / U), floors = bd.floors, use = bd.use;
  const rooms = [], doors = [], stairs = [];
  const lu = (i) => -w / 2 + i * U, lv = (j) => -d / 2 + j * U;                 // local u / v of a cell boundary
  const wr = (i0, j0, i1, j1) => worldRect(bd, lu(i0), lv(j0), lu(i1), lv(j1));
  // stair strips: full-depth columns along the left / right wall (floors >= 2 only)
  const strips = [];
  if (floors >= 2) {
    const right = rng() < 0.5;
    strips.push(right ? nx - 1 : 0);
    if (floors >= 3) strips.push(right ? 0 : nx - 1);
  }
  const ri0 = strips.indexOf(0) >= 0 ? 1 : 0, ri1 = strips.indexOf(nx - 1) >= 0 ? nx - 1 : nx;     // rest-of-plan columns [ri0, ri1)
  const frontCol = clamp(Math.floor((ri0 + ri1 - 1) / 2), ri0, ri1 - 1);
  const floorRooms = [];
  for (let f = 0; f < floors; f++) {
    const cells = [];
    for (const s of strips) cells.push({ r: [s, 0, s + 1, nz], hall: true });
    const rest = [];
    guillotine(rng, ri0, 0, ri1, nz, roomTarget(use, f, ri1 - ri0, nz), rest);
    // the room holding the front-door cell comes first (kinds are assigned in order)
    rest.sort((p, q) => {
      const ap = p[0] <= frontCol && frontCol < p[2] && p[3] === nz ? 0 : 1, aq = q[0] <= frontCol && frontCol < q[2] && q[3] === nz ? 0 : 1;
      return ap - aq || p[1] - q[1] || p[0] - q[0];
    });
    for (const r of rest) cells.push({ r, hall: false });
    const kinds = ROOM_KINDS[use] || ROOM_KINDS.house;
    let ki = 0;
    const list = [];
    for (const c of cells) {
      const id = pid + ".r" + rooms.length;
      const kind = c.hall ? "stairhall" : (f > 0 && ki === 0 && (use === "house") ? "bedroom" : kinds[ki++ % kinds.length]);
      const [x0, z0, x1, z1] = wr(c.r[0], c.r[1], c.r[2], c.r[3]);
      const rm = { id, parcel: pid, floor: f, kind, cells: c.r.slice(), x0: r3(x0), z0: r3(z0), x1: r3(x1), z1: r3(z1), cx: r3((x0 + x1) / 2), cz: r3((z0 + z1) / 2), area: r3((c.r[2] - c.r[0]) * (c.r[3] - c.r[1]) * U * U), doors: [], stairs: [] };
      rooms.push(rm); list.push(rm);
    }
    floorRooms.push(list);
  }
  const roomAt = (f, i, j) => floorRooms[f].find((r) => r.cells[0] <= i && i < r.cells[2] && r.cells[1] <= j && j < r.cells[3]);
  let dn = 0;
  const addDoor = (kind, f, u, v, axisLocal, nlu, nlv, a, b) => {
    const [x, z] = toWorld(bd, u, v), [ndx, ndz] = worldDir(bd.turn, nlu, nlv);
    const axis = axisLocal === "u" ? (bd.turn % 2 ? "z" : "x") : (bd.turn % 2 ? "x" : "z");    // world direction the WALL runs along
    const dr = { id: pid + ".d" + dn++, parcel: pid, kind, floor: f, x: r3(x), z: r3(z), axis, nx: ndx, nz: ndz, width: DOOR_W, rooms: [a ? a.id : null, b ? b.id : null] };
    if (kind !== "interior") dr.out = [r3(x + ndx * 1.2), r3(z + ndz * 1.2)];                 // a point 1.2 m outside the wall (the walk starts here)
    doors.push(dr);
    if (a) a.doors.push(dr.id);
    if (b) b.doors.push(dr.id);
    return dr;
  };
  // exterior doors (ground floor): front = local +z wall, back = local -z wall
  const entrance = roomAt(0, frontCol, nz - 1);
  addDoor("front", 0, lu(frontCol) + U / 2, d / 2, "u", 0, 1, entrance, null);
  if ((use === "house" || use === "shop") && nz >= 3 && rng() < 0.6) {
    const bc = clamp(Math.floor((ri0 + ri1 - 1) / 2) + (rng() < 0.5 ? 0 : 0), ri0, ri1 - 1);
    addDoor("back", 0, lu(bc) + U / 2, -d / 2, "u", 0, -1, roomAt(0, bc, 0), null);
  }
  // interior doors: a spanning tree over each floor's rooms, entrance first, through the longest shared wall
  for (let f = 0; f < floors; f++) {
    const list = floorRooms[f];
    const seen = new Set([f === 0 ? entrance.id : list.find((r) => r.kind !== "stairhall" ? true : false).id]);
    const first = f === 0 ? entrance : list[list.length - 1];
    seen.clear(); seen.add(first.id);
    const queue = [first];
    while (queue.length) {
      const cur = queue.shift();
      const nbr = [];
      for (const o of list) {
        if (seen.has(o.id)) continue;
        // shared wall between cur and o
        let len = 0, door = null;
        const A = cur.cells, B = o.cells;
        if (A[2] === B[0] || B[2] === A[0]) {
          const j0 = Math.max(A[1], B[1]), j1 = Math.min(A[3], B[3]);
          if (j1 > j0) { len = j1 - j0; door = { vert: true, ib: A[2] === B[0] ? A[2] : A[0], j: j0 + ((len - 1) >> 1), a: A[2] === B[0] ? cur : o, b: A[2] === B[0] ? o : cur }; }
        }
        if (!door && (A[3] === B[1] || B[3] === A[1])) {
          const i0 = Math.max(A[0], B[0]), i1 = Math.min(A[2], B[2]);
          if (i1 > i0) { len = i1 - i0; door = { vert: false, jb: A[3] === B[1] ? A[3] : A[1], i: i0 + ((len - 1) >> 1), a: A[3] === B[1] ? cur : o, b: A[3] === B[1] ? o : cur }; }
        }
        if (door) nbr.push({ o, len, door });
      }
      nbr.sort((p, q) => q.len - p.len || p.o.cells[1] - q.o.cells[1] || p.o.cells[0] - q.o.cells[0]);
      for (const nb of nbr) {
        if (seen.has(nb.o.id)) continue;
        seen.add(nb.o.id);
        const dd = nb.door;
        if (dd.vert) addDoor("interior", f, lu(dd.ib), lv(dd.j) + U / 2, "v", 1, 0, dd.a, dd.b);
        else addDoor("interior", f, lu(dd.i) + U / 2, lv(dd.jb), "u", 0, 1, dd.a, dd.b);
        queue.push(nb.o);
      }
    }
  }
  // stairs: floor f -> f + 1 along the f % strips strip; 4 cells in line: approach, 2 stair cells (5 m run), exit
  for (let f = 0; f < floors - 1; f++) {
    const s = strips[f % strips.length];
    const up = rng() < 0.5 ? 1 : -1;                               // +1 = rises toward local +z (the front)
    const js = rint(rng, 1, Math.max(1, nz - 3));
    const jb = up > 0 ? js : js + 1;                                // bottom cell
    const jt = up > 0 ? js + 1 : js;                                // top cell
    const jApproach = up > 0 ? js - 1 : js + 2, jExit = up > 0 ? js + 2 : js - 1;
    const [x0, z0, x1, z1] = worldRect(bd, lu(s), lv(js), lu(s + 1), lv(js + 2));
    const [bxp, bzp] = toWorld(bd, lu(s) + U / 2, up > 0 ? lv(js) : lv(js + 2));
    const [txp, tzp] = toWorld(bd, lu(s) + U / 2, up > 0 ? lv(js + 2) : lv(js));
    const [dx, dz] = worldDir(bd.turn, 0, up);
    const lo = roomAt(f, s, jApproach), hi = roomAt(f + 1, s, jExit);
    const st = { id: pid + ".s" + f, parcel: pid, from: f, to: f + 1, x0: r3(x0), z0: r3(z0), x1: r3(x1), z1: r3(z1), dx, dz, bottom: [r3(bxp), r3(bzp)], top: [r3(txp), r3(tzp)],
      rise: bd.floorH, run: 2 * U, width: U, slopeDeg: STAIR_DEG[bd.floorH], cells: [s, Math.min(jb, jt)], approach: lo.id, exit: hi.id };
    stairs.push(st);
    lo.stairs.push(st.id); hi.stairs.push(st.id);
    void jt;
  }
  return { rooms, doors, stairs };
}

// ── parcels ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** BLOCKTOOTH splitBlock, transliterated: recursive seeded bisection of the 40 x 40 m square into <= n parcels. Every parcel must touch the
 *  block edge (= a street): a cut that would create an interior parcel is refused. */
function splitBlock(rng, bx0, bz0, bx1, bz1, n, minSide, bigCore) {
  const out = [[bx0, bz0, bx1, bz1]];
  const touches = (p) => p[0] === bx0 || p[2] === bx1 || p[1] === bz0 || p[3] === bz1;
  let guard = 0;
  while (out.length < n && guard++ < 60) {
    let tot = 0;
    for (const p of out) { const w = p[2] - p[0], d = p[3] - p[1]; if (Math.max(w, d) >= 2 * minSide) tot += (w * d) * (w * d); }
    if (tot <= 0) break;
    let x = rng() * tot, idx = -1, last = -1;
    for (let i = 0; i < out.length; i++) {
      const p = out[i], w = p[2] - p[0], d = p[3] - p[1];
      if (Math.max(w, d) < 2 * minSide) continue;
      last = i;
      x -= (w * d) * (w * d);
      if (x <= 0) { idx = i; break; }
    }
    if (idx < 0) idx = last;
    const p = out[idx], w = p[2] - p[0], d = p[3] - p[1];
    let alongX = w > d + 0.01 ? true : d > w + 0.01 ? false : rng() < 0.5;
    if ((alongX ? w : d) < 2 * minSide) alongX = !alongX;
    const L = alongX ? w : d;
    const t = bigCore && out.length === 1 ? (rng() < 0.5 ? rrange(rng, 0.36, 0.42) : rrange(rng, 0.58, 0.64)) : rrange(rng, 0.35, 0.65);
    const cut = Math.round(clamp(L * t, minSide, L - minSide) * 2) / 2;
    const a = alongX ? [p[0], p[1], p[0] + cut, p[3]] : [p[0], p[1], p[2], p[1] + cut];
    const b = alongX ? [p[0] + cut, p[1], p[2], p[3]] : [p[0], p[1] + cut, p[2], p[3]];
    if (!touches(a) || !touches(b)) continue;
    out[idx] = a; out.push(b);
  }
  return out;
}
/** which block sides a parcel touches and the facing (toward its street): the side with the longest shared edge, ties by a coin */
function parcelFacing(rng, p, bx0, bz0, bx1, bz1) {
  const c = [];
  if (p[1] === bz0) c.push([[0, -1], p[2] - p[0]]);       // north edge (z min): street at -z
  if (p[3] === bz1) c.push([[0, 1], p[2] - p[0]]);        // south edge
  if (p[0] === bx0) c.push([[-1, 0], p[3] - p[1]]);       // west edge
  if (p[2] === bx1) c.push([[1, 0], p[3] - p[1]]);        // east edge
  let best = c[0], tie = false;
  for (let i = 1; i < c.length; i++) { if (c[i][1] > best[1] + 1e-6) { best = c[i]; tie = false; } else if (Math.abs(c[i][1] - best[1]) <= 1e-6) tie = true; }
  if (tie) { const eq = c.filter((e) => Math.abs(e[1] - best[1]) <= 1e-6); best = eq[Math.floor(rng() * eq.length)]; }
  return best[0];
}
/** the frontage / depth available to a building in `rect` facing (fx, fz) */
function room(rect, fx, fz) {
  const pw = rect[2] - rect[0], pd = rect[3] - rect[1];
  return fz !== 0 ? [pw - 2 * SIDE_MARGIN, pd - FRONT_SETBACK - BACK_MARGIN] : [pd - 2 * SIDE_MARGIN, pw - FRONT_SETBACK - BACK_MARGIN];
}
function maxFloorsFor(w, d) { return d >= 10 ? (w >= 12.5 ? 3 : 2) : 1; }
/** choose dims + floors of archetype `key` that fit a frontage x depth; null if none */
// City theme only (Wave 7 polish): a building GROWS toward the room its parcel gives it, on the 2.5 m module, so a block reads as built and not as a few boxes on
// a plaza (the stage-A towns covered 20-30 % of a block). [max frontage, max depth]; the tower() generator is square, so towers and mid-rises grow square.
const GROW = { house_s: [12.5, 12.5], house_m: [15, 15], shop: [22.5, 17.5], hall: [27.5, 17.5], shed: [7.5, 7.5], midrise: [20, 20], tower: [20, 20], barn: [20, 12.5] };
const floor25 = (v) => Math.floor(v / CELL + 1e-6) * CELL;
function growDims(rng, key, A, dm, fw, fd) {
  const G = GROW[key];
  if (!G) return dm;
  if (A.gen === "tower") {                                             // square: s0 .. sMax in 2.5 steps
    const s0 = Math.max(dm[0], dm[1]), sMax = Math.min(G[0], G[1], floor25(fw), floor25(fd));
    if (sMax <= s0) return dm;
    const steps = Math.round((sMax - s0) / CELL), s = rng() < 0.8 ? sMax : s0 + CELL * Math.floor(rng() * (steps + 1));
    return [s, s];
  }
  const wMax = Math.max(dm[0], Math.min(G[0], floor25(fw))), dMax = Math.max(dm[1], Math.min(G[1], floor25(fd)));
  const pickIn = (lo, hi) => (hi <= lo ? lo : rng() < 0.8 ? hi : lo + CELL * Math.floor(rng() * (Math.round((hi - lo) / CELL) + 1)));
  return [pickIn(dm[0], wMax), pickIn(dm[1], dMax)];
}
// city theme: Downtown's kit shells wear TWO of the four colormaps (chosen by the town's id), every other town's ONE - every (type, colormap) pair is one draw call per district (two
// with its shadow pass), and a street view of the 9-block Outpost drew 10 of them
// (Wave 7 completion: no "sand" colormap on a city shell - tan walls vanish into the haze of the 330 m drop view; slate / base glass and brick red keep their silhouettes)
const SHELL_VARIANTS = [[null, "slate"], [null, "brick"], ["slate", "brick"], ["brick", "slate"], [null, "slate"], ["slate", "brick"]];
// Wave 7b (resort / lodge): a town's kit shells wear TWO of the theme's six colourways (chosen by the town id): every (type, colormap) pair is a draw call per district (two with its shadow
// pass); the six colourways give variety from town to town. makeShellParcel draws its single random number exactly as paletteFor did, so the layout and every later draw are unchanged.
const THEME_SHELL_PAIRS = {
  resort: [["coral", "mint"], ["lagoon", "sun"], ["shell", "rose"], ["coral", "lagoon"], ["mint", "sun"], ["rose", "shell"]],
  lodge: [["pine", "walnut"], ["cedar", "driftwood"], ["forest", "barn"], ["pine", "cedar"], ["walnut", "forest"], ["driftwood", "barn"]],
};
// Wave 7 completion, city theme only: a kit shell is STRETCHED vertically (citykit `sy`: same footprint, colliders scaled on Y only) so the downtown skyline reaches 60-90 m instead of
// topping out at the 54 m the kit was modelled at, and the mid-rises of the towns stand 20-28 m. [min, max] per type; the factor is drawn from the parcel's own sub-stream
// ("sy<pid>"), a quarter of the time the minimum (a plain, unstretched-looking tower keeps the skyline from being a comb), else uniform over the range.
const STRETCH = {
  "skyscraper/building-skyscraper-a": [1.45, 1.75], "skyscraper/building-skyscraper-b": [1.25, 1.65], "skyscraper/building-skyscraper-e": [1.35, 1.8], "commercial/building-m": [1.35, 1.65],
  "commercial/building-a": [1.0, 1.3], "commercial/building-f": [1.0, 1.25], "commercial/building-h": [1.0, 1.3], "commercial/building-c": [1.0, 1.35],
};
function stretchFor(seed, townId, pid, kitType) {
  const R = STRETCH[kitType];
  if (!R) return 1;
  const r = subRng(seed, townId, "sy" + pid), t = r();
  return r3(R[0] + (R[1] - R[0]) * (t < 0.25 ? 0 : (t - 0.25) / 0.75));
}
// city theme: the tower() generator climbs to its roof chest by an exterior ramp 2.2 m wide along its local +X wall (up to 2.3 m out). In the dense city that ramp ran into the
// next building or into the next tower's ramp (worldlive ramps-walk-fine: a descent mantled onto the neighbour's ramp, 7 ramps of 5 seeds). A tower / mid-rise therefore keeps a
// RAMP_LANE strip free on its +X flank (inside its own parcel, so a neighbour's wall and ramp stay out of it) and gives up that much frontage.
const RAMP_LANE = 2.6;
const SHELL_HOUSE_COVER = 0.33;                             // a kit house (9 x 7 m, two storeys, a real roof) may sit in a bigger yard than a box building may
const MIN_COVER = 0.5;                                     // city theme: a building should fill at least this share of its parcel
/** the largest share of its parcel (area `pa`) archetype `key` can reach in room fw x fd after growth (0 = it does not fit) */
function archCover(key, fw, fd, pa) {
  const A = ARCH[key], G = GROW[key];
  if (A.gen === "tower") fw -= RAMP_LANE;
  if (!A.dims.some((dm) => dm[0] <= fw + 1e-6 && dm[1] <= fd + 1e-6)) return 0;
  let w = Math.min(G[0], floor25(fw)), d = Math.min(G[1], floor25(fd));
  if (A.gen === "tower") w = d = Math.min(w, d);
  return w * d / pa;
}
function fitArch(rng, key, fw, fd, minFloors, grow) {
  const A = ARCH[key];
  if (grow && A.gen === "tower") fw -= RAMP_LANE;
  const fit = A.dims.filter((dm) => dm[0] <= fw + 1e-6 && dm[1] <= fd + 1e-6);
  if (!fit.length) return null;
  fit.sort((p, q) => q[0] * q[1] - p[0] * p[1]);
  let dm = fit[Math.min(fit.length - 1, rng() < 0.6 ? 0 : 1)];
  if (grow) dm = growDims(rng, key, A, dm, fw, fd);
  let cap = Math.min(MAX_FLOORS, maxFloorsFor(dm[0], dm[1]));
  if (grow && A.gen === "tower" && dm[0] < 15) cap = Math.min(cap, 2);                  // (city: a 12.5 m tower() of three storeys climbs its roof ramp at 44.4 degrees and a sprint down it mantles: two storeys there)
  let fl = A.floors.filter((f) => f <= cap);
  if (!fl.length) fl = [1];
  if (minFloors && Math.max(...fl) < minFloors) return null;
  const floors = A.floors.length > 1 ? fl[Math.floor(rng() * fl.length)] : fl[0];
  return { key, w: dm[0], d: dm[1], floors, fh: A.fh, use: A.use, gen: A.gen };
}
/** place a building of dims (w, d) in a parcel rect facing (fx, fz), pushed to the street side; returns the building frame */
function placeBuilding(rect, fx, fz, w, d, lane) {
  const turn = turnOf(fx, fz);
  let cx, cz;
  if (fz > 0) { cz = rect[3] - FRONT_SETBACK - d / 2; cx = (rect[0] + rect[2]) / 2; }
  else if (fz < 0) { cz = rect[1] + FRONT_SETBACK + d / 2; cx = (rect[0] + rect[2]) / 2; }
  else if (fx > 0) { cx = rect[2] - FRONT_SETBACK - d / 2; cz = (rect[1] + rect[3]) / 2; }
  else { cx = rect[0] + FRONT_SETBACK + d / 2; cz = (rect[1] + rect[3]) / 2; }
  if (lane) {                                          // a tower() building keeps its exterior roof ramp on its local +X flank: push the building to the -X margin so the strip beside it is free
    const fwE = (fz !== 0 ? rect[2] - rect[0] : rect[3] - rect[1]) - 2 * SIDE_MARGIN, u = -(fwE - w) / 2;
    cx += u * COS[turn]; cz -= u * SIN[turn];
  }
  return { cx, cz, turn };
}
function aabbOf(b, w, d) {
  const hx = b.turn % 2 ? d / 2 : w / 2, hz = b.turn % 2 ? w / 2 : d / 2;
  return [b.cx - hx, b.cz - hz, b.cx + hx, b.cz + hz];
}
function paletteFor(rng, theme, big) {
  const T = THEMES[theme] || THEMES.city, e = big ? T.big : T.house;
  return { key: e[0], variant: pick(rng, e[1]) };
}
/** build the parcel record (and its interior) for an archetype placed in `rect` */
function makeBuildingParcel(S, rng, pid, blockId, rect, fx, fz, fit, theme, extra) {
  const frame = placeBuilding(rect, fx, fz, fit.w, fit.d, theme === "city" && fit.gen === "tower" ? RAMP_LANE : 0);
  const bd = { cx: r3(frame.cx), cz: r3(frame.cz), turn: frame.turn, w: fit.w, d: fit.d, floors: fit.floors, floorH: fit.fh, use: fit.use };
  const bb = aabbOf(bd, fit.w, fit.d);
  const big = fit.use === "midrise" || fit.use === "tower" || fit.use === "hall" || fit.use === "barn" || fit.use === "shop";
  const parcel = {
    id: pid, block: blockId, use: fit.use, rect: [r3(rect[0]), r3(rect[1]), r3(rect[2]), r3(rect[3])], facing: [fx, fz],
    building: {
      cx: bd.cx, cz: bd.cz, w: fit.w, d: fit.d, turn: frame.turn, rot: ROT[frame.turn], facing: FACE[frame.turn].slice(),
      aabb: [r3(bb[0]), r3(bb[1]), r3(bb[2]), r3(bb[3])], gen: fit.gen, arch: fit.key, floors: fit.floors, floorH: fit.fh,
      height: r2(fit.floors * fit.fh + (fit.gen === "tower" ? 1.6 : 0.9)), enterable: true,
      palette: paletteFor(rng, theme, big), ground: groundOf(S, bb[0], bb[1], bb[2], bb[3]),
    },
  };
  if (extra) Object.assign(parcel.building, extra);
  const inter = genInterior(rng, bd, pid);
  return { parcel, inter };
}
function makeShellParcel(S, rng, pid, blockId, rect, fx, fz, kit, theme, variants, sy) {
  const frame = placeBuilding(rect, fx, fz, kit[1], kit[2]);
  const bb = aabbOf(frame, kit[1], kit[2]);
  const sY = sy || 1;
  return {
    id: pid, block: blockId, use: "shell", rect: [r3(rect[0]), r3(rect[1]), r3(rect[2]), r3(rect[3])], facing: [fx, fz],
    building: {
      cx: r3(frame.cx), cz: r3(frame.cz), w: kit[1], d: kit[2], turn: frame.turn, rot: ROT[frame.turn], facing: FACE[frame.turn].slice(),
      aabb: [r3(bb[0]), r3(bb[1]), r3(bb[2]), r3(bb[3])], gen: "shell", arch: "shell", kit: kit[0], floors: 0, visualHeight: sY === 1 ? kit[3] : r2(kit[3] * sY), height: sY === 1 ? kit[3] : r2(kit[3] * sY),
      enterable: false, ...(sY === 1 ? {} : { sy: sY }), palette: variants ? { key: kit[0].indexOf("suburban") < 0 ? "commercial" : "suburban", variant: variants[Math.floor(rng() * variants.length)] } : paletteFor(rng, theme, kit[0].indexOf("suburban") < 0), ground: groundOf(S, bb[0], bb[1], bb[2], bb[3]),
    },
  };
}
function makeLotParcel(pid, blockId, rect, fx, fz, rng, kinds) {
  return { id: pid, block: blockId, use: "lot", lot: pick(rng, kinds || ["parking", "park", "yard"]), rect: [r3(rect[0]), r3(rect[1]), r3(rect[2]), r3(rect[3])], facing: [fx, fz], building: null };
}
/** assign every parcel of one block */
function fillBlock(S, rng, blk, theme, kind, shellBudgetLeft, idBase, out) {
  const mix = mixFor(theme, kind);
  const bx0 = blk.cx - PARCEL_HALF, bz0 = blk.cz - PARCEL_HALF, bx1 = blk.cx + PARCEL_HALF, bz1 = blk.cz + PARCEL_HALF;
  const grow = theme === "city";                                  // Wave 7 polish: the city theme builds dense, the other themes are the Wave-6 plan
  const nTarget = grow ? (kind === "core" ? 4 : kind === "yard" ? rint(rng, 5, 6) : kind === "village" ? rint(rng, 6, 8) : rint(rng, 6, 8))
    : kind === "core" ? rint(rng, 3, 4) : kind === "yard" ? rint(rng, 4, 6) : kind === "village" ? rint(rng, 6, 8) : rint(rng, 5, 8);
  const minSide = grow ? (kind === "core" ? 18 : kind === "yard" ? 13 : 10) : kind === "core" ? 14 : kind === "yard" ? 13 : 12;
  const rects = splitBlock(rng, bx0, bz0, bx1, bz1, nTarget, minSide, kind === "core" && !grow);
  const items = rects.map((r) => {
    const f = parcelFacing(rng, r, bx0, bz0, bx1, bz1);
    return { rect: r, fx: f[0], fz: f[1], area: (r[2] - r[0]) * (r[3] - r[1]) };
  });
  // shells: the largest parcels first (skyline), only up to the layout's remaining budget
  const shellW = mix.shell || 0, totW = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  const wantShell = Math.min(shellBudgetLeft.n, Math.round(items.length * shellW / totW + (rng() < (items.length * shellW / totW) % 1 ? 0.5 : 0)));
  const bySize = items.map((it, i) => i).sort((a, b) => items[b].area - items[a].area || a - b);
  // city towns mix kit houses in with the mid-rises - but each town uses HALF of each list (every other type, from an id-hash parity): a kit type is a draw call per district, two with its shadow
  const half = (list) => (grow && kind !== "core" ? list.filter((k, i) => (i + hash32(out.id)) % 2 === 0) : list);
  const shellKits = half(SHELLS[(kind === "core" ? "skyline" : (THEMES[theme] || THEMES.city).shell === "skyline" ? "mid" : (THEMES[theme] || THEMES.city).shell)]);
  const houseKits = grow && kind !== "core" ? half(SHELLS.house_city) : null;
  const taken = new Set();
  let nShell = 0;
  // city theme: a shell goes where its fixed footprint FILLS the parcel (the biggest parcel is not the best one for a 10 m kit house), never under MIN_COVER
  const kitFits = (kits, fw, fd) => kits.filter((k) => k[1] <= fw + 1e-6 && k[2] <= fd + 1e-6);
  const bestCover = (it) => { const [fw, fd] = room(it.rect, it.fx, it.fz), pa = it.area; let b = 0; for (const k of kitFits(shellKits.concat(houseKits || []), fw, fd)) b = Math.max(b, k[1] * k[2] / pa); return b; };
  const shellOrder = grow ? bySize.slice().sort((a, b) => bestCover(items[b]) - bestCover(items[a]) || a - b) : bySize;
  for (const i of shellOrder) {
    if (nShell >= wantShell) break;
    const it = items[i], [fw, fd] = room(it.rect, it.fx, it.fz);
    let kits = kitFits(shellKits, fw, fd);
    if (houseKits && (!kits.length || rng() < 0.45)) { const hk = kitFits(houseKits, fw, fd); if (hk.length) kits = hk; }
    if (grow) kits = kits.filter((k) => k[1] * k[2] / it.area >= (k[0].indexOf("suburban") === 0 ? SHELL_HOUSE_COVER : MIN_COVER));
    if (!kits.length) continue;
    const kit = kits[Math.floor(rng() * kits.length)];
    it.shell = kit; taken.add(i); nShell++;
  }
  shellBudgetLeft.n -= nShell;
  // Wave 7 completion: a landmark lot is FORCED on one of this block's remaining parcels with probability (quotas left / blocks left), on the smallest parcel that fits one
  if (grow && out.lmLeft > 0) {
    const w = out.lmLeft / Math.max(1, out.blocksLeft);
    if (rng() < w) {
      const wts = LM_WEIGHTS[kind] || LM_WEIGHTS.town;
      const cand = items.map((it, i) => i).filter((i) => !taken.has(i)).sort((a, b) => items[a].area - items[b].area || a - b);          // (the SMALLEST parcel that fits one: a landmark costs a block as little built area as it can)
      for (const i of cand) {
        const r = items[i].rect, w0 = r[2] - r[0], d0 = r[3] - r[1], Lg = Math.max(w0, d0), Sh = Math.min(w0, d0);
        const fits = Object.keys(wts).filter((k) => Lg >= LM_FIT[k][0] && Sh >= LM_FIT[k][1]);
        if (!fits.length) continue;
        const k = wpick(rng, fits, (q) => wts[q] * (out.lmUsed[q] ? 0.35 : 1));
        items[i].landmark = k; out.lmUsed[k] = (out.lmUsed[k] || 0) + 1; out.lmLeft--;
        break;
      }
    }
  }
  out.blocksLeft--;
  const keys = Object.keys(mix).filter((k) => k !== "lot" && k !== "shell" && mix[k] > 0);
  let order = 0;
  for (const it of items) {
    const pid = idBase + order++;
    const id = "p" + pid;
    if (it.shell) { out.parcels.push(makeShellParcel(S, rng, id, blk.id, it.rect, it.fx, it.fz, it.shell, theme, grow ? (kind === "core" ? SHELL_VARIANTS[hash32(out.id) % SHELL_VARIANTS.length] : [SHELL_VARIANTS[hash32(out.id) % SHELL_VARIANTS.length][0]]) : (THEME_SHELL_PAIRS[theme] ? THEME_SHELL_PAIRS[theme][hash32(out.id) % THEME_SHELL_PAIRS[theme].length] : null), grow ? stretchFor(out.seed, out.id, id, it.shell[0]) : 1)); continue; }
    if (it.landmark) { out.parcels.push(makeLotParcel(id, blk.id, it.rect, it.fx, it.fz, rng, [it.landmark])); continue; }
    const [fw, fd] = room(it.rect, it.fx, it.fz);
    let fit = null;
    if (mix.lot && rng() * (totW - (mix.shell || 0)) < mix.lot) fit = null;
    else {
      let pool = keys.slice();
      if (grow) {                                                  // keep the archetypes that can fill >= MIN_COVER of this parcel (else the best-filling ones)
        const cov = pool.map((k) => archCover(k, fw, fd, it.area));
        const good = pool.filter((k, j) => cov[j] >= MIN_COVER);
        if (good.length) pool = good;
        else { const mx = Math.max(...cov); pool = pool.filter((k, j) => cov[j] >= mx - 1e-9 && mx > 0); }
      }
      while (pool.length && !fit) {
        const k = wpick(rng, pool, (q) => mix[q]);
        pool.splice(pool.indexOf(k), 1);
        fit = fitArch(rng, k, fw, fd, 0, grow);
      }
      if (!fit) fit = fitArch(rng, "shed", fw, fd, 0, grow);
    }
    if (!fit) { out.parcels.push(makeLotParcel(id, blk.id, it.rect, it.fx, it.fz, rng, grow ? LOT_KINDS[kind] || null : null)); continue; }       // (a downtown lot is a car park, a pocket park or a landmark, never a bare yard)
    const sub = subRng(out.seed, out.id, id);
    const made = makeBuildingParcel(S, sub, id, blk.id, it.rect, it.fx, it.fz, fit, theme);
    out.parcels.push(made.parcel);
    out.rooms.push(...made.inter.rooms); out.doors.push(...made.inter.doors); out.stairs.push(...made.inter.stairs);
  }
  return order;
}

// ── blocks, anchor search ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function gridShifts(rng, cols, rows) {
  // a street longer than ~150 m jogs: alternate pairs of columns shift in z (breaks the x-running streets), pairs of rows in x (breaks the
  // z-running streets). When both axes jog the signs are OPPOSITE, so diagonal neighbours never move toward each other and overlap.
  const J = 12 + 2 * rint(rng, 0, 2), sr = rng() < 0.5 ? 1 : -1;
  const rowShift = [], colShift = [];
  for (let j = 0; j < rows; j++) rowShift.push(rows >= 3 ? J * sr * Math.floor(j / 2) : 0);
  for (let i = 0; i < cols; i++) colShift.push(cols >= 3 ? -J * sr * Math.floor(i / 2) : 0);
  return { J, rowShift, colShift };
}
function makeBlocks(cols, rows, ax, az, sh) {
  const gx0 = ax - cols * HP, gz0 = az - rows * HP, blocks = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    blocks.push({ i, j, cx: gx0 + (i + 0.5) * PITCH + sh.rowShift[j], cz: gz0 + (j + 0.5) * PITCH + sh.colShift[i] });
  }
  return blocks;
}
const blockInfo = (S, waterY, cx, cz) => {
  const key = cx * 4096 + cz;
  let v = S.bc.get(key);
  if (!v || v.wy !== waterY) {
    // 16 m pass first (25 nodes: a wet node anywhere in the road-inclusive 66 m square kills the block exactly), then the 8 m pass the decision uses:
    // dryness over the 66 m square, relief over the 56 m cell inside it. All nodes are on the global lattice, so neighbouring blocks share them.
    const c16 = scan(S, cx - 33, cx + 33, cz - 33, cz + 33, 8);
    if (c16.lo < waterY + GEN_WET) v = { dryLo: c16.lo, relief: Infinity, lo: c16.lo, hi: c16.hi };
    else {
      const i0 = 4 * Math.ceil((cx - 33) / 8), i1 = Math.floor((cx + 33) / LAT), j0 = 4 * Math.ceil((cz - 33) / 8), j1 = Math.floor((cz + 33) / LAT);
      let lo = Infinity, ilo = Infinity, ihi = -Infinity;
      for (let j = j0; j <= j1; j += 4) for (let i = i0; i <= i1; i += 4) {
        const h = S.n(i, j);
        if (h < lo) lo = h;
        if (Math.abs(i * LAT - cx) <= HP && Math.abs(j * LAT - cz) <= HP) { if (h < ilo) ilo = h; if (h > ihi) ihi = h; }
      }
      v = { dryLo: lo, relief: ihi - ilo, lo: ilo, hi: ihi };
    }
    v.wy = waterY;
    S.bc.set(key, v);
  }
  return v;
};
/** keep the largest 4-connected set of ok blocks (grid indices) */
function largestComponent(blocks, cols, rows) {
  const at = new Map();
  for (const b of blocks) if (b.ok) at.set(b.j * cols + b.i, b);
  const seen = new Set(), comps = [];
  for (const b of blocks) {
    const k = b.j * cols + b.i;
    if (!b.ok || seen.has(k)) continue;
    const comp = [], st = [b];
    seen.add(k);
    while (st.length) {
      const c = st.pop();
      comp.push(c);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = c.i + di, nj = c.j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni, nb = at.get(nk);
        if (nb && !seen.has(nk)) { seen.add(nk); st.push(nb); }
      }
    }
    comps.push(comp);
  }
  comps.sort((p, q) => q.length - p.length);
  return comps.length ? comps[0] : [];
}
function anchorCandidates(maxShift, step) {
  const out = [[0, 0]];
  for (let k = 1; k * step <= maxShift + 1e-9; k++) {
    const s = k * step;
    for (const [a, b] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) out.push([a * s, b * s]);
  }
  return out;
}

function gridAttempt(seed, poi, S, waterY, theme, kind, opts) {
  const m0 = [FRONT_SETBACK, SIDE_MARGIN, BACK_MARGIN];
  if (theme === "city") { FRONT_SETBACK = 1.2; SIDE_MARGIN = 0.75; BACK_MARGIN = 0.75; }
  try { return gridAttemptIn(seed, poi, S, waterY, theme, kind, opts); } finally { FRONT_SETBACK = m0[0]; SIDE_MARGIN = m0[1]; BACK_MARGIN = m0[2]; }
}
function gridAttemptIn(seed, poi, S, waterY, theme, kind, opts) {
  const rng = subRng(seed, poi.id);
  const cols = opts.cols || 2, rows = opts.rows || 2;
  const total = cols * rows, minBlocks = clamp(opts.minBlocks != null ? opts.minBlocks : Math.min(total, 2), 1, total);
  const maxShift = opts.maxShift != null ? opts.maxShift : Math.round(poi.r * 0.6);
  const sh = gridShifts(subRng(seed, poi.id, "shift"), cols, rows);
  const cands = anchorCandidates(maxShift, maxShift > 300 ? 28 : maxShift > 120 ? 20 : 10);
  const wetMin = waterY + GEN_WET;
  const evalPlan = (cand, limit) => {
    const ax = 2 * Math.round((poi.x + cand[0]) / 2), az = 2 * Math.round((poi.z + cand[1]) / 2);
    const blocks = makeBlocks(cols, rows, ax, az, sh);
    for (const b of blocks) {
      const inf = blockInfo(S, waterY, b.cx, b.cz);
      b.dryLo = inf.dryLo; b.relief = inf.relief;
      b.ok = inf.dryLo >= wetMin && inf.relief <= limit;
      if (b.ok && opts.avoid && hitsAvoid(opts.avoid, b.cx - HP, b.cz - HP, b.cx + HP, b.cz + HP, 4)) { b.ok = false; b.conflict = true; }
    }
    const comp = largestComponent(blocks, cols, rows);
    const shift = Math.abs(cand[0]) + Math.abs(cand[1]);
    return { ax, az, cand, blocks, comp, cost: 6 * (total - comp.length) + shift / 10 };
  };
  // per relief level: the cheapest candidate that keeps >= minBlocks wins; none -> the one that keeps the most (next level may do better)
  let chosen = null, level = 0;
  for (let L = 0; L < RELIEF_LEVELS.length; L++) {
    let bestOk = null, bestAny = null;
    for (const c of cands) {
      if ((c[0] !== 0 || c[1] !== 0) && S.n(Math.round((poi.x + c[0]) / 2), Math.round((poi.z + c[1]) / 2)) < wetMin) continue;     // a grid centred in the sea is never the answer
      const ev = evalPlan(c, RELIEF_LEVELS[L]);
      if (ev.comp.length >= minBlocks && (!bestOk || ev.cost < bestOk.cost - 1e-9)) bestOk = ev;
      if (!bestAny || ev.comp.length > bestAny.comp.length || (ev.comp.length === bestAny.comp.length && ev.cost < bestAny.cost - 1e-9)) bestAny = ev;
      if (ev.comp.length === total && c[0] === 0 && c[1] === 0) { bestOk = ev; break; }       // the plan fits where the POI is
    }
    if (bestOk) { chosen = bestOk; level = L; break; }
    if (!chosen || bestAny.comp.length > chosen.comp.length) { chosen = bestAny; level = L; }
  }
  const inScope = new Set(chosen.comp);
  const kept = chosen.comp.slice().sort((p, q) => p.j - q.j || p.i - q.i);
  const dropped = [];
  for (const b of chosen.blocks) if (!inScope.has(b)) dropped.push({ i: b.i, j: b.j, why: b.conflict ? "conflict" : b.dryLo < wetMin ? "water" : b.ok ? "island" : "relief" });
  const L = {
    v: VERSION, id: poi.id, kind, theme, seed,
    poi: { x: r3(poi.x), z: r3(poi.z), r: poi.r },
    anchor: { x: chosen.ax, z: chosen.az, shift: [chosen.cand[0], chosen.cand[1]], reliefLimit: RELIEF_LEVELS[level], level },
    grid: { cols, rows, pitch: PITCH, roadW: ROAD_W, sidewalkW: SIDEWALK_W, jog: sh.J, rowShift: sh.rowShift, colShift: sh.colShift },
    blocks: [], dropped, roads: null, pads: [], corridors: [], parcels: [], doors: [], rooms: [], stairs: [], bridges: [], compound: null,
  };
  kept.forEach((b, n) => {
    const inf = blockInfo(S, waterY, b.cx, b.cz);
    L.blocks.push({ id: n, i: b.i, j: b.j, cx: b.cx, cz: b.cz, x0: b.cx - BLOCK_HALF, z0: b.cz - BLOCK_HALF, x1: b.cx + BLOCK_HALF, z1: b.cz + BLOCK_HALF,
      ground: { min: r2(inf.lo), max: r2(inf.hi), relief: r2(inf.relief) } });
  });
  L.roads = buildRoads(L.blocks);
  // corridors (C-PAD registerCorridor): one per maximal straight street; the pads (registerPad) are one per building footprint, built after the parcels below
  for (const s of L.roads.streets) L.corridors.push({ points: s.axis === "x" ? [[s.x0, s.z0], [s.x1, s.z0]] : [[s.x0, s.z0], [s.x0, s.z1]], width: ROAD_W });
  // parcels
  const budget = { n: 0 };
  let pcount = 0;
  const holder = { seed, id: poi.id, parcels: L.parcels, rooms: L.rooms, doors: L.doors, stairs: L.stairs };
  // shell budget over the whole layout is settled after the block fills: allow up to 20 % of an estimated building count
  const estimate = L.blocks.length * (theme === "city" ? (kind === "core" ? 4 : kind === "yard" ? 5.5 : 8) : kind === "core" ? 3.5 : kind === "yard" ? 4 : 6);
  const quota = theme === "city" ? lmQuota(kind, L.blocks.length) : 0;
  budget.n = Math.floor((estimate - quota) * MAX_SHELL_SHARE * (theme === "city" ? 1 : 0.8));
  holder.lmLeft = quota; holder.blocksLeft = L.blocks.length; holder.lmUsed = {};
  for (const b of L.blocks) {
    const brng = subRng(seed, poi.id, "blk" + b.i + "," + b.j);
    pcount += fillBlock(S, brng, b, theme, kind, budget, pcount, holder);
  }
  if (opts.identity) applyIdentity(S, L, theme, opts.identity, seed, poi);        // (P23 / LC-29: the POI's signature - container stacks, a department store, woodyards)
  settleShares(S, L, theme);
  attachStreets(L);
  for (const p of L.parcels) if (p.building) L.pads.push(padOf(p));
  L.centre = centreOf(L);
  L.stats = summarize(L);
  return L;
}
const HARD_SHIFT = 260;                                   // m: how far a layout may move from its POI centre when the POI sits on water (maps.js snaps inland POIs up to 260 m)
function centreOf(L) {
  if (L.blocks.length) {
    let x = 0, z = 0;
    for (const b of L.blocks) { x += b.cx; z += b.cz; }
    return [r3(x / L.blocks.length), r3(z / L.blocks.length)];
  }
  if (L.compound && L.parcels.length) return [L.compound.entry.x, L.compound.entry.z];
  return [L.poi.x, L.poi.z];
}
/** a grid town: the plan where the POI is (any connected set of its dry blocks: a smaller town, not a hole-ridden one); else, a POI on water, the
 *  same plan up to HARD_SHIFT away; last resort a lane village on whatever dry land there is. The first attempt with >= minEnterable enterable
 *  buildings wins (the best attempt otherwise). */
function stagedGrid(seed, poi, S, waterY, theme, kind, opts) {
  const minEnt = opts.minEnterable != null ? opts.minEnterable : 6;
  const shift1 = opts.maxShift != null ? opts.maxShift : Math.round(poi.r * 0.6);
  const reach = opts.reach != null ? opts.reach : HARD_SHIFT;
  let best = null, tries = 0;
  const consider = (L, hard, tag) => {
    tries++;
    L.stage = { tries, maxShift: hard ? reach : shift1, hard, fallback: tag };
    if (!best || L.stats.enterable > best.stats.enterable) best = L;
    return L.stats.enterable >= minEnt;
  };
  // the cheapest way to keep a town AT its POI first: the grid there, then a lane village there (a small patch of dry land holds one); only then far away
  if (consider(gridAttempt(seed, poi, S, waterY, theme, kind, Object.assign({}, opts, { maxShift: shift1 })), false, null)) return best;
  // (Wave 7b, plan.preferGrid: a themed town takes a real street grid within reach before it settles for a lane village at its POI)
  if (opts.preferGrid && shift1 < reach && consider(gridAttempt(seed, poi, S, waterY, theme, kind, Object.assign({}, opts, { maxShift: reach })), true, null)) return best;
  if (consider(clusterAttempt(seed, poi, S, waterY, theme, "lane", Object.assign({}, opts, { maxShift: shift1, minEnterable: minEnt })), false, "lane")) return best;
  if (shift1 < reach && consider(gridAttempt(seed, poi, S, waterY, theme, kind, Object.assign({}, opts, { maxShift: reach })), true, null)) return best;
  if (consider(gridAttempt(seed, poi, S, waterY, theme, kind, Object.assign({}, opts, { maxShift: reach, minBlocks: 1 })), true, null)) return best;
  const C = clusterStaged(seed, poi, S, waterY, theme, "lane", Object.assign({}, opts, { maxShift: shift1, minEnterable: minEnt }));
  consider(C, true, "lane");
  return best;
}
/** C-PAD registerPad arguments for one building: its footprint + a 1 m stoop, flattened at the median ground under it (6A's groundPad recomputes the height) */
function padOf(p) {
  const a = p.building.aabb;
  return { id: p.id, shape: { x0: r3(a[0] - 1), x1: r3(a[2] + 1), z0: r3(a[1] - 1), z1: r3(a[3] + 1) }, height: p.building.ground.med, falloff: 4 };
}
/** enforce the O3 shares exactly: shells <= 20 % of buildings, >= 2 enterable per block (a shell / lot is converted when it must be) */
function settleShares(S, L, theme) {
  const bl = L.parcels.filter((p) => p.building);
  const sh = bl.filter((p) => !p.building.enterable);
  const maxShell = Math.floor(bl.length * MAX_SHELL_SHARE);
  if (sh.length > maxShell) {
    // convert the smallest shells to enterable mid-rises / shops / houses that fit, else to lots
    sh.sort((a, b) => ((a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1])) - ((b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1])) || (a.id < b.id ? -1 : 1));
    let over = sh.length - maxShell;
    for (const p of sh) {
      if (over <= 0) break;
      if (convertToEnterable(S, L, p, theme)) over--;
    }
  }
  // every block keeps >= 2 enterable buildings when its parcels can hold them
  for (const blk of L.blocks) {
    const ps = L.parcels.filter((p) => p.block === blk.id);
    let n = ps.filter((p) => p.building && p.building.enterable).length;
    for (const p of ps) {
      if (n >= 2) break;
      if ((p.use === "lot" || p.use === "shell") && !p.ident) if (convertToEnterable(S, L, p, theme)) n++;     // (P23: a POI's signature lot is never built over)
    }
  }
}
function convertToEnterable(S, L, p, theme) {
  const rng = subRng(L.seed, L.id, p.id + "x");
  const [fx, fz] = p.facing, [fw, fd] = room(p.rect, fx, fz);
  let fit = null;
  for (const k of ["house_m", "shop", "house_s", "cabin", "shed"]) { fit = fitArch(rng, k, fw, fd, 0, theme === "city"); if (fit) break; }
  if (!fit) return false;
  // remove an old shell's (nonexistent) interior; rebuild as an enterable building in the same parcel
  const made = makeBuildingParcel(S, rng, p.id, p.block, p.rect, fx, fz, fit, theme);
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, made.parcel);
  L.rooms.push(...made.inter.rooms); L.doors.push(...made.inter.doors); L.stairs.push(...made.inter.stairs);
  return true;
}

// ── POI identity (parity P2-I, LC-29) ─────────────────────────────────────────────────────────────────────────────────────────────────
// The world audit (2026-10-20): the towns towngen lays out lost the signatures the hand-placed POIs had - the Container Yard was a street of warehouses with 5 containers on
// the whole map (maps.js drops its authored containers where the yard town's blocks are), the Old Mall had no mall (its mall building exists only in the pre-town fallback)
// and the Logging Camp's log piles only in the fallback too. plan.identity puts them back INSIDE the layout, after the blocks are filled and before the O3 shares settle:
//   "containers"  the yard's biggest parcels become container lots (lot "yard", ident "containers"): rows of kit shipping containers in touching pairs with 3 m aisles between
//                 the pairs (streetProps lays them, containerSlots below is the one packing), until the lots hold CONTAINER_TARGET slots; <= 2 lots a block, and a block keeps
//                 >= 2 enterable buildings
//   "mall"        the block nearest the POI becomes ONE department store (a two-storey 30 x 22.5 m shop, building.mall = true; housegen furnishes every storey of a shop that
//                 wide as trading floors) facing the street away from the town centre, and its car park behind it
//   "woodyard"    WOODYARD_N lots of the logging camp are yards (lot "yard", ident "woodyard"): maps.js themedLots builds a lodge town's yard as a woodyard (two round log piles,
//                 a chopping stump, a sawhorse); existing lots first, then the smallest building parcels that fit one
// Everything is drawn from the layout's own "ident" sub-stream; a signature lot is never converted back by settleShares (p.ident).
export const CONTAINER_L = 6.016, CONTAINER_W = 2.884;           // kit props/shipping-container at its suggested scale (manifest bbox_m x / z; the selftest re-reads them)
const CT_END = 0.35, CT_PAIR = 0.25, CT_AISLE = 3.0, CT_MARGIN = 0.7, CT_CROSS = 2.6;
export const CONTAINER_TARGET = 54;                             // full slots over a yard's container lots (streetProps leaves ~12 % of them empty)
export const CONTAINER_DROP = 0.12;
const WOODYARD_N = 3, WOODYARD_MIN = 13;
export const MALL_W = 30, MALL_D = 22.5, MALL_FLOORS = 2;
/** The container slots of a lot: rows lying along the lot's long side, rows in touching pairs (0.25 m) with a 3 m aisle between pairs, containers end to end (0.35 m) with a
 *  2.6 m cross aisle in the middle of a row of four or more, the whole block centred in the lot 0.7 m inside its edge. Pure of the rect.
 *  -> [{ x, z, rot }] (rot 0: the container's long side along x, 1: along z), row by row. */
export function containerSlots(rect) {
  const w = rect[2] - rect[0], d = rect[3] - rect[1], alongX = w >= d;
  const Lr = (alongX ? w : d) - 2 * CT_MARGIN, Sr = (alongX ? d : w) - 2 * CT_MARGIN;
  if (Lr < CONTAINER_L || Sr < CONTAINER_W) return [];
  let n = Math.floor((Lr + CT_END) / (CONTAINER_L + CT_END)), cross = false;
  if (n >= 4) { cross = true; if (n * CONTAINER_L + (n - 2) * CT_END + CT_CROSS > Lr + 1e-9) n--; if (n < 4) cross = false; }
  const runLen = n * CONTAINER_L + (n - 1) * CT_END + (cross ? CT_CROSS - CT_END : 0);
  const along = [];
  let u = -runLen / 2;
  for (let k = 0; k < n; k++) { along.push(u + CONTAINER_L / 2); u += CONTAINER_L + (cross && k === (n >> 1) - 1 ? CT_CROSS : CT_END); }
  const rows = [];
  let used = 0;
  for (let k = 0; ; k++) {
    const gap = k === 0 ? 0 : k % 2 ? CT_PAIR : CT_AISLE;
    if (used + gap + CONTAINER_W > Sr + 1e-9) break;
    rows.push(used + gap + CONTAINER_W / 2); used += gap + CONTAINER_W;
  }
  const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2, out = [];
  for (const v0 of rows) {
    const v = v0 - used / 2;
    for (const a of along) out.push(alongX ? { x: r3(cx + a), z: r3(cz + v), rot: 0 } : { x: r3(cx + v), z: r3(cz + a), rot: 1 });
  }
  return out;
}
const pidNum = (p) => +String(p.id).slice(1);
/** turn one parcel into a signature lot: its building (and the rooms / doors / stairs of its interior record) goes */
function identityLot(L, p, lot, ident) {
  const id = p.id;
  for (const arr of [L.rooms, L.doors, L.stairs]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].parcel === id) arr.splice(i, 1);
  const keep = { id, block: p.block, rect: p.rect, facing: p.facing };
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, keep, { use: "lot", lot, building: null, ident });
}
function applyIdentity(S, L, theme, ident, seed, poi) {
  const rng = subRng(seed, L.id, "ident");
  const enterableIn = (bid) => L.parcels.filter((q) => q.block === bid && q.building && q.building.enterable).length;
  const freeOf = (p) => p.use !== "shell" && !(p.use === "lot" && LANDMARK_LOTS.indexOf(p.lot) >= 0);
  if (ident === "containers") {
    const cand = L.parcels.filter(freeOf).map((p) => ({ p, n: containerSlots(p.rect).length, a: (p.rect[2] - p.rect[0]) * (p.rect[3] - p.rect[1]) })).filter((c) => c.n >= 6);
    cand.sort((a, b) => b.n - a.n || b.a - a.a || pidNum(a.p) - pidNum(b.p));
    const per = {};
    let tot = 0;
    for (const c of cand) {
      if (tot >= CONTAINER_TARGET) break;
      const bid = c.p.block;
      if ((per[bid] || 0) >= 2) continue;
      if (c.p.building && c.p.building.enterable && enterableIn(bid) < 3) continue;
      identityLot(L, c.p, "yard", "containers");
      per[bid] = (per[bid] || 0) + 1; tot += c.n;
    }
    L.identity = { kind: "containers", slots: tot, lots: L.parcels.filter((p) => p.ident === "containers").length };
  } else if (ident === "woodyard") {
    const fits = (p) => Math.min(p.rect[2] - p.rect[0], p.rect[3] - p.rect[1]) >= WOODYARD_MIN;
    const cand = L.parcels.filter((p) => freeOf(p) && fits(p)).map((p) => ({ p, lot: p.use === "lot" ? 0 : 1, a: (p.rect[2] - p.rect[0]) * (p.rect[3] - p.rect[1]) }));
    cand.sort((a, b) => a.lot - b.lot || a.a - b.a || pidNum(a.p) - pidNum(b.p));
    const used = new Set();
    let n = 0;
    for (const c of cand) {
      if (n >= WOODYARD_N) break;
      const bid = c.p.block;
      if (used.has(bid)) continue;
      if (c.p.building && c.p.building.enterable && enterableIn(bid) < 3) continue;
      identityLot(L, c.p, "yard", "woodyard");
      used.add(bid); n++;
    }
    L.identity = { kind: "woodyard", lots: n };
  } else if (ident === "mall") {
    if (!L.blocks.length) return;
    let blk = null, bd = Infinity;
    for (const b of L.blocks) { const dd = dist2(b.cx - poi.x, b.cz - poi.z); if (dd < bd - 1e-9) { bd = dd; blk = b; } }
    // the store faces away from the town's centre along the axis it is farther out on (a tie: the layout's own coin)
    let gx = 0, gz = 0;
    for (const b of L.blocks) { gx += b.cx / L.blocks.length; gz += b.cz / L.blocks.length; }
    const ox = blk.cx - gx, oz = blk.cz - gz;
    let f;
    if (Math.abs(ox) > Math.abs(oz) + 1e-6) f = [ox > 0 ? 1 : -1, 0];
    else if (Math.abs(oz) > Math.abs(ox) + 1e-6) f = [0, oz > 0 ? 1 : -1];
    else f = FACE[Math.floor(rng() * 4)].slice();
    const ps = L.parcels.filter((p) => p.block === blk.id);
    if (ps.length < 2) return;
    const ids = ps.map((p) => p.id).sort((a, b) => +a.slice(1) - +b.slice(1));
    const at = L.parcels.indexOf(ps[0]);
    for (const p of ps) for (const arr of [L.rooms, L.doors, L.stairs]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].parcel === p.id) arr.splice(i, 1);
    for (let i = L.parcels.length - 1; i >= 0; i--) if (L.parcels[i].block === blk.id) L.parcels.splice(i, 1);
    const x0 = blk.cx - PARCEL_HALF, z0 = blk.cz - PARCEL_HALF, x1 = blk.cx + PARCEL_HALF, z1 = blk.cz + PARCEL_HALF, DM = 25;
    // the store's parcel: the DM m strip on its street side; the car park: the rest, facing the opposite street
    const store = f[0] > 0 ? [x1 - DM, z0, x1, z1] : f[0] < 0 ? [x0, z0, x0 + DM, z1] : f[1] > 0 ? [x0, z1 - DM, x1, z1] : [x0, z0, x1, z0 + DM];
    const park = f[0] > 0 ? [x0, z0, x1 - DM, z1] : f[0] < 0 ? [x0 + DM, z0, x1, z1] : f[1] > 0 ? [x0, z0, x1, z1 - DM] : [x0, z0 + DM, x1, z1];
    const fit = { key: "shop", w: MALL_W, d: MALL_D, floors: MALL_FLOORS, fh: ARCH.shop.fh, use: "shop", gen: "house" };
    const made = makeBuildingParcel(S, subRng(seed, L.id, ids[0]), ids[0], blk.id, store, f[0], f[1], fit, theme, { mall: true });
    made.parcel.ident = "mall";
    const lot = { id: ids[1], block: blk.id, use: "lot", lot: "parking", rect: [r3(park[0]), r3(park[1]), r3(park[2]), r3(park[3])], facing: [-f[0], -f[1]], building: null, ident: "mall" };
    L.parcels.splice(at, 0, made.parcel, lot);
    L.rooms.push(...made.inter.rooms); L.doors.push(...made.inter.doors); L.stairs.push(...made.inter.stairs);
    L.identity = { kind: "mall", block: blk.id, facing: f, parcel: ids[0] };
  }
}

// ── roads ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function mergeIntervals(list) {
  list.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out = [];
  for (const s of list) {
    if (out.length && s[0] <= out[out.length - 1][1]) { if (s[1] > out[out.length - 1][1]) out[out.length - 1][1] = s[1]; }
    else out.push([s[0], s[1]]);
  }
  return out;
}
/** the road graph = the union of the 56 x 56 m rings (centrelines) of the kept blocks, merged where collinear and split at every crossing */
function buildRoads(blocks) {
  const Hm = new Map(), Vm = new Map();
  const add = (m, k, a, b) => { let l = m.get(k); if (!l) m.set(k, l = []); l.push([a, b]); };
  for (const b of blocks) {
    const x0 = b.cx - HP, x1 = b.cx + HP, z0 = b.cz - HP, z1 = b.cz + HP;
    add(Hm, z0, x0, x1); add(Hm, z1, x0, x1); add(Vm, x0, z0, z1); add(Vm, x1, z0, z1);
  }
  const H = [], V = [];
  for (const [k, l] of [...Hm.entries()].sort((p, q) => p[0] - q[0])) for (const s of mergeIntervals(l)) H.push({ k, a: s[0], b: s[1] });
  for (const [k, l] of [...Vm.entries()].sort((p, q) => p[0] - q[0])) for (const s of mergeIntervals(l)) V.push({ k, a: s[0], b: s[1] });
  const nm = new Map();
  const addNode = (x, z) => { const key = x + "," + z; if (!nm.has(key)) nm.set(key, { x, z }); };
  for (const h of H) { addNode(h.a, h.k); addNode(h.b, h.k); }
  for (const v of V) { addNode(v.k, v.a); addNode(v.k, v.b); }
  for (const h of H) for (const v of V) if (v.k >= h.a && v.k <= h.b && h.k >= v.a && h.k <= v.b) addNode(v.k, h.k);
  const nodes = [...nm.values()].sort((p, q) => p.z - q.z || p.x - q.x);
  nodes.forEach((n, i) => { n.id = i; n.deg = 0; });
  const idOf = new Map(nodes.map((n) => [n.x + "," + n.z, n.id]));
  const edges = [];
  const inBlock = (x, z) => blocks.some((b) => Math.abs(x - b.cx) < BLOCK_HALF && Math.abs(z - b.cz) < BLOCK_HALF);
  const pushEdge = (a, b, axis) => {
    const A = nodes[a], B = nodes[b];
    const e = { id: edges.length, a, b, axis, len: r3(Math.abs(B.x - A.x) + Math.abs(B.z - A.z)), width: ROAD_W, sides: 0 };
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const probe = axis === "x" ? [[mx, mz - 14], [mx, mz + 14]] : [[mx - 14, mz], [mx + 14, mz]];
    for (const p of probe) if (inBlock(p[0], p[1])) e.sides++;
    A.deg++; B.deg++;
    edges.push(e);
  };
  for (const h of H) {
    const on = nodes.filter((n) => n.z === h.k && n.x >= h.a && n.x <= h.b).sort((p, q) => p.x - q.x);
    for (let k = 0; k + 1 < on.length; k++) pushEdge(on[k].id, on[k + 1].id, "x");
  }
  for (const v of V) {
    const on = nodes.filter((n) => n.x === v.k && n.z >= v.a && n.z <= v.b).sort((p, q) => p.z - q.z);
    for (let k = 0; k + 1 < on.length; k++) pushEdge(on[k].id, on[k + 1].id, "z");
  }
  // portals: a node with no edge in some axis direction whose 14 m probe on that side is outside every block = a way out of the town
  const has = nodes.map(() => new Set());
  for (const e of edges) {
    const A = nodes[e.a], B = nodes[e.b];
    const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
    has[e.a].add(dx + "," + dz); has[e.b].add(-dx + "," + -dz);
  }
  const portals = [];
  for (const n of nodes) for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (has[n.id].has(dx + "," + dz)) continue;
    if (!inBlock(n.x + dx * 14, n.z + dz * 14) && !inBlock(n.x + dx * 14 + dz * 8, n.z + dz * 14 + dx * 8) && !inBlock(n.x + dx * 14 - dz * 8, n.z + dz * 14 - dx * 8)) portals.push({ node: n.id, dx, dz });
  }
  const streets = [];
  for (const h of H) streets.push({ axis: "x", x0: h.a, z0: h.k, x1: h.b, z1: h.k, len: r3(h.b - h.a) });
  for (const v of V) streets.push({ axis: "z", x0: v.k, z0: v.a, x1: v.k, z1: v.b, len: r3(v.b - v.a) });
  void idOf;
  return { nodes: nodes.map((n) => ({ id: n.id, x: n.x, z: n.z, deg: n.deg })), edges, portals, streets };
}
function edgeAt(roads, x, z, axis) {
  for (const e of roads.edges) {
    if (e.axis !== axis) continue;
    const A = roads.nodes[e.a], B = roads.nodes[e.b];
    if (axis === "x" ? (A.z === z && x >= Math.min(A.x, B.x) - 1e-6 && x <= Math.max(A.x, B.x) + 1e-6) : (A.x === x && z >= Math.min(A.z, B.z) - 1e-6 && z <= Math.max(A.z, B.z) + 1e-6)) return e;
  }
  return null;
}
/** door -> street: every front door of a town parcel gets the road edge, the nearest node, the curb point and the centreline point */
function attachStreets(L) {
  const byParcel = new Map(L.parcels.map((p) => [p.id, p]));
  const blockOf = new Map(L.blocks.map((b) => [b.id, b]));
  for (const d of L.doors) {
    if (d.kind !== "front") continue;
    const p = byParcel.get(d.parcel), blk = blockOf.get(p.block);
    const [fx, fz] = p.facing;
    // straight out along the facing from the door to the street centreline
    const cx = fz !== 0 ? d.x : blk.cx + fx * HP, cz = fz !== 0 ? blk.cz + fz * HP : d.z;
    const e = edgeAt(L.roads, cx, cz, fz !== 0 ? "x" : "z");
    const A = L.roads.nodes[e.a], B = L.roads.nodes[e.b];
    const dA = Math.abs(A.x - cx) + Math.abs(A.z - cz), dB = Math.abs(B.x - cx) + Math.abs(B.z - cz);
    // street = the centreline point straight out from the door; curb = the road edge on this side; walk = door -> out -> curb -> centreline
    d.street = { edge: e.id, node: dA <= dB ? e.a : e.b, x: r3(cx), z: r3(cz), curb: [r3(cx - fx * (ROAD_W / 2)), r3(cz - fz * (ROAD_W / 2))], dist: r3(Math.abs(cx - d.x) + Math.abs(cz - d.z)) };
    d.out = [r3(d.x + d.nx * 1.2), r3(d.z + d.nz * 1.2)];
  }
}

// ── yard clusters: compounds, farms, lane villages ─────────────────────────────────────────────────────────────────────────────────
/** rows of buildings facing a yard rectangle, built in a frame centred on the yard with the yard long axis along x (axis 0); axis 1 transposes */
function yardItems(rng, kind, theme, opts) {
  const mix = mixFor(theme === "ruin" || theme === "mill" ? "lodge" : theme === "farm" ? "lodge" : theme, "village");
  // (stage B) a resort / lodge compound's house is a two-storey villa / lodge a quarter of the time - the same one draw, so the Savanna themes (farm, ruin) are draw for draw what they were
  const two = theme === "resort" ? "villa" : theme === "lodge" ? "lodge2" : null;
  const house = () => { const r = rng(); return two && r >= 0.55 && r < 0.8 ? two : r < 0.55 ? "house_s" : "house_m"; };
  const dimsOf = (key, maxW) => {
    const A = ARCH[key], fit = A.dims.filter((dm) => dm[0] <= maxW + 1e-6);
    const dm = fit.length ? fit[Math.floor(rng() * fit.length)] : A.dims[0];
    return { key, w: dm[0], d: dm[1], floors: key === "villa" || key === "lodge2" ? 2 : 1, fh: A.fh, use: A.use, gen: A.gen };
  };
  const spec = { yw: 24, yd: 14, rows: { N: [], S: [], E: [], W: [] }, fields: 0, fence: true, silo: false, cars: 2, variant: "homestead", containers: 0, tower: false };
  if (kind === "compound") {
    // Wave 7 polish (opts.variety, Savanna only): five kinds of compound instead of one - a homestead, a farmstead (barn + silo), a depot (a hall, sheds, a parking
    // yard and containers), an open hamlet, a homestead with a water tower. Without opts.variety this is the Wave-6 homestead, draw for draw.
    const V = opts.variety ? wpick(rng, [["homestead", 34], ["farmstead", 22], ["depot", 14], ["hamlet", 18], ["tower", 12]], (q) => q[1])[0] : "homestead";
    spec.variant = V;
    if (V === "farmstead") {
      spec.yw = 34; spec.yd = 16; spec.silo = true; spec.cars = 1;
      spec.rows.N.push(dimsOf("barn", 22)); spec.rows.N.push(dimsOf("shed", 8));
      spec.rows.S.push(dimsOf("house_m", 12.5)); spec.rows.S.push(dimsOf("house_s", 10));
      if (rng() < 0.5) spec.rows.E.push(dimsOf("shed", 10));
    } else if (V === "depot") {
      spec.yw = 34; spec.yd = 18; spec.cars = 6; spec.containers = 3;
      spec.rows.N.push(dimsOf("hall", 20)); spec.rows.N.push(dimsOf("shed", 8));
      spec.rows.S.push(dimsOf("shed", 10)); spec.rows.S.push(dimsOf("shed", 10));
      if (rng() < 0.5) spec.rows.E.push(dimsOf("shed", 10));
    } else if (V === "hamlet") {
      spec.yw = 26; spec.yd = 12; spec.fence = false; spec.cars = 3;
      const nH = rint(rng, 3, 4), order = ["N", "S", "N", "S"];
      for (let k = 0; k < nH; k++) spec.rows[order[k]].push(dimsOf(house(), 10));
      if (opts.variety) spec.rows[rng() < 0.5 ? "W" : "E"].push(dimsOf("shed", 8));         // (Wave 7 completion: a hamlet has its shed too)
    } else {
      const nH = opts.variety ? rint(rng, 3, 4) : rint(rng, 2, 4);                           // (Wave 7 completion, Savanna: a homestead is three or four houses, not two or three, in a 26 m yard)
      if (opts.variety) spec.yw = 26;
      const order = ["N", "S", "N", "S"];
      for (let k = 0; k < nH; k++) spec.rows[order[k]].push(dimsOf(house(), 10));
      spec.rows[rng() < 0.5 ? "W" : "E"].push(dimsOf("shed", 12));
      if (V === "tower") { spec.tower = true; spec.yw = 28; spec.yd = 16; spec.cars = 2; }
    }
  } else if (kind === "farm") {
    spec.yw = 36; spec.yd = 18; spec.fields = 3; spec.silo = true; spec.cars = 2;
    spec.rows.N.push(dimsOf("barn", 22)); spec.rows.N.push(dimsOf("shed", 8));
    spec.rows.S.push(dimsOf("house_m", 12.5)); spec.rows.S.push(dimsOf("house_s", 10)); spec.rows.S.push(dimsOf("house_s", 10));
    spec.rows.E.push(dimsOf("house_s", 12)); spec.rows.E.push(dimsOf("shed", 6)); spec.rows.W.push(dimsOf("shed", 12)); spec.rows.W.push(dimsOf("house_s", 10));
  } else if (kind === "green") {                     // a village green: a 40 x 26 m common with houses on all four sides (3 + 3 + 2 + 2)
    spec.yw = 40; spec.yd = 26; spec.fence = false; spec.cars = 2;
    const bag = Object.keys(mix).filter((k) => k !== "lot" && k !== "shell" && k !== "midrise" && mix[k] > 0);
    for (const side of ["N", "S"]) for (let g = 0; g < 3; g++) spec.rows[side].push(dimsOf(wpick(rng, bag, (q) => mix[q]), 11));
    for (const side of ["E", "W"]) for (let g = 0; g < 2; g++) spec.rows[side].push(dimsOf(wpick(rng, bag, (q) => mix[q]), 11));
  } else {                                           // lane
    const L = opts.lane || 80;
    spec.yw = L; spec.yd = 8; spec.fence = false; spec.cars = 3;
    const bag = Object.keys(mix).filter((k) => k !== "lot" && k !== "shell" && k !== "midrise" && mix[k] > 0);
    for (const side of ["N", "S"]) {
      let used = 0;
      for (let g = 0; g < 14; g++) {
        const k = wpick(rng, bag, (q) => mix[q]);
        const it = dimsOf(k, 12.5);
        if (used + it.w > L + 1e-6) break;
        spec.rows[side].push(it); used += it.w + 3;
        if (used > L) break;
      }
    }
    spec.rows.E.push(dimsOf("shed", 7.5)); spec.rows.W.push(dimsOf(rng() < 0.5 ? "house_s" : "shed", 7.5));
    if (theme === "mill") for (const side of ["N", "S"]) spec.rows[side].unshift(Object.assign(dimsOf("midrise", 12.5), { floors: 2 }));      // the mill itself: two storeys, a bank each
  }
  return spec;
}
/** frame positions of every building of `spec` (axis-0 frame): [{N|S|E|W, ...fit, cx, cz, turn}] */
function yardFrame(spec) {
  const out = [], FS = 2.0, GAP = 3.0;
  const rowLen = (r) => r.reduce((a, b) => a + b.w, 0) + GAP * Math.max(0, r.length - 1);
  for (const side of ["N", "S", "E", "W"]) {
    const r = spec.rows[side];
    if (!r.length) continue;
    const horizontal = side === "N" || side === "S", span = horizontal ? spec.yw : spec.yd;
    let items = r.slice();
    while (items.length && rowLen(items) > span + 1e-6) items.pop();
    let pos = -rowLen(items) / 2;
    for (const it of items) {
      const along = pos + it.w / 2; pos += it.w + GAP;
      let cx, cz, turn;
      if (side === "N") { cx = along; cz = -spec.yd / 2 - FS - it.d / 2; turn = 0; }
      else if (side === "S") { cx = along; cz = spec.yd / 2 + FS + it.d / 2; turn = 2; }
      else if (side === "W") { cx = -spec.yw / 2 - FS - it.d / 2; cz = along; turn = 1; }
      else { cx = spec.yw / 2 + FS + it.d / 2; cz = along; turn = 3; }
      out.push(Object.assign({ side }, it, { cx, cz, turn }));
    }
  }
  return out;
}
const TRANSPOSE_TURN = [1, 0, 3, 2];
function slotOk(S, waterY, bb, reliefMax) {
  const s = scan(S, bb[0] - 1.5, bb[2] + 1.5, bb[1] - 1.5, bb[3] + 1.5, 2);
  return s.n > 0 && s.lo >= waterY + GEN_WET && s.hi - s.lo <= reliefMax;
}
/** wet stretches of a lane's centreline (axis 0 = along x, 1 = along z), bounded by dry ground on both ends = where the lane needs a bridge */
function bridgeRuns(S, waterY, cx, cz, axis, len) {
  const out = [], n = Math.round(len / LAT), half = len / 2;
  const hs = [];
  for (let k = 0; k <= n; k++) {
    const x = axis === 0 ? cx - half + k * LAT : cx, z = axis === 0 ? cz : cz - half + k * LAT;
    hs.push([x, z, S.h(x, z)]);
  }
  let runStart = -1;
  const wet = (k) => hs[k][2] < waterY + GEN_WET - 0.5;
  for (let k = 0; k <= n; k++) {
    if (wet(k) && runStart < 0) runStart = k;
    if (!wet(k) && runStart >= 0) {
      if (runStart > 0 && k - runStart >= 3) {
        const a = hs[runStart - 1], b = hs[k];
        out.push({ x0: r3(a[0]), z0: r3(a[1]), x1: r3(b[0]), z1: r3(b[1]), len: r3(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])), width: 6, deck: r2(Math.max(a[2], b[2]) + 0.4) });
      }
      runStart = -1;
    }
  }
  return out;
}
function clusterAttempt(seed, poi, S, waterY, theme, kind, opts) {
  const rng = subRng(seed, poi.id);
  const fixed = !!opts.fixed;
  const lane = kind === "lane" ? (theme === "mill" ? 190 : clamp(Math.round(poi.r * 1.0 / 5) * 5, 60, 120)) : 0;      // (a "green" is a fixed 40 x 26 m common)
  const spec = yardItems(subRng(seed, poi.id, "items"), kind, theme, { lane, variety: !!opts.variety });
  const frame = yardFrame(spec);
  const reliefMax = kind === "compound" ? 3.2 : theme === "ruin" ? 5.5 : 3.6;
  const minB = kind === "compound" ? 2 : 6;
  const axes = opts.axis != null ? [opts.axis] : [0, 1];
  const maxShift = fixed ? 0 : opts.maxShift != null ? opts.maxShift : Math.round(poi.r * 0.6);
  const cands = anchorCandidates(maxShift, opts.step || 10);
  const place = (cx, cz, axis) => {
    const items = frame.map((f) => {
      const x = axis === 1 ? f.cz : f.cx, z = axis === 1 ? f.cx : f.cz;
      const turn = axis === 1 ? TRANSPOSE_TURN[f.turn] : f.turn;
      const b = { cx: cx + x, cz: cz + z, turn };
      return { f, b, bb: aabbOf(b, f.w, f.d) };
    });
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const it of items) { bx0 = Math.min(bx0, it.bb[0]); bz0 = Math.min(bz0, it.bb[1]); bx1 = Math.max(bx1, it.bb[2]); bz1 = Math.max(bz1, it.bb[3]); }
    const clash = hitsAvoid(opts.avoid, bx0, bz0, bx1, bz1, 6);
    for (const it of items) it.ok = !clash && slotOk(S, waterY, it.bb, reliefMax);
    return items;
  };
  const good = Math.max(minB, Math.ceil(frame.length * 0.85));
  let best = null, ringDone = -1;
  for (const c of cands) {
    const ring = Math.max(Math.abs(c[0]), Math.abs(c[1]));
    if (best && best.n >= good && ringDone >= 0 && ring > ringDone) break;                    // a (nearly) full village was found in an earlier ring: nothing nearer can beat it
    const cx = 2 * Math.round((poi.x + c[0]) / 2), cz = 2 * Math.round((poi.z + c[1]) / 2);
    if ((c[0] !== 0 || c[1] !== 0) && S.n(cx / 2, cz / 2) < waterY + GEN_WET) continue;       // a yard centred in the sea is never the answer
    for (const axis of axes) {
      const items = place(cx, cz, axis);
      const n = items.filter((q) => q.ok).length;
      // below minB every missing building costs 100 m of shift, above it 1.5 m: the nearest spot that holds a village wins, the fullest one among equals
      let cost = Math.max(0, minB - n) * 1000 + (frame.length - n) * 15 + (Math.abs(c[0]) + Math.abs(c[1])) + (axis === 1 && opts.axis == null ? 0.1 : 0);
      if (theme === "mill" && waterY > -100 && !bridgeRuns(S, waterY, cx, cz, axis, spec.yw).length) cost += 5000;       // a mill straddles its river: a bridge is part of the plan (O4)
      if (!best || cost < best.cost - 1e-9) best = { cx, cz, axis, items, n, cost, cand: c };
    }
    if (best && best.n >= good && ringDone < 0) ringDone = ring;
  }
  const L = {
    v: VERSION, id: poi.id, kind, theme, seed, poi: { x: r3(poi.x), z: r3(poi.z), r: poi.r },
    anchor: { x: best.cx, z: best.cz, shift: [best.cand[0], best.cand[1]], axis: best.axis, level: 0 },
    grid: null, blocks: [], dropped: [], roads: { nodes: [], edges: [], portals: [], streets: [] }, pads: [], corridors: [], parcels: [], doors: [], rooms: [], stairs: [], bridges: [],
    compound: null,
  };
  const t = (x, z) => (best.axis === 1 ? [best.cx + z, best.cz + x] : [best.cx + x, best.cz + z]);   // yard-frame point -> world
  let order = 0;
  for (const it of best.items) {
    if (!it.ok) continue;
    const id = "p" + order++;
    const sub = subRng(seed, poi.id, id);
    const fit = { key: it.f.key, w: it.f.w, d: it.f.d, floors: it.f.floors, fh: it.f.fh, use: it.f.use, gen: it.f.gen };
    const bd = { cx: it.b.cx, cz: it.b.cz, turn: it.b.turn, w: fit.w, d: fit.d, floors: fit.floors, floorH: fit.fh, use: fit.use };
    const bb = it.bb;
    const big = fit.use === "barn" || fit.use === "hall";
    const par = {
      id, block: -1, use: fit.use, rect: [r3(bb[0] - 1), r3(bb[1] - 1), r3(bb[2] + 1), r3(bb[3] + 1)], facing: FACE[it.b.turn].slice(), side: it.f.side,
      building: { cx: r3(bd.cx), cz: r3(bd.cz), w: fit.w, d: fit.d, turn: bd.turn, rot: ROT[bd.turn], facing: FACE[bd.turn].slice(), aabb: [r3(bb[0]), r3(bb[1]), r3(bb[2]), r3(bb[3])],
        gen: fit.gen, arch: fit.key, floors: fit.floors, floorH: fit.fh, height: r2(fit.floors * fit.fh + 0.9), enterable: true, ruin: theme === "ruin",
        palette: paletteFor(sub, theme, big), ground: groundOf(S, bb[0], bb[1], bb[2], bb[3]) },
    };
    L.parcels.push(par);
    const inter = genInterior(sub, bd, id);
    L.rooms.push(...inter.rooms); L.doors.push(...inter.doors); L.stairs.push(...inter.stairs);
  }
  // pads: one per building footprint (+1 m stoop), C-PAD falloff 4 m
  for (const p of L.parcels) L.pads.push(padOf(p));
  // yard, fence, cars, silo, fields (frame -> world; axis-aligned either way)
  const yq = [t(-spec.yw / 2, -spec.yd / 2), t(spec.yw / 2, spec.yd / 2)];
  const yard = [Math.min(yq[0][0], yq[1][0]), Math.min(yq[0][1], yq[1][1]), Math.max(yq[0][0], yq[1][0]), Math.max(yq[0][1], yq[1][1])].map(r3);
  L.compound = { yard, axis: best.axis, spec: { yw: spec.yw, yd: spec.yd }, entry: { x: r3((yard[0] + yard[2]) / 2), z: r3((yard[1] + yard[3]) / 2) }, fence: [], cars: [], props: [], fields: [] };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of L.parcels) { const a = p.building.aabb; x0 = Math.min(x0, a[0]); z0 = Math.min(z0, a[1]); x1 = Math.max(x1, a[2]); z1 = Math.max(z1, a[3]); }
  x0 = Math.min(x0, yard[0]); z0 = Math.min(z0, yard[1]); x1 = Math.max(x1, yard[2]); z1 = Math.max(z1, yard[3]);
  L.compound.bounds = [r3(x0), r3(z0), r3(x1), r3(z1)];
  if (spec.fence && L.parcels.length) {
    const f = [x0 - 3, z0 - 3, x1 + 3, z1 + 3].map(r3), gate = rint(subRng(seed, poi.id, "gate"), 0, 3), mid = [(f[0] + f[2]) / 2, (f[1] + f[3]) / 2];
    const segs = [[f[0], f[1], f[2], f[1]], [f[2], f[1], f[2], f[3]], [f[0], f[3], f[2], f[3]], [f[0], f[1], f[0], f[3]]];
    segs.forEach((s, k) => {
      if (k !== gate) { L.compound.fence.push(s.map(r3)); return; }
      if (s[1] === s[3]) { L.compound.fence.push([s[0], s[1], r3(mid[0] - 3), s[3]], [r3(mid[0] + 3), s[1], s[2], s[3]]); L.compound.gate = [r3(mid[0]), s[1]]; }
      else { L.compound.fence.push([s[0], s[1], s[2], r3(mid[1] - 3)], [s[0], r3(mid[1] + 3), s[2], s[3]]); L.compound.gate = [s[0], r3(mid[1])]; }
    });
    L.compound.bounds = f;
  }
  L.compound.variant = spec.variant;
  const keepOut = [];                                  // [x, z, r]: what a car keeps clear of (Wave 7 polish: containers, the water tower)
  if (spec.containers) {
    const cs = [[-spec.yw / 2 + 4, -spec.yd / 2 + 2.6], [spec.yw / 2 - 4, spec.yd / 2 - 2.6], [-spec.yw / 2 + 4, spec.yd / 2 - 2.6]];
    for (let k = 0; k < spec.containers; k++) {
      const q = t(cs[k][0], cs[k][1]);
      L.compound.props.push({ kind: "container", x: r3(q[0]), z: r3(q[1]), rot: best.axis === 1 ? 1 : 0 });
      keepOut.push([q[0], q[1], 4.2]);
    }
  }
  if (spec.tower && L.parcels.length) { const q = t(0, 0); L.compound.props.push({ kind: "watertower", x: r3(q[0]), z: r3(q[1]) }); keepOut.push([q[0], q[1], 7]); }
  const crng = subRng(seed, poi.id, "cars");
  for (let k = 0; k < spec.cars; k++) {
    let cx = rrange(crng, yard[0] + 3, yard[2] - 3), cz = rrange(crng, yard[1] + 2, yard[3] - 2);
    const hits = () => keepOut.some((o) => (o[0] - cx) * (o[0] - cx) + (o[1] - cz) * (o[1] - cz) < o[2] * o[2]);
    for (let tries = 0; tries < 8 && hits(); tries++) { cx = rrange(crng, yard[0] + 3, yard[2] - 3); cz = rrange(crng, yard[1] + 2, yard[3] - 2); }
    if (hits()) continue;                              // (no free spot in 8 draws: this car is not parked)
    L.compound.cars.push({ x: r3(cx), z: r3(cz), turn: (yard[2] - yard[0] >= yard[3] - yard[1] ? 1 : 0) + 2 * rint(crng, 0, 1) });
  }
  if (spec.silo && L.parcels.length) {
    const barn = L.parcels.find((p) => p.building.arch === "barn");
    if (barn) {
      const a = barn.building.aabb, back = [-barn.building.facing[0], -barn.building.facing[1]];
      L.compound.props.push({ kind: "silo", x: r3((a[0] + a[2]) / 2 + back[0] * (Math.abs(back[0]) ? (a[2] - a[0]) / 2 + 4 : 0)), z: r3((a[1] + a[3]) / 2 + back[1] * (Math.abs(back[1]) ? (a[3] - a[1]) / 2 + 4 : 0)), r: 2.2, h: 10 });
    }
  }
  for (let k = 0; k < spec.fields; k++) {
    const side = [[1, 0], [-1, 0], [0, 1]][k % 3];
    const bd = L.compound.bounds, w = 36, d = 26;
    const fx = side[0] > 0 ? bd[2] + 6 : side[0] < 0 ? bd[0] - 6 - w : (bd[0] + bd[2]) / 2 - w / 2, fz = side[1] > 0 ? bd[3] + 6 : (bd[1] + bd[3]) / 2 - d / 2;
    const fr = [fx, fz, fx + w, fz + d].map(r3);
    if (slotOk(S, waterY, fr, 4.5)) L.compound.fields.push(fr);
  }
  // wet stretches of the lane centreline = bridges (Riverside Mill: a lane across the river)
  if (kind === "lane") L.bridges = bridgeRuns(S, waterY, best.cx, best.cz, best.axis, spec.yw);
  L.centre = centreOf(L);
  L.stats = summarize(L);
  L.stats.slotsDropped = best.items.length - best.items.filter((q) => q.ok).length;
  if (best.n < minB) L.stats.failed = "few_buildings";
  return L;
}
/** a cluster: the plan's reach first, then up to HARD_SHIFT away (a POI on water): the first attempt with enough enterable buildings wins */
function clusterStaged(seed, poi, S, waterY, theme, kind, opts) {
  const minEnt = opts.minEnterable != null ? opts.minEnterable : kind === "compound" ? 3 : 6;
  const shift1 = opts.fixed ? 0 : opts.maxShift != null ? opts.maxShift : Math.round(poi.r * 0.6);
  const reach = opts.reach != null ? opts.reach : HARD_SHIFT;
  let L = clusterAttempt(seed, poi, S, waterY, theme, kind, Object.assign({}, opts, { maxShift: shift1 }));
  L.stage = { tries: 1, maxShift: shift1, hard: false };
  if (L.stats.enterable >= minEnt || opts.fixed || shift1 >= reach) return L;
  const H = clusterAttempt(seed, poi, S, waterY, theme, kind, Object.assign({}, opts, { maxShift: reach, step: reach > 300 ? 28 : 20 }));
  H.stage = { tries: 2, maxShift: reach, hard: true };
  return H.stats.enterable > L.stats.enterable ? H : L;
}

// ── Wave 7b: the special layouts - a docks village, a crater-rim village, a mill-and-bridge compound ──────────────────────────────────────────────────────────────────
// Each is ONE POI's layout in the same shape as every other (parcels with buildings, doors / rooms / stairs, compound.bounds, ends) plus a kind-specific record (`docks`,
// `crater`, `mill`) that maps.js builds from: decks, posts, terraces, walls, stairs, a bridge, cover pieces. Pure data like the rest: a function of (seed, poi, ground), its own
// sub-RNG, plain arithmetic, no builds. Only Isla Viva (docks, crater) and Deepwood (mill) use them; Savanna's layouts never reach this code.
/** a building parcel record and its interior for an archetype at an exact spot (the special layouts place buildings by hand, not by parcel) */
function specialBuilding(S, seed, poiId, theme, pid, cx, cz, turn, key, w, d, floors, extra) {
  const A = ARCH[key], sub = subRng(seed, poiId, pid);
  const bd = { cx: r3(cx), cz: r3(cz), turn, w, d, floors, floorH: A.fh, use: A.use };
  const bb = aabbOf(bd, w, d);
  const big = A.use === "midrise" || A.use === "tower" || A.use === "hall" || A.use === "barn" || A.use === "shop";
  const par = { id: pid, block: -1, use: A.use, rect: [r3(bb[0] - 1), r3(bb[1] - 1), r3(bb[2] + 1), r3(bb[3] + 1)], facing: FACE[turn].slice(),
    building: { cx: bd.cx, cz: bd.cz, w, d, turn, rot: ROT[turn], facing: FACE[turn].slice(), aabb: [r3(bb[0]), r3(bb[1]), r3(bb[2]), r3(bb[3])], gen: A.gen, arch: key, floors, floorH: A.fh,
      height: r2(floors * A.fh + (A.gen === "tower" ? 1.6 : 0.9)), enterable: true, palette: paletteFor(sub, theme, big), ground: groundOf(S, bb[0], bb[1], bb[2], bb[3]) } };
  if (extra) Object.assign(par.building, extra);
  return { parcel: par, inter: genInterior(sub, bd, pid) };
}
/** an empty layout record of a special kind (the shape of clusterAttempt's) */
function specialRecord(seed, poi, theme, kind) {
  return { v: VERSION, id: poi.id, kind, theme, seed, poi: { x: r3(poi.x), z: r3(poi.z), r: poi.r }, anchor: { x: poi.x, z: poi.z, shift: [0, 0], level: 0 }, grid: null, blocks: [], dropped: [],
    roads: { nodes: [], edges: [], portals: [], streets: [] }, pads: [], corridors: [], parcels: [], doors: [], rooms: [], stairs: [], bridges: [], compound: null, ends: [] };
}
function addSpecial(L, made) { L.parcels.push(made.parcel); L.rooms.push(...made.inter.rooms); L.doors.push(...made.inter.doors); L.stairs.push(...made.inter.stairs); }
const rectAlong = (P, dx, dz, a0, a1, c0, c1) => {       // the axis-aligned rectangle of along [a0, a1] x across [c0, c1] of a frame at P whose along axis is (dx, dz) and across axis (-dz, dx)
  const px = -dz, pz = dx, xs = [], zs = [];
  for (const a of [a0, a1]) for (const c of [c0, c1]) { xs.push(P[0] + dx * a + px * c); zs.push(P[1] + dz * a + pz * c); }
  return [r3(Math.min(...xs)), r3(Math.min(...zs)), r3(Math.max(...xs)), r3(Math.max(...zs))];
};
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ── the docks village (Isla Viva, Lagoon Docks): a boardwalk running out over the shallows with a stilt house on either side of it every 14 m ──────────────────────────
// A deck is a 0.3 m slab whose top is DOCK_TOP over the sea (a swimmer can pull himself onto it; a step from the beach is 0.4 m); posts (cosmetic) carry it down to the seabed;
// the houses stand ON the decks (the layout's `deck` flag: maps.js house() takes `y0`). The site is searched on a 20 m grid round the POI: for each anchor and each of the four
// axis directions the boardwalk starts where the ground first drops under waterY + 0.5 (the landing) and runs out as far as the seabed stays shallower than 4.2 m with the
// platform strips either side of it; the best run (longest, with a beach to land on, near the POI) wins.
export const DOCK_TOP = 0.9;
const DOCK_DEPTH = 4.2, DOCK_LEN = 84, DOCK_PITCH = 14;
function docksAttempt(seed, poi, S, waterY, theme, opts) {
  const reachA = opts.maxShift != null ? opts.maxShift : 110;
  const rng = subRng(seed, poi.id, "docks");
  let avoidPad = 24;                                                                                  // (24 m from the towns laid out before; a second search with 4 m when that left no beach to land on)
  const evalSite = (cx, cz, d) => {
    const [dx, dz] = DIRS4[d], px = -dz, pz = dx;
    let k0 = -1;
    for (let k = 0; k <= 8; k++) if (S.h(cx + dx * k * 4, cz + dz * k * 4) <= waterY + 0.5) { k0 = k; break; }
    if (k0 < 0) return null;
    let run = -1;
    for (let k = 0; k <= DOCK_LEN / 4; k++) {
      const x = cx + dx * (k0 + k) * 4, z = cz + dz * (k0 + k) * 4, h = S.h(x, z);
      if (waterY - h > DOCK_DEPTH || (k > 0 && h > waterY + 0.8)) break;
      let bad = 0;
      for (const o of [6, 12, -6, -12]) if (waterY - S.h(x + px * o, z + pz * o) > 4.6) bad++;
      if (bad > 1) break;
      run = k;
    }
    if (opts.avoid && opts.avoid.length) {                                                      // the village keeps off the towns laid out before it (the shore group inland, the boardwalk and its platforms out to sea)
      const P1 = [cx + dx * k0 * 4, cz + dz * k0 * 4], rr = rectAlong(P1, dx, dz, -48, DOCK_LEN + 4, -15, 15);
      if (hitsAvoid(opts.avoid, rr[0], rr[1], rr[2], rr[3], avoidPad)) return null;                // (24 m: a town's plateau pad falls off over up to 12 m, and the dock's own pads over 9)
    }
    const inl = S.h(cx + dx * (k0 * 4 - 10), cz + dz * (k0 * 4 - 10));                            // the link road meets the village 10 m inland of the landing: a spit lower than 0.4 m there would lose its last stretch
    return run < 9 ? null : { cx, cz, d, k0, run, score: run * 4 + (k0 > 0 ? 80 : 0) - (inl < waterY + 0.4 ? 70 : 0) };         // (a beach to land on is worth 80 m of walking: the village moves up to ~250 m to get one)
  };
  let best = null;
  const pass = (R, step) => {
    for (let a = -R; a <= R; a += step) for (let b = -R; b <= R; b += step) {
      const cx = 2 * Math.round((poi.x + a) / 2), cz = 2 * Math.round((poi.z + b) / 2), h0 = S.h(cx, cz);
      if (h0 > waterY + 4 || h0 < waterY - DOCK_DEPTH) continue;                                       // inland or deep sea: no landing / no seabed to stand on
      for (let d = 0; d < 4; d++) {
        const s = evalSite(cx, cz, d);
        if (!s) continue;
        s.score -= 0.3 * dist2(cx - poi.x, cz - poi.z);
        if (!best || s.score > best.score + 1e-9) best = s;
      }
    }
  };
  const searchAll = () => { pass(Math.max(reachA, 300), 20); if (!best) pass(opts.reach != null ? Math.min(opts.reach, 520) : 400, 40); };
  searchAll();
  if (!best || best.k0 === 0) { const keep = best; avoidPad = 4; best = null; searchAll(); if (!best || (best.k0 === 0 && keep && keep.k0 === 0 && keep.score >= best.score)) best = keep || best; }
  const L = specialRecord(seed, poi, theme, "docks");
  if (!best) { L.stats = summarize(L); L.stats.failed = "no_shore"; L.centre = [r3(poi.x), r3(poi.z)]; return L; }
  const [dx, dz] = DIRS4[best.d], px = -dz, pz = dx;
  const P0 = [best.cx + dx * best.k0 * 4, best.cz + dz * best.k0 * 4];
  const len = Math.min(DOCK_LEN, Math.floor((best.run * 4) / 12) * 12);
  const top = r2(waterY + DOCK_TOP);
  const decks = [{ role: "spine", rect: rectAlong(P0, dx, dz, -2, len, -2, 2) }];
  const mix = [["house_s", 30], ["house_m", 30], ["shop", 22], ["shed", 8], ["cabin", 10]];
  let n = 0;
  for (let s = 8; s + 6 <= len + 0.01; s += DOCK_PITCH) for (const side of [-1, 1]) {
    const pr = rectAlong(P0, dx, dz, s - 6, s + 6, side < 0 ? -12.5 : 2, side < 0 ? -2 : 12.5);
    let wetPts = 0, hiPts = 0;
    for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
      const x = pr[0] + (pr[2] - pr[0]) * (a + 0.5) / 3, z = pr[1] + (pr[3] - pr[1]) * (c + 0.5) / 3, h = S.h(x, z);
      if (h <= waterY + 0.75 && waterY - h <= 4.6) wetPts++;
      if (h > waterY + 1.4) hiPts++;
    }
    if (wetPts < 5 || hiPts > 0) continue;                                                              // (a platform on a hill - a bank beside the landing - would bury its deck: skipped)
    // what stands on it: the archetype is drawn first (the stream does not depend on which platforms fit), then fitted to 10.5 x 8.9 m
    const key = wpick(rng, mix, (q) => q[1])[0];
    let fit = fitArch(rng, key, 10.5, 8.9, 0, false) || fitArch(rng, "shed", 10.5, 8.9, 0, false);
    const across = side * (3 + fit.d / 2), face = [-side * px, -side * pz];
    const cx = P0[0] + dx * s + px * across, cz = P0[1] + dz * s + pz * across;
    decks.push({ role: "platform", rect: pr });
    addSpecial(L, specialBuilding(S, seed, poi.id, theme, "p" + n, cx, cz, turnOf(face[0], face[1]), fit.key, fit.w, fit.d, fit.floors, { deck: true, y0: top }));
    n++;
  }
  // the shore group: up to four buildings on the dry land behind the landing (a beach bar, shops, a couple of cottages), two rows either side of the street that continues the boardwalk
  // inland; each needs level dry ground (>= waterY + 0.9 at five points, relief <= 2.5 m); they are ordinary pad buildings (no `deck`)
  let shore = 0;
  if (best.k0 > 0) {
    for (const [a0, side] of [[-18, -1], [-18, 1], [-36, -1], [-36, 1]]) {
      const key = wpick(rng, mix, (q) => q[1])[0];
      const fit = fitArch(rng, key, 11, 11, 0, false) || fitArch(rng, "shed", 11, 11, 0, false);
      const across = side * (4 + fit.d / 2), cx = P0[0] + dx * a0 + px * across, cz = P0[1] + dz * a0 + pz * across;
      const turn = turnOf(-side * px, -side * pz), bd = { cx, cz, turn };
      const bb = aabbOf(bd, fit.w, fit.d);
      const sc = scan(S, bb[0] - 2, bb[2] + 2, bb[1] - 2, bb[3] + 2, 2);
      if (!(sc.lo >= waterY + 0.9) || sc.hi - sc.lo > 2.5) continue;
      addSpecial(L, specialBuilding(S, seed, poi.id, theme, "s" + shore, cx, cz, turn, fit.key, fit.w, fit.d, fit.floors, { shore: true }));
      shore++;
    }
  }
  // the head of the boardwalk: a 16 m promenade across its end with a boat shed on it when there is room
  const head = rectAlong(P0, dx, dz, len, len + 4, -8, 8);
  let headOk = true;
  for (const [a, c] of [[len + 2, -7], [len + 2, 7], [len + 2, 0]]) { const h = S.h(P0[0] + dx * a + px * c, P0[1] + dz * a + pz * c); if (waterY - h > 4.6) headOk = false; }
  if (headOk) decks.push({ role: "head", rect: head });
  L.docks = { top, dir: [dx, dz], landing: [r3(P0[0]), r3(P0[1])], length: len, decks, platforms: n, k0: best.k0 };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const dk of decks) { x0 = Math.min(x0, dk.rect[0]); z0 = Math.min(z0, dk.rect[1]); x1 = Math.max(x1, dk.rect[2]); z1 = Math.max(z1, dk.rect[3]); }
  for (const p of L.parcels) { const a = p.building.aabb; x0 = Math.min(x0, a[0]); z0 = Math.min(z0, a[1]); x1 = Math.max(x1, a[2]); z1 = Math.max(z1, a[3]); }
  const yard = decks[0].rect;
  L.compound = { yard, axis: dx ? 0 : 1, spec: { yw: len, yd: 4 }, entry: { x: r3(P0[0]), z: r3(P0[1]) }, fence: [], cars: [], props: [], fields: [], bounds: [r3(x0), r3(z0), r3(x1), r3(z1)], variant: "docks" };
  let back = 10;                                                                                     // the link road meets the village inland of the landing, on ground that stays dry (>= waterY + 1.0: a low beach would drop the road's last stretch)
  while (back < 56 && S.h(P0[0] - dx * back, P0[1] - dz * back) < waterY + 1.0) back += 4;
  if (S.h(P0[0] - dx * back, P0[1] - dz * back) < waterY + 1.0) back = 10;                                // (a spit with no such ground behind it: the old end)
  L.ends = [{ x: r3(P0[0] - dx * back), z: r3(P0[1] - dz * back), dx: -dx, dz: -dz }];
  L.centre = [r3((x0 + x1) / 2), r3((z0 + z1) / 2)];
  L.stage = { tries: 1, maxShift: reachA, hard: false };
  L.stats = summarize(L);
  L.stats.docksDeckArea = r2(decks.reduce((a, dk) => a + (dk.rect[2] - dk.rect[0]) * (dk.rect[3] - dk.rect[1]), 0));
  return L;
}

// ── terrace plots (the crater-rim village and the mill village) ────────────────────────────────────────────────────────────────────────────────────────────────────
// A plot is an axis-aligned shelf: the building (a quarter turn, facing `f`) + `m` metres each side, levelled to the median of the ground under it, with a retaining wall (0.8 m thick,
// along the plot's uphill edge, a 2.6 m gate through it in about half of them). The building's own pad finds the plot's (padReuse) and stands on it.
function placePlot(ctx, cx, cz, f, key, uid, wallH, gateU, gateT, extra) {
  const { S, seed, poi, theme, L, taken, plots, walls } = ctx;
  const turn = quarterOf(f[0], f[1]), fc = FACE[turn];
  const fit = fitArch(subRng(seed, poi.id, "fit" + uid), key, ctx.fw, ctx.fd, 0, false) || fitArch(subRng(seed, poi.id, "fit" + uid), "shed", ctx.fw, ctx.fd, 0, false);
  if (!fit) return null;
  const bb = aabbOf({ cx, cz, turn }, fit.w, fit.d), m = ctx.margin;
  const plot = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m], up = [-fc[0], -fc[1]], ext = plot.slice();
  if (up[0] > 0) ext[2] += 4.4; else if (up[0] < 0) ext[0] -= 4.4; else if (up[1] > 0) ext[3] += 4.4; else ext[1] -= 4.4;
  if (hitsAvoid(ctx.avoid, ext[0], ext[1], ext[2], ext[3], 2)) return null;
  for (const t of taken) if (rectsOverlap(ext, t, 1.5)) return null;
  const pid = "p" + plots.length;
  taken.push(ext);
  const sc = scan(S, plot[0], plot[2], plot[1], plot[3], 2, true), level = r2(medianOfVals(sc.n));
  plots.push({ id: pid, ring: ctx.ring || 0, cx: r3(cx), cz: r3(cz), rect: plot.map(r3), level, turn, arch: fit.key });
  addSpecial(L, specialBuilding(S, seed, poi.id, theme, pid, cx, cz, turn, fit.key, fit.w, fit.d, fit.floors, Object.assign({ plot: plots.length - 1 }, extra || {})));
  const alongX = up[1] !== 0, len = alongX ? plot[2] - plot[0] : plot[3] - plot[1], wc = alongX ? (plot[0] + plot[2]) / 2 : (plot[1] + plot[3]) / 2;
  const wx = alongX ? 0 : (up[0] > 0 ? plot[2] + 0.9 : plot[0] - 0.9), wz = alongX ? (up[1] > 0 ? plot[3] + 0.9 : plot[1] - 0.9) : 0;
  const gate = gateU < 0.55 ? 2.6 : 0, gateAt = (gateT - 0.5) * (len - 8), s0 = wc - len / 2;
  const wall = (a0, a1) => { if (a1 - a0 > 1) walls.push({ kind: "retain", x: r3(alongX ? (a0 + a1) / 2 : wx), z: r3(alongX ? wz : (a0 + a1) / 2), len: r2(a1 - a0), th: 0.8, h: r2(wallH), axis: alongX ? 0 : 1, plot: pid }); };
  if (!gate) wall(s0, s0 + len);
  else { const l1 = len / 2 + gateAt - gate / 2, l2 = len / 2 - gateAt - gate / 2; wall(s0, s0 + l1); wall(s0 + len - l2, s0 + len); }
  return { fit, pid };
}
/** footprint, bounds, centre and stats of a special layout from its parcels and the extra rectangles it names */
function finishSpecial(L, extraRects, bounds) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of extraRects) { x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]); x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]); }
  for (const p of L.parcels) { const a = p.building.aabb; x0 = Math.min(x0, a[0]); z0 = Math.min(z0, a[1]); x1 = Math.max(x1, a[2]); z1 = Math.max(z1, a[3]); }
  return bounds || [r3(x0), r3(z0), r3(x1), r3(z1)];
}

// ── the crater-rim village (Isla Viva, Volcano Rim: the endgame area of O4) ───────────────────────────────────────────────────────────────────────────────────────────
// The last circles always end within ~100 m of the map centre, 72 m from the volcano's axis: a bare 40 % slope. This is the village that stands there: rings of terrace plots round
// the axis (radius 54 / 80 / 106 / 130 m), each a levelled shelf with a ruined stone house facing outward and a retaining wall on its uphill side, a ring of broken columns round
// a levelled plaza in the bowl, broken arches on the four axis lines, and free-standing columns, rubble heaps and wall fragments between the plots. Never a street grid. `h` of a
// wall / piece is its height over the HIGHEST ground under it (taller on the downhill side), so the cover is at least that tall everywhere. Only + - * / and sqrt: the unit
// vectors come from half-angle recurrences (UNIT256), not sin / cos.
const UNIT256 = (() => {
  let c = -1, s = 0;                                     // the angle pi
  for (let k = 0; k < 7; k++) { const c2 = Math.sqrt((1 + c) / 2), s2 = Math.sqrt((1 - c) / 2); c = c2; s = s2; }       // halved seven times: 2 pi / 256
  const out = [[1, 0]];
  for (let k = 1; k < 256; k++) { const p = out[k - 1]; out.push([p[0] * c - p[1] * s, p[0] * s + p[1] * c]); }
  return out;
})();
/** the unit vector at turn fraction t in [0, 1) (counter-clockwise from +x): a table lookup and a normalised blend, no trig */
function unitAt(t) {
  t -= Math.floor(t);
  const f = t * 256, i = Math.floor(f) % 256, u = f - Math.floor(f), a = UNIT256[i], b = UNIT256[(i + 1) % 256];
  const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u, l = Math.sqrt(x * x + z * z);
  return [x / l, z / l];
}
/** the quarter turn (0..3) whose facing is nearest the direction (fx, fz): 0 +z, 1 +x, 2 -z, 3 -x */
const quarterOf = (fx, fz) => (Math.abs(fx) >= Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2));
const rectsOverlap = (a, b, m) => a[0] - m < b[2] && a[2] + m > b[0] && a[1] - m < b[3] && a[3] + m > b[1];

const CRATER_RINGS = [{ R: 54, step: 31 }, { R: 80, step: 30 }, { R: 106, step: 31 }, { R: 130, step: 36 }];     // (stage B: a denser village - steps were 38 / 37 / 38 / 44)
function craterAttempt(seed, poi, S, waterY, theme, opts) {
  const V = [poi.x, poi.z], rng = subRng(seed, poi.id, "crater");
  const L = specialRecord(seed, poi, theme, "crater");
  const mixAll = [["house_m", 36], ["house_s", 32], ["cabin", 16], ["shed", 8], ["shop", 8]];
  const ctx = { S, seed, poi, theme, L, taken: [], plots: [], walls: [], avoid: opts.avoid || [], fw: 12.5, fd: 10.5, margin: 2.0 };
  const pieces = [], arches = [], taken = ctx.taken, avoid = ctx.avoid;
  const slopeAt = (x, z) => { const a = S.h(x + 5, z) - S.h(x - 5, z), b = S.h(x, z + 5) - S.h(x, z - 5); return dist2(a, b) / 10; };
  // the four stair lines (the axis directions through the volcano's axis, 7 m wide corridors from the plaza's edge to the outer ring): nothing else is placed on them
  const stairs = [];
  for (const [ux, uz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const r0 = 22, r1 = 126;
    stairs.push({ cx: r3(V[0]), cz: r3(V[1]), dx: ux, dz: uz, r0, r1 });
    const cr = ux ? [V[0] + (ux > 0 ? r0 : -r1), V[1] - 3.5, V[0] + (ux > 0 ? r1 : -r0), V[1] + 3.5] : [V[0] - 3.5, V[1] + (uz > 0 ? r0 : -r1), V[0] + 3.5, V[1] + (uz > 0 ? r1 : -r0)];
    cr.corr = true; taken.push(cr);                                       // (a corridor: plots and free pieces keep off it, an arch may stand on it)
  }
  for (let k = 0; k < CRATER_RINGS.length; k++) {
    const { R, step } = CRATER_RINGS[k], cnt = Math.floor((2 * 3.14159265358979 * R) / step), a0 = rng();
    ctx.ring = k;
    for (let i = 0; i < cnt; i++) {
      // every draw of a slot is made whether or not the slot is kept (the stream does not depend on the ground)
      const ta = a0 + (i + (rng() - 0.5) * 0.3) / cnt, rr = R + (rng() - 0.5) * 8, wallH = 1.6 + rng() * 0.8, gateU = rng(), gateT = rng();
      const u = unitAt(ta), cx = V[0] + u[0] * rr, cz = V[1] + u[1] * rr;
      if (S.h(cx, cz) < waterY + 2 || slopeAt(cx, cz) > 0.62) continue;
      const key = wpick(subRng(seed, poi.id, "kind" + ctx.plots.length + "," + k + "," + i), mixAll, (q) => q[1])[0];
      placePlot(ctx, cx, cz, u, key, ctx.plots.length + "," + k + "," + i, wallH, gateU, gateT, { ruin: true });
    }
  }
  const plots = ctx.plots, walls = ctx.walls;
  // the plaza in the bowl: a levelled disc (r 16) of broken columns round an altar
  const psc = scan(S, V[0] - 16, V[0] + 16, V[1] - 16, V[1] + 16, 2, true);
  const pl = { x: r3(V[0]), z: r3(V[1]), r: 16, level: r2(medianOfVals(psc.n)), columns: [], altar: { x: r3(V[0]), z: r3(V[1]) } };
  for (let i = 0; i < 8; i++) {
    const u = unitAt((i + 0.5) / 8 + rng() * 0.02), hh = 1.6 + rng() * 2.4;
    pl.columns.push([r3(V[0] + u[0] * 13), r3(V[1] + u[1] * 13), r2(hh)]);
  }
  taken.push([V[0] - 18, V[1] - 18, V[0] + 18, V[1] + 18]);
  // broken arches on the four axis lines at 67 and 93 m (a gateway between two rings): two pillars and a lintel over the gap
  for (const [ux, uz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) for (const R of [67, 93]) {
    const x = V[0] + ux * R, z = V[1] + uz * R, r0 = rng();
    if (S.h(x, z) < waterY + 2 || slopeAt(x, z) > 0.6) continue;
    const bx = [x - (uz ? 3 : 1.4), z - (ux ? 3 : 1.4), x + (uz ? 3 : 1.4), z + (ux ? 3 : 1.4)];
    let clash = false;
    for (const t of taken) if (!t.corr && rectsOverlap(bx, t, 1)) { clash = true; break; }
    if (clash) continue;
    taken.push(bx);
    arches.push({ x: r3(x), z: r3(z), axis: ux ? 1 : 0, gap: 3.4, h: r2(3.8 + r0 * 0.6), broken: r0 < 0.4 });      // axis 1: the pillars are separated along z (the gateway is crossed along the radial line)
  }
  // (stage B) four ruined watchtowers on the diagonals between the stair lines (radius 118, else 96): hollow stone shafts 6.5 - 9.5 m tall with a doorway toward the axis; every slot draws its
  // three numbers whether or not it is kept
  const towers = [];
  for (let q = 0; q < 4; q++) {
    const hR = rng(), bR = rng(), ang = (q + 0.5) / 4 + (rng() - 0.5) * 0.04;
    for (const R of [118, 96]) {
      const u = unitAt(ang), x = V[0] + u[0] * R, z = V[1] + u[1] * R;
      if (S.h(x, z) < waterY + 2 || slopeAt(x, z) > 0.62) continue;
      const box = [x - 3.4, z - 3.4, x + 3.4, z + 3.4];
      let clash = false;
      for (const t of taken) if (rectsOverlap(box, t, 1.0)) { clash = true; break; }
      if (clash || hitsAvoid(avoid, box[0], box[1], box[2], box[3], 2)) continue;
      taken.push(box);
      towers.push({ x: r3(x), z: r3(z), w: 4.6, h: r2(6.5 + hR * 3), broken: bR < 0.6, face: Math.abs(u[0]) >= Math.abs(u[1]) ? (u[0] > 0 ? 3 : 1) : (u[1] > 0 ? 2 : 0) });   // (face: the quarter turn whose door looks back toward the axis)
      break;
    }
  }
  // (stage B) braziers along the four stair lines (both sides of the 7 m corridor, every 20 m from the plaza out): a stone pedestal with a fire bowl - the way up reads at a glance
  const braziers = [];
  for (const st of stairs) for (let r = 30; r <= 110; r += 20) for (const sd of [-1, 1]) {
    const x = V[0] + st.dx * r - st.dz * sd * 3.0, z = V[1] + st.dz * r + st.dx * sd * 3.0;
    if (S.h(x, z) < waterY + 2) continue;
    braziers.push([r3(x), r3(z)]);
  }
  // free pieces: a Poisson-disc scatter over the annulus 24 .. 140 m from the axis, 9 m apart (stage B; was 11), off every plot and arch (columns, rubble heaps, wall fragments)
  const kinds = ["column", "column", "rubble", "rubble", "fragment"];
  for (let tries = 0; tries < 800 && pieces.length < 140; tries++) {
    const ta = rng(), rr = 24 + rng() * 116, kd = rng(), yaw = rng(), sz = rng(), hh = rng();
    const u = unitAt(ta), x = V[0] + u[0] * rr, z = V[1] + u[1] * rr;
    if (S.h(x, z) < waterY + 2 || slopeAt(x, z) > 0.8) continue;
    const kind = kinds[Math.floor(kd * kinds.length)];
    const w = kind === "column" ? 0.9 : kind === "rubble" ? 2.2 + sz * 1.0 : 3.6 + sz * 2.4, d = kind === "column" ? 0.9 : kind === "rubble" ? 1.8 + sz * 0.8 : 0.6, h = kind === "column" ? 2.0 + hh * 1.8 : kind === "rubble" ? 1.3 + hh * 0.6 : 1.3 + hh * 1.0;
    const box = [x - w / 2 - 1, z - w / 2 - 1, x + w / 2 + 1, z + w / 2 + 1];
    let clash = false;
    for (const t of taken) if (rectsOverlap(box, t, 1.2)) { clash = true; break; }
    if (clash) continue;
    for (const q of pieces) if (dist2(q.x - x, q.z - z) < 9) { clash = true; break; }
    if (clash) continue;
    if (hitsAvoid(avoid, box[0], box[1], box[2], box[3], 2)) continue;
    pieces.push({ kind, x: r3(x), z: r3(z), w: r2(w), d: r2(d), h: r2(h), rot: r3(kind === "fragment" ? yaw * 3.14159265 : (kind === "rubble" && yaw >= 0.5 ? 1.5707963 : 0)) });
  }
  L.crater = { centre: [r3(V[0]), r3(V[1])], plots, walls, pieces, arches, stairs, plaza: pl, rings: CRATER_RINGS.map((q) => q.R), towers, braziers };
  L.compound = { yard: [r3(V[0] - 16), r3(V[1] - 16), r3(V[0] + 16), r3(V[1] + 16)], axis: 0, spec: { yw: 32, yd: 32 }, entry: { x: r3(V[0]), z: r3(V[1]) }, fence: [], cars: [], props: [], fields: [], bounds: [r3(V[0] - 150), r3(V[1] - 150), r3(V[0] + 150), r3(V[1] + 150)], variant: "crater" };
  L.ends = [];
  for (const [ux, uz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const x = V[0] + ux * 146, z = V[1] + uz * 146; if (S.h(x, z) >= waterY + 1.2) L.ends.push({ x: r3(x), z: r3(z), dx: ux, dz: uz }); }
  L.centre = [r3(V[0]), r3(V[1])];
  L.stage = { tries: 1, maxShift: 0, hard: false };
  L.stats = summarize(L);
  L.stats.craterPlots = plots.length; L.stats.craterWalls = walls.length; L.stats.craterPieces = pieces.length; L.stats.craterArches = arches.length;
  return L;
}

// ── the mill-and-bridge village (Deepwood, Riverside Mill: the endgame area of O4) ───────────────────────────────────────────────────────────────────────────────────
// The river runs through the middle of the last circles: a 16 m wide channel in a 90 m wide valley whose sides rise 0.3 per metre. The mill village follows it: the centreline is found
// from the ground (the lowest point of each vertical line, every 12 m, +-150 m of the POI); a footbridge crosses where the water is narrowest near the POI (a deck at DECK_UP over the
// sea level from bank to bank, two stone piers in the water, rails over the water); terrace plots of timber houses stand on both banks (rows 22 and 44 m from the centreline, facing the
// river, every ~38 m along it, retaining walls behind them), the mill itself (a hall) beside the bridge head; log piles, boulders and fallen logs between. Both bridge heads are
// ends (a link road reaches each bank): the mill is the one place the map's links cross the river.
export const BRIDGE_TOP = 1.8;
// Wave 7b stage B: the mill bridge is a ROAD bridge 8.5 m wide (two walkers abreast, a fight across it, cover behind the rails), was a 4.5 m footbridge; its timber deck, stone piers and abutments are
// drawn by maps.js buildMill. The water mill beside it (millhouse, overshot wheel, flume) is placed here as data (L.mill.wheel) and built there too.
export const BRIDGE_W = 8.5;
export const MILL_WHEEL_R = 3.6;
function millAttempt(seed, poi, S, waterY, theme, opts) {
  const L = specialRecord(seed, poi, theme, "mill");
  const rng = subRng(seed, poi.id, "mill");
  const rc = [];
  for (let x = poi.x - 150; x <= poi.x + 150 + 1e-9; x += 12) {
    let bz = 0, bh = Infinity;
    for (let z = poi.z - 140; z <= poi.z + 140; z += 3) { const h = S.h(x, z); if (h < bh) { bh = h; bz = z; } }
    rc.push([x, bz, bh]);
  }
  const wetN = rc.filter((p) => p[2] < waterY - 0.5).length;
  if (wetN < 20) { L.stats = summarize(L); L.stats.failed = "no_river"; L.centre = [r3(poi.x), r3(poi.z)]; return L; }
  // the bridge: the best crossing within 60 m of the POI, in either direction - a N-S deck (the line x = a crosses the river where it is lowest along z) or an E-W deck (z = a, along x). The
  // river runs ~31 degrees off the x axis, so an E-W line crosses it more obliquely and covers MORE deep water than a N-S one of the same channel: the span must cover >= 10 m of DEEP water
  // (the seabed more than the swim depth under the surface; below that it is a ford, and the endgame gate reads a bridge as >= 8 m of deep water). Score = the wet width + 0.08 per metre from the
  // POI, + a heavy penalty for every metre of deep water short of 10. (Stage B let that penalty pick the E-W deck where the N-S deep part was 8-9 m: see below - stage C keeps the deck square to
  // the river and maps.js planBridge dredges the channel under it to a flat bed 2.4 m deep, so a bridge always spans >= 9 m of swim-deep water.)
  const hAt = (o, a2, t) => (o === 0 ? S.h(a2, t) : S.h(t, a2));
  // (Wave 7b stage C) the deck is QUARTER-TURNED (its colliders stay boxes), so it is laid on the quarter turn closest to square across the river's LOCAL direction: an E-W deck over this
  // ~30-degree river crossed it 60 degrees off square (seeds 9, 15, 27, 57, 31337 - 15 of 200): at each end one half of the 8.5 m deck stood 1.8 m over river-level ground and the other half was
  // buried 2.8 m in the bank, and from the air it lay skewed across the water with its corners cut off by the banks. The local direction is a least-squares line through the centreline points
  // (rc) within 30 m of the crossing: slope m = dz/dx, so a N-S deck is |m| <= 1 off square (at most 45 degrees) and an E-W one |m| >= 1. Pure arithmetic (no atan: its last bit differs between
  // engines, and squad clients rebuild this). Among the crossings of that axis the score also prefers a square crossing (sin^2 of the skew) and a straight reach (the tangent of the bend between
  // the 36 m upstream and downstream); the other axis is only the fallback when its own axis has no crossing at all.
  const slopeFit = (lo, hi) => {
    let n = 0, sx = 0, sz = 0, sxx = 0, sxz = 0;
    for (const p of rc) if (p[2] < waterY - 0.5 && p[0] >= lo - 1e-9 && p[0] <= hi + 1e-9) { n++; sx += p[0]; sz += p[1]; sxx += p[0] * p[0]; sxz += p[0] * p[1]; }
    const d = n * sxx - sx * sx;
    return n >= 2 && d > 1e-9 ? (n * sxz - sx * sz) / d : null;
  };
  const reach = (xc) => {
    const m = slopeFit(xc - 30, xc + 30), m0 = slopeFit(xc - 36, xc), m1 = slopeFit(xc, xc + 36);
    if (m === null) return null;
    const den = m0 === null || m1 === null ? 1 : 1 + m0 * m1;
    return { m, bend: m0 === null || m1 === null ? 0 : den > 0.05 ? Math.abs(m1 - m0) / den : 20 };
  };
  const cands = [[], []];
  for (const o of [0, 1]) {
    const a0 = o === 0 ? poi.x : poi.z, t0 = o === 0 ? poi.z : poi.x;
    for (let a2 = a0 - 60; a2 <= a0 + 60 + 1e-9; a2 += 4) {
      let bt = 0, bh = Infinity;
      for (let t = t0 - 140; t <= t0 + 140; t += 2) { const h = hAt(o, a2, t); if (h < bh) { bh = h; bt = t; } }
      if (bh > waterY - 0.5) continue;
      let tA = bt, tB = bt;
      while (hAt(o, a2, tA - 1) < waterY && bt - tA < 60) tA -= 1;
      while (hAt(o, a2, tB + 1) < waterY && tB - bt < 60) tB += 1;
      let deep = 0;
      for (let t = tA; t <= tB; t += 1) if (hAt(o, a2, t) < waterY - 1.15) deep++;
      const rq = reach(o === 0 ? a2 : bt), m2 = rq ? rq.m * rq.m : 0;
      const square = rq ? (o === 0 ? m2 <= 1 + 1e-9 : m2 >= 1 - 1e-9) : true;                // this axis is the quarter turn closest to square across the river here
      const skew2 = rq ? (o === 0 ? m2 / (1 + m2) : 1 / (1 + m2)) : 0;                      // sin^2 of the deck's angle off square
      const w = tB - tA, sc = w + 0.08 * Math.abs(a2 - a0) + (deep >= 10 ? 0 : (10 - deep) * 8) + 10 * skew2 + 20 * (rq ? rq.bend : 0);
      cands[o].push({ o, a: a2, tA, tB, w, sc, deep, square });
    }
  }
  let site = null;
  for (const pass of [true, false]) {
    for (const c of cands[0].concat(cands[1])) if (c.square === pass && (!site || c.sc < site.sc - 1e-9)) site = c;
    if (site) break;
  }
  if (!site) { L.stats = summarize(L); L.stats.failed = "no_crossing"; L.centre = [r3(poi.x), r3(poi.z)]; return L; }
  const top = r2(waterY + BRIDGE_TOP), ax = Math.round(site.a), O = site.o;
  const P2 = (a2, t) => (O === 0 ? [a2, t] : [t, a2]);                                   // (along-the-deck t, across a) -> world x, z
  let eA = 0, eB = 0;
  while (hAt(O, ax, site.tA - eA) < top - 0.12 && eA < 24) eA += 1;           // the deck runs out to where the bank meets it
  while (hAt(O, ax, site.tB + eB) < top - 0.12 && eB < 24) eB += 1;
  const dt0 = site.tA - eA - 0.5, dt1 = site.tB + eB + 0.5;
  const BH = BRIDGE_W / 2;
  const deck = O === 0 ? [r3(ax - BH), r3(dt0), r3(ax + BH), r3(dt1)] : [r3(dt0), r3(ax - BH), r3(dt1), r3(ax + BH)];
  const piers = [];
  const nP = Math.max(1, Math.round(site.w / 8));
  for (let i = 1; i <= nP; i++) { const t = site.tA + (site.w * i) / (nP + 1), q = P2(ax, t); piers.push({ x: r3(q[0]), z: r3(q[1]), w: O === 0 ? BRIDGE_W - 1.1 : 2.8, d: O === 0 ? 2.8 : BRIDGE_W - 1.1 }); }
  const railA = r3(site.tA - 3), railB = r3(site.tB + 3);
  // the river's centreline as a polyline and the plots along it (both banks, two rows)
  const pts = rc.filter((p) => p[2] < waterY - 0.5);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = (s) => {                                     // point and unit normal at arc length s
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = clamp((s - cum[i - 1]) / seg, 0, 1), tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, nx: -tz, nz: tx };
  };
  const taken = [O === 0 ? [deck[0] - 14, deck[1] - 6, deck[2] + 14, deck[3] + 6] : [deck[0] - 6, deck[1] - 14, deck[2] + 6, deck[3] + 14]];
  // (stage C) the two APPROACHES stay clear: the deck's width + 3 m each side, from the deck end 18 m up each bank (to past the link road's end node at 14 m). maps.js runs the deck's strips out
  // to where each lane meets the bank (up to ~3 m past this deck rect), and a log pile 7-9 m past the end stood square in the approach lanes (walk probe, seeds 22 and 103)
  for (const sg of [-1, 1]) { const e = sg < 0 ? dt0 : dt1, ta = Math.min(e, e + sg * 18), tb = Math.max(e, e + sg * 18); taken.push(O === 0 ? [ax - BH - 3, ta, ax + BH + 3, tb] : [ta, ax - BH - 3, tb, ax + BH + 3]); }
  const ctx = { S, seed, poi, theme, L, taken, plots: [], walls: [], avoid: opts.avoid || [], fw: 12.5, fd: 10.5, margin: 2.0 };
  // the water mill (Wave 7b stage B): a millhouse on the bank 14 m beside the bridge, an overshot wheel on its side wall over the water's edge and a flume from up the bank to the wheel's
  // top. The site is the first of four candidates (either side of the bridge, either bank) where the channel beside the bank is deep (0.6 m under the surface) and the bank rises 0.8 - 7 m
  // over the millhouse's 9 m (and its whole footprint at most 4 m over the water): in the (across u, along t) frame of the deck: the wheel at u, its axle along u into the millhouse (u + side 1.2 .. 10.2), the wheel's centre over the water's
  // edge te, the flume running up the bank along t to te + land 16. No random draw: the plots and the pieces below keep off its rectangle (taken), the link roads too (avoidRects).
  let wheel = null;
  // (stage C: when none of the four sites 14 m beside the bridge fits, the same four 20 and 26 m out - squared to the river, five more seeds had no water mill, 9 of 200; with the outer sites 3 of 200 - stage B 4)
  for (const off of [14, 20, 26]) for (const sd of [1, -1]) for (const land of [-1, 1]) {
    if (wheel) break;
    const u = ax + sd * (BH + off), tm = (site.tA + site.tB) / 2;
    let tLow = tm, hLow = Infinity;
    for (let t = tm - 40; t <= tm + 40 + 1e-9; t += 1) { const h = hAt(O, u, t); if (h < hLow) { hLow = h; tLow = t; } }
    if (!(hLow < waterY - 0.6)) continue;
    let te = tLow;
    while (hAt(O, u, te + land) < waterY + 0.2 && Math.abs(te - tLow) < 40) te += land;
    te += land;                                                                                    // the first metre of dry bank
    const rise = hAt(O, u, te + land * 9) - hAt(O, u, te);
    if (!(rise >= 0.8 && rise <= 7)) continue;
    let mLo = Infinity, mHi = -Infinity;                                                         // the millhouse's own footprint (u + side 1.2 .. 9.6, te - land 3 .. te + land 7): at most 4 m of relief (a taller stone base reads as a fortress)
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 5; j++) { const h = hAt(O, u + sd * (1.2 + 8.4 * i / 6), te + land * (-3 + 10 * j / 5)); if (h < mLo) mLo = h; if (h > mHi) mHi = h; }
    if (mHi - Math.max(mLo, waterY) > 4.0) continue;                                             // (measured from the water's surface: the base's footing in the river is under water)
    const ta = Math.min(te - land * 6, te + land * 17), tb = Math.max(te - land * 6, te + land * 17), ua = Math.min(u - sd * 2.5, u + sd * 10.5), ub = Math.max(u - sd * 2.5, u + sd * 10.5);
    const rect = O === 0 ? [ua, ta, ub, tb] : [ta, ua, tb, ub];
    if (hitsAvoid(ctx.avoid, rect[0], rect[1], rect[2], rect[3], 2)) continue;
    let clash = false;
    for (let k = 1; k < taken.length; k++) if (rectsOverlap(rect, taken[k], 1)) { clash = true; break; }
    if (clash) continue;
    wheel = { u: r3(u), te: r3(te), land, side: sd, r: MILL_WHEEL_R, rect: rect.map(r3) };
    taken.push(rect);
  }
  const mixAll = [["cabin", 36], ["house_m", 22], ["house_s", 22], ["shed", 10], ["shop", 4], ["hall", 6]];
  const slopeAt = (x, z) => { const a = S.h(x + 5, z) - S.h(x - 5, z), b = S.h(x, z + 5) - S.h(x, z - 5); return dist2(a, b) / 10; };
  const phase = rng() * 30;
  let millPlaced = false;
  // the mill first: a hall (the granary and the mill house in one) on the north bank 24 m from the bridge head
  {
    const bcx = (deck[0] + deck[2]) / 2, bcz = (deck[1] + deck[3]) / 2;
    const sMill = (() => { let best = 0, bd = 1e9; for (let s = 0; s <= total; s += 4) { const p = at(s), d = dist2(p.x - bcx, p.z - bcz); if (d < bd) { bd = d; best = s; } } return best; })();
    for (const [side, off] of [[-1, 24], [1, 24], [-1, 30], [1, 30]]) {
      const p = at(sMill + 24), cx = p.x + p.nx * side * off, cz = p.z + p.nz * side * off, f = [-p.nx * side, -p.nz * side];
      if (S.h(cx, cz) < waterY + 1.5 || slopeAt(cx, cz) > 0.62) continue;
      ctx.fw = 20; ctx.fd = 13.5;
      const r = placePlot(ctx, cx, cz, f, "hall", "mill", 2.0, 1, 0.5, { mill: true });
      ctx.fw = 12.5; ctx.fd = 10.5;
      if (r) { millPlaced = true; break; }
    }
  }
  for (const [side, off, ring] of [[-1, 22, 0], [1, 22, 0], [-1, 46, 1], [1, 46, 1]]) {
    ctx.ring = ring;
    for (let s = 14 + phase + ring * 17 + (side > 0 ? 19 : 0); s <= total - 14; s += 38) {
      const wallH = 1.6 + rng() * 0.8, gateU = rng(), gateT = rng(), jit = (rng() - 0.5) * 8, p = at(s), o = off + (rng() - 0.5) * 6;
      const cx = p.x + p.nx * side * o + p.nz * jit, cz = p.z + p.nz * side * o - p.nx * jit, f = [-p.nx * side, -p.nz * side];
      if (S.h(cx, cz) < waterY + 1.5 || slopeAt(cx, cz) > 0.55) continue;
      const key = wpick(subRng(seed, poi.id, "kind" + ctx.plots.length + "," + ring + "," + Math.round(s)), mixAll, (q) => q[1])[0];
      if (key === "hall") { ctx.fw = 17.5; ctx.fd = 12.5; }
      placePlot(ctx, cx, cz, f, key, ctx.plots.length + "," + ring + "," + Math.round(s), wallH, gateU, gateT, {});
      ctx.fw = 12.5; ctx.fd = 10.5;
    }
  }
  const plots = ctx.plots, walls = ctx.walls, pieces = [];
  // the free pieces: log piles, boulders and fallen logs on the valley sides (14 - 110 m from the centreline), 8 m apart, up to 180 (stage B: was 11 m and 90 pieces - the endgame circles over the river held
  // too little cover on 7.5 % of seeds), off every plot and the bridge. (A fallen log is a 0.9 m trunk now - maps.js draws it round - so it is not cover a player can stand behind: one log in
  // seven pieces, was one in five)
  const kinds = ["woodpile", "woodpile", "woodpile", "boulder", "boulder", "boulder", "log"];
  const distRiver = (x, z) => { let best = 1e9; for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1), d = dist2(x - (a[0] + dx * t), z - (a[1] + dz * t)); if (d < best) best = d; } return best; };
  for (let tries = 0; tries < 1300 && pieces.length < 180; tries++) {
    const s = rng() * total, p = at(s), side = rng() < 0.5 ? -1 : 1, o = 14 + rng() * 96, kd = rng(), yaw = rng(), sz = rng(), hh = rng();
    const x = p.x + p.nx * side * o, z = p.z + p.nz * side * o;
    if (S.h(x, z) < waterY + 1.0 || slopeAt(x, z) > 0.8 || distRiver(x, z) < 12) continue;
    const kind = kinds[Math.floor(kd * kinds.length)];
    const w = kind === "woodpile" ? 3.4 : kind === "boulder" ? 2.0 + sz * 1.0 : 4.6 + sz * 1.6, d = kind === "woodpile" ? 1.7 : kind === "boulder" ? 1.8 + sz * 0.8 : 0.9;
    const h = kind === "woodpile" ? 1.4 + hh * 0.4 : kind === "boulder" ? 1.3 + hh * 0.6 : 1.25 + hh * 0.2;
    const box = [x - w / 2 - 1, z - w / 2 - 1, x + w / 2 + 1, z + w / 2 + 1];
    let clash = false;
    for (const t of taken) if (rectsOverlap(box, t, 1.2)) { clash = true; break; }
    if (clash) continue;
    for (const q of pieces) if (dist2(q.x - x, q.z - z) < 8) { clash = true; break; }
    if (clash) continue;
    if (hitsAvoid(ctx.avoid, box[0], box[1], box[2], box[3], 2)) continue;
    pieces.push({ kind, x: r3(x), z: r3(z), w: r2(w), d: r2(d), h: r2(h), rot: r3(kind === "log" ? yaw * 3.14159265 : (yaw >= 0.5 ? 1.5707963 : 0)) });
  }
  L.mill = { top, deck, width: BRIDGE_W, piers, rails: [railA, railB], water: [r3(site.tA), r3(site.tB)], axis: O, a: ax, plots, walls, pieces, centreline: pts.filter((p, i) => i % 2 === 0).map((p) => [r3(p[0]), r3(p[1])]), millPlaced, deepWidth: site.deep, wheel };
  const bounds = finishSpecial(L, [deck, ...pieces.map((q) => [q.x - 3, q.z - 3, q.x + 3, q.z + 3])]);
  const mc = P2(ax, (site.tA + site.tB) / 2), e0 = P2(ax, dt0 - 14), e1 = P2(ax, dt1 + 14);
  L.compound = { yard: deck, axis: O === 0 ? 1 : 0, spec: { yw: dt1 - dt0, yd: 4.5 }, entry: { x: r3(mc[0]), z: r3(mc[1]) }, fence: [], cars: [], props: [], fields: [], bounds, variant: "mill" };
  L.ends = [{ x: r3(e0[0]), z: r3(e0[1]), dx: O === 0 ? 0 : -1, dz: O === 0 ? -1 : 0 }, { x: r3(e1[0]), z: r3(e1[1]), dx: O === 0 ? 0 : 1, dz: O === 0 ? 1 : 0 }];
  L.avoidRects = plots.map((p) => [p.rect[0] - 2, p.rect[1] - 2, p.rect[2] + 2, p.rect[3] + 2]).concat([O === 0 ? [deck[0] - 3, deck[1] + 6, deck[2] + 3, deck[3] - 6] : [deck[0] + 6, deck[1] - 3, deck[2] - 6, deck[3] + 3]]).concat(wheel ? [wheel.rect.slice()] : []);     // what a link road keeps off (not the whole 300 m of valley the mill's bounds span)
  L.centre = [r3(mc[0]), r3(mc[1])];
  { const q0 = P2(ax, site.tA), q1 = P2(ax, site.tB); L.bridges = [{ x0: r3(q0[0]), z0: r3(q0[1]), x1: r3(q1[0]), z1: r3(q1[1]), len: r3(site.w), width: BRIDGE_W, deck: top }]; }
  L.stage = { tries: 1, maxShift: 50, hard: false };
  L.stats = summarize(L);
  L.stats.millPlots = plots.length; L.stats.millWalls = walls.length; L.stats.millPieces = pieces.length; L.stats.bridgeLen = r2(dt1 - dt0); L.stats.bridgeAxis = O; L.stats.deepWidth = site.deep; L.stats.millWheel = wheel ? 1 : 0;
  return L;
}

// ── layout() ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** C-LAYOUT: one POI as data. `theme` selects palette keys and parcel mix ('city' Savanna, 'resort' Isla Viva, 'lodge' Deepwood; compound themes
 *  'farm' / 'ruin' / 'mill'). opts: kind ('core'|'town'|'village'|'yard' grid; 'compound'|'farm'|'lane' cluster), cols, rows, minBlocks, maxShift, axis, fixed. */
export function layout(seed, poi, heightFn, waterY, theme, opts) {
  opts = opts || {};
  if (!THEMES[theme]) theme = "city";
  const clusterTheme = theme === "farm" || theme === "ruin" || theme === "mill";
  const kind = opts.kind || (clusterTheme ? "lane" : "town");
  const S = asSampler(heightFn);
  const p = { id: poi.id, x: poi.x, z: poi.z, r: poi.r || 90 };
  if (kind === "docks") return docksAttempt(seed, p, S, waterY, theme, opts);                       // (Wave 7b: the special layouts)
  if (kind === "crater") return craterAttempt(seed, p, S, waterY, theme, opts);
  if (kind === "mill") return millAttempt(seed, p, S, waterY, theme, opts);
  return GRID_KINDS.has(kind) ? stagedGrid(seed, p, S, waterY, theme, kind, opts) : clusterStaged(seed, p, S, waterY, theme, kind, opts);
}

// ── compounds: farthest-point fill ────────────────────────────────────────────────────────────────────────────────────────────────────
const rectDist = (x, z, r) => { const dx = Math.max(r[0] - x, 0, x - r[2]), dz = Math.max(r[1] - z, 0, z - r[3]); return Math.sqrt(dx * dx + dz * dz); };
/** footprints a compound must keep 60 m from: the ring squares of every town block, the bounds of every cluster */
function townFootprints(towns) {
  const out = [];
  for (const T of towns) {
    for (const b of T.blocks) out.push([b.cx - HP, b.cz - HP, b.cx + HP, b.cz + HP]);
    if (T.compound && T.parcels.length) out.push(T.compound.bounds);
  }
  return out;
}
export function enterableBoxes(layouts) {
  const out = [];
  for (const T of layouts) for (const p of T.parcels) if (p.building && p.building.enterable) out.push(p.building.aabb);
  return out;
}
/** The compound list: a deterministic farthest-point fill on a fixed COMPOUND_GRID m grid over dry land inside +-720 m of the map centre,
 *  >= 60 m from every town. Each site is a small yard layout (2-4 enterable houses + a shed + fence + cars) from layout(kind 'compound').
 *  Distance for the fill = to the nearest ENTERABLE building (towns + earlier compounds), so every pick shrinks the biggest remaining gap. */
export function placeCompounds(seed, mapId, towns, heightFn, waterY, opts) {
  opts = opts || {};
  const S = asSampler(heightFn);
  const plan = (PLANS[mapId] && PLANS[mapId].compounds) || {};
  const count = opts.count != null ? opts.count : plan.count != null ? plan.count : 12;
  const themes = opts.themes || plan.themes || ["farm", "ruin"], weights = opts.weights || plan.weights || [3, 2];
  const minGap = opts.minGap != null ? opts.minGap : 70;
  const REACH = opts.reach != null ? opts.reach : COMPOUND_REACH;
  const G = COMPOUND_GRID, n = Math.floor(2 * REACH / G) + 1, N = n * n;
  const foot = townFootprints(towns).concat(opts.reserve || []), boxes = enterableBoxes(towns);
  const gx = new Float64Array(N), gz = new Float64Array(N), dbox = new Float64Array(N).fill(1e9), dtown = new Float64Array(N).fill(1e9), ok = new Uint8Array(N);
  const wetMin = waterY + GEN_WET + 0.4;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; gx[k] = -REACH + i * G; gz[k] = -REACH + j * G; }
  // distances are only needed up to a cap: update the grid window around each footprint (box-major) instead of every point x every box
  const CAP = 200;
  const windowed = (list, out, cap) => {
    for (const b of list) {
      const i0 = Math.max(0, Math.ceil((b[0] - cap + REACH) / G)), i1 = Math.min(n - 1, Math.floor((b[2] + cap + REACH) / G));
      const j0 = Math.max(0, Math.ceil((b[1] - cap + REACH) / G)), j1 = Math.min(n - 1, Math.floor((b[3] + cap + REACH) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * n + i, x = gx[k], z = gz[k];
        const dx = Math.max(b[0] - x, 0, x - b[2]), dz = Math.max(b[1] - z, 0, z - b[3]), d = dx * dx + dz * dz;
        if (d < out[k]) out[k] = d;
      }
    }
  };
  windowed(boxes, dbox, CAP);
  windowed(foot, dtown, COMPOUND_MIN_TOWN + 5);
  // dryness: every 2nd grid node (40 m) is read; a node whose four surrounding 40 m nodes are all dry is taken as dry (the chosen site is re-checked over its
  // whole footprint below), the rest - the shoreline - is read itself
  const dryAt = (i, j) => S.n((-REACH + i * G) / LAT, (-REACH + j * G) / LAT) >= wetMin;
  const dry40 = waterY < -100 ? null : new Uint8Array(n * n);
  if (dry40) for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) dry40[j * n + i] = dryAt(i, j) ? 1 : 0;
  const dryOf = (k) => {
    if (!dry40) return 1;
    const i = k % n, j = (k - i) / n, i0 = i & ~1, j0 = j & ~1, i1 = Math.min(n - 1, i0 + 2) & ~1, j1 = Math.min(n - 1, j0 + 2) & ~1;
    return dry40[j0 * n + i0] && dry40[j0 * n + i1] && dry40[j1 * n + i0] && dry40[j1 * n + i1] ? 1 : (dryAt(i, j) ? 1 : 0);
  };
  for (let k = 0; k < N; k++) {
    dbox[k] = Math.sqrt(dbox[k]);
    ok[k] = Math.sqrt(dtown[k]) < COMPOUND_MIN_TOWN ? 0 : dryOf(k);
  }
  const trng = subRng(seed, mapId + ":compounds", "theme");
  const sites = [];
  let examined = 0, rejected = 0;
  const bad = new Uint8Array(N);
  // `inner` (default 0) favours the interior: a candidate's score is its distance x (1 + inner x (1 - how far out it is, 0 at the centre .. 1 at +-REACH)); `jitter`
  // (default 0) picks the site at random (own stream) among the candidates scoring within that share of the best, so the fill is not a lattice. With both 0 this is
  // the Wave-6 farthest-point fill, byte for byte (isla_viva and deepwood keep it: their coverage rows were tuned on it).
  const inner = plan.inner || 0, jitter = plan.jitter || 0, jrng = jitter ? subRng(seed, mapId + ":compounds", "pick") : null;
  const score = inner ? (k) => dbox[k] * (1 + inner * (1 - Math.max(Math.abs(gx[k]), Math.abs(gz[k])) / REACH)) : (k) => dbox[k];
  // (Wave 7b: a map with water whose dry land is small or steep may end a seed with fewer than COMPOUND_FLOOR homesteads: a second pass over the rejected candidates takes ground up to
  //  10.5 m of relief (the pad levels it) and a gap of 56 m, until the floor is met. Savanna has no water and never enters it; a seed that reached the floor in the first pass is unchanged)
  const COMPOUND_FLOOR = 6;
  let relMax = 6.5, mg = minGap;
  for (let pass = 0; pass < 3; pass++) {
  if (pass >= 1) {
    if (!(waterY > -100 && sites.length < COMPOUND_FLOOR)) break;
    // (stage B: a third pass, 14 m of relief, a 46 m gap, 30 m from a town - Isla Viva seed 118 ended the second pass with 5 homesteads; a seed the second pass satisfied is unchanged)
    bad.fill(0); relMax = pass === 1 ? 10.5 : 14; mg = pass === 1 ? 56 : 46; examined = 0;
    const near = pass === 1 ? 40 : 30;
    for (let k = 0; k < N; k++) if (!ok[k] && Math.sqrt(dtown[k]) >= near) ok[k] = dryOf(k);          // (and 40 / 30 m, not 60, from a town)
  }
  while (sites.length < (pass ? COMPOUND_FLOOR : count) && examined < count * 6 + 60) {
    let bk = -1, bd = 0, bs = 0;
    for (let k = 0; k < N; k++) if (ok[k] && !bad[k]) { const sc = score(k); if (sc > bs) { bs = sc; bd = dbox[k]; bk = k; } }
    if (bk >= 0 && jitter) {
      const pool = [];
      for (let k = 0; k < N; k++) if (ok[k] && !bad[k] && dbox[k] >= mg && score(k) >= bs * (1 - jitter)) pool.push(k);
      if (pool.length) { bk = pool[Math.floor(jrng() * pool.length)]; bd = dbox[bk]; }
    }
    if (bk < 0 || bd < mg) break;
    examined++;
    const x = gx[bk], z = gz[bk];
    const reg = scan(S, x - 26, x + 26, z - 26, z + 26, 4);
    if (reg.lo < wetMin || reg.hi - reg.lo > relMax) { bad[bk] = 1; rejected++; continue; }
    const idx = sites.length;
    const theme = themes[(() => { const t = wpick(trng, themes.map((q, i) => i), (i) => weights[i] != null ? weights[i] : 1); return t; })()];
    const L = layout(seed, { id: "cmp" + (idx < 10 ? "0" : "") + idx, x, z, r: 30 }, S, waterY, theme, { kind: "compound", fixed: true, variety: !!plan.variety });
    if (L.stats.enterable < 3) { bad[bk] = 1; rejected++; continue; }
    sites.push(L);
    const nb = enterableBoxes([L]);
    for (const b of nb) {
      const i0 = Math.max(0, Math.ceil((b[0] - CAP + REACH) / G)), i1 = Math.min(n - 1, Math.floor((b[2] + CAP + REACH) / G));
      const j0 = Math.max(0, Math.ceil((b[1] - CAP + REACH) / G)), j1 = Math.min(n - 1, Math.floor((b[3] + CAP + REACH) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * n + i, q = rectDist(gx[k], gz[k], b); if (q < dbox[k]) dbox[k] = q; }
    }
  }
  }
  return { sites, stats: { examined, rejected, placed: sites.length } };
}

// ── links: POI to POI roads that leave a town by its nearest edge node (never diagonally through a block) ────────────────────────────
function segHitsRect(ax, az, bx, bz, r) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - r[0]], [dx, r[2] - ax], [-dz, az - r[1]], [dz, r[3] - az]]) {
    if (p === 0) { if (q < 0) return false; }
    else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  }
  return t1 - t0 > 1e-9;
}
function townEnds(T) {
  if (T.ends && T.ends.length) return T.ends.map((e) => ({ x: e.x, z: e.z, dx: e.dx || 0, dz: e.dz || 0 }));       // (Wave 7b: a docks village, a crater-rim village and a mill name their own ends)
  if (T.blocks.length && T.roads.portals.length) return T.roads.portals.map((p) => ({ x: T.roads.nodes[p.node].x, z: T.roads.nodes[p.node].z, dx: p.dx, dz: p.dz }));
  if (T.compound && T.parcels.length) return [{ x: T.compound.entry.x, z: T.compound.entry.z, dx: 0, dz: 0 }];
  return [];
}
function townCentre(T) {
  if (T.blocks.length) { let x = 0, z = 0; for (const b of T.blocks) { x += b.cx; z += b.cz; } return [x / T.blocks.length, z / T.blocks.length]; }
  if (T.compound && T.parcels.length) return [T.compound.entry.x, T.compound.entry.z];
  return [T.poi.x, T.poi.z];
}
// ── link routing (Wave 7b): a link road on a map with water goes round the sea, the lakes and the steep ground instead of straight through them ────────────────────────
// A* on a 12 m grid of the base ground (nodes on even metres, so the sampler's cache is shared), eight neighbours, cost = length x (1 + 60 x slope^2) with a hard cap of
// 0.22 (12.4 degrees), a node needs dry ground (waterY + 1.0, and +0.6 five metres to each side: the road is 10 m wide), the blocks and yards of every town are walls (8 m grown)
// except within 34 m of the two ends. The result is simplified (Douglas-Peucker, 6 m, a chord must stay dry) into a polyline: l.path. Only plain arithmetic, a fixed neighbour
// order and index tie-breaks, so it is the same on every client. Savanna (no water) never calls it: its links stay the straight segments they were.
const ROUTE_G = 12, ROUTE_HALF = 768;
function routeLink(S, waterY, a, b, avoid) {
  const G = ROUTE_G, margin = 170;
  const x0 = Math.max(-ROUTE_HALF, Math.floor((Math.min(a.x, b.x) - margin) / G) * G), x1 = Math.min(ROUTE_HALF, Math.ceil((Math.max(a.x, b.x) + margin) / G) * G);
  const z0 = Math.max(-ROUTE_HALF, Math.floor((Math.min(a.z, b.z) - margin) / G) * G), z1 = Math.min(ROUTE_HALF, Math.ceil((Math.max(a.z, b.z) + margin) / G) * G);
  const nx = Math.round((x1 - x0) / G) + 1, nz = Math.round((z1 - z0) / G) + 1, N = nx * nz;
  const hs = new Float64Array(N), ok = new Uint8Array(N);
  const dry = waterY + 1.0, dryEdge = waterY + 0.6;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * G, z = z0 + j * G, h = S.h(x, z), k = j * nx + i;
    hs[k] = h - h === 0 ? h : -50;
    ok[k] = hs[k] >= dry && S.h(x + 5, z) >= dryEdge && S.h(x - 5, z) >= dryEdge && S.h(x, z + 5) >= dryEdge && S.h(x, z - 5) >= dryEdge ? 1 : 0;
  }
  const nearEnd = (x, z) => (dist2(x - a.x, z - a.z) < 34 || dist2(x - b.x, z - b.z) < 34);
  for (const r of avoid) {
    const i0 = Math.max(0, Math.ceil((r[0] - 8 - x0) / G)), i1 = Math.min(nx - 1, Math.floor((r[2] + 8 - x0) / G)), j0 = Math.max(0, Math.ceil((r[1] - 8 - z0) / G)), j1 = Math.min(nz - 1, Math.floor((r[3] + 8 - z0) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!nearEnd(x0 + i * G, z0 + j * G)) ok[j * nx + i] = 0;
  }
  const snap = (p) => {
    const ci = clamp(Math.round((p.x - x0) / G), 0, nx - 1), cj = clamp(Math.round((p.z - z0) / G), 0, nz - 1);
    let best = -1, bd = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const k = j * nx + i;
      if (!ok[k]) continue;
      const d = dist2(x0 + i * G - p.x, z0 + j * G - p.z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  const s = snap(a), t = snap(b);
  if (s < 0 || t < 0) return null;
  const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const tx = x0 + (t % nx) * G, tz = z0 + Math.floor(t / nx) * G;
  const heap = [];                                      // [f, k] pairs, ordered by (f, k)
  const less = (p, q) => p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
  const push = (it) => { heap.push(it); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (less(heap[c], heap[p])) { const tmp = heap[c]; heap[c] = heap[p]; heap[p] = tmp; c = p; } else break; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { let m = c; const l = 2 * c + 1, r = l + 1; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === c) break; const tmp = heap[c]; heap[c] = heap[m]; heap[m] = tmp; c = m; } } return top; };
  g[s] = 0;
  push([dist2(x0 + (s % nx) * G - tx, z0 + Math.floor(s / nx) * G - tz), s]);
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = false;
  while (heap.length) {
    const k = pop()[1];
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === t) { found = true; break; }
    const ci = k % nx, cj = (k - ci) / nx;
    for (let d = 0; d < 8; d++) {
      const i = ci + DI[d], j = cj + DJ[d];
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const q = j * nx + i;
      if (!ok[q] || closed[q]) continue;
      const len = d < 4 ? G : G * 1.4142135623730951, sl = Math.abs(hs[q] - hs[k]) / len;
      if (sl > 0.22) continue;
      const mx = x0 + (ci + i) * G / 2, mz = z0 + (cj + j) * G / 2;
      if (S.h(mx, mz) < dryEdge + 0.2) continue;
      const shore = hs[q] < waterY + 2.5 ? 1.15 : 1;
      const ng = g[k] + len * (1 + 60 * sl * sl) * shore;
      if (ng < g[q] - 1e-9) { g[q] = ng; from[q] = k; push([ng + dist2(x0 + i * G - tx, z0 + j * G - tz), q]); }
    }
  }
  if (!found) return null;
  const nodes = [];
  for (let k = t; k >= 0; k = from[k]) { nodes.push([x0 + (k % nx) * G, z0 + Math.floor(k / nx) * G]); if (k === s) break; }
  nodes.reverse();
  // (Wave 7b stage B) the grid node a link starts / ends on is the nearest DRY node to its end, which can lie beyond the node before it: the road ran past the bridge head and doubled back,
  // two ribbons over each other on the valley side (Riverside Mill, seed 1: ... (48,108) (60,108) -> the end (48,96)). Drop an end node while the one inside it is nearer the end and the straight
  // line from it to the end stays dry. Deterministic (no draw); only the water maps route links.
  const chordDry = (p, q) => { const n = Math.max(1, Math.ceil(dist2(q[0] - p[0], q[1] - p[1]) / 4)); for (let k = 0; k <= n; k++) if (S.h(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n) < waterY + 0.7) return false; return true; };
  while (nodes.length >= 2 && dist2(nodes[nodes.length - 2][0] - b.x, nodes[nodes.length - 2][1] - b.z) < dist2(nodes[nodes.length - 1][0] - b.x, nodes[nodes.length - 1][1] - b.z) && chordDry(nodes[nodes.length - 2], [b.x, b.z])) nodes.pop();
  while (nodes.length >= 2 && dist2(nodes[1][0] - a.x, nodes[1][1] - a.z) < dist2(nodes[0][0] - a.x, nodes[0][1] - a.z) && chordDry(nodes[1], [a.x, a.z])) nodes.shift();
  let pts = [[a.x, a.z]].concat(nodes.filter((p, i) => !((i === 0 && dist2(p[0] - a.x, p[1] - a.z) < 7) || (i === nodes.length - 1 && dist2(p[0] - b.x, p[1] - b.z) < 7)))).concat([[b.x, b.z]]);
  const chordOk = (p, q) => { const n = Math.max(1, Math.ceil(dist2(q[0] - p[0], q[1] - p[1]) / 4)); for (let k = 0; k <= n; k++) if (S.h(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n) < waterY + 0.7) return false; return true; };
  const simplify = (lo, hi, out) => {
    // Douglas-Peucker on pts[lo..hi]: keep the farthest point when it is more than 6 m off the chord or the chord is not dry
    const p = pts[lo], q = pts[hi], dx = q[0] - p[0], dz = q[1] - p[1], L2 = dx * dx + dz * dz;
    let far = -1, fd = 0;
    for (let k = lo + 1; k < hi; k++) {
      const t2 = L2 > 0 ? clamp(((pts[k][0] - p[0]) * dx + (pts[k][1] - p[1]) * dz) / L2, 0, 1) : 0;
      const d = dist2(pts[k][0] - (p[0] + dx * t2), pts[k][1] - (p[1] + dz * t2));
      if (d > fd) { fd = d; far = k; }
    }
    if (hi - lo > 1 && (fd > 6 || !chordOk(p, q))) { const m = far >= 0 && fd > 0.001 ? far : (lo + hi) >> 1; simplify(lo, m, out); simplify(m, hi, out); }
    else out.push(hi);
  };
  const out = [0];
  simplify(0, pts.length - 1, out);
  pts = out.map((k) => pts[k]);
  pts = smoothRoute(pts, S, waterY, avoid, a, b);          // (P23 / LC-47: string-pull the grid's 45-degree zig-zags, then round every corner)
  let len = 0;
  for (let k = 0; k + 1 < pts.length; k++) len += dist2(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
  return { path: pts.map((p) => [r3(p[0]), r3(p[1])]), len: r3(len) };
}

// ── road smoothing (parity P2-I, LC-47) ───────────────────────────────────────────────────────────────────────────────────────────────
// The audit: an A* route on a 12 m eight-neighbour grid, Douglas-Peucker'd at 6 m, keeps the grid's 45-degree steps and its doubling-back ends - Isla Viva and Deepwood links
// turned up to 163 degrees at a vertex and 15-36 vertices a map turned more than 30 (a road no one would build). smoothRoute:
//   1. string-pull: from each kept point, the FARTHEST later point the straight chord reaches while it stays a buildable road (routeOk: dry centre and edges, off every grown
//      town rect except near the two ends, a 12 m grade <= ROUTE_GRADE) - the grid's zig-zags become one straight run
//   2. fillet: every remaining corner becomes a circular arc of radius ROUTE_R (the tangent length capped at 45 % of either neighbour segment), drawn as chords of
//      <= ROUTE_ARC_DEG and >= ROUTE_SEG m (maps.js drops a road piece under 8 m); an arc whose chords are not a buildable road is tried at half and a quarter of its tangent,
//      and keeps its corner when none fits
// Plain arithmetic, fixed order: the same on every client. Only the water maps route links (Savanna's straight links never come here).
const ROUTE_R = 42, ROUTE_ARC_DEG = 16, ROUTE_SEG = 9, ROUTE_GRADE = 0.22;
function routeOk(S, waterY, avoid, a, b, p, q) {
  const dx = q[0] - p[0], dz = q[1] - p[1], L = dist2(dx, dz);
  if (L < 1e-6) return true;
  const n = Math.max(1, Math.ceil(L / 4)), ux = dx / L, uz = dz / L, dry = waterY + 1.0, dryEdge = waterY + 0.6;
  let hPrev = null, sPrev = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = p[0] + dx * t, z = p[1] + dz * t, h = S.h(x, z);
    if (!(h >= dry) || S.h(x - uz * 5, z + ux * 5) < dryEdge || S.h(x + uz * 5, z - ux * 5) < dryEdge) return false;
    const s = L * t;
    if (hPrev === null) { hPrev = h; sPrev = s; } else if (s - sPrev >= 12 - 1e-9 || k === n) { if (s - sPrev > 1e-6 && Math.abs(h - hPrev) / Math.max(12, s - sPrev) > ROUTE_GRADE) return false; hPrev = h; sPrev = s; }
    if (dist2(x - a.x, z - a.z) < 34 || dist2(x - b.x, z - b.z) < 34) continue;
    for (const r of avoid) if (x > r[0] - 8 && x < r[2] + 8 && z > r[1] - 8 && z < r[3] + 8) return false;
  }
  return true;
}
function smoothRoute(pts, S, waterY, avoid, a, b) {
  if (pts.length < 3) return pts;
  const ok = (p, q) => routeOk(S, waterY, avoid, a, b, p, q);
  // 1. string-pull (farthest reachable first; a pair that is already a DP chord is always kept, so the walk always advances)
  const pulled = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let j = i + 1;
    for (let k = pts.length - 1; k > i + 1; k--) if (ok(pts[i], pts[k])) { j = k; break; }
    pulled.push(pts[j]); i = j;
  }
  if (pulled.length < 3) return pulled;
  // 2. fillets
  const outP = [pulled[0]];
  for (let k = 1; k < pulled.length - 1; k++) {
    const P = outP[outP.length - 1], V = pulled[k], Q = pulled[k + 1];
    const l1 = dist2(V[0] - P[0], V[1] - P[1]), l2 = dist2(Q[0] - V[0], Q[1] - V[1]);
    if (l1 < 1e-6 || l2 < 1e-6) { outP.push(V); continue; }
    const u1x = (V[0] - P[0]) / l1, u1z = (V[1] - P[1]) / l1, u2x = (Q[0] - V[0]) / l2, u2z = (Q[1] - V[1]) / l2;
    const th = Math.acos(clamp(u1x * u2x + u1z * u2z, -1, 1));
    if (th < 0.12) { outP.push(V); continue; }                  // (< 7 degrees: a straight road)
    const tMax = Math.min(ROUTE_R * Math.tan(th / 2), 0.45 * l1, 0.45 * l2);
    let arc = null;
    for (const f of [1, 0.5, 0.25]) {
      const t = tMax * f;
      if (t < 2) break;
      const R = t / Math.tan(th / 2);
      const A = [V[0] - u1x * t, V[1] - u1z * t], B = [V[0] + u2x * t, V[1] + u2z * t];
      const cr = u1x * u2z - u1z * u2x, sg = cr > 0 ? 1 : -1;           // turn side
      const nx = -u1z * sg, nz = u1x * sg;                             // towards the centre
      const C = [A[0] + nx * R, A[1] + nz * R];
      const arcLen = R * th;
      let m = Math.max(1, Math.ceil(th * 180 / Math.PI / ROUTE_ARC_DEG));
      while (m > 1 && arcLen / m < ROUTE_SEG) m--;
      const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
      const ptsA = [A];
      for (let s = 1; s < m; s++) { const ang = a0 + sg * th * s / m; ptsA.push([C[0] + Math.cos(ang) * R, C[1] + Math.sin(ang) * R]); }
      ptsA.push(B);
      let good = ok(P, A);
      for (let s = 0; good && s + 1 < ptsA.length; s++) good = ok(ptsA[s], ptsA[s + 1]);
      if (good) { arc = ptsA; break; }
    }
    if (arc) for (const q of arc) outP.push(q); else outP.push(V);
  }
  outP.push(pulled[pulled.length - 1]);
  // drop a sliver (< 1 m) a fillet can leave against its neighbour's
  const res = [outP[0]];
  for (let k = 1; k < outP.length; k++) { const p = res[res.length - 1], q = outP[k]; if (k < outP.length - 1 && dist2(q[0] - p[0], q[1] - p[1]) < 1) continue; res.push(q); }
  return res;
}

function buildLinks(towns, S, waterY) {
  const links = [];
  const cen = towns.map(townCentre), ends = towns.map(townEnds);
  const rects = towns.map((T) => T.blocks.map((b) => [b.x0, b.z0, b.x1, b.z1]));
  for (let i = 1; i < towns.length; i++) {
    let j = -1, bd = Infinity;
    for (let q = 0; q < i; q++) { if (!ends[q].length) continue; const d = dist2(cen[i][0] - cen[q][0], cen[i][1] - cen[q][1]); if (d < bd) { bd = d; j = q; } }
    if (j < 0 || !ends[i].length) continue;
    let best = null;
    const near = (list, tx, tz) => list.slice().sort((p, q) => dist2(p.x - tx, p.z - tz) - dist2(q.x - tx, q.z - tz) || p.x - q.x || p.z - q.z).slice(0, 6);
    for (const a of near(ends[i], cen[j][0], cen[j][1])) for (const b of near(ends[j], cen[i][0], cen[i][1])) {
      const len = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
      let hit = 0;
      for (const set of [rects[i], rects[j]]) for (const r of set) if (segHitsRect(a.x, a.z, b.x, b.z, r)) hit++;
      // leaving a town outward: the link must head away from the town it leaves
      const away = (a.dx || a.dz) ? ((b.x - a.x) * a.dx + (b.z - a.z) * a.dz) / Math.max(1e-9, len) : 1;
      const awayB = (b.dx || b.dz) ? ((a.x - b.x) * b.dx + (a.z - b.z) * b.dz) / Math.max(1e-9, len) : 1;
      const cost = hit * 100000 + (away < 0 ? 5000 : 0) + (awayB < 0 ? 5000 : 0) + len;
      if (!best || cost < best.cost) best = { a, b, len, hit, cost };
    }
    let wet = 0;
    const m = Math.max(1, Math.ceil(best.len / 4));
    for (let k = 0; k <= m; k++) if (S.h(best.a.x + (best.b.x - best.a.x) * k / m, best.a.z + (best.b.z - best.a.z) * k / m) < waterY + 0.3) wet++;
    links.push({ a: towns[i].id, b: towns[j].id, ax: r3(best.a.x), az: r3(best.a.z), bx: r3(best.b.x), bz: r3(best.b.z), len: r3(best.len), blocked: best.hit, wetVerts: wet });
  }
  return links;
}

/** Wave 7b, maps with water: a minimum spanning set of links over the towns that dry land can join. The dry land of the map is labelled in 24 m cells (4-neighbour flood), a town's
 *  ends (portals, yard entries, a village's gates, the mill's two banks) take the label of the land they stand on, and a pair of towns is a candidate only through ends of
 *  ONE label - so a river or a bay is never crossed, and the one place that crosses the Deepwood river is the mill's bridge (a mill has an end on each bank and so joins the two
 *  halves of the map). Candidates are taken shortest first (Kruskal); each is routed (routeLink) and kept when it routes. */
function buildLinksWater(towns, S, waterY) {
  const links = [];
  const cen = towns.map(townCentre), ends = towns.map(townEnds), n = towns.length;
  const G = 24, M = 64, off = 768;
  const land = new Uint8Array(M * M), lab = new Int32Array(M * M).fill(-1);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) land[j * M + i] = S.h(-off + (i + 0.5) * G, -off + (j + 0.5) * G) >= waterY + 0.8 ? 1 : 0;
  let nl = 0;
  for (let k0 = 0; k0 < M * M; k0++) {
    if (!land[k0] || lab[k0] >= 0) continue;
    const st = [k0]; lab[k0] = nl;
    while (st.length) {
      const k = st.pop(), i = k % M, j = (k - i) / M;
      for (let d = 0; d < 4; d++) { const a = i + (d === 0 ? 1 : d === 1 ? -1 : 0), b = j + (d === 2 ? 1 : d === 3 ? -1 : 0); if (a < 0 || b < 0 || a >= M || b >= M) continue; const q = b * M + a; if (land[q] && lab[q] < 0) { lab[q] = nl; st.push(q); } }
    }
    nl++;
  }
  const compAt = (x, z) => {
    const ci = clamp(Math.floor((x + off) / G), 0, M - 1), cj = clamp(Math.floor((z + off) / G), 0, M - 1);
    for (let r = 0; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= M || j >= M) continue; if (lab[j * M + i] >= 0) return lab[j * M + i]; }
    return -1;
  };
  const avoid = [];
  for (const T of towns) { for (const b of T.blocks) avoid.push([b.x0, b.z0, b.x1, b.z1]); if (T.avoidRects) for (const r of T.avoidRects) avoid.push(r); else if (T.compound && T.parcels.length) avoid.push(T.compound.bounds); }
  const rects = towns.map((T) => T.blocks.map((b) => [b.x0, b.z0, b.x1, b.z1]));
  const cand = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (!ends[i].length || !ends[j].length) continue;
    let best = null;
    for (const a of ends[i]) for (const b of ends[j]) {
      const ca = compAt(a.x, a.z);
      if (ca < 0 || ca !== compAt(b.x, b.z)) continue;
      const len = dist2(a.x - b.x, a.z - b.z);
      let hit = 0;
      for (const set of [rects[i], rects[j]]) for (const r of set) if (segHitsRect(a.x, a.z, b.x, b.z, r)) hit++;
      const away = (a.dx || a.dz) ? ((b.x - a.x) * a.dx + (b.z - a.z) * a.dz) / Math.max(1e-9, len) : 1;
      const awayB = (b.dx || b.dz) ? ((a.x - b.x) * b.dx + (a.z - b.z) * b.dz) / Math.max(1e-9, len) : 1;
      const cost = hit * 100000 + (away < 0 ? 5000 : 0) + (awayB < 0 ? 5000 : 0) + len;
      if (!best || cost < best.cost - 1e-9) best = { a, b, len, hit, cost };
    }
    if (best) cand.push({ i, j, best, d: dist2(cen[i][0] - cen[j][0], cen[i][1] - cen[j][1]) });
  }
  cand.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);
  const par = towns.map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const c of cand) {
    if (find(c.i) === find(c.j)) continue;
    const rt = routeLink(S, waterY, c.best.a, c.best.b, avoid);
    if (!rt) continue;
    par[find(c.i)] = find(c.j);
    links.push({ a: towns[c.i].id, b: towns[c.j].id, ax: r3(c.best.a.x), az: r3(c.best.a.z), bx: r3(c.best.b.x), bz: r3(c.best.b.z), len: rt.len, blocked: 0, wetVerts: 0, routed: true, path: rt.path });
  }
  return links;
}

/** Every POI of one map + the compound fill + the POI links, in one call. `pois` = the map's (already land-snapped) POI list, e.g. maps.js `pois`
 *  ({ id, x, z, r }); omitted = the authored table. */
export function layoutMap(seed, mapId, pois, heightFn, waterY, opts) {
  opts = opts || {};
  const S = asSampler(heightFn);
  pois = pois || defaultPois(mapId);
  const avoid = (opts.reserve || []).map((r) => r.slice());   // footprints of the towns laid out so far (and the caller's `reserve` rectangles [x0, z0, x1, z1]: landmarks that stay): a later town that has to move never lands on them
  const towns = pois.map((p) => {
    const plan = planFor(mapId, p);
    const L = layout(seed, p, S, waterY, plan.theme, Object.assign({}, plan, { avoid: avoid.slice() }));
    for (const b of L.blocks) avoid.push([b.cx - HP, b.cz - HP, b.cx + HP, b.cz + HP]);
    if (L.compound && L.parcels.length) avoid.push(L.compound.bounds);
    return L;
  });
  const comp = opts.compounds === false ? { sites: [], stats: { examined: 0, rejected: 0, placed: 0 } } : placeCompounds(seed, mapId, towns, S, waterY, Object.assign({}, opts.compound || {}, { reserve: opts.reserve || [] }));
  const links = opts.links === false ? [] : waterY > -100 ? buildLinksWater(towns, S, waterY) : buildLinks(towns, S, waterY);     // (Wave 7b: a map with water routes its links round it)
  const all = towns.concat(comp.sites);
  const ent = all.reduce((a, T) => a + T.stats.enterable, 0), bld = all.reduce((a, T) => a + T.stats.buildings, 0);
  const out = { v: VERSION, mapId, seed, towns, compounds: comp.sites, links, stats: { towns: towns.length, compounds: comp.sites.length, enterable: ent, buildings: bld, compoundFill: comp.stats } };
  lastLayout = { key: mapId + "|" + seed, L: out, pois };                  // (R1 endgame: rotationCover's endgame cluster reads the mill valley's real parts from it - see endgameCover)
  return out;
}
let lastLayout = null;                                                      // the layout of the map being built (maps.js lays out, then asks rotationCover, in one buildMap)

/** counts of one layout */
export function summarize(L) {
  const bl = L.parcels.filter((p) => p.building);
  const ent = bl.filter((p) => p.building.enterable);
  const floors = ent.reduce((a, p) => a + p.building.floors, 0);
  let rel = 0;
  for (const b of L.blocks) rel = Math.max(rel, b.ground.relief);
  return { blocks: L.blocks.length, parcels: L.parcels.length, buildings: bl.length, enterable: ent.length, shells: bl.length - ent.length, lots: L.parcels.length - bl.length,
    storeys: floors, doors: L.doors.length, rooms: L.rooms.length, stairs: L.stairs.length, maxBlockRelief: rel, roadEdges: L.roads ? L.roads.edges.length : 0 };
}

// ── rotation cover (parity P2-I, LC-47) ───────────────────────────────────────────────────────────────────────────────────────────────
// The world audit (2026-10-20, live seed 7): 43-59 % of the off-POI land was more than 20 m from anything that stops a bullet, and a straight rotation crossed up to 183 m of
// open ground. PUBG / Warzone fields are crossed rock to rock, wall to wall, wreck to wreck. rotationCover fills the gaps the wild scatter leaves, AS DATA (maps.js builds the
// pieces with what it already draws: the instanced rocks and cars - their baked colliders - and box walls in the structure batches; ZERO new meshes, programs or draw calls):
//   a jittered grid of COVER_CELL[map] m cells over the map (the scatter's own extent, half - 40 m); a cell's candidate spot is skipped on water, on a slope too steep for its
//   piece, on a road, where env.free() says no (POIs, towns, compounds, landmarks, buildings) and wherever existing cover (env.cover: the wild props and buildings so far) or a
//   piece placed before it is within COVER_GAP m - so only the holes get cover, and a forest that already has trees gets nothing;
//   a spot becomes one of three pieces:
//     "rocks"  one rocks.glb outcrop at s 1.6-2.6 (its top 1.2-1.9 m: a crouch to a standing cover), plus a second, smaller one beside it 45 % of the time
//     "wall"   a ruined wall: a straight run 3.5-6.5 m x 1.4-2.3 m x 0.5 m, an L return 2.4-3.8 m at one end half the time - QUARTER turns only (one exact box collider
//              each; a yawed box is cut into 1 m colliders); only where the ground under it is near level. Savanna adobe / brick, Isla Viva coral stone, Deepwood field stone
//     "car"    within 9-28 m of a road: an abandoned car beside it, parallel to the road (cars only on Savanna and Isla Viva; Deepwood's road wrecks are walls / rocks)
// Every draw comes from the cell's own sub-stream (subRng(seed, "cover:" + map, "i,j")): a cell's piece does not depend on any other cell's dice, the map's shared stream is
// never touched. The result is a pure function of (seed, mapId, env): env is the map's own deterministic data.
export const COVER_CELL = { ashgrid: 38, isla_viva: 36, deepwood: 41 };
export const COVER_GAP = 16;
const COVER_WALL_SHARE = { ashgrid: 0.34, isla_viva: 0.26, deepwood: 0.22 };
const COVER_CAR_SHARE = { ashgrid: 0.4, isla_viva: 0.3, deepwood: 0 };
export const COVER_TONES = {
  ashgrid: ["#b98a5e", "#a8774f", "#9c8268", "#8e5a40", "#b3a089"],        // adobe, fired brick, sandstone
  isla_viva: ["#bdb3a0", "#a99f8c", "#c9bea6", "#8f877a"],                // coral stone, lime-washed rubble
  deepwood: ["#8f8a80", "#7d786f", "#9a948a", "#6f6b63"],                 // field stone
};
/** rotation cover pieces. env = { half, waterY, h(x, z) base ground, free(x, z, pad) -> bool, cover: [[x, z, r]] existing hard cover, roads: [[x0, z0, x1, z1, width]] }
 *  -> { pieces: [{ kind: "rocks", x, z, s, ry } | { kind: "car", x, z, ry } | { kind: "wall", x, z, w, h, d, quarter, tone }], stats } */
export function rotationCover(seed, mapId, env) {
  const C = COVER_CELL[mapId] || 32, EX = env.half - 40, n = Math.floor((EX * 2) / C), step = (EX * 2) / n;
  const wallShare = COVER_WALL_SHARE[mapId] != null ? COVER_WALL_SHARE[mapId] : 0.25, carShare = COVER_CAR_SHARE[mapId] || 0, tones = COVER_TONES[mapId] || COVER_TONES.ashgrid;
  const h = env.h, wy = env.waterY, roads = env.roads || [];
  // spatial hash of the cover so far (16 m buckets)
  const B = 16, hash = new Map();
  const key = (i, j) => i * 65536 + j;
  const addC = (x, z, r) => { const k = key(Math.floor(x / B), Math.floor(z / B)); const l = hash.get(k); if (l) l.push([x, z, r]); else hash.set(k, [[x, z, r]]); };
  for (const c of env.cover || []) addC(c[0], c[1], c[2] || 0.5);
  const coverWithin = (x, z, R) => {
    const i0 = Math.floor((x - R - 8) / B), i1 = Math.floor((x + R + 8) / B), j0 = Math.floor((z - R - 8) / B), j1 = Math.floor((z + R + 8) / B);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = hash.get(key(i, j)); if (!l) continue; for (const c of l) if (dist2(c[0] - x, c[1] - z) - c[2] < R) return true; }
    return false;
  };
  // the nearest road: [distance from its centreline, unit direction, half width]
  const roadNear = (x, z) => {
    let best = Infinity, dir = null, hw = 0;
    for (const s of roads) {
      const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz;
      if (L2 < 1e-6) continue;
      const t = clamp(((x - s[0]) * dx + (z - s[1]) * dz) / L2, 0, 1), d = dist2(x - s[0] - dx * t, z - s[1] - dz * t);
      if (d < best) { best = d; const L = Math.sqrt(L2); dir = [dx / L, dz / L]; hw = (s[4] || ROAD_W) / 2; }
    }
    return { d: best, dir, hw };
  };
  const relief = (x, z, rx, rz) => { let lo = Infinity, hi = -Infinity; for (const [a, b] of [[0, 0], [rx, rz], [-rx, -rz], [rx, -rz], [-rx, rz]]) { const g = h(x + a, z + b); if (g < lo) lo = g; if (g > hi) hi = g; } return hi - lo; };
  const pieces = [], st = { cells: 0, wet: 0, blocked: 0, covered: 0, rocks: 0, walls: 0, cars: 0 };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    st.cells++;
    const r = subRng(seed, "cover:" + mapId, i + "," + j);
    const jx = r(), jz = r(), kindRoll = r(), v1 = r(), v2 = r(), v3 = r(), v4 = r(), v5 = r();
    const x = r3(-EX + (i + 0.15 + jx * 0.7) * step), z = r3(-EX + (j + 0.15 + jz * 0.7) * step);
    const g = h(x, z);
    if (!(g >= wy + 1.0) || h(x + 4, z) < wy + 0.6 || h(x - 4, z) < wy + 0.6 || h(x, z + 4) < wy + 0.6 || h(x, z - 4) < wy + 0.6) { st.wet++; continue; }
    if (!env.free(x, z, 6)) { st.blocked++; continue; }
    const rn = roadNear(x, z);
    if (rn.d < rn.hw + 3.5) { st.blocked++; continue; }
    if (coverWithin(x, z, COVER_GAP)) { st.covered++; continue; }
    const nearRoad = rn.d < 28 && rn.dir && carShare > 0;
    let kind = nearRoad && kindRoll < carShare ? "car" : kindRoll < (nearRoad ? carShare : 0) + wallShare * (nearRoad ? 1 - carShare : 1) ? "wall" : "rocks";
    if (kind === "car") {
      // beside the road (the spot is already >= 3.5 m off the asphalt: the car's near side >= 2.2 m), parallel to it, a little askew, either way round
      const ry = Math.atan2(rn.dir[0], rn.dir[1]) + (v1 - 0.5) * 0.5 + (v2 < 0.5 ? Math.PI : 0);
      if (relief(x, z, 2.5, 2.5) > 0.9) kind = "rocks";
      else { pieces.push({ kind: "car", x, z, ry: r3(ry) }); addC(x, z, 2.2); st.cars++; continue; }
    }
    if (kind === "wall") {
      const w = r2(3.5 + v1 * 3), wh = r2(1.4 + v2 * 0.9), q = v3 < 0.5 ? 0 : 1, ex = q ? 0.25 : w / 2, ez = q ? w / 2 : 0.25;
      if (relief(x, z, ex, ez) <= 0.7 && env.free(x, z, w / 2 + 1)) {
        const tone = tones[Math.floor(v4 * tones.length) % tones.length];
        pieces.push({ kind: "wall", x, z, w, h: wh, d: 0.5, quarter: q, tone });
        if (v5 < 0.5) {
          // an L return at one end, the same height, the other axis
          const lw = r2(2.4 + v1 * 1.4), end = v2 < 0.5 ? -1 : 1, side = (v5 * 4) % 1 < 0.5 ? -1 : 1;
          const ax = q ? 0 : end * (w / 2 - 0.25), az = q ? end * (w / 2 - 0.25) : 0;
          const lx = r3(x + ax + (q ? side * (lw / 2 + 0.25) : 0)), lz = r3(z + az + (q ? 0 : side * (lw / 2 + 0.25)));
          if (relief(lx, lz, q ? lw / 2 : 0.25, q ? 0.25 : lw / 2) <= 0.7 && env.free(lx, lz, lw / 2 + 1) && roadNear(lx, lz).d > rn.hw + 3.5) pieces.push({ kind: "wall", x: lx, z: lz, w: lw, h: wh, d: 0.5, quarter: 1 - q, tone });
        }
        addC(x, z, w / 2); st.walls++; continue;
      }
      kind = "rocks";
    }
    // rocks: an outcrop, and a smaller one beside it 45 % of the time
    const s = r2(1.6 + v1 * 1.0), ry = r3(v2 * Math.PI * 2);
    pieces.push({ kind: "rocks", x, z, s, ry });
    if (v3 < 0.45) {
      const a = v4 * Math.PI * 2, dd = 2.6 + v5 * 1.6, x2 = r3(x + Math.cos(a) * dd * s), z2 = r3(z + Math.sin(a) * dd * s);
      if (h(x2, z2) >= wy + 1.0 && roadNear(x2, z2).d > rn.hw + 3.5 && env.free(x2, z2, 3)) pieces.push({ kind: "rocks", x: x2, z: z2, s: r2(1.45 + v5 * 0.5), ry: r3((ry + 2.1) % (Math.PI * 2)) });
    }
    addC(x, z, 1.4 * s); st.rocks++;
  }
  // (the endgame cluster's own test: a HARD piece - a rock outcrop, a wall, a wreck, a building: radius >= 1 m in the hash; a tree trunk is < 1 m - within R m of the centre)
  const hardWithin = (x, z, R) => {
    const i0 = Math.floor((x - R) / B), i1 = Math.floor((x + R) / B), j0 = Math.floor((z - R) / B), j1 = Math.floor((z + R) / B);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = hash.get(key(i, j)); if (!l) continue; for (const c of l) if (c[2] >= 1 && dist2(c[0] - x, c[1] - z) < R) return true; }
    return false;
  };
  const eg = endgameCover(seed, mapId, env, { h, wy, tones, roadNear, relief, coverWithin, hardWithin, addC });
  if (eg) { for (const q of eg.pieces) pieces.push(q); st.endgame = eg.stats; }
  return { pieces, stats: st };
}

// ── endgame cover (R1, lane endgame) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Owner OD-1 places STANDARD mode's circles area-uniform and land-checked (sim/royale.js placeCircle), so the last two circles (c7, r 31.4 m) land anywhere on dry ground - mostly
// NOT in the towns and endgame villages that were built round the old near-centre finals (citycheck endgame-cover on 200 seeds: 68.5 / 43.5 / 31.0 % of seeds had >= 10 cover pieces in
// c7, median 69 / 2 / 2 = isla_viva / ashgrid / deepwood). The world now knows its own final circles: the storm plan is a pure function of (seed, mode, half, the land predicate), so the
// map builds the STANDARD plan from the same Storm (the sim's, window / globalThis FFG.sim.Royale - the one storm.js uses) with the same predicate (terrain > waterY + 0.5 m, storm.js
// landPredicate) and lays a seeded cluster of ruined walls and squat stone blocks inside c7 - a few in the final circle c8 - in the map's own wall tones: quarter-turn boxes (one exact
// collider each) drawn in the structure batch the rotation-cover walls use (no new mesh, program or draw call). Quick Match keeps its near-concentric plan (OD-1): its finals stay with the
// villages; the cluster is part of the WORLD (same seed = same world in every mode). Every draw comes from subRng(seed, "endgame:" + map, ...): the shared stream is never touched.
export const ENDGAME_COVER = { target: 15, finalTarget: 3, reach: 25.5, finalReach: 7.0, gap: 5.6, clear: 8.6, tries: 260 };
export const STORM_HALF_FRAC = 0.98;                       // maps.js returns half: HALF * 0.98 - the storm (storm.js W.map.half) is planned on THAT half
function stormSim(env) {
  if (env.sim && typeof env.sim.Storm === "function") return env.sim;
  const g = typeof globalThis !== "undefined" ? globalThis : null;
  const R = g && g.FFG && g.FFG.sim && g.FFG.sim.Royale;
  return R && typeof R.Storm === "function" ? R : null;
}
/** the final circles of the STANDARD storm plan of this (seed, map): { c6, c7, c8 } as { x, z, r }, or null without the sim */
export function endgameCircles(seed, env) {
  const SIM = stormSim(env);
  if (!SIM || !(env.half > 0)) return null;
  const h = env.h, wy = env.waterY;
  const S = new SIM.Storm({ seed, mode: "standard", half: env.stormHalf != null ? env.stormHalf : env.half * STORM_HALF_FRAC, landAt: (x, z) => h(x, z) > wy + 0.5 });
  const c = S.circles, n = c.length;
  if (n < 4) return null;
  const pick = (k) => ({ x: c[k].x, z: c[k].z, r: c[k].r });
  return { c6: pick(n - 3), c7: pick(n - 2), c8: pick(n - 1) };
}
function endgameCover(seed, mapId, env, K) {
  const E = endgameCircles(seed, env);
  if (!E) return null;
  const P = ENDGAME_COVER, { h, wy, tones, roadNear, relief, coverWithin, hardWithin, addC } = K;
  const c7 = E.c7, c8 = E.c8, out = [], placed = [];
  const st = { c7: [r2(c7.x), r2(c7.z), r2(c7.r)], c8: [r2(c8.x), r2(c8.z), r2(c8.r)], tries: 0, wet: 0, blocked: 0, steep: 0, crowded: 0, walls: 0, blocks: 0, inFinal: 0, pieces: 0 };
  const r = subRng(seed, "endgame:" + mapId, "c7");
  // env.free() keeps out of every POI disc and every compound's bounding rectangle WHOLE. Two of those are mostly open land: a grid town's POI disc beyond its street grid (Savanna's
  // Downtown is a 150 m disc, Rubble Row 110 m - c7 landed in their outskirts on 3 of the first 30 OD-1 seeds) and the mill valley (Deepwood: the mill's compound bounds are one rectangle
  // round its every piece - the river runs diagonally through ~370 x 360 m of the map's middle - so a final circle there, 12 of the first 20 seeds' misses, had only the mill's own log
  // piles and boulders 14-110 m from the river). There the cluster keeps off what the ground really holds instead: every town's street blocks, every other compound, the mill's plots and
  // retaining walls, its bridge and approaches, the water mill and its free pieces, and any POI that is not a towngen town (a wreck, temples, a lookout: built elsewhere) - plus, as
  // everywhere, the roads, the water, slopes and the cover already standing. Only with this build's own layout (same map and seed: lastLayout).
  const LL = lastLayout && lastLayout.key === mapId + "|" + seed ? lastLayout : null;
  const inR = (q, x, z, pad) => x > q[0] - pad && x < q[2] + pad && z > q[1] - pad && z < q[3] + pad;
  const layoutFree = !LL ? null : (() => {
    const towns = LL.L.towns, all = towns.concat(LL.L.compounds), byId = new Map(towns.map((T) => [T.id, T]));
    const mill = towns.find((T) => T.kind === "mill" && T.mill && T.compound && T.compound.bounds && T.parcels.length) || null;
    const foot = [], parts = [];
    for (const T of all) {
      for (const b of T.blocks) foot.push([b.cx - HP - 5, b.cz - HP - 5, b.cx + HP + 5, b.cz + HP + 5]);
      if (T !== mill && T.compound && T.compound.bounds && T.parcels.length) { const q = T.compound.bounds; foot.push([q[0] - 6, q[1] - 6, q[2] + 6, q[3] + 6]); }
      for (const p of T.parcels) if (p.building) { const a = p.building.aabb; foot.push([a[0] - 5, a[1] - 5, a[2] + 5, a[3] + 5]); }
    }
    if (mill) {
      const M = mill.mill;
      for (const pl of M.plots) parts.push([pl.rect[0] - 5, pl.rect[1] - 5, pl.rect[2] + 5, pl.rect[3] + 5]);
      for (const wl of M.walls) { const hx = wl.axis === 0 ? wl.len / 2 : wl.th / 2, hz = wl.axis === 0 ? wl.th / 2 : wl.len / 2; parts.push([wl.x - hx - 2, wl.z - hz - 2, wl.x + hx + 2, wl.z + hz + 2]); }
      const d = M.deck; parts.push(M.axis === 0 ? [d[0] - 10, d[1] - 24, d[2] + 10, d[3] + 24] : [d[0] - 24, d[1] - 10, d[2] + 24, d[3] + 10]);
      for (const q of M.pieces) parts.push([q.x - 3.5, q.z - 3.5, q.x + 3.5, q.z + 3.5]);
      if (M.wheel) parts.push([M.wheel.rect[0] - 3, M.wheel.rect[1] - 3, M.wheel.rect[2] + 3, M.wheel.rect[3] + 3]);
    }
    const pois = LL.pois || [];
    return (x, z, pad) => {
      for (const p of pois) if (dist2(p.x - x, p.z - z) < p.r + pad) { const T = byId.get(p.id); if (!T || !(T.blocks.length || T === mill)) return false; }      // a POI towngen did not lay out as a grid town / the mill: hands off
      if (foot.some((q) => inR(q, x, z, pad)) || parts.some((q) => inR(q, x, z, pad))) return false;
      return true;
    };
  })();
  const freeAt = (x, z, pad) => env.free(x, z, pad) || (layoutFree ? layoutFree(x, z, pad) : false);
  const clashes = (x, z, ex, ez) => { for (const q of placed) if (Math.abs(q[0] - x) < q[2] + ex + P.gap * 0.5 && Math.abs(q[1] - z) < q[3] + ez + P.gap * 0.5) return true; return false; };
  for (let k = 0; k < P.tries && st.walls + st.blocks < P.target; k++) {
    st.tries++;
    const inF = st.inFinal < P.finalTarget && k % 3 === 0;                   // every third try aims at the final circle until it holds finalTarget pieces
    const C = inF ? c8 : c7, R = inF ? P.finalReach : P.reach;
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R, kindRoll = r(), v1 = r(), v2 = r(), v3 = r(), v4 = r();
    const x = r3(C.x + Math.cos(a) * d), z = r3(C.z + Math.sin(a) * d);
    if (dist2(x - c7.x, z - c7.z) > P.reach + 1) { st.blocked++; continue; }
    const g = h(x, z);
    if (!(g >= wy + 1.0) || h(x + 3, z) < wy + 0.6 || h(x - 3, z) < wy + 0.6 || h(x, z + 3) < wy + 0.6 || h(x, z - 3) < wy + 0.6) { st.wet++; continue; }
    const block = kindRoll < 0.35;
    // a ruined wall: a run 3.0-5.2 m x 1.35-2.1 m x 0.5 m; a block: a squat stone block (a fallen ashlar / a cairn) 1.6-2.3 m square, 1.3-1.7 m tall
    const w = block ? r2(1.6 + v1 * 0.7) : r2(3.0 + v1 * 2.2), hh = block ? r2(1.3 + v2 * 0.4) : r2(1.35 + v2 * 0.75), dd = block ? r2(1.6 + v4 * 0.7) : 0.5, q = v3 < 0.5 ? 0 : 1;
    const ex = q ? dd / 2 : w / 2, ez = q ? w / 2 : dd / 2;
    if (!freeAt(x, z, Math.max(ex, ez) + 1)) { st.blocked++; continue; }
    const rn = roadNear(x, z);
    if (rn.d < rn.hw + 2.5 + Math.max(ex, ez)) { st.blocked++; continue; }
    if (relief(x, z, ex, ez) > 0.7) { st.steep++; continue; }
    // open ground only: no hard cover (rocks, walls, wrecks, buildings - placed before the cluster) within P.clear m, nothing at all against the piece, and the cluster's own gap
    if (hardWithin(x, z, P.clear) || coverWithin(x, z, Math.max(ex, ez) + 1.2) || clashes(x, z, ex, ez)) { st.crowded++; continue; }
    const tone = tones[Math.floor(v4 * tones.length) % tones.length];
    out.push({ kind: "wall", x, z, w, h: hh, d: dd, quarter: q, tone, endgame: 1 });
    placed.push([x, z, ex, ez]);
    if (block) st.blocks++; else st.walls++;
    if (dist2(x - c8.x, z - c8.z) + Math.max(ex, ez) < c8.r) st.inFinal++;
  }
  for (const q of placed) addC(q[0], q[1], Math.max(q[2], q[3]));        // (registered after the loop: the cluster's own spacing is P.gap, not the hard-cover clearance)
  st.pieces = out.length;
  return { pieces: out, stats: st };
}

// ── street props (Wave 7, lane 7A): lights, hydrants, benches, planters, parked cars, lot dressing - as DATA, in the layout's own sub-RNG ──────────────────────────
// Every entry is a citykit list item minus its height: { type, x, z, rot, kind }. x, z are the footprint ORIGIN of the manifest type (all these types are modelled
// about their origin), rot is the quarter-turn index citykit takes (front +Z faces +Z, +X, -Z, -X for 0..3). maps.js puts each at the ground it stands on.
// Nothing is placed on a parcel rectangle (buildings and lots are inside the parcel squares), inside a street junction, or within 1.5 m of another prop of its kind.
export const KIT_CARS = [["cars/sedan", 3], ["cars/suv", 2], ["cars/hatchback-sports", 1.2], ["cars/taxi", 1], ["cars/van", 1.2], ["cars/police", 0.5], ["cars/truck", 0.7], ["cars/delivery", 0.6]];
export const STREET_TYPES = ["props/light-curved", "props/hydrant", "props/grave-bench", "props/planter", "props/dumpster", "props/box-crate", "props/crate-yard", "props/cone-traffic",
  "props/light-square", "props/light-curved-double", "props/construction-barrier", "props/shipping-container", "furniture/trashcan"];     // (the last five: the Wave 7 polish dressing, city theme only)
/** Parked-car paints (city theme): muted, mostly neutral - white, silver, greys, black, dark blue / red / green, sand - as [sRGB hex, weight]. A car entry carries one as `tint`
 *  (citykit recolours the saturated body texels of the car palette to it; the glass, tyres and lamps keep their own colours). Taxis and police cars keep their liveries. */
export const CAR_TINTS = [[0xf0f0ee, 3], [0xc7cbd0, 4], [0x8c929a, 3], [0x3a3e44, 4], [0x1e2227, 3], [0x1f3553, 2], [0x5a2029, 2], [0x4b583b, 2], [0xb7a27b, 2], [0x68808f, 2], [0x7c2f26, 1.2], [0x9a6a3c, 1]];
export const TINTABLE_CARS = ["cars/sedan", "cars/suv", "cars/hatchback-sports", "cars/van", "cars/truck", "cars/delivery"];
/** (P23) shipping-container liveries [sRGB hex, weight]: the shipping lines' blues, a deep green, a rust red, an orange, a mustard, a cream, a grey - weathered, never saturated toys */
export const CONTAINER_TINTS = [[0x2f4f7a, 4], [0x1f3a5c, 3], [0x2e5a3c, 2.5], [0x8a3226, 3.5], [0xb2582a, 2], [0xb08a2e, 1.5], [0xc9c2ad, 1.5], [0x6d7276, 2], [0x5e2a3a, 1]];
const LIGHT_OFFSET = 6.4;       // m from a street centreline: the middle of the 3 m sidewalk (5 .. 8)
const CAR_OFFSET = 3.55;        // m from a street centreline: the middle of the curb lane (a 2.55 m car spans 2.3 .. 4.8)
const JUNCTION = 9.5;           // m from a node a street prop keeps clear (half the road + the curb radius + a car length of approach)
/** quarter-turn index whose front (+Z) faces (dx, dz) */
const faceIdx = (dx, dz) => (Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 0 : 2));
// (Wave 7b: a resort has no taxis, police cars or delivery vans parked in its streets, a timber lodge no taxis or sports hatchbacks: the pool of a themed map is cut down; the city theme's
//  pool is the whole table, as it was)
const THEME_NO_CARS = { resort: ["cars/taxi", "cars/police", "cars/delivery", "cars/truck"], lodge: ["cars/taxi", "cars/police", "cars/delivery", "cars/hatchback-sports"] };
function pickCars(rng, n, theme) {
  const cut = THEME_NO_CARS[theme] || [];
  const pool = KIT_CARS.filter((c) => cut.indexOf(c[0]) < 0).map((c) => c.slice()), out = [];
  while (out.length < n && pool.length) { const c = wpick(rng, pool, (q) => q[1]); pool.splice(pool.indexOf(c), 1); out.push(c[0]); }
  return out;
}
/** The static street dressing of one grid layout (a town): see the block comment above. Pure and deterministic: a function of (seed, layout). */
export function streetProps(L, seed) {
  const out = [];
  if (!L.blocks || !L.blocks.length) return out;
  const rng = subRng(seed === undefined ? L.seed : seed, L.id, "street");
  const nodes = L.roads.nodes;
  const heavy = L.kind === "core";
  const city = L.theme === "city";                                      // Wave 7 polish: the extra dressing and the car paints are the city theme's; the others are the stage-A output
  const vrng = city ? subRng(seed === undefined ? L.seed : seed, L.id, "street2") : null, trng = city ? subRng(seed === undefined ? L.seed : seed, L.id, "tint") : null;
  const cars = pickCars(rng, city ? (heavy ? 4 : 3) : heavy ? 5 : 3, L.theme);     // (city: a car type is a draw call, two with its shadow: paints give the variety instead)
  const inBlock = (x, z, m) => { for (const b of L.blocks) if (Math.abs(x - b.cx) <= BLOCK_HALF - m && Math.abs(z - b.cz) <= BLOCK_HALF - m) return true; return false; };
  const taken = [];                                                    // [x, z, kind, r] placed so far: 1.5 m clear of a prop of the same kind, 2.5 m of a light
  const clear = (x, z, kind, r) => { for (const q of taken) { const dx = q[0] - x, dz = q[1] - z, rr = q[3] + r + 0.6; if (dx * dx + dz * dz < rr * rr) return false; } return true; };
  const add = (type, x, z, rot, kind, r) => {
    if (!clear(x, z, kind, r)) return false;
    taken.push([x, z, kind, r]);
    const e = { type, x: r3(x), z: r3(z), rot, kind };
    if (trng && kind === "car" && TINTABLE_CARS.indexOf(type) >= 0) e.tint = wpick(trng, CAR_TINTS, (q) => q[1])[0];
    out.push(e); return true;
  };
  // street lights: both sidewalks of every street edge that has a block beside it, staggered so a light faces a gap
  for (const e of L.roads.edges) {
    const A = nodes[e.a], B = nodes[e.b], len = e.len;
    if (len < 2 * JUNCTION + 6) continue;
    const ux = e.axis === "x" ? Math.sign(B.x - A.x) : 0, uz = e.axis === "z" ? Math.sign(B.z - A.z) : 0, nx = -uz, nz = ux;
    for (const side of [-1, 1]) {
      const n = Math.max(1, Math.round((len - 2 * JUNCTION) / 26));
      for (let k = 0; k < n; k++) {
        const t = JUNCTION + (len - 2 * JUNCTION) * ((k + (side > 0 ? 0.3 : 0.7)) / n);
        const px = A.x + ux * t + nx * side * LIGHT_OFFSET, pz = A.z + uz * t + nz * side * LIGHT_OFFSET;
        if (!inBlock(px, pz, 0.3)) continue;
        let lt = "props/light-curved";
        if (vrng) vrng();                                              // (one stream draw per light kept: the other dressing below does not shift)
        add(lt, px, pz, faceIdx(nx * side, nz * side), "light", 0.3);
      }
    }
  }
  // each block: corner hydrants, a bench or two mid-side, planters at the corners of the core
  for (const b of L.blocks) {
    const bx = [b.cx - BLOCK_HALF + 1.5, b.cx + BLOCK_HALF - 1.5], bz = [b.cz - BLOCK_HALF + 1.5, b.cz + BLOCK_HALF - 1.5];
    for (const x of bx) for (const z of bz) {
      if (rng() < (city ? 0.17 : (L.theme === "resort" || L.theme === "lodge") ? 0.2 : 0.45)) add("props/hydrant", x, z, Math.floor(rng() * 4), "hydrant", 0.4);     // (a hydrant is 976 triangles: 83 of them were 81k, a tenth of the city's kit)
      else if (heavy && rng() < 0.5) add("props/planter", x + (x > b.cx ? -0.9 : 0.9), z + (z > b.cz ? -0.7 : 0.7), Math.floor(rng() * 2) * 2, "planter", 0.9);
    }
    for (const side of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {            // the four sidewalks (side = the direction of the street from the block centre)
      if (rng() < 0.45) continue;
      const along = (rng() - 0.5) * 18, px = b.cx + side[0] * (BLOCK_HALF - 1.5) + (side[0] ? 0 : along), pz = b.cz + side[1] * (BLOCK_HALF - 1.5) + (side[1] ? 0 : along);
      add("props/grave-bench", px, pz, faceIdx(side[0], side[1]), "bench", 0.8);
    }
  }
  // parked cars in the curb lanes (never in a junction), more of them downtown
  const occ = city ? (heavy ? 0.16 : 0.12) : heavy ? 0.24 : 0.15;     // (a parked car is 2,000-2,500 triangles: the city has four times the street length of stage A, not four times the cars)
  for (const e of L.roads.edges) {
    const A = nodes[e.a], B = nodes[e.b], len = e.len;
    const ux = e.axis === "x" ? Math.sign(B.x - A.x) : 0, uz = e.axis === "z" ? Math.sign(B.z - A.z) : 0, nx = -uz, nz = ux;
    for (const side of [-1, 1]) {
      for (let t = JUNCTION + 2.4; t <= len - JUNCTION - 2.4; t += 6.4) {
        const draw = rng(), pickT = rng(), flip = rng() < 0.5, jit = (rng() - 0.5) * 1.6;
        if (draw >= occ) continue;
        const px = A.x + ux * (t + jit) + nx * side * CAR_OFFSET, pz = A.z + uz * (t + jit) + nz * side * CAR_OFFSET;
        const rot = e.axis === "x" ? (flip ? 1 : 3) : (flip ? 0 : 2);
        add(cars[Math.min(cars.length - 1, Math.floor(pickT * cars.length))], px, pz, rot, "car", 2.4);
      }
    }
  }
  // the empty lots: a parking lot (two rows of stalls, half full), a pocket park (benches, planters), a yard (a dumpster and crates)
  for (const p of L.parcels) {
    if (p.use !== "lot") continue;
    const [x0, z0, x1, z1] = p.rect, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (p.lot === "parking") {
      const alongX = w >= d, L1 = alongX ? w : d, Wd = alongX ? d : w;
      const rows = Wd >= 20 ? [-(Wd / 2 - 4.6), Wd / 2 - 4.6] : [0];
      for (const off of rows) for (let u = -L1 / 2 + 3.4; u <= L1 / 2 - 3.4; u += 3.2) {
        if (rng() > 0.5) continue;
        const px = alongX ? cx + u : cx + off, pz = alongX ? cz + off : cz + u;
        add(cars[Math.floor(rng() * cars.length)], px, pz, alongX ? (off < 0 ? 0 : 2) : (off < 0 ? 1 : 3), "car", 2.4);
      }
    } else if (p.lot === "park") {
      add("props/grave-bench", cx - 3, cz, 1, "bench", 0.8); add("props/grave-bench", cx + 3, cz, 3, "bench", 0.8);
      add("props/planter", cx, cz - 4, 0, "planter", 0.9); add("props/planter", cx, cz + 4, 2, "planter", 0.9);
    } else if (city && LANDMARK_LOTS.indexOf(p.lot) >= 0) {
      /* a landmark lot: maps.js builds it */
    } else if (p.ident === "containers") {
      // (P23 / LC-29) a container lot: containerSlots, a slot left empty CONTAINER_DROP of the time, doors at either end (rot +2 on a coin), a livery each (citykit paints the
      // container's body with the entry's tint: one InstancedMesh per part whatever the colours). Own sub-stream per lot: nothing else in the layout moves.
      const cr = subRng(seed === undefined ? L.seed : seed, L.id, "ctr" + p.id);
      for (const s of containerSlots(p.rect)) {
        const drop = cr(), flip = cr() < 0.5, liv = wpick(cr, CONTAINER_TINTS, (q) => q[1])[0];
        if (drop < CONTAINER_DROP) continue;
        taken.push([s.x, s.z, "container", 3.2]);
        out.push({ type: "props/shipping-container", x: s.x, z: s.z, rot: s.rot + (flip ? 2 : 0), kind: "container", tint: liv });
      }
    } else if (p.ident === "woodyard") {
      /* (P23 / LC-29) a woodyard: maps.js themedLots dresses it (log piles, a chopping stump, a sawhorse) - no dumpster / crates: those kit types were new to a lodge town's
         district and cost the Logging Camp view one instanced draw per type and palette (+6 objects, measured) */
    } else if (city && L.kind === "yard" && w >= 14 && d >= 12) {
      const alongX = w >= d, rot = alongX ? 0 : 1;                       // a container yard: two containers (6 x 2.9 m) end to end along the lot's long side
      for (const off of [-3.4, 3.4]) add("props/shipping-container", alongX ? cx + off : cx, alongX ? cz : cz + off, rot, "container", 3.2);
    } else {
      add("props/dumpster", x0 + 3, z0 + 2.5, 0, "dumpster", 1.1);
      add(rng() < 0.5 ? "props/box-crate" : "props/crate-yard", x1 - 3, z1 - 3, Math.floor(rng() * 4), "crate", 0.7);
      add("props/crate-yard", x1 - 5, z1 - 3.2, Math.floor(rng() * 4), "crate", 0.7);
    }
  }
  const themed = L.theme === "resort" || L.theme === "lodge";
  if (city || themed) {
    // a parked car is 2,000-2,500 triangles: a core of 86 of them (seed 1) cost the endgame view 340k. The cars a town ends up with are thinned to an even spread of at most
    // CAR_CAP (38 in a core, 20 elsewhere) AFTER every draw above was made, so nothing else in the layout moves
    // (Wave 7b: a resort keeps at most 6 parked cars (10 in a core), a lodge village 14 (16): a beach town's streets are walked, a lodge village has a pickup by every few cabins; 30-40 cars in a
    //  Coco Village street view were 125 k triangles with their shadows)
    const capN = themed ? (L.theme === "lodge" ? (heavy ? 16 : 14) : (heavy ? 10 : 6)) : heavy ? 38 : 20, idxs = [];
    for (let i = 0; i < out.length; i++) if (out[i].kind === "car") idxs.push(i);
    if (idxs.length > capN) {
      const drop = new Set(), n = idxs.length;
      for (let k = 0; k < n; k++) if (!(Math.floor((k + 1) * capN / n) > Math.floor(k * capN / n))) drop.add(idxs[k]);
      for (let i = out.length - 1; i >= 0; i--) if (drop.has(i)) out.splice(i, 1);
    }
  }
  if (city) {
    // litter bins at the block corners (the sidewalk's outer corners, beside the hydrants and benches)
    for (const b of L.blocks) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (vrng() > (heavy ? 0.5 : 0.3)) continue;
      add("furniture/trashcan", b.cx + sx * (BLOCK_HALF - 2.3), b.cz + sz * (BLOCK_HALF - 1.4), Math.floor(vrng() * 4), "bin", 0.35);
    }
  }
  return out;
}

// tables the selftest (and Wave 7 / lane 6C) read: the shell kit sizes (checked against the manifest), archetypes, themes, mixes
export { SHELLS as SHELL_KITS, ARCH as ARCHETYPES, THEMES, MIX, POI_TABLE, STRETCH as STRETCH_RANGES };
