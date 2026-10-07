// VALE sim — effect DSL interpreter (CONTRACT §5.3; catalog EffectT).
//
// Every op in EffectT is handled here (delivery ops hand off to projectiles.ts / zones.ts /
// movement.ts / spawn.ts, which own the ongoing simulation of what they spawn).
//
// Context and anchors: see EffectCtx in entity.ts. `to`: 'self' = caster, 'target' = the cast's
// unit target (falls back to hit), 'hit' = the unit the parent effect hit (falls back to target;
// a unit-targeted cast runs its top-level list with hit = target). Anchors fall back to the aimed
// point when their unit is missing.
//
// Scaling: `base[rank-1]` (Ranked arrays shorter than the rank repeat their last value) plus each
// ratio × the CASTER's stat, except `target*` ratios which read the unit the effect applies to.
// `perCounter` / `perMark` multiply the whole value by (stacks × per).
// Rank: abilities use their rank; battle spells and item actives use min(level, maxRank);
// passives, boons and item/team passives use the owner's level (see CONTRACT CHANGED(SIM) §5.3).
//
// Defaults worth knowing: filters default to enemies + fighters/minions/monsters/summons (never
// structures, wards or pickups unless `structures: true`); `repeat` runs its first iteration
// immediately and the rest every `interval` seconds while the caster lives (a death ends it for
// good, even if the caster respawns before the next one); a `cooldown` op's `percent` reduces the
// REMAINING cooldown; `gold` credits the caster's player, × goldMult and rounded.

import type { ConditionT, EffectT, ScalingT } from '../contracts/catalog.ts';
import type { EffectCtx, Entity, PresentT, SourceRef } from './entity.ts';
import type { SlotT } from '../contracts/catalog.ts';
import type { PlayerId, SimEvent } from '../contracts/sim.ts';
import { reduceCooldown } from './abilities.ts';
import { addResource, addShield, dealDamage, heal } from './combat.ts';
import { doBlink, displaceUnit, startDash } from './movement.ts';
import { spawnProjectiles } from './projectiles.ts';
import { getScript } from './scripts/index.ts';
import { computeStats } from './stats.ts';
import { summonUnits } from './spawn.ts';
import {
  addCounter, applyBuff, applyMark, applyStatus, counterValue, hasStatus, markStacks, setForm, takeMark,
} from './status.ts';
import { fireTrigger } from './triggers.ts';
import type { World } from './world.ts';
import { doArea, spawnZone } from './zones.ts';

/** nesting cap for effect lists (data is finite, but a projectile whose onHit spawns itself is not) */
export const MAX_EFFECT_DEPTH = 12;

type FilterT = { enemies?: boolean; allies?: boolean; self?: boolean; fighters?: boolean; minions?: boolean; monsters?: boolean; structures?: boolean; summons?: boolean };

// ── scaling ─────────────────────────────────────────────────────────────────────────────────────
export function ranked(v: number | readonly number[], rank: number): number {
  if (typeof v === 'number') return v;
  if (v.length === 0) return 0;
  let i = rank - 1;
  if (i < 0) i = 0; else if (i >= v.length) i = v.length - 1;
  return v[i];
}

export function resolveScaling(s: ScalingT, ctx: EffectCtx, target: Entity | null): number {
  if (typeof s === 'number') return s;
  const c = ctx.caster, cs = c.stats;
  let v = ranked(s.base, ctx.rank);
  if (s.ad) v += s.ad * cs.ad;
  if (s.bonusAd) v += s.bonusAd * (cs.ad - c.baseAd);
  if (s.ap) v += s.ap * cs.ap;
  if (s.maxHp) v += s.maxHp * c.maxHp;
  if (s.bonusHp) v += s.bonusHp * (c.maxHp - c.baseHp);
  if (s.armor) v += s.armor * cs.armor;
  if (s.resist) v += s.resist * cs.resist;
  if (s.maxRes) v += s.maxRes * c.maxRes;
  if (s.level) v += s.level * c.level;
  if (target) {
    if (s.targetMaxHp) v += s.targetMaxHp * target.maxHp;
    if (s.targetMissingHp) v += s.targetMissingHp * (target.maxHp - target.hp);
    if (s.targetCurrentHp) v += s.targetCurrentHp * target.hp;
  }
  if (s.perCounter) v *= counterValue(c, s.perCounter.counter) * s.perCounter.per;
  if (s.perMark) v *= (target ? markStacks(target, s.perMark.mark, c) : 0) * s.perMark.per;
  return v;
}

