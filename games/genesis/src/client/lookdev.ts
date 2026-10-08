// GENESIS — lookdev: a LOCAL fabricator of planet data for developing and screenshotting the renderer without the sim.
//
// `?source=lookdev` (or a missing / broken sim worker) uses this instead of src/sim/worker.ts. It builds a small
// system — a G star, a terran home world with continents, ridged ranges, eroded valleys, rivers, lakes, beaches,
// deserts, snowcaps, sea ice, forests, farms around three towns joined by roads, and a live cloud field with storm
// spirals; an airless cratered moon; a red dusty desert world; an airless barren inner world — and serves it through
// the same SimBackend interface the worker uses (Snapshot / CommandResult). Time, speed, step and a few lookdev
// commands work (time.set-hour, planet.atmosphere, planet.cloudiness); everything else answers "no sim here".
//
// It is deliberately NOT the sim: no determinism guarantees, no agents. It only has to look like a living world.

import type {
  AtmosphereParams, Command, CommandResult, FieldName, OrbitParams, PlanetParams, PlanetSnap, Snapshot, StarView,
} from '../sim/types.ts';
import { TICKS_PER_SECOND_1X } from '../sim/types.ts';
import { getGrid, type IcoGrid } from '../sim/grid/icogrid.ts';
import { Noise3 } from '../sim/grid/noise.ts';
import { Rng, hashFloat } from '../sim/core/rng.ts';
import { blackbody, orbitOffset, orbitPlaneQuat, qAxis, qMul, qRotateInv, type D3, type DQ } from './orbits.ts';
import type { SimBackend, SnapshotSink } from './simclient.ts';

type Fields = Partial<Record<FieldName, Float32Array>>;

interface LookPlanet {
  snap: PlanetSnap;
  fields: Fields;
  /** fields changed since the last snapshot */
  dirty: Set<FieldName>;
  cloudGen: ((t: number) => void) | null;
  spin0: number;
  cloudTick: number;
}

// ───────────────────────────────── helpers ─────────────────────────────────

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** binary min-heap of cell ids keyed by a float array */
class CellHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(cap: number) { this.ids = new Int32Array(cap); this.keys = new Float64Array(cap); }
  push(id: number, key: number): void {
    if (this.size >= this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2); ni.set(this.ids); this.ids = ni;
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.ids[i] = lastId; this.keys[i] = lastKey;
    return top;
  }
}

/** Priority-flood depression filling (Barnes 2014): returns the spill level of every cell (≥ h). Seeds: cells < seaLevel. */
function priorityFlood(g: IcoGrid, h: Float32Array, sea: number): Float32Array {
  const N = g.count;
  const filled = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new CellHeap(N);
  let seeded = 0;
  for (let c = 0; c < N; c++) {
    if (h[c] < sea) { filled[c] = h[c]; done[c] = 1; heap.push(c, h[c]); seeded++; }
  }
  if (!seeded) { // no ocean: seed the lowest cell
    let lo = 0;
    for (let c = 1; c < N; c++) if (h[c] < h[lo]) lo = c;
    filled[lo] = h[lo]; done[lo] = 1; heap.push(lo, h[lo]);
  }
  while (heap.size) {
    const c = heap.pop();
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (done[o]) continue;
      done[o] = 1;
      // epsilon slope so every filled flat still drains
      filled[o] = Math.max(h[o], filled[c] + 1e-3);
      heap.push(o, filled[o]);
    }
  }
  return filled;
}

/** steepest-descent receiver of every cell on the filled surface (-1 = sink / ocean) */
function receivers(g: IcoGrid, filled: Float32Array, sea: number): Int32Array {
  const N = g.count;
  const rcv = new Int32Array(N).fill(-1);
  for (let c = 0; c < N; c++) {
    if (filled[c] < sea) continue;
    let best = -1, bestH = filled[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (filled[o] < bestH) { bestH = filled[o]; best = o; }
    }
    rcv[c] = best;
  }
  return rcv;
}

/** drainage area (in cells) by sorting high → low */
function accumulate(g: IcoGrid, filled: Float32Array, rcv: Int32Array, rain: Float32Array | null): Float32Array {
  const N = g.count;
  const order = new Int32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const ord = Array.from(order).sort((a, b) => filled[b] - filled[a]);
  const acc = new Float32Array(N);
  for (let i = 0; i < N; i++) acc[i] = rain ? rain[i] : 1;
  for (const c of ord) { const r = rcv[c]; if (r >= 0) acc[r] += acc[c]; }
  return acc;
}

/** graph distance (in cells) from every cell to the nearest cell where `src` is true (BFS) */
function distanceFrom(g: IcoGrid, src: (c: number) => boolean, cap = 1e9): Float32Array {
  const N = g.count;
  const d = new Float32Array(N).fill(cap);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let c = 0; c < N; c++) if (src(c)) { d[c] = 0; q[qt++] = c; }
  while (qh < qt) {
    const c = q[qh++];
    const nd = d[c] + 1;
    if (nd >= cap) continue;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (d[o] > nd) { d[o] = nd; q[qt++] = o; }
    }
  }
  return d;
}

