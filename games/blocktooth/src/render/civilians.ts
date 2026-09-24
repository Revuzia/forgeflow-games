// BLOCKTOOTH — CivilianView (fx lane, CONTRACT §6 / §6.1 / §1 tone).
//
// Purely cosmetic crowds (Math.random is fine here — views may use it; the sim never sees these).
//   * Civilians are DOTS: tiny faceted pills (bright clothing colour) + a head, instanced (one
//     InstancedMesh for bodies, one for heads; ink hulls only while they are big enough to read).
//   * They live on the SIDEWALK ring of LIVE blocks (Chebyshev liveRadiusByRank around the titan)
//     inside a window around the camera target; count scales with rank so they read as crowds
//     from far away (and with quality). Out-of-window civilians are recycled to fresh sidewalk spots.
//   * Behaviour: mill along the sidewalk / stand and gawk → FLEE away from the titan when it is
//     within ~6H (moving) or ~2.5H (standing) → calm down once far away.
//   * A titan footstep that lands on them (Size II+) — or a collapse / explosion on top of them —
//     makes them PUFF: a little cream dust pop. Never gore.

import * as THREE from 'three';
import type { World } from '../core/types.ts';
import { CITY, PARCEL_HALF } from '../core/config.ts';
import { harbourWaterZ } from '../city/citygen.ts';
import { addOutline, bakeOutlineNormals, facet, makeToon } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

const CAP = 640;
/** target crowd size by rank (× quality multiplier) */
const CROWD = [70, 160, 320, 520, 640] as const;
const Q_MUL = [0.4, 0.7, 1] as const;
/** civilian scale by rank: a touch larger at distance so the dots survive the zoom-out */
const CIV_SCALE = [1, 1.2, 1.7, 2.5, 3.3] as const;
/** sidewalk band (local offset from the block centre) — parcel edge 26 m … curb 29 m */
const SW_IN = PARCEL_HALF + 0.45;
const SW_OUT = PARCEL_HALF + 2.6;
/** assumed sidewalk top height (city-view owns the real curb mesh) */
const SIDEWALK_Y = 0.16;
const PUFF_CAP = 72;
const PUFF_BALLS = 3;
const PUFF_LIFE = 0.55;

const CLOTHES = ['#ff6f5e', '#ffd166', '#3fb8ff', '#7ad97a', '#b98bff', '#ff9ec7', '#f7f4ea', '#ff9f43', '#44d2c2', '#e84a3c', '#5b7cff'];
const SKIN = ['#f3d2b3', '#e2b48f', '#c98e66', '#9c6a48', '#6e4a33'];

const ST_EMPTY = 0, ST_MILL = 1, ST_IDLE = 2, ST_FLEE = 3, ST_GONE = 4;

function pillGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.19, 0.25, 0.9, 6, 1);
  body.translate(0, 0.5, 0);
  const shoulders = new THREE.IcosahedronGeometry(0.21, 0);
  shoulders.scale(1.05, 0.55, 0.9);
  shoulders.translate(0, 0.95, 0);
  return mergeFaceted([body, shoulders]);
}

function headGeometry(): THREE.BufferGeometry {
  const head = new THREE.IcosahedronGeometry(0.17, 0);
  head.translate(0, 1.2, 0.02);
  return mergeFaceted([head]);
}

function mergeFaceted(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  const flat = parts.map((p) => { const g = p.index ? p.toNonIndexed() : p; total += g.getAttribute('position').count; return g; });
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of flat) {
    const a = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++, o++) { pos[o * 3] = a.getX(i); pos[o * 3 + 1] = a.getY(i); pos[o * 3 + 2] = a.getZ(i); }
  }
  for (const p of parts) p.dispose();
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g = facet(g);
  bakeOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

interface Puff { x: number; y: number; z: number; t: number; s: number; }

