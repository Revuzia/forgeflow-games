// HIT PARADE - balance + ring-usage probe (lane FIX_BALANCE, CONTRACT §35.21 CHANGED(fix_balance)). Node only, real sim +
// real data/ + the real CPU (core/ai). Every bout is staged the way game.ts stages it: THE SEASON slot = mode 'arcade' on the
// opponent's home stage, the CPU at the slot level (+ the difficulty shift), CPU seeds = cfg.seed ^ (0x9e3779b9 x (p + 1)).
//
//   node _harness/probe_balance.ts            smoke (run_probes): small samples, gates only robust bands (see Smoke below)
//   node _harness/probe_balance.ts --full     the full tables + the fix_balance targets as gates (exit 1 on a miss)
//   --only bosses,ladder,novice,ring,ringflat   sections (default: full all, smoke bosses,novice,ring); --all-diffs (smoke)
//   --seeds N        seeds per cell (bosses; smoke 4, full 24)
//   --player cpu6|optimal|seasonbot|both|all   the player(s) for the boss / ladder tables, comma list ok (default: full all, smoke cpu6;
//                    both = cpu6,optimal; all = + seasonbot, CHANGED(wf7 season bot))
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
//   B5  CHANGED(wf7 season bot): the SeasonBot (playtest.py's G11 persona, headless mirror) beats THE FREAK at NORMAL >= 25 %
//       with every contestant (THE SEASON completable; the WF6 0 / 22 was the bot's range bug) and RICKY is not easier than
//       THE FREAK for it (B5b); its slot table is a NOTE (the bot's guard is frame-exact: its rates overstate a human's)
//   R1  ring L4: >= 6 sidestep taps + >= 2 circle-walks per CPU per bout, every fighter >= 3 taps
//   R2  L6 / L8 step and circle at least as much as L4, camN travel >= 180 deg per bout
//   R3  L1 / L2 occasional (>= 0.3 steps per bout, no more taps than L4)
//   R4  ringflat L6 / L8: the CPU alone (vs a line player) turns camN >= 180 deg per bout
// Smoke (run_probes, no args, ~1 min): bosses at NORMAL x 4 seeds (FREAK 25-80 %, RICKY not easier by > 10), the novice vs
// slot 1, ring L4 on 2 arenas (taps >= 4.5, circle-walks >= 1.5), the SeasonBot johnny vs THE FREAK x 4 seeds >= 25 % (B5 smoke).

//
// CHANGED(wf7 season bot): `seasonbot` player kind = a headless mirror of the real-key G11 persona (playtest.py SeasonBot,
// ranges from the compiled reach / push fronts), its geometry helper (`--geom <me> <opp>`, read by playtest.py), and
// `--botbouts <me> <opp> <level> <stage> <seeds,...>` (the same bouts playtest.py --bosses plays with real keys).

import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { loadGameData } from '../runtime/src/core/data.ts';
import type { FighterSnap, GameData, MatchSnap } from '../runtime/src/core/types.ts';
import { createMatch, readFighter, readMatch, step } from '../runtime/src/core/sim/match.ts';
import type { Match, MatchCfg, Scheme } from '../runtime/src/core/sim/match.ts';
import { F, PH, ST, W, fighterBase } from '../runtime/src/core/sim/layout.ts';
import { createCpu, createBrainCpu, levelProfile } from '../runtime/src/core/ai/cpu.ts';
import type { Cpu } from '../runtime/src/core/ai/cpu.ts';
import { createPersona } from '../runtime/src/core/ai/personas.ts';
import type { Brain, BrainStats } from '../runtime/src/core/ai/brain.ts';
import { buildKit } from '../runtime/src/core/ai/kit.ts';
import { INPUT } from '../runtime/src/core/config.ts';
import { M } from '../runtime/src/core/sim/units.ts';

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
  /** CHANGED(wf7 season bot): the SeasonBot side's counters, when one played */
  bot?: SeasonBotTs['stats'];
}

