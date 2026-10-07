// VALE bots — perception: what a team can see, rebuilt whenever the sim's fog of war updates.
//
// FOG-HONEST: an enemy unit enters a team's lists only while its `visibleMask` has the team's bit
// (CONTRACT §5.4: fog, thickets, invisibility, reveal); structures are public; allied units are
// always known. Enemy fighters that drop out of sight are remembered in `lastSeen` (position +
// time); readers weigh that memory down as it ages (`memoryWeight`). Projectiles and zones are
// listed as hazards only when the team can see them, and telegraphs (delayed `area` events) only
// when their `telegraph` lets the team see them (`everyone`, or `ally_only` for the caster's own
// team) and the ground is in the team's vision.
//
// One `TeamPerc` per team (Fray: one per seat) is shared by that team's bots; each bot adds its own
// reaction delay on top (bot.ts), so a novice notices a ganker later than a veteran does.
// Also here: the per-tick incoming-damage index used for last-hit prediction (every attack in
// windup, every next attack due, every basic-attack projectile in flight, with its ETA).

import type { EntityId, SimEvent } from '../../contracts/sim.ts';
import { mitigated } from '../combat.ts';
import type { Entity } from '../entity.ts';
import { damageMultHook } from '../units/common.ts';
import type { World } from '../world.ts';
import { laneProject, progress, proj, type Knowledge } from './knowledge.ts';

export interface LastSeen { x: number; y: number; t: number; id: EntityId }
/** how much a last-seen sighting still counts (1 fresh → 0 after `span` s) */
export function memoryWeight(ls: LastSeen, now: number, span = 20): number {
  const age = now - ls.t;
  return age <= 0 ? 1 : age >= span ? 0 : 1 - age / span;
}

export class TeamPerc {
  readonly team: number;
  readonly bit: number;
  /** bumps on every rebuild */
  version = 0;
  enemyFighters: Entity[] = [];
  enemyUnits: Entity[] = [];
  enemyStructs: Entity[] = [];
  allyFighters: Entity[] = [];
  allyUnits: Entity[] = [];
  allyStructs: Entity[] = [];
  monsters: Entity[] = [];
  pickups: Entity[] = [];
  /** visible hostile skillshot projectiles and zones */
  hazards: Entity[] = [];
  enemyWards: Entity[] = [];
  readonly lastSeen = new Map<EntityId, LastSeen>();
  /** per lane, in this team's progress coordinates: furthest own minion, nearest visible enemy minion */
  readonly ownFront: Float64Array;
  readonly enemyFront: Float64Array;
  readonly ownN: Int32Array;
  readonly enemyN: Int32Array;

  constructor(team: number, lanes: number) {
    this.team = team;
    this.bit = team >= 0 && team < 31 ? 1 << team : 0;
    this.ownFront = new Float64Array(lanes);
    this.enemyFront = new Float64Array(lanes);
    this.ownN = new Int32Array(lanes);
    this.enemyN = new Int32Array(lanes);
  }

  clear(): void {
    this.enemyFighters.length = 0; this.enemyUnits.length = 0; this.enemyStructs.length = 0;
    this.allyFighters.length = 0; this.allyUnits.length = 0; this.allyStructs.length = 0;
    this.monsters.length = 0; this.pickups.length = 0; this.hazards.length = 0; this.enemyWards.length = 0;
    this.ownFront.fill(-1); this.enemyFront.fill(Infinity); this.ownN.fill(0); this.enemyN.fill(0);
  }
  sees(e: Entity): boolean { return (e.visibleMask & this.bit) !== 0; }
}

