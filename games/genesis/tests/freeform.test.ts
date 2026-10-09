// GENESIS — freeform "do this" (CONTRACT.md §11.6): sentences resolve, deterministically and without changing the
// world, to the commands they mean (more than forty phrases across every family of power); compound sentences give
// several commands with the place carried over; places, durations, quantities, sizes and intensities land in the
// parameters; unknown nouns become new content when the command runs ("introduce chocolate", "invent telepathy",
// "rain frogs", "unicorns"); and nonsense never throws — it says what can be done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import type { Command } from '../src/sim/types.ts';
import { Sim } from '../src/sim/sim.ts';
import { distM } from '../src/sim/people/world.ts';
import { hash32 } from '../src/sim/core/rng.ts';
import { moveBy, bearingDir } from '../src/sim/god/util.ts';

type Want = string | ((c: Command[], sim: Sim) => string | true);

/** phrase -> first command kind (or a check over the resolved commands; a string returned is the failure) */
const PHRASES: [string, Want][] = [
  // shape, water, sky, time
  ['raise the land here', 'terrain.raise'], ['dig a sea', 'terrain.dig-sea'], ['a mountain range here', 'terrain.mountain-range'],
  ['make it rain', 'water.rain'], ['blizzard everywhere', 'weather.global'], ['calm the storm', 'miracle.calm'],
  ['clear the skies everywhere', (c) => (c[0].k === 'weather.clear' && c[0].everywhere === true) || JSON.stringify(c)], ['raise the seas by 5', 'water.sea-level'],
  ['freeze the sun', 'time.freeze-sun'], ['noon', 'time.set-hour'], ['eternal winter', 'weather.pin-season'], ['add air', 'planet.add-air'],
  ['the star becomes a red dwarf', 'star.set'], ['pause', 'time.speed'], ['speed 10', 'time.speed'], ['rewind 2 hours', (c) => c[0].k === 'time.rewind' && c[0].ticksAgo === 120 || `rewind: ${JSON.stringify(c)}`],
  // laws (set)
  ['set gravity to 3', (c) => (c[0].k === 'set' && c[0].path === 'planet.gravity' && c[0].value === 3) || JSON.stringify(c)],
  ['gravity 5', 'set'], ['set sea level to 12', 'set'], ['set disasters.natural to 0', 'set'],
  ['set species.plains-folk.lifespan to 120', (c) => (c[0].path === 'species.plains-folk.lifespan' && c[0].value === 120) || JSON.stringify(c)],
  ['make the people of Aru live twice as long', (c, sim) => (c[0].k === 'set' && c[0].path === 'species.plains-folk.lifespan' && Math.abs(Number(c[0].value) - sim.u.content.species.get('plains-folk').lifespan * 2) < 0.01) || JSON.stringify(c)],
  ['make it twice as hot', (c) => (c[0].k === 'set' && c[0].path === 'climate.offset' && Number(c[0].value) > 0) || JSON.stringify(c)],
  // disasters
  ['meteor on Aru', (c, sim) => (c[0].k === 'disaster.spawn' && c[0].kind === 'meteor' && near(sim, c[0].pos, aru(sim), 1)) || JSON.stringify(c)],
  ['send a huge meteor at Aru', (c) => (c[0].kind === 'meteor' && Number(c[0].radius) > 100) || JSON.stringify(c)],
  ['drop a meteor shower on the north coast', (c) => c[0].kind === 'meteor-shower' || JSON.stringify(c)],
  ['plague in Aru', (c) => c[0].kind === 'plague' || JSON.stringify(c)],
  ['tornado heading for Aru', (c, sim) => (c[0].kind === 'tornado' && near(sim, c[0].toward, aru(sim), 1) && !near(sim, c[0].pos, aru(sim), 300)) || JSON.stringify(c)],
  ['earthquake under Aru', (c) => c[0].kind === 'quake' || JSON.stringify(c)], ['tsunami', 'disaster.spawn'],
  ['summon a leviathan off the coast', (c) => c[0].kind === 'leviathan' || JSON.stringify(c)],
  // peoples, ideas, laws
  ['teach Aru bronze', (c) => (c[0].k === 'settlement.teach' && c[0].knowledge === 'bronze' && c[0].settlement !== undefined) || JSON.stringify(c)],
  ['give Aru the wheel', (c) => (c[0].k === 'settlement.introduce' && c[0].idea === 'wheel') || JSON.stringify(c)],
  ['introduce the law of hospitality to Aru', (c) => (c[0].k === 'settlement.law' && c[0].law === 'hospitality') || JSON.stringify(c)],
  ['introduce influenza to Aru', (c) => (c[0].k === 'settlement.introduce' && c[0].disease === 'wasting-cough') || JSON.stringify(c)],
  ['rename Aru to Bright Haven', (c) => (c[0].k === 'settlement.rename' && c[0].name === 'Bright Haven') || JSON.stringify(c)],
  ['raze Aru', 'settlement.raze'], ['split Aru', 'settlement.split'], ['found a city here', 'settlement.found'], ['bless Aru', 'life.bless'], ['curse Aru', 'life.curse'],
  ['possess someone in Aru', (c) => (c[0].k === 'agent.possess' && typeof c[0].id === 'number') || JSON.stringify(c)],
  ['make a prophet in Aru', (c) => (c[0].k === 'agent.make-disciple' && typeof c[0].id === 'number') || JSON.stringify(c)],
  ['inspire the smith of Aru', 'agent.inspire'], ['silence Aru', 'settlement.silence'], ['silence the priest of Aru', 'agent.silence'],
  ['invent the steam engine', (c) => (c[0].knowledge === 'steam-engine') || JSON.stringify(c)],
  // miracles
  ['cast heal on Aru', 'miracle.heal'], ['forest miracle here', 'miracle.forest'], ['fireball at Aru', 'miracle.fireball'], ['shield Aru', 'miracle.shield'],
  // the hand, the creature
  ['grab a person', (c) => (c[0].k === 'hand.grab' && c[0].kind === 'agent') || JSON.stringify(c)], ['throw it at Aru', 'hand.throw'],
  ['adopt an ape', (c) => (c[0].k === 'creature.adopt' && c[0].template === 'ape') || JSON.stringify(c)],
  ['leash the creature to Aru', (c) => (c[0].k === 'creature.leash' && c[0].settlement !== undefined) || JSON.stringify(c)],
  ['teach the creature to heal', (c) => (c[0].k === 'creature.teach-by-example' && c[0].miracle === 'heal') || JSON.stringify(c)],
  ['slap the creature', 'creature.punish'], ['stroke the creature', 'creature.reward'],
  // meta, worlds, the past
  ['restraint on', 'meta.restraint'], ['add a rival god', 'rival.add'], ['a moon', 'world.moon-add'], ['crack the world', 'world.crack'],
  ['three days ago, send a meteor at Aru', (c) => (c[0].k === 'time.edit-past' && (c[0].cmd as Command).k === 'disaster.spawn') || JSON.stringify(c)],
  // new content
  ['introduce chocolate', (c) => (c[0].k === 'settlement.introduce' && c[0].substance === 'chocolate') || JSON.stringify(c)],
  ['introduce cats to Aru', (c) => (c[0].k === 'content.animal' && c[1]?.k === 'settlement.introduce' && c[1].animal === 'cat') || JSON.stringify(c)],
  ['invent telepathy', (c) => (c[0].k === 'content.idea' && c[0].name === 'telepathy') || JSON.stringify(c)],
  ['rain frogs over Aru', (c) => (c[0].k === 'content.weather' && c[0].animal === 'frog') || JSON.stringify(c)],
  ['unicorns', (c) => (c[0].k === 'content.animal' && c[0].name === 'unicorn') || JSON.stringify(c)],
];

