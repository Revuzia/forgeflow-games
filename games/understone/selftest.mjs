// Understone selftest — pure-logic invariants, no browser required.
// Run: node games/understone/selftest.mjs   (from forgeflow-games/)
// Exercises: registry integrity, recipes, worldgen, collision, inventory/crafting.

let pass = 0, fail = 0;
const t = (name, cond) => {
  if (cond) { pass++; }
  else { fail++; console.error(`  FAIL: ${name}`); }
};

const { World, TILES, T, WALLS, W_ } = await import('./js/world/world.js');
const { generateWorld } = await import('./js/world/worldgen.js');
const { tileCollision } = await import('./js/entities/physics.js');
const { ITEMS } = await import('./js/items/items.js');
const { RECIPES } = await import('./js/items/recipes.js');
const { Inventory } = await import('./js/items/inventory.js');

// ---- 1. registry integrity -------------------------------------------------
console.log('[1] registries');
const SPECIAL_DIG = new Set(['pot']); // loot via onDig special-case, not the item table
for (const tile of TILES) {
  if (tile.drops && !SPECIAL_DIG.has(tile.name)) {
    t(`tile ${tile.name} drops "${tile.drops}" exists as item`, !!ITEMS[tile.drops]);
  }
}
for (const [id, def] of Object.entries(ITEMS)) {
  if (def.placeTile) t(`item ${id} placeTile "${def.placeTile}" exists`, T[def.placeTile] != null);
  if (def.placeWall) t(`item ${id} placeWall "${def.placeWall}" exists`, W_[def.placeWall] != null);
}
const STATIONS = new Set([null, 'workbench', 'furnace', 'anvil', 'bottle', 'altar', 'hellforge', 'water', 'loom', 'sawmill']);
for (const r of RECIPES) {
  t(`recipe ${r.out} output exists`, !!ITEMS[r.out]);
  t(`recipe ${r.out} station "${r.station}" known`, STATIONS.has(r.station));
  for (const ing of Object.keys(r.ing)) t(`recipe ${r.out} ingredient ${ing} exists`, !!ITEMS[ing]);
}
// progression: every tool tier craftable in principle (ingredients exist as drops/craftables)
t('demonAltar is unbreakable (mult 0)', TILES[T.demonAltar].mult === 0);
t('hellstone needs 65 pick', TILES[T.hellstone].pick === 65);

// ---- 2. worldgen -------------------------------------------------------------
console.log('[2] worldgen (small world)');
const w = new World(700, 400, 1234567);
generateWorld(w, () => {});
t('spawn inside world', w.spawnX > 0 && w.spawnX < w.w && w.spawnY > 0 && w.spawnY < w.h);
let groundBelowSpawn = false;
for (let y = w.spawnY; y < w.h; y++) if (w.isSolid(w.spawnX, y)) { groundBelowSpawn = true; break; }
t('solid ground below spawn', groundBelowSpawn);
const counts = new Map();
for (let i = 0; i < w.tiles.length; i++) counts.set(w.tiles[i], (counts.get(w.tiles[i]) ?? 0) + 1);
t('has dirt', (counts.get(T.dirt) ?? 0) > 1000);
t('has stone', (counts.get(T.stone) ?? 0) > 1000);
t('has copper ore', (counts.get(T.copperOre) ?? 0) > 20);
t('has gold ore', (counts.get(T.goldOre) ?? 0) > 5);
t('has hellstone', (counts.get(T.hellstone) ?? 0) > 20);
t('has trees', (counts.get(T.treeTrunk) ?? 0) > 10);
t('has chests', (counts.get(T.chest) ?? 0) >= 2);
t('has life crystals', (counts.get(T.lifeCrystal) ?? 0) >= 2);
t('has demon altars', (counts.get(T.demonAltar) ?? 0) >= 1);
t('has corruption (ebonstone)', (counts.get(T.ebonstone) ?? 0) > 50);
t('corruption ranges recorded', Array.isArray(w.corruption) && w.corruption.length >= 1);
let lavaCells = 0;
for (let i = 0; i < w.liquid.length; i++) if (w.liquid[i] > 0 && w.liquidType[i] === 1) lavaCells++;
t('underworld has lava', lavaCells > 100);
t('surface heights filled', w.surface[10] > 0 && w.surface[w.w - 10] > 0);

// ---- 3. collision -------------------------------------------------------------
console.log('[3] collision');
{
  const cw = new World(50, 50, 1);
  // floor at y=40
  for (let x = 0; x < 50; x++) cw.setTile(x, 40, T.stone, { silent: true });
  // falling entity lands exactly on the floor
  const [vx1, vy1] = tileCollision(cw, 100, 40 * 16 - 42 - 5, 0, 10, 20, 42);
  t('landing clamps vy to touch floor exactly', Math.abs((40 * 16 - 42 - 5 + vy1) - (40 * 16 - 42)) < 0.001);
  // wall stops horizontal movement
  for (let y = 30; y < 40; y++) cw.setTile(20, y, T.stone, { silent: true });
  const [vx2] = tileCollision(cw, 20 * 16 - 20 - 4, 39 * 16 - 42, 8, 0, 20, 42);
  t('wall clamps vx', vx2 < 8 && vx2 >= 0);
  // platform: falls through when fallThrough (drop-through needs vy <= 1, per research 01 §5.4)
  const pw = new World(50, 50, 1);
  for (let x = 0; x < 50; x++) pw.setTile(x, 40, T.platform, { silent: true });
  const [, vyP] = tileCollision(pw, 100, 40 * 16 - 42 - 0.5, 0, 0.9, 20, 42, true);
  t('platform drop-through when holding down', vyP === 0.9);
  const [, vyP2] = tileCollision(pw, 100, 40 * 16 - 42 - 0.5, 0, 0.9, 20, 42, false);
  t('platform blocks landing when not dropping', Math.abs(vyP2 - 0.5) < 0.001);
}

// ---- 4. inventory + crafting -----------------------------------------------------
console.log('[4] inventory/crafting');
{
  const inv = new Inventory();
  inv.add('wood', 30);
  t('add/count', inv.count('wood') === 30);
  t('remove partial', inv.remove('wood', 10) && inv.count('wood') === 20);
  t('remove too many fails atomically', !inv.remove('wood', 999) && inv.count('wood') === 20);
  const { craft } = await import('./js/items/crafting.js');
  const wb = RECIPES.find(r => r.out === 'workbench');
  t('craft workbench', craft(inv, wb) === true && inv.count('workbench') === 1 && inv.count('wood') === 10);
  const sword = RECIPES.find(r => r.out === 'woodenSword');
  t('craft sword consumes 7 wood', craft(inv, sword) === true && inv.count('wood') === 3);
  t('craft without mats fails', craft(inv, sword) === false);
  // armor defense + set bonus
  const inv2 = new Inventory();
  inv2.armor.head = { id: 'goldHelmet', count: 1 };
  inv2.armor.chest = { id: 'goldChainmail', count: 1 };
  inv2.armor.legs = { id: 'goldGreaves', count: 1 };
  t('gold set defense 13+3 bonus', inv2.defense() === 16);
}

console.log(`\nselftest: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
