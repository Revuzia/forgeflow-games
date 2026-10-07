// VALE sim — statuses, buffs, marks, counters, forms (CONTRACT §5.2, catalog StatusKind).
//
// Status rules:
//   * stun / airborne / sleep: no actions (move, attack, cast); sleep breaks on damage.
//   * root: no movement (attacks and casts allowed). silence: no ability casts (a1..ult; battle
//     spells and item actives still work). disarm: no basic attacks.
//   * taunt: forced to attack the taunter, no casts. fear: forced to walk away from the source,
//     no attacks or casts.
//   * slow: only the strongest applies; haste: additive. Both feed moveSpeed via stats.
//   * grievous / armor_shred / resist_shred: strongest applies (power = fraction).
//   * invisible: hidden from enemies unless revealed; broken when the unit attacks or casts.
//   * untargetable: enemies cannot target or hit it. unstoppable: immune to (and cleanses)
//     stun/root/airborne/taunt/fear/sleep and displacements.
//   * reveal: visible to the applier's team through fog, thickets and invisibility.
//   * tenacity (target's) shortens hostile stun/root/slow/silence/fear/taunt/sleep, never airborne.
// One entry per (kind, source): re-application by the same source refreshes (longest remaining,
// strongest power); different sources coexist (that is how "strongest slow" is decided).
//
// Buffs: `id` makes re-application refresh instead of stacking a new entry; with `maxStacks`,
// re-application adds a stack (≤ max) and refreshes. Stats (incl. statScaling, resolved from the
// caster at application time) are per stack. `onExpire` runs when the timer runs out (not when
// empowered attacks consume the buff). Marks are per (mark id, applier). Counters live on the
// caster. Forms swap a1..ult to the form's kit overrides; applying the current form again reverts.

import type { StatusKindT } from '../contracts/catalog.ts';
import {
  CC_AIRBORNE, CC_DISARM, CC_FEAR, CC_HARD, CC_ROOT, CC_SILENCE, CC_SLEEP, CC_STUN, CC_TAUNT,
  ST_INVISIBLE, ST_UNSTOPPABLE, ST_UNTARGETABLE, SLOT_A1, SLOT_ULT,
  type Buff, type EffOf, type EffectCtx, type Entity, type Status,
} from './entity.ts';
import { interruptCast, swapSlotDef } from './abilities.ts';
import { noteAssist } from './combat.ts';
import { interruptDash } from './movement.ts';
import { computeStats, markStatsDirty } from './stats.ts';
import { fireTrigger } from './triggers.ts';
import { ranked, resolveScaling, runEffects } from './effects.ts';
import type { World } from './world.ts';
import type { StatBlockT } from '../contracts/catalog.ts';

export const DEFAULT_STATUS_POWER: Partial<Record<StatusKindT, number>> = {
  slow: 0.3, haste: 0.2, grievous: 0.4, armor_shred: 0.2, resist_shred: 0.2,
};
const TENACITY_KINDS = new Set<StatusKindT>(['stun', 'root', 'slow', 'silence', 'fear', 'taunt', 'sleep']);
const UNSTOPPABLE_IGNORES = new Set<StatusKindT>(['stun', 'root', 'airborne', 'taunt', 'fear', 'sleep']);
/** statuses that cancel windups/channels/attacks when they land */
const INTERRUPTS = new Set<StatusKindT>(['stun', 'airborne', 'sleep', 'taunt', 'fear', 'silence']);

