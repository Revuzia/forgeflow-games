// BLOCKTOOTH — deterministic city generator (CONTRACT.md §7.1). THREE-FREE, DOM-free.
// Owner: city-sim lane. The ONLY randomness is the `rng` passed in (world.rng.city).
//
// Layout conventions (all metres, world XZ, y = 0 ground):
//   * Block grid blocksX × blocksZ centred on the origin. Road i (Z-running) centreline at
//     x = originX + i·pitch, road j (X-running) centreline at z = originZ + j·pitch.
//   * Block (bx,bz) cell centre = origin + (b + 0.5)·pitch; curb line ±29 m; sidewalk 26..29 m;
//     parcels live inside ±26 m (PARCEL_HALF). Buildings never leave their parcel.
//   * Right-hand traffic. Each block has one closed loop in the INNER lane of the surrounding
//     roads (1.75 m off the road centreline) running with the block on the driver's right;
//     arterials run in the CURB lanes of a few interior roads (no parking on those roads);
//     parked vehicles hug the curb in the curb lane of every other road side.
//   * Crosswalk records: `axis` = the direction a pedestrian WALKS across the road
//     ('z' ⇒ crossing an X-running road), `len` = crossing length measured along `axis`
//     (= roadW), `width` = zebra depth measured along the road (= CITY.crosswalkW).
//     Zebra centres sit 9 m from the intersection centre (just outside the junction box).
//   * LOCKWATER (biome.flooded): the harbour is the −Z edge. Block row bz = 0 is the quay
//     (container stacks + gantries on the waterfront, container yards), open water lies at
//     z < originZ − roadW/2 (= harbourWaterZ(city)), boats moor/cruise there, and the
//     playable bounds extend 85 m into the water on that side so the titan can wade.

import type {
  BiomeDef, Building, BuildingArchetype, CityLayout, Crosswalk, Lane, PickupKind, Prop, PropKind,
} from '../core/types.ts';
import { CITY, PARCEL_HALF, TIERS } from '../core/config.ts';
import { clamp, headingOf, lerp } from '../core/math.ts';
import { rInt, rPick, rRange, rWeighted } from '../core/rng.ts';

// ─────────────────────────────── layout constants ───────────────────────────────
const P = CITY.pitch;                         // 72  road centreline spacing
const HALF = P / 2;                           // 36
const RH = CITY.roadW / 2;                    // 7   road half-width
const CURB = HALF - RH;                       // 29  block-relative curb line
const PH = PARCEL_HALF;                       // 26  parcel half-size (sidewalk inner edge)
const LANE_W = CITY.laneW;                    // 3.5
/** block-relative offset of the block's traffic loop (inner lane, 1.75 m off the centreline) */
const LOOP_OFF = HALF - LANE_W / 2;           // 34.25
/** road-relative offset of an arterial (curb lane centre) */
const ART_OFF = RH - LANE_W / 2;              // 5.25
/** zebra centre distance from the intersection centre, along the road */
const CW_OFF = RH + CITY.crosswalkW / 2;      // 9
const CURB_GAP = 0.25;                        // parked vehicles keep this off the curb face
const LOOP_CORNER_R = 4.5;                    // rounded loop corners (m)
const PARK_SLOT = 6.2;                        // curb parking slot length
const PARK_SLOTS = 8;                         // slots per block side (|centre| ≤ 21.7 m, clear of the zebras)
const MIN_PARCEL = 12;                        // minimum parcel side (m)
const HARBOUR_WADE = 85;                      // bounds extension into the harbour (m)

/** Physical/gameplay metadata per prop kind. `len` is measured along the prop's heading
 *  (its local +Z / facing axis), `wid` across it. hp = TIERS[tier].floorHp. */
export interface PropInfo {
  tier: 0 | 1;
  len: number;
  wid: number;
  pickup: PickupKind;      // what its destruction drops
  vehicle: boolean;
  heal: number;            // chance to also drop a 'heal' pickup (street food)
}
export const PROP_INFO: Record<PropKind, PropInfo> = {
  car:       { tier: 0, len: 4.2, wid: 1.8, pickup: 'scrap', vehicle: true, heal: 0 },
  taxi:      { tier: 0, len: 4.4, wid: 1.8, pickup: 'scrap', vehicle: true, heal: 0 },
  van:       { tier: 0, len: 5.0, wid: 2.0, pickup: 'scrap', vehicle: true, heal: 0 },
  bus:       { tier: 1, len: 11.0, wid: 2.6, pickup: 'scrap', vehicle: true, heal: 0 },
  truck:     { tier: 1, len: 8.0, wid: 2.5, pickup: 'scrap', vehicle: true, heal: 0 },
  kiosk:     { tier: 0, len: 1.6, wid: 2.2, pickup: 'rubble', vehicle: false, heal: 0.08 },
  hydrant:   { tier: 0, len: 0.5, wid: 0.5, pickup: 'scrap', vehicle: false, heal: 0 },
  lamp:      { tier: 0, len: 0.4, wid: 0.4, pickup: 'scrap', vehicle: false, heal: 0 },
  tree:      { tier: 0, len: 2.4, wid: 2.4, pickup: 'rubble', vehicle: false, heal: 0 },
  bench:     { tier: 0, len: 0.7, wid: 1.8, pickup: 'rubble', vehicle: false, heal: 0 },
  vending:   { tier: 0, len: 0.8, wid: 1.0, pickup: 'scrap', vehicle: false, heal: 0.05 },
  signpost:  { tier: 0, len: 0.4, wid: 0.4, pickup: 'scrap', vehicle: false, heal: 0 },
  barrier:   { tier: 0, len: 0.5, wid: 2.0, pickup: 'rubble', vehicle: false, heal: 0 },
  drum:      { tier: 0, len: 0.7, wid: 0.7, pickup: 'scrap', vehicle: false, heal: 0 },
  forklift:  { tier: 0, len: 2.6, wid: 1.2, pickup: 'scrap', vehicle: false, heal: 0 },
  container: { tier: 1, len: 6.1, wid: 2.44, pickup: 'scrap', vehicle: false, heal: 0 },
  bollard:   { tier: 0, len: 0.3, wid: 0.3, pickup: 'scrap', vehicle: false, heal: 0 },
  boat:      { tier: 0, len: 6.0, wid: 2.2, pickup: 'scrap', vehicle: true, heal: 0 },
  pylon:     { tier: 0, len: 0.6, wid: 0.6, pickup: 'scrap', vehicle: false, heal: 0 },
  snowbank:  { tier: 0, len: 1.4, wid: 3.0, pickup: 'rubble', vehicle: false, heal: 0 },
};

