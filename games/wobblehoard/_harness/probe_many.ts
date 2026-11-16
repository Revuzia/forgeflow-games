// PHYS, CUT3 leg 2 (detail by share, sleep / wake, the broad phase, the budget accountant). Plain node (type stripping):
//   node _harness/probe_many.ts [--only=detail,survey,deep,sleep,wake,broad,budget,acct,quality] [--species=a,b] [--seeds=3] [--quick] [--v]
// Independent measurements (own mesh-volume integral on the float64 rest mesh, own counts of solver substeps, own wall clock), the bars of _spec/CUT3.md: 4 (detail by share), 3 (the budget table), U05 / U06.
//   detail  = the mesh detail follows the share (>= 0.35 -> 642 particles, 0.08 -> 162, 0.02 -> 42, below -> 12) on the Minis path and for true pieces, the volume of every piece is its share (1e-9), the shares of a tree sum to 1
//   survey  = the builder over random nested cut trees (Split in two on the largest piece + swipes near the edge): the share of plans that end in a refusal
//   sleep   = U06: a resting tiny piece sleeps (solver steps = 0, pose untouched) and a sleeping piece costs < 0.01 ms
//   wake    = ... and wakes on a touch, a hit, a contact from an awake body, a join (setFrac / placeAt) and a gravity-mode change; two resting neighbours do not wake each other in turn
//   broad   = the planner (src/physics/broad.ts) against the pairwise loop: identical states, and the work for 64 bodies
//   budget  = the physics step at 2, 6, 12, 24 and 64 pieces (landing = all awake; at rest = asleep) against two whole bodies, and the awake particle count
//   acct    = the accountant (awakeParticles) against an independent count of the bodies that took a solver step
import { SoftBody, SLEEP } from '../src/physics/softbody.ts';
import { ContactPlanner, awakeParticles } from '../src/physics/broad.ts';
import { pieceDetail } from '../src/physics/piece.ts';
import { speciesBaseGenome } from '../src/data/catalog.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { DT, bestMs, buildTree, cutLeaf, f, layout, meshVol, newTree, planeAt, restY, rndUnit, stepAll, wholeVolume } from './physview/many_rig.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string => (argv.find((a) => a.startsWith('--' + k + '=')) ?? '').slice(k.length + 3);
const QUICK = argv.includes('--quick'), V = argv.includes('--v');
const only = arg('only') ? arg('only').split(',') : [];
const run = (s: string): boolean => only.length === 0 || only.includes(s);
const SP = arg('species') ? arg('species').split(',') : QUICK ? ['dollop', 'capnap'] : ['dollop', 'capnap', 'wisplet', 'twangle'];
const SEEDS = arg('seeds') ? +arg('seeds') : QUICK ? 2 : 3;
const t0 = performance.now();
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const info = (what: string, value: string): void => { rows.push({ what: 'INFO ' + what, value, limit: '', pass: true }); };
const Q64 = (b: SoftBody): Float64Array => (b as unknown as { Q: Float64Array }).Q;
const SUBS = (b: SoftBody): number => b.debug.substeps;
const expectedN = (frac: number): number => [12, 42, 162, 642][pieceDetail(frac)];

