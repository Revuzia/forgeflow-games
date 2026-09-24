// BLOCKTOOTH — city view (CONTRACT.md §6, §6.1, §7.3). Owner: city-view lane.
//
// Draws world.city with the biome's mesh kit (city/meshkit.ts). Views read sim state + events and
// never write gameplay state.
//
// ── Ground ──
//   * road     — one plane under the whole grid (kit.ground.road). LOCKWATER (city.flooded): NO road
//                plane — env.ts owns the flooded-street water; we draw curbs/sidewalks/quays only.
//   * sidewalk — per block ROW one merged mesh: rounded-corner sidewalk ring raised CURB_H with its
//                curb faces (the kit's ground shader paints any non-horizontal face as curb). In
//                GRID-EAST the parcel interior (the paving between buildings) rides in the same mesh.
//   * lots/plazas — parcel interiors, merged city-wide: parks → kit.ground.plaza, industrial yards /
//                LOCKWATER dock aprons → kit.ground.lot.
//   * paint    — lane markings, stop lines and every zebra stripe (city.crosswalks) as ONE instanced
//                quad batch (instanceColor, polygonOffset, receives shadows). Drawn under the flood
//                water in LOCKWATER (submerged zebras keep the "titan on a crossing" read).
//
// ── Buildings ──
//   * LIVE blocks (Chebyshev radius CITY.liveRadiusByRank[rank] of blocks around the titan, 0.5-block
//     hysteresis, re-evaluated when the titan crosses a half-block line or ranks up): per archetype
//     three InstancedMeshes (base / floor / roof storeys, kit UNIT geometry scaled by (w, floorH, d))
//     + ink hulls (addOutline 1.6 px), instanceColor tint from building.variant, cast + receive
//     shadows, capacity grown on demand (doubling, capped at the city's total). frustumCulled = false:
//     the live set is centred on the titan, so it is always on screen anyway.
//     Storey identity is preserved: a building of F floors with `alive` standing shows ORIGINAL storeys
//     F−alive … F−1 (damage always takes the lowest floor), so the roof always rides the stack.
//   * NON-live blocks: impostors. Every block owns a fixed SLOT in one shared dynamic vertex buffer
//     (one draw + one hull + one shadow draw for the whole distant city, instead of ~150 draws). A
//     slot holds that block's merged faceted, vertex-coloured impostor (current alive heights; mounds
//     for collapsed buildings) and is rewritten only when the block's state changes or it leaves the
//     live set; a live block's slot is zeroed (degenerate triangles). Impostor silhouettes/colours are
//     DERIVED FROM THE KIT GEOMETRY at mount (per-side dominant facade kind, plane position, average
//     vertex colour, roof colour of every base/floor/roof piece), and the impostor shader draws the
//     same window grid + distance LOD average + lit-window glow as the kit facade shader, so the
//     live↔impostor swap does not pop.
//
// ── Destruction (§7.3) ──
//   * floorBreak: the broken storey vanishes at once, everything above falls (constant-jerk fall ⇒ an
//     isolated one-floor drop is exactly easeInCubic over 0.28 s; overlapping breaks keep the stack's
//     speed, so a rapid chew never hovers), lands with a 6 % squash bounce; several breaks in one frame
//     drop several floors; breaks outside the live set only mark that block's impostor dirty.
//   * last floor / buildingCollapse: the remaining stack sinks into its footprint (0.6 s) while a
//     rubble heap (kit.rubble scaled to the footprint, height ∝ floors) rises and stays.
//   * a round-robin consistency sweep re-syncs any state change that arrived without an event.
//
// ── Props ──
//   Instanced per PropKind (+ hulls). Static props of live blocks + every traffic prop within a
//   camera-scaled radius (interpolated from px/pz/pheading with f.alpha). The kit paints cars/drums/
//   boats per gl_InstanceID, so prop instances live in STABLE SLOTS (free-list) — a visible car never
//   changes colour when others come and go. Destroyed props are hidden at once (fx does the burst).
//   Far LOD (camera ≥ PROP_LOD_D, Size IV–V): vehicles swap to the kit's low-poly `lod` mesh, ink
//   hulls + shadows drop, sub-pixel furniture (hydrants, benches, bollards…) is not drawn.
//
// ── See-through ──
//   Live buildings cutting a sight line camera→titan (chest, head, crown, shoulders, feet, plus the
//   snout and tail reach of the titan's own silhouette) draw EVERY storey as a flat-coloured
//   screen-door ghost (GHOST_KEEP 0.22, no ink) — the whole occluding piece ghosts, never a solid
//   crown floating over a ghosted base. A building that lost a floor in the last PANCAKE_SOLID_S
//   never ghosts (the pancake drop + squash is the payoff and must read).
//   At Size I–II, vehicles/kiosks/vending/containers/trees that hide the titan ghost the same way.
//
// Draw budget at Size V (measured by _harness/scratch/city-view/probe_cityview.ts): ≈ 6/archetype
// + 3/prop kind + rubble 3 + impostor 3 + ground ≈ 120–150 incl. the shadow pass.

import * as THREE from 'three';
import type { ArchShape, BiomeDef, Building, BuildingArchetype, CityLayout, PropKind, SimEvent, World } from '../core/types.ts';
import { CITY, PARCEL_HALF } from '../core/config.ts';
import { clamp, easeInCubic, easeOutBack, wrapAngle } from '../core/math.ts';
import { BIOMES } from '../data/biomes.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../render/viewtypes.ts';
import { addOutline, makeToon } from '../render/materials.ts';
import { buildCityKit } from './meshkit.ts';
import type { ArchMeshes, CityKit } from './meshkit.ts';

// ─────────────────────────────── constants ───────────────────────────────
const P = CITY.pitch;                    // 72 road centreline spacing
const RH = CITY.roadW / 2;               // 7 road half-width
const CURB = P / 2 - RH;                 // 29 block-relative curb line
const PH = PARCEL_HALF;                  // 26 sidewalk inner edge / parcel half-size
const CURB_R = 2.4;                      // rounded curb corner radius (m)
const CURB_SEG = 4;                      // segments per rounded corner
const CURB_H_DRY = 0.1;                  // sidewalk / parcel slab height (m)
const CURB_H_FLOOD = 0.16;               // LOCKWATER quays stand clear of the flood skin
/** mirrors render/env.ts FLOOD_Y (flooded-street / harbour water surface height) */
const FLOOD_Y = 0.06;
const BOAT_Y = FLOOD_Y - 0.3;            // boats sit in the water (kit keel at 0.15, deck 0.9)
const PAINT_Y = 0.012;
const INK_PX = 1.6;                      // CONTRACT §6.1: buildings/props 1.6 px
const DROP_T = 0.28;                     // one-floor pancake drop (s), easeInCubic
const MAX_GAP = 1.25;                    // a falling stack never floats more than this many floors up
const SQUASH_AMP = 0.06;                 // 6 % landing squash
const SQUASH_T = 0.26;
const SINK_T = 0.6;                      // collapse: remaining stack sinks into the footprint
const RISE_T = 0.5;                      // rubble heap rise
const IMP_CHUNK = 2;                     // impostor culling chunk (blocks per side; 1: a live block is not drawn at all)
const IMP_BLOCKS_PER_FRAME = 4;          // impostor slot rewrites per frame (queued blocks)
const SWEEP_PER_FRAME = 96;              // consistency sweep: buildings + props checked per frame

type RGB = [number, number, number];
const WHITE: RGB = [1, 1, 1];

const _c = new THREE.Color();
/** sRGB hex → linear working-space RGB (THREE.ColorManagement converts on set). */
function lin(hex: string): RGB { _c.set(hex); return [_c.r, _c.g, _c.b]; }
function mixc(a: RGB, b: RGB, t: number): RGB { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mulc(a: RGB, k: number): RGB { return [a[0] * k, a[1] * k, a[2] * k]; }

/** small deterministic hash → [0,1) (cosmetic only; never touches the sim streams) */
function hash01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ─────────────────────────────── kit analysis (impostor source data) ───────────────────────────────
/** What an impostor needs to know about one kit piece (base / floor / roof UNIT storey). Sides are
 *  ordered [+X, −X, +Z, −Z]. Everything is measured from the kit geometry itself, so the impostors
 *  follow whatever the city-kit lane authored. */
interface PieceProf {
  k: number[];       // dominant facade kind (aFac.x without the tint flag) per side
  c: RGB[];          // area-weighted vertex colour of that kind's faces per side
  t: boolean[];      // those faces are instanceColor-tintable
  p: number[];       // area-weighted plane coordinate (unit) of those faces: x for ±X, z for ±Z
  top: RGB;          // colour of the dominant up-facing level (flat roof membrane preferred)
  topT: boolean;
  hasTop: boolean;   // false for open floor tubes
  all: RGB;          // area-weighted colour of every face
  r: number;         // radial extent (unit) of the dominant side faces (round shapes)
  crown: Crown | null; // the largest kit triangles ABOVE the storey (parapet, penthouse, spire, gable…)
}
/** Kit triangles baked verbatim into the impostor (unit space; the writer scales them). */
interface Crown {
  n: number;
  pos: Float32Array;   // 9 per triangle
  nrm: Float32Array;   // 3 per triangle (declared face normal)
  on: Float32Array;    // 9 per triangle (the kit's smooth outline normals)
  col: Float32Array;   // 3 per triangle
  flag: Uint8Array;    // bit0 tint, bit1 glow
}
/** crown triangles kept per piece (largest area first) */
const CROWN_MAX = 36;
interface ArchProf { a: BuildingArchetype; shape: ArchShape; fmid: number; base: PieceProf; floor: PieceProf; roof: PieceProf; }

const KN = 16;
function analyzePiece(geo: THREE.BufferGeometry, fmid: number, fh: number): PieceProf {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const fac = geo.getAttribute('aFac') as THREE.BufferAttribute | undefined;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const idx = geo.index;
  // side accumulators: [side][kind] → area, r, g, b, plane, tintArea, rMax
  const S = new Float64Array(4 * KN * 7);
  const allK = new Float64Array(KN * 2);           // area, rMax per kind over all sides
  const up = new Map<number, number[]>();          // y bucket → area, r, g, b, tint
  const roofM = [0, 0, 0, 0, 0];                   // kind-9 (roof membrane) up faces
  const all = [0, 0, 0, 0, 0];
  const prof: PieceProf = {
    k: [1, 1, 1, 1], c: [WHITE, WHITE, WHITE, WHITE], t: [true, true, true, true], p: [0.47, -0.47, 0.47, -0.47],
    top: WHITE, topT: false, hasTop: false, all: WHITE, r: 0.47, crown: null,
  };
  const crownCand: number[] = [];                  // triangle start index, area (pairs)
  if (!pos || pos.count < 3) return prof;
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    // edges in metres (representative scale) → area + true face direction of the scaled piece
    const e1x = (bx - ax) * fmid, e1y = (by - ay) * fh, e1z = (bz - az) * fmid;
    const e2x = (cx - ax) * fmid, e2y = (cy - ay) * fh, e2z = (cz - az) * fmid;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    const area = len * 0.5;
    nx /= len; ny /= len; nz /= len;
    if (nrm) {
      const dx = nrm.getX(i0), dy = nrm.getY(i0), dz = nrm.getZ(i0);
      if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    }
    let r = 1, g = 1, b = 1;
    if (col) {
      r = (col.getX(i0) + col.getX(i1) + col.getX(i2)) / 3;
      g = (col.getY(i0) + col.getY(i1) + col.getY(i2)) / 3;
      b = (col.getZ(i0) + col.getZ(i1) + col.getZ(i2)) / 3;
    }
    const code = fac ? fac.getX(i0) : 0;
    const tint = code > 15.5;
    const kind = clamp(Math.round(code - (tint ? 16 : 0)), 0, KN - 1);
    all[0] += area; all[1] += r * area; all[2] += g * area; all[3] += b * area; all[4] += tint ? area : 0;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    if (my > 1.02) { crownCand.push(t, area); continue; }   // rooftop kit: baked, never a wall
    if (ny > 0.7) {
      if (kind === 9) { roofM[0] += area; roofM[1] += r * area; roofM[2] += g * area; roofM[3] += b * area; roofM[4] += tint ? area : 0; }
      const key = Math.round(my * 20);
      let u = up.get(key);
      if (!u) { u = [0, 0, 0, 0, 0]; up.set(key, u); }
      u[0] += area; u[1] += r * area; u[2] += g * area; u[3] += b * area; u[4] += tint ? area : 0;
    } else if (Math.abs(ny) < 0.5) {
      const side = Math.abs(nx) >= Math.abs(nz) ? (nx > 0 ? 0 : 1) : (nz > 0 ? 2 : 3);
      const plane = side < 2 ? mx : mz;
      const rad = Math.max(Math.hypot(ax, az), Math.hypot(bx, bz), Math.hypot(cx, cz));
      const o = (side * KN + kind) * 7;
      S[o] += area; S[o + 1] += r * area; S[o + 2] += g * area; S[o + 3] += b * area;
      S[o + 4] += plane * area; S[o + 5] += tint ? area : 0; S[o + 6] = Math.max(S[o + 6], rad);
      allK[kind * 2] += area; allK[kind * 2 + 1] = Math.max(allK[kind * 2 + 1], rad);
    }
  }
  for (let s = 0; s < 4; s++) {
    let best = -1, bestA = 0;
    for (let k = 0; k < KN; k++) {
      // signage / neon strips (kind 4) never define a wall
      const a = S[(s * KN + k) * 7] * (k === 4 ? 0.05 : 1);
      if (a > bestA) { bestA = a; best = k; }
    }
    if (best < 0) continue;
    const o = (s * KN + best) * 7, a = S[o];
    prof.k[s] = best;
    prof.c[s] = [S[o + 1] / a, S[o + 2] / a, S[o + 3] / a];
    prof.t[s] = S[o + 5] > a * 0.5;
    prof.p[s] = S[o + 4] / a;
  }
  let bestK = -1, bestA = 0;
  for (let k = 0; k < KN; k++) if (k !== 4 && allK[k * 2] > bestA) { bestA = allK[k * 2]; bestK = k; }
  if (bestK >= 0) prof.r = allK[bestK * 2 + 1];
  if (roofM[0] > 0) {
    prof.top = [roofM[1] / roofM[0], roofM[2] / roofM[0], roofM[3] / roofM[0]]; prof.topT = roofM[4] > roofM[0] * 0.5; prof.hasTop = true;
  } else {
    let bu: number[] | null = null;
    for (const u of up.values()) if (!bu || u[0] > bu[0]) bu = u;
    if (bu && bu[0] > 0) { prof.top = [bu[1] / bu[0], bu[2] / bu[0], bu[3] / bu[0]]; prof.topT = bu[4] > bu[0] * 0.5; prof.hasTop = true; }
  }
  if (all[0] > 0) prof.all = [all[1] / all[0], all[2] / all[0], all[3] / all[0]];
  // crown: the largest rooftop triangles, verbatim (colours, smooth outline normals, glow flags)
  if (crownCand.length) {
    const order: number[] = [];
    for (let i = 0; i < crownCand.length; i += 2) order.push(i);
    order.sort((a, b) => crownCand[b + 1] - crownCand[a + 1]);
    const n = Math.min(CROWN_MAX, order.length);
    const on = geo.getAttribute('outlineNormal') as THREE.BufferAttribute | undefined;
    const cr: Crown = { n, pos: new Float32Array(n * 9), nrm: new Float32Array(n * 3), on: new Float32Array(n * 9), col: new Float32Array(n * 3), flag: new Uint8Array(n) };
    for (let q = 0; q < n; q++) {
      const t = crownCand[order[q]];
      const ii = [idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < 3; k++) {
        const vi = ii[k];
        cr.pos[q * 9 + k * 3] = pos.getX(vi); cr.pos[q * 9 + k * 3 + 1] = pos.getY(vi); cr.pos[q * 9 + k * 3 + 2] = pos.getZ(vi);
        if (on) { cr.on[q * 9 + k * 3] = on.getX(vi); cr.on[q * 9 + k * 3 + 1] = on.getY(vi); cr.on[q * 9 + k * 3 + 2] = on.getZ(vi); }
        else { cr.on[q * 9 + k * 3 + 1] = 1; }
        if (col) { r += col.getX(vi) / 3; g += col.getY(vi) / 3; b += col.getZ(vi) / 3; } else { r += 1 / 3; g += 1 / 3; b += 1 / 3; }
      }
      if (nrm) { cr.nrm[q * 3] = nrm.getX(ii[0]); cr.nrm[q * 3 + 1] = nrm.getY(ii[0]); cr.nrm[q * 3 + 2] = nrm.getZ(ii[0]); }
      else cr.nrm[q * 3 + 1] = 1;
      cr.col[q * 3] = r; cr.col[q * 3 + 1] = g; cr.col[q * 3 + 2] = b;
      const code = fac ? fac.getX(ii[0]) : 0;
      const tint = code > 15.5;
      const kind = Math.round(code - (tint ? 16 : 0));
      cr.flag[q] = (tint ? 1 : 0) | (kind === 4 ? 2 : 0);
    }
    prof.crown = cr;
  }
  return prof;
}

