// BLOCKTOOTH — gatekeeper rigs (GATEKEEPERS.md §3.4, lane K2a GATE VIEW): STENCIL-1, CORDON-2, SWITCHBOARD-5.
// VIEW code (THREE; never writes gameplay state).
//
// The CONTRACT §6.1 look: faceted low poly built with the foe Facet kit (non-indexed, flat normals, painted
// vertex colours, baked outline normals, 3.0 px ink hulls). Every rig is authored facing +Z IN TITAN HEIGHTS
// (H = 1) and bossview.ts scales its root by `b.data.H` every frame, so the home fight (H 3.125 / 10.77 /
// 25.6 m) and the EXTENDED COVERAGE rematch at Size V (H 60–67 m) are the same model, bigger. The part
// layout matches the sim's collider table (bosses/stencil1.ts / cordon2.ts / switchboard5.ts PARTS, × H), so
// a bite lands on the piece it visibly hits; each collider name is a flash group (bossHit → that group).
//
//   STENCIL-1  a three-wheeled road-marking cart bolted up to 2.3 H: cream chassis with a safety-yellow band,
//              a bubble cab with two round headlamp EYES, an amber roof beacon, a spray BOOM on the right
//              flank (+X), a white PAINT DRUM on a tilting cradle at the back (lidded), a refill funnel on a
//              mast, a bucket flinger + spare-bucket rack on the left flank, two fat rear wheels and a front
//              caster. Posed: wheels spin with ground speed; STRIPE RUN — revving squat, the boom lowers and
//              sweeps a white spray ribbon over the lane while it is painted, a forward lean on the race and
//              a skid (yaw wobble + dust) at the end; REFILL — the lid swings up, the cradle tilts back 15°,
//              the funnel arm lowers into the drum, the drum glows; PAINT BUCKETS — the flinger arm throws one
//              bucket per lob; TIPPED OVER — it rolls onto its left side, wheels spinning in the air, paint
//              glugging out; defeat — the lid pops off, a white paint geyser, then the cart settles flat.
//   CORDON-2   a tracked crowd-barrier unit, 2.0 H tall: six interlocking chevron PANELS on a curved front wall
//              (one instanced draw, per-panel pose + flash), twin caterpillar tracks with scrolling cleats, a
//              navy engine house with a `LINE CLOSED` sign and a sawhorse hopper, two exhaust STACKS, the
//              teal GENERATOR PACK cage on its back, two swivelling arc lamps. Posed: treads scroll by track
//              speed (differential on turns); panels flex per step; SHIELD SHOVE — a crouch with the panels
//              locking together, then a lurch; OVERHEATED — the stacks glow orange and puff, the pack coils
//              brighten; SAWHORSE TOSS — a centre panel hinges open; BACKFIRE — the stacks swing back and
//              blast; STALLED — the panels droop outward like a wilted fence, the lamps flicker; defeat — the
//              panels topple outward one by one like dominoes.
//   SWITCHBOARD-5  a four-track crawler base (outrigger feet, a horn cluster ON THE DECK), a two-piece lattice
//              MAST (2.6 H) with a lit `NOW SERVING` board (seven-segment digits), and a turning crown with
//              three RELAY DISHES on arms. Silhouette rule (§3.3): a wide vehicle with a mast and three dishes —
//              no limbs, no horns above the deck, no head-like crown. Posed: the crown follows the sim angle,
//              each dish tracks the titan by ±10°; the board ticks up per PUT THROUGH and shows `--` in LINES
//              DOWN; RELOCATE — the dishes fold flat, the outriggers lift, the treads race and the mast sways;
//              CALL-IN — the facing dish flashes as each flare arcs out; HOLD MUSIC — the deck horns pulse with
//              expanding sound rings; LINES DOWN — the dishes droop; defeat — the mast buckles at the middle and
//              folds down across the street.
//
// Budget: STENCIL-1 13 meshes, CORDON-2 9, SWITCHBOARD-5 12 → ≤ 26 / 17 / 22 draws including hulls (§3.4:
// ≤ 30), instanced panels / cleats / dishes / digits / fx, zero per-frame allocation (scratch objects, fixed
// pools). All three rigs are built once at mount (warm-up compiles the shared foe program up front); one is
// shown at a time (the fights never overlap).

import * as THREE from 'three';
import type { BossState, GateId, World } from '../core/types.ts';
import { clamp, easeOutBack, easeOutCubic, lerp, smoothstep, wrapAngle } from '../core/math.ts';
import { addOutline } from '../render/materials.ts';
import { FOE_PAL, Facet, M, makeFoeMaterial, ngon, rect } from './foemodels.ts';
import type { BossRig, FlashGroup } from './bossview.ts';

const P = FOE_PAL;
const PI = Math.PI;
const OUTLINE_W = 3.0;

/** The titan height each rig's HOME fight is held at (m): the ceiling of the Size it guards (§3.0). The rigs
 *  themselves are authored at H = 1 and scaled by b.data.H (this table is informational / probe telemetry). */
export const GATE_H_AUTHORED: Readonly<Record<GateId, number>> = { stencil1: 3.125, cordon2: 10.77, switchboard5: 25.6 };

// ─────────────────────────────── shared palette (HALVARD street-works livery) ───────────────────────────────
const C = {
  cream: '#f1e4c8', creamD: '#dccfb2', yellow: '#ffd166', yellowD: '#e0a93a', ink: '#1e242e', dark: '#343a46',
  steel: '#98a1ad', steelD: '#5c6470', tire: '#27262d', paint: '#f7f6f0', paintD: '#dcdcd4', glass: '#5f9fb3',
  glassD: '#3f6f82', lamp: '#fff1c4', amber: '#ffb13b', orange: '#ff7a1c', red: '#e84a3c', navy: '#26375c',
  navyD: '#18223d', navyL: '#3d5484', teal: '#4fb3b0', tealD: '#2f7f86', white: '#f4f1ea', hzK: '#1e242e',
  hzY: '#ffc63d', grey: '#6f7885', greyD: '#4c535e', rust: '#b5653a',
} as const;

// ─────────────────────────────── block letters (build time) ───────────────────────────────
const GLYPH: Record<string, readonly string[]> = {
  L: ['100', '100', '100', '100', '111'], I: ['111', '010', '010', '010', '111'], N: ['1001', '1101', '1011', '1001', '1001'],
  E: ['111', '100', '110', '100', '111'], C: ['111', '100', '100', '100', '111'], O: ['111', '101', '101', '101', '111'],
  S: ['111', '100', '111', '001', '111'], D: ['110', '101', '101', '101', '110'], W: ['10001', '10001', '10101', '10101', '01010'],
  R: ['110', '101', '110', '101', '101'], V: ['101', '101', '101', '101', '010'], G: ['111', '100', '101', '101', '111'],
};
function textCells(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const g = GLYPH[s[i]]; n += (g ? g[0].length : 2) + (i < s.length - 1 ? 1 : 0); }
  return n;
}
/** Raised block letters in the local XY plane, centred on the origin, facing +Z, `d` proud. */
function blockText(f: Facet, s: string, cell: number, d: number, col: string, m: THREE.Matrix4, glow = 0): void {
  f.group(m, () => {
    let x = -textCells(s) * cell / 2;
    for (let i = 0; i < s.length; i++) {
      const g = GLYPH[s[i]];
      if (!g) { x += 3 * cell; continue; }
      for (let r = 0; r < 5; r++) {
        const row = g[r];
        let c = 0;
        while (c < row.length) {
          if (row[c] !== '1') { c++; continue; }
          let e = c; while (e < row.length && row[e] === '1') e++;
          const wdt = (e - c) * cell;
          f.box(wdt, cell, d, col, M(x + c * cell + wdt / 2, (2 - r) * cell, d / 2), { glow });
          c = e;
        }
      }
      x += (g[0].length + 1) * cell;
    }
  });
}

// ─────────────────────────────── rig plumbing ───────────────────────────────
function grp(glow: number, instanced = false): FlashGroup {
  const mat = makeFoeMaterial(instanced);
  mat.userData.bt.uGlowMul.value = glow;
  return { mat, flash: 0, glowBase: glow };
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
  addOutline(m, OUTLINE_W);
  return m;
}
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, outline: number, shadow = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const I = new THREE.Matrix4();
  for (let i = 0; i < cap; i++) m.setMatrixAt(i, I);
  if (outline > 0) addOutline(m, outline);
  return m;
}
function bld(fn: (f: Facet) => void, jitter = 0.03): THREE.BufferGeometry { const f = new Facet(); f.jitter = jitter; fn(f); return f.build(); }
function joint(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0): THREE.Group {
  const j = new THREE.Group(); j.name = name; j.position.set(x, y, z); parent.add(j); return j;
}
/** per-instance flash attribute shared by an instanced mesh's geometry (BT_INST_FLASH) */
function flashAttr(geo: THREE.BufferGeometry, n: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('instFlash', a);
  return a;
}

/** Inputs the posers read besides the World (bossview fills it; a record, so doubles are not boxed). */
export interface GateFrame { dt: number; alpha: number; frozen: boolean; x: number; z: number; h: number; time: number; H: number }

/** A gatekeeper rig: the shared BossRig record + its world-space fx meshes + its poser. */
export interface GateRig extends BossRig {
  gate: GateId;
  /** world-space fx (paint blobs, smoke, dust) — bossview adds them to its world group and hides them with the rig */
  fx: THREE.Object3D[];
  poser: GatePoser;
}
export interface GatePoser {
  reset(): void;
  update(w: World, b: BossState, F: GateFrame): void;
  /** hide the world-space fx (rig hidden / run reset) */
  hideFx(): void;
  /** a bossPhase event arrived (RECONFIGURING beat) */
  phase(): void;
}

const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * PI));
const kExp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _e0 = new THREE.Euler(0, 0, 0, 'YXZ');
const _p0 = new THREE.Vector3(), _s0 = new THREE.Vector3(), _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3();
const _col = new THREE.Color();

/** live windup (s) of this boss's unfired telegraph whose tag starts with `tag`, else -1 */
function liveWindup(w: World, tag: string): number {
  for (let i = 0; i < w.telegraphs.length; i++) {
    const tg = w.telegraphs[i];
    if (tg.alive && !tg.fired && tg.owner === 'boss' && tg.tag.startsWith(tag)) return tg.windup - tg.t;
  }
  return -1;
}

// ─────────────────────────────── world-space blob pool (paint / smoke / dust) ───────────────────────────────
const BLOB_CAP = 48;
/**
 * Faceted blobs in WORLD space (one instanced draw + hull): paint drips, glugs and the defeat geyser (white),
 * exhaust smoke (grey), skid dust (road dust). Positions, velocities and sizes in metres (the poser passes
 * H-scaled values); gravity per blob. Zero allocation (typed arrays, a ring cursor).
 */
class BlobPool {
  readonly mesh: THREE.InstancedMesh;
  private x = new Float32Array(BLOB_CAP); private y = new Float32Array(BLOB_CAP); private z = new Float32Array(BLOB_CAP);
  private vx = new Float32Array(BLOB_CAP); private vy = new Float32Array(BLOB_CAP); private vz = new Float32Array(BLOB_CAP);
  private s = new Float32Array(BLOB_CAP); private g = new Float32Array(BLOB_CAP); private grow = new Float32Array(BLOB_CAP);
  private age = new Float32Array(BLOB_CAP); private life = new Float32Array(BLOB_CAP); private rot = new Float32Array(BLOB_CAP);
  private cur = 0;
  private live = 0;
  /** emit parameters (a record: V8 boxes double call arguments) */
  readonly E = { x: 0.5, y: 0.5, z: 0.5, vx: 0.5, vy: 0.5, vz: 0.5, s: 0.5, g: 0.5, grow: 0.5, life: 0.5 };