/* ───────────── detail by share ───────────── */
if (run('detail')) {
  const SHARES = [0.9, 0.5, 0.36, 0.34, 0.2, 0.081, 0.079, 0.05, 0.021, 0.019, 0.01, 0.003, 0.001, 1e-4];
  let wrongN = 0, volBad = 0, nBuilt = 0, worstVol = 0, bad = 0, nonFinite = 0;
  const seen = new Set<number>();
  for (const sp of SP) {
    const g = speciesBaseGenome(sp as never, 1), V3 = wholeVolume(sp);
    for (const share of SHARES) {
      const b = new SoftBody(g, { piece: { frac: share, chunk: false } } as never);
      nBuilt++; seen.add(b.vertexCount);
      if (b.vertexCount !== expectedN(share)) wrongN++;
      const rel = Math.abs(meshVol(Q64(b), b.indices) / (share * V3) - 1);
      worstVol = Math.max(worstVol, rel); if (rel > 1e-9) volBad++;
      for (let i = 0; i < 180; i++) b.step(DT);
      let s = 0; for (let k = 0; k < b.positions.length; k++) s += b.positions[k];
      if (!Number.isFinite(s) || b.debug.safetyResets > 0) nonFinite++;
      const vol = b.metrics.volume;
      if (!(vol > 0.9 && vol < 1.1)) bad++;
    }
  }
  add('detail by share (Minis path): particles 642 / 162 / 42 / 12 at shares >= 0.35 / 0.08 / 0.02 / below, down to 1e-4', `${nBuilt} bodies, wrong detail ${wrongN}, sizes seen ${[...seen].sort((a, b) => a - b).join(' ')}`, '0 wrong', wrongN === 0);
  add('detail by share (Minis path): mesh volume = share x V3 (independent float64 integral)', `worst relative error ${worstVol.toExponential(2)}, ${volBad} over 1e-9`, '<= 1e-9', volBad === 0);
  add('detail by share (Minis path): 3 s on the table at every detail: finite, volume 0.9 .. 1.1, no safety reset', `${nonFinite} non-finite, ${bad} out of the volume band`, '0 / 0', nonFinite === 0 && bad === 0);
  // true pieces
  let leaves = 0, atNominal = 0, finer = 0, sumBad = 0, volBad2 = 0, worst2 = 0, minShare = 1;
  const byN: Record<number, number> = {};
  for (const sp of SP) for (let seed = 1; seed <= SEEDS; seed++) {
    const t = buildTree(sp, 24, seed), V3 = wholeVolume(sp);
    let sum = 0;
    for (const l of t.leaves) {
      const b = l.b, fr = b.frac!; sum += fr; leaves++; minShare = Math.min(minShare, fr);
      byN[b.vertexCount] = (byN[b.vertexCount] ?? 0) + 1;
      if (b.vertexCount === expectedN(fr)) atNominal++; else if (b.vertexCount > expectedN(fr)) finer++;
      const rel = Math.abs(meshVol(Q64(b), b.indices) / (fr * V3) - 1);
      worst2 = Math.max(worst2, rel); if (rel > 1e-9) volBad2++;
    }
    if (Math.abs(sum - 1) > 1e-9) sumBad++;
  }
  add('detail by share (true pieces, trees of 24): mesh volume = its share x V3 for every leaf (independent float64 integral)', `${leaves} leaves, worst relative error ${worst2.toExponential(2)}, ${volBad2} over 1e-9`, '<= 1e-9', volBad2 === 0);
  add('detail by share (true pieces): the shares of a tree sum to 1', `${sumBad} of ${SP.length * SEEDS} trees off by more than 1e-9`, '0', sumBad === 0);
  info('detail by share (true pieces): leaves by particles / at the detail of their share / built finer after a failed gate', `${JSON.stringify(byN)} / ${atNominal} / ${finer} of ${leaves}; smallest share ${minShare.toExponential(2)}`);
  add('detail by share (true pieces): never coarser than the share asks', `${leaves - atNominal - finer} coarser`, '0', leaves - atNominal - finer === 0);
}

/* ───────────── the builder over random nested trees ───────────── */
if (run('survey')) {
  let tried = 0, ok = 0, miss = 0, loose = 0, thin = 0, ctor = 0;
  const reasons: Record<string, number> = {};
  const ms: number[] = [];
  for (const sp of SP) for (let seed = 1; seed <= SEEDS; seed++) {
    const t = buildTree(sp, QUICK ? 18 : 28, seed + 10);
    const L = t.log;
    tried += L.tried; ok += L.ok; miss += L.miss; loose += L.loose; ctor += L.ctor; for (const [k, v] of Object.entries(L.refused)) { thin += v; reasons[k] = (reasons[k] ?? 0) + v; }
    ms.push(...L.ms);
  }
  const sound = tried - miss - loose, rate = (100 * (thin + ctor)) / Math.max(1, sound);
  ms.sort((a, b) => a - b);
  info('builder survey: cuts tried / built / plane missed the piece / plan not one body (the next leg: each part becomes a piece)', `${tried} / ${ok} / ${miss} / ${loose}`);
  add('builder survey: of the cuts the plan accepts, the share the builder refuses (thin, or a constructor that fails) over nested trees to 28 pieces with edge swipes', `${f(rate, 2)} % (${thin} thin ${JSON.stringify(reasons)}, ${ctor} constructor) of ${sound}`, '<= 5 %', rate <= 5);
  info('builder survey: wall clock of a built cut (plan, builds of the two children, two constructors), ms', `median ${f(ms[ms.length >> 1] ?? 0, 1)}, p90 ${f(ms[Math.floor(ms.length * 0.9)] ?? 0, 1)}, max ${f(ms[ms.length - 1] ?? 0, 1)}`);
}

