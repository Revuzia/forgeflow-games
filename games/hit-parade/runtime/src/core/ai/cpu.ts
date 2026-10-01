// HIT PARADE - the CPU opponent (lane AI, CONTRACT §11, §16: createCpu(level, fighterId, seed) ->
// Cpu.input(m, playerIndex) returning a 16-bit §4.4 input word). THREE-free, DOM-free, clock-free.
//
// Levels 0-8 are data/cpu.json `levels` (FIGHTING_DESIGN §10 table verbatim: reaction delay to a
// VISIBLE startup, block chance once reacted, guess adaptation, anti-air, punish chance + route, throw
// tech guess, parry use, meter use, NERVE management, execution drops, aggression; L0 = the TUTOR band).
// The game plan comes from the fighter's `cpu.style` (plans.ts), the boss tools from `cpu.json` `boss`
// (boss.ts). The table is read from the match's GameData (`data/cpu.json` through core/data.ts); the same
// file is also bundled here as the fallback for GameData built without it (fixtures).
//
// Determinism: the CPU's randomness is one mulberry32 stream seeded by `seed`; it reads the match only
// through sense.ts (visible state, never the opponent's inputs) and must be called exactly once per sim
// frame, before step (game.ts does). It never runs online (both players are human there).

import CPU_JSON from '../../../../data/cpu.json' with { type: 'json' };
import type { Match } from '../sim/state.ts';
import { Brain, DEFAULT_STYLE, METER_TIERS, NERVE_TIERS, PARRY_TIERS, ROUTE_KINDS } from './brain.ts';
import type { NeutralPlanner, Profile, StyleParams } from './brain.ts';
import { neutralPlan } from './plans.ts';
import { bossTools } from './boss.ts';
import { UniqueTools, uniqueRates } from './uniques.ts';
import { WORD_MASK } from './pad.ts';

