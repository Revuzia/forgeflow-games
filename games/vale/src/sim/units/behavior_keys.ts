// VALE sim — the UnitDef.behavior vocabulary as data (CONTRACT §5.4 CHANGED(SIM)).
//
// `UnitDef.behavior` is free-form in the schema (`z.record(string, unknown)`), so zod can neither
// reject a typo ("aggroRadius") nor default a value. units/common.ts `behaviorOf` is the one reader;
// this table lists exactly the keys it reads, per unit kind, with the value shape it accepts. The
// content build (tools/build_content.ts) validates every unit's behavior against it, so a key the
// sim would silently ignore is a build error instead of a mystery in a match.
// No imports: the build loads this file on its own. Change it together with behaviorOf.

export type BehaviorValue =
  | 'number'        // finite number
  | 'boolean'
  | 'priority'      // array of PRIORITY_TOKENS
  | 'targetRules'   // 'tower' | 'none'
  | 'effects'       // EffectT[] (the build parses it and applies the schema defaults)
  | 'kindMults';    // { <DAMAGE_MULT_KINDS>: non-negative multiplier }

/** keys read for every unit kind (`any`) plus the kind-specific ones */
export const BEHAVIOR_KEYS: Readonly<Record<'any' | 'minion' | 'monster' | 'structure' | 'summon' | 'ward' | 'pickup', Readonly<Record<string, BehaviorValue>>>> = {
  any: { damageMult: 'kindMults', dummy: 'boolean' },
  minion: { aggroRange: 'number', chaseRange: 'number', callForHelpRange: 'number', priority: 'priority' },
  structure: { targetRules: 'targetRules', priority: 'priority', callForHelpRange: 'number', rampPerHit: 'number', rampMax: 'number', rampReset: 'number' },
  monster: { leash: 'number', resetRegen: 'number' },
  summon: { aggroRange: 'number', followRange: 'number', ownerLeash: 'number', priority: 'priority', callForHelpRange: 'number' },
  ward: { invisible: 'boolean' },
  pickup: { grant: 'effects', gold: 'number' },
};

/** target-priority tokens (units/common.ts priorityIndex) */
export const PRIORITY_TOKENS: readonly string[] = ['fighterAttacker', 'minionAttacker', 'fighter', 'minion', 'monster', 'structure', 'summon', 'ward'];
/** entity kinds a damageMult may name (the kinds a unit can damage) */
export const DAMAGE_MULT_KINDS: readonly string[] = ['fighter', 'minion', 'monster', 'structure', 'summon', 'ward'];