  constructor(mat: THREE.Material, name: string) {
    const geo = bld((f) => {
      f.loft([
        { y: -0.5, pts: ngon(6, 0.02, 0.02) }, { y: -0.2, pts: ngon(6, 0.45, 0.45, 0.3) },
        { y: 0.22, pts: ngon(6, 0.5, 0.5) }, { y: 0.5, pts: ngon(6, 0.05, 0.05, 0.3) },
      ], { side: C.white, top: C.white, bottom: C.white });
    }, 0.06);
    this.mesh = inst(geo, mat, BLOB_CAP, name, 1.6, false);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BLOB_CAP * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false;
    for (let i = 0; i < BLOB_CAP; i++) this.age[i] = this.life[i] = 1;
  }
  emit(col: string): void {
    const i = this.cur; this.cur = (this.cur + 1) % BLOB_CAP;
    const E = this.E;
    this.x[i] = E.x; this.y[i] = E.y; this.z[i] = E.z; this.vx[i] = E.vx; this.vy[i] = E.vy; this.vz[i] = E.vz;
    this.s[i] = E.s; this.g[i] = E.g; this.grow[i] = E.grow; this.age[i] = 0; this.life[i] = Math.max(0.05, E.life);
    this.rot[i] = Math.random() * 6.28;
    _col.set(col);
    const a = this.mesh.instanceColor!.array as Float32Array;
    a[i * 3] = _col.r; a[i * 3 + 1] = _col.g; a[i * 3 + 2] = _col.b;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  clear(): void { for (let i = 0; i < BLOB_CAP; i++) this.age[i] = this.life[i]; this.live = 0; this.mesh.count = 0; this.mesh.visible = false; }
  step(dt: number): void {
    let n = 0;
    const im = this.mesh;
    for (let i = 0; i < BLOB_CAP; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      this.vy[i] -= this.g[i] * dt;
      const drag = Math.exp(-1.2 * dt);
      this.vx[i] *= drag; this.vz[i] *= drag;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      if (this.y[i] < 0) { this.y[i] = 0; this.vy[i] = 0; this.vx[i] *= 0.5; this.vz[i] *= 0.5; }
      const u = this.age[i] / this.life[i];
      const k = u < 0.15 ? u / 0.15 : u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      const sc = Math.max(1e-4, this.s[i] * (1 + this.grow[i] * u) * (0.35 + 0.65 * k));
      const flat = this.y[i] <= 0.001 ? 0.35 : 1;
      _p0.set(this.x[i], this.y[i] + sc * 0.3 * flat, this.z[i]);
      _e0.set(0, this.rot[i] + u * 2, 0, 'YXZ');
      _q0.setFromEuler(_e0);
      _s0.set(sc, sc * flat, sc);
      im.setMatrixAt(n++, _m0.compose(_p0, _q0, _s0));
    }
    // instanceColor is indexed by instance slot: compact the colours with the matrices
    if (n > 0) this.compactColors();
    this.live = n;
    im.count = n; im.visible = n > 0;
    if (n > 0) im.instanceMatrix.needsUpdate = true;
  }
  private colSrc = new Float32Array(BLOB_CAP * 3);
  private compactColors(): void {
    // the emit colour lives in slot i of colSrc; the drawn instance k takes the k-th live slot's colour
    const a = this.mesh.instanceColor!.array as Float32Array;
    const src = this.colSrc;
    let k = 0;
    for (let i = 0; i < BLOB_CAP; i++) {
      if (this.age[i] >= this.life[i]) continue;
      a[k * 3] = src[i * 3]; a[k * 3 + 1] = src[i * 3 + 1]; a[k * 3 + 2] = src[i * 3 + 2];
      k++;
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }
  /** emit with a colour kept per slot (use this, not emit, so compaction keeps the right tint) */
  put(col: string): void {
    const i = this.cur;
    this.emit(col);
    _col.set(col);
    this.colSrc[i * 3] = _col.r; this.colSrc[i * 3 + 1] = _col.g; this.colSrc[i * 3 + 2] = _col.b;
  }
  get count(): number { return this.live; }
}

/** smoothed body-local motion of a rig from its rendered position (H units per second) */
class Motion {
  init = false; lx = 0.5; lz = 0.5; lh = 0.5;
  vF = 0.5; vS = 0.5; om = 0.5; dist = 0.5; acc = 0.5;
  reset(): void { this.init = false; this.vF = 0; this.vS = 0; this.om = 0; this.dist = 0; this.acc = 0; }
  step(F: GateFrame): void {
    const dt = Math.max(1e-4, F.dt), H = Math.max(0.1, F.H);
    if (!this.init) { this.lx = F.x; this.lz = F.z; this.lh = F.h; this.init = true; }
    let dx = F.x - this.lx, dz = F.z - this.lz, dh = wrapAngle(F.h - this.lh);
    if (dx * dx + dz * dz > (40 * H) * (40 * H)) { dx = 0; dz = 0; dh = 0; }   // respawn / teleport (cut-off re-entry)
    this.lx = F.x; this.lz = F.z; this.lh = F.h;
    const c = Math.cos(F.h), s = Math.sin(F.h);
    // body-local: +Z forward = (sin h, cos h) in world XZ; +X = (cos h, −sin h)
    const f = (dx * s + dz * c) / (dt * H), sd = (dx * c - dz * s) / (dt * H);
    const k = Math.min(1, dt * 8);
    const vPrev = this.vF;
    this.vF += (f - this.vF) * k;
    this.vS += (sd - this.vS) * k;
    this.om += (clamp(dh / dt, -4, 4) - this.om) * k;
    this.acc += ((this.vF - vPrev) / dt - this.acc) * Math.min(1, dt * 5);
    this.dist += this.vF * dt;
  }
}

// ═══════════════════════════════════════ STENCIL-1 ═══════════════════════════════════════
/** joint anchors (× H, rig-local) */
const S1 = {
  tipX: -0.95,                               // TIPPED OVER: rolls about the left (−X) wheel edge
  axle: [0, 0.35, -0.35] as const,           // body pitch pivot (rear axle)
  wheelR: 0.35, wheelW: 0.3, wheelX: 0.8, wheelZ: -0.35,
  frontR: 0.3, frontZ: 1.25,
  beacon: [0, 1.46, 0.98] as const,
  boom: [0.6, 1.32, 0.32] as const, boomA: 0.8, boomB: 0.62,
  cradle: [0, 0.86, -0.72] as const,         // drum cradle hinge (front edge of the drum bed)
  drumC: [0, 0.52, -0.3] as const,           // drum centre in cradle space
  drumR: 0.5, drumH: 0.92,
  mast: [0, 1.95, -0.45] as const,           // refill funnel arm pivot (top of the rear mast)
  rack: [-0.84, 1.18, 0.22] as const,        // bucket flinger pivot (left flank)
} as const;

function s1Wheel(f: Facet, r: number, wdt: number): void {
  f.cyl(r, r, wdt, 14, C.tire, M(0, 0, 0, 0, 0, PI / 2));
  // tread blocks: alternating across the width so the spin reads
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * PI * 2;
    const side = i & 1 ? 1 : -1;
    f.box(wdt * 0.46, r * 0.14, r * 0.26, C.ink, M(side * wdt * 0.22, Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, a, 0, 0));
  }
  f.cyl(r * 0.55, r * 0.55, wdt * 1.06, 8, C.steel, M(0, 0, 0, 0, 0, PI / 2));
  f.cyl(r * 0.32, r * 0.24, wdt * 1.16, 6, C.yellow, M(0, 0, 0, 0, 0, PI / 2));
  f.mirrorX(() => { for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; f.box(0.02, r * 0.1, r * 0.1, C.ink, M(wdt * 0.59, Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42)); } });
}

function s1Chassis(f: Facet): void {
  // undercarriage + axle beam
  f.box(1.24, 0.2, 2.5, C.dark, M(0, 0.42, -0.12), { ch: 0.06 });
  f.box(1.7, 0.1, 0.1, C.steelD, M(0, 0.35, -0.35));
  // main body shell: cream, chamfered, a little taper to the roof
  f.box(1.5, 0.8, 1.32, C.cream, M(0, 0.92, 0.06), { ch: 0.13, tw: 0.93, td: 0.94, top: C.creamD });
  // safety-yellow band all round + a thin ink pinstripe under it
  f.box(1.55, 0.14, 1.37, C.yellow, M(0, 0.7, 0.06), { ch: 0.14 });
  f.box(1.53, 0.03, 1.35, C.ink, M(0, 0.615, 0.06), { ch: 0.14 });
  // road-marking dashes along both flanks (the unit's trade)
  f.mirrorX(() => { for (let i = 0; i < 3; i++) f.box(0.03, 0.07, 0.22, C.paint, M(0.765, 1.02, -0.36 + i * 0.36)); });
  // rear drum bed + hazard tail plate
  f.box(1.32, 0.14, 1.02, C.dark, M(0, 0.79, -1.1), { ch: 0.05 });
  f.box(1.3, 0.26, 0.06, C.dark, M(0, 0.6, -1.6));
  f.hazard(-0.62, 0.62, 0.49, 0.71, 0.03, 8, C.yellow, C.ink, M(0, 0, -1.63, 0, PI, 0));
  // rear lamps
  f.mirrorX(() => f.box(0.12, 0.08, 0.04, C.red, M(0.56, 0.78, -1.64), { glow: 0.5 }));
  // wheel arches (yellow mudguards over the rear wheels)
  f.mirrorX(() => {
    f.box(0.36, 0.08, 0.84, C.yellow, M(0.8, 0.8, -0.35), { ch: 0.04 });
    f.box(0.36, 0.2, 0.06, C.yellowD, M(0.8, 0.7, -0.77));
  });
  // refill mast at the back of the roof (the funnel arm pivots at its top)
  f.box(0.12, 0.7, 0.12, C.steelD, M(0, 1.62, -0.45));
  f.box(0.2, 0.06, 0.2, C.dark, M(0, 1.3, -0.45));
  f.box(0.08, 0.5, 0.05, C.yellow, M(0.09, 1.62, -0.45, 0, 0, 0.0));
  // roof: a hatch, handrails, the boom turret plinth on the right
  f.box(0.5, 0.05, 0.4, C.creamD, M(-0.25, 1.33, 0.18));
  f.mirrorX(() => f.beam(0.66, 1.34, -0.4, 0.66, 1.34, 0.45, 0.04, 0.04, C.steel));
  f.cyl(0.14, 0.16, 0.08, 8, C.dark, M(S1.boom[0], S1.boom[1] - 0.04, S1.boom[2]));
  // spare-bucket rack on the left flank (−X): a frame with two white buckets with yellow lids
  f.box(0.08, 0.32, 0.62, C.dark, M(-0.8, 1.0, -0.28));
  for (let i = 0; i < 2; i++) {
    f.cyl(0.1, 0.085, 0.18, 8, C.paint, M(-0.9, 1.0, -0.46 + i * 0.28));
    f.cyl(0.105, 0.105, 0.03, 8, C.yellow, M(-0.9, 1.1, -0.46 + i * 0.28));
  }
  // ladder on the right rear corner
  f.beam(0.72, 0.5, -0.62, 0.72, 1.3, -0.62, 0.03, 0.03, C.steel);
  f.beam(0.72, 0.5, -0.5, 0.72, 1.3, -0.5, 0.03, 0.03, C.steel);
  for (let i = 0; i < 4; i++) f.box(0.03, 0.025, 0.14, C.steel, M(0.72, 0.62 + i * 0.2, -0.56));
  // front caster fork (the front wheel spins inside it)
  f.box(0.3, 0.12, 0.24, C.dark, M(0, 0.66, S1.frontZ));
  f.mirrorX(() => f.box(0.05, 0.36, 0.1, C.dark, M(0.15, 0.44, S1.frontZ)));
}

function s1Cab(f: Facet): void {
  f.box(1.26, 0.48, 0.66, C.cream, M(0, 0.73, 1.03), { ch: 0.13, td: 0.9 });
  // the bubble: an octagonal dome with a wrap-round glass band
  const ring = (y: number, rx: number, rz: number, oz: number) => ({ y, pts: ngon(8, rx, rz, PI / 8, 0, oz) });
  f.loft([ring(0.96, 0.6, 0.34, 1.02), ring(1.08, 0.61, 0.36, 1.04), ring(1.28, 0.54, 0.32, 1.03), ring(1.4, 0.36, 0.22, 1.0), ring(1.46, 0.12, 0.08, 0.99)],
    { side: [C.cream, C.glass, C.creamD, C.cream], top: C.cream, bottom: null });
  // glass glint
  f.box(0.2, 0.08, 0.02, C.lamp, M(-0.22, 1.2, 1.36, 0, 0, 0.3), { glow: 0.35 });
  // two round headlamp EYES with an ink rim and a heavy brow (the cart's face)
  f.mirrorX(() => {
    f.cyl(0.15, 0.15, 0.08, 12, C.ink, M(0.33, 0.8, 1.35, PI / 2, 0, 0));
    f.cyl(0.11, 0.11, 0.06, 12, C.lamp, M(0.33, 0.8, 1.4, PI / 2, 0, 0), { glow: 1 });
    f.cyl(0.045, 0.045, 0.03, 8, C.white, M(0.3, 0.83, 1.44, PI / 2, 0, 0), { glow: 1 });
    f.box(0.32, 0.06, 0.12, C.yellow, M(0.33, 0.97, 1.33, 0, 0, -0.12));
  });
  // grille, bumper with hazard chevrons, number plate
  f.box(0.46, 0.2, 0.04, C.dark, M(0, 0.62, 1.37));
  for (let i = 0; i < 4; i++) f.box(0.4, 0.02, 0.02, C.steel, M(0, 0.55 + i * 0.045, 1.395));
  f.box(1.36, 0.16, 0.12, C.ink, M(0, 0.47, 1.4));
  f.hazard(-0.66, 0.66, 0.4, 0.54, 0.03, 9, C.yellow, C.ink, M(0, 0, 1.46));
  f.box(0.3, 0.08, 0.02, C.white, M(0, 0.47, 1.5));
}

function s1Beacon(f: Facet): void {
  // an amber dome in a wire cage on a dark base; the inner reflector (a dark vane) spins with the joint
  f.cyl(0.13, 0.14, 0.05, 8, C.dark, M(0, 0.025, 0));
  f.loft([
    { y: 0.05, pts: ngon(8, 0.1, 0.1) }, { y: 0.16, pts: ngon(8, 0.1, 0.1) }, { y: 0.22, pts: ngon(8, 0.06, 0.06) }, { y: 0.24, pts: ngon(8, 0.02, 0.02) },
  ], { side: [C.orange, '#ffb13b', '#ffc75a'], top: '#ffc75a', bottom: null, glow: 1 });
  for (let k = 0; k < 4; k++) { const a = (k / 4) * PI * 2 + PI / 8; f.beam(Math.sin(a) * 0.115, 0.05, Math.cos(a) * 0.115, Math.sin(a) * 0.07, 0.22, Math.cos(a) * 0.07, 0.015, 0.015, C.ink); }
  f.box(0.012, 0.1, 0.16, C.ink, M(0, 0.12, 0));
}

function s1BoomA(f: Facet): void {
  f.cyl(0.08, 0.08, 0.14, 8, C.dark, M(0, 0, 0, 0, 0, PI / 2));
  f.beam(0, 0, 0, 0, 0, S1.boomA, 0.16, 0.14, C.yellow, { ch: 0.025 });
  f.hazard(-0.06, 0.06, 0.08, 0.62, 0.02, 5, C.yellow, C.ink, M(0.082, 0, 0, 0, PI / 2, PI / 2));
  // hydraulic ram under the arm
  f.beam(0, -0.08, 0.05, 0, -0.07, S1.boomA * 0.7, 0.05, 0.05, C.steel);
  f.cyl(0.07, 0.07, 0.1, 8, C.dark, M(0, 0, S1.boomA, 0, 0, PI / 2));
}
function s1BoomB(f: Facet): void {
  f.beam(0, 0, 0, 0, 0, S1.boomB, 0.1, 0.1, C.cream);
  f.box(0.13, 0.1, 0.14, C.dark, M(0, -0.02, S1.boomB));
  f.cyl(0.055, 0.025, 0.12, 6, C.steel, M(0, -0.12, S1.boomB));
  f.box(0.04, 0.07, 0.04, C.paint, M(0, -0.21, S1.boomB), { glow: 0.3 });
  // the paint line to the nozzle
  f.beam(0.05, 0.04, 0, 0.05, 0.02, S1.boomB, 0.025, 0.025, C.ink);
}