function newFields(N: number, names: FieldName[]): Fields {
  const f: Fields = {};
  for (const n of names) f[n] = new Float32Array(N);
  return f;
}

const ALL_FIELDS: FieldName[] = [
  'surface', 'rock', 'soil', 'sand', 'ash', 'snow', 'ice', 'lava', 'water', 'flowX', 'flowY', 'flowZ', 'temperature',
  'moisture', 'humidity', 'wetness', 'fertility', 'salinity', 'grass', 'shrub', 'tree', 'crop', 'treeSpecies',
  'shrubSpecies', 'cropSpecies', 'fire', 'burnt', 'road', 'biome', 'cloud', 'precip', 'precipType', 'ore', 'oreType',
  'territory', 'pollution', 'blight', 'radiation',
];

/** lookdev biome ids (the sim's content order may differ; the renderer never relies on these numbers) */
const B = { ocean: 0, coast: 2, ice: 3, tundra: 4, taiga: 5, grassland: 6, forest: 7, rainforest: 8, wetland: 9, desert: 10, dune: 11, scrub: 12, mountain: 13, barren: 15, savanna: 16, steppe: 17 } as const;

// ───────────────────────────────── worlds ─────────────────────────────────

function atmo(over: Partial<AtmosphereParams>): AtmosphereParams {
  return { pressure: 1, o2: 0.21, co2: 0.0004, n2: 0.78, methane: 0, dust: 0.02, tint: null, toxicity: 0, ...over };
}

function params(over: Partial<PlanetParams> & { orbit: OrbitParams; radius: number }): PlanetParams {
  return {
    gravity: 9.8, dayHours: 24, axialTilt: 0.41, spin: 0, sunFrozen: false, seasonPinned: null, seaLevel: 0,
    magnetism: 1, atmosphere: atmo({}), cloudiness: 0.5, globalWeather: null, kind: 'terran', year: 1, dayOfYear: 0,
    yearDays: 12, hourAtLon0: 0, ...over,
  };
}