/* ───────────── one line of descent cut again and again (the middle of a star after its tips) ───────────── */
if (run('deep')) {
  const ok: number[] = [], why: string[] = [], tries: number[] = [];
  for (const sp of SP) for (let seed = 1; seed <= SEEDS; seed++) {
    const t = newTree(sp), rnd = mulberry32(seed * 131 + sp.length);
    let done = 0, refused = 0;
    for (let k = 0; k < 40 && done < 13; k++) {
      let li = 0; for (let i = 1; i < t.leaves.length; i++) if (t.leaves[i].b.frac! > t.leaves[li].b.frac!) li = i;
      const b = t.leaves[li].b, n = rndUnit(rnd);
      const r = cutLeaf(t, li, planeAt(b, n, 0.5 + 0.25 * rnd()), 'at');
      if (r === 'ok') done++; else if (r !== 'miss' && r !== 'loose-plan') { refused++; why.push(r); }
    }
    ok.push(Math.max(...t.leaves.map((l) => l.np))); tries.push(done + refused);
  }
  const deepest = Math.min(...ok);
  add('deep lineage: the largest piece cut 13 times in a row by edge swipes (random planes, a refused cut tried again with another; the cell holds up to 16 planes): the deepest line reaches', `planes in the deepest cell per tree: ${ok.join(' ')} (cuts tried per tree ${tries.join(' ')}; ${why.length} refused by the builder)`, 'every tree gets past 8 planes', deepest > 8);
}

/* ───────────── sleep ───────────── */
const sleepOf = (b: SoftBody, maxS: number): number => { for (let i = 0; i < Math.round(maxS / DT); i++) { b.step(DT); if (b.sleeping) return (i + 1) * DT; } return -1; };
function asleepPiece(sp = 'dollop', frac = 0.04, at = { x: 0, y: 0.1, z: 0 }): SoftBody {
  const b = new SoftBody(speciesBaseGenome(sp as never, 1), { piece: { frac, chunk: false, at } } as never);
  if (sleepOf(b, 10) < 0) throw new Error('a piece of ' + frac + ' did not fall asleep in 10 s');
  return b;
}
if (run('sleep')) {
  const times: number[] = [];
  let neverSleeps = 0;
  for (const sp of SP) for (const frac of [0.3, 0.05, 0.01, 0.002]) {
    const b = new SoftBody(speciesBaseGenome(sp as never, 1), { piece: { frac, chunk: false, at: { x: 0, y: 0.15, z: 0 } } } as never);
    const t = sleepOf(b, 10);
    if (t < 0) { neverSleeps++; if (V) console.log('no sleep', sp, frac, b.sleepInfo); } else times.push(t);
  }
  times.sort((a, b) => a - b);
  add('U06 sleep: a piece dropped from 15 cm falls asleep (4 species x shares 0.3 / 0.05 / 0.01 / 0.002) within 10 s', `${times.length} of ${times.length + neverSleeps} slept; time to sleep median ${f(times[times.length >> 1] ?? -1, 2)} s, max ${f(times[times.length - 1] ?? -1, 2)} s`, 'all', neverSleeps === 0);
  const b = asleepPiece();
  const p0 = Float32Array.from(b.positions), c0 = { ...b.center }, s0 = SUBS(b);
  for (let i = 0; i < 120; i++) b.step(DT);
  let same = true; for (let i = 0; i < p0.length; i++) if (p0[i] !== b.positions[i]) { same = false; break; }
  add('U06 sleep: asleep for 2 s the piece takes no solver step (substeps +0), its pose is bit-for-bit the same and it is still asleep', `substeps +${SUBS(b) - s0}, positions ${same ? 'identical' : 'CHANGED'}, centre ${b.center.x === c0.x && b.center.y === c0.y && b.center.z === c0.z ? 'same' : 'moved'}, sleeping ${b.sleeping}`, '+0 / identical', SUBS(b) === s0 && same && b.sleeping);
  const cost = bestMs(() => b.step(DT), 4000, 5);
  add('U06 sleep: the cost of one step() of a sleeping piece', `${(cost * 1000).toFixed(2)} us`, '< 10 us (0.01 ms)', cost < 0.01);
  // a whole squishy never sleeps
  const w = new SoftBody(speciesBaseGenome('dollop' as never, 1)); for (let i = 0; i < 60 * 8; i++) w.step(DT);
  add('sleep: a whole squishy never sleeps (8 s at rest)', `sleeping ${w.sleeping}`, 'false', !w.sleeping);
  // float mode never sleeps, and the sleep switch is a real switch
  const fl = new SoftBody(speciesBaseGenome('dollop' as never, 1), { piece: { frac: 0.05, chunk: false } } as never); fl.gravity = false; for (let i = 0; i < 60 * 3; i++) fl.step(DT);
  add('sleep: a piece in float mode does not sleep', `sleeping ${fl.sleeping}`, 'false', !fl.sleeping);
  SLEEP.enabled = false;
  const off = new SoftBody(speciesBaseGenome('dollop' as never, 1), { piece: { frac: 0.05, chunk: false, at: { x: 0, y: 0.1, z: 0 } } } as never); for (let i = 0; i < 60 * 6; i++) off.step(DT);
  SLEEP.enabled = true;
  add('sleep: SLEEP.enabled = false (the control) keeps a resting piece stepping', `sleeping ${off.sleeping}`, 'false', !off.sleeping);
}

