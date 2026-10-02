// WOBBLEHOARD merge: MERGE_COST squishies of the SAME species become ONE new random squishy (_spec/DESIGN.md 5.6).
//
// THE ONE CONSTANT: `MERGE_COST`. The owner's rule picked 2 from the measured 3.1 to 3.8 active minutes per capsule (decent effort
// => 2; an easy 1.5 minutes or less => 3). Flipping to 3 is this one line. Nothing else in this file, the probes or the sim hard-codes 2
// (probe_economy.ts derives every expectation from the constant; the sim's own M = 3 sensitivity run reads it too).
//
// Rules, exactly as DESIGN 5.6:
//   * Inputs: MERGE_COST squishies of one species, Common to Legendary. A Mythic cannot merge (nothing above it).
//   * Output tier: never below the inputs' tier. Tier-up chance by input tier: Common 30%, Uncommon 25%, Rare 20%, Epic 15%, Legendary 10%.
//   * FINISHED ROW: if you own every species of the input tier, the merge ALWAYS tiers up (to a random species of the next tier).
//   * PITY: after 4 merges in a row from the same input tier without a tier-up, the next one tiers up (so never more than 4 duds in a row).
//     The counter is per input tier, so it cannot be banked on cheap fodder and spent on a Legendary pair.
//   * Species roll: random inside the output tier, NEVER the input species; species you do not own are weighted x1.5. No "guaranteed new" rule.
//   * Look of the result: the species template, its hue and pattern mixed with the inputs' (lineage colours stay visible).
//
// Pure and deterministic. Randomness is injected (see RngSource in drops.ts). EXACT DRAW ORDER (never reorder): 1) tier-up roll, 2) species
// roll, 3) genome seed. Exactly three draws per merge, always, so a server can replay a merge from its seed.
//
// WHAT THE SERVER MUST ALSO RECOMPUTE: everything in rollMerge. The client calls previewMerge (no randomness: exact odds for the UI) and may
// call rollMerge with a made-up seed for the animation, but ONLY the server's rollMerge result mints an item: the server runs it with its own
// secret seed, the account's true ownership and pity counters, consumes the inputs and stores the pity counter it returns, in ONE transaction.
// The 0.5 s hold, the 24 h output lock, the 10-merges-a-day cap, favourites and the last-copy warning are UI and server policy, not part of the roll.
import type { Genome } from './genome.ts';
import { quantizeGenome } from './genome.ts';
import { mulberry32 } from './rng.ts';
import { TIERS, TIER_COUNT, TOP_TIER_INDEX, tierIndex } from './rarity.ts';
import type { TierId } from './rarity.ts';
import { SPECIES_BY_TIER, getSpecies, speciesBaseGenome } from '../data/catalog.ts';
import type { SpeciesDef, SpeciesId } from '../data/catalog.ts';
import { draw, makeRng, pickWeighted } from './drops.ts';
import type { RngSource } from './drops.ts';

/** How many squishies of the SAME species one merge consumes. The single constant (owner's rule: 2; change to 3 here and nowhere else). */
export const MERGE_COST = 2;

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

/** What a caller may hand in as one input: a species id, or anything carrying a species / a genome. */
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

export type MergeError = 'wrong-count' | 'mixed-species' | 'unknown-species' | 'mythic-cannot-merge' | 'not-enough-copies';

