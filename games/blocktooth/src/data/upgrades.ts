// BLOCKTOOTH — upgrade catalogue (CONTRACT §5.3, §11). Lane: upgrades. THREE-FREE, pure data.
//
// Every card's `desc` is GENERATED from its effects (describe() below), so the numbers on the card
// are the numbers the engine uses — one line, per stack. Conventions the engine honours:
//   * stat effects: final = (base + Σ add·stacks) × Π(1 + mul·stacks)          (upgrades/stats.ts)
//   * trigger magnitudes scale with stacks: p.dmg, p.amount, p.dps, p.mul × stacks
//     (shown as "(+N per stack)"); chance, icd, radius, duration, count and `every` do not.
//   * trigger damage is a BASE number → × titanDamage (rank dmg× · damage stat · frenzy).
//   * radii (p.r, p.aoe) are in titan body-heights (H) × the area stat.
//   * 'mass' / 'xp' amounts are "floors' worth": amount × TIERS[t].floorMass / floorXp where t is the
//     triggering building's tier for floor/collapse/smash events (props = tier 0; capped at what the
//     titan can flatten) and the biggest flattenable tier otherwise — relevant at every size, but a
//     tiny shop collapsing under a Size IV foot is priced as a tiny shop.
// Names: original civic / monster-humour register (building codes, municipal forms, traffic,
// plumbing, zoning, appetite). None from CONTRACT §1's forbidden list.

import type { Rarity, RankIndex, StatKey, TitanId, TriggerAction, TriggerOn, UpgradeDef, UpgradeEffect } from '../core/types.ts';

// ─────────────────────────────── description generator ───────────────────────────────

/** Compact number: up to 2 decimals, no trailing zeros. */
export function fmtNum(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(r);
}
const MINUS = '−';
const sgn = (v: number) => (v < 0 ? MINUS : '+');
const pct = (v: number) => `${fmtNum(Math.abs(v) * 100)}%`;

interface StatText {
  label: string;
  /** custom text for a flat add (default: "+N label") */
  add?: (a: number) => string;
}
const pctAdd = (label: string): StatText => ({ label, add: (a) => `${sgn(a)}${pct(a)} ${label}` });

