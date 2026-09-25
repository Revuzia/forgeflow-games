// BLOCKTOOTH v2 — the 40 goals (FEATURES_V2 §8.2). THREE-free data. Lane L5 (META/ENDLESS-SIM).
//
// 15 general · 16 titan · 9 city. Every unlock item (24 locked cards, 6 locked evolutions, 6 perks,
// 8 palettes = 44) is referenced by exactly one goal (asserted by _harness/probe_meta.ts).
// `desc` is the condition text of §8.2. A goal with `titan` / `biome` only counts runs that match; a
// `boss` filter narrows boss metrics (bossKillsLife, staggersBestFight). How each metric is measured is
// in meta/goals.ts (metricValue).

import type { GoalDef, UnlockRef } from '../core/types.ts';

const card = (id: string): UnlockRef => ({ kind: 'card', id });

export const GOALS: GoalDef[] = [
  // ─────────────────────────────── general (15) ───────────────────────────────
  { id: 'g_first_broadcast', name: 'FIRST BROADCAST', desc: 'Finish any run', group: 'general',
    metric: 'runsFinished', target: 1, scope: 'life', unlocks: [card('u_block_captain')] },
  { id: 'g_zoning_change', name: 'ZONING CHANGE', desc: 'Reach SIZE III', group: 'general',
    metric: 'peakRank', target: 2, scope: 'run', unlocks: [card('u_sidewalk_sale')] },
  { id: 'g_skyline_adjusted', name: 'SKYLINE ADJUSTED', desc: 'Reach SIZE V', group: 'general',
    metric: 'peakRank', target: 4, scope: 'run', unlocks: [{ kind: 'perk', id: 'perk_petty_cash' }] },
  { id: 'g_city_got_smaller', name: 'THE CITY GOT SMALLER', desc: 'Clear any city', group: 'general',
    metric: 'clears', target: 1, scope: 'life', unlocks: [card('u_ribbon_cutting')] },
  { id: 'g_full_programming', name: 'FULL PROGRAMMING', desc: 'Clear all three cities, any titans', group: 'general',
    metric: 'biomesCleared', target: 3, scope: 'life', unlocks: [card('evo_citywide_blackout')] },
  { id: 'g_crowd_control', name: 'CROWD CONTROL', desc: '1 000 kills in one run', group: 'general',
    metric: 'kills', target: 1000, scope: 'run', unlocks: [card('u_rolling_closure')] },
  { id: 'g_one_take', name: 'ONE TAKE', desc: 'Clear a city without dropping below 25 % HP', group: 'general',
    metric: 'cleanClear', target: 1, scope: 'run', unlocks: [{ kind: 'perk', id: 'perk_stay_of_demolition' }] },
  { id: 'g_live_coverage', name: 'LIVE COVERAGE', desc: 'Fire UPROAR 10 times in one run', group: 'general',
    metric: 'ults', target: 10, scope: 'run', unlocks: [card('u_psa')] },
  { id: 'g_paperwork', name: 'PAPERWORK', desc: 'Banish 5 cards', group: 'general',
    metric: 'banishesLife', target: 5, scope: 'life', unlocks: [{ kind: 'perk', id: 'perk_red_tape' }] },
  { id: 'g_urban_renewal', name: 'URBAN RENEWAL', desc: 'Level 25 blocks in one run', group: 'general',
    metric: 'blocks', target: 25, scope: 'run', unlocks: [card('u_bulk_trash_day')] },
  { id: 'g_still_on_air', name: 'STILL ON AIR', desc: 'Survive 5:00 of extended coverage', group: 'general',
    metric: 'endlessS', target: 300, scope: 'run', unlocks: [card('u_utility_bill')] },
  { id: 'g_double_feature', name: 'DOUBLE FEATURE', desc: 'Defeat 2 containment bosses in one run', group: 'general',
    metric: 'bossesInRun', target: 2, scope: 'run', unlocks: [card('evo_audit_season')] },
  { id: 'g_change_order', name: 'CHANGE ORDER', desc: 'Take an evolution', group: 'general',
    metric: 'evolutionsLife', target: 1, scope: 'life', unlocks: [{ kind: 'perk', id: 'perk_tip_line' }] },
  { id: 'g_signal_boost', name: 'SIGNAL BOOST', desc: 'Collect 8 power-ups in one run', group: 'general',
    metric: 'powerups', target: 8, scope: 'run', unlocks: [card('u_night_market')] },
  { id: 'g_running_errands', name: 'RUNNING ERRANDS', desc: 'Complete 10 objectives in one run', group: 'general',
    metric: 'objectives', target: 10, scope: 'run', unlocks: [{ kind: 'perk', id: 'perk_warm_mic' }] },

  // ─────────────────────────────── titan (16) ───────────────────────────────
  { id: 'g_molo_curbside_pickup', name: 'CURBSIDE PICKUP', desc: 'MOLO: 60 pickups from one GULLET VACUUM', group: 'titan', titan: 'molo',
    metric: 'vacuumBest', target: 60, scope: 'run', unlocks: [{ kind: 'palette', titan: 'molo', index: 1 }] },
  { id: 'g_molo_speed_bump', name: 'SPEED BUMP', desc: 'MOLO: crush 300 foes in one run', group: 'titan', titan: 'molo',
    metric: 'crushed', target: 300, scope: 'run', unlocks: [card('molo_u_manhole_lid')] },
  { id: 'g_molo_bite_sized', name: 'BITE-SIZED CITY', desc: 'Clear any city with MOLO', group: 'titan', titan: 'molo',
    metric: 'titanClears', target: 1, scope: 'life', unlocks: [card('evo_municipal_stomach')] },
  { id: 'g_molo_three_course', name: 'THREE-COURSE MEAL', desc: 'Clear all three cities with MOLO', group: 'titan', titan: 'molo',
    metric: 'titanBiomesCleared', target: 3, scope: 'life',
    unlocks: [{ kind: 'palette', titan: 'molo', index: 2 }, card('molo_u_open_mouth_policy')] },

  { id: 'g_vk_six_way_splice', name: 'SIX-WAY SPLICE', desc: 'VOLT-KITE: detonate 6 LIVE WIRES at once (GRIDLOCK SURGE wires do not count)', group: 'titan', titan: 'voltkite',
    metric: 'wiresBest', target: 6, scope: 'run', unlocks: [{ kind: 'palette', titan: 'voltkite', index: 1 }] },
  { id: 'g_vk_power_outage', name: 'POWER OUTAGE', desc: 'VOLT-KITE: 25 kills from one HOOK', group: 'titan', titan: 'voltkite',
    metric: 'hookKillsBest', target: 25, scope: 'run', unlocks: [card('vk_u_lineman_gloves')] },
  { id: 'g_vk_grid_down', name: 'GRID DOWN', desc: 'Clear any city with VOLT-KITE', group: 'titan', titan: 'voltkite',
    metric: 'titanClears', target: 1, scope: 'life', unlocks: [card('evo_third_rail')] },
  { id: 'g_vk_coast_to_coast', name: 'COAST-TO-COAST OUTAGE', desc: 'Clear all three cities with VOLT-KITE', group: 'titan', titan: 'voltkite',
    metric: 'titanBiomesCleared', target: 3, scope: 'life',
    unlocks: [{ kind: 'palette', titan: 'voltkite', index: 2 }, card('vk_u_load_shedding_waltz')] },

  { id: 'g_hb_full_pressure', name: 'FULL PRESSURE', desc: 'HEARTHBACK: vent a 95 % SHELL 3 times in one run', group: 'titan', titan: 'hearthback',
    metric: 'fullVents', target: 3, scope: 'run', unlocks: [{ kind: 'palette', titan: 'hearthback', index: 1 }] },
  { id: 'g_hb_rolling_boil', name: 'ROLLING BOIL', desc: 'HEARTHBACK: 40 kills from one SHELL VENT', group: 'titan', titan: 'hearthback',
    metric: 'hookKillsBest', target: 40, scope: 'run', unlocks: [card('hb_u_geothermal_lease')] },
  { id: 'g_hb_warm_welcome', name: 'WARM WELCOME', desc: 'Clear any city with HEARTHBACK', group: 'titan', titan: 'hearthback',
    metric: 'titanClears', target: 1, scope: 'life', unlocks: [card('evo_supervolcano_permit')] },
  { id: 'g_hb_continental_drift', name: 'CONTINENTAL DRIFT', desc: 'Clear all three cities with HEARTHBACK', group: 'titan', titan: 'hearthback',
    metric: 'titanBiomesCleared', target: 3, scope: 'life',
    unlocks: [{ kind: 'palette', titan: 'hearthback', index: 2 }, card('hb_u_ash_cloud_advisory')] },

  { id: 'g_bw_full_bloom', name: 'FULL BLOOM', desc: 'BRIARWICK: 8 bloom turrets alive at once (GREENBELT DECREE blooms do not count)', group: 'titan', titan: 'briarwick',
    metric: 'bloomsBest', target: 8, scope: 'run', unlocks: [{ kind: 'palette', titan: 'briarwick', index: 1 }] },
  { id: 'g_bw_green_thumb', name: 'GREEN THUMB', desc: 'BRIARWICK: heal 2 000 HP in one run', group: 'titan', titan: 'briarwick',
    metric: 'healed', target: 2000, scope: 'run', unlocks: [card('bw_u_seed_catalogue')] },
  { id: 'g_bw_rewilded', name: 'REWILDED', desc: 'Clear any city with BRIARWICK', group: 'titan', titan: 'briarwick',
    metric: 'titanClears', target: 1, scope: 'life', unlocks: [card('evo_urban_forest_act')] },
  { id: 'g_bw_canopy_cover', name: 'CANOPY COVER', desc: 'Clear all three cities with BRIARWICK', group: 'titan', titan: 'briarwick',
    metric: 'titanBiomesCleared', target: 3, scope: 'life',
    unlocks: [{ kind: 'palette', titan: 'briarwick', index: 2 }, card('bw_u_arbor_day')] },

  // ─────────────────────────────── city (9) ───────────────────────────────
  { id: 'g_ge_curb_appeal', name: 'CURB APPEAL', desc: 'GRID-EAST: flatten 400 street props in one run', group: 'city', biome: 'grideast',
    metric: 'props', target: 400, scope: 'run', unlocks: [card('u_parking_validation')] },
  { id: 'g_ge_parking_violation', name: 'PARKING VIOLATION', desc: 'Defeat PARKADE-6', group: 'city', biome: 'grideast', boss: 'parkade6',
    metric: 'bossKillsLife', target: 1, scope: 'life', unlocks: [card('u_after_hours_permit')] },
  { id: 'g_ge_rate_hike', name: 'RATE HIKE', desc: 'GRID-EAST: destroy 6 OVERLOAD SITES in one run', group: 'city', biome: 'grideast',
    metric: 'overloadSites', target: 6, scope: 'run', unlocks: [card('u_citizen_hotline')] },
  { id: 'g_ws_cold_storage', name: 'COLD STORAGE', desc: "WHITE STACKS: topple 60 % of the district's tier-4 structures in one run", group: 'city', biome: 'whitestacks',
    metric: 'tier4CollapseFrac', target: 0.6, scope: 'run', unlocks: [card('u_rent_control')] },
  { id: 'g_ws_thaw', name: 'THAW', desc: 'Defeat IRON GULLY', group: 'city', biome: 'whitestacks', boss: 'irongully',
    metric: 'bossKillsLife', target: 1, scope: 'life', unlocks: [card('u_eviction_notice')] },
  { id: 'g_ws_hairline', name: 'HAIRLINE FRACTURES', desc: 'Stagger IRON GULLY 3 times in one fight (rematches do not count)', group: 'city', biome: 'whitestacks', boss: 'irongully',
    metric: 'staggersBestFight', target: 3, scope: 'run', unlocks: [{ kind: 'perk', id: 'perk_safety_inspection' }] },
  { id: 'g_lw_shipping_delays', name: 'SHIPPING DELAYS', desc: 'LOCKWATER: sink 60 boats in one run', group: 'city', biome: 'lockwater',
    metric: 'boats', target: 60, scope: 'run', unlocks: [card('u_street_festival')] },
  { id: 'g_lw_port_closed', name: 'PORT CLOSED', desc: 'Defeat CAISSON-4', group: 'city', biome: 'lockwater', boss: 'caisson4',
    metric: 'bossKillsLife', target: 1, scope: 'life', unlocks: [card('u_landmark_status')] },
  { id: 'g_lw_early_closing', name: 'EARLY CLOSING', desc: 'Clear LOCKWATER in under 9:00', group: 'city', biome: 'lockwater',
    metric: 'fastClearS', target: 540, scope: 'run', lowerIsBetter: true, unlocks: [card('u_detour_signage')] },
];

/** goal id → goal (built once). */
export const GOAL_BY_ID: Readonly<Record<string, GoalDef>> = Object.freeze(
  Object.fromEntries(GOALS.map((g) => [g.id, g])) as Record<string, GoalDef>,
);
