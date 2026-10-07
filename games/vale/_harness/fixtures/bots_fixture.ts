// Synthetic catalog for lane-BOTS probes. NOT content: every id is a placeholder (fx_*).
//
// The SIM fixtures (match_fixture.ts) are deliberately thin: one role, fighters with default ai hints,
// a handful of items. Bots need data to read, so this file builds a richer catalog on the same maps
// and units (reused from match_fixture.ts, unchanged) and validates it with the real zod schema:
//   roles     5 Rift roles carrying `assign` (top / jungle / mid / carry / support on the duo lane)
//   fighters  one per ai.style (frontline diver skirmisher artillery burst sustain warden marksman),
//             each with comboOrder and abilities whose ai hints cover every `use` tag the bots read
//             (minTargets, castWhenSelfHpBelow, castWhenTargetHpBelow, leadTarget), a telegraphed
//             delayed area (fx_seer_starfall) and skillshot projectiles to dodge
//   items     tiered recipes with tags (attack/crit/onhit/magic/defense/sustain/support/haste/speed/
//             jungle/vision), boots, consumables with actives, a pool-restricted item
//   setup     battle spells with ai hints (escape/gapclose, heal, execute, a monster-only smite,
//             a haste), boons on three paths
//   modes     fx_rift_mode (3 lanes + jungle, roles on) · fx_bridge_mode (one lane, buy on death /
//             at base, no recall) · fx_fray_mode (FFA, shared shop, 2 lives, its own item pool) ·
//             a practice queue on the rift mode
// Fixture ids may appear here and in probes; src/ never names them (probe_content_ids).

import { Catalog, type CatalogT } from '../../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../../src/contracts/sim.ts';
import { ability, fighter, item, mode, passive, queue, rawCatalog } from './catalog_fixture.ts';
import { FRAY_MAP, LANE_MAP, LANE_RULES, RIFT_MAP, TEAM_BUFFS, UNITS } from './match_fixture.ts';

type Raw = Record<string, unknown>;
const ICON = 'assets/fx/icon.png';

// ── roles ───────────────────────────────────────────────────────────────────────────────────────
export const ROLES: Raw[] = [
  { id: 'fx_role', name: 'Fx Role', contract: 'synthetic', icon: ICON, color: '#112233' },
  { id: 'fx_role_top', name: 'Fx Top', contract: 'holds the long lane', icon: ICON, color: '#aa3333', assign: { lane: 'fx_top', order: 0 } },
  { id: 'fx_role_jungle', name: 'Fx Wilds', contract: 'farms camps, takes objectives', icon: ICON, color: '#33aa33', assign: { lane: null, jungle: true, order: 1 } },
  { id: 'fx_role_mid', name: 'Fx Mid', contract: 'holds the short lane', icon: ICON, color: '#3333aa', assign: { lane: 'fx_mid', order: 2 } },
  { id: 'fx_role_carry', name: 'Fx Carry', contract: 'scales on the duo lane', icon: ICON, color: '#aaaa33', assign: { lane: 'fx_bot', order: 3 } },
  { id: 'fx_role_support', name: 'Fx Support', contract: 'protects the carry', icon: ICON, color: '#33aaaa', assign: { lane: 'fx_bot', support: true, order: 4 } },
];

// ── fighters (one per style) ────────────────────────────────────────────────────────────────────
const dmg = (amount: unknown, type = 'phys', extra: Raw = {}): Raw => ({ op: 'damage', amount, type, ...extra });
const status = (s: string, duration: number, extra: Raw = {}): Raw => ({ op: 'status', status: s, duration, ...extra });
const ALLY_SELF = { allies: true, enemies: false, self: true };

function styled(id: string, o: Raw, ai: Raw, roles: { role: string; secondaryRole?: string }, difficulty = 1): Raw {
  const f = fighter(id, o as Parameters<typeof fighter>[1]);
  return { ...f, role: roles.role, ...(roles.secondaryRole ? { secondaryRole: roles.secondaryRole } : {}), difficulty, ai, tags: ['fixture'] };
}