function buildArchProf(a: BuildingArchetype, am: ArchMeshes): ArchProf {
  const fmid = Math.max(4, (a.footprint[0] + a.footprint[1]) / 2);
  const fh = Math.max(1, a.floorH);
  return {
    a, shape: a.shape, fmid,
    base: analyzePiece(am.base, fmid, fh), floor: analyzePiece(am.floor, fmid, fh), roof: analyzePiece(am.roof, fmid, fh),
  };
}

/** Impostor window style for a kit facade kind (the impostor shader draws 1/2/3/5/8; the rest plain). */
function winKind(k: number): number { return k === 1 || k === 2 || k === 3 || k === 5 || k === 8 ? k : 0; }

// ─────────────────────────────── impostor buffer ───────────────────────────────
/** Palette + look constants the impostor needs (mirrors the kit's facade uniforms so the distant
 *  windows average to the same colour as the live facade's LOD). */
interface ImpLook {
  glass: RGB; glassLit: RGB; frame: RGB; sky: RGB; lit: number; winGlow: number; glow: number;
  cont: RGB[]; dust: RGB; ink: RGB; night: boolean; snow: boolean;
  signB: RGB; roofA: RGB;
  /** kit rubble heap colours (set at mount from kit.rubble) — impostor mounds match the live heaps */
  rubbleSide: RGB; rubbleTop: RGB;
}
function impLook(b: BiomeDef): ImpLook {
  const p = b.palette;
  const snow = b.weather === 'snow', night = b.time === 'night';
  const contHex = night
    ? [p.bodyA, p.bodyB, p.bodyC, '#2e7d6b', '#7a3524', '#4a5566']
    : snow ? ['#8e4a3a', '#3f5c7a', '#6b7a4f', '#9aa4ad', '#d98a2b', '#5b636b']
      : ['#ff6f5e', '#4f8fb0', '#e6ab4a', '#6f8f8c', '#c95d63', '#3d5a80'];
  return {
    glass: lin(p.glass), glassLit: lin(p.glassLit),
    frame: lin(snow || night ? p.trimA : p.trimB),
    sky: lin(night || snow ? p.skyHorizon : '#bfe6f5'),
    lit: night ? 0.36 : snow ? 0.14 : 0,
    winGlow: night ? 0.95 : snow ? 0.4 : 0,
    glow: night ? 1.55 : snow ? 0.5 : 0.08,
    cont: contHex.map((h) => mulc(lin(h), 0.96)),
    dust: lin(night ? '#4d5360' : snow ? '#a9b0b7' : '#c8bda9'),
    ink: lin('#1b1426'),
    night, snow,
    signB: lin(p.signB), roofA: lin(p.roofA),
    rubbleSide: lin(night ? '#4d5360' : snow ? '#a9b0b7' : '#c8bda9'),
    rubbleTop: lin(night ? '#4d5360' : snow ? '#a9b0b7' : '#c8bda9'),
  };
}

/** Appends faceted triangles into the shared impostor arrays (or only counts them when `dry`). */
class ImpWriter {
  pos: Float32Array; nrm: Float32Array; col: Float32Array; onr: Float32Array; imp: Float32Array;
  v = 0; lim = 0; dry = false;
  // window style of subsequent faces
  kind = 0; fh = 3; fc = 0; fw = 1;
  // outline-normal frame of the current column (hull normals are a function of position)
  ocx = 0; ocz = 0; otop = 0; orx = 1; orz = 1; round = false;
  constructor(verts: number) {
    this.pos = new Float32Array(verts * 3); this.nrm = new Float32Array(verts * 3); this.col = new Float32Array(verts * 3);
    this.onr = new Float32Array(verts * 3); this.imp = new Float32Array(verts * 4);
  }
  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB): void {
    if (this.dry || this.v >= this.lim) { this.v++; return; }
    const i = this.v * 3;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.nrm[i] = nx; this.nrm[i + 1] = ny; this.nrm[i + 2] = nz;
    this.col[i] = c[0]; this.col[i + 1] = c[1]; this.col[i + 2] = c[2];
    const dx = x - this.ocx, dz = z - this.ocz;
    let hx: number, hz: number;
    if (this.round) {
      const ex = dx / this.orx, ez = dz / this.orz, L = Math.hypot(ex, ez);
      hx = L > 1e-6 ? ex / L : 0; hz = L > 1e-6 ? ez / L : 0;
    } else {
      hx = dx > 1e-3 ? 1 : dx < -1e-3 ? -1 : 0;
      hz = dz > 1e-3 ? 1 : dz < -1e-3 ? -1 : 0;
    }
    let hy = y >= this.otop - 1e-3 ? 1 : 0;
    let L = Math.hypot(hx, hy, hz);
    if (L < 1e-6) { hx = 0; hy = 1; hz = 0; L = 1; }
    this.onr[i] = hx / L; this.onr[i + 1] = hy / L; this.onr[i + 2] = hz / L;
    const j = this.v * 4;
    this.imp[j] = this.kind; this.imp[j + 1] = this.fh; this.imp[j + 2] = this.fc; this.imp[j + 3] = this.fw;
    this.v++;
  }
  /** vertex with an explicit (already world-space) outline normal */
  private vertOn(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: RGB, ox: number, oy: number, oz: number): void {
    if (this.dry || this.v >= this.lim) { this.v++; return; }
    const i = this.v * 3;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.nrm[i] = nx; this.nrm[i + 1] = ny; this.nrm[i + 2] = nz;
    this.col[i] = c[0]; this.col[i + 1] = c[1]; this.col[i + 2] = c[2];
    let L = Math.hypot(ox, oy, oz);
    if (L < 1e-6) { ox = 0; oy = 1; oz = 0; L = 1; }
    this.onr[i] = ox / L; this.onr[i + 1] = oy / L; this.onr[i + 2] = oz / L;
    const j = this.v * 4;
    this.imp[j] = this.kind; this.imp[j + 1] = this.fh; this.imp[j + 2] = this.fc; this.imp[j + 3] = this.fw;
    this.v++;
  }
  /** bake a kit crown (unit space) at storey base y0, scaled by (w, fh, d) */
  crown(cr: Crown, x: number, y0: number, z: number, w: number, fh: number, d: number, tint: RGB): void {
    const P3 = cr.pos, O = cr.on, cc = _crownC;
    for (let q = 0; q < cr.n; q++) {
      const f = cr.flag[q];
      this.kind = f & 2 ? 4 : 0;
      cc[0] = cr.col[q * 3]; cc[1] = cr.col[q * 3 + 1]; cc[2] = cr.col[q * 3 + 2];
      if (f & 1) { cc[0] *= tint[0]; cc[1] *= tint[1]; cc[2] *= tint[2]; }
      // normals follow the inverse-transpose of the (w, fh, d) scale
      let nx = cr.nrm[q * 3] / w, ny = cr.nrm[q * 3 + 1] / fh, nz = cr.nrm[q * 3 + 2] / d;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const o = q * 9;
      const ax = x + P3[o] * w, ay = y0 + P3[o + 1] * fh, az = z + P3[o + 2] * d;
      const bx = x + P3[o + 3] * w, by = y0 + P3[o + 4] * fh, bz = z + P3[o + 5] * d;
      const qx = x + P3[o + 6] * w, qy = y0 + P3[o + 7] * fh, qz = z + P3[o + 8] * d;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
      const dd = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
      const k1 = dd >= 0 ? 3 : 6, k2 = dd >= 0 ? 6 : 3;
      this.vertOn(ax, ay, az, nx, ny, nz, cc, O[o] / w, O[o + 1] / fh, O[o + 2] / d);
      this.vertOn(x + P3[o + k1] * w, y0 + P3[o + k1 + 1] * fh, z + P3[o + k1 + 2] * d, nx, ny, nz, cc, O[o + k1] / w, O[o + k1 + 1] / fh, O[o + k1 + 2] / d);
      this.vertOn(x + P3[o + k2] * w, y0 + P3[o + k2 + 1] * fh, z + P3[o + k2 + 2] * d, nx, ny, nz, cc, O[o + k2] / w, O[o + k2 + 1] / fh, O[o + k2 + 2] / d);
    }
    this.kind = 0;
  }
  /** one triangle; winding is forced to agree with the declared outward normal (doctrine §3) */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number, c: RGB): void {
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-9) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 1; nz = 0; }
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    this.vert(ax, ay, az, nx, ny, nz, c);
    if (d >= 0) { this.vert(bx, by, bz, nx, ny, nz, c); this.vert(cx, cy, cz, nx, ny, nz, c); }
    else { this.vert(cx, cy, cz, nx, ny, nz, c); this.vert(bx, by, bz, nx, ny, nz, c); }
  }
  /** quad a-b-c-d (cyclic order) */
  quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number, nx: number, ny: number, nz: number, c: RGB): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, c);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, nx, ny, nz, c);
  }
  boxFrame(x0: number, x1: number, z0: number, z1: number, top: number): void {
    this.round = false; this.ocx = (x0 + x1) / 2; this.ocz = (z0 + z1) / 2; this.otop = top;
  }
  roundFrame(x: number, z: number, rx: number, rz: number, top: number): void {
    this.round = true; this.ocx = x; this.ocz = z; this.orx = Math.max(rx, 1e-3); this.orz = Math.max(rz, 1e-3); this.otop = top;
  }
  /** four walls of an axis-aligned box band; k/c per side [+X, −X, +Z, −Z] */
  sides(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, k: number[], c: RGB[], fh: number): void {
    this.fh = fh;
    this.fc = (z0 + z1) / 2; this.fw = z1 - z0;
    this.kind = k[0]; this.quad(x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0, 1, 0, 0, c[0]);
    this.kind = k[1]; this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, c[1]);
    this.fc = (x0 + x1) / 2; this.fw = x1 - x0;
    this.kind = k[2]; this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, c[2]);
    this.kind = k[3]; this.quad(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, 0, 0, -1, c[3]);
    this.kind = 0;
  }
  top(x0: number, x1: number, z0: number, z1: number, y: number, c: RGB): void {
    this.kind = 0;
    this.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, 1, 0, c);
  }
  /** closed box (4 walls + top), one colour, plain */
  solid(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, c: RGB, cTop: RGB): void {
    this.boxFrame(x0, x1, z0, z1, y1);
    _k4[0] = _k4[1] = _k4[2] = _k4[3] = 0;
    _c4[0] = _c4[1] = _c4[2] = _c4[3] = c;
    this.sides(x0, x1, z0, z1, y0, y1, _k4, _c4, 3);
    this.top(x0, x1, z0, z1, y1, cTop);
  }
  /** lathe ring band between (r0 at y0) and (r1 at y1); rx/rz = ellipse scale of unit radius */
  ring(x: number, z: number, rx: number, rz: number, r0: number, r1: number, y0: number, y1: number, sides: number, rot: number, c: RGB, inward = false): void {
    this.kind = 0;
    const refY = y1 - y0 < 1e-6 ? (r0 > r1 ? 1 : -1) : r0 > r1 + 1e-6 ? 0.5 : r1 > r0 + 1e-6 ? -0.5 : 0;
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
      const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
      const ax = x + s0 * r0 * rx, az = z + c0 * r0 * rz, bx = x + s1 * r0 * rx, bz = z + c1 * r0 * rz;
      const cx = x + s1 * r1 * rx, cz = z + c1 * r1 * rz, dx = x + s0 * r1 * rx, dz = z + c0 * r1 * rz;
      // facet normal from its diagonals, oriented outward (radial + the slope's up/down lean)
      const px = cx - ax, py = y1 - y0, pz = cz - az, qx = dx - bx, qy = y1 - y0, qz = dz - bz;
      let nx = py * qz - pz * qy, ny = pz * qx - px * qz, nz = px * qy - py * qx;
      if (Math.hypot(nx, ny, nz) < 1e-9) { nx = Math.sin(am); ny = refY; nz = Math.cos(am); }
      if (nx * Math.sin(am) + ny * refY + nz * Math.cos(am) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (inward) { nx = -nx; ny = -ny; nz = -nz; }
      this.quad(ax, y0, az, bx, y0, bz, cx, y1, cz, dx, y1, dz, nx, ny, nz, c);
    }
  }
  /** flat disc (fan) at height y, facing up (or down) */
  disc(x: number, z: number, rx: number, rz: number, r: number, y: number, sides: number, rot: number, c: RGB, down = false): void {
    this.kind = 0;
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      this.tri(x, y, z, x + Math.sin(a0) * r * rx, y, z + Math.cos(a0) * r * rz, x + Math.sin(a1) * r * rx, y, z + Math.cos(a1) * r * rz,
        0, down ? -1 : 1, 0, c);
    }
  }
}
const _crownC: RGB = [1, 1, 1];
const _k4: number[] = [0, 0, 0, 0];
const _c4: RGB[] = [WHITE, WHITE, WHITE, WHITE];
const _cs: RGB[] = [WHITE, WHITE, WHITE, WHITE];
const _ks: number[] = [0, 0, 0, 0];

