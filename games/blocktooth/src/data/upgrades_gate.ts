// BLOCKTOOTH — GATEKEEPERS unlock cards (GATEKEEPERS.md §6.5). THREE-free, pure data. Lane K2c (META).
//
// Five `locked: true` cards, each unlocked by exactly one of the six gatekeeper goals (data/goals.ts; the
// sixth goal, WITHOUT A DENT, unlocks the perk DEFERRED MAINTENANCE). Offered only when RunMeta.unlocked
// lists the id, like every v2 unlockable (upgrades/draft.ts isEligible).
//
// Never imports data/upgrades.ts (no cycle): desc is '' here and data/upgrades.ts fills it with describe()
// when it appends UPGRADES_GATE to UPGRADES (one line, after the v2 append block), exactly as for
// UPGRADES_V2_RAW. Every card uses the existing effect DSL; no new stat or action.
//
// | id                     | name              | rarity · stacks · tags        | effects (per stack)                                   |
// |------------------------|-------------------|-------------------------------|-------------------------------------------------------|
// | gate_fresh_coat        | Fresh Coat        | common · 3 · mobility         | +5 % move speed, +6 % smash radius                    |
// | gate_sawhorse_stack    | Sawhorse Stack    | rare · 2 · survival, trigger  | +4 armor; when hurt 30 %: shield 6 % max HP (6 s icd)  |
// | gate_call_waiting      | Call Waiting      | epic · 2 · ult, trigger       | on hit 10 %: +3 UPROAR (3 s icd)                      |
// | gate_blanket_exemption | Blanket Exemption | epic · 1 · offense            | +12 % damage, −8 % max HP                             |
// | gate_carbon_copy       | Carbon Copy       | rare · 2 · growth             | +1 reroll per draft, +4 % XP gain                     |
//
// Names: the §1 name register (checked there against every existing card, perk, goal and boss word).

import type { Rarity, StatKey, TriggerAction, TriggerOn, UpgradeDef, UpgradeEffect } from '../core/types.ts';

const add = (stat: StatKey, v: number): UpgradeEffect => ({ stat, add: v });
const mul = (stat: StatKey, v: number): UpgradeEffect => ({ stat, mul: v });
const on = (when: TriggerOn, chance: number, icd: number, action: TriggerAction, p: Record<string, number | string> = {}): UpgradeEffect =>
  ({ trigger: { on: when, chance, icd, action, p } });

/** a locked gatekeeper unlock card (desc filled by data/upgrades.ts describe()) */
function G(id: string, name: string, rarity: Rarity, maxStacks: number, tags: string[], effects: UpgradeEffect[]): UpgradeDef {
  return { id, name, desc: '', rarity, maxStacks, tags, effects, locked: true };
}

export const UPGRADES_GATE: UpgradeDef[] = [
  G('gate_fresh_coat', 'Fresh Coat', 'common', 3, ['mobility'], [mul('moveSpeed', 0.05), mul('smashRadius', 0.06)]),
  G('gate_sawhorse_stack', 'Sawhorse Stack', 'rare', 2, ['survival', 'trigger'], [add('armor', 4), on('hurt', 0.3, 6, 'shield', { amount: 0.06 })]),
  G('gate_call_waiting', 'Call Waiting', 'epic', 2, ['ult', 'trigger'], [on('hit', 0.1, 3, 'ultCharge', { amount: 3 })]),
  G('gate_blanket_exemption', 'Blanket Exemption', 'epic', 1, ['offense'], [mul('damage', 0.12), mul('maxHp', -0.08)]),
  G('gate_carbon_copy', 'Carbon Copy', 'rare', 2, ['growth'], [add('rerolls', 1), mul('xpGain', 0.04)]),
];

/** the five gate card ids, catalogue order (probe_meta / probe_upgrades) */
export const GATE_CARD_IDS: readonly string[] = UPGRADES_GATE.map((u) => u.id);
