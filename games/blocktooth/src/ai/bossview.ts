// BLOCKTOOTH — boss view (foes-view lane, CONTRACT §6, §6.1, §10, §1).
//
// Two original containment bosses as articulated, procedurally animated hierarchies:
//   * CAISSON-4 — four-legged harbour crane-mech (~75 m + boom): truss gantry body, operator cab
//     with two lamp "eyes", A-frame + lattice boom with a running trolley, a winch drum, four
//     two-bone stilt legs with foot pads (IK keeps planted pads on the ground while the body
//     bobs, rises for LEG STOMP, sags in a stagger), a hook on a cable that visibly drops for
//     HOOK DROP (following the sim's hookDrop lobs), is flung down the HOOK LANE, lassos during
//     the WINCH windup and runs a taut cable to the titan while the leash holds.
//   * IRON GULLY — pale ridge-backed quadruped (~70 m): heavy barrel torso with a frost-caked
//     hide, beaked head with a hinged lower beak and icy eyes, a tall SAIL of riveted scrap
//     plates on bony spines along the spine, a thick two-part tail, four IK legs with clawed paws.
// Animation reads boss.attack / attackT / phase / staggerT / introT / data.* and the live boss
// telegraphs, so every body wind-up is timed by the SAME windup as the paint on the floor.
// Part hit flash per collider group (bossHit events), 3 px ink hulls, shadows. Zero per-frame
// allocation (scratch vectors, fixed mesh set).

import * as THREE from 'three';
import type { BossId, BossState, World } from '../core/types.ts';
import { SIM_DT } from '../core/config.ts';
import { clamp, easeInCubic, easeOutCubic, lerp, smoothstep, wrapAngle } from '../core/math.ts';
import { BIOMES } from '../data/biomes.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../render/viewtypes.ts';
import { addOutline } from '../render/materials.ts';
import { FOE_PAL, Facet, M, makeFoeMaterial, ngon, rect } from './foemodels.ts';
import type { FoeMaterial } from './foemodels.ts';

/** CONTRACT §6.1: titans / bosses 3.0 px ink. */
const OUTLINE_W = 3.0;
const PI = Math.PI;
const P = FOE_PAL;
/** Fallback windup scale per phase (the live telegraph's windup is preferred — see tell()). */
const WINDUP_MUL_FALLBACK: readonly number[] = [1, 1, 0.85, 0.72];

// ─────────────────────────────── scratch ───────────────────────────────
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _hip = new THREE.Vector3(), _knee = new THREE.Vector3(), _foot = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3();

// ─────────────────────────────── rig helpers ───────────────────────────────
/**
 * Matrix placing a segment authored along +Y (0 → L, front face toward +Z) from A to B, rolled so
 * its +Z faces the pole side. Writes into `out` (root-local).
 */
function segMatrix(A: THREE.Vector3, B: THREE.Vector3, pole: THREE.Vector3, out: THREE.Matrix4): void {
  _y.subVectors(B, A);
  const L = Math.sqrt(_y.x * _y.x + _y.y * _y.y + _y.z * _y.z);
  if (L < 1e-6) _y.set(0, 1, 0); else _y.multiplyScalar(1 / L);
  const pd = pole.x * _y.x + pole.y * _y.y + pole.z * _y.z;
  _z.set(pole.x - _y.x * pd, pole.y - _y.y * pd, pole.z - _y.z * pd);
  let zl = _z.x * _z.x + _z.y * _z.y + _z.z * _z.z;
  if (zl < 1e-8) { _z.set(-_y.z * _y.x, -_y.z * _y.y, 1 - _y.z * _y.z); zl = _z.x * _z.x + _z.y * _z.y + _z.z * _z.z; if (zl < 1e-8) { _z.set(1, 0, 0); zl = 1; } }
  _z.multiplyScalar(1 / Math.sqrt(zl));
  _x.crossVectors(_y, _z);
  out.makeBasis(_x, _y, _z).setPosition(A);
}

/**
 * Two-bone IK: hip H, target F (both root-local), the leg's bone lengths, pole (knee side).
 * Writes the knee into K and the reachable foot (F clamped onto the reach shell) into Fo (Fo may be F).
 */
function solveLeg(H: THREE.Vector3, F: THREE.Vector3, leg: LegRig, pole: THREE.Vector3, K: THREE.Vector3, Fo: THREE.Vector3): void {
  const L1 = leg.L1, L2 = leg.L2;
  _v0.subVectors(F, H);
  let D = Math.sqrt(_v0.x * _v0.x + _v0.y * _v0.y + _v0.z * _v0.z);
  if (D < 1e-6) { _v0.set(0, -1, 0); D = 1e-6; } else _v0.multiplyScalar(1 / D);
  const lo = Math.abs(L1 - L2) + 0.05, hi = L1 + L2 - 0.05;
  const Dc = D < lo ? lo : D > hi ? hi : D;
  Fo.copy(H).addScaledVector(_v0, Dc);
  const a = (L1 * L1 - L2 * L2 + Dc * Dc) / (2 * Dc);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pd = pole.x * _v0.x + pole.y * _v0.y + pole.z * _v0.z;
  _v1.set(pole.x - _v0.x * pd, pole.y - _v0.y * pd, pole.z - _v0.z * pd);
  let pl = _v1.x * _v1.x + _v1.y * _v1.y + _v1.z * _v1.z;
  if (pl < 1e-8) { _v1.set(-_v0.y * _v0.x, 1 - _v0.y * _v0.y, -_v0.y * _v0.z); pl = _v1.x * _v1.x + _v1.y * _v1.y + _v1.z * _v1.z; }
  _v1.multiplyScalar(1 / Math.sqrt(Math.max(pl, 1e-12)));
  K.copy(H).addScaledVector(_v0, a).addScaledVector(_v1, h);
}

/** Shared procedural gait: phase from rendered motion; per-foot slide direction = −(body velocity at the foot). */
interface Gait {
  init: boolean;
  lx: number; lz: number; lh: number;
  vlx: number; vlz: number;   // smoothed body-local velocity (m/s)
  om: number;                 // smoothed yaw rate (rad/s)
  phase: number;              // cycles
  pace: number;               // smoothed foot pace (m/s)
}
function newGait(): Gait { return { init: false, lx: 0.5, lz: 0.5, lh: 0.5, vlx: 0.5, vlz: 0.5, om: 0.5, phase: 0.5, pace: 0.5 }; }
/** per-frame doubles for the gait / leg helpers (a record, not call arguments: V8 boxes double args) */
const GS = { x: 0.5, z: 0.5, h: 0.5, dt: 0.5, mk: 0.5 };

function stepGait(g: Gait, r: BossRig): void {
  const x = GS.x, z = GS.z, h = GS.h, dt = GS.dt;
  if (!g.init) { g.lx = x; g.lz = z; g.lh = h; g.init = true; g.vlx = 0; g.vlz = 0; g.om = 0; g.phase = 0; g.pace = 0; }
  let dx = x - g.lx, dz = z - g.lz;
  let dh = h - g.lh;
  dh -= PI * 2 * Math.floor((dh + PI) / (PI * 2));
  if (dx * dx + dz * dz > 120 * 120) { dx = 0; dz = 0; dh = 0; }   // respawn / teleport
  g.lx = x; g.lz = z; g.lh = h;
  const c = Math.cos(h), s = Math.sin(h);
  const lxv = (dx * c - dz * s) / dt, lzv = (dx * s + dz * c) / dt;
  const k = Math.min(1, dt * 6);
  g.vlx += (lxv - g.vlx) * k;
  g.vlz += (lzv - g.vlz) * k;
  const om = dh / dt;
  g.om += ((om < -3 ? -3 : om > 3 ? 3 : om) - g.om) * k;
  g.pace = Math.sqrt(g.vlx * g.vlx + g.vlz * g.vlz) + Math.abs(g.om) * r.rMean;
  g.phase += (g.pace * dt) / r.stride;
}

/** Foot target offset (ox, lift, oz) for a leg of a rig at the current gait (moveK in GS.mk). */
function footOffset(g: Gait, L: LegRig, r: BossRig, out: THREE.Vector3): void {
  const rx = L.rest.x, rz = L.rest.z, duty = r.duty, moveK = GS.mk;
  const ph = g.phase + L.off;
  const u = ph - Math.floor(ph);
  const fvx = g.vlx + g.om * rz, fvz = g.vlz - g.om * rx;
  const pace = Math.max(1e-3, g.pace);
  const dxn = fvx / pace, dzn = fvz / pace;
  const half = r.stride * duty * 0.5;
  let a: number, lift = 0;
  if (u < duty) a = half * (1 - 2 * u / duty);
  else { const w = (u - duty) / (1 - duty); a = half * (-1 + 2 * w); lift = Math.sin(PI * w); }
  out.set(dxn * a * moveK, lift * r.liftH * moveK, dzn * a * moveK);
}

// ─────────────────────────────── rig types ───────────────────────────────
interface LegRig {
  name: string;                 // collider / flash group name (legFL …)
  hip: THREE.Vector3;           // body-local hip
  rest: THREE.Vector3;          // root-local rest ankle target
  L1: number; L2: number;
  pole: THREE.Vector3;          // root-local knee-side hint (rest)
  off: number;                  // gait phase offset
  upper: THREE.Mesh; lower: THREE.Mesh; foot: THREE.Mesh;
  /** struck-leg flinch (s) */
  flinch: number;
}

interface FlashGroup { mat: FoeMaterial; flash: number; glowBase: number }

interface BossRig {
  id: BossId;
  root: THREE.Group;            // boss XZ + heading
  body: THREE.Group;            // body joint (pose offsets)
  bodyY: number;                // rest body joint height
  legs: LegRig[];
  groups: Record<string, FlashGroup>;
  groupKeys: string[];
  joints: Record<string, THREE.Object3D>;
  meshes: THREE.Mesh[];
  stride: number; duty: number; liftH: number; rMean: number; walkSpeed: number;
  footYawOut: boolean;          // foot pads yaw outward (crane) or follow the body (beast)
}

function mkMesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = shadow;
  m.receiveShadow = true;
  m.frustumCulled = false;       // posed every frame far from its bind bounds (legs, cables)
  addOutline(m, OUTLINE_W);
  return m;
}

function mkGroup(glow: number): FlashGroup {
  const mat = makeFoeMaterial(false);
  mat.userData.bt.uGlowMul.value = glow;
  return { mat, flash: 0, glowBase: glow };
}

/** Hazard stripe palette for both bosses (in the HALVARD livery). */
const HZ_A = P.amber, HZ_B = P.navyD;

// ─────────────────────────────── CAISSON-4 ───────────────────────────────
const C4 = {
  bodyY: 42,
  hip: [[14, -3, 12], [-14, -3, 12], [14, -3, -12], [-14, -3, -12]] as const,
  foot: [[29, 3, 27], [-29, 3, 27], [29, 3, -27], [-29, 3, -27]] as const,
  L1: 28, L2: 40,
  boomPivot: [0, 17, 4] as const, boomL: 46, boomRest: 0.24,
  cab: [0, 8, 12] as const,
};

