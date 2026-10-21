// GENESIS — LIVING CONTENT (LIVING.md §4): materials, plants and real animals. Real animals only (the four kinds that were
// not real replaced in place, their old ids still answering; a predator in every food web; new real species with their
// domestic forms); fantasy words map to the nearest real thing or are refused; materials the god invents become content
// with deposits, crafts, uses and demand; veins of ore laid where the god points; new plants and crops, fruit in season;
// the ecology fixes (no false extinction notices, speciation after years in a new home, game near the peoples); and saves
// made before the content grew load with every index where it belongs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { makeCtx, type PCtx } from '../src/sim/people/ctx.ts';
import type { Herd } from '../src/sim/people/state.ts';
import { readSave, SaveWriter, SAVE_MAJOR } from '../src/sim/core/serialize.ts';
import { animalDef, guildTargets, habitatFit, herdArrivals, landGame, landHunter, MAX_LAND_HERDS, reindexHerds, spawnHerd } from '../src/sim/life/herds.ts';
import { ecoDaily, FORM_GAP_YEARS, ISO_RANGE_M, isoDaysOf, LINEAGE_YEARS, lineageRested, mayDiverge, newHome, preyOf, speciate } from '../src/sim/life/ecology.ts';
import { animalWord, IDS_14 } from '../src/sim/life/fauna.ts';
import { plantYield, seasonPhase } from '../src/sim/life/plants.ts';
import { availability, itemIdx } from '../src/sim/people/resources.ts';
import { suitability } from '../src/sim/fields/vegetation.ts';
import { distM, cellPos } from '../src/sim/people/world.ts';
import { town, twoTowns } from './helpers/god.ts';
import { world, must, people } from './helpers/peoples.ts';

const NOT_REAL = ['ice-beast', 'sand-crawler', 'haze-ray', 'drift-ray'];

function cx(sim: Sim): PCtx {
  return makeCtx(sim.u, sim.u.planets[0]);
}

// ───────────────────────────── real animals ─────────────────────────────

test('content: real animals only — the four kinds that were not real are replaced in place and their old ids still answer', () => {
  const sim = world(12);
  const c = sim.u.content;
  for (const id of NOT_REAL) assert.ok(!c.animals.ids().includes(id), `${id} is gone`);
  // same index as in 1.4, the old id an alias of the real kind
  const now = { 'ice-beast': 'musk-ox', 'sand-crawler': 'caracal', 'haze-ray': 'golden-eagle', 'drift-ray': 'duck' } as Record<string, string>;
  for (const [old, real] of Object.entries(now)) {
    assert.equal(c.animals.idx(old), IDS_14.animals.indexOf(old), `${old} keeps its index`);
    assert.equal(c.animals.canonical(old), real);
  }
  assert.ok(!c.disasters.ids().includes('leviathan'), 'no sea monster');
  assert.equal(c.disasters.canonical('leviathan'), 'rogue-wave', 'the leviathan is a rogue wave now');
  // the new real species, appended: every index of 1.4 is where it was
  for (let i = 0; i < IDS_14.animals.length; i++) if (!NOT_REAL.includes(IDS_14.animals[i])) assert.equal(c.animals.list[i].id, IDS_14.animals[i]);
  const added = ['red-junglefowl', 'mallard', 'honey-bees', 'shellfish', 'moose', 'lion', 'tiger', 'harbour-seal', 'macaque', 'wild-camel', 'wild-yak', 'crocodile', 'camel', 'yak', 'kept-bees'];
  for (const id of added) assert.ok(c.animals.idx(id) >= IDS_14.animals.length, `${id} appended`);
  // every domestic kind has a wild ancestor (the chicken had none)
  for (const a of c.animals.list.filter((x) => x.domestic)) assert.ok(c.animals.list.some((w) => w.domesticatesTo === a.id), `${a.id} has a wild ancestor`);
  // every biome with grazers has a hunter of them
  for (const b of c.biomes.ids()) {
    const here = c.animals.list.filter((a) => a.biomes.includes(b));
    if (here.some((a) => a.kind === 'herbivore')) assert.ok(here.some((a) => a.kind === 'predator'), `${b} has a predator`);
  }
});

test('content: an animal the god names is a real one — a species of its own, the nearest real kind of a fantasy one, or refused', () => {
  const { sim } = town();
  const c = sim.u.content;
  assert.deepEqual(animalWord(c, 'ice beasts'), { kind: 'base', id: 'musk-ox' });
  assert.deepEqual(animalWord(c, 'eagles'), { kind: 'base', id: 'golden-eagle' }, 'the same animal under its everyday name');
  assert.equal(animalWord(c, 'zebras').kind, 'real');
  assert.equal(animalWord(c, 'dragon').kind, 'fantasy');
  assert.equal(animalWord(c, 'zombies').kind, 'none');
  // a real animal the world never had: a species of the world, with the body of its nearest base
  const r = sim.applyNow({ k: 'content.animal', name: 'zebra', count: 6 });
  assert.ok(r.ok, r.msg);
  const ps = sim.u.planets[0].people;
  const z = ps.species.find((d) => d.def.id === 'zebra');
  assert.ok(z && c.animals.list[z.base].id === 'wild-horse', 'zebras walk as wild horses');
  // a fantasy one: its nearest real kind, said so; no species of the fantasy name
  const u = sim.applyNow({ k: 'content.animal', name: 'unicorn', count: 4 });
  assert.ok(u.ok && /no unicorns in a real world/i.test(String(u.msg)), u.msg);
  assert.ok(!ps.species.some((d) => d.def.id === 'unicorn'), 'no unicorn species');
  // refused: nothing made
  const before = ps.species.length;
  const zz = sim.applyNow({ k: 'content.animal', name: 'zombie' });
  assert.equal(zz.ok, false);
  assert.match(String(zz.msg), /real world/);
  assert.equal(ps.species.length, before);
  // a rain of a beast that is not real is refused too
  assert.equal(sim.applyNow({ k: 'content.weather', name: 'rain of ghosts', animal: 'ghost' }).ok, false);
});

