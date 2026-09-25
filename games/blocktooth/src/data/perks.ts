// BLOCKTOOTH v2 — starting perks (FEATURES_V2 §8.5). THREE-free data.
//
// Lane L5. `card` = the hidden perk card (data/upgrades_v2.ts, `perk: true`) that meta/perks.ts applyPerk
// grants for the stat perks; the other perks are applied directly by applyPerk / tryRevive (RED TAPE,
// WARM MIC, STAY OF DEMOLITION) or read by the map sim / marker view (ADVANCE TIP-LINE reads
// w.meta.perk). Numbers: config PERKS.

import type { PerkDef, PerkId } from '../core/types.ts';

export const PERKS_DEF: Record<PerkId, PerkDef> = {
  perk_petty_cash: { id: 'perk_petty_cash', name: 'PETTY CASH', desc: '+1 reroll per draft', card: 'perk_card_petty_cash' },
  perk_red_tape: { id: 'perk_red_tape', name: 'RED TAPE', desc: '+1 BANISH and +1 LOCK charge', card: null },
  perk_warm_mic: { id: 'perk_warm_mic', name: 'WARM MIC', desc: 'The run starts with UPROAR full', card: null },
  perk_safety_inspection: { id: 'perk_safety_inspection', name: 'SAFETY INSPECTION', desc: '+8 armor', card: 'perk_card_safety_inspection' },
  perk_stay_of_demolition: { id: 'perk_stay_of_demolition', name: 'STAY OF DEMOLITION', desc: 'Once per run, lethal damage leaves you at 25 % HP with 2 s of invulnerability', card: null },
  perk_tip_line: { id: 'perk_tip_line', name: 'ADVANCE TIP-LINE', desc: '+1 OVERLOAD SITE active; objective arrows reach twice as far', card: null },
};
