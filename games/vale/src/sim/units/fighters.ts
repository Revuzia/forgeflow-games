// VALE sim — seat fighters: spawning, XP and levels, respawn timers, recall, fountain, shop zone
// (CONTRACT §5.4, §5.6).
//
// Spawning goes through core spawnFighter (stats, kit, battle spells, boons, resource pool, team
// buffs). Seats of one team stand on a small ring around their base spawn so they do not start
// stacked. The resource models live in core and are only listed here for reference:
//   pool  regenerates (regen + regenPerLevel); `res` costs are paid from it
//   build starts empty unless startFull; gainOnAttack / gainOnHitTaken / gainOnAbilityHit fill it;
//         after decayDelay s without a change it drains decayPerSec
//   heat  costs ADD heat; reaching max locks casting for overheatLock s, then it vents to 0;
//         otherwise it drains decayPerSec after decayDelay
//   none  no resource; costs of kind 'res' are free
//
// XP: Player.xp is progress inside the current level and xpToNext the step for the next one,
// `rules.xpTable[level − 1]` (a table shorter than maxLevel − 1 repeats its last step; 0 at max
// level). Every level grants one skill point (core setLevel → 'levelUp' event + levelUp triggers).
//
// Respawn: min(max, base + perLevel × (level − 1)) × lateGameMult once time ≥ lateGameRampAt
// × tuning.suddenDeathRespawnMult in sudden death. Team modes respawn at the base spawn; FFA maps at
// the `spawns` point farthest from living enemies. Modes may block respawns (eliminated seats).
//
// Recall: rules.recall + a base for the team. Channel of rules.recallTime s (default 8) with the
// 'recall' state/anim; cancelled by damage, any new order, cast, attack, dash, being moved
// (> RECALL_MOVE_TOLERANCE m), hard CC/taunt/fear, or death. On completion the fighter is put on
// its fountain. Auto-attacks are off while recalling.
//
// Fountain (rules.fountainHeals): allied fighters inside their base fountain regain
// tuning.fountainHealPerSec of max hp (and of a pool resource) per second; heat vents at the same rate.
// (rules.tuning keys default to the constants below — CONTRACT §5.6.)

import type { SeatSetup } from '../../contracts/sim.ts';
import { TICK_DT } from '../../contracts/sim.ts';
import { setLevel } from '../abilities.ts';
import { CC_FEAR, CC_HARD, CC_TAUNT, ORDER_NONE, type Entity, type Player } from '../entity.ts';
import { issueStop } from '../movement.ts';
import { respawnFighter, seatSpawnPoint, spawnFighter } from '../spawn.ts';
import type { World } from '../world.ts';

// defaults: rules.recallTime, rules.tuning.fountainHealPerSec / suddenDeathRespawnMult
export const DEFAULT_RECALL_TIME = 8;
export const FOUNTAIN_HEAL_PER_SEC = 0.15;
export const SUDDEN_DEATH_RESPAWN_MULT = 1.5;
/** metres a recalling fighter may be nudged (crowd separation) before the recall breaks */
export const RECALL_MOVE_TOLERANCE = 0.75;
/** radius of the ring seats of one team spawn on around the base spawn point */
export const SPAWN_RING = 1.6;

interface RecallState { t: number; dur: number; auto: boolean; seq: number; x: number; y: number }
export interface SeatState {
  /** world time the fighter comes back (−1: alive or not scheduled) */
  respawnAt: number;
  recall: RecallState | null;
  /** set by mode rules: this seat is out of the match (no respawn) */
  eliminated: boolean;
}
interface FightersState { seats: SeatState[] }
const KEY = 'fighters';

export function seatState(w: World, player: number): SeatState | undefined {
  return (w.ext[KEY] as FightersState | undefined)?.seats[player];
}

// ── spawning ────────────────────────────────────────────────────────────────────────────────────
/** spawn point of a seat (initial spawn and team-mode respawns): a ring slot around the base spawn */
export function seatHome(w: World, seat: SeatSetup): [number, number] {
  const base = w.mapDef.bases.find((b) => b.team === seat.team);
  if (!base) return seatSpawnPoint(w, seat);
  const mates = w.setup.seats.filter((s) => s.team === seat.team).sort((a, b) => a.player - b.player);
  const k = mates.findIndex((s) => s.player === seat.player);
  if (mates.length <= 1 || k < 0) return [base.spawn[0], base.spawn[1]];
  const a = (k / mates.length) * Math.PI * 2;
  return [base.spawn[0] + Math.cos(a) * SPAWN_RING, base.spawn[1] + Math.sin(a) * SPAWN_RING];
}