/** The terran home world. */
function genTerran(id: number, name: string, seed: number, n: number, radius: number, orbit: OrbitParams): LookPlanet {
  const g = getGrid(n);
  const N = g.count;
  const nz = new Noise3(seed * 7 + 1013);
  const rng = new Rng(seed);
  const f = newFields(N, ALL_FIELDS);
  const h = new Float32Array(N);
  const P = g.pos;
  // spacing of cells in metres (for slopes)
  const cellM = g.meanEdgeAngle * radius;

  // 1. macro relief: warped continents, shelves, ridged ranges along belts, hills
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const cont = nz.warped(x * 1.25 + 3.1, y * 1.25, z * 1.25 - 1.7, 0.75, 5) + 0.12 * nz.fbm(x * 3.2, y * 3.2, z * 3.2, 3) - 0.04;
    let e: number;
    if (cont > 0) {
      const land = cont;
      const belt = smooth(0.05, 0.45, nz.fbm(x * 1.6 + 9.3, y * 1.6 - 2.2, z * 1.6 + 4.4, 3) + 0.15);
      // ranges: broad massifs (smooth fbm) carved by ridged crests — mountains with shoulders, not needles
      const ridge = nz.ridged(x * 2.4 + 1.1, y * 2.4, z * 2.4 - 5.3, 4);
      const massif = 0.5 + 0.5 * nz.fbm(x * 3.1 - 2.0, y * 3.1 + 5.0, z * 3.1, 3);
      const hills = nz.fbm(x * 6.5, y * 6.5 + 7.7, z * 6.5, 3);
      e = 4 + 190 * Math.pow(land, 1.3) + 24 * hills * smooth(0.0, 0.2, land)
        + 340 * belt * (0.5 * Math.pow(ridge, 1.7) + 0.5 * massif * ridge) * smooth(0.02, 0.22, land);
    } else {
      const s = -cont;
      e = -(3 + 22 * smooth(0.0, 0.06, s) + 95 * smooth(0.05, 0.35, s) + 40 * nz.fbm(x * 4, y * 4, z * 4, 2) * smooth(0.1, 0.4, s));
    }
    h[c] = e;
  }

  // 2. fluvial carving: a few passes of drainage-area-driven incision give dendritic valleys and river beds
  for (let pass = 0; pass < 4; pass++) {
    const filled = priorityFlood(g, h, 0);
    const rcv = receivers(g, filled, 0);
    const acc = accumulate(g, filled, rcv, null);
    for (let c = 0; c < N; c++) {
      if (h[c] <= 0.5) continue;
      const r = rcv[c];
      if (r < 0) continue;
      const slope = Math.max(0, (filled[c] - filled[r]) / cellM);
      const cut = Math.min(14, 2.2 * Math.sqrt(acc[c]) * Math.min(1.2, slope * 6 + 0.15));
      h[c] = Math.max(0.6, h[c] - cut * 0.5);
    }
    // smooth valley walls a little (thermal creep): pull each land cell toward its neighbour mean
    const tmp = Float32Array.from(h);
    for (let c = 0; c < N; c++) {
      if (h[c] <= 0) continue;
      let s = 0, k = 0;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { s += h[g.nbr[e]]; k++; }
      tmp[c] = h[c] * 0.8 + (s / k) * 0.2;
      if (tmp[c] < 0.6 && h[c] > 0) tmp[c] = 0.6;
    }
    h.set(tmp);
  }

  // 3. hydrology: oceans, lakes (depressions), rivers (drainage area), flow vectors
  const filled = priorityFlood(g, h, 0);
  const rcv = receivers(g, filled, 0);
  const lat = g.lat;
  const ocean = (c: number) => h[c] < 0;
  const distOcean = distanceFrom(g, ocean, 64);
  // climate first pass (rain drives river discharge)
  const T = f.temperature!, M = f.moisture!;
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const sl = Math.abs(Math.sin(lat[c]));
    const alt = Math.max(0, h[c]);
    T[c] = 29 - 50 * Math.pow(sl, 1.35) - 0.082 * alt + 3.5 * nz.fbm(x * 2.5 + 11, y * 2.5, z * 2.5, 3);
    const hadley = 0.5 + 0.32 * Math.cos(6 * lat[c]);
    const coastal = Math.exp(-distOcean[c] / 9);
    M[c] = clamp01(0.5 * hadley + 0.42 * coastal + 0.22 * nz.fbm(x * 3 - 4, y * 3, z * 3 + 2, 3) + (h[c] > 160 ? 0.08 : 0));
    if (h[c] < 0) M[c] = 1;
  }
  const rain = new Float32Array(N);
  for (let c = 0; c < N; c++) rain[c] = 0.25 + M[c] * 1.5;
  const acc = accumulate(g, filled, rcv, rain);
  const W = f.water!, FX = f.flowX!, FY = f.flowY!, FZ = f.flowZ!;
  const RIVER = 60;
  const riverCell = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    if (h[c] < 0) { W[c] = -h[c]; continue; }
    const lake = filled[c] - h[c];
    if (lake > 0.8) { W[c] = lake; riverCell[c] = 2; continue; }
    if (acc[c] > RIVER && rcv[c] >= 0) {
      const q = acc[c];
      const depth = Math.min(4.5, 0.6 + 0.5 * Math.log(q / RIVER + 1) * 2.2);
      W[c] = depth;
      riverCell[c] = 1;
      // carve the bed so the river sits in its channel
      h[c] = Math.max(0.3, h[c] - depth * 0.85);
    }
  }
  // flow vectors along the drainage (rivers fast, lakes still, ocean currents gentle zonal drift)
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    if (riverCell[c] === 1) {
      const r = rcv[c];
      let dx = P[r * 3] - x, dy = P[r * 3 + 1] - y, dz = P[r * 3 + 2] - z;
      const d = dx * x + dy * y + dz * z;
      dx -= x * d; dy -= y * d; dz -= z * d;
      const l = Math.hypot(dx, dy, dz) || 1;
      const drop = Math.max(0, filled[c] - filled[r]);
      const speedMs = Math.min(4.5, 0.6 + Math.sqrt(drop) * 0.9); // m/s
      const s = (speedMs * 60) / l; // m/tick
      FX[c] = dx * s; FY[c] = dy * s; FZ[c] = dz * s;
    } else if (h[c] < 0) {
      // east-west current: east = (z, 0, -x)
      const el = Math.hypot(z, x) || 1;
      const band = Math.sin(lat[c] * 3);
      const sp = 0.25 * 60 * band;
      FX[c] = (z / el) * sp; FY[c] = 0; FZ[c] = (-x / el) * sp;
    }
  }

  // 4. surface materials and cover
  const S = f.surface!, R = f.rock!, SOIL = f.soil!, SAND = f.sand!, SNOW = f.snow!, ICE = f.ice!;
  const GR = f.grass!, SH = f.shrub!, TR = f.tree!, CR = f.crop!, ROAD = f.road!, WET = f.wetness!;
  const HUM = f.humidity!, FERT = f.fertility!, SAL = f.salinity!, BIO = f.biome!, TS = f.treeSpecies!, SS = f.shrubSpecies!, CS = f.cropSpecies!;
  const distWater = distanceFrom(g, (c) => W[c] > 0.3, 12);
  // slope per cell (max neighbour drop / spacing)
  const slope = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    let m = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) m = Math.max(m, Math.abs(h[g.nbr[e]] - h[c]));
    slope[c] = m / cellM;
  }
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const land = h[c] >= 0;
    const t = T[c], m = M[c];
    let sand = 0, snow = 0, soil = 0, ice = 0;
    if (land) {
      // beaches: low land near the sea; dunes in hot dry interiors
      if (distOcean[c] <= 2 && h[c] < 7 && slope[c] < 0.18) sand = 0.9 + 0.8 * hashFloat(c, 3);
      if (m < 0.3 && t > 13) sand = Math.max(sand, (0.3 - m) * 9 * (0.6 + 0.8 * nz.ridged(x * 18, y * 18, z * 18, 2)));
      soil = Math.max(0, (1.7 - slope[c] * 5) * (0.35 + m)) * (t > -6 ? 1 : 0.3);
      if (t < -1.5) snow = Math.min(3.2, (-1.5 - t) * 0.35 + 0.15) * (slope[c] > 0.9 ? 0.4 : 1);
      // seasonal dusting on high ground
      if (t < 2 && h[c] > 220) snow = Math.max(snow, 0.25);
    } else if (t < -5) {
      ice = Math.min(3, (-5 - t) * 0.25 + 0.4);
    }
    sand = Math.min(sand, 6);
    SAND[c] = sand; SNOW[c] = snow; SOIL[c] = soil; ICE[c] = ice;
    S[c] = h[c];
    R[c] = h[c] - sand - snow - soil - ice;
    HUM[c] = m;
    SAL[c] = land ? (m < 0.15 && t > 18 ? 0.4 : 0) : 1;
    WET[c] = land ? clamp01((distWater[c] <= 1 ? 0.65 : 0) + m * 0.35 - (sand > 1 ? 0.3 : 0)) : 1;
    if (!land) { BIO[c] = ice > 0 ? B.ice : B.ocean; continue; }
    // vegetation by climate (functional types)
    const warm = smooth(-6, 4, t) * (1 - smooth(31, 40, t));
    const bare = clamp01(sand / 1.2) * 0.9 + clamp01(snow / 0.3);
    const lush = clamp01(1 - bare) * warm * (1 - smooth(0.9, 1.6, slope[c]));
    const forestN = nz.fbm(x * 9 + 2, y * 9, z * 9 - 3, 3);
    GR[c] = clamp01(lush * smooth(0.12, 0.45, m) * (0.85 + 0.3 * forestN));
    TR[c] = clamp01(lush * smooth(0.46, 0.7, m + 0.22 * forestN) * (1 - smooth(260, 330, h[c])));
    SH[c] = clamp01(lush * smooth(0.25, 0.5, m) * (1 - TR[c]) * (0.4 + 0.6 * nz.fbm(x * 14, y * 14, z * 14, 2) + 0.4));
    TS[c] = t < 6 ? 1 : t > 24 && m > 0.75 ? 3 : 0; // 0 broadleaf, 1 conifer, 3 tropical
    SS[c] = m < 0.35 ? 1 : 0;
    FERT[c] = clamp01(m * 0.7 + soil * 0.2);
    BIO[c] = snow > 0.5 ? (h[c] > 200 ? B.mountain : B.tundra)
      : sand > 1.2 ? (m < 0.2 ? B.dune : B.desert)
      : TR[c] > 0.55 ? (t > 22 && m > 0.75 ? B.rainforest : t < 6 ? B.taiga : B.forest)
      : h[c] > 260 ? B.mountain
      : m < 0.3 ? (t > 20 ? B.savanna : B.steppe)
      : distOcean[c] <= 1 ? B.coast : B.grassland;
  }

  // 5. towns: flat, temperate, watered land; farms in patches around them; roads between them (A* on slope)
  const towns: number[] = [];
  const cand: number[] = [];
  for (let c = 0; c < N; c++) {
    if (h[c] < 3 || h[c] > 120 || slope[c] > 0.12 || T[c] < 6 || T[c] > 27 || M[c] < 0.38 || W[c] > 0.2) continue;
    if (distWater[c] > 3) continue;
    cand.push(c);
  }
  rng.shuffle(cand);
  for (const c of cand) {
    if (towns.length >= 3) break;
    let ok = true;
    for (const t of towns) {
      const d = P[c * 3] * P[t * 3] + P[c * 3 + 1] * P[t * 3 + 1] + P[c * 3 + 2] * P[t * 3 + 2];
      if (d > Math.cos(0.32)) ok = false;
    }
    if (ok) towns.push(c);
  }
  for (const t of towns) {
    const ring = g.cellsWithin(P[t * 3], P[t * 3 + 1], P[t * 3 + 2], 0.06);
    for (const c of ring) {
      if (h[c] < 1 || W[c] > 0.2 || slope[c] > 0.2) continue;
      const patch = hashFloat(Math.floor(P[c * 3] * 60), Math.floor(P[c * 3 + 1] * 60), Math.floor(P[c * 3 + 2] * 60), 77);
      if (patch < 0.72) {
        CR[c] = 0.55 + 0.45 * hashFloat(c, 5);
        CS[c] = Math.floor(hashFloat(c, 9) * 4);
        TR[c] *= 0.1; SH[c] *= 0.3; GR[c] = Math.max(GR[c] * 0.6, 0.3);
      }
    }
    // the town core: worn ground
    const core = g.cellsWithin(P[t * 3], P[t * 3 + 1], P[t * 3 + 2], 0.012);
    for (const c of core) { ROAD[c] = Math.max(ROAD[c], 0.55); TR[c] = 0; CR[c] = 0; }
  }
  const roadPath = (a: number, b: number) => {
    const cost = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const heap = new CellHeap(1024);
    cost[a] = 0; heap.push(a, 0);
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    while (heap.size) {
      const c = heap.pop();
      if (c === b) break;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        const wet = W[o] > 0.3 ? (riverCell[o] === 1 ? 8 : 400) : 0;
        const st = cost[c] + 1 + slope[o] * 30 + wet + (h[o] > 200 ? 4 : 0);
        if (st < cost[o]) {
          cost[o] = st; from[o] = c;
          const dd = Math.acos(Math.min(1, P[o * 3] * bx + P[o * 3 + 1] * by + P[o * 3 + 2] * bz)) / g.meanEdgeAngle;
          heap.push(o, st + dd);
        }
      }
    }
    for (let c = b; c >= 0 && c !== a; c = from[c]) {
      ROAD[c] = Math.max(ROAD[c], 0.85);
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) ROAD[g.nbr[e]] = Math.max(ROAD[g.nbr[e]], 0.25);
      TR[c] *= 0.2;
    }
  };
  for (let i = 1; i < towns.length; i++) roadPath(towns[i - 1], towns[i]);

  // 6. clouds: zonal bands + noise + spiral storms, regenerated as time passes (drift with the trade winds)
  const storms: { p: D3; r: number; s: number; w: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const la = (rng.chance(0.5) ? 1 : -1) * rng.range(0.25, 0.85);
    const lo = rng.range(-Math.PI, Math.PI);
    storms.push({ p: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)], r: rng.range(0.16, 0.26), s: la > 0 ? 1 : -1, w: rng.range(0.7, 1) });
  }
  const CL = f.cloud!, PR = f.precip!, PT = f.precipType!;
  const cloudGen = (tick: number) => {
    const drift = tick * 0.00006;
    for (let c = 0; c < N; c++) {
      const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      const la = lat[c];
      // zonal climatology: ITCZ, dry subtropics, stormy mid-latitudes, polar
      const zonal = 0.42 + 0.22 * Math.cos(la * 6) + 0.12 * Math.cos(la * 2);
      const ca = Math.cos(drift), sa = Math.sin(drift);
      const rx = x * ca + z * sa, rz = -x * sa + z * ca;
      // large systems + frontal bands (ridged) + popcorn cumulus breakup
      const front = Math.pow(nz.ridged(rx * 2.2 + 13, y * 2.2, rz * 2.2 - 7, 3), 3);
      const cells = nz.fbm(rx * 16 + 3, y * 16, rz * 16 - 5, 2);
      let cov = zonal + 0.5 * nz.fbm(rx * 3.4 + 40, y * 3.4, rz * 3.4, 4) + 0.35 * front + 0.2 * cells;
      for (const st of storms) {
        const d = x * st.p[0] + y * st.p[1] + z * st.p[2];
        const ang = Math.acos(Math.min(1, d));
        if (ang > st.r * 2.2) continue;
        // spiral arms in the storm's tangent frame
        let ex = st.p[2], ez = -st.p[0];
        const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
        const nx = st.p[1] * ez, ny = st.p[2] * ex - st.p[0] * ez, nzz = -st.p[1] * ex;
        const u = x * ex + z * ez, v = x * nx + y * ny + z * nzz;
        const th = Math.atan2(v, u) * st.s;
        const rr = ang / st.r;
        const arms = 0.5 + 0.5 * Math.cos(2 * th - Math.log(rr + 0.05) * 5.5 + tick * 0.0004);
        const eye = smooth(0.04, 0.12, rr);
        cov += st.w * Math.exp(-rr * rr * 1.1) * (0.35 + 0.75 * arms) * eye - 0.25 * (1 - eye) * Math.exp(-rr * 4);
      }
      const cv = clamp01((cov - 0.6) * 2.1);
      CL[c] = cv;
      PR[c] = cv > 0.72 ? (cv - 0.72) * 12 : 0;
      PT[c] = PR[c] > 0 ? (T[c] < 0 ? 2 : 1) : 0;
    }
  };
  cloudGen(0);

  const snap: PlanetSnap = {
    id, name, gridN: n, seed, alive: true, fieldVersion: 1,
    params: params({ radius, orbit, kind: 'terran', axialTilt: 0.41, cloudiness: 0.55, magnetism: 1 }),
  };
  return { snap, fields: f, dirty: new Set(ALL_FIELDS), cloudGen, spin0: 0, cloudTick: 0 };
}