function s1Drum(f: Facet): void {
  const [cx, cy, cz] = S1.drumC;
  // tilting cradle: base plate + yellow side cheeks with pivot bosses
  f.box(1.08, 0.06, 0.96, C.dark, M(0, 0.0, cz));
  f.mirrorX(() => {
    f.box(0.07, 0.34, 0.9, C.yellow, M(0.57, 0.14, cz), { ch: 0.02 });
    f.cyl(0.08, 0.08, 0.1, 8, C.steelD, M(0.6, 0.05, 0.05, 0, 0, PI / 2));
  });
  // the drum: white body, steel hoops, yellow band, dark rim
  f.cyl(S1.drumR, S1.drumR, S1.drumH, 14, C.paint, M(cx, cy, cz), { top: C.paintD, bottom: C.dark });
  f.cyl(S1.drumR + 0.02, S1.drumR + 0.02, 0.05, 14, C.steel, M(cx, cy - 0.3, cz));
  f.cyl(S1.drumR + 0.015, S1.drumR + 0.015, 0.17, 14, C.yellow, M(cx, cy + 0.13, cz));
  f.cyl(S1.drumR + 0.025, S1.drumR + 0.025, 0.05, 14, C.dark, M(cx, cy + S1.drumH / 2 - 0.02, cz));
  // a painted chevron stencil on the flank facing the titan when the cart turns tail (the weak point reads)
  f.group(M(cx, cy - 0.08, cz - S1.drumR - 0.005, 0, PI, 0), () => {
    f.box(0.3, 0.07, 0.02, C.ink, M(-0.08, 0.06, 0, 0, 0, -0.6));
    f.box(0.3, 0.07, 0.02, C.ink, M(0.08, 0.06, 0, 0, 0, 0.6));
  });
  // the wet paint surface under the lid (glows faintly while open)
  f.cyl(S1.drumR - 0.07, S1.drumR - 0.07, 0.03, 14, C.paint, M(cx, cy + S1.drumH / 2 + 0.012, cz), { glow: 0.55 });
  // outlet spout at the back (where TIPPED OVER glugs)
  f.cyl(0.07, 0.08, 0.14, 8, C.steelD, M(cx, cy - 0.28, cz - S1.drumR - 0.05, PI / 2, 0, 0));
}
function s1Lid(f: Facet): void {
  // authored from its hinge (the drum's rear rim), extending +Z over the mouth
  f.cyl(S1.drumR + 0.03, S1.drumR + 0.03, 0.06, 14, C.cream, M(0, 0.03, S1.drumR), { top: C.creamD });
  f.box(0.34, 0.05, 0.06, C.dark, M(0, 0.09, S1.drumR));
  f.box(0.24, 0.05, 0.08, C.dark, M(0, 0.03, 0.02));
  f.cyl(0.08, 0.08, 0.02, 8, C.yellow, M(0, 0.07, S1.drumR + 0.28));
}
function s1Funnel(f: Facet): void {
  // arm along −Z from the mast top; a yellow funnel pointing down at its tip; a hose
  f.cyl(0.07, 0.07, 0.12, 8, C.dark, M(0, 0, 0, 0, 0, PI / 2));
  f.beam(0, 0, 0, 0, 0, -0.52, 0.07, 0.07, C.steel);
  f.cyl(0.16, 0.05, 0.18, 8, C.yellow, M(0, -0.1, -0.54), { bottom: C.dark });
  f.cyl(0.035, 0.035, 0.14, 6, C.steelD, M(0, -0.24, -0.54));
  f.beam(0.04, 0.05, 0.02, 0.04, 0.02, -0.5, 0.03, 0.03, C.ink);
}
function s1Rack(f: Facet): void {
  // flinger arm along +Y from its pivot, a cup, and the loaded bucket
  f.cyl(0.06, 0.06, 0.12, 8, C.dark, M(0, 0, 0, 0, 0, PI / 2));
  f.beam(0, 0, 0, 0, 0.46, 0, 0.06, 0.06, C.yellow);
  f.box(0.2, 0.05, 0.2, C.dark, M(0, 0.48, 0));
  f.cyl(0.1, 0.085, 0.18, 8, C.paint, M(0, 0.6, 0));
  f.cyl(0.105, 0.105, 0.03, 8, C.yellow, M(0, 0.7, 0));
}
function sprayGeo(): THREE.BufferGeometry {
  // two crossed fan quads from the nozzle (apex) down to the ground (y = −1); scaled in y to the nozzle height
  const pos = [
    -0.03, 0, 0, -0.11, -1, 0, 0.11, -1, 0, -0.03, 0, 0, 0.11, -1, 0, 0.03, 0, 0,
    0, 0, -0.03, 0, -1, -0.11, 0, -1, 0.11, 0, 0, -0.03, 0, -1, 0.11, 0, 0, 0.03,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g;
}

export interface StencilParts {
  tip: THREE.Group; tipOff: THREE.Group; body: THREE.Group; bodyOff: THREE.Group;
  wheelL: THREE.Mesh; wheelR: THREE.Mesh; wheelF: THREE.Mesh;
  beacon: THREE.Object3D; boomYaw: THREE.Group; boomLift: THREE.Group; elbow: THREE.Group; nozzle: THREE.Group;
  spray: THREE.Mesh; sprayMat: THREE.MeshBasicMaterial;
  cradle: THREE.Group; lid: THREE.Group; lidMesh: THREE.Mesh; funnel: THREE.Group; rack: THREE.Group;
  mouth: THREE.Object3D; spout: THREE.Object3D;
  blobs: BlobPool;
}

function buildStencil(glowMul: number): GateRig {
  const root = new THREE.Group(); root.name = 'boss:stencil1';
  const groups: Record<string, FlashGroup> = {
    body: grp(glowMul), cab: grp(glowMul), boom: grp(glowMul), drum: grp(glowMul),
    wheelL: grp(glowMul), wheelR: grp(glowMul), wheelF: grp(glowMul), beacon: grp(glowMul), fx: grp(glowMul),
  };
  const meshes: THREE.Mesh[] = [];
  const add = <T extends THREE.Mesh>(parent: THREE.Object3D, m: T): T => { parent.add(m); meshes.push(m); return m; };
  // TIPPED OVER pivot (the left wheel edge) → offset back; body pitch pivot (rear axle) → offset back
  const tip = joint(root, 's1:tip', S1.tipX, 0, 0);
  const tipOff = joint(tip, 's1:tipOff', -S1.tipX, 0, 0);
  const body = joint(tipOff, 's1:body', S1.axle[0], S1.axle[1], S1.axle[2]);
  const bodyOff = joint(body, 's1:bodyOff', -S1.axle[0], -S1.axle[1], -S1.axle[2]);
  add(bodyOff, mesh(bld(s1Chassis), groups.body.mat, 's1:chassis'));
  add(bodyOff, mesh(bld(s1Cab, 0.025), groups.cab.mat, 's1:cab'));
  const beacon = joint(bodyOff, 's1:beacon', S1.beacon[0], S1.beacon[1], S1.beacon[2]);
  add(beacon, mesh(bld(s1Beacon, 0.02), groups.beacon.mat, 's1:beaconM', false));
  // boom chain (right flank)
  const boomYaw = joint(bodyOff, 's1:boomYaw', S1.boom[0], S1.boom[1], S1.boom[2]);
  const boomLift = joint(boomYaw, 's1:boomLift');
  add(boomLift, mesh(bld(s1BoomA, 0.02), groups.boom.mat, 's1:boomA'));
  const elbow = joint(boomLift, 's1:elbow', 0, 0, S1.boomA);
  add(elbow, mesh(bld(s1BoomB, 0.02), groups.boom.mat, 's1:boomB'));
  const nozzle = joint(elbow, 's1:nozzle', 0, -0.22, S1.boomB);
  const sprayMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const spray = new THREE.Mesh(sprayGeo(), sprayMat);
  spray.name = 's1:spray'; spray.frustumCulled = false; spray.visible = false; spray.renderOrder = 3;
  nozzle.add(spray);
  // drum on its cradle, the lid on its hinge, the outlet
  const cradle = joint(bodyOff, 's1:cradle', S1.cradle[0], S1.cradle[1], S1.cradle[2]);
  add(cradle, mesh(bld(s1Drum, 0.02), groups.drum.mat, 's1:drum'));
  const lid = joint(cradle, 's1:lid', S1.drumC[0], S1.drumC[1] + S1.drumH / 2 + 0.01, S1.drumC[2] - S1.drumR);
  const lidMesh = add(lid, mesh(bld(s1Lid, 0.02), groups.drum.mat, 's1:lidM'));
  const mouth = joint(cradle, 's1:mouth', S1.drumC[0], S1.drumC[1] + S1.drumH / 2, S1.drumC[2]);
  const spout = joint(cradle, 's1:spout', S1.drumC[0], S1.drumC[1] - 0.28, S1.drumC[2] - S1.drumR - 0.14);
  const funnel = joint(bodyOff, 's1:funnel', S1.mast[0], S1.mast[1], S1.mast[2]);
  add(funnel, mesh(bld(s1Funnel, 0.02), groups.drum.mat, 's1:funnelM'));
  const rack = joint(bodyOff, 's1:rack', S1.rack[0], S1.rack[1], S1.rack[2]);
  add(rack, mesh(bld(s1Rack, 0.02), groups.body.mat, 's1:rackM'));
  // wheels (on the tipping frame, not the pitching body)
  const rearGeo = bld((f) => s1Wheel(f, S1.wheelR, S1.wheelW), 0.02);
  const wheelL = add(tipOff, mesh(rearGeo, groups.wheelL.mat, 's1:wheelL'));
  wheelL.position.set(-S1.wheelX, S1.wheelR, S1.wheelZ);
  const wheelR = add(tipOff, mesh(rearGeo, groups.wheelR.mat, 's1:wheelR'));
  wheelR.position.set(S1.wheelX, S1.wheelR, S1.wheelZ);
  const wheelF = add(tipOff, mesh(bld((f) => s1Wheel(f, S1.frontR, 0.2), 0.02), groups.wheelF.mat, 's1:wheelF'));
  wheelF.position.set(0, S1.frontR, S1.frontZ);
  // world-space paint / dust blobs
  const blobs = new BlobPool(groups.fx.mat, 's1:blobs');
  meshes.push(blobs.mesh);

  const parts: StencilParts = {
    tip, tipOff, body, bodyOff, wheelL, wheelR, wheelF, beacon, boomYaw, boomLift, elbow, nozzle, spray, sprayMat,
    cradle, lid, lidMesh, funnel, rack, mouth, spout, blobs,
  };
  const rig: GateRig = {
    id: 'stencil1', gate: 'stencil1', root, body, bodyY: 0, legs: [], groups, groupKeys: Object.keys(groups),
    joints: { tip, body, beacon, boomYaw, boomLift, elbow, nozzle, cradle, lid, funnel, rack }, meshes,
    stride: 1, duty: 0.5, liftH: 0, rMean: 1, walkSpeed: 1, footYawOut: false,
    fx: [blobs.mesh], poser: null as unknown as GatePoser,
  };
  rig.poser = new StencilPoser(rig, parts);
  return rig;
}

/**
 * STENCIL-1 procedural animation. Reads b.attack / attackT / staggerT / alive / data.raceT / data.drumOpen,
 * the live paint tells and the lobbed paintCans; smooths every channel so a sim beat never pops.
 */
class StencilPoser implements GatePoser {
  private r: GateRig; private p: StencilParts;
  private mo = new Motion();
  private deadT = -1;
  private wheelA = 0.5; private frontA = 0.5; private airSpin = 0.5;
  private pitch = 0.5; private roll = 0.5; private yawW = 0.5; private dy = 0.5; private skidT = -1; private skidSide = 1;
  private tipA = 0.5; private tipV = 0.5; private wasStag = false; private stagT = 0.5;
  private lidA = 0.5; private cradleA = 0.5; private funnelA = 0.5; private refillK = 0.5;
  private bYaw = 0.5; private bLift = 0.5; private bElbow = 0.5; private sprayK = 0.5;
  private rackA = 0.5; private flingT = -1; private flingQ = 0; private lastCanId = -1;
  private wasRace = false; private dripT = 0.5; private glugT = 0.5; private geyserT = 0.5; private phaseT = 0.5;
  private beaconA = 0.5;

  constructor(r: GateRig, p: StencilParts) { this.r = r; this.p = p; this.reset(); }

  reset(): void {
    this.mo.reset();
    this.deadT = -1; this.wheelA = 0; this.frontA = 0; this.airSpin = 0;
    this.pitch = 0; this.roll = 0; this.yawW = 0; this.dy = 0; this.skidT = -1; this.skidSide = 1;
    this.tipA = 0; this.tipV = 0; this.wasStag = false; this.stagT = 0;
    this.lidA = 0; this.cradleA = 0; this.funnelA = 1.3; this.refillK = 0;
    this.bYaw = PI - 0.12; this.bLift = 0.15; this.bElbow = 1.9; this.sprayK = 0;
    this.rackA = -0.45; this.flingT = -1; this.flingQ = 0; this.lastCanId = -1;
    this.wasRace = false; this.dripT = 0; this.glugT = 0; this.geyserT = 0; this.phaseT = 0; this.beaconA = 0;
    const p = this.p;
    p.lid.visible = true; p.lid.position.set(S1.drumC[0], S1.drumC[1] + S1.drumH / 2 + 0.01, S1.drumC[2] - S1.drumR);
    p.lid.rotation.set(0, 0, 0);
    p.spray.visible = false;
    p.blobs.clear();
  }
  hideFx(): void { this.p.blobs.clear(); this.p.spray.visible = false; }
  phase(): void { this.phaseT = 1.2; }

  update(w: World, b: BossState, F: GateFrame): void {
    const p = this.p, r = this.r, d = b.data;
    const dt = F.dt, H = F.H, time = F.time;
    if (b.alive) this.deadT = -1; else this.deadT = this.deadT < 0 ? 0 : this.deadT + dt;
    const dead = this.deadT >= 0;
    this.mo.step(F);
    const vF = this.mo.vF;
    this.phaseT = Math.max(0, this.phaseT - dt);

    // ── state ──
    const stag = b.alive && b.staggerT > 0;
    const race = (d.raceT ?? 0) > 0;
    const refill = b.alive && !stag && (b.attack === 'refill' || (d.drumOpen ?? 0) > 0);
    const stripe = b.alive && !race && !stag && (b.attack === 'stripeRun' || b.attack === 'uTurn');
    const dline = b.alive && !stag && b.attack === 'doubleLine';
    const painting = (stripe || dline) && liveWindup(w, b.attack === 'doubleLine' ? 'doubleLine' : '') >= 0;
    if (stag && !this.wasStag) { this.stagT = 0; this.tipV = 2.6; }
    this.wasStag = stag;
    if (stag) this.stagT += dt;
    if (this.wasRace && !race && b.alive) { this.skidT = 0; this.skidSide = Math.random() < 0.5 ? -1 : 1; }
    this.wasRace = race;
    if (this.skidT >= 0) { this.skidT += dt; if (this.skidT > 0.9) this.skidT = -1; }

    // lobbed paintCans → one flinger throw each (queued so a volley reads as a rhythm)
    for (let i = 0; i < w.projectiles.length; i++) {
      const pr = w.projectiles[i];
      if (!pr.alive || pr.kind !== 'paintCan' || pr.id <= this.lastCanId) continue;
      this.lastCanId = pr.id; this.flingQ = Math.min(6, this.flingQ + 1);
    }
    if (this.flingT < 0 && this.flingQ > 0) { this.flingT = 0; this.flingQ--; }
    if (this.flingT >= 0) { this.flingT += dt; if (this.flingT > 0.2) this.flingT = -1; }

    // ── wheels ──
    const tipped = this.tipA > 0.3;
    if (tipped || dead) this.airSpin = Math.max(this.airSpin, stag ? 7 : 0) * Math.exp(-dt * (stag ? 0.25 : 1.2));
    else this.airSpin = 0;
    const roll = (vF + (race ? 0 : 0)) * dt;
    this.wheelA += roll / S1.wheelR + this.airSpin * dt;
    this.frontA += roll / S1.frontR + this.airSpin * 1.2 * dt;
    if (stripe && liveWindup(w, '') >= 0) this.wheelA += dt * 6 * (0.6 + 0.4 * Math.sin(time * 9));   // revving in place
    p.wheelL.rotation.set(this.wheelA, 0, 0);
    p.wheelR.rotation.set(this.wheelA, 0, 0);
    p.wheelF.rotation.set(this.frontA, 0, 0);

    // ── body pitch / roll / skid ──
    let pitchT = clamp(-this.mo.acc * 0.012, -0.08, 0.08);
    if (race) pitchT = 0.1;
    else if (stripe) pitchT = -0.06 + 0.012 * Math.sin(time * 38);
    let yawT = 0, dyT = 0, rollT = clamp(this.mo.om * 0.05, -0.08, 0.08);
    if (this.skidT >= 0) {
      const s = this.skidT;
      pitchT = 0.16 * bump(s, 0, 0.35) - 0.05 * bump(s, 0.3, 0.7);
      yawT = this.skidSide * 0.22 * Math.exp(-s * 4) * Math.cos(s * 16);
      rollT += this.skidSide * 0.06 * bump(s, 0, 0.4);
      if (s < 0.45) this.dust(F, 2);
    }
    if (refill) { pitchT += 0.03; dyT = -0.03; }
    if (this.phaseT > 0) { dyT += 0.05 * bump(1.2 - this.phaseT, 0, 0.5); rollT += 0.05 * Math.sin(time * 20) * this.phaseT; }
    if (dead) { pitchT = 0.06; dyT = -0.16 * smoothstep(0.3, 1.4, this.deadT); rollT = 0; yawT = 0; }
    const k = kExp(dt, race || this.skidT >= 0 ? 16 : 7);
    this.pitch += (pitchT - this.pitch) * k; this.roll += (rollT - this.roll) * k;
    this.yawW += (yawT - this.yawW) * kExp(dt, 20); this.dy += (dyT - this.dy) * k;
    p.body.position.set(S1.axle[0], S1.axle[1] + this.dy, S1.axle[2]);
    p.body.rotation.set(this.pitch, this.yawW, this.roll, 'YXZ');

    // ── TIPPED OVER: a sprung roll onto the left side (and back up when it ends) ──
    const tipT = stag ? PI / 2 - 0.06 : 0;
    const stiff = stag ? 38 : 30, damp = stag ? 7 : 9;
    this.tipV += ((tipT - this.tipA) * stiff - this.tipV * damp) * dt;
    this.tipA += this.tipV * dt;
    if (this.tipA > PI / 2 + 0.05) { this.tipA = PI / 2 + 0.05; this.tipV = -Math.abs(this.tipV) * 0.35; }   // lands with a bounce
    if (this.tipA < 0) { this.tipA = 0; this.tipV = Math.abs(this.tipV) * 0.2; }
    p.tip.rotation.set(0, 0, this.tipA);
    // defeat: the wheels splay as the cart settles flat
    const splay = dead ? 0.35 * smoothstep(0.4, 1.3, this.deadT) : 0;
    p.wheelL.rotation.z = splay; p.wheelR.rotation.z = -splay;
    p.wheelL.position.y = S1.wheelR - splay * 0.25; p.wheelR.position.y = S1.wheelR - splay * 0.25;

    // ── REFILL: lid up, cradle back 15°, funnel down into the drum, drum glows ──
    const openT = refill || stag ? 1 : 0;
    this.refillK += (openT - this.refillK) * kExp(dt, openT > this.refillK ? 6 : 4);
    const lidT = refill ? -1.95 : stag ? -1.2 + 0.25 * Math.sin(time * 9) : 0;
    this.lidA += (lidT - this.lidA) * kExp(dt, 8);
    const cradleT = refill ? -0.26 : 0;       // tilt back (the rear drops): −X rotation lifts the front edge
    this.cradleA += (cradleT - this.cradleA) * kExp(dt, 5);
    const funnelT = refill ? -0.38 : 1.3;
    this.funnelA += (funnelT - this.funnelA) * kExp(dt, refill ? 5 : 7);
    p.cradle.rotation.set(this.cradleA, 0, 0);
    p.funnel.rotation.set(this.funnelA, 0, 0);
    if (!dead) { p.lid.rotation.set(this.lidA, 0, 0); p.lid.visible = true; }

    // ── BOOM: stowed back along the flank; painting a lane → forward + low, sweeping the spray ribbon ──
    let yT = PI - 0.12, lT = 0.15, eT = 1.9, sprayT = 0;
    if (painting) {
      const sweep = dline ? 0.55 * Math.sin(time * 4.2) : 0.35 * Math.sin(time * 6.5);
      yT = 0.32 + sweep; lT = -0.12; eT = 1.05; sprayT = 1;
    } else if (race) { yT = PI * 0.72; lT = 0.05; eT = 1.45; sprayT = 1; }
    else if (refill) { yT = PI - 0.4; lT = -0.25; eT = 2.2; }
    if (stag || dead) { yT = this.bYaw; lT = -0.35; eT = 0.4; sprayT = 0; }
    const kb = kExp(dt, painting ? 9 : 6);
    this.bYaw += (yT - this.bYaw) * kb; this.bLift += (lT - this.bLift) * kb; this.bElbow += (eT - this.bElbow) * kb;
    p.boomYaw.rotation.set(0, this.bYaw, 0);
    p.boomLift.rotation.set(this.bLift, 0, 0);
    p.elbow.rotation.set(this.bElbow, 0, 0);
    // the nozzle always points straight down (undo the chain's pitch)
    p.nozzle.rotation.set(-(this.pitch + this.bLift + this.bElbow), 0, 0);
    this.sprayK += (sprayT - this.sprayK) * kExp(dt, 12);
    if (this.sprayK > 0.04 && !F.frozen) {
      p.nozzle.updateWorldMatrix(true, false);
      p.nozzle.getWorldPosition(_v0);
      const hLocal = Math.max(0.05, _v0.y / Math.max(0.1, H));
      p.spray.visible = true;
      const flick = 0.9 + 0.1 * Math.sin(time * 53);
      p.spray.scale.set(this.sprayK * flick, hLocal, this.sprayK * flick);
      p.sprayMat.opacity = 0.8 * this.sprayK;
      this.dripT -= dt;
      if (this.dripT <= 0) { this.dripT = 0.07; this.drop(_v0, H, C.paint, 0.08); }
    } else if (F.frozen && this.sprayK > 0.04) {
      p.spray.visible = true;
    } else p.spray.visible = false;

    // ── bucket flinger ──
    let rackT = -0.45;
    if (this.flingT >= 0) rackT = this.flingT < 0.06 ? -0.95 : 1.05;
    else if (b.attack === 'paintBuckets') rackT = -0.8;
    this.rackA += (rackT - this.rackA) * kExp(dt, this.flingT >= 0 ? 40 : 10);
    p.rack.rotation.set(this.rackA, 0, 0);

    // ── glow: beacon strobe, headlamps (brighter in a windup), drum under the lid ──
    this.beaconA += dt * (b.alive ? 7 : 0);
    p.beacon.rotation.set(0, this.beaconA, 0);
    const g = r.groups;
    const dim = dead ? Math.max(0, 1 - this.deadT / 1.2) : 1;
    const hot = liveWindup(w, '') >= 0 ? 1 : 0;
    g.beacon.mat.userData.bt.uGlowMul.value = g.beacon.glowBase * (1.2 + 0.6 * (0.5 + 0.5 * Math.sin(this.beaconA * 2))) * dim;
    g.cab.mat.userData.bt.uGlowMul.value = g.cab.glowBase * (0.9 + 0.5 * hot + (stag ? 0.4 * Math.sin(time * 14) : 0)) * dim;
    g.drum.mat.userData.bt.uGlowMul.value = g.drum.glowBase * (0.15 + 1.4 * this.refillK * (0.85 + 0.15 * Math.sin(time * 5))) * (dead ? 1 + 1.5 * dim : 1);
    g.body.mat.userData.bt.uGlowMul.value = g.body.glowBase * dim;

    // ── paint: glugs while tipped, the geyser + lid pop on defeat ──
    if (!F.frozen) {
      if (stag && this.tipA > 1.0) {
        this.glugT -= dt;
        if (this.glugT <= 0) {
          this.glugT = 0.09 + Math.random() * 0.06;
          p.spout.updateWorldMatrix(true, false); p.spout.getWorldPosition(_v0);
          p.mouth.getWorldPosition(_v1);
          const mx = (_v0.x + _v1.x) * 0.5, mz = (_v0.z + _v1.z) * 0.5;
          const E = p.blobs.E;
          E.x = mx; E.y = Math.max(0.05 * H, _v1.y); E.z = mz;
          const a = Math.random() * PI * 2;
          E.vx = Math.cos(a) * H * 0.5; E.vz = Math.sin(a) * H * 0.5; E.vy = H * (0.3 + Math.random() * 0.4);
          E.s = H * (0.14 + Math.random() * 0.1); E.g = 4 * H; E.grow = 0.8; E.life = 0.9;
          p.blobs.put(Math.random() < 0.8 ? C.paint : C.yellow);
        }
      }
      if (dead) this.defeat(F);
      p.blobs.step(dt);
    }
    void w;
  }

  /** a paint drip at a world point (metres) */
  private drop(at: THREE.Vector3, H: number, col: string, s: number): void {
    const E = this.p.blobs.E;
    E.x = at.x; E.y = at.y; E.z = at.z; E.vx = 0; E.vz = 0; E.vy = -H * 0.5;
    E.s = s * H; E.g = 6 * H; E.grow = 0.6; E.life = 0.5;
    this.p.blobs.put(col);
  }
  /** skid dust at both rear wheels */
  private dust(F: GateFrame, n: number): void {
    const H = F.H, c = Math.cos(F.h), s = Math.sin(F.h);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.5) continue;
      const side = i & 1 ? 1 : -1;
      const lx = side * S1.wheelX, lz = S1.wheelZ;
      const E = this.p.blobs.E;
      E.x = F.x + (lx * c + lz * s) * H; E.z = F.z + (-lx * s + lz * c) * H; E.y = 0.1 * H;
      E.vx = (side * c) * H * 0.8 + (Math.random() - 0.5) * H; E.vz = (-side * s) * H * 0.8 + (Math.random() - 0.5) * H; E.vy = H * 0.4;
      E.s = H * 0.2; E.g = 0.3 * H; E.grow = 1.6; E.life = 0.8;
      this.p.blobs.put('#d9d2c3');
    }
  }
  /** defeat: the lid pops off and flies, a white paint geyser from the mouth, then the cart settles flat */
  private defeat(F: GateFrame): void {
    const p = this.p, t = this.deadT, H = F.H;
    // lid: straight up, spinning, then lost
    if (t < 1.4) {
      p.lid.visible = true;
      p.lid.position.set(S1.drumC[0], S1.drumC[1] + S1.drumH / 2 + 0.01 + 3.2 * t - 3.4 * t * t, S1.drumC[2] - S1.drumR + 0.9 * t);
      p.lid.rotation.set(-t * 11, t * 3, 0);
      if (p.lid.position.y < 0.05) p.lid.visible = false;
    } else p.lid.visible = false;
    if (t < 1.5) {
      this.geyserT -= F.dt;
      if (this.geyserT <= 0) {
        this.geyserT = 0.028;
        p.mouth.updateWorldMatrix(true, false); p.mouth.getWorldPosition(_v0);
        const E = p.blobs.E;
        const a = Math.random() * PI * 2, spread = (0.15 + Math.random() * 0.4) * H * (1 - t / 1.5 * 0.5);
        E.x = _v0.x; E.y = _v0.y; E.z = _v0.z;
        E.vx = Math.cos(a) * spread; E.vz = Math.sin(a) * spread; E.vy = H * (3.2 + Math.random() * 1.6) * (1 - t / 1.5 * 0.6);
        E.s = H * (0.2 + Math.random() * 0.16); E.g = 5 * H; E.grow = 0.9; E.life = 1.3;
        p.blobs.put(Math.random() < 0.9 ? C.paint : C.yellow);
      }
    }
  }
}

