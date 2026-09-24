// BLOCKTOOTH — DebrisView (fx lane, CONTRACT §6 / §6.1 / §3).
//
// Rapier rigid-body chunks thrown off broken floors, collapsing buildings and destroyed props.
//   * Rapier is initialised ONCE per page (`await RAPIER.init()` inside mount, memoised).
//   * A fixed POOL of dynamic bodies (≤ 220 at quality 2, 140 at 1, 70 at 0) is created at mount,
//     parked disabled, and recycled: spawning re-shapes a parked body (cuboid), places it and
//     throws it AWAY from the titan; there is exactly one collider in the world besides the
//     chunks: the ground (y = 0).
//   * Physics runs at a fixed 60 Hz inside update() (accumulator, ≤ 3 substeps per frame) and
//     pauses while the sim is frozen (draft / pause / slate freeze-frame).
//   * Sleeping (or old) chunks shrink + sink into the street over 0.7 s, then the body is parked.
//   * Spawns are QUEUED and drained at a per-frame cap so a skyline collapse never blocks a frame.
//   * Rendering: two faceted chunk shapes (a jagged slab, a broken rock), each ONE InstancedMesh
//     (instance slot = pool slot, parked slots are zero-scaled) + an ink hull (1.6 px). Instance
//     colours come from the SOURCE building's palette (body/trim/roof/glass) or the prop's colours.
//   * Sizes scale by building tier and by titan height so debris reads at every rank.

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomePalette, Building, PropKind, SimEvent, World } from '../core/types.ts';
import { BIOMES } from '../data/biomes.ts';
import { PROP_INFO } from '../city/citygen.ts';
import { addOutline, bakeOutlineNormals, facet, makeToon, OUTLINE_PX } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

// ─────────────────────────────── tuning ───────────────────────────────
/** pool size by quality level */
const POOL_BY_Q = [70, 140, 220] as const;
/** max spawns drained from the queue per rendered frame, by quality */
const SPAWNS_PER_FRAME = [8, 14, 22] as const;
/** chunk-count multiplier per event, by quality */
const COUNT_MUL = [0.4, 0.7, 1] as const;
/** base chunk edge length (m) by building tier (before the random factor) */
const TIER_SIZE = [0.4, 0.85, 1.5, 2.5, 3.9] as const;
const PHYS_DT = 1 / 60;
const MAX_SUBSTEPS = 3;
const MAX_QUEUE = 420;
const LIFE_MAX = 4.5;          // s before an awake chunk is retired anyway
const SLEEP_HOLD = 0.8;        // s a chunk rests (settled) before it starts to fade
const FADE_S = 0.7;
/** a landed chunk slower than this (m/s, × √H) for SETTLE_S is taken out of the simulation */
const SETTLE_V = 0.6;
const SETTLE_S = 0.25;
// Interaction groups (membership << 16 | filter): chunks collide with the GROUND only — chunk-vs-chunk
// contacts are what made a 220-piece pile cost ~10 ms/frame; debris reads fine interpenetrating.
const GROUPS_GROUND = (0x0001 << 16) | 0x0002;
const GROUPS_CHUNK = (0x0002 << 16) | 0x0001;

let rapierInit: Promise<void> | null = null;
/** Memoised RAPIER.init() (the compat build inlines its wasm; initialise once per page). */
function initRapier(): Promise<void> {
  if (!rapierInit) rapierInit = RAPIER.init();
  return rapierInit;
}

interface SpawnReq {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  sx: number; sy: number; sz: number;
  r: number; g: number; b: number;
}

interface Slot {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  active: boolean;
  age: number;
  rest: number;          // seconds settled (asleep or frozen in place)
  slow: number;          // seconds landed + slow (settle timer)
  settled: boolean;      // taken out of the simulation (body disabled), drawn from the cached pose
  fade: number;          // > 0 while fading out (s elapsed)
  sx: number; sy: number; sz: number;
  // cached transform (sleeping bodies are not re-read)
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
  variant: 0 | 1;
  local: number;         // instance index inside its variant mesh
}