function c4Body(f: Facet): void {
  // main deck: truss gantry box
  f.loft([
    { y: -6, pts: rect(30, 26, 3) },
    { y: -4, pts: rect(34, 30, 3.5) },
    { y: 2.2, pts: rect(34, 30, 3.5) },
    { y: 4, pts: rect(32, 28, 3) },
  ], { side: [P.navy, P.org, P.off], top: P.off, bottom: P.navyD });
  // hazard bands front + back of the deck
  f.hazard(-14, 14, -3.4, 0.6, 0.35, 12, HZ_A, HZ_B, M(0, 0, 15.02));
  f.hazard(-14, 14, -3.4, 0.6, 0.35, 12, HZ_A, HZ_B, M(0, 0, -15.02, 0, PI));
  // under-deck lattice girders + X bracing
  f.mirrorX(() => {
    f.box(2.6, 2.6, 30, P.navy, M(12, -9.5, 0), { ch: 0.4 });
    for (let i = 0; i < 4; i++) {
      const z0 = -13 + i * 7, z1 = z0 + 7;
      f.beam(12, -8.4, z0, 12, -5.8, z1, 0.9, 0.9, P.off);
      f.beam(12, -8.4, z1, 12, -5.8, z0, 0.9, 0.9, P.off);
    }
  });
  f.box(24, 2, 2.2, P.navy, M(0, -9.5, 10), { ch: 0.3 });
  f.box(24, 2, 2.2, P.navy, M(0, -9.5, -10), { ch: 0.3 });
  // hip housings at the four corners
  for (const h of C4.hip) {
    f.cyl(4.2, 3.6, 7, 8, P.navy, M(h[0], h[1], h[2]), { top: P.org });
    f.cyl(4.5, 4.5, 1.1, 8, P.org, M(h[0], h[1] - 3.2, h[2]));
    f.box(1.2, 1.2, 1.2, P.amber, M(h[0] * 1.22, 2.9, h[2] * 1.24), { glow: 1 });
  }
  // winch house on the back of the deck + vents
  f.box(20, 9, 13, P.off, M(0, 8.5, -7), { ch: 1.2, top: P.navy, tw: 0.94, td: 0.92 });
  f.box(20.3, 1.6, 13.3, P.org, M(0, 5.2, -7));
  for (let i = -2; i <= 2; i++) f.box(2.2, 1.2, 1.6, P.navyD, M(i * 3.4, 13.4, -9), { ch: 0.2 });
  f.mirrorX(() => f.box(0.3, 3, 8, P.visor, M(10.05, 9.5, -7), { ch: 0.2 }));   // louvre panels
  // counterweight slab hanging off the back, hazard-striped, with a stencilled "4"
  f.box(26, 12, 7, P.navy, M(0, -1, -19), { ch: 0.8 });
  f.hazard(-12.5, 12.5, -6.5, -3.5, 0.3, 11, HZ_A, HZ_B, M(0, 0, -22.52, 0, PI));
  f.hazard(-12.5, 12.5, 2.5, 4.4, 0.3, 11, HZ_A, HZ_B, M(0, 0, -22.52, 0, PI));
  f.mirrorX(() => f.group(M(13.02, -1, -19, 0, PI / 2), () => {
    // seven-segment "4" in off-white on the counterweight flanks (normal +X)
    f.box(0.9, 4.2, 0.25, P.off, M(-1.4, 1.7, 0));
    f.box(3.6, 0.9, 0.25, P.off, M(0, -0.2, 0));
    f.box(0.9, 8, 0.25, P.off, M(1.4, 0, 0));
  }));
  // A-frame carrying the boom heel pin + backstays to the counterweight
  const [bx, by, bz] = C4.boomPivot;
  f.mirrorX(() => {
    f.beam(8, 4, -2, 2.6, by, bz, 1.6, 1.6, P.org, { ch: 0.3 });
    f.beam(8, 4, 11, 2.6, by, bz, 1.6, 1.6, P.org, { ch: 0.3 });
    f.beam(2.6, by + 0.5, bz, 9, 5, -19, 0.9, 0.9, P.navyD);
    f.box(1.4, 3, 3, P.navyD, M(2.8, by, bz), { ch: 0.3 });
  });
  f.cyl(1.3, 1.3, 7.4, 8, P.steel, M(bx, by, bz, 0, 0, PI / 2));
  f.box(1.6, 1.6, 1.6, P.red, M(0, by + 2.2, bz), { glow: 1 });
  // grab rails along the deck edge
  f.mirrorX(() => f.beam(16.6, 5.4, -13, 16.6, 5.4, 13, 0.35, 0.35, P.amber));
}

function c4Drum(f: Facet): void {
  // winch drum, axis X (spins about X), flanges + a stripe so the spin reads
  f.cyl(2.4, 2.4, 9, 10, P.navyD, M(0, 0, 0, 0, 0, PI / 2), { top: P.org, bottom: P.org });
  f.mirrorX(() => f.cyl(3.4, 3.4, 0.6, 10, P.org, M(4.6, 0, 0, 0, 0, PI / 2)));
  f.box(9.2, 0.7, 1.2, P.off, M(0, 2.2, 0));
  f.box(9.2, 0.7, 1.2, P.off, M(0, -2.2, 0));
}

function c4Cab(f: Facet): void {
  // operator cab: the "face". Origin at the cab bracket, cab box forward of the deck.
  f.loft([
    { y: 0, pts: rect(11, 8.4, 1.4, 0, 3.4) },
    { y: 5, pts: rect(12, 9.4, 1.6, 0, 3.6) },
    { y: 9.4, pts: rect(12, 9.4, 1.6, 0, 3.6) },
    { y: 11, pts: rect(10.6, 8.2, 1.4, 0, 3.4) },
  ], { side: [P.off, P.navy, P.off], top: P.org, bottom: P.navyD });
  // wraparound window band (the visor brow over the lamp eyes)
  f.box(12.25, 2.4, 9.6, P.visor, M(0, 7.3, 3.6), { ch: 1.5 });
  f.box(12.4, 0.5, 9.8, P.lamp, M(0, 7.35, 3.6), { ch: 1.5, glow: 0.35 });
  // two big lamp "eyes": navy bezels, warm glowing lenses, hazard cheek plates
  f.mirrorX(() => {
    f.cyl(2.1, 2.1, 0.9, 10, P.navyD, M(3, 3.1, 8.35, PI / 2));
    f.cyl(1.55, 1.5, 0.7, 10, P.amber, M(3, 3.1, 8.95, PI / 2), { glow: 1 });
    f.cyl(0.6, 0.6, 0.3, 8, '#fff6d8', M(3, 3.1, 9.35, PI / 2), { glow: 1 });
    f.box(1.8, 0.7, 0.7, P.navyD, M(3.2, 5.3, 8.5, 0, 0, -0.18));   // stern brow
  });
  f.hazard(-5.2, 5.2, 0.3, 1.5, 0.25, 8, HZ_A, HZ_B, M(0, 0, 7.72));
  // roof beacon + antenna + bracket down to the deck
  f.cyl(0.9, 0.9, 1.4, 8, P.red, M(-3, 11.9, 1.6), { glow: 1 });
  f.beam(3.5, 11, 1, 3.8, 16, 0.6, 0.25, 0.25, P.navyD);
  f.box(8, 3, 3, P.navy, M(0, -1, -0.5), { ch: 0.5 });
}

function c4Boom(f: Facet): void {
  // lattice boom along +Z from the heel pin (0) to the tip (L): 4 chords + zigzag lacing
  const L = C4.boomL;
  const w0 = 5.2, w1 = 2.6;
  const hw = (t: number) => lerp(w0, w1, t) / 2;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    f.beam(sx * hw(0), sy * hw(0), 0, sx * hw(1), sy * hw(1), L, 1.0, 1.0, P.org, { ch: 0.2 });
  }
  const n = 10;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, z0 = t0 * L, z1 = t1 * L;
    for (const sx of [-1, 1]) {   // side lacing (zig-zag)
      const ya = (i & 1) ? -1 : 1;
      f.beam(sx * hw(t0), ya * hw(t0), z0, sx * hw(t1), -ya * hw(t1), z1, 0.55, 0.55, P.navy);
    }
    const xa = (i & 1) ? -1 : 1;  // top + bottom lacing
    f.beam(xa * hw(t0), hw(t0), z0, -xa * hw(t1), hw(t1), z1, 0.5, 0.5, P.navy);
    f.beam(xa * hw(t0), -hw(t0), z0, -xa * hw(t1), -hw(t1), z1, 0.5, 0.5, P.navy);
  }
  // heel block + tip head with sheave and hazard cheeks
  f.box(6.4, 6.4, 3, P.navyD, M(0, 0, 1), { ch: 0.6 });
  f.box(4.2, 4.6, 4.4, P.org, M(0, 0, L + 1), { ch: 0.5, top: P.off });
  f.mirrorX(() => f.group(M(2.12, 0, L + 1, 0, PI / 2), () => f.hazard(-2.1, 2.1, -2.2, 2.2, 0.2, 5, HZ_A, HZ_B)));
  f.cyl(1.9, 1.9, 1.4, 10, P.steelD, M(0, -2.6, L + 2.2, 0, 0, PI / 2));
  f.box(0.9, 0.9, 0.9, P.red, M(0, 2.6, L + 2.4), { glow: 1 });
  // under-boom trolley rails
  f.mirrorX(() => f.beam(1.1, -hw(0) - 0.4, 3, 0.9, -hw(1) - 0.4, L - 1, 0.35, 0.35, P.steelD));
}

function c4Trolley(f: Facet): void {
  f.box(4.2, 1.8, 5, P.navy, M(0, -1.2, 0), { ch: 0.4, top: P.org });
  f.mirrorX(() => { f.cyl(0.7, 0.7, 0.6, 8, P.tire, M(1.1, -0.1, 1.6, 0, 0, PI / 2)); f.cyl(0.7, 0.7, 0.6, 8, P.tire, M(1.1, -0.1, -1.6, 0, 0, PI / 2)); });
  f.cyl(1.2, 1.2, 3.2, 8, P.steelD, M(0, -2.4, 0, 0, 0, PI / 2));
  f.box(0.7, 0.7, 0.7, P.amber, M(0, -2.2, 2.6), { glow: 1 });
}

function c4Upper(f: Facet, L: number): void {
  // box girder along +Y (hip → knee), front (+Z) = knee side
  f.loft([
    { y: 0, pts: rect(4.8, 4.8, 0.9) },
    { y: L * 0.25, pts: rect(4.6, 4.6, 0.9) },
    { y: L * 0.32, pts: rect(4.6, 4.6, 0.9) },
    { y: L, pts: rect(3.6, 3.6, 0.7) },
  ], { side: [P.navy, P.org, P.navy], top: P.navy, bottom: P.navy });
  f.beam(0, 3, -3.1, 0, L - 3, -2.6, 1.1, 1.1, P.steel, { seg: 6 });                 // hydraulic ram
  f.beam(0, 1.5, -2.6, 0, 3.2, -3.1, 1.6, 1.6, P.steelD, { seg: 6 });
  f.cyl(3.1, 3.1, 5.6, 10, P.org, M(0, L, 0, 0, 0, PI / 2), { top: P.navyD, bottom: P.navyD });   // knee
  f.cyl(1.2, 1.2, 6.4, 8, P.steelD, M(0, L, 0, 0, 0, PI / 2));
}

