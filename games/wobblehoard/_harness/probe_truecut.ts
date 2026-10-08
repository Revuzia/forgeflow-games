// PHYS probe: the TRUE CUT geometry and the goal centring (_spec/CUT2.md 13.1 rows G1-G7, 13.2 rows L5, L6, L10, C2; tasks P0, P1a, P1b). Plain node (type stripping):
//   node _harness/probe_truecut.ts [--quick] [--species=a,b] [--skip=geom,eyes,nested,cost,alloc,l5,l6,l6b,hinge,c1,c1cost,c2b,info,launch,l2,l3] [--only=c1,l2]
//   the P2 / P3 rows (solver side, bodies built from regions): l6b hinge c1 c1cost c2b info launch l2 l3 (the geometry rows above are tasks P0 to P1b)
// Prints a table of measured values against the SPEC'S BARS and exits 1 on any failure. Deterministic (seeded). No solver is involved in the geometry rows:
// every number is measured by something other than the builder (column-integrated volumes, point-triangle distances and ray parity against the ORIGINAL
// detail-3 whole mesh, `new SoftBody(genome).restLocal`).
// PLANE SETS. (1) the first sweep: level (y), z and tilted t1, t2 at offsets -0.5 -0.2 0 +0.2 +0.5 R0 from the centre, vertical (x) at 0 +0.2 +0.5 = 23 planes, both
// sides; the two tilted normals are not recorded in the spec, so t1 = (0.667, 0.718, -0.199) and t2 = (-0.45, 0.62, 0.64) (normalised) are THIS probe's choice.
// (2) the red team's four families (905 planes in the spec; regenerated here deterministically because the saved list was lost with the Linux container):
// per species 5 slivers (the small side bisected to 0.125-0.155), 5 planes through the foot, 5 uniformly random planes and up to 3 through thin features'
// tips, every plane keeping both sides >= 1/8. (3) nested: random cut trees of up to 5 cuts. --quick runs 8 species and fewer planes (what run_probes uses).
import v8 from 'node:v8';
import { readFileSync } from 'node:fs';
import { SoftBody } from '../src/physics/softbody.ts';
import { CATALOG, speciesTemplateGenome } from '../src/data/catalog.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { buildRest, meshVolume, recipeOf } from '../src/physics/shape.ts';
import { buildIcosphere } from '../src/physics/mesh.ts';
import { evalShape } from '../src/data/shapes.ts';
import { CutJob, PieceJob, PIECE_TUNING, buildPiece, newCutPlanParts, planChildren, pieceCacheSize, pieceDetail, clearPieceCache } from '../src/physics/piece.ts';
import { FINGER } from '../src/physics/params.ts';
import { wholeSession, pairSession } from './physview/l6_session.ts';
import type { PieceBuilt } from '../src/physics/piece.ts';
import { clipMesh, CLIP_VOL, getSource } from '../src/physics/region.ts';
import type { CutPlan, CutPlane, PieceRegion } from '../src/contracts.ts';
import type { V3 } from '../src/contracts.ts';

const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith('--' + k + '='))?.slice(k.length + 3);
const QUICK = process.argv.includes('--quick');
for (const a of process.argv) { const m = /^--tune=([A-Z_]+)=(.+)$/.exec(a); if (m) (PIECE_TUNING as Record<string, number>)[m[1]] = +m[2]; }   // e.g. --tune=RIM_SMOOTH=0
const SKIP = (arg('skip') ?? '').split(',').filter(Boolean);
const SECTIONS = ['geom', 'eyes', 'nested', 'cost', 'alloc', 'l5', 'l6', 'l6b', 'hinge', 'c1', 'c1cost', 'c2b', 'info', 'launch', 'l2', 'l3'];
if (arg('only')) { const keep = arg('only')!.split(',').filter(Boolean); for (const s of SECTIONS) if (!keep.includes(s) && !SKIP.includes(s)) SKIP.push(s); }   // e.g. --only=c1,l2
const ALL = CATALOG.map((d) => d.id as string);
const QUICK_SET = ['dollop', 'kneadle', 'capnap', 'munchip', 'selenuff', 'ambrosel', 'twangle', 'marigel'];
const SPECIES = arg('species') ? arg('species')!.split(',') : QUICK ? QUICK_SET : ALL;
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const info = (what: string, value: string): void => { rows.push({ what: 'INFO ' + what, value, limit: '-', pass: true }); };
const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const t0 = performance.now();

/* ───────────────────────────── statistics ───────────────────────────── */
const pct = (a: number[], p: number): number => { if (a.length === 0) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const med = (a: number[]): number => pct(a, 0.5);
const mn = (a: number[]): number => (a.length ? Math.min(...a) : NaN);
const mx = (a: number[]): number => (a.length ? Math.max(...a) : NaN);
class Acc { m = new Map<string, number[]>(); push(k: string, v: number): void { let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); } a.push(v); } get(k: string): number[] { return this.m.get(k) ?? []; } }
const ACC: Record<string, Acc> = { sweep: new Acc(), rt: new Acc(), nested: new Acc() };
const COUNT: Record<string, Record<string, number>> = { sweep: {}, rt: {}, nested: {} };
const bump = (set: string, k: string, n = 1): void => { COUNT[set][k] = (COUNT[set][k] ?? 0) + n; };
const NOTES: string[] = [];   // per-species / per-plane detail lines for failures

/* ───────────────────────────── meshes, columns, distances (the independent instruments) ───────────────────────────── */
interface Mesh { pos: Float64Array; tris: Uint32Array }
const pieceMesh = (p: PieceBuilt): Mesh => {
  const r = p.rest.restLocal, o = p.offset, pos = new Float64Array(r.length);
  for (let i = 0; i < r.length; i += 3) { pos[i] = r[i] + o.x; pos[i + 1] = r[i + 1] + o.y; pos[i + 2] = r[i + 2] + o.z; }
  return { pos, tris: p.mesh.tris };
};
const NZ = 512;
const ZS = new Float64Array(NZ), ZG = new Int8Array(NZ);
const IW = new Float64Array(NZ), IA = new Float64Array(NZ), IB = new Float64Array(NZ), IRA = new Float64Array(NZ), IRB = new Float64Array(NZ);
const T1 = new Float64Array(NZ), T2 = new Float64Array(NZ), T3 = new Float64Array(NZ), T4 = new Float64Array(NZ);

class Grid {
  readonly pos: Float64Array; readonly tris: Uint32Array; readonly bs: Int32Array; readonly bl: Int32Array;
  readonly x0: number; readonly y0: number; readonly bin: number; readonly nbx: number; readonly nby: number;
  constructor(m: Mesh, x0: number, y0: number, x1: number, y1: number, bin: number) {
    this.pos = m.pos; this.tris = m.tris; this.x0 = x0; this.y0 = y0; this.bin = bin;
    this.nbx = Math.ceil((x1 - x0) / bin) + 1; this.nby = Math.ceil((y1 - y0) / bin) + 1;
    const nb = this.nbx * this.nby, cnt = new Int32Array(nb + 1), nt = m.tris.length / 3;
    const rng = (t: number): number[] => {
      let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
      for (let k = 0; k < 3; k++) { const v = m.tris[t * 3 + k] * 3, x = m.pos[v], y = m.pos[v + 1]; if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
      return [Math.max(0, Math.floor((ax - x0) / bin)), Math.min(this.nbx - 1, Math.floor((bx - x0) / bin)), Math.max(0, Math.floor((ay - y0) / bin)), Math.min(this.nby - 1, Math.floor((by - y0) / bin))];
    };
    for (let t = 0; t < nt; t++) { const r = rng(t); for (let j = r[2]; j <= r[3]; j++) for (let i = r[0]; i <= r[1]; i++) cnt[j * this.nbx + i + 1]++; }
    for (let i = 0; i < nb; i++) cnt[i + 1] += cnt[i];
    this.bs = cnt; this.bl = new Int32Array(cnt[nb]);
    const fill = new Int32Array(nb);
    for (let t = 0; t < nt; t++) { const r = rng(t); for (let j = r[2]; j <= r[3]; j++) for (let i = r[0]; i <= r[1]; i++) { const b = j * this.nbx + i; this.bl[this.bs[b] + fill[b]++] = t; } }
  }
  /** Inside intervals along the vertical line through (x, y): [z0, z1] pairs into out; returns the number of intervals. */
  intervals(x: number, y: number, out: Float64Array): number {
    const bi = Math.floor((x - this.x0) / this.bin), bj = Math.floor((y - this.y0) / this.bin);
    if (bi < 0 || bj < 0 || bi >= this.nbx || bj >= this.nby) return 0;
    const b = bj * this.nbx + bi, pos = this.pos, tris = this.tris;
    let nc = 0;
    for (let q = this.bs[b], qe = this.bs[b + 1]; q < qe; q++) {
      const t = this.bl[q] * 3, a = tris[t] * 3, bb = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const d = (pos[bb] - ax) * (pos[c + 1] - ay) - (pos[bb + 1] - ay) * (pos[c] - ax);
      if (d > -1e-18 && d < 1e-18) continue;
      const u = ((x - ax) * (pos[c + 1] - ay) - (y - ay) * (pos[c] - ax)) / d, v = ((pos[bb] - ax) * (y - ay) - (pos[bb + 1] - ay) * (x - ax)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      if (nc < NZ - 1) { ZS[nc] = az + u * (pos[bb + 2] - az) + v * (pos[c + 2] - az); ZG[nc] = d > 0 ? -1 : 1; nc++; }   // d > 0: normal toward +z, the upward line leaves
    }
    for (let i = 1; i < nc; i++) { const z = ZS[i], g = ZG[i]; let j = i - 1; while (j >= 0 && (ZS[j] > z || (ZS[j] === z && ZG[j] < g))) { ZS[j + 1] = ZS[j]; ZG[j + 1] = ZG[j]; j--; } ZS[j + 1] = z; ZG[j + 1] = g; }
    let n = 0, inside = false, start = 0;
    for (let i = 0; i < nc; i++) {
      if (ZG[i] > 0 && !inside) { inside = true; start = ZS[i]; }
      else if (ZG[i] < 0 && inside) { inside = false; if (ZS[i] > start) { out[n * 2] = start; out[n * 2 + 1] = ZS[i]; n++; } }
    }
    return n;
  }
}
const isect = (a: Float64Array, na: number, b: Float64Array, nb: number, out: Float64Array): number => {
  let i = 0, j = 0, n = 0;
  while (i < na && j < nb) {
    const lo = Math.max(a[i * 2], b[j * 2]), hi = Math.min(a[i * 2 + 1], b[j * 2 + 1]);
    if (hi > lo) { out[n * 2] = lo; out[n * 2 + 1] = hi; n++; }
    if (a[i * 2 + 1] < b[j * 2 + 1]) i++; else j++;
  }
  return n;
};
const ilen = (a: Float64Array, n: number): number => { let s = 0; for (let i = 0; i < n; i++) s += a[i * 2 + 1] - a[i * 2]; return s; };
/** Clip intervals by half-spaces n . p >= d (flat [nx, ny, nz, d] x k) at column (x, y). */
const clipPlanes = (src: Float64Array, n: number, planes: number[], x: number, y: number, out: Float64Array): number => {
  let lo = -Infinity, hi = Infinity;
  for (let p = 0; p < planes.length; p += 4) {
    const s0 = planes[p] * x + planes[p + 1] * y - planes[p + 3], nz = planes[p + 2];
    if (nz > 1e-12) { const z = -s0 / nz; if (z > lo) lo = z; } else if (nz < -1e-12) { const z = -s0 / nz; if (z < hi) hi = z; } else if (s0 < 0) return 0;
  }
  let m = 0;
  for (let i = 0; i < n; i++) { const a = Math.max(src[i * 2], lo), b = Math.min(src[i * 2 + 1], hi); if (b > a) { out[m * 2] = a; out[m * 2 + 1] = b; m++; } }
  return m;
};
/** A column setup for one species: columns of size h over the box of the source solid (+ margin), offset by an irrational fraction so no column lies on a plane. */
interface Cols { x0: number; y0: number; nx: number; ny: number; h: number }
const colsFor = (R0: number, box: Float64Array): Cols => {
  const h = R0 / 32, x0 = box[0] - 2 * h + 0.123456 * h, y0 = box[1] - 2 * h + 0.337211 * h;
  return { x0, y0, nx: Math.ceil((box[3] - box[0]) / h) + 4, ny: Math.ceil((box[4] - box[1]) / h) + 4, h };
};
const gridOf = (m: Mesh, c: Cols): Grid => new Grid(m, c.x0 - c.h, c.y0 - c.h, c.x0 + (c.nx + 1) * c.h, c.y0 + (c.ny + 1) * c.h, 4 * c.h);

interface PairVol { vA: number; vB: number; vW: number; vRA: number; vRB: number; vAR: number; vBR: number; vAB: number; vCov: number }
/** Volumes of the pieces, the reference (whole clipped by each side) and their overlaps by column integration (exact along z, R0/32 across). */
function pairColumns(c: Cols, wg: Grid, ga: Grid, gb: Grid, planesA: number[], planesB: number[]): PairVol {
  const r: PairVol = { vA: 0, vB: 0, vW: 0, vRA: 0, vRB: 0, vAR: 0, vBR: 0, vAB: 0, vCov: 0 };
  for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) {
    const x = c.x0 + i * c.h, y = c.y0 + j * c.h;
    const nw = wg.intervals(x, y, IW), na = ga.intervals(x, y, IA), nb = gb.intervals(x, y, IB);
    if (nw + na + nb === 0) continue;
    const nra = clipPlanes(IW, nw, planesA, x, y, IRA), nrb = clipPlanes(IW, nw, planesB, x, y, IRB);
    r.vA += ilen(IA, na); r.vB += ilen(IB, nb); r.vW += ilen(IW, nw); r.vRA += ilen(IRA, nra); r.vRB += ilen(IRB, nrb);
    r.vAR += ilen(T1, isect(IA, na, IRA, nra, T1)); r.vBR += ilen(T2, isect(IB, nb, IRB, nrb, T2));
    r.vAB += ilen(T3, isect(IA, na, IB, nb, T3));
    const wa = isect(IW, nw, IA, na, T1), wb = isect(IW, nw, IB, nb, T2), wab = isect(T1, wa, T2, wb, T4);
    r.vCov += ilen(T1, wa) + ilen(T2, wb) - ilen(T4, wab);
  }
  const k = c.h * c.h;
  for (const key of Object.keys(r) as Array<keyof PairVol>) r[key] *= k;
  return r;
}
/** IoU of one piece against the whole clipped by `planes` (nested leaves). */
function leafIoU(c: Cols, wg: Grid, gp: Grid, planes: number[]): number {
  let vP = 0, vR = 0, vPR = 0;
  for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) {
    const x = c.x0 + i * c.h, y = c.y0 + j * c.h;
    const nw = wg.intervals(x, y, IW), np = gp.intervals(x, y, IA);
    if (nw + np === 0) continue;
    const nr = clipPlanes(IW, nw, planes, x, y, IRA);
    vP += ilen(IA, np); vR += ilen(IRA, nr); vPR += ilen(T1, isect(IA, np, IRA, nr, T1));
  }
  const un = vP + vR - vPR;
  return un > 0 ? vPR / un : 0;
}
/** Squared distance from p to triangle (a, b, c) (Ericson 5.1.5). */
function ptTri2(px: number, py: number, pz: number, P: Float64Array, a: number, b: number, c: number): number {
  const ax = P[a], ay = P[a + 1], az = P[a + 2], abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = P[b]; qy = P[b + 1]; qz = P[b + 2]; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
      else {
        const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = P[c]; qy = P[c + 1]; qz = P[c + 2]; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); qx = P[b] + w * (P[c] - P[b]); qy = P[b + 1] + w * (P[c + 1] - P[b + 1]); qz = P[b + 2] + w * (P[c + 2] - P[b + 2]); }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}