// ═══════════════════════════════════════ CORDON-2 ═══════════════════════════════════════
const C2 = {
  arcZ: -0.7, arcR: 1.5,
  panelDeg: [-50, -30, -10, 10, 30, 50] as const,
  panelW: 0.5, panelH: 1.96, panelT: 0.1,
  trackX: 0.85, trackZ: -0.3, trackHalf: 0.45, trackEndR: 0.25, trackW: 0.38,
  body: [0, 0.2, -0.1] as const,
  stacks: [0, 1.12, -0.62] as const, stackX: 0.3, stackH: 0.75,
  lampX: 0.56, lampY: 1.12, lampZ: -0.05,
  cleatsPer: 16,
} as const;
const C2_WALL_GROUP = ['wallL', 'wallL', 'wallC', 'wallC', 'wallR', 'wallR'] as const;
const C2_LOOP = 4 * C2.trackHalf + 2 * PI * C2.trackEndR;

function c2Panel(f: Facet): void {
  // authored from its foot (pivot at the bottom centre), the chevron face toward +Z
  const w = C2.panelW, h = C2.panelH, t = C2.panelT;
  // the panel: a steel-grey sheet (its back reads as a barricade too), the chevron face toward +Z
  f.box(w, h, t, C.grey, M(0, 0.03 + h / 2, 0), { ch: 0.02, top: C.yellow });
  f.box(w - 0.02, 1.32, 0.02, C.hzK, M(0, 0.78, t / 2 + 0.005));
  f.hazard(-w / 2 + 0.02, w / 2 - 0.02, 0.16, 1.4, 0.025, 4, C.hzY, C.hzK, M(0, 0, t / 2));
  // back: a yellow top rail and a stencilled number plate
  f.box(w - 0.02, 0.08, 0.03, C.yellow, M(0, 1.9, -t / 2 - 0.01));
  f.box(0.2, 0.14, 0.02, C.white, M(0, 1.2, -t / 2 - 0.015));
  // cream top band with a red reflector strip (glare-bar glow) and two stencil bars
  f.box(w - 0.02, 0.4, 0.03, C.white, M(0, 1.66, t / 2 + 0.015));
  f.box(w - 0.08, 0.05, 0.02, C.red, M(0, 1.8, t / 2 + 0.035), { glow: 0.5 });
  f.box(w - 0.18, 0.05, 0.015, C.ink, M(0, 1.66, t / 2 + 0.035));
  f.box(w - 0.26, 0.04, 0.015, C.ink, M(0, 1.56, t / 2 + 0.035));
  // interlock tabs (the panels lock together on a SHIELD SHOVE)
  f.mirrorX(() => { f.box(0.05, 0.18, 0.07, C.steel, M(w / 2 + 0.01, 0.55, 0)); f.box(0.05, 0.18, 0.07, C.steel, M(w / 2 + 0.01, 1.3, 0)); });
  // back bracing + a foot
  f.beam(-0.18, 0.1, -t / 2 - 0.02, 0.18, 1.6, -t / 2 - 0.02, 0.05, 0.04, C.steel);
  f.beam(0.18, 0.1, -t / 2 - 0.02, -0.18, 1.6, -t / 2 - 0.02, 0.05, 0.04, C.steel);
  f.box(0.34, 0.06, 0.34, C.dark, M(0, 0.03, -0.1));
}
function c2Hull(f: Facet): void {
  // engine house (navy) with a yellow trim band, louvres, a hatch
  f.box(1.22, 0.86, 1.08, C.navy, M(0, 0.52, -0.3), { ch: 0.1, tw: 0.95, td: 0.95, top: C.navyL });
  f.box(1.26, 0.1, 1.12, C.yellow, M(0, 0.2, -0.3), { ch: 0.1 });
  f.mirrorX(() => { for (let i = 0; i < 4; i++) f.box(0.02, 0.05, 0.5, C.navyD, M(0.62, 0.45 + i * 0.1, -0.3)); });
  f.box(0.42, 0.04, 0.34, C.navyD, M(0.25, 0.97, -0.5));
  // sawhorse hopper behind the wall (yellow bin with striped sawhorse rails inside)
  f.box(0.78, 0.26, 0.38, C.yellow, M(0, 1.08, 0.06), { ch: 0.03, top: null });
  f.box(0.7, 0.04, 0.3, C.ink, M(0, 1.2, 0.06));
  for (let i = 0; i < 3; i++) f.hazard(-0.3, 0.3, 1.22, 1.3, 0.04, 5, C.white, C.red, M(0, 0, -0.06 + i * 0.1, -0.5, 0, 0));
  // `LINE CLOSED` sign on two posts (tilted back so the iso camera reads it)
  f.mirrorX(() => f.box(0.05, 0.62, 0.05, C.steel, M(0.42, 1.25, -0.52)));
  f.group(M(0, 1.62, -0.52, -0.42, 0, 0), () => {
    f.box(1.02, 0.28, 0.05, C.ink, M(0, 0, 0));
    f.box(1.06, 0.03, 0.06, C.hzY, M(0, 0.15, 0));
    f.box(1.06, 0.03, 0.06, C.hzY, M(0, -0.15, 0));
  });
  blockText(f, 'LINE CLOSED', 0.02, 0.014, C.hzY, M(0, 1.62, -0.52, -0.42, 0, 0).multiply(M(0, 0, 0.025)), 0.25);
  // front skirt (under the wall)
  f.box(1.1, 0.12, 0.2, C.dark, M(0, 0.12, 0.28));
}
function c2Stacks(f: Facet): void {
  f.box(0.78, 0.08, 0.16, C.dark, M(0, 0.04, 0));
  f.mirrorX(() => {
    f.cyl(0.075, 0.085, C2.stackH, 8, C.steelD, M(C2.stackX, C2.stackH / 2, 0));
    f.cyl(0.08, 0.08, 0.1, 8, C.rust, M(C2.stackX, C2.stackH * 0.72, 0), { glow: 0.35 });
    f.cyl(0.1, 0.09, 0.08, 8, C.orange, M(C2.stackX, C2.stackH + 0.02, 0), { glow: 0.8, top: C.ink });
  });
}
function c2Pack(f: Facet): void {
  const z = -0.95, y0 = 0.6, y1 = 1.58;
  // cage: posts + rings (dark), coils inside (teal glow), a navy cap with a warning plate
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.beam(sx * 0.36, y0, z + sz * 0.28, sx * 0.36, y1, z + sz * 0.28, 0.06, 0.06, C.ink);
  for (const y of [y0 + 0.04, (y0 + y1) / 2, y1 - 0.04]) {
    f.box(0.78, 0.04, 0.04, C.ink, M(0, y, z + 0.28)); f.box(0.78, 0.04, 0.04, C.ink, M(0, y, z - 0.28));
    f.box(0.04, 0.04, 0.6, C.ink, M(0.36, y, z)); f.box(0.04, 0.04, 0.6, C.ink, M(-0.36, y, z));
  }
  for (let i = 0; i < 3; i++) {
    const x = -0.2 + i * 0.2;
    f.cyl(0.085, 0.085, y1 - y0 - 0.2, 8, C.teal, M(x, (y0 + y1) / 2, z), { glow: 0.85 });
    for (let k = 0; k < 4; k++) f.cyl(0.1, 0.1, 0.035, 8, C.tealD, M(x, y0 + 0.22 + k * 0.2, z));
  }
  f.box(0.84, 0.08, 0.66, C.navy, M(0, y1 + 0.04, z), { ch: 0.05 });
  f.box(0.84, 0.1, 0.66, C.navyD, M(0, y0 - 0.02, z), { ch: 0.05 });
  f.hazard(-0.3, 0.3, y0 - 0.06, y0 + 0.02, 0.02, 6, C.hzY, C.hzK, M(0, 0, z - 0.34, 0, PI, 0));
}
function c2Track(f: Facet): void {
  // the track body (a rounded side frame + road wheels + sprockets), authored at the track centre, along Z
  const L = C2.trackHalf, R = C2.trackEndR, W = C2.trackW;
  const prof: number[] = [];
  for (let i = 0; i <= 6; i++) { const a = PI / 2 - (i / 6) * PI; prof.push(R + Math.sin(a) * (R - 0.03), L + Math.cos(a) * (R - 0.03)); }
  for (let i = 0; i <= 6; i++) { const a = -PI / 2 - (i / 6) * PI; prof.push(R + Math.sin(a) * (R - 0.03), -L + Math.cos(a) * (R - 0.03)); }
  f.prismX(prof, -W / 2 + 0.03, W / 2 - 0.03, C.ink, undefined, { top: C.dark, bottom: C.dark });
  f.mirrorX(() => {
    for (let i = 0; i < 4; i++) f.cyl(0.1, 0.1, 0.04, 8, C.steel, M(W / 2, 0.14, -L + (i / 3) * 2 * L, 0, 0, PI / 2));
    f.cyl(0.16, 0.16, 0.05, 8, C.steelD, M(W / 2 - 0.01, R, L, 0, 0, PI / 2));
    f.cyl(0.14, 0.14, 0.05, 8, C.steelD, M(W / 2 - 0.01, R, -L, 0, 0, PI / 2));
  });
  // yellow fender along the top
  f.box(W + 0.06, 0.05, 2 * L + 0.2, C.yellow, M(0, 2 * R + 0.06, 0), { ch: 0.03 });
}
function c2Cleat(f: Facet): void {
  f.box(C2.trackW + 0.02, 0.05, 0.1, C.tire, M(0, 0.025, 0), { top: C.dark });
  f.box(C2.trackW - 0.04, 0.03, 0.03, C.steelD, M(0, 0.065, 0));
}
function c2Lamp(f: Facet): void {
  // an arm from the engine house up over the wall top; a lamp head facing +Z
  f.beam(0, 0, 0, 0, 1.0, 0.34, 0.07, 0.07, C.steelD);
  f.beam(0, 0.5, 0.17, 0, 0.98, 0.1, 0.04, 0.04, C.steel);
  f.box(0.24, 0.18, 0.2, C.dark, M(0, 1.08, 0.42), { ch: 0.03 });
  f.cyl(0.08, 0.08, 0.04, 10, C.lamp, M(0, 1.08, 0.53, PI / 2, 0, 0), { glow: 1 });
  f.box(0.26, 0.04, 0.12, C.yellow, M(0, 1.19, 0.46));
}

