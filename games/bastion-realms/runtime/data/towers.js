// Tower definitions. Pure data — stats indexed by level (0..2 = L1..L3).
// dmgType: 'phys' (reduced by armor) | 'magic' (reduced by warding) | 'true' (ignores both).
// kind drives sim behavior: bullet | snipe | chain | burn | slow | poison | splash | support.

export const TOWERS = {
  bolt: {
    name: 'Bolt Tower', icon: 'bolt', color: 0xc8a24a, dmgType: 'phys', kind: 'bullet',
    desc: 'Rapid single-target bolts. Cheap, reliable backbone.',
    cost: 100, upCost: [80, 120],
    range: [6.6, 7.2, 8.0],
    rate: [1.5, 2.0, 2.9],           // shots/sec
    dmg: [11, 18, 29],
    projSpeed: 30,
    canFlying: true,
  },
  sniper: {
    name: 'Sniper Spire', icon: 'sniper', color: 0x7ea1b3, dmgType: 'phys', kind: 'snipe',
    desc: 'Extreme range, huge single hits. Crits do 2.5x. L2 pierces 50% armor.',
    cost: 175, upCost: [140, 200],
    range: [12.5, 14.5, 17.0],
    rate: [0.38, 0.44, 0.52],
    dmg: [55, 100, 185],
    crit: [0.2, 0.3, 0.5], critMul: 2.5,
    armorPierce: [0, 0.5, 0.65],     // fraction of armor ignored
    canFlying: true,
  },
  storm: {
    name: 'Storm Coil', icon: 'storm', color: 0x54c8f0, dmgType: 'magic', kind: 'chain',
    desc: 'Lightning arcs between enemies. Triple damage to shields. L3 briefly stuns.',
    cost: 250, upCost: [190, 260],
    range: [7.0, 7.8, 8.6],
    rate: [0.75, 0.85, 1.0],
    dmg: [26, 42, 68],
    chains: [3, 4, 6], falloff: 0.55, chainRadius: 4.2,
    stun: [0, 0, 0.4],
    shieldMul: 3,
    canFlying: true,
  },
  ember: {
    name: 'Ember Altar', icon: 'ember', color: 0xff7031, dmgType: 'magic', kind: 'burn',
    desc: 'Scorches enemies and sets them ablaze. L3 splashes ignite nearby.',
    cost: 200, upCost: [150, 210],
    range: [5.6, 6.2, 6.8],
    rate: [0.9, 1.05, 1.2],
    dmg: [14, 22, 34],
    burnDps: [10, 17, 28], burnDur: [3, 3.5, 4],
    igniteSplash: [0, 0, 2.4],       // radius at L3
    canFlying: true,
  },
  frost: {
    name: 'Frost Obelisk', icon: 'frost', color: 0x86dcff, dmgType: 'magic', kind: 'slow',
    desc: 'Chills enemies, slowing them. L3 can flash-freeze.',
    cost: 150, upCost: [110, 160],
    range: [5.8, 6.4, 7.2],
    rate: [0.95, 1.1, 1.25],
    dmg: [7, 11, 16],
    slowPct: [0.3, 0.4, 0.5], slowDur: [1.8, 2.2, 2.6],
    freezeChance: [0, 0, 0.1], freezeDur: 1.0, freezeCd: 4,   // per-enemy freeze cooldown
    canFlying: true,
  },
  venom: {
    name: 'Venom Bloom', icon: 'venom', color: 0x8fd435, dmgType: 'true', kind: 'poison',
    desc: 'Lobs toxin that stacks up to 3x and ignores armor and wards. Cannot hit flying.',
    cost: 180, upCost: [140, 190],
    range: [6.4, 7.0, 7.6],
    rate: [0.7, 0.8, 0.95],
    dmg: [6, 9, 13],
    poisonDps: [11, 18, 30], poisonDur: [4, 4.5, 5], maxStacks: 3,
    deathBurst: [0, 0, 2.6],         // L3: dying poisoned enemies burst, radius
    projSpeed: 14, arc: true,
    canFlying: false,
  },
  cannon: {
    name: 'Cannon Bastion', icon: 'cannon', color: 0x9a8f80, dmgType: 'phys', kind: 'splash',
    desc: 'Explosive shells with area damage. Cannot hit flying. L3 fires double shells.',
    cost: 220, upCost: [170, 240],
    range: [6.8, 7.4, 8.0],
    rate: [0.5, 0.58, 0.66],
    dmg: [38, 62, 100],
    splash: [2.1, 2.4, 2.8], splashFalloff: 0.45,
    doubleShot: [0, 0, 1],
    projSpeed: 16, arc: true,
    canFlying: false,
  },
  banner: {
    name: 'War Banner', icon: 'banner', color: 0xe0b64f, dmgType: null, kind: 'support',
    desc: 'Empowers towers in range: faster firing, harder hits, longer reach. Strongest banner only.',
    cost: 160, upCost: [130, 180],
    range: [4.6, 5.4, 6.2],
    rate: [0, 0, 0], dmg: [0, 0, 0],
    buffRate: [0.15, 0.25, 0.35],
    buffDmg: [0.10, 0.20, 0.30],
    buffRange: [0.10, 0.15, 0.20],
    canFlying: false,
  },
};

export const TOWER_ORDER = ['bolt', 'sniper', 'storm', 'ember', 'frost', 'venom', 'cannon', 'banner'];

export function towerDef(id) {
  const d = TOWERS[id];
  if (!d) throw new Error('unknown tower ' + id);
  return d;
}

export function upgradeCost(id, level) { // level = current (0/1); cost to go level+1
  return towerDef(id).upCost[level];
}

export function totalInvested(id, level) {
  const d = towerDef(id);
  let t = d.cost;
  for (let i = 0; i < level; i++) t += d.upCost[i];
  return t;
}

export const SELL_REFUND = 0.7;

// Tower unlock schedule: [biomeIdx, levelIdx] when the tower becomes available.
export const TOWER_UNLOCKS = {
  bolt:   [0, 0],
  frost:  [0, 1],
  cannon: [0, 3],
  sniper: [0, 5],
  ember:  [1, 0],
  banner: [1, 3],
  storm:  [2, 0],
  venom:  [3, 0],
};

export function isTowerUnlocked(id, bi, li) {
  const [ub, ul] = TOWER_UNLOCKS[id];
  return bi > ub || (bi === ub && li >= ul);
}