/** rebuild every team's lists in one pass over the entity store */
export function rebuildPerception(w: World, k: Knowledge, teams: readonly TeamPerc[]): void {
  for (const tp of teams) { tp.clear(); tp.version++; }
  const lanes = k.lanes;
  const now = w.time;
  const list = w.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.removed) continue;
    switch (e.kind) {
      case 'fighter': {
        if (!e.alive) continue;
        for (const tp of teams) {
          if (e.team === tp.team) tp.allyFighters.push(e);
          else if ((e.visibleMask & tp.bit) !== 0 && e.targetable) {
            tp.enemyFighters.push(e);
            let ls = tp.lastSeen.get(e.id);
            if (!ls) { ls = { x: e.x, y: e.y, t: now, id: e.id }; tp.lastSeen.set(e.id, ls); }
            ls.x = e.x; ls.y = e.y; ls.t = now;
          }
        }
        break;
      }
      case 'minion': case 'summon': {
        if (!e.alive) continue;
        let lane = -1, s = 0;
        if (e.kind === 'minion' && lanes.length > 0) {
          let best = 64;
          for (const l of lanes) { laneProject(l, e.x, e.y); if (proj.d2 < best) { best = proj.d2; lane = l.index; s = proj.s; } }
        }
        for (const tp of teams) {
          if (e.team === tp.team) {
            tp.allyUnits.push(e);
            if (lane >= 0) {
              const p = progress(lanes[lane], tp.team, s);
              if (p > tp.ownFront[lane]) tp.ownFront[lane] = p;
              tp.ownN[lane]++;
            }
          } else if ((e.visibleMask & tp.bit) !== 0 && e.targetable) {
            tp.enemyUnits.push(e);
            if (lane >= 0) {
              const p = progress(lanes[lane], tp.team, s);
              if (p < tp.enemyFront[lane]) tp.enemyFront[lane] = p;
              tp.enemyN[lane]++;
            }
          }
        }
        break;
      }
      case 'structure': {
        if (!e.alive) continue;
        for (const tp of teams) { if (e.team === tp.team) tp.allyStructs.push(e); else tp.enemyStructs.push(e); }
        break;
      }
      case 'monster': {
        if (!e.alive) continue;
        for (const tp of teams) if ((e.visibleMask & tp.bit) !== 0) tp.monsters.push(e);
        break;
      }
      case 'pickup': {
        if (!e.alive) continue;
        for (const tp of teams) if ((e.visibleMask & tp.bit) !== 0) tp.pickups.push(e);
        break;
      }
      case 'ward': {
        if (!e.alive) continue;
        for (const tp of teams) if (e.team !== tp.team && (e.visibleMask & tp.bit) !== 0 && e.targetable) tp.enemyWards.push(e);
        break;
      }
      case 'projectile': {
        const pd = e.proj;
        if (!pd || pd.attack || pd.homing) continue;
        for (const tp of teams) if (e.team !== tp.team && (e.visibleMask & tp.bit) !== 0) tp.hazards.push(e);
        break;
      }
      case 'zone': {
        const zd = e.zone;
        if (!zd) continue;
        const f = zd.eff.filter;
        if (f && f.enemies === false) continue; // ally-only zones are not hazards
        for (const tp of teams) if (e.team !== tp.team && (e.visibleMask & tp.bit) !== 0) tp.hazards.push(e);
        break;
      }
      default: break;
    }
  }
}

// ── telegraphs (delayed areas announced by `area` events) ───────────────────────────────────────
export interface Telegraph {
  readonly id: number;
  readonly src: EntityId;
  readonly srcTeam: number;
  readonly ability: string;
  readonly x: number; readonly y: number;
  readonly dirX: number; readonly dirY: number;
  readonly kind: 'circle' | 'ring' | 'cone' | 'rect';
  readonly radius: number; readonly inner: number; readonly half: number; readonly length: number; readonly width: number;
  readonly at: number;
  readonly resolveAt: number;
  readonly visibility: 'none' | 'ally_only' | 'everyone';
}

/** is (px, py) with body radius pr inside the telegraph (inflated by margin)? */
export function inTelegraph(t: Telegraph, px: number, py: number, pr: number): boolean {
  const dx = px - t.x, dy = py - t.y;
  const d2 = dx * dx + dy * dy;
  switch (t.kind) {
    case 'circle': { const r = t.radius + pr; return d2 <= r * r; }
    case 'ring': { const r = t.radius + pr, ri = Math.max(0, t.inner - pr); return d2 <= r * r && d2 >= ri * ri; }
    case 'cone': {
      const r = t.radius + pr;
      if (d2 > r * r) return false;
      if (d2 < pr * pr) return true;
      const d = Math.sqrt(d2);
      const cos = (dx * t.dirX + dy * t.dirY) / d;
      return cos >= Math.cos(Math.min(Math.PI, t.half + Math.asin(Math.min(1, pr / d))));
    }
    case 'rect': {
      const along = dx * t.dirX + dy * t.dirY;
      const side = Math.abs(-dx * t.dirY + dy * t.dirX);
      return along >= -pr && along <= t.length + pr && side <= t.width * 0.5 + pr;
    }
  }
}

