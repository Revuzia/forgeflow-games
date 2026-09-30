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
// Acceptance (CONTRACT §11 G3; thresholds are this probe's reading of the words):
//   A1 block+punish beats mash       optimal vs masher: optimal wins >= 80 %
//   A2 anti-air beats jumping        optimal vs jumper: optimal wins >= 80 % and lands anti-airs
//   A3 novice beats L1 mostly        novice vs CPU L1: novice wins > 50 %
//   A4 boss vs optimal               RICKY (CPU L6 + boss tools) vs optimal: boss wins >= 1 match and < 50 %
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
import { dirBits } from '../runtime/src/core/ai/pad.ts';
import { buildKit } from '../runtime/src/core/ai/kit.ts';

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
    aaHits: [0, 0], airHits: [0, 0], cpuUs: 0,
  };
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
function series(label: string, hero: (f: string, seed: number) => Cpu, foe: (f: string, seed: number) => Cpu, heroFighter: (s: number) => string, foeFighter: (s: number) => string): { wins: number; draws: number; n: number; res: Result[]; respects: number; spacePokes: number } {
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
    const heroIdx = heroP1 ? 0 : 1;
    if (r.winner === heroIdx) wins++;
    else if (r.winner < 0) draws++;
    res.push(r);
    cpuUs += r.cpuUs;
    if (VERBOSE) console.log(`    ${label} seed ${sd}: ${hf}${heroP1 ? '(P1)' : '(P2)'} vs ${ff} -> ${r.winner === heroIdx ? 'WIN' : r.winner < 0 ? 'DRAW' : 'loss'} rounds ${r.wins.join('-')} frames ${r.frames} hits ${r.hits[heroIdx]}/${r.hits[1 - heroIdx]} blocks(by hero) ${r.blocks[heroIdx]} aa ${r.aaHits[heroIdx]} throws ${r.throws[heroIdx]}/${r.throws[1 - heroIdx]}`);
  }
  if (VERBOSE) console.log(`    ${label}: cpu ${(cpuUs / seeds.length).toFixed(1)} us/call`);
  return { wins, draws, n: seeds.length, res, respects, spacePokes };
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
      const prof = { ...levelProfile(8), name: `react${R}`, level: -1, reactF: R, block: 1, guard: 0, aggression: 0, punish: 0, antiAir: 0, parry: 0, parryShare: 0, tech: 0, drop: 0, nerve: 0, backRise: 0, wakeReversal: 0 };
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
    const prof = { ...levelProfile(3), aggression: 0, punish: 0, habit: habitW };
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
  const H5S = GATE ? [1, 2, 3, 4, 5, 6] : [1, 2, 3];
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
  for (const hero of U_ROSTER) {
    const t: Tally = { use: {}, ev: {}, stance: 0 };
    for (const lv of [6, 8]) for (const sd of useSeeds) {
      let opp = UOPP[(sd + lv + hero.length) % UOPP.length];
      if (opp === hero) opp = UOPP[(sd + lv + hero.length + 1) % UOPP.length];
      tallyBout(hero, lv, opp, 6, sd, sd % 2, false, data, t);
    }
    const tm: Tally = { use: {}, ev: {}, stance: 0 };
    for (const sd of GATE ? [1, 2] : [1]) tallyBout(hero, 6, hero === 'johnny' ? 'patch' : 'johnny', 4, sd + 50, sd % 2, true, data, tm);
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
    if (kit1.sup1 >= 0 && sup(kit1.sup1) === 0) miss.push(`Lv1 ${kit1.moves[kit1.sup1].id}`);
    const lv3ids = [kit1.sup3, cf.route2.sup3].filter((k) => k >= 0).map((k) => kit1.moves[k].id);
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
  const uText = `every kit's special families + Lv1 + Lv3 + unique in ${U_ROSTER.length * 2 * useSeeds.length} natural + ${U_ROSTER.length * (GATE ? 2 : 1)} full-meter CPU bouts: ${missing.length === 0 ? 'all used' : 'MISSING ' + missing.join('; ')}; injected install started ${ti.use.weave_l ?? 0}x, INSTALL events ${inst}`;
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

// ------------------------------------------------------------------ info
{
  const t = series('turtle vs masher', persona('turtle'), persona('masher'), heroF, foeF);
  const j = series('L6 vs jumper', level(6), persona('jumper'), heroF, foeF);
  const fr = series('freak L6 vs optimal', level(6), persona('optimal'), () => 'freak', heroF);
  say(`info: turtle vs masher ${pct(t.wins, t.n)} (draws ${t.draws}); CPU L6 vs jumper ${pct(j.wins, j.n)}; THE FREAK L6 vs optimal ${pct(fr.wins, fr.n)}`);
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
    const tot = { reacted: 0, blocks: 0, aa: 0, punishes: 0, tech: 0, drops: 0, steps: 0, supers: 0, parries: 0, frames: 0 };
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
    }
    const p = levelProfile(lv);
    const min = tot.frames / 3600;
    rows.push(`L${lv} (react ${p.reactF}f, block ${p.block}): decided ${tot.reacted}, blocks ${tot.blocks}, anti-air ${tot.aa}, parries ${tot.parries}, punishes ${tot.punishes}, techs ${tot.tech}, drops ${tot.drops}/${tot.steps} steps, supers ${tot.supers} (${min.toFixed(1)} min)`);
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
