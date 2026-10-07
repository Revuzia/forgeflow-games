// VALE sim — creating fighters, units and summons; respawning.
//
// The only places that turn catalog records into entities. Other lanes (units, economy, modes)
// call spawnUnit / respawnFighter instead of building entities by hand, so passives, slots,
// stats and hooks are always wired the same way.

import type { SeatSetup } from '../contracts/sim.ts';
import { setupFighterSlots, setupUnitSlots } from './abilities.ts';
import { killEntity } from './combat.ts';
import { anchorPoint, ranked } from './effects.ts';
import { DamageLog, Player, type EffOf, type EffectCtx, type Entity } from './entity.ts';
import { computeStats, markStatsDirty } from './stats.ts';
import { clearStatuses } from './status.ts';
import { addPassive, fireTrigger } from './triggers.ts';
import { FIGHTER_SIGHT } from './vision.ts';
import type { World } from './world.ts';

const tmp = { x: 0, y: 0 };
/** structures block nav cells within their radius + this, so paths go around them */
export const STRUCTURE_NAV_CLEARANCE = 0.35;

/** default spawn point for a seat: its team base, else the FFA ring, else the map centre */
export function seatSpawnPoint(w: World, seat: SeatSetup): [number, number] {
  const m = w.mapDef;
  const base = m.bases.find((b) => b.team === seat.team);
  if (base) return [base.spawn[0], base.spawn[1]];
  if (m.spawns.length > 0) { const p = m.spawns[seat.player % m.spawns.length]; return [p[0], p[1]]; }
  return [m.size[0] / 2, m.size[1] / 2];
}

/**
 * The part of a seat's loadout the sim honours: known ids in the rules' pool (setup records'
 * `pools`, empty = every pool), no duplicates, at most `setup.spellSlots` spells (2 slots) and
 * `setup.boonSlots` boons. Spells keep their slot positions (a dropped one leaves its slot empty).
 * SESSION validates choices for the UI, but the sim is the authority: a boon listed twice would
 * otherwise stack its stats, and a spell from another mode's pool would sneak in.
 */
export function effectiveLoadout(w: World, seat: SeatSetup): { spells: (string | null)[]; boons: string[] } {
  const pool = w.rules.itemPool;
  const inPool = (pools: readonly string[]): boolean => pools.length === 0 || pools.includes(pool);
  const setup = w.catalog.setup;
  const spells: (string | null)[] = [];
  const raw = seat.loadout?.spells ?? [];
  for (let k = 0; k < Math.min(2, setup.spellSlots); k++) {
    const id = raw[k];
    const d = typeof id === 'string' ? w.idx.spells.get(id) : undefined;
    spells.push(d && inPool(d.pools) && !spells.includes(id) ? id : null);
  }
  const boons: string[] = [];
  for (const id of seat.loadout?.boons ?? []) {
    if (boons.length >= setup.boonSlots) break;
    const d = typeof id === 'string' ? w.idx.boons.get(id) : undefined;
    if (d && inPool(d.pools) && !boons.includes(id)) boons.push(id);
  }
  return { spells, boons };
}

/** create a seat's Player + fighter entity (level, gold, kit, spells, boons, full hp/resource) */
export function spawnFighter(w: World, seat: SeatSetup, x?: number, y?: number): Entity {
  const def = w.idx.fighters.get(seat.fighter);
  if (!def) throw new Error(`spawnFighter: unknown fighter '${seat.fighter}'`);
  const p = new Player(seat);
  w.players[seat.player] = p;
  const e = w.create('fighter', def.id, seat.team);
  e.owner = seat.player;
  e.fighter = def;
  e.player = p;
  p.ent = e; p.entity = e.id;
  e.skin = seat.skin;
  e.radius = def.collisionRadius;
  e.attackDef = def.attack;
  e.resource = w.idx.resources.get(def.resource) ?? null;
  e.sight = def.sightRange ?? FIGHTER_SIGHT;
  e.dmgLog = new DamageLog();
  const [sx, sy] = x !== undefined && y !== undefined ? [x, y] : seatSpawnPoint(w, seat);
  placeWalkable(w, e, sx, sy);
  e.facing = Math.atan2(w.mapDef.size[1] / 2 - e.y, w.mapDef.size[0] / 2 - e.x);

  const practiceLevel = w.queueDef.kind === 'practice' ? w.setup.practice?.startLevel : undefined;
  const lvl = typeof practiceLevel === 'number' && Number.isFinite(practiceLevel) ? Math.floor(practiceLevel) : w.rules.startLevel;
  e.level = Math.max(1, Math.min(w.rules.maxLevel, lvl));
  p.skillPoints = e.level;
  p.gold = w.rules.startGold;

  addPassive(w, e, def.kit.passive, 'passive', 'kit');
  p.passive = def.kit.passive.id;
  const loadout = effectiveLoadout(w, seat);
  setupFighterSlots(w, e, loadout.spells);
  for (const id of loadout.boons) addPassive(w, e, w.idx.boons.get(id)!, 'boon', `boon:${id}`);
  // team buffs already active (late joiners / respawned teams)
  const team = w.teams[seat.team];
  if (team) for (const tb of team.buffs) for (const pd of tb.def.passives) addPassive(w, e, pd, 'passive', `team:${tb.id}`);

  markStatsDirty(e);
  computeStats(w, e);
  e.hp = e.maxHp;
  e.res = e.resource && e.resource.startFull && e.resource.model !== 'heat' ? e.maxRes : 0;
  for (const h of w.hooks.spawn) h(w, e);
  fireTrigger(w, e, 'spawn', null, 0);
  return e;
}

