// VALE render — the event director: SimEvents → VFX spawns, telegraph decals, status visuals and the
// screen-level envelopes (exposure, death grade).
//
// Ids come only from the catalog (CONTRACT §0): projectile/hit/area/dash events carry Present vfx ids,
// casts look up their ability's Present, basic-attack hits use the attacker's `attack.present.hitVfx`.
// World events that carry no id (level up, respawn, death, structure fall, recall, pickup, wind-ups,
// status…) map through RendererOptions.eventVfx / statusVfx, supplied by the caller from data
// (client.vfxEvents / client.vfxStatus). Nothing here names a content id.
//
// Fog: an effect is shown only where the local team can see (its anchor or its source is visible), so
// VFX never leak positions. Tiers: basic attacks T1, abilities T2, CC/zones/delayed areas T3, ultimates
// and structure falls T4.
//
// Timing (r12 M1 / M3 / M2 / M13):
//   wind-up    a cast with castTime > 0 shows its ground warning from the FIRST frame of the wind-up (when
//              the ability is telegraph:everyone or holds a delayed area; visibility per ability and
//              viewer): the shape lands at castTime + area delay (+ dash travel for a dash that lands an
//              area), the matching area / dash event takes it over (exact point, exact landing) instead
//              of stacking a second one, a cancelled or fizzled cast removes it. Dashes show their path.
//              The caster's anticipation VFX plays over the same wind-up: Present.windupVfx (a def whose
//              clock is fitted to castTime), else the cast def's phase:'windup' layers, else the generic
//              client.vfxEvents.windup (ultCharge for ultimates, which also play ultWindup); casts under
//              0.12 s get castFlash. It is
//              sustained while the wind-up runs and cancelled with it.
//   status     every status kind with a client.vfxStatus look is shown for its WHOLE duration: one
//              sustained instance per (unit, kind), released when the kind leaves EntityView.statuses
//              (or the unit dies / leaves vision). Taunt tethers to the taunter (the unit that hit it).
//   exposure   ultimate impacts (T4 area landings, the first T4 hit) start the default exposure envelope
//              (vfx/screen.ts) unless their def carries its own feel.exposure. Structure falls a softer one.
//   death      the local player's world eases to grey while they wait to respawn.
//   shake      m4: no ability shakes the camera (the own-ultimate shake is gone); structure falls keep
//              ≤ 4 px for 120 ms × access.screenShake (the camera clamps).

import { Color, Vector3 } from 'three';
import type { CatalogT, ShapeT, StatusKindT } from '../contracts/catalog.ts';
import { type EntityView, type SimEvent, TICK_DT, type WorldView } from '../contracts/sim.ts';
import type { Palette, Relation } from './palette.ts';
import { screenFx } from './vfx/screen.ts';
import type { Tier, VfxSystem } from './vfx/system.ts';

export type EventVfxKey = 'levelUp' | 'respawn' | 'death' | 'unitDeath' | 'structureFall' | 'recall' | 'pickup' | 'objective'
  | 'blink' | 'crit' | 'heal' | 'shield' | 'ultWindup' | 'windup' | 'ultCharge' | 'castFlash';
export type EventVfxMap = Partial<Record<EventVfxKey, string>>;
export type StatusVfxMap = Partial<Record<StatusKindT, string>>;

type ViewShape = NonNullable<EntityView['shape']>;

/** the ground warning an ability shows from its wind-up (built once from the record) */
interface CastTele {
  shape: ViewShape;
  /** point: the cast point · caster: on the caster · aim: from the caster along the aim · land: a dash's landing */
  anchor: 'point' | 'caster' | 'aim' | 'land';
  /** seconds after release before it lands (the area's delay) */
  delay: number;
  dash: { toPoint: boolean; distance: number; speed: number } | null;
  vis: 'everyone' | 'ally_only';
}

interface AbilityInfo {
  vfx?: string; hitVfx?: string; windupVfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone'; tier: Tier; heal: boolean;
  cast: CastTele | null;
}

