// BLOCKTOOTH — CivilianView (fx lane, CONTRACT §6 / §6.1 / §1 tone).
//
// Purely cosmetic crowds (Math.random is fine here — views may use it; the sim never sees these).
//   * Civilians are little CARTOON PEOPLE: faceted low-poly figures with a head (hair or a hat),
//     neck, torso, hips, two arms with broad mitten hands and two legs with shoes — chunky comic
//     proportions (head ≈ 1/5.5 of the height), painted colour zones.
//   * Ten archetypes (office, casual, kid, elder, courier, dress, hi-vis worker, parka, raincoat,
//     dock worker); each biome mixes SIX of them. Per-instance colours + option bits (hair A/B,
//     hat A/B, bag, umbrella, balloon, tie/scarf/cane) make every crowd member different.
//   * ONE merged geometry per archetype. Every vertex carries `aTag` = (part, colour slot, option
//     bit) and `aPiv` (its limb pivot). The vertex shader (onBeforeCompile on the toon material,
//     and the SAME code in the ink-hull material so outlines deform with the limbs) swings legs
//     about the hips and arms about the shoulders from per-instance `iAnim` (gait phase, swing
//     amplitude, pose id, head yaw), turns / tilts the head, hides unselected options and picks
//     each vertex's colour from five per-instance colours (`iC0..iC4`). Zero per-vertex CPU work:
//     one instanced draw per archetype (+ its hull at Size I–II).
//   * Far away (Size III+, a figure is < ~26 px tall) every civilian is drawn with ONE ~52-tri
//     LOD figure (same animation + colours, no hull) — one draw for the whole crowd.
//   * They live on the SIDEWALK ring of LIVE blocks (Chebyshev liveRadiusByRank around the titan)
//     inside a window around the camera target; count scales with rank so they read as crowds
//     from far away (and with quality). Out-of-window civilians are recycled to fresh sidewalk spots.
//   * Behaviour: mill along the sidewalk (walk cycle phase-locked to speed, glancing at the titan)
//     / stand and gawk (face the titan, look UP at it, point, film it on a phone, wave) → FLEE away
//     from the titan when it is within ~6H (moving) or ~2.5H (standing): full panic run, arms
//     flung up and flailing → calm down once far away.
//   * A titan footstep that lands on them (Size II+) — or a collapse / explosion on top of them —
//     makes them PUFF: a little cream dust pop. Never gore.
//   * Readability vs the HALVARD androids (off-white + safety orange + navy, visors, carbines):
//     civilians never wear that palette, have hair / hats instead of visors, carry bags, phones,
//     umbrellas and balloons instead of weapons, and behave like a crowd.

import * as THREE from 'three';
import type { BiomeId, World } from '../core/types.ts';
import { CITY, PARCEL_HALF } from '../core/config.ts';
import { PROP_INFO, harbourWaterZ } from '../city/citygen.ts';
import { INK, addOutline, bakeOutlineNormals, facet, makeOutlineMaterial, makeToon } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

const CAP = 640;
/** target crowd size by rank (× quality multiplier) */
const CROWD = [70, 160, 320, 520, 640] as const;
const Q_MUL = [0.4, 0.7, 1] as const;
/** civilian scale by rank: a touch larger at distance so the figures survive the zoom-out */
const CIV_SCALE = [1, 1.2, 1.7, 2.5, 3.3] as const;
/** sidewalk band (local offset from the block centre) — parcel edge 26 m … curb 29 m */
const SW_IN = PARCEL_HALF + 0.45;
const SW_OUT = PARCEL_HALF + 2.6;
/** assumed sidewalk top height (city-view owns the real curb mesh) */
const SIDEWALK_Y = 0.16;
const PUFF_CAP = 72;
const PUFF_BALLS = 3;
const PUFF_LIFE = 0.55;
const OUTLINE_W = 1.3;

const ST_EMPTY = 0, ST_MILL = 1, ST_IDLE = 2, ST_FLEE = 3, ST_GONE = 4;
/** pose ids (iAnim.z) */
const P_WALK = 0, P_PANIC = 1, P_POINT = 2, P_PHONE = 3, P_WAVE = 4;

// ─────────────────────────────── option bits (aTag.z / mask) ───────────────────────────────
const O_HAIR_A = 1, O_HAIR_B = 2, O_HAT_A = 3, O_HAT_B = 4, O_BAG = 5, O_PHONE = 6, O_UMB = 7, O_BALLOON = 8, O_EXTRA = 9;
/** option codes decided by the shader from the pose / per-instance style (not by the mask bits):
 *  calm vs PANIC face, the mid figure's generic hat / hair, its skirt (bottom colour) / long coat (top) */
const O_CALM = 10, O_PANIC = 11, O_MHAT = 12, O_MHAIR = 13, O_SKIRT_B = 14, O_SKIRT_T = 15;
const bit = (o: number): number => 1 << (o - 1);

// ─────────────────────────────── colour slots (aTag.y) ───────────────────────────────
const S_SKIN = 0, S_TOP = 1, S_BOTTOM = 2, S_HAIR = 3, S_ACC = 4, S_SHOE = 5, S_INK = 6, S_WHITE = 7, S_GREY = 8, S_LEATHER = 9;
/** shoe palette (iC0.w index) — no off-white: that is the HALVARD androids' livery */
const SHOES = ['#2b2630', '#6b4a33', '#7fd0bf', '#d94a3c', '#ffcf3a', '#3a3036'];

// ─────────────────────────────── parts (aTag.x) ───────────────────────────────
// arms: upper arm (shoulder pivot) + forearm/hand (shoulder pivot, then the elbow = aElb);
// legs: thigh (hip) + shin/shoe (hip, then the knee = aElb)
const PT_BODY = 0, PT_LLEG = 1, PT_RLEG = 2, PT_LARM = 3, PT_RARM = 4, PT_HEAD = 5, PT_LFORE = 6, PT_RFORE = 7, PT_LSHIN = 8, PT_RSHIN = 9;

/** fixed arm poses for held props (shader + authoring must agree) */
const UMB_RX = -0.55, UMB_RZ = -0.12;
const BAL_RX = -0.5, BAL_RZ = 0.25;

// ═════════════════════════════════ geometry toolkit ═════════════════════════════════
type V3 = [number, number, number];

function ring(n: number, rx: number, rz: number, y: number, rot = 0, ox = 0, oz = 0, yf?: (a: number) => number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([ox + Math.sin(a) * rx, yf ? yf(a) : y, oz + Math.cos(a) * rz]);
  }
  return out;
}

function centroid(R: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const p of R) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / R.length, y / R.length, z / R.length];
}

type End = 'cap' | 'none' | V3;

/** Lofted shell through rings of equal point count; ends capped (fan to the ring centroid),
 *  open, or fanned to an apex point. Consistently wound, then oriented outward. */
function loft(rings: V3[][], bot: End = 'cap', top: End = 'cap', shellCentre?: V3): number[] {
  const t: number[] = [];
  const tri = (a: V3, b: V3, c: V3): void => { t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(A[i], A[j], B[j]); tri(A[i], B[j], B[i]);
    }
  }
  const R0 = rings[0], R1 = rings[rings.length - 1];
  if (bot !== 'none') { const c = bot === 'cap' ? centroid(R0) : bot; for (let i = 0; i < R0.length; i++) tri(c, R0[(i + 1) % R0.length], R0[i]); }
  if (top !== 'none') { const c = top === 'cap' ? centroid(R1) : top; for (let i = 0; i < R1.length; i++) tri(c, R1[i], R1[(i + 1) % R1.length]); }
  return shellCentre ? orientFrom(t, shellCentre) : orient(t);
}

/** flip every triangle if the (consistently wound) surface encloses negative volume */
function orient(t: number[]): number[] {
  let cx = 0, cy = 0, cz = 0;
  const n = t.length / 3;
  for (let i = 0; i < t.length; i += 3) { cx += t[i]; cy += t[i + 1]; cz += t[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let vol = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i] - cx, ay = t[i + 1] - cy, az = t[i + 2] - cz;
    const bx = t[i + 3] - cx, by = t[i + 4] - cy, bz = t[i + 5] - cz;
    const qx = t[i + 6] - cx, qy = t[i + 7] - cy, qz = t[i + 8] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  if (vol < 0) flipAll(t);
  return t;
}

/** orient each triangle to face away from a centre point (open shells: hair, hoods) */
function orientFrom(t: number[], c: V3): number[] {
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2];
    const e1x = t[i + 3] - ax, e1y = t[i + 4] - ay, e1z = t[i + 5] - az;
    const e2x = t[i + 6] - ax, e2y = t[i + 7] - ay, e2z = t[i + 8] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const mx = (ax + t[i + 3] + t[i + 6]) / 3 - c[0], my = (ay + t[i + 4] + t[i + 7]) / 3 - c[1], mz = (az + t[i + 5] + t[i + 8]) / 3 - c[2];
    if (nx * mx + ny * my + nz * mz < 0) swapTri(t, i);
  }
  return t;
}

function flipAll(t: number[]): void { for (let i = 0; i < t.length; i += 9) swapTri(t, i); }
function swapTri(t: number[], i: number): void {
  for (let k = 0; k < 3; k++) { const s = t[i + 3 + k]; t[i + 3 + k] = t[i + 6 + k]; t[i + 6 + k] = s; }
}

/** n-sided prism / frustum standing on y0 (footprint rx × rz, top scaled by `taper`) */
function prism(n: number, cx: number, y0: number, cz: number, rx: number, h: number, rz: number, taper = 1, rot = Math.PI / n): number[] {
  return loft([ring(n, rx, rz, y0, rot, cx, cz), ring(n, rx * taper, rz * taper, y0 + h, rot, cx, cz)], 'cap', 'cap');
}

/** box centred at (cx, cy, cz) with full sizes w × h × d */
function box(cx: number, cy: number, cz: number, w: number, h: number, d: number, taper = 1): number[] {
  return prism(4, cx, cy - h / 2, cz, w / Math.SQRT2, h, d / Math.SQRT2, taper, Math.PI / 4);
}

/** convex polygon (x, y pairs) extruded along z from z0 to z1 */
function extrudeXY(pts: number[], z0: number, z1: number): number[] {
  const A: V3[] = [], B: V3[] = [];
  for (let i = 0; i < pts.length; i += 2) { A.push([pts[i], pts[i + 1], z0]); B.push([pts[i], pts[i + 1], z1]); }
  return loft([A, B], 'cap', 'cap');
}

/** small double pyramid ("gem") — buns, pompoms, balloons' knots */
function gem(cx: number, cy: number, cz: number, r: number, h = r, n = 5): number[] {
  return loft([ring(n, r, r, cy, 0, cx, cz)], [cx, cy - h, cz], [cx, cy + h, cz]);
}