test('content: free text — the CONTENT phrases of §5.3 resolve as meant', () => {
  const w = twoTowns();
  const sim = w.sim;
  const p = sim.u.planets[0];
  const aru = w.st.pos, lune = w.lune.pos;
  const parse = (t: string) => { const r = sim.parse(t); return { c: (r.resolved ?? []) as Record<string, unknown>[], msg: String(r.msg ?? '') }; };
  const has = (c: Record<string, unknown>[], k: string, f: (x: Record<string, unknown>) => boolean = () => true) => c.some((x) => x.k === k && f(x));
  const near = (pos: unknown, at: number[], m: number) => Array.isArray(pos) && distM(p, pos as number[], at) <= m;
  const cases: [string, (c: Record<string, unknown>[], msg: string) => boolean][] = [
    ['grow a blueberry bush near Aru', (c) => has(c, 'life.plant', (x) => x.species === 'berry-bush')],
    ['summon a dragon', (c) => has(c, 'life.spawn-animal', (x) => x.species === 'crocodile') && !has(c, 'content.animal')],
    ['spawn zombies', (c, m) => c.length === 0 && /real/.test(m)],
    ['send the four horsemen', (c) => has(c, 'disaster.spawn', (x) => x.kind === 'plague') && has(c, 'disaster.spawn', (x) => x.kind === 'drought')],
    ['create a new species of people', (c, m) => !has(c, 'content.item') && /not yet/.test(m)],
    ['release a kraken near Lune', (c) => has(c, 'life.spawn-animal', (x) => x.species === 'whale') && !has(c, 'content.animal')],
    ['bring unicorns to Aru', (c) => has(c, 'life.spawn-animal', (x) => x.species === 'wild-horse') && !has(c, 'content.animal')],
    ['spawn ice beasts in the north', (c) => has(c, 'life.spawn-animal', (x) => x.species === 'musk-ox')],
    ['set loose sand crawlers in the desert', (c) => has(c, 'life.spawn-animal', (x) => x.species === 'caracal')],
    ['unleash a plague of frogs', (c) => !has(c, 'disaster.spawn') && has(c, 'content.animal', (x) => x.name === 'frog')],
    ['spawn lions on the savanna', (c) => has(c, 'life.spawn-animal', (x) => x.species === 'lion')],
    ['give Aru chickens', (c) => has(c, 'settlement.introduce', (x) => x.animal === 'chicken')],
    ['put gold in the hills near Lune', (c) => has(c, 'terrain.seed-ore', (x) => x.ore === 'gold' && near(x.pos, lune, 2500))],
    ['put iron ore in the hills', (c) => has(c, 'terrain.seed-ore', (x) => x.ore === 'iron')],
    ['seed a vein of copper near Aru', (c) => has(c, 'terrain.seed-ore', (x) => x.ore === 'copper' && near(x.pos, aru, 2500))],
    ['create a new metal called mithril and put it in the mountains', (c) => has(c, 'content.material', (x) => x.name === 'mithril' && x.kind === 'metal') && has(c, 'terrain.seed-ore', (x) => x.ore === 'mithril')],
    ['invent a stone called glowstone that people build with', (c) => has(c, 'content.material', (x) => x.name === 'glowstone' && (x.uses as string[]).includes('building'))],
    ['grow a new plant called silverleaf', (c) => has(c, 'content.plant', (x) => x.name === 'silverleaf')],
    ['invent a new crop called sunroot', (c) => has(c, 'content.plant', (x) => x.name === 'sunroot' && x.type === 'crop')],
    ['plant apple trees near Aru', (c) => has(c, 'life.plant', (x) => x.species === 'apple')],
    ['introduce potatoes to Lune', (c) => has(c, 'settlement.introduce', (x) => x.crop === 'potato')],
    ['introduce mithril to Aru', (c) => has(c, 'content.material', (x) => x.name === 'mithril' && x.settlement === w.st.id)],
  ];
  for (const [t, want] of cases) {
    const r = parse(t);
    assert.ok(want(r.c, r.msg), `"${t}" → ${JSON.stringify(r.c.map((x) => ({ ...x, pos: x.pos ? 'v3' : undefined })))} | ${r.msg}`);
  }
});

// ───────────────────────────── materials and ores ─────────────────────────────

test('content: terrain.seed-ore lays a vein (richest at its heart, never under water), the town nearby looks again, and miners can take it', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = cx(sim);
  // a dry cell a short walk from Aru
  let at = -1;
  for (const c of p.cellsNear(st.pos, 700)) if (!p.s.ocean[c] && p.f.water[c] < 0.05 && distM(p, cellPos(p, c), st.pos) > 150) { at = c; break; }
  assert.ok(at >= 0);
  const pos = cellPos(p, at);
  const gold = sim.u.content.ores.idx('gems') + 1;
  const r = sim.applyNow({ k: 'terrain.seed-ore', ore: 'gems', pos, radius: 300, richness: 0.8 });
  assert.ok(r.ok, r.msg);
  assert.equal(p.f.oreType[at], gold);
  assert.ok(p.f.ore[at] > 0.5, 'rich at its heart');
  const ev = sim.drainEvents().find((e) => e.t === 'ore.seeded');
  assert.ok(ev && ev.data?.ore === 'gems' && Number(ev.data?.cells) >= 1);
  assert.ok(st.recent.waterStale !== undefined, 'the settlement looks around again');
  // gems now give an item (they gave none): a miner finds gemstones there
  assert.ok(availability(x, itemIdx(x, 'gemstones'), at) > 0.5, 'gemstones can be mined from the vein');
  // never under water
  let wet = -1;
  for (let c = 0; c < p.count; c++) if (p.s.ocean[c]) { wet = c; break; }
  assert.equal(sim.applyNow({ k: 'terrain.seed-ore', ore: 'gold', pos: cellPos(p, wet) }).ok, false);
});