export const BOT_FIGHTERS: Raw[] = [
  styled('fx_bulwark', {
    base: { hp: 1250, hpRegen: 1.5, ad: 58, attackSpeed: 0.75, moveSpeed: 3.4, armor: 35, resist: 30 },
    growth: { hp: 100, hpRegen: 0.1, ad: 3.5, armor: 3.5, resist: 1.5 }, attack: { range: 1.6, windup: 0.3 },
    a1: ability('fx_bulwark_slam', [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self',
      onHit: [dmg({ base: [50, 80, 110], ad: 0.6 }), status('slow', 1.5)] }],
    { cooldown: [7, 6.5, 6], cost: 30, castTime: 0.15, ai: { use: ['damage', 'waveclear', 'cc'], minTargets: 1 } }),
    a2: ability('fx_bulwark_guard', [{ op: 'shield', amount: { base: [80, 120, 160], maxHp: 0.06 }, duration: 3, to: 'self' }],
      { cooldown: 12, cost: 40, targeting: { kind: 'self' }, ai: { use: ['shield'], castWhenSelfHpBelow: 0.7 } }),
    a3: ability('fx_bulwark_charge', [{ op: 'dash', mode: 'toPoint', distance: 7, speed: 16,
      onArrive: [{ op: 'area', shape: { kind: 'circle', radius: 2 }, at: 'self', onHit: [dmg(60), status('stun', 0.8)] }] }],
    { cooldown: 12, cost: 50, targeting: { kind: 'point', range: 7 }, ai: { use: ['engage', 'gapclose', 'cc'] } }),
    ult: ability('fx_bulwark_quake', [{ op: 'area', shape: { kind: 'circle', radius: 4.5 }, at: 'self',
      onHit: [dmg({ base: [150, 250, 350], ad: 0.5 }, 'magic'), { op: 'displace', mode: 'airborne_in_place', distance: 0, duration: 1 }] }],
    { cooldown: [80, 70, 60], cost: 100, maxRank: 3, castTime: 0.3, ai: { use: ['engage', 'cc', 'damage'], minTargets: 2 } }),
  }, { style: 'frontline', preferredRange: 1.6, comboOrder: ['a3', 'a1', 'ult', 'a2'] }, { role: 'fx_role_top', secondaryRole: 'fx_role_support' }, 1),

  styled('fx_archer', {
    base: { hp: 820, hpRegen: 0.8, ad: 62, attackSpeed: 0.85, moveSpeed: 3.35, armor: 18, resist: 20 },
    growth: { hp: 80, ad: 4, attackSpeed: 0.03 }, attack: { range: 5.5, windup: 0.22, projectileSpeed: 20 },
    a1: ability('fx_archer_volley', [{ op: 'projectile', speed: 22, range: 9, width: 0.8, onHit: [dmg({ base: [60, 95, 130], ad: 0.9 })] }],
      { cooldown: [6, 5.5, 5], cost: 35, castTime: 0.2, targeting: { kind: 'direction', range: 9 }, ai: { use: ['poke', 'damage'], leadTarget: true } }),
    a2: ability('fx_archer_focus', [{ op: 'buff', id: 'fx_archer_focus_b', duration: 4, stats: { attackSpeed: 0.4 }, to: 'self' }],
      { cooldown: 12, cost: 30, targeting: { kind: 'self' }, ai: { use: ['buff'] } }),
    a3: ability('fx_archer_roll', [{ op: 'dash', mode: 'toPoint', distance: 4, speed: 18 }],
      { cooldown: 10, cost: 30, targeting: { kind: 'point', range: 4 }, ai: { use: ['escape'] } }),
    ult: ability('fx_archer_longshot', [{ op: 'projectile', speed: 30, range: 25, width: 1.2,
      onHit: [dmg({ base: [200, 320, 440], ad: 1.2, targetMissingHp: 0.15 })] }],
    { cooldown: [70, 60, 50], cost: 100, maxRank: 3, castTime: 0.5, targeting: { kind: 'direction', range: 25 },
      ai: { use: ['execute', 'damage'], castWhenTargetHpBelow: 0.4, leadTarget: true } }),
  }, { style: 'marksman', preferredRange: 5.5, comboOrder: ['a1', 'a2', 'a3', 'ult'] }, { role: 'fx_role_carry' }, 2),

  styled('fx_seer', {
    base: { hp: 780, hpRegen: 0.8, ad: 50, attackSpeed: 0.7, moveSpeed: 3.3, armor: 15, resist: 25 },
    growth: { hp: 75, ad: 2.5 }, attack: { range: 5, windup: 0.25, projectileSpeed: 18, damageType: 'magic' },
    a1: ability('fx_seer_starfall', [{ op: 'area', shape: { kind: 'circle', radius: 2.2 }, at: 'point', delay: 0.6,
      present: { telegraph: 'everyone' }, onHit: [dmg({ base: [80, 125, 170], ap: 0.7 }, 'magic')] }],
    { cooldown: [5, 4.5, 4], cost: 45, castTime: 0.2, targeting: { kind: 'point', range: 9 },
      ai: { use: ['poke', 'damage', 'waveclear'], leadTarget: true, minTargets: 1 } }),
    a2: ability('fx_seer_bind', [{ op: 'projectile', speed: 16, range: 9, width: 0.9, onHit: [dmg(60, 'magic'), status('root', 1.2)] }],
      { cooldown: 11, cost: 60, castTime: 0.2, targeting: { kind: 'direction', range: 9 }, ai: { use: ['cc'], leadTarget: true } }),
    a3: ability('fx_seer_step', [{ op: 'blink', distance: 5, to: 'point' }],
      { cooldown: 16, cost: 50, targeting: { kind: 'point', range: 5 }, ai: { use: ['escape'] } }),
    ult: ability('fx_seer_vortex', [{ op: 'zone', id: 'fx_seer_vortex_z', shape: { kind: 'circle', radius: 3.5 }, at: 'point', duration: 3, interval: 0.5,
      onTick: [dmg({ base: [40, 60, 80], ap: 0.2 }, 'magic'), status('slow', 0.6)] }],
    { cooldown: [90, 75, 60], cost: 100, maxRank: 3, castTime: 0.3, targeting: { kind: 'point', range: 8 }, ai: { use: ['zone', 'damage'], minTargets: 2 } }),
  }, { style: 'artillery', preferredRange: 7, comboOrder: ['a2', 'a1', 'ult', 'a3'] }, { role: 'fx_role_mid' }, 2),

  styled('fx_blade', {
    base: { hp: 900, hpRegen: 1, ad: 66, attackSpeed: 0.8, moveSpeed: 3.5, armor: 22, resist: 22 },
    growth: { hp: 85, ad: 4.2 }, attack: { range: 1.5, windup: 0.28 },
    a1: ability('fx_blade_lunge', [{ op: 'dash', mode: 'toTarget', distance: 6, speed: 20, onArrive: [dmg({ base: [60, 95, 130], ad: 0.8 }, 'phys', { to: 'target' })] }],
      { cooldown: [8, 7, 6], cost: 40, targeting: { kind: 'unit', range: 6 }, ai: { use: ['gapclose', 'damage'] } }),
    a2: ability('fx_blade_whirl', [{ op: 'area', shape: { kind: 'circle', radius: 2.6 }, at: 'self', onHit: [dmg({ base: [55, 85, 115], ad: 0.6 })] }],
      { cooldown: 5, cost: 30, ai: { use: ['damage', 'waveclear'], minTargets: 1 } }),
    a3: ability('fx_blade_veil', [status('invisible', 2, { to: 'self' }), status('haste', 2, { to: 'self', power: 0.3 })],
      { cooldown: 18, cost: 40, targeting: { kind: 'self' }, ai: { use: ['escape'] } }),
    ult: ability('fx_blade_execute', [dmg({ base: [150, 250, 350], ad: 0.8, targetMissingHp: 0.25 }, 'phys', { to: 'target' })],
      { cooldown: [60, 50, 40], cost: 80, maxRank: 3, targeting: { kind: 'unit', range: 3 }, ai: { use: ['execute', 'damage'], castWhenTargetHpBelow: 0.5 } }),
  }, { style: 'burst', preferredRange: 1.5, comboOrder: ['a1', 'a2', 'ult', 'a3'] }, { role: 'fx_role_mid', secondaryRole: 'fx_role_jungle' }, 3),

  styled('fx_mender', {
    base: { hp: 800, hpRegen: 1, ad: 45, attackSpeed: 0.7, moveSpeed: 3.35, armor: 18, resist: 25 },
    growth: { hp: 75, ad: 2 }, attack: { range: 5, windup: 0.25, projectileSpeed: 18, damageType: 'magic' },
    a1: ability('fx_mender_mend', [{ op: 'heal', amount: { base: [70, 105, 140], ap: 0.4 }, to: 'target' }],
      { cooldown: [9, 8, 7], cost: 50, targeting: { kind: 'unit', range: 7, filter: ALLY_SELF }, ai: { use: ['heal'], castWhenTargetHpBelow: 0.65 } }),
    a2: ability('fx_mender_aegis', [{ op: 'shield', amount: 100, duration: 2.5, to: 'target' }],
      { cooldown: 12, cost: 50, targeting: { kind: 'unit', range: 7, filter: ALLY_SELF }, ai: { use: ['shield'], castWhenTargetHpBelow: 0.75 } }),
    a3: ability('fx_mender_snare', [{ op: 'projectile', speed: 17, range: 8, width: 0.9, onHit: [dmg(50, 'magic'), status('stun', 1)] }],
      { cooldown: 12, cost: 60, castTime: 0.2, targeting: { kind: 'direction', range: 8 }, ai: { use: ['cc'], leadTarget: true } }),
    ult: ability('fx_mender_grace', [{ op: 'area', shape: { kind: 'circle', radius: 6 }, at: 'self', filter: ALLY_SELF, onHit: [{ op: 'heal', amount: 200, to: 'hit' }] }],
      { cooldown: 80, cost: 100, maxRank: 3, ai: { use: ['heal'], minTargets: 2 } }),
  }, { style: 'warden', preferredRange: 6, comboOrder: ['a1', 'a3', 'a2', 'ult'] }, { role: 'fx_role_support' }, 1),

  styled('fx_hound', {
    base: { hp: 1050, hpRegen: 1.2, ad: 62, attackSpeed: 0.8, moveSpeed: 3.55, armor: 28, resist: 25 },
    growth: { hp: 95, ad: 3.8, armor: 3 }, attack: { range: 1.5, windup: 0.3 },
    a1: ability('fx_hound_pounce', [{ op: 'dash', mode: 'toPoint', distance: 6, speed: 18,
      onArrive: [{ op: 'area', shape: { kind: 'circle', radius: 2 }, at: 'self', onHit: [dmg({ base: [60, 90, 120], ad: 0.6 })] }] }],
    { cooldown: [9, 8, 7], cost: 40, targeting: { kind: 'point', range: 6 }, ai: { use: ['gapclose', 'engage', 'damage'] } }),
    a2: ability('fx_hound_maul', [{ op: 'area', shape: { kind: 'cone', radius: 3, angleDeg: 90 }, at: 'self',
      onHit: [dmg({ base: [50, 80, 110], ad: 0.7 }, 'phys', { monsterMult: 1.5 }), status('slow', 1)] }],
    { cooldown: 5, cost: 25, castTime: 0.1, targeting: { kind: 'direction', range: 3 }, ai: { use: ['damage', 'waveclear', 'cc'], minTargets: 1 } }),
    a3: ability('fx_hound_feast', [{ op: 'heal', amount: { base: [60, 90, 120], ad: 0.3 }, to: 'self' }],
      { cooldown: 12, cost: 40, targeting: { kind: 'self' }, ai: { use: ['heal'], castWhenSelfHpBelow: 0.55 } }),
    ult: ability('fx_hound_frenzy', [{ op: 'buff', id: 'fx_hound_frenzy_b', duration: 6, stats: { ad: 30, attackSpeed: 0.5 }, to: 'self' }],
      { cooldown: 60, cost: 80, maxRank: 3, targeting: { kind: 'self' }, ai: { use: ['buff', 'engage'] } }),
  }, { style: 'diver', preferredRange: 1.5, comboOrder: ['a1', 'a2', 'a3', 'ult'] }, { role: 'fx_role_jungle', secondaryRole: 'fx_role_top' }, 2),

  styled('fx_duelist', {
    base: { hp: 1000, hpRegen: 1.2, ad: 64, attackSpeed: 0.85, moveSpeed: 3.45, armor: 26, resist: 24, crit: 0.1 },
    growth: { hp: 90, ad: 4, armor: 3 }, attack: { range: 1.6, windup: 0.28 },
    a1: ability('fx_duelist_flurry', [{ op: 'buff', id: 'fx_duelist_flurry_b', duration: 5, to: 'self',
      empowerAttacks: { count: 3, effects: [dmg({ base: [25, 40, 55], ad: 0.3 })] } }],
    { cooldown: 7, cost: 25, targeting: { kind: 'self' }, ai: { use: ['damage', 'buff'] } }),
    a2: ability('fx_duelist_dash', [{ op: 'dash', mode: 'direction', distance: 4, speed: 18, passWidth: 1, onPass: [dmg(50)] }],
      { cooldown: 8, cost: 30, targeting: { kind: 'direction', range: 4 }, ai: { use: ['gapclose', 'escape', 'damage'] } }),
    a3: ability('fx_duelist_cleave', [{ op: 'area', shape: { kind: 'cone', radius: 3, angleDeg: 120 }, at: 'self', onHit: [dmg({ base: [70, 110, 150], ad: 0.8 })] }],
      { cooldown: 6, cost: 35, castTime: 0.15, targeting: { kind: 'direction', range: 3 }, ai: { use: ['damage', 'waveclear'], minTargets: 2 } }),
    ult: ability('fx_duelist_stand', [{ op: 'buff', id: 'fx_duelist_stand_b', duration: 6, stats: { armor: 40, resist: 30, ad: 25 }, to: 'self' }],
      { cooldown: 70, cost: 80, maxRank: 3, targeting: { kind: 'self' }, ai: { use: ['buff'], castWhenSelfHpBelow: 0.6 } }),
  }, { style: 'skirmisher', preferredRange: 1.6, comboOrder: ['a2', 'a1', 'a3', 'ult'] }, { role: 'fx_role_top', secondaryRole: 'fx_role_jungle' }, 2),

  styled('fx_leech', {
    base: { hp: 900, hpRegen: 1, ad: 52, attackSpeed: 0.7, moveSpeed: 3.35, armor: 20, resist: 28 },
    growth: { hp: 85, ad: 2.8 }, attack: { range: 4.5, windup: 0.25, projectileSpeed: 18, damageType: 'magic' },
    a1: ability('fx_leech_drain', [dmg({ base: [60, 90, 120], ap: 0.5 }, 'magic', { to: 'target' }), { op: 'heal', amount: { base: [30, 45, 60] }, to: 'self' }],
      { cooldown: [6, 5.5, 5], cost: 40, targeting: { kind: 'unit', range: 6 }, ai: { use: ['damage', 'heal'] } }),
    a2: ability('fx_leech_swarm', [{ op: 'zone', id: 'fx_leech_swarm_z', shape: { kind: 'circle', radius: 2.5 }, at: 'point', duration: 2.5, interval: 0.5,
      onTick: [dmg({ base: [20, 30, 40], ap: 0.1 }, 'magic')] }],
    { cooldown: 10, cost: 50, targeting: { kind: 'point', range: 8 }, ai: { use: ['zone', 'waveclear', 'damage'], minTargets: 2 } }),
    a3: ability('fx_leech_molt', [{ op: 'shield', amount: 120, duration: 2, to: 'self' }, status('haste', 2, { to: 'self', power: 0.35 })],
      { cooldown: 14, cost: 40, targeting: { kind: 'self' }, ai: { use: ['escape', 'shield'], castWhenSelfHpBelow: 0.45 } }),
    ult: ability('fx_leech_bloom', [{ op: 'area', shape: { kind: 'circle', radius: 4 }, at: 'self', onHit: [dmg({ base: [120, 200, 280], ap: 0.6 }, 'magic')] },
      { op: 'heal', amount: 150, to: 'self' }],
    { cooldown: 70, cost: 100, maxRank: 3, castTime: 0.2, ai: { use: ['damage', 'heal'], minTargets: 1 } }),
  }, { style: 'sustain', preferredRange: 4.5, comboOrder: ['a1', 'a2', 'ult', 'a3'] }, { role: 'fx_role_top', secondaryRole: 'fx_role_mid' }, 1),
];

