// PHYS probe: gates G1 and G1p of _spec/CONTRACT.md section 6, plain node (type stripping):  node _harness/probe_softbody.ts
// Prints a table of measured values against the thresholds and exits 1 on any failure. `--quick` runs a reduced fuzz
// (20 x 400) for development; the default is the full contract fuzz (200 runs x 1500 random events).
//
// G1   volume stays within 0.85..1.15 under max squeeze and recovers to 1 +/- 0.015 in <= 3 s;
//      shape returns to within 3% of rest radius RMS (rotation + translation removed) <= 4 s after release;
//      settles (kinetic < 0.02) <= 5 s; underdamped (>= 2 visible height oscillations after a hard release, bounce high)
//      with decay time constant 0.5-2.0 s; the peak flops (peak tip displaces >= 25% restRadius under a side poke);
//      fuzz 200 x 1500 random events, dt in [1/240, 1/10] -> 0 NaN, 0 mesh inversions, 0 table penetrations > 1% R;
//      determinism (identical stateHash for identical scripts); float mode (stays within 1.5 m of the origin, returns to
//      hover after a shove).
// G1p  mean step() <= 2.0 ms and p99 <= 5 ms at detail 3 (best of several batches: this container is shared and loud).
// Plus the behavioural contract of section 4 that the gates rest on (events, metrics, raycast, hostile input).
//
// Mesh quality (added after independent verification found that the volume-only "no inversion" gate missed LOCAL folds: a press on
// the swirl-peak or the dome top used to fold the skin into a star-shaped pucker with tucked-under triangles, and a tap near the peak
// left a folded flap for good). Local folds are measured as the dihedral angle between the normals of adjacent triangles: the rest
// shape's own maximum is 50.4 degrees (detail 3), 180 means a flap folded flat onto itself. Gated: fold at rest after every press of
// the matrix, fold peak during it, the peak coming back to its rest height, the fuzz's settled bodies, and the fingertip kinematics
// (a tip must move continuously when a pinch starts or ends, and never go below the table).
// Round 4 (physics repair, 2026-10-05): a dense press matrix (48 points x tap / hold / rub x 3 genomes) with the same fold limits, and
// the mat corral bound in the hostile fuzz (a body that nothing holds never moves outward past the rim). Both failed on the code before
// the repair (checkpoint f14d3b8: 132 deg / 7 frames over 120; 232 mm past the rim), as did the hard side shove row (138 deg, 4 frames).
//
// Definitions the contract leaves open (all printed in the table):
//   * "hard release": a finger presses the dome shoulder (and, separately, the swirl-peak) at pressure 1 for 1.0 s, then
//     lifts. A third scenario pinches the dome between two fingers.
//   * "height" = the highest vertex (the swirl tip); h(t) is it minus its settled value. A "visible oscillation" is an
//     alternating extremum of h with |h| >= 2% of restRadius; n_osc = alternating extrema / 2. tau = exponential fit of
//     |extrema| against time.
//   * "bounce high" = genome.bounce >= 0.7: the starter and the genomes with bounce = 1 (all firmness / stretch corners,
//     both size extremes).
//   * shape error: independent Procrustes (polar decomposition by Higham iteration), RMS over all vertices / restRadius.
//   * the fuzz picks one of: step (18%), fingerDown, fingerPressure, fingerMove, fingerUp, grab, grabMove, grabRelease,
//     nudge, gravity toggle, step(0), reset. Every 4th run uses an extreme genome (firmness / bounce / stretch / size in
//     {0, 1}); the others use randomGenome. After the events everything is released and the body gets 5 s to settle.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import v8 from 'node:v8';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome, randomGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';
import type { V3, SoftEvent } from '../src/contracts.ts';
import { MATERIAL_FAMILY_IDS, MATERIAL_FAMILIES, recoverySeconds95 } from '../src/data/materials.ts';
import { CATALOG, speciesTemplateGenome } from '../src/data/catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));
const QUICK = process.argv.includes('--quick');
const ROUND5_ONLY = process.argv.some((a) => a === '--round5' || a.startsWith('--round5='));
/** `--round5=rub,slide,holdrub,sane`: only those round-5 rows (all four by default); `--round5-detail` lists every gesture that creased. */
const ROUND5_SEL = (process.argv.find((a) => a.startsWith('--round5='))?.slice(9) ?? 'rub,slide,holdrub,sane').split(',');
const ROUND5_DETAIL = process.argv.includes('--round5-detail');
const FUZZ_RUNS = QUICK ? 20 : 200;
const FUZZ_EVENTS = QUICK ? 400 : 1500;
/** Frames per genome of the hostile fuzz (16 extreme genomes; every 4th replayed for determinism). `--long`: 32 runs (the 16 genomes twice,
 *  other input seeds) of 4000 frames, for a soak before a release (round 5: ~4x the default's frames; not part of the default run). */
const LONG = process.argv.includes('--long');
/** `--hostile-only` (with or without `--long`): only the hostile-fuzz rows. */
const HOSTILE_ONLY = process.argv.includes('--hostile-only');
const HOSTILE_STEPS = QUICK ? 300 : LONG ? 4000 : 1200;
const HOSTILE_RUNS = LONG ? 32 : 16;
/** `--families-hostile`: only the per-family hostile fuzz (12 families x 2 genomes x FAM_HOSTILE_STEPS frames, 2 workers). */
const FAM_HOSTILE_ONLY = process.argv.includes('--families-hostile');
const FAM_HOSTILE_STEPS = 1500;
const SANE_FRAMES = QUICK ? 1500 : 6000;
/** Round-5 limits (set from the measured before / after, see the rows): sliding gestures may not crease past this, nor any frame past 120. */
const SLIDE_WORST_MAX = 120;
const SANE_F120_PER_MILLE = 0.5, SANE_LONGEST_MAX = 2;
/** The relative perf bound: 1.25 x the ratio the HEAD of round 5 (6dff62e, before the sliding-contact fix) measured. */
const PERF_REL_MAX = 1.05, PERF_REL_NOTE = 'HEAD before the sliding-contact fix: 0.79-0.84 (6 runs, 4-core container at load 16-20), bound 1.25 x that';
const DT = 1 / 60;
/** A settled body may keep this much dihedral (rest shape 50.4 degrees at detail 3 + 10 degrees of slack). */
const FOLD_REST_MAX = 60;

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

// ------------------------------------------------------------------------------------------------ measurement helpers

function volumeOf(P: Float32Array, tris: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}
function restVolOf(b: SoftBody): number { return volumeOf(b.restLocal, b.indices); }

function topY(b: SoftBody): number {
  let m = -1e9;
  for (let i = 0; i < b.vertexCount; i++) if (b.positions[i * 3 + 1] > m) m = b.positions[i * 3 + 1];
  return m;
}
function minY(b: SoftBody): number {
  let m = 1e9;
  for (let i = 0; i < b.vertexCount; i++) if (b.positions[i * 3 + 1] < m) m = b.positions[i * 3 + 1];
  return m;
}

/** Orthogonal polar factor of a 3x3 (row-major) by Higham iteration. */
function polar(A: number[]): number[] {
  let M = A.slice();
  for (let it = 0; it < 40; it++) {
    const [a, b, c, d, e, f, g, h, i] = M;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-18) break;
    const id = 1 / det;
    // inverse transpose = cofactor matrix / det
    const it_ = [
      (e * i - f * h) * id, -(d * i - f * g) * id, (d * h - e * g) * id,
      -(b * i - c * h) * id, (a * i - c * g) * id, -(a * h - b * g) * id,
      (b * f - c * e) * id, -(a * f - c * d) * id, (a * e - b * d) * id,
    ];
    const N = M.map((v, k) => 0.5 * (v + it_[k]));
    let diff = 0;
    for (let k = 0; k < 9; k++) diff += Math.abs(N[k] - M[k]);
    M = N;
    if (diff < 1e-12) break;
  }
  return M;
}

/** Rest-shape error after removing translation and rotation, in units of restRadius, plus per-vertex displacement. */
function shapeFit(b: SoftBody, outDisp?: Float64Array): number {
  const n = b.vertexCount, P = b.positions, Q = b.restLocal;
  let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
  for (let i = 0; i < n; i++) { px += P[i * 3]; py += P[i * 3 + 1]; pz += P[i * 3 + 2]; qx += Q[i * 3]; qy += Q[i * 3 + 1]; qz += Q[i * 3 + 2]; }
  px /= n; py /= n; pz /= n; qx /= n; qy /= n; qz /= n;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - px, y = P[i * 3 + 1] - py, z = P[i * 3 + 2] - pz;
    const a = Q[i * 3] - qx, bb = Q[i * 3 + 1] - qy, c = Q[i * 3 + 2] - qz;
    A[0] += x * a; A[1] += x * bb; A[2] += x * c; A[3] += y * a; A[4] += y * bb; A[5] += y * c; A[6] += z * a; A[7] += z * bb; A[8] += z * c;
  }
  const R = polar(A);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = Q[i * 3] - qx, bb = Q[i * 3 + 1] - qy, c = Q[i * 3 + 2] - qz;
    const gx = px + R[0] * a + R[1] * bb + R[2] * c, gy = py + R[3] * a + R[4] * bb + R[5] * c, gz = pz + R[6] * a + R[7] * bb + R[8] * c;
    const d2 = (P[i * 3] - gx) ** 2 + (P[i * 3 + 1] - gy) ** 2 + (P[i * 3 + 2] - gz) ** 2;
    s += d2;
    if (outDisp) outDisp[i] = Math.sqrt(d2);
  }
  return Math.sqrt(s / n) / b.restRadius;
}

function touch(b: SoftBody, id: 0 | 1, from: V3, dir: V3): boolean {
  const hit = b.raycast(from, dir);
  if (!hit) return false;
  b.fingerDown(id, { point: hit.point, normal: hit.normal, dir });
  return true;
}
function run(b: SoftBody, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { b.step(DT); if (each) each((i + 1) * DT); }
}
function settle(b: SoftBody, seconds = 2): void { run(b, seconds); }

// ------------------------------------------------------------------------------------------------ mesh fold meter

/** The interior edges of the closed sim mesh as pairs of triangles sharing an edge (t1, t2, t1, t2, ...). */
function trianglePairs(tris: Uint32Array): Int32Array {
  const first = new Map<number, number>();
  const out: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k], c = tris[t * 3 + ((k + 1) % 3)];
      const key = a < c ? a * 65536 + c : c * 65536 + a;
      const o = first.get(key);
      if (o === undefined) first.set(key, t); else out.push(o, t);
    }
  }
  return Int32Array.from(out);
}
interface FoldMeter { pairs: Int32Array; N: Float64Array }
const makeFoldMeter = (b: SoftBody): FoldMeter => ({ pairs: trianglePairs(b.indices), N: new Float64Array(b.indices.length) });
interface Fold { worst: number; n90: number; inward: number }
/** Worst dihedral (degrees) between adjacent triangle normals, number of edges over 90 degrees, number of triangles facing the body centre. */
function foldOf(b: SoftBody, m: FoldMeter): Fold {
  const P = b.positions, I = b.indices, N = m.N, nt = I.length / 3, cx = b.center.x, cy = b.center.y, cz = b.center.z;
  let inward = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1e-12;
    nx /= l; ny /= l; nz /= l;
    N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
    if (nx * ((P[a] + P[c] + P[d]) / 3 - cx) + ny * ((P[a + 1] + P[c + 1] + P[d + 1]) / 3 - cy) + nz * ((P[a + 2] + P[c + 2] + P[d + 2]) / 3 - cz) < 0) inward++;
  }
  let minDot = 1, n90 = 0;
  for (let k = 0; k < m.pairs.length; k += 2) {
    const t1 = m.pairs[k] * 3, t2 = m.pairs[k + 1] * 3;
    const dot = N[t1] * N[t2] + N[t1 + 1] * N[t2 + 1] + N[t1 + 2] * N[t2 + 2];
    if (dot < minDot) minDot = dot;
    if (dot < 0) n90++;
  }
  return { worst: (Math.acos(Math.max(-1, Math.min(1, minDot))) * 180) / Math.PI, n90, inward };
}

/** Contact points of the fold matrix: [label, ray origin, ray direction]. The swirl-peak sits at x ~ 0.04, y ~ 1.02. */
const FOLD_SPOTS: Array<[string, V3, V3]> = [
  ['top x=0', v3(0, 3, 0), v3(0, -1, 0)], ['top x=.04', v3(0.04, 3, 0), v3(0, -1, 0)], ['top x=.1', v3(0.1, 3, 0), v3(0, -1, 0)],
  ['top x=.15', v3(0.15, 3, 0), v3(0, -1, 0)], ['top x=.2', v3(0.2, 3, 0), v3(0, -1, 0)], ['top x=.3', v3(0.3, 3, 0), v3(0, -1, 0)],
  ['top x=.4', v3(0.4, 3, 0), v3(0, -1, 0)], ['top z=.2', v3(0, 3, 0.2), v3(0, -1, 0)], ['camera tilt', v3(-1.2, 3, 0), v3(0.38, -0.92, 0)],
  ['peak flank y=.9', v3(3, 0.9, 0), v3(-1, 0, 0)], ['side y=.7', v3(3, 0.7, 0), v3(-1, 0, 0)], ['side y=.5', v3(3, 0.5, 0), v3(-1, 0, 0)],
  ['side y=.25', v3(3, 0.25, 0), v3(-1, 0, 0)], ['oblique', v3(3, 2.2, 0), v3(-0.8, -0.6, 0)],
];
interface FoldSpec { label: string; genome: Genome; detail: number; spot: number; mode: 'tap' | 'hold' | 'shove' | 'shell'; ray?: [V3, V3] }
/** Pressure, lift time and length of a press of each mode (tap and hold as the fold matrix has always used them; shove: pressure 1 at once
 *  for 0.25 s, the hard side shove of the physview strip 'peak_shove', which the shell never sends; shell: the shell's own profile,
 *  src/input/gestures.ts: tapPressure 0.55 at contact, after tapMs 0.18 s a ramp to 1 over rampMs 0.9 s, lifted at 1.3 s). */
const pressPlan = (mode: FoldSpec['mode']): { p: (t: number) => number; tUp: number; T: number } =>
  mode === 'tap' ? { p: () => 0.6, tUp: 0.12, T: 3.5 } : mode === 'hold' ? { p: (t) => Math.min(1, t / 0.9), tUp: 1.1, T: 4.5 }
    : mode === 'shove' ? { p: () => 1, tUp: 0.25, T: 3.5 } : { p: (t) => (t < 0.18 ? 0.55 : Math.min(1, 0.55 + 0.45 * (t - 0.18) / 0.9)), tUp: 1.3, T: 3.5 };
interface FoldResult {
  label: string; missed: boolean;
  worst: number; f90: number; f120: number;                  // worst dihedral during the press and after, frames over 90 / 120 degrees
  restWorst: number; restN90: number; restInward: number;    // the same at the end, long after the finger left
  topErr: number;                                            // |highest vertex now - highest vertex before the press|, metres
}
/** One press (tap: pressure 0.6 for 0.12 s; hold: pressure ramped over 0.9 s, released at 1.4 s) and the long recovery. */
function foldPress(spec: FoldSpec): FoldResult {
  const b = new SoftBody(spec.genome, { detail: spec.detail });
  const m = makeFoldMeter(b);
  settle(b, 0.5);
  const top0 = topY(b);
  const [label, o, d] = spec.ray ? [spec.label, spec.ray[0], spec.ray[1]] : FOLD_SPOTS[spec.spot];
  const dl = Math.hypot(d.x, d.y, d.z), dir = v3(d.x / dl, d.y / dl, d.z / dl);
  const k = b.restRadius / 0.5125;   // the contact points are given for the starter (R = 0.5125); a smaller or larger body scales the whole ray
  const hit = b.raycast(v3(o.x * k, o.y * k, o.z * k), dir);
  const res: FoldResult = { label: spec.label, missed: !hit, worst: 0, f90: 0, f120: 0, restWorst: 0, restN90: 0, restInward: 0, topErr: 0 };
  if (!hit) return res;
  b.fingerDown(0, { point: hit.point, normal: hit.normal, dir });
  const plan = pressPlan(spec.mode);
  const T = plan.T, tUp = plan.tUp;
  let up = false;
  for (let s = 0, t = 0; t < T; s++) {
    if (!up) b.fingerPressure(0, plan.p(t));
    if (!up && t >= tUp) { up = true; b.fingerUp(0); }
    b.step(DT); t = (s + 1) * DT;
    const f = foldOf(b, m);
    if (f.worst > res.worst) res.worst = f.worst;
    if (f.worst > 90) res.f90++;
    if (f.worst > 120) res.f120++;
  }
  const f = foldOf(b, m);
  res.restWorst = f.worst; res.restN90 = f.n90; res.restInward = f.inward; res.topErr = Math.abs(topY(b) - top0);
  void label;
  return res;
}

interface Extremum { t: number; v: number }
/** Alternating extrema of a signal with |v| >= thr (same-sign neighbours merged to the larger). */
function alternatingExtrema(ts: number[], hs: number[], thr: number): Extremum[] {
  const raw: Extremum[] = [];
  for (let i = 1; i < hs.length - 1; i++) {
    const up = hs[i] - hs[i - 1], dn = hs[i + 1] - hs[i];
    if (up * dn <= 0 && !(up === 0 && dn === 0) && Math.abs(hs[i]) >= thr) raw.push({ t: ts[i], v: hs[i] });
  }
  const out: Extremum[] = [];
  for (const e of raw) {
    const last = out[out.length - 1];
    if (last && Math.sign(last.v) === Math.sign(e.v)) { if (Math.abs(e.v) > Math.abs(last.v)) out[out.length - 1] = e; } else out.push(e);
  }
  return out;
}
function expTau(ex: Extremum[]): number {
  if (ex.length < 3) return NaN;
  const n = ex.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const e of ex) { const x = e.t, y = Math.log(Math.abs(e.v)); sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return slope < 0 ? -1 / slope : Infinity;
}

// ------------------------------------------------------------------------------------------------ hard-release scenarios

interface SqueezeSpec { label: string; genome: Genome; kind: 'shoulder' | 'peak' | 'pinch' }
interface SqueezeResult {
  missed: boolean;
  label: string;
  minVol: number; maxVol: number; maxComp: number;
  volRecover: number;     // seconds after release until |vol - 1| stays <= 0.015
  shapeRecover: number;   // seconds after release until shape RMS stays <= 3% R
  settleT: number;        // seconds after release until kinetic stays < 0.02 for 0.5 s
  nOsc: number; tau: number; firstOvershoot: number; hop: number;
  shapeErr4: number; endDrift: number; nan: boolean; inverted: boolean;
}

/** Hard squeeze (pressure 1), hold 1 s, release, then watch 6 s. */
function hardRelease(spec: SqueezeSpec): SqueezeResult {
  const b = new SoftBody(spec.genome);
  settle(b, 1.5);
  const R = b.restRadius;
  const ok0 = spec.kind === 'pinch'
    ? touch(b, 0, v3(-4, 0.34, 0), v3(1, 0, 0)) && touch(b, 1, v3(4, 0.34, 0), v3(-1, 0, 0))
    : touch(b, 0, v3(spec.kind === 'shoulder' ? 0.22 : 0, 4, 0), v3(0, -1, 0));
  let minVol = 9, maxVol = 0, maxComp = 0, nan = false, inverted = false;
  const rv0 = restVolOf(b);
  const sample = () => {
    const m = b.metrics;
    if (!Number.isFinite(m.volume)) nan = true;
    minVol = Math.min(minVol, m.volume); maxVol = Math.max(maxVol, m.volume); maxComp = Math.max(maxComp, m.compression);
    if (volumeOf(b.positions, b.indices) / rv0 <= 0) inverted = true;
  };
  b.fingerPressure(0, 1); if (spec.kind === 'pinch') b.fingerPressure(1, 1);
  run(b, 1.0, sample);
  b.fingerUp(0); if (spec.kind === 'pinch') b.fingerUp(1);
  const T = 6;
  const ts: number[] = [], hs: number[] = [], vols: number[] = [], errs: number[] = [], kin: number[] = [];
  let hop = 0;
  const c0 = { x: b.center.x, z: b.center.z };
  run(b, T, (t) => {
    sample();
    ts.push(t); hs.push(topY(b)); vols.push(b.metrics.volume); kin.push(b.metrics.kinetic);
    errs.push(ts.length % 3 === 1 || errs.length === 0 ? shapeFit(b) : errs[errs.length - 1]);
    hop = Math.max(hop, minY(b));
  });
  const topEnd = hs.slice(-30).reduce((a, c) => a + c, 0) / 30;
  const h = hs.map((x) => x - topEnd);
  const lastBad = (arr: number[], bad: (v: number) => boolean): number => { let k = -1; for (let i = 0; i < arr.length; i++) if (bad(arr[i])) k = i; return k < 0 ? 0 : ts[k]; };
  const volRecover = lastBad(vols, (v) => Math.abs(v - 1) > 0.015);
  const shapeRecover = lastBad(errs, (e) => e > 0.03);
  let settleT = ts[ts.length - 1];
  for (let i = 0; i < kin.length; i++) { let ok = true; for (let j = i; j < kin.length && ts[j] - ts[i] <= 0.5; j++) if (kin[j] >= 0.02) { ok = false; break; } if (ok) { settleT = ts[i]; break; } }
  const ex = alternatingExtrema(ts, h, 0.02 * R).filter((e) => e.t > 0.05);
  return {
    missed: !ok0, label: spec.label, minVol, maxVol, maxComp, volRecover, shapeRecover, settleT,
    nOsc: Math.floor(ex.length / 2), tau: expTau(ex), firstOvershoot: Math.max(0, ...h.slice(0, 120)), hop,
    shapeErr4: errs[Math.round(4 / DT) - 1], endDrift: Math.hypot(b.center.x - c0.x, b.center.z - c0.z), nan, inverted,
  };
}

// ------------------------------------------------------------------------------------------------ fuzz

interface FuzzStats { runs: number; steps: number; nan: number; inverted: number; penetrations: number; maxPen: number; minVolRatio: number; maxVolRatio: number; safetyResets: number; maxCenter: number; failures: string[]; unsettled: number; restFold: number; restFoldRuns: number; events: number; badEvents: number; maxTableCenter: number }
const emptyStats = (): FuzzStats => ({ runs: 0, steps: 0, nan: 0, inverted: 0, penetrations: 0, maxPen: 0, minVolRatio: 9, maxVolRatio: 0, safetyResets: 0, maxCenter: 0, failures: [], unsettled: 0, restFold: 0, restFoldRuns: 0, events: 0, badEvents: 0, maxTableCenter: 0 });
function mergeStats(a: FuzzStats, b: FuzzStats): FuzzStats {
  return {
    runs: a.runs + b.runs, steps: a.steps + b.steps, nan: a.nan + b.nan, inverted: a.inverted + b.inverted, penetrations: a.penetrations + b.penetrations,
    maxPen: Math.max(a.maxPen, b.maxPen), minVolRatio: Math.min(a.minVolRatio, b.minVolRatio), maxVolRatio: Math.max(a.maxVolRatio, b.maxVolRatio),
    safetyResets: a.safetyResets + b.safetyResets, maxCenter: Math.max(a.maxCenter, b.maxCenter), failures: [...a.failures, ...b.failures].slice(0, 8), unsettled: a.unsettled + b.unsettled,
    restFold: Math.max(a.restFold, b.restFold), restFoldRuns: a.restFoldRuns + b.restFoldRuns,
    events: a.events + b.events, badEvents: a.badEvents + b.badEvents, maxTableCenter: Math.max(a.maxTableCenter, b.maxTableCenter),
  };
}

/** A SoftEvent as contracts.ts defines it: finite fields, unit normal, intensity 0..1, heldFor only on release / snap, a valid finger. '' = fine. */
function eventProblem(e: SoftEvent): string {
  const f = [e.at.x, e.at.y, e.at.z, e.normal.x, e.normal.y, e.normal.z, e.intensity, e.heldFor];
  if (!f.every(Number.isFinite)) return `${e.kind}: non-finite field`;
  if (Math.abs(Math.hypot(e.normal.x, e.normal.y, e.normal.z) - 1) > 1e-6) return `${e.kind}: normal not unit`;
  if (e.intensity < 0 || e.intensity > 1) return `${e.kind}: intensity ${e.intensity}`;
  if (e.heldFor < 0 || (e.kind !== 'release' && e.kind !== 'snap' && e.heldFor !== 0)) return `${e.kind}: heldFor ${e.heldFor}`;
  if (e.kind === 'land' ? e.finger !== -1 : e.finger !== 0 && e.finger !== 1) return `${e.kind}: finger ${e.finger}`;
  return '';
}

function logUniform(r: () => number, lo: number, hi: number): number { return Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo))); }

function fuzzGenome(runIndex: number): Genome {
  if (runIndex % 4 === 3) {
    const k = (runIndex >> 2) & 15;
    return quantizeGenome({ ...makeStarterGenome(), firmness: k & 1, bounce: (k >> 1) & 1, stretch: (k >> 2) & 1, size: (k >> 3) & 1 });
  }
  return randomGenome((runIndex * 2654435761) >>> 0);
}

