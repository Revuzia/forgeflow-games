// VALE bots — the per-match bot coordinator: one per createBots() world generation.
//
// Every bot's think() first calls beginTick(world); the first call of a tick does the shared work:
//   * taps the sim's event stream (the rest of last tick's buffer — events of the phases after
//     'bots' — then this tick's buffer so far): telegraphs from delayed `area` events, enemy casts
//     (veteran bots count spent cooldowns), monster deaths (camp timers);
//   * rebuilds every team's perception whenever the fog of war was rebuilt (10 Hz);
//   * runs each team brain at 2 Hz, teams staggered (TEAM_THINK_TICKS, offset 7 ticks per team).
// A practice `resetMatch` builds a new World: beginTick notices the new object and starts over.

import type { EntityId, PlayerId, SimEvent } from '../../contracts/sim.ts';
import { ranked } from '../effects.ts';
import { SLOT_INDEX } from '../entity.ts';
import type { World } from '../world.ts';
import type { Entity } from '../entity.ts';
import { abilityInfo, U_DAMAGE, type Knowledge, type StructInfo } from './knowledge.ts';
import { IncomingIndex, rebuildPerception, TeamPerc, telegraphFromEvent, type Telegraph } from './perception.ts';
import { TEAM_THINK_TICKS, TeamBrain } from './team.ts';
import { teamDifficulty } from './difficulty.ts';

export class BotMatch {
  readonly k: Knowledge;
  world: World | null = null;
  tick = -1;
  percs: TeamPerc[] = [];
  brains: (TeamBrain | null)[] = [];
  readonly incoming = new IncomingIndex();
  telegraphs: Telegraph[] = [];
  /** delayed areas read from a caster's windup (a point-targeted circle that will land at the cast's aim): visible as
   *  soon as the cast starts, a cast time before its `area` event (CW3 critic bot-micro: dodges read the windup) */
  windups: Telegraph[] = [];
  /** observer team → enemy fighter → estimated time each of a1..ult is back. Fog-honest (lane AI G4): a cast is
   *  recorded for a team only when that team could see the caster as it cast */
  private readonly castSeenBy = new Map<number, Map<EntityId, Float64Array>>();
  /** fighter → recent hits on it by enemy fighters (credited: summons and projectiles count for their owner), the
   *  last 3 s: what a teammate sees on its partner's health bar (lane AI G2: peel) */
  private readonly hurtLog = new Map<EntityId, { t: number; a: number; src: EntityId }[]>();
  /** fighter → recent damage it dealt to enemy fighters, the last 3 s (lane AI G8: who to CC first) */
  private readonly dealtLog = new Map<EntityId, { t: number; a: number }[]>();
  /** fighter → when a hard CC last landed on it */
  readonly heldAt = new Map<EntityId, number>();
  /** fighter → the damage it took from enemy fighters by type, decayed over ~3 minutes (lane AI G9: its own hits, which
   *  a player reads off its death recap and health bar) */
  readonly takenMix = new Map<EntityId, { phys: number; magic: number; t: number }>();
  /** map structure id → when it last fell */
  readonly structDownAt = new Map<string, number>();
  /** Fray: bot seat → the seat it is hunting (caps dog-piles on one human) */
  readonly ffaTarget = new Map<PlayerId, PlayerId>();
  private windupSeq = 0;
  /** each fighter's visibility during the last bots phase: the events read a tick late (emitted after the bots phase)
   *  are judged on what the teams could see when they happened, not after the next fog rebuild */
  private readonly maskAt = new Map<EntityId, number>();
  private evArr: SimEvent[] | null = null;
  private evLen = 0;
  private visionTick = -1;

  constructor(k: Knowledge) { this.k = k; }

  private reset(w: World): void {
    this.world = w;
    this.tick = -1;
    this.evArr = null; this.evLen = 0; this.visionTick = -1;
    this.maskAt.clear();
    this.telegraphs = [];
    this.windups = [];
    this.castSeenBy.clear();
    this.hurtLog.clear(); this.dealtLog.clear(); this.heldAt.clear(); this.takenMix.clear();
    this.ffaTarget.clear();
    this.structCache.clear();
    this.structDownAt.clear();
    this.percs = [];
    this.brains = [];
    const lanes = this.k.lanes.length;
    for (let t = 0; t < w.teams.length; t++) {
      const tp = new TeamPerc(t, lanes);
      this.percs.push(tp);
      this.brains.push(this.k.ffa || this.k.kind === 'practice' ? null : new TeamBrain(t, this.k, tp, this.structDownAt, teamDifficulty(this.k.setup.seats, t)));
    }
  }

