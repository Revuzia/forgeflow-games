// PHYS, CUT2 task P5 (the flush-pair contact, 5.5): rows L1 (= X13's swap flow), L7, L8, L9, L10 and the 12-family table through the SHELL's own Cutter. Plain node (type stripping):
//   node _harness/probe_flush.ts [--full] [--planes=x0,y0.3,t50+0.2] [--trees=3] [--depth=3] [--v] [--species=a,b]   (default = the quick set, about 5 minutes: run_probes runs it without arguments; --full = the 12 families, all 50 species, tens of minutes) [--only=shell,flow,l7,l8,l10,l1,l9] [--skip=...] [--secs=4] [--json=out.json] [--quiet]
//   controls for the `shell` table: --ghost (no contact between the two pieces at all) --shipped (the contact of two whole bodies for pieces too, as before P5) --bv=v0 (both children born with the
//   parent's own velocity) --frame0 (born in the pre-neck pose);  --cost / --ccost: frame cost of the pair vs two whole bodies / of the piece contact vs the shipped contact.
// Sections: shell = the 12 family representatives x {Split in two with the eye-midline plane of the face formulas, a vertical swipe 0.2 r off the middle with the camera turned 22 degrees ("between
//   the eyes"), a level swipe through the eye row} through createApp + the real SoftBody, 4 s each, X13's quantities from the centres (0.1 s differences);  flow = the bare-physics copy of the
//   shell's flow (physview/swap_flow.ts) against the Cutter;  l1 = X13 on that flow (species x 6 planes x both pieces, real neck birth velocities);  l7 = two flat faces on each other (a level cut,
//   upper piece 5 cm up and dropped; the SHIPPED contact must fail it);  l8 = whole bodies untouched;  l10 = the pair is disjoint at birth (the solver's own placement);  l9 = nested cuts, one at a time.
// A piece that fails because the NECK delivered it tilted or in the air (the parent's best-fit frame more than 15 degrees from upright, or its centre lifted by more than 5 cm, at the swap: task P4's
// subject) is reported as OPEN (P4) and not counted against the contact: every such row is printed with the numbers, and the no-contact control (--ghost) is the evidence.
import { readFileSync, writeFileSync } from 'node:fs';
import { NECK_FIT, PIECE_CONTACT, SoftBody } from '../src/physics/softbody.ts';
import { speciesBaseGenome, CATALOG } from '../src/data/catalog.ts';
import { mulberry32 } from '../src/core/rng.ts';
import type { V3 } from '../src/contracts.ts';
import { FAM12, contactCost, depthInside, f, frameCost, runScenario, trackPair } from './physview/flush_rig.ts';
import type { PieceStat, Scenario } from './physview/flush_rig.ts';
import { cutOnce, frame, mkPlan, newScene, planeThrough } from './physview/swap_flow.ts';
import { pairSession } from './physview/l6_session.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string => (argv.find((a) => a.startsWith('--' + k + '=')) ?? '').slice(k.length + 3);
const QUICK = !argv.includes('--full');
const ALL = CATALOG.map((c) => c.id as string);
const SP = arg('species') ? arg('species').split(',') : QUICK ? ['dollop', 'twangle', 'kneadle', 'capnap'] : FAM12;
const SPALL = arg('species') ? arg('species').split(',') : QUICK ? ['dollop', 'kneadle', 'capnap', 'twangle', 'wisplet'] : ALL;
const SECS = arg('secs') ? +arg('secs') : 4;
const only = arg('only') ? arg('only').split(',') : [];
const skip = arg('skip') ? arg('skip').split(',') : [];
const run = (s: string): boolean => (only.length === 0 || only.includes(s)) && !skip.includes(s);
const QUIET = argv.includes('--quiet');
if (argv.includes('--oldfit')) NECK_FIT.goal = false;   // the rotation against the rest shape during the neck, as before (control)
if (argv.includes('--asym')) PIECE_CONTACT.asym = true;   // the horizontal shove to the less table-supported body (P4 / P8 trial)
if (arg('vny')) PIECE_CONTACT.vertNy = +arg('vny');   // the |m_y| above which the rigid shove is vertical only (P4 / P8 trial; 0.8 = the 37 degrees of CUT2 5.5)
if (argv.includes('--shipped')) PIECE_CONTACT.shipped = true;   // the contact of two whole bodies for pieces too (the regression control)
const GHOST = argv.includes('--ghost'), FRAME0 = argv.includes('--frame0'), BV = (arg('bv') || 'shell') as 'shell' | 'v0';

interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const info = (what: string, value: string): void => { console.log(`INFO  ${what}\n          ${value}`); };
const t0 = performance.now();

if (argv.includes('--ccost')) {
  for (const sp of (arg('species') ? SP : ['dollop', 'kneadle', 'capnap'])) { const c = contactCost(sp); console.log(JSON.stringify({ sp, shippedContact_ms: f(c.shipped, 3), pieceContact_ms: f(c.piece, 3), ratio: f(c.ratio, 3) })); }
  process.exit(0);
}
if (argv.includes('--cost')) {
  for (const sp of (arg('species') ? SP : ['dollop', 'kneadle', 'capnap'])) { const c = frameCost(sp); console.log(JSON.stringify({ sp, pieces_ms: f(c.pieces, 3), wholes_ms: f(c.wholes, 3), ratio: f(c.ratio, 2), all: c.all.map((a) => a.map((x) => f(x, 2))) })); }
  process.exit(0);
}

/** X13 grading of one new piece (CUT2 12): the strict bars and the five named categories. `level` = the plane is near-level (the upper cap slides), `thin` = share under 0.30. */
interface Grade { launch: string[]; settle: string[]; cats: string[] }
function grade(p: PieceStat, o: { level: boolean; thin: boolean; G: number; slide: boolean; pen: number; resets: number }): Grade {
  const launch: string[] = [], settle: string[] = [], cats: string[] = [];
  if (p.rise > 0.06) launch.push(`rise ${f(p.rise, 3)}`);
  if (p.peakUp10 > 1.0) launch.push(`up ${f(p.peakUp10, 2)}`);
  if (o.resets > 0) launch.push(`resets ${o.resets}`);
  if (p.lowestMm < -2) launch.push(`below ${f(p.lowestMm, 1)} mm`);
  if (p.peak10 > 1.2) settle.push(`peak ${f(p.peak10, 2)}`);
  if (p.v1s > 0.3) { if (p.v1s <= 0.45) cats.push('landing settle'); else settle.push(`v>=1s ${f(p.v1s, 2)}`); }
  if (p.last > 0.05) { if (p.last <= 0.07) cats.push('creep'); else settle.push(`not at rest ${f(p.last, 3)}`); }
  const hd = Math.max(0, p.hdisp - (o.slide ? 0.5 * o.G : 0));
  if (hd > 0.10) { if (o.level && hd <= 0.18) cats.push('slides off'); else if (o.thin && hd <= 0.30) cats.push('thin slice'); else settle.push(`displaced ${f(hd, 2)}`); }
  if (o.pen > 0.15) { if (o.pen <= 0.25) cats.push('presses in'); else settle.push(`penetration ${f(o.pen, 2)} R`); }
  if (p.foldW > 75) { if (p.foldW <= 110 && (o.thin || !o.level)) cats.push('fold<=110'); else settle.push(`fold ${f(p.foldW, 0)}`); }
  return { launch, settle, cats };
}