/** craters into a height array (bowl + rim + ejecta), returns nothing */
function craterize(g: IcoGrid, h: Float32Array, rng: Rng, count: number, radius: number, maxAngle: number): void {
  const P = g.pos;
  for (let i = 0; i < count; i++) {
    const u = rng.float() * 2 - 1, th = rng.float() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const cx = s * Math.cos(th), cy = u, cz = s * Math.sin(th);
    // power-law sizes: many small, few large
    const a = maxAngle * Math.pow(rng.float(), 2.6) + g.meanEdgeAngle * 1.2;
    const depth = a * radius * 0.19;
    const cells = g.cellsWithin(cx, cy, cz, a * 2.2);
    for (const c of cells) {
      const d = Math.acos(Math.min(1, P[c * 3] * cx + P[c * 3 + 1] * cy + P[c * 3 + 2] * cz)) / a;
      let dh: number;
      if (d < 1) dh = -depth * (1 - d * d) + depth * 0.22 * smooth(0.65, 1, d);
      else dh = depth * 0.22 * Math.exp(-(d - 1) * (d - 1) * 6) - 0.0 * depth;
      // central peak in big craters
      if (a > maxAngle * 0.35 && d < 0.18) dh += depth * 0.35 * (1 - d / 0.18);
      h[c] += dh;
    }
  }
}