const STAT_TEXT: Record<StatKey, StatText> = {
  maxHp: { label: 'max HP' },
  regen: { label: 'HP/s regen' },
  armor: { label: 'armor' },
  iframes: { label: 'invulnerability after a hit', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} s invulnerability after a hit` },
  thorns: { label: 'thorns', add: (a) => `${sgn(a)}${pct(a)} of damage taken reflected at the attacker` },
  lifesteal: pctAdd('lifesteal'),
  rubbleHeal: { label: 'HP per rubble pickup', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} HP per rubble pickup (× SIZE HP multiplier)` },
  moveSpeed: { label: 'move speed' },
  dashCharges: { label: 'dash charge', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} dash charge${Math.abs(a) === 1 ? '' : 's'}` },
  dashCooldown: { label: 'dash recharge time' },
  dashDistance: { label: 'dash distance' },
  pickupRadius: { label: 'pickup reach' },
  massGain: { label: 'mass gain' },
  xpGain: { label: 'XP gain' },
  luck: { label: 'luck' },
  rerolls: { label: 'reroll per draft', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} reroll${Math.abs(a) === 1 ? '' : 's'} per draft` },
  damage: { label: 'damage' },
  attackRate: { label: 'attack speed' },
  attackRange: { label: 'attack range' },
  area: { label: 'area' },
  critChance: pctAdd('crit chance'),
  critMult: pctAdd('crit damage'),
  knockback: { label: 'knockback' },
  chains: { label: 'chain jump', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} chain jump${Math.abs(a) === 1 ? '' : 's'}` },
  chainRange: { label: 'chain range' },
  projectiles: { label: 'rubble chunk per throw', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} rubble chunk${Math.abs(a) === 1 ? '' : 's'} per throw` },
  buildingDamage: { label: 'damage to buildings' },
  smashDamage: { label: 'contact smash damage' },
  smashRadius: { label: 'smash radius' },
  sparkChance: { label: 'smash spark chance', add: (a) => `${sgn(a)}${pct(a)} chance per smash to throw a free spark (6 dmg, hits up to 3 foes)` },
  abilityCooldown: { label: 'hook cooldown' },
  abilityPower: { label: 'hook power' },
  // MOLO
  biteCleave: { label: 'CURB BITE sweep', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a) * 10)}° CURB BITE sweep each side` },
  pulseEvery: { label: 'FOOT-PULSE interval', add: (a) => (a < 0 ? `FOOT-PULSE ${fmtNum(-a)} footstep${a === -1 ? '' : 's'} sooner` : `FOOT-PULSE ${fmtNum(a)} footstep${a === 1 ? '' : 's'} later`) },
  vacuumRadius: { label: 'GULLET VACUUM reach' },
  // VOLT-KITE
  arcForks: { label: 'FORK-ARC fork', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} FORK-ARC fork${Math.abs(a) === 1 ? '' : 's'}` },
  wireDuration: { label: 'LIVE WIRE life', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} s LIVE WIRE life` },
  wireDamage: { label: 'LIVE WIRE damage' },
  // HEARTHBACK
  shellCapacity: { label: 'SHELL capacity' },
  stompDelay: { label: 'MAGMA STOMP windup', add: (a) => (a < 0 ? `MAGMA STOMP erupts ${fmtNum(-a)} s sooner` : `MAGMA STOMP erupts ${fmtNum(a)} s later`) },
  magmaDuration: { label: 'MAGMA STOMP magma', add: (a) => `MAGMA STOMP leaves magma ${sgn(a)}${fmtNum(Math.abs(a))} s` },
  // BRIARWICK
  turretCap: { label: 'BLOOM TURRET cap', add: (a) => `${sgn(a)}${fmtNum(Math.abs(a))} BLOOM TURRET cap` },
  turretRate: { label: 'BLOOM TURRET fire rate' },
  sporeHeal: { label: 'spore healing' },
  vineLength: { label: 'VINE LASH length' },
};

/** Human label for a stat (UI chips, frenzy text). */
export function statLabel(k: StatKey): string { return STAT_TEXT[k].label; }

const ON_TEXT: Record<TriggerOn, string> = {
  smash: 'On smash', floorBreak: 'When a floor breaks', collapse: 'When a building collapses',
  kill: 'On kill', crush: 'On crush', hit: 'On hit', crit: 'On crit', dash: 'On dash', ability: 'On hook',
  hurt: 'When hurt', pickup: 'On pickup', rankUp: 'On SIZE-UP', levelUp: 'On level-up', interval: 'Every',
};

/** Trigger params whose magnitude scales × stacks (engine + generator agree on this list). */
export const STACK_SCALED_KEYS: readonly string[] = ['dmg', 'amount', 'dps', 'mul'];

const P = (p: Record<string, number | string>, k: string, d = 0): number => {
  const v = p[k];
  return typeof v === 'number' ? v : d;
};

function actionText(action: TriggerAction, p: Record<string, number | string>, stacking: boolean): string {
  const per = (v: number, unit: string) => (stacking ? `${fmtNum(v)}${unit} (+${fmtNum(v)}${unit} per stack)` : `${fmtNum(v)}${unit}`);
  const perPct = (v: number, unit: string) => (stacking ? `${pct(v)}${unit} (+${pct(v)} per stack)` : `${pct(v)}${unit}`);
  switch (action) {
    case 'spark': return `throw a spark that hits up to ${fmtNum(1 + P(p, 'chains'))} foes for ${per(P(p, 'dmg'), ' dmg')}`;
    case 'shockwave': return `release a ${fmtNum(P(p, 'r'))}-body-height shockwave for ${per(P(p, 'dmg'), ' dmg')}`;
    case 'heal': return P(p, 'frac') ? `heal ${perPct(P(p, 'amount'), ' max HP')}` : `heal ${per(P(p, 'amount'), ' HP')}`;
    case 'shield': return `gain a shield of ${perPct(P(p, 'amount'), ' max HP')}`;
    case 'mass': return `gain ${per(P(p, 'amount'), '')} floors' worth of mass`;
    case 'xp': return `gain ${per(P(p, 'amount'), '')} floors' worth of XP`;
    case 'magnet': return `pull every pickup within ${fmtNum(P(p, 'r'))} body-heights`;
    case 'rubbleShot': return `hurl ${fmtNum(P(p, 'count', 1))} rubble chunk${P(p, 'count', 1) === 1 ? '' : 's'} for ${per(P(p, 'dmg'), ' dmg')}`;
    case 'frenzy': {
      const k = String(p.stat) as StatKey;
      return `gain ${stacking ? `+${pct(P(p, 'mul'))} (+${pct(P(p, 'mul'))} per stack)` : `+${pct(P(p, 'mul'))}`} ${STAT_TEXT[k] ? STAT_TEXT[k].label : k} for ${fmtNum(P(p, 'dur'))} s`;
    }
    case 'cdReduce': return `cut the hook cooldown by ${per(P(p, 'amount'), ' s')}`;
    case 'dashRefund': return 'refund a dash charge';
    case 'meteor': return `drop a debris meteor (${fmtNum(P(p, 'aoe'))}-body-height blast) on a foe within ${fmtNum(P(p, 'r'))} body-heights for ${per(P(p, 'dmg'), ' dmg')}`;
    case 'arc': return `arc to the ${fmtNum(P(p, 'count', 1))} nearest foe${P(p, 'count', 1) === 1 ? '' : 's'} for ${per(P(p, 'dmg'), ' dmg')}`;
    case 'magma': return `leave a ${fmtNum(P(p, 'r'))}-body-height magma pool for ${fmtNum(P(p, 'dur'))} s at ${per(P(p, 'dps'), ' dmg/s')}`;
    case 'bloom': return `root a BLOOM TURRET for ${fmtNum(P(p, 'dur', 20))} s`;
    case 'slowField': return `spread a ${fmtNum(P(p, 'r'))}-body-height frost field for ${fmtNum(P(p, 'dur'))} s that slows foes 40%${P(p, 'dps') ? ` and deals ${per(P(p, 'dps'), ' dmg/s')}` : ''}`;
  }
}

function hasScaledKey(p: Record<string, number | string>): boolean {
  for (const k of STACK_SCALED_KEYS) if (typeof p[k] === 'number' && p[k] !== 0) return true;
  return false;
}