function fuzzRun(runIndex: number, nEvents: number): { stats: FuzzStats; hash: number } {
  const r = mulberry32(0xf00d0000 + runIndex * 7919);
  const g = fuzzGenome(runIndex);
  const b = new SoftBody(g, { seed: runIndex });
  const R = b.restRadius;
  const stats: FuzzStats = { ...emptyStats(), runs: 1 };
  const rv = (a: number) => (r() * 2 - 1) * a;
  const restVol = restVolOf(b);
  const events: SoftEvent[] = [];

  const checkInvariants = (tag: string): void => {
    stats.steps++;
    const P = b.positions;
    let bad = false;
    for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) { bad = true; break; }
    const m = b.metrics;
    if (bad || !Number.isFinite(m.volume) || !Number.isFinite(m.kinetic) || !Number.isFinite(m.compression) || !Number.isFinite(m.compressionRate) || !Number.isFinite(m.stretch)) {
      stats.nan++; if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: NaN after ${tag}`); return;
    }
    const vol = volumeOf(P, b.indices) / restVol;
    stats.minVolRatio = Math.min(stats.minVolRatio, vol); stats.maxVolRatio = Math.max(stats.maxVolRatio, vol);
    if (!(vol > 0)) { stats.inverted++; if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: signed volume ${vol.toFixed(3)} after ${tag}`); }
    const my = minY(b);
    if (my < -0.01 * R) { stats.penetrations++; stats.maxPen = Math.max(stats.maxPen, -my / R); if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: table penetration ${(-my / R * 100).toFixed(2)}% R after ${tag}`); }
    stats.maxCenter = Math.max(stats.maxCenter, Math.hypot(b.center.x, b.center.z));
    if (b.gravity) stats.maxTableCenter = Math.max(stats.maxTableCenter, Math.hypot(b.center.x, b.center.z));
    stats.safetyResets = b.debug.safetyResets;
  };

  for (let e = 0; e < nEvents; e++) {
    const u = r();
    const pick = u < 0.18 ? 0 : 0.25 + (u - 0.18) * (0.75 / 0.82);   // 18% step events, the rest spread over the other kinds
    const id = (r() < 0.5 ? 0 : 1) as 0 | 1;
    let tag = 'step';
    if (pick < 0.25) {
      tag = 'step'; b.step(logUniform(r, 1 / 240, 1 / 10));
    } else if (pick < 0.35) {
      tag = 'fingerDown';
      const o = v3(rv(4 * R), 0.2 + r() * 2 * R, rv(4 * R)), tgt = v3(rv(0.6 * R), R * (0.1 + r() * 0.9), rv(0.6 * R));
      const d = v3(tgt.x - o.x, tgt.y - o.y, tgt.z - o.z);
      const hit = b.raycast(o, d);
      if (hit) b.fingerDown(id, { point: hit.point, normal: hit.normal, dir: d });
      else b.fingerDown(id, { point: o, normal: v3(0, 1, 0), dir: d });
    } else if (pick < 0.48) {
      tag = 'fingerPressure'; b.fingerPressure(id, r() < 0.2 ? (r() < 0.5 ? 0 : 1) : r());
    } else if (pick < 0.56) {
      tag = 'fingerMove';
      const o = v3(rv(3 * R), 0.2 + r() * 2 * R, rv(3 * R)), d = v3(-o.x + rv(0.5 * R), 0.4 * R - o.y, -o.z + rv(0.5 * R));
      const hit = b.raycast(o, d);
      b.fingerMove(id, hit ? hit.point : o);
    } else if (pick < 0.65) {
      tag = 'fingerUp'; b.fingerUp(id);
    } else if (pick < 0.73) {
      tag = 'grab'; b.grab(id, Math.floor(r() * b.vertexCount), v3(rv(2 * R), R * r() * 2, rv(2 * R)));
    } else if (pick < 0.81) {
      tag = 'grabMove'; b.grabMove(id, v3(rv(3 * R), R * r() * 3, rv(3 * R)));
    } else if (pick < 0.88) {
      tag = 'grabRelease'; b.grabRelease(id);
    } else if (pick < 0.94) {
      tag = 'nudge'; const s = r() * 8; b.nudge(v3(rv(s), rv(s), rv(s)));
    } else if (pick < 0.965) {
      tag = 'gravity'; b.gravity = !b.gravity;
    } else if (pick < 0.985) {
      tag = 'step0'; b.step(0);
    } else {
      tag = 'reset'; b.reset();
    }
    if (e % 7 === 0) {
      events.length = 0; b.drainEvents(events);
      for (const ev of events) { stats.events++; const bad = eventProblem(ev); if (bad) { stats.badEvents++; if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: bad event (${bad}) after ${tag}`); } }
    }
    checkInvariants(tag);
  }
  // the body must settle once everything is let go (gravity back on): 6 s of fixed frames
  b.fingerUp(0); b.fingerUp(1); b.grabRelease(0); b.grabRelease(1); b.gravity = true;
  for (let i = 0; i < 60 * 5; i++) b.step(DT);
  checkInvariants('settle');
  {
    // a settled body must have no crease left (the rest shape's own maximum dihedral is 50.4 degrees)
    const f = foldOf(b, makeFoldMeter(b));
    stats.restFold = f.worst;
    if (f.worst > FOLD_REST_MAX) { stats.restFoldRuns++; if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: fold left after settling: ${f.worst.toFixed(0)} deg, ${f.n90} edges over 90`); }
  }
  if (!(b.metrics.kinetic < 0.02)) { stats.unsettled++; if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: not settled after 5 s (kinetic ${b.metrics.kinetic.toFixed(3)})`); }
  return { stats, hash: b.stateHash() };
}

// ------------------------------------------------------------------------------------------------ fingertip kinematics

interface TipChecks {
  jumpLift: number; jumpStay: number; jumpLand: number;      // largest single-substep move of a tip (m): the lifting tip, the tip that stays down, the tip that was already down when a second finger lands
  widthDrop: number; compRise: number;                       // pinch released: how much the width along the pinch axis shrinks / the compression grows in the first 60 ms
  tipBelowTable: number;                                     // lowest (tip centre height - tip radius) over a low side press (m): negative = the fingertip went into the table
  restRadius: number;
}
/** The kinematic fingertip must move continuously (a pinch starting or ending used to teleport a tip by ~0.3 R in one substep and shove the body). */
function tipChecks(starter: Genome): TipChecks {
  const sub = 1 / 360;   // exactly one solver substep per step() call
  const tipMove = (a: { x: number; y: number; z: number } | null, c: { x: number; y: number; z: number } | null): number => (a && c ? Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) : 0);
  const width = (b: SoftBody): number => { let lo = 1e9, hi = -1e9; for (let i = 0; i < b.vertexCount; i++) { const x = b.positions[i * 3]; if (x < lo) lo = x; if (x > hi) hi = x; } return hi - lo; };
  const pinch = (): SoftBody => {
    const b = new SoftBody(starter);
    settle(b, 1.2);
    touch(b, 0, v3(-4, 0.34, 0), v3(1, 0, 0)); touch(b, 1, v3(4, 0.34, 0), v3(-1, 0, 0));
    b.fingerPressure(0, 1); b.fingerPressure(1, 1);
    run(b, 1.5);
    return b;
  };
  // (a) one jaw lifts
  let jumpLift = 0, jumpStay = 0;
  {
    const b = pinch();
    let p0 = b.tip!(0), p1 = b.tip!(1);
    b.fingerUp(0);
    for (let i = 0; i < 24; i++) { b.step(sub); const c0 = b.tip!(0), c1 = b.tip!(1); jumpLift = Math.max(jumpLift, tipMove(p0, c0)); jumpStay = Math.max(jumpStay, tipMove(p1, c1)); p0 = c0; p1 = c1; }
  }
  // (b) a second finger lands on the other side of a finger that is already pressing
  let jumpLand = 0;
  {
    const b = new SoftBody(starter);
    settle(b, 1.2);
    touch(b, 0, v3(-4, 0.34, 0), v3(1, 0, 0)); b.fingerPressure(0, 1);
    run(b, 1.5);
    let p0 = b.tip!(0);
    touch(b, 1, v3(4, 0.34, 0), v3(-1, 0, 0)); b.fingerPressure(1, 1);
    for (let i = 0; i < 24; i++) { b.step(sub); const c0 = b.tip!(0); jumpLand = Math.max(jumpLand, tipMove(p0, c0)); p0 = c0; }
  }
  // (c) both jaws lift: the body springs back, it is not squeezed harder first
  let widthDrop = 0, compRise = 0;
  {
    const b = pinch();
    const w0 = width(b), c0 = b.metrics.compression;
    b.fingerUp(0); b.fingerUp(1);
    let minW = w0, maxC = c0;
    for (let i = 0; i < 22; i++) { b.step(sub); minW = Math.min(minW, width(b)); maxC = Math.max(maxC, b.metrics.compression); }
    widthDrop = (w0 - minW) / w0; compRise = maxC - c0;
  }
  // (d) a low side press must not push the tip sphere into the table (the foot rim would be squeezed between the two)
  let tipBelowTable = 1;
  const big = quantizeGenome({ ...starter, size: 1 });
  {
    const b = new SoftBody(big);
    settle(b, 1.2);
    touch(b, 0, v3(4, 0.08, 0), v3(-1, 0, 0));
    for (let i = 0; i < 90; i++) { b.fingerPressure(0, Math.min(1, i / 54)); b.step(DT); const t = b.tip!(0); if (t) tipBelowTable = Math.min(tipBelowTable, t.y - t.r); }
  }
  return { jumpLift, jumpStay, jumpLand, widthDrop, compRise, tipBelowTable, restRadius: new SoftBody(starter).restRadius };
}

// ------------------------------------------------------------------------------------------------ round-3 regression checks
// Folded in from the throwaway _harness/verify_phys_* scripts (deleted once they were here): the fold sweep that found the 171-180 degree
// creases under a press on the peak base, the same presses at SUBSTEP resolution (the old exit flipped a fold on and off between
// substeps, so a frame-sampled meter could miss it), reset() == a fresh body, genome / coordinate sanitising, warmUp(), the mat corral,
// the 'press' event's heldFor, allocation in step(), and the independent hostile fuzz.

/** Presses of the verify_phys_fold sweep (starter + four genome variants, taps x = 0 .. 0.25, holds x = 0 .. 0.25, a tilted tap). */
function sweepSpecs(starter: Genome): FoldSpec[] {
  const out: FoldSpec[] = [];
  const G: Array<[string, Partial<Genome>]> = [['starter', {}], ['soft', { firmness: 0.1 }], ['firm', { firmness: 0.9 }], ['bouncy-big', { bounce: 1, size: 1 }], ['stretchy-small', { stretch: 1, size: 0 }]];
  const down = v3(0, -1, 0);
  for (const [n, ov] of G) {
    const g = quantizeGenome({ ...starter, ...ov });
    for (const x of [0, 0.04, 0.1, 0.2, 0.25]) out.push({ label: `sweep/${n}/tap x=${x}`, genome: g, detail: 3, spot: -1, mode: 'tap', ray: [v3(x, 3, 0), down] });
    for (const x of [0, 0.1, 0.2, 0.25]) out.push({ label: `sweep/${n}/hold x=${x}`, genome: g, detail: 3, spot: -1, mode: 'hold', ray: [v3(x, 3, 0), down] });
  }
  const t = 0.4, dir = v3(Math.sin(t), -Math.cos(t), 0);
  out.push({ label: 'sweep/starter/tap tilt 23 deg', genome: starter, detail: 3, spot: -1, mode: 'tap', ray: [v3(-dir.x * 3, 3, 0), dir] });
  out.push({ label: 'sweep/starter/tap x=.1 z=.1', genome: starter, detail: 3, spot: -1, mode: 'tap', ray: [v3(0.1, 3, 0.1), down] });
  return out;
}
/** Side presses at the swirl-peak (y = 0.9 and 0.96 m, 12 and 6 cm under its 1.016 m tip; the physics round-2 fix round restored these
 *  absolute aims with the hand-built DOLLOP shape: a per-genome "tip - 6 / 12 cm" aim lands within 1.2 mm of them on all five genomes), from 4 directions, on 5 genomes (the starter also at detail 4): with the
 *  shell's own pressure profile (48 presses; 179 degrees / 100 frames over 120 without the contact fold limit), and as an instant
 *  pressure-1 shove (a stress case the shell never sends; 162-180 degrees at HEAD). Plus the low side press at the table rim (y = 0.05,
 *  132 degrees at HEAD). */
function shoveSpecs(starter: Genome): FoldSpec[] {
  const out: FoldSpec[] = [];
  const G: Array<[string, Genome]> = [['starter', starter], ['bouncy-big', quantizeGenome({ ...starter, bounce: 1, size: 1 })], ['soft', quantizeGenome({ ...starter, firmness: 0 })],
    ['firm', quantizeGenome({ ...starter, firmness: 1 })], ['small', quantizeGenome({ ...starter, size: 0 })]];
  const dirs: Array<[string, V3, V3]> = [['-x', v3(-3, 0, 0), v3(1, 0, 0)], ['+x', v3(3, 0, 0), v3(-1, 0, 0)], ['-z', v3(0, 0, -3), v3(0, 0, 1)], ['+z', v3(0, 0, 3), v3(0, 0, -1)]];
  for (const mode of ['shell', 'shove'] as const) {
    for (const [n, g] of G) for (const detail of n === 'starter' ? [3, 4] : [3]) for (const y of [0.9, 0.96]) for (const [dn, o, d] of dirs) {
      if (mode === 'shove' && (y !== 0.96 || (n !== 'starter' && n !== 'bouncy-big' && n !== 'soft'))) continue;   // the stress case: a subset
      out.push({ label: `${mode}/${n}${detail === 4 ? '@d4' : ''}/y=${y} from ${dn}`, genome: g, detail, spot: -1, mode, ray: [v3(o.x, y, o.z), d] });
    }
  }
  out.push({ label: 'rim/starter/hold y=.05', genome: starter, detail: 3, spot: -1, mode: 'hold', ray: [v3(3, 0.05, 0), v3(-1, 0, 0)] });
  out.push({ label: 'rim/large/hold y=.05', genome: quantizeGenome({ ...starter, size: 1 }), detail: 3, spot: -1, mode: 'hold', ray: [v3(3, 0.05, 0), v3(-1, 0, 0)] });
  return out;
}

/** The deepest any vertex sits inside a fingertip at the END of a frame (what a finger ghost would show), over the hard peak shoves:
 *  the contact fold limit may leave a vertex inside for a substep. */
function tipPenetration(starter: Genome): number {
  let worst = 0;
  for (const [o, d] of [[v3(-3, 0.96, 0), v3(1, 0, 0)], [v3(3, 0.96, 0), v3(-1, 0, 0)], [v3(0, 0.96, -3), v3(0, 0, 1)], [v3(0.2, 3, 0), v3(0, -1, 0)]] as const) {
    const b = new SoftBody(starter);
    settle(b, 0.3);
    touch(b, 0, o, d); b.fingerPressure(0, 1);
    for (let i = 0; i < 60; i++) {
      b.step(DT);
      const t = b.tip(0);
      if (!t) continue;
      for (let j = 0; j < b.vertexCount; j++) worst = Math.max(worst, (t.r - Math.hypot(b.positions[j * 3] - t.x, b.positions[j * 3 + 1] - t.y, b.positions[j * 3 + 2] - t.z)) / b.restRadius);
    }
  }
  return worst;
}

interface SubFoldResult { label: string; missed: boolean; worst: number; sub120: number; frameWorst: number }
/** One press of the fold matrix stepped one SUBSTEP at a time (inputs still change at 60 Hz frame boundaries): the worst dihedral over every substep. */
function foldSubsteps(spec: FoldSpec): SubFoldResult {
  const b = new SoftBody(spec.genome, { detail: spec.detail });
  const m = makeFoldMeter(b);
  settle(b, 0.5);
  const [, o, d] = spec.ray ? [spec.label, spec.ray[0], spec.ray[1]] : FOLD_SPOTS[spec.spot];
  const dl = Math.hypot(d.x, d.y, d.z), dir = v3(d.x / dl, d.y / dl, d.z / dl);
  const k = b.restRadius / 0.5125;
  const hit = b.raycast(v3(o.x * k, o.y * k, o.z * k), dir);
  const res: SubFoldResult = { label: spec.label, missed: !hit, worst: 0, sub120: 0, frameWorst: 0 };
  if (!hit) return res;
  b.fingerDown(0, { point: hit.point, normal: hit.normal, dir });
  const plan = pressPlan(spec.mode);
  const T = spec.mode === 'hold' ? 3.0 : 2.0, tUp = plan.tUp;
  let up = false;
  for (let s = 0, t = 0; t < T; s++) {
    if (!up) b.fingerPressure(0, plan.p(t));
    if (!up && t >= tUp) { up = true; b.fingerUp(0); }
    for (let q = 0; q < 6; q++) {
      b.step(1 / 360);
      const f = foldOf(b, m);
      if (f.worst > res.worst) res.worst = f.worst;
      if (f.worst > 120) res.sub120++;
      if (q === 5 && f.worst > res.frameWorst) res.frameWorst = f.worst;
    }
    t = (s + 1) * DT;
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ round-4 regression checks (physics repair)
// The dense press matrix the independent verifier asked for: 48 contact points spread over the whole upper surface and the flanks (a
// Fibonacci spiral of directions down to 20 degrees under the equator; the ray comes from 4 R out and aims at the body centre), each pressed
// as a tap, a hold and a rub (fingerMove swept 0.6 R back and forth across the contact), on the starter and on the two soft genome corners
// that still folded at the start of the repair (f0b0s0 small and f0b0s1 large: 132 degrees and 6 frames over 120 under a rub at the peak
// base). Same fold meter as the matrix above.
interface DenseSpec { label: string; genome: Genome; mode: 'tap' | 'hold' | 'rub'; dir: V3 }
function denseSpecs(starter: Genome): DenseSpec[] {
  const G: Array<[string, Genome]> = [['starter', starter], ['f0b0s0z0', quantizeGenome({ ...starter, firmness: 0, bounce: 0, stretch: 0, size: 0 })],
    ['f0b0s1z1', quantizeGenome({ ...starter, firmness: 0, bounce: 0, stretch: 1, size: 1 })]];
  const dirs: V3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5)), npts = 48;
  for (let k = 0; dirs.length < npts; k++) {
    const y = 1 - ((k + 0.5) / (npts * 1.6)) * 2, rr = Math.sqrt(1 - y * y), a = k * golden;
    dirs.push(v3(rr * Math.cos(a), y, rr * Math.sin(a)));
  }
  const out: DenseSpec[] = [];
  for (const [gn, g] of G) for (const mode of ['tap', 'hold', 'rub'] as const) dirs.forEach((d, i) => out.push({ label: `${gn}/${mode}/p${i} (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`, genome: g, mode, dir: d }));
  return out;
}
function densePress(spec: DenseSpec): FoldResult {
  const b = new SoftBody(spec.genome);
  const m = makeFoldMeter(b);
  settle(b, 0.5);
  const R = b.restRadius, c = b.center, d = spec.dir;
  const dir = v3(-d.x, -d.y, -d.z);
  const hit = b.raycast(v3(c.x + d.x * 4 * R, c.y + d.y * 4 * R, c.z + d.z * 4 * R), dir);
  const res: FoldResult = { label: spec.label, missed: !hit, worst: 0, f90: 0, f120: 0, restWorst: 0, restN90: 0, restInward: 0, topErr: 0 };
  if (!hit) return res;
  b.fingerDown(0, { point: hit.point, normal: hit.normal, dir });
  let tx = -dir.z, tz = dir.x;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-6) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
  const T = spec.mode === 'tap' ? 2.5 : spec.mode === 'hold' ? 3.5 : 3, tUp = spec.mode === 'tap' ? 0.12 : spec.mode === 'hold' ? 1.1 : 0.9;
  let up = false;
  for (let s = 0, t = 0; t < T; s++) {
    if (!up) b.fingerPressure(0, spec.mode === 'hold' ? Math.min(1, t / 0.9) : 0.6);
    if (spec.mode === 'rub' && !up && t > 0.15) { const k = Math.sin(((t - 0.15) * 2 * Math.PI) / 0.75) * 0.6 * R; b.fingerMove(0, v3(hit.point.x + tx * k, hit.point.y, hit.point.z + tz * k)); }
    if (!up && t >= tUp) { up = true; b.fingerUp(0); }
    b.step(DT); t = (s + 1) * DT;
    const f = foldOf(b, m);
    if (f.worst > res.worst) res.worst = f.worst;
    if (f.worst > 90) res.f90++;
    if (f.worst > 120) res.f120++;
  }
  const f = foldOf(b, m);
  res.restWorst = f.worst; res.restN90 = f.n90; res.restInward = f.inward;
  return res;
}

// ------------------------------------------------------------------------------------------------ relative perf reference

/** A fixed reference workload for the relative perf row: Gauss-Seidel distance passes over the starter's own edges in plain Float64Array
 *  arithmetic (the solver's typical inner loop), from the same start every call. Timing step() against it, interleaved, cancels most of the
 *  machine's load (a busy machine slows both alike), where the absolute rows swing with whatever else runs (round 5: 1.46 ms in a quiet
 *  moment, over 2 ms with 15 other jobs on 4 cores). */
function makeRefKernel(b: SoftBody): () => number {
  const tris = b.indices, seen = new Set<number>(), E: number[] = [];
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k], c = tris[t + (k + 1) % 3], key = a < c ? a * 65536 + c : c * 65536 + a;
    if (!seen.has(key)) { seen.add(key); E.push(a * 3, c * 3); }
  }
  const E2 = Int32Array.from(E), Q = Float64Array.from(b.restLocal), X = new Float64Array(Q.length), L = new Float64Array(E.length / 2);
  for (let e = 0; e < L.length; e++) { const a = E2[e * 2], c = E2[e * 2 + 1]; L[e] = 0.97 * Math.hypot(Q[a] - Q[c], Q[a + 1] - Q[c + 1], Q[a + 2] - Q[c + 2]); }
  return (): number => {
    X.set(Q);
    for (let p = 0; p < 48; p++) for (let e = 0; e < L.length; e++) {
      const a = E2[e * 2], c = E2[e * 2 + 1];
      const dx = X[a] - X[c], dy = X[a + 1] - X[c + 1], dz = X[a + 2] - X[c + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-12) continue;
      const k = 0.25 * (L[e] - len) / len;
      X[a] += dx * k; X[a + 1] += dy * k; X[a + 2] += dz * k; X[c] -= dx * k; X[c + 1] -= dy * k; X[c + 2] -= dz * k;
    }
    return X[0];
  };
}

// ------------------------------------------------------------------------------------------------ round-5 regression checks (sliding fingers)
// What a player does through the shell, which the presses above did not cover: a finger that lands and then SLIDES (the shell turns a
// pointer drag into fingerMove; its pressure profile is 0.55 at contact, a smoothstep ramp to 1 over 0.9 s after 0.18 s, capped at 0.7
// while rubbing; an outward drag becomes a pull, so rubs are tangential or inward). Found by the independent verifier of the repair:
// a sliding fingertip crushed the skin in front of it into a crease (up to 180 degrees for 45 frames) on the front flank and at the foot
// rim, and two fingers (one holding, one rubbing) did the same. Fold meter as above, every frame.
const GAME_CAM = (R: number): V3 => { const k = R / 0.5125; return v3(0, 1.6 * k, 2.6 * k); };
const towards = (from: V3, p: V3): V3 => { const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z, l = Math.hypot(dx, dy, dz); return v3(dx / l, dy / l, dz / l); };
const cornerGenome = (starter: Genome, name: string): Genome => (name === 'starter' ? starter
  : quantizeGenome({ ...starter, firmness: +name[1], bounce: +name[3], stretch: +name[5], size: +name[7] }));
/** The shell's pressure at time t after the touch; `rub` caps it at 0.7 once the pointer moves (gestures.ts). */
const shellPressure = (t: number, rub: boolean): number => { const x = Math.min(1, Math.max(0, (t - 0.18) / 0.9)), p = 0.55 + 0.45 * x * x * (3 - 2 * x); return rub && t > 0.15 ? Math.min(p, 0.7) : p; };
interface SlideSpec { label: string; genome: Genome; u: V3; ang: number; sp: number; hold?: V3 }
interface SlideResult { label: string; missed: boolean; pull: boolean; worst: number; f120: number; longest: number; restWorst: number; restN90: number; restInward: number }
/** One rub as the game camera sees it: the ray from the game camera through c + (u.x R, u.y 1.3 R (u.y <= 0: u.y R), u.z R) gives the
 *  contact; from 0.15 s the pointer slides in the screen plane at `ang` degrees (0 = right, 90 = up) and `sp` m/s, each frame a fresh
 *  camera ray (fingerMove to its hit); lifted at 1.2 s, then 2.3 s of recovery. With `hold`, finger 0 first holds the point `hold` the
 *  same way (the shell profile, never lifted until the end) and finger 1 does the rub. */