/** An airless cratered world (barren / moon). `maria` adds dark basalt plains. */
function genBarren(id: number, name: string, seed: number, n: number, radius: number, orbit: OrbitParams, kind: string, maria: boolean): LookPlanet {
  const g = getGrid(n);
  const N = g.count;
  const nz = new Noise3(seed * 13 + 77);
  const rng = new Rng(seed + 5);
  const f = newFields(N, ALL_FIELDS);
  const h = new Float32Array(N);
  const P = g.pos;
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    h[c] = 70 * nz.fbm(x * 1.7, y * 1.7, z * 1.7, 5) + 45 * Math.pow(nz.ridged(x * 3.1, y * 3.1, z * 3.1, 4), 2);
  }
  craterize(g, h, rng, Math.round(N / 40), radius, 0.32);
  const ash = f.ash!;
  if (maria) {
    for (let c = 0; c < N; c++) {
      const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      const m = nz.fbm(x * 1.1 + 7, y * 1.1, z * 1.1 - 3, 3);
      if (m > 0.12) {
        const k = smooth(0.12, 0.3, m);
        h[c] = h[c] * (1 - k * 0.8) - 25 * k;
        ash[c] = 0.35 * k;
      }
    }
  }
  const S = f.surface!, R = f.rock!, SOIL = f.soil!, T = f.temperature!;
  for (let c = 0; c < N; c++) {
    let mx = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) mx = Math.max(mx, Math.abs(h[g.nbr[e]] - h[c]));
    const sl = mx / (g.meanEdgeAngle * radius);
    SOIL[c] = Math.max(0, 1.4 - sl * 3); // regolith blanket
    S[c] = h[c] + SOIL[c] + ash[c];
    R[c] = h[c];
    T[c] = -60 + 80 * Math.cos(g.lat[c]);
    f.biome![c] = B.barren;
  }
  const snap: PlanetSnap = {
    id, name, gridN: n, seed, alive: true, fieldVersion: 1,
    params: params({
      radius, orbit, kind, axialTilt: 0.05, cloudiness: 0, magnetism: 0, gravity: kind === 'moon' ? 1.6 : 3.7,
      dayHours: kind === 'moon' ? 48 : 30,
      atmosphere: atmo({ pressure: 0, o2: 0, n2: 0, co2: 0, dust: 0 }),
    }),
  };
  return { snap, fields: f, dirty: new Set(ALL_FIELDS), cloudGen: null, spin0: 0, cloudTick: 0 };
}

