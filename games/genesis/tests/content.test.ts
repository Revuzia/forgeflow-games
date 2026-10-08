// GENESIS — content (CONTRACT.md §9, §19), phase-1 part: the base pack loads with every reference resolved, the
// phase-1 floors hold (plants, weather, biomes, stars, planet kinds, scenarios), every command kind validates, and a
// mod pack merges (new ids appended, existing ids replaced in place) while a broken one is refused with reasons.
// Phase 2+ extends this file (≥ 40 recipes, every power has a handler).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContent, ContentError, type ContentPack } from '../src/sim/content.ts';
import { BASE_PACK } from '../src/data/index.ts';
import { Sim } from '../src/sim/sim.ts';

const MOD = JSON.parse(readFileSync(new URL('../mods/example-highland-flora.json', import.meta.url), 'utf8')) as ContentPack;

test('the base pack loads and meets the phase-1 floors', () => {
  const c = loadContent([BASE_PACK]);
  assert.ok(c.plants.size >= 20);
  for (const t of ['grass', 'shrub', 'tree', 'crop']) assert.ok(c.plants.list.some((p) => p.type === t), `a ${t}`);
  for (const id of ['wild-grain', 'wild-rice', 'teosinte', 'berry-bush', 'reeds', 'oak', 'beech', 'birch', 'pine', 'spruce', 'palm', 'baobab', 'acacia', 'mangrove', 'willow', 'cactus', 'kelp', 'moss-lichen', 'tundra-shrub']) {
    assert.ok(c.plants.has(id), `plant ${id}`);
  }
  assert.ok(c.weather.size >= 18);
  for (const id of ['clear', 'rain', 'storm', 'thunderstorm', 'snow', 'blizzard', 'hail', 'fog', 'sandstorm', 'ashfall', 'acid-rain', 'blood-rain', 'hurricane', 'heatwave', 'cold-snap', 'aurora-storm', 'drizzle', 'monsoon', 'no-atmosphere']) {
    assert.ok(c.weather.has(id), `weather ${id}`);
    const w = c.weather.get(id);
    assert.ok(w.render && 'skyTint' in w.render && 'lightning' in w.render, `${id} render hints`);
  }
  assert.deepEqual(c.biomes.ids(), ['ocean', 'reef', 'coast', 'ice', 'tundra', 'taiga', 'grassland', 'forest', 'rainforest', 'wetland', 'desert', 'dune', 'scrub', 'mountain', 'volcanic', 'barren', 'savanna', 'steppe']);
  for (const k of ['barren', 'terran', 'ocean', 'desert', 'ice', 'jungle', 'volcanic', 'methane', 'moon']) assert.ok(c.planetkinds.has(k), `kind ${k}`);
  for (const s of ['barren', 'sandbox', 'twoworlds', 'system', 'lookdev']) {
    assert.ok(c.scenarios.has(s), `scenario ${s}`);
    assert.ok(Array.isArray(c.scenarios.get(s).peoples));
  }
  assert.ok(c.stars.has('G') && c.stars.has('M') && c.stars.has('black-hole'));
});

test('a mod pack merges: new ids appended, existing ids replaced in place', () => {
  const base = loadContent([BASE_PACK]);
  const c = loadContent([BASE_PACK, MOD]);
  assert.deepEqual(c.packs, ['base', 'highland-flora']);
  assert.equal(c.plants.size, base.plants.size + 1);
  assert.equal(c.plants.idx('pine'), base.plants.idx('pine'), 'replaced in place');
  assert.equal(c.plants.get('pine').name, 'Mountain pine');
  assert.equal(c.plants.idx('edelweiss'), base.plants.size, 'appended');
  assert.ok(c.weather.has('foehn'));
  // a world runs with the mod, and the new weather can be painted
  const sim = new Sim({ seed: 1, scenario: 'sandbox', content: [MOD], overrides: { n: 12 } });
  const r = sim.applyNow({ k: 'weather.paint', kind: 'foehn', lat: 0, lon: 0 });
  assert.ok(r.ok, r.msg);
});

test('broken packs are refused with every problem listed, readably', () => {
  const bad: ContentPack = {
    id: 'broken',
    plants: [{ id: 'oakk', name: 'Oak', type: 'tree' } as never],
    biomes: [{ id: 'swamp', name: 'Swamp', color: '#336633', paint: { species: { tree: 'wilow' } } }],
    scenarios: [{ id: 'mine', name: 'Mine', star: 'Gg', planets: [{ name: 'X', kind: 'terra', orbit: { a: 1 } }], peoples: [] }],
  };
  try {
    loadContent([BASE_PACK, bad]);
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ContentError);
    const msg = (e as Error).message;
    assert.match(msg, /broken › plants\[0\] 'oakk'/);
    assert.match(msg, /did you mean 'willow'/);
    assert.match(msg, /did you mean 'G'/);
    assert.match(msg, /did you mean 'terran'/);
  }
});