/** One-line card text from the effects (numbers are per stack). */
export function describe(effects: readonly UpgradeEffect[], maxStacks: number): string {
  const stats: string[] = [];
  const trig: string[] = [];
  for (const e of effects) {
    if (e.stat) {
      const t = STAT_TEXT[e.stat];
      if (e.add) stats.push(t.add ? t.add(e.add) : `${sgn(e.add)}${fmtNum(Math.abs(e.add))} ${t.label}`);
      if (e.mul) stats.push(`${sgn(e.mul)}${pct(e.mul)} ${t.label}`);
    }
    if (e.trigger) {
      const g = e.trigger;
      const stacking = maxStacks > 1 && hasScaledKey(g.p);
      const act = actionText(g.action, g.p, stacking);
      const head = g.on === 'interval' ? `Every ${fmtNum(P(g.p, 'every', 10))} s` : ON_TEXT[g.on];
      const chance = g.chance < 1 ? `${pct(g.chance)} chance to ` : '';
      const cd = g.icd > 0 ? ` (${fmtNum(g.icd)} s cooldown)` : '';
      trig.push(`${head}: ${chance}${act}${cd}`);
    }
  }
  const parts: string[] = [];
  if (stats.length) parts.push(stats.join(', '));
  for (const t of trig) parts.push(t);
  return parts.join('; ') + '.';
}

// ─────────────────────────────── builders ───────────────────────────────

const add = (stat: StatKey, v: number): UpgradeEffect => ({ stat, add: v });
const mul = (stat: StatKey, v: number): UpgradeEffect => ({ stat, mul: v });
const on = (when: TriggerOn, chance: number, icd: number, action: TriggerAction, p: Record<string, number | string> = {}): UpgradeEffect =>
  ({ trigger: { on: when, chance, icd, action, p } });

interface Opt { titan?: TitanId; minRank?: RankIndex }

function U(id: string, name: string, rarity: Rarity, maxStacks: number, tags: string[], effects: UpgradeEffect[], opt: Opt = {}): UpgradeDef {
  const d: UpgradeDef = { id, name, desc: describe(effects, maxStacks), rarity, maxStacks, tags, effects };
  if (opt.titan) d.titan = opt.titan;
  if (opt.minRank !== undefined) d.minRank = opt.minRank;
  return d;
}

// ─────────────────────────────── catalogue ───────────────────────────────

const SURVIVAL: UpgradeDef[] = [
  U('load_bearing_gut', 'Load-Bearing Gut', 'common', 5, ['survival'], [mul('maxHp', 0.12)]),
  U('rebar_ribcage', 'Rebar Ribcage', 'common', 5, ['survival'], [add('armor', 6)]),
  U('slow_drip_permit', 'Slow-Drip Permit', 'common', 5, ['survival'], [add('regen', 0.4)]),
  U('seismic_retrofit', 'Seismic Retrofit', 'common', 4, ['survival'], [add('armor', 4), mul('maxHp', 0.06)]),
  U('hazard_pay', 'Hazard Pay', 'rare', 3, ['survival', 'offense'], [add('lifesteal', 0.01)]),
  U('complaint_department', 'Complaint Department', 'common', 5, ['survival'], [add('thorns', 0.3)]),
  U('rubble_brunch', 'Rubble Brunch', 'common', 5, ['survival', 'growth'], [add('rubbleHeal', 0.3)]),
  U('grace_period', 'Grace Period', 'rare', 3, ['survival'], [add('iframes', 0.1)]),
  U('insurance_adjuster', 'Insurance Adjuster', 'rare', 3, ['survival', 'trigger'], [on('hurt', 1, 8, 'shield', { amount: 0.08 })]),
  U('sprinkler_system', 'Sprinkler System', 'rare', 3, ['survival', 'trigger'], [on('hurt', 0.25, 3, 'heal', { amount: 0.03, frac: 1 })]),
  U('restraining_order', 'Restraining Order', 'rare', 3, ['survival', 'trigger'], [on('hurt', 0.3, 4, 'shockwave', { r: 1.2, dmg: 10 })]),
  U('noise_ordinance', 'Noise Ordinance', 'common', 3, ['survival', 'trigger'], [add('armor', 3), on('hurt', 0.35, 5, 'slowField', { r: 2, dur: 3 })]),
  U('storm_cellar', 'Storm Cellar', 'epic', 2, ['survival', 'trigger'], [on('interval', 1, 0, 'shield', { amount: 0.1, every: 18 })]),
  U('second_opinion', 'Second Opinion', 'epic', 1, ['survival'], [mul('maxHp', 0.25), add('regen', 0.6)]),
  U('night_shift_nurse', 'Night-Shift Nurse', 'common', 5, ['survival', 'trigger'], [on('kill', 0.08, 0.4, 'heal', { amount: 0.01, frac: 1 })]),
  U('curbside_compost_bin', 'Curbside Compost Bin', 'rare', 3, ['survival', 'trigger'], [on('pickup', 0.04, 1, 'heal', { amount: 0.02, frac: 1 })]),
  U('certificate_of_occupancy', 'Certificate of Occupancy', 'rare', 1, ['survival', 'trigger'], [on('rankUp', 1, 0, 'heal', { amount: 0.4, frac: 1 })], { minRank: 0 }),
  U('emergency_exit_plan', 'Emergency Exit Plan', 'rare', 2, ['survival', 'mobility', 'trigger'], [add('iframes', 0.05), on('hurt', 1, 12, 'dashRefund')]),
  U('padded_bumpers', 'Padded Bumpers', 'common', 3, ['survival', 'trigger'], [mul('maxHp', 0.04), on('crush', 0.2, 0.5, 'heal', { amount: 0.01, frac: 1 })]),
];