export interface Telegraph {
  x: number; y: number; dir: number;
  shape: NonNullable<EntityView['shape']>;
  start: number; land: number; end: number;
  src: number; team: number; owner: number;
  zone: number;     // zone entity id (persistent while it exists), −1 otherwise
  heal: boolean;
  /** wind-up telegraphs: 'windup' until the release event takes over, 'travel' while a dash flies */
  stage?: 'windup' | 'travel';
  ability?: string;
  /** sim time the wind-up releases */
  castEnd?: number;
  /** caster-anchored wind-ups track the caster until release */
  follow?: 'caster' | 'aim';
  /** the cast point (aim direction while following) */
  aimX?: number; aimY?: number;
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
const HARM_OPS = /"op":"(damage|status|displace|pull)"/;

/** status kinds in contract order (catalog StatusKind): the (unit, kind) key and the look's tier.
 *  Hard control plays at T3, movement and protection states at T2, light debuffs at T1. */
const STATUS_ORDER: readonly StatusKindT[] = [
  'stun', 'root', 'slow', 'silence', 'disarm', 'airborne', 'taunt', 'fear', 'sleep',
  'haste', 'invisible', 'untargetable', 'unstoppable', 'reveal', 'grievous', 'armor_shred', 'resist_shred',
];
const STATUS_TIER: Partial<Record<StatusKindT, Tier>> = {
  stun: 3, root: 3, silence: 3, disarm: 3, airborne: 3, taunt: 3, fear: 3, sleep: 3,
  slow: 2, invisible: 2, untargetable: 2, unstoppable: 2, reveal: 2,
  haste: 1, grievous: 1, armor_shred: 1, resist_shred: 1,
};
const statusKey = (id: number, kind: StatusKindT): number => id * 32 + Math.max(0, STATUS_ORDER.indexOf(kind));

/** wind-ups shorter than this get the cast flare instead of a charge (s) */
const WINDUP_MIN = 0.12;
/** default T4 impact envelope (vfx/screen.ts) */
const ULT_EXPOSURE = { peak: 2.6, hold: 0.28, fade: 0.12, dip: 0.92, desat: 0.35 };
const FALL_EXPOSURE = { peak: 1.8, hold: 0.2, fade: 0.14, dip: 0.95, desat: 0.2 };

function viewShape(s: ShapeT | undefined): ViewShape | null {
  if (!s) return null;
  switch (s.kind) {
    case 'circle': return { kind: 'circle', radius: s.radius };
    case 'ring': return { kind: 'ring', radius: s.radius, inner: s.inner };
    case 'cone': return { kind: 'cone', radius: s.radius, angle: (s.angleDeg * Math.PI) / 180 };
    case 'rect': return { kind: 'rect', length: s.length, width: s.width };
    default: return null;
  }
}

type Eff = { op?: string; at?: string; shape?: ShapeT; delay?: number; mode?: string; distance?: number; speed?: number; passWidth?: number;
  onArrive?: Eff[]; present?: { telegraph?: 'none' | 'ally_only' | 'everyone' } };
type AbilityRec = { id: string; castTime?: number; targeting?: { kind?: string; indicator?: ShapeT }; effects?: unknown[];
  present?: { vfx?: string; hitVfx?: string; windupVfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone' } };

/** the wind-up ground warning of an ability record, or null (rule: telegraph:everyone, or a delayed area) */
function castTeleOf(a: AbilityRec): CastTele | null {
  const tk = a.targeting?.kind;
  if (tk !== 'point' && tk !== 'self' && tk !== 'direction') return null;
  const effs = (a.effects ?? []) as Eff[];
  let area: Eff | null = null, dash: Eff | null = null;
  for (const e of effs) {
    if (!area && (e.op === 'area' || e.op === 'zone') && (e.at === 'point' || e.at === 'self')) area = e;
    if (!dash && e.op === 'dash' && (e.mode === 'toPoint' || e.mode === 'direction')) dash = e;
  }
  let arrive: Eff | null = null;
  if (dash) for (const e of dash.onArrive ?? []) if ((e.op === 'area' || e.op === 'zone') && e.at !== 'hit' && e.at !== 'target') { arrive = e; break; }
  const delayed = [arrive, area].find((x) => !!x && (x.delay ?? 0) > 0) ?? null;
  const own = a.present?.telegraph;
  const vis = own ?? (delayed ? (delayed.present?.telegraph ?? 'everyone') : 'none');
  if (vis === 'none' || (vis === 'ally_only' && !delayed)) return null;
  const ind = viewShape(a.targeting?.indicator);
  let shape: ViewShape | null = null, anchor: CastTele['anchor'] = 'point', delay = 0;
  let dashInfo: CastTele['dash'] = null;
  if (dash) {
    dashInfo = { toPoint: dash.mode === 'toPoint', distance: Math.max(0, dash.distance ?? 0), speed: Math.max(0.1, dash.speed ?? 10) };
    if (arrive) { shape = ind && (ind.kind === 'circle' || ind.kind === 'ring') ? ind : viewShape(arrive.shape); anchor = 'land'; delay = arrive.delay ?? 0; }
    else { shape = ind && ind.kind === 'rect' ? ind : { kind: 'rect', length: dashInfo.distance, width: Math.max(0.6, (dash.passWidth ?? 0.5) * 2) }; anchor = 'aim'; }
  } else if (area) {
    shape = ind ?? viewShape(area.shape);
    delay = area.delay ?? 0;
    anchor = shape && (shape.kind === 'cone' || shape.kind === 'rect') ? 'aim' : area.at === 'self' || tk === 'self' ? 'caster' : 'point';
  } else if (ind && own === 'everyone') {
    shape = ind;
    anchor = ind.kind === 'cone' || ind.kind === 'rect' ? 'aim' : tk === 'self' ? 'caster' : 'point';
  }
  if (!shape) return null;
  return { shape, anchor, delay: Math.max(0, delay), dash: dashInfo, vis: vis === 'ally_only' ? 'ally_only' : 'everyone' };
}

interface Windup { h: number; src: number; castEnd: number }

export class Director {
  private readonly abilities = new Map<string, AbilityInfo>();
  private readonly attackHit = new Map<string, { vfx?: string; hitVfx?: string }>();
  private readonly element = new Map<string, Color>();
  private readonly vfx: VfxSystem;
  private readonly host: DirectorHost;
  readonly telegraphs: Telegraph[] = [];
  private readonly lastCast = new Map<number, { x: number; y: number; t: number; slot: string; ability: string }>();
  eventVfx: EventVfxMap = {};
  statusVfx: StatusVfxMap = {};
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly zonesSeen = new Set<number>();
  /** fighter passive ids: their procs arrive as `proc` events */
  private readonly passives = new Set<string>();
  private readonly passiveLast = new Map<string, number>();
  /** live wind-up anticipation instances */
  private readonly windups: Windup[] = [];
  /** live status visuals: (unit, kind) → VFX handle */
  private readonly statusFx = new Map<number, number>();
  /** who applied a status (taunt tethers): (unit, kind) → source entity */
  private readonly statusSrc = new Map<number, number>();
  /** this batch: the last unit that hit each unit */
  private readonly lastHit = new Map<number, number>();
  /** T4 exposure envelopes: one per caster per 0.6 s */
  private readonly lastPulse = new Map<number, number>();

  constructor(catalog: CatalogT, vfx: VfxSystem, host: DirectorHost) {
    this.vfx = vfx;
    this.host = host;
    const add = (a: AbilityRec, tier: Tier): void => {
      if (this.abilities.has(a.id)) return;
      const heal = Array.isArray(a.effects) && a.effects.some((e) => HEALING_OPS.has((e as { op?: string }).op ?? '')) && !a.effects.some((e) => (e as { op?: string }).op === 'damage');
      const cast = (a.castTime ?? 0) > 0 && Array.isArray(a.effects) && (HARM_OPS.test(JSON.stringify(a.effects)) || a.present?.telegraph === 'everyone') ? castTeleOf(a) : null;
      this.abilities.set(a.id, { vfx: a.present?.vfx, hitVfx: a.present?.hitVfx, windupVfx: a.present?.windupVfx, telegraph: a.present?.telegraph, tier, heal, cast });
    };
    for (const f of catalog.fighters) {
      this.element.set(f.id, new Color().setStyle(f.palette.primary));
      this.attackHit.set(f.id, { vfx: f.attack.present?.vfx, hitVfx: f.attack.present?.hitVfx });
      const kits = [f.kit, ...Object.values(f.kit.passive.forms ?? {}).map((fm) => fm.kit ?? {})] as Record<string, unknown>[];
      for (const kit of kits) for (const slot of ['a1', 'a2', 'a3', 'ult'] as const) {
        const a = kit[slot] as (AbilityRec & { recast?: { ability: AbilityRec } }) | undefined;
        if (!a) continue;
        add(a, slot === 'ult' ? 4 : 2);
        if (a.recast) add(a.recast.ability, slot === 'ult' ? 4 : 2);
      }
      add({ id: f.kit.passive.id, present: f.kit.passive.present }, 1);
      this.passives.add(f.kit.passive.id);
    }
    for (const it of catalog.items) if (it.active) add(it.active as AbilityRec, 2);
    for (const s of catalog.setup.spells) add(s as AbilityRec, 2);
    for (const u of catalog.units) {
      this.attackHit.set(u.id, { vfx: u.attack?.present?.vfx, hitVfx: u.attack?.present?.hitVfx });
      for (const a of u.abilities) add(a as AbilityRec, u.kind === 'monster' ? 3 : 2);
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

  /** spawn a def anchored on/around a source entity; returns the VFX handle (0 = nothing spawned) */
  private fire(id: string | undefined, srcId: number, tier: Tier, o: { origin?: Vector3 | null; target?: Vector3 | null; ground?: Vector3 | null; scale?: number; dir?: number; follow?: number; followFor?: number; targetId?: number; anchor?: 'origin' | 'target' | 'path' | 'ground'; loopWhile?: number; sustain?: () => boolean; timeScale?: number; phase?: 'main' | 'windup'; world?: boolean }): number {
    if (!id || !this.vfx.has(id)) return 0;
    const view = this.host.view();
    const src = view?.entity(srcId);
    const team = src ? src.team : -1, owner = src ? src.owner : -1;
    const { c, rel } = this.colorFor(src, team, owner);
    return this.vfx.spawnHandle(id, {
      tier, team: c, element: this.elementOf(src), ally: rel === 'ally', ownT1: rel === 'self' && tier <= 1,
      origin: o.origin ?? null, target: o.target ?? null, ground: o.ground ?? null, scale: o.scale, dir: o.dir,
      follow: o.follow, followFor: o.followFor, targetId: o.targetId, sourceId: srcId, anchor: o.anchor, loopWhile: o.loopWhile,
      sustain: o.sustain, timeScale: o.timeScale, phase: o.phase, world: o.world,
    });
  }

  private srcVisible(view: WorldView, id: number): boolean {
    const e = view.entity(id);
    return !!e && this.host.entityVisible(e);
  }

  /** the default T4 exposure envelope (once per caster per 0.6 s) */
  private pulse(src: number, at: Vector3, radius: number, o = ULT_EXPOSURE, delay = 0): void {
    const now = this.host.now();
    if (now - (this.lastPulse.get(src) ?? -1e9) < 0.6) return;
    this.lastPulse.set(src, now + delay);
    this.vfx.exposurePulse(at, radius, { ...o, delay });
  }

  handle(events: readonly SimEvent[]): void {
    const view = this.host.view();
    if (!view) return;
    const p = this.host.palette();
    const A = this.tmpA, B = this.tmpB, C = this.tmpC;
    this.lastHit.clear();
    for (const ev of events) {
      switch (ev.e) {
        case 'cast': {
          const src = view.entity(ev.src);
          if (src) this.lastCast.set(ev.src, { x: ev.x, y: ev.y, t: this.host.now(), slot: ev.slot, ability: ev.ability });
          const info = this.abilities.get(ev.ability);
          // the ground warning starts with the wind-up (its own visibility rules: fog, per ability, per viewer)
          if (src && info?.cast && ev.castTime > 0) this.windupTelegraph(view, src, ev, info.cast, info.heal);
          if (!src || !this.host.entityVisible(src)) break;
          const tier: Tier = ev.slot === 'ult' ? 4 : info?.tier ?? 2;
          if (!this.host.bodyPos(ev.src, A)) break;
          const dir = Math.atan2(ev.y - src.y, ev.x - src.x);
          if (info?.vfx) this.fire(info.vfx, ev.src, tier, { origin: A, ground: A, dir, anchor: 'origin' });
          this.windupVfx(src, ev, info, tier, dir);
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
          this.lastHit.set(ev.dst, ev.src);
          if (!ev.vfx) break;
          const dst = view.entity(ev.dst);
          if (!dst || !this.host.entityVisible(dst)) break;
          const info = ev.ability ? this.abilities.get(ev.ability) : undefined;
          this.host.bodyPos(ev.dst, B);
          if (!this.host.bodyPos(ev.src, A)) A.copy(B);
          this.fire(ev.vfx, ev.src, info?.tier ?? 2, { origin: A, target: B, ground: B, targetId: ev.dst, anchor: 'target', dir: Math.atan2(B.z - A.z, B.x - A.x) });
          // a targeted ultimate's first hit carries the impact envelope
          if ((info?.tier ?? 0) >= 4 && !this.vfx.def(ev.vfx)?.hasExposure) this.pulse(ev.src, C.set(B.x, 0.5, B.z), 1.8);
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
          this.lastHit.set(ev.dst, ev.src);
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
          // telegraph (visibility rules from Present.telegraph); a wind-up warning of this cast takes the exact landing
          const tg = ev.telegraph;
          const rel = p.relation(team, owner, src?.kind === 'fighter');
          const allowed = tg === 'everyone' || (tg === 'ally_only' && (rel === 'ally' || rel === 'self' || p.viewer.team < 0));
          const now = this.host.now();
          const pending = this.telegraphs.find((t) => t.stage !== undefined && t.src === ev.src && t.ability === ev.ability);
          if (pending) {
            pending.stage = undefined; pending.follow = undefined;
            if (ev.shape) { pending.x = ev.x; pending.y = ev.y; pending.dir = areaDir; pending.shape = ev.shape; }
            pending.land = Math.max(pending.start, now + Math.max(0, ev.delay));
            pending.end = pending.land + 0.15;
          } else if (seen && allowed && ev.shape) {
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
          const spawn = (): void => { this.fire(id, ev.src, tier, { origin: A.clone(), ground: C.clone(), scale: R, dir: areaDir, anchor: 'ground' }); };
          if (ev.delay > 0) this.delayed.push({ at: this.host.now() + ev.delay, run: spawn }); else spawn();
          // the ultimate impact envelope at the landing (the def may carry its own)
          if (tier >= 4 && !this.vfx.def(id)?.hasExposure) this.pulse(ev.src, C.clone().setY(0.4), Math.max(1.5, R), ULT_EXPOSURE, Math.max(0, ev.delay));
          break;
        }
        case 'dash': {
          const src = view.entity(ev.src);
          this.dashTelegraph(view, ev);
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
          // the look itself is sustained from EntityView.statuses (update); here: who applied it (tethers)
          const by = this.lastHit.get(ev.dst);
          if (by !== undefined && by !== ev.dst) this.statusSrc.set(statusKey(ev.dst, ev.status), by);
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
            if (this.eventVfx.structureFall) this.fire(this.eventVfx.structureFall, ev.dst, 4, { origin: B.setY(0.5), ground: B, scale: 1.5, anchor: 'origin', world: true });
            this.host.shake(4, 120);
            this.pulse(ev.dst, C.set(B.x, 0.5, B.z), 4, FALL_EXPOSURE);
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

  // ── wind-up: the ground warning (M1) ───────────────────────────────────────────────────────────
  private windupTelegraph(view: WorldView, src: EntityView, ev: Extract<SimEvent, { e: 'cast' }>, c: CastTele, heal: boolean): void {
    const p = this.host.palette();
    const rel = p.relation(src.team, src.owner, src.kind === 'fighter');
    if (c.vis === 'ally_only' && !(rel === 'ally' || rel === 'self' || p.viewer.team < 0)) return;
    const dx = ev.x - src.x, dy = ev.y - src.y, len = Math.hypot(dx, dy);
    const dir = len > 1e-3 ? Math.atan2(dy, dx) : src.facing;
    let x = ev.x, y = ev.y, travel = 0;
    let shape = c.shape;
    if (c.dash) {
      const d = c.dash.toPoint ? Math.min(c.dash.distance, len) : c.dash.distance;
      travel = d / c.dash.speed;
      if (c.anchor === 'land') { x = src.x + Math.cos(dir) * d; y = src.y + Math.sin(dir) * d; }
      else if (shape.kind === 'rect') shape = { ...shape, length: Math.max(0.5, d) };
    }
    if (c.anchor === 'caster' || c.anchor === 'aim') { x = src.x; y = src.y; }
    if (!(this.host.entityVisible(src) || this.host.visibleAt(x, y))) return;
    // one wind-up warning per caster
    for (let i = this.telegraphs.length - 1; i >= 0; i--) if (this.telegraphs[i].stage === 'windup' && this.telegraphs[i].src === src.id) this.telegraphs.splice(i, 1);
    const now = this.host.now();
    const land = now + ev.castTime + c.delay + travel;
    this.telegraphs.push({
      x, y, dir, shape, start: now, land, end: land + 0.15, src: src.id, team: src.team, owner: src.owner, zone: -1, heal,
      stage: 'windup', ability: ev.ability, castEnd: ev.t + ev.castTime, follow: c.anchor === 'caster' ? 'caster' : c.anchor === 'aim' ? 'aim' : undefined,
      aimX: ev.x, aimY: ev.y,
    });
  }

  /** a dash's release: the wind-up warning takes the exact path / landing; untelegraphed casts show their path */
  private dashTelegraph(view: WorldView, ev: Extract<SimEvent, { e: 'dash' }>): void {
    const now = this.host.now();
    const t = this.telegraphs.find((x) => x.stage === 'windup' && x.src === ev.src && view.time >= (x.castEnd ?? 0) - TICK_DT * 1.5);
    const dist = Math.hypot(ev.toX - ev.fromX, ev.toY - ev.fromY);
    const dir = dist > 1e-3 ? Math.atan2(ev.toY - ev.fromY, ev.toX - ev.fromX) : 0;
    if (t) {
      const c = t.ability ? this.abilities.get(t.ability)?.cast : null;
      t.stage = 'travel'; t.follow = undefined;
      if (c?.anchor === 'land') { t.x = ev.toX; t.y = ev.toY; t.land = Math.max(t.start, now + ev.duration + c.delay); }
      else { t.x = ev.fromX; t.y = ev.fromY; t.dir = dir; if (t.shape.kind === 'rect') t.shape = { ...t.shape, length: Math.max(0.5, dist) }; t.land = Math.max(t.start, now + ev.duration); }
      t.end = t.land + 0.15;
      return;
    }
    // an instant dash of a telegraph:everyone ability shows its path while it flies (no displacements:
    // those carry no cast of their own this tick)
    const lc = this.lastCast.get(ev.src);
    if (!lc || now - lc.t > 0.08 || dist < 0.5) return;
    const info = this.abilities.get(lc.ability);
    if (info?.telegraph !== 'everyone') return;
    const src = view.entity(ev.src);
    if (!src || !(this.host.entityVisible(src) || this.host.visibleAt(ev.toX, ev.toY))) return;
    this.telegraphs.push({
      x: ev.fromX, y: ev.fromY, dir, shape: { kind: 'rect', length: dist, width: Math.max(0.8, src.radius * 2) }, start: now, land: now + ev.duration,
      end: now + ev.duration + 0.15, src: ev.src, team: src.team, owner: src.owner, zone: -1, heal: false,
    });
  }

  // ── wind-up: the caster's anticipation (M3) ────────────────────────────────────────────────────
  private windupVfx(src: EntityView, ev: Extract<SimEvent, { e: 'cast' }>, info: AbilityInfo | undefined, tier: Tier, dir: number): void {
    const A = this.tmpA;
    const ct = ev.castTime;
    const fighter = src.kind === 'fighter';
    const castEnd = ev.t + ct;
    const sustain = (): boolean => this.casting(ev.src, castEnd);
    const play = (id: string | undefined, phase: 'main' | 'windup', fit: boolean, t: Tier): void => {
      const def = id ? this.vfx.def(id) : undefined;
      if (!id || !def) return;
      const h = this.fire(id, ev.src, t, { origin: A, ground: A, dir, anchor: 'origin', phase, sustain, timeScale: fit ? def.duration / Math.max(0.05, ct) : 1 });
      if (h > 0) this.windups.push({ h, src: ev.src, castEnd });
    };
    if (ct >= WINDUP_MIN) {
      if (info?.windupVfx) play(info.windupVfx, 'main', true, tier);
      else if (info?.vfx && this.vfx.def(info.vfx)?.hasWindup) play(info.vfx, 'windup', false, tier);
      else if (fighter) play(ev.slot === 'ult' ? this.eventVfx.ultCharge : this.eventVfx.windup, 'main', true, tier);
      if (ev.slot === 'ult') play(this.eventVfx.ultWindup, 'main', true, 4);
    } else if (fighter && this.eventVfx.castFlash) {
      // instant casts: a short socket flare (it cannot precede an instant release; it marks it)
      this.fire(this.eventVfx.castFlash, ev.src, tier, { origin: A, ground: A, dir, anchor: 'origin' });
    }
  }

  /** is this caster still in the wind-up that ends at castEnd (sim time)? */
  private casting(id: number, castEnd: number): boolean {
    const v = this.host.view();
    const e = v?.entity(id);
    if (!v || !e || !e.alive) return false;
    return v.time < castEnd - 1e-4 && (e.state === 'cast' || e.state === 'channel');
  }

  // ── statuses (M2) ──────────────────────────────────────────────────────────────────────────────
  private statusLive(id: number, kind: StatusKindT): boolean {
    const e = this.host.view()?.entity(id);
    if (!e || !e.alive || !this.host.entityVisible(e)) return false;
    for (const s of e.statuses) if (s.kind === kind && s.remaining > 0) return true;
    return false;
  }

  private syncStatuses(view: WorldView): void {
    for (const [k, h] of this.statusFx) if (!this.vfx.isHeld(h)) { this.statusFx.delete(k); this.statusSrc.delete(k); }
    const B = this.tmpB;
    for (const e of view.entities) {
      if (!e.statuses.length || !e.alive) continue;
      if (e.kind === 'projectile' || e.kind === 'zone' || e.kind === 'ward' || e.kind === 'pickup') continue;
      let visible: boolean | null = null;
      for (const s of e.statuses) {
        if (!(s.remaining > 0)) continue;
        const id = this.statusVfx[s.kind];
        if (!id) continue;
        const key = statusKey(e.id, s.kind);
        if (this.statusFx.has(key)) continue;
        if (visible === null) visible = this.host.entityVisible(e);
        if (!visible) break;
        if (!this.host.bodyPos(e.id, B)) break;
        const kind = s.kind;
        const by = this.statusSrc.get(key);
        const { c } = this.colorFor(e, e.team, e.owner);
        // the victim's look: its relationship colour, full opacity (it is the victim's state, not an ally's ability)
        const h = this.vfx.spawnHandle(id, {
          tier: STATUS_TIER[kind] ?? 2, team: c, element: null, ally: false,
          origin: B, target: B, ground: this.tmpC.set(B.x, 0, B.z), targetId: e.id, sourceId: by ?? -1, anchor: 'target', dir: e.facing,
          sustain: () => this.statusLive(e.id, kind),
        });
        if (h > 0) this.statusFx.set(key, h);
      }
    }
  }

  // ── per frame ──────────────────────────────────────────────────────────────────────────────────
  private readonly delayed: { at: number; run: () => void }[] = [];

  /** an area event that is the spawn of a zone entity (same vfx, same spot) loops from the zone */
  private matchZone(view: WorldView, ev: Extract<SimEvent, { e: 'area' }>): number {
    for (const e of view.entities) {
      if (e.kind !== 'zone' || this.zonesSeen.has(e.id)) continue;
      if (e.vfx === ev.vfx && Math.abs(e.x - ev.x) < 0.2 && Math.abs(e.y - ev.y) < 0.2) return e.id;
    }
    return -1;
  }

  /** zones: persistent telegraphs + looping VFX while they exist; delayed landings; wind-ups; statuses */
  update(view: WorldView | null): void {
    const now = this.host.now();
    for (let i = this.delayed.length - 1; i >= 0; i--) if (now >= this.delayed[i].at) { const d = this.delayed[i]; this.delayed.splice(i, 1); d.run(); }
    // expire telegraphs; wind-up warnings follow their caster, vanish with a cancelled or fizzled cast
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      if (t.zone >= 0) { const z = view?.entity(t.zone); if (!z) this.telegraphs.splice(i, 1); else { t.x = z.x; t.y = z.y; } continue; }
      if (t.stage === 'windup' && view) {
        const s = view.entity(t.src);
        const end = t.castEnd ?? 0;
        const live = !!s && s.alive && (s.state === 'cast' || s.state === 'channel');
        const cancelled = !s || !s.alive || (view.time < end - TICK_DT * 0.5 && !live);
        const unmatched = view.time > end + 0.2 && !(s && s.state === 'channel');
        if (cancelled || unmatched) { this.telegraphs.splice(i, 1); continue; }
        if (t.follow && s && view.time < end) {
          t.x = s.x; t.y = s.y;
          if (t.follow === 'aim' && t.aimX !== undefined && t.aimY !== undefined && Math.hypot(t.aimX - s.x, t.aimY - s.y) > 0.05) t.dir = Math.atan2(t.aimY - s.y, t.aimX - s.x);
        }
        // a channel keeps its warning on until the channel resolves
        if (s && s.state === 'channel' && now > t.end - 0.15) { t.land = now; t.end = now + 0.15; }
      } else if (t.stage === 'travel' && now > t.end) { this.telegraphs.splice(i, 1); continue; }
      if (now > t.end) this.telegraphs.splice(i, 1);
    }
    // wind-up anticipation: a cancelled cast fades at once
    for (let i = this.windups.length - 1; i >= 0; i--) {
      const w = this.windups[i];
      if (!this.vfx.isAlive(w.h)) { this.windups.splice(i, 1); continue; }
      if (!this.vfx.isHeld(w.h) || !view) continue;
      const s = view.entity(w.src);
      if (!s || !s.alive || (view.time < w.castEnd - TICK_DT * 0.5 && s.state !== 'cast' && s.state !== 'channel')) this.vfx.release(w.h, true);
    }
    if (!view) return;
    const p = this.host.palette();
    // the local player's death grade (a Fray elimination is not a wait: no grade while spectating)
    const me = p.viewer.you >= 0 ? view.players.find((x) => x.player === p.viewer.you) : undefined;
    const meE = me ? view.entity(me.entity) : undefined;
    screenFx.setDead(!!me && view.phase !== 'ended' && me.respawnIn > 0 && (!meE || !meE.alive));
    this.syncStatuses(view);
    for (const e of view.entities) {
      if (e.kind !== 'zone' || this.zonesSeen.has(e.id)) continue;
      this.zonesSeen.add(e.id);
      const src = this.findOwnerEntity(view, e);
      const seen = this.host.visibleAt(e.x, e.y) || this.host.entityVisible(e);
      if (!seen) continue;
      if (e.shape) {
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

  clear(): void {
    this.telegraphs.length = 0; this.lastCast.clear(); this.delayed.length = 0; this.zonesSeen.clear();
    this.windups.length = 0; this.statusFx.clear(); this.statusSrc.clear(); this.lastHit.clear(); this.lastPulse.clear();
    screenFx.reset();
  }
}

export type { ShapeT };