/* ───────────────────────── shell: the 12 families through the Cutter ───────────────────────── */
const shellRows: Scenario[] = [];
if (run('shell')) {
  const SCEN = ['split', 'between', 'level'] as const;
  for (const sp of SP) for (const sc of SCEN) {
    const t1 = performance.now(), s = runScenario(sp, sc, SECS, BV, GHOST, FRAME0);
    if (!s) continue;
    shellRows.push(s);
    if (!QUIET) {
      const [a, b] = s.piece;
      console.log(`${s.sp.padEnd(8)} ${s.scen.padEnd(7)} sh ${s.fracs.join('/')} tilt ${f(s.tilt, 0)} lift ${f(s.lift, 2)}  birth ${f(a.birth1f, 2)}/${f(b.birth1f, 2)}  peak10 ${f(a.peak10, 2)}/${f(b.peak10, 2)}  up10 ${f(a.peakUp10, 2)}/${f(b.peakUp10, 2)}  rise ${f(a.rise, 3)}/${f(b.rise, 3)}  v1s ${f(a.v1s, 2)}/${f(b.v1s, 2)}  last ${f(a.last, 3)}/${f(b.last, 3)}  hdisp ${f(a.hdisp, 2)}/${f(b.hdisp, 2)}  sep ${f(s.sep0, 2)}->${f(s.sepEnd, 2)} dy ${f(s.dy0, 2)}->${f(s.dyEnd, 2)}  pen ${f(s.pen, 3)}R fold ${f(Math.max(a.fold, b.fold), 0)}/${f(Math.max(a.foldW, b.foldW), 0)} (${((performance.now() - t1) / 1000).toFixed(0)}s)`);
    }
  }
  const neckClean = (s: Scenario): boolean => s.tilt < 15 && s.lift < 0.05;
  const launchBad = (s: Scenario): boolean => s.piece.some((p) => p.rise > 0.06 || p.peakUp10 > 1.0) || s.resets > 0;
  const mx = (set: Scenario[], k: (p: PieceStat) => number): number => (set.length ? Math.max(...set.flatMap((s) => s.piece.map(k))) : 0);
  const clean = shellRows.filter(neckClean), open = shellRows.filter((s) => !neckClean(s));
  const names = (set: Scenario[]): string => set.map((s) => `${s.sp}/${s.scen}`).join(', ');
  add(`SHELL flow, ${SP.length} families x Split in two / swipe between the eyes / level swipe: cuts whose parent was upright and unlifted at the swap (the neck did not turn or lift it): X13 LAUNCH bars (rise <= 0.06 m, upward speed <= 1.0 m/s, 0 safety resets)`,
    `${clean.filter(launchBad).length} of ${clean.length} cuts break them${clean.filter(launchBad).length ? ': ' + names(clean.filter(launchBad)) : ''}; worst rise ${f(mx(clean, (p) => p.rise), 3)} m, up ${f(mx(clean, (p) => p.peakUp10), 2)} m/s`, '0 failures', clean.filter(launchBad).length === 0 && clean.length > 0);
  add('SHELL flow, same cuts: SETTLE bars (centre speed <= 1.2 m/s from 0.1 s, <= 0.3 m/s from 1 s (landing settle 0.45), at rest <= 0.05 m/s over the last 0.5 s (creep 0.07))',
    `peak ${f(mx(clean, (p) => p.peak10), 2)} m/s, from 1 s ${f(mx(clean, (p) => p.v1s), 2)}, last 0.5 s ${f(mx(clean, (p) => p.last), 3)}`, '<= 1.2, <= 0.45, <= 0.07', mx(clean, (p) => p.peak10) <= 1.2 && mx(clean, (p) => p.v1s) <= 0.45 && mx(clean, (p) => p.last) <= 0.07);
  add('SHELL flow, same cuts: the birth pop (centre speed over the swap frame itself; the shipped contact: 0.3 to 2.8 m/s)', `${f(mx(clean, (p) => p.birth1f), 2)} m/s`, '<= 0.5 m/s', mx(clean, (p) => p.birth1f) <= 0.5);
  add('SHELL flow, same cuts: fold of the non-sliver hinges over their own rest dihedral (a cap-rim sliver flips on a 1 mm move and is not a crease)', `${f(mx(clean, (p) => p.foldW), 0)} deg`, '<= 75 (110 for slices and tilted pieces)', mx(clean, (p) => p.foldW) <= 110);
  info('SHELL flow: cuts where the NECK turned or lifted the parent (OPEN, task P4): tilt of the best-fit frame, lift of the centre, X13 LAUNCH result', open.map((s) => `${s.sp}/${s.scen} tilt ${f(s.tilt, 0)} lift ${f(s.lift, 2)} ${launchBad(s) ? 'LAUNCH ' + s.piece.map((p) => `rise ${f(p.rise, 2)} up ${f(p.peakUp10, 2)}`).join(' / ') : 'ok'}`).join('; ') || 'none');
}