function xf(t: number[], m: THREE.Matrix4): number[] {
  const e = m.elements;
  const out = new Array<number>(t.length);
  for (let i = 0; i < t.length; i += 3) {
    const x = t[i], y = t[i + 1], z = t[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
/** T(p) · R · T(−p) */
function about(p: V3, r: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(r).multiply(_m1.makeTranslation(-p[0], -p[1], -p[2]));
}
function rotX(a: number): THREE.Matrix4 { return new THREE.Matrix4().makeRotationX(a); }
function rotZ(a: number): THREE.Matrix4 { return new THREE.Matrix4().makeRotationZ(a); }
/** geometry authored in a held pose → rest-pose coordinates, so the shader's pose (Rx(rx)·Rz(rz)
 *  about the shoulder) lands it exactly where it was authored */
function unpose(t: number[], S: V3, rx: number, rz: number): number[] {
  const inv = _m2.makeRotationZ(-rz).multiply(_m3.makeRotationX(-rx));
  return xf(t, about(S, inv));
}

/** one archetype's merged geometry under construction */
class Fig {
  readonly pos: number[] = [];
  readonly tag: number[] = [];
  readonly piv: number[] = [];
  /** second (inner) joint: the elbow of a forearm / the knee of a shin (= pivot elsewhere) */
  readonly elb: number[] = [];
  /** current group transform (the elder's stoop), applied to geometry AND pivots */
  mat: THREE.Matrix4 | null = null;

  add(t: number[], part: number, slot: number, opt = 0, pivot: V3 = [0, 0, 0], joint?: V3): void {
    let tt = t;
    let p = pivot;
    let e = joint ?? pivot;
    if (this.mat) {
      tt = xf(t, this.mat);
      const q = xf([p[0], p[1], p[2], e[0], e[1], e[2]], this.mat);
      p = [q[0], q[1], q[2]];
      e = [q[3], q[4], q[5]];
    }
    for (let i = 0; i < tt.length; i += 3) {
      this.pos.push(tt[i], tt[i + 1], tt[i + 2]);
      this.tag.push(part, slot, opt, 0);
      this.piv.push(p[0], p[1], p[2]);
      this.elb.push(e[0], e[1], e[2]);
    }
  }

  geometry(): THREE.BufferGeometry {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aTag', new THREE.Float32BufferAttribute(this.tag, 4));
    g.setAttribute('aPiv', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setAttribute('aElb', new THREE.Float32BufferAttribute(this.elb, 3));
    const f = facet(g);
    g.dispose();
    g = f;
    bakeOutlineNormals(g);
    g.computeBoundingSphere();
    return g;
  }
}

// ═════════════════════════════════ figure parts ═════════════════════════════════
interface Dims {
  k: number; hs: number; bulk: number;
  hipY: number; hipX: number; kneeY: number; shY: number; shX: number; neckY: number; headY: number;
  /** shoulder → wrist, and shoulder → elbow */
  armLen: number; upLen: number;
}

/** heads are drawn a touch larger than life — chunky comic proportions, readable faces */
const HEAD_K = 1.1;
/** default arm splay (rest pose): the arms hang clear of the body */
const SPLAY = 0.14;

function dims(k: number, hk = 1, bulk = 1): Dims {
  return {
    k, hs: k * hk * HEAD_K, bulk,
    hipY: 0.70 * k, hipX: 0.074 * k, kneeY: 0.38 * k,
    shY: 1.10 * k, shX: 0.19 * k * bulk,
    neckY: 1.15 * k, headY: 1.18 * k, armLen: 0.41 * k, upLen: 0.2 * k,
  };
}

/** head half-width at height u (head units above the head base) — hair/hat shells follow it */
function headR(u: number): number {
  const P: [number, number][] = [[0, 0.07], [0.06, 0.118], [0.15, 0.128], [0.235, 0.112], [0.285, 0.02]];
  if (u <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) {
    if (u <= P[i][0]) { const [u0, r0] = P[i - 1], [u1, r1] = P[i]; return r0 + (r1 - r0) * (u - u0) / (u1 - u0); }
  }
  return P[P.length - 1][1];
}
const HEX = Math.PI / 6;

/** flat convex polygon (x, y pairs, either winding) facing +Z at depth z — eyes, brows, mouths */
function flat(pts: number[], z: number): number[] {
  let area = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]; }
  const idx = (i: number): number => (area >= 0 ? i : n - 1 - i);
  const t: number[] = [];
  for (let i = 1; i + 1 < n; i++) {
    for (const v of [0, i, i + 1]) { const q = idx(v); t.push(pts[q * 2], pts[q * 2 + 1], z); }
  }
  return t;
}

/** a tapered limb segment along −Y from yA (radius rA) to yB (rB) at x; cloth above `ys`, skin below
 *  (a hem ring closes the cloth). `topApex`: rounded top end this far above yA (null = open). */
function limbSeg(f: Fig, x: number, yA: number, rA: number, yB: number, rB: number, ys: number, cloth: number,
  part: number, piv: V3, joint: V3 | undefined, topApex: number | null, n = 5): void {
  const top: End = topApex === null ? 'none' : [x, yA + topApex, 0];
  if (ys <= yB || ys >= yA) {
    f.add(loft([ring(n, rA, rA, yA, 0, x), ring(n, rB, rB, yB, 0, x)], top, 'none'), part, ys <= yB ? cloth : S_SKIN, 0, piv, joint);
    return;
  }
  const rs = rA + (rB - rA) * (yA - ys) / (yA - yB);
  f.add(loft([ring(n, rA, rA, yA, 0, x), ring(n, rs * 1.14, rs * 1.14, ys, 0, x)], top, 'cap'), part, cloth, 0, piv, joint);
  f.add(loft([ring(n, rs, rs, ys + 0.01, 0, x), ring(n, rB, rB, yB, 0, x)], 'none', 'none'), part, S_SKIN, 0, piv, joint);
}

interface LegOpts { slot?: number; skinFrom?: number | null; shoeH?: number; r?: number; boots?: boolean }
/** thigh (swings about the hip) + shin and shoe (also bend about the knee) */
function legs(f: Fig, d: Dims, o: LegOpts = {}): void {
  const k = d.k, slot = o.slot ?? S_BOTTOM, rm = o.r ?? 1;
  for (const side of [1, -1]) {
    const thigh = side > 0 ? PT_LLEG : PT_RLEG, shin = side > 0 ? PT_LSHIN : PT_RSHIN;
    const x = side * d.hipX;
    const piv: V3 = [x, d.hipY, 0], knee: V3 = [x, d.kneeY, 0];
    const r0 = 0.08 * k * rm, rk = 0.066 * k * rm, r1 = 0.058 * k * rm;
    const ankle = (o.shoeH ?? 0.085) * k;
    const yTop = d.hipY + 0.03 * k;
    const ys = o.skinFrom ?? -1;
    limbSeg(f, x, yTop, r0, d.kneeY - 0.012 * k, rk, ys, slot, thigh, piv, undefined, null);
    limbSeg(f, x, d.kneeY + 0.012 * k, rk * 0.98, ankle, r1, ys, slot, shin, piv, knee, 0.03 * k);
    // shoe / boot: pentagon footprint, rounded toe forward
    const sh = o.boots ? 0.2 * k : ankle + 0.012 * k;
    const sw = (o.boots ? 0.076 : 0.068) * k, sd = 0.125 * k;
    f.add(loft([ring(5, sw, sd, 0, 0, x, 0.035 * k), ring(5, sw * 0.86, sd * 0.74, sh, 0, x, 0.012 * k)], 'none', 'cap'), shin, S_SHOE, 0, piv, knee);
  }
}

function pelvis(f: Fig, d: Dims, slot: number, y0 = 0.60, y1 = 0.80): void {
  const k = d.k, b = d.bulk;
  f.add(loft([ring(6, 0.135 * k * b, 0.092 * k, y0 * k, HEX), ring(6, 0.142 * k * b, 0.096 * k, y1 * k, HEX)], 'cap', 'none'), PT_BODY, slot);
}

/** profile rows: [y, rx, rz] (× k; rx × bulk) — open at the bottom (the hips close it) */
const TORSO: [number, number, number][] = [[0.74, 0.14, 0.095], [1.03, 0.168, 0.106], [1.17, 0.118, 0.082]];
function torso(f: Fig, d: Dims, slot: number, prof: [number, number, number][] = TORSO, bot: End = 'none'): void {
  const k = d.k, b = d.bulk;
  f.add(loft(prof.map(([y, rx, rz]) => ring(6, rx * k * b, rz * k, y * k, HEX)), bot, 'cap'), PT_BODY, slot);
}

/** rest-pose frame of an arm: shoulder S, the splay tilt, and the elbow E */
function armFrame(d: Dims, side: number, splay: number): { S: V3; m: THREE.Matrix4; E: V3 } {
  const S: V3 = [side * d.shX, d.shY, 0];
  const m = new THREE.Matrix4().makeTranslation(S[0], S[1], S[2]).multiply(rotZ(side * splay));
  const e = xf([0, -d.upLen, 0], m);
  return { S, m, E: [e[0], e[1], e[2]] };
}

interface ArmOpts { sleeve: 'long' | 'short'; slot?: number; hand?: number; r?: number; splay?: number }
/** chunky two-segment cartoon arms: upper arm (swings about the shoulder) + forearm (also bends at
 *  the elbow) + a broad rounded mitten hand with a thumb; the right hand holds the phone (phone pose) */
function arms(f: Fig, d: Dims, o: ArmOpts): void {
  const k = d.k, rm = o.r ?? 1, slot = o.slot ?? S_TOP, hand = o.hand ?? S_SKIN;
  const L = d.armLen, U = d.upLen;
  for (const side of [1, -1]) {
    const up = side > 0 ? PT_LARM : PT_RARM, fore = side > 0 ? PT_LFORE : PT_RFORE;
    const { S, m, E } = armFrame(d, side, o.splay ?? SPLAY);
    const rs = 0.074 * k * rm, re = 0.064 * k * rm, rw = 0.054 * k * rm;
    const add = (t: number[], part: number, sl: number, opt = 0): void => f.add(xf(t, m), part, sl, opt, S, part === fore ? E : undefined);
    const sh: End = [0, 0.05 * k, 0];
    if (o.sleeve === 'long') {
      add(loft([ring(6, rs, rs, 0.015 * k, HEX), ring(6, re * 1.04, re * 1.04, -U, HEX)], sh, 'cap'), up, slot);
      add(loft([ring(6, re, re, -U + 0.012 * k, HEX), ring(6, rw * 1.1, rw * 1.1, -L + 0.012 * k, HEX)], [0, -U + 0.045 * k, 0], 'cap'), fore, slot);
    } else {
      const ys = -0.55 * U;
      add(loft([ring(6, rs * 1.1, rs * 1.1, 0.015 * k, HEX), ring(6, rs * 1.08, rs * 1.08, ys, HEX)], sh, 'cap'), up, slot);
      add(loft([ring(6, rs * 0.95, rs * 0.95, ys + 0.01 * k, HEX), ring(6, re * 1.02, re * 1.02, -U, HEX)], 'none', 'cap'), up, S_SKIN);
      add(loft([ring(6, re, re, -U + 0.012 * k, HEX), ring(6, rw, rw, -L + 0.012 * k, HEX)], [0, -U + 0.045 * k, 0], 'none'), fore, S_SKIN);
    }
    // broad rounded mitten: thin across x (palm faces the thigh), wide along z, thumb forward
    // (≈ 18 % bigger than a plain paw, four rings so it swells and rounds off like a cartoon mitten)
    const hx = 0.054 * k * rm, hz = 0.078 * k * rm;
    const hzo = 0.005 * k;
    add(loft([
      ring(6, rw * 0.92, rw * 0.92, -L + 0.02 * k, HEX),
      ring(6, hx * 0.9, hz * 0.84, -L - 0.022 * k, HEX, 0, hzo),
      ring(6, hx, hz, -L - 0.07 * k, HEX, 0, hzo),
      ring(6, hx * 0.84, hz * 0.8, -L - 0.122 * k, HEX, 0, hzo),
    ], 'none', [0, -L - 0.16 * k, hzo]), fore, hand);
    add(gem(0, -L - 0.048 * k, hz * 0.97, 0.029 * k * rm, 0.037 * k * rm, 4), fore, hand);
    if (side < 0) {
      // phone: a slab gripped in front of the palm (only drawn in the phone pose)
      // (held up past the mitten tip so it reads above the hand from the game camera)
      add(box(0, -L - 0.14 * k, hz * 0.6, 0.085 * k, 0.17 * k, 0.02 * k), fore, S_INK, O_PHONE);
    }
  }
}

/** hand centre of an arm in the REST pose (for props held in the hand) */
function handAt(d: Dims, side: number, splay = SPLAY): V3 {
  const r = d.armLen + 0.078 * d.k;
  return [side * d.shX + side * Math.sin(splay) * r, d.shY - Math.cos(splay) * r, 0];
}

/** elbow of an arm in the REST pose (the forearm's second pivot) */
function elbowAt(d: Dims, side: number, splay = SPLAY): V3 { return armFrame(d, side, splay).E; }

/** neck + head + a cartoon face: whites-and-pupils eyes, ink brows and mouth (calm / PANIC
 *  variants picked by the pose in the shader), a little nose */
function head(f: Fig, d: Dims): void {
  const k = d.k, hs = d.hs, y0 = d.headY;
  const piv: V3 = [0, d.neckY, 0];
  f.add(loft([ring(5, 0.05 * k, 0.05 * k, d.neckY - 0.05 * k), ring(5, 0.048 * k, 0.048 * k, y0 + 0.04 * hs)], 'none', 'none'), PT_HEAD, S_SKIN, 0, piv);
  const rows: [number, number, number][] = [[0.055, 0.116, 0.106], [0.15, 0.128, 0.116], [0.235, 0.112, 0.102]];
  f.add(loft(rows.map(([u, rx, rz]) => ring(6, rx * hs, rz * hs, y0 + u * hs, HEX)), [0, y0 - 0.012 * hs, 0.014 * hs], [0, y0 + 0.288 * hs, -0.006 * hs]), PT_HEAD, S_SKIN, 0, piv);
  const fz = 0.104 * hs;
  /** face feature in head units (x, u pairs) */
  const F = (pts: number[], z: number, slot: number, opt = 0): void => f.add(flat(pts.map((v, i) => (i % 2 ? y0 + v * hs : v * hs)), z), PT_HEAD, slot, opt, piv);
  const eu = 0.146;
  for (const s of [1, -1]) {
    const ex = s * 0.037, w = 0.025, h = 0.033;
    F([ex - w, eu, ex - w * 0.62, eu - h, ex + w * 0.62, eu - h, ex + w, eu, ex + w * 0.62, eu + h, ex - w * 0.62, eu + h], fz, S_WHITE);
    const px = ex - s * 0.006, py = eu - 0.004, pw = 0.0125, ph = 0.019;
    F([px - pw, py - ph, px + pw, py - ph, px + pw, py + ph, px - pw, py + ph], fz + 0.0025 * hs, S_INK);
    // brows: calm (level) / PANIC (raised, inner ends up — worried)
    const bt = 0.0125;
    F([s * 0.012, 0.19, s * 0.064, 0.184, s * 0.064, 0.184 + bt, s * 0.012, 0.19 + bt], fz, S_INK, O_CALM);
    F([s * 0.01, 0.214, s * 0.064, 0.196, s * 0.064, 0.196 + bt, s * 0.01, 0.214 + bt], fz, S_INK, O_PANIC);
  }
  // mouth: a small smile / a round open "O" when panicking
  const mz = 0.0985 * hs;
  F([-0.021, 0.084, 0.021, 0.084, 0.012, 0.073, -0.012, 0.073], mz, S_INK, O_CALM);
  F([-0.02, 0.074, -0.013, 0.056, 0.013, 0.056, 0.02, 0.074, 0.013, 0.094, -0.013, 0.094], mz, S_INK, O_PANIC);
  // nose
  f.add(loft([ring(3, 0.018 * hs, 0.011 * hs, y0 + 0.1 * hs, Math.PI, 0, fz - 0.006 * hs)], [0, y0 + 0.088 * hs, fz + 0.01 * hs], [0, y0 + 0.124 * hs, fz - 0.008 * hs]), PT_HEAD, S_SKIN, 0, piv);
}

function headPiv(d: Dims): V3 { return [0, d.neckY, 0]; }

type HairKind = 'short' | 'long' | 'bun' | 'crop';
function hair(f: Fig, d: Dims, kind: HairKind, opt: number): void {
  const hs = d.hs, y0 = d.headY, piv = headPiv(d);
  const front = kind === 'crop' ? 0.205 : 0.225, back = kind === 'long' ? 0.06 : 0.1;
  const yf = (a: number): number => y0 + hs * (back + (front - back) * (0.5 + 0.5 * Math.cos(a)));
  const R1 = ring(6, 1, 1, 0, HEX, 0, 0, yf).map(([x, y, z]): V3 => { const r = headR((y - y0) / hs) * hs * 1.1 + 0.004 * hs; return [x * r, y, z * r - 0.004 * hs]; });
  const R2 = ring(6, headR(0.25) * hs * 1.16, headR(0.25) * hs * 1.1, y0 + 0.25 * hs, HEX, 0, -0.008 * hs);
  f.add(loft([R1, R2], 'none', [0, y0 + (kind === 'crop' ? 0.305 : 0.32) * hs, -0.01 * hs], [0, y0 + 0.15 * hs, 0]), PT_HEAD, S_HAIR, opt, piv);
  if (kind === 'long') f.add(box(0, y0 + 0.13 * hs, -0.088 * hs, 0.235 * hs, 0.24 * hs, 0.07 * hs, 0.95), PT_HEAD, S_HAIR, opt, piv);
  if (kind === 'bun') f.add(gem(0, y0 + 0.3 * hs, -0.078 * hs, 0.058 * hs, 0.052 * hs, 4), PT_HEAD, S_HAIR, opt, piv);
}

type HatKind = 'cap' | 'hardhat' | 'beanie' | 'flatcap' | 'sunhat' | 'hood' | 'parkahood';
function hat(f: Fig, d: Dims, kind: HatKind, opt: number, slot = S_HAIR): void {
  const hs = d.hs, y0 = d.headY, piv = headPiv(d);
  const R = (u: number, m = 1.12): number => headR(u) * hs * m + 0.004 * hs;
  const c: V3 = [0, y0 + 0.15 * hs, 0];
  switch (kind) {
    case 'cap': {
      f.add(loft([ring(6, R(0.2), R(0.2), y0 + 0.2 * hs, HEX, 0, -0.006 * hs), ring(6, R(0.26, 1.08), R(0.26, 1.08), y0 + 0.27 * hs, HEX, 0, -0.01 * hs)], 'none', [0, y0 + 0.32 * hs, -0.01 * hs], c), PT_HEAD, slot, opt, piv);
      f.add(xf(box(0, 0, 0, 0.17 * hs, 0.018 * hs, 0.1 * hs), new THREE.Matrix4().makeTranslation(0, y0 + 0.215 * hs, 0.14 * hs).multiply(rotX(0.12))), PT_HEAD, slot, opt, piv);
      break;
    }
    case 'flatcap': {
      f.add(loft([ring(6, R(0.2), R(0.2) * 1.05, y0 + 0.2 * hs, HEX, 0, 0.012 * hs), ring(6, R(0.2) * 0.96, R(0.2) * 1.02, y0 + 0.265 * hs, HEX, 0, 0.03 * hs)], 'none', [0, y0 + 0.3 * hs, 0.0], c), PT_HEAD, slot, opt, piv);
      f.add(xf(box(0, 0, 0, 0.17 * hs, 0.018 * hs, 0.07 * hs), new THREE.Matrix4().makeTranslation(0, y0 + 0.215 * hs, 0.145 * hs).multiply(rotX(0.3))), PT_HEAD, slot, opt, piv);
      break;
    }
    case 'hardhat': {
      const rb = 0.175 * hs, rd = R(0.2, 1.14);
      f.add(loft([
        ring(6, rb, rb * 1.08, y0 + 0.205 * hs, HEX, 0, 0.014 * hs), ring(6, rb, rb * 1.08, y0 + 0.222 * hs, HEX, 0, 0.014 * hs),
        ring(6, rd, rd, y0 + 0.226 * hs, HEX), ring(6, rd * 0.84, rd * 0.84, y0 + 0.305 * hs, HEX),
      ], 'cap', [0, y0 + 0.34 * hs, 0]), PT_HEAD, slot, opt, piv);
      break;
    }
    case 'beanie': {
      f.add(loft([ring(6, R(0.19, 1.14), R(0.19, 1.14), y0 + 0.19 * hs, HEX, 0, -0.008 * hs), ring(6, R(0.25, 1.1), R(0.25, 1.1), y0 + 0.255 * hs, HEX, 0, -0.01 * hs)], 'none', [0, y0 + 0.34 * hs, -0.01 * hs], c), PT_HEAD, slot, opt, piv);
      f.add(gem(0, y0 + 0.36 * hs, 0, 0.042 * hs, 0.036 * hs, 4), PT_HEAD, S_WHITE, opt, piv);
      break;
    }
    case 'sunhat': {
      const rb = 0.235 * hs;
      f.add(loft([ring(6, rb, rb, y0 + 0.205 * hs, HEX), ring(6, R(0.22, 1.12), R(0.22, 1.12), y0 + 0.226 * hs, HEX), ring(6, R(0.22, 1.0), R(0.22, 1.0), y0 + 0.315 * hs, HEX)], 'cap', 'cap'), PT_HEAD, slot, opt, piv);
      f.add(loft([ring(6, R(0.22, 1.135), R(0.22, 1.135), y0 + 0.226 * hs, HEX), ring(6, R(0.22, 1.1), R(0.22, 1.1), y0 + 0.26 * hs, HEX)], 'none', 'none', c), PT_HEAD, S_ACC, opt, piv);
      break;
    }
    case 'hood':
    case 'parkahood': {
      // open shell around the face: low at the sides / back, framing the face at the front
      const yf = (a: number): number => {
        const cz = Math.cos(a);
        return y0 + hs * (cz > 0.55 ? 0.02 + 0.24 * (cz - 0.55) / 0.45 : -0.04 * Math.max(0, -cz));
      };
      const R1 = ring(6, 1, 1, 0, 0, 0, 0, yf).map(([x, y, z]): V3 => { const r = headR(Math.max(0.06, (y - y0) / hs)) * hs * 1.2 + 0.012 * hs; return [x * r, y, z * r - 0.012 * hs]; });
      const R2 = ring(6, R(0.24, 1.24), R(0.24, 1.2), y0 + 0.24 * hs, 0, 0, -0.02 * hs);
      f.add(loft([R1, R2], 'none', [0, y0 + 0.345 * hs, -0.03 * hs], c), PT_HEAD, S_TOP, opt, piv);
      if (kind === 'parkahood') f.add(gem(0, y0 + 0.27 * hs, 0.085 * hs, 0.1 * hs, 0.035 * hs, 6), PT_HEAD, S_WHITE, opt, piv);
      break;
    }
  }
}

// ═════════════════════════════════ archetypes ═════════════════════════════════
interface Look { skin: string; top: string; bottom: string; hair: string; acc: string; shoe: number; mask: number }
interface Arch {
  id: string;
  build(f: Fig): void;
  /** metres per step at scale 1 (phase locks to speed) */
  stride: number;
  /** walk swing amplitude multiplier */
  swing: number;
  /** milling speed multiplier */
  pace: number;
  /** LOD figure scale (the LOD mesh is adult-sized) */
  lod: number;
  /** mid-figure style bits (iC3.w): 1 = skirt in the bottom colour, 2 = long coat in the top colour */
  mid?: number;
  look(b: BiomeId): Look;
}

const pick = <T,>(a: readonly T[]): T => a[(Math.random() * a.length) | 0];
const chance = (p: number): boolean => Math.random() < p;

const SKIN = ['#f3d2b3', '#e2b48f', '#c98e66', '#9c6a48', '#6e4a33', '#f6dcc4'];
const HAIR = ['#2a2226', '#4a3226', '#6f4a30', '#a0582e', '#d9b36a', '#2a2226', '#3a2a24'];
const HAIR_OLD = ['#bdb8b0', '#e6e1d8', '#9a948d'];
const HAIR_FUN = ['#ff8fc1', '#6fc8ff', '#b98bff', '#7ad97a'];
// GRID-EAST city pop (no off-white tops, no safety orange — that is the androids' livery)
const GE_TOP = ['#ff6f5e', '#ffd166', '#3fb8ff', '#7ad97a', '#b98bff', '#ff9ec7', '#44d2c2', '#e84a3c', '#5b7cff', '#f7e27a', '#9be1ff', '#c3f07a'];
const GE_BOTTOM = ['#4a6fa5', '#5b84c4', '#b5654a', '#c8b08a', '#4a4550', '#2f2b36', '#8a6fb0', '#6a9a8a'];
const SUIT = ['#4a4550', '#5d6b7a', '#b89b72', '#7a3444', '#3e6b55', '#8a8f99', '#6b5a8a'];
const TIE = ['#e84a3c', '#ffd166', '#3fb8ff', '#ff6f5e', '#b98bff', '#44d2c2', '#ff9ec7'];
const ACC_GE = ['#ff6f5e', '#ffd166', '#3fb8ff', '#7ad97a', '#b98bff', '#ff9ec7', '#44d2c2', '#e84a3c'];
// WHITE STACKS — winter wardrobe
const WS_COAT = ['#d9483b', '#2f8f8a', '#d9a52b', '#7b4a7a', '#3e6b55', '#4f8fd0', '#c24d6e', '#8a5a3a'];
const WS_SHIRT = ['#8e3b35', '#4f6d8f', '#6b7a3e', '#7a5a3a', '#5d6b7a', '#a04a5a'];
const WS_BOTTOM = ['#4a4550', '#5a4636', '#4a6fa5', '#2f2b36', '#6b6f76', '#6a5a48'];
const WS_KNIT = ['#e84a3c', '#ffd166', '#44d2c2', '#b98bff', '#ff9ec7', '#7ad97a', '#3fb8ff'];
const HIVIS = ['#d4f53c', '#c6f03a', '#e3fa55'];
const HARDHAT = ['#ffd23f', '#44d2c2', '#e84a3c', '#3fb8ff', '#7ad97a'];
// LOCKWATER — night rain: bright slickers read against the dark water
const LW_SLICK = ['#ffd23f', '#e84a3c', '#ff6fae', '#36c9c6', '#8fd14f', '#b98bff', '#ffe066'];
const LW_UMB = ['#ff3fa4', '#3ff0ff', '#ffd23f', '#e84a3c', '#b98bff', '#7ad97a', '#36c9c6'];
const LW_TOP = ['#6b7a8a', '#8e3b35', '#3f5a4a', '#5b7cff', '#ff6fae', '#44d2c2', '#9aa4ad', '#c24d6e'];
const LW_BOTTOM = ['#4a6fa5', '#6b7a3e', '#5a4636', '#2f2b36', '#4a4550'];

function hairOrHat(pHat: number, pHatB: number, pB: number): number {
  const r = Math.random();
  if (r < pHat) return bit(O_HAT_A);
  if (r < pHat + pHatB) return bit(O_HAT_B);
  return chance(pB) ? bit(O_HAIR_B) : bit(O_HAIR_A);
}
const hairCol = (): string => (chance(0.08) ? pick(HAIR_FUN) : pick(HAIR));
/** the headwear colour doubles as the hair colour (hair is hidden under a hat) */
function headCol(mask: number, hatA: () => string, hatB: () => string, hairC: () => string = hairCol): string {
  if (mask & bit(O_HAT_A)) return hatA();
  if (mask & bit(O_HAT_B)) return hatB();
  return hairC();
}

/** thin 3-sided rod between two points (canes, shafts, strings) */
function rod(a: V3, b: V3, r: number): number[] {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length(); dir.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1));
  return xf(loft([ring(3, r, r, 0), ring(3, r, r, len)], 'none', 'none'), m);
}