test('content: a material the god invents is real content — items, a deposit kind, crafts and uses, taught to the town named, saved', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const c0 = sim.u.content;
  const r = sim.applyNow({ k: 'content.material', name: 'mithril', settlement: st.id, traits: ['hard', 'light'] });
  assert.ok(r.ok, r.msg);
  const c = sim.u.content;
  assert.ok(c !== c0, 'content rebuilt');
  // a metal: the ore, the smelted metal, tools a quarter or more better than bronze, blades, ornaments
  for (const id of ['mithril-ore', 'mithril', 'mithril-tools', 'mithril-blade', 'mithril-ornaments']) assert.ok(c.items.has(id), id);
  const tools = c.items.get('mithril-tools');
  assert.ok((tools.quality ?? 0) >= 1.6 * 1.15 && (tools.quality ?? 0) <= 1.6 * 1.4 + 1e-9, `tool quality ${tools.quality}`);
  // a deposit kind that yields its ore, and veins of it: one near Aru
  const ore = c.ores.find('mithril');
  assert.ok(ore && ore.item === 'mithril-ore');
  const oi = c.ores.idx('mithril') + 1;
  let near = 0, all = 0;
  for (let k = 0; k < p.count; k++) if (p.f.oreType[k] === oi) { all++; if (distM(p, cellPos(p, k), st.pos) <= 400) near++; }
  assert.ok(near >= 1 && all >= near, `deposit cells: ${near} within 400 m of Aru, ${all} in all`);
  // two or more crafts use it; Aru was shown them
  const using = c.recipes.list.filter((rc) => (rc.inputs ?? []).some((io) => String(io.item ?? '').startsWith('mithril')) || (rc.gather?.items ?? []).includes('mithril-ore'));
  assert.ok(using.length >= 2, `recipes using it: ${using.map((q) => q.id).join(', ')}`);
  const x = cx(sim);
  const mining = x.rt.byId.get('mithril-mining')!;
  const A = x.A;
  assert.ok((x.ps.members.get(st.id) ?? []).some((s) => A.knows(s, mining)), 'Aru learned to mine it');
  // a stone that builds: a building material with its traits (hard: stronger; glowing: light at night)
  const g = sim.applyNow({ k: 'content.material', name: 'glowstone', kind: 'stone', traits: ['hard', 'glowing'], uses: ['building'] });
  assert.ok(g.ok, g.msg);
  const m = sim.u.content.materials.find('glowstone');
  assert.ok(m && m.strength >= 2 * 1.5 - 1e-9 && m.light === 1, `material: ${JSON.stringify(m)}`);
  assert.ok(sim.u.content.buildings.list.some((b) => b.materials[0] === 'glowstone'), 'houses may be raised in it');
  // queries: ores, materials (with the invented ones' crafts and deposits), what the god made
  const ores = sim.query('ores') as { id: string; invented: boolean; cells: number }[];
  assert.ok(ores.some((o) => o.id === 'mithril' && o.invented && o.cells >= 1));
  const mats = sim.query('materials') as { id: string; invented?: boolean; crafts?: string[] }[];
  assert.ok(mats.some((q) => q.id === 'mithril' && q.invented && (q.crafts ?? []).length >= 2));
  assert.ok(mats.some((q) => q.id === 'glowstone' && q.invented));
  // it lives in the save
  const back = Sim.load(sim.save());
  assert.ok(back.u.content.items.has('mithril-tools'));
  assert.equal(back.hash(), sim.hash());
});

test('content: a people that knows a craft of the new material works it (planJobs), and the first of it is told', async () => {
  const { materialJobs, materialsDaily } = await import('../src/sim/god/materials.ts');
  const { storeAdd } = await import('../src/sim/people/store.ts');
  const { sim, st } = town();
  must(sim, { k: 'content.material', name: 'mithril', settlement: st.id });
  const x = cx(sim);
  // ore in the store: it is wanted worked (the smelting is a job once a fire hot enough stands: here, given)
  storeAdd(x, st, itemIdx(x, 'mithril-ore'), 6);
  storeAdd(x, st, itemIdx(x, 'mithril'), 3);
  const jobs = materialJobs(x, st).map((k) => x.rt.list[k].id);
  assert.ok(jobs.includes('mithril-tools') || jobs.includes('mithril-working'), `jobs: ${jobs.join(', ')}`);
  materialsDaily(sim.u, sim.u.planets[0]);
  assert.ok(st.firsts['mined:mithril'] !== undefined, 'the first ore brought in is remembered');
  assert.ok(sim.u.chronicle.some((e) => /first mithril ore/i.test(e.text)), 'and told');
});

// ───────────────────────────── plants and crops ─────────────────────────────

test('content: nine crops each with its own harvest, fruit trees, wild ancestors, understory plants', () => {
  const sim = world(12);
  const c = sim.u.content;
  const crops = c.plants.list.filter((p) => p.type === 'crop');
  assert.ok(crops.length >= 9, `${crops.length} crops`);
  for (const p of crops) {
    assert.ok(p.season && p.harvest && p.harvest.length, `${p.id} has a season and a harvest`);
    for (const h of p.harvest!) assert.ok(c.items.has(h.item), `${p.id} yields ${h.item}`);
  }
  const own = new Set(crops.map((p) => p.harvest![0].item));
  assert.ok(own.size >= 9, `each crop its own first harvest (${[...own].join(', ')})`);
  const fruit = c.plants.list.filter((p) => p.type === 'tree' && p.fruit);
  assert.ok(fruit.length >= 4, `fruit trees: ${fruit.map((p) => p.id).join(', ')}`);
  for (const id of ['wild-barley', 'wild-sorghum', 'wild-lentil', 'wild-potato', 'wild-cotton']) assert.ok(c.plants.find(id)?.domesticatesTo, id);
  // understory plants never hold their layer's dominant slot (vegetation never seeds them as the cell's species)
  const t = c.plantTable;
  for (const id of ['mushrooms', 'wild-herbs']) assert.ok(!t.byType.flat().includes(c.plants.idx(id)), `${id} is understory`);
  // uranium and gems give items now
  for (const id of ['uranium', 'gems']) assert.ok(c.ores.find(id)?.item && c.items.has(c.ores.find(id)!.item!));
});

