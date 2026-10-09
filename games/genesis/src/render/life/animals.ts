// GENESIS — animals on a planet (CONTRACT.md §15.6 "Animals"): the sim's animal MoverBlock drawn with the body
// generator and the animated body material (render/gen/bodygen.ts, render/life/bodymat.ts).
//
//   * Quadrupeds by form (deer with antlers on the stags, horses with manes, cattle, bison with humps, bears, wolves
//     and dogs, boars and pigs with tusks, goats with curled horns, woolly sheep, hares, lizards), birds (songbirds,
//     gulls, vultures that flap-flap-glide; chickens that peck), fish, whales (pitching flukes), rays, hive crawlers.
//   * A fish SHOAL and a locust SWARM are one mover in the sim: they are expanded here into a churning school of a few
//     dozen fish under the water, and a cloud of hundreds of whirring locusts.
//   * Height: on the ground (+ the mover's altitude: flyers), or in the water for swimmers (altitude < 0 is depth
//     below the water surface). Coat colours from the content palettes, varied per animal; cadence by size.

import type { IUniform, Vector3 } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import type { MoverBlock } from '../../sim/types.ts';
import { AnimState } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { animalAt, type AnimalLook } from './catalog.ts';
import {
  BIRD_RIG, FISH_RIG, HEX_RIG, INSECT_RIG, PLAN, RAY_RIG, birdMesh, fishMesh, hexMesh, insectMesh, quadMesh, quadRig, quadSpecFor, rayMesh,
  type BodyMesh, type Rig,
} from '../gen/bodygen.ts';
import type { BodyMaterialOpts } from './bodymat.ts';
import { BodyBuckets, bodyMatrix } from './bodies.ts';

const _mat = new Float32Array(16);
const _a = new Float32Array(3), _b = new Float32Array(3), _c = new Float32Array(3);

/** per animal: animation blend, cached ground / water, and the same decaying-offset motion smoothing as crowds.ts */
interface Track { anim: number; prev: number; at: number; gx: number; gy: number; gz: number; ground: number; water: number; sx: number; sy: number; sz: number; ox: number; oy: number; oz: number }

/** what to build for an animal look */
function bodyFor(look: AnimalLook, lod: number): { body: BodyMesh; opts: BodyMaterialOpts; shadows: boolean } {
  switch (look.form) {
    case 'bird': case 'gull': case 'chicken': case 'vulture':
      return { body: birdMesh(lod, look.form === 'gull' || look.form === 'vulture'), opts: { plan: PLAN.bird, rig: BIRD_RIG }, shadows: lod === 0 };
    case 'fish': return { body: fishMesh(lod, false), opts: { plan: PLAN.fish, rig: FISH_RIG }, shadows: false };
    case 'whale': return { body: fishMesh(lod, true), opts: { plan: PLAN.fish, rig: FISH_RIG, pitchSwim: true, freqK: 0.25 }, shadows: false };
    case 'locust': return { body: insectMesh(), opts: { plan: PLAN.insect, rig: INSECT_RIG }, shadows: false };
    case 'ray': return { body: rayMesh(), opts: { plan: PLAN.ray, rig: RAY_RIG, freqK: 0.6 }, shadows: lod === 0 };
    case 'crawler': return { body: hexMesh(lod), opts: { plan: PLAN.hex, rig: HEX_RIG }, shadows: lod <= 1 };
    default: {
      const rig: Rig = quadRig(quadSpecFor(look.form));
      return { body: quadMesh(look.form, lod), opts: { plan: PLAN.quad, rig }, shadows: lod <= 1 };
    }
  }
}

/** mesh length / height the generator builds at, to scale to the content size */
function unitSize(look: AnimalLook): number {
  switch (look.form) {
    case 'bird': case 'gull': case 'chicken': case 'vulture': return 1.0;
    case 'fish': case 'whale': return 1.1;
    case 'locust': return 1.0;
    case 'ray': return 2.0;
    case 'crawler': return 1.3;
    default: return 1.0;
  }
}

