// VALE sim — structures: towers, gates, cores from MapDef.structures (CONTRACT §5.4).
//
// Spawned at match creation when rules.structures is true (team as written in the map, never
// moving, blocking nav cells while alive). Behavior keys: see units/common.ts.
//
// Protection: a structure whose `requires` list names a structure that is still alive is
// protected: untargetable (an 'untargetable' status with no end, so attacks, filters and
// abilities skip it) and invulnerable. Protection is recomputed whenever a structure falls or
// respawns. In sudden death no structure is protected.
//
// Towers (targetRules 'tower'): the AI (every tick) keeps a valid target in attack range; it picks
// by priority (default: an enemy that hurt an allied fighter standing within callForHelpRange of
// the tower, then minions, summons, monsters, fighters) and only drops its target for a
// call-for-help. Consecutive hits on the same fighter ramp: hit k (k ≥ 2) deals
// × (1 + min(rampMax, (k − 1) × rampPerHit)); a hit on anything else or rampReset s without a hit
// starts over.
//
// Falling: emits 'structure' { destroyedBy, final } (final = rules.end.kind 'core' and this is the
// coreStructure unit) and announce 'structure_destroyed'; the destroying team's
// TeamView.structuresDestroyed + 1; UnitDef.onTakedownTeamBuff goes to that team (see monsters.ts
// grantObjective); gold is economy.ts (bounty.gold to the credited fighter, goldGlobal team-wide).
// A map entry with `respawn` (gates) comes back after that many seconds as a NEW entity (the
// corpse is removed) and announces 'structure_respawned'.

import { applyStatus, removeStatusKind } from '../status.ts';
import type { MapDefT } from '../../contracts/catalog.ts';
import { attackable, inAttackRange } from '../attack.ts';
import { ORDER_ATTACK, type Entity } from '../entity.ts';
import { issueAttack, issueStop } from '../movement.ts';
import { spawnUnit } from '../spawn.ts';
import type { World } from '../world.ts';
import { behaviorOf, bestTargetInAttackRange, getExt, setExt, shouldSwitch } from './common.ts';
import { grantObjective } from './monsters.ts';

type MapStructure = MapDefT['structures'][number];
export interface StructEntry {
  def: MapStructure;
  ent: Entity;
  respawnAt: number;
}
interface StructsState { list: StructEntry[]; byId: Map<string, StructEntry> }
interface Ramp { target: number; stacks: number; at: number }
const KEY = 'structures';
const SKEY = 'struct';

export function structuresOf(w: World): readonly StructEntry[] { return (w.ext[KEY] as StructsState | undefined)?.list ?? []; }
/** the map entry an entity was spawned from */
export function structEntryOf(e: Entity): StructEntry | undefined { return getExt<StructEntry>(e, SKEY); }

/**
 * Is this structure the match-ending core (rules.end.coreStructure)? The rule may name the
 * structure UNIT id (every placement of that unit is a core) or one map PLACEMENT id (only that
 * placement is) — the content build accepts both, so the sim must too.
 */
export function isCoreStructure(w: World, e: Entity): boolean {
  const core = w.rules.end.coreStructure;
  if (core === undefined || e.kind !== 'structure') return false;
  return e.def === core || structEntryOf(e)?.def.id === core;
}

function spawnStructure(w: World, st: StructsState, entry: StructEntry | null, def: MapStructure): StructEntry {
  const e = spawnUnit(w, def.unit, def.team, def.at[0], def.at[1]);
  e.autoAttack = false; // the tower AI picks targets
  if (entry) entry.ent = e;
  else { entry = { def, ent: e, respawnAt: -1 }; st.list.push(entry); st.byId.set(def.id, entry); }
  setExt(e, SKEY, entry);
  return entry;
}

export function spawnStructures(w: World): void {
  const st: StructsState = { list: [], byId: new Map() };
  w.ext[KEY] = st;
  if (!w.rules.structures) return;
  for (const def of w.mapDef.structures) spawnStructure(w, st, null, def);
  updateProtection(w);
}

/** is a structure entry currently protected by its `requires` */
export function isProtected(w: World, entry: StructEntry): boolean {
  if (w.suddenDeath) return false;
  const st = w.ext[KEY] as StructsState;
  for (const id of entry.def.requires) {
    const r = st.byId.get(id);
    if (r && r.ent.alive) return true;
  }
  return false;
}

