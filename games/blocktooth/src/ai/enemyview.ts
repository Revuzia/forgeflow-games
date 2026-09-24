// BLOCKTOOTH — enemy view (foes-view lane, CONTRACT §6, §6.1, §9).
//
// Instanced rendering of every HALVARD CIVIL DEFENSE unit:
//   * one InstancedMesh per (kind, part) — a part with several pivots (4 rotors, 6 wheels,
//     3 stilts) takes `enemies × pivots` instances — plus a 2 px ink hull (addOutline) that
//     shares the instance buffer. All batches share ONE patched toon material (one program).
//   * per-instance matrices are composed every frame from the interpolated sim pose
//     (px→x, pheading→heading by alpha) and procedural part animation:
//       biped   hip swing phased by distance walked, counter-swinging arm, aim raise + recoil
//       hover   rotor spin, bob, bank into turns, nose-down dive, lock-on jitter
//       wheeled wheel roll by distance (front pair steers), suspension roll, turret slew to aim
//       tracked road-wheel roll, turret slew + barrel recoil, dozer blade raise on the charge
//       tripod  3-stilt sequenced gait, legs spread + body squats when planted, mortar recoil
//   * hit flash: per-instance `instFlash` attribute → diffuse lerps to white (instanceColor is
//     multiplicative with the painted vertex colours and cannot reach white on navy, so it
//     carries the veteran gold / frost-slow tint instead);
//   * spawn pop-in (easeOutBack on sim time since spawnT), death → hidden (fx does the puff).
//   * distance LOD: shadows off past ENEMY_SHADOW_MAX_D, ink hulls off below INK_MIN_RATIO, and
//     below FAR_RATIO a kind swaps to its merged, decimated far mesh (one instance per enemy).
// Zero per-frame allocation: scratch math objects + pooled per-enemy view records.

import * as THREE from 'three';
import type { Enemy, EnemyKind, World } from '../core/types.ts';
import { ENEMY_KINDS } from '../core/types.ts';
import { CITY, SIM_DT } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../render/viewtypes.ts';
import { addOutline } from '../render/materials.ts';
import { buildFoeFar, buildFoeModel, disposeFoeModel, makeFoeMaterial, PIV_STRIDE } from './foemodels.ts';
import type { FoeMaterial, FoeModel, FoePart } from './foemodels.ts';

/** CONTRACT §6.1: enemies / vehicles 2.0 px ink. */
const OUTLINE_W = 2.0;
/** Spawn pop-in duration (s of sim time). */
const POP_S = 0.32;
/** Hit flash hold (s) — sim flash is 0.12 s; the view keeps a readable tail. */
const FLASH_S = 0.18;
/** Rendered positions jumping farther than this in one frame are recycles, not motion. */
const TELEPORT_M = 25;
/** camera distance (m) beyond which enemies stop casting shadows (Size IV–V framing) */
const ENEMY_SHADOW_MAX_D = 240;
/** a kind keeps its ink hull while model height / camera distance ≥ this (≈ 4 px at 720p) */
const INK_MIN_RATIO = 0.0045;
/**
 * Far LOD: a kind whose on-screen height ratio (model height / camera distance) is below this
 * (≈ 11 px at 720p) draws its merged, decimated far mesh (foemodels buildFoeFar) — one instance
 * per enemy, root pose only — instead of its animated multi-part near model. It returns to the
 * near model above FAR_RATIO × FAR_HYST (hysteresis: the camera spring never makes it flicker).
 * Size IV–V: troopers, drones, buggies, APCs, tanks go far; walkers and the elite stay near.
 */
const FAR_RATIO = 0.0085, FAR_HYST = 1.15;
/** far-mesh cluster grid (cells across the model's largest extent). The far mesh only draws below
 *  FAR_RATIO (≤ ~7 px tall at 720p), where 9 cells are still ≥ 1 cell per pixel; 14 cells left ~370
 *  triangles per trooper — ~160k triangles for 250 foes at Size V, the second-largest vertex load
 *  after the city on the reference Intel UHD. */
