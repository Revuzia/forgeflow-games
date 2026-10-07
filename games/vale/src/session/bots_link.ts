// VALE session — the one place SESSION links to the BOTS lane (src/sim/bots/, CONTRACT §5.7).
//
// LocalSession takes its bot pieces from its options first (probes inject fixture bots), then from
// BOTS_LINK, then falls back:
//   draftBrain   (catalog, seed) → DraftBrain       fallback: createFallbackDraftBrain (draft_brain.ts)
//   bots         (catalog, setup) → BotFactory      fallback: none (bot seats stand idle)
//   pickLoadout  (catalog, fighter, rules, seed) → LoadoutChoice   fallback: setup defaults (setup.ts)
// When the BOTS lane lands, its exports are imported here and nowhere else in session/.

import type { CatalogT, RulesParamsT } from '../contracts/catalog.ts';
import type { LoadoutChoice, MatchSetup } from '../contracts/sim.ts';
import type { DraftBrainFactory } from './draft_brain.ts';
import type { BotFactory } from './match_host.ts';

export type BotsForMatch = (catalog: CatalogT, setup: MatchSetup) => BotFactory | null;
export type PickLoadout = (catalog: CatalogT, fighter: string, rules: RulesParamsT, seed: number) => LoadoutChoice | null;

export interface BotsLink {
  readonly draftBrain: DraftBrainFactory | null;
  readonly bots: BotsForMatch | null;
  readonly pickLoadout: PickLoadout | null;
}

export const BOTS_LINK: BotsLink = {
  draftBrain: null,
  bots: null,
  pickLoadout: null,
};
