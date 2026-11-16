// PHYS, CUT3 leg 3 (U02 / U03): a swipe across ONE tip, across SEVERAL tips and across the MIDDLE of a lobed species, on the REAL SoftBody through the shell's cut flow (physview/swap_flow.ts: plan, neck,
// swap, parting, the same constants as src/shell/cut.ts). The pieces are born where their material is (a tip is up to a metre in the air) and FALL. Plain node (type stripping):
//   node _harness/probe_tips.ts [--species=a,b | --lobed=8 | --fam12] [--only=one,several,middle] [--secs=5] [--v] [--json=path]
// Bars (CUT3 5 U02 / U03; X13 of CUT2 12): measured twice, because a piece born in the air cannot meet a bar that starts at the swap (it falls at 3 m/s):
//   X13 literal (from the swap):   rise <= 0.06 m (centre above its swap-frame centre), up <= 1.0 m/s (0.1 s differences), after 0.1 s the speed <= 1.2 m/s, no safety reset, nothing below the table
//   landing-based (U02 "rise after landing <= 0.06 m, no launch"): from the first frame the piece touches the table (lowest particle < 5 mm) after having been in the air: the rebound rise (centre
//   above its lowest centre of that landing) <= 0.06 m, the upward 0.1 s speed <= 1.0 m/s, 0.1 s after landing the speed (any direction) <= 1.2 m/s, rest (0.1 s speed < 0.05 m/s) within the run
import { PIECE_IMPACT, PIECE_LAND, SoftBody } from '../src/physics/softbody.ts';
import { CATALOG } from '../src/data/catalog.ts';
import { getSource, icoOf } from '../src/physics/region.ts';
import { speciesBaseGenome } from '../src/data/catalog.ts';
import type { CutPlane, V3 } from '../src/contracts.ts';
import { DT, cutOnce, frame, newScene, planeThrough } from './physview/swap_flow.ts';
import type { Scene } from './physview/swap_flow.ts';
import { FAM12 } from './physview/flush_rig.ts';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k: string): string => (argv.find((a) => a.startsWith('--' + k + '=')) ?? '').slice(k.length + 3);
const V = argv.includes('--v');
if (arg('landk')) PIECE_LAND.k = +arg('landk');   // knobs of the landing absorption / the mass-shared contact (src/physics/softbody.ts), for A / B runs
if (arg('landw')) PIECE_LAND.window = +arg('landw');
if (arg('landv')) PIECE_LAND.minSpeed = +arg('landv');
if (arg('ratio0')) PIECE_IMPACT.ratio0 = +arg('ratio0');
const SECS = arg('secs') ? +arg('secs') : 7;   // (a tip resting on a shoulder of the body may creep for 4 s before it slides off: 5 s ended mid-fall on munchip)
const only = arg('only') ? arg('only').split(',') : [];
const run = (s: string): boolean => only.length === 0 || only.includes(s);
export const f = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/** The tips of a species: the connected groups of S's detail-4 vertices farther than `th` x the largest radius from S's vertex centroid; each tip = its farthest vertex. */
export interface Tip { dir: V3; r: number; n: number }
export function tipsOf(sp: string, th = 0.8): { tips: Tip[]; c: V3; rmax: number } {
  const S = getSource(speciesBaseGenome(sp as never, 1)), ico = icoOf(4), nv = S.nv;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < nv; i++) { cx += S.pos[i * 3]; cy += S.pos[i * 3 + 1]; cz += S.pos[i * 3 + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  const r = new Float64Array(nv); let rmax = 0;
  for (let i = 0; i < nv; i++) { r[i] = Math.hypot(S.pos[i * 3] - cx, S.pos[i * 3 + 1] - cy, S.pos[i * 3 + 2] - cz); if (r[i] > rmax) rmax = r[i]; }
  const par = new Int32Array(nv).fill(-1);
  for (let i = 0; i < nv; i++) if (r[i] > th * rmax) par[i] = i;
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let e = 0; e < ico.edges.length; e += 2) { const a = ico.edges[e], b = ico.edges[e + 1]; if (par[a] >= 0 && par[b] >= 0) { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; } }
  const best = new Map<number, { i: number; n: number }>();
  for (let i = 0; i < nv; i++) if (par[i] >= 0) { const g = find(i), cur = best.get(g); if (!cur) best.set(g, { i, n: 1 }); else { cur.n++; if (r[i] > r[cur.i]) cur.i = i; } }
  const tips: Tip[] = [];
  for (const { i, n } of best.values()) tips.push({ dir: { x: (S.pos[i * 3] - cx) / r[i], y: (S.pos[i * 3 + 1] - cy) / r[i], z: (S.pos[i * 3 + 2] - cz) / r[i] }, r: r[i], n });
  tips.sort((a, b) => a.dir.x - b.dir.x || a.dir.y - b.dir.y || a.dir.z - b.dir.z);
  return { tips, c: { x: cx, y: cy, z: cz }, rmax };
}