test('content: fruit is gathered in its season where the tree grows (a stand in full, scattered trees by how well they suit)', () => {
  const sim = world(24);
  const p = sim.u.planets[0];
  const x = cx(sim);
  const apple = sim.u.content.plants.idx('apple');
  const apples = itemIdx(x, 'apples');
  // an apple stand on land at a mid latitude (it has seasons), in the climate apples like
  let at = -1;
  for (let c = 0; c < p.count; c++) if (!p.s.ocean[c] && p.f.water[c] < 0.05 && Math.abs(p.grid.pos[c * 3 + 1]) > 0.45 && p.s.tempMean[c] > 6 && p.s.tempMean[c] < 16) { at = c; break; }
  assert.ok(at >= 0);
  p.f.moisture[at] = 0.3;
  assert.ok(suitability(p, sim.u.content.plantTable, apple, at) > 0, 'apples can grow there');
  p.f.tree[at] = 0.9; p.f.treeSpecies[at] = apple;
  // find a time in season and one out of it
  const year = p.st.orbit.period;
  let inT = -1, outT = -1;
  for (let k = 0; k < 24 && (inT < 0 || outT < 0); k++) {
    const t = Math.round((k / 24) * year) + 600;
    const ph = seasonPhase(sim.u, p, t, at);
    if (ph >= 0.33 && ph <= 0.45 && inT < 0) inT = t;
    if ((ph >= 0.6 || ph < 0.2) && outT < 0) outT = t;
  }
  assert.ok(inT >= 0 && outT >= 0, 'both seasons found');
  const xIn = { ...x, tick: inT }, xOut = { ...x, tick: outT };
  assert.ok(plantYield(xIn as PCtx, apples, at) > 0.5, 'a stand in season gives');
  assert.equal(plantYield(xOut as PCtx, apples, at), 0, 'out of season, nothing');
  // a resources rule of its own: foragers find apples (and the foraging lore lists them)
  assert.ok(x.rt.list[x.rt.byId.get('foraging')!].gatherItems.includes(apples));
});

test('content: content.plant makes a wild plant that is foraged and a crop with its own harvest', () => {
  const { sim, st } = town();
  const r = sim.applyNow({ k: 'content.plant', name: 'silverleaf', type: 'shrub', pos: st.pos });
  assert.ok(r.ok, r.msg);
  const c = sim.u.content;
  const pl = c.plants.find('silverleaf');
  assert.ok(pl && pl.gather?.[0]?.item === 'silverleaf' && c.items.has('silverleaf'));
  assert.ok(c.recipes.get('foraging').gather!.items.includes('silverleaf'), 'foragers know to look for it');
  const k = sim.applyNow({ k: 'content.plant', name: 'sunroot', type: 'crop' });
  assert.ok(k.ok, k.msg);
  const sr = sim.u.content.plants.find('sunroot')!;
  assert.ok(sr.domestic && sr.season && sr.harvest?.[0]?.item === 'sunroot' && sim.u.content.items.get('sunroot').food! > 0);
  // a town can take it up as its crop
  must(sim, { k: 'settlement.introduce', settlement: st.id, crop: 'sunroot' });
  assert.equal(st.crop, sim.u.content.plants.idx('sunroot'));
  const back = Sim.load(sim.save());
  assert.equal(back.hash(), sim.hash(), 'saved and loaded');
});

test('content: lentils feed the soil they grow in', () => {
  const sim = world(12);
  const p = sim.u.planets[0];
  const lentil = sim.u.content.plants.idx('lentil'), wheat = sim.u.content.plants.idx('wheat');
  let c = -1;
  for (let k = 0; k < p.count; k++) if (!p.s.ocean[k] && p.f.water[k] < 0.05 && p.f.soil[k] > 0.3 && p.f.moisture[k] > 0.3) { c = k; break; }
  p.f.crop[c] = 0.5; p.f.cropSpecies[c] = wheat;
  sim.step(60);
  const fw = p.f.fertility[c];
  p.f.crop[c] = 0.5; p.f.cropSpecies[c] = lentil;
  sim.step(60);
  assert.ok(p.f.fertility[c] > fw + 0.1, `fertility under lentils ${p.f.fertility[c]} vs wheat ${fw}`);
});

// ───────────────────────────── ecology ─────────────────────────────

/**
 * A closed sandbox world (no herds drifting in) with one herd of `species` at a cell chosen by `pick`; with `rest`, the
 * rest of its kind too: a herd of it in its own country (not a new home) at least 5 km away, beyond ISO_RANGE_M.
 */
function lone(species: string, pick: (x: PCtx, c: number) => boolean, seed = 5, rest = false): { sim: Sim; x: PCtx; h: Herd; kin: Herd | null } {
  const sim = world(24, seed);
  const p = sim.u.planets[0];
  p.people.eco.immigration = false;
  p.people.herds = [];
  reindexHerds(cx(sim));
  p.people.eco.seen = {};
  const x = cx(sim);
  const sp = x.c.animals.idx(species);
  let at = -1;
  for (let c = 0; c < p.count && at < 0; c++) if (habitatFit(x, sp, c) > 0.3 && pick(x, c)) at = c;
  assert.ok(at >= 0, 'a place for it');
  const h = spawnHerd(x, sp, at, 10);
  h.inv = -1;
  let kin: Herd | null = null;
  if (rest) {
    let home = -1, hb = 0.3;
    for (let c = 0; c < p.count; c += 2) {
      if (distM(p, cellPos(p, c), cellPos(p, at)) < Math.max(ISO_RANGE_M * 1.5, 5000)) continue;
      if (newHome(x, { cell: c, envT: p.s.tempMean[c] } as Herd, animalDef(x, sp))) continue;
      const v = habitatFit(x, sp, c);
      if (v > hb) { hb = v; home = c; }
    }
    assert.ok(home >= 0, 'its own country far away');
    kin = spawnHerd(x, sp, home, 10);
    kin.inv = -1;
  }
  return { sim, x, h, kin };
}