/** Bounding radius of a prop (for rect/circle queries). */
export function propRadius(kind: PropKind): number {
  const i = PROP_INFO[kind];
  return 0.5 * Math.hypot(i.len, i.wid);
}

// ─────────────────────────────── shared helpers (citysim / traffic use these) ───────────────────────────────
/** Block-cell index of a point, CLAMPED into the grid (for indexing props that sit on
 *  outer roads or out on the harbour). Use blockOf() (citysim) for the −1-outside variant. */
export function cellOf(city: CityLayout, x: number, z: number): number {
  const bx = clamp(Math.floor((x - city.originX) / city.pitch), 0, city.blocksX - 1);
  const bz = clamp(Math.floor((z - city.originZ) / city.pitch), 0, city.blocksZ - 1);
  return bx + bz * city.blocksX;
}

/** z of the harbour waterline (LOCKWATER: water for z below it), or null when the city has no harbour. */
export function harbourWaterZ(city: CityLayout): number | null {
  return city.flooded ? city.originZ - city.roadW / 2 : null;
}

/** Cumulative arc length at each lane vertex (closed lanes include the closing segment:
 *  length n+1 for n points; open lanes: n). */
export function laneCum(lane: Lane): Float64Array {
  const n = lane.pts.length / 2;
  const segs = lane.closed ? n : n - 1;
  const cum = new Float64Array(segs + 1);
  for (let i = 0; i < segs; i++) {
    const a = i, b = (i + 1) % n;
    cum[i + 1] = cum[i] + Math.hypot(lane.pts[b * 2] - lane.pts[a * 2], lane.pts[b * 2 + 1] - lane.pts[a * 2 + 1]);
  }
  return cum;
}

/** Position + tangent heading at arc length s (closed lanes wrap, open lanes clamp). */
export function laneEval(lane: Lane, cum: Float64Array, s: number, out: { x: number; z: number; h: number }): void {
  const L = cum[cum.length - 1];
  const n = lane.pts.length / 2;
  if (L <= 0) { out.x = lane.pts[0]; out.z = lane.pts[1]; out.h = 0; return; }
  if (lane.closed) { s %= L; if (s < 0) s += L; } else s = clamp(s, 0, L);
  let lo = 0, hi = cum.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
  const a = lo, b = (lo + 1) % n;
  const ax = lane.pts[a * 2], az = lane.pts[a * 2 + 1], bx = lane.pts[b * 2], bz = lane.pts[b * 2 + 1];
  const seg = cum[a + 1] - cum[a];
  const t = seg > 1e-9 ? (s - cum[a]) / seg : 0;
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.h = headingOf(bx - ax, bz - az);
}

/** ± arc length (m) of the centred difference that gives traffic its smoothed heading. */
export const LANE_TANGENT_WIN = 1.0;
const TA = { x: 0, z: 0, h: 0 };
const TB = { x: 0, z: 0, h: 0 };
/** Smoothed travel heading at arc length s: centred difference over ±LANE_TANGENT_WIN, so
 *  vehicles swing round the rounded loop corners instead of snapping segment to segment.
 *  Generation and stepTraffic both use this, so a car never jumps on its first tick. */
export function laneHeading(lane: Lane, cum: Float64Array, s: number, fallback: number): number {
  laneEval(lane, cum, s - LANE_TANGENT_WIN, TA);
  laneEval(lane, cum, s + LANE_TANGENT_WIN, TB);
  const hx = TB.x - TA.x, hz = TB.z - TA.z;
  return hx * hx + hz * hz > 1e-8 ? Math.atan2(hx, hz) : fallback;
}