/** sight points on the titan (9 × xyz): chest, head, two shoulders, crown, feet, snout, muzzle
 *  root, tail — see updateOccluders */
const SIGHT_N = 27;
/** Silhouette reach along the titan's heading in body heights: [nose (+), tail (−)]. Mirrors
 *  titans/models.ts TitanModel.size.zMax / zMin (measured by _harness/scratch/titan_extent.ts:
 *  molo 1.11/−1.92, voltkite 0.75/−1.50, hearthback 0.80/−0.76, briarwick 0.91/−0.95). MOLO's snout
 *  sits 2.6 radii ahead of its centre, far outside the radius-based sight points (critic F04). */
const TITAN_REACH: Readonly<Record<string, readonly [number, number]>> = {
  molo: [1.11, -1.92], voltkite: [0.75, -1.5], hearthback: [0.8, -0.76], briarwick: [0.91, -0.95],
};
const REACH_DEFAULT: readonly [number, number] = [0.8, -0.8];
const _sight = new Float64Array(SIGHT_N);
/** does segment a→b cross the axis-aligned box? (slab test, t ∈ [0, 1]; allocation-free) */
const _slab = [0, 1];
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let ta = (lo - o) / d, tb = (hi - o) / d;
  if (ta > tb) { const q = ta; ta = tb; tb = q; }
  if (ta > _slab[0]) _slab[0] = ta;
  if (tb < _slab[1]) _slab[1] = tb;
  return _slab[0] <= _slab[1];
}
function segHitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  _slab[0] = 0; _slab[1] = 1;
  return slab(ax, bx - ax, x0, x1) && slab(ay, by - ay, y0, y1) && slab(az, bz - az, z0, z1);
}

function tinted(c: RGB, t: boolean, tint: RGB): RGB { return t ? [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]] : c; }

/** Storey → kit piece (0 base, 1 floor, 2 roof) for a building of F floors (CONTRACT §6 table). */
function pieceOf(i: number, F: number): 0 | 1 | 2 { return F <= 1 || i === 0 ? 0 : i === F - 1 ? 2 : 1; }

/** Rubble heap height (m) for a collapsed building (∝ floors, capped by the footprint). */
function pileHeight(b: Building): number {
  return clamp(0.9 + b.floors * b.floorH * 0.16, 0.9, 0.45 * Math.min(b.w, b.d) + 0.6);
}

/** Write one building's impostor (current alive floors; mound when collapsed). */
function writeImpostor(W: ImpWriter, b: Building, alive: number, ap: ArchProf, tint: RGB, L: ImpLook): void {
  if (b.collapsed || alive <= 0) { writeMound(W, b, ap, tint, L); return; }
  const F = b.floors, fh = b.floorH, i0 = F - alive;
  const H = alive * fh;
  switch (ap.shape) {
    case 'cylinder': writeTank(W, b, alive, ap, tint, L); return;
    case 'chimney': writeChimney(W, b, alive, ap, tint, L); return;
    case 'dish': writeDish(W, b, alive, ap, tint); return;
    case 'gantry': writeGantry(W, b, alive, ap, tint); return;
    case 'containers': {
      const e = ap.floor.p;
      const x1 = b.x + e[0] * b.w, x0 = b.x + e[1] * b.w, z1 = b.z + e[2] * b.d, z0 = b.z + e[3] * b.d;
      W.boxFrame(x0, x1, z0, z1, H);
      for (let i = i0; i < F; i++) {
        const j = i - i0;
        for (let s = 0; s < 4; s++) { _ks[s] = 0; _cs[s] = L.cont[Math.floor(hash01(b.id * 7 + i, s) * L.cont.length)]; }
        W.sides(x0, x1, z0, z1, j * fh, (j + 1) * fh, _ks, _cs, fh);
      }
      W.top(x0, x1, z0, z1, H, L.cont[Math.floor(hash01(b.id, 99) * L.cont.length)]);
      return;
    }
    default: break;
  }
  // box / podium / shed: runs of identical pieces, grouped into columns of identical extents
  let j = 0;
  let colStart = 0;
  // scan runs
  const runs = _runs; runs.length = 0;
  for (let i = i0; i < F; i++) {
    const pc = pieceOf(i, F);
    if (runs.length && runs[runs.length - 1].pc === pc) runs[runs.length - 1].n++;
    else runs.push(runTmp(runs.length, pc));
  }
  const extOf = (pc: number): number[] => {
    const pr = pc === 0 ? ap.base : pc === 1 ? ap.floor : ap.roof;
    return pr.p;
  };
  let r = 0;
  while (r < runs.length) {
    // column = consecutive runs with the same extents
    const ext = extOf(runs[r].pc);
    let r2 = r + 1;
    while (r2 < runs.length) {
      const e2 = extOf(runs[r2].pc);
      if (Math.abs(e2[0] - ext[0]) > 0.01 || Math.abs(e2[1] - ext[1]) > 0.01 || Math.abs(e2[2] - ext[2]) > 0.01 || Math.abs(e2[3] - ext[3]) > 0.01) break;
      r2++;
    }
    let nSt = 0;
    for (let q = r; q < r2; q++) nSt += runs[q].n;
    const x1 = b.x + ext[0] * b.w, x0 = b.x + ext[1] * b.w, z1 = b.z + ext[2] * b.d, z0 = b.z + ext[3] * b.d;
    const yTop = (colStart + nSt) * fh;
    W.boxFrame(x0, x1, z0, z1, yTop);
    j = colStart;
    for (let q = r; q < r2; q++) {
      const pr = runs[q].pc === 0 ? ap.base : runs[q].pc === 1 ? ap.floor : ap.roof;
      for (let s = 0; s < 4; s++) { _ks[s] = winKind(pr.k[s]); _cs[s] = tinted(pr.c[s], pr.t[s], tint); }
      W.sides(x0, x1, z0, z1, j * fh, (j + runs[q].n) * fh, _ks, _cs, fh);
      j += runs[q].n;
    }
    let topPr = runs[r2 - 1].pc === 0 ? ap.base : runs[r2 - 1].pc === 1 ? ap.floor : ap.roof;
    if (!topPr.hasTop) topPr = ap.roof.hasTop ? ap.roof : ap.base;
    W.top(x0, x1, z0, z1, yTop, tinted(topPr.top, topPr.topT, tint));
    colStart += nSt;
    r = r2;
  }
  // rooftop kit of the top storey (roof piece, or a lone base) + the podium's terrace dressing
  const topPc = pieceOf(F - 1, F);
  const topProf = topPc === 0 ? ap.base : topPc === 1 ? ap.floor : ap.roof;
  if (topProf.crown) W.crown(topProf.crown, b.x, (alive - 1) * fh, b.z, b.w, fh, b.d, tint);
  if (ap.shape === 'podium' && alive === F && F > 1 && ap.base.crown) W.crown(ap.base.crown, b.x, 0, b.z, b.w, fh, b.d, tint);
}
interface Run { pc: number; n: number; }
const _runs: Run[] = [];
const _runPool: Run[] = [{ pc: 0, n: 0 }, { pc: 0, n: 0 }, { pc: 0, n: 0 }, { pc: 0, n: 0 }];
function runTmp(i: number, pc: number): Run { const r = _runPool[i] ?? { pc, n: 0 }; r.pc = pc; r.n = 1; return r; }


function writeMound(W: ImpWriter, b: Building, ap: ArchProf, tint: RGB, L: ImpLook): void {
  const h = pileHeight(b);
  const rx = b.w * 0.56, rz = b.d * 0.56;
  const body = tinted(ap.floor.c[0], ap.floor.t[0], tint);
  const side = mixc(L.rubbleSide, body, 0.12), top = mixc(L.rubbleTop, body, 0.08);
  W.roundFrame(b.x, b.z, rx, rz, h);
  W.ring(b.x, b.z, rx, rz, 1, 0.62, 0, h * 0.55, 8, Math.PI / 8, side);
  W.ring(b.x, b.z, rx, rz, 0.62, 0.28, h * 0.55, h, 8, Math.PI / 8, mixc(side, top, 0.5));
  W.disc(b.x, b.z, rx, rz, 0.28, h, 8, Math.PI / 8, top);
}

function writeTank(W: ImpWriter, b: Building, alive: number, ap: ArchProf, tint: RGB, L: ImpLook): void {
  const F = b.floors, fh = b.floorH, H = alive * fh;
  const R = clamp(ap.floor.r || 0.47, 0.25, 0.5);
  const rx = b.w, rz = b.d;
  const body = tinted(ap.floor.c[0], ap.floor.t[0], tint);
  const cooling = ap.a.tier >= 4 || ap.fmid >= 20;
  if (!cooling) {
    const coneH = Math.max(0.6, R * ap.fmid * 0.34);
    W.roundFrame(b.x, b.z, R * rx, R * rz, H);
    W.ring(b.x, b.z, rx, rz, R, R, 0, H, 12, 0, body);
    const top = F > 1 ? ap.roof : ap.base;
    if (top.crown) { W.crown(top.crown, b.x, (alive - 1) * fh, b.z, b.w, fh, b.d, tint); return; }
    W.otop = H;
    W.ring(b.x, b.z, rx, rz, R + 0.01, 0.03, H, H + coneH, 12, 0, tinted(ap.roof.top, ap.roof.topT, tint));
    return;
  }
  // cooling tower: flare in over the first storeys, waist, flare out at the crown, dark throat
  const Rw = 0.35, Rtop = 0.43;
  const fb = Math.min(3, alive * 0.34) * fh, ft = Math.min(3, alive * 0.34) * fh;
  const baseR = alive === F ? R : Rw + (R - Rw) * 0.35;
  W.roundFrame(b.x, b.z, R * rx, R * rz, H);
  W.ring(b.x, b.z, rx, rz, baseR, Rw, 0, fb, 12, 0, body);
  if (H - ft > fb + 1e-3) W.ring(b.x, b.z, rx, rz, Rw, Rw, fb, H - ft, 12, 0, mixc(body, WHITE, 0.04));
  W.ring(b.x, b.z, rx, rz, Rw, Rtop, Math.max(fb, H - ft), H, 12, 0, mixc(body, WHITE, 0.08));
  // open throat: inner wall (faces inward/up) down to a dark basin
  const depth = Math.min(H * 0.35, Rw * Math.min(b.w, b.d) * 1.4);
  W.ring(b.x, b.z, rx, rz, Rw * 0.96, Rtop * 0.97, H - depth, H, 12, 0, mulc(body, 0.82), true);
  W.disc(b.x, b.z, rx, rz, Rw * 0.96, H - depth, 12, 0, mixc(L.ink, body, 0.3));
  // rolled lip (the kit's many-sided lip does not survive the crown's largest-triangle cut cleanly)
  W.otop = H + 0.35;
  W.ring(b.x, b.z, rx, rz, Rtop, Rtop * 1.035, H, H + 0.35, 12, 0, mixc(body, WHITE, 0.14));
  W.ring(b.x, b.z, rx, rz, Rtop * 1.035, Rtop * 0.97, H + 0.35, H + 0.35, 12, 0, mixc(body, WHITE, 0.2));
}

function writeChimney(W: ImpWriter, b: Building, alive: number, ap: ArchProf, tint: RGB, L: ImpLook): void {
  const F = b.floors, fh = b.floorH, H = alive * fh;
  const baseStands = alive === F;
  let y0 = 0;
  if (baseStands) {
    const e = ap.base.p;
    const x1 = b.x + e[0] * b.w, x0 = b.x + e[1] * b.w, z1 = b.z + e[2] * b.d, z0 = b.z + e[3] * b.d;
    const c = tinted(ap.base.c[0], ap.base.t[0], tint);
    W.solid(x0, x1, z0, z1, 0, fh, c, tinted(ap.base.top, ap.base.topT, tint));
    y0 = fh;
  }
  if (H <= y0 + 1e-3) return;
  const R = 0.34;
  const brick = tinted(ap.floor.c[0], ap.floor.t[0], tint);
  const stripe = ap.roof.all;
  const rot = Math.PI / 8;
  W.roundFrame(b.x, b.z, R * b.w, R * b.d, H);
  const yS = Math.max(y0, H - fh);
  if (yS > y0 + 1e-3) W.ring(b.x, b.z, b.w, b.d, R, R, y0, yS, 8, rot, brick);
  if (alive >= 2) {
    // the kit's roof storey: brick · red · white · red bands (quarters of the storey)
    const q = (H - yS) / 4;
    const bands: RGB[] = [brick, L.signB, L.roofA, L.signB];
    for (let i = 0; i < 4; i++) W.ring(b.x, b.z, b.w, b.d, R, R, yS + i * q, yS + (i + 1) * q, 8, rot, bands[i]);
  } else W.ring(b.x, b.z, b.w, b.d, R, R, yS, H, 8, rot, stripe);
  if (alive >= 2 && ap.roof.crown) W.crown(ap.roof.crown, b.x, (alive - 1) * fh, b.z, b.w, fh, b.d, tint);
  else W.disc(b.x, b.z, b.w, b.d, R, H, 8, rot, mixc(L.ink, brick, 0.2));
}

function writeDish(W: ImpWriter, b: Building, alive: number, ap: ArchProf, tint: RGB): void {
  const F = b.floors, fh = b.floorH, H = alive * fh;
  let y0 = 0;
  if (alive === F) {
    const e = ap.base.p;
    const x1 = b.x + e[0] * b.w, x0 = b.x + e[1] * b.w, z1 = b.z + e[2] * b.d, z0 = b.z + e[3] * b.d;
    W.solid(x0, x1, z0, z1, 0, fh, tinted(ap.base.c[0], ap.base.t[0], tint), tinted(ap.base.top, ap.base.topT, tint));
    y0 = fh;
  }
  const pole = tinted(ap.floor.c[0], ap.floor.t[0], tint);
  const bowl = ap.roof.all;
  const yb = Math.max(y0, H - 0.1 * fh);
  W.roundFrame(b.x, b.z, 0.2 * b.w, 0.2 * b.d, yb);
  if (yb > y0 + 1e-3) W.ring(b.x, b.z, b.w, b.d, 0.2, 0.2, y0, yb, 8, Math.PI / 8, pole);
  if (alive >= 2 && ap.roof.crown) { W.crown(ap.roof.crown, b.x, (alive - 1) * fh, b.z, b.w, fh, b.d, tint); return; }
  // fallback: upturned bowl, outside + inside faces (seen from above)
  const yt = H + 0.35 * fh;
  W.roundFrame(b.x, b.z, 0.47 * b.w, 0.47 * b.d, yt);
  W.ring(b.x, b.z, b.w, b.d, 0.1, 0.47, yb, yt, 10, 0, mulc(bowl, 0.9));
  W.ring(b.x, b.z, b.w, b.d, 0.1, 0.47, yb + 0.05, yt, 10, 0, bowl, true);
}