/** A red desert world: dune seas, terraced mesas, dry salt lakes, thin dusty air with a rust tint. */
function genDesert(id: number, name: string, seed: number, n: number, radius: number, orbit: OrbitParams): LookPlanet {
  const g = getGrid(n);
  const N = g.count;
  const nz = new Noise3(seed * 3 + 401);
  const f = newFields(N, ALL_FIELDS);
  const P = g.pos;
  const S = f.surface!, R = f.rock!, SAND = f.sand!, SAL = f.salinity!, T = f.temperature!, CL = f.cloud!, SNOW = f.snow!;
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    let e = 120 * nz.warped(x * 1.4, y * 1.4, z * 1.4, 0.9, 5);
    // terraced mesas
    const mesa = nz.fbm(x * 3.3 + 5, y * 3.3, z * 3.3, 3);
    if (mesa > 0.15) {
      const k = smooth(0.15, 0.25, mesa);
      const terr = Math.floor((e + 160) / 28) * 28 - 160;
      e = e * (1 - k) + (terr + 60) * k;
    }
    // canyon network
    const can = nz.ridged(x * 4.5 + 2, y * 4.5, z * 4.5, 3);
    e -= 70 * Math.pow(can, 6);
    const dune = nz.ridged(x * 22, y * 22 + 3, z * 22, 2) * 4 + 3 * (0.5 + 0.5 * nz.fbm(x * 6, y * 6, z * 6, 2));
    const basin = e < -40;
    SAND[c] = basin ? 0.4 : Math.max(0, dune * smooth(-30, 40, e) * (mesa > 0.2 ? 0.2 : 1));
    SAL[c] = basin ? 0.8 : 0;
    R[c] = e;
    S[c] = e + SAND[c];
    T[c] = 24 - 40 * Math.pow(Math.abs(Math.sin(g.lat[c])), 1.5);
    if (T[c] < -8) SNOW[c] = 0.4; // thin polar frost
    S[c] += SNOW[c];
    CL[c] = clamp01(nz.fbm(x * 4 + 30, y * 4, z * 4, 3) * 1.6 - 0.45) * 0.6;
    f.biome![c] = B.dune;
    f.moisture![c] = 0.05;
  }
  const snap: PlanetSnap = {
    id, name, gridN: n, seed, alive: true, fieldVersion: 1,
    params: params({
      radius, orbit, kind: 'desert', axialTilt: 0.44, cloudiness: 0.15, magnetism: 0.2, gravity: 5.5, dayHours: 26,
      atmosphere: atmo({ pressure: 0.45, o2: 0.01, n2: 0.3, co2: 0.65, dust: 0.55, tint: [1.0, 0.52, 0.32] }),
    }),
  };
  return { snap, fields: f, dirty: new Set(ALL_FIELDS), cloudGen: null, spin0: 0, cloudTick: 0 };
}

