// VALE sim — damage, healing, shields, deaths (CONTRACT §5.2).
//
// Damage pipeline, in order:
//   veto (invulnerable / hooks.canDamage) → crit (combat stream; ×critDamage) → hooks.modifyDamage
//   (tower ramp, per-kind tuning) → mitigation
//   (armor for phys, resist for magic: % pen first, then flat pen, never below 0; true skips it)
//   → shields absorb (soonest-expiring first) → hp → bookkeeping (assists, recap log, stats)
//   → event → vamp heal (lifesteal on basic attacks, omnivamp on everything) → triggers → death.
// Heals: × (1 + caster healShieldPower) × (1 − target grievous), clamped to missing hp.
// Shields: × (1 + caster healShieldPower); grievous does not cut shields.
//
// Kill credit: the damaging entity is the `killer` in the death event; the fighter credited for
// it (itself, or a summon's owner) gets the kill. Assists: every other player whose fighter (or
// summon) damaged or debuffed the victim in the last rules.tuning.assistWindow (ASSIST_WINDOW) s.
// Core counts K/D/A and team kills for fighter deaths; gold/streaks/bounties belong to economy
// (hooks.death), which may fill `ev.gold` on the event object before the tick ends.

import type { DamageTypeT } from '../contracts/catalog.ts';
import type { PlayerId } from '../contracts/sim.ts';
import { DamageLog, type EffectCtx, type Entity } from './entity.ts';
import { computeStats } from './stats.ts';
import { clearStatuses, removeStatusKind } from './status.ts';
import { checkLowHp, fireTrigger } from './triggers.ts';
import type { DeathEvent, World } from './world.ts';

export const ASSIST_WINDOW = 10;
export const DAMAGE_LOG_WINDOW = 15;
/** seconds a dead non-fighter unit stays in the store (death animation) before removal */
export const CORPSE_TIME = 1.5;

/** damage multiplier for a (post-pen) armor/resist value */
export function damageMultiplier(defense: number): number {
  return defense >= 0 ? 100 / (100 + defense) : 2 - 100 / (100 - defense);
}
/** armor/resist after penetration: % first, then flat; pen never pushes a positive value below 0 and never applies to negative values */
export function effectiveDefense(value: number, pctPen: number, flatPen: number): number {
  if (value <= 0) return value;
  const v = value * (1 - pctPen) - flatPen;
  return v < 0 ? 0 : v;
}
/** post-mitigation amount for a damage type */
export function mitigated(src: Entity | null, dst: Entity, amount: number, dtype: DamageTypeT): number {
  if (dtype === 'true') return amount;
  const s = src ? src.stats : null;
  const def = dtype === 'phys'
    ? effectiveDefense(dst.stats.armor, s ? s.armorPenPct : 0, s ? s.armorPen : 0)
    : effectiveDefense(dst.stats.resist, s ? s.magicPenPct : 0, s ? s.magicPen : 0);
  return amount * damageMultiplier(def);
}

export interface DamageOpts {
  ability?: string;
  /** basic attack (lifesteal applies, attackHit triggers fire from attack.ts) */
  isAttack?: boolean;
  /** roll a crit from the combat stream */
  canCrit?: boolean;
  /** a crit already decided (basic attacks roll at windup start so the event can carry it) */
  crit?: boolean;
  ctx?: EffectCtx | null;
  /** trigger depth of the effect that caused this (recursion guard) */
  depth?: number;
}