function c4Lower(f: Facet, L: number): void {
  // long stilt along +Y (knee → ankle): off-white girder, hazard band, navy boot
  f.loft([
    { y: 0, pts: rect(3.9, 3.9, 0.8) },
    { y: L * 0.12, pts: rect(3.9, 3.9, 0.8) },
    { y: L * 0.18, pts: rect(3.7, 3.7, 0.8) },
    { y: L * 0.62, pts: rect(3.1, 3.1, 0.7) },
    { y: L * 0.7, pts: rect(3.1, 3.1, 0.7) },
    { y: L * 0.84, pts: rect(3.3, 3.3, 0.7) },
    { y: L, pts: rect(3.6, 3.6, 0.8) },
  ], { side: [P.off, P.org, P.off, P.org, P.off, P.navy], top: P.navyD, bottom: P.navyD });
  f.group(M(0, 0, 1.98, 0, 0, 0), () => f.hazard(-1.5, 1.5, L * 0.3, L * 0.3 + 3.6, 0.2, 3, HZ_A, HZ_B));
  f.box(0.8, 0.8, 0.8, P.amber, M(0, L * 0.45, 1.75), { glow: 1 });
}

function c4Foot(f: Facet): void {
  // origin at the ankle; pad below, clamp toes point outward (+Z)
  f.cyl(2.2, 2.4, 2.4, 8, P.steelD, M(0, -0.6, 0));
  f.loft([
    { y: -3.2, pts: ngon(8, 6.2, 6.2, PI / 8) },
    { y: -2.4, pts: ngon(8, 6.6, 6.6, PI / 8) },
    { y: -1.4, pts: ngon(8, 5.6, 5.6, PI / 8) },
  ], { side: [P.navy, P.org], top: P.navyD, bottom: P.navyD });
  for (const a of [-0.7, 0, 0.7]) f.group(M(0, 0, 0, 0, a), () => f.box(1.5, 1.6, 3.6, P.navyD, M(0, -2.3, 6.6), { ch: 0.3, tw: 0.7 }));
}

function c4Hook(f: Facet): void {
  // origin at the cable attach point; hangs down ~12 m
  f.box(5.4, 4.4, 3.2, P.org, M(0, -2.4, 0), { ch: 0.6, top: P.off });
  f.group(M(0, -2.4, 1.62), () => f.hazard(-2.5, 2.5, -1.8, 1.8, 0.2, 5, HZ_A, HZ_B));
  f.cyl(1.4, 1.4, 3.4, 8, P.steelD, M(0, -2.4, 0, 0, 0, PI / 2));
  f.beam(0, -4.5, 0, 0, -7.4, 0, 1.3, 1.3, P.steelD, { seg: 6 });
  // the J: thick faceted curve in the XY plane
  const J = [[0, -7.2], [0.2, -9.4], [1.4, -11.4], [3.4, -12], [5.2, -11], [5.8, -9], [5.1, -7.6]];
  for (let i = 0; i < J.length - 1; i++) {
    const t = 1 - i / (J.length - 1) * 0.55;
    f.beam(J[i][0], J[i][1], 0, J[i + 1][0], J[i + 1][1], 0, 1.6 * t, 1.6 * t, i >= J.length - 3 ? P.org : P.off, { seg: 6 });
  }
}

function c4Weight(f: Facet): void {
  // phase-2 counterweight drop: striped block with a lifting eye
  f.box(7, 6, 7, P.navy, M(0, -4.5, 0), { ch: 0.7 });
  f.group(M(0, -4.5, 3.52), () => f.hazard(-3.2, 3.2, -1.2, 1.2, 0.2, 6, HZ_A, HZ_B));
  f.group(M(0, -4.5, -3.52, 0, PI), () => f.hazard(-3.2, 3.2, -1.2, 1.2, 0.2, 6, HZ_A, HZ_B));
  f.cyl(1.2, 1.2, 0.8, 8, P.steelD, M(0, -1.2, 0, 0, 0, PI / 2));
}

function unitCable(f: Facet): void {
  // unit-length cable along +Y (scaled per frame: x/z = thickness, y = length)
  f.cyl(0.5, 0.5, 1, 6, '#2d2a33', M(0, 0.5, 0), { top: null, bottom: null });
}

function buildCaisson(glowMul: number): BossRig {
  const root = new THREE.Group(); root.name = 'boss:caisson4';
  const body = new THREE.Group(); body.name = 'c4:body';
  body.position.set(0, C4.bodyY, 0);
  root.add(body);
  const groups: Record<string, FlashGroup> = {
    body: mkGroup(glowMul), cab: mkGroup(glowMul), boom: mkGroup(glowMul),
    legFL: mkGroup(glowMul), legFR: mkGroup(glowMul), legBL: mkGroup(glowMul), legBR: mkGroup(glowMul),
  };
  const meshes: THREE.Mesh[] = [];
  const bld = (fn: (f: Facet) => void) => { const f = new Facet(); f.jitter = 0.03; fn(f); return f.build(); };
  const add = (parent: THREE.Object3D, m: THREE.Mesh) => { parent.add(m); meshes.push(m); return m; };

  add(body, mkMesh(bld(c4Body), groups.body.mat, 'c4:gantry'));
  const drum = new THREE.Group(); drum.name = 'c4:drumJ'; drum.position.set(0, 8.2, 2.4); body.add(drum);
  add(drum, mkMesh(bld(c4Drum), groups.body.mat, 'c4:drum'));
  const cab = new THREE.Group(); cab.name = 'c4:cabJ'; cab.position.set(C4.cab[0], C4.cab[1], C4.cab[2]); body.add(cab);
  add(cab, mkMesh(bld(c4Cab), groups.cab.mat, 'c4:cab'));
  const boomYaw = new THREE.Group(); boomYaw.name = 'c4:boomYaw';
  boomYaw.position.set(C4.boomPivot[0], C4.boomPivot[1], C4.boomPivot[2]); body.add(boomYaw);
  const boomLuff = new THREE.Group(); boomLuff.name = 'c4:boomLuff'; boomYaw.add(boomLuff);
  add(boomLuff, mkMesh(bld(c4Boom), groups.boom.mat, 'c4:boom'));
  const trolley = new THREE.Group(); trolley.name = 'c4:trolleyJ'; boomLuff.add(trolley);
  add(trolley, mkMesh(bld(c4Trolley), groups.boom.mat, 'c4:trolley'));
  const tip = new THREE.Object3D(); tip.name = 'c4:tip'; tip.position.set(0, -2.6, C4.boomL + 2.2); boomLuff.add(tip);

  const upG = bld((f) => c4Upper(f, C4.L1)), loG = bld((f) => c4Lower(f, C4.L2)), ftG = bld(c4Foot);
  const names = ['legFL', 'legFR', 'legBL', 'legBR'];
  const offs = [0, 0.5, 0.75, 0.25];            // crawl: FL, BR, FR, BL
  const legs: LegRig[] = [];
  for (let i = 0; i < 4; i++) {
    const h = C4.hip[i], ft = C4.foot[i];
    const mat = groups[names[i]].mat;
    const upper = add(root, mkMesh(upG, mat, `c4:${names[i]}:upper`));
    const lower = add(root, mkMesh(loG, mat, `c4:${names[i]}:lower`));
    const foot = add(root, mkMesh(ftG, mat, `c4:${names[i]}:foot`));
    for (const m of [upper, lower, foot]) m.matrixAutoUpdate = false;
    const out = new THREE.Vector3(ft[0], 0, ft[2]).normalize();
    legs.push({
      name: names[i], hip: new THREE.Vector3(h[0], h[1], h[2]), rest: new THREE.Vector3(ft[0], ft[1], ft[2]),
      L1: C4.L1, L2: C4.L2, pole: new THREE.Vector3(out.x, 0.9, out.z).normalize(), off: offs[i],
      upper, lower, foot, flinch: 0,
    });
  }

  // hook, drops and cables live in the rig root's parent space (world) — see BossView.world
  const hookG = bld(c4Hook), wtG = bld(c4Weight), cabG = bld(unitCable);
  const joints: Record<string, THREE.Object3D> = { drum, cab, boomYaw, boomLuff, trolley, tip };
  const hook = mkMesh(hookG, groups.boom.mat, 'c4:hook');
  const w1 = mkMesh(wtG, groups.boom.mat, 'c4:weight1');
  const w2 = mkMesh(wtG, groups.boom.mat, 'c4:weight2');
  joints.hook = hook; joints.w1 = w1; joints.w2 = w2;
  for (let i = 0; i < 4; i++) {
    const c = mkMesh(cabG, groups.body.mat, `c4:cable${i}`, i === 0);
    c.matrixAutoUpdate = false;
    joints['cable' + i] = c;
  }
  return {
    id: 'caisson4', root, body, bodyY: C4.bodyY, legs, groups, groupKeys: Object.keys(groups), joints, meshes,
    stride: 16, duty: 0.75, liftH: 7, rMean: 38, walkSpeed: 6, footYawOut: true,
  };
}

// ─────────────────────────────── IRON GULLY ───────────────────────────────
const G = {
  pale: '#d4cfc1', paleS: '#aeb3b6', slate: '#7a8591', slateD: '#56606c', belly: '#c9c6bb',
  frost: '#f3f7fc', ice: '#c2e2f0', horn: '#39333f', hornL: '#58516a', eye: '#9fe8ff', throat: '#a4f2ff',
  rust: '#9c4a2c', rustL: '#bd6a3c', steel: '#8b95a0', steelD: '#5f6873', paint: '#e4dac2', rivet: '#2a2730',
  bone: '#e8dfc8',
} as const;

const GU = {
  bodyY: 32,
  hip: [[12.5, -3, 17], [-12.5, -3, 17], [11.5, -2, -19], [-11.5, -2, -19]] as const,
  foot: [[15.5, 3.2, 19], [-15.5, 3.2, 19], [14.5, 3.2, -20], [-14.5, 3.2, -20]] as const,
  L1: 15.5, L2: 14,
  neck: [0, 9, 22] as const, head: [0, -1.5, 6] as const, jaw: [0, -4.2, 1] as const,
  sail: [0, 13, -6] as const, headScale: 1.25, tail: [0, 5, -30] as const,
};

interface Sec { z: number; hw: number; hh: number; cy: number }
/** Loft along +Z through elliptical sections (via a loft along Y rotated +90° about X). */
function loftZ(f: Facet, secs: readonly Sec[], n: number, side: string | readonly string[],
  o: { top?: string | null; bottom?: string | null; face?: (band: number, seg: number) => string | undefined; glow?: number } = {},
  m?: THREE.Matrix4): void {
  const rot = PI / n;
  const rings = secs.map((s) => ({ y: s.z, pts: ngon(n, s.hw, s.hh, rot, 0, -s.cy) }));
  const base = M(0, 0, 0, PI / 2);
  f.loft(rings, { side, top: o.top, bottom: o.bottom, face: o.face, glow: o.glow }, m ? new THREE.Matrix4().multiplyMatrices(m, base) : base);
}

/** Hide colouring by facing, for n = 10 lofts: top pale, upper flank pale, lower flank slate, underside shadowed. */
function hide10(_band: number, seg: number): string {
  if (seg === 0 || seg === 8 || seg === 9) return G.belly;
  if (seg === 1 || seg === 7) return G.slate;
  return G.pale;
}
function hide8(_band: number, seg: number): string {
  if (seg === 0 || seg === 7) return G.belly;
  if (seg === 1 || seg === 6) return G.slate;
  return G.pale;
}