test('ecology: a lineage becomes a species only after 6-12 years cut off, and only in a home its kind is not made for', () => {
  // in its own country: never, however long
  const home = lone('deer', (x, c) => { const t = x.p.s.tempMean[c]; return t > 2 && t < 18 && ['forest', 'grassland'].includes(x.c.biomes.list[x.p.f.biome[c]].id); }, 5, true);
  // the temperature it has lived in (its envT follows the cell's over the years): here, the cell's mean
  home.h.envT = home.x.p.s.tempMean[home.h.cell];
  const need = isoDaysOf(home.x, home.h.species);
  const yearDays = home.x.year / home.x.day;
  assert.ok(need >= 6 * yearDays && need <= 12 * yearDays, `isolation needed: ${need} days (${(need / yearDays).toFixed(1)} years)`);
  assert.equal(newHome(home.x, home.h, animalDef(home.x, home.h.species)), false);
  home.h.iso = need + 40; home.h.drift = 1.5;
  for (let d = 0; d < 20; d++) ecoDaily(makeCtx(home.sim.u, home.sim.u.planets[0]));
  assert.equal(home.sim.u.planets[0].people.species.length, 0, 'no new species at home');
  // in a new home (a climate warmer than its kind's comfort): once the years are served
  const away = lone('deer', (x, c) => x.p.s.tempMean[c] > 23, 5, true);
  away.h.envT = away.x.p.s.tempMean[away.h.cell];
  assert.equal(newHome(away.x, away.h, animalDef(away.x, away.h.species)), true);
  const needA = isoDaysOf(away.x, away.h.species);
  away.h.iso = needA - 5; away.h.drift = 1.5;
  for (let d = 0; d < 3; d++) ecoDaily(makeCtx(away.sim.u, away.sim.u.planets[0]));
  assert.equal(away.sim.u.planets[0].people.species.length, 0, 'not before its years are served');
  // the days go by (each day's roll is the day's own)
  for (let d = 0; d < 60 && !away.sim.u.planets[0].people.species.length; d++) away.sim.step(1440);
  assert.equal(away.sim.u.planets[0].people.species.length, 1, 'then it does');
});

test('ecology: the last herd of a kind becoming a new species is not chronicled as an extinction', () => {
  const { sim, x, h } = lone('deer', (q, c) => q.p.s.tempMean[c] > 23);
  // the herd and an isolated offshoot of the same group: both change with it
  const p = sim.u.planets[0];
  const kin = spawnHerd(x, h.species, h.cell, 5);
  kin.iso = 3; h.iso = 3; kin.inv = -1;
  const from = h.species;
  const idx = speciate(makeCtx(sim.u, p), h);
  assert.equal(kin.species, idx, 'its offshoot changed with it');
  assert.equal(p.people.eco.became?.[String(from)], idx, 'the kind became the new one');
  ecoDaily(makeCtx(sim.u, p));
  assert.ok(!sim.drainEvents().some((e) => e.t === 'extinction'), 'no extinction notice');
  assert.ok(!sim.u.chronicle.some((e) => e.kind === 'extinction'));
});

// LIVING CONTENT r2 (§4.5): the integrated 50-year runs made 0.67 new kinds a world-year, and the real kinds were gone
// by year 50 — every isolated herd of a kind anywhere was 'one group' by its iso count alone, the last herds of a kind
// counted as cut off, and forms split into forms of forms ('Great little crag hare', depth 4).

test('ecology r2: the last herds of a kind are the kind itself — cut off from nothing, they never become another', () => {
  const { sim, x, h } = lone('deer', (q, c) => q.p.s.tempMean[c] > 23);
  const p = sim.u.planets[0];
  h.envT = p.s.tempMean[h.cell];
  assert.equal(newHome(x, h, animalDef(x, h.species)), true, 'a home its kind is not made for');
  h.iso = isoDaysOf(x, h.species) + 40; h.drift = 1.5;
  for (let d = 0; d < 24; d++) sim.step(1440);
  assert.equal(p.people.species.length, 0, 'no new kind');
  assert.ok(p.people.herds.some((o) => o.species === x.c.animals.idx('deer')), 'the deer are still deer');
});

test('ecology r2: a new kind takes only the herds about it; a population as long cut off elsewhere stays what it is', () => {
  const { sim, x, h, kin } = lone('deer', (q, c) => q.p.s.tempMean[c] > 23, 5, true);
  const p = sim.u.planets[0];
  const near = spawnHerd(x, h.species, h.cell, 5);
  near.inv = -1;
  // cut off for exactly as long (the iso count alone made them one group), but 5 km and more apart
  h.iso = 900; near.iso = 900; kin!.iso = 900;
  const from = h.species;
  const idx = speciate(makeCtx(sim.u, p), h);
  assert.ok(idx >= x.c.animals.size);
  assert.equal(near.species, idx, 'the herd beside it changed with it');
  assert.equal(kin!.species, from, 'the far population stayed deer');
  assert.equal(p.people.eco.became?.[String(from)], undefined, 'the kind lives on: it did not become the new one');
  ecoDaily(makeCtx(sim.u, p));
  assert.ok(!sim.drainEvents().some((e) => e.t === 'extinction'), 'and nothing is told extinct');
  // a kind born here lives where it arose: no herd of it drifts in from beyond (the deer still may)
  const guilds = guildTargets(makeCtx(sim.u, p));
  assert.ok(guilds.some((g) => g.prey.includes(from)), 'deer are game of a guild');
  assert.ok(!guilds.some((g) => g.prey.includes(idx) || g.pred.includes(idx)), 'the new kind is no guild\'s immigrant');
});

