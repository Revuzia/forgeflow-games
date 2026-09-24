// BLOCKTOOTH — titan roster data (CONTRACT.md §1, §8). THREE-FREE, pure data.
// `base` is a COMPLETE StatBlock: the §8 defaults with each titan's overrides applied.
// Colours are EXACTLY the canonical titan colours from CONTRACT §8 (models.ts uses the same).

import type { StatBlock, TitanDef, TitanId } from '../core/types.ts';

/** §8 base stat defaults — every StatKey. (upgrades/stats.ts `baseStatBlock()` mirrors these.) */
const DEFAULTS: StatBlock = {
  // survival
  maxHp: 100, regen: 0.5, armor: 0, iframes: 0, thorns: 0, lifesteal: 0, rubbleHeal: 0,
  // movement
  moveSpeed: 1, dashCharges: 1, dashCooldown: 1, dashDistance: 2.2,
  // growth / economy
  pickupRadius: 1.6, massGain: 1, xpGain: 1, luck: 0, rerolls: 1,
  // offence
  damage: 1, attackRate: 1, attackRange: 1, area: 1, critChance: 0.05, critMult: 1.6, knockback: 1,
  chains: 0, chainRange: 1, projectiles: 0, buildingDamage: 1,
  // smash
  smashDamage: 1, smashRadius: 1, sparkChance: 0,
  // hook
  abilityCooldown: 1, abilityPower: 1,
  // MOLO
  biteCleave: 0, pulseEvery: 4, vacuumRadius: 1,
  // VOLT-KITE
  arcForks: 3, wireDuration: 4, wireDamage: 1,
  // HEARTHBACK
  shellCapacity: 1, stompDelay: 0.6, magmaDuration: 0,
  // BRIARWICK
  turretCap: 4, turretRate: 1, sporeHeal: 1, vineLength: 1,
};

function statBlock(over: Partial<StatBlock>): StatBlock {
  return { ...DEFAULTS, ...over };
}

