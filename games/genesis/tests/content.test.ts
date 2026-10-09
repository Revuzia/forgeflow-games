// GENESIS — content (CONTRACT.md §9, §19), phase-1 part: the base pack loads with every reference resolved, the
// phase-1 floors hold (plants, weather, biomes, stars, planet kinds, scenarios), every command kind validates, and a
// mod pack merges (new ids appended, existing ids replaced in place) while a broken one is refused with reasons.
// Phase 2+ extends this file: ≥ 40 recipes; the god layer's content — ≥ 120 powers across every category, each mapped
// to a registered handler whose defaults validate; the floor list of disasters plus inventions; ≥ 5 creature
// templates; a god mod pack (a power, a disaster, a creature, lexicon words) that loads and works; broken god content
// refused readably.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadContent, ContentError, POWER_CATEGORIES, type ContentPack } from '../src/sim/content.ts';
import { validatePowers } from '../src/sim/god/powers.ts';
import { BASE_PACK } from '../src/data/index.ts';
import { Sim } from '../src/sim/sim.ts';
import { powerEquivalent } from '../src/sim/god/freeform.ts';
import { twoTowns, must } from './helpers/god.ts';

const MOD = JSON.parse(readFileSync(new URL('../mods/example-highland-flora.json', import.meta.url), 'utf8')) as ContentPack;
const GOD_MOD = JSON.parse(readFileSync(new URL('./fixtures/god-mod.json', import.meta.url), 'utf8')) as ContentPack;

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
    ['freeze the sun', 'time.freeze-sun'], ['noon', 'time.set-hour'], ['dig a sea', 'terrain.dig-sea'], ['tsunami', 'water.tsunami|disaster.spawn'],
    ['the star becomes a red dwarf', 'star.set'], ['eternal winter', 'weather.pin-season'], ['gravity 5', 'set'],
  ];
  for (const [text, k] of cases) {
    const r = sim.parse(text);
    assert.ok(r.resolved && r.resolved.length, `"${text}" resolved (${r.msg})`);
    assert.ok(k.split('|').includes(r.resolved![0].k), `"${text}" -> ${r.resolved![0].k}`);
  }
  for (const junk of ['', '   ', 'flibbertigibbet the quux', '!!!', 'set', 'set gravity to banana']) {
    const r = sim.parse(junk);
    assert.equal(typeof r.msg, 'string');
  }
  assert.match(sim.parse('flibbertigibbet').msg ?? '', /I can/);
  assert.equal(sim.hash(), h, 'parse() changes nothing');
});

// ───────────────────────────── the god layer's content ─────────────────────────────