function aru(sim: Sim): number[] {
  return sim.u.planets[0].people.settlements.find((s) => s.name === 'Aru')!.pos;
}

function near(sim: Sim, a: unknown, b: ArrayLike<number>, m: number): boolean {
  return Array.isArray(a) && distM(sim.u.planets[0], a as number[], b) <= m;
}

test(`${PHRASES.length} phrases resolve to the commands they mean, and parsing changes nothing`, () => {
  const { sim, st } = town();
  must(sim, { k: 'focus', planet: 0, pos: st.pos });
  assert.ok(PHRASES.length >= 40);
  const h = sim.hash();
  const fails: string[] = [];
  for (const [text, want] of PHRASES) {
    const r = sim.parse(text);
    if (!r.ok || !r.resolved?.length) { fails.push(`"${text}": not understood (${r.msg})`); continue; }
    if (typeof want === 'string') { if (r.resolved[0].k !== want) fails.push(`"${text}": ${r.resolved[0].k}, wanted ${want}`); continue; }
    const v = want(r.resolved, sim);
    if (v !== true) fails.push(`"${text}": ${v}`);
    assert.equal(typeof r.msg, 'string');
  }
  assert.deepEqual(fails, [], fails.join('\n'));
  assert.equal(sim.hash(), h, 'parse() changed nothing');
  // and the same words give the same commands (deterministic)
  for (const [text] of PHRASES.slice(0, 20)) assert.deepEqual(sim.parse(text), sim.parse(text));
});

