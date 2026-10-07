// VALE UI — read-only lookups over the catalog. Content is data: the UI never names a content id; it
// finds records by the ids the session/profile hands it and decides presentation from record KINDS
// (queue.kind, mode.pick, rules.end.kind), never from ids (CONTRACT §0, §9.6).

import type {
  CatalogT, ClassDefT, ModeDefT, QueueDefT, RankTierT, ResourceDefT, RoleDefT, SkinDefT,
} from '../contracts/catalog.ts';
import type { RatingRecord } from '../contracts/session.ts';

export type FighterDefT = CatalogT['fighters'][number];
export type OfferT = CatalogT['store']['offers'][number];
export type CurrencyT = CatalogT['store']['currencies'][number];
export type ShelfT = CatalogT['store']['shelves'][number];
export type SpellT = CatalogT['setup']['spells'][number];
export type BoonT = CatalogT['setup']['boons'][number];
export type PathT = CatalogT['setup']['paths'][number];
export type ModeSlotT = CatalogT['client']['modeSlots'][number];

/** the mark a mode is drawn with (bible: modes get no colour; mark, station and motif tell them apart) */
export type ModeMark = 'roads' | 'span' | 'ring' | 'uncarved';

export class CatalogView {
  readonly c: CatalogT;
  private readonly assetFn: (ref: string) => string;
  private readonly byId = new Map<string, unknown>();

  constructor(catalog: CatalogT, assetUrl?: (ref: string) => string) {
    this.c = catalog;
    this.assetFn = assetUrl ?? ((ref) => new URL(ref, new URL('./catalog/', location.href)).href);
    const index = (kind: string, list: readonly { id: string }[]): void => { for (const r of list) this.byId.set(`${kind}:${r.id}`, r); };
    index('fighter', catalog.fighters);
    index('skin', catalog.skins);
    index('role', catalog.roles);
    index('class', catalog.classes);
    index('resource', catalog.resources);
    index('mode', catalog.modes);
    index('queue', catalog.queues);
    index('map', catalog.maps);
    index('rank', catalog.ranks);
    index('spell', catalog.setup.spells);
    index('boon', catalog.setup.boons);
    index('path', catalog.setup.paths);
    index('currency', catalog.store.currencies);
    index('item', catalog.items);
    for (const o of catalog.store.offers) this.byId.set(`offer:${o.sku}`, o);
  }

  get version(): string { return this.c.version; }
  asset(ref: string | undefined | null): string | null { return ref ? this.assetFn(ref) : null; }

  private get<T>(kind: string, id: string | undefined | null): T | undefined { return id ? this.byId.get(`${kind}:${id}`) as T | undefined : undefined; }
  fighter(id?: string | null): FighterDefT | undefined { return this.get('fighter', id); }
  skin(id?: string | null): SkinDefT | undefined { return this.get('skin', id); }
  role(id?: string | null): RoleDefT | undefined { return this.get('role', id); }
  cls(id?: string | null): ClassDefT | undefined { return this.get('class', id); }
  resource(id?: string | null): ResourceDefT | undefined { return this.get('resource', id); }
  mode(id?: string | null): ModeDefT | undefined { return this.get('mode', id); }
  queue(id?: string | null): QueueDefT | undefined { return this.get('queue', id); }
  map(id?: string | null): CatalogT['maps'][number] | undefined { return this.get('map', id); }
  spell(id?: string | null): SpellT | undefined { return this.get('spell', id); }
  boon(id?: string | null): BoonT | undefined { return this.get('boon', id); }
  path(id?: string | null): PathT | undefined { return this.get('path', id); }
  currency(id?: string | null): CurrencyT | undefined { return this.get('currency', id); }
  item(id?: string | null): CatalogT['items'][number] | undefined { return this.get('item', id); }
  offer(sku?: string | null): OfferT | undefined { return this.get('offer', sku); }

  fighters(): readonly FighterDefT[] { return this.c.fighters; }
  skinsOf(fighter: string): SkinDefT[] { return this.c.skins.filter((s) => s.fighter === fighter); }
  baseSkin(fighter: string): SkinDefT | undefined { return this.skinsOf(fighter).find((s) => s.tier === 'base') ?? this.skinsOf(fighter)[0]; }
  offerForSkin(skin: string): OfferT | undefined { return this.c.store.offers.find((o) => o.kind === 'skin' && o.ref === skin); }
  /** offers whose date window contains `now` */
  offerAvailable(o: OfferT, now = Date.now()): boolean {
    if (o.from && Date.parse(o.from) > now) return false;
    if (o.until && Date.parse(o.until) <= now) return false;
    return true;
  }
  /** the earned (play-only) currency grants pay in: the first earnedOnly currency */
  earnedCurrency(): CurrencyT | undefined { return this.c.store.currencies.find((c) => c.earnedOnly) ?? this.c.store.currencies[0]; }

  rolesOrdered(): RoleDefT[] {
    return [...this.c.roles].filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  }
  queuesOf(mode: string): QueueDefT[] { return this.c.queues.filter((q) => q.mode === mode).sort((a, b) => a.order - b.order); }
  queuesOfKind(kind: QueueDefT['kind']): QueueDefT[] { return this.c.queues.filter((q) => q.kind === kind).sort((a, b) => a.order - b.order); }
  /** the protocol a queue drafts with (session/setup.ts pickProtocol) */
  pickOf(q: QueueDefT): NonNullable<QueueDefT['pick']> { return q.pick ?? this.mode(q.mode)?.pick ?? 'blind'; }
  isFfa(m: ModeDefT | undefined): boolean { return !!m && (m.pick === 'ffa_pick' || m.teams > 2); }

  /** bible §Menu mood: RIFT three roads crossed by the noon line · BRIDGE one line over an arc ·
   *  FRAY a ring of ticks · the reserved slot an uncarved hour. Chosen from the mode's STRUCTURE. */
  modeMark(m: ModeDefT | undefined): ModeMark {
    if (!m) return 'uncarved';
    if (this.isFfa(m)) return 'ring';
    if (m.pick === 'random_bench' || (this.map(m.map)?.lanes.length ?? 3) <= 1) return 'span';
    return 'roads';
  }
  /** number of lanes (roads) a mode's map has, for its mark */
  laneCount(m: ModeDefT | undefined): number { return Math.max(1, this.map(m?.map)?.lanes.length ?? 3); }
  seatsOf(m: ModeDefT | undefined): number { return m ? m.teams * m.perTeam : 0; }

  /** the tier a rating shows (highest minRating ≤ rating); provisional ratings show none */
  tierFor(rating: number | undefined): RankTierT | undefined {
    if (rating === undefined) return undefined;
    let best: RankTierT | undefined;
    for (const r of [...this.c.ranks].sort((a, b) => a.minRating - b.minRating)) if (rating >= r.minRating) best = r;
    return best;
  }
  rankIndex(r: RankTierT | undefined): number { return r ? [...this.c.ranks].sort((a, b) => a.minRating - b.minRating).findIndex((x) => x.id === r.id) : -1; }
  ratingTier(rec: RatingRecord | undefined): RankTierT | undefined { return rec && !rec.provisional ? this.tierFor(rec.rating) : undefined; }

  /** localised string: catalog.strings[key] with {param} substitution, else the English fallback */
  t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const raw = this.c.strings[key] ?? fallback;
    return params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : raw;
  }
}