const GROWTH_MOBILITY: UpgradeDef[] = [
  U('express_lane', 'Express Lane', 'common', 5, ['mobility'], [mul('moveSpeed', 0.07)]),
  U('carpool_permit', 'Carpool Permit', 'rare', 2, ['mobility'], [add('dashCharges', 1)]),
  U('green_wave', 'Green Wave', 'common', 5, ['mobility'], [mul('dashCooldown', -0.1)]),
  U('long_crosswalk', 'Long Crosswalk', 'common', 4, ['mobility'], [mul('dashDistance', 0.15)]),
  U('doggy_bag', 'Doggy Bag', 'common', 5, ['growth'], [mul('pickupRadius', 0.2)]),
  U('second_helping', 'Second Helping', 'common', 5, ['growth'], [mul('massGain', 0.06)]),
  U('continuing_ed_credits', 'Continuing-Ed Credits', 'common', 5, ['growth'], [mul('xpGain', 0.08)]),
  U('lucky_parking_spot', 'Lucky Parking Spot', 'rare', 3, ['growth'], [add('luck', 1)]),
  U('appeals_process', 'Appeals Process', 'rare', 3, ['growth'], [add('rerolls', 1)]),
  U('sinkhole_stride', 'Sinkhole Stride', 'rare', 3, ['mobility', 'trigger'], [on('dash', 1, 1, 'shockwave', { r: 1, dmg: 8 })]),
  U('jaywalkers_rhythm', "Jaywalker's Rhythm", 'common', 3, ['mobility', 'trigger'], [on('dash', 1, 4, 'frenzy', { stat: 'moveSpeed', mul: 0.15, dur: 2.5 })]),
  U('downspout_suction', 'Downspout Suction', 'rare', 3, ['growth', 'trigger'], [mul('pickupRadius', 0.1), on('interval', 1, 0, 'magnet', { r: 8, every: 10 })]),
  U('growth_spurt_memo', 'Growth Spurt Memo', 'epic', 2, ['growth', 'trigger'], [on('levelUp', 1, 0, 'mass', { amount: 1 })]),
  U('bulk_rate_postage', 'Bulk Rate Postage', 'rare', 3, ['growth', 'trigger'], [on('pickup', 0.05, 0.5, 'xp', { amount: 1 })]),
  U('road_diet', 'Road Diet', 'rare', 3, ['mobility', 'growth'], [mul('moveSpeed', 0.1), mul('massGain', 0.05)]),
  U('expedited_review', 'Expedited Review', 'epic', 2, ['growth'], [mul('xpGain', 0.15), add('luck', 1)]),
  U('speed_bump_waiver', 'Speed Bump Waiver', 'common', 4, ['mobility'], [mul('dashDistance', 0.1), mul('moveSpeed', 0.04)]),
  U('peak_commute', 'Peak Commute', 'rare', 2, ['mobility', 'trigger'], [mul('dashCooldown', -0.05), on('kill', 0.1, 2, 'dashRefund')]),
  U('oversize_load_permit', 'Oversize Load Permit', 'rare', 3, ['growth'], [mul('massGain', 0.1), mul('moveSpeed', -0.03)]),
  U('turn_lane_extension', 'Turn Lane Extension', 'epic', 1, ['mobility'], [add('dashCharges', 1), mul('dashDistance', 0.2)]),
  U('lost_and_found', 'Lost and Found', 'common', 4, ['growth', 'trigger'], [mul('xpGain', 0.04), on('crush', 0.25, 0.3, 'xp', { amount: 0.5 })]),
  U('commuter_pass', 'Commuter Pass', 'common', 4, ['mobility'], [mul('dashCooldown', -0.06), mul('moveSpeed', 0.03)]),
];

const OFFENSE: UpgradeDef[] = [
  U('rebar_molars', 'Rebar Molars', 'common', 5, ['offense'], [mul('damage', 0.08)]),
  U('overtime_shift', 'Overtime Shift', 'common', 5, ['offense'], [mul('attackRate', 0.07)]),
  U('long_arm_statute', 'Long-Arm Statute', 'common', 4, ['offense'], [mul('attackRange', 0.1)]),
  U('zoning_variance', 'Zoning Variance', 'common', 4, ['offense'], [mul('area', 0.1)]),
  U('code_violation', 'Code Violation', 'common', 5, ['offense'], [add('critChance', 0.04)]),
  U('double_citation', 'Double Citation', 'rare', 3, ['offense'], [add('critMult', 0.3)]),
  U('street_sweeper', 'Street Sweeper', 'common', 4, ['offense'], [mul('knockback', 0.2), mul('damage', 0.03)]),
  U('daisy_chain_extension_cord', 'Daisy-Chain Extension Cord', 'rare', 3, ['offense'], [add('chains', 1), mul('chainRange', 0.1)]),
  U('utility_easement', 'Utility Easement', 'rare', 3, ['offense', 'trigger'], [mul('chainRange', 0.2), on('hit', 0.04, 0.6, 'spark', { dmg: 5, chains: 1 })]),
  U('spare_parts_bin', 'Spare Parts Bin', 'rare', 3, ['offense', 'trigger'], [add('projectiles', 1), on('hit', 0.05, 0.8, 'rubbleShot', { count: 1, dmg: 6 })]),
  U('brownout', 'Brownout', 'rare', 3, ['offense', 'trigger'], [on('hit', 0.1, 0.5, 'spark', { dmg: 6, chains: 2 })]),
  U('substation_hum', 'Substation Hum', 'epic', 2, ['offense', 'trigger'], [on('interval', 1, 0, 'arc', { count: 2, dmg: 10, every: 3 })]),
  U('ticket_quota', 'Ticket Quota', 'rare', 3, ['offense', 'trigger'], [on('crit', 0.3, 1, 'rubbleShot', { count: 2, dmg: 8 })]),
  U('falling_facade_advisory', 'Falling Facade Advisory', 'epic', 2, ['offense', 'trigger'], [on('kill', 0.12, 1.5, 'meteor', { r: 4, dmg: 20, aoe: 0.6 })], { minRank: 1 }),
  U('mandatory_overtime', 'Mandatory Overtime', 'rare', 3, ['offense', 'trigger'], [on('kill', 0.15, 6, 'frenzy', { stat: 'attackRate', mul: 0.25, dur: 4 })]),
  U('pothole_report', 'Pothole Report', 'common', 4, ['offense', 'trigger'], [on('hit', 0.05, 0.3, 'shockwave', { r: 0.6, dmg: 5 })]),
  U('glass_ceiling', 'Glass Ceiling', 'rare', 3, ['offense'], [add('critChance', 0.03), add('critMult', 0.15)]),
  U('property_line_dispute', 'Property Line Dispute', 'common', 5, ['offense'], [mul('damage', 0.05), mul('area', 0.05)]),
  U('recall_notice', 'Recall Notice', 'epic', 2, ['offense', 'trigger'], [on('crit', 0.25, 1, 'arc', { count: 3, dmg: 8 })]),
  U('cease_and_desist', 'Cease and Desist', 'common', 4, ['offense'], [mul('attackRate', 0.04), mul('attackRange', 0.05)]),
  // generic hook (every titan's Space ability reads abilityCooldown / abilityPower)
  U('fast_track_permit', 'Fast-Track Permit', 'common', 4, ['offense', 'hook'], [mul('abilityCooldown', -0.07)]),
  U('public_address_system', 'Public Address System', 'common', 4, ['offense', 'hook'], [mul('abilityPower', 0.1)]),
  U('town_hall_rally', 'Town Hall Rally', 'rare', 3, ['offense', 'hook', 'trigger'], [on('ability', 1, 6, 'frenzy', { stat: 'damage', mul: 0.15, dur: 4 })]),
];