const distToMesh2 = (m: Mesh, x: number, y: number, z: number, stop = 0): number => {
  let best = Infinity;
  for (let t = 0; t < m.tris.length; t += 3) { const d = ptTri2(x, y, z, m.pos, m.tris[t] * 3, m.tris[t + 1] * 3, m.tris[t + 2] * 3); if (d < best) { best = d; if (best < stop) break; } }
  return best;
};
const PD = [0.2672612419124244, 0.5345224838248488, 0.8017837257372732];
/** Point-in-mesh by ray parity (brute force, a fixed oblique direction). */
function insideMesh(m: Mesh, x: number, y: number, z: number): boolean {
  const P = m.pos, T = m.tris;
  let hits = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = PD[1] * e2z - PD[2] * e2y, py = PD[2] * e2x - PD[0] * e2z, pz = PD[0] * e2y - PD[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-18 && det < 1e-18) continue;
    const inv = 1 / det, tx = x - P[a], ty = y - P[a + 1], tz = z - P[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (PD[0] * qx + PD[1] * qy + PD[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0) hits++;
  }
  return (hits & 1) === 1;
}
/** Area of the section of a closed mesh by the plane n . x = d (polygon loop, oriented by the triangle normals). */
function sectionArea(m: Mesh, n: V3, d: number): number {
  const P = m.pos, T = m.tris;
  let s = 0;
  for (let t = 0; t < T.length; t += 3) {
    const v = [T[t] * 3, T[t + 1] * 3, T[t + 2] * 3], sd = v.map((i) => n.x * P[i] + n.y * P[i + 1] + n.z * P[i + 2] - d);
    const pts: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const a = k, b = (k + 1) % 3;
      if ((sd[a] >= 0) !== (sd[b] >= 0)) { const w = sd[a] / (sd[a] - sd[b]); pts.push([P[v[a]] + w * (P[v[b]] - P[v[a]]), P[v[a] + 1] + w * (P[v[b] + 1] - P[v[a] + 1]), P[v[a] + 2] + w * (P[v[b] + 2] - P[v[a] + 2])]); }
    }
    if (pts.length !== 2) continue;
    const e1 = [P[v[1]] - P[v[0]], P[v[1] + 1] - P[v[0] + 1], P[v[1] + 2] - P[v[0] + 2]], e2 = [P[v[2]] - P[v[0]], P[v[2] + 1] - P[v[0] + 1], P[v[2] + 2] - P[v[0] + 2]];
    const N = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const Tn = [n.y * N[2] - n.z * N[1], n.z * N[0] - n.x * N[2], n.x * N[1] - n.y * N[0]];
    let [p, q] = pts;
    if ((q[0] - p[0]) * Tn[0] + (q[1] - p[1]) * Tn[1] + (q[2] - p[2]) * Tn[2] < 0) { const tt = p; p = q; q = tt; }
    s += (p[1] * q[2] - p[2] * q[1]) * n.x + (p[2] * q[0] - p[0] * q[2]) * n.y + (p[0] * q[1] - p[1] * q[0]) * n.z;
  }
  return Math.abs(s) / 2;
}

/* ───────────────────────────── plane sets ───────────────────────────── */
interface PlaneSpec { n: V3; off: number; label: string; family: string }   // the plane n . p = off R0, side A: n . p >= off R0
const unit = (x: number, y: number, z: number): V3 => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
function sweepPlanes(): PlaneSpec[] {
  const out: PlaneSpec[] = [], sym = [-0.5, -0.2, 0, 0.2, 0.5];
  const fam: Array<[string, V3, number[]]> = [['y', unit(0, 1, 0), sym], ['z', unit(0, 0, 1), sym], ['x', unit(1, 0, 0), [0, 0.2, 0.5]], ['t1', unit(0.667, 0.718, -0.199), sym], ['t2', unit(-0.45, 0.62, 0.64), sym]];
  for (const [nm, n, offs] of fam) for (const o of offs) out.push({ n, off: o, label: nm + (o >= 0 ? '+' : '') + o, family: nm });
  return out;
}
interface WholeCtx { g: ReturnType<typeof speciesTemplateGenome>; id: string; R0: number; pos: Float64Array; tris: Uint32Array; V3: number; idx: number }
const clipTmp = new Float64Array(16);
const shareAbove = (w: WholeCtx, n: V3, d: number): number => { clipMesh(w.pos, w.tris, [n.x, n.y, n.z, d], clipTmp); return clipTmp[CLIP_VOL] / w.V3; };
const bothSides = (w: WholeCtx, n: V3, d: number, lo = 0.125): boolean => { const fa = shareAbove(w, n, d); return fa >= lo && 1 - fa >= lo; };
function redTeamPlanes(w: WholeCtx): PlaneSpec[] {
  const rnd = mulberry32(0x7c0de + w.idx * 977), R0 = w.R0, out: PlaneSpec[] = [];
  const nEach = QUICK ? 2 : 5;
  const rndUnit = (): V3 => { const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z); return { x: r * Math.cos(a), y: z, z: r * Math.sin(a) }; };
  let ymin = Infinity;
  for (let i = 1; i < w.pos.length; i += 3) ymin = Math.min(ymin, w.pos[i]);
  // 1/8 slivers: the small side (side A) bisected to 0.125 - 0.155
  for (let k = 0; k < nEach; k++) {
    const n = rndUnit(), target = 0.125 + 0.03 * rnd();
    let lo = -2 * R0, hi = 2 * R0;
    for (let it = 0; it < 40; it++) { const mid = 0.5 * (lo + hi); if (shareAbove(w, n, mid) > target) lo = mid; else hi = mid; }
    out.push({ n, off: (0.5 * (lo + hi)) / R0, label: 'sliver' + k, family: 'sliver' });
  }
  // through the foot: a plane through a point just above the lowest point, tilted 25-70 degrees from level
  for (let k = 0; k < nEach; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const th = ((25 + 45 * rnd()) * Math.PI) / 180, ph = 2 * Math.PI * rnd(), n = { x: Math.sin(th) * Math.cos(ph), y: Math.cos(th), z: Math.sin(th) * Math.sin(ph) };
      const px = (rnd() - 0.5) * 0.3 * R0, pz = (rnd() - 0.5) * 0.3 * R0, d = n.x * px + n.y * (ymin + 0.01 * R0) + n.z * pz;
      if (bothSides(w, n, d)) { out.push({ n, off: d / R0, label: 'foot' + k, family: 'foot' }); break; }
    }
  }
  // uniformly random planes
  for (let k = 0; k < nEach; k++) {
    for (let tries = 0; tries < 60; tries++) {
      const n = rndUnit(), p = rndUnit(), r = 0.6 * R0 * Math.cbrt(rnd()), d = n.x * p.x * r + n.y * p.y * r + n.z * p.z * r;
      if (bothSides(w, n, d)) { out.push({ n, off: d / R0, label: 'rand' + k, family: 'rand' }); break; }
    }
  }
  // through the tips of thin features (ears, horns, tails): the recipe's non-dent features that are tall for their width and narrow
  const rec = recipeOf(w.id), thin = rec.features.filter((ft) => {
    if (ft.kind === 'dent') return false;
    const r = ft.amp / ft.width, a = Math.min(1, Math.max(0, (r - 0.7) / 0.6)), b = Math.min(1, Math.max(0, (ft.width - 0.4) / 0.2));
    return a * a * (3 - 2 * a) * (1 - b * b * (3 - 2 * b)) > 0.2;
  });
  for (let k = 0; k < (thin.length ? (QUICK ? 1 : 3) : 0); k++) {
    const ft = thin[k % thin.length], mir = ft.mirrorX && rnd() < 0.5 ? -1 : 1, dx = ft.dir[0] * mir, dy = ft.dir[1], dz = ft.dir[2], r = evalShape(rec, dx, dy, dz) * R0 * 0.8;
    for (let tries = 0; tries < 60; tries++) {
      const n = rndUnit();
      if (Math.abs(n.x * dx + n.y * dy + n.z * dz) > 0.85) continue;
      // the plane passes through the point 80 % of the way out along the feature (in W: the recipe origin is the centroid up to ~0.05 R0)
      const d = n.x * dx * r + n.y * dy * r + n.z * dz * r;
      if (bothSides(w, n, d)) { out.push({ n, off: d / R0, label: 'thin' + k, family: 'thin' }); break; }
    }
  }
  return out;
}

/* ───────────────────────────── measuring one cut ───────────────────────────── */
const stageMs: number[] = [], pieceMs3: number[] = [], pieceMs2: number[] = [];
const TIMES: Record<string, number> = {};
const timed = <T,>(k: string, fn: () => T): T => { const t = performance.now(); const r = fn(); TIMES[k] = (TIMES[k] ?? 0) + performance.now() - t; return r; };
function runCut(g: WholeCtx['g'], parent: { region: PieceRegion | undefined; frac: number; pos: Float64Array; tris: Uint32Array }, id: number, n: V3, d: number): CutJob {
  const job = new CutJob(g, parent, { id, n, d });
  const tc = performance.now();
  let guard = 0;
  while (job.status === 'run' && guard++ < 5000) { const ts = performance.now(); job.run(Infinity, 1); stageMs.push(performance.now() - ts); }
  const el = performance.now() - tc;
  if (job.a && job.b) {
    // attribute the elapsed time to the pieces by their particle counts (642 / 162), a coarse split of a pair build
    const w3 = (job.a.detail === 3 ? 642 : 162) + (job.b.detail === 3 ? 642 : 162);
    (job.a.detail === 3 ? pieceMs3 : pieceMs2).push((el * (job.a.detail === 3 ? 642 : 162)) / w3);
    (job.b.detail === 3 ? pieceMs3 : pieceMs2).push((el * (job.b.detail === 3 ? 642 : 162)) / w3);
  }
  return job;
}
const planeOf = (p: PieceBuilt): number[] => { const out: number[] = []; for (const c of p.cells[0]) out.push(-c.n.x, -c.n.y, -c.n.z, -c.d); return out; };   // kept n . x >= d

/** Per-piece instruments G2 G3 G4 G5 (and the plane-side part of L10). `capIdx` is the cell plane (the newest) to check G2/G3 against. */
function measurePiece(set: string, w: WholeCtx, whole: Mesh, p: PieceBuilt, label: string, strideG5: number, doCap = true): void {
  const A = ACC[set], R0 = w.R0, pm = pieceMesh(p), pl = planeOf(p), np = pl.length / 4, tag = w.id + ' ' + label, det = p.detail === 3 ? '3' : '2';
  const tris = pm.tris, nTri = tris.length / 3;
  // G4: validity on the rest mesh (centred at the mass centroid = the origin) and on the vertex mean
  const L = p.rest.restLocal, n = p.mesh.vertexCount;
  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < n; i++) { ax += L[i * 3]; ay += L[i * 3 + 1]; az += L[i * 3 + 2]; }
  ax /= n; ay /= n; az /= n;
  let sumA = 0, flips = 0, wrong = 0, flipsRay = 0;
  const ro = p.rayOrigin;
  const areas = new Float64Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    const ux = L[b] - L[a], uy = L[b + 1] - L[a + 1], uz = L[b + 2] - L[a + 2], vx = L[c] - L[a], vy = L[c + 1] - L[a + 1], vz = L[c + 2] - L[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    areas[t] = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz); sumA += areas[t];
    if (nx * L[a] + ny * L[a + 1] + nz * L[a + 2] <= 0) flips++;
    if (nx * (L[a] - ax) + ny * (L[a + 1] - ay) + nz * (L[a + 2] - az) <= 0) wrong++;
    if (nx * (L[a] - ro.x) + ny * (L[a + 1] - ro.y) + nz * (L[a + 2] - ro.z) <= 0) flipsRay++;
  }
  let small = 0;
  for (let t = 0; t < nTri; t++) if (areas[t] < 1e-4 * (sumA / nTri)) small++;
  // smallest angle of the region, and of the cap triangles
  const onCap = new Uint8Array(n);
  const planeIdx = np - 1;   // the newest cut's plane is the last literal
  if (np > 0) for (let i = 0; i < n; i++) { const x = pm.pos[i * 3], y = pm.pos[i * 3 + 1], z = pm.pos[i * 3 + 2], q = planeIdx * 4; onCap[i] = Math.abs(pl[q] * x + pl[q + 1] * y + pl[q + 2] * z - pl[q + 3]) < 1e-6 * R0 ? 1 : 0; }
  let minAng = 180, capSmall = false, capArea = 0;
  for (let t = 0; t < nTri; t++) {
    const v = [tris[t * 3] * 3, tris[t * 3 + 1] * 3, tris[t * 3 + 2] * 3];
    const e = [0, 1, 2].map((k) => { const a = v[k], b = v[(k + 1) % 3]; return Math.hypot(pm.pos[b] - pm.pos[a], pm.pos[b + 1] - pm.pos[a + 1], pm.pos[b + 2] - pm.pos[a + 2]); });
    let tmin = 180;
    for (let k = 0; k < 3; k++) { const a = e[k], b = e[(k + 1) % 3], c = e[(k + 2) % 3]; const cs = Math.max(-1, Math.min(1, (a * a + b * b - c * c) / (2 * a * b))); tmin = Math.min(tmin, (Math.acos(cs) * 180) / Math.PI); }
    minAng = Math.min(minAng, tmin);
    if (np > 0 && onCap[tris[t * 3]] && onCap[tris[t * 3 + 1]] && onCap[tris[t * 3 + 2]]) { capArea += areas[t]; if (tmin < 15) capSmall = true; }
  }
  A.push('flipsRay', flipsRay); A.push('flips', flips); A.push('wrong', wrong / nTri); A.push('small', small); A.push('minAng', minAng); A.push('massLo', p.minMass); A.push('massHi', p.maxMass);
  A.push('capSmall' + det, capSmall ? 1 : 0);
  if (flips || small || wrong / nTri > 0.005) NOTES.push(`G4 ${set} ${tag}: flips(mass centroid) ${flips}, flips(ray origin) ${flipsRay}, wrong-facing(vertex mean) ${wrong}, small-area ${small}`);
  A.push('rimClean' + det, p.rimClean ? 1 : 0);
  if (!p.rimClean) NOTES.push(`G3 ${set} ${tag}: rim snap reverted (detail ${det}, frac ${f(p.frac, 3)})`);
  if (np > 0 && doCap) {
    // G2: planarity of the cap vertices and cap area / exact section area of the ORIGINAL mesh
    let planar = 0;
    for (let i = 0; i < n; i++) if (onCap[i]) { const q = planeIdx * 4, s = Math.abs(pl[q] * pm.pos[i * 3] + pl[q + 1] * pm.pos[i * 3 + 1] + pl[q + 2] * pm.pos[i * 3 + 2] - pl[q + 3]); if (s > planar) planar = s; }
    A.push('planar', planar / R0);
    const q = planeIdx * 4, sec = sectionArea(whole, { x: pl[q], y: pl[q + 1], z: pl[q + 2] }, pl[q + 3]);
    // (a nested piece's cap on its newest plane is only the part of the section inside its other half-spaces: the ratio to the whole section means nothing there)
    if (sec > 1e-6 && np === 1) { A.push('capRatio' + det, capArea / sec); if (capArea / sec < (det === '3' ? 0.9 : 0.7)) NOTES.push(`G2 ${set} ${tag}: cap/section ${f(capArea / sec, 3)} (detail ${det}, frac ${f(p.frac, 3)}, cap area ${f(capArea / (R0 * R0), 3)} R0^2)`); }
    // G3: rim vertices (cap vertices with a neighbour off the cap) to the nearest triangle of the ORIGINAL mesh
    const rim = new Uint8Array(n);
    for (let t = 0; t < nTri; t++) {
      const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
      if (!(onCap[a] && onCap[b] && onCap[c])) { if (onCap[a]) rim[a] = 1; if (onCap[b]) rim[b] = 1; if (onCap[c]) rim[c] = 1; }
    }
    let rimMax = 0;
    for (let i = 0; i < n; i++) if (rim[i]) rimMax = Math.max(rimMax, Math.sqrt(distToMesh2(whole, pm.pos[i * 3], pm.pos[i * 3 + 1], pm.pos[i * 3 + 2])));
    A.push(p.rimClean ? 'rimDist' : 'rimDistRev', rimMax / R0);
    if (p.rimClean) { const Ss = getSource(w.g), Sm: Mesh = { pos: Ss.pos, tris: Ss.tris }; let rm = 0; for (let i = 0; i < n; i++) if (rim[i]) { const dS = Math.sqrt(distToMesh2(Sm, pm.pos[i * 3], pm.pos[i * 3 + 1], pm.pos[i * 3 + 2])); rm = Math.max(rm, dS); A.push('rimVertS', dS / R0); } A.push('rimDistS', rm / R0); if (rm / R0 > 1e-6) NOTES.push(`G3S ${set} ${tag}: worst rim vertex ${(rm / R0).toExponential(2)} R0 from S (detail ${det}, frac ${f(p.frac, 3)})`); }
    if (p.rimClean && rimMax / R0 > 0.01) NOTES.push(`G3 ${set} ${tag}: rim ${f(rimMax / R0, 4)} R0 from the original`);
  }
  // G5: one-sided distance from sampled points of the original skin on the kept side to the piece mesh (max over samples)
  const samples: number[] = [], wp = whole.pos, wt = whole.tris;
  const keep = (x: number, y: number, z: number): boolean => { for (let k = 0; k < np; k++) { if (pl[k * 4] * x + pl[k * 4 + 1] * y + pl[k * 4 + 2] * z - pl[k * 4 + 3] < 1e-9) return false; } return true; };
  for (let i = 0; i < wp.length; i += 3) if (keep(wp[i], wp[i + 1], wp[i + 2])) samples.push(wp[i], wp[i + 1], wp[i + 2]);
  for (let t = 0; t < wt.length; t += 3) {
    const a = wt[t] * 3, b = wt[t + 1] * 3, c = wt[t + 2] * 3, x = (wp[a] + wp[b] + wp[c]) / 3, y = (wp[a + 1] + wp[b + 1] + wp[c + 1]) / 3, z = (wp[a + 2] + wp[b + 2] + wp[c + 2]) / 3;
    if (keep(x, y, z)) samples.push(x, y, z);
  }
  let worst2 = 0;
  for (let s = 0; s < samples.length; s += 3 * strideG5) { const d2 = distToMesh2(pm, samples[s], samples[s + 1], samples[s + 2], worst2); if (d2 > worst2) worst2 = d2; }
  const hz = Math.sqrt(worst2) / R0;
  A.push(set === 'nested' ? 'hausN' : 'haus' + det, hz);
  if (hz > (set === 'nested' ? 0.4 : 0.35)) NOTES.push(`G5 ${set} ${tag}: coverage ${f(hz, 3)} R0 (detail ${det})`);
}