// ── action gates ────────────────────────────────────────────────────────────────────────────────
export function canAct(e: Entity): boolean { return (e.ccMask & CC_HARD) === 0; }
export function canMove(e: Entity): boolean { return (e.ccMask & (CC_HARD | CC_ROOT)) === 0; }
export function canAttack(e: Entity): boolean { return (e.ccMask & (CC_HARD | CC_DISARM | CC_FEAR)) === 0; }
/** kind: slot kind — silence only blocks fighter abilities */
export function canCast(e: Entity, kind: 'ability' | 'spell' | 'item'): boolean {
  if ((e.ccMask & (CC_HARD | CC_TAUNT | CC_FEAR)) !== 0) return false;
  return kind !== 'ability' || (e.ccMask & CC_SILENCE) === 0;
}
export function hasStatus(e: Entity, kind: StatusKindT): boolean {
  for (let i = 0; i < e.statuses.length; i++) if (e.statuses[i].kind === kind) return true;
  return false;
}
export function statusFrom(e: Entity, kind: StatusKindT): Status | null {
  let best: Status | null = null;
  for (let i = 0; i < e.statuses.length; i++) {
    const s = e.statuses[i];
    if (s.kind === kind && (!best || s.remaining > best.remaining)) best = s;
  }
  return best;
}

// ── statuses ────────────────────────────────────────────────────────────────────────────────────
/** recompute ccMask / slow / haste / shred / reveal from the status list */
export function recomputeStatusFlags(e: Entity): void {
  let mask = 0, slow = 0, haste = 0, griev = 0, shA = 0, shR = 0, reveal = 0;
  const list = e.statuses;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    switch (s.kind) {
      case 'stun': mask |= CC_STUN; break;
      case 'root': mask |= CC_ROOT; break;
      case 'silence': mask |= CC_SILENCE; break;
      case 'disarm': mask |= CC_DISARM; break;
      case 'airborne': mask |= CC_AIRBORNE; break;
      case 'taunt': mask |= CC_TAUNT; break;
      case 'fear': mask |= CC_FEAR; break;
      case 'sleep': mask |= CC_SLEEP; break;
      case 'invisible': mask |= ST_INVISIBLE; break;
      case 'untargetable': mask |= ST_UNTARGETABLE; break;
      case 'unstoppable': mask |= ST_UNSTOPPABLE; break;
      case 'slow': if (s.power > slow) slow = s.power; break;
      case 'haste': haste += s.power; break;
      case 'grievous': if (s.power > griev) griev = s.power; break;
      case 'armor_shred': if (s.power > shA) shA = s.power; break;
      case 'resist_shred': if (s.power > shR) shR = s.power; break;
      case 'reveal': if (s.srcTeam >= 0 && s.srcTeam < 31) reveal |= 1 << s.srcTeam; break;
    }
  }
  slow = Math.min(1, slow); griev = Math.min(1, griev); shA = Math.min(1, shA); shR = Math.min(1, shR);
  if (slow !== e.slowPow || haste !== e.hastePow || shA !== e.armorShred || shR !== e.resistShred) {
    e.slowPow = slow; e.hastePow = haste; e.armorShred = shA; e.resistShred = shR;
    markStatsDirty(e);
  }
  e.grievous = griev;
  e.ccMask = mask;
  e.revealMask = reveal;
  e.targetable = e.alive && (mask & ST_UNTARGETABLE) === 0;
}

export interface StatusOpts { power?: number; decay?: boolean; depth?: number }

