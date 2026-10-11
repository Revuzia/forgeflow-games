// GENESIS — procedural buildings (CONTRACT.md §15.6 "Buildings"): kit-built meshes per (archetype, material, style,
// era, mood, LOD). No boxes-for-houses: walls have real thickness and openings (reveals, sills, recessed glass, doors,
// shutters, frames), roofs are slabs with thickness and overhang (thatch, tile, slate, shingle, hide, flat with
// parapets, cones, domes, hips, gambrels), with chimneys, ridge caps, porches, steps, timber framing, quoins and trim.
//
// Local frame: +Y up, origin at the footprint centre at the level of the highest ground corner (the instancer sets
// that), front (door) toward +Z, width along X. Plinths and piles run 4 m below 0 so a building on a slope meets the
// ground on every side (the terrain hides what is underground).
//
// Each mesh also reports EMITTERS (chimney smoke, hearth fires, kiln / forge mouths, factory stacks, beacons,
// braziers) for the particle and light systems, and its height (construction clipping, ruins, burning).
//
// Style 0..7 (culture) picks palettes and options (pitch, porch, shutter colours); mood (−1 fearful … +1 benevolent)
// turns walls dark and adds spikes and braziers, or warm colours and open courts; era refines materials and forms.

import type { BufferGeometry } from 'three';
import { KitBuilder, PART, mixc, mulc, type V3 } from './meshkit.ts';
import { SURF, type BuildFamily, type BuildingKind, type MaterialLook } from '../life/catalog.ts';
import { Rng } from '../../sim/core/rng.ts';

type RGB = [number, number, number];

export interface BuildingSpec {
  kind: BuildingKind;
  mat: MaterialLook;
  style: number;
  era: number;
  /** −1 fearful, 0 neutral, +1 benevolent */
  mood: number;
  w: number;
  d: number;
  lod: number;
  /** the people's building tradition (their dwellings), for temples: earthen, timber or masonry */
  family?: BuildFamily;
  /**
   * household variant 0..HOUSEHOLD_VARIANTS-1 (dwellings): each household builds its own way within its culture's
   * style — its own colours, roof pitch, door and chimney placement, an annex, a porch or a door hood, window boxes
   * (a street of one culture is never one model repeated)
   */
  hv?: number;
}

/** household variants per dwelling archetype (buildings.ts picks one per building by a hash of its id) */
export const HOUSEHOLD_VARIANTS = 6;

/** emitter kinds shared with render/fx/particles.ts and render/life/nightlights.ts */
export const EMIT = { smoke: 0, hearth: 1, mouth: 2, stack: 3, beacon: 4, brazier: 5, blink: 6, blaze: 7 } as const;
export interface Emitter { p: V3; kind: number; size: number }

export interface BuildingMesh {
  geo: BufferGeometry;
  /** top of the structure (m above 0) */
  height: number;
  /** half extents of the footprint incl. overhangs (m) */
  hx: number;
  hz: number;
  /** the footprint's extent incl. overhangs and annexes: min x, max x, min z, max z (m) */
  ext: [number, number, number, number];
  emitters: Emitter[];
}

// ───────────────────────────── palettes (linear albedo) ─────────────────────────────

const PLASTER: RGB[] = [[0.6, 0.57, 0.5], [0.56, 0.42, 0.24], [0.58, 0.41, 0.34], [0.42, 0.46, 0.48], [0.64, 0.6, 0.47], [0.5, 0.48, 0.44], [0.62, 0.5, 0.33], [0.55, 0.36, 0.25]];
const TRIM: RGB[] = [[0.05, 0.16, 0.08], [0.04, 0.09, 0.2], [0.26, 0.04, 0.03], [0.07, 0.045, 0.03], [0.3, 0.2, 0.04], [0.025, 0.025, 0.028], [0.12, 0.2, 0.22], [0.2, 0.08, 0.12]];
// fired clay roof tiles: earthy, weathered reds and browns (bright orange read as a toy town under the grade)
const TILE: RGB[] = [[0.34, 0.13, 0.065], [0.28, 0.11, 0.065], [0.38, 0.17, 0.08], [0.25, 0.12, 0.08]];
const WOOD_DARK: RGB = [0.11, 0.07, 0.04];
const WOOD: RGB = [0.2, 0.13, 0.075];
const WOOD_GREY: RGB = [0.22, 0.2, 0.17];
const THATCH: RGB = [0.34, 0.26, 0.14];
const SLATE: RGB = [0.085, 0.09, 0.1];
const SHINGLE: RGB = [0.16, 0.11, 0.07];
const STONE: RGB = [0.36, 0.34, 0.31];
const STONE_DARK: RGB = [0.11, 0.105, 0.1];
const ASH: RGB = [0.05, 0.045, 0.04];
const HIDE: RGB = [0.36, 0.25, 0.15];
const IRON: RGB = [0.06, 0.06, 0.065];
const INTERIOR: RGB = [0.05, 0.04, 0.03];
const GLASS: RGB = [0.03, 0.035, 0.04];
const CLOTH: RGB[] = [[0.5, 0.08, 0.05], [0.06, 0.2, 0.42], [0.55, 0.42, 0.08], [0.1, 0.3, 0.12], [0.5, 0.48, 0.42], [0.35, 0.08, 0.25]];
const CONCRETE: RGB = [0.42, 0.41, 0.38];
const GOLD: RGB = [0.62, 0.42, 0.1];

// ───────────────────────────── kit pieces ─────────────────────────────

/**
 * An opening in a wall from (x0, y0) to (x1, y1). `head` turns its top into an arch whose crown is y1: 'round' (a
 * semicircle) or 'pointed' (a lancet of two arcs, `rise` high; default 0.9 × the width) — the wall fills the corners
 * above the springing and the arch's soffit runs through the wall's thickness.
 */
interface Opening { x0: number; x1: number; y0: number; y1: number; kind: 'window' | 'door' | 'arch' | 'gap'; head?: 'round' | 'pointed'; rise?: number }

interface WallLook {
  surf: number;
  col: RGB;
  inner: RGB;
  frameCol: RGB;
  sillSurf: number;
  sillCol: RGB;
  shutters: RGB | null;
  doorCol: RGB;
  mullions: boolean;
  lod: number;
}

/**
 * A wall along local +X from 0 to L, outer face at z = 0 facing +Z, thickness T inward, height H, with openings.
 * Solid parts are boxes (so every opening has reveals, a sill and a soffit); glass is recessed, doors are plank
 * panels, windows get frames, sills and (optionally) open shutters.
 */
function wallPanel(k: KitBuilder, L: number, H: number, T: number, ops: Opening[], look: WallLook, rng: Rng): void {
  const sorted = ops.filter((o) => o.x0 > 0.05 && o.x1 < L - 0.05 && o.y1 <= H + 1e-6).sort((a, b) => a.x0 - b.x0);
  const solid = (xa: number, xb: number, ya: number, yb: number, revealL: boolean, revealR: boolean, soffit: boolean) => {
    if (xb - xa < 1e-3 || yb - ya < 1e-3) return;
    const aoA = ya < 0.05 ? 0.72 : 0.92, aoB = yb > H - 0.05 ? 0.86 : 0.95;
    k.quad([xa, ya, 0], [xb, ya, 0], [xb, yb, 0], [xa, yb, 0], look.surf, PART.wall, look.col, [aoA, aoA, aoB, aoB]);
    k.quad([xb, ya, -T], [xa, ya, -T], [xa, yb, -T], [xb, yb, -T], SURF.plaster, PART.wall, look.inner, 0.5);
    if (yb > H - 1e-6) k.quad([xa, yb, 0], [xb, yb, 0], [xb, yb, -T], [xa, yb, -T], look.surf, PART.wall, look.col, 0.8);
    if (soffit) k.quad([xa, ya, -T], [xb, ya, -T], [xb, ya, 0], [xa, ya, 0], look.surf, PART.wall, look.col, 0.55);
    if (revealL || xa < 1e-6) k.quad([xa, ya, -T], [xa, ya, 0], [xa, yb, 0], [xa, yb, -T], look.surf, PART.wall, look.col, revealL ? 0.6 : 0.9);
    if (revealR || xb > L - 1e-6) k.quad([xb, ya, 0], [xb, ya, -T], [xb, yb, -T], [xb, yb, 0], look.surf, PART.wall, look.col, revealR ? 0.6 : 0.9);
  };
  let x = 0;
  for (const o of sorted) {
    if (o.x0 < x) continue;
    solid(x, o.x0, 0, H, x > 0, true, false);
    // sill wall below, lintel wall above (its underside is the opening's soffit)
    if (o.y0 > 0) {
      solid(o.x0, o.x1, 0, o.y0, false, false, false);
      // the sill's top inside the opening
      k.quad([o.x0, o.y0, 0], [o.x1, o.y0, 0], [o.x1, o.y0, -T], [o.x0, o.y0, -T], look.surf, PART.wall, look.col, 0.7);
    }
    if (o.y1 < H) solid(o.x0, o.x1, o.y1, H, false, false, true);
    fillOpening(k, o, T, look, rng);
    if (o.head) archHead(k, o, T, look);
    x = o.x1;
  }
  solid(x, L, 0, H, x > 0, false, false);
}

function fillOpening(k: KitBuilder, o: Opening, T: number, look: WallLook, rng: Rng): void {
  const w = o.x1 - o.x0, h = o.y1 - o.y0;
  if (o.kind === 'gap') return;
  if (o.kind === 'door' || o.kind === 'arch') {
    const z = -T * 0.6;
    const sd = rng.float();
    k.quad([o.x0, o.y0, z], [o.x1, o.y0, z], [o.x1, o.y1, z], [o.x0, o.y1, z], SURF.planks, PART.door, look.doorCol, 0.55, sd);
    if (look.lod === 0) {
      // frame (square-headed doors) and a step
      const f = 0.07;
      if (!o.head) {
        k.box(o.x0 - f, o.y0, -T * 0.6, o.x0, o.y1 + f, 0.02, SURF.beam, PART.frame, look.frameCol, { skip: ['bottom', 'nz'] });
        k.box(o.x1, o.y0, -T * 0.6, o.x1 + f, o.y1 + f, 0.02, SURF.beam, PART.frame, look.frameCol, { skip: ['bottom', 'nz'] });
        k.box(o.x0 - f, o.y1, -T * 0.6, o.x1 + f, o.y1 + f, 0.02, SURF.beam, PART.frame, look.frameCol, { skip: ['nz'] });
      }
      if (o.y0 < 0.05) k.box(o.x0 - 0.15, -0.3, 0, o.x1 + 0.15, 0.04, 0.38, look.sillSurf, PART.trim, look.sillCol, { skip: ['bottom'], aoLow: 0.6 });
    }
    return;
  }
  // window: recessed glass, frame, mullions, sill, shutters
  const zg = -T * 0.45;
  const seed = rng.float();
  k.quad([o.x0, o.y0, zg], [o.x1, o.y0, zg], [o.x1, o.y1, zg], [o.x0, o.y1, zg], SURF.glass, PART.glass, GLASS, 1, seed);
  if (look.lod > 0) return;
  const f = Math.min(0.07, w * 0.08);
  const fz0 = zg - 0.02, fz1 = zg + 0.05;
  k.box(o.x0, o.y0, fz0, o.x0 + f, o.y1, fz1, SURF.beam, PART.frame, look.frameCol, { skip: ['nz', 'top', 'bottom'] });
  k.box(o.x1 - f, o.y0, fz0, o.x1, o.y1, fz1, SURF.beam, PART.frame, look.frameCol, { skip: ['nz', 'top', 'bottom'] });
  k.box(o.x0, o.y1 - f, fz0, o.x1, o.y1, fz1, SURF.beam, PART.frame, look.frameCol, { skip: ['nz', 'top'] });
  k.box(o.x0, o.y0, fz0, o.x1, o.y0 + f, fz1, SURF.beam, PART.frame, look.frameCol, { skip: ['nz', 'bottom'] });
  if (look.mullions && w > 0.55) {
    const mx = (o.x0 + o.x1) / 2, my = o.y0 + h * 0.62;
    k.box(mx - f * 0.4, o.y0, fz0, mx + f * 0.4, o.y1, fz1 - 0.02, SURF.beam, PART.frame, look.frameCol, { skip: ['nz', 'top', 'bottom'] });
    k.box(o.x0, my - f * 0.4, fz0, o.x1, my + f * 0.4, fz1 - 0.02, SURF.beam, PART.frame, look.frameCol, { skip: ['nz'] });
  }
  // sill
  k.box(o.x0 - 0.06, o.y0 - 0.07, -0.02, o.x1 + 0.06, o.y0, 0.09, look.sillSurf, PART.trim, look.sillCol, { skip: ['nz'], aoLow: 0.7 });
  if (look.shutters && !o.head) {
    const sw = w / 2;
    // open shutters folded back against the wall, a little ajar
    k.box(o.x0 - sw - 0.01, o.y0, 0.01, o.x0 - 0.01, o.y1, 0.05, SURF.planks, PART.trim, look.shutters, { skip: ['nz'], aoLow: 0.85 });
    k.box(o.x1 + 0.01, o.y0, 0.01, o.x1 + sw + 0.01, o.y1, 0.05, SURF.planks, PART.trim, look.shutters, { skip: ['nz'], aoLow: 0.85 });
  }
}

/**
 * The half arch from the left springing (x0, ys) to the crown (mid, ys + h): a circle centred on the springing line
 * (round: radius w/2; pointed: the radius that makes the two arcs meet at height h).
 */
function archHalf(x0: number, x1: number, ys: number, h: number, n: number): [number, number][] {
  const w = x1 - x0, mid = (x0 + x1) / 2;
  const R = Math.max(w / 2, (h * h + (w * w) / 4) / w);
  const cx = x0 + R;
  const th0 = Math.PI, th1 = Math.acos(Math.max(-1, Math.min(1, (mid - cx) / R)));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((th1 - th0) * i) / n;
    out.push([cx + R * Math.cos(th), ys + R * Math.sin(th)]);
  }
  out[n] = [mid, ys + h];
  return out;
}

/** a triangle facing +nz (or −nz): ordered so its normal points that way */
function triFacing(k: KitBuilder, a: V3, b: V3, c: V3, nz: number, surf: number, part: number, col: RGB, ao = 1): void {
  const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cz * nz >= 0) k.triangle(a, b, c, surf, part, col, ao); else k.triangle(a, c, b, surf, part, col, ao);
}

/**
 * The arched head of an opening (wall frame: along +X, outer face z = 0, inner face z = −T): the wall's corners above
 * the springing filled on both faces, and the arch's soffit through the wall (with a dressed-stone voussoir ring on
 * masonry walls).
 */
function archHead(k: KitBuilder, o: Opening, T: number, look: WallLook): void {
  const w = o.x1 - o.x0;
  const h = o.head === 'round' ? w / 2 : Math.min(o.y1 - o.y0 - 0.05, o.rise ?? w * 0.9);
  const ys = o.y1 - h;
  const n = look.lod === 0 ? 7 : 3;
  const left = archHalf(o.x0, o.x1, ys, h, n);
  const right = left.map(([x, y]) => [o.x0 + o.x1 - x, y] as [number, number]);
  const ring = look.surf === SURF.ashlar || look.surf === SURF.rubble || look.surf === SURF.brick;
  const ringCol = look.surf === SURF.brick ? mulc(look.col, 0.85) : mulc(look.col, 1.08);
  for (const [half, cx] of [[left, o.x0], [right, o.x1]] as [[number, number][], number][]) {
    const corner: V3 = [cx, o.y1, 0], cornerI: V3 = [cx, o.y1, -T];
    for (let i = 0; i < half.length - 1; i++) {
      const [ax, ay] = half[i], [bx, by] = half[i + 1];
      triFacing(k, corner, [ax, ay, 0], [bx, by, 0], 1, look.surf, PART.wall, look.col, 0.9);
      triFacing(k, cornerI, [ax, ay, -T], [bx, by, -T], -1, SURF.plaster, PART.wall, look.inner, 0.5);
      // the soffit: its normal points into the opening (toward the arch's axis, below the curve)
      const sa: V3 = [ax, ay, 0], sb: V3 = [bx, by, 0], sc: V3 = [bx, by, -T], sd: V3 = [ax, ay, -T];
      const nx = -(by - ay), ny = bx - ax; // the quad's normal direction as wound below
      const inward = nx * ((o.x0 + o.x1) / 2 - (ax + bx) / 2) + ny * (ys - (ay + by) / 2) > 0 ? 1 : -1;
      if (inward > 0) k.quad(sa, sb, sc, sd, look.surf, PART.wall, look.col, 0.6); else k.quad(sb, sa, sd, sc, look.surf, PART.wall, look.col, 0.6);
      if (ring && look.lod === 0) {
        // voussoirs: a slightly proud band of dressed stone round the arch on the outer face
        const r = 0.2;
        const pa: V3 = [ax, ay, 0.015], pb: V3 = [bx, by, 0.015];
        const la = Math.hypot(ax - (o.x0 + o.x1) / 2, ay - ys) || 1, lb = Math.hypot(bx - (o.x0 + o.x1) / 2, by - ys) || 1;
        const qa: V3 = [ax + ((ax - (o.x0 + o.x1) / 2) / la) * r, ay + ((ay - ys) / la) * r, 0.015];
        const qb: V3 = [bx + ((bx - (o.x0 + o.x1) / 2) / lb) * r, by + ((by - ys) / lb) * r, 0.015];
        triFacing(k, pa, pb, qb, 1, SURF.ashlar, PART.trim, ringCol, 0.95);
        triFacing(k, pa, qb, qa, 1, SURF.ashlar, PART.trim, ringCol, 0.95);
      }
    }
  }
}

/** evenly spaced windows across a wall of length L for one storey */
function windowRow(L: number, y0: number, wh: [number, number], spacing: number, margin: number, avoid: [number, number] | null, kind: Opening['kind'] = 'window'): Opening[] {
  const out: Opening[] = [];
  const n = Math.max(0, Math.floor((L - 2 * margin + spacing - wh[0]) / spacing));
  if (n <= 0) return out;
  const span = (n - 1) * spacing;
  const start = L / 2 - span / 2;
  for (let i = 0; i < n; i++) {
    const cx = start + i * spacing;
    const o: Opening = { x0: cx - wh[0] / 2, x1: cx + wh[0] / 2, y0, y1: y0 + wh[1], kind };
    if (avoid && o.x1 > avoid[0] - 0.25 && o.x0 < avoid[1] + 0.25) continue;
    out.push(o);
  }
  return out;
}

interface Walls {
  W: number; D: number; H: number; T: number; y0: number;
  front: Opening[]; back: Opening[]; left: Opening[]; right: Opening[];
}

/** four walls of a rectangular storey block (front +Z, back −Z, right +X, left −X) */
function boxWalls(k: KitBuilder, wl: Walls, look: WallLook, rng: Rng): void {
  const { W, D, H, T, y0 } = wl;
  k.push(-W / 2, y0, D / 2, 0); wallPanel(k, W, H, T, wl.front, look, rng); k.pop();
  k.push(W / 2, y0, -D / 2, Math.PI); wallPanel(k, W, H, T, wl.back, look, rng); k.pop();
  k.push(W / 2, y0, D / 2 - T, Math.PI / 2); wallPanel(k, D - 2 * T, H, T, wl.right, look, rng); k.pop();
  k.push(-W / 2, y0, -D / 2 + T, -Math.PI / 2); wallPanel(k, D - 2 * T, H, T, wl.left, look, rng); k.pop();
  // a dark floor inside (seen through doors and windows)
  k.quad([-W / 2 + T, y0 + 0.02, D / 2 - T], [W / 2 - T, y0 + 0.02, D / 2 - T], [W / 2 - T, y0 + 0.02, -D / 2 + T], [-W / 2 + T, y0 + 0.02, -D / 2 + T], SURF.planks, PART.wall, INTERIOR, 0.4);
}

interface RoofLook { surf: number; col: RGB; under: RGB; underSurf: number; thick: number; cap: RGB; capSurf: number }

/**
 * Gable roof with the ridge along X over a W×D block whose wall tops are at yE. Includes the two gable triangles
 * (wall material, with thickness), the slabs with overhang, and a ridge cap. Returns the ridge height.
 */
function gableRoof(k: KitBuilder, W: number, D: number, T: number, yE: number, pitch: number, over: number, rf: RoofLook, gable: { surf: number; col: RGB } | null, lod: number, spikes = false): number {
  const t = Math.tan(pitch);
  const cosP = Math.cos(pitch);
  const hR = (D / 2) * t;
  const lift = rf.thick / cosP;
  const ox = over * 0.8;
  const yEave = yE + lift - over * t;
  const yRidge = yE + lift + hR;
  // slabs
  k.slab([-W / 2 - ox, yEave, D / 2 + over], [W / 2 + ox, yEave, D / 2 + over], [W / 2 + ox, yRidge, 0], [-W / 2 - ox, yRidge, 0], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, 1);
  k.slab([W / 2 + ox, yEave, -D / 2 - over], [-W / 2 - ox, yEave, -D / 2 - over], [-W / 2 - ox, yRidge, 0], [W / 2 + ox, yRidge, 0], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, 0.92);
  // gables: triangular wall ends with thickness
  if (gable) {
    for (const sx of [1, -1]) {
      const xo = sx * W / 2, xi = sx * (W / 2 - T);
      const a: V3 = [xo, yE, sx * D / 2], b: V3 = [xo, yE, -sx * D / 2], c: V3 = [xo, yE + hR, 0];
      k.triangle(a, b, c, gable.surf, PART.wall, gable.col, 0.9);
      const ai: V3 = [xi, yE, -sx * D / 2], bi: V3 = [xi, yE, sx * D / 2], ci: V3 = [xi, yE + hR, 0];
      k.triangle(ai, bi, ci, SURF.plaster, PART.wall, INTERIOR, 0.5);
    }
  }
  // ridge cap
  if (lod === 0) k.beam([-W / 2 - ox - 0.05, yRidge + 0.02, 0], [W / 2 + ox + 0.05, yRidge + 0.02, 0], 0.22, 0.16, rf.capSurf, PART.roof, rf.cap, 0.9);
  if (spikes) {
    const n = Math.max(2, Math.round(W / 1.6));
    for (let i = 0; i <= n; i++) {
      const x = -W / 2 + (W * i) / n;
      k.cylinder(x, 0, yRidge, yRidge + 0.9, 0.07, 0.0, 4, SURF.iron, PART.roof, IRON);
    }
  }
  return yRidge;
}

/** hip roof (four slopes) over W×D (W ≥ D) */
function hipRoof(k: KitBuilder, W: number, D: number, yE: number, pitch: number, over: number, rf: RoofLook, lod: number): number {
  const t = Math.tan(pitch);
  const lift = rf.thick / Math.cos(pitch);
  const hW = W / 2 + over, hD = D / 2 + over;
  const yEave = yE + lift - over * t;
  const yRidge = yEave + Math.min(hW, hD) * t;
  const rx = Math.max(0, hW - hD), rz = Math.max(0, hD - hW);
  k.slab([-hW, yEave, hD], [hW, yEave, hD], [rx, yRidge, rz], [-rx, yRidge, rz], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, 1);
  k.slab([hW, yEave, -hD], [-hW, yEave, -hD], [-rx, yRidge, -rz], [rx, yRidge, -rz], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, 0.92);
  k.slab([hW, yEave, hD], [hW, yEave, -hD], [rx, yRidge, -rz], [rx, yRidge, rz], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, 0.96);
  k.slab([-hW, yEave, -hD], [-hW, yEave, hD], [-rx, yRidge, rz], [-rx, yRidge, -rz], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, 0.96);
  if (lod === 0 && rx > 0.1) k.beam([-rx, yRidge + 0.02, 0], [rx, yRidge + 0.02, 0], 0.2, 0.14, rf.capSurf, PART.roof, rf.cap, 0.9);
  return yRidge;
}

/** conical roof over a round wall of radius r at height yE */
function coneRoof(k: KitBuilder, r: number, yE: number, apexH: number, over: number, rf: RoofLook, sides: number): number {
  const R = r + over;
  const yEave = yE - over * (apexH / r) + rf.thick * 0.5;
  const yTop = yE + apexH + rf.thick;
  // outer cone with a slight belly (thatch sags between the rafters) and a thick eave lip; thatch is laid in
  // courses, each tier's butt ends standing a few centimetres proud of the one above (a stepped, layered outline, not a
  // turned cone), and a capping of darker, older straw bound round the top
  const prof: [number, number][] = [];
  const thatchy = rf.surf === SURF.thatch;
  const tiers = thatchy ? 3 : 1;
  for (let i = 0; i <= 6 * tiers; i++) {
    const t = i / (6 * tiers);
    const rr = R * (1 - t) + 0.04 * t;
    const y = yEave + (yTop - yEave) * Math.pow(t, 0.92);
    prof.push([rr, y]);
    // a course's butt: step out at the bottom of every tier above the first
    if (thatchy && i > 0 && i < 6 * tiers && i % 6 === 0) prof.push([rr + 0.1, y - 0.07]);
  }
  const v0 = k.vertexCount;
  k.lathe(0, 0, [[R - 0.02, yEave - rf.thick], ...prof], sides, rf.surf, PART.roof, rf.col, 0.75, 1);
  if (thatchy) {
    // the capping and its bindings
    const capY = yEave + (yTop - yEave) * 0.8;
    const capR = R * (1 - Math.pow(0.8, 1 / 0.92)) + 0.05;
    k.lathe(0, 0, [[capR + 0.07, capY - 0.06], [capR * 0.55 + 0.05, capY + (yTop - capY) * 0.55], [0.06, yTop + 0.02]], sides, rf.surf, PART.roof, mulc(mixc(rf.col, [0.24, 0.23, 0.2], 0.4), 0.8), 0.8, 1);
    for (const f of [0.15, 0.5]) {
      const yy = capY + (yTop - capY) * f, rr = (capR + 0.07) * (1 - f) + 0.06 * f + 0.012;
      k.lathe(0, 0, [[rr, yy - 0.03], [rr + 0.012, yy], [rr, yy + 0.03]], sides, SURF.rope, PART.roof, [0.09, 0.07, 0.045], 0.85, 0.85);
    }
  }
  // underside
  const under: [number, number][] = [[0.05, yTop - rf.thick * 2.2], [R - 0.02, yEave - rf.thick]];
  k.lathe(0, 0, under, sides, rf.underSurf, PART.roof, rf.under, 0.5, 0.4);
  // a hand-laid outline: the cone bulges and dips a few centimetres, most at the eave (not a turned Hershey's kiss)
  const ph = (yTop * 7.31 + R * 3.17) % 6.283;
  const lump = (a: number, y: number): number => {
    const t = Math.max(0, Math.min(1, (y - yEave) / Math.max(0.1, yTop - yEave)));
    return (0.026 * Math.sin(3 * a + ph) + 0.016 * Math.sin(7 * a + ph * 2.1 + y * 1.3) + 0.01 * Math.sin(13 * a + ph * 3.7)) * (1 - 0.8 * t);
  };
  if (rf.surf === SURF.thatch) {
    k.jitterRadial(v0, 0, 0, lump);
    // a ragged fringe of straw ends hanging below the eave (irregular: a regular sawtooth read as a crown of teeth)
    const n = sides * 3;
    for (let i = 0; i < n; i++) {
      const h1 = Math.abs(Math.sin(i * 12.9898 + ph * 78.233) * 43758.5453) % 1;
      if (h1 < 0.3) continue;
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1 + (h1 > 0.8 ? 1 : 0)) / n) * Math.PI * 2, am = (a0 + a1) / 2 + (h1 - 0.5) * 0.04;
      const len = 0.04 + 0.16 * Math.pow(h1, 2);
      const ry = yEave - rf.thick;
      const p0: V3 = [Math.cos(a0) * (R - 0.01 + lump(a0, ry)), ry + 0.02, Math.sin(a0) * (R - 0.01 + lump(a0, ry))];
      const p1: V3 = [Math.cos(a1) * (R - 0.01 + lump(a1, ry)), ry + 0.02, Math.sin(a1) * (R - 0.01 + lump(a1, ry))];
      const pm: V3 = [Math.cos(am) * (R + 0.03 + lump(am, ry)), ry - len, Math.sin(am) * (R + 0.03 + lump(am, ry))];
      k.triangle(p1, p0, pm, rf.surf, PART.roof, mulc(rf.col, 0.85), 0.8);
      k.triangle(p0, p1, pm, rf.surf, PART.roof, mulc(rf.col, 0.6), 0.5);
    }
  }
  return yTop;
}

/** a chimney stack at (x, z) from y0 to y1, w square, with a cap; records a smoke emitter */
function chimney(k: KitBuilder, x: number, z: number, y0: number, y1: number, w: number, surf: number, col: RGB, em: Emitter[], kind: number = EMIT.smoke): void {
  k.box(x - w / 2, y0, z - w / 2, x + w / 2, y1, z + w / 2, surf, PART.trim, col, { skip: ['bottom'], aoLow: 0.8 });
  k.box(x - w / 2 - 0.06, y1, z - w / 2 - 0.06, x + w / 2 + 0.06, y1 + 0.12, z + w / 2 + 0.06, SURF.ashlar, PART.trim, mulc(col, 0.9), { skip: ['bottom'] });
  k.quad([x - w / 2 + 0.08, y1 + 0.121, z + w / 2 - 0.08], [x + w / 2 - 0.08, y1 + 0.121, z + w / 2 - 0.08], [x + w / 2 - 0.08, y1 + 0.121, z - w / 2 + 0.08], [x - w / 2 + 0.08, y1 + 0.121, z - w / 2 + 0.08], SURF.earth, PART.trim, ASH, 0.3);
  em.push({ p: [x, y1 + 0.2, z], kind, size: w });
}

/** a ring of rough stones on the ground (hearths, henges' kerbs, well heads) */
function stoneRing(k: KitBuilder, r: number, n: number, size: number, col: RGB, rng: Rng, lod: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float() * 0.2;
    const s = size * (0.75 + rng.float() * 0.5);
    k.push(Math.cos(a) * r, 0, Math.sin(a) * r, -a + rng.float(), 1);
    rock(k, s, s * (0.55 + rng.float() * 0.3), s * 0.8, col, rng.float(), lod);
    k.pop();
  }
}

/** a rough boulder (low-poly lathe with jitter folded into a squashed octagon) centred at 0, resting on y = 0 */
function rock(k: KitBuilder, sx: number, sy: number, sz: number, col: RGB, seed: number, lod: number): void {
  const n = lod === 0 ? 7 : 5;
  const prof: [number, number][] = [[0.75, -0.15], [1, 0.25], [0.88, 0.62], [0.45, 0.92], [0.02, 1]];
  const r = new Rng(Math.floor(seed * 1e6) + 7);
  const rows: number[][] = [];
  for (let i = 0; i < prof.length; i++) {
    const row: number[] = [];
    for (let s = 0; s <= n; s++) {
      const a = ((s % n) / n) * Math.PI * 2;
      const j = s === n ? 0 : 0.82 + r.float() * 0.36;
      const rr = prof[i][0] * (s === n ? 1 : j);
      const x = Math.cos(a) * rr * sx, z = Math.sin(a) * rr * sz, y = prof[i][1] * sy;
      row.push(k.vert(x, y, z, Math.cos(a) * prof[i][0], prof[i][1] * 0.8 + 0.2, Math.sin(a) * prof[i][0], SURF.rubble, PART.prop, col, 0.6 + 0.4 * prof[i][1], seed));
    }
    rows.push(row);
  }
  // close the seam: the last column repeats the first column's jitter-free point, so reuse the first index instead
  for (let i = 0; i < rows.length; i++) rows[i][n] = rows[i][0];
  for (let i = 0; i < rows.length - 1; i++) for (let s = 0; s < n; s++) {
    const a = rows[i][s], b = rows[i][s + 1], c = rows[i + 1][s], d = rows[i + 1][s + 1];
    k.tri(a, d, b); k.tri(a, c, d);
  }
}

/** a log pile / stacked firewood */
function woodPile(k: KitBuilder, len: number, rows: number, col: RGB, rng: Rng): void {
  const r = 0.11;
  for (let j = 0; j < rows; j++) {
    const n = rows - j + 2;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * r * 2.05;
      const y = r + j * r * 1.75;
      k.tube([[x, y, -len / 2], [x, y, len / 2]], [r * (0.85 + rng.float() * 0.3), r], 6, SURF.bark, PART.prop, mulc(col, 0.8 + rng.float() * 0.4), { ao0: 0.7, ao1: 0.9 });
    }
  }
}

/** crates and barrels for yards, docks and markets */
function crate(k: KitBuilder, x: number, z: number, s: number, yaw: number, col: RGB): void {
  k.push(x, 0, z, yaw);
  k.box(-s / 2, 0, -s / 2, s / 2, s, s / 2, SURF.planks, PART.prop, col, { skip: ['bottom'], aoLow: 0.6 });
  k.pop();
}
function barrel(k: KitBuilder, x: number, z: number, r: number, h: number, col: RGB): void {
  k.lathe(x, z, [[r * 0.82, 0], [r, h * 0.3], [r * 1.04, h * 0.5], [r, h * 0.7], [r * 0.82, h], [0.01, h]], 8, SURF.planks, PART.prop, col, 0.6, 1);
}

/** a sapling-sized fence of posts and rails along a polyline (pens, gardens, palisade rails) */
function fence(k: KitBuilder, pts: [number, number][], h: number, col: RGB, gapAt = -1, lod = 0): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 2.2));
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (lod === 0 || j % 2 === 0) k.cylinder(x, z, -0.3, h + 0.08, 0.06, 0.05, 5, SURF.bark, PART.prop, col, { top: true, aoLow: 0.6 });
    }
    if (i === gapAt) continue;
    for (const y of [h * 0.45, h * 0.9]) k.beam([ax, y, az], [bx, y, bz], 0.06, 0.08, SURF.planks, PART.prop, mulc(col, 1.1), 0.9);
  }
}

// ───────────────────────────── looks by material / style / mood ─────────────────────────────

interface Look { wall: WallLook; roof: RoofLook; roofKind: string; plinthSurf: number; plinthCol: RGB; trim: RGB; cornerSurf: number; cornerCol: RGB }

function lookFor(spec: BuildingSpec, rng: Rng): Look {
  const m = spec.mat, st = spec.style & 7;
  const fear = spec.mood < -0.33, kind = spec.mood > 0.33;
  let wallCol: RGB = [...m.wallCol];
  let surf = m.wall;
  // plastered materials take the culture's colours (whitewash, ochre, rose...); fearful cultures build dark
  if (surf === SURF.daub || surf === SURF.plaster) wallCol = mixc(wallCol, PLASTER[st], m.id === 'wattle' ? 0.55 : 0.75);
  if (surf === SURF.mudbrick && st % 3 === 1) { surf = SURF.plaster; wallCol = mixc(m.wallCol, PLASTER[(st + 1) & 7], 0.6); }
  // each household's own colours: another wash on plaster and daub, a different stone / brick / timber tone
  const hv = spec.hv;
  if (hv !== undefined) {
    if (surf === SURF.daub || surf === SURF.plaster || surf === SURF.mudbrick) wallCol = mixc(wallCol, PLASTER[(st + hv * 3 + 2) & 7], hv % 3 === 0 ? 0.0 : 0.38);
    else if (surf === SURF.brick) wallCol = mixc(wallCol, ([[0.3, 0.1, 0.055], [0.42, 0.2, 0.11], [0.34, 0.15, 0.1], [0.46, 0.27, 0.17], [0.28, 0.12, 0.08], [0.38, 0.16, 0.08]] as RGB[])[hv % 6], 0.5);
    else wallCol = mulc(mixc(wallCol, hv % 2 ? [0.5, 0.44, 0.36] : [0.4, 0.41, 0.42], 0.18), [0.88, 1.0, 1.1, 0.94, 1.05, 0.97][hv % 6]);
  }
  if (fear) wallCol = mulc(mixc(wallCol, STONE_DARK, 0.55), 0.8);
  if (kind) wallCol = mixc(wallCol, [0.7, 0.6, 0.45], 0.12);
  // a little variation per building of the same variant comes from the instance tint; per variant here
  wallCol = mulc(wallCol, 0.92 + rng.float() * 0.14);
  const trim = fear ? [0.03, 0.025, 0.025] as RGB : TRIM[(st * 3 + 1 + (hv ?? 0) * 3) & 7];
  let roofKind = m.roof;
  if (roofKind === 'thatch' && spec.era >= 6 && m.tier >= 1) roofKind = 'tile';
  if (roofKind === 'slate' && spec.era <= 3) roofKind = 'thatch';
  if (roofKind === 'tile' && st % 4 === 3 && spec.era >= 6) roofKind = 'slate';
  if (roofKind === 'shingle' && spec.era <= 2) roofKind = 'thatch';
  const hk = hv === undefined ? 1 : [1, 0.86, 1.1, 0.93, 1.04, 0.8][hv % 6];
  const roofCol: RGB = roofKind === 'thatch' ? mulc(mixc(THATCH, [0.3, 0.29, 0.26], hv === undefined ? 0 : (hv % 3) * 0.22), (0.85 + rng.float() * 0.3) * hk)
    : roofKind === 'tile' ? mulc(TILE[(st + (hv ?? 0)) & 3], hk) : roofKind === 'slate' ? mulc(SLATE, hk)
    : roofKind === 'shingle' ? SHINGLE : roofKind === 'hide' ? HIDE : roofKind === 'metal' ? [0.18, 0.17, 0.16] : CONCRETE;
  const roofSurf = roofKind === 'thatch' ? SURF.thatch : roofKind === 'tile' ? SURF.tiles : roofKind === 'slate' ? SURF.slate
    : roofKind === 'shingle' ? SURF.shingle : roofKind === 'hide' ? SURF.hide : roofKind === 'metal' ? SURF.metal : SURF.concrete;
  const thick = roofKind === 'thatch' ? 0.38 : roofKind === 'hide' ? 0.06 : 0.14;
  const wall: WallLook = {
    surf, col: wallCol, inner: INTERIOR, frameCol: spec.era >= 6 && !fear ? mixc(trim, [0.6, 0.58, 0.52], st % 2 ? 0.0 : 0.85) : WOOD_DARK,
    sillSurf: m.tier >= 2 ? SURF.ashlar : SURF.planks, sillCol: m.tier >= 2 ? mulc(STONE, 1.3) : WOOD,
    shutters: spec.era >= 5 && spec.era <= 8 && !fear && (st + (hv ?? 0)) % 3 !== 2 ? trim : null,
    doorCol: fear ? [0.035, 0.03, 0.028] : (st + (hv ?? 0)) % 2 ? trim : mulc(WOOD, 0.8 + 0.1 * ((hv ?? 0) % 3)), mullions: spec.era >= 6, lod: spec.lod,
  };
  const roof: RoofLook = {
    surf: roofSurf, col: roofCol, under: roofKind === 'thatch' ? mulc(THATCH, 0.45) : WOOD_DARK, underSurf: roofKind === 'thatch' ? SURF.thatch : SURF.planks,
    thick, cap: roofKind === 'thatch' ? mulc(THATCH, 0.7) : roofKind === 'tile' ? mulc(roofCol, 0.8) : mulc(roofCol, 0.9),
    capSurf: roofKind === 'thatch' ? SURF.thatch : roofKind === 'tile' ? SURF.tiles : roofSurf,
  };
  // foundations are dark field stone (or dressed stone in later eras), never pale: they show downhill on slopes
  // (dark rubble field stone up to the industrial eras' dressed footings: a pale grey footing on a slope stood out as a
  // pedestal under the house)
  const plinthSurf = m.tier >= 4 ? SURF.ashlar : SURF.rubble;
  const plinthCol: RGB = fear ? STONE_DARK : m.tier >= 4 ? mulc(STONE, 0.66) : mixc(STONE_DARK, mulc(STONE, 0.8), 0.45);
  return { wall, roof, roofKind, plinthSurf, plinthCol, trim, cornerSurf: m.tier >= 2 ? SURF.ashlar : SURF.beam, cornerCol: m.tier >= 2 ? mulc(STONE, 1.25) : WOOD_DARK };
}

// ───────────────────────────── archetypes ─────────────────────────────

/** plinth under a rectangular footprint, running 4 m below 0 (meets sloped ground) */
function plinth(k: KitBuilder, W: number, D: number, h: number, surf: number, col: RGB): void {
  k.box(-W / 2 - 0.1, -4, -D / 2 - 0.1, W / 2 + 0.1, h, D / 2 + 0.1, surf, PART.plinth, col, { skip: ['bottom'], aoLow: 0.45, aoHigh: 0.85 });
}

interface HouseOpts {
  floors: number; floorH: number; T: number; pitch: number; over: number; roof: 'gable' | 'hip' | 'flat' | 'gambrel';
  winW: number; winH: number; spacing: number; chimneys: number; corners: boolean; frame: boolean; porch: boolean;
  jetty: number; parapet: boolean; vigas: boolean; plinthH: number; doorW: number; doorH: number; cornice: boolean; dormers: boolean;
  /** household variation (see householdOpts): door offset (× width), chimney placement, an annex, a door hood, window boxes */
  doorPos?: number; chim?: 'end' | 'other' | 'ridge' | 'stack'; annex?: 'none' | 'leanto' | 'wing' | 'rear'; hood?: boolean; boxes?: boolean;
}

/** a household's own way of building within its culture: pitch, proportions, door, chimney, annex, porch or hood */
function householdOpts(o: HouseOpts, kind: BuildingKind, spec: BuildingSpec): HouseOpts {
  if (spec.hv === undefined) return o;
  const hv = spec.hv % HOUSEHOLD_VARIANTS;
  const r = new Rng(6007 + hv * 7919 + spec.style * 131 + spec.era * 17 + kind.length * 3);
  const out: HouseOpts = { ...o };
  if (o.roof !== 'flat') out.pitch = o.pitch * [1, 0.86, 1.14, 0.94, 1.08, 0.8][hv];
  out.over = o.over * (0.85 + 0.3 * r.float());
  out.floorH = o.floorH + (r.float() - 0.5) * 0.3;
  out.spacing = o.spacing * (0.9 + 0.25 * r.float());
  out.winW = o.winW * (0.9 + 0.2 * r.float());
  out.doorPos = spec.w > 5.2 ? [0, -0.22, 0.22, 0.04, 0.2, -0.18][hv] : 0;
  out.chim = (['end', 'ridge', 'other', 'stack', 'end', 'other'] as const)[hv];
  if (o.chimneys >= 2) out.chimneys = hv % 3 === 1 ? 1 : 2;
  else if (o.chimneys === 0 && spec.era >= 4 && hv % 4 === 2 && kind !== 'mudbrick') out.chimneys = 1;
  out.annex = (['none', 'leanto', 'wing', 'rear', 'leanto', 'wing'] as const)[hv];
  if (kind === 'timber' || kind === 'wattle' || kind === 'stone-house') out.porch = spec.era >= 3 && (hv === 0 || hv === 3);
  out.hood = !out.porch && spec.era >= 5 && kind !== 'mudbrick' && hv % 2 === 1;
  out.boxes = spec.era >= 6 && spec.mood >= -0.33 && hv % 3 !== 1 && kind !== 'mudbrick';
  if ((kind === 'brick-house' || kind === 'stone-house') && spec.era >= 6 && hv === 3) out.roof = 'hip';
  if (kind === 'mudbrick' && spec.w > 6 && hv === 4) out.floors = 2;
  return out;
}

/** window boxes with flowers under a window (front face at z = 0 in the current frame) */
function windowBox(k: KitBuilder, x0: number, x1: number, y: number, rng: Rng): void {
  k.box(x0 - 0.06, y - 0.3, 0.04, x1 + 0.06, y - 0.08, 0.3, SURF.planks, PART.trim, mulc(WOOD, 0.9), { skip: ['nz'], aoLow: 0.8 });
  const n = Math.max(2, Math.round((x1 - x0) / 0.18));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n, z = 0.17 + (rng.float() - 0.5) * 0.08;
    const c = rng.float() < 0.45 ? mulc(LEAF_G, 1.2) : FLOWER_C[Math.floor(rng.float() * FLOWER_C.length)];
    k.lathe(x, z, [[0.05, y - 0.1], [0.1, y + 0.02], [0.07, y + 0.12], [0.01, y + 0.15]], 5, SURF.thatch, PART.prop, c, 0.7, 1);
  }
}
const LEAF_G: RGB = [0.04, 0.075, 0.028];
const FLOWER_C: RGB[] = [[0.6, 0.08, 0.06], [0.7, 0.55, 0.08], [0.75, 0.72, 0.66], [0.32, 0.12, 0.45], [0.75, 0.3, 0.05]];

/**
 * Earthen houses (flat roofs): softened corners, wooden rain spouts through the parapet, and what each household keeps
 * up there — a ladder or an outside stair of mud steps to the roof, a little rooftop room, pots, a drying mat.
 * (yR: the roof deck; top: the parapet top; dx: the door's x)
 */
function mudbrickDressing(k: KitBuilder, spec: BuildingSpec, L: Look, W: number, D: number, yR: number, top: number, dx: number, rng: Rng): void {
  const hv = (spec.hv ?? spec.style) % 6, lod = spec.lod;
  const col = L.wall.col, surf = L.wall.surf;
  // rounded, buttressed corners (hand-plastered earth never keeps a sharp arris)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cylinder(sx * (W / 2 - 0.12), sz * (D / 2 - 0.12), -0.3, top - 0.04, 0.3, 0.24, lod === 0 ? 8 : 5, surf, PART.wall, mulc(col, 0.97), { top: true });
  if (lod > 0) return;
  // canales: wooden spouts out through the parapet
  for (const sz of [-1, 1]) for (const fx of [-0.3, 0.3]) {
    const x = fx * W + (hv % 2 ? 0.25 : -0.25);
    k.beam([x, yR + 0.12, sz * (D / 2 - 0.2)], [x, yR + 0.04, sz * (D / 2 + 0.6)], 0.15, 0.12, SURF.planks, PART.trim, WOOD, 0.85);
  }
  if (hv === 0 || hv === 3) {
    // a ladder leaning on the front wall up to the roof
    const lx = dx + (dx > 0 ? -1.4 : 1.4);
    for (const sx of [-0.22, 0.22]) k.beam([lx + sx, -0.05, D / 2 + 1.0], [lx + sx, top + 0.6, D / 2 + 0.06], 0.06, 0.06, SURF.bark, PART.prop, WOOD_GREY, 0.9);
    for (let yy = 0.35; yy < top + 0.3; yy += 0.38) { const t = yy / (top + 0.65); k.beam([lx - 0.22, yy, D / 2 + 1.0 - 0.94 * t], [lx + 0.22, yy, D / 2 + 1.0 - 0.94 * t], 0.04, 0.04, SURF.bark, PART.prop, WOOD_GREY, 0.9); }
  }
  if (hv === 2 || hv === 5) {
    // an outside stair of mud steps up the side wall to the roof
    const sx = hv === 2 ? -1 : 1, n = Math.max(4, Math.ceil(yR / 0.28)), run = Math.min(D - 0.6, yR * 1.05);
    for (let i = 0; i < n; i++) {
      const z1 = D / 2 - 0.4 - (i * run) / n, z0 = z1 - run / n, yt = ((i + 1) * yR) / n;
      k.box(sx * (W / 2), -0.4, z0, sx * (W / 2 + 0.95), yt, z1, surf, PART.wall, mulc(col, 0.95), { skip: ['bottom'], aoLow: 0.7 });
    }
  }
  if (hv === 1 || hv === 4) {
    // a rooftop room in the back corner
    const rw = Math.min(2.8, W * 0.42), rd = Math.min(2.4, D * 0.45), cx = (hv === 1 ? 1 : -1) * (W / 2 - rw / 2 - 0.3), cz = -D / 2 + rd / 2 + 0.3;
    k.push(cx, 0, cz);
    boxWalls(k, { W: rw, D: rd, H: 2.1, T: 0.35, y0: yR, front: [{ x0: rw / 2 - 0.42, x1: rw / 2 + 0.42, y0: 0, y1: 1.75, kind: 'door' }], back: [], left: [], right: [] }, L.wall, rng);
    k.quad([-rw / 2, yR + 2.12, rd / 2], [rw / 2, yR + 2.12, rd / 2], [rw / 2, yR + 2.12, -rd / 2], [-rw / 2, yR + 2.12, -rd / 2], SURF.earth, PART.roof, mulc(col, 0.85), 0.9);
    k.box(-rw / 2, yR + 2.1, rd / 2 - 0.2, rw / 2, yR + 2.45, rd / 2, surf, PART.roof, col, { skip: ['bottom'] });
    for (let i = 0; i < 3; i++) k.tube([[-rw / 2 + 0.45 + i * (rw - 0.9) / 2, yR + 1.9, rd / 2 - 0.2], [-rw / 2 + 0.45 + i * (rw - 0.9) / 2, yR + 1.92, rd / 2 + 0.35]], [0.07, 0.065], 5, SURF.bark, PART.trim, WOOD, { cap: true });
    k.pop();
  }
  // pots and a drying mat on the roof
  for (let i = 0; i < 2 + (hv % 3); i++) {
    const x = (rng.float() - 0.5) * (W - 2), z = (rng.float() - 0.2) * (D - 2) * 0.5;
    k.lathe(x, z, [[0.12, yR], [0.22, yR + 0.18], [0.2, yR + 0.36], [0.11, yR + 0.44], [0.13, yR + 0.48]], 7, SURF.plaster, PART.prop, mulc([0.42, 0.2, 0.1], 0.8 + rng.float() * 0.4), 0.75, 1);
  }
  const mx = (hv % 2 ? -1 : 1) * W * 0.18;
  k.quad([mx - 0.9, yR + 0.04, 0.9], [mx + 0.9, yR + 0.04, 0.9], [mx + 0.9, yR + 0.04, -0.6], [mx - 0.9, yR + 0.04, -0.6], SURF.thatch, PART.prop, [0.36, 0.27, 0.13], 0.85);
}

/**
 * A household's annex against the house (local frame of the house, its walls W × D from the plinth top ph):
 *   leanto — an outshot along part of the back wall under a shallow skillion roof;
 *   wing   — a lower gabled bay against one gable end, set back a little;
 *   rear   — a gabled back wing at right angles (an L-shaped house).
 */
function houseAnnex(k: KitBuilder, spec: BuildingSpec, L: Look, o: HouseOpts, ph: number, rng: Rng): void {
  const W = spec.w, D = spec.d, kind = o.annex;
  if (!kind || kind === 'none') return;
  const sgn = ((spec.hv ?? 0) + spec.style) % 2 ? 1 : -1;
  const T = Math.max(0.22, o.T * 0.8);
  const look = L.wall;
  const flat = o.roof === 'flat';
  const win = (len: number, y0: number): Opening[] => windowRow(len, y0, [Math.min(0.7, o.winW), Math.min(0.8, o.winH)], 2.4, 0.8, null);
  if (kind === 'leanto') {
    const Wa = W * 0.62, da = 2.1, ha = Math.min(2.05, o.floorH - 0.5);
    const xc = sgn * (W - Wa) / 2 * 0.85;
    k.push(xc, 0, -D / 2 - da / 2 + 0.05);
    boxWalls(k, { W: Wa, D: da + 0.1, H: ha, T, y0: ph, front: [], back: win(Wa, 0.9), left: sgn < 0 ? [{ x0: 0.5, x1: 1.35, y0: 0, y1: Math.min(1.85, ha - 0.1), kind: 'door' }] : [], right: sgn > 0 ? [{ x0: da - 1.4, x1: da - 0.55, y0: 0, y1: Math.min(1.85, ha - 0.1), kind: 'door' }] : [] }, look, rng);
    k.pop();
    k.box(xc - Wa / 2 - 0.08, -4, -D / 2 - da - 0.08, xc + Wa / 2 + 0.08, ph, -D / 2 + 0.05, L.plinthSurf, PART.plinth, L.plinthCol, { skip: ['bottom'], aoLow: 0.45, aoHigh: 0.85 });
    if (flat) {
      k.quad([xc - Wa / 2, ph + ha + 0.02, -D / 2], [xc + Wa / 2, ph + ha + 0.02, -D / 2], [xc + Wa / 2, ph + ha + 0.02, -D / 2 - da], [xc - Wa / 2, ph + ha + 0.02, -D / 2 - da], SURF.earth, PART.roof, mulc(look.col, 0.85), 0.9);
      return;
    }
    const yTop = ph + Math.min(o.floorH - 0.12, ha + 0.85), yLow = ph + ha - 0.12;
    const zT = -D / 2 + 0.05, zL = -D / 2 - da - 0.35;
    const xa = xc - Wa / 2 - 0.2, xb = xc + Wa / 2 + 0.2;
    k.slab([xb, yLow, zL], [xa, yLow, zL], [xa, yTop, zT], [xb, yTop, zT], L.roof.thick * 0.7, L.roof.surf, PART.roof, mulc(L.roof.col, 0.94), L.roof.underSurf, L.roof.under, 0.92);
    // the wall fills under the sloping roof at both ends
    for (const sx of [-1, 1]) {
      const x = xc + sx * Wa / 2;
      triFacingX(k, [x, ph + ha, -D / 2 - da], [x, ph + ha, -D / 2 + 0.05], [x, yTop - 0.1, -D / 2 + 0.05], sx, look.surf, PART.wall, look.col, 0.85);
    }
    return;
  }
  if (kind === 'wing') {
    const Wa = Math.min(3.4, Math.max(2.4, W * 0.42)), Dw = D * 0.74, ha = Math.max(2.2, o.floorH - 0.25);
    const xc = sgn * (W / 2 + Wa / 2 - 0.15), zc = -(D - Dw) / 2 * 0.6;
    k.push(xc, 0, zc);
    boxWalls(k, { W: Wa + 0.3, D: Dw, H: ha, T, y0: ph, front: win(Wa + 0.3, 0.9), back: [], left: sgn < 0 ? win(Dw - 2 * T, 0.9) : [], right: sgn > 0 ? win(Dw - 2 * T, 0.9) : [] }, look, rng);
    k.box(-(Wa + 0.3) / 2 - 0.08, -4, -Dw / 2 - 0.08, (Wa + 0.3) / 2 + 0.08, ph, Dw / 2 + 0.08, L.plinthSurf, PART.plinth, L.plinthCol, { skip: ['bottom'], aoLow: 0.45, aoHigh: 0.85 });
    if (flat) {
      k.quad([-(Wa + 0.3) / 2, ph + ha + 0.02, Dw / 2], [(Wa + 0.3) / 2, ph + ha + 0.02, Dw / 2], [(Wa + 0.3) / 2, ph + ha + 0.02, -Dw / 2], [-(Wa + 0.3) / 2, ph + ha + 0.02, -Dw / 2], SURF.earth, PART.roof, mulc(look.col, 0.85), 0.9);
      k.box(-(Wa + 0.3) / 2, ph + ha, Dw / 2 - 0.22, (Wa + 0.3) / 2, ph + ha + 0.45, Dw / 2, look.surf, PART.roof, look.col, { skip: ['bottom'] });
    } else gableRoof(k, Wa + 0.3, Dw, T, ph + ha, o.pitch, o.over * 0.8, L.roof, { surf: look.surf, col: look.col }, spec.lod);
    k.pop();
    return;
  }
  // rear wing at right angles
  const Wr = Math.min(W * 0.5, 4.2), Dr = Math.min(4.2, Math.max(3.0, D * 0.7)), ha = o.floorH - 0.1;
  const xc = sgn * (W / 2 - Wr / 2 - 0.25), zc = -D / 2 - Dr / 2 + 0.25;
  k.push(xc, 0, zc);
  boxWalls(k, { W: Wr, D: Dr + 0.5, H: ha, T, y0: ph, front: [], back: win(Wr, 0.9).slice(0, 1), left: win(Dr, 0.9), right: win(Dr, 0.9) }, look, rng);
  k.box(-Wr / 2 - 0.08, -4, -(Dr + 0.5) / 2 - 0.08, Wr / 2 + 0.08, ph, (Dr + 0.5) / 2, L.plinthSurf, PART.plinth, L.plinthCol, { skip: ['bottom'], aoLow: 0.45, aoHigh: 0.85 });
  if (flat) {
    k.quad([-Wr / 2, ph + ha + 0.02, (Dr + 0.5) / 2], [Wr / 2, ph + ha + 0.02, (Dr + 0.5) / 2], [Wr / 2, ph + ha + 0.02, -(Dr + 0.5) / 2], [-Wr / 2, ph + ha + 0.02, -(Dr + 0.5) / 2], SURF.earth, PART.roof, mulc(look.col, 0.85), 0.9);
  } else {
    k.push(0, 0, 0, Math.PI / 2);
    gableRoof(k, Dr + 0.5, Wr, T, ph + ha, o.pitch, o.over * 0.8, L.roof, { surf: look.surf, col: look.col }, spec.lod);
    k.pop();
  }
  k.pop();
}

/** a triangle facing +X (sx = 1) or −X (sx = −1) */
function triFacingX(k: KitBuilder, a: V3, b: V3, c: V3, sx: number, surf: number, part: number, col: RGB, ao = 1): void {
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  if (nx * sx >= 0) k.triangle(a, b, c, surf, part, col, ao); else k.triangle(a, c, b, surf, part, col, ao);
}

/** the general rectangular house: storeys of walls with openings, plinth, roof, chimneys, porch, framing */
function house(k: KitBuilder, spec: BuildingSpec, L: Look, o: HouseOpts, rng: Rng, em: Emitter[]): number {
  const W = spec.w, D = spec.d;
  const ph = o.plinthH;
  plinth(k, W, D, ph, L.plinthSurf, L.plinthCol);
  const doorX = W / 2 + (o.doorPos !== undefined ? o.doorPos * W : spec.style % 3 === 1 && W > 7 ? -W * 0.18 : 0);
  let y = ph;
  for (let f = 0; f < o.floors; f++) {
    const jet = f > 0 ? o.jetty : 0;
    const Wf = W + jet * 2, Df = D + jet * 2;
    const front: Opening[] = [];
    const sill = f === 0 ? 0.9 : 0.8;
    const fh = o.floorH;
    const winH = Math.min(o.winH, fh - sill - 0.35);
    if (f === 0) front.push({ x0: doorX + jet - o.doorW / 2, x1: doorX + jet + o.doorW / 2, y0: 0, y1: Math.min(o.doorH, fh - 0.3), kind: 'door' });
    front.push(...windowRow(Wf, sill, [o.winW, winH], o.spacing, 0.9, f === 0 ? [doorX + jet - o.doorW / 2, doorX + jet + o.doorW / 2] : null));
    const back = windowRow(Wf, sill, [o.winW, winH], o.spacing * 1.15, 1.0, null);
    const side = D > 5.5 ? windowRow(Df - 2 * o.T, sill, [o.winW, winH], o.spacing * 1.3, 1.1, null) : [];
    const wl = spec.lod > 0 ? { ...L.wall } : L.wall;
    boxWalls(k, { W: Wf, D: Df, H: fh, T: o.T, y0: y, front, back, left: side, right: f === 0 && spec.style % 2 ? [] : side }, wl, rng);
    if (o.boxes && spec.lod === 0) {
      k.push(-Wf / 2, 0, Df / 2);
      for (const q of front) if (q.kind === 'window') windowBox(k, q.x0, q.x1, y + q.y0 - 0.02, rng);
      k.pop();
    }
    // timber framing over the plaster (half-timbered upper floors, wattle corner posts)
    if (o.frame && spec.lod === 0) frameBeams(k, Wf, Df, y, fh, front, back, side.map((q) => ({ ...q, x0: q.x0 + o.T, x1: q.x1 + o.T })));
    if (o.corners && spec.lod === 0) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const cx = sx * Wf / 2, cz = sz * Df / 2;
        if (L.cornerSurf === SURF.ashlar) {
          // quoins: alternating long and short dressed stones
          for (let q = 0; q < Math.floor(fh / 0.42); q++) {
            const long = q % 2 === 0;
            const qa = long ? 0.55 : 0.32, qb = long ? 0.32 : 0.55;
            k.box(cx - sx * qa, y + q * 0.42, cz - sz * qb, cx + sx * 0.03, y + q * 0.42 + 0.4, cz + sz * 0.03, SURF.ashlar, PART.trim, L.cornerCol, { skip: ['bottom'] });
          }
        } else {
          k.box(cx - 0.14, y, cz - 0.14, cx + 0.14, y + fh, cz + 0.14, SURF.beam, PART.frame, L.cornerCol, { skip: ['bottom'] });
        }
      }
    }
    // string course between storeys / jetty beam
    if (f > 0 && spec.lod === 0) k.box(-Wf / 2 - 0.06, y - 0.12, -Df / 2 - 0.06, Wf / 2 + 0.06, y + 0.06, Df / 2 + 0.06, o.jetty > 0 ? SURF.beam : SURF.ashlar, PART.trim, o.jetty > 0 ? WOOD_DARK : mulc(L.plinthCol, 1.15), { skip: ['top'] });
    y += fh;
  }
  const Wt = W + o.jetty * 2 * (o.floors > 1 ? 1 : 0), Dt = D + o.jetty * 2 * (o.floors > 1 ? 1 : 0);
  if (o.cornice && spec.lod === 0) k.box(-Wt / 2 - 0.12, y - 0.05, -Dt / 2 - 0.12, Wt / 2 + 0.12, y + 0.16, Dt / 2 + 0.12, SURF.ashlar, PART.trim, mulc(L.plinthCol, 1.2), { skip: ['bottom'] });
  let top = y;
  if (o.roof === 'gable') top = gableRoof(k, Wt, Dt, o.T, y, o.pitch, o.over, L.roof, { surf: L.wall.surf, col: L.wall.col }, spec.lod, spec.mood < -0.33);
  else if (o.roof === 'hip') top = hipRoof(k, Wt, Dt, y, o.pitch, o.over, L.roof, spec.lod);
  else if (o.roof === 'gambrel') top = gambrelRoof(k, Wt, Dt, o.T, y, o.over, L.roof, L.wall, spec.lod);
  else {
    // flat roof: deck, parapet, projecting beams (vigas)
    k.quad([-Wt / 2, y + 0.02, Dt / 2], [Wt / 2, y + 0.02, Dt / 2], [Wt / 2, y + 0.02, -Dt / 2], [-Wt / 2, y + 0.02, -Dt / 2], L.roof.surf === SURF.concrete ? SURF.concrete : SURF.earth, PART.roof, mulc(L.wall.col, 0.85), 0.9);
    if (o.parapet) {
      const pt = 0.25, phh = 0.55;
      k.box(-Wt / 2, y, Dt / 2 - pt, Wt / 2, y + phh, Dt / 2, L.wall.surf, PART.roof, L.wall.col, { skip: ['bottom'] });
      k.box(-Wt / 2, y, -Dt / 2, Wt / 2, y + phh, -Dt / 2 + pt, L.wall.surf, PART.roof, L.wall.col, { skip: ['bottom'] });
      k.box(-Wt / 2, y, -Dt / 2 + pt, -Wt / 2 + pt, y + phh, Dt / 2 - pt, L.wall.surf, PART.roof, L.wall.col, { skip: ['bottom'] });
      k.box(Wt / 2 - pt, y, -Dt / 2 + pt, Wt / 2, y + phh, Dt / 2 - pt, L.wall.surf, PART.roof, L.wall.col, { skip: ['bottom'] });
      top = y + phh;
    }
    if (o.vigas && spec.lod === 0) {
      const n = Math.max(3, Math.round(W / 0.9));
      for (let i = 0; i < n; i++) {
        const x = -W / 2 + 0.45 + (i * (W - 0.9)) / (n - 1);
        k.tube([[x, y - 0.25, D / 2 - 0.3], [x, y - 0.22, D / 2 + 0.45]], [0.09, 0.085], 6, SURF.bark, PART.trim, WOOD, { cap: true });
      }
    }
    if (spec.kind === 'mudbrick') mudbrickDressing(k, spec, L, Wt, Dt, y, top, doorX - W / 2, rng);
  }
  // chimneys at the gable ends (inside the wall line, rising above the ridge)
  for (let c = 0; c < o.chimneys; c++) {
    const where = c === 0 ? o.chim ?? 'end' : o.chim === 'other' ? 'end' : 'other';
    const sx = where === 'other' ? -1 : 1;
    const cw = 0.62;
    const yTop = top + 0.9;
    const surf = L.wall.surf === SURF.brick || spec.era >= 7 ? SURF.brick : SURF.rubble;
    const ccol: RGB = surf === SURF.brick ? [0.3, 0.12, 0.07] : mixc(STONE_DARK, mulc(STONE, 0.9), 0.55);
    if (where === 'ridge') chimney(k, Wt * 0.12 * (spec.style % 2 ? 1 : -1), 0, y - 0.6, yTop, cw, surf, ccol, em);
    else if (where === 'stack' && o.roof !== 'flat') {
      // an outside stack against the gable wall: a broad base, a weathered shoulder, the flue up past the ridge
      const x0 = Wt / 2 - 0.04, x1 = Wt / 2 + 0.62, ys = ph + o.floorH * 0.72;
      k.box(x0, -0.4, -0.68, x1, ys, 0.68, surf, PART.trim, ccol, { skip: ['bottom'], aoLow: 0.65 });
      k.slab([x1, ys, 0.68], [x1, ys, -0.68], [x1 - 0.1, ys + 0.5, -0.36], [x1 - 0.1, ys + 0.5, 0.36], 0.1, surf, PART.trim, mulc(ccol, 0.95), surf, ccol);
      chimney(k, (x0 + x1) / 2 - 0.05, 0, ys, yTop, 0.6, surf, ccol, em);
    } else chimney(k, sx * (Wt / 2 - 0.6), -Dt * 0.12, y - 0.6, yTop, cw, surf, ccol, em);
  }
  // a porch on posts over the door
  if (o.porch && spec.lod === 0) {
    const pw = Math.min(W * 0.55, 3.6), pd = 1.8;
    const py = ph + Math.min(o.doorH + 0.35, o.floorH - 0.2);
    for (const sx of [-1, 1]) k.cylinder(doorX - W / 2 + sx * pw / 2, D / 2 + pd - 0.15, ph, py, 0.08, 0.07, 6, SURF.beam, PART.frame, WOOD, { top: true });
    k.slab([doorX - W / 2 - pw / 2 - 0.2, py, D / 2 + pd + 0.15], [doorX - W / 2 + pw / 2 + 0.2, py, D / 2 + pd + 0.15], [doorX - W / 2 + pw / 2 + 0.2, py + 0.55, D / 2], [doorX - W / 2 - pw / 2 - 0.2, py + 0.55, D / 2], 0.1, L.roof.surf, PART.roof, L.roof.col, SURF.planks, WOOD_DARK);
    k.box(doorX - W / 2 - pw / 2, -0.4, D / 2, doorX - W / 2 + pw / 2, ph, D / 2 + pd, SURF.planks, PART.trim, WOOD_GREY, { skip: ['bottom'] });
  }
  if (o.hood && spec.lod === 0) {
    // a door hood on two brackets
    const hx = doorX - W / 2, yh = ph + Math.min(o.doorH + 0.25, o.floorH - 0.3);
    k.slab([hx - 0.75, yh, D / 2 + 0.75], [hx + 0.75, yh, D / 2 + 0.75], [hx + 0.75, yh + 0.38, D / 2], [hx - 0.75, yh + 0.38, D / 2], 0.07, L.roof.surf, PART.roof, L.roof.col, SURF.planks, WOOD_DARK);
    for (const sx of [-1, 1]) k.beam([hx + sx * 0.6, yh - 0.45, D / 2], [hx + sx * 0.6, yh, D / 2 + 0.6], 0.07, 0.07, SURF.beam, PART.frame, WOOD_DARK, 0.85);
  }
  if (spec.lod === 0 && spec.era >= 2 && spec.kind !== 'tenement' && spec.kind !== 'block' && spec.kind !== 'barn') {
    // a bench by the door
    const bx = doorX - W / 2 + ((spec.hv ?? spec.style) % 2 ? 1.25 : -1.25);
    if (Math.abs(bx) < W / 2 - 0.6) {
      k.box(bx - 0.6, ph + 0.4, D / 2 + 0.15, bx + 0.6, ph + 0.46, D / 2 + 0.5, SURF.planks, PART.prop, WOOD_GREY, {});
      for (const lx of [-0.5, 0.5]) k.box(bx + lx - 0.04, ph - 0.2, D / 2 + 0.2, bx + lx + 0.04, ph + 0.4, D / 2 + 0.45, SURF.planks, PART.prop, WOOD_GREY, {});
    }
  }
  houseAnnex(k, spec, L, o, ph, rng);
  if (spec.lod === 0 && spec.era >= 3 && !o.porch) {
    // a path of worn flags from the door out to the street
    const px = doorX - W / 2;
    for (let i = 0; i < 3; i++) {
      const z = D / 2 + 0.75 + i * 0.62, jx = (rng.float() - 0.5) * 0.25, sw = 0.28 + rng.float() * 0.1;
      k.lathe(px + jx, z, [[sw, -0.12], [sw, 0.0], [sw * 0.85, 0.035]], 7, SURF.rubble, PART.trim, mulc(STONE, 0.62 + rng.float() * 0.18), 0.8, 1);
    }
  }
  if (o.dormers && spec.lod === 0 && o.roof !== 'flat') {
    const n = Math.max(1, Math.floor(W / 4));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (W * (i + 0.5)) / n;
      const yb = y + 0.35, z = D / 2 - 0.9;
      k.box(x - 0.55, yb, z - 1.4, x + 0.55, yb + 1.15, z, L.wall.surf, PART.roof, L.wall.col, { skip: ['bottom'] });
      k.quad([x - 0.32, yb + 0.2, z + 0.01], [x + 0.32, yb + 0.2, z + 0.01], [x + 0.32, yb + 0.95, z + 0.01], [x - 0.32, yb + 0.95, z + 0.01], SURF.glass, PART.glass, GLASS, 1, rng.float());
      k.slab([x - 0.75, yb + 1.1, z + 0.2], [x + 0.0, yb + 1.6, z + 0.2], [x + 0.0, yb + 1.6, z - 1.5], [x - 0.75, yb + 1.1, z - 1.5], 0.08, L.roof.surf, PART.roof, L.roof.col, SURF.planks, WOOD_DARK);
      k.slab([x + 0.0, yb + 1.6, z + 0.2], [x + 0.75, yb + 1.1, z + 0.2], [x + 0.75, yb + 1.1, z - 1.5], [x + 0.0, yb + 1.6, z - 1.5], 0.08, L.roof.surf, PART.roof, L.roof.col, SURF.planks, WOOD_DARK);
    }
  }
  return top + (o.chimneys ? 1 : 0);
}

/** dark timber framing over plastered walls: posts at openings and corners, rails, and braces */
function frameBeams(k: KitBuilder, W: number, D: number, y: number, h: number, front: Opening[], back: Opening[], side: Opening[]): void {
  const bw = 0.16, out = 0.04;
  const run = (L: number, ops: Opening[], place: (x0: number, y0: number, x1: number, y1: number) => void) => {
    // posts every ~1.3 m, skipping openings; top and bottom rails; braces in wide bays
    const posts: number[] = [0.08, L - 0.08];
    for (const o of ops) { posts.push(o.x0 - bw / 2, o.x1 + bw / 2); }
    for (let x = 1.3; x < L - 0.6; x += 1.3) if (!ops.some((o) => x > o.x0 - 0.3 && x < o.x1 + 0.3)) posts.push(x);
    posts.sort((a, b) => a - b);
    for (const x of posts) place(x, 0, x, h);
    place(0, 0.08, L, 0.08);
    place(0, h - 0.08, L, h - 0.08);
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i], b = posts[i + 1];
      if (b - a > 1.0 && !ops.some((o) => o.x1 > a && o.x0 < b)) place(a, 0.1, b, h - 0.1);
    }
  };
  const mk = (ox: number, oz: number, ux: number, uz: number, nx: number, nz: number) => (x0: number, y0: number, x1: number, y1: number) => {
    k.beam([ox + ux * x0 + nx * out, y + y0, oz + uz * x0 + nz * out], [ox + ux * x1 + nx * out, y + y1, oz + uz * x1 + nz * out], bw, 0.06, SURF.beam, PART.frame, WOOD_DARK, 0.85);
  };
  run(W, front, mk(-W / 2, D / 2, 1, 0, 0, 1));
  run(W, back, mk(W / 2, -D / 2, -1, 0, 0, -1));
  run(D, side, mk(W / 2, D / 2, 0, -1, 1, 0));
  run(D, side, mk(-W / 2, -D / 2, 0, 1, -1, 0));
}

/** gambrel (barn) roof: two pitches per side */
function gambrelRoof(k: KitBuilder, W: number, D: number, T: number, yE: number, over: number, rf: RoofLook, wall: WallLook, lod: number): number {
  const lower = 1.1, upper = 0.45;
  const z1 = D / 2 * 0.55;
  const y1 = yE + (D / 2 - z1) * Math.tan(lower);
  const y2 = y1 + z1 * Math.tan(upper);
  const yEave = yE - over * Math.tan(lower);
  const ox = over * 0.6;
  for (const s of [1, -1]) {
    const a: V3 = [-s * (W / 2 + ox), yEave, s * (D / 2 + over)], b: V3 = [s * (W / 2 + ox), yEave, s * (D / 2 + over)];
    const c: V3 = [s * (W / 2 + ox), y1, s * z1], d: V3 = [-s * (W / 2 + ox), y1, s * z1];
    k.slab(a, b, c, d, rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, s > 0 ? 1 : 0.92);
    k.slab(d, c, [s * (W / 2 + ox), y2, 0], [-s * (W / 2 + ox), y2, 0], rf.thick, rf.surf, PART.roof, rf.col, rf.underSurf, rf.under, s > 0 ? 1 : 0.92);
  }
  for (const sx of [1, -1]) {
    const x = sx * W / 2;
    const pts: V3[] = [[x, yE, sx * D / 2], [x, y1, sx * z1], [x, y2, 0], [x, y1, -sx * z1], [x, yE, -sx * D / 2]];
    for (let i = 1; i < pts.length - 1; i++) k.triangle(pts[0], pts[i], pts[i + 1], wall.surf, PART.wall, wall.col, 0.9);
    const xi = sx * (W / 2 - T);
    const pin: V3[] = pts.map((p) => [xi, p[1], -p[2]]);
    for (let i = 1; i < pin.length - 1; i++) k.triangle(pin[0], pin[i], pin[i + 1], SURF.plaster, PART.wall, INTERIOR, 0.5);
  }
  if (lod === 0) k.beam([-W / 2 - ox, y2 + 0.03, 0], [W / 2 + ox, y2 + 0.03, 0], 0.2, 0.14, rf.capSurf, PART.roof, rf.cap, 0.9);
  return y2;
}

/** lean-to: forked posts, a ridge pole, rafters to the ground thatched with bark and leaves, a bed of litter */
function leanTo(k: KitBuilder, spec: BuildingSpec, rng: Rng): number {
  const W = spec.w, D = spec.d, H = 1.9;
  const pole = WOOD_GREY;
  for (const sx of [-1, 1]) {
    const x = sx * W / 2;
    k.tube([[x, -0.3, D / 2], [x + sx * 0.05, H * 0.6, D / 2 + 0.02], [x, H + 0.1, D / 2]], [0.07, 0.06, 0.05], 6, SURF.bark, PART.frame, pole, { ao0: 0.6 });
    // the fork
    k.tube([[x, H * 0.85, D / 2], [x + sx * 0.18, H + 0.3, D / 2 + 0.05]], [0.04, 0.025], 5, SURF.bark, PART.frame, pole);
  }
  k.tube([[-W / 2 - 0.3, H, D / 2], [W / 2 + 0.3, H + 0.04, D / 2]], [0.06, 0.055], 6, SURF.bark, PART.frame, pole);
  const n = spec.lod === 0 ? 9 : 5;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (W * i) / (n - 1);
    k.tube([[x, H + 0.05, D / 2 + 0.15], [x + (rng.float() - 0.5) * 0.2, -0.1, -D / 2]], [0.04, 0.035], 5, SURF.bark, PART.frame, mulc(pole, 0.9), { ao0: 0.9, ao1: 0.6 });
  }
  // the covering: a thick slab of bark and leaves
  k.slab([-W / 2 - 0.15, 0.05, -D / 2 - 0.1], [W / 2 + 0.15, 0.05, -D / 2 - 0.1], [W / 2 + 0.15, H + 0.12, D / 2 + 0.05], [-W / 2 - 0.15, H + 0.12, D / 2 + 0.05], 0.22, SURF.thatch, PART.roof, mixc(THATCH, [0.12, 0.13, 0.05], 0.45), SURF.thatch, mulc(THATCH, 0.4));
  // bedding
  k.quad([-W / 2, 0.06, D / 2], [W / 2, 0.06, D / 2], [W / 2, 0.06, -D / 2 + 0.3], [-W / 2, 0.06, -D / 2 + 0.3], SURF.thatch, PART.prop, mulc(THATCH, 0.6), 0.5);
  return H + 0.4;
}

/** hide tent: a tipi of poles wrapped in stitched hides, smoke flap, door */
function tent(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const R = Math.min(spec.w, spec.d) / 2, H = R * 1.9;
  const sides = spec.lod === 0 ? 14 : 8;
  const hide = mulc(HIDE, 0.85 + rng.float() * 0.3);
  const tint = spec.style % 3 === 0 ? mixc(hide, [0.45, 0.12, 0.05], 0.25) : hide;
  // cover (a cone open near the top), with the door cut as a dark panel
  const prof: [number, number][] = [[R, -0.05], [R * 0.72, H * 0.3], [R * 0.4, H * 0.62], [R * 0.13, H * 0.86]];
  k.lathe(0, 0, prof, sides, SURF.hide, PART.roof, tint, 0.7, 1);
  k.lathe(0, 0, prof.slice().reverse().map(([r, y]) => [r * 0.97, y] as [number, number]), sides, SURF.hide, PART.roof, mulc(tint, 0.35), 0.4, 0.4);
  // door flap
  k.quad([-0.38, 0.0, R + 0.02], [0.38, 0.0, R + 0.02], [0.24, 1.25, R * 0.72 + 0.04], [-0.24, 1.25, R * 0.72 + 0.04], SURF.hide, PART.door, mulc(tint, 0.25), 0.5);
  // painted band
  if (spec.lod === 0) {
    const bandY = H * 0.36;
    k.lathe(0, 0, [[R * 0.68 + 0.012, bandY], [R * 0.62 + 0.012, bandY + 0.32]], sides, SURF.hide, PART.trim, spec.mood < -0.33 ? [0.03, 0.02, 0.02] : [0.4, 0.06, 0.03], 0.9, 0.9);
  }
  // poles crossing above the top
  const poles = spec.lod === 0 ? 9 : 5;
  for (let i = 0; i < poles; i++) {
    const a = (i / poles) * Math.PI * 2 + 0.3;
    k.tube([[Math.cos(a) * R * 0.98, -0.1, Math.sin(a) * R * 0.98], [-Math.cos(a) * 0.35, H * 1.18, -Math.sin(a) * 0.35]], [0.045, 0.03], 4, SURF.bark, PART.frame, WOOD_GREY);
  }
  em.push({ p: [0, H * 0.95, 0], kind: EMIT.smoke, size: 0.3 });
  return H * 1.2;
}

/** round hut: daub / wattle wall with a door, a conical thatch roof with a deep eave, a top knot */
function hut(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const hv = spec.hv ?? 0;
  const R = Math.min(spec.w, spec.d) / 2 * (0.85 + [0, -0.06, 0.05, -0.03, 0.03, -0.08][hv % 6]);
  const wallH = 1.7 + [0, 0.15, -0.12, 0.25, 0.05, -0.05][hv % 6];
  const sides = spec.lod === 0 ? 18 : 10;
  const T = 0.25;
  // wall: two arcs leaving a door gap at +Z (angle π/2)
  const gap = 0.8 / R;
  const a0 = Math.PI / 2 + gap / 2, a1 = Math.PI / 2 - gap / 2 + Math.PI * 2;
  k.cylinder(0, 0, -0.6, wallH, R, R * 0.97, sides, L.wall.surf, PART.wall, L.wall.col, { arc: [a0, a1], aoLow: 0.7, aoHigh: 0.85 });
  // inner face (dark) and the wall top
  const inner = (y0: number, y1: number) => {
    const ring0: number[] = [], ring1: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const a = a0 + ((a1 - a0) * s) / sides;
      const ca = Math.cos(a), sa = Math.sin(a);
      ring0.push(k.vert(ca * (R - T), y0, sa * (R - T), -ca, 0, -sa, SURF.plaster, PART.wall, INTERIOR, 0.4));
      ring1.push(k.vert(ca * (R * 0.97 - T), y1, sa * (R * 0.97 - T), -ca, 0, -sa, SURF.plaster, PART.wall, INTERIOR, 0.4));
    }
    for (let s = 0; s < sides; s++) { k.tri(ring0[s], ring0[s + 1], ring1[s + 1]); k.tri(ring0[s], ring1[s + 1], ring1[s]); }
  };
  inner(0, wallH);
  // door jambs
  for (const a of [a0, a1]) {
    const ca = Math.cos(a), sa = Math.sin(a);
    k.beam([ca * (R - T / 2), -0.2, sa * (R - T / 2)], [ca * (R - T / 2), wallH, sa * (R - T / 2)], T + 0.04, 0.14, SURF.bark, PART.frame, WOOD_DARK, 0.8);
  }
  k.quad([-0.45, 0, R - 0.5], [0.45, 0, R - 0.5], [0.45, wallH - 0.1, R - 0.5], [-0.45, wallH - 0.1, R - 0.5], SURF.hide, PART.door, mulc(HIDE, 0.4), 0.4);
  const top = coneRoof(k, R, wallH, R * [1.15, 1.32, 1.02, 1.22, 1.4, 1.08][hv % 6], [0.85, 0.7, 0.95, 0.8, 0.75, 1.0][hv % 6], L.roof, sides);
  // the top knot of bound straw
  if (spec.lod === 0) k.lathe(0, 0, [[0.28, top - 0.3], [0.2, top], [0.05, top + 0.35]], 8, SURF.thatch, PART.roof, mulc(L.roof.col, 0.75), 0.8, 1);
  // a smoke hole: hearth smoke seeps through the thatch
  em.push({ p: [0, top - 0.1, 0], kind: EMIT.smoke, size: 0.25 });
  void rng;
  return top + 0.35;
}

/** longhouse: a long hall with a sagging ridge, low walls, carved gable boards and a smoke hole */
function longhouse(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = Math.max(spec.w, spec.d), D = Math.min(spec.w, spec.d);
  const H = 2.0, T = 0.3;
  plinth(k, W, D, 0.25, SURF.rubble, L.plinthCol);
  const wall: WallLook = { ...L.wall, surf: SURF.logs, col: mulc(WOOD, 1.1) };
  const front: Opening[] = [{ x0: W / 2 - 0.6, x1: W / 2 + 0.6, y0: 0, y1: 1.85, kind: 'door' }];
  boxWalls(k, { W, D, H, T, y0: 0.25, front, back: [], left: [{ x0: D / 2 - T - 0.5, x1: D / 2 - T + 0.5, y0: 0, y1: 1.8, kind: 'door' }], right: [] }, wall, rng);
  const top = gableRoof(k, W, D, T, 2.25, 0.82, 0.6, L.roof, { surf: SURF.planks, col: WOOD }, spec.lod);
  if (spec.lod === 0) {
    // crossed, carved barge boards at both gables
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 + 0.5);
      k.beam([x, 2.0, D / 2 + 0.5], [x, top + 0.9, -0.5], 0.08, 0.3, SURF.beam, PART.trim, WOOD_DARK, 0.9);
      k.beam([x, 2.0, -D / 2 - 0.5], [x, top + 0.9, 0.5], 0.08, 0.3, SURF.beam, PART.trim, WOOD_DARK, 0.9);
    }
  }
  em.push({ p: [0, top + 0.1, 0], kind: EMIT.smoke, size: 0.5 });
  return top + 1;
}

/** an open hearth: a stone ring with logs and embers (fire, smoke and light come from the emitter) */
function hearth(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const r = Math.min(spec.w, spec.d) * 0.3;
  stoneRing(k, r, spec.lod === 0 ? 11 : 7, 0.24, STONE, rng, spec.lod);
  // ash bed and glowing embers
  k.cylinder(0, 0, -0.1, 0.04, r * 0.95, r * 0.9, 12, SURF.earth, PART.prop, ASH, { top: true, topSurf: SURF.ember, topPart: PART.hot, topCol: [0.08, 0.03, 0.01] });
  // logs leaning into the fire
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.float();
    k.tube([[Math.cos(a) * r * 0.85, 0.05, Math.sin(a) * r * 0.85], [Math.cos(a) * 0.08, 0.38, Math.sin(a) * 0.08]], [0.06, 0.045], 5, SURF.bark, PART.hot, [0.05, 0.03, 0.02]);
  }
  if (spec.lod === 0) {
    // seats: logs around the fire, a spit
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const cx = Math.cos(a) * (r + 1.1), cz = Math.sin(a) * (r + 1.1);
      k.tube([[cx - Math.sin(a) * 0.8, 0.18, cz + Math.cos(a) * 0.8], [cx + Math.sin(a) * 0.8, 0.18, cz - Math.cos(a) * 0.8]], [0.17, 0.16], 7, SURF.bark, PART.prop, WOOD_GREY, { ao0: 0.6, ao1: 0.6 });
    }
    for (const s of [-1, 1]) k.tube([[s * r * 0.9, -0.1, 0], [s * r * 0.85, 1.0, 0]], [0.035, 0.03], 4, SURF.bark, PART.prop, WOOD_DARK);
    k.tube([[-r * 0.95, 0.98, 0], [r * 0.95, 0.98, 0]], [0.025, 0.025], 4, SURF.bark, PART.prop, WOOD_DARK);
  }
  em.push({ p: [0, 0.25, 0], kind: EMIT.hearth, size: r * 0.9 });
  return 1.2;
}

/** beehive kiln: a mudbrick dome with a glowing firing mouth and a vent */
function kiln(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const R = Math.min(spec.w, spec.d) * 0.42;
  const sides = spec.lod === 0 ? 16 : 9;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push([R * Math.cos(t * Math.PI / 2 * 0.92) + 0.02, -0.4 + (R * 1.25 + 0.4) * Math.sin(t * Math.PI / 2)]);
  }
  const col = L.wall.surf === SURF.brick ? L.wall.col : mixc(L.wall.col, [0.42, 0.24, 0.13], 0.5);
  k.lathe(0, 0, prof, sides, L.wall.surf === SURF.brick ? SURF.brick : SURF.mudbrick, PART.wall, col, 0.7, 1);
  // the firing mouth: an arch with a hot interior
  k.push(0, 0, R * 0.92);
  k.box(-0.42, 0, -0.15, 0.42, 0.85, 0.25, SURF.mudbrick, PART.wall, mulc(col, 0.85), { skip: ['bottom', 'nz'] });
  k.quad([-0.28, 0.02, 0.26], [0.28, 0.02, 0.26], [0.28, 0.62, 0.26], [-0.28, 0.62, 0.26], SURF.ember, PART.hot, [0.1, 0.03, 0.01], 1, rng.float());
  k.pop();
  em.push({ p: [0, 0.35, R + 0.2], kind: EMIT.mouth, size: 0.5 });
  em.push({ p: [0, R * 1.25 - 0.3, 0], kind: EMIT.smoke, size: 0.35 });
  if (spec.lod === 0) {
    k.push(R + 0.9, 0, 0.4, 0.3); woodPile(k, 1.4, 3, WOOD, rng); k.pop();
    for (let i = 0; i < 6; i++) k.lathe(-R - 0.6 + (i % 3) * 0.35, 0.5 + Math.floor(i / 3) * 0.4, [[0.1, 0], [0.16, 0.12], [0.13, 0.3], [0.08, 0.36]], 7, SURF.earth, PART.prop, [0.38, 0.17, 0.08], 0.7, 1);
  }
  return R * 1.25;
}

/** bloomery furnace: a tall clay / stone stack with bellows, a glowing tap arch and a slag heap */
function furnace(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const R = Math.min(spec.w, spec.d) * 0.2;
  const H = 3.4;
  const sides = spec.lod === 0 ? 12 : 8;
  const surf = L.wall.surf === SURF.brick ? SURF.brick : SURF.mudbrick;
  const col = mixc(L.wall.col, [0.4, 0.22, 0.12], 0.4);
  k.cylinder(0, 0, -0.5, H, R * 1.35, R * 0.75, sides, surf, PART.wall, col, { top: true, topSurf: SURF.ember, topPart: PART.hot, topCol: [0.08, 0.02, 0.0] });
  k.push(0, 0, R * 1.2);
  k.box(-0.32, 0, -0.1, 0.32, 0.7, 0.2, surf, PART.wall, mulc(col, 0.8), { skip: ['bottom', 'nz'] });
  k.quad([-0.22, 0.03, 0.21], [0.22, 0.03, 0.21], [0.22, 0.5, 0.21], [-0.22, 0.5, 0.21], SURF.ember, PART.hot, [0.1, 0.03, 0.01], 1, rng.float());
  k.pop();
  em.push({ p: [0, 0.3, R * 1.45], kind: EMIT.mouth, size: 0.45 });
  em.push({ p: [0, H + 0.1, 0], kind: EMIT.smoke, size: R * 0.8 });
  if (spec.lod === 0) {
    // bellows (leather bags on a frame) and a slag heap
    k.push(-R * 1.5 - 0.4, 0, 0, Math.PI / 2);
    k.box(-0.35, 0, -0.5, 0.35, 0.35, 0.5, SURF.planks, PART.prop, WOOD, { skip: ['bottom'] });
    k.lathe(0, 0, [[0.3, 0.35], [0.36, 0.5], [0.22, 0.65], [0.02, 0.7]], 8, SURF.hide, PART.prop, HIDE, 0.6, 0.9);
    k.pop();
    k.push(R + 1.4, 0, -0.9); rock(k, 0.9, 0.5, 0.7, [0.06, 0.05, 0.05], rng.float(), 0); k.pop();
    k.push(1.6, 0, 1.2, 0.8); woodPile(k, 1.2, 3, [0.05, 0.04, 0.035], rng); k.pop();
  }
  return H;
}

/** forge: an open timber shed over a stone hearth with a hood and chimney, an anvil, a quench trough */
function forge(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = spec.w, D = spec.d;
  const H = 2.9;
  plinth(k, W, D, 0.15, SURF.rubble, L.plinthCol);
  // back wall (stone) and posts
  k.box(-W / 2, 0.15, -D / 2, W / 2, H, -D / 2 + 0.45, SURF.rubble, PART.wall, mulc(STONE, 0.9), { skip: ['bottom'] });
  for (const sx of [-1, 1]) for (const z of [D / 2 - 0.2, 0]) k.cylinder(sx * (W / 2 - 0.2), z, 0.15, H, 0.12, 0.11, 6, SURF.beam, PART.frame, WOOD, { top: true });
  const top = gableRoof(k, W, D, 0.3, H, 0.55, 0.5, L.roof, null, spec.lod);
  // the hearth with its coal bed, hood and chimney
  k.box(-1.0, 0.15, -D / 2 + 0.45, 1.0, 0.95, -D / 2 + 1.6, SURF.rubble, PART.wall, STONE, { skip: ['bottom'] });
  k.quad([-0.7, 0.96, -D / 2 + 1.45], [0.7, 0.96, -D / 2 + 1.45], [0.7, 0.96, -D / 2 + 0.6], [-0.7, 0.96, -D / 2 + 0.6], SURF.ember, PART.hot, [0.12, 0.03, 0.01], 1, rng.float());
  if (spec.lod === 0) {
    k.slab([-1.0, 2.0, -D / 2 + 1.7], [1.0, 2.0, -D / 2 + 1.7], [0.5, 2.6, -D / 2 + 0.5], [-0.5, 2.6, -D / 2 + 0.5], 0.1, SURF.rubble, PART.wall, STONE, SURF.rubble, STONE_DARK);
    // anvil on a stump, quench trough, tools rack
    k.cylinder(0.3, -D / 2 + 2.6, 0.15, 0.75, 0.28, 0.25, 8, SURF.bark, PART.prop, WOOD, { top: true });
    k.box(0.05, 0.75, -D / 2 + 2.45, 0.6, 0.98, -D / 2 + 2.75, SURF.iron, PART.prop, IRON, {});
    k.box(-1.8, 0.15, -D / 2 + 2.2, -1.0, 0.7, -D / 2 + 3.3, SURF.planks, PART.prop, WOOD_DARK, { skip: ['bottom'], topSurf: SURF.glass, topCol: [0.02, 0.03, 0.03] });
  }
  chimney(k, 0, -D / 2 + 0.3, 2.4, top + 1.2, 0.8, SURF.rubble, mulc(STONE, 0.85), em);
  em.push({ p: [0, 1.1, -D / 2 + 1.0], kind: EMIT.mouth, size: 0.6 });
  return top + 1.3;
}

/** granary: raised on staddle stones, small walls under a steep roof (or a domed silo for mudbrick) */
function granary(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  if (L.wall.surf === SURF.mudbrick || L.wall.surf === SURF.plaster) {
    // a cluster of domed silos
    const r = Math.min(spec.w, spec.d) * 0.26;
    const top = r * 2.6;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const cx = Math.cos(a) * r * 1.05, cz = Math.sin(a) * r * 1.05;
      const prof: [number, number][] = [[r, -0.5], [r * 1.02, r * 1.2], [r * 0.85, r * 1.9], [r * 0.45, r * 2.4], [0.12, r * 2.6]];
      k.lathe(cx, cz, prof, spec.lod === 0 ? 14 : 8, L.wall.surf, PART.wall, L.wall.col, 0.7, 1);
      if (spec.lod === 0) k.box(cx - 0.25, r * 0.9, cz + r * 0.95, cx + 0.25, r * 1.35, cz + r * 1.05, SURF.planks, PART.door, WOOD_DARK, {});
    }
    return top;
  }
  const W = spec.w, D = spec.d;
  const lift = 0.75;
  // staddle stones (mushroom stones)
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
    const x = sx * (W / 2 - 0.35), z = sz * (D / 2 - 0.35);
    k.cylinder(x, z, -0.4, lift - 0.12, 0.16, 0.1, 6, SURF.rubble, PART.plinth, STONE, {});
    k.cylinder(x, z, lift - 0.12, lift, 0.3, 0.3, 8, SURF.rubble, PART.plinth, STONE, { top: true });
  }
  const wall: WallLook = { ...L.wall, surf: L.wall.surf === SURF.daub ? SURF.planks : L.wall.surf, col: L.wall.surf === SURF.daub ? WOOD : L.wall.col };
  boxWalls(k, { W, D, H: 2.1, T: 0.15, y0: lift, front: [{ x0: W / 2 - 0.5, x1: W / 2 + 0.5, y0: 0.0, y1: 1.6, kind: 'door' }], back: [], left: [], right: [] }, wall, rng);
  if (spec.lod === 0) k.beam([0, -0.05, D / 2 + 1.0], [0, lift + 0.05, D / 2 + 0.05], 0.4, 0.06, SURF.planks, PART.prop, WOOD_GREY, 0.8);
  return gableRoof(k, W, D, 0.15, lift + 2.1, 0.85, 0.45, L.roof, { surf: wall.surf, col: wall.col }, spec.lod);
}

/** workshop: a long building with a wide door, an awning, a bench and stock outside */
function workshop(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = spec.w, D = spec.d;
  const ph = 0.3, H = 3.0, T = L.wall.surf === SURF.rubble ? 0.45 : 0.3;
  plinth(k, W, D, ph, L.plinthSurf, L.plinthCol);
  const front: Opening[] = [{ x0: W * 0.25 - 1.2, x1: W * 0.25 + 1.2, y0: 0, y1: 2.5, kind: 'gap' }, ...windowRow(W * 0.5, 1.0, [0.9, 1.1], 1.8, 0.6, null).map((o) => ({ ...o, x0: o.x0 + W * 0.5, x1: o.x1 + W * 0.5 }))];
  boxWalls(k, { W, D, H, T, y0: ph, front, back: windowRow(W, 1.1, [0.8, 1.0], 2.2, 1.0, null), left: [], right: [] }, L.wall, rng);
  const top = gableRoof(k, W, D, T, ph + H, 0.6, 0.45, L.roof, { surf: L.wall.surf, col: L.wall.col }, spec.lod);
  chimney(k, -W / 2 + 0.8, -D * 0.1, ph + H - 0.5, top + 0.8, 0.55, SURF.rubble, mulc(STONE, 0.9), em);
  if (spec.lod === 0) {
    // awning over the yard side, a bench, crates and a log pile
    const ay = ph + 2.4;
    for (const x of [-W / 2 + 0.4, -0.4]) k.cylinder(x, D / 2 + 2.0, 0, ay, 0.07, 0.06, 6, SURF.beam, PART.frame, WOOD, { top: true });
    k.slab([-W / 2 + 0.2, ay, D / 2 + 2.3], [-0.2, ay, D / 2 + 2.3], [-0.2, ay + 0.5, D / 2], [-W / 2 + 0.2, ay + 0.5, D / 2], 0.06, SURF.cloth, PART.roof, CLOTH[spec.style % CLOTH.length], SURF.cloth, mulc(CLOTH[spec.style % CLOTH.length], 0.5));
    k.box(-W / 2 + 0.6, 0, D / 2 + 0.6, -1.0, 0.85, D / 2 + 1.3, SURF.planks, PART.prop, WOOD, { skip: ['bottom'] });
    crate(k, W / 2 - 0.9, D / 2 + 1.2, 0.7, 0.3, WOOD_GREY);
    crate(k, W / 2 - 1.8, D / 2 + 1.5, 0.6, -0.2, WOOD);
    barrel(k, W / 2 - 0.6, D / 2 + 2.3, 0.32, 0.9, WOOD_DARK);
    k.push(-W / 2 - 1.2, 0, 0, Math.PI / 2); woodPile(k, 2.0, 3, WOOD, rng); k.pop();
  }
  return top + 0.9;
}

/** temples: henge, ziggurat, columned temple, cathedral, pagoda, domed — by era, style and mood */
// ───────────────────────────── temples ─────────────────────────────
//
// A temple is built in its people's tradition (BuildingSpec.family: the family of their dwellings — earthen, timber or
// masonry; else the temple's own material) and era: a ring of standing stones before the bronze age; then a terraced
// mudbrick ziggurat (earthen), a great timber hall on a stone platform (timber) or a colonnaded temple (masonry); later
// a domed hall (earthen, and masons of some cultures), a tiered pagoda with swept eaves (timber) or a cathedral
// (masonry). Mood dresses it and its grounds (CONTRACT §8.8): a fearful people builds in dark basalt behind a walled
// precinct with spiked parapets, braziers on the gate, black and red banners, horned skull totems and a stained altar;
// a benevolent one leaves it open, whitewashed or of warm stone, with gardens, a paved approach lined with lanterns and
// an altar heaped with offerings.

// (fearful stone is dark basalt, ~0.08: at 0.05 with a blue cast every fearful temple read as a black void)
const BASALT: RGB = [0.1, 0.092, 0.082];
const BONE: RGB = [0.6, 0.56, 0.46];
const BLOOD: RGB = [0.13, 0.012, 0.01];
const LEAF: RGB = [0.04, 0.075, 0.028];
// oxblood lacquer (benevolent posts), black lacquer (fearful timber), ochre plaster, a whitewash for trims and walls
const LACQUER: RGB = [0.25, 0.04, 0.03];
const BLACK_LACQUER: RGB = [0.095, 0.08, 0.066];
const OCHRE: RGB = [0.5, 0.34, 0.15];
const WHITEWASH: RGB = [0.7, 0.67, 0.6];
const BRONZE: RGB = [0.24, 0.15, 0.06];
const FLOWERS: RGB[] = [[0.6, 0.08, 0.06], [0.7, 0.55, 0.08], [0.75, 0.72, 0.66], [0.32, 0.12, 0.45], [0.75, 0.3, 0.05]];

export type TempleForm = 'henge' | 'ziggurat' | 'columns' | 'hall' | 'pagoda' | 'dome' | 'cathedral';

/** a temple's form, from its people's building tradition and era (never from the style index alone: a pagoda among
 *  stone houses read as a foreign building) */
export function templeForm(spec: BuildingSpec): TempleForm {
  if (spec.era <= 2) return 'henge';
  const id = spec.mat.id;
  const fam = spec.family ?? (id === 'mudbrick' || id === 'chitin' || id === 'resin' || id === 'ice' ? 'earth'
    : id === 'wood' || id === 'timber' || id === 'wattle' || id === 'thatch' || id === 'hide' || id === 'cloth' ? 'timber' : 'stone');
  if (fam === 'earth') return spec.era <= 5 ? 'ziggurat' : 'dome';
  if (fam === 'timber') return spec.era <= 4 ? 'hall' : 'pagoda';
  return spec.era <= 5 ? 'columns' : (spec.style & 3) === 1 ? 'dome' : 'cathedral';
}

interface TempleLook {
  fear: boolean;
  kind: boolean;
  /** masonry: dark basalt (fearful), warm stone / whitewash (benevolent), plain stone */
  stone: RGB;
  /** earthen walls in the same mood */
  earth: RGB;
  metal: RGB;
  cloth: RGB;
  /** posts and carved timber: black lacquer, oxblood lacquer, dark wood */
  timber: RGB;
  /** their surface: lacquered (a sheen) or plain beams */
  timberSurf: number;
}

function templeLook(spec: BuildingSpec, L: Look): TempleLook {
  const fear = spec.mood < -0.33, kind = spec.mood > 0.33;
  // (weathered limestone / sandstone, not a white: in the sun under the grade a 0.55 albedo read as plaster)
  const plain = mixc(mulc(STONE, 1.08), [0.52, 0.46, 0.36], 0.3);
  const earth0 = mixc(spec.mat.id === 'mudbrick' ? spec.mat.wallCol : L.wall.col, [0.52, 0.38, 0.24], 0.35);
  return {
    fear, kind,
    stone: fear ? BASALT : kind ? mixc(plain, [0.6, 0.52, 0.4], 0.3) : plain,
    earth: fear ? mixc(earth0, BASALT, 0.72) : kind ? mixc(earth0, WHITEWASH, 0.6) : earth0,
    // (fearful accents in dark bronze and dried-blood red)
    metal: fear ? BRONZE : GOLD,
    cloth: fear ? (spec.style & 1 ? [0.045, 0.04, 0.036] : [0.22, 0.03, 0.02]) : CLOTH[(spec.style + (kind ? 2 : 0)) % CLOTH.length],
    timber: fear ? BLACK_LACQUER : kind ? LACQUER : WOOD_DARK,
    timberSurf: fear || kind ? SURF.lacquer : SURF.beam,
  };
}

/** what the grounds dress around: the temple's extent (x half-width, back and front z incl. stairs) and its top */
interface TempleFrame { top: number; hw: number; back: number; front: number }

function temple(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const T = templeLook(spec, L);
  const form = templeForm(spec);
  const f = form === 'henge' ? henge(k, spec, T, rng, em)
    : form === 'ziggurat' ? ziggurat(k, spec, T, L, rng, em)
      : form === 'hall' ? templeHall(k, spec, T, L, rng, em)
        : form === 'pagoda' ? pagoda(k, spec, T, L, rng, em)
          : form === 'columns' ? colonnade(k, spec, T, L, rng, em)
            : form === 'dome' ? domed(k, spec, T, L, rng, em)
              : cathedral(k, spec, T, L, rng, em);
  templeGrounds(k, spec, T, f, form !== 'henge', rng, em);
  return f.top;
}

/** a battered (sloped) block: base half-size b at y0, top half-size t at y1, with a flat top */
function frustum(k: KitBuilder, b: number, t: number, y0: number, y1: number, surf: number, part: number, col: RGB, topCol: RGB): void {
  for (let q = 0; q < 4; q++) {
    k.push(0, 0, 0, (q * Math.PI) / 2);
    k.quad([-b, y0, b], [b, y0, b], [t, y1, t], [-t, y1, t], surf, part, col, [0.62, 0.62, 0.95, 0.95]);
    k.pop();
  }
  k.quad([-t, y1, t], [t, y1, t], [t, y1, -t], [-t, y1, -t], surf, part, topCol, 0.9);
}

/** a free-standing brazier on an iron stand; coals glow while the temple is lit */
function brazierStand(k: KitBuilder, x: number, z: number, h: number, em: Emitter[], lod: number): void {
  k.cylinder(x, z, -0.2, h - 0.28, 0.1, 0.07, 6, SURF.iron, PART.prop, IRON);
  k.lathe(x, z, [[0.07, h - 0.32], [0.34, h - 0.06], [0.4, h], [0.34, h + 0.015]], lod === 0 ? 9 : 6, SURF.iron, PART.prop, IRON, 0.8, 1);
  k.quad([x - 0.28, h - 0.04, z + 0.28], [x + 0.28, h - 0.04, z + 0.28], [x + 0.28, h - 0.04, z - 0.28], [x - 0.28, h - 0.04, z - 0.28], SURF.ember, PART.hot, [0.05, 0.03, 0.02], 0.8);
  em.push({ p: [x, h + 0.05, z], kind: EMIT.brazier, size: 0.35 });
}

/** a bleached skull with curving horns, its base at (x, y, z), facing +Z */
function hornedSkull(k: KitBuilder, x: number, y: number, z: number, s: number, lod: number): void {
  k.lathe(x, z, [[0.03 * s, y], [0.12 * s, y + 0.03 * s], [0.15 * s, y + 0.13 * s], [0.12 * s, y + 0.25 * s], [0.02 * s, y + 0.29 * s]], lod === 0 ? 7 : 5, SURF.plaster, PART.prop, BONE, 0.8, 1);
  for (const sx of [-1, 1]) {
    if (lod === 0) {
      k.tube([[x + sx * 0.1 * s, y + 0.2 * s, z], [x + sx * 0.32 * s, y + 0.27 * s, z + 0.02 * s], [x + sx * 0.47 * s, y + 0.43 * s, z - 0.04 * s], [x + sx * 0.45 * s, y + 0.64 * s, z - 0.09 * s]],
        [0.05 * s, 0.04 * s, 0.026 * s, 0.006 * s], 5, SURF.plaster, PART.prop, mulc(BONE, 0.72));
    } else k.beam([x + sx * 0.1 * s, y + 0.2 * s, z], [x + sx * 0.45 * s, y + 0.55 * s, z], 0.07 * s, 0.07 * s, SURF.plaster, PART.prop, mulc(BONE, 0.72));
  }
}

/** a pole with a horned skull and rags (fearful grounds) */
function skullTotem(k: KitBuilder, x: number, z: number, h: number, T: TempleLook, rng: Rng, lod: number): void {
  k.cylinder(x, z, -0.4, h, 0.08, 0.055, 5, SURF.bark, PART.prop, T.timber);
  k.beam([x - 0.5, h - 0.55, z], [x + 0.5, h - 0.55, z], 0.07, 0.07, SURF.bark, PART.prop, T.timber);
  hornedSkull(k, x, h - 0.02, z + 0.02, 1.25, lod);
  if (lod === 0) for (const sx of [-1, 1]) {
    const x0 = x + sx * 0.42, len = 0.6 + rng.float() * 0.5;
    k.quad([x0 - 0.07, h - 0.6 - len, z + 0.04], [x0 + 0.07, h - 0.6 - len, z + 0.04], [x0 + 0.08, h - 0.58, z + 0.04], [x0 - 0.08, h - 0.58, z + 0.04], SURF.cloth, PART.prop, T.cloth, 0.8);
    k.quad([x0 + 0.07, h - 0.6 - len, z + 0.03], [x0 - 0.07, h - 0.6 - len, z + 0.03], [x0 - 0.08, h - 0.58, z + 0.03], [x0 + 0.08, h - 0.58, z + 0.03], SURF.cloth, PART.prop, T.cloth, 0.6);
  }
}

/** a banner on a pole: a cloth hanging from a crossbar, both faces, with a forked tail */
function bannerPole(k: KitBuilder, x: number, z: number, h: number, col: RGB, T: TempleLook, lod: number): void {
  k.cylinder(x, z, -0.4, h + 0.25, 0.07, 0.05, 5, T.timberSurf, PART.prop, T.timber, { top: true });
  if (!T.fear && lod === 0) k.lathe(x, z, [[0.09, h + 0.25], [0.12, h + 0.38], [0.02, h + 0.62]], 6, SURF.metal, PART.prop, T.metal, 1, 1);
  if (T.fear) k.cylinder(x, z, h + 0.25, h + 0.85, 0.05, 0.0, 4, SURF.iron, PART.prop, IRON);
  k.beam([x - 0.62, h, z + 0.08], [x + 0.62, h, z + 0.08], 0.06, 0.06, T.timberSurf, PART.prop, T.timber);
  const y0 = h - 0.05, y1 = h - 2.3, zf = z + 0.1;
  const tail = (zz: number, back: boolean) => {
    // a swallowtail: two points hanging below the cloth, a notch between them
    const a: V3 = [x - 0.55, y1, zz], b: V3 = [x + 0.55, y1, zz], n: V3 = [x, y1 - 0.12, zz];
    const l: V3 = [x - 0.55, y1 - 0.55, zz], r: V3 = [x + 0.55, y1 - 0.55, zz];
    const ao = back ? 0.6 : 0.85;
    if (!back) { k.triangle(a, l, n, SURF.cloth, PART.prop, col, ao); k.triangle(a, n, b, SURF.cloth, PART.prop, col, ao); k.triangle(n, r, b, SURF.cloth, PART.prop, col, ao); }
    else { k.triangle(n, l, a, SURF.cloth, PART.prop, col, ao); k.triangle(b, n, a, SURF.cloth, PART.prop, col, ao); k.triangle(b, r, n, SURF.cloth, PART.prop, col, ao); }
  };
  k.quad([x - 0.55, y1, zf], [x + 0.55, y1, zf], [x + 0.55, y0, zf], [x - 0.55, y0, zf], SURF.cloth, PART.prop, col, [0.85, 0.85, 1, 1]);
  k.quad([x + 0.55, y1, zf - 0.01], [x - 0.55, y1, zf - 0.01], [x - 0.55, y0, zf - 0.01], [x + 0.55, y0, zf - 0.01], SURF.cloth, PART.prop, col, 0.6);
  tail(zf, false);
  tail(zf - 0.01, true);
  // an emblem: a pale disc (benevolent) or a dark band (fearful)
  if (lod === 0) {
    const ec: RGB = T.fear ? [0.012, 0.01, 0.01] : mixc(col, [0.85, 0.8, 0.6], 0.6);
    k.quad([x - 0.28, y0 - 1.25, zf + 0.005], [x + 0.28, y0 - 1.25, zf + 0.005], [x + 0.28, y0 - 0.7, zf + 0.005], [x - 0.28, y0 - 0.7, zf + 0.005], SURF.cloth, PART.prop, ec, 0.9);
  }
}

/**
 * A framed paper lantern, its shade's foot at (x, y, z): a ribbed, bellied paper shade (PART.lantern: it glows at
 * night) between lacquered wooden rings, a little hood and a hook — not a white box.
 */
function paperLantern(k: KitBuilder, x: number, y: number, z: number, s: number, T: TempleLook, lod: number): void {
  const r = 0.17 * s, h = 0.44 * s;
  const paper: RGB = [0.6, 0.44, 0.24];
  k.cylinder(x, z, y - 0.04 * s, y + 0.01 * s, r * 0.74, r * 0.74, 8, T.timberSurf, PART.prop, T.timber, { bottom: true });
  k.lathe(x, z, [[r * 0.72, y], [r * 0.96, y + h * 0.2], [r, y + h * 0.5], [r * 0.94, y + h * 0.8], [r * 0.7, y + h]], lod === 0 ? 10 : 6, SURF.plaster, PART.lantern, paper, 0.95, 1);
  if (lod === 0) for (let i = 0; i < 6; i++) {
    // the ribs of the frame through the paper
    const a = (i / 6) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    k.beam([x + ca * r * 0.74, y + 0.01, z + sa * r * 0.74], [x + ca * r * 1.005, y + h * 0.5, z + sa * r * 1.005], 0.012 * s, 0.012 * s, T.timberSurf, PART.prop, T.timber, 0.9);
    k.beam([x + ca * r * 1.005, y + h * 0.5, z + sa * r * 1.005], [x + ca * r * 0.72, y + h - 0.01, z + sa * r * 0.72], 0.012 * s, 0.012 * s, T.timberSurf, PART.prop, T.timber, 0.9);
  }
  k.cylinder(x, z, y + h - 0.01, y + h + 0.05 * s, r * 0.72, r * 0.72, 8, T.timberSurf, PART.prop, T.timber, {});
  k.cylinder(x, z, y + h + 0.05 * s, y + h + 0.16 * s, r * 0.95, 0.02, 8, T.timberSurf, PART.prop, T.timber, {});
}

/** a lantern on a post (benevolent grounds): a paper lantern hung from a bracket; glows at night */
function lanternPost(k: KitBuilder, x: number, z: number, h: number, T: TempleLook, lod: number): void {
  k.cylinder(x, z, -0.3, h + 0.55, 0.07, 0.055, 6, T.timberSurf, PART.prop, T.timber, { top: true });
  k.beam([x, h + 0.5, z], [x + 0.42, h + 0.5, z], 0.06, 0.07, T.timberSurf, PART.prop, T.timber, 0.9);
  k.beam([x + 0.38, h + 0.47, z], [x + 0.38, h + 0.3, z], 0.015, 0.015, SURF.rope, PART.prop, [0.08, 0.06, 0.04]);
  paperLantern(k, x + 0.38, h - 0.22, z, 1, T, lod);
}

/** a shrub (garden): a lumpy mound of leaf clusters, never a turned cone */
function shrub(k: KitBuilder, x: number, z: number, r: number, h: number, col: RGB, lod: number): void {
  const from = k.vertexCount;
  const ph = x * 3.1 + z * 1.7;
  k.lathe(x, z, [[r * 0.55, -0.05], [r * 0.95, h * 0.25], [r, h * 0.5], [r * 0.85, h * 0.75], [r * 0.5, h * 0.93], [0.03, h]], lod === 0 ? 9 : 6, SURF.leaves, PART.prop, col, 0.55, 1);
  k.jitterRadial(from, x, z, (a, y) => r * (0.13 * Math.sin(3 * a + ph) + 0.09 * Math.sin(5 * a + ph * 2 + y * 4) + 0.06 * Math.sin(8 * a + y * 9 + ph)) * Math.min(1, y / (0.3 * h) + 0.2));
}

/** a clipped hedge along x = xc from z0 to z1: a row of overlapping lumpy mounds of leaf clusters */
function hedge(k: KitBuilder, xc: number, z0: number, z1: number, w: number, h: number, col: RGB, rng: Rng, lod: number): void {
  const n = Math.max(2, Math.round((z1 - z0) / (lod === 0 ? 0.75 : 1.4)));
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    shrub(k, xc + (rng.float() - 0.5) * 0.08, z, w * (0.95 + 0.15 * rng.float()), h * (0.92 + 0.14 * rng.float()), mulc(col, 0.9 + 0.2 * rng.float()), lod);
  }
}

/** a kerbed flower bed from (x0, z0) to (x1, z1) */
function flowerBed(k: KitBuilder, x0: number, z0: number, x1: number, z1: number, kerb: RGB, rng: Rng, lod: number): void {
  k.box(x0, -0.3, z0, x1, 0.2, z1, SURF.ashlar, PART.trim, kerb, { skip: ['bottom'], aoLow: 0.7, topSurf: SURF.earth, topCol: [0.06, 0.045, 0.03] });
  const n = lod === 0 ? Math.max(3, Math.round(((x1 - x0) * (z1 - z0)) / 0.5)) : 0;
  for (let i = 0; i < Math.min(n, 18); i++) {
    const x = x0 + 0.2 + rng.float() * (x1 - x0 - 0.4), z = z0 + 0.2 + rng.float() * (z1 - z0 - 0.4);
    const c = FLOWERS[Math.floor(rng.float() * FLOWERS.length)];
    k.lathe(x, z, [[0.1, 0.18], [0.17, 0.3], [0.12, 0.4], [0.02, 0.44]], 5, SURF.thatch, PART.prop, rng.float() < 0.4 ? mulc(LEAF, 1.3) : c, 0.7, 1);
  }
}

/** the altar before the temple: stained and skull-crowned (fearful), heaped with offerings (benevolent) */
function altarStone(k: KitBuilder, x: number, z: number, hw: number, hd: number, T: TempleLook, rng: Rng, lod: number): void {
  const c = T.fear ? mulc(BASALT, 1.5) : mulc(T.stone, 0.92);
  k.box(x - hw - 0.15, -0.4, z - hd - 0.15, x + hw + 0.15, 0.25, z + hd + 0.15, SURF.ashlar, PART.trim, mulc(c, 0.9), { skip: ['bottom'], aoLow: 0.6 });
  k.box(x - hw, 0.25, z - hd, x + hw, 1.0, z + hd, SURF.ashlar, PART.wall, c, { skip: ['bottom'], aoLow: 0.7, topCol: T.fear ? BLOOD : mulc(c, 1.1) });
  if (lod > 0) return;
  if (T.fear) {
    // dark runs down the front, a skull on the slab
    for (let i = 0; i < 5; i++) {
      const xx = x - hw * 0.8 + i * hw * 0.4, y0 = 0.3 + rng.float() * 0.45;
      k.quad([xx - 0.04, y0, z + hd + 0.005], [xx + 0.04, y0, z + hd + 0.005], [xx + 0.07, 1.0, z + hd + 0.005], [xx - 0.07, 1.0, z + hd + 0.005], SURF.plaster, PART.trim, BLOOD, 0.8);
    }
    hornedSkull(k, x, 1.0, z, 1.1, lod);
  } else {
    // offerings: little clay bowls of fruit and grain, flowers laid between them, a lamp (small: 8–15 cm, muted)
    const fruit: RGB[] = [[0.3, 0.07, 0.035], [0.4, 0.26, 0.07], [0.14, 0.2, 0.05], [0.36, 0.15, 0.05], [0.42, 0.34, 0.18]];
    const clay: RGB = [0.3, 0.17, 0.09];
    const n = T.kind ? 9 : 4;
    for (let i = 0; i < n; i++) {
      const gx = x + (rng.float() - 0.5) * hw * 1.6, gz = z + (rng.float() - 0.5) * hd * 1.5;
      const br = 0.06 + rng.float() * 0.03;
      k.lathe(gx, gz, [[br * 0.45, 1.0], [br * 0.95, 1.02], [br, 1.05], [br * 0.88, 1.055]], 7, SURF.plaster, PART.prop, mulc(clay, 0.85 + 0.3 * rng.float()), 0.75, 1);
      // its heap: two or three fruits or a mound of grain
      const fc = fruit[Math.floor(rng.float() * fruit.length)];
      for (let j = 0; j < 2 + Math.floor(rng.float() * 2); j++) {
        const fr = 0.022 + rng.float() * 0.014, fx = gx + (rng.float() - 0.5) * br, fz = gz + (rng.float() - 0.5) * br, fy = 1.03 + j * 0.012;
        k.lathe(fx, fz, [[0.002, fy], [fr * 0.8, fy + fr * 0.3], [fr, fy + fr], [fr * 0.75, fy + fr * 1.7], [0.002, fy + fr * 2]], 6, SURF.plaster, PART.prop, mulc(fc, 0.85 + 0.3 * rng.float()), 0.8, 1);
      }
    }
    // flowers strewn on the slab: little rosettes of petals
    for (let i = 0; i < (T.kind ? 10 : 4); i++) {
      const fx = x + (rng.float() - 0.5) * hw * 1.8, fz = z + (rng.float() - 0.5) * hd * 1.8;
      const c = mulc(FLOWERS[Math.floor(rng.float() * FLOWERS.length)], 0.7);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + rng.float() * 0.4;
        k.triangle([fx, 1.006, fz], [fx + Math.cos(a - 0.4) * 0.04, 1.012, fz + Math.sin(a - 0.4) * 0.04], [fx + Math.cos(a + 0.4) * 0.04, 1.012, fz + Math.sin(a + 0.4) * 0.04], SURF.cloth, PART.prop, c, 0.9);
      }
    }
  }
}

/** grounds: precinct, approach, altar, braziers, banners, totems, gardens, lanterns — by mood */
function templeGrounds(k: KitBuilder, spec: BuildingSpec, T: TempleLook, f: TempleFrame, walled: boolean, rng: Rng, em: Emitter[]): void {
  const lod = spec.lod;
  const zA = f.front + 2.4; // the altar, before the steps
  if (T.fear) {
    if (walled) {
      // a walled precinct of dark basalt with a spiked parapet; the gate between two pylons carries braziers
      const hx = f.hw + 1.8, zb = f.back - 1.8, zf = zA + 2.6, H = 2.3, Tw = 0.55, gw = 3.4;
      const wc = mulc(BASALT, 1.25);
      const o = { skip: ['bottom'], aoLow: 0.55 };
      k.box(-hx, -1.5, zb, hx, H, zb + Tw, SURF.rubble, PART.wall, wc, o);
      k.box(-hx, -1.5, zb + Tw, -hx + Tw, H, zf, SURF.rubble, PART.wall, wc, o);
      k.box(hx - Tw, -1.5, zb + Tw, hx, H, zf, SURF.rubble, PART.wall, wc, o);
      k.box(-hx + Tw, -1.5, zf - Tw, -gw / 2, H, zf, SURF.rubble, PART.wall, wc, o);
      k.box(gw / 2, -1.5, zf - Tw, hx - Tw, H, zf, SURF.rubble, PART.wall, wc, o);
      for (const sx of [-1, 1]) {
        const x0 = sx * (gw / 2 + 0.55);
        k.box(x0 - 0.55, -1.5, zf - Tw - 0.25, x0 + 0.55, H + 1.3, zf + 0.25, SURF.ashlar, PART.wall, mulc(wc, 0.9), o);
        k.lathe(x0, zf - Tw / 2, [[0.1, H + 1.3], [0.42, H + 1.55], [0.46, H + 1.62], [0.38, H + 1.64]], lod === 0 ? 8 : 6, SURF.iron, PART.prop, IRON, 0.8, 1);
        em.push({ p: [x0, H + 1.7, zf - Tw / 2], kind: EMIT.brazier, size: 0.45 });
      }
      if (lod === 0) {
        const spikes = (x0: number, z0: number, x1: number, z1: number) => {
          const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(len / 0.85));
          for (let i = 0; i <= n; i++) { const t = i / n; k.cylinder(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, H, H + 0.55, 0.055, 0.0, 4, SURF.iron, PART.trim, IRON); }
        };
        const m = Tw / 2;
        spikes(-hx + m, zb + m, hx - m, zb + m);
        spikes(-hx + m, zb + m, -hx + m, zf - m);
        spikes(hx - m, zb + m, hx - m, zf - m);
        spikes(-hx + m, zf - m, -gw / 2 - 1.2, zf - m);
        spikes(gw / 2 + 1.2, zf - m, hx - m, zf - m);
      }
      // banners flank the gate and the altar; horned skulls on poles stand in the corners
      bannerPole(k, -gw / 2 - 1.6, zf + 0.6, 4.2, T.cloth, T, lod);
      bannerPole(k, gw / 2 + 1.6, zf + 0.6, 4.2, spec.style & 1 ? [0.3, 0.02, 0.015] : [0.02, 0.018, 0.018], T, lod);
      for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
        if (lod > 0 && sz < 0) continue;
        skullTotem(k, sx * (hx - 1.1), sz > 0 ? zf - 1.2 : zb + 1.2, 3.0, T, rng, lod);
      }
    } else {
      for (let i = 0; i < (lod === 0 ? 6 : 3); i++) {
        const a = (i / (lod === 0 ? 6 : 3)) * Math.PI * 2 + 0.3;
        skullTotem(k, Math.cos(a) * (f.hw + 1.6), Math.sin(a) * (f.hw + 1.6), 3.0, T, rng, lod);
      }
    }
    if (walled) altarStone(k, 0, zA, 1.1, 0.6, T, rng, lod);
    brazierStand(k, -2.3, zA, 1.3, em, lod);
    brazierStand(k, 2.3, zA, 1.3, em, lod);
    return;
  }
  if (!walled) {
    // a stone circle: offerings and flowers at the stones' feet (benevolent), or nothing more
    if (T.kind && lod === 0) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      flowerBed(k, Math.cos(a) * (f.hw - 1.8) - 0.5, Math.sin(a) * (f.hw - 1.8) - 0.4, Math.cos(a) * (f.hw - 1.8) + 0.5, Math.sin(a) * (f.hw - 1.8) + 0.4, mulc(T.stone, 0.8), rng, lod);
    }
    return;
  }
  // an open approach: a paved walk to the steps, an altar before them
  const zEnd = zA + 3.4;
  const pave = mulc(T.stone, 0.95);
  k.box(-1.4, -0.4, f.front - 0.2, 1.4, 0.08, zEnd, SURF.ashlar, PART.trim, pave, { skip: ['bottom'], aoLow: 0.8 });
  altarStone(k, 0, zA, 0.9, 0.5, T, rng, lod);
  if (!T.kind) {
    brazierStand(k, -2.0, f.front + 0.9, 1.25, em, lod);
    brazierStand(k, 2.0, f.front + 0.9, 1.25, em, lod);
    return;
  }
  // benevolent: lanterns line the walk, gardens flank the temple, banners of the people's colour at the steps
  for (let i = 0; i < 3; i++) {
    const z = f.front + 0.9 + i * ((zEnd - f.front - 1.2) / 2);
    lanternPost(k, -1.9, z, 1.6, T, lod);
    lanternPost(k, 1.9, z, 1.6, T, lod);
  }
  const kerb = mulc(T.stone, 0.85);
  for (const sx of [-1, 1]) {
    flowerBed(k, sx > 0 ? 2.6 : -5.2, f.front + 0.6, sx > 0 ? 5.2 : -2.6, zEnd - 0.4, kerb, rng, lod);
    // a hedge along the temple's flank and shrubs at its corners
    const xh = sx * (f.hw + 1.2);
    hedge(k, xh, f.back + 0.5, f.front - 0.6, 0.5, 1.0, mulc(LEAF, 0.9), rng, lod);
    shrub(k, xh, f.front + 0.4, 0.9, 1.6, mulc(LEAF, 1.1), lod);
    shrub(k, xh, f.back - 0.2, 0.8, 1.4, LEAF, lod);
    if (lod === 0) bannerPole(k, sx * 2.6, f.front + 0.2, 4.0, T.cloth, T, lod);
  }
  em.push({ p: [0, 1.3, zA], kind: EMIT.brazier, size: 0.2 });
}

/** stone circle (before the bronze age): trilithons round an altar stone */
function henge(k: KitBuilder, spec: BuildingSpec, T: TempleLook, rng: Rng, em: Emitter[]): TempleFrame {
  const R = Math.min(spec.w, spec.d) * 0.45;
  const n = spec.lod === 0 ? 12 : 8;
  const sc = T.fear ? mulc(BASALT, 1.6) : T.stone;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = 3.2 + rng.float() * 0.8;
    k.push(Math.cos(a) * R, 0, Math.sin(a) * R, -a + Math.PI / 2);
    k.box(-0.55, -0.5, -0.3, 0.55, h, 0.3, SURF.rubble, PART.wall, mulc(sc, 0.9 + rng.float() * 0.2), { skip: ['bottom'], aoLow: 0.6 });
    // lintels on every other pair
    if (i % 2 === 0) {
      const a2 = ((i + 1) / n) * Math.PI * 2;
      const dx = Math.cos(a2) * R - Math.cos(a) * R, dz = Math.sin(a2) * R - Math.sin(a) * R;
      const L2 = Math.hypot(dx, dz);
      k.pop();
      k.push(Math.cos(a) * R + dx / 2, 0, Math.sin(a) * R + dz / 2, -Math.atan2(dz, dx));
      k.box(-L2 / 2 - 0.5, h, -0.32, L2 / 2 + 0.5, h + 0.55, 0.32, SURF.rubble, PART.roof, sc, {});
    }
    k.pop();
  }
  altarStone(k, 0, 0, 0.9, 0.55, T, rng, spec.lod);
  brazierStand(k, 0, 1.7, 1.0, em, spec.lod);
  return { top: 4.6, hw: R + 0.6, back: -R - 0.6, front: R + 0.6 };
}

/** terraced mudbrick ziggurat: battered tiers with buttress rhythm, a walled stair, a shrine on the summit */
function ziggurat(k: KitBuilder, spec: BuildingSpec, T: TempleLook, L: Look, rng: Rng, em: Emitter[]): TempleFrame {
  const lod = spec.lod;
  const S = Math.min(spec.w, spec.d) * 1.15;
  const col = T.earth;
  const batter = 0.16, terrace = 1.25, sw = 3.0;
  let y = -1.5, b = S / 2, tTop = b;
  for (let i = 0; i < 3; i++) {
    const h = i === 0 ? 4.4 : 3.1;
    const t = b - h * batter;
    const c = mulc(col, 1 - i * 0.035);
    frustum(k, b, t, y, y + h, SURF.mudbrick, PART.wall, c, mulc(c, 0.9));
    if (lod === 0) {
      // buttresses: the recessed-niche rhythm of a mudbrick face
      const n = Math.max(3, Math.floor((2 * b) / 2.1));
      for (let q = 0; q < 4; q++) {
        k.push(0, 0, 0, (q * Math.PI) / 2);
        for (let j = 0; j <= n; j++) {
          const x = -b + 0.6 + (j * (2 * b - 1.2)) / n;
          if (q === 0 && Math.abs(x) < sw / 2 + 0.7) continue;
          k.beam([x, y + 0.05, b + 0.08], [x * (t / b), y + h - 0.05, t + 0.08], 0.2, 0.72, SURF.mudbrick, PART.wall, mulc(c, 1.07), 0.95);
        }
        // a coping course along the terrace edge; spikes on it (fearful) or a planted edge (benevolent)
        k.beam([-t, y + h + 0.1, t - 0.2], [t, y + h + 0.1, t - 0.2], 0.45, 0.26, SURF.mudbrick, PART.trim, mulc(c, 0.85), 0.9);
        if (T.fear) for (let x = -t + 0.5; x <= t - 0.5; x += 1.25) { if (!(q === 0 && Math.abs(x) < sw / 2 + 0.3)) k.cylinder(x, t - 0.2, y + h + 0.2, y + h + 0.85, 0.055, 0.0, 4, SURF.iron, PART.trim, IRON); }
        if (T.kind && i < 2) for (let x = -t + 0.9; x <= t - 0.9; x += 1.7) { if (!(q === 0 && Math.abs(x) < sw / 2 + 0.5)) shrub(k, x, t - 0.75, 0.42, 0.75, mulc(LEAF, 0.8 + rng.float() * 0.5), lod); }
        k.pop();
      }
    }
    y += h; tTop = t; b = t - terrace;
  }
  // the stair: from the ground in front straight up to the summit, between sloping side walls
  const yTop = y, zTop = tTop - 0.3, run = yTop * 1.15, z0 = zTop + run;
  const sc = mulc(col, 0.93);
  if (lod === 0) {
    const n = Math.ceil(yTop / 0.4);
    for (let i = 0; i < n; i++) {
      const yi = ((i + 1) * yTop) / n, zi = z0 - (i * run) / n;
      k.box(-sw / 2, -1, zTop - 1.2, sw / 2, yi, zi, SURF.mudbrick, PART.wall, sc, { skip: ['bottom', 'nz'], aoLow: 0.75 });
    }
  } else k.slab([-sw / 2, 0.05, z0], [sw / 2, 0.05, z0], [sw / 2, yTop, zTop], [-sw / 2, yTop, zTop], 1.2, SURF.mudbrick, PART.wall, sc, SURF.mudbrick, mulc(sc, 0.75));
  for (const sx of [-1, 1]) k.beam([sx * (sw / 2 + 0.3), 0.25, z0 + 0.3], [sx * (sw / 2 + 0.3), yTop + 0.5, zTop - 0.2], 0.6, 1.4, SURF.mudbrick, PART.wall, mulc(col, 1.04), 0.9);
  // the summit shrine: a walled room with a portico of posts, a flat roof with a parapet
  const hs = tTop - 0.75;
  const sl: WallLook = {
    ...L.wall, surf: SURF.plaster, col: T.fear ? mixc(BASALT, [0.22, 0.04, 0.03], 0.25) : T.kind ? WHITEWASH : mixc(col, WHITEWASH, 0.35),
    shutters: null, mullions: false, frameCol: T.timber, doorCol: T.fear ? [0.045, 0.034, 0.026] : T.timber, lod,
  };
  const sd = hs * 1.5;
  k.push(0, 0, -0.4);
  boxWalls(k, { W: hs * 2, D: sd, H: 2.9, T: 0.4, y0: yTop, front: [{ x0: hs - 0.7, x1: hs + 0.7, y0: 0, y1: 2.2, kind: 'door' }], back: [], left: [], right: [] }, sl, rng);
  const yr = yTop + 2.9;
  k.box(-hs - 0.25, yr, -sd / 2 - 0.25, hs + 0.25, yr + 0.3, sd / 2 + 1.6, SURF.planks, PART.roof, mulc(T.timber, 1.2), { aoLow: 0.6 });
  {
    const x0 = -hs - 0.25, x1 = hs + 0.25, z0 = -sd / 2 - 0.25, z1 = sd / 2 + 1.6, ya = yr + 0.3, yb = yr + 0.75, w = 0.25;
    const o = { skip: ['bottom'] };
    k.box(x0, ya, z0, x1, yb, z0 + w, sl.surf, PART.roof, sl.col, o);
    k.box(x0, ya, z1 - w, x1, yb, z1, sl.surf, PART.roof, sl.col, o);
    k.box(x0, ya, z0 + w, x0 + w, yb, z1 - w, sl.surf, PART.roof, sl.col, o);
    k.box(x1 - w, ya, z0 + w, x1, yb, z1 - w, sl.surf, PART.roof, sl.col, o);
  }
  k.quad([-hs, yr + 0.3, sd / 2 + 1.35], [hs, yr + 0.3, sd / 2 + 1.35], [hs, yr + 0.3, -sd / 2], [-hs, yr + 0.3, -sd / 2], SURF.earth, PART.roof, mulc(sl.col, 0.5), 0.6);
  for (const sx of [-1, 1]) k.cylinder(sx * (hs - 0.2), sd / 2 + 1.35, yTop, yr, 0.2, 0.17, 8, T.timberSurf, PART.wall, T.timber, {});
  // horns of consecration (kind / neutral) or iron spikes (fearful) on the parapet's corners
  if (lod === 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hs + 0.05), z = sz > 0 ? sd / 2 + 1.4 : -sd / 2 - 0.05;
    if (T.fear) k.cylinder(x, z, yr + 0.75, yr + 1.7, 0.08, 0.0, 4, SURF.iron, PART.roof, IRON);
    else k.lathe(x, z, [[0.18, yr + 0.75], [0.12, yr + 1.0], [0.03, yr + 1.25]], 6, SURF.metal, PART.roof, T.metal, 1, 1);
  }
  k.pop();
  brazierStand(k, -sw / 2 - 0.9, zTop + 0.6, yTop + 1.1, em, lod);
  brazierStand(k, sw / 2 + 0.9, zTop + 0.6, yTop + 1.1, em, lod);
  return { top: yr + 1.7, hw: S / 2 + 0.3, back: -S / 2 - 0.3, front: z0 + 0.4 };
}

/**
 * One side of a swept (concave, upturned) roof, repeated round four sides: from the eave square (half-size e, height
 * ey) to the top square (half-size t, height ty). Shallow at the eave and steep near the top; the corners turn up by
 * `lift`. Tiles on top, boarded soffit below, a fascia along the eave.
 */
function sweptRoof(k: KitBuilder, e: number, t: number, ey: number, ty: number, lift: number, thick: number, nu: number, nv: number,
  surf: number, col: RGB, underSurf: number, under: RGB, hips: RGB | null): void {
  const P = (u: number, v: number, dn: number): V3 => {
    const half = e + (t - e) * v;
    const corner = lift * Math.pow(Math.abs(u), 3) * (1 - v) * (1 - v);
    return [u * half, ey + (ty - ey) * Math.pow(v, 1.8) + corner - dn, half];
  };
  for (let q = 0; q < 4; q++) {
    k.push(0, 0, 0, (q * Math.PI) / 2);
    for (let j = 0; j < nv; j++) {
      const v0 = j / nv, v1 = (j + 1) / nv;
      for (let i = 0; i < nu; i++) {
        const u0 = -1 + (2 * i) / nu, u1 = -1 + (2 * (i + 1)) / nu;
        k.quad(P(u0, v0, 0), P(u1, v0, 0), P(u1, v1, 0), P(u0, v1, 0), surf, PART.roof, col, j === 0 ? 0.92 : 1);
        k.quad(P(u1, v0, thick), P(u0, v0, thick), P(u0, v1, thick), P(u1, v1, thick), underSurf, PART.roof, under, 0.45);
      }
    }
    for (let i = 0; i < nu; i++) {
      const u0 = -1 + (2 * i) / nu, u1 = -1 + (2 * (i + 1)) / nu;
      k.quad(P(u0, 0, thick), P(u1, 0, thick), P(u1, 0, 0), P(u0, 0, 0), underSurf, PART.roof, under, 0.8);
    }
    if (hips) {
      // a hip ridge down the corner curve, ending in an upturned tip
      const n = 2;
      for (let j = 0; j < n; j++) {
        const a = P(1, j / n, -0.08), b = P(1, (j + 1) / n, -0.08);
        k.beam(a, b, 0.2, 0.16, surf, PART.roof, hips, 0.9);
      }
      const tip = P(1, 0, -0.08);
      k.beam(tip, [tip[0] + 0.32, tip[1] + 0.42, tip[2] + 0.32], 0.14, 0.12, surf, PART.roof, hips, 0.9);
    }
    k.pop();
  }
}

/** tiered timber pagoda on a stone platform: lattice-walled storeys, bracket sets, swept eaves, a ringed finial */
function pagoda(k: KitBuilder, spec: BuildingSpec, T: TempleLook, L: Look, rng: Rng, em: Emitter[]): TempleFrame {
  const lod = spec.lod;
  const S = Math.min(spec.w, spec.d) * 0.8;
  const P = S + 4;
  k.box(-P / 2, -3, -P / 2, P / 2, 0.55, P / 2, SURF.ashlar, PART.plinth, mulc(T.stone, 0.92), { skip: ['bottom'], aoLow: 0.6 });
  k.box(-P / 2 + 0.9, 0.55, -P / 2 + 0.9, P / 2 - 0.9, 1.0, P / 2 - 0.9, SURF.ashlar, PART.plinth, T.stone, { skip: ['bottom'] });
  for (let i = 0; i < 3; i++) k.box(-1.7, -1, P / 2 - 0.2, 1.7, 0.34 * (i + 1), P / 2 + 0.42 * (3 - i), SURF.ashlar, PART.plinth, mulc(T.stone, 0.96), { skip: ['bottom'], aoLow: 0.7 });
  const tiers = spec.style & 2 ? 5 : 3;
  // (benevolent: ochre plaster, white only on the lattice trims; fearful: soot-dark plaster, not a black void)
  const wallCol: RGB = T.fear ? [0.17, 0.145, 0.12] : T.kind ? OCHRE : [0.58, 0.52, 0.42];
  const shingle = (spec.style & 1) === 1;
  const roofCol: RGB = T.fear ? [0.1, 0.094, 0.086] : shingle ? [0.11, 0.08, 0.055] : [0.07, 0.075, 0.08];
  const roofSurf = shingle ? SURF.shingle : SURF.tiles;
  const under: RGB = T.fear ? [0.075, 0.062, 0.052] : T.kind ? mulc(LACQUER, 0.8) : mulc(WOOD, 0.8);
  const nu = lod === 0 ? 6 : 3, nv = lod === 0 ? 4 : 2;
  let y = 1.0, s = S;
  for (let i = 0; i < tiers; i++) {
    const h = i === 0 ? 3.4 : 2.3;
    const look: WallLook = { ...L.wall, surf: SURF.plaster, col: wallCol, shutters: null, frameCol: T.kind ? WHITEWASH : T.timber, doorCol: T.timber, mullions: true, lod };
    const lattice = (len: number) => windowRow(len, i === 0 ? 0.9 : 0.55, [0.85, i === 0 ? 1.4 : 1.1], 2.3, 0.8, null);
    // the ground storey has windows all round; the upper ones look out front and back only
    boxWalls(k, {
      W: s, D: s, H: h, T: 0.25, y0: y,
      front: i === 0 ? [{ x0: s / 2 - 0.9, x1: s / 2 + 0.9, y0: 0, y1: 2.6, kind: 'door' }] : lattice(s),
      back: lattice(s), left: i === 0 ? lattice(s - 0.5) : [], right: i === 0 ? lattice(s - 0.5) : [],
    }, look, rng);
    // posts proud of the walls at the corners and between, a tie beam round the top
    const posts = lod === 0 ? 4 : 2;
    for (let q = 0; q < 4; q++) {
      k.push(0, 0, 0, (q * Math.PI) / 2);
      for (let j = 0; j < posts - 1; j++) {
        // (each corner post once: the next side's first post)
        const x = -s / 2 + (j * s) / (posts - 1);
        k.box(x - 0.16, y - 0.05, s / 2 - 0.12, x + 0.16, y + h, s / 2 + 0.12, T.timberSurf, PART.frame, T.timber, { skip: ['bottom'] });
      }
      k.box(-s / 2 - 0.12, y + h - 0.3, s / 2 - 0.05, s / 2 + 0.12, y + h, s / 2 + 0.16, T.timberSurf, PART.frame, T.timber, {});
      // bracket sets: stepped blocks carrying the eave out from the wall
      if (lod === 0) {
        const nb = Math.max(2, Math.round(s / 1.8));
        for (let j = 1; j < nb; j++) {
          const x = -s / 2 + (j * s) / nb;
          k.box(x - 0.13, y + h - 0.02, s / 2 + 0.1, x + 0.13, y + h + 0.18, s / 2 + 0.4, T.timberSurf, PART.trim, T.timber, { skip: ['nz'] });
          k.box(x - 0.22, y + h + 0.18, s / 2 + 0.1, x + 0.22, y + h + 0.36, s / 2 + 0.74, T.timberSurf, PART.trim, mulc(T.timber, 1.15), { skip: ['nz', 'top'] });
        }
      }
      k.pop();
    }
    y += h;
    const last = i === tiers - 1;
    const sNext = s * 0.76;
    const e = s / 2 + 1.55 + 0.12 * (tiers - i);
    const t = last ? 0.3 : sNext / 2;
    const ey = y + 0.12, ty = y + (last ? 2.4 : 1.1);
    sweptRoof(k, e, t, ey, ty, 0.62, 0.22, nu, nv, roofSurf, roofCol, SURF.planks, under, lod === 0 ? mulc(roofCol, 0.75) : null);
    if (T.fear && lod === 0) for (let q = 0; q < 4; q++) {
      // iron spikes along the eaves
      k.push(0, 0, 0, (q * Math.PI) / 2);
      for (let x = -e + 0.6; x <= e - 0.6; x += 1.1) k.cylinder(x, e - 0.05, ey + 0.05, ey + 0.55, 0.045, 0.0, 4, SURF.iron, PART.roof, IRON);
      k.pop();
    }
    if (T.kind && lod === 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // bells / lanterns hang from the eave corners
      const x = sx * (e - 0.15), z = sz * (e - 0.15);
      k.beam([x, ey + 0.55, z], [x, ey - 0.2, z], 0.03, 0.03, SURF.rope, PART.prop, [0.1, 0.08, 0.05]);
      paperLantern(k, x, ey - 0.62, z, 0.9, T, lod);
    }
    s = sNext;
    y = ty - 0.06;
    if (last) y = ty;
  }
  // the finial: a lotus base, nine rings, a jewel
  const fm = T.metal;
  k.lathe(0, 0, [[0.55, y - 0.1], [0.42, y + 0.2], [0.18, y + 0.4]], lod === 0 ? 10 : 6, SURF.metal, PART.roof, fm, 0.9, 1);
  k.cylinder(0, 0, y + 0.3, y + 3.6, 0.09, 0.06, 6, SURF.metal, PART.roof, fm, {});
  if (lod === 0) for (let r = 0; r < 7; r++) {
    const ry = y + 0.8 + r * 0.32, rr = 0.42 - r * 0.035;
    k.lathe(0, 0, [[0.07, ry - 0.05], [rr, ry], [rr, ry + 0.06], [0.07, ry + 0.11]], 10, SURF.metal, PART.roof, fm, 0.9, 1);
  }
  k.lathe(0, 0, [[0.06, y + 3.6], [0.2, y + 3.8], [0.02, y + 4.15]], 8, SURF.metal, PART.roof, fm, 1, 1);
  return { top: y + 4.15, hw: P / 2, back: -P / 2, front: P / 2 + 1.3 };
}

/** a great timber hall on a stone platform: plank cella, a peristyle of posts, a steep roof with crossed gable horns */
function templeHall(k: KitBuilder, spec: BuildingSpec, T: TempleLook, L: Look, rng: Rng, em: Emitter[]): TempleFrame {
  const lod = spec.lod;
  const W = spec.w * 0.85, D = spec.d * 0.85;
  const ph = 1.1;
  // a platform of field stone (darker than dressed masonry: it is the hall's footing, not a monument)
  k.box(-W / 2 - 1.1, -3, -D / 2 - 1.1, W / 2 + 1.1, ph, D / 2 + 1.1, SURF.rubble, PART.plinth, mulc(T.stone, 0.5), { skip: ['bottom'], aoLow: 0.6 });
  for (let i = 0; i < 3; i++) k.box(-1.8, -1, D / 2 + 1.0, 1.8, (ph / 3) * (i + 1), D / 2 + 1.1 + 0.45 * (3 - i), SURF.rubble, PART.plinth, mulc(T.stone, 0.54), { skip: ['bottom'], aoLow: 0.7 });
  const cw = W - 3.0, cd = D - 3.4, H = 4.2;
  const wood: RGB = T.fear ? [0.075, 0.062, 0.05] : T.kind ? mixc(WOOD, [0.5, 0.34, 0.18], 0.35) : WOOD;
  const look: WallLook = { ...L.wall, surf: SURF.logs, col: wood, shutters: null, mullions: false, frameCol: T.timber, doorCol: T.fear ? [0.045, 0.034, 0.026] : T.timber, lod };
  boxWalls(k, {
    W: cw, D: cd, H, T: 0.3, y0: ph,
    front: [{ x0: cw / 2 - 1.1, x1: cw / 2 + 1.1, y0: 0, y1: 3.1, kind: 'door' }],
    back: [], left: windowRow(cd - 0.6, 2.4, [0.5, 0.6], 3.2, 1.2, null), right: windowRow(cd - 0.6, 2.4, [0.5, 0.6], 3.2, 1.2, null),
  }, look, rng);
  // the peristyle: posts all round under the eaves, a wall plate on them
  const yP = ph + H + 0.25;
  const nx = lod === 0 ? 5 : 3, nz = lod === 0 ? 7 : 4;
  const post = (x: number, z: number) => {
    k.cylinder(x, z, ph - 0.05, ph + 0.25, 0.32, 0.3, 8, SURF.ashlar, PART.trim, mulc(T.stone, 1.05), { top: true });
    k.cylinder(x, z, ph + 0.25, yP, 0.2, 0.18, lod === 0 ? 8 : 6, T.timberSurf, PART.wall, T.timber, {});
  };
  const px = W / 2 - 0.3, pz = D / 2 - 0.3;
  for (let i = 0; i < nx; i++) { const x = -px + (i * 2 * px) / (nx - 1); post(x, pz); post(x, -pz); }
  for (let j = 1; j < nz - 1; j++) { const z = -pz + (j * 2 * pz) / (nz - 1); post(-px, z); post(px, z); }
  k.box(-px - 0.2, yP, -pz - 0.2, px + 0.2, yP + 0.35, pz + 0.2, T.timberSurf, PART.trim, T.timber, { skip: ['bottom'] });
  // the steep roof along the hall
  const thatch = L.roofKind === 'thatch';
  const rf: RoofLook = {
    // (a shingle roof of thick split shakes in visible courses: thick enough to read from afar)
    ...L.roof, surf: thatch ? SURF.thatch : SURF.shingle, col: T.fear ? [0.062, 0.054, 0.046] : thatch ? L.roof.col : SHINGLE,
    thick: thatch ? 0.42 : 0.32, under: WOOD_DARK, underSurf: SURF.planks, cap: thatch ? mulc(THATCH, 0.65) : mulc(SHINGLE, 0.8), capSurf: thatch ? SURF.thatch : SURF.shingle,
  };
  const pitch = 0.92;
  k.push(0, 0, 0, Math.PI / 2);
  const yR = gableRoof(k, D - 0.2, W - 0.2, 0.3, yP + 0.35, pitch, 0.7, rf, { surf: SURF.planks, col: mulc(wood, 0.9) }, lod, T.fear);
  k.pop();
  // crossed horns over each gable (carved bargeboards running past the ridge), skulls on them where the people fear
  const slope = Math.tan(pitch);
  for (const sz of [-1, 1]) {
    const zg = sz * (D / 2 + 0.55);
    for (const sx of [-1, 1]) {
      const a: V3 = [-sx * W * 0.22, yR - W * 0.22 * slope, zg], b: V3 = [sx * 1.25, yR + 1.25 * slope, zg];
      k.beam(a, b, 0.2, 0.32, T.timberSurf, PART.roof, T.timber, 0.9);
    }
    if (T.fear) hornedSkull(k, 0, yR + 0.1, zg + sz * 0.2, 1.3, lod);
    else if (lod === 0) k.lathe(0, zg, [[0.12, yR + 0.1], [0.2, yR + 0.35], [0.03, yR + 0.8]], 6, SURF.metal, PART.roof, T.metal, 1, 1);
  }
  em.push({ p: [0, ph + 0.4, D / 2 - 0.2], kind: EMIT.hearth, size: 0.4 });
  return { top: yR + 1.25 * slope + 0.3, hw: W / 2 + 1.1, back: -D / 2 - 1.1, front: D / 2 + 2.5 };
}

/** colonnaded temple: a stepped podium, a cella inside a ring of columns, entablature and pediment */
function colonnade(k: KitBuilder, spec: BuildingSpec, T: TempleLook, L: Look, rng: Rng, em: Emitter[]): TempleFrame {
  const W = spec.w, D = spec.d;
  const podium = 1.4, colH = 6.2;
  const sc = T.stone;
  for (let i = 0; i < 3; i++) {
    const e = (2 - i) * 0.45;
    k.box(-W / 2 - e, -3, -D / 2 - e, W / 2 + e, (podium / 3) * (i + 1), D / 2 + e, SURF.ashlar, PART.plinth, sc, { skip: ['bottom'], aoLow: 0.6 });
  }
  // a stair up the front of the podium
  for (let i = 0; i < 4; i++) k.box(-2.4, -1, D / 2 + 0.85, 2.4, (podium / 4) * (i + 1), D / 2 + 0.9 + 0.42 * (4 - i), SURF.ashlar, PART.plinth, mulc(sc, 0.97), { skip: ['bottom'], aoLow: 0.7 });
  // cella walls inside the colonnade
  const cw = W - 3.2, cd = D - 4.5;
  const cellaLook: WallLook = { ...L.wall, surf: SURF.ashlar, col: mulc(sc, 0.95), doorCol: T.fear ? [0.045, 0.034, 0.026] : L.wall.doorCol };
  boxWalls(k, { W: cw, D: cd, H: colH, T: 0.6, y0: podium, front: [{ x0: cw / 2 - 1.1, x1: cw / 2 + 1.1, y0: 0, y1: 4.2, kind: 'door' }], back: [], left: [], right: [] }, cellaLook, rng);
  // columns all round (shafts with entasis at LOD 0)
  const nx = spec.lod === 0 ? 6 : 4, nz = spec.lod === 0 ? 8 : 5;
  const colAt = (x: number, z: number) => {
    k.cylinder(x, z, podium, podium + 0.25, 0.55, 0.55, 8, SURF.ashlar, PART.trim, sc, { top: true });
    if (spec.lod === 0) k.lathe(x, z, [[0.46, podium + 0.25], [0.47, podium + colH * 0.35], [0.41, podium + colH - 0.5], [0.38, podium + colH - 0.35]], 14, SURF.ashlar, PART.wall, sc, 0.85, 1);
    else k.cylinder(x, z, podium + 0.25, podium + colH - 0.35, 0.45, 0.38, 7, SURF.ashlar, PART.wall, sc, {});
    k.lathe(x, z, [[0.38, podium + colH - 0.35], [0.56, podium + colH - 0.12]], 8, SURF.ashlar, PART.trim, sc, 1, 1);
    k.box(x - 0.6, podium + colH - 0.12, z - 0.6, x + 0.6, podium + colH, z + 0.6, SURF.ashlar, PART.trim, sc, {});
  };
  for (let i = 0; i < nx; i++) { const x = -W / 2 + 0.8 + (i * (W - 1.6)) / (nx - 1); colAt(x, D / 2 - 0.8); colAt(x, -D / 2 + 0.8); }
  for (let j = 1; j < nz - 1; j++) { const z = -D / 2 + 0.8 + (j * (D - 1.6)) / (nz - 1); colAt(-W / 2 + 0.8, z); colAt(W / 2 - 0.8, z); }
  // entablature and pediment roof
  const yE = podium + colH;
  k.box(-W / 2 + 0.2, yE, -D / 2 + 0.2, W / 2 - 0.2, yE + 1.0, D / 2 - 0.2, SURF.ashlar, PART.trim, mulc(sc, 1.05), { skip: ['bottom'] });
  const rf: RoofLook = { ...L.roof, surf: SURF.tiles, col: T.fear ? SLATE : TILE[spec.style & 3], cap: T.fear ? SLATE : TILE[0], capSurf: SURF.tiles };
  k.push(0, 0, 0, Math.PI / 2);
  const top = gableRoof(k, D - 0.2, W - 0.2, 0.4, yE + 1.0, 0.3, 0.35, rf, { surf: SURF.ashlar, col: sc }, spec.lod, T.fear);
  k.pop();
  if (!T.fear && spec.lod === 0) for (const sz of [-1, 1]) k.lathe(0, sz * (D / 2 + 0.05), [[0.5, top - 0.6], [0.05, top + 0.4]], 6, SURF.metal, PART.trim, T.metal, 1, 1);
  em.push({ p: [-1.8, podium + 0.2, D / 2 - 0.2], kind: EMIT.brazier, size: 0.3 });
  em.push({ p: [1.8, podium + 0.2, D / 2 - 0.2], kind: EMIT.brazier, size: 0.3 });
  return { top, hw: W / 2 + 0.9, back: -D / 2 - 0.9, front: D / 2 + 2.6 };
}

/**
 * Domed hall: walls arcaded with round-headed windows behind a crenellated parapet, a tall portal (a pointed arch
 * recessed in a framing block) on the front, a windowed drum under a ribbed dome (onion-swelled for some styles)
 * crowned by a lantern, small domes at the roof's corners and minarets with balconies at the corners of the court.
 * Fearful: dark basalt, iron-spiked parapet and minaret tips; benevolent: whitewash, gilded finials.
 */
function domed(k: KitBuilder, spec: BuildingSpec, T: TempleLook, L: Look, rng: Rng, em: Emitter[]): TempleFrame {
  const lod = spec.lod;
  const S = Math.min(spec.w, spec.d) * 1.05;
  const sc = T.stone;
  plinth(k, S + 0.4, S + 0.4, 0.6, SURF.ashlar, mulc(sc, 0.85));
  const H = 7;
  const wallCol: RGB = T.fear ? mulc(BASALT, 1.3) : T.kind ? WHITEWASH : [0.66, 0.62, 0.55];
  const look: WallLook = { ...L.wall, surf: T.fear ? SURF.ashlar : SURF.plaster, col: wallCol, shutters: null, mullions: false, frameCol: mulc(sc, 0.7), sillSurf: SURF.ashlar, sillCol: mulc(sc, 1.05), doorCol: T.fear ? [0.045, 0.034, 0.026] : [0.16, 0.08, 0.035], lod };
  const arches = (len: number, avoid: [number, number] | null): Opening[] => windowRow(len, 1.6, [1.1, 3.4], 2.6, 1.1, avoid).map((o) => ({ ...o, head: 'round' as const }));
  const pw = Math.min(3.4, S * 0.26);
  boxWalls(k, {
    W: S, D: S, H, T: 0.8, y0: 0.6,
    front: [{ x0: S / 2 - pw / 2, x1: S / 2 + pw / 2, y0: 0, y1: 5.6, kind: 'door', head: 'pointed', rise: pw * 0.8 }, ...arches(S, [S / 2 - pw / 2 - 1.4, S / 2 + pw / 2 + 1.4])],
    back: arches(S, null), left: arches(S - 1.6, null), right: arches(S - 1.6, null),
  }, look, rng);
  const y0 = 0.6 + H;
  // cornice and a crenellated parapet (merlons)
  k.box(-S / 2 - 0.2, y0, -S / 2 - 0.2, S / 2 + 0.2, y0 + 0.4, S / 2 + 0.2, SURF.ashlar, PART.trim, mulc(sc, 1.08), { skip: ['bottom'] });
  for (let q = 0; q < 4; q++) {
    k.push(0, 0, 0, (q * Math.PI) / 2);
    const n = Math.max(4, Math.round(S / 1.1));
    for (let i = 0; i < n; i++) {
      const x = -S / 2 + (i + 0.5) * (S / n);
      if (lod === 0 || i % 2 === 0) k.box(x - 0.28, y0 + 0.4, S / 2 - 0.15, x + 0.28, y0 + 1.15, S / 2 + 0.15, look.surf, PART.trim, wallCol, { skip: ['bottom'] });
      if (T.fear && lod === 0) k.cylinder(x, S / 2, y0 + 1.15, y0 + 1.75, 0.05, 0.0, 4, SURF.iron, PART.trim, IRON);
    }
    k.pop();
  }
  // the portal block (pishtaq): a frame standing proud of the front wall and above the parapet, round the portal
  {
    const fw = pw + 2.2, fh = H + 2.6, z = S / 2;
    k.box(-fw / 2, 0.6, z, -pw / 2, 0.6 + fh, z + 0.7, look.surf, PART.wall, mulc(wallCol, 1.02), { skip: ['bottom'] });
    k.box(pw / 2, 0.6, z, fw / 2, 0.6 + fh, z + 0.7, look.surf, PART.wall, mulc(wallCol, 1.02), { skip: ['bottom'] });
    k.box(-pw / 2, 0.6 + 6.2, z, pw / 2, 0.6 + fh, z + 0.7, look.surf, PART.wall, mulc(wallCol, 1.02), { skip: ['bottom'] });
    if (lod === 0) {
      archBand(k, -pw / 2 - 0.05, pw / 2 + 0.05, 0.6 + 5.6 - pw * 0.8, pw * 0.8 + 0.6, z + 0.72, 0.22, T.fear ? IRON : T.kind ? GOLD : mulc(sc, 1.1), 6);
      k.box(-fw / 2 - 0.1, 0.6 + fh, z - 0.1, fw / 2 + 0.1, 0.6 + fh + 0.3, z + 0.8, SURF.ashlar, PART.trim, mulc(sc, 1.1), {});
      // a band of tile work across its top
      k.quad([-fw / 2 + 0.3, 0.6 + fh - 1.4, z + 0.71], [fw / 2 - 0.3, 0.6 + fh - 1.4, z + 0.71], [fw / 2 - 0.3, 0.6 + fh - 0.5, z + 0.71], [-fw / 2 + 0.3, 0.6 + fh - 0.5, z + 0.71], SURF.tiles, PART.trim, T.fear ? [0.12, 0.02, 0.015] : [0.05, 0.2, 0.3], 0.95);
    }
  }
  // drum with arched windows, a ribbed dome, a lantern
  const R = S * 0.34;
  const drumH = 2.8;
  const ds = lod === 0 ? 20 : 12;
  k.cylinder(0, 0, y0 + 0.4, y0 + 0.4 + drumH, R, R, ds, look.surf, PART.wall, wallCol, {});
  if (lod === 0) for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.push(Math.sin(a) * (R + 0.01), 0, Math.cos(a) * (R + 0.01), a);
    k.quad([-0.3, y0 + 1.0, 0], [0.3, y0 + 1.0, 0], [0.3, y0 + 2.4, 0], [-0.3, y0 + 2.4, 0], SURF.glass, PART.glass, GLASS, 1, rng.float());
    k.lathe(0, 0, [[0.3, y0 + 2.4], [0.2, y0 + 2.62], [0.001, y0 + 2.7]], 6, SURF.glass, PART.glass, GLASS);
    k.pop();
  }
  k.box(-R - 0.15, y0 + 0.4 + drumH - 0.05, -R - 0.15, R + 0.15, y0 + 0.4 + drumH + 0.2, R + 0.15, SURF.ashlar, PART.trim, mulc(sc, 1.08), {});
  const onion = (spec.style & 2) !== 0;
  const domeCol: RGB = T.fear ? [0.075, 0.068, 0.062] : spec.style & 1 ? [0.1, 0.27, 0.3] : T.kind ? WHITEWASH : GOLD;
  const db = y0 + 0.6 + drumH;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // a hemisphere, or an onion: swelling past the drum and drawn up to a point
    const r = onion ? R * (1.0 + 0.22 * Math.sin(t * Math.PI * 1.15)) * Math.pow(Math.cos(t * Math.PI / 2), 0.75) : R * 1.02 * Math.cos((t * Math.PI) / 2);
    const y = db + (onion ? R * 1.45 : R * 1.02) * (onion ? Math.sin(t * Math.PI / 2) * (0.85 + 0.15 * t) : Math.sin((t * Math.PI) / 2));
    prof.push([Math.max(0.02, r), y]);
  }
  const domeSurf = domeCol === WHITEWASH ? SURF.plaster : spec.style & 1 ? SURF.tiles : SURF.metal;
  k.lathe(0, 0, prof, lod === 0 ? 28 : 14, domeSurf, PART.roof, domeCol, 0.85, 1);
  if (lod === 0) {
    // ribs down the dome
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pts: V3[] = prof.filter((_, j) => j % 2 === 0).map(([r, y]) => [Math.sin(a) * (r + 0.04), y, Math.cos(a) * (r + 0.04)]);
      k.tube(pts, pts.map(() => 0.06), 4, domeSurf, PART.roof, mulc(domeCol, domeCol === GOLD ? 1.15 : 0.85));
    }
  }
  const topY = prof[prof.length - 1][1];
  // the lantern: a little arcaded drum and cupola, a finial
  k.cylinder(0, 0, topY - 0.3, topY + 0.9, 0.55, 0.5, 8, look.surf, PART.wall, wallCol, {});
  k.lathe(0, 0, [[0.62, topY + 0.9], [0.5, topY + 1.3], [0.2, topY + 1.6], [0.02, topY + 1.7]], 8, domeSurf, PART.roof, domeCol, 0.9, 1);
  if (T.fear) k.cylinder(0, 0, topY + 1.6, topY + 3.0, 0.08, 0.0, 4, SURF.iron, PART.trim, IRON);
  else k.lathe(0, 0, [[0.08, topY + 1.65], [0.18, topY + 1.95], [0.06, topY + 2.25], [0.12, topY + 2.5], [0.01, topY + 3.0]], 8, SURF.metal, PART.trim, T.metal, 1, 1);
  // small corner domes on the roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (S / 2 - 1.6), z = sz * (S / 2 - 1.6);
    k.cylinder(x, z, y0 + 0.4, y0 + 1.5, 0.95, 0.95, lod === 0 ? 10 : 6, look.surf, PART.wall, wallCol, {});
    const sp: [number, number][] = [];
    for (let i = 0; i <= 5; i++) { const t = (i / 5) * Math.PI / 2; sp.push([0.02 + 1.0 * Math.cos(t), y0 + 1.5 + 0.95 * Math.sin(t)]); }
    k.lathe(x, z, sp, lod === 0 ? 10 : 6, domeSurf, PART.roof, domeCol, 0.85, 1);
  }
  // minarets at the corners of the court: a shaft, a balcony on brackets, a slimmer upper stage, a cap
  const mH = y0 + R * 1.5 + 6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (lod > 0 && sz < 0) continue;
    const x = sx * (S / 2 + 1.6), z = sz * (S / 2 + 1.6);
    k.cylinder(x, z, -1, mH * 0.68, 0.75, 0.62, lod === 0 ? 10 : 6, look.surf, PART.wall, wallCol, {});
    k.cylinder(x, z, mH * 0.68, mH * 0.68 + 0.35, 0.62, 1.05, lod === 0 ? 10 : 6, SURF.ashlar, PART.trim, mulc(sc, 1.05), { bottom: true });
    k.cylinder(x, z, mH * 0.68 + 0.35, mH * 0.68 + 0.95, 1.05, 1.05, lod === 0 ? 10 : 6, SURF.ashlar, PART.trim, mulc(sc, 1.05), { top: true });
    k.cylinder(x, z, mH * 0.68 + 0.95, mH, 0.5, 0.45, lod === 0 ? 10 : 6, look.surf, PART.wall, wallCol, {});
    if (T.fear) k.cylinder(x, z, mH, mH + 2.6, 0.55, 0.0, 6, SURF.iron, PART.roof, IRON);
    else k.lathe(x, z, [[0.56, mH], [0.62, mH + 0.4], [0.38, mH + 1.2], [0.02, mH + 2.4]], 10, domeSurf, PART.roof, domeCol === WHITEWASH ? GOLD : domeCol, 0.9, 1);
  }
  em.push({ p: [-pw / 2 - 1.6, 0.9, S / 2 + 1.4], kind: EMIT.brazier, size: 0.35 });
  em.push({ p: [pw / 2 + 1.6, 0.9, S / 2 + 1.4], kind: EMIT.brazier, size: 0.35 });
  return { top: Math.max(topY + 3.0, mH + 2.6), hw: S / 2 + 2.4, back: -S / 2 - 2.4, front: S / 2 + 2.4 };
}

/** a lancet window or door (pointed head) of width w centred at cx, from y0 to the crown y1 */
function lancet(cx: number, w: number, y0: number, y1: number, kind: Opening['kind'] = 'window'): Opening {
  return { x0: cx - w / 2, x1: cx + w / 2, y0, y1, kind, head: 'pointed', rise: w * 0.95 };
}

/** lancets spaced along a wall of length L, skipping `skip` (wall-x ranges) */
function lancetRow(L: number, y0: number, w: number, h: number, spacing: number, margin: number, skip: [number, number][] = []): Opening[] {
  return windowRow(L, y0, [w, h], spacing, margin, null).filter((o) => !skip.some(([a, b]) => o.x1 > a && o.x0 < b)).map((o) => ({ ...o, head: 'pointed' as const, rise: w * 0.95 }));
}

/** a Gothic pinnacle: a square shaft, gablets, a pyramid spirelet and a finial (an iron spike where the people fear) */
function pinnacle(k: KitBuilder, x: number, z: number, y0: number, h: number, s: number, col: RGB, T: TempleLook, lod: number): void {
  const ys = y0 + h * 0.42;
  k.box(x - s / 2, y0, z - s / 2, x + s / 2, ys, z + s / 2, SURF.ashlar, PART.trim, col, { skip: ['bottom'], aoLow: 0.85 });
  if (lod === 0) k.box(x - s / 2 - 0.05, ys, z - s / 2 - 0.05, x + s / 2 + 0.05, ys + 0.12, z + s / 2 + 0.05, SURF.ashlar, PART.trim, mulc(col, 1.08), {});
  k.push(x, 0, z, Math.PI / 4);
  k.cylinder(0, 0, ys + 0.12, y0 + h, s * 0.72, 0.02, 4, SURF.ashlar, PART.roof, mulc(col, 0.95), {});
  k.pop();
  if (lod === 0) {
    // crockets: little knobs up the edges
    for (let i = 1; i <= 3; i++) {
      const t = i / 4, y = ys + 0.12 + (y0 + h - ys - 0.12) * t, r = s * 0.5 * (1 - t);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) k.box(x + dx * r - 0.05, y - 0.05, z + dz * r - 0.05, x + dx * r + 0.05, y + 0.06, z + dz * r + 0.05, SURF.ashlar, PART.trim, col, {});
    }
    if (T.fear) k.cylinder(x, z, y0 + h - 0.05, y0 + h + 0.6, 0.04, 0.0, 4, SURF.iron, PART.roof, IRON, {});
    else k.lathe(x, z, [[0.02, y0 + h - 0.05], [0.1, y0 + h + 0.08], [0.02, y0 + h + 0.22]], 6, T.kind ? SURF.metal : SURF.ashlar, PART.roof, T.kind ? T.metal : col, 1, 1);
  }
}

/**
 * A flying buttress in the plane z: a straight sloping top from the pier (xP, ytP) to the wall (xW, ytW) over a
 * quarter arch springing from the pier, `t` thick.
 */
function flyer(k: KitBuilder, xP: number, ytP: number, xW: number, ytW: number, z: number, t: number, col: RGB, n: number): void {
  const ybP = ytP - 2.3, ybW = ytW - 0.75;
  const top = (s: number): [number, number] => [xP + (xW - xP) * s, ytP + (ytW - ytP) * s];
  const bot = (s: number): [number, number] => { const ph = (s * Math.PI) / 2; return [xW + (xP - xW) * Math.cos(ph), ybP + (ybW - ybP) * Math.sin(ph)]; };
  const sgn = Math.sign(xW - xP) || 1;
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n;
    const [tx0, ty0] = top(s0), [tx1, ty1] = top(s1), [bx0, by0] = bot(s0), [bx1, by1] = bot(s1);
    // the two faces
    for (const [zz, f] of [[z + t / 2, 1], [z - t / 2, -1]] as const) {
      const a: V3 = [bx0, by0, zz], b: V3 = [bx1, by1, zz], c: V3 = [tx1, ty1, zz], d: V3 = [tx0, ty0, zz];
      if (f * sgn > 0) k.quad(a, b, c, d, SURF.ashlar, PART.wall, col, 0.85); else k.quad(b, a, d, c, SURF.ashlar, PART.wall, col, 0.85);
    }
    // top coping and the arch's soffit
    const tq: [V3, V3, V3, V3] = [[tx0, ty0, z + t / 2], [tx1, ty1, z + t / 2], [tx1, ty1, z - t / 2], [tx0, ty0, z - t / 2]];
    const bq: [V3, V3, V3, V3] = [[bx0, by0, z - t / 2], [bx1, by1, z - t / 2], [bx1, by1, z + t / 2], [bx0, by0, z + t / 2]];
    if (sgn > 0) { k.quad(tq[0], tq[1], tq[2], tq[3], SURF.ashlar, PART.wall, mulc(col, 1.05), 0.95); k.quad(bq[0], bq[1], bq[2], bq[3], SURF.ashlar, PART.wall, col, 0.55); }
    else { k.quad(tq[1], tq[0], tq[3], tq[2], SURF.ashlar, PART.wall, mulc(col, 1.05), 0.95); k.quad(bq[1], bq[0], bq[3], bq[2], SURF.ashlar, PART.wall, col, 0.55); }
  }
}

/** a rose window facing +Z on the plane z: a disc of glass, a moulded stone ring, spokes of tracery and a hub */
function roseWindow(k: KitBuilder, cx: number, cy: number, z: number, r: number, col: RGB, lod: number, seed: number): void {
  const n = lod === 0 ? 16 : 8;
  const c = k.vert(cx, cy, z, 0, 0, 1, SURF.glass, PART.glass, GLASS, 1, seed);
  const rim: number[] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; rim.push(k.vert(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, 0, 0, 1, SURF.glass, PART.glass, GLASS, 1, seed)); }
  for (let i = 0; i < n; i++) k.tri(c, rim[i], rim[i + 1]);
  const ring = lod === 0 ? 0.28 : 0.35;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    k.beam([cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z + 0.08], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z + 0.08], ring, 0.22, SURF.ashlar, PART.trim, mulc(col, 1.06), 0.9);
  }
  if (lod > 0) return;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.beam([cx + Math.cos(a) * r * 0.22, cy + Math.sin(a) * r * 0.22, z + 0.05], [cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95, z + 0.05], 0.08, 0.1, SURF.ashlar, PART.trim, col, 0.9);
    // the cusped inner ring
    const b = a + Math.PI / 12;
    k.beam([cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, z + 0.05], [cx + Math.cos(b + Math.PI / 12) * r * 0.6, cy + Math.sin(b + Math.PI / 12) * r * 0.6, z + 0.05], 0.07, 0.08, SURF.ashlar, PART.trim, col, 0.9);
  }
  k.box(cx - r * 0.17, cy - r * 0.17, z, cx + r * 0.17, cy + r * 0.17, z + 0.14, SURF.ashlar, PART.trim, col, { skip: ['nz'] });
}

/** an arch drawn as a band of beams along a pointed curve (archivolts, the outline of a gablet), in the plane z */
function archBand(k: KitBuilder, x0: number, x1: number, ys: number, h: number, z: number, w: number, col: RGB, n: number): void {
  const left = archHalf(x0, x1, ys, h, n);
  const right = left.map(([x, y]) => [x0 + x1 - x, y] as [number, number]).reverse();
  const pts = [[x0, ys - 0.01] as [number, number], ...left, ...right.slice(1)];
  for (let i = 0; i < pts.length - 1; i++) k.beam([pts[i][0], pts[i][1], z], [pts[i + 1][0], pts[i + 1][1], z], w, w * 0.9, SURF.ashlar, PART.trim, col, 0.88);
}

/**
 * Cathedral (Gothic): a cross plan — a tall nave with clerestory lancets over lean-to aisles, a transept with rose
 * windows in its gables, a polygonal apse of tall lancets — buttress piers along the aisles carrying flying buttresses to
 * the nave wall and crowned with pinnacles, and a west front of twin towers (belfries, spires on some) round a deep
 * portal of stepped arches under a rose window. Fearful peoples raise it in dark basalt with iron spikes; benevolent
 * ones in warm limestone with gilded finials.
 */
function cathedral(k: KitBuilder, spec: BuildingSpec, T: TempleLook, L: Look, rng: Rng, em: Emitter[]): TempleFrame {
  const lod = spec.lod;
  const W = Math.min(spec.w, spec.d), D = Math.max(spec.w, spec.d) * 1.15;
  const naveW = W * 0.5, aw = (W - naveW) / 2;
  const naveH = 12.5, aisleH = 6.4, ph = 0.6;
  const sc = T.fear ? mulc(BASALT, 1.6) : T.stone;
  const look: WallLook = {
    ...L.wall, surf: SURF.ashlar, col: sc, inner: INTERIOR, shutters: null, mullions: true, frameCol: mulc(sc, 0.75),
    sillSurf: SURF.ashlar, sillCol: mulc(sc, 1.05), doorCol: T.fear ? [0.045, 0.034, 0.026] : WOOD_DARK, lod,
  };
  const roofCol: RGB = T.fear ? [0.058, 0.054, 0.05] : spec.style & 1 ? [0.16, 0.24, 0.2] : SLATE;
  const roofSurf = spec.style & 1 && !T.fear ? SURF.metal : SURF.slate;
  const rf: RoofLook = { ...L.roof, surf: roofSurf, col: roofCol, cap: mulc(roofCol, 0.85), capSurf: roofSurf, thick: 0.25, under: WOOD_DARK, underSurf: SURF.planks };
  const zW = D / 2, zE = -D / 2;
  const transD = naveW * 1.05, zc = zE + transD / 2 + 1.2;
  const tw = aw + 1.4;
  const zA0 = zc + transD / 2, zA1 = zW - tw + 0.6;
  const aisleLen = zA1 - zA0;
  // footing under nave and aisles
  k.box(-W / 2 - 0.3, -4, zE - 0.3, W / 2 + 0.3, ph, zW + 0.3, SURF.ashlar, PART.plinth, mulc(sc, 0.82), { skip: ['bottom'], aoLow: 0.5 });
  // aisles: outer walls with lancets, lean-to roofs against the nave
  const bay = aisleLen / Math.max(2, Math.round(aisleLen / 3.6));
  const nb = Math.round(aisleLen / bay);
  const aisleOps = (): Opening[] => {
    const out: Opening[] = [];
    for (let i = 0; i < nb; i++) out.push(lancet((i + 0.5) * bay, 1.05, 1.6, aisleH - 0.7));
    return out;
  };
  k.push(W / 2, ph, zA1, Math.PI / 2); wallPanel(k, aisleLen, aisleH, 0.7, aisleOps(), look, rng); k.pop();
  k.push(-W / 2, ph, zA0, -Math.PI / 2); wallPanel(k, aisleLen, aisleH, 0.7, aisleOps(), look, rng); k.pop();
  for (const sx of [-1, 1]) {
    const xo = sx * (W / 2 + 0.35), xi = sx * naveW / 2;
    const a: V3 = [xo, ph + aisleH, zA1], b: V3 = [xo, ph + aisleH, zA0], c: V3 = [xi, ph + aisleH + 2.0, zA0], d: V3 = [xi, ph + aisleH + 2.0, zA1];
    if (sx > 0) k.slab(a, b, c, d, 0.2, rf.surf, PART.roof, roofCol, SURF.planks, WOOD_DARK); else k.slab(b, a, d, c, 0.2, rf.surf, PART.roof, roofCol, SURF.planks, WOOD_DARK);
    // a parapet along the aisle eave
    k.box(Math.min(xo, sx * (W / 2 - 0.1)), ph + aisleH - 0.1, zA0, Math.max(xo, sx * (W / 2 - 0.1)), ph + aisleH + 0.55, zA1, SURF.ashlar, PART.trim, mulc(sc, 1.04), { skip: ['bottom'] });
  }
  // nave: tall walls with clerestory lancets above the aisle roofs, the west wall with the portal
  const clere = (): Opening[] => {
    const out: Opening[] = [];
    for (let i = 0; i < nb; i++) out.push(lancet((i + 0.5) * bay, 1.0, aisleH + 2.6, naveH - 0.9));
    return out;
  };
  const naveLen = zW - zE;
  k.push(naveW / 2, ph, zW, Math.PI / 2); wallPanel(k, naveLen, naveH, 0.8, clere().map((o) => ({ ...o, x0: o.x0 + (zW - zA1), x1: o.x1 + (zW - zA1) })), look, rng); k.pop();
  k.push(-naveW / 2, ph, zE, -Math.PI / 2); wallPanel(k, naveLen, naveH, 0.8, clere().map((o) => ({ ...o, x0: o.x0 + (zA0 - zE), x1: o.x1 + (zA0 - zE) })), look, rng); k.pop();
  const portalW = Math.min(3.0, naveW * 0.42), portalH = 6.4;
  k.push(-naveW / 2, ph, zW, 0); wallPanel(k, naveW, naveH, 0.8, [lancet(naveW / 2, portalW, 0, portalH, 'door')], look, rng); k.pop();
  // the nave roof (ridge along Z), gables at both ends
  k.push(0, 0, 0, Math.PI / 2);
  const yR = gableRoof(k, naveLen, naveW, 0.8, naveH + ph, 0.98, 0.35, rf, { surf: SURF.ashlar, col: sc }, lod, T.fear);
  k.pop();
  // transept: arms out past the aisles, gable ends with rose windows, lancets in the long walls
  const tW = W + 5.2, trH = naveH - 0.6;
  k.push(0, 0, zc);
  boxWalls(k, {
    W: tW, D: transD, H: trH, T: 0.8, y0: ph,
    front: [lancet(tW / 2 - (W / 2 + 1.3), 1.1, 2.0, 8.0), lancet(tW / 2 + (W / 2 + 1.3), 1.1, 2.0, 8.0)],
    back: [lancet(tW / 2 - (W / 2 + 1.3), 1.1, 2.0, 8.0), lancet(tW / 2 + (W / 2 + 1.3), 1.1, 2.0, 8.0)],
    left: [lancet((transD - 1.6) / 2, 1.0, 1.8, 6.6)],
    right: [lancet((transD - 1.6) / 2, 1.6, 1.2, 6.0, 'door')],
  }, look, rng);
  const yTR = gableRoof(k, tW, transD, 0.8, trH + ph, 0.98, 0.35, rf, { surf: SURF.ashlar, col: sc }, lod, T.fear);
  for (const sx of [-1, 1]) {
    k.push(sx * (tW / 2 + 0.01), 0, 0, sx * Math.PI / 2);
    roseWindow(k, 0, ph + trH - 0.6, 0, Math.min(1.9, transD * 0.27), sc, lod, rng.float());
    k.pop();
  }
  k.pop();
  // the crossing: a slender lead flèche, or a square lantern tower
  if (spec.style & 2) {
    const cs = naveW * 0.8;
    k.box(-cs / 2, yR - 1.2, zc - cs / 2, cs / 2, yR + 4.2, zc + cs / 2, SURF.ashlar, PART.wall, sc, { skip: ['bottom'] });
    if (lod === 0) for (let q = 0; q < 4; q++) {
      k.push(0, 0, zc, (q * Math.PI) / 2);
      for (const dx of [-0.8, 0.8]) k.quad([dx - 0.35, yR + 1.4, cs / 2 + 0.01], [dx + 0.35, yR + 1.4, cs / 2 + 0.01], [dx + 0.35, yR + 3.5, cs / 2 + 0.01], [dx - 0.35, yR + 3.5, cs / 2 + 0.01], SURF.glass, PART.glass, GLASS, 1, rng.float());
      k.pop();
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pinnacle(k, sx * (cs / 2 - 0.3), zc + sz * (cs / 2 - 0.3), yR + 4.2, 2.6, 0.5, sc, T, lod);
  } else {
    k.push(0, 0, zc, Math.PI / 8);
    k.cylinder(0, 0, yR - 0.4, yR + 2.2, 0.95, 0.85, 8, SURF.metal, PART.roof, roofCol, {});
    k.cylinder(0, 0, yR + 2.2, yR + 10.5, 0.95, 0.03, 8, SURF.metal, PART.roof, roofCol, {});
    k.pop();
  }
  // the apse: a half polygon of tall lancets under a half cone
  const ar = naveW / 2, aH = naveH - 1.6, na = 5;
  const apt: [number, number][] = [];
  for (let i = 0; i <= na; i++) { const a = (i / na) * Math.PI; apt.push([Math.cos(a) * ar, zE - Math.sin(a) * ar]); }
  for (let i = 0; i < na; i++) {
    const [x0, z0] = apt[i], [x1, z1] = apt[i + 1];
    const Ls = Math.hypot(x1 - x0, z1 - z0);
    k.push(x0, ph, z0, Math.atan2(-(z1 - z0), x1 - x0));
    wallPanel(k, Ls, aH, 0.7, Ls > 1.6 ? [lancet(Ls / 2, Math.min(1.0, Ls * 0.45), 1.6, aH - 1.0)] : [], look, rng);
    k.pop();
    // a buttress at each angle
    const a = (i / na) * Math.PI;
    if (i > 0) {
      const bx = Math.cos(a) * (ar + 0.55), bz = zE - Math.sin(a) * (ar + 0.55);
      k.push(bx, 0, bz, a + Math.PI / 2);
      k.box(-0.24, -1, -0.45, 0.24, ph + aH - 2.6, 0.45, SURF.ashlar, PART.wall, mulc(sc, 0.97), { skip: ['bottom'], aoLow: 0.6 });
      k.pop();
      pinnacle(k, bx, bz, ph + aH - 2.6, 2.4, 0.42, sc, T, lod);
    }
  }
  const apexY = ph + naveH + 1.6;
  for (let i = 0; i < na; i++) {
    const [x0, z0] = apt[i], [x1, z1] = apt[i + 1];
    const o = 0.5 / ar + 1;
    k.triangle([x0 * o, ph + aH, zE + (z0 - zE) * o], [x1 * o, ph + aH, zE + (z1 - zE) * o], [0, apexY, zE], rf.surf, PART.roof, roofCol, 0.9);
    k.triangle([x1 * o, ph + aH - 0.2, zE + (z1 - zE) * o], [x0 * o, ph + aH - 0.2, zE + (z0 - zE) * o], [0, apexY - 0.2, zE], SURF.planks, PART.roof, WOOD_DARK, 0.4);
  }
  // buttress piers along the aisles, flying buttresses to the nave wall, pinnacles on the piers
  for (let i = 0; i <= nb; i++) {
    const z = zA0 + i * bay;
    if (i === nb && z > zA1 - 0.5) continue;
    for (const sx of [-1, 1]) {
      const x0 = sx * (W / 2 + 0.05), x1 = sx * (W / 2 + 1.05);
      k.box(Math.min(x0, x1), -1, z - 0.42, Math.max(x0, x1), ph + aisleH + 2.6, z + 0.42, SURF.ashlar, PART.wall, mulc(sc, 0.97), { skip: ['bottom'], aoLow: 0.6 });
      // a weathered offset halfway up
      if (lod === 0) k.box(Math.min(x0, sx * (W / 2 + 1.3)), -1, z - 0.5, Math.max(x0, sx * (W / 2 + 1.3)), ph + aisleH * 0.45, z + 0.5, SURF.ashlar, PART.wall, mulc(sc, 0.93), { skip: ['bottom'], aoLow: 0.55 });
      pinnacle(k, sx * (W / 2 + 0.55), z, ph + aisleH + 2.6, 3.2, 0.62, sc, T, lod);
      if (lod === 0) flyer(k, sx * (W / 2 + 0.1), ph + aisleH + 2.4, sx * (naveW / 2 + 0.02), ph + naveH - 1.0, z, 0.42, mulc(sc, 1.02), 5);
      else k.beam([sx * (W / 2 + 0.1), ph + aisleH + 1.8, z], [sx * naveW / 2, ph + naveH - 1.4, z], 0.4, 0.6, SURF.ashlar, PART.wall, sc, 0.9);
    }
  }
  // the west front: twin towers round the portal, belfries, spires on some, the rose window between them
  const tH = naveH + 8.5, belfry = 5.2;
  const tz = zW - tw / 2 + 0.6;
  const spires = (spec.style & 1) === 0 || T.fear;
  for (const sx of [-1, 1]) {
    const tx = sx * (naveW / 2 + tw / 2 - 0.3);
    k.push(tx, 0, tz);
    // the lower stages (a tall lancet in the west face), then the belfry with paired openings on every face
    boxWalls(k, { W: tw, D: tw, H: tH - belfry, T: 0.8, y0: ph, front: [lancet(tw / 2, 0.9, 7.0, 10.6)], back: [], left: [], right: [] }, look, rng);
    k.box(-tw / 2, -1, -tw / 2, tw / 2, ph, tw / 2, SURF.ashlar, PART.plinth, mulc(sc, 0.85), { skip: ['bottom', 'top'], aoLow: 0.5 });
    boxWalls(k, { W: tw, D: tw, H: belfry, T: 0.6, y0: ph + tH - belfry, front: [lancet(tw / 2 - 0.65, 0.8, 1.0, 4.2), lancet(tw / 2 + 0.65, 0.8, 1.0, 4.2)], back: [lancet(tw / 2 - 0.65, 0.8, 1.0, 4.2), lancet(tw / 2 + 0.65, 0.8, 1.0, 4.2)], left: [lancet((tw - 1.2) / 2, 0.8, 1.0, 4.2)], right: [lancet((tw - 1.2) / 2, 0.8, 1.0, 4.2)] }, look, rng);
    // clasping buttresses at the tower's corners, a parapet, corner pinnacles
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      if (lod === 0) k.box(cx * tw / 2 - 0.35, -1, cz * tw / 2 - 0.35, cx * tw / 2 + 0.35, ph + tH - 3, cz * tw / 2 + 0.35, SURF.ashlar, PART.wall, mulc(sc, 0.96), { skip: ['bottom'], aoLow: 0.6 });
      pinnacle(k, cx * (tw / 2 - 0.2), cz * (tw / 2 - 0.2), ph + tH, 3.0, 0.55, sc, T, lod);
    }
    k.box(-tw / 2 - 0.1, ph + tH, -tw / 2 - 0.1, tw / 2 + 0.1, ph + tH + 0.25, tw / 2 + 0.1, SURF.ashlar, PART.trim, mulc(sc, 1.06), {});
    if (spires) {
      k.push(0, 0, 0, Math.PI / 8);
      k.cylinder(0, 0, ph + tH + 0.25, ph + tH + 14, tw * 0.46, 0.04, 8, rf.surf, PART.roof, T.fear ? [0.055, 0.05, 0.046] : mulc(sc, 0.9), {});
      k.pop();
      if (lod === 0) {
        if (T.fear) k.cylinder(0, 0, ph + tH + 13.8, ph + tH + 15.6, 0.07, 0.0, 4, SURF.iron, PART.roof, IRON, {});
        else { k.beam([0, ph + tH + 13.8, 0], [0, ph + tH + 15.4, 0], 0.1, 0.1, SURF.metal, PART.roof, T.metal, 1); k.beam([-0.45, ph + tH + 14.9, 0], [0.45, ph + tH + 14.9, 0], 0.09, 0.09, SURF.metal, PART.roof, T.metal, 1); }
      }
    } else {
      k.quad([-tw / 2, ph + tH + 0.25, tw / 2], [tw / 2, ph + tH + 0.25, tw / 2], [tw / 2, ph + tH + 0.25, -tw / 2], [-tw / 2, ph + tH + 0.25, -tw / 2], rf.surf, PART.roof, roofCol, 0.8);
    }
    k.pop();
  }
  // the portal: stepped archivolts round the door, a gablet over it; the rose window above
  const zf = zW + 0.02;
  if (lod === 0) {
    for (let i = 1; i <= 3; i++) {
      const e = i * 0.22;
      archBand(k, -portalW / 2 - e, portalW / 2 + e, portalH - portalW * 0.95, portalW * 0.95 + e * 0.9, zf + 0.06 * i, 0.2, mulc(sc, 1.04 + 0.02 * i), 6);
    }
    // jamb shafts under the archivolts
    for (let i = 1; i <= 3; i++) for (const sx of [-1, 1]) k.cylinder(sx * (portalW / 2 + i * 0.22), zf + 0.06 * i, 0, portalH - portalW * 0.95, 0.1, 0.1, 6, SURF.ashlar, PART.trim, mulc(sc, 1.04 + 0.02 * i), {});
    const gy = portalH - 0.2, gw = portalW / 2 + 1.0;
    k.beam([-gw, gy, zf + 0.3], [0, gy + 1.9, zf + 0.3], 0.28, 0.3, SURF.ashlar, PART.trim, mulc(sc, 1.08), 0.9);
    k.beam([gw, gy, zf + 0.3], [0, gy + 1.9, zf + 0.3], 0.28, 0.3, SURF.ashlar, PART.trim, mulc(sc, 1.08), 0.9);
    pinnacle(k, -gw - 0.15, zf + 0.3, gy - 0.6, 2.2, 0.36, sc, T, lod);
    pinnacle(k, gw + 0.15, zf + 0.3, gy - 0.6, 2.2, 0.36, sc, T, lod);
  }
  roseWindow(k, 0, ph + portalH + 3.6, zf, Math.min(2.2, naveW * 0.3), sc, lod, rng.float());
  // steps before the portal
  for (let i = 0; i < 3; i++) k.box(-portalW / 2 - 0.8 - 0.3 * (2 - i), -1, zW + 0.3, portalW / 2 + 0.8 + 0.3 * (2 - i), ph * (i + 1) / 3, zW + 0.3 + 0.4 * (3 - i), SURF.ashlar, PART.plinth, mulc(sc, 0.95), { skip: ['bottom'], aoLow: 0.7 });
  em.push({ p: [-portalW / 2 - 1.2, 0.9, zW + 1.2], kind: EMIT.brazier, size: 0.3 });
  return { top: ph + tH + (spires ? 15.6 : 3.2), hw: W / 2 + 2.6, back: zE - ar - 0.6, front: zW + 1.6 };
}

/** library: a columned portico, steps, a pediment, tall windows (domed in later eras) */
function library(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const W = spec.w, D = spec.d;
  const look: WallLook = { ...L.wall, surf: L.wall.surf === SURF.brick ? SURF.brick : SURF.ashlar, col: L.wall.surf === SURF.brick ? L.wall.col : mixc(mulc(STONE, 1.3), [0.65, 0.58, 0.45], 0.25), shutters: null, mullions: true };
  plinth(k, W, D, 1.2, SURF.ashlar, mulc(look.col, 0.95));
  const H = 7;
  boxWalls(k, { W, D, H, T: 0.6, y0: 1.2, front: [{ x0: W / 2 - 0.9, x1: W / 2 + 0.9, y0: 0, y1: 3.4, kind: 'door' }, ...windowRow(W, 1.4, [1.2, 3.6], 2.6, 1.0, [W / 2 - 1.3, W / 2 + 1.3])], back: windowRow(W, 1.4, [1.2, 3.6], 2.6, 1.0, null), left: windowRow(D - 1.2, 1.4, [1.2, 3.6], 2.6, 0.8, null), right: windowRow(D - 1.2, 1.4, [1.2, 3.6], 2.6, 0.8, null) }, look, rng);
  // portico
  if (spec.lod === 0) {
    for (let i = 0; i < 4; i++) {
      const x = -W * 0.35 + (i * W * 0.7) / 3;
      k.cylinder(x, D / 2 + 1.6, 1.2, 1.2 + H - 0.4, 0.38, 0.33, 12, SURF.ashlar, PART.wall, mulc(look.col, 1.08), {});
    }
    for (let s = 0; s < 4; s++) k.box(-W * 0.42, -0.6, D / 2 + 0.1 + s * 0.6, W * 0.42, 1.2 - s * 0.3, D / 2 + 0.7 + s * 0.6, SURF.ashlar, PART.plinth, mulc(look.col, 0.95), { skip: ['bottom'] });
    k.box(-W * 0.42, 1.2 + H - 0.4, D / 2, W * 0.42, 1.2 + H + 0.6, D / 2 + 2.2, SURF.ashlar, PART.trim, mulc(look.col, 1.1), { skip: ['nz'] });
  }
  const y = 1.2 + H;
  k.box(-W / 2 - 0.2, y - 0.1, -D / 2 - 0.2, W / 2 + 0.2, y + 0.5, D / 2 + 0.2, SURF.ashlar, PART.trim, mulc(look.col, 1.1), { skip: ['bottom'] });
  if (spec.era >= 7) {
    const R = Math.min(W, D) * 0.28;
    const prof: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const t = (i / 8) * Math.PI / 2; prof.push([R * Math.cos(t) + 0.01, y + 0.5 + R * 0.9 * Math.sin(t)]); }
    k.lathe(0, 0, prof, 18, SURF.metal, PART.roof, [0.14, 0.27, 0.24], 0.85, 1);
    k.quad([-W / 2, y + 0.5, D / 2], [W / 2, y + 0.5, D / 2], [W / 2, y + 0.5, -D / 2], [-W / 2, y + 0.5, -D / 2], SURF.concrete, PART.roof, mulc(look.col, 0.8), 0.9);
    return y + 0.5 + R * 0.9;
  }
  const rf: RoofLook = { ...L.roof, surf: SURF.tiles, col: TILE[(spec.style + 1) & 3], cap: TILE[0], capSurf: SURF.tiles };
  return hipRoof(k, W + 0.4, D + 0.4, y + 0.5, 0.42, 0.3, rf, spec.lod);
}

/** market: stalls with striped awnings and goods, around a well; a covered hall in later eras */
/** the hall roof's height on a market of `era` (buildings.ts drapes the square on its ground and keeps the roof level) */
export function marketHallH(era: number): number { return era >= 7 ? 4.2 : 0; }

function market(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const W = spec.w, D = spec.d;
  // the square's floor at ground level (paving with a low kerb, or trodden earth), not a raised slab: a 1 m grid of
  // flags that buildings.ts drapes on the ground under each market (a level slab, or one sheared to the slope, could
  // not follow the ground's ~12 m humps: they broke through the paving, or its downhill edge stood out as a wall)
  const paved = spec.era >= 5;
  // (the flags as dark as the town's street paving, roads.ts: at 0.72 × STONE the square read as a pale slab)
  const floorCol: RGB = paved ? mulc(STONE, 0.5) : [0.16, 0.12, 0.085];
  const nx = Math.max(2, Math.round(W)), nz = Math.max(2, Math.round(D));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = -W / 2 + (i * W) / nx, x1 = -W / 2 + ((i + 1) * W) / nx, z0 = -D / 2 + (j * D) / nz, z1 = -D / 2 + ((j + 1) * D) / nz;
    k.quad([x0, 0.02, z1], [x1, 0.02, z1], [x1, 0.02, z0], [x0, 0.02, z0], paved ? SURF.ashlar : SURF.earth, PART.paving, paved ? mulc(floorCol, 0.88 + 0.24 * rng.float()) : floorCol, 0.92);
  }
  if (paved) {
    // the kerb in 1 m stones (each follows the ground under it, and runs 0.7 m down: buildings.ts raises the paving
    // over the ground's dimples)
    const kc = mulc(STONE, 0.46), kw = 0.28, kh = 0.1;
    const o = { skip: ['bottom'], aoLow: 0.75 };
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const L2 = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L2));
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 1) / n;
        const xa = x0 + (x1 - x0) * a, za = z0 + (z1 - z0) * a, xb = x0 + (x1 - x0) * b, zb = z0 + (z1 - z0) * b;
        k.box(Math.min(xa, xb) - (x0 === x1 ? kw / 2 : 0), -0.7, Math.min(za, zb) - (z0 === z1 ? kw / 2 : 0), Math.max(xa, xb) + (x0 === x1 ? kw / 2 : 0), kh, Math.max(za, zb) + (z0 === z1 ? kw / 2 : 0), SURF.ashlar, PART.paving, mulc(kc, 0.92 + 0.16 * rng.float()), o);
      }
    };
    run(-W / 2, -D / 2 + kw / 2, W / 2, -D / 2 + kw / 2);
    run(-W / 2, D / 2 - kw / 2, W / 2, D / 2 - kw / 2);
    run(-W / 2 + kw / 2, -D / 2 + kw, -W / 2 + kw / 2, D / 2 - kw);
    run(W / 2 - kw / 2, -D / 2 + kw, W / 2 - kw / 2, D / 2 - kw);
  }
  if (spec.era >= 7) {
    // market hall: arcade of posts under a long roof
    const H = marketHallH(spec.era);
    // columns: a plinth block, a slim shaft, a capital; tie beams carry the roof
    const colC: RGB = L.wall.surf === SURF.brick ? mulc(STONE, 1.15) : L.wall.col;
    const sides = spec.lod === 0 ? 10 : 6;
    for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) {
      const x = -W / 2 + 1 + (i * (W - 2)) / 5, z = sz * (D / 2 - 1);
      k.box(x - 0.3, 0.08, z - 0.3, x + 0.3, 0.45, z + 0.3, SURF.ashlar, PART.plinth, colC, {});
      k.cylinder(x, z, 0.45, H - 0.3, 0.2, 0.17, sides, SURF.ashlar, PART.wall, colC, {});
      k.box(x - 0.27, H - 0.3, z - 0.27, x + 0.27, H, z + 0.27, SURF.ashlar, PART.trim, colC, {});
    }
    for (const sz of [-1, 1]) k.beam([-W / 2 + 0.8, H + 0.12, sz * (D / 2 - 1)], [W / 2 - 0.8, H + 0.12, sz * (D / 2 - 1)], 0.24, 0.3, SURF.beam, PART.frame, WOOD_DARK, 0.85);
    for (let i = 0; i < 6; i++) { const x = -W / 2 + 1 + (i * (W - 2)) / 5; k.beam([x, H + 0.1, -(D / 2 - 1)], [x, H + 0.1, D / 2 - 1], 0.2, 0.26, SURF.beam, PART.frame, WOOD_DARK, 0.85); }
    const rf: RoofLook = { ...L.roof };
    gableRoof(k, W - 0.6, D - 0.6, 0.3, H, 0.5, 0.6, rf, null, spec.lod);
  }
  const stalls = spec.lod === 0 ? 8 : 5;
  // produce in muted, natural colours: grain, roots, greens, fruit, fish, wool, pots
  const goods: RGB[] = [[0.36, 0.27, 0.12], [0.3, 0.17, 0.08], [0.09, 0.16, 0.05], [0.34, 0.1, 0.04], [0.28, 0.27, 0.24], [0.4, 0.32, 0.2], [0.3, 0.14, 0.07]];
  const sack: RGB = [0.36, 0.3, 0.2], straw: RGB = [0.34, 0.26, 0.13];
  for (let i = 0; i < stalls; i++) {
    const a = (i / stalls) * Math.PI * 2 + 0.3;
    const rx = Math.cos(a) * (W / 2 - 2.2), rz = Math.sin(a) * (D / 2 - 2.2);
    k.push(rx, 0.02, rz, -a - Math.PI / 2);
    // a trestle table: crates and baskets heaped with produce on it, sacks at its foot
    k.box(-1.0, 0.8, -0.45, 1.0, 0.86, 0.45, SURF.planks, PART.prop, WOOD, {});
    for (const sx of [-0.85, 0.85]) k.box(sx - 0.05, 0, -0.4, sx + 0.05, 0.8, 0.4, SURF.planks, PART.prop, WOOD_DARK, { skip: ['bottom'] });
    for (let g = 0; g < 3; g++) {
      const c = goods[(i * 3 + g) % goods.length];
      const gx = -0.62 + g * 0.62;
      if ((i + g) % 2 === 0) {
        // an open crate, its produce heaped above the rim
        k.box(gx - 0.26, 0.86, -0.22, gx + 0.26, 1.08, 0.22, SURF.planks, PART.prop, WOOD_GREY, { skip: ['bottom', 'top'] });
        k.lathe(gx, 0, [[0.25, 1.0], [0.22, 1.1], [0.12, 1.16], [0.02, 1.18]], spec.lod === 0 ? 7 : 5, SURF.cloth, PART.prop, c, 0.7, 1);
      } else {
        // a round basket
        k.lathe(gx, 0, [[0.16, 0.86], [0.24, 0.95], [0.25, 1.04], [0.22, 1.05]], spec.lod === 0 ? 9 : 6, SURF.thatch, PART.prop, straw, 0.75, 1);
        k.lathe(gx, 0, [[0.22, 1.02], [0.18, 1.1], [0.08, 1.14], [0.02, 1.15]], spec.lod === 0 ? 7 : 5, SURF.cloth, PART.prop, c, 0.7, 1);
      }
    }
    if (spec.lod === 0) for (const [sx, sz] of [[-0.6, 0.62], [0.1, 0.66]] as [number, number][]) {
      // a sack, its neck tied
      k.lathe(sx, sz, [[0.12, 0.0], [0.2, 0.12], [0.2, 0.36], [0.13, 0.5], [0.06, 0.56], [0.08, 0.62], [0.02, 0.64]], 7, SURF.cloth, PART.prop, mulc(sack, 0.9 + 0.2 * rng.float()), 0.6, 1);
    }
    if (spec.era < 7) {
      // awning on four poles: dyed cloth faded by the sun
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cylinder(sx * 1.1, sz * 0.75, 0, sz > 0 ? 2.2 : 2.5, 0.04, 0.035, 5, SURF.beam, PART.frame, WOOD, {});
      // (weathered, sun-faded dyes: undyed linen and canvas mostly, the dyed ones dull)
      const cc = (i + spec.style) % 3 === 0 ? mulc([0.42, 0.38, 0.3], 0.8 + 0.2 * rng.float()) : mulc(mixc(CLOTH[(i + spec.style) % CLOTH.length], [0.4, 0.36, 0.28], 0.5), 0.62);
      k.slab([-1.25, 2.2, 0.9], [1.25, 2.2, 0.9], [1.25, 2.55, -0.9], [-1.25, 2.55, -0.9], 0.03, SURF.cloth, PART.roof, cc, SURF.cloth, mulc(cc, 0.5), 1, rng.float());
    }
    crate(k, 1.4, -0.6, 0.5, 0.4, WOOD_GREY);
    barrel(k, -1.45, -0.55, 0.28, 0.75, WOOD_DARK);
    k.pop();
  }
  // well in the middle
  k.cylinder(0, 0, 0.08, 0.85, 0.85, 0.85, 12, SURF.rubble, PART.wall, STONE, { top: false });
  k.cylinder(0, 0, 0.08, 0.84, 0.6, 0.6, 12, SURF.earth, PART.wall, INTERIOR, {});
  k.quad([-0.6, 0.5, 0.6], [0.6, 0.5, 0.6], [0.6, 0.5, -0.6], [-0.6, 0.5, -0.6], SURF.glass, PART.prop, [0.01, 0.02, 0.02], 0.5);
  return spec.era >= 7 ? 6.5 : 2.8;
}

/** windmill: a tapering tower with a cap and four sails (the sails turn in the shader: PART.sail) */
function mill(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const R = Math.min(spec.w, spec.d) * 0.4;
  const H = 8.5;
  const surf = L.wall.surf === SURF.logs || L.wall.surf === SURF.planks ? SURF.shingle : L.wall.surf;
  const col = surf === SURF.shingle ? WOOD : L.wall.col;
  k.cylinder(0, 0, -1, H, R, R * 0.68, spec.lod === 0 ? 14 : 8, surf, PART.wall, col, {});
  // door and small windows
  k.push(0, 0, R - 0.05);
  k.quad([-0.5, 0, 0.06], [0.5, 0, 0.06], [0.5, 2.0, 0.02], [-0.5, 2.0, 0.02], SURF.planks, PART.door, WOOD_DARK, 0.6);
  k.pop();
  if (spec.lod === 0) for (const y of [3.6, 6.2]) {
    const rr = R - (R - R * 0.68) * (y / H);
    k.quad([-0.3, y, rr + 0.03], [0.3, y, rr + 0.03], [0.3, y + 0.7, rr + 0.0], [-0.3, y + 0.7, rr + 0.0], SURF.glass, PART.glass, GLASS, 1, rng.float());
  }
  // cap
  const cr = R * 0.75;
  k.lathe(0, 0, [[cr + 0.2, H], [cr * 0.95, H + 1.0], [cr * 0.6, H + 1.8], [0.05, H + 2.3]], 12, SURF.shingle, PART.roof, SHINGLE, 0.8, 1);
  // sails on the hub at the front (rotate about local Z through the hub in the shader)
  const hubY = H + 0.8, hubZ = cr + 0.5;
  const sail0 = k.vertexCount;
  k.tube([[0, hubY, cr - 0.2], [0, hubY, hubZ]], [0.18, 0.15], 8, SURF.beam, PART.sail, WOOD_DARK, { cap: true });
  const sl = 6.4;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.35;
    const ca = Math.cos(a), sa = Math.sin(a);
    k.beam([0, hubY, hubZ], [ca * sl, hubY + sa * sl, hubZ], 0.12, 0.12, SURF.beam, PART.sail, WOOD_DARK, 0.9);
    // lattice sail cloth on one side of the stock
    const px = -sa, py = ca;
    const p0: V3 = [ca * 1.2, hubY + sa * 1.2, hubZ + 0.04], p1: V3 = [ca * sl, hubY + sa * sl, hubZ + 0.04];
    const q0: V3 = [p0[0] + px * 1.1, p0[1] + py * 1.1, hubZ + 0.04], q1: V3 = [p1[0] + px * 1.2, p1[1] + py * 1.2, hubZ + 0.04];
    k.quad(p0, p1, q1, q0, SURF.cloth, PART.sail, [0.52, 0.48, 0.4], 0.95);
    k.quad(q0, q1, p1, p0, SURF.cloth, PART.sail, [0.4, 0.37, 0.3], 0.7);
  }
  // the shader turns PART.sail about the local Z axis through (0, uv.x): store the hub height in the sails' uv
  k.setPartUv(PART.sail, hubY, 0, sail0);
  return H + 2.3 + sl;
}

/** aqueduct: an arcade of piers and arches with a channel on top (along local Z) */
function aqueduct(k: KitBuilder, spec: BuildingSpec, L: Look): number {
  const Lz = Math.max(spec.d, spec.w), Wd = 3.0;
  const H = 9;
  const n = Math.max(2, Math.round(Lz / 6));
  const span = Lz / n;
  const col = L.wall.surf === SURF.brick ? L.wall.col : mixc(mulc(STONE, 1.2), [0.6, 0.52, 0.4], 0.3);
  const surf = L.wall.surf === SURF.brick ? SURF.brick : SURF.ashlar;
  for (let i = 0; i <= n; i++) {
    const z = -Lz / 2 + i * span;
    k.box(-Wd / 2, -4, z - 0.8, Wd / 2, H - 2.4, z + 0.8, surf, PART.wall, col, { skip: ['bottom'], aoLow: 0.6 });
  }
  // arches: segments of a semicircle between piers (approximated by voussoir boxes)
  for (let i = 0; i < n; i++) {
    const zc = -Lz / 2 + (i + 0.5) * span;
    const r = span / 2 - 0.8;
    const segs = spec.lod === 0 ? 7 : 4;
    for (let s = 0; s < segs; s++) {
      const a0 = Math.PI - (s / segs) * Math.PI, a1 = Math.PI - ((s + 1) / segs) * Math.PI;
      const y0 = H - 2.4 - r + Math.sin(a0) * r, y1 = H - 2.4 - r + Math.sin(a1) * r;
      const z0 = zc + Math.cos(a0) * r, z1 = zc + Math.cos(a1) * r;
      k.quad([-Wd / 2, y0, z0], [Wd / 2, y0, z0], [Wd / 2, y1, z1], [-Wd / 2, y1, z1], surf, PART.wall, mulc(col, 0.8), 0.6);
      // spandrel faces up to the deck
      for (const sx of [-1, 1]) {
        const x = sx * Wd / 2;
        const a: V3 = [x, y0, z0], b: V3 = [x, H - 2.4, z0], c: V3 = [x, H - 2.4, z1], d: V3 = [x, y1, z1];
        if (sx > 0) k.quad(a, b, c, d, surf, PART.wall, col, 0.9); else k.quad(a, d, c, b, surf, PART.wall, col, 0.9);
      }
    }
  }
  // deck and channel walls
  k.box(-Wd / 2 - 0.15, H - 2.4, -Lz / 2 - 0.8, Wd / 2 + 0.15, H - 1.8, Lz / 2 + 0.8, surf, PART.trim, mulc(col, 1.05), {});
  k.box(-Wd / 2, H - 1.8, -Lz / 2 - 0.8, -Wd / 2 + 0.4, H, Lz / 2 + 0.8, surf, PART.wall, col, {});
  k.box(Wd / 2 - 0.4, H - 1.8, -Lz / 2 - 0.8, Wd / 2, H, Lz / 2 + 0.8, surf, PART.wall, col, {});
  k.quad([-Wd / 2 + 0.4, H - 0.6, Lz / 2 + 0.8], [Wd / 2 - 0.4, H - 0.6, Lz / 2 + 0.8], [Wd / 2 - 0.4, H - 0.6, -Lz / 2 - 0.8], [-Wd / 2 + 0.4, H - 0.6, -Lz / 2 - 0.8], SURF.glass, PART.prop, [0.02, 0.05, 0.05], 0.8);
  return H;
}

/** a wall segment along local Z: palisade (wood) or a crenellated curtain wall with a wall walk */
function wallSeg(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const Lz = Math.max(spec.d, spec.w);
  const fear = spec.mood < -0.33;
  if (L.wall.surf === SURF.planks || L.wall.surf === SURF.logs || spec.mat.tier <= 1) {
    // palisade of sharpened logs
    const n = Math.max(4, Math.round(Lz / 0.36));
    for (let i = 0; i < n; i++) {
      const z = -Lz / 2 + (i + 0.5) * (Lz / n);
      const h = 3.6 + rng.float() * 0.5;
      const r = 0.17 + rng.float() * 0.03;
      k.cylinder(0, z, -1.5, h, r, r * 0.95, spec.lod === 0 ? 6 : 4, SURF.bark, PART.wall, mulc(WOOD, 0.8 + rng.float() * 0.4), {});
      k.cylinder(0, z, h, h + 0.5, r * 0.95, 0.01, spec.lod === 0 ? 6 : 4, SURF.planks, PART.wall, mulc(WOOD, 1.3), {});
    }
    if (spec.lod === 0) k.beam([0.3, 2.4, -Lz / 2], [0.3, 2.4, Lz / 2], 0.12, 0.14, SURF.bark, PART.frame, WOOD_DARK, 0.8);
    return 4.6;
  }
  const T = 2.2, H = 6.5;
  const col = fear ? STONE_DARK : L.wall.col;
  const surf = L.wall.surf === SURF.brick ? SURF.brick : L.wall.surf === SURF.mudbrick ? SURF.mudbrick : SURF.rubble;
  k.box(-T / 2 - 0.25, -4, -Lz / 2, T / 2 + 0.25, 0.8, Lz / 2, surf, PART.plinth, mulc(col, 0.85), { skip: ['bottom'], aoLow: 0.5 });
  k.box(-T / 2, 0.8, -Lz / 2, T / 2, H, Lz / 2, surf, PART.wall, col, { skip: ['bottom'], aoLow: 0.75 });
  // merlons on both parapets
  const n = Math.max(2, Math.round(Lz / 1.6));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z = -Lz / 2 + (i + 0.5) * (Lz / n);
      k.box(sx * T / 2 - (sx > 0 ? 0.45 : 0), H, z - 0.45, sx * T / 2 + (sx < 0 ? 0.45 : 0), H + 1.05, z + 0.45, surf, PART.wall, col, { skip: ['bottom'] });
      if (fear && spec.lod === 0 && i % 2 === 0) k.cylinder(sx * T / 2, z, H + 1.05, H + 1.8, 0.06, 0.0, 4, SURF.iron, PART.trim, IRON, {});
    }
  }
  return H + 1.05;
}

/** gatehouse: two towers and an arched passage with doors */
function gate(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = Math.max(spec.w, 9), D = spec.d;
  const wood = spec.mat.tier <= 1;
  if (wood) {
    // timber gate: two watch platforms on posts and a double door between them
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 1.2);
      for (const ox of [-0.9, 0.9]) for (const oz of [-0.9, 0.9]) k.cylinder(x + ox, oz, -1, 5.6, 0.16, 0.14, 6, SURF.bark, PART.frame, WOOD, {});
      k.box(x - 1.3, 4.4, -1.3, x + 1.3, 4.6, 1.3, SURF.planks, PART.trim, WOOD, {});
      fence(k, [[x - 1.2, -1.2], [x + 1.2, -1.2], [x + 1.2, 1.2], [x - 1.2, 1.2], [x - 1.2, -1.2]], 1.0, WOOD_GREY, -1, spec.lod);
      k.push(x, 4.6, 0); gableRoof(k, 2.8, 2.8, 0.1, 1.7, 0.7, 0.3, L.roof, null, spec.lod); k.pop();
      em.push({ p: [x + 1.3, 4.0, 1.4], kind: EMIT.brazier, size: 0.25 });
    }
    k.box(-W / 2 + 2.2, 3.9, -0.3, W / 2 - 2.2, 4.3, 0.3, SURF.bark, PART.frame, WOOD_DARK, {});
    for (const sx of [-1, 1]) k.box(sx > 0 ? 0.04 : -W / 2 + 2.3, 0, -0.12, sx > 0 ? W / 2 - 2.3 : -0.04, 3.8, 0.12, SURF.planks, PART.door, WOOD, {});
    return 7.5;
  }
  const H = 9, tw = 4.2;
  const col = spec.mood < -0.33 ? STONE_DARK : L.wall.col;
  const surf = L.wall.surf === SURF.brick ? SURF.brick : SURF.rubble;
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - tw / 2);
    k.box(x - tw / 2, -3, -D / 2, x + tw / 2, H, D / 2, surf, PART.wall, col, { skip: ['bottom'], aoLow: 0.7 });
    for (let i = 0; i < 3; i++) for (const sz of [-1, 1]) k.box(x - tw / 2 + i * 1.5, H, sz * D / 2 - (sz > 0 ? 0.5 : 0), x - tw / 2 + i * 1.5 + 0.9, H + 1.1, sz * D / 2 + (sz < 0 ? 0.5 : 0), surf, PART.wall, col, { skip: ['bottom'] });
    if (spec.lod === 0) k.quad([x - 0.2, 5.5, D / 2 + 0.01], [x + 0.2, 5.5, D / 2 + 0.01], [x + 0.2, 6.8, D / 2 + 0.01], [x - 0.2, 6.8, D / 2 + 0.01], SURF.glass, PART.glass, GLASS, 1, rng.float());
    em.push({ p: [x + sx * -0.2 - sx * (tw / 2 - 0.3), 3.6, D / 2 + 0.4], kind: EMIT.brazier, size: 0.22 });
  }
  // passage block above the arch with the doors recessed
  const gw = W - 2 * tw;
  k.box(-gw / 2, 4.6, -D / 2 + 0.3, gw / 2, H - 0.8, D / 2 - 0.3, surf, PART.wall, col, {});
  k.box(-gw / 2 - 0.1, 4.6, -D / 2, gw / 2 + 0.1, 5.2, D / 2, SURF.ashlar, PART.trim, mulc(col, 1.2), {});
  k.box(-gw / 2, 0, -0.15, gw / 2, 4.6, 0.15, SURF.planks, PART.door, WOOD_DARK, {});
  if (spec.lod === 0) for (let i = 0; i < 5; i++) k.box(-gw / 2 + 0.2 + i * (gw - 0.4) / 4 - 0.04, 0.0, 0.15, -gw / 2 + 0.2 + i * (gw - 0.4) / 4 + 0.04, 4.6, 0.2, SURF.iron, PART.trim, IRON, {});
  return H + 1.1;
}

/** tower: a timber watchtower on stilts, or a round / square stone tower with crenellations */
function tower(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const S = Math.min(spec.w, spec.d);
  if (spec.mat.tier <= 1 && L.wall.surf !== SURF.rubble) {
    const H = 8;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.tube([[sx * S * 0.42, -1, sz * S * 0.42], [sx * S * 0.28, H, sz * S * 0.28]], [0.16, 0.13], 6, SURF.bark, PART.frame, WOOD, {});
    if (spec.lod === 0) for (const y of [2.5, 5.2]) for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2;
      const p = (sx: number, sz: number, yy: number): V3 => { const r = S * (0.42 - 0.14 * (yy + 1) / (H + 1)); const ca = Math.cos(a), sa = Math.sin(a); return [ca * sx * r - sa * sz * r, yy, sa * sx * r + ca * sz * r]; };
      k.beam(p(-1, 1, y - 1.2), p(1, 1, y + 1.2), 0.1, 0.1, SURF.bark, PART.frame, WOOD_DARK, 0.8);
    }
    k.box(-S * 0.38, H, -S * 0.38, S * 0.38, H + 0.2, S * 0.38, SURF.planks, PART.trim, WOOD, {});
    fence(k, [[-S * 0.36, -S * 0.36], [S * 0.36, -S * 0.36], [S * 0.36, S * 0.36], [-S * 0.36, S * 0.36], [-S * 0.36, -S * 0.36]], 1.0, WOOD_GREY, -1, spec.lod);
    k.push(0, H + 0.2, 0); const t = gableRoof(k, S * 0.8, S * 0.8, 0.1, 2.0, 0.75, 0.3, L.roof, null, spec.lod); k.pop();
    em.push({ p: [S * 0.3, H + 1.2, S * 0.3], kind: EMIT.brazier, size: 0.25 });
    void rng;
    return H + 0.2 + t;
  }
  const H = 13;
  const col = spec.mood < -0.33 ? STONE_DARK : L.wall.col;
  const surf = L.wall.surf === SURF.brick ? SURF.brick : SURF.rubble;
  const R = S * 0.48;
  k.cylinder(0, 0, -3, H, R * 1.08, R, spec.lod === 0 ? 16 : 9, surf, PART.wall, col, { aoLow: 0.7 });
  k.cylinder(0, 0, H, H + 0.6, R + 0.35, R + 0.35, spec.lod === 0 ? 16 : 9, surf, PART.trim, mulc(col, 1.1), { top: true, topSurf: SURF.ashlar, topCol: mulc(col, 0.9) });
  const n = spec.lod === 0 ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.push(Math.cos(a) * (R + 0.1), H + 0.6, Math.sin(a) * (R + 0.1), -a);
    k.box(-0.25, 0, -0.55, 0.25, 1.1, 0.55, surf, PART.wall, col, { skip: ['bottom'] });
    k.pop();
  }
  if (spec.lod === 0) for (const y of [4, 8.5]) {
    const a = 0.4 + y;
    k.push(Math.cos(a) * (R + 0.02), y, Math.sin(a) * (R + 0.02), -a + Math.PI / 2);
    k.quad([-0.15, 0, 0], [0.15, 0, 0], [0.15, 1.2, 0], [-0.15, 1.2, 0], SURF.glass, PART.glass, GLASS, 1, rng.float());
    k.pop();
  }
  if (spec.era >= 6 && spec.style % 2 === 0) k.lathe(0, 0, [[R + 0.5, H + 1.6], [R * 0.5, H + 4.5], [0.03, H + 6.5]], 12, SURF.slate, PART.roof, SLATE, 0.85, 1);
  em.push({ p: [0, H + 1.0, 0], kind: EMIT.brazier, size: 0.3 });
  return H + (spec.era >= 6 && spec.style % 2 === 0 ? 6.5 : 1.7);
}

/** dock: a plank pier on piles reaching out along +Z, bollards, crates, a moored boat */
function dock(k: KitBuilder, spec: BuildingSpec, rng: Rng): number {
  const W = Math.min(spec.w, 7), Lz0 = Math.max(spec.d, 12);
  const deck = 0.6;
  // the pier runs back to the land: its landward end is carried on into the shore (the rising beach buries what is
  // behind the waterline) — a quay standing alone out in the sea read as a floating slab
  const back = 10;
  k.push(0, 0, -back / 2);
  const Lz = Lz0 + back;
  const stone = spec.mat.tier >= 2 && spec.era >= 6;
  if (stone) {
    // a quay of dark dressed stone, banded by the water: dry above the splash line, a dark wet band at the waterline,
    // weed and algae below it fading into the depths (the origin stands ~0.35 m above the water: buildings.ts place)
    const dry = mulc(STONE, 0.62), wet: RGB = [0.07, 0.066, 0.06], weed: RGB = [0.035, 0.05, 0.028], deep: RGB = [0.02, 0.026, 0.022];
    const band = (y0: number, y1: number, col: RGB, top: boolean) =>
      k.box(-W / 2, y0, -Lz / 2, W / 2, y1, Lz / 2, SURF.ashlar, PART.plinth, col, { skip: top ? ['bottom'] : ['bottom', 'top'], aoLow: 0.7 });
    band(-9, -1.6, deep, false);
    band(-1.6, -0.35, weed, false);
    band(-0.35, 0.2, wet, false);
    band(0.2, deck, dry, true);
    // a coping course along the edges
    for (const sx of [-1, 1]) k.box(sx * W / 2 - 0.2, deck, -Lz / 2, sx * W / 2 + 0.2, deck + 0.12, Lz / 2, SURF.ashlar, PART.trim, mulc(STONE, 0.75), { skip: ['bottom'] });
    if (spec.lod === 0) {
      // iron ladders down the side into the water, and stone steps at the far end
      for (const z of [-Lz * 0.2, Lz * 0.25]) {
        const x = W / 2 + 0.06;
        for (const dz of [-0.22, 0.22]) k.beam([x, deck + 0.5, z + dz], [x, -1.4, z + dz], 0.04, 0.04, SURF.iron, PART.prop, IRON, 0.9);
        for (let y = -1.2; y < deck; y += 0.3) k.beam([x, y, z - 0.22], [x, y, z + 0.22], 0.025, 0.025, SURF.iron, PART.prop, IRON, 0.9);
      }
      for (let i = 0; i < 5; i++) {
        const y = deck - 0.22 * (i + 1);
        k.box(-W / 2 + 0.1, y - 0.22, Lz / 2, W / 2 - 0.1, y, Lz / 2 + 0.35 * (i + 1), SURF.ashlar, PART.plinth, y < -0.35 ? weed : y < 0.2 ? wet : dry, { skip: ['bottom'] });
      }
    }
  } else {
    const nz = Math.max(3, Math.round(Lz / 2.5));
    for (let i = 0; i <= nz; i++) for (const sx of [-1, 1]) {
      const z = -Lz / 2 + (i * Lz) / nz;
      k.cylinder(sx * (W / 2 - 0.2), z, -9, deck + (spec.lod === 0 ? 0.6 : 0), 0.16, 0.15, spec.lod === 0 ? 6 : 4, SURF.bark, PART.plinth, mulc(WOOD, 0.75), { top: true, aoLow: 0.3 });
    }
    if (spec.lod === 0) {
      // stringers under the deck, cross-braces between the pile bents down to the water, a rubbing strake
      for (const sx of [-1, 1]) k.beam([sx * (W / 2 - 0.2), deck - 0.2, -Lz / 2], [sx * (W / 2 - 0.2), deck - 0.2, Lz / 2], 0.18, 0.22, SURF.beam, PART.plinth, mulc(WOOD, 0.65), 0.7);
      for (let i = 0; i <= nz; i++) {
        const z = -Lz / 2 + (i * Lz) / nz;
        k.beam([-(W / 2 - 0.2), deck - 0.25, z], [W / 2 - 0.2, deck - 0.25, z], 0.16, 0.2, SURF.beam, PART.plinth, mulc(WOOD, 0.6), 0.7);
        k.beam([-(W / 2 - 0.2), deck - 0.35, z], [W / 2 - 0.2, -0.6, z], 0.1, 0.1, SURF.beam, PART.plinth, mulc(WOOD, 0.55), 0.6);
        k.beam([W / 2 - 0.2, deck - 0.35, z], [-(W / 2 - 0.2), -0.6, z], 0.1, 0.1, SURF.beam, PART.plinth, mulc(WOOD, 0.55), 0.6);
      }
      for (const sx of [-1, 1]) k.beam([sx * (W / 2 + 0.05), deck - 0.15, -Lz / 2], [sx * (W / 2 + 0.05), deck - 0.15, Lz / 2], 0.1, 0.18, SURF.beam, PART.plinth, mulc(WOOD_GREY, 0.7), 0.8);
    }
    // deck planks across
    const planks = spec.lod === 0 ? Math.round(Lz / 0.3) : 1;
    for (let i = 0; i < planks; i++) {
      const z0 = -Lz / 2 + (i * Lz) / planks, z1 = -Lz / 2 + ((i + 1) * Lz) / planks - (spec.lod === 0 ? 0.02 : 0);
      k.box(-W / 2, deck - 0.08, z0, W / 2, deck, z1, SURF.planks, PART.plinth, mulc(WOOD_GREY, 0.85 + rng.float() * 0.3), { skip: ['bottom'] });
    }
  }
  if (spec.lod === 0) {
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) k.cylinder(sx * (W / 2 - 0.35), -Lz / 2 + 3 + i * (Lz - 4) / 2, deck, deck + 0.55, 0.14, 0.12, 8, SURF.iron, PART.prop, IRON, { top: true });
    crate(k, -W / 4, -Lz / 2 + 1.5, 0.8, 0.2, WOOD);
    crate(k, -W / 4 + 0.9, -Lz / 2 + 1.7, 0.7, -0.3, WOOD_GREY);
    barrel(k, W / 4, -Lz / 2 + 2.2, 0.32, 0.9, WOOD_DARK);
    // a moored rowing / sailing boat alongside
    k.push(W / 2 + 1.6, -0.35, Lz * 0.15, 0);
    boat(k, 2.0, 7.0, spec.era >= 4, rng);
    k.pop();
  }
  k.pop();
  return deck + 0.6;
}

/** a small wooden boat hull (and a mast for sailing eras) along local Z */
function boat(k: KitBuilder, beam: number, len: number, mast: boolean, rng: Rng): void {
  const rows = 7;
  const hull: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const z = -len / 2 + t * len;
    const w = beam / 2 * Math.sin(Math.PI * (0.06 + 0.88 * t)) ** 0.7;
    const sheer = 0.9 + 0.35 * Math.abs(t - 0.5) * 2;
    const row: number[] = [];
    for (let s = 0; s <= 6; s++) {
      const a = Math.PI * (s / 6);
      const x = -Math.cos(a) * w, y = sheer - Math.sin(a) * 0.95 * (0.3 + 0.7 * Math.sin(Math.PI * t));
      row.push(k.vert(x, y, z, -Math.cos(a), -Math.sin(a), 0, SURF.planks, PART.prop, mulc(WOOD, 0.9), 0.85));
    }
    hull.push(row);
  }
  for (let i = 0; i < rows; i++) for (let s = 0; s < 6; s++) {
    const a = hull[i][s], b = hull[i][s + 1], c = hull[i + 1][s], d = hull[i + 1][s + 1];
    k.tri(a, b, d); k.tri(a, d, c);
    k.tri(a, d, b); k.tri(a, c, d);
  }
  if (mast) {
    k.tube([[0, 0.2, len * 0.1], [0, 6.5, len * 0.1]], [0.09, 0.06], 6, SURF.bark, PART.prop, WOOD_DARK, {});
    k.quad([0, 1.6, len * 0.1 + 0.05], [0, 1.6, len * 0.1 - 2.6], [0, 6.0, len * 0.1 - 1.4], [0, 6.0, len * 0.1 + 0.05], SURF.cloth, PART.prop, [0.55, 0.5, 0.42], 0.9, rng.float());
    k.quad([0, 6.0, len * 0.1 + 0.05], [0, 6.0, len * 0.1 - 1.4], [0, 1.6, len * 0.1 - 2.6], [0, 1.6, len * 0.1 + 0.05], SURF.cloth, PART.prop, [0.45, 0.4, 0.33], 0.7, rng.float());
  }
}

/**
 * A vessel a person rides (AgentFlag.boat; the carried item names it): 'raft' — lashed logs with a steering oar;
 * 'boat' — a planked rowing boat with oars shipped; 'sail' — a larger hull with a mast and a sail. Local Z is the bow,
 * y = 0 the waterline; the occupant sits at the origin.
 */
export function vesselMesh(kind: 'raft' | 'boat' | 'sail', lod: number): BufferGeometry {
  const k = new KitBuilder();
  const rng = new Rng(kind === 'raft' ? 71 : kind === 'boat' ? 73 : 79);
  if (kind === 'raft') {
    const logs = 6, L = 3.4, r = 0.17;
    for (let i = 0; i < logs; i++) {
      const x = (i - (logs - 1) / 2) * r * 2.02;
      const z0 = -L / 2 + rng.float() * 0.25, z1 = L / 2 - rng.float() * 0.25;
      k.tube([[x, 0.02, z0], [x, 0.02, z1]], [r * (0.9 + rng.float() * 0.2), r * 0.85], lod === 0 ? 7 : 4, SURF.bark, PART.prop, mulc(WOOD, 0.8 + rng.float() * 0.4), { cap: true });
    }
    // cross-lashings and a steering oar over the stern
    for (const z of [-L * 0.32, L * 0.32]) k.beam([-logs * r, 0.2, z], [logs * r, 0.2, z], 0.08, 0.06, SURF.bark, PART.prop, WOOD_DARK, 0.9);
    k.beam([0.3, 0.25, -L / 2 + 0.3], [0.5, -0.25, -L / 2 - 1.1], 0.06, 0.06, SURF.beam, PART.prop, WOOD_DARK, 0.9);
    return k.build();
  }
  const big = kind === 'sail';
  // the hull sits ~0.55 of its depth below the waterline
  k.push(0, big ? -0.75 : -0.62, 0, 0);
  boat(k, big ? 2.4 : 1.5, big ? 7.5 : 4.2, big, rng);
  k.pop();
  if (!big && lod === 0) {
    // thwart and oars shipped along the gunwales
    k.box(-0.7, 0.05, -0.12, 0.7, 0.12, 0.12, SURF.planks, PART.prop, mulc(WOOD, 1.1), {});
    for (const sx of [-1, 1]) k.beam([sx * 0.62, 0.32, -1.4], [sx * 0.66, 0.34, 1.3], 0.05, 0.05, SURF.beam, PART.prop, WOOD_DARK, 0.9);
  }
  return k.build();
}

/** shipyard: a slipway with a hull on the stocks (ribs showing), a crane, sheds and timber stacks */
function shipyard(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const W = spec.w, D = spec.d;
  // the slip: an inclined ramp down to the water along +Z
  k.slab([-3, -3.5, D / 2 + 2], [3, -3.5, D / 2 + 2], [3, 0.4, -D / 2 + 4], [-3, 0.4, -D / 2 + 4], 0.5, SURF.planks, PART.plinth, WOOD_GREY, SURF.planks, WOOD_DARK);
  // the hull under construction: keel, stem and ribs
  const len = D * 0.6;
  k.push(0, 1.0, 0);
  k.beam([0, 0, -len / 2], [0, 0, len / 2], 0.35, 0.35, SURF.beam, PART.wall, WOOD, 0.8);
  k.beam([0, 0, len / 2], [0, 4.2, len / 2 + 1.5], 0.3, 0.3, SURF.beam, PART.wall, WOOD, 0.8);
  const ribs = spec.lod === 0 ? 14 : 7;
  for (let i = 0; i < ribs; i++) {
    const t = i / (ribs - 1);
    const z = -len / 2 + t * len;
    const w = 3.4 * Math.sin(Math.PI * (0.08 + 0.84 * t)) ** 0.6;
    const pts: V3[] = [];
    for (let s = 0; s <= 6; s++) { const a = Math.PI * (s / 6); pts.push([-Math.cos(a) * w, 3.6 - Math.sin(a) * 3.4 * (0.4 + 0.6 * Math.sin(Math.PI * t)) + 0.0, z]); }
    k.tube(pts, pts.map(() => 0.1), 4, SURF.beam, PART.wall, WOOD, {});
    // planking on the lower half of the aft ribs
    if (t < 0.55 && i < ribs - 1) {
      const z1 = -len / 2 + ((i + 1) / (ribs - 1)) * len;
      for (let s = 0; s < 3; s++) for (const sx of [-1, 1]) {
        const p0 = pts[sx > 0 ? 6 - s : s], p1 = pts[sx > 0 ? 5 - s : s + 1];
        k.quad([p0[0], p0[1], z], [p0[0], p0[1], z1], [p1[0], p1[1], z1], [p1[0], p1[1], z], SURF.planks, PART.wall, mulc(WOOD, 1.1), 0.8);
      }
    }
  }
  k.pop();
  // shear-legs crane
  if (spec.lod === 0) {
    k.tube([[-W / 2 + 1, -0.5, -2], [-1.0, 11, 0]], [0.18, 0.12], 6, SURF.bark, PART.frame, WOOD_DARK, {});
    k.tube([[-W / 2 + 1, -0.5, 2], [-1.0, 11, 0]], [0.18, 0.12], 6, SURF.bark, PART.frame, WOOD_DARK, {});
    k.tube([[-1.0, 11, 0], [-0.6, 4.5, 0.2]], [0.02, 0.02], 3, SURF.rope, PART.prop, [0.25, 0.2, 0.12], {});
    k.push(W / 2 - 1.5, 0, -D / 2 + 3, 0.2); woodPile(k, 5, 4, WOOD, rng); k.pop();
  }
  // a shed along one side
  k.push(-W / 2 + 2.2, 0, -D / 2 + 4.5, Math.PI / 2);
  const sp: BuildingSpec = { ...spec, w: 7, d: 4.4 };
  plinth(k, 7, 4.4, 0.2, SURF.rubble, L.plinthCol);
  boxWalls(k, { W: 7, D: 4.4, H: 2.8, T: 0.2, y0: 0.2, front: [{ x0: 1.5, x1: 4.5, y0: 0, y1: 2.4, kind: 'gap' }], back: [], left: [], right: [] }, { ...L.wall, surf: SURF.planks, col: WOOD_GREY }, rng);
  gableRoof(k, 7, 4.4, 0.2, 3.0, 0.5, 0.4, L.roof, { surf: SURF.planks, col: WOOD_GREY }, sp.lod);
  k.pop();
  return 11;
}

/** lighthouse: a tapering banded tower, a gallery, a glazed lantern with the beacon, a keeper's cottage */
function lighthouse(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const R = Math.min(spec.w, spec.d) * 0.38;
  const H = 21;
  const sides = spec.lod === 0 ? 16 : 10;
  const bands = spec.era >= 7 ? 4 : 1;
  for (let b = 0; b < bands; b++) {
    const y0 = b === 0 ? -3 : (H * b) / bands, y1 = (H * (b + 1)) / bands;
    const r0 = R - (R * 0.38) * (Math.max(0, y0) / H), r1 = R - (R * 0.38) * (y1 / H);
    const col: RGB = bands > 1 && b % 2 === 1 ? [0.42, 0.05, 0.03] : bands > 1 ? [0.66, 0.65, 0.62] : L.wall.col;
    k.cylinder(0, 0, y0, y1, r0, r1, sides, bands > 1 ? SURF.plaster : (L.wall.surf === SURF.brick ? SURF.brick : SURF.rubble), PART.wall, col, {});
  }
  const rt = R * 0.62;
  if (spec.lod === 0) for (let i = 0; i < 4; i++) {
    const y = 3 + i * 4.3, a = i * 1.7;
    const r = R - (R * 0.38) * (y / H);
    k.push(Math.cos(a) * (r + 0.02), y, Math.sin(a) * (r + 0.02), -a + Math.PI / 2);
    k.quad([-0.25, 0, 0], [0.25, 0, 0], [0.25, 1.0, 0], [-0.25, 1.0, 0], SURF.glass, PART.glass, GLASS, 1, rng.float());
    k.pop();
  }
  // gallery and railing
  k.cylinder(0, 0, H, H + 0.3, rt + 0.9, rt + 0.9, sides, SURF.ashlar, PART.trim, STONE, { top: true, bottom: true });
  if (spec.lod === 0) for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; k.cylinder(Math.cos(a) * (rt + 0.85), Math.sin(a) * (rt + 0.85), H + 0.3, H + 1.3, 0.03, 0.03, 3, SURF.iron, PART.trim, IRON, {}); }
  // lantern: glazed drum (the beacon glows: PART.beacon) and a dome cap
  k.cylinder(0, 0, H + 0.3, H + 3.0, rt * 0.75, rt * 0.75, 10, SURF.glass, PART.beacon, [0.6, 0.55, 0.4], {});
  k.lathe(0, 0, [[rt * 0.85, H + 3.0], [rt * 0.6, H + 3.7], [0.05, H + 4.4]], 10, SURF.metal, PART.roof, [0.05, 0.08, 0.07], 0.9, 1);
  em.push({ p: [0, H + 1.6, 0], kind: EMIT.beacon, size: rt });
  // keeper's cottage (at every LOD: it popped in and out with the tower's detail, and the far mesh casts the near
  // building's shadow)
  {
    k.push(0, 0, -R - 3.2);
    const cs: BuildingSpec = { ...spec, w: 5, d: 4 };
    house(k, cs, L, { floors: 1, floorH: 2.6, T: 0.4, pitch: 0.7, over: 0.3, roof: 'gable', winW: 0.8, winH: 1.0, spacing: 1.8, chimneys: 1, corners: false, frame: false, porch: false, jetty: 0, parapet: false, vigas: false, plinthH: 0.25, doorW: 0.9, doorH: 1.95, cornice: false, dormers: false }, rng, []);
    k.pop();
  }
  return H + 4.4;
}

/** observatory: a drum with a slotted dome (or an early stone platform with sighting stones) */
function observatory(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const S = Math.min(spec.w, spec.d);
  if (spec.era <= 5) {
    // an open stone platform with a gnomon and sighting stones
    k.box(-S / 2, -2, -S / 2, S / 2, 1.6, S / 2, SURF.ashlar, PART.plinth, mulc(STONE, 1.15), { skip: ['bottom'] });
    k.slab([-1.2, -0.3, S / 2 + 3.5], [1.2, -0.3, S / 2 + 3.5], [1.2, 1.6, S / 2], [-1.2, 1.6, S / 2], 0.4, SURF.ashlar, PART.plinth, mulc(STONE, 1.1), SURF.ashlar, STONE);
    k.box(-0.3, 1.6, -0.3, 0.3, 6.0, 0.3, SURF.ashlar, PART.wall, mulc(STONE, 1.2), {});
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.box(Math.cos(a) * (S / 2 - 0.6) - 0.2, 1.6, Math.sin(a) * (S / 2 - 0.6) - 0.2, Math.cos(a) * (S / 2 - 0.6) + 0.2, 2.6, Math.sin(a) * (S / 2 - 0.6) + 0.2, SURF.ashlar, PART.trim, STONE, {}); }
    return 6;
  }
  const R = S * 0.42, H = 5;
  k.cylinder(0, 0, -2, H, R, R, spec.lod === 0 ? 20 : 10, L.wall.surf === SURF.brick ? SURF.brick : SURF.ashlar, PART.wall, L.wall.col, {});
  k.push(0, 0, R - 0.05);
  k.quad([-0.6, 0, 0.06], [0.6, 0, 0.06], [0.6, 2.2, 0.06], [-0.6, 2.2, 0.06], SURF.planks, PART.door, WOOD_DARK, 0.6);
  k.pop();
  // the dome with its observing slit (a dark strip) and a telescope peeking out
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const t = (i / 10) * Math.PI / 2; prof.push([R * 1.02 * Math.cos(t) + 0.01, H + R * Math.sin(t)]); }
  k.lathe(0, 0, prof, spec.lod === 0 ? 24 : 12, SURF.metal, PART.roof, [0.5, 0.52, 0.53], 0.85, 1);
  k.slab([-0.5, H + R * 0.2, R * 1.03], [0.5, H + R * 0.2, R * 1.03], [0.5, H + R + 0.05, 0.3], [-0.5, H + R + 0.05, 0.3], 0.05, SURF.glass, PART.roof, [0.01, 0.01, 0.012], SURF.metal, [0.2, 0.2, 0.2]);
  if (spec.lod === 0) k.tube([[0, H + R * 0.4, 0], [0, H + R * 1.1, R * 0.9]], [0.25, 0.2], 10, SURF.metal, PART.prop, [0.06, 0.06, 0.07], { cap: true });
  void rng;
  return H + R;
}

/** factory: brick sheds with sawtooth north-light roofs, tall stacks (smoke), a water tower and a yard */
function factory(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = spec.w, D = spec.d;
  const H = 6;
  const brick = L.wall.surf === SURF.concrete ? SURF.concrete : SURF.brick;
  const col: RGB = brick === SURF.brick ? [0.34, 0.12, 0.065] : CONCRETE;
  const look: WallLook = { ...L.wall, surf: brick, col, shutters: null, mullions: true, frameCol: [0.05, 0.05, 0.05] };
  plinth(k, W, D, 0.3, SURF.concrete, mulc(CONCRETE, 0.8));
  boxWalls(k, {
    W, D, H, T: 0.5, y0: 0.3,
    front: [{ x0: W / 2 - 1.8, x1: W / 2 + 1.8, y0: 0, y1: 4.2, kind: 'door' }, ...windowRow(W, 1.4, [1.4, 3.4], 2.6, 1.2, [W / 2 - 2.2, W / 2 + 2.2])],
    back: windowRow(W, 1.4, [1.4, 3.4], 2.6, 1.2, null), left: windowRow(D - 1, 1.4, [1.4, 3.4], 2.6, 1.0, null), right: windowRow(D - 1, 1.4, [1.4, 3.4], 2.6, 1.0, null),
  }, look, rng);
  // sawtooth roof: north-facing glazing (PART.glass glows at night), south slopes of slate / metal
  const teeth = Math.max(2, Math.round(D / 4));
  const tz = D / teeth;
  const y0 = 0.3 + H;
  for (let i = 0; i < teeth; i++) {
    const z0 = -D / 2 + i * tz, z1 = z0 + tz;
    k.slab([-W / 2 - 0.2, y0, z1], [W / 2 + 0.2, y0, z1], [W / 2 + 0.2, y0 + 2.2, z0 + 0.2], [-W / 2 - 0.2, y0 + 2.2, z0 + 0.2], 0.12, spec.era >= 9 ? SURF.metal : SURF.slate, PART.roof, spec.era >= 9 ? [0.2, 0.2, 0.2] : SLATE, SURF.planks, WOOD_DARK);
    k.quad([W / 2, y0, z0 + 0.05], [-W / 2, y0, z0 + 0.05], [-W / 2, y0 + 2.1, z0 + 0.2], [W / 2, y0 + 2.1, z0 + 0.2], SURF.glass, PART.glass, GLASS, 1, rng.float());
    // gable triangles of each tooth
    for (const sx of [-1, 1]) {
      const x = sx * W / 2;
      const a: V3 = [x, y0, z1], b: V3 = [x, y0, z0 + 0.2], c: V3 = [x, y0 + 2.2, z0 + 0.2];
      if (sx > 0) k.triangle(a, b, c, brick, PART.wall, col, 0.9); else k.triangle(b, a, c, brick, PART.wall, col, 0.9);
    }
  }
  // stacks
  const stacks = W > 18 ? 2 : 1;
  for (let s = 0; s < stacks; s++) {
    const x = stacks === 1 ? W / 2 + 2.2 : (s === 0 ? -W / 2 - 2 : W / 2 + 2), z = -D / 4;
    const h = 24 + rng.float() * 6;
    k.cylinder(x, z, -2, h, 1.35, 0.85, spec.lod === 0 ? 12 : 8, SURF.brick, PART.trim, [0.3, 0.1, 0.05], {});
    k.cylinder(x, z, h, h + 0.7, 1.05, 1.05, spec.lod === 0 ? 12 : 8, SURF.brick, PART.trim, [0.15, 0.06, 0.035], { top: true, topSurf: SURF.earth, topCol: ASH });
    em.push({ p: [x, h + 0.9, z], kind: EMIT.stack, size: 1.0 });
  }
  if (spec.lod === 0) {
    // water tower on legs
    const tx = -W / 2 + 2, tzz = D / 2 + 3;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.beam([tx + sx * 1.3, -0.5, tzz + sz * 1.3], [tx + sx * 0.9, 9, tzz + sz * 0.9], 0.18, 0.18, SURF.iron, PART.frame, IRON, 0.8);
    k.cylinder(tx, tzz, 9, 11.5, 1.6, 1.6, 12, SURF.planks, PART.prop, [0.18, 0.12, 0.08], { top: false, bottom: true });
    k.lathe(tx, tzz, [[1.7, 11.5], [0.9, 12.3], [0.05, 12.6]], 12, SURF.metal, PART.prop, IRON, 0.8, 1);
    for (let i = 0; i < 4; i++) crate(k, W / 2 - 1 - i * 1.1, D / 2 + 1.5 + (i % 2) * 0.6, 0.9, i * 0.3, WOOD_GREY);
    for (let i = 0; i < 3; i++) barrel(k, -W / 4 + i * 0.75, D / 2 + 1.4, 0.34, 0.95, [0.1, 0.12, 0.13]);
  }
  em.push({ p: [W / 2 - 1, 0.3 + H + 2.5, 0], kind: EMIT.smoke, size: 0.5 });
  return 30;
}

/** radio mast: a guyed steel lattice mast with blinking red lights, and a hut */
function radio(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const H = 42;
  const w = 1.2;
  const sides = 3;
  const corner = (i: number, y: number): V3 => { const a = (i / sides) * Math.PI * 2; const r = w * (1 - 0.35 * y / H); return [Math.cos(a) * r, y, Math.sin(a) * r]; };
  for (let i = 0; i < sides; i++) k.beam(corner(i, -1), corner(i, H), 0.12, 0.12, SURF.iron, PART.frame, [0.35, 0.08, 0.05], 0.9);
  const step = spec.lod === 0 ? 2.0 : 6.0;
  for (let y = 0; y < H; y += step) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      k.beam(corner(i, y), corner(j, y + step), 0.06, 0.06, SURF.iron, PART.frame, (Math.floor(y / 6) % 2) ? [0.55, 0.55, 0.55] : [0.4, 0.07, 0.04], 0.9);
      if (spec.lod === 0) k.beam(corner(i, y), corner(j, y), 0.05, 0.05, SURF.iron, PART.frame, [0.45, 0.45, 0.45], 0.9);
    }
  }
  // guy wires
  if (spec.lod === 0) for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    for (const y of [H * 0.45, H * 0.9]) k.tube([[Math.cos(a) * 22, 0, Math.sin(a) * 22], [Math.cos(a) * 0.6, y, Math.sin(a) * 0.6]], [0.025, 0.02], 3, SURF.iron, PART.frame, [0.25, 0.25, 0.25], {});
  }
  for (const y of [H * 0.5, H + 0.3]) {
    k.lathe(0, 0, [[0.3, y], [0.32, y + 0.25], [0.02, y + 0.5]], 8, SURF.glass, PART.lamp, [0.5, 0.05, 0.03], 1, 1, 0.5);
    em.push({ p: [0, y + 0.25, 0], kind: EMIT.blink, size: 0.4 });
  }
  // equipment hut
  k.push(5, 0, 0);
  plinth(k, 4, 3.4, 0.2, SURF.concrete, CONCRETE);
  boxWalls(k, { W: 4, D: 3.4, H: 2.6, T: 0.25, y0: 0.2, front: [{ x0: 1.5, x1: 2.4, y0: 0, y1: 2.0, kind: 'door' }, { x0: 2.8, x1: 3.5, y0: 1.0, y1: 1.8, kind: 'window' }], back: [], left: [], right: [] }, { ...L.wall, surf: SURF.concrete, col: CONCRETE, shutters: null }, rng);
  k.quad([-2.1, 2.82, 1.8], [2.1, 2.82, 1.8], [2.1, 2.82, -1.8], [-2.1, 2.82, -1.8], SURF.concrete, PART.roof, mulc(CONCRETE, 0.8), 0.9);
  k.pop();
  return H + 1;
}

/** launchpad: a concrete pad with a flame trench, a lattice service gantry with arms, fuel tanks */
function launchpad(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const S = Math.max(spec.w, spec.d);
  k.box(-S / 2, -3, -S / 2, S / 2, 0.5, S / 2, SURF.concrete, PART.plinth, CONCRETE, { skip: ['bottom'] });
  // flame trench (a dark slot)
  k.box(-2.2, 0.0, -S / 2 - 0.01, 2.2, 0.51, 4.0, SURF.concrete, PART.prop, [0.03, 0.03, 0.03], { skip: ['bottom'] });
  // gantry tower
  const H = 34, gx = -6.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.beam([gx + sx * 1.6, 0.5, sz * 1.6], [gx + sx * 1.6, H, sz * 1.6], 0.3, 0.3, SURF.iron, PART.frame, [0.45, 0.12, 0.06], 0.9);
  const step = spec.lod === 0 ? 2.5 : 7;
  for (let y = 0.5; y < H; y += step) {
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2;
      const c = (t: number, yy: number): V3 => {
        const p0 = [Math.cos(a) * 1.6 - Math.sin(a) * 1.6, Math.sin(a) * 1.6 + Math.cos(a) * 1.6];
        const p1 = [Math.cos(a + Math.PI / 2) * 1.6 - Math.sin(a + Math.PI / 2) * 1.6, Math.sin(a + Math.PI / 2) * 1.6 + Math.cos(a + Math.PI / 2) * 1.6];
        return [gx + p0[0] + (p1[0] - p0[0]) * t, yy, p0[1] + (p1[1] - p0[1]) * t];
      };
      k.beam(c(0, y), c(1, y + step), 0.12, 0.12, SURF.iron, PART.frame, [0.4, 0.4, 0.42], 0.9);
      if (spec.lod === 0) k.beam(c(0, y), c(1, y), 0.12, 0.12, SURF.iron, PART.frame, [0.4, 0.4, 0.42], 0.9);
    }
  }
  // service arms toward the pad centre
  for (const y of [12, 22, 30]) k.box(gx + 1.6, y, -0.6, -1.4, y + 0.8, 0.6, SURF.iron, PART.frame, [0.4, 0.4, 0.42], {});
  // fuel tanks
  if (spec.lod === 0) for (let i = 0; i < 2; i++) {
    const x = S / 2 - 4, z = -S / 2 + 5 + i * 6;
    k.lathe(x, z, [[0.01, 0.5], [2.4, 0.9], [2.6, 2.6], [2.4, 4.2], [0.01, 4.6]], 16, SURF.metal, PART.prop, [0.62, 0.62, 0.6], 0.8, 1);
  }
  em.push({ p: [gx, H + 0.5, 0], kind: EMIT.blink, size: 0.4 });
  void rng;
  return H + 1;
}

// ── additive (render lane, phase 4b: ships): the airship mast, the habitat dome and the star gate (buildings.json) ──

/** a lattice tower of four tapering legs with X bracing between y0 and y1 (half-widths w0 at the foot, w1 at the head) */
function latticeTower(k: KitBuilder, y0: number, y1: number, w0: number, w1: number, step: number, leg: number, brace: number, col: RGB): void {
  const at = (y: number) => w0 + (w1 - w0) * ((y - y0) / Math.max(1e-6, y1 - y0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.beam([sx * w0, y0, sz * w0], [sx * w1, y1, sz * w1], leg, leg, SURF.iron, PART.frame, col, 0.9);
  for (let y = y0; y < y1 - 1e-3; y += step) {
    const ya = y, yb = Math.min(y1, y + step);
    const a = at(ya), b = at(yb);
    const faces: [V3, V3, V3, V3][] = [
      [[-a, ya, a], [a, ya, a], [-b, yb, b], [b, yb, b]], [[a, ya, a], [a, ya, -a], [b, yb, b], [b, yb, -b]],
      [[a, ya, -a], [-a, ya, -a], [b, yb, -b], [-b, yb, -b]], [[-a, ya, -a], [-a, ya, a], [-b, yb, -b], [-b, yb, b]],
    ];
    for (const [p0, p1, q0, q1] of faces) {
      k.beam(p0, q1, brace, brace, SURF.iron, PART.frame, col, 0.9);
      k.beam(p1, q0, brace, brace, SURF.iron, PART.frame, col, 0.9);
      k.beam(q0, q1, brace, brace, SURF.iron, PART.frame, col, 0.9);
    }
  }
}

/**
 * airship mast: a 30 m steel lattice tower on a concrete footing, a winch house and a stair at its foot, a railed
 * platform and the mooring cone at its head (the airship's nose rides it: render/life/ships.ts moors at 30.5 m), a red
 * beacon on top and guy cables to anchor blocks
 */
function airshipMast(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const H = 29.6;
  const steel: RGB = [0.24, 0.25, 0.26];
  k.box(-3.4, -1.2, -3.4, 3.4, 0.4, 3.4, SURF.concrete, PART.plinth, CONCRETE, { skip: ['bottom'] });
  latticeTower(k, 0.4, H, 2.6, 0.9, spec.lod === 0 ? 2.6 : 7, 0.3, 0.1, steel);
  // the head: a railed platform and the mooring cone with its swivel
  k.box(-1.8, H, -1.8, 1.8, H + 0.25, 1.8, SURF.iron, PART.frame, steel, {});
  if (spec.lod === 0) for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const c = Math.cos(a), s2 = Math.sin(a);
    k.beam([c * 1.8 - s2 * 1.8, H + 1.1, s2 * 1.8 + c * 1.8], [c * 1.8 + s2 * 1.8, H + 1.1, s2 * 1.8 - c * 1.8], 0.06, 0.06, SURF.iron, PART.frame, steel, 0.9);
  }
  k.cylinder(0, 0, H + 0.25, H + 0.75, 0.55, 0.45, 12, SURF.metal, PART.trim, [0.5, 0.38, 0.16], { top: false });
  k.lathe(0, 0, [[0.45, H + 0.75], [0.3, H + 1.0], [0.06, H + 1.25]], 12, SURF.metal, PART.trim, [0.55, 0.42, 0.18], 1, 1);
  // a zig-zag stair up the first flights and a winch house at the foot
  if (spec.lod === 0) for (let i = 0; i < 4; i++) {
    const y = 0.4 + i * 3.2;
    k.beam([2.9, y, -2.0 + (i % 2) * 4.0], [2.9, y + 3.2, 2.0 - (i % 2) * 4.0], 0.9, 0.08, SURF.iron, PART.frame, steel, 0.9);
  }
  k.box(-6.2, 0.0, -2.0, -3.6, 2.6, 2.0, SURF.metal, PART.wall, [0.3, 0.32, 0.3], { skip: ['bottom'] });
  k.box(-6.35, 2.6, -2.15, -3.45, 2.8, 2.15, SURF.metal, PART.roof, [0.2, 0.21, 0.2], {});
  // guy cables to anchor blocks
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 11, z = Math.sin(a) * 11;
    k.box(x - 0.6, -0.4, z - 0.6, x + 0.6, 0.5, z + 0.6, SURF.concrete, PART.plinth, CONCRETE, {});
    k.beam([x, 0.5, z], [Math.cos(a) * 1.2, H * 0.72, Math.sin(a) * 1.2], 0.04, 0.04, SURF.rope, PART.frame, [0.05, 0.05, 0.05], 0.9);
  }
  em.push({ p: [0, H + 1.4, 0], kind: EMIT.blink, size: 0.35 });
  void rng;
  return H + 1.3;
}

/**
 * habitat dome: a glazed geodesic dome (glass panes on a lattice of struts) on a concrete ring wall, an airlock tunnel
 * with a hatch, solar panels and a radiator beside it; gardens and cabins inside (seen through the glass), lit at night
 */
function habitatDome(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const R = Math.max(5, Math.min(spec.w, spec.d) * 0.45), H = R * 0.82;
  const steel: RGB = [0.62, 0.63, 0.62];
  const lod0 = spec.lod === 0;
  k.cylinder(0, 0, -0.6, 0.9, R + 0.35, R + 0.25, 32, SURF.concrete, PART.plinth, CONCRETE, { top: true, topCol: [0.3, 0.29, 0.27] });
  // the glazing: a lathe of glass a hair inside the struts
  const prof: [number, number][] = [];
  const rows = lod0 ? 8 : 4;
  for (let i = 0; i <= rows; i++) {
    const a = (i / rows) * (Math.PI / 2);
    prof.push([Math.max(0.05, R * Math.cos(a)), 0.9 + H * Math.sin(a)]);
  }
  k.lathe(0, 0, prof, lod0 ? 32 : 16, SURF.glass, PART.glass, GLASS, 1, 1);
  // geodesic struts: rings, meridians and diagonals
  const n = lod0 ? 16 : 8;
  const P = (i: number, j: number): V3 => {
    const a = (i / rows) * (Math.PI / 2), b = (j / n) * Math.PI * 2 + (i % 2) * (Math.PI / n);
    const r = R * Math.cos(a) + 0.04, y = 0.9 + H * Math.sin(a) + 0.03;
    return [Math.cos(b) * r, y, Math.sin(b) * r];
  };
  for (let i = 0; i < rows; i++) for (let j = 0; j < n; j++) {
    k.beam(P(i, j), P(i, j + 1), 0.09, 0.09, SURF.metal, PART.frame, steel, 0.95);
    k.beam(P(i, j), P(i + 1, j), 0.09, 0.09, SURF.metal, PART.frame, steel, 0.95);
    if (lod0) k.beam(P(i, j), P(i + 1, j + 1), 0.07, 0.07, SURF.metal, PART.frame, steel, 0.95);
  }
  // inside: garden beds and two cabins
  if (lod0) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng.float();
      const r = R * 0.55;
      k.box(Math.cos(a) * r - 0.9, 0.9, Math.sin(a) * r - 0.5, Math.cos(a) * r + 0.9, 1.4, Math.sin(a) * r + 0.5, SURF.earth, PART.prop, [0.07, 0.12, 0.04], {});
    }
    k.box(-1.6, 0.9, -1.2, 1.6, 3.4, 1.2, SURF.plaster, PART.wall, [0.62, 0.6, 0.55], { skip: ['bottom'] });
  }
  // the airlock: a tunnel with a hatch on its end
  k.push(0, 0, R + 1.6, 0);
  k.box(-1.1, 0.0, -1.8, 1.1, 2.6, 1.6, SURF.metal, PART.wall, [0.55, 0.56, 0.55], { skip: ['bottom'] });
  k.box(-0.55, 0.1, 1.61, 0.55, 2.2, 1.66, SURF.metal, PART.door, [0.25, 0.27, 0.3], {});
  k.box(-0.3, 1.6, 1.62, 0.3, 2.0, 1.68, SURF.glass, PART.glass, GLASS, {});
  k.pop();
  // solar panels on a rack and a radiator
  if (lod0) for (let i = 0; i < 3; i++) {
    const x = -R - 3.2, z = -3.0 + i * 3.0;
    k.beam([x, 0.0, z], [x, 1.1, z], 0.1, 0.1, SURF.metal, PART.frame, steel, 0.9);
    k.slab([x - 1.2, 1.5, z + 1.0], [x + 1.2, 1.0, z + 1.0], [x + 1.2, 1.0, z - 1.0], [x - 1.2, 1.5, z - 1.0], 0.05, SURF.glass, PART.prop, [0.02, 0.04, 0.12], SURF.metal, steel, 1);
  }
  em.push({ p: [0, 0.9 + H + 0.4, 0], kind: EMIT.blink, size: 0.18 });
  return 0.9 + H;
}

/**
 * star gate: a ring of dark metal and glowing chevrons standing on a stepped ramp, braced by two pylons, cables to a
 * power house. The ring's plane is local XY (facing ±Z), centre at GATE_CENTRE_Y = 14.2 m with radius 10.6 m (the event
 * horizon of render/gen/shipgen.ts fills it).
 */
function starGate(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const C = 14.2, Rr = 10.6;
  const lod0 = spec.lod === 0;
  const dark: RGB = [0.07, 0.07, 0.08];
  // the ramp: a stepped platform up to the ring's foot, from both sides
  k.box(-7, -1.0, -9, 7, 2.6, 9, SURF.concrete, PART.plinth, CONCRETE, { skip: ['bottom'] });
  for (let i = 0; i < 6; i++) {
    const y = 2.6 - i * 0.45;
    k.box(-5, -1.0, 9 + i * 0.9, 5, y, 9.9 + i * 0.9, SURF.concrete, PART.plinth, mulc(CONCRETE, 0.95), { skip: ['bottom'] });
    k.box(-5, -1.0, -9.9 - i * 0.9, 5, y, -9 - i * 0.9, SURF.concrete, PART.plinth, mulc(CONCRETE, 0.95), { skip: ['bottom'] });
  }
  // the ring: an outer band, an inner track, chevrons
  const ring = (r: number): V3[] => Array.from({ length: (lod0 ? 72 : 36) + 1 }, (_, i) => { const a = (i / (lod0 ? 72 : 36)) * Math.PI * 2; return [Math.cos(a) * r, C + Math.sin(a) * r, 0] as V3; });
  k.tube(ring(Rr + 0.95), new Array((lod0 ? 72 : 36) + 1).fill(0.95), lod0 ? 12 : 6, SURF.metal, PART.wall, dark, {});
  k.tube(ring(Rr + 0.15), new Array((lod0 ? 72 : 36) + 1).fill(0.32), lod0 ? 8 : 4, SURF.metal, PART.trim, [0.25, 0.24, 0.22], {});
  for (let i = 0; i < 9; i++) {
    const a = Math.PI / 2 + (i / 9) * Math.PI * 2;
    const c = Math.cos(a), s2 = Math.sin(a);
    const cx = c * (Rr + 1.6), cy = C + s2 * (Rr + 1.6);
    // a chevron: a wedge on the ring with a lamp (glows: beacon part)
    k.push(0, 0, 0, 0);
    const t: V3 = [-s2, c, 0];
    const p0: V3 = [cx - t[0] * 1.0, cy - t[1] * 1.0, -1.4], p1: V3 = [cx + t[0] * 1.0, cy + t[1] * 1.0, -1.4];
    const p2: V3 = [cx + t[0] * 1.0, cy + t[1] * 1.0, 1.4], p3: V3 = [cx - t[0] * 1.0, cy - t[1] * 1.0, 1.4];
    k.slab(p3, p2, p1, p0, 0.5, SURF.metal, PART.trim, [0.32, 0.27, 0.18], SURF.metal, dark, 1);
    k.box(cx - 0.3, cy - 0.3, 1.45, cx + 0.3, cy + 0.3, 1.6, SURF.glass, PART.beacon, [0.6, 0.3, 0.1], {});
    k.box(cx - 0.3, cy - 0.3, -1.6, cx + 0.3, cy + 0.3, -1.45, SURF.glass, PART.beacon, [0.6, 0.3, 0.1], {});
    k.pop();
  }
  // pylons bracing the ring
  for (const sx of [-1, 1]) {
    k.box(sx * 8.4 - 1.0, 2.6, -1.2, sx * 8.4 + 1.0, C - 4, 1.2, SURF.concrete, PART.wall, mulc(CONCRETE, 0.85), {});
    k.beam([sx * 8.4, C - 4, 0], [sx * (Rr + 0.9) * 0.8, C - (Rr + 0.9) * 0.6, 0], 1.2, 1.2, SURF.metal, PART.frame, dark, 0.9);
  }
  // the power house and its cables
  if (lod0) {
    k.box(10, 0, -4, 16, 4.2, 4, SURF.concrete, PART.wall, [0.4, 0.4, 0.38], { skip: ['bottom'] });
    for (const z of [-1.2, 0, 1.2]) k.tube([[10, 0.6, z], [8, 0.2, z], [6.5, 1.8, z * 0.5], [5.2, 2.7, z * 0.3]], [0.18, 0.18, 0.18, 0.18], 6, SURF.rope, PART.frame, [0.04, 0.04, 0.04], {});
  }
  em.push({ p: [0, C + Rr + 2.2, 0], kind: EMIT.blink, size: 0.35 });
  void rng;
  return C + Rr + 2;
}

/** livestock pen: rail fence with a gate gap, a trough and a lean shelter */
function pen(k: KitBuilder, spec: BuildingSpec, rng: Rng): number {
  const W = spec.w, D = spec.d;
  fence(k, [[-W / 2, D / 2], [-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [1.2, D / 2]], 1.15, WOOD_GREY, -1, spec.lod);
  fence(k, [[-1.2, D / 2], [-W / 2, D / 2]], 1.15, WOOD_GREY, -1, spec.lod);
  if (spec.lod === 0) {
    k.box(-1.2, 0, -D / 2 + 0.8, 1.2, 0.5, -D / 2 + 1.3, SURF.planks, PART.prop, WOOD, { skip: ['bottom'], topSurf: SURF.glass, topCol: [0.02, 0.03, 0.03] });
    // lean-to shelter in a corner
    for (const x of [W / 2 - 3.5, W / 2 - 0.3]) k.cylinder(x, -D / 2 + 2.5, 0, 1.9, 0.06, 0.05, 5, SURF.bark, PART.frame, WOOD, {});
    k.slab([W / 2 - 3.8, 1.9, -D / 2 + 2.7], [W / 2 - 0.1, 1.9, -D / 2 + 2.7], [W / 2 - 0.1, 2.4, -D / 2 - 0.1], [W / 2 - 3.8, 2.4, -D / 2 - 0.1], 0.25, SURF.thatch, PART.roof, THATCH, SURF.thatch, mulc(THATCH, 0.5));
    // a straw stack
    k.lathe(-W / 2 + 2, -D / 2 + 2, [[1.0, 0], [1.1, 0.6], [0.8, 1.4], [0.05, 1.9]], 10, SURF.thatch, PART.prop, mulc(THATCH, 1.15), 0.7, 1);
  }
  void rng;
  return 2.4;
}

/** well: a stone ring with a little roof on two posts, a winch and a bucket */
function well(k: KitBuilder, spec: BuildingSpec, rng: Rng): number {
  k.cylinder(0, 0, -0.5, 0.85, 0.9, 0.9, 14, SURF.rubble, PART.wall, STONE, {});
  k.cylinder(0, 0, -0.5, 0.86, 0.62, 0.62, 14, SURF.earth, PART.wall, INTERIOR, {});
  k.cylinder(0, 0, 0.85, 0.95, 0.95, 0.95, 14, SURF.ashlar, PART.trim, mulc(STONE, 1.2), { top: false });
  k.quad([-0.62, 0.3, 0.62], [0.62, 0.3, 0.62], [0.62, 0.3, -0.62], [-0.62, 0.3, -0.62], SURF.glass, PART.prop, [0.01, 0.02, 0.02], 0.4);
  for (const sx of [-1, 1]) k.box(sx * 0.95 - 0.08, 0.5, -0.08, sx * 0.95 + 0.08, 2.4, 0.08, SURF.beam, PART.frame, WOOD, {});
  if (spec.lod === 0) {
    k.tube([[-1.0, 1.6, 0], [1.0, 1.6, 0]], [0.08, 0.08], 6, SURF.bark, PART.frame, WOOD_DARK, {});
    k.lathe(0.25, 0, [[0.14, 1.0], [0.17, 1.3], [0.16, 1.32]], 7, SURF.planks, PART.prop, WOOD, 0.7, 1);
  }
  k.slab([-1.2, 2.2, 0.8], [1.2, 2.2, 0.8], [1.2, 2.75, 0], [-1.2, 2.75, 0], 0.08, SURF.shingle, PART.roof, SHINGLE, SURF.planks, WOOD_DARK);
  k.slab([1.2, 2.2, -0.8], [-1.2, 2.2, -0.8], [-1.2, 2.75, 0], [1.2, 2.75, 0], 0.08, SURF.shingle, PART.roof, SHINGLE, SURF.planks, WOOD_DARK);
  void rng;
  return 2.8;
}

/** hive mound: an organic cluster of resin / earth spires with glowing openings */
function hiveMound(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng): number {
  const R = Math.min(spec.w, spec.d) * 0.45;
  const col = L.wall.surf === SURF.chitin ? mixc(L.wall.col, [0.32, 0.2, 0.08], 0.4) : [0.36, 0.22, 0.12] as RGB;
  let top = 0;
  const spires = spec.lod === 0 ? 7 : 4;
  for (let i = 0; i < spires; i++) {
    const a = (i / spires) * Math.PI * 2 + rng.float();
    const d = i === 0 ? 0 : R * (0.35 + rng.float() * 0.45);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const h = (i === 0 ? 1 : 0.45 + rng.float() * 0.35) * R * 1.9;
    const r = (i === 0 ? 0.55 : 0.28 + rng.float() * 0.15) * R;
    const prof: [number, number][] = [];
    for (let j = 0; j <= 7; j++) {
      const t = j / 7;
      prof.push([r * (1 - Math.pow(t, 1.6)) * (1 + 0.12 * Math.sin(t * 17 + i)) + 0.02, -0.5 + (h + 0.5) * t]);
    }
    k.lathe(cx, cz, prof, spec.lod === 0 ? 11 : 7, SURF.chitin, PART.wall, mulc(col, 0.85 + rng.float() * 0.3), 0.6, 1);
    top = Math.max(top, h);
    // openings near the base (they glow faintly at night: PART.glass)
    if (spec.lod === 0) {
      const oa = a + Math.PI;
      const ox = cx + Math.cos(oa) * r * 0.82, oz = cz + Math.sin(oa) * r * 0.82;
      k.push(ox, 0.4, oz, -oa + Math.PI / 2);
      k.quad([-0.35, 0, 0.05], [0.35, 0, 0.05], [0.25, 0.7, 0.0], [-0.25, 0.7, 0.0], SURF.glass, PART.glass, [0.05, 0.03, 0.01], 1, rng.float());
      k.pop();
    }
  }
  return top;
}


/** snow house: a dome of ice blocks (the shader draws the block courses) with an entrance tunnel */
function igloo(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const R = Math.min(spec.w, spec.d) * 0.42;
  const col: RGB = [0.62, 0.7, 0.76];
  const prof: [number, number][] = [];
  for (let i = 0; i <= 9; i++) { const t = (i / 9) * Math.PI / 2; prof.push([R * Math.cos(t) + 0.02, -0.3 + (R * 0.95 + 0.3) * Math.sin(t)]); }
  k.lathe(0, 0, prof, spec.lod === 0 ? 18 : 10, SURF.ice, PART.wall, col, 0.75, 1);
  // tunnel: a half-cylinder of blocks toward +Z with a dark mouth
  k.push(0, 0, R * 0.75);
  const tr = 0.62, tl = 1.5;
  const ring = (z: number) => { const ids: number[] = []; for (let s = 0; s <= 6; s++) { const a = Math.PI * (s / 6); ids.push(k.vert(Math.cos(a) * tr, Math.sin(a) * tr * 1.1, z, Math.cos(a), Math.sin(a), 0, SURF.ice, PART.wall, col, 0.85)); } return ids; };
  const r0 = ring(0), r1 = ring(tl);
  for (let s = 0; s < 6; s++) { k.tri(r0[s], r1[s], r1[s + 1]); k.tri(r0[s], r1[s + 1], r0[s + 1]); }
  k.quad([-tr * 0.8, 0, tl + 0.01], [tr * 0.8, 0, tl + 0.01], [tr * 0.6, tr * 0.95, tl + 0.01], [-tr * 0.6, tr * 0.95, tl + 0.01], SURF.earth, PART.door, [0.02, 0.025, 0.03], 0.4);
  k.pop();
  // a vent: warm light leaks from it at night (glass part)
  k.lathe(0, 0, [[0.18, R * 0.95 - 0.08], [0.12, R * 0.95 + 0.05]], 6, SURF.glass, PART.glass, [0.05, 0.04, 0.03], 1, 1, rng.float());
  em.push({ p: [0, R * 0.95 + 0.1, 0], kind: EMIT.smoke, size: 0.15 });
  return R * 0.95;
}

/** covered store pit: a low earth ring with a lid of poles and hides / planks */
function storePit(k: KitBuilder, spec: BuildingSpec, rng: Rng): number {
  const R = Math.min(spec.w, spec.d) * 0.42;
  k.lathe(0, 0, [[R + 0.4, -0.3], [R + 0.2, 0.25], [R, 0.35], [R - 0.15, 0.3]], 14, SURF.earth, PART.wall, [0.17, 0.12, 0.08], 0.6, 0.9);
  const n = spec.lod === 0 ? 9 : 5;
  for (let i = 0; i < n; i++) {
    const x = -R + (2 * R * (i + 0.5)) / n;
    k.tube([[x, 0.36, -R * 1.05], [x + (rng.float() - 0.5) * 0.2, 0.4, R * 1.05]], [0.06, 0.055], 5, SURF.bark, PART.frame, WOOD_GREY);
  }
  k.slab([-R * 0.8, 0.46, R * 0.75], [R * 0.85, 0.47, R * 0.7], [R * 0.75, 0.5, -R * 0.8], [-R * 0.7, 0.48, -R * 0.75], 0.03, SURF.hide, PART.roof, HIDE, SURF.hide, mulc(HIDE, 0.5));
  if (spec.lod === 0) for (let i = 0; i < 4; i++) { k.push((rng.float() - 0.5) * R, 0.5, (rng.float() - 0.5) * R); rock(k, 0.18, 0.12, 0.15, STONE, rng.float(), 1); k.pop(); }
  return 0.7;
}

/** bread oven: a small clay dome on a plinth with a glowing door and a little roof over it */
function oven(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const R = Math.min(spec.w, spec.d) * 0.36;
  k.box(-R - 0.3, -0.5, -R - 0.3, R + 0.3, 0.8, R + 0.3, SURF.rubble, PART.plinth, STONE, { skip: ['bottom'] });
  const prof: [number, number][] = [];
  for (let i = 0; i <= 7; i++) { const t = (i / 7) * Math.PI / 2; prof.push([R * Math.cos(t) + 0.01, 0.8 + R * 0.9 * Math.sin(t)]); }
  const col = mixc(L.wall.col, [0.45, 0.28, 0.16], 0.5);
  k.lathe(0, 0, prof, spec.lod === 0 ? 14 : 8, SURF.mudbrick, PART.wall, col, 0.7, 1);
  k.push(0, 0.8, R * 0.85);
  k.box(-0.32, 0, -0.1, 0.32, 0.5, 0.22, SURF.mudbrick, PART.wall, mulc(col, 0.85), { skip: ['bottom', 'nz'] });
  k.quad([-0.2, 0.02, 0.23], [0.2, 0.02, 0.23], [0.2, 0.36, 0.23], [-0.2, 0.36, 0.23], SURF.ember, PART.hot, [0.1, 0.03, 0.01], 1, rng.float());
  k.pop();
  em.push({ p: [0, 1.0, R + 0.2], kind: EMIT.mouth, size: 0.3 });
  em.push({ p: [0, 0.8 + R * 0.9, -R * 0.3], kind: EMIT.smoke, size: 0.2 });
  return 0.8 + R * 0.9;
}

/** wayside shrine: a small open structure with an altar, offerings and a brazier; a carved post for early peoples */
function shrine(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const fear = spec.mood < -0.33;
  if (spec.era <= 1 || spec.mat.tier <= 0 || spec.mat.id === 'wood') {
    // a carved totem with stones around it
    const h = 3.6;
    k.cylinder(0, 0, -0.6, h, 0.28, 0.22, 8, SURF.bark, PART.wall, fear ? [0.04, 0.03, 0.025] : WOOD, { top: true });
    for (let i = 0; i < 4; i++) k.box(-0.3, 0.6 + i * 0.75, 0.15, 0.3, 0.95 + i * 0.75, 0.3, SURF.planks, PART.trim, i % 2 ? (fear ? [0.2, 0.02, 0.02] : [0.35, 0.18, 0.04]) : WOOD_DARK, {});
    k.beam([-0.9, h - 0.4, 0], [0.9, h - 0.4, 0], 0.15, 0.2, SURF.beam, PART.trim, WOOD_DARK, 0.9);
    stoneRing(k, 1.4, 7, 0.2, STONE, rng, spec.lod);
    em.push({ p: [0, 0.3, 0.9], kind: EMIT.brazier, size: 0.18 });
    return h;
  }
  const S = Math.min(spec.w, spec.d) * 0.7;
  const col = fear ? STONE_DARK : mixc(L.wall.col, [0.62, 0.55, 0.45], 0.3);
  k.box(-S / 2, -0.6, -S / 2, S / 2, 0.4, S / 2, SURF.ashlar, PART.plinth, mulc(col, 0.95), { skip: ['bottom'] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * S / 2 - (sx > 0 ? 0.35 : 0), 0.4, sz * S / 2 - (sz > 0 ? 0.35 : 0), sx * S / 2 + (sx < 0 ? 0.35 : 0), 2.6, sz * S / 2 + (sz < 0 ? 0.35 : 0), L.wall.surf === SURF.brick ? SURF.brick : SURF.ashlar, PART.wall, col, {});
  k.box(-S / 2 - 0.1, 2.6, -S / 2 - 0.1, S / 2 + 0.1, 2.9, S / 2 + 0.1, SURF.ashlar, PART.trim, mulc(col, 1.1), {});
  const rf: RoofLook = { ...L.roof };
  hipRoof(k, S + 0.2, S + 0.2, 2.9, 0.6, 0.3, rf, spec.lod);
  k.box(-0.45, 0.4, -0.3, 0.45, 1.25, 0.3, SURF.ashlar, PART.wall, mulc(col, 1.1), {});
  if (spec.lod === 0) for (let i = 0; i < 3; i++) k.lathe(-0.25 + i * 0.25, 0, [[0.06, 1.25], [0.08, 1.35], [0.02, 1.45]], 6, SURF.cloth, PART.prop, [[0.5, 0.1, 0.05], [0.55, 0.42, 0.08], [0.2, 0.35, 0.1]][i] as RGB, 1, 1);
  em.push({ p: [0, 1.4, 0], kind: EMIT.brazier, size: 0.15 });
  return 2.9 + (S / 2) * Math.tan(0.6);
}

/** mine head: a timber headframe with a wheel over the shaft, a spoil heap, ore carts on rails */
function mine(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const H = 9;
  const steel = spec.era >= 8;
  const col: RGB = steel ? [0.3, 0.1, 0.06] : WOOD;
  // shaft collar
  k.box(-1.6, -0.5, -1.6, 1.6, 0.3, 1.6, SURF.planks, PART.plinth, WOOD_GREY, { skip: ['bottom'] });
  k.quad([-1.1, 0.31, 1.1], [1.1, 0.31, 1.1], [1.1, 0.31, -1.1], [-1.1, 0.31, -1.1], SURF.earth, PART.prop, [0.01, 0.01, 0.01], 0.3);
  // A-frame legs and back-stays
  for (const sx of [-1, 1]) {
    k.beam([sx * 1.4, 0, -1.4], [sx * 0.6, H, 0], 0.25, 0.25, steel ? SURF.iron : SURF.beam, PART.frame, col, 0.9);
    k.beam([sx * 1.4, 0, 1.4], [sx * 0.6, H, 0], 0.25, 0.25, steel ? SURF.iron : SURF.beam, PART.frame, col, 0.9);
    k.beam([sx * 1.0, 0, -5], [sx * 0.6, H - 0.3, 0], 0.22, 0.22, steel ? SURF.iron : SURF.beam, PART.frame, col, 0.9);
  }
  // sheave wheel
  k.push(0, H + 0.6, 0, Math.PI / 2);
  const rw = 1.0;
  const rim: V3[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; rim.push([Math.cos(a) * rw, Math.sin(a) * rw, 0]); }
  k.tube(rim, rim.map(() => 0.07), 5, SURF.iron, PART.frame, IRON, {});
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; k.beam([0, 0, 0], [Math.cos(a) * rw, Math.sin(a) * rw, 0], 0.05, 0.05, SURF.iron, PART.frame, IRON, 0.9); }
  k.pop();
  // engine house / winding shed
  if (spec.lod === 0) {
    k.push(0, 0, -6.5);
    plinth(k, 4.5, 3.5, 0.2, SURF.rubble, STONE);
    const wl: WallLook = { surf: steel ? SURF.brick : SURF.planks, col: steel ? [0.34, 0.12, 0.07] : WOOD_GREY, inner: INTERIOR, frameCol: WOOD_DARK, sillSurf: SURF.planks, sillCol: WOOD, shutters: null, doorCol: WOOD, mullions: false, lod: spec.lod };
    boxWalls(k, { W: 4.5, D: 3.5, H: 2.8, T: 0.25, y0: 0.2, front: [{ x0: 1.8, x1: 2.7, y0: 0, y1: 2.1, kind: 'door' }], back: [], left: [], right: [] }, wl, rng);
    gableRoof(k, 4.5, 3.5, 0.25, 3.0, 0.5, 0.3, { surf: SURF.shingle, col: SHINGLE, under: WOOD_DARK, underSurf: SURF.planks, thick: 0.1, cap: SHINGLE, capSurf: SURF.shingle }, null, spec.lod);
    if (steel) chimney(k, 1.6, -1.0, 2.5, 7.5, 0.6, SURF.brick, [0.3, 0.1, 0.05], em);
    k.pop();
    // spoil heap and an ore cart on rails
    k.push(5.5, 0, 2); rock(k, 2.6, 1.6, 2.2, [0.12, 0.11, 0.1], rng.float(), 0); k.pop();
    for (const sx of [-0.35, 0.35]) k.beam([sx, 0.08, 1.8], [sx + 0.3, 0.08, 8], 0.06, 0.08, SURF.iron, PART.prop, IRON, 0.8);
    k.push(0.15, 0.1, 4.5);
    k.box(-0.45, 0.25, -0.6, 0.45, 0.9, 0.6, SURF.planks, PART.prop, WOOD_DARK, {});
    k.pop();
  }
  return H + 1.6;
}

/** power station: a turbine hall, a boiler house, stacks and cooling towers */
function powerplant(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = spec.w, D = spec.d;
  const brick = L.wall.surf === SURF.concrete ? SURF.concrete : SURF.brick;
  const col: RGB = brick === SURF.brick ? [0.32, 0.12, 0.07] : CONCRETE;
  const look: WallLook = { ...L.wall, surf: brick, col, shutters: null, mullions: true, frameCol: [0.05, 0.05, 0.05] };
  const hw = W * 0.6, hd = D * 0.6;
  k.push(-W * 0.2, 0, 0);
  plinth(k, hw, hd, 0.3, SURF.concrete, mulc(CONCRETE, 0.8));
  boxWalls(k, { W: hw, D: hd, H: 9, T: 0.5, y0: 0.3, front: windowRow(hw, 2.0, [1.6, 5.5], 2.8, 1.2, null), back: windowRow(hw, 2.0, [1.6, 5.5], 2.8, 1.2, null), left: [{ x0: hd / 2 - 1.6, x1: hd / 2 + 1.6, y0: 0, y1: 4.5, kind: 'door' }], right: [] }, look, rng);
  gableRoof(k, hw, hd, 0.5, 9.3, 0.3, 0.4, { ...L.roof, surf: SURF.metal, col: [0.2, 0.2, 0.21], cap: [0.2, 0.2, 0.21], capSurf: SURF.metal }, { surf: brick, col }, spec.lod);
  k.pop();
  for (let s = 0; s < 2; s++) {
    const x = W * 0.12 + s * 3, z = -D * 0.3;
    k.cylinder(x, z, -2, 34, 1.4, 1.0, 12, SURF.brick, PART.trim, [0.32, 0.11, 0.06], {});
    k.cylinder(x, z, 34, 34.8, 1.2, 1.2, 12, SURF.concrete, PART.trim, [0.1, 0.1, 0.1], { top: true, topSurf: SURF.earth, topCol: ASH });
    em.push({ p: [x, 35.1, z], kind: EMIT.stack, size: 1.1 });
  }
  if (spec.lod === 0 || spec.era >= 9) {
    // a hyperboloid cooling tower (steam, not smoke)
    const cx = W * 0.32, cz = D * 0.2, R = Math.min(W, D) * 0.28;
    const prof: [number, number][] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const y = -1 + t * 23; const r = R * (0.62 + 0.38 * Math.pow((2 * t - 1.3) / 1.3, 2)); prof.push([r, y]); }
    k.lathe(cx, cz, prof, spec.lod === 0 ? 24 : 12, SURF.concrete, PART.wall, mulc(CONCRETE, 1.15), 0.7, 1);
    k.lathe(cx, cz, prof.slice().reverse().map(([r, y]) => [r - 0.3, y] as [number, number]), spec.lod === 0 ? 24 : 12, SURF.concrete, PART.wall, mulc(CONCRETE, 0.4), 0.4, 0.5);
    em.push({ p: [cx, 22.5, cz], kind: EMIT.smoke, size: R * 0.7 });
  }
  return 35;
}

/** refinery: storage tanks, distillation columns with ladders, pipe racks and a flare stack */
function refinery(k: KitBuilder, spec: BuildingSpec, rng: Rng, em: Emitter[]): number {
  const S = Math.max(spec.w, spec.d);
  k.box(-S / 2, -2, -S / 2, S / 2, 0.15, S / 2, SURF.concrete, PART.plinth, mulc(CONCRETE, 0.85), { skip: ['bottom'] });
  for (let i = 0; i < 4; i++) {
    const x = -S / 2 + 4 + (i % 2) * 7.5, z = -S / 2 + 4 + Math.floor(i / 2) * 7.5;
    k.cylinder(x, z, 0.1, 5.5, 3.2, 3.2, spec.lod === 0 ? 18 : 10, SURF.metal, PART.wall, [0.55, 0.55, 0.53], { top: true, topSurf: SURF.metal, topCol: [0.45, 0.45, 0.44] });
  }
  for (let i = 0; i < 3; i++) {
    const x = S / 2 - 4 - i * 2.6, z = S / 2 - 5;
    const h = 16 + i * 5;
    k.cylinder(x, z, 0.1, h, 0.9, 0.8, 10, SURF.metal, PART.wall, [0.42, 0.43, 0.44], { top: true });
    if (spec.lod === 0) for (let y = 3; y < h; y += 4) k.cylinder(x, z, y, y + 0.15, 1.2, 1.2, 10, SURF.iron, PART.frame, [0.5, 0.42, 0.06], { top: true, bottom: true });
  }
  if (spec.lod === 0) {
    for (let j = 0; j < 3; j++) k.beam([-S / 2 + 2, 4 + j * 0.5, 2], [S / 2 - 2, 4 + j * 0.5, 2], 0.25, 0.25, SURF.metal, PART.frame, [0.3, 0.3, 0.32], 0.9);
    for (let x = -S / 2 + 3; x < S / 2 - 2; x += 4) k.beam([x, 0, 2], [x, 4.2, 2], 0.2, 0.2, SURF.iron, PART.frame, IRON, 0.9);
  }
  // flare stack
  k.cylinder(-S / 2 + 2, S / 2 - 2, 0, 26, 0.4, 0.35, 8, SURF.iron, PART.trim, [0.4, 0.1, 0.05], {});
  em.push({ p: [-S / 2 + 2, 26.4, S / 2 - 2], kind: EMIT.brazier, size: 0.9 });
  void rng;
  return 26;
}

/** laboratory: a long modern block with ribbon windows, roof vents and a small dome */
function lab(k: KitBuilder, spec: BuildingSpec, L: Look, rng: Rng, em: Emitter[]): number {
  const W = spec.w, D = spec.d;
  const surf = L.wall.surf === SURF.glass ? SURF.concrete : L.wall.surf;
  const look: WallLook = { ...L.wall, surf, shutters: null, mullions: true, frameCol: [0.08, 0.08, 0.09] };
  plinth(k, W, D, 0.5, SURF.concrete, mulc(CONCRETE, 0.85));
  let y = 0.5;
  for (let f = 0; f < 2; f++) {
    const fr: Opening[] = f === 0 ? [{ x0: W / 2 - 1.0, x1: W / 2 + 1.0, y0: 0, y1: 2.6, kind: 'door' }] : [];
    fr.push(...windowRow(W, 0.9, [1.8, 1.6], 2.2, 0.8, f === 0 ? [W / 2 - 1.2, W / 2 + 1.2] : null));
    boxWalls(k, { W, D, H: 3.4, T: 0.35, y0: y, front: fr, back: windowRow(W, 0.9, [1.8, 1.6], 2.2, 0.8, null), left: windowRow(D - 0.7, 0.9, [1.6, 1.6], 2.4, 0.8, null), right: windowRow(D - 0.7, 0.9, [1.6, 1.6], 2.4, 0.8, null) }, look, rng);
    y += 3.4;
  }
  k.box(-W / 2 - 0.15, y, -D / 2 - 0.15, W / 2 + 0.15, y + 0.5, D / 2 + 0.15, SURF.concrete, PART.roof, mulc(CONCRETE, 0.9), { skip: ['bottom'] });
  if (spec.lod === 0) {
    for (let i = 0; i < 3; i++) k.box(-W / 2 + 1.5 + i * 2.2, y + 0.5, -D / 4 - 0.5, -W / 2 + 2.6 + i * 2.2, y + 1.6, -D / 4 + 0.5, SURF.metal, PART.prop, [0.4, 0.41, 0.42], { skip: ['bottom'] });
    const prof: [number, number][] = [];
    for (let i = 0; i <= 6; i++) { const t = (i / 6) * Math.PI / 2; prof.push([1.6 * Math.cos(t) + 0.01, y + 0.5 + 1.6 * Math.sin(t)]); }
    k.lathe(W / 2 - 2.5, 0, prof, 14, SURF.metal, PART.roof, [0.62, 0.63, 0.64], 0.85, 1);
  }
  em.push({ p: [-W / 2 + 2, y + 1.7, -D / 4], kind: EMIT.smoke, size: 0.25 });
  return y + 2.1;
}

// ───────────────────────────── entry ─────────────────────────────

function houseOpts(kind: BuildingKind, spec: BuildingSpec): HouseOpts {
  const st = spec.style;
  const base: HouseOpts = {
    floors: 1, floorH: 2.7, T: 0.35, pitch: 0.75, over: 0.45, roof: 'gable', winW: 0.75, winH: 0.9, spacing: 2.0, chimneys: 0,
    corners: false, frame: false, porch: false, jetty: 0, parapet: false, vigas: false, plinthH: 0.3, doorW: 0.95, doorH: 1.95, cornice: false, dormers: false,
  };
  switch (kind) {
    case 'wattle': return { ...base, T: 0.28, pitch: 0.92, over: 0.55, winW: 0.55, winH: 0.6, spacing: 2.4, corners: true, chimneys: spec.era >= 5 ? 1 : 0 };
    case 'mudbrick': return { ...base, floors: st % 3 === 0 && spec.w > 6 ? 2 : 1, floorH: 2.8, T: 0.45, roof: 'flat', parapet: true, vigas: true, winW: 0.6, winH: 0.7, spacing: 2.3, plinthH: 0.2 };
    case 'stone-house': return { ...base, floors: st % 2 && spec.era >= 6 ? 2 : 1, T: 0.55, pitch: spec.era >= 6 ? 0.78 : 0.88, over: 0.3, corners: spec.era >= 5, chimneys: spec.era >= 5 ? 1 : 0, winW: 0.75, winH: 1.0, porch: st % 4 === 1 };
    case 'timber': return { ...base, T: 0.32, pitch: 0.7, over: 0.6, corners: true, porch: st % 2 === 0, chimneys: 1, winW: 0.8, winH: 0.95 };
    case 'brick-house': return { ...base, floors: 2, floorH: 2.9, T: 0.4, roof: st % 3 === 1 ? 'hip' : 'gable', pitch: 0.65, over: 0.35, chimneys: 2, winW: 0.85, winH: 1.35, spacing: 1.9, cornice: true, dormers: st % 4 === 2, plinthH: 0.5 };
    case 'half-timber': return { ...base, floors: 2, floorH: 2.7, T: 0.3, pitch: 0.95, over: 0.4, frame: true, jetty: 0.45, chimneys: 1, winW: 0.8, winH: 1.0, spacing: 1.8 };
    case 'tenement': return { ...base, floors: spec.w > 9 ? 4 : 3, floorH: 3.0, T: 0.45, roof: 'gable', pitch: 0.5, over: 0.25, chimneys: 2, winW: 0.85, winH: 1.5, spacing: 1.7, cornice: true, plinthH: 0.6 };
    case 'block': return { ...base, floors: 3 + (st % 3), floorH: 3.1, T: 0.35, roof: 'flat', parapet: true, winW: 1.6, winH: 1.5, spacing: 2.2, plinthH: 0.4, doorW: 1.6, doorH: 2.3 };
    case 'barn': return { ...base, floorH: 4.2, T: 0.25, roof: spec.era >= 7 ? 'gambrel' : 'gable', pitch: 0.8, over: 0.4, winW: 0.6, winH: 0.6, spacing: 4, doorW: 3.0, doorH: 3.4, plinthH: 0.25 };
    default: return base;
  }
}

/** build a building mesh for a spec (deterministic per spec) */
export function buildingMesh(spec: BuildingSpec): BuildingMesh {
  const rng = new Rng(9001 + spec.style * 131 + spec.era * 17 + Math.round(spec.mood * 3 + 3) * 7 + spec.kind.length * 1009 + Math.round(spec.w * 10) * 3 + Math.round(spec.d * 10) + (spec.hv ?? 0) * 7717);
  const k = new KitBuilder();
  const L = lookFor(spec, rng);
  const em: Emitter[] = [];
  let h: number;
  switch (spec.kind) {
    case 'lean-to': h = leanTo(k, spec, rng); break;
    case 'tent': h = tent(k, spec, rng, em); break;
    case 'hut': h = hut(k, spec, L, rng, em); break;
    case 'longhouse': h = longhouse(k, spec, L, rng, em); break;
    case 'hearth': h = hearth(k, spec, rng, em); break;
    case 'kiln': h = kiln(k, spec, L, rng, em); break;
    case 'furnace': h = furnace(k, spec, L, rng, em); break;
    case 'forge': h = forge(k, spec, L, rng, em); break;
    case 'granary': h = granary(k, spec, L, rng); break;
    case 'workshop': h = workshop(k, spec, L, rng, em); break;
    case 'temple': h = temple(k, spec, L, rng, em); break;
    case 'library': h = library(k, spec, L, rng); break;
    case 'market': h = market(k, spec, L, rng); break;
    case 'mill': h = mill(k, spec, L, rng); break;
    case 'aqueduct': h = aqueduct(k, spec, L); break;
    case 'wall': h = wallSeg(k, spec, L, rng); break;
    case 'gate': h = gate(k, spec, L, rng, em); break;
    case 'tower': h = tower(k, spec, L, rng, em); break;
    case 'dock': h = dock(k, spec, rng); break;
    case 'shipyard': h = shipyard(k, spec, L, rng); break;
    case 'lighthouse': h = lighthouse(k, spec, L, rng, em); break;
    case 'observatory': h = observatory(k, spec, L, rng); break;
    case 'factory': h = factory(k, spec, L, rng, em); break;
    case 'radio': h = radio(k, spec, L, rng, em); break;
    case 'launchpad': h = launchpad(k, spec, rng, em); break;
    case 'airship-mast': h = airshipMast(k, spec, rng, em); break;
    case 'habitat-dome': h = habitatDome(k, spec, rng, em); break;
    case 'star-gate': h = starGate(k, spec, rng, em); break;
    case 'pen': h = pen(k, spec, rng); break;
    case 'well': h = well(k, spec, rng); break;
    case 'hive-mound': h = hiveMound(k, spec, L, rng); break;
    case 'igloo': h = igloo(k, spec, rng, em); break;
    case 'store-pit': h = storePit(k, spec, rng); break;
    case 'oven': h = oven(k, spec, L, rng, em); break;
    case 'shrine': h = shrine(k, spec, L, rng, em); break;
    case 'mine': h = mine(k, spec, rng, em); break;
    case 'powerplant': h = powerplant(k, spec, L, rng, em); break;
    case 'refinery': h = refinery(k, spec, rng, em); break;
    case 'lab': h = lab(k, spec, L, rng, em); break;
    default: h = house(k, spec, L, householdOpts(houseOpts(spec.kind, spec), spec.kind, spec), rng, em); break;
  }
  const b = k.bounds();
  return {
    geo: k.build(), height: Math.max(h, b.max[1]),
    hx: Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), hz: Math.max(Math.abs(b.min[2]), Math.abs(b.max[2])), emitters: em,
    ext: [b.min[0], b.max[0], b.min[2], b.max[2]],
  };
}

/** the props of a household's yard (instanced around dwellings by buildings.ts) */
export const YARD_PROPS = ['woodpile', 'barrels', 'fence', 'garden', 'cart', 'laundry', 'rack'] as const;
export type YardProp = (typeof YARD_PROPS)[number];

/**
 * One yard prop, its origin on the ground at the prop's centre, +Z away from the house wall it stands by: a stacked
 * woodpile under a lean-to roof, barrels and a crate, a run of fence, a kitchen garden of planted rows, a two-wheeled
 * cart, a washing line, a drying rack of hides or fish.
 */
export function yardPropMesh(kind: YardProp, seed: number): BufferGeometry {
  const k = new KitBuilder();
  const rng = new Rng(4421 + seed * 97 + YARD_PROPS.indexOf(kind) * 13);
  switch (kind) {
    case 'woodpile': {
      k.push(0, 0, 0, Math.PI / 2);
      woodPile(k, 1.6, 4, WOOD, rng);
      k.pop();
      // a little lean-to roof of boards over it
      k.slab([-0.95, 1.05, 0.55], [0.95, 1.05, 0.55], [0.95, 1.35, -0.45], [-0.95, 1.35, -0.45], 0.04, SURF.shingle, PART.prop, mulc(WOOD_GREY, 0.55), SURF.planks, mulc(WOOD_GREY, 0.4));
      for (const sx of [-0.9, 0.9]) { k.cylinder(sx, 0.5, -0.1, 1.05, 0.04, 0.04, 5, SURF.bark, PART.prop, WOOD_DARK, {}); k.cylinder(sx, -0.42, -0.1, 1.35, 0.04, 0.04, 5, SURF.bark, PART.prop, WOOD_DARK, {}); }
      break;
    }
    case 'barrels':
      barrel(k, -0.35, 0, 0.28, 0.8, WOOD_DARK);
      barrel(k, 0.25, 0.15, 0.26, 0.74, mulc(WOOD, 0.9));
      crate(k, 0.1, -0.5, 0.45, 0.3 + rng.float(), WOOD_GREY);
      break;
    case 'fence': {
      const L = 3.5 + rng.float() * 2.5;
      fence(k, [[-L / 2, 0.6], [L / 2, 0.6], [L / 2, -1.6]], 0.95, WOOD_GREY, -1, 0);
      break;
    }
    case 'garden': {
      // a kitchen garden: dark tilled rows with plants, a wattle edge
      const W = 2.6, D = 2.0;
      k.box(-W / 2, -0.2, -D / 2, W / 2, 0.06, D / 2, SURF.earth, PART.prop, [0.07, 0.05, 0.035], { skip: ['bottom'], aoLow: 0.8 });
      for (let r = 0; r < 4; r++) {
        const z = -D / 2 + 0.3 + r * (D - 0.6) / 3;
        for (let i = 0; i < 6; i++) {
          const x = -W / 2 + 0.25 + i * (W - 0.5) / 5 + (rng.float() - 0.5) * 0.1;
          const green: RGB = r % 2 ? [0.05, 0.1, 0.03] : [0.08, 0.12, 0.035];
          k.lathe(x, z, [[0.06, 0.05], [0.16, 0.14], [0.13, 0.26], [0.02, 0.32]], 5, SURF.thatch, PART.prop, mulc(green, 0.8 + rng.float() * 0.4), 0.6, 1);
        }
      }
      fence(k, [[-W / 2 - 0.1, D / 2 + 0.1], [W / 2 + 0.1, D / 2 + 0.1], [W / 2 + 0.1, -D / 2 - 0.1], [-W / 2 - 0.1, -D / 2 - 0.1]], 0.55, WOOD_GREY, 0, 1);
      break;
    }
    case 'cart': {
      // a two-wheeled cart tipped on its shafts
      k.box(-0.6, 0.55, -0.9, 0.6, 0.62, 0.9, SURF.planks, PART.prop, WOOD, {});
      for (const sx of [-0.62, 0.62]) {
        k.box(sx - 0.03, 0.62, -0.9, sx + 0.03, 0.9, 0.9, SURF.planks, PART.prop, WOOD, {});
        k.push(sx + Math.sign(sx) * 0.08, 0, 0.1, Math.PI / 2);
        k.lathe(0, 0, [[0.5, -0.04], [0.5, 0.04]], 12, SURF.beam, PART.prop, WOOD_DARK, 1, 1);
        k.pop();
      }
      for (const sx of [-0.4, 0.4]) k.beam([sx, 0.58, 0.9], [sx * 0.7, 0.05, 2.2], 0.07, 0.07, SURF.beam, PART.prop, WOOD, 0.9);
      break;
    }
    case 'laundry': {
      // a washing line between two posts, cloths hung on it
      for (const sx of [-1.8, 1.8]) k.cylinder(sx, 0, -0.2, 1.9, 0.05, 0.045, 5, SURF.bark, PART.prop, WOOD_DARK, {});
      k.beam([-1.8, 1.82, 0], [1.8, 1.82, 0], 0.015, 0.015, SURF.rope, PART.prop, [0.3, 0.27, 0.2], 1);
      for (let i = 0; i < 4; i++) {
        const x = -1.3 + i * 0.85 + (rng.float() - 0.5) * 0.2, w = 0.3 + rng.float() * 0.25, h = 0.45 + rng.float() * 0.4;
        const c = mulc(mixc(CLOTH[Math.floor(rng.float() * CLOTH.length)], [0.6, 0.57, 0.5], 0.55), 0.9);
        k.quad([x - w, 1.8 - h, 0.01], [x + w, 1.8 - h, 0.01], [x + w, 1.8, 0.01], [x - w, 1.8, 0.01], SURF.cloth, PART.prop, c, 0.9);
        k.quad([x + w, 1.8 - h, -0.01], [x - w, 1.8 - h, -0.01], [x - w, 1.8, -0.01], [x + w, 1.8, -0.01], SURF.cloth, PART.prop, c, 0.7);
      }
      break;
    }
    default: {
      // a drying rack: a frame of poles with hides (or split fish) hung over the bar
      for (const sx of [-0.9, 0.9]) { k.beam([sx, 0, -0.35], [sx, 1.5, 0], 0.05, 0.05, SURF.bark, PART.prop, WOOD_DARK, 0.9); k.beam([sx, 0, 0.35], [sx, 1.5, 0], 0.05, 0.05, SURF.bark, PART.prop, WOOD_DARK, 0.9); }
      k.beam([-1.0, 1.45, 0], [1.0, 1.45, 0], 0.05, 0.05, SURF.bark, PART.prop, WOOD_DARK, 0.9);
      for (let i = 0; i < 3; i++) {
        const x = -0.55 + i * 0.55;
        k.quad([x - 0.22, 0.6, 0.12], [x + 0.22, 0.6, 0.12], [x + 0.2, 1.44, 0.02], [x - 0.2, 1.44, 0.02], SURF.hide, PART.prop, mulc(HIDE, 0.8 + rng.float() * 0.3), 0.85);
        k.quad([x + 0.22, 0.6, 0.1], [x - 0.22, 0.6, 0.1], [x - 0.2, 1.44, 0.0], [x + 0.2, 1.44, 0.0], SURF.hide, PART.prop, mulc(HIDE, 0.6), 0.6);
      }
    }
  }
  return k.build();
}

/** how a building goes up: round huts on a ring of saplings, timber on its own frame, masonry behind a scaffold */
export type ScaffoldKind = 'ring' | 'frame' | 'putlog' | 'pile';

/** the scaffold kind for a building kind, material and storey height */
export function scaffoldKindFor(kind: BuildingKind, mat: MaterialLook, H: number): ScaffoldKind {
  if (kind === 'hut' || kind === 'tent' || kind === 'lean-to' || kind === 'igloo' || kind === 'hive-mound' || kind === 'hearth'
    || kind === 'store-pit' || kind === 'oven' || kind === 'kiln' || kind === 'well' || kind === 'shrine' || kind === 'pen') return 'ring';
  if (kind === 'timber' || kind === 'longhouse' || kind === 'wattle' || kind === 'barn' || kind === 'half-timber' || mat.tier <= 1 && mat.id !== 'mudbrick') return 'frame';
  return H >= 5 ? 'putlog' : 'pile';
}

/**
 * The scaffolding of a building site, by kind (unit meshes are built per size class: scaling one would bend the poles):
 *   ring   — round work: a ring of bent saplings over the footprint (the wattle rises on them), a pile of reeds
 *   frame  — timber: the frame posts at the corners and along the walls, wall plates and the rafters' A-frames
 *   putlog — masonry of two storeys and more: poles, ledgers at each storey below the top, plank decks, braces
 *   pile   — low masonry: a ladder against the wall and a stack of dressed blocks waiting
 */
export function scaffoldMesh(W: number, D: number, H: number, kind: ScaffoldKind = 'putlog'): BufferGeometry {
  const k = new KitBuilder();
  // weathered poles and boards (pale timber read as white sticks in the sun)
  const col: RGB = [0.17, 0.135, 0.09];
  const fresh: RGB = [0.26, 0.2, 0.125];
  if (kind === 'ring') {
    // bent saplings: arcs over the footprint from side to side, lashed where they cross
    const R = Math.max(W, D) * 0.5 + 0.05;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts: V3[] = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8, ang = Math.PI * t;
        const r = R * Math.cos(ang), y = Math.sin(ang) * Math.min(H, R * 1.2);
        pts.push([ca * r, y - 0.05, sa * r]);
      }
      k.tube(pts, pts.map(() => 0.035), 4, SURF.bark, PART.frame, fresh, {});
    }
    // two hoops tying them
    for (const hy of [0.35, 0.7]) {
      const yy = Math.min(H, R * 1.2) * hy, rr = R * Math.cos(Math.asin(Math.min(0.99, hy)));
      const pts: V3[] = [];
      for (let j = 0; j <= 16; j++) { const a = (j / 16) * Math.PI * 2; pts.push([Math.cos(a) * rr, yy, Math.sin(a) * rr]); }
      k.tube(pts, pts.map(() => 0.025), 4, SURF.bark, PART.frame, fresh, {});
    }
    // a pile of cut reeds and a few poles beside the site
    for (let i = 0; i < 9; i++) {
      const x = R + 0.6 + (i % 3) * 0.18, y = 0.06 + Math.floor(i / 3) * 0.1, z = -0.9 + (i % 3) * 0.05;
      k.tube([[x, y, z], [x + 0.05, y, z + 1.8]], [0.06, 0.06], 5, SURF.thatch, PART.frame, [0.36, 0.28, 0.14], {});
    }
    return k.build();
  }
  if (kind === 'frame') {
    // the building's own frame going up: corner and wall posts, wall plates, A-frame rafters
    const xs: number[] = [], zs: number[] = [];
    const nx = Math.max(1, Math.round(W / 2.2)), nz = Math.max(1, Math.round(D / 2.2));
    for (let i = 0; i <= nx; i++) xs.push(-W / 2 + (i * W) / nx);
    for (let i = 0; i <= nz; i++) zs.push(-D / 2 + (i * D) / nz);
    const yE = Math.min(H, 2.8);
    const post = (x: number, z: number) => k.box(x - 0.09, -0.3, z - 0.09, x + 0.09, yE, z + 0.09, SURF.beam, PART.frame, fresh, { skip: ['bottom'] });
    for (const x of xs) { post(x, -D / 2); post(x, D / 2); }
    for (const z of zs.slice(1, -1)) { post(-W / 2, z); post(W / 2, z); }
    k.beam([-W / 2, yE, -D / 2], [W / 2, yE, -D / 2], 0.16, 0.16, SURF.beam, PART.frame, fresh, 0.9);
    k.beam([-W / 2, yE, D / 2], [W / 2, yE, D / 2], 0.16, 0.16, SURF.beam, PART.frame, fresh, 0.9);
    k.beam([-W / 2, yE, -D / 2], [-W / 2, yE, D / 2], 0.16, 0.16, SURF.beam, PART.frame, fresh, 0.9);
    k.beam([W / 2, yE, -D / 2], [W / 2, yE, D / 2], 0.16, 0.16, SURF.beam, PART.frame, fresh, 0.9);
    const ridge = yE + Math.min(W, D) * 0.45;
    const along = W >= D;
    const L = along ? W : D, S = along ? D : W;
    const n = Math.max(2, Math.round(L / 1.8));
    for (let i = 0; i <= n; i++) {
      const t = -L / 2 + (i * L) / n;
      const a: V3 = along ? [t, yE, -S / 2] : [-S / 2, yE, t], m: V3 = along ? [t, ridge, 0] : [0, ridge, t], b: V3 = along ? [t, yE, S / 2] : [S / 2, yE, t];
      k.beam(a, m, 0.1, 0.12, SURF.beam, PART.frame, col, 0.85);
      k.beam(m, b, 0.1, 0.12, SURF.beam, PART.frame, col, 0.85);
    }
    k.beam(along ? [-W / 2, ridge, 0] : [0, ridge, -D / 2], along ? [W / 2, ridge, 0] : [0, ridge, D / 2], 0.14, 0.14, SURF.beam, PART.frame, col, 0.85);
    return k.build();
  }
  if (kind === 'pile') {
    // a ladder against the front wall and dressed blocks stacked by it
    const z = D / 2 + 0.6;
    for (const sx of [-0.25, 0.25]) k.beam([sx, -0.1, z + 0.5], [sx, Math.min(H, 3.2), z - 0.1], 0.06, 0.06, SURF.bark, PART.frame, col, 0.9);
    for (let y = 0.3; y < Math.min(H, 3.0); y += 0.35) { const t = y / Math.min(H, 3.2); k.beam([-0.25, y, z + 0.5 - 0.6 * t], [0.25, y, z + 0.5 - 0.6 * t], 0.04, 0.04, SURF.bark, PART.frame, col, 0.9); }
    for (let i = 0; i < 6; i++) {
      const x = W / 2 + 0.7 + (i % 3) * 0.42, y = Math.floor(i / 3) * 0.32;
      k.box(x - 0.2, y, -0.5, x + 0.2, y + 0.3, -0.05, SURF.ashlar, PART.frame, [0.4, 0.37, 0.33], {});
    }
    return k.build();
  }
  const off = 0.7;
  const xs: number[] = [], zs: number[] = [];
  const nx = Math.max(1, Math.round((W + 2 * off) / 2.4)), nz = Math.max(1, Math.round((D + 2 * off) / 2.4));
  for (let i = 0; i <= nx; i++) xs.push(-W / 2 - off + (i * (W + 2 * off)) / nx);
  for (let i = 0; i <= nz; i++) zs.push(-D / 2 - off + (i * (D + 2 * off)) / nz);
  const ring: [number, number][] = [];
  for (const x of xs) { ring.push([x, -D / 2 - off]); ring.push([x, D / 2 + off]); }
  for (const z of zs.slice(1, -1)) { ring.push([-W / 2 - off, z]); ring.push([W / 2 + off, z]); }
  for (const [x, z] of ring) k.cylinder(x, z, -0.5, H + 1.2, 0.05, 0.045, 4, SURF.bark, PART.frame, col, {});
  // ledgers and decks at each storey (~2.8 m), not every two metres
  for (let y = 2.8; y < H + 0.5; y += 2.8) {
    const e = -D / 2 - off, f = D / 2 + off, a = -W / 2 - off, b = W / 2 + off;
    k.beam([a, y, e], [b, y, e], 0.07, 0.07, SURF.bark, PART.frame, col, 0.9);
    k.beam([a, y, f], [b, y, f], 0.07, 0.07, SURF.bark, PART.frame, col, 0.9);
    k.beam([a, y, e], [a, y, f], 0.07, 0.07, SURF.bark, PART.frame, col, 0.9);
    k.beam([b, y, e], [b, y, f], 0.07, 0.07, SURF.bark, PART.frame, col, 0.9);
    k.box(a, y + 0.035, e - 0.35, b, y + 0.08, e + 0.35, SURF.planks, PART.frame, [0.19, 0.15, 0.1], {});
    k.box(a, y + 0.035, f - 0.35, b, y + 0.08, f + 0.35, SURF.planks, PART.frame, [0.19, 0.15, 0.1], {});
  }
  for (let i = 0; i < xs.length - 1; i += 2) {
    k.beam([xs[i], 0, -D / 2 - off], [xs[i + 1], Math.min(H, 4), -D / 2 - off], 0.05, 0.05, SURF.bark, PART.frame, col, 0.85);
    k.beam([xs[i], 0, D / 2 + off], [xs[i + 1], Math.min(H, 4), D / 2 + off], 0.05, 0.05, SURF.bark, PART.frame, col, 0.85);
  }
  return k.build();
}

/**
 * A rubble heap (ruins, collapse, rebuilding sites), unit footprint radius: an irregular low mound of earth and broken
 * fill (no turned dome), tumbled blocks and wall chunks half sunk in it and spilled round its foot, and the fallen roof —
 * charred timbers lying slantwise across it. Stone rubble is blocks and slabs; earthen rubble is lumps of clay brick,
 * broken wattle and more timber.
 */
export function rubbleMesh(seed: number, stone: boolean): BufferGeometry {
  const k = new KitBuilder();
  const rng = new Rng(seed);
  const col: RGB = stone ? [0.3, 0.29, 0.27] : [0.22, 0.16, 0.1];
  const earth: RGB = stone ? [0.17, 0.155, 0.135] : [0.15, 0.11, 0.075];
  // the mound: a polar height field with a ragged edge and lumps
  const NR = 5, NA = 20;
  const ph = [rng.float() * 6.28, rng.float() * 6.28, rng.float() * 6.28];
  const edge = (a: number) => 0.86 + 0.1 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(7 * a + ph[1]);
  const height = (r: number, a: number) => {
    const t = Math.max(0, 1 - r * r);
    const lump = 0.6 + 0.25 * Math.sin(2 * a + ph[2] + r * 3) + 0.2 * Math.sin(5 * a + ph[1] - r * 4) + 0.15 * Math.cos(9 * a + ph[0] + r * 7);
    return 0.27 * Math.pow(t, 0.75) * lump - 0.02;
  };
  const P = (i: number, j: number): V3 => {
    const a = (j / NA) * Math.PI * 2, r = (i / NR) * edge(a);
    return [Math.cos(a) * r, i === NR ? -0.06 : height(i / NR, a), Math.sin(a) * r];
  };
  const ids: number[][] = [];
  for (let i = 0; i <= NR; i++) {
    const row: number[] = [];
    for (let j = 0; j <= NA; j++) {
      const p = P(i, j % NA);
      // normal from the neighbouring points
      const pa = P(Math.min(NR, i + 1), j % NA), pb = P(Math.max(0, i - 1), j % NA), pc = P(i, (j + 1) % NA), pd = P(i, (j + NA - 1) % NA);
      const u: V3 = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]], v: V3 = [pc[0] - pd[0], pc[1] - pd[1], pc[2] - pd[2]];
      let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (i === 0) n = [0, 1, 0];
      if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
      const shade = 0.75 + 0.3 * rng.float();
      row.push(k.vert(p[0], p[1], p[2], n[0], n[1], n[2], stone ? SURF.rubble : SURF.earth, PART.prop, mulc(i >= NR - 1 ? earth : mixc(earth, col, 0.35), shade), i >= NR - 1 ? 0.7 : 0.85));
    }
    ids.push(row);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = ids[i][j], b = ids[i][j + 1], c = ids[i + 1][j], d = ids[i + 1][j + 1];
    k.tri(a, b, d); k.tri(a, d, c);
  }
  // blocks and broken wall chunks, tumbled at all angles, sunk into the heap and spilled round its foot
  const nb = stone ? 34 : 22;
  for (let i = 0; i < nb; i++) {
    const a = rng.float() * Math.PI * 2, d = Math.pow(rng.float(), 0.7) * 1.08;
    const s = (stone ? 0.035 : 0.035) + Math.pow(rng.float(), 1.6) * (stone ? 0.07 : 0.05);
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const y = Math.max(-0.02, height(Math.min(1, d), a)) - s * 0.35;
    const dir: V3 = [Math.cos(rng.float() * 6.28), (rng.float() - 0.5) * 1.2, Math.sin(rng.float() * 6.28)];
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const L = s * (1.2 + rng.float() * 0.8);
    const p0: V3 = [cx - (dir[0] / dl) * L, y - (dir[1] / dl) * L, cz - (dir[2] / dl) * L], p1: V3 = [cx + (dir[0] / dl) * L, y + (dir[1] / dl) * L, cz + (dir[2] / dl) * L];
    const tone = 0.75 + rng.float() * 0.5;
    if (stone || rng.float() < 0.55) k.beam(p0, p1, s * 1.5, s * (0.9 + rng.float() * 0.5), stone ? SURF.ashlar : SURF.mudbrick, PART.prop, mulc(col, tone), 0.85);
    else k.beam(p0, p1, s * 0.5, s * 0.5, SURF.beam, PART.prop, [0.05, 0.035, 0.025], 0.8);
  }
  if (stone) {
    // a few big slabs of fallen wall, leaning on the heap
    for (let i = 0; i < 4; i++) {
      const a = rng.float() * Math.PI * 2, d = 0.25 + rng.float() * 0.5;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, y = height(d, a);
      const t = a + Math.PI / 2 + (rng.float() - 0.5) * 0.8, L = 0.18 + rng.float() * 0.12;
      k.beam([cx - Math.cos(t) * L, y - 0.04, cz - Math.sin(t) * L], [cx + Math.cos(t) * L, y + 0.06 + rng.float() * 0.1, cz + Math.sin(t) * L], 0.2 + rng.float() * 0.12, 0.06, SURF.ashlar, PART.prop, mulc(col, 0.9 + rng.float() * 0.3), 0.85);
    }
  } else {
    // broken wattle: thin withies sticking out of the clay
    for (let i = 0; i < 10; i++) {
      const a = rng.float() * Math.PI * 2, d = 0.2 + rng.float() * 0.7, y = height(d, a);
      const t = rng.float() * 6.28;
      k.beam([Math.cos(a) * d, y - 0.03, Math.sin(a) * d], [Math.cos(a) * d + Math.cos(t) * 0.18, y + 0.08 + rng.float() * 0.08, Math.sin(a) * d + Math.sin(t) * 0.18], 0.012, 0.012, SURF.bark, PART.prop, [0.12, 0.08, 0.05], 0.8);
    }
  }
  // the fallen roof: long timbers lying slantwise across the heap, one end on the mound, one on the ground
  const timbers = stone ? 4 : 7;
  for (let i = 0; i < timbers; i++) {
    const a = rng.float() * Math.PI * 2, b = a + Math.PI * (0.55 + rng.float() * 0.9);
    const r0 = 0.05 + rng.float() * 0.3, r1 = 0.8 + rng.float() * 0.4;
    const t = 0.026 + rng.float() * 0.018;
    k.beam([Math.cos(a) * r0, height(r0, a) + t * 0.6, Math.sin(a) * r0], [Math.cos(b) * r1, -0.01, Math.sin(b) * r1], t, t * 0.85, SURF.beam, PART.prop, [0.045, 0.032, 0.022], 0.75);
  }
  // weeds and grass come up through the heap as the ruin ages (PART growth: the shader shows each tuft from its own
  // day on), thicker round its foot
  for (let i = 0; i < 30; i++) {
    const a = rng.float() * Math.PI * 2, d = Math.pow(rng.float(), 0.6) * 1.1;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d, y0 = Math.max(-0.03, height(Math.min(1, d), a)) - 0.005;
    const sd = rng.float();
    const col = mixc([0.07, 0.1, 0.035], [0.17, 0.15, 0.07], rng.float() * rng.float());
    const blades = 4 + Math.floor(rng.float() * 3);
    for (let j = 0; j < blades; j++) {
      const ba = rng.float() * Math.PI * 2, lean = 0.2 + rng.float() * 0.6;
      const h = 0.045 + rng.float() * 0.06, w = 0.007 + rng.float() * 0.006;
      const ox = Math.cos(ba), oz = Math.sin(ba), px = -oz * w, pz = ox * w;
      k.triangle([cx - px, y0, cz - pz], [cx + px, y0, cz + pz], [cx + ox * lean * h, y0 + h, cz + oz * lean * h], SURF.earth, PART.growth, mulc(col, 0.85 + 0.3 * rng.float()), 0.8, sd);
    }
  }
  return k.build();
}

/**
 * A street lamp by light technology (2 oil lantern on a timber post with a bracket, 3 gas lamp on a fluted cast-iron
 * column with a glazed cage, 4 electric lamp on a tall steel pole with a curved arm). Origin at the foot, the lamp
 * head reaching toward +Z (the road). The glass is PART.lantern: lit at night by the building shader's light tint.
 * Returns the geometry and the lamp head's position (for the light pool).
 */
export function lampPostMesh(kind: number, lod: number): { geo: BufferGeometry; head: V3 } {
  const k = new KitBuilder();
  const IRON_D: RGB = [0.03, 0.032, 0.034];
  const sides = lod === 0 ? 8 : 5;
  let head: V3;
  if (kind <= 2) {
    // timber post, cross bracket, a box lantern hung from it
    k.box(-0.08, -0.6, -0.08, 0.08, 2.7, 0.08, SURF.beam, PART.frame, WOOD_DARK, {});
    k.beam([0, 2.55, 0], [0, 2.55, 0.62], 0.07, 0.08, SURF.beam, PART.frame, WOOD_DARK, 0.9);
    k.beam([0, 2.1, 0], [0, 2.5, 0.38], 0.05, 0.05, SURF.beam, PART.frame, WOOD_DARK, 0.9);
    k.cylinder(0, 0.55, 2.3, 2.5, 0.005, 0.005, 3, SURF.iron, PART.frame, IRON_D, {});
    k.box(-0.12, 2.0, 0.43, 0.12, 2.04, 0.67, SURF.iron, PART.frame, IRON_D, {});
    k.box(-0.1, 2.04, 0.45, 0.1, 2.28, 0.65, SURF.glass, PART.lantern, [0.9, 0.7, 0.4], {});
    k.cylinder(0, 0.55, 2.28, 2.38, 0.15, 0.03, 4, SURF.iron, PART.frame, IRON_D, { bottom: true });
    head = [0, 2.16, 0.55];
  } else if (kind === 3) {
    // gas: a moulded base, fluted column, ladder bar, a four-paned cage with a crown
    k.cylinder(0, 0, -0.5, 0.45, 0.2, 0.17, sides, SURF.iron, PART.frame, IRON_D, { top: true });
    k.cylinder(0, 0, 0.45, 0.6, 0.17, 0.09, sides, SURF.iron, PART.frame, IRON_D, {});
    k.cylinder(0, 0, 0.6, 3.0, 0.075, 0.055, sides, SURF.iron, PART.frame, IRON_D, {});
    k.cylinder(0, 0, 3.0, 3.12, 0.1, 0.1, sides, SURF.iron, PART.frame, IRON_D, { top: true, bottom: true });
    if (lod === 0) for (const sx of [-1, 1]) k.beam([0, 2.75, 0], [sx * 0.32, 2.75, 0], 0.035, 0.035, SURF.iron, PART.frame, IRON_D, 0.9);
    k.cylinder(0, 0, 3.12, 3.2, 0.07, 0.17, 4, SURF.iron, PART.frame, IRON_D, { bottom: true });
    k.cylinder(0, 0, 3.2, 3.62, 0.17, 0.24, 4, SURF.glass, PART.lantern, [0.9, 0.75, 0.5], {});
    k.cylinder(0, 0, 3.62, 3.78, 0.27, 0.06, 4, SURF.iron, PART.frame, IRON_D, { bottom: true });
    k.cylinder(0, 0, 3.78, 3.95, 0.03, 0.01, 4, SURF.iron, PART.frame, IRON_D, {});
    head = [0, 3.4, 0];
  } else {
    // electric: a tapered steel pole, an arm curving out over the road, a shallow lamp head facing down
    k.cylinder(0, 0, -0.5, 0.5, 0.13, 0.12, sides, SURF.iron, PART.frame, [0.2, 0.21, 0.22], { top: true });
    k.cylinder(0, 0, 0.5, 6.4, 0.085, 0.055, sides, SURF.iron, PART.frame, [0.22, 0.23, 0.24], {});
    const arm: V3[] = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; arm.push([0, 6.4 + Math.sin(t * Math.PI * 0.5) * 0.45, t * 1.5]); }
    k.tube(arm, arm.map(() => 0.045), lod === 0 ? 6 : 4, SURF.iron, PART.frame, [0.22, 0.23, 0.24], {});
    k.box(-0.14, 6.68, 1.35, 0.14, 6.86, 1.95, SURF.iron, PART.frame, [0.2, 0.21, 0.22], {});
    k.box(-0.11, 6.62, 1.4, 0.11, 6.68, 1.9, SURF.glass, PART.lantern, [0.95, 0.9, 0.8], {});
    head = [0, 6.55, 1.65];
  }
  return { geo: k.build(), head };
}
