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
// W4 gameplay g3 (the lab):
//   toggleWaves       Wicks on/off (setup.practice.waves, default on); turning them off clears the roads (no bounty)
//                     and no wave spawns while off (the schedule keeps running, so turning them on resumes the clock)
//   toggleStructures  structures on/off (setup.practice.structures, default on): off, they neither shoot nor take
//                     damage (hooks.canDamage both ways; towerSystem skips)
//   teleport          the fighter to (x, y) when that point is walkable (orders and path cleared)
//   dummyStats        training-dummy hp / armor / resist (clamped 100–100000 / 0–500), for every dummy now and later
//   resetMeter        zero this seat's damage meter; clearDummies removes every training dummy
// Damage meter: per seat, damage its fighter (or its summons) deals to anything hostile — total, last hit, the
// current burst (hits with no gap of PRACTICE_BURST_GAP s: damage, length, per second) and the last 5 s.
// WorldView.practice carries the switches, the dummy's stats and the meters (null outside practice).
// The sparring fighter and other maps are session choices (setup.practice.sparring / mode, local_session.ts).

import type { Command, PlayerId, PracticeMeter, PracticeView } from '../../contracts/sim.ts';
import { killEntity } from '../combat.ts';
import { NEUTRAL_TEAM, SLOT_COUNT, type Buff, type Entity, type Player } from '../entity.ts';
import { computeStats } from '../stats.ts';
import { respawnFighter, spawnUnit } from '../spawn.ts';
import { seatHome, seatState, setSeatLevel } from '../units/fighters.ts';
import { behaviorOf, getExt, setExt } from '../units/common.ts';
import type { World } from '../world.ts';
import { matchOf } from './match.ts';
import { dcos, dsin } from '../dmath.ts';

export const PRACTICE_GOLD_GRANT = 5000;
export const PRACTICE_GOLD_FLOOR = 50000;
export const DUMMY_DISTANCE = 4;
export const DUMMY_RESET = 4;
/** setup.practice.dummies is UI input: a typo must not spawn a million units */
export const MAX_SETUP_DUMMIES = 20;

export const PRACTICE_BURST_GAP = 3;
const RECENT_WINDOW = 5;
const DUMMY_BUFF = 'practice_dummy_stats';

interface DummyState { lastHit: number }
interface MeterState { dealt: number; last: number; burst: number; burstStart: number; burstLast: number; hits: number[] }
interface PracticeState {
  waves: boolean; structures: boolean;
  /** dummyStats overrides (null = the unit's own) */
  dummy: { hp: number | null; armor: number | null; resist: number | null };
  meters: Map<PlayerId, MeterState>;
}
const PKEY = 'practice';

export function isPractice(w: World): boolean { return w.queueDef.kind === 'practice'; }
function pstate(w: World): PracticeState | null { return (w.ext[PKEY] as PracticeState | undefined) ?? null; }
/** practice: Wicks spawn (true outside practice) */
export function practiceWaves(w: World): boolean { const s = pstate(w); return !s || s.waves; }
/** practice: structures shoot and can be hurt (true outside practice) */
export function practiceStructures(w: World): boolean { const s = pstate(w); return !s || s.structures; }

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
  applyDummyStats(w, e);
  return e;
}

/** dummyStats: a permanent stat buff that takes the dummy's hp / armor / resist to the practice overrides */
function applyDummyStats(w: World, e: Entity): void {
  const st = pstate(w);
  const i = e.buffs.findIndex((b) => b.id === DUMMY_BUFF);
  if (i >= 0) e.buffs.splice(i, 1);
  e.statsDirty = true;
  computeStats(w, e);
  if (!st || (st.dummy.hp === null && st.dummy.armor === null && st.dummy.resist === null)) { e.hp = e.maxHp; return; }
  const stats: Record<string, number> = {};
  if (st.dummy.hp !== null) stats.hp = st.dummy.hp - e.maxHp;
  if (st.dummy.armor !== null) stats.armor = st.dummy.armor - e.stats.armor;
  if (st.dummy.resist !== null) stats.resist = st.dummy.resist - e.stats.resist;
  const b: Buff = { id: DUMMY_BUFF, source: DUMMY_BUFF, remaining: Infinity, duration: Infinity, stacks: 1, src: -1, stats,
    empower: null, empowerLeft: 0, maxStacks: 1, onExpire: null, ctx: null, present: undefined };
  e.buffs.push(b);
  e.statsDirty = true;
  computeStats(w, e);
  e.hp = e.maxHp;
}
const isDummy = (e: Entity): boolean => !!(e.ext && getExt<DummyState>(e, 'dummy'));
const clampN = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

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
      spawnDummy(w, e.x + dcos(a) * DUMMY_DISTANCE, e.y + dsin(a) * DUMMY_DISTANCE, enemyTeam(w, e.team));
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
    case 'toggleWaves': {
      const st = pstate(w);
      if (!st) break;
      st.waves = !st.waves;
      if (!st.waves) for (const u of w.entities) if (u.kind === 'minion' && u.alive && !isDummy(u)) killEntity(w, u, null);
      break;
    }
    case 'toggleStructures': { const st = pstate(w); if (st) st.structures = !st.structures; break; }
    case 'teleport': {
      const x = cmd.x, y = cmd.y;
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || !e.alive) break;
      if (!w.nav.walkable(x, y)) break;
      e.x = x; e.y = y; e.vx = 0; e.vy = 0;
      e.order = 0; e.orderTarget = -1; e.path.length = 0; e.dash = null;
      w.hashDirty = true;
      break;
    }
    case 'dummyStats': {
      const st = pstate(w);
      if (!st) break;
      const hp = clampN(cmd.hp, 100, 100000), armor = clampN(cmd.armor, 0, 500), resist = clampN(cmd.resist, 0, 500);
      if (hp !== null) st.dummy.hp = hp;
      if (armor !== null) st.dummy.armor = armor;
      if (resist !== null) st.dummy.resist = resist;
      for (const u of w.entities) if (u.alive && isDummy(u)) applyDummyStats(w, u);
      break;
    }
    case 'resetMeter': { const st = pstate(w); if (st) st.meters.set(p.player, newMeter()); break; }
    case 'clearDummies': for (const u of w.entities) if (u.alive && isDummy(u)) killEntity(w, u, null); break;
  }
  w.emit({ e: 'announce', t: w.time, key: 'practice', player: p.player, team: p.team, params: { action: cmd.action } });
}

