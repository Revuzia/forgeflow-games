// VALE sim — structures: towers, gates, cores from MapDef.structures (CONTRACT §5.4).
//
// Spawned at match creation when rules.structures is true (team as written in the map, never
// moving, blocking nav cells while alive). Behavior keys: see units/common.ts.
//
// Protection: a structure whose `requires` list names a structure that is still alive is
// protected: untargetable (an 'untargetable' status with no end, so attacks, filters and
// abilities skip it) and invulnerable. Protection is recomputed whenever a structure falls or
// respawns. Protection holds in sudden death too (W4 gameplay G5): a core never falls with its chain
// standing; sudden death brings the Gorge Wind instead (below).
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
//
// Dawn Seal (rules.dawnSeal, W4 gameplay G4): until `until` s, each standing structure of a listed unit
// carries a seal — a shield whose source is the structure itself — of `amount`, set back to full at
// every multiple of `every` s and gone at `until`. Ringshade (rules.ringshade): damage from fighters and
// their summons to a listed structure is scaled by how many of the striker's Wicks stand in its shadow
// ring (attack range + radius): × mult with none, rising evenly to × 1 at `wicks`; off in sudden death. A hit it
// scales below × 1 sets World.hitShaded, so its 'damage' event carries `shaded: true` (the muffled-hit sound).
//
// Gorge Wind (rules.gorgeWind, W4 gameplay G5; its steps are World.gorgeWind, raised by modes/match.ts): with
// s steps up, damage dealt by Wicks is × (1 + s × wickDamage) and damage taken by structures × (1 + s ×
// structureTaken) — the stalled match breaks its chains down in order instead of skipping them.

import { practiceStructures } from '../modes/practice.ts';
import { TICK_HZ } from '../../contracts/sim.ts';
import { addShield } from '../combat.ts';
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
interface StructsState { list: StructEntry[]; byId: Map<string, StructEntry>; /** tick of the next Dawn Seal re-set */ sealAt: number }
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
  const st: StructsState = { list: [], byId: new Map(), sealAt: 0 };
  w.ext[KEY] = st;
  if (!w.rules.structures) return;
  for (const def of w.mapDef.structures) spawnStructure(w, st, null, def);
  updateProtection(w);
}

/** is a structure entry currently protected by its `requires` */
export function isProtected(w: World, entry: StructEntry): boolean {
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
  // practice with structures off: towers hold fire (modes/practice.ts toggleStructures)
  if (!practiceStructures(w)) return;
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

// ── Dawn Seal and Ringshade ─────────────────────────────────────────────────────────────────────
/** 'deaths' phase: set every listed structure's Dawn Seal back to full on the seal's beat */
export function dawnSealSystem(w: World): void {
  const ds = w.rules.dawnSeal;
  if (!ds || w.time >= ds.until) return;
  // the beat: the first run of the match, then every `every` s (whole ticks)
  const st = w.ext[KEY] as StructsState;
  if (w.tick < st.sealAt) return;
  st.sealAt = w.tick + Math.max(1, Math.round(ds.every * TICK_HZ));
  for (const entry of structuresOf(w)) {
    const e = entry.ent;
    if (!e.alive || !ds.units.includes(e.def)) continue;
    // what is left of the old seal goes; the new one lasts until the seal ends
    for (let i = e.shields.length - 1; i >= 0; i--) if (e.shields[i].src === e.id) { e.shield -= e.shields[i].amount; e.shields.splice(i, 1); }
    if (e.shield < 0) e.shield = 0;
    addShield(w, null, e, ds.amount, ds.until - w.time);
    e.shields[e.shields.length - 1].src = e.id;
  }
}

const shadeScratch: Entity[] = [];
function ringshadeMult(w: World, src: Entity | null, dst: Entity, raw: number): number {
  const rs = w.rules.ringshade;
  if (!rs || !src || dst.kind !== 'structure' || w.suddenDeath || !rs.units.includes(dst.def)) return raw;
  // (fighters and what they own: summons, their projectiles and zones — never Wicks or towers)
  if (src.kind === 'minion' || src.kind === 'structure' || !w.creditFighter(src)) return raw;
  const reach = (dst.stats.range > 0 ? dst.stats.range : 7) + dst.radius;
  const n0 = w.query(dst.x, dst.y, reach, shadeScratch);
  let n = 0;
  for (let i = 0; i < n0; i++) {
    const u = shadeScratch[i];
    if (u.kind === 'minion' && u.alive && u.team === src.team && (u.x - dst.x) * (u.x - dst.x) + (u.y - dst.y) * (u.y - dst.y) <= reach * reach) n++;
  }
  shadeScratch.length = 0;
  const m = rs.mult + (1 - rs.mult) * Math.min(1, n / rs.wicks);
  // too few of the striker's Wicks in the ring: the blow lands muffled (the 'damage' event says `shaded`)
  if (m < 1) w.hitShaded = true;
  return raw * m;
}

function gorgeWindMult(w: World, src: Entity | null, dst: Entity, raw: number): number {
  const gw = w.rules.gorgeWind;
  const s = w.gorgeWind;
  if (!gw || s <= 0) return raw;
  let m = 1;
  if (src && src.kind === 'minion') m *= 1 + s * gw.wickDamage;
  if (dst.kind === 'structure') m *= 1 + s * gw.structureTaken;
  return raw * m;
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
  w.hooks.modifyDamage.push((ww, src, dst, raw) => ringshadeMult(ww, src, dst, raw));
  w.hooks.modifyDamage.push((ww, src, dst, raw) => gorgeWindMult(ww, src, dst, raw));
  w.hooks.damage.push((ww, src, dst, _a, info) => rampTrack(ww, src, dst, info));
}
