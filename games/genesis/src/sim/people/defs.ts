// GENESIS — shared constants of the peoples simulation (CONTRACT.md §8): task kinds, roles, memory kinds, need / skill /
// trait indices, movement constants. Numeric "enums" are plain const objects (Node type stripping: no `enum`).

import { NEEDS, SKILLS, TRAITS, type NeedName, type SkillName, type TraitName } from '../content.ts';

/** base walking speed, metres per tick (CONTRACT §8.3: ≈ 2.5 m/s at 1x) */
export const BASE_WALK = 0.25;
/** waypoints an agent can hold (longer journeys re-plan when the path runs out) */
export const PATH_MAX = 40;
/** inventory slots */
export const INV = 4;
/** memory ring length */
export const MEM = 8;
/** gods tracked per agent (0 = the player) */
export const GODS = 4;

export const NN = NEEDS.length;
export const NS = SKILLS.length;
export const NT = TRAITS.length;

export const NEED: Record<NeedName, number> = Object.fromEntries(NEEDS.map((n, i) => [n, i])) as Record<NeedName, number>;
export const SKILL: Record<SkillName, number> = Object.fromEntries(SKILLS.map((n, i) => [n, i])) as Record<SkillName, number>;
export const TRAIT: Record<TraitName, number> = Object.fromEntries(TRAITS.map((n, i) => [n, i])) as Record<TraitName, number>;

/** task kinds (CONTRACT §8.3 floor; the id is stored per agent) */
export const TASK = {
  idle: 0, wander: 1, sleep: 2, eat: 3, drink: 4, forage: 5, chop: 6, quarry: 7, dig: 8, mine: 9, fish: 10, hunt: 11,
  haul: 12, store: 13, craft: 14, build: 15, repair: 16, farm: 17, herd: 18, cook: 19, tendFire: 20, teach: 21, learn: 22,
  experiment: 23, explore: 24, trade: 25, raid: 26, fight: 27, flee: 28, guard: 29, pray: 30, worship: 31, preach: 32,
  mourn: 33, bury: 34, court: 35, raiseChild: 36, migrate: 37, found: 38, sail: 39, launch: 40, board: 41, socialize: 42,
  warm: 43, heal: 44, cutIce: 45, secrete: 46, collectAir: 47, follow: 48, bathe: 49, possessed: 50, reverse: 51,
} as const;
export type TaskKind = (typeof TASK)[keyof typeof TASK];
export const TASK_NAMES: string[] = [];
for (const [k, v] of Object.entries(TASK)) TASK_NAMES[v] = k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

/** what a task is called in a biography ("gathering berries", "sleeping") */
export const TASK_VERBS: Record<number, string> = {
  [TASK.idle]: 'resting', [TASK.wander]: 'wandering', [TASK.sleep]: 'sleeping', [TASK.eat]: 'eating', [TASK.drink]: 'drinking',
  [TASK.forage]: 'foraging', [TASK.chop]: 'cutting wood', [TASK.quarry]: 'quarrying stone', [TASK.dig]: 'digging', [TASK.mine]: 'mining',
  [TASK.fish]: 'fishing', [TASK.hunt]: 'hunting', [TASK.haul]: 'hauling', [TASK.store]: 'storing goods', [TASK.craft]: 'making things',
  [TASK.build]: 'building', [TASK.repair]: 'repairing', [TASK.farm]: 'farming', [TASK.herd]: 'herding', [TASK.cook]: 'cooking',
  [TASK.tendFire]: 'tending the fire', [TASK.teach]: 'teaching', [TASK.learn]: 'learning', [TASK.experiment]: 'experimenting',
  [TASK.explore]: 'exploring', [TASK.trade]: 'trading', [TASK.raid]: 'raiding', [TASK.fight]: 'fighting', [TASK.flee]: 'fleeing',
  [TASK.guard]: 'keeping watch', [TASK.pray]: 'praying', [TASK.worship]: 'worshipping', [TASK.preach]: 'preaching',
  [TASK.mourn]: 'mourning', [TASK.bury]: 'burying the dead', [TASK.court]: 'courting', [TASK.raiseChild]: 'raising a child',
  [TASK.migrate]: 'migrating', [TASK.found]: 'founding a settlement', [TASK.sail]: 'sailing', [TASK.launch]: 'launching',
  [TASK.board]: 'boarding', [TASK.socialize]: 'talking', [TASK.warm]: 'warming up', [TASK.heal]: 'healing the sick',
  [TASK.cutIce]: 'cutting ice', [TASK.secrete]: 'building comb', [TASK.collectAir]: 'grazing the haze', [TASK.follow]: 'following the band',
  [TASK.bathe]: 'swimming', [TASK.possessed]: 'moved by the god', [TASK.reverse]: 'studying a strange object',
};

/** task phase */
export const PHASE = { moving: 0, working: 1 } as const;

/** roles (CONTRACT §8.5) */
export const ROLE = {
  none: 0, gatherer: 1, hunter: 2, fisher: 3, farmer: 4, herder: 5, crafter: 6, builder: 7, teacher: 8, priest: 9,
  leader: 10, trader: 11, soldier: 12, sailor: 13, scholar: 14, healer: 15, child: 16,
} as const;
export const ROLE_NAMES: string[] = [];
for (const [k, v] of Object.entries(ROLE)) ROLE_NAMES[v] = k;

/** memory kinds (an agent remembers the last MEM notable things) */
export const MEMK = {
  none: 0, born: 1, learned: 2, taught: 3, discovered: 4, death: 5, birth: 6, partner: 7, miracle: 8, fear: 9, starved: 10,
  froze: 11, injured: 12, refused: 13, gift: 14, founded: 15, built: 16, sick: 17, healed: 18, burned: 19, moved: 20,
  silenced: 21, disciple: 22, lightning: 23, hunted: 24, migrated: 25, mourned: 26, forgot: 27,
  traded: 28, fought: 29, raided: 30, sailed: 31, conquered: 32, exiled: 33, stole: 34, wounded: 35, led: 36, converted: 37,
} as const;

/** causes of death (memories, chronicle, inspector) */
export const DEATH = {
  age: 1, starvation: 2, thirst: 3, cold: 4, heat: 5, injury: 6, disease: 7, suffocation: 8, god: 9, fire: 10, predator: 11,
  disaster: 12, drowning: 13, war: 14, punished: 15,
} as const;
export const DEATH_NAMES: Record<number, string> = {
  1: 'old age', 2: 'starvation', 3: 'thirst', 4: 'cold', 5: 'heat', 6: 'wounds', 7: 'sickness', 8: 'bad air', 9: 'the god',
  10: 'fire', 11: 'a predator', 12: 'disaster', 13: 'drowning', 14: 'war', 15: 'the punishment of thieves',
};

/** per-planet seconds-free time helpers */
export function dayTicks(dayHours: number): number {
  return Math.max(60, Math.round(dayHours * 60));
}
