// VALE sim — core system wiring.
//
// installCore(world) registers the core systems into their CONTRACT §5.1 phases:
//   commands  core commands (move/attack/stop/cast/levelUp); other types go to hooks.command
//   statuses  statuses, buffs, shields, marks, counters, forms, passive timers, ability slots, stats
//   regen     hp/resource regen, build decay, heat venting
//   casts     windups, channels, casts waiting for range        (abilities.ts)
//   attacks   basic attacks                                      (attack.ts)
//   projectiles                                                  (projectiles.ts)
//   zones     scheduled tasks (delayed areas, repeats) + zones   (zones.ts)
//   movement  dashes, displacements, walking, following zones, view states (movement.ts)
//   deaths    lifetime expiry of summons/wards                   (respawn/economy: other lanes)
//   vision    fog of war at 10 Hz                                (vision.ts)
// The 'ai', 'bots' and 'modes' phases are empty here: lanes UNITS, BOTS and MODES add theirs with
// world.addSystem(phase, fn), after installCore, so they run after core systems of that phase.

import type { CatalogT } from '../contracts/catalog.ts';
import { TICK_DT, type MatchSetup, type PlayerId } from '../contracts/sim.ts';
import { castSystem, levelUpAbility, tickSlots, tryCast } from './abilities.ts';
import { attackSystem } from './attack.ts';
import type { CatalogIndex } from './catalog_index.ts';
import { killEntity, tickShields } from './combat.ts';
import { SLOT_INDEX, type Entity } from './entity.ts';
import { finalizeStates, issueAttack, issueMove, issueStop, movementSystem } from './movement.ts';
import { projectileSystem } from './projectiles.ts';
import { hashString } from './rng.ts';
import { spawnFighter } from './spawn.ts';
import { computeStats, markStatsDirty } from './stats.ts';
import { tickBuffs, tickCounters, tickForm, tickMarks, tickStatuses } from './status.ts';
import { addPassive, removePassives, tickTriggers } from './triggers.ts';
import { VISION_INTERVAL_TICKS } from './vision.ts';
import { World } from './world.ts';
import { syncFollowingZones, zoneSystem } from './zones.ts';

// ── commands ────────────────────────────────────────────────────────────────────────────────────
export function commandSystem(w: World): void {
  const q = w.takeCommands();
  for (let i = 0; i < q.length; i++) {
    const { player, cmd } = q[i];
    const p = w.players[player];
    if (!p) continue;
    const e = p.ent;
    switch (cmd.type) {
      case 'move': if (e && e.alive) issueMove(w, e, cmd.x, cmd.y, !!cmd.attackMove); break;
      case 'attack': {
        const t = w.live(cmd.target);
        if (e && e.alive && t && t.team !== e.team) issueAttack(w, e, t);
        break;
      }
      case 'stop': if (e && e.alive) issueStop(w, e); break;
      case 'cast': if (e) tryCast(w, e, SLOT_INDEX[cmd.slot] ?? -1, cmd.x, cmd.y, cmd.target); break;
      case 'levelUp': if (e) levelUpAbility(w, e, cmd.slot); break;
      default: {
        const h = w.hooks.command[cmd.type];
        if (h) h(w, p, cmd);
      }
    }
  }
}

// ── statuses / timers ───────────────────────────────────────────────────────────────────────────
export function statusSystem(w: World): void {
  const list = w.entities;
  const dt = TICK_DT;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.kind === 'projectile' || e.kind === 'zone' || e.removed) continue;
    if (e.statuses.length) tickStatuses(w, e, dt);
    if (e.buffs.length) tickBuffs(w, e, dt);
    if (e.shields.length) tickShields(e, dt);
    if (e.marks.length) tickMarks(e, dt);
    if (e.counters.length) tickCounters(e, dt);
    if (e.formTimer >= 0) tickForm(w, e, dt);
    if (e.passives.length) tickTriggers(w, e, dt);
    if (e.statsDirty) computeStats(w, e);
    if (e.kind === 'fighter' || e.slots[0] !== null) tickSlots(w, e, dt);
  }
  // team buffs with a duration
  for (const t of w.teams) {
    for (let k = t.buffs.length - 1; k >= 0; k--) {
      const b = t.buffs[k];
      if (b.remaining === Infinity) continue;
      b.remaining -= dt;
      if (b.remaining <= 1e-9) removeTeamBuff(w, t.team, b.id);
    }
  }
}

// ── regen ───────────────────────────────────────────────────────────────────────────────────────
export function regenSystem(w: World): void {
  const list = w.entities;
  const dt = TICK_DT;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive || e.kind === 'projectile' || e.kind === 'zone') continue;
    const s = e.stats;
    if (s.hpRegen !== 0 && e.hp < e.maxHp) e.hp = Math.max(Math.min(e.hp, 1), Math.min(e.maxHp, e.hp + s.hpRegen * dt));
    const r = e.resource;
    if (!r) { if (s.resRegen > 0 && e.res < e.maxRes) e.res = Math.min(e.maxRes, e.res + s.resRegen * dt); continue; }
    switch (r.model) {
      case 'pool':
        if (e.res < e.maxRes) e.res = Math.min(e.maxRes, e.res + s.resRegen * dt);
        break;
      case 'build':
        e.resIdle += dt;
        if (s.resRegen !== 0) e.res = Math.max(0, Math.min(e.maxRes, e.res + s.resRegen * dt));
        if (r.decayPerSec && e.resIdle >= (r.decayDelay ?? 0) && e.res > 0) e.res = Math.max(0, e.res - r.decayPerSec * dt);
        break;
      case 'heat':
        if (e.overheat > 0) {
          e.overheat -= dt;
          if (e.overheat <= 1e-9) { e.overheat = 0; e.res = 0; }
        } else if (r.decayPerSec && e.res > 0) {
          e.resIdle += dt;
          if (e.resIdle >= (r.decayDelay ?? 0)) e.res = Math.max(0, e.res - r.decayPerSec * dt);
        }
        break;
      case 'none': break;
    }
  }
}

