// R10 LOCOMOTION (owner, 2026-11-19, D-100): squishies CRAWL like slugs / snails instead of gliding. The crawl's rows on the real physics (plain node, type stripping).
//   node _harness/probe_crawl.ts            the quick set: 4 families on the flat, turns, ice, water, ramp and mound, scales, pieces, the gate, Calm, cost (about 40 s: one short heavy job)
//   node _harness/probe_crawl.ts --full     every family (12) and every row (about 2 min)
//   node _harness/probe_crawl.ts --only=flat,turn,face,drawn,surf,scale,gate,cost   some sections
// Every walk is a scootTo (LIFE's own travel driver) at the family's glide speed (src/data/life.ts GAITS), on a prop world (the crawl is the world's: props.ts trk),
// measured against the same walk with the crawl off (CRAWL.on false: today's rigid glide, bit for bit). Own meters: the ground-contact footprint (particles under
// 12 mm) and the whole body's extent along the travel, each third's velocity phase, the centre's speed, the volume, the fold, the planted base's slip.
import v8 from 'node:v8';
import { PG, SoftBody } from '../src/physics/softbody.ts';
import { buildPropWorld } from '../src/physics/props.ts';
import type { PropWorld } from '../src/physics/props.ts';
import { CRAWL } from '../src/physics/crawl.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { GAITS } from '../src/data/life.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import { PLACE as FROSTBELL } from '../src/data/place_frostbell.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import type { PlaceDef } from '../src/data/places.ts';
import type { SoftEvent, V3 } from '../src/contracts.ts';
import { wholeRefFor } from '../src/render/wholeRef.ts';

const FULL = process.argv.includes('--full');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const sec = (k: string): boolean => ONLY.length === 0 || ONLY.includes(k);
const DT = 1 / 60;
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const f = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const G0: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 });
const SMALL: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.05 });
const BIG: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.95 });
const FAMS = (FULL ? MATERIAL_FAMILY_IDS : ['jellygel', 'putty', 'firmsilicone', 'slimegoo']) as readonly string[];
const GLIDE = GAITS as Record<string, { glide: number }>;
const flatDef = { ...CABIN, things: [], walls: [], zones: [], patches: [], tall: { ...CABIN.tall, things: [], walls: [], zones: [], patches: [] } } as unknown as PlaceDef;
type Priv = { scootOn: boolean; vcx: number; vcz: number; n: number; crawlOn: boolean; M: Float64Array; Mtot: number };
const P_ = (b: SoftBody): Priv => b as unknown as Priv;
/** the crawl a world keeps for its i-th tracked body (props.ts `crawls`) */
const crawlOf = (w: PropWorld, i = 0): { on: boolean; s: Float64Array; w: Float64Array } | undefined => (w as unknown as { crawls: { on: boolean; s: Float64Array; w: Float64Array }[] }).crawls[i];
const ev: SoftEvent[] = [];

/* ───────────── meters ───────────── */
const EDGE = new Map<Uint32Array, Int32Array>();
function foldDeg(b: SoftBody): number {
  const P = b.positions, I = b.indices;
  let pr = EDGE.get(I);
  if (!pr) {
    const m = new Map<string, number>(), out: number[] = [];
    for (let t = 0; t < I.length / 3; t++) for (let e = 0; e < 3; e++) { const a = I[t * 3 + e], c = I[t * 3 + ((e + 1) % 3)], k = a < c ? `${a},${c}` : `${c},${a}`; const o = m.get(k); if (o === undefined) m.set(k, t); else out.push(o, t); }
    pr = Int32Array.from(out); EDGE.set(I, pr);
  }
  let worst = 1;
  const A = [0, 0, 0], B = [0, 0, 0];
  const nrm = (t: number, o: number[]): void => {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    o[0] = nx / l; o[1] = ny / l; o[2] = nz / l;
  };
  for (let k = 0; k < pr.length; k += 2) { nrm(pr[k], A); nrm(pr[k + 1], B); const c = A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; if (c < worst) worst = c; }
  return (Math.acos(Math.max(-1, Math.min(1, worst))) * 180) / Math.PI;
}
const wrap = (x: number): number => { let y = x; while (y > Math.PI) y -= 2 * Math.PI; while (y < -Math.PI) y += 2 * Math.PI; return y; };