/** The tips at the threshold that finds the most of them (0.7, 0.8 or 0.9 of the largest radius; ties: the lower). */
export function bestTips(sp: string): Tip[] { let best = tipsOf(sp, 0.7).tips; for (const th of [0.8, 0.9]) { const t = tipsOf(sp, th).tips; if (t.length > best.length) best = t; } return best; }

/** The number of tips a species is ranked by: the largest group count over three thresholds (0.7, 0.8, 0.9 of the largest radius). */
export function lobeCount(sp: string): number { let m = 0; for (const th of [0.7, 0.8, 0.9]) m = Math.max(m, tipsOf(sp, th).tips.length); return m; }

export interface PStat {
  frac: number; births: number; rise: number; peakUp10: number; peak10From01: number; reset: number; below: number; lowestEnd: number;
  fall: number; low0: number; landed: boolean; landRise: number; landUp10: number; land10: number; restAt: number; endSpeed: number; y0: number; hdisp: number; fold: number;
}
const lowest = (b: SoftBody): number => { const P = b.positions; let m = Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; return m; };

/** Step the scene `secs` and measure each body of `bs` from the frame it was placed in: X13 literal (from the swap) and from its LANDING. The landing is the first impact: the frame the centre's downward
 *  speed falls under 40 % of its fastest (the table, or another body), when the piece fell faster than 1 m/s and more than 5 cm at all; a piece that never fell fast (born on the table or on a support) lands at the swap.
 *  Rebound = how far the centre climbs above its running minimum after the landing. */
export function track(sc: Scene, bs: SoftBody[], secs: number): PStat[] {
  const N = Math.round(secs / DT), H: V3[][] = bs.map((b) => [{ x: b.center.x, y: b.center.y, z: b.center.z }]);
  const st: PStat[] = bs.map((b) => ({ frac: b.frac ?? 0, births: 0, rise: 0, peakUp10: 0, peak10From01: 0, reset: 0, below: 0, lowestEnd: 0, fall: 0, low0: lowest(b), landed: false, landRise: 0, landUp10: 0, land10: 0, restAt: -1, endSpeed: 0, y0: b.center.y, hdisp: 0, fold: 0 }));
  const resets0 = bs.map((b) => b.debug.safetyResets);
  for (let i = 1; i <= N; i++) {
    frame(sc);
    for (let k = 0; k < bs.length; k++) {
      const b = bs[k], c = b.center; H[k].push({ x: c.x, y: c.y, z: c.z });
      const s = st[k];
      if (c.y - s.y0 > s.rise) s.rise = c.y - s.y0;
      const lo = lowest(b); if (lo < s.below) s.below = lo;
      if (i >= 6) {
        const a = H[k][i - 6], v = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z) / 0.1, up = (c.y - a.y) / 0.1;
        if (up > s.peakUp10) s.peakUp10 = up;
        if (v > s.peak10From01) s.peak10From01 = v;
        if (s.restAt < 0 && v < 0.05 && i > 12) s.restAt = i * DT;
        if (v >= 0.05) s.restAt = -1;
        s.endSpeed = v;
      }
    }
  }
  for (let k = 0; k < bs.length; k++) {
    const s = st[k], b = bs[k], h = H[k];
    s.reset = b.debug.safetyResets - resets0[k]; s.lowestEnd = lowest(b);
    const e = h[h.length - 1], a = h[0]; s.hdisp = Math.hypot(e.x - a.x, e.z - a.z);
    const m = b.metrics as unknown as { maxFoldDeg?: number; fold?: number }; s.fold = m.maxFoldDeg ?? m.fold ?? 0;
    // the landing frame
    let fastest = 0, land = 0;
    for (let i = 6; i < h.length; i++) { const dn = (h[i - 6].y - h[i].y) / 0.1; if (dn > s.fall) s.fall = dn; }   // the fastest 0.1 s fall of the centre
    for (let i = 1; i < h.length; i++) {
      const vy = (h[i].y - h[i - 1].y) / DT;
      if (vy < fastest) fastest = vy;
      if (fastest < -1.0 && h[0].y - h[i].y > 0.05 && vy > 0.4 * fastest) { land = i; break; }
    }
    s.landed = true;
    // the bounce: how far the centre climbs above its running minimum after the landing (a squashed piece springing back to its rest height is a few cm of this)
    let ymin = h[land].y;
    for (let i = land; i < h.length; i++) {
      if (h[i].y < ymin) ymin = h[i].y;
      if (h[i].y - ymin > s.landRise) s.landRise = h[i].y - ymin;
      if (i >= land + 6) {
        const v = Math.hypot(h[i].x - h[i - 6].x, h[i].y - h[i - 6].y, h[i].z - h[i - 6].z) / 0.1, up = (h[i].y - h[i - 6].y) / 0.1;
        if (v > s.land10) s.land10 = v;
        if (up > s.landUp10) s.landUp10 = up;
      }
    }
  }
  return st;
}

