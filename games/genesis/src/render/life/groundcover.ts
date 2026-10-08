// GENESIS — near-camera ground cover (CONTRACT.md §15.6 "near-camera grass blades (GPU instanced) by quality"): grass
// tufts where the sim's `grass` cover is, stones where the soil is thin or the ground is rock, within a few tens of
// metres of the camera. Without it the ground at 20–100 m reads as clay or felt however good its material.
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
import { grassTuft, stone } from '../gen/groundgen.ts';
import { leafClusterTexture } from '../gen/leaftex.ts';
import { makeVegMaterial } from './vegetation.ts';
import type { Vector3 } from 'three';

/** floats per cached item: dir xyz, ground radius, yaw, scale, kind (0 grass, 1 stone), variant, tint r g b */
const REC = 11;
const VARIANTS = 3;
/** lattice step (m) of candidate points */
const STEP = 0.6;
/** fields the scatter reads (placement and kind; tint follows moisture / temperature but only re-tints on rebuild) */
const SIG_FIELDS = ['grass', 'soil', 'sand', 'snow', 'water', 'road', 'surface', 'tree', 'crop'] as const;
/** quantisation steps of SIG_FIELDS */
const SIG_STEP = [0.04, 0.03, 0.03, 0.02, 0.02, 0.05, 0.03, 0.04, 0.04];
/** values are clamped to this before quantising: whether a cell is dry or a few cm wet matters to the scatter at its
 *  edge, a deep river rising and falling does not (and would otherwise rebuild every river cell on every snapshot) */
const SIG_MAX = [9, 9, 9, 9, 1, 9, 1e9, 9, 9];

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
  private grass: InstancedMesh[] = [];
  private stones: InstancedMesh[] = [];
  private cache = new Map<number, { rec: Float32Array; sig: number }>();
  /** cached cells whose signature changed: still drawn, rebuilt within the per-frame budget */
  private stale = new Set<number>();
  private stamp = '';
  private lastCam: [number, number, number] = [1e9, 0, 0];
  private lastFrame = -1e9;
  /** cells left unbuilt by the per-frame budget: keep updating until they are in */
  private pending = false;

  constructor(shared: Record<string, IUniform>) {
    this.group.name = 'groundcover';
    this.group.matrixAutoUpdate = false;
    const mat = makeVegMaterial(shared, this.fade, { value: leafClusterTexture() });
    for (let v = 0; v < VARIANTS; v++) {
      const g = new InstancedMesh(grassTuft(v), mat, 6000);
      const s = new InstancedMesh(stone(v), mat, 1200);
      for (const m of [g, s]) {
        m.instanceMatrix.setUsage(DynamicDrawUsage);
        m.count = 0;
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
      this.grass.push(g);
      this.stones.push(s);
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
    const moist = F('moisture'), temp = F('temperature'), tree = F('tree'), crop = F('crop');
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
        if (at(water) > 0.02 || at(snow) > 0.08 || at(road) > 0.5) continue;
        const r1 = hashFloat(c, k, 5), r2 = hashFloat(c, k, 6);
        const gr = at(grassF), so = at(soil), sa = at(sand), cr = at(crop), tr = at(tree);
        let kind = -1;
        // tufts where the sward is (thinner under a closed canopy and on fields)
        if (r1 < Math.min(1, gr * 1.25) * (1 - 0.5 * tr) * (1 - 0.7 * cr) && sa < 0.45) kind = 0;
        // stones where the soil is thin: bare rock, scree, stony ground (beaches keep a few)
        else if (r2 < 0.06 + 0.22 * Math.max(0, 1 - so / 0.25) * (1 - Math.min(1, sa / 0.8)) + 0.03 * Math.min(1, sa)) kind = 1;
        if (kind < 0) continue;
        const gh = groundHeight(pv.ground, dx, dy, dz);
        const yaw = hashFloat(c, k, 7) * Math.PI * 2;
        const variant = Math.floor(hashFloat(c, k, 8) * VARIANTS) % VARIANTS;
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
          const tone = 0.75 + 0.5 * hashFloat(c, k, 12);
          out.push(dx, dy, dz, gh, yaw, s, 1, variant, 0.32 * tone, 0.3 * tone, 0.27 * tone);
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
    this.group.visible = visible;
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
    const counts = new Array<number>(VARIANTS * 2).fill(0);
    let total = 0;
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
        const slot = kind * VARIANTS + variant;
        const mesh = kind === 0 ? this.grass[variant] : this.stones[variant];
        if (counts[slot] >= mesh.instanceMatrix.count) continue;
        // basis: up = radial, yaw about it, uniform scale (stones a little sunk)
        const ux = rec[i], uy = rec[i + 1], uz = rec[i + 2];
        let ex = uz, ez = -ux;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el; ez /= el;
        const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
        const cy = Math.cos(rec[i + 4]), sy = Math.sin(rec[i + 4]);
        const ax = ex * cy + nx * sy, ay = ny * sy, az = ez * cy + nz * sy;
        const bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux;
        const s = rec[i + 5];
        const sink = kind === 1 ? s * 0.25 : 0.02;
        _m.set(
          ax * s, ux * s, bx * s, px - ux * sink,
          ay * s, uy * s, by * s, py - uy * sink,
          az * s, uz * s, bz * s, pz - uz * sink,
          0, 0, 0, 1,
        );
        mesh.setMatrixAt(counts[slot], _m);
        _c.setRGB(rec[i + 8], rec[i + 9], rec[i + 10]);
        mesh.setColorAt(counts[slot], _c);
        counts[slot]++;
        total++;
      }
    }
    for (let v = 0; v < VARIANTS; v++) {
      for (const [mesh, n] of [[this.grass[v], counts[v]], [this.stones[v], counts[VARIANTS + v]]] as [InstancedMesh, number][]) {
        mesh.count = n;
        mesh.visible = n > 0;
        if (n) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
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

  dispose(): void {
    for (const m of [...this.grass, ...this.stones]) { m.geometry.dispose(); m.dispose(); }
  }
}
