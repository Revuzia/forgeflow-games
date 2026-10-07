// VALE bots — the economy track: ability level-ups and shopping (runs beside the modes, r09 §2.2).
//
// Level-up: the ult whenever it can rank up (RulesParams.abilityRanks.ultLevels); otherwise every
// basic ability gets its first rank early (kit unlocked by level 3), then ranks go by
// FighterDef.ai.comboOrder priority, then by the ability's ai.use priority (knowledge.ts).
//
// Shopping (whenever PlayerView.canShop — at base, dead in a base_or_dead mode, at a shared shop):
// a build plan derived from item TAGS and STATS scored for the fighter's ai.style and the stat its
// kit scales with (knowledge.buildPlan), restricted to rules.itemPool. Order: a starter (the jungle
// starter for a jungler) and one consumable at the start; boots once the first core item is done
// or the mid game starts, upgraded boots after the second; then core → apex items. A completed item
// is bought when sim.quoteBuy says it is affordable (owned components discount it), else its most
// valuable affordable missing component (recursively). A full inventory sells consumables, then
// starters, then wards to make room. Prices always come from quoteBuy; nothing is assumed.

import type { Command } from '../../contracts/sim.ts';
import type { Player } from '../entity.ts';
import { quoteBuy } from '../shop.ts';
import type { World } from '../world.ts';
import { abilityInfo, U_HEAL, type BuildPlan, type FighterProfile, type Knowledge } from './knowledge.ts';

const LEVEL_SLOTS = ['a1', 'a2', 'a3'] as const;

export class Economy {
  readonly k: Knowledge;
  readonly prof: FighterProfile;
  readonly plan: BuildPlan;
  private nextShopTick = 0;
  private startDone = false;
  private consumablesBought = 0;
  private wardBought = false;
  /** goals the shop refused for good (unique conflicts) */
  private readonly skip = new Set<string>();
  readonly support: boolean;

  constructor(k: Knowledge, prof: FighterProfile, plan: BuildPlan, support: boolean) {
    this.k = k; this.prof = prof; this.plan = plan; this.support = support;
  }

  /** one levelUp command when a skill point is free */
  levelUp(p: Player, out: Command[]): void {
    if (p.skillPoints <= 0) return;
    const ab = p.abilities;
    const ult = ab[3];
    if (ult && ult.canLevel) { out.push({ type: 'levelUp', slot: 'ult' }); return; }
    const lvl = p.ent ? p.ent.level : 1;
    if (lvl <= 4) {
      for (const s of this.prof.levelOrder) {
        const a = ab[LEVEL_SLOTS.indexOf(s)];
        if (a && a.canLevel && a.rank === 0) { out.push({ type: 'levelUp', slot: s }); return; }
      }
    }
    for (const s of this.prof.levelOrder) {
      const a = ab[LEVEL_SLOTS.indexOf(s)];
      if (a && a.canLevel) { out.push({ type: 'levelUp', slot: s }); return; }
    }
  }

  private owned(p: Player): Map<string, number> {
    // items held, plus everything they were built from (a finished item covers its components)
    const m = new Map<string, number>();
    const add = (id: string, depth: number): void => {
      m.set(id, (m.get(id) ?? 0) + 1);
      if (depth > 6) return;
      const it = this.k.idx.items.get(id);
      if (it) for (const c of it.components) add(c, depth + 1);
    };
    for (const id of p.items) if (id) add(id, 0);
    return m;
  }

  /** the completed item the bot is working toward (null: build done) */
  goal(w: World, p: Player): string | null {
    const plan = this.plan, own = this.owned(p);
    const has = (id: string): boolean => (own.get(id) ?? 0) > 0;
    const coreDone = plan.core.filter(has).length;
    const anyBoots = p.items.some((id) => !!id && this.k.idx.items.get(id)?.tier === 'boots');
    if (plan.boots.length > 0 && !anyBoots && (coreDone >= 1 || w.time > 480) && !this.skip.has(plan.boots[0])) return plan.boots[0];
    if (plan.boots.length > 1 && anyBoots && !has(plan.boots[1]) && coreDone >= 2 && !this.skip.has(plan.boots[1])) return plan.boots[1];
    for (const id of plan.core) if (!has(id) && !this.skip.has(id)) return id;
    return null;
  }

  /** the inventory as a multiset (only what sits in the bag: components inside a finished item are spent) */
  private bag(p: Player): Map<string, number> {
    const m = new Map<string, number>();
    for (const id of p.items) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }

  /**
   * Walk `goal`'s recipe the way the shop prices it (an owned component is consumed; a missing one is
   * looked for one level down): `buy` = the most valuable missing piece affordable now, `cheapest` =
   * the cheapest missing piece at all, `full` = a piece is affordable but the bag has no room.
   */
  private walk(w: World, p: Player, goal: string): { buy: string | null; cheapest: number; full: boolean } {
    const counts = this.bag(p);
    let buy: string | null = null, bestCost = -1, cheapest = Infinity, full = false;
    const visit = (id: string, depth: number): void => {
      const it = this.k.idx.items.get(id);
      if (!it || depth > 6) return;
      for (const c of it.components) {
        const n = counts.get(c) ?? 0;
        if (n > 0) { counts.set(c, n - 1); continue; }
        const cost = this.k.idx.items.get(c)?.cost ?? 0;
        const qc = quoteBuy(w, p, c, false);
        if (qc.price < cheapest) cheapest = qc.price;
        if (qc.ok) { if (cost > bestCost) { bestCost = cost; buy = c; } }
        else if (qc.reason === 'slots') full = true;
        visit(c, depth + 1);
      }
    };
    visit(goal, 0);
    return { buy, cheapest, full };
  }

  /** the next purchase toward `goal` that is affordable right now (null: none) */
  private step(w: World, p: Player, goal: string): { buy: string | null; full: boolean } {
    const q = quoteBuy(w, p, goal);
    if (q.ok) return { buy: goal, full: false };
    if (q.reason === 'unique' || q.reason === 'pool' || q.reason === 'unknown') { this.skip.add(goal); return { buy: null, full: false }; }
    if (q.reason === 'slots') return { buy: null, full: true };
    const r = this.walk(w, p, goal);
    return { buy: r.buy, full: r.buy === null && r.full };
  }

  /** the cheapest price that would make progress (for "go shopping" decisions) */
  nextPrice(w: World, p: Player): number {
    const g = this.goal(w, p);
    if (!g) return Infinity;
    const whole = quoteBuy(w, p, g, false);
    if (whole.reason === 'unique' || whole.reason === 'pool' || whole.reason === 'unknown') return Infinity;
    return Math.min(whole.price, this.walk(w, p, g).cheapest);
  }

  /** would a shop visit buy something right now (gold-wise)? */
  canBuyNow(w: World, p: Player): boolean {
    const g = this.goal(w, p);
    if (!g) return false;
    const whole = quoteBuy(w, p, g, false);
    if (whole.ok) return true;
    if (whole.reason !== 'gold' && whole.reason !== 'slots') return false;
    return this.walk(w, p, g).buy !== null || p.gold >= whole.price;
  }

  /** buy / sell while the shop is reachable; at most one command every few ticks */
  shop(w: World, p: Player, out: Command[]): void {
    if (!p.canShop || w.tick < this.nextShopTick) return;
    this.nextShopTick = w.tick + 6;
    const plan = this.plan;
    // opening purchase
    if (!this.startDone) {
      if (plan.starter && !p.items.includes(plan.starter) && quoteBuy(w, p, plan.starter).ok) { out.push({ type: 'buy', item: plan.starter }); this.startDone = true; return; }
      this.startDone = true;
    }
    const early = w.time < 360;
    if (plan.consumable && this.consumablesBought < (early ? 2 : 0) && p.gold >= 50) {
      const q = quoteBuy(w, p, plan.consumable);
      if (q.ok && p.gold - q.price >= (early ? 0 : 300)) { this.consumablesBought++; out.push({ type: 'buy', item: plan.consumable }); return; }
    }
    if (plan.ward && this.support && !this.wardBought && quoteBuy(w, p, plan.ward).ok && w.time > -1) {
      this.wardBought = true; out.push({ type: 'buy', item: plan.ward }); return;
    }
    const goal = this.goal(w, p);
    if (!goal) return;
    const st = this.step(w, p, goal);
    if (st.buy) { out.push({ type: 'buy', item: st.buy }); return; }
    if (st.full) {
      const slot = this.sellSlot(p);
      if (slot >= 0) out.push({ type: 'sell', slot });
    }
  }

  /** what to sell for room: consumables, starters, wards, then the cheapest off-plan item */
  private sellSlot(p: Player): number {
    let best = -1, bestRank = Infinity;
    for (let i = 0; i < p.items.length; i++) {
      const id = p.items[i];
      if (!id) continue;
      const it = this.k.idx.items.get(id);
      if (!it) continue;
      let rank: number;
      if (it.consumable) rank = 0;
      else if (it.tier === 'starter') rank = 1;
      else if (it.active && !it.stats.ad && !it.stats.ap && !it.stats.hp) rank = 2;
      else if (!this.plan.core.includes(id) && !this.plan.boots.includes(id) && it.tier === 'basic') rank = 3 + it.cost / 10000;
      else continue;
      if (rank < bestRank) { bestRank = rank; best = i; }
    }
    return best;
  }

  /** a consumable heal in the bag (item slot index) */
  static healItemSlot(k: Knowledge, p: Player): number {
    for (let i = 0; i < p.items.length; i++) {
      const id = p.items[i];
      const it = id ? k.idx.items.get(id) : undefined;
      if (it?.active && (abilityInfo(it.active).use & U_HEAL)) return i;
    }
    return -1;
  }
}
