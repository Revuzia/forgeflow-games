// BLOCKTOOTH v2 — new upgrade cards: base-pool, unlockable, evolutions, perk cards (FEATURES_V2 §7).
// Lane L2 (DRAFT/EVO-SIM). THREE-free, pure data.
//
// Never imports data/upgrades.ts (no cycle): desc is '' here and data/upgrades.ts fills it with
// describe() when it appends these to UPGRADES (the L0 "V2 append block", §7.1). Every card uses the
// existing effect DSL (stats + triggers); the only new action is 'ultCharge' (UPROAR points × stacks,
// × the ultCharge stat inside addUproar).
//
//   * BASE (2, §7.2): in every fresh pool. They make "every StatKey is touched by ≥ 1 upgrade" hold for
//     the fresh pool (ultCharge, ultPower).
//   * UNLOCKABLE (24, §7.6): `locked: true` — offered only when RunMeta.unlocked lists the id (the goal
//     that unlocks each one is in data/goals.ts, §8.2). Cards whose only trigger is 'collapse' carry
//     minRank 1, like every v1 collapse card: nothing collapses at Size I (no tier-0 buildings), so they
//     would be dead picks there.
//   * EVOLUTIONS (15, §7.3): legendary, maxStacks 1, tags ['evolution', <base's first tag>], titan = the
//     base's titan, `evo: {base, with}`. OFFERED, NEVER ROLLED (upgrades/draft.ts isEligible refuses
//     them; rollOffer v2 inserts a ready one). Taking one deletes the base card (pickUpgrade). Every stat
//     the base touched is ≥ its maxed-base value after evolving (asserted by probe_evolutions).
//     Six are `locked` (unlocked by G05 FULL PROGRAMMING, G12 DOUBLE FEATURE and the four titan clears).
//   * PERK CARDS (2, §7.6): `perk: true`, hidden: never offered, never on the ability bar; meta/perks.ts
//     applyPerk grants them (PETTY CASH +1 reroll, SAFETY INSPECTION +8 armor = config PERKS).
//
// Names: original civic register, checked against every v1 name (FEATURES_V2 §1 name register).

import type { Rarity, RankIndex, StatKey, TitanId, TriggerAction, TriggerOn, UpgradeDef, UpgradeEffect } from '../core/types.ts';

// ─────────────────────────────── builders (desc filled by data/upgrades.ts) ───────────────────────────────
const add = (stat: StatKey, v: number): UpgradeEffect => ({ stat, add: v });
const mul = (stat: StatKey, v: number): UpgradeEffect => ({ stat, mul: v });
const on = (when: TriggerOn, chance: number, icd: number, action: TriggerAction, p: Record<string, number | string> = {}): UpgradeEffect =>
  ({ trigger: { on: when, chance, icd, action, p } });

interface Opt { titan?: TitanId; minRank?: RankIndex; locked?: boolean; perk?: boolean; evo?: { base: string; with: string } }

function U(id: string, name: string, rarity: Rarity, maxStacks: number, tags: string[], effects: UpgradeEffect[], opt: Opt = {}): UpgradeDef {
  const d: UpgradeDef = { id, name, desc: '', rarity, maxStacks, tags, effects };
  if (opt.titan) d.titan = opt.titan;
  if (opt.minRank !== undefined) d.minRank = opt.minRank;
  if (opt.locked) d.locked = true;
  if (opt.perk) d.perk = true;
  if (opt.evo) d.evo = { base: opt.evo.base, with: opt.evo.with };
  return d;
}

/** Evolution card: legendary · 1 stack · tags ['evolution', baseTag0] · the base's titan. */
function EVO(id: string, name: string, base: string, withId: string, baseTag0: string, effects: UpgradeEffect[], titan?: TitanId, locked = false): UpgradeDef {
  return U(id, name, 'legendary', 1, ['evolution', baseTag0], effects, { titan, locked, evo: { base, with: withId } });
}

const L = { locked: true } as const;
const LT = (titan: TitanId): Opt => ({ titan, locked: true });

// ─────────────────────────────── §7.2 new base-pool cards (not locked) ───────────────────────────────
const BASE_V2: UpgradeDef[] = [
  U('airtime_ledger', 'Airtime Ledger', 'rare', 3, ['ult'], [mul('ultCharge', 0.12)]),
  U('press_conference', 'Press Conference', 'rare', 3, ['ult'], [mul('ultPower', 0.15)]),
];