/** apply a status; returns false when it was ignored (dead, unstoppable, zero duration) */
export function applyStatus(w: World, src: Entity | null, dst: Entity, kind: StatusKindT, duration: number, opts: StatusOpts = {}): boolean {
  if (!dst.alive || !(duration > 0)) return false;
  if ((dst.ccMask & ST_UNSTOPPABLE) !== 0 && UNSTOPPABLE_IGNORES.has(kind)) return false;
  const hostile = src !== null && w.relation(src, dst) === 2;
  if (dst.statsDirty) computeStats(w, dst);
  if (hostile && TENACITY_KINDS.has(kind)) duration *= 1 - dst.stats.tenacity;
  if (!(duration > 0)) return false;
  const power = opts.power ?? DEFAULT_STATUS_POWER[kind] ?? 1;
  const srcId = src ? src.id : -1;
  let s: Status | null = null;
  for (let i = 0; i < dst.statuses.length; i++) {
    const x = dst.statuses[i];
    if (x.kind === kind && x.src === srcId) { s = x; break; }
  }
  if (s) {
    if (duration > s.remaining) { s.remaining = duration; s.duration = duration; }
    if (power > s.basePower) s.basePower = power;
    s.power = s.basePower;
    s.decay = !!opts.decay;
  } else {
    s = { kind, remaining: duration, duration, power, basePower: power, src: srcId, srcTeam: src ? src.team : -1, decay: !!opts.decay };
    dst.statuses.push(s);
  }
  if (kind === 'unstoppable') removeStatusKinds(dst, UNSTOPPABLE_IGNORES);
  recomputeStatusFlags(dst);
  if (kind === 'reveal' && s.srcTeam >= 0) dst.visibleMask |= 1 << s.srcTeam;
  w.emit({ e: 'status', t: w.time, dst: dst.id, status: kind, duration });

  if (INTERRUPTS.has(kind)) {
    // silence only cancels fighter abilities; the rest cancel any windup/channel and attack windup
    if (kind !== 'silence') { interruptCast(w, dst, true); dst.atkWindup = -1; }
    else if (dst.cast && (dst.cast.slot === null || dst.cast.slot.kind === 'ability')) interruptCast(w, dst, true);
  }
  if (kind === 'disarm') dst.atkWindup = -1;
  if ((kind === 'stun' || kind === 'root' || kind === 'airborne' || kind === 'sleep') && dst.dash && !dst.dash.displace && !dst.dash.unstoppable) interruptDash(w, dst);
  if (hostile && src) noteAssist(w, src, dst);
  if (src && src.alive) fireTrigger(w, src, 'statusApplied', dst, opts.depth ?? 0);
  return true;
}

function removeStatusKinds(e: Entity, kinds: Set<StatusKindT>): void {
  let w = 0;
  for (let i = 0; i < e.statuses.length; i++) { const s = e.statuses[i]; if (!kinds.has(s.kind)) e.statuses[w++] = s; }
  e.statuses.length = w;
}
/** remove every status of a kind (sleep on damage, cleanses) */
export function removeStatusKind(w: World, e: Entity, kind: StatusKindT): void {
  let found = false;
  for (let i = 0; i < e.statuses.length; i++) if (e.statuses[i].kind === kind) { found = true; break; }
  if (!found) return;
  let k = 0;
  for (let i = 0; i < e.statuses.length; i++) { const s = e.statuses[i]; if (s.kind !== kind) e.statuses[k++] = s; }
  e.statuses.length = k;
  recomputeStatusFlags(e);
}
export function clearStatuses(w: World, e: Entity): void {
  if (e.statuses.length === 0 && e.ccMask === 0) return;
  e.statuses.length = 0;
  recomputeStatusFlags(e);
}

/** count down statuses; decaying ones fade their power linearly */
export function tickStatuses(w: World, e: Entity, dt: number): void {
  const list = e.statuses;
  if (list.length === 0) return;
  let k = 0, changed = false;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    s.remaining -= dt;
    if (s.remaining <= 1e-9) { changed = true; continue; }
    if (s.decay) { s.power = s.basePower * (s.remaining / s.duration); changed = true; }
    list[k++] = s;
  }
  list.length = k;
  if (changed) recomputeStatusFlags(e);
}

/** strip invisibility (the unit attacked or cast) */
export function breakInvisibility(w: World, e: Entity): void {
  if ((e.ccMask & ST_INVISIBLE) !== 0) removeStatusKind(w, e, 'invisible');
}

