/**
 * Grid Rush static selftest — no browser/WebGL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Node can't import three ESM without install — validate files + pure modules via dynamic import of non-three files
let fails = 0;
function ok(m) {
  console.log('OK ', m);
}
function fail(m) {
  console.error('FAIL', m);
  fails++;
}

const files = [
  'index.html',
  'game_meta.json',
  'styles/main.css',
  'runtime/main.js',
  'runtime/game.js',
  'runtime/config.js',
  'runtime/track.js',
  'runtime/vehicles.js',
  'runtime/items.js',
  'runtime/math.js',
  'runtime/audio.js',
  'runtime/fx.js',
];

for (const f of files) {
  if (fs.existsSync(path.join(__dirname, f))) ok(`exists ${f}`);
  else fail(`missing ${f}`);
}

for (const f of [
  'runtime/config.js',
  'runtime/math.js',
  'runtime/items.js',
  'runtime/main.js',
  'runtime/game.js',
  'runtime/track.js',
  'runtime/vehicles.js',
  'runtime/fx.js',
  'runtime/audio.js',]) {
  const r = spawnSync(process.execPath, ['--check', path.join(__dirname, f)], { encoding: 'utf8' });
  if (r.status === 0) ok(`node --check ${f}`);
  else fail(`syntax ${f}: ${r.stderr || r.stdout}`);
}

const htmlBoot = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
if (htmlBoot.includes('runtime/main.js') && htmlBoot.includes('importmap')) ok('index module boot');
else fail('index boot broken');

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'game_meta.json'), 'utf8'));
if (meta.slug === 'grid-rush' && meta.title === 'Grid Rush') ok('game_meta slug');
else fail('game_meta');

// Import pure modules (no three)
const math = await import(pathToFileUrl(path.join(__dirname, 'runtime/math.js')));
if (math.ordinal(1) === '1st' && math.formatTime(65.5).includes('1:05')) ok('math helpers');
else fail('math helpers');

const config = await import(pathToFileUrl(path.join(__dirname, 'runtime/config.js')));
const vehicles = Object.keys(config.VEHICLES);
const items = Object.keys(config.ITEMS);
const tracks = Object.keys(config.TRACKS);
if (vehicles.length >= 6) ok(`vehicles ${vehicles.length}`);
else fail('vehicles count');
if (items.length >= 10) ok(`items ${items.length}`);
else fail('items count');
if (tracks.length >= 5) ok(`tracks ${tracks.length}`);
else fail('tracks count');

// No Mario Kart clone names
const banned = ['banana', 'shell', 'green shell', 'red shell', 'starman', 'lightning cloud', 'bullet bill'];
const blob = JSON.stringify(config.ITEMS).toLowerCase() + vehicles.join(' ').toLowerCase();
for (const b of banned) {
  if (blob.includes(b)) fail(`banned term present: ${b}`);
}
ok('no banned MK clone names in items/vehicles');

// items.js imports three (browser CDN) — validate item table only here
const itemIds = Object.keys(config.ITEMS);
if (itemIds.includes('pulse_mine') && itemIds.includes('warp_anchor')) ok('core gadgets present');
else fail('core gadgets missing');
const gameJs = fs.readFileSync(path.join(__dirname, 'runtime/game.js'), 'utf8');
if (gameJs.includes('rollItem') && gameJs.includes('Data Orbs') === false && gameJs.includes('checkItemPads'))
  ok('game wires item pads');
else if (gameJs.includes('checkItemPads') && gameJs.includes('rollItem')) ok('game wires item pads');
else fail('game missing item pad wiring');

const gameBlob = fs.readFileSync(path.join(__dirname, 'runtime/game.js'), 'utf8');
if (gameBlob.includes('RaceFX') && gameBlob.includes('RaceAudio') && gameBlob.includes('resolveCollisions')) ok('AAA systems wired');
else fail('missing FX/audio/collisions');

// Controls / hazards / menu previews
if (gameBlob.includes('hopY') && gameBlob.includes('PHYSICS.hopForce') && gameBlob.includes("keys.has('Space')"))
  ok('SPACE jump wired');
else fail('SPACE jump missing');
if (gameBlob.includes('hazardIFrames') && gameBlob.includes('unstickIfNeeded')) ok('hazard unstick wired');
else fail('hazard unstick missing');
if (gameBlob.includes('setChassisPreview') && gameBlob.includes('drawCircuitMap')) ok('menu chassis+circuit previews');
else fail('menu previews missing');
if (gameBlob.includes('reverse') && gameBlob.includes('PHYSICS.reverseAccel')) ok('S reverse/brake');
else fail('reverse control missing');

const cfg = fs.readFileSync(path.join(__dirname, 'runtime/config.js'), 'utf8');
if (/TRACK_HALF_WIDTH\s*=\s*21\.375/.test(cfg))
  ok('road widened (half-width 21.375)');
else fail('road width not widened to 21.375');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
if (html.includes('chassis-preview') && html.includes('circuit-map') && html.includes('menu-landscape'))
  ok('landscape menu markup');
else fail('landscape menu markup missing');
if (html.includes('SPACE') && html.toLowerCase().includes('jump')) ok('help lists jump');
else fail('help missing jump');

// Ensure neon-veil no longer links race
const nvIndex = path.join(__dirname, '..', 'neon-veil', 'index.html');
if (fs.existsSync(nvIndex)) {
  const nv = fs.readFileSync(nvIndex, 'utf8');
  if (!nv.includes('SKY RACE') && !nv.includes('race.html')) ok('neon-veil race stripped');
  else fail('neon-veil still has race UI');
}

console.log(fails === 0 ? '\nSELFTEST PASS' : `\nSELFTEST FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);

function pathToFileUrl(p) {
  let u = path.resolve(p).replace(/\\/g, '/');
  if (!u.startsWith('/')) u = '/' + u;
  return 'file://' + u;
}
