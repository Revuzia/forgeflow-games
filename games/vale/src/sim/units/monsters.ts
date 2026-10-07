// VALE sim — neutral camps and objectives from MapDef.camps (CONTRACT §5.4).
//
// Camps exist when rules.jungle is true. Every unit of a camp spawns at `firstSpawn` (match
// seconds) on team NEUTRAL (−1: hostile to everyone, gives no vision) and the whole camp respawns
// `respawn` s after its LAST unit died.
// Monsters are passive until damaged: the attacker (the damaging unit itself — a summon, not its
// owner) becomes the target of every idle unit of that camp. A monster resets when it is more
// than behavior.leash m from its home spot, or when its target is gone (dead, invisible,
// untargetable) and no other recent attacker of the camp is within the leash: it walks home
// invulnerable, healing behavior.resetRegen × max hp per second, and arrives at full hp with its
// statuses cleared. Monster abilities (UnitDef.abilities, rank 1) are cast at the target whenever
// one is ready and in reach.
//
// Objectives: when a unit with UnitDef.onTakedownTeamBuff dies, or the last unit of an
// `objective` camp dies, the killing team (the credited fighter's, else the killing unit's) gets
// the team buff (TeamBuffDef: stats + passives for fighters, minionStats for its minions, for
// `duration` s or the rest of the match), TeamView.objectives records the buff id, and 'objective'
// + announce 'objective_taken' { params.unit } are emitted. WorldView.objectives lists every
// objective camp (id, first unit, where, alive, respawnIn).

import type { MapDefT } from '../../contracts/catalog.ts';
import type { ObjectiveTimerView } from '../../contracts/sim.ts';
import { TICK_DT } from '../../contracts/sim.ts';
import { attackable } from '../attack.ts';
import { addTeamBuff } from '../core.ts';
import { NEUTRAL_TEAM, ORDER_ATTACK, ORDER_MOVE, type Entity } from '../entity.ts';
import { issueAttack, issueMove, issueStop } from '../movement.ts';
import { spawnUnit } from '../spawn.ts';
import { clearStatuses } from '../status.ts';
import type { World } from '../world.ts';
import { behaviorOf, dist2, getExt, setExt, useUnitAbilities } from './common.ts';

type CampDef = MapDefT['camps'][number];
interface CampEntry {
  def: CampDef;
  units: Entity[];
  /** world time of the next (re)spawn; −1 while the camp is up */
  spawnAt: number;
  /** recent attackers of the camp (entity id → last hit time) */
  attackers: Map<number, number>;
  timer: ObjectiveTimerView | null;
}
interface MonsterState { camp: CampEntry; homeX: number; homeY: number; target: number; resetting: boolean }
interface CampsState { list: CampEntry[] }
const KEY = 'camps';
const MKEY = 'monster';
/** an attacker counts for re-targeting this long after its last hit */
const ATTACKER_MEMORY = 6;

function camps(w: World): CampsState { return w.ext[KEY] as CampsState; }
export function monsterState(e: Entity): MonsterState | undefined { return getExt<MonsterState>(e, MKEY); }

/** objective monsters (team-buff carriers and units of objective camps) pay 'objective' gold */
export function isObjectiveUnit(e: Entity): boolean {
  if (e.unit?.onTakedownTeamBuff) return true;
  const m = monsterState(e);
  return !!m && m.camp.def.objective;
}

export function initCamps(w: World): void {
  const st: CampsState = { list: [] };
  w.ext[KEY] = st;
  if (!w.rules.jungle) return;
  for (const def of w.mapDef.camps) {
    const entry: CampEntry = { def, units: [], spawnAt: def.firstSpawn, attackers: new Map(), timer: null };
    if (def.objective && def.units.length > 0) {
      const u = def.units[0];
      entry.timer = { id: def.id, unit: u.unit, at: [u.at[0], u.at[1]], alive: false, respawnIn: Math.max(0, def.firstSpawn - w.time) };
      w.objectives.push(entry.timer);
    }
    st.list.push(entry);
  }
}

function spawnCamp(w: World, c: CampEntry): void {
  c.units = [];
  c.attackers.clear();
  c.spawnAt = -1;
  for (const u of c.def.units) {
    const e = spawnUnit(w, u.unit, NEUTRAL_TEAM, u.at[0], u.at[1]);
    e.autoAttack = false;
    setExt<MonsterState>(e, MKEY, { camp: c, homeX: e.x, homeY: e.y, target: -1, resetting: false });
    c.units.push(e);
  }
}