export interface Case { sp: string; kind: string; label: string; ok: boolean; why?: string; pieces: number; shares: number[]; st: PStat[]; heights: number[]; sum: number; parts?: number }
/** One cut of a fresh settled squishy by the world plane `planeOf(body)`. Every piece that comes out of it is measured. */
export function runCase(sp: string, kind: string, label: string, planeOf: (b: SoftBody) => CutPlane, secs = SECS): Case {
  const sc = newScene(sp, 1.5);
  const b0 = sc.bodies[0];
  const plane = planeOf(b0);
  const before = new Set(sc.bodies);
  const r = cutOnce(sc, b0, plane, { mode: 'at' });
  if (!r.ok) return { sp, kind, label, ok: false, why: r.why, pieces: 0, shares: [], st: [], heights: [], sum: 0 };
  const nb = sc.bodies.filter((b) => !before.has(b));
  const heights = nb.map((b) => b.center.y);
  const st = track(sc, nb, secs);
  return { sp, kind, label, ok: true, pieces: nb.length, shares: nb.map((b) => b.frac ?? 0), st, heights, sum: nb.reduce((s, b) => s + (b.frac ?? 0), 0) };
}

export interface Grade { launch: string[]; land: string[]; settle: string[]; info: string[] }
export function grade(s: PStat): Grade {
  const launch: string[] = [], land: string[] = [], settle: string[] = [], info: string[] = [];
  const fallen = s.fall > 1.5;   // a piece that really fell (hit at 1.5 m/s or more) is graded from its landing; one that was set down or settled on a support gets the X13 bars from the swap
  if (!fallen) {
    if (s.rise > 0.06) launch.push(`rise ${f(s.rise, 3)}`);
    if (s.peakUp10 > 1.0) launch.push(`up ${f(s.peakUp10)}`);
  } else {
    if (s.landRise > 0.06) land.push(`landRise ${f(s.landRise, 3)}`);
    if (s.landUp10 > 1.0) land.push(`landUp ${f(s.landUp10)}`);
    if (s.land10 > 1.2) info.push(`land10 ${f(s.land10)}`);   // (tumbling after a fall: the third X13 bar measured from the landing; reported, not a launch)
    if (!s.landed) land.push('never landed');
  }
  if (s.reset > 0) launch.push(`resets ${s.reset}`);
  if (s.lowestEnd < -0.002) launch.push(`below ${f(s.lowestEnd * 1000, 1)} mm`);
  if (s.restAt < 0) settle.push(`not at rest (${f(s.endSpeed, 2)} m/s)`);   // (settling is reported on its own: a water body sloshes for seconds, a viscoelastic one creeps)
  return { launch, land, settle, info };
}

const species = (): string[] => {
  if (arg('species')) return arg('species').split(',');
  if (argv.includes('--fam12')) return FAM12;
  if (argv.includes('--u02')) { const ids = CATALOG.map((c) => c.id as string).filter((sp) => lobeCount(sp) >= 3); return [...new Set([...FAM12, ...ids])]; }   // U02: the 12 family representatives and every species with 3 or more lobes
  if (!arg('lobed')) return ['granulo', 'dollop', 'munchip'];   // the quick set (run_probes); --lobed=8 the eight most lobed, --u02 the whole acceptance set
  const n = +arg('lobed');
  const all = CATALOG.map((c) => c.id as string).map((sp) => ({ sp, n: lobeCount(sp) }));
  all.sort((a, b) => b.n - a.n || a.sp.localeCompare(b.sp));
  return all.slice(0, n).map((a) => a.sp);
};