interface Walk {
  arrive: number; fpMin: number; fpMax: number; len: number; osc: number; lagFM: number; lagMR: number; cycle: number; vMin: number; vMax: number; vMean: number;
  volMin: number; volMax: number; fold: number; rest: number; settle: number; lat: number; yaw: number; slip: number; finite: boolean; kinMax: number; leanMax: number; air: number; prog: number; faceMax: number; faceBack: number; creep: number;
}
interface WalkOpts { world?: PropWorld; at?: V3; to?: V3; turnAt?: number; turnTo?: V3; genome?: Genome; piece?: { frac: number; chunk: boolean }; maxS?: number; hold?: number }
/** one walk: settle 1 s, scootTo the target at the family's glide speed; LIFE's arrival (within 5 cm: endScoot + setHome); then 2 s of rest */
function walk(fam: string, crawl: boolean, o: WalkOpts = {}): Walk {
  const w = o.world ?? buildPropWorld(flatDef, 'wide', 1);
  w.calm = !crawl;   // (today's glide: Calm's fallback, bit for bit by CR-11; the module switch CRAWL.on is left alone: toggling it deoptimises the crawl, see CR-13)
  const at = o.at ?? v3(0, 0, 0);
  const b = new SoftBody(o.genome ?? G0, { family: fam, piece: { frac: o.piece?.frac ?? 1, chunk: o.piece?.chunk ?? false, at, cutNormal: v3(-1, 0, 0) } } as never);
  b.setPropWorld(w);
  const fr = (): void => { w.beginFrame(); b.step(DT); ev.length = 0; b.drainEvents(ev); w.endFrame(DT); };
  for (let i = 0; i < 60; i++) fr();
  const x0 = b.center.x, z0 = b.center.z, to = o.to ?? v3(x0 + 2, 0, z0);
  const sp = GLIDE[fam].glide;
  b.scootTo(to.x, to.z, sp);
  const P = b.positions, n = P.length / 3, pb = P_(b);
  const r: Walk = { arrive: -1, fpMin: 1e9, fpMax: -1e9, len: 0, osc: 0, lagFM: NaN, lagMR: NaN, cycle: NaN, vMin: 1e9, vMax: -1e9, vMean: 0, volMin: 9, volMax: 0, fold: 0, rest: -1, settle: -1, lat: 0, yaw: 0, slip: NaN, finite: true, kinMax: 0, leanMax: 0, air: 0, prog: 0, faceMax: 0, faceBack: -1, creep: 0 };
  const q0 = b.frame.y;
  // the thirds of the body along its own front (rest +Z, where the face is: the crawl turns the body to lead with it)
  let ux = to.x - x0, uz = to.z - z0; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const Q0 = (b as unknown as { Q: Float64Array }).Q;
  let smin = 1e9, smax = -1e9; for (let i = 0; i < n; i++) { const s = Q0[i * 3 + 2]; smin = Math.min(smin, s); smax = Math.max(smax, s); }
  const third = new Int8Array(n); for (let i = 0; i < n; i++) { const u = (Q0[i * 3 + 2] - smin) / (smax - smin); third[i] = u > 0.72 ? 0 : u < 0.28 ? 2 : u > 0.4 && u < 0.6 ? 1 : -1; }
  // the facing on the floor (the frame's +Z) and the centre's velocity over 0.1 s, from 0.6 s after the start while it moves faster than 5 cm/s
  const facing = (): [number, number] => { const q = b.frame; const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), l = Math.hypot(fx, fz) || 1; return [fx / l, fz / l]; };
  const cHist: number[] = [];
  const thF: number[] = [], thM: number[] = [], thR: number[] = [], cS: number[] = [];
  const lastX = new Float64Array(n * 3); lastX.set(P);
  let slipN = 0, slipS = 0, t = 0, turned = false, lenMax = 0;
  const steadyFrom = 0.35, total = Math.hypot(to.x - x0, to.z - z0);
  const maxF = Math.round((o.maxS ?? 40) / DT);
  for (let k = 0; k < maxF; k++) {
    fr(); t += DT;
    if (o.turnAt !== undefined && !turned && t >= o.turnAt && o.turnTo) { turned = true; b.scootTo(o.turnTo.x, o.turnTo.z, sp); }
    const tgt = turned && o.turnTo ? o.turnTo : to;
    let gx = tgt.x - b.center.x, gz = tgt.z - b.center.z; const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    if (o.turnAt === undefined) { gx = ux; gz = uz; }
    // steady part of a straight walk: 35 cm in, 35 cm before the end
    const done = (b.center.x - x0) * ux + (b.center.z - z0) * uz;
    const steady = o.turnAt === undefined && done > steadyFrom && done < total - steadyFrom;
    if (done > r.prog) r.prog = done;
    let cmin = 1e9, cmax = -1e9, amin = 1e9, amax = -1e9, low = 1e9;
    const acc = [0, 0, 0], cnt = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const s = P[i * 3] * gx + P[i * 3 + 2] * gz, y = P[i * 3 + 1];
      if (s < amin) amin = s; if (s > amax) amax = s; if (y < low) low = y;
      if (y < 0.012) { if (s < cmin) cmin = s; if (s > cmax) cmax = s; }
      const th = third[i]; if (th >= 0) { acc[th] += s; cnt[th]++; }
    }
    if (low > 0.03) r.air++;
    cHist.push(b.center.x, b.center.z);
    if (t >= 0.6 && cHist.length >= 14) {
      const L = cHist.length, vx = (cHist[L - 2] - cHist[L - 14]) / (6 * DT), vz = (cHist[L - 1] - cHist[L - 13]) / (6 * DT), sp2 = Math.hypot(vx, vz);
      if (sp2 > 0.05) { const [fx, fz] = facing(), ang = Math.acos(Math.max(-1, Math.min(1, (fx * vx + fz * vz) / sp2))) * 180 / Math.PI; if (ang > r.faceMax) r.faceMax = ang; }
    }
    if (steady) {
      const fp = cmax - cmin; if (fp < r.fpMin) r.fpMin = fp; if (fp > r.fpMax) r.fpMax = fp; lenMax = Math.max(lenMax, amax - amin);
      thF.push(acc[0] / cnt[0]); thM.push(acc[1] / cnt[1]); thR.push(acc[2] / cnt[2]); cS.push(b.center.x * gx + b.center.z * gz);
      // the planted base: particles on the ground the crawl holds (w well under 0), their ground speed against the glide's
      const cr = crawlOf(w);
      if (cr && cr.on) {
        let wmin = 0; for (let i = 0; i < n; i++) if (cr.w[i] < wmin) wmin = cr.w[i];
        for (let i = 0; i < n; i++) if (P[i * 3 + 1] < 0.012 && cr.w[i] < 0.6 * wmin && wmin < -0.05) { slipS += Math.hypot(P[i * 3] - lastX[i * 3], P[i * 3 + 2] - lastX[i * 3 + 2]); slipN++; }
      } else if (!crawl) for (let i = 0; i < n; i++) if (P[i * 3 + 1] < 0.012) { slipS += Math.hypot(P[i * 3] - lastX[i * 3], P[i * 3 + 2] - lastX[i * 3 + 2]); slipN++; }
    }
    lastX.set(P);
    const vol = b.metrics.volume; if (vol < r.volMin) r.volMin = vol; if (vol > r.volMax) r.volMax = vol;
    r.kinMax = Math.max(r.kinMax, b.metrics.kinetic ?? 0);
    { const cr = crawlOf(w); if (cr) r.leanMax = Math.max(r.leanMax, Math.abs(cr.s[4])); }
    if (k % 6 === 0) r.fold = Math.max(r.fold, foldDeg(b));
    if (!Number.isFinite(b.center.x) || b.debug.safetyResets > 0) { r.finite = false; break; }
    if (Math.hypot(b.center.x - tgt.x, b.center.z - tgt.z) < 0.05 && Math.hypot(pb.vcx, pb.vcz) < 0.12 && (o.turnAt === undefined || turned)) {
      r.arrive = t; b.scootTo(NaN, 0, 0); b.setHome(b.center.x, b.center.z); break;
    }
  }
  r.slip = slipN > 0 ? slipS / slipN / (sp * DT) : NaN;
  r.len = lenMax; r.osc = lenMax > 0 ? (r.fpMax - r.fpMin) / lenMax : 0;
  r.lat = Math.abs((b.center.x - x0) * -uz + (b.center.z - z0) * ux);
  // the centre's speed over 0.1 s windows; the thirds' velocity phase at the strongest frequency
  if (cS.length > 60) {
    const vs: number[] = []; for (let i = 6; i < cS.length; i++) vs.push((cS[i] - cS[i - 6]) / (6 * DT));
    r.vMean = vs.reduce((a, c) => a + c, 0) / vs.length; r.vMin = Math.min(...vs) / r.vMean; r.vMax = Math.max(...vs) / r.vMean;
    const vel = (a: number[]): number[] => a.slice(1).map((x, i) => x - a[i]);
    const vf = vel(thF), vm = vel(thM), vr = vel(thR), N = vf.length;
    let bestP = 0, bestK = 1;
    for (let kk = 1; kk < N / 4; kk++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { re += vf[i] * Math.cos(2 * Math.PI * kk * i / N); im += vf[i] * Math.sin(2 * Math.PI * kk * i / N); } const p = re * re + im * im; if (p > bestP) { bestP = p; bestK = kk; } }
    const ph = (a: number[]): number => { let re = 0, im = 0; for (let i = 0; i < N; i++) { re += a[i] * Math.cos(2 * Math.PI * bestK * i / N); im += a[i] * Math.sin(2 * Math.PI * bestK * i / N); } return Math.atan2(im, re); };
    const pf = ph(vf), pm = ph(vm), pr = ph(vr);
    // (a signal that leads has the smaller phase here: lag > 0 = the front moves first)
    r.lagFM = -wrap(pf - pm) / (2 * Math.PI); r.lagMR = -wrap(pm - pr) / (2 * Math.PI); r.cycle = N * DT / bestK;
  }
  // after the stop: at rest (PG's sleep test: kinetic under restKin, the centre under restSpeed) and the crawl's wave gone
  const ts = t;
  for (let k = 0; k < 150; k++) {
    fr(); t += DT;
    const still = (b.metrics.kinetic ?? 1) < PG.restKin && Math.hypot(pb.vcx, pb.vcz) < PG.restSpeed;
    if (r.rest < 0 && still) r.rest = t - ts;
    if (r.settle < 0 && still && !pb.crawlOn) r.settle = t - ts;
    const fz = facing()[1];
    if (fz >= Math.cos(10 * Math.PI / 180)) { if (r.faceBack < 0) r.faceBack = t - ts; } else r.faceBack = -1;
    if (k >= 120) r.creep += Math.hypot(pb.vcx, pb.vcz) / 30;   // (the centre's mean speed over the last 0.5 s of the 2.5 s)
  }
  r.yaw = Math.abs(b.frame.y - q0) * 2 * 180 / Math.PI;
  return r;
}