export interface CordonParts {
  body: THREE.Group; bodyOff: THREE.Group;
  panels: THREE.InstancedMesh; panelFlash: THREE.InstancedBufferAttribute;
  stacks: THREE.Group; stackTipL: THREE.Object3D; stackTipR: THREE.Object3D;
  lamps: THREE.InstancedMesh; trackL: THREE.Mesh; trackR: THREE.Mesh; cleats: THREE.InstancedMesh;
  blobs: BlobPool;
}

function buildCordon(glowMul: number): GateRig {
  const root = new THREE.Group(); root.name = 'boss:cordon2';
  const groups: Record<string, FlashGroup> = {
    body: grp(glowMul), pack: grp(glowMul), stacks: grp(glowMul), lamps: grp(glowMul),
    trackL: grp(glowMul), trackR: grp(glowMul), treads: grp(glowMul), fx: grp(glowMul),
    wall: grp(glowMul, true), wallL: grp(glowMul), wallC: grp(glowMul), wallR: grp(glowMul),
  };
  const meshes: THREE.Mesh[] = [];
  const add = <T extends THREE.Mesh>(parent: THREE.Object3D, m: T): T => { parent.add(m); meshes.push(m); return m; };
  const body = joint(root, 'c2:body', C2.body[0], C2.body[1], C2.body[2]);
  const bodyOff = joint(body, 'c2:bodyOff', -C2.body[0], -C2.body[1], -C2.body[2]);
  add(bodyOff, mesh(bld(c2Hull), groups.body.mat, 'c2:hull'));
  add(bodyOff, mesh(bld(c2Pack, 0.02), groups.pack.mat, 'c2:pack'));
  const stacks = joint(bodyOff, 'c2:stacks', C2.stacks[0], C2.stacks[1], C2.stacks[2]);
  add(stacks, mesh(bld(c2Stacks, 0.02), groups.stacks.mat, 'c2:stacksM'));
  const stackTipL = joint(stacks, 'c2:tipL', -C2.stackX, C2.stackH + 0.08, 0);
  const stackTipR = joint(stacks, 'c2:tipR', C2.stackX, C2.stackH + 0.08, 0);
  const pGeo = bld(c2Panel, 0.03);
  const panelFlash = flashAttr(pGeo, 6);
  const panels = add(bodyOff, inst(pGeo, groups.wall.mat, 6, 'c2:panels', OUTLINE_W));
  const lamps = add(bodyOff, inst(bld(c2Lamp, 0.02), groups.lamps.mat, 2, 'c2:lamps', OUTLINE_W));
  const tGeo = bld(c2Track, 0.02);
  const trackL = add(root, mesh(tGeo, groups.trackL.mat, 'c2:trackL'));
  trackL.position.set(-C2.trackX, 0, C2.trackZ);
  const trackR = add(root, mesh(tGeo, groups.trackR.mat, 'c2:trackR'));
  trackR.position.set(C2.trackX, 0, C2.trackZ);
  const cleats = add(root, inst(bld(c2Cleat, 0.02), groups.treads.mat, 2 * C2.cleatsPer, 'c2:cleats', 1.6));
  const blobs = new BlobPool(groups.fx.mat, 'c2:smoke');
  meshes.push(blobs.mesh);
  const parts: CordonParts = { body, bodyOff, panels, panelFlash, stacks, stackTipL, stackTipR, lamps, trackL, trackR, cleats, blobs };
  const rig: GateRig = {
    id: 'cordon2', gate: 'cordon2', root, body, bodyY: 0, legs: [], groups, groupKeys: Object.keys(groups),
    joints: { body, stacks }, meshes, stride: 1, duty: 0.5, liftH: 0, rMean: 1, walkSpeed: 1, footYawOut: false,
    fx: [blobs.mesh], poser: null as unknown as GatePoser,
  };
  rig.poser = new CordonPoser(rig, parts);
  return rig;
}