const newMeter = (): MeterState => ({ dealt: 0, last: 0, burst: 0, burstStart: -1, burstLast: -1e9, hits: [] });

/** after seats spawned: setup.practice.dummies in a row in front of seat 0 */
export function initPractice(w: World): void {
  if (!isPractice(w)) return;
  const sp = w.setup.practice;
  w.ext[PKEY] = { waves: sp?.waves !== false, structures: sp?.structures !== false, dummy: { hp: null, armor: null, resist: null },
    meters: new Map(w.players.filter((p) => !!p).map((p) => [p.player, newMeter()])) } satisfies PracticeState;
  practiceView(w);
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

/** 'deaths' phase: infinite gold, dummy recovery, the practice view */
export function practiceSystem(w: World): void {
  if (!isPractice(w)) return;
  practiceView(w);
  if (w.setup.practice?.infiniteGold) for (const p of w.players) if (p && p.gold < PRACTICE_GOLD_FLOOR) p.gold = PRACTICE_GOLD_FLOOR;
  for (const e of w.entities) {
    const d = e.ext ? getExt<DummyState>(e, 'dummy') : undefined;
    if (!d || !e.alive) continue;
    if (e.hp < e.maxHp && w.time - d.lastHit >= DUMMY_RESET) e.hp = e.maxHp;
  }
}

/** WorldView.practice from the practice state */
function practiceView(w: World): void {
  const st = pstate(w);
  if (st) {
    const meters: PracticeMeter[] = [];
    for (const [player, m] of st.meters) {
      const since = w.time - RECENT_WINDOW;
      while (m.hits.length >= 2 && m.hits[0] < since) m.hits.splice(0, 2);
      let recent = 0;
      for (let i = 0; i < m.hits.length; i += 2) recent += m.hits[i + 1];
      const burstTime = m.burstStart >= 0 ? Math.max(0, m.burstLast - m.burstStart) : 0;
      meters.push({ player, dealt: m.dealt, last: m.last, burst: m.burst, burstTime, burstDps: m.burst / Math.max(1, burstTime), recent5: recent });
    }
    const d = dummyUnitId(w);
    const def = d ? w.idx.units.get(d) : undefined;
    const view: PracticeView = {
      waves: st.waves, structures: st.structures, noCooldowns: w.noCooldowns, meters,
      dummy: { hp: st.dummy.hp ?? def?.base.hp ?? 0, armor: st.dummy.armor ?? def?.base.armor ?? 0, resist: st.dummy.resist ?? def?.base.resist ?? 0 },
    };
    w.practice = view;
  }
}

export function installPractice(w: World): void {
  w.hooks.command.practice = (ww, p, cmd) => practiceCommand(ww, p, cmd as Extract<Command, { type: 'practice' }>);
  w.hooks.damage.push((ww, src, dst, amount) => {
    const d = dst.ext ? getExt<DummyState>(dst, 'dummy') : undefined;
    if (d) d.lastHit = ww.time;
    const st = pstate(ww);
    if (!st) return;
    const f = ww.creditFighter(src);
    if (!f || !f.player || f.team === dst.team || !(amount > 0)) return;
    let m = st.meters.get(f.player.player);
    if (!m) { m = newMeter(); st.meters.set(f.player.player, m); }
    m.dealt += amount; m.last = amount;
    if (ww.time - m.burstLast > PRACTICE_BURST_GAP) { m.burst = 0; m.burstStart = ww.time; }
    m.burst += amount; m.burstLast = ww.time;
    m.hits.push(ww.time, amount);
  });
  // structures off: they neither shoot nor take damage
  w.hooks.canDamage.push((ww, src, dst) => practiceStructures(ww) || !((src && src.kind === 'structure') || dst.kind === 'structure'));
}