// ─────────────────────────────── §7.3 evolutions (catalogue order = EVOLUTIONS order) ───────────────────────────────
const EVOS: UpgradeDef[] = [
  EVO('evo_shear_wall_certificate', 'Shear Wall Certificate', 'load_bearing_gut', 'rebar_ribcage', 'survival',
    [mul('maxHp', 0.8), add('armor', 24), on('hurt', 1, 10, 'shield', { amount: 0.12 })]),
  EVO('evo_teardown_mandate', 'Teardown Mandate', 'condemnation_notice', 'eminent_domain', 'smash',
    [mul('buildingDamage', 0.9), on('collapse', 1, 0.3, 'shockwave', { r: 2.2, dmg: 30 })]),
  EVO('evo_citywide_blackout', 'Citywide Blackout', 'brownout', 'substation_hum', 'offense',
    [on('hit', 0.2, 0.3, 'spark', { dmg: 20, chains: 4 }), on('interval', 1, 0, 'arc', { count: 4, dmg: 18, every: 2 })], undefined, true),
  EVO('evo_arterial_bypass', 'Arterial Bypass', 'express_lane', 'jaywalkers_rhythm', 'mobility',
    [mul('moveSpeed', 0.45), on('dash', 1, 3, 'frenzy', { stat: 'moveSpeed', mul: 0.3, dur: 5 }), on('dash', 1, 1, 'shockwave', { r: 1.2, dmg: 14 })]),
  EVO('evo_bulldozer_clause', 'Bulldozer Clause', 'wrecking_permit', 'wide_load', 'smash',
    [mul('smashDamage', 1.1), mul('smashRadius', 0.3), on('smash', 0.08, 0.4, 'shockwave', { r: 0.8, dmg: 10 })]),
  EVO('evo_audit_season', 'Audit Season', 'code_violation', 'double_citation', 'offense',
    [add('critChance', 0.28), add('critMult', 0.9), on('crit', 0.3, 0.8, 'rubbleShot', { count: 3, dmg: 10 })], undefined, true),
  EVO('evo_all_you_can_eat_zoning', 'All-You-Can-Eat Zoning', 'doggy_bag', 'downspout_suction', 'growth',
    [mul('pickupRadius', 1.3), on('interval', 1, 0, 'magnet', { r: 14, every: 6 })]),
  EVO('evo_full_block_bite', 'Full-Block Bite', 'molo_hinge_variance', 'molo_curb_appetite', 'kit',
    [add('biteCleave', 5), mul('damage', 0.15), mul('attackRange', 0.2)], 'molo'),
  EVO('evo_municipal_stomach', 'Municipal Stomach', 'molo_storm_drain_throat', 'molo_greasy_spoon', 'kit',
    [mul('vacuumRadius', 1.0), mul('abilityPower', 0.3), on('ability', 1, 0, 'heal', { amount: 0.1, frac: 1 }), on('ability', 1, 0, 'shockwave', { r: 2.5, dmg: 30 })], 'molo', true),
  EVO('evo_load_dispatcher', 'Load Dispatcher', 'vk_extra_outlet', 'vk_power_strip_splitter', 'kit',
    [add('arcForks', 6), add('chains', 1), mul('chainRange', 0.3)], 'voltkite'),
  EVO('evo_third_rail', 'Third Rail', 'vk_high_voltage_easement', 'vk_live_wire_permit', 'kit',
    [mul('wireDamage', 1.3), add('wireDuration', 3), on('dash', 1, 0.6, 'arc', { count: 3, dmg: 12 })], 'voltkite', true),
  EVO('evo_supervolcano_permit', 'Supervolcano Permit', 'hb_thick_crust', 'hb_stockpot_dome', 'kit',
    [mul('shellCapacity', 1.3), mul('abilityPower', 0.25), on('ability', 1, 0, 'magma', { r: 2, dps: 16, dur: 5 })], 'hearthback', true),
  EVO('evo_molten_core_sample', 'Molten Core Sample', 'hb_open_burn_permit', 'hb_hot_asphalt', 'kit',
    [add('magmaDuration', 8), mul('area', 0.2), add('stompDelay', -0.15)], 'hearthback'),
  EVO('evo_urban_forest_act', 'Urban Forest Act', 'bw_fertilizer_runoff', 'bw_extra_allotment', 'kit',
    [mul('turretRate', 1.0), add('turretCap', 3)], 'briarwick', true),
  EVO('evo_kudzu_clause', 'Kudzu Clause', 'bw_hedge_easement', 'bw_bramble_whip', 'kit',
    [mul('vineLength', 0.9), mul('damage', 0.12), on('hit', 0.06, 1, 'slowField', { r: 1.5, dur: 2 })], 'briarwick'),
];

