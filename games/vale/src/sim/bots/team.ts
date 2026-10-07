// VALE bots — the team brain (2 Hz per team; none in free-for-all).
//
// Publishes NON-AUTHORITATIVE intents that bots weigh in their own utility scoring (r09 §2.1, §5.1):
//   * lane assignment from SeatSetup.role → RoleDef.assign (lane id / jungle / support on the duo
//     lane), falling back to FighterDef.role, and filling gaps so every lane is covered; on a one-lane
//     map (Bridge) everyone shares the lane and the team groups as one;
//   * defend[lane]: an own structure with enemies at it (gates/cores weigh more);
//   * group + siege: in the mid/late game (or always on one lane) the team gathers on one target —
//     the core when it is open, else the least-pushed tower, and respawning structures (gates) only
//     once every tower that guards the core is down, so the core can follow before they return;
//   * objective: objective camps (MapDef camps with objective = true) from the public timers in
//     WorldView.objectives — gather 30 s before a spawn, take it when the team is not behind;
//   * gank: a visible enemy fighter overextended in a lane where the team has a laner (junglers);
//   * camp memory: when each camp should be up (first spawn, then seen empty / seen cleared);
//   * focus: each bot publishes its fight target, so teammates can focus fire.

import type { EntityId, PlayerId, SeatSetup } from '../../contracts/sim.ts';
import type { Entity } from '../entity.ts';
import type { World } from '../world.ts';
import { lanePoint, progress, fromProgress, proj, type CampInfo, type Knowledge, type StructInfo } from './knowledge.ts';
import type { TeamPerc } from './perception.ts';

export interface LaneAssign { lane: number; jungle: boolean; support: boolean }

export const TEAM_THINK_TICKS = 15;

function roleOf(k: Knowledge, s: SeatSetup): string {
  if (s.role) return s.role;
  return k.idx.fighters.get(s.fighter)?.role ?? '';
}

/**
 * Lane assignment for one team (pure; the team brain and the bot factory share it). Rift: each
 * seat's RoleDef.assign (SeatSetup.role, else the fighter's FighterDef.role) — the jungle role
 * when rules.jungle is on and the map has camps (one jungler), the lane it names (one laner per
 * lane, plus one `support` on its lane); every seat left over fills the emptiest lane. One-lane maps
 * put everyone on the lane; maps without lanes leave everyone unassigned (-1).
 */
export function assignLanes(k: Knowledge, team: number): Map<PlayerId, LaneAssign> {
  const out = new Map<PlayerId, LaneAssign>();
  const seats = k.setup.seats.filter((s) => s.team === team);
  const order = (s: SeatSetup): number => k.roles.get(roleOf(k, s))?.assign?.order ?? 99;
  seats.sort((a, b) => order(a) - order(b) || a.player - b.player);
  const nL = k.lanes.length;
  if (nL === 0 || k.ffa) { for (const s of seats) out.set(s.player, { lane: -1, jungle: false, support: false }); return out; }
  if (k.kind !== 'rift') { for (const s of seats) out.set(s.player, { lane: 0, jungle: false, support: false }); return out; }
  const count = new Int32Array(nL), supports = new Int32Array(nL);
  const jungleOk = k.rules.jungle && k.camps.some((c) => !c.objective);
  let junglers = 0;
  const open: SeatSetup[] = [];
  for (const s of seats) {
    const a = k.roles.get(roleOf(k, s))?.assign;
    if (!a) { open.push(s); continue; }
    if (a.jungle) {
      if (jungleOk && junglers === 0) { junglers++; out.set(s.player, { lane: -1, jungle: true, support: false }); }
      else open.push(s);
      continue;
    }
    const li = a.lane ? k.lanes.findIndex((l) => l.id === a.lane) : -1;
    if (li < 0) { open.push(s); continue; }
    const cores = count[li] - supports[li];
    if (a.support ? supports[li] === 0 && count[li] <= 1 : cores === 0 && count[li] <= 1) {
      count[li]++; if (a.support) supports[li]++;
      out.set(s.player, { lane: li, jungle: false, support: a.support });
    } else open.push(s);
  }
  for (const s of open) {
    let best = 0;
    for (let i = 1; i < nL; i++) if (count[i] < count[best]) best = i;
    count[best]++;
    out.set(s.player, { lane: best, jungle: false, support: false });
  }
  return out;
}