test('god content: >= 40 recipes, >= 120 powers in every category each with a working handler, the disaster floor, >= 5 creatures', () => {
  const c = loadContent([BASE_PACK]);
  assert.ok(c.recipes.size >= 40, `recipes: ${c.recipes.size}`);
  assert.ok(c.powers.size >= 120, `powers: ${c.powers.size}`);
  for (const cat of POWER_CATEGORIES) assert.ok(c.powers.list.some((pw) => pw.category === cat), `a power in ${cat}`);
  const gestures = new Set(c.powers.list.map((pw) => pw.gesture).filter((g) => g));
  assert.ok(gestures.size >= 8, `gestures: ${[...gestures].join(', ')}`);
  for (const pw of c.powers.list) {
    assert.ok(pw.icon && pw.desc && pw.synonyms.length >= 1, `${pw.id}: icon, description, synonyms`);
    assert.ok(pw.ring >= 0 && pw.ring <= 3, `${pw.id}: ring`);
  }
  // every power maps to a registered handler, and every parameter it shows is one the handler takes
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 12 } });
  assert.deepEqual(validatePowers(sim.registry, sim.content), []);
  // its defaults validate: anything still missing is a parameter the palette asks the player for
  const bad: string[] = [];
  for (const pw of c.powers.list) {
    const cmd = { k: pw.command, ...(pw.params ?? {}), lat: 10, lon: 20 };
    const v = sim.registry.validate(sim.u, cmd);
    if (v.ok) continue;
    const missing = (v.msg ?? '').match(/'([\w.-]+)' is required/);
    // (a power over several laws at once — planet.set, star.set — asks for any one of them: one must be on its sliders)
    const anyOf = (v.msg ?? '').match(/needs at least one of ([\w., -]+)\./);
    if (anyOf && anyOf[1].split(/,\s*/).some((k) => k in (pw.schema ?? {}))) continue;
    if (!missing || !(missing[1] in (pw.schema ?? {}))) bad.push(`${pw.id}: ${v.msg}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
  // disasters: the floor list, and inventions of our own
  const floor = ['meteor', 'meteor-shower', 'comet', 'swarm', 'volcano', 'supervolcano', 'quake', 'flood', 'drought', 'wildfire', 'firestorm', 'plague', 'blight',
    'tornado', 'hurricane', 'tsunami', 'solar-flare', 'impact-winter', 'gravity-slip', 'magnetic-storm', 'infestation', 'eclipse', 'moon-fall', 'sinkhole', 'rift',
    'acid-rain', 'ice-age', 'heat-wave', 'rogue-flyby', 'dust-bowl'];
  for (const k of floor) assert.ok(c.disasters.has(k), `disaster ${k}`);
  assert.ok(c.disasters.ids().filter((k) => !floor.includes(k)).length >= 4, 'at least four invented disasters');
  for (const d of c.disasters.list) {
    assert.ok(d.effectors.length >= 1 && Object.keys(d.render).length >= 1, `${d.id}: effectors and render params`);
    assert.ok(c.powers.list.some((pw) => pw.command === 'disaster.spawn' && pw.params.kind === d.id), `${d.id}: a power calls it`);
  }
  assert.ok(c.disasters.list.filter((d) => d.natural && d.natural.rate > 0).length >= 8, 'nature sends many of them on its own');
  // creatures
  for (const k of ['ape', 'ox', 'great-cat', 'tortoise', 'wolf']) assert.ok(c.creatures.has(k), `creature ${k}`);
  assert.ok(new Set(c.creatures.list.map((t) => t.body)).size >= 5, 'each its own body');
});

test('a god mod pack adds a power, a disaster, a creature and words — and they work', () => {
  const c = loadContent([BASE_PACK, GOD_MOD]);
  assert.deepEqual(c.packs, ['base', 'ember-gods']);
  assert.ok(c.disasters.has('ember-rain') && c.creatures.has('salamander') && c.powers.has('disaster-ember-rain') && c.powers.has('creature-salamander'));
  const sim = new Sim({ seed: 4, scenario: 'sandbox', content: [GOD_MOD], overrides: { n: 12 } });
  assert.deepEqual(validatePowers(sim.registry, sim.content), []);
  const pw = sim.content.powers.get('disaster-ember-rain');
  const r = sim.applyNow({ k: pw.command, ...pw.params, lat: 5, lon: 5 });
  assert.ok(r.ok, r.msg);
  assert.equal(sim.snapshot().planets[0].disasters![0].kind, 'ember-rain');
  const a = sim.applyNow({ k: 'creature.adopt', template: 'salamander', lat: 5, lon: 6 });
  assert.ok(a.ok, a.msg);
  assert.equal(sim.snapshot().creatures[0].body, 'lizard');
  // the parser knows the new words
  assert.equal(sim.parse('ember rain at lat 3 lon 3').resolved?.[0].kind, 'ember-rain');
  assert.equal(sim.parse('cinder fall at lat 3 lon 3').resolved?.[0].kind, 'ember-rain');
  assert.equal(sim.parse('adopt a salamander').resolved?.[0].template, 'salamander');
  assert.equal(sim.parse('introduce ember lung').resolved?.[0].disease, 'wasting-cough');
  sim.step(60);
  // and the world saves and loads with it
  const back = Sim.load(sim.save(), [GOD_MOD]);
  assert.equal(back.hash(), sim.hash());
});

test('broken god content is refused, every problem named', () => {
  const refuse = (pack: ContentPack, ...res: RegExp[]) => {
    let msg = '';
    try { loadContent([BASE_PACK, pack]); new Sim({ seed: 1, scenario: 'sandbox', content: [pack], overrides: { n: 12 } }); } catch (e) { assert.ok(e instanceof ContentError, String(e)); msg = (e as Error).message; }
    assert.ok(msg, `${pack.id} should be refused`);
    for (const re of res) assert.match(msg, re);
  };
  const power = GOD_MOD.powers![0];
  refuse({ id: 'no-handler', powers: [{ ...power, id: 'p1', command: 'disaster.summon' }] }, /no-handler|p1/, /'disaster.summon' has no handler/);
  refuse({ id: 'bad-category', powers: [{ ...power, id: 'p2', params: { kind: 'meteor' }, category: 'Magic' as never }] }, /p2/, /category/);
  refuse({ id: 'bad-kind', powers: [{ ...power, id: 'p3', params: { kind: 'meteorr' } }] }, /did you mean 'meteor'/);
  refuse({ id: 'bad-param', powers: [{ ...power, id: 'p4', params: { kind: 'meteor' }, schema: { ...power.schema, flavour: { type: 'string' } } }] }, /'flavour' is not a parameter of 'disaster.spawn'/);
  const dis = GOD_MOD.disasters![0];
  refuse({ id: 'bad-disaster', disasters: [{ ...dis, id: 'd1', effectors: [{ type: 'explode' as never }], natural: { rate: 1, needs: ['volcanik'] } }] }, /effectors\[0\]\.type/, /did you mean 'volcanic'/);
  const cre = GOD_MOD.creatures![0];
  refuse({ id: 'bad-creature', creatures: [{ ...cre, id: 'c1', desires: { dance: 1 } }] }, /unknown behaviour 'dance'/);
  refuse({ id: 'bad-creature-ref', creatures: [{ ...cre, id: 'c2', animals: ['desert-lizzard'] }] }, /did you mean 'desert-lizard'/);
});

test('every power name and synonym, said alone, reaches that power (or its equivalent, or asks for the target it lacks)', () => {
  // a rich world, so every power has something to act on: two peoples, a creature, a live tornado, a disciple, a war
  const { sim, st, lune, hesh } = twoTowns();
  must(sim, { k: 'creature.adopt', template: 'ape' });
  must(sim, { k: 'disaster.spawn', kind: 'tornado', pos: lune.pos, duration: 20000 });
  must(sim, { k: 'agent.make-disciple', id: hesh });
  must(sim, { k: 'settlement.start-war', settlement: st.id, other: lune.id });
  const reg = sim.registry;
  const powers = sim.u.content.powers;
  // a phrase several powers share may reach any of them
  const byPhrase = new Map<string, string[]>();
  for (const pw of powers.list) for (const t of [pw.name.toLowerCase(), ...pw.synonyms]) byPhrase.set(t, [...(byPhrase.get(t) ?? []), pw.id]);
  const h = sim.hash();
  const miss: string[] = [];
  let n = 0;
  for (const pw of powers.list) {
    for (const t of [pw.name.toLowerCase(), ...pw.synonyms]) {
      n++;
      const r = sim.parse(t);
      const cmds = r.resolved ?? [];
      const owners = (byPhrase.get(t) ?? []).map((id) => powers.get(id));
      const reached = cmds.some((c) => owners.some((o) => powerEquivalent(reg, c, o)));
      // a question for the missing target is fine when it names the power (the preview's hint); a refusal is not
      const asked = !r.ok && !/I don't know/.test(r.msg ?? '') && !/ — but /.test(r.msg ?? '');
      if (!reached || (!r.ok && !asked)) miss.push(`${pw.id} "${t}" -> ${r.ok ? '' : 'NOT OK '}${cmds.map((c) => c.k + (c.kind ? `:${String(c.kind)}` : '')).join(' + ') || '-'} | ${(r.msg ?? '').slice(0, 90)}`);
    }
  }
  assert.ok(n > 900, `${n} phrases`);
  assert.deepEqual(miss, [], `${miss.length}/${n} phrases miss their power:\n${miss.join('\n')}`);
  assert.equal(sim.hash(), h, 'parsing changed nothing');
});
