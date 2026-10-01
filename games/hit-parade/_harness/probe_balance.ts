// HIT PARADE - balance + ring-usage probe (lane FIX_BALANCE, CONTRACT §35.21 CHANGED(fix_balance)). Node only, real sim +
// real data/ + the real CPU (core/ai). Every bout is staged the way game.ts stages it: THE SEASON slot = mode 'arcade' on the
// opponent's home stage, the CPU at the slot level (+ the difficulty shift), CPU seeds = cfg.seed ^ (0x9e3779b9 x (p + 1)).
//
//   node _harness/probe_balance.ts            smoke (run_probes): small samples, gates only robust bands (see Smoke below)
//   node _harness/probe_balance.ts --full     the full tables + the fix_balance targets as gates (exit 1 on a miss)
//   --only bosses,ladder,novice,ring,ringflat   sections (default: full all, smoke bosses,novice,ring); --all-diffs (smoke)
//   --seeds N        seeds per cell (bosses; smoke 4, full 24)
//   --player cpu6|optimal|both                the strong-player persona(s) for the boss / ladder tables (default both)
//   --json FILE      dump the measured tables
//   -v               per-cell lines
//
// Sections
//   bosses   the strong player (CPU L6 contestant, and / or the harness 'optimal' persona) as each of the 10 contestants vs
//            THE FREAK (butcher_block) and RICKY (control_room) at their data/ladder.json level for EASY / NORMAL / HARD
//            (the miniboss / boss slot level + the ladder's difficulty shift, clamped)
//   ladder   the same strong player vs the regular SEASON slots at their NORMAL levels (ladder.json slots 1-6), every other
//            playable fighter as the opponent on its home stage
//   novice   the 'novice' persona (24 f input delay) vs NORMAL slot 1 (ladder.json) and vs CPU L1 (G3 A3's opponent)
//   ring     CPU Ln vs CPU Ln (menu VERSUS), 12 fighters x 5 arenas per level: sidestep TAPS (a SIDESTEP that did not turn
//            into a circle-walk), circle-walks (SIDEWALK entries), all step starts, and the camera basis camN travel per
//            bout (sum of |turn| over the fight frames, degrees) + its widest sweep inside one round
//   ringflat the same CPU Ln vs an opponent that never steps (CPU Ln with the ring levers off = a player who fights on the
//            line): the camN travel there is the CPU's own doing (arcade bouts vs a human who never presses STEP)
// Gates (--full = the fix_balance brief; the strong player = CPU L6 contestants, the bosses' own level; the optimal persona is
// measured alongside - G3 A4 needs it to beat RICKY > 50 %, which rules it out as the curve's gauge, CONTRACT §35.21):
//   B1a CPU L6 contestants beat THE FREAK at its NORMAL ladder level 40-65 % on average
//   B1b every contestant >= 30 % vs THE FREAK at NORMAL with the 'optimal' persona (B1c NOTE: the CPU L6 per-kit spread)
//   B2  THE FREAK clearly harder than the regular slots 1-6 (>= 8 points under the hardest slot level, >= 20 under their mean)
//   B3  THE FREAK clearly easier than RICKY at EASY and NORMAL (>= 8 points); HARD is a NOTE (both saturate)
//   B4  the novice beats NORMAL slot 1 > 50 %
//   R1  ring L4: >= 6 sidestep taps + >= 2 circle-walks per CPU per bout, every fighter >= 3 taps
//   R2  L6 / L8 step and circle at least as much as L4, camN travel >= 180 deg per bout
//   R3  L1 / L2 occasional (>= 0.3 steps per bout, no more taps than L4)
//   R4  ringflat L6 / L8: the CPU alone (vs a line player) turns camN >= 180 deg per bout
// Smoke (run_probes, no args, ~1 min): bosses at NORMAL x 4 seeds (FREAK 25-80 %, RICKY not easier by > 10), the novice vs
// slot 1, ring L4 on 2 arenas (taps >= 4.5, circle-walks >= 1.5).