/** flat strip (bag straps) from a to b, width w, lying on the z-facing plane at depth z */
function strap(ax: number, ay: number, bx: number, by: number, w: number, z0: number, z1: number): number[] {
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * w * 0.5, ny = (dx / l) * w * 0.5;
  return extrudeXY([ax + nx, ay + ny, ax - nx, ay - ny, bx - nx, by - ny, bx + nx, by + ny], z0, z1);
}

const ARCH: Record<string, Arch> = {
  office: {
    id: 'office', stride: 0.62, swing: 0.9, pace: 1.05, lod: 1,
    build(f) {
      const d = dims(1);
      legs(f, d, {});
      pelvis(f, d, S_TOP, 0.6, 0.8);            // jacket hem over the hips
      torso(f, d, S_TOP);
      // shirt V + tie
      f.add(extrudeXY([-0.052, 1.14, 0.052, 1.14, 0, 0.985], 0.066, 0.094), PT_BODY, S_WHITE);
      f.add(extrudeXY([0, 1.1, 0.028, 1.05, 0, 0.82, -0.028, 1.05], 0.08, 0.104), PT_BODY, S_ACC, O_EXTRA);
      arms(f, d, { sleeve: 'long' });
      head(f, d);
      hair(f, d, 'short', O_HAIR_A); hair(f, d, 'long', O_HAIR_B);
      // briefcase in the left hand
      const h = handAt(d, 1);
      f.add(box(h[0] + 0.012, h[1] - 0.11, h[2], 0.065, 0.2, 0.28), PT_LFORE, S_LEATHER, O_BAG, [d.shX, d.shY, 0], elbowAt(d, 1));
    },
    look(b) {
      const mask = hairOrHat(0, 0, 0.35) | (chance(0.7) ? bit(O_EXTRA) : 0) | (chance(0.45) ? bit(O_BAG) : 0);
      const suit = b === 'lockwater' ? pick(['#4a4550', '#5d6b7a', '#6b5a8a', '#3e6b55', '#7a3444']) : b === 'whitestacks' ? pick(['#4a4550', '#7a3444', '#5a4636', '#3e6b55']) : pick(SUIT);
      return { skin: pick(SKIN), top: suit, bottom: chance(0.7) ? suit : pick(['#4a4550', '#2f2b36', '#c8b08a']), hair: hairCol(), acc: pick(TIE), shoe: pick([0, 1, 0]), mask };
    },
  },
  casual: {
    id: 'casual', stride: 0.62, swing: 1, pace: 1, lod: 1,
    build(f) {
      const d = dims(1);
      legs(f, d, {});
      pelvis(f, d, S_BOTTOM);
      torso(f, d, S_TOP);
      arms(f, d, { sleeve: 'short' });
      head(f, d);
      hair(f, d, 'short', O_HAIR_A); hair(f, d, 'long', O_HAIR_B);
      hat(f, d, 'cap', O_HAT_A); hat(f, d, 'beanie', O_HAT_B);
      f.add(box(0, 0.93, -0.135, 0.22, 0.27, 0.1, 0.9), PT_BODY, S_ACC, O_BAG);                   // backpack
    },
    look(b) {
      const cold = b === 'whitestacks';
      const mask = hairOrHat(cold ? 0.08 : 0.25, cold ? 0.4 : 0.04, 0.4) | (chance(0.35) ? bit(O_BAG) : 0);
      const top = b === 'grideast' ? pick(GE_TOP) : cold ? pick(WS_COAT) : pick(LW_TOP);
      const acc = b === 'lockwater' ? pick(LW_SLICK) : pick(ACC_GE);
      return { skin: pick(SKIN), top, bottom: pick(b === 'grideast' ? GE_BOTTOM : cold ? WS_BOTTOM : LW_BOTTOM), hair: headCol(mask, () => pick(ACC_GE), () => pick(WS_KNIT)), acc, shoe: pick([2, 2, 0, 3, 1]), mask };
    },
  },
  kid: {
    id: 'kid', stride: 0.42, swing: 1.15, pace: 1.1, lod: 0.68,
    build(f) {
      const d = dims(0.66, 1.32, 1.05);
      legs(f, d, { skinFrom: 0.33, r: 1.1 });
      pelvis(f, d, S_BOTTOM);
      torso(f, d, S_TOP, [[0.74, 0.142, 0.1], [1.03, 0.16, 0.105], [1.17, 0.115, 0.082]]);
      arms(f, d, { sleeve: 'short', r: 1.12 });
      head(f, d);
      hair(f, d, 'crop', O_HAIR_A);
      hat(f, d, 'cap', O_HAT_A); hat(f, d, 'beanie', O_HAT_B);
      // balloon on a string, held up in the left hand (authored in the held pose)
      const S: V3 = [d.shX, d.shY, 0];
      const hq = xf([...handAt(d, 1)], about(S, new THREE.Matrix4().makeRotationX(BAL_RX).multiply(rotZ(BAL_RZ))));
      const hp: V3 = [hq[0], hq[1], hq[2]];
      const top: V3 = [hp[0] + 0.05, hp[1] + 0.56, hp[2] - 0.04];
      f.add(unpose(rod(hp, top, 0.006), S, BAL_RX, BAL_RZ), PT_LARM, S_INK, O_BALLOON, S);
      const bal = loft([ring(6, 0.085, 0.085, top[1] + 0.06, 0, top[0], top[2]), ring(6, 0.13, 0.13, top[1] + 0.16, 0, top[0], top[2]), ring(6, 0.11, 0.11, top[1] + 0.27, 0, top[0], top[2])],
        [top[0], top[1] - 0.01, top[2]], [top[0], top[1] + 0.335, top[2]]);
      f.add(unpose(bal, S, BAL_RX, BAL_RZ), PT_LARM, S_ACC, O_BALLOON, S);
    },
    look(b) {
      const mask = hairOrHat(b === 'whitestacks' ? 0.05 : 0.22, b === 'whitestacks' ? 0.55 : 0.04, 0) | (chance(b === 'grideast' ? 0.35 : 0.15) ? bit(O_BALLOON) : 0);
      const top = b === 'grideast' ? pick(GE_TOP) : b === 'whitestacks' ? pick(WS_COAT) : pick(LW_SLICK);
      return { skin: pick(SKIN), top, bottom: pick(b === 'grideast' ? GE_BOTTOM : WS_BOTTOM), hair: headCol(mask, () => pick(ACC_GE), () => pick(WS_KNIT)), acc: pick(b === 'lockwater' ? LW_UMB : ACC_GE), shoe: b === 'lockwater' ? 4 : pick([2, 3, 2]), mask };
    },
  },
  elder: {
    id: 'elder', stride: 0.42, swing: 0.55, pace: 0.6, lod: 0.95,
    build(f) {
      const d = dims(0.97, 1.02, 1.04);
      legs(f, d, {});
      pelvis(f, d, S_BOTTOM);
      f.mat = about([0, d.hipY, 0], rotX(0.2));    // stoop
      torso(f, d, S_TOP, [[0.74, 0.142, 0.096], [1.0, 0.162, 0.112], [1.16, 0.115, 0.084]]);
      f.add(extrudeXY([-0.045, 1.12, 0.045, 1.12, 0, 1.01], 0.072, 0.102), PT_BODY, S_WHITE);   // collar
      arms(f, d, { sleeve: 'long', splay: 0.08 });
      head(f, d);
      hair(f, d, 'crop', O_HAIR_A); hair(f, d, 'bun', O_HAIR_B);
      hat(f, d, 'flatcap', O_HAT_A); hat(f, d, 'sunhat', O_HAT_B);
      // walking cane in the right hand
      const h = handAt(d, -1, 0.08);
      f.add(rod([h[0], h[1] + 0.02, h[2] + 0.07], [h[0], 0.02 - 0.15, h[2] + 0.12], 0.016), PT_RFORE, S_LEATHER, O_EXTRA, [-d.shX, d.shY, 0], elbowAt(d, -1, 0.08));
      f.mat = null;
    },
    look(b) {
      const mask = hairOrHat(0.35, 0.15, 0.3) | (chance(0.6) ? bit(O_EXTRA) : 0);
      const top = b === 'whitestacks' ? pick(WS_COAT) : pick(['#b0785a', '#7a8f6a', '#8a6fb0', '#c9a86a', '#6f8fb0', '#a05a5a']);
      return { skin: pick(SKIN), top, bottom: pick(['#6b6f76', '#5a4636', '#c8b08a', '#4a4550']), hair: headCol(mask, () => pick(['#6b5a4a', '#5d6b7a', '#8a6a4a']), () => pick(['#e8d9b0', '#f0c0c8', '#c9e0f0']), () => pick(HAIR_OLD)), acc: pick(ACC_GE), shoe: pick([1, 0]), mask };
    },
  },
  courier: {
    id: 'courier', stride: 0.64, swing: 1.05, pace: 1.35, lod: 1,
    build(f) {
      const d = dims(1);
      legs(f, d, { skinFrom: 0.46 });
      pelvis(f, d, S_BOTTOM);
      torso(f, d, S_TOP);
      arms(f, d, { sleeve: 'short' });
      head(f, d);
      hat(f, d, 'cap', 0, S_ACC);
      // messenger bag on the right hip + strap across the chest
      f.add(box(-0.175, 0.74, 0.02, 0.085, 0.17, 0.25), PT_BODY, S_ACC);
      f.add(strap(0.13, 1.15, -0.15, 0.8, 0.045, 0.083, 0.105), PT_BODY, S_ACC);
    },
    look(b) {
      const acc = pick(b === 'lockwater' ? LW_SLICK : ['#ffd166', '#7ad97a', '#3fb8ff', '#e84a3c', '#b98bff', '#44d2c2']);
      const top = b === 'whitestacks' ? pick(WS_COAT) : b === 'lockwater' ? pick(LW_TOP) : pick(['#44d2c2', '#5b7cff', '#ff9ec7', '#7ad97a', '#b98bff', '#f7e27a', '#3fb8ff']);
      // the cap is always worn (bit only drives the far/mid figures' generic hat)
      return { skin: pick(SKIN), top, bottom: pick(['#4a4550', '#2f2b36', '#6b7a3e', '#c8b08a']), hair: acc, acc, shoe: pick([2, 0, 3]), mask: bit(O_HAT_A) };
    },
  },
  dress: {
    id: 'dress', stride: 0.56, swing: 0.78, pace: 0.95, lod: 0.98, mid: 1,
    build(f) {
      const d = dims(0.98, 1.02, 0.95);
      legs(f, d, { skinFrom: 0.5, r: 0.9 });
      // A-line skirt from the waist to the knee
      f.add(loft([ring(6, 0.13, 0.092, 0.79, HEX), ring(6, 0.21, 0.18, 0.46, HEX)], 'none', 'cap'), PT_BODY, S_BOTTOM);
      torso(f, d, S_TOP, [[0.74, 0.125, 0.086], [1.03, 0.152, 0.097], [1.17, 0.11, 0.074]]);
      arms(f, d, { sleeve: 'short', r: 0.92 });
      head(f, d);
      hair(f, d, 'long', O_HAIR_A); hair(f, d, 'bun', O_HAIR_B);
      hat(f, d, 'sunhat', O_HAT_A);
      // shoulder bag at the left hip on a strap
      f.add(box(0.2, 0.73, 0.0, 0.07, 0.15, 0.2, 0.85), PT_BODY, S_ACC, O_BAG);
      f.add(strap(-0.1, 1.15, 0.19, 0.8, 0.03, 0.078, 0.098), PT_BODY, S_ACC, O_BAG);
    },
    look(b) {
      const mask = hairOrHat(b === 'grideast' ? 0.25 : 0.05, 0, 0.45) | (chance(0.6) ? bit(O_BAG) : 0);
      const pal = b === 'grideast' ? GE_TOP : b === 'whitestacks' ? WS_COAT : LW_TOP;
      const dressC = pick(pal);
      return { skin: pick(SKIN), top: chance(0.5) ? dressC : pick(pal), bottom: dressC, hair: headCol(mask, () => pick(['#f3d98a', '#f0c0c8', '#ffe8a0', '#c9e0f0']), hairCol), acc: pick(ACC_GE), shoe: pick([3, 0, 1, 2]), mask };
    },
  },
  worker: {
    id: 'worker', stride: 0.64, swing: 0.95, pace: 0.9, lod: 1,
    build(f) {
      const d = dims(1.02, 1, 1.06);
      legs(f, d, { boots: true, r: 1.08 });
      pelvis(f, d, S_BOTTOM);
      torso(f, d, S_TOP);
      // hi-vis vest (open tube just outside the torso) + two reflective bands
      const s = 1.02 * 1.06, kz = 1.02;
      f.add(loft([ring(6, 0.148 * s * 1.08, 0.098 * kz * 1.1, 0.78 * kz, HEX), ring(6, 0.163 * s * 1.08, 0.1 * kz * 1.1, 1.03 * kz, HEX), ring(6, 0.128 * s * 1.08, 0.088 * kz * 1.1, 1.14 * kz, HEX)], 'none', 'none'), PT_BODY, S_ACC);
      for (const [y, rx, rz] of [[0.85, 0.156, 0.1], [0.96, 0.162, 0.101]] as [number, number, number][]) {
        f.add(loft([ring(6, rx * s * 1.1, rz * kz * 1.12, y * kz, HEX), ring(6, rx * s * 1.1, rz * kz * 1.12, (y + 0.035) * kz, HEX)], 'none', 'none'), PT_BODY, S_WHITE);
      }
      arms(f, d, { sleeve: 'long', hand: S_LEATHER, r: 1.05 });
      head(f, d);
      hat(f, d, 'hardhat', O_HAT_A); hat(f, d, 'beanie', O_HAT_B); hair(f, d, 'crop', O_HAIR_A);
    },
    look() {
      const mask = hairOrHat(0.72, 0.22, 0);
      return { skin: pick(SKIN), top: pick(WS_SHIRT), bottom: pick(['#5a4636', '#4a4550', '#4a6fa5', '#6b6f76']), hair: headCol(mask, () => pick(HARDHAT), () => pick(WS_KNIT)), acc: pick(HIVIS), shoe: 5, mask };
    },
  },
  parka: {
    id: 'parka', stride: 0.58, swing: 0.8, pace: 0.9, lod: 1.05,
    build(f) {
      const d = dims(1, 1, 1.12);
      legs(f, d, { r: 1.05, boots: true });
      // puffy quilted parka from the hips to the collar
      torso(f, d, S_TOP, [[0.56, 0.155, 0.112], [0.66, 0.168, 0.122], [0.76, 0.152, 0.114], [0.9, 0.172, 0.126], [1.0, 0.158, 0.118], [1.1, 0.172, 0.122], [1.19, 0.11, 0.086]], 'cap');
      arms(f, d, { sleeve: 'long', r: 1.2, splay: 0.2, hand: S_ACC });
      head(f, d);
      hat(f, d, 'parkahood', O_HAT_A); hat(f, d, 'beanie', O_HAT_B, S_ACC); hair(f, d, 'short', O_HAIR_A);
      // scarf: a collar ring + a tail hanging down the chest
      f.add(loft([ring(6, 0.082, 0.078, 1.13, HEX), ring(6, 0.078, 0.074, 1.21, HEX)], 'none', 'none'), PT_BODY, S_ACC, O_EXTRA);
      f.add(box(0.055, 1.04, 0.118, 0.065, 0.18, 0.03), PT_BODY, S_ACC, O_EXTRA);
    },
    look() {
      const mask = hairOrHat(0.4, 0.38, 0) | (chance(0.55) ? bit(O_EXTRA) : 0);
      const top = pick(WS_COAT), acc = pick(WS_KNIT);
      // hood = coat colour, beanie = knit colour (the S_HAIR colour then only feeds the mid figure's hat)
      return { skin: pick(SKIN), top, bottom: pick(WS_BOTTOM), hair: headCol(mask, () => top, () => acc), acc, shoe: pick([5, 1, 5]), mask };
    },
  },
  raincoat: {
    id: 'raincoat', stride: 0.6, swing: 0.78, pace: 0.95, lod: 1, mid: 2,
    build(f) {
      const d = dims(1);
      legs(f, d, { boots: true });
      // long slicker: torso + a flared skirt to the knee
      torso(f, d, S_TOP);
      f.add(loft([ring(6, 0.145, 0.1, 0.8, HEX), ring(6, 0.19, 0.14, 0.44, HEX)], 'none', 'cap'), PT_BODY, S_TOP);
      f.add(extrudeXY([-0.012, 1.14, 0.012, 1.14, 0.012, 0.46, -0.012, 0.46], 0.084, 0.118), PT_BODY, S_INK);  // placket
      arms(f, d, { sleeve: 'long', r: 1.1 });
      head(f, d);
      hat(f, d, 'hood', O_HAT_A); hair(f, d, 'short', O_HAIR_A); hair(f, d, 'long', O_HAIR_B);
      // umbrella in the right hand, held up over the head (authored in the held pose)
      const S: V3 = [-d.shX, d.shY, 0];
      const hq = xf([...handAt(d, -1)], about(S, new THREE.Matrix4().makeRotationX(UMB_RX).multiply(rotZ(UMB_RZ))));
      const hp: V3 = [hq[0], hq[1], hq[2]];
      const top: V3 = [-0.03, 1.86, 0.03];
      f.add(unpose(rod([hp[0], hp[1] - 0.06, hp[2]], top, 0.012), S, UMB_RX, UMB_RZ), PT_RARM, S_INK, O_UMB, S);
      const cy = top[1] - 0.12;
      const can = loft([ring(6, 0.52, 0.52, cy, 0, top[0], top[2]), ring(6, 0.3, 0.3, cy + 0.12, 0, top[0], top[2])], [top[0], cy + 0.05, top[2]], [top[0], cy + 0.2, top[2]]);
      f.add(unpose(can, S, UMB_RX, UMB_RZ), PT_RARM, S_ACC, O_UMB, S);
    },
    look() {
      const umb = chance(0.45);
      const mask = (umb ? (chance(0.5) ? bit(O_HAIR_A) : bit(O_HAIR_B)) : hairOrHat(0.6, 0, 0.4)) | (umb ? bit(O_UMB) : 0);
      const top = pick(LW_SLICK);
      return { skin: pick(SKIN), top, bottom: pick(LW_BOTTOM), hair: headCol(mask, () => top, () => top), acc: pick(LW_UMB), shoe: pick([4, 5, 3]), mask };
    },
  },
  dock: {
    id: 'dock', stride: 0.64, swing: 0.95, pace: 0.85, lod: 1.02,
    build(f) {
      const k = 1.03;
      const d = dims(k, 0.98, 1.1);
      legs(f, d, { boots: true, r: 1.12 });
      pelvis(f, d, S_BOTTOM);
      torso(f, d, S_TOP);
      // overall bib + shoulder straps
      f.add(extrudeXY([-0.085 * k, 0.8 * k, 0.085 * k, 0.8 * k, 0.075 * k, 1.03 * k, -0.075 * k, 1.03 * k], 0.078 * k, 0.108 * k), PT_BODY, S_BOTTOM);
      for (const s of [1, -1]) f.add(strap(s * 0.065 * k, 1.02 * k, s * 0.085 * k, 1.17 * k, 0.03 * k, 0.06 * k, 0.1 * k), PT_BODY, S_BOTTOM);
      arms(f, d, { sleeve: 'long', hand: S_LEATHER, r: 1.12 });
      head(f, d);
      hat(f, d, 'beanie', O_HAT_A); hair(f, d, 'crop', O_HAIR_A);
    },
    look() {
      const mask = hairOrHat(0.7, 0, 0);
      return { skin: pick(SKIN), top: pick(['#8e3b35', '#6b7a8a', '#3f5a4a', '#c9a86a', '#ffd23f']), bottom: pick(['#6b7a3e', '#4a6fa5', '#5a4636', '#e84a3c']), hair: headCol(mask, () => pick(['#e84a3c', '#36c9c6', '#ffd23f', '#7ad97a']), hairCol), acc: pick(LW_SLICK), shoe: 5, mask };
    },
  },
};