test('ecology r2: one new kind from a real kind in LINEAGE_YEARS; never a form of a form, a shellfish bed or a bee', () => {
  const { sim, x, h, kin } = lone('deer', (q, c) => q.p.s.tempMean[c] > 23, 5, true);
  const p = sim.u.planets[0];
  const deer = h.species;
  const first = speciate(makeCtx(sim.u, p), h);
  assert.ok(first >= x.c.animals.size);
  // the world's pace: no new kind of any lineage within FORM_GAP_YEARS of the last
  const wolf = x.c.animals.idx('wolf');
  assert.equal(lineageRested(makeCtx(sim.u, p), wolf), false, `no new kind of wolf within ${FORM_GAP_YEARS} years of the deer's`);
  p.people.species[0].born -= FORM_GAP_YEARS * x.year;
  assert.equal(lineageRested(makeCtx(sim.u, p), wolf), true, `then the wolves may`);
  assert.equal(lineageRested(makeCtx(sim.u, p), deer), false, 'but not the deer again');
  // a second deer population in country too warm for deer (as the first), as far from the deer at home as can be
  let c2 = -1, fd = Math.max(ISO_RANGE_M * 1.5, 5000);
  for (let c = 0; c < p.count; c += 3) {
    if (p.s.tempMean[c] <= 24 || habitatFit(x, deer, c) <= 0.35 || c === h.cell) continue;
    const d = distM(p, cellPos(p, c), cellPos(p, kin!.cell));
    if (d > fd) { fd = d; c2 = c; }
  }
  assert.ok(c2 >= 0 && newHome(x, { cell: c2, envT: p.s.tempMean[c2] } as Herd, animalDef(x, deer)), 'another new country for deer');
  const h2 = spawnHerd(x, deer, c2, 10);
  h2.inv = -1;
  const serve = () => { h2.iso = isoDaysOf(x, deer) + 40; h2.drift = 1.5; h2.envT = p.s.tempMean[h2.cell]; };
  serve();
  for (let d = 0; d < 20; d++) { sim.step(1440); if (h2.species === deer) { h2.iso = Math.max(h2.iso ?? 0, isoDaysOf(x, deer) + 40); h2.drift = 1.5; } }
  assert.equal(p.people.species.length, 1, `no second kind of deer within ${LINEAGE_YEARS} years of the first`);
  // the years go by (the first kind was born LINEAGE_YEARS ago): then it may
  p.people.species[0].born -= LINEAGE_YEARS * x.year;
  serve();
  for (let d = 0; d < 40 && p.people.species.length < 2; d++) { sim.step(1440); if (h2.species === deer) { h2.iso = Math.max(h2.iso ?? 0, isoDaysOf(x, deer) + 40); h2.drift = 1.5; } }
  assert.equal(p.people.species.length, 2, 'then a second kind of deer arises');
  assert.equal(p.people.species[1].parent, deer, 'of the deer themselves');
  // a form born here, swarms, bees and shellfish beds never split
  const cx2 = makeCtx(sim.u, p);
  assert.equal(mayDiverge(cx2, first, animalDef(cx2, first)), false, 'a form of a form');
  for (const id of ['shellfish', 'honey-bees', 'locust-swarm', 'pig']) assert.equal(mayDiverge(cx2, cx2.c.animals.idx(id), cx2.c.animals.get(id)), false, id);
  for (const id of ['deer', 'wolf', 'golden-eagle', 'fish-shoal', 'harbour-seal']) assert.equal(mayDiverge(cx2, cx2.c.animals.idx(id), cx2.c.animals.get(id)), true, id);
  // a shellfish bed cut off in water its kind does not live in, its years served, stays a shellfish bed
  const sh = lone('shellfish', (q, c) => q.c.biomes.list[q.p.f.biome[c]].id === 'ocean', 5, true);
  const ps = sh.sim.u.planets[0];
  sh.h.envT = ps.s.tempMean[sh.h.cell];
  assert.equal(newHome(sh.x, sh.h, animalDef(sh.x, sh.h.species)), true);
  for (let d = 0; d < 24; d++) { sh.h.iso = isoDaysOf(sh.x, sh.h.species) + 40; sh.h.drift = 1.5; sh.sim.step(1440); }
  assert.equal(ps.people.species.length, 0, 'shellfish beds do not become a new kind');
});

test('ecology r2: a real kind the god brings is a real kind — its coming is no birth, and a form of it bears its own name', () => {
  const { sim, x, h } = lone('deer', (q, c) => q.p.s.tempMean[c] > 23, 5, true);
  const p = sim.u.planets[0];
  assert.ok(sim.applyNow({ k: 'content.animal', name: 'zebra', count: 6 }).ok);
  const z = p.people.species.find((d) => d.def.id === 'zebra')!;
  assert.equal(z.god, 1, 'marked as the god\'s');
  // the inspector says the god brought them, not that they were born here of wild horses
  const eco = sim.query('ecology') as { species: { id: string; bornHere: unknown; brought: { tick: number } | null }[] };
  const zq = eco.species.find((s) => s.id === 'zebra')!;
  assert.ok(zq && zq.bornHere === null && zq.brought !== null, JSON.stringify(zq));
  const cx2 = makeCtx(sim.u, p);
  assert.equal(mayDiverge(cx2, z.idx, z.def), true, 'zebras may become a local form');
  assert.equal(lineageRested(cx2, h.species), true, 'the zebras\' coming does not hold back the deer');
  // a herd of zebras cut off in a new home becomes '<word> zebra', not a kind of horse
  const zh = spawnHerd(x, z.idx, h.cell, 8);
  const idx = speciate(makeCtx(sim.u, p), zh);
  assert.ok(idx >= 0);
  assert.match(animalDef(x, idx).name, /^\S+ zebra$/, animalDef(x, idx).name);
  assert.equal(p.people.species.find((d) => d.idx === idx)!.parent, z.idx);
  assert.equal(lineageRested(makeCtx(sim.u, p), z.idx), false, 'and the zebras rest after their form');
});

test('ecology r2: the shoals of one open sea are one population — a shoal far off in the same ocean is not cut off', () => {
  const { sim, x, h } = lone('fish-shoal', (q, c) => !!q.p.s.ocean[c] && q.p.f.water[c] > 5);
  const p = sim.u.planets[0];
  let far = -1, fd = 0;
  for (let c = 0; c < p.count; c += 2) {
    if (!p.s.ocean[c] || p.f.water[c] <= 5 || habitatFit(x, h.species, c) <= 0.3) continue;
    const d = distM(p, cellPos(p, c), cellPos(p, h.cell));
    if (d > fd) { fd = d; far = c; }
  }
  assert.ok(far >= 0 && fd > ISO_RANGE_M * 1.2, `open sea far off (${Math.round(fd)} m)`);
  const o = spawnHerd(x, h.species, far, 60);
  o.inv = -1;
  h.iso = 50; o.iso = 0;
  ecoDaily(makeCtx(sim.u, p));
  assert.ok((h.iso ?? 0) < 50, `in touch with its kind across the sea: iso ${h.iso}`);
});