function writeGantry(W: ImpWriter, b: Building, alive: number, ap: ArchProf, tint: RGB): void {
  const fh = b.floorH;
  const ins = Math.min(0.06, 0.45 / ap.fmid);
  const Lx = 1.5 * b.w / ap.fmid, Lz = 1.5 * b.d / ap.fmid;
  const xl = (0.5 - ins) * b.w - Lx / 2, zl = (0.5 - ins) * b.d - Lz / 2;
  const steel = tinted(ap.floor.c[0], ap.floor.t[0], tint);
  const girder = tinted(ap.roof.c[2], ap.roof.t[2], tint);
  const yg0 = (alive - 1) * fh + 0.5 * fh, yg1 = yg0 + 1.8;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = b.x + sx * xl, cz = b.z + sz * zl;
    W.solid(cx - Lx / 2, cx + Lx / 2, cz - Lz / 2, cz + Lz / 2, 0, yg0, steel, steel);
  }
  for (const sz of [-1, 1]) {
    const cz = b.z + sz * zl;
    W.solid(b.x - (0.5 - ins * 0.3) * b.w, b.x + (0.5 - ins * 0.3) * b.w, cz - Lz * 0.6, cz + Lz * 0.6, yg0, yg1, girder, girder);
  }
  for (const sx of [-1, 1]) {
    const cx = b.x + sx * xl;
    W.solid(cx - Lx * 0.55, cx + Lx * 0.55, b.z - zl, b.z + zl, yg0, yg1 - 0.3, girder, girder);
  }
  const house = ap.roof.all;
  W.solid(b.x - 0.28 * b.w, b.x + 0.12 * b.w, b.z - 0.22 * b.d, b.z + 0.22 * b.d, yg1, yg1 + 3.2, house, tinted(ap.roof.top, ap.roof.topT, tint));
}

// ─────────────────────────────── impostor material ───────────────────────────────
const IMP_VERT_PARS = /* glsl */ `
attribute vec4 aImp;
varying vec4 vImpA;
varying vec3 vImpW;
varying vec3 vImpN;
`;
const IMP_VERT_MAIN = /* glsl */ `
#include <begin_vertex>
	vImpA = aImp;
	vImpW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vImpN = objectNormal;
`;
const IMP_FRAG_PARS = /* glsl */ `
uniform vec3 uImpGlass;
uniform vec3 uImpGlassLit;
uniform vec3 uImpFrame;
uniform vec3 uImpSky;
uniform float uImpLit;
uniform float uImpWinGlow;
uniform float uImpGlow;
varying vec4 vImpA;
varying vec3 vImpW;
varying vec3 vImpN;
float impHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float impBand( float x, float a, float b, float w ) { return smoothstep( a - w, a + w, x ) - smoothstep( b - w, b + w, x ); }
float impIn( float d, float r, float w ) { return 1.0 - smoothstep( r - w, r + w, d ); }
`;
const IMP_FRAG_MAIN = /* glsl */ `
	vec3 impEmit = vec3( 0.0 );
	if ( vImpA.x > 3.5 && vImpA.x < 4.5 ) {
		impEmit = diffuseColor.rgb * uImpGlow;          // neon / signs / beacons (kit glow kind)
	} else if ( vImpA.x > 0.5 && abs( vImpN.y ) < 0.5 ) {
		float kind = floor( vImpA.x + 0.5 );
		float fh = max( vImpA.y, 0.5 );
		bool alongZ = abs( vImpN.x ) > 0.5;
		float along = ( alongZ ? vImpW.z : vImpW.x ) - vImpA.z;
		float fw = max( vImpA.w, 0.5 );
		float fl = floor( vImpW.y / fh );
		float vm = vImpW.y - fl * fh;
		float pxm = max( max( fwidth( along ), fwidth( vImpW.y ) ), 1e-4 );
		float aa = pxm * 0.75;
		// vertical metres per pixel: storey BANDS survive after the window columns average out, so a
		// distant tower keeps its floor lines (Size IV–V) instead of reading as a flat slab
		float pxv = max( fwidth( vImpW.y ), 1e-4 );
		float aaV = pxv * 0.75;
		float lod2 = smoothstep( fh * 0.3, fh * 0.45, pxv );
		vec3 wallC = diffuseColor.rgb;
		float cwT = kind == 5.0 ? 1.6 : kind == 2.0 ? 1.9 : kind == 3.0 ? 1.3 : kind == 8.0 ? 3.6 : 3.0;
		float n = max( 1.0, floor( fw / cwT + 0.5 ) );
		float cw = fw / n;
		float u = along / cw + n * 0.5;
		float col = floor( u );
		float x = ( u - col - 0.5 ) * cw;
		float hw; float y0; float y1;
		if ( kind == 5.0 ) { hw = cw * 0.5 - 0.07; y0 = fh * 0.22; y1 = fh * 0.96; }
		else if ( kind == 2.0 ) { hw = cw * 0.5 - 0.08; y0 = 0.42; y1 = fh * 0.64; }
		else if ( kind == 3.0 ) { hw = cw * 0.5 - 0.07; y0 = fh * 0.64; y1 = fh * 0.86; }
		else if ( kind == 8.0 ) { hw = min( 1.15, cw * 0.34 ); y0 = fh * 0.17; y1 = fh * 0.9; }
		else { hw = min( 0.8, cw * 0.27 ); y0 = fh * 0.3; y1 = fh * 0.8; }
		vec3 baseC = kind == 5.0 ? mix( uImpFrame, wallC, 0.4 ) : wallC;
		float hc = clamp( 2.0 * hw / cw, 0.0, 1.0 );
		float cov = clamp( hc * ( ( y1 - y0 ) / fh ), 0.0, 1.0 );
		vec3 gAvg = mix( uImpGlass * 0.95, uImpGlassLit * 0.8, uImpLit );
		vec3 winAvg = mix( uImpFrame, gAvg, 0.75 );
		vec3 avg = mix( baseC, winAvg, cov );
		float lod = smoothstep( cw * 0.1, cw * 0.26, pxm );
		float bandH = hc * impBand( vm, y0, y1, aaV );
		vec3 far = mix( mix( baseC, winAvg, bandH ), avg, lod2 );
		vec3 eFar = uImpGlassLit * uImpWinGlow * uImpLit * 0.7 * mix( bandH, cov, lod2 );
		if ( lod > 0.999 ) {
			diffuseColor.rgb = far;
			impEmit = eFar;
		} else {
			float seed = impHash( vec2( vImpA.z * 0.173 + ( alongZ ? 5.1 : 0.0 ), fl * 1.37 + vImpA.w * 0.61 ) );
			float h = impHash( vec2( col * 0.731 + seed * 17.0, seed * 3.1 - col * 0.117 ) );
			float win = impIn( abs( x ), hw + 0.1, aa ) * impBand( vm, y0 - 0.1, y1 + 0.06, aa );
			float pane = impIn( abs( x ), hw, aa ) * impBand( vm, y0, y1, aa );
			float vv = clamp( ( vm - y0 ) / max( y1 - y0, 0.01 ), 0.0, 1.0 );
			vec3 glass = uImpGlass * ( 0.78 + 0.34 * h );
			glass = mix( glass, uImpSky, clamp( 0.1 + 0.28 * vv, 0.0, 0.8 ) );
			float lit = step( 1.0 - uImpLit, fract( h * 13.7 + seed * 3.3 ) );
			vec3 paneC = mix( glass, uImpGlassLit * ( 0.72 + 0.3 * h ), lit );
			vec3 detail = mix( baseC, uImpFrame, win );
			detail = mix( detail, paneC, pane );
			diffuseColor.rgb = mix( detail, far, lod );
			impEmit = mix( uImpGlassLit * uImpWinGlow * lit * pane * ( 0.75 + 0.35 * h ), eFar, lod );
		}
	}
`;

function makeImpostorMaterial(L: ImpLook): THREE.MeshToonMaterial {
  const m = makeToon({ vertexColors: true });
  m.name = 'cityImpostor';
  const U = {
    uImpGlass: { value: new THREE.Color().setRGB(L.glass[0], L.glass[1], L.glass[2]) },
    uImpGlassLit: { value: new THREE.Color().setRGB(L.glassLit[0], L.glassLit[1], L.glassLit[2]) },
    uImpFrame: { value: new THREE.Color().setRGB(L.frame[0], L.frame[1], L.frame[2]) },
    uImpSky: { value: new THREE.Color().setRGB(L.sky[0], L.sky[1], L.sky[2]) },
    uImpLit: { value: L.lit },
    uImpWinGlow: { value: L.winGlow },
    uImpGlow: { value: L.glow },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + IMP_VERT_PARS)
      .replace('#include <begin_vertex>', IMP_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + IMP_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + IMP_FRAG_MAIN)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += impEmit;');
  };
  m.customProgramCacheKey = () => 'blocktooth-cityview-impostor-v3';
  return m;
}

/** One shared dynamic buffer; every block owns a fixed vertex slot [start, start + cap).
 *  Slots are laid out CHUNK by chunk (IMP_CHUNK × IMP_CHUNK blocks), and every chunk is its own
 *  mesh (+ ink hull, + shadow caster) over the SAME BufferAttributes (one GPU buffer set, one upload
 *  path) with its own drawRange and bounding sphere, so three's frustum culling drops the chunks
 *  that are off screen / outside the shadow box. At Size V the live set covers the view: before the
 *  split ~91 % of the 2 × 48 k impostor triangles (+ its shadow pass) were vertex-shaded off screen
 *  every frame (the GPU is vertex-bound on the reference Intel UHD: ~10 ms per million triangles). */
class Impostors {
  readonly W: ImpWriter;
  readonly geos: THREE.BufferGeometry[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly mat: THREE.MeshToonMaterial;
  readonly start: Int32Array;
  readonly cap: Int32Array;
  readonly used: Int32Array;
  /** chunk of each block, and each chunk's vertex range [c0, c1) */
  private readonly chunkOf: Int32Array;
  private readonly c0: number[] = [];
  private readonly c1: number[] = [];
  /** chunk → its mesh (null when the chunk has no slot), and the vertices currently written per chunk */
  private readonly meshOf: (THREE.Mesh | null)[] = [];
  private readonly chunkUsed: Int32Array;
  private attrs: THREE.BufferAttribute[];
  constructor(caps: Int32Array, blocksX: number, look: ImpLook, parent: THREE.Object3D) {
    const n = caps.length;
    this.cap = caps;
    this.start = new Int32Array(n);
    this.used = new Int32Array(n);
    this.chunkOf = new Int32Array(n);
    const bz = Math.max(1, Math.ceil(n / Math.max(1, blocksX)));
    const cX = Math.max(1, Math.ceil(blocksX / IMP_CHUNK)), cZ = Math.max(1, Math.ceil(bz / IMP_CHUNK));
    const nC = cX * cZ;
    this.chunkUsed = new Int32Array(nC);
    for (let i = 0; i < n; i++) {
      const x = i % blocksX, z = Math.floor(i / blocksX);
      this.chunkOf[i] = Math.floor(x / IMP_CHUNK) + Math.floor(z / IMP_CHUNK) * cX;
    }
    let total = 0;
    for (let c = 0; c < nC; c++) {
      this.c0.push(total);
      for (let i = 0; i < n; i++) if (this.chunkOf[i] === c) { this.start[i] = total; total += caps[i]; }
      this.c1.push(total);
    }
    total = Math.max(3, total);
    this.W = new ImpWriter(total);
    const mk = (arr: Float32Array, size: number): THREE.BufferAttribute => {
      const a = new THREE.BufferAttribute(arr, size); a.setUsage(THREE.DynamicDrawUsage); return a;
    };
    const aPos = mk(this.W.pos, 3), aNrm = mk(this.W.nrm, 3), aCol = mk(this.W.col, 3), aOnr = mk(this.W.onr, 3), aImp = mk(this.W.imp, 4);
    this.attrs = [aPos, aNrm, aCol, aOnr, aImp];
    this.mat = makeImpostorMaterial(look);
    for (let c = 0; c < nC; c++) {
      this.meshOf.push(null);
      if (this.c1[c] <= this.c0[c]) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', aPos);
      g.setAttribute('normal', aNrm);
      g.setAttribute('color', aCol);
      g.setAttribute('outlineNormal', aOnr);
      g.setAttribute('aImp', aImp);
      g.setDrawRange(this.c0[c], this.c1[c] - this.c0[c]);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // fitted by fitBounds()
      const m = new THREE.Mesh(g, this.mat);
      m.name = 'city:impostors';
      m.frustumCulled = true;
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.impChunk = c;
      m.visible = false;                      // until something is written into the chunk
      addOutline(m, INK_PX);
      parent.add(m);
      this.meshOf[c] = m;
      this.geos.push(g);
      this.meshes.push(m);
    }
  }
  /** Fit every chunk's bounding sphere to what is written now (call after the initial full write:
   *  impostors only ever get LOWER — floors break, buildings collapse into lower mounds — so the
   *  full-height bounds stay conservative for the whole run). Zeroed (degenerate) vertices skipped. */
  fitBounds(): void {
    const P = this.W.pos;
    for (const g of this.geos) {
      const a = g.drawRange.start, b = a + g.drawRange.count;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let v = a; v < b; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        if (x === 0 && y === 0 && z === 0) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const bs = g.boundingSphere!;
      if (!(x1 >= x0)) { bs.center.set(0, -1e5, 0); bs.radius = 0; continue; }
      bs.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      // + a few metres for the mound (it can be wider than the tower's footprint) and the ink hull
      bs.radius = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0) + 8;
    }
  }
  /** Begin writing block `bi`: returns the writer positioned at the block's slot. */
  begin(bi: number): ImpWriter {
    const W = this.W;
    W.dry = false; W.v = this.start[bi]; W.lim = this.start[bi] + this.cap[bi];
    return W;
  }
  /** Finish block `bi`: zero the tail the previous content used, queue the GPU range upload. */
  end(bi: number): void {
    const W = this.W;
    const s = this.start[bi];
    const nowUsed = Math.min(W.v, W.lim) - s;
    const prev = this.used[bi];
    if (prev > nowUsed) this.zeroRange(s + nowUsed, prev - nowUsed);
    this.used[bi] = nowUsed;
    this.markRange(s, Math.max(prev, nowUsed));
    this.setChunkUsed(bi, nowUsed - prev);
  }
  clear(bi: number): void {
    const s = this.start[bi], u = this.used[bi];
    if (u > 0) { this.zeroRange(s, u); this.markRange(s, u); }
    this.used[bi] = 0;
    this.setChunkUsed(bi, -u);
  }
  /** a chunk with nothing written (all its blocks live, or empty) is not drawn at all — its zeroed
   *  slots would still be vertex-shaded as degenerate triangles */
  private setChunkUsed(bi: number, delta: number): void {
    const c = this.chunkOf[bi];
    this.chunkUsed[c] += delta;
    const m = this.meshOf[c];
    if (m) m.visible = this.chunkUsed[c] > 0;
  }
  private zeroRange(v0: number, nv: number): void {
    const W = this.W;
    W.pos.fill(0, v0 * 3, (v0 + nv) * 3);
    W.onr.fill(0, v0 * 3, (v0 + nv) * 3);
    W.imp.fill(0, v0 * 4, (v0 + nv) * 4);
  }
  private markRange(v0: number, nv: number): void {
    if (nv <= 0) return;
    for (const a of this.attrs) { a.addUpdateRange(v0 * a.itemSize, nv * a.itemSize); a.needsUpdate = true; }
  }
  dispose(): void { for (const g of this.geos) g.dispose(); this.mat.dispose(); }
}