export class TeamBrain {
  readonly team: number;
  readonly k: Knowledge;
  readonly perc: TeamPerc;
  lastThink = -1e9;
  readonly assign = new Map<PlayerId, LaneAssign>();
  readonly push: Float64Array;
  readonly defend: Float64Array;
  readonly defendX: Float64Array;
  readonly defendY: Float64Array;
  /** an own structure off the lanes (core) under attack */
  baseThreat = 0; baseX = 0; baseY = 0;
  phase: 'early' | 'mid' | 'late' = 'early';
  group = false;
  groupX = 0; groupY = 0;
  siege: Entity | null = null;
  siegeLane = -1;
  objective: { camp: CampInfo; desire: number; alive: boolean } | null = null;
  gank: Entity | null = null;
  readonly campReady: Float64Array;
  readonly focus = new Map<PlayerId, EntityId>();
  aliveAllies = 0; aliveEnemies = 0;
  /** enemy fighters not seen for a while (danger of pushing deep) */
  missing = 0;

  constructor(team: number, k: Knowledge, perc: TeamPerc) {
    this.team = team; this.k = k; this.perc = perc;
    const n = k.lanes.length;
    this.push = new Float64Array(n); this.defend = new Float64Array(n);
    this.defendX = new Float64Array(n); this.defendY = new Float64Array(n);
    this.campReady = new Float64Array(k.camps.length);
    for (const c of k.camps) this.campReady[c.index] = c.firstSpawn;
    this.assignLanes();
  }

  // ── lanes ─────────────────────────────────────────────────────────────────────────────────────
  private assignLanes(): void {
    for (const [p, a] of assignLanes(this.k, this.team)) this.assign.set(p, a);
  }
  laneOf(p: PlayerId): LaneAssign { return this.assign.get(p) ?? { lane: this.k.lanes.length > 0 ? 0 : -1, jungle: false, support: false }; }

  // ── intents ───────────────────────────────────────────────────────────────────────────────────
  think(w: World): void {
    this.lastThink = w.tick;
    const k = this.k, tp = this.perc, now = w.time;
    // who is up
    let aa = 0, ae = 0, lvA = 0, lvE = 0;
    for (const p of w.players) {
      const e = p?.ent;
      if (!e) continue;
      if (p.team === this.team) { if (e.alive) aa++; lvA += e.level; }
      else { if (e.alive) ae++; lvE += e.level; }
    }
    this.aliveAllies = aa; this.aliveEnemies = ae;
    let missing = 0;
    for (const ls of tp.lastSeen.values()) if (now - ls.t > 6) missing++;
    this.missing = Math.min(ae, missing + Math.max(0, ae - tp.lastSeen.size));
    this.updateCamps(w);
    // phase
    let ownLost = 0, enemyLost = 0;
    for (const s of k.structs) {
      if (s.lane < 0) continue;
      const alive = this.structAlive(w, s);
      if (!alive) { if (s.team === this.team) ownLost++; else enemyLost++; }
    }
    const avgLv = lvA / Math.max(1, k.setup.seats.filter((s) => s.team === this.team).length);
    this.phase = now >= 1200 || avgLv >= 12 ? 'late' : now >= 600 || ownLost + enemyLost > 0 ? 'mid' : 'early';
    this.thinkDefend(w);
    this.thinkSiege(w, aa - ae, lvA - lvE, enemyLost);
    this.thinkObjective(w, aa, ae);
    this.thinkGank(w);
  }

  private structAlive(w: World, s: StructInfo): boolean {
    for (const e of s.team === this.team ? this.perc.allyStructs : this.perc.enemyStructs) {
      if (e.alive && Math.abs(e.x - s.x) < 0.5 && Math.abs(e.y - s.y) < 0.5) return true;
    }
    return false;
  }