// ── buffs ───────────────────────────────────────────────────────────────────────────────────────
export function applyBuff(w: World, dst: Entity, eff: EffOf<'buff'>, ctx: EffectCtx): Buff | null {
  if (!dst.alive) return null;
  const duration = ranked(eff.duration, ctx.rank);
  if (!(duration > 0)) return null;
  let stats: StatBlockT | null = null;
  if (eff.stats || eff.statScaling) {
    const st: Record<string, number> = {};
    if (eff.stats) for (const k in eff.stats) { const v = (eff.stats as Record<string, number | undefined>)[k]; if (v !== undefined) st[k] = v; }
    if (eff.statScaling) for (const k in eff.statScaling) {
      const sc = (eff.statScaling as Record<string, Parameters<typeof resolveScaling>[0] | undefined>)[k];
      if (sc !== undefined) st[k] = (st[k] ?? 0) + resolveScaling(sc, ctx, dst);
    }
    stats = st as StatBlockT;
  }
  let b: Buff | null = null;
  for (let i = 0; i < dst.buffs.length; i++) if (dst.buffs[i].id === eff.id) { b = dst.buffs[i]; break; }
  const maxStacks = eff.maxStacks ?? 1;
  if (b) {
    b.remaining = duration; b.duration = duration;
    if (b.stacks < maxStacks) b.stacks++;
    b.maxStacks = maxStacks;
    b.stats = stats;
    b.src = ctx.caster.id; b.source = ctx.source.id;
    b.empower = eff.empowerAttacks ?? null;
    if (eff.empowerAttacks) b.empowerLeft = eff.empowerAttacks.count;
    b.onExpire = eff.onExpire ?? null;
    b.ctx = ctx; b.present = eff.present;
  } else {
    b = {
      id: eff.id, source: ctx.source.id, remaining: duration, duration, stacks: 1, icon: undefined,
      src: ctx.caster.id, stats, empower: eff.empowerAttacks ?? null, empowerLeft: eff.empowerAttacks ? eff.empowerAttacks.count : 0,
      maxStacks, onExpire: eff.onExpire ?? null, ctx, present: eff.present,
    };
    dst.buffs.push(b);
  }
  if (stats) markStatsDirty(dst);
  if (eff.empowerAttacks?.resetAttack) dst.atkCd = 0;
  return b;
}

export function removeBuff(w: World, e: Entity, b: Buff): void {
  const i = e.buffs.indexOf(b);
  if (i < 0) return;
  e.buffs.splice(i, 1);
  if (b.stats) markStatsDirty(e);
}
export function findBuff(e: Entity, id: string): Buff | null {
  for (let i = 0; i < e.buffs.length; i++) if (e.buffs[i].id === id) return e.buffs[i];
  return null;
}

/** count down buffs; expired ones run onExpire (holder as hit/target, original caster as caster) */
export function tickBuffs(w: World, e: Entity, dt: number): void {
  const list = e.buffs;
  if (list.length === 0) return;
  let expired: Buff[] | null = null;
  let k = 0;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    b.remaining -= dt;
    if (b.remaining <= 1e-9) { (expired ??= []).push(b); continue; }
    list[k++] = b;
  }
  list.length = k;
  if (!expired) return;
  markStatsDirty(e);
  for (const b of expired) {
    if (!b.onExpire || !b.ctx) continue;
    const c = b.ctx;
    runEffects(w, b.onExpire, { ...c, target: e, hit: e, px: e.x, py: e.y, ex: e.x, ey: e.y, hasEnd: true, depth: c.depth + 1 });
  }
}

/** the empowered-attack buff whose charge the next attack will consume (first applied first) */
export function peekEmpower(e: Entity): Buff | null {
  for (let i = 0; i < e.buffs.length; i++) { const b = e.buffs[i]; if (b.empower && b.empowerLeft > 0) return b; }
  return null;
}
/** consume one empowered attack; removes the buff when its charges run out */
export function consumeEmpower(w: World, e: Entity, b: Buff): void {
  b.empowerLeft--;
  if (b.empowerLeft <= 0) removeBuff(w, e, b);
}
/** extra attack range granted by the pending empowered attack */
export function empowerRangeBonus(e: Entity): number {
  const b = peekEmpower(e);
  return b && b.empower && b.empower.rangeBonus ? b.empower.rangeBonus : 0;
}