export const TITANS: Record<TitanId, TitanDef> = {
  molo: {
    id: 'molo',
    name: 'MOLO',
    species: 'squat jade monitor with a sawtooth back-fin',
    role: 'SMASH TANK',
    tagline: 'Eats the curb, then the block the curb was attached to.',
    lore: [
      'First sighted lapping rainwater out of a storm drain on Tallow Street. The storm drain is no longer on Tallow Street.',
      'Low, wide and patient. City engineers describe its bite radius as "a zoning matter."',
      'Swallows parked hatchbacks whole and exhales a faint smell of hot brake pads.',
      'Residents are reminded that throwing things at it counts as feeding it.',
    ],
    difficulty: 1,
    colors: { primary: '#3fae7f', secondary: '#1f6f55', belly: '#cfe8b8', accent: '#f1e4c8', glow: '#9dffcf', eye: '#ffd166' },
    base: statBlock({ maxHp: 140, armor: 10, moveSpeed: 0.95 }),
    auto: {
      id: 'curbBite',
      name: 'CURB BITE',
      desc: 'Every 0.75 s: a wide snapping cone ahead (50° each side), 10 dmg — the head turns to catch anything within 70°. Snaps at buildings while plowing. Every 4th footstep sends out a 6 dmg foot-pulse.',
    },
    hook: {
      id: 'gulletVacuum',
      name: 'GULLET VACUUM',
      desc: '1.2 s inhale over 6 body-heights: pickups fly in at triple speed, small foes are dragged to the jaws for 12 dmg/s. On release: a shield of 4% max HP + 0.2% per pickup swallowed (max 40%). Everything swallowed during the inhale gives +25% XP. 9 s cooldown.',
    },
    dash: {
      name: 'LOW TACKLE',
      desc: 'A belly-first lunge of 2.2 body-heights. Brief invulnerability and double smash damage along the way.',
    },
  },

  voltkite: {
    id: 'voltkite',
    name: 'VOLT-KITE',
    species: 'lean indigo jackal-drake with a static mane',
    role: 'CHAIN ASSASSIN',
    tagline: 'Every streetlight it passes files a formal complaint.',
    lore: [
      'Moves like a rumor with legs. Leaves a humming wire on the pavement wherever it lunges.',
      'The municipal grid reports a measurable surge every time it yawns.',
      'Halvard Civil Defense has asked residents to stop calling it "the good boy."',
      'Do not touch the mane. The mane is a live conductor and it knows your name.',
    ],
    difficulty: 3,
    colors: { primary: '#3b3f9e', secondary: '#23255e', belly: '#8f94d9', accent: '#6ff3ff', glow: '#6ff3ff', eye: '#fff27a' },
    base: statBlock({ maxHp: 90, moveSpeed: 1.15, dashCharges: 2, dashCooldown: 0.75 }),
    auto: {
      id: 'forkArc',
      name: 'FORK-ARC',
      desc: 'Every 0.9 s: lightning leaps to a target within 3.2 body-heights, then forks to 3 more nearby (foes first, then buildings). 12 dmg, −15% per jump.',
    },
    hook: {
      id: 'recastDetonate',
      name: 'RECAST: DETONATE',
      desc: 'Blows every live wire at once: 40 dmg along each wire + 6 per second it had left. No wires out? A 15 dmg static burst instead. 1.5 s cooldown.',
    },
    dash: {
      name: 'LIVE WIRE LUNGE',
      desc: 'Two charges, quick recharge. Every lunge lays a LIVE WIRE on its path that shocks foes for 10 dmg/s over 4 s (up to 6 wires).',
    },
  },

  hearthback: {
    id: 'hearthback',
    name: 'HEARTHBACK',
    species: 'walking caldera under an obsidian dome shell',
    role: 'ERUPTION FORTRESS',
    tagline: 'A walking caldera with the temperament of a slow cooker.',
    lore: [
      'Absorbs artillery the way a sponge absorbs a spill: completely, and with consequences.',
      'The dome shell keeps every insult. The vent returns them, with interest.',
      'Road crews have stopped filling its footprints. They are now listed as permanent features.',
      'Ward Seven meteorologists have quietly reclassified it as weather.',
    ],
    difficulty: 2,
    colors: { primary: '#2a2433', secondary: '#4a3f52', belly: '#7a5c4f', accent: '#ff7a2e', glow: '#ffb13b', eye: '#ffd166' },
    base: statBlock({ maxHp: 170, armor: 20, moveSpeed: 0.85, dashCooldown: 1.35 }),
    auto: {
      id: 'magmaStomp',
      name: 'MAGMA STOMP',
      desc: 'Every 1.3 s: paints a ground circle on a target up to 2.5 body-heights away, which erupts 0.6 s later for 30 dmg and knockback.',
    },
    hook: {
      id: 'shellVent',
      name: 'SHELL VENT',
      desc: 'Passive SHELL stores 60% of damage taken plus heat from every floor broken. VENT dumps it: a ring burst that grows with the store (20 + 2.5 per point) and heals 15% of what was stored. 6 s cooldown.',
    },
    dash: {
      name: 'CALDERA SHOVE',
      desc: 'Slow to recharge, but the whole dome goes through whatever is in front at double smash damage.',
    },
  },

  briarwick: {
    id: 'briarwick',
    name: 'BRIARWICK',
    species: 'horned garden-beast with a seed ruff',
    role: 'AREA CONTROL',
    tagline: 'Plants a garden in whatever used to be your office.',
    lore: [
      'Horned, mossy and deeply committed to urban renewal.',
      'Anything it knocks down tends to sprout something that shoots back.',
      'The Parks Department has declined to take responsibility. The Parks Department is now a hedge.',
      'Allergy season has been extended until further notice.',
    ],
    difficulty: 2,
    colors: { primary: '#5e8f3a', secondary: '#6b4a2f', belly: '#c9d98f', accent: '#ff9ec7', glow: '#d8ff7a', eye: '#fff3b0' },
    base: statBlock({ maxHp: 120, armor: 5 }),
    auto: {
      id: 'vineLash',
      name: 'VINE LASH',
      desc: 'Every 1.0 s: a whip lane 2.6 body-heights long toward a target, 14 dmg to everything in it. Passive BLOOM TURRETS: nearby broken floors may root seed-spitting turrets (collapses always do).',
    },
    hook: {
      id: 'sow',
      name: 'SOW',
      desc: 'Up to 3 nearby rubble piles sprout bloom turrets at once, and a spore cloud heals 8% max HP over 3 s while slowing foes 40%. 10 s cooldown.',
    },
    dash: {
      name: 'BRAMBLE BOUND',
      desc: 'A springy bound of 2.2 body-heights that tramples everything small along the way.',
    },
  },
};
