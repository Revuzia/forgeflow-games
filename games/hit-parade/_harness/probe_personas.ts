// HIT PARADE - G3 AI / feel gate (lane AI, CONTRACT §11, §13): persona playtests on the REAL sim with
// the REAL data/ kits.
//
//   node _harness/probe_personas.ts --seeds 1..20     G3: the acceptance numbers GATE (exit 1 on a miss)
//   node _harness/probe_personas.ts                   smoke (run_probes): seeds 1..3; the honesty checks
//                                                     gate, the acceptance numbers are REPORTED only
//   -v                                                per-match lines
//
// Honesty checks (always gating):
//   H1 determinism     same seeds -> identical input streams + final checksum, twice; another CPU seed differs
//   H2 input-blind     the opponent's input-derived fields (sense.ts HIDDEN_FIELDS: raw, history, buffer, press
//                      ages, charge) scrambled before EVERY CPU call -> the identical match
//   H3 read-only       checksum(state) unchanged across every CPU call
//   H4 reaction clock  a pure-reaction defender (guard posture 0, block 1.0) vs scripted attacks of startup S:
//                      blocks every attack with S > reactF and none with S <= reactF (reactF 18 / 24 / 48): the
//                      block is in place `reactF` frames after the attacker's first startup frame, i.e. on its
//                      move frame reactF + 1 - never sooner
//   H6 step clock      CHANGED(AI3D) (CONTRACT §35.9 / §35.17): a pure-reaction STEPPER (step share 1, block 1, no guard,
//                      no read steps) vs every LINEAR ground strike + straight projectile of the roster (and the homing
//                      moves as negatives) at reach: its STEP bit is never emitted before it has SEEN the attacker's move
//                      frame reactF (the block clock exactly), every step it chose evaded (the sandbox check is right),
//                      it never steps a homing move, and some attacks ARE stepped on reaction at 18 f (non-vacuous)
// Acceptance (CONTRACT §11 G3; thresholds are this probe's reading of the words):
//   A1 block+punish beats mash       optimal vs masher: optimal wins >= 80 %
//   A2 anti-air beats jumping        optimal vs jumper: optimal wins >= 80 % and lands anti-airs
//   A3 novice beats L1 mostly        novice vs CPU L1: novice wins > 50 %
//   A4 boss vs optimal               RICKY (CPU L6 + boss tools) vs optimal: boss wins >= 1 match and < 50 %
//   CHANGED(AI3D) (CONTRACT §35.17) - the 3D ring:
//   A5 homing tools beat the stepper  (a) a HOMING spammer vs the 'stepper' persona: homing wins >= 75 %, lands homing
//                                     hits on the stepper mid-step, and does >= 20 points better than vs the same
//                                     defender with its steps off (the 'blocker' control: the steps are what it beats);
//                                     (b) CPU L6 (its homing / cpu.antiStep answers) vs the stepper: L6 wins >= 70 %,
//                                     answers steps with homing moves (antiSteps > 0) that hit a stepping defender (> 0)
//   A6 linear spam loses to a stepper a LINEAR spammer (fighters with >= 4 linear strikes) vs the 'stepper': the stepper
//                                     wins >= 70 %, evading linear moves with steps (> 0), punishing out of a step (> 0),
//                                     and >= 20 points better than the 'blocker' control (the same defender, steps off) -
//                                     some kits keep unsteppable 5-7 f linear moves (krane BATON FLIP, STEPTUNE §35.15)
//   A7 the CPU walks off its wall     CPU L6, placed with its back on the ring wall (< 0.5 m behind it along the fight line)
//                                     facing a passive opponent, circle-walks until >= 1.5 m is behind it within 150 frames
//                                     in >= 80 % of the placements (12 fighters x 2 rings x 2 seeds)
// Info: CPU L6 with antiStep 0 vs the stepper, CPU L6 vs the 'circler', the ring stats of the CPU levels (reaction /
// read steps, circles, side punishes, step-attacks).
// Info (never gating): turtle vs masher, CPU L6 vs jumper, THE FREAK vs optimal, CPU level ladder (Ln vs Ln-2),
// CPU cost per input() call.

import { loadGameData } from '../runtime/src/core/data.ts';
import type { GameData } from '../runtime/src/core/types.ts';
import { checksum, createMatch, readMatch, step } from '../runtime/src/core/sim/match.ts';
import type { Match, MatchCfg, Scheme } from '../runtime/src/core/sim/match.ts';
import { EV, EVX, eventsSince } from '../runtime/src/core/sim/events.ts';
import type { SimEvent } from '../runtime/src/core/types.ts';
import { F, FL, PH, ST, fighterBase } from '../runtime/src/core/sim/layout.ts';
import { hash32, mulberry32 } from '../runtime/src/core/rng.ts';
import { createCpu, createBrainCpu, levelProfile } from '../runtime/src/core/ai/cpu.ts';
import type { Cpu, Profile } from '../runtime/src/core/ai/cpu.ts';
import { createPersona } from '../runtime/src/core/ai/personas.ts';
import type { PersonaName } from '../runtime/src/core/ai/personas.ts';
import { HIDDEN_FIELDS } from '../runtime/src/core/ai/sense.ts';
import type { Brain, Decision } from '../runtime/src/core/ai/brain.ts';
import { STEP_BITS, dirBits } from '../runtime/src/core/ai/pad.ts';
import { buildKit } from '../runtime/src/core/ai/kit.ts';
import type { BrainStats } from '../runtime/src/core/ai/brain.ts';
import { ringRay } from '../runtime/src/core/sim/ring.ts';
import { normQ } from '../runtime/src/core/sim/fx3d.ts';

const args = process.argv.slice(2);
const VERBOSE = args.includes('-v') || args.includes('--verbose');
const si = args.indexOf('--seeds');
const GATE = si >= 0;
let seeds: number[] = [1, 2, 3];
if (GATE) {
  const spec = args[si + 1] ?? '1..20';
  const mm = /^(\d+)\.\.(\d+)$/.exec(spec);
  seeds = [];
  if (mm) for (let s = Number(mm[1]); s <= Number(mm[2]); s++) seeds.push(s);
  else for (const p of spec.split(',')) if (p.trim()) seeds.push(Number(p));
}

const data: GameData = loadGameData();
const ROSTER = ['johnny', 'patch', 'bruno', 'zambini', 'krane', 'lotus', 'boneyard', 'spin', 'gazza', 'rerun'].filter((id) => id in data.fighters);

const fails: string[] = [];
const lines: string[] = [];
let checks = 0;
function ok(cond: boolean, label: string): boolean {
  checks++;
  if (!cond) fails.push(label);
  if (VERBOSE || !cond) console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  return cond;
}
function say(s: string): void {
  lines.push(s);
  console.log(s);
}

// ------------------------------------------------------------------ match runner
interface Side {
  cpu: Cpu;
  fighter: string;
  scheme: Scheme;
}
interface Result {
  winner: number;
  wins: [number, number];
  frames: number;
  hp: [number, number];
  inHash: number;
  sum: number;
  hits: [number, number];
  blocks: [number, number];
  throws: [number, number];
  punishes: [number, number];
  aaHits: [number, number];
  airHits: [number, number];
  cpuUs: number;
  /** CHANGED(AI3D): hits by a HOMING move on a victim that was in SIDESTEP / SIDEWALK the frame before */
  homingStepHits: [number, number];
}
interface RunOpts {
  blind?: boolean;
  readOnly?: boolean;
  maxFrames?: number;
}

const scramble = mulberry32(0xbadc0de);