  perc(team: number): TeamPerc { return this.percs[team]; }

  private readonly structCache = new Map<EntityId, StructInfo | null>();
  /** the map entry a structure entity stands for (lane, arc position, whether it shoots) */
  structInfo(e: Entity): StructInfo | null {
    let r = this.structCache.get(e.id);
    if (r !== undefined) return r;
    r = null;
    for (const s of this.k.structs) if (s.team === e.team && Math.abs(s.x - e.x) < 0.5 && Math.abs(s.y - e.y) < 0.5) { r = s; break; }
    this.structCache.set(e.id, r);
    return r;
  }
  brain(team: number): TeamBrain | null { return this.brains[team] ?? null; }

  beginTick(w: World): void {
    if (w !== this.world) this.reset(w);
    if (w.tick === this.tick) return;
    this.tick = w.tick;
    // events: the tail of last tick's buffer, then this tick's so far
    if (this.evArr && this.evArr !== w.events) this.consume(w, this.evArr, this.evLen, true);
    this.evArr = w.events;
    this.consume(w, w.events, 0, false);
    this.evLen = w.events.length;
    for (const p of w.players) if (p && p.ent) this.maskAt.set(p.ent.id, p.ent.visibleMask);
    const now = w.time;
    if (this.telegraphs.length > 0) this.telegraphs = this.telegraphs.filter((t) => t.resolveAt > now - 0.05);
    if (this.windups.length > 0) this.windups = this.windups.filter((t) => t.resolveAt > now - 0.05);
    if (w.vision.lastUpdateTick !== this.visionTick || this.percs[0]?.version === 0) {
      this.visionTick = w.vision.lastUpdateTick;
      rebuildPerception(w, this.k, this.percs);
    }
    if (w.phase === 'live') {
      for (const b of this.brains) {
        if (!b) continue;
        const due = (w.tick + b.team * 7) % TEAM_THINK_TICKS === 0;
        if ((due && w.tick - b.lastThink >= TEAM_THINK_TICKS) || w.tick - b.lastThink > TEAM_THINK_TICKS * 2) b.think(w);
      }
    }
  }

  private consume(w: World, arr: readonly SimEvent[], from: number, late: boolean): void {
    for (let i = from; i < arr.length; i++) {
      const ev = arr[i];
      switch (ev.e) {
        case 'area': {
          const t = telegraphFromEvent(w, ev);
          if (t && t.visibility !== 'none') this.telegraphs.push(t);
          break;
        }
        case 'cast': {
          const src = w.entity(ev.src);
          if (!src || src.kind !== 'fighter') break;
          const si = SLOT_INDEX[ev.slot];
          if (si === undefined || si > 3) break;
          const s = src.slots[si];
          if (!s) break;
          // (a point-targeted delayed circle: where it lands is readable from the windup)
          const info = abilityInfo(s.def);
          if (ev.castTime > 0.05 && info.tk === 'point' && info.delivery === 'area' && info.delay > 0.05 && info.radius > 0 && ((info.use & U_DAMAGE) !== 0 || info.cc)) {
            const dx = ev.x - src.x, dy = ev.y - src.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
            const k = info.range > 0 && d > info.range ? info.range / d : 1;
            this.windups.push({ id: -(++this.windupSeq), src: src.id, srcTeam: src.team, ability: s.def.id, x: src.x + dx * k, y: src.y + dy * k, dirX: dx / d, dirY: dy / d,
              kind: 'circle', radius: info.radius, inner: 0, half: Math.PI, length: 0, width: 0, at: ev.t, resolveAt: ev.t + ev.castTime + info.delay, visibility: 'everyone' });
          }
          // what an observer knows: the ability's listed cooldown at a rank its level allows — and only an observer
          // that could see the caster (lane AI G4: a hidden cast leaked into every team's cooldown read)
          const rank = Math.max(1, Math.min(s.baseDef.maxRank, Math.ceil(src.level / 2)));
          const back = ev.t + ev.castTime + ranked(s.def.cooldown, rank);
          const mask = late ? this.maskAt.get(src.id) ?? src.visibleMask : src.visibleMask;
          for (let t = 0; t < w.teams.length && t < 31; t++) {
            if (t === src.team || (mask & (1 << t)) === 0) continue;
            let byT = this.castSeenBy.get(t);
            if (!byT) { byT = new Map(); this.castSeenBy.set(t, byT); }
            let arrT = byT.get(src.id);
            if (!arrT) { arrT = new Float64Array(4); byT.set(src.id, arrT); }
            arrT[si] = back;
          }
          break;
        }
        case 'damage': {
          if (ev.amount <= 0) break;
          const dst = w.entity(ev.dst);
          if (!dst || dst.kind !== 'fighter') break;
          const src = w.creditFighter(w.entity(ev.src) ?? null);
          if (!src || src.team === dst.team) break;
          push3(this.hurtLog, dst.id, { t: ev.t, a: ev.amount, src: src.id }, ev.t);
          push3(this.dealtLog, src.id, { t: ev.t, a: ev.amount }, ev.t);
          let mx = this.takenMix.get(dst.id);
          if (!mx) { mx = { phys: 0, magic: 0, t: ev.t }; this.takenMix.set(dst.id, mx); }
          // (a ~3-minute fade; rational, not Math.exp: the sim's math stays bit-identical everywhere, probe_sim_dmath)
          const k = 1 / (1 + Math.max(0, ev.t - mx.t) / 180);
          mx.phys *= k; mx.magic *= k; mx.t = ev.t;
          if (ev.dtype === 'magic') mx.magic += ev.amount; else if (ev.dtype === 'phys') mx.phys += ev.amount;
          break;
        }
        case 'status': {
          if (ev.status === 'stun' || ev.status === 'root' || ev.status === 'airborne' || ev.status === 'taunt' || ev.status === 'fear' || ev.status === 'sleep') {
            const dst = w.entity(ev.dst);
            if (dst && dst.kind === 'fighter') this.heldAt.set(dst.id, ev.t);
          }
          break;
        }
        case 'structure': {
          // public: when a structure fell (gates come back after their respawn time)
          const v = w.entity(ev.id);
          if (v) { const info = this.structInfo(v); if (info) this.structDownAt.set(info.id, ev.t); }
          break;
        }
        case 'death': {
          if (ev.kind !== 'monster') break;
          const v = w.entity(ev.dst);
          if (!v) break;
          for (const b of this.brains) {
            if (!b || !w.vision.seen(b.team, v.x, v.y)) continue;
            for (const c of this.k.camps) {
              if (Math.abs(c.x - v.x) > 8 || Math.abs(c.y - v.y) > 8) continue;
              let others = false;
              for (const m of b.perc.monsters) if (m !== v && m.alive && Math.abs(m.x - c.x) < 8 && Math.abs(m.y - c.y) < 8) { others = true; break; }
              if (!others) b.campCleared(c.index, ev.t);
            }
          }
          break;
        }
        default: break;
      }
    }
  }

