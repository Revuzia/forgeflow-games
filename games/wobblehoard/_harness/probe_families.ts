// WOBBLEHOARD physics probe: MATERIAL FAMILIES (physics round 2). Each of the 12 families of src/data/materials.ts is measured on the
// same body (the DOLLOP shape, a neutral genome, the family forced with `family`), so what differs is the material, not the shape:
//   * press-hold-release: a full-pressure press on the shoulder for 1.5 s, then 12 s of recovery: rotation- and translation-free shape
//     error against the rest shape (rest radii), volume, the slow-rise / puff-back / held dent / heal signature;
//   * rate stiffening: the push-back the fingertip meets at the same depth for a fast poke (ramp 0.05 s) against a slow press (1.5 s);
//   * slosh: a 1 m/s sideways nudge, the liquid core's swing frequency and damping (water fill, bead squeeze);
//   * tack: the strands signal while a fingertip pulls off a held press (sticky stretch, slime);
//   * jam: compression under a full press with and without the family's jam (bead squeeze);
//   * a feel vector per family from the measurements, and every pair of families at least FEEL_MIN apart (jelly gel / firm silicone 2x).
// Every assertion names the documented target it checks (SQUISHY_SCIENCE.md sections 3-4, materials.ts). Deterministic.
//   node _harness/probe_families.ts            all checks, exit 1 on a failure
//   node _harness/probe_families.ts --list     also print every family's raw measurements
import { SoftBody } from '../src/physics/softbody.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { MATERIAL_FAMILY_IDS, MATERIAL_FAMILIES, resolveMaterial, recoverySeconds95 } from '../src/data/materials.ts';
import type { MaterialFamilyId } from '../src/data/materials.ts';
import type { V3 } from '../src/contracts.ts';

const DT = 1 / 60;
const LIST = process.argv.includes('--list');
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const NEUTRAL: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 });
/** Two families closer than this on the normalised feel vector read as the same material (see feel()). */
const FEEL_MIN = 0.06;

function polar(A: number[]): number[] {
  let M = A.slice();
  for (let it = 0; it < 40; it++) {
    const [a, b, c, d, e, f, g, h, i] = M;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-18) break;
    const id = 1 / det;
    const it_ = [(e * i - f * h) * id, -(d * i - f * g) * id, (d * h - e * g) * id, -(b * i - c * h) * id, (a * i - c * g) * id, -(a * h - b * g) * id, (b * f - c * e) * id, -(a * f - c * d) * id, (a * e - b * d) * id];
    const N = M.map((v, k) => 0.5 * (v + it_[k]));
    let diff = 0;
    for (let k = 0; k < 9; k++) diff += Math.abs(N[k] - M[k]);
    M = N;
    if (diff < 1e-12) break;
  }
  return M;
}
let lastMax = 0;   // shapeErr's side result: the largest single-particle displacement (the dent depth), rest radii
/** Rest-shape error after removing translation and rotation, in rest radii (RMS over the particles; the largest one in lastMax). */
function shapeErr(b: SoftBody): number {
  const n = b.vertexCount, P = b.positions, Q = b.restLocal;
  let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
  for (let i = 0; i < n; i++) { px += P[i * 3]; py += P[i * 3 + 1]; pz += P[i * 3 + 2]; qx += Q[i * 3]; qy += Q[i * 3 + 1]; qz += Q[i * 3 + 2]; }
  px /= n; py /= n; pz /= n; qx /= n; qy /= n; qz /= n;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - px, y = P[i * 3 + 1] - py, z = P[i * 3 + 2] - pz, a = Q[i * 3] - qx, bb = Q[i * 3 + 1] - qy, c = Q[i * 3 + 2] - qz;
    A[0] += x * a; A[1] += x * bb; A[2] += x * c; A[3] += y * a; A[4] += y * bb; A[5] += y * c; A[6] += z * a; A[7] += z * bb; A[8] += z * c;
  }
  const R = polar(A);
  let s = 0, mx = 0;
  for (let i = 0; i < n; i++) {
    const a = Q[i * 3] - qx, bb = Q[i * 3 + 1] - qy, c = Q[i * 3 + 2] - qz;
    const gx = px + R[0] * a + R[1] * bb + R[2] * c, gy = py + R[3] * a + R[4] * bb + R[5] * c, gz = pz + R[6] * a + R[7] * bb + R[8] * c;
    const d2 = (P[i * 3] - gx) ** 2 + (P[i * 3 + 1] - gy) ** 2 + (P[i * 3 + 2] - gz) ** 2;
    s += d2; if (d2 > mx) mx = d2;
  }
  lastMax = Math.sqrt(mx) / b.restRadius;
  return Math.sqrt(s / n) / b.restRadius;
}
const body = (fam: string, extra: Record<string, unknown> = {}): SoftBody => new SoftBody(NEUTRAL, { family: fam, ...extra } as never);
const run = (b: SoftBody, secs: number, each?: (t: number) => void): void => { const k = Math.round(secs / DT); for (let i = 0; i < k; i++) { b.step(DT); each?.((i + 1) * DT); } };
function press(b: SoftBody, x = 0.22): boolean {
  const R = b.restRadius, h = b.raycast(v3(b.center.x + (x / 0.5125) * R, 6 * R, b.center.z), v3(0, -1, 0));
  if (!h) return false;
  b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) });
  return true;
}
/** The push-back the fingertips met this step, unsaturated (SoftBody.debug.force, m/s^2 per unit body mass; metrics.reaction saturates it). */
const forceOf = (b: SoftBody): number => (b.debug as { force?: number }).force ?? 0;

