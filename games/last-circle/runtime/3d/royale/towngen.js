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
 * VERSION is the generator version: any change that moves output bumps it (lane 7C's squad version guard reads it).
 */

export const VERSION = 1;

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
const FRONT_SETBACK = 1.5, SIDE_MARGIN = 1.0, BACK_MARGIN = 1.0;
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
        const v = fn(i * LAT, j * LAT);
        POOL.vals[k] = v; POOL.stamp[k] = id;
        return v;
      }
      const k = (i + 65536) * 131072 + (j + 65536);
      let v = own.get(k);
      if (v === undefined) { v = fn(i * LAT, j * LAT); own.set(k, v); }
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
};
// Closed kit shells (skyline and back-of-block fill only, <= 20 %). [manifest type, w, d, height] = bbox_m at suggested_scale
// (assets/props/city/manifest.json; the selftest re-reads the manifest and fails if these drift). Front is +Z.
const SHELLS = {
  skyline: [["skyscraper/building-skyscraper-a", 16.32, 16.32, 34.56], ["skyscraper/building-skyscraper-b", 16.32, 16.32, 53.76],
    ["skyscraper/building-skyscraper-c", 15.36, 16.655, 48.96], ["skyscraper/building-skyscraper-e", 15.54, 14.904, 48.96],
    ["commercial/building-m", 14.88, 14.904, 37.8], ["commercial/building-i", 14.88, 15.624, 20.16]],
  mid: [["commercial/building-a", 10.603, 11.28, 15.516], ["commercial/building-f", 10.08, 12.36, 20.316],
    ["commercial/building-h", 10.603, 12.094, 15.516], ["commercial/building-c", 10.603, 13.08, 10.716]],
  house: [["suburban/building-type-a", 9.36, 7.403, 6.002], ["suburban/building-type-h", 9.36, 6.595, 5.31],
    ["suburban/building-type-i", 9.262, 7.401, 5.31], ["suburban/building-type-q", 8.928, 6.376, 6.61]],
};
// palette keys per theme (O2): the kit's two colormaps + their recoloured variants (manifest palettes.<key>.variants)
const THEMES = {
  city: { house: ["suburban", [null, "slate", "brick", "sand"]], big: ["commercial", [null, "slate", "brick", "sand"]], shell: "skyline" },
  resort: { house: ["suburban", ["sand", "sand", null, "brick"]], big: ["commercial", ["sand", "sand", null]], shell: "mid" },
  lodge: { house: ["suburban", ["brick", "brick", "slate", null]], big: ["commercial", ["brick", "slate"]], shell: "house" },
  farm: { house: ["suburban", ["brick", "sand", null]], big: ["commercial", ["sand", "brick"]], shell: "house" },
  ruin: { house: ["suburban", ["slate", "sand", "brick"]], big: ["commercial", ["slate", "sand"]], shell: "house" },
  mill: { house: ["suburban", ["brick", "slate", null]], big: ["commercial", ["brick", "slate"]], shell: "house" },
};
// archetype weights per theme / kind ("lot" = a parcel with no building: parking, pocket park, yard; "shell" = closed kit building)
const MIX = {
  "city/core": { tower: 34, midrise: 34, shop: 18, lot: 0, shell: 14 },
  "city/town": { house_s: 20, house_m: 22, shop: 26, midrise: 12, shed: 4, lot: 6, shell: 10 },
  "city/village": { house_s: 28, house_m: 22, shop: 24, midrise: 4, shed: 8, lot: 6, shell: 8 },
  "city/yard": { hall: 34, shed: 24, shop: 12, lot: 14, shell: 0 },
  "resort/core": { midrise: 30, shop: 30, house_m: 20, lot: 4, shell: 10 },
  "resort/town": { house_s: 20, house_m: 30, shop: 24, midrise: 12, lot: 6, shell: 8 },
  "resort/village": { house_s: 30, house_m: 30, shop: 22, shed: 8, lot: 6, shell: 4 },
  "lodge/core": { midrise: 20, shop: 30, cabin: 30, hall: 10, lot: 4, shell: 6 },
  "lodge/town": { cabin: 50, house_m: 12, shop: 16, hall: 8, shed: 6, lot: 6, shell: 4 },
  "lodge/village": { cabin: 58, house_m: 10, shop: 12, hall: 6, shed: 8, lot: 4, shell: 2 },
};
const mixFor = (theme, kind) => MIX[theme + "/" + kind] || MIX["city/" + kind] || MIX["city/town"];
const GRID_KINDS = new Set(["core", "town", "village", "yard"]);