const SMASH: UpgradeDef[] = [
  U('wrecking_permit', 'Wrecking Permit', 'common', 5, ['smash'], [mul('smashDamage', 0.15)]),
  U('wide_load', 'Wide Load', 'common', 4, ['smash'], [mul('smashRadius', 0.1)]),
  U('condemnation_notice', 'Condemnation Notice', 'common', 5, ['smash'], [mul('buildingDamage', 0.12)]),
  U('faulty_wiring', 'Faulty Wiring', 'rare', 3, ['smash'], [add('sparkChance', 0.06)]),
  U('loose_masonry', 'Loose Masonry', 'rare', 3, ['smash', 'trigger'], [on('floorBreak', 0.15, 0.5, 'rubbleShot', { count: 2, dmg: 6 })]),
  U('eminent_domain', 'Eminent Domain', 'epic', 2, ['smash', 'trigger'], [on('collapse', 1, 0.5, 'shockwave', { r: 1.5, dmg: 18 })], { minRank: 1 }),
  U('salvage_rights', 'Salvage Rights', 'common', 3, ['smash', 'growth', 'trigger'], [on('collapse', 0.5, 0, 'mass', { amount: 1 })], { minRank: 1 }),
  U('scrap_dividend', 'Scrap Dividend', 'common', 4, ['smash', 'growth', 'trigger'], [on('floorBreak', 0.1, 0.2, 'xp', { amount: 1 })]),
  U('gas_main_rupture', 'Gas Main Rupture', 'rare', 3, ['smash', 'trigger'], [on('collapse', 0.35, 4, 'magma', { r: 0.8, dps: 6, dur: 4 })], { minRank: 1 }),
  U('community_garden', 'Community Garden', 'rare', 3, ['smash', 'trigger'], [mul('buildingDamage', 0.05), on('collapse', 0.3, 3, 'bloom', { dur: 16 })], { minRank: 1 }),
  U('cornerstone_ceremony', 'Cornerstone Ceremony', 'common', 4, ['smash', 'survival', 'trigger'], [on('collapse', 0.2, 0, 'heal', { amount: 0.04, frac: 1 })], { minRank: 1 }),
  U('load_test_failed', 'Load Test Failed', 'common', 4, ['smash'], [mul('smashDamage', 0.1), mul('buildingDamage', 0.06)]),
  U('permit_denied', 'Permit Denied', 'rare', 3, ['smash', 'trigger'], [on('smash', 0.06, 0.6, 'spark', { dmg: 5, chains: 1 })]),
  U('debris_field_advisory', 'Debris Field Advisory', 'epic', 2, ['smash', 'trigger'], [on('floorBreak', 0.08, 1.2, 'meteor', { r: 3, dmg: 16, aoe: 0.5 })], { minRank: 1 }),
  U('water_main_break', 'Water Main Break', 'rare', 3, ['smash', 'trigger'], [on('collapse', 0.4, 4, 'slowField', { r: 1.8, dur: 4, dps: 3 })], { minRank: 1 }),
  U('teardown_bonus', 'Teardown Bonus', 'rare', 3, ['smash', 'hook', 'trigger'], [on('collapse', 0.25, 4, 'cdReduce', { amount: 1.5 })], { minRank: 1 }),
  U('hairline_crack', 'Hairline Crack', 'common', 4, ['smash'], [mul('smashRadius', 0.06), mul('smashDamage', 0.08)]),
  U('curbside_buffet', 'Curbside Buffet', 'common', 3, ['smash', 'survival', 'trigger'], [on('smash', 0.03, 0.25, 'heal', { amount: 0.005, frac: 1 })]),
  U('emergency_rezoning', 'Emergency Rezoning', 'epic', 2, ['smash', 'trigger'], [on('collapse', 1, 8, 'frenzy', { stat: 'smashDamage', mul: 0.4, dur: 5 })], { minRank: 1 }),
  U('jackhammer_hours', 'Jackhammer Hours', 'rare', 3, ['smash', 'trigger'], [on('floorBreak', 0.12, 0.4, 'shockwave', { r: 0.8, dmg: 6 })]),
  U('groundbreaking_ceremony', 'Groundbreaking Ceremony', 'epic', 1, ['smash', 'trigger'], [on('rankUp', 1, 0, 'shockwave', { r: 3, dmg: 40 })]),
];