// ─────────────────────────────── instanced batch ───────────────────────────────
/** InstancedMesh + ink hull with capacity grown on demand. Two usage modes:
 *   compact — begin()/push()/end() rewrites [0, n) (buildings, rubble);
 *   slots   — alloc()/set()/free() keep an instance at a STABLE index (props: the kit paints them by
 *             gl_InstanceID), count = highest used slot + 1, holes are zero-scale. */
class InstBatch {
  mesh!: THREE.InstancedMesh;
  /** the ink hull child (null when built without ink) — its own `visible` is the ink LOD switch */
  hull: THREE.Mesh | null = null;
  private inkOn = true;
  /** far LOD: the whole batch is skipped (sub-pixel street furniture at Size IV–V) */
  private hidden = false;
  cap = 0;
  n = 0;
  touched = false;
  readonly max: number;
  private readonly parent: THREE.Object3D;
  private readonly name: string;
  private geo: THREE.BufferGeometry;
  private readonly mat: THREE.Material;
  private readonly cast: boolean;
  private used: Uint8Array = new Uint8Array(0);
  private hi = 0;
  private freeHint = 0;
  private dLo = Infinity;
  private dHi = -1;
  private readonly ink: boolean;
  constructor(parent: THREE.Object3D, name: string, geo: THREE.BufferGeometry, mat: THREE.Material,
    cap0: number, max: number, cast: boolean, ink = true) {
    this.parent = parent; this.name = name; this.geo = geo; this.mat = mat; this.max = max; this.cast = cast; this.ink = ink;
    this.create(Math.max(1, Math.min(max, cap0)));
  }
  private create(cap: number): void {
    const old = this.mesh as THREE.InstancedMesh | undefined;
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.name = this.name;
    m.frustumCulled = false;
    m.castShadow = this.cast;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    ic.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = ic;
    if (old) {
      const k = Math.min(this.cap, cap);
      (m.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, k * 16));
      (ic.array as Float32Array).set((old.instanceColor!.array as Float32Array).subarray(0, k * 3));
      m.count = Math.min(old.count, cap);
      m.visible = old.visible && !this.hidden;
      this.parent.remove(old);
      old.dispose();
    } else {
      m.count = 0;
      m.visible = false;
    }
    this.hull = this.ink ? addOutline(m, INK_PX) : null;
    if (this.hull) this.hull.visible = this.inkOn;
    this.parent.add(m);
    this.mesh = m;
    if (this.used.length < cap) { const u = new Uint8Array(cap); u.set(this.used); this.used = u; }
    this.cap = cap;
    this.dLo = Infinity; this.dHi = -1;       // a fresh GPU buffer uploads whole on first use
  }
  /** geometry LOD swap (the ink hull follows the source geometry; survives buffer growth) */
  setGeometry(g: THREE.BufferGeometry): void {
    if (this.geo === g) return;
    this.geo = g;
    this.mesh.geometry = g;
  }
  /** far LOD: skip drawing the whole batch (slots stay allocated and keep updating) */
  setHidden(on: boolean): void {
    if (this.hidden === on) return;
    this.hidden = on;
    this.mesh.visible = !on && this.mesh.count > 0;
  }
  /** ink LOD: show/hide the outline hull (survives buffer growth) */
  setInk(on: boolean): void {
    if (this.inkOn === on) return;
    this.inkOn = on;
    if (this.hull) this.hull.visible = on;
  }
  ensure(need: number): void {
    if (need <= this.cap) return;
    this.create(Math.min(this.max, Math.max(need, this.cap * 2)));
  }
  private write(i: number, x: number, y: number, z: number, s: number, c: number, sx: number, sy: number, sz: number,
    r: number, g: number, b: number): void {
    const a = this.mesh.instanceMatrix.array as Float32Array, o = i * 16;
    a[o] = sx * c; a[o + 1] = 0; a[o + 2] = -sx * s; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = sz * s; a[o + 9] = 0; a[o + 10] = sz * c; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    const ca = this.mesh.instanceColor!.array as Float32Array, q = i * 3;
    ca[q] = r; ca[q + 1] = g; ca[q + 2] = b;
    if (i < this.dLo) this.dLo = i;
    if (i > this.dHi) this.dHi = i;
  }
  // ── compact mode ──
  begin(): void { this.n = 0; }
  push(x: number, y: number, z: number, s: number, c: number, sx: number, sy: number, sz: number, r: number, g: number, b: number): void {
    if (this.n >= this.cap) { if (this.cap >= this.max) return; this.ensure(this.n + 1); }
    this.write(this.n++, x, y, z, s, c, sx, sy, sz, r, g, b);
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0 && !this.hidden;
    if (this.n > 0) { this.dLo = 0; this.dHi = Math.max(this.dHi, this.n - 1); }
    this.flush();
  }
  // ── slot mode ──
  alloc(): number {
    let i = this.freeHint;
    while (i < this.cap && this.used[i]) i++;
    if (i >= this.cap) {
      if (this.cap >= this.max) return -1;
      this.ensure(this.cap + 1);
    }
    this.used[i] = 1;
    this.freeHint = i + 1;
    if (i + 1 > this.hi) this.hi = i + 1;
    return i;
  }
  free(i: number): void {
    if (i < 0 || i >= this.cap || !this.used[i]) return;
    this.used[i] = 0;
    this.write(i, 0, -1e4, 0, 0, 1, 0, 0, 0, 1, 1, 1);
    if (i < this.freeHint) this.freeHint = i;
    while (this.hi > 0 && !this.used[this.hi - 1]) this.hi--;
  }
  set(i: number, x: number, y: number, z: number, s: number, c: number, sx: number, sy: number, sz: number, r = 1, g = 1, b = 1): void {
    if (i >= 0 && i < this.cap) this.write(i, x, y, z, s, c, sx, sy, sz, r, g, b);
  }
  /** slot mode: publish count + upload the dirty range */
  commit(): void {
    this.touched = false;
    this.mesh.count = this.hi;
    this.mesh.visible = this.hi > 0 && !this.hidden;
    this.flush();
  }
  private flush(): void {
    if (this.dHi < this.dLo) return;
    const hi = Math.min(this.dHi, this.cap - 1);
    const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor!;
    // ranges accumulate until the renderer uploads them (WebGLAttributes clears them after upload)
    im.addUpdateRange(this.dLo * 16, (hi - this.dLo + 1) * 16);
    ic.addUpdateRange(this.dLo * 3, (hi - this.dLo + 1) * 3);
    im.needsUpdate = true; ic.needsUpdate = true;
    this.dLo = Infinity; this.dHi = -1;
  }
  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

interface ArchBatch {
  prof: ArchProf; base: InstBatch; floor: InstBatch; roof: InstBatch;
  /** see-through twins for buildings between the camera and the titan (dithered, no ink, still cast shadows) */
  gBase: InstBatch; gFloor: InstBatch; gRoof: InstBatch;
  ids: number[]; dirty: boolean;
}

// ─────────────────────────────── occluder see-through ───────────────────────────────
const GHOST_PARS = /* glsl */ `
float cgB2( vec2 p ) { p = mod( p, 2.0 ); return p.x < 0.5 ? ( p.y < 0.5 ? 0.0 : 0.5 ) : ( p.y < 0.5 ? 0.75 : 0.25 ); }
float cgB4( vec2 p ) { p = floor( p ); return cgB2( p ) + cgB2( floor( p * 0.5 ) ) * 0.25; }
`;
/** screen-door keep fraction for see-through occluders (ordered 4×4 dither; no sorting, no blending).
 *  0.42 kept the facade grid at full contrast over the titan (a muddy, ink-broken titan behind every
 *  ghost); 0.22 + a flat body colour reads as a pale veil. Overlapping ghosts share the same dither
 *  cells, so two ghost towers never stack darker than one. */
const GHOST_KEEP = 0.22;
/** Clone of a kit material whose fragments are screen-door dithered. The kit's own onBeforeCompile runs
 *  first (same facade shader + shared uniforms), then the discard is prepended and BK_FLAT drops the
 *  facade pattern (windows, bands, lit-window glow): a ghost is a flat vertex-coloured body. Ghost
 *  batches are built without ink hulls. */
function makeGhostMaterial(src: THREE.Material): THREE.Material {
  const g = src.clone();
  g.name = (src.name || 'kit') + ':ghost';
  const srcCompile = src.onBeforeCompile.bind(src);
  const key = src.customProgramCacheKey();
  g.onBeforeCompile = (shader, renderer) => {
    srcCompile(shader, renderer);
    shader.fragmentShader = '#define BK_FLAT\n' + shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GHOST_PARS)
      .replace('void main() {', 'void main() {\n\tif ( cgB4( gl_FragCoord.xy ) >= ' + GHOST_KEEP.toFixed(3) + ' ) discard;');
  };
  g.customProgramCacheKey = () => key + '|cityGhost';
  return g;
}
const GHOST_HOLD_S = 0.3;
/** a building that just lost a floor stays SOLID this long (the pancake drop + squash must read),
 *  unless it hides the titan's head */
const PANCAKE_SOLID_S = 1.5;
/** camera distance (m) beyond which street props and traffic stop casting shadows (Size IV–V framing) */
const TRAFFIC_SHADOW_MAX_D = 240;
/** camera distance (m) beyond which street props / vehicles drop their ink hull (Size IV–V framing) */
const PROP_INK_MAX_D = 240;
/** camera distance (m) beyond which vehicles draw their far LOD (kit PropMesh.lod, ~1/7 of the
 *  triangles): Size IV-V framing, where ~680 traffic vehicles are 10-20 px long */
const PROP_LOD_D = 240;
/** Street furniture that is under ~2 px at Size IV–V framing (hydrants 0.9 m, benches, bollards, drums,
 *  barriers, sign posts): not drawn beyond PROP_LOD_D — at that scale they only add speckle, draws and
 *  vertex work (~45k triangles at Size V in GRID-EAST). */
const PROP_FAR_HIDDEN_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['hydrant', 'bench', 'bollard', 'drum', 'barrier', 'signpost']);
/** Street props that can hide a small titan (Size I-II). Thin furniture (lamps, posts, hydrants,
 *  bollards, benches, barriers, drums) never hides one. */
const PROP_OCCLUDER_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['car', 'taxi', 'van', 'bus', 'truck', 'kiosk', 'vending', 'container', 'forklift', 'tree', 'boat', 'snowbank']);
/** a prop counts as an occluder when it is at least this fraction of the titan's height */
const PROP_OCCLUDE_H = 0.6;
/** highest rank index whose titan can hide behind street props (Size II) */
const PROP_OCCLUDE_MAX_RANK = 1;

// ─────────────────────────────── static ground geometry ───────────────────────────────
class GB {
  p: number[] = [];
  n: number[] = [];
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    nx: number, ny: number, nz: number): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    this.p.push(ax, ay, az);
    if (d >= 0) this.p.push(bx, by, bz, cx, cy, cz); else this.p.push(cx, cy, cz, bx, by, bz);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }
  quadY(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.tri(x0, y, z0, x1, y, z0, x1, y, z1, 0, 1, 0);
    this.tri(x0, y, z0, x1, y, z1, x0, y, z1, 0, 1, 0);
  }
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number): void {
    this.tri(ax, y0, az, bx, y0, bz, bx, y1, bz, nx, 0, nz);
    this.tri(ax, y0, az, bx, y1, bz, ax, y1, az, nx, 0, nz);
  }
  get empty(): boolean { return this.p.length === 0; }
  build(name: string): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.name = name;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Sidewalk ring of one block: raised top with rounded outer corners + its curb faces. */
function sidewalkRing(g: GB, cx: number, cz: number, top: number, bot: number): void {
  const o = CURB, i = PH, r = CURB_R, oc = o - r;
  g.quadY(cx - i, cz + i, cx + i, cz + o, top);
  g.quadY(cx - i, cz - o, cx + i, cz - i, top);
  g.quadY(cx + i, cz - i, cx + o, cz + i, top);
  g.quadY(cx - o, cz - i, cx - i, cz + i, top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // corner fan from the inner corner over the rounded outer corner
    const ax = cx + sx * i, az = cz + sz * i;
    const pts: number[] = [cx + sx * o, cz + sz * i, cx + sx * o, cz + sz * oc];
    for (let k = 1; k < CURB_SEG; k++) {
      const t = (k / CURB_SEG) * Math.PI / 2;
      pts.push(cx + sx * (oc + r * Math.cos(t)), cz + sz * (oc + r * Math.sin(t)));
    }
    pts.push(cx + sx * oc, cz + sz * o, cx + sx * i, cz + sz * o);
    for (let k = 0; k + 3 < pts.length; k += 2) g.tri(ax, top, az, pts[k], top, pts[k + 1], pts[k + 2], top, pts[k + 3], 0, 1, 0);
    // curb faces around this corner arc
    for (let k = 0; k < CURB_SEG; k++) {
      const t0 = (k / CURB_SEG) * Math.PI / 2, t1 = ((k + 1) / CURB_SEG) * Math.PI / 2, tm = (t0 + t1) / 2;
      g.wall(cx + sx * (oc + r * Math.cos(t0)), cz + sz * (oc + r * Math.sin(t0)), cx + sx * (oc + r * Math.cos(t1)), cz + sz * (oc + r * Math.sin(t1)),
        bot, top, sx * Math.cos(tm), sz * Math.sin(tm));
    }
  }
  // straight curb faces
  g.wall(cx + o, cz - oc, cx + o, cz + oc, bot, top, 1, 0);
  g.wall(cx - o, cz - oc, cx - o, cz + oc, bot, top, -1, 0);
  g.wall(cx - oc, cz + o, cx + oc, cz + o, bot, top, 0, 1);
  g.wall(cx - oc, cz - o, cx + oc, cz - o, bot, top, 0, -1);
}

// ─────────────────────────────── the view ───────────────────────────────
export class CityView implements ViewModule {
  private readonly ctx: ViewCtx;
  private root: THREE.Group | null = null;
  private kit: CityKit | null = null;
  private city: CityLayout | null = null;
  private look: ImpLook | null = null;
  private curbH = CURB_H_DRY;
  private owned: { dispose(): void }[] = [];

  // blocks / live set
  private nBlocks = 0;
  private live = new Uint8Array(0);
  private impDirty = new Uint8Array(0);
  private impQueue: number[] = [];
  private liveKX = NaN;
  private liveKZ = NaN;
  private liveRank = -1;
  private liveCount = 0;