/** Tiny deterministic hash stream for the scrap sail (build-time only). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function guBody(f: Facet): void {
  const from = f.mark();
  loftZ(f, [
    { z: -31, hw: 5, hh: 5, cy: 5 },
    { z: -26, hw: 11, hh: 10.5, cy: 4 },
    { z: -16, hw: 14.5, hh: 13.5, cy: 3 },
    { z: -4, hw: 15.5, hh: 14.5, cy: 3.5 },
    { z: 8, hw: 16.5, hh: 16, cy: 5.5 },
    { z: 17, hw: 15.5, hh: 15.5, cy: 7 },
    { z: 24, hw: 12.5, hh: 12.5, cy: 6.5 },
    { z: 29, hw: 8, hh: 9, cy: 6 },
  ], 10, G.pale, { face: hide10 });
  // bony ridge knobs along the spine outside the sail (neck end + rump)
  // the ridge: a continuous bony keel down the spine (fore and aft of the sail) with knuckle lumps
  const keel: [number, number][] = [[29.5, 13.6], [25, 18.8], [19, 22.6], [13, 23.8], [-18, 18.8], [-24, 15], [-29, 10.2], [-31.5, 7.2]];
  for (let i = 0; i < keel.length - 1; i++) {
    if (i === 3) continue;                                   // the sail root carries the ridge here
    const [za, ya] = keel[i], [zb, yb] = keel[i + 1];
    f.beam(0, ya, za, 0, yb, zb, 2.6, 2.2, G.bone, { ch: 0.5, taper: 0.9 });
    f.box(3.4, 1.8, 2.6, G.bone, M(0, ya + 0.5, za, -0.2), { ch: 0.6, tw: 0.6, td: 0.7 });
  }
  // shoulder armour: scrap plates bolted into the hide (they match the sail)
  f.mirrorX(() => {
    f.box(0.8, 7, 9, G.rust, M(15.4, 12, 12, 0, 0.08, -0.35), { ch: 0.4 });
    f.box(0.8, 5.5, 7, G.steelD, M(15.9, 6, 4, 0, -0.1, -0.22), { ch: 0.4 });
    for (const [y, z] of [[14.6, 15.4], [14.6, 8.6], [9.4, 15.4], [9.4, 8.6]] as const) f.box(0.6, 0.6, 0.6, G.rivet, M(15.9, y, z, 0, 0, -0.35));
  });
  f.frost(from, G.ice, 0.3, 0.25, 11);
  f.frost(from, G.frost, 0.52, 0.6, 3);
}

function guNeck(f: Facet): void {
  const from = f.mark();
  loftZ(f, [
    { z: -4, hw: 9.8, hh: 9.5, cy: 0.5 },
    { z: 2, hw: 8.6, hh: 8.4, cy: 0 },
    { z: 7.5, hw: 7.2, hh: 7.4, cy: -1.5 },
  ], 10, G.pale, { face: hide10 });
  f.cyl(2.2, 0.2, 3.4, 5, G.bone, M(0, 8.4, 1, -0.4));
  f.frost(from, G.frost, 0.5, 0.55, 5);
}

function guHead(f: Facet): void {
  const from = f.mark();
  loftZ(f, [
    { z: -2.5, hw: 6.4, hh: 6.4, cy: 0.5 },
    { z: 2.5, hw: 7.3, hh: 6.9, cy: 0.6 },
    { z: 6.5, hw: 6.4, hh: 5.9, cy: 0.1 },
    { z: 9.5, hw: 4.8, hh: 4.4, cy: -0.6 },
  ], 8, G.pale, { face: hide8, bottom: G.slate });
  // upper beak: dark horn, hooked down at the tip
  loftZ(f, [
    { z: 8.6, hw: 4.5, hh: 3.6, cy: 0.1 },
    { z: 11.6, hw: 3.4, hh: 2.9, cy: -0.4 },
    { z: 14.2, hw: 1.9, hh: 2.1, cy: -1.5 },
    { z: 15.8, hw: 0.6, hh: 0.9, cy: -3.3 },
  ], 6, [G.hornL, G.horn, G.horn], { top: G.horn });
  f.mirrorX(() => f.box(0.5, 0.6, 1.4, G.rivet, M(1.5, 1.4, 12.2, -0.3)));           // nostril slits
  // eyes: dark socket + icy glowing lens, heavy brow ridge
  f.mirrorX(() => {
    f.box(1.4, 3.1, 3.4, G.horn, M(6.35, 1.7, 4.6, 0, 0.25), { ch: 0.4 });
    f.box(0.9, 1.5, 2.3, G.eye, M(6.9, 1.6, 4.8, 0, 0.25), { glow: 1, ch: 0.3 });
    f.beam(5.8, 4.4, 1.2, 6.9, 3.4, 7.8, 2.1, 1.7, G.bone, { ch: 0.4, taper: 0.7 });
    // swept crest horns
    f.beam(4.4, 4.6, 0.4, 7.4, 9.2, -8.6, 2.8, 2.4, G.bone, { taper: 0.25, ch: 0.5 });
  });
  // throat / breath chamber (only visible with the beak open)
  f.box(6.2, 1.2, 8.5, G.throat, M(0, -4.4, 6.6), { glow: 1 });
  f.frost(from, G.frost, 0.55, 0.6, 7);
}

function guJaw(f: Facet): void {
  loftZ(f, [
    { z: -0.5, hw: 5.2, hh: 2.3, cy: 0 },
    { z: 5.5, hw: 4.4, hh: 2.1, cy: -0.2 },
    { z: 10.5, hw: 2.6, hh: 1.5, cy: 0.3 },
    { z: 13.2, hw: 0.8, hh: 0.8, cy: 0.9 },
  ], 6, [G.horn, G.hornL, G.horn], { top: G.throat, bottom: G.slateD });
}

function guSail(f: Facet): void {
  // ONE continuous sail of riveted scrap: plates shingle-overlap in a gently waving surface
  // (relief head-on), a ragged top edge, raked bone spines poking through above it.
  const r = lcg(0x6a11);
  const H = (z: number) => 28 * Math.pow(Math.max(0, 1 - (z / 25.5) * (z / 25.5)), 0.75);
  const wave = (z: number) => 1.7 * Math.sin(z * 0.33 + 0.4);
  const plateCols = [G.rust, G.rustL, G.steel, G.steelD, G.paint, G.rust, P.navy, G.steel, G.rustL];
  const colW = 5.6, z0 = -22.4, nCols = 8;
  for (let c = 0; c < nCols; c++) {
    const zc = z0 + colW * (c + 0.5);
    const top = H(zc) + (r() - 0.35) * 2.2;
    let y = -1.5, k = 0;
    while (y < top - 0.6) {
      const ph = Math.min(6.2 + r() * 1.4, top - y + 1.2);
      const pw = colW + 1.1 + r() * 0.5;
      const col = plateCols[Math.floor(r() * plateCols.length)];
      const isTop = y + ph >= top - 0.6;
      const tilt = (r() - 0.5) * (isTop ? 0.2 : 0.06);
      const bend = isTop ? (r() - 0.5) * 0.35 : (r() - 0.5) * 0.05;
      const off = wave(zc) + (((c + k) & 1) ? 0.32 : -0.32);
      f.group(M(off, y + ph / 2, zc + (r() - 0.5) * 0.5, tilt, (r() - 0.5) * 0.06, bend), () => {
        f.box(0.9, ph, pw, col, undefined, { ch: 0.28 });
        if (col === G.paint) {
          f.group(M(0.46, 0, 0, 0, PI / 2), () => f.hazard(-pw * 0.42, pw * 0.42, -ph * 0.2, ph * 0.1, 0.08, 5, P.org, P.navyD));
          f.group(M(-0.46, 0, 0, 0, -PI / 2), () => f.hazard(-pw * 0.42, pw * 0.42, -ph * 0.2, ph * 0.1, 0.08, 5, P.org, P.navyD));
        }
        for (const sx of [0.47, -0.47]) for (const yy of [ph / 2 - 0.7, -ph / 2 + 0.7]) for (const zz of [pw / 2 - 0.7, 0, -pw / 2 + 0.7]) {
          f.box(0.3, 0.5, 0.5, G.rivet, M(sx, yy, zz));
        }
      });
      y += ph - 0.9;
      k++;
    }
  }
  // raked bone spines, each poking a few metres above the ragged edge
  for (let i = 0; i <= nCols; i += 1) {
    const z = z0 + colW * i;
    const h = H(z) + 2.2 + r() * 2.2;
    f.beam(wave(z), -3, z, wave(z) * 0.6, h, z - 2.2, 2.3, 2.3, G.bone, { taper: 0.22, ch: 0.45 });
  }
  // a riveted spar along the sail root ties it to the spine
  f.beam(wave(-20), 1.2, -23, wave(20), 1.2, 23, 1.6, 1.6, G.steelD);
  f.frost(0, G.frost, 0.62, 0.7, 9);
}

function guTail1(f: Facet): void {
  const from = f.mark();
  loftZ(f, [
    { z: 1, hw: 6.8, hh: 6.8, cy: 0 },
    { z: -7, hw: 5.6, hh: 5.3, cy: -1.2 },
    { z: -13.5, hw: 4.3, hh: 4.1, cy: -2.8 },
  ], 10, G.pale, { face: hide10 });
  for (const [z, y] of [[-2, 6.4], [-7.5, 4.9], [-12.5, 3.2]] as const) f.box(3, 1.1, 3.8, G.bone, M(0, y, z, -0.16), { ch: 0.5, tw: 0.7, td: 0.8 });
  f.frost(from, G.frost, 0.5, 0.55, 13);
}

function guTail2(f: Facet): void {
  const from = f.mark();
  loftZ(f, [
    { z: 0.5, hw: 4.3, hh: 4.1, cy: 0 },
    { z: -7, hw: 2.9, hh: 2.7, cy: -1.5 },
    { z: -14, hw: 0.8, hh: 0.9, cy: -3.4 },
  ], 10, G.pale, { face: hide10 });
  for (const [z, y] of [[-2.5, 3.6], [-8, 2.1]] as const) f.box(2.2, 0.9, 3, G.bone, M(0, y, z, -0.2), { ch: 0.4, tw: 0.7, td: 0.8 });
  f.frost(from, G.frost, 0.5, 0.5, 17);
}

function guUpper(f: Facet, L: number): void {
  // hip → knee along +Y (authored "down the leg"): heavy muscled column
  f.loft([
    { y: -1.5, pts: ngon(8, 5.4, 5.8, PI / 8) },
    { y: L * 0.35, pts: ngon(8, 4.9, 5.4, PI / 8) },
    { y: L * 0.8, pts: ngon(8, 3.9, 4.1, PI / 8) },
    { y: L, pts: ngon(8, 3.6, 3.8, PI / 8) },
  ], { side: [G.pale, G.paleS, G.slate], top: G.slate, bottom: G.pale });
  f.cyl(4.1, 4.1, 7.6, 8, G.slate, M(0, L, 0, 0, 0, PI / 2), { top: G.slateD, bottom: G.slateD });
}

function guLower(f: Facet, L: number): void {
  f.loft([
    { y: 0, pts: ngon(8, 3.7, 3.9, PI / 8) },
    { y: L * 0.55, pts: ngon(8, 3.2, 3.4, PI / 8) },
    { y: L * 0.78, pts: ngon(8, 3.3, 3.5, PI / 8) },
    { y: L * 0.86, pts: ngon(8, 3.6, 3.8, PI / 8) },
    { y: L, pts: ngon(8, 3.4, 3.6, PI / 8) },
  ], { side: [G.slate, G.slate, G.horn, G.slateD], top: G.slateD, bottom: G.slate });
}

function guPaw(f: Facet): void {
  // origin at the ankle; broad pad, three horn claws forward (+Z = body forward)
  f.loft([
    { y: -3.2, pts: rect(8.6, 9.6, 2.2, 0, 1.2) },
    { y: -1.4, pts: rect(9.4, 10.4, 2.4, 0, 1.2) },
    { y: 1.2, pts: rect(7, 7.6, 2, 0, 0.4) },
  ], { side: [G.slateD, G.slate], top: G.slate, bottom: G.slateD });
  for (const x of [-2.8, 0, 2.8]) f.beam(x, -1.2, 5.6, x * 1.1, -3.2, 8.6, 1.9, 1.7, G.horn, { taper: 0.2, ch: 0.3 });
  f.box(4, 0.8, 0.8, G.ice, M(0, 1.3, 3.2), { ch: 0.2 });
}

function buildGully(glowMul: number): BossRig {
  const root = new THREE.Group(); root.name = 'boss:irongully';
  const body = new THREE.Group(); body.name = 'gu:body';
  body.position.set(0, GU.bodyY, 0);
  root.add(body);
  const groups: Record<string, FlashGroup> = {
    body: mkGroup(glowMul), head: mkGroup(glowMul * 1.2), sail: mkGroup(glowMul),
    legFL: mkGroup(glowMul), legFR: mkGroup(glowMul), legBL: mkGroup(glowMul), legBR: mkGroup(glowMul),
  };
  const meshes: THREE.Mesh[] = [];
  const bld = (fn: (f: Facet) => void) => { const f = new Facet(); f.jitter = 0.04; fn(f); return f.build(); };
  const add = (parent: THREE.Object3D, m: THREE.Mesh) => { parent.add(m); meshes.push(m); return m; };
  const joint = (parent: THREE.Object3D, name: string, p: readonly number[]) => {
    const j = new THREE.Group(); j.name = name; j.position.set(p[0], p[1], p[2]); parent.add(j); return j;
  };

  add(body, mkMesh(bld(guBody), groups.body.mat, 'gu:torso'));
  const neck = joint(body, 'gu:neck', GU.neck);
  add(neck, mkMesh(bld(guNeck), groups.body.mat, 'gu:neckM'));
  const head = joint(neck, 'gu:head', GU.head);
  head.scale.setScalar(GU.headScale);
  add(head, mkMesh(bld(guHead), groups.head.mat, 'gu:headM'));
  const jaw = joint(head, 'gu:jaw', GU.jaw);
  add(jaw, mkMesh(bld(guJaw), groups.head.mat, 'gu:jawM'));
  const sail = joint(body, 'gu:sail', GU.sail);
  add(sail, mkMesh(bld(guSail), groups.sail.mat, 'gu:sailM'));
  const tail1 = joint(body, 'gu:tail1', GU.tail);
  add(tail1, mkMesh(bld(guTail1), groups.body.mat, 'gu:tail1M'));
  const tail2 = joint(tail1, 'gu:tail2', [0, -2.8, -13]);
  add(tail2, mkMesh(bld(guTail2), groups.body.mat, 'gu:tail2M'));

  const upG = bld((f) => guUpper(f, GU.L1)), loG = bld((f) => guLower(f, GU.L2)), ftG = bld(guPaw);
  const names = ['legFL', 'legFR', 'legBL', 'legBR'];
  const offs = [0, 0.5, 0.75, 0.25];            // lateral-sequence walk: LF, RH, RF, LH
  const legs: LegRig[] = [];
  for (let i = 0; i < 4; i++) {
    const h = GU.hip[i], ft = GU.foot[i];
    const mat = groups[names[i]].mat;
    const upper = add(root, mkMesh(upG, mat, `gu:${names[i]}:upper`));
    const lower = add(root, mkMesh(loG, mat, `gu:${names[i]}:lower`));
    const foot = add(root, mkMesh(ftG, mat, `gu:${names[i]}:paw`));
    for (const m of [upper, lower, foot]) m.matrixAutoUpdate = false;
    const front = i < 2;
    legs.push({
      name: names[i], hip: new THREE.Vector3(h[0], h[1], h[2]), rest: new THREE.Vector3(ft[0], ft[1], ft[2]),
      L1: GU.L1, L2: GU.L2,
      // front elbows fold back, hind knees fold forward (a quadruped, not a biped)
      pole: new THREE.Vector3(Math.sign(h[0]) * 0.25, 0, front ? -1 : 1).normalize(), off: offs[i],
      upper, lower, foot, flinch: 0,
    });
  }
  const joints: Record<string, THREE.Object3D> = { neck, head, jaw, sail, tail1, tail2 };
  return {
    id: 'irongully', root, body, bodyY: GU.bodyY, legs, groups, groupKeys: Object.keys(groups), joints, meshes,
    stride: 30, duty: 0.62, liftH: 6, rMean: 24, walkSpeed: 9, footYawOut: false,
  };
}

// ─────────────────────────────── pose record ───────────────────────────────
interface Pose {
  dy: number; pitch: number; roll: number; twist: number;          // body joint
  luff: number; byaw: number; trolley: number; cabPitch: number; drum: number;   // CAISSON-4
  neck: number; neckYaw: number; head: number; jaw: number;        // IRON GULLY
  sailRise: number; sailShake: number; sailTilt: number; tail: number;
  glow: number;                                                     // face lamps / eyes+throat multiplier
  dim: number;                                                      // 1 = all lamps on, 0 = dead
}
function newPose(): Pose {
  return {
    dy: 0, pitch: 0, roll: 0, twist: 0, luff: C4.boomRest, byaw: 0, trolley: 30, cabPitch: 0, drum: 0,
    neck: 0, neckYaw: 0, head: 0, jaw: 0.04, sailRise: 0, sailShake: 0, sailTilt: 0, tail: 0, glow: 1, dim: 1,
  };
}
const REST: Pose = newPose();
/** smoothing factor handed to smoothPose through a record (a double call argument would be boxed) */
const SM = { k: 0.5 };

