// PHYS, CUT3 leg 3 (U03, CUT3 2 item 3): a cut whose side is made of several separate parts (a star's tips, both ears of munchip / selenuff, a tip and a horn) makes ONE BODY PER PART.
// The real SoftBody planCut / prepareCut / constructor. Plain node (type stripping):
//   node _harness/probe_parts.ts [--species=a,b | --lobed=8] [--only=plans,volume,det,nested,perf] [--v]
//   plans   = a battery of planes (every pair / triple of tips x 3 depths, a level plane, random planes): how many cuts have a side of 2+ parts, how many of those are built / refused, and why
//   volume  = for every multi-part cut that was built: the entries' shares sum to 1 (1e-9); each body is built at its share (mesh volume = share x V3, 1e-9); the bodies together hold the parent's volume (0.5 %, U03)
//   det     = the same plan twice from cold caches gives identical bodies (offsets, particle counts)
//   nested  = the pieces of a multi-part cut cut again (a part with a token cut through its middle: the grandchildren inherit the token and build)
//   perf    = planCut with the parts analysis against the same cut without it
import { SoftBody } from '../src/physics/softbody.ts';
import { clearPieceCache } from '../src/physics/piece.ts';
import { speciesBaseGenome, CATALOG } from '../src/data/catalog.ts';
import type { CutPlan, CutPlane, PieceRegion, V3 } from '../src/contracts.ts';
import { mkPlan, planeThrough } from './physview/swap_flow.ts';
import { bestTips, lobeCount } from './probe_tips.ts';
import { mulberry32 } from '../src/core/rng.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string => (argv.find((a) => a.startsWith('--' + k + '=')) ?? '').slice(k.length + 3);
const V = argv.includes('--v');
const only = arg('only') ? arg('only').split(',') : [];
const run = (s: string): boolean => only.length === 0 || only.includes(s);
const t0 = performance.now();
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); console.log(`${pass ? 'ok  ' : 'FAIL'}  ${what}\n          ${value}   [${limit}]`); };
const f = (x: number, d = 2): string => x.toFixed(d);
const unitV = (m: V3): V3 => { const l = Math.hypot(m.x, m.y, m.z) || 1; return { x: m.x / l, y: m.y / l, z: m.z / l }; };

const species = (): string[] => {
  if (arg('species')) return arg('species').split(',');
  if (!arg('lobed')) return ['granulo', 'munchip', 'selenuff'];   // the quick set (run_probes: about 3 minutes); --lobed=8 adds the eight most lobed species
  const n = +arg('lobed');
  const all = CATALOG.map((c) => c.id as string).map((sp) => ({ sp, n: lobeCount(sp) }));
  all.sort((a, b) => b.n - a.n || a.sp.localeCompare(b.sp));
  const pick = all.slice(0, n).map((a) => a.sp);
  for (const e of ['munchip', 'selenuff']) if (!pick.includes(e)) pick.push(e);   // (the two species whose ears CUT2 4.4 refused)
  return pick;
};

interface Rec { sp: string; label: string; parts: number; sound: boolean; prep: string; shares: number[]; sum: number; builtVol: number[]; wantVol: number[]; parentVol: number; sumBuilt: number }
const meshVol = (b: SoftBody): number => {
  const Q = (b as unknown as { Q: Float64Array }).Q, tr = b.indices; let v = 0;
  for (let t = 0; t < tr.length; t += 3) {
    const a = tr[t] * 3, c = tr[t + 1] * 3, d = tr[t + 2] * 3;
    v += (Q[a] * (Q[c + 1] * Q[d + 2] - Q[c + 2] * Q[d + 1]) + Q[a + 1] * (Q[c + 2] * Q[d] - Q[c] * Q[d + 2]) + Q[a + 2] * (Q[c] * Q[d + 1] - Q[c + 1] * Q[d])) / 6;
  }
  return v;
};

