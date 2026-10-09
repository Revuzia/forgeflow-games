// GENESIS — near-camera ground cover (CONTRACT.md §15.6 "near-camera grass blades (GPU instanced) by quality"): grass
// tufts where the sim's `grass` cover is, stones where the soil is thin or the ground is rock, within a few tens of
// metres of the camera. Without it the ground at 20–100 m reads as clay or felt however good its material. Also:
//   * crops in rows on the fields (`crop` / `cropSpecies`: wheat, rice, maize, flax), each field sown at its own date,
//     growing through the year at draw time — green shoots, full green, ripening gold, stubble, bare in winter;
//   * wildflower patches in meadows (in bloom spring to late summer);
//   * under the canopy: ferns where it is moist, fallen logs, mushrooms in autumn;
//   * reeds in the shallows of fresh water.
//
//   * Placement is deterministic and anchored to the planet: each sim cell owns a jittered lattice in its own tangent
//     frame (0.6 m), and a lattice point belongs to the cell that dominates its sim triangle (largest barycentric
//     weight) — the cells partition the sphere, so neighbours never double up or leave seams. Points are kept or not
//     by hashed thresholds against the INTERPOLATED fields (grass, soil, sand, snow, water, road), so meadow edges
//     follow the field smoothly; height from groundHeight() — the sim's own ground function — so tufts stand on the
//     drawn ground. Cached per cell with a quantised signature of the fields it was built from (the cell and its
//     neighbours): a snapshot that bumps a field version (water does so on most snapshots wherever a river runs)
//     re-checks the signatures and rebuilds only the cells whose inputs really changed, a couple per frame, drawing
//     their previous scatter until then (no flicker); cells far behind the camera are evicted.
//   * Drawn as InstancedMeshes with the vegetation material (sun, shadows received, sky ambient, wind sway); whole
//     instances shrink into the ground across a hand-over band at the edge of the range (no popping, no speckle).
//     Ground cover casts no shadows (too small to matter at the cascade resolutions).

import { Color, Group, InstancedMesh, Matrix4, DynamicDrawUsage, type IUniform } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { newHit } from '../../sim/grid/icogrid.ts';
import { CROP_TYPES, cropClump, fallenLog, flowerClump, grassTuft, mushrooms, stone } from '../gen/groundgen.ts';
import { treeGeometry } from '../gen/treegen.ts';
import { BASE_PACK } from '../../data/index.ts';
import type { BufferGeometry } from 'three';
import { leafClusterTexture } from '../gen/leaftex.ts';
import { makeVegMaterial } from './vegetation.ts';
import type { Vector3 } from 'three';

/** floats per cached item: dir xyz, ground radius, yaw, scale, kind, variant, tint r g b (crops: phase, height, -) */
const REC = 11;
const VARIANTS = 3;
/** item kinds */
const GK = { grass: 0, stone: 1, flower: 2, fern: 3, log: 4, reed: 5, crop: 6, mushroom: 7 } as const;
const KIND_COUNT = 8;
/** variants per kind (crops: 4 types × 2) */
const KVARS = [VARIANTS, VARIANTS, 5, 2, 2, 2, 8, 3];
/** crop type of each plants.json index (crop forms: grain → wheat / flax, paddy → rice, stalk → maize) */
const CROP_OF: number[] = (BASE_PACK.plants ?? []).map((p) => {
  const f = String(p.form ?? ''), id = String(p.id ?? '');
  return f === 'paddy' ? 1 : f === 'stalk' ? 2 : id === 'flax' ? 3 : 0;
});
const CROP_H = [1.0, 0.95, 2.4, 0.85];