function runMatch(a: Side, b: Side, seed: number, o: RunOpts = {}): Result {
  const cfg: MatchCfg = {
    mode: 'versus', stage: 'rust_theater', seed,
    p: [{ fighter: a.fighter, color: 0, scheme: a.scheme, cpu: 5 }, { fighter: b.fighter, color: a.fighter === b.fighter ? 1 : 0, scheme: b.scheme, cpu: 5 }],
  };
  const m = createMatch(cfg, data);
  const s = m.s;
  const save = new Int32Array(HIDDEN_FIELDS.length);
  const sides = [a, b];
  let inHash = 0x12345;
  const res: Result = {
    winner: -1, wins: [0, 0], frames: 0, hp: [0, 0], inHash: 0, sum: 0, hits: [0, 0], blocks: [0, 0], throws: [0, 0], punishes: [0, 0],
    aaHits: [0, 0], airHits: [0, 0], cpuUs: 0, homingStepHits: [0, 0],
  };
  const stBefore = [0, 0];
  const evs: SimEvent[] = [];
  let lastSeq = 0;
  const air = [false, false];
  let cpuMs = 0;
  let calls = 0;
  const max = o.maxFrames ?? 40000;
  for (let f = 0; f < max; f++) {
    const words = [0, 0];
    for (let i = 0; i < 2; i++) {
      const ob = fighterBase(1 - i);
      if (o.blind) for (let k = 0; k < HIDDEN_FIELDS.length; k++) {
        save[k] = s[ob + HIDDEN_FIELDS[k]];
        s[ob + HIDDEN_FIELDS[k]] = (scramble() * 4294967296) | 0;
      }
      const before = o.readOnly ? checksum(m) : 0;
      const t0 = performance.now();
      words[i] = sides[i].cpu.input(m, i);
      cpuMs += performance.now() - t0;
      calls++;
      if (o.readOnly && checksum(m) !== before) {
        ok(false, `H3 read-only: CPU ${i} (${sides[i].fighter}) changed the state on frame ${s[1]}`);
        o.readOnly = false;
      }
      if (o.blind) for (let k = 0; k < HIDDEN_FIELDS.length; k++) s[ob + HIDDEN_FIELDS[k]] = save[k];
    }
    inHash = hash32(inHash, words[0], words[1]);
    for (let i = 0; i < 2; i++) {
      const st = s[fighterBase(i) + F.st];
      air[i] = (s[fighterBase(i) + F.flags] & FL.AIRBORNE) !== 0 && (st === ST.AIR || st === ST.ATTACK);
      stBefore[i] = st;
    }
    step(m, words[0], words[1]);
    evs.length = 0;
    const cur = m.events.count;
    if (cur !== lastSeq) {
      eventsSince(m.events, 0, evs);
      const fresh = evs.slice(Math.max(0, evs.length - (cur - lastSeq)));
      lastSeq = cur;
      for (const e of fresh) {
        if (e.a !== 0 && e.a !== 1) continue;
        const at = e.a as 0 | 1;
        // PROJ_HIT is emitted on projectile contact of either kind (hit AND block, hits.ts), so it is not a hit;
        // a projectile hit also emits HIT
        if (e.type === EV.HIT || e.type === EV.SUPER_HIT) {
          res.hits[at]++;
          const hv = stBefore[1 - at];
          const hm = s[fighterBase(at) + F.mv];
          if ((hv === ST.SIDESTEP || hv === ST.SIDEWALK) && hm >= 0 && m.cf[at].moves[hm]?.homing) res.homingStepHits[at]++;
          if (e.b === 1 - at && air[1 - at]) res.aaHits[at]++;
          if (air[at]) res.airHits[at]++;
        } else if (e.type === EV.BLOCK) res.blocks[e.b === 0 || e.b === 1 ? e.b : at]++;
        else if (e.type === EV.THROW) res.throws[at]++;
        else if (e.type === EV.PUNISH) res.punishes[at]++;
      }
    }
    if (s[2] === PH.MATCH_END) break;
  }
  const ms = readMatch(m);
  res.winner = ms.winner;
  res.wins = [ms.wins[0], ms.wins[1]];
  res.frames = ms.frame;
  res.hp = [s[fighterBase(0) + F.hp], s[fighterBase(1) + F.hp]];
  res.inHash = inHash >>> 0;
  res.sum = checksum(m) >>> 0;
  res.cpuUs = calls ? (cpuMs * 1000) / calls : 0;
  return res;
}

function pairFor(seed: number): [string, string] {
  const x = ROSTER[seed % ROSTER.length];
  let y = ROSTER[(seed * 7 + 3) % ROSTER.length];
  if (y === x) y = ROSTER[(seed + 5) % ROSTER.length];
  return [x, y];
}

/** runs `hero` (persona / CPU factory) vs `foe` per seed, alternating sides; returns hero wins + results */
interface SeriesOut { wins: number; draws: number; n: number; res: Result[]; respects: number; spacePokes: number; heroSt: Record<string, number>; foeSt: Record<string, number>; heroHomingStepHits: number }
function addStats(into: Record<string, number>, st: BrainStats): void {
  for (const [k, v] of Object.entries(st)) into[k] = (into[k] ?? 0) + (v as number);
}
function series(label: string, hero: (f: string, seed: number) => Cpu, foe: (f: string, seed: number) => Cpu, heroFighter: (s: number) => string, foeFighter: (s: number) => string): SeriesOut {
  const heroSt: Record<string, number> = {};
  const foeSt: Record<string, number> = {};
  let hsh = 0;
  let wins = 0;
  let draws = 0;
  let respects = 0;
  let spacePokes = 0;
  const res: Result[] = [];
  let cpuUs = 0;
  for (const sd of seeds) {
    const hf = heroFighter(sd);
    const ff = foeFighter(sd);
    const heroP1 = sd % 2 === 1;
    const H: Side = { cpu: hero(hf, sd * 1009 + 1), fighter: hf, scheme: 0 };
    const O: Side = { cpu: foe(ff, sd * 2003 + 2), fighter: ff, scheme: sd % 3 === 0 ? 1 : 0 };
    const r = heroP1 ? runMatch(H, O, sd) : runMatch(O, H, sd);
    respects += H.cpu.brain.stats.respects;
    spacePokes += H.cpu.brain.stats.spacePokes;
    addStats(heroSt, H.cpu.brain.stats);
    addStats(foeSt, O.cpu.brain.stats);
    const heroIdx = heroP1 ? 0 : 1;
    hsh += r.homingStepHits[heroIdx];
    if (r.winner === heroIdx) wins++;
    else if (r.winner < 0) draws++;
    res.push(r);
    cpuUs += r.cpuUs;
    if (VERBOSE) console.log(`    ${label} seed ${sd}: ${hf}${heroP1 ? '(P1)' : '(P2)'} vs ${ff} -> ${r.winner === heroIdx ? 'WIN' : r.winner < 0 ? 'DRAW' : 'loss'} rounds ${r.wins.join('-')} frames ${r.frames} hits ${r.hits[heroIdx]}/${r.hits[1 - heroIdx]} blocks(by hero) ${r.blocks[heroIdx]} aa ${r.aaHits[heroIdx]} throws ${r.throws[heroIdx]}/${r.throws[1 - heroIdx]}`);
  }
  if (VERBOSE) console.log(`    ${label}: cpu ${(cpuUs / seeds.length).toFixed(1)} us/call`);
  return { wins, draws, n: seeds.length, res, respects, spacePokes, heroSt, foeSt, heroHomingStepHits: hsh };
}

const persona = (name: PersonaName) => (f: string, seed: number): Cpu => createPersona(name, f, seed);
const level = (lv: number) => (f: string, seed: number): Cpu => createCpu(lv, f, seed);
const pct = (a: number, n: number): string => `${a}/${n} (${n ? Math.round((100 * a) / n) : 0}%)`;

// ------------------------------------------------------------------ H1 determinism, H2 input-blind, H3 read-only
{
  const [x, y] = pairFor(seeds[0]);
  const mk = (): [Side, Side] => [{ cpu: createCpu(8, x, 77), fighter: x, scheme: 0 }, { cpu: createPersona('optimal', y, 99), fighter: y, scheme: 1 }];
  const [a1, b1] = mk();
  const r1 = runMatch(a1, b1, 5, { maxFrames: 12000 });
  const [a2, b2] = mk();
  const r2 = runMatch(a2, b2, 5, { maxFrames: 12000 });
  ok(r1.inHash === r2.inHash && r1.sum === r2.sum && r1.frames === r2.frames, `H1 determinism: ${x} L8 vs ${y} optimal twice -> inputs ${r1.inHash.toString(16)} / ${r2.inHash.toString(16)}, checksum ${r1.sum.toString(16)} / ${r2.sum.toString(16)}, frames ${r1.frames} / ${r2.frames}`);
  // prepare() (the loading-card warm-up) must not change the state or the play
  {
    const [ap, bp] = mk();
    const m0 = createMatch({ mode: 'versus', stage: 'rust_theater', seed: 5, p: [{ fighter: x, color: 0, scheme: 0, cpu: 8 }, { fighter: y, color: x === y ? 1 : 0, scheme: 1, cpu: 5 }] }, data);
    const before = checksum(m0);
    ap.cpu.prepare(m0, 0);
    bp.cpu.prepare(m0, 1);
    ok(checksum(m0) === before, 'prepare() leaves the match state untouched');
    const rp = runMatch(ap, bp, 5, { maxFrames: 12000 });
    ok(rp.inHash === r1.inHash && rp.sum === r1.sum, `prepare() then play == play (inputs ${rp.inHash.toString(16)})`);
  }
  const r3 = runMatch({ cpu: createCpu(8, x, 78), fighter: x, scheme: 0 }, { cpu: createPersona('optimal', y, 99), fighter: y, scheme: 1 }, 5, { maxFrames: 12000 });
  ok(r3.inHash !== r1.inHash, `H1 a different CPU seed plays differently (inputs ${r3.inHash.toString(16)} vs ${r1.inHash.toString(16)})`);
  const [a4, b4] = mk();
  const r4 = runMatch(a4, b4, 5, { maxFrames: 12000, blind: true, readOnly: true });
  ok(r4.inHash === r1.inHash && r4.sum === r1.sum, `H2 input-blind: opponent's ${HIDDEN_FIELDS.length} input-derived fields scrambled before every CPU call -> inputs ${r4.inHash.toString(16)} (same: ${r4.inHash === r1.inHash}), checksum same: ${r4.sum === r1.sum}`);
  ok(true, 'H3 read-only: checksum unchanged across every CPU call (checked each call in the H2 run)');
  // a second pairing through the blind check, lower level + persona brains
  const [p, q] = pairFor(seeds[0] + 4);
  const mk2 = (): [Side, Side] => [{ cpu: createPersona('novice', p, 5), fighter: p, scheme: 0 }, { cpu: createCpu(3, q, 6), fighter: q, scheme: 0 }];
  const [c1, d1] = mk2();
  const r5 = runMatch(c1, d1, 9, { maxFrames: 9000 });
  const [c2, d2] = mk2();
  const r6 = runMatch(c2, d2, 9, { maxFrames: 9000, blind: true, readOnly: true });
  ok(r5.inHash === r6.inHash && r5.sum === r6.sum, `H2 input-blind: ${p} novice vs ${q} L3 scrambled == clean (inputs ${r5.inHash.toString(16)} / ${r6.inHash.toString(16)})`);
  say(`honesty: determinism + input-blind + read-only on ${x}/${y} and ${p}/${q}; cpu ${r1.cpuUs.toFixed(1)} us per input() call`);
}