// ── plans: one entry per POI of the three maps (maps.js POI tables), sized to this game ──────────────────────────────────────────────
// kind = grid kind (cols x rows blocks) or a cluster kind: farm | lane | compound. minBlocks = fewest kept blocks the town accepts
// before it relaxes the relief ladder. maxShift caps how far the grid may slide to find dry, gentle ground (m).
export const PLANS = {
  ashgrid: {
    theme: "city",
    pois: {
      downtown: { kind: "core", cols: 3, rows: 3, minBlocks: 7, maxShift: 16 },
      metro: { kind: "town", cols: 2, rows: 2, minBlocks: 3, maxShift: 60 },
      overpass: { kind: "town", cols: 2, rows: 2, minBlocks: 3, maxShift: 60 },
      yard: { kind: "yard", cols: 2, rows: 2, minBlocks: 2, maxShift: 60 },
      mall: { kind: "town", cols: 2, rows: 2, minBlocks: 3, maxShift: 60 },
      crane: { kind: "village", cols: 2, rows: 1, minBlocks: 2, maxShift: 50 },
      rubble: { kind: "village", cols: 2, rows: 1, minBlocks: 2, maxShift: 60 },
      motorpool: { kind: "yard", cols: 2, rows: 1, minBlocks: 2, maxShift: 50 },
      outpost: { kind: "town", cols: 3, rows: 2, minBlocks: 4, maxShift: 50 },
    },
    compounds: { count: 30, themes: ["farm", "ruin"], weights: [3, 2] },
  },
  isla_viva: {
    theme: "resort",
    pois: {
      palm_bay: { kind: "town", cols: 2, rows: 2, minBlocks: 2, maxShift: 80, reach: 440 },
      coco_village: { kind: "town", cols: 2, rows: 2, minBlocks: 2, maxShift: 80, reach: 440 },
      jungle_market: { kind: "town", cols: 2, rows: 2, minBlocks: 2, maxShift: 80, reach: 440 },
      lagoon_docks: { kind: "village", cols: 2, rows: 1, minBlocks: 1, maxShift: 90, reach: 640 },
      banana_farm: { kind: "farm", theme: "farm", maxShift: 70, reach: 440 },
      cliff_temples: { kind: "green", theme: "ruin", maxShift: 70, reach: 440 },
      volcano_rim: { kind: "lane", theme: "ruin", maxShift: 80, reach: 440 },
      shipwreck: { kind: "lane", theme: "ruin", maxShift: 70, reach: 440 },
    },
    compounds: { count: 8, themes: ["farm", "ruin"], weights: [3, 2] },
  },
  deepwood: {
    theme: "lodge",
    pois: {
      logging: { kind: "village", cols: 2, rows: 1, minBlocks: 2, maxShift: 80 },
      lakeside: { kind: "town", cols: 2, rows: 2, minBlocks: 2, maxShift: 90 },
      ranger: { kind: "green", theme: "ruin", maxShift: 80 },
      hollow: { kind: "lane", theme: "ruin", maxShift: 70 },
      quarry: { kind: "lane", theme: "ruin", maxShift: 80 },
      mill: { kind: "lane", theme: "mill", maxShift: 70, axis: 1 },
      firewatch: { kind: "green", theme: "ruin", maxShift: 60 },
      meadow: { kind: "farm", theme: "farm", maxShift: 70 },
    },
    compounds: { count: 36, themes: ["farm", "ruin"], weights: [3, 2] },
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
function fitArch(rng, key, fw, fd, minFloors) {
  const A = ARCH[key];
  const fit = A.dims.filter((dm) => dm[0] <= fw + 1e-6 && dm[1] <= fd + 1e-6);
  if (!fit.length) return null;
  fit.sort((p, q) => q[0] * q[1] - p[0] * p[1]);
  const dm = fit[Math.min(fit.length - 1, rng() < 0.6 ? 0 : 1)];
  const cap = Math.min(MAX_FLOORS, maxFloorsFor(dm[0], dm[1]));
  let fl = A.floors.filter((f) => f <= cap);
  if (!fl.length) fl = [1];
  if (minFloors && Math.max(...fl) < minFloors) return null;
  const floors = A.floors.length > 1 ? fl[Math.floor(rng() * fl.length)] : fl[0];
  return { key, w: dm[0], d: dm[1], floors, fh: A.fh, use: A.use, gen: A.gen };
}
/** place a building of dims (w, d) in a parcel rect facing (fx, fz), pushed to the street side; returns the building frame */
function placeBuilding(rect, fx, fz, w, d) {
  const turn = turnOf(fx, fz);
  let cx, cz;
  if (fz > 0) { cz = rect[3] - FRONT_SETBACK - d / 2; cx = (rect[0] + rect[2]) / 2; }
  else if (fz < 0) { cz = rect[1] + FRONT_SETBACK + d / 2; cx = (rect[0] + rect[2]) / 2; }
  else if (fx > 0) { cx = rect[2] - FRONT_SETBACK - d / 2; cz = (rect[1] + rect[3]) / 2; }
  else { cx = rect[0] + FRONT_SETBACK + d / 2; cz = (rect[1] + rect[3]) / 2; }
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
  const frame = placeBuilding(rect, fx, fz, fit.w, fit.d);
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
function makeShellParcel(S, rng, pid, blockId, rect, fx, fz, kit, theme) {
  const frame = placeBuilding(rect, fx, fz, kit[1], kit[2]);
  const bb = aabbOf(frame, kit[1], kit[2]);
  return {
    id: pid, block: blockId, use: "shell", rect: [r3(rect[0]), r3(rect[1]), r3(rect[2]), r3(rect[3])], facing: [fx, fz],
    building: {
      cx: r3(frame.cx), cz: r3(frame.cz), w: kit[1], d: kit[2], turn: frame.turn, rot: ROT[frame.turn], facing: FACE[frame.turn].slice(),
      aabb: [r3(bb[0]), r3(bb[1]), r3(bb[2]), r3(bb[3])], gen: "shell", arch: "shell", kit: kit[0], floors: 0, visualHeight: kit[3], height: kit[3],
      enterable: false, palette: paletteFor(rng, theme, kit[0].indexOf("suburban") < 0), ground: groundOf(S, bb[0], bb[1], bb[2], bb[3]),
    },
  };
}
function makeLotParcel(pid, blockId, rect, fx, fz, rng) {
  return { id: pid, block: blockId, use: "lot", lot: pick(rng, ["parking", "park", "yard"]), rect: [r3(rect[0]), r3(rect[1]), r3(rect[2]), r3(rect[3])], facing: [fx, fz], building: null };
}
/** assign every parcel of one block */
function fillBlock(S, rng, blk, theme, kind, shellBudgetLeft, idBase, out) {
  const mix = mixFor(theme, kind);
  const bx0 = blk.cx - PARCEL_HALF, bz0 = blk.cz - PARCEL_HALF, bx1 = blk.cx + PARCEL_HALF, bz1 = blk.cz + PARCEL_HALF;
  const nTarget = kind === "core" ? rint(rng, 3, 4) : kind === "yard" ? rint(rng, 4, 6) : kind === "village" ? rint(rng, 6, 8) : rint(rng, 5, 8);
  const minSide = kind === "core" ? 14 : kind === "yard" ? 13 : 12;
  const rects = splitBlock(rng, bx0, bz0, bx1, bz1, nTarget, minSide, kind === "core");
  const items = rects.map((r) => {
    const f = parcelFacing(rng, r, bx0, bz0, bx1, bz1);
    return { rect: r, fx: f[0], fz: f[1], area: (r[2] - r[0]) * (r[3] - r[1]) };
  });
  // shells: the largest parcels first (skyline), only up to the layout's remaining budget
  const shellW = mix.shell || 0, totW = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  const wantShell = Math.min(shellBudgetLeft.n, Math.round(items.length * shellW / totW + (rng() < (items.length * shellW / totW) % 1 ? 0.5 : 0)));
  const bySize = items.map((it, i) => i).sort((a, b) => items[b].area - items[a].area || a - b);
  const shellKits = SHELLS[(kind === "core" ? "skyline" : (THEMES[theme] || THEMES.city).shell === "skyline" ? "mid" : (THEMES[theme] || THEMES.city).shell)];
  const taken = new Set();
  let nShell = 0;
  for (const i of bySize) {
    if (nShell >= wantShell) break;
    const it = items[i], [fw, fd] = room(it.rect, it.fx, it.fz);
    const kits = shellKits.filter((k) => k[1] <= fw + 1e-6 && k[2] <= fd + 1e-6);
    if (!kits.length) continue;
    const kit = kits[Math.floor(rng() * kits.length)];
    it.shell = kit; taken.add(i); nShell++;
  }
  shellBudgetLeft.n -= nShell;
  const keys = Object.keys(mix).filter((k) => k !== "lot" && k !== "shell" && mix[k] > 0);
  let order = 0;
  for (const it of items) {
    const pid = idBase + order++;
    const id = "p" + pid;
    if (it.shell) { out.parcels.push(makeShellParcel(S, rng, id, blk.id, it.rect, it.fx, it.fz, it.shell, theme)); continue; }
    const [fw, fd] = room(it.rect, it.fx, it.fz);
    let fit = null;
    if (mix.lot && rng() * (totW - (mix.shell || 0)) < mix.lot) fit = null;
    else {
      const pool = keys.slice();
      while (pool.length && !fit) {
        const k = wpick(rng, pool, (q) => mix[q]);
        pool.splice(pool.indexOf(k), 1);
        fit = fitArch(rng, k, fw, fd);
      }
      if (!fit) fit = fitArch(rng, "shed", fw, fd);
    }
    if (!fit) { out.parcels.push(makeLotParcel(id, blk.id, it.rect, it.fx, it.fz, rng)); continue; }
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
  const estimate = L.blocks.length * (kind === "core" ? 3.5 : kind === "yard" ? 4 : 6);
  budget.n = Math.floor(estimate * MAX_SHELL_SHARE * 0.8);
  for (const b of L.blocks) {
    const brng = subRng(seed, poi.id, "blk" + b.i + "," + b.j);
    pcount += fillBlock(S, brng, b, theme, kind, budget, pcount, holder);
  }
  settleShares(S, L, theme);
  attachStreets(L);
  for (const p of L.parcels) if (p.building) L.pads.push(padOf(p));
  L.centre = centreOf(L);
  L.stats = summarize(L);
  return L;
}
const HARD_SHIFT = 260;                                    // m: how far a layout may move from its POI centre when the POI sits on water (maps.js snaps inland POIs up to 260 m)
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
      if (p.use === "lot" || p.use === "shell") if (convertToEnterable(S, L, p, theme)) n++;
    }
  }
}
function convertToEnterable(S, L, p, theme) {
  const rng = subRng(L.seed, L.id, p.id + "x");
  const [fx, fz] = p.facing, [fw, fd] = room(p.rect, fx, fz);
  let fit = null;
  for (const k of ["house_m", "shop", "house_s", "cabin", "shed"]) { fit = fitArch(rng, k, fw, fd); if (fit) break; }
  if (!fit) return false;
  // remove an old shell's (nonexistent) interior; rebuild as an enterable building in the same parcel
  const made = makeBuildingParcel(S, rng, p.id, p.block, p.rect, fx, fz, fit, theme);
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, made.parcel);
  L.rooms.push(...made.inter.rooms); L.doors.push(...made.inter.doors); L.stairs.push(...made.inter.stairs);
  return true;
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
  const house = () => (rng() < 0.55 ? "house_s" : "house_m");
  const dimsOf = (key, maxW) => {
    const A = ARCH[key], fit = A.dims.filter((dm) => dm[0] <= maxW + 1e-6);
    const dm = fit.length ? fit[Math.floor(rng() * fit.length)] : A.dims[0];
    return { key, w: dm[0], d: dm[1], floors: 1, fh: A.fh, use: A.use, gen: A.gen };
  };
  const spec = { yw: 24, yd: 14, rows: { N: [], S: [], E: [], W: [] }, fields: 0, fence: true, silo: false, cars: 2 };
  if (kind === "compound") {
    const nH = rint(rng, 2, 4);
    const order = ["N", "S", "N", "S"];
    for (let k = 0; k < nH; k++) spec.rows[order[k]].push(dimsOf(house(), 10));
    spec.rows[rng() < 0.5 ? "W" : "E"].push(dimsOf("shed", 12));
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
  const spec = yardItems(subRng(seed, poi.id, "items"), kind, theme, { lane });
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
  const crng = subRng(seed, poi.id, "cars");
  for (let k = 0; k < spec.cars; k++) {
    const cx = rrange(crng, yard[0] + 3, yard[2] - 3), cz = rrange(crng, yard[1] + 2, yard[3] - 2);
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
  const foot = townFootprints(towns), boxes = enterableBoxes(towns);
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
  for (let k = 0; k < N; k++) {
    dbox[k] = Math.sqrt(dbox[k]);
    if (Math.sqrt(dtown[k]) < COMPOUND_MIN_TOWN) { ok[k] = 0; continue; }
    if (!dry40) { ok[k] = 1; continue; }
    const i = k % n, j = (k - i) / n, i0 = i & ~1, j0 = j & ~1, i1 = Math.min(n - 1, i0 + 2) & ~1, j1 = Math.min(n - 1, j0 + 2) & ~1;
    ok[k] = dry40[j0 * n + i0] && dry40[j0 * n + i1] && dry40[j1 * n + i0] && dry40[j1 * n + i1] ? 1 : (dryAt(i, j) ? 1 : 0);
  }
  const trng = subRng(seed, mapId + ":compounds", "theme");
  const sites = [];
  let examined = 0, rejected = 0;
  const bad = new Uint8Array(N);
  while (sites.length < count && examined < count * 6 + 60) {
    let bk = -1, bd = 0;
    for (let k = 0; k < N; k++) if (ok[k] && !bad[k] && dbox[k] > bd) { bd = dbox[k]; bk = k; }
    if (bk < 0 || bd < minGap) break;
    examined++;
    const x = gx[bk], z = gz[bk];
    const reg = scan(S, x - 26, x + 26, z - 26, z + 26, 4);
    if (reg.lo < wetMin || reg.hi - reg.lo > 6.5) { bad[bk] = 1; rejected++; continue; }
    const idx = sites.length;
    const theme = themes[(() => { const t = wpick(trng, themes.map((q, i) => i), (i) => weights[i] != null ? weights[i] : 1); return t; })()];
    const L = layout(seed, { id: "cmp" + (idx < 10 ? "0" : "") + idx, x, z, r: 30 }, S, waterY, theme, { kind: "compound", fixed: true });
    if (L.stats.enterable < 3) { bad[bk] = 1; rejected++; continue; }
    sites.push(L);
    const nb = enterableBoxes([L]);
    for (const b of nb) {
      const i0 = Math.max(0, Math.ceil((b[0] - CAP + REACH) / G)), i1 = Math.min(n - 1, Math.floor((b[2] + CAP + REACH) / G));
      const j0 = Math.max(0, Math.ceil((b[1] - CAP + REACH) / G)), j1 = Math.min(n - 1, Math.floor((b[3] + CAP + REACH) / G));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * n + i, q = rectDist(gx[k], gz[k], b); if (q < dbox[k]) dbox[k] = q; }
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
  if (T.blocks.length && T.roads.portals.length) return T.roads.portals.map((p) => ({ x: T.roads.nodes[p.node].x, z: T.roads.nodes[p.node].z, dx: p.dx, dz: p.dz }));
  if (T.compound && T.parcels.length) return [{ x: T.compound.entry.x, z: T.compound.entry.z, dx: 0, dz: 0 }];
  return [];
}
function townCentre(T) {
  if (T.blocks.length) { let x = 0, z = 0; for (const b of T.blocks) { x += b.cx; z += b.cz; } return [x / T.blocks.length, z / T.blocks.length]; }
  if (T.compound && T.parcels.length) return [T.compound.entry.x, T.compound.entry.z];
  return [T.poi.x, T.poi.z];
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

/** Every POI of one map + the compound fill + the POI links, in one call. `pois` = the map's (already land-snapped) POI list, e.g. maps.js `pois`
 *  ({ id, x, z, r }); omitted = the authored table. */
export function layoutMap(seed, mapId, pois, heightFn, waterY, opts) {
  opts = opts || {};
  const S = asSampler(heightFn);
  pois = pois || defaultPois(mapId);
  const avoid = [];                                       // footprints of the towns laid out so far: a later town that has to move (a POI on water) never lands on them
  const towns = pois.map((p) => {
    const plan = planFor(mapId, p);
    const L = layout(seed, p, S, waterY, plan.theme, Object.assign({}, plan, { avoid: avoid.slice() }));
    for (const b of L.blocks) avoid.push([b.cx - HP, b.cz - HP, b.cx + HP, b.cz + HP]);
    if (L.compound && L.parcels.length) avoid.push(L.compound.bounds);
    return L;
  });
  const comp = opts.compounds === false ? { sites: [], stats: { examined: 0, rejected: 0, placed: 0 } } : placeCompounds(seed, mapId, towns, S, waterY, opts.compound || {});
  const links = opts.links === false ? [] : buildLinks(towns, S, waterY);
  const all = towns.concat(comp.sites);
  const ent = all.reduce((a, T) => a + T.stats.enterable, 0), bld = all.reduce((a, T) => a + T.stats.buildings, 0);
  return { v: VERSION, mapId, seed, towns, compounds: comp.sites, links, stats: { towns: towns.length, compounds: comp.sites.length, enterable: ent, buildings: bld, compoundFill: comp.stats } };
}

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

// tables the selftest (and Wave 7 / lane 6C) read: the shell kit sizes (checked against the manifest), archetypes, themes, mixes
export { SHELLS as SHELL_KITS, ARCH as ARCHETYPES, THEMES, MIX, POI_TABLE };