test('every registered command validates its parameters and explains refusals', () => {
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 12 } });
  const kinds = sim.registry.kinds();
  for (const k of ['terrain.raise', 'terrain.lower', 'terrain.flatten', 'terrain.smooth', 'terrain.noise', 'terrain.crater', 'terrain.mountain-range',
    'terrain.dig-sea', 'terrain.river', 'terrain.paint-material', 'water.add', 'water.remove', 'water.rain', 'water.flood', 'water.drain',
    'water.sea-level', 'water.spring', 'water.tsunami', 'weather.paint', 'weather.global', 'weather.clear', 'weather.pin-season', 'time.set-hour',
    'time.day-length', 'time.freeze-sun', 'time.year-length', 'time.axial-tilt', 'planet.atmosphere', 'planet.add-air', 'planet.remove-air',
    'star.set', 'planet.set', 'life.plant', 'life.forest', 'life.paint-biome', 'life.pin-biome', 'fire.ignite', 'fire.extinguish', 'set', 'focus', 'freeform']) {
    assert.ok(kinds.includes(k), `command ${k}`);
  }
  const no = (c: Record<string, unknown>, re: RegExp) => {
    const r = sim.applyNow({ k: String(c.k), ...c });
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match(r.msg ?? '', re);
  };
  no({ k: 'terrain.raise', lat: 0, lon: 0, radius: -5 }, /radius/);
  no({ k: 'life.plant', species: 'oakk', lat: 0, lon: 0 }, /did you mean 'oak'/);
  no({ k: 'set', path: 'planet.gravity', value: 900 }, /at most 50/);
  no({ k: 'set', path: 'planet.nonsense', value: 1 }, /no law/);
  no({ k: 'weather.paint', kind: 'rain', lat: 0, lon: 0, planet: 9 }, /no world #9/);
  // a sample of each family succeeds with a human message
  for (const c of [
    { k: 'terrain.mountain-range', lat: 10, lon: 10, to: [0.6, 0.2, 0.77], height: 200 },
    { k: 'terrain.paint-material', lat: -10, lon: 30, material: 'lava', depth: 2 },
    { k: 'water.spring', lat: 20, lon: -40 },
    { k: 'time.year-length', days: 20 },
    { k: 'star.set', kind: 'K' },
    { k: 'planet.set', gravity: 4, distance: 1.1 },
    { k: 'life.paint-biome', biome: 'rainforest', lat: 5, lon: 60, pinned: true },
    { k: 'set', path: 'climate.offset', value: '-5' },
    { k: 'freeform', text: 'make it rain here' },
  ]) {
    const r = sim.applyNow(c);
    assert.ok(r.ok, `${c.k}: ${r.msg}`);
    assert.ok((r.msg ?? '').length > 5, `${c.k} says what happened`);
  }
  sim.step(100);
});

test('the parser previews phase-1 phrases without applying them, and never throws', () => {
  const sim = new Sim({ seed: 2, scenario: 'barren', overrides: { n: 12 } });
  const h = sim.hash();
  const cases: [string, string][] = [
    ['add air', 'planet.add-air'], ['set planet.gravity 3', 'set'], ['set sea level to 12', 'set'], ['make it rain', 'water.rain'],
    ['blizzard everywhere', 'weather.global'], ['raise the land here', 'terrain.raise'], ['plant oak', 'life.plant'],
    ['freeze the sun', 'time.freeze-sun'], ['noon', 'time.set-hour'], ['dig a sea', 'terrain.dig-sea'], ['tsunami', 'water.tsunami'],
    ['the star becomes a red dwarf', 'star.set'], ['eternal winter', 'weather.pin-season'], ['gravity 5', 'set'],
  ];
  for (const [text, k] of cases) {
    const r = sim.parse(text);
    assert.ok(r.resolved && r.resolved.length, `"${text}" resolved (${r.msg})`);
    assert.equal(r.resolved![0].k, k, `"${text}" -> ${r.resolved![0].k}`);
  }
  for (const junk of ['', '   ', 'flibbertigibbet the quux', '!!!', 'set', 'set gravity to banana']) {
    const r = sim.parse(junk);
    assert.equal(typeof r.msg, 'string');
  }
  assert.match(sim.parse('flibbertigibbet').msg ?? '', /I can/);
  assert.equal(sim.hash(), h, 'parse() changes nothing');
});