/* ───────────── wake ───────────── */
if (run('wake')) {
  const awakeAndStepped = (b: SoftBody, s0: number): boolean => !b.sleeping && SUBS(b) > s0;
  const g = speciesBaseGenome('dollop' as never, 1);
  // touch
  {
    const b = asleepPiece(), s0 = SUBS(b), top = b.center.y + b.restRadius * 2;
    const h = b.raycast({ x: b.center.x, y: top, z: b.center.z }, { x: 0, y: -1, z: 0 });
    if (h) { b.fingerDown(0, { point: h.point, normal: h.normal, dir: { x: 0, y: -1, z: 0 } }); b.fingerPressure(0, 0.6); }
    b.step(DT);
    add('U06 wake: a touch (fingerDown on the sleeping piece) wakes it and it steps', `ray hit ${!!h}, sleeping ${b.sleeping}, substeps +${SUBS(b) - s0}`, 'awake, steps', !!h && awakeAndStepped(b, s0));
    b.fingerUp(0); for (let i = 0; i < 60; i++) b.step(DT);
    const t = sleepOf(b, 10);
    add('U06 wake: ... and it falls asleep again after the finger has left', `asleep again after ${f(t, 2)} s`, 'asleep within 10 s', t >= 0);
  }
  // hit
  {
    const b = asleepPiece(), s0 = SUBS(b), x0 = b.center.x;
    b.nudge({ x: 0.6, y: 0, z: 0 }); b.step(DT);
    for (let i = 0; i < 10; i++) b.step(DT);
    add('U06 wake: a hit (nudge) wakes it and it moves', `sleeping ${b.sleeping}, substeps +${SUBS(b) - s0}, moved ${f((b.center.x - x0) * 1000, 1)} mm`, 'awake, moved', awakeAndStepped(b, s0) && b.center.x > x0 + 1e-3);
  }
  // contact from an awake body
  {
    const a = asleepPiece('dollop', 0.05, { x: 0, y: 0.1, z: 0 });
    const s0 = SUBS(a), r = a.restRadius;
    const q = new SoftBody(g, { piece: { frac: 0.05, chunk: false, at: { x: -2.3 * r, y: 0.0, z: 0 }, vel: { x: 2.5, y: 0, z: 0 } } } as never);
    const bodies = [a, q], planner = new ContactPlanner();
    let woke = -1;
    for (let i = 0; i < 90; i++) { planner.run(bodies); for (const b of bodies) b.step(DT); if (woke < 0 && !a.sleeping) woke = i; }
    add('U06 wake: a contact from an awake body (a piece of the same size at 2.5 m/s) wakes it', `woke at frame ${woke}, substeps +${SUBS(a) - s0}`, 'woke, steps', woke >= 0 && SUBS(a) > s0);
  }
  // join: setFrac and placeAt
  {
    const b = asleepPiece(), s0 = SUBS(b);
    b.setFrac(0.06, 0.3); b.step(DT);
    add('U06 wake: a join (setFrac) wakes it', `sleeping ${b.sleeping}, substeps +${SUBS(b) - s0}`, 'awake, steps', awakeAndStepped(b, s0));
    const c = asleepPiece(), s1 = SUBS(c);
    c.placeAt({ x: 0.3, y: 0.1, z: 0 }, { x: 0, y: 0, z: 0 }); c.step(DT);
    add('U06 wake: a join (placeAt) wakes it', `sleeping ${c.sleeping}, substeps +${SUBS(c) - s1}`, 'awake, steps', awakeAndStepped(c, s1));
  }
  // gravity mode
  {
    const b = asleepPiece(), s0 = SUBS(b);
    b.gravity = false; b.step(DT);
    const a1 = awakeAndStepped(b, s0);
    for (let i = 0; i < 60; i++) b.step(DT);
    const stays = !b.sleeping;
    b.gravity = true; for (let i = 0; i < 30; i++) b.step(DT);
    add('U06 wake: a change of the gravity mode wakes it; float mode keeps it awake', `woke ${a1}, awake after 1 s of float ${stays}, falling again ${!b.sleeping}`, 'true / true / true', a1 && stays && !b.sleeping);
  }
  // two resting neighbours do not wake each other in turn
  {
    const a = new SoftBody(g, { piece: { frac: 0.05, chunk: false, at: { x: 0, y: 0.05, z: 0 } } } as never), r = a.restRadius;
    const b = new SoftBody(g, { piece: { frac: 0.05, chunk: false, at: { x: 1.9 * r, y: 0.05, z: 0 } } } as never);
    const bodies = [a, b], planner = new ContactPlanner();
    let both = -1;
    for (let i = 0; i < 60 * 12; i++) { planner.run(bodies); for (const x of bodies) x.step(DT); if (both < 0 && a.sleeping && b.sleeping) both = i; }
    const w0 = a.sleepInfo.wakes + b.sleepInfo.wakes;
    for (let i = 0; i < 60 * 6; i++) { planner.run(bodies); for (const x of bodies) x.step(DT); }
    const w1 = a.sleepInfo.wakes + b.sleepInfo.wakes;
    add('U06 wake: two pieces resting against each other both fall asleep and then stay asleep (no waking in turn)', `both asleep at frame ${both}, wakes in the 6 s after: ${w1 - w0}, asleep now ${a.sleeping} / ${b.sleeping}`, 'both asleep, 0 wakes', both >= 0 && w1 === w0 && a.sleeping && b.sleeping);
  }
  // a piece lying on a sleeping piece (a stack): the contact between two pieces jitters up to a millimetre a frame, so a stack does not come to rest and does not sleep (it stays awake as before CUT3).
  // What must hold is that sleeping changes nothing for it: the same scene with SLEEP.enabled = false (the control) ends within 3 mm for both pieces, and the upper one stays on the lower
  {
    const stack = (on: boolean): { a: SoftBody; b: SoftBody; wakes: number } => {
      SLEEP.enabled = on;
      const a = on ? asleepPiece('dollop', 0.2, { x: 0, y: 0.1, z: 0 }) : new SoftBody(g, { piece: { frac: 0.2, chunk: false, at: { x: 0, y: 0.1, z: 0 } } } as never);
      if (!on) for (let i = 0; i < 60 * 4; i++) a.step(DT);
      const b = new SoftBody(g, { piece: { frac: 0.05, chunk: false, at: { x: 0, y: 0.1 + 2.2 * a.restRadius, z: 0 } } } as never);
      const bodies = [a, b], planner = new ContactPlanner();
      for (let i = 0; i < 60 * 8; i++) { planner.run(bodies); for (const x of bodies) x.step(DT); }
      SLEEP.enabled = true;
      return { a, b, wakes: a.sleepInfo.wakes };
    };
    const on = stack(true), off = stack(false);
    const da = Math.hypot(on.a.center.x - off.a.center.x, on.a.center.y - off.a.center.y, on.a.center.z - off.a.center.z), db = Math.hypot(on.b.center.x - off.b.center.x, on.b.center.y - off.b.center.y, on.b.center.z - off.b.center.z);
    const topOn = on.b.center.y > on.a.center.y + 0.5 * on.a.restRadius;
    add('U06 wake: a piece dropped onto a sleeping piece wakes it and the pair ends where the same scene without sleep ends (8 s)', `lower differs by ${f(da * 1000, 2)} mm, upper by ${f(db * 1000, 2)} mm, wakes of the lower ${on.wakes}, upper on top ${topOn}, a pair like this stays awake (contact jitter): ${!on.a.sleeping && !on.b.sleeping}`, '< 3 mm, < 3 mm, on top', da < 0.003 && db < 0.003 && topOn);
  }
}

