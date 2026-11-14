// BLOCKTOOTH — HALVARD CIVIL DEFENSE roster (ai lane, CONTRACT §9 table, names per §1).
// THREE-free data. Numbers are the contract's starting points; the balance gate tunes them.
//
// Units: hp (base, × (1 + ENEMY_HP_PER_MIN · minutes) at spawn), speed m/s, radius/height m,
// dmg per shot / round / contact (× RANKS[titan.rank].hpMul when the shot is spawned),
// range = preferred engagement distance from the titan's SURFACE (m), fireCd s.

import type { EnemyDef, EnemyKind } from '../core/types.ts';

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  // Walks in, stops at range, fires slow readable pellets.
  android: {
    kind: 'android', name: 'CROSSING WARDEN',
    hp: 6, speed: 3.4, radius: 0.45, height: 1.8, flies: false,
    dmg: 3, range: 9, fireCd: 1.6, xp: 2, mass: 0.5, cost: 1, minRank: 0, crushable: true,
  },
  // Groups of 5 in a wedge behind a leader slot; 3-round volleys (dmg is per round).
  // The director fields them from Size I but only after 45 s.
  squad: {
    kind: 'squad', name: 'PICKET SQUAD',
    hp: 8, speed: 3.8, radius: 0.45, height: 1.8, flies: false,
    dmg: 2, range: 12, fireCd: 2.4, xp: 2, mass: 0.5, cost: 1, minRank: 0, crushable: true,
  },
  // Circles at altitude (4 m → 0.8 H), dive-bombs behind a small 0.85 s circle tell.
  // Flying: never stepped on (it is above the titan's feet).
  drone: {
    kind: 'drone', name: 'GNAT',
    hp: 5, speed: 7, radius: 0.6, height: 0.5, flies: true,
    dmg: 4, range: 6, fireCd: 3, xp: 2, mass: 0.5, cost: 1.5, minRank: 1, crushable: false,
  },
  // Drives the road grid, strafes, rocket = circle tell r 3 landing 1.1 s later.
  buggy: {
    kind: 'buggy', name: 'HOPPER',
    hp: 40, speed: 11, radius: 1.6, height: 1.8, flies: false,
    dmg: 8, range: 25, fireCd: 3.5, xp: 6, mass: 1.5, cost: 5, minRank: 1, crushable: true,
  },
  // Drives, parks at range, deploys a PICKET SQUAD every 12 s (max 2 alive), pellet turret.
  apc: {
    kind: 'apc', name: 'BULWARK',
    hp: 160, speed: 7, radius: 2.4, height: 2.6, flies: false,
    dmg: 3, range: 30, fireCd: 1.2, xp: 15, mass: 4, cost: 14, minRank: 2, crushable: true,
  },
  // Crawls, aims the turret (aimX/aimZ), shell = lane tell (w 2.5, len 45, 1.4 s).
  tank: {
    kind: 'tank', name: 'TORTOISE',
    hp: 320, speed: 4.5, radius: 2.8, height: 2.8, flies: false,
    dmg: 26, range: 45, fireCd: 5, xp: 25, mass: 6, cost: 24, minRank: 2, crushable: true,
  },
  // Keeps long range, plants, lobs 3 shells with circle tells r 6 (1.8 s flight).
  walker: {
    kind: 'walker', name: 'STILT MORTAR',
    hp: 700, speed: 3, radius: 3, height: 12, flies: false,
    dmg: 30, range: 90, fireCd: 6, xp: 60, mass: 15, cost: 55, minRank: 3, crushable: true,
  },
  // Elite breach-dozer: lane-telegraphed charge (len 80, w 8, 1.6 s) at 30 m/s, contact damage,
  // smashes props in its path. Never crushable. Drops a CHEST (combat/killEnemy).
  // cost 0: never bought by the wave budget — the director schedules it (§9 elite rule).
  elite: {
    kind: 'elite', name: 'RAMROD',
    hp: 2400, speed: 6, radius: 5, height: 6, flies: false,
    dmg: 45, range: 80, fireCd: 7, xp: 250, mass: 60, cost: 0, minRank: 2, crushable: false,
  },
};
