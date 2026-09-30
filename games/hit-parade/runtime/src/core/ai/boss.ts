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
//   CHANGED(AI) P2 (the sim has the uniques now, CONTRACT §28): the phase is read from the boss's OWN unique int u0
//   (the sim's phase flag, which also switches the brain to the phase-2 recipe table); phase 2 zones with PYRO (the
//   fighter JSON `cpu.phase2` list) and its Lv3 is SEASON FINALE (the phase-2 route's Lv3). THE FREAK approaches with
//   its armored CRUSHER LEAP from leap range, answers a reacted projectile with ROAR (projectile-invulnerable) and
//   spends a bar on MELTDOWN (armor 99) as a read vs a presser.
// Hooks: react / neutral / aggressionBonus / phase. New bosses add a case in bossTools().

import type { CMove } from '../sim/compile.ts';
import { ST } from '../sim/layout.ts';
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
  neutral(b: Brain): Decision | null {
    const s = b.seen;
    const d = s.dist;
    const kit = b.kit;
    const armored = kit.lists.armor.filter((k) => b.canUse(k) && !kit.moves[k].proj);
    // a projectile coming (reacted): an armored / projectile-invulnerable special through it
    const eta = b.projEta();
    if (eta < 999 && eta >= 6) {
      for (const k of kit.moves) {
        if (!k.special || k.proj || !b.canUse(k.idx) || k.ex) continue;
        const lag = b.rcpLag(k.idx);
        if (k.projInv0 > 0 && k.projInv0 <= lag + 2 && k.projInv1 >= eta && b.rnd() < 0.5) return { t: 'move', idx: k.idx };
      }
    }
    // leap range: the armored overhead leap (its armor covers the startup)
    if (d > 170000 && d < 330000 && b.rnd() < 0.18) {
      const leap = armored.filter((k) => kit.moves[k].overhead && kit.moves[k].special && b.inReach(k));
      if (leap.length > 0) return { t: 'move', idx: leap[0] };
    }
    // a bar of armor-99 super vs a presser inside its buttons
    const op = s.op;
    const opFree = op.st === ST.IDLE || op.st === ST.CROUCH || op.st === ST.WALK_F || op.st === ST.WALK_B;
    // an armor-from-frame-1 special as a read vs a presser in its range (armor through its next button)
    if (opFree && d <= b.opThreatU() && b.rnd() < 0.2 * b.habits.attackRate * b.profile.habit) {
      const rd = kit.moves.filter((mi) => mi.special && !mi.ex && !mi.proj && mi.armored && mi.cm.armorF0 <= 1 && b.canUse(mi.idx) && b.inReach(mi.idx));
      if (rd.length > 0) return { t: 'move', idx: rd[Math.floor(b.rnd() * rd.length)].idx };
    }
    if (kit.sup1 >= 0 && opFree && d <= b.opThreatU() && b.canUse(kit.sup1) && kit.moves[kit.sup1].cm.armorHits > 10 && b.inReach(kit.sup1)) {
      if (b.rnd() < 0.25 * b.habits.attackRate * b.profile.habit) return { t: 'move', idx: kit.sup1 };
    }
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
    // CHANGED(AI) P2: only a counter whose catch window covers the incoming active frames (uniques.ts timing)
    const k = b.uniq.react(b, cm, b.seen.op.mvF, 0);
    return k >= 0 && counterLive(b.kit.moves[k].cm) ? k : -1;
  }
  neutral(b: Brain): Decision | null {
    // the showman's SPOTLIGHT from mid range (his fights happen at 1-2 m, inside the shoto style's far zoning line);
    // phase 2: the set is live - PYRO fire lines too (the fighter JSON cpu.phase2 projectiles)
    const d = b.seen.dist;
    if (d < 190000 || b.projEta() < 999) return null;
    const p2 = this.phase(b) === 2;
    const pyro = p2 ? b.kit.lists.phase2.filter((k) => b.kit.moves[k].proj && b.canUse(k)) : [];
    if (pyro.length > 0 && b.rnd() < 0.15) return { t: 'move', idx: pyro[Math.floor(b.rnd() * pyro.length)] };
    const spot = b.kit.lists.zoning.filter((k) => b.canUse(k));
    if (spot.length > 0 && b.rnd() < 0.08) return { t: 'move', idx: spot[0] };
    return null;
  }
  phase(b: Brain): number {
    // CHANGED(AI) P2: the sim's phase flag (own unique int u0 of a `phases` kit); the HP rule before the sim had it
    const me = b.seen.me;
    if (b.kit.uk === 7) return me.uq[0] === 2 ? 2 : 1;
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