class CordonPoser implements GatePoser {
  private r: GateRig; private p: CordonParts;
  private mo = new Motion();
  private deadT = -1;
  private dL = 0.5; private dR = 0.5;
  private dy = 0.5; private pitch = 0.5; private roll = 0.5;
  private lockK = 0.5; private lurchK = 0.5; private openK = 0.5; private droopK = 0.5; private stackA = 0.5; private heatK = 0.5;
  private lampYaw = 0.5; private puffT = 0.5; private blastT = -1; private wasBackfire = false; private phaseT = 0.5;
  private jit = new Float32Array(6);

  constructor(r: GateRig, p: CordonParts) { this.r = r; this.p = p; for (let i = 0; i < 6; i++) this.jit[i] = Math.sin(i * 12.9898 + 1.3) * 0.5; this.reset(); }
  reset(): void {
    this.mo.reset(); this.deadT = -1; this.dL = 0; this.dR = 0; this.dy = 0; this.pitch = 0; this.roll = 0;
    this.lockK = 0; this.lurchK = 0; this.openK = 0; this.droopK = 0; this.stackA = 0; this.heatK = 0;
    this.lampYaw = 0; this.puffT = 0; this.blastT = -1; this.wasBackfire = false; this.phaseT = 0;
    this.p.blobs.clear();
  }
  hideFx(): void { this.p.blobs.clear(); }
  phase(): void { this.phaseT = 1.2; }

  update(w: World, b: BossState, F: GateFrame): void {
    const p = this.p, r = this.r, d = b.data;
    const dt = F.dt, time = F.time, H = F.H;
    if (b.alive) this.deadT = -1; else this.deadT = this.deadT < 0 ? 0 : this.deadT + dt;
    const dead = this.deadT >= 0;
    this.mo.step(F);
    this.phaseT = Math.max(0, this.phaseT - dt);
    const stag = b.alive && b.staggerT > 0;
    const shove = b.alive && !stag && b.attack === 'shieldShove';
    const lurch = shove && (d.lurchT ?? 0) > 0;
    const shoveWind = shove && !lurch && liveWindup(w, 'shieldShove') >= 0;
    const hot = b.alive && !stag && ((d.overheated ?? 0) > 0 || b.attack === 'overheated');
    const toss = b.alive && !stag && b.attack === 'sawhorseToss';
    const backfire = b.alive && !stag && b.attack === 'backfire';
    const bfWind = backfire && liveWindup(w, 'backfire') >= 0;
    if (this.wasBackfire && !bfWind && backfire) this.blastT = 0;
    this.wasBackfire = bfWind;
    if (this.blastT >= 0) { this.blastT += dt; if (this.blastT > 0.6) this.blastT = -1; }

    // ── treads: differential track speed (turning right → the left track runs faster) ──
    const turn = this.mo.om * C2.trackX;
    const moving = !stag && !dead;
    if (moving) { this.dL += (this.mo.vF + turn) * dt; this.dR += (this.mo.vF - turn) * dt; }
    this.placeCleats();

    // ── body: crouch for the shove, lurch, the stall sag, a phase shudder ──
    let dyT = 0, pitchT = clamp(-this.mo.acc * 0.02, -0.06, 0.06), rollT = clamp(this.mo.om * 0.04, -0.05, 0.05);
    if (shoveWind) { dyT = -0.07; pitchT = -0.06; }
    if (lurch) { dyT = 0.02; pitchT = 0.1; }
    if (stag) { dyT = -0.06; pitchT = 0.04; rollT = 0.03 * Math.sin(time * 1.3); }
    if (hot) rollT += 0.008 * Math.sin(time * 31);
    if (this.phaseT > 0) rollT += 0.04 * Math.sin(time * 24) * this.phaseT;
    if (dead) { dyT = -0.1 * smoothstep(0, 1.5, this.deadT); pitchT = 0.05; rollT = 0; }
    const k = kExp(dt, lurch ? 18 : 7);
    this.dy += (dyT - this.dy) * k; this.pitch += (pitchT - this.pitch) * k; this.roll += (rollT - this.roll) * k;
    p.body.position.set(C2.body[0], C2.body[1] + this.dy, C2.body[2]);
    p.body.rotation.set(this.pitch, 0, this.roll, 'YXZ');

    // ── panels ──
    this.lockK += ((shoveWind || lurch ? 1 : 0) - this.lockK) * kExp(dt, 10);
    this.lurchK += ((lurch ? 1 : 0) - this.lurchK) * kExp(dt, lurch ? 25 : 6);
    this.openK += ((toss ? 1 : 0) - this.openK) * kExp(dt, toss ? 7 : 4);
    this.droopK += ((stag ? 1 : 0) - this.droopK) * kExp(dt, stag ? 3.5 : 5);
    this.placePanels(time);

    // ── stacks: swing back for BACKFIRE, glow + puff when OVERHEATED, blast on fire ──
    const stT = bfWind ? -0.75 : this.blastT >= 0 ? -0.6 + 0.15 * Math.sin(this.blastT * 40) : stag ? 0.25 : 0;
    this.stackA += (stT - this.stackA) * kExp(dt, 8);
    p.stacks.rotation.set(this.stackA + (hot ? 0.03 * Math.sin(time * 27) : 0), 0, 0);
    this.heatK += ((hot || bfWind ? 1 : 0) - this.heatK) * kExp(dt, hot ? 4 : 2);

    // ── lamps: swivel toward the titan (a searchlight sweep), flicker when STALLED ──
    const T = w.titan;
    const toT = wrapAngle(Math.atan2(T.x - F.x, T.z - F.z) - F.h);
    const yawT = dead ? 0 : clamp(toT, -0.7, 0.7) + 0.15 * Math.sin(time * 0.9);
    this.lampYaw += (yawT - this.lampYaw) * kExp(dt, 3);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      _e0.set(stag || dead ? 0.35 : 0, this.lampYaw + side * 0.18, 0, 'YXZ');
      _q0.setFromEuler(_e0);
      p.lamps.setMatrixAt(i, _m0.compose(_p0.set(side * C2.lampX, C2.lampY, C2.lampZ), _q0, _s0.set(1, 1, 1)));
    }
    p.lamps.instanceMatrix.needsUpdate = true;

    // ── glow ──
    const g = r.groups;
    const dim = dead ? Math.max(0, 1 - this.deadT / 1.5) : 1;
    const flick = stag ? (Math.sin(time * 37) * Math.sin(time * 13.3 + 1) > 0.1 ? 1 : 0.1) : 1;
    g.lamps.mat.userData.bt.uGlowMul.value = g.lamps.glowBase * 1.3 * flick * dim;
    g.pack.mat.userData.bt.uGlowMul.value = g.pack.glowBase * (stag ? 0.25 + 0.25 * flick : 0.8 + 1.1 * this.heatK * (0.8 + 0.2 * Math.sin(time * 11))) * dim;
    g.stacks.mat.userData.bt.uGlowMul.value = g.stacks.glowBase * (0.2 + 2.6 * this.heatK * (0.85 + 0.15 * Math.sin(time * 17)) + (this.blastT >= 0 ? 3 * (1 - this.blastT / 0.6) : 0)) * dim;
    g.body.mat.userData.bt.uGlowMul.value = g.body.glowBase * dim;
    g.wall.mat.userData.bt.uGlowMul.value = g.wall.glowBase * dim;

    // ── smoke ──
    if (!F.frozen) {
      this.puffT -= dt;
      const blast = this.blastT >= 0 && this.blastT < 0.25;
      const rate = blast ? 0.02 : hot ? 0.09 : moving && Math.abs(this.mo.vF) > 0.3 ? 0.35 : dead && this.deadT < 2.5 ? 0.12 : -1;
      if (rate > 0 && this.puffT <= 0) {
        this.puffT = rate;
        this.smoke(blast, H, hot);
        this.smoke(blast, H, hot);
      }
      p.blobs.step(dt);
    }
    // flash: the wall groups → the panel instances
    const pf = p.panelFlash.array as Float32Array;
    for (let i = 0; i < 6; i++) pf[i] = Math.min(0.85, g[C2_WALL_GROUP[i]].flash * 0.85);
    p.panelFlash.needsUpdate = true;
  }

  private smoke(blast: boolean, H: number, hot: boolean): void {
    const p = this.p;
    const tip = Math.random() < 0.5 ? p.stackTipL : p.stackTipR;
    tip.updateWorldMatrix(true, false); tip.getWorldPosition(_v0);
    // the stacks' up axis in world space (swung back for a BACKFIRE)
    _v1.set(0, 1, 0).transformDirection(tip.matrixWorld);
    const E = p.blobs.E;
    const sp = blast ? 3.2 : hot ? 1.1 : 0.6;
    E.x = _v0.x; E.y = _v0.y; E.z = _v0.z;
    E.vx = (_v1.x * sp + (Math.random() - 0.5) * 0.3) * H; E.vy = (_v1.y * sp + 0.3) * H; E.vz = (_v1.z * sp + (Math.random() - 0.5) * 0.3) * H;
    E.s = H * (blast ? 0.2 : 0.12); E.g = -0.2 * H; E.grow = blast ? 2.4 : 1.8; E.life = blast ? 0.9 : 1.3;
    p.blobs.put(blast ? '#ffb347' : hot ? '#3d3a40' : '#8d8f96');
  }

  private placeCleats(): void {
    const p = this.p, N = C2.cleatsPer, L = C2_LOOP, half = C2.trackHalf, R = C2.trackEndR;
    let n = 0;
    for (let side = 0; side < 2; side++) {
      const dist = side === 0 ? this.dL : this.dR;
      const x = side === 0 ? -C2.trackX : C2.trackX;
      for (let i = 0; i < N; i++) {
        let s = ((i / N) * L + dist) % L; if (s < 0) s += L;
        let y: number, z: number, a: number;
        const top = 2 * half, arc = PI * R;
        if (s < top) { z = -half + s; y = 2 * R; a = 0; }
        else if (s < top + arc) { const ph = (s - top) / R; z = half + Math.sin(ph) * R; y = R + Math.cos(ph) * R; a = ph; }
        else if (s < 2 * top + arc) { z = half - (s - top - arc); y = 0; a = PI; }
        else { const ph = (s - 2 * top - arc) / R; z = -half - Math.sin(ph) * R; y = R - Math.cos(ph) * R; a = ph + PI; }
        _e0.set(a, 0, 0, 'YXZ'); _q0.setFromEuler(_e0);
        p.cleats.setMatrixAt(n++, _m0.compose(_p0.set(x, y, C2.trackZ + z), _q0, _s0.set(1, 1, 1)));
      }
    }
    p.cleats.instanceMatrix.needsUpdate = true;
  }

  private placePanels(time: number): void {
    const p = this.p, dead = this.deadT >= 0;
    const stepPh = (this.dL + this.dR) * 0.5 * 2.2;
    for (let i = 0; i < 6; i++) {
      const th = (C2.panelDeg[i] * PI) / 180;
      const px = C2.arcR * Math.sin(th), pz = C2.arcZ + C2.arcR * Math.cos(th);
      let pitch = 0.03 * Math.sin(stepPh * PI * 2 + i * 0.9) + 0.01 * Math.sin(time * 1.7 + i);
      let yawJ = 0.05 * this.jit[i];
      let lean = 0.02 * Math.sin(stepPh * PI * 2 + i * 1.7);
      // SHIELD SHOVE: panels lock flush (no jitter, no flex), lean back in the crouch, snap forward on the lurch
      pitch = lerp(pitch, -0.08, this.lockK) + 0.16 * this.lurchK;
      yawJ *= 1 - this.lockK; lean *= 1 - this.lockK;
      // STALLED: droop outward like a wilted fence
      pitch += this.droopK * (0.42 + 0.12 * this.jit[i]);
      lean += this.droopK * 0.1 * this.jit[(i + 2) % 6];
      // defeat: topple outward one by one, left to right (dominoes), a small bounce on landing
      if (dead) {
        const t = this.deadT - (0.3 + 0.2 * i);
        if (t > 0) {
          const u = Math.min(1, t / 0.5);
          const fall = u * u * (PI / 2 - 0.06);
          const bounce = t > 0.5 ? 0.07 * Math.exp(-(t - 0.5) * 7) * Math.abs(Math.sin((t - 0.5) * 18)) : 0;
          pitch = Math.max(pitch, fall - bounce);
        }
      }
      // SAWHORSE TOSS: the right-of-centre panel swings open on its outer hinge
      const open = i === 3 ? this.openK * 1.15 : 0;
      _m0.makeTranslation(px, 0, pz);
      _m1.makeRotationY(th + yawJ);
      _m0.multiply(_m1);
      if (open > 0.001) {
        const hx = C2.panelW / 2;
        _m1.makeTranslation(hx, 0, 0); _m0.multiply(_m1);
        _m1.makeRotationY(open); _m0.multiply(_m1);
        _m1.makeTranslation(-hx, 0, 0); _m0.multiply(_m1);
      }
      _e0.set(pitch, 0, lean, 'YXZ'); _q0.setFromEuler(_e0);
      _m2.makeRotationFromQuaternion(_q0);
      _m0.multiply(_m2);
      p.panels.setMatrixAt(i, _m0);
    }
    p.panels.instanceMatrix.needsUpdate = true;
  }
}