/** 'deaths' phase: camp (re)spawns + objective timer views */
export function campSystem(w: World): void {
  for (const c of camps(w).list) {
    if (c.spawnAt >= 0 && w.time + 1e-9 >= c.spawnAt) spawnCamp(w, c);
    if (c.timer) {
      const alive = c.units.some((u) => u.alive);
      c.timer.alive = alive;
      c.timer.respawnIn = alive || c.spawnAt < 0 ? 0 : Math.max(0, c.spawnAt - w.time);
    }
  }
}

function startReset(w: World, e: Entity, m: MonsterState): void {
  m.resetting = true;
  m.target = -1;
  e.invulnerable = true;
  issueMove(w, e, m.homeX, m.homeY, false);
}

/** 'ai' phase */
export function monsterSystem(w: World): void {
  for (const c of camps(w).list) {
    for (const e of c.units) {
      if (!e.alive || !e.unit) continue;
      const m = monsterState(e)!;
      const b = behaviorOf(e.unit);
      if (m.resetting) {
        if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * b.resetRegen * TICK_DT);
        if (dist2(e, m.homeX, m.homeY) < 0.25 || e.order !== ORDER_MOVE) {
          m.resetting = false;
          e.invulnerable = false;
          e.hp = e.maxHp;
          clearStatuses(w, e);
          issueStop(w, e);
        }
        continue;
      }
      if (m.target < 0) continue;
      let t = w.live(m.target);
      if (!t || !attackable(w, e, t) || dist2(t, m.homeX, m.homeY) > (b.leash + 2) * (b.leash + 2)) t = nextAttacker(w, e, c, m, b.leash);
      if (!t || dist2(e, m.homeX, m.homeY) > b.leash * b.leash) { startReset(w, e, m); continue; }
      m.target = t.id;
      if (e.order !== ORDER_ATTACK || e.orderTarget !== t.id) issueAttack(w, e, t);
      useUnitAbilities(w, e, t);
    }
  }
}

function nextAttacker(w: World, e: Entity, c: CampEntry, m: MonsterState, leash: number): Entity | null {
  let best: Entity | null = null, bestT = -Infinity;
  for (const [id, t] of c.attackers) {
    if (w.time - t > ATTACKER_MEMORY) continue;
    const u = w.live(id);
    if (!u || !attackable(w, e, u) || dist2(u, m.homeX, m.homeY) > leash * leash) continue;
    if (t > bestT || (t === bestT && best && u.id < best.id)) { bestT = t; best = u; }
  }
  return best;
}

function onDamage(w: World, src: Entity | null, dst: Entity): void {
  if (dst.kind !== 'monster' || !src || !src.alive) return;
  const m = monsterState(dst);
  if (!m) return;
  m.camp.attackers.set(src.id, w.time);
  for (const u of m.camp.units) {
    const um = monsterState(u);
    if (!u.alive || !um || um.resetting || um.target >= 0) continue;
    um.target = src.id;
  }
}

/** team buff + 'objective' event for a takedown (monsters and structures) */
export function grantObjective(w: World, victim: Entity, team: number): void {
  if (team < 0 || team >= w.teams.length) return;
  const buff = victim.unit?.onTakedownTeamBuff;
  if (buff && w.idx.teamBuffs.has(buff)) {
    addTeamBuff(w, team, buff);
    w.teams[team].objectives.push(buff);
  }
  w.emit({ e: 'objective', t: w.time, unit: victim.def, team, buff });
  w.emit({ e: 'announce', t: w.time, key: 'objective_taken', team, params: { unit: victim.def } });
}

function onDeath(w: World, victim: Entity, killer: Entity | null): void {
  const m = monsterState(victim);
  if (!m) return;
  const c = m.camp;
  const last = c.units.every((u) => !u.alive);
  if (last) c.spawnAt = w.time + c.def.respawn;
  const credit = w.creditFighter(killer);
  const team = credit ? credit.team : killer && killer.team >= 0 ? killer.team : -1;
  if (team < 0) return;
  if (victim.unit?.onTakedownTeamBuff || (c.def.objective && last)) grantObjective(w, victim, team);
}

export function installMonsters(w: World): void {
  w.hooks.damage.push((ww, src, dst) => onDamage(ww, src, dst));
  w.hooks.death.push((ww, victim, killer) => onDeath(ww, victim, killer));
}