/** the 5 v 5 role-correct lineups the probes use (index = seat within the team) */
export const RIFT_LINEUP: { fighter: string; role: string }[] = [
  { fighter: 'fx_duelist', role: 'fx_role_top' },
  { fighter: 'fx_hound', role: 'fx_role_jungle' },
  { fighter: 'fx_seer', role: 'fx_role_mid' },
  { fighter: 'fx_archer', role: 'fx_role_carry' },
  { fighter: 'fx_mender', role: 'fx_role_support' },
];
export const RIFT_LINEUP_B: { fighter: string; role: string }[] = [
  { fighter: 'fx_bulwark', role: 'fx_role_top' },
  { fighter: 'fx_blade', role: 'fx_role_jungle' },
  { fighter: 'fx_leech', role: 'fx_role_mid' },
  { fighter: 'fx_archer', role: 'fx_role_carry' },
  { fighter: 'fx_mender', role: 'fx_role_support' },
];

// ── items ───────────────────────────────────────────────────────────────────────────────────────
const potionUse = ability('fx_potion_drink', [{ op: 'heal', amount: 120, to: 'self' }],
  { cooldown: 1, maxRank: 1, targeting: { kind: 'self' }, ai: { use: ['heal'], castWhenSelfHpBelow: 0.5 } });