/** L10 for a pair: vertices across their own planes, and particles inside the sibling deeper than 0.001 R0. Returns [across, deepInside]. */
function l10(w: WholeCtx, a: PieceBuilt, b: PieceBuilt): [number, number] {
  const R0 = w.R0, ma = pieceMesh(a), mb = pieceMesh(b), pa = planeOf(a), pb = planeOf(b);
  let across = 0, deep = 0;
  const check = (m: Mesh, planes: number[], other: Mesh, oplanes: number[]): void => {
    for (let i = 0; i < m.pos.length; i += 3) {
      const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
      let cand = true;
      for (let k = 0; k < planes.length; k += 4) if (planes[k] * x + planes[k + 1] * y + planes[k + 2] * z - planes[k + 3] < -1e-9 * R0) { across++; break; }
      for (let k = 0; k < oplanes.length; k += 4) if (oplanes[k] * x + oplanes[k + 1] * y + oplanes[k + 2] * z - oplanes[k + 3] < -1e-9 * R0) { cand = false; break; }
      if (cand && insideMesh(other, x, y, z)) { const d = Math.sqrt(distToMesh2(other, x, y, z)); if (d > 0.001 * R0) deep++; }
    }
  };
  check(ma, pa, mb, pb); check(mb, pb, ma, pa);
  return [across, deep];
}

/* ───────────────────────────── the geometry rows ───────────────────────────── */
const KNOWN_UNSOUND = new Set(['munchip y+0.5 A', 'selenuff y+0.5 A']);
const unsoundSeen: string[] = [];
const refusals: Record<string, Record<string, number>> = {};   // by species / family
function refuse(sp: string, fam: string, kind: string): void {
  const k = sp + '|' + fam; (refusals[k] ??= {}); refusals[k][kind] = (refusals[k][kind] ?? 0) + 1;
  bump('all', kind);
}
COUNT.all = {};
const attempts: Record<string, number> = {};   // by family

function singleSet(w: WholeCtx, whole: Mesh, c: Cols, wg: Grid, planes: PlaneSpec[], set: string, strideG5: number): void {
  const A = ACC[set];
  for (const ps of planes) {
    const d = ps.off * w.R0, fa = shareAbove(w, ps.n, d);
    attempts[ps.family] = (attempts[ps.family] ?? 0) + 1;
    if (!(fa >= 0.125 && 1 - fa >= 0.125)) { bump(set, 'skipped<1/8'); continue; }
    const job = timed('builds', () => runCut(w.g, { region: undefined, frac: 1, pos: w.pos, tris: w.tris }, 1, ps.n, d));
    bump(set, 'planes');
    if (job.status === 'loose') { const side = job.badSide === 0 ? 'A' : 'B', key = w.id + ' ' + ps.label + ' ' + side; unsoundSeen.push(key + ' [' + set + ']'); refuse(w.id, ps.family, 'loose'); bump(set, 'loose'); continue; }
    if (job.status !== 'ok' || !job.a || !job.b) { refuse(w.id, ps.family, 'thin'); bump(set, 'thin'); NOTES.push(`refused thin ${set} ${w.id} ${ps.label} (${job.why})`); continue; }
    if (job.shiftIdx > 0) bump(set, 'ladder');
    bump(set, 'ok');
    const a = job.a, b = job.b;
    // G1: columns
    const ma = pieceMesh(a), mb = pieceMesh(b), ga = gridOf(ma, c), gb = gridOf(mb, c);
    const pv = timed('G1 columns', () => pairColumns(c, wg, ga, gb, planeOf(a), planeOf(b)));
    const ioA = pv.vAR / (pv.vA + pv.vRA - pv.vAR), ioB = pv.vBR / (pv.vB + pv.vRB - pv.vBR);
    A.push('iou', ioA); A.push('iou', ioB);
    A.push('overlap', pv.vAB / Math.min(pv.vA, pv.vB)); A.push('uncovered', 1 - pv.vCov / pv.vW);
    A.push('volErr', Math.abs(a.rest.restVolume / (a.frac * w.V3) - 1)); A.push('volErr', Math.abs(b.rest.restVolume / (b.frac * w.V3) - 1));
    A.push('fracSum', Math.abs(a.frac + b.frac - 1));
    if (ioA < 0.82 || ioB < 0.82) NOTES.push(`G1 ${set} ${w.id} ${ps.label}: IoU ${f(ioA, 3)} / ${f(ioB, 3)}`);
    timed('G2-G5 per piece', () => { measurePiece(set, w, whole, a, ps.label + ' A', strideG5); measurePiece(set, w, whole, b, ps.label + ' B', strideG5); });
    const [across, deep] = timed('L10', () => l10(w, a, b));
    A.push('across', across); A.push('deep', deep);
    if (across || deep) NOTES.push(`L10 ${set} ${w.id} ${ps.label}: across ${across}, deeper than 0.001 R0 inside the sibling ${deep}`);
  }
}

/* nested trees */
interface Leaf { region: PieceRegion | undefined; frac: number; pos: Float64Array; tris: Uint32Array; built: PieceBuilt | null }
function nestedTrees(w: WholeCtx, whole: Mesh, c: Cols, wg: Grid, trees: number): void {
  const A = ACC.nested, rnd = mulberry32(0xbeef + w.idx * 131), plan = newCutPlanParts();
  for (let tr = 0; tr < trees; tr++) {
    let leaves: Leaf[] = [{ region: undefined, frac: 1, pos: w.pos, tris: w.tris, built: null }];
    let nextId = 1;
    const nCuts = 2 + Math.floor(rnd() * 4);   // 2..5 cuts
    for (let cut = 0; cut < nCuts; cut++) {
      let done = false;
      for (let attempt = 0; attempt < 10 && !done; attempt++) {
        const cands = leaves.filter((l) => l.frac >= 0.26);
        if (cands.length === 0) { bump('nested', 'gen:no leaf >= 0.26'); break; }
        const leaf = cands[Math.floor(rnd() * cands.length)];
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z), n = { x: r * Math.cos(a), y: z, z: r * Math.sin(a) };
        // find d so that the child shares are inside [0.125, frac - 0.125] of the whole
        // the plane offset ranges over the leaf's extent along n (outside it the plane misses the leaf and the plan is not filled)
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < leaf.pos.length; i += 3) { const pr = n.x * leaf.pos[i] + n.y * leaf.pos[i + 1] + n.z * leaf.pos[i + 2]; if (pr < lo) lo = pr; if (pr > hi) hi = pr; }
        lo += 1e-6 * w.R0; hi -= 1e-6 * w.R0;
        const faLo = 0.13 / leaf.frac, faHi = 1 - 0.13 / leaf.frac;
        if (faLo >= faHi) { bump('nested', 'gen:leaf too small'); continue; }
        const target = faLo + (faHi - faLo) * (0.1 + 0.8 * rnd());
        for (let it = 0; it < 40; it++) {
          const mid = 0.5 * (lo + hi);
          planChildren(leaf.pos, leaf.tris, leaf.frac, n, mid, plan);
          if (plan.fa > target) lo = mid; else hi = mid;
        }
        const d = 0.5 * (lo + hi);
        if (!planChildren(leaf.pos, leaf.tris, leaf.frac, n, d, plan) || plan.fracA < 0.125 || plan.fracB < 0.125) { bump('nested', 'gen:plan misses or part < 1/8'); continue; }
        const job = runCut(w.g, { region: leaf.region, frac: leaf.frac, pos: leaf.pos, tris: leaf.tris }, nextId, n, d);
        bump('nested', 'planes');
        if (job.status === 'loose') { refuse(w.id, 'nested', 'loose'); bump('nested', 'loose'); continue; }
        if (job.status !== 'ok' || !job.a || !job.b) { refuse(w.id, 'nested', 'thin'); bump('nested', 'thin'); continue; }
        bump('nested', 'ok'); if (job.shiftIdx > 0) bump('nested', 'ladder');
        const [across, deep] = l10(w, job.a, job.b);
        A.push('across', across); A.push('deep', deep);
        if (across || deep) NOTES.push(`L10 nested ${w.id} tree ${tr} cut ${cut}: across ${across}, deep ${deep}`);
        const mk = (b: PieceBuilt, region: PieceRegion): Leaf => { const m = pieceMesh(b); return { region, frac: b.frac, pos: m.pos, tris: m.tris, built: b }; };
        leaves = leaves.filter((l) => l !== leaf); leaves.push(mk(job.a, job.regionA), mk(job.b, job.regionB));
        nextId++; done = true;
      }
    }
    // the leaves: sum of the fractions, >= 1/8, G1..G5
    let sum = 0;
    for (const l of leaves) { sum += l.frac; A.push('minFrac', l.frac); }
    A.push('fracSum', Math.abs(sum - 1));
    for (const l of leaves) {
      if (!l.built) continue;
      const pg = gridOf({ pos: l.pos, tris: l.tris }, c), pl = planeOf(l.built);
      A.push('iou', leafIoU(c, wg, pg, pl)); A.push('volErr', Math.abs(l.built.rest.restVolume / (l.built.frac * w.V3) - 1));
      measurePiece('nested', w, whole, l.built, `tree${tr} frac ${f(l.frac, 3)} planes ${l.built.capPlanes}`, 6, true);
      A.push('capPlanes', l.built.capPlanes);
    }
  }
}

/* half-eyes (G6) */
function eyes(w: WholeCtx, whole: Mesh): void {
  const A = ACC.sweep, g = w.g as unknown as { eyeSize: number; eyeHeight: number; eyeSpacing: number }, R0 = w.R0;
  const rad = R0 * (0.095 + 0.07 * g.eyeSize), el = ((3 + 26 * g.eyeHeight) * Math.PI) / 180;
  const azMin = Math.asin(Math.max(0, Math.min(0.9, (rad * 1.3) / (R0 * Math.cos(el))))), az = Math.max(((9 + 17 * g.eyeSpacing) * Math.PI) / 180, azMin);
  const P = whole.pos, T = whole.tris, nv = P.length / 3;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < nv; i++) { mx += P[i * 3]; my += P[i * 3 + 1]; mz += P[i * 3 + 2]; }
  mx /= nv; my /= nv; mz /= nv;
  // sample points of the original skin: vertices and triangle centroids
  const sp: number[] = [];
  for (let i = 0; i < P.length; i += 3) sp.push(P[i], P[i + 1], P[i + 2]);
  for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3; sp.push((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3); }
  const normals = [unit(1, 0, 0), unit(0, 1, 0), unit(1, 1, 0), unit(1, 0, 1)];
  for (const side of [-1, 1]) {
    const ux = Math.sin(az * side) * Math.cos(el), uy = Math.sin(el), uz = Math.cos(az * side) * Math.cos(el);
    // the eye centre: the far hit of the ray from the vertex mean (nearest crossing of the original mesh along +t)
    let best = Infinity;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = uy * e2z - uz * e2y, py = uz * e2x - ux * e2z, pz = ux * e2y - uy * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-18 && det < 1e-18) continue;
      const inv = 1 / det, tx = mx - P[a], ty = my - P[a + 1], tz = mz - P[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (ux * qx + uy * qy + uz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 0 && tt < best) best = tt;
    }
    if (!Number.isFinite(best)) continue;
    const E = [mx + ux * best, my + uy * best, mz + uz * best];
    const foot: number[] = [];
    for (let s = 0; s < sp.length; s += 3) if (Math.hypot(sp[s] - E[0], sp[s + 1] - E[1], sp[s + 2] - E[2]) < rad) foot.push(sp[s], sp[s + 1], sp[s + 2]);
    if (foot.length < 9) continue;
    for (const n of normals) for (const fo of [-0.6, 0, 0.6]) {
      const d = n.x * E[0] + n.y * E[1] + n.z * E[2] + fo * rad;
      if (!bothSides(w, n, d)) continue;
      const job = runCut(w.g, { region: undefined, frac: 1, pos: w.pos, tris: w.tris }, 1, n, d);
      if (job.status !== 'ok' || !job.a || !job.b) { bump('sweep', 'eyeRefused'); continue; }
      const ma = pieceMesh(job.a), mb = pieceMesh(job.b);
      for (const sd of [0, 1]) {
        const own = sd === 0 ? ma : mb, other = sd === 0 ? mb : ma, sg = sd === 0 ? 1 : -1;
        let cnt = 0, worst = 0, closeToOther = false;
        for (let s = 0; s < foot.length; s += 3) {
          const sdist = sg * (n.x * foot[s] + n.y * foot[s + 1] + n.z * foot[s + 2] - d);
          if (sdist >= 0) { cnt++; worst = Math.max(worst, Math.sqrt(distToMesh2(own, foot[s], foot[s + 1], foot[s + 2]))); }
          if (sdist >= 0.02 * R0 && Math.sqrt(distToMesh2(other, foot[s], foot[s + 1], foot[s + 2])) < 0.01 * R0) closeToOther = true;
        }
        if (cnt >= 3) { A.push('eyeHalf', worst / R0); A.push('eyeOther', closeToOther ? 1 : 0); }
      }
    }
  }
}

