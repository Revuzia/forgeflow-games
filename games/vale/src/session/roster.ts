// VALE session — the roster gate (benchmark r12 B3): a fighter is ART-READY only when its model, portrait,
// icon and splash all resolve in the built catalog. Only art-ready fighters are offered anywhere a fighter
// is chosen: the draft pool (players, bots, timeouts, presets), the quick-queue / practice presets, custom
// seats, the store's skins. Nothing selectable is a placeholder.
//
// Data-driven, no content ids: "resolves" is the content build's own rule (CatalogView.isBuilt): a ref the
// build found is rewritten to a content-addressed path (`assets/<12 hex>-<name>`); a missing one keeps its
// authored ref (`--allow-missing-assets`). The gate turns itself off fighter by fighter as the art rollout
// lands models, and entirely when a catalog has no built fighter art at all (fixture catalogs, a content
// build without art), so a catalog is never left with an empty roster.

import type { CatalogT } from '../contracts/catalog.ts';

type FighterT = CatalogT['fighters'][number];
type SkinT = CatalogT['skins'][number];

/** the content build resolved this asset ref (content-addressed, or an absolute URL) */
export function assetResolves(ref: string | undefined | null): boolean {
  return !!ref && (/^assets\/[0-9a-f]{12}-/.test(ref) || /^(https?:|data:|blob:)/.test(ref));
}

/** model + portrait + icon + splash all resolve */
export function fighterArtReady(f: FighterT | undefined | null): boolean {
  const a = f?.art;
  return !!a && assetResolves(a.model) && assetResolves(a.portrait) && assetResolves(a.icon) && assetResolves(a.splash);
}

/** a skin's own model + portrait + splash resolve (store offers) */
export function skinArtReady(s: SkinT | undefined | null): boolean {
  return !!s && assetResolves(s.model) && assetResolves(s.portrait) && assetResolves(s.splash);
}

const cache = new WeakMap<CatalogT, ReadonlySet<string>>();

/** ids of the fighters that may be chosen: the art-ready ones, or every fighter when none is (gate off) */
export function playableIds(catalog: CatalogT): ReadonlySet<string> {
  let s = cache.get(catalog);
  if (!s) {
    const ready = catalog.fighters.filter(fighterArtReady);
    s = new Set((ready.length ? ready : catalog.fighters).map((f) => f.id));
    cache.set(catalog, s);
  }
  return s;
}

export function isPlayable(catalog: CatalogT, fighter: string | undefined | null): boolean {
  return !!fighter && playableIds(catalog).has(fighter);
}