export const BOT_ITEMS: Raw[] = [
  item('fx_jungle_knife', { tier: 'starter', cost: 350, stats: { ad: 8, hpRegen: 1.5 }, tags: ['jungle', 'attack'] }),
  item('fx_starter_shield', { tier: 'starter', cost: 400, stats: { hp: 80, hpRegen: 2 }, tags: ['defense', 'sustain'] }),
  item('fx_dagger', { tier: 'basic', cost: 350, stats: { ad: 12 }, tags: ['attack'] }),
  item('fx_rod', { tier: 'basic', cost: 400, stats: { ap: 20 }, tags: ['magic'] }),
  item('fx_ruby', { tier: 'basic', cost: 400, stats: { hp: 150 }, tags: ['defense'] }),
  item('fx_plate', { tier: 'basic', cost: 300, stats: { armor: 15 }, tags: ['defense'] }),
  item('fx_cloak', { tier: 'basic', cost: 300, stats: { resist: 15 }, tags: ['defense'] }),
  item('fx_quick', { tier: 'basic', cost: 300, stats: { attackSpeed: 0.15 }, tags: ['attack', 'onhit'] }),
  item('fx_spark', { tier: 'basic', cost: 350, stats: { crit: 0.15 }, tags: ['crit'] }),
  item('fx_charm', { tier: 'basic', cost: 350, stats: { haste: 10, resRegen: 1 }, tags: ['haste'] }),
  item('fx_sickle', { tier: 'core', cost: 1300, components: ['fx_dagger', 'fx_dagger'], stats: { ad: 35, haste: 10 }, tags: ['attack', 'haste'] }),
  item('fx_bow', { tier: 'core', cost: 1400, components: ['fx_quick', 'fx_spark'], stats: { attackSpeed: 0.35, crit: 0.25 }, tags: ['attack', 'crit', 'onhit'] }),
  item('fx_tome', { tier: 'core', cost: 1350, components: ['fx_rod', 'fx_charm'], stats: { ap: 50, haste: 15 }, tags: ['magic', 'haste'] }),
  item('fx_aegis', { tier: 'core', cost: 1300, components: ['fx_ruby', 'fx_plate'], stats: { hp: 300, armor: 30 }, tags: ['defense'] }),
  item('fx_veil', { tier: 'core', cost: 1300, components: ['fx_ruby', 'fx_cloak'], stats: { hp: 300, resist: 30 }, tags: ['defense'] }),
  item('fx_vamp', { tier: 'core', cost: 1250, components: ['fx_dagger', 'fx_ruby'], stats: { ad: 25, hp: 150, lifesteal: 0.12 }, tags: ['attack', 'sustain'] }),
  item('fx_censer', { tier: 'core', cost: 1200, components: ['fx_rod', 'fx_ruby'], stats: { ap: 30, hp: 200, healShieldPower: 0.15 }, tags: ['support', 'magic'] }),
  item('fx_reaper', { tier: 'apex', cost: 3000, components: ['fx_sickle', 'fx_dagger'], stats: { ad: 70, armorPen: 15 }, tags: ['attack'] }),
  item('fx_storm', { tier: 'apex', cost: 3000, components: ['fx_bow', 'fx_dagger'], stats: { ad: 30, attackSpeed: 0.5, crit: 0.35 }, tags: ['attack', 'crit', 'onhit'] }),
  item('fx_orb', { tier: 'apex', cost: 3000, components: ['fx_tome', 'fx_rod'], stats: { ap: 110, magicPenPct: 0.2 }, tags: ['magic'] }),
  item('fx_bastion', { tier: 'apex', cost: 2900, components: ['fx_aegis', 'fx_veil'], stats: { hp: 600, armor: 50, resist: 50 }, tags: ['defense'] }),
  item('fx_boots_a', { tier: 'boots', cost: 300, stats: { moveSpeed: 0.5 }, uniqueGroup: 'fx_boots', tags: ['speed'] }),
  item('fx_boots_b', { tier: 'boots', cost: 900, components: ['fx_boots_a'], stats: { moveSpeed: 1, attackSpeed: 0.15 }, uniqueGroup: 'fx_boots', tags: ['speed', 'attack'] }),
  item('fx_boots_c', { tier: 'boots', cost: 900, components: ['fx_boots_a'], stats: { moveSpeed: 1, haste: 15 }, uniqueGroup: 'fx_boots', tags: ['speed', 'haste', 'magic'] }),
  item('fx_potion', { tier: 'consumable', cost: 50, consumable: { charges: 1, maxStack: 5 }, active: potionUse, tags: ['sustain'] }),
  item('fx_ward_item', { tier: 'basic', cost: 75, tags: ['vision'],
    active: ability('fx_ward_place', [{ op: 'summon', unit: 'fx_eye_ward', duration: 60, at: 'point' }],
      { cooldown: 30, maxRank: 1, targeting: { kind: 'point', range: 8 }, ai: { use: ['vision'] } }) }),
  // cheap and strong: a bot that ignored rules.itemPool would buy it in Fray, where its pool is not sold
  item('fx_rift_only', { tier: 'basic', cost: 300, stats: { ad: 25, ap: 30, hp: 150 }, pools: ['fx_pool'], tags: ['attack', 'magic', 'defense'] }),
];