export function updateProtection(w: World): void {
  for (const entry of structuresOf(w)) {
    const e = entry.ent;
    if (!e.alive) continue;
    const prot = isProtected(w, entry);
    if (prot === e.invulnerable) continue;
    e.invulnerable = prot;
    if (prot) applyStatus(w, null, e, 'untargetable', Infinity);
    else removeStatusKind(w, e, 'untargetable');
    // a protected tower still shoots; only being hit is gated
  }
}

// ── tower AI ('ai' phase) ───────────────────────────────────────────────────────────────────────
export function towerSystem(w: World): void {
  for (const entry of structuresOf(w)) {
    const e = entry.ent;
    if (!e.alive || !e.unit || !e.attackDef) continue;
    const b = behaviorOf(e.unit);
    if (b.targetRules === 'none') continue;
    const cur = e.order === ORDER_ATTACK ? w.live(e.orderTarget) : null;
    const curOk = !!cur && attackable(w, e, cur) && inAttackRange(e, cur);
    const range = e.stats.range + e.radius;
    const best = bestTargetInAttackRange(w, e, range, b.priority, b.callForHelpRange);
    if (curOk && (!best || !shouldSwitch(w, e, cur!, best, b.priority, b.callForHelpRange))) continue;
    if (best) { if (best !== cur) issueAttack(w, e, best); }
    else if (e.order !== 0 || e.atkTarget >= 0) issueStop(w, e);
  }
}

// ── damage ramp ─────────────────────────────────────────────────────────────────────────────────
function rampMult(w: World, src: Entity | null, dst: Entity, raw: number, _d: unknown, isAttack: boolean): number {
  if (!src || src.kind !== 'structure' || !isAttack || dst.kind !== 'fighter' || !src.unit) return raw;
  const r = getExt<Ramp>(src, 'ramp');
  if (!r || r.target !== dst.id || r.stacks <= 0) return raw;
  const b = behaviorOf(src.unit);
  if (w.time - r.at > b.rampReset) return raw;
  return raw * (1 + Math.min(b.rampMax, r.stacks * b.rampPerHit));
}
function rampTrack(w: World, src: Entity | null, dst: Entity, info: { isAttack: boolean }): void {
  if (!src || src.kind !== 'structure' || !info.isAttack || !src.unit) return;
  const r = getExt<Ramp>(src, 'ramp') ?? setExt<Ramp>(src, 'ramp', { target: -1, stacks: 0, at: -1e9 });
  const b = behaviorOf(src.unit);
  if (dst.kind === 'fighter') {
    if (r.target === dst.id && w.time - r.at <= b.rampReset) r.stacks++;
    else { r.target = dst.id; r.stacks = 1; }
  } else { r.target = -1; r.stacks = 0; }
  r.at = w.time;
}

// ── falling / respawning ────────────────────────────────────────────────────────────────────────
function onDeath(w: World, victim: Entity, killer: Entity | null): void {
  if (victim.kind !== 'structure') return;
  const entry = structEntryOf(victim);
  const credit = w.creditFighter(killer);
  const by = credit ? credit.team : killer && killer.team >= 0 && killer.team !== victim.team ? killer.team : -1;
  const end = w.rules.end;
  const final = end.kind === 'core' && isCoreStructure(w, victim);
  if (by >= 0 && by < w.teams.length) w.teams[by].structuresDestroyed++;
  w.emit({ e: 'structure', t: w.time, id: victim.id, def: victim.def, team: victim.team, destroyedBy: by, final });
  w.emit({ e: 'announce', t: w.time, key: 'structure_destroyed', team: victim.team, params: { def: victim.def, by } });
  if (by >= 0 && victim.unit?.onTakedownTeamBuff) grantObjective(w, victim, by);
  if (entry && entry.def.respawn !== undefined && entry.def.respawn > 0) entry.respawnAt = w.time + entry.def.respawn;
  updateProtection(w);
}

/** 'deaths' phase: gates (map entries with `respawn`) come back */
export function structureRespawnSystem(w: World): void {
  const st = w.ext[KEY] as StructsState;
  for (const entry of st.list) {
    if (entry.respawnAt < 0 || w.time + 1e-9 < entry.respawnAt) continue;
    entry.respawnAt = -1;
    w.remove(entry.ent);
    spawnStructure(w, st, entry, entry.def);
    w.emit({ e: 'announce', t: w.time, key: 'structure_respawned', team: entry.def.team, params: { def: entry.ent.def } });
    updateProtection(w);
  }
}

export function installStructures(w: World): void {
  w.hooks.death.push((ww, victim, killer) => onDeath(ww, victim, killer));
  w.hooks.modifyDamage.push(rampMult);
  w.hooks.damage.push((ww, src, dst, _a, info) => rampTrack(ww, src, dst, info));
}