export interface Cpu {
  readonly level: number;
  readonly fighter: string;
  /** the §4.4 input word for `playerIndex` this frame (call once per sim frame, before step) */
  input(m: Match, playerIndex: number): number;
  /**
   * optional warm-up (CHANGED(AI), additive): binds to the match and measures the fighter's input recipes
   * (kit.ts sandbox, 3-60 ms once per fighter + scheme per GameData, cached) so the first input() call of
   * a bout does not pay it. Call after createMatch while the loading card is up. Never changes the state.
   */
  prepare(m: Match, playerIndex: number): void;
  readonly brain: Brain;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** the cpu.json in use: the match's GameData copy when it has levels, else the bundled file */
export function cpuTable(m?: Match | null): Obj {
  const d = m && isObj(m.data.cpu) ? (m.data.cpu as Obj) : null;
  if (d && Array.isArray(d.levels) && d.levels.length > 0) return d;
  return CPU_JSON as unknown as Obj;
}

function n(o: Obj, k: string, d: number): number {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function tier(list: readonly string[], v: unknown, d: number): number {
  const k = typeof v === 'string' ? list.indexOf(v) : -1;
  return k >= 0 ? k : d;
}

/** Resolves one profile row (a level or a persona) against the table's rules. */
export function resolveProfile(row: Obj, table: Obj, name: string, level: number): Profile {
  const rules = isObj(table.rules) ? table.rules : {};
  const share = isObj(rules.parryShare) ? rules.parryShare : {};
  const adapt = isObj(rules.adaptAggression) ? rules.adaptAggression : {};
  const press = isObj(rules.press) ? rules.press : {};
  const parry = tier(PARRY_TIERS, row.parry, 0);
  const adaptAggro = row.aggression === 'adapts';
  const floor = n(rules, 'reactFloor', 18);
  const reactRaw = n(row, 'reactF', 36);
  return {
    name,
    level,
    // personas may be faster than the floor (the harness 'optimal'); CPU levels never are
    reactF: level >= 0 ? Math.max(floor, reactRaw) : Math.max(1, reactRaw),
    block: n(row, 'block', 0.4),
    guessAdapt: n(row, 'guessAdapt', 0),
    antiAir: n(row, 'antiAir', 0.3),
    punish: n(row, 'punish', 0.3),
    route: tier(ROUTE_KINDS, row.route, 1),
    tech: n(row, 'tech', 0),
    parry,
    meter: tier(METER_TIERS, row.meter, 0),
    nerve: tier(NERVE_TIERS, row.nerve, 0),
    drop: n(row, 'drop', 0.2),
    aggression: adaptAggro ? n(adapt, 'base', 0.6) : n(row, 'aggression', 0.4),
    adaptAggro,
    guard: n(row, 'guard', 0.3),
    respect: n(row, 'respect', 0),
    // CHANGED(AI) P2: habit weight (cpu.json levels / personas `habit`, habits.ts); default by level when a row lacks it
    habit: n(row, 'habit', level >= 0 ? Math.min(0.85, 0.3 + 0.07 * level) : 0.5),
    thinkF: Math.max(1, Math.round(n(row, 'thinkF', 16))),
    delayF: Math.max(0, Math.round(n(row, 'delayF', 0))),
    antiZone: n(row, 'antiZone', 0),
    parryShare: n(share, PARRY_TIERS[parry], 0),
    slowStartup: n(rules, 'slowStrikeStartup', 14),
    whiffReactPct: n(rules, 'whiffReactPct', 50),
    counterImpactNerve: n(rules, 'counterImpactNerve', 1),
    avoidFrightNerve: n(rules, 'avoidFrightNerve', 2),
    adapt: { base: n(adapt, 'base', 0.6), span: n(adapt, 'span', 0.25), min: n(adapt, 'min', 0.4), max: n(adapt, 'max', 0.8) },
    backRise: n(rules, 'backRise', 0.25),
    wakeReversal: n(rules, 'wakeReversal', 0.2),
    press: {
      rate: n(press, 'rate', 0.1),
      windowF: Math.max(2, Math.round(n(press, 'windowF', 32))),
    },
    // CHANGED(AI3D) (CONTRACT §35.9 / §35.17): the 3D ring levers (default 0 = off: no roll, no sandbox run)
    step: n(row, 'step', 0),
    stepGuess: n(row, 'stepGuess', 0),
    circle: n(row, 'circle', 0),
    antiStep: n(row, 'antiStep', 0),
  };
}

/** Level `level` (clamped 0..8) of the table. */
export function levelProfile(level: number, table: Obj = CPU_JSON as unknown as Obj): Profile {
  const rows = Array.isArray(table.levels) ? (table.levels as unknown[]).filter(isObj) : [];
  const lv = Math.max(0, Math.min(8, Math.round(Number.isFinite(level) ? level : 0)));
  const row = rows.find((r) => r.level === lv) ?? rows[lv] ?? {};
  return resolveProfile(row, table, typeof row.name === 'string' ? row.name : `L${lv}`, lv);
}

/** style table (cpu.json `styles`) resolved to StyleParams */
export function styleTable(table: Obj): Record<string, StyleParams> {
  const out: Record<string, StyleParams> = {};
  const src = isObj(table.styles) ? table.styles : {};
  for (const k of Object.keys(src)) {
    const o = src[k];
    if (!isObj(o)) continue;
    const st: StyleParams = { ...DEFAULT_STYLE };
    for (const f of Object.keys(DEFAULT_STYLE) as (keyof StyleParams)[]) {
      const v = o[f];
      if (f === 'charge') st.charge = v === true;
      else if (typeof v === 'number' && Number.isFinite(v)) (st as unknown as Record<string, number>)[f] = v;
    }
    out[k] = st;
  }
  return out;
}

class LevelCpu implements Cpu {
  readonly level: number;
  readonly fighter: string;
  readonly brain: Brain;
  private configured = false;

  constructor(level: number, fighter: string, seed: number) {
    this.level = Math.max(0, Math.min(8, Math.round(Number.isFinite(level) ? level : 0)));
    this.fighter = fighter;
    this.brain = new Brain(levelProfile(this.level), seed);
  }

  prepare(m: Match, playerIndex: number): void {
    this.configure(m, playerIndex);
    if (!this.brain.bound || this.brain.m !== m || this.brain.i !== playerIndex) this.brain.bind(m, playerIndex);
  }

  input(m: Match, playerIndex: number): number {
    const mode = m.cfg.mode;
    if (mode === 'brawl' || mode === 'heckler' || mode === 'online') return 0;
    this.configure(m, playerIndex);
    return this.brain.input(m, playerIndex) & WORD_MASK; // CHANGED(AI3D): bits 13 / 14 (STEP) reach the sim
  }

  private configure(m: Match, playerIndex: number): void {
    if (!this.configured) {
      this.configured = true;
      const table = cpuTable(m);
      const b = this.brain;
      // re-resolve against the match's own table (same numbers unless data/cpu.json was edited)
      Object.assign(b.profile, levelProfile(this.level, table));
      b.styleTable = styleTable(table);
      b.planner = neutralPlan;
      b.tools = bossTools(m.cfg.p[playerIndex].fighter, isObj(table.boss) ? table.boss : undefined);
      b.uniq = new UniqueTools(uniqueRates(table.uniques)); // CHANGED(AI) P2
      const rules = isObj(table.rules) ? table.rules : {};
      b.lv1Spend = n(rules, 'lv1Spend', 0.35);
      b.lv3Cash = n(rules, 'lv3Cash', 0.6);
    }
  }
}

/** §16: the CPU for `fighterId` at `level` (0..8), seeded. */
export function createCpu(level: number, fighterId: string, seed: number): Cpu {
  return new LevelCpu(level, fighterId, seed);
}

/** A brain with an explicit profile and planner (personas, tests). */
export function createBrainCpu(profile: Profile, fighter: string, seed: number, planner: NeutralPlanner | null, table?: Obj): Cpu {
  const brain = new Brain(profile, seed);
  const t = table ?? (CPU_JSON as unknown as Obj);
  brain.styleTable = styleTable(t);
  brain.planner = planner ?? neutralPlan;
  brain.uniq = new UniqueTools(uniqueRates(t.uniques)); // CHANGED(AI) P2
  return {
    level: profile.level,
    fighter,
    brain,
    input(m: Match, p: number): number {
      const mode = m.cfg.mode;
      if (mode === 'brawl' || mode === 'heckler' || mode === 'online') return 0;
      return brain.input(m, p) & WORD_MASK; // CHANGED(AI3D)
    },
    prepare(m: Match, p: number): void {
      if (!brain.bound || brain.m !== m || brain.i !== p) brain.bind(m, p);
    },
  };
}

export type { Profile, StyleParams };