// ── battle spells + boons ───────────────────────────────────────────────────────────────────────
export const BOT_SPELLS: Raw[] = [
  ability('fx_spell_blink', [{ op: 'blink', distance: 5 }], { cooldown: 60, maxRank: 1, targeting: { kind: 'point', range: 5 }, ai: { use: ['escape', 'gapclose'] } }),
  ability('fx_spell_heal', [{ op: 'heal', amount: { base: 120, level: 15 }, to: 'self' }],
    { cooldown: 90, maxRank: 1, targeting: { kind: 'self' }, ai: { use: ['heal'], castWhenSelfHpBelow: 0.35 } }),
  ability('fx_spell_burn', [dmg({ base: 80, level: 20 }, 'true', { to: 'target' }), status('grievous', 3, { to: 'target' })],
    { cooldown: 90, maxRank: 1, targeting: { kind: 'unit', range: 6 }, ai: { use: ['execute', 'damage'], castWhenTargetHpBelow: 0.3 } }),
  ability('fx_spell_smite', [dmg({ base: 450, level: 20 }, 'true', { to: 'target' })],
    { cooldown: 60, maxRank: 1, targeting: { kind: 'unit', range: 3, filter: { fighters: false, minions: true, monsters: true, summons: true } },
      ai: { use: ['execute'] } }),
  ability('fx_spell_ghost', [status('haste', 4, { to: 'self', power: 0.4 })],
    { cooldown: 80, maxRank: 1, targeting: { kind: 'self' }, ai: { use: ['escape', 'buff'] } }),
];
export const BOT_BOONS: Raw[] = [
  { ...passive('fx_boon_edge', [], { stats: { ad: 6, attackSpeed: 0.05 } }), path: 'fx_path_might' },
  { ...passive('fx_boon_focus', [], { stats: { ap: 12, haste: 5 } }), path: 'fx_path_arcane' },
  { ...passive('fx_boon_stone', [], { stats: { armor: 6, resist: 6, hp: 40 } }), path: 'fx_path_guard' },
  { ...passive('fx_boon_vigor', [], { stats: { hpRegen: 1.5, hp: 60 } }), path: 'fx_path_guard' },
  { ...passive('fx_boon_reach', [], { stats: { range: 0.3, crit: 0.05 } }), path: 'fx_path_might' },
];
const PATHS = [
  { id: 'fx_path_might', name: 'Fx Might', desc: 'synthetic', color: '#aa4444', icon: ICON },
  { id: 'fx_path_arcane', name: 'Fx Arcane', desc: 'synthetic', color: '#4444aa', icon: ICON },
  { id: 'fx_path_guard', name: 'Fx Guard', desc: 'synthetic', color: '#44aa44', icon: ICON },
];