const FAR_CELLS = 9;

// ─────────────────────────────── per-enemy view record (pooled) ───────────────────────────────
interface Vis {
  id: number;
  seen: number;          // frame stamp
  init: boolean;
  lx: number; lz: number; lh: number;   // last rendered pose
  dist: number;          // signed distance travelled (m) — gait phase / wheel roll
  speed: number;         // smoothed |v| (m/s)
  turn: number;          // smoothed heading rate (rad/s)
  roll: number;          // wheel roll angle (rad)
  steer: number;         // front wheel steer (rad)
  tYaw: number;          // turret / pod / mortar yaw, model-local (rad)
  recoil: number;        // 0..1, kicked by enemyFire
  flash: number;         // 0..1
  blade: number;         // dozer blade raise 0..1
  hatch: number;         // APC ramp open 0..1
  plant: number;         // walker planted stance 0..1
  aimK: number;          // biped weapon raised 0..1
  seed: number;          // cosmetic phase offset
}
function newVis(): Vis {
  return {
    id: -1, seen: 0, init: false, lx: 0, lz: 0, lh: 0, dist: 0, speed: 0, turn: 0, roll: 0, steer: 0,
    tYaw: 0, recoil: 0, flash: 0, blade: 0, hatch: 0, plant: 0, aimK: 0, seed: 0,
  };
}

// ─────────────────────────────── batches ───────────────────────────────
interface Range { start: number; count: number }
interface PartBatch {
  part: FoePart;
  mesh: THREE.InstancedMesh;
  /** the 2 px ink hull child (its own `visible` is the ink LOD switch) */
  hull: THREE.Mesh;
  flash: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  /** persistent upload ranges (addUpdateRange would allocate a range object every frame) */
  rM: Range; rF: Range; rC: Range;
  cap: number;
  n: number;
}

/** Upload only [0, count) of an attribute this frame, reusing one range object. */
function markRange(attr: THREE.BufferAttribute, r: Range, count: number): void {
  r.start = 0; r.count = count;
  const ur = attr.updateRanges;
  if (ur.length !== 1 || ur[0] !== r) { ur.length = 0; ur.push(r); }
  attr.needsUpdate = true;
}
interface FarBatch {
  mesh: THREE.InstancedMesh;
  flash: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  rM: Range; rF: Range; rC: Range;
  cap: number;
  n: number;
}
interface KindBatch {
  kind: EnemyKind;
  model: FoeModel;
  parts: PartBatch[];
  /** merged decimated far-LOD batch (one instance per enemy) */
  far: FarBatch;
  /** this frame draws the far batch instead of the parts */
  useFar: boolean;
  /** scratch world matrices of the CURRENT enemy: [part][pivot] */
  pw: THREE.Matrix4[][];
  /** max enemies of this kind drawable this frame */
  capEnemies: number;
  drawn: number;
}

// ─────────────────────────────── scratch ───────────────────────────────
const _root = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _scl = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
/** animation output of animPivot(): extra rotation (rad, applied inside restYaw) + offset (m) */
const ANIM = { rx: 0.5, ry: 0.5, rz: 0.5, ox: 0.5, oy: 0.5, oz: 0.5 };
/** per-frame / per-enemy doubles handed to the hot helpers through a record, not call arguments
 *  (V8 boxes every double argument of a non-inlined call — this keeps the hot path allocation-free) */
const FR = { alpha: 0.5, dt: 0.5, simT: 0.5, tx: 0.5, tz: 0.5, moveK: 0.5, phase: 0.5, time: 0.5 };
const TAU = Math.PI * 2;

const AIM_STATES = new Set(['aim', 'hold', 'volley', 'tell', 'lock', 'barrage']);

