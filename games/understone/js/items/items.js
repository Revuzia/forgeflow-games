// Item database. Stats from research/terraria/04-items-crafting-progression.md
// (wiki-verified; UNVERIFIED rows there use the researched approximations).
// Fields: type: tool|weapon|bow|block|wall|material|armor|consumable|ammo|summon
// pickPower/axePower/hammerPower %, useTime ticks, damage, knockback,
// placeTile/placeWall (tile/wall name), bodySlot: head|chest|legs, defense,
// stack max, value (sell, in copper coins).

export const ITEMS = {};
function item(id, def) {
  ITEMS[id] = { id, name: def.name ?? id, stack: def.stack ?? 9999, value: def.value ?? 0, ...def };
  return ITEMS[id];
}

// --- blocks -------------------------------------------------------------------
const block = (id, name, tileName, extra = {}) =>
  item(id, { name, type: 'block', useTime: 15, placeTile: tileName, ...extra });
block('dirt', 'Dirt Block', 'dirt');
block('stone', 'Stone Block', 'stone');
block('wood', 'Wood', 'wood', { value: 10 });
block('sand', 'Sand Block', 'sand');
block('snow', 'Snow Block', 'snow');
block('ice', 'Ice Block', 'ice');
block('mud', 'Mud Block', 'mud');
block('clay', 'Clay Block', 'clay');
block('ash', 'Ash Block', 'ash');
block('obsidian', 'Obsidian', 'obsidian', { value: 20 });
block('hellstone', 'Hellstone', 'hellstone');
block('copperOre', 'Copper Ore', 'copperOre', { value: 50 });
block('ironOre', 'Iron Ore', 'ironOre', { value: 100 });
block('silverOre', 'Silver Ore', 'silverOre', { value: 150 });
block('goldOre', 'Gold Ore', 'goldOre', { value: 300 });
block('demonite', 'Demonite Ore', 'demonite', { value: 800 });
block('torch', 'Torch', 'torch', { useTime: 10, value: 5 });
block('platform', 'Wood Platform', 'platform', { useTime: 10 });
block('workbench', 'Work Bench', 'workbench', { value: 30 });
block('furnace', 'Furnace', 'furnace', { value: 300 });
block('anvil', 'Iron Anvil', 'anvil', { value: 5000 });
block('bottlePlaced', 'Placed Bottle', 'bottle');
block('chest', 'Chest', 'chest', { value: 100 });
block('door', 'Wooden Door', 'door', { value: 40 });
block('hellforgeItem', 'Hellforge', 'hellforge', { value: 5000 });
block('chair', 'Wooden Chair', 'chair', { value: 60 });

// --- walls ---------------------------------------------------------------------
item('woodWall', { name: 'Wood Wall', type: 'wall', useTime: 10, placeWall: 'woodWall' });
item('dirtWall', { name: 'Dirt Wall', type: 'wall', useTime: 10, placeWall: 'dirtWall' });
item('stoneWall', { name: 'Stone Wall', type: 'wall', useTime: 10, placeWall: 'stoneWall' });

// --- materials -------------------------------------------------------------------
item('gel', { name: 'Gel', type: 'material', value: 5 });
item('lens', { name: 'Lens', type: 'material', value: 50 });
item('cobweb', { name: 'Cobweb', type: 'material', stack: 9999 });
item('fallenStar', { name: 'Fallen Star', type: 'material', value: 500 });
item('shadowScale', { name: 'Shadow Scale', type: 'material', value: 100 });
item('rottenChunk', { name: 'Rotten Chunk', type: 'material', value: 10 });
item('ruby', { name: 'Ruby', type: 'material', value: 3000 });
item('diamond', { name: 'Diamond', type: 'material', value: 4000 });
item('chain', { name: 'Chain', type: 'material', value: 10 });
item('glass', { name: 'Glass', type: 'material' });
item('bottle', { name: 'Bottle', type: 'material', value: 20 });
item('goldCrown', { name: 'Gold Crown', type: 'material', value: 5000 });
const bar = (id, name, value) => item(id, { name, type: 'material', value });
bar('copperBar', 'Copper Bar', 150);
bar('ironBar', 'Iron Bar', 300);
bar('silverBar', 'Silver Bar', 600);
bar('goldBar', 'Gold Bar', 1200);
bar('demoniteBar', 'Demonite Bar', 3000);
bar('hellstoneBar', 'Hellstone Bar', 4000);

// --- pickaxes (power%, damage, useTime — research 04 §5) ---------------------------
const pick = (id, name, power, dmg, useTime, value) =>
  item(id, { name, type: 'tool', tool: 'pickaxe', pickPower: power, damage: dmg, useTime, knockback: 2, stack: 1, value });