// ------------------------------------------------------------------ H4 reaction clock
{
  const def = 'johnny';
  // one scripted attack per distinct startup, from several kits so the boundaries are covered (18 f = johnny 6H)
  const attackers = ['bruno', 'johnny', 'zambini', 'boneyard'].filter((id) => id in data.fighters);
  const byStartup = new Map<number, [string, number]>();
  for (const att of attackers) {
    const kitA = buildKit(data, createMatch({ mode: 'training', stage: 'rust_theater', seed: 1, p: [{ fighter: att, color: 0, scheme: 1, cpu: -1 }, { fighter: def, color: 0, scheme: 1, cpu: -1 }] }, data).cf[0], 1);
    const list = kitA.groundStrikes.slice();
    if (kitA.impact >= 0) list.push(kitA.impact);
    for (const idx of list) {
      const mi = kitA.moves[idx];
      if (mi.cm.guard === 0 || mi.proj || mi.super > 0 || !mi.recipe || mi.recipe.steps.length !== 1) continue;
      if (!byStartup.has(mi.cm.startup)) byStartup.set(mi.cm.startup, [att, idx]);
    }
  }
  const moves = [...byStartup.entries()].sort((p, q) => p[0] - q[0]);
  const report: string[] = [];
  const none = (): Decision => ({ t: 'none', frames: 6 });
  for (const R of [18, 24, 48]) {
    let right = 0;
    let total = 0;
    const cells: string[] = [];
    for (const [S, [att, idx]] of moves) {
      // CHANGED(AI3D): the 3D levers off - H4 is the BLOCK clock (H6 is the step clock)
      const prof = { ...levelProfile(8), name: `react${R}`, level: -1, reactF: R, block: 1, guard: 0, aggression: 0, punish: 0, antiAir: 0, parry: 0, parryShare: 0, tech: 0, drop: 0, nerve: 0, backRise: 0, wakeReversal: 0, step: 0, stepGuess: 0, circle: 0, antiStep: 0, walk: 0 };
      const cpu = createBrainCpu(prof, def, 1234, none);
      const m = createMatch({ mode: 'training', stage: 'rust_theater', seed: 3, p: [{ fighter: att, color: 0, scheme: 1, cpu: -1 }, { fighter: def, color: att === def ? 1 : 0, scheme: 1, cpu: 0 }] }, data);
      const kitA = buildKit(data, m.cf[0], 1);
      let n = 0;
      while (m.s[2] !== PH.FIGHT && n++ < 500) step(m, 0, cpu.input(m, 1));
      const mi = kitA.moves[idx];
      let blocked = 0;
      let hit = 0;
      for (let rep = 0; rep < 4; rep++) {
        // stand in reach, both idle 40 frames, then the attack
        const b0 = fighterBase(0);
        const b1 = fighterBase(1);
        const gap = Math.max(40000, Math.min(mi.reach + (m.cf[1].hurtStand[0] >> 1) - 15000, 150000));
        for (let k = 0; k < 400 && !(m.s[b0 + F.st] === ST.IDLE && m.s[b1 + F.st] === ST.IDLE); k++) step(m, 0, cpu.input(m, 1));
        m.s[b0 + F.x] = -Math.round(gap / 2);
        m.s[b1 + F.x] = Math.round(gap / 2);
        for (let k = 0; k < 40; k++) step(m, 0, cpu.input(m, 1));
        const facing = m.s[b0 + F.facing];
        const stp = mi.recipe!.steps[0];
        const seq0 = m.events.count;
        step(m, dirBits(stp.d, facing) | stp.b, cpu.input(m, 1));
        for (let k = 0; k < mi.cm.total + 30; k++) step(m, 0, cpu.input(m, 1));
        const ev: SimEvent[] = [];
        eventsSince(m.events, 0, ev);
        const fresh = ev.slice(Math.max(0, ev.length - (m.events.count - seq0)));
        if (fresh.some((e) => e.type === EV.BLOCK && e.a === 0)) blocked++;
        else if (fresh.some((e) => (e.type === EV.HIT || e.type === EV.COUNTER || e.type === EV.PUNISH) && e.a === 0)) hit++;
      }
      const want = S > R ? 'block' : 'hit';
      const good = want === 'block' ? blocked === 4 : blocked === 0 && hit > 0;
      total++;
      if (good) right++;
      cells.push(`${att}.${mi.id}(${S}f):${blocked}B/${hit}H${good ? '' : '!'}`);
    }
    ok(right === total, `H4 reaction ${R} f: blocks exactly the attacks with startup > ${R} (${right}/${total} correct) ${cells.join(' ')}`);
    report.push(`${R}f ${right}/${total}`);
  }
  say(`reaction clock (pure-reaction defender, block 1.0, no guard posture; startups ${moves.map((q) => q[0]).join(',')}): ${report.join(', ')}`);
}