/* ───────────────────────────── run the geometry ───────────────────────────── */
const ico3 = buildIcosphere(3);
if (!SKIP.includes('geom')) {
  const sweep = sweepPlanes();
  SPECIES.forEach((id) => {
    const idx = ALL.indexOf(id), g = speciesTemplateGenome(id as never), S = getSource(g);
    // the ORIGINAL whole: the detail-3 rest mesh in W, in float64 (the game's own definition of the whole and of V3; SoftBody.restLocal is its float32 copy)
    const rest3 = buildRest(g, ico3), pos = rest3.restLocal, tris = ico3.tris, w: WholeCtx = { g, id, R0: S.R0, pos, tris, V3: rest3.restVolume, idx };
    if (Math.abs(S.v3 / rest3.restVolume - 1) > 1e-12) NOTES.push(`V3 mismatch ${id}: ${S.v3} vs ${rest3.restVolume}`);
    const whole: Mesh = { pos, tris }, cols = colsFor(w.R0, S.box), wg = gridOf(whole, cols);
    clearPieceCache();
    const ts = performance.now();
    singleSet(w, whole, cols, wg, sweep, 'sweep', QUICK ? 6 : 5);
    singleSet(w, whole, cols, wg, redTeamPlanes(w), 'rt', 6);
    if (!SKIP.includes('nested')) nestedTrees(w, whole, cols, wg, QUICK ? 1 : 2);
    if (!SKIP.includes('eyes') && !QUICK) eyes(w, whole);
    else if (!SKIP.includes('eyes') && QUICK) eyes(w, whole);
    process.stderr.write(`  ${id.padEnd(10)} ${((performance.now() - ts) / 1000).toFixed(1)} s\n`);
  });

  const both = (k: string): number[] => ACC.sweep.get(k).concat(ACC.rt.get(k));
  const nPieces = both('iou').length;
  info('geometry sets', `species ${SPECIES.length}; sweep planes built ${COUNT.sweep.ok ?? 0} of ${COUNT.sweep.planes ?? 0} (skipped under 1/8: ${COUNT.sweep['skipped<1/8'] ?? 0}); red-team-family planes built ${COUNT.rt.ok ?? 0} of ${COUNT.rt.planes ?? 0}; nested cuts built ${COUNT.nested.ok ?? 0} of ${COUNT.nested.planes ?? 0}; pieces measured (single planes) ${nPieces}`);
  // G1
  const iou = both('iou');
  add('G1 IoU of each piece vs the ORIGINAL whole clipped by the plane (columns R0/32, exact along z): median', f(med(iou), 4), '>= 0.95', med(iou) >= 0.95);
  add('G1 IoU p10', f(pct(iou, 0.1), 4), '>= 0.90', pct(iou, 0.1) >= 0.90);
  add('G1 IoU min', f(mn(iou), 4), '>= 0.82', mn(iou) >= 0.82);
  info('G1 IoU by set', `sweep median ${f(med(ACC.sweep.get('iou')), 4)} p10 ${f(pct(ACC.sweep.get('iou'), 0.1), 4)} min ${f(mn(ACC.sweep.get('iou')), 4)} | red-team median ${f(med(ACC.rt.get('iou')), 4)} p10 ${f(pct(ACC.rt.get('iou'), 0.1), 4)} min ${f(mn(ACC.rt.get('iou')), 4)}`);
  add('G1 overlap of the pair (max, share of the smaller)', f(mx(both('overlap')) * 100, 3) + ' %', '<= 0.5 %', mx(both('overlap')) <= 0.005);
  add('G1 uncovered share of the whole: median / max', `${f(med(both('uncovered')) * 100, 2)} % / ${f(mx(both('uncovered')) * 100, 2)} %`, 'median <= 1.5 %, max <= 6 %', med(both('uncovered')) <= 0.015 && mx(both('uncovered')) <= 0.06);
  add('G1 restVolume / (frac V3) - 1: max; fractions sum - 1: max', `${(mx(both('volErr'))).toExponential(2)}; ${(mx(both('fracSum'))).toExponential(2)}`, '<= 1e-9; <= 1e-9', mx(both('volErr')) <= 1e-9 && mx(both('fracSum')) <= 1e-9);
  // G2
  add('G2 cap planarity (max distance of cap vertices from the plane)', (mx(both('planar'))).toExponential(2) + ' R0', '<= 1e-9 R0', mx(both('planar')) <= 1e-9);
  const cr3 = both('capRatio3'), cr2 = both('capRatio2');
  add('G2 cap area / true section, detail 3: p5', `${f(pct(cr3, 0.05), 3)} (median ${f(med(cr3), 3)}, n ${cr3.length})`, 'p5 >= 0.90', pct(cr3, 0.05) >= 0.90);
  add('G2 cap area / true section, detail 2: p5 / min', `${f(pct(cr2, 0.05), 3)} / ${f(mn(cr2), 3)} (median ${f(med(cr2), 3)}, n ${cr2.length})`, 'p5 >= 0.78 and min >= 0.65', pct(cr2, 0.05) >= 0.78 && mn(cr2) >= 0.65);
  // G3
  const rc3 = both('rimClean3'), rc2 = both('rimClean2');
  const rate = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 1);
  add('G3 rimClean rate, detail 3 (sweep + red-team)', `${f(rate(rc3) * 100, 2)} % of ${rc3.length}`, '>= 99.5 %', rate(rc3) >= 0.995);
  add('G3 rimClean rate, detail 2 (sweep + red-team)', `${f(rate(rc2) * 100, 2)} % of ${rc2.length}`, '>= 98 %', rate(rc2) >= 0.98);
  add('G3 rim vertex to the nearest triangle of the ORIGINAL mesh (clean rims): max', f(mx(both('rimDist')), 4) + ' R0', '<= 0.01 R0', mx(both('rimDist')) <= 0.01);
  add('G3 (the builder own property) rim vertex to the SOURCE solid S skin (detail-4 mesh), clean rims: max', mx(both('rimDistS')).toExponential(2) + ' R0', '<= 1e-6 R0 (S is what the snap lands on; the ORIGINAL is the coarser detail-3 polyhedron)', mx(both('rimDistS')) <= 1e-6);
  info('G3 every rim vertex to S: p50 / p95 / p99 / share within 1e-6 R0', `${both('rimVertS').length ? (pct(both('rimVertS'), 0.5)).toExponential(1) : '-'} / ${pct(both('rimVertS'), 0.95).toExponential(1)} / ${pct(both('rimVertS'), 0.99).toExponential(1)} / ${f(both('rimVertS').filter((v) => v <= 1e-6).length / Math.max(1, both('rimVertS').length) * 100, 2)} % of ${both('rimVertS').length} rim vertices`);
  info('G3 rim vertex to the ORIGINAL detail-3 mesh (clean rims): p50 / p95 / share within 0.01 R0', `${f(med(both('rimDist')), 4)} / ${f(pct(both('rimDist'), 0.95), 4)} / ${f(both('rimDist').filter((v) => v <= 0.01).length / Math.max(1, both('rimDist').length) * 100, 1)} % of ${both('rimDist').length}`);
  info('G3 reverted rims by species', (() => { const m: Record<string, number> = {}; for (const nn of NOTES) { const r = /^G3 (\w+) (\w+) .*reverted/.exec(nn); if (r) m[r[2]] = (m[r[2]] ?? 0) + 1; } return JSON.stringify(m); })());
  // G4
  add('G4 inverted tetrahedra (ray origin = the star centre, tri): total', String(both('flipsRay').reduce((s, v) => s + v, 0)), '0', both('flipsRay').every((v) => v === 0));
  add('G4 inverted tetrahedra (mass centroid, tri): total', `${both('flips').reduce((s, v) => s + v, 0)} triangles in ${both('flips').filter((v) => v > 0).length} of ${both('flips').length} pieces`, '0', both('flips').every((v) => v === 0));
  add('G4 triangles under 1e-4 of the mean area: total', String(both('small').reduce((s, v) => s + v, 0)), '0', both('small').every((v) => v === 0));
  add('G4 wrong-facing share of triangles (vertex-mean apex): max per piece', f(mx(both('wrong')) * 100, 3) + ' %', '<= 0.5 %', mx(both('wrong')) <= 0.005);
  add('G4 smallest triangle angle per region: p1 / median', `${f(pct(both('minAng'), 0.01), 1)} / ${f(med(both('minAng')), 1)} deg`, 'p1 >= 3, median >= 15', pct(both('minAng'), 0.01) >= 3 && med(both('minAng')) >= 15);
  add('G4 tributary masses of built pieces (min / max, mean 1)', `${f(mn(both('massLo')), 3)} / ${f(mx(both('massHi')), 2)}`, 'within [0.01, 8]', mn(both('massLo')) >= 0.01 && mx(both('massHi')) <= 8);
  const cs3 = both('capSmall3').concat(both('capSmall2'));
  add('G4 regions with a CAP triangle under 15 deg', `${f(rate(cs3) * 100, 2)} % of ${cs3.length} (detail 3: ${f(rate(both('capSmall3')) * 100, 1)} %, detail 2: ${f(rate(both('capSmall2')) * 100, 1)} %)`, '<= 6 % (target 0 after the rim re-spacing, tuning item T1 = task P8)', rate(cs3) <= 0.06);
  // G5
  const h3 = both('haus3'), h2 = both('haus2');
  add('G5 skin coverage, detail 3: p95 / worst of max-over-samples', `${f(pct(h3, 0.95), 3)} / ${f(mx(h3), 3)} R0 (n ${h3.length})`, 'p95 <= 0.08, worst <= 0.35', pct(h3, 0.95) <= 0.08 && mx(h3) <= 0.35);
  add('G5 skin coverage, detail 2: p95', `${f(pct(h2, 0.95), 3)} R0 (worst ${f(mx(h2), 3)}, n ${h2.length})`, 'p95 <= 0.14', pct(h2, 0.95) <= 0.14);
  // G6
  const eh = ACC.sweep.get('eyeHalf'), eo = ACC.sweep.get('eyeOther');
  if (eh.length) {
    const within = eh.filter((v) => v <= 0.065).length / eh.length;
    add('G6 half-eye footprints within 0.065 R0 of their side\'s piece', `${f(within * 100, 2)} % of ${eh.length} (worst ${f(mx(eh), 3)} R0)`, '>= 97 %', within >= 0.97);
    add('G6 footprint points >= 0.02 R0 into a side that lie within 0.01 R0 of the other piece', `${eo.filter((v) => v > 0).length} of ${eo.length} half-eyes`, '0', eo.every((v) => v === 0));
  }
  // G7
  const N = ACC.nested;
  if (N.get('iou').length) {
    add('G7 nested (up to 5 cuts): fractions sum to 1, max error', (mx(N.get('fracSum'))).toExponential(2), '<= 1e-9', mx(N.get('fracSum')) <= 1e-9);
    add('G7 nested: smallest leaf share', f(mn(N.get('minFrac')), 4), '>= 0.124', mn(N.get('minFrac')) >= 0.124);
    add('G7 nested IoU vs the whole clipped by the cell: median / p10 / min', `${f(med(N.get('iou')), 4)} / ${f(pct(N.get('iou'), 0.1), 4)} / ${f(mn(N.get('iou')), 4)} (n ${N.get('iou').length}, planes 1..5: ${N.get('capPlanes').filter((v) => v > 1).length} multi-plane)`, 'median >= 0.95, p10 >= 0.90, min >= 0.82', med(N.get('iou')) >= 0.95 && pct(N.get('iou'), 0.1) >= 0.90 && mn(N.get('iou')) >= 0.82);
    add('G7 nested volumes: max |restVolume / (frac V3) - 1|', (mx(N.get('volErr'))).toExponential(2), '<= 1e-9', mx(N.get('volErr')) <= 1e-9);
    add('G7 nested skin coverage: p95 / worst', `${f(pct(N.get('hausN'), 0.95), 3)} / ${f(mx(N.get('hausN')), 3)} R0`, 'p95 <= 0.20, worst <= 0.40', pct(N.get('hausN'), 0.95) <= 0.2 && mx(N.get('hausN')) <= 0.4);
    add('G7 nested: inverted tetrahedra / tiny triangles', `${N.get('flips').reduce((s, v) => s + v, 0)} / ${N.get('small').reduce((s, v) => s + v, 0)}`, '0 / 0', N.get('flips').every((v) => v === 0) && N.get('small').every((v) => v === 0));
    const rcN = N.get('rimClean3').concat(N.get('rimClean2'));
    info('G7 nested rim snap clean', `${f(rate(rcN) * 100, 1)} % of ${rcN.length}; smallest angle median ${f(med(N.get('minAng')), 1)} deg`);
  }
  // L10
  const ac = both('across').concat(N.get('across')), de = both('deep').concat(N.get('deep'));
  add('L10 vertices across their own plane beyond 1e-9 R0 (sweep + red-team + nested pairs)', `${ac.reduce((s, v) => s + v, 0)} in ${ac.length} pairs`, '0', ac.every((v) => v === 0));
  add('L10 particles inside the sibling deeper than 0.001 R0', `${de.reduce((s, v) => s + v, 0)} in ${de.length} pairs`, '0', de.every((v) => v === 0));
  // C2 and refusals
  const swUns = unsoundSeen.filter((u) => u.endsWith('[sweep]')).map((u) => u.replace(' [sweep]', ''));
  const missing = [...KNOWN_UNSOUND].filter((k) => SPECIES.includes(k.split(' ')[0]) && !swUns.includes(k));
  const extra = swUns.filter((k) => !KNOWN_UNSOUND.has(k));
  add('C2 unsound (loose) single planes of the sweep: the known ones are refused (munchip, selenuff: level +0.5 R0, side A)', `refused: ${swUns.join(', ') || 'none'}`, 'both known refused', missing.length === 0);
  add('C2 no OTHER sweep plane is refused as unsound (the spec saw one more: ambrosel on an oblique +0.5 plane, whose normal is not recorded here)', extra.length ? `extra: ${extra.join(', ')}` : 'none', 'none besides the oblique-plane ambrosel case', extra.every((k) => k.startsWith('ambrosel ')));
  const rtUns = unsoundSeen.filter((u) => u.endsWith('[rt]'));
  info('C2 unsound planes in the red-team families', rtUns.join(', ') || 'none');
  const totals = (set: string): string => `built ${COUNT[set].ok ?? 0}, refused loose ${COUNT[set].loose ?? 0}, refused thin ${COUNT[set].thin ?? 0}, repaired by the ladder ${COUNT[set].ladder ?? 0} of ${COUNT[set].planes ?? 0}`;
  info('C2 refusals (single planes of the sweep)', totals('sweep'));
  info('C2 refusals (red-team families)', totals('rt'));
  info('C2 refusals (nested cuts)', totals('nested') + '; generator: ' + JSON.stringify(Object.fromEntries(Object.entries(COUNT.nested).filter(([k]) => k.startsWith('gen:')))));
  const nAll = (COUNT.sweep.planes ?? 0) + (COUNT.rt.planes ?? 0), nRef = (COUNT.sweep.thin ?? 0) + (COUNT.rt.thin ?? 0) + (COUNT.sweep.loose ?? 0) + (COUNT.rt.loose ?? 0);
  const nNest = COUNT.nested.planes ?? 0, nRefN = (COUNT.nested.thin ?? 0) + (COUNT.nested.loose ?? 0);
  add('C2 combined refusal rate, single planes (the spec saw 0.8 % of 905)', `${f((100 * nRef) / Math.max(1, nAll), 2)} % (${nRef} of ${nAll})`, 'reported, not a bar', true);
  add('C2 refusal rate of nested cuts (a rate above 3 % goes to the orchestrator)', `${f((100 * nRefN) / Math.max(1, nNest), 2)} % (${nRefN} of ${nNest})`, '<= 3 %', nRefN / Math.max(1, nNest) <= 0.03);
  const fam: Record<string, string> = {};
  for (const k of Object.keys(refusals)) { const [sp, fm] = k.split('|'); fam[fm] = (fam[fm] ?? '') + ` ${sp}:${JSON.stringify(refusals[k])}`; }
  info('C2 refusals by family and species', Object.entries(fam).map(([k, v]) => `${k}:${v}`).join(' ; ') || 'none');
  info('probe time by instrument (s)', Object.entries(TIMES).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', '));
  // build cost
  info('build cost, WALL clock during the sweep (the machine is shared and busy; the rows below use best-of-3 time): detail-3 piece median / p95 ms', `${f(med(pieceMs3), 1)} / ${f(pct(pieceMs3, 0.95), 1)} (n ${pieceMs3.length})`);
  info('build cost detail 2: median / p95 ms', `${f(med(pieceMs2), 1)} / ${f(pct(pieceMs2, 0.95), 1)} (n ${pieceMs2.length})`);
  info('build stage cost, WALL clock during the sweep: p99 / max ms', `${f(pct(stageMs, 0.99), 2)} / ${f(mx(stageMs), 1)} (n ${stageMs.length} stages)`);
}

