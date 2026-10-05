// WOBBLEHOARD merge: MERGE_COST squishies of the SAME species become ONE new random squishy (_spec/DESIGN.md 5.6).
//
// THE ONE CONSTANT: `MERGE_COST`. The owner's rule picked 2 from the measured 3.1 to 3.8 active minutes per capsule (decent effort
// => 2; an easy 1.5 minutes or less => 3). Flipping to 3 is this one source line, then `node _harness/gen_catalog_doc.ts` to regenerate
// the generated _spec/CATALOG.md (it prints the cost; probe_catalog.ts fails while the generated file is stale). Nothing else in src or
// _harness hard-codes 2: probe_economy.ts builds every selection from MERGE_COST, accepts 2 or 3, and on every run also replays its
// whole merge section at the OTHER cost (passed as the explicit `cost` argument), so the flip is rehearsed continuously; the sim reads
// the constant (and its `--M 3` run overrides it). Outside the game code the server keeps its own copy (the `merge_cost` config row and
// the vendored host): _spec/MERGE.md section 8 is the deploy checklist, and a host/database mismatch aborts loudly.
//
// Rules, exactly as DESIGN 5.6:
//   * Inputs: MERGE_COST squishies of one species, Common to Legendary. A Mythic cannot merge (nothing above it).
//   * Output tier: never below the inputs' tier. Tier-up chance by input tier: Common 30%, Uncommon 25%, Rare 20%, Epic 15%, Legendary 10%.
//   * FINISHED ROW: if you own every species of the input tier, the merge ALWAYS tiers up (to a random species of the next tier).
//   * PITY: after 4 merges in a row from the same input tier without a tier-up, the next one tiers up (so never more than 4 duds in a row).
//     The counter is per input tier, so it cannot be banked on cheap fodder and spent on a Legendary pair.
//   * Species roll: random inside the output tier, NEVER the input species; species you do not own are weighted x1.5. No "guaranteed new" rule.
//   * Look of the result: a normal instance of the result species, tinted toward the inputs' hue (lineage colours stay visible) only as far
//     as it stays recognisably its own species; see lineageGenome for the exact bounds.
//
// Pure and deterministic. Randomness is injected (see RngSource in drops.ts). EXACT DRAW ORDER (never reorder): 1) tier-up roll, 2) species
// roll, 3) genome seed. Exactly three draws per merge, always, so a server can replay a merge from its seed.
//
// WHAT THE SERVER MUST ALSO RECOMPUTE: everything in rollMerge. The client calls previewMerge (no randomness: exact odds for the UI) and may
// call rollMerge with a made-up seed for the animation, but ONLY the server's rollMerge result mints an item: the server runs it with its own
// secret seed, the account's true ownership and pity counters, consumes the inputs and stores the pity counter it returns, in ONE transaction.
// The 0.5 s hold, the 24 h output lock, the 10-merges-a-day cap, favourites and the last-copy warning are UI and server policy, not part of the roll.
import type { Genome } from './genome.ts';
import { quantizeGenome, canonicalGenome } from './genome.ts';
import { mulberry32 } from './rng.ts';
import { TIERS, TIER_COUNT, TOP_TIER_INDEX, tierIndex } from './rarity.ts';
import type { TierId } from './rarity.ts';
import { CATALOG, SPECIES_BY_TIER, getSpecies, speciesBaseGenome, speciesTemplateGenome } from '../data/catalog.ts';
import type { SpeciesDef, SpeciesId } from '../data/catalog.ts';
import { bodyLab, labDistance } from '../data/palette.ts';
import type { Lab } from '../data/palette.ts';
import { draw, makeRng, pickWeighted } from './drops.ts';
import type { RngSource } from './drops.ts';

/** How many squishies of the SAME species one merge consumes. The single constant (owner's rule: 2; change to 3 here and nowhere else). */
export const MERGE_COST: number = 2; // typed `number`, not the literal 2, so no consumer can compile a comparison that breaks when this flips to 3

