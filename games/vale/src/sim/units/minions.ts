// VALE sim — minion waves and lane AI (CONTRACT §5.4).
//
// Waves (rules.minionWaves): wave n (1-based) spawns at match time first + (n − 1) × interval, on
// every MapDef lane, for team 0 at path[0] and team 1 at the path's last point (team 1 walks the
// path reversed; teams beyond 1 have no lanes). A composition entry joins wave n when
// n % everyNth === 0 and the wave time ≥ `from` (match seconds). Units of one wave line up in rows
// of three behind the lane start. Minion level = 1 + floor(wave time / upgradeEvery) (UnitDef.growth
// per level); team-buff minionStats apply on top (core stats). Emits 'wave' { n } per wave.
//
// Lane AI (every MINION_THINK_TICKS, staggered by id; at once when the target is lost):
//   * a valid current target (attackable, within chaseRange of where the chase began) is kept
//     unless a call-for-help token outranks it (common.ts);
//   * otherwise the best target within aggroRange by `priority` is chased with an attack order;
//   * with nothing to fight it attack-moves along its lane: the next waypoint is the end of the
//     path segment nearest to it, never one behind the last reached (so a minion pulled off the
//     lane rejoins it ahead, not behind); past the last waypoint it holds the lane end and
//     attacks what comes in range (the enemy core sits there).
// Structures are targeted only by priority ('structure' token) and only when targetable, so
// protected structures are walked past/held at rather than hit. Unit abilities are cast at the
// target when ready.

import { attackable } from '../attack.ts';
import { ORDER_ATTACK, ORDER_ATTACK_MOVE, type Entity } from '../entity.ts';
import { segPointDist2 } from '../math.ts';
import { issueAttack, issueMove } from '../movement.ts';
import { spawnUnit } from '../spawn.ts';
import type { World } from '../world.ts';
import { behaviorOf, bestTargetNear, dist2, getExt, setExt, shouldSwitch, useUnitAbilities } from './common.ts';

export const MINION_THINK_TICKS = 6;
/** metres from a waypoint that count as reaching it */
export const WAYPOINT_REACH = 2.5;
/** spacing of a wave's rows / columns at spawn */
const ROW_GAP = 1.3, COL_GAP = 1.1;

type V2T = readonly [number, number];
interface MinionState {
  path: readonly V2T[];
  wp: number;
  chasing: boolean;
  cx: number; cy: number;
  lastWpX: number; lastWpY: number;
}
interface WaveState { n: number; nextAt: number; paths: V2T[][][] }
const KEY = 'waves';
const MKEY = 'minion';

export function minionState(e: Entity): MinionState | undefined { return getExt<MinionState>(e, MKEY); }
function waves(w: World): WaveState { return w.ext[KEY] as WaveState; }
export function wavesSpawned(w: World): number { return waves(w).n; }

export function initWaves(w: World): void {
  const mw = w.rules.minionWaves;
  const paths: V2T[][][] = w.mapDef.lanes.map((l) => {
    const fwd = l.path.map((p) => [p[0], p[1]] as V2T);
    return [fwd, fwd.slice().reverse()];
  });
  w.ext[KEY] = { n: 0, nextAt: mw ? mw.first : Infinity, paths } satisfies WaveState;
}

/** 'ai' phase (runs before minionSystem so new minions get their first order this tick) */
export function waveSystem(w: World): void {
  const mw = w.rules.minionWaves;
  const st = waves(w);
  if (!mw || w.phase === 'ended') return;
  while (w.time + 1e-9 >= st.nextAt) {
    const at = st.nextAt;
    st.n++;
    st.nextAt += Math.max(1, mw.interval);
    spawnWave(w, st, st.n, at);
  }
}