// ─────────────────────────────── §7.6 unlockable cards (locked; each unlocked by one goal) ───────────────────────────────
const UNLOCKABLE: UpgradeDef[] = [
  U('u_block_captain', 'Block Captain', 'common', 4, ['offense'], [mul('damage', 0.06), mul('area', 0.04)], L),
  U('u_sidewalk_sale', 'Sidewalk Sale', 'common', 5, ['growth'], [mul('pickupRadius', 0.12), mul('xpGain', 0.03)], L),
  U('u_ribbon_cutting', 'Ribbon Cutting', 'epic', 1, ['survival', 'trigger'], [mul('maxHp', 0.08), on('levelUp', 1, 0, 'shockwave', { r: 2.5, dmg: 30 })], L),
  U('u_rolling_closure', 'Rolling Closure', 'rare', 3, ['offense', 'trigger'], [on('kill', 0.1, 2, 'slowField', { r: 1.5, dur: 3 })], L),
  U('u_psa', 'Public Service Announcement', 'epic', 2, ['ult', 'hook', 'trigger'], [on('ability', 0.25, 4, 'ultCharge', { amount: 8 })], L),
  U('u_bulk_trash_day', 'Bulk Trash Day', 'common', 4, ['smash', 'trigger'], [mul('buildingDamage', 0.08), on('floorBreak', 0.06, 0.4, 'rubbleShot', { count: 1, dmg: 6 })], L),
  U('u_utility_bill', 'Utility Bill', 'epic', 2, ['offense', 'trigger'], [on('interval', 1, 0, 'shockwave', { r: 1.4, dmg: 16, every: 5 })], L),
  U('u_night_market', 'Night Market', 'rare', 3, ['ult', 'trigger'], [on('pickup', 0.03, 0.5, 'ultCharge', { amount: 3 })], L),
  U('u_parking_validation', 'Parking Validation', 'common', 4, ['mobility', 'trigger'], [mul('dashCooldown', -0.06), on('dash', 0.2, 3, 'heal', { amount: 0.01, frac: 1 })], L),
  U('u_after_hours_permit', 'After-Hours Permit', 'rare', 3, ['hook', 'trigger'], [on('ability', 1, 6, 'frenzy', { stat: 'attackRate', mul: 0.2, dur: 4 })], L),
  U('u_citizen_hotline', 'Citizen Hotline', 'rare', 3, ['survival', 'trigger'], [on('hurt', 0.3, 3, 'arc', { count: 3, dmg: 10 })], L),
  U('u_rent_control', 'Rent Control', 'rare', 3, ['survival'], [add('armor', 5), add('thorns', 0.2)], L),
  U('u_eviction_notice', 'Eviction Notice', 'epic', 2, ['offense', 'trigger'], [on('crush', 0.25, 0.5, 'shockwave', { r: 1, dmg: 12 })], L),
  U('u_street_festival', 'Street Festival', 'rare', 3, ['growth', 'trigger'], [on('collapse', 0.3, 3, 'magnet', { r: 6 })], { locked: true, minRank: 1 }),
  U('u_landmark_status', 'Landmark Status', 'legendary', 1, ['mutation', 'survival'], [mul('maxHp', 0.35), add('armor', 15), mul('moveSpeed', -0.1)], L),
  U('u_detour_signage', 'Detour Signage', 'common', 4, ['mobility'], [mul('knockback', 0.15), mul('moveSpeed', 0.03)], L),
  U('molo_u_manhole_lid', 'Manhole Lid', 'rare', 3, ['kit', 'survival', 'trigger'], [add('armor', 5), on('ability', 1, 0, 'slowField', { r: 3, dur: 3 })], LT('molo')),
  U('molo_u_open_mouth_policy', 'Open-Mouth Policy', 'epic', 2, ['kit', 'hook', 'growth', 'trigger'], [mul('vacuumRadius', 0.2), on('ability', 1, 0, 'xp', { amount: 2 })], LT('molo')),
  U('vk_u_lineman_gloves', "Lineman's Gloves", 'rare', 3, ['kit', 'survival'], [add('armor', 5), mul('wireDamage', 0.1)], LT('voltkite')),
  U('vk_u_load_shedding_waltz', 'Load-Shedding Waltz', 'rare', 3, ['kit', 'mobility', 'trigger'], [on('dash', 1, 1, 'shockwave', { r: 0.8, dmg: 10 })], LT('voltkite')),
  U('hb_u_geothermal_lease', 'Geothermal Lease', 'rare', 3, ['kit', 'survival'], [add('regen', 0.5), mul('shellCapacity', 0.1)], LT('hearthback')),
  U('hb_u_ash_cloud_advisory', 'Ash Cloud Advisory', 'epic', 2, ['kit', 'hook', 'trigger'], [on('ability', 1, 0, 'slowField', { r: 3, dur: 4, dps: 8 })], LT('hearthback')),
  U('bw_u_seed_catalogue', 'Seed Catalogue', 'rare', 3, ['kit', 'survival'], [mul('sporeHeal', 0.2), add('regen', 0.3)], LT('briarwick')),
  U('bw_u_arbor_day', 'Arbor Day', 'rare', 3, ['kit', 'smash', 'trigger'], [on('collapse', 0.4, 2, 'bloom', { dur: 16 })], { titan: 'briarwick', locked: true, minRank: 1 }),
];

// ─────────────────────────────── §7.6 perk cards (hidden; granted by meta/perks.ts applyPerk) ───────────────────────────────
// Numbers = config PERKS.pettyCashRerolls (1) / PERKS.safetyArmor (8); probe_evolutions asserts they match.
const PERK_CARDS: UpgradeDef[] = [
  U('perk_card_petty_cash', 'Petty Cash Voucher', 'rare', 1, ['growth'], [add('rerolls', 1)], { perk: true }),
  U('perk_card_safety_inspection', 'Safety Inspection Seal', 'rare', 1, ['survival'], [add('armor', 8)], { perk: true }),
];

/** Every v2 card, desc '' (data/upgrades.ts generates it). Order: base, evolutions, unlockable, perk. */
export const UPGRADES_V2_RAW: UpgradeDef[] = [...BASE_V2, ...EVOS, ...UNLOCKABLE, ...PERK_CARDS];