/** Tier-up chance by INPUT tier index (Common..Mythic). Mythic is 0: it cannot merge. */
export const MERGE_TIER_UP: readonly number[] = [0.30, 0.25, 0.20, 0.15, 0.10, 0];
/** Weight of a species the player does not own, against 1 for an owned one. */
export const MERGE_UNOWNED_WEIGHT = 1.5;
/** After this many merges in a row from one input tier without a tier-up, the next one tiers up. */
export const MERGE_PITY_AFTER = 4;
/** UI / server policy numbers that go with the rules (not used by the roll). */
export const MERGE_HOLD_MS = 500;
export const MERGE_OUTPUT_LOCK_HOURS = 24;
export const MERGE_DAILY_CAP = 10;

/**
 * The rules as data. `MERGE_RULES` is what the game plays. Every field can be overridden for an experiment (the economy sim's ablation ladder
 * A..F does exactly that), but production code never passes anything else.
 */
export interface MergeRules {
  /** Tier-up chance by input tier index. */
  tierUp: readonly number[];
  unownedWeight: number;
  /** Pity length; 0 = no pity. */
  pityAfter: number;
  /** A finished row multiplies the tier-up chance by this (1 = no boost)... */
  rowDoneBoost: number;
  /** ...capped here. 100 and 1 together mean "a finished row always tiers up" (every table chance is at least 10%). */
  rowDoneCap: number;
}
export const MERGE_RULES: MergeRules = { tierUp: MERGE_TIER_UP, unownedWeight: MERGE_UNOWNED_WEIGHT, pityAfter: MERGE_PITY_AFTER, rowDoneBoost: 100, rowDoneCap: 1 };

/* ───────────────────────────────────────────────── inputs and state ───────────────────────────────────────────────── */

/**
 * What a caller may hand in as one input: a species id, or anything carrying a species / a genome. A genome, when given, must be a
 * valid genome (canonicalGenome) of that same species, else the merge is refused with 'invalid-genome' (it would feed the lineage).
 */
export type MergeInput = SpeciesId | { species: SpeciesId; genome?: Genome } | { genome: Genome };

/** How many copies of a species the player owns: a map of counts, a Set of owned ids (counts then unknown), or a lookup function. */
export type MergeOwned = Readonly<Record<string, number>> | ReadonlySet<string> | ((id: SpeciesId) => number);

export interface MergeState {
  /** Ownership BEFORE the merge (inputs not yet consumed). */
  owned: MergeOwned;
  /** Pity counters by input tier index: merges in a row from that tier without a tier-up. Missing or invalid entries count as 0. Length TIER_COUNT. */
  pity?: readonly number[];
}

export const createMergePity = (): number[] => new Array(TIER_COUNT).fill(0);

export type MergeError = 'wrong-count' | 'mixed-species' | 'unknown-species' | 'invalid-genome' | 'mythic-cannot-merge' | 'not-enough-copies';