  /** the cooldown estimates a team holds for an enemy fighter (null: it never saw a cast) */
  castSeen(team: number, enemy: EntityId): Float64Array | null { return this.castSeenBy.get(team)?.get(enemy) ?? null; }

  /** damage enemy fighters dealt to fighter `id` in the last `span` s (≤ 3) */
  hurtBy(id: EntityId, now: number, span: number): number {
    const l = this.hurtLog.get(id);
    if (!l) return 0;
    let s = 0;
    for (const h of l) if (now - h.t <= span) s += h.a;
    return s;
  }
  /** the enemy fighter that dealt fighter `id` the most damage in the last `span` s (-1: none) */
  topHurter(id: EntityId, now: number, span: number): EntityId {
    const l = this.hurtLog.get(id);
    if (!l) return -1;
    let best = -1, bs = 0;
    for (let i = 0; i < l.length; i++) {
      if (now - l[i].t > span) continue;
      const src = l[i].src;
      let s = 0;
      for (const h of l) if (h.src === src && now - h.t <= span) s += h.a;
      if (s > bs || (s === bs && src < best)) { bs = s; best = src; }
    }
    return best;
  }
  /** damage fighter `id` dealt to enemy fighters in the last 3 s */
  dealt(id: EntityId, now: number): number {
    const l = this.dealtLog.get(id);
    if (!l) return 0;
    let s = 0;
    for (const h of l) if (now - h.t <= 3) s += h.a;
    return s;
  }

  /** has `enemy` (as far as team `team` knows) used every damaging basic+ult recently? */
  spentAbilities(enemy: EntityId, now: number, team: number): number {
    const a = this.castSeen(team, enemy);
    if (!a) return 0;
    let n = 0;
    for (let i = 0; i < 4; i++) if (a[i] > now) n++;
    return n;
  }
}

/** append to a fighter's 3 s log, dropping entries older than 3 s */
function push3<T extends { t: number }>(m: Map<EntityId, T[]>, id: EntityId, v: T, now: number): void {
  let l = m.get(id);
  if (!l) { l = []; m.set(id, l); }
  let drop = 0;
  while (drop < l.length && now - l[drop].t > 3) drop++;
  if (drop > 0) l.splice(0, drop);
  l.push(v);
}

export type { TeamBrain };