interface PressResult { dentPeak: number; dent05: number; dent3: number; dent10: number; force: number; volBack: number; peak: number; e025: number; e05: number; e1: number; e3: number; e6: number; e10: number; e12: number; volMin: number; vol025: number; vol1: number; vol3: number; back95: number; comp: number; wobble: number; strandsMax: number; strandsT: number; hash: number }
/** Full-pressure press on the shoulder for 1.5 s, release, 12 s of recovery. */
function pressRelease(fam: string, extra: Record<string, unknown> = {}): PressResult {
  const b = body(fam, extra);
  run(b, 1);
  press(b); b.fingerPressure(0, 1);
  let peak = 0, volMin = 9, comp = 0, force = 0, fn = 0, t = 0;
  run(b, 1.5, () => { t += DT; volMin = Math.min(volMin, b.metrics.volume); comp = Math.max(comp, b.metrics.compression); if (t > 1) { force += forceOf(b); fn++; } });
  b.fingerUp(0);
  const r: PressResult = { dentPeak: 0, dent05: 0, dent3: 0, dent10: 0, force: force / Math.max(1, fn), volBack: 12, peak: 0, e025: 0, e05: 0, e1: 0, e3: 0, e6: 0, e10: 0, e12: 0, volMin, vol025: 0, vol1: 0, vol3: 0, back95: 12, comp, wobble: 0, strandsMax: 0, strandsT: 0, hash: 0 };
  const errs: number[] = [], ts: number[] = [], tops: number[] = [], vols: number[] = [];
  run(b, 12, (t) => {
    const e = shapeErr(b); errs.push(e); ts.push(t); vols.push(b.metrics.volume);
    if (t < 0.06) r.dentPeak = Math.max(r.dentPeak, lastMax);
    if (Math.abs(t - 0.5) < DT / 2) r.dent05 = lastMax;
    if (Math.abs(t - 3) < DT / 2) r.dent3 = lastMax;
    if (Math.abs(t - 10) < DT / 2) r.dent10 = lastMax;
    let top = -9; for (let i = 1; i < b.positions.length; i += 3) top = Math.max(top, b.positions[i]); tops.push(top);
    r.volMin = Math.min(r.volMin, b.metrics.volume);
    const st = b.metrics.strands ?? 0; if (st > r.strandsMax) r.strandsMax = st; if (st > 0.05) r.strandsT = t;
    if (Math.abs(t - 0.25) < DT / 2) { r.e025 = e; r.vol025 = b.metrics.volume; }
    if (Math.abs(t - 0.5) < DT / 2) r.e05 = e;
    if (Math.abs(t - 1) < DT / 2) { r.e1 = e; r.vol1 = b.metrics.volume; }
    if (Math.abs(t - 3) < DT / 2) { r.e3 = e; r.vol3 = b.metrics.volume; }
    if (Math.abs(t - 6) < DT / 2) r.e6 = e;
    if (Math.abs(t - 10) < DT / 2) r.e10 = e;
  });
  r.e12 = errs[errs.length - 1];
  peak = Math.max(...errs.slice(0, 3)); r.peak = peak;
  // back95: the shape error stays within 5% of the dent (or the 0.02 R noise floor) and the volume within 1% from then on
  const thr = Math.max(0.02, 0.05 * peak);
  let k = errs.length - 1;
  while (k > 0 && errs[k] <= thr) k--;
  r.back95 = k >= errs.length - 1 ? 12 : ts[k];
  // volBack: the volume is back within 5% of its dip (and within 1% of the rest volume) from then on
  const vthr = Math.max(0.005, 0.05 * (1 - r.volMin));
  k = vols.length - 1;
  while (k > 0 && 1 - vols[k] <= vthr) k--;
  r.volBack = k >= vols.length - 1 ? 12 : ts[k];
  // wobble: overshoots of the top height (about its final value) larger than 1% R after the release
  const topEnd = tops[tops.length - 1], hs = tops.map((y) => (y - topEnd) / b.restRadius);
  let n = 0, sign = 0;
  for (let i = 1; i < hs.length - 1; i++) {
    if ((hs[i] - hs[i - 1]) * (hs[i + 1] - hs[i]) <= 0 && Math.abs(hs[i]) > 0.01) { const sg = Math.sign(hs[i]); if (sg !== sign) { n++; sign = sg; } }
  }
  r.wobble = Math.floor(n / 2);
  r.hash = b.stateHash();
  return r;
}