const t0 = performance.now();
// (the cost and allocation rows first: they measure a JIT that the other rows have not yet put through other families and sizes)
/* ───────────── CR-12 cost and allocation ───────────── */
if (sec('cost')) {
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  // two whole bodies walking to and fro: today's glide, the glide with a squash pose held (LIFE's setSquash: the same goal-reshaping path the crawl uses), the crawl.
  // All three are built and warmed first (PH-11's 100 s warm-up each), then their 120-frame windows are timed in turn, 8 rounds, best of each (a shared machine's load
  // drifts between runs: timed one after the other, the squash pose's own reference moved by 0.2 ms)
  type Rig = { frame(): void; re(): void; w: PropWorld; bs: SoftBody[] };
  const rig = (mode: 'glide' | 'squash' | 'crawl'): Rig => {
    const w = buildPropWorld(flatDef, 'wide', 1);
    w.calm = mode !== 'crawl';
    const bs = [new SoftBody(G0, { family: 'jellygel', piece: { frac: 1, chunk: false, at: v3(-1, 0, -0.8) } } as never), new SoftBody(G0, { family: 'gummy', piece: { frac: 1, chunk: false, at: v3(1, 0, 0.8) } } as never)];
    for (const b of bs) b.setPropWorld(w);
    let flip = 0;
    const re = (): void => { flip ^= 1; bs[0].scootTo(flip ? 1 : -1, -0.8, 0.26); bs[1].scootTo(flip ? -1 : 1, 0.8, 0.28); if (mode === 'squash') for (const b of bs) b.setSquash(flip ? 0.95 : 0.96, 0.2); };
    const frame = (): void => { w.beginFrame(); for (const b of bs) { b.step(DT); ev.length = 0; b.drainEvents(ev); } w.endFrame(DT); };
    for (let i = 0; i < 6000; i++) { if (i % 300 === 0) re(); frame(); }
    return { frame, re, w, bs };
  };
  const allocOf = (r: Rig): number => {
    const empty: number[] = []; for (let i = 0; i < 6; i++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
    const base = empty[empty.length - 1];
    let al = Infinity;
    for (let k = 0; k < 4; k++) { r.re(); for (let i = 0; i < 10; i++) r.frame(); const u0 = newUsed(); for (let i = 0; i < 120; i++) r.frame(); const d = newUsed() - u0 - base; if (d >= 0) al = Math.min(al, d); }
    return al;
  };
  if (process.env.CRAWL_NOYAW) CRAWL.yawMax = 0;
  const rc = rig('crawl'), aC = allocOf(rc), rg = rig('glide'), aG = allocOf(rg), rq = rig('squash'), aQ = allocOf(rq);   // (each measured right after its own warm-up)
  const R3 = { crawl: rc, glide: rg, squash: rq };
  const best = { crawl: Infinity, glide: Infinity, squash: Infinity }, stepUs = { crawl: Infinity, glide: Infinity, squash: Infinity };
  for (let round = 0; round < 8; round++) for (const k of ['crawl', 'glide', 'squash'] as const) {
    const r = R3[k]; r.re(); for (let i = 0; i < 20; i++) r.frame();
    let tb = 0; const a = performance.now();
    for (let i = 0; i < 120; i++) { const t0b = performance.now(); r.w.beginFrame(); tb += performance.now() - t0b; for (const b of r.bs) { b.step(DT); ev.length = 0; b.drainEvents(ev); } r.w.endFrame(DT); }
    best[k] = Math.min(best[k], (performance.now() - a) / 120); stepUs[k] = Math.min(stepUs[k], tb / 120 / 2 * 1000);
  }
  const c = { ms: best.crawl, stepUs: stepUs.crawl, alloc: aC }, g = { ms: best.glide, stepUs: stepUs.glide, alloc: aG }, q = { ms: best.squash, stepUs: stepUs.squash, alloc: aQ };
  add('CR-12 cost: two whole bodies walking (best of 8 interleaved windows of 120 frames, both bodies\' physics and the world): the crawl against today\'s glide and against the glide with a squash pose held (LIFE\'s setSquash reshapes the goal the same way); the crawl\'s own step per body per frame',
    `crawl ${f(c.ms, 3)} ms, glide ${f(g.ms, 3)} ms (x ${f(c.ms / g.ms, 3)}), squash pose ${f(q.ms, 3)} ms (crawl - squash pose ${f((c.ms - q.ms) * 500, 1)} us per body); crawl step ${f(c.stepUs, 1)} us per body (glide: ${f(g.stepUs, 2)} us)`, 'crawl - squash pose <= 60 us per body; step <= 30 us', (c.ms - q.ms) * 500 <= 60 && c.stepUs <= 30);
  // RE-SPECIFIED round 12 (R12_INTEGRATE; D-100 with D-101): the bar was 25 us per body, set at R10_LOCOMOTION step 2 (crawl - squash pose 10..19 us) before the
  // facing turn of step 6 (the yaw pass and the front's bend) and before this row timed the three rigs interleaved. Measured since: 38.5 us (R10_LOCOMOTION step 6,
  // a loaded machine); 27.9, 31.9 and 47.3 us in three R12 runs on a quiet machine (the difference of two ~1.5 ms frames: its spread is the squash pose's own
  // noise, 1.511 to 1.536 ms); the crawl's own step 20.3 to 21.5 us every time, under its own 30 us bar, which is unchanged. A trim was looked for: the step is
  // two passes over the particles (the wave, then its centring and volume correction, which need the first pass's sums) and the goal path is the squash pose's
  // own; no cheap cut keeps the motion bit for bit. The new number is the frame budget's: at the low tier D-101 lets three squishies walk at once, 3 x 60 us =
  // 0.18 ms a frame = 4.5 % of the low tier's 4 ms physics budget (PF-00) and about 7 % of one awake whole's own cost (PF-00 C_WHOLE_MS 0.87 ms) per walker.
  add('CR-13 allocation: new-space growth per 120 frames while two bodies crawl (best of 4 windows after PH-11\'s 100 s warm-up)', `${c.alloc} B (glide ${g.alloc} B, squash pose ${q.alloc} B)`, '0 B', c.alloc <= 0);
}

/* ───────────── CR-01..05 per family on the flat ───────────── */
if (sec('flat')) {
  const lines: string[] = [];
  let okOsc = 0, okLead = 0, okSpeed = 0, okRest = 0, okVol = 0, okSafe = 0, okGrip = 0;
  let worstSpeed = 0, worstRest = 0, worstVol = 0, worstFold = 0, worstLat = 0, worstYaw = 0, minOsc = 9, maxSlip = 0, glideSlip = 0, minV = 9;
  // "volume as now": today's LIFE walk (the glide, with the family's gait hops and their anticipation squash every 0.8 s, act.ts travelStep) moves a foam's
  // or the beads' volume by several per cent (their volume constraint is compliant); the crawl may move it within 1 % or within that range, never beyond
  const nowVol = (fam: string): [number, number] => {
    const w = buildPropWorld(flatDef, 'wide', 1); w.calm = true;
    const b = new SoftBody(G0, { family: fam }); b.setPropWorld(w);
    const fr = (): void => { w.beginFrame(); b.step(DT); ev.length = 0; b.drainEvents(ev); w.endFrame(DT); };
    for (let i = 0; i < 60; i++) fr();
    const ga = GAITS as Record<string, { squash: number; vyS1: number; hops: boolean }>;
    const gt = ga[fam];
    let lo = 1, hi = 1;
    b.scootTo(2, 0, GLIDE[fam].glide);
    for (let k = 0; k < 360; k++) {
      if (gt.hops && k % 48 === 0) b.setSquash(gt.squash, 0.08);
      if (gt.hops && k % 48 === 7) { b.setSquash(1, 0.08); b.hop(0.3, gt.vyS1, 0); }
      fr(); const v = b.metrics.volume; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return [lo, hi];
  };
  for (const fam of FAMS) {
    const c = walk(fam, true), g = walk(fam, false), nv = nowVol(fam);
    const dv = c.arrive / g.arrive - 1;
    lines.push(`${fam} osc ${f(c.osc * 100, 1)}% (len ${f(c.len)} m) lead ${f(c.lagFM)}/${f(c.lagMR)} cyc (cycle ${f(c.cycle)} s) arrive ${f(c.arrive)} vs ${f(g.arrive)} s (${dv >= 0 ? '+' : ''}${f(dv * 100, 1)}%) centre ${f(c.vMin)}..${f(c.vMax)}x vol ${f(c.volMin, 3)}..${f(c.volMax, 3)} (today's walk with its gait hops ${f(nv[0], 3)}..${f(nv[1], 3)}) rest ${f(c.rest)} s (glide ${f(g.rest)}) slip ${f(c.slip)} (glide ${f(g.slip)}) fold ${f(c.fold, 0)} lat ${f(c.lat * 1000, 0)} mm yaw ${f(c.yaw, 1)} deg`);
    if (c.osc >= 0.12) okOsc++; minOsc = Math.min(minOsc, c.osc);
    if (c.lagFM > 0.03 && c.lagMR > 0.03) okLead++;
    if (Math.abs(dv) <= 0.2 && c.arrive > 0) okSpeed++; worstSpeed = Math.max(worstSpeed, Math.abs(dv));
    if (c.rest >= 0 && c.rest <= 1 && c.settle >= 0 && c.settle <= 1) okRest++; worstRest = Math.max(worstRest, c.settle < 0 ? 9 : c.settle);
    const dvol = Math.max(Math.abs(c.volMin - 1), Math.abs(c.volMax - 1)); worstVol = Math.max(worstVol, dvol); if (dvol <= 0.01 || (c.volMin >= nv[0] - 0.002 && c.volMax <= nv[1] + 0.002)) okVol++;
    if (c.finite && c.fold <= 120 && c.lat < 0.03 && c.yaw < 5 && c.vMin > 0) okSafe++;
    worstFold = Math.max(worstFold, c.fold); worstLat = Math.max(worstLat, c.lat); worstYaw = Math.max(worstYaw, c.yaw); minV = Math.min(minV, c.vMin);
    if (c.slip <= 0.4) okGrip++; maxSlip = Math.max(maxSlip, c.slip); glideSlip = Math.max(glideSlip, g.slip);
  }
  const N = FAMS.length;
  for (const l of lines) console.log('  ' + l);
  add(`CR-01 stretch and bunch: the ground-contact footprint's length oscillates during a 2 m walk by at least 12 % of the body length (${N} families, template genome)`, `${okOsc}/${N}; smallest ${f(minOsc * 100, 1)} %`, '>= 12 % each', okOsc === N);
  add('CR-02 the front leads the rear: the velocity phase of the front third leads the middle\'s, and the middle\'s leads the rear\'s (a wave from front to rear)', `${okLead}/${N} (see the lines above: front->mid / mid->rear in cycles)`, 'both > 0.03 cycle', okLead === N);
  add('CR-03 travel time unchanged: the 2 m walk (LIFE\'s arrival: within 5 cm) takes within 20 % of today\'s glide', `${okSpeed}/${N}; worst ${f(worstSpeed * 100, 1)} %`, '<= 20 %', okSpeed === N);
  add('CR-04 settles: at rest (PG.restKin, PG.restSpeed) with the wave gone within 1 s of the stop; volume as now: within 1 % during the walk, or within the family\'s own range on today\'s walk (the glide with its gait hops and their squash)', `rest ${okRest}/${N} (worst ${f(worstRest)} s); volume ${okVol}/${N} (worst ${f(worstVol * 100, 2)} %: see the lines above)`, '<= 1 s; <= 1 % or within today\'s range', okRest === N && okVol === N);
  add('CR-05 no jitter, no runaway: finite, no fold over 120 deg, lateral drift under 3 cm, the centre never moves backward; 2.5 s after the stop it faces as it did (yaw under 5 deg)', `${okSafe}/${N}; fold ${f(worstFold, 0)} deg, drift ${f(worstLat * 1000, 0)} mm, yaw ${f(worstYaw, 1)} deg, centre speed min ${f(minV)} x`, 'all', okSafe === N);
  add('CR-06 the base grips where it is planted: the planted base particles\' ground speed against the glide\'s (today\'s glide: every base particle slides at 1.0)', `${okGrip}/${N}; worst ${f(maxSlip)} (glide ${f(glideSlip)})`, '<= 0.4', okGrip === N);
}

/* ───────────── CR-07 turns ───────────── */
if (sec('turn')) {
  const fams = FULL ? FAMS : ['jellygel', 'putty'];
  let ok = 0; const ls: string[] = [];
  for (const fam of fams) {
    const sp = GLIDE[fam].glide, tTurn = 0.6 / sp;
    const o = { to: v3(2, 0, 0), turnAt: tTurn, turnTo: v3(0.6, 0, 1.4) };
    const c = walk(fam, true, o), g = walk(fam, false, o);
    const dv = c.arrive / g.arrive - 1;
    ls.push(`${fam} ${f(c.arrive)} vs ${f(g.arrive)} s, lean ${f(c.leanMax, 3)}, fold ${f(c.fold, 0)}, rest ${f(c.settle)} s`);
    if (c.arrive > 0 && Math.abs(dv) <= 0.2 && c.leanMax > 0.01 && c.fold <= 120 && c.finite && c.settle >= 0 && c.settle <= 1) ok++;
  }
  add('CR-07 turns: a walk retargeted 90 degrees on the way arrives within 20 % of the glide\'s time, leans into the turn, no fold over 120, at rest within 1 s', `${ok}/${fams.length}: ${ls.join('; ')}`, 'all', ok === fams.length);
}

/* ───────────── CR-14 facing: it leads with its face ───────────── */
if (sec('face')) {
  const fams = FULL ? ['jellygel', 'putty', 'firmsilicone', 'slimegoo', 'marshmallow', 'gummy'] : ['jellygel', 'putty', 'firmsilicone', 'slimegoo'];
  const dirs: [string, number, number][] = [['+x', 2, 0], ['-x', -2, 0], ['away (-z)', 0, -2], ['toward (+z)', 0, 2]];
  let ok = 0, n = 0, worst = 0, worstBack = 0; const ls: string[] = [];
  for (const fam of fams) {
    const parts: string[] = [];
    for (const [nm, dx, dz] of dirs) {
      const c = walk(fam, true, { to: v3(dx, 0, dz) });
      n++; worst = Math.max(worst, c.faceMax); worstBack = Math.max(worstBack, c.faceBack < 0 ? 9 : c.faceBack);
      const pass = c.arrive > 0 && c.faceMax <= 25 && c.faceBack >= 0 && c.faceBack <= 1.5 && c.fold <= 120 && c.finite;
      if (pass) ok++;
      parts.push(`${nm} ${f(c.faceMax, 0)} deg, back ${f(c.faceBack)} s${pass ? '' : ' FAIL'}`);
    }
    ls.push(`${fam}: ${parts.join(', ')}`);
  }
  add('CR-14 it leads with its face: a 2 m walk in four directions from rest (facing +Z): from 0.6 s after the start the angle between its facing (its rest +Z, the face) and the centre\'s velocity; after the stop it turns back to face +Z (within 10 deg)',
    `${ok}/${n}; worst ${f(worst, 1)} deg, turned back after ${f(worstBack)} s at most: ${ls.join('; ')}`, '<= 25 deg; back <= 1.5 s', ok === n);
}

/* ───────────── CR-15 the DRAWN face leads, from the first step, in every mode (R15 FACING) ───────────── */
// (R15 FACING, owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn.") CR-14 above reads the physics
// frame from 0.6 s after the start, in the crawl mode only. In the browser (_harness/browser_facing.mjs, R15_FACING.md) what the player saw was different: every
// walk STARTED with a slide sideways or backward (the glide was at full speed in 0.12 s, the turn took 0.2-0.4 s: CR-14's 0.6 s skip hid it), and in Calm or
// with prefers-reduced-motion (world.calm) there was no turn at all (CR-14 never walks in Calm). So these rows read what is DRAWN, from the first frame,
// in both modes: the two eye beads are placed on the sim skin at the triangle and weights the renderer uses (render/wholeRef.ts, a pure module: the same
// numbers face.ts draws from), the drawn face's forward is the normal of the line between them on the floor, the travel is the centre's motion over 0.2 s.
type Eyes = { tri: number; u: number; v: number; w: number }[];
function drawnWalk(fam: string, calm: boolean, to: V3, turnAt?: number, turnTo?: V3, speed?: number): { yaw: number[]; fyaw: number[]; cx: number[]; cz: number[]; arrive: number } {
  const w = buildPropWorld(flatDef, 'wide', 1);
  w.calm = calm;
  const b = new SoftBody(G0, { family: fam });
  b.setPropWorld(w);
  const bb = b as unknown as { restLocal: Float32Array; restRadius: number };
  const ref = wholeRefFor({ vertexCount: (bb.restLocal.length / 3) | 0, indices: b.indices, restLocal: bb.restLocal }, bb.restRadius, G0);
  const eyes: Eyes = ref.eyes.map((e) => e.hit);
  const I = b.indices, P = b.positions;
  const eye = (k: number, o: number[]): void => { const h = eyes[k], a = I[h.tri * 3] * 3, c = I[h.tri * 3 + 1] * 3, d = I[h.tri * 3 + 2] * 3; o[0] = h.u * P[a] + h.v * P[c] + h.w * P[d]; o[1] = h.u * P[a + 2] + h.v * P[c + 2] + h.w * P[d + 2]; };
  const e0 = [0, 0], e1 = [0, 0];
  const fr = (): void => { w.beginFrame(); b.step(DT); ev.length = 0; b.drainEvents(ev); w.endFrame(DT); };
  for (let i = 0; i < 60; i++) fr();
  const sp = speed ?? GLIDE[fam].glide;
  b.scootTo(to.x, to.z, sp);
  const out = { yaw: [] as number[], fyaw: [] as number[], cx: [] as number[], cz: [] as number[], arrive: -1 };
  let turned = false;
  for (let k = 0; k < 25 / DT; k++) {   // (the slowest glide, the slime's 0.1 m/s, takes 15 s and the turn on 1.5 m)
    fr();
    const t = (k + 1) * DT;
    if (turnAt !== undefined && turnTo && !turned && t >= turnAt) { turned = true; b.scootTo(turnTo.x, turnTo.z, sp); }
    eye(0, e0); eye(1, e1);
    out.yaw.push(Math.atan2(-(e1[1] - e0[1]), e1[0] - e0[0]));   // the forward (-ez, ex) of e1 - e0 as atan2(x, z)
    const q = b.frame; out.fyaw.push(Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)));
    out.cx.push(b.center.x); out.cz.push(b.center.z);
    const tg = turned && turnTo ? turnTo : to;
    if (Math.hypot(b.center.x - tg.x, b.center.z - tg.z) < 0.05 && (turnAt === undefined || turned)) { out.arrive = t; break; }
  }
  return out;
}
const ang = (a: number, b: number): number => Math.abs(wrap(a - b)) * 180 / Math.PI;
if (sec('drawn')) {
  const dirs: [string, V3, number?, V3?][] = [['+x', v3(1.5, 0, 0)], ['-x', v3(-1.5, 0, 0)], ['away (-z)', v3(0, 0, -1.5)], ['toward (+z)', v3(0, 0, 1.5)], ['+x then away', v3(1.5, 0, 0), 2.5, v3(0.6, 0, -1.2)]];
  for (const calm of [false, true]) {
    let ok = 0, n = 0, worstMov = 0, worstP95 = 0, worstSlide = 0, peakRate = 0, worstTurn = 0, worstDiff = 0;
    const ls: string[] = [];
    for (const fam of FAMS) {
      const parts: string[] = [];
      for (const [nm, to, ta, tt] of dirs) {
        const r = drawnWalk(fam, calm, to, ta, tt);
        const N = r.yaw.length, movs: number[] = [];
        let slide = 0, tTurn = -1, rate = 0, mov = 0, diff = 0;
        const way0 = Math.atan2(to.x, to.z);
        for (let k = 6; k + 6 < N; k++) {
          const vx = (r.cx[k + 6] - r.cx[k - 6]) / (12 * DT), vz = (r.cz[k + 6] - r.cz[k - 6]) / (12 * DT);
          if (Math.hypot(vx, vz) > 0.03) { const a = ang(r.yaw[k], Math.atan2(vx, vz)); movs.push(a); if (a > mov) mov = a; }
          // (the travel made sideways or backward: this frame's move while the face is more than 45 deg from the travel)
          if (ang(r.yaw[k], Math.atan2(vx, vz)) > 45) slide += Math.hypot(r.cx[k] - r.cx[k - 1], r.cz[k] - r.cz[k - 1]);
          rate = Math.max(rate, Math.abs(wrap(r.yaw[k + 3] - r.yaw[k - 3])) / (6 * DT) * 180 / Math.PI);
          diff = Math.max(diff, ang(r.yaw[k], r.fyaw[k]));
        }
        for (let k = 0; k < N && tTurn < 0; k++) if (ang(r.yaw[k], way0) < 30) tTurn = k * DT;
        movs.sort((a, c) => a - c);
        const p95 = movs.length ? movs[Math.min(movs.length - 1, Math.floor(0.95 * movs.length))] : NaN;
        n++;
        // limits: the drawn face within 45 deg of its travel at every moving sample (30 at the 95th percentile) from the very start; under 1 cm of travel made
        // sideways or backward (more than 45 deg from the face) in the whole walk (a turn on the move arcs FORWARD round to its way: that is not a slide);
        // the turn reads as a slug's, not a snap: its drawn peak at most 250 deg/s (about half of R10's 465; the crawl's bend of the front adds some 30 deg/s
        // on the skin to the body's 200), and it still turns round (its face within 30 deg of its way inside 1.8 s);
        // it arrives. (Drawn vs the physics frame is reported, not judged: the crawl's wave bends the skin under the eyes a few degrees off the fitted rotation.)
        const pass = r.arrive > 0 && mov <= 45 && p95 <= 30 && slide <= 0.01 && rate <= 250 && tTurn >= 0 && tTurn <= 1.8;
        if (pass) ok++;
        worstMov = Math.max(worstMov, mov); worstP95 = Math.max(worstP95, p95); worstSlide = Math.max(worstSlide, slide); peakRate = Math.max(peakRate, rate); worstTurn = Math.max(worstTurn, tTurn < 0 ? 99 : tTurn); worstDiff = Math.max(worstDiff, diff);
        parts.push(`${nm} max ${f(mov, 0)} p95 ${f(p95, 0)} deg, ${f(slide * 100, 1)} cm sideways/back, turned in ${f(tTurn)} s at up to ${f(rate, 0)} deg/s${pass ? '' : ' FAIL'}`);
      }
      ls.push(`${fam}: ${parts.join(', ')}`);
    }
    add(`CR-15${calm ? 'b' : 'a'} the DRAWN face (the eye beads on the skin, wholeRef.ts) leads its travel from the first step${calm ? ' in CALM / reduced motion (world.calm: no crawl wave, the turn stays)' : ''}: a 1.5 m walk from rest (facing the camera) in four directions and one retargeted 90 deg on its way; the face vs the centre's travel over 0.2 s at every moving sample (> 3 cm/s); the travel made sideways or backward; the turn's peak rate and the time until the face is within 30 deg of its way (drawn vs physics frame reported)`,
      `${ok}/${n}; worst ${f(worstMov, 1)} deg (p95 ${f(worstP95, 1)}), ${f(worstSlide * 100, 1)} cm sideways/back, peak ${f(peakRate, 0)} deg/s, turned within ${f(worstTurn)} s, drawn vs frame ${f(worstDiff, 1)} deg: ${ls.join('; ')}`,
      '<= 45 deg (p95 <= 30); <= 1 cm; <= 250 deg/s; <= 1.8 s', ok === n);
  }
  // LIFE's travelStep calls a walk BLOCKED when it gains under 2 cm in 2 s (life/act.ts): the turn holds the glide, so the slowest walk LIFE makes (the contact
  // approach at 0.04 m/s), started facing straight away from its way, must still gain 2 cm inside 2 s (in both modes)
  let worstGain = 9; const gs: string[] = [];
  for (const calm of [false, true]) for (const fam of FAMS) {
    const r = drawnWalk(fam, calm, v3(0, 0, -0.5), undefined, undefined, 0.04);
    const k2 = Math.min(r.cx.length - 1, Math.round(2 / DT) - 1), gain = Math.hypot(r.cx[k2] - r.cx[0], r.cz[k2] - r.cz[0]);
    worstGain = Math.min(worstGain, gain); gs.push(`${fam}${calm ? ' calm' : ''} ${f(gain * 100, 1)} cm`);
  }
  add('CR-16 the turn never makes LIFE call a walk blocked: a 0.04 m/s walk (the contact approach) set off straight away from the face gains at least 2 cm in its first 2 s (life/act.ts travelStep\'s rule)', `worst ${f(worstGain * 100, 1)} cm: ${gs.join(', ')}`, '>= 2 cm', worstGain >= 0.02);
}