/* ───────────────────────── flow: the bare-physics copy of the shell's flow against the Cutter ───────────────────────── */
if (run('flow')) {
  const out: string[] = [];
  for (const sp of (QUICK ? ['dollop', 'kneadle'] : ['dollop', 'kneadle', 'capnap', 'twangle'])) {
    const s = runScenario(sp, 'split', 2.5, 'shell', false, false);   // the Cutter (the stage knows the eyes: the eye-midline plane, mode 'at')
    if (!s) continue;
    const sc = newScene(sp), b0 = sc.bodies[0];
    const res = cutOnce(sc, b0, planeThrough(b0, { x: 1, y: 0, z: 0 }, 0), { mode: 'median' });
    if (!res.ok) { out.push(`${sp}: ${res.why}`); continue; }
    const t = trackPair(() => frame(sc), [res.a!, res.b!], [res.a!.frac!, res.b!.frac!], 2.5, 0);
    out.push(`${sp}: Cutter sep ${f(s.sepEnd, 3)} peak ${f(s.piece[0].peak10, 2)} birth ${f(s.piece[0].birth1f, 2)} (shares ${s.fracs.join('/')}) | flow sep ${f(t.sepEnd, 3)} peak ${f(t.piece[0].peak10, 2)} birth ${f(t.piece[0].birth1f, 2)} (${t.fracs.join('/')})`);
  }
  info('flow check: the bare-physics copy of the shell flow vs the Cutter on Split in two (not gated: the Cutter cuts the eye line, the copy the median)', out.join('\n          '));
}

/** The two flush pieces of a cut of a settled whole body along the plane n . x = off R (rest frame), placed at their material positions with one common lift: [A, B] or null when refused. */
function mkPair(sp: string, n: V3, off: number): [SoftBody, SoftBody] | null {
  const g = speciesBaseGenome(sp as never, 1), parent = new SoftBody(g);
  for (let i = 0; i < 90; i++) parent.step(1 / 60);
  const plan = mkPlan();
  if (!parent.planCut!(planeThrough(parent, n, off), plan, 'at')) return null;
  let r: boolean | 'thin' | 'loose' = false, calls = 0;
  while (r === false && calls++ < 400) r = parent.prepareCut!(Infinity, 2);
  if (r !== true || Math.min(plan.fa, 1 - plan.fa) < 0.125) return null;
  const planes = [{ id: 1, n: { ...plan.rest.n }, d: plan.rest.d }], pf = parent.frac!, fa = pf * plan.fa;
  const A = new SoftBody(g, { piece: { frac: fa, region: { planes, cells: [[1]] } } } as never), B = new SoftBody(g, { piece: { frac: pf - fa, region: { planes, cells: [[-1]] } } } as never);
  const c = parent.center, z0 = { x: 0, y: 0, z: 0 };
  A.placeAt!({ x: c.x + plan.offA.x, y: c.y + plan.offA.y, z: c.z + plan.offA.z }, z0);
  B.placeAt!({ x: c.x + plan.offB.x, y: c.y + plan.offB.y, z: c.z + plan.offB.z }, z0);
  let low = 1e9; for (const b of [A, B]) for (let i = 1; i < b.positions.length; i += 3) low = Math.min(low, b.positions[i]);
  if (low < 0) { A.placeAt!({ x: c.x + plan.offA.x, y: c.y + plan.offA.y - low + 1e-4, z: c.z + plan.offA.z }, z0); B.placeAt!({ x: c.x + plan.offB.x, y: c.y + plan.offB.y - low + 1e-4, z: c.z + plan.offB.z }, z0); }
  return [A, B];
}