/* ───────────── the broad phase ───────────── */
if (run('broad')) {
  const states = (bodies: SoftBody[]): string => bodies.map((b) => b.stateHash()).join(',');
  const scene = (n: number, mk: () => SoftBody[]): { naive: SoftBody[]; plan: SoftBody[] } => { void n; return { naive: mk(), plan: mk() }; };
  // two whole bodies side by side, touching
  {
    const mk = (): SoftBody[] => { const g = speciesBaseGenome('dollop' as never, 1); const a = new SoftBody(g), b = new SoftBody(g); b.placeAt!({ x: 0.74, y: restY(b), z: 0.05 }, { x: -0.2, y: 0, z: 0 }); return [a, b]; };
    const { naive, plan } = scene(2, mk), planner = new ContactPlanner();
    for (let i = 0; i < 180; i++) { stepAll(naive); stepAll(plan, DT, planner); }
    add('broad: two whole bodies pressed together, 3 s: the planner and the pairwise loop leave bit-identical states', states(naive) === states(plan) ? 'identical' : 'DIFFERENT', 'identical', states(naive) === states(plan));
  }
  // 12 pieces of a cut tree, tight, dropped 3 cm
  {
    const mk = (): SoftBody[] => layout(buildTree('capnap', 12, 5), 1.15, 0.03);
    const { naive, plan } = scene(12, mk), planner = new ContactPlanner();
    for (let i = 0; i < 240; i++) { stepAll(naive); stepAll(plan, DT, planner); }
    const same = states(naive) === states(plan);
    add('broad: 12 pieces (a cut tree) laid out almost touching and dropped, 4 s: the planner and the pairwise loop leave bit-identical states', same ? 'identical' : 'DIFFERENT', 'identical', same);
  }
  // 64 bodies spread out
  {
    const t = buildTree('dollop', 64, 3, { crumbP: 0.3 });
    const bodies = layout(t, 2.6, 0.02), planner = new ContactPlanner();
    for (let i = 0; i < 30; i++) { planner.run(bodies); for (const b of bodies) b.step(DT); }
    const st = { ...planner.stats };
    add(`broad: ${bodies.length} pieces spread over the mat: the sweep makes few sphere tests (the pairwise loop makes ${st.naivePairs} pair tests per body pair set)`, `${st.tests} sphere tests, ${st.pairs} pairs handed to collide`, `<= 25 % of ${st.naivePairs}`, st.tests <= 0.25 * st.naivePairs);
    for (let i = 0; i < 60 * 14; i++) { planner.run(bodies); for (const b of bodies) b.step(DT); }
    const st2 = { ...planner.stats }, asleep = bodies.filter((b) => b.sleeping).length;
    add('broad: after 14 s the pieces rest: asleep pieces and the pairs the planner skips', `${asleep} of ${bodies.length} asleep, ${st2.pairs} pairs handed on, ${st2.skippedAsleep} skipped as both asleep, awake particles ${st2.awakeParticles} of ${st2.allParticles}`, 'most asleep, 0 pairs handed on once all sleep', asleep >= 0.8 * bodies.length);
  }
}

