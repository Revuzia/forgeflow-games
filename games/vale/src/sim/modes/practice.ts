// VALE sim — the practice tool (CONTRACT §5.5: queue.kind === 'practice').
//
// Only a practice queue honours MatchSetup.practice and the `practice` command family; anywhere
// else those commands are ignored. Setup switches: startLevel (core spawnFighter), noCooldowns
// (World.noCooldowns), infiniteGold (every seat's gold is topped up to PRACTICE_GOLD_FLOOR each
// tick), dummies (that many training dummies in front of seat 0 at the start).
// Commands (per seat):
//   gold            +PRACTICE_GOLD_GRANT gold (not counted as earned)
//   level           +1 level (xp progress restarts)
//   resetCooldowns  every ability / spell / item cooldown, recharge and charge refilled
//   toggleCooldowns flips no-cooldown mode (turning it on also resets cooldowns)
//   spawnDummy      a training dummy DUMMY_DISTANCE m in front of the fighter: the first unit in
//                   catalog order with behavior.dummy === true (nothing happens if there is none),
//                   on an enemy team (two teams: the other one; otherwise neutral). Dummies never
//                   attack and return to full hp DUMMY_RESET s after the last hit.
//   heal            full hp and resource (a dead fighter respawns on the spot of its seat home)
//   resetMatch      the facade rebuilds the match from the same setup (new world, tick 0)

import type { Command } from '../../contracts/sim.ts';
import { NEUTRAL_TEAM, SLOT_COUNT, type Entity, type Player } from '../entity.ts';
import { respawnFighter, spawnUnit } from '../spawn.ts';
import { seatHome, seatState, setSeatLevel } from '../units/fighters.ts';
import { behaviorOf, getExt, setExt } from '../units/common.ts';
import type { World } from '../world.ts';
import { matchOf } from './match.ts';

export const PRACTICE_GOLD_GRANT = 5000;
export const PRACTICE_GOLD_FLOOR = 50000;
export const DUMMY_DISTANCE = 4;
export const DUMMY_RESET = 4;
/** setup.practice.dummies is UI input: a typo must not spawn a million units */
export const MAX_SETUP_DUMMIES = 20;

interface DummyState { lastHit: number }

export function isPractice(w: World): boolean { return w.queueDef.kind === 'practice'; }

/** the catalog's training dummy unit id (first unit with behavior.dummy === true) */
export function dummyUnitId(w: World): string | null {
  for (const u of w.catalog.units) if (behaviorOf(u).dummy) return u.id;
  return null;
}

export function spawnDummy(w: World, x: number, y: number, team: number): Entity | null {
  const id = dummyUnitId(w);
  if (!id) return null;
  const e = spawnUnit(w, id, team, x, y);
  e.autoAttack = false;
  setExt<DummyState>(e, 'dummy', { lastHit: -1e9 });
  return e;
}

function enemyTeam(w: World, team: number): number { return w.teams.length === 2 ? 1 - team : NEUTRAL_TEAM; }

export function resetCooldowns(w: World, e: Entity): void {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = e.slots[i];
    if (!s) continue;
    s.cooldown = 0; s.rechargeTimer = 0; s.recastLock = 0; s.deferredCd = 0;
    if (s.maxCharges !== undefined) s.charges = s.maxCharges;
    if (s.stash) s.stash.clear();
  }
  if (e.player) e.player.itemCooldowns.fill(0);
}

export function practiceCommand(w: World, p: Player, cmd: Extract<Command, { type: 'practice' }>): void {
  if (!isPractice(w)) return;
  const e = p.ent;
  if (!e) return;
  switch (cmd.action) {
    case 'gold': p.gold += PRACTICE_GOLD_GRANT; break;
    case 'level': setSeatLevel(w, p, e.level + 1); break;
    case 'resetCooldowns': resetCooldowns(w, e); break;
    case 'toggleCooldowns':
      w.noCooldowns = !w.noCooldowns;
      if (w.noCooldowns) resetCooldowns(w, e);
      break;
    case 'spawnDummy': {
      const a = e.facing;
      spawnDummy(w, e.x + Math.cos(a) * DUMMY_DISTANCE, e.y + Math.sin(a) * DUMMY_DISTANCE, enemyTeam(w, e.team));
      break;
    }
    case 'heal':
      if (!e.alive) {
        const st = seatState(w, p.player);
        if (st) st.respawnAt = -1;
        const [x, y] = seatHome(w, p.seat);
        respawnFighter(w, e, x, y);
      }
      e.hp = e.maxHp;
      if (e.resource && e.resource.model === 'pool') e.res = e.maxRes;
      if (e.resource && e.resource.model === 'heat') { e.res = 0; e.overheat = 0; }
      break;
    case 'resetMatch': matchOf(w).resetRequested = true; break;
  }
  w.emit({ e: 'announce', t: w.time, key: 'practice', player: p.player, team: p.team, params: { action: cmd.action } });
}

/** after seats spawned: setup.practice.dummies in a row in front of seat 0 */
export function initPractice(w: World): void {
  if (!isPractice(w)) return;
  const raw = w.setup.practice?.dummies;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_SETUP_DUMMIES, Math.max(0, Math.floor(raw))) : 0;
  const p0 = w.players.find((p) => !!p);
  const e = p0?.ent;
  if (!e || n === 0) return;
  const cx = w.mapDef.size[0] / 2, cy = w.mapDef.size[1] / 2;
  let dx = cx - e.x, dy = cy - e.y;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= l; dy /= l;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 2.5;
    spawnDummy(w, e.x + dx * (DUMMY_DISTANCE + 2) - dy * off, e.y + dy * (DUMMY_DISTANCE + 2) + dx * off, enemyTeam(w, e.team));
  }
}

/** 'deaths' phase: infinite gold, dummy recovery */
export function practiceSystem(w: World): void {
  if (!isPractice(w)) return;
  if (w.setup.practice?.infiniteGold) for (const p of w.players) if (p && p.gold < PRACTICE_GOLD_FLOOR) p.gold = PRACTICE_GOLD_FLOOR;
  for (const e of w.entities) {
    const d = e.ext ? getExt<DummyState>(e, 'dummy') : undefined;
    if (!d || !e.alive) continue;
    if (e.hp < e.maxHp && w.time - d.lastHit >= DUMMY_RESET) e.hp = e.maxHp;
  }
}

export function installPractice(w: World): void {
  w.hooks.command.practice = (ww, p, cmd) => practiceCommand(ww, p, cmd as Extract<Command, { type: 'practice' }>);
  w.hooks.damage.push((ww, _s, dst) => {
    const d = dst.ext ? getExt<DummyState>(dst, 'dummy') : undefined;
    if (d) d.lastHit = ww.time;
  });
}