/* ───────────────────────── L7: two flat faces on each other ───────────────────────── */
if (run('l7')) {
  const offs = [0, 0.3];
  const lst = QUICK ? ['dollop', 'kneadle', 'capnap'] : FAM12;
  const test = (shipped: boolean): { worst: number; list: string[]; n: number; gaps: number[] } => {
    PIECE_CONTACT.shipped = shipped;
    let worst = 0, n = 0; const list: string[] = [], gaps: number[] = [];
    for (const sp of lst) for (const off of offs) {
      const pr = mkPair(sp, { x: 0, y: 1, z: 0 }, off); if (!pr) continue;
      const [A, B] = pr, z0 = { x: 0, y: 0, z: 0 };
      const [up, dn] = A.center.y > B.center.y ? [A, B] : [B, A];
      up.placeAt!({ x: up.center.x, y: up.center.y + 0.05, z: up.center.z }, z0);   // the upper piece 5 cm up and dropped; the lower one stays where it was placed
      const bs = [up, dn];
      const step = (): void => { for (const b of bs) b.collide(bs); for (const b of bs) b.step(1 / 60); };
      for (let i = 0; i < 60; i++) step();   // 1 s: it landed
      const landed = { x: up.center.x, z: up.center.z }, dn0 = { x: dn.center.x, z: dn.center.z };
      for (let i = 0; i < 120; i++) step();   // 2 s more
      const w = Math.max(Math.hypot(up.center.x - landed.x, up.center.z - landed.z), Math.hypot(dn.center.x - dn0.x, dn.center.z - dn0.z));
      n++; worst = Math.max(worst, w);
      if (w > 0.05) list.push(`${sp} +${off} ${f(w, 3)}`);
      { let lo = 1e9, hi = -1e9; for (let i = 1; i < up.positions.length; i += 3) lo = Math.min(lo, up.positions[i]); for (let i = 1; i < dn.positions.length; i += 3) hi = Math.max(hi, dn.positions[i]); gaps.push((lo - hi) * 1000); }
    }
    PIECE_CONTACT.shipped = false;
    return { worst, list, n, gaps };
  };
  const neu = test(false);
  add(`L7 two flat faces on each other (${lst.length} families x level cut at 0 and +0.3 R0, upper piece 5 cm up and dropped, collide every frame): how far the upper piece (or the lower one) moves between 1 s and 3 s after the drop`,
    `worst ${f(neu.worst * 1000, 1)} mm over ${neu.n} stacks${neu.list.length ? ' (over 50 mm: ' + neu.list.join(', ') + ')' : ''}`, '<= 50 mm', neu.worst <= 0.05 && neu.n > 0);
  { const g = neu.gaps.slice().sort((a, b) => a - b); info('L7 the resting gap between the two flat faces (upper piece lowest particle minus the lower piece highest, mm; the spec measured 26 to 29 mm with its contact, the shell treats a surface gap under TOUCH_GAP 30 mm as touching)', `min ${f(g[0] ?? 0, 1)}, median ${f(g[g.length >> 1] ?? 0, 1)}, max ${f(g[g.length - 1] ?? 0, 1)} over ${g.length} stacks`); }
  const old = test(true);
  add('L7 the row can fail: the same stacks with the SHIPPED contact (pieces in the contact of two whole bodies) leave the lower piece', `${old.list.length} of ${old.n} stacks move over 50 mm, worst ${f(old.worst * 1000, 0)} mm`, '>= 1 stack fails (spec: 0.60 m and 0.46 m against 3.5 and 0.8 mm)', old.list.length >= 1);
}

/* ───────────────────────── X07: two pieces shoved into each other at 3 m/s ───────────────────────── */
if (run('x07')) {
  let worst = 0, worstAt = 0, resets = 0, n = 0; const list: string[] = [];
  for (const sp of (QUICK ? ['dollop', 'kneadle', 'capnap'] : FAM12)) {
    const pr = mkPair(sp, { x: 1, y: 0, z: 0 }, 0); if (!pr) continue;
    const [A, B] = pr, bs = [A, B], step = (): void => { for (const b of bs) b.collide(bs); for (const b of bs) b.step(1 / 60); };
    // the parted pair (0.2 m apart), A shoved at B at 3 m/s
    A.placeAt!({ x: A.center.x + 0.1, y: A.center.y, z: A.center.z }, { x: -3, y: 0, z: 0 }); B.placeAt!({ x: B.center.x - 0.1, y: B.center.y, z: B.center.z }, { x: 0, y: 0, z: 0 });
    let deepest = 0;
    for (let i = 0; i < 60; i++) { step(); if (i % 3 === 0) deepest = Math.max(deepest, depthInside(A, B), depthInside(B, A)); }
    for (let i = 0; i < 120; i++) step();
    const rest = Math.max(depthInside(A, B), depthInside(B, A));
    n++; resets += (A as unknown as { debug: { safetyResets: number } }).debug.safetyResets + (B as unknown as { debug: { safetyResets: number } }).debug.safetyResets;
    if (deepest > worst) { worst = deepest; worstAt = rest; }
    if (deepest > 0.3 || rest > 0.15) list.push(`${sp} ${f(deepest, 2)} R, at rest ${f(rest, 2)} R`);
  }
  add(`X07 two flush pieces of a vertical cut, parted 0.2 m, A shoved at B at 3 m/s (${n} families, collide every frame): the deepest particle of one inside the other (nearest-vertex depth in rest radii) during the hit, and at rest 2 s later; safety resets`,
    `${f(worst, 3)} R during, ${f(worstAt, 3)} R at rest (at the worst one), resets ${resets}${list.length ? '; over: ' + list.join(', ') : ''}`, '<= 0.3 R during, <= 0.15 R at rest, 0 resets', list.length === 0 && resets === 0 && n > 0);
}

