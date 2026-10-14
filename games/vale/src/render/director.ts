// VALE render — the event director: SimEvents → VFX spawns and telegraph decals.
//
// Ids come only from the catalog (CONTRACT §0): projectile/hit/area/dash events carry Present vfx ids,
// casts look up their ability's Present, basic-attack hits use the attacker's `attack.present.hitVfx`.
// World events that carry no id (level up, respawn, death, structure fall, recall, pickup, status…) map
// through RendererOptions.eventVfx / statusVfx, supplied by the caller from data (open request: a
// catalog table for these). Nothing here names a content id.
//
// Fog: an effect is shown only where the local team can see (its anchor or its source is visible), so
// VFX never leak positions. Tiers: basic attacks T1, abilities T2, CC/zones/delayed areas T3, ultimates
// and structure falls T4.

import { Color, Vector3 } from 'three';
import type { CatalogT, ShapeT, StatusKindT } from '../contracts/catalog.ts';
import type { EntityView, SimEvent, WorldView } from '../contracts/sim.ts';
import type { Palette, Relation } from './palette.ts';
import type { Tier, VfxSystem } from './vfx/system.ts';

export type EventVfxKey = 'levelUp' | 'respawn' | 'death' | 'unitDeath' | 'structureFall' | 'recall' | 'pickup' | 'objective'
  | 'blink' | 'crit' | 'heal' | 'shield' | 'ultWindup';
export type EventVfxMap = Partial<Record<EventVfxKey, string>>;
export type StatusVfxMap = Partial<Record<StatusKindT, string>>;

interface AbilityInfo { vfx?: string; hitVfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone'; tier: Tier; heal: boolean }

export interface Telegraph {
  x: number; y: number; dir: number;
  shape: NonNullable<EntityView['shape']>;
  start: number; land: number; end: number;
  src: number; team: number; owner: number;
  zone: number;     // zone entity id (persistent while it exists), −1 otherwise
  heal: boolean;
}

export interface DirectorHost {
  view(): WorldView | null;
  palette(): Palette;
  /** body-centre position of an entity (render-interpolated); false if unknown */
  bodyPos(id: number, out: Vector3): boolean;
  /** can the local viewer see this ground point? */
  visibleAt(x: number, y: number): boolean;
  /** is this entity visible to the local viewer? */
  entityVisible(e: EntityView): boolean;
  /** skin VFX tint override for a fighter entity (cosmetic) */
  skinTint(e: EntityView): Color | null;
  now(): number;
  shake(px: number, ms: number): void;
}

const HEALING_OPS = new Set(['heal', 'shield']);

export class Director {
  private readonly abilities = new Map<string, AbilityInfo>();
  private readonly attackHit = new Map<string, { vfx?: string; hitVfx?: string }>();
  private readonly element = new Map<string, Color>();
  private readonly vfx: VfxSystem;
  private readonly host: DirectorHost;
  readonly telegraphs: Telegraph[] = [];
  private readonly lastCast = new Map<number, { x: number; y: number; t: number; slot: string }>();
  eventVfx: EventVfxMap = {};
  statusVfx: StatusVfxMap = {};
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly zonesSeen = new Set<number>();
  /** fighter passive ids: their procs arrive as `proc` events */
  private readonly passives = new Set<string>();
  private readonly passiveLast = new Map<string, number>();

