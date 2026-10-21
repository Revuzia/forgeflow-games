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
//   wind-up    a cast with castTime > 0 shows its ground warnings from the FIRST frame of the wind-up (when
//              the ability is telegraph:everyone or holds a delayed area): one per area / zone an enemy must
//              read (it hurts or controls them, or its own Present.telegraph is everyone; an area marked
//              'none', like a helper displacement field, never warns), each with its own visibility per
//              viewer. Targeting point / direction / self / none (on the caster) / unit (a lunge's landing
//              area sits on the target and tracks it). A shape lands at castTime + area delay (a repeat's
//              first strike; + dash travel for a dash that lands an area); the area event carrying exactly
//              that shape (or the dash event) takes it over instead of stacking a second one, a cancelled or
//              fizzled cast removes it. Dashes show their path. A zone's outline continues its warning and
//              follows the zone's own Present.telegraph per viewer.
//              The caster's anticipation VFX plays over the same wind-up: Present.windupVfx (a def whose
//              clock is fitted to castTime), else the cast def's phase:'windup' layers, else the generic
//              client.vfxEvents.windup (ultCharge for ultimates, which also play ultWindup); casts under
//              0.12 s get castFlash. It is
//              sustained while the wind-up runs and cancelled with it. The sim releases a cast on the tick
//              its accumulated wind-up reaches castTime (the issuing tick counts), i.e. at ev.t + (⌈castTime /
//              tick⌉ − 1) ticks: only a caster that leaves 'cast' BEFORE that tick was cancelled (stun, death);
//              a normal release plays the def's release layers.
//   attacks    a basic attack's wind-up (`attack` event) plays the attacker's attack.present.windupVfx fitted
//              to the wind-up: a melee slash (a synthesized arc swept round the fighter over the blow, from
//              78 % of the wind-up to just after the impact; twice as wide at T2 on a crit), a ranged draw
//              glint; cancelled with the attack.
//   status     every status kind with a client.vfxStatus look is shown for its WHOLE duration: one
//              sustained instance per (unit, kind), released when the kind leaves EntityView.statuses
//              (or the unit dies / leaves vision). Taunt tethers to the taunter (the unit that hit it), in
//              the TAUNTER's relationship colour ("element" on a status look). Structures and permanent
//              (non-finite) statuses get no look: a protected needle's standing untargetable is its rule,
//              not an event, and it would hold VFX pool slots for the whole match.
//   colour     "signature" / "secondary" resolve to the caster fighter's FighterDef.vfx (r12 M12), a zone's loop to
//              its owner's; non-fighters (and status looks: the victim's state) fall back to the relationship colour.
//   exposure   ultimate impacts (T4 area landings, the first T4 hit, a T4 zone opening) start the default
//              exposure envelope (vfx/screen.ts; display ratios) unless their def carries its own feel.exposure.
//              Structure falls a softer one.
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

/** one ground warning an ability shows from its wind-up (built once from the record; an ability may show several) */
interface CastTele {
  shape: ViewShape;
  /** point: the cast point · caster: on the caster · aim: from the caster along the aim · land: a dash's landing ·
   *  target: on the targeted unit (a lunge's landing area), tracking it */
  anchor: 'point' | 'caster' | 'aim' | 'land' | 'target';
  /** seconds after release before it lands (the area's delay; the first strike of a `repeat`) */
  delay: number;
  dash: { toPoint: boolean; toTarget: boolean; distance: number; speed: number } | null;
  vis: 'everyone' | 'ally_only';
  /** the area's own shape: the area event that takes this warning over carries exactly this shape */
  match: ViewShape | null;
}

/** a live wind-up anticipation (cast or basic attack) */
interface Windup { h: number; src: number; castEnd: number; rel: number; attack: boolean }

/** sim time of the release tick of a wind-up that started at `t` (the cast system counts the issuing tick) */
const castReleaseAt = (t: number, castTime: number): number => t + Math.max(0, Math.ceil(castTime / TICK_DT - 1e-6) - 1) * TICK_DT;
/** a basic attack releases once its wind-up has fully elapsed, counted from the next tick */
const attackReleaseAt = (t: number, windup: number): number => t + Math.max(1, Math.ceil(windup / TICK_DT - 1e-6)) * TICK_DT;

