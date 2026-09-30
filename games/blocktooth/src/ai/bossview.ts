// BLOCKTOOTH — boss view (foes-view lane, CONTRACT §6, §6.1, §10, §1).
//
// Two original containment bosses as articulated, procedurally animated hierarchies:
//   * CAISSON-4 — four-legged harbour crane-mech (~75 m + boom): truss gantry body, operator cab
//     with two lamp "eyes", A-frame + lattice boom with a running trolley, a winch drum, four
//     two-bone stilt legs with foot pads (IK keeps planted pads on the ground while the body
//     bobs, rises for LEG STOMP, sags in a stagger), a hook on a cable that visibly drops for
//     HOOK DROP (following the sim's hookDrop lobs), is flung down the HOOK LANE, lassos during
//     the WINCH windup and runs a taut cable to the titan while the leash holds (plus an x-ray
//     hazard-banded line, always visible, whose bands march toward the boom — WINCH LEASH reads
//     even when the titan's body hides the real cable).
//   * IRON GULLY — HALVARD snow-clearance walker (~70 m): a road gritter + V-plough at kaiju
//     scale — charcoal grit hopper with an ochre load and an amber beacon bar, a flush blower
//     turret with a spinning auger in a lit intake (AUGER BLAST), a hinged V-plough (PLOUGH RUN),
//     a plate magazine under a vermilion spreader spinner (PLATE SPREADER; the FRACTURE weak point,
//     crack seams glow with the meter), four crab-splayed hydraulic stamp legs (DOUBLE STAMP) as
//     3 instanced meshes with per-leg instFlash. A machine: no face, jaw, hide, claws or tail.
// Animation reads boss.attack / attackT / phase / staggerT / introT / data.* and the live boss
// telegraphs, so every body wind-up is timed by the SAME windup as the paint on the floor.
// Part hit flash per collider group (bossHit events), 3 px ink hulls, shadows. Zero per-frame
// allocation (scratch vectors, fixed mesh set).

import * as THREE from 'three';
import type { BossId, BossState, World } from '../core/types.ts';
import { isGateId } from '../core/types.ts';
import { SIM_DT } from '../core/config.ts';
import { clamp, easeInCubic, easeOutBack, easeOutCubic, lerp, smoothstep, wrapAngle } from '../core/math.ts';
import { BIOMES } from '../data/biomes.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../render/viewtypes.ts';
import { addOutline, INK } from '../render/materials.ts';
import { FOE_PAL, Facet, M, makeFoeMaterial, ngon, rect } from './foemodels.ts';
import type { FoeMaterial } from './foemodels.ts';
import { buildParkadeRig, CHAIN_CAP, ParkadePoser } from './foemodels_parkade.ts';
import type { ParkadeFrame, ParkadeRig } from './foemodels_parkade.ts';
import { buildGateRig } from './foemodels_gate.ts';
import type { GateFrame, GateRig } from './foemodels_gate.ts';
/** scratch for renderer.getSize (the canvas CSS size without a layout read) */
const _cssSize = new THREE.Vector2();

/** every boss rig built at mount (warmup compiles every boss program up front) — v2 adds PARKADE-6, the
 *  GATEKEEPERS lane K2a the three gatekeeper rigs (ai/foemodels_gate.ts; one shown at a time) */
const RIG_IDS = ['caisson4', 'irongully', 'parkade6', 'stencil1', 'cordon2', 'switchboard5'] as const;

/** CONTRACT §6.1: titans / bosses 3.0 px ink. */
const OUTLINE_W = 3.0;
/**
 * fx2 (critic r2/057–058): a boss hull that is pale on top barely separates from WHITE STACKS snow at Size IV
 * zoom. On that biome only, the rig swaps its 3 px ink hulls for SNOW_OUTLINE_W px ones (a second hull per mesh,
 * built once; exactly one of the two is visible, so the draw count is unchanged) and its hull paint is shaded down to
 * SNOW_HIDE_MUL (material colour × vertex colour; the lamp glow is emissive and keeps its glare).
 */
