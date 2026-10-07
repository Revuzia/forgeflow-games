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
import type { Knowledge, StructInfo } from './knowledge.ts';
import { IncomingIndex, rebuildPerception, TeamPerc, telegraphFromEvent, type Telegraph } from './perception.ts';
import { TEAM_THINK_TICKS, TeamBrain } from './team.ts';

export class BotMatch {
  readonly k: Knowledge;
  world: World | null = null;
  tick = -1;
  percs: TeamPerc[] = [];
  brains: (TeamBrain | null)[] = [];
  readonly incoming = new IncomingIndex();
  telegraphs: Telegraph[] = [];
  /** enemy fighter → estimated time each of a1..ult is back (cast events seen by some team) */
  readonly castSeen = new Map<EntityId, Float64Array>();
  /** map structure id → when it last fell */
  readonly structDownAt = new Map<string, number>();
  /** Fray: bot seat → the seat it is hunting (caps dog-piles on one human) */
  readonly ffaTarget = new Map<PlayerId, PlayerId>();
  private evArr: SimEvent[] | null = null;
  private evLen = 0;
  private visionTick = -1;

  constructor(k: Knowledge) { this.k = k; }

  private reset(w: World): void {
    this.world = w;
    this.tick = -1;
    this.evArr = null; this.evLen = 0; this.visionTick = -1;
    this.telegraphs = [];
    this.castSeen.clear();
    this.ffaTarget.clear();
    this.structCache.clear();
    this.structDownAt.clear();
    this.percs = [];
    this.brains = [];
    const lanes = this.k.lanes.length;
    for (let t = 0; t < w.teams.length; t++) {
      const tp = new TeamPerc(t, lanes);
      this.percs.push(tp);
      this.brains.push(this.k.ffa || this.k.kind === 'practice' ? null : new TeamBrain(t, this.k, tp, this.structDownAt));
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
    if (this.evArr && this.evArr !== w.events) this.consume(w, this.evArr, this.evLen);
    this.evArr = w.events;
    this.consume(w, w.events, 0);
    this.evLen = w.events.length;
    const now = w.time;
    if (this.telegraphs.length > 0) this.telegraphs = this.telegraphs.filter((t) => t.resolveAt > now - 0.05);
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

  private consume(w: World, arr: readonly SimEvent[], from: number): void {
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
          let arrT = this.castSeen.get(src.id);
          if (!arrT) { arrT = new Float64Array(4); this.castSeen.set(src.id, arrT); }
          // what an observer knows: the ability's listed cooldown at a rank its level allows
          const rank = Math.max(1, Math.min(s.baseDef.maxRank, Math.ceil(src.level / 2)));
          arrT[si] = ev.t + ev.castTime + ranked(s.def.cooldown, rank);
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

  /** has `enemy` (as far as an observer knows) used every damaging basic+ult recently? */
  spentAbilities(enemy: EntityId, now: number): number {
    const a = this.castSeen.get(enemy);
    if (!a) return 0;
    let n = 0;
    for (let i = 0; i < 4; i++) if (a[i] > now) n++;
    return n;
  }
}

export type { TeamBrain };
