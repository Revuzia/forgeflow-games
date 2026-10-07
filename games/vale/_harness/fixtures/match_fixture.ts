// Synthetic MATCH catalog for lane-SIM probes (systems + facade). NOT content: every id is a
// placeholder (fx_*). Built on catalog_fixture.ts and validated by the real zod Catalog schema.
//
// Maps
//   fx_lane_map   120×40, one lane along y = 20. Per team: tower → gate (respawns) → core, chained
//                 by `requires`. A beast camp (south), an objective boss camp (north), a heal orb.
//   fx_fray_map   50×50 FFA arena: 6-point spawn ring, a centre pillar, one shared shop, pickups.
//   fx_rift_map   140×140, three lanes, 2 towers + gate per lane per team, cores, 4 camps (perf).
// Modes / queues
//   fx_lane_mode  'core' on fx_lane_map  · queues fx_lane_q (standard), fx_lane_practice (practice),
//                 fx_lane_fast (queue rules override goldMult/xpMult)
//   fx_fray_mode  'last_standing_or_score' on fx_fray_map (6 seats, lives 2, killScore 4, 240 s)
//   fx_score_mode 'score' on fx_lane_map (killScore 3, 90 s)
//   fx_rift_mode  'core' on fx_rift_map (perf)

import type { CatalogT } from '../../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../../src/contracts/sim.ts';
import { ability, buildCatalog, fighter, item, mode, passive, queue, unit } from './catalog_fixture.ts';

type Raw = Record<string, unknown>;
const ART = {
  scene: 'assets/fx/scene.glb', sky: 'assets/fx/sky.hdr', lut: 'assets/fx/lut.cube', minimap: 'assets/fx/mm.png',
  lighting: { sunDir: [0, 1, 0], sunColor: '#ffffff', sunIntensity: 1, ambient: 0.3, fogColor: '#000000', fogDensity: 0, exposure: 1 },
  music: 'fx_music',
};
const CAMERA = { pitchDeg: 55, fovDeg: 40, distance: 20, minDistance: 10, maxDistance: 30 };

// ── maps ────────────────────────────────────────────────────────────────────────────────────────
export const LANE_MAP: Raw = {
  id: 'fx_lane_map', name: 'Fx Lane', desc: 'synthetic', size: [120, 40], navCell: 0.5,
  walls: [[[54, 26], [66, 26], [66, 29], [54, 29]], [[54, 11], [66, 11], [66, 14], [54, 14]]],
  thickets: [[[44, 30], [50, 30], [50, 36], [44, 36]]],
  lanes: [{ id: 'fx_lane', name: 'Fx Lane', path: [[15, 20], [60, 20], [105, 20]] }],
  bases: [
    { team: 0, spawn: [5, 20], fountain: { at: [3, 20], radius: 4 }, shop: { at: [3, 20], radius: 6 } },
    { team: 1, spawn: [115, 20], fountain: { at: [117, 20], radius: 4 }, shop: { at: [117, 20], radius: 6 } },
  ],
  structures: [
    { id: 'fx_t0_tower', unit: 'fx_lane_tower', team: 0, lane: 'fx_lane', at: [38, 20] },
    { id: 'fx_t0_gate', unit: 'fx_gate', team: 0, lane: 'fx_lane', at: [22, 22], requires: ['fx_t0_tower'], respawn: 40 },
    { id: 'fx_t0_core', unit: 'fx_core', team: 0, at: [10, 20], requires: ['fx_t0_gate'] },
    { id: 'fx_t1_tower', unit: 'fx_lane_tower', team: 1, lane: 'fx_lane', at: [82, 20] },
    { id: 'fx_t1_gate', unit: 'fx_gate', team: 1, lane: 'fx_lane', at: [98, 22], requires: ['fx_t1_tower'], respawn: 40 },
    { id: 'fx_t1_core', unit: 'fx_core', team: 1, at: [110, 20], requires: ['fx_t1_gate'] },
  ],
  camps: [
    { id: 'fx_camp_beasts', units: [{ unit: 'fx_beast', at: [60, 6] }, { unit: 'fx_beast', at: [62, 7] }], firstSpawn: 10, respawn: 30 },
    { id: 'fx_camp_boss', units: [{ unit: 'fx_boss', at: [60, 34] }], firstSpawn: 15, respawn: 60, objective: true },
  ],
  pickups: [{ id: 'fx_orb_spot', unit: 'fx_heal_orb', at: [60, 17], firstSpawn: 5, respawn: 20 }],
  art: ART, camera: CAMERA,
};