// ------------------------------------------------------------------ H6 step clock (CHANGED(AI3D), CONTRACT §35.9 / §35.17)
// A pure-reaction stepper (step share 1, block 1, no guard posture, no read steps, no uniques that answer first: patch)
// vs every LINEAR ground strike / straight projectile of the 12 kits from neutral at reach, plus up to 2 homing strikes per
// kit as negatives, reaction 18 f and 24 f. Each attack: the move frame the stepper had SEEN when its word first carried a
// STEP bit (must be >= reactF: its response then lands on move frame reactF + 1, exactly the block clock of H4), whether
// the attack touched it (HIT / BLOCK / PROJ contact by the attacker).
{
  const DEF = 'patch';
  const none = (): Decision => ({ t: 'none', frames: 6 });
  const atts = Object.keys(data.fighters).sort();
  const rows: string[] = [];
  let early = 0;
  let stepped = 0;
  let steppedTouched = 0;
  let homingStepped = 0;
  let homingN = 0;
  let linearN = 0;
  const evadedAt: Record<number, string[]> = { 18: [], 24: [] };
  for (const R of [18, 24]) {
    for (const att of atts) {
      const prof: Profile = { ...levelProfile(8), name: `step${R}`, level: -1, reactF: R, block: 1, step: 1, guard: 0, aggression: 0, punish: 0, antiAir: 0, parry: 0, parryShare: 0, tech: 0, drop: 0, nerve: 0, backRise: 0, wakeReversal: 0, stepGuess: 0, circle: 0, antiStep: 0, walk: 0, antiZone: 0 };
      const cpu = createBrainCpu(prof, DEF, 4321 + R, none);
      const m = createMatch({ mode: 'training', stage: 'rust_theater', seed: 3, p: [{ fighter: att, color: 0, scheme: 1, cpu: -1 }, { fighter: DEF, color: att === DEF ? 1 : 0, scheme: 1, cpu: 0 }] }, data);
      const kitA = buildKit(data, m.cf[0], 1);
      let n = 0;
      while (m.s[2] !== PH.FIGHT && n++ < 500) step(m, 0, cpu.input(m, 1));
      const usable = kitA.moves.filter((mi) => mi.recipe && mi.recipe.ctx === '' && !mi.recipe.air && mi.recipe.charge === 0 && mi.super === 0 && !mi.ex && !mi.grab && !mi.inert && !mi.cm.isImpact);
      const lin = usable.filter((mi) => mi.linear && (mi.cm.isStrike || mi.proj) && (mi.proj ? !(mi.cm.proj && mi.cm.proj.aimed) : true));
      const hom = usable.filter((mi) => mi.homing && mi.cm.isStrike && !mi.proj).slice(0, 2);
      for (const mi of lin.concat(hom)) {
        const b0 = fighterBase(0);
        const b1 = fighterBase(1);
        for (let k = 0; k < 400 && !(m.s[b0 + F.st] === ST.IDLE && m.s[b1 + F.st] === ST.IDLE); k++) step(m, 0, cpu.input(m, 1));
        // at reach (projectiles from 3.0 m: in flight long enough to be seen)
        const gap = mi.proj ? 300000 : Math.max(90000, Math.min(mi.reach + (m.cf[1].hurtStand[0] >> 1) - 15000, 350000));
        m.s[b0 + F.x] = -Math.round(gap / 2);
        m.s[b1 + F.x] = Math.round(gap / 2);
        m.s[b0 + F.z] = 0;
        m.s[b1 + F.z] = 0;
        for (let k = 0; k < 40; k++) step(m, 0, cpu.input(m, 1));
        const facing = m.s[b0 + F.facing];
        const steps = mi.recipe!.steps;
        const seq0 = m.events.count;
        let startF = -1;
        let stepSeen = -1;
        const total = steps.length + mi.cm.total + (mi.proj ? 90 : 30);
        for (let k = 0; k < total; k++) {
          const st0 = k < steps.length ? steps[k] : null;
          const w0 = st0 ? dirBits(st0.d, facing) | st0.b : 0;
          const w1 = cpu.input(m, 1);
          if (startF >= 0 && stepSeen < 0 && (w1 & STEP_BITS) !== 0) stepSeen = m.s[1] - startF + 1;
          step(m, w0, w1);
          if (startF < 0 && m.s[b0 + F.st] === ST.ATTACK && m.s[b0 + F.mv] === mi.idx && m.s[b0 + F.mvF] === 1) startF = m.s[1];
        }
        const ev: SimEvent[] = [];
        eventsSince(m.events, 0, ev);
        const fresh = ev.slice(Math.max(0, ev.length - (m.events.count - seq0)));
        const touched = fresh.some((e) => (e.type === EV.HIT || e.type === EV.BLOCK || e.type === EV.PROJ_HIT || e.type === EV.COUNTER || e.type === EV.PUNISH) && e.a === 0);
        if (mi.homing) homingN++;
        else linearN++;
        if (stepSeen >= 0) {
          stepped++;
          if (stepSeen < R) early++;
          if (touched) steppedTouched++;
          if (mi.homing) homingStepped++;
          else if (!touched) evadedAt[R].push(`${att}.${mi.id}(${mi.cm.startup}f@${(gap / 100000).toFixed(1)}m seen ${stepSeen})`);
        }
        if (VERBOSE) console.log(`    H6 R${R} ${att}.${mi.id} ${mi.homing ? 'homing' : 'linear'}${mi.proj ? ' proj' : ''} s${mi.cm.startup} gap ${(gap / 100000).toFixed(2)} m: step seen at move frame ${stepSeen}, touched ${touched}`);
      }
    }
    rows.push(`${R}f: stepped on reaction ${evadedAt[R].length} (${evadedAt[R].slice(0, 6).join(' ')}${evadedAt[R].length > 6 ? ' ...' : ''})`);
  }
  ok(early === 0, `H6 step clock: no STEP bit before the stepper had seen move frame reactF (${early} early of ${stepped} steps)`);
  ok(stepped > 0 && steppedTouched === 0, `H6 every reaction step it chose evaded (${stepped} steps, ${steppedTouched} touched)`);
  ok(homingStepped === 0, `H6 never steps a homing move (${homingStepped} of ${homingN} homing attacks stepped)`);
  ok(evadedAt[18].length > 0, `H6 non-vacuous: linear moves / projectiles stepped on an 18 f reaction: ${evadedAt[18].length} of ${linearN / 2}`);
  say(`step clock (pure-reaction stepper ${DEF}, ${linearN / 2} linear strikes / straight projectiles + ${homingN / 2} homing per clock): ${rows.join('; ')}`);
}

