// VALE sim — final stats (CONTRACT §5.2).
//
//   final = (base + growth × (level − 1)) + items + buffs + boons/passives + form + team buffs,
//   then percent modifiers.
//
// Units of the StatBlock: `attackSpeed` is attacks/s in a def's `base` and a FRACTION bonus
// everywhere else (growth, items, buffs), so final AS = baseAS × (1 + Σ bonus), capped at 2.5.
// `critDamage` defaults to 1.75 when the def's base omits it; other sources add to it.
// `range` in blocks is BONUS attack range on top of the def's attack.range.
// Percent stage: moveSpeed × (1 + moveSpeedPct) × (1 + Σ haste) × (1 − strongest slow);
// armor/resist × (1 − shred) when positive; tenacity capped at 0.9; pen % capped at 1.
// Fighter/item `res` stats add to the resource pool max (ResourceDef.max + maxPerLevel).
//
// Results are cached on the entity; anything that changes an input calls markStatsDirty(e).

import type { Entity } from './entity.ts';
import type { World } from './world.ts';

export const ATTACK_SPEED_CAP = 2.5;
export const DEFAULT_CRIT_DAMAGE = 1.75;
export const TENACITY_CAP = 0.9;
/** moving units never drop below this (slows cannot pin someone in place; roots do that) */
export const MIN_MOVE_SPEED = 0.5;

export function markStatsDirty(e: Entity): void { e.statsDirty = true; }

/** recompute if dirty; cheap no-op otherwise */
export function computeStats(w: World, e: Entity): void {
  if (!e.statsDirty) return;
  e.statsDirty = false;
  const s = e.stats;
  s.reset();
  const lvl1 = Math.max(0, e.level - 1);
  const def = e.fighter ?? e.unit;
  let baseAS = 0;
  let hasCritBase = false;
  if (def) {
    s.addBlock(def.base);
    s.addBlock(def.growth, lvl1);
    baseAS = def.base.attackSpeed ?? 0;
    hasCritBase = def.base.critDamage !== undefined;
  }
  e.baseAd = s.ad;
  e.baseHp = s.hp;

  // passives (kit passive, item passives, boons, team-buff passives, unit passive)
  for (let i = 0; i < e.passives.length; i++) {
    const p = e.passives[i];
    if (!p.stats) continue;
    s.addBlock(p.def.stats);
    s.addBlock(p.def.statsPerLevel, lvl1);
  }
  // items
  const pl = e.player;
  if (pl && e.kind === 'fighter') {
    for (let i = 0; i < pl.items.length; i++) {
      const id = pl.items[i];
      if (!id) continue;
      const it = w.idx.items.get(id);
      if (it) s.addBlock(it.stats);
    }
  }
  // buffs
  for (let i = 0; i < e.buffs.length; i++) { const b = e.buffs[i]; if (b.stats) s.addBlock(b.stats, b.stacks); }
  // form
  let rangeBase = e.attackDef ? e.attackDef.range : 0;
  if (e.form && e.fighter) {
    const f = e.fighter.kit.passive.forms?.[e.form];
    if (f) { s.addBlock(f.stats); if (f.attackRange !== undefined) rangeBase = f.attackRange; }
  }
  // team buffs
  if (e.team >= 0 && e.team < w.teams.length) {
    const tb = w.teams[e.team].buffs;
    for (let i = 0; i < tb.length; i++) {
      if (e.kind === 'fighter') s.addBlock(tb[i].def.stats);
      else if (e.kind === 'minion') s.addBlock(tb[i].def.minionStats);
    }
  }

  // ── percent stage ──
  const bonusAS = s.attackSpeed - baseAS;
  s.attackSpeed = Math.min(ATTACK_SPEED_CAP, Math.max(0, baseAS * (1 + bonusAS)));
  if (!hasCritBase) s.critDamage += DEFAULT_CRIT_DAMAGE;
  s.crit = clamp01(s.crit);
  s.tenacity = Math.min(TENACITY_CAP, Math.max(0, s.tenacity));
  s.armorPenPct = clamp01(s.armorPenPct);
  s.magicPenPct = clamp01(s.magicPenPct);
  if (s.armor > 0 && e.armorShred > 0) s.armor *= 1 - e.armorShred;
  if (s.resist > 0 && e.resistShred > 0) s.resist *= 1 - e.resistShred;
  const flatMs = s.moveSpeed;
  let ms = flatMs * (1 + s.moveSpeedPct) * (1 + e.hastePow) * (1 - e.slowPow);
  if (flatMs > 0 && ms < MIN_MOVE_SPEED) ms = MIN_MOVE_SPEED;
  s.moveSpeed = Math.max(0, ms);
  s.range = rangeBase + s.range;

  // resource pool
  const r = e.resource;
  if (r) {
    if (r.model !== 'none') { s.res += r.max + r.maxPerLevel * lvl1; s.resRegen += r.regen + r.regenPerLevel * lvl1; }
    else { s.res = 0; s.resRegen = 0; }
  }

  // apply pools: growing max hp/res grants the difference (level ups, items); shrinking clamps
  const oldMax = e.maxHp;
  e.maxHp = Math.max(1, s.hp);
  if (e.alive && oldMax > 0 && e.maxHp > oldMax) e.hp += e.maxHp - oldMax;
  if (e.hp > e.maxHp) e.hp = e.maxHp;
  const oldRes = e.maxRes;
  e.maxRes = Math.max(0, s.res);
  if (r && r.model === 'pool' && oldRes > 0 && e.maxRes > oldRes) e.res += e.maxRes - oldRes;
  if (e.res > e.maxRes) e.res = e.maxRes;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** stats for every dirty entity (called at the top of the systems that read stats) */
export function refreshAllStats(w: World): void {
  const list = w.entities;
  for (let i = 0; i < list.length; i++) { const e = list[i]; if (e.statsDirty) computeStats(w, e); }
}