function slidePress(spec: SlideSpec): SlideResult {
  const b = new SoftBody(spec.genome);
  const m = makeFoldMeter(b);
  settle(b, 0.5);
  const R = b.restRadius, c = b.center, cam = GAME_CAM(R);
  const at = (u: V3): V3 => v3(c.x + u.x * R, u.y > 0 ? c.y + u.y * 1.3 * R : c.y + u.y * R, c.z + u.z * R);
  const res: SlideResult = { label: spec.label, missed: false, pull: false, worst: 0, f120: 0, longest: 0, restWorst: 0, restN90: 0, restInward: 0 };
  const id: 0 | 1 = spec.hold ? 1 : 0;
  if (spec.hold) {
    const dh = towards(cam, at(spec.hold)), hh = b.raycast(cam, dh);
    if (!hh) { res.missed = true; return res; }
    b.fingerDown(0, { point: hh.point, normal: hh.normal, dir: dh });
  }
  const d0 = towards(cam, at(spec.u)), h = b.raycast(cam, d0);
  if (!h) { res.missed = true; return res; }
  b.fingerDown(id, { point: h.point, normal: h.normal, dir: d0 });
  const rl = Math.hypot(d0.z, d0.x), right = v3(-d0.z / rl, 0, d0.x / rl);
  const up = v3(right.y * d0.z - right.z * d0.y, right.z * d0.x - right.x * d0.z, right.x * d0.y - right.y * d0.x);
  const a = (spec.ang * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const mv = v3(right.x * ca + up.x * sa, right.y * ca + up.y * sa, right.z * ca + up.z * sa);
  // a drag pointing away from the body centre on screen (cos > 0.2) is a pull in the shell (gestures.ts outwardCos), not a rub: skipped
  const o = v3(h.point.x - c.x, h.point.y - c.y, h.point.z - c.z), ox = o.x * right.x + o.y * right.y + o.z * right.z, oy = o.x * up.x + o.y * up.y + o.z * up.z;
  if (!spec.hold && (ca * ox + sa * oy) / (Math.hypot(ox, oy) || 1) > 0.2) { res.pull = true; return res; }
  let run = 0;
  for (let s = 0, t = 0; t < 3.5; s++) {
    if (spec.hold && t < 1.2) b.fingerPressure(0, shellPressure(t, false));
    if (t < 1.2) {
      b.fingerPressure(id, shellPressure(t, true));
      if (t > 0.15) { const k = spec.sp * (t - 0.15), q = v3(h.point.x + mv.x * k, h.point.y + mv.y * k, h.point.z + mv.z * k), hq = b.raycast(cam, towards(cam, q)); if (hq) b.fingerMove(id, hq.point); }
    } else if (t < 1.2 + DT) { b.fingerUp(id); if (spec.hold) b.fingerUp(0); }
    b.step(DT); t = (s + 1) * DT;
    const f = foldOf(b, m);
    if (f.worst > res.worst) res.worst = f.worst;
    if (f.worst > 120) { res.f120++; run++; if (run > res.longest) res.longest = run; } else run = 0;
  }
  const f = foldOf(b, m);
  res.restWorst = f.worst; res.restN90 = f.n90; res.restInward = f.inward;
  return res;
}
/** (a) Straight rubs from the base of the swirl-peak down the front flank (the verifier's neighbourhood: 3 start points x 5 screen angles
 *  pointing down / down-left x 4 speeds 1.5..3 m/s x 3 genomes = 180). */
function camRubSpecs(starter: Genome): SlideSpec[] {
  const out: SlideSpec[] = [];
  for (const gn of ['starter', 'f0b0s0z0', 'f0b0s1z1']) for (const ang of [195, 210, 225, 240, 255]) for (const sp of [1.5, 2, 2.5, 3]) for (const u of [v3(0.05, 0.83, 0.56), v3(0.15, 0.8, 0.5), v3(-0.1, 0.85, 0.5)])
    out.push({ label: `rub/${gn}/from (${u.x}, ${u.y}, ${u.z}) at ${ang} deg ${sp} m/s`, genome: cornerGenome(starter, gn), u, ang, sp });
  return out;
}
/** (b) Slides toward the table: rubs that start on the lower half of the visible body (the 6 contact points of the verifier's spiral at or
 *  under mid-height that the game camera can see: 8, 9 and 13 lie beyond the silhouette) and move down, down-left / down-right or
 *  sideways on screen at 1 and 2.5 m/s, 4 genomes (outward drags are pulls in the shell: slidePress skips them). */
function slideTableSpecs(starter: Genome): SlideSpec[] {
  const out: SlideSpec[] = [];
  const pts: V3[] = [];
  for (let k = 0; k < 16; k++) { const y = 1 - ((k + 0.5) / 16) * 1.1, rr = Math.sqrt(Math.max(0, 1 - y * y)), a = k * Math.PI * (3 - Math.sqrt(5)); pts.push(v3(rr * Math.cos(a), y, Math.abs(rr * Math.sin(a)) * 0.9 + 0.1 * rr)); }
  for (const gn of ['starter', 'f0b1s0z0', 'f0b0s0z0', 'f0b0s1z1']) for (const i of [7, 10, 11, 12, 14, 15]) for (const ang of [0, 180, 225, 270, 315]) for (const sp of [1, 2.5])
    out.push({ label: `slide/${gn}/p${i} (${pts[i].x.toFixed(2)}, ${pts[i].y.toFixed(2)}, ${pts[i].z.toFixed(2)}) at ${ang} deg ${sp} m/s`, genome: cornerGenome(starter, gn), u: pts[i], ang, sp });
  return out;
}
/** (c) Two fingers: finger 0 holds one point (the shell's profile), finger 1 lands beside it and rubs toward it, away from it and across
 *  (4 screen angles, 1 and 2 m/s), 4 point pairs on the upper body, 3 genomes = 96. */
function holdRubSpecs(starter: Genome): SlideSpec[] {
  const out: SlideSpec[] = [];
  const pairs: Array<[V3, V3]> = [[v3(-0.35, 0.6, 0.7), v3(0.3, 0.65, 0.68)], [v3(0.05, 0.83, 0.56), v3(0.1, 0.35, 0.92)], [v3(0.6, 0.45, 0.65), v3(-0.2, 0.75, 0.6)], [v3(-0.1, 0.3, 0.95), v3(-0.15, 0.8, 0.55)]];
  for (const gn of ['starter', 'f0b0s0z0', 'f0b0s1z1']) pairs.forEach(([hold, u], i) => { for (const ang of [0, 90, 180, 270]) for (const sp of [1, 2])
    out.push({ label: `holdrub/${gn}/pair${i} at ${ang} deg ${sp} m/s`, genome: cornerGenome(starter, gn), u, ang, sp, hold }); });
  return out;
}

interface SaneResult { label: string; frames: number; f120: number; episodes: number; longest: number; worst: number; worstAt: string; fails: string[] }
/** (d) The "sane gesture" fuzz (the verifier's realistic.ts, compacted): camera-like rays (elevation 20..80 deg, azimuth +-70 deg around
 *  +z), the shell's pressure profile, holds of 0.05..2.5 s, rubs at 0.1..2.5 m/s (capped at 0.7, never outward, sometimes toward the other
 *  finger), two fingers at once, grab-pulls up to 1.2 R, gravity on, frame dt 1/120..1/30 s. Counts frames over 120 deg and the longest
 *  run of them. */
function saneFuzz(gname: string, starter: Genome, frames: number, seed: number): SaneResult {
  const b = new SoftBody(cornerGenome(starter, gname));
  const R = b.restRadius, rv0 = restVolOf(b);
  const rng = mulberry32(seed);
  const m = makeFoldMeter(b);
  interface Fg { on: boolean; t: number; hold: number; p0: V3; vel: V3; dir: V3; drag: boolean }
  const fs: Fg[] = [0, 1].map(() => ({ on: false, t: 0, hold: 0, p0: v3(0, 0, 0), vel: v3(0, 0, 0), dir: v3(0, -1, 0), drag: false }));
  let grab = { on: false, t: 0, dur: 0, p0: v3(0, 0, 0), to: v3(0, 0, 0) };
  const camRay = (): { o: V3; d: V3 } => {
    const el = ((20 + rng() * 60) * Math.PI) / 180, az = ((rng() - 0.5) * 140 * Math.PI) / 180;
    const d = v3(-Math.cos(el) * Math.sin(az), -Math.sin(el), -Math.cos(el) * Math.cos(az));
    const c = b.center, tx = c.x + (rng() - 0.5) * 2 * R, ty = rng() * 1.9 * R, tz = c.z + (rng() - 0.5) * 2 * R;
    return { o: v3(tx - d.x * 4, ty - d.y * 4, tz - d.z * 4), d };
  };
  const res: SaneResult = { label: gname, frames: 0, f120: 0, episodes: 0, longest: 0, worst: 0, worstAt: '', fails: [] };
  let run = 0;
  for (let s = 0; s < frames; s++) {
    const dt = 1 / 120 + rng() * (1 / 30 - 1 / 120);
    for (const id of [0, 1] as const) {
      const f = fs[id];
      if (!f.on && !grab.on && rng() < 0.02) {
        const r = camRay(), h = b.raycast(r.o, r.d);
        if (h) {
          b.fingerDown(id, { point: h.point, normal: h.normal, dir: r.d });
          f.on = true; f.t = 0; f.hold = 0.05 + rng() * 2.4; f.p0 = h.point; f.dir = r.d; f.drag = rng() < 0.45;
          const sp = 0.1 + rng() * 2.4, a = rng() * Math.PI * 2;
          let vx = Math.cos(a), vz = Math.sin(a);
          const o = fs[id ^ 1];
          if (o.on && rng() < 0.5) { vx = o.p0.x - f.p0.x; vz = o.p0.z - f.p0.z; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l; }
          const ox = f.p0.x - b.center.x, oz = f.p0.z - b.center.z, ol = Math.hypot(ox, oz) || 1;
          if ((vx * ox + vz * oz) / ol > 0.2) { vx = -vx; vz = -vz; }
          f.vel = v3(vx * sp, 0, vz * sp);
        }
      }
      if (f.on) {
        f.t += dt;
        b.fingerPressure(id, shellPressure(f.t, f.drag));
        if (f.drag && f.t > 0.15) {
          const p = v3(f.p0.x + f.vel.x * (f.t - 0.15), f.p0.y, f.p0.z + f.vel.z * (f.t - 0.15));
          const h = b.raycast(v3(p.x - f.dir.x * 3, p.y - f.dir.y * 3, p.z - f.dir.z * 3), f.dir);
          if (h) b.fingerMove(id, h.point);
        }
        if (f.t >= f.hold) { b.fingerUp(id); f.on = false; }
      }
    }
    if (!grab.on && !fs[0].on && !fs[1].on && rng() < 0.006) {
      const r = camRay(), h = b.raycast(r.o, r.d);
      if (h) { b.grab(0, h.vertex, h.point); const dist = (0.2 + rng()) * R, a = rng() * Math.PI * 2; grab = { on: true, t: 0, dur: 0.3 + rng() * 1.5, p0: h.point, to: v3(h.point.x + Math.cos(a) * dist, h.point.y + (rng() - 0.3) * dist, h.point.z + Math.sin(a) * dist) }; }
    }
    if (grab.on) {
      grab.t += dt; const e = Math.min(1, grab.t / (0.5 * grab.dur));
      b.grabMove(0, v3(grab.p0.x + (grab.to.x - grab.p0.x) * e, grab.p0.y + (grab.to.y - grab.p0.y) * e, grab.p0.z + (grab.to.z - grab.p0.z) * e));
      if (grab.t >= grab.dur) { b.grabRelease(0); grab.on = false; }
    }
    b.step(dt); res.frames++;
    const fo = foldOf(b, m);
    if (fo.worst > res.worst) { res.worst = fo.worst; res.worstAt = `frame ${s}: fingers ${fs.map((f) => (f.on ? (f.drag ? 'rub' : 'hold') + ' ' + f.t.toFixed(2) + ' s' : '-')).join(' / ')}${grab.on ? ', grab' : ''}`; }
    if (fo.worst > 120) { res.f120++; if (run === 0) res.episodes++; run++; if (run > res.longest) res.longest = run; } else run = 0;
    let finite = true;
    for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) { finite = false; break; }
    if (!finite) { res.fails.push(`NaN @${s}`); break; }
    if (!(volumeOf(b.positions, b.indices) / rv0 > 0)) { res.fails.push(`inverted @${s}`); break; }
    if (-minY(b) > 0.01 * R) { res.fails.push(`table penetration @${s}`); break; }
  }
  return res;
}

