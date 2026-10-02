// INDEPENDENT VERIFIER fuzz for lane PHYS (not the implementer's probe). Run:  node _harness/verify_phys_fuzz.ts [--steps N] [--detail D] [--only i,j]
// 16 extreme genomes (firmness, bounce, stretch, size each 0 or 1) x 20000 random-script steps each:
//   both fingers (crossing paths, pressure flipping 0<->1 every frame), grabs while fingers are down, gravity toggled
//   mid-press, reset mid-grab, nudges (incl. 40 and 1e6), dt drawn from {log-uniform 1/240..1/10, 0, 0.5, 5}.
// Fails on: NaN/Infinity (positions, strain, metrics, centre, frame, events), signed volume <= 0 at ANY step, particle more than
// 1% restRadius below the table at ANY step, volume ratio outside 0.8..1.2 once settled, no settle within 8 s of release,
// any triangle flipped > 120 deg versus rest (after Procrustes rotation) once settled, debug.safetyResets > 0,
// non-determinism (same script twice -> different stateHash at any checkpoint), mean step() > 2.0 ms.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';
import type { SoftEvent, V3 } from '../src/contracts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argVal = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const STEPS = Number(argVal('--steps', '20000'));
const DETAIL = Number(argVal('--detail', '3'));
const ONLY = argVal('--only', '').split(',').filter(Boolean).map(Number);
const SETTLE_MAX_S = 8;
// (thread CPU time was tried first: this kernel only accounts it in 4 ms ticks, useless for 1 ms calls. Wall clock + medians instead.)
const tcpu = (): number => performance.now();

interface RunResult {
  idx: number; label: string; steps: number; simSeconds: number;
  fails: string[]; notes: Record<string, number>;
  hashes: number[]; finalHash: number;
  msAll: number; callsAll: number; ms60: number; calls60: number; msPerSubstep: number;
  buckets: Record<string, [number, number]>;
  samples: Record<string, number[]>; // ms per substep, steps with >= 6 substeps only
  spikes: Record<number, number>;    // step index -> ms per 1/60-equivalent, for steps costing > 8 ms per 1/60-equivalent
}

function genomeFor(idx: number) {
  const g = makeStarterGenome();
  g.firmness = (idx >> 0) & 1; g.bounce = (idx >> 1) & 1; g.stretch = (idx >> 2) & 1; g.size = (idx >> 3) & 1;
  return quantizeGenome(g);
}
const labelFor = (idx: number): string => `f${idx & 1}b${(idx >> 1) & 1}s${(idx >> 2) & 1}z${(idx >> 3) & 1}`;

function signedVolume(P: Float32Array, tris: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

/** Orthogonal polar factor (Higham iteration), row-major 3x3. */
function polar(A: number[]): number[] {
  let M = A.slice();
  for (let it = 0; it < 60; it++) {
    const [a, b, c, d, e, f, g, h, i] = M;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-18) break;
    const id = 1 / det;
    const T = [
      (e * i - f * h) * id, -(d * i - f * g) * id, (d * h - e * g) * id,
      -(b * i - c * h) * id, (a * i - c * g) * id, -(a * h - b * g) * id,
      (b * f - c * e) * id, -(a * f - c * d) * id, (a * e - b * d) * id,
    ];
    const N = M.map((v, k) => 0.5 * (v + T[k]));
    let diff = 0;
    for (let k = 0; k < 9; k++) diff += Math.abs(N[k] - M[k]);
    M = N;
    if (diff < 1e-13) break;
  }
  return M;
}