import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { loadGameData } from '../runtime/src/core/data.ts';
import type { GameData } from '../runtime/src/core/types.ts';
import { createMatch, readMatch, step } from '../runtime/src/core/sim/match.ts';
import type { MatchCfg, Scheme } from '../runtime/src/core/sim/match.ts';
import { F, PH, ST, W, fighterBase } from '../runtime/src/core/sim/layout.ts';
import { createCpu, createBrainCpu, levelProfile } from '../runtime/src/core/ai/cpu.ts';
import type { Cpu } from '../runtime/src/core/ai/cpu.ts';
import { createPersona } from '../runtime/src/core/ai/personas.ts';
import type { BrainStats } from '../runtime/src/core/ai/brain.ts';

// ------------------------------------------------------------------ the bout runner (exported for scratch tools)
export interface BoutOut {
  winner: number;
  wins: [number, number];
  frames: number;
  fightFrames: number;
  /** sidestep taps (a SIDESTEP that did not continue into a SIDEWALK) */
  taps: [number, number];
  /** circle-walks (SIDEWALK entries) */
  walks: [number, number];
  /** every SIDESTEP start (taps + the first 15 f of each circle-walk) */
  steps: [number, number];
  /** frames spent in SIDESTEP / SIDEWALK */
  stepFrames: [number, number];
  /** camN travel over the fight frames (degrees, sum of |turn|) */
  camTravel: number;
  /** widest camN sweep inside one round (degrees, max - min of the unwrapped angle) */
  camSweep: number;
  hp: [number, number];
  stats: [BrainStats | null, BrainStats | null];
}

const DEG = 180 / Math.PI;

export function runBout(data: GameData, cfg: MatchCfg, cpus: [Cpu, Cpu], maxF = 40000): BoutOut {
  const m = createMatch(cfg, data);
  const s = m.s;
  const out: BoutOut = {
    winner: -1, wins: [0, 0], frames: 0, fightFrames: 0, taps: [0, 0], walks: [0, 0], steps: [0, 0], stepFrames: [0, 0],
    camTravel: 0, camSweep: 0, hp: [0, 0], stats: [null, null],
  };
  const prev = [-1, -1];
  let lastAng = NaN;
  let unwrapped = 0;
  let lo = 0;
  let hi = 0;
  let lastRound = -1;
  for (let f = 0; f < maxF; f++) {
    const w0 = cpus[0].input(m, 0);
    const w1 = cpus[1].input(m, 1);
    step(m, w0, w1);
    const fight = s[W.phase] === PH.FIGHT;
    for (let i = 0; i < 2; i++) {
      const st = s[fighterBase(i) + F.st];
      const p = prev[i];
      if (st === ST.SIDESTEP && p !== ST.SIDESTEP) out.steps[i]++;
      if (p === ST.SIDESTEP && st !== ST.SIDESTEP) {
        if (st === ST.SIDEWALK) out.walks[i]++;
        else out.taps[i]++;
      }
      if (st === ST.SIDESTEP || st === ST.SIDEWALK) out.stepFrames[i]++;
      prev[i] = st;
    }
    if (fight) {
      out.fightFrames++;
      const round = s[W.round];
      const ang = Math.atan2(s[W.camNX], s[W.camNZ]);
      if (round !== lastRound || Number.isNaN(lastAng)) {
        lastRound = round;
        unwrapped = 0;
        lo = 0;
        hi = 0;
      } else {
        let d = ang - lastAng;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        out.camTravel += Math.abs(d) * DEG;
        unwrapped += d;
        lo = Math.min(lo, unwrapped);
        hi = Math.max(hi, unwrapped);
        out.camSweep = Math.max(out.camSweep, (hi - lo) * DEG);
      }
      lastAng = ang;
    } else lastAng = NaN;
    if (s[W.phase] === PH.MATCH_END) break;
  }
  const ms = readMatch(m);
  out.winner = ms.winner;
  out.wins = [ms.wins[0], ms.wins[1]];
  out.frames = ms.frame;
  out.hp = [s[fighterBase(0) + F.hp], s[fighterBase(1) + F.hp]];
  out.stats = [cpus[0].brain ? cpus[0].brain.stats : null, cpus[1].brain ? cpus[1].brain.stats : null];
  return out;
}

export const ROSTER10 = ['johnny', 'patch', 'bruno', 'zambini', 'krane', 'lotus', 'boneyard', 'spin', 'gazza', 'rerun'];
export const ARENAS = ['rust_theater', 'butcher_block', 'wheel_of_pain', 'rooftop', 'control_room'];