// The terrain draws farmland as fields (cells of voronoi3(P · 0.019 + 3.7), ~50 m) each with its own phase through
// the year and a kind (k = ⌊id · 5⌋: k ≥ 4 pasture); the crops stand in exactly those fields at exactly those stages.
// A float32 port of noise.glsl's gn_hash13 / gn_hash33 / voronoi3 (the ids agree with the GPU's away from borders).
const f32 = Math.fround;
const fr = (x: number) => x - Math.floor(x);
function gnHash13(x: number, y: number, z: number): number {
  x = fr(f32(x * 0.1031)); y = fr(f32(y * 0.1031)); z = fr(f32(z * 0.1031));
  const d = f32(x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32));
  x = f32(x + d); y = f32(y + d); z = f32(z + d);
  return fr(f32((x + y) * z));
}
const _h3: [number, number, number] = [0, 0, 0];
function gnHash33(x: number, y: number, z: number): [number, number, number] {
  x = fr(f32(x * 0.1031)); y = fr(f32(y * 0.103)); z = fr(f32(z * 0.0973));
  const d = f32(x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33));
  x = f32(x + d); y = f32(y + d); z = f32(z + d);
  _h3[0] = fr(f32((x + y) * z)); _h3[1] = fr(f32((x + x) * y)); _h3[2] = fr(f32((y + x) * x));
  return _h3;
}
/** the terrain's farm-field id (0..1) at a body-frame point (m) */
function fieldId(px: number, py: number, pz: number): number {
  const x = f32(px * 0.019 + 3.7), y = f32(py * 0.019 + 3.7), z = f32(pz * 0.019 + 3.7);
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  let f1 = 8, id = 0;
  for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const h = gnHash33(ix + ox, iy + oy, iz + oz);
    const rx = ox + h[0] - fx, ry = oy + h[1] - fy, rz = oz + h[2] - fz;
    const d = rx * rx + ry * ry + rz * rz;
    if (d < f1) { f1 = d; id = gnHash13(ix + ox + 0.37, iy + oy + 0.37, iz + oz + 0.37); }
  }
  return id;
}
/** metres: crops are drawn this close (shrinking away over the last third) */
const CROP_RANGE = 26;
/** metres: beyond CROP_RANGE, fields carry sparser, wider clumps in their rows out to here (a god camera at 60–150 m
 *  saw only yellow-green smears where fourteen maize fields stood) */
const FAR_CROP_RANGE = 150;
/** far-crop lattice: rows 1.2 m apart (as the near crop rows), clumps every 1.5 m along them */
const FAR_ROW = 1.2, FAR_ALONG = 1.5;
/** lattice step (m) of candidate points */
const STEP = 0.6;
/** fields the scatter reads (placement and kind; tint follows moisture / temperature but only re-tints on rebuild) */
const SIG_FIELDS = ['grass', 'soil', 'sand', 'snow', 'water', 'road', 'surface', 'tree', 'crop', 'cropSpecies'] as const;
/** quantisation steps of SIG_FIELDS */
const SIG_STEP = [0.04, 0.03, 0.03, 0.02, 0.02, 0.05, 0.03, 0.04, 0.04, 1];
/** values are clamped to this before quantising: whether a cell is dry or a few cm wet matters to the scatter at its
 *  edge, a deep river rising and falling does not (and would otherwise rebuild every river cell on every snapshot) */
const SIG_MAX = [9, 9, 9, 9, 1, 9, 1e9, 9, 9, 99];

const _m = new Matrix4();
const _c = new Color();
const _hit = newHit();

export class GroundCover {
  readonly group = new Group();
  /** metres: full range (instances shrink away over the last 30 %) */
  range = 34;
  enabled = true;
  readonly fade: IUniform<{ x: number; y: number }> = { value: { x: 24, y: 34 } };
  stats = { instances: 0, cells: 0 };
  /** meshes per kind × variant */
  private meshes: InstancedMesh[][] = [];
  /** calendar year fraction (crops grow, flowers bloom, mushrooms in autumn) — set by the planet visual */
  yearFrac = 0.3;
  private cache = new Map<number, { rec: Float32Array; sig: number }>();
  /** cached cells whose signature changed: still drawn, rebuilt within the per-frame budget */
  private stale = new Set<number>();
  private stamp = '';
  private lastCam: [number, number, number] = [1e9, 0, 0];
  private lastFrame = -1e9;
  /** cells left unbuilt by the per-frame budget: keep updating until they are in */
  private pending = false;
  /** the near scatter (grass, stones, flowers, near crops...) and the far crop rows, shown independently */
  private near = new Group();
  private far = new Group();
  readonly farFade: IUniform<{ x: number; y: number }> = { value: { x: FAR_CROP_RANGE * 0.8, y: FAR_CROP_RANGE } };
  private farMeshes: InstancedMesh[] = [];
  private farCache = new Map<number, Float32Array>();
  private farLast: [number, number, number] = [1e9, 0, 0];
  private farLastFrame = -1e9;