/** A short scripted session: hashes at checkpoints and every event (kind, finger, intensity) in order. */
function sessionLog(b: SoftBody): { hashes: number[]; events: string[] } {
  const hashes: number[] = [], events: string[] = [], buf: SoftEvent[] = [];
  const log = (): void => { b.drainEvents(buf); for (const e of buf) events.push(`${e.kind}${e.finger}:${e.intensity.toFixed(9)}:${e.heldFor.toFixed(9)}`); buf.length = 0; hashes.push(b.stateHash()); };
  for (let i = 0; i < 30; i++) b.step(DT);
  log();
  touch(b, 0, v3(0.2 * b.restRadius / 0.5125, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.8);
  for (let i = 0; i < 40; i++) { b.step(DT); if (i % 10 === 9) log(); }
  b.fingerUp(0);
  for (let i = 0; i < 40; i++) { b.step(DT); if (i % 10 === 9) log(); }
  b.nudge(v3(1, 0.5, 0));
  for (let i = 0; i < 120; i++) { b.step(DT); if (i % 20 === 19) log(); }
  return { hashes, events };
}
const sameLog = (a: { hashes: number[]; events: string[] }, c: { hashes: number[]; events: string[] }): boolean =>
  a.hashes.length === c.hashes.length && a.hashes.every((h, i) => h === c.hashes[i]) && a.events.join('|') === c.events.join('|');
/** Everything a consumer can read from a body, as one string (positions bit for bit). */
function publicState(b: SoftBody): string {
  return JSON.stringify({ p: Array.from(b.positions), s: Array.from(b.strain), c: b.center, f: b.frame, m: b.metrics, t0: b.tip(0), t1: b.tip(1), h: b.stateHash(), g: b.gravity });
}

/** reset() must leave the body bit-identical to a fresh one (gravity and float), whatever happened before. */
function resetChecks(starter: Genome): { grav: string[]; float: string[]; direct: boolean } {
  const grav: string[] = [], float: string[] = [];
  const fresh = sessionLog(new SoftBody(starter));
  const messy = (b: SoftBody): void => {
    settle(b, 0.3);
    touch(b, 0, v3(0.1, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 1); run(b, 0.25);
    touch(b, 1, v3(4, 0.35, 0), v3(-1, 0, 0)); b.fingerPressure(1, 1); run(b, 0.2);
    b.fingerUp(1); const h = b.raycast(v3(-4, 0.4, 0.1), v3(1, 0, 0)); if (h) b.grab(1, h.vertex, h.point); b.grabMove(1, v3(-1, 0.6, 0)); run(b, 0.15);
    b.gravity = false; run(b, 0.1); b.gravity = true; b.nudge(v3(2, 1, -1)); b.step(1 / 360);
  };
  for (const k of [1, 6, 7, 13]) {
    const b = new SoftBody(starter);
    for (let i = 0; i < k; i++) b.step(1 / 360);
    b.reset();
    if (!sameLog(fresh, sessionLog(b))) grav.push(`${k} substeps`);
  }
  { const b = new SoftBody(starter); messy(b); b.reset(); if (!sameLog(fresh, sessionLog(b))) grav.push('mid-press + grab + gravity toggles + nudge'); }
  // the public state right after reset() equals a new body's, field for field
  const direct = (() => { const a = new SoftBody(starter), b = new SoftBody(starter); messy(b); b.reset(); return publicState(a) === publicState(b); })();
  // float: a new body put in float mode and reset, vs a used floating body reset
  const mkFloat = (): SoftBody => { const b = new SoftBody(starter); b.gravity = false; b.reset(); return b; };
  const freshF = sessionLog(mkFloat());
  for (const k of [7, 77 * 6]) {
    const b = mkFloat();
    for (let i = 0; i < k; i++) b.step(1 / 360);
    b.nudge(v3(1, 0, -1)); b.step(DT);
    b.reset();
    if (!sameLog(freshF, sessionLog(b))) float.push(`${k} substeps + nudge`);
  }
  { const b = mkFloat(); messy(b); b.gravity = false; b.reset(); if (!sameLog(freshF, sessionLog(b))) float.push('messy session'); }
  return { grav, float, direct };
}

/** Bad genome fields must behave exactly like their documented safe value (physicsGenome: non-finite -> 0.5, finite -> clamped to 0..1). */
function genomeChecks(starter: Genome): { bad: string[]; tried: number; resets: number } {
  const bad: string[] = [];
  let tried = 0, resets = 0;
  const probe = (g: unknown): { hash: number; finite: boolean; resets: number; R: number; params: string } => {
    const b = new SoftBody(g as Genome);
    settle(b, 0.3);
    touch(b, 0, v3(0.15, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 1); run(b, 0.4); b.fingerUp(0); run(b, 0.6);
    let finite = true;
    for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) { finite = false; break; }
    return { hash: b.stateHash(), finite, resets: b.debug.safetyResets, R: b.restRadius, params: JSON.stringify(b.params) };
  };
  const expect = (label: string, g: unknown, ref: Genome): void => {
    tried++;
    const a = probe(g), r = probe(ref);
    resets += a.resets;
    if (!a.finite || a.resets > 0 || a.hash !== r.hash || a.R !== r.R || a.params !== r.params) bad.push(`${label} (finite ${a.finite}, resets ${a.resets}, R ${a.R}, same as safe value ${a.hash === r.hash && a.params === r.params})`);
  };
  for (const k of ['firmness', 'bounce', 'stretch', 'size'] as const) {
    for (const v of [Number.NaN, Infinity, -Infinity, undefined]) expect(`${k}=${v}`, { ...starter, [k]: v }, { ...starter, [k]: 0.5 });
    for (const [v, c] of [[-1, 0], [2, 1], [1e300, 1], [-1e300, 0]]) expect(`${k}=${v}`, { ...starter, [k]: v }, { ...starter, [k]: c });
  }
  for (const v of [Number.NaN, Infinity, -5, 1e300]) expect(`seed=${v}`, { ...starter, seed: v }, { ...starter, seed: Number.isFinite(v) ? v : 0 });
  for (const v of [42, undefined, 'no-such-species']) expect(`species=${String(v)}`, { ...starter, species: v }, starter);
  expect('genome=null', null, { ...starter, seed: 0, firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 });
  {
    tried++;
    const a = new SoftBody(starter, { params: { smOmega: Number.NaN, intDamp: -5, volKappa: Infinity, edgeAlphaT: -1 } as never }), r = new SoftBody(starter);
    if (JSON.stringify(a.params) !== JSON.stringify(r.params)) bad.push('params override with NaN / negative / Infinity was not ignored');
  }
  return { bad, tried, resets };
}

/** Absurd coordinates (|c| > 1000 m: 1e30 .. 1e300) are ignored like NaN; tiny or huge DIRECTIONS still work (normalised without overflow). */
function coordChecks(starter: Genome): { bad: string[]; tried: number } {
  const bad: string[] = [];
  let tried = 0;
  // A twin pair: `ctl` gets the sane script, `odd` the same plus a hostile call; the hostile call must change nothing (or equal its sane twin)
  const pair = (label: string, setup: (b: SoftBody) => void, sane: (b: SoftBody) => void, hostile: (b: SoftBody) => void, after?: (b: SoftBody) => string): void => {
    tried++;
    const a = new SoftBody(starter), b = new SoftBody(starter);
    setup(a); setup(b); sane(a); hostile(b);
    run(a, 0.5); run(b, 0.5);
    const extra = after ? after(b) : '';
    let finite = true;
    for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) { finite = false; break; }
    if (a.stateHash() !== b.stateHash() || !finite || b.debug.safetyResets > 0 || extra) bad.push(`${label}${extra ? ': ' + extra : ''}`);
  };
  const none = (): void => {};
  const press = (b: SoftBody): void => { settle(b, 0.3); touch(b, 0, v3(0.15, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.8); run(b, 0.2); };
  const grabbed = (b: SoftBody): void => { settle(b, 0.3); const h = b.raycast(v3(3, 0.42, 0), v3(-1, 0, 0)); if (h) { b.grab(0, h.vertex, h.point); b.grabMove(0, v3(h.point.x + 0.3, h.point.y + 0.1, 0)); } run(b, 0.2); };
  for (const big of [1e30, 1e200, 1e300]) {
    pair(`fingerDown at ${big}`, (b) => settle(b, 0.3), none, (b) => { b.fingerDown(0, { point: v3(big, big, big), normal: v3(0, 1, 0), dir: v3(0, -1, 0) }); b.fingerDown(1, { point: v3(-big, 0.5, 0), normal: v3(1, 0, 0), dir: v3(1, 0, 0) }); },
      (b) => (b.metrics.fingers !== 0 || b.metrics.compression > 0.01 ? `fingers ${b.metrics.fingers}, compression ${b.metrics.compression}` : ''));
    pair(`fingerMove to ${big}`, press, none, (b) => b.fingerMove(0, v3(big, 0, big)));
    pair(`grab toward ${big}`, (b) => settle(b, 0.3), none, (b) => b.grab(1, 5, v3(big, big, 0)), (b) => (b.metrics.grabbed ? 'grabbed' : ''));
    pair(`grabMove to ${big}`, grabbed, none, (b) => b.grabMove(0, v3(big, -big, big)));
    pair(`nudge ${big} = nudge 12 m/s`, (b) => settle(b, 0.3), (b) => b.nudge(v3(12, 0, 0)), (b) => b.nudge(v3(big, 0, 0)));
    pair(`fingerDown dir x ${big}`, (b) => settle(b, 0.3), (b) => { touch(b, 0, v3(0.15, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.8); }, (b) => {
      const h = b.raycast(v3(0.15, 4, 0), v3(0, -1, 0))!; b.fingerDown(0, { point: h.point, normal: v3(0, big, 0), dir: v3(0, -big, 0) }); b.fingerPressure(0, 0.8);
    });
  }
  // raycast: an absurd origin is a miss; a tiny / huge / unnormalised direction hits the same point with t in units of the direction
  {
    const b = new SoftBody(starter);
    settle(b, 0.3);
    tried++;
    if (b.raycast(v3(1e200, 0.3, 0), v3(-1, 0, 0)) !== null || b.raycast(v3(1001, 0.3, 0), v3(-1, 0, 0)) !== null) bad.push('raycast from an absurd origin did not return null');
    const ref = b.raycast(v3(3, 0.3, 0.05), v3(-1, 0, 0))!;
    for (const s of [1e-300, 1e-11, 7, 1e300]) {
      tried++;
      const h = b.raycast(v3(3, 0.3, 0.05), v3(-s, 0, 0));
      if (!h || Math.hypot(h.point.x - ref.point.x, h.point.y - ref.point.y, h.point.z - ref.point.z) > 1e-9 || Math.abs(h.t * s - ref.t) > 1e-9 * ref.t || h.vertex !== ref.vertex) bad.push(`raycast with |dir| = ${s}: ${h ? `point off by ${Math.hypot(h.point.x - ref.point.x, h.point.y - ref.point.y, h.point.z - ref.point.z)}, t*|dir| ${h.t * s} vs ${ref.t}` : 'miss'}`);
    }
  }
  return { bad, tried };
}

/** warmUp() leaves the body bit-identical (fresh, and in the middle of a press), and the session afterwards equals a twin's that never warmed up. */
function warmUpChecks(starter: Genome): { fresh: boolean; midPress: boolean; after: boolean } {
  const a = new SoftBody(starter), b = new SoftBody(starter);
  const s0 = publicState(a);
  a.warmUp();
  const fresh = publicState(a) === s0 && publicState(a) === publicState(b);
  const c = new SoftBody(starter), d = new SoftBody(starter);
  for (const x of [c, d]) { settle(x, 0.3); touch(x, 0, v3(0.2, 4, 0), v3(0, -1, 0)); x.fingerPressure(0, 1); run(x, 0.25); }
  const s1 = publicState(c);
  c.warmUp();
  const midPress = publicState(c) === s1;
  const lc = sessionLog(c), ld = sessionLog(d);
  return { fresh, midPress, after: sameLog(lc, ld) };
}

/** Cold-JIT child (a fresh node process runs this file with --cold-child [warm]): a realistic first session, per-step wall times. */
function coldChild(warm: boolean): void {
  const b = new SoftBody(makeStarterGenome());
  const s0 = publicState(b);
  let warmMs = 0;
  if (warm) { const t = performance.now(); b.warmUp(); warmMs = performance.now() - t; }
  const same = publicState(b) === s0;
  const ts: number[] = [];
  for (let i = 0; i < 400; i++) {
    if (i === 20) { touch(b, 0, v3(0.2, 3, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.6); }
    if (i === 28) b.fingerUp(0);
    if (i === 60) touch(b, 0, v3(0, 3, 0.1), v3(0, -1, 0));
    if (i >= 60 && i < 120) b.fingerPressure(0, Math.min(1, (i - 60) / 54));
    if (i === 120) b.fingerUp(0);
    if (i === 160) { touch(b, 0, v3(-3, 0.35, 0), v3(1, 0, 0)); touch(b, 1, v3(3, 0.35, 0), v3(-1, 0, 0)); b.fingerPressure(0, 0.9); b.fingerPressure(1, 0.9); }
    if (i === 220) { b.fingerUp(0); b.fingerUp(1); }
    if (i === 260) { const h = b.raycast(v3(3, 0.42, 0), v3(-1, 0, 0)); if (h) b.grab(0, h.vertex, h.point); }
    if (i > 260 && i < 300) b.grabMove(0, v3(0.6 + (i - 260) * 0.01, 0.5, 0));
    if (i === 300) b.grabRelease(0);
    if (i === 340) b.gravity = false;
    const t = performance.now(); b.step(DT); ts.push(performance.now() - t);
  }
  const sorted = [...ts].sort((x, y) => x - y);
  process.stdout.write(JSON.stringify({ warmMs, same, worst: sorted[sorted.length - 1], p95: sorted[Math.floor(ts.length * 0.95)], over4: ts.filter((x) => x > 4).length, total: ts.reduce((x, y) => x + y, 0) }));
}
/** Late-press child (a fresh process, --late-press-child): warmUp(), 25 s at rest (long enough for V8 to compile the per-substep code
 *  with whatever type feedback warmUp() left), then a lone finger 0 press, and after another 25 s a lone finger 1 press. Exact new-space
 *  growth per frame over the first 3 s of each press (smallest of 3 windows of 60 frames that saw no scavenge): if warmUp() missed a
 *  path, the first real press deoptimises the compiled code and the step runs boxed for seconds (was 9 KB per frame for ~3 s). */
function latePressChild(): void {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const empty: number[] = [];
  for (let k = 0; k < 6; k++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1];
  const b = new SoftBody(makeStarterGenome());
  b.warmUp();
  // information: the garbage per frame right after warmUp(), while V8 still runs the once-per-frame step() / finalize() in a lower tier
  const early: number[] = [];
  for (let w = 0; w < 2; w++) { const u0 = newUsed(); for (let i = 0; i < 60; i++) b.step(DT); const d = newUsed() - u0 - base; early.push(d >= 0 ? d / 60 : NaN); }
  const perFrame = (): number => {
    let best = Infinity;
    for (let w = 0; w < 3; w++) { const u0 = newUsed(); for (let i = 0; i < 60; i++) b.step(DT); const d = newUsed() - u0 - base; if (d >= 0 && d < best) best = d; }
    return best / 60;
  };
  const out: number[] = [];
  for (const id of [0, 1] as const) {
    for (let i = 0; i < 1500; i++) b.step(DT);
    touch(b, id, v3(0.1, 3, 0), v3(0, -1, 0)); b.fingerPressure(id, 0.8);
    out.push(perFrame());
    b.fingerUp(id);
  }
  process.stdout.write(JSON.stringify({ late: out, early }));
}
interface ColdRun { warmMs: number; same: boolean; worst: number; p95: number; over4: number; total: number }
function coldRuns(warm: boolean, n: number): ColdRun[] {
  const out: ColdRun[] = [];
  for (let i = 0; i < n; i++) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cold-child', ...(warm ? ['warm'] : [])], { encoding: 'utf8', timeout: 120000 });
    try { out.push(JSON.parse(r.stdout) as ColdRun); } catch { out.push({ warmMs: NaN, same: false, worst: Infinity, p95: Infinity, over4: 999, total: NaN }); }
  }
  return out;
}

/** The mat corral is invisible where it must be: identical hashes with it on and off for interaction near the centre, while a finger or a
 *  grab holds the body anywhere, and in float mode; after the finger lifts it brings a far body back and stops. */
function corralLocalChecks(starter: Genome): { deadZone: boolean; finger: boolean; grab: boolean; grabOut: number; float: boolean; outAtLift: number; back: number; stopMm: number; shapePct: number } {
  const OFF = { matBrake: 0, matGlide: 0, matRim: 1e9 };
  const on = (): SoftBody => new SoftBody(starter), off = (): SoftBody => new SoftBody(starter, { params: OFF });
  // interaction near the centre: press, pinch, pull, rub, a small nudge
  const nearScript = (b: SoftBody): number[] => {
    const hs: number[] = [];
    settle(b, 0.5);
    touch(b, 0, v3(0.2, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 1); run(b, 0.7); b.fingerUp(0); run(b, 0.6); hs.push(b.stateHash());
    touch(b, 0, v3(-4, 0.35, 0), v3(1, 0, 0)); touch(b, 1, v3(4, 0.35, 0), v3(-1, 0, 0)); b.fingerPressure(0, 0.9); b.fingerPressure(1, 0.9); run(b, 0.6); b.fingerUp(0); b.fingerUp(1); run(b, 0.6); hs.push(b.stateHash());
    const h = b.raycast(v3(3, 0.42, 0), v3(-1, 0, 0)); if (h) { b.grab(0, h.vertex, h.point); for (let i = 0; i < 36; i++) { b.grabMove(0, v3(h.point.x + 0.02 * i, h.point.y + 0.008 * i, 0)); b.step(DT); } b.grabRelease(0); }
    run(b, 1); hs.push(b.stateHash());
    b.nudge(v3(0.8, 0.3, -0.5)); run(b, 3); hs.push(b.stateHash());
    return hs;
  };
  const eq = (x: number[], y: number[]): boolean => x.length === y.length && x.every((v, i) => v === y[i]);
  const deadZone = eq(nearScript(on()), nearScript(off()));
  // a finger goes down in the same frame as a hard nudge and HOLDS: the corral must not act while it is down (the body is far outside)
  const a = on(), c = off();
  const held: number[][] = [[], []];
  [a, c].forEach((b, k) => { settle(b, 0.3); touch(b, 0, v3(0, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.3); b.nudge(v3(9, 2, 0)); for (let i = 0; i < 90; i++) { b.step(DT); if (i % 10 === 9) held[k].push(b.stateHash()); } });
  const finger = eq(held[0], held[1]);
  const outAtLift = Math.hypot(a.center.x, a.center.z);
  a.fingerUp(0);
  run(a, 10);
  const back = Math.hypot(a.center.x, a.center.z);
  const q1 = Float32Array.from(a.positions);
  run(a, 2);
  let mm = 0; for (let i = 0; i < q1.length; i++) mm = Math.max(mm, Math.abs(q1[i] - a.positions[i]));
  const shapePct = shapeFit(a) * 100;
  // a grab holding the body out there: pull it out in float mode (no corral, no pinned feet), switch gravity on while it is still held
  const g1 = on(), g2 = off();
  const gh: number[][] = [[], []];
  [g1, g2].forEach((b, k) => {
    b.gravity = false; b.reset(); run(b, 0.3);
    const h = b.raycast(v3(3, b.center.y, 0), v3(-1, 0, 0));
    if (!h) return;
    b.grab(0, h.vertex, h.point);
    for (let i = 0; i < 60; i++) { b.grabMove(0, v3(h.point.x + 1.5 * (i + 1) / 60, h.point.y, 0)); b.step(DT); }
    b.gravity = true;
    for (let i = 0; i < 60; i++) { b.step(DT); if (i % 10 === 9) gh[k].push(b.stateHash()); }
  });
  const grabOut = Math.hypot(g1.center.x, g1.center.z);
  const grab = eq(gh[0], gh[1]) && gh[0].length === 6 && g1.metrics.grabbed && grabOut > 0.6;
  // float mode: identical with the corral on and off
  const fl: number[][] = [[], []];
  [on(), off()].forEach((b, k) => { b.gravity = false; b.reset(); run(b, 0.5); b.nudge(v3(12, 0, 0)); for (let i = 0; i < 240; i++) { b.step(DT); if (i % 20 === 19) fl[k].push(b.stateHash()); } });
  return { deadZone, finger, grab, grabOut, float: eq(fl[0], fl[1]), outAtLift, back, stopMm: mm * 1000, shapePct };
}

interface CorralSpec { label: string; genome: Genome; kind: 'nudge' | 'shoves' | 'hammer'; az: number; el: number }
interface CorralResult { label: string; kind: string; max: number; end: number; stopMm: number; shapePct: number; finite: boolean }
/** One nudge experiment on the table: the farthest the centre gets, where it ends 14 s later, whether it has stopped and kept its shape. */
function corralRun(spec: CorralSpec): CorralResult {
  const b = new SoftBody(spec.genome);
  settle(b, 0.5);
  const ca = Math.cos(spec.az), sa = Math.sin(spec.az), ce = Math.cos(spec.el), se = Math.sin(spec.el);
  let max = 0;
  const track = (): void => { max = Math.max(max, Math.hypot(b.center.x, b.center.z)); };
  if (spec.kind === 'nudge') { b.nudge(v3(12 * ce * ca, 12 * se, 12 * ce * sa)); }
  else if (spec.kind === 'shoves') { for (let k = 0; k < 10; k++) { b.nudge(v3(4 * ca, 1, 4 * sa)); run(b, 0.5, track); } }
  else { for (let k = 0; k < 60; k++) { b.nudge(v3(12 * ca, k % 2 ? 3 : 0, 12 * sa)); b.step(DT); track(); } }   // a 12 m/s shove EVERY frame for 1 s
  run(b, 14, track);
  const q1 = Float32Array.from(b.positions);
  run(b, 2, track);
  let mm = 0, finite = true;
  for (let i = 0; i < q1.length; i++) { mm = Math.max(mm, Math.abs(q1[i] - b.positions[i])); if (!Number.isFinite(b.positions[i])) finite = false; }
  return { label: spec.label, kind: spec.kind, max, end: Math.hypot(b.center.x, b.center.z), stopMm: mm * 1000, shapePct: shapeFit(b) * 100, finite };
}

interface HostileResult { label: string; steps: number; fails: string[]; hashes: number[]; events: number; maxTable: number; maxAny: number; settleT: number; settledVol: number; flipped: number; shapePct: number; freeOut: number; freeAt: string }
/**
 * The independent verifier's hostile fuzz (was _harness/verify_phys_fuzz.ts): an extreme genome (firmness, bounce, stretch, size each 0 or 1),
 * 0..3 random calls per frame: fingers anywhere (also off the body, zero direction), pressure jumps incl. -3 and 7, moves onto the OTHER
 * finger's point (crossing), grabs while fingers are down, far grab targets (40 R), nudges up to 1e6, gravity toggled mid-press, reset
 * mid-grab, and the pressure of every down finger flipped 0 <-> 1 on 60% of frames; dt from {0, 0.5, 5, log-uniform 1/240..1/10}.
 * Checked at EVERY frame: finite state, signed volume > 0, no particle 1% R under the table, valid events, no event spam, queue cap; at the
 * end (everything released, gravity on): settles within 8 s, volume 1 +/- 0.015, no triangle flipped > 120 deg vs rest, shape <= 3% R.
 */
/** A per-family hostile run (physics round-2 fix round): the family forced on `genome`; `elastic` families must also come back to their
 *  rest shape (<= 3% R), a plastic or slow one (a yield, or recoverySeconds95 > 3 s: it keeps or is still healing dents by design) need not. */
interface FamHostile { family: string; genome: Genome; label: string; elastic: boolean }
function famHostileSpec(fi: number, gi: number): FamHostile {
  const fam = MATERIAL_FAMILY_IDS[fi], ph = MATERIAL_FAMILIES[fam].physics, elastic = !(ph.yieldStrain > 0 || recoverySeconds95(ph) > 3);
  if (gi === 0) {
    // the family's first catalog species, its own template genome (its own recipe shape)
    const d = CATALOG.find((c) => c.family === fam);
    if (d) return { family: fam, genome: d.id === 'dollop' ? makeStarterGenome() : speciesTemplateGenome(d.id as never), label: `${fam}/${d.id}`, elastic };
  }
  // an extreme corner genome on the DOLLOP shape, a different corner per family
  const idx = (fi * 7 + 5 + gi * 3) & 15;
  return { family: fam, genome: quantizeGenome({ ...makeStarterGenome(), firmness: idx & 1, bounce: (idx >> 1) & 1, stretch: (idx >> 2) & 1, size: (idx >> 3) & 1 }), label: `${fam}/dollop f${idx & 1}b${(idx >> 1) & 1}s${(idx >> 2) & 1}z${(idx >> 3) & 1}`, elastic };
}
function hostileRun(idx: number, steps: number, fam?: FamHostile): HostileResult {
  const g = fam ? fam.genome : quantizeGenome({ ...makeStarterGenome(), firmness: idx & 1, bounce: (idx >> 1) & 1, stretch: (idx >> 2) & 1, size: (idx >> 3) & 1 });
  const label = fam ? fam.label : `f${idx & 1}b${(idx >> 1) & 1}s${(idx >> 2) & 1}z${(idx >> 3) & 1}${idx >= 16 ? `/run${idx}` : ''}`;
  const b = fam ? new SoftBody(g, { seed: 0xc0ffee + idx, family: fam.family } as never) : new SoftBody(g, { seed: 0xc0ffee + idx });
  const R = b.restRadius, rv0 = restVolOf(b);
  const rng = mulberry32(0x5eed0000 + idx * 7919);
  const pick = (n: number): number => Math.floor(rng() * n);
  const unit = (): V3 => { const z = 2 * rng() - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z); return v3(r * Math.cos(a), z, r * Math.sin(a)); };
  const fails: string[] = [], hashes: number[] = [], evs: SoftEvent[] = [];
  const fail = (m: string): void => { if (fails.length < 6) fails.push(m); };
  const down = [false, false], press = [0, 0];
  const lastPt: V3[] = [v3(0, R, 0), v3(0, R, 0)];
  const lastEv = new Map<string, { t: number; dt: number }>();
  let clock = 0, curDt = 0, events = 0, maxTable = 0, maxAny = 0;
  // the mat corral bound, from the public side: while NOTHING holds the body (gravity on, no grab and none for pinHold + 0.1 s, so no pinned
  // feet; no fingertip with a vertex on or in it) its centre may not move outward past max(rim, where it was let go)
  let lastHeld = -1e9, freeFrom = -1, freeOut = -1e9, freeAt = '';
  // "no fingertip touching it" must hold for the WHOLE frame, not only at its end (the old test sampled the frame ends only: a tip can meet
  // the body for a few substeps in between, and then the corral is rightly off). The tips are seen at frame ends only, so a frame counts as
  // held when the gap between a tip and the skin may have closed at any time in it: that gap is at least max(gap at the start, gap at the
  // end) - 1.5 x (largest vertex travel + tip travel + radius change) (1.5: the substep paths are not straight). A tip that appeared or
  // vanished in the frame, or got a fingerDown, may have been anywhere within R of where it is seen. A grab() in the frame holds it too
  // (even when grabRelease() follows before the step: the pinned feet still hold it).
  const prevP = Float32Array.from(b.positions), prevTip: Array<{ x: number; y: number; z: number; r: number } | null> = [null, null], prevGap = [Infinity, Infinity];
  const downCall = [false, false];
  let grabCall = false;
  const rimR = b.params.matRim, pinHold = b.params.pinHold;
  const rayAtBody = (): { point: V3; normal: V3; dir: V3 } | null => {
    const c = b.center, u = unit(), o = v3(c.x + u.x * 3 * R, c.y + u.y * 3 * R, c.z + u.z * 3 * R), j = 0.35 * R;
    const t = v3(c.x + (rng() - 0.5) * j, c.y + (rng() - 0.5) * j, c.z + (rng() - 0.5) * j);
    const l = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z) || 1, dir = v3((t.x - o.x) / l, (t.y - o.y) / l, (t.z - o.z) / l);
    const h = b.raycast(o, dir);
    return h ? { point: h.point, normal: h.normal, dir } : null;
  };
  const dtDraw = (): number => { const u = rng(); if (u < 0.08) return 0; if (u < 0.16) return 0.5; if (u < 0.24) return 5; return logUniform(rng, 1 / 240, 1 / 10); };
  const check = (where: string): boolean => {
    const P = b.positions, m = b.metrics;
    for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) { fail(`NaN position @${where}`); return false; }
    if (![m.compression, m.compressionRate, m.stretch, m.volume, m.kinetic, b.center.x, b.center.y, b.center.z, b.frame.x, b.frame.y, b.frame.z, b.frame.w].every(Number.isFinite)) { fail(`non-finite metrics / centre / frame @${where}`); return false; }
    for (let i = 0; i < b.strain.length; i++) if (!Number.isFinite(b.strain[i])) { fail(`non-finite strain @${where}`); return false; }
    if (!(volumeOf(P, b.indices) / rv0 > 0)) { fail(`inverted mesh @${where}`); return false; }
    if (minY(b) < -0.01 * R) { fail(`table penetration ${(-minY(b) / R * 100).toFixed(2)}% R @${where}`); return false; }
    const d = Math.hypot(b.center.x, b.center.z);
    maxAny = Math.max(maxAny, d); if (b.gravity) maxTable = Math.max(maxTable, d);
    let touched = false, dv = 0;
    for (let i = 0; i < P.length; i += 3) dv = Math.max(dv, Math.hypot(P[i] - prevP[i], P[i + 1] - prevP[i + 1], P[i + 2] - prevP[i + 2]));
    prevP.set(P);
    for (const id of [0, 1] as const) {
      const tp = b.tip(id), pt = prevTip[id];
      let g1 = Infinity;
      if (tp) { let m2 = Infinity; for (let i = 0; i < P.length; i += 3) m2 = Math.min(m2, (P[i] - tp.x) ** 2 + (P[i + 1] - tp.y) ** 2 + (P[i + 2] - tp.z) ** 2); g1 = Math.sqrt(m2) - tp.r; }
      if (tp || pt) {
        const travel = tp && pt && !downCall[id] ? Math.hypot(tp.x - pt.x, tp.y - pt.y, tp.z - pt.z) + Math.abs(tp.r - pt.r) : R;
        if (Math.max(pt ? prevGap[id] : -Infinity, tp ? g1 : -Infinity) - 1.5 * (dv + travel) <= 0.002) touched = true;
      }
      prevTip[id] = tp ? { x: tp.x, y: tp.y, z: tp.z, r: tp.r } : null; prevGap[id] = g1; downCall[id] = false;
    }
    if (m.grabbed || grabCall) lastHeld = clock;
    grabCall = false;
    if (!b.gravity || touched || clock - lastHeld < pinHold + 0.1) freeFrom = -1;
    else {
      if (freeFrom < 0) freeFrom = d;
      const out = d - Math.max(rimR, freeFrom);
      if (out > freeOut) { freeOut = out; freeAt = `${where}: ${d.toFixed(2)} m, let go at ${freeFrom.toFixed(2)} m`; }
    }
    return true;
  };
  let ok = true;
  for (let s = 0; s < steps && ok; s++) {
    const nc = pick(4);
    for (let k = 0; k < nc; k++) {
      const id = pick(2) as 0 | 1, other = (1 - id) as 0 | 1, r = rng();
      if (r < 0.16) {
        const h = rayAtBody();
        if (h) { b.fingerDown(id, h); down[id] = true; lastPt[id] = h.point; downCall[id] = true; }
        else if (rng() < 0.2) { b.fingerDown(id, { point: v3((rng() - 0.5) * 6 * R, (rng() - 0.2) * 4 * R, (rng() - 0.5) * 6 * R), normal: unit(), dir: rng() < 0.3 ? v3(0, 0, 0) : unit() }); down[id] = true; downCall[id] = true; }
      } else if (r < 0.26) { const v = rng() < 0.8 ? (rng() < 0.5 ? 0 : 1) : (rng() < 0.5 ? -3 : 7); b.fingerPressure(id, v); press[id] = v; }
      else if (r < 0.46) {
        const m = rng();
        if (m < 0.45) { const h = rayAtBody(); if (h) { b.fingerMove(id, h.point); lastPt[id] = h.point; } }
        else if (m < 0.85) { b.fingerMove(id, lastPt[other]); lastPt[id] = lastPt[other]; }
        else b.fingerMove(id, v3((rng() - 0.5) * 5 * R, rng() * 3 * R, (rng() - 0.5) * 5 * R));
      } else if (r < 0.54) { b.fingerUp(id); down[id] = false; }
      else if (r < 0.64) {
        const v = pick(b.vertexCount), sc = rng() < 0.2 ? 6 : 2;
        b.grab(id, v, v3(b.positions[v * 3] + (rng() - 0.5) * sc * R, b.positions[v * 3 + 1] + rng() * sc * R, b.positions[v * 3 + 2] + (rng() - 0.5) * sc * R));
        down[id] = false; grabCall = true;
      } else if (r < 0.74) { const sc = rng() < 0.15 ? 40 : 3; b.grabMove(id, v3(b.center.x + (rng() - 0.5) * sc * R, b.center.y + (rng() - 0.3) * sc * R, b.center.z + (rng() - 0.5) * sc * R)); }
      else if (r < 0.79) b.grabRelease(id);
      else if (r < 0.86) { const mag = [0.5, 3, 12, 40, 1e6][pick(5)], u = unit(); b.nudge(v3(u.x * mag, u.y * mag, u.z * mag)); }
      else if (r < 0.92) b.gravity = !b.gravity;
      else if (r < 0.93) { b.reset(); down[0] = down[1] = false; lastEv.clear(); }
      else if (r < 0.96) { for (const q of [0, 1] as const) if (down[q]) { press[q] = press[q] > 0.5 ? 0 : 1; b.fingerPressure(q, press[q]); } }
    }
    if (rng() < 0.6) for (const q of [0, 1] as const) if (down[q]) { press[q] = press[q] > 0.5 ? 0 : 1; b.fingerPressure(q, press[q]); }
    const dt = dtDraw();
    curDt = Math.min(Math.max(dt, 0), 1 / 20);
    b.step(dt);
    clock += curDt;
    if (!check(`frame ${s}`)) { ok = false; break; }
    evs.length = 0; b.drainEvents(evs);
    if (evs.length > 128) fail(`event queue over the 128 cap (${evs.length})`);
    for (const e of evs) {
      events++;
      const bad = eventProblem(e);
      if (bad) fail(`bad event ${bad} @frame ${s}`);
      const key = `${e.kind}:${e.finger}`, last = lastEv.get(key);
      if (last && clock - last.t < 0.05 - curDt - last.dt - 2 / 360 - 0.001) fail(`event spam ${key}: gap ${(clock - last.t).toFixed(4)} s @frame ${s}`);
      lastEv.set(key, { t: clock, dt: curDt });
    }
    if (s % 250 === 249) hashes.push(b.stateHash());
  }
  if (b.debug.safetyResets > 0) fail(`debug.safetyResets = ${b.debug.safetyResets}`);
  let settleT = -1, settledVol = NaN, flipped = -1, shapePct = NaN;
  if (ok) {
    b.fingerUp(0); b.fingerUp(1); b.grabRelease(0); b.grabRelease(1); b.gravity = true;
    let quiet = 0;
    for (let i = 0, t = 0; i < 8 * 60; i++) {
      b.step(DT); t += DT; clock += DT;
      if (!check(`settle ${t.toFixed(2)} s`)) { ok = false; break; }
      if (b.metrics.kinetic < 0.02) { if (quiet === 0) settleT = t; quiet++; } else { quiet = 0; settleT = -1; }
    }
    if (ok) {
      if (settleT < 0 || quiet < 30) fail(`did not settle in 8 s (kinetic ${b.metrics.kinetic.toFixed(4)})`);
      settledVol = b.metrics.volume;
      if (Math.abs(settledVol - 1) > 0.015) fail(`settled volume ${settledVol.toFixed(4)}`);
      const fl = flippedVsRest(b);
      flipped = fl;
      if (fl > 0) fail(`${fl} triangles flipped > 120 deg vs rest once settled`);
      shapePct = shapeFit(b) * 100;
      if (shapePct > 3 && (!fam || fam.elastic)) fail(`settled shape error ${shapePct.toFixed(2)}% R`);
    }
  }
  hashes.push(b.stateHash());
  return { label, steps, fails, hashes, events, maxTable, maxAny, settleT, settledVol, flipped, shapePct, freeOut, freeAt };
}

/** Triangles whose normal turned > 120 degrees from its rest normal (after the best-fit rotation is removed). */
function flippedVsRest(b: SoftBody): number {
  const n = b.vertexCount, P = b.positions, Q = b.restLocal, tris = b.indices;
  let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
  for (let i = 0; i < n; i++) { px += P[i * 3]; py += P[i * 3 + 1]; pz += P[i * 3 + 2]; qx += Q[i * 3]; qy += Q[i * 3 + 1]; qz += Q[i * 3 + 2]; }
  px /= n; py /= n; pz /= n; qx /= n; qy /= n; qz /= n;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - px, y = P[i * 3 + 1] - py, z = P[i * 3 + 2] - pz, a = Q[i * 3] - qx, bb = Q[i * 3 + 1] - qy, c = Q[i * 3 + 2] - qz;
    A[0] += x * a; A[1] += x * bb; A[2] += x * c; A[3] += y * a; A[4] += y * bb; A[5] += y * c; A[6] += z * a; A[7] += z * bb; A[8] += z * c;
  }
  const Rm = polar(A);
  const nrm = (src: ArrayLike<number>, t: number): [number, number, number] => {
    const a = tris[t] * 3, c = tris[t + 1] * 3, d = tris[t + 2] * 3;
    const ux = src[c] - src[a], uy = src[c + 1] - src[a + 1], uz = src[c + 2] - src[a + 2], vx = src[d] - src[a], vy = src[d + 1] - src[a + 1], vz = src[d + 2] - src[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  let flipped = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const c = nrm(P, t), r = nrm(Q, t);
    const rx = Rm[0] * r[0] + Rm[1] * r[1] + Rm[2] * r[2], ry = Rm[3] * r[0] + Rm[4] * r[1] + Rm[5] * r[2], rz = Rm[6] * r[0] + Rm[7] * r[1] + Rm[8] * r[2];
    if (c[0] * rx + c[1] * ry + c[2] * rz < Math.cos((120 * Math.PI) / 180)) flipped++;
  }
  return flipped;
}

/**
 * step() and the per-frame input calls (fingerMove, fingerPressure, grabMove) allocate nothing once compiled, measured EXACTLY: the growth
 * of V8's new space over a window of frames (a window that allocates nothing cannot trigger a GC) minus what the measurement itself
 * allocates (an empty window). One warmed body walks through every steady state (the first gets 2400 frames: V8 compiles the once-per-frame
 * functions step() and finalize() last; the states with an input call every frame get 3000, the calls V8 needs before it compiles
 * fingerMove / grabMove), then the smallest of 3 windows of 120 frames counts. The per-frame inputs are generated BEFORE
 * the window, so the window's own loop allocates nothing. (A sampling heap profiler cannot prove zero: it charges its own bookkeeping to
 * whatever function is running.)
 */
/** Physics round 2: every material family allocates nothing per frame once compiled (memory arm, air bleed, slosh, jam, strands), pressed
 *  and rubbed on the DOLLOP shape: exact new-space growth per 120 frames, best of 3 windows, per family. */
function familyAllocCheck(starter: Genome): Array<{ fam: string; bytes: number }> {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const empty: number[] = [];
  for (let k = 0; k < 6; k++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1];
  const ev: SoftEvent[] = [];
  for (let i = 0; i < 64; i++) ev.push(ev[0]);
  ev.length = 0;
  const rub: V3[] = [], prs: unknown[] = [null];
  for (let i = 0; i < 2400; i++) { rub.push(v3(0.15 + 0.06 * Math.sin(i * 0.05), 0.8, 0.06 * Math.cos(i * 0.05))); prs.push(0.8 + 0.2 * Math.sin(i * 0.1)); }
  const out: Array<{ fam: string; bytes: number }> = [];
  for (const fam of MATERIAL_FAMILY_IDS) {
    const b = new SoftBody(starter, { family: fam });
    b.warmUp();
    let i = 0;
    const frame = (): void => { b.fingerMove(0, rub[i % 2400]); b.fingerPressure(0, prs[(i % 2400) + 1] as number); i++; b.step(DT); ev.length = 0; b.drainEvents(ev); };
    touch(b, 0, v3(0.15, 4, 0), v3(0, -1, 0));
    for (let k = 0; k < 3000; k++) frame();   // 50 s: each family's first body in this process still tiers up (900 frames left ~1.8 KB / frame for all, gel included)
    let best = Infinity;
    for (let w = 0; w < 3; w++) { const u0 = newUsed(); for (let k = 0; k < 120; k++) frame(); const d = newUsed() - u0; if (d >= 0 && d < best) best = d; }
    out.push({ fam, bytes: best - base });
  }
  return out;
}

interface CeremonyResult { foldSph: number; restSph: number; foldVol: number; foldMove: number; backErr: number; moveErr: number; moveSph: number; burstVol: number; burstErr: number; hostileOk: boolean; det: boolean }
/** The ceremony drivers (contracts.ts SoftBodyLike, DESIGN.md 6.4) on the starter: fold into a ball and back, slide to a pad, tremble,
 *  burst open; then hostile values; and the same script twice gives the same hash. */
function ceremonyChecks(starter: Genome): CeremonyResult {
  const script = (): { r: CeremonyResult; hash: number } => {
    const b = new SoftBody(starter);
    const runF = (s: number, f?: () => void): void => { for (let i = 0; i < Math.round(s / DT); i++) { f?.(); b.step(DT); } };
    const sph = (): number => { const P = b.positions, c = b.center; let m = 0, m2 = 0; for (let i = 0; i < b.vertexCount; i++) { const d = Math.hypot(P[i * 3] - c.x, P[i * 3 + 1] - c.y, P[i * 3 + 2] - c.z); m += d; m2 += d * d; } m /= b.vertexCount; return Math.sqrt(Math.max(0, m2 / b.vertexCount - m * m)) / m; };
    const prev = new Float32Array(b.positions.length);
    const move = (): number => { let m = 0; for (let i = 0; i < b.vertexCount; i++) m = Math.max(m, Math.hypot(b.positions[i * 3] - prev[i * 3], b.positions[i * 3 + 1] - prev[i * 3 + 1], b.positions[i * 3 + 2] - prev[i * 3 + 2])); prev.set(b.positions); return m; };
    runF(1);
    const r: CeremonyResult = { foldSph: 0, restSph: sph(), foldVol: 0, foldMove: 0, backErr: 0, moveErr: 0, moveSph: 0, burstVol: 0, burstErr: 0, hostileOk: false, det: false };
    prev.set(b.positions);
    b.setFold(1); runF(1.5, () => { r.foldMove = Math.max(r.foldMove, move() / b.restRadius); });
    r.foldSph = sph(); r.foldVol = b.metrics.volume;
    b.setFold(0); runF(1.5); r.backErr = shapeFit(b);
    b.moveTo(v3(0.5, 0.5, -0.3), 1); b.tremble(0.4); runF(3); b.tremble(0); runF(0.5);
    r.moveErr = Math.hypot(b.center.x - 0.5, b.center.z + 0.3); r.moveSph = shapeFit(b);
    b.moveTo(null);
    b.burstOpen(1); runF(2, () => { r.burstVol = Math.max(r.burstVol, b.metrics.volume); }); r.burstErr = shapeFit(b);
    for (const v of [NaN, Infinity, -Infinity, -5, 1e9, 'x', null, undefined, {}] as unknown[]) {
      b.setFold(v as number); b.tremble(v as number); b.burstOpen(v as number); b.moveTo(v as V3, v as number); b.moveTo({ x: v, y: v, z: v } as V3, v as number);
    }
    b.setFold(0); b.tremble(0); b.moveTo(null); runF(3);
    let fin = true; for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) fin = false;
    r.hostileOk = fin && b.debug.safetyResets === 0 && shapeFit(b) < 0.03;
    return { r, hash: b.stateHash() };
  };
  const a = script(), c = script();
  a.r.det = a.hash === c.hash;
  return a.r;
}

/** Per-family volume band (CONTRACT 4.2): a hard top squeeze and a hard pinch on the DOLLOP shape for every material family. */
function familyVolumeBands(starter: Genome): Array<{ fam: string; lo: number; min: number; max: number }> {
  return MATERIAL_FAMILY_IDS.map((fam) => {
    let min = 9, max = 0;
    for (const kind of ['top', 'pinch'] as const) {
      const b = new SoftBody(starter, { family: fam });
      run(b, 1);
      if (kind === 'top') touch(b, 0, v3(0.22, 4, 0), v3(0, -1, 0)); else { touch(b, 0, v3(-4, 0.34, 0), v3(1, 0, 0)); touch(b, 1, v3(4, 0.34, 0), v3(-1, 0, 0)); b.fingerPressure(1, 1); }
      b.fingerPressure(0, 1);
      run(b, 1.5, () => { min = Math.min(min, b.metrics.volume); max = Math.max(max, b.metrics.volume); });
      b.fingerUp(0); b.fingerUp(1);
      run(b, 3, () => { min = Math.min(min, b.metrics.volume); max = Math.max(max, b.metrics.volume); });
    }
    return { fam, lo: Math.min(0.85, 1 - MATERIAL_FAMILIES[fam].physics.volBleedMax - 0.05), min, max };
  });
}

function allocCheck(starter: Genome): { states: Array<{ name: string; bytes: number }> } {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const empty: number[] = [];
  for (let k = 0; k < 6; k++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1];   // the steady cost of one measurement (the very first call reads lower)
  const ev: SoftEvent[] = [];
  for (let i = 0; i < 64; i++) ev.push(ev[0]);   // pre-grown: draining never reallocates it
  ev.length = 0;
  const N = 2400 + 2 * 3000 + 4 * 1300;
  const rub: V3[] = [], prs: unknown[] = [null], pull: V3[] = [];   // a generic array of numbers: reading one never boxes
  for (let i = 0; i < N; i++) { rub.push(v3(0.15 + 0.06 * Math.sin(i * 0.05), 0.8, 0.06 * Math.cos(i * 0.05))); prs.push(0.8 + 0.2 * Math.sin(i * 0.1)); pull.push(v3(0, 0, 0)); }
  const b = new SoftBody(starter);
  b.warmUp();
  let i = 0, input = 0;
  const frame = (): void => {
    if (input === 1) { b.fingerMove(0, rub[i]); b.fingerPressure(0, prs[i + 1] as number); } else if (input === 2) b.grabMove(0, pull[i]);
    else if (input === 3) { b.setFold(prs[i + 1] as number); b.tremble(prs[i + 1] as number); b.moveTo(rub[i], 1); if (i % 30 === 0) b.burstOpen(0.5); }
    i++;
    b.step(DT);
  };
  const quiet = (n: number): void => { for (let k = 0; k < n; k++) { frame(); ev.length = 0; b.drainEvents(ev); } };
  const states: Array<{ name: string; warm: number; enter: () => void; leave: () => void; input: number }> = [
    { name: 'rest', warm: 2400, enter: () => {}, leave: () => {}, input: 0 },
    { name: 'press + rub (fingerMove + fingerPressure every frame)', warm: 3000, input: 1, enter: () => { touch(b, 0, v3(0.15, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 1); }, leave: () => b.fingerUp(0) },
    { name: 'pinch', warm: 600, input: 0, enter: () => { touch(b, 0, v3(-4, 0.35, 0), v3(1, 0, 0)); touch(b, 1, v3(4, 0.35, 0), v3(-1, 0, 0)); b.fingerPressure(0, 0.9); b.fingerPressure(1, 0.9); }, leave: () => { b.fingerUp(0); b.fingerUp(1); } },
    { name: 'pull (grabMove every frame)', warm: 3000, input: 2, enter: () => {
      const h = b.raycast(v3(3, 0.42, 0), v3(-1, 0, 0));
      if (h) { b.grab(0, h.vertex, h.point); for (let k = 0; k < N; k++) { pull[k].x = h.point.x + 0.25 + 0.1 * Math.sin(k * 0.04); pull[k].y = h.point.y; pull[k].z = h.point.z; } }
    }, leave: () => b.grabRelease(0) },
    { name: 'float (hover + bob)', warm: 600, input: 0, enter: () => { b.gravity = false; }, leave: () => { b.gravity = true; } },
    { name: 'mat corral (gliding back from a nudge)', warm: 600, input: 0, enter: () => {}, leave: () => {} },
    { name: 'ceremony drivers (setFold + tremble + moveTo every frame, a burstOpen every 30 frames)', warm: 1200, input: 3, enter: () => {}, leave: () => { b.setFold(0); b.tremble(0); b.moveTo(null); } },
  ];
  const out: Array<{ name: string; bytes: number }> = [];
  for (const st of states) {
    st.enter(); input = st.input;
    quiet(st.warm);
    let best = Infinity;
    for (let w = 0; w < 3; w++) {
      if (st.name.startsWith('mat corral')) { b.nudge(v3(12, 0, 0)); quiet(45); }
      const u0 = newUsed();
      for (let k = 0; k < 120; k++) frame();
      const d = newUsed() - u0;
      ev.length = 0; b.drainEvents(ev);
      if (d >= 0 && d < best) best = d;   // a negative growth means a GC ran inside the window: that window proves nothing
    }
    out.push({ name: st.name, bytes: best - base });
    st.leave(); input = 0; quiet(90);
  }
  return { states: out };
}


/** The API's edge cases (was verify_phys_cr_edge.ts): every named case must hold. */
function apiChecks(starter: Genome): { bad: string[]; tried: number } {
  const bad: string[] = [];
  let tried = 0;
  const check = (name: string, ok: boolean): void => { tried++; if (!ok) bad.push(name); };
  const finite = (b: SoftBody): boolean => { for (let i = 0; i < b.positions.length; i++) if (!Number.isFinite(b.positions[i])) return false; return true; };
  const ev: SoftEvent[] = [];
  {
    const b = new SoftBody(starter), pos = b.positions;
    for (const dt of [Infinity, -Infinity, 1e9, 1e-9]) { b.step(dt); check(`step(${dt}) finite`, finite(b)); }
    check('positions array identity kept by step()', b.positions === pos);
    b.reset(); check('positions array identity kept by reset()', b.positions === pos);
    check('raycast(null, null) is null', b.raycast(null as unknown as V3, null as unknown as V3) === null);
    check('raycast with a NaN direction is null', b.raycast(v3(0, 1, 3), v3(Number.NaN, 0, -1)) === null);
    check('raycast from an infinite origin is null', b.raycast(v3(Infinity, 1, 3), v3(0, 0, -1)) === null);
  }
  {
    const b = new SoftBody(starter);
    const top = b.raycast(v3(0, 3, 0), v3(0, -1, 0))!;
    const args = { point: top.point, normal: top.normal, dir: v3(0, -1, 0) };
    let threw = false;
    try { b.fingerUp(0); b.fingerUp(1); b.fingerDown(2 as 0, args); b.fingerUp(2 as 0); b.fingerUp(-1 as 0); b.fingerDown('0' as unknown as 0, args); } catch { threw = true; }
    check('bad finger ids are ignored without throwing', !threw && b.metrics.fingers === 0);
    b.fingerDown(0, args); b.fingerDown(0, args); run(b, 0.2);
    check('a second fingerDown on the same id keeps one finger', b.metrics.fingers === 1);
    b.fingerPressure(0, 1); run(b, 0.3);
    b.fingerDown(1, { point: v3(0.2, 0.2, 0.2), normal: v3(0.5, 0.5, 0.5), dir: v3(-0.5, -0.5, -0.5) });
    b.reset();
    b.drainEvents(ev);
    check('reset() mid-press: no fingers, no tips, no pending events', b.metrics.fingers === 0 && b.tip(0) === null && b.tip(1) === null && ev.length === 0);
    run(b, 1);
    check('reset() mid-press: the body rests', finite(b) && b.metrics.kinetic < 0.02);
    b.fingerUp(0); b.fingerPressure(0, 1); run(b, 0.3);
    check('fingerPressure after reset() (no finger down) is ignored', b.metrics.compression < 0.02);
  }
  {
    const b = new SoftBody(starter);
    for (const v of [-1, b.vertexCount, Number.NaN, Infinity]) { b.grab(0, v, v3(0, 1, 0)); check(`grab(vertex ${v}) is ignored`, !b.metrics.grabbed); }
    b.grab(0, 5, v3(Number.NaN, 1, 0)); check('grab with a NaN target is ignored', !b.metrics.grabbed);
    b.grab(2 as 0, 5, v3(0, 1, 0)); check('grab with a bad id is ignored', !b.metrics.grabbed);
    b.grabMove(0, v3(0, 1, 0)); b.grabRelease(0); b.grabRelease(1);
    ev.length = 0; b.drainEvents(ev); check('no events from ignored grab calls', ev.length === 0);
    b.grab(0, 320.7, v3(0, 1, 0)); run(b, 0.1); check('grab with a fractional vertex index works', b.metrics.grabbed);
    b.grab(0, 100, v3(0, 1, 0)); run(b, 0.1); check('a second grab on the same id works', b.metrics.grabbed && finite(b));
    b.reset(); check('reset() mid-grab releases it', !b.metrics.grabbed);
  }
  {
    const b = new SoftBody(starter);
    settle(b, 1);
    const h = b.stateHash();
    b.gravity = false;
    check('switching gravity is instant and keeps the shape (same hash)', b.stateHash() === h && b.gravity === false);
    b.gravity = true; check('the gravity getter reads back', b.gravity === true);
  }
  {
    const b = new SoftBody(starter);
    const top = b.raycast(v3(0, 3, 0), v3(0, -1, 0))!;
    const out: SoftEvent[] = [{ kind: 'poke', at: v3(0, 0, 0), normal: v3(0, 1, 0), intensity: 0, heldFor: 0, finger: 0 }];
    b.drainEvents(out); check('drainEvents appends (keeps what was there)', out.length === 1);
    b.fingerDown(0, { point: top.point, normal: top.normal, dir: v3(0, -1, 0) }); b.fingerPressure(0, 1); run(b, 0.5);
    b.drainEvents(out); const n1 = out.length; b.drainEvents(out);
    check('drainEvents clears the queue', n1 > 1 && out.length === n1);
    // 40 quick taps (3 frames down, 1 up): one poke and one release per tap, never two of a kind within 50 ms
    const c = new SoftBody(starter);
    const t2 = c.raycast(v3(0, 3, 0), v3(0, -1, 0))!;
    const log: Array<{ t: number; k: string }> = [];
    let clock = 0;
    for (let k = 0; k < 40; k++) {
      c.fingerDown(0, { point: t2.point, normal: t2.normal, dir: v3(0, -1, 0) }); c.fingerPressure(0, 1);
      for (let i = 0; i < 4; i++) { if (i === 3) c.fingerUp(0); c.step(DT); clock += DT; ev.length = 0; c.drainEvents(ev); for (const e of ev) log.push({ t: clock, k: e.kind + e.finger }); }
    }
    const spam = log.some((e, i) => log.slice(0, i).some((p) => p.k === e.k && e.t - p.t < 0.0499));
    check('40 quick taps: one poke per tap, no event spam', log.filter((e) => e.k === 'poke0').length === 40 && !spam);
  }
  return { bad, tried };
}

/** Rubbing (was verify_phys_rub.ts): 24 rubs across the top, pressure 0.2 / 0.5 / 0.8, 0.25 .. 2 m/s, two lines; how far the body is
 *  dragged (centre, 2.5 s after the finger lifted) and whether its foot ever leaves the table. */
function rubChecks(starter: Genome): { drift: number; lift: number; worst: string } {
  let drift = 0, lift = 0, worst = '';
  for (const press of [0.2, 0.5, 0.8]) for (const dur of [0.3, 0.6, 1.2, 2.4]) for (const z of [0, 0.25]) {
    const b = new SoftBody(starter);
    const x0 = -0.3, x1 = 0.3;
    const h0 = b.raycast(v3(x0, 3, z), v3(0, -1, 0));
    if (!h0) continue;
    b.fingerDown(0, { point: h0.point, normal: h0.normal, dir: v3(0, -1, 0) });
    const T0 = 0.4, T1 = T0 + dur;
    let up = false, footMax = 0;
    for (let s = 0, t = 0; t < T1 + 2.5; s++) {
      if (t < T1) {
        b.fingerPressure(0, Math.min(1, t / 0.4) * press);
        if (t > T0) { const k = (t - T0) / dur, h = b.raycast(v3(x0 + (x1 - x0) * k, 3, z), v3(0, -1, 0)); if (h) b.fingerMove(0, h.point); }
      } else if (!up) { up = true; b.fingerUp(0); }
      b.step(DT); t = (s + 1) * DT;
      footMax = Math.max(footMax, minY(b));
    }
    const d = Math.hypot(b.center.x, b.center.z);
    if (d > drift) { drift = d; worst = `pressure ${press}, ${((x1 - x0) / dur).toFixed(2)} m/s, z=${z}`; }
    lift = Math.max(lift, footMax);
  }
  return { drift, lift, worst };
}


/** metrics.press / metrics.reaction (contracts.ts round 2, PHYS fills them in; they were never set before round 3). */
function pressReaction(starter: Genome): { restPress: number; restReact: number; dentPress: number; dentComp: number; afterLift: number; firm: number; soft: number; inRange: boolean } {
  let inRange = true;
  const watch = (b: SoftBody): void => { const p = b.metrics.press ?? -1, r = b.metrics.reaction ?? -1; if (!(p >= 0 && p <= 1 && r >= 0 && r <= 1)) inRange = false; };
  const b = new SoftBody(starter);
  settle(b, 0.5);
  const restPress = b.metrics.press ?? -1, restReact = b.metrics.reaction ?? -1;
  // a side press on the swirl-peak: a single-finger dent that the global compression barely sees
  touch(b, 0, v3(-4, 0.9, 0), v3(1, 0, 0)); b.fingerPressure(0, 1);
  let dentPress = 0, dentComp = 0;
  run(b, 0.8, () => { watch(b); dentPress = Math.max(dentPress, b.metrics.press ?? 0); dentComp = Math.max(dentComp, b.metrics.compression); });
  b.fingerUp(0);
  run(b, 0.1, () => watch(b));
  const afterLift = b.metrics.press ?? -1;
  // the same held side press on a firm and a soft body: the push-back
  const held = (g: Genome): number => { const c = new SoftBody(g); settle(c, 0.5); touch(c, 0, v3(4, 0.4, 0), v3(-1, 0, 0)); c.fingerPressure(0, 1); run(c, 1, () => watch(c)); return c.metrics.reaction ?? 0; };
  const firm = held(quantizeGenome({ ...starter, firmness: 1 })), soft = held(quantizeGenome({ ...starter, firmness: 0 }));
  return { restPress, restReact, dentPress, dentComp, afterLift, firm, soft, inRange };
}

/** The round-5 rows (sliding fingers, sane-gesture fuzz) from the pool results. */
function round5Rows(results: JobResult[], add: (gate: string, what: string, value: string, limit: string, pass: boolean) => void, f2: (x: number, d?: number) => string): void {
  const sl = results.filter((r): r is Extract<JobResult, { type: 'slide' }> => r.type === 'slide').map((r) => r.res);
  const slideRow = (prefix: string, what: string, was: string): void => {
    const rs = sl.filter((r) => r.label.startsWith(prefix)), done = rs.filter((r) => !r.missed && !r.pull);
    if (!rs.length) return;
    if (ROUND5_DETAIL) for (const r of done) if (r.f120 > 0 || r.worst > 115) console.log(`  ${r.label}: worst ${f2(r.worst, 1)}, ${r.f120} frames over 120 (longest ${r.longest})`);
    const w = done.reduce((a, c) => (c.worst > a.worst ? c : a)), l = done.reduce((a, c) => (c.longest > a.longest ? c : a)), rw = done.reduce((a, c) => (c.restWorst > a.restWorst ? c : a));
    const f120 = done.reduce((a, c) => a + c.f120, 0), presses = done.filter((r) => r.f120 > 0).length, missed = rs.filter((r) => r.missed).length;
    add('G1', `${what} (${done.length} gestures${rs.length - done.length - missed ? `, ${rs.length - done.length - missed} outward drags skipped: the shell makes them pulls` : ''}; ${was}): frames over 120 deg (in how many gestures; longest run: ${l.label}), sharpest crease (${w.label}), missed rays; left at rest`,
      `${f120} frames in ${presses} (longest ${l.longest}), ${f2(w.worst, 0)} deg, ${missed} missed; rest ${f2(rw.restWorst, 0)} deg, ${done.reduce((a, c) => a + c.restN90, 0)} edges over 90, ${done.reduce((a, c) => a + c.restInward, 0)} inward`,
      `0 frames, <= ${SLIDE_WORST_MAX} deg, 0 missed; rest <= ${FOLD_REST_MAX} deg, 0, 0`,
      f120 === 0 && w.worst <= SLIDE_WORST_MAX && missed === 0 && rw.restWorst <= FOLD_REST_MAX && done.every((r) => r.restN90 === 0 && r.restInward === 0));
  };
  slideRow('rub/', 'camera-plane rubs from the swirl-peak base down the front flank (game camera, shell pressure profile capped at 0.7, 5 screen directions x 1.5 / 2 / 2.5 / 3 m/s x 3 start points x starter, f0b0s0z0, f0b0s1z1)', 'before the fix (HEAD 6dff62e): 192 frames over 120 in 22 rubs, 45 in one, worst 180 deg');
  slideRow('slide/', 'slides toward the table (rubs that start on the lower half of the visible body and move down / sideways on screen at 1 and 2.5 m/s; 6 contact points x 5 directions x 4 genomes)', 'before the fix (HEAD 6dff62e): 26 frames over 120 in 6 slides, 11 in one, worst 178 deg: the foot rim pinched between the tip and the table, held at 110 by the contact fold limit and snapping past 150 at the lift');
  slideRow('holdrub/', 'two fingers: one holds (shell profile), the other lands beside it and rubs toward, away and across at 1 and 2 m/s (4 point pairs x 4 directions x 3 genomes)', 'before the fix (HEAD 6dff62e): 24 frames over 120 in 6, 9 in one, worst 177 deg');
  const sn = results.filter((r): r is Extract<JobResult, { type: 'sane' }> => r.type === 'sane').map((r) => r.res);
  if (!sn.length) return;
  if (ROUND5_DETAIL) for (const r of sn) console.log(`  sane/${r.label}: ${r.f120} frames over 120, ${r.episodes} episodes, longest ${r.longest}, worst ${f2(r.worst, 1)} (${r.worstAt})${r.fails.length ? ', ' + r.fails.join('; ') : ''}`);
  const snFrames = sn.reduce((a, c) => a + c.frames, 0), snF120 = sn.reduce((a, c) => a + c.f120, 0), snLong = sn.reduce((a, c) => (c.longest > a.longest ? c : a)), snWorst = sn.reduce((a, c) => (c.worst > a.worst ? c : a));
  add('G1', `sane-gesture fuzz (what the shell can send: camera rays, the shell pressure profile, holds, rubs capped at 0.7 and never outward, two fingers, grab-pulls up to 1.2 R, dt 1/120..1/30; ${sn.length} genomes x ${SANE_FRAMES} frames; before the fix (HEAD 6dff62e, full run): 152 of 30000 frames over 120 (5.07 per mille), 24 episodes, longest 31 frames, worst 180 deg): frames over 120 deg, episodes, longest episode (${snLong.label}), sharpest crease (${snWorst.label} ${snWorst.worstAt}), failures`,
    `${snF120} of ${snFrames} frames (${f2((snF120 / Math.max(1, snFrames)) * 1000, 2)} per mille), ${sn.reduce((a, c) => a + c.episodes, 0)} episodes, longest ${snLong.longest} frames, ${f2(snWorst.worst, 0)} deg, ${sn.reduce((a, c) => a + c.fails.length, 0)} failures`,
    `<= ${SANE_F120_PER_MILLE} per mille, longest <= ${SANE_LONGEST_MAX} frames, 0 failures`,
    snF120 / Math.max(1, snFrames) * 1000 <= SANE_F120_PER_MILLE && snLong.longest <= SANE_LONGEST_MAX && sn.every((r) => r.fails.length === 0));
}
/** The hostile-fuzz rows (shared by the full run and `--hostile-only`). */
function hostileRows(results: JobResult[], add: (gate: string, what: string, value: string, limit: string, pass: boolean) => void, f2: (x: number, d?: number) => string): void {
  const ho = results.filter((r): r is Extract<JobResult, { type: 'hostile' }> => r.type === 'hostile');
  const hf = ho.flatMap((r) => r.res.fails.map((f) => `${r.res.label}: ${f}`));
  const det = ho.filter((r) => r.replayHashes).every((r) => r.replayHashes!.length === r.res.hashes.length && r.replayHashes!.every((h, i) => h === r.res.hashes[i]));
  add('G1', `hostile fuzz (the independent verifier's, was verify_phys_fuzz.ts): ${HOSTILE_RUNS} runs on the 16 extreme genomes x ${HOSTILE_STEPS} frames, fingers anywhere, pressure flicker, crossing fingers, far grabs, nudges up to 1e6, dt in {0, 0.5, 5, 1/240..1/10}; ${ho.reduce((a, c) => a + c.res.events, 0)} events checked; every frame finite, not inverted, not under the table, valid events, no spam; settles, volume, no flipped triangle, shape`, hf.length ? hf.slice(0, 4).join('; ') : `0 failures (slowest settle ${f2(Math.max(...ho.map((r) => r.res.settleT)), 2)} s, worst shape ${f2(Math.max(...ho.map((r) => r.res.shapePct)), 2)} % R)`, '0 failures', hf.length === 0);
  add('G1', 'hostile fuzz determinism: 4 genomes replayed -> identical stateHash at every checkpoint', `${det}`, 'true', det);
  add('info', 'hostile fuzz: farthest horizontal centre excursion on the table / in any mode (float mode is unchanged by the corral and has no rim; a grab, the pinned feet or a fingertip touching the body may hold it anywhere)', `${f2(Math.max(...ho.map((r) => r.res.maxTable)), 2)} m / ${f2(Math.max(...ho.map((r) => r.res.maxAny)), 2)} m`, '(information)', true);
  const wf = ho.reduce((a, c) => (c.res.freeOut > a.res.freeOut ? c : a));
  add('G1', `hostile fuzz, mat corral: while NOTHING holds the body (gravity on, no grab or pinned feet, no fingertip that can have touched it at any time in the frame: bounded from the frame ends, see hostileRun) its centre never moves outward past the 2.5 m rim or past where it was let go, whichever is farther (${wf.res.label} ${wf.res.freeAt}; was 232 mm before the repair, f1b1s0z1 out to 2.73 m: a finger that was down but no longer touching the shoved body switched the corral off)`, `${f2(Math.max(0, wf.res.freeOut) * 1000, 0)} mm`, '<= 50 mm', wf.res.freeOut <= 0.05);
}
/** The per-family hostile fuzz rows (physics round-2 fix round): each run listed, then one gate. */
function famHostileRows(results: JobResult[], add: (gate: string, what: string, value: string, limit: string, pass: boolean) => void, f2: (x: number, d?: number) => string): void {
  const fh = results.filter((r): r is Extract<JobResult, { type: 'famhostile' }> => r.type === 'famhostile');
  for (const r of fh) console.log(`  ${r.res.label.padEnd(34)} ${r.res.fails.length ? 'FAIL ' + r.res.fails.join('; ') : 'ok  '} settle ${f2(r.res.settleT, 2)} s, volume ${f2(r.res.settledVol, 4)}, flipped ${r.res.flipped}, shape ${f2(r.res.shapePct, 2)} % R${r.elastic ? '' : ' (plastic / slow: shape not gated)'}, ${r.res.events} events`);
  const hf = fh.flatMap((r) => r.res.fails.map((f) => `${r.res.label}: ${f}`));
  // physics fix round 2 (the verifier's MINOR-15): part of the default run (fewer frames under --quick), and every 4th run is replayed
  const rep = fh.filter((r) => r.replayHashes), det = rep.every((r) => r.replayHashes!.length === r.res.hashes.length && r.replayHashes!.every((h, i) => h === r.res.hashes[i]));
  if (rep.length) add('G1', `per-family hostile fuzz determinism: ${rep.length} runs replayed (${rep.map((r) => r.res.label).join(', ')}) -> identical stateHash at every checkpoint`, `${det}`, 'true', det);
  add('G1', `per-family hostile fuzz: ${MATERIAL_FAMILY_IDS.length} families x 2 genomes (the family's first species on its template genome, and an extreme corner genome on DOLLOP) x ${fh[0]?.res.steps ?? FAM_HOSTILE_STEPS} frames of the hostile fuzz above; every frame finite, not inverted, not under the table, valid events, no spam; then settles in 8 s with volume 1 +/- 0.015 and no flipped triangle, and an elastic family's shape back within 3% R`, hf.length ? hf.slice(0, 4).join('; ') : `0 failures (slowest settle ${f2(Math.max(...fh.map((r) => r.res.settleT)), 2)} s, worst elastic shape ${f2(Math.max(...fh.filter((r) => r.elastic).map((r) => r.res.shapePct)), 2)} % R)`, '0 failures', hf.length === 0);
}
/** The round-5 jobs. */
function round5Jobs(starter: Genome): Job[] {
  const jobs: Job[] = [];
  const on = (k: string): boolean => !ROUND5_ONLY || ROUND5_SEL.includes(k);
  for (const spec of [...(on('rub') ? camRubSpecs(starter) : []), ...(on('slide') ? slideTableSpecs(starter) : []), ...(on('holdrub') ? holdRubSpecs(starter) : [])]) jobs.push({ type: 'slide', spec });
  if (on('sane')) for (const [i, gname] of ['starter', 'f0b0s0z0', 'f0b0s1z1', 'f1b1s1z1', 'f0b1s0z0'].entries()) jobs.push({ type: 'sane', gname, frames: SANE_FRAMES, seed: 0x5a9e0000 + i * 7919 });
  return jobs;
}

// ------------------------------------------------------------------------------------------------ worker pool

type Job = { type: 'squeeze'; spec: SqueezeSpec } | { type: 'fuzz'; index: number; nEvents: number } | { type: 'fold'; spec: FoldSpec }
  | { type: 'fold2'; spec: FoldSpec } | { type: 'foldsub'; spec: FoldSpec } | { type: 'corral'; spec: CorralSpec } | { type: 'hostile'; index: number; steps: number; replay: boolean } | { type: 'famhostile'; fi: number; gi: number; steps?: number; replay?: boolean }
  | { type: 'dense'; spec: DenseSpec } | { type: 'slide'; spec: SlideSpec } | { type: 'sane'; gname: string; frames: number; seed: number };
type JobResult = { type: 'squeeze'; res: SqueezeResult } | { type: 'fuzz'; res: { stats: FuzzStats; hash: number } } | { type: 'fold'; res: FoldResult }
  | { type: 'fold2'; res: FoldResult } | { type: 'foldsub'; res: SubFoldResult } | { type: 'corral'; res: CorralResult } | { type: 'hostile'; res: HostileResult; replayHashes: number[] | null } | { type: 'famhostile'; res: HostileResult; elastic: boolean; replayHashes?: number[] | null }
  | { type: 'dense'; res: FoldResult } | { type: 'slide'; res: SlideResult } | { type: 'sane'; res: SaneResult };
function runJob(j: Job): JobResult {
  switch (j.type) {
    case 'squeeze': return { type: 'squeeze', res: hardRelease(j.spec) };
    case 'fold': return { type: 'fold', res: foldPress(j.spec) };
    case 'fuzz': return { type: 'fuzz', res: fuzzRun(j.index, j.nEvents) };
    case 'fold2': return { type: 'fold2', res: foldPress(j.spec) };
    case 'foldsub': return { type: 'foldsub', res: foldSubsteps(j.spec) };
    case 'corral': return { type: 'corral', res: corralRun(j.spec) };
    case 'hostile': return { type: 'hostile', res: hostileRun(j.index, j.steps), replayHashes: j.replay ? hostileRun(j.index, j.steps).hashes : null };
    case 'famhostile': {
      const sp = famHostileSpec(j.fi, j.gi), steps = j.steps ?? FAM_HOSTILE_STEPS;
      return { type: 'famhostile', res: hostileRun(1000 + j.fi * 2 + j.gi, steps, sp), elastic: sp.elastic, replayHashes: j.replay ? hostileRun(1000 + j.fi * 2 + j.gi, steps, famHostileSpec(j.fi, j.gi)).hashes : null };
    }
    case 'dense': return { type: 'dense', res: densePress(j.spec) };
    case 'slide': return { type: 'slide', res: slidePress(j.spec) };
    case 'sane': return { type: 'sane', res: saneFuzz(j.gname, makeStarterGenome(), j.frames, j.seed) };
  }
}

if (!isMainThread) {
  const { jobs } = workerData as { jobs: Job[] };
  const out: JobResult[] = jobs.map(runJob);
  parentPort!.postMessage(out);
} else if (process.argv.includes('--cold-child')) {
  coldChild(process.argv.includes('warm'));   // a fresh process for the cold-JIT measurement (see coldRuns)
} else if (process.argv.includes('--late-press-child')) {
  latePressChild();
} else {
  await main();
}

function runPool(jobs: Job[], nWorkers: number): Promise<JobResult[]> {
  // heaviest first, round robin, so the workers finish together
  const weight = (j: Job): number => (j.type === 'sane' ? 40 : j.type === 'famhostile' ? 15 : j.type === 'hostile' ? (j.replay ? 24 : 12) : j.type === 'fuzz' ? 3 : j.type === 'fold' ? (j.spec.detail >= 4 ? 4 : 1.5) : j.type === 'fold2' || j.type === 'foldsub' ? (j.spec.detail >= 4 ? 4 : 1.5) : 1);
  const order = jobs.map((j, i) => ({ j, i })).sort((a, b) => weight(b.j) - weight(a.j));
  const buckets: Array<Array<{ j: Job; i: number }>> = Array.from({ length: nWorkers }, () => []);
  order.forEach((o, k) => buckets[k % nWorkers].push(o));
  const results: JobResult[] = new Array(jobs.length);
  return Promise.all(buckets.map((bk) => new Promise<void>((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: bk.map((x) => x.j) } });
    w.once('message', (out: JobResult[]) => { out.forEach((r, k) => { results[bk[k].i] = r; }); res(); });
    w.once('error', rej);
  }))).then(() => results);
}