test('ecology r2: a new kind is named as a naturalist would — its country or climate and the real kind\'s name, never stacked words', () => {
  const ALLOWED = new Set(['Snow', 'Arctic', 'Woolly', 'Desert', 'Pale', 'Deep', 'Blue', 'Grey', 'Long-finned', 'River', 'Lake', 'Spotted', 'Silver',
    'Forest', 'Woodland', 'Jungle', 'Taiga', 'Boreal', 'Tundra', 'Mountain', 'Highland', 'Marsh', 'Swamp', 'Plains', 'Prairie', 'Steppe',
    'Savanna', 'Bush', 'Scrub', 'Sand', 'Island', 'Coastal', 'Polar', 'Rock', 'Reef', 'Coral', 'Northern', 'Southern', 'Lesser', 'Greater']);
  const cases: [string, string, (q: PCtx, c: number) => boolean][] = [
    ['deer', 'deer', (q, c) => q.p.s.tempMean[c] > 23],
    ['boar', 'boar', (q, c) => q.p.s.tempMean[c] < 6],
    ['golden-eagle', 'eagle', (q, c) => q.p.s.tempMean[c] > 20],
    ['desert-lizard', 'lizard', (q, c) => q.p.s.tempMean[c] < 26],
    ['wild-sheep', 'mouflon', (q, c) => q.p.s.tempMean[c] < 0],
  ];
  for (const [id, stem, pick] of cases) {
    const { sim, x, h } = lone(id, pick, 5);
    const p = sim.u.planets[0];
    const names: string[] = [];
    // the same place again and again: every word of its own, then its half of the world, then its size, then none
    for (let k = 0; k < 16; k++) {
      const o = k ? spawnHerd(x, h.species, h.cell, 6) : h;
      const idx = speciate(makeCtx(sim.u, p), o);
      if (idx < 0) break;
      names.push(animalDef(x, idx).name);
    }
    assert.ok(names.length >= 3 && names.length < 16, `${id}: ${names.length} names, then none (${names.join(', ')})`);
    assert.equal(new Set(names).size, names.length, `${id}: all different`);
    for (const n of names) {
      const m = /^(\S+) (.+)$/.exec(n);
      assert.ok(m && ALLOWED.has(m[1]) && m[2] === stem, `${id}: '${n}' is a word of its place and the kind's name '${stem}'`);
    }
    if (id === 'desert-lizard') assert.ok(!names.some((n) => /^(Woolly|Snow|Arctic)/.test(n)), `a lizard is never woolly or of the snow: ${names.join(', ')}`);
  }
});

test('ecology: real hunters of every kind — a raptor takes hares, a seal takes fish, a walker never takes a bird', () => {
  const sim = world(12);
  const c = sim.u.content;
  const a = (id: string) => c.animals.get(id);
  assert.ok(preyOf(a('golden-eagle'), a('rabbit'), 2), 'eagle on hares');
  assert.ok(!preyOf(a('golden-eagle'), a('deer'), 2), 'but not on deer (too heavy)');
  assert.ok(preyOf(a('harbour-seal'), a('fish-shoal'), 2), 'seals on fish');
  assert.ok(!preyOf(a('harbour-seal'), a('shellfish'), 2), 'shellfish beds are nobody\'s prey here');
  assert.ok(!preyOf(a('wolf'), a('mallard'), 0.1), 'small prey only within the pack\'s reach');
  assert.ok(preyOf(a('wolf'), a('deer'), 2) && !preyOf(a('wolf'), a('golden-eagle'), 9), 'wolves on deer, never on eagles');
});

test('ecology: every biome guild holds its game and hunters; a people with no game near draws a herd 300-900 m out', () => {
  const sim = world(24, 7);
  const p = sim.u.planets[0];
  const x = cx(sim);
  const guilds = guildTargets(x);
  assert.ok(guilds.length >= 2);
  const byBiome = new Map<number, Set<number>>();
  for (const h of p.people.herds) {
    if (h.owner >= 0) continue;
    const s = byBiome.get(p.f.biome[h.cell]) ?? new Set();
    s.add(h.species);
    byBiome.set(p.f.biome[h.cell], s);
  }
  let land = 0;
  for (const h of p.people.herds) if (h.owner < 0 && landGame(animalDef(x, h.species))) land++;
  assert.ok(land >= guilds.reduce((q, g) => q + g.prey.length, 0) * 0.6, `land game herds ${land}`);
  // a people set down with no game near
  const st = people(sim, 'plains-folk', 12, { settled: true });
  p.people.herds = p.people.herds.filter((h) => !landGame(animalDef(x, h.species)) || distM(p, cellPos(p, h.cell), st.pos) > 2000);
  reindexHerds(cx(sim));
  herdArrivals(cx(sim));
  const near = p.people.herds.filter((h) => landGame(animalDef(x, h.species)) && distM(p, cellPos(p, h.cell), st.pos) <= 1000);
  assert.ok(near.length >= 1, 'game came near the people');
  for (const h of near) assert.ok(distM(p, cellPos(p, h.cell), st.pos) >= 250, 'at the edge of their country, not in the town');
});

test('ecology r2: a land full of game still lets in the hunters its guilds lack (and no more game)', () => {
  // (the game's herds split past MAX_LAND_HERDS; the cap on arrivals kept the hunters out: 185 herds of game and 3 of
  // hunters at year 50 of the integrated run, most biomes with none)
  const sim = world(24, 7);
  const p = sim.u.planets[0];
  const x = cx(sim);
  const guilds = guildTargets(x).filter((g) => g.pred.length);
  assert.ok(guilds.length >= 1, 'a guild with hunters of its own');
  // every hunter gone; every guild's game at its target and over, the land past its cap
  p.people.herds = p.people.herds.filter((h) => !landHunter(animalDef(x, h.species)));
  reindexHerds(cx(sim));
  const land = () => p.people.herds.filter((h) => h.owner < 0 && (landGame(animalDef(x, h.species)) || landHunter(animalDef(x, h.species)))).length;
  for (let k = 0; land() < MAX_LAND_HERDS + 10; k++) {
    const g = guilds[k % guilds.length];
    spawnHerd(x, g.prey[k % g.prey.length], g.cells[(k * 7919) % g.cells.length], 8);
  }
  for (const g of guildTargets(x)) for (let k = 0; k < g.preyTarget; k++) spawnHerd(x, g.prey[k % g.prey.length], g.cells[(k * 104729) % g.cells.length], 8);
  const game0 = p.people.herds.filter((h) => landGame(animalDef(x, h.species))).length;
  assert.ok(land() > MAX_LAND_HERDS);
  for (let d = 0; d < 4; d++) { sim.u.tick += 1440; herdArrivals(cx(sim)); }
  const hunters = p.people.herds.filter((h) => h.owner < 0 && landHunter(animalDef(x, h.species)));
  assert.ok(hunters.length >= 2, `hunters came (${hunters.length})`);
  for (const h of hunters) assert.ok(guilds.some((g) => g.pred.includes(h.species)), `${animalDef(x, h.species).id} is a hunter of a guild`);
  assert.equal(p.people.herds.filter((h) => landGame(animalDef(x, h.species))).length, game0, 'no game came to a full land');
});