/** Shape error (RMS / restRadius) after removing translation + rotation, and the max triangle-normal rotation (deg) vs rest under that rotation. */
function settledShape(b: SoftBody): { rms: number; maxFlipDeg: number; flipped: number } {
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
    s += (P[i * 3] - gx) ** 2 + (P[i * 3 + 1] - gy) ** 2 + (P[i * 3 + 2] - gz) ** 2;
  }
  const tris = b.indices;
  let maxDeg = 0, flipped = 0;
  const nrm = (src: ArrayLike<number>, t: number): [number, number, number] => {
    const a = tris[t] * 3, bI = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = src[bI] - src[a], uy = src[bI + 1] - src[a + 1], uz = src[bI + 2] - src[a + 2];
    const vx = src[c] - src[a], vy = src[c + 1] - src[a + 1], vz = src[c + 2] - src[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  for (let t = 0; t < tris.length; t += 3) {
    const cur = nrm(P, t), rest = nrm(Q, t);
    const rx = R[0] * rest[0] + R[1] * rest[1] + R[2] * rest[2];
    const ry = R[3] * rest[0] + R[4] * rest[1] + R[5] * rest[2];
    const rz = R[6] * rest[0] + R[7] * rest[1] + R[8] * rest[2];
    const dot = Math.max(-1, Math.min(1, cur[0] * rx + cur[1] * ry + cur[2] * rz));
    const deg = Math.acos(dot) * 180 / Math.PI;
    if (deg > maxDeg) maxDeg = deg;
    if (deg > 120) flipped++;
  }
  return { rms: Math.sqrt(s / n) / b.restRadius, maxFlipDeg: maxDeg, flipped };
}

/** The scripted run. Everything random is drawn from `rng` only, so two runs with the same seed are the same script. */
function runScript(idx: number, steps: number, measure: boolean): RunResult {
  const g = genomeFor(idx);
  const b = new SoftBody(g, { detail: DETAIL, seed: 0xc0ffee + idx });
  const R = b.restRadius;
  const rng = mulberry32(0x5eed0000 + idx * 7919);
  const fails: string[] = [];
  const notes: Record<string, number> = {
    minVol: 9, maxVol: 0, minY_R: 9, maxSpeedCm: 0, resets: 0, events: 0, eventSpam: 0, maxCenterDist: 0,
    volViolations085_115: 0, flipDuring: 0,
  };
  const fail = (msg: string): void => { if (fails.length < 12) fails.push(msg); };
  const hashes: number[] = [];
  const events: SoftEvent[] = [];
  const lastEv = new Map<string, { t: number; dt: number }>();
  let curDt = 0;
  let clock = 0;
  const down = [false, false], grabbed = [false, false], pressNow = [0, 0];
  const lastPt: V3[] = [{ x: 0, y: R, z: 0 }, { x: 0, y: R, z: 0 }];
  const buckets: Record<string, [number, number]> = {};
  const samples: Record<string, number[]> = {};
  const allSamples: number[] = [];
  const spikes: Record<number, number> = {};
  let msAll = 0, callsAll = 0, ms60 = 0, calls60 = 0, subTotal = 0;
  const DTS = { zero: 0, half: 0.5, five: 5 };
  void DTS;

  const rand = (): number => rng();
  const pick = (n: number): number => Math.floor(rng() * n);
  const unit = (): V3 => {
    const z = 2 * rng() - 1, a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return { x: r * Math.cos(a), y: z, z: r * Math.sin(a) };
  };
  const centre = (): V3 => ({ x: b.center.x, y: b.center.y, z: b.center.z });
  const rayAtBody = (): { point: V3; normal: V3; dir: V3 } | null => {
    const c = centre(), u = unit();
    const o = { x: c.x + u.x * 3 * R, y: c.y + u.y * 3 * R, z: c.z + u.z * 3 * R };
    const j = 0.35 * R;
    const tgt = { x: c.x + (rng() - 0.5) * j, y: c.y + (rng() - 0.5) * j, z: c.z + (rng() - 0.5) * j };
    let dir = { x: tgt.x - o.x, y: tgt.y - o.y, z: tgt.z - o.z };
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    const h = b.raycast(o, dir);
    if (!h) return null;
    return { point: h.point, normal: h.normal, dir };
  };
  const dtDraw = (): number => {
    const u = rand();
    if (u < 0.08) return 0;
    if (u < 0.16) return 0.5;
    if (u < 0.24) return 5;
    const lo = Math.log(1 / 240), hi = Math.log(1 / 10);
    return Math.exp(lo + (hi - lo) * rand());
  };

  const checkState = (where: string): boolean => {
    const P = b.positions;
    for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) { fail(`NaN/Inf position[${i}] @${where}`); return false; }
    const m = b.metrics;
    for (const k of ['compression', 'compressionRate', 'stretch', 'volume', 'kinetic'] as const) {
      if (!Number.isFinite(m[k])) { fail(`non-finite metrics.${k} @${where}`); return false; }
    }
    if (!Number.isFinite(b.center.x + b.center.y + b.center.z)) { fail(`non-finite center @${where}`); return false; }
    if (!Number.isFinite(b.frame.x + b.frame.y + b.frame.z + b.frame.w)) { fail(`non-finite frame @${where}`); return false; }
    const S = b.strain;
    for (let i = 0; i < S.length; i++) if (!Number.isFinite(S[i])) { fail(`non-finite strain[${i}] @${where}`); return false; }
    const sv = signedVolume(P, b.indices);
    if (!(sv > 0)) { fail(`inverted mesh: signed volume ${sv} @${where}`); return false; }
    let mn = Infinity;
    for (let i = 1; i < P.length; i += 3) if (P[i] < mn) mn = P[i];
    if (mn / R < notes.minY_R) notes.minY_R = mn / R;
    if (mn < -0.01 * R) { fail(`table penetration ${(mn / R * 100).toFixed(2)}% R @${where}`); return false; }
    const vr = m.volume;
    if (vr < notes.minVol) notes.minVol = vr;
    if (vr > notes.maxVol) notes.maxVol = vr;
    if (vr < 0.85 || vr > 1.15) notes.volViolations085_115++;
    const cd = Math.hypot(b.center.x, b.center.z);
    if (cd > notes.maxCenterDist) notes.maxCenterDist = cd;
    return true;
  };

  const drain = (where: string): void => {
    events.length = 0;
    b.drainEvents(events);
    for (const e of events) {
      notes.events++;
      const f = [e.at.x, e.at.y, e.at.z, e.normal.x, e.normal.y, e.normal.z, e.intensity, e.heldFor, e.finger];
      if (!f.every(Number.isFinite)) fail(`non-finite event ${e.kind} @${where}`);
      if (e.intensity < 0 || e.intensity > 1) fail(`event intensity out of range ${e.intensity} @${where}`);
      const nl = Math.hypot(e.normal.x, e.normal.y, e.normal.z);
      if (Math.abs(nl - 1) > 1e-3) fail(`event normal not unit (${nl}) @${where}`);
      const key = e.kind + ':' + e.finger;
      const last = lastEv.get(key);
      if (events.length > 128) fail(`event queue over the 128 cap (${events.length})`);
      if (!skipSpam && last !== undefined && clock - last.t < 0.05 - curDt - last.dt - 2 * (1 / 360) - 0.001) { notes.eventSpam++; if (notes.eventSpam <= 3) fail(`event spam @${where}: ${key} gap ${(clock - last.t).toFixed(4)} s (dt ${curDt.toFixed(4)}, prev dt ${last.dt.toFixed(4)})`); }
      if (skipSpam) lastEv.delete(key); else lastEv.set(key, { t: clock, dt: curDt });   // a batched drain has no usable timestamps
    }
  };

  let ok = true;
  let skipSpam = false;
  for (let s = 0; s < steps && ok; s++) {
    // ---- 0..3 random calls per step
    const ncalls = pick(4);
    for (let k = 0; k < ncalls; k++) {
      const id = pick(2) as 0 | 1;
      const other = (1 - id) as 0 | 1;
      const r = rand();
      if (r < 0.16) {                                   // fingerDown on the body (sometimes while already down / grabbing)
        const h = rayAtBody();
        if (h) { b.fingerDown(id, h); down[id] = true; grabbed[id] = false; lastPt[id] = h.point; }
        else if (rand() < 0.2) {                        // hostile: a point nowhere near the body, odd direction
          const p = { x: (rng() - 0.5) * 6 * R, y: (rng() - 0.2) * 4 * R, z: (rng() - 0.5) * 6 * R };
          b.fingerDown(id, { point: p, normal: unit(), dir: rand() < 0.3 ? { x: 0, y: 0, z: 0 } : unit() });
          down[id] = true; grabbed[id] = false;
        }
      } else if (r < 0.26) {                            // pressure jumps (also extra out-of-range values)
        const v = rand() < 0.8 ? (rand() < 0.5 ? 0 : 1) : (rand() < 0.5 ? -3 : 7);
        b.fingerPressure(id, v); pressNow[id] = v;
      } else if (r < 0.46) {                            // move: onto the body surface, onto the OTHER finger's point (crossing), or off-surface
        const m = rand();
        if (m < 0.45) { const h = rayAtBody(); if (h) { b.fingerMove(id, h.point); lastPt[id] = h.point; } }
        else if (m < 0.85) { b.fingerMove(id, lastPt[other]); lastPt[id] = lastPt[other]; }
        else { b.fingerMove(id, { x: (rng() - 0.5) * 5 * R, y: rng() * 3 * R, z: (rng() - 0.5) * 5 * R }); }
      } else if (r < 0.54) {                            // finger up
        b.fingerUp(id); down[id] = false;
      } else if (r < 0.64) {                            // grab (often while a finger is down on the same / other id)
        const v = pick(b.vertexCount);
        const px = b.positions[v * 3], py = b.positions[v * 3 + 1], pz = b.positions[v * 3 + 2];
        const sc = rand() < 0.2 ? 6 : 2;
        b.grab(id, v, { x: px + (rng() - 0.5) * sc * R, y: py + rng() * sc * R, z: pz + (rng() - 0.5) * sc * R });
        grabbed[id] = true; down[id] = false;
      } else if (r < 0.74) {                            // grabMove, big and small
        const sc = rand() < 0.15 ? 40 : 3;
        b.grabMove(id, { x: b.center.x + (rng() - 0.5) * sc * R, y: b.center.y + (rng() - 0.3) * sc * R, z: b.center.z + (rng() - 0.5) * sc * R });
      } else if (r < 0.79) {
        b.grabRelease(id); grabbed[id] = false;
      } else if (r < 0.86) {                            // nudges
        const mag = [0.5, 3, 12, 40, 1e6][pick(5)];
        const u = unit();
        b.nudge({ x: u.x * mag, y: u.y * mag, z: u.z * mag });
      } else if (r < 0.92) {                            // gravity toggled (often mid-press)
        b.gravity = !b.gravity;
      } else if (r < 0.93) {                            // reset (often mid-grab / mid-press)
        b.reset(); down[0] = down[1] = false; grabbed[0] = grabbed[1] = false; lastEv.clear();   // reset() clears the per-kind rate limiter by design
      } else if (r < 0.96) {
        // flicker: flip the pressure of every down finger right now
        for (const q of [0, 1] as const) if (down[q]) { pressNow[q] = pressNow[q] > 0.5 ? 0 : 1; b.fingerPressure(q, pressNow[q]); }
      }
    }
    // pressure flips 0<->1 each frame on every finger that is down (60% of frames), the adversarial case for the depth ramp
    if (rand() < 0.6) for (const q of [0, 1] as const) if (down[q]) { pressNow[q] = pressNow[q] > 0.5 ? 0 : 1; b.fingerPressure(q, pressNow[q]); }

    const dt = dtDraw();
    curDt = Math.min(Math.max(dt, 0), 1 / 20);
    const bk = measure ? `${b.gravity ? 'grav' : 'float'}/f${b.metrics.fingers}/${b.metrics.grabbed ? 'grab' : 'nograb'}/${b.metrics.grounded ? 'ground' : 'air'}` : '';
    const t0 = measure ? tcpu() : 0;
    b.step(dt);
    if (measure) {
      const el = tcpu() - t0;
      msAll += el; callsAll++;
      const dtc = Math.min(Math.max(dt, 0), 1 / 20);
      subTotal += dtc * 360;
      if (dtc * 360 >= 5.5 && el / (dtc * 360) * 6 > 8) spikes[s] = el / (dtc * 360) * 6;
      { const e = (buckets[bk] ??= [0, 0]); e[0] += el; e[1] += dtc * 360; }
      if (dtc * 360 >= 5.5) { const v = el / (dtc * 360); (samples[bk] ??= []).push(v); allSamples.push(v); }
      if (dt >= 1 / 90 && dt <= 1 / 45) { ms60 += el; calls60++; }
    }
    clock += Math.min(Math.max(dt, 0), 1 / 20);
    if (!checkState(`step ${s} dt=${dt.toFixed(5)}`)) { ok = false; break; }
    // drain every frame, except in a 300-step window every 2500 steps (events pile up: tests the queue cap, spam check skipped)
    if (s % 2500 >= 100 && s % 2500 < 400) { skipSpam = true; }
    else { drain(`step ${s}`); skipSpam = false; }
    if (s % 500 === 499) hashes.push(b.stateHash());
  }
  notes.resets = b.debug.safetyResets;
  if (b.debug.safetyResets > 0) fail(`debug.safetyResets = ${b.debug.safetyResets} (a non-finite state occurred internally and was papered over)`);

  // ---- release everything, gravity on, settle
  let settleT = -1;
  let simSeconds = clock;
  if (ok) {
    b.fingerUp(0); b.fingerUp(1); b.grabRelease(0); b.grabRelease(1);
    b.gravity = true;
    const DT = 1 / 60;
    let below = 0, t = 0;
    const maxN = Math.round(SETTLE_MAX_S / DT);
    for (let i = 0; i < maxN; i++) {
      b.step(DT); t += DT;
      if (!checkState(`settle ${t.toFixed(2)}s`)) { ok = false; break; }
      if (b.metrics.kinetic < 0.02) { if (below === 0) settleT = t; below++; } else { below = 0; settleT = -1; }
    }
    simSeconds += t;
    if (ok) {
      // must be settled (and stay settled for the trailing >= 0.5 s of the window)
      if (settleT < 0 || below < 30) fail(`did not settle within ${SETTLE_MAX_S} s (kinetic=${b.metrics.kinetic.toFixed(4)}, trailing quiet frames ${below})`);
      notes.settleT = settleT;
      const vr = b.metrics.volume;
      notes.settledVol = vr;
      if (!(vr >= 0.8 && vr <= 1.2)) fail(`settled volume ratio ${vr.toFixed(4)} outside 0.8..1.2`);
      const sh = settledShape(b);
      notes.settledShapeRmsPct = sh.rms * 100;
      notes.maxFlipDeg = sh.maxFlipDeg;
      notes.flippedTris = sh.flipped;
      if (sh.flipped > 0) fail(`${sh.flipped} triangles flipped > 120 deg vs rest when settled (max ${sh.maxFlipDeg.toFixed(1)} deg)`);
      if (sh.rms > 0.15) fail(`settled shape error ${(sh.rms * 100).toFixed(1)}% R (>15%: the body is stuck deformed)`);
      notes.settledCenterY = b.center.y;
    }
  }
  hashes.push(b.stateHash());
  return {
    idx, label: labelFor(idx), steps, simSeconds, fails, notes, hashes, finalHash: b.stateHash(),
    msAll, callsAll, ms60, calls60, msPerSubstep: subTotal > 0 ? msAll / subTotal : 0, buckets, samples, spikes,
  };
}