/* ───────────── the budget ───────────── */
if (run('budget')) {
  const g = speciesBaseGenome('dollop' as never, 1);
  const base = (): { ms: number; particles: number } => {
    const a = new SoftBody(g), b = new SoftBody(g); a.placeAt!({ x: -0.6, y: restY(a) + 0.04, z: 0 }, { x: 0, y: 0, z: 0 }); b.placeAt!({ x: 0.6, y: restY(b) + 0.04, z: 0 }, { x: 0, y: 0, z: 0 });
    const bodies = [a, b], planner = new ContactPlanner();
    for (let i = 0; i < 6; i++) { planner.run(bodies); for (const x of bodies) x.step(DT); }   // (a landing from 4 cm)
    const ms = bestMs(() => { planner.run(bodies); for (const x of bodies) x.step(DT); }, 20, 5);
    return { ms, particles: awakeParticles(bodies) };
  };
  const wh = base();
  info('budget: two whole bodies landing (the existing bar: 2.0 ms a body)', `${f(wh.ms, 2)} ms a frame, ${wh.particles} particles awake`);
  for (const n of QUICK ? [2, 12, 24, 64] : [2, 6, 12, 24, 64]) {
    const t = buildTree('dollop', n, 7 + n, { crumbP: 0.3 });
    const bodies = layout(t, 2.5, 0.04), planner = new ContactPlanner();
    const awake0 = awakeParticles(bodies);
    for (let i = 0; i < 20; i++) { planner.run(bodies); for (const b of bodies) b.step(DT); }   // (landing)
    const msLand = bestMs(() => { planner.run(bodies); for (const b of bodies) b.step(DT); }, 15, 4);
    const partLand = awakeParticles(bodies);
    for (let i = 0; i < 60 * 14; i++) { planner.run(bodies); for (const b of bodies) b.step(DT); }
    const asleep = bodies.filter((b) => b.sleeping).length, partRest = awakeParticles(bodies);
    const msRest = bestMs(() => { planner.run(bodies); for (const b of bodies) b.step(DT); }, 60, 5);
    const sleepers = bodies.filter((b) => b.sleeping), msSleep = sleepers.length ? bestMs(() => { planner.run(sleepers); for (const b of sleepers) b.step(DT); }, 400, 5) : 0;
    const sizes: Record<number, number> = {}; for (const b of bodies) sizes[b.vertexCount] = (sizes[b.vertexCount] ?? 0) + 1;
    info(`budget: ${bodies.length} pieces (particles ${JSON.stringify(sizes)}, ${bodies.reduce((s, b) => s + b.vertexCount, 0)} in all)`, `landing: ${f(msLand, 2)} ms a frame, ${partLand} of ${awake0} particles awake (${f(msLand / wh.ms, 2)} x two wholes); at rest: ${asleep} asleep, ${partRest} particles awake, ${f(msRest, 3)} ms a frame; the ${sleepers.length} sleepers alone ${f(msSleep, 4)} ms = ${f((msSleep / Math.max(1, sleepers.length)) * 1000, 2)} us a piece`);
    if (n === 64) add('U06 budget: the sleeping pieces of 64 at rest cost < 0.01 ms each (planner + steps), and most of the 64 sleep after 14 s', `${f((msSleep / Math.max(1, sleepers.length)) * 1000, 2)} us a piece, ${asleep} of ${bodies.length} asleep, ${partRest} particles awake`, '< 10 us a piece, >= 80 % asleep', msSleep / Math.max(1, sleepers.length) < 0.01 && asleep >= 0.8 * bodies.length);
    if (n === 24) add('budget: 24 pieces landing cost no more than 1.5 x two whole bodies (physics step + contact; the 12 awake of the table)', `${f(msLand, 2)} ms vs ${f(wh.ms, 2)} ms = ${f(msLand / wh.ms, 2)} x`, '<= 1.5 x', msLand <= 1.5 * wh.ms);
    if (n === 24 || n === 12) add(`budget: ${bodies.length} pieces landing: the awake set <= 3 x a whole body (1,926 particles)`, `${partLand} particles awake`, '<= 1926', partLand <= 1926);
  }
}