// ───────────────────────────── saves ─────────────────────────────

/** a save rewritten as if made by a build whose content had only the 1.4 animals (minor 4, no contentIds): derived
 * species stored at their 1.4 indices (27 + j), herds of the four replaced kinds under their old ids */
function as14(bytes: Uint8Array, shift: number): Uint8Array {
  const f = readSave(bytes);
  const h = f.header as Record<string, unknown> & { planets: { people: { herds: { species: number }[]; species: { idx: number; parent: number; base: number }[]; eco: Record<string, Record<string, number>> } }[] };
  delete h.contentIds;
  delete h.migratedFrom;
  const old = (i: number) => (i >= IDS_14.animals.length + shift ? i - shift : i);
  for (const pj of h.planets) {
    const ps = pj.people;
    if (!ps) continue;
    for (const hd of ps.herds) hd.species = old(hd.species);
    for (const d of ps.species) { d.idx = old(d.idx); d.parent = old(d.parent); d.base = old(d.base); }
    for (const k of ['seen', 'extinct', 'peak'] as const) {
      const o: Record<string, number> = {};
      for (const [key, v] of Object.entries(ps.eco[k] ?? {})) o[String(old(Number(key)))] = v;
      ps.eco[k] = o;
    }
  }
  const w = new SaveWriter();
  for (const [name, arr] of f.blobs) w.blob(name, arr);
  const out = w.finish(h);
  new DataView(out.buffer).setUint16(4, (SAVE_MAJOR << 8) | 4, true);
  return out;
}

test('saves: a 1.4 save (no content ids) loads with the species born on its world, and the god\'s items, where they belong', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = cx(sim);
  // a species born here (index after the content animals) with a herd, and an old sacred animal by its old id
  const dh = spawnHerd(x, x.c.animals.idx('deer'), st.cell, 6);
  const born = speciate(x, dh);
  assert.ok(born >= x.c.animals.size);
  // a 1.5 save carries its content ids and loads as it was
  assert.ok(Array.isArray((readSave(sim.save()).header.contentIds as Record<string, string[]>).animals));
  assert.equal(Sim.load(sim.save()).hash(), sim.hash());
  st.culture.sacred.push('animal:ice-beast');
  const shift = x.c.animals.size - IDS_14.animals.length;
  const old = as14(sim.save(), shift);
  assert.equal(readSave(old).header.migratedFrom, '1.4');
  const back = Sim.load(old);
  const ps = back.u.planets[0].people;
  assert.ok(ps.species.some((d) => d.idx === born), `the born species is at ${born} again`);
  assert.ok(ps.herds.some((h) => h.species === born), 'its herd too');
  assert.ok(ps.eco.seen[String(born)] !== undefined, 'and the ecology\'s books');
  assert.ok(back.u.planets[0].people.settlement(st.id)!.culture.sacred.includes('animal:musk-ox'), 'a sacred ice beast is a sacred musk ox');
  // the god's inventions in a 1.4 save: chocolate was item 129 then (after the 1.4 base), where the content has grown
  const s2 = town().sim;
  must(s2, { k: 'freeform', text: 'introduce chocolate' });
  const choc = s2.u.content.items.idx('chocolate');
  const st2 = s2.u.planets[0].people.settlements[0];
  must(s2, { k: 'settlement.gift', settlement: st2.id, items: { chocolate: 7 } });
  const f2 = readSave(s2.save());
  const h2 = f2.header as Record<string, unknown> & { planets: { people: { settlements: { id: number; store: number[] }[] } }[] };
  delete h2.contentIds;
  // as a 1.4 build stored it: the chocolate at 129, the store's tail moved down
  const grown = IDS_14.counts.items;
  for (const pj of h2.planets) for (const s of pj.people?.settlements ?? []) {
    const q = s.store[choc] ?? 0;
    s.store = s.store.slice(0, grown);
    if (q) s.store[grown] = q;
  }
  const w = new SaveWriter();
  for (const [name, arr] of f2.blobs) w.blob(name, arr);
  const out = w.finish(h2);
  new DataView(out.buffer).setUint16(4, (SAVE_MAJOR << 8) | 4, true);
  const back2 = Sim.load(out);
  assert.equal(back2.u.content.items.idx('chocolate'), choc);
  assert.equal(back2.u.planets[0].people.settlement(st2.id)!.store[choc], 7, 'the chocolate is chocolate still');
});

test('saves: herds of a replaced kind where the real one cannot live are dropped at load, without an extinction notice', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = cx(sim);
  // a 'haze ray' herd as a methane world held it, here (the golden eagle cannot live at -200 °C: here it is too warm? no —
  // the test sets the cell's mean temperature out of the eagle's range)
  const eagle = x.c.animals.idx('golden-eagle');
  const h = spawnHerd(x, eagle, st.cell, 5);
  const keep = p.s.tempMean[h.cell];
  p.s.tempMean[h.cell] = -150;
  const bytes = sim.save();
  p.s.tempMean[h.cell] = keep;
  const f = readSave(bytes);
  const hd = f.header as Record<string, unknown> & { contentIds?: Record<string, string[]> };
  hd.contentIds!.animals = hd.contentIds!.animals.map((id) => (id === 'golden-eagle' ? 'haze-ray' : id));
  const w = new SaveWriter();
  for (const [name, arr] of f.blobs) w.blob(name, arr);
  const back = Sim.load(w.finish(hd));
  assert.ok(!back.u.planets[0].people.herds.some((q) => q.species === eagle && q.cell === h.cell), 'the haze rays are gone');
  back.step(1440);
  assert.ok(!back.drainEvents().some((e) => e.t === 'extinction' && e.data?.species === 'golden-eagle'), 'no extinction notice for them');
});