/** dst ← src, field by field (named stores: no megamorphic keyed access, no boxed doubles). */
function copyPose(d: Pose, s: Pose): void {
  d.dy = s.dy;
  d.pitch = s.pitch;
  d.roll = s.roll;
  d.twist = s.twist;
  d.luff = s.luff;
  d.byaw = s.byaw;
  d.trolley = s.trolley;
  d.cabPitch = s.cabPitch;
  d.drum = s.drum;
  d.neck = s.neck;
  d.neckYaw = s.neckYaw;
  d.head = s.head;
  d.jaw = s.jaw;
  d.sailRise = s.sailRise;
  d.sailShake = s.sailShake;
  d.sailTilt = s.sailTilt;
  d.tail = s.tail;
  d.glow = s.glow;
  d.dim = s.dim;
}
/** c += (t − c)·k per field. */
function smoothPose(c: Pose, t: Pose, k: number): void {
  c.dy += (t.dy - c.dy) * k;
  c.pitch += (t.pitch - c.pitch) * k;
  c.roll += (t.roll - c.roll) * k;
  c.twist += (t.twist - c.twist) * k;
  c.luff += (t.luff - c.luff) * k;
  c.byaw += (t.byaw - c.byaw) * k;
  c.trolley += (t.trolley - c.trolley) * k;
  c.cabPitch += (t.cabPitch - c.cabPitch) * k;
  c.drum += (t.drum - c.drum) * k;
  c.neck += (t.neck - c.neck) * k;
  c.neckYaw += (t.neckYaw - c.neckYaw) * k;
  c.head += (t.head - c.head) * k;
  c.jaw += (t.jaw - c.jaw) * k;
  c.sailRise += (t.sailRise - c.sailRise) * k;
  c.sailShake += (t.sailShake - c.sailShake) * k;
  c.sailTilt += (t.sailTilt - c.sailTilt) * k;
  c.tail += (t.tail - c.tail) * k;
  c.glow += (t.glow - c.glow) * k;
  c.dim += (t.dim - c.dim) * k;
}

const e3 = easeOutCubic;
/** 0→1→0 bump over [a, b]. */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * PI));
/** hash flicker 0..1 */
const flick = (t: number) => { const v = Math.sin(t * 91.7) * Math.sin(t * 37.3 + 1.7); return 0.5 + 0.5 * v; };

const C4_PLAIN = ['body', 'boom', 'legFL', 'legFR', 'legBL', 'legBR'] as const;
const GU_PLAIN = ['body', 'sail', 'legFL', 'legFR', 'legBL', 'legBR'] as const;
const HOOK_HANG = 20;           // m of cable under the boom tip at rest
const CABLE_T = 1.1;            // cable thickness (m) — the 3 px hull carries it at Size V zoom