  constructor(shared: Record<string, IUniform>) {
    this.group.name = 'groundcover';
    this.group.matrixAutoUpdate = false;
    const leafTex = { value: leafClusterTexture() };
    const mat = makeVegMaterial(shared, this.fade, leafTex);
    this.group.add(this.near, this.far);
    // far crop rows: the crop clumps with their own fade band
    const farMat = makeVegMaterial(shared, this.farFade, leafTex);
    for (let v = 0; v < KVARS[GK.crop]; v++) {
      const m = new InstancedMesh(cropClump(CROP_TYPES[v >> 1], v & 1), farMat, 6000);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.far.add(m);
      this.farMeshes.push(m);
    }
    const geo = (k: number, v: number): [BufferGeometry, number] => {
      switch (k) {
        case GK.grass: return [grassTuft(v), 6000];
        case GK.stone: return [stone(v), 1200];
        case GK.flower: return [flowerClump(v), 1500];
        case GK.fern: return [treeGeometry('fern', 1, v), 800];
        case GK.log: return [fallenLog(v), 200];
        case GK.reed: return [treeGeometry('reed', 1, v), 1200];
        case GK.crop: return [cropClump(CROP_TYPES[v >> 1], v & 1), 4000];
        default: return [mushrooms(v), 300];
      }
    };
    for (let k = 0; k < KIND_COUNT; k++) {
      const row: InstancedMesh[] = [];
      for (let v = 0; v < KVARS[k]; v++) {
        const [g, cap] = geo(k, v);
        const m = new InstancedMesh(g, mat, cap);
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        m.count = 0;
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        this.near.add(m);
        row.push(m);
      }
      this.meshes.push(row);
    }
  }