/** Peak push-back at the same depth: fast ramp (0.05 s) against slow ramp (1.5 s), both to pressure 0.7 and held 0.3 s (debug.force). */
function rateRatio(fam: string): { fast: number; slow: number; ratio: number } {
  const one = (ramp: number): number => {
    const b = body(fam);
    run(b, 1);
    press(b);
    let mx = 0, t = 0;
    run(b, ramp + 0.3, () => { t += DT; b.fingerPressure(0, Math.min(0.7, 0.7 * t / ramp)); mx = Math.max(mx, forceOf(b)); });
    return mx;
  };
  const fast = one(0.05), slow = one(1.5);
  return { fast, slow, ratio: fast / Math.max(1e-9, slow) };
}

/** The core's swing after a sideways 1 m/s nudge (rest radii), and its free mode: on a body at rest the core is released from a 0.1 R
 *  offset (the solver's private state, set from the harness) and the frequency (extrema spacing) and damping ratio (log decrement) of
 *  the free swing are measured, so the shell's own rebound does not drive it. */
function slosh(fam: string): { hz: number; zeta: number; amp: number } {
  const b0 = body(fam), s0 = b0 as unknown as { slx: number };
  run(b0, 1);
  b0.nudge(v3(1, 0, 0));
  let amp = 0;
  run(b0, 3, () => { amp = Math.max(amp, Math.abs(s0.slx) / b0.restRadius); });
  const b = body(fam), sl = b as unknown as { slx: number; slvx: number };
  run(b, 1);
  sl.slx = 0.1 * b.restRadius; sl.slvx = 0;
  const xs: number[] = [];
  run(b, 3, () => xs.push(sl.slx));
  const ext: Array<{ i: number; v: number }> = [];
  for (let i = 1; i < xs.length - 1; i++) if ((xs[i] - xs[i - 1]) * (xs[i + 1] - xs[i]) < 0 && Math.abs(xs[i]) > 1e-5) ext.push({ i, v: xs[i] });
  if (ext.length < 3) return { hz: NaN, zeta: NaN, amp };
  const period = (2 * (ext[ext.length - 1].i - ext[0].i) / (ext.length - 1)) * DT;
  // log decrement over half periods: |v_k+1| / |v_k| = exp(-zeta pi / sqrt(1 - zeta^2))
  let s = 0, c = 0;
  for (let k = 0; k + 1 < Math.min(ext.length, 5); k++) { s += Math.log(Math.abs(ext[k].v) / Math.abs(ext[k + 1].v)); c++; }
  const d = s / c, zeta = d / Math.sqrt(Math.PI * Math.PI + d * d);
  return { hz: 1 / period, zeta, amp };
}

interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));

const t0 = performance.now();
const PR: Record<string, PressResult> = {};
const RR: Record<string, { fast: number; slow: number; ratio: number }> = {};
for (const fam of MATERIAL_FAMILY_IDS) { PR[fam] = pressRelease(fam); RR[fam] = rateRatio(fam); }
if (LIST) for (const fam of MATERIAL_FAMILY_IDS) { const p = PR[fam], r = RR[fam]; console.log(`${fam.padEnd(13)} peak ${f(p.peak)} e(.25/.5/1/3/6/10/12) ${[p.e025, p.e05, p.e1, p.e3, p.e6, p.e10, p.e12].map((x) => f(x)).join(' ')} vol min ${f(p.volMin)} .25 ${f(p.vol025)} 1 ${f(p.vol1)} 3 ${f(p.vol3)} back95 ${f(p.back95, 2)} s volBack ${f(p.volBack, 2)} s dent ${f(p.dentPeak)} .5 ${f(p.dent05)} 3 ${f(p.dent3)} 10 ${f(p.dent10)} force ${f(p.force, 1)} comp ${f(p.comp, 2)} wobble ${p.wobble} strands ${f(p.strandsMax, 2)} until ${f(p.strandsT, 2)} | rate ${f(r.fast, 1)}/${f(r.slow, 1)} = ${f(r.ratio, 2)}`); }