pick('copperPickaxe', 'Copper Pickaxe', 35, 4, 23, 500);
pick('ironPickaxe', 'Iron Pickaxe', 40, 5, 20, 1000);
pick('silverPickaxe', 'Silver Pickaxe', 45, 6, 19, 2000);
pick('goldPickaxe', 'Gold Pickaxe', 55, 6, 20, 4000);
pick('nightmarePickaxe', 'Nightmare Pickaxe', 65, 9, 20, 8000);
pick('moltenPickaxe', 'Molten Pickaxe', 100, 12, 23, 16000);

// --- axes ---------------------------------------------------------------------------
const axe = (id, name, power, dmg, useTime, value) =>
  item(id, { name, type: 'tool', tool: 'axe', axePower: power, damage: dmg, useTime, knockback: 3, stack: 1, value });
axe('copperAxe', 'Copper Axe', 35, 3, 30, 400);
axe('ironAxe', 'Iron Axe', 45, 5, 27, 800);
axe('goldAxe', 'Gold Axe', 55, 7, 26, 3200);
axe('moltenHamaxe', 'Molten Hamaxe', 150, 20, 27, 12000);

// --- hammers --------------------------------------------------------------------------
const hammer = (id, name, power, dmg, useTime, value) =>
  item(id, { name, type: 'tool', tool: 'hammer', hammerPower: power, damage: dmg, useTime, knockback: 5.5, stack: 1, value });
hammer('woodenHammer', 'Wooden Hammer', 25, 2, 25, 50);
hammer('copperHammer', 'Copper Hammer', 35, 4, 23, 450);
hammer('ironHammer', 'Iron Hammer', 45, 7, 22, 900);

// --- swords (broadsword arc; damage/useTime/kb — research 04 §5) -------------------------
const sword = (id, name, dmg, useTime, kb, value) =>
  item(id, { name, type: 'weapon', weapon: 'sword', damage: dmg, useTime, knockback: kb, stack: 1, value });
sword('woodenSword', 'Wooden Sword', 7, 20, 5, 100);
sword('copperSword', 'Copper Broadsword', 9, 21, 5.5, 600);
sword('ironSword', 'Iron Broadsword', 12, 20, 5.5, 1200);
sword('silverSword', 'Silver Broadsword', 14, 20, 6, 2400);
sword('goldSword', 'Gold Broadsword', 15, 18, 6.5, 4800);
sword('lightsBane', "Light's Bane", 16, 20, 5, 9000);
sword('volcano', 'Volcano', 40, 40, 6.5, 27000);
ITEMS.lightsBane.element = 'shadow';
ITEMS.volcano.element = 'fire';
// elemental blades (Understone originals — the elements the owner asked for)
sword('frostbrand', 'Frostbrand', 17, 20, 5.5, 12000);
ITEMS.frostbrand.element = 'ice';
sword('stormblade', 'Stormblade', 19, 19, 5.5, 16000);
ITEMS.stormblade.element = 'lightning';
ITEMS.stormblade.proc = 'chainLightning';
sword('tideEdge', 'Tide Edge', 15, 18, 5, 10000);
ITEMS.tideEdge.element = 'water';

// --- bows + ammo ----------------------------------------------------------------------------
const bow = (id, name, dmg, useTime, value) =>
  item(id, { name, type: 'weapon', weapon: 'bow', damage: dmg, useTime, knockback: 1, stack: 1, value, ammo: 'arrow' });
bow('woodenBow', 'Wooden Bow', 4, 30, 100);
bow('copperBow', 'Copper Bow', 6, 29, 500);
bow('ironBow', 'Iron Bow', 8, 28, 1000);
bow('goldBow', 'Gold Bow', 11, 26, 4000);
bow('demonBow', 'Demon Bow', 14, 25, 8000);
bow('moltenFury', 'Molten Fury', 31, 22, 20000);
ITEMS.demonBow.element = 'shadow';
ITEMS.moltenFury.element = 'fire';
bow('glacierBow', 'Glacier Bow', 12, 26, 9000);
ITEMS.glacierBow.element = 'ice';
bow('tempestBow', 'Tempest Bow', 14, 25, 14000);
ITEMS.tempestBow.element = 'lightning';
ITEMS.tempestBow.proc = 'chainLightning';
item('woodenArrow', { name: 'Wooden Arrow', type: 'ammo', ammoType: 'arrow', damage: 5, value: 1 });
item('flamingArrow', { name: 'Flaming Arrow', type: 'ammo', ammoType: 'arrow', damage: 7, value: 2, fire: true });