// ── rules / modes / queues ──────────────────────────────────────────────────────────────────────
const strip = (r: Raw): Raw => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined));
export const RIFT_RULES: Raw = {
  ...LANE_RULES, maxLevel: 18,
  xpTable: [280, 380, 480, 580, 680, 780, 880, 980, 1080, 1180, 1280, 1380, 1480, 1580, 1680, 1780, 1880],
  abilityRanks: { basicMax: 3, ultLevels: [6, 11, 16] },
  respawn: { base: 6, perLevel: 1.5, max: 35, lateGameRampAt: 900, lateGameMult: 1.3 },
  recallTime: 6,
  minionWaves: { first: 15, interval: 30, upgradeEvery: 120, composition: [
    { unit: 'fx_lane_minion', count: 3 }, { unit: 'fx_ranged_minion', count: 3 }, { unit: 'fx_siege_minion', count: 1, everyNth: 3 }] },
  surrender: undefined,
};
export const BRIDGE_RULES: Raw = {
  ...LANE_RULES, startGold: 1200, passiveGoldPerSec: 4, passiveGoldStart: 0, shopAccess: 'base_or_dead', recall: false,
  jungle: false, surrender: undefined, respawn: { base: 6, perLevel: 1, max: 25 },
};
export const FRAY_RULES: Raw = {
  ...LANE_RULES, minionWaves: undefined, structures: false, jungle: false, shopAccess: 'shops', recall: false, fountainHeals: false,
  surrender: undefined, startGold: 800, passiveGoldPerSec: 5, passiveGoldStart: 0, itemPool: 'fx_fray_pool',
  respawn: { base: 4, perLevel: 0, max: 10 },
  end: { kind: 'last_standing_or_score', lives: 2, killScore: 5, timeLimit: 300 },
  placementPoints: [10, 7, 5, 3, 2, 1],
};