// ------------------------------------------------------------------ H5 pattern guesses (CHANGED(AI) P2)
// Levels 0-5 cannot react to a 4-18 f ground attack (reactF 28-60 f), so they block by GUESSING from the attacker's
// habits (core/ai/habits.ts: visible move starts, committed only after the reaction delay). A scripted attacker (johnny)
// walks in and repeats one mixup; the defender is CPU L3 (reactF 36, aggression 0 so it only defends) - once with its
// habit weight, once with habit 0 (the flat P1 guesses) as the control. Measured at every attack: blocked or hit, and the
// guard the defender's own output word held on the attack's first active frame (crouch / stand / none).
//   H5a lows only: crouch share of its guards (late half) with habits >= 0.62 and above the control's by >= 0.1
//   H5b lows then overheads: its first overheads after the switch are guessed LOW (crouch share >= 0.6: it keeps the
//       pattern it saw - not reacting), its late overheads get a standing guard more often than the first ones
//   H5c throws only: it techs later throws more often than early ones, or escapes them (throwEscapes > 0)
{
  const ATT = 'johnny';
  const DEF = 'johnny';
  const blindP = (): Profile => ({ ...levelProfile(0), name: 'script', level: -1, reactF: 100000, block: 0, guard: 0, punish: 0, antiAir: 0, aggression: 1, thinkF: 2, drop: 0, habit: 0, parry: 0, meter: 0, route: 1, tech: 0, delayF: 0, respect: 0, backRise: 0, wakeReversal: 0 });
  type Kind = 'low' | 'over' | 'throw';
  interface AttackLog { kind: Kind; out: 'block' | 'hit' | 'tech' | 'throw' | 'none'; guard: 'crouch' | 'stand' | 'none' }
  const runScript = (kindAt: (n: number) => Kind, total: number, habitW: number, seed: number): { logs: AttackLog[]; techs: number; escapes: number } => {
    const m = createMatch({ mode: 'training', stage: 'rust_theater', seed, timer: 0, p: [{ fighter: ATT, color: 0, scheme: 1, cpu: -1 }, { fighter: DEF, color: 1, scheme: 1, cpu: 3 }] }, data);
    const kitA = buildKit(data, m.cf[0], 1);
    const lows = kitA.moves.filter((mi) => (mi.normal || mi.cm.kind === 1) && mi.low && mi.recipe && mi.recipe.ctx === '' && !mi.recipe.air).sort((p, q) => p.cm.startup - q.cm.startup);
    const ohs = kitA.moves.filter((mi) => mi.overhead && mi.recipe && mi.recipe.ctx === '' && !mi.recipe.air && !mi.special).sort((p, q) => p.cm.startup - q.cm.startup);
    const low = lows[0].idx;
    const over = ohs[0].idx;
    const logs: AttackLog[] = [];
    let n = 0;
    const plan = (b: Brain): Decision => {
      const s = b.seen;
      if (n >= total) return { t: 'none', frames: 30 };
      const k = kindAt(n);
      const idx = k === 'low' ? low : k === 'over' ? over : b.kit.throwF;
      if (s.op.st !== ST.IDLE && s.op.st !== ST.CROUCH && s.op.st !== ST.WALK_F && s.op.st !== ST.WALK_B) return { t: 'none', frames: 2 };
      if (!b.inReach(idx)) return { t: 'hold', d: 6, frames: 2 };
      b.nextThink = s.frame + 30 + Math.floor(b.rnd() * 24);
      logs.push({ kind: k, out: 'none', guard: 'none' });
      n++;
      return { t: 'move', idx };
    };
    const att = createBrainCpu(blindP(), ATT, seed * 7 + 1, plan);
    // CHANGED(AI3D): the 3D levers off - H5 measures the guard guesses (a circle-walk / read step is no guard)
    // CHANGED(fix_balance): + the neutral circle-walk lever (CONTRACT §35.21)
    const prof = { ...levelProfile(3), aggression: 0, punish: 0, habit: habitW, step: 0, stepGuess: 0, circle: 0, antiStep: 0, walk: 0 };
    const def = createBrainCpu(prof, DEF, seed * 11 + 3, null);
    const b0 = fighterBase(0);
    let lastInst = -1;
    let cur = -1;
    let seq = m.events.count;
    for (let f = 0; f < 200 * total + 600; f++) {
      const w0 = att.input(m, 0);
      const w1 = def.input(m, 1);
      // the defender's guard on the attack's first active frame (its own output word; away from the attacker = guard)
      const inst = m.s[b0 + F.mvInst];
      if (inst !== lastInst && m.s[b0 + F.st] === ST.ATTACK) {
        lastInst = inst;
        if (logs.length > 0) cur = logs.length - 1;
      }
      const mv = m.s[b0 + F.mv];
      if (cur >= 0 && mv >= 0 && m.s[b0 + F.mvF] + 1 === m.cf[0].moves[mv].startup) {
        const away = m.s[fighterBase(1) + F.x] > m.s[b0 + F.x] ? 8 : 4; // RIGHT / LEFT bit of the §4.4 word
        logs[cur].guard = (w1 & away) !== 0 ? ((w1 & 2) !== 0 ? 'crouch' : 'stand') : 'none';
      }
      step(m, w0, w1);
      const evs: SimEvent[] = [];
      const cnt = m.events.count;
      if (cnt !== seq) {
        eventsSince(m.events, 0, evs);
        for (const e of evs.slice(Math.max(0, evs.length - (cnt - seq)))) {
          if (cur < 0) continue;
          if (e.type === EV.THROW_TECH) logs[cur].out = 'tech'; // a tech follows the THROW connect event
          if (logs[cur].out !== 'none') continue;
          if (e.type === EV.BLOCK && e.a === 0) logs[cur].out = 'block';
          else if ((e.type === EV.HIT || e.type === EV.COUNTER || e.type === EV.PUNISH) && e.a === 0) logs[cur].out = 'hit';
          else if (e.type === EV.THROW && e.a === 0) logs[cur].out = 'throw';
        }
        seq = cnt;
      }
      if (n >= total && m.s[b0 + F.st] !== ST.ATTACK && logs[logs.length - 1].out !== 'none') break;
    }
    return { logs, techs: def.brain.stats.techTries, escapes: def.brain.stats.throwEscapes };
  };
  // CHANGED(fix_balance): the G3 seed set in the smoke too (was [1, 2, 3] there) - H5 always gates, and on 3 seeds H5b decided
  // on 7 guarded overheads (4/7 = 0.57 vs the 0.6 bar = one sample): any change in the defender's random stream flipped it
  // (§35.21's 0.3 WEAVE read threshold draws one more roll per decision); same threshold, twice the sample
  const H5S = [1, 2, 3, 4, 5, 6];
  const share = (ls: AttackLog[], pred: (l: AttackLog) => boolean, of: (l: AttackLog) => boolean): [number, number] => {
    const base = ls.filter(of);
    return [base.filter(pred).length, base.length];
  };
  const fr = (x: [number, number]): string => `${x[0]}/${x[1]}`;
  const rate = (x: [number, number]): number => (x[1] ? x[0] / x[1] : 0);
  // H5a
  const aH: AttackLog[] = [];
  const a0: AttackLog[] = [];
  for (const sd of H5S) {
    aH.push(...runScript(() => 'low', 36, levelProfile(3).habit, sd).logs.slice(16));
    a0.push(...runScript(() => 'low', 36, 0, sd).logs.slice(16));
  }
  const guarded = (l: AttackLog): boolean => l.guard !== 'none';
  const crH = share(aH, (l) => l.guard === 'crouch', guarded);
  const cr0 = share(a0, (l) => l.guard === 'crouch', guarded);
  const blH = share(aH, (l) => l.out === 'block', () => true);
  const bl0 = share(a0, (l) => l.out === 'block', () => true);
  ok(rate(crH) >= 0.62 && rate(crH) - rate(cr0) >= 0.1, `H5a lows only: crouch share of the L3 defender's guards (attacks 17-36) ${fr(crH)} = ${rate(crH).toFixed(2)} with habits vs ${fr(cr0)} = ${rate(cr0).toFixed(2)} habit 0; lows blocked ${fr(blH)} vs ${fr(bl0)}`);
  // H5b
  const bFirst: AttackLog[] = [];
  const bLate: AttackLog[] = [];
  for (const sd of H5S) {
    const r = runScript((k) => (k < 24 ? 'low' : 'over'), 48, levelProfile(3).habit, sd + 20).logs;
    bFirst.push(...r.slice(24, 28));
    bLate.push(...r.slice(38, 48));
  }
  const crF = share(bFirst, (l) => l.guard === 'crouch', guarded);
  const stF = share(bFirst, (l) => l.guard === 'stand', guarded);
  const stL = share(bLate, (l) => l.guard === 'stand', guarded);
  const ohF = share(bFirst, (l) => l.out === 'block', () => true);
  const ohL = share(bLate, (l) => l.out === 'block', () => true);
  ok(rate(crF) >= 0.6 && rate(stL) > rate(stF), `H5b lows -> overheads: first 4 overheads after the switch guessed low (crouch share ${fr(crF)} = ${rate(crF).toFixed(2)}, overheads blocked ${fr(ohF)}), attacks 15-24 after it stand share ${fr(stL)} = ${rate(stL).toFixed(2)} > first ${rate(stF).toFixed(2)} (blocked ${fr(ohL)})`);
  // H5c
  let tEarly = 0;
  let tLate = 0;
  let nE = 0;
  let nL = 0;
  let esc = 0;
  for (const sd of H5S) {
    const r = runScript(() => 'throw', 30, levelProfile(3).habit, sd + 40);
    const ls = r.logs;
    for (let k = 0; k < ls.length; k++) {
      if (ls[k].out !== 'tech' && ls[k].out !== 'throw') continue;
      if (k < 10) {
        nE++;
        if (ls[k].out === 'tech') tEarly++;
      } else if (k >= 15) {
        nL++;
        if (ls[k].out === 'tech') tLate++;
      }
    }
    esc += r.escapes;
  }
  ok(tLate / Math.max(1, nL) > tEarly / Math.max(1, nE) || esc > 0, `H5c throws only: techs early ${tEarly}/${nE}, late ${tLate}/${nL}; close-range throw escapes chosen ${esc}`);
  say(`pattern guesses (L3 defender, no reactable attack): crouch share vs lows ${rate(crH).toFixed(2)} (habit 0: ${rate(cr0).toFixed(2)}); after lows -> overheads: first overheads crouch-guarded ${rate(crF).toFixed(2)}, later standing ${rate(stL).toFixed(2)}; throw techs ${tEarly}/${nE} -> ${tLate}/${nL}, escapes ${esc}`);
}