/** FFA respawn: the map spawn point farthest from every living enemy fighter (ties: lower index) */
export function ffaSpawnPoint(w: World, p: Player): [number, number] {
  const sp = w.mapDef.spawns;
  if (sp.length === 0) return seatSpawnPoint(w, p.seat);
  let best = 0, bestD = -1;
  for (let i = 0; i < sp.length; i++) {
    let dmin = Infinity;
    for (const q of w.players) {
      const f = q?.ent;
      if (!f || !f.alive || q.team === p.team) continue;
      const dx = f.x - sp[i][0], dy = f.y - sp[i][1];
      dmin = Math.min(dmin, dx * dx + dy * dy);
    }
    if (dmin > bestD) { bestD = dmin; best = i; }
  }
  return [sp[best][0], sp[best][1]];
}

/** spawn every seat's fighter (seat order) and initialise lane-SIM per-seat state */
export function spawnSeatFighters(w: World): void {
  const st: FightersState = { seats: [] };
  w.ext[KEY] = st;
  const seats = [...w.setup.seats].sort((a, b) => a.player - b.player);
  for (const seat of seats) {
    const [x, y] = seatHome(w, seat);
    const e = spawnFighter(w, seat, x, y);
    const p = e.player!;
    p.xpToNext = xpStep(w, e.level);
    st.seats[seat.player] = { respawnAt: -1, recall: null, eliminated: false };
  }
}

// ── XP / levels ─────────────────────────────────────────────────────────────────────────────────
/** xp needed to go from `level` to level + 1 (0 at max level) */
export function xpStep(w: World, level: number): number {
  const t = w.rules.xpTable;
  if (level >= w.rules.maxLevel || t.length === 0) return 0;
  return t[Math.min(level - 1, t.length - 1)];
}

/** add xp to a seat; levels up (possibly several times) through core setLevel */
export function grantXp(w: World, p: Player, amount: number): void {
  const e = p.ent;
  if (!e || !(amount > 0) || e.level >= w.rules.maxLevel) return;
  p.xp += amount;
  while (p.xpToNext > 0 && p.xp + 1e-9 >= p.xpToNext && e.level < w.rules.maxLevel) {
    p.xp -= p.xpToNext;
    setLevel(w, e, e.level + 1);
    p.xpToNext = xpStep(w, e.level);
  }
  if (e.level >= w.rules.maxLevel) { p.xp = 0; p.xpToNext = 0; }
}

/** jump a seat to a level (practice tool); xp progress restarts at 0 */
export function setSeatLevel(w: World, p: Player, level: number): void {
  const e = p.ent;
  if (!e) return;
  setLevel(w, e, level);
  p.xp = 0;
  p.xpToNext = xpStep(w, e.level);
}

// ── respawn ─────────────────────────────────────────────────────────────────────────────────────
export function respawnTime(w: World, e: Entity): number {
  const r = w.rules.respawn;
  let t = Math.min(r.max, r.base + r.perLevel * Math.max(0, e.level - 1));
  if (r.lateGameRampAt !== undefined && w.time >= r.lateGameRampAt) t *= r.lateGameMult ?? 1;
  if (w.suddenDeath) t *= w.rules.tuning?.suddenDeathRespawnMult ?? SUDDEN_DEATH_RESPAWN_MULT;
  return Math.max(0, t);
}

function onDeath(w: World, victim: Entity): void {
  if (victim.kind !== 'fighter' || !victim.player) return;
  const s = seatState(w, victim.player.player);
  if (!s) return;
  if (s.recall) cancelRecall(w, victim.player, false);
  const t = respawnTime(w, victim);
  s.respawnAt = w.time + t;
  victim.player.respawnIn = t;
}

/** 'deaths' phase: count respawn timers down and bring fighters back */
export function respawnSystem(w: World): void {
  const st = w.ext[KEY] as FightersState;
  for (const p of w.players) {
    if (!p) continue;
    const e = p.ent, s = st.seats[p.player];
    if (!e || !s) continue;
    if (e.alive) { p.respawnIn = 0; continue; }
    if (s.eliminated || s.respawnAt < 0) { p.respawnIn = 0; continue; }
    p.respawnIn = Math.max(0, s.respawnAt - w.time);
    if (w.time + 1e-9 < s.respawnAt) continue;
    const [x, y] = w.mapDef.bases.some((b) => b.team === p.team) ? seatHome(w, p.seat) : ffaSpawnPoint(w, p);
    s.respawnAt = -1;
    respawnFighter(w, e, x, y);
    p.respawnIn = 0;
  }
}

// ── recall ──────────────────────────────────────────────────────────────────────────────────────
export function recallTime(w: World): number { return w.rules.recallTime ?? DEFAULT_RECALL_TIME; }
function baseOf(w: World, team: number) { return w.mapDef.bases.find((b) => b.team === team); }