function placeWalkable(w: World, e: Entity, x: number, y: number): void {
  // never off the map: a summon aimed past the edge lands on the nearest open cell inside it
  const S = w.mapDef.size;
  x = Math.max(0, Math.min(S[0] - 1e-3, x)); y = Math.max(0, Math.min(S[1] - 1e-3, y));
  if (!w.nav.walkable(x, y) && w.nav.nearestWalkable(x, y, tmp)) { x = tmp.x; y = tmp.y; }
  e.x = x; e.y = y;
  w.hashDirty = true;
}

export interface SpawnUnitOpts {
  /** owning seat (summons, wards) */
  owner?: number;
  /** creating entity (kill credit, maxAlive bookkeeping) */
  ownerEid?: number;
  level?: number;
  /** lifetime in seconds (summons, wards); dies without credit when it runs out */
  duration?: number;
  facing?: number;
}

/** create a unit from a UnitDef (minion, monster, structure, summon, ward, pickup) */
export function spawnUnit(w: World, unitId: string, team: number, x: number, y: number, opts: SpawnUnitOpts = {}): Entity {
  const def = w.idx.units.get(unitId);
  if (!def) throw new Error(`spawnUnit: unknown unit '${unitId}'`);
  const e = w.create(def.kind, def.id, team);
  e.unit = def;
  e.radius = def.collisionRadius;
  e.attackDef = def.attack ?? null;
  e.sight = def.sightRange;
  e.level = Math.max(1, opts.level ?? 1);
  e.static = def.kind === 'structure' || def.kind === 'ward' || def.kind === 'pickup';
  // monsters only fight back (camp AI drives them); wards/pickups never attack
  e.autoAttack = def.kind !== 'monster';
  e.owner = opts.owner ?? -1;
  e.ownerEid = opts.ownerEid ?? -1;
  if (opts.facing !== undefined) e.facing = opts.facing;
  if (e.static) { e.x = x; e.y = y; w.hashDirty = true; } else placeWalkable(w, e, x, y);
  if (def.kind === 'structure' && e.radius > 0) {
    e.navBlockR = e.radius + STRUCTURE_NAV_CLEARANCE;
    w.nav.addObstacle(e.x, e.y, e.navBlockR);
  }
  if (def.passive) addPassive(w, e, def.passive, 'passive', 'unit');
  setupUnitSlots(w, e);
  markStatsDirty(e);
  computeStats(w, e);
  e.hp = e.maxHp;
  e.res = e.maxRes;
  if (opts.duration !== undefined && opts.duration > 0) e.expireAt = w.time + opts.duration;
  for (const h of w.hooks.spawn) h(w, e);
  fireTrigger(w, e, 'spawn', null, 0);
  return e;
}

/** DSL `summon`: count units around the anchor; maxAlive kills the caster's oldest of that unit */
export function summonUnits(w: World, eff: EffOf<'summon'>, ctx: EffectCtx): void {
  const c = ctx.caster;
  anchorPoint(ctx, eff.at, tmp);
  const ox = tmp.x, oy = tmp.y;
  const duration = ranked(eff.duration, ctx.rank);
  const n = Math.max(1, eff.count);
  for (let i = 0; i < n; i++) {
    const a = c.facing + (i * Math.PI * 2) / n;
    const off = n > 1 ? 1 : 0;
    spawnUnit(w, eff.unit, c.team, ox + Math.cos(a) * off, oy + Math.sin(a) * off,
      { owner: c.owner, ownerEid: c.id, level: c.level, duration, facing: c.facing });
  }
  if (eff.maxAlive !== undefined) {
    const mine: Entity[] = [];
    for (const e of w.entities) if (e.alive && !e.removed && e.ownerEid === c.id && e.def === eff.unit) mine.push(e);
    for (let i = 0; i < mine.length - eff.maxAlive; i++) killEntity(w, mine[i], null);
  }
}

/** bring a dead fighter back (economy/modes call this when the respawn timer ends) */
export function respawnFighter(w: World, e: Entity, x?: number, y?: number): void {
  if (e.alive || e.kind !== 'fighter') return;
  e.alive = true;
  e.targetable = true;
  e.deathTime = -1;
  clearStatuses(w, e);
  e.removeAt = -1;
  const [sx, sy] = x !== undefined && y !== undefined ? [x, y] : e.player ? seatSpawnPoint(w, e.player.seat) : [e.x, e.y];
  placeWalkable(w, e, sx, sy);
  markStatsDirty(e);
  computeStats(w, e);
  e.hp = e.maxHp;
  e.res = e.resource && e.resource.startFull && e.resource.model !== 'heat' ? e.maxRes : 0;
  e.overheat = 0;
  e.atkCd = 0;
  e.lastHitBy = -1; e.lastHitAt = -1;
  if (e.player) { e.player.respawnIn = 0; w.emit({ e: 'respawn', t: w.time, player: e.player.player, entity: e.id }); }
  for (const h of w.hooks.spawn) h(w, e);
  fireTrigger(w, e, 'spawn', null, 0);
}