/* ───────────────────────────── build cost: best-of-3 CPU time (4.5: median <= 12 ms and p95 <= 40 ms per detail-3 piece, one stage <= 3 ms) ───────────────────────────── */
if (!SKIP.includes('cost')) {
  const cpu = (): number => performance.now();   // (process.cpuUsage ticks at 15.6 ms on Windows: useless per stage; the minimum of 3 repeats removes most of the contention noise)
  const per3: number[] = [], per2: number[] = [], stageBest: number[] = [], stageKindMax: Record<number, number> = {};
  // which stage kinds are the slow ones: single pieces (side A) through PieceJob, best of 3 per stage position, max per stage kind
  for (const id of QUICK ? SPECIES.slice(0, 4) : SPECIES.filter((_, i) => i % 4 === 0)) {
    const g = speciesTemplateGenome(id as never), r3 = buildRest(g, ico3), R0 = r3.restRadius;
    for (const [nx, off] of [[1, 0], [0, 0.1], [0.7, 0]] as Array<[number, number]>) {
      const n = unit(nx, 1 - nx * 0.4, 0.3 * nx), plan = newCutPlanParts();
      if (!planChildren(r3.restLocal, ico3.tris, 1, n, off * R0, plan)) continue;
      let bestK: number[] | null = null, kinds: number[] = [];
      for (let rep = 0; rep < 3; rep++) {
        clearPieceCache();
        const job = new PieceJob(g, { planes: [{ id: 1, n, d: off * R0 }], cells: [[1]] }, pieceDetail(plan.fracA), plan.fracA, plan.cA);
        const st: number[] = [], kd: number[] = [];
        while (job.status === 'run') { const k = job.st, c0 = performance.now(); job.run(Infinity, 1); st.push(performance.now() - c0); kd.push(k); }
        if (!bestK || bestK.length !== st.length) { bestK = st; kinds = kd; } else for (let i = 0; i < st.length; i++) bestK[i] = Math.min(bestK[i], st[i]);
      }
      if (bestK) bestK.forEach((v, i) => { stageKindMax[kinds[i]] = Math.max(stageKindMax[kinds[i]] ?? 0, v); });
    }
  }
  let l4Same = 0, l4Total = 0;
  const planesC: Array<[V3, number]> = [[unit(1, 0, 0), 0], [unit(0, 1, 0), 0.2], [unit(0.667, 0.718, -0.199), 0], [unit(1, 0, 0), 0.5], [unit(0, 0, 1), -0.2]];
  const specC = QUICK ? SPECIES : SPECIES.filter((_, i) => i % 2 === 0);
  for (const id of specC) {
    const g = speciesTemplateGenome(id as never), S = getSource(g), r3 = buildRest(g, ico3);
    for (const [n, off] of planesC) {
      let best: number[] | null = null, bestTot = Infinity, d3 = 0, d2 = 0, first: Float64Array | null = null, firstStages = -1;
      for (let rep = 0; rep < 3; rep++) {
        clearPieceCache();
        const job = new CutJob(g, { region: undefined, frac: 1, pos: r3.restLocal, tris: ico3.tris }, { id: 1, n, d: off * S.R0 });
        const st: number[] = [];
        let guard = 0;
        while (job.status === 'run' && guard++ < 5000) { const c0 = cpu(); job.run(Infinity, 1); st.push(cpu() - c0); }
        if (job.status !== 'ok' || !job.a || !job.b) { best = null; break; }
        const tot = st.reduce((a, b) => a + b, 0);
        // L4 determinism: the same cut built from a cold cache again gives bit-identical particles in the same number of stages
        const flat = new Float64Array(job.a.rest.restLocal.length + job.b.rest.restLocal.length);
        flat.set(job.a.rest.restLocal); flat.set(job.b.rest.restLocal, job.a.rest.restLocal.length);
        if (!first) { first = flat; firstStages = st.length; } else { l4Total++; if (st.length === firstStages && flat.every((v, i) => v === first![i])) l4Same++; }
        if (!best || st.length !== best.length) { best = st; bestTot = tot; } else { for (let i = 0; i < st.length; i++) best[i] = Math.min(best[i], st[i]); bestTot = Math.min(bestTot, tot); }
        d3 = (job.a.detail === 3 ? 1 : 0) + (job.b.detail === 3 ? 1 : 0); d2 = 2 - d3;
      }
      if (!best) continue;
      const tot = best.reduce((a, b) => a + b, 0);
      for (const x of best) stageBest.push(x);
      // a pair: split by particle count
      const p3 = (tot * 642) / (642 * d3 + 162 * d2), p2 = (tot * 162) / (642 * d3 + 162 * d2);
      for (let i = 0; i < d3; i++) per3.push(p3);
      for (let i = 0; i < d2; i++) per2.push(p2);
    }
  }
  add('L4 determinism: the same cut rebuilt from a cold cache (2 repeats per cut): identical particles (bit for bit) and stage count', `${l4Same}/${l4Total} rebuilds`, 'all', l4Same === l4Total && l4Total > 0);
  add('build cost (best-of-3 ms per piece, JIT-warm after the sweep): detail-3 piece median / p95', `${f(med(per3), 1)} / ${f(pct(per3, 0.95), 1)} (n ${per3.length})`, 'median <= 12, p95 <= 40', med(per3) <= 12 && pct(per3, 0.95) <= 40);
  info('build cost detail 2 (best-of-3 ms): median / p95', `${f(med(per2), 1)} / ${f(pct(per2, 0.95), 1)} (n ${per2.length})`);
  info('build stage cost by stage kind (single pieces, best of 3, max ms): 0 centre+phi, 2 search, 3 seed, 4-7 relax, 8 snap, 9 cap, 10-13 skin, 14 gate, 15 foot, 16 volume, 17 checks, 18 weights', JSON.stringify(Object.fromEntries(Object.entries(stageKindMax).map(([k, v]) => [k, +v.toFixed(2)]))));
  add('build stage cost (best-of-3 ms): p99 / max', `${f(pct(stageBest, 0.99), 2)} / ${f(mx(stageBest), 2)} (n ${stageBest.length} stages)`, 'one stage <= 3 ms', mx(stageBest) <= 3);
}

/* ───────────────────────────── allocation of a build stage (zero per-step allocation, CUT2 rule 13) ───────────────────────────── */
if (!SKIP.includes('alloc')) {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const empty: number[] = [];
  for (let i = 0; i < 8; i++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1], perStage: number[] = [], byStage: Record<number, number> = {};
  const specA = QUICK ? SPECIES.slice(0, 3) : SPECIES.filter((_, i) => i % 5 === 0);
  for (const id of specA) {
    const g = speciesTemplateGenome(id as never), r3 = buildRest(g, ico3), R0 = r3.restRadius;
    for (const [nx, off] of [[1, 0], [0, 0.2], [0.7, 0.1]] as Array<[number, number]>) {
      const n = unit(nx, 1 - nx * 0.5, 0.3 * nx), plan = newCutPlanParts();
      if (!planChildren(r3.restLocal, ico3.tris, 1, n, off * R0, plan)) continue;
      for (let rep = 0; rep < 8; rep++) {
        clearPieceCache();
        const job = new PieceJob(g, { planes: [{ id: 1, n, d: off * R0 }], cells: [[1]] }, pieceDetail(plan.fracA), plan.fracA, plan.cA);
        while (job.status === 'run') {
          const st = job.st, u0 = newUsed();
          job.run(Infinity, 1);
          const d = newUsed() - u0 - base;
          if (rep >= 4 && st < 17 && d >= 0) { perStage.push(d); byStage[st] = Math.max(byStage[st] ?? 0, d); }
        }
      }
    }
  }
  info('allocation per build stage (new-space growth minus the measurement itself; stages 17 and 18 = the output arrays, excluded; the first 4 of 8 repeats of each cut = JIT warm-up, excluded): median / p95 / max bytes', `${f(med(perStage), 0)} / ${f(pct(perStage, 0.95), 0)} / ${f(mx(perStage), 0)} over ${perStage.length} stages; max by stage: ${JSON.stringify(byStage)}`);
  add('allocation: a build stage (not the output) allocates nothing in the median', `${f(med(perStage), 0)} B`, '0 B', med(perStage) <= 0);
}

/* ───────────────────────────── L5: every goal term centred ───────────────────────────── */
type Priv = { GB: Float64Array; M: Float64Array; Mtot: number; n: number; debug: { goalDrift: number }; restRadius: number; center: V3 };
const meanGB = (b: SoftBody): number => {
  const p = b as unknown as Priv; let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.n; i++) { x += p.M[i] * p.GB[i * 3]; y += p.M[i] * p.GB[i * 3 + 1]; z += p.M[i] * p.GB[i * 3 + 2]; }
  return Math.sqrt(x * x + y * y + z * z) / p.Mtot / p.restRadius;
};
const DT = 1 / 60;
if (!SKIP.includes('l5')) {
  const terms: Record<string, number[]> = { fold: [], burst: [], setFrac: [], neckX: [], neckY: [], neckT: [] }, before: Record<string, number[]> = { neckX: [], neckY: [], neckT: [] };
  for (const id of SPECIES) {
    const g = speciesTemplateGenome(id as never);
    const mk = (): SoftBody => { const b = new SoftBody(g); for (let i = 0; i < 40; i++) b.step(DT); return b; };
    let b = mk(); b.setFold!(1); for (let i = 0; i < 60; i++) b.step(DT); terms.fold.push(meanGB(b));
    b = mk(); b.burstOpen!(1); b.step(DT); terms.burst.push(meanGB(b));
    b = mk(); b.setFrac!(0.8, 0.2); for (let i = 0; i < 6; i++) b.step(DT); terms.setFrac.push(meanGB(b));
    const planes: Array<[string, V3]> = [['neckX', unit(1, 0, 0)], ['neckY', unit(0, 1, 0)], ['neckT', unit(0.667, 0.718, -0.199)]];
    for (const [k, n] of planes) {
      b = mk();
      const c = b.center;
      for (let i = 0; i < 24; i++) { b.setNeck!({ point: { x: c.x, y: c.y, z: c.z }, normal: n }, Math.min(1, (i + 1) / 12)); b.step(DT); }
      terms[k].push(meanGB(b)); before[k].push((b as unknown as Priv).debug.goalDrift / b.restRadius);
    }
  }
  for (const k of ['neckX', 'neckY', 'neckT']) {
    add(`L5 neck goal centred (${k}, t = 1): mass-weighted mean of GB after centreGB, max over ${SPECIES.length} species`, `${mx(terms[k]).toExponential(2)} R0`, '<= 1e-9 R0', mx(terms[k]) <= 1e-9);
    info(`L5 ${k} BEFORE centring (the old build's drift): median / max`, `${f(med(before[k]), 4)} / ${f(mx(before[k]), 4)} R0 (the spec saw up to 0.18)`);
  }
  add('L5 burst goal (uniform scale about the origin): max mean', `${mx(terms.burst).toExponential(2)} R0`, '<= 1e-9 R0', mx(terms.burst) <= 1e-9);
  add('L5 setFrac goal (uniform scale): max mean', `${mx(terms.setFrac).toExponential(2)} R0`, '<= 1e-9 R0', mx(terms.setFrac) <= 1e-9);
  info('L5 fold sphere (setFold 1, left alone by design so whole bodies stay bit-identical): median / max', `${f(med(terms.fold), 4)} / ${f(mx(terms.fold), 4)} R0 (the spec saw max 0.0112)`);
  info('L5 morph goal', 'not built yet (task P6 adds `|| morphOn` to centreGB)');
}

/* ───────────────────────────── L6: whole bodies unchanged ───────────────────────────── */
if (!SKIP.includes('l6')) {
  const session = (id: string, centre: boolean): number[] => {
    SoftBody.centreGoal = centre;
    try {
      const g = speciesTemplateGenome(id as never), b = new SoftBody(g), h: number[] = [], run = (k: number, each?: (i: number) => void): void => { for (let i = 0; i < k; i++) { each?.(i); b.step(DT); } };
      const R = b.restRadius, ev: never[] = [];
      run(60); h.push(b.stateHash());                                                                    // 0 settle
      const hit = b.raycast({ x: b.center.x + 0.1 * R, y: 4, z: b.center.z }, { x: 0, y: -1, z: 0 })!;
      b.fingerDown(0, { point: hit.point, normal: hit.normal, dir: { x: 0, y: -1, z: 0 } }); b.fingerPressure(0, 0.8);
      run(30); h.push(b.stateHash());                                                                    // 1 press
      run(40, (i) => b.fingerMove(0, { x: hit.point.x + 0.02 * Math.sin(i * 0.3), y: hit.point.y, z: hit.point.z })); h.push(b.stateHash());   // 2 rub
      b.fingerUp(0); run(30); h.push(b.stateHash());                                                     // 3 release
      const gh = b.raycast({ x: b.center.x + 3 * R, y: b.center.y + 0.3 * R, z: 0 }, { x: -1, y: 0, z: 0 })!;
      b.grab(0, gh.vertex, gh.point); run(30, (i) => b.grabMove(0, { x: gh.point.x + i * 0.01, y: gh.point.y + i * 0.006, z: gh.point.z })); b.grabRelease(0); run(30); h.push(b.stateHash());   // 4 pull + release
      b.nudge({ x: 0.5, y: 0, z: 0.2 }); run(30); h.push(b.stateHash());                                // 5 nudge
      b.setFold!(1); run(40); b.setFold!(0); run(40); h.push(b.stateHash());                             // 6 fold ceremony
      b.burstOpen!(0.8); run(40); h.push(b.stateHash());                                                 // 7 burst
      b.setFrac!(0.7, 0.3); run(30); b.setFrac!(1, 0.3); run(30); h.push(b.stateHash());                 // 8 setFrac
      const c = b.center; for (let i = 0; i < 40; i++) { b.setNeck!({ point: { x: c.x, y: c.y, z: c.z }, normal: { x: 0, y: 0, z: 1 } }, Math.min(1, (i + 1) / 20)); b.step(DT); } h.push(b.stateHash());   // 9 neck (the first setNeck)
      void ev;
      return h;
    } finally { SoftBody.centreGoal = true; }
  };
  let same = 0, firstDiffNeck = 0, bad: string[] = [];
  for (const id of SPECIES) {
    const old = session(id, false), neu = session(id, true);
    let ok = true;
    for (let k = 0; k < 9; k++) if (old[k] !== neu[k]) { ok = false; bad.push(`${id}@${k}`); break; }
    if (ok) same++;
    if (old[9] !== neu[9]) firstDiffNeck++;
  }
  add(`L6 whole bodies unchanged: identical stateHash at the 9 checkpoints before the first setNeck (press, rub, release, pull, nudge, fold, burst, setFrac), shipped goal vs centred`, `${same}/${SPECIES.length} species${bad.length ? ' (differ: ' + bad.slice(0, 6).join(' ') + ')' : ''}`, `${SPECIES.length}/${SPECIES.length}`, same === SPECIES.length);
  info('L6 the first setNeck differs from the shipped goal (by design: the neck goal is the re-centred term)', `${firstDiffNeck}/${SPECIES.length} species`);
}