export function homeStage(data: GameData, id: string): string {
  const st = (data.fighters[id] as unknown as { stage?: string } | undefined)?.stage;
  return typeof st === 'string' && st ? st : 'rust_theater';
}

/**
 * THE SEASON's NORMAL levels from data/ladder.json (what flow.ts ladderSpecs reads): the regular slots in order, the mini
 * boss, the boss, and the difficulty shift (+-) with its clamp. Falls back to the FIGHTING_DESIGN 9b ladder.
 */
export function seasonLevels(data: GameData): { slots: number[]; miniboss: number; boss: number; easy: number; hard: number; min: number; max: number } {
  const lad = data.ladder as unknown as { season?: { kind: string; level: number }[]; difficulty?: Record<string, number> };
  const season = Array.isArray(lad.season) ? lad.season : [];
  const slots = season.filter((x) => x.kind === 'bout' || x.kind === 'rival').map((x) => x.level);
  const lvOf = (k: string, d: number): number => season.find((x) => x.kind === k)?.level ?? d;
  const df = lad.difficulty ?? {};
  return {
    slots: slots.length ? slots : [2, 3, 3, 4, 5, 5], miniboss: lvOf('miniboss', 6), boss: lvOf('boss', 6),
    easy: df.easy ?? -2, hard: df.hard ?? 2, min: df.minLevel ?? 0, max: df.maxLevel ?? 8,
  };
}

/** the game's CPU seed for side p (game.ts startBout) */
export function cpuSeed(seed: number, p: number): number {
  return (seed ^ (0x9e3779b9 * (p + 1))) >>> 0;
}

export type PlayerKind = 'cpu6' | 'optimal' | 'novice';
export function playerCpu(kind: PlayerKind, fighter: string, seed: number): Cpu {
  if (kind === 'cpu6') return createCpu(6, fighter, seed);
  return createPersona(kind, fighter, seed);
}

/** one SEASON-style bout: the player (P1) vs the CPU at `level` (P2) on the opponent's home stage, arcade rules */
export function seasonBout(data: GameData, player: PlayerKind, fighter: string, opp: string, level: number, seed: number, stage?: string): BoutOut {
  const cfg: MatchCfg = {
    mode: 'arcade', stage: stage ?? homeStage(data, opp), seed,
    p: [{ fighter, color: 0, scheme: 0 as Scheme, cpu: -1 }, { fighter: opp, color: opp === fighter ? 1 : 0, scheme: 0 as Scheme, cpu: level }],
  };
  return runBout(data, cfg, [playerCpu(player, fighter, cpuSeed(seed, 0)), createCpu(level, opp, cpuSeed(seed, 1))]);
}

/** a CPU Ln with the 3D ring levers off (fights on the line: never steps / circles) - the 'ringflat' opponent */
export function flatCpu(level: number, fighter: string, seed: number): Cpu {
  const c = createCpu(level, fighter, seed);
  const off = (): void => {
    const b = c.brain.profile;
    b.step = 0; b.stepGuess = 0; b.circle = 0; b.antiStep = 0; b.walk = 0;
  };
  off();
  // createCpu re-resolves its profile against the match table on its first call: zero the ring levers after that too
  return {
    level: c.level, fighter: c.fighter, brain: c.brain,
    prepare: (m, i) => { c.prepare(m, i); off(); },
    input: (m, i) => {
      if (!c.brain.bound) { c.prepare(m, i); off(); }
      const w = c.input(m, i);
      off();
      return w;
    },
  };
}

// ------------------------------------------------------------------ main
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