// ───────────────────────────────── backend ─────────────────────────────────

const STAR_TEMP = 5750;

export class LookdevBackend implements SimBackend {
  readonly kind = 'lookdev' as const;
  private planets: LookPlanet[] = [];
  private star!: StarView;
  private tick = 0;
  private speed = 1;
  private lastAdvance = 0;
  private sink: SnapshotSink | null = null;
  private scenario = 'lookdev';
  private seed = 1;

  async init(scenario: string, seed: number, _options: Record<string, unknown>, sink: SnapshotSink): Promise<string[]> {
    this.sink = sink;
    this.scenario = scenario;
    this.seed = seed;
    const t0 = performance.now();
    const col = blackbody(STAR_TEMP);
    this.star = { name: 'Aster', kind: 'G', luminosity: 1, temperature: STAR_TEMP, radius: 11000, color: col, activity: 0.15 };
    const YEAR = 17280;
    const homeOrbit: OrbitParams = { parent: -1, a: 1.5e6, e: 0.012, inc: 0, phase0: 0.9, period: YEAR, node: 0 };
    if (scenario === 'barren') {
      this.planets.push(genBarren(0, 'Cinder', seed, 48, 3000, homeOrbit, 'barren', false));
    } else {
      this.planets.push(genTerran(0, 'Gaia', seed, 64, 3000, homeOrbit));
      this.planets.push(genBarren(1, 'Selene', seed + 1, 24, 700, { parent: 0, a: 21000, e: 0.03, inc: 0.09, phase0: 2.2, period: 2880, node: 0.4 }, 'moon', true));
      this.planets.push(genDesert(2, 'Rust', seed + 2, 40, 2400, { parent: -1, a: 2.4e6, e: 0.05, inc: 0.03, phase0: 2.6, period: Math.round(YEAR * 2.0), node: 1.1 }));
      this.planets.push(genBarren(3, 'Cinder', seed + 3, 40, 1900, { parent: -1, a: 0.85e6, e: 0.08, inc: 0.06, phase0: 4.4, period: Math.round(YEAR * 0.42), node: 2.0 }, 'barren', false));
    }
    // start mid-morning at longitude 0, late spring
    this.tick = 0;
    for (const lp of this.planets) this.setHour(lp, lp.snap.id === 0 ? 9.5 : 11);
    this.lastAdvance = performance.now();
    console.info(`[genesis] lookdev system generated in ${(performance.now() - t0).toFixed(0)} ms`);
    return ['lookdev'];
  }

  /** shift a planet's spin so its local solar hour at longitude 0 is `hour` now */
  private setHour(lp: LookPlanet, hour: number): void {
    const p = lp.snap.params;
    const lam = this.sunLongitude(lp, this.tick);
    const spinNow = lam + ((hour - 12) / 24) * Math.PI * 2;
    lp.spin0 = spinNow - (2 * Math.PI * this.tick) / (p.dayHours * 60);
  }

  private centerOf(lp: LookPlanet, tick: number, out: D3): D3 {
    orbitOffset(lp.snap.params.orbit, tick, out);
    const par = lp.snap.params.orbit.parent;
    if (par >= 0) {
      const pp = this.planets.find((q) => q.snap.id === par);
      if (pp) {
        const o: D3 = [0, 0, 0];
        this.centerOf(pp, tick, o);
        out[0] += o[0]; out[1] += o[1]; out[2] += o[2];
      }
    }
    return out;
  }

  /** longitude of the star in the planet's equatorial (non-spinning) frame */
  private sunLongitude(lp: LookPlanet, tick: number): number {
    const c = this.centerOf(lp, tick, [0, 0, 0]);
    const l = Math.hypot(c[0], c[1], c[2]) || 1;
    const sun: D3 = [-c[0] / l, -c[1] / l, -c[2] / l];
    const q: DQ = [0, 0, 0, 1];
    const tilt: DQ = [0, 0, 0, 1];
    orbitPlaneQuat(lp.snap.params.orbit, q);
    qAxis(1, 0, 0, lp.snap.params.axialTilt, tilt);
    const eq = qMul(q, tilt);
    const s = qRotateInv(eq, sun);
    return Math.atan2(s[0], s[2]);
  }