/* ───────────────────────────── P2 / P3: the solver side of the true cut ───────────────────────────── */
// These rows run the SOLVER on pieces: planCut + prepareCut on a whole body (the real API), the children built by the constructor from the cache prepareCut filled,
// then stepped. Sections (names for --skip / --only): l6b (whole bodies unchanged vs the committed solver), hinge (per-hinge fold limits), c1 (planCut predicts what
// is built, median, latched, cost), c2b (refusals through the body), info (PieceInfo, frac truth, FRAC_MIN, placeAt, initRest), launch, l2 (rest poses), l3 (touching a rim).
interface BodyPriv {
  n: number; nh: number; X: Float64Array; Q: Float64Array; H3: Int32Array; HE3: Int32Array; HC: Float64Array; HCH: Float64Array; HSH: Float64Array;
  restVolume: number; restCenterY: number; restRadius: number; debug: { safetyResets: number; maxSpeed: number }; homeX: number; homeZ: number; M: Float64Array; Mtot: number; V: Float64Array;
  fracBuilt: number; offX: number; offY: number; offZ: number; latchOn: boolean; tris: Uint32Array;
}
const BP = (b: unknown): BodyPriv => b as BodyPriv;
const FAM12 = ['dollop', 'twangle', 'puddlo', 'crumbit', 'chunkle', 'wisplet', 'crimpo', 'boingle', 'dimpla', 'wrigglo', 'capnap', 'kneadle'];   // the first species of each of the 12 families
const KNOWN_UNSOUND_PLANES = new Set(['munchip y+0.5', 'selenuff y+0.5']);   // the plane label of the sweep (both children are checked: the upper one is unsound)
const famList = (): string[] => { const s = FAM12.filter((x) => SPECIES.includes(x)); return s.length ? s : SPECIES.slice(0, 3); };
const mkPlan = (): CutPlan => ({ rest: { n: { x: 0, y: 0, z: 0 }, d: 0 }, fa: 0, offA: { x: 0, y: 0, z: 0 }, offB: { x: 0, y: 0, z: 0 }, velA: { x: 0, y: 0, z: 0 }, velB: { x: 0, y: 0, z: 0 }, aspectA: 0, aspectB: 0, sound: false, soundPending: false, built: false });
const bodyDt = 1 / 60;
/** The world plane that is the W plane n . p = off R0 on a body that stands at rest (frame identity): through center + n off R0. */
const worldPlane = (b: SoftBody, n: V3, off: number): CutPlane => ({ point: { x: b.center.x + n.x * off * b.restRadius, y: b.center.y + n.y * off * b.restRadius, z: b.center.z + n.z * off * b.restRadius }, normal: { x: n.x, y: n.y, z: n.z } });
/** The regions the shell would hand the children of a cut of a body whose own region is `base` (undefined = the whole), the new plane having id `id`. */
function childRegions(base: PieceRegion | undefined, id: number, plan: CutPlan): [PieceRegion, PieceRegion] {
  const planes = (base ? base.planes.slice() : []).concat([{ id, n: { x: plan.rest.n.x, y: plan.rest.n.y, z: plan.rest.n.z }, d: plan.rest.d }]);
  const lits = base && base.cells[0] ? base.cells[0] : [];
  return [{ planes, cells: [[...lits, id]] }, { planes, cells: [[...lits, -id]] }];
}
interface BodyCut { ok: boolean; plan: CutPlan; r: boolean | 'thin' | 'loose'; calls: number; ms: number }
/** Plan + build (budgetMs = Infinity, 2 stages per call: the node-test mode) a cut of `body`. */
function cutBody(body: SoftBody, plane: CutPlane, mode: 'at' | 'median' = 'at'): BodyCut {
  const plan = mkPlan(), t0 = performance.now(), ok = body.planCut!(plane, plan, mode);
  if (!ok) return { ok, plan, r: false, calls: 0, ms: performance.now() - t0 };
  let r: boolean | 'thin' | 'loose' = false, calls = 0;
  while (r === false && calls < 400) { r = body.prepareCut!(Infinity, 2); calls++; }
  return { ok, plan, r, calls, ms: performance.now() - t0 };
}
const mkChildren = (g: ReturnType<typeof speciesTemplateGenome>, parent: SoftBody, base: PieceRegion | undefined, id: number, plan: CutPlan, extra?: (side: 0 | 1) => object): [SoftBody, SoftBody, PieceRegion, PieceRegion] => {
  const [ra, rb] = childRegions(base, id, plan), pf = parent.frac!;
  const fa = pf * plan.fa, fb = pf - fa;
  return [new SoftBody(g, { piece: { frac: fa, region: ra, ...(extra ? extra(0) : {}) } } as never), new SoftBody(g, { piece: { frac: fb, region: rb, ...(extra ? extra(1) : {}) } } as never), ra, rb];
};
/** Normal dihedral (degrees) of the hinge with edge ends a3, b3 and opposite vertices c3, d3 (offsets into P, already x3): 0 = flat. */
function dihedralDeg(P: ArrayLike<number>, a3: number, b3: number, c3: number, d3: number): number {
  let ex = P[b3] - P[a3], ey = P[b3 + 1] - P[a3 + 1], ez = P[b3 + 2] - P[a3 + 2];
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  let cx = P[c3] - P[a3], cy = P[c3 + 1] - P[a3 + 1], cz = P[c3 + 2] - P[a3 + 2];
  const tc = cx * ex + cy * ey + cz * ez; cx -= tc * ex; cy -= tc * ey; cz -= tc * ez;
  let dx = P[d3] - P[a3], dy = P[d3 + 1] - P[a3 + 1], dz = P[d3 + 2] - P[a3 + 2];
  const td = dx * ex + dy * ey + dz * ez; dx -= td * ex; dy -= td * ey; dz -= td * ez;
  const lc = Math.hypot(cx, cy, cz), ld = Math.hypot(dx, dy, dz);
  if (lc < 1e-12 || ld < 1e-12) return 0;
  return 180 - (Math.acos(Math.max(-1, Math.min(1, (cx * dx + cy * dy + cz * dz) / (lc * ld)))) * 180) / Math.PI;
}
const centreOf = (b: SoftBody): V3 => ({ x: b.center.x, y: b.center.y, z: b.center.z });
const dist3 = (a: V3, b: V3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
/** Run `secs` of simulation and track the centre by POSITIONS (finite difference over 0.1 s: X13 never reads the solver's vc). */
interface RunStat { peak: number; peakUp: number; rise: number; last: number; jitterMm: number; lowestMm: number; onTable: number; resets: number }
function runStat(bs: SoftBody[], k: number, secs: number, each?: (i: number) => void): RunStat[] {
  const N = Math.round(secs / bodyDt), H10 = 6, H50 = 30;
  const hist = bs.map(() => [] as V3[]), st: RunStat[] = bs.map(() => ({ peak: 0, peakUp: 0, rise: 0, last: 0, jitterMm: 0, lowestMm: 0, onTable: 0, resets: 0 }));
  const y0 = bs.map((b) => b.center.y);
  for (let i = 0; i < N; i++) {
    each?.(i);
    if (k > 1) for (const b of bs) b.collide!(bs);
    for (let j = 0; j < bs.length; j++) {
      const b = bs[j]; b.step(bodyDt);
      const h = hist[j]; h.push(centreOf(b));
      if (h.length > H10) { const dt = H10 * bodyDt, a = h[h.length - 1 - H10], c = h[h.length - 1], v = dist3(a, c) / dt; if (v > st[j].peak) st[j].peak = v; const up = (c.y - a.y) / dt; if (up > st[j].peakUp) st[j].peakUp = up; }
      if (b.center.y - y0[j] > st[j].rise) st[j].rise = b.center.y - y0[j];
    }
  }
  for (let j = 0; j < bs.length; j++) {
    const b = bs[j], h = hist[j], n = h.length;
    st[j].last = n > H50 ? dist3(h[n - 1 - H50], h[n - 1]) / (H50 * bodyDt) : NaN;
    let lo = Infinity, hi = -Infinity;
    for (let i = Math.max(0, n - H50); i < n; i++) { lo = Math.min(lo, h[i].y); hi = Math.max(hi, h[i].y); }
    st[j].jitterMm = (hi - lo) * 1000;
    let low = Infinity, near = 0;
    for (let i = 1; i < b.positions.length; i += 3) { low = Math.min(low, b.positions[i]); if (b.positions[i] < 0.01) near++; }
    st[j].lowestMm = low * 1000; st[j].onTable = near; st[j].resets = BP(b).debug.safetyResets;
  }
  return st;
}

/* ── L6b: whole bodies are bit-identical to the committed solver (P0, before P2): 10 + 14 stateHash checkpoints x 50 species ── */
if (!SKIP.includes('l6b')) {
  const gold = JSON.parse(readFileSync(new URL('./physview/l6_golden.json', import.meta.url), 'utf8')).data as Record<string, { whole: number[]; pair: number[]; with: string }>;
  let okW = 0, okP = 0, nP = 0, nW = 0; const bad: string[] = [];
  for (const id of SPECIES) {
    const g = gold[id]; if (!g) continue;
    const w = wholeSession(SoftBody as never, id), p = pairSession(SoftBody as never, id, g.with);
    nW++; nP++;
    if (w.every((v, i) => v === g.whole[i])) okW++; else bad.push(id + ':whole@' + w.findIndex((v, i) => v !== g.whole[i]));
    if (p.every((v, i) => v === g.pair[i])) okP++; else bad.push(id + ':pair@' + p.findIndex((v, i) => v !== g.pair[i]));
  }
  add('L6b whole bodies unchanged vs the committed solver (P0, before P2): stateHash at the 10 checkpoints of the session (press, rub, release, pull, nudge, fold, burst, setFrac, first setNeck)', `${okW}/${nW} species${bad.length ? ' (differ: ' + bad.slice(0, 6).join(' ') + ')' : ''}`, `${nW}/${nW}`, okW === nW);
  add('L6b two whole bodies, the second dropped on the first, collide every frame, 7 s (X21): stateHash of both at 7 checkpoints', `${okP}/${nP} pairs`, `${nP}/${nP}`, okP === nP);
}

/* ── hinge limits (5.3): a whole body keeps the 110 degrees of today on every hinge; the rim of a cut face gets its own ── */
if (!SKIP.includes('hinge')) {
  const legacyHalf = (Math.PI - (FINGER.foldMaxDeg * Math.PI) / 180) / 2, legacy = [Math.cos(legacyHalf), Math.sin(legacyHalf), Math.cos(2 * legacyHalf)];
  let wholeBodies = 0, wholeHinges = 0, wholeDiff = 0, wholeMaxDih = 0;
  for (const id of SPECIES) for (const det of [2, 3, 4]) {
    const b = BP(new SoftBody(speciesTemplateGenome(id as never), { detail: det })); wholeBodies++;
    for (let h = 0; h < b.nh; h++) {
      wholeHinges++;
      if (b.HCH[h] !== legacy[0] || b.HSH[h] !== legacy[1] || b.HC[h] !== legacy[2]) wholeDiff++;
      wholeMaxDih = Math.max(wholeMaxDih, dihedralDeg(b.Q, b.HE3[h * 2], b.HE3[h * 2 + 1], b.H3[h * 2], b.H3[h * 2 + 1]));
    }
  }
  add(`hinges: a WHOLE body (${wholeBodies} bodies = ${SPECIES.length} species x detail 2, 3, 4) has exactly the shipped fold limit on every hinge (bitwise cos / sin of half the interior angle)`, `${wholeDiff} of ${wholeHinges} hinges differ; largest rest dihedral ${f(wholeMaxDih, 1)} deg`, '0 differ', wholeDiff === 0);
  const lims: number[] = [], rims: number[] = [];
  for (const id of famList()) {
    const g = speciesTemplateGenome(id as never), b = new SoftBody(g), c = cutBody(b, worldPlane(b, { x: 0, y: 1, z: 0 }, 0));
    if (c.r !== true) continue;
    const [pa] = mkChildren(g, b, undefined, 1, c.plan), p = BP(pa);
    for (let h = 0; h < p.nh; h++) {
      const lim = 180 - (Math.acos(Math.max(-1, Math.min(1, p.HC[h]))) * 180) / Math.PI;
      lims.push(lim);
      const rest = dihedralDeg(p.Q, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]);
      if (rest > 80) rims.push(lim - rest);
    }
  }
  const over = lims.filter((v) => v > FINGER.foldMaxDeg + 1e-6).length;
  info(`hinges: the upper half of a level cut (${famList().length} families): hinges whose limit is above ${FINGER.foldMaxDeg} deg (the cut-face rim) / all hinges; the largest limit; the smallest margin of a rim hinge over its own rest dihedral`, `${over} / ${lims.length}; max ${f(mx(lims), 1)} deg; margin ${f(mn(rims), 1)} deg (the rule: rest + 30)`);
  add('hinges: every hinge whose rest dihedral is over 80 degrees (the cut-face rim) has a limit of at least rest + 30 degrees (capped at 170)', `${rims.length} rim hinges, smallest margin ${f(mn(rims), 2)} deg`, '>= 30 (or 170 - rest)', rims.length > 0 && mn(rims) >= 30 - 1e-9 || rims.length > 0 && lims.every((v) => v <= 170 + 1e-9));
}

/* ── C1: planCut predicts what is built; 'median' halves to 1e-9; 'latched' re-reads the live parts; the cost ── */
const C1_PLANES: Array<[string, V3, number]> = [['y0', unit(0, 1, 0), 0], ['x0', unit(1, 0, 0), 0], ['z+0.2', unit(0, 0, 1), 0.2], ['t1+0.2', unit(0.667, 0.718, -0.199), 0.2], ['t2-0.2', unit(-0.45, 0.62, 0.64), -0.2], ['x+0.5', unit(1, 0, 0), 0.5]];
const c1Cost = { at: [] as number[], median: [] as number[], slice: [] as number[], ctor: [] as number[] };
if (!SKIP.includes('c1')) {
  let nCuts = 0, nRef = 0, nShift = 0, nNested = 0;
  const err = { frac: 0, sum: 0, off: 0, shiftMax: 0, d: 0, nl: 0 };
  let notBuilt = 0, pendingAfter = 0, soundBad = 0, cacheMiss = 0, latchedBad = 0, momErr = 0, restChanged = 0, medianMax = 0, nMedian = 0, medianBad = 0;
  const notes: string[] = [];
  const checkChildren = (tag: string, g: ReturnType<typeof speciesTemplateGenome>, parent: SoftBody, base: PieceRegion | undefined, id: number, c: BodyCut, R0: number, d0: number): [SoftBody, SoftBody, PieceRegion, PieceRegion] | null => {
    nCuts++;
    if (!c.ok) { notes.push(`${tag}: planCut false`); return null; }
    if (c.r === 'thin' || c.r === 'loose') { nRef++; return null; }
    if (c.r !== true) { notes.push(`${tag}: prepareCut ${String(c.r)}`); return null; }
    const pp = BP(parent), dShift = Math.abs(c.plan.rest.d - d0) / R0;
    if (dShift > 1e-12) nShift++;
    err.shiftMax = Math.max(err.shiftMax, dShift);
    if (!c.plan.built) notBuilt++;
    if (c.plan.soundPending || !c.plan.sound) pendingAfter++;
    err.nl = Math.max(err.nl, Math.abs(Math.hypot(c.plan.rest.n.x, c.plan.rest.n.y, c.plan.rest.n.z) - 1));
    const cs0 = pieceCacheSize(), t0 = performance.now();
    const [A, B, ra, rb] = mkChildren(g, parent, base, id, c.plan);
    c1Cost.ctor.push(performance.now() - t0);
    if (pieceCacheSize() !== cs0) cacheMiss++;   // the constructors must have found both children in the cache prepareCut filled
    const pf = parent.frac!, wantA = pf * c.plan.fa, wantB = pf - wantA;
    err.frac = Math.max(err.frac, Math.abs(A.frac! - wantA), Math.abs(B.frac! - wantB));
    err.sum = Math.max(err.sum, Math.abs(A.frac! + B.frac! - pf));
    const ia = A.piece!.offset, ib = B.piece!.offset;
    err.off = Math.max(err.off, Math.abs(ia.x - pp.offX - c.plan.offA.x), Math.abs(ia.y - pp.offY - c.plan.offA.y), Math.abs(ia.z - pp.offZ - c.plan.offA.z), Math.abs(ib.x - pp.offX - c.plan.offB.x), Math.abs(ib.y - pp.offY - c.plan.offB.y), Math.abs(ib.z - pp.offZ - c.plan.offB.z));
    // the plane the children were built on is the plane the plan reports
    const ca = A.piece!.cells[0], last = ca[ca.length - 1];
    err.d = Math.max(err.d, Math.abs(last.d + c.plan.rest.d) / R0);
    // 'latched' after the body moved: the same rest plane, the same shares, built, and momentum conserved across the cut
    parent.nudge({ x: 0.6, y: 0.1, z: -0.35 }); for (let i = 0; i < 4; i++) parent.step(bodyDt);
    const p2 = mkPlan();
    const okL = parent.planCut!({ point: { x: 9, y: 9, z: 9 }, normal: { x: 0, y: 1, z: 0 } }, p2, 'latched');
    if (!okL || !p2.built || p2.soundPending || p2.rest.d !== c.plan.rest.d || p2.rest.n.x !== c.plan.rest.n.x || p2.fa !== c.plan.fa || p2.offA.x !== c.plan.offA.x) latchedBad++;
    if (p2.rest.d !== c.plan.rest.d) restChanged++;
    // momentum: sum over the two sides of (mass x mean velocity) = the body's total, with the sides by the REST position against the plane
    {
      const Q = pp.Q, M = pp.M, V = pp.V, n = pp.n, nx = c.plan.rest.n.x, ny = c.plan.rest.n.y, nz = c.plan.rest.n.z, dr = c.plan.rest.d - (nx * pp.offX + ny * pp.offY + nz * pp.offZ);
      let ma = 0, mb = 0; const tot = [0, 0, 0];
      for (let i = 0; i < n; i++) { if (nx * Q[i * 3] + ny * Q[i * 3 + 1] + nz * Q[i * 3 + 2] - dr >= 0) ma += M[i]; else mb += M[i]; for (let k = 0; k < 3; k++) tot[k] += M[i] * V[i * 3 + k]; }
      const mom = [ma * p2.velA.x + mb * p2.velB.x - tot[0], ma * p2.velA.y + mb * p2.velB.y - tot[1], ma * p2.velA.z + mb * p2.velB.z - tot[2]];
      momErr = Math.max(momErr, Math.hypot(mom[0], mom[1], mom[2]) / pp.Mtot);
    }
    void ra; void rb;
    return [A, B, ra, rb];
  };
  for (const id of SPECIES) {
    const g = speciesTemplateGenome(id as never);
    for (const [nm, n, off] of C1_PLANES) {
      clearPieceCache();
      const b = new SoftBody(g), R0 = b.restRadius, dW0 = off * R0;
      // (planes whose smaller side is under 1/8 are the shell's `small` refusal: the physics is never asked)
      const c = cutBody(b, worldPlane(b, n, off));
      if (c.ok && (c.plan.fa < 0.125 - 1e-4 || 1 - c.plan.fa < 0.125 - 1e-4)) continue;
      c1Cost.at.push(c.ms);
      const ch = checkChildren(`${id} ${nm}`, g, b, undefined, 1, c, R0, dW0);
      if (!ch) continue;
      // a nested cut of the larger child by an oblique 'median' plane (a piece with an offset, one cap plane already)
      const big = ch[0].frac! >= ch[1].frac! ? 0 : 1, bodyP = ch[big], reg = big === 0 ? ch[2] : ch[3];
      if (bodyP.frac! >= 0.26) {
        nNested++;
        const t0 = performance.now(), pl2 = mkPlan(), ok2 = bodyP.planCut!({ point: centreOf(bodyP), normal: unit(0.3, 0.2, 0.93) }, pl2, 'median');
        c1Cost.median.push(performance.now() - t0);
        nMedian++;
        if (!ok2 || Math.abs(pl2.fa - 0.5) >= 1e-9) { medianBad++; } else medianMax = Math.max(medianMax, Math.abs(pl2.fa - 0.5));
        const c2 = cutBody(bodyP, { point: centreOf(bodyP), normal: unit(0.3, 0.2, 0.93) }, 'median');
        checkChildren(`${id} ${nm} nested`, g, bodyP, reg, 2, c2, R0, NaN);
      }
    }
  }
  add('C1 planCut predicts what is built (whole bodies, 6 planes, and a nested median cut of the larger child): the children made by the constructor have frac = parent frac x fa and parent - that to 1e-9; they sum to the parent to 1e-9', `max frac error ${err.frac.toExponential(2)}, sum error ${err.sum.toExponential(2)} over ${nCuts - nRef} built cuts`, '<= 1e-9', err.frac <= 1e-9 && err.sum <= 1e-9);
  add('C1 offA / offB after prepareCut are the children\'s exact rest origins (equal to child.piece.offset minus the parent\'s offset); `built`, `sound` and not `soundPending` once prepareCut said true', `max offset error ${err.off.toExponential(2)}; not built ${notBuilt}; pending or unsound ${pendingAfter}`, '<= 1e-12 R, 0, 0', err.off <= 1e-12 && notBuilt === 0 && pendingAfter === 0);
  add('C1 the plane in the plan (rest.n, rest.d) is the plane the children carry (their cap face), unit normal, and the retry ladder moved it by at most 0.012 R0', `plane mismatch ${err.d.toExponential(2)} R0; |n| - 1 ${err.nl.toExponential(2)}; largest shift ${f(err.shiftMax, 4)} R0 (${nShift} of ${nCuts - nRef} cuts shifted)`, '<= 1e-12, <= 1e-12, <= 0.012', err.d <= 1e-12 && err.nl <= 1e-12 && err.shiftMax <= 0.012 + 1e-9);
  add('C1 the constructor takes the children from the cache prepareCut filled (no new build: the cache does not grow)', `${cacheMiss} of ${nCuts - nRef} cuts built a child again`, '0', cacheMiss === 0);
  add('C1 planCut(..., \'latched\') after the body moved: the same rest plane and shares, built; the two sides\' mass x velocity add up to the body\'s momentum', `${latchedBad} of ${nCuts - nRef} changed the plan; momentum error ${momErr.toExponential(2)} m/s; rest plane changed ${restChanged}`, '0, <= 1e-9', latchedBad === 0 && momErr <= 1e-9);
  add('C1 \'median\' halves the volume (nested piece, 40 bisection steps): |fa - 0.5|', `max ${medianMax.toExponential(2)} over ${nMedian} cuts; ${medianBad} missed`, '< 1e-9', medianBad === 0 && nMedian > 0);
  info('C1 refusals among the cuts above (thin / loose, the shell shows a line)', `${nRef} of ${nCuts}`);
  info('C1 cost (WALL, JIT warm after the first species): planCut \'at\' on a whole body incl. the 360-ray soundness of both children: median / p95 / max ms; planCut + prepareCut to the end', `${f(med(c1Cost.at.slice(3)), 1)} / ${f(pct(c1Cost.at.slice(3), 0.95), 1)} / ${f(mx(c1Cost.at), 1)} (build included; the 4 ms planCut bar belongs to P7)`);
  info('C1 cost: the two constructors of a built cut (cache hits): median / p95 ms', `${f(med(c1Cost.ctor), 1)} / ${f(pct(c1Cost.ctor, 0.95), 1)}`);
  if (notes.length) NOTES.push(...notes.slice(0, 8).map((x) => 'C1 ' + x));
}