const ring = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2;
  return [Math.round((25 + Math.cos(a) * 17) * 100) / 100, Math.round((25 + Math.sin(a) * 17) * 100) / 100];
});
export const FRAY_MAP: Raw = {
  id: 'fx_fray_map', name: 'Fx Arena', desc: 'synthetic', size: [50, 50], navCell: 0.5,
  walls: [[[23, 23], [27, 23], [27, 27], [23, 27]]],
  thickets: [],
  lanes: [],
  bases: [],
  spawns: ring,
  shops: [{ at: [25, 31], radius: 4 }],
  pickups: [{ id: 'fx_fray_orb', unit: 'fx_heal_orb', at: [25, 18], firstSpawn: 0, respawn: 15 }],
  art: ART, camera: CAMERA,
};

function lane3(): Raw {
  const S = 140;
  const st: Raw[] = [];
  const add = (id: string, u: string, team: number, at: number[], requires: string[] = [], respawn?: number): void => {
    st.push({ id, unit: u, team, at, requires, ...(respawn ? { respawn } : {}) });
  };
  for (const team of [0, 1]) {
    const m = (p: number[]): number[] => team === 0 ? p : [S - p[0], S - p[1]];
    const t = `fx_r${team}`;
    add(`${t}_top_outer`, 'fx_lane_tower', team, m([14, 80]));
    add(`${t}_top_inner`, 'fx_lane_tower', team, m([14, 50]), [`${t}_top_outer`]);
    add(`${t}_top_gate`, 'fx_gate', team, m([16, 30]), [`${t}_top_inner`], 60);
    add(`${t}_mid_outer`, 'fx_lane_tower', team, m([52, 52]));
    add(`${t}_mid_inner`, 'fx_lane_tower', team, m([38, 38]), [`${t}_mid_outer`]);
    add(`${t}_mid_gate`, 'fx_gate', team, m([27, 27]), [`${t}_mid_inner`], 60);
    add(`${t}_bot_outer`, 'fx_lane_tower', team, m([80, 14]));
    add(`${t}_bot_inner`, 'fx_lane_tower', team, m([50, 14]), [`${t}_bot_outer`]);
    add(`${t}_bot_gate`, 'fx_gate', team, m([30, 16]), [`${t}_bot_inner`], 60);
    add(`${t}_core`, 'fx_core', team, m([12, 12]), [`${t}_top_gate`, `${t}_mid_gate`, `${t}_bot_gate`]);
  }
  return {
    id: 'fx_rift_map', name: 'Fx Rift', desc: 'synthetic', size: [S, S], navCell: 0.5,
    walls: [
      [[30, 60], [45, 60], [45, 75], [30, 75]], [[60, 30], [75, 30], [75, 45], [60, 45]],
      [[95, 65], [110, 65], [110, 80], [95, 80]], [[65, 95], [80, 95], [80, 110], [65, 110]],
    ],
    thickets: [[[50, 85], [58, 85], [58, 92], [50, 92]], [[82, 48], [90, 48], [90, 55], [82, 55]]],
    lanes: [
      { id: 'fx_top', name: 'Top', path: [[14, 22], [14, 126], [118, 126]] },
      { id: 'fx_mid', name: 'Mid', path: [[22, 22], [118, 118]] },
      { id: 'fx_bot', name: 'Bot', path: [[22, 14], [126, 14], [126, 118]] },
    ],
    bases: [
      { team: 0, spawn: [6, 6], fountain: { at: [4, 4], radius: 4 }, shop: { at: [4, 4], radius: 6 } },
      { team: 1, spawn: [134, 134], fountain: { at: [136, 136], radius: 4 }, shop: { at: [136, 136], radius: 6 } },
    ],
    structures: st,
    camps: [
      { id: 'fx_rc_a', units: [{ unit: 'fx_beast', at: [40, 90] }, { unit: 'fx_beast', at: [42, 92] }], firstSpawn: 20, respawn: 40 },
      { id: 'fx_rc_b', units: [{ unit: 'fx_beast', at: [100, 50] }, { unit: 'fx_beast', at: [98, 48] }], firstSpawn: 20, respawn: 40 },
      { id: 'fx_rc_c', units: [{ unit: 'fx_beast', at: [90, 30] }], firstSpawn: 20, respawn: 40 },
      { id: 'fx_rc_boss', units: [{ unit: 'fx_boss', at: [100, 100] }], firstSpawn: 60, respawn: 120, objective: true },
    ],
    art: ART, camera: CAMERA,
  };
}
export const RIFT_MAP = lane3();