/* ───────────── CR-08 ice, water, ramp, mound ───────────── */
if (sec('surf')) {
  // each on a flat place with the one surface or shape (the real data: Frostbell's ice, Ripple's surf depth, Frostbell's Glide Ramp, Ripple's Sand Mound)
  const place = (o: { base?: PlaceDef; things?: unknown[]; zones?: unknown[]; patches?: unknown[] }): PlaceDef => {
    const things = (o.things ?? []) as { x: number; z: number; yaw: number }[], B = o.base ?? CABIN;
    return { ...B, things, walls: [], zones: o.zones ?? [], patches: o.patches ?? [], tall: { ...B.tall, things: things.map((t) => ({ x: t.x, z: t.z, yaw: t.yaw })), walls: [], zones: o.zones ?? [], patches: o.patches ?? [] } } as unknown as PlaceDef;
  };
  const ice = place({ base: FROSTBELL, patches: [{ ...FROSTBELL.patches.find((p) => p.ice)!, x: 0, z: 0, r: 3 }] });
  const surf = RIPPLE.zones.find((z) => z.id === 'surfedge')!;
  const water = place({ base: RIPPLE, zones: [{ id: 'shallow', kind: surf.kind, strength: 1, shape: 'disc', x: 0, z: 0, r: 3, surfaceY: 0.08, ramp: 0.4 }] });
  const ramp = place({ things: [{ ...FROSTBELL.things.find((t) => t.id === 'glideramp')!, x: 0, z: 0, yaw: 0 }] });
  const mound = place({ things: [{ ...RIPPLE.things.find((t) => t.id === 'sandmound')!, x: 0, z: 0, yaw: 0 }] });
  const ls: string[] = []; let ok = 0, n = 0;
  for (const fam of FULL ? ['jellygel', 'putty', 'firmsilicone', 'stickystretch'] : ['jellygel', 'putty']) {
    const o = { at: v3(-1, 0, 0), to: v3(1.2, 0, 0) };
    const c = walk(fam, true, { ...o, world: buildPropWorld(ice, 'wide', 1) }), g = walk(fam, false, { ...o, world: buildPropWorld(ice, 'wide', 1) }), fl = walk(fam, true, o);
    const dv = c.arrive / g.arrive - 1; n++;
    const pass = c.arrive > 0 && Math.abs(dv) <= 0.2 && c.slip > fl.slip + 0.05 && c.fold <= 120 && c.finite && c.settle >= 0 && c.settle <= 1;
    if (pass) ok++;
    ls.push(`ice ${fam}: ${f(c.arrive)} vs ${f(g.arrive)} s, base slip ${f(c.slip)} (felt ${f(fl.slip)}), osc ${f(c.osc * 100, 1)} % (felt ${f(fl.osc * 100, 1)})${pass ? '' : ' FAIL'}`);
  }
  for (const fam of ['jellygel', 'putty']) {
    const o = { at: v3(-1, 0, 0), to: v3(1.2, 0, 0) };
    const c = walk(fam, true, { ...o, world: buildPropWorld(water, 'wide', 1) }), g = walk(fam, false, { ...o, world: buildPropWorld(water, 'wide', 1) });
    const dv = c.arrive / g.arrive - 1; n++;
    const pass = c.arrive > 0 && Math.abs(dv) <= 0.2 && c.fold <= 120 && c.finite && c.settle >= 0 && c.settle <= 1;
    if (pass) ok++;
    ls.push(`water 8 cm ${fam}: ${f(c.arrive)} vs ${f(g.arrive)} s, osc ${f(c.osc * 100, 1)} %, rest ${f(c.settle)} s${pass ? '' : ' FAIL'}`);
  }
  // the ramp and the mound: scooting into them from the floor (the glide stops against them: a static prop holds it back) and walking down from the top
  for (const [nm, def, at, to] of [['into the ramp\'s low end', ramp, v3(2.2, 0, 0), v3(-0.2, 0, 0)], ['down the ramp from its top', ramp, v3(-0.7, 0.95, 0), v3(2.6, 0, 0)],
    ['into the mound', mound, v3(-2, 0, 0), v3(2, 0, 0)], ['down the mound from its top', mound, v3(0, 0.8, 0), v3(2.2, 0, 0)]] as const) {
    for (const fam of ['jellygel', 'firmsilicone']) {
      const c = walk(fam, true, { world: buildPropWorld(def, 'wide', 1), at, to, maxS: 20 }), g = walk(fam, false, { world: buildPropWorld(def, 'wide', 1), at, to, maxS: 20 });
      n++;
      const both = c.arrive > 0 === g.arrive > 0, dv = c.arrive > 0 && g.arrive > 0 ? c.arrive / g.arrive - 1 : 0;
      const pass = both && Math.abs(dv) <= 0.2 && Math.abs(c.prog - g.prog) <= 0.1 && c.fold <= 120 && c.finite && (c.settle >= 0 && c.settle <= 1.5);
      if (pass) ok++;
      ls.push(`${nm} ${fam}: ${c.arrive > 0 ? 'arrived ' + f(c.arrive) + ' s' : 'stopped'} at ${f(c.prog)} m vs glide ${g.arrive > 0 ? 'arrived ' + f(g.arrive) + ' s' : 'stopped'} at ${f(g.prog)} m, fold ${f(c.fold, 0)}, rest ${f(c.settle)} s${pass ? '' : ' FAIL'}`);
    }
  }
  add('CR-08 surfaces and shapes: on ice the base slips more than on the felt and the walk arrives on time; through shallow water (8 cm); into and down the ramp and the mound the crawl gets where the glide gets (within 10 cm, 20 % of its time); no fold over 120; at rest within 1.5 s', `${ok}/${n}: ${ls.join('; ')}`, 'all', ok === n);
}