export interface BotCatalogPatch { riftRules?: Raw; bridgeRules?: Raw; frayRules?: Raw }

/** the zod-validated bots catalog */
export function botCatalog(p: BotCatalogPatch = {}): CatalogT {
  const raw = rawCatalog({
    fighters: BOT_FIGHTERS,
    units: UNITS,
    items: BOT_ITEMS,
    spells: BOT_SPELLS,
    boons: BOT_BOONS,
    teamBuffs: TEAM_BUFFS,
    maps: [LANE_MAP, FRAY_MAP, RIFT_MAP],
    skins: BOT_FIGHTERS.flatMap((f) => [1, 2].map((k) => ({
      id: `${f.id as string}_alt${k}`, fighter: f.id, name: `Fx Alt ${k}`, tier: 'standard', model: 'assets/fx/f2.glb',
      portrait: 'assets/fx/p2.png', splash: 'assets/fx/s2.png', releasedIn: '2026.10.0',
    }))),
    modes: [
      mode('fx_rift_mode', 'fx_rift_map', strip({ ...RIFT_RULES, ...(p.riftRules ?? {}) }), { roles: true, pick: 'draft' }),
      mode('fx_bridge_mode', 'fx_lane_map', strip({ ...BRIDGE_RULES, ...(p.bridgeRules ?? {}) }), { perTeam: 5, pick: 'random_bench' }),
      mode('fx_fray_mode', 'fx_fray_map', strip({ ...FRAY_RULES, ...(p.frayRules ?? {}) }), { teams: 6, perTeam: 1, pick: 'ffa_pick',
        playerColors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'] }),
    ],
    queues: [
      queue('fx_rift_q', 'fx_rift_mode', 'standard', { draft: { bansPerTeam: 2, pickSeconds: 30, banSeconds: 20, finalizeSeconds: 20 } }),
      queue('fx_bridge_q', 'fx_bridge_mode', 'standard', { bench: { size: 4, rerolls: 1 } }),
      queue('fx_fray_q', 'fx_fray_mode'),
      queue('fx_rift_practice', 'fx_rift_mode', 'practice', { partyMax: 1, bots: { fill: 'none', difficulty: 'adept' } }),
    ],
  });
  raw.roles = ROLES;
  const setup = raw.setup as Raw;
  setup.paths = PATHS;
  setup.boonSlots = 2;
  setup.defaults = { spells: ['fx_spell_blink', 'fx_spell_heal'], boons: ['fx_boon_edge'] };
  const r = Catalog.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`bots fixture catalog failed schema validation:\n${msg}`);
  }
  return r.data;
}