const doc = (fam: MaterialFamilyId) => resolveMaterial(fam, NEUTRAL);
// 1. incompressible fast families
for (const fam of ['jellygel', 'firmsilicone', 'gummy'] as const) {
  const p = PR[fam];
  add(`${fam}: recovers within 0.5 s of the release and keeps its volume (SQUISHY_SCIENCE 4: "noise level within 0.5 s", nu ~0.5)`, `shape error at +0.5 s ${f(p.e05)} R (dent ${f(p.peak)}), volume min ${f(p.volMin)}`, '<= 0.03 R, >= 0.97', p.e05 <= 0.03 && p.volMin >= 0.97);
}
// 2. slow rise
{
  const p = PR.slowrise, target = recoverySeconds95(doc('slowrise').physics);
  const back = Math.max(p.back95, p.volBack);
  add(`slowrise: sinks (volume dips: air leaves) and creeps back over its documented ~${f(target, 1)} s (recovery95; accepted 0.5x..2x; shape and volume both back within 5%)`, `volume min ${f(p.volMin)}, at +1 s ${f(p.vol1)}, +3 s ${f(p.vol3)}; shape back at ${f(p.back95, 2)} s, volume at ${f(p.volBack, 2)} s`, `dip <= 0.95, rising, ${f(target / 2, 1)}..${f(target * 2, 1)} s`, p.volMin <= 0.95 && p.vol3 > p.vol1 && back >= target / 2 && back <= target * 2);
}
// 3. marshmallow
{
  const p = PR.marshmallow, target = recoverySeconds95(doc('marshmallow').physics);
  const back = Math.max(p.back95, p.volBack);
  add(`marshmallow: squashes (volume dips) and puffs back in about a second (recovery95 ${f(target, 1)} s; accepted 0.3..2.5 s; shape and volume both back within 5%)`, `volume min ${f(p.volMin)}, at +1 s ${f(p.vol1)}; shape back at ${f(p.back95, 2)} s, volume at ${f(p.volBack, 2)} s`, 'dip <= 0.95, vol(+1 s) >= 0.97, 0.3..2.5 s', p.volMin <= 0.95 && p.vol1 >= 0.97 && back >= 0.3 && back <= 2.5);
}
// 4. mochi: thumb-print then heals
{
  const p = PR.mochidough;
  add('mochidough: keeps a thumb-print, then smooths itself out (dent depth = the largest particle displacement from the rest fit; hold ~memStiff x yield = 0.14 R0, healTau 2.5 s: "~90% gone after 5 s")', `dent ${f(p.dentPeak)} R at the release, +0.5 s ${f(p.dent05)}, +3 s ${f(p.dent3)}, +10 s ${f(p.dent10)}`, '+0.5 s >= 0.08 R, +10 s <= 0.04 R', p.dent05 >= 0.08 && p.dent10 <= 0.04);
}
// 5. putty: keeps ~1/3 of the dent > 10 s
{
  const p = PR.putty;
  add('putty: keeps about a third of the dent for more than 10 s (yield 0.07 R0 x memStiff 5: hold 0.35 R0 by design; SQUISHY_SCIENCE 3.3)', `dent ${f(p.dentPeak)} R at the release, +10 s ${f(p.dent10)} R = ${f(p.dent10 / p.dentPeak, 2)} of it`, '>= 0.25 of the dent', p.dent10 >= 0.25 * p.dentPeak);
}
// 6. slime oozes back slowly (no yield)
{
  const p = PR.slimegoo;
  add('slimegoo: oozes back slowly but completely (memTau 0.8 s x (1 + 3): ~5 s; no yield): a third of the dent still there after 1 s, all of it gone by 12 s', `shape error +1 s ${f(p.e1)} R (${f(p.e1 / p.peak, 2)} of ${f(p.peak)}), +12 s ${f(p.e12)} R`, '+1 s >= 0.25 of the dent, +12 s <= 0.02 R', p.e1 >= 0.25 * p.peak && p.e12 <= 0.02);
}
// 7. tack: strands
for (const fam of ['stickystretch', 'slimegoo'] as const) {
  const p = PR[fam];
  add(`${fam}: strings while the fingertip pulls off (metrics.strands; the P6 fallback: friction + a strands signal the renderer draws)`, `strands max ${f(p.strandsMax, 2)}, still > 0.05 at +${f(p.strandsT, 2)} s`, '>= 0.3, 0.05..0.8 s', p.strandsMax >= 0.3 && p.strandsT >= 0.05 && p.strandsT <= 0.8);
}
{
  const non = MATERIAL_FAMILY_IDS.filter((fam) => MATERIAL_FAMILIES[fam].physics.tack <= 0.25).filter((fam) => PR[fam].strandsMax > 0);
  add('no strands from a non-tacky family (tack <= 0.25)', non.length ? non.join(', ') : 'none', 'none', non.length === 0);
}
// 8. compressible families lose volume within their documented bleed, incompressible ones do not
for (const fam of MATERIAL_FAMILY_IDS) {
  const bleed = MATERIAL_FAMILIES[fam].physics.volBleedMax, lo = Math.min(0.85, 1 - bleed - 0.05);
  const p = PR[fam];
  if (!(p.volMin >= lo && p.volMin <= 1.15)) add(`${fam}: volume inside its band (CONTRACT 4.2: min(0.85, 1 - volBleedMax - 0.05) .. 1.15)`, f(p.volMin), `${f(lo, 2)}..1.15`, false);
}
add('every family keeps its volume inside its documented band under a full press (CONTRACT 4.2: lower bound min(0.85, 1 - volBleedMax - 0.05))', MATERIAL_FAMILY_IDS.map((fam) => `${fam} ${f(PR[fam].volMin, 2)}`).join(', '), 'each in band', MATERIAL_FAMILY_IDS.every((fam) => PR[fam].volMin >= Math.min(0.85, 1 - MATERIAL_FAMILIES[fam].physics.volBleedMax - 0.05)));
// 9. rate stiffening
{
  const sd = (fam: MaterialFamilyId): number => MATERIAL_FAMILIES[fam].physics.speedDamp;
  const order = [...MATERIAL_FAMILY_IDS].sort((a, b) => sd(a) - sd(b));
  const lo = order.slice(0, 3), hi = order.slice(-3);
  const mean = (l: readonly MaterialFamilyId[]): number => l.reduce((a, c) => a + RR[c].ratio, 0) / l.length;
  add(`rate stiffening: a fast poke (0.05 s ramp) meets more push-back than a slow press (1.5 s) at the same depth, more so for the high-speedDamp families (${hi.join(', ')}) than for the low ones (${lo.join(', ')}); SQUISHY_SCIENCE 3.6`, `ratio high ${f(mean(hi), 2)} vs low ${f(mean(lo), 2)}; every family ${MATERIAL_FAMILY_IDS.map((fam) => `${fam} ${f(RR[fam].ratio, 2)}`).join(', ')}`, 'every ratio > 1, high > low', MATERIAL_FAMILY_IDS.every((fam) => RR[fam].ratio > 1) && mean(hi) > mean(lo));
}
// 10. slosh
for (const fam of ['waterfill', 'beadsqueeze'] as const) {
  const s = slosh(fam), m = doc(fam).solver;
  add(`${fam}: the core swings after a sideways 1 m/s nudge, and its free swing has the documented frequency and damping (sloshHz ${f(m.sloshHz, 2)}, zeta ${f(m.sloshZeta, 2)}; accepted 0.7x..1.5x Hz, zeta 0.5x..2x)`, `${f(s.hz, 2)} Hz, zeta ${f(s.zeta, 2)}, swing after the nudge ${f(s.amp, 3)} R`, 'in band, swing >= 0.01 R', s.hz >= 0.7 * m.sloshHz && s.hz <= 1.5 * m.sloshHz && s.zeta >= 0.5 * m.sloshZeta && s.zeta <= 2 * m.sloshZeta && s.amp >= 0.01);
}
// 11. jam
{
  const m = doc('beadsqueeze').solver;
  const withJam = pressRelease('beadsqueeze'), noJam = pressRelease('beadsqueeze', { mat: { ...m, jam: 0 } });
  add('beadsqueeze jams: held at the same full press it pushes back harder than the same beads without jam (stiffness x (1 + 6 jam c^2))', `push-back ${f(withJam.force, 1)} with jam ${f(m.jam, 2)} vs ${f(noJam.force, 1)} without (compression ${f(withJam.comp, 2)} vs ${f(noJam.comp, 2)})`, '>= 1.1x', withJam.force >= 1.1 * noJam.force);
}
// 12. feel vector: pairwise distinguishable
{
  const feel = (fam: string): number[] => {
    const p = PR[fam], r = RR[fam], pk = Math.max(1e-3, p.peak);
    // GIVE (axis 11, physics round-2 fix round): how deep the same full press goes (the dent at the release, rest radii / 0.4). Until the
    // fix round every family was pressed exactly as deep (the fingertip is position-driven), so the vector had no give axis; since a
    // stiffer material gives less (softbody.ts GIVE_EXP), the vector must see it, or a firm silicone that gives half as much reads as a gel.
    return [p.e025 / pk, p.e1 / pk, p.e3 / pk, p.dent10 / Math.max(1e-3, p.dentPeak), (1 - p.volMin) * 3, Math.min(1, Math.max(p.back95, p.volBack) / 6), Math.log(r.ratio) / 3, Math.min(1, p.wobble / 4), p.strandsMax, Math.log(Math.max(1, p.force)) / 5, Math.min(1, p.dentPeak / 0.4)];
  };
  let best = { a: '', b: '', d: Infinity };
  const F = MATERIAL_FAMILY_IDS.map((fam) => feel(fam));
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
    const d = Math.sqrt(F[i].reduce((s, v, k) => s + (v - F[j][k]) ** 2, 0) / F[i].length);
    if (d < best.d) best = { a: MATERIAL_FAMILY_IDS[i], b: MATERIAL_FAMILY_IDS[j], d };
  }
  if (LIST) {
    // the distance of every pair, and on the round-2 10-axis vector (without give) for comparison
    const rows: string[] = [];
    for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
      const d11 = Math.sqrt(F[i].reduce((s, v, k) => s + (v - F[j][k]) ** 2, 0) / F[i].length);
      const d10 = Math.sqrt(F[i].slice(0, 10).reduce((s, v, k) => s + (v - F[j][k]) ** 2, 0) / 10);
      rows.push(`${d11.toFixed(3)} (10-axis ${d10.toFixed(3)}) ${MATERIAL_FAMILY_IDS[i]} / ${MATERIAL_FAMILY_IDS[j]}`);
    }
    console.log('closest pairs:\n  ' + rows.sort().slice(0, 8).join('\n  '));
  }
  add(`families are pairwise distinguishable on the measured feel vector (recovery curve at 0.25 / 1 / 3 s, dent kept at 10 s, volume dip, recovery time, rate ratio, wobble, strands, held push-back, give; RMS over 11 axes); closest pair ${best.a} / ${best.b}`, f(best.d, 3), `>= ${FEEL_MIN}`, best.d >= FEEL_MIN);
  // physics round-2 fix round: the two elastic families the round-2 review found nearly identical (0.061) must be told apart with a margin
  {
    const gi = MATERIAL_FAMILY_IDS.indexOf('jellygel'), si = MATERIAL_FAMILY_IDS.indexOf('firmsilicone');
    const d = Math.sqrt(F[gi].reduce((s, v, k) => s + (v - F[si][k]) ** 2, 0) / F[gi].length);
    if (LIST) console.log(`feel jellygel     ${F[gi].map((x) => f(x)).join(' ')}\nfeel firmsilicone ${F[si].map((x) => f(x)).join(' ')}`);
    add(`jelly gel and firm silicone feel different with a margin (the gel bulges and wobbles, the silicone gives less and snaps back: give ${f(PR.jellygel.dentPeak)} vs ${f(PR.firmsilicone.dentPeak)} R, push-back ${f(PR.jellygel.force, 1)} vs ${f(PR.firmsilicone.force, 1)}, left at 0.25 s ${f(PR.jellygel.e025 / Math.max(1e-3, PR.jellygel.peak))} vs ${f(PR.firmsilicone.e025 / Math.max(1e-3, PR.firmsilicone.peak))})`, f(d, 3), `>= ${2 * FEEL_MIN} (2 x the bar)`, d >= 2 * FEEL_MIN);
  }
}
// 13. determinism
{
  const a = pressRelease('putty').hash, b = pressRelease('putty').hash, c = pressRelease('waterfill').hash, d = pressRelease('waterfill').hash;
  add('determinism: the same press twice gives the same state hash (putty: memory arm; water fill: slosh)', `${a === b}, ${c === d}`, 'true, true', a === b && c === d);
}

let failed = 0;
for (const r of rows) { if (!r.pass) failed++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`); }
console.log(`${rows.length - failed}/${rows.length} family checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