const SNOW_OUTLINE_W = 5.5;
const SNOW_HIDE_MUL = 0.8;
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
export interface LegRig {
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

export interface FlashGroup { mat: FoeMaterial; flash: number; glowBase: number }

export interface BossRig {
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
  /** IRON GULLY on WHITE STACKS: the default 3 px hulls and the thick snow hulls (see SNOW_OUTLINE_W) */
  inkThin?: THREE.Object3D[];
  inkSnow?: THREE.Object3D[];
  /** instanced legs (IRON GULLY): LegRig.upper/lower/foot point at these and are posed per instance */
  legInst?: { upper: THREE.InstancedMesh; lower: THREE.InstancedMesh; foot: THREE.InstancedMesh; flash: THREE.InstancedBufferAttribute };
  /** IRON GULLY defeat: grit chunks pouring over the hopper rim (instanced, hidden while alive) */
  grit?: THREE.InstancedMesh;
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

// ─────────────────────────────── IRON GULLY (HALVARD snow-clearance walker) ───────────────────────────────
// A road gritter + V-plough built at kaiju scale on four hydraulic stamp legs (owner rule 2026-09-29: bosses are
// ROBOTS). Authored facing +Z around the sim's colliders (ai/bosses/irongully.ts, untouched): body r20 y 18–50 =
// the grit hopper; head r8 @ z 34, y 28–50 = the blower turret (intake face at z ≈ 40 = the cone origin); sail r10
// @ z −6, y 48–70 = the plate magazine + spreader spinner (the weak point, crack seams glow with FRACTURE); legs r6
// @ (±14, ±20) = crab-splayed stamp legs (3 instanced meshes, per-leg instFlash — the PARKADE-6 idiom).
// Dark hull on snow (≈ 10:1 vs #eef2f6; the old pale hide was 1.4:1), vermilion / ochre accents, no frost on tops.
// 9 meshes → 18 draws including hulls.
const G = {
  hull: '#3b4856', hullL: '#56636f', dark: '#252c35', black: '#1b2027',
  verm: '#d8432a', vermD: '#a83220', ochre: '#a8703a', ochreD: '#86552a', ochreL: '#bd8546',
  cream: '#f2efe6', chrome: '#aeb6bf', chromeD: '#7d8792', amber: '#ffb43a', lampW: '#fff0c8',
  intake: '#8ff6ff', seam: '#ff8a3a', tail: '#ff4a3a',
} as const;

const GU = {
  bodyY: 34,
  hip: [[13, -9, 18], [-13, -9, 18], [13, -9, -18], [-13, -9, -18]] as const,
  foot: [[19.5, 3.4, 21], [-19.5, 3.4, 21], [19.5, 3.4, -21], [-19.5, 3.4, -21]] as const,
  L1: 13, L2: 16,
  /** turret slew bearing (body-local): drum centre at root (0, 38, 31.5) */
  neck: [0, 4, 24] as const,
  /** auger hub in turret space: the intake face sits at root z ≈ 39.5 (the sim's cone origin is z 40) */
  auger: [0, 0, 15.3] as const,
  /** plough hinge (body-local) = root y 16 */
  blade: [0, -18, 25] as const,
  /** magazine base (body-local) = root (0, 48, −6): the sail collider's floor */
  sail: [0, 14, -6] as const,
  /** spreader-disc hub on the magazine */
  spin: [0, 13.2, 0] as const,
};
/** blade hinge pitch: carried (walk) → down on the ground (PLOUGH RUN / stagger / defeat) */
const GU_BLADE_UP = -0.3, GU_BLADE_DOWN = 0.02;
/** carried plough lift (m) on the lift rams: blade 0 → +LIFT, blade ≥ 1 → on the road */
const GU_BLADE_LIFT = 7;
/** defeat: the step (0–3) at which each leg (FL, FR, BL, BR) loses pressure — FL, BR, FR, BL */
const GU_DOWN_ORDER = [0, 2, 3, 1] as const;
/** defeat: when each failure step hits (s) and how long a ram takes to dump (s) — the 4th lands at 1.35 + 0.4;
 *  the chassis drops GU_COLLAPSE_DY so the skid frame (body-local y −18) sits on the road */
const GU_FAIL_T = [0.3, 0.65, 1.0, 1.35] as const;
const GU_FAIL_S = 0.4;
const GU_COLLAPSE_DY = 16;
/** defeat grit spill: chunk count, pour start (s, just after the first ram fails), spacing (s), gravity (m/s²) */
const GU_GRIT_N = 28, GU_GRIT_T0 = 0.4, GU_GRIT_DT = 0.05, GU_GRIT_G = 34;

/** hopper half-width at body-local y (the tub flares toward the top) */
const hopW = (y: number) => 11.5 + 4 * (y + 13) / 26.5;

function guChassis(f: Facet): void {
  // skid frame under the hopper
  f.box(24, 5, 50, G.dark, M(0, -15.5, -2), { ch: 1.2 });
  // the grit hopper: a trapezoid tub, vermilion band, black rim
  const ring = (y: number) => rect(hopW(y) * 2, 44 + 8 * (y + 13) / 26.5, 2.2, 0, -2);
  f.loft([
    { y: -13, pts: ring(-13) }, { y: -5, pts: ring(-5) }, { y: -3, pts: ring(-3) },
    { y: 12.2, pts: ring(12.2) }, { y: 13.5, pts: ring(13.5) },
  ], { side: [G.hull, G.verm, G.hull, G.black], top: G.hullL, bottom: G.dark });
  // vermilion / cream chevrons under the rim, on the (leaning) walls: sides, front, back
  const slope = 4 / 26.5, hz = 23.96;
  f.mirrorX(() => f.group(M(hopW(0) + 0.05, 0, -2, slope, PI / 2, 0), () => f.hazard(-23, 23, 8.8, 11.6, 0.3, 16, G.verm, G.cream)));
  f.group(M(0, 0, -2 + hz + 0.05, slope, 0, 0), () => f.hazard(-12.6, 12.6, 8.8, 11.6, 0.3, 9, G.verm, G.cream));
  f.group(M(0, 0, -2 - hz - 0.05, slope, PI, 0), () => f.hazard(-12.6, 12.6, 8.8, 11.6, 0.3, 9, G.verm, G.cream));
  // stiffening ribs down the flanks (lean with the tub wall)
  f.mirrorX(() => {
    for (const z of [-20, -8, 4, 16]) f.box(1.1, 23, 1.8, G.hullL, M(hopW(0) + 0.45, 0.5, z, 0, 0, -0.151), { ch: 0.3 });
    f.beam(hopW(13.5) - 0.4, 14.3, -27, hopW(13.5) - 0.4, 14.3, 23, 0.5, 0.5, G.chrome);            // grab rail
  });
  // the grit load: an ochre field framed by the dark rim, with shovel-heaped mounds
  f.box(hopW(13.5) * 2 - 5.4, 2.2, 46.5, G.ochre, M(0, 14.4, -2), { ch: 1.6, tw: 0.93, td: 0.96 });
  f.box(10, 2.8, 9, G.ochreL, M(-6.5, 16.8, 13), { tw: 0.3, td: 0.35 });
  f.box(8, 2.2, 8, G.ochreD, M(7, 16.5, 16.5), { tw: 0.3, td: 0.3 });
  f.box(9, 2.4, 8, G.ochreL, M(5, 16.6, -21), { tw: 0.3, td: 0.35 });
  // amber beacon bar across the front rim (body glow = the beacon pulse)
  f.box(21, 1.4, 2.4, G.black, M(0, 14.6, 22.6), { ch: 0.3 });
  for (const x of [-8.4, -2.8, 2.8, 8.4]) f.cyl(1.0, 0.9, 1.8, 8, G.amber, M(x, 16.1, 22.6), { glow: 1 });
  // front deck carrying the turret's slewing ring
  f.box(17, 3.2, 12, G.dark, M(0, -6.8, 26), { ch: 1 });
  f.box(17.3, 1.0, 12.3, G.verm, M(0, -5.6, 26));
  // push frame down to the plough hinge
  f.mirrorX(() => {
    f.beam(9, -13.5, 20, 6, -18, 25, 2.2, 2.2, G.dark, { ch: 0.3 });
    f.beam(10, -8.5, 22, 5.5, -17.2, 25.5, 1.1, 1.1, G.chrome, { seg: 6 });                            // lift ram
  });
  f.cyl(1.5, 1.5, 15, 8, G.chromeD, M(0, -18, 25, 0, 0, PI / 2));
  // hip housings at the four corners (vermilion band)
  for (const h of GU.hip) {
    f.box(8, 10, 9, G.dark, M(h[0] * 1.02, -8, h[2]), { ch: 1.2, top: G.hull });
    f.box(8.4, 1.6, 9.4, G.verm, M(h[0] * 1.02, -4.6, h[2]));
  }
  // rear engine block: radiator grille, hazard band, tail lamps, two exhaust stacks
  f.box(22, 13, 9, G.hull, M(0, -3.5, -31.5), { ch: 1.2, top: G.dark });
  for (let i = 0; i < 6; i++) f.box(17, 0.8, 0.5, G.black, M(0, -8.4 + i * 1.7, -36.1));
  f.group(M(0, 0, -36.05, 0, PI), () => f.hazard(-10.4, 10.4, 1.2, 2.8, 0.3, 12, G.verm, G.cream));
  f.mirrorX(() => {
    f.box(1.8, 1.4, 0.6, G.tail, M(9, -1.2, -36.2), { glow: 1 });
    f.cyl(1.4, 1.4, 16, 8, G.black, M(7, 10, -30));
    f.box(3.4, 0.6, 3.4, G.dark, M(7, 18.4, -30.4, -0.35));
    f.box(2, 3, 2, G.dark, M(7, 1.5, -30), { ch: 0.3 });
  });
}

function guBlade(f: Facet): void {
  // V-plough in hinge space (hinge = root y 16; the cutting edge meets the road when the blade is down). Built to
  // read at gameplay distance even when the walker faces the titan (the camera then looks at it past the titan):
  //   * wide — apex forward at z ≈ 23, wings back to x ±24.8 (well past the hopper and the stamp pads), so both
  //     wing tips stick out on either side of a titan standing in front of it;
  //   * tall — a 17 m vermilion mouldboard, carried GU_BLADE_LIFT higher while walking (applyPose), so it rides
  //     in front of the turret nose and over a Size IV titan's feet in the 3/4 top-down view;
  //   * the mouldboard's top curls forward into a 7 m deflector lip striped cream / vermilion ON TOP: from above
  //     the plough draws a bright V chevron on the road plan, the one shape that says "snow plough" at any zoom;
  //   * two tall plough-guide rods (cream, vermilion bands) with striped marker flags and big amber lamps at the
  //     wing tips, and an amber apex lamp — they pulse with the beacon (body glow) and stand ~24 m above the blade,
  //     beside and above the titan's silhouette.
  const YAW = 0.6, HL = 15, CX = 12.4, CZ = 14.5, H = 17, CY = -7.5;
  const tipX = CX + HL * Math.cos(YAW), tipZ = CZ - HL * Math.sin(YAW), apexZ = CZ + HL * Math.sin(YAW);
  const top = CY + H / 2;
  f.mirrorX(() => {
    f.group(M(CX, CY, CZ, -0.12, YAW, 0), () => {
      f.box(HL * 2 + 0.2, H, 1.6, G.verm, undefined, { ch: 0.2 });
      f.group(M(0, 0, 0.8), () => f.hazard(-HL + 0.4, HL - 0.4, 1.2, 5.2, 0.25, 12, G.cream, G.verm));
      f.box(HL * 2 + 0.4, 1.6, 2.2, G.black, M(0, -H / 2 + 0.8, 0.2));                          // cutting edge
      // the mouldboard's top curls FORWARD into a 7 m deflector lip, tipped up toward the camera and striped
      // cream / vermilion on top: the broad bright V that reads from the 3/4 top-down view
      f.group(M(0, H / 2 + 0.3, 2.6, -0.25, 0, 0), () => {
        f.box(HL * 2 + 0.4, 1.0, 7.0, G.verm, undefined, { ch: 0.2, bottom: G.vermD });
        f.group(M(0, 0.5, 3.5, -PI / 2, 0, 0), () => f.hazard(-HL, HL, 0, 7.0, 0.3, 16, G.cream, G.verm));
        f.box(HL * 2 + 0.6, 1.3, 0.9, G.black, M(0, 0.2, 3.7));                                   // lip edge
        // retroreflective strip along the lip (lit by the beacon pulse): stays bright even in the hopper's shadow
        f.box(HL * 2 - 0.4, 0.5, 1.0, G.cream, M(0, 0.85, 2.6), { glow: 1 });
      });
      for (const x of [-8, -2.7, 2.7, 8]) f.box(1.4, H - 2, 1.4, G.dark, M(x, 0, -1.2));
    });
    f.beam(4.5, 0, 0, 8.8, -8, 12, 2.2, 2.2, G.dark, { ch: 0.3 });                                 // push arm
    // plough-guide rod at the wing tip: banded rod + amber lamp
    const RH = 24;
    f.beam(tipX - 0.8, top, tipZ + 0.3, tipX - 0.2, top + RH, tipZ - 0.3, 1.7, 1.7, G.cream, { seg: 6 });
    for (const y of [6, 12, 18]) f.box(2.3, 2.2, 2.3, G.verm, M(tipX - 0.8 + 0.6 * y / RH, top + y, tipZ + 0.3 - 0.6 * y / RH));
    // marker flag: a striped panel standing out from the rod (outward), then the lamp on top
    f.group(M(tipX + 0.6, top + RH - 5.5, tipZ - 0.3, 0, 0, 0), () => {
      f.box(6.4, 4.4, 0.5, G.black, M(3.2, 0, 0));
      f.group(M(0.1, 0, 0.25), () => f.hazard(0.1, 6.3, -2.0, 2.0, 0.2, 5, G.verm, G.cream));
      f.group(M(6.3, 0, -0.25, 0, PI, 0), () => f.hazard(0.0, 6.2, -2.0, 2.0, 0.2, 5, G.verm, G.cream));
    });
    f.box(3.6, 3.6, 3.6, G.amber, M(tipX - 0.2, top + RH + 1.6, tipZ - 0.3), { glow: 1, ch: 0.8 });
    f.box(1.4, 1.4, 1.4, G.amber, M(tipX + 0.4, -1.4, tipZ + 0.2), { glow: 1 });                  // wing-tip lamp
  });
  f.cyl(1.5, 1.5, H + 0.4, 6, G.dark, M(0, CY, apexZ - 0.4));                                     // apex post
  f.box(2.8, 2.2, 2.8, G.amber, M(0, top + 3.4, apexZ + 1.2), { glow: 1, ch: 0.5 });              // apex lamp
}

function guTurret(f: Facet): void {
  // blower turret (origin = slew bearing): a flush drum along +Z, the lit auger intake at the front, a lamp
  // ring (the tell counter), headlamps, the discharge chute + deflector on top, the motor box behind
  f.cyl(6, 6.6, 2.4, 10, G.dark, M(0, -7.6, 6));
  f.cyl(7, 7, 13, 12, G.hullL, M(0, 0, 7.5, PI / 2), { bottom: G.dark });
  f.cyl(7.35, 7.35, 1.3, 12, G.verm, M(0, 0, 4, PI / 2));
  f.cyl(7.35, 7.35, 1.3, 12, G.verm, M(0, 0, 10.2, PI / 2));
  f.cyl(7.7, 7.7, 1.3, 12, G.black, M(0, 0, 14.2, PI / 2));
  f.cyl(6.3, 6.3, 0.3, 12, G.intake, M(0, 0, 14.95, PI / 2), { glow: 1 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2 + PI / 8;
    f.box(1.1, 1.1, 0.6, G.amber, M(Math.sin(a) * 7.05, Math.cos(a) * 7.05, 15.05), { glow: 1 });
  }
  f.mirrorX(() => {
    f.box(2.8, 2, 1.6, G.black, M(4.4, 6.3, 12.2));
    f.box(2.1, 1.3, 0.5, G.lampW, M(4.4, 6.3, 13.1), { glow: 1 });
    f.beam(6.6, -1, 1, 6.6, -1, 13, 0.7, 0.7, G.chrome, { seg: 6 });
  });
  f.beam(0, 5.8, 5, 0, 12.6, 8, 3.6, 3.6, G.verm, { seg: 8 });
  f.box(4.6, 1.5, 6.4, G.dark, M(0, 13.4, 10, 0.38), { ch: 0.3 });
  f.box(9.5, 9, 6, G.dark, M(0, 0.5, -1.8), { ch: 1, top: G.hull });
  f.group(M(0, 0, -4.82, 0, PI), () => f.hazard(-4.5, 4.5, 1.8, 3.2, 0.2, 6, G.verm, G.cream));
}

function guAuger(f: Facet): void {
  // auger rotor (spins about +Z): hub cone + three swept vanes, one vermilion so the spin reads
  f.cyl(2.2, 0.5, 3, 8, G.verm, M(0, 0, 1.5, PI / 2));
  for (let k = 0; k < 3; k++) {
    f.group(M(0, 0, 0.6, 0, 0, (k / 3) * PI * 2), () => f.box(1.4, 5.2, 0.9, k === 0 ? G.verm : G.cream, M(0, 3.5, 0, 0, 0.55, 0.3), { ch: 0.2 }));
  }
}

function guMagazine(f: Facet): void {
  // plate magazine (origin = base on the hopper roof): a cassette of steel road plates on edge between dark
  // corner posts and clad flanks; the flank crack seams glow with FRACTURE (sail glow)
  f.box(15, 2, 15, G.dark, M(0, 1, 0), { ch: 1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(1.9, 12, 1.9, G.dark, M(sx * 6.4, 7, sz * 6.4));
  for (let i = 0; i < 6; i++) {
    const z = -5 + i * 2;
    f.box(11, 9.6, 0.9, i % 2 ? G.hullL : G.chromeD, M(0, 7.2, z), { ch: 0.15 });
    f.box(11, 0.8, 1.0, G.verm, M(0, 12.3, z));
  }
  f.mirrorX(() => {
    f.box(0.7, 10, 12.6, G.hull, M(6.8, 7.2, 0));
    const S: readonly (readonly [number, number])[] = [[3, -5.2], [5.6, -1.6], [7.4, -3.2], [10.4, 1.2], [8.6, 3.6], [11.4, 5.4]];
    for (let i = 0; i < S.length - 1; i++) f.beam(7.2, S[i][0], S[i][1], 7.2, S[i + 1][0], S[i + 1][1], 0.45, 0.3, G.seam, { glow: 1 });
  });
  f.group(M(0, 7.2, 6.95), () => {
    f.beam(-4, -3, 0, -1, 0.5, 0, 0.45, 0.3, G.seam, { glow: 1 });
    f.beam(-1, 0.5, 0, 2.5, -1.5, 0, 0.45, 0.3, G.seam, { glow: 1 });
    f.beam(2.5, -1.5, 0, 4.2, 3.4, 0, 0.45, 0.3, G.seam, { glow: 1 });
  });
  f.cyl(3, 3.4, 1.6, 8, G.dark, M(0, 12.6, 0));
}

function guSpinner(f: Facet): void {
  // spreader disc (spins about Y): a big flat vermilion disc with cream radial vanes, one black
  f.cyl(1.2, 1.2, 3, 8, G.chromeD, M(0, 0.5, 0));
  f.cyl(11, 10.4, 1.2, 16, G.verm, M(0, 2.4, 0), { bottom: G.vermD });
  for (let k = 0; k < 6; k++) {
    f.group(M(0, 3.6, 0, 0, (k / 6) * PI * 2, 0), () => f.box(1.2, 1.4, 8.4, k === 0 ? G.black : G.cream, M(0.6, 0, 5.8, 0, 0.2, 0), { ch: 0.2 }));
  }
  f.cyl(2.5, 1.6, 1.8, 8, G.dark, M(0, 4, 0));
}

function guUpper(f: Facet, L: number): void {
  // hip → knee strut along +Y, +Z = the knee (pole) side: box girder, hydraulic cylinder on top, knuckles
  f.cyl(3.8, 3.8, 6.6, 10, G.verm, M(0, 0, 0, 0, 0, PI / 2), { top: G.dark, bottom: G.dark });
  f.loft([
    { y: -1, pts: rect(6, 6, 1) },
    { y: L * 0.35, pts: rect(5.8, 5.8, 1) },
    { y: L, pts: rect(4.6, 4.6, 0.8) },
  ], { side: G.dark, top: G.dark, bottom: G.dark });
  f.box(6.3, 1.6, 6.3, G.verm, M(0, L * 0.45, 0));
  f.beam(0, 1.5, 3.9, 0, L * 0.62, 3.8, 2.3, 2.3, G.hull, { seg: 8 });
  f.beam(0, L * 0.62, 3.8, 0, L - 1.6, 3.0, 1.2, 1.2, G.chrome, { seg: 6 });
  f.cyl(3.5, 3.5, 6.4, 10, G.verm, M(0, L, 0, 0, 0, PI / 2), { top: G.dark, bottom: G.dark });
  f.cyl(1.3, 1.3, 7.2, 8, G.chromeD, M(0, L, 0, 0, 0, PI / 2));
}

function guLower(f: Facet, L: number): void {
  // knee → ankle: dark ram sleeve, chrome piston rod, vermilion collar, an amber pressure lamp
  f.loft([
    { y: 0, pts: rect(5.4, 5.4, 1) },
    { y: L * 0.55, pts: rect(5.0, 5.0, 1) },
  ], { side: G.hull, top: G.dark, bottom: G.dark });
  f.box(5.8, 1.4, 5.8, G.verm, M(0, L * 0.12, 0));
  f.cyl(1.9, 1.9, L * 0.44, 8, G.chrome, M(0, L * 0.74, 0));
  f.box(1.4, 1.4, 0.5, G.amber, M(0, L * 0.32, 2.75), { glow: 1 });
  f.cyl(2.5, 2.5, 2.4, 8, G.dark, M(0, L, 0));
}

function guPad(f: Facet): void {
  // square stamp pad (origin = ankle, 3.4 m above the ground): black sole, vermilion band, chevrons
  f.cyl(2.4, 2.8, 2.0, 8, G.dark, M(0, -0.6, 0));
  f.loft([
    { y: -3.4, pts: rect(10.4, 10.4, 1.5) },
    { y: -2.3, pts: rect(10.9, 10.9, 1.6) },
    { y: -1.3, pts: rect(10.9, 10.9, 1.6) },
    { y: -0.5, pts: rect(9, 9, 1.3) },
  ], { side: [G.black, G.verm, G.dark], top: G.dark, bottom: G.black });
  for (let k = 0; k < 4; k++) f.group(M(0, 0, 0, 0, (k / 4) * PI * 2), () => f.hazard(-4, 4, -2.25, -1.35, 0.2, 5, G.verm, G.cream, M(0, 0, 5.45)));
}

/** grit chunk (unit ≈ 1 m): a squashed ochre lump, darker underside */
function guGrit(f: Facet): void {
  f.box(1, 0.7, 0.9, G.ochre, M(0, 0, 0, 0.3, 0.5, 0.2), { ch: 0.25, top: G.ochreL, bottom: G.ochreD });
}

function buildGully(glowMul: number): BossRig {
  const root = new THREE.Group(); root.name = 'boss:irongully';
  const body = new THREE.Group(); body.name = 'gu:body';
  body.position.set(0, GU.bodyY, 0);
  root.add(body);
  const groups: Record<string, FlashGroup> = {
    body: mkGroup(glowMul), head: mkGroup(glowMul * 1.2), sail: mkGroup(glowMul),
    // the four leg flash groups are bookkeeping (bossHit targets): their flash is copied into instFlash per leg
    legFL: mkGroup(glowMul), legFR: mkGroup(glowMul), legBL: mkGroup(glowMul), legBR: mkGroup(glowMul),
  };
  const legMat = makeFoeMaterial(true);
  legMat.userData.bt.uGlowMul.value = glowMul;
  groups.legs = { mat: legMat, flash: 0, glowBase: glowMul };
  const meshes: THREE.Mesh[] = [];
  const bld = (fn: (f: Facet) => void) => { const f = new Facet(); f.jitter = 0.03; fn(f); return f.build(); };
  const add = <T extends THREE.Mesh>(parent: THREE.Object3D, m: T): T => { parent.add(m); meshes.push(m); return m; };
  const joint = (parent: THREE.Object3D, name: string, p: readonly number[]) => {
    const j = new THREE.Group(); j.name = name; j.position.set(p[0], p[1], p[2]); parent.add(j); return j;
  };

  add(body, mkMesh(bld(guChassis), groups.body.mat, 'gu:chassis'));
  const blade = joint(body, 'gu:blade', GU.blade);
  add(blade, mkMesh(bld(guBlade), groups.body.mat, 'gu:plough'));
  const neck = joint(body, 'gu:turret', GU.neck);
  add(neck, mkMesh(bld(guTurret), groups.head.mat, 'gu:turretM'));
  const auger = joint(neck, 'gu:auger', GU.auger);
  add(auger, mkMesh(bld(guAuger), groups.head.mat, 'gu:augerM', false));
  const sail = joint(body, 'gu:magazine', GU.sail);
  add(sail, mkMesh(bld(guMagazine), groups.sail.mat, 'gu:magazineM'));
  const spin = joint(sail, 'gu:spinner', GU.spin);
  add(spin, mkMesh(bld(guSpinner), groups.sail.mat, 'gu:spinnerM'));

  // legs: 3 instanced meshes (upper / lower / pad), per-leg flash through instFlash
  const upG = bld((f) => guUpper(f, GU.L1)), loG = bld((f) => guLower(f, GU.L2)), ftG = bld(guPad);
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(4), 1);
  flash.setUsage(THREE.DynamicDrawUsage);
  for (const g of [upG, loG, ftG]) g.setAttribute('instFlash', flash);
  const I = new THREE.Matrix4();
  const inst = (geo: THREE.BufferGeometry, name: string) => {
    const m = new THREE.InstancedMesh(geo, legMat, 4);
    m.name = name; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 4; i++) m.setMatrixAt(i, I);
    addOutline(m, OUTLINE_W);
    return m;
  };
  const upper = add(root, inst(upG, 'gu:legUpper'));
  const lower = add(root, inst(loG, 'gu:legLower'));
  const foot = add(root, inst(ftG, 'gu:legPad'));
  const names = ['legFL', 'legFR', 'legBL', 'legBR'];
  const offs = [0, 0.5, 0.75, 0.25];            // crawl: FL, BR, FR, BL
  const legs: LegRig[] = [];
  for (let i = 0; i < 4; i++) {
    const h = GU.hip[i], ft = GU.foot[i];
    legs.push({
      name: names[i], hip: new THREE.Vector3(h[0], h[1], h[2]), rest: new THREE.Vector3(ft[0], ft[1], ft[2]),
      L1: GU.L1, L2: GU.L2,
      // knees ride outward and up (a crab-splayed machine leg, never an animal elbow / hock)
      pole: new THREE.Vector3(Math.sign(h[0]), 1.1, Math.sign(h[2]) * 0.15).normalize(), off: offs[i],
      upper, lower, foot, flinch: 0,
    });
  }
  // defeat grit spill: GU_GRIT_N chunks in the leg material (zero instFlash), hidden until the collapse
  const grG = bld(guGrit);
  grG.setAttribute('instFlash', new THREE.InstancedBufferAttribute(new Float32Array(GU_GRIT_N), 1));
  const grit = new THREE.InstancedMesh(grG, legMat, GU_GRIT_N);
  grit.name = 'gu:grit'; grit.castShadow = false; grit.receiveShadow = false; grit.frustumCulled = false;
  grit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < GU_GRIT_N; i++) grit.setMatrixAt(i, I);
  addOutline(grit, OUTLINE_W);
  grit.visible = false;
  add(root, grit);
  const joints: Record<string, THREE.Object3D> = { neck, auger, blade, sail, spin };
  return {
    id: 'irongully', root, body, bodyY: GU.bodyY, legs, groups, groupKeys: Object.keys(groups), joints, meshes,
    stride: 24, duty: 0.7, liftH: 5, rMean: 26, walkSpeed: 9, footYawOut: false,
    legInst: { upper, lower, foot, flash }, grit,
  };
}

// ─────────────────────────────── pose record ───────────────────────────────
interface Pose {
  dy: number; pitch: number; roll: number; twist: number;          // body joint
  luff: number; byaw: number; trolley: number; cabPitch: number; drum: number;   // CAISSON-4
  neck: number; neckYaw: number; head: number; jaw: number;        // IRON GULLY: turret pitch / slew (head, jaw, tail unused)
  sailRise: number; sailShake: number; sailTilt: number; tail: number;   // magazine lift / rattle, spinner tilt
  spin: number; auger: number; blade: number; beacon: number; seam: number;  // spinner + auger rad/s, plough 0..1, beacon strobe, FRACTURE seams
  glow: number;                                                     // face lamps / eyes+throat multiplier
  dim: number;                                                      // 1 = all lamps on, 0 = dead
}
function newPose(): Pose {
  return {
    dy: 0, pitch: 0, roll: 0, twist: 0, luff: C4.boomRest, byaw: 0, trolley: 30, cabPitch: 0, drum: 0,
    neck: 0, neckYaw: 0, head: 0, jaw: 0.04, sailRise: 0, sailShake: 0, sailTilt: 0, tail: 0, glow: 1, dim: 1,
    spin: 1.4, auger: 0, blade: 0, beacon: 0, seam: 0,
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
  d.spin = s.spin;
  d.auger = s.auger;
  d.blade = s.blade;
  d.beacon = s.beacon;
  d.seam = s.seam;
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
  c.spin += (t.spin - c.spin) * k;
  c.auger += (t.auger - c.auger) * k;
  c.blade += (t.blade - c.blade) * k;
  c.beacon += (t.beacon - c.beacon) * k;
  c.seam += (t.seam - c.seam) * k;
  c.glow += (t.glow - c.glow) * k;
  c.dim += (t.dim - c.dim) * k;
}

const e3 = easeOutCubic;
/** 0→1→0 bump over [a, b]. */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * PI));
/** hash flicker 0..1 */
/** stable 0..1 hash (build-free, allocation-free) */
const hash01 = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const flick = (t: number) => { const v = Math.sin(t * 91.7) * Math.sin(t * 37.3 + 1.7); return 0.5 + 0.5 * v; };

const C4_PLAIN = ['body', 'boom', 'legFL', 'legFR', 'legBL', 'legBR'] as const;
const HOOK_HANG = 20;           // m of cable under the boom tip at rest
const CABLE_T = 1.1;            // cable thickness (m) — the 3 px hull carries it at Size V zoom
/** WINCH LEASH x-ray cable: constant on-screen width (px) of the hazard core and of its ink rim. */
const LEASH_CORE_PX = 5, LEASH_INK_PX = 3;
/** hazard band length (m) along the leash and its march speed toward the boom (m/s) — the reel direction */
const LEASH_BAND_M = 7, LEASH_FLOW = 16;
/** PARKADE-6 TOW CHAIN: max telegraph link points cached (the sim lays 6–11) */
const PK_CHAIN_PTS = 24;

/**
 * The WINCH LEASH cable drawn as an always-visible x-ray line (depthTest off, drawn last): a taut
 * amber/ink hazard-banded core whose bands march toward the boom (the pull direction) inside an
 * ink sleeve — so the cable reads even where the titan's body or the rig hides the real cable.
 * Shape + motion coded (banded moving line), not colour-only.
 */
function makeLeashXray(): { ink: THREE.Mesh; core: THREE.Mesh; u: { uLen: { value: number }; uTime: { value: number } } } {
  const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
  geo.translate(0, 0.5, 0);
  const inkMat = new THREE.MeshBasicMaterial({
    color: INK, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, fog: false, toneMapped: false,
  });
  const u = { uLen: { value: 1 }, uTime: { value: 0 } };
  const coreMat = new THREE.ShaderMaterial({
    name: 'bossLeashXray',
    uniforms: { uLen: u.uLen, uTime: u.uTime, uA: { value: new THREE.Color(P.amber) }, uB: { value: new THREE.Color(INK) } },
    vertexShader: 'varying float vS;\nvoid main(){ vS = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      '#include <common>',
      'uniform float uLen; uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying float vS;',
      'void main(){',
      `  float s = (vS * uLen - uTime * ${LEASH_FLOW.toFixed(1)}) / ${LEASH_BAND_M.toFixed(1)};`,
      '  float f = fract(s);',
      '  float band = smoothstep(0.62, 0.66, f) * (1.0 - smoothstep(0.96, 1.0, f));',
      '  gl_FragColor = vec4(mix(uA, uB, band), 1.0);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false,
  });
  const ink = new THREE.Mesh(geo, inkMat);
  const core = new THREE.Mesh(geo, coreMat);
  for (const m of [ink, core]) {
    m.matrixAutoUpdate = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.visible = false;
  }
  ink.name = 'c4:leashXray:ink'; core.name = 'c4:leashXray';
  ink.renderOrder = 60; core.renderOrder = 61;
  return { ink, core, u };
}

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
  /** IRON GULLY rotor angles (integrated from the smoothed pose rates) */
  private spinA = 0;
  private augerA = 0;
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
  private xray = makeLeashXray();
  /** seconds since the winch caught (thickness pop on the catch) */
  private leashT = -1;
  // PARKADE-6 (lane L7): the poser, its frame record, the TOW CHAIN polyline cache
  private pkPose = new ParkadePoser();
  private pkF: ParkadeFrame = { dt: 0.5, alpha: 0.5, frozen: false, x: 0.5, z: 0.5, h: 0.5, time: 0.5 };
  private pkChain = new Float32Array(PK_CHAIN_PTS * 2);
  private pkChainN = 0;
  private pkTowW = 1.5;
  private pkLk = 2.5;
  private pkFrac = 0.5;
  private pkPts = new Float32Array((PK_CHAIN_PTS + 2) * 3);
  // GATEKEEPERS (lane K2a): the gate posers' frame record
  private gateF: GateFrame = { dt: 0.5, alpha: 0.5, frozen: false, x: 0.5, z: 0.5, h: 0.5, time: 0.5, H: 0.5 };

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.world.name = 'bosses';
    this.world.add(this.xray.ink, this.xray.core);
  }

  private rig(id: BossId): BossRig {
    let r = this.rigs[id];
    if (!r) {
      r = isGateId(id) ? buildGateRig(id, this.glowMul)
        : id === 'caisson4' ? buildCaisson(this.glowMul) : id === 'parkade6' ? buildParkadeRig(this.glowMul) : buildGully(this.glowMul);
      r.root.visible = false;
      this.world.add(r.root);
      if (id === 'caisson4') for (const k of ['hook', 'w1', 'w2', 'cable0', 'cable1', 'cable2', 'cable3']) {
        const o = r.joints[k]; o.visible = false; this.world.add(o);
      }
      if (id === 'parkade6') {
        // PARKADE-6 world-space fx: tow-chain links + JAMMED steam (instanced, hidden until used)
        const pk = (r as ParkadeRig).pk;
        pk.chain.visible = false; pk.steam.visible = false;
        this.world.add(pk.chain, pk.steam);
      }
      if (isGateId(id)) {
        // GATEKEEPERS (K2a): world-space fx (paint blobs, stack smoke) live in the bosses group, hidden with the rig
        for (const o of (r as GateRig).fx) { o.visible = false; this.world.add(o); }
      }
      this.rigs[id] = r;
    }
    return r;
  }

  private show(r: BossRig | null): void {
    for (const id of RIG_IDS) {
      const x = this.rigs[id];
      if (!x) continue;
      const on = x === r;
      x.root.visible = on;
      if (id === 'caisson4') {
        x.joints.hook.visible = on;
        x.joints.cable0.visible = on;
        if (!on) for (const k of ['w1', 'w2', 'cable1', 'cable2', 'cable3']) x.joints[k].visible = false;
      }
      if (id === 'parkade6' && !on) {
        const pk = (x as ParkadeRig).pk;
        pk.chain.visible = false; pk.chain.count = 0; pk.steam.visible = false; pk.steam.count = 0;
      }
      if (isGateId(id) && !on) (x as GateRig).poser.hideFx();
    }
    if (!r) { this.xray.ink.visible = false; this.xray.core.visible = false; this.leashT = -1; }
    this.active = r;
  }

  mount(w: World): void {
    if (!this.mounted) { this.ctx.scene.add(this.world); this.mounted = true; }
    const time = BIOMES[w.biomeId]?.time ?? 'day';
    this.glowMul = time === 'night' ? 1.6 : time === 'overcast' ? 1.15 : 1.0;
    const snow = w.biomeId === 'whitestacks';
    for (const id of RIG_IDS) {
      const r = this.rig(id);          // build both once: warmup compiles every boss program up front
      for (const k in r.groups) { const g = r.groups[k]; g.glowBase = k === 'head' ? this.glowMul * 1.2 : this.glowMul; g.flash = 0; }
      if (id === 'irongully') this.snowLook(r, snow);
    }
    this.resetRun();
    this.show(null);
  }

  /** IRON GULLY vs snow (see SNOW_OUTLINE_W): thick ink hulls + shaded-down hull paint on WHITE STACKS, else as built. */
  private snowLook(r: BossRig, snow: boolean): void {
    if (!r.inkSnow) {
      r.inkThin = []; r.inkSnow = [];
      for (const m of r.meshes) {
        // the plough keeps its 3 px hull on snow: a thick hull (and its neighbours') swallowed the striped lip — the
        // one top-down read of the blade — and the dark machine no longer needs the snow hull to separate it
        if (m.name === 'gu:plough') continue;
        for (const c of m.children) if (c.userData.isOutline) r.inkThin.push(c);
        const h = addOutline(m, SNOW_OUTLINE_W);
        h.visible = false;
        r.inkSnow.push(h);
      }
    }
    for (const h of r.inkThin!) h.visible = !snow;
    for (const h of r.inkSnow) h.visible = snow;
    for (const k in r.groups) r.groups[k].mat.color.setScalar(snow ? SNOW_HIDE_MUL : 1);
  }

  unmount(): void {
    this.show(null);
    if (this.mounted) { this.ctx.scene.remove(this.world); this.mounted = false; }
    this.resetRun();
  }

  /** Release GPU resources (page teardown; not part of the per-run cycle). */
  dispose(): void {
    this.unmount();
    for (const id of RIG_IDS) {
      const r = this.rigs[id];
      if (!r) continue;
      const geos = new Set<THREE.BufferGeometry>();
      for (const m of r.meshes) geos.add(m.geometry);
      for (const k in r.joints) { const o = r.joints[k] as THREE.Mesh; if (o.isMesh) geos.add(o.geometry); }
      const mats = new Set<THREE.Material>();
      if (isGateId(id)) {
        // gate rigs also own a spray / ring material and world-space fx outside `meshes`
        const grab = (o: THREE.Object3D) => o.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh || m.userData.isOutline) return;
          geos.add(m.geometry);
          if (!Array.isArray(m.material)) mats.add(m.material);
        });
        grab(r.root);
        for (const o of (r as GateRig).fx) grab(o);
      }
      for (const g of geos) g.dispose();
      for (const k in r.groups) { mats.delete(r.groups[k].mat); r.groups[k].mat.dispose(); }
      for (const m of mats) m.dispose();
      delete this.rigs[id];
    }
    this.xray.ink.geometry.dispose();
    (this.xray.ink.material as THREE.Material).dispose();
    (this.xray.core.material as THREE.Material).dispose();
  }

  private resetRun(): void {
    this.gait = newGait();
    copyPose(this.cur, REST);
    copyPose(this.tgt, REST);
    for (let i = 0; i < 4; i++) { this.curX[i].set(0, 0, 0); this.tgtX[i].set(0, 0, 0); }
    this.deadT = -1; this.roarT = 0; this.drumA = 0; this.spinA = 0; this.augerA = 0; this.attackKey = ''; this.tw.clear();
    this.hookInit = false; this.hookVel.set(0, 0, 0);
    this.drops[0] = this.drops[1] = this.drops[2] = null;
    this.pkPose.reset(); this.pkChainN = 0; this.pkTowW = 1.5;
    for (const id of RIG_IDS) { if (isGateId(id)) { const g = this.rigs[id] as GateRig | undefined; if (g) g.poser.reset(); } }
  }

  // ─────────────────────────────── frame ───────────────────────────────
  update(w: World, f: FrameInfo): void {
    const dt = Math.max(1e-4, Math.min(0.1, f.dt));
    this.time += dt;
    const b = w.boss;
    if (!b) { if (this.active) this.show(null); return; }
    // GATEKEEPERS (lane K2a): the gate rigs have their own pose path (ai/foemodels_gate.ts) — never fall through
    // to another boss's rig (the v2 §2.7 lesson: a missing branch drew PARKADE-6 as IRON GULLY)
    if (isGateId(b.id)) { this.updateGate(w, b, f, dt); return; }
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
      } else if (ev.type === 'bossPhase') { this.roarT = 1.6; if (b.id === 'parkade6') this.pkPose.roar(); }
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
    // v2 PARKADE-6 (L0 placeholder rig): its own pose path, never the IRON GULLY one (FEATURES_V2 §2.7)
    if (b.id === 'parkade6') {
      const F = this.pkF;
      F.dt = dt; F.alpha = a; F.frozen = f.frozen; F.x = x; F.z = z; F.h = h; F.time = this.time;
      this.poseParkade(w, b, r as ParkadeRig);
      return;
    }
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
    // defeat eases slowly for CAISSON-4's topple; IRON GULLY's collapse keys its own jolts (poseGully) → stays sharp
    const k = 1 - Math.exp(-dt * (this.deadT >= 0 && b.id !== 'irongully' ? 3 : 11));
    SM.k = k;
    smoothPose(this.cur, t, SM.k);
    for (let i = 0; i < 4; i++) this.curX[i].lerp(this.tgtX[i], k);

    this.applyPose(r);
    if (b.id === 'caisson4') this.updateHook(w, b, r);
    else if (this.xray.core.visible) { this.xray.ink.visible = false; this.xray.core.visible = false; this.leashT = -1; }
  }

  // ─────────────────────────────── GATEKEEPERS (GATEKEEPERS.md §3.4, lane K2a) ───────────────────────────────
  /**
   * A gatekeeper in the slot: its rig (built at mount), part flashes by collider name, `resetRun` on `gateSpawn`
   * (gates never push `bossSpawn`, so a new gatekeeper must not inherit the last rig's state), the root scaled by
   * the latched `b.data.H` (the rig is authored at H = 1: the Size V rematch is the same model, bigger), then the
   * rig's own procedural poser.
   */
  private updateGate(w: World, b: BossState, f: FrameInfo, dt: number): void {
    const r = this.rig(b.id) as GateRig;
    if (this.active !== r) { this.show(r); this.resetRun(); }
    const cap = this.ctx.quality.reduceFlashing ? 0.35 : 0.85;
    for (let i = 0; i < f.events.length; i++) {
      const ev = f.events[i];
      if (ev.type === 'bossHit') { const g = r.groups[ev.part] ?? r.groups.body ?? r.groups.base; if (g) g.flash = 1; }
      else if (ev.type === 'bossPhase') r.poser.phase();
      else if (ev.type === 'gateSpawn' || ev.type === 'bossSpawn') this.resetRun();
    }
    for (let gi = 0; gi < r.groupKeys.length; gi++) {
      const g = r.groups[r.groupKeys[gi]];
      g.flash = Math.max(0, g.flash - dt / 0.16);
      g.mat.userData.bt.uFlash.value = Math.min(cap, g.flash * 0.85);
    }
    const a = clamp(f.alpha, 0, 1);
    const x = b.px + (b.x - b.px) * a;
    const z = b.pz + (b.z - b.pz) * a;
    const h = b.pheading + wrapAngle(b.heading - b.pheading) * a;
    const Hd = b.data.H;
    const H = Hd > 0 && Number.isFinite(Hd) ? Hd : Math.max(0.5, w.titan.height);
    r.root.position.set(x, 0, z);
    r.root.rotation.set(0, h, 0);
    r.root.scale.setScalar(H);
    const F = this.gateF;
    F.dt = dt; F.alpha = a; F.frozen = f.frozen; F.x = x; F.z = z; F.h = h; F.time = this.time; F.H = H;
    r.poser.update(w, b, F);
    if (this.xray.core.visible) { this.xray.ink.visible = false; this.xray.core.visible = false; this.leashT = -1; }
  }

  // ─────────────────────────────── PARKADE-6 (FEATURES_V2 §10.3, lane L7) ───────────────────────────────
  /** PARKADE-6: the procedural pose (foemodels_parkade.ts ParkadePoser) + the TOW CHAIN links + its x-ray. */
  private poseParkade(w: World, b: BossState, r: ParkadeRig): void {
    this.fdt = this.pkF.dt;
    this.pkPose.update(w, b, r, this.pkF);
    this.parkadeChain(w, b, r);
  }

  /**
   * TOW CHAIN, drawn as instanced 3D links from the winch under the booth: during the windup it pays out
   * along the live telegraph's link points (Telegraph.chain) and lies in the paint; while the tow holds it
   * runs taut from the winch to the titan (plus the always-visible x-ray line, CAISSON-4's winch rule);
   * after a miss it reels back in.
   */
  private parkadeChain(w: World, b: BossState, r: ParkadeRig): void {
    const pk = r.pk, ch = pk.chain, T = w.titan, a = this.pkF.alpha;
    const P = this.pkPts;
    let np = 0, frac = 0, xrayOn = false;
    if (b.alive && b.attack === 'towChain') {
      // cache the paint's link points while the telegraph lives (it is gone once it fires)
      for (let i = 0; i < w.telegraphs.length; i++) {
        const tg = w.telegraphs[i];
        if (!tg.alive || tg.owner !== 'boss' || tg.tag !== 'towChain' || !tg.chain) continue;
        const n = Math.min(PK_CHAIN_PTS, tg.chain.length >> 1);
        for (let j = 0; j < n; j++) { this.pkChain[j * 2] = tg.chain[j * 2]; this.pkChain[j * 2 + 1] = tg.chain[j * 2 + 1]; }
        this.pkChainN = n;
        if (!tg.fired) this.pkTowW = tg.windup;
        break;
      }
      const tA = b.attackT + (this.pkF.frozen ? 0 : a * SIM_DT);
      const W = this.pkTowW;
      const hooked = (b.data.tow ?? 0) > 0 && !!T.leash;
      r.root.updateMatrixWorld(true);
      pk.winchTip.getWorldPosition(_v3);
      if (hooked) {
        // taut: winch → the titan's back, a slight sag
        const tx = T.px + (T.x - T.px) * a, tz = T.pz + (T.z - T.pz) * a, ty = Math.max(1, T.height * 0.55);
        P[0] = _v3.x; P[1] = _v3.y; P[2] = _v3.z;
        const sdx = tx - _v3.x, sdz = tz - _v3.z;
        const sag = 0.025 * Math.sqrt(sdx * sdx + sdz * sdz);
        P[3] = (_v3.x + tx) / 2; P[4] = (_v3.y + ty) / 2 - sag; P[5] = (_v3.z + tz) / 2;
        P[6] = tx; P[7] = ty; P[8] = tz;
        np = 3; frac = 1; xrayOn = true;
        _v2.set(tx, ty, tz);
      } else if (this.pkChainN >= 2) {
        this.pkLink(b, T);
        const Lk = this.pkLk;
        P[0] = _v3.x; P[1] = _v3.y; P[2] = _v3.z;
        np = 1;
        for (let j = 0; j < this.pkChainN && np < PK_CHAIN_PTS + 1; j++) {
          P[np * 3] = this.pkChain[j * 2]; P[np * 3 + 1] = Lk * 0.35; P[np * 3 + 2] = this.pkChain[j * 2 + 1];
          np++;
        }
        // pays out over the first half of the windup, lies in the paint, snaps back after a miss
        frac = tA < W ? easeOutCubic(clamp(tA / Math.max(0.2, W * 0.5), 0, 1)) : clamp(1 - (tA - W) / 0.45, 0, 1);
      }
    }
    let n = 0;
    if (np >= 2 && frac > 0) { this.pkLink(b, T); this.pkFrac = frac; n = this.pkLinks(ch, np); }
    ch.count = n;
    ch.visible = n > 0;
    if (n > 0) ch.instanceMatrix.needsUpdate = true;
    if (xrayOn) this.updateLeashXray(true, _v2, _v3);
    else if (this.xray.core.visible || this.leashT >= 0) this.updateLeashXray(false, _v2, _v3);
  }

  /** chain link length (m) for this fight → this.pkLk: readable at every size, from the locked titan height */
  private pkLink(b: BossState, T: World['titan']): void {
    const H = b.data.H > 0 ? b.data.H : T.height;
    const L = 0.075 * H;
    this.pkLk = L < 2.4 ? 2.4 : L > 5 ? 5 : L;
  }

  /** Lay links (length this.pkLk) along the first this.pkFrac of the polyline in this.pkPts (np points). */
  private pkLinks(ch: THREE.InstancedMesh, np: number): number {
    const P = this.pkPts, Lk = this.pkLk, frac = this.pkFrac;
    let total = 0;
    for (let i = 0; i + 1 < np; i++) {
      const ax = P[i * 3 + 3] - P[i * 3], ay = P[i * 3 + 4] - P[i * 3 + 1], az = P[i * 3 + 5] - P[i * 3 + 2];
      total += Math.sqrt(ax * ax + ay * ay + az * az);
    }
    const len = total * frac, step = Lk * 0.8;
    let n = 0, seg = 0, segS = 0;
    for (let s = step * 0.5; s < len && n < CHAIN_CAP; s += step) {
      // advance to the segment holding arc length s
      let sl = 0;
      while (seg + 1 < np) {
        const ax = P[seg * 3 + 3] - P[seg * 3], ay = P[seg * 3 + 4] - P[seg * 3 + 1], az = P[seg * 3 + 5] - P[seg * 3 + 2];
        sl = Math.sqrt(ax * ax + ay * ay + az * az);
        if (s <= segS + sl || seg + 2 >= np) break;
        segS += sl; seg++;
      }
      if (sl < 1e-4) continue;
      const u = clamp((s - segS) / sl, 0, 1);
      _z.set(P[seg * 3 + 3] - P[seg * 3], P[seg * 3 + 4] - P[seg * 3 + 1], P[seg * 3 + 5] - P[seg * 3 + 2]).multiplyScalar(1 / sl);
      _v0.set(P[seg * 3] + _z.x * sl * u, P[seg * 3 + 1] + _z.y * sl * u, P[seg * 3 + 2] + _z.z * sl * u);
      _x.set(_z.z, 0, -_z.x);                              // horizontal, square to the chain
      if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
      _x.normalize();
      _y.crossVectors(_z, _x);
      if (n & 1) { _v1.copy(_x); _x.copy(_y); _y.copy(_v1).negate(); }   // every other link turned 90°
      _m.makeBasis(_x.multiplyScalar(Lk), _y.multiplyScalar(Lk), _z.multiplyScalar(Lk)).setPosition(_v0);
      ch.setMatrixAt(n++, _m);
    }
    return n;
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

  // ─────────────────────────────── IRON GULLY poses (snow-clearance walker) ───────────────────────────────
  private poseGully(w: World, b: BossState, r: BossRig): void {
    const t = this.tgt, X = this.tgtX, time = this.time, tA = this.tA;
    const mk = this.mk;
    const ph = this.gait.phase * PI * 2;
    const charging = (b.data.charge ?? 0) > 0;
    // idle / walk: a LEVEL machine — diesel shiver, a hard plant dip per footfall (no roll, twist or sway),
    // the turret sweeping its headlamps like a searchlight, the spreader idling, the beacon pulsing slowly
    t.dy = -0.7 * mk * Math.abs(Math.sin(ph * 2)) + (Math.sin(time * 41) * 0.12 + Math.sin(time * 27.3) * 0.08) * (1 - 0.6 * mk);
    t.pitch = Math.sin(ph * 2) * 0.008 * mk;
    t.neck = 0.04;
    t.neckYaw = Math.sin(time * 0.45) * 0.24 * (1 - mk);
    t.spin = 1.4; t.auger = 0; t.blade = 0; t.beacon = 0; t.seam = b.meter; t.glow = 1;

    if (this.deadT >= 0) {
      // defeat — a MACHINE COLLAPSE, on the road by ~2.1 s: a shudder as the rotors cut out, then the hydraulic
      // legs fail one at a time (FL, BR, FR, BL, GU_FAIL_T) — each failing ram dumps its corner with a hard jolt,
      // its pad kicks outward and the chassis lurches toward it — grit pours over the rim on the side that went
      // first (gullyGrit), the spinner tips off its shaft, and the hopper belly-flops nose-first onto the plough.
      const d = this.deadT;
      t.spin = 0; t.auger = 0; t.blade = 1.15; t.beacon = 1;
      t.sailTilt = 0.5 * e3(clamp((d - 0.15) / 0.6, 0, 1));
      t.sailRise = -4 * e3(clamp((d - 0.4) / 1.2, 0, 1));
      let sum = 0, pr = 0, rl = 0;
      for (let i = 0; i < 4; i++) {
        const L = r.legs[i];
        const q = d - GU_FAIL_T[GU_DOWN_ORDER[i]];
        const ki = q <= 0 ? 0 : q >= GU_FAIL_S ? 1 : easeOutBack(q / GU_FAIL_S);
        sum += ki;
        pr += Math.sign(L.rest.z) * ki;          // a failing FRONT corner pitches the nose down
        rl -= Math.sign(L.rest.x) * ki;          // a failing +x corner drops the +x side (+roll lifts +x: Rz)
        X[i].set(Math.sign(L.rest.x) * 8 * ki, 0, Math.sign(L.rest.z) * 3.5 * ki);
      }
      const all = sum * 0.25;
      const shud = d < 0.4 ? Math.sin(time * 47) * 0.6 * (1 - d / 0.4) : 0;
      t.dy = -GU_COLLAPSE_DY * all + shud;
      t.pitch = 0.1 * pr + 0.09 * all;           // ends nose-down on the blade
      t.roll = 0.11 * rl + 0.06 * all;           // ends listing to one side
      t.neck = 0.5 * all; t.neckYaw = 0.3 * all;
      t.dim = d < 1.2 ? flick(time) * (1 - d / 1.2) : 0;
      t.seam = d < 0.9 ? 1.4 * flick(time * 1.3) : 0;
      return;
    }
    if (b.staggerT > 0) {
      // FRACTURE full: the spinner jams on a bent shaft, the seams flare, hydraulic pressure drops (sag, splay,
      // the plough drops), the turret droops, the auger coughs, the lamps and the beacon flicker
      const s = smoothstep(0, 0.5, 5 - b.staggerT) * smoothstep(0, 0.6, b.staggerT);
      t.dy = -9 * s; t.pitch = 0.08 * s; t.roll = Math.sin(time * 1.1) * 0.05 * s;
      t.neck = 0.04 + 0.32 * s; t.neckYaw = Math.sin(time * 2.3) * 0.1 * s;
      t.spin = lerp(1.4, 0, s); t.sailTilt = 0.16 * s; t.sailShake = 0.02 * s;
      t.blade = 1.1 * s; t.seam = lerp(b.meter, 1.2 + 0.4 * flick(time), s);
      t.glow = lerp(1, 0.3 + 0.7 * flick(time), s); t.beacon = s;
      t.auger = 4 * s * flick(time * 0.7);
      for (let i = 0; i < 4; i++) { const L = r.legs[i]; X[i].set(Math.sign(L.rest.x) * 3.5 * s, 0, Math.sign(L.rest.z) * 1.5 * s); }
      return;
    }
    if (b.introT > 0 || this.roarT > 0) {
      // start-up / phase beat: the plough lifts, the turret sweeps, lamps + beacon go full, rotors rev (air horn)
      const rt = b.introT > 0 ? (b.introT < 1.6 ? bump(1.6 - b.introT, 0, 1.6) : 0) : bump(1.6 - this.roarT, 0, 1.6);
      t.blade -= 0.6 * rt; t.glow = 1 + 2.5 * rt; t.beacon = Math.max(t.beacon, rt);
      t.neckYaw += Math.sin(time * 2.2) * 0.35 * rt; t.neck -= 0.08 * rt;
      t.spin += 6 * rt; t.auger += 10 * rt; t.sailShake = Math.max(t.sailShake, 0.02 * rt);
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
        // PLATE SPREADER: the magazine jacks up and feeds; the spinner revs to a blur and flings the plates
        const launch = bump(tA, 0, 0.55);
        const rattle = Math.exp(-tA * 1.4);
        t.sailRise = 4.5 * launch; t.sailShake = 0.04 * rattle; t.dy = -1.6 * launch; t.pitch = 0.03 * launch;
        t.spin = 3 + 19 * rattle; t.glow = 1 + 0.8 * rattle; t.beacon = rattle;
        break;
      }
      case 'ridgeCharge': {
        // PLOUGH RUN: the V-blade drops onto the road, the chassis squats nose-down, the front rams tamp
        const W = this.windup(w, b, 'ridgeCharge', 1.5, false);
        if (tA < W && !charging) {
          const p = e3(clamp(tA / W, 0, 1));
          t.blade = 1.05 * p; t.pitch = 0.1 * p; t.dy = -2.8 * p; t.neck = 0.04 + 0.08 * p; t.glow = 1 + 1.6 * p;
          t.beacon = 1; t.auger = 6 * p;
          const sc = Math.sin(clamp(tA / W, 0, 1) * PI * 6);            // front rams tamp alternately (revving)
          X[0].set(0, 2.4 * Math.max(0, sc) * p, 0); X[1].set(0, 2.4 * Math.max(0, -sc) * p, 0);
        } else if (charging) {
          t.blade = 1.05; t.pitch = 0.07; t.neck = 0.12; t.auger = 18; t.glow = 2.2; t.beacon = 1;
          t.dy = -1.6 - 0.8 * Math.abs(Math.sin(ph * 2));
        } else {
          const q = Math.max(0, tA - (b.data.chargeEnd ?? tA));
          const skid = Math.exp(-q * 2.5);
          t.pitch = -0.08 * skid; t.neckYaw = Math.sin(time * 9) * 0.14 * skid; t.blade = 1.05 * skid; t.beacon = skid;
        }
        break;
      }
    }
    for (let i = 0; i < 4; i++) {
      const L = r.legs[i];
      if (L.flinch > 0) { const s = Math.sin((L.flinch / 0.3) * PI); X[i].y += 2 * s; t.dy -= 0.6 * s; }
    }
  }

  /** AUGER BLAST: the turret trains, the auger spins up to a blur, the intake + lamp ring ramp, the nose dips. */
  private gullyBreath(w: World, b: BossState): void {
    const t = this.tgt, time = this.time, tA = this.tA;
    const W = this.windup(w, b, 'coneBreath', 1.8);
    const act = 1.2;
    if (tA < W) {
      const u = clamp(tA / W, 0, 1), p = e3(u);
      t.neck = 0.04 + 0.05 * p; t.pitch = 0.05 * p; t.dy = -1.2 * p; t.auger = 2 + 30 * u * u;
      t.glow = 1 + 3.2 * p; t.beacon = p; t.blade = 0.3 * p; t.sailShake = 0.006 * p;
    } else if (tA < W + act) {
      const q = tA - W;
      const thrust = e3(clamp(q / 0.2, 0, 1));
      t.neck = 0.09; t.pitch = lerp(0.05, -0.035, thrust); t.dy = -0.6; t.auger = 34;
      t.glow = 4 + 0.8 * flick(time); t.neckYaw = Math.sin(time * 17) * 0.025; t.beacon = 1; t.blade = 0.3;
    } else {
      const q = tA - W - act;
      const c = Math.exp(-q * 3);
      t.auger = 20 * c; t.glow = 1 + 2 * c; t.beacon = c;
    }
  }

  /** DOUBLE STAMP: front rams lift and drive down (inner ring), then the hydraulics dump the chassis (outer ring). */
  private gullySlam(w: World, b: BossState): void {
    const t = this.tgt, X = this.tgtX, tS = this.tS;
    const W = this.windup(w, b, 'pawSlamInner', 1.3);
    const gap = 0.5;
    if (tS < W) {
      const p = e3(clamp(tS / W, 0, 1));
      t.pitch = -0.3 * p; t.dy = 5 * p; t.neck = 0.04 - 0.12 * p; t.glow = 1 + 1.5 * p; t.beacon = p; t.blade = -0.4 * p;
      X[0].set(1.5 * p, 19 * p, 6 * p); X[1].set(-1.5 * p, 19 * p, 6 * p);
      X[2].set(0, 0, 3 * p); X[3].set(0, 0, 3 * p);                // hind pads brace forward under the weight
    } else {
      const q = tS - W;
      const slam = q < 0.1 ? 1 - q / 0.1 * 0.2 : Math.exp(-(q - 0.1) * 3) * 0.8;
      const second = bump(q, gap - 0.05, gap + 0.35);
      t.pitch = 0.07 * slam - 0.02 * second; t.dy = -2.6 * slam - 3.4 * second; t.neck = 0.04 + 0.12 * slam + 0.1 * second;
      t.glow = 1 + 1.2 * slam + 1.8 * second; t.sailShake = 0.04 * Math.max(slam, second); t.beacon = 1;
      t.blade = 0.5 * second;
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
      this.augerA += c.auger * dt;
      this.spinA += Math.min(22, c.spin) * dt;
      if (this.augerA > 1e4) this.augerA %= PI * 2;
      if (this.spinA > 1e4) this.spinA %= PI * 2;
      J.auger.rotation.set(0, 0, this.augerA);
      J.blade.rotation.set(lerp(GU_BLADE_UP, GU_BLADE_DOWN, clamp(c.blade, -0.8, 1.2)), 0, 0);
      // carried plough rides 5 m up on its lift rams (reads over the titan); down on the road for PLOUGH RUN etc.
      J.blade.position.y = GU.blade[1] + GU_BLADE_LIFT * (1 - clamp(c.blade, 0, 1));
      const shake = c.sailShake;
      J.sail.position.set(0, GU.sail[1] + c.sailRise, GU.sail[2]);
      J.sail.rotation.set(Math.sin(time * 21) * shake * 0.5, 0, Math.sin(time * 17.3) * shake);
      // spinner: spin about its shaft, tipped by sailTilt (a bent shaft wobbles while jammed)
      J.spin.rotation.set(c.sailTilt, this.spinA, c.sailTilt * 0.5 * Math.sin(time * 3), 'YXZ');
      const G2 = r.groups;
      G2.head.mat.userData.bt.uGlowMul.value = G2.head.glowBase * Math.max(0, c.glow) * dimK;
      // body glow = the beacon bar + blade marker lamps: a slow pulse at idle, a fast strobe in a tell
      const bs = 0.5 + 0.5 * Math.sin(time * (1.6 + 12 * clamp(c.beacon, 0, 1)));
      G2.body.mat.userData.bt.uGlowMul.value = G2.body.glowBase * (0.3 + 0.9 * bs * bs) * dimK;
      // sail glow = the magazine crack seams: FRACTURE made visible on the weak point
      G2.sail.mat.userData.bt.uGlowMul.value = G2.sail.glowBase * (0.05 + 2.4 * clamp(c.seam, 0, 1.6)) * dimK;
      G2.legs.mat.userData.bt.uGlowMul.value = G2.legs.glowBase * dimK;
    }
    r.body.updateMatrix();

    // legs: gait foot targets + pose extras → two-bone IK in root space
    const g = this.gait;
    const LI = r.legInst;
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
      if (LI) {
        // instanced machine legs: stamp pads stay level (a hint of toe-up while swinging), per-leg flash
        segMatrix(_hip, _knee, _v2, _m); LI.upper.setMatrixAt(i, _m);
        segMatrix(_knee, _foot, _v2, _m); LI.lower.setMatrixAt(i, _m);
        _q.setFromEuler(_e.set(liftFrac * 0.12, 0, 0, 'YXZ'));
        _m.compose(_foot, _q, _s.set(1, 1, 1)); LI.foot.setMatrixAt(i, _m);
        (LI.flash.array as Float32Array)[i] = r.groups[L.name].mat.userData.bt.uFlash.value;
        continue;
      }
      segMatrix(_hip, _knee, _v2, L.upper.matrix);
      segMatrix(_knee, _foot, _v2, L.lower.matrix);
      const yaw = r.footYawOut ? Math.atan2(L.rest.x, L.rest.z) : 0;
      _q.setFromEuler(_e.set(r.footYawOut ? 0 : liftFrac * 0.35, yaw, 0, 'YXZ'));
      L.foot.matrix.compose(_foot, _q, _s.set(1, 1, 1));
      L.upper.matrixWorldNeedsUpdate = true; L.lower.matrixWorldNeedsUpdate = true; L.foot.matrixWorldNeedsUpdate = true;
    }
    if (LI) {
      LI.upper.instanceMatrix.needsUpdate = true; LI.lower.instanceMatrix.needsUpdate = true;
      LI.foot.instanceMatrix.needsUpdate = true; LI.flash.needsUpdate = true;
    }
    if (r.grit) this.gullyGrit(r, r.grit);
  }

  /**
   * IRON GULLY defeat: the grit load pours over the rim on the side whose ram failed first (FL: +x, front half) —
   * chunk j leaves the rim at GU_GRIT_T0 + j·GU_GRIT_DT, arcs outward under gravity and comes to rest on the road
   * (a heap building beside the wreck). Rim points follow the live chassis; hidden (0 draws) while alive.
   */
  private gullyGrit(r: BossRig, m: THREE.InstancedMesh): void {
    const d = this.deadT;
    if (d < GU_GRIT_T0) { if (m.visible) m.visible = false; return; }
    m.visible = true;
    const bm = r.body.matrix;
    for (let j = 0; j < GU_GRIT_N; j++) {
      const u = d - GU_GRIT_T0 - j * GU_GRIT_DT;
      const h1 = hash01(j * 3 + 1), h2 = hash01(j * 3 + 2), h3 = hash01(j * 3 + 3);
      if (u <= 0) { _s.set(0, 0, 0); _m.compose(_v0.set(0, 0, 0), _q.identity(), _s); m.setMatrixAt(j, _m); continue; }
      // rim point (body-local): the +x wall's top edge, front two thirds, plus the front rim's +x half
      if (j % 4 === 3) _v0.set(2 + h1 * 11, 14.8, 22.8);
      else _v0.set(hopW(13.5) + 0.4, 14.8, -6 + h1 * 26);
      _v0.applyMatrix4(bm);
      const vx = j % 4 === 3 ? 2 + 3 * h2 : 5 + 6 * h2, vz = j % 4 === 3 ? 5 + 5 * h2 : (h3 - 0.3) * 4, vy = 1 + 3 * h3;
      // time to reach the heap height (0.6 m): y0 + vy·t − g/2·t² = 0.6
      const y0 = _v0.y - 0.6, tl = (vy + Math.sqrt(vy * vy + 2 * GU_GRIT_G * Math.max(0, y0))) / GU_GRIT_G;
      const tt = u < tl ? u : tl;
      _v1.set(_v0.x + vx * tt, u < tl ? _v0.y + vy * tt - 0.5 * GU_GRIT_G * tt * tt : 0.6, _v0.z + vz * tt);
      const sc = 1.6 + 1.6 * h1;
      _q.setFromEuler(_e.set(tt * (4 + 6 * h2), h3 * 6.28, tt * (3 + 5 * h1), 'YXZ'));
      _m.compose(_v1, _q, _s.set(sc, sc, sc));
      m.setMatrixAt(j, _m);
    }
    m.instanceMatrix.needsUpdate = true;
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
      // the hook bites the titan's back: taut cable from the boom tip (x-ray line below)
      const tx = T.px + (T.x - T.px) * a, tz = T.pz + (T.z - T.pz) * a;
      hp.set(tx, T.height * 0.6, tz); hv.set(0, 0, 0); scripted = true;
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
    this.updateLeashXray(leashed, hp, tip);
  }

  /** Always-visible WINCH LEASH line from the hook on the titan's back to the boom tip. */
  private updateLeashXray(on: boolean, A: THREE.Vector3, B: THREE.Vector3): void {
    const X = this.xray;
    if (!on) {
      if (X.core.visible) { X.core.visible = false; X.ink.visible = false; }
      this.leashT = -1;
      return;
    }
    this.leashT = this.leashT < 0 ? 0 : this.leashT + this.fdt;
    // constant pixel width: metres per CSS pixel at the cable's midpoint
    const cam = this.ctx.camera;
    _v2.addVectors(A, B).multiplyScalar(0.5);
    const d = Math.max(1, _v2.distanceTo(cam.position));
    // renderer CSS size, not clientHeight: a layout read here forces a style/layout flush every frame
    const hPx = Math.max(200, this.ctx.renderer.getSize(_cssSize).y || 720);
    const mpp = (d * 2 * Math.tan((cam.fov * PI) / 360)) / hPx;
    const pop = 1 + 0.6 * Math.exp(-this.leashT * 7);                  // the catch snaps taut
    const core = LEASH_CORE_PX * mpp * pop;
    this.cable(X.core, A, B, true, core);
    this.cable(X.ink, A, B, true, core + 2 * LEASH_INK_PX * mpp);
    X.u.uLen.value = A.distanceTo(B);
    X.u.uTime.value = this.time;
  }

  /** Stretch a unit cable between two world points. */
  private cable(m: THREE.Mesh, A: THREE.Vector3, B: THREE.Vector3, on: boolean, thick = CABLE_T): void {
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
    _x.multiplyScalar(thick); _z.multiplyScalar(thick); _y.multiplyScalar(L);
    m.matrix.makeBasis(_x, _y, _z).setPosition(A);
    m.matrixWorldNeedsUpdate = true;
  }
}