interface PerfResult { idx: number; label: string; restBest: number; restMed: number; contactBest: number; contactMed: number; contactP99Best: number; pinchBest: number; grabBest: number }
/** Cost at nominal 60 Hz frames: rest, a held press with rubbing, a pinch, a pulled lobe. Best and median of 8 batches x 250 steps. */
function perf(idx: number): PerfResult {
  const g = genomeFor(idx);
  const batches = (b: SoftBody, each: (i: number) => void): { best: number; med: number; p99best: number } => {
    const ms: number[] = [], p99s: number[] = [];
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const arr: number[] = [];
      for (let i = 0; i < 250; i++) { each(n++); const t0 = tcpu(); b.step(1 / 60); arr.push(tcpu() - t0); }
      ms.push(arr.reduce((x, y) => x + y, 0) / arr.length);
      arr.sort((x, y) => x - y); p99s.push(arr[Math.floor(arr.length * 0.99)]);
    }
    const sorted = ms.slice().sort((x, y) => x - y);
    return { best: sorted[0], med: sorted[4], p99best: Math.min(...p99s) };
  };
  const mk = (): SoftBody => { const b = new SoftBody(g, { detail: DETAIL }); for (let i = 0; i < 120; i++) b.step(1 / 60); return b; };
  const rest = batches(mk(), () => {});
  const R0 = new SoftBody(g, { detail: DETAIL }).restRadius;
  // held press + rub
  const b1 = mk();
  const h1 = b1.raycast({ x: 0.2 * R0, y: 3 * R0, z: 0 }, { x: 0, y: -1, z: 0 })!;
  b1.fingerDown(0, { point: h1.point, normal: h1.normal, dir: { x: 0, y: -1, z: 0 } });
  b1.fingerPressure(0, 1);
  const press = batches(b1, (i) => { const a = i * 0.05; b1.fingerMove(0, { x: h1.point.x + 0.15 * R0 * Math.sin(a), y: h1.point.y, z: h1.point.z + 0.15 * R0 * Math.cos(a) }); });
  // pinch
  const b2 = mk();
  const l = b2.raycast({ x: -3 * R0, y: 0.35 * R0, z: 0 }, { x: 1, y: 0, z: 0 })!, r = b2.raycast({ x: 3 * R0, y: 0.35 * R0, z: 0 }, { x: -1, y: 0, z: 0 })!;
  b2.fingerDown(0, { point: l.point, normal: l.normal, dir: { x: 1, y: 0, z: 0 } }); b2.fingerDown(1, { point: r.point, normal: r.normal, dir: { x: -1, y: 0, z: 0 } });
  b2.fingerPressure(0, 1); b2.fingerPressure(1, 1);
  const pinch = batches(b2, () => {});
  // pull
  const b3 = mk();
  const v = b3.raycast({ x: 0, y: 3 * R0, z: 0 }, { x: 0, y: -1, z: 0 })!.vertex;
  b3.grab(0, v, { x: b3.positions[v * 3], y: b3.positions[v * 3 + 1], z: b3.positions[v * 3 + 2] });
  const grab = batches(b3, (i) => { const a = i * 0.03; b3.grabMove(0, { x: b3.positions[v * 3] * 0 + 1.2 * R0 * Math.sin(a), y: 2.2 * R0 + 0.5 * R0 * Math.sin(a * 0.7), z: 0.8 * R0 * Math.cos(a) }); });
  return { idx, label: labelFor(idx), restBest: rest.best, restMed: rest.med, contactBest: press.best, contactMed: press.med, contactP99Best: press.p99best, pinchBest: pinch.best, grabBest: grab.best };
}