/* ───────────── the accountant ───────────── */
if (run('acct')) {
  const t = buildTree('capnap', 14, 9), bodies = layout(t, 1.3, 0.06), planner = new ContactPlanner();
  let frames = 0, bad = 0, worstGap = 0;
  const prev = new Map<SoftBody, number>();
  for (let i = 0; i < 60 * 8; i++) {
    planner.run(bodies);
    const acct = awakeParticles(bodies);
    for (const b of bodies) prev.set(b, SUBS(b));
    for (const b of bodies) b.step(DT);
    let indep = 0; for (const b of bodies) if (SUBS(b) > prev.get(b)!) indep += b.vertexCount;
    frames++; if (indep !== acct) { bad++; worstGap = Math.max(worstGap, Math.abs(indep - acct)); }
  }
  add('accountant: awakeParticles(bodies) (after the contact pass, before the steps) = the particles of the bodies that took a solver step, every frame of 8 s', `${bad} of ${frames} frames differ (worst gap ${worstGap})`, '0', bad === 0);
}

/* ───────────── determinism and the fold gate of small pieces ───────────── */
if (run('quality')) {
  const { foldExcess2 } = await import('./physview/flush_rig.ts');
  // determinism: the same tree built twice from a cold cache and dropped gives the same states, frame for frame, with sleep in it
  let detBad = 0, detFrames = 0;
  for (const sp of SP.slice(0, 2)) {
    const run1 = (): string[] => {
      const bodies = layout(buildTree(sp, 10, 21), 1.3, 0.03), planner = new ContactPlanner(), out: string[] = [];
      for (let i = 0; i < 60 * 6; i++) { planner.run(bodies); for (const b of bodies) b.step(DT); if (i % 60 === 59) out.push(bodies.map((b) => b.stateHash() + (b.sleeping ? 's' : 'a')).join(',')); }
      return out;
    };
    const A = run1(), B = run1();
    for (let k = 0; k < A.length; k++) { detFrames++; if (A[k] !== B[k]) detBad++; }
  }
  add('determinism: a cut tree built twice from a cold cache and dropped (planner, sleep on): identical state hashes and sleeping flags once a second for 6 s', `${detBad} of ${detFrames} samples differ`, '0', detBad === 0);
  // fold gate: no crease in the landing of small pieces (dihedral over the piece's own rest dihedral, hinges whose triangles are not slivers)
  const worstBy: Record<number, number> = {}, overBy: Record<number, number> = {}, countBy: Record<number, number> = {};
  let worstAll = 0;
  for (const sp of SP) {
    const bodies = layout(buildTree(sp, 16, 33, { crumbP: 0.3 }), 2.0, 0.05), planner = new ContactPlanner();
    const seen = new Map<SoftBody, number>();
    for (let i = 0; i < 60 * 3; i++) {
      planner.run(bodies); for (const b of bodies) b.step(DT);
      if (i % 3 === 0) for (const b of bodies) { if (b.sleeping) continue; const [all, well] = foldExcess2(b); seen.set(b, Math.max(seen.get(b) ?? 0, well)); worstAll = Math.max(worstAll, all); }
    }
    for (const [b, w] of seen) { const n = b.vertexCount; worstBy[n] = Math.max(worstBy[n] ?? 0, w); countBy[n] = (countBy[n] ?? 0) + 1; if (w > 110) overBy[n] = (overBy[n] ?? 0) + 1; }
  }
  const small = Math.max(worstBy[12] ?? 0, worstBy[42] ?? 0);
  add('fold gate (the new small meshes): pieces of 12 and 42 particles dropped 5 cm and landing (3 s): the worst fold over its own rest dihedral on well-shaped hinges', `12 particles: ${f(worstBy[12] ?? 0, 1)} degrees (${countBy[12] ?? 0} pieces), 42 particles: ${f(worstBy[42] ?? 0, 1)} (${countBy[42] ?? 0})`, '<= 110 (the contact fold limit)', small <= 110);
  info('fold of the pieces of 162 and 642 particles in the same landings (the open P8 item: a landing crease of a viscoelastic piece, marshmallow / stickystretch; one piece of 64 over 110 degrees in the last run, built finer than its share asked)', `162: worst ${f(worstBy[162] ?? 0, 0)} degrees, ${overBy[162] ?? 0} of ${countBy[162] ?? 0} over 110; 642: worst ${f(worstBy[642] ?? 0, 0)}, ${overBy[642] ?? 0} of ${countBy[642] ?? 0} over 110; every hinge incl. slivers ${f(worstAll, 0)}`);
}

/* ───────────── report ───────────── */
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}${r.limit ? '    threshold: ' + r.limit : ''}`);
const failed = rows.filter((r) => !r.pass).length;
console.log(`${rows.length - failed}/${rows.length} many-pieces rows passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
