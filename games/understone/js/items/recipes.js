// Recipe database — quantities from research/terraria/04 §3-6 (wiki-verified).
// station: null = by hand; 'water' = standing near water (environmental).
// Recipes appear in the crafting list when ALL ingredients are held AND the
// station is nearby (Terraria recipe-list model — no grid).

export const RECIPES = [
  // --- by hand ---------------------------------------------------------------
  { out: 'workbench', n: 1, station: null, ing: { wood: 10 } },
  { out: 'torch', n: 3, station: null, ing: { wood: 1, gel: 1 } },
  { out: 'manaCrystal', n: 1, station: null, ing: { fallenStar: 5 } },

  // --- work bench -------------------------------------------------------------
  { out: 'woodenSword', n: 1, station: 'workbench', ing: { wood: 7 } },
  { out: 'woodenHammer', n: 1, station: 'workbench', ing: { wood: 8 } },
  { out: 'woodenBow', n: 1, station: 'workbench', ing: { wood: 10 } },
  { out: 'platform', n: 2, station: 'workbench', ing: { wood: 1 } },
  { out: 'woodWall', n: 4, station: 'workbench', ing: { wood: 1 } },
  { out: 'door', n: 1, station: 'workbench', ing: { wood: 6 } },
  { out: 'chest', n: 1, station: 'workbench', ing: { wood: 8, ironBar: 2 } },
  { out: 'furnace', n: 1, station: 'workbench', ing: { stone: 20, wood: 4, torch: 3 } },
  { out: 'anvil', n: 1, station: 'workbench', ing: { ironBar: 5 } },
  { out: 'woodenArrow', n: 25, station: 'workbench', ing: { wood: 1, stone: 1 } },
  { out: 'woodHelmet', n: 1, station: 'workbench', ing: { wood: 20 } },
  { out: 'woodBreastplate', n: 1, station: 'workbench', ing: { wood: 30 } },
  { out: 'woodGreaves', n: 1, station: 'workbench', ing: { wood: 25 } },
  { out: 'flamingArrow', n: 10, station: null, ing: { woodenArrow: 10, torch: 1 } },

  // --- furnace (ore → bar: 3 for common, 4 for precious — research 04 §4) -------
  { out: 'copperBar', n: 1, station: 'furnace', ing: { copperOre: 3 } },
  { out: 'ironBar', n: 1, station: 'furnace', ing: { ironOre: 3 } },
  { out: 'silverBar', n: 1, station: 'furnace', ing: { silverOre: 4 } },
  { out: 'goldBar', n: 1, station: 'furnace', ing: { goldOre: 4 } },
  { out: 'demoniteBar', n: 1, station: 'furnace', ing: { demonite: 3 } },
  { out: 'glass', n: 1, station: 'furnace', ing: { sand: 2 } },
  { out: 'bottle', n: 2, station: 'furnace', ing: { glass: 1 } },
  { out: 'bottlePlaced', n: 1, station: null, ing: { bottle: 1 } },

  // --- hellforge --------------------------------------------------------------
  { out: 'hellstoneBar', n: 1, station: 'hellforge', ing: { hellstone: 3, obsidian: 1 } },

  // --- anvil: tools ------------------------------------------------------------
  { out: 'copperPickaxe', n: 1, station: 'anvil', ing: { copperBar: 8, wood: 4 } },
  { out: 'ironPickaxe', n: 1, station: 'anvil', ing: { ironBar: 10, wood: 3 } },
  { out: 'silverPickaxe', n: 1, station: 'anvil', ing: { silverBar: 10, wood: 4 } },
  { out: 'goldPickaxe', n: 1, station: 'anvil', ing: { goldBar: 10, wood: 4 } },
  { out: 'nightmarePickaxe', n: 1, station: 'anvil', ing: { demoniteBar: 12, shadowScale: 6 } },
  { out: 'moltenPickaxe', n: 1, station: 'anvil', ing: { hellstoneBar: 20 } },
  { out: 'copperAxe', n: 1, station: 'anvil', ing: { copperBar: 6, wood: 3 } },
  { out: 'ironAxe', n: 1, station: 'anvil', ing: { ironBar: 9, wood: 3 } },
  { out: 'goldAxe', n: 1, station: 'anvil', ing: { goldBar: 9, wood: 3 } },
  { out: 'moltenHamaxe', n: 1, station: 'anvil', ing: { hellstoneBar: 25 } },
  { out: 'copperHammer', n: 1, station: 'anvil', ing: { copperBar: 10, wood: 3 } },
  { out: 'ironHammer', n: 1, station: 'anvil', ing: { ironBar: 10, wood: 3 } },
  { out: 'chain', n: 15, station: 'anvil', ing: { ironBar: 1 } },

  // --- anvil: weapons -------------------------------------------------------------
  { out: 'copperSword', n: 1, station: 'anvil', ing: { copperBar: 6 } },
  { out: 'ironSword', n: 1, station: 'anvil', ing: { ironBar: 8 } },
  { out: 'silverSword', n: 1, station: 'anvil', ing: { silverBar: 8 } },
  { out: 'goldSword', n: 1, station: 'anvil', ing: { goldBar: 8 } },
  { out: 'lightsBane', n: 1, station: 'anvil', ing: { demoniteBar: 10 } },
  { out: 'volcano', n: 1, station: 'anvil', ing: { hellstoneBar: 20 } },
  { out: 'copperBow', n: 1, station: 'anvil', ing: { copperBar: 7 } },
  { out: 'ironBow', n: 1, station: 'anvil', ing: { ironBar: 7 } },
  { out: 'goldBow', n: 1, station: 'anvil', ing: { goldBar: 7 } },
  { out: 'demonBow', n: 1, station: 'anvil', ing: { demoniteBar: 8 } },
  { out: 'moltenFury', n: 1, station: 'anvil', ing: { hellstoneBar: 15 } },
  { out: 'goldCrown', n: 1, station: 'anvil', ing: { goldBar: 5, ruby: 1 } },

  // --- anvil: armor -----------------------------------------------------------------
  { out: 'copperHelmet', n: 1, station: 'anvil', ing: { copperBar: 12 } },
  { out: 'copperChainmail', n: 1, station: 'anvil', ing: { copperBar: 20 } },
  { out: 'copperGreaves', n: 1, station: 'anvil', ing: { copperBar: 16 } },
  { out: 'ironHelmet', n: 1, station: 'anvil', ing: { ironBar: 15 } },
  { out: 'ironChainmail', n: 1, station: 'anvil', ing: { ironBar: 25 } },
  { out: 'ironGreaves', n: 1, station: 'anvil', ing: { ironBar: 20 } },
  { out: 'silverHelmet', n: 1, station: 'anvil', ing: { silverBar: 15 } },
  { out: 'silverChainmail', n: 1, station: 'anvil', ing: { silverBar: 25 } },
  { out: 'silverGreaves', n: 1, station: 'anvil', ing: { silverBar: 20 } },
  { out: 'goldHelmet', n: 1, station: 'anvil', ing: { goldBar: 20 } },
  { out: 'goldChainmail', n: 1, station: 'anvil', ing: { goldBar: 30 } },
  { out: 'goldGreaves', n: 1, station: 'anvil', ing: { goldBar: 25 } },
  { out: 'shadowHelmet', n: 1, station: 'anvil', ing: { demoniteBar: 15, shadowScale: 10 } },
  { out: 'shadowScalemail', n: 1, station: 'anvil', ing: { demoniteBar: 25, shadowScale: 20 } },
  { out: 'shadowGreaves', n: 1, station: 'anvil', ing: { demoniteBar: 20, shadowScale: 15 } },
  { out: 'moltenHelmet', n: 1, station: 'anvil', ing: { hellstoneBar: 10 } },
  { out: 'moltenBreastplate', n: 1, station: 'anvil', ing: { hellstoneBar: 20 } },
  { out: 'moltenGreaves', n: 1, station: 'anvil', ing: { hellstoneBar: 15 } },

  // --- demon altar: boss summons ------------------------------------------------------
  { out: 'suspiciousEye', n: 1, station: 'altar', ing: { lens: 6 } },
  { out: 'slimeCrown', n: 1, station: 'altar', ing: { gel: 20, goldCrown: 1 } },
  { out: 'wormFood', n: 1, station: 'altar', ing: { rottenChunk: 20 } }, // vile powder omitted in v1 (Eaters of Souls drop the chunks)
];