/** Legendary trade-off mutations: one stack, a big upside and a real cost. */
const MUTATIONS: UpgradeDef[] = [
  U('condemned_structure', 'Condemned Structure', 'legendary', 1, ['mutation', 'offense'], [mul('damage', 0.5), mul('maxHp', -0.25)]),
  U('unlicensed_growth', 'Unlicensed Growth', 'legendary', 1, ['mutation', 'growth'], [mul('massGain', 0.3), mul('area', 0.15), add('armor', -10)]),
  U('void_warranty', 'Void Warranty', 'legendary', 1, ['mutation', 'offense'], [add('critChance', 0.2), add('critMult', 0.5), add('regen', -0.3)]),
  U('rush_order', 'Rush Order', 'legendary', 1, ['mutation', 'offense', 'hook'], [mul('attackRate', 0.35), mul('abilityCooldown', 0.25)]),
  U('gutted_interior', 'Gutted Interior', 'legendary', 1, ['mutation', 'mobility'], [mul('moveSpeed', 0.25), add('dashCharges', 1), mul('maxHp', -0.15)]),
  U('bottomless_appetite', 'Bottomless Appetite', 'legendary', 1, ['mutation', 'growth'], [mul('pickupRadius', 0.6), mul('xpGain', 0.2), mul('damage', -0.15)]),
  U('curfew_in_effect', 'Curfew in Effect', 'legendary', 1, ['mutation', 'offense', 'trigger'], [mul('moveSpeed', -0.12), on('interval', 1, 0, 'shockwave', { r: 2, dmg: 25, every: 6 })]),
  U('municipal_lottery', 'Municipal Lottery', 'legendary', 1, ['mutation', 'growth'], [add('luck', 4), add('rerolls', 2), mul('damage', -0.1)]),
  U('wrecking_ball_diet', 'Wrecking Ball Diet', 'legendary', 1, ['mutation', 'smash'], [mul('smashDamage', 0.6), mul('smashRadius', 0.2), mul('attackRate', -0.2)]),
];

const T_MOLO: Opt = { titan: 'molo' };
const MOLO: UpgradeDef[] = [
  U('molo_hinge_variance', 'Hinge Variance', 'common', 4, ['kit', 'offense'], [add('biteCleave', 1)], T_MOLO),
  U('molo_curb_appetite', 'Curb Appetite', 'rare', 3, ['kit', 'offense'], [add('biteCleave', 1), mul('damage', 0.06)], T_MOLO),
  U('molo_heavy_tread_ordinance', 'Heavy Tread Ordinance', 'rare', 2, ['kit', 'offense'], [add('pulseEvery', -1)], T_MOLO),
  U('molo_storm_drain_throat', 'Storm Drain Throat', 'common', 4, ['kit', 'hook', 'growth'], [mul('vacuumRadius', 0.2)], T_MOLO),
  U('molo_bulk_intake_valve', 'Bulk Intake Valve', 'rare', 3, ['kit', 'hook'], [mul('vacuumRadius', 0.12), mul('abilityPower', 0.15)], T_MOLO),
  U('molo_aftershock_footing', 'Aftershock Footing', 'epic', 1, ['kit', 'offense'], [add('pulseEvery', -1), mul('area', 0.08)], T_MOLO),
  U('molo_gulp_reflex', 'Gulp Reflex', 'rare', 2, ['kit', 'hook', 'growth', 'trigger'], [mul('vacuumRadius', 0.1), on('ability', 1, 0, 'magnet', { r: 10 })], T_MOLO),
  U('molo_chew_cycle', 'Chew Cycle', 'common', 4, ['kit', 'offense'], [add('biteCleave', 0.5), mul('attackRate', 0.05)], T_MOLO),
  U('molo_belly_plating', 'Belly Plating', 'common', 4, ['kit', 'survival'], [add('armor', 6), mul('vacuumRadius', 0.06)], T_MOLO),
  U('molo_lawn_mower_gait', 'Lawn-Mower Gait', 'rare', 2, ['kit', 'smash'], [add('pulseEvery', -1), mul('smashDamage', 0.1)], T_MOLO),
  U('molo_greasy_spoon', 'Greasy Spoon', 'rare', 3, ['kit', 'hook', 'survival', 'trigger'], [mul('vacuumRadius', 0.08), on('ability', 1, 0, 'heal', { amount: 0.06, frac: 1 })], T_MOLO),
  U('molo_septic_burp', 'Septic Burp', 'epic', 2, ['kit', 'hook', 'trigger'], [mul('vacuumRadius', 0.05), on('ability', 1, 0, 'shockwave', { r: 2, dmg: 20 })], T_MOLO),
  U('molo_tailgate_sweep', 'Tailgate Sweep', 'common', 3, ['kit', 'offense'], [add('biteCleave', 1), mul('knockback', 0.2)], T_MOLO),
  U('molo_sinkhole_belly', 'Sinkhole Belly', 'epic', 2, ['kit', 'hook'], [mul('vacuumRadius', 0.15), mul('abilityCooldown', -0.1)], T_MOLO),
  U('molo_bite_radius_permit', 'Bite Radius Permit', 'legendary', 1, ['kit', 'mutation', 'offense'], [add('biteCleave', 2), mul('attackRange', 0.15), mul('attackRate', -0.1)], T_MOLO),
  U('molo_gravel_gizzard', 'Gravel Gizzard', 'common', 4, ['kit', 'survival'], [add('biteCleave', 0.5), add('rubbleHeal', 0.3)], T_MOLO),
];