  private updateCamps(w: World): void {
    const k = this.k, now = w.time, tp = this.perc;
    for (const c of k.camps) {
      if (c.objective) {
        const ov = w.objectives.find((o) => o.id === c.id);
        if (ov) this.campReady[c.index] = ov.alive ? now : now + ov.respawnIn;
        continue;
      }
      let up = false;
      for (const m of tp.monsters) if (m.alive && Math.abs(m.x - c.x) < 7 && Math.abs(m.y - c.y) < 7) { up = true; break; }
      if (up) { this.campReady[c.index] = Math.min(this.campReady[c.index], now); continue; }
      // the camp ground is in sight and empty: it was cleared; assume recently
      if (now >= this.campReady[c.index] && w.vision.seen(this.team, c.x, c.y)) this.campReady[c.index] = now + c.respawn * 0.6;
    }
  }
  /** a camp the team saw die (or killed): ready again after its respawn */
  campCleared(campIndex: number, now: number): void {
    const c = this.k.camps[campIndex];
    if (c) this.campReady[campIndex] = now + c.respawn;
  }

  private thinkDefend(w: World): void {
    const k = this.k, tp = this.perc;
    this.defend.fill(0);
    this.baseThreat = 0;
    for (const st of tp.allyStructs) {
      if (!st.alive) continue;
      const reach = Math.max(8, st.stats.range + st.radius + 5);
      let fighters = 0, minions = 0, mine = 0;
      for (const f of tp.enemyFighters) if (f.alive && (f.x - st.x) ** 2 + (f.y - st.y) ** 2 <= reach * reach) fighters++;
      for (const u of tp.enemyUnits) if (u.alive && (u.x - st.x) ** 2 + (u.y - st.y) ** 2 <= reach * reach) minions++;
      for (const u of tp.allyUnits) if (u.alive && (u.x - st.x) ** 2 + (u.y - st.y) ** 2 <= reach * reach) mine++;
      if (fighters === 0 && minions < 3) continue;
      const hurt = st.hp < st.maxHp * 0.98 ? 1 : 0.6;
      const info = this.structInfoOf(st);
      const weight = info?.isCore ? 1.6 : info && (info.lane < 0 || !info.attacks) ? 1.3 : 1;
      const threat = Math.min(1, (fighters * 0.45 + Math.max(0, minions - mine) * 0.08) * hurt * weight);
      if (threat <= 0.05) continue;
      const lane = info ? info.lane : -1;
      if (lane >= 0) {
        if (threat > this.defend[lane]) { this.defend[lane] = threat; this.defendX[lane] = st.x; this.defendY[lane] = st.y; }
      } else if (threat > this.baseThreat) { this.baseThreat = threat; this.baseX = st.x; this.baseY = st.y; }
    }
    void k;
  }

  structInfoOf(e: Entity): StructInfo | undefined {
    for (const s of this.k.structs) if (Math.abs(s.x - e.x) < 0.5 && Math.abs(s.y - e.y) < 0.5 && s.team === e.team) return s;
    return undefined;
  }

  private respawning(s: StructInfo): boolean { return s.respawns; }

  private thinkSiege(w: World, aliveDiff: number, levelDiff: number, enemyLost: number): void {
    const k = this.k, tp = this.perc;
    this.push.fill(0);
    // per-lane push desire: own wave there and its enemy laners away
    for (const l of k.lanes) {
      if (tp.ownN[l.index] >= 3 && tp.enemyN[l.index] <= 1) this.push[l.index] = 0.5;
    }
    const single = k.kind === 'bridge' || k.kind === 'brawl';
    let group = single;
    if (k.kind === 'rift') {
      if (this.phase === 'late') group = true;
      else if (this.phase === 'mid') group = (enemyLost > 0 && aliveDiff >= 1) || aliveDiff >= 2 || levelDiff >= 8 || w.time >= 900;
    }
    // choose the siege target among open enemy structures
    let best: Entity | null = null, bestInfo: StructInfo | undefined, bestScore = -Infinity;
    let towersLeft = 0;
    for (const e of tp.enemyStructs) {
      const info = this.structInfoOf(e);
      if (info && info.lane >= 0 && !this.respawning(info)) towersLeft++;
    }
    for (const e of tp.enemyStructs) {
      if (!e.alive || !e.targetable) continue;
      const info = this.structInfoOf(e);
      if (!info) continue;
      let score: number;
      if (info.isCore) score = 1000;
      else if (this.respawning(info)) score = towersLeft === 0 ? 500 - Math.hypot(e.x - this.groupX, e.y - this.groupY) * 0.1 : -1;
      else {
        // the least-pushed lane first: towers nearer our side score higher
        const l = info.lane >= 0 ? k.lanes[info.lane] : null;
        const p = l ? progress(l, this.team, info.s) / l.length : 1;
        score = 100 - p * 50 + (l ? tp.ownN[l.index] * 2 : 0) - (e.hp / Math.max(1, e.maxHp)) * 10;
      }
      if (score > bestScore) { bestScore = score; best = e; bestInfo = info; }
    }
    this.siege = bestScore >= 0 ? best : null;
    this.siegeLane = bestInfo ? bestInfo.lane : -1;
    this.group = group && !!this.siege;
    if (this.siege) {
      const s = this.siege;
      const info = bestInfo!;
      // gather on our side of the target, just outside its reach
      const stand = (info.attacks ? info.range + info.radius + 2.5 : info.radius + 3);
      if (info.lane >= 0) {
        const l = k.lanes[info.lane];
        const p = progress(l, this.team, info.s) - stand;
        const front = tp.ownN[l.index] > 0 ? Math.max(tp.ownFront[l.index] - 2, 0) : 0;
        lanePoint(l, fromProgress(l, this.team, Math.max(0, Math.min(p, Math.max(front, p - 12)))));
        this.groupX = proj.x; this.groupY = proj.y;
      } else {
        const base = k.bases.find((b) => b.team === this.team);
        const bx = base ? base.spawnX : k.mapCenterX, by = base ? base.spawnY : k.mapCenterY;
        const dx = bx - s.x, dy = by - s.y, d = Math.hypot(dx, dy) || 1;
        this.groupX = s.x + (dx / d) * stand; this.groupY = s.y + (dy / d) * stand;
      }
      if (info.lane >= 0) this.push[info.lane] = Math.max(this.push[info.lane], this.group ? 0.9 : 0.5);
    }
  }