/** Plan, prepare and BUILD the bodies of one cut as the shell does (a region per entry with its token). */
function cutAll(b: SoftBody, genome: ReturnType<typeof speciesBaseGenome>, plane: CutPlane, label: string, sp: string): Rec | null {
  const plan: CutPlan = mkPlan();
  if (!b.planCut!(plane, plan, 'at')) return null;
  const rec: Rec = { sp, label, parts: plan.parts ?? 2, sound: plan.sound, prep: '', shares: [], sum: 0, builtVol: [], wantVol: [], parentVol: 0, sumBuilt: 0 };
  let r: boolean | string = false, guard = 0;
  while (r === false && guard++ < 600) r = b.prepareCut!(Infinity, 6);
  rec.prep = String(r);
  if (r !== true) return rec;
  const p2 = mkPlan();
  if (!b.planCut!(plane, p2, 'latched')) { rec.prep = 'latched-false'; return rec; }
  const pf = b.frac!;
  const ent = p2.partList ? p2.partList.map((e) => ({ side: e.side, part: e.part, frac: pf * e.frac })) : [{ side: 0 as 0 | 1, part: undefined as number | undefined, frac: pf * p2.fa }, { side: 1 as 0 | 1, part: undefined as number | undefined, frac: pf * (1 - p2.fa) }];
  rec.shares = ent.map((e) => e.frac / pf); rec.sum = rec.shares.reduce((a, c) => a + c, 0);
  const id = 77, planes = [{ id, n: { ...p2.rest.n }, d: p2.rest.d }];
  const V3 = meshVol(new SoftBody(genome, { piece: { frac: 1, chunk: false } } as never)) / 1;   // (the Minis path at frac 1: the whole at detail 3)
  rec.parentVol = pf * V3;
  for (const e of ent) {
    const rg: PieceRegion = { planes, cells: [[e.side === 0 ? id : -id]], ...(e.part !== undefined ? { part: e.part } : {}) };
    try {
      const nb = new SoftBody(genome, { piece: { frac: e.frac, region: rg } } as never);
      rec.builtVol.push(meshVol(nb)); rec.wantVol.push(e.frac * V3);
    } catch (err) { rec.prep = 'construct: ' + (err as Error).message; return rec; }
  }
  rec.sumBuilt = rec.builtVol.reduce((a, c) => a + c, 0);
  return rec;
}