// ── units ───────────────────────────────────────────────────────────────────────────────────────
export const UNITS: Raw[] = [
  unit('fx_lane_minion', 'minion', { base: { hp: 300, ad: 14, attackSpeed: 0.8, moveSpeed: 3.2 }, growth: { hp: 20, ad: 2 },
    attack: { range: 1.2, windup: 0.3 }, bounty: { gold: 20, xp: 30 } }),
  unit('fx_ranged_minion', 'minion', { base: { hp: 220, ad: 18, attackSpeed: 0.7, moveSpeed: 3.2 },
    attack: { range: 5, windup: 0.3, projectileSpeed: 18 }, bounty: { gold: 15, xp: 25 } }),
  unit('fx_siege_minion', 'minion', { base: { hp: 700, ad: 30, attackSpeed: 0.6, moveSpeed: 3 }, collisionRadius: 0.6,
    attack: { range: 6, windup: 0.3, projectileSpeed: 16 }, bounty: { gold: 60, xp: 60 }, behavior: { damageMult: { structure: 2 } } }),
  unit('fx_lane_tower', 'structure', { base: { hp: 2500, ad: 120, attackSpeed: 0.8, armor: 40, moveSpeed: 0 }, collisionRadius: 1,
    attack: { range: 7, windup: 0.2, projectileSpeed: 25 }, bounty: { gold: 150, goldGlobal: 50, xp: 100 }, sightRange: 12 }),
  unit('fx_gate', 'structure', { base: { hp: 1500, armor: 20, moveSpeed: 0, attackSpeed: 0, ad: 0 }, collisionRadius: 1.2,
    bounty: { gold: 0, goldGlobal: 40, xp: 50 }, behavior: { targetRules: 'none' } }),
  unit('fx_core', 'structure', { base: { hp: 3000, armor: 20, moveSpeed: 0, attackSpeed: 0, ad: 0 }, collisionRadius: 2,
    bounty: { gold: 0, xp: 0 }, behavior: { targetRules: 'none' } }),
  unit('fx_beast', 'monster', { base: { hp: 900, ad: 25, attackSpeed: 0.8, moveSpeed: 3 }, attack: { range: 1.2, windup: 0.3 },
    bounty: { gold: 60, xp: 80 }, behavior: { leash: 7 } }),
  unit('fx_boss', 'monster', { base: { hp: 3000, ad: 50, attackSpeed: 0.7, moveSpeed: 3, armor: 30 }, collisionRadius: 1.2,
    attack: { range: 2, windup: 0.4 }, bounty: { gold: 100, goldGlobal: 100, xp: 200 }, behavior: { leash: 9 }, onTakedownTeamBuff: 'fx_boss_buff',
    abilities: [ability('fx_boss_slam', [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self', onHit: [{ op: 'damage', amount: 40, type: 'magic' }] }],
      { cooldown: 6, ai: { use: ['damage'] } })] }),
  unit('fx_heal_orb', 'pickup', { base: { hp: 1, moveSpeed: 0, attackSpeed: 0, ad: 0 }, collisionRadius: 0.6,
    behavior: { grant: [{ op: 'heal', amount: 200, to: 'self' }, { op: 'gold', amount: 10 }], gold: 25 } }),
  unit('fx_wolf', 'summon', { base: { hp: 400, ad: 20, attackSpeed: 1, moveSpeed: 4 }, attack: { range: 1, windup: 0.25 },
    bounty: { gold: 10, xp: 10 } }),
  unit('fx_eye_ward', 'ward', { base: { hp: 3, moveSpeed: 0, attackSpeed: 0, ad: 0 }, collisionRadius: 0.3, sightRange: 9,
    bounty: { gold: 15, xp: 0 }, behavior: { invisible: true } }),
  unit('fx_training_dummy', 'minion', { base: { hp: 5000, moveSpeed: 0, attackSpeed: 0, ad: 0 }, collisionRadius: 0.6,
    behavior: { dummy: true } }),
];

export const TEAM_BUFFS: Raw[] = [
  { id: 'fx_boss_buff', name: 'Fx Boss Buff', desc: 'synthetic', icon: 'assets/fx/icon.png', duration: 90,
    stats: { ad: 15 }, minionStats: { ad: 10, hp: 100 } },
];

// ── items ───────────────────────────────────────────────────────────────────────────────────────
const heal100 = ability('fx_potion_use', [{ op: 'heal', amount: 100, to: 'self' }], { cooldown: 0, maxRank: 1, ai: { use: ['heal'] } });
export const ITEMS: Raw[] = [
  item('fx_sword', { tier: 'basic', cost: 400, stats: { ad: 15 } }),
  item('fx_gem', { tier: 'basic', cost: 350, stats: { ap: 20 }, pools: ['fx_pool'] }),
  item('fx_blade', { tier: 'core', cost: 1200, components: ['fx_sword', 'fx_sword'], stats: { ad: 40 } }),
  item('fx_greatblade', { tier: 'apex', cost: 3000, components: ['fx_blade', 'fx_gem'], stats: { ad: 70, ap: 30 } }),
  item('fx_boots_a', { tier: 'boots', cost: 300, stats: { moveSpeed: 0.5 }, uniqueGroup: 'fx_boots' }),
  item('fx_boots_b', { tier: 'boots', cost: 900, components: ['fx_boots_a'], stats: { moveSpeed: 1 }, uniqueGroup: 'fx_boots' }),
  item('fx_potion', { tier: 'consumable', cost: 50, consumable: { charges: 1, maxStack: 5 }, active: heal100 }),
  item('fx_flask', { tier: 'consumable', cost: 150, consumable: { charges: 3, maxStack: 1 },
    active: ability('fx_flask_use', [{ op: 'heal', amount: 60, to: 'self' }], { cooldown: 0, maxRank: 1, ai: { use: ['heal'] } }) }),
  item('fx_foreign', { tier: 'basic', cost: 100, pools: ['fx_other_pool'] }),
  item('fx_ward_item', { tier: 'basic', cost: 75,
    active: ability('fx_ward_place', [{ op: 'summon', unit: 'fx_eye_ward', duration: 60, at: 'point' }],
      { cooldown: 5, maxRank: 1, targeting: { kind: 'point', range: 8 }, ai: { use: ['vision'] } }) }),
  item('fx_wolf_item', { tier: 'basic', cost: 75,
    active: ability('fx_wolf_call', [{ op: 'summon', unit: 'fx_wolf', duration: 30, at: 'self', maxAlive: 1 }],
      { cooldown: 5, maxRank: 1, ai: { use: ['summon'] } }) }),
  item('fx_crit_cloak', { tier: 'core', cost: 800, stats: { crit: 0.3 } }),
  item('fx_free_trinket', { tier: 'starter', cost: 0 }),
  item('fx_charm', { tier: 'basic', cost: 500, stats: { hp: 50 },
    passives: [passive('fx_charm_p', [{ on: 'attackHit', effects: [{ op: 'damage', amount: 25, type: 'true' }] }])] }),
];

// ── fighters ────────────────────────────────────────────────────────────────────────────────────
function kit(id: string, dmg: number): Raw {
  return {
    a1: ability(`${id}_a1`, [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self',
      onHit: [{ op: 'damage', amount: { base: [dmg, dmg * 1.5, dmg * 2], ad: 0.5 }, type: 'phys' }] }],
    { cooldown: [4, 3.5, 3], cost: 30, targeting: { kind: 'none' } }),
    a2: ability(`${id}_a2`, [{ op: 'projectile', speed: 22, range: 8, width: 0.8,
      onHit: [{ op: 'damage', amount: { base: dmg, ad: 0.6 }, type: 'phys' }] }], { cooldown: 5, cost: 40, targeting: { kind: 'direction', range: 8 } }),
    a3: ability(`${id}_a3`, [{ op: 'dash', mode: 'toPoint', distance: 4, speed: 16 }], { cooldown: 8, cost: 30, targeting: { kind: 'point', range: 5 } }),
    ult: ability(`${id}_ult`, [{ op: 'area', shape: { kind: 'circle', radius: 4 }, at: 'self',
      onHit: [{ op: 'damage', amount: { base: [dmg * 3, dmg * 4, dmg * 5], ad: 1 }, type: 'magic' }] }], { cooldown: [40, 35, 30], cost: 80, maxRank: 3 }),
  };
}
export const FIGHTERS: Raw[] = [
  fighter('fx_brawler', { base: { hp: 1100, hpRegen: 1, ad: 60, attackSpeed: 0.8, moveSpeed: 3.4, crit: 0.15, armor: 25 },
    growth: { hp: 90, ad: 4, armor: 3 }, attack: { range: 1.5, windup: 0.3 }, ...kit('fx_brawler', 60) }),
  fighter('fx_ranger', { base: { hp: 850, hpRegen: 0.8, ad: 55, attackSpeed: 0.9, moveSpeed: 3.3, crit: 0.2, armor: 15 },
    growth: { hp: 75, ad: 3.5 }, attack: { range: 5, windup: 0.25, projectileSpeed: 20 }, ...kit('fx_ranger', 50) }),
  fighter('fx_juggernaut', { base: { hp: 4000, hpRegen: 6, ad: 160, attackSpeed: 1, moveSpeed: 3.6, crit: 0.1, armor: 80, resist: 40 },
    growth: { hp: 150, ad: 8 }, attack: { range: 1.8, windup: 0.3 }, ...kit('fx_juggernaut', 120) }),
  fighter('fx_fury_user', { resource: 'fx_fury', base: { hp: 1000, ad: 50, attackSpeed: 1 }, attack: { range: 1.5, windup: 0.3 } }),
  fighter('fx_heat_user', { resource: 'fx_heat', base: { hp: 1000, ad: 50 },
    a1: ability('fx_heat_a1', [], { cooldown: 0, cost: 40, castTime: 0 }) }),
  fighter('fx_none_user', { resource: 'fx_none', base: { hp: 1000, ad: 50 },
    a1: ability('fx_none_a1', [], { cooldown: 1, cost: 40, castTime: 0 }) }),
];
export const ALT_SKINS: Raw[] = FIGHTERS.map((f) => ({
  id: `${f.id as string}_alt`, fighter: f.id, name: 'Fx Alt', tier: 'deluxe', model: 'assets/fx/f2.glb',
  portrait: 'assets/fx/p2.png', splash: 'assets/fx/s2.png', releasedIn: '2026.10.0',
}));