function job(idx: number): { a: RunResult; determinismFails: string[]; pf: PerfResult } {
  const a = runScript(idx, STEPS, true);
  const bRes = runScript(idx, STEPS, true);
  const detFails: string[] = [];
  const n = Math.max(a.hashes.length, bRes.hashes.length);
  for (let i = 0; i < n; i++) {
    if (a.hashes[i] !== bRes.hashes[i]) { detFails.push(`stateHash differs at checkpoint ${i} (${a.hashes[i]} vs ${bRes.hashes[i]})`); break; }
  }
  if (a.finalHash !== bRes.finalHash) detFails.push(`final stateHash differs (${a.finalHash} vs ${bRes.finalHash})`);
  const sa = Object.keys(a.spikes).map(Number), sb = new Set(Object.keys(bRes.spikes).map(Number));
  a.notes.spikesRun1 = sa.length; a.notes.spikesRun2 = sb.size; a.notes.spikesBoth = sa.filter((x) => sb.has(x)).length;
  if (process.env.VERIFY_SPIKES) console.log(a.label, 'both-run spikes:', sa.filter((x) => sb.has(x)).map((x) => `#${x}:${a.spikes[x].toFixed(1)}/${bRes.spikes[x].toFixed(1)}ms`).join(' '), '| run1-only count', sa.length);
  const pf = perf(idx);
  return { a, determinismFails: detFails, pf };
}

