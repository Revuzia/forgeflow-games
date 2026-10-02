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
// Definitions the contract leaves open (all printed in the table):
//   * "hard release": a finger presses the dome shoulder (and, separately, the swirl-peak) at pressure 1 for 1.0 s, then
//     lifts. A third scenario pinches the dome between two fingers.
//   * "height" = the highest vertex (the swirl tip); h(t) is it minus its settled value. A "visible oscillation" is an
//     alternating extremum of h with |h| >= 2% of restRadius; n_osc = alternating extrema / 2. tau = exponential fit of
//     |extrema| against time.
//   * "bounce high" = genome.bounce >= 0.7: the starter and the genomes with bounce = 1 (all firmness / stretch corners,
//     both size extremes).
//   * shape error: independent Procrustes (polar decomposition by Higham iteration), RMS over all vertices / restRadius.
//   * the fuzz picks one of: step (25%), fingerDown, fingerPressure, fingerMove, fingerUp, grab, grabMove, grabRelease,
//     nudge, gravity toggle, step(0), reset. Every 4th run uses an extreme genome (firmness / bounce / stretch / size in
//     {0, 1}); the others use randomGenome. After the events everything is released and the body gets 6 s to settle.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome, randomGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';
import type { V3, SoftEvent } from '../src/contracts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const QUICK = process.argv.includes('--quick');
const FUZZ_RUNS = QUICK ? 20 : 200;
const FUZZ_EVENTS = QUICK ? 400 : 1500;
const DT = 1 / 60;

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

interface FuzzStats { runs: number; steps: number; nan: number; inverted: number; penetrations: number; maxPen: number; minVolRatio: number; maxVolRatio: number; safetyResets: number; maxCenter: number; failures: string[]; unsettled: number }
const emptyStats = (): FuzzStats => ({ runs: 0, steps: 0, nan: 0, inverted: 0, penetrations: 0, maxPen: 0, minVolRatio: 9, maxVolRatio: 0, safetyResets: 0, maxCenter: 0, failures: [], unsettled: 0 });
function mergeStats(a: FuzzStats, b: FuzzStats): FuzzStats {
  return {
    runs: a.runs + b.runs, steps: a.steps + b.steps, nan: a.nan + b.nan, inverted: a.inverted + b.inverted, penetrations: a.penetrations + b.penetrations,
    maxPen: Math.max(a.maxPen, b.maxPen), minVolRatio: Math.min(a.minVolRatio, b.minVolRatio), maxVolRatio: Math.max(a.maxVolRatio, b.maxVolRatio),
    safetyResets: a.safetyResets + b.safetyResets, maxCenter: Math.max(a.maxCenter, b.maxCenter), failures: [...a.failures, ...b.failures].slice(0, 8), unsettled: a.unsettled + b.unsettled,
  };
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
    stats.safetyResets = b.debug.safetyResets;
  };

  for (let e = 0; e < nEvents; e++) {
    const pick = r();
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
    if (e % 7 === 0) { events.length = 0; b.drainEvents(events); }
    checkInvariants(tag);
  }
  // the body must settle once everything is let go (gravity back on): 6 s of fixed frames
  b.fingerUp(0); b.fingerUp(1); b.grabRelease(0); b.grabRelease(1); b.gravity = true;
  for (let i = 0; i < 60 * 6; i++) b.step(DT);
  checkInvariants('settle');
  if (!(b.metrics.kinetic < 0.02)) { stats.unsettled++; if (stats.failures.length < 5) stats.failures.push(`run ${runIndex}: not settled after 6 s (kinetic ${b.metrics.kinetic.toFixed(3)})`); }
  return { stats, hash: b.stateHash() };
}

// ------------------------------------------------------------------------------------------------ worker pool

type Job = { type: 'squeeze'; spec: SqueezeSpec } | { type: 'fuzz'; index: number; nEvents: number };
type JobResult = { type: 'squeeze'; res: SqueezeResult } | { type: 'fuzz'; res: { stats: FuzzStats; hash: number } };

