// HIT PARADE - boss tools for the CPU (lane AI, CONTRACT §11 "bosses get tools not reactions",
// FIGHTING_DESIGN §10 rules). THREE-free.
//
// A boss CPU is an ordinary level CPU (THE SEASON runs it at L6 on Normal, shifted by the difficulty)
// plus TOOLS. Tools change WHAT the boss does with a reaction it already earned - never how fast it
// reacts (the reaction floor stays the L8 18 f):
//   * armor  (THE FREAK): a reacted strike can be answered with an armored move from `cpu.armor` whose
//     armor window covers the incoming hit and which reaches back (armor through the poke) instead of a
//     block; + aggression.
//   * counter (RICKY MARQUEE): a reacted strike can be answered with the counter move from `cpu.counter`
//     (COMMERCIAL BREAK) - only once the sim implements the §20 `counter` block (the compiled move then
//     carries it); until then the tool stays off rather than whiffing a stance on purpose.
//   * phases (RICKY): below `thresholdPct` HP the boss plays phase 2 (more aggression); moves marked
//     `phase: 2` join automatically when the sim routes them (kit.ts measures what the sim accepts).
// Hooks: react / neutral / aggressionBonus / phase. New bosses add a case in bossTools().

import type { CMove } from '../sim/compile.ts';
import type { Brain, Decision } from './brain.ts';

export interface BossTools {
  readonly id: string;
  readonly tool: string;
  /** a reacted strike `cm` (latched roll `roll`): a move index to answer with instead of blocking, or -1 */
  react(b: Brain, cm: CMove, roll: number): number;
  /** optional neutral override (null = the normal game plan) */
  neutral(b: Brain): Decision | null;
  aggressionBonus(b: Brain): number;
  /** 1 or 2 */
  phase(b: Brain): number;
}

type Cfg = Record<string, unknown>;

function num(c: Cfg, k: string, d: number): number {
  const v = c[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** does the sim implement move-level counters (the compiled move carries the §20 counter block)? */
export function counterLive(cm: CMove): boolean {
  return (cm as unknown as { counter?: unknown }).counter !== undefined;
}

class ArmorTools implements BossTools {
  readonly id: string;
  readonly tool = 'armor';
  private rate: number;
  private aggro: number;
  constructor(id: string, c: Cfg) {
    this.id = id;
    this.rate = num(c, 'armorRate', 0.5);
    this.aggro = num(c, 'aggressionBonus', 0.1);
  }
  react(b: Brain, cm: CMove, roll: number): number {
    if (roll >= this.rate || cm.armorBreak || cm.nHid > 2 || cm.isImpact) return -1;
    const op = b.seen.op;
    const toHit = cm.startup - op.mvF; // frames until the incoming first active frame
    for (const idx of b.kit.lists.armor) {
      if (!b.canUse(idx)) continue;
      const mi = b.kit.moves[idx];
      if (mi.cm.armorHits < Math.max(1, cm.nHid)) continue;
      const lag = mi.recipe ? mi.recipe.lag : 1;
      const myF = toHit - lag + 1; // my move frame when the hit arrives
      if (myF < mi.cm.armorF0 || myF > mi.cm.armorF1) continue;
      if (!b.inReach(idx, b.seen.dist + 20000)) continue;
      return idx;
    }
    return -1;
  }
  neutral(): Decision | null {
    return null;
  }
  aggressionBonus(): number {
    return this.aggro;
  }
  phase(): number {
    return 1;
  }
}

class ShowmanTools implements BossTools {
  readonly id: string;
  readonly tool = 'counter';
  private rate: number;
  private threshold: number;
  private p2Aggro: number;
  constructor(id: string, c: Cfg) {
    this.id = id;
    this.rate = num(c, 'counterRate', 0.35);
    this.threshold = num(c, 'thresholdPct', 50);
    this.p2Aggro = num(c, 'phase2Aggression', 0.15);
  }
  react(b: Brain, cm: CMove, roll: number): number {
    if (roll >= this.rate || cm.isImpact) return -1;
    for (const idx of b.kit.lists.counter) {
      if (!b.canUse(idx) || !counterLive(b.kit.moves[idx].cm)) continue;
      return idx;
    }
    return -1;
  }
  neutral(): Decision | null {
    return null;
  }
  phase(b: Brain): number {
    const me = b.seen.me;
    return me.hp * 100 < me.hpMax * this.threshold ? 2 : 1;
  }
  aggressionBonus(b: Brain): number {
    return this.phase(b) === 2 ? this.p2Aggro : 0;
  }
}

/** Boss tools for `fighterId` from data/cpu.json `boss` (null = not a boss). */
export function bossTools(fighterId: string, boss: Record<string, unknown> | undefined): BossTools | null {
  const c = boss && typeof boss[fighterId] === 'object' && boss[fighterId] !== null ? (boss[fighterId] as Cfg) : null;
  if (!c) return null;
  const tool = typeof c.tool === 'string' ? c.tool : '';
  if (tool === 'armor') return new ArmorTools(fighterId, c);
  if (tool === 'counter') return new ShowmanTools(fighterId, c);
  return null;
}