// ── context helpers ─────────────────────────────────────────────────────────────────────────────
export function makeCtx(caster: Entity, source: SourceRef, rank: number, target: Entity | null, px: number, py: number,
  present: PresentT | undefined, slot: SlotT | null, depth = 0): EffectCtx {
  let dx = px - caster.x, dy = py - caster.y;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l > 1e-6) { dx /= l; dy /= l; } else { dx = Math.cos(caster.facing); dy = Math.sin(caster.facing); }
  return { caster, rank, target, px, py, dx, dy, hit: target, ex: px, ey: py, hasEnd: false, source, present, depth, slot };
}
export function withHit(ctx: EffectCtx, hit: Entity): EffectCtx { return { ...ctx, hit, depth: ctx.depth + 1 }; }

export function resolveTo(ctx: EffectCtx, to: 'hit' | 'self' | 'target'): Entity | null {
  if (to === 'self') return ctx.caster;
  if (to === 'target') return ctx.target ?? ctx.hit;
  return ctx.hit ?? ctx.target;
}

/** anchor position into out (falls back to the aimed point) */
export function anchorPoint(ctx: EffectCtx, at: 'self' | 'target' | 'point' | 'hit' | 'end', out: { x: number; y: number }): void {
  let u: Entity | null = null;
  switch (at) {
    case 'self': u = ctx.caster; break;
    case 'target': u = ctx.target ?? ctx.hit; break;
    case 'hit': u = ctx.hit ?? ctx.target; break;
    case 'end': if (ctx.hasEnd) { out.x = ctx.ex; out.y = ctx.ey; return; } break;
    case 'point': break;
  }
  if (u) { out.x = u.x; out.y = u.y; } else { out.x = ctx.px; out.y = ctx.py; }
}
/** the unit an anchor refers to (zones that follow) */
export function anchorUnit(ctx: EffectCtx, at: 'self' | 'target' | 'point' | 'hit' | 'end'): Entity | null {
  if (at === 'self') return ctx.caster;
  if (at === 'target') return ctx.target ?? ctx.hit;
  if (at === 'hit') return ctx.hit ?? ctx.target;
  return null;
}

/**
 * Filter test from the caster's point of view. `live` also requires the candidate to be alive and
 * (for non-self) targetable — off for trigger subjects, which may be a fresh corpse.
 */
export function matchesFilter(w: World, caster: Entity, cand: Entity, f: FilterT | undefined, live = true): boolean {
  if (live && (!cand.alive || cand.removed)) return false;
  const rel = w.relation(caster, cand);
  if (rel === 0) { if (!(f?.self ?? false)) return false; }
  else if (rel === 1) { if (!(f?.allies ?? false)) return false; }
  else if (!(f?.enemies ?? true)) return false;
  if (live && rel !== 0 && !cand.targetable) return false;
  switch (cand.kind) {
    case 'fighter': return f?.fighters ?? true;
    case 'minion': return f?.minions ?? true;
    case 'monster': return f?.monsters ?? true;
    case 'structure': return f?.structures ?? false;
    case 'summon': return f?.summons ?? true;
    default: return false;
  }
}