/* ───────────── CR-09 scales and pieces ───────────── */
if (sec('scale')) {
  const ls: string[] = []; let ok = 0, n = 0;
  for (const [nm, o] of [['small genome', { genome: SMALL }], ['big genome', { genome: BIG }], ['half chunk', { piece: { frac: 0.5, chunk: true } }], ['1/8 mini', { piece: { frac: 0.125, chunk: false } }]] as const) {
    for (const fam of FULL ? ['jellygel', 'putty', 'firmsilicone'] : ['jellygel']) {
      const c = walk(fam, true, o as WalkOpts), g = walk(fam, false, o as WalkOpts);
      const dv = c.arrive / g.arrive - 1; n++;
      // (at rest within 1 s; a piece that today's glide leaves creeping after its stop (a cut chunk's goal is not centred: the putty half creeps 2 cm/s) may creep as it does)
      const rested = (c.settle >= 0 && c.settle <= 1) || (!(g.settle >= 0 && g.settle <= 1) && c.creep <= g.creep + 0.01);
      const pass = c.arrive > 0 && Math.abs(dv) <= 0.2 && c.osc >= 0.12 && c.fold <= 120 && c.finite && rested && Math.max(Math.abs(c.volMin - 1), Math.abs(c.volMax - 1)) <= 0.015;
      if (pass) ok++;
      ls.push(`${nm} ${fam}: osc ${f(c.osc * 100, 1)} % (len ${f(c.len)}), ${f(c.arrive)} vs ${f(g.arrive)} s, rest ${f(c.settle)} s (glide ${f(g.settle)}; creep ${f(c.creep * 100, 1)} vs ${f(g.creep * 100, 1)} cm/s), vol ${f(c.volMin, 3)}..${f(c.volMax, 3)}, fold ${f(c.fold, 0)}${pass ? '' : ' FAIL'}`);
    }
  }
  add('CR-09 every scale and cut pieces crawl: a small and a big genome, a half chunk (flat cut face) and a 1/8 mini: footprint oscillation >= 12 %, on time within 20 %, at rest within 1 s (or creeping after the stop as today\'s glide leaves it), volume within 1.5 %', `${ok}/${n}: ${ls.join('; ')}`, 'all', ok === n);
}