const results: Case[] = [];
let infoN = 0, settleN = 0;
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('probe_tips.ts')) {
  const sps = species();
  console.log('species', sps.join(' '), ' lobes', sps.map((s) => lobeCount(s)).join(' '));
  for (const sp of sps) {
    const tips = bestTips(sp);
    const cases: Array<{ kind: string; label: string; plane: (b: SoftBody) => CutPlane }> = [];
    if (run('one')) {
      tips.slice(0, 5).forEach((t, i) => {
        for (const fr of [0.62, 0.8]) cases.push({ kind: 'one', label: `tip${i}@${fr}`, plane: (b) => planeThrough(b, t.dir, fr * t.r / b.restRadius) });
      });
    }
    if (run('several') && tips.length >= 2) {
      // two neighbouring tips (the pair with the smallest angle) taken by one plane, and every tip taken by a plane through the outer ring
      let bi = 0, bj = 1, ba = Infinity;
      for (let i = 0; i < tips.length; i++) for (let j = i + 1; j < tips.length; j++) { const d = tips[i].dir.x * tips[j].dir.x + tips[i].dir.y * tips[j].dir.y + tips[i].dir.z * tips[j].dir.z; if (-d < ba) { ba = -d; bi = i; bj = j; } }
      const m = { x: tips[bi].dir.x + tips[bj].dir.x, y: tips[bi].dir.y + tips[bj].dir.y, z: tips[bi].dir.z + tips[bj].dir.z };
      const ml = Math.hypot(m.x, m.y, m.z) || 1, mu = { x: m.x / ml, y: m.y / ml, z: m.z / ml };
      const proj = (t: Tip): number => t.r * (t.dir.x * mu.x + t.dir.y * mu.y + t.dir.z * mu.z);
      const pm = Math.min(proj(tips[bi]), proj(tips[bj]));
      for (const fr of [0.8, 0.9]) cases.push({ kind: 'several', label: `pair${bi}${bj}@${fr}`, plane: (b) => planeThrough(b, mu, fr * pm / b.restRadius) });
      // a level plane (normal +y) low enough to take every tip above it
      const up = { x: 0, y: 1, z: 0 };
      const ys = tips.map((t) => t.r * t.dir.y).sort((a, b) => a - b);
      cases.push({ kind: 'several', label: 'level-upper-tips', plane: (b) => planeThrough(b, up, (ys[Math.max(0, ys.length - 3)] * 0.8) / b.restRadius) });
    }
    if (run('middle')) {
      // after the tips are gone the middle goes on: a plane through the middle, perpendicular to the first tip, and a median split (Split in two)
      const t0 = tips[0] ?? { dir: { x: 1, y: 0, z: 0 }, r: 0.5, n: 0 };
      cases.push({ kind: 'middle', label: 'across-middle', plane: (b) => planeThrough(b, t0.dir, 0.0) });
    }
    for (const c of cases) {
      const t0 = performance.now();
      let res: Case;
      try { res = runCase(sp, c.kind, c.label, c.plane); } catch (e) { res = { sp, kind: c.kind, label: c.label, ok: false, why: 'THROW ' + (e as Error).message, pieces: 0, shares: [], st: [], heights: [], sum: 0 }; }
      results.push(res);
      const bad: string[] = [];
      if (!res.ok) { console.log(`${sp.padEnd(10)} ${c.label.padEnd(18)} refused: ${res.why}`); continue; }
      const lines = res.st.map((s, k) => {
        const g = grade(s);
        const flags = [...g.launch, ...g.land, ...g.settle];
        if (g.settle.length) settleN++;
        if (g.info.length) infoN++;
        if (flags.length) bad.push(`piece${k}: ${flags.join(', ')}`);
        return `    #${k} share ${f(res.shares[k], 4)} y0 ${f(s.y0, 2)} low0 ${f(s.low0, 2)} rise ${f(s.rise, 3)} up ${f(s.peakUp10)} peak ${f(s.peak10From01)} landed ${s.landed ? 'y' : 'n'} landRise ${f(s.landRise, 3)} landUp ${f(s.landUp10)} land10 ${f(s.land10)} rest ${f(s.restAt, 1)} hdisp ${f(s.hdisp, 2)}`;
      });
      console.log(`${sp.padEnd(10)} ${c.label.padEnd(18)} pieces ${res.pieces} sum ${f(res.sum, 6)} ${bad.length ? 'FAIL ' + bad.join(' | ') : 'ok'} (${f((performance.now() - t0) / 1000, 1)} s)`);
      if (V || bad.length) for (const l of lines) console.log(l);
    }
  }
  const okc = results.filter((r) => r.ok), cnt = (fn: (r: Case) => boolean): number => okc.filter(fn).length;
  const failing = (r: Case): boolean => r.st.some((s, k) => { const g = grade(s); return g.launch.length + g.land.length > 0; });   // (launch bars and landing bars; settling is counted apart)
  console.log(`(tumbled faster than 1.2 m/s 0.1 s after landing, info only: ${infoN} pieces; still moving at the end of the run, OPEN settle: ${settleN} pieces)`);
  console.log(`\nSUMMARY ${results.length} cuts, ${okc.length} made, ${results.length - okc.length} refused, ${cnt((r) => !failing(r))} within the bars, ${cnt(failing)} not`);
  console.log('by kind', JSON.stringify(['one', 'several', 'middle'].map((k) => ({ k, made: results.filter((r) => r.kind === k && r.ok).length, refused: results.filter((r) => r.kind === k && !r.ok).length, bad: results.filter((r) => r.kind === k && r.ok && failing(r)).length }))));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify(results, null, 1));
  const thrown = results.filter((r) => !r.ok && String(r.why).startsWith('THROW')).length;
  process.exit(cnt(failing) === 0 && thrown === 0 ? 0 : 1);
}