/** deal damage; returns the post-mitigation amount (hp + shield) */
export function dealDamage(w: World, src: Entity | null, dst: Entity, raw: number, dtype: DamageTypeT, opts: DamageOpts = {}): number {
  if (!dst.alive || !(raw > 0) || dst.kind === 'projectile' || dst.kind === 'zone') return 0;
  if (dst.invulnerable) return 0;
  if (dst.statsDirty) computeStats(w, dst);
  if (src && src.statsDirty) computeStats(w, src);
  const veto = w.hooks.canDamage;
  for (let i = 0; i < veto.length; i++) if (!veto[i](w, src, dst)) return 0;

  let crit = false;
  if (opts.crit !== undefined) crit = opts.crit;
  else if (opts.canCrit && src && src.stats.crit > 0) crit = w.rng.combat.chance(src.stats.crit);
  let amount = raw;
  if (crit && src) amount *= src.stats.critDamage;
  const mods = w.hooks.modifyDamage;
  for (let i = 0; i < mods.length; i++) amount = mods[i](w, src, dst, amount, dtype, !!opts.isAttack);
  if (!(amount > 0)) return 0;
  const preMit = amount;
  amount = mitigated(src, dst, amount, dtype);
  if (!(amount > 0)) return 0;

  // shields absorb first (soonest-expiring first, so long shields survive)
  let shielded = 0;
  let broke = false;
  if (dst.shields.length > 0) {
    let left = amount;
    while (left > 0 && dst.shields.length > 0) {
      let k = 0;
      for (let i = 1; i < dst.shields.length; i++) if (dst.shields[i].remaining < dst.shields[k].remaining) k = i;
      const sh = dst.shields[k];
      const take = Math.min(sh.amount, left);
      sh.amount -= take; left -= take; shielded += take;
      if (sh.amount <= 1e-9) { dst.shields.splice(k, 1); broke = true; }
    }
    let sum = 0;
    for (const sh of dst.shields) sum += sh.amount;
    dst.shield = sum;
  }
  const hpDmg = amount - shielded;
  dst.hp -= hpDmg;
  if (dst.hp < 0) dst.hp = 0;

  // bookkeeping
  if (src) { dst.lastHitBy = src.id; dst.lastHitAt = w.time; noteAssist(w, src, dst); }
  const credit = w.creditFighter(src);
  if (credit && credit.player && credit.team !== dst.team) {
    if (dst.kind === 'fighter') credit.player.damageToFighters += amount;
    else if (dst.kind === 'structure') credit.player.structureDamage += amount;
  }
  if (dst.player) dst.player.damageTaken += amount;
  if (dst.dmgLog) {
    const name = src ? (src.player ? src.player.name : src.unit ? src.unit.name : src.fighter ? src.fighter.name : src.def) : '';
    dst.dmgLog.push(w.time, src ? src.id : -1, name, src ? src.def : '', opts.ability, amount, dtype);
  }
  w.emit({ e: 'damage', t: w.time, src: src ? src.id : -1, dst: dst.id, amount, dtype, crit, ability: opts.ability, shielded });
  const hooks = w.hooks.damage;
  if (hooks.length) {
    const info = { dtype, crit, ability: opts.ability, isAttack: !!opts.isAttack, shielded, raw: preMit };
    for (let i = 0; i < hooks.length; i++) hooks[i](w, src, dst, amount, info);
  }

  const dying = dst.hp <= 0;
  if (!dying) {
    if (dst.statuses.length > 0) removeStatusKind(w, dst, 'sleep');
    const r = dst.resource;
    if (r && r.gainOnHitTaken) addResource(dst, r.gainOnHitTaken);
  }

  // vamp
  if (src && src.alive) {
    const vamp = (opts.isAttack ? src.stats.lifesteal : 0) + src.stats.omnivamp;
    if (vamp > 0) heal(w, src, src, amount * vamp, false);
  }

  // triggers (guarded against reflect loops by depth)
  const depth = opts.depth ?? (opts.ctx ? opts.ctx.depth : 0);
  if (src && src.alive) fireTrigger(w, src, 'damageDealt', dst, depth);
  if (!dying) {
    if (src) fireTrigger(w, dst, 'damageTaken', src, depth);
    if (broke) fireTrigger(w, dst, 'shieldBroken', src, depth);
    checkLowHp(w, dst, depth);
  }
  if (dst.alive && dst.hp <= 0) killEntity(w, dst, src, depth);
  return amount;
}

/** heal; returns the effective amount. `power`: apply the healer's healShieldPower (not for vamp). */
export function heal(w: World, src: Entity | null, dst: Entity, amount: number, power = true): number {
  if (!dst.alive || !(amount > 0)) return 0;
  if (src && src.statsDirty) computeStats(w, src);
  if (power && src) amount *= 1 + src.stats.healShieldPower;
  if (dst.grievous > 0) amount *= 1 - dst.grievous;
  const eff = Math.min(amount, dst.maxHp - dst.hp);
  if (!(eff > 0)) return 0;
  dst.hp += eff;
  const credit = w.creditFighter(src);
  if (credit && credit.player) credit.player.healing += eff;
  w.emit({ e: 'heal', t: w.time, src: src ? src.id : dst.id, dst: dst.id, amount: eff });
  return eff;
}

/** add a timed shield; returns the amount granted */
export function addShield(w: World, src: Entity | null, dst: Entity, amount: number, duration: number): number {
  if (!dst.alive || !(amount > 0) || !(duration > 0)) return 0;
  if (src && src.statsDirty) computeStats(w, src);
  if (src) amount *= 1 + src.stats.healShieldPower;
  dst.shields.push({ amount, remaining: duration, src: src ? src.id : -1 });
  dst.shield += amount;
  w.emit({ e: 'shield', t: w.time, dst: dst.id, amount });
  return amount;
}

/** expire shields; keeps entity.shield equal to the sum */
export function tickShields(e: Entity, dt: number): void {
  const list = e.shields;
  if (list.length === 0) return;
  let w = 0, sum = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    s.remaining -= dt;
    if (s.remaining > 0 && s.amount > 0) { list[w++] = s; sum += s.amount; }
  }
  list.length = w;
  e.shield = sum;
}