const T_VK: Opt = { titan: 'voltkite' };
const VOLTKITE: UpgradeDef[] = [
  U('vk_extra_outlet', 'Extra Outlet', 'common', 4, ['kit', 'offense'], [add('arcForks', 1)], T_VK),
  U('vk_live_wire_permit', 'Live Wire Permit', 'common', 4, ['kit', 'mobility'], [add('wireDuration', 1)], T_VK),
  U('vk_high_voltage_easement', 'High-Voltage Easement', 'common', 5, ['kit', 'offense'], [mul('wireDamage', 0.2)], T_VK),
  U('vk_surge_protector', 'Surge Protector', 'rare', 3, ['kit', 'survival'], [mul('wireDamage', 0.1), add('armor', 4)], T_VK),
  U('vk_power_strip_splitter', 'Power Strip Splitter', 'rare', 3, ['kit', 'offense'], [add('arcForks', 1), mul('chainRange', 0.1)], T_VK),
  U('vk_static_cling', 'Static Cling', 'rare', 3, ['kit', 'mobility', 'trigger'], [mul('wireDamage', 0.05), on('dash', 1, 0.5, 'arc', { count: 2, dmg: 8 })], T_VK),
  U('vk_tripwire_ordinance', 'Tripwire Ordinance', 'epic', 2, ['kit', 'hook', 'mobility', 'trigger'], [add('wireDuration', 1), on('ability', 0.5, 3, 'dashRefund')], T_VK),
  U('vk_tripped_breaker', 'Tripped Breaker', 'common', 4, ['kit', 'offense'], [add('arcForks', 1), mul('damage', 0.04)], T_VK),
  U('vk_rolling_blackout', 'Rolling Blackout', 'common', 4, ['kit', 'mobility'], [mul('dashCooldown', -0.08), add('wireDuration', 0.5)], T_VK),
  U('vk_ground_fault', 'Ground Fault', 'rare', 3, ['kit', 'offense', 'trigger'], [mul('wireDamage', 0.12), on('kill', 0.1, 0.5, 'spark', { dmg: 6, chains: 2 })], T_VK),
  U('vk_meter_reader', 'Meter Reader', 'rare', 3, ['kit', 'hook', 'mobility', 'trigger'], [add('wireDuration', 0.5), on('ability', 1, 3, 'frenzy', { stat: 'moveSpeed', mul: 0.2, dur: 2 })], T_VK),
  U('vk_overhead_lines', 'Overhead Lines', 'legendary', 1, ['kit', 'mutation', 'offense'], [add('arcForks', 3), mul('attackRate', -0.12)], T_VK),
  U('vk_jumper_cables', 'Jumper Cables', 'epic', 2, ['kit', 'mobility', 'trigger'], [add('wireDuration', 0.5), on('dash', 0.35, 2, 'dashRefund')], T_VK),
  U('vk_transformer_bank', 'Transformer Bank', 'epic', 2, ['kit', 'hook'], [mul('wireDamage', 0.25), mul('abilityPower', 0.1)], T_VK),
  U('vk_mane_static', 'Mane Static', 'rare', 3, ['kit', 'offense'], [add('arcForks', 1), add('critChance', 0.03)], T_VK),
  U('vk_fuse_box', 'Fuse Box', 'common', 4, ['kit', 'mobility'], [add('wireDuration', 0.5), mul('wireDamage', 0.08), mul('dashDistance', 0.08)], T_VK),
];