interface AbilityInfo {
  vfx?: string; hitVfx?: string; windupVfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone'; tier: Tier; heal: boolean;
  /** the wind-up ground warnings (empty: none) */
  cast: CastTele[];
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
  /** sim time the wind-up nominally ends (ev.t + castTime) and the sim's release tick */
  castEnd?: number;
  castRel?: number;
  /** caster-anchored wind-ups track the caster until release; target-anchored ones track the target until they land */
  follow?: 'caster' | 'aim' | 'target';
  /** the tracked target unit (follow 'target') */
  followId?: number;
  /** the cast point (aim direction while following) */
  aimX?: number; aimY?: number;
  /** the wind-up warning this telegraph shows (which area event takes it over) */
  tele?: CastTele;
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
/** display brightness ratios (vfx/screen.ts): one beat at ×2.4 (the LoL gauge's 2.3–2.5 on screen), ×1.45 held */
const ULT_EXPOSURE = { peak: 2.4, hold: 0.28, fade: 0.12, dip: 0.92, desat: 0.35 };
const FALL_EXPOSURE = { peak: 1.7, hold: 0.2, fade: 0.14, dip: 0.95, desat: 0.2 };
/** the envelope's radius cap (m): its lift falls off between 0.55 and 1.35 × the radius (vfx/screen.ts) */
const PULSE_MAX_R = 3.5;

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
  onArrive?: Eff[]; effects?: Eff[]; present?: { telegraph?: 'none' | 'ally_only' | 'everyone' }; filter?: { enemies?: boolean } };

/** does an area / zone reach enemies with something that hurts or controls? (the shape worth warning about) */
const harmsEnemies = (e: Eff): boolean => e.filter?.enemies !== false && HARM_OPS.test(JSON.stringify(e));
type AbilityRec = { id: string; castTime?: number; targeting?: { kind?: string; indicator?: ShapeT }; effects?: unknown[];
  present?: { vfx?: string; hitVfx?: string; windupVfx?: string; telegraph?: 'none' | 'ally_only' | 'everyone' } };

const sameShape = (a: ViewShape | null | undefined, b: ViewShape | null | undefined, tol = 1e-3): boolean => {
  if (!a || !b || a.kind !== b.kind) return false;
  const d = (x?: number, y?: number): boolean => Math.abs((x ?? 0) - (y ?? 0)) <= tol * Math.max(1, Math.abs(x ?? 0));
  return d(a.radius, b.radius) && d(a.length, b.length) && d(a.width, b.width) && d(a.inner, b.inner) && d(a.angle, b.angle);
};

/**
 * the wind-up ground warnings of an ability record (r12 M1): every area / zone the cast lands that an enemy must
 * read — a harmful one, or one whose own Present.telegraph is 'everyone' (Dunsom's pull ring marks, it does not hurt) —
 * each with its OWN visibility: an area marked telegraph 'none' (a helper displacement field) is never warned, and
 * an ally-only one only when it is delayed. Targeting point · direction · self · none (on the caster) · unit (a lunge
 * whose landing area sits on the target). A `repeat` warns its first strike (its delay counts); the later strikes
 * arrive as their own area events. A dash warns its landing area, else its path. Empty when nothing qualifies.
 */