const recs: Rec[] = [];
const sps = species();
console.log('species', sps.join(' '));
if (run('plans') || run('volume')) {
  for (const sp of sps) {
    const g = speciesBaseGenome(sp as never, 1);
    const tips = bestTips(sp);
    const rng = mulberry32(7);
    const planes: Array<[string, V3, number]> = [];
    const unit = (m: V3): V3 => { const l = Math.hypot(m.x, m.y, m.z) || 1; return { x: m.x / l, y: m.y / l, z: m.z / l }; };
    const dot = (a: V3, c: V3): number => a.x * c.x + a.y * c.y + a.z * c.z;
    for (let i = 0; i < tips.length; i++) for (let j = i + 1; j < tips.length; j++) {
      const u = unit({ x: tips[i].dir.x + tips[j].dir.x, y: tips[i].dir.y + tips[j].dir.y, z: tips[i].dir.z + tips[j].dir.z });
      const pm = Math.min(tips[i].r * dot(tips[i].dir, u), tips[j].r * dot(tips[j].dir, u));
      for (const fr of [0.7, 0.8, 0.9]) planes.push([`pair${i}${j}@${fr}`, u, fr * pm]);
    }
    for (let k = 0; k < 6; k++) { const u = unit({ x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 }); planes.push([`rnd${k}`, u, (0.3 + 0.5 * rng()) * 0.5]); }
    planes.push(['level+0.5', { x: 0, y: 1, z: 0 }, 0.5 * 0.5], ['level+0.3', { x: 0, y: 1, z: 0 }, 0.3 * 0.5]);
    for (const [label, n, off] of planes) {
      const b = new SoftBody(g);
      for (let i = 0; i < 30; i++) b.step(1 / 60);
      const rec = cutAll(b, g, planeThrough(b, n, off / b.restRadius), label, sp);
      if (rec) { recs.push(rec); if (V && rec.parts > 2) console.log(`   ${sp} ${label}: ${rec.parts} bodies ${rec.shares.map((x) => x.toFixed(4)).join(' ')} prep ${rec.prep}`); }
    }
  }
  const multi = recs.filter((r) => r.parts > 2), built = multi.filter((r) => r.prep === 'true'), refused = multi.filter((r) => r.prep !== 'true');
  const reasons: Record<string, number> = {};
  for (const r of refused) reasons[r.prep] = (reasons[r.prep] ?? 0) + 1;
  const loose = recs.filter((r) => r.parts <= 2 && r.prep === 'loose').length, plain = recs.filter((r) => r.parts <= 2).length;
  add('plans: cuts planned / with a side of 2+ parts / built as several bodies', `${recs.length} planned, ${multi.length} multi-part, ${built.length} built, ${refused.length} refused (${JSON.stringify(reasons)}); plain cuts ${plain}, of them 'loose' (a connected region no centre sees: the M of two tips with the valley between) ${loose}`, 'info', true);
  add('multi-part cuts exist on the lobed species (munchip and selenuff included: the ears CUT2 4.4 refused)', `${multi.length} cuts, species ${[...new Set(multi.map((r) => r.sp))].join(' ')}`, '>= 1 per ear species', multi.some((r) => r.sp === 'munchip') && multi.some((r) => r.sp === 'selenuff'));
  if (run('volume')) {
    let worstSum = 0, worstVol = 0, worstTot = 0;
    for (const r of built) {
      worstSum = Math.max(worstSum, Math.abs(r.sum - 1));
      for (let k = 0; k < r.builtVol.length; k++) worstVol = Math.max(worstVol, Math.abs(r.builtVol[k] / r.wantVol[k] - 1));
      worstTot = Math.max(worstTot, Math.abs(r.sumBuilt / r.parentVol - 1));
    }
    add('multi-part: the shares of the bodies sum to 1', `${built.length} cuts, worst ${worstSum.toExponential(2)}`, '<= 1e-9', worstSum <= 1e-9);
    add('multi-part: each body is built at its share (mesh volume = share x V3)', `worst relative error ${worstVol.toExponential(2)}`, '<= 1e-9', worstVol <= 1e-9);
    add('multi-part: the bodies together hold the parent\'s volume (U03)', `worst ${(100 * worstTot).toFixed(4)} %`, '<= 0.5 %', worstTot <= 0.005);
    const bad = built.filter((r) => r.builtVol.length !== r.parts);
    add('multi-part: one body per entry of partList', `${bad.length} cuts with a different count`, '0', bad.length === 0);
  }
}
if (run('det')) {
  // the same munchip / granulo plane twice from cold caches
  let same = 0, total = 0;
  for (const [sp, n, off] of [['munchip', { x: 0, y: 1, z: 0 }, 0.5 * 0.5], ['granulo', { x: 0, y: 1, z: 0 }, 0.5 * 0.5]] as Array<[string, V3, number]>) {
    const g = speciesBaseGenome(sp as never, 1);
    const h: string[] = [];
    for (let k = 0; k < 2; k++) {
      clearPieceCache();
      const b = new SoftBody(g); for (let i = 0; i < 30; i++) b.step(1 / 60);
      const plan = mkPlan();
      if (!b.planCut!(planeThrough(b, n, off / b.restRadius), plan, 'at')) { h.push('miss'); continue; }
      let r: boolean | string = false, guard = 0; while (r === false && guard++ < 600) r = b.prepareCut!(Infinity, 6);
      const p2 = mkPlan(); b.planCut!(planeThrough(b, n, off / b.restRadius), p2, 'latched');
      h.push(String(r) + (p2.partList ?? []).map((e) => `${e.side}:${e.part}:${e.frac.toPrecision(15)}:${e.off.x.toPrecision(12)},${e.off.y.toPrecision(12)},${e.off.z.toPrecision(12)}`).join(';'));
    }
    total++; if (h[0] === h[1]) same++;
    if (V) console.log('  ', sp, h[0].slice(0, 160));
  }
  add('determinism: the same multi-part plane twice from cold caches', `${same} of ${total} identical (plan entries and built offsets)`, 'all', same === total);
}
if (run('optin')) {
  // (1) without `acceptParts` the cut is refused as before (a shell that does not know parts never meets one)
  const g = speciesBaseGenome('munchip' as never, 1), tp = bestTips('munchip'), mm = { x: tp[0].dir.x + tp[1].dir.x, y: tp[0].dir.y + tp[1].dir.y, z: tp[0].dir.z + tp[1].dir.z }, ml = Math.hypot(mm.x, mm.y, mm.z), n = { x: mm.x / ml, y: mm.y / ml, z: mm.z / ml } as V3;
  const offE = 0.8 * Math.min(tp[0].r * (tp[0].dir.x * n.x + tp[0].dir.y * n.y + tp[0].dir.z * n.z), tp[1].r * (tp[1].dir.x * n.x + tp[1].dir.y * n.y + tp[1].dir.z * n.z));   // the plane takes both ears at 0.8 of their reach
  {
    const b = new SoftBody(g); for (let i = 0; i < 30; i++) b.step(1 / 60);
    const plan = mkPlan(); plan.acceptParts = false;
    const ok = b.planCut!(planeThrough(b, n, offE / b.restRadius), plan, 'at');
    let r: boolean | string = false, guard = 0; while (r === false && guard++ < 400) r = b.prepareCut!(Infinity, 6);
    add('opt-in: a plan without acceptParts reports a plain pair and the cut is refused as CUT2 4.4 did', `planCut ${ok}, parts ${plan.parts}, partList ${plan.partList === undefined ? 'absent' : 'present'}, prepareCut ${r}`, "parts 2, no list, 'loose'", ok && plan.parts === 2 && plan.partList === undefined && r === 'loose');
  }
  // (2) the shell may swap before the background build has finished: the bodies are then built by the constructor from the registered part centres
  {
    clearPieceCache();
    const b = new SoftBody(g); for (let i = 0; i < 30; i++) b.step(1 / 60);
    const plane = planeThrough(b, n, offE / b.restRadius), plan = mkPlan();
    b.planCut!(plane, plan, 'at');
    b.prepareCut!(Infinity, 1);   // one stage only: nothing is cached yet
    const p2 = mkPlan(); b.planCut!(plane, p2, 'latched');
    const pf = b.frac!, id = 91, planes = [{ id, n: { ...p2.rest.n }, d: p2.rest.d }];
    let built = 0, bad = '';
    for (const e of p2.partList ?? []) {
      try { const rg: PieceRegion = { planes, cells: [[e.side === 0 ? id : -id]], ...(e.part !== undefined ? { part: e.part } : {}) }; const nb = new SoftBody(g, { piece: { frac: pf * e.frac, region: rg } } as never); if (Math.abs(meshVol(nb) / (pf * e.frac * (meshVol(new SoftBody(g, { piece: { frac: 1, chunk: false } } as never)))) - 1) < 1e-9) built++; } catch (err) { bad = (err as Error).message; }
    }
    add('swap before the build finished: every body of the cut is built by the constructor (part centres registered at planning)', `${built} of ${(p2.partList ?? []).length} bodies built at their share${bad ? ' (' + bad + ')' : ''}`, 'all', built === (p2.partList ?? []).length && built > 2);
  }
}
if (run('nested')) {
  // a part of a multi-part cut (it carries a token) is cut again: both children inherit the token and build; the grandchildren of a cut with parts get tokens built from it
  const g = speciesBaseGenome('granulo' as never, 1), tp = bestTips('granulo');
  const b = new SoftBody(g); for (let i = 0; i < 30; i++) b.step(1 / 60);
  // two adjacent tips taken at 0.9 of their reach (3 bodies)
  let bi = 0, bj = 1, ba = Infinity;
  for (let i = 0; i < tp.length; i++) for (let j = i + 1; j < tp.length; j++) { const d = tp[i].dir.x * tp[j].dir.x + tp[i].dir.y * tp[j].dir.y + tp[i].dir.z * tp[j].dir.z; if (-d < ba) { ba = -d; bi = i; bj = j; } }
  const mm = { x: tp[bi].dir.x + tp[bj].dir.x, y: tp[bi].dir.y + tp[bj].dir.y, z: tp[bi].dir.z + tp[bj].dir.z }, ml = Math.hypot(mm.x, mm.y, mm.z), u = { x: mm.x / ml, y: mm.y / ml, z: mm.z / ml };
  const off = 0.9 * Math.min(tp[bi].r * (tp[bi].dir.x * u.x + tp[bi].dir.y * u.y + tp[bi].dir.z * u.z), tp[bj].r * (tp[bj].dir.x * u.x + tp[bj].dir.y * u.y + tp[bj].dir.z * u.z));
  const plane = planeThrough(b, u, off / b.restRadius), plan = mkPlan();
  b.planCut!(plane, plan, 'at');
  let r: boolean | string = false, guard = 0; while (r === false && guard++ < 600) r = b.prepareCut!(Infinity, 6);
  const p2 = mkPlan(); b.planCut!(plane, p2, 'latched');
  const pf = b.frac!, id = 5, planes = [{ id, n: { ...p2.rest.n }, d: p2.rest.d }];
  const kids = (p2.partList ?? []).map((e) => new SoftBody(g, { piece: { frac: pf * e.frac, region: { planes, cells: [[e.side === 0 ? id : -id]], ...(e.part !== undefined ? { part: e.part } : {}) } as PieceRegion } } as never));
  const iTip = (p2.partList ?? []).findIndex((e) => e.part !== undefined);
  let ok = r === true && kids.length === 3 && iTip >= 0, why = String(r);
  if (ok) {
    const tip = kids[iTip], tok = p2.partList![iTip].part;
    for (let i = 0; i < 30; i++) tip.step(1 / 60);
    const pl2 = mkPlan(), c = tip.center, nn = unitV(tp[bi].dir);
    const planeT = { point: { x: c.x, y: c.y, z: c.z }, normal: nn };
    const okp = tip.planCut!(planeT, pl2, 'at');
    let r2: boolean | string = false, g2 = 0; while (r2 === false && g2++ < 600) r2 = tip.prepareCut!(Infinity, 6);
    const p3 = mkPlan(); const okl = tip.planCut!(planeT, p3, 'latched');
    ok = okp && okl && r2 === true && (p3.partList ?? []).length === 2 && (p3.partList ?? []).every((e) => e.part === tok);
    why = `tip token ${tok}: planCut ${okp}, prepareCut ${r2}, entries ${(p3.partList ?? []).map((e) => e.part).join(',')}`;
    if (ok) {
      const pf2 = tip.frac!, id2 = 9, planes2 = [...planes, { id: id2, n: { ...p3.rest.n }, d: p3.rest.d }];
      for (const e of p3.partList!) {
        const rg: PieceRegion = { planes: planes2, cells: [[iTip >= 0 && p2.partList![iTip].side === 0 ? id : -id, e.side === 0 ? id2 : -id2]], part: e.part };
        try { const nb = new SoftBody(g, { piece: { frac: pf2 * e.frac, region: rg } } as never); if (!(nb.frac! > 0)) ok = false; } catch (err) { ok = false; why += ' build: ' + (err as Error).message; }
      }
    }
  }
  add('nested: a part (token) cut again: both children inherit the token and build', why, 'prepareCut true, 2 entries with the parent token', ok);
}
if (run('perf')) {
  const g = speciesBaseGenome('granulo' as never, 1), b = new SoftBody(g); for (let i = 0; i < 30; i++) b.step(1 / 60);
  const pl = planeThrough(b, { x: 0.3, y: 0.9, z: 0.1 }, 0.1 / b.restRadius), plA = mkPlan(), plB = mkPlan(); plB.acceptParts = false;
  const time = (p: CutPlan, n: number): number => { const t = performance.now(); for (let i = 0; i < n; i++) b.planCut!(pl, p, 'at'); return (performance.now() - t) / n; };
  time(plA, 5); time(plB, 5);
  let a = Infinity, c = Infinity;   // interleaved, best of 8 batches of 20 each (a shared machine moves by a factor of two between batches)
  for (let k = 0; k < 8; k++) { a = Math.min(a, time(plA, 20)); c = Math.min(c, time(plB, 20)); }
  add('planCut with the parts analysis (whole of 642 particles, ordinary plane)', `${a.toFixed(3)} ms with, ${c.toFixed(3)} ms without (+${(a - c).toFixed(3)} ms)`, 'extra <= 1 ms', a - c <= 1);
}
console.log(`\n${rows.filter((r) => r.pass).length} / ${rows.length} rows ok, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
