// VALE session — the one place SESSION links to the BOTS lane (src/sim/bots/, CONTRACT §5.7).
//
// LocalSession takes its bot pieces from its options first (probes inject fixture bots), then from
// BOTS_LINK (the BOTS lane), then falls back:
//   draftBrain   (catalog, seed) → DraftBrain                createDraftBrain   · fallback: draft_brain.ts
//   bots         (catalog, setup) → BotFactory               createBots         · fallback: none (idle bots)
//   pickLoadout  (catalog, fighter, rules, seed, role?) → LoadoutChoice
//                                                             pickLoadout(catalog, fighter, rules.itemPool, role)
//                                                                                · fallback: setup defaults
// The session sanitizes whatever comes back (setup.ts sanitizeLoadout), so a bot loadout can never
// carry an id the sim would drop.

import type { CatalogT, RulesParamsT } from '../contracts/catalog.ts';
import type { LoadoutChoice, MatchSetup } from '../contracts/sim.ts';
import { createBots, createDraftBrain, pickLoadout } from '../sim/bots/index.ts';
import type { DraftBrainFactory } from './draft_brain.ts';
import type { BotFactory } from './match_host.ts';

export type BotsForMatch = (catalog: CatalogT, setup: MatchSetup) => BotFactory | null;
export type PickLoadout = (catalog: CatalogT, fighter: string, rules: RulesParamsT, seed: number, role?: string) => LoadoutChoice | null;

export interface BotsLink {
  readonly draftBrain: DraftBrainFactory | null;
  readonly bots: BotsForMatch | null;
  readonly pickLoadout: PickLoadout | null;
}

export const BOTS_LINK: BotsLink = {
  draftBrain: (catalog, seed) => createDraftBrain(catalog, seed),
  bots: (catalog, setup) => createBots(catalog, setup),
  pickLoadout: (catalog, fighter, rules, _seed, role) => pickLoadout(catalog, fighter, rules.itemPool, role),
};