const DEG = 180 / Math.PI;

export function runBout(data: GameData, cfg: MatchCfg, cpus: [BoutPlayer, BoutPlayer], maxF = 40000): BoutOut {
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
  // CHANGED(wf7 season bot): the SeasonBot's own counters (read steps, side punishes, circle-walks)
  for (let k = 0; k < 2; k++) {
    const c = cpus[k];
    if (c instanceof SeasonBotPlayer) out.bot = { ...c.bot.stats };
  }
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

export type PlayerKind = 'cpu6' | 'optimal' | 'novice' | 'seasonbot';
export function playerCpu(kind: PlayerKind, fighter: string, seed: number): Cpu {
  if (kind === 'cpu6') return createCpu(6, fighter, seed);
  if (kind === 'seasonbot') throw new Error('playerCpu: the seasonbot is not a Cpu - use playerFor()');
  return createPersona(kind, fighter, seed);
}

/** CHANGED(wf7 season bot): any player kind as a bout player ('seasonbot' = the playtest.py SeasonBot mirror vs `opp`) */
export function playerFor(data: GameData, kind: PlayerKind, fighter: string, opp: string, seed: number): BoutPlayer {
  if (kind === 'seasonbot') return new SeasonBotPlayer(data, fighter, opp);
  return playerCpu(kind, fighter, seed);
}

/** one SEASON-style bout: the player (P1) vs the CPU at `level` (P2) on the opponent's home stage, arcade rules */
export function seasonBout(data: GameData, player: PlayerKind, fighter: string, opp: string, level: number, seed: number, stage?: string): BoutOut {
  const cfg: MatchCfg = {
    mode: 'arcade', stage: stage ?? homeStage(data, opp), seed,
    p: [{ fighter, color: 0, scheme: 0 as Scheme, cpu: -1 }, { fighter: opp, color: opp === fighter ? 1 : 0, scheme: 0 as Scheme, cpu: level }],
  };
  return runBout(data, cfg, [playerFor(data, player, fighter, opp, cpuSeed(seed, 0)), createCpu(level, opp, cpuSeed(seed, 1))]);
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

// ------------------------------------------------------------------ the SeasonBot mirror (CHANGED(wf7 season bot))
/** the SeasonBot's range numbers (metres, rounded to 0.1 mm - playtest.py reads exactly these through `--geom`) */
export interface BotGeom {
  me: string;
  opp: string;
  /** both push fronts: the closest root distance the push bodies allow */
  touch: number;
  /** the opponent's standing hurt front (a strike connects from reach + this) */
  opHurt: number;
  /** my throw: push-front gap it catches from */
  throwGap: number;
  /** the ASSIST route's opener (SIMPLE assist[0]) and its reach = box front + travel (kit.ts strikeGeometry) */
  open: string;
  openReach: number;
  /** the side-punish button (5H) */
  side: string;
  sideReach: number;
  /** SIMPLE S+H (Lv1) / S+H+2 (Lv3); reach 0 = not a strike (grab / projectile: the bot uses its punish range) */
  sup1: string;
  sup1Reach: number;
  sup3: string;
  sup3Reach: number;
  /** each opponent command grab -> the root distance it catches from (push fronts + its gap, or its centre reach) */
  opGrab: Record<string, number>;
}

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function botGeom(data: GameData, me: string, opp: string): BotGeom {
  const m = createMatch({
    mode: 'training', stage: 'rust_theater', seed: 1,
    p: [{ fighter: me, color: 0, scheme: 0 as Scheme, cpu: -1 }, { fighter: opp, color: opp === me ? 1 : 0, scheme: 0 as Scheme, cpu: -1 }],
  }, data);
  const a = m.cf[0];
  const o = m.cf[1];
  const kit = buildKit(data, a, 0);
  const reachOf = (id: string): number => {
    const mi = kit.moves.find((x) => x.id === id);
    return mi ? r4(mi.reach / M) : 0;
  };
  const simple = (data.fighters[me] as unknown as { simple?: Record<string, unknown> }).simple ?? {};
  const assist = Array.isArray(simple.assist) ? (simple.assist as string[]) : [];
  const open = assist[0] ?? '5L';
  const sup1 = typeof simple['S+H'] === 'string' ? (simple['S+H'] as string) : '';
  const sup3 = typeof simple['S+H+2'] === 'string' ? (simple['S+H+2'] as string) : '';
  const touch = r4((a.pushFS + o.pushFS) / M);
  const thr = a.moves.find((x) => x.id === 'throw_f');
  const throwGap = thr && thr.grabGap >= 0 ? r4(thr.grabGap / M) : r4(Number((data.fighters[me] as unknown as { throwRangeM?: number }).throwRangeM ?? 0.6));
  const opGrab: Record<string, number> = {};
  for (const mv of o.moves) {
    if (mv.kindStr !== 'cmdgrab') continue;
    opGrab[mv.id] = mv.grabGap >= 0 ? r4(touch + mv.grabGap / M) : r4((mv.grabReach + a.pushFS) / M);
  }
  return {
    me, opp, touch, opHurt: r4(o.hurtFS / M), throwGap, open, openReach: reachOf(open), side: '5H', sideReach: reachOf('5H'),
    sup1, sup1Reach: sup1 ? reachOf(sup1) : 0, sup3, sup3Reach: sup3 ? reachOf(sup3) : 0, opGrab,
  };
}

interface OppMove { startup?: number; active?: number; guard?: string; homing?: boolean }
const HIT_STATES = ['knockdown', 'hitstun', 'juggle', 'blockstun', 'wall_splat', 'crumple', 'dizzy'];
const FREE_STATES = ['idle', 'walk_f', 'walk_b'];
const sqrtDist = (a: { x: number; z?: number }, b: { x: number; z?: number }): number => {
  const dx = a.x - b.x;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dz * dz);
};

/**
 * The headless mirror of playtest.py SeasonBot.keys (the real-key G11 persona, CONTRACT §35.25 item 4 fixed): the same
 * rules in the same order on the same snapshots (readFighter / readMatch = __HP__.fighters() / match()), keys -> the
 * input bits the keyboard produces (P1 SIMPLE). Keep the two in step: playtest.py --bosses vs `--botbouts` replays it.
 */
export class SeasonBotTs {
  readonly stats = { stepReads: 0, sidePunish: 0, circles: 0, wallCircles: 0 };
  private phase = 0;
  private n = 0;
  private circle = 0;
  private circleKey = 0;
  private circleCool = 0;
  private stepCool = 0;
  private punish = 0;
  private readonly moves: Record<string, OppMove>;
  readonly touch: number;
  readonly closeD: number;
  readonly throwD: number;
  readonly punishD: number;
  readonly sideD: number;
  readonly sup1D: number;
  readonly sup3D: number;
  readonly aaD: number;
  readonly midLo: number;
  readonly midHi: number;
  readonly me: string;
  readonly opp: string;
  readonly g: BotGeom;
  constructor(data: GameData, me: string, opp: string, geom?: BotGeom) {
    this.me = me;
    this.opp = opp;
    const g = geom ?? botGeom(data, me, opp);
    this.g = g;
    this.moves = ((data.fighters[opp] as unknown as { moves?: Record<string, OppMove> }).moves) ?? {};
    const touch = g.touch;
    const openR = g.openReach + g.opHurt;
    this.touch = touch;
    this.closeD = Math.max(touch + 0.10, Math.min(openR - 0.12, touch + 0.45));
    this.throwD = touch + g.throwGap - 0.08;
    this.punishD = Math.max(this.closeD, openR - 0.05);
    this.sideD = g.sideReach > 0 ? g.sideReach + g.opHurt - 0.05 : this.punishD;
    this.sup1D = g.sup1Reach > 0 ? g.sup1Reach + g.opHurt - 0.05 : this.punishD;
    this.sup3D = g.sup3Reach > 0 ? g.sup3Reach + g.opHurt - 0.05 : this.punishD;
    this.aaD = Math.max(2.0, touch + 1.0);
    this.midLo = touch + 0.6;
    this.midHi = touch + 1.8;
  }

  private grabThreat(name: string, okind: string): number {
    if (okind === 'cmdgrab') return (this.g.opGrab[name] ?? this.touch + 1.0) + 0.25;
    return this.touch + 0.9;
  }

  private wallBehind(me: FighterSnap, op: FighterSnap, m: MatchSnap): boolean {
    const rg = m.ring;
    if (!rg || !rg.centre || !rg.radius) return false;
    const c = rg.centre;
    const mx = me.x - c[0], mz = (me.z ?? 0) - c[1];
    const ox = op.x - c[0], oz = (op.z ?? 0) - c[1];
    const rme = Math.sqrt(mx * mx + mz * mz);
    const rop = Math.sqrt(ox * ox + oz * oz);
    return rme > rg.radius - 1.1 && rop < rme - 0.3;
  }

  keys(f: [FighterSnap, FighterSnap], m: MatchSnap): number {
    const I = INPUT;
    const me = f[0], op = f[1];
    if (m.phase !== 'fight') {
      this.circle = 0;
      return 0;
    }
    this.n += 1;
    this.phase ^= 1;
    const d = sqrtDist(me, op);
    const fk = (me.facing ?? 1) >= 0 ? I.RIGHT : I.LEFT;
    const bk = (me.facing ?? 1) >= 0 ? I.LEFT : I.RIGHT;
    const st = me.stateName, ost = op.stateName;
    if (this.stepCool > 0) this.stepCool -= 1;
    if (this.circleCool > 0) this.circleCool -= 1;
    const act = !!me.actionable;
    if (st === 'thrown') {
      this.circle = 0;
      return this.phase ? I.THROW : 0;
    }
    if (HIT_STATES.includes(st)) {
      this.circle = 0;
      return bk | I.DOWN;
    }
    const mv = this.moves[op.moveName || ''] ?? {};
    const okind = op.moveKind || '';
    const of = op.moveFrame || 0;
    const su = Math.trunc(mv.startup || 0);
    const ac = Math.trunc(mv.active || 0);
    const strike = ost === 'attack' && !['throw', 'cmdgrab', 'system', ''].includes(okind);
    const incoming = strike && of <= su + ac + 1 && d < 3.2;
    const grabbing = ost === 'attack' && (okind === 'throw' || okind === 'cmdgrab') && of <= su;
    if (this.circle > 0) {
      this.circle -= 1;
      if (incoming || grabbing) this.circle = 0;
      else return this.circleKey;
    }
    if (grabbing && d < this.grabThreat(op.moveName || '', okind)) return okind === 'cmdgrab' ? I.UP | bk : I.THROW;
    if (strike && act && this.stepCool === 0 && of <= 4 && su >= 10 && !mv.homing && d < 3.0 && (this.n * 37) % 100 < 55) {
      this.stepCool = 20;
      this.punish = 30;
      this.stats.stepReads++;
      return Math.floor(this.n / 7) % 2 ? I.STEP_IN : I.STEP_OUT;
    }
    if (this.punish > 0) {
      this.punish -= 1;
      if (act && ost === 'attack' && su > 0 && of > su + ac && d <= this.sideD) {
        this.punish = 0;
        this.stats.sidePunish++;
        return I.H;
      }
    }
    if (incoming) {
      const over = mv.guard === 'H' || op.airborne;
      return over ? bk : bk | I.DOWN;
    }
    for (const p of m.proj ?? []) {
      if (p.owner === 1 && (p.kind === 0 || p.kind === 1)) {
        const rx = me.x - p.x, rz = (me.z ?? 0) - (p.z ?? 0);
        const toward = rx * (p.vx || 0) + rz * (p.vz || 0) > 0;
        if (toward && Math.sqrt(rx * rx + rz * rz) < 2.6) return bk | I.DOWN;
      }
    }
    if (op.airborne && (ost === 'air' || ost === 'prejump') && d < this.aaD) return this.phase ? I.DOWN | I.S : I.DOWN;
    if (!act) return 0;
    const recovering = (ost === 'attack' && su > 0 && of > su + ac - 1) || ['land', 'recover', 'parry_rec', 'dash_b'].includes(ost);
    if (recovering && d <= this.punishD) {
      const sh = me.showtime || 0;
      if (sh >= 30000 && d <= this.sup3D) return I.DOWN | I.S | I.H;
      if (sh >= 10000 && d <= this.sup1D) return I.S | I.H;
      return this.phase ? I.ASSIST | I.L : I.ASSIST;
    }
    if (ost === 'knockdown') return d > this.touch + 0.35 ? fk : bk | I.DOWN;
    if (FREE_STATES.includes(st) && this.circleCool === 0) {
      const wall = this.wallBehind(me, op, m);
      if (wall || (this.midLo < d && d < this.midHi && this.n % 120 === 60)) {
        this.circle = 25 + (this.n % 16);
        this.circleKey = Math.floor(this.n / 3) % 2 ? I.STEP_OUT : I.STEP_IN;
        this.circleCool = 90;
        if (wall) this.stats.wallCircles++;
        else this.stats.circles++;
        return this.circleKey;
      }
    }
    if (d > this.closeD) return fk;
    const t = ((Math.trunc((me.x || 0) * 97 + (m.frame || 0)) % 10) + 10) % 10;
    if (t === 9 && FREE_STATES.includes(st) && d > this.touch + 0.3) return Math.floor(this.n / 2) % 2 === 0 ? I.STEP_IN : I.STEP_OUT;
    if (t < 5) return this.phase ? I.ASSIST | I.L : I.ASSIST;
    if (t < 7 && d <= this.throwD) return this.phase ? I.THROW : 0;
    return bk | I.DOWN;
  }
}

/** anything runBout can drive (a Cpu, or the SeasonBot) */
export interface BoutPlayer {
  input(m: Match, playerIndex: number): number;
  readonly brain?: Brain | null;
}

/**
 * The SeasonBot as a bout player: a decision every 2 frames from the first FIGHT frame (playtest.py steps the frozen sim 2
 * frames per decision; playtest.py --bosses steps to that first FIGHT frame before its first decision), held between.
 */
export class SeasonBotPlayer implements BoutPlayer {
  readonly bot: SeasonBotTs;
  readonly brain = null;
  private f0 = -1;
  private held = 0;
  constructor(data: GameData, me: string, opp: string) {
    this.bot = new SeasonBotTs(data, me, opp);
  }
  input(m: Match, i: number): number {
    const ms = readMatch(m);
    if (this.f0 < 0) {
      if (ms.phase !== 'fight') return 0;
      this.f0 = ms.frame;
    }
    if ((ms.frame - this.f0) % 2 === 0) this.held = this.bot.keys([readFighter(m, i), readFighter(m, 1 - i)], ms);
    return this.held;
  }
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
  // CHANGED(wf7 season bot): `--geom <me> <opp>` = the SeasonBot's range numbers as one JSON line (playtest.py reads it)
  const gi = args.indexOf('--geom');
  if (gi >= 0) {
    console.log(JSON.stringify(botGeom(loadGameData(), args[gi + 1] ?? 'johnny', args[gi + 2] ?? 'freak')));
    process.exit(0);
  }
  // `--botbouts <me> <opp> <level> <stage> <seed,seed,...>` = the SeasonBot mirror vs CPU <level>, arcade staging (the
  // bouts playtest.py --bosses plays with real keys: same cfg, same CPU seed, a decision every 2 frames from FIGHT)
  const bi = args.indexOf('--botbouts');
  if (bi >= 0) {
    const data = loadGameData();
    const [me, opp, lvS, stage, seedsS] = args.slice(bi + 1, bi + 6);
    const lv = Number(lvS);
    let w = 0;
    const seeds = (seedsS ?? '1').split(',').map(Number);
    for (const sd of seeds) {
      const r = seasonBout(data, 'seasonbot', me, opp, lv, sd, stage);
      if (r.winner === 0) w++;
      console.log(JSON.stringify({ me, opp, level: lv, stage, seed: sd, winner: r.winner, wins: r.wins, frames: r.frames, hp: r.hp, bot: r.bot }));
    }
    console.log(`seasonbot ${me} vs ${opp} L${lv} on ${stage}: won ${w} / ${seeds.length}`);
    process.exit(0);
  }
  // smoke (run_probes, no args): THE FREAK / RICKY at NORMAL, the novice vs slot 1, ring L4 - about a minute
  const only = (arg('--only') ?? (FULL ? 'bosses,ladder,novice,ring,ringflat' : 'bosses,novice,ring')).split(',');
  const NSEED = Number(arg('--seeds') ?? (FULL ? 24 : 4));
  const playersArg = arg('--player') ?? (FULL ? 'all' : 'cpu6');
  const players: PlayerKind[] = playersArg === 'both' ? ['cpu6', 'optimal'] : playersArg === 'all' ? ['cpu6', 'optimal', 'seasonbot']
    : (playersArg.split(',') as PlayerKind[]);
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
  // CHANGED(wf7 season bot): B5 - the G11 persona (playtest.py SeasonBot, its headless mirror) can clear THE SEASON
  const sb = bossRate.seasonbot;
  if (sb && sb['freak@normal'] && sb['ricky@normal']) {
    const fr = sb['freak@normal'];
    const ri = sb['ricky@normal'];
    ok(ROSTER10.every((f) => fr[f] >= 25), `B5a the SeasonBot beats THE FREAK at NORMAL >= 25% with every contestant (min ${Math.min(...ROSTER10.map((f) => fr[f]))}%: ${ROSTER10.map((f) => `${f} ${fr[f]}`).join(' ')}; average ${fr.ALL}%)`);
    ok(ri.ALL <= fr.ALL, `B5b RICKY (${ri.ALL}%) not easier than THE FREAK (${fr.ALL}%) for the SeasonBot at NORMAL (per contestant RICKY: ${ROSTER10.map((f) => `${f} ${ri[f]}`).join(' ')})`);
    if (slotRate.seasonbot) note(`SeasonBot slots ${Object.keys(slotRate.seasonbot).map((lv) => `L${lv} ${slotRate.seasonbot[Number(lv)]}%`).join(', ')} vs THE FREAK ${fr.ALL}% / RICKY ${ri.ALL}% at NORMAL (frame-exact guard: rates overstate a human's; the ORDER is the signal)`);
  }
  if (!FULL && only.includes('bosses') && !sb) {
    // the smoke: the V1 regression guard (WF6: the bot never attacked a big body - 0 / 22 vs THE FREAK)
    const SL = seasonLevels(data);
    const res: Record<string, number> = {};
    for (const [boss, lv] of [['freak', SL.miniboss], ['ricky', SL.boss]] as [string, number][]) {
      let w = 0;
      for (let k = 1; k <= 4; k++) if (seasonBout(data, 'seasonbot', 'johnny', boss, lv, 700 + 13 * k).winner === 0) w++;
      res[boss] = w;
    }
    ok(res.freak >= 1, `B5 smoke: the SeasonBot johnny beats THE FREAK (L${SL.miniboss}) ${res.freak}/4 (>= 1; RICKY L${SL.boss} ${res.ricky}/4)`);
  }
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
