// GENESIS — discovery (CONTRACT.md §8.4): how likely an agent is to work out a recipe nobody taught them.
//
//   experiment: a curious agent combines what they hold at a place. Chance per session =
//       base × curiosity term × (1 + 2 × skill) × (×6 when a trigger of the recipe is present at the place or happened
//       here lately) × settlement learning effects (oral tradition, writing, schools).
//   accident:   a trigger event (lightning in a dune, fire on clay, rotting grain, star iron...) gives each nearby
//       knower of the prerequisites a one-off chance = clamp(base × 30, 2 %, 45 %) × curiosity term.
//   reverse:    studying an artifact whose recipe's prerequisites the agent knows.
// The candidate list for experiments: recipes the SETTLEMENT does not know yet (true invention), whose prerequisites
// the agent knows, allowed to the species, not taboo — weighted toward ones whose triggers or inputs are at hand.

import type { RecipeTable, CRecipe } from './recipes.ts';
import { hasPrereqs } from './recipes.ts';

/** curiosity term: 0.35 for an incurious agent, up to ~1.9 for a very curious one on a curiosity-weighted recipe */
export function curiosityTerm(r: CRecipe, curiosity: number): number {
  return 1 + r.curiosity * (curiosity * 2.2 - 0.8);
}

export function experimentChance(r: CRecipe, curiosity: number, skill: number, triggered: boolean, learnBoost: number): number {
  const p = r.base * Math.max(0.2, curiosityTerm(r, curiosity)) * (1 + 2 * skill) * (triggered ? 6 : 1) * learnBoost;
  return Math.min(0.6, p);
}

export function accidentChance(r: CRecipe, curiosity: number): number {
  const base = Math.min(0.45, Math.max(0.02, r.base * 30));
  return Math.min(0.75, base * Math.max(0.3, curiosityTerm(r, curiosity)));
}

export function reverseChance(r: CRecipe, curiosity: number, skill: number): number {
  return Math.min(0.5, (0.12 + 0.25 * (1 - r.teach)) * Math.max(0.3, curiosityTerm(r, curiosity)) * (1 + skill));
}

/**
 * Experiment candidates for an agent: not in the settlement library, prerequisites known by the agent (bits at `off`),
 * species allowed, not taboo. Each with a weight (trigger / context presence raises it).
 */
export function experimentCandidates(
  t: RecipeTable, know: Uint32Array, off: number, kw: number, species: number,
  library: (k: number) => boolean, taboo: (k: number) => boolean, present: (ctx: string) => boolean,
  out: { r: CRecipe; w: number; triggered: boolean }[],
): { r: CRecipe; w: number; triggered: boolean }[] {
  out.length = 0;
  for (const r of t.list) {
    if (library(r.idx) || taboo(r.idx)) continue;
    if (r.base <= 0) continue;
    if (r.species && !r.species.includes(species)) continue;
    if (!hasPrereqs(r, know, off, kw)) continue;
    let triggered = false;
    for (const tr of r.triggers) if (present(tr)) { triggered = true; break; }
    const w = r.base * (triggered ? 8 : 1) * (1 + r.curiosity);
    out.push({ r, w, triggered });
  }
  return out;
}
