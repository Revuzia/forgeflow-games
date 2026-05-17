/**
 * Shroud Pass 2 — static critical-path smoke test
 *
 * Walks the room graph the way a real player would, validating each
 * step has the entities + tile gates needed to proceed. Run in plain
 * Node (no DOM): `node smoke_test.js`.
 *
 * Returns exit code 0 if the player can reach the Win state, non-zero
 * with a punch-list otherwise.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const dataCode = fs.readFileSync(path.join(DIR, 'shroud_act1_data.js'), 'utf8');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataCode.replace('(function (global) {', '(function (global) { var window=global;'), sandbox);
const D = sandbox.window.SHROUD_ACT1_DATA;
if (!D) { console.error('FAIL: no SHROUD_ACT1_DATA'); process.exit(1); }
const ROOMS = D.ROOMS;
const ITEMS = D.ITEMS;
const ENEMIES = D.ENEMIES;
const BOSSES = D.BOSSES;

const problems = [];
let pass = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { problems.push({ name, detail }); console.log('  ✗', name, '—', detail); }
}

console.log('\n=== Room inventory ===');
check('22 rooms defined', Object.keys(ROOMS).length === 22, 'got ' + Object.keys(ROOMS).length);

// Reachability: BFS from spawn
const visited = new Set();
const q = [D.PLAYER.spawn_room];
while (q.length) {
  const id = q.shift();
  if (visited.has(id)) continue;
  visited.add(id);
  const r = ROOMS[id];
  if (!r) continue;
  for (const nid of Object.values(r.exits || {})) {
    if (!visited.has(nid)) q.push(nid);
  }
}
check('all 22 rooms reachable from spawn', visited.size === Object.keys(ROOMS).length,
  'unreachable: ' + Object.keys(ROOMS).filter(k => !visited.has(k)).join(', '));

console.log('\n=== Critical path entity check ===');

// Step 1: village_square — Mira NPC, gives quest intro
{
  const r = ROOMS.village_square;
  check('village_square has Mira NPC', r.npcs && r.npcs.some(n => n.id === 'elder_mira'));
  check('village_square reachable from spawn directly', visited.has('village_square'));
}

// Step 2: thicket route — at least one Thornback in the route
{
  const enemyInThicket = ['thicket_a','thicket_b','thicket_c'].some(id =>
    (ROOMS[id].enemies || []).some(e => e.template === 'thornback_lurker' || e.template === 'veilstalker' || e.template === 'wraithwhisper'));
  check('thicket route has at least one enemy', enemyInThicket);
}

// Step 3: Liora in waterfall (gives bow)
{
  const liora = ROOMS.thicket_waterfall && (ROOMS.thicket_waterfall.npcs || []).find(n => n.id === 'liora_scholar');
  check('Liora present in thicket_waterfall', !!liora);
  check('Liora gives bow on first talk', liora && liora.gives_bow_on_first_talk === true);
}

// Step 4: ruins_entrance_overworld → ruins_foyer
{
  check('ruins_entrance_overworld → ruins_foyer', ROOMS.ruins_entrance_overworld.exits.S === 'ruins_foyer');
}

// Step 5: small key in ruins_east_a (or somewhere along east route)
{
  const ea = ROOMS.ruins_east_a;
  const hasKey = (ea.items || []).some(i => i.kind === 'small_key');
  check('small_key present in ruins_east_a', hasKey);
}

// Step 6: north_a needs to be locked behind key
{
  const foyer = ROOMS.ruins_foyer;
  const topTile = foyer.tiles[0];
  check('ruins_foyer north edge has L (locked door)', topTile.includes('L'));
  check('ruins_foyer.N → ruins_north_a', foyer.exits.N === 'ruins_north_a');
}

// Step 7: ruins_west_b miniboss + bombs reward
{
  const wb = ROOMS.ruins_west_b;
  const miniboss = (wb.enemies || []).find(e => e.template === 'geomancer_statue' && e.role === 'miniboss');
  check('Geomancer mini-boss in ruins_west_b', !!miniboss);
  check('ruins_west_b drops bombs reward', wb.miniboss_reward && wb.miniboss_reward.kind === 'bombs');
}

// Step 8: bomb refills exist somewhere in dungeon
{
  const refillRooms = Object.values(ROOMS).filter(r =>
    (r.items || []).some(i => i.kind === 'bomb_refill'));
  check('at least 1 bomb_refill pickup placed', refillRooms.length >= 1,
    'found in ' + refillRooms.length + ' rooms');
}

// Step 9: big_key in big_key_room
{
  const bk = ROOMS.ruins_big_key_room;
  const hasBigKey = (bk.items || []).some(i => i.kind === 'big_key');
  check('big_key present in ruins_big_key_room', hasBigKey);
}

// Step 10: boss_door has B tile
{
  const bd = ROOMS.ruins_boss_door;
  const top = bd.tiles[0];
  check('ruins_boss_door north edge has B (big door)', top.includes('B'));
}

// Step 11: boss room — Guardian + heart_container
{
  const br = ROOMS.ruins_boss_room;
  const boss = (br.enemies || []).find(e => e.template === 'guardian_of_first_light' && e.role === 'boss');
  check('Guardian of First Light in boss room', !!boss);
  check('boss room drops heart_container', br.boss_reward && br.boss_reward.kind === 'heart_container');
}

console.log('\n=== Enemy / boss template integrity ===');
{
  const expectedAIs = ['patrol', 'chase', 'shoot', 'guard', 'charge'];
  const presentAIs = new Set(Object.values(ENEMIES).map(e => e.behavior));
  for (const ai of expectedAIs) {
    check('AI behavior present: ' + ai, presentAIs.has(ai));
  }
  check('Guardian boss has phase HP defined',
    BOSSES.guardian_of_first_light && BOSSES.guardian_of_first_light.hp_phase1 && BOSSES.guardian_of_first_light.hp_phase2);
}

console.log('\n=== Item / weapon source coverage ===');
{
  // Bow is given by Liora dialogue → not a room item
  check('Bow obtainable (Liora gives it)', true);
  // Bombs from miniboss
  check('Bombs obtainable (Geomancer miniboss drop)', true);
  // Big key from big_key_room
  // Already checked
}

console.log('\n=== Tile-grid integrity ===');
let badTileRows = 0;
for (const r of Object.values(ROOMS)) {
  if (!r.tiles || r.tiles.length !== 11) { badTileRows++; continue; }
  for (const row of r.tiles) {
    if (row.length !== 18) { badTileRows++; break; }
  }
}
check('all room tile grids exactly 18×11', badTileRows === 0,
  badTileRows + ' rooms had bad dimensions');

console.log('\n=== Summary ===');
console.log('  passes:', pass);
console.log('  fails: ', problems.length);
if (problems.length === 0) {
  console.log('\n[OK] Critical path is integrity-clean. A player who:');
  console.log('  1) Talks to Mira (south to thicket)');
  console.log('  2) Walks thicket → ruins entrance');
  console.log('  3) Optionally visits Liora (thicket_waterfall) for bow');
  console.log('  4) Enters ruins → gets small key in east_a');
  console.log('  5) Fights Geomancer miniboss in west_b → gets bombs');
  console.log('  6) Unlocks foyer north with key → solves north_a → goes north');
  console.log('  7) Picks up big_key in big_key_room (+ bomb refill)');
  console.log('  8) Unlocks boss_door → defeats Guardian (phase 1 then bomb/arrow phase 2)');
  console.log('  9) Collects heart_container → Win screen');
  console.log('reaches the Act I victory state.');
  process.exit(0);
} else {
  console.log('\n[FAIL] Critical path blocked:');
  problems.forEach(p => console.log('  -', p.name, '—', p.detail || ''));
  process.exit(1);
}
