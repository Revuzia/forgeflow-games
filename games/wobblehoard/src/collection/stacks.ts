// WOBBLEHOARD stacks (_spec/COLLECTION.md 5.3, 9.2; _spec/MERGE.md 3.1, 3.3). Pure derivations over a list of items; runs in node.
//
//   buildStacks(items, ledger, nowMs)  one Stack per species (all of them, owned or not) in catalog order, from ONE ledger: items of the
//                                      other ledger are ignored, so real and ghost items never share a stack or a count.
//   keeper / spares                    the keeper is the first hearted copy (oldest first), else the oldest by bornAt (ties by id); every
//                                      other copy is a spare, newest first. "Spare" is derived, never stored.
//   mergeable                          spares that are not hearted, not locked (lockedUntil > now), not reserved and not on the offer
//                                      shelf (MERGE 3.1 and 3.3 add the shelf to the 5.3 list).
//   tidyCandidates                     MERGE 3.3: mergeable copies in groups of MERGE_COST, newest first, stacks by tier then catalog
//                                      index, Common and Uncommon unless includeRare, never Mythic, at most maxPairs groups.
// Every ordering is total (bornAt, then id), so shuffling the input never changes the output.
import { MERGE_COST } from '../core/merge.ts';
import { TOP_TIER_INDEX, tierIndex } from '../core/rarity.ts';
import { CATALOG, LANES } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import type { HoardItem, HoardPrefs, Ledger, SortKey, Stack } from './types.ts';

/** Tier indexes Tidy-up takes by default (MERGE M-4: Common and Uncommon; Rare and above are trade fuel). */
export const TIDY_DEFAULT_MAX_TIER = 1;

const byOldest = (a: HoardItem, b: HoardItem): number => a.bornAt - b.bornAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byNewest = (a: HoardItem, b: HoardItem): number => -byOldest(a, b);
const isLocked = (it: HoardItem, nowMs: number): boolean => it.lockedUntil !== null && it.lockedUntil > nowMs;

/** Is this copy usable as a merge input right now (not hearted, locked, reserved or on the shelf)? */
export const isMergeable = (it: HoardItem, nowMs: number): boolean => !it.fav && !it.reserved && !it.offered && !isLocked(it, nowMs);

/** One Stack per species in catalog order, from the items of `ledger` only. */
export function buildStacks(items: readonly HoardItem[], ledger: Ledger, nowMs: number): Stack[] {
  const bySpecies: HoardItem[][] = CATALOG.map(() => []);
  for (const it of items) if (it && it.ledger === ledger && it.speciesIdx >= 0 && it.speciesIdx < bySpecies.length) bySpecies[it.speciesIdx].push(it);
  return CATALOG.map((def, idx): Stack => {
    const copies = bySpecies[idx].sort(byOldest);
    const hearted = copies.filter((c) => c.fav);
    const keeperItem = hearted.length ? hearted[0] : copies.length ? copies[0] : null;
    const spares = copies.filter((c) => c !== keeperItem).sort(byNewest);
    const mergeableIds = spares.filter((c) => isMergeable(c, nowMs)).map((c) => c.id);
    const locked = copies.filter((c) => isLocked(c, nowMs)).length;
    return {
      idx, species: def.id, name: def.name, tier: def.tier, tierIdx: tierIndex(def.tier), laneIdx: LANES.findIndex((l) => l.id === def.lane), ledger,
      copies: copies.length, keeper: keeperItem ? keeperItem.id : null, spareIds: spares.map((c) => c.id), spares: Math.max(0, copies.length - 1),
      mergeableIds, mergeable: mergeableIds.length, locked, unseen: copies.filter((c) => !c.seen).length,
      offered: copies.filter((c) => c.offered).length, hearted: hearted.length, keeperHearted: !!keeperItem && keeperItem.fav,
      allLocked: copies.length > 0 && locked === copies.length, newestAt: copies.length ? copies[copies.length - 1].bornAt : 0,
    };
  });
}