/** six archetypes per biome with their crowd weights */
const BIOME_MIX: Record<BiomeId, [string, number][]> = {
  grideast: [['office', 22], ['casual', 26], ['kid', 13], ['elder', 10], ['courier', 12], ['dress', 17]],
  whitestacks: [['worker', 26], ['parka', 28], ['kid', 11], ['elder', 9], ['office', 12], ['casual', 14]],
  lockwater: [['raincoat', 32], ['dock', 20], ['kid', 11], ['elder', 9], ['courier', 12], ['casual', 16]],
};

/** ~52-tri far figure: same parts, pivots and colour slots as the full archetypes */
function buildLod(): THREE.BufferGeometry {
  const f = new Fig();
  const d = dims(1);
  for (const side of [1, -1]) {
    const x = side * d.hipX;
    f.add(loft([ring(3, 0.07, 0.07, d.hipY + 0.03, 0, x), ring(3, 0.055, 0.07, 0, 0, x, 0.03)], 'none', 'none'), side > 0 ? PT_LLEG : PT_RLEG, S_BOTTOM, 0, [x, d.hipY, 0]);
    const S: V3 = [side * d.shX, d.shY, 0];
    f.add(loft([ring(3, 0.06, 0.06, d.shY + 0.04, 0, side * (d.shX + 0.01)), ring(3, 0.05, 0.05, d.shY - 0.5, 0, side * (d.shX + 0.05))], 'none', 'none'), side > 0 ? PT_LARM : PT_RARM, S_TOP, 0, S);
  }
  f.add(loft([ring(4, 0.19, 0.13, 0.6, Math.PI / 4), ring(4, 0.2, 0.135, 0.8, Math.PI / 4)], 'cap', 'none'), PT_BODY, S_BOTTOM);
  f.add(loft([ring(4, 0.2, 0.135, 0.78, Math.PI / 4), ring(4, 0.22, 0.13, 1.17, Math.PI / 4)], 'none', 'cap'), PT_BODY, S_TOP);
  const hp = headPiv(d), y = d.headY;
  f.add(loft([ring(4, 0.17, 0.155, y + 0.14, Math.PI / 4)], [0, y - 0.03, 0], 'none'), PT_HEAD, S_SKIN, 0, hp);
  f.add(loft([ring(4, 0.17, 0.155, y + 0.14, Math.PI / 4)], 'none', [0, y + 0.33, -0.02]), PT_HEAD, S_HAIR, 0, hp);
  return f.geometry();
}

/** ~240-tri MID figure (a figure ~12–40 px tall): ONE geometry for every archetype, one draw (+ hull)
 *  for the whole crowd. Same parts / pivots / colour slots / poses as the full figures, elbows
 *  included; per-instance option bits pick hair / long hair / hat / bag, the style bits (iC3.w) a
 *  skirt or a long coat. */
function buildMid(): THREE.BufferGeometry {
  const f = new Fig();
  const d = dims(1, 1.06);
  const Q = Math.PI / 4;
  for (const side of [1, -1]) {
    const part = side > 0 ? PT_LLEG : PT_RLEG, x = side * d.hipX, piv: V3 = [x, d.hipY, 0];
    f.add(loft([ring(4, 0.082, 0.082, d.hipY + 0.03, Q, x), ring(4, 0.062, 0.062, 0.08, Q, x)], 'none', 'none'), part, S_BOTTOM, 0, piv);
    f.add(loft([ring(4, 0.072, 0.125, 0, Q, x, 0.035), ring(4, 0.062, 0.09, 0.11, Q, x, 0.015)], 'none', 'cap'), part, S_SHOE, 0, piv);
  }
  f.add(loft([ring(6, 0.14, 0.095, 0.6, HEX), ring(6, 0.146, 0.098, 0.8, HEX)], 'cap', 'none'), PT_BODY, S_BOTTOM);
  f.add(loft([ring(6, 0.142, 0.096, 0.78, HEX), ring(6, 0.17, 0.108, 1.03, HEX), ring(6, 0.12, 0.084, 1.17, HEX)], 'none', 'cap'), PT_BODY, S_TOP);
  const skirt = (): number[] => loft([ring(6, 0.142, 0.1, 0.8, HEX), ring(6, 0.215, 0.18, 0.44, HEX)], 'none', 'none');
  f.add(skirt(), PT_BODY, S_BOTTOM, O_SKIRT_B);
  f.add(skirt(), PT_BODY, S_TOP, O_SKIRT_T);
  f.add(loft([ring(4, 0.11, 0.05, 0.8, Q, 0, -0.135), ring(4, 0.1, 0.045, 1.07, Q, 0, -0.13)], 'none', 'cap'), PT_BODY, S_ACC, O_BAG);
  for (const side of [1, -1]) {
    const up = side > 0 ? PT_LARM : PT_RARM, fore = side > 0 ? PT_LFORE : PT_RFORE;
    const { S, m, E } = armFrame(d, side, SPLAY);
    const U = d.upLen, L = d.armLen;
    f.add(xf(loft([ring(3, 0.078, 0.078, 0.01), ring(3, 0.066, 0.066, -U)], [0, 0.05, 0], 'none'), m), up, S_TOP, 0, S);
    f.add(xf(loft([ring(3, 0.066, 0.066, -U + 0.01), ring(3, 0.056, 0.056, -L + 0.01)], [0, -U + 0.05, 0], 'none'), m), fore, S_TOP, 0, S, E);
    f.add(xf(loft([ring(4, 0.05, 0.06, -L + 0.02, Q), ring(4, 0.052, 0.07, -L - 0.06, Q, 0, 0.004)], 'none', [0, -L - 0.125, 0.004]), m), fore, S_SKIN, 0, S, E);
  }
  const hs = d.hs, y0 = d.headY, hp = headPiv(d);
  f.add(loft([ring(6, 0.122 * hs, 0.112 * hs, y0 + 0.07 * hs, HEX), ring(6, 0.124 * hs, 0.112 * hs, y0 + 0.21 * hs, HEX)],
    [0, y0 - 0.01 * hs, 0.012 * hs], [0, y0 + 0.29 * hs, -0.006 * hs]), PT_HEAD, S_SKIN, 0, hp);
  const fz = 0.103 * hs;
  for (const s of [1, -1]) {
    const ex = s * 0.04 * hs, ey = y0 + 0.14 * hs, w = 0.021 * hs, h = 0.032 * hs;
    f.add(flat([ex - w, ey - h, ex + w, ey - h, ex + w, ey + h, ex - w, ey + h], fz), PT_HEAD, S_INK, 0, hp);
  }
  // generic hair cap (+ a long back for O_HAIR_B) and a generic hat (brim + crown)
  const yf = (a: number): number => y0 + hs * (0.1 + 0.125 * (0.5 + 0.5 * Math.cos(a)));
  const R1 = ring(6, 1, 1, 0, HEX, 0, 0, yf).map(([x, y, z]): V3 => { const r = headR((y - y0) / hs) * hs * 1.12 + 0.004 * hs; return [x * r, y, z * r - 0.004 * hs]; });
  f.add(loft([R1], 'none', [0, y0 + 0.32 * hs, -0.01 * hs], [0, y0 + 0.15 * hs, 0]), PT_HEAD, S_HAIR, O_MHAIR, hp);
  f.add(loft([ring(4, 0.125 * hs, 0.045 * hs, y0 + 0.25 * hs, Q, 0, -0.09 * hs), ring(4, 0.12 * hs, 0.04 * hs, y0 + 0.01 * hs, Q, 0, -0.085 * hs)], 'none', 'none'), PT_HEAD, S_HAIR, O_HAIR_B, hp);
  const rd = headR(0.22) * hs * 1.14 + 0.004 * hs;
  f.add(loft([ring(6, 0.19 * hs, 0.19 * hs, y0 + 0.2 * hs, HEX, 0, 0.02 * hs), ring(6, rd, rd, y0 + 0.235 * hs, HEX)], 'none', [0, y0 + 0.35 * hs, 0], [0, y0 + 0.15 * hs, 0]), PT_HEAD, S_HAIR, O_MHAT, hp);
  return f.geometry();
}

// ═════════════════════════════════ shaders ═════════════════════════════════
function glslCol(hex: string): string {
  const c = new THREE.Color(hex);   // → linear working space
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

const CIV_PARS = /* glsl */ `
attribute vec4 aTag;
attribute vec3 aPiv;
attribute vec3 aElb;
attribute vec4 iC1;
attribute vec4 iC2;
attribute vec4 iC3;
attribute vec4 iAnim;
mat3 civR;
mat3 civE;
float civKeep;
float civFade;
varying float vCivFade;
mat3 civRx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 civRy(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 civRz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void civSetup() {
  int part = int(aTag.x + 0.5);
  int opt = int(aTag.z + 0.5);
  int mask = int(iC1.w + 0.5);
  // iC3.w = style bits (0..3) + 4 × the near-camera fade step (0 = fully drawn … 15 = gone)
  int sv = int(iC3.w + 0.5);
  int style = sv - (sv / 4) * 4;
  civFade = 1.0 - float(sv / 4) / 15.0;
  float pose = iAnim.z;
  bool panic = abs(pose - ${P_PANIC}.0) < 0.5;
  civKeep = 1.0;
  if (opt == ${O_PHONE}) civKeep = abs(pose - ${P_PHONE}.0) < 0.5 ? 1.0 : 0.0;
  else if (opt == ${O_CALM}) civKeep = panic ? 0.0 : 1.0;
  else if (opt == ${O_PANIC}) civKeep = panic ? 1.0 : 0.0;
  else if (opt == ${O_MHAT}) civKeep = (mask & ${bit(O_HAT_A) | bit(O_HAT_B)}) != 0 ? 1.0 : 0.0;
  else if (opt == ${O_MHAIR}) civKeep = (mask & ${bit(O_HAIR_A) | bit(O_HAIR_B)}) != 0 ? 1.0 : 0.0;
  else if (opt == ${O_SKIRT_B}) civKeep = float(style & 1);
  else if (opt == ${O_SKIRT_T}) civKeep = float((style >> 1) & 1);
  else if (opt > 0) civKeep = float((mask >> (opt - 1)) & 1);
  // a cane (right-hand extra) is dropped the moment its owner stops simply walking
  if (opt == ${O_EXTRA} && (part == ${PT_RARM} || part == ${PT_RFORE}) && pose > 0.5) civKeep = 0.0;
  civR = mat3(1.0);
  civE = mat3(1.0);
  float ph = iAnim.x, amp = iAnim.y;
  float s = sin(ph);
  if (part == ${PT_LLEG} || part == ${PT_RLEG} || part == ${PT_LSHIN} || part == ${PT_RSHIN}) {
    float side = (part == ${PT_LLEG} || part == ${PT_LSHIN}) ? 1.0 : -1.0;
    // standing: soft knees, and the leg away from the hip the weight sits on relaxes (contrapposto —
    // the CPU shifts / rolls the body on the same slow phase sin(ph / 4))
    float stillL = 1.0 - min(amp, 1.0);
    float flex = stillL * (0.06 + 0.2 * max(0.0, -side * sin(ph * 0.25)));
    civR = civRx(side * s * (panic ? 0.95 : 0.55) * amp - flex);
    // the knee folds while the leg swings forward (and a little on the plant)
    if (part == ${PT_LSHIN} || part == ${PT_RSHIN}) civE = civRx(min(amp, 1.4) * (0.14 + 1.0 * max(0.0, -side * cos(ph))) * (panic ? 1.25 : 1.0) + 2.0 * flex);
  } else if (part == ${PT_LARM} || part == ${PT_RARM} || part == ${PT_LFORE} || part == ${PT_RFORE}) {
    float side = (part == ${PT_LARM} || part == ${PT_LFORE}) ? 1.0 : -1.0;
    float still = 1.0 - min(amp, 1.0);
    float rx = -side * s * 0.5 * amp;
    float rz = side * (0.03 + 0.03 * abs(s) * amp + 0.04 * still * sin(ph * 0.7 + side));
    // relaxed elbows; more bend on the forward swing; a sprinter's 90 degrees
    float bend = 0.24 + 0.5 * max(0.0, side * s) * min(amp, 1.0) + max(0.0, amp - 1.0) * 2.4 + 0.06 * still * sin(ph * 0.9);
    if (panic) {
      rx = -2.55 + 0.5 * sin(ph * 1.7 + side * 1.9);
      // (a narrower splay than a star jump: the flailing hands stay inside the personal radius)
      rz = side * (0.34 + 0.2 * sin(ph * 2.3 + side * 0.7));
      bend = 0.62 + 0.45 * sin(ph * 2.9 + side * 1.3);
    } else if (abs(pose - ${P_POINT}.0) < 0.5 && side < 0.0) {
      rx = -1.72 + 0.05 * sin(ph * 2.0); rz = 0.12; bend = 0.06;
    } else if (abs(pose - ${P_PHONE}.0) < 0.5 && side < 0.0) {
      rx = -0.95 + 0.03 * sin(ph); rz = 0.32; bend = 1.5;
    } else if (abs(pose - ${P_WAVE}.0) < 0.5 && side < 0.0) {
      rx = -0.3; rz = -2.2 + 0.08 * sin(ph * 3.0); bend = 0.45 + 0.45 * sin(ph * 3.0);
    }
    if (side < 0.0 && ((mask >> ${O_UMB - 1}) & 1) == 1) { rx = ${UMB_RX} + (panic ? 0.25 * sin(ph * 2.0) : 0.0); rz = ${UMB_RZ}; bend = 0.0; }
    if (side > 0.0 && ((mask >> ${O_BALLOON - 1}) & 1) == 1) { rx = ${BAL_RX} + 0.06 * sin(ph); rz = ${BAL_RZ}; bend = 0.0; }
    civR = civRx(rx) * civRz(rz);
    if (part == ${PT_LFORE} || part == ${PT_RFORE}) civE = civRx(-bend);
  } else if (part == ${PT_HEAD}) {
    // a per-person head tilt (hashed from the outfit colours, which every program has) + a slow
    // idle cock of the head
    float tilt = (fract(dot(vec3(iC1.r, iC2.g, iC3.b), vec3(37.3, 17.9, 23.1))) * 2.0 - 1.0) * 0.12
      + 0.06 * (1.0 - min(amp, 1.0)) * sin(ph * 0.31);
    civR = civRy(iAnim.w) * civRx(-iC2.w) * civRz(tilt);
  }
}
vec3 civPos(vec3 p) { return (aPiv + civR * (aElb + civE * (p - aElb) - aPiv)) * civKeep; }
`;

// colour-only instance attributes: declared in the toon program only (the ink hull would
// otherwise exceed the 16 vertex-attribute limit on D3D11/ANGLE)
const CIV_COLOR = /* glsl */ `
attribute vec4 iC0;
attribute vec4 iC4;
varying vec3 vCivCol;
vec3 civColor() {
  int slot = int(aTag.y + 0.5);
  if (slot == ${S_SKIN}) return iC0.rgb;
  if (slot == ${S_TOP}) return iC1.rgb;
  if (slot == ${S_BOTTOM}) return iC2.rgb;
  if (slot == ${S_HAIR}) return iC3.rgb;
  if (slot == ${S_ACC}) return iC4.rgb;
  if (slot == ${S_SHOE}) {
    int k = int(iC0.w + 0.5);
    ${SHOES.map((h, i) => `if (k == ${i}) return ${glslCol(h)};`).join('\n    ')}
    return ${glslCol(SHOES[0])};
  }
  if (slot == ${S_INK}) return ${glslCol(INK)};
  if (slot == ${S_WHITE}) return ${glslCol('#f4f1e8')};
  if (slot == ${S_GREY}) return ${glslCol('#8f949c')};
  return ${glslCol('#7a5236')};
}
`;

/** screen-door fade (interleaved-gradient-noise dither): near-camera figures fade out without
 *  transparency sorting; the hull uses the same pattern so the outline goes with the body */
const CIV_DITHER_PARS = /* glsl */ `
varying float vCivFade;
float civDither(vec2 fc) { return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))); }
`;
const CIV_DITHER = 'if (vCivFade < 0.999 && civDither(gl_FragCoord.xy) > vCivFade) discard;';

function makeCivToon(): THREE.MeshToonMaterial {
  const m = makeToon({ color: '#ffffff' });
  m.name = 'civToon';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + CIV_PARS + CIV_COLOR)
      .replace('#include <beginnormal_vertex>', 'civSetup();\nvCivFade = civFade;\nvec3 objectNormal = civR * (civE * vec3( normal ));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = civPos( position );\nvCivCol = civColor();');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCivCol;' + CIV_DITHER_PARS)
      .replace('#include <color_fragment>', CIV_DITHER + '\n#include <color_fragment>\ndiffuseColor.rgb *= vCivCol;');
  };
  m.customProgramCacheKey = () => 'civToon-v3';
  return m;
}