test('compound sentences: several commands, the place carried to the next clause, durations in ticks', () => {
  const { sim, st } = town();
  must(sim, { k: 'focus', planet: 0, pos: st.pos });
  const day = Math.round(sim.u.planets[0].st.dayHours * 60);
  const r = sim.parse('make it rain blood over Aru for three days and send wolves');
  assert.ok(r.ok, r.msg);
  assert.equal(r.resolved!.length, 2);
  const [rain, wolves] = r.resolved!;
  assert.equal(rain.k, 'weather.paint');
  assert.equal(rain.kind, 'blood-rain');
  assert.equal(rain.duration, 3 * day);
  assert.ok(near(sim, rain.pos, st.pos, 1), 'over Aru');
  assert.equal(wolves.k, 'life.spawn-animal');
  assert.equal(wolves.species, 'wolf');
  assert.ok(near(sim, wolves.pos, st.pos, 1), 'the wolves go to Aru too');
  const r2 = sim.parse('raise the land here, plant oak and then make it rain');
  assert.deepEqual(r2.resolved!.map((c) => c.k), ['terrain.raise', 'life.plant', 'water.rain']);
  const r3 = sim.parse('volcano here and then a flood');
  assert.deepEqual(r3.resolved!.map((c) => c.kind), ['volcano', 'flood']);
  // run it: both happen
  const done = sim.applyNow({ k: 'freeform', text: 'make it rain blood over Aru for three days and send wolves' });
  assert.ok(done.ok, done.msg);
  assert.ok(sim.u.planets[0].weather.some((w) => sim.u.content.weather.list[w.kind].id === 'blood-rain'), 'blood rain falls');
});

test('places, quantities, sizes and intensities land in the parameters', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  must(sim, { k: 'focus', planet: 0, pos: st.pos });
  const twenty = sim.parse('send twenty wolves to Aru').resolved![0];
  assert.equal(twenty.count, 20);
  const big = sim.parse('a huge tornado').resolved![0];
  const small = sim.parse('a tiny tornado').resolved![0];
  assert.ok(Number(big.radius) > Number(small.radius), `huge ${big.radius} > tiny ${small.radius}`);
  const gentle = sim.parse('gentle rain here for two hours').resolved![0];
  assert.equal(gentle.duration, 120);
  assert.ok(Number(gentle.intensity ?? gentle.power ?? 1) < 1, `gentle (${JSON.stringify(gentle)})`);
  const north = sim.parse('volcano north of Aru').resolved![0];
  const np = north.pos as number[];
  assert.ok(np[1] > st.pos[1] && Math.abs(distM(p, np, st.pos) - 900) < 50, 'north of Aru, ~900 m');
  const ll = sim.parse('meteor at lat 10 lon 20').resolved![0];
  assert.ok(Math.abs(Math.asin((ll.pos as number[])[1]) * 180 / Math.PI - 10) < 1e-6, 'latitude 10');
  const ever = sim.parse('blizzard everywhere forever').resolved![0];
  assert.equal(ever.k, 'weather.global');
  const forever = sim.parse('heavy snow over Aru forever').resolved![0];
  assert.ok(Number(forever.duration) < 0 || Number(forever.duration) >= 1e5, `forever (${forever.duration})`);
});

test('unknown nouns become new content when the words are carried out', () => {
  const base = town();
  const save = base.sim.save();
  const run = (text: string): Sim => {
    const sim = Sim.load(save);
    must(sim, { k: 'focus', planet: 0, pos: base.st.pos });
    const r = sim.applyNow({ k: 'freeform', text });
    assert.ok(r.ok, `${text}: ${r.msg}`);
    return sim;
  };
  // a food nobody ever had, given to Aru
  let sim = run('introduce chocolate to Aru');
  const choc = sim.u.content.items.idx('chocolate');
  assert.ok(choc >= 0, 'chocolate exists');
  assert.ok(sim.u.content.items.get('chocolate').tags.includes('food'), 'as a food');
  const ps0 = sim.u.planets[0].people;
  const st = ps0.settlement(base.st.id)!;
  assert.ok(ps0.items.some((g) => g.item === choc && distM(sim.u.planets[0], g.pos, st.pos) < st.territory + 300), 'and some lies by Aru, a thing to wonder at');
  assert.ok(sim.u.content.recipes.list.some((r) => (r.outputs ?? []).some((o) => o.item === 'chocolate')), 'with the craft of making it');
  // it survives save / load (the runtime pack is in the save)
  const back = Sim.load(sim.save());
  assert.ok(back.u.content.items.idx('chocolate') >= 0);
  assert.equal(back.hash(), sim.hash());
  // an idea
  sim = run('invent telepathy');
  assert.ok(sim.u.content.recipes.idx('telepathy') >= 0, 'the idea of telepathy');
  // a rain of an animal nobody ever saw
  sim = run('rain frogs over Aru');
  assert.ok(sim.u.content.weather.idx('rain-of-frogs') >= 0, 'a weather that rains frogs');
  sim.step(130);
  assert.ok(sim.u.planets[0].people.herds.some((h) => /frog/i.test(sim.u.planets[0].people.species.find((d) => d.idx === h.species)?.def.name ?? sim.u.content.animals.list[h.species]?.name ?? '')), 'frogs landed');
  // a new animal by its plural alone
  sim = run('unicorns');
  const ps = sim.u.planets[0].people;
  assert.ok(ps.species.some((d) => d.def.id === 'unicorn') || sim.u.content.animals.idx('unicorn') >= 0, 'unicorns exist');
  // an animal given to a town
  sim = run('introduce cats to Aru');
  assert.ok(sim.u.planets[0].people.species.some((d) => d.def.id === 'cat') || sim.u.content.animals.idx('cat') >= 0, 'cats exist');
});