export function canRecall(w: World, p: Player): boolean {
  const e = p.ent;
  return !!e && e.alive && w.rules.recall && !!baseOf(w, p.team) && !e.cast && !e.dash &&
    (e.ccMask & (CC_HARD | CC_TAUNT | CC_FEAR)) === 0 && w.phase === 'live';
}

export function startRecall(w: World, p: Player): boolean {
  const s = seatState(w, p.player);
  const e = p.ent;
  if (!s || !e || s.recall || !canRecall(w, p)) return false;
  issueStop(w, e);
  const dur = recallTime(w);
  e.stateOverride = 'recall'; e.animOverride = 'recall'; e.stateOverrideDuration = dur;
  e.actionSeq++;
  s.recall = { t: 0, dur, auto: e.autoAttack, seq: e.actionSeq, x: e.x, y: e.y };
  e.autoAttack = false;
  p.recallProgress = 0;
  w.emit({ e: 'recall', t: w.time, player: p.player, state: 'start' });
  return true;
}

export function cancelRecall(w: World, p: Player, emit = true): void {
  const s = seatState(w, p.player);
  if (!s || !s.recall) return;
  endRecall(p, s);
  if (emit) w.emit({ e: 'recall', t: w.time, player: p.player, state: 'cancel' });
}

function endRecall(p: Player, s: SeatState): void {
  const e = p.ent;
  if (e && s.recall) {
    e.autoAttack = s.recall.auto;
    if (e.stateOverride === 'recall') { e.stateOverride = null; e.animOverride = ''; e.stateOverrideDuration = 0; e.actionSeq++; }
  }
  s.recall = null;
  p.recallProgress = 0;
}

/** 'casts' phase: advance recalls; anything the fighter did since the start breaks it */
export function recallSystem(w: World): void {
  const st = w.ext[KEY] as FightersState;
  for (const p of w.players) {
    const s = p ? st.seats[p.player] : undefined;
    if (!p || !s || !s.recall) continue;
    const e = p.ent!;
    const r = s.recall;
    const dx = e.x - r.x, dy = e.y - r.y;
    const broken = !e.alive || e.order !== ORDER_NONE || e.cast !== null || e.dash !== null || e.atkWindup >= 0 ||
      e.actionSeq !== r.seq || (e.ccMask & (CC_HARD | CC_TAUNT | CC_FEAR)) !== 0 ||
      dx * dx + dy * dy > RECALL_MOVE_TOLERANCE * RECALL_MOVE_TOLERANCE;
    if (broken) { cancelRecall(w, p); continue; }
    r.t += TICK_DT;
    p.recallProgress = Math.min(1, r.t / r.dur);
    if (r.t + 1e-9 < r.dur) continue;
    const base = baseOf(w, p.team);
    endRecall(p, s);
    if (base) {
      const tmp = { x: base.fountain.at[0], y: base.fountain.at[1] };
      if (!w.nav.walkable(tmp.x, tmp.y)) w.nav.nearestWalkable(tmp.x, tmp.y, tmp);
      e.x = tmp.x; e.y = tmp.y;
      e.path.length = 0; e.pathGoalX = NaN;
      w.hashDirty = true;
    }
    w.emit({ e: 'recall', t: w.time, player: p.player, state: 'done' });
  }
}

// ── fountain ────────────────────────────────────────────────────────────────────────────────────
/** 'regen' phase: fountain restoration (no heal events: it is ambient, not a play) */
export function fountainSystem(w: World): void {
  if (!w.rules.fountainHeals) return;
  const k = (w.rules.tuning?.fountainHealPerSec ?? FOUNTAIN_HEAL_PER_SEC) * TICK_DT;
  for (const base of w.mapDef.bases) {
    const [fx, fy] = base.fountain.at;
    const r2 = base.fountain.radius * base.fountain.radius;
    for (const p of w.players) {
      const e = p?.ent;
      if (!e || !e.alive || e.team !== base.team) continue;
      const dx = e.x - fx, dy = e.y - fy;
      if (dx * dx + dy * dy > r2) continue;
      if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * k);
      const model = e.resource?.model;
      if (model === 'pool' && e.res < e.maxRes) e.res = Math.min(e.maxRes, e.res + e.maxRes * k);
      else if (model === 'heat' && e.res > 0 && e.overheat <= 0) e.res = Math.max(0, e.res - e.maxRes * k);
    }
  }
}

// ── install ─────────────────────────────────────────────────────────────────────────────────────
export function installFighters(w: World): void {
  w.hooks.death.push((ww, victim) => onDeath(ww, victim));
  w.hooks.damage.push((ww, _src, dst, amount) => {
    if (dst.kind === 'fighter' && dst.player && amount > 0) {
      const s = seatState(ww, dst.player.player);
      if (s && s.recall) cancelRecall(ww, dst.player);
    }
  });
  w.hooks.command.recall = (ww, p) => { startRecall(ww, p); };
}