function makeCivOutline(): THREE.ShaderMaterial {
  const m = makeOutlineMaterial({ widthPx: OUTLINE_W, instanced: true });
  m.name = 'civInk';
  m.vertexShader = m.vertexShader
    .replace('#include <common>', '#include <common>\n' + CIV_PARS)
    .replace('vec3 objectNormal = outlineNormal;', 'civSetup();\n  vCivFade = civFade;\n  vec3 objectNormal = civR * (civE * outlineNormal);')
    .replace('#include <begin_vertex>', 'vec3 transformed = civPos( position );');
  m.fragmentShader = m.fragmentShader
    .replace('uniform vec3 uColor;', 'uniform vec3 uColor;\n' + CIV_DITHER_PARS)
    .replace('gl_FragColor = vec4( uColor, 1.0 );', CIV_DITHER + '\n  gl_FragColor = vec4( uColor, 1.0 );');
  return m;
}

/** per-archetype triangle counts (debug / tests) */
export function civArchetypeStats(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(ARCH)) {
    const f = new Fig(); ARCH[id].build(f);
    out[id] = f.pos.length / 9;
  }
  const g = buildLod(); out.lod = g.getAttribute('position').count / 3; g.dispose();
  const m = buildMid(); out.mid = m.getAttribute('position').count / 3; m.dispose();
  return out;
}

/** Scratch / debug gallery: each archetype (rows) in a line of poses and option sets (columns),
 *  plus the MID and LOD figures — same geometry, materials and shader as the live view. */
export function civGallery(biome: BiomeId, rows: string[] = Object.keys(ARCH)): { group: THREE.Group; tick(t: number): void; dispose(): void } {
  const toon = makeCivToon(), ink = makeCivOutline();
  const group = new THREE.Group();
  const disp: { dispose(): void }[] = [toon, ink];
  const COLS: [number, number, number][] = [   // pose, amp, option mask
    [P_WALK, 0, bit(O_HAIR_A) | bit(O_BAG) | bit(O_EXTRA)],
    [P_WALK, 1, bit(O_HAIR_B) | bit(O_EXTRA)],
    [P_PANIC, 1, bit(O_HAT_A) | bit(O_BAG)],
    [P_POINT, 0, bit(O_HAT_B) | bit(O_EXTRA)],
    [P_PHONE, 0, bit(O_HAIR_A) | bit(O_BAG)],
    [P_WAVE, 0, bit(O_HAT_A) | bit(O_EXTRA)],
    [P_WALK, 0.4, bit(O_HAIR_B) | bit(O_UMB) | bit(O_BALLOON)],
  ];
  const anims: { arr: Float32Array; at: THREE.InstancedBufferAttribute; n: number }[] = [];
  const all = [...rows, 'mid', 'lod'];
  const ids = Object.keys(ARCH);
  all.forEach((id, r) => {
    let geo: THREE.BufferGeometry;
    if (id === 'lod') geo = buildLod();
    else if (id === 'mid') geo = buildMid();
    else { const f = new Fig(); ARCH[id].build(f); geo = f.geometry(); }
    const n = COLS.length;
    const arrs = ATTR_NAMES.map(() => new Float32Array(n * 4));
    const ats = arrs.map((a, i) => { const at = new THREE.InstancedBufferAttribute(a, 4); geo.setAttribute(ATTR_NAMES[i], at); return at; });
    const mesh = new THREE.InstancedMesh(geo, toon, n);
    mesh.frustumCulled = false; mesh.receiveShadow = true;
    if (id !== 'lod') { const h = addOutline(mesh, OUTLINE_W); h.material = ink; }
    const c3 = new THREE.Color();
    COLS.forEach(([pose, amp, mask], c) => {
      const arch = id === 'lod' || id === 'mid' ? ARCH[ids[(c * 3 + r) % ids.length]] : ARCH[id];
      mesh.setMatrixAt(c, new THREE.Matrix4().makeTranslation((c - (n - 1) / 2) * 1.05, 0, -r * 1.7));
      const lk = arch.look(biome);
      const put = (ai: number, hex: string, wv: number): void => { c3.set(hex); arrs[ai].set([c3.r, c3.g, c3.b, wv], c * 4); };
      put(0, lk.skin, lk.shoe); put(1, lk.top, id === 'courier' ? bit(O_HAT_A) : id === 'mid' || id === 'lod' ? lk.mask : mask);
      put(2, lk.bottom, pose === P_WALK && amp === 0 ? 0 : 0.35);
      put(3, lk.hair, arch.mid ?? 0); put(4, lk.acc, 0);
      arrs[5].set([c * 1.3, amp, pose, 0], c * 4);
    });
    for (const at of ats) at.needsUpdate = true;
    anims.push({ arr: arrs[5], at: ats[5], n });
    group.add(mesh);
    disp.push(geo, mesh);
  });
  return {
    group,
    tick(t: number): void {
      for (const a of anims) {
        for (let c = 0; c < a.n; c++) a.arr[c * 4] = c * 1.3 + t * (a.arr[c * 4 + 2] === P_PANIC ? 14 : a.arr[c * 4 + 1] > 0 ? 7 : 3);
        a.at.needsUpdate = true;
      }
    },
    dispose(): void { for (const d of disp) d.dispose(); },
  };
}


// ═════════════════════════════════ the view ═════════════════════════════════
interface Puff { x: number; y: number; z: number; t: number; s: number; }

/** one instanced batch (an archetype, the MID figure or the LOD figure) */
interface Batch {
  mesh: THREE.InstancedMesh;
  hull: THREE.Mesh | null;
  attrs: THREE.InstancedBufferAttribute[];   // iC0..iC4, iAnim
  arrs: Float32Array[];
  n: number;
}

const ATTR_NAMES = ['iC0', 'iC1', 'iC2', 'iC3', 'iC4', 'iAnim'] as const;

// ── detail tiers, picked by the on-screen height of a figure standing at the camera target ──
/** figure height (m at scale 1) used for on-screen size estimates */
const FIG_H = 1.5;
/** ≥ this many px tall: full archetype figures (+ hulls) */
const FULL_PX = 44;
/** ≥ this: the MID figure (one draw + hull for everyone); below (Size III+): the 56-tri far figure */
const MID_PX = 26;
/** the MID figure keeps its ink hull while at least this tall */
const HULL_PX = 15;
/** cost ceiling for the MID crowd: the old capsule-pill crowd's triangle count */
const PILL_TRIS = 81920;

// ── personal space (× the rank's civ scale) ──
/** personal radius: a pair keeps 2 × the LARGER of the two radii apart (0.7 m for plain figures) */
const RAD_BASE = 0.35;
/** arms flung out (panic / wave): the raised hands must not pass through the neighbours */
const RAD_ARMS = 0.475;
/** umbrella / balloon holders: the 1.04 m canopy (and the balloon) must not cut into another one */
const RAD_UMB = 0.56;
const RAD_BALLOON = 0.46;
/** soft zone beyond the hard minimum: a gentle push starts here (walkers step around each other) */
const SOFT_EXTRA_K = 0.3;
/** spawn spacing between any two civilians (at least; wide holders use their radius), and the spacing inside a group */
const SPAWN_SEP_K = 0.85;
const GROUP_SP_K = 0.98;
/** a new group's anchor needs this much clear space */
const ANCHOR_CLEAR_K = 1.15;
/** spatial-hash cell (≥ the largest neighbour radius used with a 3×3 query) */
const CELL_K = 1.3;
/** a fleeing civilian feels this far ahead (m × scale, + a speed term) for facades in its way */
const FEEL_K = 2.6;
/** keep-out margin around a facade for fleeing civilians (m × scale, on top of the body radius) */
const WALL_K = 0.32;
/** round buildings (tanks, cooling towers, chimneys, dishes): their plinths / flares overhang the
 *  square footprint — civilians keep to a circle this much wider than w / 2 */
const ROUND_PAD = 0.55;
const HASH = 2048;
/** body radius for prop avoidance */
const BODY_K = 0.26;
/** paved forecourt: sidewalk walkers may use up to this many metres of parcel inside the sidewalk */
const PLAZA_DEPTH = 7;
/** prop avoidance runs while a figure at the camera target is at least this many px tall */
const PROP_AVOID_PX = 16;

// ── near-camera rules (× the target figure's on-screen height) ──
/** never spawn a figure this much bigger than one at the camera target */
const SPAWN_NEAR = 1.45;
/** never draw one this much bigger (it would be a giant blob right under the lens) */
const DRAW_NEAR = 2.3;
/** the slate (pre-run still frame): a figure at least this big AND cut by the screen edge / standing in
 *  the caption band is not drawn (nor spawned there) — no half figures poking in behind the captions */
const EDGE_NEAR = 0.8;
/** slate: NDC y below which the bottom caption band starts (the lowest ~20 % of the frame) */
const STILL_BOTTOM = -0.6;
/** in play: a figure at least this big AND cut by the screen edge dithers out (fades, no pop) */
const PLAY_EDGE_NEAR = 1.05;
/** in play: NDC y of the top of the news-ticker band along the bottom of the screen */
const PLAY_BOTTOM = -0.91;
/** fade speed (1 / s) of that dither */
const FADE_RATE = 5;
/** Size I: an anchor this much bigger than the target figure (near the lens) gets a small, loose group */
const NEAR_GROUP = 1.1;