export class Animals {
  readonly bodies: BodyBuckets;
  private tracks = new Map<number, Track>();
  private lastBlock: MoverBlock | null = null;
  enabled = true;
  /** client-side ambient bird flocks near the camera */
  ambientBirds = true;
  stats = { drawn: 0, flocks: 0, birds: 0 };
  /** body-frame centre of the nearest ambient flock drawn this frame (null none): harness probes frame it */
  flockAt: [number, number, number] | null = null;
  /** drawn animals this frame (id, body-frame position + size) for picking */
  private pickN = 0;
  private pickId = new Int32Array(128);
  private pickP = new Float32Array(128 * 4);
  private lastReal = -1;

  constructor(shared: Record<string, IUniform>) {
    this.bodies = new BodyBuckets(shared, 'animals');
  }

  get group() { return this.bodies.group; }

  private bucket(look: AnimalLook, lod: number) {
    const l = look.form === 'locust' ? 0 : lod;
    return this.bodies.get(`${look.form}|${l}`, () => bodyFor(look, l));
  }

  private colours(look: AnimalLook, id: number): void {
    const coat = look.coats[Math.floor(hashFloat(id, 3) * look.coats.length)] ?? look.coat;
    // wild coats are darker and duller than the content's swatches (herds read as saturated orange toys), and every
    // animal differs a little: lighter or darker, warmer or greyer
    const k = (0.8 + 0.4 * hashFloat(id, 5)) * (look.form === 'gull' || look.form === 'fish' || look.form === 'whale' || look.form === 'locust' ? 0.95 : 0.66);
    const warm = (hashFloat(id, 6) - 0.5) * 0.16;
    const l = coat[0] * 0.2126 + coat[1] * 0.7152 + coat[2] * 0.0722;
    _b[0] = (l + (coat[0] - l) * 0.75) * k * (1 + warm);
    _b[1] = (l + (coat[1] - l) * 0.75) * k;
    _b[2] = (l + (coat[2] - l) * 0.75) * k * (1 - warm);
    // the belly a paler, greyer countershade of the coat
    const bl = look.belly[0] * 0.2126 + look.belly[1] * 0.7152 + look.belly[2] * 0.0722;
    for (let i = 0; i < 3; i++) _c[i] = Math.max(_b[i] * 1.25, (bl + (look.belly[i] - bl) * 0.7) * 0.8);
    _a[0] = _b[0]; _a[1] = _b[1]; _a[2] = _b[2];
  }