// ── deaths phase (core part): lifetimes ─────────────────────────────────────────────────────────
export function expirySystem(w: World): void {
  const list = w.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.expireAt >= 0 && e.alive && w.time + 1e-9 >= e.expireAt) { e.expireAt = -1; killEntity(w, e, null); }
  }
}

export function visionSystem(w: World): void {
  if (w.tick - w.vision.lastUpdateTick >= VISION_INTERVAL_TICKS) w.vision.update(w.entities, w.tick);
}

// ── team buffs (objectives grant them; modes/units call these) ──────────────────────────────────
export function addTeamBuff(w: World, team: number, buffId: string): void {
  const def = w.idx.teamBuffs.get(buffId);
  const t = w.teams[team];
  if (!def || !t) return;
  const existing = t.buffs.find((b) => b.id === buffId);
  if (existing) { existing.remaining = def.duration ?? Infinity; return; }
  t.buffs.push({ id: buffId, remaining: def.duration ?? Infinity, def });
  for (const e of w.entities) {
    if (e.team !== team) continue;
    if (e.kind === 'fighter') for (const pd of def.passives) addPassive(w, e, pd, 'passive', `team:${buffId}`);
    if (e.kind === 'fighter' || e.kind === 'minion') markStatsDirty(e);
  }
}
export function removeTeamBuff(w: World, team: number, buffId: string): void {
  const t = w.teams[team];
  if (!t) return;
  const k = t.buffs.findIndex((b) => b.id === buffId);
  if (k < 0) return;
  t.buffs.splice(k, 1);
  for (const e of w.entities) {
    if (e.team !== team) continue;
    if (e.kind === 'fighter') removePassives(w, e, `team:${buffId}`);
    if (e.kind === 'fighter' || e.kind === 'minion') markStatsDirty(e);
  }
}

// ── install + convenience constructor ───────────────────────────────────────────────────────────
export function installCore(w: World): void {
  w.addSystem('commands', commandSystem);
  w.addSystem('statuses', statusSystem);
  w.addSystem('regen', regenSystem);
  w.addSystem('casts', castSystem);
  w.addSystem('attacks', attackSystem);
  w.addSystem('projectiles', projectileSystem);
  w.addSystem('zones', zoneSystem);
  w.addSystem('movement', movementSystem);
  w.addSystem('movement', syncFollowingZones);
  w.addSystem('movement', finalizeStates);
  w.addSystem('deaths', expirySystem);
  w.addSystem('vision', visionSystem);
}

export interface CreateWorldOpts {
  /** spawn every seat's fighter at its default spawn point (default true) */
  spawnFighters?: boolean;
  idx?: CatalogIndex;
}

/** a World with core systems installed (and seat fighters spawned unless disabled) */
export function createWorld(catalog: CatalogT, setup: MatchSetup, opts: CreateWorldOpts = {}): World {
  const w = new World(catalog, setup, opts.idx);
  installCore(w);
  if (opts.spawnFighters !== false) {
    const seats = [...setup.seats].sort((a, b) => a.player - b.player);
    for (const s of seats) spawnFighter(w, s);
  }
  finalizeStates(w);
  w.vision.update(w.entities, w.tick);
  return w;
}

// ── determinism digest ──────────────────────────────────────────────────────────────────────────
function q(v: number): string { return Number.isFinite(v) ? (Math.round(v * 1e4) / 1e4).toString() : String(v); }
/** FNV-1a over the simulation-relevant state (ids, positions, hp, statuses, players, rng) */
export function stateDigest(w: World): string {
  let h = hashString(`${w.tick}`);
  const add = (s: string): void => { h = hashString(s, h); };
  for (const e of w.entities) {
    add(`${e.id}|${e.kind}|${e.def}|${e.team}|${q(e.x)}|${q(e.y)}|${q(e.hp)}|${q(e.shield)}|${q(e.res)}|${e.level}|${e.alive ? 1 : 0}|${e.state}`);
    for (const s of e.statuses) add(`${s.kind}:${q(s.remaining)}`);
    for (const b of e.buffs) add(`${b.id}:${b.stacks}:${q(b.remaining)}`);
  }
  for (const p of w.players) if (p) add(`${p.player}|${q(p.gold)}|${p.kills}|${p.deaths}|${p.assists}|${q(p.damageToFighters)}`);
  for (const s of [w.rng.combat, w.rng.ai, w.rng.spawn]) add(s.state().join(','));
  return h.toString(16).padStart(8, '0');
}

/** convenience for probes/tools: the fighter entity of a seat */
export function fighterOf(w: World, player: PlayerId): Entity | null { return w.players[player]?.ent ?? null; }