// ═══════════════════════════════════════ SWITCHBOARD-5 ═══════════════════════════════════════
const S5 = {
  pods: [[-0.62, 0.5], [0.62, 0.5], [-0.62, -0.5], [0.62, -0.5]] as const,
  podHalf: 0.26, podR: 0.15, podW: 0.4, cleatsPer: 8,
  out: [[-0.7, 0.7], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]] as const,   // FL FR BL BR (the sim's order)
  outY: 0.36,
  mastLoY: 0.52, mastLoH: 0.93, mastHiH: 0.9,
  armLen: 0.8, armRise: 0.12,
  dishDeg: [0, 120, 240] as const,
  horns: [[-0.56, 0.62, 0.6, -0.55], [0.56, 0.62, 0.6, 0.55], [-0.74, 0.62, -0.05, -1.57], [0.74, 0.62, -0.05, 1.57]] as const,
  board: { y: 0.62, z: 0.2 },
} as const;
const S5_LOOP = 4 * S5.podHalf + 2 * PI * S5.podR;
/** seven-segment layout: [x, y, horizontal] per segment a b c d e f g (digit height 0.14) */
const SEG: readonly (readonly [number, number, number])[] = [
  [0, 0.068, 1], [0.034, 0.034, 0], [0.034, -0.034, 0], [0, -0.068, 1], [-0.034, -0.034, 0], [-0.034, 0.034, 0], [0, 0, 1],
];
const DIGIT_SEGS: readonly number[] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

function s5Base(f: Facet): void {
  // the deck: a wide chamfered slab with a hazard skirt all round
  f.box(1.7, 0.3, 1.7, C.grey, M(0, 0.37, 0), { ch: 0.18, top: C.greyD });
  f.box(1.62, 0.04, 1.62, C.steelD, M(0, 0.54, 0), { ch: 0.16 });
  for (let k = 0; k < 4; k++) f.hazard(-0.62, 0.62, 0.25, 0.37, 0.02, 10, C.hzY, C.hzK, M(0, 0, 0, 0, k * PI / 2, 0).multiply(M(0, 0, 0.855)));
  // four crawler pods (the treads scroll as instanced cleats)
  for (const [x, z] of S5.pods) {
    f.box(S5.podW, 0.26, 2 * S5.podHalf + 0.2, C.ink, M(x, 0.16, z), { ch: 0.08 });
    f.box(S5.podW + 0.04, 0.05, 2 * S5.podHalf + 0.26, C.yellow, M(x, 0.33, z), { ch: 0.03 });
    const sx = x < 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) f.cyl(0.07, 0.07, 0.04, 8, C.steel, M(x + sx * (S5.podW / 2), 0.1, z - S5.podHalf + i * S5.podHalf, 0, 0, PI / 2));
  }
  // switch cabinets on the deck with rows of jack lamps (the "switchboard")
  for (const sx of [-1, 1]) {
    f.box(0.36, 0.42, 0.26, C.navy, M(sx * 0.46, 0.76, -0.5), { ch: 0.03, top: C.navyL });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const col = (r * 4 + c + (sx > 0 ? 1 : 0)) % 3 === 0 ? C.amber : (r + c) % 2 === 0 ? C.teal : C.red;
      f.box(0.04, 0.035, 0.02, col, M(sx * 0.46 - 0.12 + c * 0.08, 0.66 + r * 0.09, -0.365), { glow: 0.7 });
    }
    f.beam(sx * 0.46 - 0.1, 0.6, -0.37, sx * 0.46 + 0.08, 0.84, -0.37, 0.012, 0.012, C.ink);
  }
  // mast plinth, stair rails, a hazard-banded equipment box at the front
  f.box(0.5, 0.1, 0.5, C.dark, M(0, 0.57, 0));
  f.box(0.3, 0.2, 0.22, C.yellow, M(0, 0.62, 0.52), { ch: 0.03 });
  f.hazard(-0.14, 0.14, 0.55, 0.69, 0.02, 4, C.hzY, C.hzK, M(0, 0, 0.63));
  f.mirrorX(() => f.beam(0.8, 0.55, -0.6, 0.8, 0.55, 0.3, 0.03, 0.03, C.steel));
}
function s5Cleat(f: Facet): void {
  f.box(S5.podW + 0.02, 0.04, 0.07, C.tire, M(0, 0.02, 0), { top: C.dark });
}
function s5Outrigger(f: Facet): void {
  // from its hinge on the deck corner, out (+Z) and down to a foot pad
  f.cyl(0.07, 0.07, 0.14, 8, C.dark, M(0, 0, 0, 0, 0, PI / 2));
  f.beam(0, 0, 0, 0, -0.2, 0.3, 0.09, 0.08, C.yellow);
  f.beam(0, -0.05, 0.05, 0, -0.25, 0.3, 0.04, 0.04, C.steel);
  f.cyl(0.05, 0.05, 0.14, 6, C.steelD, M(0, -0.27, 0.32));
  f.cyl(0.14, 0.16, 0.05, 8, C.ink, M(0, -0.34, 0.34));
}
function s5Horn(f: Facet): void {
  // a horn loudspeaker facing +Z, on a post down to the deck (horns stay ON THE DECK — §3.3 silhouette rule)
  f.cyl(0.03, 0.03, 0.14, 6, C.steelD, M(0, -0.07, -0.04));
  f.cyl(0.07, 0.07, 0.12, 8, C.greyD, M(0, 0, -0.1, PI / 2, 0, 0));
  f.loft([
    { y: -0.04, pts: rect(0.08, 0.08, 0.02) }, { y: 0.1, pts: rect(0.2, 0.16, 0.03) }, { y: 0.16, pts: rect(0.3, 0.22, 0.04) },
  ], { side: [C.cream, C.creamD], top: C.ink, bottom: C.greyD }, M(0, 0, 0, PI / 2, 0, 0));
}
function s5Lattice(f: Facet, h: number, w0: number, w1: number, colA: string, colB: string, bays: number): void {
  const cx = [-1, 1, 1, -1], cz = [-1, -1, 1, 1];
  for (let b = 0; b < bays; b++) {
    const y0 = (b / bays) * h, y1 = ((b + 1) / bays) * h;
    const a0 = lerp(w0, w1, b / bays), a1 = lerp(w0, w1, (b + 1) / bays);
    const col = b % 2 === 0 ? colA : colB;
    for (let k = 0; k < 4; k++) f.beam(cx[k] * a0, y0, cz[k] * a0, cx[k] * a1, y1, cz[k] * a1, 0.045, 0.045, col);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      const zig = (b + k) % 2 === 0;
      f.beam(cx[k] * (zig ? a0 : a1), zig ? y0 : y1, cz[k] * (zig ? a0 : a1), cx[k1] * (zig ? a1 : a0), zig ? y1 : y0, cz[k1] * (zig ? a1 : a0), 0.022, 0.022, C.steelD);
    }
    f.box(2 * a1 + 0.02, 0.025, 2 * a1 + 0.02, C.steelD, M(0, y1, 0));
  }
}
function s5MastLo(f: Facet): void {
  s5Lattice(f, S5.mastLoH, 0.2, 0.15, C.white, C.red, 5);
  // NOW SERVING board on the front face (the digits are an instanced 7-segment display over the recess)
  const by = S5.board.y, bz = S5.board.z;
  f.box(0.74, 0.36, 0.05, C.navy, M(0, by, bz), { ch: 0.02 });
  f.box(0.78, 0.03, 0.06, C.hzY, M(0, by + 0.19, bz));
  f.box(0.78, 0.03, 0.06, C.hzY, M(0, by - 0.19, bz));
  blockText(f, 'NOW SERVING', 0.0135, 0.01, C.cream, M(0, by + 0.105, bz + 0.026), 0.35);
  f.box(0.34, 0.18, 0.02, C.ink, M(0, by - 0.05, bz + 0.03));
  f.beam(-0.2, by - 0.18, bz - 0.02, -0.15, by - 0.33, 0.14, 0.03, 0.03, C.steelD);
  f.beam(0.2, by - 0.18, bz - 0.02, 0.15, by - 0.33, 0.14, 0.03, 0.03, C.steelD);
}
function s5MastHi(f: Facet): void {
  s5Lattice(f, S5.mastHiH, 0.15, 0.1, C.red, C.white, 4);
}
function s5Crown(f: Facet): void {
  f.cyl(0.17, 0.2, 0.14, 9, C.greyD, M(0, 0.05, 0));
  f.cyl(0.19, 0.19, 0.04, 9, C.teal, M(0, 0.1, 0), { glow: 0.6 });
  f.cyl(0.1, 0.12, 0.1, 9, C.steelD, M(0, 0.17, 0));
  f.cyl(0.02, 0.02, 0.2, 5, C.steel, M(0, 0.3, 0));
  f.cyl(0.045, 0.045, 0.07, 6, C.red, M(0, 0.42, 0), { glow: 0.9 });
}
function s5Arm(f: Facet): void {
  f.box(0.1, 0.1, 0.12, C.dark, M(0, 0, 0.04));
  f.beam(0, 0, 0.04, 0, S5.armRise, S5.armLen, 0.07, 0.07, C.yellow);
  f.beam(0, -0.06, 0.08, 0, S5.armRise - 0.04, S5.armLen * 0.7, 0.03, 0.03, C.steel);
}
function s5Dish(f: Facet): void {
  // authored at the dish mount, its face toward +Z (a Y-loft rotated onto +Z)
  f.group(M(0, 0, 0.05, PI / 2, 0, 0), () => {
    f.loft([
      { y: 0, pts: ngon(12, 0.09, 0.09) }, { y: 0.07, pts: ngon(12, 0.26, 0.26) }, { y: 0.1, pts: ngon(12, 0.31, 0.31) }, { y: 0.12, pts: ngon(12, 0.32, 0.32) },
    ], { side: [C.greyD, C.white, C.red], top: C.white, bottom: C.greyD });
    // feed horn on three struts
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * PI * 2;
      f.beam(Math.sin(a) * 0.26, 0.12, Math.cos(a) * 0.26, 0, 0.36, 0, 0.018, 0.018, C.steel);
    }
    f.cyl(0.05, 0.035, 0.08, 6, C.red, M(0, 0.38, 0), { glow: 0.5 });
  });
  f.box(0.1, 0.12, 0.1, C.dark, M(0, 0, -0.02));
}

export interface SwitchParts {
  base: THREE.Group; baseOff: THREE.Group;
  cleats: THREE.InstancedMesh; outriggers: THREE.InstancedMesh; outFlash: THREE.InstancedBufferAttribute;
  horns: THREE.InstancedMesh;
  mastLo: THREE.Group; mastHi: THREE.Group; crown: THREE.Group;
  digits: THREE.InstancedMesh; arms: THREE.InstancedMesh; dishes: THREE.InstancedMesh; dishFlash: THREE.InstancedBufferAttribute;
  ring: THREE.Mesh; ringMat: THREE.MeshBasicMaterial;
}

function buildSwitch(glowMul: number): GateRig {
  const root = new THREE.Group(); root.name = 'boss:switchboard5';
  const groups: Record<string, FlashGroup> = {
    base: grp(glowMul), treads: grp(glowMul), horns: grp(glowMul), board: grp(glowMul), arms: grp(glowMul),
    dishes: grp(glowMul, true), dishA: grp(glowMul), dishB: grp(glowMul), dishC: grp(glowMul),
    outriggers: grp(glowMul, true), outriggerFL: grp(glowMul), outriggerFR: grp(glowMul), outriggerBL: grp(glowMul), outriggerBR: grp(glowMul),
  };
  const meshes: THREE.Mesh[] = [];
  const add = <T extends THREE.Mesh>(parent: THREE.Object3D, m: T): T => { parent.add(m); meshes.push(m); return m; };
  const base = joint(root, 's5:base');
  const baseOff = joint(base, 's5:baseOff');
  add(baseOff, mesh(bld(s5Base), groups.base.mat, 's5:deck'));
  const cleats = add(root, inst(bld(s5Cleat, 0.02), groups.treads.mat, 4 * S5.cleatsPer, 's5:cleats', 1.6));
  const oGeo = bld(s5Outrigger, 0.02);
  const outFlash = flashAttr(oGeo, 4);
  const outriggers = add(baseOff, inst(oGeo, groups.outriggers.mat, 4, 's5:outriggers', OUTLINE_W));
  const horns = add(baseOff, inst(bld(s5Horn, 0.02), groups.horns.mat, 4, 's5:horns', OUTLINE_W));
  const mastLo = joint(baseOff, 's5:mastLo', 0, S5.mastLoY, 0);
  add(mastLo, mesh(bld(s5MastLo, 0.02), groups.board.mat, 's5:mastLoM'));
  const segGeo = bld((f) => { f.box(0.017, 0.058, 0.012, C.amber, M(0, 0, 0), { glow: 1 }); }, 0);
  const digits = add(mastLo, inst(segGeo, groups.board.mat, 14, 's5:digits', 0, false));
  const mastHi = joint(mastLo, 's5:mastHi', 0, S5.mastLoH, 0);
  add(mastHi, mesh(bld(s5MastHi, 0.02), groups.base.mat, 's5:mastHiM'));
  const crown = joint(mastHi, 's5:crown', 0, S5.mastHiH, 0);
  add(crown, mesh(bld(s5Crown, 0.02), groups.base.mat, 's5:crownM'));
  const arms = add(crown, inst(bld(s5Arm, 0.02), groups.arms.mat, 3, 's5:arms', OUTLINE_W));
  const dGeo = bld(s5Dish, 0.02);
  const dishFlash = flashAttr(dGeo, 3);
  const dishes = add(crown, inst(dGeo, groups.dishes.mat, 3, 's5:dishes', OUTLINE_W));
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.9, 1, 40);
  ringGeo.rotateX(-PI / 2);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 's5:holdRing'; ring.frustumCulled = false; ring.visible = false; ring.renderOrder = 3;
  root.add(ring);
  const parts: SwitchParts = { base, baseOff, cleats, outriggers, outFlash, horns, mastLo, mastHi, crown, digits, arms, dishes, dishFlash, ring, ringMat };
  const rig: GateRig = {
    id: 'switchboard5', gate: 'switchboard5', root, body: base, bodyY: 0, legs: [], groups, groupKeys: Object.keys(groups),
    joints: { base, mastLo, mastHi, crown }, meshes, stride: 1, duty: 0.5, liftH: 0, rMean: 1, walkSpeed: 1, footYawOut: false,
    fx: [], poser: null as unknown as GatePoser,
  };
  rig.poser = new SwitchPoser(rig, parts);
  return rig;
}