// ------------------------------------------------------------------------------------------------ main

interface Row { gate: string; what: string; value: string; limit: string; pass: boolean }
async function main(): Promise<void> {
  const t0 = performance.now();
  const rows: Row[] = [];
  const add = (gate: string, what: string, value: string, limit: string, pass: boolean): void => { rows.push({ gate, what, value, limit, pass }); };
  const f2 = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));

  const starter = makeStarterGenome();
  const corner = (f: number, bo: number, s: number, size = 0.5): Genome => quantizeGenome({ ...starter, firmness: f, bounce: bo, stretch: s, size });
  const genomes: Array<{ name: string; g: Genome; highBounce: boolean }> = [{ name: 'starter', g: starter, highBounce: true }];
  for (const f of [0, 1]) for (const bo of [0, 1]) for (const s of [0, 1]) genomes.push({ name: `f${f}b${bo}s${s}`, g: corner(f, bo, s), highBounce: bo === 1 });
  genomes.push({ name: 'small', g: quantizeGenome({ ...starter, size: 0 }), highBounce: true });
  genomes.push({ name: 'large', g: quantizeGenome({ ...starter, size: 1 }), highBounce: true });

  // `--round5`: only the round-5 rows (sliding fingers, sane-gesture fuzz), e.g. to run them against an older tree
  if (HOSTILE_ONLY) {
    const jobs: Job[] = [];
    for (let i = 0; i < HOSTILE_RUNS; i++) jobs.push({ type: 'hostile', index: i, steps: HOSTILE_STEPS, replay: i % 4 === 0 });
    hostileRows(await runPool(jobs, 4), add, f2);
    for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.gate.padEnd(4)}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`);
    const failed = rows.filter((r) => !r.pass).length;
    console.log(`${rows.length - failed}/${rows.length} hostile-fuzz checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(failed ? 1 : 0);
  }
  if (FAM_HOSTILE_ONLY) {
    const jobs: Job[] = [];
    for (let fi = 0; fi < MATERIAL_FAMILY_IDS.length; fi++) for (const gi of [0, 1]) jobs.push({ type: 'famhostile', fi, gi, replay: (fi * 2 + gi) % 4 === 0 });
    famHostileRows(await runPool(jobs, 2), add, f2);
    for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.gate.padEnd(4)}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`);
    const failed = rows.filter((r) => !r.pass).length;
    console.log(`${rows.length - failed}/${rows.length} per-family hostile-fuzz checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(failed ? 1 : 0);
  }
  if (ROUND5_ONLY) {
    round5Rows(await runPool(round5Jobs(starter), 4), add, f2);
    for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.gate.padEnd(4)}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`);
    const failed = rows.filter((r) => !r.pass).length;
    console.log(`${rows.length - failed}/${rows.length} round-5 checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(failed ? 1 : 0);
  }

  // ---- single-thread checks first (they also give the machine a moment before the perf measurement)

  // events + metrics + raycast (CONTRACT section 4)
  {
    const log: Array<{ t: number; e: SoftEvent }> = [];
    let clock = 0;
    const buf: SoftEvent[] = [];
    const go = (b: SoftBody, secs: number, each?: () => void): void => run(b, secs, () => { clock += DT; each?.(); b.drainEvents(buf); for (const e of buf) log.push({ t: clock, e }); buf.length = 0; });
    const ev = (k: string) => log.filter((x) => x.e.kind === k);
    const b = new SoftBody(starter);
    go(b, 1.2);
    const m0 = { ...b.metrics };
    add('G1', 'metrics at rest: kinetic, grounded, volume, compression, stretch', `${f2(m0.kinetic, 3)}, ${m0.grounded}, ${f2(m0.volume, 3)}, ${f2(m0.compression, 3)}, ${f2(m0.stretch, 3)}`, 'kinetic < 0.02, grounded, vol 1 +/- 0.01, comp < 0.05, stretch < 0.05', m0.kinetic < 0.02 && m0.grounded && Math.abs(m0.volume - 1) < 0.01 && m0.compression < 0.05 && m0.stretch < 0.05);
    const hit = b.raycast(v3(3, 0.3, 0), v3(-1, 0, 0));
    add('G1', 'raycast from +x hits the front surface with an outward normal and a nearest vertex', hit ? `n.x ${f2(hit.normal.x, 2)}, t ${f2(hit.t, 2)}, vertex ${hit.vertex}` : 'MISS', 'n.x > 0.5, t > 0', !!hit && hit.normal.x > 0.5 && hit.t > 0 && hit.vertex >= 0 && hit.vertex < b.vertexCount);
    add('G1', 'raycast aimed away from the body misses', `${b.raycast(v3(0, 5, 0), v3(0, 1, 0)) === null}`, 'true', b.raycast(v3(0, 5, 0), v3(0, 1, 0)) === null);

    // poke -> press -> release
    const tDown = clock;
    touch(b, 0, v3(0.22, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.8);
    let maxRate = -9, maxComp = 0, fingersSeen = 0;
    go(b, 0.7, () => { maxRate = Math.max(maxRate, b.metrics.compressionRate); maxComp = Math.max(maxComp, b.metrics.compression); fingersSeen = Math.max(fingersSeen, b.metrics.fingers); });
    const tUp = clock;
    b.fingerUp(0);
    let minRate = 9, kinMax = 0;
    go(b, 0.8, () => { minRate = Math.min(minRate, b.metrics.compressionRate); kinMax = Math.max(kinMax, b.metrics.kinetic); });
    const pokes = ev('poke'), presses = ev('press'), releases = ev('release');
    add('G1', 'events: one poke at first contact (finger 0), intensity > 0', `${pokes.length}, intensity ${f2(pokes[0]?.e.intensity ?? 0, 2)}, at t+${f2((pokes[0]?.t ?? 0) - tDown, 3)} s`, '1, > 0', pokes.length === 1 && pokes[0].e.finger === 0 && pokes[0].e.intensity > 0 && pokes[0].t - tDown < 0.12);
    add('G1', 'events: one press once the finger has held >= 0.18 s', `${presses.length}, at t+${f2((presses[0]?.t ?? 0) - tDown, 3)} s`, '1, 0.18..0.35 s', presses.length === 1 && presses[0].t - tDown >= 0.17 && presses[0].t - tDown < 0.4);
    add('G1', "events: the 'press' event carries heldFor = 0 (contracts.ts: heldFor is for release / snap only; it used to carry the hold time)", presses.map((x) => x.e.heldFor.toFixed(3)).join(', ') || 'no press', '0', presses.length === 1 && presses.every((x) => x.e.heldFor === 0));
    add('G1', 'events: one release on fingerUp with intensity = compression > 0.08 and heldFor ~ press time', `${releases.length}, intensity ${f2(releases[0]?.e.intensity ?? 0, 2)}, heldFor ${f2(releases[0]?.e.heldFor ?? 0, 2)} s (pressed ${f2(tUp - tDown, 2)} s)`, '1, > 0.08, +/-0.05 s', releases.length === 1 && releases[0].e.intensity > 0.08 && Math.abs(releases[0].e.heldFor - (tUp - tDown)) < 0.05);
    add('G1', 'metrics: fingers = 1 while pressed; compression and compressionRate rise while squeezing, rate goes negative after release', `fingers ${fingersSeen}, max comp ${f2(maxComp, 2)}, max rate ${f2(maxRate, 2)}, min rate ${f2(minRate, 2)}`, 'fingers 1, comp > 0.2, rate > 0.2 then < -0.5', fingersSeen === 1 && maxComp > 0.2 && maxRate > 0.2 && minRate < -0.5);
    add('G1', 'metrics: kinetic jumps right after a hard release (> 0.3)', f2(kinMax, 2), '> 0.3', kinMax > 0.3);

    // grab -> snap
    const b3 = new SoftBody(starter);
    go(b3, 1);
    const h3 = b3.raycast(v3(3, 0.42, 0), v3(-1, 0, 0))!;
    const tGrab = clock;
    b3.grab(0, h3.vertex, h3.point);
    let maxStretch = 0, minV = 9, maxV = 0, grabbedSeen = false, step = 0;
    go(b3, 1.0, () => {
      step++;
      const k = Math.min(1, step / 36);
      b3.grabMove(0, v3(h3.point.x + 0.9 * k, h3.point.y + 0.3 * k, h3.point.z));
      maxStretch = Math.max(maxStretch, b3.metrics.stretch); minV = Math.min(minV, b3.metrics.volume); maxV = Math.max(maxV, b3.metrics.volume); grabbedSeen = grabbedSeen || b3.metrics.grabbed;
    });
    const tRel = clock;
    b3.grabRelease(0);
    go(b3, 1.5);
    const grabs = ev('grab').filter((x) => x.t > tGrab), snaps = ev('snap').filter((x) => x.t >= tRel);
    add('G1', 'events/metrics: grab emits "grab" and metrics.grabbed; the pull stretches (stretch > 0.15, volume ~1); release emits "snap"', `grab ${grabs.length}, grabbed ${grabbedSeen}, max stretch ${f2(maxStretch, 2)}, vol ${f2(minV, 3)}..${f2(maxV, 3)}, snap ${snaps.length} (intensity ${f2(snaps[0]?.e.intensity ?? 0, 2)}), grabbed after ${b3.metrics.grabbed}`, 'all', grabs.length === 1 && grabbedSeen && maxStretch > 0.15 && minV > 0.95 && maxV < 1.05 && snaps.length === 1 && snaps[0].e.intensity > 0.05 && !b3.metrics.grabbed);

    // land
    const b4 = new SoftBody(starter);
    b4.gravity = false; b4.reset();
    go(b4, 1.5);
    const t4 = clock;
    const gz = b4.metrics.grounded;
    b4.gravity = true;
    go(b4, 1.6);
    const lands = ev('land').filter((x) => x.t > t4);
    add('G1', 'events/metrics: float -> gravity: a "land" when it reaches the table; grounded false while hovering, true after', `lands ${lands.length} (intensity ${f2(lands[0]?.e.intensity ?? 0, 2)}), hovering grounded ${gz}, after ${b4.metrics.grounded}`, 'lands 1..2, false -> true', lands.length >= 1 && lands.length <= 2 && lands[0].e.intensity > 0.1 && !gz && b4.metrics.grounded);

    // two fingers
    const b5 = new SoftBody(starter);
    go(b5, 1);
    touch(b5, 0, v3(-4, 0.34, 0), v3(1, 0, 0)); touch(b5, 1, v3(4, 0.34, 0), v3(-1, 0, 0));
    b5.fingerPressure(0, 0.8); b5.fingerPressure(1, 0.8);
    go(b5, 0.5);
    add('G1', 'metrics: two fingers down -> fingers = 2, compression along the pinch axis > 0.1', `fingers ${b5.metrics.fingers}, compression ${f2(b5.metrics.compression, 2)}`, '2, > 0.1', b5.metrics.fingers === 2 && b5.metrics.compression > 0.1);

    // no event spam anywhere in the log above
    const dirty = ['poke', 'press', 'release', 'land', 'grab', 'snap'].filter((k) => {
      const l = ev(k); for (let i = 1; i < l.length; i++) if (l[i].e.finger === l[i - 1].e.finger && l[i].t - l[i - 1].t < 0.049) return true; return false;
    });
    add('G1', 'events: never two of a kind from the same finger within 50 ms (whole log above)', dirty.length ? `spam: ${dirty.join(',')}` : `ok (${log.length} events)`, 'ok', dirty.length === 0);
  }

  // rubbing: the fingertip follows the pointer across the surface (fingerMove) and rises over the swirl-peak
  {
    const b = new SoftBody(starter);
    settle(b, 1);
    const h0 = b.raycast(v3(-0.25, 4, 0), v3(0, -1, 0))!;
    b.fingerDown(0, { point: h0.point, normal: h0.normal, dir: v3(0, -1, 0) }); b.fingerPressure(0, 0.4);
    let worstLag = 0, tipTop = -1, finite = true;
    for (let i = 0; i < 120; i++) {
      const x = -0.25 + 0.5 * Math.min(1, i / 90);
      const hit = b.raycast(v3(x, 4, 0), v3(0, -1, 0));
      if (hit) b.fingerMove(0, hit.point);
      b.step(DT);
      const t = b.tip(0);
      if (!t || !Number.isFinite(t.x + t.y + t.z)) { finite = false; continue; }
      if (i >= 30) worstLag = Math.max(worstLag, Math.abs(t.x - x));
      tipTop = Math.max(tipTop, t.y);
    }
    const lowestRef = h0.point.y;
    add('G1', 'rub: a fingertip dragged 0.5 m across the dome follows the pointer (worst x lag) and rises over the swirl-peak', `lag ${f2(worstLag, 3)} m, tip height ${f2(lowestRef, 2)} -> ${f2(tipTop, 2)} m, finite ${finite}`, 'lag < 0.05 m, rise > 0.1 m', finite && worstLag < 0.05 && tipTop - lowestRef > 0.1);
  }

  // peak flop under a side poke
  {
    const b = new SoftBody(starter);
    settle(b, 1.5);
    let peak = 0, pv = 0;
    for (let i = 0; i < b.vertexCount; i++) if (b.restLocal[i * 3 + 1] > peak) { peak = b.restLocal[i * 3 + 1]; pv = i; }
    const disp = new Float64Array(b.vertexCount);
    let best = 0;
    const ok = touch(b, 0, v3(-4, b.positions[pv * 3 + 1] - 0.1, b.positions[pv * 3 + 2]), v3(1, 0, 0));   // 10 cm below the swirl tip
    b.fingerPressure(0, 1);
    run(b, 0.25, () => { shapeFit(b, disp); best = Math.max(best, disp[pv]); });
    b.fingerUp(0);
    run(b, 1.2, () => { shapeFit(b, disp); best = Math.max(best, disp[pv]); });
    add('G1', 'peak flop: max displacement of the swirl tip from its rest place (rigid fit removed) under a side poke', `${f2(best / b.restRadius * 100, 1)} % R${ok ? '' : ' (poke missed!)'}`, '>= 25 % R', ok && best / b.restRadius >= 0.25);
  }

  // float mode
  {
    const b = new SoftBody(starter);
    b.gravity = false;
    b.reset();
    const R = b.restRadius, hoverY = R + 0.35;
    run(b, 3);
    const idle = { x: b.center.x, y: b.center.y, z: b.center.z };
    let maxDist = 0;
    const track = () => { maxDist = Math.max(maxDist, Math.hypot(b.center.x, b.center.z)); };
    touch(b, 0, v3(-4, b.center.y, 0), v3(1, 0, 0)); b.fingerPressure(0, 0.9);
    run(b, 0.3, track);
    b.fingerUp(0);
    run(b, 1.5, track);
    const dMid = Math.hypot(b.center.x, b.center.z);
    b.nudge(v3(3, 1, -2));
    run(b, 6.0, track);
    const endOff = Math.hypot(b.center.x, b.center.z), endDy = Math.abs(b.center.y - hoverY);
    add('G1', 'float mode: hover height at rest (centre y vs restRadius + 0.35, bob +/-0.03)', `${f2(idle.y, 3)} vs ${f2(hoverY, 3)}`, 'within 0.06', Math.abs(idle.y - hoverY) < 0.06);
    add('G1', 'float mode: farthest horizontal excursion from the origin after shoves', `${f2(maxDist, 3)} m`, '<= 1.5 m', maxDist <= 1.5);
    add('G1', 'float mode: back at hover 6 s after a hard nudge (horizontal offset, height error)', `${f2(endOff, 3)} m, ${f2(endDy, 3)} m`, '< 0.05 m, < 0.06 m', endOff < 0.05 && endDy < 0.06);
    add('info', 'float mode: horizontal offset 1.5 s after a finger shove', `${f2(dMid, 3)} m`, '(information)', true);
    b.gravity = true; run(b, 0.5); b.gravity = false; run(b, 0.5); b.gravity = true; run(b, 3);
    add('G1', 'gravity <-> float toggled 3x: still finite, shape error after settling', `${f2(shapeFit(b) * 100, 2)} % R`, '<= 3 %', Number.isFinite(b.center.y) && shapeFit(b) <= 0.03);
  }

  // rest quality, hostile calls
  {
    const b = new SoftBody(starter);
    run(b, 2);
    const p0 = Float32Array.from(b.positions);
    run(b, 10);
    let maxMove = 0;
    for (let i = 0; i < p0.length; i++) maxMove = Math.max(maxMove, Math.abs(p0[i] - b.positions[i]));
    add('G1', 'rest: largest vertex movement over 10 s at rest (no jitter, no creep)', `${(maxMove * 1000).toExponential(1)} mm`, '< 0.1 mm', maxMove < 1e-4);
    // the same from the very first frame at the other mesh resolutions (was verify_phys_cr_detail.ts; detail 4 is the offline / quality mesh)
    const restAt = (detail: number): number => {
      const bd = new SoftBody(starter, { detail });
      const q0 = Float32Array.from(bd.positions);
      run(bd, 6);
      let mv = 0;
      for (let i = 0; i < q0.length; i++) mv = Math.max(mv, Math.abs(q0[i] - bd.positions[i]));
      return mv;
    };
    const r2 = restAt(2), r4 = restAt(4);
    add('G1', 'rest at detail 2 (162 vertices) and detail 4 (2562): largest vertex movement over the first 6 s from a new body', `${(r2 * 1000).toExponential(1)} mm / ${(r4 * 1000).toExponential(1)} mm`, '< 0.1 mm each', r2 < 1e-4 && r4 < 1e-4);
    // a body disturbed and released must also come to a full stop in place (no creeping on the table)
    const b6 = new SoftBody(starter);
    run(b6, 1);
    touch(b6, 0, v3(0.22, 4, 0), v3(0, -1, 0)); b6.fingerPressure(0, 1); run(b6, 0.8); b6.fingerUp(0); run(b6, 6);
    const c1 = { x: b6.center.x, z: b6.center.z }; const q1 = Float32Array.from(b6.positions);
    run(b6, 8);
    let mm = 0; for (let i = 0; i < q1.length; i++) mm = Math.max(mm, Math.abs(q1[i] - b6.positions[i]));
    add('G1', 'after a squeeze + 6 s: largest vertex movement over the next 8 s (settled, not creeping)', `${(mm * 1000).toFixed(2)} mm, centre ${(Math.hypot(b6.center.x - c1.x, b6.center.z - c1.z) * 1000).toFixed(2)} mm`, '< 1 mm', mm < 1e-3);
    const before = b.stateHash(); b.step(0); b.step(-1); b.step(Number.NaN);
    add('G1', 'step(0), step(<0), step(NaN) leave the state untouched', before === b.stateHash() ? 'unchanged' : 'CHANGED', 'unchanged', before === b.stateHash());
    let threw = '';
    try {
      b.fingerUp(1); b.fingerPressure(1, 1); b.fingerMove(1, v3(0, 0, 0)); b.grabMove(0, v3(1, 1, 1)); b.grabRelease(1);
      b.grab(0, 5, v3(1, 1, 0)); b.grab(0, 6, v3(0, 1, 1)); b.grab(1, 7, v3(1, 1, 1));
      b.fingerDown(0, { point: v3(Number.NaN, 0, 0), normal: v3(0, 1, 0), dir: v3(0, -1, 0) });
      b.fingerDown(0, { point: v3(0, 1, 0), normal: v3(0, 0, 0), dir: v3(0, 0, 0) });
      b.fingerDown(1, { point: v3(0, 1, 0), normal: v3(0, 1, 0), dir: v3(0, -1, 0) });
      b.nudge(v3(Number.NaN, 1, 1)); b.nudge(v3(1e9, 0, 0)); b.step(100); b.step(1 / 60); b.reset(); b.step(1 / 60);
      b.fingerDown(0, { point: v3(0, 1, 0), normal: v3(0, 1, 0), dir: v3(0, -1, 0) }); b.fingerPressure(0, 1); b.step(0.05); b.reset(); b.step(0.05);
      run(b, 3);
    } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    const fine = !threw && Number.isFinite(b.center.y) && b.debug.safetyResets === 0 && volumeOf(b.positions, b.indices) > 0;
    add('G1', 'hostile calls (idle fingerUp, double grab, NaN/zero args, dt = 100, reset during a press)', threw || (fine ? 'survived, finite, 0 safety resets' : 'BROKEN STATE'), 'survive', fine);
    const ray0 = b.raycast(v3(0, 5, 0), v3(0, 0, 0)), rayNaN = b.raycast(v3(Number.NaN, 5, 0), v3(0, -1, 0));
    add('G1', 'raycast: zero-length dir and NaN origin return null', `${ray0 === null && rayNaN === null}`, 'true', ray0 === null && rayNaN === null);
  }

  // the fine mesh (detail 4, offline / quality only) obeys the same contract
  {
    const b = new SoftBody(starter, { detail: 4 });
    run(b, 1);
    const rest0 = Float32Array.from(b.positions);
    touch(b, 0, v3(0.22, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 1); run(b, 0.6);
    const vMid = b.metrics.volume, cMid = b.metrics.compression;
    b.fingerUp(0); run(b, 4);
    let mv = 0; for (let i = 0; i < rest0.length; i++) mv = Math.max(mv, Math.abs(rest0[i] - b.positions[i]));
    add('G1', `detail 4 (${b.vertexCount} vertices): squeeze and release, volume while squeezed, compression, shape error 4 s later`, `${f2(vMid, 3)}, ${f2(cMid, 2)}, ${f2(shapeFit(b) * 100, 2)} % R`, 'vol 0.85..1.15, comp > 0.1, <= 3 %', b.vertexCount === 2562 && vMid > 0.85 && vMid < 1.15 && cMid > 0.1 && shapeFit(b) <= 0.03 && Number.isFinite(mv) && b.debug.safetyResets === 0);
  }

  // determinism of scripted input
  {
    const script = (seed: number): number[] => {
      const b = new SoftBody(starter, { seed: 5 });
      const r = mulberry32(seed);
      const hs: number[] = [];
      for (let i = 0; i < 400; i++) {
        if (i % 40 === 3) touch(b, 0, v3(-3 + r() * 6, 0.1 + r() * 0.8, -3 + r() * 6), v3(r() - 0.5, -0.1, r() - 0.5));
        if (i % 40 === 4) b.fingerPressure(0, r());
        if (i % 40 === 20) b.fingerUp(0);
        if (i % 97 === 50) b.grab(1, Math.floor(r() * b.vertexCount), v3(r(), r(), r()));
        if (i % 97 === 90) b.grabRelease(1);
        if (i % 150 === 100) b.nudge(v3(r() * 2, r(), r() * 2));
        b.step(1 / 240 + r() * 0.03);
        if (i % 50 === 0) hs.push(b.stateHash());
      }
      hs.push(b.stateHash());
      return hs;
    };
    const a = script(11), c = script(11), d = script(12);
    add('G1', 'determinism: same script twice -> identical stateHash at 9 checkpoints', `${a.every((h, i) => h === c[i])}`, 'true', a.every((h, i) => h === c[i]) && a.length === c.length);
    add('G1', 'determinism sanity: a different script gives a different hash', `${a[a.length - 1] !== d[d.length - 1]}`, 'true', a[a.length - 1] !== d[d.length - 1]);
  }

  // fingertip kinematics (pinch continuity, table)
  {
    const tc = tipChecks(starter);
    add('G1', 'fingertip: a pinch jaw lifts, then ends: largest single-substep move of the lifting tip / of the jaw that stays down (normal retraction ~7 mm; was 140 / 156 mm)', `${f2(tc.jumpLift * 1000, 1)} mm / ${f2(tc.jumpStay * 1000, 1)} mm`, '<= 12 mm / <= 5 mm', tc.jumpLift <= 0.012 && tc.jumpStay <= 0.005);
    add('G1', 'fingertip: a second finger lands: largest single-substep move of the tip already pressing (was 156 mm)', `${f2(tc.jumpLand * 1000, 1)} mm`, '<= 5 mm', tc.jumpLand <= 0.005);
    add('G1', 'fingertip: releasing a pinch springs back: width along the pinch axis shrinks / compression grows in the first 60 ms (was 7.8 % / +0.08)', `${f2(tc.widthDrop * 100, 2)} % / ${tc.compRise >= 0 ? '+' : ''}${f2(tc.compRise, 3)}`, '<= 1.5 % / <= +0.03', tc.widthDrop <= 0.015 && tc.compRise <= 0.03);
    add('G1', 'fingertip: a low side press on a large body keeps the tip sphere above the table (lowest centre height - radius)', `${f2(tc.tipBelowTable * 1000, 2)} mm`, '>= -0.01 mm', tc.tipBelowTable >= -1e-5);
  }

  // ---- round-3 regression checks (single thread)
  {
    const rc = resetChecks(starter);
    add('G1', 'reset() == a fresh body (gravity): the same scripted session (hashes at 12 checkpoints + every event) after 1 / 6 / 7 / 13 substeps, and after a press + pinch + grab + gravity toggles + nudge; was: differed after an odd substep count (Laplacian parity on debug.substeps, bob phase on simTime)', rc.grav.length ? `differs: ${rc.grav.join('; ')}` : 'identical (5/5)', 'identical', rc.grav.length === 0);
    add('G1', 'reset() == a fresh body (float: new body, gravity off, reset) after 7 / 462 substeps + a shove and after a messy session', rc.float.length ? `differs: ${rc.float.join('; ')}` : 'identical (3/3)', 'identical', rc.float.length === 0);
    add('G1', 'reset() right after a messy session: positions, strain, centre, frame, metrics, tips and hash equal a new body bit for bit', `${rc.direct}`, 'true', rc.direct);
    const gc = genomeChecks(starter);
    add('G1', `genome sanitising: NaN / +-Infinity / missing firmness, bounce, stretch, size behave exactly like 0.5; out of range like the clamp; bad seed / species / null genome / NaN or negative params override (${gc.tried} cases; was: size NaN -> NaN positions, firmness NaN -> 300 safety resets)`, gc.bad.length ? gc.bad.slice(0, 4).join('; ') : `all ${gc.tried} identical to the documented safe value, ${gc.resets} safety resets`, 'all, 0', gc.bad.length === 0 && gc.resets === 0);
    const cc = coordChecks(starter);
    add('G1', `absurd coordinates (|c| > 1000 m, 1e30 .. 1e300) in fingerDown / fingerMove / grab / grabMove / raycast are ignored like NaN, nudge(1e300) = a 12 m/s nudge, a 1e300 or 1e-300 direction works (${cc.tried} cases; was: a 1e200 finger read compression 1, a 1e200 nudge did nothing)`, cc.bad.length ? cc.bad.slice(0, 4).join('; ') : `all ${cc.tried} ok`, 'all', cc.bad.length === 0);
    const wu = warmUpChecks(starter);
    add('G1', 'warmUp(): leaves a fresh body and a body in the middle of a press bit-identical (positions, strain, metrics, tips, hash), and the session afterwards equals a twin that never warmed up', `fresh ${wu.fresh}, mid-press ${wu.midPress}, session after ${wu.after}`, 'true, true, true', wu.fresh && wu.midPress && wu.after);
    const ap = apiChecks(starter);
    add('G1', `API edge cases (was verify_phys_cr_edge.ts, ${ap.tried} cases): step(+-Infinity / 1e9 / 1e-9), positions identity, raycast(null / NaN / Infinity), bad finger / grab ids and vertices, double fingerDown, reset() mid-press / mid-grab, input after reset, gravity switch keeps the hash, drainEvents appends and clears, 40 quick taps without event spam`, ap.bad.length ? `fails: ${ap.bad.join('; ')}` : `all ${ap.tried} hold`, 'all', ap.bad.length === 0);
    const rb = rubChecks(starter);
    add('G1', `rubbing (was verify_phys_rub.ts): 24 rubs across the top (pressure 0.2..0.8, 0.25..2 m/s): how far the body ends up dragged (${rb.worst}), highest the foot ever lifts`, `${f2(rb.drift * 1000, 1)} mm, ${f2(rb.lift * 1000, 2)} mm`, '<= 50 mm, <= 1 mm', rb.drift <= 0.05 && rb.lift <= 0.001);
    const pr = pressReaction(starter);
    add('G1', "metrics.press (round 2, now filled in): 0 at rest, ~1 for a full single-finger dent the global compression barely sees (side press on the swirl-peak), back to 0 within 0.1 s of the lift; always 0..1", `rest ${f2(pr.restPress, 2)}, dent ${f2(pr.dentPress, 2)} (compression ${f2(pr.dentComp, 2)}), 0.1 s after lift ${f2(pr.afterLift, 2)}, in range ${pr.inRange}`, '0, >= 0.9 (comp < 0.1), 0, true', pr.restPress === 0 && pr.dentPress >= 0.9 && pr.dentComp < 0.1 && pr.afterLift === 0 && pr.inRange);
    add('G1', 'metrics.reaction (round 2, now filled in): 0 at rest; a held full side press meets more push-back from a firm body than from a soft one', `rest ${f2(pr.restReact, 2)}, firm ${f2(pr.firm, 2)} vs soft ${f2(pr.soft, 2)}`, '0, firm > soft', pr.restReact === 0 && pr.firm > pr.soft && pr.inRange);
    const tp = tipPenetration(starter);
    add('G1', 'contact fold limit: the skin never ends a frame inside a fingertip (deepest at a frame end over instant peak shoves and a top press; the fold limit re-seats what it moves)', `${f2(tp * 100, 2)} % R`, '<= 0.5 % R', tp <= 0.005);
    const cl = corralLocalChecks(starter);
    add('G1', 'mat corral is invisible near the centre: press, pinch, pull and a small nudge give identical hashes with the corral on and off (rest pose and interaction untouched)', `${cl.deadZone}`, 'true', cl.deadZone);
    add('G1', `mat corral never fights a finger or a grab, and float mode is unchanged: identical hashes on / off while a finger holds a body nudged ${cl.outAtLift.toFixed(2)} m out, while a grab holds it ${cl.grabOut.toFixed(2)} m out, and for a floating shove`, `finger ${cl.finger}, grab ${cl.grab}, float ${cl.float}`, 'true, true, true', cl.finger && cl.grab && cl.float);
    add('G1', `mat corral after the finger lifts: back from ${cl.outAtLift.toFixed(2)} m to the dead-zone edge (0.6 m) in 10 s, then stopped (largest vertex movement over 2 s) with its rest shape`, `${cl.back.toFixed(3)} m, ${cl.stopMm.toFixed(3)} mm, shape ${cl.shapePct.toFixed(2)} % R`, '<= 0.61 m, < 0.1 mm, <= 3 %', cl.outAtLift > 0.8 && cl.back <= 0.61 && cl.stopMm < 0.1 && cl.shapePct <= 3);
  }

  // ---- G1p: performance (nothing else of ours is running; the machine is shared with other lanes, so best-of-N)
  {
    const batches: Array<{ mean: number; p99: number }> = [];
    const b = new SoftBody(starter);
    run(b, 1);
    touch(b, 0, v3(0.22, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.7);
    for (let k = 0; k < 400; k++) b.step(DT);   // JIT warm-up
    const N = 1000, B = 6;
    for (let bi = 0; bi < B; bi++) {
      const ts: number[] = [];
      for (let i = 0; i < N; i++) {
        if (i === 350) b.fingerUp(0);
        if (i === 600) touch(b, 0, v3(-4, 0.4, 0), v3(1, 0, 0));
        if (i === 601) b.fingerPressure(0, 0.6);
        if (i === 800) { b.fingerUp(0); b.grab(0, 100, v3(0.8, 0.6, 0)); }
        if (i === 950) b.grabRelease(0);
        const s = performance.now(); b.step(DT); ts.push(performance.now() - s);
      }
      ts.sort((x, y) => x - y);
      batches.push({ mean: ts.reduce((x, y) => x + y, 0) / N, p99: ts[Math.floor(N * 0.99)] });
    }
    const bestMean = Math.min(...batches.map((x) => x.mean)), bestP99 = Math.min(...batches.map((x) => x.p99));
    const medMean = [...batches].sort((x, y) => x.mean - y.mean)[B >> 1].mean, medP99 = [...batches].sort((x, y) => x.p99 - y.p99)[B >> 1].p99;
    add('G1p', `step() mean at detail 3, 6 substeps (best of ${B} x ${N} steps; median batch ${f2(medMean, 2)})`, `${f2(bestMean, 3)} ms`, '<= 2.0 ms', bestMean <= 2.0);
    add('G1p', `step() p99 at detail 3 (best batch; median batch ${f2(medP99, 2)}, worst ${f2(Math.max(...batches.map((x) => x.p99)), 2)})`, `${f2(bestP99, 3)} ms`, '<= 5 ms', bestP99 <= 5);
    // relative: the same scripted session, each step() followed by one call of a fixed reference kernel; the ratio of the two sums per batch
    const ref = makeRefKernel(b);
    let sink = 0;
    for (let k = 0; k < 200; k++) sink += ref();
    b.reset(); run(b, 1);
    const ratios: number[] = [];
    for (let bi = 0; bi < B; bi++) {
      let ts = 0, tr = 0;
      for (let i = 0; i < 500; i++) {
        if (i === 0) { touch(b, 0, v3(0.22, 4, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.7); }
        if (i === 200) b.fingerUp(0);
        if (i === 300) { touch(b, 0, v3(-4, 0.4, 0), v3(1, 0, 0)); b.fingerPressure(0, 0.6); }
        if (i === 400) { b.fingerUp(0); b.grab(0, 100, v3(0.8, 0.6, 0)); }
        if (i === 480) b.grabRelease(0);
        const s0 = performance.now(); b.step(DT); const s1 = performance.now(); sink += ref(); const s2 = performance.now();
        ts += s1 - s0; tr += s2 - s1;
      }
      ratios.push(ts / tr);
    }
    ratios.sort((x, y) => x - y);
    const relMed = ratios[B >> 1];
    add('G1p', `step() relative to a fixed reference kernel run interleaved with it (makeRefKernel; load-insensitive where the absolute rows are not), median of ${B} batches of 500 (range ${f2(ratios[0], 2)}..${f2(ratios[B - 1], 2)}); ${PERF_REL_NOTE}${sink === 1e300 ? '' : ''}`, f2(relMed, 2), `<= ${PERF_REL_MAX}`, relMed <= PERF_REL_MAX);
  }
  {
    const al = allocCheck(starter);
    add('G1p', `step() + the per-frame input calls allocate nothing once compiled (CONTRACT section 3), exact new-space growth per 120 frames: ${al.states.map((x) => x.name).join(' / ')} (was: 16 B every frame from a boxed finalize() argument, ~200 B per frame floating from a boxed hoverY(), 64 B per fingerMove from boxed rayMesh() arguments)`, al.states.map((x) => `${x.bytes} B`).join(' / '), '0 B each', al.states.every((x) => x.bytes === 0));
    const fa = familyAllocCheck(starter);
    add('G1p', 'physics round 2: every material family allocates nothing per frame once compiled (memory arm, air bleed, slosh, jam, strands; press + rub every frame on the DOLLOP shape), exact new-space growth per 120 frames', fa.map((x) => `${x.fam} ${x.bytes} B`).join(', '), '0 B each', fa.every((x) => x.bytes === 0));
  }
  // ---- physics round 2: ceremony drivers and the per-family volume band
  {
    const c = ceremonyChecks(starter);
    add('G1', 'ceremony setFold(1): the body folds into an equal-volume ball (sphericity = std / mean of the particle distances from the centre), eased (largest particle move per frame), and setFold(0) brings back the rest shape', `sphericity ${f2(c.restSph, 3)} -> ${f2(c.foldSph, 3)}, volume ${f2(c.foldVol, 3)}, largest move ${f2(c.foldMove, 3)} R / frame, back: shape error ${f2(c.backErr, 3)} R`, 'sphericity <= 0.02, volume 0.97..1.03, <= 0.06 R / frame, back <= 0.03 R', c.foldSph <= 0.02 && Math.abs(c.foldVol - 1) <= 0.03 && c.foldMove <= 0.06 && c.backErr <= 0.03);
    add('G1', 'ceremony moveTo(pad) + tremble: the centre slides to the pad on the table (3 s) without keeping a deformation; burstOpen(1): the goal overshoots (volume up to ~1.25^3) and settles by itself within 2 s', `pad miss ${f2(c.moveErr * 1000, 1)} mm, shape error ${f2(c.moveSph, 3)} R; burst volume max ${f2(c.burstVol, 2)}, shape error 2 s later ${f2(c.burstErr, 3)} R`, 'miss <= 20 mm, <= 0.03 R; volume 1.4..2.1, <= 0.03 R', c.moveErr <= 0.02 && c.moveSph <= 0.03 && c.burstVol >= 1.4 && c.burstVol <= 2.1 && c.burstErr <= 0.03);
    add('G1', 'ceremony drivers take hostile values (NaN, +-Infinity, -5, 1e9, a string, null, undefined, {}) without harm, and the whole ceremony script is deterministic (two runs, same hash)', `finite and back at rest: ${c.hostileOk}, deterministic: ${c.det}`, 'true, true', c.hostileOk && c.det);
    const vb = familyVolumeBands(starter);
    add('G1', 'physics round 2: volume under a hard squeeze and a hard pinch inside each material family\'s band (CONTRACT 4.2: min(0.85, 1 - volBleedMax - 0.05) .. 1.15; the compressible families lose volume by design)', vb.map((x) => `${x.fam} ${f2(x.min, 2)}..${f2(x.max, 2)} (>= ${f2(x.lo, 2)})`).join(', '), 'each in its band', vb.every((x) => x.min >= x.lo && x.max <= 1.15));
  }

  // ---- G1: hard-release scenarios + fuzz, in a worker pool (each job is independent and seeded, so the result does not depend on the worker count)
  {
    const nWorkers = 4;
    const specs: SqueezeSpec[] = [];
    for (const { name, g } of genomes) for (const kind of ['shoulder', 'peak', 'pinch'] as const) specs.push({ label: `${name}/${kind}`, genome: g, kind });
    const jobs: Job[] = specs.map((spec) => ({ type: 'squeeze', spec }));
    // fold matrix: the starter on every contact point (tap and hold), four genome corners on the six hardest points, the starter at detail 4
    const foldSpecs: FoldSpec[] = [];
    const hard = [0, 2, 5, 9, 12, 8];
    for (let sp = 0; sp < FOLD_SPOTS.length; sp++) for (const mode of ['tap', 'hold'] as const) foldSpecs.push({ label: `starter/${FOLD_SPOTS[sp][0]}/${mode}`, genome: starter, detail: 3, spot: sp, mode });
    for (const gn of ['f0b1s1', 'f1b0s0', 'small', 'large']) for (const sp of hard) for (const mode of ['tap', 'hold'] as const) foldSpecs.push({ label: `${gn}/${FOLD_SPOTS[sp][0]}/${mode}`, genome: genomes.find((g) => g.name === gn)!.g, detail: 3, spot: sp, mode });
    for (const sp of [0, 2, 5, 9, 12]) for (const mode of ['tap', 'hold'] as const) foldSpecs.push({ label: `starter@d4/${FOLD_SPOTS[sp][0]}/${mode}`, genome: starter, detail: 4, spot: sp, mode });
    for (const spec of foldSpecs) jobs.push({ type: 'fold', spec });
    for (let i = 0; i < FUZZ_RUNS; i++) jobs.push({ type: 'fuzz', index: i, nEvents: FUZZ_EVENTS });
    // round 3: the verify_phys_fold sweep, the cited presses at substep resolution, the mat corral, the hostile fuzz
    for (const spec of [...sweepSpecs(starter), ...shoveSpecs(starter)]) jobs.push({ type: 'fold2', spec });
    const big = quantizeGenome({ ...starter, bounce: 1, size: 1 }), small = quantizeGenome({ ...starter, stretch: 1, size: 0 }), down = v3(0, -1, 0);
    const subSpecs: FoldSpec[] = [
      { label: 'starter/top x=.2/hold', genome: starter, detail: 3, spot: 4, mode: 'hold' }, { label: 'starter/top x=.25/hold', genome: starter, detail: 3, spot: -1, mode: 'hold', ray: [v3(0.25, 3, 0), down] },
      { label: 'starter/top x=.3/hold', genome: starter, detail: 3, spot: 5, mode: 'hold' }, { label: 'starter/top x=0/hold', genome: starter, detail: 3, spot: 0, mode: 'hold' },
      { label: 'bouncy-big/top x=.2/tap', genome: big, detail: 3, spot: 4, mode: 'tap' }, { label: 'stretchy-small/top x=.2/tap', genome: small, detail: 3, spot: 4, mode: 'tap' },
      { label: 'f1b0s0/top x=.3/hold', genome: genomes.find((g) => g.name === 'f1b0s0')!.g, detail: 3, spot: 5, mode: 'hold' },
      { label: 'starter@d4/top x=.1/hold', genome: starter, detail: 4, spot: 2, mode: 'hold' },
      { label: 'starter/peak shove from -x', genome: starter, detail: 3, spot: -1, mode: 'shove', ray: [v3(-3, 0.96, 0), v3(1, 0, 0)] },
      { label: 'starter/peak shove from +x', genome: starter, detail: 3, spot: -1, mode: 'shove', ray: [v3(3, 0.96, 0), v3(-1, 0, 0)] },
      { label: 'starter/peak side press (shell profile) from -x', genome: starter, detail: 3, spot: -1, mode: 'shell', ray: [v3(-3, 0.96, 0), v3(1, 0, 0)] },
      { label: 'starter/peak side press (shell profile) from +z', genome: starter, detail: 3, spot: -1, mode: 'shell', ray: [v3(0, 0.96, 3), v3(0, 0, -1)] },
    ];
    for (const spec of subSpecs) jobs.push({ type: 'foldsub', spec });
    for (const gn of ['starter', 'f1b1s0', 'f0b0s1', 'small', 'large']) {
      const g = genomes.find((x) => x.name === gn)!.g;
      for (const az of [0, 2.4]) {
        for (const el of [0, 20, 45, 70]) jobs.push({ type: 'corral', spec: { label: `${gn} az ${az} el ${el}`, genome: g, kind: 'nudge', az, el: (el * Math.PI) / 180 } });
        jobs.push({ type: 'corral', spec: { label: `${gn} az ${az} 10 shoves`, genome: g, kind: 'shoves', az, el: 0 } });
        jobs.push({ type: 'corral', spec: { label: `${gn} az ${az} 60 x 12 m/s`, genome: g, kind: 'hammer', az, el: 0 } });
      }
    }
    for (let i = 0; i < HOSTILE_RUNS; i++) jobs.push({ type: 'hostile', index: i, steps: HOSTILE_STEPS, replay: i % 4 === 0 });
    // round 4: the dense press matrix (48 points x tap / hold / rub x 3 genomes)
    for (const spec of denseSpecs(starter)) jobs.push({ type: 'dense', spec });
    // round 5: sliding fingers (camera-plane rubs, slides toward the table, two fingers holding and rubbing) and the sane-gesture fuzz
    jobs.push(...round5Jobs(starter));
    // physics fix round 2: the per-family hostile fuzz in the default run (MINOR-15), every 4th run replayed for determinism
    for (let fi = 0; fi < MATERIAL_FAMILY_IDS.length; fi++) for (const gi of [0, 1]) jobs.push({ type: 'famhostile', fi, gi, steps: QUICK ? 400 : FAM_HOSTILE_STEPS, replay: (fi * 2 + gi) % 4 === 0 });
    const t1 = performance.now();
    const results = await runPool(jobs, nWorkers);
    const secs = (performance.now() - t1) / 1000;
    const squeezes = results.filter((r): r is Extract<JobResult, { type: 'squeeze' }> => r.type === 'squeeze').map((r) => r.res);
    const fuzzRes = results.filter((r): r is Extract<JobResult, { type: 'fuzz' }> => r.type === 'fuzz').map((r) => r.res);
    const folds = results.filter((r): r is Extract<JobResult, { type: 'fold' }> => r.type === 'fold').map((r) => r.res);

    const worst = (f: (r: SqueezeResult) => number, dir: 'max' | 'min'): SqueezeResult => squeezes.reduce((a, c) => (dir === 'max' ? (f(c) > f(a) ? c : a) : (f(c) < f(a) ? c : a)));
    const minV = worst((r) => r.minVol, 'min'), maxV = worst((r) => r.maxVol, 'max');
    add('G1', `volume under max squeeze, min (${minV.label}) .. max (${maxV.label}) over ${squeezes.length} squeezes`, `${f2(minV.minVol)} .. ${f2(maxV.maxVol)}`, '0.85 .. 1.15', minV.minVol >= 0.85 && maxV.maxVol <= 1.15);
    const wV = worst((r) => r.volRecover, 'max');
    add('G1', `volume back to 1 +/- 0.015, slowest (${wV.label})`, `${f2(wV.volRecover, 2)} s`, '<= 3 s', wV.volRecover <= 3);
    const wS = worst((r) => r.shapeRecover, 'max');
    add('G1', `shape within 3% R RMS, slowest (${wS.label})`, `${f2(wS.shapeRecover, 2)} s`, '<= 4 s', wS.shapeRecover <= 4);
    const wE = worst((r) => r.shapeErr4, 'max');
    add('G1', `shape error 4 s after release, worst (${wE.label})`, `${f2(wE.shapeErr4 * 100, 2)} % R`, '<= 3 %', wE.shapeErr4 <= 0.03);
    const wK = worst((r) => r.settleT, 'max');
    add('G1', `kinetic < 0.02 (held 0.5 s), slowest (${wK.label})`, `${f2(wK.settleT, 2)} s`, '<= 5 s', wK.settleT <= 5);
    const wH = worst((r) => r.hop, 'max');
    add('G1', `foot lift after release (no ball-bounce), worst (${wH.label})`, `${f2(wH.hop, 3)} m`, '<= 0.05 m', wH.hop <= 0.05);
    const wC = worst((r) => r.maxComp, 'max');
    add('info', `deepest squash seen (${wC.label})`, `compression ${f2(wC.maxComp, 2)}`, '(information)', true);
    const anyNaN = squeezes.filter((r) => r.nan || r.inverted);
    add('G1', 'NaN / inverted mesh in the squeeze scenarios', String(anyNaN.length), '0', anyNaN.length === 0);
    const missed = squeezes.filter((r) => r.missed);
    add('G1', 'every scripted squeeze actually touched the body (raycast hit)', `${squeezes.length - missed.length}/${squeezes.length}`, 'all', missed.length === 0);

    const bySpec = (label: string): SqueezeResult => squeezes.find((r) => r.label === label)!;
    const sw = bySpec('starter/shoulder');
    add('G1', 'starter wobble: visible height oscillations after a hard release (shoulder)', `${sw.nOsc}  (first overshoot ${f2(sw.firstOvershoot, 3)} m)`, '>= 2', sw.nOsc >= 2);
    add('G1', 'starter wobble: decay time constant tau (shoulder)', `${f2(sw.tau, 2)} s`, '0.5 .. 2.0 s', sw.tau >= 0.5 && sw.tau <= 2.0);
    const hb = new Set(genomes.filter((g) => g.highBounce).map((g) => g.name));
    const wob = squeezes.filter((r) => hb.has(r.label.split('/')[0]) && !r.label.endsWith('/pinch'));
    const wobBad = wob.filter((r) => !(r.nOsc >= 2 && r.tau >= 0.5 && r.tau <= 2.0));
    add('G1', `wobble n_osc >= 2 and tau in 0.5..2.0 for all ${wob.length} high-bounce shoulder/peak releases`, wobBad.length ? `fails: ${wobBad.map((r) => `${r.label} n=${r.nOsc} tau=${f2(r.tau, 2)}`).join('; ')}` : `${wob.length}/${wob.length} ok (min n_osc ${Math.min(...wob.map((r) => r.nOsc))}, tau ${f2(Math.min(...wob.map((r) => r.tau)), 2)}..${f2(Math.max(...wob.map((r) => r.tau)), 2)})`, 'all', wobBad.length === 0);
    for (const { name, highBounce } of genomes) if (!highBounce) {
      const s = bySpec(`${name}/shoulder`);
      add('info', `low-bounce ${name}/shoulder: oscillations, tau, settle`, `n=${s.nOsc} tau=${f2(s.tau, 2)} settle ${f2(s.settleT, 2)} s`, '(not gated)', true);
    }

    // ---- mesh folds (local creases and flaps; the volume gate cannot see them)
    {
      const fmax = (xs: FoldResult[], f: (r: FoldResult) => number): FoldResult => xs.reduce((a, c) => (f(c) > f(a) ? c : a));
      const d3 = folds.filter((r) => !r.label.includes('@d4')), d4 = folds.filter((r) => r.label.includes('@d4')), st0 = d3.filter((r) => r.label.startsWith('starter/'));
      const nMiss = folds.filter((r) => r.missed).length;
      add('G1', 'mesh folds: every scripted press of the fold matrix touched the body', `${folds.length - nMiss}/${folds.length}`, 'all', nMiss === 0);
      const wr = fmax(folds, (r) => r.restWorst);
      add('G1', `mesh folds: dihedral left at rest 3 s after the finger lifted, worst of ${folds.length} presses (${wr.label}); rest shape 50.4 deg, edges over 90 deg`, `${f2(wr.restWorst, 0)} deg, ${folds.reduce((a, c) => a + c.restN90, 0)} edges over 90, ${folds.reduce((a, c) => a + c.restInward, 0)} inward triangles`, `<= ${FOLD_REST_MAX} deg, 0, 0`, wr.restWorst <= FOLD_REST_MAX && folds.every((r) => r.restN90 === 0 && r.restInward === 0));
      const wp = fmax(st0, (r) => r.worst);
      add('G1', `mesh folds: starter, sharpest crease during any of ${st0.length} presses (${wp.label}), frames over 120 deg`, `${f2(wp.worst, 0)} deg, ${st0.reduce((a, c) => a + c.f120, 0)} frames`, '<= 115 deg, 0 frames', wp.worst <= 115 && st0.every((r) => r.f120 === 0));
      const wa = fmax(d3, (r) => r.worst);
      add('G1', `mesh folds: all genomes, sharpest crease during any of ${d3.length} presses (${wa.label}); nothing folds back on itself`, `${f2(wa.worst, 0)} deg`, '<= 140 deg', wa.worst <= 140);
      const wl = fmax(d3, (r) => r.f120);
      add('G1', `mesh folds: most frames over 120 deg in one press (${wl.label})`, `${wl.f120} frames (${f2(wl.f120 * DT, 2)} s)`, '<= 20 frames', wl.f120 <= 20);
      const w4 = fmax(d4, (r) => r.worst), l4 = fmax(d4, (r) => r.f120);
      add('G1', `mesh folds: detail 4 (2562 vertices), ${d4.length} presses: sharpest crease (${w4.label}), most frames over 120 deg in one press (${l4.label}), left at rest (rest shape 35 deg). A fast tap on the thin peak flank can still crease it for a few frames at this resolution (known)`, `${f2(w4.worst, 0)} deg, ${l4.f120} frames (${f2(l4.f120 * DT * 1000, 0)} ms), rest ${f2(Math.max(...d4.map((r) => r.restWorst)), 0)} deg`, '<= 5 frames over 120 deg, rest <= 45 deg, 0 edges over 90 at rest', d4.every((r) => r.f120 <= 5 && r.restWorst <= 45 && r.restN90 === 0));
      const wt = fmax(d3, (r) => r.topErr);
      add('G1', `peak recovers: highest vertex vs before the press, 3 s after a tap or 3.4 s after a hold, worst of ${d3.length} (${wt.label})`, `${f2(wt.topErr * 1000, 1)} mm`, '<= 30 mm', wt.topErr <= 0.03);
    }

    // ---- round 3 rows (pool)
    {
      const f2all = results.filter((r): r is Extract<JobResult, { type: 'fold2' }> => r.type === 'fold2').map((r) => r.res);
      const sw = f2all.filter((r) => r.label.startsWith('sweep/')), sh = f2all.filter((r) => r.label.startsWith('shove/')), rim = f2all.filter((r) => r.label.startsWith('rim/'));
      const sp = f2all.filter((r) => r.label.startsWith('shell/'));
      const ws = sw.reduce((a, c) => (c.worst > a.worst ? c : a)), wr = sw.reduce((a, c) => (c.restWorst > a.restWorst ? c : a));
      add('G1', `fold sweep of the verifier that found the transient folds (${sw.length} presses: starter, soft, firm, bouncy-big, stretchy-small; taps and holds x = 0 .. 0.25; was 171-180 deg at x = 0.2 / 0.25): sharpest crease (${ws.label}), frames over 120 deg, missed rays`, `${f2(ws.worst, 0)} deg, ${sw.reduce((a, c) => a + c.f120, 0)} frames, ${sw.filter((r) => r.missed).length} missed`, '<= 115 deg, 0 frames, 0', ws.worst <= 115 && sw.every((r) => r.f120 === 0 && !r.missed));
      add('G1', `fold sweep: left at rest 3 s after the finger lifted (${wr.label}); edges over 90 deg, inward triangles`, `${f2(wr.restWorst, 0)} deg, ${sw.reduce((a, c) => a + c.restN90, 0)}, ${sw.reduce((a, c) => a + c.restInward, 0)}`, `<= ${FOLD_REST_MAX} deg, 0, 0`, wr.restWorst <= FOLD_REST_MAX && sw.every((r) => r.restN90 === 0 && r.restInward === 0));
      const wsv = sh.reduce((a, c) => (c.worst > a.worst ? c : a)), wrim = rim.reduce((a, c) => (c.worst > a.worst ? c : a)), wsp = sp.reduce((a, c) => (c.worst > a.worst ? c : a));
      add('G1', `side press at the swirl-peak with the shell's pressure profile (${sp.length} presses: 5 genomes + detail 4, 6 / 12 cm under the tip, 4 directions; a fingertip wider than the peak crushed it flat: 179 deg, 100 frames over 120 without the contact fold limit): sharpest crease (${wsp.label}), frames over 120 deg, rest`, `${f2(wsp.worst, 0)} deg, ${sp.reduce((a, c) => a + c.f120, 0)} frames, rest ${f2(Math.max(...sp.map((r) => r.restWorst)), 0)} deg; missed ${sp.filter((r) => r.missed).map((r) => r.label).join(', ') || 'none'}; edges over 90 at rest ${sp.reduce((a, c) => a + c.restN90, 0)}`, '<= 120 deg, 0 frames, rest <= 60, none missed, 0', wsp.worst <= 120 && sp.every((r) => r.f120 === 0 && !r.missed && r.restN90 === 0 && r.restWorst <= FOLD_REST_MAX));
      add('G1', `hard side shove at the swirl-peak (pressure 1 at once, 6 cm under its tip, 4 directions x 3 genomes + detail 4: ${sh.length} presses, a stress case the shell never sends, its own presses are the row above; a fingertip wider than the peak crushed it flat: 162-180 deg at HEAD): sharpest crease (${wsv.label}), frames over 120 deg, rest`, `${f2(wsv.worst, 0)} deg, ${sh.reduce((a, c) => a + c.f120, 0)} frames, rest ${f2(Math.max(...sh.map((r) => r.restWorst)), 0)} deg; missed ${sh.filter((r) => r.missed).map((r) => r.label).join(', ') || 'none'}; edges over 90 at rest ${sh.reduce((a, c) => a + c.restN90, 0)}`, '<= 115 deg, 0 frames, rest <= 60, none missed, 0', wsv.worst <= 115 && sh.every((r) => r.f120 === 0 && !r.missed && r.restN90 === 0 && r.restWorst <= FOLD_REST_MAX));
      add('G1', `low side press at the table rim (y = 0.05, hold; 132 deg at HEAD): sharpest crease (${wrim.label}), frames over 120 deg`, `${f2(wrim.worst, 0)} deg, ${rim.reduce((a, c) => a + c.f120, 0)} frames`, '<= 120 deg, 0 frames', wrim.worst <= 120 && rim.every((r) => r.f120 === 0 && !r.missed));
      const sb = results.filter((r): r is Extract<JobResult, { type: 'foldsub' }> => r.type === 'foldsub').map((r) => r.res);
      const wsb = sb.reduce((a, c) => (c.worst > a.worst ? c : a));
      add('G1', `fold at SUBSTEP resolution (every 1/360 s, not just the frames a renderer samples) for the ${sb.length} presses that folded or crushed the peak (${wsb.label}; its frame-sampled worst ${f2(wsb.frameWorst, 0)} deg)`, `${f2(wsb.worst, 0)} deg, ${sb.reduce((a, c) => a + c.sub120, 0)} substeps over 120 deg`, '<= 120 deg, 0', wsb.worst <= 120 && sb.every((r) => r.sub120 === 0 && !r.missed));
      const dn = results.filter((r): r is Extract<JobResult, { type: 'dense' }> => r.type === 'dense').map((r) => r.res);
      const wdn = dn.reduce((a, c) => (c.worst > a.worst ? c : a)), ldn = dn.reduce((a, c) => (c.f120 > a.f120 ? c : a)), rdn = dn.reduce((a, c) => (c.restWorst > a.restWorst ? c : a));
      add('G1', `dense press matrix (${dn.length} presses: 48 points over the upper surface and the flanks x tap / hold / rub x the starter and the soft corners f0b0s0z0, f0b0s1z1; was 132 deg and 7 frames over 120 at the start of the repair, all at the peak base): sharpest crease (${wdn.label}), frames over 120 deg (most in one press: ${ldn.label}), missed rays`, `${f2(wdn.worst, 0)} deg, ${dn.reduce((a, c) => a + c.f120, 0)} frames (max ${ldn.f120}), ${dn.filter((r) => r.missed).length} missed`, '<= 115 deg, 0 frames, 0', wdn.worst <= 115 && dn.every((r) => r.f120 === 0 && !r.missed));
      add('G1', `dense press matrix: left at rest after the lift (${rdn.label}); edges over 90 deg, inward triangles`, `${f2(rdn.restWorst, 0)} deg, ${dn.reduce((a, c) => a + c.restN90, 0)}, ${dn.reduce((a, c) => a + c.restInward, 0)}`, `<= ${FOLD_REST_MAX} deg, 0, 0`, rdn.restWorst <= FOLD_REST_MAX && dn.every((r) => r.restN90 === 0 && r.restInward === 0));
      round5Rows(results, add, f2);
      famHostileRows(results, add, f2);
      const cr = results.filter((r): r is Extract<JobResult, { type: 'corral' }> => r.type === 'corral').map((r) => r.res);
      const one = cr.filter((r) => r.kind !== 'hammer'), ham = cr.filter((r) => r.kind === 'hammer');
      const wo = one.reduce((a, c) => (c.max > a.max ? c : a)), wh = ham.reduce((a, c) => (c.max > a.max ? c : a));
      add('G1', `mat corral: farthest the centre gets after a 12 m/s nudge (the nudge() clamp, 4 elevations x 2 azimuths) or ten 4 m/s shoves, ${one.length} runs over 5 genomes (${wo.label}); mat radius 3.5 m, stitched ring 3.34 m; was 3-6.6 m (one nudge), 9.2 m (shoves)`, `${f2(wo.max, 2)} m`, '<= 2.3 m', wo.max <= 2.3);
      add('G1', `mat corral under hostile input: a 12 m/s nudge EVERY frame for 1 s (${wh.label}), rim at 2.5 m`, `${f2(wh.max, 2)} m`, '<= 2.6 m', wh.max <= 2.6);
      const we = cr.reduce((a, c) => (c.end > a.end ? c : a)), wm = cr.reduce((a, c) => (c.stopMm > a.stopMm ? c : a)), wsh = cr.reduce((a, c) => (c.shapePct > a.shapePct ? c : a));
      add('G1', `mat corral: 14 s later every body is back at the dead-zone edge (${we.label}), stopped (largest vertex movement over the next 2 s, ${wm.label}) with its rest shape (${wsh.label})`, `${f2(we.end, 3)} m, ${f2(wm.stopMm, 3)} mm, ${f2(wsh.shapePct, 2)} % R`, '<= 0.61 m, < 0.1 mm, <= 3 %', we.end <= 0.61 && wm.stopMm < 0.1 && wsh.shapePct <= 3 && cr.every((r) => r.finite));
      hostileRows(results, add, f2);
    }

    let st = emptyStats();
    for (const r of fuzzRes) st = mergeStats(st, r.stats);
    const label = `${FUZZ_RUNS} runs x ${FUZZ_EVENTS} events, dt in [1/240, 1/10] log-uniform, random + extreme genomes, ${st.steps} checked states; pool of ${nWorkers} workers ran squeezes + fuzz in ${secs.toFixed(0)} s`;
    add('G1', `fuzz NaN/Infinity: ${label}`, String(st.nan), '0', st.nan === 0);
    add('G1', 'fuzz mesh inversions (signed volume <= 0)', String(st.inverted), '0', st.inverted === 0);
    add('G1', `fuzz table penetrations > 1% R (worst ${f2(st.maxPen * 100, 2)}% R)`, String(st.penetrations), '0', st.penetrations === 0);
    add('G1', 'fuzz: signed volume ratio seen (min .. max) under random abuse', `${f2(st.minVolRatio, 2)} .. ${f2(st.maxVolRatio, 2)}`, '> 0 (information)', st.minVolRatio > 0);
    add('G1', 'fuzz: bodies still settled (kinetic < 0.02) 5 s after everything is released', `${FUZZ_RUNS - st.unsettled}/${FUZZ_RUNS}`, 'all', st.unsettled === 0);
    add('G1', 'fuzz: emergency non-finite recoveries (debug.safetyResets) used', String(st.safetyResets), '0', st.safetyResets === 0);
    add('G1', `fuzz: mesh fold left in a body 5 s after everything is released, worst (rest shape 50.4 deg)`, `${f2(st.restFold, 0)} deg, ${st.restFoldRuns} runs over ${FOLD_REST_MAX} deg`, `<= ${FOLD_REST_MAX} deg`, st.restFoldRuns === 0);
    add('info', 'fuzz: farthest horizontal centre excursion (a nudge or a float shove may carry it)', `${f2(st.maxCenter, 2)} m`, '(information)', true);
    add('G1', 'fuzz: every drained event is well formed (finite fields, unit normal, intensity 0..1, heldFor only on release / snap, valid finger)', `${st.badEvents} bad of ${st.events}`, '0', st.badEvents === 0 && st.events > 0);
    add('info', 'fuzz: farthest horizontal centre excursion while on the table (gravity on); a float-mode shove can leave it farther before gravity returns', `${f2(st.maxTableCenter, 2)} m`, '(information)', true);
    // determinism of the fuzz itself: replay one run twice in this thread and against the pool result
    const again = fuzzRun(0, FUZZ_EVENTS), again2 = fuzzRun(0, FUZZ_EVENTS);
    add('G1', 'determinism: a fuzz run replayed twice -> identical final stateHash', `${again.hash === again2.hash}`, 'true', again.hash === again2.hash);
    add('G1', 'determinism: the replay matches the pool worker result for the same run', `${again.hash === fuzzRes[0].hash}`, 'true', again.hash === fuzzRes[0].hash);
    for (const f of st.failures) add('fail', f, '', '', false);
  }

  // ---- cold JIT (fresh node processes, after the pool so nothing else of ours runs): the first session with and without warmUp()
  {
    // with and without warmUp() in alternating fresh processes, so both see the same machine load (this box is shared): the gate is relative
    const warm: ColdRun[] = [], cold: ColdRun[] = [];
    for (let k = 0; k < 3; k++) { warm.push(...coldRuns(true, 1)); cold.push(...coldRuns(false, 1)); }
    const best = warm.reduce((a, c) => (c.over4 < a.over4 || (c.over4 === a.over4 && c.worst < a.worst) ? c : a));
    const cmed = [...cold].sort((a, c) => a.over4 - c.over4)[1];
    add('G1p', `cold JIT: first session of a fresh process (rest, tap, hold, pinch, pull, float; 400 frames): steps over 4 ms, worst and p95 step with warmUp() (best of 3; warmUp itself ${warm.map((r) => f2(r.warmMs, 0)).join(' / ')} ms, once, at load) vs without (median of 3, alternating processes, same load)`, `with: ${best.over4} steps, worst ${f2(best.worst, 1)} ms, p95 ${f2(best.p95, 2)} ms; without: ${cmed.over4} steps, worst ${f2(cmed.worst, 1)} ms, p95 ${f2(cmed.p95, 2)} ms`, 'with <= 1/5 of without (and <= 10), p95 <= 1/4', best.over4 <= Math.min(10, cmed.over4 / 5) && best.p95 <= cmed.p95 / 4);
    add('G1', 'cold JIT: warmUp() left the body bit-identical in every fresh process', warm.map((r) => String(r.same)).join(', '), 'all true', warm.every((r) => r.same));
    const lp = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--late-press-child'], { encoding: 'utf8', timeout: 120000 });
    let late: number[] = [Infinity, Infinity], early: number[] = [NaN, NaN];
    try { ({ late, early } = JSON.parse(lp.stdout) as { late: number[]; early: number[] }); } catch { /* reported as Infinity */ }
    add('G1p', 'warmUp() covers a lone finger: in a fresh process, warmUp(), 25 s at rest, then the first press of finger 0 (and later of finger 1): exact new-space growth per frame over its first 3 s (was 9 KB / frame: the workout\'s top presses missed the twin after its corral shove, so V8 compiled the finger paths without that feedback and the first real press deoptimised them)', late.map((x) => `${f2(x, 0)} B`).join(' / '), '0 B each', late.every((x) => x === 0));
    add('info', 'garbage per frame in the first 2 x 60 frames after warmUp() (same fresh process, at rest): V8 still runs the once-per-frame step() / finalize() in a lower tier; ~340 B / frame follows until ~20 s, then zero (young-generation garbage, no hitch: see the cold JIT row)', early.map((x) => (Number.isFinite(x) ? `${f2(x, 0)} B` : 'scavenged')).join(' / '), '(information)', true);
  }

  // ---- report
  const w1 = Math.max(...rows.map((r) => r.what.length), 20);
  console.log('\nWOBBLEHOARD physics probe (G1, G1p)' + (QUICK ? '  [--quick: reduced fuzz]' : ''));
  console.log('-'.repeat(Math.min(200, w1 + 60)));
  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.gate.padEnd(4)}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`);
  const failed = rows.filter((r) => !r.pass).length;
  const total = ((performance.now() - t0) / 1000).toFixed(1);
  console.log('-'.repeat(Math.min(200, w1 + 60)));
  console.log(`${rows.length - failed}/${rows.length} checks passed in ${total} s`);
  try {
    const dir = resolve(here, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_softbody.json'), JSON.stringify({ quick: QUICK, rows, seconds: Number(total) }, null, 1));
  } catch { /* the report is a convenience */ }
  process.exit(failed ? 1 : 0);
}