export class BossView implements ViewModule {
  private ctx: ViewCtx;
  private world = new THREE.Group();
  private rigs: Partial<Record<BossId, BossRig>> = {};
  private active: BossRig | null = null;
  private glowMul = 1;
  private mounted = false;
  private time = 0;
  private gait = newGait();
  private cur = newPose();
  private tgt = newPose();
  private curX: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private tgtX: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private deadT = -1;
  private roarT = 0;
  private drumA = 0;
  private attackKey = '';
  private tw = new Map<string, number>();
  private hookPos = new THREE.Vector3();
  private hookVel = new THREE.Vector3();
  private hookInit = false;
  private drops: (THREE.Vector3 | null)[] = [null, null, null];
  private dropBuf = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private dropIds = [0.5, 0.5, 0.5];
  /** per-frame doubles shared by the pose helpers (fields, not call args — see GS) */
  private tA = 0.5;
  private tS = 0.5;
  private wv = 0.5;
  private mk = 0.5;
  private fa = 0.5;
  private fdt = 0.5;

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.world.name = 'bosses';
  }

  private rig(id: BossId): BossRig {
    let r = this.rigs[id];
    if (!r) {
      r = id === 'caisson4' ? buildCaisson(this.glowMul) : buildGully(this.glowMul);
      r.root.visible = false;
      this.world.add(r.root);
      if (id === 'caisson4') for (const k of ['hook', 'w1', 'w2', 'cable0', 'cable1', 'cable2', 'cable3']) {
        const o = r.joints[k]; o.visible = false; this.world.add(o);
      }
      this.rigs[id] = r;
    }
    return r;
  }

  private show(r: BossRig | null): void {
    for (const id of ['caisson4', 'irongully'] as const) {
      const x = this.rigs[id];
      if (!x) continue;
      const on = x === r;
      x.root.visible = on;
      if (id === 'caisson4') {
        x.joints.hook.visible = on;
        x.joints.cable0.visible = on;
        if (!on) for (const k of ['w1', 'w2', 'cable1', 'cable2', 'cable3']) x.joints[k].visible = false;
      }
    }
    this.active = r;
  }

  mount(w: World): void {
    if (!this.mounted) { this.ctx.scene.add(this.world); this.mounted = true; }
    const time = BIOMES[w.biomeId]?.time ?? 'day';
    this.glowMul = time === 'night' ? 1.6 : time === 'overcast' ? 1.15 : 1.0;
    for (const id of ['caisson4', 'irongully'] as const) {
      const r = this.rig(id);          // build both once: warmup compiles every boss program up front
      for (const k in r.groups) { const g = r.groups[k]; g.glowBase = k === 'head' ? this.glowMul * 1.2 : this.glowMul; g.flash = 0; }
    }
    this.resetRun();
    this.show(null);
  }

  unmount(): void {
    this.show(null);
    if (this.mounted) { this.ctx.scene.remove(this.world); this.mounted = false; }
    this.resetRun();
  }

  /** Release GPU resources (page teardown; not part of the per-run cycle). */
  dispose(): void {
    this.unmount();
    for (const id of ['caisson4', 'irongully'] as const) {
      const r = this.rigs[id];
      if (!r) continue;
      const geos = new Set<THREE.BufferGeometry>();
      for (const m of r.meshes) geos.add(m.geometry);
      for (const k in r.joints) { const o = r.joints[k] as THREE.Mesh; if (o.isMesh) geos.add(o.geometry); }
      for (const g of geos) g.dispose();
      for (const k in r.groups) r.groups[k].mat.dispose();
      delete this.rigs[id];
    }
  }

  private resetRun(): void {
    this.gait = newGait();
    copyPose(this.cur, REST);
    copyPose(this.tgt, REST);
    for (let i = 0; i < 4; i++) { this.curX[i].set(0, 0, 0); this.tgtX[i].set(0, 0, 0); }
    this.deadT = -1; this.roarT = 0; this.drumA = 0; this.attackKey = ''; this.tw.clear();
    this.hookInit = false; this.hookVel.set(0, 0, 0);
    this.drops[0] = this.drops[1] = this.drops[2] = null;
  }

  // ─────────────────────────────── frame ───────────────────────────────
  update(w: World, f: FrameInfo): void {
    const dt = Math.max(1e-4, Math.min(0.1, f.dt));
    this.time += dt;
    const b = w.boss;
    if (!b) { if (this.active) this.show(null); return; }
    const r = this.rig(b.id);
    if (this.active !== r) { this.show(r); this.resetRun(); }

    // events: part flashes, phase roar, (re)spawn
    const cap = this.ctx.quality.reduceFlashing ? 0.35 : 0.85;
    for (let i = 0; i < f.events.length; i++) {
      const ev = f.events[i];
      if (ev.type === 'bossHit') {
        const g = r.groups[ev.part] ?? r.groups.body;
        g.flash = 1;
        if (ev.part.startsWith('leg')) for (const L of r.legs) if (L.name === ev.part) L.flinch = 0.3;
      } else if (ev.type === 'bossPhase') this.roarT = 1.6;
      else if (ev.type === 'bossSpawn') { this.resetRun(); }
    }
    for (let gi = 0; gi < r.groupKeys.length; gi++) {
      const g = r.groups[r.groupKeys[gi]];
      g.flash = Math.max(0, g.flash - dt / 0.16);
      g.mat.userData.bt.uFlash.value = Math.min(cap, g.flash * 0.85);
    }
    for (const L of r.legs) L.flinch = Math.max(0, L.flinch - dt);
    if (b.alive) this.deadT = -1; else this.deadT = this.deadT < 0 ? 0 : this.deadT + dt;
    this.roarT = Math.max(0, this.roarT - dt);

    // interpolated pose
    const a = clamp(f.alpha, 0, 1);
    const x = b.px + (b.x - b.px) * a;
    const z = b.pz + (b.z - b.pz) * a;
    const h = b.pheading + wrapAngle(b.heading - b.pheading) * a;
    r.root.position.set(x, 0, z);
    r.root.rotation.set(0, h, 0);
    GS.x = x; GS.z = z; GS.h = h; GS.dt = dt;
    stepGait(this.gait, r);
    const mkr = this.gait.pace / (0.35 * r.walkSpeed);
    this.mk = mkr < 0 ? 0 : mkr > 1 ? 1 : mkr;
    this.fa = a; this.fdt = dt;

    // attack instance key → reset cached windups
    this.tA = b.attack ? b.attackT + (f.frozen ? 0 : a * SIM_DT) : 0;
    const key = b.attack ?? '';
    if (key !== this.attackKey || (b.attack && this.tA < 0.05)) { this.attackKey = key; this.tw.clear(); }

    // targets (rest → attack/state overrides), then smooth
    const t = this.tgt;
    copyPose(t, REST);
    for (let i = 0; i < 4; i++) this.tgtX[i].set(0, 0, 0);
    if (b.id === 'caisson4') this.poseCaisson(w, b, r); else this.poseGully(w, b, r);
    const k = 1 - Math.exp(-dt * (this.deadT >= 0 ? 3 : 11));
    SM.k = k;
    smoothPose(this.cur, t, SM.k);
    for (let i = 0; i < 4; i++) this.curX[i].lerp(this.tgtX[i], k);

    this.applyPose(r);
    if (b.id === 'caisson4') this.updateHook(w, b, r);
  }

  // ─────────────────────────────── windup lookup ───────────────────────────────
  /** Windup (s) of the live, unfired boss telegraph `tag` (cached for this attack), else the fallback. */
  private windup(w: World, b: BossState, tag: string, base: number, scaled = true): number {
    for (let i = 0; i < w.telegraphs.length; i++) {
      const tg = w.telegraphs[i];
      if (tg.alive && !tg.fired && tg.owner === 'boss' && tg.tag === tag) { this.tw.set(tag, tg.windup); this.wv = tg.windup; return this.wv; }
    }
    const c = this.tw.get(tag);
    this.wv = c !== undefined ? c : base * (scaled ? (WINDUP_MUL_FALLBACK[b.phase] ?? 1) : 1);
    return this.wv;
  }

  // ─────────────────────────────── CAISSON-4 poses ───────────────────────────────
  private poseCaisson(w: World, b: BossState, r: BossRig): void {
    const t = this.tgt, X = this.tgtX, time = this.time, tA = this.tA;
    const mk = this.mk;
    const ph = this.gait.phase * PI * 2;
    // idle / walk: crawl bob, boom breathing, trolley parked mid-boom
    t.dy = -0.7 * mk * (0.5 + 0.5 * Math.cos(ph * 4)) + Math.sin(time * 0.9) * 0.25;
    t.roll = Math.sin(ph) * 0.02 * mk;
    t.pitch = Math.sin(ph * 2) * 0.012 * mk;
    t.luff = C4.boomRest + Math.sin(time * 0.7) * 0.025;
    t.byaw = Math.sin(time * 0.37) * 0.05;
    t.trolley = 30 + Math.sin(time * 0.3) * 4;
    t.cabPitch = Math.sin(time * 0.8 + 1) * 0.03;
    t.drum = 0;

    if (this.deadT >= 0) {
      const kd = easeInCubic(clamp(this.deadT / 2.6, 0, 1));
      t.dy = -30 * kd; t.roll = 0.3 * kd; t.pitch = 0.14 * kd; t.luff = C4.boomRest - 0.85 * kd; t.byaw = 0.2 * kd;
      t.cabPitch = 0.35 * kd; t.trolley = 12;
      t.dim = this.deadT < 1.2 ? flick(time) * (1 - this.deadT / 1.2) : 0;
      t.glow = 1;
      for (let i = 0; i < 4; i++) { const L = r.legs[i]; X[i].set(Math.sign(L.rest.x) * 10 * kd, 0, Math.sign(L.rest.z) * 9 * kd); }
      return;
    }
    if (b.staggerT > 0) {
      const s = smoothstep(0, 0.5, 5 - b.staggerT) * smoothstep(0, 0.6, b.staggerT);
      t.dy = -9 * s; t.roll = (0.06 + Math.sin(time * 1.3) * 0.04) * s; t.pitch = 0.06 * s;
      t.luff = C4.boomRest - 0.42 * s; t.trolley = 18; t.cabPitch = 0.26 * s;
      t.glow = lerp(1, 0.25 + 0.75 * flick(time), s);
      for (let i = 0; i < 4; i++) { const L = r.legs[i]; X[i].set(Math.sign(L.rest.x) * 3.5 * s, 0, Math.sign(L.rest.z) * 3 * s); }
      return;
    }
    if (b.introT > 0 || this.roarT > 0) {
      const rt = b.introT > 0 ? (b.introT < 1.5 ? bump(1.5 - b.introT, 0, 1.5) : 0) : bump(1.6 - this.roarT, 0, 1.6);
      t.cabPitch -= 0.3 * rt; t.luff += 0.26 * rt; t.glow = 1 + 3 * rt; t.pitch -= 0.05 * rt; t.dy += 2 * rt;
    }

    switch (b.attack) {
      case 'hookLane': {
        const W = this.windup(w, b, 'hookLane', 1.8);
        const tc = tA - (b.data.laneAt ?? 0);
        if (tc < W) {
          const p = e3(clamp(tc / W, 0, 1));
          t.luff = C4.boomRest + 0.24 * p; t.byaw = -0.1 * p; t.trolley = lerp(30, 9, p);
          t.pitch = -0.05 * p; t.cabPitch = -0.14 * p; t.glow = 1 + 2.6 * p; t.drum = 1.5;
        } else {
          const q = tc - W;
          const whip = Math.exp(-q * 4);
          t.luff = C4.boomRest - 0.1 * whip; t.byaw = 0.08 * whip; t.trolley = 44;
          t.pitch = 0.06 * whip; t.cabPitch = 0.05 * whip; t.glow = 1 + 2.5 * whip; t.drum = -4 * whip;
        }
        break;
      }
      case 'hookDrop': {
        const W = 1.5 * (WINDUP_MUL_FALLBACK[b.phase] ?? 1);
        const p = e3(clamp(tA / W, 0, 1));
        t.luff = C4.boomRest - 0.16 * p; t.trolley = lerp(30, 44, p); t.cabPitch = 0.12 * p;
        t.glow = 1 + 2 * p; t.drum = tA < W ? 3 : -3;
        break;
      }
      case 'winchLeash': {
        const W = this.windup(w, b, 'winch', 2.2, false);
        const hooked = (b.data.leash ?? 0) > 0 && !!w.titan.leash;
        if (hooked) {
          t.pitch = -0.1; t.dy = -2.5; t.luff = C4.boomRest + 0.14; t.trolley = 36; t.drum = -9;
          t.cabPitch = -0.08; t.glow = 2.6 + 0.6 * Math.sin(time * 12);
          for (let i = 0; i < 4; i++) { const L = r.legs[i]; X[i].set(Math.sign(L.rest.x) * 3, 0, Math.sign(L.rest.z) * 3); }
        } else {
          const p = e3(clamp(tA / W, 0, 1));
          t.luff = C4.boomRest + 0.08 * p; t.trolley = 40; t.drum = 2 + 3 * p; t.glow = 1 + 1.6 * p; t.cabPitch = 0.06 * p;
        }
        break;
      }
      case 'boomSweep': {
        const W = this.windup(w, b, 'boomSweep', 1.6);
        if (tA < W) {
          const p = e3(clamp(tA / W, 0, 1));
          t.byaw = -0.5 * p; t.luff = C4.boomRest - 0.2 * p; t.trolley = 44; t.roll = 0.05 * p; t.glow = 1 + 2.2 * p;
        } else {
          const q = tA - W;
          const s = e3(clamp(q / 0.35, 0, 1));
          t.byaw = lerp(-0.5, 0.55, s) * Math.exp(-Math.max(0, q - 0.35) * 2.5);
          t.luff = C4.boomRest - 0.2 * Math.exp(-q * 2); t.trolley = 44; t.roll = -0.06 * Math.exp(-q * 3); t.glow = 1 + 2 * Math.exp(-q * 3);
        }
        break;
      }
      case 'legStomp': {
        const W = this.windup(w, b, 'legStomp', 1.2);
        if (tA < W) {
          const p = e3(clamp(tA / W, 0, 1));
          t.dy = 7 * p; t.pitch = -0.09 * p; t.cabPitch = -0.12 * p; t.glow = 1 + 2.4 * p; t.luff = C4.boomRest + 0.1 * p;
          X[0].set(1.5 * p, 11 * p, 4 * p); X[1].set(-1.5 * p, 11 * p, 4 * p);
        } else {
          const q = tA - W;
          const slam = q < 0.1 ? q / 0.1 : Math.exp(-(q - 0.1) * 3);
          t.dy = -4.5 * slam; t.pitch = 0.07 * slam; t.cabPitch = 0.1 * slam; t.glow = 1 + 2 * slam;
          t.luff = C4.boomRest - 0.12 * slam;
        }
        break;
      }
    }
    // struck-leg flinch: the pad jerks up and the body dips toward it
    for (let i = 0; i < 4; i++) {
      const L = r.legs[i];
      if (L.flinch > 0) { const s = Math.sin((L.flinch / 0.3) * PI); X[i].y += 2.5 * s; t.roll -= Math.sign(L.rest.x) * 0.015 * s; }
    }
  }

  // ─────────────────────────────── IRON GULLY poses ───────────────────────────────
  private poseGully(w: World, b: BossState, r: BossRig): void {
    const t = this.tgt, X = this.tgtX, time = this.time, tA = this.tA;
    const mk = this.mk;
    const ph = this.gait.phase * PI * 2;
    const charging = (b.data.charge ?? 0) > 0;
    // idle / walk: heavy bob, shoulder roll, head bob against the gait, tail sway, breathing
    t.dy = -1.3 * mk * Math.abs(Math.sin(ph * 2)) + Math.sin(time * 0.8) * 0.45;
    t.roll = Math.sin(ph) * 0.035 * mk;
    t.twist = Math.sin(ph) * 0.03 * mk;
    t.neck = 0.06 * Math.sin(ph * 2 + 0.6) * mk + Math.sin(time * 0.8 + 0.4) * 0.03;
    t.neckYaw = Math.sin(time * 0.33) * 0.12 * (1 - mk);
    t.head = -0.04 * Math.sin(ph * 2) * mk;
    t.jaw = 0.04 + 0.03 * Math.max(0, Math.sin(time * 0.8));
    t.tail = Math.sin(ph + 1.2) * 0.2 * mk + Math.sin(time * 0.6) * 0.08;
    t.sailShake = 0; t.sailRise = 0; t.sailTilt = Math.sin(ph) * 0.02 * mk;

    if (this.deadT >= 0) {
      const kd = easeInCubic(clamp(this.deadT / 3, 0, 1));
      t.dy = -21 * kd; t.roll = 0.44 * kd; t.pitch = 0.12 * kd; t.neck = 0.62 * kd; t.head = 0.25 * kd; t.jaw = 0.42 * kd;
      t.sailTilt = 0.22 * kd; t.tail = 0.3 * kd; t.neckYaw = 0.25 * kd;
      t.dim = this.deadT < 1.4 ? flick(time) * (1 - this.deadT / 1.4) : 0;
      for (let i = 0; i < 4; i++) { const L = r.legs[i]; X[i].set(Math.sign(L.rest.x) * 8 * kd, 0, Math.sign(L.rest.z) * 3 * kd); }
      return;
    }
    if (b.staggerT > 0) {
      const s = smoothstep(0, 0.5, 5 - b.staggerT) * smoothstep(0, 0.6, b.staggerT);
      t.dy = -9 * s; t.pitch = 0.1 * s; t.roll = Math.sin(time * 1.1) * 0.07 * s;
      t.neck = 0.55 * s; t.head = 0.2 * s; t.jaw = 0.22 + 0.08 * Math.sin(time * 5);
      t.sailTilt = 0.14 * s; t.sailShake = 0.02 * s; t.glow = lerp(1, 0.3 + 0.7 * flick(time), s);
      for (let i = 0; i < 4; i++) { const L = r.legs[i]; X[i].set(Math.sign(L.rest.x) * 3 * s, 0, 0); }
      return;
    }
    if (b.introT > 0 || this.roarT > 0) {
      const rt = b.introT > 0 ? (b.introT < 1.6 ? bump(1.6 - b.introT, 0, 1.6) : 0) : bump(1.6 - this.roarT, 0, 1.6);
      t.neck -= 0.42 * rt; t.head -= 0.2 * rt; t.jaw = Math.max(t.jaw, 0.8 * rt); t.glow = 1 + 2.5 * rt;
      t.neckYaw += Math.sin(time * 9) * 0.06 * rt; t.sailShake = Math.max(t.sailShake, 0.03 * rt);
    }

    switch (b.attack) {
      case 'coneBreath': this.gullyBreath(w, b); break;
      case 'pawSlam': this.tS = tA; this.gullySlam(w, b); break;
      case 'breathSlam': {
        const slamAt = b.data.slamAt;
        if ((b.data.combo ?? 0) > 0 && slamAt !== undefined && tA >= slamAt) { this.tS = tA - slamAt; this.gullySlam(w, b); }
        else this.gullyBreath(w, b);
        break;
      }
      case 'plateVolley': {
        const launch = bump(tA, 0, 0.55);
        const rattle = Math.exp(-tA * 1.4);
        t.sailRise = 4.5 * launch; t.sailShake = 0.05 * rattle; t.dy = -2.2 * launch; t.pitch = 0.05 * launch;
        t.neck = 0.12 * launch; t.head = -0.25 * rattle; t.jaw = 0.3 * launch; t.glow = 1 + 1.2 * rattle;
        break;
      }
      case 'ridgeCharge': {
        const W = this.windup(w, b, 'ridgeCharge', 1.5, false);
        if (tA < W && !charging) {
          const p = e3(clamp(tA / W, 0, 1));
          t.neck = 0.36 * p; t.head = 0.1 * p; t.pitch = 0.12 * p; t.dy = -2.8 * p; t.sailTilt = 0; t.jaw = 0.15 * p;
          t.glow = 1 + 1.6 * p; t.tail = 0.25 * Math.sin(time * 6) * p;
          const sc = Math.sin(clamp(tA / W, 0, 1) * PI * 5);          // front paw scrapes the snow
          X[0].set(0, 1.6 * Math.abs(sc) * p, -4 * sc * p);
        } else if (charging) {
          t.neck = 0.3; t.head = 0.08; t.pitch = 0.08; t.jaw = 0.3; t.glow = 2.2; t.tail = 0.12 * Math.sin(time * 10);
          t.dy += -1.2 * Math.abs(Math.sin(ph * 2));
        } else {
          const q = Math.max(0, tA - (b.data.chargeEnd ?? tA));
          const skid = Math.exp(-q * 2.5);
          t.pitch = -0.1 * skid; t.neck = 0.15 * skid; t.neckYaw = Math.sin(time * 9) * 0.16 * skid; t.jaw = 0.25 * skid;
        }
        break;
      }
    }
    for (let i = 0; i < 4; i++) {
      const L = r.legs[i];
      if (L.flinch > 0) { const s = Math.sin((L.flinch / 0.3) * PI); X[i].y += 2 * s; t.dy -= 0.6 * s; }
    }
  }

  private gullyBreath(w: World, b: BossState): void {
    const t = this.tgt, time = this.time, tA = this.tA;
    const W = this.windup(w, b, 'coneBreath', 1.8);
    const act = 1.2;
    if (tA < W) {
      const p = e3(clamp(tA / W, 0, 1));
      t.neck = -0.34 * p; t.head = -0.16 * p; t.jaw = 0.12 + 0.28 * p; t.dy = 1.6 * p; t.pitch = -0.06 * p;
      t.glow = 1 + 3.2 * p; t.sailShake = 0.012 * p;
    } else if (tA < W + act) {
      const q = tA - W;
      const thrust = e3(clamp(q / 0.2, 0, 1));
      t.neck = lerp(-0.34, 0.2, thrust); t.head = lerp(-0.16, 0.06, thrust); t.jaw = 0.8; t.pitch = 0.05 * thrust;
      t.glow = 4 + 0.8 * flick(time); t.neckYaw = Math.sin(time * 17) * 0.025; t.dy = 0.5;
    } else {
      const q = tA - W - act;
      const c = Math.exp(-q * 3);
      t.neck = 0.2 * c; t.jaw = 0.1 + 0.6 * c; t.glow = 1 + 2 * c;
    }
  }

  private gullySlam(w: World, b: BossState): void {
    const t = this.tgt, X = this.tgtX, tS = this.tS;
    const W = this.windup(w, b, 'pawSlamInner', 1.3);
    const gap = 0.5;
    if (tS < W) {
      const p = e3(clamp(tS / W, 0, 1));
      t.pitch = -0.44 * p; t.dy = 6.5 * p; t.neck = -0.3 * p; t.head = -0.12 * p; t.jaw = 0.45 * p; t.glow = 1 + 1.5 * p;
      t.tail = -0.25 * p;
      X[0].set(1.2 * p, 19 * p, 7 * p); X[1].set(-1.2 * p, 19 * p, 7 * p);
      X[2].set(0, 0, 3 * p); X[3].set(0, 0, 3 * p);                // hind paws brace forward under the weight
    } else {
      const q = tS - W;
      const slam = q < 0.1 ? 1 - q / 0.1 * 0.2 : Math.exp(-(q - 0.1) * 3) * 0.8;
      const second = bump(q, gap - 0.05, gap + 0.35);
      t.pitch = 0.09 * slam - 0.02 * second; t.dy = -3.2 * slam - 2.2 * second; t.neck = 0.18 * slam + 0.22 * second;
      t.jaw = 0.2 + 0.5 * second; t.glow = 1 + 1.8 * second; t.sailShake = 0.04 * Math.max(slam, second);
      X[0].set(0, 0, 2 * slam); X[1].set(0, 0, 2 * slam);
    }
  }

  // ─────────────────────────────── apply ───────────────────────────────
  private applyPose(r: BossRig): void {
    const c = this.cur, time = this.time, dt = this.fdt;
    r.body.position.set(0, r.bodyY + c.dy, 0);
    r.body.rotation.set(c.pitch, c.twist, c.roll, 'YXZ');
    const J = r.joints;
    const dimK = clamp(c.dim, 0, 1);
    if (r.id === 'caisson4') {
      this.applyCrane(r);
    } else {
      J.neck.rotation.set(c.neck, c.neckYaw, 0, 'YXZ');
      J.head.rotation.set(c.head, 0, 0);
      J.jaw.rotation.set(clamp(c.jaw, 0, 0.9), 0, 0);
      const shake = c.sailShake;
      J.sail.position.set(0, GU.sail[1] + c.sailRise, GU.sail[2]);
      J.sail.rotation.set(Math.sin(time * 21) * shake * 0.5, 0, c.sailTilt + Math.sin(time * 17.3) * shake);
      J.tail1.rotation.set(0.05 + Math.abs(c.tail) * 0.1, c.tail, 0, 'YXZ');
      J.tail2.rotation.set(0.1, c.tail * 1.4, 0, 'YXZ');
      const gh = r.groups.head;
      gh.mat.userData.bt.uGlowMul.value = gh.glowBase * Math.max(0, c.glow) * dimK;
      for (const k of GU_PLAIN) r.groups[k].mat.userData.bt.uGlowMul.value = r.groups[k].glowBase * dimK;
    }
    r.body.updateMatrix();

    // legs: gait foot targets + pose extras → two-bone IK in root space
    const g = this.gait;
    GS.mk = this.deadT >= 0 ? 0 : this.mk;
    for (let i = 0; i < r.legs.length; i++) {
      const L = r.legs[i];
      _hip.copy(L.hip).applyMatrix4(r.body.matrix);
      footOffset(g, L, r, _v3);
      const liftFrac = r.liftH > 0 ? _v3.y / r.liftH : 0;
      _foot.copy(L.rest).add(_v3).add(this.curX[i]);
      if (r.footYawOut) {
        // crane: knee rides outward + up over the pad
        let px = _foot.x - _hip.x, pz = _foot.z - _hip.z;
        let pl = px * px + pz * pz;
        if (pl < 1e-6) { px = L.rest.x; pz = L.rest.z; pl = px * px + pz * pz; }
        pl = 1 / Math.sqrt(pl);
        const n2 = 1 / Math.sqrt(1 + 1.6 * 1.6);
        _v2.set(px * pl * n2, 1.6 * n2, pz * pl * n2);
      } else _v2.copy(L.pole);
      solveLeg(_hip, _foot, L, _v2, _knee, _foot);   // Fo may alias F (read before write)
      segMatrix(_hip, _knee, _v2, L.upper.matrix);
      segMatrix(_knee, _foot, _v2, L.lower.matrix);
      const yaw = r.footYawOut ? Math.atan2(L.rest.x, L.rest.z) : 0;
      _q.setFromEuler(_e.set(r.footYawOut ? 0 : liftFrac * 0.35, yaw, 0, 'YXZ'));
      L.foot.matrix.compose(_foot, _q, _s.set(1, 1, 1));
      L.upper.matrixWorldNeedsUpdate = true; L.lower.matrixWorldNeedsUpdate = true; L.foot.matrixWorldNeedsUpdate = true;
    }
  }

  private applyCrane(r: BossRig): void {
    const c = this.cur, J = r.joints;
    const dimK = c.dim < 0 ? 0 : c.dim > 1 ? 1 : c.dim;
    J.boomYaw.rotation.set(0, c.byaw, 0);
    J.boomLuff.rotation.set(-c.luff, 0, 0);
    const tz = c.trolley < 6 ? 6 : c.trolley > C4.boomL - 1 ? C4.boomL - 1 : c.trolley;
    J.trolley.position.set(0, -2.6, tz);
    J.cab.rotation.set(c.cabPitch, 0, 0);
    this.drumA += c.drum * this.fdt;
    if (this.drumA > 1e4 || this.drumA < -1e4) this.drumA %= PI * 2;
    J.drum.rotation.set(this.drumA, 0, 0);
    const gc = r.groups.cab;
    gc.mat.userData.bt.uGlowMul.value = gc.glowBase * Math.max(0, c.glow) * dimK;
    for (let i = 0; i < C4_PLAIN.length; i++) { const g = r.groups[C4_PLAIN[i]]; g.mat.userData.bt.uGlowMul.value = g.glowBase * dimK; }
  }

  // ─────────────────────────────── CAISSON-4 hook + cables ───────────────────────────────
  private updateHook(w: World, b: BossState, r: BossRig): void {
    const J = r.joints, tA = this.tA, a = this.fa, dt = this.fdt;
    r.root.updateMatrixWorld(true);
    const tip = J.tip.getWorldPosition(_v3);
    const hook = J.hook, hp = this.hookPos, hv = this.hookVel;
    if (!this.hookInit) { hp.set(tip.x, tip.y - HOOK_HANG, tip.z); hv.set(0, 0, 0); this.hookInit = true; }

    // boss hook-drop lobs in flight (sorted by id: the first is the hook, the rest counterweights)
    let nd = 0;
    this.dropIds[0] = this.dropIds[1] = this.dropIds[2] = Infinity;
    for (let i = 0; i < w.projectiles.length; i++) {
      const p = w.projectiles[i];
      if (!p.alive || p.owner !== 'boss' || p.kind !== 'hookDrop') continue;
      let slot = -1;
      for (let s = 0; s < 3; s++) if (p.id < this.dropIds[s]) { slot = s; break; }
      if (slot < 0) continue;
      for (let s = 2; s > slot; s--) { this.dropIds[s] = this.dropIds[s - 1]; this.dropBuf[s].copy(this.dropBuf[s - 1]); }
      this.dropIds[slot] = p.id;
      this.dropBuf[slot].set(p.px + (p.x - p.px) * a, Math.max(0, p.py + (p.y - p.py) * a), p.pz + (p.z - p.pz) * a);
      nd = Math.min(3, nd + 1);
    }
    for (let s = 0; s < 3; s++) this.drops[s] = s < nd ? this.dropBuf[s] : null;

    const T = w.titan;
    const leashed = !!T.leash && (b.data.leash ?? 0) > 0 && b.alive;
    let scripted = false;
    if (leashed) {
      // the hook is on the titan: taut cable from the boom tip to its chest
      const tx = T.px + (T.x - T.px) * a, tz = T.pz + (T.z - T.pz) * a;
      hp.set(tx, T.height * 0.55, tz); hv.set(0, 0, 0); scripted = true;
    } else if (this.drops[0]) {
      hp.copy(this.drops[0]); hv.set(0, 0, 0); scripted = true;
    } else if (b.alive && b.attack === 'hookLane') {
      const W = this.windup(w, b, 'hookLane', 1.8);
      const tc = tA - (b.data.laneAt ?? 0);
      const dir = b.data.dir ?? b.heading;
      const fx = Math.sin(dir), fz = Math.cos(dir);
      if (tc < W) {
        // hauled back and up behind the tip while the lane paints
        const p = e3(clamp(tc / W, 0, 1));
        _v0.set(tip.x - fx * 16 * p, tip.y - lerp(HOOK_HANG, 6, p), tip.z - fz * 16 * p);
        hp.lerp(_v0, 1 - Math.exp(-dt * 6)); hv.set(0, 0, 0); scripted = true;
      } else {
        const q = tc - W;
        const len = 150;
        const bx = b.px + (b.x - b.px) * a, bz = b.pz + (b.z - b.pz) * a;
        _v1.set(bx + fx * len, 5, bz + fz * len);
        if (q < 0.32) { const s = e3(q / 0.32); _v0.copy(tip).lerp(_v1, s); _v0.y = lerp(tip.y - 6, 5, s); hp.copy(_v0); scripted = true; }
        else if (q < 0.5) { hp.copy(_v1); scripted = true; }
        // afterwards: reel back (below)
        hv.set(0, 0, 0);
      }
    } else if (b.alive && b.attack === 'winchLeash' && b.introT <= 0) {
      // lasso: the hook whirls under the tip during the windup
      const W = this.windup(w, b, 'winch', 2.2, false);
      const p = clamp(tA / W, 0, 1);
      const ang = this.time * (3 + 5 * p);
      const rad = 6 + 14 * p;
      _v0.set(tip.x + Math.sin(ang) * rad, tip.y - HOOK_HANG * 0.9, tip.z + Math.cos(ang) * rad);
      hp.lerp(_v0, 1 - Math.exp(-dt * 8)); hv.set(0, 0, 0); scripted = true;
    }
    if (!scripted) {
      // hang: reel in fast when far, then a damped pendulum spring under the tip
      _v0.set(tip.x, tip.y - (b.staggerT > 0 || this.deadT >= 0 ? HOOK_HANG * 1.8 : HOOK_HANG), tip.z);
      if (this.deadT >= 0) _v0.y = Math.max(6, _v0.y);
      _v1.subVectors(_v0, hp);
      const d = Math.sqrt(_v1.x * _v1.x + _v1.y * _v1.y + _v1.z * _v1.z);
      if (d > 14) { hp.addScaledVector(_v1, Math.min(1, (Math.max(45, d * 2.5) * dt) / d)); hv.set(0, 0, 0); }
      else {
        hv.addScaledVector(_v1, 7 * dt).multiplyScalar(Math.exp(-dt * 1.6));
        hp.addScaledVector(hv, dt);
      }
    }
    hp.y = Math.max(hp.y, 1.5);
    hook.position.copy(hp);
    hook.rotation.set(clamp(-hv.z * 0.01, -0.4, 0.4), b.heading, clamp(hv.x * 0.01, -0.4, 0.4), 'YXZ');
    this.cable(J.cable0 as THREE.Mesh, hp, tip, true);

    // counterweight drops ride their own cables
    for (let s = 1; s < 3; s++) {
      const o = s === 1 ? J.w1 : J.w2;
      const c = (s === 1 ? J.cable1 : J.cable2) as THREE.Mesh;
      const p = this.drops[s];
      if (!p || !b.alive) { o.visible = false; c.visible = false; continue; }
      o.visible = true; o.position.copy(p); o.rotation.set(0, b.heading, 0);
      this.cable(c, p, tip, true);
    }
    // leash: a second, winch-drum cable straight to the titan so the pull reads from any angle
    const lc = J.cable3 as THREE.Mesh;
    if (leashed) {
      J.drum.getWorldPosition(_v1);
      this.cable(lc, hp, _v1, true);
    } else lc.visible = false;
  }

  /** Stretch a unit cable between two world points. */
  private cable(m: THREE.Mesh, A: THREE.Vector3, B: THREE.Vector3, on: boolean): void {
    m.visible = on;
    if (!on) return;
    _y.subVectors(B, A);
    const L = Math.max(0.01, Math.sqrt(_y.x * _y.x + _y.y * _y.y + _y.z * _y.z));
    _y.multiplyScalar(1 / L);
    _z.set(-_y.z * _y.x, -_y.z * _y.y, 1 - _y.z * _y.z);
    let zl = _z.x * _z.x + _z.y * _z.y + _z.z * _z.z;
    if (zl < 1e-6) { _z.set(1 - _y.x * _y.x, -_y.x * _y.y, -_y.x * _y.z); zl = _z.x * _z.x + _z.y * _z.y + _z.z * _z.z; }
    _z.multiplyScalar(1 / Math.sqrt(zl));
    _x.crossVectors(_y, _z);
    _x.multiplyScalar(CABLE_T); _z.multiplyScalar(CABLE_T); _y.multiplyScalar(L);
    m.matrix.makeBasis(_x, _y, _z).setPosition(A);
    m.matrixWorldNeedsUpdate = true;
  }
}

