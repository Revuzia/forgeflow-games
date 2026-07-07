// Stronghold towers — 8 all-new designs. Stats indexed by level (0..2).
// dmgType: 'phys' | 'magic' | 'fire' | 'nature' | 'holy'.
// placement: 'ground' (buildable cell) | 'road' (on an enemy road cell).

export const TOWERS = {
  ballista: {
    name: 'Ballista', icon: 'ballista', color: 0xc89050, dmgType: 'phys', kind: 'pierce',
    desc: 'Heavy bolts that PIERCE through multiple enemies in a line.',
    cost: 110, upCost: [90, 130], placement: 'ground',
    range: [7.4, 8.0, 8.8],
    rate: [0.8, 0.95, 1.1],
    dmg: [22, 34, 52],
    pierce: [2, 3, 4],            // max enemies hit per bolt
    canFlying: true,
  },
  spire: {
    name: 'Arcane Spire', icon: 'spire', color: 0xb06ae0, dmgType: 'magic', kind: 'homing',
    desc: 'Volleys of homing missiles that never miss their mark.',
    cost: 240, upCost: [180, 250], placement: 'ground',
    range: [7.6, 8.2, 9.0],
    rate: [0.85, 0.95, 1.05],
    dmg: [16, 22, 28],
    volley: [1, 2, 3],            // missiles per shot, each picks a target
    canFlying: true,
  },
  cauldron: {
    name: 'Oil Cauldron', icon: 'cauldron', color: 0xd07828, dmgType: 'fire', kind: 'zone',
    desc: 'Hurls burning oil that pools on the ground, scorching and slowing. Cannot hit flying.',
    cost: 200, upCost: [150, 210], placement: 'ground',
    range: [6.2, 6.8, 7.4],
    rate: [0.4, 0.46, 0.52],
    dmg: [10, 14, 18],            // impact damage
    zoneDps: [11, 17, 26], zoneDur: [4.5, 5, 5.5], zoneR: [1.5, 1.7, 2.0], zoneSlow: 0.2,
    projSpeed: 13, arc: true,
    canFlying: false,
  },
  thorn: {
    name: 'Thorn Barricade', icon: 'thorn', color: 0x5f9c34, dmgType: 'nature', kind: 'roadThorn',
    desc: 'PLACED ON A ROAD. Grasping vines slow and tear at everything crossing. Limited placements.',
    cost: 90, upCost: [70, 100], placement: 'road',
    range: [1.4, 1.4, 1.4],       // affects its own cell radius
    rate: [0, 0, 0], dmg: [0, 0, 0],
    slowPct: [0.35, 0.45, 0.55],
    thornDps: [7, 12, 19],
    maxActive: [3, 4, 5],         // per level of the HIGHEST barricade owned
    canFlying: false,
  },
  crossbow: {
    name: 'Siege Crossbow', icon: 'crossbow', color: 0x8a7a5a, dmgType: 'phys', kind: 'snipe',
    desc: 'Long-range killshots. Bonus damage vs armored plating.',
    cost: 170, upCost: [140, 200], placement: 'ground',
    range: [11.5, 13.5, 15.5],
    rate: [0.42, 0.48, 0.55],
    dmg: [48, 82, 140],
    armorBonus: [1.5, 1.75, 2.0], // multiplier vs armor > 0
    canFlying: true,
  },
  beacon: {
    name: 'Holy Beacon', icon: 'beacon', color: 0xf0d060, dmgType: 'holy', kind: 'aura',
    desc: 'Radiant aura sears nearby enemies (half-ignores wards) and REPAIRS the Keep.',
    cost: 220, upCost: [170, 240], placement: 'ground',
    range: [4.2, 4.8, 5.4],
    rate: [0, 0, 0],
    auraDps: [9, 14, 21],
    repair: [0.25, 0.4, 0.55],     // Bastion HP/s while standing
    dmg: [0, 0, 0],
    canFlying: true,
  },
  rune: {
    name: 'Rune Trap', icon: 'rune', color: 0x4ac8d8, dmgType: 'magic', kind: 'roadRune',
    desc: 'PLACED ON A ROAD. Detonates under passing enemies, then re-arms. Limited placements.',
    cost: 80, upCost: [70, 90], placement: 'road',
    range: [2.0, 2.2, 2.4],       // blast radius
    rate: [0, 0, 0],
    dmg: [55, 90, 140],
    rearm: [6, 5, 4],
    maxActive: [3, 4, 5],
    canFlying: false,
  },
  storm: {
    name: 'Storm Caller', icon: 'storm', color: 0x62b8f0, dmgType: 'magic', kind: 'chain',
    desc: 'Forked lightning arcs between enemies and STUNS them cold.',
    cost: 260, upCost: [200, 270], placement: 'ground',
    range: [7.2, 7.8, 8.6],
    rate: [0.7, 0.8, 0.9],
    dmg: [30, 46, 68],
    chains: [3, 4, 5], falloff: 0.6, chainRadius: 4.4,
    stun: [0.3, 0.4, 0.6],        // bosses take 25%
    canFlying: true,
  },
};

// Build-bar order follows the unlock progression.
export const TOWER_ORDER = ['ballista', 'thorn', 'cauldron', 'crossbow', 'rune', 'spire', 'beacon', 'storm'];

export const TOWER_UNLOCKS = {
  ballista: [0, 0],
  thorn:    [0, 1],
  cauldron: [0, 3],
  crossbow: [0, 5],
  rune:     [1, 0],
  spire:    [1, 3],
  beacon:   [2, 0],
  storm:    [3, 0],
};

export function towerDef(id) {
  const d = TOWERS[id];
  if (!d) throw new Error('unknown tower ' + id);
  return d;
}
export function upgradeCost(id, level) { return towerDef(id).upCost[level]; }
export function totalInvested(id, level) {
  const d = towerDef(id);
  let t = d.cost;
  for (let i = 0; i < level; i++) t += d.upCost[i];
  return t;
}
export const SELL_REFUND = 0.7;
export function isTowerUnlocked(id, wi, li) {
  const [uw, ul] = TOWER_UNLOCKS[id];
  return wi > uw || (wi === uw && li >= ul);
}