export class EnemyView implements ViewModule {
  private ctx: ViewCtx;
  private root = new THREE.Group();
  private mat: FoeMaterial;
  private batches = new Map<EnemyKind, KindBatch>();
  private batchList: KindBatch[] = [];
  private vis = new Map<number, Vis>();
  /** live view records (array twin of `vis` so the per-frame sweep never allocates an iterator) */
  private visList: Vis[] = [];
  private pool: Vis[] = [];
  private frame = 0;
  private time = 0;
  private mounted = false;

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'enemies';
    this.root.matrixAutoUpdate = false;
    this.mat = makeFoeMaterial(true);
    for (const kind of ENEMY_KINDS) { const b = this.buildBatch(kind); this.batches.set(kind, b); this.batchList.push(b); }
  }

  private buildBatch(kind: EnemyKind): KindBatch {
    const model = buildFoeModel(kind);
    const capEnemies = CITY.maxEnemies;
    const parts: PartBatch[] = [];
    const pw: THREE.Matrix4[][] = [];
    for (const part of model.parts) {
      const cap = capEnemies * part.count;
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      flash.setUsage(THREE.DynamicDrawUsage);
      part.geo.setAttribute('instFlash', flash);
      const mesh = new THREE.InstancedMesh(part.geo, this.mat, cap);
      mesh.name = `foe:${kind}:${part.name}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      color.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = color;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;            // instances span the whole spawn ring; bounds would churn
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = part.shadow;
      mesh.receiveShadow = true;
      const hull = addOutline(mesh, OUTLINE_W);
      this.root.add(mesh);
      parts.push({ part, mesh, hull, flash, color, rM: { start: 0, count: 0 }, rF: { start: 0, count: 0 }, rC: { start: 0, count: 0 }, cap, n: 0 });
      const m: THREE.Matrix4[] = [];
      for (let k = 0; k < part.count; k++) m.push(new THREE.Matrix4());
      pw.push(m);
    }
    // far LOD: one merged, decimated mesh per kind; no ink hull (it only draws when a unit is a
    // few px tall, where INK_MIN_RATIO has already dropped the hulls of every far kind)
    const farGeo = buildFoeFar(model, FAR_CELLS);
    const fFlash = new THREE.InstancedBufferAttribute(new Float32Array(capEnemies), 1);
    fFlash.setUsage(THREE.DynamicDrawUsage);
    farGeo.setAttribute('instFlash', fFlash);
    const fMesh = new THREE.InstancedMesh(farGeo, this.mat, capEnemies);
    fMesh.name = `foe:${kind}:far`;
    fMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const fColor = new THREE.InstancedBufferAttribute(new Float32Array(capEnemies * 3).fill(1), 3);
    fColor.setUsage(THREE.DynamicDrawUsage);
    fMesh.instanceColor = fColor;
    fMesh.count = 0;
    fMesh.visible = false;
    fMesh.frustumCulled = false;
    fMesh.matrixAutoUpdate = false;
    fMesh.castShadow = true;
    fMesh.receiveShadow = true;
    this.root.add(fMesh);
    const far: FarBatch = { mesh: fMesh, flash: fFlash, color: fColor, rM: { start: 0, count: 0 }, rF: { start: 0, count: 0 }, rC: { start: 0, count: 0 }, cap: capEnemies, n: 0 };
    return { kind, model, parts, far, useFar: false, pw, capEnemies, drawn: 0 };
  }

  mount(world: World): void {
    if (!this.mounted) { this.ctx.scene.add(this.root); this.mounted = true; }
    this.clearVis();
    const time = BIOMES[world.biomeId]?.time ?? 'day';
    // lamps / visors: ~3–6× the surface they sit on (glare bar), a little hotter at night
    this.mat.userData.bt.uGlowMul.value = time === 'night' ? 1.7 : time === 'overcast' ? 1.15 : 0.95;
    for (const b of this.batchList) {
      for (const p of b.parts) { p.mesh.count = 0; p.mesh.visible = false; }
      b.far.mesh.count = 0; b.far.mesh.visible = false; b.useFar = false;
    }
    this.root.updateMatrixWorld(true);
  }

  unmount(): void {
    if (this.mounted) { this.ctx.scene.remove(this.root); this.mounted = false; }
    for (const b of this.batches.values()) {
      for (const p of b.parts) { p.mesh.count = 0; p.mesh.visible = false; }
      b.far.mesh.count = 0; b.far.mesh.visible = false;
    }
    this.clearVis();
  }

  /** Release GPU resources (page teardown; not part of the per-run cycle). */
  dispose(): void {
    this.unmount();
    for (const b of this.batches.values()) {
      for (const p of b.parts) p.mesh.dispose();
      b.far.mesh.geometry.dispose(); b.far.mesh.dispose();
      disposeFoeModel(b.model);
    }
    this.mat.dispose();
  }

  private clearVis(): void {
    for (let i = 0; i < this.visList.length; i++) this.pool.push(this.visList[i]);
    this.visList.length = 0;
    this.vis.clear();
  }

  private getVis(e: Enemy): Vis {
    let v = this.vis.get(e.id);
    if (!v) {
      v = this.pool.pop() ?? newVis();
      v.id = e.id; v.init = false; v.dist = 0; v.speed = 0; v.turn = 0; v.roll = 0; v.steer = 0;
      v.tYaw = 0; v.recoil = 0; v.flash = 0; v.blade = 0; v.hatch = 0; v.plant = 0; v.aimK = 0;
      v.seed = ((e.id * 0.6180339887) % 1) * Math.PI * 2;
      this.vis.set(e.id, v);
      this.visList.push(v);
    }
    return v;
  }

  update(w: World, f: FrameInfo): void {
    this.frame++;
    const dt = Math.max(1e-4, Math.min(0.1, f.dt));
    this.time += dt;

    // enemyFire → recoil kick (the shot itself is drawn by the projectile/telegraph views)
    for (let i = 0; i < f.events.length; i++) {
      const ev = f.events[i];
      if (ev.type === 'enemyFire') { const v = this.vis.get(ev.id); if (v) v.recoil = 1; }
    }

    const BL = this.batchList;
    for (let bi = 0; bi < BL.length; bi++) { const b = BL[bi]; b.drawn = 0; b.far.n = 0; for (let pi = 0; pi < b.parts.length; pi++) b.parts[pi].n = 0; }

    // Distance LOD (integration perf fix): at Size IV–V framing a trooper is a few pixels tall, yet
    // 250 of them cost ~3k triangles each × (main + ink + shadow). Past ENEMY_SHADOW_MAX_D they stop
    // casting; a kind whose on-screen height ratio (model height / camera distance) drops below
    // INK_MIN_RATIO loses its ink hull (a 2 px hull round a 5 px unit is just a blob).
    const cd = f.camDist > 1 ? f.camDist : 1;
    const shadowOn = cd < ENEMY_SHADOW_MAX_D;
    // A/B switch for perf attribution probes (window.__BT_FOE_NEAR__ = true forces the near models)
    const forceNear = (globalThis as { __BT_FOE_NEAR__?: boolean }).__BT_FOE_NEAR__ === true;
    for (let bi = 0; bi < BL.length; bi++) {
      const b = BL[bi];
      const ratio = b.model.height / cd;
      const inkOn = ratio >= INK_MIN_RATIO;
      b.useFar = !forceNear && (b.useFar ? ratio < FAR_RATIO * FAR_HYST : ratio < FAR_RATIO);
      if (b.far.mesh.castShadow !== shadowOn) b.far.mesh.castShadow = shadowOn;
      for (let pi = 0; pi < b.parts.length; pi++) {
        const pb = b.parts[pi];
        const cast = pb.part.shadow && shadowOn;
        if (pb.mesh.castShadow !== cast) pb.mesh.castShadow = cast;
        if (pb.hull.visible !== inkOn) pb.hull.visible = inkOn;
      }
    }

    FR.alpha = f.alpha < 0 ? 0 : f.alpha > 1 ? 1 : f.alpha;
    FR.dt = dt;
    FR.simT = w.t + (f.frozen ? 0 : f.alpha * SIM_DT);
    FR.time = this.time;
    const T = w.titan;
    FR.tx = T.x; FR.tz = T.z;
    for (let i = 0; i < w.enemies.length; i++) {
      const e = w.enemies[i];
      if (!e.alive) continue;
      const b = this.batches.get(e.kind);
      if (!b || b.drawn >= b.capEnemies) continue;
      const v = this.getVis(e);
      v.seen = this.frame;
      this.drawEnemy(b, e, v);
      b.drawn++;
    }

    for (let bi = 0; bi < BL.length; bi++) {
      const b = BL[bi];
      for (let pi = 0; pi < b.parts.length; pi++) {
        const p = b.parts[pi];
        const n = p.n;
        p.mesh.count = n;
        p.mesh.visible = n > 0;
        if (n === 0) continue;
        markRange(p.mesh.instanceMatrix, p.rM, n * 16);
        markRange(p.flash, p.rF, n);
        markRange(p.color, p.rC, n * 3);
      }
      const F = b.far, fn = F.n;
      F.mesh.count = fn;
      F.mesh.visible = fn > 0;
      if (fn > 0) {
        markRange(F.mesh.instanceMatrix, F.rM, fn * 16);
        markRange(F.flash, F.rF, fn);
        markRange(F.color, F.rC, fn * 3);
      }
    }

    // forget enemies that died / were compacted away (pooled, swap-remove, no allocation)
    const VL = this.visList;
    for (let i = VL.length - 1; i >= 0; i--) {
      const v = VL[i];
      if (v.seen === this.frame) continue;
      this.vis.delete(v.id);
      this.pool.push(v);
      VL[i] = VL[VL.length - 1];
      VL.length--;
    }
  }

  // ─────────────────────────────── one enemy ───────────────────────────────
  private drawEnemy(b: KindBatch, e: Enemy, v: Vis): void {
    const m = b.model;
    const a = FR.alpha, dt = FR.dt;
    const x = e.px + (e.x - e.px) * a;
    const z = e.pz + (e.z - e.pz) * a;
    const y = e.py + (e.y - e.py) * a;
    let dhe = e.heading - e.pheading;
    dhe -= TAU * Math.floor((dhe + Math.PI) / TAU);
    const h = e.pheading + dhe * a;

    // motion metrics from the rendered pose (interpolation-smooth, recycle-safe)
    if (!v.init) { v.lx = x; v.lz = z; v.lh = h; v.init = true; v.tYaw = 0; }
    const dx = x - v.lx, dz = z - v.lz;
    let d = Math.sqrt(dx * dx + dz * dz);
    let fwd = dx * Math.sin(h) + dz * Math.cos(h);
    if (d > TELEPORT_M) { d = 0; fwd = 0; }
    let dh = h - v.lh;
    dh -= TAU * Math.floor((dh + Math.PI) / TAU);
    v.lx = x; v.lz = z; v.lh = h;
    v.dist += fwd;
    const k = Math.min(1, dt * 8);
    v.speed += (d / dt - v.speed) * k;
    const tr = dh / dt;
    v.turn += ((tr < -6 ? -6 : tr > 6 ? 6 : tr) - v.turn) * k;
    v.recoil = Math.max(0, v.recoil - dt * 4.5);
    const ef = e.flash / 0.12;
    v.flash = Math.max(v.flash - dt / FLASH_S, ef < 0 ? 0 : ef > 1 ? 1 : ef);

    // turret / pod / mortar slew toward the latched aim point (else the titan)
    let ax = e.aimX, az = e.aimZ;
    if (!(ax === ax && az === az && Math.abs(ax) < 1e7 && Math.abs(az) < 1e7)) { ax = FR.tx; az = FR.tz; }
    if (m.turretRate > 0) {
      let da = Math.atan2(ax - x, az - z) - h - v.tYaw;           // shortest turn toward the aim
      da -= TAU * Math.floor((da + Math.PI) / TAU);
      const step = m.turretRate * dt;
      let ty = v.tYaw + (da < -step ? -step : da > step ? step : da);
      ty -= TAU * Math.floor((ty + Math.PI) / TAU);
      v.tYaw = ty;
    }

    const st = e.state;
    v.aimK += ((AIM_STATES.has(st) ? 1 : 0) - v.aimK) * Math.min(1, dt * 6);
    v.hatch += ((st === 'deploy' ? 1 : 0) - v.hatch) * Math.min(1, dt * 3.5);
    v.blade += ((st === 'tell' || st === 'charge' ? 1 : 0) - v.blade) * Math.min(1, dt * (st === 'tell' ? 1.6 : 3));
    const planted = st === 'plant' || st === 'hold' || st === 'aim' || st === 'barrage';
    v.plant += ((planted ? 1 : 0) - v.plant) * Math.min(1, dt * (st === 'plant' ? 1.4 : 2));
    const sw = v.turn * 0.3;
    const steerWant = sw < -0.5 ? -0.5 : sw > 0.5 ? 0.5 : sw;
    v.steer += (steerWant - v.steer) * Math.min(1, dt * 6);
    if (m.wheelR > 0) v.roll += fwd / m.wheelR;

    // root: pose + pop-in + veteran size, whole-body attitude for the hover gait / stun wobble
    const pt = (FR.simT - e.spawnT) / POP_S;
    let pop = 1;
    if (pt < 1) {
      const u = (pt < 0 ? 0 : pt) - 1;                                  // easeOutBack, overshoot 2.2
      pop = Math.max(0.05, 1 + 3.2 * u * u * u + 2.2 * u * u);
    }
    const vet = e.elite && e.kind !== 'elite';
    const s = (e.height / m.height) * pop * (vet ? 1.14 : 1);
    let rx = 0, rz = 0;
    if (m.gait === 'hover') {
      const hk = v.speed / 7, moveK = hk > 1 ? 1 : hk;
      rx = 0.22 * moveK + (st === 'dive' ? 0.85 : 0) - (st === 'climb' ? 0.25 : 0);
      const bk = v.turn * 0.22;
      rz = -(bk < -0.55 ? -0.55 : bk > 0.55 ? 0.55 : bk);
      if (st === 'lock') rz += Math.sin(this.time * 38 + v.seed) * 0.05;
    }
    if (e.stun > 0) {
      const sk = Math.min(1, e.stun * 3);
      rx += Math.sin(this.time * 23 + v.seed) * 0.1 * sk;
      rz += Math.cos(this.time * 29 + v.seed) * 0.12 * sk;
    }
    const hoverBob = m.gait === 'hover' ? Math.sin(this.time * 5.2 + v.seed) * 0.06 : 0;
    _pos.set(x, y + hoverBob * s, z);
    _q.setFromEuler(_e.set(rx, h, rz, 'YXZ'));
    _scl.set(s, s, s);
    _root.compose(_pos, _q, _scl);

    // instance tint (multiplies the painted colours): veteran gold, frost-slow ice
    let cr = 1, cg = 1, cb = 1;
    if (vet) { cr = 1.1; cg = 0.94; cb = 0.62; }
    if (e.slowT > 0) { cr *= 0.74; cg *= 0.9; cb *= 1.28; }
    const flash = v.flash;

    if (b.useFar) {
      // far LOD: the merged rest-pose mesh on the root pose (pop-in, veteran size, hover bank and
      // stun wobble all live in _root); per-part animation is below a pixel at this framing
      const F = b.far, n = F.n;
      if (n >= F.cap) return;
      F.mesh.setMatrixAt(n, _root);
      F.flash.array[n] = flash;
      const ca = F.color.array as Float32Array;
      ca[n * 3] = cr; ca[n * 3 + 1] = cg; ca[n * 3 + 2] = cb;
      F.n = n + 1;
      return;
    }

    // biped gait terms (shared by body + limbs of this enemy)
    const mkr = v.speed / Math.max(0.5, m.stride * 1.1);
    FR.moveK = mkr > 1 ? 1 : mkr;
    FR.phase = m.stride > 0 ? (v.dist / m.stride) * TAU : 0;

    for (let pi = 0; pi < m.parts.length; pi++) {
      const part = m.parts[pi];
      const pb = b.parts[pi];
      const piv = part.piv;
      const pw = b.pw[pi];
      for (let kk = 0; kk < part.count; kk++) {
        const o = kk * PIV_STRIDE;
        const px = piv[o], py = piv[o + 1], pz = piv[o + 2], restYaw = piv[o + 3];
        this.animPivot(m, part, kk, o, e, v);
        _pos.set(px + ANIM.ox, py + ANIM.oy, pz + ANIM.oz);
        _q.setFromEuler(_e.set(ANIM.rx, restYaw + ANIM.ry, ANIM.rz, 'YXZ'));
        _local.compose(_pos, _q, _one);
        const parent = part.parent < 0 ? _root : b.pw[part.parent][m.parts[part.parent].count === part.count ? kk : 0];
        pw[kk].multiplyMatrices(parent, _local);
        const n = pb.n;
        if (n >= pb.cap) continue;
        pb.mesh.setMatrixAt(n, pw[kk]);
        pb.flash.array[n] = flash;
        const ca = pb.color.array as Float32Array;
        ca[n * 3] = cr; ca[n * 3 + 1] = cg; ca[n * 3 + 2] = cb;
        pb.n = n + 1;
      }
    }
  }

  /** Procedural animation of one pivot → ANIM (rotation inside the rest yaw + offset). */
  private animPivot(m: FoeModel, part: FoePart, k: number, o: number, e: Enemy, v: Vis): void {
    ANIM.rx = 0; ANIM.ry = 0; ANIM.rz = 0; ANIM.ox = 0; ANIM.oy = 0; ANIM.oz = 0;
    const t = FR.time, st = e.state, moveK = FR.moveK, phase = FR.phase;
    const pa = part.piv[o + 4], pb = part.piv[o + 5];
    switch (part.anim) {
      case 'body': {
        if (m.gait === 'biped') {
          const ang = m.swing * moveK * Math.sin(phase);
          ANIM.oy = -m.legLen * (1 - Math.cos(ang)) + Math.abs(Math.sin(phase)) * 0.035 * moveK;
          ANIM.rx = 0.09 * moveK + (st === 'volley' || st === 'aim' ? -0.04 : 0) - v.recoil * 0.05;
          ANIM.ry = Math.sin(phase) * 0.07 * moveK;
          ANIM.rz = Math.sin(phase) * 0.03 * moveK;
          if (st === 'hold' || st === 'form') ANIM.oy += Math.sin(t * 2.4 + v.seed) * 0.008;   // idle breathing
        } else if (m.gait === 'hover') {
          ANIM.ry = Math.sin(t * 1.3 + v.seed) * 0.08;
        } else if (m.gait === 'wheeled') {
          const rl = v.turn * v.speed * 0.012;
          ANIM.rz = rl < -0.08 ? -0.08 : rl > 0.08 ? 0.08 : rl;
          ANIM.oy = Math.sin(v.dist * 2.3 + v.seed) * 0.018 * Math.min(1, v.speed / 4);
          ANIM.rx = -v.recoil * 0.05 + (v.hatch > 0.01 ? -0.02 * v.hatch : 0);
        } else if (m.gait === 'tracked') {
          const rs = v.speed / 3;
          const rumble = (rs > 1 ? 1 : rs) + (st === 'charge' ? 1.5 : 0);
          ANIM.oy = Math.sin(t * 31 + v.seed) * 0.012 * rumble;
          ANIM.rx = -v.recoil * 0.06 + (st === 'charge' ? -0.035 : 0) + (st === 'tell' ? Math.sin(t * 26) * 0.01 : 0);
          ANIM.rz = Math.sin(t * 23 + v.seed) * 0.006 * rumble;
        } else if (m.gait === 'tripod') {
          const ms = v.speed / 1.5, mk = ms > 1 ? 1 : ms;
          ANIM.oy = -0.55 * v.plant + Math.sin(phase * 3) * 0.14 * mk;
          ANIM.rz = Math.sin(phase) * 0.035 * mk;
          ANIM.rx = Math.cos(phase) * 0.02 * mk - v.recoil * 0.04;
        }
        break;
      }
      case 'leg': {
        ANIM.rx = m.swing * moveK * Math.sin(phase + (pa > 0 ? 0 : Math.PI));
        break;
      }
      case 'arm': {
        ANIM.rx = -0.8 * m.swing * moveK * Math.sin(phase + (pa > 0 ? 0 : Math.PI));
        ANIM.rz = 0.06 * pa;
        break;
      }
      case 'gunArm': {
        const walk = -0.3 * m.swing * moveK * Math.sin(phase + (pa > 0 ? 0 : Math.PI));
        ANIM.rx = walk * (1 - v.aimK) - 0.32 * v.aimK + v.recoil * 0.3;
        ANIM.oz = -v.recoil * 0.05;
        break;
      }
      case 'shieldArm': {
        ANIM.rx = -0.08 - 0.12 * v.aimK + Math.sin(phase) * 0.05 * moveK;
        ANIM.ry = -0.1 * v.aimK;
        break;
      }
      case 'rotor': {
        ANIM.ry = (t * 46 + v.seed * 3 + k) * (pa || 1);
        break;
      }
      case 'wheel': {
        ANIM.rx = v.roll;
        if (pb > 0) ANIM.ry = v.steer;
        break;
      }
      case 'turret': {
        ANIM.ry = v.tYaw;
        if (m.kind === 'buggy') { ANIM.rx = v.recoil * 0.12; ANIM.oz = -v.recoil * 0.08; }
        else if (m.kind === 'apc') ANIM.oz = -v.recoil * 0.03;
        break;
      }
      case 'barrel': {
        ANIM.rx = -0.05 * v.aimK - (st === 'tell' ? 0.03 : 0) + v.recoil * 0.04;
        ANIM.oz = -v.recoil * 0.65;
        break;
      }
      case 'hatch': {
        ANIM.rx = -1.42 * v.hatch;
        break;
      }
      case 'thigh':
      case 'shin': {
        const ms = v.speed / 1.5, mk = ms > 1 ? 1 : ms;
        const uu = phase / TAU + k / 3;
        const u = uu - Math.floor(uu);
        const lift = u < 1 / 3 ? Math.sin(u * 3 * Math.PI) * mk : 0;
        if (part.anim === 'thigh') {
          ANIM.rx = -0.3 * lift - 0.1 * v.plant;
          ANIM.ry = Math.sin(u * Math.PI * 2) * 0.1 * mk;
        } else {
          ANIM.rx = 0.38 * lift;
        }
        break;
      }
      case 'mortar': {
        ANIM.ry = v.tYaw;
        ANIM.rx = v.recoil * 0.1;
        ANIM.oy = -v.recoil * 0.25;
        break;
      }
      case 'blade': {
        const shake = st === 'charge' ? Math.sin(t * 40 + v.seed) * 0.02 : 0;
        ANIM.rx = -0.3 * v.blade + shake;
        ANIM.oy = 0.35 * v.blade;
        break;
      }
      case 'beacon': {
        const rate = st === 'tell' || st === 'charge' ? 13 : 5;
        ANIM.ry = t * rate + (pa ? Math.PI : 0) + v.seed;
        break;
      }
    }
  }
}