let teleSeq = 1;
export function telegraphFromEvent(w: World, ev: Extract<SimEvent, { e: 'area' }>): Telegraph | null {
  const sh = ev.shape;
  if (!sh || !(ev.delay > 0.05)) return null;
  const src = w.entity(ev.src);
  const team = src ? src.team : -1;
  const f = src ? src.facing : 0;
  const kind = sh.kind;
  return {
    id: teleSeq++, src: ev.src, srcTeam: team, ability: ev.ability, x: ev.x, y: ev.y, dirX: Math.cos(f), dirY: Math.sin(f), kind,
    radius: sh.radius ?? 0, inner: sh.inner ?? 0, half: (sh.angle ?? Math.PI * 2) / 2, length: sh.length ?? 0, width: sh.width ?? 0,
    at: ev.t, resolveAt: ev.t + ev.delay, visibility: ev.telegraph,
  };
}

// ── incoming damage (last-hit prediction) ───────────────────────────────────────────────────────
/**
 * Every hit already on its way to a unit this tick: attacks in windup (ETA = windup left + flight),
 * the next attack of units locked on (ETA = cooldown left + windup + flight, flagged `next`), and
 * basic-attack projectiles in flight. Built lazily once per tick; entries are filtered by the
 * reader's team vision (an attacker the team cannot see does not count).
 */
export class IncomingIndex {
  tick = -1;
  private head = new Map<EntityId, number>();
  private nxt: number[] = [];
  private etaA: number[] = [];
  private dmgA: number[] = [];
  private visA: number[] = [];
  private nextA: boolean[] = [];
  private n = 0;

  private add(target: EntityId, eta: number, dmg: number, vis: number, next: boolean): void {
    const i = this.n++;
    const h = this.head.get(target);
    this.nxt[i] = h === undefined ? -1 : h;
    this.etaA[i] = eta; this.dmgA[i] = dmg; this.visA[i] = vis; this.nextA[i] = next;
    this.head.set(target, i);
  }

  build(w: World): void {
    if (this.tick === w.tick) return;
    this.tick = w.tick;
    this.head.clear();
    this.n = 0;
    const list = w.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed) continue;
      if (e.kind === 'projectile') {
        const pd = e.proj;
        if (!pd || !pd.attack) continue;
        const t = w.live(pd.target);
        if (!t || t.lifeSeq !== pd.targetLife || (t.kind !== 'minion' && t.kind !== 'monster' && t.kind !== 'summon')) continue;
        const src = pd.src;
        const raw = src.stats.ad * (pd.crit ? src.stats.critDamage : 1);
        const dmg = mitigated(src, t, damageMultHook(w, src, t, raw), pd.dtype);
        const d = Math.max(0, Math.hypot(t.x - e.x, t.y - e.y) - t.radius);
        this.add(t.id, d / Math.max(1, pd.speed), dmg, src.visibleMask, false);
        continue;
      }
      if (!e.alive || !e.attackDef || e.atkTarget < 0) continue;
      const t = w.live(e.atkTarget);
      if (!t || (t.kind !== 'minion' && t.kind !== 'monster' && t.kind !== 'summon')) continue;
      const ad = e.attackDef;
      const flight = ad.projectileSpeed ? Math.max(0, Math.hypot(t.x - e.x, t.y - e.y) - t.radius) / ad.projectileSpeed : 0;
      const dmg = mitigated(e, t, damageMultHook(w, e, t, e.stats.ad), ad.damageType);
      if (e.atkWindup >= 0) { this.add(t.id, e.atkWindup + flight, dmg, e.visibleMask, false); continue; }
      const period = 1 / Math.max(0.05, e.stats.attackSpeed);
      // locked on and in range: its next swing is coming
      const reach = e.stats.range + e.radius + t.radius;
      const dx = t.x - e.x, dy = t.y - e.y;
      if (dx * dx + dy * dy <= reach * reach) this.add(t.id, Math.max(0, e.atkCd) + ad.windup * period + flight, dmg, e.visibleMask, true);
    }
  }

  /**
   * damage landing on `target` within `horizon` s, counting only attackers visible to `bit`;
   * `withNext` includes not-yet-started next swings
   */
  before(target: EntityId, horizon: number, bit: number, withNext: boolean): number {
    let sum = 0;
    for (let i = this.head.get(target) ?? -1; i >= 0; i = this.nxt[i]) {
      if (this.etaA[i] >= horizon || (this.visA[i] & bit) === 0) continue;
      if (this.nextA[i] && !withNext) continue;
      sum += this.dmgA[i];
    }
    return sum;
  }
  /** soonest landing hit on `target` (Infinity: none) */
  soonest(target: EntityId, bit: number): number {
    let best = Infinity;
    for (let i = this.head.get(target) ?? -1; i >= 0; i = this.nxt[i]) if ((this.visA[i] & bit) !== 0 && this.etaA[i] < best) best = this.etaA[i];
    return best;
  }
}