  // buildings
  private arches: ArchBatch[] = [];
  private archOf = new Int16Array(0);        // building → arches index (−1 unknown archetype)
  private vAlive = new Int16Array(0);        // storeys the view shows standing
  private impAlive = new Int16Array(0);      // alive value last written into the impostor (−2 never)
  private drop = new Float32Array(0);        // stack fall offset (m)
  private vel = new Float32Array(0);
  private acc = new Float32Array(0);
  private sqT = new Float32Array(0);         // squash timer (−1 none)
  private sinkT = new Float32Array(0);       // collapse sink timer (−1 none)
  private sinkN = new Int16Array(0);         // storeys sinking
  private rubT = new Float32Array(0);        // rubble rise timer (−1 = settled)
  private tint = new Float32Array(0);        // per-building instanceColor tint
  private animFlag = new Uint8Array(0);
  private anim: number[] = [];
  private ghostT = new Float32Array(0);      // > 0 while the building is drawn see-through (s left)
  private breakT = new Float32Array(0);      // > 0 for PANCAKE_SOLID_S after a floorBreak (never ghosted)
  private ghostMats: THREE.Material[] = [];
  private rubble: InstBatch | null = null;
  private rubbleDirty = true;
  private sweepB = 0;
  private sweepP = 0;

  // props
  private propBatch = new Map<PropKind, InstBatch>();
  private propSlot = new Int32Array(0);
  private propY = new Float32Array(0);
  private traffic: number[] = [];
  private propTouched: InstBatch[] = [];      // prop batches with slot writes this frame (commit list)
  private propLod = new Map<PropKind, { full: THREE.BufferGeometry; lod: THREE.BufferGeometry }>();
  // see-through street props (Size I-II): dithered twin batch per occluder kind
  private propGhost = new Map<PropKind, InstBatch>();
  private propGSlot = new Int32Array(0);      // slot in the ghost twin (-1 none)
  private propGT = new Float32Array(0);       // > 0 while the prop is drawn see-through (s left)
  private propGList: number[] = [];           // props with propGT > 0 or a ghost slot
  private propGFlag = new Uint8Array(0);      // membership of propGList
  private propBox = new Map<PropKind, THREE.Box3>();