test('the past edited in words: the command goes into the log at that time, and the world is re-run', () => {
  const { sim, st } = town();
  sim.step(200);
  const t = sim.tick;
  const r = sim.applyNow({ k: 'freeform', text: 'two hours ago, heal Aru' });
  assert.ok(r.ok, r.msg);
  assert.equal(sim.tick, t, 'back where it was');
  const entry = sim.u.log.find((e) => e.tick === t - 120);
  assert.ok(entry && (entry.cmd.k === 'miracle.heal' || entry.cmd.k === 'life.heal'), `in the log at ${t - 120}: ${JSON.stringify(sim.u.log.slice(-3))}`);
  assert.ok(entry!.cmd.pos !== undefined || entry!.cmd.settlement === st.id, 'at Aru');
  assert.ok(!sim.u.log.some((e) => e.cmd.k === 'freeform' || e.cmd.k.startsWith('time.')), 'the words and the time act are not world acts');
  assert.ok(sim.u.chronicle.some((e) => /changed it/.test(e.text)), 'the chronicle remembers the god changed the past');
});

test('nonsense never throws: it says what can be done, and running it changes nothing', () => {
  const { sim } = town();
  const h = sim.hash();
  const words = ['the', 'purple', 'quux', 'set', 'to', 'banana', 'of', 'Aru', 'meteor', 'gravity', '3', 'and', 'then', 'forever', 'every', 'cast', 'zzz', '!!', 'make', 'it', 'ago', 'days', 'between', 'peace', ',', 'war', 'rain', 'creature', 'possess', '-1e9', 'NaN', '🙂', '"', "'", 'set gravity to', 'introduce', 'rename'];
  const junk = ['', '   ', '!!!', 'flibbertigibbet', 'set', 'set gravity to banana', 'make it', 'rain', 'and and and', ', , ,', 'between and', 'ago', '3 days ago,', 'x'.repeat(5000)];
  for (let i = 0; i < 300; i++) {
    const n = 1 + (hash32(i, 77) % 9);
    junk.push(Array.from({ length: n }, (_, k) => words[hash32(i, k, 0x51) % words.length]).join(' '));
  }
  for (const text of junk) {
    let r;
    assert.doesNotThrow(() => { r = sim.parse(text); }, `parse "${text.slice(0, 60)}"`);
    assert.equal(typeof r!.msg, 'string', `"${text.slice(0, 60)}" says something`);
  }
  assert.match(sim.parse('flibbertigibbet').msg ?? '', /I can/);
  assert.equal(sim.hash(), h, 'parsing changed nothing');
  const bad = sim.applyNow({ k: 'freeform', text: 'flibbertigibbet the quux' });
  assert.equal(bad.ok, false);
});

test('war and peace in words: one side named (or none) finds the nearest other people; "end all wars" ends them', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const lone = sim.parse('start a war');
  assert.equal(lone.ok, false);
  assert.match(lone.msg ?? '', /needs two peoples/);
  assert.match(sim.parse('make peace between everyone').msg ?? '', /No one .* is at war/);
  must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 12, era: 'bronze', settled: true, pos: moveBy(st.pos, bearingDir(st.pos, 1.5), 1200, p.st.radius) });
  sim.step(10);
  const other = p.people.settlements.find((s) => s.id !== st.id)!;
  const war = sim.parse('start a war');
  assert.deepEqual(war.resolved, [{ k: 'settlement.start-war', settlement: st.id, other: other.id }]);
  assert.ok(sim.applyNow({ k: 'freeform', text: 'start a war' }).ok);
  for (const t of ['make peace between everyone', 'end all wars', 'stop the war', 'peace']) {
    const r = sim.parse(t);
    assert.equal(r.resolved?.[0].k, 'settlement.make-peace', `"${t}": ${JSON.stringify(r.resolved)}`);
  }
  const done = sim.applyNow({ k: 'freeform', text: 'end all wars' });
  assert.ok(done.ok, done.msg);
  assert.match(sim.parse('end all wars').msg ?? '', /No one .* is at war/);
});