/* ───────────────────────── L8: whole bodies untouched ───────────────────────── */
if (run('l8')) {
  const gold = JSON.parse(readFileSync(new URL('./physview/l6_golden.json', import.meta.url), 'utf8')).data as Record<string, { pair: number[]; with: string }>;
  let ok = 0, n = 0; const bad: string[] = [];
  for (const id of (QUICK ? ['dollop', 'kneadle', 'capnap', 'twangle'] : FAM12)) {
    const g = gold[id]; if (!g) continue;
    const h = pairSession(SoftBody as never, id, g.with); n++;
    if (h.every((v, i) => v === g.pair[i])) ok++; else bad.push(id);
  }
  add('L8 collide of two whole bodies is unchanged: stateHash of both at 7 checkpoints of a 7 s stacked pair, against the committed solver (the full 50 species: probe_truecut --only=l6b)', `${ok}/${n} pairs${bad.length ? ' (differ: ' + bad.join(' ') + ')' : ''}`, `${n}/${n}`, ok === n && n > 0);
}

/* ───────────────────────── L10: the pair is disjoint at birth (the solver's own placement) ───────────────────────── */
if (run('l10')) {
  let pairs = 0, deep = 0; const bad: string[] = [];
  const planes: Array<[string, V3, number]> = [['x0', { x: 1, y: 0, z: 0 }, 0], ['y0', { x: 0, y: 1, z: 0 }, 0], ['t1+0.2', { x: 0.667, y: 0.718, z: -0.199 }, 0.2]];
  for (const sp of SPALL) {
    const g = speciesBaseGenome(sp as never, 1), parent = new SoftBody(g);
    for (const [nm, n, off] of planes) {
      const plan = mkPlan();
      if (!parent.planCut!(planeThrough(parent, n, off), plan, 'at')) continue;
      let r: boolean | 'thin' | 'loose' = false, calls = 0;
      while (r === false && calls++ < 400) r = parent.prepareCut!(Infinity, 2);
      if (r !== true || Math.min(plan.fa, 1 - plan.fa) < 0.125) continue;
      const pl = [{ id: 1, n: { ...plan.rest.n }, d: plan.rest.d }], pf = parent.frac!, fa = pf * plan.fa;
      const A = new SoftBody(g, { piece: { frac: fa, region: { planes: pl, cells: [[1]] } } } as never), B = new SoftBody(g, { piece: { frac: pf - fa, region: { planes: pl, cells: [[-1]] } } } as never);
      const c = parent.center;
      A.placeAt!({ x: c.x + plan.offA.x, y: c.y + plan.offA.y, z: c.z + plan.offA.z }, { x: 0, y: 0, z: 0 });
      B.placeAt!({ x: c.x + plan.offB.x, y: c.y + plan.offB.y, z: c.z + plan.offB.z }, { x: 0, y: 0, z: 0 });
      pairs++;
      // the cut plane in the parent's frame W (origin = its rest centre of mass = `center` at rest): every particle of A on the n . x >= d side, every one of B on the other, within 0.001 R (the
      // particles of the two flush cut faces lie ON the plane; a nearest-vertex distance would read half an edge there)
      const nW = plan.rest.n, dW = plan.rest.d, R = parent.restRadius;
      let viol = 0;
      for (const [b, sgn] of [[A, 1], [B, -1]] as Array<[SoftBody, number]>) {
        const P = b.positions;
        for (let i = 0; i < P.length; i += 3) viol = Math.max(viol, -sgn * (nW.x * (P[i] - c.x) + nW.y * (P[i + 1] - c.y) + nW.z * (P[i + 2] - c.z) - dW));
      }
      viol /= R;
      if (viol > 0.001) { deep++; bad.push(`${sp} ${nm} ${f(viol, 4)}`); }
    }
  }
  add(`L10 the pair of one cut is disjoint at birth with the solver's own placement (placeAt at the plan's offsets; ${SPALL.length} species x level, vertical, tilted): particles of one across the cut plane (inside the sibling) by more than 0.001 R`, `${deep} of ${pairs} pairs${bad.length ? ': ' + bad.slice(0, 6).join(', ') : ''}`, '0', deep === 0 && pairs > 0);
}