// --- armor (defense per piece — research 04 §6) ------------------------------------------------
const armor = (id, name, slot, def, value) =>
  item(id, { name, type: 'armor', bodySlot: slot, defense: def, stack: 1, value });
armor('woodHelmet', 'Wood Helmet', 'head', 1, 30);
armor('woodBreastplate', 'Wood Breastplate', 'chest', 1, 45);
armor('woodGreaves', 'Wood Greaves', 'legs', 0, 35);
armor('copperHelmet', 'Copper Helmet', 'head', 1, 750);
armor('copperChainmail', 'Copper Chainmail', 'chest', 2, 1250);
armor('copperGreaves', 'Copper Greaves', 'legs', 1, 1000);
armor('ironHelmet', 'Iron Helmet', 'head', 2, 1500);
armor('ironChainmail', 'Iron Chainmail', 'chest', 3, 2500);
armor('ironGreaves', 'Iron Greaves', 'legs', 2, 2000);
armor('silverHelmet', 'Silver Helmet', 'head', 3, 3000);
armor('silverChainmail', 'Silver Chainmail', 'chest', 4, 5000);
armor('silverGreaves', 'Silver Greaves', 'legs', 3, 4000);
armor('goldHelmet', 'Gold Helmet', 'head', 4, 6000);
armor('goldChainmail', 'Gold Chainmail', 'chest', 5, 10000);
armor('goldGreaves', 'Gold Greaves', 'legs', 4, 8000);
armor('shadowHelmet', 'Shadow Helmet', 'head', 6, 12000);
armor('shadowScalemail', 'Shadow Scalemail', 'chest', 7, 20000);
armor('shadowGreaves', 'Shadow Greaves', 'legs', 6, 16000);
armor('moltenHelmet', 'Molten Helmet', 'head', 8, 18000);
armor('moltenBreastplate', 'Molten Breastplate', 'chest', 9, 30000);
armor('moltenGreaves', 'Molten Greaves', 'legs', 8, 24000);

// --- consumables / specials ---------------------------------------------------------------------
item('lifeCrystal', { name: 'Life Crystal', type: 'consumable', use: 'lifeCrystal', stack: 99, value: 7500 });
item('manaCrystal', { name: 'Mana Crystal', type: 'consumable', use: 'manaCrystal', stack: 99, value: 2500 });
item('magicMirror', { name: 'Magic Mirror', type: 'consumable', use: 'magicMirror', useTime: 90, stack: 1, value: 10000 });
item('lesserHealingPotion', { name: 'Lesser Healing Potion', type: 'consumable', use: 'heal', heal: 50, useTime: 30, stack: 30, value: 300 });
item('grapplingHook', { name: 'Grappling Hook', type: 'tool', tool: 'grapple', use: 'grapple', useTime: 8, stack: 1, value: 6000 });
item('hook', { name: 'Hook', type: 'material', value: 1000 });
item('bedroll', { name: 'Bedroll', type: 'block', placeTile: 'spawnPoint', useTime: 15, stack: 5, value: 800 });
item('stinger', { name: 'Stinger', type: 'material', value: 200 });
// spears (thrust) + flail (thrown ball on chain) — research 08 weapon classes
item('spear', { name: 'Spear', type: 'weapon', weapon: 'spear', damage: 10, useTime: 30, knockback: 6.5, stack: 1, value: 1500 });
item('trident', { name: 'Trident', type: 'weapon', weapon: 'spear', damage: 16, useTime: 28, knockback: 6.5, stack: 1, value: 5000 });
ITEMS.trident.element = 'water';
item('ballOHurt', { name: "Ball O' Hurt", type: 'weapon', weapon: 'flail', damage: 22, useTime: 40, knockback: 7, stack: 1, value: 10000 });
ITEMS.ballOHurt.element = 'shadow';
item('acorn', { name: 'Acorn', type: 'block', placeTile: 'sapling', useTime: 15 }); // sapling handled as treeTrunk seed
item('suspiciousEye', { name: 'Suspicious Looking Eye', type: 'summon', boss: 'eyeOfCthulhu', stack: 20, value: 2500 });
item('slimeCrown', { name: 'Slime Crown', type: 'summon', boss: 'kingSlime', stack: 20, value: 2500 });
item('wormFood', { name: 'Worm Food', type: 'summon', boss: 'eaterOfWorlds', stack: 20, value: 2500 });

// dev/starter kit per progression gate 1: copper pick + axe + shortsword
export const STARTER_ITEMS = [
  ['copperPickaxe', 1],
  ['copperAxe', 1],
  ['copperSword', 1],
];