export class CivilianView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private bodies: THREE.InstancedMesh | null = null;
  private heads: THREE.InstancedMesh | null = null;
  private puffs: THREE.InstancedMesh | null = null;
  private bodyHull: THREE.Mesh | null = null;
  private headHull: THREE.Mesh | null = null;
  private disposables: { dispose(): void }[] = [];
  // SoA civilian state
  private readonly x = new Float32Array(CAP);
  private readonly z = new Float32Array(CAP);
  private readonly vx = new Float32Array(CAP);
  private readonly vz = new Float32Array(CAP);
  private readonly t = new Float32Array(CAP);          // state timer (s)
  private readonly spd = new Float32Array(CAP);
  private readonly ph = new Float32Array(CAP);         // gait phase
  private readonly hd = new Float32Array(CAP);         // facing heading
  private readonly st = new Uint8Array(CAP);
  private readonly colDirty = new Uint8Array(CAP);
  private puffList: Puff[] = [];
  private puffCursor = 0;
  private waterZ: number | null = null;
  private clothes: THREE.Color[] = [];
  private skin: THREE.Color[] = [];
  private lastRank = -1;
  private live = 0;
  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly eul = new THREE.Euler();
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly zeroM = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(ctx: ViewCtx) { this.ctx = ctx; this.root.name = 'civilians'; }

  /** civilians currently on screen (debug / tests) */
  get count(): number { return this.live; }

  mount(w: World): void {
    this.waterZ = harbourWaterZ(w.city);
    this.clothes = CLOTHES.map((h) => new THREE.Color(h));
    this.skin = SKIN.map((h) => new THREE.Color(h));
    const mat = makeToon({ color: '#ffffff' });
    const bodyGeo = pillGeometry(), headGeo = headGeometry();
    this.disposables.push(mat, bodyGeo, headGeo);
    this.bodies = new THREE.InstancedMesh(bodyGeo, mat, CAP);
    this.heads = new THREE.InstancedMesh(headGeo, mat, CAP);
    for (const im of [this.bodies, this.heads]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = true;
      for (let i = 0; i < CAP; i++) { im.setMatrixAt(i, this.zeroM); im.setColorAt(i, this.clothes[0]); }
      this.root.add(im);
    }
    this.bodies.name = 'civ:bodies'; this.heads.name = 'civ:heads';
    this.bodyHull = addOutline(this.bodies, 1.2);
    this.headHull = addOutline(this.heads, 1.2);

    const puffGeo = mergeFaceted([new THREE.IcosahedronGeometry(0.5, 0)]);
    const puffMat = makeToon({ color: '#f4ecd8' });
    this.disposables.push(puffGeo, puffMat);
    this.puffs = new THREE.InstancedMesh(puffGeo, puffMat, PUFF_CAP * PUFF_BALLS);
    this.puffs.name = 'civ:puffs';
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.frustumCulled = false;
    this.puffs.count = 0;
    addOutline(this.puffs, 1.4);
    this.root.add(this.puffs);
    this.puffList = [];
    for (let i = 0; i < PUFF_CAP; i++) this.puffList.push({ x: 0, y: 0, z: 0, t: PUFF_LIFE, s: 1 });

    this.st.fill(ST_EMPTY);
    this.lastRank = -1;
    this.ctx.scene.add(this.root);
  }

  update(w: World, f: FrameInfo): void {
    if (!this.bodies || !this.heads || !this.puffs) return;
    const T = w.titan;
    const H = T.height;
    const rank = T.rank;
    const a = f.alpha;
    const tx = T.px + (T.x - T.px) * a, tz = T.pz + (T.z - T.pz) * a;
    const dt = f.frozen ? 0 : f.dt;
    const qm = Q_MUL[this.ctx.quality.level] ?? 1;
    const want = Math.min(CAP, Math.round(CROWD[rank] * qm));
    const scale = CIV_SCALE[rank];
    const R = Math.max(10, f.camDist * 0.62);            // spawn window around the camera target
    const R2out = (f.camDist * 0.9 + 6) * (f.camDist * 0.9 + 6);
    const liveR = CITY.liveRadiusByRank[rank] ?? 2;
    const city = w.city;
    const P = city.pitch;
    const tbx = Math.floor((tx - city.originX) / P), tbz = Math.floor((tz - city.originZ) / P);
    const moving = T.moving || T.speed > 0.5;
    const fleeR = H * (moving ? 6 : 2.5);
    const calmR = H * 8.5;
    const squashR = Math.max(0.7, T.radius * 1.15);
    const canSquash = H > 2.4;                            // a Size I titan is shorter than they are

    if (rank !== this.lastRank) {
      this.lastRank = rank;
      const showInk = rank <= 1;
      if (this.bodyHull) this.bodyHull.visible = showInk;
      if (this.headHull) this.headHull.visible = showInk;
    }

    // ── events: footsteps / collapses / explosions puff whoever is underneath ──
    if (!f.frozen) {
      for (let k = 0; k < f.events.length; k++) {
        const e = f.events[k];
        if (e.type === 'footstep' && canSquash) this.squashCircle(e.x, e.z, squashR, scale);
        else if (e.type === 'buildingCollapse') this.squashRect(e.x, e.z, e.w / 2 + 2 * scale, e.d / 2 + 2 * scale, scale);
        else if (e.type === 'explosion') this.squashCircle(e.x, e.z, e.r * 0.8, scale);
      }
      // the titan's own body (moving) also flattens whoever it wades through (Size II+)
      if (canSquash && moving) this.squashCircle(tx, tz, T.radius * 0.85, scale);
    }

    // ── spawn / recycle ──
    let alive = 0;
    for (let i = 0; i < CAP; i++) {
      const s = this.st[i];
      if (s === ST_EMPTY) continue;
      if (s === ST_GONE) {
        this.t[i] -= dt;
        if (this.t[i] <= 0) this.st[i] = ST_EMPTY;
        continue;
      }
      const dx = this.x[i] - tx, dz = this.z[i] - tz;
      if (dx * dx + dz * dz > R2out || !this.inLiveBlock(city, this.x[i], this.z[i], tbx, tbz, liveR)) { this.st[i] = ST_EMPTY; continue; }
      alive++;
    }
    let budget = f.frozen ? 0 : Math.max(8, Math.ceil(want / 10));   // spread refills over frames
    if (this.live === 0 && alive === 0) budget = want;                 // first frame: fill at once
    for (let i = 0; i < CAP && alive < want && budget > 0; i++) {
      if (this.st[i] !== ST_EMPTY) continue;
      budget--;
      if (this.spawnAt(i, w, tx, tz, R, H, tbx, tbz, liveR)) alive++;
    }
    // over budget after a quality drop: retire the farthest few
    if (alive > want) {
      for (let i = CAP - 1; i >= 0 && alive > want; i--) if (this.st[i] === ST_MILL || this.st[i] === ST_IDLE) { this.st[i] = ST_EMPTY; alive--; }
    }

    // ── behaviour + instances ──
    let n = 0;
    const bodies = this.bodies, heads = this.heads;
    for (let i = 0; i < CAP; i++) {
      const s = this.st[i];
      if (s === ST_EMPTY || s === ST_GONE) { bodies.setMatrixAt(i, this.zeroM); heads.setMatrixAt(i, this.zeroM); continue; }
      let x = this.x[i], z = this.z[i];
      const dx = x - tx, dz = z - tz;
      const d = Math.hypot(dx, dz) || 1e-3;
      this.t[i] -= dt;
      if (s !== ST_FLEE && d < fleeR) {
        this.st[i] = ST_FLEE;
        const sp = (3.4 + 0.11 * H) * (0.8 + Math.random() * 0.45);
        const jit = (Math.random() - 0.5) * 0.9;
        const ux = dx / d, uz = dz / d;
        this.vx[i] = (ux * Math.cos(jit) - uz * Math.sin(jit)) * sp;
        this.vz[i] = (ux * Math.sin(jit) + uz * Math.cos(jit)) * sp;
        this.spd[i] = sp;
        this.t[i] = 2.5 + Math.random() * 2;
      } else if (s === ST_FLEE) {
        // keep steering away from the titan (with a little panic wobble)
        const sp = this.spd[i];
        const ux = dx / d, uz = dz / d;
        const k = Math.min(1, dt * 3);
        this.vx[i] += (ux * sp - this.vx[i]) * k + (Math.random() - 0.5) * sp * dt * 2;
        this.vz[i] += (uz * sp - this.vz[i]) * k + (Math.random() - 0.5) * sp * dt * 2;
        if (d > calmR && this.t[i] <= 0) { this.st[i] = ST_MILL; this.setMill(i, x, z, city); }
      } else if (this.t[i] <= 0) {
        // mill ⇄ idle (stand and gawk toward the titan)
        if (s === ST_MILL && Math.random() < 0.45) { this.st[i] = ST_IDLE; this.vx[i] = 0; this.vz[i] = 0; this.t[i] = 1 + Math.random() * 3; }
        else { this.st[i] = ST_MILL; this.setMill(i, x, z, city); }
      }
      // integrate + keep out of parcels / water / city bounds
      x += this.vx[i] * dt; z += this.vz[i] * dt;
      const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
      const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
      let lx = x - cx, lz = z - cz;
      const onBand = this.st[i] !== ST_FLEE;
      if (onBand) {
        // milling civilians stay ON the sidewalk band; turn the corner at the ends
        // (a civilian that fled onto the road walks back to the curb instead of snapping)
        const ax = Math.abs(lx), az = Math.abs(lz);
        const step = 2.2 * dt;
        if (ax >= az) {
          const want = Math.min(SW_OUT, Math.max(SW_IN, ax));
          lx = Math.sign(lx || 1) * (ax + Math.max(-step, Math.min(step, want - ax)));
          if (Math.abs(lz) > SW_OUT && ax <= SW_OUT + 0.1) { lz = Math.sign(lz) * SW_OUT; this.turnCorner(i, true); }
        } else {
          const want = Math.min(SW_OUT, Math.max(SW_IN, az));
          lz = Math.sign(lz || 1) * (az + Math.max(-step, Math.min(step, want - az)));
          if (Math.abs(lx) > SW_OUT && az <= SW_OUT + 0.1) { lx = Math.sign(lx) * SW_OUT; this.turnCorner(i, false); }
        }
      } else if (Math.abs(lx) < PARCEL_HALF && Math.abs(lz) < PARCEL_HALF) {
        // fleeing: never run into a parcel (buildings) — slide out along the shallow axis
        if (PARCEL_HALF - Math.abs(lx) < PARCEL_HALF - Math.abs(lz)) { lx = Math.sign(lx || 1) * PARCEL_HALF; this.vx[i] *= -0.3; }
        else { lz = Math.sign(lz || 1) * PARCEL_HALF; this.vz[i] *= -0.3; }
      }
      x = cx + lx; z = cz + lz;
      const bb = city.bounds;
      if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ || (this.waterZ !== null && z < this.waterZ)) {
        this.st[i] = ST_EMPTY; bodies.setMatrixAt(i, this.zeroM); heads.setMatrixAt(i, this.zeroM); continue;
      }
      this.x[i] = x; this.z[i] = z;

      // pose
      const vx = this.vx[i], vz = this.vz[i];
      const v = Math.hypot(vx, vz);
      if (v > 0.05) this.hd[i] = Math.atan2(vx, vz);
      else if (this.st[i] === ST_IDLE) this.hd[i] = Math.atan2(tx - x, tz - z);   // gawk at the titan
      this.ph[i] += dt * (4 + v * 2.2);
      const onSidewalk = Math.max(Math.abs(lx), Math.abs(lz)) <= SW_OUT + 0.05 && Math.max(Math.abs(lx), Math.abs(lz)) >= PARCEL_HALF - 0.05;
      const y = (onSidewalk ? SIDEWALK_Y : 0) + (v > 0.05 ? Math.abs(Math.sin(this.ph[i])) * 0.14 * scale : 0);
      const lean = this.st[i] === ST_FLEE ? 0.28 : 0;
      this.eul.set(lean, this.hd[i], Math.sin(this.ph[i]) * (v > 0.05 ? 0.08 : 0.02));
      this.q.setFromEuler(this.eul);
      this.p3.set(x, y, z);
      this.s3.set(scale, scale * (0.92 + 0.16 * ((i * 37) % 11) / 11), scale);
      this.m4.compose(this.p3, this.q, this.s3);
      bodies.setMatrixAt(i, this.m4);
      heads.setMatrixAt(i, this.m4);
      if (this.colDirty[i]) {
        bodies.setColorAt(i, this.clothes[(Math.random() * this.clothes.length) | 0]);
        heads.setColorAt(i, this.skin[(Math.random() * this.skin.length) | 0]);
        this.colDirty[i] = 0;
        if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
        if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
      }
      n++;
    }
    this.live = n;
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    bodies.visible = heads.visible = n > 0;

    // ── puffs ──
    let np = 0;
    for (let k = 0; k < PUFF_CAP; k++) {
      const p = this.puffList[k];
      if (p.t >= PUFF_LIFE) continue;
      p.t += dt;
      if (p.t >= PUFF_LIFE) continue;
      const u = p.t / PUFF_LIFE;
      const grow = u < 0.3 ? 0.4 + (u / 0.3) * 0.75 : 1.15 * (1 - (u - 0.3) / 0.7);
      for (let b = 0; b < PUFF_BALLS; b++) {
        const ang = b * 2.094 + k;
        const r = p.s * (0.25 + u * 0.5);
        this.p3.set(p.x + Math.cos(ang) * r, p.y + p.s * (0.25 + u * 0.55 + b * 0.12), p.z + Math.sin(ang) * r);
        const bs = p.s * grow * (0.55 + 0.2 * b);
        this.s3.set(bs, bs * 0.85, bs);
        this.eul.set(k, ang, 0);
        this.q.setFromEuler(this.eul);
        this.m4.compose(this.p3, this.q, this.s3);
        this.puffs.setMatrixAt(np++, this.m4);
      }
    }
    this.puffs.count = np;
    this.puffs.visible = np > 0;
    if (np > 0) this.puffs.instanceMatrix.needsUpdate = true;
  }

  unmount(): void {
    this.root.removeFromParent();
    this.bodies?.dispose(); this.heads?.dispose(); this.puffs?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.bodies = this.heads = this.puffs = null;
    this.bodyHull = this.headHull = null;
    this.st.fill(ST_EMPTY);
    this.live = 0;
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private inLiveBlock(city: World['city'], x: number, z: number, tbx: number, tbz: number, liveR: number): boolean {
    const bx = Math.floor((x - city.originX) / city.pitch), bz = Math.floor((z - city.originZ) / city.pitch);
    return Math.abs(bx - tbx) <= liveR && Math.abs(bz - tbz) <= liveR;
  }

  /** place civilian i on a random sidewalk spot inside the window; false if no valid spot found */
  private spawnAt(i: number, w: World, tx: number, tz: number, R: number, H: number, tbx: number, tbz: number, liveR: number): boolean {
    const city = w.city;
    const P = city.pitch;
    const minD = Math.min(R * 0.7, H * 3);
    for (let tries = 0; tries < 6; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * R;
      const sx = tx + Math.cos(ang) * rr, sz = tz + Math.sin(ang) * rr;
      const bx = Math.floor((sx - city.originX) / P), bz = Math.floor((sz - city.originZ) / P);
      if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) continue;
      if (Math.abs(bx - tbx) > liveR || Math.abs(bz - tbz) > liveR) continue;
      const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
      let lx = sx - cx, lz = sz - cz;
      const band = SW_IN + Math.random() * (SW_OUT - SW_IN);
      if (Math.abs(lx) >= Math.abs(lz)) { lx = Math.sign(lx || 1) * band; lz = Math.max(-SW_OUT, Math.min(SW_OUT, lz)); }
      else { lz = Math.sign(lz || 1) * band; lx = Math.max(-SW_OUT, Math.min(SW_OUT, lx)); }
      const x = cx + lx, z = cz + lz;
      if (this.waterZ !== null && z < this.waterZ + 2) continue;
      const d = Math.hypot(x - tx, z - tz);
      if (d > R * 1.05 || d < minD) continue;
      this.x[i] = x; this.z[i] = z;
      this.st[i] = Math.random() < 0.7 ? ST_MILL : ST_IDLE;
      this.ph[i] = Math.random() * 6.28;
      this.colDirty[i] = 1;
      if (this.st[i] === ST_MILL) this.setMill(i, x, z, city);
      else { this.vx[i] = 0; this.vz[i] = 0; this.t[i] = 0.5 + Math.random() * 3; this.hd[i] = Math.random() * 6.28; }
      return true;
    }
    return false;
  }

  /** walk along the sidewalk side the civilian is on */
  private setMill(i: number, x: number, z: number, city: World['city']): void {
    const P = city.pitch;
    const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
    const lx = x - (city.originX + (bx + 0.5) * P), lz = z - (city.originZ + (bz + 0.5) * P);
    const sp = 0.7 + Math.random() * 0.8;
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (Math.abs(lx) >= Math.abs(lz)) { this.vx[i] = 0; this.vz[i] = dir * sp; }
    else { this.vx[i] = dir * sp; this.vz[i] = 0; }
    this.spd[i] = sp;
    this.t[i] = 2 + Math.random() * 5;
  }

  /** reached the end of a sidewalk side: continue along the perpendicular side */
  private turnCorner(i: number, wasXSide: boolean): void {
    const sp = this.spd[i] || 1;
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (wasXSide) { this.vx[i] = dir * sp; this.vz[i] = 0; } else { this.vz[i] = dir * sp; this.vx[i] = 0; }
  }

  private squashCircle(x: number, z: number, r: number, scale: number): void {
    const r2 = r * r;
    for (let i = 0; i < CAP; i++) {
      const s = this.st[i];
      if (s === ST_EMPTY || s === ST_GONE) continue;
      const dx = this.x[i] - x, dz = this.z[i] - z;
      if (dx * dx + dz * dz <= r2) this.puff(i, scale);
    }
  }

  private squashRect(x: number, z: number, hw: number, hd: number, scale: number): void {
    for (let i = 0; i < CAP; i++) {
      const s = this.st[i];
      if (s === ST_EMPTY || s === ST_GONE) continue;
      if (Math.abs(this.x[i] - x) <= hw && Math.abs(this.z[i] - z) <= hd) this.puff(i, scale);
    }
  }

  private puff(i: number, scale: number): void {
    this.st[i] = ST_GONE;
    this.t[i] = 1.5 + Math.random() * 2;           // respawn delay
    const p = this.puffList[this.puffCursor];
    this.puffCursor = (this.puffCursor + 1) % PUFF_CAP;
    p.x = this.x[i]; p.z = this.z[i]; p.y = SIDEWALK_Y; p.t = 0; p.s = 0.9 * scale;
  }
}