// ------------------------------------------------------------------ U1 uniques + supers in play (CHANGED(AI) P2)
// Every kit's special families, both supers and its §28 unique, used by the CPU in real bouts (GATING in G3 mode; the
// smoke run reports). Natural bouts: each fighter as CPU L6 / L8 vs CPU L6 (opponents rotate, zoners included). Full-meter
// bouts (the probe sets SHOWTIME to 3 bars at every round start - it owns the match): each fighter as CPU L6 vs CPU L4 must
// start its Lv1 and its Lv3. Install (no kit has one yet, §28.2): johnny with an install block injected into weave_l.
{
  const U_ROSTER = Object.keys(data.fighters).sort();
  const UOPP = ['zambini', 'johnny', 'krane', 'patch', 'gazza', 'bruno', 'lotus', 'rerun', 'spin', 'boneyard'];
  const useSeeds = GATE ? [1, 2, 3, 4] : [1];
  const base = (id: string): string => id.replace(/_(l|m|h|ex)$/, '');
  interface Tally { use: Record<string, number>; ev: Record<string, number>; stance: number }
  const tallyBout = (hero: string, heroLv: number, opp: string, oppLv: number, seed: number, heroP: number, fullMeter: boolean, gd: GameData, t: Tally): void => {
    const scheme = (seed % 2 === 0 ? 1 : 0) as Scheme;
    const p = heroP === 0
      ? [{ fighter: hero, color: 0, scheme, cpu: heroLv }, { fighter: opp, color: 1, scheme: 0 as Scheme, cpu: oppLv }]
      : [{ fighter: opp, color: 0, scheme: 0 as Scheme, cpu: oppLv }, { fighter: hero, color: 1, scheme, cpu: heroLv }];
    const m = createMatch({ mode: 'versus', stage: 'rust_theater', seed: seed * 31 + heroLv, p: p as MatchCfg['p'] }, gd);
    const cpus = [createCpu(p[0].cpu, p[0].fighter, seed * 101 + heroLv), createCpu(p[1].cpu, p[1].fighter, seed * 131 + oppLv)];
    const hb = fighterBase(heroP);
    let lastInst = -1;
    let seq = m.events.count;
    let wasFight = false;
    for (let f = 0; f < 40000; f++) {
      const fight = m.s[2] === PH.FIGHT;
      if (fullMeter && fight && !wasFight) for (let i = 0; i < 2; i++) m.s[fighterBase(i) + F.showtime] = 30000;
      wasFight = fight;
      step(m, cpus[0].input(m, 0), cpus[1].input(m, 1));
      const inst = m.s[hb + F.mvInst];
      const mv = m.s[hb + F.mv];
      if (inst !== lastInst && mv >= 0) {
        lastInst = inst;
        if (m.s[hb + F.st] === ST.ATTACK) {
          const id = m.cf[heroP].moves[mv].id;
          t.use[id] = (t.use[id] ?? 0) + 1;
        }
      }
      if (m.s[hb + F.st] === ST.STANCE) t.stance++;
      const cnt = m.events.count;
      if (cnt !== seq) {
        const evs: SimEvent[] = [];
        eventsSince(m.events, 0, evs);
        for (const e of evs.slice(Math.max(0, evs.length - (cnt - seq)))) {
          const k = e.type === EVX.CATCH && e.a === heroP ? 'CATCH' : e.type === EVX.TELEPORT && e.a === heroP ? 'TELEPORT' : e.type === EVX.PHASE && e.a === heroP ? 'PHASE'
            : e.type === EVX.BALL && e.a === heroP ? `BALL${e.b}` : e.type === EVX.INSTALL && e.a === heroP ? 'INSTALL' : e.type === EV.IMPACT_ARMOR && e.a === heroP ? 'ARMOR' : '';
          if (k) t.ev[k] = (t.ev[k] ?? 0) + 1;
        }
        seq = cnt;
      }
      if (m.s[2] === PH.MATCH_END) break;
    }
    const bs = cpus[heroP].brain.stats;
    for (const k of ['uniqueCancels', 'rekicks', 'stanceFollows', 'counterReads', 'rekkas'] as const) t.ev[k] = (t.ev[k] ?? 0) + bs[k];
  };
  const missing: string[] = [];
  const lines2: string[] = [];
  let tmExtra = 0;
  for (const hero of U_ROSTER) {
    const t: Tally = { use: {}, ev: {}, stance: 0 };
    for (const lv of [6, 8]) for (const sd of useSeeds) {
      let opp = UOPP[(sd + lv + hero.length) % UOPP.length];
      if (opp === hero) opp = UOPP[(sd + lv + hero.length + 1) % UOPP.length];
      tallyBout(hero, lv, opp, 6, sd, sd % 2, false, data, t);
    }
    const tm: Tally = { use: {}, ev: {}, stance: 0 };
    // CHANGED(AI3D): 4 full-meter bouts in G3 (was 2): a Lv1 the CPU saves past (it banks toward Lv3) shows ~1 in 4 bouts
    for (const sd of GATE ? [1, 2, 3, 4] : [1]) tallyBout(hero, 6, hero === 'johnny' ? 'patch' : 'johnny', 4, sd + 50, sd % 2, true, data, tm);
    const cf = createMatch({ mode: 'training', stage: 'rust_theater', seed: 1, p: [{ fighter: hero, color: 0, scheme: 1, cpu: -1 }, { fighter: 'johnny', color: 1, scheme: 1, cpu: -1 }] }, data).cf[0];
    const kit1 = buildKit(data, cf, 0);
    const miss: string[] = [];
    // every special family with a neutral / chain / stance recipe (sim-started follow-ups and phase-2 moves aside)
    const fams = new Map<string, number>();
    for (const mi of kit1.moves) {
      if (mi.cm.snapId < 0 || !mi.special || mi.super > 0 || mi.tool === 'auto' || mi.phase2 || !mi.recipe) continue;
      fams.set(base(mi.id), (fams.get(base(mi.id)) ?? 0) + (t.use[mi.id] ?? 0));
    }
    for (const [k, v] of fams) if (v === 0) miss.push(k);
    // both supers (full-meter bouts; a `phases` kit's Lv3 may be its phase-2 one)
    const sup = (k: number): number => (k >= 0 ? (tm.use[kit1.moves[k].id] ?? 0) + (t.use[kit1.moves[k].id] ?? 0) : 0);
    const lv3ids = [kit1.sup3, cf.route2.sup3].filter((k) => k >= 0).map((k) => kit1.moves[k].id);
    // CHANGED(AI3D): sampling until seen - a super still unseen after the 4 full-meter bouts gets up to 8 more (G3 only).
    // Measured: johnny's Lv3 MAIN EVENT (a high box with 1.0 m travel) comes out in ~1 of 4 full-meter bouts with or
    // without the ring levers (its Lv1 confirms reach further), so a fixed 2-4 bout sample passed or failed by the seeds
    const lv3Seen = (): boolean => lv3ids.length === 0 || lv3ids.some((id) => (tm.use[id] ?? 0) + (t.use[id] ?? 0) > 0);
    for (let extra = 0; GATE && extra < 8 && ((kit1.sup1 >= 0 && sup(kit1.sup1) === 0) || !lv3Seen()); extra++) {
      tallyBout(hero, 6, hero === 'johnny' ? 'patch' : 'johnny', 4, 55 + extra, extra % 2, true, data, tm);
      tmExtra++;
    }
    if (kit1.sup1 >= 0 && sup(kit1.sup1) === 0) miss.push(`Lv1 ${kit1.moves[kit1.sup1].id}`);
    if (lv3ids.length > 0 && lv3ids.every((id) => (tm.use[id] ?? 0) + (t.use[id] ?? 0) === 0)) miss.push(`Lv3 ${lv3ids.join('/')}`);
    // the unique itself
    const uk = cf.uk;
    const ev = (k: string): number => t.ev[k] ?? 0;
    if (uk === 1 && (t.stance === 0 || ev('stanceFollows') === 0)) miss.push('stance');
    if (uk === 3 && (ev('BALL0') === 0 || ev('BALL6') === 0 || ev('rekicks') === 0)) miss.push('ball kick / hover / re-kick');
    if (uk === 4 && ev('CATCH') === 0) miss.push('counter CATCH');
    // armor steps (Bruno / Boneyard): stepped AND cancelled out of; armored moves without steps (THE FREAK): absorbed
    if (uk === 5 && (kit1.tools.step ?? []).length > 0 && ev('uniqueCancels') === 0) miss.push('armor-step cancel');
    if (uk === 5 && (kit1.tools.step ?? []).length === 0 && ev('ARMOR') === 0) miss.push('armor absorb');
    if (uk === 6 && ev('TELEPORT') === 0) miss.push('TELEPORT');
    if (uk === 7) {
      if (ev('PHASE') === 0) miss.push('PHASE');
      const p2 = kit1.moves.filter((mi) => mi.phase2 && mi.super === 0).map((mi) => mi.id);
      if (p2.every((id) => (t.use[id] ?? 0) === 0)) miss.push('phase-2 moves');
    }
    if (uk === 2) {
      const chargeFam = kit1.moves.filter((mi) => mi.recipe && mi.recipe.charge !== 0).map((mi) => mi.id);
      if (chargeFam.every((id) => (t.use[id] ?? 0) === 0)) miss.push('charge specials');
    }
    const counts = [...fams.entries()].map(([k, v]) => `${k}:${v}`).join(' ');
    lines2.push(`${hero}: ${counts} | Lv1 ${sup(kit1.sup1)} Lv3 ${lv3ids.map((id) => (tm.use[id] ?? 0) + (t.use[id] ?? 0)).join('/')} | ${JSON.stringify(t.ev)}${t.stance ? ` stance ${t.stance} f` : ''}`);
    if (miss.length > 0) missing.push(`${hero} [${miss.join(', ')}]`);
  }
  if (VERBOSE) for (const l of lines2) console.log(`    ${l}`);
  // install (§28.2: available, no kit uses one yet) - johnny's weave_l becomes an install move in a copied GameData
  const jd = structuredClone(data.fighters.johnny) as GameData['fighters'][string];
  (jd.moves.weave_l as unknown as Record<string, unknown>).install = { frames: 600, damagePct: 120, walkPct: 110 };
  const gdI: GameData = { ...data, fighters: { ...data.fighters, johnny: jd } };
  const ti: Tally = { use: {}, ev: {}, stance: 0 };
  for (const sd of [1, 2]) tallyBout('johnny', 6, 'zambini', 4, sd + 70, sd % 2, false, gdI, ti);
  const inst = ti.ev.INSTALL ?? 0;
  const uText = `every kit's special families + Lv1 + Lv3 + unique in ${U_ROSTER.length * 2 * useSeeds.length} natural + ${U_ROSTER.length * (GATE ? 4 : 1) + tmExtra} full-meter CPU bouts (${tmExtra} extra until seen): ${missing.length === 0 ? 'all used' : 'MISSING ' + missing.join('; ')}; injected install started ${ti.use.weave_l ?? 0}x, INSTALL events ${inst}`;
  if (GATE) ok(missing.length === 0 && inst > 0, `U1 ${uText}`);
  say(`${GATE ? '' : '(report) '}uniques: ${uText}`);
}