if (isMainThread) {
  const idxs = ONLY.length ? ONLY : Array.from({ length: 16 }, (_, i) => i);
  const nw = Math.min(4, idxs.length);
  const buckets: number[][] = Array.from({ length: nw }, () => []);
  idxs.forEach((v, i) => buckets[i % nw].push(v));
  const t0 = Date.now();
  const results: { a: RunResult; determinismFails: string[]; pf: PerfResult }[] = [];
  let pending = nw;
  for (const bk of buckets) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: bk, steps: STEPS, detail: DETAIL }, argv: process.argv.slice(2) });
    w.on('message', (m: { a: RunResult; determinismFails: string[]; pf: PerfResult }) => { results.push(m); const r = m.a; console.log(`done ${r.label} steps=${r.steps} fails=${r.fails.length + m.determinismFails.length}`); });
    w.on('error', (e) => { console.error('worker error', e); process.exitCode = 2; });
    w.on('exit', () => { if (--pending === 0) finish(); });
  }
  const finish = (): void => {
    results.sort((x, y) => x.a.idx - y.a.idx);
    let bad = 0;
    const buckets: Record<string, [number, number]> = {};
  const samples: Record<string, number[]> = {};
  const allSamples: number[] = [];
  const spikes: Record<number, number> = {};
  let msAll = 0, callsAll = 0, ms60 = 0, calls60 = 0, msSub = 0;
    console.log('\nlabel  steps  simSec  settle  setVol  shape%  minVol maxVol  minY/R  maxCtrDist  evts spam  resets  vol<.85|>1.15  mean ms/step  ms@60Hz  ms/60Hz-equiv');
    for (const { a, determinismFails } of results) {
      const n = a.notes;
      const all = [...a.fails, ...determinismFails];
      if (all.length) bad++;
      msAll += a.msAll; callsAll += a.callsAll; ms60 += a.ms60; calls60 += a.calls60; msSub += a.msPerSubstep;
      console.log(
        `${a.label}  ${a.steps}  ${a.simSeconds.toFixed(0).padStart(6)}  ${(n.settleT ?? NaN).toFixed(2)}  ${(n.settledVol ?? NaN).toFixed(4)}  ${(n.settledShapeRmsPct ?? NaN).toFixed(2)}  ` +
        `${n.minVol.toFixed(3)}  ${n.maxVol.toFixed(3)}  ${(n.minY_R * 100).toFixed(3)}%  ${n.maxCenterDist.toFixed(2)}  ${n.events}  ${n.eventSpam}  ${n.resets}  ${n.volViolations085_115}  ` +
        `${(a.msAll / Math.max(1, a.callsAll)).toFixed(3)}  ${(a.ms60 / Math.max(1, a.calls60)).toFixed(3)}  ${(a.msPerSubstep * 6).toFixed(3)}`,
      );
      for (const f of all) console.log(`   FAIL ${a.label}: ${f}`);
    }
    console.log('\nPERF at 1/60 frames (ms/step, best | median of 8 batches x 250): label rest | held press+rub | pinch | pull    (p99 of best press batch)');
    for (const { pf } of results) console.log(`${pf.label}  ${pf.restBest.toFixed(3)} | ${pf.restMed.toFixed(3)}   ${pf.contactBest.toFixed(3)} | ${pf.contactMed.toFixed(3)}   ${pf.pinchBest.toFixed(3)}   ${pf.grabBest.toFixed(3)}   (${pf.contactP99Best.toFixed(3)})`);
    {
      let s1 = 0, s2 = 0, sb = 0;
      for (const { a } of results) { s1 += a.notes.spikesRun1; s2 += a.notes.spikesRun2; sb += a.notes.spikesBoth; }
      console.log(`\nspikes (> 8 ms per 1/60-equivalent, steps with >= 6 substeps): run1 ${s1}, run2 ${s2}, same step index in both runs ${sb}  (reproducible spikes would be state-dependent cost; random ones are machine noise)`);
    }
    console.log(`\nmean step() over all calls (mixed dt): ${(msAll / Math.max(1, callsAll)).toFixed(3)} ms; at nominal 1/60 frames (dt in 1/90..1/45): ${(ms60 / Math.max(1, calls60)).toFixed(3)} ms; per 1/60-equivalent (6 substeps): ${(msSub / results.length * 6).toFixed(3)} ms`);
    {
      const agg: Record<string, [number, number]> = {};
      for (const { a } of results) for (const [k, v] of Object.entries(a.buckets)) { const e = (agg[k] ??= [0, 0]); e[0] += v[0]; e[1] += v[1]; }
      const sm: Record<string, number[]> = {};
      for (const { a } of results) for (const [k, v] of Object.entries(a.samples)) (sm[k] ??= []).push(...v);
      const q = (arr: number[], p: number): number => { const t = arr.slice().sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(t.length * p))]; };
      console.log('cost per 1/60-equivalent (x6 substeps) by state, from the fuzz (steps with >= 6 substeps): mean-of-all-time | median | p90 | p99   (ms)');
      for (const [k, v] of Object.entries(agg).sort((x, y) => y[1][1] - x[1][1])) {
        const s2 = sm[k] ?? [];
        console.log(`  ${k.padEnd(26)} ${(v[0] / Math.max(1, v[1]) * 6).toFixed(3)} | ${s2.length ? (q(s2, 0.5) * 6).toFixed(3) : '-'} | ${s2.length ? (q(s2, 0.9) * 6).toFixed(3) : '-'} | ${s2.length ? (q(s2, 0.99) * 6).toFixed(3) : '-'}   n=${s2.length}`);
      }
      const all: number[] = [];
      for (const k in sm) all.push(...sm[k]);
      console.log(`ALL FUZZ STATES (steps >= 6 substeps, n=${all.length}): median ${(q(all, 0.5) * 6).toFixed(3)} ms per 1/60-equivalent, p90 ${(q(all, 0.9) * 6).toFixed(3)}, p99 ${(q(all, 0.99) * 6).toFixed(3)}`);
    }
    console.log(`wall ${((Date.now() - t0) / 1000).toFixed(1)} s, ${results.length} genomes, ${bad} with failures`);
    try {
      mkdirSync(resolve(here, '_reports'), { recursive: true });
      writeFileSync(resolve(here, '_reports/verify_phys_fuzz.json'), JSON.stringify(results, null, 1));
    } catch { /* ignore */ }
    process.exitCode = bad ? 1 : 0;
  };
} else {
  for (const idx of workerData.jobs as number[]) parentPort!.postMessage(job(idx));
}