// ── setups ──────────────────────────────────────────────────────────────────────────────────────
export type Difficulty = NonNullable<SeatSetup['botDifficulty']>;
export interface BSeat { fighter: string; team: number; role?: string; controller?: 'human' | 'bot'; difficulty?: Difficulty; spells?: string[]; boons?: string[]; skin?: string }

export function botSetup(modeId: string, queueId: string, mapId: string, seats: BSeat[], o: { seed?: number; difficulty?: Difficulty } = {}): MatchSetup {
  return {
    matchId: 'fx_bots', seed: o.seed ?? 4242, queue: queueId, mode: modeId, map: mapId, catalogVersion: '2026.10.0',
    seats: seats.map((s, i): SeatSetup => ({
      player: i, team: s.team, name: `B${i}`, fighter: s.fighter, skin: s.skin ?? `${s.fighter}_skin`, role: s.role,
      loadout: { spells: s.spells ?? ['fx_spell_blink', 'fx_spell_heal'], boons: s.boons ?? [] },
      controller: s.controller ?? 'bot', botDifficulty: s.difficulty ?? o.difficulty ?? 'adept', colorIndex: i,
    })),
  };
}

/** Rift 5 v 5 with role-correct lineups (team 0 RIFT_LINEUP, team 1 RIFT_LINEUP_B) */
export function riftBotSetup(o: { seed?: number; difficulty?: Difficulty; difficulties?: [Difficulty, Difficulty]; spells?: (fighter: string, role: string) => string[] } = {}): MatchSetup {
  const seats: BSeat[] = [];
  for (const team of [0, 1]) {
    const lineup = team === 0 ? RIFT_LINEUP : RIFT_LINEUP_B;
    for (const s of lineup) {
      seats.push({ fighter: s.fighter, team, role: s.role, difficulty: o.difficulties ? o.difficulties[team] : o.difficulty,
        spells: o.spells ? o.spells(s.fighter, s.role) : s.role === 'fx_role_jungle' ? ['fx_spell_smite', 'fx_spell_blink'] : ['fx_spell_blink', 'fx_spell_heal'] });
    }
  }
  return botSetup('fx_rift_mode', 'fx_rift_q', 'fx_rift_map', seats, o);
}
export function bridgeBotSetup(n = 5, o: { seed?: number; difficulty?: Difficulty } = {}): MatchSetup {
  const pool = BOT_FIGHTERS.map((f) => f.id as string);
  const seats: BSeat[] = [];
  for (let i = 0; i < n * 2; i++) seats.push({ fighter: pool[(i * 3 + (i >= n ? 1 : 0)) % pool.length], team: i < n ? 0 : 1 });
  return botSetup('fx_bridge_mode', 'fx_bridge_q', 'fx_lane_map', seats, o);
}
export function frayBotSetup(n = 6, o: { seed?: number; difficulty?: Difficulty; humans?: number[] } = {}): MatchSetup {
  const pool = BOT_FIGHTERS.map((f) => f.id as string);
  return botSetup('fx_fray_mode', 'fx_fray_q', 'fx_fray_map', Array.from({ length: n }, (_, i) => ({
    fighter: pool[(i * 5 + 1) % pool.length], team: i, controller: o.humans?.includes(i) ? 'human' as const : 'bot' as const,
    spells: ['fx_spell_blink', 'fx_spell_heal'],
  })), o);
}