// ------------------------------------------------------------------ acceptance
const A: { name: string; pass: boolean; text: string }[] = [];
function accept(name: string, pass: boolean, text: string): void {
  A.push({ name, pass, text });
  say(`${pass ? 'PASS' : 'MISS'} ${name}: ${text}`);
}

const heroF = (s: number): string => pairFor(s)[0];
const foeF = (s: number): string => pairFor(s)[1];

{
  const r = series('A1 optimal vs masher', persona('optimal'), persona('masher'), heroF, foeF);
  const blocks = r.res.reduce((t, x, k) => t + x.blocks[seeds[k] % 2 === 1 ? 0 : 1], 0);
  const pun = r.res.reduce((t, x, k) => t + x.punishes[seeds[k] % 2 === 1 ? 0 : 1], 0);
  accept('A1 block+punish beats mash', r.wins >= Math.ceil(0.8 * r.n), `optimal won ${pct(r.wins, r.n)} vs masher (draws ${r.draws}); optimal blocked ${blocks} hits, landed ${pun} punish counters, respected the presser ${r.respects} times, swung ${r.spacePokes} space pokes into its walk-in`);
}
{
  const r = series('A2 optimal vs jumper', persona('optimal'), persona('jumper'), heroF, foeF);
  const aa = r.res.reduce((t, x, k) => t + x.aaHits[seeds[k] % 2 === 1 ? 0 : 1], 0);
  const jin = r.res.reduce((t, x, k) => t + x.airHits[seeds[k] % 2 === 1 ? 1 : 0], 0);
  accept('A2 anti-air beats jumping', r.wins >= Math.ceil(0.8 * r.n) && aa > 0, `optimal won ${pct(r.wins, r.n)} vs jumper; anti-air hits ${aa}, jumper's air hits ${jin}`);
}
{
  const r = series('A3 novice vs L1', persona('novice'), level(1), heroF, foeF);
  accept('A3 novice beats L1 most of the time', r.wins * 2 > r.n, `novice (24 f input delay) won ${pct(r.wins, r.n)} vs CPU L1 (draws ${r.draws})`);
}
{
  const r = series('A4 ricky L6 vs optimal', level(6), persona('optimal'), () => 'ricky', heroF);
  accept('A4 boss beats optimal sometimes, loses mostly', r.wins >= 1 && r.wins * 2 < r.n, `RICKY (CPU L6 + tools) won ${pct(r.wins, r.n)} vs optimal (draws ${r.draws})`);
}

// ------------------------------------------------------------------ acceptance: the 3D ring (CHANGED(AI3D), CONTRACT §35.17)
// Probe-local spammers (blind brains, like the masher): HOMING spam = a homing ground strike that reaches, every
// decision; LINEAR spam = a linear ground strike / straight projectile that reaches. Fighters for the linear spammer: kits
// with >= 4 linear ground strikes (a kit without linear moves cannot spam them).
const spamProfile = (name: string): Profile => ({ ...levelProfile(0), name, level: -1, reactF: 100000, block: 0, guard: 0, punish: 0, antiAir: 0, aggression: 1, thinkF: 6, drop: 0, habit: 0, parry: 0, meter: 0, route: 1, tech: 0, delayF: 0, respect: 0, backRise: 0, wakeReversal: 0, step: 0, stepGuess: 0, circle: 0, antiStep: 0, walk: 0 });
const spammer = (kind: 'homing' | 'linear') => (f: string, seed: number): Cpu => createBrainCpu(spamProfile(kind), f, seed, (b: Brain): Decision => {
  const xs = b.kit.moves.filter((mi) => (kind === 'homing' ? mi.homing && !mi.proj : mi.linear && !(mi.proj && mi.cm.proj && mi.cm.proj.aimed)) && mi.recipe && mi.recipe.ctx === '' && !mi.recipe.air && !mi.inert && mi.super === 0 && !mi.grab && b.canUse(mi.idx) && (mi.proj || b.inReach(mi.idx)));
  if (xs.length > 0) return { t: 'move', idx: xs[Math.floor(b.rnd() * xs.length)].idx };
  return { t: 'hold', d: 6, frames: 4 };
});
const LINEAR_KITS = Object.keys(data.fighters).sort().filter((id) => {
  const cf = createMatch({ mode: 'training', stage: 'rust_theater', seed: 1, p: [{ fighter: id, color: 0, scheme: 1, cpu: -1 }, { fighter: 'johnny', color: 1, scheme: 1, cpu: -1 }] }, data).cf[0];
  return cf.moves.filter((cm) => cm.linear && cm.isStrike && cm.nBox > 0 && !cm.inAir && cm.snapId >= 0).length >= 4;
});
const linF = (sd: number): string => LINEAR_KITS[(sd * 5 + 1) % LINEAR_KITS.length];
/** the 'blocker' control: the stepper persona's profile with its steps off (no reaction / read steps), pokes + guards */
const blockerP = (f: string, seed: number): Cpu => {
  const base = createPersona('stepper', f, seed).brain.profile;
  return createBrainCpu({ ...base, name: 'blocker', step: 0 }, f, seed, (b: Brain): Decision => {
    if (b.seen.dist > b.opThreatU() + 30000) return { t: 'hold', d: 6, frames: 6 };
    const list = (b.kit.lists.pokes.length > 0 ? b.kit.lists.pokes : b.kit.lights).filter((k) => b.canUse(k) && b.inReach(k));
    if (list.length > 0 && b.rnd() < 0.2) return { t: 'move', idx: list[Math.floor(b.rnd() * list.length)] };
    return { t: 'guard', crouch: false, frames: 8 };
  });
};
const stepperVsLin = (sd: number): string => {
  const x = heroF(sd);
  return x === linF(sd) ? ROSTER[(sd + 3) % ROSTER.length] : x;
};
{
  const a = series('A5a homing spam vs stepper', spammer('homing'), persona('stepper'), heroF, foeF);
  const c = series('A5a control: homing spam vs blocker', spammer('homing'), blockerP, heroF, foeF);
  const b = series('A5b L6 vs stepper', level(6), persona('stepper'), heroF, foeF);
  const gain = Math.round((100 * (a.wins - c.wins)) / a.n);
  accept('A5 homing tools beat the stepper', a.wins >= Math.ceil(0.75 * a.n) && a.heroHomingStepHits > 0 && gain >= 20 && b.wins >= Math.ceil(0.7 * b.n) && (b.heroSt.antiSteps ?? 0) > 0 && b.heroHomingStepHits > 0,
    `homing spam won ${pct(a.wins, a.n)} vs the stepper (vs the steps-off blocker ${pct(c.wins, c.n)}: +${gain} points) with ${a.heroHomingStepHits} homing hits on it mid-step (stepper read steps ${a.foeSt.stepGuesses ?? 0}); CPU L6 won ${pct(b.wins, b.n)}, answered steps with ${b.heroSt.antiSteps ?? 0} homing / antiStep moves, ${b.heroHomingStepHits} homing hits on a stepping defender`);
}
{
  const r = series('A6 linear spam vs stepper', persona('stepper'), spammer('linear'), stepperVsLin, linF);
  const c = series('A6 control: blocker vs linear spam', blockerP, spammer('linear'), stepperVsLin, linF);
  const gain = Math.round((100 * (r.wins - c.wins)) / r.n);
  accept('A6 linear spam loses to a stepping defender', r.wins >= Math.ceil(0.7 * r.n) && (r.heroSt.linearEvades ?? 0) > 0 && (r.heroSt.sidePunishes ?? 0) > 0 && gain >= 20,
    `the stepper won ${pct(r.wins, r.n)} vs linear spam (${LINEAR_KITS.join('/')}; the steps-off blocker ${pct(c.wins, c.n)}: +${gain} points); ${r.heroSt.linearEvades ?? 0} linear moves evaded by its steps, ${r.heroSt.sidePunishes ?? 0} punishes out of a step, ${r.heroSt.whiffPunishes ?? 0} whiff punishes`);
}
{
  // A7: back on the ring wall along the fight line, a passive (guarding) opponent 1.3 m in front: circle-walk out
  const passive = (f: string, seed: number): Cpu => createBrainCpu({ ...spamProfile('passive'), aggression: 0, guard: 1, block: 1, reactF: 18 }, f, seed, (): Decision => ({ t: 'guard', crouch: false, frames: 30 }));
  let good = 0;
  let total = 0;
  const failsA7: string[] = [];
  const gains: number[] = [];
  const W7 = [1, 2];
  for (const stage of ['rust_theater', 'control_room']) for (const id of Object.keys(data.fighters).sort()) for (const sd of W7) {
    total++;
    const opp = id === 'johnny' ? 'patch' : 'johnny';
    const m = createMatch({ mode: 'versus', stage, seed: 600 + sd, p: [{ fighter: id, color: 0, scheme: 0, cpu: 6 }, { fighter: opp, color: 0, scheme: 0, cpu: 0 }] }, data);
    const me = createCpu(6, id, 700 + sd * 13);
    const op = passive(opp, 800 + sd);
    let n = 0;
    while (m.s[2] !== PH.FIGHT && n++ < 600) step(m, me.input(m, 0), op.input(m, 1));
    const b0 = fighterBase(0);
    const b1 = fighterBase(1);
    const r = m.ring.r;
    const push = (m.cf[0].pushFS + m.cf[0].pushBS) >> 1;
    m.s[b0 + F.x] = -(r - push - 15000);
    m.s[b1 + F.x] = -(r - push - 15000) + 130000;
    m.s[b0 + F.z] = 0;
    m.s[b1 + F.z] = 0;
    const u = [0, 0];
    const back = (): number => {
      normQ(m.s[b0 + F.x] - m.s[b1 + F.x], m.s[b0 + F.z] - m.s[b1 + F.z], u);
      return ringRay(m.ring, m.s[b0 + F.x], m.s[b0 + F.z], u[0], u[1]);
    };
    const back0 = back();
    let circled = false;
    let best = back0;
    for (let k = 0; k < 150 && m.s[2] === PH.FIGHT; k++) {
      step(m, me.input(m, 0), op.input(m, 1));
      const st = m.s[b0 + F.st];
      if (st === ST.SIDEWALK || st === ST.SIDESTEP) circled = true;
      best = Math.max(best, back());
    }
    gains.push(best - back0);
    if (circled && best >= 150000) good++;
    else failsA7.push(`${stage}:${id}/s${sd}(${(back0 / 1e5).toFixed(2)}->${(best / 1e5).toFixed(2)} m${circled ? '' : ' no circle'})`);
  }
  gains.sort((x, y) => x - y);
  accept('A7 the CPU circle-walks off its wall', good >= Math.ceil(0.8 * total), `CPU L6 with its back on the ring wall (circle + octagon), a guarding opponent 1.3 m in front: circled to >= 1.5 m behind it within 150 f in ${pct(good, total)} placements (median gain ${(gains[gains.length >> 1] / 1e5).toFixed(2)} m)${failsA7.length ? '; not: ' + failsA7.slice(0, 5).join(' ') + (failsA7.length > 5 ? ' ...' : '') : ''}`);
}