  private advance(): void {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.lastAdvance) / 1000);
    this.lastAdvance = now;
    this.tick += dt * this.speed * TICKS_PER_SECOND_1X;
  }

  private snapshot(): Snapshot {
    const tick = this.tick;
    const planets: PlanetSnap[] = [];
    for (const lp of this.planets) {
      const p = lp.snap.params;
      const dayTicks = p.dayHours * 60;
      const spin = lp.spin0 + (2 * Math.PI * tick) / dayTicks;
      // local solar hour at longitude 0 from geometry; the calendar counts solar days
      const lam = this.sunLongitude(lp, tick);
      let ha = 12 + ((spin - lam) / (2 * Math.PI)) * 24;
      const lam0 = this.sunLongitude(lp, 0);
      const spin0 = lp.spin0;
      const ha0 = 12 + ((spin0 - lam0) / (2 * Math.PI)) * 24;
      // unwrap: expected hours elapsed ≈ tick/60 · (1 − dayTicks/period); pick the branch of ha closest to it
      const expect = ha0 + (tick / 60) * (1 - dayTicks / Math.max(1, p.orbit.period));
      ha += Math.round((expect - ha) / 24) * 24;
      const days = Math.floor(ha / p.dayHours);
      p.spin = spin;
      p.hourAtLon0 = ((ha % p.dayHours) + p.dayHours) % p.dayHours;
      p.dayOfYear = ((days % p.yearDays) + p.yearDays) % p.yearDays;
      p.year = 1 + Math.floor(days / p.yearDays);
      // clouds evolve every ~6 game minutes at speed, but at most ~3 times a second of real time
      if (lp.cloudGen && Math.abs(tick - lp.cloudTick) > 6 && now() - lastCloudAt > 330) {
        lp.cloudGen(tick);
        lp.cloudTick = tick;
        lastCloudAt = now();
        lp.dirty.add('cloud'); lp.dirty.add('precip'); lp.dirty.add('precipType');
      }
      const snap: PlanetSnap = { ...lp.snap, params: { ...p, atmosphere: { ...p.atmosphere } } };
      if (lp.dirty.size) {
        snap.fields = {};
        // copies: the client adopts the arrays (as it would transferred buffers) and we keep evolving ours
        for (const k of lp.dirty) { const a = lp.fields[k]; if (a) snap.fields[k] = a.slice(); }
        lp.dirty.clear();
        lp.snap.fieldVersion++;
        snap.fieldVersion = lp.snap.fieldVersion;
      }
      planets.push(snap);
    }
    return {
      tick, speed: this.speed, achievedSpeed: this.speed, star: this.star, planets, ships: [], creatures: [], hand: null,
      events: [], chronicle: [], content: ['lookdev'], msPerTick: 0, restraint: false, worship: [0],
    };
  }

  requestSnapshot(): void {
    this.advance();
    const s = this.snapshot();
    // deliver asynchronously like a worker would (never re-enter the caller's frame)
    queueMicrotask(() => this.sink?.(s));
  }

  setSpeed(x: number): void {
    this.advance();
    this.speed = Math.max(0, x);
  }

  async step(ticks: number): Promise<number> {
    this.advance();
    this.tick += Math.max(0, ticks);
    return this.tick;
  }

  async cmd(c: Command): Promise<CommandResult> {
    this.advance();
    const planetId = typeof c.planet === 'number' ? c.planet : 0;
    const lp = this.planets.find((q) => q.snap.id === planetId) ?? this.planets[0];
    switch (c.k) {
      case 'time.set-hour': {
        const hour = Number(c.hour);
        if (!Number.isFinite(hour)) return { ok: false, msg: 'time.set-hour needs an hour (0–24)' };
        for (const q of this.planets) if (c.planet == null || q === lp) this.setHour(q, hour);
        return { ok: true, msg: `The sun stands at ${hour.toFixed(1)} h over the meridian.`, tick: Math.floor(this.tick) };
      }
      case 'time.freeze-sun': {
        lp.snap.params.sunFrozen = !!(c.on ?? true);
        return { ok: true, msg: lp.snap.params.sunFrozen ? 'The sun stands still.' : 'The sun moves again.' };
      }
      case 'planet.atmosphere': {
        const a = lp.snap.params.atmosphere;
        if (typeof c.pressure === 'number') a.pressure = Math.max(0, c.pressure);
        if (typeof c.dust === 'number') a.dust = Math.max(0, c.dust);
        if (c.tint === null || Array.isArray(c.tint)) a.tint = c.tint as [number, number, number] | null;
        return { ok: true, msg: 'The air changes.' };
      }
      case 'planet.cloudiness': {
        lp.snap.params.cloudiness = clamp01(Number(c.value));
        return { ok: true };
      }
      case 'focus':
        return { ok: true };
      default:
        return { ok: false, msg: `lookdev has no sim: '${c.k}' is not simulated here (run without ?source=lookdev).` };
    }
  }

  async parse(text: string): Promise<CommandResult> {
    return { ok: false, msg: `lookdev has no sim to interpret "${text}".` };
  }

  async query(q: string): Promise<unknown> {
    if (q === 'scenario') return { scenario: this.scenario, seed: this.seed };
    return null;
  }

  dispose(): void {
    this.sink = null;
  }
}

let lastCloudAt = -1e9;
function now(): number { return performance.now(); }

/** for tests / tools: generate the home world's snapshot synchronously */
export function lookdevHomeWorld(seed = 1): { snap: PlanetSnap; fields: Fields } {
  const lp = genTerran(0, 'Gaia', seed, 64, 3000, { parent: -1, a: 1.5e6, e: 0, inc: 0, phase0: 0, period: 17280, node: 0 });
  return { snap: lp.snap, fields: lp.fields };
}