function castTelesOf(a: AbilityRec): CastTele[] {
  const tk = a.targeting?.kind ?? 'none';
  if (tk !== 'point' && tk !== 'self' && tk !== 'direction' && tk !== 'none' && tk !== 'unit') return [];
  const top = (a.effects ?? []) as Eff[];
  // the cast's own areas (a repeat's first strike included) and its dash
  const areas: Eff[] = [];
  let dash: Eff | null = null;
  const isArea = (e: Eff): boolean => (e.op === 'area' || e.op === 'zone') && (e.at === 'point' || e.at === 'self' || (tk === 'unit' && e.at === 'target'));
  for (const e of top) {
    if (isArea(e)) areas.push(e);
    else if (e.op === 'repeat') for (const r of e.effects ?? []) { if (isArea(r)) areas.push(r); }
    else if (!dash && e.op === 'dash' && (e.mode === 'toPoint' || e.mode === 'direction' || (tk === 'unit' && e.mode === 'toTarget'))) dash = e;
  }
  const arrive: Eff[] = [];
  if (dash) for (const e of dash.onArrive ?? []) if ((e.op === 'area' || e.op === 'zone') && e.at !== 'hit' && (e.at !== 'target' || tk === 'unit')) arrive.push(e);
  const own = a.present?.telegraph;
  const visOf = (e: Eff): 'none' | 'ally_only' | 'everyone' => e.present?.telegraph ?? own ?? ((e.delay ?? 0) > 0 ? 'everyone' : 'none');
  // which areas warn: never one marked 'none'; harmful ones and explicitly announced ones; an ally-only warning only
  // when it is delayed (an instant ally ring is no threat to read ahead)
  const warns = (e: Eff, explicitOnly: boolean): boolean => {
    const v = visOf(e);
    if (v === 'none') return false;
    if (v === 'ally_only' && !((e.delay ?? 0) > 0)) return false;
    return harmsEnemies(e) || e.present?.telegraph === 'everyone' || (!explicitOnly && (e.delay ?? 0) > 0);
  };
  const ind = viewShape(a.targeting?.indicator);
  const out: CastTele[] = [];
  const dashInfo: CastTele['dash'] = dash
    ? { toPoint: dash.mode === 'toPoint', toTarget: dash.mode === 'toTarget', distance: Math.max(0, dash.distance ?? 0), speed: Math.max(0.1, dash.speed ?? 10) }
    : null;
  if (dash && dashInfo) {
    const land = arrive.filter((e) => warns(e, false));
    for (const e of land) {
      const aShape = viewShape(e.shape);
      const shape = ind && (ind.kind === 'circle' || ind.kind === 'ring') && aShape && ind.kind === aShape.kind ? ind : aShape;
      if (shape) out.push({ shape, anchor: e.at === 'target' ? 'target' : 'land', delay: Math.max(0, e.delay ?? 0), dash: dashInfo, vis: visOf(e) === 'ally_only' ? 'ally_only' : 'everyone', match: aShape });
    }
    // no landing area: the path itself (toward a point or along the aim; a lunge at a unit warns its landing only)
    if (!land.length && !dashInfo.toTarget && (own === 'everyone' || own === 'ally_only')) {
      const shape: ViewShape = ind && ind.kind === 'rect' ? ind : { kind: 'rect', length: dashInfo.distance, width: Math.max(0.6, (dash.passWidth ?? 0.5) * 2) };
      out.push({ shape, anchor: 'aim', delay: 0, dash: dashInfo, vis: own === 'ally_only' ? 'ally_only' : 'everyone', match: null });
    }
  }
  let picked = areas.filter((e) => warns(e, true));
  // nothing harmful or announced: a delayed area still warns (the bible: a delayed blow is always telegraphed)
  if (!picked.length) picked = areas.filter((e) => warns(e, false));
  for (const e of picked) {
    const aShape = viewShape(e.shape);
    // the aim indicator when it describes this area, else the area's own shape (a 10 m ally ring is not a 4 m slow)
    const same = !!ind && !!aShape && ind.kind === aShape.kind && Math.abs((ind.radius ?? ind.length ?? 0) - (aShape.radius ?? aShape.length ?? 0)) <= 0.2 * Math.max(1e-3, aShape.radius ?? aShape.length ?? 1);
    const shape = same || !aShape ? ind ?? aShape : aShape;
    if (!shape) continue;
    // a cone / rect from the caster runs along the aim; one at the cast point starts there and runs on along the aim
    const atCaster = e.at === 'self' || tk === 'self' || tk === 'none';
    const anchor: CastTele['anchor'] = e.at === 'target' ? 'target' : (shape.kind === 'cone' || shape.kind === 'rect') ? (atCaster ? 'aim' : 'point')
      : atCaster ? 'caster' : 'point';
    const delay = Math.max(0, e.delay ?? 0);
    // an area and the zone it leaves (same shape, same spot, same time) warn once
    if (out.some((o) => o.anchor === anchor && o.delay === delay && sameShape(o.shape, shape))) continue;
    out.push({ shape, anchor, delay, dash: null, vis: visOf(e) === 'ally_only' ? 'ally_only' : 'everyone', match: aShape });
  }
  // an announced cast with no area of its own (a telegraph:everyone skillshot): its aim indicator
  if (!out.length && ind && own === 'everyone' && !dash && tk !== 'unit') {
    out.push({ shape: ind, anchor: ind.kind === 'cone' || ind.kind === 'rect' ? 'aim' : tk === 'self' || tk === 'none' ? 'caster' : 'point', delay: 0, dash: null, vis: 'everyone', match: null });
  }
  return out;
}

export class Director {
  private readonly abilities = new Map<string, AbilityInfo>();
  private readonly attackHit = new Map<string, { vfx?: string; hitVfx?: string; windupVfx?: string }>();
  private readonly element = new Map<string, Color>();
  /** fighter def → its VFX signature and companion (FighterDef.vfx) */
  private readonly signature = new Map<string, { sig: Color; sec: Color }>();
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
  /** zone effect id (a zone entity's def) → who sees its outline (its own Present.telegraph, else the ability's) */
  private readonly zoneTele = new Map<string, 'none' | 'ally_only' | 'everyone'>();