/** Species owned (copies > 0): the "23 of 50" counter. */
export const ownedCount = (stacks: readonly Stack[]): number => stacks.reduce((n, s) => n + (s.copies > 0 ? 1 : 0), 0);

/** Every species of a tier is owned ("Row complete": a fixed cosmetic, never an item). */
export const rowComplete = (stacks: readonly Stack[], tierIdx: number): boolean => {
  const row = stacks.filter((s) => s.tierIdx === tierIdx);
  return row.length > 0 && row.every((s) => s.copies > 0);
};

/** Copies per species id (for restockDisplayOrder and the merge's ownership counts). */
export function copiesBySpecies(items: readonly HoardItem[], ledger: Ledger): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) if (it.ledger === ledger) out[it.species] = (out[it.species] ?? 0) + 1;
  return out;
}

/** Does a stack pass the filter chips of `prefs` (9.2)? An empty tier or lane mask means "no filter". */
export function stackMatches(s: Stack, prefs: Pick<HoardPrefs, 'tiers' | 'lanes' | 'onlySpares' | 'onlyMissing' | 'onlyHearts' | 'onlyShelf'>): boolean {
  if (prefs.tiers && !(prefs.tiers & (1 << s.tierIdx))) return false;
  if (prefs.lanes && !(prefs.lanes & (1 << s.laneIdx))) return false;
  if (prefs.onlySpares && s.spares < 1) return false;
  if (prefs.onlyMissing && s.copies > 0) return false;
  if (prefs.onlyHearts && s.hearted < 1) return false;
  if (prefs.onlyShelf && s.offered < 1) return false;
  return true;
}

export const filterStacks = (stacks: readonly Stack[], prefs: HoardPrefs): Stack[] => stacks.filter((s) => stackMatches(s, prefs));

/** A new array in the order of `key` (9.2): Tier (default), Newest, Name, Most spares, Collection order. Ties fall back to catalog order. */
export function sortStacks(stacks: readonly Stack[], key: SortKey): Stack[] {
  const cmp: Record<SortKey, (a: Stack, b: Stack) => number> = {
    tier: (a, b) => a.tierIdx - b.tierIdx || a.idx - b.idx,
    catalog: (a, b) => a.idx - b.idx,
    newest: (a, b) => b.newestAt - a.newestAt || a.idx - b.idx,
    name: (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.idx - b.idx),
    spares: (a, b) => b.spares - a.spares || a.idx - b.idx,
  };
  return stacks.slice().sort(cmp[key] ?? cmp.tier);
}

/**
 * Tidy-up candidates (MERGE 3.3, M-4): groups of MERGE_COST mergeable spares, newest first, from stacks ordered by tier then catalog
 * index. Common and Uncommon only unless includeRare; Mythic never (it cannot merge); never the keeper; at most maxPairs groups.
 */
export function tidyCandidates(stacks: readonly Stack[], opts: { includeRare: boolean; maxPairs: number }): string[][] {
  const out: string[][] = [];
  const max = Math.max(0, Math.floor(opts.maxPairs));
  const ordered = stacks.slice().sort((a, b) => a.tierIdx - b.tierIdx || a.idx - b.idx);
  for (const s of ordered) {
    if (out.length >= max) break;
    if (s.tierIdx >= TOP_TIER_INDEX) continue;
    if (!opts.includeRare && s.tierIdx > TIDY_DEFAULT_MAX_TIER) continue;
    for (let i = 0; i + MERGE_COST <= s.mergeableIds.length && out.length < max; i += MERGE_COST) out.push(s.mergeableIds.slice(i, i + MERGE_COST));
  }
  return out;
}

/** The merge pad's default inputs for a species (MERGE 3.1 step 2): the newest MERGE_COST mergeable spares, never the keeper; null if too few. */
export function defaultMergeInputs(stacks: readonly Stack[], species: SpeciesId): string[] | null {
  const s = stacks.find((x) => x.species === species);
  if (!s || s.tierIdx >= TOP_TIER_INDEX || s.mergeableIds.length < MERGE_COST) return null;
  return s.mergeableIds.slice(0, MERGE_COST);
}