const T_HB: Opt = { titan: 'hearthback' };
const HEARTHBACK: UpgradeDef[] = [
  U('hb_thick_crust', 'Thick Crust', 'common', 5, ['kit', 'hook'], [mul('shellCapacity', 0.2)], T_HB),
  U('hb_quick_set_concrete', 'Quick-Set Concrete', 'common', 3, ['kit', 'offense'], [add('stompDelay', -0.08)], T_HB),
  U('hb_open_burn_permit', 'Open Burn Permit', 'common', 4, ['kit', 'offense'], [add('magmaDuration', 1.5)], T_HB),
  U('hb_pressure_relief_valve', 'Pressure Relief Valve', 'rare', 3, ['kit', 'hook'], [mul('shellCapacity', 0.1), mul('abilityCooldown', -0.1)], T_HB),
  U('hb_slow_cooker', 'Slow Cooker', 'rare', 3, ['kit', 'survival'], [add('magmaDuration', 1), add('regen', 0.3)], T_HB),
  U('hb_boiler_code', 'Boiler Code', 'rare', 3, ['kit', 'survival'], [mul('shellCapacity', 0.15), add('armor', 6)], T_HB),
  U('hb_hot_asphalt', 'Hot Asphalt', 'common', 4, ['kit', 'offense'], [add('magmaDuration', 1), mul('area', 0.06)], T_HB),
  U('hb_thermal_vent', 'Thermal Vent', 'epic', 2, ['kit', 'hook', 'trigger'], [mul('shellCapacity', 0.05), on('ability', 1, 0, 'magma', { r: 1.5, dps: 12, dur: 4 })], T_HB),
  U('hb_heatstroke_advisory', 'Heatstroke Advisory', 'common', 4, ['kit', 'offense'], [add('stompDelay', -0.05), mul('attackRate', 0.06)], T_HB),
  U('hb_caldera_tax', 'Caldera Tax', 'rare', 3, ['kit', 'survival', 'trigger'], [mul('shellCapacity', 0.05), on('hurt', 0.2, 2, 'shockwave', { r: 1.5, dmg: 15 })], T_HB),
  U('hb_stockpot_dome', 'Stockpot Dome', 'epic', 2, ['kit', 'hook', 'survival', 'trigger'], [mul('shellCapacity', 0.1), on('ability', 1, 0, 'shield', { amount: 0.1 })], T_HB),
  U('hb_pumice_rain', 'Pumice Rain', 'epic', 2, ['kit', 'smash', 'trigger'], [add('magmaDuration', 0.5), on('floorBreak', 0.1, 1, 'meteor', { r: 3, dmg: 14, aoe: 0.5 })], T_HB),
  U('hb_fault_line_survey', 'Fault-Line Survey', 'rare', 3, ['kit', 'hook'], [add('stompDelay', -0.06), mul('abilityPower', 0.12)], T_HB),
  U('hb_kiln_fired_plating', 'Kiln-Fired Plating', 'legendary', 1, ['kit', 'mutation', 'survival'], [mul('shellCapacity', 0.6), add('armor', 15), mul('moveSpeed', -0.15)], T_HB),
  U('hb_seismic_hotspot', 'Seismic Hotspot', 'epic', 1, ['kit', 'offense'], [add('magmaDuration', 1), add('stompDelay', -0.04), mul('damage', 0.04)], T_HB),
  U('hb_obsidian_edge', 'Obsidian Edge', 'rare', 3, ['kit', 'offense'], [add('stompDelay', -0.05), add('critMult', 0.2)], T_HB),
];

const T_BW: Opt = { titan: 'briarwick' };
const BRIARWICK: UpgradeDef[] = [
  U('bw_extra_allotment', 'Extra Allotment', 'rare', 3, ['kit', 'smash'], [add('turretCap', 1)], T_BW),
  U('bw_fertilizer_runoff', 'Fertilizer Runoff', 'common', 5, ['kit', 'offense'], [mul('turretRate', 0.15)], T_BW),
  U('bw_high_pollen_count', 'High Pollen Count', 'common', 4, ['kit', 'survival'], [mul('sporeHeal', 0.25)], T_BW),
  U('bw_hedge_easement', 'Hedge Easement', 'common', 5, ['kit', 'offense'], [mul('vineLength', 0.12)], T_BW),
  U('bw_trellis_permit', 'Trellis Permit', 'common', 4, ['kit', 'offense'], [mul('vineLength', 0.08), mul('area', 0.06)], T_BW),
  U('bw_compost_heap', 'Compost Heap', 'common', 4, ['kit', 'survival'], [mul('sporeHeal', 0.15), add('rubbleHeal', 0.2)], T_BW),
  U('bw_seed_bank', 'Seed Bank', 'epic', 2, ['kit', 'smash'], [add('turretCap', 1), mul('turretRate', 0.05)], T_BW),
  U('bw_guerrilla_gardening', 'Guerrilla Gardening', 'rare', 3, ['kit', 'smash', 'trigger'], [mul('turretRate', 0.05), on('floorBreak', 0.1, 2, 'bloom', { dur: 14 })], T_BW),
  U('bw_overgrowth_ordinance', 'Overgrowth Ordinance', 'rare', 3, ['kit', 'hook', 'trigger'], [mul('sporeHeal', 0.1), on('ability', 1, 0, 'slowField', { r: 3, dur: 4 })], T_BW),
  U('bw_thorn_hedge', 'Thorn Hedge', 'common', 4, ['kit', 'survival'], [add('thorns', 0.35), mul('vineLength', 0.05)], T_BW),
  U('bw_root_network', 'Root Network', 'rare', 3, ['kit', 'offense'], [mul('turretRate', 0.1), mul('attackRate', 0.05)], T_BW),
  U('bw_greenhouse_effect', 'Greenhouse Effect', 'rare', 3, ['kit', 'survival'], [mul('sporeHeal', 0.2), add('regen', 0.3)], T_BW),
  U('bw_weed_ordinance_repealed', 'Weed Ordinance Repealed', 'legendary', 1, ['kit', 'mutation', 'smash'], [add('turretCap', 3), mul('turretRate', -0.15), mul('vineLength', -0.1)], T_BW),
  U('bw_bramble_whip', 'Bramble Whip', 'common', 4, ['kit', 'offense'], [mul('vineLength', 0.1), mul('damage', 0.05)], T_BW),
  U('bw_pollinator_corridor', 'Pollinator Corridor', 'epic', 2, ['kit', 'smash', 'trigger'], [mul('sporeHeal', 0.05), on('interval', 1, 0, 'bloom', { dur: 12, every: 12 })], T_BW),
  U('bw_mulch_delivery', 'Mulch Delivery', 'common', 3, ['kit', 'offense'], [mul('vineLength', 0.06), mul('knockback', 0.15)], T_BW),
];

export const UPGRADES: UpgradeDef[] = [
  ...SURVIVAL, ...GROWTH_MOBILITY, ...OFFENSE, ...SMASH, ...MUTATIONS,
  ...MOLO, ...VOLTKITE, ...HEARTHBACK, ...BRIARWICK,
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = {};
for (const u of UPGRADES) UPGRADE_BY_ID[u.id] = u;