function copiesOf(owned: MergeOwned, id: SpeciesId): number {
  if (!owned) return 0;
  if (typeof owned === 'function') { const n = owned(id); return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  if (owned instanceof Set) return owned.has(id) ? 1 : 0;
  const n = (owned as Readonly<Record<string, number>>)[id];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
const countsKnown = (owned: MergeOwned): boolean => !!owned && !(owned instanceof Set);

/* ───────────────────────────────────────────────── the generic core (shared by the game, the preview and the economy sim) ───────────────────────────────────────────────── */
// The rules live HERE, once, over integer species HANDLES (catalog positions for the game; anything for a what-if roster in a simulation).
// previewMerge / rollMerge below adapt the real catalog to it; _harness/sim_economy.ts calls it directly (also for hypothetical catalogs).

export interface MergeCoreInput {
  /** Input tier index 0..TOP_TIER_INDEX-1 (a Mythic cannot merge). */
  tier: number;
  /** Handle of the input species: it is never a possible result and never counts as "lacking". */
  self: number;
  /** Handles of the species of each tier, by tier index. */
  roster: ReadonlyArray<ReadonlyArray<number>>;
  /** Copies owned of a handle; 0 = the player does not own it. */
  copies: (handle: number) => number;
  /** Merges in a row from this tier without a tier-up. */
  pity: number;
  rules: MergeRules;
}

export interface MergeCoreOdds {
  tier: number;
  baseP: number;
  /** The tier-up chance this merge has: 1 when a finished row or pity makes it certain. */
  pEff: number;
  basis: 'table' | 'finished-row' | 'pity';
  finished: boolean;
  pityDue: boolean;
  pityCount: number;
  pityLen: number;
  /** Candidates (handles) in the input tier and in the next tier, with their weights. */
  stay: number[]; stayW: number[]; stayTotal: number; stayNew: boolean[];
  up: number[]; upW: number[]; upTotal: number; upNew: boolean[];
  /** Candidates the player does not own, in each list. */
  lackStay: number; lackUp: number;
}

/** The exact odds of one merge (no randomness). */
export function mergeOddsCore(i: MergeCoreInput): MergeCoreOdds {
  const { tier: t, rules } = i;
  const cand = (tt: number): { list: number[]; w: number[]; isNew: boolean[]; total: number; lacking: number } => {
    const list: number[] = [], w: number[] = [], isNew: boolean[] = [];
    let total = 0, lacking = 0;
    for (const h of i.roster[tt]) {
      if (h === i.self) continue; // never the input species
      const nw = i.copies(h) === 0;
      if (nw) lacking++;
      const wt = nw ? rules.unownedWeight : 1;
      list.push(h); w.push(wt); isNew.push(nw); total += wt;
    }
    return { list, w, isNew, total, lacking };
  };
  const stay = cand(t);
  const up = t < TOP_TIER_INDEX ? cand(t + 1) : { list: [] as number[], w: [] as number[], isNew: [] as boolean[], total: 0, lacking: 0 };
  const baseP = rules.tierUp[t] ?? 0;
  const finished = t < TOP_TIER_INDEX && stay.lacking === 0;
  let pEff = baseP, basis: MergeCoreOdds['basis'] = 'table';
  if (rules.rowDoneBoost > 1 && finished) { pEff = Math.min(rules.rowDoneCap, baseP * rules.rowDoneBoost); basis = 'finished-row'; }
  const pityCount = Number.isFinite(i.pity) && i.pity > 0 ? Math.floor(i.pity) : 0;
  const pityDue = t < TOP_TIER_INDEX && rules.pityAfter > 0 && pityCount >= rules.pityAfter;
  if (pityDue) { if (!(basis === 'finished-row' && pEff >= 1)) basis = 'pity'; pEff = 1; }
  return { tier: t, baseP, pEff, basis, finished, pityDue, pityCount, pityLen: rules.pityAfter, stay: stay.list, stayW: stay.w, stayTotal: stay.total, stayNew: stay.isNew, up: up.list, upW: up.w, upTotal: up.total, upNew: up.isNew, lackStay: stay.lacking, lackUp: up.lacking };
}

/** Resolve a merge from two uniform draws: u1 decides the tier-up, u2 picks the species by weight inside the output tier. */
export function mergeDrawCore(o: MergeCoreOdds, u1: number, u2: number): { tierUp: boolean; out: number } {
  const tierUp = u1 < o.pEff;
  const list = tierUp ? o.up : o.stay, w = tierUp ? o.upW : o.stayW, total = tierUp ? o.upTotal : o.stayTotal;
  return { tierUp, out: list[pickWeighted(w, total, u2)] };
}

/** Pity counter after a merge: reset by a tier-up, else one more dud (capped at 255). */
export const pityAfterCore = (pity: number, tierUp: boolean): number => (tierUp ? 0 : Math.min(255, (Number.isFinite(pity) && pity > 0 ? Math.floor(pity) : 0) + 1));

/* ───────────────────────────────────────────────── the real catalog behind the core ───────────────────────────────────────────────── */

/** Handles of the real roster: a species' handle is its catalog position (= idx). */
const ROSTER: ReadonlyArray<ReadonlyArray<number>> = SPECIES_BY_TIER.map((l) => l.map((d) => d.idx));

interface Analysis { def: SpeciesDef; core: MergeCoreOdds; copies: number | null }

function analyse(def: SpeciesDef, state: MergeState | undefined, rules: MergeRules): Analysis {
  state = state ?? { owned: {} };
  const owned = state.owned;
  const t = tierIndex(def.tier);
  const pc = state.pity ? state.pity[t] : 0;
  const core = mergeOddsCore({ tier: t, self: def.idx, roster: ROSTER, copies: (h) => copiesOf(owned, CATALOG[h].id), pity: typeof pc === 'number' ? pc : 0, rules });
  return { def, core, copies: countsKnown(owned) ? copiesOf(owned, def.id) : null };
}

export interface MergeOutcomeRow {
  species: SpeciesId;
  tier: TierId;
  /** Weight inside its output tier (1, or the unowned weight). */
  weight: number;
  /** Exact probability of this result for this merge. All rows sum to 1. */
  probability: number;
  /** The player owns no copy of it now. */
  isNew: boolean;
}

export interface MergePreviewOk {
  ok: true;
  inputSpecies: SpeciesId;
  inputTier: TierId;
  cost: number;
  /** The tier a result lands in if it does not tier up (the input tier) and if it does. */
  stayTier: TierId;
  upTier: TierId;
  /** The table chance for this input tier (30/25/20/15/10 percent). */
  baseTierUpChance: number;
  /** The tier-up chance this merge actually has: 1 for a finished row or when pity is due, else the table chance. This is the number to SHOW. */
  tierUpChance: number;
  /** Why the chance is what it is. */
  basis: 'table' | 'finished-row' | 'pity';
  finishedRow: boolean;
  pityCount: number;
  pityDue: boolean;
  /** Further duds before the pity guarantee kicks in (0 when it is due now). */
  dudsUntilPity: number;
  /** Species of the input tier / the next tier (other than the input species) that the player still lacks. */
  lackingInTier: number;
  lackingInNextTier: number;
  /** Copies owned of the input species, or null if the ownership source only knows "owned or not". */
  copiesOwned: number | null;
  /** True when this merge uses the last copies of the input species (warn the player). */
  usesLastCopy: boolean;
  /** Every possible result with its exact probability (stay-tier rows first, then next-tier rows). */
  outcomes: MergeOutcomeRow[];
}
export interface MergePreviewErr { ok: false; error: MergeError }
export type MergePreview = MergePreviewOk | MergePreviewErr;

interface Resolved { def: SpeciesDef; inputs: SpeciesId[]; genomes: Genome[] }

/** Validate the inputs (count, known species, valid genomes of that species, same species, not Mythic, enough copies) and normalise them. */
function resolveInputs(inputs: readonly MergeInput[], state: MergeState | undefined, cost: number): Resolved | MergeError {
  state = state ?? { owned: {} };
  if (!Array.isArray(inputs) || inputs.length !== cost) return 'wrong-count';
  const ids: SpeciesId[] = [], genomes: Genome[] = [];
  for (const x of inputs) {
    let id: unknown, g: Genome | undefined;
    if (typeof x === 'string') id = x;
    else if (x && typeof x === 'object') {
      const o = x as { species?: unknown; genome?: unknown };
      if (o.genome !== undefined && o.genome !== null) {
        const c = canonicalGenome(o.genome);
        if (!c) return getSpecies(o.species ?? (o.genome as { species?: unknown }).species) ? 'invalid-genome' : 'unknown-species';
        g = c;
      }
      id = o.species ?? g?.species;
      if (g && o.species !== undefined && o.species !== g.species) return 'invalid-genome';
    }
    const d = getSpecies(id);
    if (!d) return 'unknown-species';
    ids.push(d.id);
    if (g) genomes.push(g);
  }
  if (ids.some((id) => id !== ids[0])) return 'mixed-species';
  const def = getSpecies(ids[0]) as SpeciesDef;
  if (tierIndex(def.tier) >= TOP_TIER_INDEX) return 'mythic-cannot-merge';
  if (countsKnown(state.owned) && copiesOf(state.owned, def.id) < cost) return 'not-enough-copies';
  return { def, inputs: ids, genomes };
}

function formatPreview(a: Analysis, cost: number): MergePreviewOk {
  const c = a.core;
  const outcomes: MergeOutcomeRow[] = [];
  const pUp = c.pEff, pStay = 1 - c.pEff;
  c.stay.forEach((h, i) => outcomes.push({ species: CATALOG[h].id, tier: CATALOG[h].tier, weight: c.stayW[i], probability: pStay * (c.stayW[i] / c.stayTotal), isNew: c.stayNew[i] }));
  c.up.forEach((h, i) => outcomes.push({ species: CATALOG[h].id, tier: CATALOG[h].tier, weight: c.upW[i], probability: pUp * (c.upW[i] / c.upTotal), isNew: c.upNew[i] }));
  return {
    ok: true, inputSpecies: a.def.id, inputTier: a.def.tier, cost,
    stayTier: a.def.tier, upTier: TIERS[Math.min(TOP_TIER_INDEX, c.tier + 1)],
    baseTierUpChance: c.baseP, tierUpChance: c.pEff, basis: c.basis, finishedRow: c.finished,
    pityCount: c.pityCount, pityDue: c.pityDue,
    dudsUntilPity: c.pityDue || c.pityLen <= 0 ? 0 : Math.max(0, c.pityLen - c.pityCount),
    lackingInTier: c.lackStay, lackingInNextTier: c.lackUp,
    copiesOwned: a.copies, usesLastCopy: a.copies !== null && a.copies <= cost,
    outcomes,
  };
}

/**
 * The exact odds of a merge, no randomness: what the preview panel shows (tier-up chance and why, how many species the player still lacks in the
 * output and next tier, every possible result with its probability, the last-copy warning). Returns { ok: false, error } for an invalid selection.
 * The server shows nothing from this; it exists so the UI and the server's roll can never disagree about the odds (rollMerge uses the same analysis).
 */
export function previewMerge(inputs: readonly MergeInput[], state: MergeState, rules: MergeRules = MERGE_RULES, cost: number = MERGE_COST): MergePreview {
  const r = resolveInputs(inputs, state, cost);
  if (typeof r === 'string') return { ok: false, error: r };
  return formatPreview(analyse(r.def, state, rules), cost);
}

/* ───────────────────────────────────────────────── the roll ───────────────────────────────────────────────── */

export interface MergeOutcome {
  species: SpeciesId;
  tier: TierId;
  /** The result is in a higher tier than the inputs. */
  tierUp: boolean;
  /** The player owned no copy of the result before this merge. */
  isNew: boolean;
  /** uint32 for the result's genome (genome.seed). */
  genomeSeed: number;
  /** The result's genome: speciesBaseGenome(species, genomeSeed), with the inputs' lineage tint (lineageGenome) when the inputs carried genomes. */
  genome: Genome;
}

export interface MergeRollOk {
  ok: true;
  /** The species consumed (MERGE_COST ids, all equal) and their genomes, if they were supplied (for `origin.parents`, the caller keeps its own item ids). */
  inputs: SpeciesId[];
  inputTier: TierId;
  outcome: MergeOutcome;
  /** Why it did or did not tier up: 'roll' (the table chance hit), 'finished-row' (guaranteed), 'pity' (guaranteed), 'stay' (a dud: same tier). */
  reason: 'roll' | 'finished-row' | 'pity' | 'stay';
  /** The odds that were used (the same object previewMerge would have produced from the same state). */
  odds: MergePreviewOk;
  /** The three uniform draws, in order: tier-up roll, species roll, genome seed. For audit and replay. */
  draws: [number, number, number];
  /** The pity counters after this merge: a full array, index = input tier. The caller stores it back. */
  pityAfter: number[];
  /** The counter of the input tier after this merge (0 after a tier-up). */
  pityCounterAfter: number;
}
export type MergeRoll = MergeRollOk | MergePreviewErr;

/** Circular mean of angles in degrees. */
function circularMean(deg: readonly number[]): number {
  let s = 0, c = 0;
  for (const d of deg) { s += Math.sin((d * Math.PI) / 180); c += Math.cos((d * Math.PI) / 180); }
  return (((Math.atan2(s, c) * 180) / Math.PI) % 360 + 360) % 360;
}
const angleDiff = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

/** Lineage pulls the result hue this fraction of the way toward the parents' mean hue... */
export const LINEAGE_PULL = 0.4;
/** ...at most this many degrees (before the identity bound below), plus up to +-LINEAGE_JITTER degrees. */
export const LINEAGE_MAX_SHIFT = 30;
export const LINEAGE_JITTER = 3;
/** OKLab margin by which a tinted result must stay nearer its own species' centre colour than any other species of its tier. */
export const LINEAGE_IDENTITY_MARGIN = 0.01;
/**
 * Absolute colour budget of the tint: the body stays within this OKLab distance of its species' centre colour. 0.04 is about two
 * just-noticeable differences (visible side by side, as lineage should be), a little more than the cosmetic band of a plain instance
 * (<= 0.035, probe_catalog) and about half the gap between two species of one tier (>= 0.075): tinted, never a different colour.
 */
export const LINEAGE_MAX_DISTANCE = 0.04;

/** Body colour (OKLab) of every species' template genome: the species' centre colour. Built on first use, never at module load. */
let centreLabs: Map<SpeciesId, Lab> | null = null;
function centreLab(id: SpeciesId): Lab {
  if (!centreLabs) centreLabs = new Map(CATALOG.map((d) => [d.id, bodyLab(speciesTemplateGenome(d.id))] as [SpeciesId, Lab]));
  return centreLabs.get(id) as Lab;
}

/**
 * True when genome `g` is recognisably its own species by colour: its body colour (src/data/palette.ts, OKLab) is nearer its species'
 * centre colour than the centre colour of ANY other species of the same tier, by at least `margin`, and (when given) no further than
 * `maxDistance` from its own centre. (Species of other tiers differ in silhouette, glow and tier styling as well; probe_catalog keeps
 * every same-tier pair of centres >= 0.075 apart.)
 */
export function keepsSpeciesColour(g: Genome, margin: number = LINEAGE_IDENTITY_MARGIN, maxDistance: number = Infinity): boolean {
  const def = getSpecies(g.species);
  if (!def) return false;
  const lab = bodyLab(g);
  const own = labDistance(lab, centreLab(def.id));
  if (own > maxDistance) return false;
  for (const o of SPECIES_BY_TIER[tierIndex(def.tier)]) if (o.id !== def.id && labDistance(lab, centreLab(o.id)) < own + margin) return false;
  return true;
}

/**
 * The look of a merge result (DESIGN 5.6: "the lineage colours stay visible"), bounded so the result is always recognisably ITS species.
 *   * hue: a lineage TINT toward the circular mean of the parents' hues: LINEAGE_PULL of the way, at most LINEAGE_MAX_SHIFT degrees, plus
 *     up to +-LINEAGE_JITTER degrees of jitter, but only as far as the body colour stays within LINEAGE_MAX_DISTANCE (OKLab) of the
 *     species' centre colour AND nearer that centre than any other same-tier species' centre (keepsSpeciesColour), at every whole degree
 *     on the way (the tint stops at the first degree that would break either). Saturated colours get a few degrees, greyish ones more;
 *     the template's own hue is always allowed (it is a normal instance).
 *   * pattern: the species' own pattern. Only a SAME-TIER merge into a patterned species (Rare and up) may inherit a parent's non-plain
 *     pattern (an even pick between the template and each parent), because that pattern is then a valid rarity layer of this very
 *     tier. A tier-up never borrows (the parents' pattern belongs to a lower tier), and plain never turns patterned or back.
 *   * everything else (chroma, lightness, core hue = the tier's tell colour, speckle, glitter, translucency, materials, eyes) is the
 *     template's: the result is otherwise a normal instance of its species.
 * Deterministic from (template, parents, seed): always exactly two draws (jitter, pattern pick). Parents that are not valid genomes are
 * ignored here (rollMerge refuses them before this point).
 */
export function lineageGenome(template: Genome, parents: readonly Genome[], seed: number): Genome {
  const ps = parents.map((p) => canonicalGenome(p)).filter((p): p is Genome => p !== null);
  if (!ps.length) return template;
  const r = mulberry32((seed ^ 0x6c696e65) >>> 0);
  const jitter = (r() - 0.5) * 2 * LINEAGE_JITTER;
  const pick = Math.floor(r() * (ps.length + 1)); // 0 = keep the template's pattern
  const mean = circularMean(ps.map((p) => p.hue));
  const want = Math.max(-LINEAGE_MAX_SHIFT, Math.min(LINEAGE_MAX_SHIFT, angleDiff(mean, template.hue) * LINEAGE_PULL)) + jitter;
  const dir = want < 0 ? -1 : 1, steps = Math.round(Math.abs(want));
  let k = 0;
  while (k < steps && keepsSpeciesColour(quantizeGenome({ ...template, hue: template.hue + dir * (k + 1) }), LINEAGE_IDENTITY_MARGIN, LINEAGE_MAX_DISTANCE)) k++;
  // pattern: inherited only inside one tier, and only between patterned looks
  const def = getSpecies(template.species);
  let pattern = template.pattern;
  if (pick > 0 && def && template.pattern !== 'plain') {
    const parent = ps[pick - 1], pDef = getSpecies(parent.species);
    if (pDef && pDef.tier === def.tier && parent.pattern !== 'plain') pattern = parent.pattern;
  }
  return quantizeGenome({ ...template, hue: template.hue + dir * k, pattern });
}

/**
 * Roll one merge. `inputs` are the MERGE_COST squishies being merged (species ids, or objects carrying a species / genome), `src` the random
 * source (the server's seed), `state` the account's ownership before the merge and its pity counters. Returns { ok: false, error } for an
 * invalid selection (wrong count, mixed species, unknown species, a Mythic, or fewer copies owned than the cost) WITHOUT consuming any randomness.
 * Never mutates its arguments: store `pityAfter` and consume the inputs yourself, in one transaction.
 */
export function rollMerge(inputs: readonly MergeInput[], src: RngSource, state: MergeState, rules: MergeRules = MERGE_RULES, cost: number = MERGE_COST): MergeRoll {
  const r = resolveInputs(inputs, state, cost);
  if (typeof r === 'string') return { ok: false, error: r };
  const rng = makeRng(src);
  const a = analyse(r.def, state, rules);
  const odds = formatPreview(a, cost);
  const u1 = draw(rng), u2 = draw(rng), u3 = draw(rng);
  // tier-up: the (effective) chance decides; pity and finished row are folded into it (chance 1)
  const { tierUp, out } = mergeDrawCore(a.core, u1, u2);
  const chosen = CATALOG[out];
  const genomeSeed = Math.floor(u3 * 4294967296) >>> 0;
  const base = speciesBaseGenome(chosen.id, genomeSeed);
  const genome = r.genomes.length ? lineageGenome(base, r.genomes, genomeSeed) : base;
  const pityAfter = createMergePity();
  for (let i = 0; i < TIER_COUNT; i++) { const p = state.pity ? state.pity[i] : 0; pityAfter[i] = typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.min(255, Math.floor(p)) : 0; }
  pityAfter[a.core.tier] = pityAfterCore(pityAfter[a.core.tier], tierUp);
  const isNew = copiesOf(state.owned, chosen.id) === 0;
  const reason: MergeRollOk['reason'] = !tierUp ? 'stay' : a.core.basis === 'pity' ? 'pity' : a.core.basis === 'finished-row' ? 'finished-row' : 'roll';
  return {
    ok: true, inputs: r.inputs, inputTier: r.def.tier,
    outcome: { species: chosen.id, tier: chosen.tier, tierUp, isNew, genomeSeed, genome },
    reason, odds, draws: [u1, u2, u3], pityAfter, pityCounterAfter: pityAfter[a.core.tier],
  };
}