  update(pv: PlanetView, camBody: Vector3, ticksSinceSnap: number, animTime: number, realTime: number): void {
    this.bodies.group.visible = this.enabled;
    if (!this.enabled) return;
    this.bodies.animTime.value = animTime;
    this.bodies.begin();
    const M = pv.animals;
    const R = pv.params.radius;
    const cx = camBody.x, cy = camBody.y, cz = camBody.z;
    const fresh = M !== this.lastBlock;
    this.lastBlock = M ?? null;
    const dtR = this.lastReal < 0 ? 0 : Math.max(0, Math.min(0.25, realTime - this.lastReal));
    this.lastReal = realTime;
    const decay = Math.exp(-dtR / 0.15);
    this.pickN = 0;
    const water = pv.fields.get('water'), surface = pv.fields.get('surface');
    if (M && M.count) {
      for (let i = 0; i < M.count; i++) {
        const id = M.id[i];
        const look = animalAt(M.species[i]);
        let ux = M.pos[i * 3] + M.vel[i * 3] * ticksSinceSnap, uy = M.pos[i * 3 + 1] + M.vel[i * 3 + 1] * ticksSinceSnap, uz = M.pos[i * 3 + 2] + M.vel[i * 3 + 2] * ticksSinceSnap;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const range = look.form === 'whale' ? 2500 : look.form === 'locust' ? 900 : look.form === 'bird' || look.form === 'gull' || look.form === 'vulture' ? 500 : 700;
        if (Math.hypot(ux * R - cx, uy * R - cy, uz * R - cz) > range + 150) continue;
        let tr = this.tracks.get(id);
        if (!tr) { tr = { anim: M.anim[i], prev: M.anim[i], at: -1e9, gx: 0, gy: 0, gz: 0, ground: 0, water: 0, sx: -2, sy: 0, sz: 0, ox: 0, oy: 0, oz: 0 }; this.tracks.set(id, tr); }
        if (fresh && M.anim[i] !== tr.anim) { tr.prev = tr.anim; tr.anim = M.anim[i]; tr.at = realTime; }
        if (fresh && tr.sx > -1.5) {
          tr.ox = tr.sx - ux; tr.oy = tr.sy - uy; tr.oz = tr.sz - uz;
          if ((tr.ox * tr.ox + tr.oy * tr.oy + tr.oz * tr.oz) * R * R > 400) tr.ox = tr.oy = tr.oz = 0;
        }
        if (tr.ox !== 0 || tr.oy !== 0 || tr.oz !== 0) {
          tr.ox *= decay; tr.oy *= decay; tr.oz *= decay;
          if ((tr.ox * tr.ox + tr.oy * tr.oy + tr.oz * tr.oz) * R * R < 1e-6) tr.ox = tr.oy = tr.oz = 0;
          ux += tr.ox; uy += tr.oy; uz += tr.oz;
          const sl = Math.hypot(ux, uy, uz) || 1;
          ux /= sl; uy /= sl; uz /= sl;
        }
        tr.sx = ux; tr.sy = uy; tr.sz = uz;
        if (Math.abs(ux - tr.gx) + Math.abs(uy - tr.gy) + Math.abs(uz - tr.gz) > 0.3 / R || tr.ground === 0) {
          tr.ground = groundHeight(pv.ground, ux, uy, uz);
          tr.water = water && surface ? pv.grid.sample(water, ux, uy, uz) : 0;
          tr.gx = ux; tr.gy = uy; tr.gz = uz;
        }
        const aquatic = look.form === 'fish' || look.form === 'whale';
        const swim = aquatic || M.alt[i] < 0;
        // swimmers hang below the water surface (altitude < 0 = depth); everyone else stands on the ground (+ flight)
        let r = swim && tr.water > 0.2 ? tr.ground + tr.water + Math.max(M.alt[i], -tr.water + 0.3) : tr.ground + Math.max(0, M.alt[i]);
        if (look.form === 'whale') r = tr.ground + tr.water - 0.6;
        const d = Math.hypot(ux * r - cx, uy * r - cy, uz * r - cz);
        if (d > range) continue;
        const lod = d < 45 ? 0 : d < 170 ? 1 : 2;
        const size = (look.size / unitSize(look)) * (M.scale[i] || 1);
        const cadence = Math.max(0.35, Math.min(2.5, Math.pow(1.0 / Math.max(0.05, look.size), 0.45))) * (0.9 + 0.2 * hashFloat(id, 7));
        const blend = Math.min(1, (realTime - tr.at) / 0.35);
        const male = look.form === 'deer' && hashFloat(id, 9) < 0.4 ? 1 : 0;
        this.colours(look, id);
        if (look.form === 'fish') {
          // a shoal: fish circling the school's centre, all heading round together, at depths
          const n = 26;
          const b = this.bucket(look, lod);
          for (let k = 0; k < n; k++) {
            const a = animTime * 0.35 + (k / n) * Math.PI * 2 + hashFloat(id, k, 1) * 0.6;
            const rr = (0.6 + 0.4 * hashFloat(id, k, 2)) * 4.5;
            const ex = Math.cos(a) * rr, nz = Math.sin(a) * rr;
            const dy = -hashFloat(id, k, 3) * Math.min(3, Math.max(0.5, tr.water - 0.8));
            this.place(ux, uy, uz, ex, nz, R);
            const fr = r + dy;
            bodyMatrix(_mat, _pu[0], _pu[1], _pu[2], fr, Math.atan2(Math.cos(a), -Math.sin(a)), size * (0.8 + 0.4 * hashFloat(id, k, 4)));
            const j = this.bodies.push(b);
            this.bodies.set(b, j, _mat, [AnimState.swim, AnimState.swim, 1, hashFloat(id, k, 5)], _a, _b, _c, [0, 0, cadence * 1.8, 0]);
          }
          continue;
        }
        if (look.form === 'locust') {
          // a swarm: hundreds of locusts churning in a flattened cloud above the field
          const n = d < 120 ? 520 : d < 400 ? 260 : 120;
          const b = this.bucket(look, 0);
          const span = 18 + 10 * hashFloat(id, 1);
          for (let k = 0; k < n; k++) {
            const h1 = hashFloat(id, k, 11), h2 = hashFloat(id, k, 12), h3 = hashFloat(id, k, 13);
            const t = animTime * (0.6 + h1 * 0.8);
            const ex = Math.sin(t + h2 * 6.28) * span * (0.3 + 0.7 * h3) + Math.sin(t * 2.3 + h1 * 9) * 3;
            const nz = Math.cos(t * 0.9 + h3 * 6.28) * span * (0.3 + 0.7 * h2) + Math.cos(t * 1.7 + h2 * 7) * 3;
            const ey = 1.5 + 7 * h1 * h1 + Math.sin(t * 3.1 + h3 * 5) * 1.2;
            this.place(ux, uy, uz, ex, nz, R);
            const hd = Math.atan2(Math.cos(t + h2 * 6.28), -Math.sin(t * 0.9 + h3 * 6.28));
            bodyMatrix(_mat, _pu[0], _pu[1], _pu[2], tr.ground + ey, hd, 0.07 * (0.8 + 0.4 * h2));
            const j = this.bodies.push(b);
            this.bodies.set(b, j, _mat, [AnimState.fly, AnimState.fly, 1, h3], _a, _b, _c, [0, 0, 1, 0]);
          }
          continue;
        }
        const b = this.bucket(look, lod);
        const j = this.bodies.push(b);
        const flying = M.anim[i] === AnimState.fly;
        bodyMatrix(_mat, ux, uy, uz, r, M.heading[i], size, flying ? 0.05 : 0);
        this.bodies.set(b, j, _mat, [tr.anim, tr.prev, blend, M.phase[i] + hashFloat(id, 13)], _a, _b, _c, [male, 0, cadence, 0]);
        this.addPick(M.group[i], ux * r, uy * r, uz * r, Math.max(0.4, look.size * (M.scale[i] || 1)));
      }
      if (this.tracks.size > M.count * 2 + 256) {
        const live = new Set<number>();
        for (let i = 0; i < M.count; i++) live.add(M.id[i]);
        for (const k of this.tracks.keys()) if (!live.has(k)) this.tracks.delete(k);
      }
    }
    this.stats.flocks = 0; this.stats.birds = 0; this.flockAt = null;
    if (this.ambientBirds) this.birdFlocks(pv, cx, cy, cz, R, animTime);
    this.stats.drawn = this.bodies.end();
  }