// ── rules / modes / queues ──────────────────────────────────────────────────────────────────────
export const LANE_RULES: Raw = {
  startLevel: 1, maxLevel: 12, startGold: 500, passiveGoldPerSec: 2, passiveGoldStart: 10, goldMult: 1, xpMult: 1,
  xpTable: [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600],
  respawn: { base: 4, perLevel: 1, max: 20, lateGameRampAt: 300, lateGameMult: 1.5 },
  shopAccess: 'base', recall: true, recallTime: 4, fountainHeals: true, itemPool: 'fx_pool',
  minionWaves: {
    first: 5, interval: 20, upgradeEvery: 60,
    composition: [
      { unit: 'fx_lane_minion', count: 2 },
      { unit: 'fx_ranged_minion', count: 2 },
      { unit: 'fx_siege_minion', count: 1, everyNth: 3 },
      { unit: 'fx_siege_minion', count: 1, from: 120 },
    ],
  },
  structures: true, jungle: true,
  surrender: { earliest: 30, votesNeeded: 0.7 },
  end: { kind: 'core', coreStructure: 'fx_core' },
  bounty: { kill: 300, assistShare: 0.5, streakStep: 50, streakMax: 300, shutdownMax: 250 },
  abilityRanks: { basicMax: 3, ultLevels: [4, 8, 11] },
};
const FRAY_RULES: Raw = {
  ...LANE_RULES, minionWaves: undefined, structures: false, jungle: false, shopAccess: 'shops', recall: false, fountainHeals: false,
  surrender: undefined, respawn: { base: 3, perLevel: 0, max: 10 },
  end: { kind: 'last_standing_or_score', lives: 2, killScore: 4, timeLimit: 240 },
  placementPoints: [10, 7, 5, 3, 2, 1],
};
const SCORE_RULES: Raw = {
  ...LANE_RULES, minionWaves: undefined, structures: false, jungle: false,
  end: { kind: 'score', killScore: 3, timeLimit: 90 },
};
function strip(r: Raw): Raw { return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)); }