  /**
   * Quantised fingerprint of what cell c's scatter is built from (c and its neighbours, since points near the cell's
   * edge interpolate them): changes below the steps (a few cm of water in a deep river, a grass fraction drifting by
   * 0.01) do not trigger a rebuild; a cell flooding or drying, snow arriving, a meadow growing or the ground moving do.
   */
  private signature(pv: PlanetView, c: number): number {
    const g = pv.grid;
    let sig = 0;
    for (let k = 0; k < SIG_FIELDS.length; k++) {
      const f = pv.fields.get(SIG_FIELDS[k] as never) as Float32Array | undefined;
      if (!f) continue;
      const q = SIG_STEP[k], mx = SIG_MAX[k];
      let acc = Math.floor(Math.min(f[c], mx) / q);
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) acc = (acc * 31 + Math.floor(Math.min(f[g.nbr[e]], mx) / q)) | 0;
      sig = (Math.imul(sig, 0x9e3779b1) + acc + k) | 0;
    }
    return sig;
  }

  /** build the ground cover of one cell (deterministic: the same fields give the same scatter) */
  private cellItems(pv: PlanetView, c: number): Float32Array {
    const g = pv.grid;
    const R = pv.params.radius;
    const F = (n: string) => pv.fields.get(n as never) as Float32Array | undefined;
    const grassF = F('grass'), soil = F('soil'), sand = F('sand'), snow = F('snow'), water = F('water'), road = F('road');
    const moist = F('moisture'), temp = F('temperature'), tree = F('tree'), crop = F('crop'), cropSp = F('cropSpecies'), sal = F('salinity');
    const surfF = F('surface');
    const seaLevel = pv.params.seaLevel ?? 0;
    const out: number[] = [];
    const P = g.pos;
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    let ex = cz, ez = -cx;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = cy * ez, ny = cz * ex - cx * ez, nz = -cy * ex;
    const spacing = Math.sqrt(g.area[c] * R * R);
    const half = Math.ceil((spacing * 0.8) / STEP);
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) {
        const k = (j + half) * (2 * half + 1) + (i + half);
        const u = (i + (hashFloat(c, k, 3) - 0.5) * 0.8) * STEP;
        const v = (j + (hashFloat(c, k, 4) - 0.5) * 0.8) * STEP;
        let dx = cx + (ex * u + nx * v) / R, dy = cy + (ny * v) / R, dz = cz + (ez * u + nz * v) / R;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const h = g.locate(dx, dy, dz, _hit);
        // the cell that dominates this point's sim triangle owns it (a partition of the sphere)
        const owner = h.wa >= h.wb && h.wa >= h.wc ? h.a : h.wb >= h.wc ? h.b : h.c;
        if (owner !== c) continue;
        const at = (f: Float32Array | undefined) => (f ? f[h.a] * h.wa + f[h.b] * h.wb + f[h.c] * h.wc : 0);
        const wat = at(water);
        const r1 = hashFloat(c, k, 5), r2 = hashFloat(c, k, 6), r3 = hashFloat(c, k, 14);
        // reeds in the shallows of FRESH water (lake and river margins, marsh): above sea level, not salt, not in a
        // harbour or a street
        if (wat > 0.02) {
          // (judged on the owning cell, not the interpolation: a beach point between land and sea cells is not a lake)
          const fresh = water![c] > 0.02 && (!surfF || surfF[c] > seaLevel + 0.3) && (!sal || sal[c] < 0.4);
          if (fresh && wat < 0.55 && at(road) < 0.25 && r1 < 0.2 && at(snow) < 0.05) {
            const gh = groundHeight(pv.ground, dx, dy, dz);
            // standing IN the water: the drawn ground here lies a little below the water's surface
            const depth = R + (surfF ? at(surfF) : 0) + wat - gh;
            if (depth < 0.04 || depth > 0.7) continue;
            out.push(dx, dy, dz, gh, hashFloat(c, k, 7) * Math.PI * 2, 1.2 + r2 * 1.0, GK.reed, Math.floor(r3 * 2), 0.9 + 0.15 * r2, 1.0, 0.8);
          }
          continue;
        }
        if (at(snow) > 0.08 || at(road) > 0.5) continue;
        const gr = at(grassF), so = at(soil), sa = at(sand), cr = at(crop), tr = at(tree), mo = at(moist);
        let kind = -1;
        // crops in rows on the fields (the lattice is the rows); the clump's type from the cell's crop species
        let fid = -1;
        if (cr > 0.4) {
          const gh0 = groundHeight(pv.ground, dx, dy, dz);
          fid = fieldId(dx * gh0, dy * gh0, dz * gh0);
          // pasture fields (the terrain's k ≥ 4) are grazed grass, not sown
          if (Math.floor(fid * 5) < 4) {
            // sown in rows 1.2 m apart (every other lattice row; the row direction turns from field to field)
            if ((j & 1) !== 0 || r1 > Math.min(1, cr * 1.15)) continue;
            kind = GK.crop;
          }
        }
        // (a pasture field is a meadow to the ground cover)
        const crG = fid >= 0 ? 0 : cr;
        if (kind < 0) {
          // under the canopy: ferns where it is moist, fallen branches and logs, mushrooms
          if (tr > 0.45 && r1 < 0.07 * Math.min(1, mo * 1.6) * (tr - 0.3)) kind = GK.fern;
          else if (tr > 0.5 && r1 > 0.988) kind = GK.log;
          else if (tr > 0.45 && r2 > 0.992) kind = GK.mushroom;
          // tufts where the sward is (thinner under a closed canopy and on fields)
          else if (r1 < Math.min(1, gr * 1.25) * (1 - 0.5 * tr) * (1 - 0.7 * crG) && sa < 0.45) {
            // wildflower patches in meadows (a coarse patch hash decides where they grow)
            const patch = hashFloat(Math.floor(u / 7) + 977 * c, Math.floor(v / 7), 41);
            kind = gr > 0.35 && tr < 0.3 && crG < 0.2 && patch < 0.35 && r3 < 0.18 ? GK.flower : GK.grass;
          }
          // stones where the soil is thin: bare rock, scree, stony ground (beaches keep a few)
          else if (r2 < 0.06 + 0.22 * Math.max(0, 1 - so / 0.25) * (1 - Math.min(1, sa / 0.8)) + 0.03 * Math.min(1, sa)) kind = GK.stone;
        }
        if (kind < 0) continue;
        const gh = groundHeight(pv.ground, dx, dy, dz);
        const yaw = hashFloat(c, k, 7) * Math.PI * 2;
        const variant = Math.floor(hashFloat(c, k, 8) * VARIANTS) % VARIANTS;
        if (kind === GK.crop) {
          const sp = cropSp ? Math.round(cropSp[h.wa >= h.wb && h.wa >= h.wc ? h.a : h.wb >= h.wc ? h.b : h.c]) : -1;
          const type = sp >= 0 && sp < CROP_OF.length ? CROP_OF[sp] : 0;
          // record the terrain field's id: its phase through the year and its kind (hay / tilled after harvest)
          out.push(dx, dy, dz, gh, (hashFloat(c, 3) * 4 | 0) * Math.PI / 2 + (r3 - 0.5) * 0.3, CROP_H[type] * (0.85 + 0.3 * r2), GK.crop, type * 2 + (r3 < 0.5 ? 0 : 1), fid, 0, 0);
          continue;
        }
        if (kind === GK.fern) { out.push(dx, dy, dz, gh, yaw, 0.6 + 0.7 * r2, GK.fern, Math.floor(r3 * 2), 0.95, 1.0, 0.9); continue; }
        if (kind === GK.log) { out.push(dx, dy, dz, gh, yaw, 1.5 + 2.5 * r2, GK.log, Math.floor(r3 * 2), 0.9 + 0.2 * r2, 0.9 + 0.15 * r2, 0.85); continue; }
        if (kind === GK.mushroom) { out.push(dx, dy, dz, gh, yaw, 1.0, GK.mushroom, Math.floor(r3 * 3), 1, 1, 1); continue; }
        if (kind === GK.flower) { out.push(dx, dy, dz, gh, yaw, 0.7 + 0.5 * r2, GK.flower, Math.floor(hashFloat(Math.floor(u / 7) + 31 * c, Math.floor(v / 7), 43) * 5), 1, 1, 1); continue; }
        if (kind === 0) {
          // height by moisture and warmth; colour like the terrain's sward (lush ↔ dry), with per-tuft variation
          const m = at(moist), t = at(temp);
          const lush = Math.min(1, Math.max(0, (m - 0.22) / 0.4));
          const cold = Math.min(1, Math.max(0, (9 - t) / 12));
          const s = (0.25 + 0.45 * lush) * (0.7 + 0.6 * hashFloat(c, k, 9)) * (1 - 0.4 * cold);
          const jit = 0.85 + 0.3 * hashFloat(c, k, 10);
          let rr = 0.25 + (0.06 - 0.25) * lush, gg = 0.21 + (0.115 - 0.21) * lush, bb = 0.115 + (0.03 - 0.115) * lush;
          rr += (0.12 - rr) * cold * 0.7; gg += (0.125 - gg) * cold * 0.7; bb += (0.065 - bb) * cold * 0.7;
          out.push(dx, dy, dz, gh, yaw, s, 0, variant, rr * jit, gg * jit, bb * jit);
        } else {
          const s = 0.05 + 0.22 * Math.pow(hashFloat(c, k, 11), 2.2);
          // weathered field stone: warm grey-brown, some with lichen (pale coins of grey read as litter on the grass)
          const tone = 0.75 + 0.5 * hashFloat(c, k, 12);
          const lichen = hashFloat(c, k, 13) < 0.35 ? 0.5 : 0;
          out.push(dx, dy, dz, gh, yaw, s, 1, variant, (0.2 + (0.19 - 0.2) * lichen) * tone, (0.18 + (0.19 - 0.18) * lichen) * tone, (0.15 + (0.11 - 0.15) * lichen) * tone);
        }
      }
    }
    return Float32Array.from(out);
  }

  /** refresh instances around the camera (body frame, m); quick when the camera has not moved */
  update(pv: PlanetView, camBody: Vector3, frame: number): void {
    let stamp = '';
    for (const k of SIG_FIELDS) stamp += (pv.fieldVersion.get(k as never) ?? 0) + '|';
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      for (const [c, e] of this.cache) if (!this.stale.has(c) && this.signature(pv, c) !== e.sig) this.stale.add(c);
      if (this.stale.size) this.pending = true;
    }
    const R = pv.params.radius;
    const rc = camBody.length();
    const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
    const alt = rc - groundHeight(pv.ground, dx, dy, dz);
    const range = this.range;
    this.fade.value.x = range * 0.7;
    this.fade.value.y = range;
    const visible = this.enabled && alt < range * 1.5;
    this.group.visible = this.enabled;
    this.near.visible = visible;
    this.updateFar(pv, camBody, frame, alt);
    if (!visible) { this.stats.instances = 0; return; }
    const moved = Math.hypot(camBody.x - this.lastCam[0], camBody.y - this.lastCam[1], camBody.z - this.lastCam[2]);
    if (!this.pending && moved < 1.2 && frame - this.lastFrame < 240) return;
    this.lastCam = [camBody.x, camBody.y, camBody.z];
    this.lastFrame = frame;
    // nearest cells first, and at most ~two new cells' worth of scatter per frame (a cell costs ~20 ms): arriving at
    // the ground spreads the work over a few frames instead of one long stall; the rest follows on the next frames
    const cells = pv.grid.cellsWithin(dx, dy, dz, (range + 40) / R).slice();
    const P = pv.grid.pos;
    cells.sort((a, b) => (P[b * 3] * dx + P[b * 3 + 1] * dy + P[b * 3 + 2] * dz) - (P[a * 3] * dx + P[a * 3 + 1] * dy + P[a * 3 + 2] * dz));
    let built = 0;
    this.pending = false;
    const counts = this.meshes.map((row) => row.map(() => 0));
    let total = 0;
    // the season at the camera's hemisphere: crops sprout, grow, ripen and are cut; flowers bloom in spring and
    // summer; mushrooms come up in autumn
    const yfH = dy >= 0 ? this.yearFrac : (this.yearFrac + 0.5) % 1;
    const bloom = Math.min(1, Math.max(0, (yfH - 0.12) / 0.08)) * Math.min(1, Math.max(0, (0.62 - yfH) / 0.08));
    const fungi = yfH > 0.5 && yfH < 0.8 ? 1 : 0;
    for (const c of cells) {
      let entry = this.cache.get(c);
      if (!entry || this.stale.has(c)) {
        if (built < 2) {
          built++;
          entry = { rec: this.cellItems(pv, c), sig: this.signature(pv, c) };
          this.cache.set(c, entry);
          this.stale.delete(c);
        } else {
          this.pending = true;
          if (!entry) continue;
        }
      }
      const rec = entry.rec;
      for (let i = 0; i < rec.length; i += REC) {
        const gr = rec[i + 3];
        const px = rec[i] * gr, py = rec[i + 1] * gr, pz = rec[i + 2] * gr;
        const d = Math.hypot(px - camBody.x, py - camBody.y, pz - camBody.z);
        if (d > range) continue;
        const kind = rec[i + 6], variant = rec[i + 7];
        const mesh = this.meshes[kind]?.[variant];
        if (!mesh || counts[kind][variant] >= mesh.instanceMatrix.count) continue;
        let grow = 1;
        let cr = rec[i + 8], cg = rec[i + 9], cb = rec[i + 10];
        if (kind === GK.crop) {
          // crops only near the camera (dense rows are many instances); beyond, the terrain's field shading
          if (d > CROP_RANGE) continue;
          grow *= 1 - Math.min(1, Math.max(0, (d - CROP_RANGE * 0.65) / (CROP_RANGE * 0.35)));
          // the terrain field's stage (terrainmat: ph = fract(yf + id · 0.15)): tilled → young green → ripe → hay
          // stubble or tilled again; the crop sprouts at the end of tillage and grows through the green stage
          const fid = rec[i + 8];
          const yfP = rec[i + 1] >= 0 ? this.yearFrac : (this.yearFrac + 0.5) % 1;
          const ph = (yfP + fid * 0.15) % 1;
          const k = Math.floor(fid * 5);
          if (ph < 0.11 || (ph >= 0.7 && k >= 2.5)) continue;
          grow *= ph < 0.15 ? 0.1 : ph < 0.45 ? 0.15 + 0.85 * Math.min(1, (ph - 0.15) / 0.24) : ph < 0.7 ? 1 : 0.16;
          const ripe = Math.min(1, Math.max(0, (ph - 0.45) / 0.07));
          // albedo-scale tints (the clump's vertex shade is ~0.85): green, then gold (maize a paler straw)
          const g0: [number, number, number] = [0.08, 0.15, 0.035];
          const g1: [number, number, number] = variant >> 1 === 2 ? [0.34, 0.29, 0.13] : [0.42, 0.31, 0.095];
          const hay: [number, number, number] = [0.28, 0.24, 0.1];
          const k2 = ph >= 0.7 ? 1 : 0;
          cr = (g0[0] + (g1[0] - g0[0]) * ripe) * (1 - k2) + hay[0] * k2; cg = (g0[1] + (g1[1] - g0[1]) * ripe) * (1 - k2) + hay[1] * k2; cb = (g0[2] + (g1[2] - g0[2]) * ripe) * (1 - k2) + hay[2] * k2;
        } else if (kind === GK.flower) { if (bloom <= 0.01) continue; grow = bloom; }
        else if (kind === GK.mushroom && !fungi) continue;
        // basis: up = radial, yaw about it, uniform scale (stones a little sunk)
        const ux = rec[i], uy = rec[i + 1], uz = rec[i + 2];
        let ex = uz, ez = -ux;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el; ez /= el;
        const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
        const cy = Math.cos(rec[i + 4]), sy = Math.sin(rec[i + 4]);
        const ax = ex * cy + nx * sy, ay = ny * sy, az = ez * cy + nz * sy;
        const bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux;
        const s = rec[i + 5] * grow;
        const sink = kind === GK.stone ? s * 0.35 : kind === GK.log ? 0.05 : kind === GK.reed ? 0.3 : 0.02;
        _m.set(
          ax * s, ux * s, bx * s, px - ux * sink,
          ay * s, uy * s, by * s, py - uy * sink,
          az * s, uz * s, bz * s, pz - uz * sink,
          0, 0, 0, 1,
        );
        mesh.setMatrixAt(counts[kind][variant], _m);
        _c.setRGB(cr, cg, cb);
        mesh.setColorAt(counts[kind][variant], _c);
        counts[kind][variant]++;
        total++;
      }
    }
    for (let k = 0; k < this.meshes.length; k++) for (let v = 0; v < this.meshes[k].length; v++) {
      const mesh = this.meshes[k][v], n = counts[k][v];
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.stats.instances = total;
    this.stats.cells = cells.length;
    // keep the cache to the neighbourhood (a long low flight would otherwise keep every cell it passed)
    if (this.cache.size > cells.length * 3 + 16) {
      const near = new Set(cells);
      for (const c of this.cache.keys()) if (!near.has(c)) { this.cache.delete(c); this.stale.delete(c); }
    }
  }

  /**
   * Far crop rows (CROP_RANGE … FAR_CROP_RANGE): only the sown fields, on a coarse lattice of the near rows' own
   * spacing and orientation, each clump widened along its row so the rows read as rows; same field ids and stages as
   * the terrain and the near crops. Rebuilt when the camera moves ~10 m.
   */
  private updateFar(pv: PlanetView, camBody: Vector3, frame: number, alt: number): void {
    const on = this.enabled && alt < FAR_CROP_RANGE * 1.4;
    this.far.visible = on;
    if (!on) return;
    const moved = Math.hypot(camBody.x - this.farLast[0], camBody.y - this.farLast[1], camBody.z - this.farLast[2]);
    if (moved < 10 && frame - this.farLastFrame < 300) return;
    this.farLast = [camBody.x, camBody.y, camBody.z];
    this.farLastFrame = frame;
    const crop = pv.fields.get('crop' as never) as Float32Array | undefined;
    const counts = this.farMeshes.map(() => 0);
    if (crop) {
      const R = pv.params.radius;
      const rc = camBody.length();
      const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
      const cells = pv.grid.cellsWithin(dx, dy, dz, (FAR_CROP_RANGE + 40) / R);
      let built = 0;
      for (const c of cells) {
        if (crop[c] < 0.3) continue;
        let rec = this.farCache.get(c);
        if (!rec) {
          if (built >= 3) continue;
          built++;
          rec = this.farCellItems(pv, c);
          this.farCache.set(c, rec);
        }
        for (let i = 0; i < rec.length; i += 7) {
          const gh = rec[i + 3];
          const px = rec[i] * gh, py = rec[i + 1] * gh, pz = rec[i + 2] * gh;
          const d = Math.hypot(px - camBody.x, py - camBody.y, pz - camBody.z);
          if (d > FAR_CROP_RANGE || d < CROP_RANGE * 0.7) continue;
          const variant = rec[i + 6];
          const st = cropStage(rec[i + 5], rec[i + 1] >= 0 ? this.yearFrac : (this.yearFrac + 0.5) % 1, variant);
          if (!st) continue;
          // hand-over with the near crops (they shrink away over CROP_RANGE · 0.65 … CROP_RANGE)
          const grow = st.grow * Math.min(1, Math.max(0, (d - CROP_RANGE * 0.7) / (CROP_RANGE * 0.3)));
          if (grow <= 0.01) continue;
          const m = this.farMeshes[variant];
          if (!m || counts[variant] >= m.instanceMatrix.count) continue;
          const ux = rec[i], uy = rec[i + 1], uz = rec[i + 2];
          let ex = uz, ez = -ux;
          const el = Math.hypot(ex, ez) || 1;
          ex /= el; ez /= el;
          const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
          const cy = Math.cos(rec[i + 4]), sy = Math.sin(rec[i + 4]);
          const ax = ex * cy + nx * sy, ay = ny * sy, az = ez * cy + nz * sy;
          const bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux;
          const h = CROP_H[variant >> 1] * grow, wa = 2.4 * Math.max(0.5, grow), wb = 1.7 * Math.max(0.5, grow);
          _m.set(
            ax * wa, ux * h, bx * wb, px - ux * 0.02,
            ay * wa, uy * h, by * wb, py - uy * 0.02,
            az * wa, uz * h, bz * wb, pz - uz * 0.02,
            0, 0, 0, 1,
          );
          m.setMatrixAt(counts[variant], _m);
          m.setColorAt(counts[variant], _c.setRGB(st.r, st.g, st.b));
          counts[variant]++;
        }
      }
      if (built >= 3) this.farLastFrame = -1e9;
      if (this.farCache.size > cells.length + 64) { const keep = new Set(cells); for (const c of this.farCache.keys()) if (!keep.has(c)) this.farCache.delete(c); }
    }
    this.farMeshes.forEach((m, v) => {
      m.count = counts[v];
      m.visible = counts[v] > 0;
      if (counts[v]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    });
  }

  /** a cell's far crop points: [ux, uy, uz, ground radius, yaw (along the row), field id, variant] per clump */
  private farCellItems(pv: PlanetView, c: number): Float32Array {
    const g = pv.grid;
    const R = pv.params.radius;
    const crop = pv.fields.get('crop' as never) as Float32Array | undefined;
    const cropSp = pv.fields.get('cropSpecies' as never) as Float32Array | undefined;
    const road = pv.fields.get('road' as never) as Float32Array | undefined;
    const out: number[] = [];
    const P = g.pos;
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    let ex = cz, ez = -cx;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = cy * ez, ny = cz * ex - cx * ez, nz = -cy * ex;
    const spacing = Math.sqrt(g.area[c] * R * R);
    const hu = Math.ceil((spacing * 0.8) / FAR_ALONG), hv = Math.ceil((spacing * 0.8) / FAR_ROW);
    for (let j = -hv; j <= hv; j++) {
      for (let i = -hu; i <= hu; i++) {
        const k = (j + hv) * (2 * hu + 1) + (i + hu);
        const u = (i + (hashFloat(c, k, 21) - 0.5) * 0.3) * FAR_ALONG;
        const v = j * FAR_ROW;
        let dx = cx + (ex * u + nx * v) / R, dy = cy + (ny * v) / R, dz = cz + (ez * u + nz * v) / R;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const h = g.locate(dx, dy, dz, _hit);
        const owner = h.wa >= h.wb && h.wa >= h.wc ? h.a : h.wb >= h.wc ? h.b : h.c;
        if (owner !== c) continue;
        const at = (f: Float32Array | undefined) => (f ? f[h.a] * h.wa + f[h.b] * h.wb + f[h.c] * h.wc : 0);
        const cr = at(crop);
        if (cr < 0.4 || at(road) > 0.5 || hashFloat(c, k, 22) > Math.min(1, cr * 1.15)) continue;
        const gh = groundHeight(pv.ground, dx, dy, dz);
        const fid = fieldId(dx * gh, dy * gh, dz * gh);
        if (Math.floor(fid * 5) >= 4) continue;
        const sp = cropSp ? Math.round(cropSp[owner]) : -1;
        const type = sp >= 0 && sp < CROP_OF.length ? CROP_OF[sp] : 0;
        // along the row: the lattice's own u axis (yaw 0), the row orientation of the near crops' lattice
        out.push(dx, dy, dz, gh, (hashFloat(c, k, 23) - 0.5) * 0.15, fid, type * 2 + (hashFloat(c, k, 24) < 0.5 ? 0 : 1));
      }
    }
    return Float32Array.from(out);
  }

  dispose(): void {
    for (const row of this.meshes) for (const m of row) { m.geometry.dispose(); m.dispose(); }
    for (const m of this.farMeshes) { m.geometry.dispose(); m.dispose(); }
  }
}

/** a crop clump's stage on its field (the terrain's ph = fract(yf + id · 0.15)): null = nothing standing */
function cropStage(fid: number, yf: number, variant: number): { grow: number; r: number; g: number; b: number } | null {
  const ph = (yf + fid * 0.15) % 1;
  const k = Math.floor(fid * 5);
  if (ph < 0.11 || (ph >= 0.7 && k >= 2.5)) return null;
  const grow = ph < 0.15 ? 0.1 : ph < 0.45 ? 0.15 + 0.85 * Math.min(1, (ph - 0.15) / 0.24) : ph < 0.7 ? 1 : 0.16;
  const ripe = Math.min(1, Math.max(0, (ph - 0.45) / 0.07));
  const g0 = [0.08, 0.15, 0.035];
  const g1 = variant >> 1 === 2 ? [0.34, 0.29, 0.13] : [0.42, 0.31, 0.095];
  const hay = [0.28, 0.24, 0.1];
  const k2 = ph >= 0.7 ? 1 : 0;
  const mixc = (i: number) => (g0[i] + (g1[i] - g0[i]) * ripe) * (1 - k2) + hay[i] * k2;
  return { grow, r: mixc(0), g: mixc(1), b: mixc(2) };
}