  constructor(catalog: CatalogT, vfx: VfxSystem, host: DirectorHost) {
    this.vfx = vfx;
    this.host = host;
    const add = (a: AbilityRec, tier: Tier): void => {
      if (this.abilities.has(a.id)) return;
      const heal = Array.isArray(a.effects) && a.effects.some((e) => HEALING_OPS.has((e as { op?: string }).op ?? '')) && !a.effects.some((e) => (e as { op?: string }).op === 'damage');
      const cast = (a.castTime ?? 0) > 0 && Array.isArray(a.effects) && (HARM_OPS.test(JSON.stringify(a.effects)) || a.present?.telegraph === 'everyone') ? castTelesOf(a) : [];
      this.abilities.set(a.id, { vfx: a.present?.vfx, hitVfx: a.present?.hitVfx, windupVfx: a.present?.windupVfx, telegraph: a.present?.telegraph, tier, heal, cast });
      this.collectZones(a.effects as Eff[] | undefined, a.present?.telegraph);
    };
    for (const f of catalog.fighters) {
      this.element.set(f.id, new Color().setStyle(f.palette.primary));
      if (f.vfx) this.signature.set(f.id, { sig: new Color().setStyle(f.vfx.signature), sec: new Color().setStyle(f.vfx.secondary) });
      this.attackHit.set(f.id, { vfx: f.attack.present?.vfx, hitVfx: f.attack.present?.hitVfx, windupVfx: f.attack.present?.windupVfx });
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
      this.attackHit.set(u.id, { vfx: u.attack?.present?.vfx, hitVfx: u.attack?.present?.hitVfx, windupVfx: u.attack?.present?.windupVfx });
      for (const a of u.abilities) add(a as AbilityRec, u.kind === 'monster' ? 3 : 2);
    }
  }