function main(): void {
  const args = process.argv.slice(2);
  const FULL = args.includes('--full');
  const VERBOSE = args.includes('-v');
  const arg = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // smoke (run_probes, no args): THE FREAK / RICKY at NORMAL, the novice vs slot 1, ring L4 - about a minute
  const only = (arg('--only') ?? (FULL ? 'bosses,ladder,novice,ring,ringflat' : 'bosses,novice,ring')).split(',');
  const NSEED = Number(arg('--seeds') ?? (FULL ? 24 : 4));
  const playersArg = arg('--player') ?? (FULL ? 'both' : 'cpu6');
  const players: PlayerKind[] = playersArg === 'both' ? ['cpu6', 'optimal'] : [playersArg as PlayerKind];
  const jsonOut = arg('--json');
  const data = loadGameData();
  const fails: string[] = [];
  let checks = 0;
  const ok = (cond: boolean, label: string): void => {
    checks++;
    if (!cond) fails.push(label);
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  };
  const pc = (w: number, n: number): string => `${n ? Math.round((100 * w) / n) : 0}%`;
  const dump: Record<string, unknown> = {};
  const t0 = Date.now();

  // ---------------------------------------------------------------- bosses
  const bossRate: Record<string, Record<string, Record<string, number>>> = {}; // player -> boss@diff -> fighter -> win %
  if (only.includes('bosses')) {
    const SL = seasonLevels(data);
    const diffs: [string, number][] = FULL || args.includes('--all-diffs') ? [['easy', SL.easy], ['normal', 0], ['hard', SL.hard]] : [['normal', 0]];
    const bossLv = (boss: string, sh: number): number => Math.max(SL.min, Math.min(SL.max, (boss === 'freak' ? SL.miniboss : SL.boss) + sh));
    for (const pl of players) {
      bossRate[pl] = {};
      console.log(`bosses (player = ${pl}, ${NSEED} seeds per cell, win % of the player; ladder.json levels: THE FREAK ${diffs.map(([d, sh]) => `${d} L${bossLv('freak', sh)}`).join(' / ')}, RICKY ${diffs.map(([d, sh]) => `${d} L${bossLv('ricky', sh)}`).join(' / ')}):`);
      console.log(`  ${'fighter'.padEnd(9)} ${diffs.map(([d]) => `freak@${d}`.padStart(13) + `ricky@${d}`.padStart(13)).join('')}`);
      const tot: Record<string, [number, number]> = {};
      for (const f of ROSTER10) {
        const cells: string[] = [];
        for (const [dn, sh] of diffs) {
          for (const boss of ['freak', 'ricky']) {
            const lv = bossLv(boss, sh);
            let w = 0;
            for (let k = 1; k <= NSEED; k++) {
              const seed = 1000 * k + 17 * f.length + (boss === 'freak' ? 3 : 5) + (sh + 2) * 101;
              const r = seasonBout(data, pl, f, boss, lv, seed);
              if (r.winner === 0) w++;
            }
            const key = `${boss}@${dn}`;
            ((bossRate[pl][key] ??= {}))[f] = Math.round((100 * w) / NSEED);
            const t = (tot[key] ??= [0, 0]);
            t[0] += w;
            t[1] += NSEED;
            cells.push(`${w}/${NSEED} ${pc(w, NSEED)}`.padStart(13));
          }
        }
        console.log(`  ${f.padEnd(9)} ${cells.join('')}`);
      }
      console.log(`  ${'ALL'.padEnd(9)} ${diffs.map(([d]) => ['freak', 'ricky'].map((b) => pc(tot[`${b}@${d}`][0], tot[`${b}@${d}`][1]).padStart(13)).join('')).join('')}`);
      for (const k of Object.keys(tot)) bossRate[pl][k].ALL = Math.round((100 * tot[k][0]) / tot[k][1]);
    }
    dump.bosses = bossRate;
  }

  // ---------------------------------------------------------------- ladder (regular slots)
  const slotRate: Record<string, Record<number, number>> = {};
  if (only.includes('ladder')) {
    const LV = [...new Set(seasonLevels(data).slots)].sort((a, b) => a - b);
    const nOpp = FULL ? 2 : 1;
    for (const pl of players) {
      slotRate[pl] = {};
      const per: Record<string, string[]> = {};
      for (const lv of LV) {
        let w = 0;
        let n = 0;
        for (const f of ROSTER10) {
          let wf = 0;
          let nf = 0;
          for (const o of ROSTER10) {
            if (o === f) continue;
            for (let k = 1; k <= nOpp; k++) {
              const seed = 5000 + 977 * k + 31 * lv + 7 * f.length + 3 * o.length;
              const r = seasonBout(data, pl, f, o, lv, seed);
              if (r.winner === 0) wf++;
              nf++;
            }
          }
          w += wf;
          n += nf;
          (per[f] ??= []).push(`L${lv} ${pc(wf, nf)}`);
        }
        slotRate[pl][lv] = Math.round((100 * w) / n);
      }
      console.log(`ladder slots (player = ${pl}, every other playable fighter x ${nOpp} on its home stage): ${LV.map((lv) => `L${lv} ${slotRate[pl][lv]}%`).join(', ')}`);
      if (VERBOSE) for (const f of ROSTER10) console.log(`    ${f.padEnd(9)} ${per[f].join('  ')}`);
    }
    dump.ladder = slotRate;
  }

  // ---------------------------------------------------------------- novice
  const novRate: Record<number, number> = {};
  if (only.includes('novice')) {
    const nOpp = FULL ? 2 : 1;
    const slot1 = seasonLevels(data).slots[0];
    for (const lv of [...new Set([1, slot1])]) {
      let w = 0;
      let n = 0;
      for (const f of ROSTER10) for (const o of ROSTER10) {
        if (o === f) continue;
        for (let k = 1; k <= nOpp; k++) {
          const seed = 9000 + 613 * k + 11 * lv + 7 * f.length + 3 * o.length;
          const r = seasonBout(data, 'novice', f, o, lv, seed);
          if (r.winner === 0) w++;
          n++;
        }
      }
      novRate[lv] = Math.round((100 * w) / n);
    }
    console.log(`novice (24 f input delay) vs CPU L1 ${novRate[1]}%, vs NORMAL slot 1 (CPU L${slot1}) ${novRate[slot1]}%`);
    novRate[-1] = slot1;
    dump.novice = novRate;
  }

  // ---------------------------------------------------------------- ring usage
  interface RingRow { level: number; bouts: number; taps: number; walks: number; steps: number; travel: number; sweep: number; fightF: number; per: Record<string, [number, number, number]> }
  const ringRows: Record<string, RingRow[]> = {};
  const ALL12 = Object.keys(data.fighters).sort();
  for (const sec of ['ring', 'ringflat'] as const) {
    if (!only.includes(sec)) continue;
    const LVS = FULL ? [1, 2, 4, 6, 8] : [4];
    ringRows[sec] = [];
    for (const lv of LVS) {
      const row: RingRow = { level: lv, bouts: 0, taps: 0, walks: 0, steps: 0, travel: 0, sweep: 0, fightF: 0, per: {} };
      // 12 fighters x 5 arenas: fighter i as P1 vs a rotating opponent (smoke: 12 fighters x 2 arenas)
      const arenas = FULL ? ARENAS : ['butcher_block', 'rooftop'];
      ALL12.forEach((f, fi) => {
        arenas.forEach((stage, ai) => {
          let o = ALL12[(fi + 1 + ai * 2 + lv) % ALL12.length];
          if (o === f) o = ALL12[(fi + 3) % ALL12.length];
          const seed = 77 + 131 * fi + 17 * ai + lv;
          const cfg: MatchCfg = {
            mode: 'versus', stage, seed,
            p: [{ fighter: f, color: 0, scheme: 0 as Scheme, cpu: lv }, { fighter: o, color: o === f ? 1 : 0, scheme: 0 as Scheme, cpu: lv }],
          };
          const c0 = createCpu(lv, f, cpuSeed(seed, 0));
          const c1 = sec === 'ring' ? createCpu(lv, o, cpuSeed(seed, 1)) : flatCpu(lv, o, cpuSeed(seed, 1));
          const r = runBout(data, cfg, [c0, c1]);
          row.bouts++;
          row.fightF += r.fightFrames;
          row.travel += r.camTravel;
          row.sweep += r.camSweep;
          const sides = sec === 'ring' ? [0, 1] : [0];
          for (const i of sides) {
            const id = i === 0 ? f : o;
            const pr = (row.per[id] ??= [0, 0, 0]);
            pr[0] += r.taps[i];
            pr[1] += r.walks[i];
            pr[2]++;
            row.taps += r.taps[i];
            row.walks += r.walks[i];
            row.steps += r.steps[i];
          }
          if (VERBOSE) console.log(`    ${sec} L${lv} ${stage} ${f}-${o}: taps ${r.taps.join('/')} walks ${r.walks.join('/')} travel ${r.camTravel.toFixed(0)} sweep ${r.camSweep.toFixed(0)} frames ${r.frames} wins ${r.wins.join('-')}`);
        });
      });
      const sideN = sec === 'ring' ? row.bouts * 2 : row.bouts;
      const perTxt = Object.entries(row.per).sort().map(([id, [t, w, n]]) => `${id} ${(t / n).toFixed(1)}/${(w / n).toFixed(1)}`).join(' ');
      console.log(`${sec} L${lv} (${row.bouts} bouts): per CPU per bout taps ${(row.taps / sideN).toFixed(2)}, circle-walks ${(row.walks / sideN).toFixed(2)}, step starts ${(row.steps / sideN).toFixed(2)}; camN travel ${(row.travel / row.bouts).toFixed(0)} deg, widest sweep ${(row.sweep / row.bouts).toFixed(0)} deg per bout (${(row.fightF / row.bouts / 60).toFixed(0)} s of fight per bout)`);
      console.log(`    taps/walks per fighter: ${perTxt}`);
      ringRows[sec].push(row);
    }
  }
  dump.ring = ringRows;

  // ---------------------------------------------------------------- gates
  const note = (label: string): void => console.log(`  NOTE ${label}`);
  const P = 'cpu6';
  if (bossRate[P]) {
    const fr = bossRate[P]['freak@normal'];
    const ri = bossRate[P]['ricky@normal'];
    const low = ROSTER10.filter((f) => fr[f] < 30);
    if (FULL) {
      ok(fr.ALL >= 40 && fr.ALL <= 65, `B1a CPU L6 contestants beat THE FREAK at NORMAL (L${seasonLevels(data).miniboss}) ${fr.ALL}% on average (want 40-65)`);
      const op = bossRate.optimal?.['freak@normal'];
      if (op) {
        const lowO = ROSTER10.filter((f) => op[f] < 30);
        ok(lowO.length === 0, `B1b every contestant beats THE FREAK at NORMAL >= 30% with the strong 'optimal' persona (min ${Math.min(...ROSTER10.map((f) => op[f]))}%: ${ROSTER10.map((f) => `${f} ${op[f]}`).join(' ')}; average ${op.ALL}%)`);
      }
      // report: the CPU L6 contestants' per-kit spread (CPU kit-plan strength: the same kits are the weakest vs L5 slots / RICKY)
      note(`B1c CPU L6 per contestant vs THE FREAK at NORMAL: ${ROSTER10.map((f) => `${f} ${fr[f]}`).join(' ')}${low.length ? ` - below 30%: ${low.join(', ')}` : ''}`);
      for (const d of ['easy', 'normal']) {
        const a = bossRate[P][`freak@${d}`].ALL;
        const b = bossRate[P][`ricky@${d}`].ALL;
        ok(a - b >= 8, `B3 ${d}: THE FREAK (${a}%) clearly easier than RICKY (${b}%) for the CPU L6 player (>= 8 points)`);
      }
      const ah = bossRate[P]['freak@hard']?.ALL;
      const bh = bossRate[P]['ricky@hard']?.ALL;
      if (ah !== undefined && bh !== undefined) note(`B3 hard: THE FREAK ${ah}% vs RICKY ${bh}% for the CPU L6 player (RICKY ${bh <= ah ? 'harder' : 'EASIER'} by ${Math.abs(ah - bh)} points; both saturate - only the grapplers win at HARD)`);
      if (bossRate.optimal) {
        const o = bossRate.optimal;
        note(`optimal persona: THE FREAK ${o['freak@easy']?.ALL} / ${o['freak@normal']?.ALL} / ${o['freak@hard']?.ALL}%, RICKY ${o['ricky@easy']?.ALL} / ${o['ricky@normal']?.ALL} / ${o['ricky@hard']?.ALL}% (EASY / NORMAL / HARD)`);
      }
    } else {
      ok(fr.ALL >= 25 && fr.ALL <= 80, `B1 smoke: CPU L6 contestants beat THE FREAK at NORMAL ${fr.ALL}% (band 25-80 on ${NSEED} seeds)`);
      ok(ri.ALL <= fr.ALL + 10, `B3 smoke: RICKY (${ri.ALL}%) not easier than THE FREAK (${fr.ALL}%) by more than 10 points`);
    }
    if (slotRate[P]) {
      const lvs = Object.keys(slotRate[P]).map(Number).sort((a, b) => a - b);
      const top = slotRate[P][lvs[lvs.length - 1]];
      const avg = Math.round(seasonLevels(data).slots.reduce((t, lv) => t + (slotRate[P][lv] ?? 0), 0) / seasonLevels(data).slots.length);
      ok(FULL ? top - fr.ALL >= 8 && avg - fr.ALL >= 20 : top - fr.ALL >= 0, `B2 THE FREAK (${fr.ALL}%) clearly harder than the regular slots 1-6 for the CPU L6 player (hardest slot level L${lvs[lvs.length - 1]} ${top}%, slots 1-6 average ${avg}%; want >= 8 / >= 20 points; ${lvs.map((lv) => `L${lv} ${slotRate[P][lv]}%`).join(', ')})`);
      if (slotRate.optimal && bossRate.optimal) note(`optimal persona: slots ${Object.keys(slotRate.optimal).map((lv) => `L${lv} ${slotRate.optimal[Number(lv)]}%`).join(', ')} vs THE FREAK NORMAL ${bossRate.optimal['freak@normal']?.ALL}%`);
    }
  }
  if (novRate[-1] !== undefined) ok(novRate[novRate[-1]] > 50, `B4 the novice beats NORMAL slot 1 (CPU L${novRate[-1]}) most of the time: ${novRate[novRate[-1]]}% (vs L1 ${novRate[1]}%)`);
  const rr = ringRows.ring;
  if (rr) {
    const at = (lv: number): RingRow | undefined => rr.find((r) => r.level === lv);
    const per = (r: RingRow, k: 'taps' | 'walks'): number => r[k] / (r.bouts * 2);
    const l4 = at(4);
    if (l4) {
      const minF = Object.entries(l4.per).map(([id, [t, , n]]) => [id, t / n] as [string, number]).sort((a, b) => a[1] - b[1]);
      if (FULL) ok(per(l4, 'taps') >= 6 && per(l4, 'walks') >= 2 && minF[0][1] >= 3, `R1 L4: ${per(l4, 'taps').toFixed(1)} sidestep taps + ${per(l4, 'walks').toFixed(1)} circle-walks per CPU per bout (want >= 6 / >= 2), fewest taps ${minF[0][0]} ${minF[0][1].toFixed(1)} (want >= 3)`);
      // smoke: 24 bouts (2 arenas) - the averages with a sampling margin, the per-fighter minimum reported only
      else ok(per(l4, 'taps') >= 4.5 && per(l4, 'walks') >= 1.5, `R1 smoke L4: ${per(l4, 'taps').toFixed(1)} sidestep taps + ${per(l4, 'walks').toFixed(1)} circle-walks per CPU per bout (smoke band >= 4.5 / >= 1.5; full target 6 / 2), fewest taps ${minF[0][0]} ${minF[0][1].toFixed(1)}`);
      for (const hl of [6, 8]) {
        const h = at(hl);
        if (h) ok(per(h, 'taps') >= per(l4, 'taps') && per(h, 'walks') >= per(l4, 'walks') && h.travel / h.bouts >= 180, `R2 L${hl}: taps ${per(h, 'taps').toFixed(1)} / circle-walks ${per(h, 'walks').toFixed(1)} >= L4's, camN travel ${(h.travel / h.bouts).toFixed(0)} deg per bout (want >= 180)`);
      }
      for (const ll of [1, 2]) {
        const l = at(ll);
        if (l) ok(per(l, 'taps') + per(l, 'walks') >= 0.3 && per(l, 'taps') <= per(l4, 'taps'), `R3 L${ll}: occasional steps - taps ${per(l, 'taps').toFixed(1)} + circle-walks ${per(l, 'walks').toFixed(1)} per bout (>= 0.3, <= L4)`);
      }
    }
  }
  const rf = ringRows.ringflat;
  if (rf) for (const r of rf) if (r.level >= 6) ok(r.travel / r.bouts >= 180, `R4 ringflat L${r.level}: vs an opponent that never steps the CPU alone turns camN ${(r.travel / r.bouts).toFixed(0)} deg per bout (want >= 180)`);

  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(dump, null, 1));
  const pass = fails.length === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'} probe_balance: ${checks - fails.length}/${checks} checks; ${FULL ? 'FULL' : 'smoke'} (${((Date.now() - t0) / 1000).toFixed(0)} s)${fails.length ? ' FAILED: ' + fails.map((x) => x.split(' ')[0]).join(',') : ''}`);
  process.exit(pass ? 0 : 1);
}