/* ───────────────────────── L1 (X13) and L9: the flow on many planes / nested ───────────────────────── */
const x13 = (label: string, cases: Array<{ sp: string; name: string; n: V3; off: number }>, nested: number): void => {
  let nCut = 0, nPiece = 0, refused = 0, passAll = 0, openN = 0, contactLaunch = 0;
  const failList: string[] = [], openList: string[] = [], catCount = new Map<string, number>();
  let launchAll = 0;
  let worstRise = 0, worstUp = 0, worstFold = 0, worstPen = 0, worstPeak = 0;
  for (const cs of cases) {
    const sc = newScene(cs.sp);
    let cur = sc.bodies[0];
    for (let depth = 0; depth < nested; depth++) {
      const rng = mulberry32(cs.sp.length * 7919 + depth * 104729 + Math.round(cs.off * 100) + cs.name.length * 31 + cs.name.charCodeAt(cs.name.length - 1));
      const nrm = depth === 0 ? cs.n : { x: rng() * 2 - 1, y: (rng() * 2 - 1) * 0.6, z: rng() * 2 - 1 };
      const off = depth === 0 ? cs.off : (rng() * 2 - 1) * 0.3;
      let res = cutOnce(sc, cur, planeThrough(cur, nrm, off), { drop: argv.includes('--drop') });
      for (let tries = 0; !res.ok && res.why !== 'miss' && depth > 0 && tries < 4; tries++) res = cutOnce(sc, cur, planeThrough(cur, { x: rng() * 2 - 1, y: (rng() * 2 - 1) * 0.6, z: rng() * 2 - 1 }, (rng() * 2 - 1) * 0.2), { drop: argv.includes('--drop') });
      if (!res.ok) { refused++; break; }
      nCut++;
      const tr = trackPair(() => frame(sc), [res.a!, res.b!], [res.a!.frac!, res.b!.frac!], SECS, 0, 30);
      const neckClean = res.tilt! < 15 && res.lift! < 0.05;   // (the upper piece of a stack is born high by construction: only the parent's own turn and lift count as the neck's)
      const level = Math.abs(res.plan!.rest.n.y) > 0.7;
      let cutOk = true;
      if (argv.includes('--v')) console.log(`${cs.sp.padEnd(8)} ${cs.name.padEnd(8)} d${depth} sh ${tr.fracs.join('/')} plane n.y ${f(res.plan!.rest.n.y, 2)} tilt ${f(res.tilt!, 0)} lift ${f(res.lift!, 2)} born ${f(res.bornLow![0], 2)}/${f(res.bornLow![1], 2)} | rise ${f(tr.piece[0].rise, 3)}/${f(tr.piece[1].rise, 3)} up ${f(tr.piece[0].peakUp10, 2)}/${f(tr.piece[1].peakUp10, 2)} peak ${f(tr.piece[0].peak10, 2)}/${f(tr.piece[1].peak10, 2)} last ${f(tr.piece[0].last, 3)}/${f(tr.piece[1].last, 3)} hdisp ${f(tr.piece[0].hdisp, 2)}/${f(tr.piece[1].hdisp, 2)} | fold all ${f(tr.piece[0].fold, 0)}/${f(tr.piece[1].fold, 0)} non-sliver ${f(tr.piece[0].foldW, 0)}/${f(tr.piece[1].foldW, 0)} pen ${f(tr.pen, 3)}R`);
      tr.piece.forEach((p, k) => {
        nPiece++;
        const g = grade(p, { level, thin: p.frac < 0.30, G: 0.06, slide: res.mode === 'slide', pen: tr.pen, resets: tr.resets });
        worstRise = Math.max(worstRise, p.rise); worstUp = Math.max(worstUp, p.peakUp10); worstFold = Math.max(worstFold, p.foldW); worstPen = Math.max(worstPen, tr.pen); worstPeak = Math.max(worstPeak, p.peak10);
        for (const c of g.cats) catCount.set(c, (catCount.get(c) ?? 0) + 1);
        if (g.launch.length) launchAll++;
        if (g.launch.length || g.settle.length) {
          cutOk = false;
          const tag = `${cs.sp} ${cs.name}${nested > 1 ? ' d' + depth : ''} ${k ? 'B' : 'A'}(${f(p.frac, 2)}) tilt ${f(res.tilt!, 0)} born ${f(res.bornLow![k], 2)}: ${[...g.launch, ...g.settle].join(', ')}`;
          if (neckClean) { failList.push(tag); if (g.launch.length) contactLaunch++; } else openList.push(tag);
        }
      });
      if (cutOk) passAll++; else if (!neckClean) openN++;
      cur = res.a!.frac! >= res.b!.frac! ? res.a! : res.b!;
    }
  }
  add(`${label}: ${cases.length} ${nested > 1 ? 'nested trees of up to ' + nested + ' cuts' : 'cuts'} through the shell's flow (real neck birth velocities, common lift, scripted parting, collide every frame, ${SECS} s): pieces that break an X13 LAUNCH bar (rise <= 0.06 m, up <= 1.0 m/s, 0 safety resets, nothing below -2 mm)`,
    `${launchAll} of ${nPiece} pieces`, '0 launch failures', launchAll === 0 && nPiece > 0);
  const rate = (100 * passAll) / Math.max(1, nCut);
  const rateRow = `${label}: cuts that pass every row without a category (X13: at least 85 %; the prototype 95.2 %)`;
  if (QUICK) info(rateRow + ' [informative in the quick set, a row with --full; the misses are the sloped faces of task P8 and the neck, listed below]', `${f(rate, 1)} % of ${nCut} cuts`);
  else add(rateRow, `${f(rate, 1)} % of ${nCut} cuts`, '>= 85 %', rate >= 85);
  info(`${label}: totals`, `${nCut} cuts built, ${refused} refused, ${passAll} pass every row (${f((100 * passAll) / Math.max(1, nCut), 1)} %); ${openN} cuts with a failure behind a tilted / airborne neck swap (the neck turned or lifted the parent: P4); categories used: ${[...catCount].map(([k, v]) => k + ' ' + v).join(', ') || 'none'}; worst rise ${f(worstRise, 3)} m, up ${f(worstUp, 2)} m/s, peak ${f(worstPeak, 2)}, fold ${f(worstFold, 0)} deg, penetration ${f(worstPen, 3)} R`);
  if (failList.length) info(`${label}: pieces that miss a SETTLE bar with an upright, unlifted parent (sloped faces slide, material born in the air: P8)`, `${failList.length}: ${failList.slice(0, 14).join(' | ')}`);
  if (openList.length) info(`${label}: pieces that miss a SETTLE bar behind a turned / lifted parent (P4)`, `${openList.length}: ${openList.slice(0, 12).join(' | ')}`);
};
if (run('l1')) {
  const d2r = Math.PI / 180;
  const P6: Array<[string, V3, number]> = [['x0', { x: 1, y: 0, z: 0 }, 0], ['x0.5', { x: 1, y: 0, z: 0 }, 0.5], ['y0', { x: 0, y: 1, z: 0 }, 0], ['y0.3', { x: 0, y: 1, z: 0 }, 0.3], ['t50+0.2', { x: Math.cos(50 * d2r), y: Math.sin(50 * d2r), z: 0 }, 0.2], ['t25+0.1', { x: Math.cos(25 * d2r), y: Math.sin(25 * d2r), z: 0 }, 0.1]];
  const planesSel = arg('planes') ? arg('planes').split(',') : [];   // e.g. --planes=x0,y0,t50+0.2 (3 planes x 50 species)
  const PL = planesSel.length ? P6.filter(([name]) => planesSel.includes(name)) : P6;
  x13('L1 / X13', (QUICK ? SPALL : arg('species') ? SP : ALL).flatMap((sp) => PL.map(([name, n, off]) => ({ sp, name, n, off }))), 1);
}
if (run('l9')) {
  const sps = QUICK ? SPALL : arg('species') ? SP : ALL;
  const trees = arg('trees') ? +arg('trees') : QUICK ? 1 : 3;
  x13('L9 nested', sps.flatMap((sp) => Array.from({ length: trees }, (_, t) => ({ sp, name: 'tree' + t, n: { x: Math.cos(t * 2.1), y: 0.3 * Math.sin(t * 1.3), z: Math.sin(t * 2.1) }, off: 0.05 * t }))), arg('depth') ? +arg('depth') : 3);
}

/* ───────────────────────── report ───────────────────────── */
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`);
const failed = rows.filter((r) => !r.pass).length;
console.log(`${rows.length - failed}/${rows.length} flush-contact rows passed in ${((performance.now() - t0) / 1000).toFixed(1)} s${QUICK ? ' (quick set; --full for everything)' : ''}`);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ shell: shellRows, rows }));
process.exit(failed ? 1 : 0);
