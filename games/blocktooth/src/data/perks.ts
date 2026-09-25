// BLOCKTOOTH v2 — starting perks (FEATURES_V2 §8.5). THREE-free data.
//
// ── L0 SKELETON STUB ── names from §8.5; `card` (the hidden perk card id) is null until lane L5 adds the
// perk cards. The stub meta/perks.ts applies none of them.

import type { PerkDef, PerkId } from '../core/types.ts';

export const PERKS_DEF: Record<PerkId, PerkDef> = {
  perk_petty_cash: { id: 'perk_petty_cash', name: 'PETTY CASH', desc: '+1 reroll per draft', card: null },
  perk_red_tape: { id: 'perk_red_tape', name: 'RED TAPE', desc: '+1 BANISH and +1 LOCK charge', card: null },
  perk_warm_mic: { id: 'perk_warm_mic', name: 'WARM MIC', desc: 'The run starts with UPROAR full', card: null },
  perk_safety_inspection: { id: 'perk_safety_inspection', name: 'SAFETY INSPECTION', desc: '+8 armor', card: null },
  perk_stay_of_demolition: { id: 'perk_stay_of_demolition', name: 'STAY OF DEMOLITION', desc: 'Once per run, lethal damage leaves you at 25 % HP', card: null },
  perk_tip_line: { id: 'perk_tip_line', name: 'ADVANCE TIP-LINE', desc: '+1 OVERLOAD SITE active; objective arrows reach twice as far', card: null },
};