/** Deterministic per-vehicle cruise speed 8–12 m/s (no rng stream consumed). */
export function cruiseSpeed(seed: number, id: number): number {
  let h = Math.imul((id + 0x9e3779b9) ^ Math.imul(seed | 0, 0x85ebca6b), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return 8 + 4 * ((h >>> 0) / 4294967296);
}

/** Travel heading of the lane on `side` (±1) of a road. roadAxis = the axis the road RUNS
 *  along ('x' ⇒ centreline z = const). Right-hand traffic. */
function sideHeading(roadAxis: 'x' | 'z', side: number): number {
  if (roadAxis === 'x') return side > 0 ? Math.PI / 2 : -Math.PI / 2;
  return side > 0 ? Math.PI : 0;
}

// ─────────────────────────────── generation internals ───────────────────────────────
interface Parcel { x0: number; z0: number; x1: number; z1: number; }
interface Circ { x: number; z: number; r: number; }
type LotStyle = 'plaza' | 'yard' | 'dock';

const ROUND_SHAPES = new Set(['cylinder', 'dish', 'chimney']);
const SIDEWALK_CURB_KINDS = new Set<PropKind>(['lamp', 'hydrant', 'signpost', 'bollard', 'snowbank', 'barrier', 'pylon']);
const SIDEWALK_INNER_KINDS = new Set<PropKind>(['tree', 'bench', 'kiosk', 'vending', 'drum', 'container', 'forklift']);

function lotStyleOf(b: BiomeDef): LotStyle {
  if (b.flooded) return 'dock';
  if (b.weather === 'snow' || b.time === 'overcast') return 'yard';
  return 'plaza';
}

function parcelFits(a: BuildingArchetype, p: Parcel, sb: number): boolean {
  const mw = p.x1 - p.x0 - 2 * sb, md = p.z1 - p.z0 - 2 * sb;
  return mw >= a.footprint[0] && md >= a.footprint[0];
}

/** Recursive seeded bisection of a block's parcel square into n parcels (min side 12 m). */
function splitBlock(rng: () => number, cx: number, cz: number, n: number, bigCore: boolean): Parcel[] {
  const out: Parcel[] = [{ x0: cx - PH, z0: cz - PH, x1: cx + PH, z1: cz + PH }];
  let guard = 0;
  while (out.length < n && guard++ < 40) {
    let tot = 0;
    for (const p of out) {
      const w = p.x1 - p.x0, d = p.z1 - p.z0;
      if (Math.max(w, d) >= 2 * MIN_PARCEL) tot += (w * d) * (w * d);
    }
    if (tot <= 0) break;
    let x = rng() * tot, idx = out.length - 1;
    for (let i = 0; i < out.length; i++) {
      const p = out[i], w = p.x1 - p.x0, d = p.z1 - p.z0;
      if (Math.max(w, d) < 2 * MIN_PARCEL) continue;
      x -= (w * d) * (w * d);
      if (x <= 0) { idx = i; break; }
    }
    const p = out[idx];
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    let alongX = w > d + 0.01 ? true : d > w + 0.01 ? false : rng() < 0.5;
    if ((alongX ? w : d) < 2 * MIN_PARCEL) alongX = !alongX;
    const L = alongX ? w : d;
    // downtown cores: the first cut is lopsided so one parcel can host a skyline tower
    const t = bigCore && out.length === 1
      ? (rng() < 0.5 ? rRange(rng, 0.36, 0.42) : rRange(rng, 0.58, 0.64))
      : rRange(rng, 0.35, 0.65);
    const cut = clamp(L * t, MIN_PARCEL, L - MIN_PARCEL);
    if (alongX) {
      out[idx] = { x0: p.x0, z0: p.z0, x1: p.x0 + cut, z1: p.z1 };
      out.push({ x0: p.x0 + cut, z0: p.z0, x1: p.x1, z1: p.z1 });
    } else {
      out[idx] = { x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z0 + cut };
      out.push({ x0: p.x0, z0: p.z0 + cut, x1: p.x1, z1: p.z1 });
    }
  }
  return out;
}

export function generateCity(biome: BiomeDef, seed: number, rng: () => number): CityLayout {
  const bxN = biome.blocks[0], bzN = biome.blocks[1];
  const W = bxN * P, D = bzN * P;
  const originX = -W / 2, originZ = -D / 2;
  const harbour = biome.flooded;
  const style = lotStyleOf(biome);
  const nBlocks = bxN * bzN;

  const buildings: Building[] = [];
  const props: Prop[] = [];
  const lanes: Lane[] = [];
  const crosswalks: Crosswalk[] = [];

  const blockCX = (bx: number) => originX + (bx + 0.5) * P;
  const blockCZ = (bz: number) => originZ + (bz + 0.5) * P;
  const isQuay = (bz: number) => harbour && bz === 0;

  // ── 1. downtown centre (the skyline) ──
  const dcx = originX + W * rRange(rng, 0.36, 0.64);
  const dcz = originZ + D * (harbour ? rRange(rng, 0.54, 0.68) : rRange(rng, 0.36, 0.64));
  const maxDist = 0.5 * Math.hypot(W, D);
  /** 0 downtown … 1 suburb edge (shaped so the outer third reads as pure low-rise) */
  const uAt = (x: number, z: number) => clamp((Math.hypot(x - dcx, z - dcz) / maxDist) * 1.3, 0, 1);

  // ── 2. arterial roads (interior only; X-roads clear of the quay) ──
  const pickRoads = (lo: number, hi: number, count: number): number[] => {
    const out: number[] = [];
    let guard = 0;
    while (out.length < count && guard++ < 60) {
      const r = rInt(rng, lo, hi);
      if (out.every((o) => Math.abs(o - r) >= 3)) out.push(r);
    }
    return out.sort((a, b) => a - b);
  };
  const artX = pickRoads(harbour ? 3 : 2, bzN - 2, bzN >= 14 ? 2 : 1 + (rng() < 0.5 ? 1 : 0)); // X-running roads (index j)
  const artZ = pickRoads(2, bxN - 2, bxN >= 14 ? 2 : 1 + (rng() < 0.5 ? 1 : 0));              // Z-running roads (index i)
  const isArtX = (j: number) => artX.indexOf(j) >= 0;
  const isArtZ = (i: number) => artZ.indexOf(i) >= 0;

  // ── 3. park / plaza blocks (~8 %) ──
  const park: boolean[] = new Array(nBlocks).fill(false);
  let parks = 0;
  for (let b = 0; b < nBlocks; b++) {
    const bz = Math.floor(b / bxN);
    if (!isQuay(bz) && rng() < 0.08) { park[b] = true; parks++; }
  }
  const minParks = Math.max(2, Math.round(nBlocks * 0.05));
  for (let guard = 0; parks < minParks && guard < 200; guard++) {
    const b = rInt(rng, 0, nBlocks - 1);
    if (!park[b] && !isQuay(Math.floor(b / bxN))) { park[b] = true; parks++; }
  }

  // ── 4. parcels → buildings / lots ──
  const bParcel: Parcel[] = [];                 // building id → its parcel
  const bSetback: number[] = [];
  const bU: number[] = [];
  const lots: { p: Parcel; park: boolean; quay: boolean }[] = [];

  const pickArch = (tier: number, p: Parcel, sb: number, pool: 'inland' | 'quayFront' | 'quay'): BuildingArchetype | null => {
    const cands = biome.archetypes.filter((a) => {
      if (a.tier !== tier || !parcelFits(a, p, sb)) return false;
      if (pool === 'inland') return !(harbour && a.shape === 'gantry');
      if (pool === 'quayFront') return a.shape === 'gantry' || a.shape === 'containers';
      return a.shape === 'containers';
    });
    return cands.length ? rWeighted(rng, cands, (a) => a.weight) : null;
  };

  const writeBuilding = (bd: Building, a: BuildingArchetype, p: Parcel, sb: number, u: number, block: number, cx: number, cz: number): void => {
    const mw = p.x1 - p.x0 - 2 * sb, md = p.z1 - p.z0 - 2 * sb;
    let w = Math.min(mw, a.footprint[1]), d = Math.min(md, a.footprint[1]);
    w = Math.max(a.footprint[0], w * (0.86 + 0.14 * rng()));
    d = Math.max(a.footprint[0], d * (0.86 + 0.14 * rng()));
    if (ROUND_SHAPES.has(a.shape)) { const m = Math.min(w, d); w = m; d = m; }
    // front the street: push toward the block edge the parcel touches (only one per axis)
    const slackX = (mw - w) / 2, slackZ = (md - d) / 2;
    let x = (p.x0 + p.x1) / 2, z = (p.z0 + p.z1) / 2;
    const tW = p.x0 <= cx - PH + 0.01, tE = p.x1 >= cx + PH - 0.01;
    const tN = p.z0 <= cz - PH + 0.01, tS = p.z1 >= cz + PH - 0.01;
    if (tW && !tE) x -= slackX; else if (tE && !tW) x += slackX;
    if (tN && !tS) z -= slackZ; else if (tS && !tN) z += slackZ;
    const tf = Math.pow(rng(), 0.55 + u);                 // downtown skews to the tall end
    const floors = a.floors[0] + Math.round(tf * (a.floors[1] - a.floors[0]));
    bd.arch = a.id; bd.shape = a.shape; bd.tier = a.tier; bd.block = block;
    bd.x = x; bd.z = z; bd.w = w; bd.d = d;
    bd.floorH = a.floorH; bd.floors = floors; bd.alive = floors;
    bd.floorHpMax = TIERS[a.tier].floorHp; bd.floorHp = bd.floorHpMax;
    bd.collapsed = false; bd.variant = rng();
  };

  const addBuilding = (a: BuildingArchetype, p: Parcel, sb: number, u: number, block: number, cx: number, cz: number): void => {
    const bd: Building = {
      id: buildings.length, arch: a.id, shape: a.shape, tier: a.tier, block, x: 0, z: 0, w: 1, d: 1,
      floorH: a.floorH, floors: 1, alive: 1, floorHp: 1, floorHpMax: 1, collapsed: false, variant: 0,
    };
    writeBuilding(bd, a, p, sb, u, block, cx, cz);
    buildings.push(bd); bParcel.push(p); bSetback.push(sb); bU.push(u);
  };

  for (let bz = 0; bz < bzN; bz++) {
    for (let bx = 0; bx < bxN; bx++) {
      const b = bx + bz * bxN;
      const cx = blockCX(bx), cz = blockCZ(bz);
      if (park[b]) { lots.push({ p: { x0: cx - PH, z0: cz - PH, x1: cx + PH, z1: cz + PH }, park: true, quay: false }); continue; }
      const u0 = uAt(cx, cz);
      const jit = (rng() - 0.5) * 0.12;
      const uB = clamp(u0 + jit, 0, 1);
      if (isQuay(bz)) {
        const parcels = splitBlock(rng, cx, cz, rInt(rng, 3, 6), false);
        for (const p of parcels) {
          const sb = rRange(rng, 1, 2);
          const front = p.z0 <= cz - PH + 0.01;           // parcel on the waterfront
          const roll = rng();
          let a: BuildingArchetype | null = null;
          if (front) {
            a = roll < 0.7 ? pickArch(3, p, sb, 'quayFront') : null;
            if (!a) a = pickArch(rng() < 0.5 ? 2 : 1, p, sb, 'quay');
          } else if (roll < 0.72) {
            a = pickArch(rng() < 0.55 ? 2 : 1, p, sb, 'quay');
          }
          if (a) addBuilding(a, p, sb, uB, b, cx, cz);
          else lots.push({ p, park: false, quay: true });
        }
        continue;
      }
      const n = clamp(Math.round(lerp(2, 6.5, uB) + (rng() - 0.5) * 1.6), 2, 7);
      const parcels = splitBlock(rng, cx, cz, n, uB < 0.3);
      for (const p of parcels) {
        const pcx = (p.x0 + p.x1) / 2, pcz = (p.z0 + p.z1) / 2;
        const u = clamp(uAt(pcx, pcz) + jit, 0, 1);
        const corner = (p.x0 <= cx - PH + 0.01 || p.x1 >= cx + PH - 0.01) && (p.z0 <= cz - PH + 0.01 || p.z1 >= cz + PH - 0.01);
        const wts: number[] = [];
        for (let i = 0; i < 5; i++) {
          const base = lerp(biome.tierCentre[i], biome.tierEdge[i], u);
          wts.push(base * (0.75 + 0.5 * rng()) * (corner && i >= 2 ? 1.35 : 1));
        }
        const tier = rWeighted(rng, [0, 1, 2, 3, 4], (i) => wts[i]);
        const sb = rRange(rng, 1, 2);
        let a: BuildingArchetype | null = null;
        for (let t = tier; t >= 1 && !a; t--) a = pickArch(t, p, sb, 'inland');
        if (a) addBuilding(a, p, sb, u, b, cx, cz);
        else lots.push({ p, park: false, quay: false });
      }
    }
  }

  // ── 4b. every tier present: promote/demote a few buildings if a tier is missing ──
  const MIN_PER_TIER = [0, 6, 6, 4, 3];
  const tierCount = [0, 0, 0, 0, 0];
  for (const bd of buildings) tierCount[bd.tier]++;
  for (let t = 4; t >= 1; t--) {
    if (tierCount[t] >= MIN_PER_TIER[t]) continue;
    const order = buildings
      .filter((bd) => !isQuay(Math.floor(bd.block / bxN)) && bd.tier !== t)
      .map((bd) => bd.id)
      .sort((ia, ib) => {
        const A = buildings[ia], B = buildings[ib];
        const da = Math.hypot(A.x - dcx, A.z - dcz), db = Math.hypot(B.x - dcx, B.z - dcz);
        return (t >= 3 ? da - db : db - da) || ia - ib;
      });
    for (const id of order) {
      if (tierCount[t] >= MIN_PER_TIER[t]) break;
      const bd = buildings[id];
      if (tierCount[bd.tier] <= MIN_PER_TIER[bd.tier]) continue;
      const a = pickArch(t, bParcel[id], bSetback[id], 'inland');
      if (!a) continue;
      const bx = bd.block % bxN, bz = Math.floor(bd.block / bxN);
      tierCount[bd.tier]--;
      writeBuilding(bd, a, bParcel[id], bSetback[id], bU[id], bd.block, blockCX(bx), blockCZ(bz));
      tierCount[t]++;
    }
  }

  // ── prop helpers ──
  const mkProp = (kind: PropKind, x: number, z: number, heading: number, lane = -1, laneS = 0, speed = 0): Prop => {
    const info = PROP_INFO[kind];
    const pr: Prop = {
      id: props.length, kind, tier: info.tier, x, z, heading, px: x, pz: z, pheading: heading,
      alive: true, hp: TIERS[info.tier].floorHp, lane, laneS, speed, scared: 0,
    };
    props.push(pr);
    return pr;
  };
  const reserved: Circ[] = [];
  const isReserved = (x: number, z: number, r: number): boolean => {
    for (const c of reserved) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    return false;
  };

  // ── 5. lot / plaza / park props (inside parcels) ──
  for (const lot of lots) {
    const p = lot.p;
    const pw = p.x1 - p.x0, pd = p.z1 - p.z0;
    const g = 7;
    const nx = Math.max(1, Math.floor((pw - 2) / g)), nz = Math.max(1, Math.floor((pd - 2) / g));
    const ox = p.x0 + (pw - nx * g) / 2 + g / 2, oz = p.z0 + (pd - nz * g) / 2 + g / 2;
    const pcx = (p.x0 + p.x1) / 2, pcz = (p.z0 + p.z1) / 2;
    const alongX = pw >= pd;
    const lotStyle: LotStyle = lot.quay ? 'dock' : style;
    let kiosks = 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = ox + ix * g + (rng() - 0.5) * 1.6, z = oz + iz * g + (rng() - 0.5) * 1.6;
        const r = rng();
        if (lotStyle === 'plaza') {
          const onPath = Math.abs(x - pcx) < 3.2 || Math.abs(z - pcz) < 3.2;
          if (onPath) {
            const hPath = Math.abs(x - pcx) < 3.2 ? (x < pcx ? Math.PI / 2 : -Math.PI / 2) : (z < pcz ? 0 : Math.PI);
            if (r < 0.3) mkProp('bench', x, z, hPath);
            else if (r < 0.48) mkProp('lamp', x, z, 0);
            else if (r < 0.56 && kiosks < 2) { mkProp('kiosk', x, z, hPath); kiosks++; }
            else if (r < 0.62) mkProp('vending', x, z, hPath);
          } else if (r < 0.82) mkProp('tree', x, z, rng() * Math.PI * 2);
          else if (r < 0.88) mkProp('bench', x, z, rRange(rng, -Math.PI, Math.PI));
        } else if (lotStyle === 'yard') {
          if (r < 0.22) {
            const nd = rInt(rng, 2, 4);
            for (let k = 0; k < nd; k++) mkProp('drum', x + (k % 2) * 0.9 - 0.45, z + Math.floor(k / 2) * 0.9 - 0.45, rng() * 3);
          } else if (r < 0.34) mkProp('container', x, z, alongX ? Math.PI / 2 : 0);
          else if (r < 0.41) mkProp('forklift', x, z, rRange(rng, -Math.PI, Math.PI));
          else if (r < 0.47) mkProp('pylon', x, z, 0);
          else if (r < 0.6) mkProp('snowbank', x, z, alongX ? Math.PI / 2 : 0);
          else if (r < 0.7) mkProp('tree', x, z, rng() * Math.PI * 2);
        } else {
          // dock / container yard
          if (r < 0.42) mkProp('container', x, z, alongX ? Math.PI / 2 : 0);
          else if (r < 0.56) {
            const nd = rInt(rng, 2, 4);
            for (let k = 0; k < nd; k++) mkProp('drum', x + (k % 2) * 0.9 - 0.45, z + Math.floor(k / 2) * 0.9 - 0.45, rng() * 3);
          } else if (r < 0.63) mkProp('forklift', x, z, rRange(rng, -Math.PI, Math.PI));
          else if (r < 0.69) mkProp('lamp', x, z, 0);
          else if (r < 0.74) mkProp('bollard', x, z, 0);
        }
      }
    }
  }

  // ── 6. crosswalks: a zebra on every leg of every intersection ──
  interface CwMeta { roadAxis: 'x' | 'z'; road: number; e: number; ix: number; iz: number; }
  const cwMeta: CwMeta[] = [];
  for (let j = 0; j <= bzN; j++) {                 // X-running roads: pedestrians walk along Z
    const z = originZ + j * P;
    for (let i = 0; i <= bxN; i++) {
      const xi = originX + i * P;
      if (i > 0) { crosswalks.push({ x: xi - CW_OFF, z, axis: 'z', len: CITY.roadW, width: CITY.crosswalkW }); cwMeta.push({ roadAxis: 'x', road: j, e: -1, ix: xi, iz: z }); }
      if (i < bxN) { crosswalks.push({ x: xi + CW_OFF, z, axis: 'z', len: CITY.roadW, width: CITY.crosswalkW }); cwMeta.push({ roadAxis: 'x', road: j, e: 1, ix: xi, iz: z }); }
    }
  }
  for (let i = 0; i <= bxN; i++) {                 // Z-running roads: pedestrians walk along X
    const x = originX + i * P;
    for (let j = 0; j <= bzN; j++) {
      const zj = originZ + j * P;
      if (j > 0) { crosswalks.push({ x, z: zj - CW_OFF, axis: 'x', len: CITY.roadW, width: CITY.crosswalkW }); cwMeta.push({ roadAxis: 'z', road: i, e: -1, ix: x, iz: zj }); }
      if (j < bzN) { crosswalks.push({ x, z: zj + CW_OFF, axis: 'x', len: CITY.roadW, width: CITY.crosswalkW }); cwMeta.push({ roadAxis: 'z', road: i, e: 1, ix: x, iz: zj }); }
    }
  }

  // ── 7. spawn: a zebra near (not at) downtown, food within reach ──
  const spawnOk = (k: number, lo: number, hi: number): boolean => {
    const c = crosswalks[k], m = cwMeta[k];
    const n = m.roadAxis === 'x' ? bzN : bxN;
    if (m.road <= 0 || m.road >= n) return false;                         // interior roads only
    if (m.roadAxis === 'x' ? isArtX(m.road) : isArtZ(m.road)) return false; // arterial curb lanes are live
    if (harbour && c.z < originZ + P + 12) return false;                  // not on the quay
    const d = Math.hypot(c.x - dcx, c.z - dcz);
    return d >= lo && d <= hi;
  };
  let cand: number[] = [];
  for (const [lo, hi] of [[1.0 * P, 2.4 * P], [0.5 * P, 4 * P], [0, 1e9]] as const) {
    cand = [];
    for (let k = 0; k < crosswalks.length; k++) if (spawnOk(k, lo, hi)) cand.push(k);
    if (cand.length) break;
  }
  const sk = rPick(rng, cand);
  const scw = crosswalks[sk], sm = cwMeta[sk];
  // c = crossing unit (pedestrian direction), a = along-road unit (away from the intersection)
  const cX = scw.axis === 'x' ? 1 : 0, cZ = scw.axis === 'z' ? 1 : 0;
  const aX = (scw.axis === 'z' ? 1 : 0) * sm.e, aZ = (scw.axis === 'x' ? 1 : 0) * sm.e;
  const at = (along: number, lat: number) => ({ x: scw.x + aX * along + cX * lat, z: scw.z + aZ * along + cZ * lat });
  // face the camera (+X/+Z) along the crossing: the opening frame sees the baby titan's face
  const spawn = { x: scw.x, z: scw.z, heading: scw.axis === 'z' ? 0 : Math.PI / 2 };
  const sideK = rng() < 0.5 ? 1 : -1;               // sidewalk that gets the kiosk
  const spawnCarKinds: PropKind[] = biome.id === 'grideast' ? ['taxi', 'car'] : ['car', 'van'];
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    const kind = spawnCarKinds[s];
    const lat = RH - CURB_GAP - PROP_INFO[kind].wid / 2;
    const q = at(CITY.crosswalkW / 2 + 0.3 + PROP_INFO[kind].len / 2, side * lat);
    mkProp(kind, q.x, q.z, sideHeading(sm.roadAxis, side));
    reserved.push({ x: q.x, z: q.z, r: PROP_INFO[kind].len / 2 + 1.4 });
  }
  {
    const q = at(1.3, sideK * 7.8);                  // kiosk on the sidewalk at the zebra mouth, facing the road
    mkProp('kiosk', q.x, q.z, headingOf(-cX * sideK, -cZ * sideK));
    reserved.push({ x: q.x, z: q.z, r: 2.2 });
    const h = at(-1.2, -sideK * 7.55);               // hydrant on the opposite corner
    mkProp('hydrant', h.x, h.z, 0);
    reserved.push({ x: h.x, z: h.z, r: 1.2 });
    const v = at(3.8, sideK * 8.3);                  // vending machine a step further
    mkProp('vending', v.x, v.z, headingOf(-cX * sideK, -cZ * sideK));
    reserved.push({ x: v.x, z: v.z, r: 1.4 });
    const l = at(3.6, -sideK * 7.6);                 // street lamp
    mkProp('lamp', l.x, l.z, 0);
    reserved.push({ x: l.x, z: l.z, r: 1.0 });
    reserved.push({ x: spawn.x, z: spawn.z, r: 2.5 });
  }

  // ── 8. sidewalk props + parked vehicles (per block) ──
  const SIDE_OUT = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];      // outward normal heading: E, S(+Z), W, N(−Z)
  const SIDE_FLOW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];      // curb-lane travel heading (block on the right)
  const sidePos = (cx: number, cz: number, side: number, along: number, lat: number) =>
    side === 0 ? { x: cx + lat, z: cz + along }
      : side === 1 ? { x: cx + along, z: cz + lat }
        : side === 2 ? { x: cx - lat, z: cz + along }
          : { x: cx + along, z: cz - lat };
  const sideIsArterial = (bx: number, bz: number, side: number) =>
    side === 0 ? isArtZ(bx + 1) : side === 2 ? isArtZ(bx) : side === 1 ? isArtX(bz + 1) : isArtX(bz);

  const countOf = (perBlock: number) => Math.floor(perBlock) + (rng() < perBlock - Math.floor(perBlock) ? 1 : 0);
  const placedLocal: Circ[] = [];
  for (let bz = 0; bz < bzN; bz++) {
    for (let bx = 0; bx < bxN; bx++) {
      const cx = blockCX(bx), cz = blockCZ(bz);
      placedLocal.length = 0;
      const free = (x: number, z: number, r: number): boolean => {
        if (isReserved(x, z, r)) return false;
        for (const c of placedLocal) if (Math.hypot(x - c.x, z - c.z) < c.r + r + 0.6) return false;
        return true;
      };
      // sidewalk furniture
      for (const e of biome.props) {
        const info = PROP_INFO[e.kind];
        if (info.vehicle) continue;
        const curbKind = SIDEWALK_CURB_KINDS.has(e.kind);
        const innerKind = SIDEWALK_INNER_KINDS.has(e.kind);
        if (!curbKind && !innerKind) continue;
        const cnt = countOf(e.perBlock);
        const rad = Math.max(info.len, info.wid) / 2;
        for (let k = 0; k < cnt; k++) {
          for (let tries = 0; tries < 6; tries++) {
            const side = rInt(rng, 0, 3);
            const along = rRange(rng, -24, 24);
            // curb band hugs the curb line; inner band sits by the building line
            const lat = curbKind ? CURB - 0.35 - Math.min(info.len, info.wid) / 2 : PH + 0.25 + Math.min(info.len, info.wid) / 2;
            const q = sidePos(cx, cz, side, along, lat);
            if (!free(q.x, q.z, rad)) continue;
            // long axis along the curb: len-long kinds point along the traffic flow, wid-long kinds
            // (snowbank/barrier/bench/kiosk/vending) face the street; small round things spin
            const h = e.kind === 'container' || e.kind === 'forklift'
              ? SIDE_FLOW[side]
              : e.kind === 'kiosk' || e.kind === 'vending' || e.kind === 'bench' || e.kind === 'snowbank' || e.kind === 'barrier'
                ? SIDE_OUT[side]
                : rng() * Math.PI * 2;
            mkProp(e.kind, q.x, q.z, h);
            placedLocal.push({ x: q.x, z: q.z, r: rad });
            break;
          }
        }
      }
      // parked vehicles hugging the curb (slot grid per side; long vehicles take two slots)
      const occ: boolean[] = new Array(4 * PARK_SLOTS).fill(false);
      for (let s = 0; s < 4; s++) if (sideIsArterial(bx, bz, s)) for (let k = 0; k < PARK_SLOTS; k++) occ[s * PARK_SLOTS + k] = true;
      for (const e of biome.props) {
        const info = PROP_INFO[e.kind];
        if (!info.vehicle) continue;
        const cnt = countOf(e.perBlock);
        const span = info.len > PARK_SLOT - 0.6 ? 2 : 1;
        for (let k = 0; k < cnt; k++) {
          for (let tries = 0; tries < 8; tries++) {
            const side = rInt(rng, 0, 3);
            const k0 = rInt(rng, 0, PARK_SLOTS - span);
            let ok = true;
            for (let t = 0; t < span; t++) if (occ[side * PARK_SLOTS + k0 + t]) ok = false;
            if (!ok) continue;
            const along = (k0 + (span - 1) / 2 - (PARK_SLOTS - 1) / 2) * PARK_SLOT;
            const lat = CURB + CURB_GAP + info.wid / 2;
            const q = sidePos(cx, cz, side, along, lat);
            if (isReserved(q.x, q.z, info.len / 2)) continue;
            for (let t = 0; t < span; t++) occ[side * PARK_SLOTS + k0 + t] = true;
            mkProp(e.kind, q.x, q.z, SIDE_FLOW[side] + (rng() - 0.5) * 0.06);
            break;
          }
        }
      }
    }
  }

  // ── 9. traffic: one closed loop per block + arterials (+ harbour boat lanes) ──
  const trafficKinds: PropKind[] = [];
  const trafficW: number[] = [];
  if (harbour) { trafficKinds.push('boat'); trafficW.push(1); }
  else for (const e of biome.props) if (PROP_INFO[e.kind].vehicle && e.kind !== 'boat') { trafficKinds.push(e.kind); trafficW.push(e.perBlock); }
  const trafficIdx = trafficKinds.map((_, i) => i);
  const trafficKind = (): PropKind => (trafficKinds.length ? trafficKinds[rWeighted(rng, trafficIdx, (i) => trafficW[i])] : 'car');
  const ev = { x: 0, z: 0, h: 0 };
  const populate = (laneIdx: number, count: number): void => {
    const lane = lanes[laneIdx];
    const cum = laneCum(lane);
    for (let k = 0; k < count; k++) {
      const s = ((k + 0.15 + 0.7 * rng()) / count) * lane.length;
      laneEval(lane, cum, s, ev);
      if (isReserved(ev.x, ev.z, 2.5)) continue;       // keep the opening frame's zebra clear
      const pr = mkProp(trafficKind(), ev.x, ev.z, laneHeading(lane, cum, s, ev.h), laneIdx, s, 0);
      pr.speed = cruiseSpeed(seed, pr.id);
    }
  };
  const addLane = (pts: number[], closed: boolean): number => {
    const lane: Lane = { pts, closed, length: 0 };
    const cum = laneCum(lane);
    lane.length = cum[cum.length - 1];
    lanes.push(lane);
    return lanes.length - 1;
  };
  // loops (travel order: east side +Z → south −X → west −Z → north +X; block on the right)
  const o = LOOP_OFF, rc = LOOP_CORNER_R;
  const CORNERS: [number, number, number, number, number, number][] = [
    // corner x, z, in dir, out dir
    [o, o, 0, 1, -1, 0], [-o, o, -1, 0, 0, -1], [-o, -o, 0, -1, 1, 0], [o, -o, 1, 0, 0, 1],
  ];
  for (let bz = 0; bz < bzN; bz++) {
    for (let bx = 0; bx < bxN; bx++) {
      const cx = blockCX(bx), cz = blockCZ(bz);
      const pts: number[] = [];
      for (const [px, pz, ix, iz, ox, oz] of CORNERS) {
        const ax = px - ix * rc, az = pz - iz * rc, bxp = px + ox * rc, bzp = pz + oz * rc;
        for (let t = 0; t <= 4; t++) {
          const u = t / 4, m = 1 - u;
          pts.push(cx + m * m * ax + 2 * m * u * px + u * u * bxp, cz + m * m * az + 2 * m * u * pz + u * u * bzp);
        }
      }
      populate(addLane(pts, true), biome.trafficPerLane);
    }
  }
  // arterials: curb lanes of the chosen roads, edge to edge (open; cars wrap to the start)
  const artCount = (len: number) => Math.max(3, Math.round((len / 90) * biome.trafficPerLane));
  for (const j of artX) {
    const z = originZ + j * P, x0 = originX - RH, x1 = originX + W + RH;
    populate(addLane([x0, z + ART_OFF, x1, z + ART_OFF], false), artCount(x1 - x0));   // +X on the +Z side
    populate(addLane([x1, z - ART_OFF, x0, z - ART_OFF], false), artCount(x1 - x0));   // −X on the −Z side
  }
  for (const i of artZ) {
    const x = originX + i * P, z0 = originZ - RH, z1 = originZ + D + RH;
    populate(addLane([x - ART_OFF, z0, x - ART_OFF, z1], false), artCount(z1 - z0));   // +Z on the −X side
    populate(addLane([x + ART_OFF, z1, x + ART_OFF, z0], false), artCount(z1 - z0));   // −Z on the +X side
  }

  // ── 10. harbour (LOCKWATER): waterfront bollards, moored boats, cruising boat lanes ──
  if (harbour) {
    const wz = originZ - RH;                           // waterline
    for (let x = originX + 6; x <= originX + W - 6; x += 12) mkProp('bollard', x, wz + 0.45, 0);
    const laneZ = [wz - 26, wz - 48];
    const hx0 = originX - 40, hx1 = originX + W + 40;
    populate(addLane([hx0, laneZ[0], hx1, laneZ[0]], false), Math.max(4, Math.round((hx1 - hx0) / 120)));
    populate(addLane([hx1, laneZ[1], hx0, laneZ[1]], false), Math.max(4, Math.round((hx1 - hx0) / 120)));
    const moored: Circ[] = [];
    const nBoats = bxN * 2;
    for (let k = 0; k < nBoats; k++) {
      for (let tries = 0; tries < 10; tries++) {
        const x = rRange(rng, originX + 10, originX + W - 10);
        const z = rRange(rng, wz - 76, wz - 7);
        if (laneZ.some((lz) => Math.abs(z - lz) < 5)) continue;
        if (moored.some((c) => Math.hypot(x - c.x, z - c.z) < 10)) continue;
        moored.push({ x, z, r: 4 });
        mkProp('boat', x, z, (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.5);
        break;
      }
    }
  }

  // ── 11. bounds + block index ──
  const bounds = {
    minX: originX - 8, maxX: originX + W + 8,
    minZ: originZ - (harbour ? HARBOUR_WADE : 8), maxZ: originZ + D + 8,
  };
  const city: CityLayout = {
    seed, biome: biome.id, blocksX: bxN, blocksZ: bzN,
    pitch: P, roadW: CITY.roadW, sidewalkW: CITY.sidewalkW,
    originX, originZ, bounds,
    buildings, props,
    blockBuildings: [], blockProps: [],
    crosswalks, lanes, spawn, flooded: biome.flooded,
  };
  for (let b = 0; b < nBlocks; b++) { city.blockBuildings.push([]); city.blockProps.push([]); }
  for (const bd of buildings) city.blockBuildings[bd.block].push(bd.id);
  for (const pr of props) city.blockProps[cellOf(city, pr.x, pr.z)].push(pr.id);
  return city;
}