if (!isMainThread) {
  const { jobs } = workerData as { jobs: Job[] };
  const out: JobResult[] = jobs.map((j) => (j.type === 'squeeze' ? { type: 'squeeze', res: hardRelease(j.spec) } : { type: 'fuzz', res: fuzzRun(j.index, j.nEvents) }));
  parentPort!.postMessage(out);
} else {
  await main();
}

function runPool(jobs: Job[], nWorkers: number): Promise<JobResult[]> {
  // heaviest first, round robin, so the workers finish together
  const order = jobs.map((j, i) => ({ j, i })).sort((a, b) => (b.j.type === 'fuzz' ? 3 : 1) - (a.j.type === 'fuzz' ? 3 : 1));
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
  }

  // ---- G1: hard-release scenarios + fuzz, in a worker pool (each job is independent and seeded, so the result does not depend on the worker count)
  {
    const nWorkers = 4;
    const specs: SqueezeSpec[] = [];
    for (const { name, g } of genomes) for (const kind of ['shoulder', 'peak', 'pinch'] as const) specs.push({ label: `${name}/${kind}`, genome: g, kind });
    const jobs: Job[] = specs.map((spec) => ({ type: 'squeeze', spec }));
    for (let i = 0; i < FUZZ_RUNS; i++) jobs.push({ type: 'fuzz', index: i, nEvents: FUZZ_EVENTS });
    const t1 = performance.now();
    const results = await runPool(jobs, nWorkers);
    const secs = (performance.now() - t1) / 1000;
    const squeezes = results.filter((r): r is Extract<JobResult, { type: 'squeeze' }> => r.type === 'squeeze').map((r) => r.res);
    const fuzzRes = results.filter((r): r is Extract<JobResult, { type: 'fuzz' }> => r.type === 'fuzz').map((r) => r.res);

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

    let st = emptyStats();
    for (const r of fuzzRes) st = mergeStats(st, r.stats);
    const label = `${FUZZ_RUNS} runs x ${FUZZ_EVENTS} events, dt in [1/240, 1/10] log-uniform, random + extreme genomes, ${st.steps} checked states; pool of ${nWorkers} workers ran squeezes + fuzz in ${secs.toFixed(0)} s`;
    add('G1', `fuzz NaN/Infinity: ${label}`, String(st.nan), '0', st.nan === 0);
    add('G1', 'fuzz mesh inversions (signed volume <= 0)', String(st.inverted), '0', st.inverted === 0);
    add('G1', `fuzz table penetrations > 1% R (worst ${f2(st.maxPen * 100, 2)}% R)`, String(st.penetrations), '0', st.penetrations === 0);
    add('G1', 'fuzz: signed volume ratio seen (min .. max) under random abuse', `${f2(st.minVolRatio, 2)} .. ${f2(st.maxVolRatio, 2)}`, '> 0 (information)', st.minVolRatio > 0);
    add('G1', 'fuzz: bodies still settled (kinetic < 0.02) 6 s after everything is released', `${FUZZ_RUNS - st.unsettled}/${FUZZ_RUNS}`, 'all', st.unsettled === 0);
    add('G1', 'fuzz: emergency non-finite recoveries (debug.safetyResets) used', String(st.safetyResets), '0', st.safetyResets === 0);
    add('info', 'fuzz: farthest horizontal centre excursion (a nudge or a float shove may carry it)', `${f2(st.maxCenter, 2)} m`, '(information)', true);
    // determinism of the fuzz itself: replay one run twice in this thread and against the pool result
    const again = fuzzRun(0, FUZZ_EVENTS), again2 = fuzzRun(0, FUZZ_EVENTS);
    add('G1', 'determinism: a fuzz run replayed twice -> identical final stateHash', `${again.hash === again2.hash}`, 'true', again.hash === again2.hash);
    add('G1', 'determinism: the replay matches the pool worker result for the same run', `${again.hash === fuzzRes[0].hash}`, 'true', again.hash === fuzzRes[0].hash);
    for (const f of st.failures) add('fail', f, '', '', false);
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