function spawnWave(w: World, st: WaveState, n: number, at: number): void {
  const mw = w.rules.minionWaves!;
  const level = mw.upgradeEvery && mw.upgradeEvery > 0 ? 1 + Math.floor(Math.max(0, at) / mw.upgradeEvery) : 1;
  const units: string[] = [];
  for (const c of mw.composition) {
    const every = Math.max(1, c.everyNth ?? 1);
    if (n % every !== 0 || at + 1e-9 < (c.from ?? 0)) continue;
    for (let k = 0; k < c.count; k++) units.push(c.unit);
  }
  if (units.length === 0) return;
  const teams = Math.min(2, w.teams.length);
  for (const lane of st.paths) {
    for (let team = 0; team < teams; team++) {
      const path = lane[team];
      const [sx, sy] = path[0];
      const [nx, ny] = path.length > 1 ? path[1] : path[0];
      let dx = nx - sx, dy = ny - sy;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= l; dy /= l;
      const facing = Math.atan2(dy, dx);
      for (let i = 0; i < units.length; i++) {
        const row = Math.floor(i / 3), col = (i % 3) - 1;
        const x = sx - dx * row * ROW_GAP - dy * col * COL_GAP, y = sy - dy * row * ROW_GAP + dx * col * COL_GAP;
        const e = spawnUnit(w, units[i], team, x, y, { level, facing });
        setExt<MinionState>(e, MKEY, { path, wp: path.length > 1 ? 1 : 0, chasing: false, cx: e.x, cy: e.y, lastWpX: NaN, lastWpY: NaN });
        followLane(w, e, minionState(e)!);
      }
    }
  }
  w.emit({ e: 'wave', t: w.time, n });
}

/** advance the waypoint (never backwards) and attack-move to it */
function followLane(w: World, e: Entity, m: MinionState): void {
  const p = m.path;
  // nearest segment end ahead of us
  let bestK = m.wp, bestD = Infinity;
  for (let k = Math.max(1, m.wp); k < p.length; k++) {
    const d = segPointDist2(p[k - 1][0], p[k - 1][1], p[k][0], p[k][1], e.x, e.y);
    if (d < bestD - 1e-9) { bestD = d; bestK = k; }
  }
  m.wp = Math.max(m.wp, bestK);
  const reach2 = WAYPOINT_REACH * WAYPOINT_REACH;
  while (m.wp < p.length - 1 && dist2(e, p[m.wp][0], p[m.wp][1]) < reach2) m.wp++;
  const [tx, ty] = p[Math.min(m.wp, p.length - 1)];
  // already heading there, or holding the lane end
  if (m.lastWpX === tx && m.lastWpY === ty && (e.order === ORDER_ATTACK_MOVE || dist2(e, tx, ty) < reach2)) return;
  m.lastWpX = tx; m.lastWpY = ty;
  issueMove(w, e, tx, ty, true);
}

/** 'ai' phase */
export function minionSystem(w: World): void {
  const list = w.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.kind !== 'minion' || !e.alive || !e.unit) continue;
    const m = minionState(e);
    if (!m) continue;
    const b = behaviorOf(e.unit);
    const cur = e.order === ORDER_ATTACK ? w.live(e.orderTarget) : null;
    const chase2 = b.chaseRange * b.chaseRange;
    const curOk = !!cur && attackable(w, e, cur) && dist2(cur, m.cx, m.cy) <= chase2;
    const lost = e.order === ORDER_ATTACK && !curOk;
    if (!lost && (w.tick + e.id) % MINION_THINK_TICKS !== 0) {
      if (curOk) useUnitAbilities(w, e, cur!);
      continue;
    }
    const best = bestTargetNear(w, e, b.aggroRange, b.priority, b.callForHelpRange, m.chasing ? m.cx : e.x, m.chasing ? m.cy : e.y, chase2);
    if (curOk && (!best || !shouldSwitch(w, e, cur!, best, b.priority, b.callForHelpRange))) {
      useUnitAbilities(w, e, cur!);
      continue;
    }
    if (best) {
      if (!m.chasing) { m.chasing = true; m.cx = e.x; m.cy = e.y; }
      if (best !== cur) { issueAttack(w, e, best); m.lastWpX = NaN; }
      useUnitAbilities(w, e, best);
      continue;
    }
    m.chasing = false;
    followLane(w, e, m);
  }
}