/** a delivery (projectile, area, zone, dash pass, unit cast) touched a unit */
export function onEffectHit(w: World, ctx: EffectCtx, unit: Entity): void {
  const p = ctx.present;
  w.emit({ e: 'hit', t: w.time, src: ctx.caster.id, dst: unit.id, ability: ctx.source.id, vfx: p?.hitVfx, sfx: p?.hitSfx });
  if (ctx.source.kind === 'ability' && w.relation(ctx.caster, unit) === 2) {
    const r = ctx.caster.resource;
    if (r && r.gainOnAbilityHit) addResource(ctx.caster, r.gainOnAbilityHit);
    fireTrigger(w, ctx.caster, 'abilityHit', unit, ctx.depth);
  }
}

// ── conditions ──────────────────────────────────────────────────────────────────────────────────
export function evalCondition(w: World, c: ConditionT, ctx: EffectCtx): boolean {
  const t = ctx.hit ?? ctx.target;
  switch (c.kind) {
    case 'targetHpBelow': return !!t && t.maxHp > 0 && t.hp / t.maxHp < c.pct;
    case 'selfHpBelow': return ctx.caster.maxHp > 0 && ctx.caster.hp / ctx.caster.maxHp < c.pct;
    case 'targetHasMark': return !!t && markStacks(t, c.mark, ctx.caster) >= (c.min ?? 1);
    case 'targetHasStatus': return !!t && hasStatus(t, c.status);
    case 'counterAtLeast': return counterValue(ctx.caster, c.counter) >= c.n;
    case 'targetIs': return !!t && matchesFilter(w, ctx.caster, t, c.filter, false);
    case 'inForm': return ctx.caster.form === c.form;
    case 'chance': return w.rng.combat.chance(c.p);
    case 'not': return !evalCondition(w, c.cond, ctx);
    case 'all': for (const x of c.conds) if (!evalCondition(w, x, ctx)) return false; return true;
    case 'any': for (const x of c.conds) if (evalCondition(w, x, ctx)) return true; return false;
  }
}

// ── gold (single entry point; the economy lane reuses it) ───────────────────────────────────────
export type GoldReason = Extract<SimEvent, { e: 'gold' }>['reason'];
export function grantGold(w: World, player: PlayerId, amount: number, reason: GoldReason, x: number, y: number): void {
  const p = w.players[player];
  if (!p || amount === 0) return;
  p.gold = Math.max(0, p.gold + amount);
  if (amount > 0) p.goldEarned += amount;
  w.emit({ e: 'gold', t: w.time, player, amount, x, y, reason });
}

// ── interpreter ─────────────────────────────────────────────────────────────────────────────────
export function runEffects(w: World, list: readonly EffectT[] | undefined, ctx: EffectCtx): void {
  if (!list || list.length === 0 || ctx.depth > MAX_EFFECT_DEPTH) return;
  for (let i = 0; i < list.length; i++) runEffect(w, list[i], ctx);
}