  /** every zone an ability can open (nested effects included) → its outline visibility */
  private collectZones(effs: Eff[] | undefined, own: 'none' | 'ally_only' | 'everyone' | undefined): void {
    if (!Array.isArray(effs)) return;
    for (const e of effs) {
      if (!e || typeof e !== 'object') continue;
      const z = e as Eff & { id?: string };
      if (z.op === 'zone' && z.id && !this.zoneTele.has(z.id)) this.zoneTele.set(z.id, z.present?.telegraph ?? own ?? (harmsEnemies(z) ? 'everyone' : 'ally_only'));
      for (const v of Object.values(e)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') this.collectZones(v as Eff[], own);
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

  /** the caster's signature pair (fighters only; skins never change it) */
  private signatureOf(e: EntityView | undefined): { sig: Color; sec: Color } | null {
    return e && e.kind === 'fighter' ? this.signature.get(e.def) ?? null : null;
  }

  /** spawn a def anchored on/around a source entity; returns the VFX handle (0 = nothing spawned) */
  private fire(id: string | undefined, srcId: number, tier: Tier, o: { origin?: Vector3 | null; target?: Vector3 | null; ground?: Vector3 | null; scale?: number; dir?: number; follow?: number; followFor?: number; targetId?: number; anchor?: 'origin' | 'target' | 'path' | 'ground'; loopWhile?: number; sustain?: () => boolean; timeScale?: number; phase?: 'main' | 'windup'; world?: boolean }): number {
    if (!id || !this.vfx.has(id)) return 0;
    const view = this.host.view();
    const src = view?.entity(srcId);
    const team = src ? src.team : -1, owner = src ? src.owner : -1;
    const { c, rel } = this.colorFor(src, team, owner);
    const sg = this.signatureOf(src);
    return this.vfx.spawnHandle(id, {
      tier, team: c, element: this.elementOf(src), signature: sg?.sig ?? null, secondary: sg?.sec ?? null,
      ally: rel === 'ally', ownT1: rel === 'self' && tier <= 1,
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
          if (src && info && info.cast.length && ev.castTime > 0) this.windupTelegraph(view, src, ev, info.cast, info.heal);
          if (!src || !this.host.entityVisible(src)) break;
          const tier: Tier = ev.slot === 'ult' ? 4 : info?.tier ?? 2;
          if (!this.host.bodyPos(ev.src, A)) break;
          const dir = Math.atan2(ev.y - src.y, ev.x - src.x);
          if (info?.vfx) this.fire(info.vfx, ev.src, tier, { origin: A, ground: A, dir, anchor: 'origin' });
          this.windupVfx(src, ev, info, tier, dir);
          break;
        }
        case 'attack': {
          // the basic attack's wind-up: a melee swing trail / a ranged draw glint, fitted to the wind-up
          const src = view.entity(ev.src);
          if (!src || !this.host.entityVisible(src)) break;
          const id = this.attackHit.get(src.def)?.windupVfx;
          const def = id ? this.vfx.def(id) : undefined;
          if (!id || !def || !this.host.bodyPos(ev.src, A)) break;
          const dst = view.entity(ev.dst);
          const dir = dst ? Math.atan2(dst.y - src.y, dst.x - src.x) : src.facing;
          // fitted so `duration` = the wind-up as the sim plays it (the impact lands on its release tick)
          const rel = attackReleaseAt(ev.t, ev.windup);
          const h = this.fire(id, ev.src, ev.crit ? 2 : 1, {
            origin: A, ground: A, dir, anchor: 'origin', targetId: ev.dst, scale: ev.crit ? 2 : 1,
            timeScale: def.duration / Math.max(0.05, rel - ev.t),
          });
          if (h > 0) this.windups.push({ h, src: ev.src, castEnd: ev.t + ev.windup, rel, attack: true });
          break;
        }
        case 'projectile': {
          const src = view.entity(ev.src);
          const pe = view.entity(ev.id);
          const visible = (src && this.host.entityVisible(src)) || (pe && this.host.entityVisible(pe));
          if (!visible) break;
          // basic attacks T1; a structure's shot is T3 (the bible: it is the deadliest attack on the map, and its
          // heat ramp may distort)
          const tier: Tier = ev.ability === 'attack' ? (src?.kind === 'structure' ? 3 : 1) : (this.abilities.get(ev.ability)?.tier ?? 2);
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
          if ((info?.tier ?? 0) >= 4 && !this.vfx.def(ev.vfx)?.hasExposure) this.queuePulse(ev.src, C.set(B.x, 0.5, B.z), 1.8, 0, false);
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
          // a cone / rect away from the caster: toward the cast point when it sits elsewhere, onward along the aim when it
          // sits ON the cast point (the sim orients it by the cast direction)
          const away = !!src && Math.hypot(ev.x - src.x, ev.y - src.y) > 0.3 && !!ev.shape && (ev.shape.kind === 'cone' || ev.shape.kind === 'rect');
          const areaDir = !away || !src ? dir
            : lc && Math.hypot(lc.x - ev.x, lc.y - ev.y) > 0.05 ? Math.atan2(lc.y - ev.y, lc.x - ev.x) : Math.atan2(ev.y - src.y, ev.x - src.x);
          // telegraph (visibility rules from Present.telegraph); a wind-up warning of this cast takes the exact landing
          const tg = ev.telegraph;
          const rel = p.relation(team, owner, src?.kind === 'fighter');
          const allowed = tg === 'everyone' || (tg === 'ally_only' && (rel === 'ally' || rel === 'self' || p.viewer.team < 0));
          const now = this.host.now();
          // only an area this viewer may see takes the warning over (an ally-only shield ring never replaces the enemy's slow
          // warning), and only the warning of THIS area: a cast may warn several (Dunsom's pull ring and the eruption)
          const pending = allowed ? this.telegraphs.find((t) => t.stage !== undefined && t.src === ev.src && t.ability === ev.ability
            && (!t.tele?.match || sameShape(t.tele.match, ev.shape))) : undefined;
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
          const R = ev.shape ? (ev.shape.radius ?? (ev.shape.length ?? 2) * 0.5) : 1;
          const tier: Tier = (info?.tier ?? 2) >= 4 ? 4 : ev.delay > 0 || tg === 'everyone' ? 3 : (info?.tier ?? 2);
          const zone = this.matchZone(view, ev);
          if (zone >= 0) {
            // an ultimate that lands as a zone (Ardit's muster: no area or hit carries its impact) takes the T4 envelope
            // when the zone opens
            if (tier >= 4 && !this.vfx.def(ev.vfx)?.hasExposure) this.queuePulse(ev.src, C.set(ev.x, 0.4, ev.y), Math.max(1.5, R), Math.max(0, ev.delay), true);
            break;
          }
          C.set(ev.x, 0, ev.y);
          if (ev.shape?.kind === 'rect' && ev.shape.length) C.set(ev.x + Math.cos(areaDir) * ev.shape.length * 0.5, 0, ev.y + Math.sin(areaDir) * ev.shape.length * 0.5);
          if (!this.host.bodyPos(ev.src, A)) A.copy(C);
          const id = ev.vfx;
          const spawn = (): void => { this.fire(id, ev.src, tier, { origin: A.clone(), ground: C.clone(), scale: R, dir: areaDir, anchor: 'ground' }); };
          if (ev.delay > 0) this.delayed.push({ at: this.host.now() + ev.delay, run: spawn }); else spawn();
          // the ultimate impact envelope at the landing (the def may carry its own)
          if (tier >= 4 && !this.vfx.def(id)?.hasExposure) this.queuePulse(ev.src, C.clone().setY(0.4), Math.max(1.5, R), Math.max(0, ev.delay), true);
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
    // the T4 envelope of this batch, one per caster: an area landing beats a hit, the LAST landing beats an earlier one
    // (Dunsom's eruption 0.6 s after release is the impact, not the pull ring that opens it)
    // the lit area is the impact, never the whole fight: a 7 m ultimate lifts its central ~2 m, fading out by ~4.7 m
    for (const q of this.pulseQ.values()) this.pulse(q.src, q.at, Math.min(PULSE_MAX_R, q.radius), ULT_EXPOSURE, q.delay);
    this.pulseQ.clear();
  }

  private readonly pulseQ = new Map<number, { src: number; at: Vector3; radius: number; delay: number; area: boolean }>();
  private queuePulse(src: number, at: Vector3, radius: number, delay: number, area: boolean): void {
    const q = this.pulseQ.get(src);
    if (q && (q.area && !area || (q.area === area && q.delay >= delay))) return;
    this.pulseQ.set(src, { src, at: at.clone(), radius, delay, area });
  }

  // ── wind-up: the ground warning (M1) ───────────────────────────────────────────────────────────
  private windupTelegraph(view: WorldView, src: EntityView, ev: Extract<SimEvent, { e: 'cast' }>, list: readonly CastTele[], heal: boolean): void {
    const p = this.host.palette();
    const rel = p.relation(src.team, src.owner, src.kind === 'fighter');
    const friend = rel === 'ally' || rel === 'self' || p.viewer.team < 0;
    // one wind-up (its warnings) per caster
    for (let i = this.telegraphs.length - 1; i >= 0; i--) if (this.telegraphs[i].stage === 'windup' && this.telegraphs[i].src === src.id) this.telegraphs.splice(i, 1);
    const dx = ev.x - src.x, dy = ev.y - src.y, len = Math.hypot(dx, dy);
    const tgt = ev.target !== undefined && ev.target >= 0 ? view.entity(ev.target) : undefined;
    const now = this.host.now();
    for (const c of list) {
      if (c.vis === 'ally_only' && !friend) continue;
      let dir = len > 1e-3 ? Math.atan2(dy, dx) : src.facing;
      let x = ev.x, y = ev.y, travel = 0;
      let shape = c.shape;
      if (c.anchor === 'target') {
        // a lunge at a unit: the landing area sits on the target and tracks it until it lands
        if (!tgt) continue;
        x = tgt.x; y = tgt.y;
        const d = Math.hypot(tgt.x - src.x, tgt.y - src.y);
        if (d > 1e-3) dir = Math.atan2(tgt.y - src.y, tgt.x - src.x);
        if (c.dash) travel = Math.min(c.dash.distance > 0 ? c.dash.distance : d, Math.max(0, d - src.radius - tgt.radius)) / c.dash.speed;
      } else if (c.dash) {
        const d = c.dash.toPoint ? Math.min(c.dash.distance, len) : c.dash.distance;
        travel = d / c.dash.speed;
        if (c.anchor === 'land') { x = src.x + Math.cos(dir) * d; y = src.y + Math.sin(dir) * d; }
        else if (shape.kind === 'rect') shape = { ...shape, length: Math.max(0.5, d) };
      }
      if (c.anchor === 'caster' || c.anchor === 'aim') { x = src.x; y = src.y; }
      if (!(this.host.entityVisible(src) || this.host.visibleAt(x, y))) continue;
      const land = now + ev.castTime + c.delay + travel;
      this.telegraphs.push({
        x, y, dir, shape, start: now, land, end: land + 0.15, src: src.id, team: src.team, owner: src.owner, zone: -1, heal,
        stage: 'windup', ability: ev.ability, castEnd: ev.t + ev.castTime, castRel: castReleaseAt(ev.t, ev.castTime),
        follow: c.anchor === 'caster' ? 'caster' : c.anchor === 'aim' ? 'aim' : c.anchor === 'target' ? 'target' : undefined,
        followId: c.anchor === 'target' ? tgt?.id : undefined, aimX: ev.x, aimY: ev.y, tele: c,
      });
    }
  }

  /** a dash's release: the wind-up warnings take the exact path / landing; untelegraphed casts show their path */
  private dashTelegraph(view: WorldView, ev: Extract<SimEvent, { e: 'dash' }>): void {
    const now = this.host.now();
    const dist = Math.hypot(ev.toX - ev.fromX, ev.toY - ev.fromY);
    const dir = dist > 1e-3 ? Math.atan2(ev.toY - ev.fromY, ev.toX - ev.fromX) : 0;
    let took = false;
    for (const t of this.telegraphs) {
      if (t.stage !== 'windup' || t.src !== ev.src || view.time < (t.castEnd ?? 0) - TICK_DT * 1.5) continue;
      const c = t.tele;
      if (!c?.dash) continue;
      took = true;
      t.stage = 'travel';
      if (c.anchor === 'target') { t.land = Math.max(t.start, now + ev.duration + c.delay); }   // still tracks the target
      else if (c.anchor === 'land') { t.follow = undefined; t.x = ev.toX; t.y = ev.toY; t.land = Math.max(t.start, now + ev.duration + c.delay); }
      else { t.follow = undefined; t.x = ev.fromX; t.y = ev.fromY; t.dir = dir; if (t.shape.kind === 'rect') t.shape = { ...t.shape, length: Math.max(0.5, dist) }; t.land = Math.max(t.start, now + ev.duration); }
      t.end = t.land + 0.15;
    }
    if (took) return;
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
    const rel = castReleaseAt(ev.t, ct);
    const sustain = (): boolean => this.casting(ev.src, rel);
    const play = (id: string | undefined, phase: 'main' | 'windup', fit: boolean, t: Tier): void => {
      const def = id ? this.vfx.def(id) : undefined;
      if (!id || !def) return;
      // fitted to the time the wind-up really lasts on screen (the sim's release tick)
      const h = this.fire(id, ev.src, t, { origin: A, ground: A, dir, anchor: 'origin', phase, sustain, targetId: ev.target,
        timeScale: fit ? def.duration / Math.max(0.05, rel - ev.t) : 1 });
      if (h > 0) this.windups.push({ h, src: ev.src, castEnd, rel, attack: false });
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

  /** is this caster still in the wind-up whose release tick is `rel` (sim time)? */
  private casting(id: number, rel: number): boolean {
    const v = this.host.view();
    const e = v?.entity(id);
    if (!v || !e || !e.alive) return false;
    return v.time < rel - TICK_DT * 0.5 && (e.state === 'cast' || e.state === 'channel');
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
    // who-applied entries for statuses that never got a look (fogged, dead, structures) are dropped once the
    // status is gone, so the map stays bounded over a match
    if (this.statusSrc.size > this.statusFx.size + 64) {
      for (const k of this.statusSrc.keys()) {
        if (this.statusFx.has(k)) continue;
        const e = view.entity(Math.floor(k / 32));
        const kind = STATUS_ORDER[k % 32];
        if (!e || !e.alive || !e.statuses.some((s) => s.kind === kind && s.remaining > 0)) this.statusSrc.delete(k);
      }
    }
    const B = this.tmpB;
    for (const e of view.entities) {
      if (!e.statuses.length || !e.alive) continue;
      if (e.kind === 'projectile' || e.kind === 'zone' || e.kind === 'ward' || e.kind === 'pickup' || e.kind === 'structure') continue;
      let visible: boolean | null = null;
      for (const s of e.statuses) {
        // a permanent status (a rule of the unit, e.g. a protected structure) is not shown as an event
        if (!(s.remaining > 0) || !Number.isFinite(s.remaining) || !Number.isFinite(s.duration)) continue;
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
        // the applier's relationship colour ("element" on a status look: the taunt tether is the taunter's)
        const bySrc = by !== undefined ? view.entity(by) : undefined;
        const byC = bySrc ? this.colorFor(bySrc, bySrc.team, bySrc.owner).c : null;
        // the victim's look: its relationship colour, full opacity (it is the victim's state, not an ally's ability)
        const h = this.vfx.spawnHandle(id, {
          tier: STATUS_TIER[kind] ?? 2, team: c, element: byC, ally: false,
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
        // the release tick is one tick before castEnd for a whole-tick cast time (castReleaseAt)
        const cancelled = !s || !s.alive || (view.time < (t.castRel ?? end) - TICK_DT * 0.5 && !live);
        const unmatched = view.time > end + 0.2 && !(s && s.state === 'channel');
        if (cancelled || unmatched) { this.telegraphs.splice(i, 1); continue; }
        if (t.follow === 'target') this.trackTarget(view, t);
        else if (t.follow && s && view.time < end) {
          t.x = s.x; t.y = s.y;
          if (t.follow === 'aim' && t.aimX !== undefined && t.aimY !== undefined && Math.hypot(t.aimX - s.x, t.aimY - s.y) > 0.05) t.dir = Math.atan2(t.aimY - s.y, t.aimX - s.x);
        }
        // a channel keeps its warning on until the channel resolves
        if (s && s.state === 'channel' && now > t.end - 0.15) { t.land = now; t.end = now + 0.15; }
      } else if (t.stage === 'travel') {
        if (now > t.end) { this.telegraphs.splice(i, 1); continue; }
        if (t.follow === 'target' && view) this.trackTarget(view, t);
      }
      if (now > t.end) this.telegraphs.splice(i, 1);
    }
    // wind-up anticipation: a cancelled cast or attack fades at once; one that reaches its release tick plays
    // its release layers (the sustain predicate lets go there)
    for (let i = this.windups.length - 1; i >= 0; i--) {
      const w = this.windups[i];
      if (!this.vfx.isAlive(w.h)) { this.windups.splice(i, 1); continue; }
      if (!view) continue;
      if (view.time >= w.rel - TICK_DT * 0.5) { this.windups.splice(i, 1); continue; }
      const s = view.entity(w.src);
      const going = !!s && s.alive && (w.attack ? s.state === 'attack' : s.state === 'cast' || s.state === 'channel');
      if (!going) { this.vfx.release(w.h, true); this.windups.splice(i, 1); }
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
      const { c, rel } = this.colorFor(src, e.team, e.owner);
      // the zone's outline follows its own Present.telegraph per viewer (an ally-only haste field never draws as a
      // second enemy-coloured rect; 'none' draws nothing: its VFX loop is the read)
      const vis = this.zoneTele.get(e.def) ?? 'everyone';
      const friend = rel === 'ally' || rel === 'self' || p.viewer.team < 0;
      if (e.shape && (vis === 'everyone' || (vis === 'ally_only' && friend))) {
        // the landing warning of this zone (its wind-up or delayed sweep) becomes its outline: one shape, never two
        const sid = src ? src.id : -1;
        const near = (t: Telegraph): boolean => t.src === sid && sameShape(t.shape, e.shape) && Math.hypot(t.x - e.x, t.y - e.y) < 0.3;
        const warn = this.telegraphs.find((t) => t.zone < 0 && now <= t.end && near(t));
        // a twin zone opened on the same spot (Ardit's muster and its edge) shares the one outline
        const twin = !warn && this.telegraphs.some((t) => t.zone >= 0 && near(t));
        if (warn) { warn.zone = e.id; warn.end = Infinity; warn.stage = undefined; warn.follow = undefined; warn.dir = e.facing; }
        else if (!twin) this.telegraphs.push({ x: e.x, y: e.y, dir: e.facing, shape: e.shape, start: now, land: now, end: Infinity, src: sid, team: e.team, owner: e.owner, zone: e.id, heal: false });
      }
      if (e.vfx && this.vfx.has(e.vfx)) {
        const R = e.shape ? (e.shape.radius ?? (e.shape.length ?? 2) * 0.5) : Math.max(1, e.radius);
        const C = new Vector3(e.x, 0, e.y);
        // the caster's signature carries the zone (M12): resin, dome, shadow, tracks … in the fighter's own hue
        const sg = this.signatureOf(src);
        this.vfx.spawn(e.vfx, {
          tier: 3, team: c, element: this.elementOf(src), signature: sg?.sig ?? null, secondary: sg?.sec ?? null, ally: rel === 'ally',
          origin: C, ground: C, scale: R, dir: e.facing, anchor: 'ground', loopWhile: e.id, sourceId: src ? src.id : -1,
        });
      }
    }
    if (this.zonesSeen.size > 4096) {
      const alive = new Set(view.entities.filter((e) => e.kind === 'zone').map((e) => e.id));
      for (const id of this.zonesSeen) if (!alive.has(id)) this.zonesSeen.delete(id);
    }
  }

  /** a target-anchored warning sits on its (render-interpolated) target until the landing area takes it over */
  private trackTarget(view: WorldView, t: Telegraph): void {
    const g = t.followId !== undefined ? view.entity(t.followId) : undefined;
    if (!g || !g.alive) return;
    if (this.host.bodyPos(g.id, this.tmpB)) { t.x = this.tmpB.x; t.y = this.tmpB.z; } else { t.x = g.x; t.y = g.y; }
  }

  private findOwnerEntity(view: WorldView, e: EntityView): EntityView | undefined {
    if (e.owner < 0) return undefined;
    const pl = view.players.find((x) => x.player === e.owner);
    return pl ? view.entity(pl.entity) : undefined;
  }

  clear(): void {
    this.telegraphs.length = 0; this.lastCast.clear(); this.delayed.length = 0; this.zonesSeen.clear();
    this.windups.length = 0; this.statusFx.clear(); this.statusSrc.clear(); this.lastHit.clear(); this.lastPulse.clear(); this.pulseQ.clear();
    screenFx.reset();
  }
}

export type { ShapeT };