const OUT_GROUP = ['outriggerFL', 'outriggerFR', 'outriggerBL', 'outriggerBR'] as const;
const DISH_GROUP = ['dishA', 'dishB', 'dishC'] as const;

class SwitchPoser implements GatePoser {
  private r: GateRig; private p: SwitchParts;
  private mo = new Motion();
  private deadT = -1;
  private tread = new Float32Array(4);
  private crownA = 0.5; private crownInit = false;
  private foldK = 0.5; private liftK = 0.5; private droopK = 0.5;
  private swayX = 0.5; private swayXV = 0.5; private swayZ = 0.5; private swayZV = 0.5;
  private track = new Float32Array(3); private kick = new Float32Array(3); private flashD = new Float32Array(3);
  private lastFlareId = -1; private holdK = 0.5; private holdPh = 0.5; private phaseT = 0.5;
  private shownDigits = -2;

  constructor(r: GateRig, p: SwitchParts) { this.r = r; this.p = p; this.reset(); }
  reset(): void {
    this.mo.reset(); this.deadT = -1; this.tread.fill(0); this.crownA = 0; this.crownInit = false;
    this.foldK = 0; this.liftK = 0; this.droopK = 0; this.swayX = 0; this.swayXV = 0; this.swayZ = 0; this.swayZV = 0;
    this.track.fill(0); this.kick.fill(0); this.flashD.fill(0); this.lastFlareId = -1; this.holdK = 0; this.holdPh = 0; this.phaseT = 0;
    this.shownDigits = -2;
    this.p.ring.visible = false;
  }
  hideFx(): void { this.p.ring.visible = false; }
  phase(): void { this.phaseT = 1.2; }

  update(w: World, b: BossState, F: GateFrame): void {
    const p = this.p, r = this.r, d = b.data;
    const dt = F.dt, time = F.time;
    if (b.alive) this.deadT = -1; else this.deadT = this.deadT < 0 ? 0 : this.deadT + dt;
    const dead = this.deadT >= 0;
    this.mo.step(F);
    this.phaseT = Math.max(0, this.phaseT - dt);
    const stag = b.alive && b.staggerT > 0;
    const folded = b.alive && !stag && (d.folded ?? 0) > 0;
    const lifted = b.alive && (d.lifted ?? 0) > 0;
    const hold = b.alive && !stag && b.attack === 'holdMusic';

    // ── treads ──
    const turn = this.mo.om * 0.62;
    for (let k = 0; k < 4; k++) {
      const sx = S5.pods[k][0] < 0 ? 1 : -1;
      if (!stag && !dead) this.tread[k] += (this.mo.vF + sx * turn) * dt;
    }
    this.placeCleats();

    // ── outriggers (lift for a drive, plant when it stops; splay on the defeat) ──
    this.liftK += ((lifted ? 1 : 0) - this.liftK) * kExp(dt, 5);
    const splay = dead ? smoothstep(0.2, 1.2, this.deadT) * 0.25 : 0;
    for (let i = 0; i < 4; i++) {
      const ox = S5.out[i][0], oz = S5.out[i][1];
      _e0.set(-0.75 * this.liftK + splay, Math.atan2(ox, oz), 0, 'YXZ'); _q0.setFromEuler(_e0);
      p.outriggers.setMatrixAt(i, _m0.compose(_p0.set(ox, S5.outY, oz), _q0, _s0.set(1, 1, 1)));
    }
    p.outriggers.instanceMatrix.needsUpdate = true;

    // ── mast sway (a spring driven by the drive's acceleration and turns) + the defeat buckle ──
    const ax = clamp(-this.mo.acc * 0.05, -0.12, 0.12), az = clamp(this.mo.om * this.mo.vF * 0.05, -0.1, 0.1);
    this.swayXV += ((ax - this.swayX) * 30 - this.swayXV * 4) * dt; this.swayX += this.swayXV * dt;
    this.swayZV += ((az - this.swayZ) * 30 - this.swayZV * 4) * dt; this.swayZ += this.swayZV * dt;
    let loPitch = this.swayX * 0.5, hiPitch = this.swayX * 0.8, loRoll = this.swayZ * 0.5, hiRoll = this.swayZ;
    if (this.phaseT > 0) hiRoll += 0.04 * Math.sin(time * 18) * this.phaseT;
    if (dead) {
      const t = this.deadT;
      loPitch = 0.12 * smoothstep(0, 0.6, t);
      const u = clamp((t - 0.35) / 1.0, 0, 1);
      hiPitch = 1.72 * u * u * (3 - 2 * u) + (t > 1.35 ? 0.06 * Math.exp(-(t - 1.35) * 5) * Math.sin((t - 1.35) * 20) : 0);
      loRoll = 0; hiRoll = 0.1 * smoothstep(0.3, 1.2, t);
    }
    p.mastLo.rotation.set(loPitch, 0, loRoll, 'YXZ');
    p.mastHi.rotation.set(hiPitch, 0, hiRoll, 'YXZ');
    p.base.position.set(0, dead ? -0.06 * smoothstep(0, 1, this.deadT) : stag ? -0.03 : 0, 0);

    // ── crown: the sim's angle (smoothed across the wrap) ──
    const cT = d.crown ?? 0;
    if (!this.crownInit) { this.crownA = cT; this.crownInit = true; }
    if (b.alive) this.crownA += wrapAngle(cT - this.crownA) * kExp(dt, 10);
    p.crown.rotation.set(0, this.crownA, 0);

    // ── dishes: fold for a drive, droop in LINES DOWN, each tracks the titan by ±10° ──
    this.foldK += ((folded ? 1 : 0) - this.foldK) * kExp(dt, folded ? 6 : 4);
    this.droopK += ((stag || dead ? 1 : 0) - this.droopK) * kExp(dt, 3);
    // a new flare → the dish facing the titan flashes and recoils
    const T = w.titan;
    const toT = Math.atan2(T.x - F.x, T.z - F.z);
    for (let i = 0; i < w.projectiles.length; i++) {
      const pr = w.projectiles[i];
      if (!pr.alive || pr.kind !== 'callFlare' || pr.id <= this.lastFlareId) continue;
      this.lastFlareId = pr.id;
      let best = 0, bd = 9;
      for (let k = 0; k < 3; k++) {
        const yaw = F.h + this.crownA + (S5.dishDeg[k] * PI) / 180;
        const dd = Math.abs(wrapAngle(toT - yaw));
        if (dd < bd) { bd = dd; best = k; }
      }
      this.kick[best] = 1; this.flashD[best] = 1;
    }
    for (let k = 0; k < 3; k++) {
      const a = (S5.dishDeg[k] * PI) / 180;
      const yawW = F.h + this.crownA + a;
      const off = dead ? 0 : clamp(wrapAngle(toT - yawW), -0.1745, 0.1745);
      this.track[k] += (off - this.track[k]) * kExp(dt, 4);
      this.kick[k] = Math.max(0, this.kick[k] - dt * 4);
      this.flashD[k] = Math.max(0, this.flashD[k] - dt * 3);
      const fold = 1.2 * this.foldK + 0.38 * this.droopK;
      // arm
      _e0.set(fold, a, 0, 'YXZ'); _q0.setFromEuler(_e0);
      p.arms.setMatrixAt(k, _m0.compose(_p0.set(0, 0.06, 0), _q0, _s0.set(1, 1, 1)));
      // dish at the arm's end (the arm's end point through the same pitch · yaw)
      const cy = Math.cos(fold), sy = Math.sin(fold);
      const ey = 0.06 + S5.armRise * cy - S5.armLen * sy, ez = S5.armRise * sy + S5.armLen * cy;
      const tilt = -0.28 + 1.1 * this.foldK + 0.95 * this.droopK - 0.25 * this.kick[k];
      _e0.set(tilt + fold * 0.2, a + this.track[k], 0, 'YXZ'); _q0.setFromEuler(_e0);
      p.dishes.setMatrixAt(k, _m0.compose(_p0.set(Math.sin(a) * ez, ey, Math.cos(a) * ez), _q0, _s0.set(1, 1, 1)));
    }
    p.arms.instanceMatrix.needsUpdate = true;
    p.dishes.instanceMatrix.needsUpdate = true;
    const g = r.groups;
    const df = p.dishFlash.array as Float32Array;
    for (let k = 0; k < 3; k++) df[k] = Math.min(0.85, Math.max(g[DISH_GROUP[k]].flash, this.flashD[k] * 0.9) * 0.85);
    p.dishFlash.needsUpdate = true;
    const of = p.outFlash.array as Float32Array;
    for (let k = 0; k < 4; k++) of[k] = Math.min(0.85, g[OUT_GROUP[k]].flash * 0.85);
    p.outFlash.needsUpdate = true;

    // ── deck horns + HOLD MUSIC rings ──
    this.holdK += ((hold ? 1 : 0) - this.holdK) * kExp(dt, hold ? 8 : 4);
    if (this.holdK > 0.01) this.holdPh += dt * 2.2;
    const pulse = 1 + 0.28 * this.holdK * Math.abs(Math.sin(time * 11));
    for (let i = 0; i < 4; i++) {
      const hz = S5.horns[i];
      _e0.set(-0.3, hz[3], 0, 'YXZ'); _q0.setFromEuler(_e0);
      p.horns.setMatrixAt(i, _m0.compose(_p0.set(hz[0], hz[1], hz[2]), _q0, _s0.set(pulse, pulse, pulse)));
    }
    p.horns.instanceMatrix.needsUpdate = true;
    if (this.holdK > 0.02 && !dead) {
      const u = this.holdPh % 1;
      p.ring.visible = true;
      const s = 0.9 + 1.3 * u;
      p.ring.scale.set(s, 1, s);
      p.ring.position.set(0, 0.58, 0);
      p.ringMat.opacity = 0.75 * this.holdK * (1 - u);
    } else p.ring.visible = false;

    // ── NOW SERVING board: the sim's count; `--` in LINES DOWN; dark after the defeat ──
    const want = dead ? (this.deadT < 0.6 ? -1 : -3) : stag ? -1 : Math.max(0, Math.round(d.serving ?? 5)) % 100;
    if (want !== this.shownDigits) { this.shownDigits = want; this.setDigits(want); }

    // ── glow ──
    const dim = dead ? Math.max(0, 1 - this.deadT / 1.4) : 1;
    const blink = stag ? (Math.sin(time * 9) > 0 ? 1 : 0.25) : 1;
    g.board.mat.userData.bt.uGlowMul.value = g.board.glowBase * 1.25 * blink * dim;
    g.base.mat.userData.bt.uGlowMul.value = g.base.glowBase * (0.8 + 0.6 * this.holdK) * (stag ? 0.4 : 1) * dim;
    g.dishes.mat.userData.bt.uGlowMul.value = g.dishes.glowBase * (stag ? 0.2 : 1) * dim;
    g.horns.mat.userData.bt.uGlowMul.value = g.horns.glowBase * dim;
  }

  private setDigits(v: number): void {
    const p = this.p;
    // v ≥ 0: two digits; −1: `--`; −3: blank
    for (let dg = 0; dg < 2; dg++) {
      const val = v >= 0 ? (dg === 0 ? Math.floor(v / 10) : v % 10) : -1;
      const mask = v >= 0 ? DIGIT_SEGS[val] : v === -1 ? 0x40 : 0;
      for (let s = 0; s < 7; s++) {
        const on = (mask >> s) & 1;
        const sg = SEG[s];
        _e0.set(0, 0, sg[2] ? PI / 2 : 0, 'YXZ'); _q0.setFromEuler(_e0);
        const k = on ? 1 : 0.0001;
        p.digits.setMatrixAt(dg * 7 + s, _m0.compose(_p0.set((dg === 0 ? -0.07 : 0.07) + sg[0], S5.board.y - 0.05 + sg[1], S5.board.z + 0.045), _q0, _s0.set(k, k, k)));
      }
    }
    p.digits.instanceMatrix.needsUpdate = true;
  }

  private placeCleats(): void {
    const p = this.p, N = S5.cleatsPer, L = S5_LOOP, half = S5.podHalf, R = S5.podR;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const x = S5.pods[k][0], zc = S5.pods[k][1];
      for (let i = 0; i < N; i++) {
        let s = ((i / N) * L + this.tread[k]) % L; if (s < 0) s += L;
        let y: number, z: number, a: number;
        const top = 2 * half, arc = PI * R;
        if (s < top) { z = -half + s; y = 2 * R + 0.01; a = 0; }
        else if (s < top + arc) { const ph = (s - top) / R; z = half + Math.sin(ph) * R; y = R + Math.cos(ph) * R; a = ph; }
        else if (s < 2 * top + arc) { z = half - (s - top - arc); y = 0; a = PI; }
        else { const ph = (s - 2 * top - arc) / R; z = -half - Math.sin(ph) * R; y = R - Math.cos(ph) * R; a = ph + PI; }
        _e0.set(a, 0, 0, 'YXZ'); _q0.setFromEuler(_e0);
        p.cleats.setMatrixAt(n++, _m0.compose(_p0.set(x, y, zc + z), _q0, _s0.set(1, 1, 1)));
      }
    }
    p.cleats.instanceMatrix.needsUpdate = true;
  }
}

// ═══════════════════════════════════════ entry ═══════════════════════════════════════
/** Build one gatekeeper rig (once per page; bossview keeps it). */
export function buildGateRig(id: GateId, glowMul: number): GateRig {
  return id === 'stencil1' ? buildStencil(glowMul) : id === 'cordon2' ? buildCordon(glowMul) : buildSwitch(glowMul);
}