export function runEffect(w: World, eff: EffectT, ctx: EffectCtx): void {
  const c = ctx.caster;
  if (c.statsDirty) computeStats(w, c); // ratios read the caster's current stats
  switch (eff.op) {
    case 'damage': {
      const t = resolveTo(ctx, eff.to);
      if (!t || !t.alive) return;
      let amt = resolveScaling(eff.amount, ctx, t);
      if (t.kind === 'minion' && eff.minionMult !== undefined) amt *= eff.minionMult;
      else if (t.kind === 'monster' && eff.monsterMult !== undefined) amt *= eff.monsterMult;
      else if (t.kind === 'structure' && eff.structureMult !== undefined) amt *= eff.structureMult;
      dealDamage(w, c, t, amt, eff.type, { ability: ctx.source.id, canCrit: eff.canCrit, ctx, depth: ctx.depth });
      // "applies on-hit": the attacker's attackHit triggers fire as if a basic attack landed
      if (eff.onHitEffects) fireTrigger(w, c, 'attackHit', t, ctx.depth);
      return;
    }
    case 'heal': {
      const t = resolveTo(ctx, eff.to);
      if (t) heal(w, c, t, resolveScaling(eff.amount, ctx, t));
      return;
    }
    case 'shield': {
      const t = resolveTo(ctx, eff.to);
      if (t) addShield(w, c, t, resolveScaling(eff.amount, ctx, t), ranked(eff.duration, ctx.rank));
      return;
    }
    case 'status': {
      const t = resolveTo(ctx, eff.to);
      if (!t) return;
      applyStatus(w, c, t, eff.status, ranked(eff.duration, ctx.rank), {
        power: eff.power !== undefined ? ranked(eff.power, ctx.rank) : undefined, decay: eff.decay, depth: ctx.depth,
      });
      return;
    }
    case 'buff': {
      const t = resolveTo(ctx, eff.to);
      if (t) applyBuff(w, t, eff, ctx);
      return;
    }
    case 'projectile': spawnProjectiles(w, eff, ctx); return;
    case 'dash': startDash(w, eff, ctx); return;
    case 'blink': doBlink(w, eff, ctx); return;
    case 'area': doArea(w, eff, ctx); return;
    case 'zone': spawnZone(w, eff, ctx); return;
    case 'displace': {
      const t = resolveTo(ctx, eff.to);
      if (t) displaceUnit(w, ctx, t, eff);
      return;
    }
    case 'summon': summonUnits(w, eff, ctx); return;
    case 'resource': addResource(c, resolveScaling(eff.amount, ctx, c)); return;
    case 'cooldown': reduceCooldown(w, c, eff.slot, eff.seconds, eff.percent); return;
    case 'mark': {
      const t = resolveTo(ctx, eff.to);
      if (t) applyMark(w, c, t, eff.mark, eff.duration, eff.stacks, eff.max);
      return;
    }
    case 'consumeMark': {
      const t = resolveTo(ctx, eff.to);
      if (!t) return;
      const n = takeMark(t, eff.mark, c);
      if (n <= 0) return;
      const sub = withHit(ctx, t);
      for (let i = 0; i < n; i++) runEffects(w, eff.perStack, sub);
      return;
    }
    case 'counter': addCounter(c, eff.counter, eff.add, eff.max, eff.duration, eff.reset); return;
    case 'if': runEffects(w, evalCondition(w, eff.cond, ctx) ? eff.then : eff.else, ctx); return;
    case 'repeat': {
      if (eff.count <= 0) return;
      runEffects(w, eff.effects, ctx);
      if (eff.interval <= 0) { for (let i = 1; i < eff.count; i++) runEffects(w, eff.effects, ctx); return; }
      // later iterations belong to this life of the caster: dying ends them, even if it respawns
      const life = c.lifeSeq;
      for (let i = 1; i < eff.count; i++) {
        w.schedule(eff.interval * i, () => { if (c.alive && c.lifeSeq === life) runEffects(w, eff.effects, ctx); });
      }
      return;
    }
    case 'form': setForm(w, c, eff.form, eff.duration); return;
    case 'reveal': {
      const t = resolveTo(ctx, eff.to);
      if (t) applyStatus(w, c, t, 'reveal', eff.duration, { depth: ctx.depth });
      return;
    }
    case 'gold': {
      const f = w.creditFighter(c);
      // a map pickup's grant list runs with the pickup's unit id as its source
      const reason: GoldReason = w.idx.units.get(ctx.source.id)?.kind === 'pickup' ? 'pickup' : 'passive';
      // every gold amount is whole: × goldMult, then rounded (CONTRACT §5.6)
      const amount = Math.round(eff.amount * w.rules.goldMult);
      if (f && f.player && amount !== 0) grantGold(w, f.player.player, amount, reason, c.x, c.y);
      return;
    }
    case 'script': {
      const fn = getScript(eff.id);
      if (fn) fn(w, ctx, eff.params ?? {});
      return;
    }
  }
}