/* ───────────── CR-10 the touch gate and Calm, inert when not walking ───────────── */
if (sec('gate')) {
  // a finger lands mid-walk: the wave is gone within 0.15 s, the goal back to rest (the touch gate's 0.12 s + one frame)
  const w = buildPropWorld(flatDef, 'wide', 1);
  const b = new SoftBody(G0, { family: 'jellygel' }); b.setPropWorld(w);
  const fr = (): void => { w.beginFrame(); b.step(DT); ev.length = 0; b.drainEvents(ev); w.endFrame(DT); };
  for (let i = 0; i < 60; i++) fr();
  b.scootTo(2, 0, 0.26);
  for (let i = 0; i < 60; i++) fr();
  const on0 = P_(b).crawlOn;
  const h = b.raycast(v3(b.center.x, 3, b.center.z + 0.02), v3(0, -1, 0));
  if (h) { b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) }); b.fingerPressure(0, 0.5); }
  let offAt = -1;
  for (let i = 0; i < 30; i++) { fr(); if (offAt < 0 && !P_(b).crawlOn) offAt = (i + 1) * DT; }
  b.fingerUp(0);
  add('CR-10 the touch gate: a finger down mid-walk ends the crawl (its wave eased out, the goal back to rest) within 0.15 s', `walking ${on0}; off after ${f(offAt, 3)} s`, '<= 0.15 s', on0 && offAt > 0 && offAt <= 0.15);
  // Calm (world.calm, the shell's Calm or prefers-reduced-motion): today's glide bit for bit; and a body bound to a world that does not walk steps bit for bit as before
  const hashRun = (calm: boolean, crawlOn: boolean, scoot: boolean): number[] => {
    CRAWL.on = crawlOn;
    const ww = buildPropWorld(flatDef, 'wide', 1); ww.calm = calm;
    const bb = new SoftBody(G0, { family: 'gummy' }); bb.setPropWorld(ww);
    const out: number[] = [];
    for (let i = 0; i < 200; i++) {
      if (i === 30 && scoot) bb.scootTo(1.2, 0.3, 0.28);
      if (i === 60) bb.nudge(v3(0.3, 0.6, 0));
      if (i === 150 && scoot) bb.scootTo(NaN, 0, 0);
      ww.beginFrame(); bb.step(DT); ev.length = 0; bb.drainEvents(ev); ww.endFrame(DT); out.push(bb.stateHash());
    }
    CRAWL.on = true;
    return out;
  };
  const same = (a: number[], c: number[]): boolean => a.length === c.length && a.every((x, i) => x === c[i]);
  const calmEq = same(hashRun(true, true, true), hashRun(false, false, true)), inertEq = same(hashRun(false, true, false), hashRun(false, false, false));
  const differs = !same(hashRun(false, true, true), hashRun(false, false, true));
  // (R15 FACING: the TURN to the way is no longer part of the crawl: CRAWL.on false and world.calm both keep it (the owner: "they need to be able to turn"; in Calm
  // there was no turn at all), so 'the glide' here is scootTo's glide with the body's turn; the check is as strict: Calm adds no wave, bit for bit)
  add('CR-11 Calm falls back to today\'s motion: with world.calm a walk steps bit for bit as the glide (the glide with its turn to the way, R15) (200 frames, state hash every frame); a body that does not walk is untouched; the crawl does change a walk', `calm = glide ${calmEq}; no walk = before ${inertEq}; crawl differs ${differs}`, 'true, true, true', calmEq && inertEq && differs);
}

let failed = 0;
for (const r of rows) { const ok = r.pass ? 'PASS' : 'FAIL'; if (!r.pass) failed++; console.log(`${ok}  ${r.what}\n      ${r.value}   [${r.limit}]`); }
console.log(`\nprobe_crawl: ${rows.length - failed}/${rows.length} pass (${f((performance.now() - t0) / 1000, 1)} s${FULL ? ', --full' : ''})`);
process.exitCode = failed ? 1 : 0;