function copiesOf(owned: MergeOwned, id: SpeciesId): number {
  if (typeof owned === 'function') { const n = owned(id); return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  if (owned instanceof Set) return owned.has(id) ? 1 : 0;
  const n = (owned as Readonly<Record<string, number>>)[id];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
const countsKnown = (owned: MergeOwned): boolean => !(owned instanceof Set);

/* ───────────────────────────────────────────────── odds analysis (shared by preview and roll) ───────────────────────────────────────────────── */

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
  /** The tier a result lands in if it does not tier up (the input tier) and if it does (null for Mythic, which cannot merge). */
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

interface Analysis {
  def: SpeciesDef;
  t: number;
  baseP: number;
  pEff: number;
  basis: 'table' | 'finished-row' | 'pity';
  finished: boolean;
  pityCount: number;
  pityDue: boolean;
  pityLen: number;
  stay: SpeciesDef[]; stayW: number[]; stayTotal: number;
  up: SpeciesDef[]; upW: number[]; upTotal: number;
  lackStay: number; lackUp: number;
  copies: number | null;
}

function analyse(def: SpeciesDef, state: MergeState, rules: MergeRules): Analysis {
  const t = tierIndex(def.tier);
  const owned = state.owned;
  const isNew = (d: SpeciesDef): boolean => copiesOf(owned, d.id) === 0;
  const candidates = (tt: number): { list: SpeciesDef[]; w: number[]; total: number; lacking: number } => {
    const list: SpeciesDef[] = [], w: number[] = [];
    let total = 0, lacking = 0;
    for (const d of SPECIES_BY_TIER[tt]) {
      if (d.id === def.id) continue; // never the input species
      const nw = isNew(d);
      if (nw) lacking++;
      list.push(d); w.push(nw ? rules.unownedWeight : 1); total += nw ? rules.unownedWeight : 1;
    }
    return { list, w, total, lacking };
  };
  const stay = candidates(t);
  const up = t < TOP_TIER_INDEX ? candidates(t + 1) : { list: [] as SpeciesDef[], w: [] as number[], total: 0, lacking: 0 };
  const baseP = rules.tierUp[t] ?? 0;
  const finished = t < TOP_TIER_INDEX && stay.lacking === 0;
  let pEff = baseP, basis: Analysis['basis'] = 'table';
  if (rules.rowDoneBoost > 1 && finished) { pEff = Math.min(rules.rowDoneCap, baseP * rules.rowDoneBoost); basis = 'finished-row'; }
  const pc = state.pity ? state.pity[t] : 0;
  const pityCount = typeof pc === 'number' && Number.isFinite(pc) && pc > 0 ? Math.floor(pc) : 0;
  const pityDue = t < TOP_TIER_INDEX && rules.pityAfter > 0 && pityCount >= rules.pityAfter;
  if (pityDue) { if (!(basis === 'finished-row' && pEff >= 1)) basis = 'pity'; pEff = 1; }
  const copies = countsKnown(owned) ? copiesOf(owned, def.id) : null;
  return { def, t, baseP, pEff, basis, finished, pityCount, pityDue, pityLen: rules.pityAfter, stay: stay.list, stayW: stay.w, stayTotal: stay.total, up: up.list, upW: up.w, upTotal: up.total, lackStay: stay.lacking, lackUp: up.lacking, copies };
}

interface Resolved { def: SpeciesDef; inputs: SpeciesId[]; genomes: Genome[] }

/** Validate the inputs (count, same species, known, not Mythic) and normalise them. */
function resolveInputs(inputs: readonly MergeInput[], state: MergeState, cost: number): Resolved | MergeError {
  if (!Array.isArray(inputs) || inputs.length !== cost) return 'wrong-count';
  const ids: SpeciesId[] = [], genomes: Genome[] = [];
  for (const x of inputs) {
    let id: unknown, g: Genome | undefined;
    if (typeof x === 'string') id = x;
    else if (x && typeof x === 'object') {
      const o = x as { species?: unknown; genome?: Genome };
      g = o.genome && typeof o.genome === 'object' ? o.genome : undefined;
      id = o.species ?? g?.species;
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
  const outcomes: MergeOutcomeRow[] = [];
  const pUp = a.pEff, pStay = 1 - a.pEff;
  a.stay.forEach((d, i) => outcomes.push({ species: d.id, tier: d.tier, weight: a.stayW[i], probability: pStay * (a.stayW[i] / a.stayTotal), isNew: a.stayW[i] > 1 }));
  a.up.forEach((d, i) => outcomes.push({ species: d.id, tier: d.tier, weight: a.upW[i], probability: pUp * (a.upW[i] / a.upTotal), isNew: a.upW[i] > 1 }));
  return {
    ok: true, inputSpecies: a.def.id, inputTier: a.def.tier, cost,
    stayTier: a.def.tier, upTier: TIERS[Math.min(TOP_TIER_INDEX, a.t + 1)],
    baseTierUpChance: a.baseP, tierUpChance: a.pEff, basis: a.basis, finishedRow: a.finished,
    pityCount: a.pityCount, pityDue: a.pityDue,
    dudsUntilPity: a.pityDue || a.pityLen <= 0 ? 0 : Math.max(0, a.pityLen - a.pityCount),
    lackingInTier: a.lackStay, lackingInNextTier: a.lackUp,
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
  /** The result's genome: the species template with the inputs' hue and pattern mixed in when the inputs carried genomes, else the plain template. */
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

/**
 * The look of a merge result: the species template with the PARENTS' hue and pattern mixed in, so their colours stay visible (DESIGN 5.6).
 * hue moves 40% of the way toward the circular mean of the parents' hues, at most 35 degrees, plus up to 3 degrees of jitter; the pattern is
 * the template's or one parent's (an even three-way pick), and a borrowed non-plain pattern gets at least a speckle strength of 0.3.
 * Everything else (core hue = the tier's tell colour, materials, eyes) stays the species'. Deterministic from (template, parents, seed).
 */
export function lineageGenome(template: Genome, parents: readonly Genome[], seed: number): Genome {
  if (!parents.length) return template;
  const r = mulberry32((seed ^ 0x6c696e65) >>> 0);
  const mean = circularMean(parents.map((p) => p.hue));
  const shift = Math.max(-35, Math.min(35, angleDiff(mean, template.hue) * 0.4)) + (r() - 0.5) * 6;
  const pick = Math.floor(r() * (parents.length + 1)); // 0 = keep the template's pattern
  const pattern = pick === 0 ? template.pattern : parents[pick - 1].pattern;
  const speckle = pattern !== 'plain' && pattern !== template.pattern ? Math.max(template.speckle, 0.3) : template.speckle;
  return quantizeGenome({ ...template, hue: template.hue + shift, pattern, speckle });
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
  const tierUp = u1 < a.pEff;
  const list = tierUp ? a.up : a.stay, w = tierUp ? a.upW : a.stayW, total = tierUp ? a.upTotal : a.stayTotal;
  const chosen = list[pickWeighted(w, total, u2)];
  const genomeSeed = Math.floor(u3 * 4294967296) >>> 0;
  const base = speciesBaseGenome(chosen.id, genomeSeed);
  const genome = r.genomes.length ? lineageGenome(base, r.genomes, genomeSeed) : base;
  const pityAfter = createMergePity();
  for (let i = 0; i < TIER_COUNT; i++) { const p = state.pity ? state.pity[i] : 0; pityAfter[i] = typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.min(255, Math.floor(p)) : 0; }
  pityAfter[a.t] = tierUp ? 0 : Math.min(255, pityAfter[a.t] + 1);
  const isNew = copiesOf(state.owned, chosen.id) === 0;
  const reason: MergeRollOk['reason'] = !tierUp ? 'stay' : a.basis === 'pity' ? 'pity' : a.basis === 'finished-row' ? 'finished-row' : 'roll';
  return {
    ok: true, inputs: r.inputs, inputTier: r.def.tier,
    outcome: { species: chosen.id, tier: chosen.tier, tierUp, isNew, genomeSeed, genome },
    reason, odds, draws: [u1, u2, u3], pityAfter, pityCounterAfter: pityAfter[a.t],
  };
}