  /**
   * Ambient flocks near the camera (client-side, like the cohort crowds: the sim's fauna has few fliers): songbirds
   * wheeling over woods and fields, gulls along the shores; each flock circles, drifts, and now and then comes down to
   * the ground to feed. Placed by a hash of the cells in view, so a flock is where it was when the camera comes back.
   */
  private birdFlocks(pv: PlanetView, cx: number, cy: number, cz: number, R: number, animTime: number): void {
    const rc = Math.hypot(cx, cy, cz) || 1;
    const dx = cx / rc, dy = cy / rc, dz = cz / rc;
    const alt = rc - groundHeight(pv.ground, dx, dy, dz);
    if (alt > 450) return;
    const tree = pv.fields.get('tree'), water = pv.fields.get('water'), grass = pv.fields.get('grass');
    if (!tree || !water) return;
    const cells = pv.grid.cellsWithin(dx, dy, dz, 380 / R);
    const P = pv.grid.pos;
    let flocks = 0;
    for (const c of cells) {
      if (flocks >= 6) break;
      const h0 = hashFloat(c, 0xb1d);
      if (water[c] > 0.3) continue;
      // the shore: dry land beside water; woods; open grass
      let shore = false;
      for (let e = pv.grid.nbrStart[c]; e < pv.grid.nbrStart[c + 1]; e++) if (water[pv.grid.nbr[e]] > 0.6) { shore = true; break; }
      const odds = shore ? 0.3 : tree[c] > 0.35 ? 0.16 : (grass?.[c] ?? 0) > 0.4 ? 0.07 : 0;
      if (h0 >= odds) continue;
      flocks++;
      const look = shore ? GULL : SONGBIRD;
      const ux = P[c * 3], uy = P[c * 3 + 1], uz = P[c * 3 + 2];
      const g = groundHeight(pv.ground, ux, uy, uz);
      if (Math.hypot(ux * g - cx, uy * g - cy, uz * g - cz) > 420) continue;
      const n = 10 + Math.floor(hashFloat(c, 0xb1e) * (shore ? 14 : 26));
      // a cycle of wheeling (most of it) and feeding on the ground
      const period = 70 + 40 * hashFloat(c, 0xb1f);
      const ph = (animTime / period + hashFloat(c, 0xb20)) % 1;
      const down = ph > 0.78;
      const radius = (shore ? 22 : 14) + 10 * hashFloat(c, 0xb21);
      const drift = animTime * 0.02 + hashFloat(c, 0xb22) * 6.28;
      const ce = Math.cos(drift) * 25, cn = Math.sin(drift) * 25;
      const size = look.size / unitSize(look);
      const dist = Math.hypot(ux * g - cx, uy * g - cy, uz * g - cz);
      const b = this.bucket(look, dist < 60 ? 0 : 1);
      this.colours(look, c);
      this.stats.flocks++;
      this.stats.birds += n;
      if (!this.flockAt) { this.place(ux, uy, uz, ce, cn, R); this.flockAt = [_pu[0] * (g + 15), _pu[1] * (g + 15), _pu[2] * (g + 15)]; }
      for (let k = 0; k < n; k++) {
        const h1 = hashFloat(c, k, 0xb23), h2 = hashFloat(c, k, 0xb24), h3 = hashFloat(c, k, 0xb25);
        let e: number, nn: number, y: number, hd: number, anim: number;
        if (!down) {
          const a = animTime * (0.32 + 0.06 * h1) + (k / n) * 1.4 + h2 * 0.9;
          const rr = radius * (0.75 + 0.5 * h1);
          e = ce + Math.cos(a) * rr + Math.sin(animTime * 0.7 + h3 * 9) * 2;
          nn = cn + Math.sin(a) * rr + Math.cos(animTime * 0.6 + h2 * 9) * 2;
          y = (shore ? 9 : 12) + 10 * h2 + Math.sin(animTime * 0.9 + h1 * 7) * 1.5;
          // heading along the circle (tangent): east/north frame, 0 = north, + toward east
          hd = Math.atan2(-Math.sin(a), Math.cos(a));
          anim = AnimState.fly;
        } else {
          e = ce + (h1 - 0.5) * radius * 0.9;
          nn = cn + (h2 - 0.5) * radius * 0.9;
          y = 0;
          hd = h3 * 6.283;
          anim = h3 < 0.5 ? AnimState.graze : AnimState.idle;
        }
        this.place(ux, uy, uz, e, nn, R);
        const gr = down ? groundHeight(pv.ground, _pu[0], _pu[1], _pu[2]) : g;
        bodyMatrix(_mat, _pu[0], _pu[1], _pu[2], gr + y, hd, size * (0.85 + 0.3 * h3), anim === AnimState.fly ? 0.05 : 0);
        const j = this.bodies.push(b);
        this.bodies.set(b, j, _mat, [anim, anim, 1, h1], _a, _b, _c, [0, 0, 1.1 + 0.3 * h2, 0]);
      }
    }
  }