export class CivilianView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private batches: Batch[] = [];
  private mid: Batch | null = null;
  private lod: Batch | null = null;
  private midTris = 240;
  private archs: Arch[] = [];
  private archW: number[] = [];
  private archWSum = 1;
  private puffs: THREE.InstancedMesh | null = null;
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
  private readonly hy = new Float32Array(CAP);         // head yaw (relative to the body)
  private readonly hp = new Float32Array(CAP);         // head pitch (look up)
  private readonly amp = new Float32Array(CAP);        // smoothed swing amplitude
  private readonly hvar = new Float32Array(CAP);       // height variation
  private readonly st = new Uint8Array(CAP);
  private readonly arch = new Uint8Array(CAP);
  private readonly pose = new Uint8Array(CAP);
  /** group leader (self = on its own); followers copy the leader's walk / stop */
  private readonly lead = new Int16Array(CAP);
  /** 1 = strolling inside a park / plaza block instead of on the sidewalk ring */
  private readonly inPark = new Uint8Array(CAP);
  /** static per-civilian instance colours: iC0..iC4 (5 × vec4) */
  private readonly col = new Float32Array(CAP * 20);
  /** personal radius (× scale): plain / arms out / umbrella or balloon holder — see RAD_* */
  private readonly rad = new Float32Array(CAP);
  /** fleeing: facade-contact cooldown (s), the facade's outward normal, and a per-civilian
   *  tangential bias (signed, 0.35–1) so neighbours fan out along a wall instead of queueing */
  private readonly wallT = new Float32Array(CAP);
  private readonly wnx = new Float32Array(CAP);
  private readonly wnz = new Float32Array(CAP);
  private readonly bias = new Float32Array(CAP);
  /** fleeing: steering angle chosen by the facade feelers (re-evaluated every other frame), and a
   *  per-civilian feeler-length factor (0.75–1.3) so a crowd spreads over a band, not one line */
  private readonly steer = new Float32Array(CAP);
  private readonly feel = new Float32Array(CAP);
  /** near-camera dither fade (1 = drawn, 0 = hidden) — edge-cut / giant figures fade instead of popping */
  private readonly fade = new Float32Array(CAP);
  // spatial hash (linked lists through hNext), rebuilt twice a frame — zero allocation
  private readonly hHead = new Int32Array(HASH);
  private readonly hNext = new Int32Array(CAP);
  private hCell = 1;
  /** per block: 1 = park / plaza (no buildings) */
  private parkCell = new Uint8Array(0);
  private puffList: Puff[] = [];
  private puffCursor = 0;
  private waterZ: number | null = null;
  private live = 0;
  private scaleNow = 1;
  /** px of on-screen height per (m of figure / m of camera distance) */
  private pxK = 600;
  private figPx = 100;
  /** viewport height / width (NDC x per NDC y of the same pixel length) */
  private aspectInv = 9 / 16;
  private freeCursor = 0;
  private frameNo = 0;
  /** per prop id: footprint half extents (width / length; trees = trunk) and a per-frame heading trig cache */
  private propHW = new Float32Array(0);
  private propHL = new Float32Array(0);
  private propSin = new Float32Array(0);
  private propCos = new Float32Array(0);
  private propStamp = new Int32Array(0);
  /** debug / tests: the detail tier this frame (0 full, 1 mid, 2 far) and the target figure px */
  private readonly dbg = { tier: 0, figPx: 0, hull: true, live: 0, minGap: 0, fleeing: 0, propPush: 0, inProp: 0, inPark: 0, forecourt: 0, ms: 0, msSpawn: 0, msSep: 0, msLoop: 0, culledNear: 0, culledEdge: 0, pxMax: 0, minSepRatio: 0, msFeel: 0, wallHits: 0 };
  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector2();
  private readonly c3 = new THREE.Color();

  constructor(ctx: ViewCtx) {
    this.ctx = ctx; this.root.name = 'civilians'; this.root.userData.civ = this.dbg;
    // debug / tests (audits read positions, states, radii and masks)
    this.root.userData.civState = { x: this.x, z: this.z, st: this.st, rad: this.rad, col: this.col, pose: this.pose, fade: this.fade, scale: () => this.scaleNow, view: this };
  }

  /** civilians currently on screen (debug / tests) */
  get count(): number { return this.live; }

  mount(w: World): void {
    this.waterZ = harbourWaterZ(w.city);
    const toon = makeCivToon();
    const ink = makeCivOutline();
    this.disposables.push(toon, ink);
    const mix = BIOME_MIX[w.biomeId] ?? BIOME_MIX.grideast;
    this.archs = mix.map(([id]) => ARCH[id]);
    this.archW = mix.map(([, wgt]) => wgt);
    this.archWSum = this.archW.reduce((s, v) => s + v, 0);
    this.batches = this.archs.map((a) => {
      const f = new Fig(); a.build(f);
      return this.makeBatch('civ:' + a.id, f.geometry(), toon, ink);
    });
    const midGeo = buildMid();
    this.midTris = midGeo.getAttribute('position').count / 3;
    this.mid = this.makeBatch('civ:mid', midGeo, toon, ink);
    this.lod = this.makeBatch('civ:lod', buildLod(), toon, null);

    const np0 = w.city.props.length;
    this.propHW = new Float32Array(np0); this.propHL = new Float32Array(np0);
    this.propSin = new Float32Array(np0); this.propCos = new Float32Array(np0); this.propStamp = new Int32Array(np0).fill(-1);
    for (let k = 0; k < np0; k++) {
      const pr = w.city.props[k];
      const info = PROP_INFO[pr.kind];
      const tree = pr.kind === 'tree';
      this.propHW[k] = tree ? 0.3 : info.wid * 0.5; this.propHL[k] = tree ? 0.3 : info.len * 0.5;
    }
    // park / plaza blocks: no buildings (the harbour row of a flooded city is water, not a park)
    const city = w.city;
    this.parkCell = new Uint8Array(city.blocksX * city.blocksZ);
    for (let bz = 0; bz < city.blocksZ; bz++) {
      for (let bx = 0; bx < city.blocksX; bx++) {
        const bi = bx + bz * city.blocksX;
        this.parkCell[bi] = city.blockBuildings[bi].length === 0 && !(city.flooded && bz === 0) ? 1 : 0;
      }
    }

    const ico = new THREE.IcosahedronGeometry(0.5, 0);
    const puffGeo = facet(ico);
    ico.dispose();
    bakeOutlineNormals(puffGeo);
    puffGeo.computeBoundingSphere();
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
    for (let i = 0; i < CAP; i++) this.lead[i] = i;
    this.ctx.scene.add(this.root);
  }

  private makeBatch(name: string, geo: THREE.BufferGeometry, toon: THREE.Material, ink: THREE.ShaderMaterial | null): Batch {
    const arrs: Float32Array[] = [];
    const attrs: THREE.InstancedBufferAttribute[] = [];
    for (const nm of ATTR_NAMES) {
      const a = new Float32Array(CAP * 4);
      const at = new THREE.InstancedBufferAttribute(a, 4);
      at.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(nm, at);
      arrs.push(a); attrs.push(at);
    }
    const mesh = new THREE.InstancedMesh(geo, toon, CAP);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.visible = false;
    let hull: THREE.Mesh | null = null;
    if (ink) { hull = addOutline(mesh, OUTLINE_W); hull.material = ink; hull.name = name + ':ink'; }
    this.root.add(mesh);
    this.disposables.push(geo);
    return { mesh, hull, attrs, arrs, n: 0 };
  }

  update(w: World, f: FrameInfo): void {
    if (!this.lod || !this.mid || !this.puffs) return;
    const t0 = performance.now();
    const T = w.titan;
    const H = T.height;
    const rank = T.rank;
    const a = f.alpha;
    const tx = T.px + (T.x - T.px) * a, tz = T.pz + (T.z - T.pz) * a;
    const dt = f.frozen ? 0 : f.dt;
    /** the pre-run slate (a still frame under the broadcast captions) */
    const slate = f.frozen && w.tick === 0;
    const qm = Q_MUL[this.ctx.quality.level] ?? 1;
    const want = Math.min(CAP, Math.round(CROWD[rank] * qm));
    const scale = CIV_SCALE[rank];
    this.scaleNow = scale;
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

    // ── detail tier from the on-screen size of a figure at the camera target ──
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const cssH = Math.max(1, this.ctx.renderer.getSize(this.v2).y || 720);   // (no DOM layout read)
    this.aspectInv = cssH / Math.max(1, this.v2.x || 1280);
    this.pxK = cssH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const figPx = (FIG_H * scale * this.pxK) / Math.max(1, f.camDist);
    this.figPx = figPx;
    let tier = figPx >= FULL_PX ? 0 : figPx >= MID_PX ? 1 : 2;
    let midHull = figPx >= HULL_PX;
    if (tier === 1) {
      // the whole MID crowd (+ its hull) must cost no more than the old pill crowd did
      if (want * this.midTris * 2 > PILL_TRIS) midHull = false;
      if (want * this.midTris > PILL_TRIS) tier = 2;
    }
    for (const b of this.batches) if (b.hull) b.hull.visible = tier === 0;
    if (this.mid.hull) this.mid.hull.visible = tier === 1 && midHull;
    this.dbg.tier = tier; this.dbg.figPx = Math.round(figPx * 10) / 10; this.dbg.hull = tier === 0 || (tier === 1 && midHull);

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

    // ── recycle ──
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
    // over budget after a quality drop: retire a few calm ones
    if (alive > want) {
      for (let i = CAP - 1; i >= 0 && alive > want; i--) if (this.st[i] === ST_MILL || this.st[i] === ST_IDLE) { this.st[i] = ST_EMPTY; alive--; }
    }

    // ── spawn: small groups (1–5) with personal space, on sidewalks and in parks ──
    const tS = performance.now();
    this.hashBuild(CELL_K * scale);
    let budget = f.frozen ? 0 : Math.max(8, Math.ceil(want / 10));   // spread refills over frames
    if (this.live === 0 && alive === 0) budget = want;                 // first frame: fill at once
    let attempts = this.live === 0 ? budget * 2 + 12 : Math.min(budget * 2 + 12, 40);
    while (alive < want && budget > 0 && attempts-- > 0) {
      const got = this.spawnGroup(w, tx, tz, R, H, tbx, tbz, liveR, scale, Math.min(5, want - alive, budget), slate);
      alive += got; budget -= Math.max(1, got);
    }

    // ── behaviour + integration ──
    /** facade feelers for fleeing civilians (skipped at Size IV–V where a figure is a few px) */
    const feelOn = figPx >= 14;
    for (let i = 0; i < CAP; i++) {
      const s = this.st[i];
      if (s === ST_EMPTY || s === ST_GONE) continue;
      const x = this.x[i], z = this.z[i];
      const dx = x - tx, dz = z - tz;
      const d = Math.sqrt(dx * dx + dz * dz) || 1e-3;
      this.t[i] -= dt;
      const ar = this.archs[this.arch[i]];
      if (s !== ST_FLEE && d < fleeR) {
        this.st[i] = ST_FLEE;
        const sp = (3.4 + 0.11 * H) * (0.8 + Math.random() * 0.45) * (ar.id === 'elder' ? 0.7 : 1);
        const jit = (Math.random() - 0.5) * 0.9;
        const ux = dx / d, uz = dz / d;
        this.vx[i] = (ux * Math.cos(jit) - uz * Math.sin(jit)) * sp;
        this.vz[i] = (ux * Math.sin(jit) + uz * Math.cos(jit)) * sp;
        this.spd[i] = sp;
        this.t[i] = 2.5 + Math.random() * 2;
        this.pose[i] = Math.random() < 0.72 ? P_PANIC : P_WALK;          // most flail, some just sprint
        this.wallT[i] = 0; this.steer[i] = 0;
        this.feel[i] = 0.6 + Math.random() * 1.0;
        this.bias[i] = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.65);
      } else if (s === ST_FLEE) {
        // keep steering away from the titan (with a little panic wobble) — but AROUND buildings:
        // feelers turn the run before it reaches a facade, and a civilian that touched one peels
        // off it (outward + its own tangential bias) instead of queueing along the wall
        const sp = this.spd[i];
        let ux = dx / d, uz = dz / d;
        if (feelOn && ((i + this.frameNo) & 1) === 0) this.steer[i] = this.fleeFeel(i, city, x, z, ux, uz, sp, scale);
        const sa = this.steer[i];
        if (sa !== 0) { const c = Math.cos(sa), sn = Math.sin(sa); const rx0 = ux * c - uz * sn; uz = ux * sn + uz * c; ux = rx0; }
        if (this.wallT[i] > 0) {
          this.wallT[i] -= dt;
          const nx = this.wnx[i], nz = this.wnz[i];
          const un = ux * nx + uz * nz;
          if (un < 0) { ux -= un * nx; uz -= un * nz; }
          const bs = this.bias[i];
          ux += nx * 0.9 - nz * bs; uz += nz * 0.9 + nx * bs;
          const ul = Math.sqrt(ux * ux + uz * uz) || 1; ux /= ul; uz /= ul;
        }
        const k = Math.min(1, dt * (this.wallT[i] > 0 || sa !== 0 ? 5 : 3));
        this.vx[i] += (ux * sp - this.vx[i]) * k + (Math.random() - 0.5) * sp * dt * 2;
        this.vz[i] += (uz * sp - this.vz[i]) * k + (Math.random() - 0.5) * sp * dt * 2;
        if (d > calmR && this.t[i] <= 0) {
          this.st[i] = ST_MILL; this.pose[i] = P_WALK;
          if (!this.followLeader(i)) this.setMill(i, x, z, city, ar);
        }
      } else if (this.t[i] <= 0) {
        // mill ⇄ idle (stand and gawk toward the titan); group members copy their leader
        if (!this.followLeader(i)) {
          if (s === ST_MILL && Math.random() < 0.45) this.setIdle(i);
          else { this.st[i] = ST_MILL; this.pose[i] = P_WALK; this.setMill(i, x, z, city, ar); }
        }
      }
      // personal radius for the separation: umbrella / balloon holders and flung-out arms need more room
      this.rad[i] = this.radiusOf(i);
      this.x[i] = x + this.vx[i] * dt; this.z[i] = z + this.vz[i] * dt;
    }

    const tP = performance.now();
    // ── personal space: nobody stands inside anybody else ──
    this.separate(scale, dt);
    const tL = performance.now();

    // ── constraints + pose + instances ──
    for (const b of this.batches) b.n = 0;
    this.mid.n = 0;
    this.lod.n = 0;
    let n = 0;
    const glanceR2 = (H * 12 + 8) * (H * 12 + 8);
    const camP = cam.position;
    const body = BODY_K * scale;
    let fleeing = 0, inProp = 0, parkers = 0, forecourt = 0, culledNear = 0, culledEdge = 0, pxMax = 0;
    const audit = (++this.frameNo & 15) === 0;          // debug audit (prop overlap) every 16th frame
    this.dbg.propPush = 0; this.dbg.wallHits = 0;
    for (let i = 0; i < CAP; i++) {
      const s = this.st[i];
      if (s === ST_EMPTY || s === ST_GONE) continue;
      let x = this.x[i], z = this.z[i];
      const ar = this.archs[this.arch[i]];
      // walkable ground only: sidewalks / forecourts / parks — never buildings, water or off the map
      const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
      const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
      let lx = x - cx, lz = z - cz;
      if (s !== ST_FLEE && this.inPark[i]) {
        // strolling in a park / plaza: stay inside it, turn back at its edge
        const lim = PARCEL_HALF - 0.6;
        if (lx > lim) { lx = lim; if (this.vx[i] > 0) this.vx[i] = -this.vx[i]; }
        else if (lx < -lim) { lx = -lim; if (this.vx[i] < 0) this.vx[i] = -this.vx[i]; }
        if (lz > lim) { lz = lim; if (this.vz[i] > 0) this.vz[i] = -this.vz[i]; }
        else if (lz < -lim) { lz = -lim; if (this.vz[i] < 0) this.vz[i] = -this.vz[i]; }
      } else if (s !== ST_FLEE) {
        // milling civilians keep to the sidewalk band — or the paved forecourt between it and the
        // facades (never closer than ~0.9 m to a building); at the end of a side they turn the
        // corner onto the adjacent side of the same block (a civilian that fled onto the road walks
        // back to the curb instead of snapping)
        const ax = Math.abs(lx), az = Math.abs(lz);
        const step = 2.2 * dt;
        const vxi = this.vx[i], vzi = this.vz[i];
        const walking = vxi * vxi + vzi * vzi > 0.0025;
        const xSide = walking ? Math.abs(vzi) >= Math.abs(vxi) : ax >= az;
        if (xSide) {
          const sg = Math.sign(lx || 1);
          const inner = this.innerLimit(city, bx, bz, cx, cz, false, sg, z, vzi, scale);
          const wnt = Math.min(SW_OUT, Math.max(inner, ax));
          lx = sg * (ax + Math.max(-step, Math.min(step, wnt - ax)));
          if (walking && Math.abs(lz) > SW_OUT - 0.25 && lz * vzi > 0) { lz = Math.sign(lz) * (SW_OUT - 0.25); this.turnCorner(i, true, sg); }
        } else {
          const sg = Math.sign(lz || 1);
          const inner = this.innerLimit(city, bx, bz, cx, cz, true, sg, x, vxi, scale);
          const wnt = Math.min(SW_OUT, Math.max(inner, az));
          lz = sg * (az + Math.max(-step, Math.min(step, wnt - az)));
          if (walking && Math.abs(lx) > SW_OUT - 0.25 && lx * vxi > 0) { lx = Math.sign(lx) * (SW_OUT - 0.25); this.turnCorner(i, false, sg); }
        }
      }
      x = cx + lx; z = cz + lz;
      // buildings (never run through one), parked cars, kiosks, benches, lamps, trees: go AROUND
      if (s !== ST_IDLE) {
        this.p3.set(x, 0, z);
        this.avoidBuildings(i, city, bx, bz, s === ST_FLEE ? body + 0.16 * scale : body, s === ST_FLEE);
        // (skipped once figures and cars are only a few px — Size IV–V — where it cannot be seen)
        if (figPx >= PROP_AVOID_PX) this.avoidProps(i, city, bx, bz, body, s === ST_FLEE);
        x = this.p3.x; z = this.p3.z;
      }
      const bb = city.bounds;
      if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ || (this.waterZ !== null && z < this.waterZ)) {
        this.st[i] = ST_EMPTY; continue;
      }
      this.x[i] = x; this.z[i] = z;
      lx = x - cx; lz = z - cz;
      if (s === ST_FLEE) { fleeing++; if (audit && this.inProp(city, x, z, 0)) inProp++; }
      else if (this.inPark[i]) parkers++;
      else if (Math.max(Math.abs(lx), Math.abs(lz)) < SW_IN - 0.3) forecourt++;

      // ── pose ──
      const dx = x - tx, dz = z - tz;
      const d = Math.sqrt(dx * dx + dz * dz) || 1e-3;
      const vx = this.vx[i], vz = this.vz[i];
      const v = Math.sqrt(vx * vx + vz * vz);
      const toT = Math.atan2(tx - x, tz - z);
      if (v > 0.05) this.hd[i] = s === ST_FLEE ? Math.atan2(vx, vz) : turnToward(this.hd[i], Math.atan2(vx, vz), dt * 8);
      else if (s === ST_IDLE) this.hd[i] = turnToward(this.hd[i], toT, dt * 3.5);   // turn to gawk at the titan
      const sc = scale * (tier === 0 ? 1 : ar.lod);
      // gait phase locked to ground speed: one leg cycle = two strides
      const stride = ar.stride * scale;
      // swing amplitude: coats / skirts / elders swing less (legs stay inside the hem)
      const targetAmp = (s === ST_FLEE ? (this.pose[i] === P_PANIC ? 0.85 : 1.2) + 0.15 * ar.swing : Math.min(1, v / 0.8)) * ar.swing;
      this.amp[i] += (targetAmp - this.amp[i]) * (dt > 0 ? Math.min(1, dt * 6) : 1);
      this.ph[i] += dt * (v > 0.05 ? Math.min(20, (v / stride) * Math.PI) : 3.2);
      // head: gawkers look UP at the titan; walkers glance at it when it is close
      let yawT = 0, pitchT = 0;
      if (s !== ST_FLEE && dx * dx + dz * dz < glanceR2) {
        yawT = wrapPi(toT - this.hd[i]);
        yawT = Math.max(-1.05, Math.min(1.05, yawT));
        const eye = 1.35 * sc;
        pitchT = Math.max(-0.1, Math.min(0.62, Math.atan2(H * 0.8 - eye, d)));
        if (s === ST_MILL) { yawT *= 0.8; pitchT *= 0.6; }
      } else if (s === ST_FLEE) {
        yawT = 0.5 * Math.sin(this.ph[i] * 0.37 + i);                     // a panicked look back
      }
      const hk = dt > 0 ? Math.min(1, dt * 5) : 1;          // frozen frames (slate) snap to the pose
      this.hy[i] += (yawT - this.hy[i]) * hk;
      this.hp[i] += (pitchT - this.hp[i]) * hk;

      const cellR = Math.max(Math.abs(lx), Math.abs(lz));
      const am = this.amp[i];
      const bob = Math.abs(Math.sin(this.ph[i])) * (s === ST_FLEE ? 0.075 : 0.03) * am * sc;
      const y = (cellR <= SW_OUT + 0.05 ? SIDEWALK_Y : 0) + bob;

      // near-camera rules: no giant figures right under the lens, no big cut-off ones in still frames
      const cdx = x - camP.x, cdy = y + 0.75 * sc - camP.y, cdz = z - camP.z;
      const px = (FIG_H * sc * this.pxK) / Math.max(0.01, Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz));
      if (px > pxMax) pxMax = px;
      if (slate) {
        if (px > figPx * DRAW_NEAR) { culledNear++; continue; }
        if (px > figPx * EDGE_NEAR && this.cutByEdge(x, y, z, sc, true)) { culledEdge++; continue; }
        this.fade[i] = 1;
      } else {
        // in play: a giant right under the lens, or a big figure cut by the screen edge, dithers
        // out over ~0.2 s (and back in) instead of popping
        let fT = 1;
        if (px > figPx * DRAW_NEAR) { fT = 0; culledNear++; }
        else if (px > figPx * PLAY_EDGE_NEAR && this.cutByEdgePlay(x, y, z, sc)) { fT = 0; culledEdge++; }
        const fr = FADE_RATE * dt;
        this.fade[i] = fT > this.fade[i] ? Math.min(fT, this.fade[i] + fr) : Math.max(fT, this.fade[i] - fr);
        if (this.fade[i] <= 0.02) continue;
      }

      const lean = s === ST_FLEE ? (this.pose[i] === P_PANIC ? 0.12 : 0.24) : 0.03 * am;
      // hip sway: a side-to-side weight shift over the planted foot while walking, and a slow
      // lean from one hip to the other while standing (the idle legs flex to match in the shader)
      const still = 1 - Math.min(1, am);
      const idleSw = Math.sin(this.ph[i] * 0.25);           // (the shader flexes the knees on the same phase)
      const sway = (Math.sin(this.ph[i]) * 0.022 * Math.min(1, am) + idleSw * 0.014 * still) * sc;
      this.eul.set(lean, this.hd[i], Math.sin(this.ph[i]) * 0.035 * am + idleSw * 0.03 * still);
      this.q.setFromEuler(this.eul);
      const hdg = this.hd[i];
      this.p3.set(x + Math.cos(hdg) * sway, y, z - Math.sin(hdg) * sway);
      const hv = this.hvar[i];
      this.s3.set(sc * (0.96 + 0.08 * hv), sc * (0.92 + 0.16 * hv), sc * (0.96 + 0.08 * hv));
      this.m4.compose(this.p3, this.q, this.s3);

      const b: Batch = tier === 0 ? this.batches[this.arch[i]] : tier === 1 ? this.mid : this.lod;
      const k: number = b.n++;
      b.mesh.setMatrixAt(k, this.m4);
      const o = i * 20, k4 = k * 4;
      const A = b.arrs, C = this.col;
      for (let c = 0; c < 5; c++) {
        const dst = A[c], so = o + c * 4;
        dst[k4] = C[so]; dst[k4 + 1] = C[so + 1]; dst[k4 + 2] = C[so + 2]; dst[k4 + 3] = C[so + 3];
      }
      A[2][k4 + 3] = this.hp[i];
      // the dither fade rides in iC3.w above the style bits (both the toon and the hull programs read it)
      const fq = Math.round((1 - this.fade[i]) * 15);
      if (fq > 0) A[3][k4 + 3] = C[o + 15] + 4 * fq;
      const an = A[5];
      an[k4] = this.ph[i]; an[k4 + 1] = am; an[k4 + 2] = this.pose[i]; an[k4 + 3] = this.hy[i];
      n++;
    }
    const tE = performance.now();
    this.dbg.msSpawn = Math.round((tP - tS) * 100) / 100; this.dbg.msSep = Math.round((tL - tP) * 100) / 100; this.dbg.msLoop = Math.round((tE - tL) * 100) / 100;
    this.live = n;
    this.dbg.live = n; this.dbg.fleeing = fleeing; if (audit) this.dbg.inProp = inProp; this.dbg.inPark = parkers; this.dbg.forecourt = forecourt; this.dbg.culledNear = culledNear; this.dbg.culledEdge = culledEdge; this.dbg.pxMax = Math.round(pxMax);
    for (const b of this.batches) this.flush(b);
    this.flush(this.mid);
    this.flush(this.lod);

    // ── puffs ──
    let np = 0;
    for (let k = 0; k < PUFF_CAP; k++) {
      const p = this.puffList[k];
      if (p.t >= PUFF_LIFE) continue;
      p.t += dt;
      if (p.t >= PUFF_LIFE) continue;
      const u = p.t / PUFF_LIFE;
      const grow = u < 0.3 ? 0.4 + (u / 0.3) * 0.75 : 1.15 * (1 - (u - 0.3) / 0.7);
      for (let bb = 0; bb < PUFF_BALLS; bb++) {
        const ang = bb * 2.094 + k;
        const r = p.s * (0.25 + u * 0.5);
        this.p3.set(p.x + Math.cos(ang) * r, p.y + p.s * (0.25 + u * 0.55 + bb * 0.12), p.z + Math.sin(ang) * r);
        const bs = p.s * grow * (0.55 + 0.2 * bb);
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
    // debug / tests: CPU cost of this update (smoothed)
    this.dbg.ms = Math.round((this.dbg.ms * 0.9 + (performance.now() - t0) * 0.1) * 1000) / 1000;
  }

  /** upload only the live range of a batch */
  private flush(b: Batch): void {
    const n = b.n;
    b.mesh.count = n;
    b.mesh.visible = n > 0;
    if (n === 0) return;
    const im = b.mesh.instanceMatrix;
    im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
    for (const at of b.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true; }
  }

  unmount(): void {
    this.root.removeFromParent();
    for (const b of this.batches) b.mesh.dispose();
    this.mid?.mesh.dispose();
    this.lod?.mesh.dispose();
    this.puffs?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.batches = [];
    this.mid = null;
    this.lod = null;
    this.puffs = null;
    this.st.fill(ST_EMPTY);
    this.live = 0;
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private inLiveBlock(city: World['city'], x: number, z: number, tbx: number, tbz: number, liveR: number): boolean {
    const bx = Math.floor((x - city.originX) / city.pitch), bz = Math.floor((z - city.originZ) / city.pitch);
    return Math.abs(bx - tbx) <= liveR && Math.abs(bz - tbz) <= liveR;
  }

  private alive(i: number): boolean { const s = this.st[i]; return s === ST_MILL || s === ST_IDLE || s === ST_FLEE; }

  // ── spatial hash ──
  private hashKey(cx: number, cz: number): number { return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & (HASH - 1); }

  private hashBuild(cell: number): void {
    this.hCell = cell;
    this.hHead.fill(-1);
    for (let i = 0; i < CAP; i++) if (this.alive(i)) this.hashInsert(i);
  }

  private hashInsert(i: number): void {
    const c = this.hCell;
    const k = this.hashKey(Math.floor(this.x[i] / c), Math.floor(this.z[i] / c));
    this.hNext[i] = this.hHead[k]; this.hHead[k] = i;
  }

  /** is anybody (alive, in the hash) within r of (x, z)? With a personal radius `ri` (× `scale`) the
   *  newcomer also keeps 2 × the larger of the two personal radii (+ a little) from each neighbour,
   *  so umbrella / balloon holders never spawn with their canopies cutting into each other */
  private crowdedAt(x: number, z: number, r: number, ri = 0, scale = 1): boolean {
    const c = this.hCell;
    const rMax = ri > 0 ? Math.max(r, (2 * RAD_UMB + 0.12) * scale) : r;
    const cx = Math.floor(x / c), cz = Math.floor(z / c), rc = Math.ceil(rMax / c);
    for (let oz = -rc; oz <= rc; oz++) {
      for (let ox = -rc; ox <= rc; ox++) {
        for (let j = this.hHead[this.hashKey(cx + ox, cz + oz)]; j >= 0; j = this.hNext[j]) {
          if (!this.alive(j)) continue;
          const ddx = this.x[j] - x, ddz = this.z[j] - z;
          let need = r;
          if (ri > 0) { const pr = (2 * Math.max(ri, this.rad[j]) + 0.12) * scale; if (pr > need) need = pr; }
          if (ddx * ddx + ddz * ddz < need * need) return true;
        }
      }
    }
    return false;
  }

  /** personal radius (× scale) from a civilian's option mask and pose — see RAD_* */
  private radiusOf(i: number): number {
    const mk = this.col[i * 20 + 7];
    let r = (mk & bit(O_UMB)) !== 0 ? RAD_UMB : (mk & bit(O_BALLOON)) !== 0 ? RAD_BALLOON : RAD_BASE;
    const po = this.pose[i];
    if ((po === P_PANIC || po === P_WAVE) && r < RAD_ARMS) r = RAD_ARMS;
    return r;
  }

  /** separation steering: a hard minimum distance (position projection) plus a soft zone that
   *  makes walkers side-step each other; gawkers standing still give way less. 3 passes (2 for huge crowds). */
  private separate(scale: number, dt: number): void {
    const softX = SOFT_EXTRA_K * scale, cellW = CELL_K * scale;
    const kSoft = Math.min(1, dt * 4);
    const X = this.x, Z = this.z, RD = this.rad;
    let minD2 = 1e9, minRatio = 1e9;
    const passes = this.live > 360 ? 2 : 3;
    for (let pass = 0; pass < passes; pass++) {
      this.hashBuild(CELL_K * scale);
      const c = this.hCell;
      for (let i = 0; i < CAP; i++) {
        if (!this.alive(i)) continue;
        const cx = Math.floor(X[i] / c), cz = Math.floor(Z[i] / c);
        const wi = this.st[i] === ST_IDLE ? 0.35 : 1;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            for (let j = this.hHead[this.hashKey(cx + ox, cz + oz)]; j >= 0; j = this.hNext[j]) {
              if (j <= i || !this.alive(j)) continue;
              let ddx = X[j] - X[i], ddz = Z[j] - Z[i];
              const d2 = ddx * ddx + ddz * ddz;
              // this pair's minimum: 2 × the larger personal radius (umbrellas / flung arms need more)
              const sep = 2 * (RD[i] > RD[j] ? RD[i] : RD[j]) * scale;
              const soft = Math.min(sep + softX, cellW);
              if (pass === passes - 1) {
                if (d2 < minD2) minD2 = d2;
                const rt = d2 / (sep * sep);
                if (rt < minRatio) minRatio = rt;
              }
              if (d2 >= soft * soft) continue;
              let dd = Math.sqrt(d2);
              if (dd < 1e-4) { const an = (i * 2.399 + j) % 6.2832; ddx = Math.cos(an); ddz = Math.sin(an); dd = 0; }
              else { ddx /= dd; ddz /= dd; }
              const push = dd < sep ? sep - dd + (soft - sep) * kSoft * 0.5 : (soft - dd) * kSoft * 0.5;
              if (push <= 0) continue;
              const wj = this.st[j] === ST_IDLE ? 0.35 : 1;
              const sh = push / (wi + wj);
              X[i] -= ddx * sh * wi; Z[i] -= ddz * sh * wi;
              X[j] += ddx * sh * wj; Z[j] += ddz * sh * wj;
            }
          }
        }
      }
    }
    // debug / tests: closest pair seen by the last pass (before its correction), in metres ÷ civ scale
    this.dbg.minGap = minD2 < 1e8 ? Math.round((Math.sqrt(minD2) / scale) * 1000) / 1000 : -1;
    // closest pair relative to ITS required distance (1 = exactly at the minimum)
    this.dbg.minSepRatio = minRatio < 1e8 ? Math.round(Math.sqrt(minRatio) * 1000) / 1000 : -1;
  }

  /** push civilian i (position in p3) out of any prop footprint in its block cell; a fleeing one
   *  also looks ahead and swerves around the prop instead of ploughing into it */
  private avoidProps(i: number, city: World['city'], bx: number, bz: number, body: number, flee: boolean): void {
    if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return;
    const ids = city.blockProps[bx + bz * city.blocksX];
    let x = this.p3.x, z = this.p3.z;
    let vx = this.vx[i], vz = this.vz[i];
    const sp = Math.sqrt(vx * vx + vz * vz);
    const look = flee ? 0.7 : 0;
    // look-ahead segment midpoint: one circle around it covers the whole swept path
    const hx = vx * look * 0.5, hz = vz * look * 0.5, hr = sp * look * 0.5;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      const p = city.props[id];
      if (!p || !p.alive || id >= this.propHW.length) continue;
      const hw = this.propHW[id] + body, hl = this.propHL[id] + body;
      const r0 = hw + hl;                               // ≥ the half-diagonal: cheap circle rejects first
      let dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > r0 * r0) {
        const mx = dx + hx, mz = dz + hz, rm = r0 + hr;
        if (look === 0 || mx * mx + mz * mz > rm * rm) continue;
      }
      this.propTrig(id, p.heading);
      const sn = this.trigS, cs = this.trigC;
      // local frame: u along the prop's width (X), w along its length (+Z)
      let u = dx * cs - dz * sn, wv = dx * sn + dz * cs;
      if (Math.abs(u) < hw && Math.abs(wv) < hl) {
        // inside: out through the nearest side, and drop the inward velocity
        if (hw - Math.abs(u) < hl - Math.abs(wv)) u = Math.sign(u || 1) * hw; else wv = Math.sign(wv || 1) * hl;
        const nx0 = x, nz0 = z;
        this.dbg.propPush++;
        x = p.x + u * cs + wv * sn; z = p.z - u * sn + wv * cs;
        let nx = x - nx0, nz = z - nz0;
        const nl = Math.sqrt(nx * nx + nz * nz);
        if (nl > 1e-5) {
          nx /= nl; nz /= nl;
          const vn = vx * nx + vz * nz;
          if (vn < 0) { vx -= vn * nx; vz -= vn * nz; }
        }
        dx = x - p.x; dz = z - p.z;
      } else if (look > 0 && sp > 0.1) {
        const ax = dx + vx * look, az = dz + vz * look;
        const ua = ax * cs - az * sn, wa = ax * sn + az * cs;
        if (Math.abs(ua) < hw && Math.abs(wa) < hl) {
          // about to hit it: swerve to the side of the prop we are already on
          let px = -vz / sp, pz = vx / sp;
          if (px * dx + pz * dz < 0) { px = -px; pz = -pz; }
          vx += px * sp * 0.9; vz += pz * sp * 0.9;
        }
      }
    }
    if (flee && sp > 0.1) {
      const nv = Math.sqrt(vx * vx + vz * vz);
      if (nv > 1e-4) { vx *= sp / nv; vz *= sp / nv; }
    }
    this.vx[i] = vx; this.vz[i] = vz;
    this.p3.x = x; this.p3.z = z;
  }

  private trigS = 0;
  private trigC = 1;
  /** sin / cos of a prop's heading into trigS / trigC, computed once per prop per frame */
  private propTrig(id: number, heading: number): void {
    if (this.propStamp[id] !== this.frameNo) {
      this.propStamp[id] = this.frameNo;
      this.propSin[id] = Math.sin(heading); this.propCos[id] = Math.cos(heading);
    }
    this.trigS = this.propSin[id]; this.trigC = this.propCos[id];
  }

  /** would a civilian standing at (x, z) be inside a prop footprint? */
  private inProp(city: World['city'], x: number, z: number, body: number): boolean {
    const P = city.pitch;
    const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
    if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return false;
    const ids = city.blockProps[bx + bz * city.blocksX];
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      const p = city.props[id];
      if (!p || !p.alive || id >= this.propHW.length) continue;
      const hw = this.propHW[id] + body, hl = this.propHL[id] + body;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > (hw + hl) * (hw + hl)) continue;
      this.propTrig(id, p.heading);
      const sn = this.trigS, cs = this.trigC;
      if (Math.abs(dx * cs - dz * sn) < hw && Math.abs(dx * sn + dz * cs) < hl) return true;
    }
    return false;
  }

  /** a figure at (x, y, z) would be partly on screen and partly cut off by the screen edge — or, in
   *  a still frame (`still`), stand in the bottom caption band (slate headline / PRESS ANY KEY) */
  private cutByEdge(x: number, y: number, z: number, sc: number, still = false): boolean {
    const cam = this.ctx.camera;
    const v = this.v3;
    const M = 0.97;
    v.set(x, y, z).project(cam);
    if (still && v.z < 1 && v.y < STILL_BOTTOM && v.y > -1.3 && Math.abs(v.x) < 1.3) return true;
    const feetIn = v.z < 1 && Math.abs(v.x) < M && Math.abs(v.y) < M;
    v.set(x, y + FIG_H * sc, z).project(cam);
    const headIn = v.z < 1 && Math.abs(v.x) < M && Math.abs(v.y) < M;
    return feetIn !== headIn || (!feetIn && !headIn && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3);
  }

  /** in play: does the figure's screen box (feet → head, ± a body half-width) straddle the screen edge
   *  or the news-ticker band along the bottom? */
  private cutByEdgePlay(x: number, y: number, z: number, sc: number): boolean {
    const cam = this.ctx.camera;
    const v = this.v3;
    v.set(x, y, z).project(cam);
    if (v.z >= 1) return false;
    const fx = v.x, fy = v.y;
    v.set(x, y + FIG_H * sc, z).project(cam);
    if (v.z >= 1) return false;
    const hx = v.x, hy = v.y;
    const hw = 0.3 * Math.abs(hy - fy) * this.aspectInv;
    const x0 = Math.min(fx, hx) - hw, x1 = Math.max(fx, hx) + hw, y0 = Math.min(fy, hy), y1 = Math.max(fy, hy);
    const yb = PLAY_BOTTOM;
    const fullyIn = x0 > -1 && x1 < 1 && y0 > yb && y1 < 1;
    const fullyOut = x1 < -1 || x0 > 1 || y1 < yb || y0 > 1;
    return !fullyIn && !fullyOut;
  }

  /** a spot is fine for the camera: not a giant right under the lens, not a big figure cut by the edge */
  private pxAt(x: number, z: number, sc: number): number {
    const c = this.ctx.camera.position;
    return (FIG_H * sc * this.pxK) / Math.max(0.01, Math.hypot(x - c.x, SIDEWALK_Y + 0.75 * sc - c.y, z - c.z));
  }

  private camOk(x: number, z: number, sc: number, still: boolean): boolean {
    const px = this.pxAt(x, z, sc);
    if (px > this.figPx * SPAWN_NEAR) return false;
    return !(px > this.figPx * EDGE_NEAR && this.cutByEdge(x, SIDEWALK_Y, z, sc, still));
  }

  private freeSlot(): number {
    for (let n = 0; n < CAP; n++) {
      const i = (this.freeCursor + n) % CAP;
      if (this.st[i] === ST_EMPTY) { this.freeCursor = (i + 1) % CAP; return i; }
    }
    return -1;
  }

  /**
   * Spawn a small group (1–5) around one anchor spot: strollers walk side by side / in pairs,
   * gawkers stand in a loose staggered arc facing the titan (the ends a step closer to it).
   * Sidewalk groups use the whole sidewalk depth; park / plaza blocks get groups inside them.
   * Every member keeps personal space from everyone already there and from props.
   * Returns how many were placed.
   */
  private spawnGroup(w: World, tx: number, tz: number, R: number, H: number, tbx: number, tbz: number, liveR: number, scale: number, maxN: number, still: boolean): number {
    const city = w.city;
    const P = city.pitch;
    const minD = Math.min(R * 0.7, H * 3);
    const body = BODY_K * scale;
    for (let tries = 0; tries < 10; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * R;
      const sx = tx + Math.cos(ang) * rr, sz = tz + Math.sin(ang) * rr;
      const bx = Math.floor((sx - city.originX) / P), bz = Math.floor((sz - city.originZ) / P);
      if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) continue;
      if (Math.abs(bx - tbx) > liveR || Math.abs(bz - tbz) > liveR) continue;
      const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
      let lx = sx - cx, lz = sz - cz;
      const park = this.parkCell[bx + bz * city.blocksX] === 1 && Math.random() < 0.85;
      const lim = PARCEL_HALF - 1.2;
      let alongX = false, dsgn = 1, inner = SW_IN;
      if (park) {
        if (Math.abs(lx) > lim || Math.abs(lz) > lim) { lx = (Math.random() * 2 - 1) * lim; lz = (Math.random() * 2 - 1) * lim; }
      } else {
        // anywhere across the sidewalk depth — or (40 %) out on the paved forecourt in front of the facades
        alongX = Math.abs(lx) < Math.abs(lz);
        dsgn = Math.sign((alongX ? lz : lx) || 1);
        inner = this.innerLimit(city, bx, bz, cx, cz, alongX, dsgn, alongX ? sx : sz, 0, scale);
        const band = inner < SW_IN - 0.6 && Math.random() < 0.4
          ? inner + 0.3 + Math.random() * (SW_IN - inner - 0.3)
          : SW_IN + 0.3 + Math.random() * (SW_OUT - SW_IN - 0.6);
        if (!alongX) { lx = dsgn * band; lz = Math.max(-SW_OUT, Math.min(SW_OUT, lz)); }
        else { lz = dsgn * band; lx = Math.max(-SW_OUT, Math.min(SW_OUT, lx)); }
      }
      const ax0 = cx + lx, az0 = cz + lz;
      if (this.waterZ !== null && az0 < this.waterZ + 2) continue;
      const d0 = Math.hypot(ax0 - tx, az0 - tz);
      if (d0 > R * 1.05 || d0 < minD) continue;
      if (!this.camOk(ax0, az0, scale, still)) continue;
      if (this.crowdedAt(ax0, az0, ANCHOR_CLEAR_K * scale)) continue;
      if (this.inProp(city, ax0, az0, body) || this.inBuilding(city, ax0, az0, 0.6 * scale)) continue;

      // group formation frame: f = forward (walking direction, or toward the titan), r = right
      const u = Math.random();
      // near the lens (a figure bigger than one at the camera target) groups are small and loose,
      // so the foreground never becomes a wall of overlapping silhouettes
      const near = this.pxAt(ax0, az0, scale) > this.figPx * NEAR_GROUP;
      const gsp = GROUP_SP_K * scale * (near ? 1.3 : 1);
      const nWant = Math.min(maxN, near ? 2 : 5, u < 0.26 ? 1 : u < 0.56 ? 2 : u < 0.78 ? 3 : u < 0.92 ? 4 : 5);
      const gawk = Math.random() < 0.34;
      let fx: number, fz: number;
      if (gawk) { fx = tx - ax0; fz = tz - az0; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l; }
      else if (park) { const h = Math.random() * Math.PI * 2; fx = Math.sin(h); fz = Math.cos(h); }
      else { const dir = Math.random() < 0.5 ? -1 : 1; fx = alongX ? dir : 0; fz = alongX ? 0 : dir; }
      const rx = fz, rz = -fx;
      const spd0 = 0.7 + Math.random() * 0.8;
      const t0 = 2 + Math.random() * 5;
      let leader = -1, placed = 0;
      for (let m = 0; m < nWant; m++) {
        let ox: number, oz: number;
        if (gawk) {
          // loose arc facing the titan: side by side, ends a step closer, alternate rows staggered
          const a = (m - (nWant - 1) / 2) * gsp * 1.05;
          const fwd = (0.3 * a * a) / gsp - (m % 2) * 0.35 * gsp + (Math.random() - 0.5) * 0.15 * gsp;
          ox = rx * a + fx * fwd; oz = rz * a + fz * fwd;
        } else {
          // pairs side by side, pairs one behind the other
          const row = Math.floor(m / 2), pair = nWant - row * 2 >= 2;
          const side = pair ? ((m % 2) - 0.5) * gsp : 0;
          const back = -row * gsp * 1.15 + (Math.random() - 0.5) * 0.12 * gsp;
          ox = rx * side + fx * back; oz = rz * side + fz * back;
        }
        let x = ax0 + ox, z = az0 + oz;
        // keep sidewalk members on the band (depth clamped, stays on this block side)
        if (!park) {
          let mlx = x - cx, mlz = z - cz;
          if (alongX) { mlz = dsgn * Math.min(SW_OUT - 0.15, Math.max(inner + 0.15, dsgn * mlz)); if (Math.abs(mlx) > SW_OUT) continue; }
          else { mlx = dsgn * Math.min(SW_OUT - 0.15, Math.max(inner + 0.15, dsgn * mlx)); if (Math.abs(mlz) > SW_OUT) continue; }
          x = cx + mlx; z = cz + mlz;
        } else if (Math.abs(x - cx) > lim || Math.abs(z - cz) > lim) continue;
        if (this.waterZ !== null && z < this.waterZ + 2) continue;
        if (Math.hypot(x - tx, z - tz) < minD) continue;
        if (m > 0 && !this.camOk(x, z, scale, still)) continue;
        if (this.inProp(city, x, z, body) || this.inBuilding(city, x, z, 0.6 * scale)) continue;
        const i = this.freeSlot();
        if (i < 0) break;
        // dress first: an umbrella / balloon holder needs a wider berth (the slot stays empty if refused)
        this.dressUp(i, w.biomeId);
        this.pose[i] = P_WALK;
        if (this.crowdedAt(x, z, SPAWN_SEP_K * scale, this.radiusOf(i), scale)) continue;
        this.rad[i] = this.radiusOf(i);
        if (leader < 0) leader = i;
        this.initCivilian(i, x, z, tx, tz, leader, park, gawk, fx, fz, spd0, t0 + (i === leader ? 0 : 0.2 + Math.random() * 0.6));
        this.hashInsert(i);
        placed++;
      }
      if (placed > 0) return placed;
    }
    return 0;
  }

  private initCivilian(i: number, x: number, z: number, tx: number, tz: number, leader: number, park: boolean,
    gawk: boolean, fx: number, fz: number, spd: number, t: number): void {
    // a recycled slot must not keep followers from its previous life
    for (let j = 0; j < CAP; j++) if (this.lead[j] === i && j !== i) this.lead[j] = j;
    this.x[i] = x; this.z[i] = z;
    this.lead[i] = leader;
    this.fade[i] = 1; this.wallT[i] = 0; this.steer[i] = 0;
    this.inPark[i] = park ? 1 : 0;
    this.ph[i] = Math.random() * 6.28;
    this.hy[i] = 0; this.hp[i] = 0;
    this.hvar[i] = Math.random();
    if (gawk) {
      this.setIdle(i);
      this.t[i] = t;
      this.hd[i] = Math.atan2(tx - x, tz - z) + (Math.random() - 0.5) * 0.35;
      this.amp[i] = 0;
    } else {
      this.st[i] = ST_MILL; this.pose[i] = P_WALK;
      // the leader sets the group's pace; followers keep it (so the group stays together)
      const s = i === leader ? spd * this.archs[this.arch[i]].pace : this.spd[leader];
      this.vx[i] = fx * s; this.vz[i] = fz * s; this.spd[i] = s;
      this.t[i] = t;
      this.hd[i] = Math.atan2(fx, fz);
      this.amp[i] = 1;
    }
  }

  /** choose an archetype + outfit for civilian i */
  private dressUp(i: number, biome: BiomeId): void {
    let r = Math.random() * this.archWSum;
    let a = 0;
    for (; a < this.archW.length - 1; a++) { r -= this.archW[a]; if (r < 0) break; }
    this.arch[i] = a;
    const ar = this.archs[a];
    const lk = ar.look(biome);
    const o = i * 20, C = this.col;
    const put = (off: number, hex: string, wv: number): void => {
      this.c3.set(hex);
      C[o + off] = this.c3.r; C[o + off + 1] = this.c3.g; C[o + off + 2] = this.c3.b; C[o + off + 3] = wv;
    };
    put(0, lk.skin, lk.shoe);
    put(4, lk.top, lk.mask);
    put(8, lk.bottom, 0);
    put(12, lk.hair, ar.mid ?? 0);
    put(16, lk.acc, 0);
  }

  /** group member whose timer ran out: do what the leader is doing (if it is near and calm) */
  private followLeader(i: number): boolean {
    const L = this.lead[i];
    if (L === i) return false;
    const ls = this.st[L];
    const near = Math.hypot(this.x[L] - this.x[i], this.z[L] - this.z[i]) < 5 * this.scaleNow;
    if ((ls !== ST_MILL && ls !== ST_IDLE) || !near) { this.lead[i] = i; return false; }
    if (ls === ST_IDLE) this.setIdle(i);
    else {
      this.st[i] = ST_MILL; this.pose[i] = P_WALK;
      this.vx[i] = this.vx[L]; this.vz[i] = this.vz[L]; this.spd[i] = this.spd[L];
      this.inPark[i] = this.inPark[L];
    }
    this.t[i] = Math.max(0.3, this.t[L]) + 0.2 + Math.random() * 0.6;
    return true;
  }

  /** stand still and gawk: plain stare, film it, point at it, or wave */
  private setIdle(i: number): void {
    this.st[i] = ST_IDLE; this.vx[i] = 0; this.vz[i] = 0; this.t[i] = 1.5 + Math.random() * 3.5;
    const mask = this.col[i * 20 + 7];
    // the right hand is busy holding an umbrella or a cane
    const busyRight = (mask & bit(O_UMB)) !== 0 || (this.archs[this.arch[i]].id === 'elder' && (mask & bit(O_EXTRA)) !== 0);
    const r = Math.random();
    this.pose[i] = busyRight ? P_WALK : r < 0.32 ? P_PHONE : r < 0.55 ? P_POINT : r < 0.68 ? P_WAVE : P_WALK;
  }

  /** walk along the sidewalk side the civilian is on — or stroll anywhere in a park / plaza */
  private setMill(i: number, x: number, z: number, city: World['city'], ar: Arch): void {
    const P = city.pitch;
    const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
    const lx = x - (city.originX + (bx + 0.5) * P), lz = z - (city.originZ + (bz + 0.5) * P);
    const sp = (0.7 + Math.random() * 0.8) * ar.pace;
    const park = bx >= 0 && bz >= 0 && bx < city.blocksX && bz < city.blocksZ && this.parkCell[bx + bz * city.blocksX] === 1
      && Math.abs(lx) < PARCEL_HALF - 0.3 && Math.abs(lz) < PARCEL_HALF - 0.3;
    this.inPark[i] = park ? 1 : 0;
    if (park) {
      const h = Math.random() * Math.PI * 2;
      this.vx[i] = Math.sin(h) * sp; this.vz[i] = Math.cos(h) * sp;
    } else {
      const dir = Math.random() < 0.5 ? -1 : 1;
      if (Math.abs(lx) >= Math.abs(lz)) { this.vx[i] = 0; this.vz[i] = dir * sp; }
      else { this.vx[i] = dir * sp; this.vz[i] = 0; }
    }
    this.spd[i] = sp;
    this.t[i] = 2 + Math.random() * 5;
  }

  /** reached the end of a sidewalk side: continue along the adjacent side of the SAME block
   *  (deterministic, so a walking group turns together) */
  private turnCorner(i: number, wasXSide: boolean, depthSign: number): void {
    const sp = this.spd[i] || 1;
    const dir = -depthSign;
    if (wasXSide) { this.vx[i] = dir * sp; this.vz[i] = 0; } else { this.vz[i] = dir * sp; this.vx[i] = 0; }
  }

  /** innermost |local coordinate| a sidewalk walker may use here: the paved forecourt reaches in up
   *  to PLAZA_DEPTH m, but stops ~0.9 m (× scale) short of any facade covering this spot (or just
   *  ahead) — also where a building stands right at the parcel edge (the walker keeps to the outer
   *  sidewalk then). Round tanks / cooling towers count with their overhanging plinth / flare. */
  private innerLimit(city: World['city'], bx: number, bz: number, cx: number, cz: number, alongIsX: boolean, sideSign: number,
    alongW: number, vAlong: number, scale: number): number {
    if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return SW_IN;
    let lim = PARCEL_HALF - PLAZA_DEPTH;
    const ids = city.blockBuildings[bx + bz * city.blocksX];
    const ahead = alongW + Math.sign(vAlong) * 1.2 * scale;
    const m = 0.35 * scale, gap = 0.9 * scale;
    for (let k = 0; k < ids.length; k++) {
      const b = city.buildings[ids[k]];
      if (!b) continue;
      const bAlong = alongIsX ? b.x : b.z, bDepth = sideSign * (alongIsX ? b.z - cz : b.x - cx);
      let face = -1e9;
      if (isRound(b)) {
        const r = b.w / 2 + ROUND_PAD;
        const da = Math.max(0, Math.min(Math.abs(alongW - bAlong), Math.abs(ahead - bAlong)) - m);
        if (da < r) face = bDepth + Math.sqrt(r * r - da * da);
      }
      const half = (alongIsX ? b.w : b.d) / 2 + m;
      if ((Math.abs(alongW - bAlong) < half) || (Math.abs(ahead - bAlong) < half)) face = Math.max(face, bDepth + (alongIsX ? b.d : b.w) / 2);
      if (face + gap > lim) lim = face + gap;
    }
    return Math.min(lim, Math.max(SW_IN, SW_OUT - 0.3 * scale));
  }

  /** push civilian i (position in p3) out of any building footprint in its block (+ body radius).
   *  A FLEEING civilian that touches a facade peels off it: its velocity turns outward plus its own
   *  tangential bias, and a short cooldown keeps it heading away from the wall (no queue along it). */
  private avoidBuildings(i: number, city: World['city'], bx: number, bz: number, body: number, flee: boolean): void {
    if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return;
    const ids = city.blockBuildings[bx + bz * city.blocksX];
    for (let k = 0; k < ids.length; k++) {
      const b = city.buildings[ids[k]];
      if (!b) continue;
      // (round buildings: the widened circle first, then the square footprint as well)
      for (let pass = isRound(b) ? 0 : 1; pass < 2; pass++) {
        const dx = this.p3.x - b.x, dz = this.p3.z - b.z;
        let nx = 0, nz = 0;
        if (pass === 0) {
          const r = b.w / 2 + ROUND_PAD + body;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          if (d > 1e-4) { nx = dx / d; nz = dz / d; } else { nx = 1; nz = 0; }
          this.p3.x = b.x + nx * r; this.p3.z = b.z + nz * r;
        } else {
          const hw = b.w / 2 + body, hd = b.d / 2 + body;
          if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
          if (hw - Math.abs(dx) < hd - Math.abs(dz)) { nx = Math.sign(dx || 1); this.p3.x = b.x + nx * hw; }
          else { nz = Math.sign(dz || 1); this.p3.z = b.z + nz * hd; }
        }
        const vn = this.vx[i] * nx + this.vz[i] * nz;
        if (!flee) {
          if (vn < 0) { this.vx[i] -= vn * nx * 1.3; this.vz[i] -= vn * nz * 1.3; }
          continue;
        }
        this.dbg.wallHits++;
        const sp = this.spd[i] || Math.sqrt(this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i]) || 1;
        let vx = this.vx[i], vz = this.vz[i];
        if (vn < 0) { vx -= vn * nx; vz -= vn * nz; }
        const bs = this.bias[i];
        vx += (nx * 0.7 - nz * bs * 0.8) * sp; vz += (nz * 0.7 + nx * bs * 0.8) * sp;
        const l = Math.sqrt(vx * vx + vz * vz) || 1;
        this.vx[i] = (vx / l) * sp; this.vz[i] = (vz / l) * sp;
        this.wallT[i] = 0.6 + Math.random() * 0.6;
        this.wnx[i] = nx; this.wnz[i] = nz;
      }
    }
  }

  /** fleeing civilian i at (x, z) wants to run along (ux, uz): the steering angle (rad) that keeps its
   *  path clear of facades for a per-civilian look-ahead — 0 while straight ahead is clear, else the
   *  smallest clear turn (its own preferred side first; the current turn is kept while still clear) */
  private fleeFeel(i: number, city: World['city'], x: number, z: number, ux: number, uz: number, sp: number, scale: number): number {
    const L = FEEL_K * this.feel[i] * scale + 0.3 * sp;
    const pad = (BODY_K + WALL_K) * scale;
    if (!this.rayBlocked(city, x, z, ux, uz, L, pad)) return 0;
    const cur = this.steer[i];
    if (cur !== 0) {
      const c = Math.cos(cur), sn = Math.sin(cur);
      if (!this.rayBlocked(city, x, z, ux * c - uz * sn, ux * sn + uz * c, L, pad)) return cur;
    }
    const pref = this.bias[i] >= 0 ? 1 : -1;
    for (let k = 0; k < STEER_ANGLES.length; k++) {
      for (let s2 = 0; s2 < 2; s2++) {
        const a = STEER_ANGLES[k] * (s2 === 0 ? pref : -pref);
        const c = Math.cos(a), sn = Math.sin(a);
        if (!this.rayBlocked(city, x, z, ux * c - uz * sn, ux * sn + uz * c, L, pad)) return a;
      }
    }
    return pref * 1.6;
  }

  /** does the segment (x, z) → +(ux, uz)·L run into a building (footprint + pad)? A segment starting
   *  inside the padded footprint only counts when it does not get out of it (parallel counts). */
  private rayBlocked(city: World['city'], x: number, z: number, ux: number, uz: number, L: number, pad: number): boolean {
    const P = city.pitch;
    const bx0 = Math.floor((x - city.originX) / P), bz0 = Math.floor((z - city.originZ) / P);
    const ex = x + ux * L, ez = z + uz * L;
    const bx1 = Math.floor((ex - city.originX) / P), bz1 = Math.floor((ez - city.originZ) / P);
    if (this.rayBlockedIn(city, bx0, bz0, x, z, ux, uz, L, pad)) return true;
    return (bx1 !== bx0 || bz1 !== bz0) && this.rayBlockedIn(city, bx1, bz1, x, z, ux, uz, L, pad);
  }

  private rayBlockedIn(city: World['city'], bx: number, bz: number, x: number, z: number, ux: number, uz: number, L: number, pad: number): boolean {
    if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return false;
    const ids = city.blockBuildings[bx + bz * city.blocksX];
    for (let k = 0; k < ids.length; k++) {
      const b = city.buildings[ids[k]];
      if (!b) continue;
      const ox = x - b.x, oz = z - b.z;
      if (isRound(b)) {
        const r = b.w / 2 + ROUND_PAD + pad, r2 = r * r;
        const d0 = ox * ox + oz * oz;
        if (d0 < r2) {
          const qx = ox + ux * L, qz = oz + uz * L;
          if (qx * qx + qz * qz <= d0 + 1e-4) return true;
        }
        const t = Math.max(0, Math.min(L, -(ox * ux + oz * uz)));
        const cx = ox + ux * t, cz = oz + uz * t;
        if (cx * cx + cz * cz < r2) return true;
        // (and the square footprint below)
      }
      const hw = b.w / 2 + pad, hd = b.d / 2 + pad;
      const pen0 = Math.min(hw - Math.abs(ox), hd - Math.abs(oz));
      if (pen0 > 0) {
        const qx = ox + ux * L, qz = oz + uz * L;
        if (Math.min(hw - Math.abs(qx), hd - Math.abs(qz)) >= pen0 - 1e-3) return true;
        continue;
      }
      // slab test of the segment against the padded box
      let t0 = 0, t1 = L;
      if (Math.abs(ux) < 1e-6) { if (Math.abs(ox) >= hw) continue; }
      else {
        let ta = (-hw - ox) / ux, tb = (hw - ox) / ux;
        if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(uz) < 1e-6) { if (Math.abs(oz) >= hd) continue; }
      else {
        let ta = (-hd - oz) / uz, tb = (hd - oz) / uz;
        if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      return true;
    }
    return false;
  }

  /** would a civilian standing at (x, z) be inside a building footprint (+ margin)? */
  private inBuilding(city: World['city'], x: number, z: number, margin: number): boolean {
    const P = city.pitch;
    const bx = Math.floor((x - city.originX) / P), bz = Math.floor((z - city.originZ) / P);
    if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return false;
    const ids = city.blockBuildings[bx + bz * city.blocksX];
    for (let k = 0; k < ids.length; k++) {
      const b = city.buildings[ids[k]];
      if (!b) continue;
      if (isRound(b)) { const r = b.w / 2 + ROUND_PAD + margin; if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < r * r) return true; }
      if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return true;
    }
    return false;
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

/** tanks / cooling towers: a round mesh (plinth + flares) — civilians keep to a circle around it */
function isRound(b: { shape: string }): boolean { return b.shape === 'cylinder'; }

/** feeler turn angles (rad), tried on the preferred side first: ~31°, 57°, 83°, 109°, 137° */
const STEER_ANGLES = [0.55, 1.0, 1.45, 1.9, 2.4] as const;

function wrapPi(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

function turnToward(cur: number, target: number, k: number): number {
  return cur + wrapPi(target - cur) * Math.min(1, k);
}