  private thinkObjective(w: World, aa: number, ae: number): void {
    this.objective = null;
    if (this.k.kind !== 'rift') return;
    const now = w.time;
    for (const c of this.k.camps) {
      if (!c.objective) continue;
      const ready = this.campReady[c.index];
      const alive = ready <= now;
      if (!alive && ready - now > 30) continue;
      if (now < 240) continue;
      let desire = 0;
      if (alive) desire = aa >= ae + 1 ? 0.75 : aa >= ae && this.phase !== 'early' ? 0.55 : 0;
      else desire = aa >= ae ? 0.4 : 0;
      if (desire > (this.objective?.desire ?? 0)) this.objective = { camp: c, desire, alive };
    }
  }

  private thinkGank(w: World): void {
    this.gank = null;
    const k = this.k;
    if (k.kind !== 'rift') return;
    let best = 0;
    for (const f of this.perc.enemyFighters) {
      if (!f.alive) continue;
      // which lane is it in, and how far into our half
      let lane = -1, s = 0, d2b = 49;
      for (const l of k.lanes) { const pr = this.projectTo(l.index, f.x, f.y); if (pr.d2 < d2b) { d2b = pr.d2; lane = l.index; s = pr.s; } }
      if (lane < 0) continue;
      let ally = false;
      for (const [, a] of this.assign) if (a.lane === lane) { ally = true; break; }
      if (!ally) continue;
      const l = k.lanes[lane];
      const deep = progress(l, this.team, s) / l.length;
      const hpF = f.hp / Math.max(1, f.maxHp);
      const score = (deep - 0.35) * 2 + (1 - hpF);
      if (deep > 0.4 && score > best) { best = score; this.gank = f; }
    }
  }
  private projectTo(lane: number, x: number, y: number): { s: number; d2: number } {
    const l = this.k.lanes[lane];
    // inline projection (knowledge.laneProject writes shared scratch; copy it out)
    let bestD2 = Infinity, bestS = 0;
    for (let i = 1; i < l.xs.length; i++) {
      const ax = l.xs[i - 1], ay = l.ys[i - 1], vx = l.xs[i] - ax, vy = l.ys[i] - ay;
      const L2 = vx * vx + vy * vy || 1;
      let t = ((x - ax) * vx + (y - ay) * vy) / L2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = ax + vx * t, py = ay + vy * t;
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestS = l.cum[i - 1] + Math.sqrt(L2) * t; }
    }
    return { s: bestS, d2: bestD2 };
  }

  /** how many teammates currently publish `target` as their focus (excluding `self`) */
  focusCount(target: EntityId, self: PlayerId): number {
    let n = 0;
    for (const [p, t] of this.focus) if (p !== self && t === target) n++;
    return n;
  }
}