  private addPick(herd: number, x: number, y: number, z: number, size: number): void {
    if (this.pickN >= this.pickId.length) {
      const ni = new Int32Array(this.pickId.length * 2); ni.set(this.pickId); this.pickId = ni;
      const np = new Float32Array(this.pickP.length * 2); np.set(this.pickP); this.pickP = np;
    }
    const k = this.pickN++;
    this.pickId[k] = herd;
    this.pickP[k * 4] = x; this.pickP[k * 4 + 1] = y; this.pickP[k * 4 + 2] = z; this.pickP[k * 4 + 3] = size;
  }

  /** the herd of the animal nearest a body-frame ray (sphere of the animal's size, widened with distance) */
  pick(o: ArrayLike<number>, d: ArrayLike<number>, maxT: number, slack: number): { id: number; t: number } | null {
    let best: { id: number; t: number } | null = null;
    let bestScore = Infinity;
    const P = this.pickP;
    for (let k = 0; k < this.pickN; k++) {
      const s = P[k * 4 + 3];
      const l = Math.hypot(P[k * 4], P[k * 4 + 1], P[k * 4 + 2]) || 1;
      const px = P[k * 4] + (P[k * 4] / l) * s * 0.5 - o[0], py = P[k * 4 + 1] + (P[k * 4 + 1] / l) * s * 0.5 - o[1], pz = P[k * 4 + 2] + (P[k * 4 + 2] / l) * s * 0.5 - o[2];
      const t = px * d[0] + py * d[1] + pz * d[2];
      if (t <= 0 || t > maxT) continue;
      const miss = Math.hypot(px - d[0] * t, py - d[1] * t, pz - d[2] * t);
      if (miss > Math.max(s * 0.6, t * slack)) continue;
      const score = t + miss * 4;
      if (score < bestScore) { bestScore = score; best = { id: this.pickId[k], t }; }
    }
    return best;
  }

