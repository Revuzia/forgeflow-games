// VALE UI — read-only lookups over the catalog. Content is data: the UI never names a content id; it
// finds records by the ids the session/profile hands it and decides presentation from record KINDS
// (queue.kind, mode.pick, rules.end.kind), never from ids (CONTRACT §0, §9.6).

import type {
  CatalogT, ClassDefT, ModeDefT, QueueDefT, RankTierT, ResourceDefT, RoleDefT, SkinDefT,
} from '../contracts/catalog.ts';
import type { RatingRecord } from '../contracts/session.ts';
import { isPlayable, playableIds, skinArtReady } from '../session/roster.ts';

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

/** a tip's mode tag (content/client.json tips): `[rift] …` or `[rift,bridge] …` at the start of the line */
const TIP_TAG = /^\[([a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*)\]\s*/;

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
  /** URL of a catalog asset, or null when the asset does not exist. The content build rewrites every
   *  asset it found to a content-addressed path (`assets/<12 hex>-<name>`) and leaves a missing one's ref
   *  as authored (`--allow-missing-assets`), so an un-rewritten ref is a known-missing asset: the UI
   *  shows its designed placeholder without requesting it (no 404 storm while the art lane works). */
  asset(ref: string | undefined | null): string | null {
    if (!ref) return null;
    if (!CatalogView.isBuilt(ref)) return null;
    return this.assetFn(ref);
  }
  static isBuilt(ref: string): boolean { return /^assets\/[0-9a-f]{12}-/.test(ref) || /^(https?:|data:|blob:)/.test(ref); }

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
  /** the fighters a player may choose (session/roster.ts: art-ready ones; every fighter while none is) */
  playable(): readonly FighterDefT[] { const ids = playableIds(this.c); return this.c.fighters.filter((f) => ids.has(f.id)); }
  isPlayable(fighter: string | undefined | null): boolean { return isPlayable(this.c, fighter); }
  /** a store offer's skin can be shown and worn: its fighter is playable and the skin's own art resolves */
  skinOnSale(skin: string | undefined | null): boolean { const s = this.skin(skin); return !!s && this.isPlayable(s.fighter) && skinArtReady(s); }
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

  /** effective rules of a queue (mode rules with the queue's partial overrides, one level deep) */
  rulesOf(q: QueueDefT): ModeDefT['rules'] {
    const base = this.mode(q.mode)?.rules ?? ({} as ModeDefT['rules']);
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(q.rules ?? {})) {
      const b = (base as Record<string, unknown>)[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? { ...(b as object), ...(v as object) } : v;
    }
    return out as ModeDefT['rules'];
  }
  /** setup pool rule (session/setup.ts): an empty pools list means every pool */
  inPool(pools: readonly string[] | undefined, pool: string | undefined): boolean { return !pool || !pools || pools.length === 0 || pools.includes(pool); }
  /** Hour-spell slots the session fills (session/setup.ts sanitizeLoadout: at most 2) */
  spellSlots(): number { return Math.max(1, Math.min(2, this.c.setup.spellSlots)); }
  boonSlots(pool?: string): number { return this.c.setup.boons.some((b) => this.inPool(b.pools, pool)) ? Math.max(0, this.c.setup.boonSlots) : 0; }
  /** the ranked rating ids the catalog uses (one per ranked queue) */
  rankedQueues(): QueueDefT[] { return this.c.queues.filter((q) => q.ranked).sort((a, b) => a.order - b.order); }
  /** origin tags (collection filter) from fighter tags that have a collection.origin.<tag> string */
  originOf(f: FighterDefT): string | undefined { return f.tags.find((t) => `collection.origin.${t}` in this.c.strings); }
  ordinal(n: number): string { return this.t(`ordinal.${n}`, '', {}) || this.t('ordinal.n', '{n}th', { n }); }

  /** the tips a mode's loading screen shows (loading:tip-mode): client.tips in order, each either for every mode or,
   *  led by a mode tag `[<mode id>,<mode id>] `, only for the modes it names (the tag is stripped). With no mode, only
   *  the untagged tips. A tag naming no catalog mode hides its tip everywhere (unknownTipModes lists them) */
  tipsFor(mode: string | undefined | null): string[] {
    const out: string[] = [];
    for (const t of this.c.client.tips) {
      const m = TIP_TAG.exec(t);
      if (!m) out.push(t);
      else if (mode && m[1].split(',').map((s) => s.trim()).includes(mode)) out.push(t.slice(m[0].length));
    }
    return out;
  }
  /** mode tags in client.tips that name no catalog mode (dev + harness check) */
  unknownTipModes(): string[] {
    return this.c.client.tips.flatMap((t) => TIP_TAG.exec(t)?.[1].split(',').map((s) => s.trim()) ?? []).filter((id) => !this.mode(id));
  }

  /** localised string: catalog.strings[key] with {param} substitution, else the English fallback */
  t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const raw = this.c.strings[key] ?? fallback;
    return params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : raw;
  }
}