export interface MatchCatalogPatch { rules?: Raw; frayRules?: Raw; scoreRules?: Raw; riftRules?: Raw; units?: Raw[]; items?: Raw[]; fighters?: Raw[] }

export function matchCatalog(p: MatchCatalogPatch = {}): CatalogT {
  const fighters = p.fighters ?? FIGHTERS;
  return buildCatalog({
    fighters,
    units: p.units ?? UNITS,
    items: p.items ?? ITEMS,
    teamBuffs: TEAM_BUFFS,
    maps: [LANE_MAP, FRAY_MAP, RIFT_MAP],
    skins: p.fighters ? [] : ALT_SKINS,
    modes: [
      mode('fx_lane_mode', 'fx_lane_map', { ...LANE_RULES, ...(p.rules ?? {}) }),
      mode('fx_fray_mode', 'fx_fray_map', strip({ ...FRAY_RULES, ...(p.frayRules ?? {}) }), { teams: 6, perTeam: 1, pick: 'ffa_pick',
        playerColors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'] }),
      mode('fx_score_mode', 'fx_lane_map', strip({ ...SCORE_RULES, ...(p.scoreRules ?? {}) })),
      mode('fx_rift_mode', 'fx_rift_map', { ...LANE_RULES, maxLevel: 18, xpTable: [280, 380, 480, 580, 680, 780, 880, 980, 1080, 1180, 1280, 1380, 1480, 1580, 1680, 1780, 1880],
        abilityRanks: { basicMax: 3, ultLevels: [6, 11, 16] },
        minionWaves: { first: 10, interval: 30, upgradeEvery: 90, composition: [
          { unit: 'fx_lane_minion', count: 3 }, { unit: 'fx_ranged_minion', count: 3 }, { unit: 'fx_siege_minion', count: 1, everyNth: 2 }] },
        ...(p.riftRules ?? {}) }),
    ],
    queues: [
      queue('fx_lane_q', 'fx_lane_mode'),
      queue('fx_lane_practice', 'fx_lane_mode', 'practice', { partyMax: 1 }),
      queue('fx_lane_fast', 'fx_lane_mode', 'quick', { rules: { goldMult: 2, xpMult: 2 } }),
      queue('fx_fray_q', 'fx_fray_mode'),
      queue('fx_score_q', 'fx_score_mode'),
      queue('fx_rift_q', 'fx_rift_mode'),
    ],
  });
}

// ── setups ──────────────────────────────────────────────────────────────────────────────────────
export interface MSeat { fighter: string; team: number; skin?: string; controller?: 'human' | 'bot'; spells?: string[] }
export function matchSetup(modeId: string, queueId: string, mapId: string, seats: MSeat[],
  o: { seed?: number; practice?: MatchSetup['practice'] } = {}): MatchSetup {
  return {
    matchId: 'fx_match', seed: o.seed ?? 4242, queue: queueId, mode: modeId, map: mapId, catalogVersion: '2026.10.0',
    practice: o.practice,
    seats: seats.map((s, i): SeatSetup => ({
      player: i, team: s.team, name: `P${i}`, fighter: s.fighter, skin: s.skin ?? `${s.fighter}_skin`,
      loadout: { spells: s.spells ?? ['fx_spell_blink', 'fx_spell_heal'], boons: [] }, controller: s.controller ?? 'bot', colorIndex: i,
    })),
  };
}
export const laneSetup = (seats: MSeat[], o: { seed?: number; queue?: string; practice?: MatchSetup['practice'] } = {}): MatchSetup =>
  matchSetup('fx_lane_mode', o.queue ?? 'fx_lane_q', 'fx_lane_map', seats, o);
export const fraySetup = (n: number, o: { seed?: number } = {}): MatchSetup =>
  matchSetup('fx_fray_mode', 'fx_fray_q', 'fx_fray_map', Array.from({ length: n }, (_, i) => ({ fighter: i % 2 ? 'fx_ranger' : 'fx_brawler', team: i })), o);
export const scoreSetup = (seats: MSeat[], o: { seed?: number } = {}): MatchSetup => matchSetup('fx_score_mode', 'fx_score_q', 'fx_lane_map', seats, o);
export const riftSetup = (o: { seed?: number; skins?: 'base' | 'alt' } = {}): MatchSetup =>
  matchSetup('fx_rift_mode', 'fx_rift_q', 'fx_rift_map', Array.from({ length: 10 }, (_, i) => {
    const f = i % 2 ? 'fx_ranger' : 'fx_brawler';
    return { fighter: f, team: i < 5 ? 0 : 1, skin: o.skins === 'alt' ? `${f}_alt` : `${f}_skin` };
  }), o);

export { passive };

// ── stepping a SimApi ───────────────────────────────────────────────────────────────────────────
import type { SimApi, SimEvent } from '../../src/contracts/sim.ts';
/** step until `seconds` of game time passed (or the match ended); returns every event */
export function run(sim: SimApi, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n && sim.view.phase !== 'ended'; i++) for (const e of sim.step()) out.push(e);
  return out;
}
/** step until predicate holds (max `limit` seconds); returns events */
export function runUntil(sim: SimApi, pred: () => boolean, limit: number): SimEvent[] {
  const out: SimEvent[] = [];
  const n = Math.round(limit * 30);
  for (let i = 0; i < n && !pred() && sim.view.phase !== 'ended'; i++) for (const e of sim.step()) out.push(e);
  return out;
}