// ------------------------------------------------------------------ info
{
  const t = series('turtle vs masher', persona('turtle'), persona('masher'), heroF, foeF);
  const j = series('L6 vs jumper', level(6), persona('jumper'), heroF, foeF);
  const fr = series('freak L6 vs optimal', level(6), persona('optimal'), () => 'freak', heroF);
  say(`info: turtle vs masher ${pct(t.wins, t.n)} (draws ${t.draws}); CPU L6 vs jumper ${pct(j.wins, j.n)}; THE FREAK L6 vs optimal ${pct(fr.wins, fr.n)}`);
  // CHANGED(AI3D): ring info - the anti-step control + the circler
  const noAnti = (f: string, seed: number): Cpu => {
    const c = createCpu(6, f, seed);
    return { level: c.level, fighter: c.fighter, brain: c.brain, prepare: (mm, p) => c.prepare(mm, p), input: (mm, p) => { const w = c.input(mm, p); c.brain.profile.antiStep = 0; return w; } };
  };
  const na = series('L6 antiStep 0 vs stepper', noAnti, persona('stepper'), heroF, foeF);
  const ci = series('L6 vs circler', level(6), persona('circler'), heroF, foeF);
  say(`info (ring): CPU L6 antiStep 0 vs stepper ${pct(na.wins, na.n)} with ${na.heroHomingStepHits} homing hits on it mid-step (antiStep on: A5); CPU L6 vs circler ${pct(ci.wins, ci.n)}, ${ci.heroSt.antiSteps ?? 0} anti-step answers, ${ci.heroHomingStepHits} homing hits on it circling`);
  const ladder: string[] = [];
  for (const hi of [2, 4, 6, 8]) {
    const r = series(`L${hi} vs L${hi - 2}`, level(hi), level(hi - 2), heroF, foeF);
    ladder.push(`L${hi}>L${hi - 2} ${pct(r.wins, r.n)}`);
  }
  const nv: string[] = [];
  for (const lv of [3, 5]) {
    const r = series(`novice vs L${lv}`, persona('novice'), level(lv), heroF, foeF);
    nv.push(`novice vs L${lv} ${pct(r.wins, r.n)}`);
  }
  say(`info: level ladder ${ladder.join(', ')}; ${nv.join(', ')}`);
}

// ------------------------------------------------------------------ info: the level table in behaviour
// Each level's latched decisions, aggregated from CPU Ln vs CPU L4 matches (a decided threat = its reaction window
// opened while it was still coming): block share of decided strike/jump threats vs the table's block chance,
// anti-air choices, punishes, throw-tech attempts, execution drops per route step, supers.
{
  const rows: string[] = [];
  for (const lv of [1, 3, 5, 8]) {
    const tot = { reacted: 0, blocks: 0, aa: 0, punishes: 0, tech: 0, drops: 0, steps: 0, supers: 0, parries: 0, frames: 0, sReact: 0, sProj: 0, sGuess: 0, evades: 0, circ: 0, anti: 0, sideP: 0, sAtk: 0 };
    for (const sd of seeds.slice(0, 6)) {
      const [x, y] = pairFor(sd);
      const cpu = createCpu(lv, x, sd * 31 + lv);
      runMatch({ cpu, fighter: x, scheme: 0 }, { cpu: createCpu(4, y, sd * 37), fighter: y, scheme: 0 }, sd);
      const st = cpu.brain.stats;
      tot.reacted += st.reacted;
      tot.blocks += st.blocksChosen;
      tot.aa += st.aaChosen;
      tot.punishes += st.punishes;
      tot.tech += st.techTries;
      tot.drops += st.drops;
      tot.steps += st.routeSteps;
      tot.supers += st.supers;
      tot.parries += st.parries;
      tot.frames += st.frames;
      tot.sReact += st.stepsReact;
      tot.sProj += st.stepsProj;
      tot.sGuess += st.stepGuesses;
      tot.evades += st.stepEvades;
      tot.circ += st.circlesEscape + st.circlesCorner;
      tot.anti += st.antiSteps;
      tot.sideP += st.sidePunishes;
      tot.sAtk += st.stepAttacks;
    }
    const p = levelProfile(lv);
    const min = tot.frames / 3600;
    rows.push(`L${lv} (react ${p.reactF}f, block ${p.block}): decided ${tot.reacted}, blocks ${tot.blocks}, anti-air ${tot.aa}, parries ${tot.parries}, punishes ${tot.punishes}, techs ${tot.tech}, drops ${tot.drops}/${tot.steps} steps, supers ${tot.supers}; ring: reaction steps ${tot.sReact} + ${tot.sProj} vs projectiles, read steps ${tot.sGuess}, evades ${tot.evades}, circle-walks ${tot.circ}, anti-step ${tot.anti}, side punishes ${tot.sideP}, step-attacks ${tot.sAtk} (${min.toFixed(1)} min)`);
  }
  say(`info: level behaviour vs CPU L4 - ${rows.join('; ')}`);
}

const miss = A.filter((a) => !a.pass).map((a) => a.name.split(' ')[0]);
const acc = `acceptance ${A.length - miss.length}/${A.length}${miss.length ? ' (MISS ' + miss.join(',') + ')' : ''}`;
if (GATE) for (const a of A) ok(a.pass, `${a.name}: ${a.text}`);
const honest = fails.length === 0;
const mode = GATE ? `G3 seeds ${seeds[0]}..${seeds[seeds.length - 1]}` : `smoke seeds ${seeds.join(',')} (acceptance REPORT only; G3 = --seeds 1..20)`;
console.log(`${honest ? 'PASS' : 'FAIL'} probe_personas: ${checks - fails.length}/${checks} checks; ${mode}; ${acc}`);
process.exit(honest ? 0 : 1);