  /** offset a unit position by (east, north) metres into _pu */
  private place(ux: number, uy: number, uz: number, e: number, n: number, R: number): void {
    let ex = uz, ez = -ux;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
    let px = ux + (ex * e + nx * n) / R, py = uy + (ny * n) / R, pz = uz + (ez * e + nz * n) / R;
    const l = Math.hypot(px, py, pz);
    px /= l; py /= l; pz /= l;
    _pu[0] = px; _pu[1] = py; _pu[2] = pz;
  }

  setShadowCasting(on: boolean): void { this.bodies.setShadowCasting(on); }
  swapDepth(depth: boolean): void { this.bodies.swapDepth(depth); }
  dispose(): void { this.bodies.dispose(); }
}

const _pu = [0, 0, 0];

/** the ambient fliers' looks (catalog songbird / gull) */
const SONGBIRD: AnimalLook = { id: 'songbird', form: 'bird', size: 0.32, coat: [0.12, 0.09, 0.06], belly: [0.45, 0.35, 0.25], coats: [[0.12, 0.09, 0.06], [0.06, 0.055, 0.05], [0.16, 0.11, 0.06]] };
const GULL: AnimalLook = { id: 'gull', form: 'gull', size: 0.45, coat: [0.7, 0.72, 0.74], belly: [0.8, 0.82, 0.84], coats: [[0.7, 0.72, 0.74], [0.55, 0.57, 0.6]] };