// ── marks (on the target, per applier) ──────────────────────────────────────────────────────────
export function applyMark(w: World, src: Entity, dst: Entity, id: string, duration: number, stacks: number, max: number): number {
  if (!dst.alive) return 0;
  for (let i = 0; i < dst.marks.length; i++) {
    const m = dst.marks[i];
    if (m.id === id && m.src === src.id) {
      m.max = Math.max(1, max);
      m.stacks = Math.max(0, Math.min(m.max, m.stacks + stacks));
      m.remaining = duration;
      return m.stacks;
    }
  }
  const s = Math.max(0, Math.min(Math.max(1, max), stacks));
  dst.marks.push({ id, src: src.id, stacks: s, remaining: duration, max: Math.max(1, max) });
  if (w.relation(src, dst) === 2) noteAssist(w, src, dst);
  return s;
}
export function markStacks(dst: Entity, id: string, src: Entity): number {
  for (let i = 0; i < dst.marks.length; i++) { const m = dst.marks[i]; if (m.id === id && m.src === src.id) return m.stacks; }
  return 0;
}
/** remove the applier's mark and return how many stacks it had */
export function takeMark(dst: Entity, id: string, src: Entity): number {
  for (let i = 0; i < dst.marks.length; i++) {
    const m = dst.marks[i];
    if (m.id === id && m.src === src.id) { dst.marks.splice(i, 1); return m.stacks; }
  }
  return 0;
}
export function tickMarks(e: Entity, dt: number): void {
  const list = e.marks;
  if (list.length === 0) return;
  let k = 0;
  for (let i = 0; i < list.length; i++) { const m = list[i]; m.remaining -= dt; if (m.remaining > 1e-9) list[k++] = m; }
  list.length = k;
}

// ── counters (on the caster) ────────────────────────────────────────────────────────────────────
export function addCounter(e: Entity, id: string, add: number, max?: number, duration?: number, reset?: boolean): number {
  let c = null;
  for (let i = 0; i < e.counters.length; i++) if (e.counters[i].id === id) { c = e.counters[i]; break; }
  if (!c) { c = { id, value: 0, remaining: -1, max: Infinity }; e.counters.push(c); }
  if (max !== undefined) c.max = max;
  if (reset) c.value = 0;
  c.value = Math.max(0, Math.min(c.max, c.value + add));
  if (duration !== undefined) c.remaining = duration;
  return c.value;
}
export function counterValue(e: Entity, id: string): number {
  for (let i = 0; i < e.counters.length; i++) if (e.counters[i].id === id) return e.counters[i].value;
  return 0;
}
/** counters with a duration reset to 0 when it runs out (refreshed by every add) */
export function tickCounters(e: Entity, dt: number): void {
  for (let i = 0; i < e.counters.length; i++) {
    const c = e.counters[i];
    if (c.remaining < 0) continue;
    c.remaining -= dt;
    if (c.remaining <= 1e-9) { c.value = 0; c.remaining = -1; }
  }
}

// ── forms ───────────────────────────────────────────────────────────────────────────────────────
/** switch form (null = base kit). Applying the current form again toggles back to base. */
export function setForm(w: World, e: Entity, form: string | null, duration?: number): void {
  const forms = e.fighter?.kit.passive.forms;
  if (form !== null && (!forms || !forms[form])) return;
  if (form !== null && form === e.form) form = null;
  e.form = form;
  e.formTimer = form !== null && duration !== undefined && duration > 0 ? duration : -1;
  const kit = form !== null && forms ? forms[form].kit : undefined;
  for (let i = SLOT_A1; i <= SLOT_ULT; i++) {
    const slot = e.slots[i];
    if (!slot) continue;
    const name = slot.slot as 'a1' | 'a2' | 'a3' | 'ult';
    const over = kit ? kit[name] : undefined;
    slot.formDef = over ?? null;
    swapSlotDef(slot, over ?? slot.baseDef);
  }
  markStatsDirty(e);
}
export function tickForm(w: World, e: Entity, dt: number): void {
  if (e.formTimer < 0) return;
  e.formTimer -= dt;
  if (e.formTimer <= 1e-9) { e.formTimer = -1; setForm(w, e, null); }
}