  constructor(catalog: CatalogT, vfx: VfxSystem, host: DirectorHost) {
    this.vfx = vfx;
    this.host = host;
    const add = (a: { id: string; present?: { vfx?: string; hitVfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone' }; effects?: unknown[] }, tier: Tier): void => {
      if (this.abilities.has(a.id)) return;
      const heal = Array.isArray(a.effects) && a.effects.some((e) => HEALING_OPS.has((e as { op?: string }).op ?? '')) && !a.effects.some((e) => (e as { op?: string }).op === 'damage');
      this.abilities.set(a.id, { vfx: a.present?.vfx, hitVfx: a.present?.hitVfx, telegraph: a.present?.telegraph, tier, heal });
    };
    for (const f of catalog.fighters) {
      this.element.set(f.id, new Color().setStyle(f.palette.primary));
      this.attackHit.set(f.id, { vfx: f.attack.present?.vfx, hitVfx: f.attack.present?.hitVfx });
      const kits = [f.kit, ...Object.values(f.kit.passive.forms ?? {}).map((fm) => fm.kit ?? {})] as Record<string, unknown>[];
      for (const kit of kits) for (const slot of ['a1', 'a2', 'a3', 'ult'] as const) {
        const a = kit[slot] as { id: string; present?: AbilityInfo; effects?: unknown[]; recast?: { ability: { id: string; present?: AbilityInfo; effects?: unknown[] } } } | undefined;
        if (!a) continue;
        add(a, slot === 'ult' ? 4 : 2);
        if (a.recast) add(a.recast.ability, slot === 'ult' ? 4 : 2);
      }
      add({ id: f.kit.passive.id, present: f.kit.passive.present }, 1);
      this.passives.add(f.kit.passive.id);
    }
    for (const it of catalog.items) if (it.active) add(it.active, 2);
    for (const s of catalog.setup.spells) add(s, 2);
    for (const u of catalog.units) {
      this.attackHit.set(u.id, { vfx: u.attack?.present?.vfx, hitVfx: u.attack?.present?.hitVfx });
      for (const a of u.abilities) add(a, u.kind === 'monster' ? 3 : 2);
    }
  }

  private colorFor(e: EntityView | undefined, team: number, owner: number): { c: Color; rel: Relation } {
    const p = this.host.palette();
    const isF = e ? e.kind === 'fighter' : false;
    const rel = p.relation(team, owner, isF);
    return { c: p.unitColor(team, owner, isF || (owner >= 0 && e?.kind !== 'minion')), rel };
  }

  private elementOf(e: EntityView | undefined): Color | null {
    if (!e) return null;
    if (e.kind === 'fighter') return this.host.skinTint(e) ?? this.element.get(e.def) ?? null;
    return null;
  }

  /** spawn a def anchored on/around a source entity */
  private fire(id: string | undefined, srcId: number, tier: Tier, o: { origin?: Vector3 | null; target?: Vector3 | null; ground?: Vector3 | null; scale?: number; dir?: number; follow?: number; followFor?: number; targetId?: number; anchor?: 'origin' | 'target' | 'path' | 'ground'; loopWhile?: number }): void {
    if (!id || !this.vfx.has(id)) return;
    const view = this.host.view();
    const src = view?.entity(srcId);
    const team = src ? src.team : -1, owner = src ? src.owner : -1;
    const { c, rel } = this.colorFor(src, team, owner);
    this.vfx.spawn(id, {
      tier, team: c, element: this.elementOf(src), ally: rel === 'ally', ownT1: rel === 'self' && tier <= 1,
      origin: o.origin ?? null, target: o.target ?? null, ground: o.ground ?? null, scale: o.scale, dir: o.dir,
      follow: o.follow, followFor: o.followFor, targetId: o.targetId, sourceId: srcId, anchor: o.anchor, loopWhile: o.loopWhile,
    });
  }

  private srcVisible(view: WorldView, id: number): boolean {
    const e = view.entity(id);
    return !!e && this.host.entityVisible(e);
  }

  handle(events: readonly SimEvent[]): void {
    const view = this.host.view();
    if (!view) return;
    const p = this.host.palette();
    const A = this.tmpA, B = this.tmpB, C = this.tmpC;
    for (const ev of events) {
      switch (ev.e) {
        case 'cast': {
          const src = view.entity(ev.src);
          if (src) this.lastCast.set(ev.src, { x: ev.x, y: ev.y, t: this.host.now(), slot: ev.slot });
          if (!src || !this.host.entityVisible(src)) break;
          const info = this.abilities.get(ev.ability);
          const tier: Tier = ev.slot === 'ult' ? 4 : info?.tier ?? 2;
          if (!this.host.bodyPos(ev.src, A)) break;
          if (info?.vfx) this.fire(info.vfx, ev.src, tier, { origin: A, ground: A, dir: Math.atan2(ev.y - src.y, ev.x - src.x), anchor: 'origin' });
          if (ev.slot === 'ult' && this.eventVfx.ultWindup) this.fire(this.eventVfx.ultWindup, ev.src, 4, { origin: A, ground: A, anchor: 'origin' });
          if (ev.slot === 'ult' && p.relation(src.team, src.owner, true) === 'self') this.host.shake(3, 100);
          break;
        }
        case 'projectile': {
          const src = view.entity(ev.src);
          const pe = view.entity(ev.id);
          const visible = (src && this.host.entityVisible(src)) || (pe && this.host.entityVisible(pe));
          if (!visible) break;
          const tier: Tier = ev.ability === 'attack' ? 1 : (this.abilities.get(ev.ability)?.tier ?? 2);
          if (!this.host.bodyPos(ev.src, A)) A.set(pe ? pe.x : 0, 1, pe ? pe.y : 0);
          const id = ev.vfx ?? (ev.ability === 'attack' && src ? this.attackHit.get(src.def)?.vfx : undefined);
          if (id && this.vfx.has(id)) this.fire(id, ev.src, tier, { origin: A, follow: ev.id, anchor: 'path', dir: pe ? Math.atan2(pe.vy, pe.vx) : 0 });
          break;
        }
        case 'hit': {
          if (!ev.vfx) break;
          const dst = view.entity(ev.dst);
          if (!dst || !this.host.entityVisible(dst)) break;
          const info = ev.ability ? this.abilities.get(ev.ability) : undefined;
          this.host.bodyPos(ev.dst, B);
          if (!this.host.bodyPos(ev.src, A)) A.copy(B);
          this.fire(ev.vfx, ev.src, info?.tier ?? 2, { origin: A, target: B, ground: B, targetId: ev.dst, anchor: 'target', dir: Math.atan2(B.z - A.z, B.x - A.x) });
          break;
        }
        case 'proc': {
          // a fighter passive fired: its own look on the subject (else on the owner). Periodic triggers
          // (interval, moveDistance) show at most every 6 s per owner so an aura reminds, never nags;
          // the rest at most every 0.4 s per passive and subject.
          const info = this.passives.has(ev.ability) ? this.abilities.get(ev.ability) : undefined;
          if (!info?.vfx) break;
          const periodic = ev.on === 'interval' || ev.on === 'moveDistance';
          const subj = ev.dst ?? ev.src;
          const key = periodic ? `${ev.ability}:${ev.src}` : `${ev.ability}:${subj}`;
          const now = this.host.now();
          const at = view.entity(subj);
          if (!at || !this.host.entityVisible(at) || now - (this.passiveLast.get(key) ?? -1e9) < (periodic ? 6 : 0.4)) break;
          this.passiveLast.set(key, now);
          this.host.bodyPos(subj, B);
          if (!this.host.bodyPos(ev.src, A)) A.copy(B);
          this.fire(info.vfx, ev.src, 1, { origin: A, target: B, ground: B, targetId: subj, anchor: 'target', dir: Math.atan2(B.z - A.z, B.x - A.x) });
          break;
        }
        case 'damage': {
          if (ev.ability) break; // ability hits arrive as 'hit'
          const src = view.entity(ev.src), dst = view.entity(ev.dst);
          if (!src || !dst || !this.host.entityVisible(dst)) break;
          const ah = this.attackHit.get(src.def);
          this.host.bodyPos(ev.dst, B);
          if (!this.host.bodyPos(ev.src, A)) A.copy(B);
          if (ah?.hitVfx) this.fire(ah.hitVfx, ev.src, 1, { origin: A, target: B, ground: B, targetId: ev.dst, anchor: 'target', dir: Math.atan2(B.z - A.z, B.x - A.x) });
          if (ev.crit && this.eventVfx.crit) this.fire(this.eventVfx.crit, ev.src, 2, { origin: A, target: B, ground: B, anchor: 'target' });
          break;
        }
        case 'area': {
          const src = view.entity(ev.src);
          const team = src ? src.team : -1, owner = src ? src.owner : -1;
          const seen = this.host.visibleAt(ev.x, ev.y) || (!!src && this.host.entityVisible(src));
          const info = this.abilities.get(ev.ability);
          const lc = this.lastCast.get(ev.src);
          const dir = lc && Math.hypot(lc.x - ev.x, lc.y - ev.y) > 0.05 && src
            ? Math.atan2(lc.y - (src.y), lc.x - (src.x))
            : src ? src.facing : 0;
          const areaDir = src && Math.hypot(ev.x - src.x, ev.y - src.y) > 0.3 && ev.shape && (ev.shape.kind === 'cone' || ev.shape.kind === 'rect')
            ? (lc ? Math.atan2(lc.y - ev.y, lc.x - ev.x) : dir) : dir;
          // telegraph (visibility rules from Present.telegraph)
          const tg = ev.telegraph;
          const rel = p.relation(team, owner, src?.kind === 'fighter');
          const allowed = tg === 'everyone' || (tg === 'ally_only' && (rel === 'ally' || rel === 'self' || p.viewer.team < 0));
          if (seen && allowed && ev.shape) {
            const now = this.host.now();
            this.telegraphs.push({
              x: ev.x, y: ev.y, dir: areaDir, shape: ev.shape, start: now, land: now + Math.max(0, ev.delay), end: now + Math.max(0, ev.delay) + 0.15,
              src: ev.src, team, owner, zone: -1, heal: !!info?.heal,
            });
          }
          // the landing effect (a zone loops from its entity instead)
          if (!seen || !ev.vfx) break;
          const zone = this.matchZone(view, ev);
          if (zone >= 0) break;
          const R = ev.shape ? (ev.shape.radius ?? (ev.shape.length ?? 2) * 0.5) : 1;
          const tier: Tier = (info?.tier ?? 2) >= 4 ? 4 : ev.delay > 0 || tg === 'everyone' ? 3 : (info?.tier ?? 2);
          C.set(ev.x, 0, ev.y);
          if (ev.shape?.kind === 'rect' && ev.shape.length) C.set(ev.x + Math.cos(areaDir) * ev.shape.length * 0.5, 0, ev.y + Math.sin(areaDir) * ev.shape.length * 0.5);
          if (!this.host.bodyPos(ev.src, A)) A.copy(C);
          const id = ev.vfx;
          const spawn = (): void => this.fire(id, ev.src, tier, { origin: A.clone(), ground: C.clone(), scale: R, dir: areaDir, anchor: 'ground' });
          if (ev.delay > 0) this.delayed.push({ at: this.host.now() + ev.delay, run: spawn }); else spawn();
          break;
        }
        case 'dash': {
          const src = view.entity(ev.src);
          if (!src || !this.host.entityVisible(src) || !ev.vfx) break;
          A.set(ev.fromX, 1, ev.fromY);
          // the trail follows the fighter for the dash only (then it lets go and fades)
          this.fire(ev.vfx, ev.src, 3, { origin: A, ground: A, follow: ev.src, followFor: ev.duration + 0.05, anchor: 'path', dir: Math.atan2(ev.toY - ev.fromY, ev.toX - ev.fromX) });
          break;
        }
        case 'blink': {
          const src = view.entity(ev.src);
          if (!src || !this.host.entityVisible(src) || !this.eventVfx.blink) break;
          A.set(ev.fromX, 1, ev.fromY); B.set(ev.toX, 1, ev.toY);
          this.fire(this.eventVfx.blink, ev.src, 3, { origin: A, ground: A, anchor: 'origin' });
          this.fire(this.eventVfx.blink, ev.src, 3, { origin: B, ground: B, anchor: 'origin' });
          break;
        }
        case 'status': {
          const id = this.statusVfx[ev.status];
          const dst = view.entity(ev.dst);
          if (!id || !dst || !this.host.entityVisible(dst)) break;
          this.host.bodyPos(ev.dst, B);
          this.fire(id, ev.dst, 3, { origin: B, target: B, ground: B, targetId: ev.dst, anchor: 'target' });
          break;
        }
        case 'heal': {
          const dst = view.entity(ev.dst);
          if (!this.eventVfx.heal || !dst || !this.host.entityVisible(dst) || ev.amount < dst.maxHp * 0.05) break;
          this.host.bodyPos(ev.dst, B);
          this.fire(this.eventVfx.heal, ev.src, 2, { origin: B, target: B, ground: B, targetId: ev.dst, anchor: 'target' });
          break;
        }
        case 'shield': {
          const dst = view.entity(ev.dst);
          if (!this.eventVfx.shield || !dst || !this.host.entityVisible(dst)) break;
          this.host.bodyPos(ev.dst, B);
          this.fire(this.eventVfx.shield, ev.dst, 2, { origin: B, target: B, ground: B, targetId: ev.dst, anchor: 'target' });
          break;
        }
        case 'death': {
          const dst = view.entity(ev.dst);
          if (!dst || !this.host.entityVisible(dst)) break;
          this.host.bodyPos(ev.dst, B);
          if (ev.kind === 'structure') {
            if (this.eventVfx.structureFall) this.fire(this.eventVfx.structureFall, ev.dst, 4, { origin: B.setY(0.5), ground: B, scale: 1.5, anchor: 'origin' });
            this.host.shake(4, 120);
          } else {
            const id = ev.kind === 'fighter' ? this.eventVfx.death : this.eventVfx.unitDeath;
            this.fire(id, ev.dst, ev.kind === 'fighter' ? 3 : 1, { origin: B, target: B, ground: B, anchor: 'origin' });
          }
          break;
        }
        case 'respawn': case 'levelUp': {
          const pl = view.players.find((x) => x.player === ev.player);
          if (!pl) break;
          const e = view.entity(ev.e === 'respawn' ? ev.entity : pl.entity);
          if (!e || !this.host.entityVisible(e)) break;
          const id = ev.e === 'respawn' ? this.eventVfx.respawn : this.eventVfx.levelUp;
          this.host.bodyPos(e.id, B);
          if (ev.e === 'respawn') B.set(e.x, 1, e.y);
          this.fire(id, e.id, 2, { origin: B, ground: B, target: B, anchor: 'origin' });
          break;
        }
        case 'recall': {
          if (ev.state === 'cancel' || !this.eventVfx.recall) break;
          const pl = view.players.find((x) => x.player === ev.player);
          const e = pl ? view.entity(pl.entity) : undefined;
          if (!e || !this.host.entityVisible(e)) break;
          this.host.bodyPos(e.id, B);
          this.fire(this.eventVfx.recall, e.id, 2, { origin: B, ground: B, anchor: 'origin' });
          break;
        }
        case 'pickup': {
          if (!this.eventVfx.pickup || !this.host.visibleAt(ev.x, ev.y)) break;
          const pl = view.players.find((x) => x.player === ev.player);
          B.set(ev.x, 0.6, ev.y);
          this.fire(this.eventVfx.pickup, pl ? pl.entity : -1, 2, { origin: B, ground: B, anchor: 'origin' });
          break;
        }
        default: break;
      }
    }
  }

  private readonly delayed: { at: number; run: () => void }[] = [];

  /** an area event that is the spawn of a zone entity (same vfx, same spot) loops from the zone */
  private matchZone(view: WorldView, ev: Extract<SimEvent, { e: 'area' }>): number {
    for (const e of view.entities) {
      if (e.kind !== 'zone' || this.zonesSeen.has(e.id)) continue;
      if (e.vfx === ev.vfx && Math.abs(e.x - ev.x) < 0.2 && Math.abs(e.y - ev.y) < 0.2) return e.id;
    }
    return -1;
  }

  /** zones: persistent telegraphs + looping VFX while they exist; delayed landings */
  update(view: WorldView | null): void {
    const now = this.host.now();
    for (let i = this.delayed.length - 1; i >= 0; i--) if (now >= this.delayed[i].at) { const d = this.delayed[i]; this.delayed.splice(i, 1); d.run(); }
    // expire telegraphs
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      if (t.zone >= 0) { const z = view?.entity(t.zone); if (!z) this.telegraphs.splice(i, 1); else { t.x = z.x; t.y = z.y; } }
      else if (now > t.end) this.telegraphs.splice(i, 1);
    }
    if (!view) return;
    const p = this.host.palette();
    for (const e of view.entities) {
      if (e.kind !== 'zone' || this.zonesSeen.has(e.id)) continue;
      this.zonesSeen.add(e.id);
      const src = this.findOwnerEntity(view, e);
      const seen = this.host.visibleAt(e.x, e.y) || this.host.entityVisible(e);
      if (!seen) continue;
      if (e.shape) {
        const rel = p.relation(e.team, e.owner, false);
        void rel;
        this.telegraphs.push({ x: e.x, y: e.y, dir: e.facing, shape: e.shape, start: now, land: now, end: Infinity, src: src ? src.id : -1, team: e.team, owner: e.owner, zone: e.id, heal: false });
      }
      if (e.vfx && this.vfx.has(e.vfx)) {
        const R = e.shape ? (e.shape.radius ?? (e.shape.length ?? 2) * 0.5) : Math.max(1, e.radius);
        const C = new Vector3(e.x, 0, e.y);
        const { c, rel } = this.colorFor(src, e.team, e.owner);
        this.vfx.spawn(e.vfx, { tier: 3, team: c, element: this.elementOf(src), ally: rel === 'ally', origin: C, ground: C, scale: R, dir: e.facing, anchor: 'ground', loopWhile: e.id });
      }
    }
    if (this.zonesSeen.size > 4096) {
      const alive = new Set(view.entities.filter((e) => e.kind === 'zone').map((e) => e.id));
      for (const id of this.zonesSeen) if (!alive.has(id)) this.zonesSeen.delete(id);
    }
  }

  private findOwnerEntity(view: WorldView, e: EntityView): EntityView | undefined {
    if (e.owner < 0) return undefined;
    const pl = view.players.find((x) => x.player === e.owner);
    return pl ? view.entity(pl.entity) : undefined;
  }

  clear(): void { this.telegraphs.length = 0; this.lastCast.clear(); this.delayed.length = 0; this.zonesSeen.clear(); }
}

export type { ShapeT };