/** resource gain/spend with clamping; build/heat decay timers restart on any change */
export function addResource(e: Entity, amount: number): void {
  if (!e.resource || e.resource.model === 'none' || amount === 0) return;
  e.res = Math.max(0, Math.min(e.maxRes, e.res + amount));
  e.resIdle = 0;
}

/** remember that src's player contributed against dst (assist window) */
export function noteAssist(w: World, src: Entity | null, dst: Entity): void {
  const f = w.creditFighter(src);
  if (!f || !f.player || f.team === dst.team) return;
  if (!dst.assistT) dst.assistT = new Float64Array(Math.max(1, w.players.length)).fill(-Infinity);
  const p = f.player.player;
  if (p < dst.assistT.length) dst.assistT[p] = w.time;
}

/** players (excluding the killer's) who contributed against the victim within the assist window */
export function assistsOf(w: World, victim: Entity, killerPlayer: PlayerId | -1): PlayerId[] {
  const out: PlayerId[] = [];
  const a = victim.assistT;
  if (!a) return out;
  const since = w.time - (w.rules.tuning?.assistWindow ?? ASSIST_WINDOW);
  for (let p = 0; p < a.length; p++) {
    if (p === killerPlayer || a[p] < since) continue;
    const pl = w.players[p];
    if (pl && pl.team !== victim.team) out.push(p);
  }
  return out;
}

/**
 * Kill an entity now: cancel its actions, clear statuses/buffs/shields/marks, emit 'death', run
 * hooks.death and the death/kill/takedown triggers. Non-fighter, non-structure corpses are
 * removed after CORPSE_TIME. Fighters stay in the store for the respawn system.
 */
export function killEntity(w: World, victim: Entity, killer: Entity | null, depth = 0): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.targetable = false;
  victim.hp = 0;
  victim.deathTime = w.time;
  victim.lifeSeq++;
  victim.cast = null; victim.dash = null; victim.height = 0;
  victim.atkWindup = -1; victim.atkTarget = -1; victim.atkAnim = 0;
  victim.vx = 0; victim.vy = 0;
  victim.pendingSlot = -1;
  victim.order = 0; victim.orderTarget = -1; victim.path.length = 0;
  victim.shields.length = 0; victim.shield = 0;
  victim.marks.length = 0;
  if (victim.buffs.length) { victim.buffs.length = 0; victim.statsDirty = true; }
  clearStatuses(w, victim);
  w.hashDirty = true;
  if (victim.navBlockR > 0) { w.nav.removeObstacle(victim.x, victim.y, victim.navBlockR); victim.navBlockR = 0; }

  const credit = w.creditFighter(killer);
  const killerPlayer: PlayerId | -1 = credit && credit.player && credit.team !== victim.team ? credit.player.player : -1;
  const assists = assistsOf(w, victim, killerPlayer);
  const ev: DeathEvent = { e: 'death', t: w.time, dst: victim.id, killer: killer ? killer.id : -1, assists, gold: 0, kind: victim.kind };
  w.emit(ev);

  if (victim.kind === 'fighter' && victim.player) {
    victim.player.deaths++;
    if (killerPlayer >= 0) {
      const kp = w.players[killerPlayer];
      kp.kills++;
      if (kp.team >= 0 && kp.team < w.teams.length) w.teams[kp.team].kills++;
    }
    for (const p of assists) w.players[p].assists++;
  }
  if (victim.assistT) victim.assistT.fill(-Infinity);

  const hooks = w.hooks.death;
  for (let i = 0; i < hooks.length; i++) hooks[i](w, victim, killer, assists, ev);

  fireTrigger(w, victim, 'death', killer, depth);
  if (credit && credit !== victim) {
    fireTrigger(w, credit, 'kill', victim, depth);
    if (victim.kind === 'fighter') fireTrigger(w, credit, 'takedown', victim, depth);
  }
  if (killer && killer !== credit && killer.alive) fireTrigger(w, killer, 'kill', victim, depth);
  if (victim.kind === 'fighter') {
    for (const p of assists) {
      const pe = w.players[p].ent;
      if (pe && pe !== credit && pe.alive) fireTrigger(w, pe, 'takedown', victim, depth);
    }
  }
  if (victim.kind !== 'fighter' && victim.kind !== 'structure' && victim.removeAt < 0) victim.removeAt = w.time + CORPSE_TIME;
}

/** death recap for a player's fighter: last DAMAGE_LOG_WINDOW seconds, newest last */
export function damageLogFor(w: World, player: PlayerId): ReturnType<DamageLog['since']> {
  const p = w.players[player];
  const e = p ? p.ent : null;
  if (!e || !e.dmgLog) return [];
  return e.dmgLog.since(w.time - DAMAGE_LOG_WINDOW);
}