/* ── planCut cost alone (no build), best of 5 on a warm body, and one prepareCut slice (budget 3 ms) ── */
if (!SKIP.includes('c1cost')) {
  const at: number[] = [], med40: number[] = [], slice: number[] = [], sliceMax: number[] = [];
  for (const id of (QUICK ? SPECIES.slice(0, 4) : SPECIES.filter((_, i) => i % 3 === 0))) {
    const g = speciesTemplateGenome(id as never), b = new SoftBody(g), plan = mkPlan();
    for (const [, n, off] of C1_PLANES.slice(0, 4)) {
      const wp = worldPlane(b, n, off);
      let best = Infinity;
      for (let rep = 0; rep < 5; rep++) { const t0 = performance.now(); b.planCut!(wp, plan, 'at'); best = Math.min(best, performance.now() - t0); }
      at.push(best);
      best = Infinity;
      for (let rep = 0; rep < 3; rep++) { const t0 = performance.now(); b.planCut!(wp, plan, 'median'); best = Math.min(best, performance.now() - t0); }
      med40.push(best);
      clearPieceCache(); b.planCut!(wp, plan, 'at');
      let r: boolean | 'thin' | 'loose' = false, calls = 0, worst = 0;
      while (r === false && calls < 400) { const t0 = performance.now(); r = b.prepareCut!(3); const el = performance.now() - t0; worst = Math.max(worst, el); slice.push(el); calls++; }
      sliceMax.push(worst);
    }
  }
  info('planCut \'at\' on a whole body, best of 5 (warm): median / p95 / max ms', `${f(med(at), 2)} / ${f(pct(at, 0.95), 2)} / ${f(mx(at), 2)} (n ${at.length})`);
  info('planCut \'median\' (40 clips), best of 3: median / p95 / max ms', `${f(med(med40), 2)} / ${f(pct(med40, 0.95), 2)} / ${f(mx(med40), 2)}`);
  add('prepareCut(3 ms) slices: the longest single call (a stage is <= 3 ms, one call runs at least one stage and stops once the budget is spent)', `p95 ${f(pct(slice, 0.95), 2)} ms, max of the per-cut worst call median ${f(med(sliceMax), 2)} / max ${f(mx(sliceMax), 2)} ms (n ${slice.length} calls)`, 'reported (X20: <= 3 ms slice)', true);
}

/* ── C2 through the body: the refusals are exact and a refusal changes nothing ── */
if (!SKIP.includes('c2b')) {
  let planes = 0, ok = 0, thin = 0, loose = 0, ladder = 0, refNotSticky = 0, resumeBad = 0, touched = 0, skipped = 0;
  const unsound: string[] = [], thinList: string[] = [];
  const sweep = sweepPlanes();
  SPECIES.forEach((id) => {
    const idx = ALL.indexOf(id), g = speciesTemplateGenome(id as never), S = getSource(g);
    const rest3 = buildRest(g, ico3), w: WholeCtx = { g, id, R0: S.R0, pos: rest3.restLocal, tris: ico3.tris, V3: rest3.restVolume, idx };
    clearPieceCache();
    const all = sweep.concat(QUICK ? [] : redTeamPlanes(w)).map((ps) => ({ ps, fam: sweep.includes(ps) ? 'sweep' : 'rt' }));
    for (const { ps, fam } of all) {
      const fa = shareAbove(w, ps.n, ps.off * w.R0);
      if (!(fa >= 0.125 && 1 - fa >= 0.125)) { skipped++; continue; }
      const b = new SoftBody(g), twin = new SoftBody(g);
      const c = cutBody(b, worldPlane(b, ps.n, ps.off));
      planes++;
      if (!c.ok) { NOTES.push(`C2b ${id} ${ps.label}: planCut false although both sides >= 1/8`); continue; }
      if (c.r === true) { ok++; if (Math.abs(c.plan.rest.d - ps.off * w.R0) > 1e-12) ladder++; }
      else if (c.r === 'loose') { loose++; if (fam === 'sweep') unsound.push(`${id} ${ps.label}`); const again = b.prepareCut!(Infinity, 2); if (again !== 'loose') refNotSticky++; const p2 = mkPlan(); if (!b.planCut!({ point: centreOf(b), normal: { x: 1, y: 0, z: 0 } }, p2, 'latched') || p2.sound !== false) resumeBad++; }
      else if (c.r === 'thin') { thin++; thinList.push(`${id} ${ps.label}`); const again = b.prepareCut!(Infinity, 2); if (again !== 'thin') refNotSticky++; }
      // planning and building (or refusing) change nothing the player sees: the body and an untouched twin stay identical
      for (let i = 0; i < 20; i++) { b.step(bodyDt); twin.step(bodyDt); }
      if (b.stateHash() !== twin.stateHash()) touched++;
      // a refusal does not stop the next cut: plan another plane on the same body
      if (c.r === 'thin' || c.r === 'loose') {
        const c2 = cutBody(b, worldPlane(b, { x: 1, y: 0, z: 0 }, 0));
        if (c2.r !== true && !(c2.r === 'loose' || c2.r === 'thin')) resumeBad++;
        if (c2.r === true && c2.plan.built !== true) resumeBad++;
      }
    }
  });
  const extra = unsound.filter((k) => !KNOWN_UNSOUND_PLANES.has(k));
  const missing = [...KNOWN_UNSOUND_PLANES].filter((k) => SPECIES.includes(k.split(' ')[0]) && !unsound.includes(k));
  add('C2 (body API) the sweep planes refused as `loose` through planCut + prepareCut: the known ones (munchip, selenuff: level +0.5 R0) are refused', `refused loose: ${unsound.join(', ') || 'none'}${missing.length ? '; MISSING ' + missing.join(', ') : ''}`, 'both known refused', missing.length === 0);
  add('C2 (body API) no OTHER sweep plane is refused as `loose` (the spec saw ambrosel on an oblique 0.5 R0 plane whose normal is not recorded)', extra.length ? 'extra: ' + extra.join(', ') : 'none', 'none besides an ambrosel oblique plane', extra.every((k) => k.startsWith('ambrosel ')));
  info('C2 (body API) refusals `thin`', `${thin} of ${planes} planes: ${thinList.slice(0, 10).join(', ')}`);
  add('C2 (body API) refusals and builds: loose + thin rate of the planes that keep both sides >= 1/8', `${f((100 * (loose + thin)) / Math.max(1, planes), 2)} % (${loose} loose, ${thin} thin of ${planes}; ${ok} built, ${ladder} of them on a shifted plane; ${skipped} skipped under 1/8)`, 'reported (the spec saw 0.8 % of 905)', true);
  add('C2 (body API) a refusal is sticky (prepareCut says the same again), `latched` reports sound = false after `loose`, and the next planCut on the same body works', `${refNotSticky + resumeBad} failures`, '0', refNotSticky === 0 && resumeBad === 0);
  add('C2 (body API) planning, building and refusing change nothing in the simulation: the body and an untouched twin have the same stateHash 20 frames later', `${touched} of ${planes} differ`, '0', touched === 0);
}

/* ── PieceInfo, frac truth, FRAC_MIN, placeAt, the frame, initRest ── */
if (!SKIP.includes('info')) {
  const q = (ax: V3, deg: number): { x: number; y: number; z: number; w: number } => { const h = (deg * Math.PI) / 360, s = Math.sin(h), l = Math.hypot(ax.x, ax.y, ax.z); return { x: (ax.x / l) * s, y: (ax.y / l) * s, z: (ax.z / l) * s, w: Math.cos(h) }; };
  const rot = (v: V3, o: { x: number; y: number; z: number; w: number }): V3 => { const tx = 2 * (o.y * v.z - o.z * v.y), ty = 2 * (o.z * v.x - o.x * v.z), tz = 2 * (o.x * v.y - o.y * v.x); return { x: v.x + o.w * tx + (o.y * tz - o.z * ty), y: v.y + o.w * ty + (o.z * tx - o.x * tz), z: v.z + o.w * tz + (o.x * ty - o.y * tx) }; };
  let nPieces = 0, groupBad = 0, wholeValBad = 0, cellBad = 0, insideWorst = 0, fracBad = 0, infoBad = 0;
  for (const id of SPECIES) {
    const g = speciesTemplateGenome(id as never), b = new SoftBody(g);
    if (b.piece !== undefined || (b as unknown as { capFlat: boolean }).capFlat !== false) infoBad++;
    const bw = new SoftBody(g, { piece: { frac: 1, chunk: false, at: { x: 1, y: 0.5, z: 0.5 } } } as never), bm = new SoftBody(g, { piece: { frac: 0.5, chunk: false } } as never);
    if (bw.piece !== undefined || bm.piece !== undefined || (bm as unknown as { capFlat: boolean }).capFlat !== false) infoBad++;
    for (const [, n, off] of [C1_PLANES[0], C1_PLANES[1]] as Array<[string, V3, number]>) {
      clearPieceCache();
      const c = cutBody(b, worldPlane(b, n, off));
      if (c.r !== true) continue;
      const [A, B] = mkChildren(g, b, undefined, 7, c.plan);
      for (const [P, sgn] of [[A, 1], [B, -1]] as Array<[SoftBody, number]>) {
        nPieces++;
        const pi = P.piece!;
        if ((P as unknown as { capFlat: boolean }).capFlat !== true) infoBad++;
        // PieceInfo.whole: the SAME array objects for both pieces, the values of a fresh whole body's restLocal / indices
        if (pi.whole !== A.piece!.whole && (pi.whole.restLocal !== A.piece!.whole.restLocal || pi.whole.indices !== A.piece!.whole.indices)) groupBad++;
        if (pi.whole.restLocal.length !== b.restLocal.length || pi.whole.restLocal.some((v, i) => v !== b.restLocal[i]) || pi.whole.indices.some((v, i) => v !== b.indices[i]) || pi.whole.radius !== b.restRadius) wholeValBad++;
        // the cell: one cell, one plane with the shell's id, unit normal pointing OUT (A: -n, B: +n), and every vertex of the piece (restLocal + offset) inside it
        const cell = pi.cells;
        if (cell.length !== 1 || cell[0].length !== 1 || cell[0][0].id !== 7 || Math.abs(Math.hypot(cell[0][0].n.x, cell[0][0].n.y, cell[0][0].n.z) - 1) > 1e-12) cellBad++;
        else {
          const pl = cell[0][0];
          if (Math.abs(pl.n.x + sgn * c.plan.rest.n.x) + Math.abs(pl.n.y + sgn * c.plan.rest.n.y) + Math.abs(pl.n.z + sgn * c.plan.rest.n.z) > 1e-12 || Math.abs(pl.d + sgn * c.plan.rest.d) > 1e-12) cellBad++;
          const L = P.restLocal, o = pi.offset, R0 = b.restRadius;
          for (let i = 0; i < L.length; i += 3) insideWorst = Math.max(insideWorst, ((pl.n.x * (L[i] + o.x) + pl.n.y * (L[i + 1] + o.y) + pl.n.z * (L[i + 2] + o.z)) - pl.d) / R0);
        }
        // frac truth: the divergence-theorem volume of the rest mesh over the whole's
        const vol = BP(P).restVolume, pf = vol / getSource(g).v3;
        if (Math.abs(P.frac! - pf) > 1e-12 || Math.abs(meshVolume(BP(P).Q, BP(P).tris) / getSource(g).v3 - P.frac!) > 1e-9) fracBad++;
      }
    }
  }
  add('PieceInfo.whole is the SAME array objects for the two pieces of a cut (they are grouped by identity) and holds the values of a fresh whole body\'s restLocal / indices / radius', `${nPieces} pieces: grouping ${groupBad} bad, values ${wholeValBad} bad`, '0, 0', groupBad === 0 && wholeValBad === 0 && nPieces > 0);
  add('PieceInfo.cells: one cell of one plane with the shell\'s id, a unit normal pointing out (A: -n, B: +n), d to match, and every rest vertex (restLocal + offset) inside it', `${cellBad} bad cells; worst vertex outside by ${insideWorst.toExponential(2)} R0`, '0, <= 1e-9 R0', cellBad === 0 && insideWorst <= 1e-9);
  add('frac truth: `frac` is the body\'s own measured share (rest volume over V3), the rest mesh\'s volume agrees to 1e-9; a whole, a Minis copy (`chunk: false`, frac < 1) and a mat body publish no `piece` and `capFlat` false', `${fracBad} frac mismatches, ${infoBad} wrong flags`, '0, 0', fracBad === 0 && infoBad === 0);
  // FRAC_MIN 0.124: the old constructor clamp
  const g0 = speciesTemplateGenome('dollop' as never);
  const clampedChunk = (new SoftBody(g0, { piece: { frac: 0.02, chunk: true } } as never) as unknown as { frac: number }).frac;
  // an exact 1/8: three median cuts (the larger child each time) are built as measured, not clamped up to 0.125 nor refused
  let cur = new SoftBody(g0), reg: PieceRegion | undefined, eighth = NaN, okEighth = true;
  for (let k = 0; k < 3; k++) {
    const pl = mkPlan(), ok = cur.planCut!({ point: centreOf(cur), normal: unit(1 - 0.2 * k, 0.1 * k, 0.3) }, pl, 'median');
    let r: boolean | 'thin' | 'loose' = false, calls = 0;
    while (ok && r === false && calls++ < 300) r = cur.prepareCut!(Infinity, 3);
    if (!ok || r !== true) { okEighth = false; break; }
    const [A, , ra] = mkChildren(g0, cur, reg, k + 1, pl); cur = A; reg = ra; eighth = A.frac!;
  }
  add('FRAC_MIN 0.124: a legacy piece asked for 0.02 is built as 0.124; an exact 1/8 (three median cuts) is built as measured (0.125 within 1e-8), not clamped and not refused', `legacy clamp ${clampedChunk}; 1/8 piece frac ${eighth}`, '0.124; 0.125 +- 1e-8', clampedChunk === 0.124 && okEighth && Math.abs(eighth - 0.125) <= 1e-8);
  // placeAt: exact positions in the parent's pose, no lift, re-home, velocity, and the constructor's `at` / `frame` / `vel` give the same body
  {
    const g = speciesTemplateGenome('kneadle' as never), b = new SoftBody(g), c = cutBody(b, worldPlane(b, unit(1, 0, 0), 0));
    const [A, , ra] = mkChildren(g, b, undefined, 1, c.plan);
    const at = { x: 0.31, y: 0.07, z: -0.22 }, vel = { x: 0.4, y: -0.1, z: 0.2 }, fr = q(unit(0.3, 1, 0.2), 40);
    A.placeAt!(at, vel, fr);
    const L = BP(A).Q, P = A.positions;
    let worst = 0, low = Infinity;
    for (let i = 0; i < BP(A).n; i++) { const r = rot({ x: L[i * 3], y: L[i * 3 + 1], z: L[i * 3 + 2] }, fr); worst = Math.max(worst, Math.abs(P[i * 3] - (at.x + r.x)), Math.abs(P[i * 3 + 1] - (at.y + r.y)), Math.abs(P[i * 3 + 2] - (at.z + r.z))); low = Math.min(low, P[i * 3 + 1]); }
    const fq = A.frame, frameErr = Math.hypot(fq.x - fr.x, fq.y - fr.y, fq.z - fr.z, fq.w - fr.w);
    const c0 = centreOf(A);
    A.step(bodyDt);
    const vErr = Math.abs((A.center.x - c0.x) / bodyDt - vel.x);   // the first frame moves the centre by about vel (gravity and the table change y)
    A.reset();
    const rc = centreOf(A);
    const cb = new SoftBody(g, { piece: { frac: A.frac!, region: ra, at, vel, frame: fr } } as never);
    const A2 = new SoftBody(g, { piece: { frac: A.frac!, region: ra } } as never); A2.placeAt!(at, vel, fr);
    const same = cb.positions.every((v, i) => v === A2.positions[i]) && cb.frame.w === A2.frame.w;
    add('placeAt: every particle at `at` + R(frame) x restLocal (float32 positions), no lift (the lowest particle stays below the table where the material is), the frame published; the constructor\'s `at` / `frame` give the same body', `position error ${worst.toExponential(2)} m, lowest particle ${f(low * 1000, 1)} mm, frame error ${frameErr.toExponential(2)}, constructor == placeAt ${same}`, '<= 1e-6 m (float32), a negative height kept, <= 1e-12, true', worst <= 1e-6 && low < 0 && frameErr <= 1e-12 && same);
    add('placeAt: re-homes the piece (reset() returns it to the table under `at`) and the velocity is applied', `after reset: centre x ${f(rc.x, 4)} z ${f(rc.z, 4)} (at ${at.x}, ${at.z}); first-frame speed error ${f(vErr, 4)} m/s`, 'x, z = at; <= 0.05 m/s', Math.abs(rc.x - at.x) < 1e-3 && Math.abs(rc.z - at.z) < 1e-3 && vErr < 0.05);
    void c;
  }
  // initRest twice: the rest-dependent block can be run again (adoptRest, P6) and gives the same body
  {
    const g = speciesTemplateGenome('capnap' as never), b = new SoftBody(g), c = cutBody(b, worldPlane(b, unit(0.667, 0.718, -0.199), 0.1));
    const [A, , ra] = mkChildren(g, b, undefined, 1, c.plan);
    const A2 = new SoftBody(g, { piece: { frac: A.frac!, region: ra } } as never);
    const built = buildPiece(g, ra, pieceDetail(A.frac!), A.frac!);
    if ('fail' in built) add('initRest twice', 'build failed', 'ok', false);
    else {
      (A2 as unknown as { initRest(r: unknown, m: unknown): void }).initRest(built.rest, built.mesh);
      const ha: number[] = [], hb: number[] = [];
      A.nudge({ x: 0.3, y: 0, z: 0.1 }); A2.nudge({ x: 0.3, y: 0, z: 0.1 });
      for (let i = 0; i < 90; i++) { A.step(bodyDt); A2.step(bodyDt); if (i % 30 === 29) { ha.push(A.stateHash()); hb.push(A2.stateHash()); } }
      add('initRest can run again on a built body (the commit of adoptRest, task P6): the same rest shape gives the same trajectory (3 stateHash checkpoints)', `${ha.every((v, i) => v === hb[i])}`, 'true', ha.every((v, i) => v === hb[i]));
    }
  }
}