// ─────────────────────────────── geometry ───────────────────────────────
function hash01(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A jagged, faceted chunk geometry that fits roughly in a unit cube (centred). */
function chunkGeometry(variant: 0 | 1): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = variant === 0 ? new THREE.BoxGeometry(1, 1, 1, 2, 1, 2) : new THREE.IcosahedronGeometry(0.62, 0);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const j = variant === 0 ? 0.2 : 0.14;
    let x = pos.getX(i) + (hash01(i, 11 + variant) - 0.5) * j;
    let y = pos.getY(i) + (hash01(i, 23 + variant) - 0.5) * j;
    let z = pos.getZ(i) + (hash01(i, 37 + variant) - 0.5) * j;
    if (variant === 0 && y > 0.3 && x > 0.2) y -= 0.35;          // a chopped corner (broken slab)
    if (variant === 1) { x *= 0.95; y *= 0.8; z *= 1.05; }
    pos.setXYZ(i, x, y, z);
  }
  g = facet(g);
  // painted per-face value variation (white base, instance colour tints it)
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let t = 0; t < n / 3; t++) {
    const v = 0.82 + 0.18 * hash01(t, 71 + variant);
    for (let k = 0; k < 3; k++) { const o = (t * 3 + k) * 3; col[o] = v; col[o + 1] = v; col[o + 2] = v; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bakeOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

// ─────────────────────────────── prop colours ───────────────────────────────
function propColours(kind: PropKind, pal: BiomePalette, out: string[]): string[] {
  out.length = 0;
  switch (kind) {
    case 'car': case 'taxi': case 'van': case 'bus': case 'truck': case 'forklift':
      out.push(kind === 'taxi' ? pal.signB : pal.sign, pal.bodyC, '#e9e4da', '#3a4350', pal.glass); break;
    case 'boat': out.push('#f2efe6', pal.sign, pal.trimA); break;
    case 'tree': out.push(pal.foliage, pal.foliageB, pal.trimA); break;
    case 'container': out.push(pal.bodyC, pal.bodyA, pal.bodyB); break;
    case 'kiosk': case 'vending': out.push(pal.sign, pal.signB, '#f4efe4'); break;
    case 'snowbank': out.push('#f4f7fa', '#dfe7ee'); break;
    case 'drum': out.push('#d9563a', '#3f454c'); break;
    case 'hydrant': out.push('#e2493b', '#f1e4c8'); break;
    default: out.push(pal.trimA, pal.trimB, '#b9b2a3'); break;
  }
  return out;
}

// ─────────────────────────────── view ───────────────────────────────
export class DebrisView implements ViewModule {
  private readonly ctx: ViewCtx;
  private world: RAPIER.World | null = null;
  private slots: Slot[] = [];
  private queue: SpawnReq[] = [];
  private reqPool: SpawnReq[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mat: THREE.MeshToonMaterial | null = null;
  private acc = 0;
  private activeCount = 0;
  private awake = 0;
  private mountEpoch = 0;
  private mounted = false;
  private pal: BiomePalette | null = null;
  private archCols = new Map<string, [string, string, string]>();
  private propCols: string[] = [];
  private glassLight = '#9cc7d6';
  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly eul = new THREE.Euler();
  private readonly grav = { x: 0, y: -9.81, z: 0 };
  private readonly colDirty = [false, false];

  constructor(ctx: ViewCtx) { this.ctx = ctx; }

  /** live chunk count (debug / tests) */
  get active(): number { return this.activeCount; }

  async mount(w: World): Promise<void> {
    const epoch = ++this.mountEpoch;
    await initRapier();
    if (epoch !== this.mountEpoch) return;           // unmounted (or re-mounted) while awaiting
    const biome = BIOMES[w.biomeId];
    this.pal = biome.palette;
    // glass shards: lightened so the toon SHADE band doesn't turn them into black boxes
    this.glassLight = '#' + new THREE.Color(biome.palette.glass).lerp(new THREE.Color('#ffffff'), 0.35).getHexString();
    this.archCols.clear();
    for (const a of biome.archetypes) {
      this.archCols.set(a.id, [biome.palette[a.body], biome.palette[a.trim], biome.palette[a.roof]]);
    }

    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = PHYS_DT;
    // chunks only ever touch the ground (see collision groups) → one solver iteration is plenty
    world.numSolverIterations = 1;
    // the only static collider: the street (a thick slab whose top face is y = 0)
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(6000, 2, 6000).setFriction(0.9).setRestitution(0.1)
      .setCollisionGroups(GROUPS_GROUND), ground);
    this.world = world;

    const cap = POOL_BY_Q[this.ctx.quality.level] ?? 220;
    const half = [Math.ceil(cap / 2), Math.floor(cap / 2)];
    this.mat = makeToon({ vertexColors: true });
    const shadows = this.ctx.quality.shadows && this.ctx.quality.level >= 1;
    for (let v = 0; v < 2; v++) {
      const geo = chunkGeometry(v as 0 | 1);
      this.geos.push(geo);
      const im = new THREE.InstancedMesh(geo, this.mat, half[v]);
      im.name = v === 0 ? 'debris:slab' : 'debris:rock';
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < half[v]; i++) { im.setMatrixAt(i, this.zeroM); im.setColorAt(i, this.col.setRGB(1, 1, 1)); }
      im.frustumCulled = false;                    // chunks span the whole view; culling per batch is pointless
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.visible = false;
      addOutline(im, OUTLINE_PX.prop);
      this.ctx.scene.add(im);
      this.meshes.push(im);
    }

    for (let i = 0; i < cap; i++) {
      const variant: 0 | 1 = i < half[0] ? 0 : 1;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.35).setEnabled(false)
          .setTranslation(0, -50 - i, 0),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(1).setFriction(0.85).setRestitution(0.18)
          .setCollisionGroups(GROUPS_CHUNK), body,
      );
      this.slots.push({
        body, collider, active: false, age: 0, rest: 0, slow: 0, settled: false, fade: 0, sx: 1, sy: 1, sz: 1,
        px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, variant, local: variant === 0 ? i : i - half[0],
      });
    }
    this.acc = 0;
    this.activeCount = 0;
    this.queue.length = 0;
    this.mounted = true;
  }

  update(w: World, f: FrameInfo): void {
    if (!this.mounted || !this.world) return;
    const T = w.titan;
    const H = T.height;
    const q = this.ctx.quality.level;
    // 1) events → spawn requests
    for (let i = 0; i < f.events.length; i++) this.onEvent(w, f.events[i], H, q);
    // 2) drain the queue (per-frame cap)
    const n = Math.min(this.queue.length, SPAWNS_PER_FRAME[q] ?? 22);
    for (let i = 0; i < n; i++) {
      const r = this.queue.shift()!;
      this.spawn(r);
      this.reqPool.push(r);
    }
    // 3) physics (paused while frozen)
    if (!f.frozen && (this.awake > 0 || n > 0)) {
      // bigger titans = bigger, heavier-looking world: a touch more gravity so chunks don't float
      const gMul = Math.min(2.2, Math.max(1, 1 + (H - 1.2) * 0.03));
      this.grav.y = -9.81 * gMul;
      this.world.gravity = this.grav;
      const lu = Math.min(5, Math.max(1, H * 0.08));
      if (Math.abs(this.world.lengthUnit - lu) > 0.05) this.world.lengthUnit = lu;
      this.acc = Math.min(this.acc + f.dt, PHYS_DT * MAX_SUBSTEPS);
      while (this.acc >= PHYS_DT) { this.world.step(); this.acc -= PHYS_DT; }
    } else if (f.frozen) {
      this.acc = 0;
    }
    // 4) lifecycle + instance matrices
    const dt = f.frozen ? 0 : f.dt;
    const settleV2 = SETTLE_V * SETTLE_V * Math.max(1, H * 0.8);
    let dirty0 = false, dirty1 = false;
    let live = 0, awake = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      s.age += dt;
      const b = s.body;
      if (!s.settled) {
        if (b.isSleeping()) { s.settled = true; b.setEnabled(false); }
        else {
          const t = b.translation(); const r = b.rotation();
          s.px = t.x; s.py = t.y; s.pz = t.z; s.qx = r.x; s.qy = r.y; s.qz = r.z; s.qw = r.w;
          if (s.py < -20) s.fade = FADE_S;         // fell out of the world (should not happen)
          // landed + slow for a moment → freeze it in place (no more solver cost)
          if (s.py < Math.max(s.sx, s.sy, s.sz) * 0.9 && s.age > 0.3) {
            const v = b.linvel();
            if (v.x * v.x + v.y * v.y + v.z * v.z < settleV2) { s.slow += dt; if (s.slow > SETTLE_S) { s.settled = true; b.setEnabled(false); } }
            else s.slow = 0;
          }
        }
      }
      if (s.settled) s.rest += dt; else awake++;
      if (s.fade === 0 && (s.rest > SLEEP_HOLD || s.age > LIFE_MAX)) s.fade = 1e-4;
      let k = 1, sink = 0;
      if (s.fade > 0) {
        s.fade += dt;
        const u = Math.min(1, s.fade / FADE_S);
        k = 1 - u * u;
        sink = u * s.sy * 0.6;
        if (u >= 1) { this.park(s); continue; }
      }
      live++;
      this.p3.set(s.px, s.py - sink, s.pz);
      this.q.set(s.qx, s.qy, s.qz, s.qw);
      this.s3.set(s.sx * k, s.sy * k, s.sz * k);
      this.m4.compose(this.p3, this.q, this.s3);
      this.meshes[s.variant].setMatrixAt(s.local, this.m4);
      if (s.variant === 0) dirty0 = true; else dirty1 = true;
    }
    this.activeCount = live;
    this.awake = awake;
    for (let v = 0; v < 2; v++) {
      const im = this.meshes[v];
      if ((v === 0 ? dirty0 : dirty1) || this.colDirty[v]) im.instanceMatrix.needsUpdate = true;
      if (this.colDirty[v] && im.instanceColor) { im.instanceColor.needsUpdate = true; this.colDirty[v] = false; }
      im.visible = live > 0 || this.queue.length > 0;
    }
  }

  unmount(): void {
    this.mountEpoch++;
    this.mounted = false;
    for (const im of this.meshes) {
      im.removeFromParent();
      im.dispose();
    }
    for (const g of this.geos) g.dispose();
    this.mat?.dispose();
    this.meshes = [];
    this.geos = [];
    this.mat = null;
    this.slots = [];
    this.queue.length = 0;
    this.activeCount = 0;
    if (this.world) { this.world.free(); this.world = null; }
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private park(s: Slot): void {
    s.active = false;
    s.fade = 0;
    s.body.setEnabled(false);
    this.meshes[s.variant].setMatrixAt(s.local, this.zeroM);
    this.meshes[s.variant].instanceMatrix.needsUpdate = true;
  }

  private req(): SpawnReq {
    return this.reqPool.pop() ?? { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sx: 1, sy: 1, sz: 1, r: 1, g: 1, b: 1 };
  }

  private enqueue(r: SpawnReq): void {
    if (this.queue.length >= MAX_QUEUE) { this.reqPool.push(this.queue.shift()!); }
    this.queue.push(r);
  }

  private spawn(r: SpawnReq): void {
    // pick a parked slot; else steal the oldest fading/sleeping, else the oldest overall
    let pick: Slot | null = null;
    let best = -1;
    const start = (Math.random() * this.slots.length) | 0;     // spread across both variants
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[(start + k) % this.slots.length];
      if (!s.active) { pick = s; break; }
      const score = s.age + (s.fade > 0 ? 100 : 0) + (s.settled ? 50 : 0);
      if (score > best) { best = score; pick = s; }
    }
    if (!pick) return;
    const s = pick;
    const b = s.body;
    s.collider.setShape(new RAPIER.Cuboid(r.sx * 0.45, r.sy * 0.45, r.sz * 0.45));
    b.setEnabled(true);
    b.setTranslation({ x: r.x, y: r.y, z: r.z }, true);
    const yaw = Math.random() * Math.PI * 2, tilt = (Math.random() - 0.5) * 1.2;
    this.q.setFromEuler(this.eul.set(tilt, yaw, tilt * 0.5));
    b.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, true);
    b.setLinvel({ x: r.vx, y: r.vy, z: r.vz }, true);
    const spin = 2 + Math.random() * 6;
    b.setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin }, true);
    b.wakeUp();
    s.active = true; s.age = 0; s.rest = 0; s.slow = 0; s.settled = false; s.fade = 0;
    s.sx = r.sx; s.sy = r.sy; s.sz = r.sz;
    s.px = r.x; s.py = r.y; s.pz = r.z;
    s.qx = this.q.x; s.qy = this.q.y; s.qz = this.q.z; s.qw = this.q.w;
    this.col.setRGB(r.r, r.g, r.b);
    this.meshes[s.variant].setColorAt(s.local, this.col);
    this.colDirty[s.variant] = true;
    this.activeCount++;
  }

  private onEvent(w: World, e: SimEvent, H: number, q: 0 | 1 | 2): void {
    const mul = COUNT_MUL[q] ?? 1;
    switch (e.type) {
      case 'floorBreak': {
        const b = w.city.buildings[e.id];
        if (!b || b.id !== e.id) return;
        const n = Math.max(1, Math.round((3 + e.tier * 2) * mul));
        this.burstFromBuilding(w, b, n, H, false);
        break;
      }
      case 'buildingCollapse': {
        const b = w.city.buildings[e.id];
        if (!b || b.id !== e.id) return;
        const n = Math.max(2, Math.round((10 + e.tier * 6) * mul));
        this.burstFromBuilding(w, b, n, H, true);
        break;
      }
      case 'propDestroyed': {
        const info = PROP_INFO[e.kind];
        if (!info || !this.pal) return;
        const big = info.tier === 1;
        const n = Math.max(1, Math.round((info.vehicle || big ? (big ? 6 : 4) : 2) * mul));
        const cols = propColours(e.kind, this.pal, this.propCols);
        const size = Math.max(0.18, Math.min(1.6, Math.min(info.len, info.wid) * 0.45, 0.35 * H + 0.25));
        this.burstAt(w, e.x, e.z, info.len, info.wid, 0.3, Math.max(0.6, info.wid * 0.6), n, size, H, cols, 0.8);
        break;
      }
      default: break;
    }
  }

  private burstFromBuilding(w: World, b: Building, n: number, H: number, collapse: boolean): void {
    if (!this.pal) return;
    const ac = this.archCols.get(b.arch);
    const cols = this.propCols;
    cols.length = 0;
    const body = ac ? ac[0] : this.pal.bodyA, trim = ac ? ac[1] : this.pal.trimA, roof = ac ? ac[2] : this.pal.roofA;
    // weights: body ×6, trim ×2, roof ×1, glass ×1
    cols.push(body, body, body, body, body, body, trim, trim, roof, this.glassLight);
    // chunk size by tier, capped relative to the titan so a baby titan's bite doesn't throw boulders
    const size = Math.min(TIER_SIZE[b.tier] ?? 1, 0.35 * H + 0.25);
    const y0 = 0.2;
    const y1 = collapse ? Math.min(b.floors * b.floorH, Math.max(b.floorH * 3, 6)) : Math.max(1, b.floorH);
    this.burstAt(w, b.x, b.z, b.w, b.d, y0, y1, n, size, H, cols, collapse ? 1.25 : 1);
  }

  /**
   * Queue `n` chunks from an axis-aligned footprint (cx,cz,w,d) between heights y0..y1. Chunks
   * start on the footprint edge facing the titan (collapse: anywhere in the footprint) and are
   * thrown away from the titan + outward + up; speeds scale with √H so big bodies throw big debris.
   */
  private burstAt(w: World, cx: number, cz: number, fw: number, fd: number, y0: number, y1: number,
    n: number, size: number, H: number, cols: readonly string[], power: number): void {
    const T = w.titan;
    let ax = cx - T.x, az = cz - T.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const sp = Math.sqrt(Math.max(1, H * 0.8)) * power;
    const minSize = H * 0.07;
    const hw = fw / 2, hd = fd / 2;
    // the footprint point nearest the titan (where the bite / plow happened)
    const nx = Math.min(cx + hw, Math.max(cx - hw, T.x)), nz = Math.min(cz + hd, Math.max(cz - hd, T.z));
    const collapse = power > 1.1;
    for (let i = 0; i < n; i++) {
      const r = this.req();
      let x: number, z: number;
      if (collapse) { x = cx + (Math.random() - 0.5) * fw * 0.9; z = cz + (Math.random() - 0.5) * fd * 0.9; }
      else {
        // spread along the facing edge
        const tx = -az, tz = ax;
        const spread = (Math.random() - 0.5) * Math.min(fw, fd) * 0.8;
        x = nx + tx * spread; z = nz + tz * spread;
        x = Math.min(cx + hw, Math.max(cx - hw, x)); z = Math.min(cz + hd, Math.max(cz - hd, z));
      }
      const e = Math.max(minSize, size * (0.55 + Math.random() * 0.75));
      r.sx = e * (0.8 + Math.random() * 0.5); r.sy = e * (0.5 + Math.random() * 0.5); r.sz = e * (0.8 + Math.random() * 0.5);
      r.x = x; r.z = z; r.y = y0 + Math.random() * (y1 - y0) + r.sy * 0.5;
      // radial from the footprint centre (for collapses) + away from the titan
      let rx = x - cx, rz = z - cz;
      const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      const away = collapse ? 0.5 : 1;
      const hs = (1.6 + Math.random() * 3.2) * sp;
      r.vx = (ax * away + rx * (collapse ? 1 : 0.35)) * hs + (Math.random() - 0.5) * sp * 1.5;
      r.vz = (az * away + rz * (collapse ? 1 : 0.35)) * hs + (Math.random() - 0.5) * sp * 1.5;
      r.vy = (2.5 + Math.random() * 4.5) * sp * (collapse ? 0.8 : 1);
      const hex = cols[(Math.random() * cols.length) | 0];
      this.col.set(hex);
      const v = 0.92 + Math.random() * 0.14;
      r.r = this.col.r * v; r.g = this.col.g * v; r.b = this.col.b * v;
      this.enqueue(r);
    }
  }
}
