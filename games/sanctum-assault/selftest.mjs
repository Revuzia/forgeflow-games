// Lightweight sanity checks (no browser / Three.js required)
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = dirname(fileURLToPath(import.meta.url));
const runtime = join(root, 'runtime');
const required = [
  'boot.js',
  'main.js',
  'data.js',
  'input.js',
  'audio.js',
  'pool.js',
  'arena.js',
  'chars.js',
  'player.js',
  'enemy.js',
  'combat.js',
  'fx.js',
  'ui.js',
];

let failed = 0;
function ok(msg) {
  console.log('  ✓', msg);
}
function bad(msg) {
  console.error('  ✗', msg);
  failed += 1;
}

console.log('[Sanctum Assault] selftest');

if (!existsSync(join(root, 'index.html'))) bad('index.html missing');
else ok('index.html present');

const files = readdirSync(runtime);
for (const f of required) {
  if (!files.includes(f)) bad(`runtime/${f} missing`);
  else ok(`runtime/${f}`);
}

for (const f of required) {
  try {
    execFileSync(process.execPath, ['--check', join(runtime, f)], { stdio: 'pipe' });
    ok(`${f} syntax`);
  } catch (err) {
    bad(`${f} syntax: ${err.stderr?.toString() || err.message}`);
  }
}

const dataSrc = readFileSync(join(runtime, 'data.js'), 'utf8');
for (const token of [
  'export const ARENAS',
  'export const CLASSES',
  'export const ENEMY_TYPES',
  'export function getWaveDef',
  'export function comboMultiplier',
  'Ember Crucible',
  'Frostveil Circle',
  'Stormspire Board',
  'Umbral Fen',
  'Solar Bastion',
  'warrior',
  'archer',
  'mage',
  'HEAL_GOLD_COST',
]) {
  if (!dataSrc.includes(token)) bad(`data.js missing ${token}`);
  else ok(`data has ${token}`);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
if (!html.includes('runtime/boot.js')) bad('index does not load boot.js');
else ok('boot entry wired');
if (!html.includes('three@0.172')) bad('Three.js import map missing');
else ok('Three.js 0.172 import map');
if (!html.includes('btn-heal')) bad('heal button missing from HUD');
else ok('heal button in HUD');

const mainSrc = readFileSync(join(runtime, 'main.js'), 'utf8');
for (const token of ['createGame', 'WAVE CLEAR', 'startRun', 'onHitEnemy', 'arenaCleared', 'onReflect', 'goldBonus']) {
  if (!mainSrc.includes(token)) bad(`main.js missing ${token}`);
  else ok(`main has ${token}`);
}

const enemySrc = readFileSync(join(runtime, 'enemy.js'), 'utf8');
for (const token of ['separateEnemies', 'applyStatus', 'applyStatusVisuals', 'spawnPortal']) {
  if (!enemySrc.includes(token)) bad(`enemy.js missing ${token}`);
  else ok(`enemy has ${token}`);
}

const playerSrc = readFileSync(join(runtime, 'player.js'), 'utf8');
for (const token of ['tryHeal', 'swapMode', 'onReflect', 'bulwarkT', 'wardT']) {
  if (!playerSrc.includes(token)) bad(`player.js missing ${token}`);
  else ok(`player has ${token}`);
}

const arenaSrc = readFileSync(join(runtime, 'arena.js'), 'utf8');
for (const token of ['makeRuneTexture', 'pulseFlash', 'storm', 'createArenaSystem']) {
  if (!arenaSrc.includes(token)) bad(`arena.js missing ${token}`);
  else ok(`arena has ${token}`);
}

if (failed) {
  console.error(`\nFAILED: ${failed} issue(s)`);
  process.exit(1);
}
console.log('\nAll selftest checks passed.');