  private impostors: Impostors | null = null;
  private readonly _tintRGB: RGB = [1, 1, 1];

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
  }

  // ─────────────────────────────── mount ───────────────────────────────
  mount(world: World): void {
    this.unmount();
    const city = world.city;
    const biome = BIOMES[world.biomeId];
    this.city = city;
    this.curbH = city.flooded ? CURB_H_FLOOD : CURB_H_DRY;
    const kit = buildCityKit(biome);
    this.kit = kit;
    const look = impLook(biome);
    {
      // impostor mounds take the kit heap's own colours (snowy in WHITE STACKS, dusty elsewhere)
      const rp = analyzePiece(kit.rubble, 20, 8);
      look.rubbleSide = rp.all;
      if (rp.hasTop) look.rubbleTop = rp.top;
    }
    this.look = look;
    const root = new THREE.Group();
    root.name = 'cityview';
    this.root = root;
    this.ctx.scene.add(root);

    const nB = city.buildings.length, nP = city.props.length;
    this.nBlocks = city.blocksX * city.blocksZ;
    this.live = new Uint8Array(this.nBlocks);
    this.impDirty = new Uint8Array(this.nBlocks);
    this.impQueue = [];
    this.archOf = new Int16Array(nB).fill(-1);
    this.vAlive = new Int16Array(nB);
    this.impAlive = new Int16Array(nB).fill(-2);
    this.drop = new Float32Array(nB);
    this.vel = new Float32Array(nB);
    this.acc = new Float32Array(nB);
    this.sqT = new Float32Array(nB).fill(-1);
    this.sinkT = new Float32Array(nB).fill(-1);
    this.sinkN = new Int16Array(nB);
    this.rubT = new Float32Array(nB).fill(-1);
    this.tint = new Float32Array(nB * 3);
    this.animFlag = new Uint8Array(nB);
    this.ghostT = new Float32Array(nB);
    this.breakT = new Float32Array(nB);
    this.anim = [];
    this.propSlot = new Int32Array(nP).fill(-1);
    this.propGSlot = new Int32Array(nP).fill(-1);
    this.propGT = new Float32Array(nP);
    this.propGFlag = new Uint8Array(nP);
    this.propGList = [];
    this.propY = new Float32Array(nP);
    this.traffic = [];

    // ── archetype batches (sized for the live set; grown on demand up to the city total) ──
    const archIndex = new Map<string, number>();
    const counts: { n: number; floors: number; roofs: number }[] = [];
    for (const a of biome.archetypes) {
      const am = kit.arch[a.id];
      if (!am) continue;
      archIndex.set(a.id, this.arches.length);
      counts.push({ n: 0, floors: 0, roofs: 0 });
      const nil = null as unknown as InstBatch;
      this.arches.push({ prof: buildArchProf(a, am), base: nil, floor: nil, roof: nil, gBase: nil, gFloor: nil, gRoof: nil, ids: [], dirty: true });
    }
    for (const b of city.buildings) {
      const ai = archIndex.get(b.arch) ?? -1;
      this.archOf[b.id] = ai;
      this.vAlive[b.id] = b.collapsed ? 0 : b.alive;
      // palette variation: ±10 % brightness + a slight per-building hue lean (instanceColor tint)
      const v = b.variant;
      const k = 0.9 + 0.18 * v;
      const hr = hash01(b.id, 11), hg = hash01(b.id, 23), hb = hash01(b.id, 37);
      this.tint[b.id * 3] = clamp(k * (1 + 0.05 * (hr - 0.5)), 0.85, 1.1);
      this.tint[b.id * 3 + 1] = clamp(k * (1 + 0.04 * (hg - 0.5)), 0.85, 1.1);
      this.tint[b.id * 3 + 2] = clamp(k * (1 + 0.06 * (hb - 0.5)), 0.85, 1.1);
      if (ai < 0) continue;
      const c = counts[ai];
      c.n++;
      if (b.floors >= 2) { c.roofs++; c.floors += Math.max(0, b.floors - 2); }
    }
    const R = CITY.liveRadiusByRank[4];
    const liveFrac = Math.min(1, ((2 * R + 2) * (2 * R + 2)) / Math.max(1, this.nBlocks));
    const ghostOf = new Map<THREE.Material, THREE.Material>();
    this.arches.forEach((ab, i) => {
      const am = kit.arch[ab.prof.a.id];
      const c = counts[i];
      const est = (n: number) => Math.max(8, Math.ceil(n * liveFrac * 0.6));
      ab.base = new InstBatch(root, 'city:' + ab.prof.a.id + ':base', am.base, am.material, est(c.n), Math.max(1, c.n), true);
      ab.floor = new InstBatch(root, 'city:' + ab.prof.a.id + ':floor', am.floor, am.material, est(c.floors), Math.max(1, c.floors), true);
      ab.roof = new InstBatch(root, 'city:' + ab.prof.a.id + ':roof', am.roof, am.material, est(c.roofs), Math.max(1, c.roofs), true);
      let gm = ghostOf.get(am.material);
      if (!gm) { gm = makeGhostMaterial(am.material); ghostOf.set(am.material, gm); this.ghostMats.push(gm); }
      ab.gBase = new InstBatch(root, 'city:' + ab.prof.a.id + ':base:ghost', am.base, gm, 2, Math.max(1, c.n), true, false);
      ab.gFloor = new InstBatch(root, 'city:' + ab.prof.a.id + ':floor:ghost', am.floor, gm, 8, Math.max(1, c.floors), true, false);
      ab.gRoof = new InstBatch(root, 'city:' + ab.prof.a.id + ':roof:ghost', am.roof, gm, 2, Math.max(1, c.roofs), true, false);
    });
    this.rubble = new InstBatch(root, 'city:rubble', kit.rubble, kit.facade, 16, Math.max(1, nB), true);
    this.rubbleDirty = true;

    // ── props ──
    const kindCount = new Map<PropKind, number>();
    for (const p of city.props) kindCount.set(p.kind, (kindCount.get(p.kind) ?? 0) + 1);
    for (const [kind, n] of kindCount) {
      const pm = kit.props[kind];
      if (!pm) continue;
      this.propBatch.set(kind, new InstBatch(root, 'city:prop:' + kind, pm.geo, pm.material, Math.min(n, 32), n, true));
      if (pm.lod) this.propLod.set(kind, { full: pm.geo, lod: pm.lod });
      if (PROP_OCCLUDER_KINDS.has(kind)) {
        let gm = ghostOf.get(pm.material);
        if (!gm) { gm = makeGhostMaterial(pm.material); ghostOf.set(pm.material, gm); this.ghostMats.push(gm); }
        this.propGhost.set(kind, new InstBatch(root, 'city:prop:' + kind + ':ghost', pm.geo, gm, 4, n, true, false));
        if (!pm.geo.boundingBox) pm.geo.computeBoundingBox();
        this.propBox.set(kind, pm.geo.boundingBox!.clone());
      }
    }
    for (const p of city.props) {
      if (p.lane >= 0) this.traffic.push(p.id);
      this.propY[p.id] = p.kind === 'boat' ? BOAT_Y : this.onSlab(p.x, p.z) ? this.curbH : 0;
    }

    // ── ground + paint ──
    this.buildGround(city, biome, kit, root);
    this.buildPaint(city, biome, root);

    // ── impostors: slot capacity per block = Σ max(full building, mound) ──
    const caps = new Int32Array(this.nBlocks);
    const probe = new ImpWriter(1);
    probe.dry = true;
    const tint = this._tintRGB;
    for (const b of city.buildings) {
      const ai = this.archOf[b.id];
      if (ai < 0 || b.block < 0 || b.block >= this.nBlocks) continue;
      const ap = this.arches[ai].prof;
      probe.v = 0;
      writeImpostor(probe, { ...b, collapsed: false, alive: b.floors }, b.floors, ap, tint, look);
      const full = probe.v;
      probe.v = 0;
      writeMound(probe, b, ap, tint, look);
      caps[b.block] += Math.max(full, probe.v);
    }
    this.impostors = new Impostors(caps, city.blocksX, look, root);
    for (let bi = 0; bi < this.nBlocks; bi++) this.writeBlockImpostor(bi);
    this.impostors.fitBounds();

    // ── initial live set ──
    this.liveKX = NaN; this.liveKZ = NaN; this.liveRank = -1;
    this.evalLive(world, world.titan.x, world.titan.z, true);
    this.rebuildDirty();
    for (const pb of this.propBatch.values()) pb.commit();
  }

  // ─────────────────────────────── update ───────────────────────────────
  update(world: World, f: FrameInfo): void {
    const city = this.city;
    if (!city || !this.root || world.city !== city) return;

    // 1. events
    const ev = f.events;
    for (let i = 0; i < ev.length; i++) this.onEvent(ev[i]);

    // 2. consistency sweep (state changes that arrived without an event)
    this.sweep(city);

    // 3. live set (titan crossed a half-block line or ranked up)
    const T = world.titan;
    const tx = T.px + (T.x - T.px) * f.alpha, tz = T.pz + (T.z - T.pz) * f.alpha;
    this.evalLive(world, tx, tz, false);

    // 3b. live buildings standing between the camera and the titan go see-through
    this.updateOccluders(world, tx, tz, Math.min(0.1, Math.max(0, f.dt)));

    // 4. destruction animation
    this.animate(Math.min(0.1, Math.max(0, f.dt)));

    // 5. rebuild dirty instance batches
    this.rebuildDirty();

    // 6. traffic + prop uploads
    // Ink LOD: at Size IV–V framing a prop/vehicle is a few pixels tall and its 1.6 px hull turns it
    // into an ink blob while costing a full extra vertex pass (≈ 600k triangles at Size V; ≈ 6 ms of
    // the frame on the reference Intel UHD, EXT_disjoint_timer_query A/B). Buildings keep their ink.
    // The same framing drops street-furniture/vehicle shadows (1–2 px at Size V, a full extra pass).
    const propInk = f.camDist < PROP_INK_MAX_D;
    const propCast = f.camDist < TRAFFIC_SHADOW_MAX_D;
    const propFar = f.camDist >= PROP_LOD_D;
    for (const [kind, pb] of this.propBatch) {
      pb.setInk(propInk);
      if (pb.mesh.castShadow !== propCast) pb.mesh.castShadow = propCast;
      const l = this.propLod.get(kind);
      if (l) pb.setGeometry(propFar ? l.lod : l.full);
      if (PROP_FAR_HIDDEN_KINDS.has(kind)) pb.setHidden(propFar);
    }
    this.updatePropOccluders(world, city, tx, tz, f, Math.min(0.1, Math.max(0, f.dt)));
    this.updateTraffic(city, tx, tz, f);
    for (let i = 0; i < this.propTouched.length; i++) this.propTouched[i].commit();
    this.propTouched.length = 0;

    // 7. queued impostor rewrites
    let budget = IMP_BLOCKS_PER_FRAME;
    while (budget > 0 && this.impQueue.length) {
      const bi = this.impQueue.shift()!;
      this.impDirty[bi] = 0;
      if (this.live[bi]) continue;
      this.writeBlockImpostor(bi);
      budget--;
    }
  }

  // ─────────────────────────────── unmount ───────────────────────────────
  unmount(): void {
    if (this.root) this.ctx.scene.remove(this.root);
    for (const ab of this.arches) {
      ab.base.dispose(); ab.floor.dispose(); ab.roof.dispose();
      ab.gBase.dispose(); ab.gFloor.dispose(); ab.gRoof.dispose();
    }
    this.arches = [];
    for (const m of this.ghostMats) m.dispose();
    this.ghostMats = [];
    this.rubble?.dispose();
    this.rubble = null;
    for (const pb of this.propBatch.values()) pb.dispose();
    this.propBatch.clear();
    for (const pb of this.propGhost.values()) pb.dispose();
    this.propGhost.clear();
    this.propLod.clear();
    this.propBox.clear();
    this.propGList = [];
    this.propTouched.length = 0;
    this.impostors?.dispose();
    this.impostors = null;
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.kit?.dispose();
    this.kit = null;
    this.root = null;
    this.city = null;
    this.look = null;
    this.anim = [];
    this.impQueue = [];
  }

  // ─────────────────────────────── ground ───────────────────────────────
  /** true if (x,z) stands on a raised sidewalk / parcel slab (inside a block's curb box) */
  private onSlab(x: number, z: number): boolean {
    const c = this.city!;
    const fx = (x - c.originX) / P, fz = (z - c.originZ) / P;
    const bx = Math.floor(fx), bz = Math.floor(fz);
    if (bx < 0 || bz < 0 || bx >= c.blocksX || bz >= c.blocksZ) return false;
    const lx = Math.abs((fx - bx - 0.5) * P), lz = Math.abs((fz - bz - 0.5) * P);
    if (lx > CURB + 0.02 || lz > CURB + 0.02) return false;
    const oc = CURB - CURB_R;
    if (lx > oc && lz > oc) return Math.hypot(lx - oc, lz - oc) <= CURB_R + 0.02;
    return true;
  }

  private buildGround(city: CityLayout, biome: BiomeDef, kit: CityKit, root: THREE.Group): void {
    const top = this.curbH, bot = city.flooded ? -0.04 : -0.02;
    const W = city.blocksX * P, D = city.blocksZ * P;
    // road plane (not in LOCKWATER: the flood water owns the streets)
    if (!city.flooded) {
      const g = new GB();
      g.quadY(city.originX - RH, city.originZ - RH, city.originX + W + RH, city.originZ + D + RH, 0);
      const geo = g.build('city:road');
      const m = new THREE.Mesh(geo, kit.ground.road);
      m.name = 'city:road';
      m.receiveShadow = true;
      root.add(m);
      this.owned.push(geo);
    }
    const lot = new GB(), plaza = new GB();
    const paveInSidewalk = biome.id === 'grideast';
    const harbourRow = city.flooded ? 0 : -1;
    for (let bz = 0; bz < city.blocksZ; bz++) {
      const row = new GB();
      for (let bx = 0; bx < city.blocksX; bx++) {
        const bi = bx + bz * city.blocksX;
        const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
        sidewalkRing(row, cx, cz, top, bot);
        const park = city.blockBuildings[bi].length === 0 && bz !== harbourRow;
        if (park) plaza.quadY(cx - PH, cz - PH, cx + PH, cz + PH, top);
        else if (paveInSidewalk) row.quadY(cx - PH, cz - PH, cx + PH, cz + PH, top);
        else lot.quadY(cx - PH, cz - PH, cx + PH, cz + PH, top);
      }
      const geo = row.build('city:sidewalk:' + bz);
      const m = new THREE.Mesh(geo, kit.ground.sidewalk);
      m.name = 'city:sidewalk:' + bz;
      m.receiveShadow = true;
      root.add(m);
      this.owned.push(geo);
    }
    for (const [g, mat, name] of [[lot, kit.ground.lot, 'city:lots'], [plaza, kit.ground.plaza, 'city:plazas']] as const) {
      if (g.empty) continue;
      const geo = g.build(name);
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.receiveShadow = true;
      root.add(m);
      this.owned.push(geo);
    }
  }

  /** lane markings + stop lines + zebra stripes: one instanced quad batch */
  private buildPaint(city: CityLayout, biome: BiomeDef, root: THREE.Group): void {
    const pal = biome.palette;
    const line = lin(pal.roadLine), zebra = lin(pal.crosswalk);
    const lineC = city.flooded ? mulc(line, 0.8) : line;
    const quads: number[] = [];                  // x, z, sx, sz, r, g, b
    const add = (x: number, z: number, sx: number, sz: number, c: RGB) => { quads.push(x, z, sx, sz, c[0], c[1], c[2]); };
    const SEG0 = 12.2;                            // markings start this far from a junction centre
    const STOP = 11.6;
    // Z-running roads
    for (let i = 0; i <= city.blocksX; i++) {
      const xc = city.originX + i * P;
      for (let j = 0; j < city.blocksZ; j++) {
        const za = city.originZ + j * P, zb = za + P;
        const s0 = za + SEG0, s1 = zb - SEG0, len = s1 - s0, mid = (s0 + s1) / 2;
        add(xc - 0.16, mid, 0.12, len, lineC); add(xc + 0.16, mid, 0.12, len, lineC);
        for (const lx of [-CITY.laneW, CITY.laneW]) for (let s = s0 + 1.5; s + 3 <= s1; s += 8) add(xc + lx, s + 1.5, 0.12, 3, lineC);
        add(xc - 3.55, zb - STOP, 6.5, 0.4, lineC);     // +Z traffic (x < centre) stops before junction zb
        add(xc + 3.55, za + STOP, 6.5, 0.4, lineC);     // −Z traffic stops before junction za
      }
    }
    // X-running roads
    for (let j = 0; j <= city.blocksZ; j++) {
      const zc = city.originZ + j * P;
      for (let i = 0; i < city.blocksX; i++) {
        const xa = city.originX + i * P, xb = xa + P;
        const s0 = xa + SEG0, s1 = xb - SEG0, len = s1 - s0, mid = (s0 + s1) / 2;
        add(mid, zc - 0.16, len, 0.12, lineC); add(mid, zc + 0.16, len, 0.12, lineC);
        for (const lz of [-CITY.laneW, CITY.laneW]) for (let s = s0 + 1.5; s + 3 <= s1; s += 8) add(s + 1.5, zc + lz, 3, 0.12, lineC);
        add(xb - STOP, zc + 3.55, 0.4, 6.5, lineC);     // +X traffic (z > centre)
        add(xa + STOP, zc - 3.55, 0.4, 6.5, lineC);     // −X traffic
      }
    }
    // zebra crossings: bars run along the road, repeated across it (axis = walking direction)
    for (const cw of city.crosswalks) {
      const period = 1.2, bar = 0.6;
      const nBars = Math.max(1, Math.floor((cw.len - bar) / period) + 1);
      const span = (nBars - 1) * period;
      const depth = cw.width * 0.92;
      for (let k = 0; k < nBars; k++) {
        const o = -span / 2 + k * period;
        if (cw.axis === 'z') add(cw.x, cw.z + o, depth, bar, zebra);
        else add(cw.x + o, cw.z, bar, depth, zebra);
      }
    }
    const n = quads.length / 7;
    if (n === 0) return;
    const gb = new GB();
    gb.quadY(-0.5, -0.5, 0.5, 0.5, 0);          // unit quad, winding forced to face +Y
    const g = gb.build('city:paintQuad');
    const mat = makeToon({ color: '#ffffff' });
    mat.name = 'city:paint';
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -4;
    const m = new THREE.InstancedMesh(g, mat, n);
    m.name = 'city:paint';
    m.receiveShadow = true;
    m.castShadow = false;
    m.frustumCulled = false;
    const a = m.instanceMatrix.array as Float32Array;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const q = i * 7, o = i * 16;
      a.fill(0, o, o + 16);
      a[o] = quads[q + 2]; a[o + 5] = 1; a[o + 10] = quads[q + 3]; a[o + 15] = 1;
      a[o + 12] = quads[q]; a[o + 13] = PAINT_Y; a[o + 14] = quads[q + 1];
      col[i * 3] = quads[q + 4]; col[i * 3 + 1] = quads[q + 5]; col[i * 3 + 2] = quads[q + 6];
    }
    m.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    m.instanceMatrix.needsUpdate = true;
    root.add(m);
    this.owned.push(g, mat, { dispose: () => m.dispose() });
  }

  // ─────────────────────────────── live set ───────────────────────────────
  private evalLive(world: World, tx: number, tz: number, force: boolean): void {
    const city = this.city!;
    const rank = world.titan.rank;
    const fx = (tx - city.originX) / P, fz = (tz - city.originZ) / P;
    const kx = Math.floor(fx * 2), kz = Math.floor(fz * 2);
    if (!force && kx === this.liveKX && kz === this.liveKZ && rank === this.liveRank) return;
    this.liveKX = kx; this.liveKZ = kz; this.liveRank = rank;
    const R = CITY.liveRadiusByRank[rank] ?? 2;
    let changed = false;
    let count = 0;
    for (let bz = 0; bz < city.blocksZ; bz++) {
      for (let bx = 0; bx < city.blocksX; bx++) {
        const bi = bx + bz * city.blocksX;
        const d = Math.max(Math.abs(bx + 0.5 - fx), Math.abs(bz + 0.5 - fz));
        const was = this.live[bi] === 1;
        const now = d <= R + 0.5 || (was && d <= R + 1.0);
        if (now) count++;
        if (now === was) continue;
        changed = true;
        if (now) this.enterBlock(bi); else this.leaveBlock(bi);
      }
    }
    this.liveCount = count;
    if (!changed) return;
    for (const ab of this.arches) { ab.ids.length = 0; ab.dirty = true; }
    for (let bi = 0; bi < this.nBlocks; bi++) {
      if (!this.live[bi]) continue;
      for (const id of city.blockBuildings[bi]) {
        const ai = this.archOf[id];
        if (ai >= 0) this.arches[ai].ids.push(id);
      }
    }
    this.rubbleDirty = true;
  }

  private enterBlock(bi: number): void {
    const city = this.city!;
    this.live[bi] = 1;
    // buildings: snap view state to the sim (no stale animations), impostor slot → empty
    for (const id of city.blockBuildings[bi]) {
      const b = city.buildings[id];
      this.snapBuilding(b);
    }
    this.impostors!.clear(bi);
    // static props of the block
    for (const id of city.blockProps[bi]) {
      const p = city.props[id];
      if (p.lane >= 0 || !p.alive || this.propSlot[id] >= 0 || this.propGSlot[id] >= 0) continue;
      this.placeProp(id, p.kind, p.x, this.propY[id], p.z, p.heading);
    }
  }

  private leaveBlock(bi: number): void {
    const city = this.city!;
    this.live[bi] = 0;
    for (const id of city.blockBuildings[bi]) this.snapBuilding(city.buildings[id]);
    this.writeBlockImpostor(bi);
    for (const id of city.blockProps[bi]) {
      if (city.props[id].lane >= 0) continue;
      this.dropProp(id);
    }
  }

  /** view state = sim state, no animation in flight */
  private snapBuilding(b: Building): void {
    const id = b.id;
    this.vAlive[id] = b.collapsed ? 0 : b.alive;
    this.drop[id] = 0; this.vel[id] = 0; this.acc[id] = 0;
    this.sqT[id] = -1; this.sinkT[id] = -1; this.sinkN[id] = 0; this.rubT[id] = -1;
  }

  private writeBlockImpostor(bi: number): void {
    const city = this.city!, imp = this.impostors!, look = this.look!;
    const W = imp.begin(bi);
    const tint = this._tintRGB;
    for (const id of city.blockBuildings[bi]) {
      const b = city.buildings[id];
      const ai = this.archOf[id];
      const alive = b.collapsed ? 0 : b.alive;
      this.impAlive[id] = alive;
      if (ai < 0) continue;
      tint[0] = this.tint[id * 3]; tint[1] = this.tint[id * 3 + 1]; tint[2] = this.tint[id * 3 + 2];
      writeImpostor(W, b, alive, this.arches[ai].prof, tint, look);
    }
    imp.end(bi);
  }

  private queueImpostor(bi: number): void {
    if (bi < 0 || bi >= this.nBlocks || this.live[bi] || this.impDirty[bi]) return;
    this.impDirty[bi] = 1;
    this.impQueue.push(bi);
  }

  // ─────────────────────────────── events ───────────────────────────────
  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'floorBreak': this.onFloorBreak(e.id, e.remaining); break;
      case 'buildingCollapse': this.onCollapse(e.id); break;
      case 'propDestroyed': this.hideProp(e.id); break;
      default: break;
    }
  }

  private onFloorBreak(id: number, remaining: number): void {
    const city = this.city!;
    const b = city.buildings[id];
    if (!b) return;
    if (!this.live[b.block]) { this.queueImpostor(b.block); return; }
    const old = this.vAlive[id];
    const k = old - remaining;
    if (k <= 0) return;
    this.breakT[id] = PANCAKE_SOLID_S;
    const ab = this.arches[this.archOf[id]];
    if (remaining > 0) {
      this.vAlive[id] = remaining;
      const fh = b.floorH;
      if (this.drop[id] <= 0) {
        // at rest: an isolated fall of k floors (k = 1 → exactly easeInCubic over DROP_T)
        this.vel[id] = 0; this.acc[id] = 0;
        this.drop[id] = k * fh;
      } else {
        // already falling (rapid chew): the stack keeps at least full landing speed and never
        // floats more than MAX_GAP floors above its rest height — a chewed tower slides down
        // instead of hovering while floors vanish beneath it
        const d = Math.min(this.drop[id] + k * fh, Math.max(MAX_GAP * fh, k * fh));
        this.drop[id] = d;
        this.vel[id] = Math.max(this.vel[id], (3 * d) / DROP_T);
      }
      this.sqT[id] = -1;
    } else {
      // last floor: the whole remaining stack sinks into the footprint
      this.vAlive[id] = 0;
      this.sinkN[id] = old;
      this.sinkT[id] = 0;
      this.sqT[id] = -1;
    }
    this.startAnim(id);
    if (ab) ab.dirty = true;
  }

  private onCollapse(id: number): void {
    const city = this.city!;
    const b = city.buildings[id];
    if (!b) return;
    if (!this.live[b.block]) { this.queueImpostor(b.block); return; }
    if (this.vAlive[id] > 0 && this.sinkT[id] < 0) {
      this.sinkN[id] = this.vAlive[id];
      this.sinkT[id] = 0;
      this.vAlive[id] = 0;
    }
    this.rubT[id] = 0;
    this.rubbleDirty = true;
    this.startAnim(id);
    const ab = this.arches[this.archOf[id]];
    if (ab) ab.dirty = true;
  }

  private touch(pb: InstBatch): void {
    if (pb.touched) return;
    pb.touched = true;
    this.propTouched.push(pb);
  }

  private hideProp(id: number): void {
    if (!this.city!.props[id]) return;
    this.dropProp(id);
  }

  /** Draw prop `id` at (x, y, z, heading) in its normal batch, or in the see-through twin while it
   *  hides a small titan; migrates the slot between the two when that state flips. */
  private placeProp(id: number, kind: PropKind, x: number, y: number, z: number, h: number): void {
    const pb = this.propBatch.get(kind);
    if (!pb) return;
    const gb = this.propGhost.get(kind);
    const sn = Math.sin(h), cs = Math.cos(h);
    if (gb && this.propGT[id] > 0) {
      if (this.propSlot[id] >= 0) { pb.free(this.propSlot[id]); this.propSlot[id] = -1; this.touch(pb); }
      let s = this.propGSlot[id];
      if (s < 0) { s = gb.alloc(); if (s < 0) return; this.propGSlot[id] = s; }
      gb.set(s, x, y, z, sn, cs, 1, 1, 1);
      this.touch(gb);
    } else {
      if (gb && this.propGSlot[id] >= 0) { gb.free(this.propGSlot[id]); this.propGSlot[id] = -1; this.touch(gb); }
      let s = this.propSlot[id];
      if (s < 0) { s = pb.alloc(); if (s < 0) return; this.propSlot[id] = s; }
      pb.set(s, x, y, z, sn, cs, 1, 1, 1);
      this.touch(pb);
    }
  }

  /** Remove prop `id` from whichever batch draws it. */
  private dropProp(id: number): void {
    const kind = this.city!.props[id].kind;
    const s = this.propSlot[id];
    if (s >= 0) {
      const pb = this.propBatch.get(kind);
      if (pb) { pb.free(s); this.touch(pb); }
      this.propSlot[id] = -1;
    }
    const g = this.propGSlot[id];
    if (g >= 0) {
      const gb = this.propGhost.get(kind);
      if (gb) { gb.free(g); this.touch(gb); }
      this.propGSlot[id] = -1;
    }
  }

  private sweep(city: CityLayout): void {
    const nB = city.buildings.length;
    for (let k = 0; k < SWEEP_PER_FRAME && nB > 0; k++) {
      const id = this.sweepB++ % nB;
      const b = city.buildings[id];
      const simAlive = b.collapsed ? 0 : b.alive;
      if (this.live[b.block]) {
        const shown = this.vAlive[id];
        if (shown > simAlive) {
          this.onFloorBreak(id, simAlive);
          if (b.collapsed) this.onCollapse(id);
        } else if (shown < simAlive) {
          this.snapBuilding(b);
          const ab = this.arches[this.archOf[id]];
          if (ab) ab.dirty = true;
          this.rubbleDirty = true;
        } else if (b.collapsed && this.rubT[id] < 0 && this.sinkT[id] < 0) {
          // collapsed in a live block: the rubble batch must include it (cheap no-op when it does)
        }
      } else if (this.impAlive[id] !== simAlive) {
        this.queueImpostor(b.block);
      }
    }
    const nP = city.props.length;
    for (let k = 0; k < SWEEP_PER_FRAME && nP > 0; k++) {
      const id = this.sweepP++ % nP;
      if ((this.propSlot[id] >= 0 || this.propGSlot[id] >= 0) && !city.props[id].alive) this.hideProp(id);
    }
  }

  // ─────────────────────────────── animation ───────────────────────────────
  private startAnim(id: number): void {
    if (this.animFlag[id]) return;
    this.animFlag[id] = 1;
    this.anim.push(id);
  }

  private animate(dt: number): void {
    const city = this.city!;
    const list = this.anim;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const b = city.buildings[id];
      let active = false;
      if (this.drop[id] > 0) {
        // constant jerk j = 6·fh/T³ → an isolated one-floor fall is exactly easeInCubic over DROP_T
        const jerk = (6 * b.floorH) / (DROP_T * DROP_T * DROP_T);
        this.acc[id] += jerk * dt;
        this.vel[id] += this.acc[id] * dt;
        this.drop[id] -= this.vel[id] * dt;
        if (this.drop[id] <= 0) {
          this.drop[id] = 0; this.vel[id] = 0; this.acc[id] = 0;
          if (this.vAlive[id] > 0) this.sqT[id] = 0;
        }
        active = true;
      }
      if (this.sqT[id] >= 0) {
        this.sqT[id] += dt;
        if (this.sqT[id] >= SQUASH_T) this.sqT[id] = -1; else active = true;
      }
      if (this.sinkT[id] >= 0) {
        this.sinkT[id] += dt;
        if (this.sinkT[id] >= SINK_T) { this.sinkT[id] = -1; this.sinkN[id] = 0; this.drop[id] = 0; } else active = true;
      }
      if (this.rubT[id] >= 0) {
        this.rubT[id] += dt;
        if (this.rubT[id] >= RISE_T) this.rubT[id] = -1; else active = true;
        this.rubbleDirty = true;
      }
      const ab = this.arches[this.archOf[id]];
      if (ab) ab.dirty = true;
      if (active && this.live[b.block]) list[w++] = id;
      else { this.animFlag[id] = 0; if (!this.live[b.block]) this.snapBuilding(b); }
    }
    list.length = w;
  }

  // ─────────────────────────────── instance rebuild ───────────────────────────────
  private rebuildDirty(): void {
    const city = this.city!;
    for (const ab of this.arches) {
      if (!ab.dirty) continue;
      ab.dirty = false;
      ab.base.begin(); ab.floor.begin(); ab.roof.begin();
      ab.gBase.begin(); ab.gFloor.begin(); ab.gRoof.begin();
      for (const id of ab.ids) this.pushBuilding(city.buildings[id], ab);
      ab.base.end(); ab.floor.end(); ab.roof.end();
      ab.gBase.end(); ab.gFloor.end(); ab.gRoof.end();
    }
    if (this.rubbleDirty && this.rubble) {
      this.rubbleDirty = false;
      const rb = this.rubble;
      rb.begin();
      for (let bi = 0; bi < this.nBlocks; bi++) {
        if (!this.live[bi]) continue;
        for (const id of city.blockBuildings[bi]) {
          const b = city.buildings[id];
          if (!b.collapsed) continue;
          const u = this.rubT[id] >= 0 ? clamp(this.rubT[id] / RISE_T, 0, 1) : 1;
          const rise = 0.15 + 0.85 * easeOutBack(u);
          const h = pileHeight(b) * rise;
          const flip = (id & 1) === 1;
          rb.push(b.x, 0, b.z, flip ? 0 : 0, flip ? -1 : 1, b.w * 1.12, h, b.d * 1.12,
            this.tint[id * 3], this.tint[id * 3 + 1], this.tint[id * 3 + 2]);
        }
      }
      rb.end();
    }
  }

  private pushBuilding(b: Building, ab: ArchBatch): void {
    const id = b.id;
    const F = b.floors, fh = b.floorH;
    let shown = this.vAlive[id];
    let yOff = this.drop[id];
    if (shown <= 0) {
      if (this.sinkT[id] < 0 || this.sinkN[id] <= 0) return;
      shown = this.sinkN[id];
      const u = clamp(this.sinkT[id] / SINK_T, 0, 1);
      yOff -= easeInCubic(u) * (shown * fh + 1);
    }
    let sy = 1, sxz = 1;
    if (this.sqT[id] >= 0) {
      const u = clamp(this.sqT[id] / SQUASH_T, 0, 1);
      const s = SQUASH_AMP * (1 - u) * (1 - u) * Math.cos(u * Math.PI * 2.5);
      sy = 1 - s; sxz = 1 + s * 0.5;
    }
    const r = this.tint[id * 3], g = this.tint[id * 3 + 1], bl = this.tint[id * 3 + 2];
    const i0 = F - shown;
    const sx = b.w * sxz, sz = b.d * sxz, h = fh * sy;
    const ghost = this.ghostT[id] > 0;
    for (let i = i0; i < F; i++) {
      const j = i - i0;
      const y = (j * fh + Math.max(0, yOff)) * sy + Math.min(0, yOff);
      const pc = pieceOf(i, F);
      const batch = ghost
        ? (pc === 0 ? ab.gBase : pc === 1 ? ab.gFloor : ab.gRoof)
        : (pc === 0 ? ab.base : pc === 1 ? ab.floor : ab.roof);
      batch.push(b.x, y, b.z, 0, 1, sx, h, sz, r, g, bl);
    }
  }

  // ─────────────────────────────── occluders ───────────────────────────────
  /** Live buildings whose box cuts a sight line from the camera to the titan (chest, head, both
   *  shoulders, crown, feet, and the snout / muzzle / tail reach along the heading) are drawn
   *  see-through — EVERY storey, via the dithered twin batches — until GHOST_HOLD_S after they clear.
   *  The whole occluding piece ghosts: a band that stopped at the highest crossed storey left a
   *  chimney's solid upper storeys over MOLO's snout while its base was ghosted (critic F04).
   *  A building that lost a floor in the last PANCAKE_SOLID_S never ghosts: the pancake drop, squash
   *  and roof riding the stack are the payoff and must read in full. */
  private updateOccluders(world: World, tx: number, tz: number, dt: number): void {
    const city = this.city!;
    const cam = this.ctx.camera.position;
    const T = world.titan;
    const H = Math.max(0.5, T.height), r = Math.max(0.3, T.radius);
    // screen-right on the ground for the fixed 45° yaw camera; points pulled toward the camera by r
    const rx = Math.SQRT1_2, rz = -Math.SQRT1_2;
    let fx = cam.x - tx, fz = cam.z - tz;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    // heading (model +Z = world (sin h, cos h)) and the titan's own nose / tail reach
    const hx = Math.sin(T.heading), hz = Math.cos(T.heading);
    const reach = TITAN_REACH[T.id] ?? REACH_DEFAULT;
    const nose = Math.max(r, reach[0] * H), tail = Math.min(-r, reach[1] * H);
    const px = _sight;
    px[0] = tx + fx * r; px[1] = H * 0.55; px[2] = tz + fz * r;
    px[3] = tx + fx * r * 0.5; px[4] = H * 0.92; px[5] = tz + fz * r * 0.5;
    px[6] = tx + rx * r * 0.8 + fx * r * 0.5; px[7] = H * 0.45; px[8] = tz + rz * r * 0.8 + fz * r * 0.5;
    px[9] = tx - rx * r * 0.8 + fx * r * 0.5; px[10] = H * 0.45; px[11] = tz - rz * r * 0.8 + fz * r * 0.5;
    px[12] = tx + fx * r * 0.3; px[13] = H * 1.04; px[14] = tz + fz * r * 0.3;
    px[15] = tx + fx * r; px[16] = H * 0.08; px[17] = tz + fz * r;
    px[18] = tx + hx * nose * 0.92; px[19] = H * 0.7; px[20] = tz + hz * nose * 0.92;     // snout tip
    px[21] = tx + hx * nose * 0.55; px[22] = H * 0.88; px[23] = tz + hz * nose * 0.55;    // muzzle root / brow
    px[24] = tx + hx * tail * 0.75; px[25] = H * 0.22; px[26] = tz + hz * tail * 0.75;    // tail
    for (const ab of this.arches) {
      for (const id of ab.ids) {
        const b = city.buildings[id];
        let hit = false;
        const shown = this.vAlive[id];
        const chewed = this.breakT[id] > 0;
        if (chewed) this.breakT[id] = Math.max(0, this.breakT[id] - dt);
        if (!chewed && shown > 0 && !b.collapsed) {
          const top = (shown + 0.3) * b.floorH;
          const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
          for (let k = 0; k < SIGHT_N && !hit; k += 3) {
            hit = segHitsBox(cam.x, cam.y, cam.z, px[k], px[k + 1], px[k + 2], x0, 0, z0, x1, top, z1);
          }
        }
        const was = this.ghostT[id] > 0;
        if (hit) this.ghostT[id] = GHOST_HOLD_S;
        else if (chewed) this.ghostT[id] = 0;                 // pancake: solid at once, every storey
        else if (was) this.ghostT[id] = Math.max(0, this.ghostT[id] - dt);
        if (was !== (this.ghostT[id] > 0)) ab.dirty = true;
      }
    }
  }

  /** Size I-II: street props (vehicles, kiosks, vending machines, containers, trees...) that cut a
   *  sight line from the camera to the titan are drawn see-through like buildings. Uses the sight
   *  points updateOccluders() just wrote into _sight. Static props migrate here; traffic migrates
   *  when updateTraffic() places it this frame (placeProp reads propGT). */
  private updatePropOccluders(world: World, city: CityLayout, tx: number, tz: number, f: FrameInfo, dt: number): void {
    const T = world.titan;
    const active = T.rank <= PROP_OCCLUDE_MAX_RANK && this.propGhost.size > 0;
    const list = this.propGList;
    // 1. decay every flagged prop
    for (let i = 0; i < list.length; i++) { const id = list[i]; if (this.propGT[id] > 0) this.propGT[id] = Math.max(0, this.propGT[id] - dt); }
    // 2. flag props that hide the titan now
    if (active) {
      const cam = this.ctx.camera.position;
      const H = Math.max(0.5, T.height);
      const minH = H * PROP_OCCLUDE_H;
      const reach = 6 + 3 * H;                 // props farther than this from the titan cannot cut the sight lines
      const reach2 = reach * reach;
      const a = f.alpha;
      const px = _sight;
      const test = (id: number, kind: PropKind, x: number, y: number, z: number, h: number): void => {
        const bb = this.propBox.get(kind);
        if (!bb || bb.max.y < minH) return;
        const dx = x - tx, dz = z - tz;
        if (dx * dx + dz * dz > reach2) return;
        // sight segments into the prop's local frame (instance matrix = translate * rotY(h))
        const sn = Math.sin(h), cs = Math.cos(h);
        const ox = cam.x - x, oz = cam.z - z;
        const cx = cs * ox - sn * oz, cz = sn * ox + cs * oz, cy = cam.y - y;
        let hit = false;
        for (let k = 0; k < SIGHT_N && !hit; k += 3) {
          const qx = px[k] - x, qz = px[k + 2] - z;
          hit = segHitsBox(cx, cy, cz, cs * qx - sn * qz, px[k + 1] - y, sn * qx + cs * qz,
            bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z);
        }
        if (!hit) return;
        this.propGT[id] = GHOST_HOLD_S;
        if (!this.propGFlag[id]) { this.propGFlag[id] = 1; list.push(id); }
      };
      // static props of the titan's block and its 8 neighbours
      const fx = Math.floor((tx - city.originX) / P), fz = Math.floor((tz - city.originZ) / P);
      for (let bz = fz - 1; bz <= fz + 1; bz++) for (let bx = fx - 1; bx <= fx + 1; bx++) {
        if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) continue;
        for (const id of city.blockProps[bx + bz * city.blocksX]) {
          const p = city.props[id];
          if (p.lane >= 0 || !p.alive || !this.propGhost.has(p.kind)) continue;
          test(id, p.kind, p.x, this.propY[id], p.z, p.heading);
        }
      }
      // traffic near the titan (interpolated exactly as updateTraffic draws it)
      for (let i = 0; i < this.traffic.length; i++) {
        const id = this.traffic[i];
        const p = city.props[id];
        if (!p.alive || !this.propGhost.has(p.kind)) continue;
        const x = p.px + (p.x - p.px) * a, z = p.pz + (p.z - p.pz) * a;
        const dx = x - tx, dz = z - tz;
        if (dx * dx + dz * dz > reach2) continue;
        test(id, p.kind, x, p.kind === 'boat' ? BOAT_Y : 0, z, p.pheading + wrapAngle(p.heading - p.pheading) * a);
      }
    }
    // 3. static props whose state flipped move between batches now; drop settled entries
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const p = city.props[id];
      const want = this.propGT[id] > 0;
      const inGhost = this.propGSlot[id] >= 0;
      if (p.lane < 0 && p.alive && want !== inGhost && (this.propSlot[id] >= 0 || inGhost)) {
        this.placeProp(id, p.kind, p.x, this.propY[id], p.z, p.heading);
      }
      if (want || this.propGSlot[id] >= 0) list[w++] = id; else this.propGFlag[id] = 0;
    }
    list.length = w;
  }

  // ─────────────────────────────── traffic ───────────────────────────────
  private updateTraffic(city: CityLayout, tx: number, tz: number, f: FrameInfo): void {
    const a = f.alpha;
    // Draw radius = the farthest visible ground point from the look target (+ margin). For the §4
    // camera (fov 30°, pitch 36–44°) the far frame corner sits at about (0.55 + 0.25·aspect)·D; the
    // old 1.6·D drew every car in the city at Size IV–V (770 cars × 3 passes ≈ 13 ms of GPU on the
    // reference Intel UHD, measured with EXT_disjoint_timer_query) for vehicles far off screen.
    const aspect = this.ctx.camera.aspect > 0 ? this.ctx.camera.aspect : 16 / 9;
    const R = clamp(f.camDist * (0.55 + 0.25 * aspect) + 40, 90, 6000), R2 = R * R;

    for (let i = 0; i < this.traffic.length; i++) {
      const id = this.traffic[i];
      const p = city.props[id];
      const pb = this.propBatch.get(p.kind);
      if (!pb) continue;
      if (!p.alive) {
        this.dropProp(id);
        continue;
      }
      const x = p.px + (p.x - p.px) * a, z = p.pz + (p.z - p.pz) * a;
      const dx = x - tx, dz = z - tz;
      if (dx * dx + dz * dz > R2) {
        this.dropProp(id);
        continue;
      }
      const h = p.pheading + wrapAngle(p.heading - p.pheading) * a;
      this.placeProp(id, p.kind, x, p.kind === 'boat' ? BOAT_Y : 0, z, h);
    }
  }
}