/* ── the launch row: a new piece must not launch (5.1, X13's LAUNCH bars), 50 species x 3 planes x both sides, alone on the table ── */
if (!SKIP.includes('launch')) {
  const LP: Array<[string, V3, number]> = [['y0', unit(0, 1, 0), 0], ['x0', unit(1, 0, 0), 0], ['t1+0.2', unit(0.667, 0.718, -0.199), 0.2]];
  const worst = { speed: 0, up: 0, rise: 0, reset: 0, low: 0, last: 0, species: '' };
  const per: number[] = [], upAll: number[] = []; let nP = 0, nRef = 0, nSkip = 0, nLaunch = 0;
  const pairWorst = { speed: 0, rise: 0, up: 0 }; const pairPer: number[] = [];
  for (const id of SPECIES) {
    const g = speciesTemplateGenome(id as never);
    for (const [nm, n, off] of LP) {
      clearPieceCache();
      const b = new SoftBody(g), c = cutBody(b, worldPlane(b, n, off));
      if (!c.ok) { nSkip++; continue; }
      if (c.r !== true) { nRef++; continue; }
      if (c.plan.fa < 0.125 - 1e-4 || 1 - c.plan.fa < 0.125 - 1e-4) { nSkip++; continue; }
      const [A, B] = mkChildren(g, b, undefined, 1, c.plan);
      // each alone, born in the rest pose on the table (the reset pose), 1 s
      for (const P of [A, B]) {
        const s = runStat([P], 1, 1.0)[0]; nP++;
        per.push(s.peak); upAll.push(s.peakUp);
        if (s.peak > worst.speed) { worst.speed = s.peak; worst.species = `${id} ${nm}`; }
        worst.up = Math.max(worst.up, s.peakUp); worst.rise = Math.max(worst.rise, s.rise); worst.reset += s.resets; worst.low = Math.min(worst.low, s.lowestMm);
        if (s.rise > 0.06 || s.peakUp > 1.0 || s.resets > 0 || s.lowestMm < -2) { nLaunch++; NOTES.push(`launch ${id} ${nm}: peak ${f(s.peak, 3)} m/s, up ${f(s.peakUp, 3)}, rise ${f(s.rise * 1000, 1)} mm, lowest ${f(s.lowestMm, 1)} mm, resets ${s.resets}`); }
      }
      // the pair born flush at their material's W position in the parent's pose, the shipped collide every frame (P5 changes it): information only
      if (nm === 'x0') {
        const [A2, B2] = mkChildren(g, b, undefined, 1, c.plan);
        const pa = BP(b); void pa;
        A2.placeAt!({ x: b.center.x + c.plan.offA.x, y: b.center.y + c.plan.offA.y, z: b.center.z + c.plan.offA.z }, { x: 0, y: 0, z: 0 });
        B2.placeAt!({ x: b.center.x + c.plan.offB.x, y: b.center.y + c.plan.offB.y, z: b.center.z + c.plan.offB.z }, { x: 0, y: 0, z: 0 });
        const st = runStat([A2, B2], 2, 1.0);
        for (const s of st) { pairWorst.speed = Math.max(pairWorst.speed, s.peak); pairWorst.rise = Math.max(pairWorst.rise, s.rise); pairWorst.up = Math.max(pairWorst.up, s.peakUp); pairPer.push(s.peak); }
      }
    }
  }
  add(`launch: a new piece does not launch (${SPECIES.length} species x level, vertical and tilted planes x both sides, born in the rest pose on the table, 1 s): pieces that break the X13 launch bars (rise <= 0.06 m, upward speed <= 1.0 m/s, 0 safety resets, nothing below -2 mm)`, `${nLaunch} of ${nP} pieces (${nRef} cuts refused, ${nSkip} skipped under 1/8)`, '0', nLaunch === 0 && nP > 0);
  add('launch: the largest centre speed over the first second, from positions (0.1 s finite difference): worst piece / 99th percentile / median; largest upward speed; largest rise; lowest particle', `${f(worst.speed * 1000, 2)} mm/s (${worst.species}) / ${f(pct(per, 0.99) * 1000, 2)} / ${f(med(per) * 1000, 2)} mm/s; up ${f(worst.up * 1000, 2)} mm/s; rise ${f(worst.rise * 1000, 3)} mm; lowest ${f(worst.low, 2)} mm`, 'X13: <= 1.2 m/s from 0.1 s; up <= 1.0 m/s; rise <= 0.06 m (E2 saw 0.000)', worst.speed <= 1.2 && worst.up <= 1.0 && worst.rise <= 0.06);
  info('launch: the vertical-plane pair placed flush at its material positions in the parent\'s pose, the SHIPPED collide every frame (P5 changes the contact), 1 s: largest centre speed / upward speed / rise', `${f(pairWorst.speed, 3)} m/s / ${f(pairWorst.up, 3)} m/s / ${f(pairWorst.rise * 1000, 1)} mm over ${pairPer.length} pieces`);
}

/* ── L2: rest poses, 12 families, 3 poses (cap down, standing on the old foot, dome down) ── */
if (!SKIP.includes('l2')) {
  const poses: Array<[string, V3, number, 0 | 1]> = [['cap down (top half of a level cut)', unit(0, 1, 0), 0, 0], ['old foot (half of a vertical cut)', unit(1, 0, 0), 0, 0], ['dome down (bottom half of a level cut)', unit(0, 1, 0), 0, 1]];
  const rows: Record<string, { last: number[]; jit: number[]; tab: number[]; peak: number[]; low: number[] }> = {};
  for (const id of famList()) {
    const g = speciesTemplateGenome(id as never);
    for (const [label, n, off, side] of poses) {
      clearPieceCache();
      const b = new SoftBody(g), c = cutBody(b, worldPlane(b, n, off));
      if (c.r !== true) continue;
      const [A, B] = mkChildren(g, b, undefined, 1, c.plan), P = side === 0 ? A : B;
      const s = runStat([P], 1, 4.0)[0];
      const r = (rows[label] ??= { last: [], jit: [], tab: [], peak: [], low: [] });
      r.last.push(s.last); r.jit.push(s.jitterMm); r.tab.push(s.onTable); r.peak.push(s.peak); r.low.push(s.lowestMm);
      if (s.last > 0.002 || s.jitterMm > 0.3 || s.onTable < 7) NOTES.push(`L2 ${id} ${label}: speed ${f(s.last * 1000, 2)} mm/s, jitter ${f(s.jitterMm, 3)} mm, on the table ${s.onTable}, lowest ${f(s.lowestMm, 2)} mm`);
    }
  }
  for (const label of Object.keys(rows)) {
    const r = rows[label];
    add(`L2 rest pose, ${label}, ${r.last.length} families, 4 s: speed over the last 0.5 s (positions), centre jitter, particles on the table`, `${f(mx(r.last) * 1000, 3)} mm/s, ${f(mx(r.jit), 3)} mm, >= ${mn(r.tab)} on the table (lowest ${f(mn(r.low), 2)} .. ${f(mx(r.low), 2)} mm); peak speed ${f(mx(r.peak) * 1000, 2)} mm/s`, '<= 2 mm/s, <= 0.3 mm, >= 7', mx(r.last) <= 0.002 && mx(r.jit) <= 0.3 && mn(r.tab) >= 7);
  }
}

/* ── L3: touching a rim (X07): a finger on the dome of a top piece for 0.8 s; the rim hinges' change from their OWN rest dihedral, the hop, the speed 2.5 s later ── */
if (!SKIP.includes('l3')) {
  const legacyHalf = (Math.PI - (FINGER.foldMaxDeg * Math.PI) / 180) / 2;
  const measure = (id: string, legacy: boolean): { rim: number; rimEnd: number; hop: number; v: number; fold: number; ok: boolean; nRim: number } => {
    clearPieceCache();
    const g = speciesTemplateGenome(id as never), b = new SoftBody(g), c = cutBody(b, worldPlane(b, unit(0, 1, 0), 0));
    if (c.r !== true) return { rim: NaN, rimEnd: NaN, hop: NaN, v: NaN, fold: NaN, ok: false, nRim: 0 };
    const [A] = mkChildren(g, b, undefined, 1, c.plan), p = BP(A);
    if (legacy) for (let h = 0; h < p.nh; h++) { p.HCH[h] = Math.cos(legacyHalf); p.HSH[h] = Math.sin(legacyHalf); p.HC[h] = Math.cos(2 * legacyHalf); }
    const rimH: number[] = [], rest: number[] = [];
    for (let h = 0; h < p.nh; h++) { const d0 = dihedralDeg(p.Q, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]); if (d0 > 80) { rimH.push(h); rest.push(d0); } }
    const dih = (): number => { let m = 0; for (let k = 0; k < rimH.length; k++) { const h = rimH[k]; m = Math.max(m, Math.abs(dihedralDeg(p.X, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]) - rest[k])); } return m; };
    let foldAll = 0;
    const allRest: number[] = []; for (let h = 0; h < p.nh; h++) allRest.push(dihedralDeg(p.Q, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]));
    const foldNow = (): void => { for (let h = 0; h < p.nh; h++) foldAll = Math.max(foldAll, dihedralDeg(p.X, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]) - allRest[h]); };
    for (let i = 0; i < 90; i++) A.step(bodyDt);   // settle 1.5 s
    const y0 = A.center.y;
    const hit = A.raycast({ x: A.center.x, y: 4, z: A.center.z }, { x: 0, y: -1, z: 0 });
    if (!hit) return { rim: NaN, rimEnd: NaN, hop: NaN, v: NaN, fold: NaN, ok: false, nRim: rimH.length };
    A.fingerDown(0, { point: hit.point, normal: hit.normal, dir: { x: 0, y: -1, z: 0 } }); A.fingerPressure(0, 1);
    let rimMax = 0, hop = 0;
    const track = (): void => { rimMax = Math.max(rimMax, dih()); hop = Math.max(hop, A.center.y - y0); foldNow(); };
    for (let i = 0; i < 48; i++) { A.step(bodyDt); track(); }   // 0.8 s
    A.fingerUp(0);
    const hist: V3[] = [];
    for (let i = 0; i < 150; i++) { A.step(bodyDt); track(); hist.push(centreOf(A)); }   // 2.5 s
    const v = dist3(hist[hist.length - 7], hist[hist.length - 1]) / (6 * bodyDt);
    return { rim: rimMax, rimEnd: dih(), hop, v, fold: foldAll, ok: true, nRim: rimH.length };
  };
  const res = famList().map((id) => [id, measure(id, false), measure(id, true)] as const).filter(([, a]) => a.ok);
  const worstOf = (k: 'rim' | 'rimEnd' | 'hop' | 'v' | 'fold', i: 1 | 2): number => mx(res.map((r) => (r[i] as { [key: string]: number })[k]));
  add(`L3 touching a rim (${res.length} families): a finger on the dome of the top half of a level cut for 0.8 s, then 2.5 s: the cut-face rim hinges' largest change from their OWN rest dihedral; centre hop; speed 2.5 s after the lift`, `rim ${f(worstOf('rim', 1), 2)} deg (settled ${f(worstOf('rimEnd', 1), 2)}); hop ${f(worstOf('hop', 1) * 1000, 2)} mm; ${f(worstOf('v', 1) * 1000, 2)} mm/s`, 'rim <= 15 deg, hop <= 5 mm, <= 5 mm/s', worstOf('rim', 1) <= 15 && worstOf('hop', 1) <= 0.005 && worstOf('v', 1) <= 0.005);
  add('L3 no hinge folds more than 120 degrees past its own rest dihedral during the press', `${f(worstOf('fold', 1), 1)} deg`, '<= 120 (X07: 75 at rest)', worstOf('fold', 1) <= 120);
  const legacyFail = res.filter(([, , l]) => l.rim > 15 || l.hop > 0.005 || l.v > 0.005).length;
  add('L3 the row can fail: the same run with the shipped single fold limit (110 degrees on every hinge) breaks the rim bars', `${legacyFail} of ${res.length} families fail with the shipped limit (rim ${f(worstOf('rim', 2), 1)} deg, hop ${f(worstOf('hop', 2) * 1000, 1)} mm, ${f(worstOf('v', 2) * 1000, 1)} mm/s)`, '>= 1 family fails', legacyFail >= 1);
}

/* ───────────────────────────── report ───────────────────────────── */
if (NOTES.length) {
  const groups = new Map<string, string[]>();
  for (const nn of NOTES) { const k = nn.split(' ')[0] + (nn.startsWith('refused') ? '' : ''); const a = groups.get(k) ?? []; a.push(nn); groups.set(k, a); }
  console.log(`--- ${NOTES.length} detail lines, by row (first 8 of each) ---`);
  for (const [k, a] of groups) { console.log(`  [${k}] ${a.length} lines`); for (const nn of a.slice(0, 8)) console.log('    ' + nn); }
}
let failed = 0;
for (const r of rows) { if (!r.pass) failed++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`); }
console.log(`${rows.length - failed}/${rows.length} true-cut rows passed in ${((performance.now() - t0) / 1000).toFixed(1)} s (${SPECIES.length} species${QUICK ? ', --quick' : ''})`);
process.exit(failed ? 1 : 0);
